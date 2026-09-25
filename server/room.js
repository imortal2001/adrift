// ── A game room ──────────────────────────────────────────────────────────────
// What the relay does, and all it does: keeps the players in one room, tells
// each who else is there, and passes their messages on. It does not run the
// game — every player's browser does that; the first one in is the host,
// whose word will settle anything contested once the world is shared.
//
// The same class runs in the Cloudflare Worker (worker.js, one Durable
// Object per room) and in the local stand-in (dev-relay.mjs), so the two can
// never speak different protocols.
//
// Protocol — JSON text frames:
//   player → room   {t:'hello', name, who}      once, on connecting
//                   {t:'state', s}              ~12 a second: where you are
//                   {t:'ev', e}                 something that happened, to everyone
//                   {t:'ev', e, to}             …or to one player (the host, sending
//                                               a newcomer the raft)
//   room → player   {t:'welcome', id, host, peers:[{id, name, who, s}]}
//                   {t:'join', id, name, who}   {t:'leave', id}
//                   {t:'state', id, s}          {t:'ev', id, e}
//                   {t:'host', id}              the host left; this is the new one
//                   {t:'full'}                  no room: the socket is closed

export const LIMITS = {
  players: 6,             // a raft crew, not a server
  bytes: 32768,           // largest message passed on (a whole raft, built out)
  perSecond: 45,          // messages a player may send, averaged…
  chunk: 4096,            // …each counted once per this many bytes
  name: 20,               // characters of a name
};

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Room {
  constructor() {
    this.peers = new Map();
    this.next = 1;
    this.host = null;
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

  message(peer, text) {
    if (!peer || typeof text !== 'string' || text.length > LIMITS.bytes) return;
    // A token bucket: bursts are fine, a flood is dropped.
    const now = Date.now();
    peer.budget = Math.min(LIMITS.perSecond, peer.budget + (now - peer.stamp) / 1000 * LIMITS.perSecond);
    peer.stamp = now;
    const cost = Math.ceil(text.length / LIMITS.chunk);
    if (peer.budget < cost) return;
    peer.budget -= cost;

    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'hello' && !peer.ready) {
      peer.ready = true;
      peer.name = clean(m.name, LIMITS.name) || `Player ${peer.id}`;
      peer.who = m.who === 'man' ? 'man' : 'woman';
      if (this.host === null) this.host = peer.id;
      const peers = [...this.peers.values()].filter(p => p.ready && p !== peer)
        .map(p => ({ id: p.id, name: p.name, who: p.who, s: p.s }));
      peer.send(JSON.stringify({ t: 'welcome', id: peer.id, host: this.host, peers }));
      this.others(peer, { t: 'join', id: peer.id, name: peer.name, who: peer.who });
      return;
    }
    if (!peer.ready) return;
    if (m.t === 'state' && m.s && typeof m.s === 'object') {
      peer.s = m.s;
      this.others(peer, { t: 'state', id: peer.id, s: m.s });
    } else if (m.t === 'ev' && m.e && typeof m.e === 'object') {
      // Changing character or name is an event the room keeps, for later
      // arrivals — and a name is passed on as cleaned here.
      if (m.e.k === 'who') peer.who = m.e.who === 'man' ? 'man' : 'woman';
      if (m.e.k === 'name') m.e = { k: 'name', name: (peer.name = clean(m.e.name, LIMITS.name) || peer.name) };
      const to = this.peers.get(m.to);
      if (to) { if (to !== peer && to.ready) this.safe(to, JSON.stringify({ t: 'ev', id: peer.id, e: m.e })); }
      else if (m.to === undefined) this.others(peer, { t: 'ev', id: peer.id, e: m.e });
    }
  }

  leave(peer) {
    if (!peer || !this.peers.delete(peer.id)) return;
    if (peer.ready) this.others(peer, { t: 'leave', id: peer.id });
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
