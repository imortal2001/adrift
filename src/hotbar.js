// ── Hotbar ───────────────────────────────────────────────────────────────────
// Five slots you register items into. The selected slot is what your hands are
// holding, and that is what clicking uses — so "which tool am I using" is one
// piece of state instead of a key per tool.
//
// A registration is deliberately independent of whether you currently own the
// item: eat your last coconut and the slot stays bound, greyed out, ready for
// the next one.

import { ITEMS, isUsable } from './items.js';

export const SLOTS = 5;

export class Hotbar {
  constructor() {
    this.slots = new Array(SLOTS).fill(null);
    this.selected = 0;
  }

  /** The item id in hand, or null for bare hands. */
  get held() { return this.slots[this.selected]; }

  /** The action of the held item, if it has one and you actually own it. */
  heldAction(inv) {
    const id = this.held;
    if (!id || !inv.has(id)) return null;
    return ITEMS[id].action || null;
  }

  select(i) {
    if (i < 0 || i >= SLOTS) return false;
    const changed = i !== this.selected;
    this.selected = i;
    return changed;
  }

  cycle(dir) {
    return this.select((this.selected + dir + SLOTS) % SLOTS);
  }

  /** Put an item in a slot, moving it out of any slot it already occupied. */
  assign(i, id) {
    if (i < 0 || i >= SLOTS || !ITEMS[id]) return false;
    const existing = this.slots.indexOf(id);
    if (existing === i) return false;
    if (existing !== -1) this.slots[existing] = this.slots[i];   // swap, don't duplicate
    this.slots[i] = id;
    return true;
  }

  clear(i) {
    if (i < 0 || i >= SLOTS || this.slots[i] === null) return false;
    this.slots[i] = null;
    return true;
  }

  has(id) { return this.slots.includes(id); }

  /**
   * Called when something is acquired. Only usable items claim a slot on their
   * own — otherwise the bar fills with driftwood the moment you start playing.
   * @returns the slot index it landed in, or -1
   */
  autoAssign(id) {
    if (!isUsable(id) || this.has(id)) return -1;
    const free = this.slots.indexOf(null);
    if (free === -1) return -1;
    this.slots[free] = id;
    return free;
  }

  /** Point the selection at an item already in the bar. */
  selectItem(id) {
    const i = this.slots.indexOf(id);
    if (i === -1) return false;
    this.selected = i;
    return true;
  }

  toJSON() { return { slots: this.slots, selected: this.selected }; }

  static fromJSON(o) {
    const h = new Hotbar();
    if (!o) return h;
    const src = Array.isArray(o.slots) ? o.slots : [];
    for (let i = 0; i < SLOTS; i++) {
      const id = src[i];
      h.slots[i] = ITEMS[id] ? id : null;      // drop anything unrecognised
    }
    h.selected = Number.isInteger(o.selected) && o.selected >= 0 && o.selected < SLOTS
      ? o.selected : 0;
    return h;
  }
}
