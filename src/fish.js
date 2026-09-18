// ── Fish ─────────────────────────────────────────────────────────────────────
// Small fish in loose schools. Each school wanders as a unit and each fish
// holds a slowly orbiting station within it, which reads as shoaling without
// the cost of comparing every fish to every other one.
//
// Two instanced meshes per species (body and tail fin) share one transform per
// fish, so the tail can swing a little further than the body and the whole
// shoal still costs a handful of draw calls.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';

const SCHOOLS = 7;
const PER_SCHOOL = 15;
const TOTAL = SCHOOLS * PER_SCHOOL;

const HOME_RANGE = 78;         // schools beyond this are recycled closer in
const SPAWN_MIN = 14, SPAWN_MAX = 58;
const DEPTH_MIN = -1.3, DEPTH_MAX = -11.5;
const DRIFT = 0.45;            // how much of the ocean current they give in to
const FLEE_RADIUS = 3.2;
const SURFACE_CLEARANCE = 0.32;

const CURRENT = new THREE.Vector2(0.60, 0.80).normalize();

const SPECIES = [
  { color: 0xa9c2d2, emissive: 0x16242c, size: [0.060, 0.082], speed: [0.9, 1.5] },
  { color: 0xe3c04c, emissive: 0x352b09, size: [0.052, 0.072], speed: [1.0, 1.7] },
  { color: 0xd4703c, emissive: 0x31170a, size: [0.046, 0.066], speed: [1.1, 1.8] },
];

const rand = (a, b) => a + Math.random() * (b - a);

/** Body and caudal fin, modelled nose-forward along +Z. */
function fishParts() {
  const body = new THREE.SphereGeometry(1, 9, 7);
  body.scale(0.40, 0.54, 1.25);

  const tail = new THREE.ConeGeometry(0.62, 1.0, 3);
  tail.rotateX(-Math.PI / 2);      // tip points back along -Z
  tail.scale(0.16, 1, 1);          // flatten into a vertical fin
  tail.translate(0, 0, -0.88);

  return { body, tail };
}

export class FishSchools {
  constructor(scene) {
    const { body, tail } = fishParts();
    this.groups = SPECIES.map(sp => {
      const mat = new THREE.MeshStandardMaterial({
        color: sp.color, emissive: sp.emissive, roughness: 0.55, metalness: 0.15,
      });
      const bodies = new THREE.InstancedMesh(body, mat, TOTAL);
      const tails = new THREE.InstancedMesh(tail, mat, TOTAL);
      for (const m of [bodies, tails]) {
        m.frustumCulled = false;         // they move every frame
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
      }
      return { sp, bodies, tails, n: 0 };
    });

    this.schools = [];
    this.fish = [];
    for (let i = 0; i < SCHOOLS; i++) {
      const school = {
        center: new THREE.Vector3(),
        radius: rand(1.1, 2.4),
        wander: Math.random() * 7,
        wanderSpeed: rand(0.12, 0.3),
        species: i % SPECIES.length,
      };
      this.schools.push(school);
      this.respawn(school, true);

      for (let j = 0; j < PER_SCHOOL; j++) {
        const sp = SPECIES[school.species];
        this.fish.push({
          school,
          pos: school.center.clone().add(new THREE.Vector3(
            rand(-1, 1) * school.radius, rand(-0.6, 0.6), rand(-1, 1) * school.radius)),
          vel: new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)),
          offset: new THREE.Vector3(
            rand(-1, 1) * school.radius, rand(-0.55, 0.55), rand(-1, 1) * school.radius),
          orbit: Math.random() * 7,
          phase: Math.random() * 7,
          size: rand(sp.size[0], sp.size[1]),
          speed: rand(sp.speed[0], sp.speed[1]),
        });
      }
    }

    this._dummy = new THREE.Object3D();
    this._tailM = new THREE.Matrix4();
    this._local = new THREE.Matrix4();
    this._tgt = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  /** Drop a school back into range at a fresh depth and bearing. */
  respawn(school, initial = false) {
    const a = Math.random() * Math.PI * 2;
    const d = initial ? rand(8, SPAWN_MAX) : rand(SPAWN_MIN, SPAWN_MAX);
    school.center.set(Math.cos(a) * d, rand(DEPTH_MAX, DEPTH_MIN), Math.sin(a) * d);
  }

  update(dt, time, playerPos) {
    for (const s of this.schools) {
      s.wander += dt * s.wanderSpeed;
      s.center.x += (CURRENT.x * DRIFT + Math.cos(s.wander) * 0.4) * dt;
      s.center.z += (CURRENT.y * DRIFT + Math.sin(s.wander * 0.8) * 0.4) * dt;
      s.center.y += Math.sin(s.wander * 0.55) * 0.3 * dt;
      s.center.y = THREE.MathUtils.clamp(s.center.y, DEPTH_MAX, DEPTH_MIN);
      if (Math.hypot(s.center.x, s.center.z) > HOME_RANGE) this.respawn(s);
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

      // Never break the surface.
      const ceiling = waveHeight(f.pos.x, f.pos.z, time) - SURFACE_CLEARANCE;
      if (f.pos.y > ceiling) { f.pos.y = ceiling; if (f.vel.y > 0) f.vel.y = 0; }
      if (f.pos.y < DEPTH_MAX - 3) { f.pos.y = DEPTH_MAX - 3; if (f.vel.y < 0) f.vel.y = 0; }

      f.phase += dt * (7 + sp * 4);

      // ── transform ──
      const g = this.groups[s.species];
      const i = g.n++;
      const d = this._dummy;
      d.position.copy(f.pos);
      // Mesh lookAt points local +Z at the target, which is where the nose is.
      if (f.vel.lengthSq() > 1e-6) this._v.copy(f.pos).add(f.vel);
      else this._v.set(f.pos.x, f.pos.y, f.pos.z + 1);
      d.lookAt(this._v);
      d.rotateY(Math.sin(f.phase) * 0.22);
      d.scale.setScalar(f.size);
      d.updateMatrix();
      g.bodies.setMatrixAt(i, d.matrix);

      // The fin swings harder and later than the body.
      this._local.makeRotationY(Math.sin(f.phase * 1.35 - 0.7) * 0.55);
      this._tailM.multiplyMatrices(d.matrix, this._local);
      g.tails.setMatrixAt(i, this._tailM);
    }

    for (const g of this.groups) {
      g.bodies.count = g.n;
      g.tails.count = g.n;
      g.bodies.instanceMatrix.needsUpdate = true;
      g.tails.instanceMatrix.needsUpdate = true;
    }
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
}
