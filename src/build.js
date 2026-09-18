// ── Build mode ───────────────────────────────────────────────────────────────
// Picks a buildable, shows a translucent ghost snapped to the raft grid, and
// places it when the cost is met. The ghost lives inside the raft group so it
// rides the waves with the deck.

import * as THREE from 'three';
import { BUILDABLES, BUILDABLE_BY_ID } from './items.js';

const REACH = 7.5;

export class BuildMode {
  constructor(raft, inv, hud) {
    this.raft = raft;
    this.inv = inv;
    this.hud = hud;
    this.active = false;
    this.index = 0;
    this.ghost = null;
    this.ghostSig = '';
    this.target = null;
    this.valid = false;
  }

  get piece() { return BUILDABLES[this.index]; }

  toggle(on = !this.active) {
    this.active = on;
    if (!on) this.clearGhost();
    this.hud.setBuildBar(on, this.index, this.inv);
    return this.active;
  }

  clearGhost() {
    if (this.ghost) {
      this.raft.group.remove(this.ghost);
      this.ghost.userData.ghostMat?.dispose();
      this.ghost = null;
      this.ghostSig = '';
    }
  }

  select(i) {
    this.index = (i + BUILDABLES.length) % BUILDABLES.length;
    this.clearGhost();
    this.hud.setBuildBar(this.active, this.index, this.inv);
  }

  /** Called every frame while build mode is on. Returns a prompt string. */
  update(origin, dir, input) {
    // The number keys belong to the hotbar now.
    if (input.wheel) this.select(this.index + input.wheel);
    if (input.pressed('BracketLeft')) this.select(this.index - 1);
    if (input.pressed('BracketRight')) this.select(this.index + 1);
    this.hud.setBuildBar(true, this.index, this.inv);

    const t = this.raft.targetFromRay(origin, dir);
    this.target = (t && t.dist <= REACH) ? t : null;
    const id = this.piece.id;

    if (!this.target) {
      this.clearGhost();
      this.valid = false;
      return 'Look at the deck to build';
    }

    const fits = this.raft.canPlace(id, this.target);
    const afford = this.inv.canAfford(this.piece.cost);
    this.valid = fits && afford;

    // Rebuild the ghost only when the snap position actually changes.
    const sig = `${id}|${this.target.cx},${this.target.cz},${this.target.ex},${this.target.ez},${this.target.es}`;
    if (sig !== this.ghostSig) {
      this.clearGhost();
      this.ghost = this.raft.makeGhost(id, this.target);
      this.raft.group.add(this.ghost);
      this.ghostSig = sig;
    }
    if (this.ghost) {
      this.ghost.userData.ghostMat.color.setHex(this.valid ? 0x8fe3ff : 0xff6a5c);
      this.ghost.userData.ghostMat.opacity = this.valid ? 0.42 : 0.3;
    }

    if (!fits) return `${this.piece.name} won't fit there`;
    if (!afford) return `Need ${this.inv.costText(this.piece.cost).replace(/<\/?s>/g, '')}`;
    return `<b>Click</b> place ${this.piece.name}`;
  }

  place() {
    if (!this.valid || !this.target) return null;
    if (!this.inv.has('hammer')) return null;    // enforced here, not just at the B key
    const p = this.piece;
    if (!this.inv.pay(p.cost)) return null;
    if (!this.raft.place(p.id, this.target)) {
      this.inv.refund(p.cost);
      return null;
    }
    this.ghostSig = '';     // force the ghost to re-evaluate against the new state
    return p;
  }

  /** Salvage whatever piece the ray hits. Works in or out of build mode. */
  salvage(raycaster) {
    const hits = raycaster.intersectObjects(this.raft.pickables, false);
    if (!hits.length || hits[0].distance > REACH) return null;
    const piece = hits[0].object.userData.piece;
    if (!piece) return null;
    if (piece.kind === 'cell' && !this.raft.cellRemovable(piece.rec.cx, piece.rec.cz)) {
      return { blocked: 'That foundation is holding the rest of the raft together' };
    }
    const refund = this.raft.removePiece(piece);
    if (!refund) return { blocked: 'That piece cannot come out' };
    this.inv.refund(refund);
    this.clearGhost();
    return { name: BUILDABLE_BY_ID[piece.id].name, refund };
  }
}
