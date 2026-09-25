// ── The raft, shared ─────────────────────────────────────────────────────────
// Playing together (net.js), everyone is on one raft: the host's. Joining,
// your own raft is put by and the host's takes its place; leaving, yours
// comes back as you left it. What each of you pays for and takes away is
// your own — building costs your planks, salvaging refunds you, cooked fish
// go in the bag of whoever takes them off the fire.
//
// Every change goes to the others as it happens: a piece built, a piece
// taken away, and the state of a deck object (a collector drunk from, a fire
// fed, lit, or given a fish to cook). Each copy applies it to its own raft.
// The host's raft is the one that counts: shortly after any change, and now
// and then regardless, the host sends it whole, and the others bring theirs
// into line with it — settling two people building on one spot at once, and
// the slow drift of fires burning down and collectors filling on each machine.

import { Raft } from './raft.js';
import { SharedWorld, WORLD_EVENTS } from './sharedworld.js';

const SETTLE = 1.5;     // the host sends the raft this long after a change…
const EVERY = 20;       // …and this often regardless
const OWN = 1.2;        // a copy arriving this soon after your own change is already out of date

/** Events that change the world rather than a player: they come here, not to a Remote. */
const RAFT = new Set(['raft', 'place', 'take', 'obj']);
export const WORLD = new Set([...RAFT, ...WORLD_EVENTS]);

const now = () => performance.now() / 1000;

export class Together {
  constructor(game) {
    this.game = game;
    this.own = null;            // your raft (toJSON), put by while you are on someone else's
    this.fresh = false;         // the host's raft has not arrived yet
    this.settle = null;         // seconds until the host sends the raft, after a change
    this.every = EVERY;
    this.edited = -Infinity;
    this.world = new SharedWorld(game);   // the rest of it: the sky, the sea, what lives there
  }

  get net() { return this.game.net; }
  get raft() { return this.game.raft; }
  /** On someone else's raft, with your own put by. */
  get guest() { return !!this.own; }

  // ── what you do ────────────────────────────────────────────────────────────
  placed(id, t) {
    this.send({ k: 'place', id, t: { cx: t.cx, cz: t.cz, ex: t.ex, ez: t.ez, es: t.es } });
  }
  took(piece) { this.send({ k: 'take', at: Raft.where(piece) }); }
  touched(o) { this.send({ k: 'obj', o: this.raft.objState(o) }); }

  send(e) {
    if (!this.net.connected) return;
    this.net.event(e);
    this.edited = now();
    if (this.net.isHost) this.settle = SETTLE;
  }

  // ── coming and going ───────────────────────────────────────────────────────
  /** You are in a game. Hosting, the raft is yours already. */
  enter(host) {
    this.world.enter(host);
    if (host || this.own) return;
    // Fish on your own fires go in the bag first; your raft waits without them.
    this.game.pocketSpit();
    this.own = this.raft.toJSON();
    this.fresh = true;
  }

  /** Someone arrived: the host hands them the raft. */
  joined(id) {
    if (this.net.isHost) this.net.event({ k: 'raft', r: this.raft.snapshot() }, id);
  }

  /** Out of the game, however that happened: back to your own raft. */
  exit() {
    this.world.exit();
    if (!this.own) return;
    const g = this.game;
    g.clearSpits();
    this.raft.clear();
    this.raft.load(this.own);
    this.own = null;
    this.fresh = false;
    this.afterChange();
    if (g.player.state !== 'swim') g.player.respawnOnRaft();
    g.hud.log('You are back on your own raft.');
  }

  // ── what the others do ─────────────────────────────────────────────────────
  /** Someone left, or the host did and this game is host now. */
  left(id) { this.world.left(id); }
  hosting() { this.world.hosting(); }

  hear(e, from) {
    if (!RAFT.has(e.k)) { this.world.hear(e, from); return; }
    const spit = (o, list) => this.game.setSpit(o, list);
    if (e.k === 'raft') {
      // The host's word; but a copy sent before your own change reached them
      // would undo it, so that one waits for the next.
      if (this.net.isHost || !e.r || (!this.fresh && now() - this.edited < OWN)) return;
      this.raft.adopt(e.r, spit);
      if (this.fresh) {
        this.fresh = false;
        const p = this.game.player;
        if (p.state !== 'swim' && !p.onLand && !this.raft.solidAtWorld(p.pos.x, p.pos.z)) p.respawnOnRaft();
      }
    } else if (e.k === 'place' && e.t) {
      this.raft.place(e.id, e.t);
    } else if (e.k === 'take' && Array.isArray(e.at)) {
      const piece = this.raft.pieceAt(...e.at);
      if (piece) this.raft.removePiece(piece, true);
    } else if (e.k === 'obj' && Array.isArray(e.o)) {
      this.raft.setObj(this.raft.objs.get(`${e.o[0]},${e.o[1]}`), e.o, spit);
    } else return;
    if (this.net.isHost && e.k !== 'raft') this.settle = SETTLE;
    this.afterChange();
  }

  /** The raft changed under you: nothing may point at a piece that is gone. */
  afterChange() {
    const g = this.game;
    g.build.ghostSig = '';
    if (g.drill && ![...this.raft.objs.values()].includes(g.drill.rec)) g.drill = null;
    g.hud.refreshInventory(g.inv);
  }

  // ── each frame ─────────────────────────────────────────────────────────────
  update(dt) {
    this.world.update(dt);
    if (!this.net.isHost || !this.net.remotes.size) return;
    this.every -= dt;
    if (this.settle !== null) this.settle -= dt;
    if (this.every <= 0 || (this.settle !== null && this.settle <= 0)) {
      this.net.event({ k: 'raft', r: this.raft.snapshot() });
      this.settle = null;
      this.every = EVERY;
    }
  }
}
