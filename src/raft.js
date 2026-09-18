// ── The raft ─────────────────────────────────────────────────────────────────
// A grid of 2m cells that floats on the shared wave field. Cells carry edges
// (walls / railings), a roof slot and one object slot each. The raft tilts and
// heaves but never yaws, which keeps "where am I standing" cheap and stable:
// horizontal position is shared with world space, only height goes through the
// transform.

import * as THREE from 'three';
import { waveHeight, waveNormal } from './ocean.js';
import { textures } from './textures.js';
import { BUILDABLE_BY_ID } from './items.js';

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
    water: std(null, { color: 0x2f9fd0, roughness: 0.15, metalness: 0.1,
                       transparent: true, opacity: 0.85 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff8a26, transparent: true,
                                         opacity: 0.34, blending: THREE.AdditiveBlending,
                                         depthWrite: false, side: THREE.DoubleSide }),
    core:  new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true,
                                         opacity: 0.55, blending: THREE.AdditiveBlending,
                                         depthWrite: false, side: THREE.DoubleSide }),
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
    const g = new THREE.Group();
    const x = t.cx * CELL, z = t.cz * CELL;
    const stoneG = geo('stone', () => new THREE.IcosahedronGeometry(0.17, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = mesh(stoneG, M('stone'), x + Math.cos(a) * 0.5, 0.07, z + Math.sin(a) * 0.5);
      s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      s.scale.setScalar(0.75 + Math.random() * 0.5);
      g.add(s);
    }
    const logG = geo('firelog', () => {
      const c = new THREE.CylinderGeometry(0.075, 0.075, 0.8, 8);
      c.rotateZ(Math.PI / 2);
      return c;
    });
    for (let i = 0; i < 3; i++) {
      const l = mesh(logG, M('log'), x, 0.14, z);
      l.rotation.y = (i / 3) * Math.PI;
      l.rotation.z = 0.12;
      g.add(l);
    }
    // Layered translucent cones plus a glow sprite: a single opaque cone just
    // reads as a yellow triangle sitting on the deck.
    const flame = new THREE.Group();
    flame.name = 'flame';
    flame.position.set(x, 0.2, z);
    const cone = (n, r, h, seg, m) =>
      new THREE.Mesh(geo(n, () => new THREE.ConeGeometry(r, h, seg, 1, true)), M(m));
    const outer = cone('flameO', 0.30, 0.86, 8, 'flame'); outer.position.y = 0.43;
    const mid   = cone('flameM', 0.20, 0.60, 7, 'flame'); mid.position.y = 0.30;
    const core  = cone('flameC', 0.115, 0.36, 6, 'core'); core.position.y = 0.18;
    flame.add(outer, mid, core);
    const glow = new THREE.Sprite(M('glow'));
    glow.scale.setScalar(2.6);
    glow.position.y = 0.4;
    flame.add(glow);
    g.add(flame);
    const light = new THREE.PointLight(0xff9b3d, 6, 16, 2);
    light.position.set(x, 0.85, z);
    light.name = 'firelight';
    g.add(light);
    return g;
  },
};

export class Raft {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.cells = new Map();   // "cx,cz"   -> { cx, cz, obj }
    this.edges = new Map();   // "cx,cz,s" -> { ex, ez, es, type, obj }
    this.tops  = new Map();   // "cx,cz"   -> { cx, cz, obj }
    this.objs  = new Map();   // "cx,cz"   -> { cx, cz, type, obj, water }
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
    for (const o of this.objs.values()) {
      if (o.type === 'campfire') {
        const f = o.obj.getObjectByName('flame');
        const l = o.obj.getObjectByName('firelight');
        const w = 0.86 + Math.sin(time * 9 + o.cx) * 0.09 + Math.sin(time * 15.7 + o.cz) * 0.06;
        if (f) {
          f.scale.set(w, 0.9 + (w - 0.86) * 2.4, w);
          f.rotation.y = time * 0.8 + o.cx;
          const glow = f.children[3];
          if (glow) glow.scale.setScalar(2.4 + (w - 0.86) * 4);
        }
        if (l) l.intensity = (1.6 + w * 1.6) + (3.4 + w * 1.2) * night;
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
              rate: id === 'collector' ? 0.085 : 0 };
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

    if (piece.kind === 'cell') {
      const { cx, cz } = piece.rec;
      if (!this.cellRemovable(cx, cz)) return null;

      const top = this.tops.get(key(cx, cz));
      if (top) { drop(top.obj); this.tops.delete(key(cx, cz)); add(BUILDABLE_BY_ID.roof.cost); }
      const o = this.objs.get(key(cx, cz));
      if (o) { drop(o.obj); this.objs.delete(key(cx, cz)); add(BUILDABLE_BY_ID[o.type].cost); }

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
      objs:  [...this.objs.values()].map(o => [o.cx, o.cz, o.type, +o.water.toFixed(2)]),
    };
  }

  load(data) {
    for (const [cx, cz] of data.cells || []) this.place('foundation', { cx, cz, force: true });
    for (const [ex, ez, es, type] of data.edges || []) this.place(type, { ex, ez, es });
    for (const [cx, cz] of data.tops || []) this.place('roof', { cx, cz });
    for (const [cx, cz, type, water] of data.objs || []) {
      this.place(type, { cx, cz });
      const o = this.objs.get(key(cx, cz));
      if (o && water) { o.water = water; this.refreshCollector(o); }
    }
    if (!this.cells.size) this.startingRaft();
  }
}

