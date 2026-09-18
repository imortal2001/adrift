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
import { ModelLibrary, playState } from './models.js';

const TAU = Math.PI * 2;
const DRAW_RANGE = 240;

// How high each body stands is measured from the finished model at build time
// (see buildBody), not guessed — otherwise changing a leg buries the animal.
const rnd = (a, b) => a + Math.random() * (b - a);

/** How far above the ground a body's origin sits. A glTF rig is already at
 *  world scale; the procedural one is scaled by its group. */
const liftOf = a => (a.rig.model ? a.rig.stand : a.rig.stand * a.sp.scale);

export const SPECIES = {
  sauropod: {
    label: 'Sauropod', count: 5, diet: 'plants', scale: 3.0,
    speed: 1.3, turn: 0.6, sight: 40, hp: 400, flee: 26,
    body: 0x6b7a58, belly: 0x93a279,
    build: { legs: 4, neck: 3.4, tail: 3.6, head: 0.55, plates: false, crest: false, arms: null },
  },
  stegosaur: {
    label: 'Stegosaur', count: 5, diet: 'plants', scale: 1.5,
    speed: 1.9, turn: 1.1, sight: 34, hp: 200, flee: 22,
    body: 0x6d5f3c, belly: 0x9a8a5e,
    build: { legs: 4, neck: 0.7, tail: 2.4, head: 0.5, plates: true, crest: false, arms: null },
  },
  parasaur: {
    label: 'Parasaur', count: 8, diet: 'plants', scale: 1.25,
    speed: 4.6, turn: 2.0, sight: 44, hp: 90, flee: 34,
    body: 0x8a7b52, belly: 0xc0ae7d,
    build: { legs: 4, neck: 1.2, tail: 2.2, head: 0.55, plates: false, crest: true, arms: null },
  },
  raptor: {
    label: 'Raptor', count: 6, diet: 'meat', scale: 0.95, pack: true,
    speed: 5.2, turn: 2.8, sight: 40, hp: 70,
    damage: 6, reach: 2.4, biteEvery: 1.7, giveUp: 60,
    body: 0x8a5a33, belly: 0xc2a071,
    build: { legs: 2, neck: 0.9, tail: 2.0, head: 0.7, plates: false, crest: false, arms: 'raptor', sickle: true },
  },
  tyrannosaur: {
    label: 'Tyrannosaur', count: 2, diet: 'meat', scale: 2.1,
    speed: 4.4, turn: 1.4, sight: 52, hp: 320,
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
  constructor(scene, homeHint) {
    this.scene = scene;
    this.all = [];
    this.library = new ModelLibrary();
    this.upgraded = [];        // species that swapped to a glTF body
    this.events = [];          // damage dealt to the player
    this.kills = [];           // "X brought down a Y", for flavour near the player
    this.home = homeHint;      // a point on land to seed around

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
    };
    this.place(a);
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

  roam(a) {
    const ang = Math.random() * TAU;
    const r = rnd(12, 55);
    let x = a.pos.x + Math.cos(ang) * r;
    let z = a.pos.z + Math.sin(ang) * r;
    if (coastDistance(x, z) < 10 || heightAt(x, z) > 100) {
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
    if (playerHuntable) {
      const d = Math.hypot(player.pos.x - hunter.pos.x, player.pos.z - hunter.pos.z);
      if (d < bestD * 0.85) return { player: true, pos: player.pos, dist: d };
    }
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
    for (const a of this.all) {
      if (a.dead) {
        a.respawn -= dt;
        if (a.respawn <= 0) {
          a.dead = false;
          a.hp = a.sp.hp;
          a.state = 'wander';
          a.rig.group.visible = true;
          this.place(a);
        }
        continue;
      }
      this.think(a, dt, player, playerOnLand);
      this.move(a, dt);
      this.draw(a, dt, time, player);
    }
  }

  think(a, dt, player, playerOnLand) {
    const sp = a.sp;
    a.timer -= dt;
    if (a.bite > 0) a.bite -= dt;

    if (sp.diet === 'meat') {
      if (!a.prey || a.prey.dead || a.timer <= 0) {
        const found = this.findPrey(a, player, playerOnLand);
        if (found) {
          a.prey = found.animal || 'player';
          a.state = 'hunt';
        } else if (a.state === 'hunt') {
          a.state = 'wander';
          a.prey = null;
        }
        a.timer = rnd(1.5, 3.5);
      }
      if (a.state === 'hunt') {
        const tgt = a.prey === 'player' ? player.pos : a.prey && a.prey.pos;
        if (!tgt || (a.prey === 'player' && !playerOnLand)) { a.state = 'wander'; a.prey = null; }
        else {
          const d = Math.hypot(tgt.x - a.pos.x, tgt.z - a.pos.z);
          if (d > sp.giveUp) { a.state = 'wander'; a.prey = null; }
          else if (d < sp.reach && a.bite <= 0) {
            a.bite = sp.biteEvery;
            if (a.prey === 'player') this.events.push({ damage: sp.damage, label: sp.label });
            else this.wound(a, a.prey);
          }
        }
      }
    } else {
      const threat = this.threatNear(a);
      if (threat) { a.state = 'flee'; a.threat = threat.pred; }
      else if (a.state === 'flee') { a.state = 'wander'; a.threat = null; }
    }

    if (a.state === 'wander' && a.timer <= 0) {
      a.state = sp.diet === 'plants' && Math.random() < 0.5 ? 'graze' : 'wander';
      a.timer = rnd(4, 11);
      this.roam(a);
    }
    if (a.state === 'graze' && a.timer <= 0) { a.state = 'wander'; a.timer = rnd(5, 12); this.roam(a); }
  }

  wound(hunter, victim) {
    victim.hp -= hunter.sp.damage * 3.2;      // animals go down faster than the player
    victim.state = 'flee';
    victim.threat = hunter;
    if (victim.hp <= 0) {
      victim.dead = true;
      victim.rig.group.visible = false;
      victim.respawn = rnd(50, 110);
      hunter.state = 'wander';
      hunter.prey = null;
      this.kills.push({ hunter: hunter.sp.label, victim: victim.sp.label, pos: victim.pos.clone() });
    }
  }

  move(a, dt) {
    const sp = a.sp;
    let want = a.heading, drive = 0;

    if (a.state === 'hunt') {
      const tgt = a.prey === 'player' ? this._playerPos : (a.prey && a.prey.pos);
      if (tgt) {
        const dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        want = Math.atan2(dx, dz);
        drive = d < sp.reach * 0.75 ? -0.5 : d < sp.reach ? 0 : 1;
      }
    } else if (a.state === 'flee' && a.threat) {
      want = Math.atan2(a.pos.x - a.threat.pos.x, a.pos.z - a.threat.pos.z);
      drive = 1;
    } else if (a.state === 'graze') {
      drive = 0;
    } else {
      const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
      if (Math.hypot(dx, dz) < 3) this.roam(a);
      want = Math.atan2(dx, dz);
      drive = 0.65;
    }

    const delta = ((want - a.heading + Math.PI * 3) % TAU) - Math.PI;
    a.heading += THREE.MathUtils.clamp(delta, -sp.turn * dt, sp.turn * dt);
    const goal = sp.speed * drive;
    a.speed += (goal - a.speed) * Math.min(1, dt * 2.2);

    if (Math.abs(a.speed) > 0.01) {
      const nx = a.pos.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.pos.z + Math.cos(a.heading) * a.speed * dt;
      // Stay inland and off the cliffs.
      if (coastDistance(nx, nz) > 6 && heightAt(nx, nz) < 105) { a.pos.x = nx; a.pos.z = nz; }
      else { a.heading += 2.2 * dt * 3; this.roam(a); }
    }
    a.pos.y = heightAt(a.pos.x, a.pos.z);
  }

  draw(a, dt, time, player) {
    const dist = Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
    const visible = dist < DRAW_RANGE;
    a.rig.group.visible = visible && !a.dead;
    if (!visible) return;

    const { rig, sp } = a;
    rig.group.position.set(a.pos.x, a.pos.y + liftOf(a), a.pos.z);
    rig.group.rotation.y = a.heading;

    if (rig.model) {
      const fast = Math.abs(a.speed) > sp.speed * 0.55;
      const moving = Math.abs(a.speed) > 0.15;
      playState(rig, a.bite > sp.biteEvery - 0.35 && rig.actions.attack ? 'attack'
                   : moving ? (fast ? 'run' : 'walk') : 'idle');
      if (rig.mixer) rig.mixer.update(dt);
      return;
    }

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
    const graze = a.state === 'graze' ? 1 : 0;
    rig.neck.rotation.x = THREE.MathUtils.lerp(rig.neck.rotation.x,
      graze * 0.85 + (a.state === 'hunt' ? -0.12 : 0), Math.min(1, dt * 2));
    rig.tail.rotation.y = Math.sin(a.stride * 0.5) * 0.3;
    rig.group.position.y += Math.abs(Math.sin(a.stride)) * 0.03 * sp.scale;
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
