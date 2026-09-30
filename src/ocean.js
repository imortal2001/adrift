// ── Ocean ────────────────────────────────────────────────────────────────────
// One wave definition, two consumers: the GPU displaces the mesh with it, and
// the CPU samples the exact same sum so the raft, the player and every piece of
// floating debris ride the swell you actually see.

import * as THREE from 'three';

const TAU = Math.PI * 2;

// dir is normalised at build time. len = crest-to-crest metres, speed = m/s-ish.
const WAVES = [
  { dir: [ 1.00,  0.32], amp: 0.40, len: 27.0, speed: 1.00 },
  { dir: [-0.62,  0.88], amp: 0.24, len: 14.5, speed: 1.30 },
  { dir: [ 0.88, -0.52], amp: 0.13, len: 7.80, speed: 1.70 },
  { dir: [-0.24, -0.98], amp: 0.06, len: 4.10, speed: 2.15 },
].map(w => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  const k = TAU / w.len;
  return { dx: w.dir[0] / l, dz: w.dir[1] / l, amp: w.amp, k, w: w.speed * k };
});

export const WAVE_AMPLITUDE = WAVES.reduce((s, w) => s + w.amp, 0);

// ── the shallows ──
// The swell is the open sea's. Coming in over a shelving beach it loses its
// height, and over the land itself there is none — or the crests would rise
// up through low sand. So the sea knows the ground under it: a map of the bed
// round the camera (SHORE_N cells of SHORE_CELL m, one per vertex of the
// sheet, wrapping as the camera moves so only the new edge is ever sampled),
// and the swell is calmed by how deep the water is. The GPU and the CPU read
// the same map, so what floats rides the sea you see.
const SEA = 900, SHORE_N = 300, SHORE_CELL = SEA / SHORE_N;
const BED_LO = -8, BED_SPAN = 12;             // stored: the bed from 8 m down to 4 m up, in 256 steps
const shoreData = new Uint8Array(SHORE_N * SHORE_N);    // (0: 8 m down or more — the open sea)
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
  return shoreData[b * SHORE_N + a] / 255 * BED_SPAN + BED_LO;
}

/** How much of the open sea's swell there is here: 1 offshore, less in the shallows, none over land. */
export function shoreCalm(x, z) {
  if (!seabed) return 1;
  const fx = x / SHORE_CELL, fz = z / SHORE_CELL, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const bed = (bedCell(i, j) * (1 - u) + bedCell(i + 1, j) * u) * (1 - v) + (bedCell(i, j + 1) * (1 - u) + bedCell(i + 1, j + 1) * u) * v;
  return calmFor(-bed);
}

/** (The same as the shader's calm().) */
function calmFor(depth) {
  const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return s(-0.4, 0.0, depth) * (0.18 + 0.82 * s(0.0, 4.0, depth));
}

/** Surface height at world (x,z) and time t. */
export function waveHeight(x, z, t) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.k - t * w.w);
  }
  return seabed ? h * shoreCalm(x, z) : h;
}

/** Analytic surface normal — same derivative the fragment shader uses. */
export function waveNormal(x, z, t, out = new THREE.Vector3()) {
  let dx = 0, dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const c = w.amp * w.k * Math.cos((w.dx * x + w.dz * z) * w.k - t * w.w);
    dx += c * w.dx;
    dz += c * w.dz;
  }
  const k = seabed ? shoreCalm(x, z) : 1;
  return out.set(-dx * k, 1, -dz * k).normalize();
}

// The identical sum, compiled into GLSL from the table above so the two can
// never drift apart.
const WAVE_GLSL = /* glsl */`
struct Wave { vec2 dir; float amp; float k; float w; };
const int WAVE_N = ${WAVES.length};
Wave waves[WAVE_N] = Wave[WAVE_N](
${WAVES.map(w =>
  `  Wave(vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}), ${w.amp.toFixed(6)}, ${w.k.toFixed(6)}, ${w.w.toFixed(6)})`
).join(',\n')}
);
float waveHeight(vec2 p, float t){
  float h = 0.0;
  for(int i = 0; i < WAVE_N; i++){
    Wave wv = waves[i];
    h += wv.amp * sin(dot(wv.dir, p) * wv.k - t * wv.w);
  }
  return h;
}
vec3 waveNormal(vec2 p, float t){
  vec2 d = vec2(0.0);
  for(int i = 0; i < WAVE_N; i++){
    Wave wv = waves[i];
    float c = wv.amp * wv.k * cos(dot(wv.dir, p) * wv.k - t * wv.w);
    d += c * wv.dir;
  }
  return normalize(vec3(-d.x, 1.0, -d.y));
}`;

const SHORE_GLSL = /* glsl */`
uniform sampler2D uShore;
float seaDepth(vec2 p){
  float bed = texture2D(uShore, (p / ${SHORE_CELL.toFixed(4)} + 0.5) / ${SHORE_N.toFixed(1)}).r * ${BED_SPAN.toFixed(1)} + ${BED_LO.toFixed(1)};
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
${WAVE_GLSL}
${SHORE_GLSL}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDepth = seaDepth(wp.xz);
  vHeight = waveHeight(wp.xz, uTime) * calm(vDepth);
  wp.y += vHeight;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */`
uniform float uTime, uFogDensity, uNight;
uniform float uUnderwater, uUnderDensity, uShade;
uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uDeep, uShallow, uFog, uUnderFog, uSand, uTurquoise;
varying vec3 vWorld;
varying float vHeight;
varying float vDepth;
${WAVE_GLSL}
${SHORE_GLSL}
void main(){
  // (Per fragment, not the vertex's: the beach line is finer than the mesh.)
  float depth = seaDepth(vWorld.xz);
  float k = calm(depth);
  vec3 N = waveNormal(vWorld.xz, uTime);
  N = normalize(vec3(N.x * k, N.y, N.z * k));
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // Soften the normal with distance or the horizon turns into aliased confetti.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), clamp(dist / 160.0, 0.0, 0.92)));

  // ── seen from underneath ──
  // Without this the surface is invisible from below and deep water reads as
  // empty void. Away from vertical the underside mirrors the water; looking
  // steeply up you see out through Snell's window.
  if (dot(N, V) < 0.0) {
    N = -N;
    // V runs fragment → camera, so a surface overhead gives V.y < 0: how
    // steeply we are looking up is -V.y.
    float upness = clamp(-V.y, 0.0, 1.0);
    float window = smoothstep(0.22, 0.88, upness);
    vec3 outside = mix(uSkyHorizon, uSkyTop, upness) * (1.0 - uNight * 0.7);
    vec3 mirrored = mix(uDeep, uShallow, 0.55);
    vec3 col = mix(mirrored, outside, window);
    // The sun, smeared across the window.
    float sunAlign = max(dot(-V, uSunDir), 0.0);
    col += uSunColor * pow(sunAlign, 16.0) * 0.7 * window;
    col += uSunColor * pow(sunAlign, 3.0) * 0.06 * window;
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

  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);
  // (Less of the sky in the shallowest water: you see down into it.)
  fres *= mix(0.3, 1.0, smoothstep(0.0, 2.0, depth));

  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));

  float crest = clamp(vHeight / max(${WAVE_AMPLITUDE.toFixed(3)} * k, 0.05) * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, crest * crest);
  // Over sand a few metres deep the bed shows through: turquoise, then, in the
  // last hand's depth, the colour of wet sand.
  float lit = (0.5 + 0.5 * max(uSunDir.y, 0.0)) * (1.0 - uNight * 0.8);
  vec3 overSand = mix(uSand * 0.6, uTurquoise, smoothstep(0.05, 1.4, depth)) * lit;
  float shoal = 1.0 - smoothstep(0.4, 4.5, depth);
  body = mix(body, overSand, shoal * 0.85);

  // Light bleeding through the thin water at a wave crest.
  float through = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  body += uShallow * through * smoothstep(0.45, 1.0, crest) * 0.55;

  vec3 col = mix(body, sky, fres);

  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 340.0) * 2.6;
  col += uSunColor * pow(max(dot(N, H), 0.0), 22.0) * 0.06;

  // Whitecaps on the crests, fewer as the swell calms; and the wash along the
  // water's edge, coming and going with the swell.
  float foam = smoothstep(0.80, 0.99, crest) * 0.5 * smoothstep(0.3, 2.5, depth);
  float lap = 0.5 + 0.5 * sin(uTime * 0.8 + dot(vWorld.xz, vec2(0.071, 0.053)) + vHeight * 6.0);
  // (A thin, broken line: the last few centimetres, where the wash runs out.)
  float edge = (1.0 - smoothstep(0.0, 0.05 + 0.1 * lap, depth)) * smoothstep(-0.12, 0.0, depth);
  float broken = 0.55 + 0.45 * sin(vWorld.x * 0.83 + uTime * 0.35) * sin(vWorld.z * 1.07 - uTime * 0.27);
  foam = max(foam, edge * broken * (0.3 + 0.35 * lap));
  col = mix(col, vec3(0.86, 0.94, 0.98) * (1.0 - uNight * 0.75), foam);

  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.2));
  col = mix(col, uFog, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col * uShade, 1.0);
}`;

const shoreTexture = new THREE.DataTexture(shoreData, SHORE_N, SHORE_N, THREE.RedFormat, THREE.UnsignedByteType);
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
      const h = seabed(i * SHORE_CELL, j * SHORE_CELL);
      shoreData[b * SHORE_N + a] = Math.round(Math.min(1, Math.max(0, (h - BED_LO) / BED_SPAN)) * 255);
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
      uDeep:       { value: new THREE.Color(0x05222f) },
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
      uTurquoise:   { value: new THREE.Color(0x3f9e9c) },
    };

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.DoubleSide,        // the underside is shaded separately
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(time, camPos) {
    this.uniforms.uTime.value = time;
    followShore(camPos.x, camPos.z);
    // Snap to the vertex spacing so vertices don't crawl as we follow the camera.
    const step = 900 / 300;
    this.mesh.position.x = Math.round(camPos.x / step) * step;
    this.mesh.position.z = Math.round(camPos.z / step) * step;
  }
}
