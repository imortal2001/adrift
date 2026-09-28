// ── Reef animals that move ───────────────────────────────────────────────────
// The fish have the water to themselves no longer. Round you, wherever you
// are at sea (the same `focus` the fish keep to), and on the beaches:
//
//   sea turtles  gliding over the reef on slow sweeps of their front
//                flippers, rising now and then to breathe at the surface,
//                and turning away, unhurried, if you swim at them
//   stingrays    lying on the open sand, then lifting off it and flying low
//                on rippling wings — and off at a rush if you come close
//   octopus      creeping over the coral, arms curling, colour sliding to
//                match what it is on; startle one and it blanches, jets off
//                backwards and leaves a cloud of ink. A spear takes it
//   crabs        scuttling sideways on the reef in short bursts, and on the
//                beaches — where they run for the water when you come.
//                Caught by hand (E)
//
// And away from the sea, when their models are here:
//
//   tortoises    plodding about the land near you, grazing, and drawing in
//                head and legs if you come up to one
//   pond turtles in the lakes, tarns and pools: paddling at the surface,
//                hauling out to bask on the bank, and sliding off it and
//                diving when you come
//
// The sea's are built in code: the turtles, rays and octopus are a few
// meshes each, animated on the CPU (a ray's wings and an octopus's arms are
// re-shaped every frame — a few hundred vertices). The crabs are many and
// small, so all of them are three instanced meshes: bodies, legs and claws.
// Where a model of one is in assets/models/ (reefmodels.js), it is that
// instead; the tortoise and the pond turtle are models only.
//
// What you catch is a catch like a fish (items.js CATCHES): crab and octopus
// go in the fish slot, bait a hook, cook on the fire and are eaten. Their
// still bodies — for the hand, the spit, the spear — come from bodyFor().

import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { waveHeight } from './ocean.js';
import { heightAt, reefMask, coastDistance, slopeAt, freshWaterAt, LAKES, lakeShore } from './terrain.js';
import { ModelLibrary } from './models.js';
import { octopusModel, rayModel, shelledModel, seaTurtleModel, stillOf } from './reefmodels.js';

// ── making the bodies ────────────────────────────────────────────────────────
const paint = (g, hex, vary = 0, seed = 1) => {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.set(hex);
    if (vary) c.multiplyScalar(1 + (Math.sin(i * 12.9898 + seed * 78.233) * 0.5) * vary);
    c.toArray(a, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
const merge = parts => {
  const g = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false);
  parts.forEach(p => p.dispose());
  g.computeVertexNormals();
  return g;
};
const skin = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, ...opts });
const ball = (w, h, d, seg = 12) => new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.66 | 0)).scale(w, h, d);

/** A green turtle's shell: plates in olive and brown, seams dark, pale underneath. */
function shellGeometry() {
  const g = ball(0.42, 0.15, 0.52, 22);
  const pos = g.attributes.position, a = new Float32Array(pos.count * 3), c = new THREE.Color();
  // The plates: five down the middle, four each side — the nearest two
  // centres decide whether a point is on a plate or at a seam between them.
  const centres = [];
  for (let k = 0; k < 5; k++) centres.push([0, -0.4 + k * 0.2]);
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) centres.push([s * 0.24, -0.3 + k * 0.2]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y < -0.02) { c.set(0xd9cc94); c.toArray(a, i * 3); continue; }        // the plastron
    let d1 = 9, d2 = 9;
    for (const [cx, cz] of centres) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const seam = THREE.MathUtils.smoothstep(d2 - d1, 0, 0.025);
    c.set(0x6e5a36).lerp(new THREE.Color(0x9a8048), (1 - d1 / 0.16) * 0.8).multiplyScalar(0.55 + 0.45 * seam);
    c.toArray(a, i * 3);
    pos.setY(i, y + (y > 0 ? 0.015 * seam : 0));                               // plates stand a hair proud
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.translate(0, 0.04, 0);
  return g;
}

/** A flipper: a flat, curved paddle out along +x from its shoulder at the origin. */
function flipperGeometry(len, width) {
  const g = ball(len / 2, 0.022, width / 2, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, pos.getZ(i) * (1 - 0.55 * (x / (len / 2) + 1) / 2) - 0.12 * ((x / len + 0.5) ** 2) * len); // taper, sweep back
  }
  g.translate(len / 2, 0, 0);
  return paint(g, 0x7c7a5c, 0.18, 3);
}

/** A sea turtle, facing +z, about a metre long. `parts` are the four flippers, to move. */
export function turtleBody() {
  const group = new THREE.Group();
  const mat = skin({ roughness: 0.6 });
  const head = paint(ball(0.1, 0.085, 0.14, 12), 0x807c58, 0.15, 5).translate(0, 0.03, 0.62);
  const beak = paint(ball(0.05, 0.04, 0.05, 8), 0x5c5842).translate(0, 0.01, 0.74);
  const eyes = [-1, 1].map(s => paint(ball(0.018, 0.018, 0.018, 6), 0x111111).translate(s * 0.07, 0.06, 0.68));
  const neck = paint(ball(0.1, 0.07, 0.14, 10), 0x8c8a66, 0.1, 7).translate(0, 0.02, 0.5);
  group.add(new THREE.Mesh(merge([shellGeometry(), head, beak, neck, ...eyes]), mat));
  const flippers = [];
  for (const [side, front] of [[1, 1], [-1, 1], [1, 0], [-1, 0]]) {
    const f = new THREE.Mesh(front ? flipperGeometry(0.55, 0.2) : flipperGeometry(0.2, 0.12), mat);
    const pivot = new THREE.Group();
    pivot.position.set(side * (front ? 0.3 : 0.26), 0.0, front ? 0.3 : -0.42);
    pivot.scale.x = side;
    pivot.add(f);
    group.add(pivot);
    flippers.push({ pivot, side, front });
  }
  for (const o of group.children) o.traverse(m => { if (m.isMesh) m.castShadow = true; });
  group.userData.animate = (t, beat, push) => {
    for (const { pivot, front } of flippers) {
      if (front) {
        // The downstroke is the power: slow up, fast down — and the flipper
        // turns edge-on coming back up.
        const s = Math.sin(t * beat * Math.PI * 2), c = Math.cos(t * beat * Math.PI * 2);
        pivot.rotation.set(0.35 * c * push, -0.25 - 0.3 * c * push, -0.15 + 0.6 * s * push, 'YZX');
      } else {
        pivot.rotation.set(0, 0.5 + 0.15 * Math.sin(t * beat * 3), 0.1 * Math.sin(t * beat * 4));
      }
    }
  };
  return group;
}

/** A stingray, facing +z: a disc ~1 m across and its whip of a tail. Its wings ripple (animate). */
export function rayBody() {
  const group = new THREE.Group();
  const rows = 18, cols = 16, W = 0.55, L = 0.46;
  const pos = [], col = [], idx = [], base = [];
  const top = new THREE.Color(), under = new THREE.Color(0xe7e3da);
  // A diamond: widest a little ahead of the middle, the wingtips pointed,
  // the snout blunt and the back tapering to where the tail starts.
  const Z0 = L * 0.15;
  const halfW = z => {
    const f = z > Z0 ? (z - Z0) / (L - Z0) : (Z0 - z) / (L + Z0);
    return W * Math.pow(Math.max(0, 1 - Math.pow(f, z > Z0 ? 1.25 : 1.05)), z > Z0 ? 0.7 : 0.95);
  };
  for (const layer of [1, -1]) {
    const o = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const z = L - (2 * L * r) / rows, hw = halfW(z);
      for (let c = 0; c <= cols; c++) {
        const u = (c / cols) * 2 - 1, x = u * hw;
        const dome = 0.07 * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - (z / L) ** 2);
        const y = layer > 0 ? dome : -dome * 0.35;
        pos.push(x, y, z); base.push(x, y, z);
        if (layer > 0) {
          // Sandy grey-brown, mottled, darker along the middle.
          const spot = Math.sin(x * 41 + z * 17) * Math.sin(x * 23 - z * 37);
          top.set(0xa79877).multiplyScalar(0.92 + 0.12 * spot - 0.12 * (1 - Math.abs(u)));
          col.push(top.r, top.g, top.b);
        } else col.push(under.r, under.g, under.b);
      }
      if (r) {
        for (let c = 0; c < cols; c++) {
          const a0 = o + (r - 1) * (cols + 1) + c, a1 = o + r * (cols + 1) + c;
          // Wound so the back faces up and the belly down.
          if (layer > 0) idx.push(a0, a0 + 1, a1, a0 + 1, a1 + 1, a1);
          else idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1);
        }
      }
    }
  }
  const disc = new THREE.BufferGeometry();
  disc.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  disc.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  disc.setIndex(idx);
  disc.computeVertexNormals();
  const mat = skin({ roughness: 0.55 });
  const body = new THREE.Mesh(disc, mat);
  body.castShadow = true;
  group.add(body);
  const eyes = merge([-1, 1].map(s => paint(ball(0.02, 0.018, 0.024, 6), 0x3b362c).translate(s * 0.07, 0.065, 0.22)));
  group.add(new THREE.Mesh(eyes, mat));
  const tail = new THREE.Mesh(paint(new THREE.CylinderGeometry(0.004, 0.022, 0.85, 6).rotateX(Math.PI / 2).translate(0, 0.01, -0.425), 0x8f8468), mat);
  tail.position.z = -L * 0.95;
  group.add(tail);
  const b = Float32Array.from(base), P = disc.attributes.position;
  let every = 0;
  group.userData.animate = (t, beat, amp) => {
    // A wave down each wing, front to back, growing toward the tips.
    for (let i = 0; i < P.count; i++) {
      const x = b[i * 3], z = b[i * 3 + 2], reach = Math.pow(Math.abs(x) / W, 1.5);
      P.setY(i, b[i * 3 + 1] + amp * reach * Math.sin(t * beat * Math.PI * 2 - z * 5.5));
    }
    P.needsUpdate = true;
    if ((every = (every + 1) % 3) === 0) disc.computeVertexNormals();
    tail.rotation.y = Math.sin(t * beat * Math.PI * 2 * 0.5) * 0.18 * (0.3 + amp * 6);
  };
  return group;
}

// Colours an octopus slides through to match what it sits on.
export const OCTO_SHADES = [0x8a3b2a, 0xa0663c, 0x6b5a4a, 0xb88a5a, 0x7a4658, 0x5f6a48];

/** An octopus: a mantle, eyes, and eight arms re-shaped every frame (animate). */
export function octopusBody() {
  const group = new THREE.Group();
  const mat = skin({ roughness: 0.45, color: 0xffffff });
  const mantle = paint(ball(0.12, 0.1, 0.16, 16), 0xffffff, 0.12, 2).rotateX(-0.5).translate(0, 0.17, -0.1);
  const head = paint(ball(0.09, 0.075, 0.085, 12), 0xffffff, 0.1, 4).translate(0, 0.085, 0.02);
  const eyeBalls = [-1, 1].map(s => paint(ball(0.026, 0.026, 0.026, 8), 0xe8dcb4).translate(s * 0.065, 0.12, 0.05));
  const pupils = [-1, 1].map(s => paint(ball(0.012, 0.006, 0.012, 6), 0x111111).translate(s * 0.087, 0.126, 0.058));
  group.add(new THREE.Mesh(merge([mantle, head, ...eyeBalls]), mat));
  group.add(new THREE.Mesh(merge(pupils), skin()));
  const N = 12, SIDES = 6, LEN = 0.42;
  const arms = [];
  for (let k = 0; k < 8; k++) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((N + 1) * (SIDES + 1) * 3), col = new Float32Array(pos.length);
    const idx = [];
    for (let r = 0; r <= N; r++) {
      for (let s = 0; s <= SIDES; s++) {
        // Paler underneath, where the suckers are.
        const under = Math.cos((s / SIDES) * Math.PI * 2) < -0.3;
        const v = under ? 1.35 : 1, i = (r * (SIDES + 1) + s) * 3;
        col[i] = col[i + 1] = col[i + 2] = Math.min(1, v * (0.9 + 0.1 * Math.sin(r * 2.3 + k)));
        if (r && s < SIDES) {
          const a0 = (r - 1) * (SIDES + 1) + s, a1 = r * (SIDES + 1) + s;
          idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1);
        }
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    group.add(m);
    arms.push({ geo, base: (k / 8) * Math.PI * 2 + Math.PI / 8, k });
  }
  const p = new THREE.Vector3(), t3 = new THREE.Vector3(), n3 = new THREE.Vector3(), b3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const pts = Array.from({ length: N + 1 }, () => new THREE.Vector3());
  /**
   * `mode` 0: sprawled and walking, arms curling over the ground; 1: jetting,
   * the arms swept straight back behind it.
   */
  group.userData.animate = (t, speed, mode) => {
    for (const { geo, base, k } of arms) {
      let ang = base;
      let pitch = -0.05;
      p.set(Math.sin(base) * 0.05, 0.05, Math.cos(base) * 0.05);
      for (let r = 0; r <= N; r++) {
        const f = r / N;
        pts[r].copy(p);
        const step = LEN / N;
        // Walking: each arm reaches and curls on its own beat; jetting: all trail aft.
        // …and the last third of every arm curls round on itself, one way or the other.
        const curl = Math.sin(t * (0.8 + speed * 3) + k * 1.7 + f * 3) * (0.25 + f * 0.9)
                   + (k % 2 ? 1 : -1) * Math.max(0, f - 0.55) * 2.2;
        const want = mode ? Math.PI + (base - Math.PI) * 0.12 * (1 - f) : ang + curl * 0.3;
        ang += (want - ang) * (mode ? 0.5 : 1);
        pitch = mode ? 0.05 * Math.sin(t * 8 + k) : -0.05 + (f > 0.7 ? Math.max(0, Math.sin(t * 1.3 + k)) * 0.5 * (f - 0.7) * 3 : -0.02);
        p.x += Math.sin(ang) * Math.cos(pitch) * step;
        p.z += Math.cos(ang) * Math.cos(pitch) * step;
        p.y = Math.max(0.01, p.y + Math.sin(pitch) * step);
      }
      const pos = geo.attributes.position;
      for (let r = 0; r <= N; r++) {
        const a = pts[Math.max(0, r - 1)], b = pts[Math.min(N, r + 1)];
        t3.subVectors(b, a).normalize();
        n3.crossVectors(t3, up).normalize();
        b3.crossVectors(n3, t3);
        const rad = 0.052 * Math.pow(1 - (r / N) * 0.93, 1.3);   // thick at the web, fine at the tip
        for (let s = 0; s <= SIDES; s++) {
          const th = (s / SIDES) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
          const i = (r * (SIDES + 1) + s) * 3;
          pos.array[i] = pts[r].x + (n3.x * sn + b3.x * c) * rad;
          pos.array[i + 1] = pts[r].y + (n3.y * sn + b3.y * c) * rad;
          pos.array[i + 2] = pts[r].z + (n3.z * sn + b3.z * c) * rad;
        }
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
  };
  group.userData.skin = mat;
  return group;
}

// A crab, as three kinds of part — each one geometry, shared by every crab.
let CRAB = null;
function crabParts() {
  if (CRAB) return CRAB;
  const shell = paint(ball(0.1, 0.035, 0.075, 12), 0xffffff, 0.08, 9).translate(0, 0.07, 0);
  const eyes = [-1, 1].flatMap(s => [
    paint(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 5).translate(s * 0.03, 0.11, 0.06), 0xffffff),
    paint(ball(0.009, 0.009, 0.009, 6).translate(s * 0.03, 0.125, 0.06), 0x151515),
  ]);
  // A leg: out along +x from the hip, up to the knee, down to the tip.
  const upper = new THREE.CylinderGeometry(0.008, 0.01, 0.075, 5).rotateZ(-Math.PI / 2 + 0.5).translate(0.032, 0.018, 0);
  const lower = new THREE.CylinderGeometry(0.004, 0.008, 0.085, 5).rotateZ(-0.35).translate(0.08, -0.018, 0);
  // A claw: an arm forward, and the pincer.
  const arm = new THREE.CylinderGeometry(0.01, 0.012, 0.07, 6).rotateX(Math.PI / 2 - 0.4).translate(0, 0.012, 0.03);
  const pincer = ball(0.03, 0.02, 0.035, 8).translate(0, 0.03, 0.075);
  const finger = new THREE.CylinderGeometry(0.004, 0.009, 0.04, 5).rotateX(Math.PI / 2 + 0.3).translate(0.012, 0.022, 0.11);
  CRAB = {
    body: merge([shell, ...eyes]),
    leg: merge([paint(upper, 0xffffff), paint(lower, 0xe6e6e6)]),
    claw: merge([paint(arm, 0xffffff), paint(pincer, 0xffffff), paint(finger, 0xd8d8d8)]),
  };
  return CRAB;
}

// Where each of a crab's legs meets its shell, and which way it points (angle in the ground plane).
const HIPS = [];
for (const s of [1, -1]) for (let k = 0; k < 4; k++) HIPS.push({ s, x: s * 0.07, z: 0.03 - k * 0.028, a: s * (0.55 - k * 0.38) });
const CLAWS = [{ s: 1, x: 0.05, z: 0.06 }, { s: -1, x: -0.05, z: 0.06 }];

/** Crabs, all of them: three instanced meshes, their matrices set every frame from each crab. */
export class Crabs {
  constructor(scene, max) {
    const p = crabParts(), mat = skin({ roughness: 0.55 }), legMat = skin({ roughness: 0.6, side: THREE.DoubleSide });
    this.scene = scene;
    this.max = max;
    this.body = new THREE.InstancedMesh(p.body, mat, max);
    this.legs = new THREE.InstancedMesh(p.leg, legMat, max * 8);
    this.claws = new THREE.InstancedMesh(p.claw, legMat, max * 2);
    for (const m of [this.body, this.legs, this.claws]) {
      m.castShadow = true; m.frustumCulled = false; m.count = 0;
      scene.add(m);
    }
    this.parts = null;               // the model's, once it is here (useModel)
    this._m = new THREE.Matrix4(); this._p = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  /**
   * Draw them from the crab model instead (tools/build_sealife.py): its shell,
   * claws and legs, each already a separate mesh with its origin at its
   * joint — one instanced mesh per part.
   */
  useModel(scene) {
    const parts = [];
    scene.traverse(o => {
      if (!o.isMesh) return;
      const m = new THREE.InstancedMesh(o.geometry, o.material.clone(), this.max);
      m.castShadow = true; m.frustumCulled = false; m.count = 0;
      const [, what, side, k] = o.name.match(/^(body|claw|leg)_?([LR])?(\d)?/) || [];
      parts.push({ mesh: m, what: what || 'body', s: side === 'R' ? -1 : 1, k: +(k || 0), at: o.position.clone() });
    });
    if (!parts.some(p => p.what === 'body')) return;
    for (const m of [this.body, this.legs, this.claws]) this.scene.remove(m);
    for (const p of parts) this.scene.add(p.mesh);
    this.parts = parts;
  }

  /** Draw these crabs: [{pos, heading, size, colour, gait (0..), moving (0..1), claws (0..1)}]. */
  draw(list) {
    if (this.parts) return this.drawModel(list);
    const { _m: M, _p: P, _q: q, _e: e, _v: v, _s: s } = this;
    let n = 0, l = 0, c = 0;
    for (const k of list) {
      q.setFromEuler(e.set(0, k.heading, 0));
      M.compose(k.pos, q, s.setScalar(k.size));
      this.body.setMatrixAt(n, M);
      this.body.setColorAt(n, k.colour);
      HIPS.forEach((h, i) => {
        // Alternating legs, a tetrapod walk: lift, swing, set down.
        const ph = k.gait * Math.PI * 2 + (i % 2 ? Math.PI : 0) + (h.s > 0 ? 0 : Math.PI / 2);
        const lift = Math.max(0, Math.sin(ph)) * 0.45 * k.moving, swing = Math.cos(ph) * 0.28 * k.moving;
        q.setFromEuler(e.set(0, h.a + swing, lift * h.s, 'YXZ'));
        P.compose(v.set(h.x, 0.06, h.z), q, s.set(h.s, 1, 1));
        this.legs.setMatrixAt(l, P.premultiply(M));
        this.legs.setColorAt(l++, k.colour);
      });
      for (const cl of CLAWS) {
        q.setFromEuler(e.set(-0.3 * k.claws, cl.s * 0.35, 0));
        P.compose(v.set(cl.x, 0.05, cl.z), q, s.set(cl.s, 1, 1));
        this.claws.setMatrixAt(c, P.premultiply(M));
        this.claws.setColorAt(c++, k.colour);
      }
      n++;
    }
    this.body.count = n; this.legs.count = l; this.claws.count = c;
    for (const m of [this.body, this.legs, this.claws]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  drawModel(list) {
    const { _m: M, _p: P, _q: q, _e: e, _v: v, _s: s } = this;
    for (const p of this.parts) {
      let n = 0;
      for (const k of list) {
        q.setFromEuler(e.set(0, k.heading, 0));
        M.compose(k.pos, q, s.setScalar(k.size * MODEL_CRAB));
        if (p.what === 'body') P.copy(M);
        else {
          if (p.what === 'leg') {
            // The same walk as the code-built crab's: alternate legs lifted and swung.
            const ph = k.gait * Math.PI * 2 + (p.k % 2 ? Math.PI : 0) + (p.s > 0 ? 0 : Math.PI / 2);
            const lift = Math.max(0, Math.sin(ph)) * 0.4 * k.moving, swing = Math.cos(ph) * 0.3 * k.moving;
            q.setFromEuler(e.set(0, swing, lift * p.s, 'YXZ'));
          } else q.setFromEuler(e.set(-0.35 * k.claws, p.s * 0.15 * k.claws, 0));
          P.compose(p.at, q, s.set(1, 1, 1)).premultiply(M);
        }
        p.mesh.setMatrixAt(n, P);
        p.mesh.setColorAt(n++, k.colour);
      }
      p.mesh.count = n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * One crab from the model, still, facing +z: a mesh (the shell) with its
   * claws and legs as children, their materials sharing its colour — so it
   * browns on the fire as one. Null without the model.
   */
  stillModel(colour) {
    if (!this.parts) return null;
    const c = new THREE.Color(colour ?? 0xffffff), mats = new Map();
    const mat = m => {
      if (!mats.has(m)) { const x = m.clone(); x.color = c; x.side = THREE.DoubleSide; mats.set(m, x); }
      return mats.get(m);
    };
    const body = this.parts.find(p => p.what === 'body');
    const root = new THREE.Mesh(body.mesh.geometry, mat(body.mesh.material));
    for (const p of this.parts) {
      if (p === body) continue;
      const m = new THREE.Mesh(p.mesh.geometry, mat(p.mesh.material));
      m.position.copy(p.at);
      if (p.what === 'claw') m.rotation.x = -0.25;
      m.castShadow = true;
      root.add(m);
    }
    return root;
  }
}

// The crab model is 1:1 for a 20 cm crab: 34 cm across its legs, 21 long.
const MODEL_CRAB = 1;
const MODEL_CRAB_LENGTH = 0.214;

/** One crab as a single still mesh, facing +z: for the hand, the spit and the gallery. */
export function crabStill(colour = 0xc24a2c) {
  const p = crabParts(), parts = [p.body.clone()];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const h of HIPS) {
    q.setFromEuler(e.set(0, h.a, 0, 'YXZ'));
    parts.push(p.leg.clone().applyMatrix4(m.compose(v.set(h.x, 0.06, h.z), q, s.set(h.s, 1, 1))));
  }
  for (const cl of CLAWS) {
    q.setFromEuler(e.set(-0.3, cl.s * 0.35, 0));
    parts.push(p.claw.clone().applyMatrix4(m.compose(v.set(cl.x, 0.05, cl.z), q, s.set(cl.s, 1, 1))));
  }
  const g = mergeGeometries(parts.map(x => (x.index ? x.toNonIndexed() : x)), false);
  g.computeVertexNormals();
  return new THREE.Mesh(g, skin({ color: colour, roughness: 0.55, side: THREE.DoubleSide }));
}

// ── the animals ──────────────────────────────────────────────────────────────
// How many of each keep near you, and where they live.
export const REEF_ANIMALS = {
  turtle:  { name: 'sea turtle', count: 3, where: 'over the reef and the sand, in water deeper than 4 m',
             length: 1.0, catch: false },
  ray:     { name: 'stingray', count: 4, where: 'on the open sand between the reefs, 3–20 m down',
             length: 1.1, catch: false },
  octopus: { name: 'octopus', count: 3, where: 'on the coral, 3–18 m down', length: [0.5, 0.8], catch: 'spear' },
  crab:    { name: 'crab', count: 7, where: 'on the reef, 1–14 m down — and on the beaches', length: [0.18, 0.26], catch: 'hand' },
  // Models only (reefmodels.js): with no file, there are none.
  tortoise:    { name: 'tortoise', count: 3, where: 'on the land near you, off the beach and below the trees\' end',
                 length: [0.4, 0.6], catch: false, model: 'tortoise', land: true },
  pond_turtle: { name: 'pond turtle', count: 4, where: 'in the lakes, tarns and plunge pools, and basking on their banks',
                 length: [0.17, 0.24], catch: false, model: 'pond_turtle', land: true },
};
// The model each takes its body from, when it is there.
const MODEL_OF = { turtle: 'sea_turtle', octopus: 'octopus', ray: 'stingray', crab: 'crab', tortoise: 'tortoise', pond_turtle: 'pond_turtle' };
const BEACH_CRABS = 8;
const LAND_RANGE = 55;               // tortoises and pond turtles keep this near you
const POND_REACH = 140;              // a lake this near you has its turtles out
const RANGE = 70;                    // animals further than this from you are put back nearer
const BEACH_RANGE = 45;
const INK = 14;                      // puffs in an octopus's cloud

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class ReefLife {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.focus = null;               // where you are at sea (main.js): they keep near it
    this.others = [];                // the others' eyes, to shy from too (sharedworld.js)
    this.animals = [];
    this.crabs = new Crabs(scene, REEF_ANIMALS.crab.count + BEACH_CRABS);
    this.time = 0;
    this.models = {};                // key → loaded model entry
    for (const [kind, sp] of Object.entries(REEF_ANIMALS)) {
      if (sp.model) continue;
      for (let k = 0; k < sp.count; k++) this.animals.push(this.make(kind));
    }
    for (let k = 0; k < BEACH_CRABS; k++) this.animals.push(this.make('crab', true));
    this.ink = this.inkCloud();
    this.library = new ModelLibrary();
    this.ready = this.loadModels();
  }

  /** The models, as they come: each kind swaps its body for its model, and the model-only kinds appear. */
  async loadModels() {
    await Promise.all(Object.entries(MODEL_OF).map(async ([kind, key]) => {
      const entry = await this.library.get(key);
      if (!entry) return;
      this.models[kind] = entry;
      if (kind === 'crab') { this.crabs.useModel(entry.scene); return; }
      const sp = REEF_ANIMALS[kind];
      if (sp.model) {
        for (let k = 0; k < sp.count; k++) this.animals.push(this.make(kind));
        return;
      }
      for (const a of this.animals) {
        if (a.kind !== kind) continue;
        const was = a.obj;
        a.obj = this.body(kind, a);
        a.obj.visible = was.visible;
        this.scene.remove(was);
        this.scene.add(a.obj);
      }
    }));
  }

  /** An animal's moving body: its model's if that is here, else the code-built one. */
  body(kind, a) {
    const m = this.models[kind];
    if (kind === 'turtle') return m ? seaTurtleModel(m, 1.1) : turtleBody();
    if (kind === 'ray') return m ? rayModel(m, 1.1 * a.scale) : rayBody();
    if (kind === 'octopus') return m ? octopusModel(m, 0.8) : octopusBody();
    // The tortoise's texture is painted near black (its shading baked in): lifted, it reads as the dark grey-brown it is.
    if (kind === 'tortoise') return shelledModel(m, a.length, 2.6);
    if (kind === 'pond_turtle') return shelledModel(m, a.length);
    return null;
  }

  make(kind, beach = false) {
    const a = { kind, beach, sp: REEF_ANIMALS[kind], pos: new THREE.Vector3(), heading: Math.random() * 6.28,
                speed: 0, state: 'idle', timer: 0, t: Math.random() * 10, placed: false, away: 0 };
    a.scale = kind === 'ray' ? rand(0.85, 1.15) : rand(0.85, 1.25);
    if (kind === 'tortoise' || kind === 'pond_turtle') { a.length = rand(...a.sp.length); a.hide = 0; a.step = 0; a.graze = 0; }
    a.obj = this.body(kind, a);
    if (kind === 'octopus') {
      a.shade = new THREE.Color(OCTO_SHADES[0]); a.want = new THREE.Color(OCTO_SHADES[1]);
    }
    if (kind === 'crab') {
      a.size = rand(...REEF_ANIMALS.crab.length) / 0.2;
      // (White is the model's own colour: a blue crab. The code-built one has none of its own, and is red.)
      const reef = this.models.crab ? [0xffffff, 0xffffff, 0xc24a2c, 0xb8662e, 0x9a3a4a] : [0xc24a2c, 0xb8662e, 0x9a3a4a];
      a.colour = new THREE.Color(beach ? 0xd9c79c : reef[Math.random() * reef.length | 0]);
      a.gait = 0; a.moving = 0; a.claws = 0;
    }
    if (a.obj) { a.obj.visible = false; this.scene.add(a.obj); }
    return a;
  }

  get hub() { return this.focus || this.player || new THREE.Vector3(); }

  /** Where an animal keeps near, and how near. */
  home(a) {
    if (a.beach) return [this.player, BEACH_RANGE + 15];
    if (a.kind === 'pond_turtle') return [this.player, POND_REACH + 150];
    if (a.sp.land) return [this.player, LAND_RANGE + 15];
    return [this.hub, RANGE + 10];
  }

  /** The floor an animal lives on at (x, z): the coral's top on the reef, the sand elsewhere. */
  floor(x, z) { return this.terrain ? this.terrain.clearanceAt(x, z) : heightAt(x, z); }

  /** Is (x, z) somewhere this animal can be? */
  fits(a, x, z) {
    const h = heightAt(x, z);
    if (a.kind === 'crab' && a.beach) return h > 0.15 && h < 2.4 && coastDistance(x, z) < 30;
    if (a.kind === 'tortoise') return h > 2 && h < 150 && slopeAt(x, z) < 0.12 && !freshWaterAt(x, z);
    if (a.kind === 'pond_turtle') { const w = freshWaterAt(x, z); return !!w && w.kind !== 'river' && w.depth > 0.35; }
    const reef = reefMask(x, z, -coastDistance(x, z));
    if (a.kind === 'turtle') return h < -4;
    if (a.kind === 'ray') return h < -3 && h > -20 && reef < 0.15;
    if (a.kind === 'octopus') return h < -3 && h > -18 && reef > 0.3;
    return h < -1 && h > -14;                                  // a reef crab
  }

  /** Somewhere near the middle of things, out of sight if it can be, that fits. */
  place(a, far = true) {
    const [hub] = this.home(a);
    if (!hub) return false;
    if (a.kind === 'pond_turtle') return this.placePond(a, hub);
    for (let k = 0; k < 30; k++) {
      const r = a.beach ? rand(12, BEACH_RANGE) : a.sp.land ? rand(10, LAND_RANGE) : rand(far ? 28 : 8, RANGE - 5), th = Math.random() * 6.28;
      const x = hub.x + Math.cos(th) * r, z = hub.z + Math.sin(th) * r;
      if (!this.fits(a, x, z)) continue;
      a.pos.set(x, 0, z);
      a.placed = true;
      a.state = 'idle'; a.timer = rand(1, 6); a.speed = 0;
      if (a.kind === 'turtle') { a.pos.y = Math.min(-1.5, heightAt(x, z) + rand(2, 5)); a.breathe = rand(20, 90); }
      else if (a.sp.land) a.pos.y = heightAt(x, z);
      else a.pos.y = this.floor(x, z);
      a.away = 0;
      return true;
    }
    a.placed = false;
    return false;
  }

  /** A pond turtle: in one of the lakes near you, if there is one. */
  placePond(a, hub) {
    const near = LAKES.filter(L => Math.hypot(L.x - hub.x, L.z - hub.z) < POND_REACH + Math.max(L.a, L.b));
    for (let k = 0; k < 30 && near.length; k++) {
      const L = near[Math.random() * near.length | 0];
      const th = Math.random() * 6.28, r = lakeShore(L, th) * rand(0.15, 0.8);
      const u = Math.cos(th) * r, v = Math.sin(th) * r;
      const x = L.x + u * L.cos - v * L.sin, z = L.z + u * L.sin + v * L.cos;
      if (!this.fits(a, x, z)) continue;
      a.lake = L;
      a.pos.set(x, freshWaterAt(x, z).level, z);
      a.placed = true; a.away = 0;
      a.state = 'swim'; a.timer = rand(10, 40); a.speed = 0; a.hide = 0;
      return true;
    }
    a.placed = false;
    return false;
  }

  /** The nearest of you and the others to point p: {d, from}. */
  threat(p) {
    let best = Infinity, from = null;
    const check = e => { if (!e) return; const d = p.distanceTo(e); if (d < best) { best = d; from = e; } };
    check(this.eye);
    for (const o of this.others) check(o);
    return { d: best, from };
  }

  inkCloud() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(INK * 3), 3));
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(20,14,18,0.95)'); grad.addColorStop(1, 'rgba(20,14,18,0)');
    x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    const p = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 1.2, transparent: true,
                                                             depthWrite: false, opacity: 0, color: 0x1a1216 }));
    p.frustumCulled = false;
    this.scene.add(p);
    return { points: p, age: 99, at: new THREE.Vector3(), puffs: Array.from({ length: INK }, () => new THREE.Vector3()) };
  }

  /** @param eye  your eye, in the world; `playerPos` where you stand */
  update(dt, time, eye, playerPos) {
    this.time = time;
    this.eye = eye;
    this.player = playerPos;
    const crabs = [];
    for (const a of this.animals) {
      const [hub, range] = this.home(a);
      if (!a.placed || a.pos.distanceTo(hub) > range) {
        if (a.obj) a.obj.visible = false;
        if ((a.away -= dt) > 0) continue;
        if (!this.place(a)) { a.away = 3; continue; }
      }
      if (a.caught > 0) { if ((a.caught -= dt) <= 0) this.place(a); else { if (a.obj) a.obj.visible = false; continue; } }
      a.t += dt;
      this[a.kind](a, dt, time);
      if (a.kind === 'crab') crabs.push(a);
    }
    this.crabs.draw(crabs.map(a => ({ pos: a.pos, heading: a.heading, size: a.size, colour: a.colour,
                                      gait: a.gait, moving: a.moving, claws: a.claws })));
    this.updateInk(dt);
  }

  /** Move forward along its heading, turning back from anywhere it does not belong. */
  step(a, dt, side = 0) {
    const dir = a.heading + side;
    const nx = a.pos.x + Math.sin(dir) * a.speed * dt, nz = a.pos.z + Math.cos(dir) * a.speed * dt;
    if (this.fits(a, nx, nz)) { a.pos.x = nx; a.pos.z = nz; return true; }
    a.heading += Math.PI * (0.6 + Math.random() * 0.8);
    return false;
  }

  turtle(a, dt, time) {
    const th = this.threat(a.pos);
    const bed = heightAt(a.pos.x, a.pos.z), sea = waveHeight(a.pos.x, a.pos.z, time);
    if (th.d < 5 && a.state !== 'flee') { a.state = 'flee'; a.timer = 6; a.heading = Math.atan2(a.pos.x - th.from.x, a.pos.z - th.from.z); }
    if ((a.breathe -= dt) <= 0 && a.state === 'idle') { a.state = 'rise'; }
    let want = 0.55, beat = 0.28, depth = a.cruise ?? (a.cruise = rand(2, 5));
    if (a.state === 'flee') { want = 1.5; beat = 0.7; if ((a.timer -= dt) <= 0) a.state = 'idle'; }
    if (a.state === 'rise') { depth = null; if (a.pos.y > sea - 0.4) { a.state = 'breathe'; a.timer = rand(3, 5); } }
    if (a.state === 'breathe') { depth = null; want = 0.2; beat = 0.15; if ((a.timer -= dt) <= 0) { a.state = 'idle'; a.breathe = rand(50, 120); } }
    a.heading += Math.sin(a.t * 0.13 + a.pos.x) * 0.12 * dt;
    a.speed += (want - a.speed) * Math.min(1, dt * 0.8);
    this.step(a, dt);
    const target = depth === null ? sea - 0.3 : Math.min(sea - 1.4, bed + depth);
    const climb = THREE.MathUtils.clamp((target - a.pos.y) * 0.5, -0.4, 0.5);
    a.pos.y += climb * dt;
    a.pos.y = Math.max(bed + 0.6, Math.min(sea - 0.25, a.pos.y));
    a.obj.visible = true;
    a.obj.position.copy(a.pos);
    a.obj.rotation.set(-climb * 0.6, a.heading, Math.sin(a.t * beat * 6.28) * 0.04, 'YXZ');
    a.obj.userData.animate(a.t, beat, a.state === 'breathe' ? 0.4 : 1);
  }

  ray(a, dt) {
    const th = this.threat(a.pos);
    const bed = heightAt(a.pos.x, a.pos.z);
    if (th.d < 3.5 && a.state !== 'flee') {
      a.state = 'flee'; a.timer = rand(4, 6); a.heading = Math.atan2(a.pos.x - th.from.x, a.pos.z - th.from.z) + rand(-0.4, 0.4);
    }
    if ((a.timer -= dt) <= 0) {
      if (a.state === 'idle') { a.state = 'glide'; a.timer = rand(8, 20); }
      else { a.state = 'idle'; a.timer = rand(10, 35); }
    }
    const want = a.state === 'flee' ? 2.2 : a.state === 'glide' ? 0.6 : 0;
    a.speed += (want - a.speed) * Math.min(1, dt * (a.state === 'flee' ? 2 : 0.6));
    if (a.state !== 'idle') a.heading += Math.sin(a.t * 0.2 + a.pos.z) * 0.25 * dt;
    this.step(a, dt);
    const lift = a.state === 'idle' ? 0.03 : a.state === 'flee' ? 0.9 : 0.4;
    a.pos.y += (bed + lift - a.pos.y) * Math.min(1, dt * 1.5);
    a.obj.visible = true;
    a.obj.position.copy(a.pos);
    a.obj.rotation.set(0, a.heading, Math.sin(a.t * 0.7) * 0.05 * (a.speed > 0.1 ? 1 : 0), 'YXZ');
    const amp = a.state === 'idle' ? 0.004 : a.state === 'flee' ? 0.12 : 0.06;
    a.obj.userData.animate(a.t, a.state === 'flee' ? 1.4 : 0.5, amp);
  }

  octopus(a, dt) {
    const th = this.threat(a.pos);
    if (th.d < 2.8 && a.state !== 'jet' && a.state !== 'hide') {
      a.state = 'jet'; a.timer = 1.6;
      a.heading = Math.atan2(th.from.x - a.pos.x, th.from.z - a.pos.z);        // it faces what scared it, and shoots off backwards
      this.squirt(a.pos);
      a.shade.set(0xe8ddd0);                                                    // blanched
    }
    if ((a.timer -= dt) <= 0) {
      if (a.state === 'jet') { a.state = 'hide'; a.timer = rand(6, 12); }
      else if (a.state === 'hide' || a.state === 'idle') { a.state = 'crawl'; a.timer = rand(5, 14); }
      else { a.state = 'idle'; a.timer = rand(6, 18); a.want.set(OCTO_SHADES[Math.random() * OCTO_SHADES.length | 0]); }
    }
    const floor = this.floor(a.pos.x, a.pos.z);
    let mode = 0;
    if (a.state === 'jet') {
      mode = 1;
      a.speed = 3.2 * (a.timer / 1.6) + 0.3;
      this.step(a, dt, Math.PI);
      a.pos.y += (floor + 0.9 - a.pos.y) * Math.min(1, dt * 3);
    } else {
      a.speed = a.state === 'crawl' ? 0.14 : 0;
      if (a.state === 'crawl') { a.heading += Math.sin(a.t * 0.4 + a.pos.x) * 0.6 * dt; this.step(a, dt); }
      a.pos.y += (floor - a.pos.y) * Math.min(1, dt * 2);
      a.shade.lerp(a.want, Math.min(1, dt * 0.35));
    }
    if (a.obj.userData.tint) a.obj.userData.tint(a.shade);
    else a.obj.userData.skin.color.copy(a.shade);
    a.obj.visible = true;
    a.obj.position.copy(a.pos);
    a.obj.rotation.set(mode ? 0.35 : 0, a.heading, 0, 'YXZ');
    a.obj.scale.setScalar(a.scale);
    a.obj.userData.animate(a.t, a.speed, mode);
  }

  crab(a, dt, time) {
    const th = this.threat(a.pos);
    const scared = th.d < (a.beach ? 4 : 2.2);
    if (scared && a.state !== 'flee') {
      // On a beach it runs until it is in the sea; on the reef, a few metres will do.
      a.state = 'flee'; a.timer = a.beach ? 8 : rand(1.5, 3);
      if (a.beach) {
        // For the water: downhill, toward the sea.
        const e = 1.5, gx = heightAt(a.pos.x + e, a.pos.z) - heightAt(a.pos.x - e, a.pos.z), gz = heightAt(a.pos.x, a.pos.z + e) - heightAt(a.pos.x, a.pos.z - e);
        a.run = Math.atan2(-gx, -gz);
      } else a.run = Math.atan2(a.pos.x - th.from.x, a.pos.z - th.from.z);
    }
    if ((a.timer -= dt) <= 0) {
      if (a.state === 'scuttle' || a.state === 'flee') { a.state = 'idle'; a.timer = rand(0.8, 4); }
      else { a.state = 'scuttle'; a.timer = rand(0.4, 1.4); a.side = Math.random() < 0.5 ? 1 : -1; }
    }
    // Crabs go sideways: facing across the way they run.
    const fleeing = a.state === 'flee', going = fleeing || a.state === 'scuttle';
    if (fleeing) a.heading += wrap(a.run - Math.PI / 2 - a.heading) * Math.min(1, dt * 8);
    a.speed = fleeing ? (a.beach ? 1.9 : 1.1) : a.state === 'scuttle' ? 0.35 : 0;
    const side = fleeing ? Math.PI / 2 : (a.side || 1) * Math.PI / 2;
    const dir = a.heading + side;
    const nx = a.pos.x + Math.sin(dir) * a.speed * dt, nz = a.pos.z + Math.cos(dir) * a.speed * dt;
    if (a.beach && fleeing && heightAt(nx, nz) < -0.1) { a.caught = rand(20, 40); return; }   // into the sea: gone
    if (this.fits(a, nx, nz) || (a.beach && fleeing)) { a.pos.x = nx; a.pos.z = nz; }
    else a.side = -(a.side || 1);
    a.pos.y = a.beach ? heightAt(a.pos.x, a.pos.z) : this.floor(a.pos.x, a.pos.z);
    a.moving += ((going ? 1 : 0) - a.moving) * Math.min(1, dt * 10);
    a.gait += dt * (fleeing ? 5 : 3) * a.moving;
    a.claws += ((fleeing ? 1 : 0.3) - a.claws) * Math.min(1, dt * 4);
  }

  /** Stand a shelled animal on the ground at its feet, pitched and rolled with it. */
  stand(a, y) {
    const o = a.obj, e = a.length * 0.4;
    const fx = Math.sin(a.heading) * e, fz = Math.cos(a.heading) * e;
    const pitch = Math.atan2(heightAt(a.pos.x - fx, a.pos.z - fz) - heightAt(a.pos.x + fx, a.pos.z + fz), 2 * e);
    const roll = Math.atan2(heightAt(a.pos.x + fz, a.pos.z - fx) - heightAt(a.pos.x - fz, a.pos.z + fx), 2 * e);
    o.position.set(a.pos.x, y, a.pos.z);
    o.rotation.set(pitch, a.heading, roll, 'YXZ');
    o.visible = true;
  }

  /** Move a shelled animal's legs and head: `walk`/`swim` how hard (0..1). */
  limbs(a, dt, walk, swim) {
    const u = a.obj.userData.limbs;
    a.step += dt * (walk * 2.4 + swim * 3.2) * (0.35 / a.length) ** 0.5;
    u.uPhase.value = a.step;
    u.uStride.value = 0.06 * walk; u.uLift.value = 0.035 * walk; u.uSwim.value = 0.1 * swim;
    u.uHide.value = a.hide; u.uGraze.value = a.graze * (1 - a.hide);
    u.uLook.value = Math.sin(a.t * 0.4 + a.length * 20) * (1 - a.hide) * (1 - walk);
  }

  /**
   * A tortoise: plods a little way, stops to graze, plods on — and if you
   * come up to it, stops where it is and draws itself in, until you have
   * been gone a while.
   */
  tortoise(a, dt) {
    const th = this.threat(a.pos);
    if (th.d < 3) { a.state = 'hide'; a.timer = rand(5, 9); }
    if ((a.timer -= dt) <= 0) {
      if (a.state === 'walk') { a.state = 'graze'; a.timer = rand(4, 12); }
      else { a.state = 'walk'; a.timer = rand(5, 15); a.heading += rand(-1.2, 1.2); }
    }
    const walking = a.state === 'walk';
    a.speed += ((walking ? 0.09 * a.length / 0.5 : 0) - a.speed) * Math.min(1, dt * 2);
    if (a.speed > 0.005) this.step(a, dt);
    a.pos.y = heightAt(a.pos.x, a.pos.z);
    a.hide += ((a.state === 'hide' ? 1 : 0) - a.hide) * Math.min(1, dt * (a.state === 'hide' ? 5 : 0.8));
    a.graze += ((a.state === 'graze' ? 0.5 + 0.5 * Math.sin(a.t * 1.7) : 0) - a.graze) * Math.min(1, dt * 3);
    this.stand(a, a.pos.y - a.hide * a.length * 0.04);
    this.limbs(a, dt, Math.min(1, a.speed / 0.03), 0);
  }

  /**
   * A pond turtle: paddles about at the surface of its lake, and now and
   * then hauls out on the bank to bask. Come near and it slides back in and
   * dives, and stays down a while before it comes up again.
   */
  pond_turtle(a, dt) {
    const L = a.lake, th = this.threat(a.pos);
    const water = freshWaterAt(a.pos.x, a.pos.z);
    const scared = th.d < (a.state === 'bask' || a.state === 'haul' ? 6 : 3.5);
    if (scared && a.state !== 'dive') {
      a.state = 'dive'; a.timer = rand(14, 24);
      a.heading = Math.atan2(L.x - a.pos.x, L.z - a.pos.z);                  // for the middle of the lake
    }
    if ((a.timer -= dt) <= 0) {
      if (a.state === 'swim') {
        // Out onto the bank, at the nearest bit of shore.
        a.state = 'haul'; a.timer = 40;
        const dx = a.pos.x - L.x, dz = a.pos.z - L.z;
        const uu = dx * L.cos + dz * L.sin, vv = -dx * L.sin + dz * L.cos, ang = Math.atan2(vv, uu);
        const r = lakeShore(L, ang) + 1.2, u = Math.cos(ang) * r, v = Math.sin(ang) * r;
        a.goal = new THREE.Vector3(L.x + u * L.cos - v * L.sin, 0, L.z + u * L.sin + v * L.cos);
      } else if (a.state === 'bask' || a.state === 'haul') { a.state = 'return'; a.timer = 30; a.heading = Math.atan2(L.x - a.pos.x, L.z - a.pos.z); }
      else { a.state = 'swim'; a.timer = rand(20, 60); }
    }
    let want = 0, depth = 0;
    if (a.state === 'swim') {
      want = 0.12; a.heading += Math.sin(a.t * 0.3 + a.length * 40) * 0.5 * dt;
    } else if (a.state === 'haul') {
      want = 0.1;
      a.heading += wrap(Math.atan2(a.goal.x - a.pos.x, a.goal.z - a.pos.z) - a.heading) * Math.min(1, dt * 2);
      if (!water && Math.hypot(a.goal.x - a.pos.x, a.goal.z - a.pos.z) < 0.4) { a.state = 'bask'; a.timer = rand(25, 60); }
    } else if (a.state === 'return') {
      want = 0.12;
      if (water && water.depth > 0.35) { a.state = 'swim'; a.timer = rand(20, 60); }
    } else if (a.state === 'dive') {
      want = 0.45; depth = water ? Math.max(0, water.depth - a.length * 0.5) : 0;
      a.heading += Math.sin(a.t * 0.7) * 0.4 * dt;
    }
    a.speed += (want - a.speed) * Math.min(1, dt * 2);
    const dir = a.heading, nx = a.pos.x + Math.sin(dir) * a.speed * dt, nz = a.pos.z + Math.cos(dir) * a.speed * dt;
    // In the water it keeps to deep enough; on the way out, or back, it goes where it must.
    const free = a.state === 'haul' || a.state === 'return' || (a.state === 'dive' && !water);
    if (free || this.fits(a, nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
    else a.heading += Math.PI * rand(0.6, 1.4);
    const w = freshWaterAt(a.pos.x, a.pos.z), ground = heightAt(a.pos.x, a.pos.z);
    const afloat = w && w.depth > a.length * 0.35;
    const y = afloat ? w.level - depth - a.length * 0.24 : ground;        // afloat, the shell just awash
    a.pos.y += (y - a.pos.y) * Math.min(1, dt * (afloat ? 2 : 6));
    a.hide = 0; a.graze = 0;
    if (afloat) { a.obj.position.copy(a.pos); a.obj.rotation.set(a.state === 'dive' ? 0.25 : -0.05, a.heading, 0, 'YXZ'); a.obj.visible = true; }
    else this.stand(a, a.pos.y);
    const moving = Math.min(1, a.speed / 0.08);
    this.limbs(a, dt, afloat ? 0 : moving, afloat ? Math.max(0.25, moving) : 0);
  }

  squirt(at) {
    const ink = this.ink;
    ink.age = 0;
    ink.at.copy(at).y += 0.2;
    for (const p of ink.puffs) p.set(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3));
  }

  updateInk(dt) {
    const ink = this.ink;
    ink.age += dt;
    const life = 4;
    ink.points.visible = ink.age < life;
    if (!ink.points.visible) return;
    const pos = ink.points.geometry.attributes.position, grow = 1 + ink.age * 1.2;
    ink.puffs.forEach((p, i) => pos.setXYZ(i, ink.at.x + p.x * grow, ink.at.y + p.y * grow + ink.age * 0.1, ink.at.z + p.z * grow));
    pos.needsUpdate = true;
    ink.points.material.size = 0.8 + ink.age * 0.9;
    ink.points.material.opacity = 0.85 * (1 - ink.age / life);
  }

  // ── catching ───────────────────────────────────────────────────────────────
  /** The animal of a kind under the crosshair, within reach. */
  pick(eye, dir, reach, kind) {
    let best = null, bestD = reach;
    for (const a of this.animals) {
      if (a.kind !== kind || !a.placed || a.caught > 0) continue;
      const c = this._c ||= new THREE.Vector3();
      c.copy(a.pos).y += kind === 'crab' ? 0.07 : 0.15;
      const along = c.clone().sub(eye).dot(dir);
      if (along < 0 || along > bestD) continue;
      if (c.clone().sub(eye).addScaledVector(dir, -along).length() < (kind === 'crab' ? 0.3 : 0.4)) { best = a; bestD = along; }
    }
    return best;
  }

  /** Every octopus the segment a→b (a spear's point, this frame) runs through. */
  hitSegment(a, b, out = []) {
    const ab = b.clone().sub(a), len2 = ab.lengthSq() || 1e-6;
    for (const o of this.animals) {
      if (o.kind !== 'octopus' || !o.placed || o.caught > 0) continue;
      // The whole spread of it counts, arms and all — not only the mantle.
      const c = o.pos.clone(); c.y += 0.1;
      const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(ab) / len2, 0, 1);
      if (a.clone().addScaledVector(ab, t).distanceTo(c) < 0.48 * (o.scale ?? 1)) out.push(o);
    }
    return out;
  }

  /** Take an animal out of the water (caught): its still body, to hang on a spear or keep. */
  take(a) {
    a.caught = rand(40, 70);
    if (a.obj) a.obj.visible = false;
    return this.bodyFor(a.kind, a.kind === 'octopus' ? 0.6 * (a.scale ?? 1) : 0.2 * a.size, a.colour);
  }

  // ── as catches (items.js CATCHES) ──────────────────────────────────────────
  /** Name and size, the way FishSchools.species() gives them for a fish. */
  species(key) {
    const sp = REEF_ANIMALS[key];
    if (!sp || !sp.catch) return null;
    return { key, name: sp.name, length: sp.length, big: false };
  }

  /**
   * A still body, `length` long along +z (as a still fish is), with its own
   * material so it can brown on a fire; `userData.fish` names it, as a fish's does.
   */
  bodyFor(key, length, colour = null) {
    let mesh;
    const model = key === 'crab' && this.crabs.stillModel(colour ? colour.getHex() : 0xffffff);
    if (model) {
      mesh = model;
      mesh.scale.setScalar(length / MODEL_CRAB_LENGTH);
    } else if (key === 'crab') {
      mesh = crabStill(colour ? colour.getHex() : 0xc24a2c);
      mesh.scale.setScalar(length / 0.2);
    } else if (key === 'octopus' && this.models.octopus) {
      // Posed as it jets, arms trailing together — how it hangs from a spear.
      const o = octopusModel(this.models.octopus, 0.8);
      for (let k = 0; k < 40; k++) o.userData.animate(5 + k * 0.05, 0, 1);
      const parts = stillOf(o);
      const g = parts[0].geometry;
      g.rotateY(Math.PI);                                          // jetting it lies along z, arms first: head first
      g.computeBoundingBox();
      g.translate(0, -(g.boundingBox.min.y + g.boundingBox.max.y) / 2, -(g.boundingBox.min.z + g.boundingBox.max.z) / 2);
      const mat = parts[0].material.clone();
      mat.color.set(OCTO_SHADES[0]).offsetHSL(0, -0.1, 0.22);
      mesh = new THREE.Mesh(g, mat);
      mesh.scale.setScalar(length / Math.max(0.01, g.boundingBox.max.z - g.boundingBox.min.z));
    } else if (key === 'octopus') {
      const o = octopusBody();
      o.userData.animate(1.3, 0, 1);                              // arms together: how it hangs
      o.updateMatrixWorld(true);
      const parts = [];
      o.traverse(m => {
        if (!m.isMesh) return;
        // The arms have no uv and the body does: only what they all have, or they will not merge.
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
        parts.push(g);
      });
      const g = mergeGeometries(parts.map(x => (x.index ? x.toNonIndexed() : x)), false);
      g.computeVertexNormals();
      g.rotateX(-Math.PI / 2);                                     // along +z, head first
      mesh = new THREE.Mesh(g, skin({ color: OCTO_SHADES[0], roughness: 0.45 }));
      mesh.scale.setScalar(length / 0.6);
    } else return null;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.fish = { key, name: REEF_ANIMALS[key].name };
    return mesh;
  }
}
