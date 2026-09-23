// ── Items, recipes, buildables ───────────────────────────────────────────────
// All game data lives here so the loop can be re-tuned without touching logic.

// `action` is what happens when the item is in your hand and you click. Items
// without one are raw material: they can still be put in a hotbar slot, they
// just do nothing when held.
export const ITEMS = {
  wood:    { name: 'Wood',    tool: false },
  plank:   { name: 'Plank',   tool: false },
  rope:    { name: 'Rope',    tool: false },
  leaf:    { name: 'Palm',    tool: false },
  scrap:   { name: 'Scrap',   tool: false },
  coconut: { name: 'Coconut', tool: false, action: 'eat',
             hint: 'Click to eat' },
  fish:    { name: 'Raw fish', tool: false, action: 'eat',
             hint: 'Click to eat — raw, so it does less for you than it could' },

  hammer:  { name: 'Hammer',  tool: true, action: 'build',
             hint: 'Held out to build — wheel or [ ] picks the piece' },
  hook:    { name: 'Hook',    tool: true, action: 'hook',
             hint: 'Click to throw it at debris out of reach' },
  spear:   { name: 'Spear',   tool: true, action: 'spear',
             hint: 'Right-click to throw it — then E to pull it back out' },
  rod:     { name: 'Rod',     tool: true, action: 'rod',
             hint: 'Click to cast — click again the moment the float goes under. Right-click baits the hook with a fish' },
};

// What eating each food does. Raw fish fills you up but is salty, so it costs
// a little water; cooking it is the obvious next step once the campfire does
// something.
export const FOOD = {
  coconut: { hunger: 26, thirst: 11,  text: 'You crack the coconut open. Milk and flesh.' },
  fish:    { hunger: 22, thirst: -3,  text: 'You eat the fish raw. Salty, but it keeps you going.' },
};

/** Items worth a hotbar slot: the ones that actually do something in hand. */
export const isUsable = id => !!(ITEMS[id] && ITEMS[id].action);

export const RECIPES = [
  { id: 'plank',  out: ['plank', 1],  cost: { wood: 2 },
    desc: 'Split a log into flat deck stock.' },
  { id: 'rope',   out: ['rope', 1],   cost: { leaf: 3 },
    desc: 'Twist palm fibre into cord.' },
  { id: 'hammer', out: ['hammer', 1], cost: { plank: 2, rope: 1 },
    desc: 'Needed for every piece of construction.' },
  { id: 'hook',   out: ['hook', 1],   cost: { plank: 1, rope: 2, scrap: 1 },
    desc: 'Right-click to throw and reel in distant debris.' },
  { id: 'spear',  out: ['spear', 1],  cost: { plank: 2, rope: 1, scrap: 1 },
    desc: 'For spearfishing once you dare leave the raft.' },
  { id: 'rod',    out: ['rod', 1],    cost: { plank: 2, rope: 2 },
    desc: 'Cast a line from the deck.' },
];

// kind: how the piece attaches to the raft grid.
//   'cell'   → fills an empty grid cell that touches the existing raft
//   'edge'   → one of the four sides of an existing cell
//   'top'    → the roof slot above an existing cell
//   'object' → the middle of an existing cell
export const BUILDABLES = [
  { id: 'foundation', name: 'Foundation', kind: 'cell',   cost: { plank: 2 },
    desc: 'Extend the deck by one 2m square.' },
  { id: 'railing',    name: 'Railing',    kind: 'edge',   cost: { plank: 1 },
    desc: 'Waist-high. Stops you walking into the sea.' },
  { id: 'wall',       name: 'Wall',       kind: 'edge',   cost: { plank: 2 },
    desc: 'Full height. Three walls plus a roof make shelter.' },
  { id: 'roof',       name: 'Roof',       kind: 'top',    cost: { plank: 3 },
    desc: 'Cover overhead. Required for shelter.' },
  { id: 'collector',  name: 'Collector',  kind: 'object', cost: { plank: 2, rope: 2 },
    desc: 'Catches rain and dew. Use it to drink.' },
  { id: 'campfire',   name: 'Campfire',   kind: 'object', cost: { wood: 3, scrap: 1 },
    desc: 'Light through the night. Cooking comes later.' },
];

export const BUILDABLE_BY_ID = Object.fromEntries(BUILDABLES.map(b => [b.id, b]));

/** What each kind of flotsam gives up when gathered. */
export const DEBRIS_KINDS = {
  log:     { label: 'Driftwood', yield: { wood: 2 },            weight: 30 },
  flotsam: { label: 'Flotsam',   yield: { plank: 1, wood: 1 },  weight: 14 },
  palm:    { label: 'Palm frond',yield: { leaf: 2 },            weight: 24 },
  barrel:  { label: 'Barrel',    yield: { scrap: 2 },           weight: 13 },
  crate:   { label: 'Crate',     yield: { plank: 2, scrap: 1 }, weight: 9  },
  coconut: { label: 'Coconut',   yield: { coconut: 1 },         weight: 10 },
};

export class Inventory {
  constructor() { this.slots = new Map(); }

  count(id) { return this.slots.get(id) || 0; }
  has(id, n = 1) { return this.count(id) >= n; }

  add(id, n = 1) {
    this.slots.set(id, this.count(id) + n);
    return n;
  }

  remove(id, n = 1) {
    const have = this.count(id);
    if (have < n) return false;
    if (have === n) this.slots.delete(id); else this.slots.set(id, have - n);
    return true;
  }

  canAfford(cost) {
    for (const id in cost) if (!this.has(id, cost[id])) return false;
    return true;
  }

  pay(cost) {
    if (!this.canAfford(cost)) return false;
    for (const id in cost) this.remove(id, cost[id]);
    return true;
  }

  refund(cost, ratio = 1) {
    for (const id in cost) {
      const n = Math.floor(cost[id] * ratio);
      if (n > 0) this.add(id, n);
    }
  }

  /** "2 Plank, 1 Rope" — with the missing parts marked up for the UI. */
  costText(cost) {
    return Object.keys(cost).map(id => {
      const need = cost[id], ok = this.has(id, need);
      const txt = `${need} ${ITEMS[id].name}`;
      return ok ? txt : `<s>${txt} (${this.count(id)})</s>`;
    }).join(', ');
  }

  toJSON() { return Object.fromEntries(this.slots); }
  static fromJSON(o) {
    const inv = new Inventory();
    for (const k in o) if (ITEMS[k]) inv.slots.set(k, o[k]);
    return inv;
  }
}
