// ── Fishing ──────────────────────────────────────────────────────────────────
// The rod. Where the spear is active — aim, strike, go and fetch it — the rod
// is patient: cast a float from the deck or the shore, wait for it to go under,
// and then fight the fish in.
//
//   idle → charging → casting → flying → waiting ⇄ nibble → bite → fighting → landing
//            hold       release             click too early / miss the bite ↩
//
// * Swing meter. Hold to wind the rod back; the power swings up and back down,
//   so the skill is letting go at the top. Power sets the distance, 4-26m, in
//   the direction you are facing.
// * The wait. The float rides the swell; a nibble or two may twitch it first,
//   and striking on a nibble pulls the hook out of its mouth.
// * The bite. The float is dragged under and you have about a second to set
//   the hook.
// * The fight. Hold to reel, let go to give line. Reel against a running fish
//   and the tension climbs into the red, and a line kept there snaps; leave it
//   slack too long and the fish throws the hook; let it run out all your line
//   and it is gone. The fish tires as it fights, so patience lands the big
//   ones. How it fights is src/fight.js, and it is different for every species.
//
// What bites depends on the water under the float — reef fish over the coral,
// snapper, porgy, flounder and mackerel over the open sand — and on what is on
// the hook. A bare hook takes small fish. Bait it with one of your own catches
// (right-click with the rod in hand) and the small ones leave it alone: a
// whole fish is a meal for a predator, and that is what comes for it — grouper
// and barracuda on the reef, mackerel and blacktip sharks over the sand, mahi-
// mahi under the raft, and now and then a yellowfin tuna in off the shelf edge.
// A rod fish comes up from
// water you cannot see into, so it is not one of the visible schools and
// fishing never empties a shoal.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { heightAt, reefMask, coastDistance } from './terrain.js';
import { Fight, LAND, SLACK, DANGER } from './fight.js';
import { BIG } from './fish.js';

const CAST_MIN = 4, CAST_MAX = 26;   // metres, horizontally
const CHARGE_TIME = 1.1;             // seconds for the meter to fill, then it falls
const RELEASE = 0.12;                // seconds after letting go the float leaves —
                                     // the flick in viewmodel.js's cast curve
const GRAVITY = 9.8;
// Metres on the reel. A yellowfin's first run can take thirty metres before
// it turns, and it has to have somewhere to go.
const LINE_MAX = 60;
const WAIT = [5, 13];                // seconds before the first nibble or bite
const NIBBLE_GAP = [0.8, 2.0];
const NIBBLE_TIME = 0.35;
const BITE_WINDOW = 1.1;
const LAND_TIME = 0.7;               // the catch hangs off the tip this long
const FLOAT_R = 0.1;                 // bigger than a real one, so it reads at 20m
const LINE_POINTS = 24;

// Chance weights per ground and per hook. Tangs are grazers and hardly ever
// take a bait — the chromis and wrasse are the reef's usual hook fish — and the
// snapper and porgy are what a bare hook on the bottom actually catches.
const BITES = {
  bare: {
    reef: [['chromis', 30], ['wrasse', 20], ['tang', 8], ['bluetang', 4], ['snapper', 18], ['porgy', 20]],
    sand: [['snapper', 25], ['porgy', 20], ['silver', 25], ['flounder', 15], ['mackerel', 15]],
    deep: [['silver', 40], ['mackerel', 45], ['snapper', 15]],
  },
  // A whole fish on the hook: ambush predators on the reef, hunters over the
  // sand, pelagics past the edge. The blacktip shows up everywhere — sharks
  // find a bleeding bait fish wherever it is.
  bait: {
    reef: [['grouper', 30], ['barracuda', 26], ['snapper', 18], ['blacktip', 14], ['mackerel', 8], ['tuna', 4]],
    sand: [['mackerel', 26], ['barracuda', 18], ['flounder', 16], ['blacktip', 16], ['snapper', 16], ['tuna', 8]],
    deep: [['tuna', 40], ['mahi', 25], ['mackerel', 20], ['blacktip', 15]],
  },
};
// Mahi-mahi hold under the raft, so a bait near it adds them to any table.
const RAFT_SCHOOL = 22, RAFT_MAHI = 22;
const BAIT_WAIT = 1.35;              // a predator is rarer than a chromis
// Raw fish per catch; everything else is one. Roughly the meat on it, set
// against a small reef fish being one meal.
const YIELD = { snapper: 2, porgy: 2, flounder: 2, mackerel: 3, barracuda: 4, grouper: 5,
                mahi: 5, blacktip: 6, tuna: 8 };

// Nothing names the fish until it is on the deck. What is on the line is
// something you feel, not something you are told — how hard it pulls, how it
// runs — and one that gets away stays a mystery.
const LOSSES = {
  snapped: ['The line snaps. Whatever it was, it is gone.', 'bad'],
  thrown:  ['The line went slack and it threw the hook. You never saw what it was.', 'bad'],
  spooled: ['It ran out all your line. Whatever it was, it is gone.', 'bad'],
  rocked:  ['It got back into the rocks and the line parted on the coral. Gone.', 'bad'],
};

const rand = (a, b) => a + Math.random() * (b - a);

function pick(table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = Math.random() * total;
  for (const [k, w] of table) if ((r -= w) <= 0) return k;
  return table[0][0];
}

export class Fishing {
  constructor(scene, raft, fish, viewmodel) {
    this.scene = scene;
    this.raft = raft;
    this.fish = fish;
    this.vm = viewmodel;
    this.state = 'idle';
    this.events = [];                // { text, kind } and { catch, count }

    // The float: red over white, the way every float is, so it reads at range.
    this.float = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(FLOAT_R, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd8332a, roughness: 0.5, emissive: 0x3a0806 }));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(FLOAT_R, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 }));
    const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5),
      new THREE.MeshStandardMaterial({ color: 0xd8332a }));
    quill.position.y = FLOAT_R + 0.05;
    this.float.add(top, bottom, quill);
    this.float.visible = false;
    scene.add(this.float);

    this.linePos = new Float32Array(LINE_POINTS * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({
      color: 0xe6e0cc, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    // One ripple ring, reused: the float landing, a nibble, the bite, a run.
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.ripple.rotation.x = -Math.PI / 2;
    this.ripple.visible = false;
    this.rippleT = 1;
    scene.add(this.ripple);

    this.pos = new THREE.Vector3();  // the float
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.from = new THREE.Vector3(); // where a retract or a landing starts
    this.fishPos = new THREE.Vector3();
    this.fishPrev = new THREE.Vector3();
    this.heading = new THREE.Vector3();   // horizontal, rod → float at the strike
    this.catch = null;               // { key, name, mesh, length }
    this.fight = null;
    this.reeling = false;
    this.power = 0;
    this.charge = 0;
    this.timer = 0;
    this.t = 0;
    this.nibbles = 0;
    this.lastPhase = null;
    this.bait = false;               // a fish on the hook, for something bigger
  }

  /**
   * Put a fish on the hook, or take it back off. Only between casts.
   * @param have  whether there is a raw fish to use
   * @returns +1 if a fish went on (take one from the inventory), -1 if it came
   *          back off (give it back), 0 if nothing changed
   */
  toggleBait(have) {
    if (this.state !== 'idle') return 0;
    if (this.bait) {
      this.bait = false;
      this.say('You take the bait fish off the hook.');
      return -1;
    }
    if (!have) { this.say('You need a raw fish to bait the hook with.', 'bad'); return 0; }
    this.bait = true;
    this.say('You bait the hook with a whole fish. Something bigger might take it.', 'good');
    return 1;
  }

  get busy() { return this.state !== 'idle'; }

  /** A line of text for the prompt, or null. The meters speak for the fight. */
  get prompt() {
    switch (this.state) {
      case 'waiting': case 'nibble':
        return `Waiting for a bite${this.bait ? ' on the bait' : ''} — <b>click</b> to reel in`;
      case 'bite': return '<b>Click</b> — it is biting!';
      default: return null;
    }
  }

  /** What the HUD's meters should show, or null to hide them. */
  get meter() {
    if (this.state === 'charging') {
      return { mode: 'cast', power: this.power, metres: this.castDistance(this.power) };
    }
    if (this.state === 'fighting' && this.fight) {
      const f = this.fight;
      return { mode: 'fight', title: 'Something on the line', tension: f.tension, overload: f.overload,
               looseness: f.looseness, line: f.line, lineMax: f.lineMax, stamina: f.stamina,
               reeling: this.reeling, running: f.phase === 'run',
               jumping: f.jump >= 0, cover: f.cover,
               slackAt: SLACK, dangerAt: DANGER };
    }
    return null;
  }

  say(text, kind) { this.events.push({ text, kind }); }

  castDistance(power) {
    return CAST_MIN + (CAST_MAX - CAST_MIN) * Math.pow(power, 1.15);
  }

  /**
   * The rod's controls, once a frame while it is in hand: the left button,
   * pressed, held and released. Most states want the press; the swing meter
   * and the reel want the hold.
   */
  control({ press, hold, release }, eye, dir, player) {
    switch (this.state) {
      case 'idle':
        if (!press) break;
        if (player.state === 'swim') { this.say('You cannot cast while you are swimming.', 'bad'); break; }
        this.state = 'charging';
        this.charge = 0;
        this.power = 0;
        break;
      case 'charging':
        if (release || !hold) this.cast(eye, dir);
        break;
      case 'waiting':
        if (press) this.retract('You reel in. Nothing on it yet.');
        break;
      case 'nibble':
        if (press) this.retract('Too soon — you pulled it out of its mouth.', 'bad');
        break;
      case 'bite':
        if (press) this.strike();
        break;
      case 'fighting':
        this.reeling = hold;
        break;
      default: break;
    }
  }

  /** Let go of the swing: throw along the way you are facing, as far as the power says. */
  cast(eye, dir) {
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    const dist = this.castDistance(this.power);
    this.target.set(eye.x + flat.x * dist, 0, eye.z + flat.z * dist);
    this.vm.windupRate = 18;         // swing through fast
    this.vm.windup = 0;
    this.vm.use('cast');
    this.state = 'casting';
    this.timer = RELEASE;
  }

  /** Solve the throw for the target: a fixed flight time, gravity made up for. */
  release(time) {
    if (!this.vm.tipWorld('rod', this.tip)) { this.state = 'idle'; return; }
    this.pos.copy(this.tip);
    this.target.y = waveHeight(this.target.x, this.target.z, time);
    const d = Math.hypot(this.target.x - this.tip.x, this.target.z - this.tip.z);
    const T = 0.45 + d / 30;
    this.vel.copy(this.target).sub(this.tip).divideScalar(T);
    this.vel.y += 0.5 * GRAVITY * T;
    this.t = 0;
    this.state = 'flying';
    this.float.visible = true;
    this.line.visible = true;
  }

  /** Nothing on it, or given up: the float skims back in and the cast ends. */
  retract(text, kind) {
    if (text) this.say(text, kind);
    this.dropCatch();
    this.fight = null;
    this.from.copy(this.pos);
    this.state = 'retract';
    this.t = 0;
    this.vm.strain = 0;
  }

  /** What might take the hook where the float is, as it is baited. */
  bites(p) {
    const g = this.groundUnder(p);
    const table = BITES[this.bait ? 'bait' : 'bare'][g.kind].slice();
    const r = this.raft.group.position;
    if (this.bait && Math.hypot(p.x - r.x, p.z - r.z) < RAFT_SCHOOL) table.push(['mahi', RAFT_MAHI]);
    return table;
  }

  strike() {
    const key = pick(this.bites(this.pos));
    // Whatever took it, the bait is gone: eaten, or on the way to being.
    this.bait = false;
    const sp = this.fish.species(key);
    if (!sp) { this.retract('It got away.'); return; }
    // A rod lands the better half of the size range: you keep the big ones.
    const mid = (sp.length[0] + sp.length[1]) / 2;
    const length = rand(mid, sp.length[1]);
    const mesh = this.fish.displayBody(key, length);
    // From here the fight drives its body, not the spear-struggle in fish.js.
    mesh.userData.driven = true;
    mesh.rotation.order = 'YXZ';
    mesh.userData.yaw = Math.atan2(this.pos.x - this.tip.x, this.pos.z - this.tip.z);
    this.scene.add(mesh);
    this.catch = { key, name: sp.name, mesh, length };

    this.heading.set(this.pos.x - this.tip.x, 0, this.pos.z - this.tip.z);
    const out = Math.max(LAND + 1, this.heading.length());
    this.heading.normalize();
    this.fight = new Fight(key, { size: length / mid, line: out, lineMax: LINE_MAX });
    this.lastPhase = null;
    this.reeling = false;
    this.state = 'fighting';
    this.t = 0;
    this.fishPos.copy(this.pos);
    this.fishPrev.copy(this.pos);
    this.say('Fish on!');                          // not what: see LOSSES
  }

  /**
   * What is under the float: depth, and which ground — the reef, the open
   * sand of the shelf, or deep water past the drop-off.
   */
  groundUnder(p) {
    const floor = heightAt(p.x, p.z);
    const depth = waveHeight(p.x, p.z, 0) - floor;
    const reef = reefMask(p.x, p.z, -coastDistance(p.x, p.z)) > 0.35 && depth < 24;
    const kind = reef ? 'reef' : depth > 24 ? 'deep' : 'sand';
    return { floor, depth, reef, kind };
  }

  /** Start the wait. Reef water bites faster; a shallow beach hardly at all. */
  startWaiting() {
    const g = this.groundUnder(this.pos);
    const factor = (g.depth < 3 ? 1.7 : g.reef ? 0.7 : 1) * (this.bait ? BAIT_WAIT : 1);
    // Small fish peck at a hook; a predator on a bait does not, it just takes it.
    this.nibbles = Math.floor(Math.random() * (this.bait ? 2 : 3));
    this.timer = rand(WAIT[0], WAIT[1]) * factor;
    this.state = 'waiting';
  }

  splash(at, size = 1) {
    this.ripple.position.set(at.x, at.y + 0.01, at.z);
    this.ripple.userData.size = size;
    this.rippleT = 0;
    this.ripple.visible = true;
  }

  dropCatch() {
    if (!this.catch) return;
    const m = this.catch.mesh;
    m.removeFromParent();
    m.geometry.dispose();
    m.material.dispose();
    this.catch = null;
  }

  finish() {
    this.dropCatch();
    this.fight = null;
    this.float.visible = false;
    this.line.visible = false;
    this.state = 'idle';
    this.vm.strain = 0;
    this.vm.windup = 0;
    this.vm.windupRate = 6;
  }

  /**
   * @param holding  whether the rod is the thing in hand; put it away and the
   *                 cast is over
   */
  update(dt, time, player, holding) {
    this.animateRipple(dt);
    if (this.state === 'idle') return;

    // ── ending it from outside ──
    if (!holding || player.state === 'swim') {
      if (this.state === 'fighting') this.say('You let the line go slack, and it is gone.', 'bad');
      this.finish();
      return;
    }

    const haveTip = !!this.vm.tipWorld('rod', this.tip);
    if (!haveTip) this.tip.copy(player.pos).setY(player.pos.y + 1.7);
    this.t += dt;
    const sea = waveHeight(this.pos.x, this.pos.z, time);

    switch (this.state) {
      case 'charging':
        // Up and back down again: hold too long and it falls away.
        this.charge += dt / CHARGE_TIME;
        this.power = 1 - Math.abs(1 - (this.charge % 2));
        this.vm.windupRate = 6;
        this.vm.windup = Math.min(1, this.charge * 2.2);
        return;                                  // nothing in the world yet

      case 'casting':
        this.timer -= dt;
        if (this.timer <= 0) this.release(time);
        return;

      case 'flying': {
        this.vel.y -= GRAVITY * dt;
        this.pos.addScaledVector(this.vel, dt);
        const here = waveHeight(this.pos.x, this.pos.z, time);
        const onDeck = this.raft.solidAtWorld(this.pos.x, this.pos.z) &&
                       this.pos.y <= this.raft.deckY(this.pos.x, this.pos.z) + FLOAT_R;
        const ground = heightAt(this.pos.x, this.pos.z);
        if (onDeck) { this.retract('It lands on the deck. Cast out over the water.', 'bad'); break; }
        if (this.pos.y <= Math.max(here, ground)) {
          if (ground > here - 0.3) { this.retract('That is dry land. Cast out over the water.', 'bad'); break; }
          this.pos.y = here;
          this.splash(this.pos, 0.7);
          this.startWaiting();
        }
        break;
      }

      case 'waiting':
      case 'nibble': {
        let dip = 0;
        if (this.state === 'nibble') {
          dip = Math.sin(Math.min(1, this.t / NIBBLE_TIME) * Math.PI) * 0.07;
          if (this.t >= NIBBLE_TIME) { this.state = 'waiting'; this.t = 0; }
        }
        this.pos.y = sea + 0.02 - dip;
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.nibbles > 0) {
            this.nibbles--;
            this.state = 'nibble';
            this.t = 0;
            this.timer = rand(NIBBLE_GAP[0], NIBBLE_GAP[1]);
            this.splash(this.pos, 0.45);
          } else {
            this.state = 'bite';
            this.t = 0;
            this.timer = BITE_WINDOW;
            this.splash(this.pos, 1.1);
          }
        }
        break;
      }

      case 'bite':
        // Dragged under and held there, shaking, until you strike or it goes.
        this.pos.y = sea - 0.22 - Math.sin(this.t * 30) * 0.03;
        this.vm.strain = 0.35;
        this.timer -= dt;
        if (this.timer <= 0) {
          // A missed bite on a bait is a stolen bait more often than not.
          if (this.bait && Math.random() < 0.6) {
            this.bait = false;
            this.say('It got away — and took the bait with it. The hook is bare.', 'bad');
          } else {
            this.say('It got away. The float bobs back up.');
          }
          this.vm.strain = 0;
          this.startWaiting();
        }
        break;

      case 'fighting':
        this.fightFrame(dt, time);
        if (this.state !== 'fighting') return;
        break;

      case 'landing': {
        const p = Math.min(1, this.t / 0.45);
        const e = p * p * (3 - 2 * p);
        if (this.catch.length > BIG) {
          // Too heavy to swing up on the rod: hauled over the edge and onto
          // the deck at your feet, in an arc.
          const deck = this.onDeck(player);
          this.pos.lerpVectors(this.from, deck, e);
          this.pos.y += Math.sin(Math.PI * p) * 1.2;
          this.vm.strain = 0.6 * (1 - p);
          this.lie(dt, time, deck, p);
        } else {
          // Out of the water and swung in to the tip.
          const hang = this.tip.clone().setY(this.tip.y - 0.45);
          this.pos.lerpVectors(this.from, hang, e);
          this.vm.strain = 0.3;
          this.hang(dt, time, this.tip);
        }
        if (this.t >= (this.catch.length > BIG ? LAND_TIME + 0.5 : LAND_TIME)) {
          const { key, name } = this.catch;
          const count = YIELD[key] || 1;
          this.events.push({ catch: key, count });
          const size = this.catch.length > 1 ? ` — ${this.catch.length.toFixed(1)} m of it` : '';
          this.say(count > 1 ? `You land a ${name}${size}, enough for ${count}.` : `You land a ${name}.`, 'good');
          this.finish();
          return;
        }
        break;
      }

      case 'retract': {
        const p = Math.min(1, this.t / 0.35);
        this.pos.lerpVectors(this.from, this.tip, p * p);
        if (p >= 1) { this.finish(); return; }
        break;
      }
    }

    this.float.position.copy(this.pos);
    this.float.rotation.z = this.state === 'bite' ? Math.sin(this.t * 30) * 0.3
                          : this.state === 'fighting' ? Math.sin(this.t * 11) * 0.35 * this.fight.tension : 0;
    this.drawLine();
  }

  /** One frame of the fight: step the model, then put the fish where it says. */
  fightFrame(dt, time) {
    const f = this.fight;
    const outcome = f.step(dt, this.reeling);
    this.vm.strain = Math.min(1, f.tension * 1.1);

    // Where the fish is: out along the line from the rod, swung off to one
    // side by its bearing, as deep as it has dived — or in the air mid-leap.
    const b = f.bearing, c = Math.cos(b), s = Math.sin(b);
    const hx = this.heading.x * c - this.heading.z * s, hz = this.heading.x * s + this.heading.z * c;
    const dist = Math.max(LAND, f.line);
    this.fishPrev.copy(this.fishPos);
    this.fishPos.set(this.tip.x + hx * dist, 0, this.tip.z + hz * dist);
    const sea = waveHeight(this.fishPos.x, this.fishPos.z, time);
    this.fishPos.y = f.jump >= 0 ? sea + Math.sin(Math.PI * f.jump) * 0.55 : sea - f.depth;

    // The float skitters along the surface above it, dragged under by a hard pull.
    this.pos.set(this.fishPos.x, sea - 0.04 - 0.2 * Math.max(0, f.tension - 0.6), this.fishPos.z);

    // Splash where it surges or leaps.
    if (f.phase !== this.lastPhase && f.phase === 'run') this.splash(this.pos.clone().setY(sea), 0.6 + f.strength * 0.6);
    if (f.jump >= 0 && f.jump < dt / 0.6 + 0.01) this.splash(this.pos.clone().setY(sea), 0.9);
    this.lastPhase = f.phase;

    this.swim(dt, time, f);

    if (!outcome) return;
    if (outcome === 'landed') {
      this.from.copy(this.pos);
      this.state = 'landing';
      this.t = 0;
      this.splash(this.pos.clone().setY(sea), 0.8);
      return;
    }
    const [text, kind] = LOSSES[outcome];
    this.say(text, kind);
    if (outcome === 'thrown') this.retract();       // the float comes back empty
    else this.finish();                              // snapped or spooled: gone
  }

  /**
   * The hooked fish, fighting. Which way it faces says what it is doing:
   *
   *   running    swimming away from you, along its run
   *   resting    hanging off the line, nose away, holding station
   *   reeled in  towed head-first, twisting side to side against it
   *   broadside  a tang turns its flank to the line and planes
   *   jumping    along its arc, and a mahi twists as it goes
   *
   * The body beats harder the harder it pulls, and the head-shakers — sharks,
   * barracuda, a grouper heading for its hole — snap the body side to side.
   * A big fish turns slower than a small one.
   */
  swim(dt, time, f) {
    const m = this.catch?.mesh;
    if (!m) return;
    const u = m.userData;
    m.position.copy(this.fishPos);

    const vx = (this.fishPos.x - this.fishPrev.x) / Math.max(dt, 1e-4);
    const vy = (this.fishPos.y - this.fishPrev.y) / Math.max(dt, 1e-4);
    const vz = (this.fishPos.z - this.fishPrev.z) / Math.max(dt, 1e-4);
    const speed = Math.hypot(vx, vz);
    const ax = this.fishPos.x - this.tip.x, az = this.fishPos.z - this.tip.z;
    const al = Math.hypot(ax, az) || 1;
    const away = Math.atan2(ax / al, az / al);
    const style = f.p.style;

    let want;
    if (f.jump >= 0 || (style === 'deep' && f.stamina < 0.35)) {
      want = speed > 0.2 ? Math.atan2(vx, vz) : away;              // along its path
    } else if (style === 'broadside') {
      want = away + Math.PI / 2 * Math.sign(Math.sin(f.t * 0.45) || 1);
    } else if (f.phase === 'run') {
      want = speed > 0.4 ? Math.atan2(vx, vz) : away;
    } else if (this.reeling && f.tension > 0.18) {
      want = away + Math.PI + 0.7 * Math.sin(f.t * 1.7);           // towed, twisting
    } else {
      want = away + 0.45 * Math.sin(f.t * 0.8);                    // hanging off the line
    }
    let turn = want - u.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const effort = Math.min(1.5, f.pull / Math.max(0.3, f.strength)) + (f.jump >= 0 ? 0.8 : 0);
    const rate = (2.5 + 4 * effort) / Math.sqrt(Math.max(0.2, this.catch.length));
    const step = THREE.MathUtils.clamp(turn, -rate * dt, rate * dt);
    u.yaw += step;
    const yawRate = step / Math.max(dt, 1e-4);

    // Nose up climbing, down diving; in the air, along the arc.
    const pitch = THREE.MathUtils.clamp(-Math.atan2(vy, Math.max(speed, 0.6)), f.jump >= 0 ? -1.2 : -0.6,
                                        f.jump >= 0 ? 1.2 : 0.6);
    const roll = style === 'acrobat' && f.jump >= 0 ? Math.sin(f.jump * Math.PI * 2) * 0.9
               : THREE.MathUtils.clamp(-yawRate * 0.1, -0.4, 0.4);
    m.rotation.set(pitch, u.yaw, roll);

    // Head-shakes: a snap of the whole body, side to side.
    const shake = { shark: 1.0, blitz: 0.6, bury: 0.5, surge: 0.35, dart: 0.4, acrobat: 0.3 }[style] ?? 0.15;
    const snap = shake * effort * Math.sin(f.t * (9 + 6 * shake)) * 4;
    u.swimmer.step(dt, 0.8 + effort, yawRate + snap, effort);
    u.swimmer.writeVec(u.mat.userData.swim);
  }

  /**
   * Where a big fish comes to rest: on the deck beside you and a step back
   * from the edge. Not in front — that is the water it came out of — and not
   * straight behind, or the haul would pass through your head.
   */
  onDeck(player) {
    const side = new THREE.Vector3(-this.heading.z, 0, this.heading.x);
    const p = player.pos.clone().addScaledVector(side, 1.0).addScaledVector(this.heading, -0.4);
    p.y = player.pos.y + 0.12;
    return p;
  }

  /** A big fish coming over the side and lying there, tail slapping. */
  lie(dt, time, at, p) {
    const m = this.catch?.mesh;
    if (!m) return;
    m.position.copy(this.pos);
    const side = new THREE.Vector3(-this.heading.z, 0, this.heading.x);
    m.rotation.set(0, 0, 0);
    m.lookAt(m.position.clone().add(side));
    // Coming up it hangs nose to the line; once down it lies on its flank.
    m.rotateZ(Math.PI / 2 * p);
    // Out of the water a fish does not swim, it flops: hard slaps of the whole
    // body, a beat apart.
    const u = m.userData;
    const slap = Math.sin(time * 3.2) > 0.2;
    u.swimmer.step(dt, 0, slap ? Math.sin(time * 14) * 6 : 0, slap ? 1.4 : 0.1);
    u.swimmer.writeVec(u.mat.userData.swim);
  }

  /** The fish on the end of the line out of the water: head up, thrashing. */
  hang(dt, time, tip) {
    const m = this.catch?.mesh;
    if (!m) return;
    const up = tip.clone().sub(this.pos).normalize();
    m.position.copy(this.pos).addScaledVector(up, -0.12 - this.catch.length * 0.5);
    m.rotation.set(0, 0, 0);
    m.lookAt(this.pos);                   // nose (+Z) at the hook
    m.rotateZ(Math.sin(time * 2.3) * 0.5);   // twisting on the line
    // Thrashing: the body flung from side to side, the tail going mad.
    const u = m.userData;
    u.swimmer.step(dt, 0, Math.sin(time * 11) * 7, 1.5);
    u.swimmer.writeVec(u.mat.userData.swim);
  }

  /** A sagging curve while it is slack; tighter the harder it is pulled. */
  drawLine() {
    const a = this.tip, b = this.pos;
    const d = a.distanceTo(b);
    let sag;
    if (this.state === 'fighting') sag = 0.05 * (1 - this.fight.tension) * d;
    else if (this.state === 'bite' || this.state === 'landing') sag = 0.004 * d;
    else if (this.state === 'flying') sag = 0.03 * d;
    else sag = 0.06 * d;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - sag * 2, cz = (a.z + b.z) / 2;
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1), u = 1 - t;
      this.linePos[i * 3]     = u * u * a.x + 2 * u * t * cx + t * t * b.x;
      this.linePos[i * 3 + 1] = u * u * a.y + 2 * u * t * cy + t * t * b.y;
      this.linePos[i * 3 + 2] = u * u * a.z + 2 * u * t * cz + t * t * b.z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }

  animateRipple(dt) {
    if (this.rippleT >= 1) { this.ripple.visible = false; return; }
    this.rippleT = Math.min(1, this.rippleT + dt / 0.9);
    const s = (0.15 + this.rippleT * 0.9) * (this.ripple.userData.size || 1);
    this.ripple.scale.set(s, s, s);
    this.ripple.material.opacity = 0.55 * (1 - this.rippleT);
  }
}
