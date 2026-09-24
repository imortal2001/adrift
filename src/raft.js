// ── The raft ─────────────────────────────────────────────────────────────────
// A grid of 2m cells that floats on the shared wave field. Cells carry edges
// (walls / railings), a roof slot and one object slot each. The raft tilts and
// heaves but never yaws, which keeps "where am I standing" cheap and stable:
// horizontal position is shared with world space, only height goes through the
// transform.

import * as THREE from 'three';
import { waveHeight, waveNormal } from './ocean.js';
import { textures } from './textures.js';
import { BUILDABLE_BY_ID, FIRE } from './items.js';
import { buildCampfire, updateFire, tickFire } from './fire.js';

export const CELL = 2;
export const DECK_Y = 0;        // walkable surface, in raft-local space
export const WALL_H = 2.2;
export const ROOF_Y = 2.34;
export const MAX_CELLS = 120;

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
  }

  // ── layout queries ─────────────────────────────────────────────────────────
  cellAtWorld(x, z) { return [Math.round(x / CELL), Math.round(z / CELL)]; }
  hasCell(cx, cz) { return this.cells.has(key(cx, cz)); }
  solidAtWorld(x, z) { const [a, b] = this.cellAtWorld(x, z); return this.hasCell(a, b); }
  get size() { return this.cells.size; }

  /** World-space height of the deck under (x,z), accounting for heave and tilt. */
  deckY(x, z) {
    return this.group.localToWorld(this._v.set(x, DECK_Y, z)).y;
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
    // Heave from the mean height under the hull, so a bigger raft rides flatter.
    let ex = CELL, ez = CELL;
    for (const c of this.cells.values()) {
      ex = Math.max(ex, Math.abs(c.cx * CELL) + 1);
      ez = Math.max(ez, Math.abs(c.cz * CELL) + 1);
    }
    const h = (waveHeight(-ex, -ez, time) + waveHeight(ex, -ez, time) +
               waveHeight(-ex, ez, time) + waveHeight(ex, ez, time) +
               waveHeight(0, 0, time) * 2) / 6;
    this.group.position.set(0, h + 0.32, 0);

    // Tilt with the swell, damped as the raft grows.
    const damp = this.tilt * THREE.MathUtils.clamp(9 / (6 + this.cells.size), 0.22, 1);
    waveNormal(0, 0, time, this._n);
    this._v.set(this._n.x * damp, 1, this._n.z * damp).normalize();
    this.group.quaternion.setFromUnitVectors(UP, this._v);
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
              fuel: id === 'campfire' ? FIRE.laid : 0, lit: false, spitFish: [] };
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
      const x = o.cx * CELL, z = o.cz * CELL, r = o.type === 'campfire' ? 0.62 : 0.58;
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
   * Remove the piece a mesh belongs to. Returns a cost map to refund, or null.
   * Taking out a foundation also takes out whatever was resting on it.
   */
  removePiece(piece) {
    const refund = {};
    const add = cost => { for (const k in cost) refund[k] = (refund[k] || 0) + cost[k]; };
    const drop = obj => this.group.remove(obj);   // geometry/material are shared caches
    // Fish on a campfire's spit come back with it — cooked if they were done.
    const spit = o => { for (const f of o?.spitFish || []) add({ [f.t >= FIRE.cook ? f.done : f.raw]: 1 }); };

    if (piece.kind === 'cell') {
      const { cx, cz } = piece.rec;
      if (!this.cellRemovable(cx, cz)) return null;

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
  /** Push a circle of radius r out of walls, railings and deck objects. */
  resolve(p, r) {
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

  /** Nearest deck edge point to (x,z) — used for climbing back aboard. */
  nearestDeck(x, z, maxDist = 2.2) {
    let best = null, bestD = maxDist * maxDist;
    for (const c of this.cells.values()) {
      const px = THREE.MathUtils.clamp(x, c.cx * CELL - 0.85, c.cx * CELL + 0.85);
      const pz = THREE.MathUtils.clamp(z, c.cz * CELL - 0.85, c.cz * CELL + 0.85);
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < bestD) { bestD = d; best = { x: px, z: pz, cx: c.cx, cz: c.cz }; }
    }
    return best;
  }

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
      cells: [...this.cells.values()].map(c => [c.cx, c.cz]),
      edges: [...this.edges.values()].map(e => [e.ex, e.ez, e.es, e.type]),
      tops:  [...this.tops.values()].map(t => [t.cx, t.cz]),
      objs:  [...this.objs.values()].map(o => o.type === 'campfire'
        ? [o.cx, o.cz, o.type, 0, Math.round(o.fuel), o.lit ? 1 : 0]
        : [o.cx, o.cz, o.type, +o.water.toFixed(2)]),
    };
  }

  load(data) {
    for (const [cx, cz] of data.cells || []) this.place('foundation', { cx, cz, force: true });
    for (const [ex, ez, es, type] of data.edges || []) this.place(type, { ex, ez, es });
    for (const [cx, cz] of data.tops || []) this.place('roof', { cx, cz });
    for (const [cx, cz, type, water, fuel, lit] of data.objs || []) {
      this.place(type, { cx, cz });
      const o = this.objs.get(key(cx, cz));
      if (o && water) { o.water = water; this.refreshCollector(o); }
      if (o?.type === 'campfire') {
        // A save from before fires had to be lit: those were burning, and
        // stay burning, with a full load of wood.
        if (fuel === undefined) { o.fuel = FIRE.max; o.lit = true; }
        else { o.fuel = fuel; o.lit = !!lit && fuel > 0; }
      }
    }
    if (!this.cells.size) this.startingRaft();
  }
}

