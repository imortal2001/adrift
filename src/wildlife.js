// ── Wildlife ─────────────────────────────────────────────────────────────────
// An ecosystem rather than a set of props. Predators hunt whatever prey is
// nearest — herbivores included — herbivores watch for predators and bolt, and
// a kill removes an animal until the population tops itself back up. You are
// simply another entry in the prey table.
//
// Every animal is simulated wherever it is; only the ones near the viewer are
// drawn and posed.

import * as THREE from 'three';
import { heightAt, isLand, coastDistance } from './terrain.js';
import { ModelLibrary, playState, driveGait } from './models.js';

const TAU = Math.PI * 2;
const DRAW_RANGE = 240;
const CORPSE_TIME = 35;        // seconds a kill lies where it fell
const STEER_EVERY = 0.2;       // seconds between an animal's look-aheads
const MAX_SLOPE = 0.5;         // steeper than this is a cliff to an animal
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const STATES = ['wander', 'graze', 'rest', 'hunt', 'flee', 'feed'];
const approach = (v, goal, step) => v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);

// How high each body stands is measured from the finished model at build time
// (see buildBody), not guessed — otherwise changing a leg buries the animal.
const rnd = (a, b) => a + Math.random() * (b - a);

/** How far above the ground a body's origin sits. A glTF rig is already at
 *  world scale; the procedural one is scaled by its group. */
const liftOf = a => (a.rig.model ? a.rig.stand : a.rig.stand * a.sp.scale);

export const SPECIES = {
  sauropod: {
    label: 'Sauropod', count: 5, diet: 'plants', scale: 3.0,
    speed: 2.2, walk: 1.1, accel: 0.35, turn: 0.32, sight: 40, hp: 400, flee: 26,
    body: 0x6b7a58, belly: 0x93a279,
    build: { legs: 4, neck: 3.4, tail: 3.6, head: 0.55, plates: false, crest: false, arms: null },
  },
  stegosaur: {
    label: 'Stegosaur', count: 5, diet: 'plants', scale: 1.5,
    speed: 1.9, walk: 0.6, accel: 0.8, turn: 0.7, sight: 34, hp: 200, flee: 22,
    body: 0x6d5f3c, belly: 0x9a8a5e,
    build: { legs: 4, neck: 0.7, tail: 2.4, head: 0.5, plates: true, crest: false, arms: null },
  },
  parasaur: {
    label: 'Parasaur', count: 8, diet: 'plants', scale: 1.25, herd: true,
    speed: 4.6, walk: 1.0, accel: 2.6, turn: 1.4, sight: 44, hp: 90, flee: 34,
    body: 0x8a7b52, belly: 0xc0ae7d,
    build: { legs: 4, neck: 1.2, tail: 2.2, head: 0.55, plates: false, crest: true, arms: null },
  },
  raptor: {
    label: 'Raptor', count: 6, diet: 'meat', scale: 0.95, pack: true,
    speed: 4.6, walk: 0.8, accel: 4.5, turn: 2.4, sight: 40, hp: 70,
    damage: 6, reach: 2.4, biteEvery: 1.7, giveUp: 60,
    body: 0x8a5a33, belly: 0xc2a071,
    build: { legs: 2, neck: 0.9, tail: 2.0, head: 0.7, plates: false, crest: false, arms: 'raptor', sickle: true },
  },
  tyrannosaur: {
    label: 'Tyrannosaur', count: 2, diet: 'meat', scale: 2.1,
    speed: 4.4, walk: 1.3, accel: 1.8, turn: 0.9, sight: 52, hp: 320,
    damage: 26, reach: 4.2, biteEvery: 2.6, giveUp: 90,
    body: 0x55483a, belly: 0x8a7a63,
    build: { legs: 2, neck: 1.1, tail: 2.8, head: 1.25, plates: false, crest: false, arms: 'tiny' },
  },
};

// ── body ─────────────────────────────────────────────────────────────────────
function buildBody(sp) {
  const b = sp.build;
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: sp.body, roughness: 0.9, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: sp.belly, roughness: 0.9, flatShading: true });

  const part = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };

  // A skull that narrows toward the snout; a plain box reads as a brick,
  // which is very obvious on the big heads.
  const skullGeo = (w, h, l) => {
    const g = new THREE.BoxGeometry(w, h, l, 1, 1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp((p.getZ(i) / (l / 2)) * 0.5 + 0.5, 0, 1);
      const narrow = THREE.MathUtils.lerp(1, 0.52, t * t);
      p.setX(i, p.getX(i) * narrow);
      p.setY(i, p.getY(i) * THREE.MathUtils.lerp(1, 0.6, t * t) - (1 - narrow) * h * 0.12);
    }
    g.computeVertexNormals();
    return g;
  };

  const torso = part(new THREE.SphereGeometry(1, 9, 7), skin, 0, 0, 0);
  torso.scale.set(0.62, 0.7, 1.3);
  g.add(torso);
  const under = part(new THREE.SphereGeometry(0.86, 8, 6), belly, 0, -0.24, 0);
  under.scale.set(0.55, 0.42, 1.08);
  g.add(under);

  // Neck and head
  const neck = new THREE.Group();
  neck.position.set(0, 0.36, 0.92);
  g.add(neck);
  const nm = part(new THREE.CylinderGeometry(0.17, 0.32, b.neck, 7), skin, 0, b.neck / 2, 0);
  nm.rotation.x = b.neck > 2 ? 0.5 : 0.9;
  nm.position.z = b.neck * (b.neck > 2 ? 0.26 : 0.4);
  neck.add(nm);

  const head = new THREE.Group();
  head.position.set(0, b.neck * (b.neck > 2 ? 0.84 : 0.52), b.neck * (b.neck > 2 ? 0.52 : 0.78));
  neck.add(head);
  const hs = b.head;
  head.add(part(skullGeo(0.36 * hs + 0.1, 0.34 * hs + 0.1, 0.5 + hs * 0.55), skin, 0, 0, 0));
  head.add(part(skullGeo(0.32 * hs + 0.08, 0.15 * hs + 0.05, 0.44 + hs * 0.5), belly, 0, -0.2 * hs - 0.05, 0.05));
  if (sp.diet === 'meat') {
    const eye = new THREE.MeshStandardMaterial({ color: 0xffd257, emissive: 0x8a5c00 });
    for (const sx of [-0.15 * hs - 0.04, 0.15 * hs + 0.04]) {
      head.add(part(new THREE.SphereGeometry(0.055 * hs + 0.02, 6, 5), eye, sx, 0.11 * hs, 0.2 + hs * 0.2));
    }
  }
  if (b.crest) {
    const crest = part(new THREE.ConeGeometry(0.16, 1.1, 5), belly, 0, 0.25, -0.3);
    crest.rotation.x = 2.3;
    head.add(crest);
  }

  // Tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.06, -1.08);
  g.add(tail);
  const tm = part(new THREE.CylinderGeometry(0.06, 0.34, b.tail, 7), skin, 0, 0, -b.tail / 2);
  tm.rotation.x = Math.PI / 2;
  tail.add(tm);

  // Back plates
  if (b.plates) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const p = part(new THREE.ConeGeometry(0.42 - t * 0.18, 0.95 - t * 0.3, 3), belly,
                     0, 0.66, 0.95 - i * 0.36);
      p.rotation.y = Math.PI / 2;
      g.add(p);
    }
  }

  // ── limbs ──
  const claw = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.6, flatShading: true });
  const cyl = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  /** A toe lying flat on the ground, with a claw on the end. */
  const addToe = (parent, angle, len, thick, clawLen) => {
    const toe = new THREE.Group();
    toe.rotation.y = angle;
    parent.add(toe);
    toe.add(part(box(thick, thick * 0.85, len), belly, 0, 0, len / 2));
    const c = part(new THREE.ConeGeometry(thick * 0.5, clawLen, 4), claw, 0, -0.01, len + clawLen * 0.35);
    c.rotation.x = Math.PI / 2;
    toe.add(c);
    return toe;
  };

  /**
   * Bird-legged: thigh forward, shin back, foot forward again. That Z is what
   * makes a theropod read as a theropod rather than a body on posts.
   */
  const theropodLeg = () => {
    const hip = new THREE.Group();
    hip.add(part(cyl(0.20, 0.15, 0.9), skin, 0, -0.42, 0.06));

    const knee = new THREE.Group();
    knee.position.set(0, -0.84, 0.10);
    knee.rotation.x = -0.55;                 // shin swings back under the body
    hip.add(knee);
    knee.add(part(cyl(0.14, 0.10, 0.82), skin, 0, -0.40, 0));

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.80, 0);
    ankle.rotation.x = 0.85;                 // metatarsus angles forward
    knee.add(ankle);
    ankle.add(part(cyl(0.095, 0.085, 0.62), skin, 0, -0.30, 0));

    const foot = new THREE.Group();
    foot.position.set(0, -0.60, 0);
    foot.rotation.x = -0.30;                 // sole flat on the ground
    ankle.add(foot);
    addToe(foot, -0.42, 0.26, 0.11, 0.13);
    addToe(foot, 0, 0.30, 0.12, 0.15);
    addToe(foot, 0.42, 0.26, 0.11, 0.13);
    addToe(foot, Math.PI, 0.14, 0.09, 0.08);  // reversed hallux
    if (b.sickle) {                            // the raptor's killing claw, held up
      const s = new THREE.Group();
      s.position.set(0.07, 0.05, 0.1);
      foot.add(s);
      const sc = part(new THREE.ConeGeometry(0.06, 0.34, 4), claw, 0, 0.12, 0.05);
      sc.rotation.x = -0.7;
      s.add(sc);
    }
    return { hip, knee, foot };
  };

  /** Column legs for the heavy quadrupeds, with a spread pad and stubby toes. */
  const columnLeg = (front) => {
    const hip = new THREE.Group();
    hip.add(part(cyl(0.26, 0.20, 0.85), skin, 0, -0.40, 0));

    const knee = new THREE.Group();
    knee.position.set(0, -0.80, 0);
    knee.rotation.x = front ? 0.16 : -0.16;
    hip.add(knee);
    knee.add(part(cyl(0.19, 0.17, 0.75), skin, 0, -0.36, 0));

    const foot = new THREE.Group();
    foot.position.set(0, -0.72, 0);
    knee.add(foot);
    foot.add(part(cyl(0.26, 0.30, 0.22, 7), belly, 0, -0.10, 0.02));
    addToe(foot, -0.5, 0.15, 0.12, 0.07);
    addToe(foot, 0, 0.17, 0.13, 0.08);
    addToe(foot, 0.5, 0.15, 0.12, 0.07);
    return { hip, knee, foot };
  };

  /** Forelimbs. Theropods have them; on a tyrannosaur they are famously small. */
  const makeArm = (tiny) => {
    // Dromaeosaurs had long, strong forelimbs; a tyrannosaur famously did not.
    const k = tiny ? 0.42 : 1.35;
    const shoulder = new THREE.Group();
    shoulder.rotation.x = tiny ? -0.5 : -0.9;
    shoulder.add(part(cyl(0.09 * k, 0.07 * k, 0.42 * k), skin, 0, -0.2 * k, 0));

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.40 * k, 0);
    elbow.rotation.x = tiny ? 1.5 : 1.9;      // folded up against the chest
    shoulder.add(elbow);
    elbow.add(part(cyl(0.07 * k, 0.055 * k, 0.36 * k), skin, 0, -0.18 * k, 0));

    const hand = new THREE.Group();
    hand.position.set(0, -0.34 * k, 0);
    hand.rotation.x = -0.5;
    elbow.add(hand);
    const fingers = tiny ? 2 : 3;             // rex: two, raptor: three
    for (let i = 0; i < fingers; i++) {
      const a = (i - (fingers - 1) / 2) * 0.34;
      const f = new THREE.Group();
      f.rotation.z = a;
      hand.add(f);
      f.add(part(box(0.05 * k, 0.05 * k, 0.2 * k), belly, 0, -0.1 * k, 0));
      const c = part(new THREE.ConeGeometry(0.032 * k, 0.16 * k, 4), claw, 0, -0.2 * k, 0.01);
      c.rotation.x = Math.PI;
      f.add(c);
    }
    return shoulder;
  };

  const legs = [], knees = [];
  const pairs = b.legs === 4
    ? [[-0.5, 0.8, true], [0.5, 0.8, true], [-0.53, -0.72, false], [0.53, -0.72, false]]
    : [[-0.35, -0.08, false], [0.35, -0.08, false]];
  for (const [lx, lz, front] of pairs) {
    const built = b.legs === 4 ? columnLeg(front) : theropodLeg();
    built.hip.position.set(lx, -0.44, lz);
    g.add(built.hip);
    built.knee.userData.rest = built.knee.rotation.x;
    legs.push(built.hip);
    knees.push(built.knee);
  }

  if (b.arms) {
    // The torso is an ellipsoid 0.62 wide and 1.3 long, so a shoulder at
    // z = 0.62 sits *inside* it and the whole arm disappears. Mount them on
    // the flank, just proud of the surface.
    for (const sx of [-0.54, 0.54]) {
      const arm = makeArm(b.arms === 'tiny');
      arm.position.set(sx, 0.08, 0.72);
      arm.rotation.z = sx < 0 ? 0.18 : -0.18;   // held slightly away from the chest
      g.add(arm);
    }
  }

  // Measure the finished body rather than hard-coding how tall it stands, so
  // any future creature sits on the ground without a magic number.
  const box3 = new THREE.Box3().setFromObject(g);
  const stand = -box3.min.y;
  const size = box3.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);

  g.scale.setScalar(sp.scale);
  return { group: g, neck, head, tail, legs, knees, stand, length, model: false };
}

// ── ecosystem ────────────────────────────────────────────────────────────────
export class Wildlife {
  /**
   * @param terrain  the live Terrain, for the trunks and rocks animals steer
   *                 round; without it they only know the ground.
   */
  constructor(scene, homeHint, terrain = null) {
    this.scene = scene;
    this.terrain = terrain;
    this._near = [];
    this.all = [];
    this.library = new ModelLibrary();
    this.upgraded = [];        // species that swapped to a glTF body
    this.events = [];          // damage dealt to the player
    this.kills = [];           // "X brought down a Y", for flavour near the player
    this.home = homeHint;      // a point on land to seed around
    // Playing together (sharedworld.js). The host's animals hunt the others
    // too — {id, pos, onLand}, a bite on one of them is an event `to` them —
    // and everyone else's follow the host's rather than think for themselves.
    this.others = [];
    this.follow = false;

    for (const key in SPECIES) {
      const sp = SPECIES[key];
      for (let i = 0; i < sp.count; i++) this.spawn(key, sp);
    }
    this._v = new THREE.Vector3();
    this.loadModels();
  }

  /**
   * Try to replace each species' procedural body with a real model. Runs in the
   * background: the game is already playable with what it built, so a slow or
   * missing asset costs nothing.
   */
  loadModels() {
    for (const key in SPECIES) {
      this.library.get(key).then(entry => {
        if (!entry) return;
        let swapped = 0;
        for (const a of this.all) {
          if (a.key !== key) continue;
          try {
            const rig = this.library.instantiate(entry, a.rig.length * a.sp.scale);
            this.scene.remove(a.rig.group);
            this.scene.add(rig.group);
            rig.group.visible = a.rig.group.visible;
            a.rig = rig;
            this.measure(a);
            swapped++;
          } catch (err) {
            // One bad model must not take the species down with it.
            console.warn(`[wildlife] ${key} model unusable, keeping the built-in body:`, err);
            return;
          }
        }
        if (swapped) this.upgraded.push({ key, count: swapped, clips: entry.clips.length });
      });
    }
  }

  spawn(key, sp) {
    const rig = buildBody(sp);
    this.scene.add(rig.group);
    const a = {
      key, sp, rig,
      pos: new THREE.Vector3(),
      heading: Math.random() * TAU,
      speed: 0, state: 'wander', timer: rnd(1, 6),
      stride: Math.random() * TAU, bite: 0,
      hp: sp.hp, dead: false, respawn: 0,
      target: new THREE.Vector3(), prey: null,
      // Motion: how fast it is turning, its lean to the ground, and a pace of
      // its own so a herd does not walk in lockstep.
      yawVel: 0, pitch: 0, roll: 0, y: 0, pace: rnd(0.85, 1.15),
      steerAt: Math.random() * STEER_EVERY, avoid: 0, corpse: 0,
    };
    this.measure(a);
    this.place(a);
    a.y = a.pos.y;
    this.all.push(a);
    return a;
  }

  /** Put an animal somewhere inland and walkable. */
  place(a) {
    for (let i = 0; i < 200; i++) {
      const ang = Math.random() * TAU;
      const r = rnd(20, 330);
      const x = this.home.x + Math.cos(ang) * r;
      const z = this.home.z + Math.sin(ang) * r;
      if (coastDistance(x, z) < 12) continue;
      const h = heightAt(x, z);
      if (h > 2.5 && h < 95) { a.pos.set(x, h, z); return; }
    }
    a.pos.set(this.home.x, heightAt(this.home.x, this.home.z), this.home.z);
  }

  /** Body length, width and radius, from whichever body it has now. */
  measure(a) {
    const size = new THREE.Box3().setFromObject(a.rig.group).getSize(new THREE.Vector3());
    a.len = Math.max(size.x, size.z) || 3;
    a.width = Math.min(size.x, size.z) || 1;
    a.radius = Math.max(0.5, a.width * 0.45);
    a.tall = size.y || 2;
  }

  /** Somewhere an animal can stand: land, not too steep, not up in the range. */
  footing(x, z) {
    if (coastDistance(x, z) < 8) return false;
    const h = heightAt(x, z);
    if (h > 150 || h < 1.5) return false;
    const e = 2;
    const slope = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return slope < MAX_SLOPE * 1.1;
  }

  /**
   * Look ahead along the way it wants to go, and a few ways either side, and
   * take the best: clear of trunks and rocks, off the cliffs and out of the
   * sea, and as close to where it meant to go as that allows. Keeps to the
   * side it chose last time unless that closes, so it does not dither.
   */
  steer(a, want) {
    const reach = a.radius + 2.5 + Math.abs(a.speed) * 1.8;
    const solids = this.terrain ? this.terrain.solidsNear(a.pos.x, a.pos.z, reach + 4, this._near) : [];
    let best = 0, bestCost = Infinity;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
      const dir = want + off;
      const dx = Math.sin(dir), dz = Math.cos(dir);
      let cost = Math.abs(off) * 1.2 + (Math.sign(off) !== Math.sign(a.avoid) && off ? 0.4 : 0);
      if (!this.footing(a.pos.x + dx * reach, a.pos.z + dz * reach)) cost += 20;
      else if (!this.footing(a.pos.x + dx * reach * 0.5, a.pos.z + dz * reach * 0.5)) cost += 20;
      for (const p of solids) {
        // Distance from the prop's axis to the path ahead.
        const px = p.x - a.pos.x, pz = p.z - a.pos.z;
        const t = Math.min(reach, Math.max(0, px * dx + pz * dz));
        const gap = Math.hypot(px - dx * t, pz - dz * t) - p.hit - a.radius;
        if (gap < 0.6) cost += 8 * (1 - t / (reach + 1)) + 4;
      }
      if (cost < bestCost) { bestCost = cost; best = off; }
    }
    a.avoid = best;
    a.blocked = bestCost >= 20;
  }

  roam(a) {
    const ang = Math.random() * TAU;
    const r = rnd(12, 55);
    let x = a.pos.x + Math.cos(ang) * r;
    let z = a.pos.z + Math.sin(ang) * r;
    if (!this.footing(x, z) || heightAt(x, z) > 100) {
      x = a.pos.x + (this.home.x - a.pos.x) * 0.4;
      z = a.pos.z + (this.home.z - a.pos.z) * 0.4;
    }
    a.target.set(x, 0, z);
  }

  /** Nearest thing a predator would eat: any herbivore, or the player. */
  findPrey(hunter, player, playerHuntable) {
    let best = null, bestD = hunter.sp.sight;
    for (const a of this.all) {
      if (a.dead || a === hunter || a.sp.diet !== 'plants') continue;
      const d = Math.hypot(a.pos.x - hunter.pos.x, a.pos.z - hunter.pos.z);
      // Big game is worth chasing further, but a raptor will not take on a sauropod.
      if (hunter.sp.scale < 1.5 && a.sp.scale > 2.2) continue;
      if (d < bestD) { bestD = d; best = a; }
    }
    // A person is prey too, if they are on land — you, or any of the others.
    let who = null, whoD = bestD * 0.85;
    const consider = (w, pos) => {
      const d = Math.hypot(pos.x - hunter.pos.x, pos.z - hunter.pos.z);
      if (d < whoD) { whoD = d; who = w; }
    };
    if (playerHuntable) consider('player', player.pos);
    for (const o of this.others) if (o.onLand) consider({ remote: o.id, pos: o.pos }, o.pos);
    if (who) return { who, pos: who === 'player' ? player.pos : who.pos, dist: whoD };
    return best ? { animal: best, pos: best.pos, dist: bestD } : null;
  }

  /** Closest predator that is actively hunting something near this herbivore. */
  threatNear(a) {
    let best = null, bestD = a.sp.flee;
    for (const p of this.all) {
      if (p.dead || p.sp.diet !== 'meat') continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { pred: best, dist: bestD } : null;
  }

  update(dt, time, player, playerOnLand) {
    if (this.follow) {
      for (const a of this.all) this.shadow(a, dt, time, player);
      return;
    }
    for (const a of this.all) {
      if (a.dead) {
        // A kill lies where it fell for a while, then is gone.
        if (a.corpse > 0) {
          a.corpse -= dt;
          if (a.corpse <= 0) a.rig.group.visible = false;
          else this.draw(a, dt, time, player);
        }
        a.respawn -= dt;
        if (a.respawn <= 0) {
          a.dead = false;
          a.hp = a.sp.hp;
          a.state = 'wander';
          a.corpse = 0;
          a.sink = 0;
          a.settled = false;
          a.settleAt = 0;
          a.roll = a.pitch = a.yawVel = a.speed = 0;
          a.rig.group.visible = true;
          this.place(a);
          a.y = a.pos.y;
        }
        continue;
      }
      this.think(a, dt, player, playerOnLand);
      this.move(a, dt);
      this.draw(a, dt, time, player);
    }
  }

  // ── playing together ───────────────────────────────────────────────────────
  /** Every animal: [x, z, heading, speed, state, dead, striking], in the same order everywhere. */
  snapshot() {
    const r = (v, k = 10) => Math.round(v * k) / k;
    return this.all.map(a => [r(a.pos.x), r(a.pos.z), r(a.heading, 100), r(a.speed),
                              STATES.indexOf(a.state), a.dead ? 1 : 0,
                              a.bite > a.sp.biteEvery - 0.5 ? 1 : 0]);
  }

  /** The host's animals, as they were a moment ago; shadow() carries them on from there. */
  adopt(list) {
    const now = performance.now() / 1000;
    list.forEach((st, i) => {
      const a = this.all[i];
      if (!a || !Array.isArray(st)) return;
      const [x, z, h, speed, state, dead, strike] = st;
      a.net = { x, z, h, speed, strike, at: now };
      a.state = STATES[state] || 'wander';
      if (dead && !a.dead) {
        a.dead = true;
        a.speed = 0;
        a.corpse = CORPSE_TIME;
        if (a.rig.model) playState(a.rig, 'death', 0.2);
      } else if (!dead && a.dead) {
        // Back again somewhere else: as update() brings one back.
        a.dead = false;
        a.corpse = a.sink = 0;
        a.settled = false;
        a.settleAt = 0;
        a.roll = a.pitch = a.yawVel = 0;
        a.rig.group.visible = true;
        a.pos.set(x, heightAt(x, z), z);
        a.y = a.pos.y;
      }
      if (Math.hypot(x - a.pos.x, z - a.pos.z) > 30) { a.pos.set(x, heightAt(x, z), z); a.y = a.pos.y; a.heading = h; }
    });
  }

  /**
   * Following the host: go where it said, carried on at the speed and
   * heading it said, and eased onto that course; nothing decided here.
   */
  shadow(a, dt, time, player) {
    if (a.dead) {
      if (a.corpse > 0) {
        a.corpse -= dt;
        if (a.corpse <= 0) a.rig.group.visible = false;
        else this.draw(a, dt, time, player);
      }
      return;
    }
    const n = a.net;
    if (n) {
      const t = performance.now() / 1000 - n.at;
      const tx = n.x + Math.sin(n.h) * n.speed * t, tz = n.z + Math.cos(n.h) * n.speed * t;
      const k = Math.min(1, dt * 3);
      const before = a.heading;
      a.pos.x += Math.sin(a.heading) * a.speed * dt + (tx - a.pos.x) * k;
      a.pos.z += Math.cos(a.heading) * a.speed * dt + (tz - a.pos.z) * k;
      a.heading = wrap(a.heading + wrap(n.h - a.heading) * k);
      a.yawVel = wrap(a.heading - before) / Math.max(dt, 1e-4);
      a.speed += (n.speed - a.speed) * k;
      a.bite = n.strike ? a.sp.biteEvery : 0;
    }
    a.pos.y = heightAt(a.pos.x, a.pos.z);
    this.fitGround(a, dt);
    this.draw(a, dt, time, player);
  }

  think(a, dt, player, playerOnLand) {
    const sp = a.sp;
    a.timer -= dt;
    if (a.bite > 0) a.bite -= dt;

    if (sp.diet === 'meat' && a.state !== 'feed') {
      if (!a.prey || a.prey.dead || a.timer <= 0) {
        const found = this.findPrey(a, player, playerOnLand);
        if (found) {
          a.prey = found.animal || found.who;
          a.state = 'hunt';
        } else if (a.state === 'hunt') {
          a.state = 'wander';
          a.prey = null;
        }
        a.timer = rnd(1.5, 3.5);
      }
      if (a.state === 'hunt') {
        const tgt = a.prey === 'player' ? player.pos : a.prey && a.prey.pos;
        // Someone else gone back to sea, or out of the game, is no longer prey.
        const gone = a.prey?.remote && !this.others.some(o => o.id === a.prey.remote && o.onLand);
        if (!tgt || (a.prey === 'player' && !playerOnLand) || gone) { a.state = 'wander'; a.prey = null; }
        else {
          const d = Math.hypot(tgt.x - a.pos.x, tgt.z - a.pos.z);
          if (d > sp.giveUp) { a.state = 'wander'; a.prey = null; }
          else if (d < sp.reach && a.bite <= 0) {
            a.bite = sp.biteEvery;
            if (a.prey === 'player') this.events.push({ damage: sp.damage, label: sp.label });
            else if (a.prey.remote) this.events.push({ damage: sp.damage, label: sp.label, to: a.prey.remote });
            else this.wound(a, a.prey);
          }
        }
      }
    } else {
      const threat = this.threatNear(a);
      if (threat) { a.state = 'flee'; a.threat = threat.pred; }
      else if (a.state === 'flee') { a.state = 'wander'; a.threat = null; }
    }

    if (a.state === 'feed' && a.timer <= 0) { a.state = 'wander'; a.timer = rnd(3, 8); this.roam(a); }
    if (a.state === 'wander' && a.timer <= 0) {
      // Grazers stop to feed; everything stops now and then to stand and look.
      const r = Math.random();
      a.state = sp.diet === 'plants' && r < 0.45 ? 'graze' : r < 0.6 ? 'rest' : 'wander';
      a.timer = a.state === 'wander' ? rnd(6, 14) : rnd(4, 10);
      this.roam(a);
    }
    if ((a.state === 'graze' || a.state === 'rest') && a.timer <= 0) { a.state = 'wander'; a.timer = rnd(6, 14); this.roam(a); }
  }

  wound(hunter, victim) {
    victim.hp -= hunter.sp.damage * 3.2;      // animals go down faster than the player
    victim.state = 'flee';
    victim.threat = hunter;
    if (victim.hp <= 0) {
      victim.dead = true;
      victim.speed = 0;
      victim.corpse = CORPSE_TIME;
      victim.respawn = CORPSE_TIME + rnd(20, 80);
      if (victim.rig.model) playState(victim.rig, 'death', 0.2);
      // The hunter stays to feed.
      hunter.state = 'feed';
      hunter.timer = rnd(12, 22);
      hunter.feedAt = victim.pos;
      hunter.prey = null;
      this.kills.push({ hunter: hunter.sp.label, victim: victim.sp.label, pos: victim.pos.clone() });
    }
  }

  move(a, dt) {
    const sp = a.sp;
    const walk = sp.walk * a.pace;
    let want = a.heading, goal = 0;

    if (a.state === 'hunt') {
      const tgt = a.prey === 'player' ? this._playerPos : (a.prey && a.prey.pos);
      if (tgt) {
        const dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        want = Math.atan2(dx, dz);
        // Close the last few metres at a walk, and stop to strike — never back off.
        goal = d < sp.reach * 0.9 ? 0 : d < sp.reach * 3 ? THREE.MathUtils.lerp(walk, sp.speed, (d - sp.reach) / (sp.reach * 2)) : sp.speed;
      }
    } else if (a.state === 'flee' && a.threat) {
      want = Math.atan2(a.pos.x - a.threat.pos.x, a.pos.z - a.threat.pos.z);
      goal = sp.speed;
    } else if (a.state === 'feed' && a.feedAt) {
      const dx = a.feedAt.x - a.pos.x, dz = a.feedAt.z - a.pos.z, d = Math.hypot(dx, dz);
      want = Math.atan2(dx, dz);
      goal = d > sp.reach ? walk : 0;
    } else if (a.state === 'wander') {
      const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 3) this.roam(a);
      want = Math.atan2(dx, dz);
      goal = walk * THREE.MathUtils.smoothstep(d, 0, 6);
    }

    // Look ahead every so often, and bend the course round what is in the way.
    a.steerAt -= dt;
    if (a.steerAt <= 0 && (goal > 0 || Math.abs(a.speed) > 0.1)) {
      a.steerAt = STEER_EVERY;
      this.steer(a, want);
      if (a.blocked && a.state === 'wander') this.roam(a);
    }
    if (goal > 0) want += a.avoid;

    // Turning has momentum: it builds and eases off, and the faster an animal
    // goes the wider it turns. A big animal does not spin on the spot; it
    // walks round.
    const delta = wrap(want - a.heading);
    if (goal > 0 || a.state === 'hunt' || a.state === 'feed') {
      if (Math.abs(delta) > 0.6 && goal < walk * 0.5 && a.state !== 'graze' && a.state !== 'rest') goal = walk * 0.5;
    }
    const moving = Math.min(1, Math.abs(a.speed) / Math.max(0.3, walk));
    const maxTurn = sp.turn * (0.25 + 0.75 * moving) * (1 - 0.35 * Math.min(1, Math.abs(a.speed) / sp.speed));
    const turnTo = THREE.MathUtils.clamp(delta * 1.8, -maxTurn, maxTurn);
    a.yawVel = approach(a.yawVel, turnTo, sp.turn * 1.6 * dt);
    a.heading = wrap(a.heading + a.yawVel * dt);
    // Slow into a sharp turn.
    goal *= 1 - 0.55 * Math.min(1, Math.abs(delta) / 1.4);
    a.speed = approach(a.speed, goal, (goal > a.speed ? sp.accel : sp.accel * 1.4) * dt);

    if (a.speed > 0.01) {
      const nx = a.pos.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.pos.z + Math.cos(a.heading) * a.speed * dt;
      if (this.footing(nx, nz) && heightAt(nx, nz) < 105) { a.pos.x = nx; a.pos.z = nz; }
      else { a.speed *= 0.5; a.steerAt = 0; if (a.state === 'wander') this.roam(a); }
    }
    // Never inside a trunk or a rock, whatever the steering missed.
    if (this.terrain) {
      a.pos.y = heightAt(a.pos.x, a.pos.z);
      this.terrain.collideReef(a.pos, a.radius, a.tall);
    }
    this.fitGround(a, dt);
  }

  /**
   * Stand on the ground as a body does, not as a point: pitch to the slope
   * between the fore and hind feet, roll a little to the slope across, and
   * ride at their average height rather than wherever the middle is.
   */
  fitGround(a, dt) {
    const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
    const reach = a.len * 0.32, side = a.width * 0.45;
    const x = a.pos.x, z = a.pos.z;
    const hc = heightAt(x, z);
    const hf = heightAt(x + fx * reach, z + fz * reach), hb = heightAt(x - fx * reach, z - fz * reach);
    const hl = heightAt(x + fz * side, z - fx * side), hr = heightAt(x - fz * side, z + fx * side);
    const pitch = THREE.MathUtils.clamp(Math.atan2(hf - hb, reach * 2), -0.45, 0.45);
    const roll = THREE.MathUtils.clamp(Math.atan2(hl - hr, side * 2) * 0.6, -0.2, 0.2);
    const k = Math.min(1, dt * 5);
    a.pitch += (pitch - a.pitch) * k;
    a.roll += (roll - a.roll) * k;
    const y = hc * 0.5 + (hf + hb) * 0.25;
    a.y += (y - a.y) * Math.min(1, dt * 10);
    a.pos.y = hc;
  }

  draw(a, dt, time, player) {
    const dist = Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
    const visible = dist < DRAW_RANGE;
    a.rig.group.visible = visible && (!a.dead || a.corpse > 0);
    if (!a.rig.group.visible) return;

    const { rig, sp } = a;
    // A dead animal on the procedural body rolls onto its side.
    if (a.dead && !rig.model) a.roll += (1.35 - a.roll) * Math.min(1, dt * 3);
    rig.group.position.set(a.pos.x, a.y + liftOf(a), a.pos.z);
    rig.group.rotation.set(-a.pitch, a.heading, a.roll, 'YXZ');

    if (rig.model) {
      if (a.dead) {
        playState(rig, 'death', 0.2);
        if (rig.mixer) rig.mixer.update(dt);
        this.settle(a);
        return;
      }
      const alert = a.state === 'hunt' || a.state === 'flee' ? 1 : 0;
      driveGait(rig, a.speed, dt, {
        alert, attack: !!rig.actions.attack && a.bite > sp.biteEvery - 0.5,
      });
      return;
    }
    if (a.dead) return;

    a.stride += a.speed * dt * (3.0 / Math.max(0.6, sp.scale * 0.5));
    const swing = Math.sin(a.stride);
    const gait = 0.12 + Math.min(Math.abs(a.speed) / sp.speed, 1) * 0.55;
    for (let i = 0; i < rig.legs.length; i++) {
      const phase = i % 2 === 0 ? swing : -swing;
      rig.legs[i].rotation.x = phase * gait;
      const knee = rig.knees[i];
      // Fold the knee as the foot comes forward, straighten it on the push.
      if (knee) knee.rotation.x = knee.userData.rest - Math.max(0, phase) * gait * 0.85;
    }
    const graze = a.state === 'graze' || a.state === 'feed' ? 1 : 0;
    rig.neck.rotation.x = THREE.MathUtils.lerp(rig.neck.rotation.x,
      graze * 0.85 + (a.state === 'hunt' ? -0.12 : 0), Math.min(1, dt * 2));
    rig.tail.rotation.y = Math.sin(a.stride * 0.5) * 0.3 - a.yawVel * 0.25;
    rig.group.position.y += Math.abs(Math.sin(a.stride)) * 0.03 * sp.scale;
  }

  /**
   * Bring a falling body down onto the ground. The death clip collapses the
   * skeleton about its root, but the root is where the animal stood — so as
   * the body goes down, lower the whole rig until its lowest bone is as close
   * to the ground as the feet were when it fell.
   */
  settle(a) {
    const rig = a.rig;
    const death = rig.actions.death;
    const falling = death && death.time < death.getClip().duration;
    a.settleAt = (a.settleAt ?? 0) - 1;
    // The skinned body itself, as posed — bones alone would leave the torso
    // floating, since its skin hangs well below the spine. A few looks while
    // it falls, and one when it has come to rest; then the drop is fixed.
    if ((falling && a.settleAt <= 0) || (!falling && !a.settled)) {
      a.settleAt = 12;
      if (!falling) a.settled = true;
      rig.group.position.y = a.y + liftOf(a);
      rig.group.updateMatrixWorld(true);
      const box = this._box || (this._box = new THREE.Box3());
      box.setFromObject(rig.root, true);
      const ground = heightAt(a.pos.x, a.pos.z);
      a.sink = Math.max(a.sink || 0, box.min.y - ground);
    }
    rig.group.position.y = a.y + liftOf(a) - (a.sink || 0);
  }

  /** Called by the game each frame so hunters can chase the player. */
  setPlayerPos(p) { this._playerPos = p; }

  pick(origin, dir, maxDist = 30) {
    let best = null, bestScore = -Infinity;
    for (const a of this.all) {
      if (a.dead || !a.rig.group.visible) continue;
      const dx = a.pos.x - origin.x, dy = (a.pos.y + liftOf(a)) - origin.y, dz = a.pos.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > maxDist) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (dist || 1);
      if (dot < 0.95) continue;
      const score = dot * 2 - dist / maxDist;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  get alive() { return this.all.filter(a => !a.dead).length; }
}
