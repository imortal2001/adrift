// ── The rafts, shared ────────────────────────────────────────────────────────
// Playing together (net.js), everyone is in the room's world — kept on the
// relay between visits (main.js enterRoom) — with its rafts: any number of
// them, and anyone can board, build on and paddle any. Your own world waits
// at home. What each of you pays for and takes away is your own — building
// costs your planks, whatever you salvage is yours, whoever built it, and
// cooked fish go in the bag of whoever takes them off the fire. Two of you at one thing at once (the same spot
// to build on, the same crate, the same fish on a fire) is the host's to
// settle: one gets it, and the other is told (or paid back).
//
// Every change goes to the others as it happens, naming its raft: a piece
// built (the first of a new raft carries where that raft is), a piece taken
// away, and the state of a deck object (a collector drunk from, a fire fed,
// lit, or given a fish to cook, a sail raised). Each copy applies it to its
// own raft of that name. The host's rafts are the ones that count: shortly
// after any change, and now and then regardless, the host sends them whole,
// and the others bring theirs into line — settling two people building on
// one spot at once, and fires burning down at slightly different rates.

import { Raft } from './raft.js';
import { BUILDABLE_BY_ID } from './items.js';
import { SharedWorld, WORLD_EVENTS } from './sharedworld.js';

const SETTLE = 1.5;     // the host sends the rafts this long after a change…
const EVERY = 20;       // …and this often regardless
const OWN = 1.2;        // a copy arriving this soon after your own change is already out of date

/** Events that change the world rather than a player: they come here, not to a Remote. */
const RAFT = new Set(['raft', 'place', 'take', 'obj']);
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
  took(piece) { this.send({ k: 'take', ri: this.raft.id, at: Raft.where(piece) }); }
  touched(o, r = this.raft) { this.send({ k: 'obj', ri: r.id, o: r.objState(o) }); }

  send(e) {
    if (!this.net.connected) return;
    this.net.event(e);
    this.edited = now();
    if (this.net.isHost) this.settle = SETTLE;
  }

  /** Every raft there is, whole, for the others. */
  snapshot() {
    return this.rafts.list.filter(r => r.size).map(r => ({ id: r.id, ...r.snapshot() }));
  }

  // ── coming and going ───────────────────────────────────────────────────────
  /** You are in a game: its world, as the room kept it (main.js). Hosting, it is yours to run. */
  enter(host, stored) {
    this.world.enter(host);
    this.game.enterRoom(this.net.code, stored || {}, host);
    // A guest's copy waits for the host's live one.
    this.fresh = !host;
  }

  /** Someone arrived: the host hands them the rafts. */
  joined(id) {
    if (this.net.isHost) this.net.event({ k: 'raft', rs: this.snapshot(), st: this.game.statues.toJSON(), wk: this.game.wakersJSON() }, id);
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
      this.adoptRafts(e.rs, spit);
      if (Array.isArray(e.st)) this.adoptStatues(e.st);
      if (e.wk) this.game.loadWakers(e.wk);
      if (this.fresh) {
        this.fresh = false;
        const g = this.game, p = g.player;
        const on = g.rafts.under(p.pos.x, p.pos.z);
        if (on) g.setRaft(on);
        else if (p.state !== 'swim' && !p.onLand && g.raft.size) p.respawnOnRaft();
      }
    } else if (e.k === 'place' && e.t) {
      const ok = this.raftFor(e)?.place(e.id, e.t);
      // Hosting, and it would not go — someone got there first: whoever sent
      // it has paid for nothing, so the host hands back what it cost.
      if (!ok && this.net.isHost && from !== undefined && BUILDABLE_BY_ID[e.id]) {
        this.net.event({ k: 'refund', cost: BUILDABLE_BY_ID[e.id].cost, name: BUILDABLE_BY_ID[e.id].name }, from);
      }
    } else if (e.k === 'take' && Array.isArray(e.at)) {
      const r = this.raftFor(e);
      const piece = r?.pieceAt(...e.at);
      if (piece) r.removePiece(piece, true);
    } else if (e.k === 'obj' && Array.isArray(e.o)) {
      const r = this.raftFor(e);
      r?.setObj(r.objs.get(`${e.o[0]},${e.o[1]}`), e.o, spit);
    } else return;
    if (this.net.isHost && e.k !== 'raft') this.settle = SETTLE;
    this.afterChange();
  }

  /**
   * The host's rafts: each brought into line with its copy (made if it is
   * new here), and any it no longer has gone — though never the one you are
   * standing on until you are off it.
   */
  adoptRafts(list, spit) {
    const g = this.game;
    const want = new Set();
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
    if (!this.net.isHost || !this.net.remotes.size) return;
    this.every -= dt;
    if (this.settle !== null) this.settle -= dt;
    if (this.every <= 0 || (this.settle !== null && this.settle <= 0)) {
      this.net.event({ k: 'raft', rs: this.snapshot(), st: this.game.statues.toJSON(), wk: this.game.wakersJSON() });
      this.settle = null;
      this.every = EVERY;
    }
  }
}
