// ── The continent ────────────────────────────────────────────────────────────
// A landmass big enough to get lost in, streamed as chunks around whoever is
// looking at it. Like the ocean, the shape is one pure function — `heightAt` —
// so the mesh, the player, the trees and every animal stand on the same
// ground by construction.
//
// Chunks near the viewer are built at fine resolution and coarser further out,
// with a skirt around each one to hide the seams between detail levels.

import * as THREE from 'three';
import { mergeParts } from './meshkit.js';
import { REEF, reefGeometry, reefMaterial, setReefTime } from './reef.js';
import { applyCaustics } from './underwater.js';

export const WORLD = {
  cx: 330, cz: -240,     // continent centre; nearest shoreline is ~80m from the
                         // raft — but see the note on coastDistance below
  radius: 350,           // nominal distance from centre to shoreline
  shoreWobble: 95,       // how far the coastline wanders from that circle
};

export const CHUNK = 64;
const VIEW_CHUNKS = 7;                     // ~450m of terrain around the viewer
const LOD_SEGMENTS = [64, 32, 16, 8, 8];   // by chunk-distance band
const TREE_LOD = 2;                        // chunks beyond this get no trees
const REEF_LOD = 1;                        // and beyond this, no reef — you cannot
                                           // see 60m through water anyway
const REEF_CELL = 1.5;                     // obstacle-field resolution, metres
const SOLID_CELL = 4.0;                    // bucket size for player-vs-prop collision
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
/**
 * Metres inland from the coast. Negative is sea.
 *
 * This is the *radial* distance — measured along the ray out from the
 * continent's centre — not the distance to the nearest land. Because the
 * shoreline wobbles by up to `shoreWobble`, the two differ a lot: at the raft
 * this reads -105, while the nearest beach is only about 80m away, off to one
 * side. Size sea-bed features against this number and swim distances against
 * the real one.
 */
export function coastDistance(x, z) {
  const d = Math.hypot(x - WORLD.cx, z - WORLD.cz);
  const wobble = (fbm(x * 0.0032, z * 0.0032, 4) - 0.5) * WORLD.shoreWobble;
  return (WORLD.radius + wobble) - d;
}

// ── the sea bed ──────────────────────────────────────────────────────────────
// The floor under the raft used to be a flat pan at -26, which is why diving
// felt like swimming in an empty room. It is now a reef shelf: sand at about
// 18m with coral heads standing up off it, falling away into a basin past the
// shelf edge.
//
// The depths are chosen against the air supply, not for looks. You have ~18
// seconds down there and you descend at 2.4 m/s, so the coral tops at ~10m are
// a comfortable visit, the sand at ~18m is a real commitment, and the basin is
// deliberately below MAX_DEPTH — deep water should stay out of reach.
//
// The shelf edge is set past the raft's own station (coastDistance reads -105
// there — the radial measure, not the ~80m swim to the nearest beach), so that
// the water you can reach from the deck is reef and the drop-off is something
// you have to swim out to find.

export const SHELF_FLOOR = -18;   // sand between the coral heads
const BASIN = -42;                // past the drop-off; deeper than one breath
const SHELF_EDGE = 152;           // metres out from the coast where the shelf ends
const ABYSS = 292;                // by here you are over open basin
const REEF_HEIGHT = 8.0;          // how far the tallest coral heads stand proud

/**
 * Where coral grows, 0..1. Reef needs light and something to hold onto, so it
 * covers the shelf in colonies and stops at the drop-off. Exported because the
 * props and the fish both want to know where the reef is without re-deriving it.
 *
 * @param out  metres out to sea from the coast (= -coastDistance)
 */
export function reefMask(x, z, out) {
  const band = smooth(8, 34, out) * smooth(SHELF_EDGE + 20, SHELF_EDGE - 50, out);
  if (band < 0.001) return 0;
  // Colony size and spacing. The first cut used a much lower frequency, which
  // gave colonies 150m across with gaps to match — so whether diving off the
  // raft found you coral or a sand flat was pure luck of where the raft sat.
  // Smaller, more numerous colonies mean there is reef within a short swim of
  // anywhere on the shelf, with clear sand still between them.
  const patch = smooth(0.34, 0.63, fbm(x * 0.0125 + 140, z * 0.0125 - 88, 3));
  return band * patch;
}

/** Sea floor height. `out` is metres out to sea, so it is >= 0 here. */
function seabedAt(x, z, out) {
  // Beach shelves into the shallows, flattens onto the shelf, then drops away.
  let h = SHELF_FLOOR * smooth(0, 46, out);
  h += (BASIN - h) * smooth(SHELF_EDGE, ABYSS, out);

  // Coral heads. Ridged noise builds mounds with saddles between them rather
  // than the lumps plain fbm gives, which is the difference between a reef and
  // a bumpy carpet.
  const reef = reefMask(x, z, out);
  if (reef > 0.001) {
    const ridge = 1 - Math.abs(fbm(x * 0.019, z * 0.019, 4) * 2 - 1);
    h += reef * Math.pow(ridge, 2.4) * REEF_HEIGHT;
  }

  h += smooth(4, 44, out) * (fbm(x * 0.012, z * 0.012, 3) - 0.5) * 3.2;  // sand dunes
  h += (fbm(x * 0.13, z * 0.13, 2) - 0.5) * 0.5;                         // ripples
  return h;
}

export function heightAt(x, z) {
  const m = coastDistance(x, z);

  // One surface, two halves: sea bed below the waterline, land above it.
  let h;
  if (m < 0) {
    h = seabedAt(x, z, -m);
  } else {
    h = smooth(0, 34, m) * 8;                                               // coastal plain
    h += smooth(12, 170, m) * (fbm(x * 0.0055, z * 0.0055, 4) - 0.42) * 88; // rolling hills

    // Ridged noise deep inland gives a mountain spine rather than lumps.
    const inland = smooth(150, 430, m);
    if (inland > 0) {
      const ridge = 1 - Math.abs(fbm(x * 0.0031, z * 0.0031, 5) * 2 - 1);
      h += inland * Math.pow(ridge, 1.6) * 170;
    }
  }

  // Surf-zone detail straddles the waterline, so beach and shallows are one
  // continuous surface rather than two that meet at a seam.
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
  // Sea bed. The fog and the attenuated sun already drain these on the way to
  // the eye, so the albedo stays sandy all the way down — baking the grey in
  // as well is what made the first cut of this look like wet concrete.
  shoal: new THREE.Color(0xd6c29c),   // sand just under the waterline
  bed:   new THREE.Color(0xc0ac83),   // the shelf floor
  deepbed: new THREE.Color(0x96906d), // where the light is going
  silt:  new THREE.Color(0x4a5560),   // the basin
  coral: new THREE.Color(0xb2634c),   // warm reef rock
  coralB:new THREE.Color(0x7d6494),   // and the cool half of the colony
  algae: new THREE.Color(0x4a6b4c),
  lush:  new THREE.Color(0x3f6b2c),
  grass: new THREE.Color(0x587a37),
  dry:   new THREE.Color(0x7d8144),
  soil:  new THREE.Color(0x4a3a28),
  rock:  new THREE.Color(0x6e6962),
  scree: new THREE.Color(0x8b857b),
  snow:  new THREE.Color(0xe8ecef),
};

function groundColour(h, slope, wet, jitter, out) {
  if (h < 0.4) {
    // Sea bed. Depth does most of the work — sand greys out as the red goes,
    // and the basin ends up silt. Colour lives on whatever stands proud of the
    // sand, because on a real reef that is where the coral is.
    out.copy(C.wet).lerp(C.shoal, smooth(-1.5, -3.5, h));
    out.lerp(C.bed, smooth(-4, -10, h));
    out.lerp(C.deepbed, smooth(-11, -19, h));
    out.lerp(C.silt, smooth(-22, -36, h));

    if (slope > 0.2 && h > -20) {
      const rock = smooth(0.2, 0.55, slope) * smooth(-20, -9, h);
      out.lerp(jitter > 0.5 ? C.coral : C.coralB, rock * 0.6);
      out.lerp(C.algae, rock * 0.25 * jitter);
    }
    return out.multiplyScalar(0.88 + jitter * 0.24);
  }
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

// One integer per cell of the reef obstacle field, so looking one up costs no
// string allocation. The world is ±450m of loaded chunks, nowhere near the
// range this packs into.
const reefCell = (i, j) => (i + 32768) * 65536 + (j + 32768);
const solidCell = (i, j) => (i + 8192) * 16384 + (j + 8192);

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.queue = [];
    // The sea bed and the land are one material; the caustics injection gates
    // itself on being below the waterline, so the beach stays dry-looking.
    this.material = applyCaustics(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0,
    }));
    this.floraMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true,
    });
    this.reefMaterial = reefMaterial();
    this._c = new THREE.Color();
    this._dummy = new THREE.Object3D();
    // Highest prop standing at each cell of the sea bed; see clearanceAt().
    this.reefTops = new Map();
    // Solid props bucketed by the cell their axis sits in; see collideReef().
    this.reefSolids = new Map();
    this.reefDirty = false;
  }

  heightAt(x, z) { return heightAt(x, z); }
  isLand(x, z) { return isLand(x, z); }

  lodFor(dist) { return LOD_SEGMENTS[Math.min(dist, LOD_SEGMENTS.length - 1)]; }

  /** Keep the chunks around `focus` loaded at the right detail. */
  update(dt, focus, time = 0) {
    setReefTime(time);
    const pi = Math.round(focus.x / CHUNK), pj = Math.round(focus.z / CHUNK);
    const wanted = new Set();

    for (let di = -VIEW_CHUNKS; di <= VIEW_CHUNKS; di++) {
      for (let dj = -VIEW_CHUNKS; dj <= VIEW_CHUNKS; dj++) {
        const ring = Math.max(Math.abs(di), Math.abs(dj));
        if (ring > VIEW_CHUNKS) continue;
        const i = pi + di, j = pj + dj;
        // Skip chunks that are entirely open basin. The cutoff sits past the
        // shelf edge so the drop-off gets built and the shelf does not simply
        // stop in mid-water.
        if (coastDistance(i * CHUNK, j * CHUNK) < -(CHUNK + 240)) continue;
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
      if (!wanted.has(key)) {
        if (c.reefProps) this.reefDirty = true;
        this.disposeChunk(c);
        this.chunks.delete(key);
      }
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

    if (this.reefDirty) this.rebuildReefField();
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
    this._reefProps = null;
    const trees = ring <= TREE_LOD ? this.buildFlora(i, j, group) : 0;
    const coral = ring <= REEF_LOD ? this.buildReef(i, j, group) : 0;
    if (this._reefProps) this.reefDirty = true;

    this.scene.add(group);
    return { i, j, segs, group, trees, coral, plants: this._plants,
             reefProps: this._reefProps, stale: false };
  }

  /**
   * Coral, sponges and grass on the sea bed. Same deterministic scatter as the
   * forest, filtered on depth, slope and the reef mask instead of height,
   * slope and moisture — a colony grows on rock, the grass grows on the sand
   * between colonies, and neither crosses into the other's ground.
   */
  buildReef(i, j, group) {
    const geos = reefGeometry();
    // How tall each species stands and how wide it spreads, measured once from
    // the geometry rather than guessed from the table.
    if (!this._reefBounds) {
      this._reefBounds = geos.map(g => {
        g.computeBoundingBox();
        const b = g.boundingBox;
        return { top: b.max.y, rad: Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z) };
      });
    }
    const slots = REEF.map(() => []);
    const eligible = new Float32Array(REEF.length);
    const ox = i * CHUNK, oz = j * CHUNK;
    const samples = 460;

    for (let s = 0; s < samples; s++) {
      const rx = hash(i * 6421 + s, j * 51413);
      const rz = hash(i * 51413, j * 6421 + s);
      const x = ox - CHUNK / 2 + rx * CHUNK;
      const z = oz - CHUNK / 2 + rz * CHUNK;
      const h = heightAt(x, z);
      if (h > WADE || h < -28) continue;      // dry land, or past the drop-off
      const slope = slopeAt(x, z);
      const reef = reefMask(x, z, -coastDistance(x, z));

      // Weighted lottery among everything that can live here. First-match-wins
      // would hand every legal spot to whichever species is listed first, and
      // a reef of one coral repeated 800 times is exactly the thing this is
      // meant to fix.
      let total = 0;
      for (let f = 0; f < REEF.length; f++) {
        const sp = REEF[f];
        eligible[f] =
          h >= sp.depth[0] && h <= sp.depth[1] &&
          slope <= sp.maxSlope &&
          reef >= sp.reef[0] && reef < sp.reef[1] ? sp.weight : 0;
        total += eligible[f];
      }
      if (total <= 0) continue;
      // Bare ground between the colonies: never fill every legal spot.
      if (hash(s * 37, i * 17 + j) > 0.46 + reef * 0.50) continue;

      let pick = hash(s * 71 + 3, i * 29 + j * 7) * total;
      for (let f = 0; f < REEF.length; f++) {
        pick -= eligible[f];
        if (pick <= 0 && eligible[f] > 0) { slots[f].push({ x, z, y: h, s }); break; }
      }
    }

    let total = 0;
    const d = this._dummy;
    const footprints = [];
    for (let f = 0; f < REEF.length; f++) {
      const list = slots[f];
      if (!list.length) continue;
      const sp = REEF[f];
      const inst = new THREE.InstancedMesh(geos[f], this.reefMaterial, list.length);
      inst.receiveShadow = true;
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        // Scale spread is deliberately wide. A colony is a few old heads and a
        // lot of young ones, and uniform size is what makes scatter read as
        // wallpaper.
        const g = Math.pow(hash(t.s, f * 23), 1.7);
        const sc = THREE.MathUtils.lerp(sp.scale[0], sp.scale[1], g);
        d.position.set(t.x, t.y - 0.08, t.z);
        // A little tilt off vertical: nothing on a reef grew plumb.
        d.rotation.set((hash(t.s, f * 41) - 0.5) * 0.30, hash(t.s, f * 31) * Math.PI * 2,
                       (hash(t.s, f * 53) - 0.5) * 0.30);
        d.scale.set(sc * (0.85 + hash(t.s, f * 59) * 0.3), sc, sc * (0.85 + hash(t.s, f * 83) * 0.3));
        d.updateMatrix();
        inst.setMatrixAt(k, d.matrix);

        // Per-instance tint, multiplied onto the baked vertex colours. Two
        // heads of the same species are never quite the same colour, and this
        // is most of what stops 300 instances looking like 300 copies.
        const a = hash(t.s, f * 61), b = hash(t.s, f * 67);
        const v = sp.tint;
        this._c.setRGB(1 + (a - 0.5) * 2 * v, 1 + (b - 0.5) * 1.3 * v,
                       1 + (0.5 - a) * 1.6 * v).multiplyScalar(0.84 + hash(t.s, f * 97) * 0.34);
        inst.setColorAt(k, this._c);

        // Remember what this one occupies. The fish steer off this; without it
        // they only know about the ground, and a boulder is three metres of
        // geometry the ground function has never heard of.
        const bounds = this._reefBounds[f];
        const base = t.y - 0.08;
        footprints.push({
          x: t.x, z: t.z, base,
          top: base + sc * bounds.top,
          // Two radii from the same measurement, pulling opposite ways. The
          // fish field wants to over-estimate so nothing ends up inside a
          // rock; player collision wants to under-estimate, because a bounding
          // box around a lumpy boulder is mostly empty at the corners and
          // being stopped by that reads as an invisible wall.
          rad: sc * 1.15 * bounds.rad,
          hit: sc * 0.78 * bounds.rad,
          // Anything that bends in the surge bends around you too.
          solid: sp.soft < 0.5,
        });
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      group.add(inst);
      total += list.length;
    }
    this._reefProps = footprints;
    return total;
  }

  /**
   * Rebuild the obstacle field: the highest thing standing at each cell of the
   * sea bed. Rebuilt whole rather than patched, because props near a chunk
   * edge stamp cells on both sides and unpicking one chunk's contribution from
   * a shared maximum is more bookkeeping than the rebuild costs. It only runs
   * when the reef chunk set changes, which is once every 64m of swimming.
   */
  rebuildReefField() {
    this.reefDirty = false;
    this.reefTops.clear();
    this.reefSolids.clear();
    for (const c of this.chunks.values()) {
      if (!c.reefProps) continue;
      for (const p of c.reefProps) {
        // Collision buckets: one entry per prop, in the cell its axis sits in.
        // SOLID_CELL is wider than the biggest prop plus a body, so a 3x3
        // lookup around the swimmer is guaranteed to see everything that
        // could reach them — and nothing lands in two buckets, so nothing
        // gets pushed out twice.
        if (p.solid) {
          const key = solidCell(Math.floor(p.x / SOLID_CELL), Math.floor(p.z / SOLID_CELL));
          const bucket = this.reefSolids.get(key);
          if (bucket) bucket.push(p); else this.reefSolids.set(key, [p]);
        }
        const i0 = Math.floor((p.x - p.rad) / REEF_CELL), i1 = Math.floor((p.x + p.rad) / REEF_CELL);
        const j0 = Math.floor((p.z - p.rad) / REEF_CELL), j1 = Math.floor((p.z + p.rad) / REEF_CELL);
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            // Nearest point of the cell to the prop's axis: stamp the cells the
            // prop actually overlaps, not its whole bounding square.
            const nx = Math.min(Math.max(p.x, i * REEF_CELL), (i + 1) * REEF_CELL);
            const nz = Math.min(Math.max(p.z, j * REEF_CELL), (j + 1) * REEF_CELL);
            if ((nx - p.x) ** 2 + (nz - p.z) ** 2 > p.rad * p.rad) continue;
            const key = reefCell(i, j);
            const cur = this.reefTops.get(key);
            if (cur === undefined || p.top > cur) this.reefTops.set(key, p.top);
          }
        }
      }
    }
  }

  /**
   * Keep a body out of the solid reef, and report the top of whatever it ends
   * up standing on.
   *
   * Each prop is a vertical cylinder from its base to its top. Overlaps are
   * resolved along the **axis of least penetration**: barely below the top of
   * a boulder and you are lifted onto it, well inside its flank and you are
   * pushed out sideways. Resolving always-sideways would fling anyone who
   * swam down onto a wide coral head several metres across the reef; always-up
   * would let you climb the side of a barrel sponge like a ladder.
   *
   * Soft props are skipped — a sea fan or a clump of grass gives way.
   *
   * **Mutates `pos`** horizontally. Returns the height to stand at, or
   * -Infinity if the body is not on top of anything.
   *
   * @param pos     world position of the body's feet; moved out of any overlap
   * @param radius  body radius
   * @param height  body height above `pos`
   */
  collideReef(pos, radius, height) {
    let stand = -Infinity;
    if (this.reefSolids.size === 0) return stand;

    const ci = Math.floor(pos.x / SOLID_CELL), cj = Math.floor(pos.z / SOLID_CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const bucket = this.reefSolids.get(solidCell(i, j));
        if (!bucket) continue;
        for (const p of bucket) {
          const feet = pos.y;
          if (feet >= p.top) {                      // already clear of it
            const dx0 = pos.x - p.x, dz0 = pos.z - p.z;
            if (dx0 * dx0 + dz0 * dz0 < p.hit * p.hit && p.top > stand) stand = p.top;
            continue;
          }
          if (feet + height <= p.base) continue;    // wholly beneath it

          const dx = pos.x - p.x, dz = pos.z - p.z;
          const rSum = p.hit + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rSum * rSum) continue;

          const d = Math.sqrt(d2);
          const outward = rSum - d;                 // horizontal penetration
          const upward = p.top - feet;              // vertical penetration
          if (upward <= outward) {
            if (p.top > stand) stand = p.top;
          } else if (d > 1e-4) {
            pos.x += (dx / d) * outward;
            pos.z += (dz / d) * outward;
          } else {
            pos.x += rSum;                          // dead centre; any way out
          }
        }
      }
    }
    return stand;
  }

  /**
   * The height something swimming here has to clear: the sea bed, or the top
   * of whatever is standing on it. Over open sand this is just `heightAt`.
   */
  clearanceAt(x, z) {
    const ground = heightAt(x, z);
    if (this.reefTops.size === 0) return ground;
    const top = this.reefTops.get(reefCell(Math.floor(x / REEF_CELL), Math.floor(z / REEF_CELL)));
    return top === undefined || top < ground ? ground : top;
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
  get coralCount() {
    let n = 0;
    for (const c of this.chunks.values()) n += c.coral || 0;
    return n;
  }
}
