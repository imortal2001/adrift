// ── Insects ──────────────────────────────────────────────────────────────────
// The small life ashore, near you: there was none, and the island was a
// museum of plants.
//
//   dragonflies  over fresh water: hovering, then darting off a few metres
//                and stopping dead again, a little above the surface.
//   butterflies  over open, sunny ground by day: the jinking, bobbing flight
//                of big wings beating slowly.
//   fireflies    at night, in the grass and at the forest's edge: points of
//                yellow-green light, each blinking on its own beat.
//   and heard    cicadas buzzing by day, crickets chirping by night — ashore,
//                and faintly from the shore out at sea (sound.js insects).
//
// Dragonflies and butterflies are instanced fliers (fliers.js), fireflies one
// cloud of points.

import * as THREE from 'three';
import { heightAt, landAt, moistureAt, slopeAt, forestAt, freshWaterAt, coastDistance } from './terrain.js';
import { wingedBody, wingMaterial } from './fliers.js';
import * as sound from './sound.js';

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const forest = (x, z) => forestAt(x, z, landAt(x, z), moistureAt(x, z), slopeAt(x, z));

// Two pairs of glass wings, each a dark spot at the tip (the pterostigma).
export const DRAGONFLY = { len: 0.075, girth: 0.004, head: 0.007, beak: 0.002, span: 0.1, root: 0.018, wrist: 0.5,
  sweepIn: 0.002, sweepOut: 0.004, chord: 0.012, tipChord: 0.55, tipFrom: 0.9, tail: 0.002, tailFork: 0.001, wingAlpha: 0.32,
  hind: { back: 0.016, span: 0.95, chord: 0.015, tipChord: 0.5 },
  back: 0x2f6fd0, belly: 0x2f6fd0, headCol: 0x1f3f70, beakCol: 0x1f3f70, wingCol: 0xe6eef2, tipCol: 0x2a2620, tailCol: 0x2f6fd0 };
// A forewing reaching forward to a rounded point, and a broad rounded hindwing behind it.
export const BUTTERFLY = { len: 0.028, girth: 0.004, head: 0.004, beak: 0.002, span: 0.075, root: 0.012, wrist: 0.55,
  sweepIn: 0.014, sweepOut: 0.02, chord: 0.026, tipChord: 0.35, tipFrom: 0.84, tail: 0.002, tailFork: 0.001, round: true,
  hind: { back: 0.012, span: 0.72, chord: 0.026, tipChord: 0.5, sweep: 0.012 },
  // (The wings white: each butterfly's colour is its instance's, and multiplies them.)
  back: 0x2a2018, belly: 0x2a2018, headCol: 0x2a2018, beakCol: 0x2a2018, wingCol: 0xffffff, tipCol: 0x2a2018, tailCol: 0x2a2018 };
const BUTTERFLY_COLOURS = [0xe08a2a, 0xf0d040, 0x3a6ad8, 0xf2f0e6, 0xd84a2a];

const DRAGON_N = 6, BUTTER_N = 10, FIREFLY_N = 150;

class Swarm {
  constructor(scene, geo, n) {
    this.n = n;
    this.flap = new Float32Array(n * 3);
    geo.setAttribute('iFlap', new THREE.InstancedBufferAttribute(this.flap, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.InstancedMesh(geo, wingMaterial({ roughness: 0.5, transparent: true, depthWrite: true }), n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3();
  }
  draw(list) {
    let k = 0;
    for (const b of list) {
      if (b.hidden) continue;
      this._q.setFromEuler(this._e.set(-b.pitch, b.heading, b.bank || 0, 'YXZ'));
      this._m.compose(b.pos, this._q, this._s.setScalar(b.scale ?? 1));
      this.mesh.setMatrixAt(k, this._m);
      if (b.colour) this.mesh.setColorAt(k, b.colour);
      this.flap[k * 3] = b.phase; this.flap[k * 3 + 1] = b.stroke; this.flap[k * 3 + 2] = 0;
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.geometry.attributes.iFlap.needsUpdate = true;
  }
}

export const fireflyVert = /* glsl */`
attribute float aGlow;
uniform float uViewH;
varying float vGlow;
void main(){
  vGlow = aGlow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // (A point of light and the glow round it in the night air: drawn at a
  // body's size it was a speck no one saw.)
  gl_PointSize = aGlow <= 0.0 ? 0.0 : max(3.0, (0.12 + 0.3 * aGlow) * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1));
}`;
export const fireflyFrag = /* glsl */`
varying float vGlow;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0 || vGlow <= 0.0) discard;
  float core = exp(-r * 18.0), halo = exp(-r * 3.5) * 0.35;
  gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * vGlow * (core * 2.0 + halo), 1.0);
}`;

export class Insects {
  constructor(scene) {
    this.dragon = new Swarm(scene, wingedBody(DRAGONFLY), DRAGON_N);
    this.butter = new Swarm(scene, wingedBody(BUTTERFLY), BUTTER_N);
    this.dragons = []; this.butters = []; this.water = []; this.waterAt = null; this.waterIn = 0;
    // Fireflies: a cloud of points round you, each blinking on its own beat.
    const pos = new Float32Array(FIREFLY_N * 3), glow = new Float32Array(FIREFLY_N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1).setUsage(THREE.DynamicDrawUsage));
    this.flyU = { uViewH: { value: 800 } };
    this.fireflies = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.flyU, vertexShader: fireflyVert, fragmentShader: fireflyFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.fireflies.frustumCulled = false;
    this.fireflies.visible = false;
    scene.add(this.fireflies);
    this.flies = Array.from({ length: FIREFLY_N }, () => ({ placed: false, beat: rand(2, 5), off: Math.random() * 5, drift: new THREE.Vector3() }));
  }

  /**
   * `hub` where you are; `day` 0..1 (sunlight), `night` 0..1, `ashore` on
   * land, `rain` 0..1.
   */
  update(dt, time, hub, { day = 1, night = 0, ashore = false, rain = 0, viewH = 800 } = {}) {
    if (dt <= 0) return;
    this.updateDragonflies(dt, time, hub, day, rain);
    this.updateButterflies(dt, time, hub, day, ashore, rain);
    this.updateFireflies(dt, time, hub, night, ashore, rain, viewH);
    // Heard: by day the cicadas in the trees, by night the crickets in the grass.
    // Out at sea, from the shore, fainter the further out; under a squall's rain, hushed.
    const shore = ashore ? 1 : 1 - THREE.MathUtils.smoothstep(Math.max(0, -coastDistance(hub.x, hub.z)), 15, 120);
    const wood = ashore ? 0.35 + 0.65 * Math.min(1, forest(hub.x, hub.z) * 2) : 0.6;
    const hush = 1 - Math.min(1, rain * 1.4);
    sound.insects(day * shore * wood * hush * 0.8, night * shore * hush);
  }

  // ── dragonflies, over fresh water ──
  updateDragonflies(dt, time, hub, day, rain) {
    // Where the water is near you: looked over now and then.
    if ((this.waterIn -= dt) <= 0) {
      this.waterIn = 3;
      this.water.length = 0;
      for (let dz = -40; dz <= 40; dz += 5) for (let dx = -40; dx <= 40; dx += 5) {
        const x = hub.x + dx, z = hub.z + dz, w = freshWaterAt(x, z);
        if (w && w.depth > 0.15) this.water.push({ x, z, level: w.level });
      }
    }
    if (!this.water.length || day < 0.2 || rain > 0.5) { this.dragon.draw([]); return; }
    while (this.dragons.length < DRAGON_N) {
      const home = this.water[Math.random() * this.water.length | 0];
      // (One colour, the body's own: a tint per insect would colour its clear wings too.)
      this.dragons.push({ home, pos: new THREE.Vector3(home.x, home.level + 0.8, home.z), to: new THREE.Vector3(), state: 'hover', t: rand(0.3, 2),
        heading: Math.random() * TAU, pitch: 0, bank: 0, phase: 0, stroke: 0.3, scale: rand(0.9, 1.15) });
    }
    for (const d of this.dragons) {
      // (Its pond left behind: a new one.)
      if (Math.hypot(d.home.x - hub.x, d.home.z - hub.z) > 50) { d.home = this.water[Math.random() * this.water.length | 0]; d.pos.set(d.home.x, d.home.level + 0.8, d.home.z); }
      if (d.state === 'hover') {
        d.pos.y += Math.sin(time * 9 + d.scale * 20) * 0.03 * dt;
        if ((d.t -= dt) <= 0) {
          d.state = 'dart';
          const a = Math.random() * TAU, r = rand(1, 4);
          d.to.set(d.home.x + Math.cos(a) * r * 1.5, d.home.level + rand(0.35, 1.5), d.home.z + Math.sin(a) * r * 1.5);
        }
      } else {
        const v = d.to.clone().sub(d.pos), dist = v.length();
        if (dist < 0.08) { d.state = 'hover'; d.t = rand(0.4, 2.5); }
        else {
          d.pos.addScaledVector(v, Math.min(1, (6 * dt) / dist));
          d.heading = Math.atan2(v.x, v.z);
        }
      }
      d.phase += dt * TAU * 27; d.stroke = 0.3;
    }
    this.dragon.draw(this.dragons);
  }

  // ── butterflies, over open sunny ground ──
  updateButterflies(dt, time, hub, day, ashore, rain) {
    if (!ashore || day < 0.4 || rain > 0.2) { this.butter.draw([]); return; }
    const spot = () => {
      for (let k = 0; k < 12; k++) {
        const a = Math.random() * TAU, r = rand(4, 25), x = hub.x + Math.cos(a) * r, z = hub.z + Math.sin(a) * r;
        if (heightAt(x, z) > 1.5 && forest(x, z) < 0.35 && !freshWaterAt(x, z)) return new THREE.Vector3(x, heightAt(x, z) + rand(0.4, 1.8), z);
      }
      return null;
    };
    while (this.butters.length < BUTTER_N) {
      const at = spot();
      if (!at) break;
      this.butters.push({ pos: at, heading: Math.random() * TAU, turn: 0, pitch: 0, bank: 0, phase: Math.random() * TAU, stroke: 1.1, hidden: false,
        lift: rand(0.4, 1.8), colour: new THREE.Color(BUTTERFLY_COLOURS[this.butters.length % BUTTERFLY_COLOURS.length]), scale: rand(0.8, 1.3) });
    }
    for (const b of this.butters) {
      if (b.pos.distanceTo(hub) > 35) { const at = spot(); if (at) b.pos.copy(at); }
      // A jinking wander: the heading jittering, bobbing up and down with each beat.
      b.turn += (Math.random() - 0.5) * 8 * dt;
      b.turn *= Math.exp(-dt * 2);
      b.heading += b.turn * dt * 3;
      b.pos.x += Math.sin(b.heading) * 1.1 * dt;
      b.pos.z += Math.cos(b.heading) * 1.1 * dt;
      if (forest(b.pos.x, b.pos.z) > 0.45) b.heading += Math.PI * dt;            // (back out of the trees)
      const ground = heightAt(b.pos.x, b.pos.z);
      b.pos.y += ((ground + b.lift + Math.sin(b.phase) * 0.06) - b.pos.y) * Math.min(1, dt * 3);
      b.phase += dt * TAU * 7; b.stroke = 1.1;
    }
    this.butter.draw(this.butters);
  }

  // ── fireflies, at night ──
  updateFireflies(dt, time, hub, night, ashore, rain, viewH) {
    const on = ashore && night > 0.5 && rain < 0.3;
    this.fireflies.visible = on;
    if (!on) return;
    this.flyU.uViewH.value = viewH;
    const P = this.fireflies.geometry.attributes.position, G = this.fireflies.geometry.attributes.aGlow;
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      if (!f.placed || Math.hypot(P.getX(i) - hub.x, P.getZ(i) - hub.z) > 26) {
        // In the grass and the edge of the trees: not over water, not out on bare rock.
        let x = hub.x, z = hub.z;
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * TAU, r = rand(3, 22);
          x = hub.x + Math.cos(a) * r; z = hub.z + Math.sin(a) * r;
          if (heightAt(x, z) > 1.2 && !freshWaterAt(x, z)) break;
        }
        P.setXYZ(i, x, heightAt(x, z) + rand(0.3, 3), z);
        f.placed = true;
      }
      // Drifting slowly; flashing for a third of a second on its own beat.
      f.drift.x += (Math.random() - 0.5) * dt * 0.6; f.drift.z += (Math.random() - 0.5) * dt * 0.6; f.drift.y += (Math.random() - 0.5) * dt * 0.3;
      f.drift.multiplyScalar(Math.exp(-dt));
      P.setXYZ(i, P.getX(i) + f.drift.x * dt, P.getY(i) + f.drift.y * dt, P.getZ(i) + f.drift.z * dt);
      const ph = ((time + f.off) % f.beat) / f.beat;
      // (Lit a quarter of the time, so that a glance at the dark finds some of them.)
      G.setX(i, ph < 0.25 ? Math.sin(ph / 0.25 * Math.PI) * Math.min(1, (night - 0.5) * 3) : 0);
    }
    P.needsUpdate = true; G.needsUpdate = true;
  }
}
