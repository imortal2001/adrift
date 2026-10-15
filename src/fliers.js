// ── Fliers ───────────────────────────────────────────────────────────────────
// What is in the air. The sea and the island had nothing over them: no wings
// at all, over a sea that should be full of them.
//
//   pterosaurs   Pteranodon-like, six metres across the wings: soaring in
//                slow circles over the sea and the coast, seldom flapping —
//                they were soarers, like an albatross (Witton 2013) — and now
//                and then coming down to skim the water for a fish.
//   seabirds     tern-like, a metre across: a loose flock working the water
//                over the reef, quick wingbeats, and now and then one folding
//                and plunging in after a fish.
//   forest birds small and quick, ashore under the canopy: short bounding
//                flights from tree to tree — a burst of beats, wings shut,
//                another — heard more than seen: birdsong by day.
//
// Each kind is one instanced mesh; the wings are beaten in the vertex shader
// (each instance its own phase and stroke), so a flock is one draw.

import * as THREE from 'three';
import { heightAt, landAt, moistureAt, slopeAt, forestAt } from './terrain.js';
import { waveHeight } from './ocean.js';
import { splash } from './splash.js';
import * as sound from './sound.js';

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const forest = (x, z) => forestAt(x, z, landAt(x, z), moistureAt(x, z), slopeAt(x, z));

// ── bodies ───────────────────────────────────────────────────────────────────
/**
 * A flier, facing +z, wings along ±x: a body, a head, a tail, and two wings
 * (a leading edge out to a wrist and a tip, and a trailing edge back to the
 * body). Every vertex carries aSpan: how far out along a wing it is (0 the
 * body, 1 a tip), which the shader beats. Colours per vertex.
 */
export function wingedBody(o) {
  const pos = [], col = [], span = [], idx = [];
  const C = new THREE.Color();
  // (Colour with alpha: a dragonfly's wings are glass.)
  const add = (x, y, z, hex, s, alpha = 1) => { pos.push(x, y, z); C.set(hex); col.push(C.r, C.g, C.b, alpha); span.push(s); return pos.length / 3 - 1; };
  const tri = (a, b, c) => idx.push(a, b, c);
  // A spindle along z: rings of `seg`, radius profile r(t).
  const spindle = (z0, z1, rad, hex, under = hex, seg = 6, rings = 6, y0 = 0, lift = () => 0) => {
    const first = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, z = z0 + (z1 - z0) * t, r = rad(t);
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * TAU, x = Math.cos(a) * r, y = Math.sin(a) * r * 0.85 + y0 + lift(t);
        add(x, y, z, y < y0 ? under : hex, 0);
      }
    }
    for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) {
      const a = first + i * seg + k, b = first + i * seg + (k + 1) % seg, c = a + seg, d = b + seg;
      tri(a, c, b); tri(b, c, d);
    }
  };
  const L = o.len;
  // The body, tapering to the tail; the head and the beak forward of it.
  spindle(-L * 0.45, L * 0.2, t => o.girth * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), o.back, o.belly);
  spindle(L * 0.15, L * 0.15 + o.head, t => o.girth * 0.7 * (1 - t * 0.85) + 0.002, o.headCol ?? o.back, o.belly, 6, 4, o.girth * 0.25);
  spindle(L * 0.15 + o.head * 0.7, L * 0.15 + o.head + o.beak, t => o.girth * 0.25 * (1 - t) + 0.001, o.beakCol, o.beakCol, 4, 3, o.girth * 0.2);
  if (o.crest) {
    // Back from the head and up: a Pteranodon's crest.
    const b = add(0, o.girth * 0.6, L * 0.15 + o.head * 0.6, o.crestCol, 0);
    const c = add(0, o.girth * 0.5 + o.crest * 0.45, L * 0.15 - o.crest * 0.7, o.crestCol, 0);
    const d = add(0, o.girth * 0.5, L * 0.15 + o.head * 0.2, o.crestCol, 0);
    tri(b, c, d); tri(b, d, c);
  }
  // The tail: a fork for a tern, a stub for a pterosaur.
  const tl = add(0, 0, -L * 0.45, o.tailCol ?? o.back, 0);
  for (const sx of [-1, 1]) {
    const tip = add(sx * o.tailFork, 0, -L * 0.45 - o.tail, o.tailCol ?? o.back, 0);
    const mid = add(sx * o.tailFork * 0.3, 0, -L * 0.4, o.tailCol ?? o.back, 0);
    tri(tl, tip, mid); tri(tl, mid, tip);
  }
  // The wings: one pair, or two (a dragonfly's, a butterfly's fore and hind).
  const N = 8, S = o.span / 2;
  const pairs = o.hind ? [[0, 1, o.chord, o.tipChord, 0], [o.hind.back, o.hind.span, o.hind.chord, o.hind.tipChord, o.hind.sweep ?? 0]] : [[0, 1, o.chord, o.tipChord, 0]];
  for (const [back, spanK, chord0, tipC, sweepK] of pairs)
  for (const sx of [-1, 1]) {
    const lead = [], trail = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, x = sx * (o.girth * 0.8 + (S * spanK - o.girth * 0.8) * s);
      // Leading edge: out and a little forward to the wrist, swept back to the tip.
      const zl = o.root - back + (s < o.wrist ? (s / o.wrist) * o.sweepIn : o.sweepIn - ((s - o.wrist) / (1 - o.wrist)) * o.sweepOut) - sweepK * s;
      // Trailing edge: from the body's depth at the root narrowing to the tip —
      // rounded off at the tip if `round` (a butterfly's).
      const taper = o.round ? Math.sqrt(Math.max(0, 1 - s ** 2.2)) * (1 - tipC) + tipC * (1 - s) : 1 - s * (1 - tipC);
      const zt = zl - chord0 * taper;
      const hex = s > o.tipFrom ? o.tipCol : o.wingCol;
      lead.push(add(x, 0.002, zl, hex, sx * s, o.wingAlpha ?? 1));
      trail.push(add(x, 0, zt, hex, sx * s, o.wingAlpha ?? 1));
    }
    for (let i = 0; i < N; i++) {
      const a = lead[i], b = lead[i + 1], c = trail[i], d = trail[i + 1];
      if (sx > 0) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The material: lit, both sides (a wing is one sheet), and the wingbeat in
 * the vertex shader — each wing turned about the shoulder by the instance's
 * stroke, the outer part a little further, as a wing flexes at the wrist.
 * iFlap: (phase, stroke in radians, fold 0..1 — wings drawn in for a dive).
 */
export function wingMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSpan;
        attribute vec3 iFlap;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float s = abs(aSpan);
          if (s > 0.0) {
            float bend = sin(iFlap.x) * iFlap.y * (1.0 + 0.6 * smoothstep(0.35, 1.0, s)) + 0.04;
            float ax = abs(transformed.x);
            transformed.y += ax * sin(bend);
            transformed.x *= cos(bend);
            // Folded: drawn in to the body and swept back, for a dive.
            transformed.x *= 1.0 - iFlap.z * 0.7;
            transformed.z -= iFlap.z * s * ax * 0.6;
          }
        }`);
    // Seen from below against the sky, a wing is not black: a membrane lets
    // the light through, and a bird's belly and wings catch it off the sea.
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.3;`);
  };
  m.customProgramCacheKey = () => 'wings';
  return m;
}

/** One kind of flier: an instanced mesh and its wingbeats. */
class Kind {
  constructor(scene, geo, n, opts) {
    this.n = n;
    this.flap = new Float32Array(n * 3);
    geo.setAttribute('iFlap', new THREE.InstancedBufferAttribute(this.flap, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.InstancedMesh(geo, wingMaterial(opts), n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts?.shadow;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
  }
  /** Draw them: [{pos, heading, pitch, bank, phase, stroke, fold, scale, hidden}]. */
  draw(list) {
    let k = 0;
    for (const b of list) {
      if (b.hidden) continue;
      this._q.setFromEuler(this._e.set(-b.pitch, b.heading, -b.bank, 'YXZ'));
      this._m.compose(b.pos, this._q, this._s.setScalar(b.scale ?? 1));
      this.mesh.setMatrixAt(k, this._m);
      this.flap[k * 3] = b.phase; this.flap[k * 3 + 1] = b.stroke; this.flap[k * 3 + 2] = b.fold || 0;
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.iFlap.needsUpdate = true;
  }
}

// The kinds' bodies (metres).
export const PTEROSAUR = { len: 1.6, girth: 0.16, head: 0.5, beak: 0.9, crest: 0.8, span: 6.2, root: 0.25, wrist: 0.42,
  sweepIn: 0.25, sweepOut: 0.9, chord: 0.9, tipChord: 0.2, tipFrom: 0.85, tail: 0.15, tailFork: 0.05,
  back: 0x5f5a52, belly: 0xd8d2c4, headCol: 0x5f5a52, beakCol: 0xb59a6a, crestCol: 0x9b4a32, wingCol: 0x6f665a, tipCol: 0x4f4a42, tailCol: 0x5f5a52 };
export const SEABIRD = { len: 0.38, girth: 0.05, head: 0.08, beak: 0.06, span: 0.92, root: 0.04, wrist: 0.4,
  sweepIn: 0.04, sweepOut: 0.16, chord: 0.14, tipChord: 0.35, tipFrom: 0.78, tail: 0.16, tailFork: 0.05,
  back: 0xe8ecee, belly: 0xffffff, headCol: 0x1d1e20, beakCol: 0xd8a82a, wingCol: 0xc6ccd1, tipCol: 0x4a4e52, tailCol: 0xeef0f0 };
export const FORESTBIRD = { len: 0.16, girth: 0.03, head: 0.04, beak: 0.02, span: 0.26, root: 0.015, wrist: 0.5,
  sweepIn: 0.01, sweepOut: 0.05, chord: 0.07, tipChord: 0.5, tipFrom: 0.8, tail: 0.07, tailFork: 0.012,
  back: 0x6b5a3a, belly: 0xc9b48a, headCol: 0x6b5a3a, beakCol: 0x2a2620, wingCol: 0x5a4a30, tipCol: 0x3a3022, tailCol: 0x5a4a30 };

// ── the fliers ───────────────────────────────────────────────────────────────
const PTERO_N = 4, TERN_N = 10, FOREST_N = 7;

export class Fliers {
  constructor(scene) {
    this.ptero = new Kind(scene, wingedBody(PTEROSAUR), PTERO_N, { shadow: true });
    this.terns = new Kind(scene, wingedBody(SEABIRD), TERN_N, {});
    this.small = new Kind(scene, wingedBody(FORESTBIRD), FOREST_N, {});
    this.pteros = []; this.flock = []; this.birds = [];
    this.flockAt = null;
    this.songIn = 2;
    this.ternCallIn = 5;
  }

  /** Over the sea or the shore, and not over high ground: where a pterosaur or a tern hunts. */
  seaward(x, z) { return heightAt(x, z) < 6; }

  /** Somewhere seaward, `r` metres round `hub`. */
  spotSeaward(hub, r0, r1) {
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * TAU, r = rand(r0, r1), x = hub.x + Math.cos(a) * r, z = hub.z + Math.sin(a) * r;
      if (this.seaward(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  update(dt, time, hub, { day = 1, ashore = false, rain = 0 } = {}) {
    if (dt <= 0) return;
    this.updatePteros(dt, time, hub);
    this.updateTerns(dt, time, hub, day, rain);
    this.updateForest(dt, time, hub, day, ashore, rain);
  }

  // ── pterosaurs: soaring, and skimming the sea ──
  updatePteros(dt, time, hub) {
    while (this.pteros.length < PTERO_N) {
      const at = this.spotSeaward(hub, 60, 220);
      if (!at) break;
      this.pteros.push({ pos: at.setY(rand(25, 60)), centre: at.clone(), r: rand(25, 60), ang: Math.random() * TAU, dir: Math.random() < 0.5 ? 1 : -1,
        alt: rand(25, 60), heading: 0, pitch: 0, bank: 0, phase: Math.random() * TAU, stroke: 0, beats: 0, skimIn: rand(20, 80), state: 'soar', t: 0, scale: rand(0.85, 1.1) });
    }
    for (const p of this.pteros) {
      const far = Math.hypot(p.pos.x - hub.x, p.pos.z - hub.z);
      if (far > 420) { const at = this.spotSeaward(hub, 80, 220); if (at) { p.centre.copy(at); p.pos.set(at.x, p.alt, at.z); } }
      const sea = waveHeight(p.pos.x, p.pos.z, time), ground = Math.max(sea, heightAt(p.pos.x, p.pos.z));
      const speed = 9;
      let want = p.pos.clone();
      if (p.state === 'soar') {
        // Round its circle, the circle drifting; climbing in a flap or two now and then.
        p.ang += p.dir * speed / p.r * dt;
        p.centre.x += Math.sin(time * 0.05 + p.r) * 0.6 * dt;
        p.centre.z += Math.cos(time * 0.043 + p.r) * 0.6 * dt;
        if (!this.seaward(p.centre.x, p.centre.z)) { p.centre.lerp(hub, dt * 0.05); }
        want.set(p.centre.x + Math.cos(p.ang) * p.r, Math.max(p.alt, ground + 18), p.centre.z + Math.sin(p.ang) * p.r);
        if ((p.skimIn -= dt) <= 0 && this.seaward(p.pos.x, p.pos.z) && heightAt(p.pos.x, p.pos.z) < -2) { p.state = 'skim'; p.t = 0; p.from = p.pos.clone(); p.dirZ = p.heading; }
      } else {
        // Down to the water, a stretch low over it, the beak dipped in, and up again.
        p.t += dt;
        const ahead = new THREE.Vector3(Math.sin(p.dirZ), 0, Math.cos(p.dirZ));
        const low = sea + 1.3;
        const y = p.t < 5 ? THREE.MathUtils.lerp(p.from.y, low, THREE.MathUtils.smoothstep(p.t, 0, 5))
                : p.t < 8 ? low : THREE.MathUtils.lerp(low, p.alt, THREE.MathUtils.smoothstep(p.t, 8, 15));
        want.copy(p.pos).addScaledVector(ahead, speed * 0.9).setY(y);
        if (!p.dipped && p.t > 6.4) { p.dipped = true; splash(p.pos.clone().addScaledVector(ahead, 2), 0.25, { quiet: true }); }
        if (p.t > 15) { p.state = 'soar'; p.skimIn = rand(40, 100); p.dipped = false; p.centre.copy(p.pos).addScaledVector(ahead, p.r); p.ang = Math.atan2(p.pos.z - p.centre.z, p.pos.x - p.centre.x); }
      }
      // Toward where it wants to be, at its speed; banked into the turn.
      const d = want.sub(p.pos);
      const flat = Math.hypot(d.x, d.z) || 1;
      const head = Math.atan2(d.x, d.z);
      let turn = Math.atan2(Math.sin(head - p.heading), Math.cos(head - p.heading));
      const rate = THREE.MathUtils.clamp(turn * 1.5, -0.6, 0.6);
      p.heading += rate * dt;
      p.bank += (THREE.MathUtils.clamp(rate * 0.9, -0.5, 0.5) - p.bank) * Math.min(1, dt * 2);
      const climb = THREE.MathUtils.clamp(d.y / flat, -0.5, 0.35);
      p.pitch += (climb * 0.6 - p.pitch) * Math.min(1, dt * 2);
      p.pos.x += Math.sin(p.heading) * speed * dt;
      p.pos.z += Math.cos(p.heading) * speed * dt;
      p.pos.y += THREE.MathUtils.clamp(d.y, -4, 3) * Math.min(1, dt * 0.8);
      p.pos.y = Math.max(p.pos.y, ground + 1.0);
      // Gliding; a bout of slow, deep beats when it climbs, or rises off the water.
      if (p.beats <= 0 && (climb > 0.12 || (p.state === 'skim' && p.t > 8 && p.t < 11)) && Math.random() < dt * 0.8) p.beats = 3;
      if (p.beats > 0) { p.phase += dt * TAU * 1.1; if (p.phase > TAU) { p.phase -= TAU; p.beats--; } p.stroke += (0.55 - p.stroke) * Math.min(1, dt * 4); }
      else { p.stroke += (0.03 - p.stroke) * Math.min(1, dt * 2); p.phase += dt * 0.8; }
      p.fold = 0;
    }
    this.ptero.draw(this.pteros);
  }

  // ── terns: a flock over the reef ──
  updateTerns(dt, time, hub, day, rain) {
    if (!this.flockAt) {
      const at = this.spotSeaward(hub, 30, 120);
      if (!at) { this.terns.draw([]); return; }
      this.flockAt = at; this.flockVel = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(5);
    }
    const c = this.flockAt;
    // The flock wanders over the water near you, turning back from land and from far away.
    const off = Math.hypot(c.x - hub.x, c.z - hub.z);
    if (off > 400) { const at = this.spotSeaward(hub, 40, 120); if (at) c.copy(at); }
    const aim = new THREE.Vector3(Math.sin(time * 0.07) * 60, 0, Math.cos(time * 0.05) * 60).add(hub).sub(c);
    if (!this.seaward(c.x + this.flockVel.x * 4, c.z + this.flockVel.z * 4) || off > 150) aim.copy(hub).sub(c);
    this.flockVel.lerp(aim.setY(0).normalize().multiplyScalar(5), Math.min(1, dt * 0.15));
    c.addScaledVector(this.flockVel, dt);
    while (this.flock.length < TERN_N) {
      this.flock.push({ pos: c.clone().add(new THREE.Vector3(rand(-15, 15), rand(6, 14), rand(-15, 15))), off: new THREE.Vector3(rand(-14, 14), rand(5, 13), rand(-14, 14)),
        heading: 0, pitch: 0, bank: 0, phase: Math.random() * TAU, stroke: 0.7, fold: 0, state: 'fly', t: 0, diveIn: rand(20, 90), scale: rand(0.9, 1.1), hidden: false });
    }
    for (const b of this.flock) {
      const sea = waveHeight(b.pos.x, b.pos.z, time);
      if (b.state === 'fly') {
        b.off.x += Math.sin(time * 0.3 + b.scale * 9) * dt * 2; b.off.z += Math.cos(time * 0.27 + b.scale * 7) * dt * 2;
        b.off.clampLength(4, 18);
        const want = c.clone().add(b.off);
        want.y = Math.max(sea + 4, c.y + b.off.y);
        const d = want.sub(b.pos);
        const v = new THREE.Vector3(d.x, 0, d.z).multiplyScalar(0.6).add(this.flockVel);
        const sp = Math.min(11, Math.max(6, v.length()));
        const head = Math.atan2(v.x, v.z), turn = Math.atan2(Math.sin(head - b.heading), Math.cos(head - b.heading));
        b.heading += THREE.MathUtils.clamp(turn * 2, -1.5, 1.5) * dt;
        b.bank += (THREE.MathUtils.clamp(turn, -0.6, 0.6) - b.bank) * Math.min(1, dt * 3);
        b.pos.x += Math.sin(b.heading) * sp * dt; b.pos.z += Math.cos(b.heading) * sp * dt;
        b.pos.y += THREE.MathUtils.clamp(d.y, -3, 3) * dt;
        b.pitch = THREE.MathUtils.clamp(d.y * 0.05, -0.3, 0.3);
        b.phase += dt * TAU * 3.2; b.stroke = 0.7; b.fold = 0;
        // Now and then one sees a fish, and goes in after it.
        if ((b.diveIn -= dt) <= 0 && heightAt(b.pos.x, b.pos.z) < -1.5 && rain < 0.6) { b.state = 'dive'; b.t = 0; }
      } else if (b.state === 'dive') {
        // Wings folded, steeply down.
        b.t += dt;
        b.fold = Math.min(1, b.t * 3); b.stroke = 0.1; b.pitch = -1.1;
        b.pos.x += Math.sin(b.heading) * 4 * dt; b.pos.z += Math.cos(b.heading) * 4 * dt;
        b.pos.y -= 13 * dt;
        if (b.pos.y <= sea) { splash(b.pos, 0.3); b.state = 'under'; b.t = 0; b.hidden = true; b.pos.y = sea; }
      } else if (b.state === 'under') {
        if ((b.t += dt) > 0.9) { b.state = 'climb'; b.t = 0; b.hidden = false; }
      } else {
        // Up off the water, beating hard, and back to the flock.
        b.t += dt; b.fold = 0; b.stroke = 0.85; b.phase += dt * TAU * 4; b.pitch = 0.4;
        b.pos.x += Math.sin(b.heading) * 6 * dt; b.pos.z += Math.cos(b.heading) * 6 * dt; b.pos.y += 4 * dt;
        if (b.t > 2) { b.state = 'fly'; b.diveIn = rand(40, 100); }
      }
    }
    this.terns.draw(this.flock);
    // Their calls: harsh, two-note, from somewhere in the flock — by day, near enough.
    if ((this.ternCallIn -= dt) <= 0) {
      this.ternCallIn = rand(4, 12);
      const b = this.flock[Math.random() * this.flock.length | 0];
      if (b && day > 0.3 && b.pos.distanceTo(hub) < 140) sound.tern(b.pos);
    }
  }

  // ── forest birds: flitting through the canopy, ashore ──
  updateForest(dt, time, hub, day, ashore, rain) {
    const wooded = ashore && forest(hub.x, hub.z) > 0.25;
    if (!wooded) {
      this.small.draw([]);
      return;
    }
    const perch = () => {
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * TAU, r = rand(6, 30), x = hub.x + Math.cos(a) * r, z = hub.z + Math.sin(a) * r;
        if (forest(x, z) > 0.2) return new THREE.Vector3(x, heightAt(x, z) + rand(6, 15), z);
      }
      return new THREE.Vector3(hub.x + rand(-15, 15), hub.y + rand(6, 12), hub.z + rand(-15, 15));
    };
    while (this.birds.length < FOREST_N) {
      const at = perch();
      this.birds.push({ pos: at, from: at.clone(), to: at.clone(), state: 'perch', t: 0, wait: rand(1, 6), heading: Math.random() * TAU, pitch: 0, bank: 0,
        phase: Math.random() * TAU, stroke: 0, fold: 0, hidden: true, scale: rand(0.85, 1.2) });
    }
    for (const b of this.birds) {
      if (b.pos.distanceTo(hub) > 60) { b.pos.copy(perch()); b.state = 'perch'; b.hidden = true; b.wait = rand(1, 4); }
      if (b.state === 'perch') {
        // In the leaves, unseen; then off to another tree.
        if ((b.wait -= dt) <= 0 && rain < 0.7) { b.state = 'fly'; b.t = 0; b.from.copy(b.pos); b.to.copy(perch()); b.dur = b.from.distanceTo(b.to) / 7; b.hidden = false; }
        continue;
      }
      b.t += dt;
      const u = Math.min(1, b.t / b.dur);
      const prev = b.pos.clone();
      b.pos.lerpVectors(b.from, b.to, u);
      // Bounding: rising on a burst of beats, sinking with the wings shut.
      const cyc = (b.t * 2.4) % 1, beating = cyc < 0.55;
      b.pos.y += Math.sin(u * Math.PI) * 1.5 + (beating ? cyc : 0.55 - (cyc - 0.55) * 1.2) * 0.4;
      const d = b.pos.clone().sub(prev);
      if (d.lengthSq() > 1e-8) { b.heading = Math.atan2(d.x, d.z); b.pitch = THREE.MathUtils.clamp(d.y / (Math.hypot(d.x, d.z) || 1), -0.5, 0.5); }
      b.phase += dt * TAU * (beating ? 13 : 0);
      b.stroke = beating ? 0.9 : 0.05;
      b.fold = beating ? 0 : 0.8;
      if (u >= 1) { b.state = 'perch'; b.wait = rand(2, 8); b.hidden = true; }
    }
    this.small.draw(this.birds);
    // Their song, from the canopy round you, by day.
    if ((this.songIn -= dt) <= 0) {
      this.songIn = rand(1.5, 5) / Math.max(0.3, day);
      if (day > 0.25 && rain < 0.5) sound.birdsong(perch());
    }
  }
}

/** One flier on its own (the gallery): a mesh, and `flap(phase, stroke, fold)` to set its wings. */
export function flierMesh(spec, opts = {}) {
  const geo = wingedBody(spec), flap = new Float32Array(3);
  geo.setAttribute('iFlap', new THREE.InstancedBufferAttribute(flap, 3));
  const mesh = new THREE.InstancedMesh(geo, wingMaterial(opts), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  if (opts.colour != null) mesh.setColorAt(0, new THREE.Color(opts.colour));
  return { mesh, flap: (phase, stroke, fold = 0) => { flap[0] = phase; flap[1] = stroke; flap[2] = fold; geo.attributes.iFlap.needsUpdate = true; } };
}
