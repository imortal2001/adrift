// ── Caves and overhangs ──────────────────────────────────────────────────────
// The land is one height at every point — a heightfield — so it can have
// cliffs but nothing under them. These are what it cannot be:
//
//   caves        tunnels into the foot of a cliff, a few metres wide, that
//                wind twenty-odd metres back to a chamber with a spring pool
//                in it: dark past the first few metres, flint in the walls,
//                and too narrow for a dinosaur to follow you in
//   sea caves    the same at the waterline under a sea cliff: you swim in,
//                and at the back is a shingle beach to climb out on
//   sea arches   rock arches in the shallows off the cliffs, to swim or sail
//                under — their legs are solid, to you and to the raft
//   rock shelves ledges jutting from the lips of the cliffs, to walk out
//                onto, or under
//
// Each is its own mesh; the heightfield is left as it is. A cave's tube is
// set into the hill with the ground above it untouched, and where the tube
// comes out through the cliff face the terrain is cut away (CAVE_CUT in
// terrain.js) so the mouth opens. Inside, the floor, the walls and the roof
// are the tube's: floorAt() and clampInCave() are what you stand on and walk
// within there, instead of the heightfield (player.js).
//
// Dark inside because it is: the daylight — sun, moon and sky — falls off the
// further in a wall is (aDay), and the tube shadows itself as well. A torch is
// a real light, so it lights the rock as it is.
//
// Where they all are is found once, from the land itself (survey()) — the
// same on every machine, so playing together everyone has the same caves.

import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { heightAt, landAt, coastDistance, freshWaterAt, WORLD, CAVE_CUT, CAVE_FAR, CAVE_MOUTHS } from './terrain.js';
import { applyGroundDetail } from './detail.js';

const LAND_CAVES = 8, SEA_CAVES = 3, ARCHES = 5, SHELVES = 36;
const NEAR_LANDING = 560;          // m from the raft's start: the landing beach, no caves
const FLINT_REGROW = 900;          // s until a chipped flint face is there to chip again
const CUTS = 8;                    // capsules of terrain cut away at cave mouths at once: the nearest

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A seeded random stream, so the survey picks the same everywhere. */
function stream(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedAt = (x, z) => (Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(z) | 0, 19349663)) >>> 0;

/** Rock roughness in three dimensions, -1..1: sums of sines, cheap and seamless. */
function rough(x, y, z) {
  return Math.sin(x * 1.31 + y * 0.72) * Math.sin(z * 1.17 - y * 0.93)
       + 0.5 * Math.sin(x * 2.9 - z * 2.3 + y * 1.7)
       + 0.25 * Math.sin(x * 5.3 + y * 4.1 + z * 4.7);
}

// ── where they are ───────────────────────────────────────────────────────────
export const CAVES = [];       // { kind: 'land' | 'sea', samples, mouth, spring, flint, bound }
export const ARCH_LIST = [];   // { a: {x,z}, b: {x,z}, top, bed, legs: [{x,z,r}], curve }
export const SHELF_LIST = [];  // { x, z, top, yaw, w, d, t }
let surveyed = false;

/** Find them all, once. Cheap: a few tens of thousands of height samples. */
export function survey() {
  if (surveyed) return;
  surveyed = true;
  const land = landCandidates();
  for (const c of land.cliffs) {
    if (CAVES.length >= LAND_CAVES) break;
    if (CAVES.some(o => Math.hypot(o.mouth.x - c.x, o.mouth.z - c.z) < 200)) continue;
    const cave = fitLandCave(c);
    if (cave) CAVES.push(cave);
  }
  const shore = shoreline();
  for (const p of shore) {
    if (CAVES.filter(c => c.kind === 'sea').length >= SEA_CAVES) break;
    if (p.cliff < 0.75 || CAVES.some(o => Math.hypot(o.mouth.x - p.x, o.mouth.z - p.z) < 300)) continue;
    const cave = fitSeaCave(p);
    if (cave) CAVES.push(cave);
  }
  for (const p of shore) {
    if (ARCH_LIST.length >= ARCHES) break;
    if (p.cliff < 0.6) continue;
    if (ARCH_LIST.some(o => Math.hypot(o.x - p.x, o.z - p.z) < 250)) continue;
    if (CAVES.some(o => Math.hypot(o.mouth.x - p.x, o.mouth.z - p.z) < 120)) continue;
    const arch = fitArch(p);
    if (arch) ARCH_LIST.push(arch);
  }
  for (const c of land.lips.slice(0, 600)) {             // (most tries fail: a cap on how many)
    if (SHELF_LIST.length >= SHELVES) break;
    if (SHELF_LIST.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 70)) continue;
    if (CAVES.some(o => Math.hypot(o.mouth.x - c.x, o.mouth.z - c.z) < 40)) continue;
    const shelf = fitShelf(c);
    if (shelf) SHELF_LIST.push(shelf);
  }
  // The terrain keeps its flowers and vines out of the mouths.
  for (const c of CAVES) CAVE_MOUTHS.push({ x: c.mouth.x, z: c.mouth.z, r: c.samples[0].w + 3.5 });
}

/** Steep ground inland, sorted steepest first: where cliffs are. */
function landCandidates() {
  const cliffs = [], step = 18, R = WORLD.radius + 160, e = 4;
  for (let x = WORLD.cx - R; x <= WORLD.cx + R; x += step) {
    for (let z = WORLD.cz - R; z <= WORLD.cz + R; z += step) {
      if (Math.hypot(x, z) < NEAR_LANDING) continue;
      if (coastDistance(x, z) < 70) continue;
      const h = heightAt(x, z);
      if (h < 5 || h > 150) continue;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const g = Math.hypot(gx, gz);
      if (g < 0.5) continue;
      cliffs.push({ x, z, ux: gx / g, uz: gz / g, g });
    }
  }
  cliffs.sort((a, b) => b.g - a.g);
  return { cliffs, lips: cliffs };
}

/** The shoreline all the way round, every few metres: where it is, which way is inland, how much cliff. */
function shoreline() {
  const out = [];
  for (let th = 0; th < Math.PI * 2; th += 0.006) {
    const cx = Math.cos(th), sz = Math.sin(th);
    let lo = 200, hi = 1500;
    for (let k = 0; k < 22; k++) {
      const r = (lo + hi) / 2;
      if (coastDistance(WORLD.cx + cx * r, WORLD.cz + sz * r) > 0) lo = r; else hi = r;
    }
    const x = WORLD.cx + cx * lo, z = WORLD.cz + sz * lo;
    if (Math.hypot(x, z) < NEAR_LANDING + 200) continue;
    const e = 3, gx = coastDistance(x + e, z) - coastDistance(x - e, z), gz = coastDistance(x, z + e) - coastDistance(x, z - e);
    const g = Math.hypot(gx, gz) || 1;
    const ux = gx / g, uz = gz / g;
    out.push({ x, z, ux, uz, cliff: landAt(x + ux * 6, z + uz * 6).cliff });
  }
  // Most cliff first, and from all round the coast rather than one stretch.
  const R = stream(7);
  return out.map(p => ({ p, k: p.cliff + R() * 0.15 })).sort((a, b) => b.k - a.k).map(o => o.p);
}

/**
 * The line a cave runs along: a sample every metre from its mouth (s = 0)
 * back to the far wall of its chamber. Each has its floor height y, its
 * half-width w and its height h above the floor, and the way it runs (fx, fz).
 */
function carvePath(x, z, heading, o, R) {
  const samples = [], total = o.tunnel + 2 * o.room;
  let a = heading;
  const wob = R() * 6.28, bend = (R() - 0.5) * 2;
  for (let s = 0; s <= total + 1e-6; s += 1) {
    const q = Math.max(0, 1 - ((s - o.tunnel - o.room) / o.room) ** 2), c = Math.sqrt(q);
    const tunnel = s <= o.tunnel + o.room * 0.35;
    const flare = s < 1.5 ? 1.08 : 1;                     // the lip of the mouth
    const w = Math.max(tunnel ? o.width * flare : 0, o.room * c, 0.15);
    const h = Math.max(tunnel ? o.height * flare : 0, o.roomH * Math.pow(c, 0.6), 0.2);
    samples.push({ x, z, y: o.floor(s, total), w, h, s, fx: Math.sin(a), fz: Math.cos(a) });
    if (s > 3) a += Math.sin(s * 0.23 + wob) * 0.045 + bend * 0.018;
    x += Math.sin(a); z += Math.cos(a);
  }
  return samples;
}

// The first few metres of a tunnel come out of the slope of the cliff — a hood
// of rock over the way in — and the terrain is cut along them (two capsules,
// so the cut follows the tunnel's bend); past that, it is under the hill.
const HOOD = 9;
const CUTS_PER_CAVE = 2;

/** Is there rock enough over this path: nowhere past the hood does the tube come up out of the hill? */
function covered(samples, over = 1.6) {
  for (const p of samples) {
    if (p.s < HOOD) continue;
    if (heightAt(p.x, p.z) < p.y + p.h + over) return false;
    if (p.w > 2.5) {
      const sx = p.fz, sz = -p.fx;
      for (const k of [-0.8, 0.8]) {
        if (heightAt(p.x + sx * p.w * k, p.z + sz * p.w * k) < p.y + p.h * 0.6 + over) return false;
      }
    }
  }
  return true;
}

function bound(samples) {
  let x = 0, z = 0;
  for (const p of samples) { x += p.x; z += p.z; }
  x /= samples.length; z /= samples.length;
  let r = 0;
  for (const p of samples) r = Math.max(r, Math.hypot(p.x - x, p.z - z) + p.w + 1);
  return { x, z, r };
}

/** A few flint faces low on the walls, in the deeper half of the tunnel and round the chamber. */
function flintFaces(samples, o, R, n) {
  const out = [];
  const deep = samples.filter(p => p.s > o.tunnel * 0.55 && p.w > 1.2 && p.s < samples.at(-1).s - 2);
  for (let k = 0; k < n && deep.length; k++) {
    const p = deep[Math.floor(R() * deep.length)];
    // On the wall at its own height: out where the curve of the wall is there.
    // (In a sea cave, clear of the water: `above` is the height it must be over.)
    const up = (o.above !== undefined ? Math.max(0, o.above - p.y) : 0) + 0.12 + R() * 0.4, yl = Math.min(up, p.h * 0.6);
    const side = R() < 0.5 ? -1 : 1, lat = p.w * Math.sqrt(1 - (yl / p.h) ** 2) * 0.95 * side;
    out.push({ x: p.x + p.fz * lat, z: p.z - p.fx * lat, y: p.y + yl,
               size: 0.16 + R() * 0.1, spin: R() * 6.28, key: `${Math.round(p.x)},${Math.round(p.z)},${k}` });
  }
  return out;
}

/** A cave at the foot of the cliff found near `c`, or null if there is no good one. */
function fitLandCave(c) {
  // Along the way uphill: the foot is where flat ground meets a face that
  // stands up at once — not a slope that steepens, or the tube would run out
  // in the open for metres before it met the rock.
  let foot = null;
  for (let t = -18; t <= 12; t += 0.5) {
    const x = c.x + c.ux * t, z = c.z + c.uz * t, h = heightAt(x, z);
    const at = d => heightAt(x + c.ux * d, z + c.uz * d) - h;
    if (Math.abs(at(-3)) < 0.8 && at(2.5) > 1.8 && at(6) > 5.5 && at(10) > 8.5) { foot = { x, z, h }; break; }
  }
  if (!foot || freshWaterAt(foot.x, foot.z) || freshWaterAt(foot.x - c.ux * 3, foot.z - c.uz * 3)) return null;
  const R = stream(seedAt(foot.x, foot.z));
  const sx = foot.x - c.ux * 1.2, sz = foot.z - c.uz * 1.2;
  const floor0 = Math.min(heightAt(sx, sz), foot.h) + 0.02;
  const o = { tunnel: 14 + R() * 10, width: 1.55 + R() * 0.3, height: 3.1 + R() * 0.4,
              room: 4.6 + R() * 1.6, roomH: 4.4 + R() * 1.2, floor: s => floor0 + 0.05 * s };
  const samples = carvePath(sx, sz, Math.atan2(c.ux, c.uz), o, R);
  if (!covered(samples)) return null;
  const mid = samples.find(p => p.s >= o.tunnel + o.room) || samples.at(-1);
  // The spring: off to one side of the chamber, fed from the rock.
  const side = R() < 0.5 ? -1 : 1, lat = o.room * 0.38 * side;
  const spring = { x: mid.x + mid.fz * lat, z: mid.z - mid.fx * lat, r: o.room * 0.3, depth: 0.45, level: mid.y - 0.06 };
  return { kind: 'land', samples, mouth: { x: sx, z: sz, y: floor0 }, spring,
           flint: flintFaces(samples, o, R, 5), bound: bound(samples), o };
}

/** A sea cave in the sea cliff at `p`: its mouth at the waterline, a shingle beach at the back. */
function fitSeaCave(p) {
  // At the waterline, where the sea meets the cliff; the water deep enough to swim up to it.
  const sx = p.x - p.ux * 1.5, sz = p.z - p.uz * 1.5;
  if (heightAt(sx, sz) > 0.3 || heightAt(p.x - p.ux * 9, p.z - p.uz * 9) > -1.5) return null;
  const R = stream(seedAt(sx, sz));
  const o = { tunnel: 13 + R() * 6, width: 2.1 + R() * 0.3, height: 3.4 + R() * 0.3,
              room: 5 + R() * 1.2, roomH: 4.8 + R() * 0.8,
              floor: (s, total) => -1.9 + 2.4 * smooth(total * 0.5, total * 0.85, s) };
  const samples = carvePath(sx, sz, Math.atan2(p.ux, p.uz), o, R);
  if (!covered(samples, 2)) return null;
  return { kind: 'sea', samples, mouth: { x: sx, z: sz, y: o.floor(0, 1) }, spring: null,
           flint: flintFaces(samples, { ...o, above: 0.5 }, R, 6),
           bound: bound(samples), o };
}

/** An arch in the shallows off the cliff at `p`, standing parallel to the shore. */
function fitArch(p) {
  const R = stream(seedAt(p.x * 3, p.z * 3));
  const out = 16 + R() * 14, span = 11 + R() * 5;
  const cx = p.x - p.ux * out, cz = p.z - p.uz * out;
  const tx = -p.uz, tz = p.ux;
  const a = { x: cx - tx * span / 2, z: cz - tz * span / 2 }, b = { x: cx + tx * span / 2, z: cz + tz * span / 2 };
  const ba = heightAt(a.x, a.z), bb = heightAt(b.x, b.z), mid = heightAt(cx, cz);
  if (ba > -1.5 || bb > -1.5 || ba < -11 || bb < -11 || mid > -2) return null;
  const top = 7.5 + R() * 3.5, legR = 2.1 + R() * 0.5, topR = 1.4 + R() * 0.3;
  const arch = { x: cx, z: cz, a, b, bedA: ba, bedB: bb, top, legR, topR, bow: (R() - 0.5) * 3, nx: -p.ux, nz: -p.uz };
  arch.legs = [archPoint(arch, 0.07), archPoint(arch, 0.93)].map(q => ({ x: q.x, z: q.z, r: q.r + 0.3 }));
  return arch;
}

/** A point on an arch's curve, t 0..1 from one foot to the other: position and thickness. */
function archPoint(A, t) {
  const u = 0.5 - 0.5 * Math.cos(Math.PI * t);                  // slow at the feet: the legs stand upright
  const bow = Math.sin(Math.PI * t) * A.bow;
  const bed = A.bedA + (A.bedB - A.bedA) * t;
  return {
    x: A.a.x + (A.b.x - A.a.x) * u + A.nx * bow,
    z: A.a.z + (A.b.z - A.a.z) * u + A.nz * bow,
    y: bed - 1.5 + (A.top + 1.5 - bed) * Math.pow(Math.sin(Math.PI * t), 0.42),
    r: A.legR + (A.topR - A.legR) * Math.sin(Math.PI * t),
  };
}

/** A ledge off the lip of the cliff near `c`, if there is a drop there to stand out over. */
function fitShelf(c) {
  for (let t = 12; t >= -8; t -= 1) {
    const x = c.x + c.ux * t, z = c.z + c.uz * t, h = heightAt(x, z);
    const below = heightAt(x - c.ux * 4, z - c.uz * 4), behind = heightAt(x + c.ux * 3, z + c.uz * 3);
    if (h - below < 4 || Math.abs(behind - h) > 1.5) continue;
    const R = stream(seedAt(x, z));
    const d = 3 + R() * 2.5, w = 5 + R() * 4, thick = 1.3 + R() * 1.1, top = h - 0.15;
    // Room to walk under it.
    const under = heightAt(x - c.ux * d * 0.7, z - c.uz * d * 0.7);
    if (under > top - thick - 2.3) return null;
    if (freshWaterAt(x, z)) return null;
    return { x, z, top, yaw: Math.atan2(-c.ux, -c.uz), w, d, t: thick, ox: -c.ux, oz: -c.uz,
             sandstone: landAt(x, z).mesa > 0.3 };
  }
  return null;
}

// ── being in one ─────────────────────────────────────────────────────────────
const _hit = { cave: null, s: 0, d: 0, lat: 0, floor: 0, w: 0, h: 0, cx: 0, cz: 0, day: 1 };

/** How much daylight reaches this far into a cave: all of it at the mouth, next to none ten metres in. */
export function daylight(s, kind = 'land') {
  return 0.035 + 0.965 * (1 - smooth(1.5, kind === 'sea' ? 13 : 10, s));
}

/**
 * The cave at (x, z), if that is inside one at height y: where along it, its
 * floor there (the spring's dish in it), how wide and how high it is. The
 * result is shared: copy what you keep.
 */
export function caveAt(x, z, y) {
  survey();
  for (const c of CAVES) {
    if (Math.hypot(x - c.bound.x, z - c.bound.z) > c.bound.r) continue;
    const S = c.samples;
    let best = Infinity, bi = -1, bt = 0, front = false;
    for (let i = 0; i < S.length - 1; i++) {
      const p = S[i], q = S[i + 1];
      const dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz || 1;
      const raw = ((x - p.x) * dx + (z - p.z) * dz) / L2, t = Math.min(1, Math.max(0, raw));
      const d = Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t));
      if (d < best) { best = d; bi = i; bt = t; front = i === 0 && raw < 0; }
    }
    // Nearest to the mouth from out in front of it: that is outside.
    if (bi < 0 || front) continue;
    const p = S[bi], q = S[bi + 1], k = bt;
    const w = p.w + (q.w - p.w) * k, h = p.h + (q.h - p.h) * k;
    if (best > w + 0.3) continue;
    let floor = p.y + (q.y - p.y) * k;
    if (c.spring) {
      const r = Math.hypot(x - c.spring.x, z - c.spring.z);
      floor -= c.spring.depth * (1 - smooth(c.spring.r * 0.55, c.spring.r, r));
    }
    if (y < floor - 1.2 || y > floor + h + 0.3) continue;
    const s = p.s + (q.s - p.s) * k;
    Object.assign(_hit, { cave: c, s, d: best, floor, w, h, cx: p.x + (q.x - p.x) * k, cz: p.z + (q.z - p.z) * k,
                          day: daylight(s, c.kind) });
    return _hit;
  }
  return null;
}

/**
 * How high the roof is over a point of a cave (a caveAt() hit): under the
 * curve of the arch there, less what its roughness may bring it down by.
 */
export function roofAt(hit) {
  return hit.floor + hit.h * Math.sqrt(Math.max(0, 1 - (hit.d / hit.w) ** 2)) - 0.5;
}

/** The half-width you can walk in at this point of a cave: less than the floor's, under the curve of the walls. */
function walkable(hit) {
  return hit.w * Math.sqrt(Math.max(0.2, 1 - (1.5 / Math.max(hit.h, 1.6)) ** 2));
}

/**
 * Keep a body of radius `r` at `pos` inside the cave it is in: slide it back
 * in off the walls. Returns the cave hit, or null if it is not in one.
 */
export function clampInCave(pos, r) {
  const hit = caveAt(pos.x, pos.z, pos.y);
  if (!hit) return null;
  const room = Math.max(0.05, walkable(hit) - r);
  if (hit.d > room) {
    const k = room / hit.d;
    pos.x = hit.cx + (pos.x - hit.cx) * k;
    pos.z = hit.cz + (pos.z - hit.cz) * k;
  }
  return hit;
}

/**
 * What you stand on at (x, z) with your feet at y, if a cave or a rock shelf
 * is what holds you up there: { y, cave } — or null for the ground itself.
 */
export function floorAt(x, z, y) {
  const hit = caveAt(x, z, y);
  if (hit) return { y: hit.floor, cave: hit.cave, s: hit.s, roof: hit.floor + hit.h };
  for (const sh of SHELF_LIST) {
    if (Math.abs(x - sh.x) > sh.d + sh.w || Math.abs(z - sh.z) > sh.d + sh.w) continue;
    const dx = x - sh.x, dz = z - sh.z;
    const along = dx * sh.ox + dz * sh.oz, across = dx * sh.oz - dz * sh.ox;
    if (along < 0 || along > sh.d * 0.92) continue;
    if (Math.abs(across) > sh.w * 0.45 * Math.sqrt(Math.max(0, 1 - (along / sh.d) ** 2))) continue;
    if (y >= sh.top - 0.7) return { y: sh.top, cave: null, shelf: sh };
  }
  return null;
}

/** The fresh water of a cave's spring at (x, z), like freshWaterAt(): { level, depth, kind } or null. */
export function springAt(x, z, y) {
  const hit = caveAt(x, z, y);
  const sp = hit?.cave.spring;
  if (!sp || Math.hypot(x - sp.x, z - sp.z) > sp.r * 0.95) return null;
  return { level: sp.level, depth: Math.max(0, sp.level - hit.floor), kind: 'spring' };
}

/** Arch legs within r of (x, z): circles standing through the waterline. */
export function archLegsNear(x, z, r, out = []) {
  survey();
  out.length = 0;
  for (const A of ARCH_LIST) {
    if (Math.hypot(x - A.x, z - A.z) > r + 12) continue;
    for (const l of A.legs) if (Math.hypot(x - l.x, z - l.z) < r + l.r) out.push(l);
  }
  return out;
}

/** Push (pos.x, pos.z) out of any arch leg it is in, as a body of radius r. */
export function collideArches(pos, r) {
  for (const l of archLegsNear(pos.x, pos.z, r)) {
    const dx = pos.x - l.x, dz = pos.z - l.z, d = Math.hypot(dx, dz) || 1e-4, min = l.r + r;
    if (d < min) { pos.x = l.x + dx / d * min; pos.z = l.z + dz / d * min; }
  }
}

// ── the meshes ───────────────────────────────────────────────────────────────
const ROCK = {
  land: [new THREE.Color(0x8f6f55), new THREE.Color(0x6e6962)],   // sandstone and grey, as the cliff it is in
  sea: [new THREE.Color(0x55524d), new THREE.Color(0x3f4446)],
  floor: new THREE.Color(0x4f4436), shingle: new THREE.Color(0x8a8272), wet: new THREE.Color(0x3a3530),
};

/** The rock of the caves: the ground's detail on it, and the sky's light only as far in as it reaches (aDay). */
let caveMat = null;
export function caveMaterial() {
  if (caveMat) return caveMat;
  const m = applyGroundDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
                              { rock: 0.8 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDay;\nvarying float vDay;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDay = aDay;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDay;')
      // Neither the sky's light nor the sun's (nor the moon's) gets round the
      // bend. The tube shadows itself as well, but only as far as the sun's
      // shadow reaches — a few tens of metres round you — and a chamber past
      // that would be sunlit through the rock. A torch is a point light: not
      // touched, so it lights the rock as it is.
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vDay;'))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vDay;
        reflectedLight.indirectSpecular *= vDay;`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `cave-${key ? key() : ''}`;
  return (caveMat = m);
}

// How thick the rock of a tube is: its outer skin is what shows where the
// hood comes out of the slope, and round the edge of the terrain's cut.
const SKIN = 0.75;

/**
 * The same fall-off of the daylight for a plain material deep in a cave — the
 * springs, the flint — at one depth for the lot: `day` 0..1.
 */
function inTheDark(material, day) {
  material.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        `getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ${day.toFixed(3)};`))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= ${day.toFixed(3)};
        reflectedLight.indirectSpecular *= ${day.toFixed(3)};`);
  };
  material.customProgramCacheKey = () => `dark-${day.toFixed(3)}`;
  return material;
}

/**
 * A cave's tube: a ring of rock every metre along its path — an arch of wall
 * and roof over a flat floor — joined up, closed at the far end, open at the
 * mouth; and round it, SKIN further out, its outer face, the two joined at the
 * lip of the mouth. Stalactites in the chamber. The inside faces in.
 */
export function caveGeometry(c, { open = false } = {}) {
  // (`open`: a cutaway for the asset gallery — the roof off above head height,
  // no outer skin, and lit as if it were day inside, so it can be seen at all.)
  const S = c.samples, K = 16, F = 6;
  const pos = [], col = [], day = [], idx = [];
  const tint = new THREE.Color(), rock = ROCK[c.kind];
  const ring = K + F;                                  // arch K+1 points, floor F-1 between
  const put = (x, y, z, colour, dayv) => { pos.push(x, y, z); col.push(colour.r, colour.g, colour.b); day.push(dayv); };
  const rings = (outer) => { for (const p of S) {
    const sx = p.fz, sz = -p.fx;                       // across, to the right
    const amp = 0.42 * smooth(1.5, 5, p.s) * (p.w > 2.5 ? 1.3 : 1);
    const dv = outer || open ? 1 : daylight(p.s, c.kind);
    const w = p.w + (outer ? SKIN : 0), h = p.h + (outer ? SKIN : 0);
    const pts = [];
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * Math.PI, lx = Math.cos(th) * w, ly = Math.sin(th) * h;
      const nx = Math.cos(th), ny = Math.sin(th);
      pts.push([lx, ly, nx, ny, 'wall']);
    }
    for (let k = 1; k < F; k++) pts.push([-w + (2 * w * k) / F, outer ? -0.6 : 0, 0, -1, 'floor']);
    for (const [lx, ly, nx, ny, part] of pts) {
      let x = p.x + sx * lx, y = p.y + ly, z = p.z + sz * lx;
      if (part === 'wall') {
        const n = rough(x * 0.9, y * 0.9, z * 0.9) * amp * (0.35 + 0.65 * Math.min(1, ly / 0.8));
        x += sx * nx * n; y += ny * n * 0.8; z += sz * nx * n;
      } else {
        y += rough(x * 2.1, 0, z * 2.1) * 0.03 * smooth(1, 3, p.s);
        if (c.spring && !outer) {
          const r = Math.hypot(x - c.spring.x, z - c.spring.z);
          y -= c.spring.depth * (1 - smooth(c.spring.r * 0.55, c.spring.r, r));
        }
      }
      // Colour: the rock, streaked; the floor darker, damp by the spring and at the waterline.
      const v = rough(x * 0.37 + 11, y * 0.5, z * 0.37 - 4);
      tint.copy(rock[0]).lerp(rock[1], 0.5 + 0.5 * Math.sin(y * 1.7 + v * 2)).multiplyScalar(0.86 + 0.14 * v);
      if (part === 'floor' || ly < 0.25) tint.lerp(c.kind === 'sea' && p.y > -0.3 ? ROCK.shingle : ROCK.floor, 0.7);
      if (c.kind === 'sea' && y < 0.7) tint.lerp(ROCK.wet, smooth(0.7, -0.4, y) * 0.8);
      if (c.spring && Math.hypot(x - c.spring.x, z - c.spring.z) < c.spring.r * 1.5) tint.lerp(ROCK.wet, 0.45);
      put(x, y, z, tint, dv);
    }
  } };
  rings(false);
  const outer = pos.length / 3;
  rings(true);
  const cutAt = (v, i) => pos[v * 3 + 1] - S[i].y > 1.9;
  const quads = (base, flip) => {
    for (let i = 0; i < S.length - 1; i++) {
      for (let k = 0; k < ring; k++) {
        const a = base + i * ring + k, b = base + i * ring + (k + 1) % ring, c2 = a + ring, d = b + ring;
        if (open && (cutAt(a, i) || cutAt(b, i))) continue;
        if (flip) idx.push(a, b, c2, b, d, c2); else idx.push(a, c2, b, b, c2, d);
      }
    }
  };
  quads(0, false);
  if (!open) quads(outer, true);
  // The lip of the mouth: inner ring 0 to outer ring 0.
  for (let k = 0; k < ring && !open; k++) {
    const a = k, b = (k + 1) % ring, c2 = outer + k, d = outer + (k + 1) % ring;
    idx.push(a, b, c2, b, d, c2);
  }
  // Close both at the far end.
  const end = S.at(-1);
  for (const [base, flip] of open ? [] : [[0, false], [outer, true]]) {
    const last = base + (S.length - 1) * ring;
    put(end.x + end.fx * (base ? 0.2 + SKIN : 0.2), end.y + end.h * 0.4, end.z + end.fz * (base ? 0.2 + SKIN : 0.2), rock[1], base ? 1 : daylight(end.s, c.kind));
    const centre = pos.length / 3 - 1;
    for (let k = 0; k < ring; k++) {
      if (flip) idx.push(last + k, last + (k + 1) % ring, centre);
      else idx.push(last + k, centre, last + (k + 1) % ring);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aDay', new THREE.Float32BufferAttribute(day, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Faces in: the roof's normals point down. If they came out the other way, turn them all.
  // (Tested on the wall's foot, not the roof, which a cutaway has not got.)
  const top = Math.floor(S.length / 3) * ring + K / 2, foot = Math.floor(S.length / 3) * ring + 1;
  const wrong = open ? g.attributes.normal.getX(foot) * S[Math.floor(S.length / 3)].fz - g.attributes.normal.getZ(foot) * S[Math.floor(S.length / 3)].fx > 0
                     : g.attributes.normal.getY(top) > 0;
  if (wrong) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  // Stalactites from the chamber's roof.
  const R = stream(seedAt(c.mouth.x * 7, c.mouth.z * 7)), drips = [];
  const room = S.filter(p => p.w > 2.8);
  for (let k = 0; k < 9 && room.length && !open; k++) {
    const p = room[Math.floor(R() * room.length)], lat = (R() * 2 - 1) * p.w * 0.6;
    const roof = p.y + p.h * Math.sqrt(1 - (lat / p.w) ** 2);
    const len = 0.4 + R() * 1.1, rad = 0.08 + R() * 0.12;
    const cone = new THREE.ConeGeometry(rad, len, 6, 1, false).rotateX(Math.PI).translate(p.x + p.fz * lat, roof - len / 2 + 0.25, p.z - p.fx * lat);
    const n = cone.attributes.position.count;
    tint.copy(rock[0]).multiplyScalar(0.95);
    cone.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [tint.r, tint.g, tint.b]), 3));
    cone.setAttribute('aDay', new THREE.Float32BufferAttribute(new Array(n).fill(daylight(p.s, c.kind)), 1));
    drips.push(cone.toNonIndexed());
  }
  if (drips.length) g = mergeGeometries([g.toNonIndexed(), ...drips.map(d => { d.deleteAttribute('uv'); return d; })], false);
  g.computeBoundingSphere();
  return g;
}

/** Tube rock for an arch or a shelf: ordinary daylight all over. */
function withDay(g) {
  g.setAttribute('aDay', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return g;
}

/** An arch: a tube of rock along its curve, thick at the feet, sunk into the sea bed at both ends. */
export function archGeometry(A) {
  const N = 44, M = 12, pos = [], col = [], idx = [];
  const tint = new THREE.Color(), rock = ROCK.sea;
  const P = t => archPoint(A, t);
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = P(t), q = P(Math.min(1, t + 0.01)), o = P(Math.max(0, t - 0.01));
    const T = new THREE.Vector3(q.x - o.x, q.y - o.y, q.z - o.z).normalize();
    const side = new THREE.Vector3(A.nx, 0, A.nz), up = new THREE.Vector3().crossVectors(T, side).normalize();
    side.crossVectors(up, T).normalize();
    // Thicker and thinner along it, as the sea has worn it; the feet splayed.
    const foot = 1 - smooth(0, 0.14, Math.min(t, 1 - t));
    const girth = 1 + 0.22 * Math.sin(t * 11 + A.bow * 3) + 0.12 * Math.sin(t * 23 + 1) + foot * 0.7;
    for (let k = 0; k < M; k++) {
      const th = (k / M) * Math.PI * 2, cx = Math.cos(th), cy = Math.sin(th);
      const r = p.r * girth * (1 + 0.22 * rough(p.x * 0.6 + cx, p.y * 0.6, p.z * 0.6 + cy));
      const x = p.x + (side.x * cx + up.x * cy) * r * 1.15, y = p.y + (side.y * cx + up.y * cy) * r, z = p.z + (side.z * cx + up.z * cy) * r * 1.15;
      pos.push(x, y, z);
      const v = rough(x * 0.4, y * 0.6, z * 0.4);
      tint.copy(rock[0]).lerp(rock[1], 0.5 + 0.5 * Math.sin(y * 0.9 + v)).multiplyScalar(0.9 + 0.12 * v);
      if (y < 1.2) tint.lerp(ROCK.wet, smooth(1.2, -0.5, y) * 0.7);
      if (y > A.top - 0.5) tint.lerp(new THREE.Color(0xb9b3a2), 0.35);            // bleached by the weather on top
      col.push(tint.r, tint.g, tint.b);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) {
    const a = i * M + k, b = i * M + (k + 1) % M, c = a + M, d = b + M;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return withDay(g.toNonIndexed());
}

/** A ledge: a flattened, knobbly slab, its back sunk into the lip of the cliff, its top flat to walk on. */
export function shelfGeometry(sh) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position, col = [], tint = new THREE.Color();
  const rock = sh.sandstone ? ROCK.land : [ROCK.land[1], ROCK.sea[0]];
  const cos = Math.cos(sh.yaw), sin = Math.sin(sh.yaw);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = rough(x * 2.3 + sh.x, y * 2.3, z * 2.3 + sh.z);
    // Local frame: z out from the cliff, x along it, y up. The top flat.
    let lx = x * sh.w / 2 * (1 + n * 0.08), lz = (z * 0.5 + 0.5) * (sh.d + 1.6) - 1.6, ly;
    lz *= 1 + n * 0.05;
    ly = y > 0 ? -0.02 + n * 0.03 : y * sh.t * (1 + n * 0.25);
    lx *= 0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - (Math.max(0, lz) / (sh.d + 0.4)) ** 2));   // rounded, narrowing to its tip
    x = sh.x + lx * cos + lz * sin; z = sh.z - lx * sin + lz * cos; y = sh.top + ly;
    p.setXYZ(i, x, y, z);
    const v = rough(x * 0.5, y * 0.8, z * 0.5);
    tint.copy(rock[0]).lerp(rock[1], 0.5 + 0.5 * Math.sin(y * 1.9 + v)).multiplyScalar(0.88 + 0.12 * v);
    col.push(tint.r, tint.g, tint.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return withDay(g);
}

/** A flint nodule: a dark, glassy, knobbly lump. */
function flintGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.28 * rough(x * 3, y * 3, z * 3);
    p.setXYZ(i, x * k, y * k * 0.7, z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// ── the lot, in the world ────────────────────────────────────────────────────
export class Caves {
  constructor(scene) {
    survey();
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'caves';
    scene.add(this.group);
    const mat = caveMaterial();
    this.caves = CAVES.map(c => {
      const mesh = new THREE.Mesh(caveGeometry(c), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.cave = c;
      this.group.add(mesh);
      return { c, mesh };
    });
    if (ARCH_LIST.length) {
      const m = new THREE.Mesh(mergeGeometries(ARCH_LIST.map(archGeometry), false), mat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    if (SHELF_LIST.length) {
      const m = new THREE.Mesh(mergeGeometries(SHELF_LIST.map(s => shelfGeometry(s).toNonIndexed()), false), mat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    // The springs: still, dark water in the chamber.
    // (Clear, the wet rock of its dish showing through; glassy, so a torch shows in it as a smear of light.)
    this.water = inTheDark(new THREE.MeshStandardMaterial({ color: 0x2c4a4c, roughness: 0.14, metalness: 0.1, transparent: true,
                                                          opacity: 0.62, depthWrite: false }), daylight(99));
    for (const c of CAVES) {
      if (!c.spring) continue;
      const w = new THREE.Mesh(new THREE.CircleGeometry(c.spring.r * 0.97, 28).rotateX(-Math.PI / 2), this.water);
      w.position.set(c.spring.x, c.spring.level, c.spring.z);
      this.group.add(w);
    }
    // Flint: every face in every cave, one instanced mesh; chipped ones hidden until they are back.
    const faces = CAVES.flatMap(c => c.flint.map(f => ({ ...f, cave: c })));
    this.flint = faces;
    this.flintMesh = new THREE.InstancedMesh(flintGeometry(),
      inTheDark(new THREE.MeshStandardMaterial({ color: 0x33333a, roughness: 0.25, metalness: 0.2 }), daylight(12)), Math.max(1, faces.length));
    this.flintMesh.count = faces.length;
    this.flintMesh.castShadow = true;
    faces.forEach((f, i) => { f.index = i; this.placeFlint(f, true); });
    this.group.add(this.flintMesh);
    this.chipped = new Map();                            // flint key → seconds until it is back
    this._cuts = [];
  }

  placeFlint(f, on) {
    const m = new THREE.Matrix4();
    if (on) m.compose(new THREE.Vector3(f.x, f.y, f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, f.spin, 0.2)),
                      new THREE.Vector3(f.size, f.size, f.size));
    else m.makeScale(0, 0, 0);
    this.flintMesh.setMatrixAt(f.index, m);
    this.flintMesh.instanceMatrix.needsUpdate = true;
  }

  /** Once a frame: the nearest mouths cut in the terrain, and chipped flint coming back. */
  update(dt, focus) {
    const near = this.caves.map(({ c }) => ({ c, d: Math.hypot(c.mouth.x - focus.x, c.mouth.z - focus.z) }))
      .filter(o => o.d < 420).sort((a, b) => a.d - b.d).slice(0, Math.max(CUTS / CUTS_PER_CAVE, 4));
    let n = 0;
    for (const { c } of near) {
      const S = c.samples, half = Math.ceil(HOOD / CUTS_PER_CAVE);
      for (let k = 0; k < CUTS_PER_CAVE; k++) {
        const a = S[Math.min(k * half, S.length - 1)], b = S[Math.min((k + 1) * half, S.length - 1)];
        CAVE_CUT.uCutA.value[n].set(a.x, a.y + a.h / 2, a.z, Math.max(a.w, b.w) + 0.4);
        CAVE_CUT.uCutB.value[n].set(b.x, b.y + b.h / 2, b.z, Math.max(a.h, b.h) / 2 + 0.5);
        CAVE_CUT.uCutF.value[n].set(a.y, b.y);
        n++;
      }
    }
    CAVE_CUT.uCutN.value = n;
    // And where the far land is not drawn: round the nearest few, a coarse
    // triangle's width (16 m) and more past their ends.
    CAVE_FAR.uCaveFar.value.forEach((v, i) => {
      const c = near[i]?.c;
      if (c) v.set(c.bound.x, c.bound.z, c.bound.r + 40); else v.set(0, 0, -1);
    });
    for (const [key, left] of this.chipped) {
      if ((left - dt) > 0) { this.chipped.set(key, left - dt); continue; }
      this.chipped.delete(key);
      const f = this.flint.find(x => x.key === key);
      if (f) this.placeFlint(f, true);
    }
  }

  /** The flint face under the crosshair within reach, or null. */
  pickFlint(eye, dir, reach = 2.4) {
    let best = null, bestScore = -Infinity;
    for (const f of this.flint) {
      if (this.chipped.has(f.key)) continue;
      const dx = f.x - eye.x, dy = f.y - eye.y, dz = f.z - eye.z, d = Math.hypot(dx, dy, dz);
      if (d > reach) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < 0.8) continue;
      const score = dot * 2 - d / reach;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  /** Chip a flint face: it gives a flint or two, and is gone a while. */
  chip(f) {
    this.chipped.set(f.key, FLINT_REGROW);
    this.placeFlint(f, false);
    return 1 + (Math.abs(seedAt(f.x * 13, f.z * 13)) % 2);
  }

  /** The spring you are looking at within reach, or null. */
  pickSpring(eye, dir, reach = 3) {
    for (const c of CAVES) {
      const sp = c.spring;
      if (!sp || Math.hypot(sp.x - eye.x, sp.z - eye.z) > reach + sp.r) continue;
      // Where the look meets the water's surface.
      if (dir.y > -0.05) continue;
      const t = (sp.level - eye.y) / dir.y;
      if (t < 0 || t > reach + 1) continue;
      const x = eye.x + dir.x * t, z = eye.z + dir.z * t;
      if (Math.hypot(x - sp.x, z - sp.z) < sp.r) return sp;
    }
    return null;
  }

  /** 0..1: how much daylight there is where the camera is (1 outside any cave). */
  daylightAt(p) {
    const hit = caveAt(p.x, p.z, p.y - 1.5);
    return hit ? hit.day : 1;
  }
}
