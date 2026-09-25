// ── Statues ──────────────────────────────────────────────────────────────────
// Places to wake. Figures carved long ago stand here and there over the land
// — on beaches, in the forest, up on the hills (scatter()) — and one is a
// checkpoint, nothing more: stand at it and press E and it is yours to wake
// at: die, and you come to beside it rather than back where you first came
// ashore. They unlock nothing and lead nowhere; the game is surviving,
// exploring, gathering and building. Each player has one at a time (the
// last they registered at). Any of them can be lifted (X), carried, and set
// up somewhere else — on land, or on the raft's deck, where it sails with it —
// except one someone else wakes at (main.js wakers).
// You can carve your own, too.
//
// Carved in code: a plinth of lashed logs, a tapering body with arms folded
// across it, a broad head with a brow and deep-set eyes, a palm-frond crown.
// The one you are registered at wears a garland of flowers — on your screen.

import * as THREE from 'three';
import { heightAt, slopeAt, coastDistance, WORLD } from './terrain.js';

const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const M = {};
const mats = () => (M.wood ? M : Object.assign(M, {
  wood: mat(0x8a6a48), dark: mat(0x3a2a1c, 0.95), log: mat(0x5e4630, 0.9), rope: mat(0xb39360, 0.95),
  leaf: new THREE.MeshStandardMaterial({ color: 0x5f8f3e, roughness: 0.8, side: THREE.DoubleSide }),
  bloom: mat(0xe8603c, 0.7), bloom2: mat(0xf2c14e, 0.7),
}));

/** A statue, standing on y = 0 and facing -Z, `size` 1 about 1.9 m tall. */
export function statueBody(size = 1) {
  const m = mats();
  const g = new THREE.Group();
  const add = (geo, mt, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, mt);
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    o.castShadow = o.receiveShadow = true;
    g.add(o);
    return o;
  };
  // The plinth: three short logs, lashed.
  for (const [x, r] of [[-0.24, 0.13], [0.0, 0.14], [0.24, 0.13]]) {
    add(new THREE.CylinderGeometry(r, r, 0.62, 9), m.log, x, 0.13, 0, Math.PI / 2);   // lying front to back
  }
  add(new THREE.TorusGeometry(0.29, 0.016, 5, 16), m.rope, 0, 0.13, 0.16, 0, Math.PI / 2, 0).scale.set(1, 0.6, 1);
  // The body: a tapering post, the arms folded across it.
  add(new THREE.CylinderGeometry(0.19, 0.25, 0.95, 10), m.wood, 0, 0.74, 0);
  add(new THREE.BoxGeometry(0.46, 0.1, 0.16), m.wood, 0, 0.82, -0.17);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.09, 0.34, 0.12), m.wood, s * 0.23, 0.95, -0.1, 0, 0, s * 0.2);
  add(new THREE.BoxGeometry(0.4, 0.035, 0.03), m.dark, 0, 0.62, -0.235);            // a carved band
  // The head: broad, with a heavy brow, deep eyes, a long nose, a mouth.
  add(new THREE.BoxGeometry(0.42, 0.5, 0.36), m.wood, 0, 1.47, 0);
  add(new THREE.BoxGeometry(0.44, 0.07, 0.1), m.wood, 0, 1.6, -0.18);                 // brow
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.06, 0.04), m.dark, s * 0.1, 1.53, -0.18);
  add(new THREE.BoxGeometry(0.07, 0.2, 0.08), m.wood, 0, 1.43, -0.2);                 // nose
  add(new THREE.BoxGeometry(0.2, 0.04, 0.03), m.dark, 0, 1.3, -0.18);                 // mouth
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.16, 0.08), m.wood, s * 0.23, 1.47, 0);   // ears
  // A crown of palm fronds.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const f = add(new THREE.PlaneGeometry(0.1, 0.42), m.leaf, Math.sin(a) * 0.12, 1.86, Math.cos(a) * 0.1);
    f.rotation.set(-Math.cos(a) * 0.5, a, 0);
  }
  // A garland, shown on the one you are registered at.
  const garland = new THREE.Group();
  garland.name = 'garland';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), i % 2 ? m.bloom : m.bloom2);
    b.position.set(Math.sin(a) * 0.26, 1.15 + Math.cos(a * 2) * 0.02, Math.cos(a) * 0.26);
    garland.add(b);
  }
  garland.visible = false;
  g.add(garland);
  g.scale.setScalar(size);
  return g;
}

export class Statues {
  constructor(scene) {
    this.scene = scene;
    this.list = [];            // {id, x, z, yaw, obj}
    this.mine = null;          // the id of the one you are registered at, if it is here
  }

  /** Can one stand here: on land, not too steep, not crowding another? */
  canStand(x, z) {
    if (heightAt(x, z) < 0.3 || slopeAt(x, z) > 0.3) return false;
    return !this.list.some(s => Math.hypot(s.x - x, s.z - z) < 2.5);
  }

  add({ id, x, z, yaw }) {
    if (this.find(id)) return this.find(id);
    const obj = statueBody();
    obj.position.set(x, heightAt(x, z) - 0.03, z);
    obj.rotation.y = yaw;
    this.scene.add(obj);
    const s = { id, x, z, yaw, obj };
    obj.traverse(m => { if (m.isMesh) m.userData.statue = s; });
    this.list.push(s);
    this.mark(this.mine);
    return s;
  }

  remove(id) {
    const s = this.find(id);
    if (!s) return null;
    s.obj.removeFromParent();
    this.list.splice(this.list.indexOf(s), 1);
    return s;
  }

  find(id) { return this.list.find(s => s.id === id) || null; }

  /** The garland goes on the one you are registered at. */
  mark(id) {
    this.mine = id;
    for (const s of this.list) s.obj.getObjectByName('garland').visible = s.id === id;
  }

  /** The statue under the crosshair, within reach. */
  pick(eye, dir, reach = 3.6) {
    let best = null, bestAlong = reach;
    const c = new THREE.Vector3();
    for (const s of this.list) {
      c.set(s.x, s.obj.position.y + 1.0, s.z);
      const along = c.clone().sub(eye).dot(dir);
      if (along < 0 || along > bestAlong) continue;
      if (c.clone().sub(eye).addScaledVector(dir, -along).length() < 0.75) { best = s; bestAlong = along; }
    }
    return best;
  }

  toJSON() { return this.list.map(s => [s.id, +s.x.toFixed(2), +s.z.toFixed(2), +s.yaw.toFixed(3)]); }

  /** Statues within `r` of p. */
  near(p, r) {
    return this.list.filter(s => Math.hypot(s.x - p.x, s.z - p.z) < r);
  }

  load(list) {
    this.clear();
    for (const [id, x, z, yaw] of list || []) if (id) this.add({ id, x, z, yaw });
  }

  clear() {
    for (const s of this.list) s.obj.removeFromParent();
    this.list.length = 0;
  }
}

export const newStatueId = () => Math.random().toString(36).slice(2, 10);

/**
 * Where the statues of a new world stand: `n` of them over the whole land,
 * a few near the coast (so there is one to wake at not far from the sea) and the rest
 * anywhere — forest, hillside, inland — each well apart from the next.
 */
export function scatter(n = 24) {
  const out = [];
  const coastal = Math.round(n * 0.25);
  for (let tries = 0; tries < 20000 && out.length < n; tries++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (WORLD.radius + 60);
    const x = WORLD.cx + Math.cos(a) * r, z = WORLD.cz + Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 0.6 || h > 85 || slopeAt(x, z) > 0.22) continue;
    const near = coastDistance(x, z) < 70;
    if (out.length < coastal ? !near : near && Math.random() < 0.7) continue;
    if (out.some(s => Math.hypot(s.x - x, s.z - z) < 90)) continue;
    out.push({ id: `w${out.length + 1}-${newStatueId().slice(0, 4)}`, x, z, yaw: Math.random() * Math.PI * 2 });
  }
  return out;
}
