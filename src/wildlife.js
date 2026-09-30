// ── Wildlife ─────────────────────────────────────────────────────────────────
// An ecosystem rather than a set of props. Predators hunt whatever prey is
// nearest — herbivores included — herbivores watch for predators and bolt, and
// a kill removes an animal until the population tops itself back up. You are
// simply another entry in the prey table.
//
// Every animal is simulated wherever it is; only the ones near the viewer are
// drawn and posed.

import * as THREE from 'three';
import { heightAt, isLand, coastDistance, freshWaterAt, landAt, slopeAt, moistureAt, forestAt, TREELINE,
         RIVERS, LAKES, riverCourse } from './terrain.js';
import { caveAt } from './caves.js';
import { ModelLibrary, playState, driveGait, plantFeet } from './models.js';
import { MOTION, prepareDino, poseDino } from './dinopose.js';

const TAU = Math.PI * 2;
const DRAW_RANGE = 240;
const CORPSE_TIME = 35;        // seconds a kill lies where it fell
const STEER_EVERY = 0.2;       // seconds between an animal's look-aheads
const MAX_SLOPE = 0.5;         // steeper than this is a cliff to an animal
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const STATES = ['wander', 'graze', 'rest', 'hunt', 'flee', 'feed', 'defend'];
const approach = (v, goal, step) => v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);

// How high each body stands is measured from the finished model at build time
// (see buildBody), not guessed — otherwise changing a leg buries the animal.
const rnd = (a, b) => a + Math.random() * (b - a);

/** How far above the ground a body's origin sits. A glTF rig is already at
 *  world scale; the procedural one is scaled by its group. */
const liftOf = a => (a.rig.model ? a.rig.stand : a.rig.stand * a.sp.scale);

export const SPECIES = {
  sauropod: {
    label: 'Sauropod', habitat: 'the araucaria woods and their edges, the river corridors and lakeshores, the gentle hills; a herd round a leader', count: 5, diet: 'plants', scale: 3.0,
    speed: 2.0, walk: 1.1, accel: 0.35, turn: 0.32, sight: 40, hp: 400, flee: 26,
    body: 0x6b7a58, belly: 0x93a279,
    build: { legs: 4, neck: 3.4, tail: 3.6, head: 0.55, plates: false, crest: false, arms: null },
  },
  stegosaur: {
    label: 'Stegosaur', habitat: 'open fern plain and river flats near water, the forest edges; small groups', count: 5, diet: 'plants', scale: 1.5,
    speed: 1.5, walk: 0.8, accel: 0.8, turn: 0.7, sight: 34, hp: 200, flee: 22,
    // Too slow to get away: it turns its tail on a hunter and swings the
    // spikes sideways (an Allosaurus vertebra holds a healed thagomizer wound —
    // Carpenter et al. 2005), rather than run.
    defend: { range: 12, reach: 1.0, hit: 45 }, biteEvery: 2.2,
    body: 0x6d5f3c, belly: 0x9a8a5e,
    build: { legs: 4, neck: 0.7, tail: 2.4, head: 0.5, plates: true, crest: false, arms: null },
  },
  parasaur: {
    label: 'Parasaur', habitat: 'the river banks and lakes, the wet forest by them, the coastal lowland; herds round a leader', count: 8, diet: 'plants', scale: 1.25, herd: true,
    speed: 4.6, walk: 1.0, accel: 2.6, turn: 1.4, sight: 44, hp: 90, flee: 34,
    body: 0x8a7b52, belly: 0xc0ae7d,
    build: { legs: 4, neck: 1.2, tail: 2.2, head: 0.55, plates: false, crest: true, arms: null },
  },
  raptor: {
    label: 'Raptor', habitat: 'the forest edge, drier araucaria woodland, the edges of the fern plains, broken ground; loose mobs', count: 6, diet: 'meat', scale: 0.95, pack: true,
    speed: 4.6, walk: 0.8, accel: 4.5, turn: 2.4, sight: 40, hp: 70,
    damage: 6, reach: 2.4, biteEvery: 1.7, giveUp: 60,
    body: 0x8a5a33, belly: 0xc2a071,
    build: { legs: 2, neck: 0.9, tail: 2.0, head: 0.7, plates: false, crest: false, arms: 'raptor', sickle: true },
  },
  tyrannosaur: {
    label: 'Tyrannosaur', habitat: 'the river margins, the forest edges and the open plain; alone, or a pair', count: 2, diet: 'meat', scale: 2.1,
    speed: 4.4, walk: 1.3, accel: 1.8, turn: 0.9, sight: 52, hp: 320,
    damage: 26, reach: 4.2, biteEvery: 2.6, giveUp: 90,
    body: 0x55483a, belly: 0x8a7a63,
    build: { legs: 2, neck: 1.1, tail: 2.8, head: 1.25, plates: false, crest: false, arms: 'tiny' },
  },
};

// ── where each lives ─────────────────────────────────────────────────────────
// Where on the continent each one is at home, from where its fossils lie and
// what it ate (a research summary, with sources, is in the README):
//
//   tyrannosaur  everywhere its prey is — no preference between river-channel
//                and floodplain beds (Lyson & Longrich 2011) — so the river
//                margins, the forest edges and the open plain; never the
//                mountains; alone, or a pair.
//   raptor       dromaeosaurs came from dune margins, deltas and forested
//                plains alike: at home on the forest edge, in drier araucaria
//                woodland and the edges of the fern plains, and the one that
//                will go up onto broken ground; loose mobs, not packs (Roach &
//                Brinkman 2007).
//   parasaur     hadrosaurs keep to the coasts and the river channels (15:1 in
//                channel sands, Lyson & Longrich; Butler & Barrett 2008): the
//                river banks and lakes, the wet riparian forest, the coastal
//                lowland; water-bound; herds of mixed ages.
//   stegosaur    the Morrison's seasonally green floodplain: open fern plain
//                and river floodplain near water, the forest edges; low
//                feeder; small groups (the only stegosaur herd trackways,
//                Cobos et al. 2024).
//   sauropod     high browsers of the conifers, ranging far from the rivers
//                and back (Engelmann et al. 2004): dry araucaria forest and
//                its edges, the river corridors and lakeshores, the gentle
//                hills; herds (Purgatoire trackways).
//
// A site's score is how much the species likes it; where it is placed, and
// where it wanders to next, is weighted by it. Nothing lives on cliffs, up on the
// cloud-forest tops of the range, or in caves.
const near = (d, r) => Math.exp(-Math.max(0, d) / r);
const peak = (x, at, w) => Math.max(0, 1 - Math.abs(x - at) / w);
const HABITAT = {
  tyrannosaur: s => 0.3 + near(s.edge, 90) * 1.3 + s.edgeForest * 0.8 + s.open * 0.5 + s.beach * 0.3 - s.closed * 0.6,
  raptor:      s => 0.3 + s.edgeForest * 1.0 + s.dryForest * 0.8 + s.open * (1 - s.wet) * 0.5 + near(s.edge, 40) * 0.4 +
                    s.mesa * 0.3 - s.beach * 0.5,
  // (The coastal lowland only where a river or a lake is near it: a herd
  // lives within reach of fresh water, not a trek of half a kilometre.)
  // (The wet forest by the water — riparian — not any damp forest: placed in
  // damp forest seven hundred metres from a river, a herd never drank.)
  parasaur:    s => 0.1 + near(s.edge, 25) * 1.6 + s.wetForest * near(s.edge, 200) * 0.9 + s.beach * near(s.edge, 150) * 0.5 +
                    s.open * near(s.edge, 80) * 0.4 - s.upland * 0.8,
  stegosaur:   s => 0.2 + s.open * 0.8 + near(s.edge, 90) * 1.5 + s.edgeForest * 0.6 + s.beach * 0.3 - s.closed * 0.8 -
                    s.upland * 0.6,
  sauropod:    s => 0.2 + s.dryForest * 1.1 + s.edgeForest * 0.8 + near(s.edge, 80) * 0.7 + s.open * 0.4 +
                    peak(s.h, 60, 50) * 0.4 - s.closed * s.wet * 0.6,
};
/** How steep a species will go: the raptor alone takes to broken ground. */
const SURE = { raptor: 0.42, tyrannosaur: 0.25, parasaur: 0.25, stegosaur: 0.22, sauropod: 0.24 };
/** How many keep together: tyrannosaurs alone; raptor mobs; herds. */
const GROUP = { tyrannosaur: 1, raptor: 3, parasaur: 8, stegosaur: 3, sauropod: 5 };

/** What kind of country (x, z) is, for the habitat scores. */
function siteAt(x, z) {
  const L = landAt(x, z);
  const slope = slopeAt(x, z);
  const wet = Math.min(1, moistureAt(x, z) + 0.35 * Math.max(0, Math.min(1, (90 - L.river) / 80)));
  const forest = forestAt(x, z, L, wet, slope);
  return {
    h: L.h, slope, wet, forest, edge: L.edge, mesa: L.mesa,
    open: Math.max(L.plain, 1 - forest * 1.4),
    closed: Math.max(0, (forest - 0.6) / 0.4),
    edgeForest: peak(forest, 0.4, 0.35),
    dryForest: forest * (1 - wet),
    wetForest: forest * wet,
    beach: L.m < 45 && L.h < 5 ? 1 : 0,
    upland: Math.max(0, Math.min(1, (L.h - 60) / 60)),
    cliff: L.cliff, mountain: L.mountain,
  };
}

/** How much a species likes (x, z): 0 where it will not go at all. */
function habitat(key, x, z) {
  const s = siteAt(x, z);
  if (s.h < 1.5 || s.h > TREELINE - 15 || s.mountain > 0.5 || s.cliff > 0.3 || s.slope > (SURE[key] ?? 0.3)) return 0;
  if (s.edge < 0.5) return 0;                                    // not in the water itself
  return Math.max(0.02, (HABITAT[key]?.(s) ?? 0.5) * (1 - s.slope / (SURE[key] ?? 0.3) * 0.5));
}

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
            prepareDino(rig);
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
    // Every GROUP[key]-th of a kind leads; the rest keep with it.
    const same = this.all.filter(o => o.key === key);
    const size = GROUP[key] || 1;
    const leader = same.length % size === 0 ? null : same[same.length - (same.length % size)];
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
      leader, thirst: rnd(60, 300), drinkAt: null,
    };
    this.measure(a);
    this.place(a);
    a.y = a.pos.y;
    this.all.push(a);
    return a;
  }

  /**
   * Put an animal where its kind lives: with its group, if it keeps one, and
   * otherwise at a spot drawn by how well it suits the species (habitat()),
   * so they are commonest where they belong and still turn up elsewhere.
   */
  place(a) {
    const lead = a.leader && !a.leader.dead ? a.leader : null;
    if (lead) {
      for (let i = 0; i < 40; i++) {
        const ang = Math.random() * TAU, r = rnd(4, 16);
        const x = lead.pos.x + Math.cos(ang) * r, z = lead.pos.z + Math.sin(ang) * r;
        if (this.footing(x, z)) { a.pos.set(x, heightAt(x, z), z); return; }
      }
    }
    const picks = [];
    let total = 0;
    for (let i = 0; i < 90; i++) {
      const ang = Math.random() * TAU, r = rnd(20, 380);
      const x = this.home.x + Math.cos(ang) * r, z = this.home.z + Math.sin(ang) * r;
      if (!this.footing(x, z)) continue;
      const w = habitat(a.key, x, z) ** 2;
      if (w > 0) { picks.push([x, z, w]); total += w; }
    }
    let pick = Math.random() * total;
    for (const [x, z, w] of picks) {
      if ((pick -= w) <= 0) { a.pos.set(x, heightAt(x, z), z); return; }
    }
    a.pos.set(this.home.x, heightAt(this.home.x, this.home.z), this.home.z);
  }

  /** Somewhere to drink from: a river bank or a lake shore, the nearest it can walk to, up to half a kilometre off. */
  /** How near the water it stands to drink: its mouth reaches that far ahead of it, head down. */
  drinkReach(a) { return THREE.MathUtils.clamp((a.len || 3) * 0.26, 0.8, 3.5); }

  waterNear(a) {
    const reach = this.drinkReach(a);
    for (let d = 15; d <= 480; d += d < 240 ? 15 : 30) {
      const off = Math.random() * TAU;
      for (let k = 0; k < 16; k++) {
        const ang = off + (k / 16) * TAU, cx = Math.cos(ang), cz = Math.sin(ang);
        const x = a.pos.x + cx * d, z = a.pos.z + cz * d;
        const L = landAt(x, z);
        // (The band to stand in is narrow: a look near water walks back
        // along the line toward the animal to find it.)
        if (L.edge > 12) continue;
        for (let back = 0; back <= 14; back += 0.5) {
          const bx = x - cx * back, bz = z - cz * back, e = landAt(bx, bz).edge;
          if (e > reach) break;
          if (e > 0.3 && this.footing(bx, bz) && this.walkable(a.pos.x, a.pos.z, bx, bz)) return { x: bx, z: bz };
        }
      }
    }
    return null;
  }

  /**
   * A stretch of the way toward the nearest fresh water anywhere — a river's
   * course or a lake — for one with none within reach: up to ~80 m along it,
   * somewhere it can stand and walk to.
   */
  freshWaterToward(a) {
    if (!this._fresh) {
      this._fresh = [];
      for (const rv of RIVERS) for (const p of riverCourse(rv, 20)) this._fresh.push(p);
      for (const L of LAKES) this._fresh.push({ x: L.x, z: L.z });
    }
    let best = null, bd = Infinity;
    for (const p of this._fresh) {
      const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd < 30) return null;
    for (const step of [80, 55, 35]) {
      const k = Math.min(1, step / bd);
      for (const side of [0, 0.35, -0.35, 0.7, -0.7]) {
        const ux = (best.x - a.pos.x) / bd, uz = (best.z - a.pos.z) / bd;
        const c = Math.cos(side), s_ = Math.sin(side), dx = ux * c - uz * s_, dz = ux * s_ + uz * c;
        const x = a.pos.x + dx * bd * k, z = a.pos.z + dz * bd * k;
        if (this.footing(x, z) && this.walkable(a.pos.x, a.pos.z, x, z)) return { x, z };
      }
    }
    return null;
  }

  /** The way to the nearest water from where it stands, if any is close: to face it and drink. */
  waterWay(a) {
    let best = null, bestD = Infinity;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * TAU, sx = Math.sin(ang), sz = Math.cos(ang);
      for (let r = 0.5; r <= 6; r += 0.5) {
        if (freshWaterAt(a.pos.x + sx * r, a.pos.z + sz * r)) { if (r < bestD) { bestD = r; best = ang; } break; }
      }
    }
    return best;
  }

  /** Can it get from one spot to the other in a straight line without wading anything deep — not across the river to the far bank? */
  walkable(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 3);
    for (let i = 1; i < n; i++) {
      const w = freshWaterAt(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
      if (w && w.depth > 0.5) return false;
    }
    return true;
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
  footing(x, z, wade = 0.5) {
    if (coastDistance(x, z) < 8) return false;
    const h = heightAt(x, z);
    if (h > 150 || h < 1.5) return false;
    // Not out into a lake or a river past their knees (see wade).
    const w = freshWaterAt(x, z);
    if (w && w.depth > wade) return false;
    return this.steepness(x, z) < MAX_SLOPE * 1.1;
  }

  /**
   * How far from somewhere it can stand (0: it can): too steep, or too deep.
   * Infinite at the sea, and up in the range.
   */
  badness(x, z, wade = 0.5) {
    if (coastDistance(x, z) < 8) return Infinity;
    const h = heightAt(x, z);
    if (h > 150 || h < 1.5) return Infinity;
    const w = freshWaterAt(x, z);
    return Math.max(0, this.steepness(x, z) - MAX_SLOPE * 1.1) + Math.max(0, (w ? w.depth : 0) - wade) * 4;
  }

  /**
   * How deep it will go into fresh water: to the knees, as a rule, but one
   * running from a hunter wades out as far as a third of its height — out of
   * reach of a tyrannosaur, for a sauropod.
   */
  wade(a) { return a.state === 'flee' ? Math.max(0.5, a.tall * 0.3) : 0.5; }

  steepness(x, z) {
    const e = 2;
    return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  }

  /**
   * Look ahead along the way it wants to go, and a few ways either side, and
   * take the best: clear of trunks and rocks, off the cliffs and out of the
   * sea, and as close to where it meant to go as that allows. Keeps to the
   * side it chose last time unless that closes, so it does not dither.
   */
  /** A big animal shoulders through ferns, cycads, palms and saplings: props slighter than this. */
  shoulders(a) { return a.radius > 0.9 ? Math.max(0.6, a.radius * 0.5) : 0; }

  steer(a, want) {
    const reach = a.radius + 2.5 + Math.abs(a.speed) * 1.8;
    const solids = this.terrain ? this.terrain.solidsNear(a.pos.x, a.pos.z, reach + 4, this._near) : [];
    let best = 0, bestCost = Infinity;
    // A big animal shoulders through ferns, cycads and palms, and a sauropod
    // through saplings too; only a real trunk turns it.
    const shoulders = this.shoulders(a);
    const wade = this.wade(a);
    // (Fleeing, and cornered — the water, a drop — it will bolt along the
    // bank rather than stand there; never back toward the hunter. Just going
    // about, with everything ahead shut, it turns right round.)
    const offs = a.state === 'flee' ? [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 1.9, -1.9, 2.2, -2.2]
               : a.state === 'hunt' ? [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]
                                    : [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, 2.7, -2.7, 3.1];
    let ahead = Infinity;
    for (const off of offs) {
      const dir = want + off;
      const dx = Math.sin(dir), dz = Math.cos(dir);
      let cost = Math.abs(off) * 1.2 + (Math.sign(off) !== Math.sign(a.avoid) && off ? 0.4 : 0);
      // The next step as well as the way ahead: a lip of steeper ground just
      // in front refuses every step (move), however clear it is beyond.
      if (!this.footing(a.pos.x + dx * reach, a.pos.z + dz * reach, wade)) cost += 20;
      else if (!this.footing(a.pos.x + dx * reach * 0.5, a.pos.z + dz * reach * 0.5, wade)) cost += 20;
      else if (!this.footing(a.pos.x + dx * 0.8, a.pos.z + dz * 0.8, wade)) cost += 20;
      for (const p of solids) {
        if (p.hit < shoulders) continue;
        // Distance from the prop's axis to the path ahead — only a prop that
        // is ahead. (Counted from where it stands as well, a trunk it was
        // already against shut every way alike, away from it too; so it took
        // the straightest, into the trunk again, and walked on the spot.)
        const px = p.x - a.pos.x, pz = p.z - a.pos.z;
        const along = px * dx + pz * dz;
        if (along <= 0) continue;
        const t = Math.min(reach, along);
        const gap = Math.hypot(px - dx * t, pz - dz * t) - p.hit - a.radius;
        if (gap < 0.6) cost += 8 * (1 - t / (reach + 1)) + 4;
      }
      if (cost < bestCost) { bestCost = cost; best = off; }
      if (Math.abs(off) < 2 && cost < ahead) ahead = cost;
    }
    a.avoid = best;
    a.blocked = ahead >= 20;
  }

  /**
   * Where to wander next. Down to the water every few minutes, to drink; with
   * the group, for those that keep one; otherwise the best of a few spots
   * round about for its kind, with a little chance in it so it does not
   * march to one spot and stay.
   */
  roam(a) {
    // Thirsty: to the water's edge, and stand there a while with the head down.
    if (a.thirst <= 0 && !a.drinkAt) {
      a.drinkAt = this.waterNear(a);
      if (!a.drinkAt) { a.thirst = rnd(60, 120); a.dry = (a.dry || 0) + 1; }
      else {
        a.dry = 0;
        // (Time enough to walk there, with the stops on the way; then it gives up for now.)
        a.drinkLimit = 60 + Math.hypot(a.drinkAt.x - a.pos.x, a.drinkAt.z - a.pos.z) / a.sp.walk * 1.8;
      }
    }
    if (a.drinkAt && a.drinkFor > (a.drinkLimit || 180)) { a.drinkAt = null; a.drinkFor = 0; a.thirst = rnd(40, 100); }
    if (a.drinkAt) {
      // There, or at the water's edge anywhere on the way: that will do.
      const edge = landAt(a.pos.x, a.pos.z).edge;
      if ((edge > -0.5 && edge < this.drinkReach(a)) || Math.hypot(a.pos.x - a.drinkAt.x, a.pos.z - a.drinkAt.z) < 1.5) {
        a.drinkAt = null;
        a.drinkFor = 0;
        a.thirst = rnd(180, 420);
        a.state = 'graze';
        a.drinking = true;             // head down to the water (dinopose.js), even a sauropod's
        a.faceTo = this.waterWay(a);   // turned to the water first, not drinking from the sand
        a.timer = rnd(8, 14);
        a.drinkUntil = this.clock + a.timer;   // (its own clock: a hunter's timer is its prey-scan's too)
        a.target.set(a.pos.x, 0, a.pos.z);
      } else a.target.set(a.drinkAt.x, 0, a.drinkAt.z);
      return;
    }
    const lead = a.leader && !a.leader.dead ? a.leader : null;
    // No water within reach, time and again: it (and so its herd, following)
    // sets off for the nearest there is, a stretch at a time — rather than
    // live out its days in country with none.
    if (!lead && a.dry >= 2) {
      const w = this.freshWaterToward(a);
      if (w) { a.target.set(w.x, 0, w.z); return; }
    }
    if (lead) {
      // Keep with the group: somewhere near where the leader is going.
      const c = lead.target && lead.state !== 'rest' ? lead.target : lead.pos;
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * TAU, r = rnd(3, 16);
        const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
        if (this.footing(x, z) && this.walkable(a.pos.x, a.pos.z, x, z)) { a.target.set(x, 0, z); return; }
      }
    }
    // A hunter goes where the herds are, now and then: toward one it could
    // walk to, stopping short of it — the hunt itself is sight's to start.
    if (a.sp.diet === 'meat' && Math.random() < 0.35) {
      const herds = this.all.filter(q => !q.dead && q.sp.diet === 'plants' && !(a.sp.scale < 1.5 && q.sp.scale >= 1.5) &&
                                         Math.hypot(q.pos.x - a.pos.x, q.pos.z - a.pos.z) < 400);
      const fits = herds.filter(q => q.sp.scale <= a.sp.scale), pool = fits.length ? fits : herds;
      const q = pool[Math.floor(Math.random() * pool.length)];
      if (q) {
        const d = Math.hypot(q.pos.x - a.pos.x, q.pos.z - a.pos.z), stop = rnd(20, 40);
        const k = Math.max(0, (d - stop) / d), x = a.pos.x + (q.pos.x - a.pos.x) * k, z = a.pos.z + (q.pos.z - a.pos.z) * k;
        if (this.footing(x, z) && this.walkable(a.pos.x, a.pos.z, x, z)) { a.target.set(x, 0, z); return; }
      }
    }
    const far = a.key === 'sauropod' ? 90 : 55;
    let best = null, bestScore = -1;
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * TAU, r = rnd(12, far);
      const x = a.pos.x + Math.cos(ang) * r, z = a.pos.z + Math.sin(ang) * r;
      // (Somewhere on its own side of the water: it does not wade a river.)
      if (!this.footing(x, z) || !this.walkable(a.pos.x, a.pos.z, x, z)) continue;
      // Drawn back toward the home range if it has strayed far out of it.
      const out = Math.max(0, Math.hypot(x - this.home.x, z - this.home.z) - 420) / 200;
      const score = habitat(a.key, x, z) - out + Math.random() * 0.35;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    if (!best) best = [a.pos.x + (this.home.x - a.pos.x) * 0.4, a.pos.z + (this.home.z - a.pos.z) * 0.4];
    a.target.set(best[0], 0, best[1]);
  }

  /** Nearest thing a predator would eat: any herbivore, or the player. */
  findPrey(hunter, player, playerHuntable) {
    let best = null, bestD = hunter.sp.sight;
    for (const a of this.all) {
      if (a.dead || a === hunter || a.sp.diet !== 'plants' ||
          (hunter.shun?.prey === a && this.clock < hunter.shun.until) ||
          (hunter.wary?.kind === a.key && this.clock < hunter.wary.until)) continue;
      const d = Math.hypot(a.pos.x - hunter.pos.x, a.pos.z - hunter.pos.z);
      // Big game is worth chasing further, but a raptor takes on nothing its
      // size or more: not a sauropod, and not an armoured stegosaur's tail.
      if (hunter.sp.scale < 1.5 && a.sp.scale >= 1.5) continue;
      // And anything well beyond its size — a grown sauropod, to a
      // tyrannosaur — only if it is right there: a hunter takes what it can
      // bring down. (A pack brings down more: a parasaur, to raptors.)
      const cost = d * (a.sp.scale > hunter.sp.scale * (hunter.sp.pack ? 1.5 : 1.2) ? 4 : 1);
      // (Nor anything across the river from it: it cannot get there.)
      if (cost < bestD && this.walkable(hunter.pos.x, hunter.pos.z, a.pos.x, a.pos.z)) { bestD = cost; best = a; }
    }
    // A person is prey too, if they are on land — you, or any of the others.
    let who = null, whoD = bestD * 0.85;
    const shunned = w => hunter.shun && this.clock < hunter.shun.until &&
      (w === 'player' ? hunter.shun.prey === 'player' : hunter.shun.prey === w.remote);
    const consider = (w, pos) => {
      if (shunned(w)) return;
      const d = Math.hypot(pos.x - hunter.pos.x, pos.z - hunter.pos.z);
      if (d < whoD && this.walkable(hunter.pos.x, hunter.pos.z, pos.x, pos.z)) { whoD = d; who = w; }
    };
    // Not anyone gone into a cave, past its mouth: too narrow for a dinosaur to follow (caves.js).
    const sheltered = p => (caveAt(p.x, p.z, p.y)?.s ?? 0) > 2.5;
    if (playerHuntable && !sheltered(player.pos)) consider('player', player.pos);
    for (const o of this.others) if (o.onLand && !sheltered(o.pos)) consider({ remote: o.id, pos: o.pos }, o.pos);
    if (who) return { who, pos: who === 'player' ? player.pos : who.pos, dist: whoD };
    return best ? { animal: best, pos: best.pos, dist: bestD } : null;
  }

  /** Closest predator that is actively hunting something near this herbivore. */
  threatNear(a) {
    let best = null, bestD = a.sp.flee;
    for (const p of this.all) {
      if (p.dead || p.sp.diet !== 'meat') continue;
      // A grown sauropod or stegosaur pays no mind to raptors going by: they
      // do not take anything its size (unless one is at it after all).
      if (p.sp.scale < 1.5 && a.sp.scale >= 1.5 && p.prey !== a) continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { pred: best, dist: bestD } : null;
  }

  update(dt, time, player, playerOnLand) {
    this.clock = (this.clock || 0) + dt;
    if (this.follow) {
      for (const a of this.all) this.shadow(a, dt, time, player);
      return;
    }
    this.spaceOut(dt);
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
          a.lay = a.layWas = undefined; a.laid = false;
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

  /**
   * Room for each: two animals closer than their bodies allow are eased
   * apart, as a herd keeps its spacing. Nothing kept them apart before —
   * followers make for spots round the leader, and walked into and through
   * one another (sauropods in each other's flanks a tenth of the time). Not a
   * hunter and what it is after, and only onto ground either would stand on.
   */
  spaceOut(dt) {
    const live = this._live || (this._live = []);
    live.length = 0;
    for (const a of this.all) if (!a.dead) live.push(a);
    const k = Math.min(1, dt * 3);
    for (let i = 0; i < live.length; i++) {
      const a = live[i], ra = Math.max(a.radius, (a.len || 2) * 0.22);
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (a.prey === b || b.prey === a) continue;
        const rb = Math.max(b.radius, (b.len || 2) * 0.22);
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), gap = ra + rb - d;
        if (gap <= 0) continue;
        const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
        // The lighter gives way more.
        const wa = b.sp.scale / (a.sp.scale + b.sp.scale), push = gap * k;
        const ax = a.pos.x - ux * push * wa, az = a.pos.z - uz * push * wa;
        const bx = b.pos.x + ux * push * (1 - wa), bz = b.pos.z + uz * push * (1 - wa);
        if (this.badness(ax, az, this.wade(a)) <= 0) { a.pos.x = ax; a.pos.z = az; }
        if (this.badness(bx, bz, this.wade(b)) <= 0) { b.pos.x = bx; b.pos.z = bz; }
      }
    }
  }

  // ── playing together ───────────────────────────────────────────────────────
  /** Every animal: [x, z, heading, speed, state, dead, striking, drinking], in the same order everywhere. */
  snapshot() {
    const r = (v, k = 10) => Math.round(v * k) / k;
    return this.all.map(a => [r(a.pos.x), r(a.pos.z), r(a.heading, 100), r(a.speed),
                              STATES.indexOf(a.state), a.dead ? 1 : 0,
                              a.bite > a.sp.biteEvery - 0.5 ? 1 : 0, a.drinking ? 1 : 0]);
  }

  /** The host's animals, as they were a moment ago; shadow() carries them on from there. */
  adopt(list) {
    const now = performance.now() / 1000;
    list.forEach((st, i) => {
      const a = this.all[i];
      if (!a || !Array.isArray(st)) return;
      const [x, z, h, speed, state, dead, strike, drink] = st;
      a.net = { x, z, h, speed, strike, at: now };
      a.state = STATES[state] || 'wander';
      a.drinking = !!drink;               // (the head down to the water, and a sauropod's neck with it)
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
        a.lay = a.layWas = undefined; a.laid = false;
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
    a.thirst -= dt;
    // Wounds mend, over five minutes or so, between one fight and the next.
    if (a.hp < a.sp.hp) a.hp = Math.min(a.sp.hp, a.hp + a.sp.hp * dt / 300);
    if (a.drinkAt) {
      a.drinkFor = (a.drinkFor || 0) + dt;
      // On its way down to drink, it stops at the first water it comes to.
      if (a.state === 'wander' && (a.drinkLook = (a.drinkLook || 0) - dt) <= 0) {
        a.drinkLook = 1;
        const e = landAt(a.pos.x, a.pos.z).edge;
        if (e > -0.5 && e < this.drinkReach(a)) this.roam(a);
      }
    }
    if (a.drinking && a.state !== 'graze') a.drinking = false;
    if (a.drinking && this.clock > a.drinkUntil) {
      a.drinking = false;
      a.state = 'wander';
      a.timer = rnd(6, 14);
      this.roam(a);
    }
    if (a.bite > 0) a.bite -= dt;

    if (sp.diet === 'meat' && a.state !== 'feed') {
      // The look round for prey keeps its own clock. On `timer` — which is
      // also how long a wander or a rest lasts — it set that back to a second
      // or two every frame a hunter had nothing in view, so an idle one never
      // finished a wander: it never chose where to go next, never lay up and
      // never went to drink, and walked on for ever toward wherever it last
      // meant to (for most, the world's origin, out to sea).
      a.scan = (a.scan ?? 0) - dt;
      if ((a.prey && a.prey.dead) || a.scan <= 0) {
        // Fed, or worn out with chasing, it lies up a while — though not
        // with something walking right up to it.
        const tired = a.tiredUntil > this.clock;
        let found = this.findPrey(a, player, playerOnLand);
        if (found && tired && found.dist > 15) found = null;
        // Mid-chase, it keeps after the one it has, unless another is a good
        // deal nearer.
        const had = a.state === 'hunt' && a.prey && !a.prey.dead ? (a.prey === 'player' ? player.pos : a.prey.pos) : null;
        const keep = found && had && found.dist > 0.6 * Math.hypot(had.x - a.pos.x, had.z - a.pos.z);
        if (keep) { /* after the one it has */ }
        else if (found) {
          a.prey = found.animal || found.who;
          a.state = 'hunt';
        } else if (a.state === 'hunt') {
          a.state = 'wander';
          a.prey = null;
        }
        a.scan = rnd(1.5, 3.5);
        // (While hunting, its timer is the chase's; out of it, a wander's own.)
        if (a.state === 'hunt') a.timer = a.scan;
      }
      if (a.state === 'hunt') {
        const tgt = a.prey === 'player' ? player.pos : a.prey && a.prey.pos;
        // Getting no nearer — close by, or not moving for being unable to go
        // on (the prey is somewhere it cannot get to: the waterline, a ledge)
        // — it gives up, and leaves that one be for a while. Prey that is
        // simply outrunning it, it keeps after at full tilt until too far
        // (giveUp, below): out in the open, a sprint alone is not a way out.
        if (tgt) {
          const d = Math.hypot(tgt.x - a.pos.x, tgt.z - a.pos.z);
          // (Across deep water from it — the far bank of a river — is out of
          // reach however near, and nearer there is no nearer at all.)
          a.reachAt = (a.reachAt || 0) - dt;
          if (a.reachAt <= 0) { a.reachAt = 1; a.across = !this.walkable(a.pos.x, a.pos.z, tgt.x, tgt.z); }
          if (a.nearest === undefined || (d < a.nearest - 0.5 && !a.across)) { a.nearest = d; a.nearestAt = this.clock; }
          // (Blocked counts too: running on the spot, its speed reads high while it goes nowhere.)
          else if (this.clock - a.nearestAt > 4 && d > sp.reach && (d < sp.reach + 8 || a.speed < sp.walk || a.blocked || a.across)) {
            a.shun = { prey: a.prey === 'player' ? 'player' : a.prey?.remote ?? a.prey, until: this.clock + 12 };
            a.state = 'wander'; a.prey = null; a.nearest = undefined;
            a.timer = rnd(6, 12);
            this.roam(a);
            // A breather before the next; after a few come to nothing, a rest.
            a.fails = (a.fails || 0) + 1;
            a.tiredUntil = this.clock + (a.fails >= 3 ? rnd(60, 150) : rnd(5, 12));
            if (a.fails >= 3) { a.fails = 0; a.state = 'rest'; a.timer = a.tiredUntil - this.clock; }
          }
        }
      } else a.nearest = undefined;
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
      if (threat && sp.defend && threat.dist < sp.defend.range) { a.state = 'defend'; a.threat = threat.pred; this.defend(a, threat); }
      else if (threat) { if (a.state !== 'flee') a.fleeFrom = this.clock; a.state = 'flee'; a.threat = threat.pred; }
      else if (a.state === 'flee' || a.state === 'defend') { a.state = 'wander'; a.threat = null; }
    }

    if (a.state === 'feed' && a.timer <= 0) { a.state = 'wander'; a.timer = rnd(3, 8); this.roam(a); }
    if (a.state === 'wander' && a.timer <= 0) {
      // Grazers stop to feed; everything stops now and then to stand and look.
      // (Not on its way down to drink: it goes straight there.)
      const r = a.drinkAt ? 1 : Math.random();
      a.state = sp.diet === 'plants' && r < 0.45 ? 'graze' : r < 0.6 ? 'rest' : 'wander';
      a.timer = a.state === 'wander' ? rnd(6, 14) : rnd(4, 10);
      this.roam(a);
    }
    if ((a.state === 'graze' || a.state === 'rest') && a.timer <= 0) { a.state = 'wander'; a.timer = rnd(6, 14); this.roam(a); }
  }

  /**
   * Standing its ground: the tail to the hunter, and — once it is behind, and
   * within the tail's reach — a swing. A hit hurts, and sends it off for a while.
   */
  defend(a, threat) {
    const t = threat.pred, sp = a.sp;
    const bx = -Math.sin(a.heading), bz = -Math.cos(a.heading);      // the way the tail points
    const dx = (t.pos.x - a.pos.x) / threat.dist, dz = (t.pos.z - a.pos.z) / threat.dist;
    const behind = bx * dx + bz * dz > 0.55;
    // (Only at one that is coming for it, or for one of its own: a hunter
    // after something else going by is let be, and one already struck and
    // backing off is let go, not struck again and again as it turns away.)
    const coming = t.state === 'hunt' && (t.prey === a || t.prey?.key === a.key);
    if (behind && coming && threat.dist < a.len * sp.defend.reach + t.radius && a.bite <= 0) {
      a.bite = sp.biteEvery;
      t.hp -= sp.defend.hit;
      // (Once struck, a hunter leaves that kind be a good while — whatever
      // else it gives up on meanwhile.)
      t.wary = { kind: a.key, until: this.clock + 90 };
      t.state = 'wander'; t.prey = null; t.nearest = undefined;
      t.timer = rnd(4, 8);
      // And it backs off, well away from the tail.
      const ax = t.pos.x + dx * 30, az = t.pos.z + dz * 30;
      if (this.footing(ax, az)) t.target.set(ax, 0, az); else this.roam(t);
      if (t.hp <= 0) {
        t.dead = true; t.speed = 0;
        t.corpse = CORPSE_TIME; t.respawn = CORPSE_TIME + rnd(20, 80);
        if (t.rig.model) playState(t.rig, 'death', 0.2);
        this.kills.push({ hunter: sp.label, victim: t.sp.label, pos: t.pos.clone() });
      }
    }
  }

  wound(hunter, victim) {
    victim.hp -= hunter.sp.damage * 3.2;      // animals go down faster than the player
    if (victim.state !== 'flee') victim.fleeFrom = this.clock;
    victim.state = 'flee';
    victim.threat = hunter;
    if (victim.hp <= 0) {
      victim.dead = true;
      victim.speed = 0;
      victim.corpse = CORPSE_TIME;
      victim.respawn = CORPSE_TIME + rnd(20, 80);
      if (victim.rig.model) playState(victim.rig, 'death', 0.2);
      // The hunter stays to feed, and then, fed, lies up a good while.
      hunter.state = 'feed';
      hunter.timer = rnd(12, 22);
      hunter.fails = 0;
      hunter.tiredUntil = this.clock + hunter.timer + rnd(120, 300);
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
        // Close the last few metres at a walk, and stop to strike — never back
        // off. (A walk, that is, beside the prey: on a runner's heels it still
        // gains on it.)
        const running = a.prey === 'player' || a.prey?.remote ? 0 : Math.max(0, a.prey?.speed ?? 0);
        goal = d < sp.reach * 0.9 ? 0 : d < sp.reach * 3 ? THREE.MathUtils.lerp(walk, sp.speed, (d - sp.reach) / (sp.reach * 2)) : sp.speed;
        if (d >= sp.reach * 0.9 && running > 0) goal = Math.min(sp.speed, Math.max(goal, running + 0.8));
      }
    } else if (a.state === 'flee' && a.threat) {
      want = Math.atan2(a.pos.x - a.threat.pos.x, a.pos.z - a.threat.pos.z);
      // Flat out for a dozen seconds or so, and then it tires: a long chase
      // goes to the hunter.
      goal = sp.speed * (this.clock - (a.fleeFrom ?? this.clock) > 12 ? 0.8 : 1);
    } else if (a.state === 'defend' && a.threat) {
      // Pivot on the spot, the tail toward the threat (facing away from it).
      want = Math.atan2(a.pos.x - a.threat.pos.x, a.pos.z - a.threat.pos.z);
      goal = Math.abs(wrap(want - a.heading)) > 0.5 ? sp.walk * 0.35 : 0;
    } else if (a.state === 'graze' && a.drinking && a.faceTo != null) {
      // Turning about where it stands to face the water, head going down.
      want = a.faceTo;
      if (Math.abs(wrap(want - a.heading)) > 0.2) a.stall = Math.max(a.stall || 0, 0.5);
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

    // Out in water deeper than it would go now (the danger past), or on ground
    // too steep for it, it makes for the nearest easier going — whatever it
    // was about, prey and all.
    const wadeTo = this.wade(a);
    const worse = this.badness(a.pos.x, a.pos.z, wadeTo);
    if (worse > 0) {
      let best = Infinity, end = Infinity;
      const was = want;
      // (Near first; in a basin — a deep pool under a fall, its bed steep all
      // round — nothing near is any better, and it looks further.)
      for (const r of [Math.max(4, a.radius * 2), 8, 16]) {
        for (let k = 0; k < 12; k++) {
          const ang = k / 12 * Math.PI * 2, sx = Math.sin(ang), sz = Math.cos(ang);
          // The way there as well as where it ends: the worst of it, and how
          // it ends. (Of ways out alike, the one nearest where it was going.)
          let peak = 0;
          for (let f = 0.25; f < 1; f += 0.25) peak = Math.max(peak, this.badness(a.pos.x + sx * r * f, a.pos.z + sz * r * f, wadeTo));
          const there = this.badness(a.pos.x + sx * r, a.pos.z + sz * r, wadeTo);
          const cost = peak + there + Math.abs(wrap(ang - was)) * 0.01;
          if (cost < best) { best = cost; want = ang; end = there; }
        }
        if (end < worse * 0.5) break;
      }
      if (best < Infinity) goal = Math.max(goal, walk);
    }

    // Look ahead every so often, and bend the course round what is in the way.
    a.steerAt -= dt;
    if (a.steerAt <= 0 && (goal > 0 || Math.abs(a.speed) > 0.1)) {
      a.steerAt = STEER_EVERY;
      this.steer(a, want);
      if (a.blocked && a.state === 'wander') this.roam(a);
    }
    if (goal > 0 && !(worse > 0)) want += a.avoid;

    // Turning has momentum: it builds and eases off, and the faster an animal
    // goes the wider it turns. A big animal does not spin on the spot; it
    // walks round.
    const delta = wrap(want - a.heading);
    if (goal > 0 || a.state === 'hunt' || a.state === 'feed') {
      if (Math.abs(delta) > 0.6 && goal < walk * 0.5 && a.state !== 'graze' && a.state !== 'rest') goal = walk * 0.5;
    }
    const moving = Math.min(1, Math.abs(a.speed) / Math.max(0.3, walk));
    // (Except with its way ahead refused — a bank, a drop, deep water — when
    // it has to turn about where it stands, and does, if ponderously.)
    a.stall = Math.max(0, (a.stall || 0) - dt);
    const maxTurn = sp.turn * ((a.stall > 0 ? 0.8 : 0.25) + 0.75 * moving) * (1 - 0.35 * Math.min(1, Math.abs(a.speed) / sp.speed));
    const turnTo = THREE.MathUtils.clamp(delta * 1.8, -maxTurn, maxTurn);
    a.yawVel = approach(a.yawVel, turnTo, sp.turn * 1.6 * dt);
    a.heading = wrap(a.heading + a.yawVel * dt);
    // Slow into a sharp turn.
    goal *= 1 - 0.55 * Math.min(1, Math.abs(delta) / 1.4);
    a.speed = approach(a.speed, goal, (goal > a.speed ? sp.accel : sp.accel * 1.4) * dt);

    if (a.speed > 0.01) {
      const nx = a.pos.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.pos.z + Math.cos(a.heading) * a.speed * dt;
      // (Good ground, or no worse than where it stands: out in water deeper
      // than it would go now, or on ground too steep, it may go on at that or
      // better but never worse, so it cannot creep up a cliff or out into a
      // lake a hair at a time. A hair worse is all right off good ground, or
      // right at the limit the test would flicker and hold it there for good;
      // and boxed in for a while — a steep-sided channel — it scrambles out.)
      // (How bad it was where it got boxed in bounds the scramble, so that it
      // cannot work its way worse and worse.)
      const bad = this.badness(nx, nz, wadeTo);
      if (!(a.trapped > 1.5)) a.boxedAt = worse;
      const ok = bad <= (worse > 0 ? worse : 0.01) || (a.trapped > 1.5 && bad < Math.max(0.5, a.boxedAt + 0.2));
      if (ok && heightAt(nx, nz) < 105) { a.pos.x = nx; a.pos.z = nz; a.trapped = Math.max(0, (a.trapped || 0) - dt * 0.25); }
      else {
        a.speed *= 0.5; a.steerAt = 0; a.stall = 1.5; a.trapped = Math.min(3, (a.trapped || 0) + dt);
        if (a.state === 'wander') this.roam(a);
      }
    }
    // Never inside a trunk or a rock, whatever the steering missed.
    if (this.terrain) {
      a.pos.y = heightAt(a.pos.x, a.pos.z);
      // (Through what it shoulders through, as it steers: stopped by a sapling
      // its steering meant to push past, a sauropod walked on the spot.)
      this.terrain.collideReef(a.pos, a.radius, a.tall, this.shoulders(a));
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
        // The clip folds the legs and curls the body round, but leaves it
        // pitched onto its nose with the tail up in the air — balanced on its
        // head. A body comes down on its belly: brought level, head and tail
        // tip alike — level with the ground it lies on, down a slope as the
        // slope goes — and settled (below) till it lies on the ground.
        const death = rig.actions.death;
        if (!death || death.time > death.getClip().duration * 0.35) {
          const line = this.bodyLine(a);
          if (line) {
            const lay = THREE.MathUtils.clamp(Math.atan2(line.y, line.z), -0.9, 0.9);
            a.lay = (a.lay ?? 0) + (lay - (a.lay ?? 0)) * Math.min(1, dt * 1.8);
          } else a.lay ??= 0;
          rig.group.rotation.set((a.lay ?? 0) - a.pitch, a.heading, a.roll, 'YXZ');
        }
        this.settle(a);
        return;
      }
      const alert = a.state === 'hunt' || a.state === 'flee' ? 1 : 0;
      const m = MOTION[a.key] || {};
      driveGait(rig, a.speed, dt, {
        alert, attack: !!rig.actions.attack && a.bite > sp.biteEvery - 0.5,
        run: m.run !== false, maxRate: m.maxRate, maxStride: m.maxStride,
      });
      // What the clips get wrong about the animal, put right (dinopose.js).
      poseDino(a, dt, time);
      // And the feet that are down, held on the ground — near enough to see.
      if (dist < 70) plantFeet(rig, dt, heightAt);
      else rig.locks?.clear();
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
    // (Still going down while the clip plays, and while it rolls over.)
    const falling = (death && death.time < death.getClip().duration) || !a.laid;
    // (Laid: brought level — lay no longer moving.)
    a.laid = a.lay !== undefined && Math.abs(a.lay - (a.layWas ?? 99)) < 0.002;
    a.layWas = a.lay;
    a.settleAt = (a.settleAt ?? 0) - 1;
    // The skinned body itself, as posed — bones alone would leave the torso
    // floating, since its skin hangs well below the spine. Every few frames
    // while it falls, and once when it has come to rest; then the drop is
    // fixed — resting on the ground, neither in it nor above it.
    if ((falling && a.settleAt <= 0) || (!falling && !a.settled)) {
      a.settleAt = 6;
      if (!falling) a.settled = true;
      rig.group.position.y = a.y + liftOf(a);
      rig.group.updateMatrixWorld(true);
      // Its lowest point over the ground beneath that point, not beneath the
      // animal's middle: on a slope the downhill end is the lower, and the
      // uphill side would go into the hill.
      const v = this._tv ||= new THREE.Vector3();
      let drop = Infinity;
      rig.root.traverse(o => {
        if (!o.isSkinnedMesh || !o.visible) return;
        const n = o.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 400));
        for (let i = 0; i < n; i += step) {
          o.getVertexPosition(i, v);
          o.localToWorld(v);
          drop = Math.min(drop, v.y - heightAt(v.x, v.z));
        }
      });
      if (drop === Infinity) {
        const box = this._box || (this._box = new THREE.Box3());
        box.setFromObject(rig.root, true);
        drop = box.min.y - heightAt(a.pos.x, a.pos.z);
      }
      // Down onto its belly, not propped on its lowest point — a jaw, a knee:
      // the torso as low as its own thickness allows, a head or a limb let
      // into the ground a little if that is what it takes — only a little:
      // a tenth of its width, past which the carcass reads as half buried.
      a.torso ??= Object.values(rig.gait?.bones || {}).filter(b => /^bip_(pelvis|spine)/i.test(b.name));
      if (a.torso.length) {
        const r = a.width * 0.42;
        let spine = Infinity;
        for (const b of a.torso) { b.getWorldPosition(v); spine = Math.min(spine, v.y - heightAt(v.x, v.z)); }
        drop += THREE.MathUtils.clamp(spine - r - drop, 0, a.width * 0.1);
      }
      a.sink = falling ? (a.sink || 0) + (drop - (a.sink || 0)) * 0.6 : drop;
    }
    rig.group.position.y = a.y + liftOf(a) - (a.sink || 0);
  }

  /** Tail tip to head, in the body's own frame (as the clip poses it now): how the body lies. */
  bodyLine(a) {
    const b = a.rig.gait?.bones;
    if (!b) return null;
    const all = Object.values(b);
    a.lineBones ??= [all.filter(x => /^bip_tail/i.test(x.name)).pop(), all.find(x => /^bip_head/i.test(x.name))];
    const [pelvis, head] = a.lineBones;
    if (!pelvis || !head) return null;
    const g = a.rig.group, M = this._line ||= new THREE.Matrix4();
    // (Without the turn the body is given as it lies — only the clip's pose.)
    g.updateMatrixWorld(true);
    M.copy(g.matrixWorld).invert();
    const p = pelvis.getWorldPosition(this._lp ||= new THREE.Vector3()).applyMatrix4(M);
    const h = head.getWorldPosition(this._lh ||= new THREE.Vector3()).applyMatrix4(M);
    return h.sub(p);
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
