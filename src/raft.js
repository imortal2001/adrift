// ── The raft ─────────────────────────────────────────────────────────────────
// A grid of 2m cells that floats on the shared wave field. Cells carry edges
// (walls / railings), a roof slot and one object slot each.
//
// It goes where it is paddled (or, with a sail, blown): it has a place in the
// world and a heading, a speed and a turn, which the water slows, and it runs
// aground on anything shallower than its draught. Its pieces live in its own
// frame — cell (cx, cz) is at (cx·CELL, cz·CELL) there — so everything that
// asks "what is at this spot" of it in world terms (cellAtWorld, deckY,
// resolve, nearestDeck) turns the question into that frame first, and carry()
// moves whoever is standing on it along with it.

import * as THREE from 'three';
import { waveHeight, waveNormal } from './ocean.js';
import { textures } from './textures.js';
import { BUILDABLE_BY_ID, FIRE } from './items.js';
import { buildCampfire, updateFire, tickFire } from './fire.js';
import { heightAt } from './terrain.js';
import { statueBody } from './statue.js';

export const CELL = 2;
export const DECK_Y = 0;        // walkable surface, in raft-local space
export const WALL_H = 2.2;
export const ROOF_Y = 2.34;
export const MAX_CELLS = 120;

// How it moves. A paddle stroke is an impulse: a push in the direction
// stroked, and a turn from how far off the middle it was made. The water
// takes both off again, so a raft coasts to a stop in some seconds.
const STROKE = 0.46;            // m/s a stroke adds, on the four-cell raft you start with (~1.3 m/s held)
const DRAG = 0.42;              // of its speed, lost a second
const SPIN_DRAG = 0.95;         // of its turn, lost a second
const TOP_SPEED = 2.4;          // m/s
const DRAUGHT = 0.55;           // how far under the water it reaches: shallower than this is aground
const SAIL_PUSH = 0.62;         // m/s² a raised sail gives the four-cell raft, in a fresh wind

/**
 * The wind at sea-clock `time`: which way it blows (a unit vector, world x
 * and z) and how hard (0..1). It swings round slowly over the day and
 * freshens and falls away — the same on every machine, since it runs on the
 * shared sea clock.
 */
export function windAt(time, out = { x: 0, z: 0, strength: 0 }) {
  const a = 0.9 + Math.sin(time / 310) * 0.8 + Math.sin(time / 97 + 1.3) * 0.18;
  out.x = Math.sin(a);
  out.z = Math.cos(a);
  out.strength = 0.72 + 0.28 * Math.sin(time / 143 + 0.4);
  return out;
}
const UP = new THREE.Vector3(0, 1, 0);
const key = (cx, cz) => `${cx},${cz}`;
const ekey = (cx, cz, s) => `${cx},${cz},${s}`;
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // side 0,1,2,3

/** Sides 0 (-z) and 3 (-x) are the same boundary as a neighbour's 2 and 1. */
function normEdge(cx, cz, s) {
  if (s === 0) return [cx, cz - 1, 2];
  if (s === 3) return [cx - 1, cz, 1];
  return [cx, cz, s];
}
function edgeCells(cx, cz, s) {
  return s === 1 ? [[cx, cz], [cx + 1, cz]] : [[cx, cz], [cx, cz + 1]];
}

// ── geometry & material caches ───────────────────────────────────────────────
const G = {};
function geo(name, make) { return G[name] || (G[name] = make()); }

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const t = textures();
  const std = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.02, ...o });
  MATS = {
    deck:  std(t.deck),
    wall:  std(t.wall),
    roof:  std(t.roof),
    plank: std(t.plank),
    log:   std(t.log, { roughness: 0.95 }),
    cloth: std(t.cloth, { roughness: 0.9, side: THREE.DoubleSide }),
    metal: std(t.metal, { roughness: 0.62, metalness: 0.45 }),
    stone: std(null, { color: 0x6d7175, roughness: 0.95 }),
    ash:   std(null, { color: 0x2e2a27, roughness: 1 }),
    water: std(null, { color: 0x2f9fd0, roughness: 0.15, metalness: 0.1,
                       transparent: true, opacity: 0.85 }),
    glow:  new THREE.SpriteMaterial({ map: t.glow, color: 0xffb055, transparent: true,
                                      opacity: 0.75, blending: THREE.AdditiveBlending,
                                      depthWrite: false }),
  };
  return MATS;
}

function mesh(g, m, x, y, z) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

// ── piece builders ───────────────────────────────────────────────────────────
// Each builder returns a group already placed in raft-local space. `M` resolves
// materials, so the build ghost can swap every surface for translucent blue.

const BUILD = {
  foundation(t, M) {
    const g = new THREE.Group();
    const x = t.cx * CELL, z = t.cz * CELL;
    g.add(mesh(geo('deck', () => new THREE.BoxGeometry(CELL, 0.14, CELL)), M('deck'), x, -0.07, z));
    const logG = geo('float', () => {
      const c = new THREE.CylinderGeometry(0.21, 0.21, CELL - 0.06, 10);
      c.rotateZ(Math.PI / 2);
      return c;
    });
    for (const off of [-0.62, 0, 0.62]) g.add(mesh(logG, M('log'), x, -0.31, z + off));
    return g;
  },

  railing(t, M) {
    const g = new THREE.Group();
    const [ex, ez, s] = [t.ex, t.ez, t.es];
    const along = s === 1 ? 'z' : 'x';
    const px = s === 1 ? ex * CELL + 1 : ex * CELL;
    const pz = s === 1 ? ez * CELL : ez * CELL + 1;
    const postG = geo('post', () => new THREE.BoxGeometry(0.11, 0.95, 0.11));
    const railG = geo('rail', () => new THREE.BoxGeometry(CELL - 0.04, 0.09, 0.09));
    for (const d of [-0.94, 0.94]) {
      g.add(mesh(postG, M('plank'), px + (along === 'x' ? d : 0), 0.47, pz + (along === 'z' ? d : 0)));
    }
    for (const h of [0.9, 0.5]) {
      const r = mesh(railG, M('plank'), px, h, pz);
      if (along === 'z') r.rotation.y = Math.PI / 2;
      g.add(r);
    }
    return g;
  },

  wall(t, M) {
    const g = new THREE.Group();
    const s = t.es;
    const px = s === 1 ? t.ex * CELL + 1 : t.ex * CELL;
    const pz = s === 1 ? t.ez * CELL : t.ez * CELL + 1;
    const w = mesh(geo('wall', () => new THREE.BoxGeometry(CELL - 0.04, WALL_H, 0.13)),
                   M('wall'), px, WALL_H / 2, pz);
    if (s === 1) w.rotation.y = Math.PI / 2;
    g.add(w);
    const beam = mesh(geo('beam', () => new THREE.BoxGeometry(CELL, 0.13, 0.2)),
                      M('plank'), px, WALL_H - 0.06, pz);
    if (s === 1) beam.rotation.y = Math.PI / 2;
    g.add(beam);
    return g;
  },

  roof(t, M) {
    const g = new THREE.Group();
    const x = t.cx * CELL, z = t.cz * CELL;
    g.add(mesh(geo('roofslab', () => new THREE.BoxGeometry(CELL + 0.1, 0.13, CELL + 0.1)),
               M('roof'), x, ROOF_Y, z));
    const postG = geo('rpost', () => new THREE.BoxGeometry(0.12, ROOF_Y, 0.12));
    for (const [dx, dz] of [[-0.92, -0.92], [0.92, -0.92], [0.92, 0.92], [-0.92, 0.92]]) {
      g.add(mesh(postG, M('plank'), x + dx, ROOF_Y / 2, z + dz));
    }
    return g;
  },

  collector(t, M) {
    const g = new THREE.Group();
    const x = t.cx * CELL, z = t.cz * CELL;
    const legG = geo('cleg', () => new THREE.BoxGeometry(0.09, 1.15, 0.09));
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      g.add(mesh(legG, M('plank'), x + dx, 0.57, z + dz));
    }
    const funnel = mesh(geo('funnel', () => {
      const c = new THREE.ConeGeometry(0.78, 0.46, 4, 1, true);
      c.rotateY(Math.PI / 4);
      return c;
    }), M('cloth'), x, 1.2, z);
    g.add(funnel);
    const jar = mesh(geo('jar', () => new THREE.CylinderGeometry(0.25, 0.22, 0.52, 12)),
                     M('metal'), x, 0.26, z);
    g.add(jar);
    const water = mesh(geo('cwater', () => new THREE.CylinderGeometry(0.21, 0.19, 1, 12)),
                       M('water'), x, 0.05, z);
    water.name = 'level';
    g.add(water);
    return g;
  },

  // A mast, a yard across it, and a sail of woven palm below the yard — or
  // rolled up under it, lowered. The rig turns to the wind (see update).
  sail(t, M) {
    const g = new THREE.Group();
    const x = t.cx * CELL, z = t.cz * CELL;
    g.add(mesh(geo('mast', () => new THREE.CylinderGeometry(0.055, 0.08, 3.7, 8)), M('plank'), x, 1.85, z));
    const rig = new THREE.Group();
    rig.name = 'rig';
    rig.position.set(x, 0, z);
    g.add(rig);
    rig.add(mesh(geo('yard', () => new THREE.CylinderGeometry(0.04, 0.04, 2.1, 6).rotateZ(Math.PI / 2)),
                 M('plank'), 0, 3.35, 0.09));
    // Bellied out forward (-z) by the wind behind it: deepest in the middle.
    const cloth = mesh(geo('sailcloth', () => {
      const p = new THREE.PlaneGeometry(1.9, 2.1, 10, 10);
      const a = p.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const u = a.getX(i) / 0.95, v = (a.getY(i) + 1.05) / 2.1;
        a.setZ(i, -0.38 * (1 - u * u) * Math.sin(Math.PI * Math.min(1, 0.15 + v * 0.95)));
      }
      p.computeVertexNormals();
      p.translate(0, 2.28, 0.1);
      return p;
    }), M('cloth'), 0, 0, 0);
    cloth.name = 'cloth';
    rig.add(cloth);
    const furl = mesh(geo('furl', () => new THREE.CylinderGeometry(0.1, 0.1, 1.9, 8).rotateZ(Math.PI / 2)),
                      M('cloth'), 0, 3.2, 0.12);
    furl.name = 'furl';
    furl.visible = false;                // set until update() says otherwise
    rig.add(furl);
    return g;
  },

  // A statue set up on the deck (statue.js): the same figure as on land, a
  // little smaller, lashed down. In the build ghost it is all one colour.
  statue(t, M) {
    const g = statueBody(0.78);
    g.position.set(t.cx * CELL, 0, t.cz * CELL);
    if (M('plank') !== mats().plank) g.traverse(o => { if (o.isMesh) o.material = M('plank'); });
    return g;
  },

  campfire(t, M) {
    const x = t.cx * CELL, z = t.cz * CELL;
    // Stones, wood, flame, sparks and light: src/fire.js.
    const g = buildCampfire(x, z, M, M('log').map);
    // The ash bed: what is left when the wood has burned away.
    const ash = mesh(geo('ash', () => new THREE.CylinderGeometry(0.34, 0.38, 0.03, 12)), M('ash'), x, 0.015, z);
    ash.name = 'ash';
    g.add(ash);
    // A spit to cook on: two forked uprights and a green stick across the
    // fire, out of the flames' way. Shown while there is a fish on it.
    const spit = new THREE.Group();
    spit.name = 'spit';
    spit.position.set(x, 0, z);
    const upG = geo('spitUp', () => new THREE.CylinderGeometry(0.018, 0.022, 0.82, 6));
    for (const sx of [-0.5, 0.5]) {
      const u = mesh(upG, M('log'), sx, 0.41, 0);
      u.rotation.z = -sx * 0.08;
      spit.add(u);
    }
    const bar = mesh(geo('spitBar', () => new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6).rotateZ(Math.PI / 2)),
                     M('log'), 0, 0.78, 0);
    spit.add(bar);
    spit.visible = false;
    g.add(spit);
    return g;
  },
};

export class Raft {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.cells = new Map();   // "cx,cz"   -> { cx, cz, obj }
    this.edges = new Map();   // "cx,cz,s" -> { ex, ez, es, type, obj }
    this.tops  = new Map();   // "cx,cz"   -> { cx, cz, obj }
    this.objs  = new Map();   // "cx,cz"   -> { cx, cz, type, obj, water } (+ fuel, lit, spitFish for a campfire)
    this.wentOut = [];        // campfires that burned out this frame, for the log
    this.pickables = [];
    this.blockers = [];
    this.tilt = 0.55;         // how much of the wave normal the raft takes on
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();

    // Where it is and how it is going: cell (0, 0) is at (x, z) in the world,
    // and the raft is turned `heading` about the vertical from the world's axes.
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.vel = new THREE.Vector2();   // m/s, world x and z
    this.spin = 0;                    // rad/s
    this.last = { x: 0, z: 0, heading: 0 };   // the pose a frame ago, for carry()
    this.aground = false;
    this.up = new THREE.Vector3(0, 1, 0);     // the deck's up, for the camera's sway
    this.follow = null;               // playing together, the host's pose: see steer()
    this._yaw = new THREE.Quaternion();
  }

  // ── where it is ────────────────────────────────────────────────────────────
  /** A point in the raft's frame, in the world (horizontally). */
  toWorld(lx, lz, out = { x: 0, z: 0 }) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    out.x = this.x + lx * c + lz * s;
    out.z = this.z - lx * s + lz * c;
    return out;
  }

  /** A point in the world, in the raft's frame (horizontally). */
  toLocal(x, z, out = { x: 0, z: 0 }) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const dx = x - this.x, dz = z - this.z;
    out.x = dx * c - dz * s;
    out.z = dx * s + dz * c;
    return out;
  }

  /** The middle of the deck, in the world. */
  centre(out = { x: 0, z: 0 }) {
    let mx = 0, mz = 0;
    for (const c of this.cells.values()) { mx += c.cx; mz += c.cz; }
    const n = Math.max(1, this.cells.size);
    return this.toWorld(mx / n * CELL, mz / n * CELL, out);
  }

  /**
   * Move a point that is on the raft along with it, for how it moved this
   * frame. Returns how far it turned, for the one standing there to turn too.
   */
  carry(p) {
    const { x, z, heading } = this.last;
    const dh = this.heading - heading;
    if (!dh && x === this.x && z === this.z) return 0;
    const c = Math.cos(dh), s = Math.sin(dh);
    const dx = p.x - x, dz = p.z - z;
    p.x = this.x + dx * c + dz * s;
    p.z = this.z - dx * s + dz * c;
    return dh;
  }

  /** How fast it is going, m/s. */
  get speed() { return this.vel.length(); }

  /**
   * A paddle stroke: `dir` the way the water is pushed from (so the way the
   * raft goes), made at `at`, `power` 1 for a full stroke (negative to back-paddle).
   * A stroke off to one side turns it as well as pushing it.
   */
  paddle(at, dir, power = 1) {
    const mass = Math.max(4, this.cells.size);
    const push = STROKE * power / Math.pow(mass / 4, 0.7);
    this.vel.x += dir.x * push;
    this.vel.y += dir.z * push;
    const m = this.centre();
    const rx = at.x - m.x, rz = at.z - m.z;
    // The turn: a push forward on the right-hand side swings the bow left,
    // which is +heading. Bigger rafts are harder to turn round.
    this.spin += (rz * dir.x - rx * dir.z) * push * 0.4 / Math.sqrt(mass);
    if (this.vel.length() > TOP_SPEED) this.vel.setLength(TOP_SPEED);
    this.spin = THREE.MathUtils.clamp(this.spin, -0.6, 0.6);
  }

  /** Its pose, for the others: [x, z, heading, vx, vz, spin]. */
  pose() {
    const r = (v, k = 100) => Math.round(v * k) / k;
    return [r(this.x), r(this.z), r(this.heading, 1000), r(this.vel.x), r(this.vel.y), r(this.spin, 1000)];
  }

  /** Take on a pose outright — loading one, or the host's when far out. */
  setPose([x, z, heading, vx = 0, vz = 0, spin = 0]) {
    this.x = x; this.z = z; this.heading = heading;
    this.vel.set(vx, vz); this.spin = spin;
    this.last = { x, z, heading };
    this.place();
  }

  /**
   * Playing together, the host's pose, a moment old: this raft goes on as it
   * was going and is eased onto where that says it now is.
   */
  steer(pose) {
    const [x, z, h] = pose;
    if (Math.hypot(x - this.x, z - this.z) > 8 || Math.abs(Math.atan2(Math.sin(h - this.heading), Math.cos(h - this.heading))) > 0.8) {
      this.setPose(pose);
      return;
    }
    this.follow = { pose, at: performance.now() / 1000 };
  }

  /** Put the group where the pose says (no heave or tilt): before update() has run. */
  place() {
    this.group.position.set(this.x, this.group.position.y, this.z);
    this.group.quaternion.setFromAxisAngle(UP, this.heading);
    this.group.updateMatrixWorld();
  }

  /** Would the raft be aground with cell (0, 0) at (x, z) and this heading? */
  groundedAt(x, z, heading) {
    const c = Math.cos(heading), s = Math.sin(heading);
    for (const cell of this.cells.values()) {
      const lx = cell.cx * CELL, lz = cell.cz * CELL;
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      if (heightAt(wx, wz) > -DRAUGHT) return true;
    }
    return false;
  }

  /** Speed, turn and drag — and the wind in any raised sail; aground, it stops where it touched. */
  sail(dt, time) {
    this.last = { x: this.x, z: this.z, heading: this.heading };
    const raised = [...this.objs.values()].filter(o => o.type === 'sail' && o.raised).length;
    if (raised) {
      const w = windAt(time, this._wind ||= { x: 0, z: 0, strength: 0 });
      const mass = Math.max(4, this.cells.size);
      // Each sail more is less than as much again: they spill each other's wind.
      const push = SAIL_PUSH * w.strength * Math.pow(raised, 0.7) / Math.pow(mass / 4, 0.7) * dt;
      this.vel.x += w.x * push;
      this.vel.y += w.z * push;
      if (this.vel.length() > TOP_SPEED) this.vel.setLength(TOP_SPEED);
    }
    if (this.follow) {
      // Eased onto the host's, carried on from when it was sent.
      const [x, z, h, vx, vz, spin] = this.follow.pose;
      const t = Math.min(1, performance.now() / 1000 - this.follow.at);
      const k = Math.min(1, dt * 2.5);
      const tx = x + vx * t, tz = z + vz * t, th = h + spin * t;
      this.vel.x += (vx - this.vel.x) * k; this.vel.y += (vz - this.vel.y) * k;
      this.spin += (spin - this.spin) * k;
      this.x += (tx - this.x) * k * 0.6; this.z += (tz - this.z) * k * 0.6;
      this.heading += Math.atan2(Math.sin(th - this.heading), Math.cos(th - this.heading)) * k * 0.6;
    }
    const moving = this.vel.lengthSq() > 1e-6 || Math.abs(this.spin) > 1e-5;
    if (!moving) { this.aground = false; return; }
    const nx = this.x + this.vel.x * dt, nz = this.z + this.vel.y * dt, nh = this.heading + this.spin * dt;
    if (this.groundedAt(nx, nz, nh)) {
      // Touched bottom: it stops, and swings a little off what it hit.
      this.aground = true;
      this.vel.multiplyScalar(-0.15);
      this.spin *= -0.2;
    } else {
      this.aground = false;
      this.x = nx; this.z = nz; this.heading = nh;
    }
    this.vel.multiplyScalar(Math.exp(-DRAG * dt));
    this.spin *= Math.exp(-SPIN_DRAG * dt);
    if (this.vel.lengthSq() < 1e-6) this.vel.set(0, 0);
    if (Math.abs(this.spin) < 1e-5) this.spin = 0;
  }

  // ── layout queries ─────────────────────────────────────────────────────────
  cellAtWorld(x, z) {
    const l = this.toLocal(x, z, this._l ||= { x: 0, z: 0 });
    return [Math.round(l.x / CELL), Math.round(l.z / CELL)];
  }
  hasCell(cx, cz) { return this.cells.has(key(cx, cz)); }
  solidAtWorld(x, z) { const [a, b] = this.cellAtWorld(x, z); return this.hasCell(a, b); }
  get size() { return this.cells.size; }

  /** World-space height of the deck under world (x, z), accounting for heave and tilt. */
  deckY(x, z) {
    const l = this.toLocal(x, z, this._l ||= { x: 0, z: 0 });
    return this.group.localToWorld(this._v.set(l.x, DECK_Y, l.z)).y;
  }

  edge(cx, cz, s) {
    const [a, b, c] = normEdge(cx, cz, s);
    return this.edges.get(ekey(a, b, c));
  }

  /** A cell shelters you if it is roofed and closed on three sides. */
  isSheltered(cx, cz) {
    if (!this.tops.has(key(cx, cz))) return false;
    let closed = 0;
    for (let s = 0; s < 4; s++) {
      const e = this.edge(cx, cz, s);
      if (e && e.type === 'wall') { closed++; continue; }
      const [dx, dz] = NEIGHBOURS[s];
      if (this.tops.has(key(cx + dx, cz + dz))) closed++;
    }
    return closed >= 3;
  }

  shelteredAtWorld(x, z) {
    const [cx, cz] = this.cellAtWorld(x, z);
    return this.isSheltered(cx, cz);
  }

  // ── floating ───────────────────────────────────────────────────────────────
  /** @param night 0 by day, 1 at night — firelight has to earn its brightness. */
  update(dt, time, night = 1) {
    mats().glow.opacity = 0.12 + 0.66 * night;
    this.sail(dt, time);
    // Heave from the mean height under the hull, so a bigger raft rides flatter.
    let ex = CELL, ez = CELL;
    for (const c of this.cells.values()) {
      ex = Math.max(ex, Math.abs(c.cx * CELL) + 1);
      ez = Math.max(ez, Math.abs(c.cz * CELL) + 1);
    }
    const w = this._w ||= { x: 0, z: 0 };
    let h = 0;
    for (const [a, b] of [[-ex, -ez], [ex, -ez], [-ex, ez], [ex, ez]]) {
      this.toWorld(a, b, w);
      h += waveHeight(w.x, w.z, time);
    }
    h = (h + waveHeight(this.x, this.z, time) * 2) / 6;
    this.group.position.set(this.x, h + 0.32, this.z);

    // Tilt with the swell, damped as the raft grows — on top of its heading.
    const damp = this.tilt * THREE.MathUtils.clamp(9 / (6 + this.cells.size), 0.22, 1);
    waveNormal(this.x, this.z, time, this._n);
    this.up.set(this._n.x * damp, 1, this._n.z * damp).normalize();
    this._yaw.setFromAxisAngle(UP, this.heading);
    this.group.quaternion.setFromUnitVectors(UP, this.up).multiply(this._yaw);
    this.group.updateMatrixWorld();

    // Animate fires and top up collectors.
    tickFire(time);
    for (const o of this.objs.values()) {
      if (o.type === 'campfire') {
        // Burning uses the wood up; with none left it goes out.
        if (o.lit) {
          o.fuel = Math.max(0, o.fuel - dt);
          if (o.fuel <= 0) { o.lit = false; this.wentOut.push(o); }
        }
        const wood = o.obj.getObjectByName('wood');
        if (wood) wood.visible = o.fuel > 0;
        const ash = o.obj.getObjectByName('ash');
        if (ash) ash.visible = o.fuel <= 0;
        // Burning low, it is a smaller fire: full size down to a third of
        // its wood, then shrinking to embers.
        const size = o.lit ? 0.35 + 0.65 * Math.min(1, o.fuel / (FIRE.max / 3)) : 0;
        const flicker = 0.9 + Math.sin(time * 9 + o.cx) * 0.06 + Math.sin(time * 15.7 + o.cz) * 0.04;
        updateFire(o.obj, { lit: o.lit, size, flicker, night, dt,
                            burnt: 1 - Math.min(1, o.fuel / FIRE.laid),
                            fogDensity: this.scene?.fog?.density });
        const spit = o.obj.getObjectByName('spit');
        if (spit) spit.visible = o.spitFish.length > 0;
      } else if (o.type === 'collector') {
        o.water = Math.min(o.capacity, o.water + dt * o.rate);
        this.refreshCollector(o);
      } else if (o.type === 'sail') {
        // Turned to the wind, its belly downwind; set, or rolled up under the yard.
        const w = windAt(time, this._wind ||= { x: 0, z: 0, strength: 0 });
        const rig = o.obj.getObjectByName('rig');
        rig.rotation.y = Math.atan2(-w.x, -w.z) - this.heading;
        const cloth = rig.getObjectByName('cloth');
        cloth.visible = o.raised;
        rig.getObjectByName('furl').visible = !o.raised;
        if (o.raised) cloth.scale.z = 0.75 + 0.3 * w.strength + Math.sin(time * 1.7 + o.cx) * 0.06;
      }
    }
  }

  refreshCollector(o) {
    const lvl = o.obj.getObjectByName('level');
    if (!lvl) return;
    const f = o.water / o.capacity;
    lvl.visible = f > 0.02;
    lvl.scale.y = Math.max(0.02, f * 0.42);
    lvl.position.y = 0.04 + lvl.scale.y / 2;
  }

  // ── build targeting ────────────────────────────────────────────────────────
  /**
   * Turn a camera ray into a grid target. Returns null when the ray misses the
   * deck plane. Shape: { cx, cz, ex, ez, es, side, point }.
   */
  targetFromRay(origin, dir) {
    const o = this.group.worldToLocal(origin.clone());
    const d = dir.clone().transformDirection(this.group.matrixWorld.clone().invert());
    if (Math.abs(d.y) < 1e-4) return null;
    const tHit = (DECK_Y - o.y) / d.y;
    if (tHit < 0 || tHit > 40) return null;
    const p = o.clone().addScaledVector(d, tHit);

    const cx = Math.round(p.x / CELL), cz = Math.round(p.z / CELL);
    const dx = p.x - cx * CELL, dz = p.z - cz * CELL;
    const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
    const [ex, ez, es] = normEdge(cx, cz, side);
    return { cx, cz, ex, ez, es, side, point: p, dist: tHit };
  }

  canPlace(id, t) {
    if (!t) return false;
    const b = BUILDABLE_BY_ID[id];
    if (!b) return false;
    if (b.kind === 'cell') {
      if (this.hasCell(t.cx, t.cz) || this.cells.size >= MAX_CELLS) return false;
      // The first foundation of all goes wherever you lay it (BuildMode puts the raft there).
      if (!this.cells.size) return true;
      // A save restores cells in arbitrary order, so adjacency can't be required.
      if (t.force) return true;
      return NEIGHBOURS.some(([dx, dz]) => this.hasCell(t.cx + dx, t.cz + dz));
    }
    if (b.kind === 'edge') {
      if (this.edges.has(ekey(t.ex, t.ez, t.es))) return false;
      return edgeCells(t.ex, t.ez, t.es).some(([a, c]) => this.hasCell(a, c));
    }
    if (b.kind === 'top') return this.hasCell(t.cx, t.cz) && !this.tops.has(key(t.cx, t.cz));
    return this.hasCell(t.cx, t.cz) && !this.objs.has(key(t.cx, t.cz));
  }

  place(id, t) {
    if (!this.canPlace(id, t)) return false;
    const b = BUILDABLE_BY_ID[id];
    const M = k => mats()[k];
    const obj = BUILD[id](t, M);
    this.group.add(obj);

    let rec;
    if (b.kind === 'cell') {
      rec = { cx: t.cx, cz: t.cz, obj };
      this.cells.set(key(t.cx, t.cz), rec);
    } else if (b.kind === 'edge') {
      rec = { ex: t.ex, ez: t.ez, es: t.es, type: id, obj };
      this.edges.set(ekey(t.ex, t.ez, t.es), rec);
    } else if (b.kind === 'top') {
      rec = { cx: t.cx, cz: t.cz, obj };
      this.tops.set(key(t.cx, t.cz), rec);
    } else {
      rec = { cx: t.cx, cz: t.cz, type: id, obj,
              water: 0, capacity: id === 'collector' ? 5 : 0,
              rate: id === 'collector' ? 0.085 : 0,
              // A campfire is built with its wood laid and not lit.
              fuel: id === 'campfire' ? FIRE.laid : 0, lit: false, spitFish: [], raised: false };
      this.objs.set(key(t.cx, t.cz), rec);
      if (id === 'collector') this.refreshCollector(rec);
    }

    // Tag every mesh so raycasts can find the owning piece.
    obj.traverse(m => { if (m.isMesh) m.userData.piece = { id, rec, kind: b.kind }; });
    this.rebuildIndex();
    return true;
  }

  /** Meshes the player can look at, and the wall/railing collision boxes. */
  rebuildIndex() {
    this.pickables.length = 0;
    this.group.traverse(m => { if (m.isMesh && m.userData.piece) this.pickables.push(m); });

    this.blockers.length = 0;
    for (const e of this.edges.values()) {
      const th = 0.14;
      if (e.es === 1) {
        const x = e.ex * CELL + 1;
        this.blockers.push({ minX: x - th, maxX: x + th,
                             minZ: e.ez * CELL - 1, maxZ: e.ez * CELL + 1 });
      } else {
        const z = e.ez * CELL + 1;
        this.blockers.push({ minX: e.ex * CELL - 1, maxX: e.ex * CELL + 1,
                             minZ: z - th, maxZ: z + th });
      }
    }
    for (const o of this.objs.values()) {
      const x = o.cx * CELL, z = o.cz * CELL,
            r = o.type === 'campfire' ? 0.62 : o.type === 'sail' ? 0.18 : o.type === 'statue' ? 0.3 : 0.58;
      this.blockers.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    }
  }

  /** Would the raft stay in one piece without this cell? */
  cellRemovable(cx, cz) {
    if (this.cells.size <= 1) return false;
    const remaining = new Set([...this.cells.keys()].filter(k => k !== key(cx, cz)));
    const start = remaining.values().next().value;
    const seen = new Set([start]), stack = [start];
    while (stack.length) {
      const [a, b] = stack.pop().split(',').map(Number);
      for (const [dx, dz] of NEIGHBOURS) {
        const k = key(a + dx, b + dz);
        if (remaining.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    return seen.size === remaining.size;
  }

  /**
   * The piece at a place on the grid, as a mesh's userData.piece names it —
   * for edits that arrive from the others, who name pieces by where they are.
   * kind 'cell' and 'top' and 'object' take (cx, cz); 'edge' takes (ex, ez, es).
   */
  pieceAt(kind, a, b, c) {
    const rec = kind === 'cell' ? this.cells.get(key(a, b))
      : kind === 'edge' ? this.edges.get(ekey(a, b, c))
      : kind === 'top' ? this.tops.get(key(a, b)) : this.objs.get(key(a, b));
    if (!rec) return null;
    return { id: kind === 'cell' ? 'foundation' : kind === 'top' ? 'roof' : rec.type, rec, kind };
  }

  /** Where a piece is, the other way: [kind, ...grid coordinates]. */
  static where(piece) {
    const r = piece.rec;
    return piece.kind === 'edge' ? ['edge', r.ex, r.ez, r.es] : [piece.kind, r.cx, r.cz];
  }

  /**
   * Remove the piece a mesh belongs to. Returns a cost map to refund, or null.
   * Taking out a foundation also takes out whatever was resting on it.
   * `force` takes a foundation out even if the raft would come apart — for
   * matching someone else's raft, which is whole however it got that way.
   */
  removePiece(piece, force = false) {
    const refund = {};
    const add = cost => { for (const k in cost) refund[k] = (refund[k] || 0) + cost[k]; };
    const drop = obj => this.group.remove(obj);   // geometry/material are shared caches
    // Fish on a campfire's spit come back with it — cooked if they were done.
    const spit = o => { for (const f of o?.spitFish || []) add({ [f.t >= FIRE.cook ? f.done : f.raw]: 1 }); };

    if (piece.kind === 'cell') {
      const { cx, cz } = piece.rec;
      if (!force && !this.cellRemovable(cx, cz)) return null;

      const top = this.tops.get(key(cx, cz));
      if (top) { drop(top.obj); this.tops.delete(key(cx, cz)); add(BUILDABLE_BY_ID.roof.cost); }
      const o = this.objs.get(key(cx, cz));
      if (o) { spit(o); drop(o.obj); this.objs.delete(key(cx, cz)); add(BUILDABLE_BY_ID[o.type].cost); }

      this.cells.delete(key(cx, cz));
      // Edges that were only held up by this cell come away with it.
      for (let s = 0; s < 4; s++) {
        const [a, b, c] = normEdge(cx, cz, s);
        const e = this.edges.get(ekey(a, b, c));
        if (!e) continue;
        const supported = edgeCells(a, b, c).some(([m, n]) => this.hasCell(m, n));
        if (!supported) { drop(e.obj); this.edges.delete(ekey(a, b, c)); add(BUILDABLE_BY_ID[e.type].cost); }
      }
      drop(piece.rec.obj);
      add(BUILDABLE_BY_ID.foundation.cost);
    } else if (piece.kind === 'edge') {
      const { ex, ez, es, type } = piece.rec;
      this.edges.delete(ekey(ex, ez, es));
      drop(piece.rec.obj);
      add(BUILDABLE_BY_ID[type].cost);
    } else if (piece.kind === 'top') {
      const { cx, cz } = piece.rec;
      this.tops.delete(key(cx, cz));
      drop(piece.rec.obj);
      add(BUILDABLE_BY_ID.roof.cost);
    } else {
      const { cx, cz, type } = piece.rec;
      spit(piece.rec);
      this.objs.delete(key(cx, cz));
      drop(piece.rec.obj);
      add(BUILDABLE_BY_ID[type].cost);
    }
    this.rebuildIndex();
    return refund;
  }

  /** A translucent copy of a piece, for the build preview. */
  makeGhost(id, t) {
    const gm = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true,
                                             opacity: 0.42, depthWrite: false });
    const g = BUILD[id](t, () => gm);
    g.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = false; });
    g.userData.ghostMat = gm;
    return g;
  }

  // ── collision ──────────────────────────────────────────────────────────────
  /** Push a circle of radius r (at world p: x, y=z) out of walls, railings and deck objects. */
  resolve(p, r) {
    const l = this.toLocal(p.x, p.y, this._l ||= { x: 0, z: 0 });
    const q = this._q2 ||= new THREE.Vector2();
    q.set(l.x, l.z);
    this.resolveLocal(q, r);
    const w = this.toWorld(q.x, q.y, this._w2 ||= { x: 0, z: 0 });
    p.set(w.x, w.z);
  }

  resolveLocal(p, r) {
    for (const b of this.blockers) {
      const qx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
      const qz = THREE.MathUtils.clamp(p.y, b.minZ, b.maxZ);
      const dx = p.x - qx, dz = p.y - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-7) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d);
        p.y += (dz / d) * (r - d);
      } else {
        const l = p.x - b.minX, rr = b.maxX - p.x, t = p.y - b.minZ, bb = b.maxZ - p.y;
        const m = Math.min(l, rr, t, bb);
        if (m === l) p.x = b.minX - r;
        else if (m === rr) p.x = b.maxX + r;
        else if (m === t) p.y = b.minZ - r;
        else p.y = b.maxZ + r;
      }
    }
  }

  /**
   * Nearest deck edge point to world (x, z) — for climbing back aboard. The
   * point is in the world; cx, cz the cell it is on.
   */
  nearestDeck(x, z, maxDist = 2.2) {
    const l = this.toLocal(x, z);
    let best = null, bestD = maxDist * maxDist;
    for (const c of this.cells.values()) {
      const px = THREE.MathUtils.clamp(l.x, c.cx * CELL - 0.85, c.cx * CELL + 0.85);
      const pz = THREE.MathUtils.clamp(l.z, c.cz * CELL - 0.85, c.cz * CELL + 0.85);
      const d = (l.x - px) ** 2 + (l.z - pz) ** 2;
      if (d < bestD) { bestD = d; best = { lx: px, lz: pz, cx: c.cx, cz: c.cz }; }
    }
    if (best) { const w = this.toWorld(best.lx, best.lz); best.x = w.x; best.z = w.z; }
    return best;
  }

  /** The middle of a cell, in the world. */
  cellWorld(cx, cz) { return this.toWorld(cx * CELL, cz * CELL); }

  // ── starting raft & save ───────────────────────────────────────────────────
  startingRaft() {
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const obj = BUILD.foundation({ cx, cz }, k => mats()[k]);
      this.group.add(obj);
      const rec = { cx, cz, obj };
      this.cells.set(key(cx, cz), rec);
      obj.traverse(m => { if (m.isMesh) m.userData.piece = { id: 'foundation', rec, kind: 'cell' }; });
    }
    this.rebuildIndex();
  }

  toJSON() {
    return {
      pose: [+this.x.toFixed(2), +this.z.toFixed(2), +this.heading.toFixed(4)],
      cells: [...this.cells.values()].map(c => [c.cx, c.cz]),
      edges: [...this.edges.values()].map(e => [e.ex, e.ez, e.es, e.type]),
      tops:  [...this.tops.values()].map(t => [t.cx, t.cz]),
      objs:  [...this.objs.values()].map(o => o.type === 'campfire'
        ? [o.cx, o.cz, o.type, 0, Math.round(o.fuel), o.lit ? 1 : 0]
        : o.type === 'sail' ? [o.cx, o.cz, o.type, 0, o.raised ? 1 : 0]
        : [o.cx, o.cz, o.type, +o.water.toFixed(2)]),
    };
  }

  // ── playing together ─────────────────────────────────────────────────────
  /** A deck object's changing state: [cx, cz, type, water, fuel, lit (a sail: raised), spit]. */
  objState(o) {
    return [o.cx, o.cz, o.type, +o.water.toFixed(2), Math.round(o.fuel), (o.type === 'sail' ? o.raised : o.lit) ? 1 : 0,
            (o.spitFish || []).map(f => [f.raw, +f.t.toFixed(1)])];
  }

  /**
   * Set a deck object's state from objState(). The fish on a spit are the
   * game's to hang (they are fish.js bodies): `spit(o, [[raw, t], …])`.
   */
  setObj(o, [, , , water, fuel, lit, fish], spit) {
    if (!o) return;
    if (o.type === 'collector') { o.water = Math.min(o.capacity, water || 0); this.refreshCollector(o); }
    if (o.type === 'sail') o.raised = !!lit;
    if (o.type === 'campfire') {
      const was = o.lit;
      o.fuel = fuel || 0;
      o.lit = !!lit && o.fuel > 0;
      if (was && !o.lit) this.wentOut.push(o);
      spit?.(o, fish || []);
    }
  }

  /** The whole raft, to send someone: what toJSON saves, with the fish on the fires. */
  snapshot() {
    const s = this.toJSON();
    s.pose = this.pose();
    s.objs = [...this.objs.values()].map(o => this.objState(o));
    return s;
  }

  /**
   * Make this raft the one in a snapshot, changing only what differs: pieces
   * it lacks go, pieces it has that this raft does not are built, and deck
   * objects take on its state. Returns whether anything was built or taken
   * away.
   */
  adopt(snap, spit) {
    const want = {
      cell: new Set((snap.cells || []).map(([cx, cz]) => key(cx, cz))),
      edge: new Map((snap.edges || []).map(e => [ekey(e[0], e[1], e[2]), e[3]])),
      top: new Set((snap.tops || []).map(([cx, cz]) => key(cx, cz))),
      object: new Map((snap.objs || []).map(o => [key(o[0], o[1]), o[2]])),
    };
    let changed = false;
    const take = (kind, rec) => {
      const piece = this.pieceAt(kind, ...(kind === 'edge' ? [rec.ex, rec.ez, rec.es] : [rec.cx, rec.cz]));
      if (piece) { this.removePiece(piece, true); changed = true; }
    };
    // What rests on the deck first, then the deck under it.
    for (const [k, o] of [...this.objs]) if (want.object.get(k) !== o.type) take('object', o);
    for (const [k, t] of [...this.tops]) if (!want.top.has(k)) take('top', t);
    for (const [k, e] of [...this.edges]) if (want.edge.get(k) !== e.type) take('edge', e);
    for (const [k, c] of [...this.cells]) if (!want.cell.has(k)) take('cell', c);

    for (const [cx, cz] of snap.cells || []) {
      if (!this.hasCell(cx, cz)) changed = this.place('foundation', { cx, cz, force: true }) || changed;
    }
    for (const [ex, ez, es, type] of snap.edges || []) {
      if (!this.edges.has(ekey(ex, ez, es))) changed = this.place(type, { ex, ez, es }) || changed;
    }
    for (const [cx, cz] of snap.tops || []) {
      if (!this.tops.has(key(cx, cz))) changed = this.place('roof', { cx, cz }) || changed;
    }
    for (const st of snap.objs || []) {
      const [cx, cz, type] = st;
      if (!this.objs.has(key(cx, cz))) changed = this.place(type, { cx, cz }) || changed;
      this.setObj(this.objs.get(key(cx, cz)), st, spit);
    }
    return changed;
  }

  /** Everything off the deck, back to nothing — before loading a raft over it. */
  clear() {
    this.setPose([0, 0, 0]);
    for (const m of [this.objs, this.tops, this.edges, this.cells]) {
      for (const r of m.values()) this.group.remove(r.obj);
      m.clear();
    }
    this.rebuildIndex();
  }

  load(data) {
    // Where it was left: before anything asks where its deck is.
    if (Array.isArray(data.pose)) this.setPose(data.pose);
    for (const [cx, cz] of data.cells || []) this.place('foundation', { cx, cz, force: true });
    for (const [ex, ez, es, type] of data.edges || []) this.place(type, { ex, ez, es });
    for (const [cx, cz] of data.tops || []) this.place('roof', { cx, cz });
    for (const [cx, cz, type, water, fuel, lit] of data.objs || []) {
      this.place(type, { cx, cz });
      const o = this.objs.get(key(cx, cz));
      if (o && water) { o.water = water; this.refreshCollector(o); }
      if (o?.type === 'sail') o.raised = !!fuel;
      if (o?.type === 'campfire') {
        // A save from before fires had to be lit: those were burning, and
        // stay burning, with a full load of wood.
        if (fuel === undefined) { o.fuel = FIRE.max; o.lit = true; }
        else { o.fuel = fuel; o.lit = !!lit && fuel > 0; }
      }
    }
    // An old save always had a raft; a new one with none has none yet (a
    // castaway washed up on a beach, say) and should keep having none.
    if (!this.cells.size && !Array.isArray(data.pose)) this.startingRaft();
  }
}

