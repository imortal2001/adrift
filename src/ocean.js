// ── Ocean ────────────────────────────────────────────────────────────────────
// One wave definition, two consumers: the GPU displaces the mesh with it, and
// the CPU samples the exact same sum so the raft, the player and every piece of
// floating debris ride the swell you actually see.

import * as THREE from 'three';
import { CLOUDS, CLOUD_GLSL } from './clouds.js';
import { WEATHER, weatherAt, windAt } from './weather.js';

// Up to this many rafts keep the sea off their decks (see setHulls).
const HULLS = 4;
const RAFT_CELL = 2;               // raft.js CELL
const hullData = new Uint8Array(64 * 64 * HULLS);
const hullTexture = new THREE.DataTexture(hullData, 64, 64 * HULLS, THREE.RedFormat, THREE.UnsignedByteType);
hullTexture.magFilter = hullTexture.minFilter = THREE.NearestFilter;
hullTexture.needsUpdate = true;

// Where the nearest rafts have been: a wake that stays in the water where it
// was laid, and curves where the raft turned (see setHulls).
const TRAILS = 2;                  // rafts that leave one
const TRAIL_N = 32;                // points along each: where it is now, then where it was
const TRAIL_STEP = 0.8;            // s between them: 25 s of wake
const TRAIL_AGE = (TRAIL_N - 1) * TRAIL_STEP;

// Where things have gone into the sea lately (splash.js makes them): x, z,
// when (sea time), size. Drawn here, on the water itself, so they ride the swell.
export const SPLASH_N = 8;
const SPLASH_LIFE = 6;
export const SPLASHES = {
  uSplash: { value: Array.from({ length: SPLASH_N }, () => new THREE.Vector4(0, 0, -1e4, 0)) },
};

const TAU = Math.PI * 2;
const _vel = new THREE.Vector3(), _mid = new THREE.Vector3();

// dir is normalised at build time. len = crest-to-crest metres, speed = m/s-ish.
// The long ones are swell, come from far off: the wind here hardly changes
// them, but they are bigger out over deep water than on the shelf round the
// island (`open`: how much more, fully out). The short ones are the wind's
// own sea: low on a quiet day, steep and short in a squall (`base` + `gain`
// × the sea state: 1 at an average wind).
const WAVES = [
  { dir: [ 1.00,  0.32], amp: 0.40, len: 27.0, speed: 1.00, open: 0.35, base: 0.92, gain: 0.22 },
  { dir: [-0.62,  0.88], amp: 0.24, len: 14.5, speed: 1.30, open: 0.20, base: 0.86, gain: 0.40 },
  { dir: [ 0.88, -0.52], amp: 0.13, len: 7.80, speed: 1.70, open: 0,    base: 0.755, gain: 0.70 },
  { dir: [-0.24, -0.98], amp: 0.06, len: 4.10, speed: 2.15, open: 0,    base: 0.65, gain: 1.00 },
].map(w => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  const k = TAU / w.len;
  return { dx: w.dir[0] / l, dz: w.dir[1] / l, amp: w.amp, k, w: w.speed * k, open: w.open, base: w.base, gain: w.gain };
});

export const WAVE_AMPLITUDE = WAVES.reduce((s, w) => s + w.amp, 0);

// ── the sea state ──
// How rough the sea is, 0..1.2, from the wind (weather.js windAt) and a
// squall's gloom: on the shared sea clock, so everyone's sea is the same.
// An average wind is 0.35; a still day near 0; a squall about 1. Each wave's
// share of it (seaK) is what both the CPU's sum and the shader's use.
const SEA_AVG = 0.35;
const seaK = WAVES.map(() => 1);
let seaNow = SEA_AVG;
const _wind = { x: 0, z: 0, strength: 0 }, _wx = { rain: 0, gloom: 0 };
/** The sea state at sea-clock `time`. */
export function seaStateAt(time) {
  const w = windAt(time, _wind);
  const gloom = (WEATHER.override || weatherAt(time, _wx)).gloom;
  return Math.min(1.2, Math.max(0, (w.strength - 0.44) / 0.56 * 0.7 + 0.5 * gloom));
}
function setSea(sea) {
  seaNow = sea;
  for (let i = 0; i < WAVES.length; i++) seaK[i] = WAVES[i].base + WAVES[i].gain * sea;
}
setSea(SEA_AVG);
/** Deep water's share of the open sea's swell: none on the shelf, all of it 30 m down. */
function openFor(depth) {
  const t = Math.min(1, Math.max(0, (depth - 6) / 24));
  return t * t * (3 - 2 * t);
}

// ── the shallows ──
// The swell is the open sea's. Coming in over a shelving beach it loses its
// height, and over the land itself there is none — or the crests would rise
// up through low sand. So the sea knows the ground under it: a map of the bed
// round the camera (SHORE_N cells of SHORE_CELL m, two to each cell of the
// sheet, wrapping as the camera moves so only the new edge is ever sampled),
// and the swell is calmed by how deep the water is. The GPU and the CPU read
// the same map, so what floats rides the sea you see.
// The water's edge is drawn from it, too (see the shader), so it is fine and
// exact: 1.5 m cells, and the height in metres as a half float. (At 3 m and
// 256 steps it was up to 15 cm off the ground at the waterline, and the edge
// was left to where the water plane cut the land's triangles — a sawtooth.)
const SEA = 900, SHORE_N = 600, SHORE_CELL = SEA / SHORE_N;
// (Down to 40 m: deeper than 8, the sea can tell the shelf from open water.)
const BED_LO = -40, BED_HI = 4;               // the bed stored from 40 m down (or more — the open sea) to 4 m up
const EDGE = 0.05;                            // m of water where the sea's edge is drawn (see the shader)
const shoreData = new Float32Array(SHORE_N * SHORE_N).fill(BED_LO);  // the bed, metres: for the CPU (open sea till sampled)
const shoreHalf = new Uint16Array(SHORE_N * SHORE_N).fill(THREE.DataUtils.toHalfFloat(BED_LO));   // …and as half floats, for the GPU
let seabed = null;

/**
 * Where the ground is (world x, z → height, metres above the sea): the land's
 * height function (terrain.js heightAt). Without one the sea is open water
 * everywhere, as in the gallery.
 */
export function setSeabed(fn) { seabed = fn; shore.dirty = true; }

const shore = { ci: null, cj: null, dirty: true };

/** The bed height stored for a cell (wrapping, as the texture does). */
function bedCell(i, j) {
  const a = ((i % SHORE_N) + SHORE_N) % SHORE_N, b = ((j % SHORE_N) + SHORE_N) % SHORE_N;
  return shoreData[b * SHORE_N + a];
}

/** How deep the sea is here, as the map has it (open sea, with no land: as deep as it keeps). */
function depthAt(x, z) {
  if (!seabed) return -BED_LO;
  const fx = x / SHORE_CELL, fz = z / SHORE_CELL, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  return -((bedCell(i, j) * (1 - u) + bedCell(i + 1, j) * u) * (1 - v) + (bedCell(i, j + 1) * (1 - u) + bedCell(i + 1, j + 1) * u) * v);
}

/** How much of the open sea's swell there is here: 1 offshore, less in the shallows, none over land. */
export function shoreCalm(x, z) {
  return seabed ? calmFor(depthAt(x, z)) : 1;
}

/** (The same as the shader's calm().) */
function calmFor(depth) {
  const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return s(-0.4, 0.0, depth) * (0.18 + 0.82 * s(0.0, 4.0, depth));
}

/** Surface height at world (x,z) and time t. */
export function waveHeight(x, z, t) {
  const depth = depthAt(x, z), open = openFor(depth);
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w.amp * seaK[i] * (1 + w.open * open) * Math.sin((w.dx * x + w.dz * z) * w.k - t * w.w);
  }
  return seabed ? h * calmFor(depth) : h;
}

/** Analytic surface normal — same derivative the fragment shader uses. */
export function waveNormal(x, z, t, out = new THREE.Vector3()) {
  const depth = depthAt(x, z), open = openFor(depth);
  let dx = 0, dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const c = w.amp * seaK[i] * (1 + w.open * open) * w.k * Math.cos((w.dx * x + w.dz * z) * w.k - t * w.w);
    dx += c * w.dx;
    dz += c * w.dz;
  }
  const k = seabed ? calmFor(depth) : 1;
  return out.set(-dx * k, 1, -dz * k).normalize();
}

// The identical sum, compiled into GLSL from the table above so the two can
// never drift apart.
const WAVE_GLSL = /* glsl */`
struct Wave { vec2 dir; float amp; float k; float w; float open; };
const int WAVE_N = ${WAVES.length};
Wave waves[WAVE_N] = Wave[WAVE_N](
${WAVES.map(w =>
  `  Wave(vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}), ${w.amp.toFixed(6)}, ${w.k.toFixed(6)}, ${w.w.toFixed(6)}, ${w.open.toFixed(3)})`
).join(',\n')}
);
uniform float uSeaK[WAVE_N];       // each wave's share of the sea state (setSea)
float openFor(float depth){ return smoothstep(6.0, 30.0, depth); }
float waveHeight(vec2 p, float t, float open){
  float h = 0.0;
  for(int i = 0; i < WAVE_N; i++){
    Wave wv = waves[i];
    h += wv.amp * uSeaK[i] * (1.0 + wv.open * open) * sin(dot(wv.dir, p) * wv.k - t * wv.w);
  }
  return h;
}
float waveAmp(float open){
  float a = 0.0;
  for(int i = 0; i < WAVE_N; i++) a += waves[i].amp * uSeaK[i] * (1.0 + waves[i].open * open);
  return a;
}
vec3 waveNormal(vec2 p, float t, float open){
  vec2 d = vec2(0.0);
  for(int i = 0; i < WAVE_N; i++){
    Wave wv = waves[i];
    float c = wv.amp * uSeaK[i] * (1.0 + wv.open * open) * wv.k * cos(dot(wv.dir, p) * wv.k - t * wv.w);
    d += c * wv.dir;
  }
  return normalize(vec3(-d.x, 1.0, -d.y));
}`;

const SHORE_GLSL = /* glsl */`
uniform sampler2D uShore;
float seaDepth(vec2 p){
  float bed = texture2D(uShore, (p / ${SHORE_CELL.toFixed(4)} + 0.5) / ${SHORE_N.toFixed(1)}).r;
  return -bed;
}
float calm(float depth){
  return smoothstep(-0.4, 0.0, depth) * (0.18 + 0.82 * smoothstep(0.0, 4.0, depth));
}`;

const vert = /* glsl */`
uniform float uTime;
varying vec3 vWorld;
varying float vHeight;
varying float vDepth;
varying float vAmp;
${WAVE_GLSL}
${SHORE_GLSL}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDepth = seaDepth(wp.xz);
  float open = openFor(vDepth);
  vHeight = waveHeight(wp.xz, uTime, open) * calm(vDepth);
  vAmp = waveAmp(open);
  wp.y += vHeight;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */`
uniform float uTime, uFogDensity, uNight;
uniform float uUnderwater, uUnderDensity, uShade;
uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uDeep, uShallow, uFog, uUnderFog, uSand, uTurquoise;
uniform mat4 uHullInv[${HULLS}];
uniform int uHullN;
uniform sampler2D uHullMap;
uniform vec4 uHullBox[${HULLS}];   // the raft's squares' extent in its own frame, metres: min x, min z, max x, max z
uniform vec3 uHullVel[${HULLS}];   // its way through the water in its own frame: x, z, and speed
uniform vec4 uTrail[${TRAILS * TRAIL_N}];   // where a raft has been, newest first: world x, z, when, speed
uniform vec4 uTrailInfo[${TRAILS}];         // how many points, the raft's half width and half length across its way
uniform vec4 uTrailBox[${TRAILS}];          // world x, z extent of all a wake can reach
uniform vec4 uSplash[${SPLASH_N}];          // splashes: x, z, when, size
uniform float uRain, uStorm;                // the weather (weather.js): rain, and the squall's gloom
uniform vec3 uWind;                         // which way the wind blows (x, z), and the sea state 0..1.2
varying vec3 vWorld;
varying float vHeight;
varying float vDepth;
varying float vAmp;
${WAVE_GLSL}
${SHORE_GLSL}
${CLOUD_GLSL}
// The wind's ripples: short waves, a metre and a half down to a hand,
// running downwind and fanned either side of it, each at its own deep-water
// speed. Too small to move anything — only the light: their slope (x, z).
// They come in patches, as the gusts touch the water (cat's paws): darker,
// ruffled stretches on a quiet sea, drifting downwind.
const int RIPPLE_N = 6;
const float RIP_LEN[RIPPLE_N] = float[RIPPLE_N](1.6, 1.15, 0.83, 0.6, 0.43, 0.31);
const float RIP_TURN[RIPPLE_N] = float[RIPPLE_N](0.25, -0.45, 0.7, -0.15, 0.55, -0.85);
const float RIP_AMP[RIPPLE_N] = float[RIPPLE_N](0.016, 0.011, 0.008, 0.0055, 0.004, 0.0028);
vec2 windRipples(vec2 p, float t){
  vec2 wd = normalize(uWind.xy + vec2(1e-4, 0.0));
  float a0 = atan(wd.y, wd.x);
  vec2 slope = vec2(0.0);
  for (int i = 0; i < RIPPLE_N; i++) {
    float a = a0 + RIP_TURN[i];
    vec2 d = vec2(cos(a), sin(a));
    float k = 6.2832 / RIP_LEN[i];
    float ph = dot(d, p) * k - t * sqrt(9.8 * k) + float(i) * 1.7;
    slope += d * RIP_AMP[i] * k * cos(ph);
  }
  float gust = smoothstep(0.3, 0.75, cNoise(p * 0.04 - wd * t * 0.25));
  // On a still day little but the gusts' patches; in a squall, all of it.
  float sea = uWind.z;
  return slope * (0.15 + 1.1 * sea) * mix(0.35 + 0.4 * sea, 1.2, gust);
}
// Is raft i's square c (in its own grid) there?
bool hullAt(int i, vec2 c){
  c += 32.0;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 63.0 || c.y > 63.0) return false;
  return texture2D(uHullMap, (c + 0.5) / vec2(64.0, ${(64 * HULLS).toFixed(1)}) + vec2(0.0, float(i) * 64.0 / ${(64 * HULLS).toFixed(1)})).r > 0.5;
}
// Froth: clumps of bubbles at a few sizes. (Turned at each size: a single
// value noise cut sharp showed its grid — little squares of foam.)
float froth(vec2 p){
  return smoothstep(0.38, 0.56, cFbm(p * 2.6, 3));
}
float patchy(vec2 p){ return cFbm(p * 2.4 + 5.7, 3); }
// Rain on the sea: each drop a little ring, once a cycle in each cell of a
// fine grid, at a time of its own; as many cells as it is raining hard.
float rainRings(vec2 p, float rain){
  float acc = 0.0;
  for (int l = 0; l < 2; l++) {
    vec2 q = p * (l == 0 ? 2.2 : 3.1) + float(l) * 17.3;
    vec2 c = floor(q), f = fract(q) - 0.5;
    float h = cHash(c);
    if (h > rain) continue;
    vec2 at = (vec2(cHash(c + 3.1), cHash(c + 7.7)) - 0.5) * 0.5;
    float t = fract(uTime * (1.1 + h * 0.6) + h * 13.0);
    float r = length(f - at);
    acc += exp(-pow((r - t * 0.3) / 0.03, 2.0)) * (1.0 - t) * (1.0 - t);
  }
  return acc;
}
void main(){
  // (Per fragment, not the vertex's: the beach line is finer than the mesh.)
  float depth = seaDepth(vWorld.xz);
  // The water's edge: where it is no longer EDGE deep — over the bed as the
  // map has it, smooth and exact, and moving in and out with the swell. Left
  // to the depth test, the edge was wherever the sheet cut the ground's metre
  // triangles, and the land's bumps, a couple of centimetres off the straight
  // across each, are tens of centimetres of beach at a shallow slope: teeth.
  // (The land must come up through the water a little short of where the
  // sheet gives out, or the line is the triangles' again: EDGE is the map's
  // worst error at the waterline, and a hair more.)
  float water = depth + vHeight;
  if (water < ${EDGE.toFixed(3)}) discard;
  // No sea on a raft's deck. The raft rides the swell as one rigid thing and
  // the sea is drawn on a grid three metres to a cell, so now and then a
  // crest still comes up through a corner of the deck — a flat sheet of
  // water slicing across the planks. Under a square of hull, water higher
  // than the deck is not drawn: the deck shows. (Below that, it is: between
  // the canes of a cane deck the sea still shows. Each raft's squares are a
  // 64×64 block of uHullMap.)
  //
  // And where the sea meets a raft, it froths: a ring of foam round the hull,
  // worked up as the swell slaps the logs and more as the raft makes way.
  float raftFoam = 0.0;
  for (int i = 0; i < ${HULLS}; i++) {
    if (i >= uHullN) break;
    vec3 l = (uHullInv[i] * vec4(vWorld, 1.0)).xyz;
    vec4 box = uHullBox[i];
    vec3 mv = uHullVel[i];
    float sk = smoothstep(0.05, 2.0, mv.z);
    vec2 fp = vWorld.xz * 0.9 + vec2(uTime * 0.11, -uTime * 0.07);
    if (l.x > box.x - 2.5 && l.x < box.z + 2.5 && l.z > box.y - 2.5 && l.z < box.w + 2.5) {
      // How far out from the nearest square of hull.
      vec2 c = floor(l.xz / ${RAFT_CELL.toFixed(1)} + 0.5);
      float out_ = 9.0;
      for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
        vec2 cc = c + vec2(float(a), float(b));
        if (hullAt(i, cc)) out_ = min(out_, length(max(abs(l.xz - cc * ${RAFT_CELL.toFixed(1)}) - ${(RAFT_CELL / 2).toFixed(1)}, 0.0)));
      }
      if (out_ == 0.0 && l.y > -0.01) discard;
      // (Higher up the hull the water is, the more it breaks on it.)
      float wash = smoothstep(-0.5, -0.12, l.y);
      // (Hugging the hull: a hand or two wide, a little more where the swell
      // rides up it or the raft is making way. Under the deck — between the
      // canes — the same, or the sea under it showed as a flat square.)
      float reach = 0.12 + 0.3 * cNoise(fp * 1.4) + 0.3 * wash + 0.5 * sk;
      float ring = 1.0 - smoothstep(0.0, reach, out_);
      raftFoam = max(raftFoam, ring * (0.3 + 0.4 * wash + 0.4 * sk) * froth(fp * 2.2));
    }
  }

  // ── the wake ──
  // Laid along where the raft has actually been, so it stays in the water
  // where it was made and bends where the raft turned. (Drawn from where the
  // raft was going this moment, the whole wake swung round with it on a turn.)
  // A wake is two things (Kelvin; and the ship-wake literature since): a
  // strip of churned water about the hull's width, which lasts and widens
  // ever more slowly; and the Kelvin arms, waves spreading from each point the
  // hull passed at a third of the speed it passed at — the 19.5° wedge. And
  // after the foam has gone a glassy streak stays, where the churning has
  // flattened the chop. The foam is a pattern fixed in the water, shown
  // through the wake's shape, and it breaks into patches as it ages.
  float wakeFoam = 0.0, slick = 0.0, bubbles = 0.0;
  float patches = cFbm(vWorld.xz * 2.1 + vec2(uTime * 0.03, -uTime * 0.02), 3);
  for (int t = 0; t < ${TRAILS}; t++) {
    vec4 inf = uTrailInfo[t];
    if (inf.x < 2.0) continue;
    vec4 bb = uTrailBox[t];
    if (vWorld.x < bb.x || vWorld.z < bb.y || vWorld.x > bb.z || vWorld.z > bb.w) continue;
    float along = 0.0;
    for (int i = 0; i < ${TRAIL_N - 1}; i++) {
      if (float(i + 1) >= inf.x) break;
      vec4 a = uTrail[t * ${TRAIL_N} + i], b = uTrail[t * ${TRAIL_N} + i + 1];
      vec2 seg = b.xy - a.xy;
      float L = length(seg);
      float hu = L > 1e-3 ? dot(vWorld.xz - a.xy, seg) / (L * L) : 0.0, h = clamp(hu, 0.0, 1.0);
      float lat = length(vWorld.xz - a.xy - seg * h);
      float s = along + L * h;
      along += L;
      float spd = mix(a.w, b.w, h);
      float sk = smoothstep(0.05, 2.0, spd);
      if (sk <= 0.0) continue;
      float age = max(uTime - mix(a.z, b.z, h), 0.0);
      // (Alongside the raft itself, the foam is the ring's.)
      float behind = smoothstep(inf.z * 0.5, inf.z + 1.0, s);
      float gone = 1.0 - smoothstep(${(TRAIL_AGE * 0.6).toFixed(2)}, ${TRAIL_AGE.toFixed(2)}, age);
      float w = inf.y * 0.6 + 0.45 * sqrt(age);
      float strip = 1.0 - smoothstep(w * 0.45, w, lat);
      float churn = strip * exp(-age / 9.0);
      // (Only abreast of a stretch, not round its ends: from every point of
      // the path at once, the arms were rings of circles.)
      float abreast = smoothstep(-0.15, 0.05, hu) * smoothstep(1.15, 0.95, hu);
      float arm = exp(-pow((lat - inf.y * 0.8 - 0.354 * spd * age) / (0.12 + 0.03 * age), 2.0)) * exp(-age / 4.0) * abreast;
      float broken = smoothstep(0.3 + age * 0.014, 0.52 + age * 0.014, patches);
      wakeFoam = max(wakeFoam, (churn * 0.6 * broken + arm * 0.25 * mix(0.5, 1.0, broken)) * sk * behind * gone);
      slick = max(slick, (1.0 - smoothstep(w * 0.6, w * 1.3, lat)) * exp(-age / 18.0) * sk * behind * gone);
      // (The bubbles still in the water under it: from above, a wake is a
      // pale green-blue band long after the white has gone.)
      bubbles = max(bubbles, strip * exp(-age / 14.0) * sk * behind * gone * mix(0.7, 1.0, patches));
    }
  }
  // ── splashes ──
  // White water where it went in, spreading and breaking up as it settles;
  // and rings running out over the swell from it — a ripple bends the light,
  // so they are drawn as a tilt of the surface, not a line on it.
  float splashFoam = 0.0;
  vec2 ripple = vec2(0.0);
  for (int i = 0; i < ${SPLASH_N}; i++) {
    vec4 sp = uSplash[i];
    float age = uTime - sp.z;
    if (age < 0.0 || age > ${SPLASH_LIFE.toFixed(1)}) continue;
    vec2 off = vWorld.xz - sp.xy;
    float d = length(off), sz = sp.w;
    if (d > 0.6 + 1.2 * age + 1.5 * sz) continue;
    float spread = (0.35 + 0.55 * sqrt(age)) * sz;
    float white = (1.0 - smoothstep(spread * 0.4, spread, d)) * exp(-age / (0.6 + 0.8 * sz));
    splashFoam = max(splashFoam, white * smoothstep(0.25 + age * 0.08, 0.5 + age * 0.08, patchy(vWorld.xz)));
    // Two rings, the second behind the first; fading as they spread.
    float fade = exp(-age / 1.8) * min(1.0, sz * 1.6);
    float r1 = 0.2 * sz + 1.05 * age, r2 = 0.1 * sz + 0.7 * age;
    float w1 = 0.06 + 0.05 * age;
    float ring = sin(clamp((d - r1) / w1, -3.14, 3.14)) * exp(-pow((d - r1) / (w1 * 1.6), 2.0))
               + 0.6 * sin(clamp((d - r2) / w1, -3.14, 3.14)) * exp(-pow((d - r2) / (w1 * 1.6), 2.0));
    ripple += off / max(d, 1e-3) * ring * fade * 0.35;
  }

  float k = calm(depth);
  vec3 N = waveNormal(vWorld.xz, uTime, openFor(depth));
  N = normalize(N + vec3(ripple.x, 0.0, ripple.y));
  // The wind's ripples, near enough to resolve (further out, past what a
  // pixel can hold, they would only shimmer: the glitter widens instead).
  // Rain beats them down.
  {
    float near = 1.0 - smoothstep(20.0, 110.0, length(cameraPosition - vWorld));
    vec2 rs = windRipples(vWorld.xz, uTime) * near * (1.0 - 0.5 * uRain);
    N = normalize(N + vec3(-rs.x, 0.0, -rs.y));
  }
  N = normalize(vec3(N.x * k, N.y, N.z * k));
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // Soften the normal with distance or the horizon turns into aliased confetti.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), clamp(dist / 160.0, 0.0, 0.92)));
  // (Flatter in a wake's slick: the chop smoothed out.)
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), slick * 0.45));

  // ── seen from underneath ──
  // Without this the surface is invisible from below and deep water reads as
  // empty void. Away from vertical the underside mirrors the water; looking
  // steeply up you see out through Snell's window. Which side you are on is
  // the sheet's own (it faces up): not the ripple's normal, which on a wave
  // face turned away from you, seen low across the water, tilts past your
  // eye — and that face was drawn as the underside, a black hole in the sea.
  if (!gl_FrontFacing) {
    if (dot(N, V) < 0.0) N = -N;
    // V runs fragment → camera, so a surface overhead gives V.y < 0: how
    // steeply we are looking up is -V.y.
    // (Wobbled by the ripples: the window's rim is never a clean circle.)
    float upness = clamp(-V.y + (N.x * V.x + N.z * V.z) * 0.35, 0.0, 1.0);
    // Snell's window: the whole sky squeezed into a cone 97° across overhead
    // (cos 48.6° = 0.66), the horizon at its rim and the zenith in the
    // middle — the brightest thing down here, nearly white at the rim where
    // the light comes in at a slant. Outside it the surface is a mirror of
    // the water below: the water's own colour, a little lighter. (It was
    // the sky's deep blue straight overhead, and the mirror the deep sea's
    // navy: from the reef, the surface was a dark lid.)
    float window = smoothstep(0.6, 0.7, upness);
    float t = clamp((upness - 0.66) / 0.34, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon * 1.25 + 0.12, uSkyTop * 1.1 + 0.05, sqrt(t)) * (1.0 - uNight * 0.85);
    vec3 mirrored = uUnderFog * 1.35 + vec3(0.01, 0.03, 0.04);
    vec3 col = mix(mirrored, sky, window);
    // A bright ring at the rim, where the light from the horizon crowds in.
    col += uSkyHorizon * 0.35 * window * (1.0 - smoothstep(0.0, 0.25, t)) * (1.0 - uNight);
    // The sun, squeezed toward the middle with the rest of the sky, and
    // glittering in the ripples round it.
    vec3 sunIn = normalize(vec3(uSunDir.x * 0.75, max(uSunDir.y, 0.05) + 0.4, uSunDir.z * 0.75));
    float sunAlign = max(dot(-V, sunIn), 0.0);
    float glint = 0.6 + 0.4 * sin(dot(N.xz, vec2(40.0, 31.0)) + uTime * 3.0);
    col += uSunColor * pow(sunAlign, 24.0) * 1.4 * window;
    col += uSunColor * pow(sunAlign, 4.0) * 0.12 * glint * window;
    // Fog the underside with the water we are actually standing in. Using the
    // air fog here made the whole ceiling fade to near-black a few metres out,
    // which is what the water column looked like from below: a lid, not a
    // surface.
    float dens = mix(uFogDensity * 3.0, uUnderDensity, uUnderwater);
    vec3 into = mix(uDeep * 0.75, uUnderFog, uUnderwater);
    // (The water fog as the fogged reef shows it — see the sky's water column.)
    into = mix(into, linearToOutputTexel(vec4(into, 1.0)).rgb, uUnderwater);
    float f = 1.0 - exp(-pow(dist * dens, 2.0));
    gl_FragColor = vec4(mix(col, into, clamp(f, 0.0, 1.0)) * uShade, 1.0);
    return;
  }

  // From above, a face turned just away from you is still the water's top, at
  // the grazing angle: the sky in it, as the faces either side have.
  if (dot(N, V) < 0.02) N = normalize(N + V * (0.02 - dot(N, V)));
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);
  // (Less of the sky in the shallowest water: you see down into it.)
  fres *= mix(0.3, 1.0, smoothstep(0.0, 2.0, depth));

  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
  // The clouds in it, broken up by the ripples as the sky is — and fainter:
  // the ripples smear them. (Drawn as crisp as in the sky, each was a ring of
  // bright squiggles on the water.)
  vec4 cl = cloudsAlong(R, uSunDir, uSunColor, uSkyTop, uSkyHorizon, uNight, 3);
  sky = mix(sky, cl.rgb, cl.a * 0.6);

  float crest = clamp(vHeight / max(vAmp * k, 0.05) * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, crest * crest);
  // Over sand a few metres deep the bed shows through: turquoise, then, in the
  // last hand's depth, the colour of wet sand.
  float lit = (0.5 + 0.5 * max(uSunDir.y, 0.0)) * (1.0 - uNight * 0.8);
  // (The sand bright under the last of the water — at 0.6 of it, a band of
  // muddy brown lay along every beach. And only the last of it: clear water
  // is aqua over sand by knee deep, and over a beach that shelves as gently
  // as the sand does — 4°, terrain.js — a metre and a half of it was twenty
  // metres of brown.)
  vec3 overSand = mix(uSand * 0.9, uTurquoise, smoothstep(0.02, 0.7, depth)) * lit;
  float shoal = 1.0 - smoothstep(0.4, 4.5, depth);
  body = mix(body, overSand, shoal * 0.85);

  // Light bleeding through the thin water at a wave crest.
  float through = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  body += uShallow * through * smoothstep(0.45, 1.0, crest) * 0.55;

  body = mix(body, uShallow * 1.25 + uTurquoise * 0.15, bubbles * 0.5);
  vec3 col = mix(body, sky, fres);

  vec3 H = normalize(uSunDir + V);
  // (A rougher sea scatters the sun into a wider, dimmer glitter.)
  float shine = mix(340.0, 120.0, clamp(uWind.z, 0.0, 1.0));
  col += uSunColor * pow(max(dot(N, H), 0.0), shine) * 2.6 * sqrt(shine / 340.0);
  col += uSunColor * pow(max(dot(N, H), 0.0), 22.0) * 0.06;
  // The rain on it, near enough to see each drop's ring; further off, the
  // pocked water only looks rougher and greyer.
  if (uRain > 0.01) {
    float nearRain = 1.0 - smoothstep(4.0, 22.0, dist);
    col += mix(uSkyHorizon, vec3(0.7), 0.3) * rainRings(vWorld.xz, uRain * 0.6) * 0.13 * nearRain;
    col = mix(col, uSkyHorizon * 0.85, uRain * 0.15 * (1.0 - nearRain));
  }

  // Whitecaps on the crests, fewer as the swell calms; and the wash along the
  // water's edge, coming and going with the swell.
  // (As many as the wind makes: few on a quiet day — none in a calm — and
  // more and bigger in a fresh wind or a squall.)
  float foam = smoothstep(0.87 - 0.2 * uWind.z, 0.99, crest) * clamp(0.1 + 0.6 * uWind.z, 0.0, 0.8) * smoothstep(0.3, 2.5, depth);
  float lap = 0.5 + 0.5 * sin(uTime * 0.8 + dot(vWorld.xz, vec2(0.071, 0.053)) + vHeight * 6.0);
  // (A thin, broken line: the last few centimetres, where the wash runs out.)
  float edge = 1.0 - smoothstep(${EDGE.toFixed(3)}, ${EDGE.toFixed(3)} + 0.05 + 0.1 * lap, water);
  float broken = 0.55 + 0.45 * sin(vWorld.x * 0.83 + uTime * 0.35) * sin(vWorld.z * 1.07 - uTime * 0.27);
  foam = max(foam, edge * broken * (0.3 + 0.35 * lap));
  foam = max(foam, raftFoam * 0.85);
  foam = max(foam, wakeFoam * 0.85);
  foam = max(foam, splashFoam * 0.9);
  col = mix(col, vec3(0.86, 0.94, 0.98) * (1.0 - uNight * 0.75), foam);

  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.2));
  col = mix(col, uFog, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col * uShade, 1.0);
}`;

const shoreTexture = new THREE.DataTexture(shoreHalf, SHORE_N, SHORE_N, THREE.RedFormat, THREE.HalfFloatType);
shoreTexture.wrapS = shoreTexture.wrapT = THREE.RepeatWrapping;
shoreTexture.magFilter = shoreTexture.minFilter = THREE.LinearFilter;
shoreTexture.generateMipmaps = false;
shoreTexture.needsUpdate = true;

/** Sample the bed for the cells (i, j) given, into the map. */
function sampleShore(i0, i1, j0, j1) {
  for (let j = j0; j < j1; j++) {
    const b = ((j % SHORE_N) + SHORE_N) % SHORE_N;
    for (let i = i0; i < i1; i++) {
      const a = ((i % SHORE_N) + SHORE_N) % SHORE_N;
      const h = Math.min(BED_HI, Math.max(BED_LO, seabed(i * SHORE_CELL, j * SHORE_CELL)));
      shoreData[b * SHORE_N + a] = h;
      shoreHalf[b * SHORE_N + a] = THREE.DataUtils.toHalfFloat(h);
    }
  }
}

/** Keep the map on the window round the camera: only the rows and columns it has moved on to. */
function followShore(x, z) {
  if (!seabed) return;
  const ci = Math.round(x / SHORE_CELL), cj = Math.round(z / SHORE_CELL), H = SHORE_N / 2;
  if (shore.dirty || shore.ci === null || Math.abs(ci - shore.ci) >= H || Math.abs(cj - shore.cj) >= H) {
    sampleShore(ci - H, ci + H, cj - H, cj + H);
  } else {
    // The columns and rows that have come into the window since last time.
    if (ci > shore.ci) sampleShore(shore.ci + H, ci + H, cj - H, cj + H);
    else if (ci < shore.ci) sampleShore(ci - H, shore.ci - H, cj - H, cj + H);
    if (cj > shore.cj) sampleShore(ci - H, ci + H, shore.cj + H, cj + H);
    else if (cj < shore.cj) sampleShore(ci - H, ci + H, cj - H, shore.cj - H);
    if (ci === shore.ci && cj === shore.cj) return;
  }
  shore.ci = ci; shore.cj = cj; shore.dirty = false;
  shoreTexture.needsUpdate = true;
}

export class Ocean {
  constructor(scene) {
    // Dense near the camera, and re-centred every frame so it reads as endless.
    const geo = new THREE.PlaneGeometry(900, 900, 300, 300);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime:       { value: 0 },
      uFogDensity: { value: 0.0042 },
      uNight:      { value: 0 },
      uSunDir:     { value: new THREE.Vector3(0.3, 0.6, 0.4) },
      uSunColor:   { value: new THREE.Color(1, 0.96, 0.86) },
      uSkyTop:     { value: new THREE.Color(0x2f7fb5) },
      uSkyHorizon: { value: new THREE.Color(0xbfd9e8) },
      uDeep:       { value: new THREE.Color(0x0b3a55) },
      uShallow:    { value: new THREE.Color(0x1d7d91) },
      uFog:        { value: new THREE.Color(0xbfd9e8) },
      // Set by src/underwater.js while the camera is under the surface.
      uUnderwater:  { value: 0 },
      uUnderDensity:{ value: 0.045 },
      uUnderFog:    { value: new THREE.Color(0x11536b) },
      // Set by main.js from caves.js: how much daylight reaches the camera —
      // in a sea cave, the water is as dark as the rock round it.
      uShade:       { value: 1 },
      // The bed round the camera (see setSeabed), and the colour of sand showing through the shallows.
      uShore:       { value: shoreTexture },
      uSand:        { value: new THREE.Color(0xc9b48a) },
      // The rafts' hulls, where the sea is not drawn over a deck (setHulls).
      uHullInv:     { value: Array.from({ length: HULLS }, () => new THREE.Matrix4()) },
      uHullN:       { value: 0 },
      uHullMap:     { value: hullTexture },
      uHullBox:     { value: Array.from({ length: HULLS }, () => new THREE.Vector4()) },
      uHullVel:     { value: Array.from({ length: HULLS }, () => new THREE.Vector3()) },
      // Where the rafts have been, for their wakes (setHulls).
      uTrail:       { value: Array.from({ length: TRAILS * TRAIL_N }, () => new THREE.Vector4()) },
      uTrailInfo:   { value: Array.from({ length: TRAILS }, () => new THREE.Vector4()) },
      uTrailBox:    { value: Array.from({ length: TRAILS }, () => new THREE.Vector4()) },
      ...CLOUDS,
      uTurquoise:   { value: new THREE.Color(0x3f9e9c) },
      ...SPLASHES,
      uRain:        { value: 0 },
      uStorm:       { value: 0 },
      // The sea state (setSea) and the wind's way (update).
      uSeaK:        { value: seaK },
      uWind:        { value: new THREE.Vector3(0.6, 0.8, SEA_AVG) },
    };

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.DoubleSide,        // the underside is shaded separately
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /** Where the rafts' decks are this frame, so the sea is not drawn over them. */
  setHulls(rafts, time = this.uniforms.uTime.value) {
    const u = this.uniforms;
    let n = 0, dirty = false;
    this._hullKeys ||= [];
    for (const r of rafts) {
      if (n >= HULLS || !r.cells?.size) continue;
      u.uHullInv.value[n].copy(r.group.matrixWorld).invert();
      // Its squares, redrawn only when they change.
      const key = [...r.cells.keys()].join(';');
      if (this._hullKeys[n] !== key) {
        this._hullKeys[n] = key;
        hullData.fill(0, n * 4096, (n + 1) * 4096);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const c of r.cells.values()) {
          const x = c.cx + 32, z = c.cz + 32;
          if (x >= 0 && x < 64 && z >= 0 && z < 64) hullData[n * 4096 + z * 64 + x] = 255;
          x0 = Math.min(x0, c.cx); x1 = Math.max(x1, c.cx); z0 = Math.min(z0, c.cz); z1 = Math.max(z1, c.cz);
        }
        const h = RAFT_CELL / 2;
        u.uHullBox.value[n].set(x0 * RAFT_CELL - h, z0 * RAFT_CELL - h, x1 * RAFT_CELL + h, z1 * RAFT_CELL + h);
        dirty = true;
      }
      // Its way through the water, turned into its own frame (for the wake).
      const v = _vel.set(r.vel?.x || 0, 0, r.vel?.y || 0), speed = v.length();
      if (speed > 1e-4) v.transformDirection(u.uHullInv.value[n]).multiplyScalar(speed);
      u.uHullVel.value[n].set(v.x, v.z, speed);
      if (n < TRAILS) this._trail(n, r, time, v, speed);
      n++;
    }
    if (dirty) hullTexture.needsUpdate = true;
    u.uHullN.value = n;
    for (let t = n; t < TRAILS; t++) u.uTrailInfo.value[t].x = 0;
  }

  /**
   * Where raft r (in slot t) has been: a point every TRAIL_STEP of sea time,
   * newest first, after where it is now — for the wake (see the shader).
   * v is its way through the water in its own frame.
   */
  _trail(t, r, time, v, speed) {
    const u = this.uniforms, box = u.uHullBox.value[t];
    this._trails ||= new WeakMap();
    let tr = this._trails.get(r);
    if (!tr) this._trails.set(r, tr = { pts: [], at: -Infinity });
    // Its middle, in the world.
    const mid = r.group.localToWorld(_mid.set((box.x + box.z) / 2, 0, (box.y + box.w) / 2));
    const last = tr.pts[0];
    // (Moved further than it could sail — set down somewhere new, or the clock
    // went back: the old wake is not behind it.)
    if (last && (Math.hypot(mid.x - last.x, mid.z - last.z) > 12 + speed * (time - last.t) || time < last.t)) {
      tr.pts.length = 0; tr.at = -Infinity;
    }
    if (time - tr.at >= TRAIL_STEP) {
      tr.pts.unshift({ x: mid.x, z: mid.z, t: time, v: speed });
      if (tr.pts.length > TRAIL_N - 1) tr.pts.length = TRAIL_N - 1;
      tr.at = time;
    }
    // Its size across its way and along it (the wake is as wide as the hull).
    const hx = (box.z - box.x) / 2, hz = (box.w - box.y) / 2;
    const ux = speed > 0.05 ? Math.abs(v.x / speed) : 0.7, uz = speed > 0.05 ? Math.abs(v.z / speed) : 0.7;
    const wid = Math.min(uz * hx + ux * hz, Math.max(hx, hz)), len = Math.min(ux * hx + uz * hz, Math.max(hx, hz));
    // Where it is now, then where it was.
    const base = t * TRAIL_N, arr = u.uTrail.value;
    arr[base].set(mid.x, mid.z, time, speed);
    let x0 = mid.x, x1 = mid.x, z0 = mid.z, z1 = mid.z, vmax = speed;
    for (let i = 0; i < tr.pts.length; i++) {
      const q = tr.pts[i];
      arr[base + 1 + i].set(q.x, q.z, q.t, q.v);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
      vmax = Math.max(vmax, q.v);
    }
    // As far out as any of it reaches: the slick, or the arms while they last.
    const reach = wid + Math.max(0.354 * vmax * 12, 0.45 * Math.sqrt(TRAIL_AGE) * 1.3) + 2;
    u.uTrailBox.value[t].set(x0 - reach, z0 - reach, x1 + reach, z1 + reach);
    u.uTrailInfo.value[t].set(1 + tr.pts.length, wid, len, 0);
  }

  update(time, camPos) {
    this.uniforms.uTime.value = time;
    // How rough, and which way the ripples run: the shared clock's wind.
    setSea(seaStateAt(time));
    this.uniforms.uWind.value.set(_wind.x, _wind.z, seaNow);
    followShore(camPos.x, camPos.z);
    // Snap to the vertex spacing so vertices don't crawl as we follow the camera.
    const step = 900 / 300;
    this.mesh.position.x = Math.round(camPos.x / step) * step;
    this.mesh.position.z = Math.round(camPos.z / step) * step;
  }
}
