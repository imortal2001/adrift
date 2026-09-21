// ── Fish ─────────────────────────────────────────────────────────────────────
// Reef fish in loose schools. Each school wanders as a unit and each fish holds
// a slowly orbiting station within it, which reads as shoaling without the cost
// of comparing every fish to every other one.
//
// Bodies come from assets/models/reef_fish.glb — four low-poly meshes built by
// tools/build_fish.py, with counter-shading baked into their vertex colours. If
// the file is missing the schools fall back to a procedural body and the game
// plays exactly the same.
//
// Nothing here is skinned. The swim is a travelling sine down the length of the
// body, which the vertex shader does for free, so two hundred fish cost one
// draw call per species and no CPU at all beyond steering them.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { heightAt } from './terrain.js';
import { ModelLibrary } from './models.js';
import { mergeParts } from './meshkit.js';

const BODY_LENGTH = 2.5;       // normalised model length; scale is metres / this

const HOME_RANGE = 78;         // schools beyond this are recycled closer in
const SPAWN_MIN = 14, SPAWN_MAX = 62;
const DRIFT = 0.45;            // how much of the ocean current they give in to
const FLEE_RADIUS = 3.2;
const SURFACE_CLEARANCE = 0.32;
const BED_CLEARANCE = 0.55;    // how close a fish gets to the sand, or to the
                               // top of whatever is standing on it

const CURRENT = new THREE.Vector2(0.60, 0.80).normalize();

// Where a school lives. `reef` schools ride the sea bed at a fixed hover, so
// they follow the coral up and over the heads instead of swimming through it;
// the other two hold a depth band in open water.
const ZONES = {
  surface: { band: [-1.2, -5.0] },
  mid:     { band: [-4.0, -13.0] },
  reef:    { hover: [1.4, 5.0], floor: [-22, -7] },
};

// `length` is nose-to-tail in metres. `mesh` names an object in the .glb; more
// than one species can wear the same body in a different colour, which is what
// real reef fish mostly are.
//
// The lengths run about a third over life size. A 12cm chromis at the 8m you
// normally see one from is three pixels, and three pixels is not wildlife.
const SPECIES = [
  { key: 'chromis',  mesh: 'chromis', color: 0x3f86d6, zone: 'reef',
    schools: 3, per: 24, length: [0.15, 0.21], speed: [0.9, 1.5] },
  { key: 'tang',     mesh: 'tang',    color: 0xf2bb3c, zone: 'reef',
    schools: 2, per: 13, length: [0.24, 0.34], speed: [0.8, 1.3] },
  { key: 'bluetang', mesh: 'tang',    color: 0x2f6cc0, zone: 'reef',
    schools: 1, per: 10, length: [0.23, 0.32], speed: [0.8, 1.3] },
  { key: 'wrasse',   mesh: 'wrasse',  color: 0x54c48c, zone: 'reef',
    schools: 2, per: 9,  length: [0.22, 0.31], speed: [1.0, 1.7] },
  { key: 'snapper',  mesh: 'snapper', color: 0xd6a271, zone: 'mid',
    schools: 2, per: 8,  length: [0.40, 0.58], speed: [0.9, 1.4] },
  { key: 'silver',   mesh: 'chromis', color: 0xb3c6d4, zone: 'surface',
    schools: 3, per: 16, length: [0.13, 0.20], speed: [1.0, 1.7] },
];

const rand = (a, b) => a + Math.random() * (b - a);

/** The body used when there is no .glb: the old sphere-and-cone, welded. */
function fallbackBody() {
  const body = new THREE.SphereGeometry(1, 9, 7);
  body.scale(0.40, 0.54, 1.25);
  const tail = new THREE.ConeGeometry(0.62, 1.0, 3);
  tail.rotateX(-Math.PI / 2);      // tip points back along -Z
  tail.scale(0.16, 1, 1);          // flatten into a vertical fin
  tail.translate(0, 0, -0.88);
  return mergeParts([
    { geo: body, color: new THREE.Color(0xffffff) },
    { geo: tail, color: new THREE.Color(0xb4b4b4) },
  ]);
}

/**
 * Centre a body and scale it to BODY_LENGTH along Z, so a model and the
 * fallback are interchangeable and the swim shader can assume the same frame.
 */
function normalise(src) {
  const geo = src.clone();
  geo.computeBoundingBox();
  const size = new THREE.Vector3(), mid = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  geo.boundingBox.getCenter(mid);
  geo.translate(-mid.x, -mid.y, -mid.z);
  const s = BODY_LENGTH / (size.z || 1);
  geo.scale(s, s, s);
  // The material is vertexColors; a body without them would render black.
  if (!geo.attributes.color) {
    const white = new Float32Array(geo.attributes.position.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
  }
  return geo;
}

/**
 * One material for every fish. The body bends by a sine travelling from head to
 * tail, with an envelope that pins the nose and lets the tail do the work —
 * which is, near enough, how a fish actually swims.
 */
function fishMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    // Rough and non-metal: a shiny fish under an attenuated sun just comes
    // out dark, because there is nothing down there for it to reflect.
    vertexColors: true, roughness: 0.68, metalness: 0,
    side: THREE.DoubleSide, flatShading: false,
  });
  mat.userData.time = { value: 0 };
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = mat.userData.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute float aPhase;
        attribute float aRate;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float zn = transformed.z / ${(BODY_LENGTH / 2).toFixed(4)};
        float env = clamp((1.0 - zn) * 0.5, 0.0, 1.0);
        env = pow(env, 1.7);
        float beat = sin(zn * 2.9 + uTime * aRate + aPhase);
        transformed.x += beat * env * 0.40;
        // The tail sheet leans into the stroke as well as sweeping across it,
        // which is what stops it looking like a flag on a pole.
        transformed.z += abs(beat) * env * env * -0.06;`);
    // Reef colour is the first thing the water takes. A little self-colour
    // keeps a yellow tang yellow at the distance you actually see it from.
    // `.rgb` because a glTF COLOR_0 with alpha makes vColor a vec4.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * 0.38;`);
  };
  mat.customProgramCacheKey = () => 'fish';
  return mat;
}

export class FishSchools {
  /**
   * @param terrain  the live Terrain, for its obstacle field. Without it the
   *                 fish fall back to bare ground height and will swim through
   *                 anything standing on it.
   */
  constructor(scene, terrain = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.material = fishMaterial();
    this.fallback = normalise(fallbackBody());

    this.groups = [];
    this.schools = [];
    this.fish = [];

    for (const sp of SPECIES) {
      // A clone each: the per-instance swim attributes live on the geometry,
      // and they are sized to that species' school. Sharing one buffer would
      // leave the largest species reading off the end of the smallest's.
      const geo = this.fallback.clone();
      const total = sp.schools * sp.per;
      const mesh = new THREE.InstancedMesh(geo, this.material, total);
      mesh.frustumCulled = false;          // they move every frame
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);

      const g = { sp, mesh, n: 0, index: this.groups.length, model: false };
      this.groups.push(g);

      for (let i = 0; i < sp.schools; i++) {
        const school = {
          group: g,
          zone: ZONES[sp.zone],
          kind: sp.zone,
          center: new THREE.Vector3(),
          floor: -18,
          hover: sp.zone === 'reef' ? rand(...ZONES.reef.hover) : 0,
          radius: rand(1.2, 2.6),
          wander: Math.random() * 7,
          wanderSpeed: rand(0.12, 0.3),
        };
        this.schools.push(school);
        this.respawn(school, true);

        for (let j = 0; j < sp.per; j++) {
          this.fish.push({
            school, sp,
            pos: school.center.clone().add(new THREE.Vector3(
              rand(-1, 1) * school.radius, rand(-0.6, 0.6), rand(-1, 1) * school.radius)),
            vel: new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)),
            offset: new THREE.Vector3(
              rand(-1, 1) * school.radius, rand(-0.55, 0.55), rand(-1, 1) * school.radius),
            orbit: Math.random() * 7,
            size: rand(sp.length[0], sp.length[1]) / BODY_LENGTH,
            speed: rand(sp.speed[0], sp.speed[1]),
          });
        }
      }

      this.attributes(g, geo);
    }

    this._dummy = new THREE.Object3D();
    this._tgt = new THREE.Vector3();
    this._v = new THREE.Vector3();

    this.upgraded = [];        // reported once, like the wildlife models
    this.library = new ModelLibrary();
    this.loadBodies();
  }

  /**
   * Per-instance swim phase and beat rate, plus the colour each fish wears.
   * Instance order never changes — a fish keeps its slot for the life of the
   * run — so these are written once rather than every frame.
   */
  attributes(g, geo) {
    const sp = g.sp;
    const n = g.mesh.instanceMatrix.count;
    const phase = new Float32Array(n);
    const rate = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      phase[i] = Math.random() * Math.PI * 2;
      rate[i] = rand(7.0, 10.5);
    }
    // Attributes live on the geometry; a fresh body needs them re-attached.
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 1));

    // Individual colour. Two fish of a species are never the same shade, and
    // this is most of what stops a school reading as one mesh repeated.
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.set(sp.color).offsetHSL((Math.random() - 0.5) * 0.06,
                                (Math.random() - 0.5) * 0.18,
                                (Math.random() - 0.5) * 0.14);
      g.mesh.setColorAt(i, c);
    }
    if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
  }

  /** Swap in the modelled bodies once the .glb arrives. Best-effort. */
  async loadBodies() {
    const entry = await this.library.get('reef_fish');
    if (!entry) return;

    const bodies = new Map();
    entry.scene.traverse(o => { if (o.isMesh) bodies.set(o.name, o.geometry); });
    if (!bodies.size) return;

    let swapped = 0;
    for (const g of this.groups) {
      const src = bodies.get(g.sp.mesh);
      if (!src) continue;
      const geo = normalise(src);
      this.attributes(g, geo);
      g.mesh.geometry.dispose();
      g.mesh.geometry = geo;
      g.model = true;
      swapped++;
    }
    if (swapped) this.upgraded.push({ count: swapped, meshes: bodies.size });
  }

  /**
   * The height a fish at (x, z) has to clear — the sea bed, or the top of the
   * coral or boulder standing on it. The terrain's obstacle field knows about
   * the props; `heightAt` alone does not, which is how fish ended up inside
   * the rocks.
   */
  clearance(x, z) {
    return this.terrain ? this.terrain.clearanceAt(x, z) : heightAt(x, z);
  }

  /**
   * Drop a school back into range. Reef schools look for sea bed at a depth
   * the coral actually grows at, so a shoal is never left hanging over the
   * basin with nothing under it.
   */
  respawn(school, initial = false) {
    const min = initial ? 8 : SPAWN_MIN;
    for (let attempt = 0; attempt < (school.kind === 'reef' ? 12 : 1); attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(min, SPAWN_MAX);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (school.kind === 'reef') {
        const bed = heightAt(x, z);
        const [lo, hi] = ZONES.reef.floor;
        if ((bed < lo || bed > hi) && attempt < 11) continue;
        school.floor = bed;
        school.center.set(x, bed + school.hover, z);
      } else {
        const [top, bottom] = school.zone.band;
        school.center.set(x, rand(bottom, top), z);
      }
      return;
    }
  }

  update(dt, time, playerPos) {
    for (const s of this.schools) {
      s.wander += dt * s.wanderSpeed;
      s.center.x += (CURRENT.x * DRIFT + Math.cos(s.wander) * 0.4) * dt;
      s.center.z += (CURRENT.y * DRIFT + Math.sin(s.wander * 0.8) * 0.4) * dt;

      if (s.kind === 'reef') {
        // Ride the reef. This is the canopy height, not the ground: a shoal
        // that tracks the sand swims straight into every coral head it meets.
        s.floor = this.clearance(s.center.x, s.center.z);
        const want = s.floor + s.hover + Math.sin(s.wander * 0.9) * 0.5;
        s.center.y += (want - s.center.y) * Math.min(1, dt * 1.6);
      } else {
        const [top, bottom] = s.zone.band;
        s.center.y += Math.sin(s.wander * 0.55) * 0.3 * dt;
        s.center.y = THREE.MathUtils.clamp(s.center.y, bottom, top);
      }

      if (Math.hypot(s.center.x, s.center.z) > HOME_RANGE) this.respawn(s);
      else if (s.kind === 'reef' && (s.floor < ZONES.reef.floor[0] - 6)) this.respawn(s);
    }

    for (const g of this.groups) g.n = 0;

    for (const f of this.fish) {
      const s = f.school;

      // Station-keeping: the offset orbits the school centre, so the shoal
      // churns instead of sitting in a fixed lattice.
      const a = time * 0.3 + f.orbit;
      const ca = Math.cos(a), sa = Math.sin(a);
      this._tgt.set(
        s.center.x + f.offset.x * ca - f.offset.z * sa,
        s.center.y + f.offset.y,
        s.center.z + f.offset.x * sa + f.offset.z * ca);

      this._v.copy(this._tgt).sub(f.pos);
      const reach = this._v.length();
      if (reach > 0.001) {
        this._v.multiplyScalar(f.speed / reach);
        f.vel.lerp(this._v, Math.min(1, dt * 1.9));
      }

      // Scatter from anything large and close by.
      const dx = f.pos.x - playerPos.x, dy = f.pos.y - playerPos.y, dz = f.pos.z - playerPos.z;
      const pd = Math.hypot(dx, dy, dz);
      if (pd < FLEE_RADIUS && pd > 0.001) {
        const push = (1 - pd / FLEE_RADIUS) * 9 * dt;
        f.vel.x += (dx / pd) * push;
        f.vel.y += (dy / pd) * push;
        f.vel.z += (dz / pd) * push;
      }

      const sp = f.vel.length();
      const cap = f.speed * 2.6;
      if (sp > cap) f.vel.multiplyScalar(cap / sp);

      f.pos.addScaledVector(f.vel, dt);

      // Never break the surface, and never sink into the sand.
      const ceiling = waveHeight(f.pos.x, f.pos.z, time) - SURFACE_CLEARANCE;
      if (f.pos.y > ceiling) { f.pos.y = ceiling; if (f.vel.y > 0) f.vel.y = 0; }
      // Per fish, not per school. A shoal is a few metres across and a coral
      // head is a couple of metres wide, so the fish on the near side of the
      // school is regularly over something the school centre is not.
      const bed = this.clearance(f.pos.x, f.pos.z) + BED_CLEARANCE;
      if (f.pos.y < bed) { f.pos.y = bed; if (f.vel.y < 0) f.vel.y = 0; }

      // ── transform ──
      const g = s.group;
      const i = g.n++;
      const d = this._dummy;
      d.position.copy(f.pos);
      // Mesh lookAt points local +Z at the target, which is where the nose is.
      if (f.vel.lengthSq() > 1e-6) this._v.copy(f.pos).add(f.vel);
      else this._v.set(f.pos.x, f.pos.y, f.pos.z + 1);
      d.lookAt(this._v);
      d.scale.setScalar(f.size);
      d.updateMatrix();
      g.mesh.setMatrixAt(i, d.matrix);
    }

    for (const g of this.groups) {
      g.mesh.count = g.n;
      g.mesh.instanceMatrix.needsUpdate = true;
    }

    this.material.userData.time.value = time;
  }

  /** Closest fish to a point, for look-at prompts and later, spearing. */
  nearest(p, maxDist = 2.5) {
    let best = null, bestD = maxDist * maxDist;
    for (const f of this.fish) {
      const d = (f.pos.x - p.x) ** 2 + (f.pos.y - p.y) ** 2 + (f.pos.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /** Fish in front of the camera, weighted toward the centre of the screen. */
  pick(origin, dir, maxDist = 3.0, minDot = 0.9) {
    let best = null, bestScore = -Infinity;
    for (const f of this.fish) {
      const dx = f.pos.x - origin.x, dy = f.pos.y - origin.y, dz = f.pos.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxDist || d < 0.001) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (dot < minDot) continue;
      const score = dot * 2 - d / maxDist;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  get count() { return this.fish.length; }
}
