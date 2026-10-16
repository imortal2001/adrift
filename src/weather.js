// ── Weather ──────────────────────────────────────────────────────────────────
// Fair trade-wind days, broken by squalls: a bank of cloud comes up, the light
// goes grey, the wind freshens ahead of it, and for a minute or two it pours —
// then it is past, and the sun is out again. That is the weather of the
// tropical open ocean, and the only rain a raft gets: its collector fills in a
// squall far faster than on dew.
//
// It runs on the shared sea clock, like the wind (raft.js windAt), so everyone
// on a raft together is rained on at once. weatherAt(time) says how much rain
// and how much gloom there is; the sky darkens with it (sky.js), the clouds
// thicken (clouds.js), the sea goes grey and rough and is pocked by the drops
// (ocean.js); and Weather draws the rain itself, round the camera, and plays it.

import * as THREE from 'three';
import * as sound from './sound.js';

const PERIOD = 420;                // s of sea time; in each, a squall or not
const CHANCE = 0.42;               // of one
const AHEAD = 60;                  // s the cloud comes over before the rain
const AFTER = 45;                  // s it takes to clear after

/** This frame's weather, for whatever reads it (sky, ocean, raft). `override` for the admin tools and the gallery. */
export const WEATHER = { rain: 0, gloom: 0, override: null };

const fract = x => x - Math.floor(x);
const hash = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The weather at sea-clock `time`: rain 0..1 (how hard it is raining) and
 * gloom 0..1 (how much of the sky the squall has, which comes before the rain
 * and goes after it). The same on every machine.
 */
export function weatherAt(time, out = { rain: 0, gloom: 0 }) {
  out.rain = 0; out.gloom = 0;
  const k = Math.floor(time / PERIOD);
  // This period's squall, and the last one's (a late one runs on into this).
  for (let j = k - 1; j <= k; j++) {
    // (None in the first: the first minutes are for finding your feet.)
    if (j < 1 || hash(j) > CHANCE) continue;
    const start = j * PERIOD + AHEAD + hash(j + 0.31) * (PERIOD - 260);
    const len = 60 + hash(j + 0.57) * 80;          // a minute to two and a bit of rain
    const hard = 0.55 + 0.45 * hash(j + 0.83);
    const x = time - start;
    if (x < -AHEAD || x > len + AFTER) continue;
    out.gloom = Math.max(out.gloom, hard * smooth(-AHEAD, -8, x) * (1 - smooth(len, len + AFTER, x)));
    // It comes on hard and eases off.
    out.rain = Math.max(out.rain, hard * smooth(-6, 12, x) * (1 - smooth(len * 0.6, len + 10, x)));
  }
  return out;
}

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
  // A squall brings its own wind: it freshens as the cloud comes over, and
  // gusts while it rains (weatherAt, above).
  const w = weatherAt(time, _weather);
  if (w.gloom > 0) out.strength = Math.min(1, out.strength + 0.22 * w.gloom + 0.12 * w.rain * Math.sin(time * 0.9) ** 2);
  return out;
}
const _weather = { rain: 0, gloom: 0 };

// ── the rain ─────────────────────────────────────────────────────────────────
const DROPS = 3200;
const BOX = [34, 22, 34];          // m: the volume of rain kept round the camera
const rainVert = /* glsl */`
attribute vec4 aSeed;              // xyz where in the box; w which drops fall in light rain
attribute float aEnd;              // 0 the head of the streak, 1 its tail
uniform vec3 uCam;
uniform float uTime, uRain, uShelter;
uniform vec2 uWind;
varying float vA;
const vec3 BOX = vec3(${BOX.map(v => v.toFixed(1)).join(', ')});
void main(){
  // Falling at 7-10 m/s, slanted by the wind.
  vec3 v = vec3(uWind.x * 3.5, -(7.0 + aSeed.x * 3.0), uWind.y * 3.5);
  vec3 lo = uCam - BOX * 0.5;
  vec3 p = mod(aSeed.xyz * BOX + v * uTime - lo, BOX) + lo;
  // (The tail: where it was a moment ago — a drop is a streak in a frame.)
  p -= v * 0.04 * aEnd;
  float d = length(p.xz - uCam.xz);
  vA = step(aSeed.w, uRain)
     // fading at the edges of the box, so drops do not wink in and out there
     * smoothstep(BOX.x * 0.5, BOX.x * 0.3, d) * smoothstep(0.0, 3.0, p.y - lo.y) * smoothstep(0.0, 3.0, lo.y + BOX.y - p.y)
     // not under the sea; not under the roof you are standing under
     * step(0.0, p.y) * (1.0 - uShelter * step(d, 2.6) * step(uCam.y - 2.8, p.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const rainFrag = /* glsl */`
uniform vec3 uColor;
varying float vA;
void main(){
  if (vA < 0.01) discard;
  gl_FragColor = vec4(uColor, vA * 0.32);
}`;

export class Weather {
  constructor(scene) {
    const pos = new Float32Array(DROPS * 2 * 3);         // (all at the origin: the shader places them)
    const seed = new Float32Array(DROPS * 2 * 4), end = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random() * 0.98 + 0.02];
      for (let e = 0; e < 2; e++) { seed.set(s, (i * 2 + e) * 4); end[i * 2 + e] = e; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRain: { value: 0 }, uShelter: { value: 0 },
      uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0xc8d2da) },
    };
    this.mesh = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: rainVert, fragmentShader: rainFrag,
      transparent: true, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.state = { rain: 0, gloom: 0 };
    this.raining = false;
  }

  /**
   * The weather now, at sea-clock `time`: into WEATHER, and the rain drawn
   * round `camera` and heard. `under`: the camera is under water; `sheltered`:
   * under a roof; `wind` as windAt gives it; `night` 0..1.
   */
  update(dt, time, camera, { under = false, sheltered = false, wind = null, night = 0 } = {}) {
    const w = WEATHER.override || weatherAt(time, this.state);
    WEATHER.rain = w.rain; WEATHER.gloom = w.gloom;
    const u = this.uniforms;
    u.uCam.value.copy(camera.position);
    u.uTime.value = time % 1000;
    u.uRain.value = w.rain;
    u.uShelter.value = sheltered ? 1 : 0;
    if (wind) u.uWind.value.set(wind.x * wind.strength, wind.z * wind.strength);
    // Grey, and darker at night.
    u.uColor.value.setScalar(0.78 - 0.55 * night).multiply(_tint);
    this.mesh.visible = w.rain > 0.01 && !under;
    // Heard: the hiss of it on the sea, and the drum of it on a roof over you.
    sound.rain(under ? w.rain * 0.15 : w.rain, sheltered);
    const now = w.rain > 0.2;
    if (now !== this.raining) { this.raining = now; this.changed = now ? 'rain' : 'dry'; }
  }
}
const _tint = new THREE.Color(0.95, 1.0, 1.06);
