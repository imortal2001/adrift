// ── The rafts, shared ────────────────────────────────────────────────────────
// Playing together (net.js), everyone is in the room's world — kept on the
// relay between visits (main.js enterRoom) — with its rafts: any number of
// them, and anyone can board, build on and paddle any. Your own world waits
// at home. What each of you pays for and takes away is your own — building
// costs your planks, whatever you salvage is yours, whoever built it, and
// cooked fish go in the bag of whoever takes them off the fire. Two of you at one thing at once (the same spot
// to build on, the same crate, the same fish on a fire, the last drink in a
// collector, the same piece to take apart — and, ashore, the same plant,
// flint face or statue: main.js) is the host's to settle: one gets it, and
// the other is told (or paid back).
//
// Every change goes to the others as it happens, naming its raft: a piece
// built (the first of a new raft carries where that raft is), a piece taken
// away, a fish hung on a fire or a log fed to it (as what was done, so two at
// once both count), and the state of a deck object (a fire lit, a sail
// raised — a guest's word only on that much: what is on a spit, in a fire
// and in a collector is the host's). Each copy applies it to its own raft of
// that name. The host's rafts are the ones that count: shortly
// after any change, and now and then regardless, the host sends them whole,
// and the others bring theirs into line — settling two people building on
// one spot at once, and fires burning down at slightly different rates.

import { Raft } from './raft.js';
import { BUILDABLE_BY_ID, ITEMS, FIRE, fishOf, salvaged } from './items.js';
import { SharedWorld, WORLD_EVENTS } from './sharedworld.js';

const SETTLE = 1.5;     // the host sends the rafts this long after a change…
const EVERY = 20;       // …and this often regardless
const OWN = 1.2;        // a copy arriving this soon after your own change is already out of date
const SPLIT = 24 * 1024;  // characters: the rafts bigger than this go one to a message (the relay passes on 32 KB)

/** Events that change the world rather than a player: they come here, not to a Remote. */
const RAFT = new Set(['raft', 'place', 'take', 'obj', 'hang', 'feed']);
export const WORLD = new Set([...RAFT, ...WORLD_EVENTS]);

const now = () => performance.now() / 1000;

export class Together {
  constructor(game) {
    this.game = game;
    this.fresh = false;         // the host's rafts have not arrived yet
    this.built = new Map();     // raft id -> when you last built on it: the host may not have heard yet
    this.settle = null;         // seconds until the host sends the rafts, after a change
    this.every = EVERY;
    this.edited = -Infinity;
    this.world = new SharedWorld(game);   // the rest of it: the sky, the sea, what lives there
  }

  get net() { return this.game.net; }
  get raft() { return this.game.raft; }
  get rafts() { return this.game.rafts; }

  // ── what you do ────────────────────────────────────────────────────────────
  placed(id, t) {
    const r = this.raft;
    // With where the raft is: if it is new to them, the others make it there.
    const e = { k: 'place', ri: r.id, id, t: { cx: t.cx, cz: t.cz, ex: t.ex, ez: t.ez, es: t.es }, pose: r.pose() };
    this.built.set(r.id, now());
    this.send(e);
  }
  took(piece) {
    const at = Raft.where(piece);
    if (this.net.isHost) this.noteTaken(this.raft, at, this.net.name);
    this.send({ k: 'take', ri: this.raft.id, at });
  }
  touched(o, r = this.raft) { this.send({ k: 'obj', ri: r.id, o: r.objState(o) }); }
  // A fish hung on a fire, a log on it: said as what was done, not as how the
  // fire now stands — two of you at once each add theirs.
  hung(o, id, r = this.raft) { this.send({ k: 'hang', ri: r.id, cx: o.cx, cz: o.cz, id }); }
  fed(o, r = this.raft) { this.send({ k: 'feed', ri: r.id, cx: o.cx, cz: o.cz }); }

  send(e) {
    if (!this.net.connected) return;
    this.net.event(e);
    this.edited = now();
    if (this.net.isHost) this.settle = SETTLE;
  }

  /**
   * Every raft, whole, to the others (or `to` one of them): in one message —
   * or, too big for the relay to pass on, one raft to each, every one saying
   * which rafts there are, so none is taken for gone for not being in it. (A
   * crew's rafts built out, all in one, came to more than the relay passes
   * on, and it dropped them without a word: a newcomer got no raft at all.)
   */
  sendRafts(to) {
    const rs = this.snapshot(), st = this.game.statues.toJSON(), wk = this.game.wakersJSON();
    const one = { k: 'raft', rs, st, wk };
    if (rs.length < 2 || JSON.stringify(one).length < SPLIT) { this.net.event(one, to); return; }
    const all = rs.map(r => r.id);
    rs.forEach((r, i) => this.net.event(i ? { k: 'raft', rs: [r], all } : { k: 'raft', rs: [r], all, st, wk }, to));
  }

  /** Every raft there is, whole, for the others. */
  snapshot() {
    return this.rafts.list.filter(r => r.size).map(r => ({ id: r.id, ...r.snapshot() }));
  }

  // ── coming and going ───────────────────────────────────────────────────────
  /** You are in a game: its world, as the room kept it (main.js). Hosting, it is yours to run. */
  enter(host, stored) {
    const back = this.game.room === this.net.code;      // back after a drop: the same world, still here
    this.world.enter(host);
    this.game.enterRoom(this.net.code, stored || {}, host);
    // A guest's copy waits for the host's live one.
    this.fresh = !host;
    // Back to find yourself the host (the relay came back, and you were in
    // first): the world is yours to run now. Left following, nobody ran the
    // fish, the flotsam or the dinosaurs — everyone waited on everyone.
    if (back && host) {
      this.hosting();
      queueMicrotask(() => this.net.log('You are the host now.'));     // (after "Back in …")
    }
  }

  /** Hosting: who took a piece apart just now, for anyone a moment behind them. */
  noteTaken(r, at, by) {
    const taken = this.taken ||= new Map();
    if (taken.size > 200) taken.clear();
    taken.set(`${r.id}:${at.join(',')}`, { by, at: now() });
  }

  /** Someone arrived: the host hands them the rafts. */
  joined(id) {
    if (this.net.isHost) this.sendRafts(id);
    this.world.joined(id);
  }

  /** Your last word to the room, leaving on purpose. */
  leaving() { this.game.keepRoom(); }

  /** Out of the game, however that happened: back home, to your own world. */
  exit() {
    this.world.exit();
    this.fresh = false;
    this.game.leaveRoom();
    this.afterChange();
  }

  // ── what the others do ─────────────────────────────────────────────────────
  /** Someone left, or the host did and this game is host now. */
  left(id) { this.world.left(id); }
  hosting() { this.world.hosting(); }

  /** The raft an event names — made, where it says, if it is the first piece of a new one. */
  raftFor(e) {
    let r = e.ri ? this.rafts.byId(e.ri) : this.raft;
    if (!r && e.ri && Array.isArray(e.pose)) { r = this.rafts.make(e.ri); r.setPose(e.pose); }
    return r;
  }

  hear(e, from) {
    if (!RAFT.has(e.k)) { this.world.hear(e, from); return; }
    const spit = (o, list) => this.game.setSpit(o, list);
    if (e.k === 'raft') {
      // The host's word; but a copy sent before your own change reached them
      // would undo it, so that one waits for the next.
      if (this.net.isHost || !Array.isArray(e.rs) || (!this.fresh && now() - this.edited < OWN)) return;
      const all = Array.isArray(e.all) ? e.all : null;
      this.adoptRafts(e.rs, spit, all);
      if (Array.isArray(e.st)) this.adoptStatues(e.st);
      if (e.wk) this.game.loadWakers(e.wk);
      // Sent in parts: aboard once the last is here, with every raft there is.
      if (this.fresh && (!all || e.rs[0]?.id === all.at(-1))) {
        this.fresh = false;
        const g = this.game, p = g.player;
        const on = g.rafts.under(p.pos.x, p.pos.z);
        if (on) g.setRaft(on);
        else if (p.state !== 'swim' && !p.onLand && g.raft.size) g.placeAmong(g.raft);
      }
    } else if (e.k === 'place' && e.t) {
      const ok = this.raftFor(e)?.place(e.id, e.t);
      if (ok && from !== undefined && BUILDABLE_BY_ID[e.id]) this.noteBuilt(from, BUILDABLE_BY_ID[e.id].name);
      // Hosting, and it would not go — someone got there first: whoever sent
      // it has paid for nothing, so the host hands back what it cost.
      if (!ok && this.net.isHost && from !== undefined && BUILDABLE_BY_ID[e.id]) {
        this.net.event({ k: 'refund', cost: BUILDABLE_BY_ID[e.id].cost, name: BUILDABLE_BY_ID[e.id].name }, from);
      }
    } else if (e.k === 'take' && Array.isArray(e.at)) {
      const r = this.raftFor(e);
      const piece = r?.pieceAt(...e.at);
      const got = piece && r.removePiece(piece, true);
      // Hosting: what came off is whoever took it apart's — the host's copy
      // says what that was — or, gone already, they are told who was quicker.
      // (Each paying themselves, two of you at one piece both had it.)
      if (this.net.isHost && from !== undefined && r) {
        if (got) {
          this.noteTaken(r, e.at, this.net.remotes.get(from)?.name);
          this.net.event({ k: 'grant', items: got, note: salvaged(piece.id) }, from);
        } else {
          const t = this.taken?.get(`${r.id}:${e.at.join(',')}`);
          const who = t && now() - t.at < 5 ? t.by : null;
          this.net.event({ k: 'grant', none: true, items: {}, note: `${who || 'Someone else'} took it apart first.` }, from);
        }
      }
    } else if (e.k === 'obj' && Array.isArray(e.o)) {
      const r = this.raftFor(e);
      r?.setObj(r.objs.get(`${e.o[0]},${e.o[1]}`), e.o, spit, from === this.net.host);
    } else if (e.k === 'hang' && typeof e.id === 'string') {
      const r = this.raftFor(e), o = r?.objs.get(`${e.cx},${e.cz}`), g = this.game;
      if (o?.type !== 'campfire' || !ITEMS[e.id] || !fishOf(e.id)) return;
      if (o.spitFish.length >= FIRE.spit) {
        // Full: the last place went to someone a moment ahead. Their fish back.
        if (this.net.isHost && from !== undefined) {
          this.net.event({ k: 'grant', items: { [e.id]: 1 }, note: `Someone was quicker to the last place on the spit — your ${ITEMS[e.id].name.toLowerCase()} is back.` }, from);
        }
        return;
      }
      g.hang(o, e.id);
      g.layoutSpit(o);
    } else if (e.k === 'feed') {
      const o = this.raftFor(e)?.objs.get(`${e.cx},${e.cz}`);
      if (o?.type !== 'campfire') return;
      o.fuel = Math.min(FIRE.max, o.fuel + FIRE.perWood);
    } else return;
    if (this.net.isHost && e.k !== 'raft') this.settle = SETTLE;
    this.afterChange();
  }

  /**
   * The host's rafts: each brought into line with its copy (made if it is
   * new here), and any it no longer has gone — though never the one you are
   * standing on until you are off it.
   */
  adoptRafts(list, spit, all = null) {
    const g = this.game;
    // (One raft of several, sent apart: `all` says which there are.)
    const want = new Set(all ? all.filter(id => typeof id === 'string') : []);
    for (const snap of list) {
      if (!snap?.id) continue;
      want.add(snap.id);
      const r = g.rafts.byId(snap.id) || g.rafts.make(snap.id);
      if (!r.size && Array.isArray(snap.pose)) r.setPose(snap.pose);
      r.adopt(snap, spit);
      if (Array.isArray(snap.pose)) r.steer(snap.pose);
    }
    for (const r of [...g.rafts.list]) {
      if (want.has(r.id)) continue;
      // One you have just built is not gone: the host has not heard of it yet.
      // Nor is an empty one — where your first foundation will go: that is
      // yours alone till you lay it.
      if (!r.size || now() - (this.built.get(r.id) ?? -Infinity) < 6) continue;
      if (r === g.raft) {
        // Yours goes too, if it is only the stand-in; you are with a real one then.
        const next = g.rafts.list.find(x => want.has(x.id));
        if (!next) continue;
        g.setRaft(next);
      }
      g.rafts.drop(r);
    }
  }

  /**
   * Someone else built something: gathered up and said once they stop for a
   * moment — "Ben built 3 Foundations and a Wall" — rather than line by line.
   */
  noteBuilt(from, name) {
    const who = this.net.remotes.get(from)?.name;
    if (!who) return;
    const b = (this.builds ||= new Map()).get(from) || { who, counts: new Map(), quiet: 0 };
    b.counts.set(name, (b.counts.get(name) || 0) + 1);
    b.quiet = 2.5;
    this.builds.set(from, b);
  }

  flushBuilt(dt) {
    for (const [from, b] of this.builds || []) {
      if ((b.quiet -= dt) > 0) continue;
      this.builds.delete(from);
      const parts = [...b.counts].map(([n, k]) => (k === 1 ? `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}` : `${k} ${n}s`));
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
      this.game.hud.log(`${b.who} built ${list}.`);
    }
  }

  /** The raft changed under you: nothing may point at a piece that is gone. */
  afterChange() {
    const g = this.game;
    g.build.ghostSig = '';
    if (g.drill && ![...this.raft.objs.values()].includes(g.drill.rec)) g.drill = null;
    g.hud.refreshInventory(g.inv);
  }

  /** The host's statues: those it has that are missing go up; those it lacks come down. */
  adoptStatues(list) {
    const st = this.game.statues;
    const want = new Set(list.map(s => s[0]));
    for (const s of [...st.list]) if (!want.has(s.id)) st.remove(s.id);
    for (const [id, x, z, yaw] of list) if (id && !st.find(id)) st.add({ id, x, z, yaw });
    this.game.markMine();
  }

  // ── each frame ─────────────────────────────────────────────────────────────
  update(dt) {
    this.world.update(dt);
    this.flushBuilt(dt);
    if (!this.net.isHost || !this.net.remotes.size) return;
    this.every -= dt;
    if (this.settle !== null) this.settle -= dt;
    if (this.every <= 0 || (this.settle !== null && this.settle <= 0)) {
      this.sendRafts();
      this.settle = null;
      this.every = EVERY;
    }
  }
}
