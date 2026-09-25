// ── A game room ──────────────────────────────────────────────────────────────
// What the relay does, and all it does: keeps the players in one room, tells
// each who else is there, and passes their messages on. It does not run the
// game — every player's browser does that; the first one in is the host,
// whose word will settle anything contested once the world is shared.
//
// And it keeps the room's world, so it lasts when everyone has gone: the
// host's game sends the world as it stands (rafts, statues, the time of day)
// every so often, and each player their own record in it (what they carry,
// where they are, their statue), and a player joining is handed both. Where
// that is kept is `store` — a Durable Object's storage on Cloudflare, a file
// on this machine.
//
// The same class runs in the Cloudflare Worker (worker.js, one Durable
// Object per room) and in the local stand-in (dev-relay.mjs), so the two can
// never speak different protocols.
//
// Protocol — JSON text frames:
//   player → room   {t:'hello', name, who, tok, pid}  once, on connecting (tok: the
//                                               same for a player coming back after a
//                                               drop; pid: the same player, any day)
//                   {t:'keep', w}               the host: the world as it stands
//                   {t:'keepme', r}             anyone: their own record in it
//                   {t:'bye'}                   leaving on purpose, not dropped
//                   {t:'state', s}              ~12 a second: where you are
//                   {t:'ev', e}                 something that happened, to everyone
//                   {t:'ev', e, to}             …or to one player (the host, sending
//                                               a newcomer the raft)
//   room → player   {t:'welcome', id, host, peers:[{id, name, who, s}], world, me}
//                                               world, me: as last kept (or null)
//                   {t:'join', id, name, who, back}   back: they dropped out a moment ago
//                   {t:'leave', id, bye}        bye: they left; otherwise, dropped
//                   {t:'state', id, s}          {t:'ev', id, e}
//                   {t:'host', id}              the host left; this is the new one
//                   {t:'full'}                  no room: the socket is closed

export const LIMITS = {
  players: 6,             // a raft crew, not a server
  bytes: 32768,           // largest message passed on (a whole raft, built out)
  perSecond: 45,          // messages a player may send, averaged…
  chunk: 4096,            // …each counted once per this many bytes
  name: 20,               // characters of a name
  chat: 140,              // characters of something said
  back: 90 * 1000,        // someone dropped this recently, coming back, is back
  world: 900 * 1024,      // largest world kept
  record: 32 * 1024,      // largest player record kept
  keepEvery: 1500,        // ms between one keep and the next, per player
};

/** Where nothing is kept: a room that forgets (tests, or no storage). */
const NOWHERE = { get: async () => null, put: async () => {} };

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Room {
  /** @param store  {get(key) → text|null, put(key, text)}, both async */
  constructor(store = NOWHERE) {
    this.store = store;
    this.world = undefined;     // the world's text, once read from the store
    this.peers = new Map();
    this.next = 1;
    this.host = null;
    this.dropped = new Map();   // tok -> when they dropped out
  }

  /** A new connection. `send(text)` and `close()` talk to its socket. */
  join(send, close) {
    if (this.peers.size >= LIMITS.players) {
      send(JSON.stringify({ t: 'full' }));
      close();
      return null;
    }
    const peer = { id: this.next++, send, close, name: '', who: 'woman', s: null, ready: false,
                   budget: LIMITS.perSecond, stamp: Date.now() };
    this.peers.set(peer.id, peer);
    return peer;
  }

  async message(peer, text) {
    if (!peer || typeof text !== 'string') return;
    const now = Date.now();
    // The world, and a player's record, are big and rare: they go by their
    // own limits, not the ones for play.
    if (text.startsWith('{"t":"keep')) return this.keep(peer, text, now);
    if (text.length > LIMITS.bytes) return;
    // A token bucket: bursts are fine, a flood is dropped.
    peer.budget = Math.min(LIMITS.perSecond, peer.budget + (now - peer.stamp) / 1000 * LIMITS.perSecond);
    peer.stamp = now;
    const cost = Math.ceil(text.length / LIMITS.chunk);
    if (peer.budget < cost) return;
    peer.budget -= cost;

    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'hello' && !peer.ready && !peer.greeting) {
      peer.greeting = true;
      peer.pid = clean(m.pid, 32);
      // What is kept: the world, and this player's own record in it.
      let world = null, me = null;
      try {
        if (this.world === undefined) this.world = await this.store.get('world');
        world = this.world;
        if (peer.pid) me = await this.store.get(`p:${peer.pid}`);
      } catch { /* a room that cannot read its store plays on without it */ }
      if (!this.peers.has(peer.id)) return;        // gone while we looked
      peer.ready = true;
      peer.name = clean(m.name, LIMITS.name) || `Player ${peer.id}`;
      peer.who = m.who === 'man' ? 'man' : 'woman';
      peer.tok = clean(m.tok, 32);
      const gone = peer.tok && this.dropped.get(peer.tok);
      const back = !!gone && now - gone < LIMITS.back;
      if (peer.tok) this.dropped.delete(peer.tok);
      if (this.host === null) this.host = peer.id;
      const peers = [...this.peers.values()].filter(p => p.ready && p !== peer)
        .map(p => ({ id: p.id, name: p.name, who: p.who, s: p.s }));
      // Kept as text, and handed on as it was kept.
      const welcome = JSON.stringify({ t: 'welcome', id: peer.id, host: this.host, peers })
        .replace(/}$/, `,"world":${world || 'null'},"me":${me || 'null'}}`);
      peer.send(welcome);
      this.others(peer, { t: 'join', id: peer.id, name: peer.name, who: peer.who, back });
      return;
    }
    if (!peer.ready) return;
    if (m.t === 'bye') { peer.bye = true; return; }
    if (m.t === 'state' && m.s && typeof m.s === 'object') {
      peer.s = m.s;
      this.others(peer, { t: 'state', id: peer.id, s: m.s });
    } else if (m.t === 'ev' && m.e && typeof m.e === 'object') {
      // Changing character or name is an event the room keeps, for later
      // arrivals — and a name is passed on as cleaned here.
      if (m.e.k === 'who') peer.who = m.e.who === 'man' ? 'man' : 'woman';
      if (m.e.k === 'name') m.e = { k: 'name', name: (peer.name = clean(m.e.name, LIMITS.name) || peer.name) };
      if (m.e.k === 'chat') { const text = clean(m.e.text, LIMITS.chat); if (!text) return; m.e = { k: 'chat', text }; }
      const to = this.peers.get(m.to);
      if (to) { if (to !== peer && to.ready) this.safe(to, JSON.stringify({ t: 'ev', id: peer.id, e: m.e })); }
      else if (m.to === undefined) this.others(peer, { t: 'ev', id: peer.id, e: m.e });
    }
  }

  /** {t:'keep', w} from the host, {t:'keepme', r} from anyone: kept for next time. */
  async keep(peer, text, now) {
    if (!peer.ready) return;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'keep' && peer.id === this.host && m.w && typeof m.w === 'object') {
      if (now - (peer.keptWorld || 0) < LIMITS.keepEvery) return;
      const w = JSON.stringify(m.w);
      if (w.length > LIMITS.world) return;
      peer.keptWorld = now;
      this.world = w;
      await this.store.put('world', w);
    } else if (m.t === 'keepme' && peer.pid && m.r && typeof m.r === 'object') {
      if (now - (peer.keptMe || 0) < LIMITS.keepEvery) return;
      const r = JSON.stringify(m.r);
      if (r.length > LIMITS.record) return;
      peer.keptMe = now;
      await this.store.put(`p:${peer.pid}`, r);
    }
  }

  leave(peer) {
    if (!peer || !this.peers.delete(peer.id)) return;
    if (peer.ready) this.others(peer, { t: 'leave', id: peer.id, bye: !!peer.bye });
    if (peer.ready && !peer.bye && peer.tok) {
      // Remembered a while, so coming back reads as coming back.
      this.dropped.set(peer.tok, Date.now());
      if (this.dropped.size > 32) this.dropped.delete(this.dropped.keys().next().value);
    }
    if (this.host === peer.id) {
      // The longest-connected player left takes over.
      const next = [...this.peers.values()].find(p => p.ready);
      this.host = next ? next.id : null;
      if (next) this.all({ t: 'host', id: next.id });
    }
  }

  others(from, msg) {
    const text = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p !== from && p.ready) this.safe(p, text);
  }

  all(msg) {
    const text = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.ready) this.safe(p, text);
  }

  safe(p, text) {
    try { p.send(text); } catch { this.leave(p); }
  }
}
