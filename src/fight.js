// ── The fight ────────────────────────────────────────────────────────────────
// What happens between a fish taking the hook and it landing on the deck — or
// getting away. Pure maths, no rendering and no imports, so it can be run in
// isolation: fishing.js draws it, and this decides it.
//
// Three quantities, and the player controls one input — hold to reel, let go
// to give line:
//
//   tension  0..1. Reeling raises it; the fish pulling raises it more; both at
//            once is how a line breaks. Past DANGER it strains, and a line kept
//            there snaps. Below SLACK the hook is loose, and a fish left slack
//            too long throws it.
//   line     metres of line out. Reeling takes it in — slowly while the fish is
//            pulling, quickly while it rests. A fish running while you are not
//            reeling takes line out, and one that takes it all is gone.
//   stamina  1..0. A fish tires fastest pulling against a tight line, so the
//            way to land a big one is to let it run, take line back while it
//            rests, and keep it from ever quite resting.
//
// Every species fights to its own profile — strength, stamina, how long it
// runs and rests, and a style that shapes both the force and where it goes.

// Per species, from the bodies in tools/build_fish.py and how those fish
// behave. `pull` is peak force at mid size; bigger individuals pull harder.
export const FIGHTERS = {
  // ── the bare-hook fish ──
  // Tiny and frantic: short darting bursts in every direction, and it leaps.
  // It cannot break a line, but it can shake a loose one.
  silver:   { pull: 0.34, stamina: 0.55, style: 'dart',      run: [0.25, 0.6], rest: [0.3, 0.8], jumps: 0.35 },
  // A damselfish: bolts straight down for the coral and tries to hole up.
  chromis:  { pull: 0.60, stamina: 0.65, style: 'dive',      run: [0.5, 1.0],  rest: [0.5, 1.1], jumps: 0 },
  // Slim, fast, erratic — sudden changes of direction rather than long pulls.
  wrasse:   { pull: 0.72, stamina: 0.85, style: 'dart',      run: [0.3, 0.7],  rest: [0.3, 0.7], jumps: 0 },
  // A disc of a body turned side-on to the line: it planes against you in
  // long, steady pulls, and leans on the line even while resting.
  tang:     { pull: 0.80, stamina: 1.00, style: 'broadside', run: [1.1, 2.3],  rest: [0.7, 1.4], jumps: 0 },
  bluetang: { pull: 0.86, stamina: 1.05, style: 'broadside', run: [1.1, 2.4],  rest: [0.7, 1.4], jumps: 0 },
  // Red snapper: short, powerful bursts back toward the reef rather than
  // endurance — each turn of the reel met with another surge.
  snapper:  { pull: 0.85, stamina: 1.10, style: 'surge',     run: [0.6, 1.2],  rest: [0.8, 1.5], jumps: 0 },
  // Jolthead porgy: strong for its size, tries to cut the line through rocks,
  // and makes a longer fight of it than something that size should.
  porgy:    { pull: 0.70, stamina: 1.20, style: 'dive',      run: [0.8, 1.6],  rest: [0.6, 1.2], jumps: 0 },
  // Peacock flounder: flattens itself on the bottom and becomes dead weight.
  // Few runs; the work is lifting it off the sand.
  flounder: { pull: 0.55, stamina: 0.90, style: 'flat',      run: [0.5, 1.0],  rest: [1.2, 2.2], jumps: 0 },
  // King mackerel: a blistering first run, a jump as it strikes, then little.
  mackerel: { pull: 0.85, stamina: 0.80, style: 'blitz',     run: [0.7, 1.3],  rest: [0.6, 1.1], jumps: 0.30, first: 1.3 },

  // ── what takes bait ──
  // Great barracuda: an explosive first run with high jumps, and tires fast.
  barracuda:{ pull: 1.00, stamina: 0.90, style: 'blitz',     run: [0.8, 1.8],  rest: [0.8, 1.5], jumps: 0.45, first: 1.5 },
  // Grouper: runs for its hole the moment it is hooked, and breaks you off on
  // the coral if it gets there. It has to be turned in the first seconds.
  grouper:  { pull: 1.15, stamina: 1.30, style: 'bury',      run: [1.2, 2.2],  rest: [1.0, 1.8], jumps: 0 },
  // Mahi-mahi: runs fast, changes direction without warning, and jumps again
  // and again — slack line on every jump.
  mahi:     { pull: 0.95, stamina: 1.40, style: 'acrobat',   run: [0.7, 1.5],  rest: [0.5, 1.0], jumps: 0.7 },
  // Yellowfin tuna: long driving runs for the depths, stamina for days, and at
  // the end the death circle — wide, heavy circles right under you.
  tuna:     { pull: 1.25, stamina: 2.60, style: 'deep',      run: [3.0, 6.0],  rest: [1.2, 2.2], jumps: 0 },
  // Blacktip reef shark: long heavy pulls and head-shakes that pulse the line.
  blacktip: { pull: 1.05, stamina: 2.00, style: 'shark',     run: [2.0, 4.0],  rest: [1.2, 2.0], jumps: 0 },
};

export const SLACK = 0.12;           // below this the hook is loose
export const DANGER = 0.85;          // above this the line is straining
const SLACK_TIME = 1.5;              // seconds of slack before the hook comes free
const OVERLOAD_AT = 0.9;             // the line starts failing here...
const OVERLOAD_RATE = 16;            // ...this fast per unit over...
const OVERLOAD_HEAL = 1.0;           // ...and recovers this fast below it
const REEL_SPEED = 2.6;              // m/s of line taken in against no pull
const PAYOUT = 4.0;                  // m/s of line a running fish takes per unit of pull
export const LAND = 1.6;             // this close and it is on the deck
// The reel's drag. A line you are not winding slips at this tension rather
// than breaking, the way a real reel's spool does — so a fish running against
// an idle reel takes line, but it cannot snap it. Below DANGER on purpose.
const DRAG = 0.78;
// How fast tension climbs to meet a pull, by fighting style.
const SHOCK = { dart: 9, dive: 7, broadside: 3, run: 3.5, surge: 5, flat: 3,
                blitz: 7, bury: 5, acrobat: 7, deep: 3, shark: 4 };
const COVER_RATE = 0.55;             // how fast a burying fish gets home
const COVER_TURN = 0.74;             // tension above this turns it back

export class Fight {
  /**
   * @param key     species, a key of FIGHTERS
   * @param size    this fish's length over its species' mid length — a big one
   *                pulls harder
   * @param line    metres out at the strike
   * @param lineMax metres on the reel
   */
  constructor(key, { size = 1, line = 12, lineMax = 60, rng = Math.random } = {}) {
    this.key = key;
    this.p = FIGHTERS[key] || FIGHTERS.silver;
    this.rng = rng;
    this.strength = this.p.pull * Math.pow(size, 0.8);
    this.lineMax = lineMax;

    this.tension = 0.4;
    this.line = line;
    this.startLine = line;
    this.stamina = 1;
    this.slack = 0;                  // seconds spent slack
    this.overload = 0;               // 0..1, the line failing
    this.pull = 0;                   // the fish's force right now
    this.t = 0;
    this.outcome = null;             // 'landed' | 'snapped' | 'thrown' | 'spooled' | 'rocked'

    // Where the fish is, for drawing: an angle off the straight line from the
    // rod, and how deep.
    this.bearing = 0;
    this.bearingTarget = 0;
    this.depth = 0.8;
    this.depthTarget = 0.8;
    this.jump = -1;                  // 0..1 while leaping, else -1
    this.cover = 0;                  // 0..1 — a burying fish getting back to its hole
    this.runs = 0;                   // how many runs it has made
    this.jumpCool = 0;

    // A hooked fish bolts: the fight opens on a run.
    this.phase = 'run';
    this.phaseLen = this.phaseLeft = this.span(this.p.run) * 1.2;
    this.startRun();
  }

  span([a, b]) { return a + this.rng() * (b - a); }

  startRun() {
    const s = this.p.style;
    this.runs++;
    if (s === 'dart' || s === 'acrobat') this.bearingTarget = (this.rng() * 2 - 1) * 0.65;
    else if (s === 'run' || s === 'deep' || s === 'shark') this.bearingTarget = (this.rng() * 2 - 1) * 0.3;
    else if (s === 'dive' || s === 'surge' || s === 'bury') this.bearingTarget = (this.rng() * 2 - 1) * 0.3;
    else if (s === 'blitz') this.bearingTarget = (this.rng() * 2 - 1) * 0.5;
    this.depthTarget = { dive: 2.8, surge: 2.4, bury: 3.2, run: 2.0, deep: 9, shark: 2.5,
                         flat: 3.0, blitz: 1.2, acrobat: 0.8 }[s] ?? 0.9;
    // Jumpers mostly jump as a run begins; an acrobat keeps going (see step).
    if (this.p.jumps && s !== 'acrobat' && this.rng() < this.p.jumps) this.jump = 0;
  }

  /** What the fish is pulling with this instant, before easing. */
  wanted() {
    const tired = 0.35 + 0.65 * this.stamina;
    const s = this.p.style;
    // In the air it is not pulling at all — which is the trouble with jumpers.
    if (this.jump >= 0) return 0;
    // A shark shakes its head the whole fight, resting or not.
    const shake = s === 'shark' ? 1 + 0.3 * Math.sin(this.t * 7.5) : 1;
    if (this.phase === 'rest') {
      // A tang leans on the line even at rest, and a flounder lying flat is
      // dead weight; everything else nearly stops.
      const lean = s === 'broadside' ? 0.38 : s === 'flat' ? 0.62 : s === 'shark' ? 0.3 : 0.16;
      return this.strength * lean * tired * shake;
    }
    let f = this.strength * tired * shake;
    const into = this.phaseLen - this.phaseLeft;                 // seconds into the run
    if (s === 'dart') f *= 1 + 0.65 * Math.sin(this.t * 15);     // in jerks
    if (s === 'run' || s === 'deep') f *= Math.min(1, 0.45 + into * 1.4);   // surges, then holds
    if (s === 'broadside') f *= 0.92;                            // steady, no spikes
    if (s === 'dive' && into < 0.4) f *= 1.55;                    // the bolt for cover
    if (s === 'surge' && into < 0.3) f *= 1.25;                   // back to the reef
    if (s === 'flat') f *= 0.8;                                   // it hugs, it does not run
    // The first run is the one: a blitzing fish spends itself on it.
    if (s === 'blitz') f *= this.runs === 1 ? (this.p.first || 1.5) : 0.8;
    // Circling at the end, heavy and steady rather than running.
    if (s === 'deep' && this.stamina < 0.35) f *= 0.7;
    return f * (0.9 + 0.2 * this.rng());
  }

  /**
   * Advance the fight.
   * @param reeling  whether the reel is being wound this frame
   * @returns the outcome once it is decided, else null
   */
  step(dt, reeling) {
    if (this.outcome) return this.outcome;
    this.t += dt;

    // ── the fish ──
    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) {
      if (this.phase === 'run') {
        this.phase = 'rest';
        // A tired fish rests longer between runs.
        this.phaseLen = this.phaseLeft = this.span(this.p.rest) * (1.6 - 0.6 * this.stamina);
        this.depthTarget = 0.7;
      } else {
        this.phase = 'run';
        this.phaseLen = this.phaseLeft = this.span(this.p.run) * (0.45 + 0.55 * this.stamina);
        this.startRun();
      }
    }
    // An acrobat jumps through its runs, not just at the start of them.
    this.jumpCool -= dt;
    if (this.p.style === 'acrobat' && this.phase === 'run' && this.jump < 0 &&
        this.jumpCool <= 0 && this.rng() < this.p.jumps * dt) {
      this.jump = 0;
      this.jumpCool = 0.9;
    }
    const want = this.wanted();
    // Darting fish hit the line at once; the others lean in.
    const bite = this.p.style === 'dart' ? 14 : 6;
    this.pull += (want - this.pull) * Math.min(1, dt * bite);

    // ── the line ──
    // Winding against a fish that is pulling is what breaks lines, so reeling
    // loads the line by the whole of the fish's pull on top of the reel's own.
    const target = reeling ? 0.25 + 1.0 * this.pull : Math.min(0.55 * this.pull, DRAG);
    // Darting and bolting fish jerk the line — the load arrives at once, which
    // is what makes holding the reel on a wrasse a way to lose it. Steady
    // pullers lean in, and give you time to see it coming.
    const rise = SHOCK[this.p.style] || 3.5;
    const rate = target > this.tension ? rise : 2.5;
    this.tension += (target - this.tension) * Math.min(1, dt * rate);

    if (reeling) {
      this.line -= REEL_SPEED * Math.max(0.08, 1 - 0.9 * this.pull) * dt;
      // A very strong run slips the reel even while you wind.
      this.line += Math.max(0, this.pull - 0.95) * 2 * dt;
    } else {
      this.line += Math.max(0, this.pull - 0.25) * PAYOUT * dt;
    }

    // ── stamina ── it tires fastest pulling against a tight line
    this.stamina -= dt * (0.02 + 0.10 * this.pull * this.tension) / this.p.stamina;
    if (this.phase === 'rest' && this.tension < 0.3) this.stamina += dt * 0.012;
    this.stamina = Math.min(1, Math.max(0, this.stamina));

    // ── where it is, for drawing ──
    if (this.p.style === 'broadside') this.bearingTarget = 0.5 * Math.sin(this.t * 0.9);
    // The death circle: a spent tuna swims wide circles right under you.
    if (this.p.style === 'deep' && this.stamina < 0.35) {
      this.bearingTarget = Math.sin(this.t * 0.6) * 1.2;
      this.depthTarget = 5;
    }
    this.bearing += (this.bearingTarget - this.bearing) * Math.min(1, dt * (this.p.style === 'dart' ? 5 : 1.5));
    this.depth += (this.depthTarget - this.depth) * Math.min(1, dt * 1.2);
    if (this.jump >= 0) {
      this.jump += dt / 0.6;
      // Back in the water all at once: the line takes the whole fish again.
      if (this.jump >= 1) { this.jump = -1; this.tension = Math.min(1.2, this.tension + 0.18 * this.strength); }
    }

    // A burying fish, early in the fight, heads for its hole while it runs.
    // Hold it hard enough and it turns; give it line and it gets there.
    if (this.p.style === 'bury' && this.stamina > 0.55) {
      if (this.phase === 'run' && this.tension < COVER_TURN) {
        this.cover += dt * COVER_RATE * (1 - this.tension / COVER_TURN);
      } else if (this.tension >= COVER_TURN) {
        this.cover -= dt * 0.5;
      }
      this.cover = Math.max(0, this.cover);
      this.depthTarget = 1 + this.cover * 3;
    } else {
      this.cover = Math.max(0, this.cover - dt * 0.5);
    }

    // ── how it ends ──
    // Not winding, the drag slips before the line can break — even on the
    // jolt of a fish landing back in the water.
    if (!reeling) this.tension = Math.min(this.tension, DRAG);
    this.overload += (this.tension > OVERLOAD_AT
      ? (this.tension - OVERLOAD_AT) * OVERLOAD_RATE : -OVERLOAD_HEAL) * dt;
    this.overload = Math.max(0, this.overload);
    this.slack = this.tension < SLACK ? this.slack + dt : Math.max(0, this.slack - 2 * dt);

    if (this.overload >= 1) this.outcome = 'snapped';
    else if (this.cover >= 1) this.outcome = 'rocked';
    else if (this.slack >= SLACK_TIME) this.outcome = 'thrown';
    else if (this.line >= this.lineMax) this.outcome = 'spooled';
    else if (this.line <= LAND) this.outcome = 'landed';
    return this.outcome;
  }

  /** 0..1: how close the line is to letting go from slack. */
  get looseness() { return Math.min(1, this.slack / SLACK_TIME); }
}
