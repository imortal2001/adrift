// ── Splashes ─────────────────────────────────────────────────────────────────
// Anything that goes into the sea: you off the side of the raft, a spear, the
// float of a line, a paddle, a felled tree, the flukes of a whale going down.
// A splash is three things, made in two places:
//
//   the spray   drops thrown up and out in a crown, falling back under their
//               own weight; and from a big one, a moment later, the jet that
//               rises where the cavity it punched closes again (a Worthington
//               jet). Particles here, one pool for every splash.
//   the water   white water where it went in, breaking up and spreading, and
//               rings running out from it. Drawn by the ocean's own shader
//               (SPLASHES, in ocean.js), so they lie on the swell and ride it — the
//               flat ring the fishing float used to make sank into the face of
//               a wave, or stood off the back of one.
//   the sound   a plop for a small one, a slap and a rush for a big one.
//
// Anyone can make one, from anywhere: splash(at, size). `size` is about the
// size of what went in, in metres: 0.3 a paddle, 0.5 a spear, 1 you.

import * as THREE from 'three';
import { waveHeight, SPLASHES, SPLASH_N } from './ocean.js';
import * as sound from './sound.js';

const DROPS = 900;                 // the spray pool, shared
const GRAVITY = 9.8;
// A drop's life: FREE in the pool; WAITING to be thrown (the jet); then 0..1.
const FREE = -1, WAITING = -0.5;

const pending = [];
let slot = 0;

/**
 * Something went into the sea at `at` (world; y is ignored: it is the
 * surface's). `delay` seconds from now — for a paddle, when the blade is in.
 * `quiet`: no sound (a whale's own, or one already heard).
 */
export function splash(at, size = 1, { delay = 0, quiet = false } = {}) {
  if (pending.length > 32) pending.shift();
  pending.push({ x: at.x, z: at.z, size, delay, quiet });
}

const vert = /* glsl */`
attribute float aLife;     // 0 just thrown .. 1 gone; < 0 not in use
attribute float aSize;     // metres across
uniform float uViewH;
varying float vLife, vMist;
void main(){
  vLife = aLife;
  vMist = smoothstep(0.12, 0.3, aSize);   // the big ones are mist, not drops
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife < 0.0 ? 0.0 : aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1);
}`;
const frag = /* glsl */`
uniform vec3 uColor;
varying float vLife, vMist;
void main(){
  if (vLife < 0.0) discard;
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  // A drop: bright in the middle, soft at the rim; fading as it falls back.
  float a = (1.0 - r) * (1.0 - vLife * vLife) * mix(0.85, 0.26, vMist);
  gl_FragColor = vec4(uColor, a);
}`;

export class Splashes {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(DROPS * 3);
    this.life = new Float32Array(DROPS).fill(FREE);
    this.size = new Float32Array(DROPS);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.uniforms = { uViewH: { value: 800 }, uColor: { value: new THREE.Color(0xe8f2f6) } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this.vel = new Float32Array(DROPS * 3);
    this.wait = new Float32Array(DROPS);    // s before a drop leaves (the jet comes after the crown)
    this.ttl = new Float32Array(DROPS);     // s it may live
    this.age = new Float32Array(DROPS);
    this.next = 0;
    this.time = 0;
  }

  /** A free drop (or the oldest, if none is). */
  take() {
    for (let k = 0; k < DROPS; k++) {
      const i = (this.next + k) % DROPS;
      if (this.life[i] === FREE) { this.next = (i + 1) % DROPS; return i; }
    }
    const i = this.next; this.next = (i + 1) % DROPS; return i;
  }

  drop(x, y, z, vx, vy, vz, size, ttl, wait = 0) {
    const i = this.take();
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.ttl[i] = ttl; this.wait[i] = wait; this.age[i] = 0;
    this.life[i] = wait > 0 ? WAITING : 0;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }

  /** Make one now: the spray, the mark on the water, the sound. */
  make(s, time) {
    // (Bigger than a person, it goes up faster than the square root: a log
    // or a fluke throws water well over head height.)
    const y = waveHeight(s.x, s.z, time), k = Math.sqrt(s.size) * (s.size > 1 ? Math.pow(s.size, 0.35) : 1);
    // On the water: a slot of the ocean's, the oldest given up.
    SPLASHES.uSplash.value[slot].set(s.x, s.z, time, s.size);
    slot = (slot + 1) % SPLASH_N;
    // The crown: out and up all round, faster and higher the bigger it is.
    const n = Math.round(4 + 66 * Math.pow(Math.min(2.5, s.size), 1.4));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, out = (0.6 + Math.random() * 1.6) * k, up = (1.2 + Math.random() * 2.6) * k;
      const r = 0.15 * s.size * Math.random();
      this.drop(s.x + Math.cos(a) * r, y + 0.03, s.z + Math.sin(a) * r, Math.cos(a) * out, up, Math.sin(a) * out,
                (0.035 + Math.random() * 0.06) * (0.7 + 0.35 * s.size), 2.5);
    }
    // Mist off a big one: a few broad, faint puffs.
    if (s.size >= 0.8) {
      for (let i = 0; i < 6 + 8 * s.size; i++) {
        const a = Math.random() * Math.PI * 2, out = (0.4 + Math.random()) * k;
        this.drop(s.x, y + 0.1, s.z, Math.cos(a) * out, (1 + Math.random() * 1.5) * k, Math.sin(a) * out,
                  (0.25 + Math.random() * 0.25) * k, 1.2);
      }
      // The jet, after the cavity closes: straight up from the middle.
      const m = Math.round(8 + 10 * s.size);
      for (let i = 0; i < m; i++) {
        this.drop(s.x + (Math.random() - 0.5) * 0.1, y, s.z + (Math.random() - 0.5) * 0.1,
                  (Math.random() - 0.5) * 0.5, (3.2 + Math.random() * 2.2) * k, (Math.random() - 0.5) * 0.5,
                  0.05 + Math.random() * 0.05, 2.5, 0.14 + 0.05 * s.size + Math.random() * 0.06);
      }
    }
    if (!s.quiet) sound.splash(new THREE.Vector3(s.x, y, s.z), s.size);
  }

  update(dt, time, camera, renderer, sky = null) {
    this.time = time;
    // Those due.
    for (let i = pending.length - 1; i >= 0; i--) {
      const s = pending[i];
      s.delay -= dt;
      if (s.delay <= 0) { pending.splice(i, 1); this.make(s, time); }
    }
    let any = false;
    for (let i = 0; i < DROPS; i++) {
      if (this.life[i] === FREE) continue;
      if (this.wait[i] > 0) { this.wait[i] -= dt; if (this.wait[i] <= 0) this.life[i] = 0; else continue; }
      any = true;
      const j = i * 3;
      this.vel[j + 1] -= GRAVITY * dt;
      // (A little air drag: spray slows.)
      const drag = Math.exp(-dt * 0.6);
      this.vel[j] *= drag; this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.age[i] += dt;
      // Back into the sea, or spent.
      const sea = waveHeight(this.pos[j], this.pos[j + 2], time);
      if ((this.vel[j + 1] < 0 && this.pos[j + 1] < sea) || this.age[i] > this.ttl[i]) { this.life[i] = FREE; continue; }
      this.life[i] = Math.min(0.99, this.age[i] / this.ttl[i]);
    }
    this.points.visible = any;
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.aLife.needsUpdate = true;
    this.uniforms.uViewH.value = renderer ? renderer.domElement.height : innerHeight * devicePixelRatio;
    // Lit as the day is: white in the sun, grey-blue at dusk, dim at night.
    if (sky) {
      const day = 1 - sky.night;
      this.uniforms.uColor.value.setRGB(0.5 + 0.45 * day, 0.55 + 0.42 * day, 0.6 + 0.38 * day);
    }
  }
}
