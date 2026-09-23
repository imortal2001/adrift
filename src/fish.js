// ── Fish ─────────────────────────────────────────────────────────────────────
// Reef fish in loose schools. Each school wanders as a unit and each fish holds
// a slowly orbiting station within it, which reads as shoaling without the cost
// of comparing every fish to every other one.
//
// Bodies come from assets/models/reef_fish.glb — low-poly meshes built by
// tools/build_fish.py, with counter-shading (and, for the newer species, their
// whole colour pattern) baked into their vertex colours. If
// the file is missing the schools fall back to a procedural body and the game
// plays exactly the same.
//
// Nothing here is skinned. The swim is a travelling sine down the length of the
// body, which the vertex shader does for free, so two hundred fish cost one
// draw call per species and no CPU at all beyond steering them.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { heightAt, reefMask, coastDistance } from './terrain.js';
import { ModelLibrary } from './models.js';
import { mergeParts } from './meshkit.js';

export const BODY_LENGTH = 2.5;       // normalised model length; scale is metres / this
export const BIG = 0.8;        // metres: longer than this will not go on a spear

const HOME_RANGE = 78;         // schools beyond this are recycled closer in
const DEEP_RANGE = 170;        // ...but the tuna live further out than that
const SPAWN_MIN = 14, SPAWN_MAX = 62;
const DRIFT = 0.45;            // how much of the ocean current they give in to
const FLEE_RADIUS = 3.2;
const SURFACE_CLEARANCE = 0.32;
const RESPAWN = 45;            // seconds before a speared fish is replaced
const RESPAWN_HIDDEN = 14;     // ...and only this far from you, never in view
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const BED_CLEARANCE = 0.55;    // how close a fish gets to the sand, or to the
                               // top of whatever is standing on it

const CURRENT = new THREE.Vector2(0.60, 0.80).normalize();

// Where a school lives. `reef` schools ride the sea bed at a fixed hover, so
// they follow the coral up and over the heads instead of swimming through it;
// the open-water zones hold a depth band instead.
const ZONES = {
  surface: { band: [-1.2, -5.0] },
  mid:     { band: [-4.0, -13.0] },
  reef:    { hover: [1.4, 5.0], floor: [-22, -7] },
  // Flat on the open sand between the colonies — where a flounder lies.
  sand:    { floor: [-20, -4] },
  // Around the raft near the surface: mahi-mahi gather under anything that
  // floats, which is exactly what a raft is.
  raft:    { band: [-1.5, -3.8], radius: [8, 18] },
  // Out over the deep water past the shelf edge, where the tuna run. That is
  // further than the other schools are allowed to roam.
  deep:    { band: [-6, -16], floor: -24, range: [85, 150] },
};

// `length` is nose-to-tail in metres. `mesh` names an object in the .glb; more
// than one species can wear the same body in a different colour, which is what
// real reef fish mostly are.
//
// The lengths run about a third over life size. A 12cm chromis at the 8m you
// normally see one from is three pixels, and three pixels is not wildlife.
// Optional per species: `hover` over the reef, `flee` (how readily it scatters
// from you, 1 normal, 0 not at all — a shark does not), `roam` (how far the
// school wanders), `amp` and `rate` (the swim: a tuna's stiff tail against a
// chromis's flutter), `bed` (how close to the sand it will lie) and `big` (too
// big to skewer on a spear). Baked-colour bodies wear white: their colour is
// in the mesh.
const SPECIES = [
  { key: 'chromis', name: 'chromis',  mesh: 'chromis', color: 0x3f86d6, zone: 'reef',
    schools: 3, per: 24, length: [0.15, 0.21], speed: [0.9, 1.5] },
  { key: 'tang', name: 'yellow tang',     mesh: 'tang',    color: 0xf2bb3c, zone: 'reef',
    schools: 2, per: 13, length: [0.24, 0.34], speed: [0.8, 1.3] },
  { key: 'bluetang', name: 'blue tang', mesh: 'tang',    color: 0x2f6cc0, zone: 'reef',
    schools: 1, per: 10, length: [0.23, 0.32], speed: [0.8, 1.3] },
  { key: 'wrasse', name: 'wrasse',   mesh: 'wrasse',  color: 0x54c48c, zone: 'reef',
    schools: 2, per: 9,  length: [0.22, 0.31], speed: [1.0, 1.7] },
  { key: 'silver', name: 'silverside',   mesh: 'chromis', color: 0xb3c6d4, zone: 'surface',
    schools: 3, per: 16, length: [0.13, 0.20], speed: [1.0, 1.7] },

  // Red snapper: schools around structure, holding a few metres off the reef.
  { key: 'snapper', name: 'red snapper', mesh: 'snapper', color: 0xffffff, zone: 'reef',
    schools: 2, per: 6, length: [0.50, 0.75], speed: [0.8, 1.3], hover: [2.0, 5.0] },
  // Jolthead porgy: in ones and twos low over the reef, picking at the bottom.
  { key: 'porgy', name: 'porgy', mesh: 'porgy', color: 0xffffff, zone: 'reef',
    schools: 2, per: 2, length: [0.35, 0.50], speed: [0.6, 1.0], hover: [0.6, 2.0], roam: 0.6 },
  // Peacock flounder: lying on the sand, still, until you get too close.
  { key: 'flounder', name: 'flounder', mesh: 'flounder', color: 0xffffff, zone: 'sand',
    schools: 3, per: 1, length: [0.28, 0.45], speed: [0.3, 0.6], roam: 0.03, bed: 0.03,
    flee: 0.7, amp: 0.25, rate: [3, 5] },
  // King mackerel: a fast-moving school in mid-water.
  { key: 'mackerel', name: 'mackerel', mesh: 'mackerel', color: 0xffffff, zone: 'mid',
    schools: 1, per: 10, length: [0.55, 0.85], speed: [1.4, 2.2], amp: 0.30, rate: [8, 11] },

  // ── the big ones: none of these fit on a spear ──
  // Yellowfin tuna: a school out past the shelf edge, over the deep water.
  { key: 'tuna', name: 'yellowfin tuna', mesh: 'tuna', color: 0xffffff, zone: 'deep',
    schools: 1, per: 6, length: [0.90, 1.40], speed: [1.6, 2.4], amp: 0.18, rate: [7, 9],
    flee: 0.5, big: true },
  // Great barracuda: hangs almost motionless over the reef, and is not shy.
  { key: 'barracuda', name: 'barracuda', mesh: 'barracuda', color: 0xffffff, zone: 'reef',
    schools: 2, per: 1, length: [0.90, 1.40], speed: [0.3, 0.6], hover: [3.0, 6.5],
    roam: 0.15, flee: 0.15, amp: 0.20, rate: [3, 4], big: true },
  // Grouper: an ambush predator sitting just off the bottom by its hole.
  { key: 'grouper', name: 'grouper', mesh: 'grouper', color: 0xffffff, zone: 'reef',
    schools: 2, per: 1, length: [0.60, 1.00], speed: [0.3, 0.5], hover: [0.4, 1.0],
    roam: 0.1, flee: 0.6, amp: 0.22, rate: [2.5, 3.5], big: true },
  // Mahi-mahi: a small school around the raft, near the surface.
  { key: 'mahi', name: 'mahi-mahi', mesh: 'mahi', color: 0xffffff, zone: 'raft',
    schools: 1, per: 5, length: [0.80, 1.25], speed: [1.2, 2.0], amp: 0.30, rate: [6, 8],
    flee: 0.6, big: true },
  // Blacktip reef shark: patrols the reef in a wide slow circuit, and does not
  // get out of your way.
  { key: 'blacktip', name: 'blacktip reef shark', mesh: 'blacktip', color: 0xffffff, zone: 'reef',
    schools: 2, per: 1, length: [1.10, 1.70], speed: [0.9, 1.4], hover: [2.0, 4.5],
    roam: 1.4, flee: 0, amp: 0.22, rate: [3, 4], big: true },
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
export function normalise(src) {
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
/**
 * The swim material. `axis` is which way the body bends: side to side for a
 * fish, up and down for a whale, whose flukes are horizontal. Exported for
 * src/whale.js.
 */
export function fishMaterial({ axis = 'x' } = {}) {
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
        attribute float aRate;
        attribute float aAmp;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float zn = transformed.z / ${(BODY_LENGTH / 2).toFixed(4)};
        float env = clamp((1.0 - zn) * 0.5, 0.0, 1.0);
        env = pow(env, 1.7);
        float beat = sin(zn * 2.9 + uTime * aRate + aPhase);
        transformed.${axis} += beat * env * aAmp;
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
  mat.customProgramCacheKey = () => 'fish-' + axis;
  return mat;
}

export class FishSchools {
  /**
   * @param terrain  the live Terrain, for its obstacle field. Without it the
   *                 fish fall back to bare ground height and will swim through
   *                 anything standing on it.
   */
  constructor(scene, terrain = null, raft = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.raft = raft;          // the mahi-mahi school holds station on it
    this.material = fishMaterial();
    // A flounder lies on its side, so its swim is up and down, not across.
    this.flatMaterial = fishMaterial({ axis: 'y' });
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
      const mesh = new THREE.InstancedMesh(geo, sp.zone === 'sand' ? this.flatMaterial : this.material,
                                           total);
      mesh.frustumCulled = false;          // they move every frame
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);

      const g = { sp, mesh, total, index: this.groups.length, model: false };
      this.groups.push(g);

      for (let i = 0; i < sp.schools; i++) {
        // A lone fish holds no station: it is the school.
        const alone = sp.per === 1;
        const school = {
          group: g,
          zone: ZONES[sp.zone],
          kind: sp.zone,
          center: new THREE.Vector3(),
          floor: -18,
          hover: sp.zone === 'reef' ? rand(...(sp.hover || ZONES.reef.hover)) : 0,
          radius: alone ? 0 : rand(1.2, 2.6) * Math.max(1, sp.length[1] / 0.4),
          wander: Math.random() * 7,
          wanderSpeed: rand(0.12, 0.3),
          roam: sp.roam ?? 1,
          ring: sp.zone === 'raft' ? rand(...ZONES.raft.radius) : 0,
        };
        this.schools.push(school);
        this.respawn(school, true);

        for (let j = 0; j < sp.per; j++) {
          this.fish.push({
            school, sp,
            // A fixed instance slot. Slots used to be handed out in iteration
            // order each frame, which is fine until one fish goes missing —
            // then every fish after it shifts a slot and takes its neighbour's
            // colour and swim phase.
            index: i * sp.per + j,
            caught: 0,             // > 0: speared, seconds until it is replaced
            pos: school.center.clone().add(new THREE.Vector3(
              rand(-1, 1) * school.radius, rand(-0.6, 0.6), rand(-1, 1) * school.radius)),
            vel: new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)),
            offset: new THREE.Vector3(
              rand(-1, 1) * school.radius, alone ? 0 : rand(-0.55, 0.55), rand(-1, 1) * school.radius),
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
    const amp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      phase[i] = Math.random() * Math.PI * 2;
      rate[i] = rand(...(sp.rate || [7.0, 10.5]));
      amp[i] = sp.amp ?? 0.40;
    }
    // Attributes live on the geometry; a fresh body needs them re-attached.
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 1));
    geo.setAttribute('aAmp', new THREE.InstancedBufferAttribute(amp, 1));

    // Individual colour. Two fish of a species are never the same shade, and
    // this is most of what stops a school reading as one mesh repeated.
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      if (sp.color === 0xffffff) c.setScalar(rand(0.86, 1.0));  // colour is in the mesh
      else c.set(sp.color).offsetHSL((Math.random() - 0.5) * 0.06,
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

    const used = new Set();
    for (const g of this.groups) {
      const src = bodies.get(g.sp.mesh);
      if (!src) continue;
      used.add(g.sp.mesh);
      const geo = normalise(src);
      this.attributes(g, geo);
      g.mesh.geometry.dispose();
      g.mesh.geometry = geo;
      g.model = true;
    }
    // Bodies used against bodies in the file: some species share one (both
    // tangs), and one body in the file is not a fish's at all (the whale).
    if (used.size) this.upgraded.push({ count: used.size, meshes: bodies.size });
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
    const kind = school.kind;
    if (kind === 'raft') {
      const r = this.raftPos();
      const a = Math.random() * Math.PI * 2;
      school.wander = a;
      school.center.set(r.x + Math.cos(a) * school.ring, rand(...school.zone.band), r.z + Math.sin(a) * school.ring);
      return;
    }
    const tries = kind === 'reef' || kind === 'sand' || kind === 'deep' ? 24 : 1;
    for (let attempt = 0; attempt < tries; attempt++) {
      const last = attempt === tries - 1;
      const a = Math.random() * Math.PI * 2;
      const d = kind === 'deep' ? rand(...school.zone.range) : rand(min, SPAWN_MAX);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (kind === 'deep') {
        // Past the drop-off, over water too deep for anything to grow on.
        if (heightAt(x, z) > school.zone.floor && !last) continue;
        school.center.set(x, rand(school.zone.band[1], school.zone.band[0]), z);
      } else if (kind === 'sand') {
        // Open sand: at a depth the shelf has, and nothing growing there.
        const bed = heightAt(x, z);
        const [lo, hi] = school.zone.floor;
        const coral = reefMask(x, z, -coastDistance(x, z));
        if ((bed < lo || bed > hi || coral > 0.08) && !last) continue;
        school.floor = bed;
        school.center.set(x, bed, z);
      } else if (kind === 'reef') {
        const bed = heightAt(x, z);
        const [lo, hi] = ZONES.reef.floor;
        if ((bed < lo || bed > hi) && !last) continue;
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
      if (s.kind === 'raft') {
        // Circle the raft, a few metres under it. The raft is shade and
        // shelter out on open water, and dorado gather under anything that
        // floats — fishermen go looking for weed lines and driftwood for them.
        const r = this.raftPos();
        const a = s.wander * 0.9;
        this._tgt.set(r.x + Math.cos(a) * s.ring, s.center.y, r.z + Math.sin(a) * s.ring);
        s.center.lerp(this._tgt, Math.min(1, dt * 0.8));
        const [top, bottom] = s.zone.band;
        s.center.y = THREE.MathUtils.clamp(s.center.y + Math.sin(s.wander * 0.7) * 0.3 * dt, bottom, top);
        continue;
      }
      const roam = s.roam;
      s.center.x += (CURRENT.x * DRIFT + Math.cos(s.wander) * 0.4) * roam * dt;
      s.center.z += (CURRENT.y * DRIFT + Math.sin(s.wander * 0.8) * 0.4) * roam * dt;

      if (s.kind === 'sand') {
        s.floor = heightAt(s.center.x, s.center.z);
        s.center.y = s.floor;
      } else if (s.kind === 'reef') {
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

      const far = Math.hypot(s.center.x, s.center.z);
      if (far > (s.kind === 'deep' ? DEEP_RANGE : HOME_RANGE)) this.respawn(s);
      else if (s.kind === 'reef' && (s.floor < ZONES.reef.floor[0] - 6)) this.respawn(s);
      // A tuna school that has wandered back over the shelf goes back out.
      else if (s.kind === 'deep' && heightAt(s.center.x, s.center.z) > s.zone.floor + 4) this.respawn(s);
    }

    for (const f of this.fish) {
      const s = f.school;

      // Speared: keep the slot, draw nothing, and put a replacement back into
      // the school once the timer is up — but only out of sight, so a fish
      // never pops into existence in front of you.
      if (f.caught > 0) {
        f.caught -= dt;
        if (f.caught <= 0 && s.center.distanceTo(playerPos) < RESPAWN_HIDDEN) f.caught = 2;
        if (f.caught > 0) { s.group.mesh.setMatrixAt(f.index, HIDDEN); continue; }
        f.pos.copy(s.center).add(f.offset);
        f.vel.set(0, 0, 0);
      }

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
      const shy = f.sp.flee ?? 1;
      if (shy > 0 && pd < FLEE_RADIUS && pd > 0.001) {
        const push = (1 - pd / FLEE_RADIUS) * 9 * shy * dt;
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
      // Big fish sit higher off it by their own depth, or their bellies would
      // be in the sand.
      const flat = s.kind === 'sand';
      const bed = (flat ? heightAt(f.pos.x, f.pos.z) : this.clearance(f.pos.x, f.pos.z)) +
                  (f.sp.bed ?? Math.max(BED_CLEARANCE, f.size * BODY_LENGTH * 0.35));
      if (f.pos.y < bed || flat) { f.pos.y = bed; if (f.vel.y < 0) f.vel.y = 0; }
      if (flat) f.vel.y = 0;         // a flatfish lies flat, and swims flat

      // ── transform ──
      const g = s.group;
      const i = f.index;
      const d = this._dummy;
      d.position.copy(f.pos);
      // Mesh lookAt points local +Z at the target, which is where the nose is.
      // Heading from the horizontal motion, and a resting fish keeps the one
      // it last had rather than snapping round to face +Z. Pitch is limited:
      // a barracuda hovering over a coral head rises and sinks with it, and
      // pointing along that velocity stood it on its tail. Fish do not climb
      // nose-up; they tilt a little and swim.
      const h = Math.hypot(f.vel.x, f.vel.z);
      if (h > 0.02) f.head = Math.atan2(f.vel.x, f.vel.z);
      const pitch = flat ? 0 : THREE.MathUtils.clamp(Math.atan2(f.vel.y, Math.max(h, f.speed)), -0.35, 0.35);
      const ch = Math.cos(pitch), head = f.head || 0;
      this._v.set(f.pos.x + Math.sin(head) * ch, f.pos.y + Math.sin(pitch), f.pos.z + Math.cos(head) * ch);
      d.lookAt(this._v);
      d.scale.setScalar(f.size);
      d.updateMatrix();
      g.mesh.setMatrixAt(i, d.matrix);
    }

    for (const g of this.groups) {
      g.mesh.count = g.total;
      g.mesh.instanceMatrix.needsUpdate = true;
    }

    this.material.userData.time.value = time;
    this.flatMaterial.userData.time.value = time;
  }

  raftPos() {
    return this.raft ? this.raft.group.position : this._origin || (this._origin = new THREE.Vector3());
  }

  /** Whether a fish is too big to go on a spear. */
  isBig(f) { return f.size * BODY_LENGTH > BIG; }

  /** Closest fish to a point, for look-at prompts and later, spearing. */
  nearest(p, maxDist = 2.5) {
    let best = null, bestD = maxDist * maxDist;
    for (const f of this.fish) {
      if (f.caught > 0) continue;
      const d = (f.pos.x - p.x) ** 2 + (f.pos.y - p.y) ** 2 + (f.pos.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /**
   * Fish in front of the camera, weighted toward the centre of the screen.
   * Only the ones a spear can take, unless `big` asks for the others instead.
   */
  pick(origin, dir, maxDist = 3.0, minDot = 0.9, big = false) {
    let best = null, bestScore = -Infinity;
    for (const f of this.fish) {
      if (f.caught > 0 || this.isBig(f) !== big) continue;
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

  /**
   * Every fish whose body the segment a→b passes through — the stretch a
   * thrown spear's point covered this frame. Testing the segment rather than
   * the point matters: at 20 m/s the point moves 30cm a frame, further than a
   * chromis is long, and a point test would step straight over it.
   */
  hitSegment(a, b, out = []) {
    const ab = this._v.copy(b).sub(a);
    const len2 = ab.lengthSq() || 1e-9;
    for (const f of this.fish) {
      // A spear through a metre of tuna or a shark is not a catch: it is a
      // lost spear. They are for the line.
      if (f.caught > 0 || this.isBig(f)) continue;
      const t = THREE.MathUtils.clamp(
        ((f.pos.x - a.x) * ab.x + (f.pos.y - a.y) * ab.y + (f.pos.z - a.z) * ab.z) / len2, 0, 1);
      const dx = f.pos.x - (a.x + ab.x * t), dy = f.pos.y - (a.y + ab.y * t),
            dz = f.pos.z - (a.z + ab.z * t);
      // Generous on purpose: a fish is a moving target a few centimetres
      // thick, and missing one you visibly threw through feels like a bug.
      // Measured: well-aimed throws pass 6-9cm from the fish's centre, so the
      // radius needs to sit comfortably above that, not just at it.
      const r = 0.10 + f.size * BODY_LENGTH * 0.30;
      if (dx * dx + dy * dy + dz * dz < r * r) out.push(f);
    }
    return out;
  }

  /** Take a fish out of the water: gone from its school until it respawns. */
  take(f) {
    f.caught = RESPAWN;
    f.school.group.mesh.setMatrixAt(f.index, HIDDEN);
    f.school.group.mesh.instanceMatrix.needsUpdate = true;
    return f;
  }

  /**
   * A still copy of one fish, to hang on a spear: same body, same colour and
   * size, but a plain material — the swim shader needs per-instance
   * attributes a single mesh does not have, and a skewered fish should not be
   * swimming anyway.
   */
  bodyFor(f) {
    const c = new THREE.Color();
    f.school.group.mesh.getColorAt(f.index, c);
    return this.still(f.school.group, c, f.size);
  }

  /** Species data by key — name, length range, colour — or undefined. */
  species(key) {
    return this.groups.find(g => g.sp.key === key)?.sp;
  }

  /**
   * A still fish of a species that is not one of the schools' — for a rod
   * catch, which comes up from water you cannot see into rather than out of
   * a shoal you were watching.
   *
   * @param length  nose to tail, metres
   */
  displayBody(key, length) {
    const g = this.groups.find(x => x.sp.key === key);
    if (!g) return null;
    const c = new THREE.Color(g.sp.color).offsetHSL((Math.random() - 0.5) * 0.05,
                                                    (Math.random() - 0.5) * 0.15,
                                                    (Math.random() - 0.5) * 0.12);
    return this.still(g, c, length / BODY_LENGTH);
  }

  still(g, color, size) {
    const geo = g.mesh.geometry.clone();
    geo.deleteAttribute('aPhase');
    geo.deleteAttribute('aRate');
    geo.deleteAttribute('aAmp');
    // The swimming fish get a little self-colour so their hue survives the
    // depth; without the same, a speared yellow tang goes olive-grey the
    // moment it leaves the water.
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, color, roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
      emissive: color.clone().multiplyScalar(0.3),
    }));
    mesh.scale.setScalar(size);
    mesh.castShadow = true;
    mesh.userData.fish = { key: g.sp.key, name: g.sp.name };
    return mesh;
  }

  get count() { return this.fish.length; }
}
