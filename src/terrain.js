// ── The continent ────────────────────────────────────────────────────────────
// A landmass big enough to get lost in, streamed as chunks around whoever is
// looking at it. Like the ocean, the shape is one pure function — `heightAt` —
// so the mesh, the player, the trees and every animal stand on the same
// ground by construction.
//
// Chunks near the viewer are built at fine resolution and coarser further out,
// with a skirt around each one to hide the seams between detail levels.

import * as THREE from 'three';
import { REEF, reefGeometry, reefMaterial, setReefTime } from './reef.js';
import { applyCaustics } from './underwater.js';
import { applyGroundDetail } from './detail.js';
import { SPECIES, LAYERS, speciesGeometry, speciesMaterial, floraMaterials, drapeGeometry, setFloraTime } from './flora.js';
import { Waterfall, lakeGeometry } from './waterfall.js';

export const WORLD = {
  cx: 660, cz: -480,     // continent centre; nearest shoreline is ~80m from the
                         // raft — but see the note on coastDistance below
  radius: 900,           // nominal distance from centre to shoreline
  shoreWobble: 95,       // how far the coastline wanders from that circle...
  // ...and, on top, headlands and bays: lobes by bearing round the centre, so
  // the outline is a coast and not a circle with a ragged edge.
  lobes: [[2, 190, 0.7], [3, 130, 2.1], [5, 70, 4.4], [7, 38, 1.0]],   // [per turn, metres, phase]
};

export const CHUNK = 64;

// ── cave mouths (caves.js) ───────────────────────────────────────────────────
// The heightfield has no holes, so where a cave's tube comes out through the
// cliff face the ground is not drawn: the terrain's shader throws away what is
// inside the mouth — an elliptical capsule from the mouth a few metres in,
// above the tube's floor. caves.js fills these in each frame, nearest first.
export const CAVE_CUT = {
  uCutA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },   // mouth end: centre, half-width
  uCutB: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },   // inner end: centre, half-height
  uCutF: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) },   // the floor at each end
  uCutN: { value: 0 },
};
// Round the nearest caves, the far land is not drawn at all (buildFar): the
// coarse sheet of it runs through the hills — through the caves in them.
export const CAVE_FAR = { uCaveFar: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, -1)) } };  // x, z, radius
// And no flowers, trees or vines in them: { x, z, r } (caves.js survey()).
export const CAVE_MOUTHS = [];
const nearCaveMouth = (x, z) => CAVE_MOUTHS.some(m => Math.hypot(x - m.x, z - m.z) < m.r);

function applyCaveCut(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, CAVE_CUT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uCutA[8];
        uniform vec4 uCutB[8];
        uniform vec2 uCutF[8];
        uniform int uCutN;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        for (int i = 0; i < 8; i++) {
          if (i >= uCutN) break;
          vec3 a = uCutA[i].xyz, ab = uCutB[i].xyz - a;
          float t = clamp(dot(vDetailPos - a, ab) / dot(ab, ab), 0.0, 1.0);
          vec3 o = vDetailPos - (a + ab * t);
          vec2 e = vec2(length(o.xz) / uCutA[i].w, o.y / uCutB[i].w);
          if (dot(e, e) < 1.0 && vDetailPos.y > mix(uCutF[i].x, uCutF[i].y, t) + 0.25) discard;
        }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `cavecut-${key ? key() : ''}`;
  return material;
}
const VIEW_CHUNKS = 7;                     // ~450m of terrain around the viewer
const LOD_SEGMENTS = [64, 32, 16, 8, 8];   // by chunk-distance band
const REEF_LOD = 1;                        // and beyond this, no reef — you cannot
                                           // see 60m through water anyway
const REEF_CELL = 1.5;                     // obstacle-field resolution, metres
const SOLID_CELL = 12.0;                   // bucket size for collision: wider than the biggest
                                           // rock on land plus a body, so a 3x3 look sees all
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
  const dx = x - WORLD.cx, dz = z - WORLD.cz;
  const d = Math.hypot(dx, dz), bearing = Math.atan2(dz, dx);
  let wobble = (fbm(x * 0.0032, z * 0.0032, 4) - 0.5) * WORLD.shoreWobble;
  // Faded out toward the centre: a bearing swings fast there, and at full
  // strength the lobes would drag "distance inland" around in radial streaks.
  const reach = Math.min(1, d / WORLD.radius) ** 2;
  for (const [n, a, p] of WORLD.lobes) wobble += a * Math.sin(n * bearing + p) * reach;
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

// ── the land ─────────────────────────────────────────────────────────────────
// The first continent was a green dome 700 m across with one bump on it. This
// one is built the way land is: a coast of bays and headlands, beaches on the
// sheltered side and sea cliffs on the exposed one; rolling hills behind the
// beach, wide open plains, stepped escarpments where harder rock stands up;
// and in the middle a range of jagged peaks, cloud forest to the tops, that
// you can see from the raft. Rivers come down off the range and cut valleys to the sea.
//
// Every part is noise sampled through a *warped* domain — the coordinates are
// pushed around by another, slower noise first — which is what stops fbm
// hills lining up in rows and makes the ridges wander like real ones.

// The raft, and the beach you swim to from it: cliffs are kept away from here
// so the first landing is always sand.
const LANDING_CLEAR = [320, 520];         // metres from the raft: no cliffs, then cliffs allowed
const MOUNTAIN_HEIGHT = 330;              // the tallest peaks
const TERRACE = 16;                       // riser height of the stepped escarpments
// No snow and no treeline: in the Late Cretaceous greenhouse, with no frost
// in the lowlands, the treeline would have stood 2.5–4 km up — ten times
// these peaks. TREELINE is where the lowland forest gives way to the stunted,
// dripping cloud forest of the tops: araucarias, tree ferns, moss; bare rock
// only where it is too steep to hold soil.
export const TREELINE = 185;

/** A mountain range, not a field of bumps: ridged multifractal, each octave's
 *  ridges sharpened where the octave above was already high. */
function ridged(x, z) {
  let sum = 0, amp = 0.5, freq = 1, weight = 1, norm = 0;
  for (let i = 0; i < 5; i++) {
    let n = 1 - Math.abs(noise2(x * freq, z * freq) * 2 - 1);
    n *= n;
    n *= weight;
    weight = Math.min(1, n * 1.8);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

const _land = { h: 0, m: 0, plain: 0, mountain: 0, cliff: 0, mesa: 0, river: 1e9, edge: 1e9, water: 0, bank: 0, lake: null };

/**
 * Everything the land knows about one spot: its height and the masks it was
 * built from, so the scatter and the ground colour can ask what kind of
 * country this is instead of re-deriving it. Returns a shared object — copy
 * what you need before calling again.
 */
export function landAt(x, z, out = _land) {
  const m = coastDistance(x, z);
  out.m = m;
  out.plain = out.mountain = out.cliff = out.mesa = out.bank = 0;
  out.river = 1e9;
  out.edge = 1e9;
  out.water = 0;
  out.lake = null;

  // One surface, two halves: sea bed below the waterline, land above it.
  let h;
  if (m < 0) {
    h = seabedAt(x, z, -m);
    out.cliff = seaCliff(x, z);
    // Under a sea cliff there is no beach: the shallows are rock and deeper.
    h -= out.cliff * smooth(0, -30, m) * 5;
  } else {
    // A warped domain for everything inland.
    const wx = x + (fbm(x * 0.0021 + 7.1, z * 0.0021 - 3.3, 3) - 0.5) * 190;
    const wz = z + (fbm(x * 0.0021 - 11.7, z * 0.0021 + 5.9, 3) - 0.5) * 190;

    // The coast: a beach and a low plain behind it, or a cliff straight up.
    const cliff = out.cliff = seaCliff(x, z);
    // A sand beach is gentle: a foreshore of 3–5° (tanβ ~0.06 for medium
    // sand), then the back of the beach rising to the dunes and the land.
    const beach = smooth(0, 60, m) * 3 + smooth(40, 120, m) * 5;
    // (The cliff's height varies along the coast, over a few hundred metres —
    // not in 100 m lumps, which on the land behind it were a field of 40° bumps.)
    const cliffTop = smooth(0, 7, m) * (24 + fbm(wx * 0.0035, wz * 0.0035, 2) * 26) + smooth(7, 60, m) * 6;
    h = beach + (cliffTop - beach) * cliff;

    // Upland: the ground climbs gently the further in you go.
    h += smooth(30, 700, m) * 34;

    const mountain = out.mountain = smooth(280, 600, m) *
      smooth(0.3, 0.5, fbm(wx * 0.0011 + 3.7, wz * 0.0011 + 8.1, 2) + smooth(380, 760, m) * 0.5);
    // (Its edge a long, gentle transition: the hills die away onto the plain
    // rather than dropping onto it down a scarp.)
    const plain = out.plain = smooth(0.44, 0.7, fbm(wx * 0.0017 + 33.1, wz * 0.0017 - 12.4, 3)) *
      smooth(70, 170, m) * (1 - mountain);

    // Rolling hills, flattened out on the plains to a gentle swell.
    // A plain is flat — under a couple of degrees — with no more than a
    // metre or so of swell across it.
    const hills = (fbm(wx * 0.0046, wz * 0.0046, 4) - 0.36) * 74 * smooth(12, 170, m);
    h += hills * (1 - plain * 0.985) + plain * (fbm(wx * 0.011, wz * 0.011, 2) - 0.5) * 1.0;

    // The range: ridges and peaks, with foothills running down from them.
    if (mountain > 0.001) {
      // (Broad enough that its slopes come out at the ~35° a warm, wet range
      // wears to — landslides cap it there — not 40° and more.)
      const r = ridged(wx * 0.0019, wz * 0.0019);
      h += mountain * (Math.pow(r, 1.35) * MOUNTAIN_HEIGHT + fbm(wx * 0.009, wz * 0.009, 3) * 30);
    }

    // Escarpments: in places the hills are harder rock, which weathers into
    // flat benches and cliff risers instead of smooth slopes.
    const mesa = out.mesa = smooth(0.6, 0.7, fbm(wx * 0.0023 - 51.2, wz * 0.0023 + 20.6, 2)) *
      smooth(90, 200, m) * (1 - mountain * 0.8) * (1 - plain);
    // Only above the first bench: stepping the low ground as well would
    // flatten it to the waterline and leave ponds behind the beach.
    // Each step is a bench, nearly level, then a talus slope at ~33° up to
    // a cap cliff of hard sandstone at ~70°: the profile of a scarp in
    // horizontal beds, not a ramp with a sharp top edge.
    if (mesa > 0.001 && h > TERRACE) {
      const f = h / TERRACE, k = Math.floor(f), r = f - k;
      const step = r < 0.8 ? r * 0.025 : r < 0.955 ? 0.02 + 0.44 * Math.pow((r - 0.8) / 0.155, 1.4) : 0.46 + 0.54 * (r - 0.955) / 0.045;
      const stepped = (k + step) * TERRACE;
      h += (stepped - h) * mesa * smooth(TERRACE, TERRACE * 1.6, h);
    }

    // Nothing inland drops below the sea: a hollow there would fill with the
    // ocean itself, waves and all. It bottoms out as a dry pan instead.
    // Pulled up softly rather than flattened, so a hollow keeps its shape.
    const floorH = 2 + smooth(40, 200, m) * 5;
    if (h < floorH) {
      const lifted = floorH - 5 * (1 - Math.exp(-(floorH - h) / 5));
      h += (lifted - h) * smooth(10, 45, m);
    }

    h = carveRivers(x, z, h, m, out);
  }

  // Surf-zone detail straddles the waterline, so beach and shallows are one
  // continuous surface rather than two that meet at a seam. Only there:
  // inland, a swell that size is a field of pits and makes the plains steep.
  // (Not on a river's valley floor either: that is as the river laid it.)
  const surf = smooth(-10, 18, m) * (1 - smooth(30, 90, m));
  const soft = smooth(30, 90, m) * (0.3 - out.plain * 0.22);            // the gentle swell of the country inland
  h += (surf + soft) * (1 - out.cliff) * (fbm(x * 0.027, z * 0.027, 3) - 0.5) * 8 * (1 - out.bank * 0.92);  // undulation
  // Fine detail, by landform: rough on the rock, smooth on soil, barely any on
  // the plains. (Less in a river's bed, or its bumps come up through the water.)
  const fine = smooth(-6, 12, m) * (0.45 + out.mountain * 0.55 - out.plain * 0.35);
  h += fine * (fbm(x * 0.11, z * 0.11, 2) - 0.5) * 1.6 * (0.2 + 0.8 * smooth(0, 4, out.edge));  // surface detail
  // Lakes last, after the detail, so how deep they are is exactly as dished.
  if (m >= 0 && LAKES.length) h = carveLakes(x, z, h, out);
  // And no river deeper than wading either — the detail above can dig a
  // hole in its bed, and you would walk along it with your head under.
  if (out.water > 0 && h < out.water - WADING) h = out.water - WADING;
  out.h = h;
  return out;
}

export function heightAt(x, z) {
  return landAt(x, z).h;
}

/** 0..1: how much of a sea cliff this stretch of coast is. Never near the raft. */
function seaCliff(x, z) {
  const away = smooth(LANDING_CLEAR[0], LANDING_CLEAR[1], Math.hypot(x, z));
  if (away <= 0) return 0;
  return away * smooth(0.52, 0.62, fbm(x * 0.0024 + 70.3, z * 0.0024 - 9.8, 3));
}

// ── rivers ───────────────────────────────────────────────────────────────────
// Each river is a curve in polar coordinates round the continent's centre — a
// bearing that wanders with distance out — from a spring in the range to a
// mouth on the coast. Distance to it is the bearing difference times the
// radius, corrected for how oblique the curve runs there; cheap enough to
// ask on every call to heightAt.
//
// The water level along it is worked out once, from the ground it crosses: a
// little under the land, never rising downstream, so the river always runs
// to the sea. Near the channel the land is set to that level — carved down
// through ridges into gorges, and banked up across hollows into a flood
// plain — then blends back into the country either side.
//
// Sized and shaped as rivers are (Leopold & Maddock 1953; Leopold & Wolman
// 1960; Langbein & Leopold 1966):
//   width    grows downstream with the land it drains — as the area to the
//            ~0.4, and the area as the length to the ~1.7 (Hack's law) — so
//            quickly at first and then slowly; a catchment of a few square
//            kilometres in a wet climate makes a river ten-odd metres wide at
//            the mouth, not twenty. Depth grows too, more slowly.
//   steps    a river this short, off a range this high, falls ~20% most of
//            the way: a mountain stream, not a lowland one. So it does not
//            meander (that takes under ~1.5%: Leopold & Wolman 1957) and runs
//            straight in its valley, as a staircase of pools (stepRiver).
const THETA_RAFT = Math.atan2(-WORLD.cz, -WORLD.cx);   // bearing of the raft from the centre
export const RIVERS = [
  // Mouth a few hundred metres up the coast from the landing beach.
  { bearing: THETA_RAFT + 0.34, wander: [0.14, 0.0062, 1.3, 0.05, 0.017, 4.1],
    from: 0.3, width: [2.6, 11], depth: [0.55, 1.2] },
  // And one on the far side of the range.
  { bearing: THETA_RAFT + 2.55, wander: [0.18, 0.0055, 0.4, 0.06, 0.014, 2.2],
    from: 0.28, width: [2.6, 12], depth: [0.55, 1.25] },
];
const RIVER_STEP = 4;                                  // metres between water-level samples
// The lakes and falls on them (placeWater, below): empty while the rivers are surveyed.
export const LAKES = [];
export const FALLS = [];
const WADING = 1.3;              // m: no river, lake, pool or tarn is deeper than this anywhere

function riverBearing(rv, r) {
  const [a1, k1, p1, a2, k2, p2] = rv.wander;
  return rv.bearing + a1 * Math.sin(r * k1 + p1) + a2 * Math.sin(r * k2 + p2);
}
function riverTurn(rv, r) {                            // d(bearing)/dr
  const [a1, k1, p1, a2, k2, p2] = rv.wander;
  return a1 * k1 * Math.cos(r * k1 + p1) + a2 * k2 * Math.cos(r * k2 + p2);
}

/** Water level, width and whether the river is running at radius r. */
function riverAt(rv, r) {
  const t = (r - rv.r0) / RIVER_STEP;
  if (t < 0 || t >= rv.level.length - 1) return null;
  const k = Math.floor(t);
  // Over the lip of a fall the water drops in half a metre, not four: a
  // cliff; over a step between two pools, in a metre and a half.
  const f = k === rv.fallK ? smooth(0.4, 0.52, t - k) : rv.step && rv.step[k] ? smooth(0.3, 0.7, t - k) : t - k;
  const g = t - k, bank = rv.bank ? rv.bank[k] * (1 - g) + rv.bank[k + 1] * g : null;
  const along = Math.max(0, (r - rv.r0) / (rv.r1 - rv.r0));
  return {
    level: rv.level[k] * (1 - f) + rv.level[k + 1] * f,
    // The flood plain's level: the smooth fall of the valley, which the
    // pools of a stepped reach are sunk into.
    bank,
    // Width as the area drained to the ~0.42 (the area as the length to ~1.7); depth to the ~0.25.
    width: rv.width[0] + (rv.width[1] - rv.width[0]) * Math.pow(along, 0.7),
    depth: rv.depth[0] + (rv.depth[1] - rv.depth[0]) * Math.pow(along, 0.4),
    // A spring, not a pipe: the channel opens out over its first stretch.
    open: smooth(0, 70, r - rv.r0),
  };
}

function carveRivers(x, z, h, m, out) {
  if (m < -6) return h;
  const dx = x - WORLD.cx, dz = z - WORLD.cz;
  const r = Math.hypot(dx, dz), bearing = Math.atan2(dz, dx);
  for (const rv of RIVERS) {
    if (!rv.level || r < rv.r0 - 150 || r > rv.r1 + 60) continue;
    let db = bearing - riverBearing(rv, r);
    db = Math.atan2(Math.sin(db), Math.cos(db));
    const s = r * riverTurn(rv, r);
    const d = Math.abs(db) * r / Math.sqrt(1 + s * s);
    const at = riverAt(rv, Math.min(Math.max(r, rv.r0), rv.r1 - 0.01));
    if (!at) continue;
    const half = at.width * 0.5 * at.open;
    let W = at.level;
    // At a fall the drop is sheer only across the river itself: to either
    // side the valley comes down a steep slope instead, so the cliff is a
    // notch the water pours through, not a wall across the country.
    if (rv.fallK >= 0) {
      const rl = rv.r0 + (rv.fallK + 0.46) * RIVER_STEP;
      // (From the lip itself, not before it: beside the fall the banks stand
      // at the water's height right to the brink — a ledge of rock either
      // side of the curtain — and then fall away, a talus slope at ~36°.)
      if (r > rl - 1 && r < rl + 30) {
        const top = rv.level[rv.fallK], bottom = rv.level[rv.fallK + 1];
        const ramp = top + (bottom - top) * smooth(rl, rl + 30, r);
        W += (ramp - W) * smooth(half + 3, half + 14, d);
      }
    }
    // Deeper cuts need wider valley walls, or they would be sheer everywhere.
    const plainW = 6 + at.width * 1.4;
    // A stepped reach: its pools are sunk below the valley floor, their
    // banks coming up to it.
    const lift = at.bank !== null ? Math.max(0, at.bank - W) : 0;
    const wall = 26 + Math.min(Math.max(0, h - W), 300) * 1.05;
    if (d > half + plainW + wall) continue;
    let floor;
    if (d < half) floor = W - at.depth * at.open * (1 - (d / half) ** 2);
    else floor = W + lift * smooth(half, half + 1.5 + lift * 1.5, d) + 0.15 + smooth(half, half + 4, d) * 0.55 + smooth(half + 4, half + plainW, d) * 0.5;
    // Above the spring the valley closes up into the hillside.
    const k = smooth(half + plainW, half + plainW + wall, d);
    const blend = 1 - (1 - k) * smooth(rv.r0 - 150, rv.r0, r);
    const carved = floor + (h - floor) * blend;
    if (d < out.river) {
      out.river = d;
      out.edge = d - half;            // from the water's edge: negative in the river
      out.water = d < half ? W : 0;
      out.bank = 1 - blend;
    }
    h = carved;
  }
  return h;
}

/**
 * Work out each river's water level from the land it crosses. Runs once, at
 * load, against the land without rivers.
 */
function surveyRivers() {
  const probe = {};
  for (const rv of RIVERS) { rv.level = rv.bank = rv.step = null; rv.fallK = -1; }
  for (const rv of RIVERS) {
    const R = WORLD.radius;
    rv.r0 = R * rv.from;
    // Walk out to the coast.
    const ground = [];
    let r = rv.r0;
    for (; r < R * 1.6; r += RIVER_STEP) {
      const b = riverBearing(rv, r);
      const x = WORLD.cx + Math.cos(b) * r, z = WORLD.cz + Math.sin(b) * r;
      const g = landAt(x, z, probe);
      ground.push(g.h);
      if (g.m < -4) break;
    }
    rv.r1 = r;
    // From the mouth upstream: a little under the ground, never falling as
    // it goes up, so downstream it never climbs. Then smoothed, so a single
    // knoll does not put a step in the river.
    const n = ground.length, level = new Array(n);
    let lo = 0.25;
    for (let i = n - 1; i >= 0; i--) {
      lo = Math.max(lo, Math.min(ground[i] - 2.2, lo + 0.9));
      level[i] = lo;
    }
    for (let pass = 0; pass < 6; pass++) {
      for (let i = n - 2; i > 0; i--) level[i] = (level[i - 1] + level[i] * 2 + level[i + 1]) / 4;
      for (let i = n - 2; i >= 0; i--) level[i] = Math.max(level[i], level[i + 1]);
    }
    rv.level = level;
  }
}

surveyRivers();

// ── lakes and falls ──────────────────────────────────────────────────────────
// Where a river comes down off the range fastest, it does not run down a
// ramp: it goes over a lip and falls, into a pool it has dug at the foot. The
// stretch above the lip is flattened into a lake — a tarn in the hills that
// spills over the falls. And where the first river idles across the plain, it
// widens into a lake of its own. All of them sit on the rivers, at the level
// the survey found, so every one has a way in and a way out; all of them are
// wading water — chest deep at most, as the rivers are.
//
// Each lake is an ellipse along the river, its shore wobbled; inside it the
// land is dished out below the water, round it the ground comes up to a low
// bank and blends back into the country, like a river's valley.
const LAKE_DEPTH = 1.2;
const FALL_MAX = 22;             // m: the tallest drop

/** Where river `rv` is at radius r: a point, its level, width and the way downstream. */
function courseAt(rv, r) {
  const b = riverBearing(rv, r), at = riverAt(rv, r);
  const x = WORLD.cx + Math.cos(b) * r, z = WORLD.cz + Math.sin(b) * r;
  const b2 = riverBearing(rv, r + 2);
  const x2 = WORLD.cx + Math.cos(b2) * (r + 2), z2 = WORLD.cz + Math.sin(b2) * (r + 2);
  const len = Math.hypot(x2 - x, z2 - z) || 1;
  return { x, z, level: at?.level ?? 0, width: at ? at.width * at.open : 4, dx: (x2 - x) / len, dz: (z2 - z) / len };
}

function addLake(kind, c, a, b, level, seed, river) {
  const k = Math.atan2(c.dz, c.dx);
  const lake = { kind, river, x: c.x, z: c.z, a, b, level, depth: LAKE_DEPTH, cos: Math.cos(k), sin: Math.sin(k),
                 s1: seed * 1.7, s2: seed * 2.9 + 1, s3: seed * 4.3 + 2 };
  lake.reach = Math.max(a, b) * 1.25 + 40;
  LAKES.push(lake);
  return lake;
}

/** A lake's shore, as a distance from its middle, at angle `th` in its own frame. */
export function lakeShore(L, th) {
  const c = Math.cos(th), s = Math.sin(th);
  const e = 1 / Math.sqrt((c / L.a) ** 2 + (s / L.b) ** 2);
  // (A plunge pool's back is the foot of the cliff: straight.)
  if (L.kind === 'pool') return L.back && c < 0 ? Math.min(e, L.back / -c) : e;
  return e * (1 + 0.12 * Math.sin(3 * th + L.s1) + 0.07 * Math.sin(5 * th + L.s2) + 0.04 * Math.sin(9 * th + L.s3));
}

function placeWater() {
  LAKES.length = FALLS.length = 0;
  RIVERS.forEach((rv, ri) => {
    const lv = rv.level, n = lv.length, rAt = i => rv.r0 + i * RIVER_STEP;
    rv.fallK = -1;
    // The fall: the steepest hundred metres, clear of the spring and the plain.
    const span = 24;
    let best = -1, drop = 0;
    for (let i = 0; i + span < n; i++) {
      const along = i / n;
      if (along < 0.1 || along > 0.7 || rAt(i) - rv.r0 < 90) continue;
      const d = lv[i] - lv[i + span];
      if (d > drop) { drop = d; best = i; }
    }
    if (best >= 0 && drop >= 7) {
      const i = best, top = lv[i], H = Math.min(FALL_MAX, drop), bottom = top - H;
      rv.fallK = i;
      // Below the lip: the gorge it has cut, at the foot of the drop.
      for (let k = i + 1; k < n && lv[k] > bottom; k++) lv[k] = bottom;
      const lip = courseAt(rv, rAt(i) + RIVER_STEP * 0.46);
      // The cliff runs round the continent at the lip's radius, so it faces
      // straight out from the middle — whichever way the river crosses it.
      const rl = Math.hypot(lip.x - WORLD.cx, lip.z - WORLD.cz);
      const face = { dx: (lip.x - WORLD.cx) / rl, dz: (lip.z - WORLD.cz) / rl };
      // The pool it falls into: dug by the drop, as wide as about half its
      // height (Scheingross & Lamb 2016), and wider than the river.
      const pr = Math.min(12, Math.max(5, H * 0.5, 3 + lip.width * 0.45));
      for (let k = i + 1; k <= i + Math.ceil((pr * 2 + 3) / RIVER_STEP) && k < n; k++) lv[k] = bottom;
      // How wide the curtain is along the cliff: the channel, crossed at an angle.
      const across = lip.width / Math.max(0.5, Math.abs(lip.dx * face.dx + lip.dz * face.dz));
      FALLS.push({ river: ri, x: lip.x, z: lip.z, dx: face.dx, dz: face.dz, flow: { x: lip.dx, z: lip.dz },
                   top, bottom, height: H, width: Math.min(across, lip.width * 1.8 + 1) });
      // Starting just past the foot of the cliff, so it never eats into the lip.
      const pc = courseAt(rv, rAt(i) + RIVER_STEP * 0.46 + pr + 0.4);
      // The cliff is the fall's: the pool's banks leave everything above the lip alone.
      const pool = addLake('pool', pc, pr, pr, bottom, ri * 7 + 3, ri);
      pool.cut = { x: lip.x, z: lip.z, dx: face.dx, dz: face.dz, side: 1 };
      FALLS.at(-1).pool = pool;
      // And above it, a tarn: flat water right up to the lip.
      let j = i;
      while (j > 0 && lv[j - 1] - top < 3 && i - j < 30) j--;
      const a = Math.min(60, Math.max(14, (i - j) * RIVER_STEP / 2 + 4));
      const from = Math.max(0, i - Math.ceil(2 * a / RIVER_STEP));
      for (let k = from; k <= i; k++) lv[k] = top;
      cascadeInto(lv, from, top);
      // Its shore a metre short of the lip, whichever way it wobbles; the
      // river carries the water over the last of it.
      const tarn = addLake('tarn', courseAt(rv, rAt(i) - a), a, Math.min(a * 0.8, Math.max(10, lip.width * 1.6)), top, ri * 7 + 1, ri);
      const reachDown = lakeShore(tarn, 0);
      const tc = courseAt(rv, rAt(i) + RIVER_STEP * 0.46 - 1 - reachDown);
      // …and the tarn's leave everything below it.
      Object.assign(tarn, { x: tc.x, z: tc.z, outlet: true, fall: FALLS.at(-1), cut: { x: lip.x, z: lip.z, dx: face.dx, dz: face.dz, side: -1 } });
      const k = Math.atan2(tc.dz, tc.dx);
      tarn.cos = Math.cos(k); tarn.sin = Math.sin(k);
    }
    // Lower down, where the first river falls least over sixty-odd metres,
    // it is dammed into a lake: level at its lowest, the stretch above
    // coming in over a short run of rapids.
    if (ri === 0) {
      const run = 16;
      let bi = -1, least = Infinity;
      const after = rv.fallK >= 0 ? rv.fallK + 30 : 0;
      for (let i = Math.max(after, Math.floor(n * 0.45)); i + run < n * 0.9; i++) {
        const d = lv[i] - lv[i + run];
        if (d < least) { least = d; bi = i; }
      }
      if (bi >= 0 && least < 7) {
        const e = bi + run, L = lv[e];
        for (let k = bi; k <= e; k++) lv[k] = L;
        cascadeInto(lv, bi, L);
        const a = run * RIVER_STEP / 2 * 0.95;
        const c = courseAt(rv, rAt(bi) + run * RIVER_STEP / 2);
        const lake = addLake('lake', c, a, Math.min(a * 0.75, Math.max(18, c.width * 2.4)), L, 11, ri);
        // Its ends inside the levelled stretch, however its shore wobbles —
        // so the river leaves it at its own level, not from a ledge.
        lake.a /= Math.max(lakeShore(lake, 0), lakeShore(lake, Math.PI)) / lake.a;
      }
    }
    stepRiver(rv);
  });
  for (const f of FALLS) {
    // The pool under it: right in against the foot of the cliff, its
    // back straight along it and wider than the curtain, so the water lands
    // in water all the way across — not on a ledge of rock at the foot.
    const P = f.pool;
    if (P) {
      const c = P.a * 0.75;
      P.x = f.x + f.dx * c; P.z = f.z + f.dz * c;
      P.cos = f.dx; P.sin = f.dz;
      // (Its straight back runs ±0.66 b; the curtain spreads ~12% as it falls.)
      P.b = Math.max(P.a, (f.width / 2 * 1.15 + 1.5) / 0.66);
      P.back = c - 0.1;
      P.reach = Math.max(P.a, P.b) * 1.25 + 40;
    }
  }
}

/**
 * Flat water cut into a steep stream would leave the stream coming into it
 * off a ledge metres high. It comes in down a cascade instead: the reach
 * above `from` regraded down to the still water's level, as steep as it must
 * be to meet the stream again within sixty-odd metres (stepRiver then makes
 * it steps).
 */
function cascadeInto(lv, from, level) {
  if (from < 2 || lv[from - 1] - level < 1.5) return;
  let M = 6;
  while (M < 16 && from - M > 0 && (lv[from - M] - level) / (M * RIVER_STEP) > 0.3) M++;
  const base = lv[Math.max(0, from - M)];
  for (let m = 1; m < M && from - m >= 0; m++) lv[from - m] = Math.min(lv[from - m], level + (base - level) * m / M);
}

/**
 * A steep stream is not a ramp of water. Over ~6% it goes as a staircase:
 * pools, each held up by a step of boulders or rock at its lip, the water
 * dropping over that into the next (Montgomery & Buffington 1997: step-pool
 * and cascade reaches). The steps are one to two channel widths apart,
 * each as high as the river would fall over that distance. The pools sit at
 * the foot of the smooth fall, never above it, so the valley floor is left
 * as it was and the pools are cut down into it.
 */
function stepRiver(rv) {
  const lv = rv.level, n = lv.length;
  rv.bank = Float32Array.from(lv);
  rv.step = new Uint8Array(n);
  let i = 0;
  while (i < n - 3) {
    const along = i / n;
    const width = rv.width[0] + (rv.width[1] - rv.width[0]) * Math.pow(along, 0.7);
    // One to two widths between steps — closer where it is steeper, so no
    // step is much over two and a half metres (a cascade, at the steepest).
    const s2 = (lv[i] - lv[Math.min(n - 1, i + 2)]) / (2 * RIVER_STEP);
    const len = Math.min(width * 1.7, s2 > 0 ? 2.5 / s2 : Infinity);
    const e = Math.min(n - 1, i + Math.max(1, Math.min(4, Math.round(len / RIVER_STEP))));
    const slope = (lv[i] - lv[e]) / ((e - i) * RIVER_STEP);
    const nearFall = rv.fallK >= 0 && i > rv.fallK - 6 && i < rv.fallK + 10;
    let flat = false;
    for (let k = i; k < e; k++) if (lv[k] === lv[k + 1]) flat = true;     // a lake, a tarn, a pool: already still
    if (slope > 0.065 && !nearFall && !flat) {
      // A step at i, down to a pool that runs to e at the level the river had there.
      for (let k = i + 1; k <= e; k++) lv[k] = lv[e];
      rv.step[i] = 1;
      i = e;
    } else i++;
  }
}
placeWater();

function carveLakes(x, z, h, out) {
  for (const L of LAKES) {
    const dx = x - L.x, dz = z - L.z;
    if (Math.abs(dx) > L.reach || Math.abs(dz) > L.reach) continue;
    // Across a fall's lip, a pool's banks fade out upstream and a tarn's downstream.
    const cut = L.cut ? smooth(-1, 7, ((x - L.cut.x) * L.cut.dx + (z - L.cut.z) * L.cut.dz) * L.cut.side) : 1;
    if (cut <= 0) continue;
    const u = dx * L.cos + dz * L.sin, v = -dx * L.sin + dz * L.cos;
    const rho = Math.hypot(u, v), R = lakeShore(L, Math.atan2(v, u));
    const d = rho - R, W = L.level;
    // A lake above a fall comes to the lip only where the curtain is: to
    // either side the rock of the lip stands clear of it, or its water would
    // reach the brink with nothing to fall over it.
    const F = L.fall;
    const ledge = F ? THREE.MathUtils.smoothstep(Math.abs((x - F.x) * -F.dz + (z - F.z) * F.dx), F.width / 2 - 0.5, F.width / 2 + 1) *
                      THREE.MathUtils.smoothstep((x - L.cut.x) * L.cut.dx + (z - L.cut.z) * L.cut.dz, -4, -1.5) : 0;
    if (ledge > 0.5 && d < 0) continue;
    let carved;
    if (d < 0) {
      // A shelf round the edge, then down to the deep middle — never deeper
      // than wading, whatever hollow was here. Where the river comes in it
      // drops what it carries: a delta, a shallow flat of sand out into the lake.
      const delta = L.kind === 'lake' || L.kind === 'tarn' ? 1 - 0.75 * smooth(-0.3, -0.85, u / L.a) : 1;
      const floor = W - 0.05 - L.depth * delta * smooth(0, 0.45, 1 - rho / R);
      carved = Math.max(Math.min(h, floor), W - WADING);
      carved += (h - carved) * ledge * 2;
    } else {
      const floor = W + 0.15 + smooth(0, 3, d) * 0.45;
      const wall = 14 + Math.min(Math.abs(h - W), 200) * 1.0;
      const k = smooth(2, 2 + wall, d);
      if (k >= 1) continue;
      carved = floor + (h - floor) * k;
      // A river running in or out keeps its channel through the bank.
      if (out.water > 0 && h < carved) carved = h;
      carved = h + (carved - h) * cut;
    }
    h = carved;
    if (d < out.edge) {
      out.edge = d;
      out.river = Math.min(out.river, Math.max(0, d) + 2);
      out.bank = Math.max(out.bank, 1 - smooth(2, 16, d));
    }
    if (d < 0) { out.water = W; out.lake = L; }
  }
  return h;
}

/**
 * Fresh water at (x, z): { level, depth, kind } — a river, a lake, a tarn or
 * a plunge pool — or null on dry land and in the sea.
 */
export function freshWaterAt(x, z) {
  const L = landAt(x, z);
  // (Deeper than any of it is wading: that is the face of a fall, where the
  // water is in the air.)
  if (!(L.water > 0) || L.water <= L.h || L.water - L.h > WADING + 0.6) return null;
  return { level: L.water, depth: L.water - L.h, kind: L.lake ? L.lake.kind : 'river' };
}

/** Points down the middle of each river, for the water surface. */
export function riverCourse(rv, step = 6) {
  const pts = [];
  for (let r = rv.r0; r < rv.r1; r += step) {
    const b = riverBearing(rv, r);
    const at = riverAt(rv, r);
    if (!at) break;
    pts.push({ x: WORLD.cx + Math.cos(b) * r, z: WORLD.cz + Math.sin(b) * r,
               level: at.level, width: at.width * at.open });
  }
  return pts;
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

/**
 * The water surface of a river: a ribbon down its course at the surveyed
 * level, wider than the channel so its edges tuck under the banks. `keep(x,
 * z)`, if given, limits it to part of the course.
 */
export function riverGeometry(rv, keep = null) {
  // Not where a lake has the water, and broken over a fall (waterfall.js
  // draws that): a ribbon for each run between.
  const inLake = p => LAKES.some(L => {
    const dx = p.x - L.x, dz = p.z - L.z;
    const u = dx * L.cos + dz * L.sin, v = -dx * L.sin + dz * L.cos;
    return Math.hypot(u, v) < lakeShore(L, Math.atan2(v, u)) - 1.5;
  });
  const falls = FALLS.filter(f => RIVERS[f.river] === rv);
  // (Nor partway down a fall: a sample that lands in the drop is the
  // curtain's water, and joined to the pool it would be a slab of it lying
  // at the foot of the curtain.)
  const midFall = p => falls.some(f => p.level < f.top - 0.3 && p.level > f.bottom + 0.3 && Math.hypot(p.x - f.x, p.z - f.z) < 25);
  const pts = riverCourse(rv, 2).map(p => ((keep && !keep(p.x, p.z)) || inLake(p) || midFall(p) ? null : p));
  if (pts.filter(Boolean).length < 2) return null;
  const pos = [], uv = [], idx = [];
  // Above a fall the water stops at the lip, square to the cliff: the
  // ribbon's end is square to the river, which crosses the cliff at a slant,
  // so one corner of it would stick out over the drop.
  const atLip = (x, y, z, fwd = null) => {
    for (const f of falls) {
      if (fwd && y >= f.top - 1 && Math.hypot(x - f.x, z - f.z) < 25) {
        // The last of it before the drop: carried on, the way the river
        // runs, right to the lip — at a slant, square to the river, it would
        // stop short of the lip on one side and leave the bed there bare.
        const gap = -0.2 - ((x - f.x) * f.dx + (z - f.z) * f.dz), k = fwd.x * f.dx + fwd.z * f.dz;
        if (gap > 0 && gap < 8 && k > 0.2) { x += fwd.x * gap / k; z += fwd.z * gap / k; }
      }
      if (y < f.top - 1 || Math.hypot(x - f.x, z - f.z) > 25) continue;
      const past = (x - f.x) * f.dx + (z - f.z) * f.dz + 0.2;
      if (past > 0) { x -= f.dx * past; z -= f.dz * past; }
    }
    pos.push(x, y, z);
  };
  let along = 0, n = 0, prev = null;
  pts.forEach((p, k) => {
    if (!p) { prev = null; return; }
    const q = pts[k + 1] || p, o = pts[k - 1] || p;
    const dx = q.x - o.x, dz = q.z - o.z, len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len, sz = dx / len;
    if (prev) along += Math.hypot(p.x - prev.x, p.z - prev.z);
    // Wider than the channel, so its edges tuck under the banks — except
    // coming up to a lip, where the banks fall away into the notch and the
    // tuck would hang out over them.
    let tuck = 2.2;
    for (const f of falls) {
      const before = -((p.x - f.x) * f.dx + (p.z - f.z) * f.dz);
      if (p.level > f.top - 1 && Math.hypot(p.x - f.x, p.z - f.z) < 25) tuck = Math.min(tuck, -0.3 + 2.5 * smooth(2, 12, before));
    }
    const w = p.width / 2 + tuck;
    const last = !pts[k + 1] ? { x: dx / len, z: dz / len } : null;
    atLip(p.x - sx * w, p.level - 0.02, p.z - sz * w, last);
    atLip(p.x + sx * w, p.level - 0.02, p.z + sz * w, last);
    uv.push(0, along / 7, w * 2 / 7, along / 7);
    if (prev && prev.level - p.level < 6) { const a = (n - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    prev = p;
    n++;
  });
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

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
  // Open ground as it was before there was grass to make a lawn of it: ferns,
  // spike-moss and moss over dark soil (flora.js: the low-fern cover).
  grass: new THREE.Color(0x4f6e35),
  dry:   new THREE.Color(0x747a44),
  straw: new THREE.Color(0x8b7350),   // the plains in the dry season: fern fronds dying back russet
  litter:new THREE.Color(0x4a4128),   // forest floor: needles and rot
  moss:  new THREE.Color(0x3d5a26),
  mud:   new THREE.Color(0x5a4a34),   // river banks
  pebble:new THREE.Color(0x8a8272),
  soil:  new THREE.Color(0x4a3a28),
  rock:  new THREE.Color(0x6e6962),
  sandstone: new THREE.Color(0x8f6f55), // the escarpments
  scree: new THREE.Color(0x8b857b),
};

/**
 * @param L       landAt() for this spot
 * @param forest  forestAt() for this spot
 */
function groundColour(h, slope, wet, jitter, L, forest, out) {
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
    out.lerp(C.rock, L.cliff * smooth(-2, -12, h) * 0.6);
    return out.multiplyScalar(0.88 + jitter * 0.24);
  }
  // Under the cliffs the beach is cobbles and shingle, worn from the cliff; sand is for the bays.
  if (h < 2.8 && L.m < 90 && L.bank < 0.3) return out.copy(C.sand).lerp(C.pebble, L.cliff * 0.85).lerp(C.rock, L.cliff * smooth(0.3, 0.6, slope));

  // The tops: moss and low ferns in the cloud, rock and scree where it is steep.
  if (h > TREELINE - 25) {
    const bare = smooth(0.34, 0.58, slope);
    out.copy(jitter > 0.5 ? C.moss : C.grass).lerp(C.litter, forest * 0.5);
    out.lerp(C.soil, smooth(0.75, 0.95, jitter) * 0.3 * (1 - forest));
    out.lerp(C.rock, bare).lerp(C.scree, bare * jitter * 0.5);
    return out.multiplyScalar(0.9 + jitter * 0.14);
  }

  out.copy(C.grass).lerp(C.lush, wet).lerp(C.dry, (1 - wet) * 0.75);
  out.lerp(C.straw, L.plain * (0.55 + jitter * 0.3));
  // Fern and moss cover is patchy, not a sward: bare soil shows between.
  out.lerp(C.soil, smooth(0.72, 0.95, jitter) * 0.35 * (1 - forest));
  // Under the canopy the floor is needles, rot and moss, and dark.
  out.lerp(jitter > 0.55 ? C.moss : C.litter, forest * 0.62);
  out.lerp(C.sand, smooth(4.6, 2.8, h) * 0.8 * (1 - L.bank));     // sand creeps up the beach
  // River banks: mud at the water, pebbles in the shallows of the valley.
  out.lerp(jitter > 0.6 ? C.pebble : C.mud, L.bank * smooth(40, 0, L.river) * 0.85);
  if (slope > 0.32) out.lerp(C.soil, smooth(0.32, 0.6, slope));   // bare earth on banks
  if (slope > 0.5) out.lerp(L.mesa > 0.3 ? C.sandstone : C.rock, smooth(0.5, 0.75, slope));
  return out.multiplyScalar((0.92 + jitter * 0.16) * (1 - forest * 0.22));
}

/** 0 dry .. 1 lush, wetter along the rivers. */
function wetAt(x, z, L) {
  return Math.min(1, moistureAt(x, z) + 0.35 * smooth(90, 10, L.river));
}

/**
 * How wooded the country is here, 0..1. Forest needs water and shelter: it
 * thins out onto the beach, stops at the treeline, gives way to grass on the
 * plains and to bare rock on the cliffs, and opens into clearings.
 */
export function forestAt(x, z, L, wet, slope) {
  if (L.h < 1.5) return 0;
  const clearing = smooth(0.3, 0.44, fbm(x * 0.017 + 5.3, z * 0.017 - 7.1, 2));
  return smooth(0.28, 0.56, wet) * (1 - L.plain * 0.94) * (1 - 0.45 * smooth(TREELINE - 45, TREELINE + 5, L.h)) *
         smooth(6, 30, L.m) * (1 - smooth(0.42, 0.62, slope)) * clearing * (1 - L.bank * 0.85);
}

// ── chunks ───────────────────────────────────────────────────────────────────
const chunkKey = (i, j) => `${i},${j}`;

// One integer per cell of the reef obstacle field, so looking one up costs no
// string allocation. The world is ±450m of loaded chunks, nowhere near the
// range this packs into.
const reefCell = (i, j) => (i + 32768) * 65536 + (j + 32768);
const solidCell = (i, j) => (i + 8192) * 16384 + (j + 8192);

// A chunk is rebuilt when its detail band changes. Past ring 4 nothing more
// changes with distance — only the landmarks are drawn out there — so a chunk
// is not rebuilt each time you walk a chunk further away from it.
const bandOf = ring => Math.min(ring, 4);
const TREE_RING = 3;              // real trees out to here; the far canopy beyond

// The site record the flora rules read (see SPECIES in flora.js).
const SITE_KEYS = ['h', 'slope', 'wet', 'forest', 'plain', 'mountain', 'mesa', 'cliff', 'river', 'edge', 'bank', 'm'];

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.queue = [];
    this.queued = new Map();          // key -> its job in the queue, so each chunk waits once
    // The sea bed and the land are one material; the caustics injection gates
    // itself on being below the waterline, so the beach stays dry-looking.
    this.material = applyCaveCut(applyGroundDetail(applyCaustics(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0,
    }))));
    this.reefMaterial = reefMaterial();
    this._c = new THREE.Color();
    this._dummy = new THREE.Object3D();
    // Highest prop standing at each cell of the sea bed; see clearanceAt().
    this.reefTops = new Map();
    // Solid props bucketed by the cell their axis sits in; see collideReef().
    this.reefSolids = new Map();
    this.reefDirty = false;
    // Plants felled, by where they grew, and how long until they grow back.
    // Kept here rather than on the chunk so a chunk rebuilt at a new level of
    // detail — or unloaded and loaded again — does not regrow them.
    this.felled = new Map();
    this.plantsByKey = new Map();

    this.far = this.buildFar();
    this.rivers = this.buildRivers();
  }

  heightAt(x, z) { return heightAt(x, z); }
  isLand(x, z) { return isLand(x, z); }

  /** The rivers reflect the same sky the ocean does: share its uniforms. */
  shareSky(oceanUniforms) {
    this.rivers.sky.top = oceanUniforms.uSkyTop;
    this.rivers.sky.horizon = oceanUniforms.uSkyHorizon;
    this.rivers.material.needsUpdate = true;
    this.rivers.still.needsUpdate = true;
  }

  lodFor(dist) { return LOD_SEGMENTS[Math.min(dist, LOD_SEGMENTS.length - 1)]; }

  /** Keep the chunks around `focus` loaded at the right detail. */
  update(dt, focus, time = 0, night = 0) {
    setReefTime(time);
    setFloraTime(time);
    this.rivers.flow.offset.y = -time * 0.22;
    this.rivers.stillFlow.offset.set(time * 0.012, -time * 0.017);
    for (const w of this.rivers.falls) w.update(dt, time, focus, night);
    const pi = Math.round(focus.x / CHUNK), pj = Math.round(focus.z / CHUNK);
    this.far.focus.value.set(pi * CHUNK, pj * CHUNK);
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
        const band = bandOf(ring);
        const existing = this.chunks.get(key);
        const job = this.queued.get(key);
        if (job) { job.ring = ring; job.band = band; continue; }      // already waiting
        if (!existing || existing.band !== band) {
          if (existing) existing.stale = true;
          const next = { i, j, ring, band, key };
          this.queued.set(key, next);
          this.queue.push(next);
        }
      }
    }
    // Nearest first, so the ground under you is never the one still waiting.
    if (this.queue.length > 1) {
      this.queue.sort((a, b) => Math.max(Math.abs(a.i - pi), Math.abs(a.j - pj)) - Math.max(Math.abs(b.i - pi), Math.abs(b.j - pj)));
    }

    // Drop anything that has fallen out of range.
    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) {
        if (c.reefProps || c.landProps) this.reefDirty = true;
        this.disposeChunk(c);
        this.chunks.delete(key);
      }
    }

    this.regrow(dt);
    this.animateFelling(dt);

    // Build a couple per frame so walking never stutters.
    let built = 0;
    while (this.queue.length && built < BUILD_BUDGET) {
      const job = this.queue.shift();
      const key = job.key;
      this.queued.delete(key);
      if (!wanted.has(key)) continue;
      const old = this.chunks.get(key);
      if (old && old.band === job.band && !old.stale) continue;
      if (old) { this.disposeChunk(old); }
      this.chunks.set(key, this.buildChunk(job));
      built++;
    }

    if (this.reefDirty) this.rebuildReefField();
  }

  disposeChunk(c) {
    this.scene.remove(c.group);
    // Flora geometry is shared between every chunk; only the ground and the
    // cliff drapes belong to this one.
    c.group.traverse(o => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
    for (const p of c.plants || []) this.plantsByKey.delete(p.key);
  }

  buildChunk({ i, j, ring, band = bandOf(ring) }) {
    const group = new THREE.Group();
    const segs = LOD_SEGMENTS[band];
    const grid = this.buildGround(i, j, segs, group, ring);

    this._plants = null;
    this._reefProps = null;
    this._landProps = null;
    const trees = this.buildFlora(i, j, band, group, grid);
    const coral = ring <= REEF_LOD ? this.buildReef(i, j, group) : 0;
    if (band <= 2) this.buildDrapes(i, j, group, grid);
    if (this._reefProps || this._landProps) this.reefDirty = true;

    this.scene.add(group);
    return { i, j, segs, band, group, trees, coral, plants: this._plants,
             reefProps: this._reefProps, landProps: this._landProps, stale: false };
  }

  /**
   * The ground mesh, and the per-vertex site record the flora scatter reads.
   * Heights are sampled one step past the edge so normals are the same on
   * both sides of a seam, and a skirt hangs off each edge to cover the cracks
   * where a finer chunk meets a coarser one.
   */
  buildGround(i, j, segs, group, ring) {
    const n = segs + 1, G = n + 2, step = CHUNK / segs;
    const x0 = i * CHUNK - CHUNK / 2, z0 = j * CHUNK - CHUNK / 2;
    const H = new Float32Array(G * G);
    const site = {};
    for (const k of SITE_KEYS) site[k] = new Float32Array(n * n);
    for (let b = 0; b < G; b++) {
      for (let a = 0; a < G; a++) {
        const x = x0 + (a - 1) * step, z = z0 + (b - 1) * step;
        const inner = a > 0 && b > 0 && a <= n && b <= n;
        const L = landAt(x, z);
        H[b * G + a] = L.h;
        if (inner) {
          const v = (b - 1) * n + (a - 1);
          site.h[v] = L.h; site.plain[v] = L.plain; site.mountain[v] = L.mountain; site.mesa[v] = L.mesa;
          site.cliff[v] = L.cliff; site.river[v] = Math.min(L.river, 999); site.edge[v] = Math.min(L.edge, 999);
          site.bank[v] = L.bank; site.m[v] = L.m;
        }
      }
    }
    const count = n * n + 4 * n;          // the grid and the skirt
    const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), colours = new Float32Array(count * 3);
    const L = {};
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const v = b * n + a, g = (b + 1) * G + (a + 1);
        const x = x0 + a * step, z = z0 + b * step, h = H[g];
        const nx = H[g - 1] - H[g + 1], nz = H[g - G] - H[g + G], ny = 2 * step;
        const len = Math.hypot(nx, ny, nz);
        pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
        nrm[v * 3] = nx / len; nrm[v * 3 + 1] = ny / len; nrm[v * 3 + 2] = nz / len;
        const slope = 1 - ny / len;
        for (const k of SITE_KEYS) L[k] = site[k][v];
        const wet = wetAt(x, z, L);
        const forest = forestAt(x, z, L, wet, slope);
        site.slope[v] = slope; site.wet[v] = wet; site.forest[v] = forest;
        groundColour(h, slope, wet, noise2(x * 0.35, z * 0.35), L, forest, this._c);
        colours[v * 3] = this._c.r; colours[v * 3 + 1] = this._c.g; colours[v * 3 + 2] = this._c.b;
      }
    }
    const index = [];
    for (let b = 0; b < segs; b++) {
      for (let a = 0; a < segs; a++) {
        const v = b * n + a;
        index.push(v, v + n, v + 1, v + 1, v + n, v + n + 1);
      }
    }
    // Skirt: each edge copied a few metres down, and stitched to the edge.
    const drop = 2 + step * 0.5;
    const edges = [
      Array.from({ length: n }, (_, a) => a),                       // north
      Array.from({ length: n }, (_, a) => (n - 1) * n + a),         // south
      Array.from({ length: n }, (_, b) => b * n),                   // west
      Array.from({ length: n }, (_, b) => b * n + n - 1),           // east
    ];
    let sv = n * n;
    edges.forEach((edge, e) => {
      const start = sv;
      for (const v of edge) {
        pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = pos[v * 3 + 1] - drop; pos[sv * 3 + 2] = pos[v * 3 + 2];
        for (let k = 0; k < 3; k++) { nrm[sv * 3 + k] = nrm[v * 3 + k]; colours[sv * 3 + k] = colours[v * 3 + k]; }
        sv++;
      }
      for (let k = 0; k < n - 1; k++) {
        const a = edge[k], b2 = edge[k + 1], c = start + k, d = start + k + 1;
        // Wound to face outward; both windings for simplicity are not needed
        // because the skirt is only ever seen from outside the chunk.
        if (e === 0 || e === 3) index.push(a, b2, c, b2, d, c);
        else index.push(a, c, b2, b2, c, d);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.userData.own = true;
    mesh.receiveShadow = true;
    if (ring <= 1) mesh.castShadow = true;
    group.add(mesh);
    return { site, n, step, x0, z0, H, G };
  }

  /** Bilinear read of the site record at a point in this chunk. */
  siteAt(grid, x, z, out) {
    const { site, n, step, x0, z0 } = grid;
    const fx = Math.min(n - 1.001, Math.max(0, (x - x0) / step)), fz = Math.min(n - 1.001, Math.max(0, (z - z0) / step));
    const a = Math.floor(fx), b = Math.floor(fz), u = fx - a, v = fz - b;
    const i00 = b * n + a, i10 = i00 + 1, i01 = i00 + n, i11 = i01 + 1;
    for (const k of SITE_KEYS) {
      const s = site[k];
      out[k] = (s[i00] * (1 - u) + s[i10] * u) * (1 - v) + (s[i01] * (1 - u) + s[i11] * u) * v;
    }
    out.beach = smooth(3.4, 2, out.h) * smooth(120, 40, out.m);
    out.shore = out.m;
    out.rare = smooth(0.7, 0.78, noise2(x * 0.011 + 13, z * 0.011 - 29));
    return out;
  }

  /**
   * Plants, deadfall and rocks, by the rules in flora.js. Each layer is a
   * jittered grid at its own spacing; each cell holds a lottery among the
   * layer's species, weighted by how well each suits the spot, with some
   * chance of holding nothing at all. The lottery is always run over every
   * species in the layer — whether or not it is drawn at this distance — so
   * walking closer never changes which plant grows where, only whether it is
   * drawn and how finely.
   */
  buildFlora(i, j, band, group, grid) {
    const ox = i * CHUNK - CHUNK / 2, oz = j * CHUNK - CHUNK / 2;
    const place = new Map();            // "species|variant|lod" -> [instances]
    const plants = [], solids = [];
    const site = this._site || (this._site = {});
    let total = 0;

    Object.entries(LAYERS).forEach(([layer, { cell }], li) => {
      const species = SPECIES.filter(sp => sp.layer === layer);
      const drawn = species.filter(sp => band <= 3 ? band <= sp.rings : sp.rings >= 4);
      if (!drawn.length) return;
      const cells = Math.ceil(CHUNK / cell);
      const weights = new Float32Array(species.length);
      for (let cj = 0; cj < cells; cj++) {
        for (let ci = 0; ci < cells; ci++) {
          const s = li * 100003 + cj * 977 + ci;
          const x = ox + (ci + hash(i * 7919 + s, j * 104729)) * cell;
          const z = oz + (cj + hash(i * 104729, j * 7919 + s)) * cell;
          if (x >= ox + CHUNK || z >= oz + CHUNK) continue;
          if (CAVE_MOUTHS.length && nearCaveMouth(x, z)) continue;
          this.siteAt(grid, x, z, site);
          let sum = 0;
          const wet = site.edge < 0.6;       // in the river, or at its very edge
          for (let k = 0; k < species.length; k++) {
            weights[k] = wet && !species[k].aquatic ? 0 : Math.max(0, species[k].where(site));
            sum += weights[k];
          }
          if (sum <= 0.001) continue;
          if (hash(s * 31 + 7, i * 13 + j * 71) > Math.min(1, sum)) continue;
          let pick = hash(s * 71 + 3, i * 29 + j * 7) * sum, f = 0;
          for (; f < species.length - 1; f++) { pick -= weights[f]; if (pick <= 0) break; }
          const sp = species[f];
          if (!drawn.includes(sp)) continue;

          const r1 = hash(s, i * 3 + j * 5 + 1), r2 = hash(s + 9, j * 3 + i * 5 + 2), r3 = hash(s + 17, i + j * 11 + 3);
          const lod = band >= (sp.farFrom ?? 99) ? 1 : 0;
          // (Far off, the cheap build of its own kind: a young tree stays young.)
          const vAll = Math.floor(r1 * sp.variants) % sp.variants;
          const v = lod ? (sp.farVariant ? sp.farVariant(vAll) : 0) : vAll;
          // Its size, for the spot too: stunted up in the cloud forest.
          const sc = THREE.MathUtils.lerp(sp.scale[0], sp.scale[1], Math.pow(r2, 1.4)) * (sp.size ? sp.size(site) : 1);
          const trunk = sp.trunkOf ? sp.trunkOf(vAll) : sp.trunk;
          const yaw = r3 * Math.PI * 2;
          const fine = layer === 'grass' || layer === 'ground';
          let y = fine ? this.gridHeight(grid, x, z) : heightAt(x, z);
          let pitch = 0, roll = 0;
          if (sp.lying) {
            // Lie along the ground: tilt to the slope between its two ends.
            const half = 7 * sc, dx = Math.cos(yaw) * half, dz = -Math.sin(yaw) * half;
            pitch = 0;
            roll = Math.atan2(heightAt(x + dx, z + dz) - heightAt(x - dx, z - dz), half * 2);
            y -= 0.25;
          } else if (sp.material === 'rock') {
            pitch = (r1 - 0.5) * 0.4; roll = (r2 - 0.5) * 0.4;
            y -= 0.3 * sc;
          } else {
            pitch = (r1 - 0.5) * 0.06; roll = (r2 - 0.5) * 0.06;
            y -= 0.15;
          }
          const key = `${sp.name}|${v}|${lod}`;
          let list = place.get(key);
          if (!list) place.set(key, list = { sp, v, lod, items: [] });
          const plantKey = `${i},${j},${li},${ci},${cj}`;
          list.items.push({ x, y, z, sc, yaw, pitch, roll, plantKey, trunk, form: vAll, tint: hash(s + 29, i * 7 + j) });

          // What it blocks: a trunk, a rock, a stump.
          if (trunk || sp.solid) {
            const geo = speciesGeometry(sp, v, lod);
            const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
            const rad = trunk ? trunk * sc : Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) * sc * 0.75;
            solids.push({ x, z, base: y - 1, top: trunk ? y + 60 : y + bb.max.y * sc, rad: rad * 1.1, hit: rad, solid: true, plantKey });
          }
        }
      }
    });

    const d = this._dummy;
    for (const { sp, v, lod, items } of place.values()) {
      const inst = new THREE.InstancedMesh(speciesGeometry(sp, v, lod), speciesMaterial(sp), items.length);
      inst.castShadow = band <= 1 && sp.material !== 'grass';
      inst.receiveShadow = true;
      items.forEach((t, k) => {
        d.position.set(t.x, t.y, t.z);
        d.rotation.set(t.pitch, t.yaw, t.roll, 'YXZ');
        d.scale.setScalar(t.sc);
        d.updateMatrix();
        const felled = this.felled.has(t.plantKey);
        inst.setMatrixAt(k, felled ? HIDDEN : d.matrix);
        // Two of a species are never quite the same colour.
        const tint = sp.material === 'rock' ? 0.12 : 0.2;
        this._c.setRGB(1 + (t.tint - 0.5) * tint, 1 + (0.5 - t.tint) * tint * 0.4, 1 - (t.tint - 0.5) * tint * 0.6)
          .multiplyScalar(0.88 + hash(k, t.tint * 1e6) * 0.22);
        inst.setColorAt(k, this._c);
        if (sp.yield && band <= 1) {
          // (How many strokes, and what it gives, for its form: a young tree less than an old one.)
          const p = { sp, inst, index: k, matrix: d.matrix.clone(), x: t.x, y: t.y, z: t.z, key: t.plantKey, trunk: t.trunk,
                      chop: sp.chopOf ? sp.chopOf(t.form) : sp.chop, yield: sp.yieldOf ? sp.yieldOf(t.form) : sp.yield,
                      reach: sp.reach + (t.trunk ? t.trunk * (t.sc - 1) : 0) };
          plants.push(p);
          this.plantsByKey.set(t.plantKey, p);
        }
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
      total += items.length;
    }
    for (const s of solids) if (this.felled.has(s.plantKey)) s.off = true;
    this._plants = plants;
    this._landProps = solids.length ? solids : null;
    return total;
  }

  /** Ground height inside a chunk, from its own mesh: cheaper than heightAt. */
  gridHeight(grid, x, z) {
    const { H, G, step, x0, z0 } = grid;
    const fx = (x - x0) / step + 1, fz = (z - z0) / step + 1;
    const a = Math.floor(fx), b = Math.floor(fz), u = fx - a, v = fz - b;
    const g = b * G + a;
    return (H[g] * (1 - u) + H[g + 1] * u) * (1 - v) + (H[g + G] * (1 - u) + H[g + G + 1] * u) * v;
  }

  /**
   * Vines down the cliffs and escarpment risers: strands that start at the top
   * of a steep face and follow it down, a hand's breadth off the rock.
   */
  buildDrapes(i, j, group, grid) {
    const strands = [];
    const ox = i * CHUNK - CHUNK / 2, oz = j * CHUNK - CHUNK / 2;
    const site = this._siteD || (this._siteD = {});
    const nrm = new THREE.Vector3();
    for (let s = 0; s < 70; s++) {
      const x = ox + hash(i * 911 + s, j * 313) * CHUNK, z = oz + hash(i * 313, j * 911 + s) * CHUNK;
      this.siteAt(grid, x, z, site);
      if (site.slope < 0.55 || site.h < 3 || site.h > TREELINE || site.wet < 0.35) continue;
      if (hash(s * 7, i + j * 3) > 0.55) continue;
      const pts = [];
      let px = x, pz = z;
      for (let k = 0; k < 12; k++) {
        normalAt(px, pz, nrm);
        const h = heightAt(px, pz);
        pts.push(new THREE.Vector3(px + nrm.x * 0.25, h + nrm.y * 0.25, pz + nrm.z * 0.25));
        const flat = Math.hypot(nrm.x, nrm.z);
        if (k > 2 && flat < 0.45) break;          // reached the foot of the face
        px += (nrm.x / (flat || 1)) * 1.1;
        pz += (nrm.z / (flat || 1)) * 1.1;
      }
      if (pts.length < 4) continue;
      if (CAVE_MOUTHS.length && (nearCaveMouth(x, z) || nearCaveMouth(pts.at(-1).x, pts.at(-1).z))) continue;
      normalAt(x, z, nrm);
      const side = new THREE.Vector3(-nrm.z, 0, nrm.x).normalize();
      strands.push({ pts, side, normal: nrm.clone() });
    }
    if (!strands.length) return;
    const mesh = new THREE.Mesh(drapeGeometry(strands), floraMaterials().tree);
    mesh.userData.own = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── the far land ───────────────────────────────────────────────────────────
  /**
   * The whole continent at once, coarse, for what the chunks do not reach:
   * the far coast, the range, the forest seen from the raft. Two sheets — the
   * ground, and the forest canopy as a lumpy shell over it — each sunk out of
   * sight inside the square where the chunks draw the real thing. The grid
   * lines up with the chunk edges, so the hand-over is exact.
   */
  buildFar() {
    const S = 16;
    const reach = WORLD.radius + 560;
    const x0 = Math.floor((WORLD.cx - reach) / CHUNK) * CHUNK - CHUNK / 2;
    const z0 = Math.floor((WORLD.cz - reach) / CHUNK) * CHUNK - CHUNK / 2;
    const n = Math.ceil((2 * reach + CHUNK) / S) + 1;
    const ground = new Float32Array(n * n * 3), canopy = new Float32Array(n * n * 3);
    const gcol = new Float32Array(n * n * 3), ccol = new Float32Array(n * n * 3);
    const H = new Float32Array(n * n);
    const L = {};
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) H[b * n + a] = heightAt(x0 + a * S, z0 + b * S);
    const dark = new THREE.Color(0x2c4426), light = new THREE.Color(0x4f6e37), cc = new THREE.Color();
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const v = b * n + a, x = x0 + a * S, z = z0 + b * S;
        const land = landAt(x, z);
        for (const k of SITE_KEYS) if (k in land) L[k] = land[k];
        const h = land.h;
        const hx = H[b * n + Math.min(n - 1, a + 1)] - H[b * n + Math.max(0, a - 1)];
        const hz = H[Math.min(n - 1, b + 1) * n + a] - H[Math.max(0, b - 1) * n + a];
        const slope = 1 - (2 * S) / Math.hypot(hx, 2 * S, hz);
        const wet = wetAt(x, z, L);
        const forest = forestAt(x, z, L, wet, slope);
        ground.set([x, h - 0.6, z], v * 3);
        groundColour(h, slope, wet, noise2(x * 0.35, z * 0.35), L, forest, this._c);
        gcol.set([this._c.r, this._c.g, this._c.b], v * 3);
        // The canopy: as high as the trees here would be, lumpy, and sunk
        // into the ground where there is no forest so its edges slope down.
        const lump = fbm(x * 0.021 + 3, z * 0.021 - 5, 2);
        const top = h - 18 + (36 + 26 * wet + lump * 12) * smooth(0.04, 0.5, forest);
        canopy.set([x, top, z], v * 3);
        cc.copy(dark).lerp(light, lump * 0.8 + (1 - wet) * 0.3);
        ccol.set([cc.r, cc.g, cc.b], v * 3);
      }
    }
    // Soften the canopy: a treeline is a slope of smaller trees, not a wall.
    for (let pass = 0; pass < 2; pass++) {
      const src = canopy.slice();
      for (let b = 1; b < n - 1; b++) for (let a = 1; a < n - 1; a++) {
        let sum = 0;
        for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) sum += src[((b + db) * n + a + da) * 3 + 1];
        const v = b * n + a;
        // Never below the ground, never much above where it started.
        canopy[v * 3 + 1] = Math.max(ground[v * 3 + 1] - 18, Math.min(src[v * 3 + 1] + 6, sum / 9));
      }
    }
    const index = [];
    for (let b = 0; b < n - 1; b++) for (let a = 0; a < n - 1; a++) {
      const v = b * n + a;
      index.push(v, v + n, v + 1, v + 1, v + n, v + n + 1);
    }
    const focus = { value: new THREE.Vector2(1e9, 1e9) };
    const sheet = (positions, colours, half, drop, rough) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 });
      // Mottled like crowns seen from a distance, not felt.
      if (drop > 50) applyGroundDetail(mat, { strength: 1.6, bump: 0 });
      const detailCompile = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        if (detailCompile) detailCompile(shader, renderer);
        shader.uniforms.uFarFocus = focus;
        Object.assign(shader.uniforms, CAVE_FAR);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform vec2 uFarFocus;
            uniform vec3 uCaveFar[4];
            varying float vFarY;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              vec2 rel = abs(transformed.xz - uFarFocus);
              if (max(rel.x, rel.y) < ${(half - 0.5).toFixed(1)}) transformed.y -= ${drop.toFixed(1)};
              // Round a cave, gone altogether (under the sea, so thrown away below):
              // sunk only a little, it runs through the hills — through the caves in them.
              if (max(rel.x, rel.y) < ${(half - 70).toFixed(1)}) {
                for (int i = 0; i < 4; i++) {
                  if (uCaveFar[i].z > 0.0 && distance(transformed.xz, uCaveFar[i].xy) < uCaveFar[i].z) transformed.y -= 400.0;
                }
              }
              vFarY = transformed.y;
            }`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            varying float vFarY;`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            if (vFarY < 0.2) discard;     // the sea is the ocean's, and the sky's`);
      };
      const detailKey = drop > 50 ? mat.customProgramCacheKey : null;
      mat.customProgramCacheKey = () => `far-${half}-${drop}-${detailKey ? detailKey() : ''}`;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      return mesh;
    };
    return {
      focus,
      ground: sheet(ground, gcol, (VIEW_CHUNKS + 0.5) * CHUNK, 14, 0.96),
      canopy: sheet(canopy, ccol, (TREE_RING + 0.5) * CHUNK, 90, 0.85),
    };
  }

  // ── rivers ─────────────────────────────────────────────────────────────────
  /** The water in each river: a ribbon down its course at the survey's level. */
  buildRivers() {
    // Ripples: a small tiling normal map of crossed sines, scrolled downstream.
    const N = 128, data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
      const dx = Math.cos(u * 3 + v) * 0.5 + Math.cos(u * 5 - v * 2) * 0.3 + Math.cos(u * 2 + v * 7) * 0.2;
      const dy = Math.cos(v * 4 + u) * 0.5 + Math.cos(v * 6 - u * 3) * 0.3 + Math.sin(v * 9 + u * 2) * 0.2;
      const nx = dx * 0.35, ny = dy * 0.35, len = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      data[i] = (nx / len * 0.5 + 0.5) * 255; data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len * 0.5 + 0.5) * 255; data[i + 3] = 255;
    }
    const flow = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    flow.wrapS = flow.wrapT = THREE.RepeatWrapping;
    flow.generateMipmaps = true;
    flow.minFilter = THREE.LinearMipmapLinearFilter;
    flow.magFilter = THREE.LinearFilter;
    flow.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2c4a44, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.86,
      normalMap: flow, normalScale: new THREE.Vector2(0.55, 0.55), depthWrite: false,
    });
    // There is no environment map to reflect, so the sky is added by hand:
    // its colours (shared with the ocean, which the sky keeps up to date),
    // stronger toward grazing angles as water is.
    const sky = { top: { value: new THREE.Color(0x2f7fb5) }, horizon: { value: new THREE.Color(0xbfd9e8) } };
    mat.onBeforeCompile = shader => {
      shader.uniforms.uRiverSkyTop = sky.top;
      shader.uniforms.uRiverSkyHorizon = sky.horizon;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uRiverSkyTop;
          uniform vec3 uRiverSkyHorizon;`)
        .replace('#include <opaque_fragment>', `
          {
            vec3 v = normalize(vViewPosition);
            float fres = pow(1.0 - clamp(dot(normal, v), 0.0, 1.0), 4.0);
            vec3 skyc = mix(uRiverSkyTop, uRiverSkyHorizon, 0.55);
            outgoingLight = mix(outgoingLight, skyc, 0.18 + fres * 0.62);
            diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.8);
          }
          #include <opaque_fragment>`);
    };
    const meshes = [];
    for (const rv of RIVERS) {
      const geo = riverGeometry(rv);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    // Still water: the same, but its ripples barely drift. Drawn first and
    // into the depth, so where a river runs into or out of it the river's
    // ribbon (a hair lower) is hidden under it rather than laid over it — two
    // sheets of see-through water would show as a pale band.
    const stillFlow = flow.clone();
    stillFlow.needsUpdate = true;
    stillFlow.repeat.set(0.45, 0.45);             // broad, soft ripples: no tiling to see from above
    const still = mat.clone();
    still.normalMap = stillFlow;
    still.normalScale = new THREE.Vector2(0.3, 0.3);
    still.onBeforeCompile = mat.onBeforeCompile;
    still.depthWrite = true;
    for (const L of LAKES) {
      const mesh = new THREE.Mesh(lakeGeometry(L), still);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    const falls = FALLS.map(f => {
      const w = new Waterfall(f);
      this.scene.add(w.group);
      return w;
    });
    return { flow, stillFlow, meshes, material: mat, still, falls, sky };
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
      // Trunks and rocks on land only block; they are not part of the field
      // the fish steer over.
      for (const p of c.landProps || []) {
        const key = solidCell(Math.floor(p.x / SOLID_CELL), Math.floor(p.z / SOLID_CELL));
        const bucket = this.reefSolids.get(key);
        if (bucket) bucket.push(p); else this.reefSolids.set(key, [p]);
      }
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
          if (p.off) continue;                      // felled
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
   * Solid props — trunks, stumps, rocks — whose axis is within `r` of (x, z):
   * what an animal steers round. Fills and returns `out`.
   */
  solidsNear(x, z, r, out = []) {
    out.length = 0;
    const i0 = Math.floor((x - r) / SOLID_CELL), i1 = Math.floor((x + r) / SOLID_CELL);
    const j0 = Math.floor((z - r) / SOLID_CELL), j1 = Math.floor((z + r) / SOLID_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const bucket = this.reefSolids.get(solidCell(i, j));
        if (!bucket) continue;
        for (const p of bucket) {
          if (p.off || p.base < -0.5) continue;              // felled, or under the sea
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < (r + p.hit) ** 2) out.push(p);
        }
      }
    }
    return out;
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

  // ── harvesting ─────────────────────────────────────────────────────────────
  /** The plant under the crosshair, if it is close enough to reach. */
  pickPlant(origin, dir) {
    let best = null, bestScore = -Infinity;
    for (const c of this.chunks.values()) {
      if (!c.plants) continue;
      for (const p of c.plants) {
        if (this.felled.has(p.key)) continue;
        // Looked for anywhere up its own height — fallen branches at the
        // ground, a stump at its top, a trunk up to above your head — not at
        // one height for everything, or a fern beside a log is what you get
        // when you look down at the log.
        // (Within reach along the ground: how far you can reach to your feet
        // is not less than how far you can reach ahead.)
        const dx = p.x - origin.x, dz = p.z - origin.z, flat = Math.hypot(dx, dz);
        if (flat > p.reach) continue;
        const h = Math.min(2.4, this.plantHeight(p));
        let dot = -2;
        for (const f of [0.15, 0.5, 0.9]) {
          const dy = p.y + h * f - origin.y;
          const k = (dx * dir.x + dy * dir.y + dz * dir.z) / (Math.hypot(dx, dy, dz) || 1);
          if (k > dot) dot = k;
        }
        if (dot < 0.25) continue;
        const score = dot * 2 - flat / p.reach;
        if (score > bestScore) { bestScore = score; best = p; }
      }
    }
    return best;
  }

  /** How tall a plant stands, from its body: a log lying is a few tens of centimetres. */
  plantHeight(p) {
    if (p.h === undefined) {
      const geo = p.inst.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      p.h = Math.max(0.2, geo.boundingBox.max.y * p.matrix.getMaxScaleOnAxis());
    }
    return p.h;
  }

  /** The plants taken and not yet grown back, for the save: [key, seconds left]. */
  felledList() {
    return [...this.felled].map(([k, t]) => [k, Math.round(t)]);
  }

  /** Back from a save: those still gone, hidden wherever their chunk is already built. */
  restoreFelled(list) {
    for (const [k, t] of list || []) {
      if (typeof k !== 'string' || !(t > 0)) continue;
      this.felled.set(k, t);
      const p = this.plantsByKey.get(k);
      if (p) { p.inst.setMatrixAt(p.index, HIDDEN); p.inst.instanceMatrix.needsUpdate = true; }
      this.setSolid(k, false);
    }
  }

  /**
   * A stroke of the axe: the plant shudders, leaning away from `dir` (the
   * way the blow came, flat) for a moment and back.
   */
  shake(p, dir) {
    this.shaking = this.shaking || [];
    this.shaking = this.shaking.filter(s => s.p !== p);
    this.shaking.push({ p, t: 0, ax: dir.z, az: -dir.x });
  }

  /** Where an axe bites a plant struck from `dir`: the near face of its trunk, chest high (a log: its top). */
  bitePoint(p, dir, out = new THREE.Vector3()) {
    const scale = p.matrix.getMaxScaleOnAxis();
    if (p.sp.lying) return out.set(p.x, p.y + 0.35 * scale, p.z);
    const r = Math.min(1.4, (p.trunk ?? p.sp.trunk ?? 0.3) * scale * 0.42);
    return out.set(p.x - dir.x * r, p.y + (p.sp.name === 'stump' ? 0.5 : 1.1), p.z - dir.z * r);
  }

  /**
   * Bits flying: `kind` 'wood' (chips, pale with bark), 'bamboo', 'leaves'
   * (drifting down) or 'dust' (a puff); `n` of them from `at`, thrown back
   * along -`dir` (toward whoever struck) and up.
   */
  burst(at, dir, kind, n) {
    const fx = this.fx ||= this.makeBits();
    const [a, b] = BIT_COLOURS[kind];
    const big = kind === 'leaves' || kind === 'dust';
    const pool = big ? fx.big : fx.small;
    const ground = heightAt(at.x, at.z);
    for (let k = 0; k < n; k++) {
      const i = pool.next = (pool.next + 1) % pool.max, q = pool.bits[i];
      const side = (Math.random() - 0.5) * 2;
      q.x = at.x + (Math.random() - 0.5) * (big ? 1.5 : 0.2);
      q.y = at.y + (Math.random() - 0.5) * (big ? 1.2 : 0.2);
      q.z = at.z + (Math.random() - 0.5) * (big ? 1.5 : 0.2);
      const out = big ? 0.6 + Math.random() * 1.2 : 1.4 + Math.random() * 2.2;
      q.vx = -dir.x * out + dir.z * side * (big ? 1.4 : 1.6);
      q.vz = -dir.z * out - dir.x * side * (big ? 1.4 : 1.6);
      q.vy = big ? 0.4 + Math.random() * 1.6 : 1.2 + Math.random() * 2.4;
      q.life = kind === 'leaves' ? 2.2 + Math.random() : kind === 'dust' ? 1.2 + Math.random() * 0.6 : 0.9 + Math.random() * 0.5;
      q.kind = kind;
      q.floor = Math.min(ground, at.y - 0.3) + 0.03;
      _bitColour.copy(a).lerp(b, Math.random());
      pool.col.setXYZ(i, _bitColour.r, _bitColour.g, _bitColour.b);
    }
    pool.col.needsUpdate = true;
  }

  makeBits() {
    const pool = (max, size) => {
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(max * 3).fill(-1e4), 3);
      const col = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
      g.setAttribute('position', pos); g.setAttribute('color', col);
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true }));
      pts.frustumCulled = false;
      this.scene.add(pts);
      return { max, pos, col, next: 0, bits: Array.from({ length: max }, () => ({ life: 0 })) };
    };
    return { small: pool(240, 0.085), big: pool(160, 0.16) };
  }

  /**
   * Bring a tree down: a copy of it, in its place, topples away from `dir` —
   * slowly at first, then fast — to where it meets the ground (on a slope,
   * sooner), bounces, throws up leaves and dust, lies a while and sinks out
   * of sight. `onLand` is called as it hits. (The plant itself is harvested as
   * ever: gone, and growing back in its own time.)
   */
  topple(p, dir, onLand = null) {
    const m = new THREE.InstancedMesh(p.inst.geometry, p.inst.material, 1);
    m.setMatrixAt(0, p.matrix);
    m.castShadow = true;
    m.frustumCulled = false;
    this.scene.add(m);
    const geo = p.inst.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const H = Math.max(2, geo.boundingBox.max.y * p.matrix.getMaxScaleOnAxis());
    // How far over before some of it meets the ground.
    let stop = 1.53;
    search: for (let a = 0.15; a < 1.56; a += 0.02) {
      for (const f of [0.3, 0.6, 0.9]) {
        const x = p.x + dir.x * Math.sin(a) * H * f, z = p.z + dir.z * Math.sin(a) * H * f;
        if (p.y + Math.cos(a) * H * f < heightAt(x, z) + 0.35) { stop = a; break search; }
      }
    }
    this.falling = this.falling || [];
    const f = { m, p, t: 0, H, stop, fall: 1.3 + H / 40, dir: dir.clone(),
                axis: new THREE.Vector3(dir.z, 0, -dir.x).normalize(), onLand, landed: false };
    this.falling.push(f);
    return f;
  }

  /** Once a frame: the shudders, the falls, and the bits flying. */
  animateFelling(dt) {
    const R = this._fallR ||= new THREE.Matrix4(), T = this._fallT ||= new THREE.Matrix4(), out = this._fallM ||= new THREE.Matrix4();
    const ax = this._ax ||= new THREE.Vector3();
    for (const s of this.shaking || []) {
      s.t += dt;
      if (this.felled.has(s.p.key)) continue;
      // Away from the blow and back; the last frame puts it exactly where it stood.
      const lean = s.t < 0.35 ? Math.sin((s.t / 0.35) * Math.PI) * 0.05 : 0;
      R.makeRotationAxis(ax.set(s.ax, 0, s.az).normalize(), lean);
      out.makeTranslation(s.p.x, s.p.y, s.p.z).multiply(R).multiply(T.makeTranslation(-s.p.x, -s.p.y, -s.p.z)).multiply(s.p.matrix);
      s.p.inst.setMatrixAt(s.p.index, out);
      s.p.inst.instanceMatrix.needsUpdate = true;
    }
    if (this.shaking) this.shaking = this.shaking.filter(s => s.t < 0.35);
    for (const f of this.falling || []) {
      f.t += dt;
      let angle;
      if (f.t < f.fall) angle = f.stop * Math.pow(f.t / f.fall, 2.4);           // over, gathering speed
      else {
        const u = f.t - f.fall;                                                  // down: a bounce, and still
        angle = f.stop - 0.07 * Math.exp(-4 * u) * Math.abs(Math.sin(9 * u));
        if (!f.landed) {
          f.landed = true;
          const crown = _bitAt.set(f.p.x + f.dir.x * Math.sin(f.stop) * f.H * 0.85, f.p.y + Math.cos(f.stop) * f.H * 0.85,
                                   f.p.z + f.dir.z * Math.sin(f.stop) * f.H * 0.85);
          this.burst(crown, f.dir.clone().negate(), f.p.sp.name === 'bamboo' ? 'bamboo' : 'leaves', 50);
          for (const k of [0.25, 0.5]) {
            _bitAt.set(f.p.x + f.dir.x * f.H * k, heightAt(f.p.x + f.dir.x * f.H * k, f.p.z + f.dir.z * f.H * k) + 0.3, f.p.z + f.dir.z * f.H * k);
            this.burst(_bitAt, f.dir.clone().negate(), 'dust', 14);
          }
          f.onLand?.(f);
        }
      }
      const sink = Math.max(0, f.t - f.fall - 4) * 1.3;
      R.makeRotationAxis(f.axis, angle);
      out.makeTranslation(f.p.x, f.p.y - sink, f.p.z).multiply(R).multiply(T.makeTranslation(-f.p.x, -f.p.y, -f.p.z)).multiply(f.p.matrix);
      f.m.setMatrixAt(0, out);
      f.m.instanceMatrix.needsUpdate = true;
      if (f.t > f.fall + 5.6) { this.scene.remove(f.m); f.m.dispose(); f.done = true; }
    }
    if (this.falling) this.falling = this.falling.filter(f => !f.done);
    // The bits: thrown, falling (leaves drifting), resting where they land; gone when their time is up.
    for (const pool of this.fx ? [this.fx.small, this.fx.big] : []) {
      let live = false;
      pool.bits.forEach((q, i) => {
        if (q.life <= 0) return;
        live = true;
        q.life -= dt;
        const drag = q.kind === 'leaves' ? 2.6 : q.kind === 'dust' ? 3.5 : 0.4;
        const g = q.kind === 'leaves' ? 2.2 : q.kind === 'dust' ? -0.3 : 9.8;
        q.vx -= q.vx * drag * dt; q.vz -= q.vz * drag * dt;
        q.vy -= (g + q.vy * (q.kind === 'wood' || q.kind === 'bamboo' ? 0 : drag)) * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y < q.floor) { q.y = q.floor; q.vx *= 0.3; q.vz *= 0.3; q.vy = 0; }
        if (q.kind === 'leaves') { q.x += Math.sin(q.life * 5 + i) * 0.4 * dt; }
        if (q.life <= 0) pool.pos.setXYZ(i, 0, -1e4, 0);
        else pool.pos.setXYZ(i, q.x, q.y, q.z);
      });
      if (live) pool.pos.needsUpdate = true;
    }
  }

  /** Fell a plant: hide that one instance and let it grow back later. */
  harvest(p) {
    this.felled.set(p.key, p.sp.regrow);
    p.inst.setMatrixAt(p.index, HIDDEN);
    p.inst.instanceMatrix.needsUpdate = true;
    this.setSolid(p.key, false);
    return { label: p.sp.label, yield: p.yield || p.sp.yield };
  }

  setSolid(key, on) {
    for (const c of this.chunks.values()) {
      for (const s of c.landProps || []) if (s.plantKey === key) s.off = !on;
    }
  }

  regrow(dt) {
    for (const [key, left] of this.felled) {
      const t = left - dt;
      if (t > 0) { this.felled.set(key, t); continue; }
      this.felled.delete(key);
      const p = this.plantsByKey.get(key);
      if (p) {
        p.inst.setMatrixAt(p.index, p.matrix);
        p.inst.instanceMatrix.needsUpdate = true;
      }
      this.setSolid(key, true);
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

// What flies when a tree is cut or comes down: two colours each, mixed.
const BIT_COLOURS = {
  wood:   [new THREE.Color(0xdcc594), new THREE.Color(0x5e4330)],   // the pale wood, and bark
  bamboo: [new THREE.Color(0xcfc57e), new THREE.Color(0x6f8a3a)],
  leaves: [new THREE.Color(0x3f6b2a), new THREE.Color(0x7a9a3c)],
  dust:   [new THREE.Color(0x9c8a6a), new THREE.Color(0xb8a888)],
};
const _bitColour = new THREE.Color(), _bitAt = new THREE.Vector3();

// An instance matrix that puts something out of sight: a felled plant.
const HIDDEN = new THREE.Matrix4().makeTranslation(0, -400, 0).multiply(new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4));
