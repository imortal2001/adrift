// ── The continent ────────────────────────────────────────────────────────────
// A landmass big enough to get lost in, streamed as chunks around whoever is
// looking at it. Like the ocean, the shape is one pure function — `heightAt` —
// so the mesh, the player, the trees and every animal stand on the same
// ground by construction.
//
// Chunks near the viewer are built at fine resolution and coarser further out,
// with a skirt around each one to hide the seams between detail levels.

import * as THREE from 'three';

export const WORLD = {
  cx: 330, cz: -240,     // continent centre; its coast passes ~58m from the raft
  radius: 350,           // nominal distance from centre to shoreline
  shoreWobble: 95,       // how far the coastline wanders from that circle
};

export const CHUNK = 64;
const VIEW_CHUNKS = 7;                     // ~450m of terrain around the viewer
const LOD_SEGMENTS = [64, 32, 16, 8, 8];   // by chunk-distance band
const TREE_LOD = 2;                        // chunks beyond this get no trees
const BUILD_BUDGET = 2;                    // chunks per frame, to avoid hitches

// ── noise ────────────────────────────────────────────────────────────────────
function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x, z, octaves) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ── shape ────────────────────────────────────────────────────────────────────
/** Metres inland from the coast. Negative is sea. */
export function coastDistance(x, z) {
  const d = Math.hypot(x - WORLD.cx, z - WORLD.cz);
  const wobble = (fbm(x * 0.0032, z * 0.0032, 4) - 0.5) * WORLD.shoreWobble;
  return (WORLD.radius + wobble) - d;
}

export function heightAt(x, z) {
  const m = coastDistance(x, z);
  if (m < -140) return -26;

  let h = m < 0 ? Math.max(-26, m * 0.40) : 0;
  h += smooth(0, 34, m) * 8;                                              // coastal plain
  h += smooth(12, 170, m) * (fbm(x * 0.0055, z * 0.0055, 4) - 0.42) * 88; // rolling hills

  // Ridged noise deep inland gives a mountain spine rather than lumps.
  const inland = smooth(150, 430, m);
  if (inland > 0) {
    const ridge = 1 - Math.abs(fbm(x * 0.0031, z * 0.0031, 5) * 2 - 1);
    h += inland * Math.pow(ridge, 1.6) * 170;
  }

  h += smooth(-10, 18, m) * (fbm(x * 0.027, z * 0.027, 3) - 0.5) * 8;     // undulation
  h += smooth(-6, 12, m) * (fbm(x * 0.11, z * 0.11, 2) - 0.5) * 1.6;      // surface detail
  return h;
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.8;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e,
                 heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

export function slopeAt(x, z) { return 1 - normalAt(x, z).y; }

/** 0 dry, 1 lush. Drives forest density and ground colour. */
export function moistureAt(x, z) {
  return fbm(x * 0.0042 + 91, z * 0.0042 - 57, 3);
}

export const WADE = -0.55;
export function isLand(x, z) { return heightAt(x, z) > WADE; }

// ── ground colour ────────────────────────────────────────────────────────────
const C = {
  wet:   new THREE.Color(0x9c8a63),
  sand:  new THREE.Color(0xd8c79b),
  lush:  new THREE.Color(0x3f6b2c),
  grass: new THREE.Color(0x587a37),
  dry:   new THREE.Color(0x7d8144),
  soil:  new THREE.Color(0x4a3a28),
  rock:  new THREE.Color(0x6e6962),
  scree: new THREE.Color(0x8b857b),
  snow:  new THREE.Color(0xe8ecef),
};

function groundColour(h, slope, wet, jitter, out) {
  if (h < 0.4) return out.copy(C.wet).lerp(C.sand, smooth(-1.5, 0.4, h));
  if (h < 2.8) return out.copy(C.sand);

  if (h > 118) {                                   // snowline, bare on steep faces
    return out.copy(C.snow).lerp(C.rock, smooth(0.45, 0.75, slope));
  }
  if (h > 82) {
    out.copy(C.rock).lerp(C.scree, jitter * 0.6);
    return out.lerp(C.grass, smooth(96, 78, h) * 0.5);
  }

  out.copy(C.grass).lerp(C.lush, wet).lerp(C.dry, (1 - wet) * 0.75);
  out.lerp(C.sand, smooth(4.6, 2.8, h) * 0.8);     // sand creeps up the beach
  if (slope > 0.32) out.lerp(C.soil, smooth(0.32, 0.6, slope));   // bare earth on banks
  if (slope > 0.55) out.lerp(C.rock, smooth(0.55, 0.8, slope));
  return out.multiplyScalar(0.92 + jitter * 0.16);
}

// ── geometry helpers ─────────────────────────────────────────────────────────
/** Minimal merge so a whole tree is a single instanced draw. */
function mergeParts(parts) {
  let vCount = 0, iCount = 0;
  for (const { geo } of parts) {
    vCount += geo.attributes.position.count;
    iCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;

  for (const { geo, color } of parts) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nrm[(vo + i) * 3] = n.getX(i);
      nrm[(vo + i) * 3 + 1] = n.getY(i);
      nrm[(vo + i) * 3 + 2] = n.getZ(i);
      col[(vo + i) * 3] = color.r;
      col[(vo + i) * 3 + 1] = color.g;
      col[(vo + i) * 3 + 2] = color.b;
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) idx[io + i] = geo.index.getX(i) + vo;
      io += geo.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ── species ──────────────────────────────────────────────────────────────────
// Tall conifers, not palms: this is a cold-blooded, deep-time forest.
function redwood() {
  const trunk = new THREE.CylinderGeometry(0.55, 1.25, 30, 8);
  trunk.translate(0, 15, 0);
  const parts = [{ geo: trunk, color: new THREE.Color(0x5a3b28) }];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const c = new THREE.ConeGeometry(6.4 - t * 4.2, 9 - t * 3, 8);
    c.translate(0, 18 + i * 4.2, 0);
    parts.push({ geo: c, color: new THREE.Color(0x24451f).lerp(new THREE.Color(0x3a6b33), t * 0.45) });
  }
  return mergeParts(parts);
}

function conifer() {
  const trunk = new THREE.CylinderGeometry(0.28, 0.6, 15, 7);
  trunk.translate(0, 7.5, 0);
  const parts = [{ geo: trunk, color: new THREE.Color(0x4f3722) }];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const c = new THREE.ConeGeometry(3.6 - t * 2.3, 6.5 - t * 2, 7);
    c.translate(0, 8 + i * 3.1, 0);
    parts.push({ geo: c, color: new THREE.Color(0x2c5226).lerp(new THREE.Color(0x4a7a3a), t * 0.5) });
  }
  return mergeParts(parts);
}

/** Cycad-ish undergrowth, so the forest floor is not bare. */
function cycad() {
  const parts = [{ geo: (() => {
    const g = new THREE.CylinderGeometry(0.22, 0.3, 1.1, 6);
    g.translate(0, 0.55, 0);
    return g;
  })(), color: new THREE.Color(0x5b4a2e) }];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const f = new THREE.ConeGeometry(0.26, 2.5, 4);
    f.rotateZ(0.95);
    f.rotateY(a);
    f.translate(Math.cos(a) * 0.9, 1.4, Math.sin(a) * 0.9);
    parts.push({ geo: f, color: new THREE.Color(0x35692c) });
  }
  return mergeParts(parts);
}

const FLORA = [
  { name: 'redwood', label: 'Redwood', make: redwood, minH: 6, maxH: 78, maxSlope: 0.38,
    wet: 0.52, weight: 0.30, scale: [0.8, 1.35], reach: 4.5, regrow: 180, yield: { wood: 6 } },
  { name: 'conifer', label: 'Conifer', make: conifer, minH: 3, maxH: 96, maxSlope: 0.46,
    wet: 0.30, weight: 0.45, scale: [0.7, 1.3], reach: 3.6, regrow: 140, yield: { wood: 3 } },
  { name: 'cycad', label: 'Cycad', make: cycad, minH: 2, maxH: 60, maxSlope: 0.5,
    wet: 0.38, weight: 1.00, scale: [0.8, 1.8], reach: 2.6, regrow: 90, yield: { leaf: 3 } },
];

let FLORA_GEO = null;
function floraGeometry() {
  if (!FLORA_GEO) FLORA_GEO = FLORA.map(f => f.make());
  return FLORA_GEO;
}

// ── chunks ───────────────────────────────────────────────────────────────────
const chunkKey = (i, j) => `${i},${j}`;

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.queue = [];
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0,
    });
    this.floraMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true,
    });
    this._c = new THREE.Color();
    this._dummy = new THREE.Object3D();
  }

  heightAt(x, z) { return heightAt(x, z); }
  isLand(x, z) { return isLand(x, z); }

  lodFor(dist) { return LOD_SEGMENTS[Math.min(dist, LOD_SEGMENTS.length - 1)]; }

  /** Keep the chunks around `focus` loaded at the right detail. */
  update(dt, focus) {
    const pi = Math.round(focus.x / CHUNK), pj = Math.round(focus.z / CHUNK);
    const wanted = new Set();

    for (let di = -VIEW_CHUNKS; di <= VIEW_CHUNKS; di++) {
      for (let dj = -VIEW_CHUNKS; dj <= VIEW_CHUNKS; dj++) {
        const ring = Math.max(Math.abs(di), Math.abs(dj));
        if (ring > VIEW_CHUNKS) continue;
        const i = pi + di, j = pj + dj;
        // Skip chunks that are entirely open ocean.
        if (coastDistance(i * CHUNK, j * CHUNK) < -(CHUNK + 90)) continue;
        const key = chunkKey(i, j);
        wanted.add(key);
        const segs = this.lodFor(ring);
        const existing = this.chunks.get(key);
        if (!existing) this.queue.push({ i, j, segs, ring });
        else if (existing.segs !== segs) { existing.segs = segs; existing.stale = true; this.queue.push({ i, j, segs, ring }); }
      }
    }

    // Drop anything that has fallen out of range.
    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) { this.disposeChunk(c); this.chunks.delete(key); }
    }

    this.regrow(dt);

    // Build a couple per frame so walking never stutters.
    let built = 0;
    while (this.queue.length && built < BUILD_BUDGET) {
      const job = this.queue.shift();
      const key = chunkKey(job.i, job.j);
      if (!wanted.has(key)) continue;
      const old = this.chunks.get(key);
      if (old && !old.stale) continue;
      if (old) { this.disposeChunk(old); }
      this.chunks.set(key, this.buildChunk(job));
      built++;
    }
  }

  disposeChunk(c) {
    this.scene.remove(c.group);
    c.group.traverse(o => { if (o.isMesh && o.geometry !== FLORA_GEO) o.geometry?.dispose?.(); });
  }

  buildChunk({ i, j, segs, ring }) {
    const group = new THREE.Group();
    const ox = i * CHUNK, oz = j * CHUNK;

    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.translate(ox, 0, oz);

    const pos = geo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const h = heightAt(x, z);
      pos.setY(v, h);
      groundColour(h, slopeAt(x, z), moistureAt(x, z), noise2(x * 0.35, z * 0.35), this._c);
      colours[v * 3] = this._c.r;
      colours[v * 3 + 1] = this._c.g;
      colours[v * 3 + 2] = this._c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    if (ring <= 1) mesh.castShadow = true;
    group.add(mesh);

    this._plants = null;
    const trees = ring <= TREE_LOD ? this.buildFlora(i, j, group) : 0;

    this.scene.add(group);
    return { i, j, segs, group, trees, plants: this._plants, stale: false };
  }

  /** Deterministic scatter, so a chunk looks the same every time it loads. */
  buildFlora(i, j, group) {
    const geos = floraGeometry();
    const slots = FLORA.map(() => []);
    const ox = i * CHUNK, oz = j * CHUNK;
    const samples = 150;

    for (let s = 0; s < samples; s++) {
      const rx = hash(i * 7919 + s, j * 104729);
      const rz = hash(i * 104729, j * 7919 + s);
      const x = ox - CHUNK / 2 + rx * CHUNK;
      const z = oz - CHUNK / 2 + rz * CHUNK;
      const h = heightAt(x, z);
      if (h < 2) continue;
      const slope = slopeAt(x, z);
      const wet = moistureAt(x, z);

      for (let f = 0; f < FLORA.length; f++) {
        const sp = FLORA[f];
        if (h < sp.minH || h > sp.maxH || slope > sp.maxSlope || wet < sp.wet) continue;
        if (hash(s * 31 + f, i * 13 + j) > sp.weight * (0.35 + wet)) continue;
        slots[f].push({ x, z, y: h, s });
        break;
      }
    }

    let total = 0;
    const plants = [];
    for (let f = 0; f < FLORA.length; f++) {
      const list = slots[f];
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(geos[f], this.floraMaterial, list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      const d = this._dummy;
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        const sc = THREE.MathUtils.lerp(FLORA[f].scale[0], FLORA[f].scale[1], hash(t.s, f * 17));
        d.position.set(t.x, t.y - 0.2, t.z);
        d.rotation.set(0, hash(t.s, f * 29) * Math.PI * 2, 0);
        d.scale.setScalar(sc);
        d.updateMatrix();
        inst.setMatrixAt(k, d.matrix);
        // Keep the transform so a felled plant can be put back.
        plants.push({ sp: FLORA[f], inst, index: k, matrix: d.matrix.clone(),
                      x: t.x, y: t.y, z: t.z, taken: 0 });
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
      total += list.length;
    }
    this._plants = plants;
    return total;
  }

  // ── harvesting ─────────────────────────────────────────────────────────────
  /** The plant under the crosshair, if it is close enough to reach. */
  pickPlant(origin, dir) {
    let best = null, bestScore = -Infinity;
    for (const c of this.chunks.values()) {
      if (!c.plants) continue;
      for (const p of c.plants) {
        if (p.taken > 0) continue;
        const dx = p.x - origin.x, dy = (p.y + 1.2) - origin.y, dz = p.z - origin.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > p.sp.reach) continue;
        const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
        if (dot < 0.25) continue;
        const score = dot * 2 - d / p.sp.reach;
        if (score > bestScore) { bestScore = score; best = p; }
      }
    }
    return best;
  }

  /** Fell a plant: hide that one instance and let it grow back later. */
  harvest(p) {
    p.taken = p.sp.regrow;
    this._dummy.position.set(p.x, p.y - 400, p.z);   // park it out of sight
    this._dummy.rotation.set(0, 0, 0);
    this._dummy.scale.setScalar(0.0001);
    this._dummy.updateMatrix();
    p.inst.setMatrixAt(p.index, this._dummy.matrix);
    p.inst.instanceMatrix.needsUpdate = true;
    return { label: p.sp.label, yield: p.sp.yield };
  }

  regrow(dt) {
    for (const c of this.chunks.values()) {
      if (!c.plants) continue;
      for (const p of c.plants) {
        if (p.taken <= 0) continue;
        p.taken -= dt;
        if (p.taken <= 0) {
          p.inst.setMatrixAt(p.index, p.matrix);
          p.inst.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  get loadedChunks() { return this.chunks.size; }
  get treeCount() {
    let n = 0;
    for (const c of this.chunks.values()) n += c.trees;
    return n;
  }
}
