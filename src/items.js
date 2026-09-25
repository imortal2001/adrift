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
  // Hollow and sealed at every joint: it floats better than any timber.
  bamboo:  { name: 'Bamboo',  tool: false },
  scrap:   { name: 'Scrap',   tool: false },
  // Chipped from the walls of the caves, deep in, where it is dark: nowhere else has it.
  flint:   { name: 'Flint',   tool: false },
  // A stick bound with palm fibre. Not a tool — you can carry several; each
  // burns for TORCH.burn seconds once it is lit.
  torch:   { name: 'Torch',   tool: false, action: 'torch',
             hint: 'Light it at a burning campfire (E) — or anywhere, click, with a fire striker in your pack. Water puts it out' },
  // Flint struck on scrap iron: sparks, and a fire at once.
  striker: { name: 'Fire striker', short: 'Striker', tool: true, action: 'strike',
             hint: 'At an unlit campfire, E to strike a spark into the tinder (1 Palm). With it in your pack, a torch lights anywhere' },
  coconut: { name: 'Coconut', tool: false, action: 'eat',
             hint: 'Click to eat' },

  hammer:  { name: 'Hammer',  tool: true, action: 'build',
             hint: 'Held out to build — wheel or [ ] picks the piece' },
  hook:    { name: 'Hook',    tool: true, action: 'hook',
             hint: 'Click to throw it at debris out of reach' },
  spear:   { name: 'Spear',   tool: true, action: 'spear',
             hint: 'Right-click to throw it — then E to pull it back out' },
  rod:     { name: 'Rod',     tool: true, action: 'rod',
             hint: 'Click to cast — click again the moment the float goes under. Right-click baits the hook with a fish' },
  // Carved from driftwood, set up on land: where you wake if you die.
  statue:  { name: 'Statue',  tool: false, action: 'place',
             hint: 'Click to set it up on land — then E at it, and it is where you wake if you die' },
  // A blade on a pole: the raft goes where you paddle it.
  paddle:  { name: 'Paddle',  tool: true, action: 'paddle',
             hint: 'On the deck: hold click to paddle, right-click to back-paddle. Paddle at one side to turn' },
  // A bow with its cord round a spindle: sawing the bow spins the spindle in
  // a notch in a board, and the friction makes an ember. The oldest way to
  // make fire from what floats past a raft — wood and cord.
  bowdrill: { name: 'Bow drill', tool: true, action: 'drill',
             hint: 'Hold click at an unlit campfire to drill an ember — it takes 1 Palm for tinder' },
};

// A campfire, in seconds of burning. It is built with its first wood laid,
// then has to be lit; it burns down and goes out, and takes more wood.
export const FIRE = {
  laid: 300,          // the 3 Wood it is built with
  perWood: 120,       // each Wood fed to it
  max: 600,           // as much as it will hold
  light: 5,           // seconds of sawing the bow drill to raise an ember
  cook: 14,           // seconds on the spit until a fish is done
  spit: 3,            // fish it can cook at once
};

// A torch: how long one burns, lit. Put away or wet, it goes out — and
// keeps what it had left for when it is lit again.
export const TORCH = {
  burn: 240,
};

// Every fish you can catch is an item of its own, so what you caught is what
// you carry: a red snapper stays a red snapper in the pack, in the hotbar and
// in your hand, rather than all going into one sack of "raw fish". The names
// are the species' in src/fish.js (kept here so the item table does not pull
// in the renderer). All of them eat the same, as FOOD.fish. Smallest first,
// which is the order bait is picked in. A third name, where the full one is
// too long for a hotbar slot, is what the slot shows.
// The crab and the octopus are catches too (src/reeflife.js): a crab by
// hand, an octopus on the spear; they go in the fish slot and cook the same.
export const CATCHES = [
  ['crab', 'Crab'],
  ['chromis', 'Chromis'], ['silver', 'Silverside'], ['wrasse', 'Wrasse'],
  ['tang', 'Yellow tang', 'Tang'], ['bluetang', 'Blue tang'], ['flounder', 'Flounder'],
  ['porgy', 'Porgy'], ['octopus', 'Octopus'], ['snapper', 'Red snapper', 'Snapper'], ['mackerel', 'Mackerel'],
  ['grouper', 'Grouper'], ['barracuda', 'Barracuda'], ['mahi', 'Mahi-mahi'],
  ['tuna', 'Yellowfin tuna', 'Tuna'], ['blacktip', 'Blacktip shark', 'Blacktip'],
];

/** The item a caught fish of this species becomes. */
export const fishItem = key => `fish_${key}`;
/** The species of a fish item, or null for anything else. */
export const fishOf = id => ITEMS[id]?.fish ?? null;

/** The item a fish of this species becomes, cooked. */
export const cookedItem = key => `cooked_${key}`;
/** Whether an item is a cooked fish. */
export const isCooked = id => !!ITEMS[id]?.cooked;

for (const [key, name, short] of CATCHES) {
  ITEMS[fishItem(key)] = { name, short, tool: false, action: 'eat', fish: key,
    hint: 'Click to eat — raw, so it does less for you than it could. Cook it at a lit campfire' };
  // Cooked, it keeps its species: a cooked red snapper, not "cooked fish".
  ITEMS[cookedItem(key)] = { name: `Cooked ${name.toLowerCase()}`, short: short || name, tool: false,
    action: 'eat', fish: key, cooked: true, hint: 'Click to eat — hot off the fire' };
}

/** What eating an item does, fish by fish or otherwise. */
export const foodOf = id => FOOD[id] ?? (isCooked(id) ? FOOD.cooked : fishOf(id) ? FOOD.fish : null);

// What eating each food does. Raw fish fills you up but is salty, so it costs
// a little water; cooked, it goes further and costs none.
export const FOOD = {
  coconut: { hunger: 26, thirst: 11,  text: 'You crack the coconut open. Milk and flesh.' },
  fish:    { hunger: 22, thirst: -3,  text: 'You eat the fish raw. Salty, but it keeps you going.' },
  cooked:  { hunger: 36, thirst: 0,   text: 'Hot fish off the fire. That is a meal.' },
  // The same, in their own words.
  fish_crab:       { hunger: 22, thirst: -3, text: 'You crack the crab open and eat it raw. Sweet, and salty.' },
  cooked_crab:     { hunger: 36, thirst: 0,  text: 'You crack the shell and pick out the hot, sweet meat.' },
  fish_octopus:    { hunger: 22, thirst: -3, text: 'You chew your way through raw octopus. It keeps you going.' },
  cooked_octopus:  { hunger: 36, thirst: 0,  text: 'Octopus off the fire, charred at the tips. A good meal.' },
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
  { id: 'bowdrill', out: ['bowdrill', 1], cost: { plank: 1, rope: 1 },
    desc: 'Friction fire: saw the bow at a campfire to light it.' },
  { id: 'paddle', out: ['paddle', 1], cost: { plank: 2, rope: 1 },
    desc: 'Move the raft. Stroke at one side to turn it the other way.' },
  { id: 'statue', out: ['statue', 1], cost: { wood: 6, rope: 2, leaf: 3 },
    desc: 'Set it up on land and register at it (E): if you die, you wake beside it.' },
  { id: 'torch',  out: ['torch', 1],  cost: { wood: 1, leaf: 2 },
    desc: 'A stick bound with palm fibre. Lit at a fire, it lights the dark — the caves — for four minutes.' },
  { id: 'striker', out: ['striker', 1], cost: { flint: 1, scrap: 1 },
    desc: 'Cave flint struck on scrap iron: sparks. Lights a campfire at once, and a torch anywhere.' },
];

// kind: how the piece attaches to the raft grid.
//   'cell'   → fills an empty grid cell that touches the existing raft
//   'edge'   → one of the four sides of an existing cell
//   'top'    → the roof slot above an existing cell
//   'object' → the middle of an existing cell
export const BUILDABLES = [
  // Four ways to make a 2m square of raft, from whatever there is — they
  // look like what they are made of; they float and handle the same.
  { id: 'foundation', name: 'Foundation', kind: 'cell',   cost: { plank: 2 },
    desc: 'Extend the deck by one 2m square: planks over three float logs.' },
  { id: 'bamboo_floor', name: 'Bamboo foundation', kind: 'cell', cost: { bamboo: 4, rope: 1 },
    desc: 'A 2m square of bamboo poles lashed side by side, cross-poles on top.' },
  { id: 'log_floor',  name: 'Log foundation', kind: 'cell', cost: { wood: 4, rope: 1 },
    desc: 'A 2m square of driftwood and palm trunks, lashed together.' },
  { id: 'barrel_floor', name: 'Barrel foundation', kind: 'cell', cost: { scrap: 2, plank: 1 },
    desc: 'A 2m square of plank deck lashed down onto two barrels.' },
  { id: 'railing',    name: 'Railing',    kind: 'edge',   cost: { plank: 1 },
    desc: 'Waist-high. Stops you walking into the sea.' },
  { id: 'wall',       name: 'Wall',       kind: 'edge',   cost: { plank: 2 },
    desc: 'Full height. Three walls plus a roof make shelter.' },
  { id: 'roof',       name: 'Roof',       kind: 'top',    cost: { plank: 3 },
    desc: 'Cover overhead. Required for shelter.' },
  { id: 'collector',  name: 'Collector',  kind: 'object', cost: { plank: 2, rope: 2 },
    desc: 'Catches rain and dew. Use it to drink.' },
  { id: 'campfire',   name: 'Campfire',   kind: 'object', cost: { wood: 3, scrap: 1 },
    desc: 'Built unlit. Light it with a bow drill, feed it wood, cook fish on it.' },
  { id: 'sail',       name: 'Sail',       kind: 'object', cost: { plank: 4, rope: 3, leaf: 6 },
    desc: 'A mast and a palm-weave sail. E raises it: the wind takes the raft; paddle to steer.' },
];

export const BUILDABLE_BY_ID = Object.fromEntries(BUILDABLES.map(b => [b.id, b]));
// Not on the build bar: a statue goes on the deck from your hands (main.js
// placeStatue), and it comes back to your hands — its "cost" is itself.
BUILDABLE_BY_ID.statue = { id: 'statue', name: 'Statue', kind: 'object', cost: { statue: 1 },
                           desc: 'Set up on the deck, it sails with the raft; register at it to wake aboard.' };

/** What each kind of flotsam gives up when gathered. */
export const DEBRIS_KINDS = {
  log:     { label: 'Driftwood', yield: { wood: 2 },            weight: 30 },
  flotsam: { label: 'Flotsam',   yield: { plank: 1, wood: 1 },  weight: 14 },
  palm:    { label: 'Palm frond',yield: { leaf: 2 },            weight: 24 },
  barrel:  { label: 'Barrel',    yield: { scrap: 2 },           weight: 13 },
  bamboo:  { label: 'Bamboo',    yield: { bamboo: 2 },          weight: 12 },
  crate:   { label: 'Crate',     yield: { plank: 2, scrap: 1 }, weight: 9  },
  coconut: { label: 'Coconut',   yield: { coconut: 1 },         weight: 10 },
};

// What an unrecorded old catch most likely was: the small fish, weighted by
// how many of each swim round the raft (schools × fish per school, fish.js).
const LEGACY_CATCH = [['chromis', 72], ['silver', 48], ['tang', 26], ['wrasse', 18],
  ['bluetang', 10], ['snapper', 12], ['mackerel', 10], ['porgy', 4], ['flounder', 3]];
const LEGACY_TOTAL = LEGACY_CATCH.reduce((n, [, w]) => n + w, 0);

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
    // Saves from before fish were told apart carry one count of "fish". They
    // were real catches, only never written down, so they come back as the
    // hand-sized fish a spear or a bare hook takes, in about the proportions
    // those are about the reef.
    const old = Math.floor(o?.fish || 0);
    for (let i = 0; i < old; i++) {
      let r = Math.random() * LEGACY_TOTAL;
      const [key] = LEGACY_CATCH.find(([, w]) => (r -= w) < 0) || LEGACY_CATCH[0];
      inv.add(fishItem(key));
    }
    return inv;
  }
}
