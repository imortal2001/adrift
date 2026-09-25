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
// Nothing here is skinned. The swim is a wave down the body done in the vertex
// shader (src/swim.js), each fin moving its own way, so two hundred fish cost
// one draw call per species. What the CPU does is decide how each fish swims:
// how fast it beats, when it coasts, how it bends into a turn — and how it
// reacts to you, which is different for every species.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { heightAt, reefMask, coastDistance } from './terrain.js';
import { ModelLibrary } from './models.js';
import { mergeParts } from './meshkit.js';
import { BODY_LENGTH, styleFor, swimMaterial, tagParts, Swimmer, applySkin, skinOf } from './swim.js';

export { BODY_LENGTH };
export const BIG = 0.8;        // metres: longer than this will not go on a spear

const HOME_RANGE = 78;         // schools beyond this are recycled closer in
const DEEP_RANGE = 170;        // ...but the tuna live further out than that
const SPAWN_MIN = 14, SPAWN_MAX = 62;
const DRIFT = 0.45;            // how much of the ocean current they give in to
// How close you get before each kind of fish reacts, and how it does.
//   school  a fright runs through the shoal; it bursts away and regroups
//   dart    the same, faster and further — open-water fish
//   hide    a damselfish drops into the coral rather than swimming off
//   bolt    a flatfish shoots off along the bottom, then settles again
//   curious a barracuda turns to face you, and only backs off when close
//   retreat a grouper backs away toward its hole, watching you
//   ignore  a shark keeps its line and only swerves at arm's length
//   circle  a great white comes over and circles you, wide, to look —
//           and swerves off if you close on it
//
// The spearable fish sense you from inside a spear throw (~3-3.7 m, see
// spear.js): measured, a fright radius any wider took throws at chromis from
// 11 hits in 16 to 3. Close in and they bolt; stay at a throw and you get one.
const SENSE = { school: 2.5, dart: 3.5, hide: 2.6, bolt: 2.0, curious: 6.0, retreat: 3.2, ignore: 1.8,
                circle: 14 };
const CIRCLE = 6.5;            // how wide a great white circles something it is sizing up
const ALARM = 3.0;             // seconds a frightened school keeps moving off
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
// Optional per species: `hover` over the reef, `react` (how it responds to
// you — see SENSE), `roam` (how far the school wanders) and `bed` (how close
// to the sand it will lie). How each one swims is its style in src/swim.js.
// Baked-colour bodies wear white: their colour is in the mesh.
const SPECIES = [
  { key: 'chromis', name: 'chromis',  mesh: 'chromis', color: 0x3f86d6, zone: 'reef',
    schools: 3, per: 24, length: [0.15, 0.21], speed: [0.9, 1.5], react: 'hide' },
  { key: 'tang', name: 'yellow tang',     mesh: 'tang',    color: 0xf2bb3c, zone: 'reef',
    schools: 2, per: 13, length: [0.24, 0.34], speed: [0.8, 1.3] },
  // Its own body now: a rounder disc than the yellow tang's, and the black
  // palette marking and yellow tail are in the mesh, so it wears no tint.
  { key: 'bluetang', name: 'blue tang', mesh: 'bluetang', color: 0xffffff, zone: 'reef',
    schools: 1, per: 10, length: [0.23, 0.32], speed: [0.8, 1.3] },
  { key: 'wrasse', name: 'wrasse',   mesh: 'wrasse',  color: 0x54c48c, zone: 'reef',
    schools: 2, per: 9,  length: [0.22, 0.31], speed: [1.0, 1.7] },
  // A slender body of its own, with the huge eye and silver stripe.
  { key: 'silver', name: 'silverside',   mesh: 'silverside', color: 0xffffff, zone: 'surface',
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
    react: 'bolt' },
  // King mackerel: a fast-moving school in mid-water.
  { key: 'mackerel', name: 'mackerel', mesh: 'mackerel', color: 0xffffff, zone: 'mid',
    schools: 1, per: 10, length: [0.55, 0.85], speed: [1.4, 2.2], react: 'dart' },

  // ── the big ones: none of these fit on a spear ──
  // Yellowfin tuna: a school out past the shelf edge, over the deep water.
  { key: 'tuna', name: 'yellowfin tuna', mesh: 'tuna', color: 0xffffff, zone: 'deep',
    schools: 1, per: 6, length: [0.90, 1.40], speed: [1.6, 2.4], react: 'dart', big: true },
  // Great barracuda: hangs almost motionless over the reef, and is not shy.
  { key: 'barracuda', name: 'barracuda', mesh: 'barracuda', color: 0xffffff, zone: 'reef',
    schools: 2, per: 1, length: [0.90, 1.40], speed: [0.3, 0.6], hover: [3.0, 6.5],
    roam: 0.15, react: 'curious', big: true },
  // Grouper: an ambush predator sitting just off the bottom by its hole.
  { key: 'grouper', name: 'grouper', mesh: 'grouper', color: 0xffffff, zone: 'reef',
    schools: 2, per: 1, length: [0.60, 1.00], speed: [0.3, 0.5], hover: [0.4, 1.0],
    roam: 0.1, react: 'retreat', big: true },
  // Mahi-mahi: a small school around the raft, near the surface.
  { key: 'mahi', name: 'mahi-mahi', mesh: 'mahi', color: 0xffffff, zone: 'raft',
    schools: 1, per: 5, length: [0.80, 1.25], speed: [1.2, 2.0], react: 'dart', big: true },
  // Blacktip reef shark: patrols the reef in a wide slow circuit, and does not
  // get out of your way.
  // Its body is a textured model of the real species (`model`; CREDITS.md),
  // converted by tools/build_shark.py; the procedural one in reef_fish.glb is
  // the fallback.
  { key: 'blacktip', name: 'blacktip reef shark', mesh: 'blacktip', model: 'shark_blacktip',
    color: 0xffffff, zone: 'reef',
    schools: 2, per: 1, length: [1.10, 1.70], speed: [0.9, 1.4], hover: [2.0, 4.5],
    roam: 1.4, react: 'ignore', big: true },
  // Great white shark: a rare visitor off the drop-off, patrolling deep water.
  // Nothing on a raft lands one, so nothing takes it — like the whale, it is
  // there to be seen, and it comes to see you. Body: a third-party model
  // (CREDITS.md), converted by tools/build_great_white.py.
  { key: 'greatwhite', name: 'great white shark', mesh: 'greatwhite', model: 'shark_greatwhite',
    color: 0xffffff, zone: 'deep', schools: 1, per: 1, length: [3.5, 4.5], speed: [1.0, 1.5],
    roam: 1.6, react: 'circle', big: true, catchable: false },
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
  return tagParts(geo);
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
    this.fallback = normalise(fallbackBody());
    this.lively = new Set();   // single fish out of their schools: on a spear, a line, a deck
    // Playing together (sharedworld.js): the others, whom fish react to as
    // they do to you; whether the schools follow the host's rather than
    // wander off on their own; and who to tell when a fish is taken.
    this.others = [];
    this.follow = false;
    this.onTake = null;

    this.groups = [];
    this.schools = [];
    this.fish = [];

    for (const sp of SPECIES) {
      // A clone each: the per-instance swim attributes live on the geometry,
      // and they are sized to that species' school. Sharing one buffer would
      // leave the largest species reading off the end of the smallest's.
      const geo = this.fallback.clone();
      const total = sp.schools * sp.per;
      // One material per species: each swims its own way. A flounder lies on
      // its side, so its swim is up and down, not across.
      const style = styleFor(sp.key);
      const axis = sp.zone === 'sand' ? 'y' : 'x';
      const material = swimMaterial({ axis, style });
      const mesh = new THREE.InstancedMesh(geo, material, total);
      mesh.frustumCulled = false;          // they move every frame
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);

      const g = { sp, mesh, total, index: this.groups.length, model: false, style, axis, material };
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
          alarm: 0,                // > 0: frightened, moving off from `threat`
          threat: new THREE.Vector3(),
          members: [],
        };
        this.schools.push(school);
        this.respawn(school, true);

        for (let j = 0; j < sp.per; j++) {
          const length = rand(sp.length[0], sp.length[1]);
          const f = {
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
            size: length / BODY_LENGTH,
            speed: rand(sp.speed[0], sp.speed[1]),
            // How it swims: a bigger fish of the same kind beats slower.
            swim: new Swimmer(style, length / ((sp.length[0] + sp.length[1]) / 2)),
            head: Math.random() * Math.PI * 2,
            yawRate: 0,
            fright: 0,             // > 0: bolting, seconds left
            delay: 0,              // > 0: about to bolt — reaction time
            from: new THREE.Vector3(),
            flee: new THREE.Vector3(),
            look: null,            // something it has turned to watch
          };
          this.fish.push(f);
          school.members.push(f);
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
   * Per-instance swim state, plus the colour each fish wears. Instance order
   * never changes — a fish keeps its slot for the life of the run — so the
   * colours are written once.
   */
  attributes(g, geo) {
    const sp = g.sp;
    const n = g.mesh.instanceMatrix.count;
    // Phase, amplitude, bend and flap for each fish, rewritten every frame by
    // its Swimmer. Attributes live on the geometry; a fresh body needs them
    // re-attached.
    g.swimAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    g.swimAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSwim', g.swimAttr);

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
    entry.scene.traverse(o => { if (o.isMesh) bodies.set(o.name, o); });
    if (!bodies.size) return;
    // Species with a model file of their own: theirs wins over reef_fish.glb.
    for (const g of this.groups) {
      if (!g.sp.model) continue;
      const own = await this.library.get(g.sp.model);
      let body = null;
      own?.scene.traverse(o => { if (o.isMesh && (!body || o.name === g.sp.mesh)) body = o; });
      if (body) bodies.set(g.sp.mesh, body);
    }

    const used = new Set();
    for (const g of this.groups) {
      const src = bodies.get(g.sp.mesh);
      if (!src) continue;
      used.add(g.sp.mesh);
      const geo = normalise(src.geometry);
      // The painted skin — colour and normal map — comes with the body.
      g.skin = skinOf(src);
      if (g.skin) applySkin(g.material, g.skin);
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
      // Round the raft, wherever it has got to.
      const hub = this.raftPos();
      const x = hub.x + Math.cos(a) * d, z = hub.z + Math.sin(a) * d;
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
      // A frightened school moves off from what frightened it, as a body,
      // and only drifts back into its old habits once the alarm has passed.
      if (s.alarm > 0) {
        s.alarm -= dt;
        this._v.copy(s.center).sub(s.threat);
        this._v.y = s.kind === 'sand' ? 0 : this._v.y * 0.3;
        const d = this._v.length();
        if (d > 0.01) s.center.addScaledVector(this._v, (1.4 * Math.min(1, s.alarm)) / d * dt);
      }
      if (s.kind === 'raft') {
        // Circle the raft, a few metres under it. The raft is shade and
        // shelter out on open water, and dorado gather under anything that
        // floats — fishermen go looking for weed lines and driftwood for them.
        const r = this.raftPos();
        const a = s.wander * 0.9;
        this._tgt.set(r.x + Math.cos(a) * s.ring, s.center.y, r.z + Math.sin(a) * s.ring);
        s.center.lerp(this._tgt, Math.min(1, dt * (s.alarm > 0 ? 0.1 : 0.8)));
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
        // A frightened damselfish shoal drops right into the coral.
        s.floor = this.clearance(s.center.x, s.center.z);
        const hide = s.alarm > 0 && s.group.sp.react === 'hide';
        const want = s.floor + (hide ? 0.2 : s.hover + Math.sin(s.wander * 0.9) * 0.5);
        s.center.y += (want - s.center.y) * Math.min(1, dt * (hide ? 3 : 1.6));
      } else {
        const [top, bottom] = s.zone.band;
        s.center.y += Math.sin(s.wander * 0.55) * 0.3 * dt;
        s.center.y = THREE.MathUtils.clamp(s.center.y, bottom, top);
      }

      // Following the host's schools, where they go is the host's to say.
      if (this.follow) continue;
      const hub = this.raftPos();
      const far = Math.hypot(s.center.x - hub.x, s.center.z - hub.z);
      if (far > (s.kind === 'deep' ? DEEP_RANGE : HOME_RANGE)) this.respawn(s);
      else if (s.kind === 'reef' && (s.floor < ZONES.reef.floor[0] - 6)) this.respawn(s);
      // A tuna school that has wandered back over the shelf goes back out.
      else if (s.kind === 'deep' && heightAt(s.center.x, s.center.z) > s.zone.floor + 4) this.respawn(s);
    }

    for (const f of this.fish) {
      const s = f.school;
      const g = s.group;
      const st = f.swim.st;

      // Speared: keep the slot, draw nothing, and put a replacement back into
      // the school once the timer is up — but only out of sight, so a fish
      // never pops into existence in front of you.
      if (f.caught > 0) {
        f.caught -= dt;
        if (f.caught <= 0 && s.center.distanceTo(playerPos) < RESPAWN_HIDDEN) f.caught = 2;
        if (f.caught > 0) { g.mesh.setMatrixAt(f.index, HIDDEN); continue; }
        f.pos.copy(s.center).add(f.offset);
        f.vel.set(0, 0, 0);
        f.fright = f.delay = 0;
      }

      // Station-keeping: the offset orbits the school centre, so the shoal
      // churns instead of sitting in a fixed lattice.
      const a = time * 0.3 + f.orbit;
      const ca = Math.cos(a), sa = Math.sin(a);
      this._tgt.set(
        s.center.x + f.offset.x * ca - f.offset.z * sa,
        s.center.y + f.offset.y,
        s.center.z + f.offset.x * sa + f.offset.z * ca);

      // ── reacting to you ── or whichever of you is nearest
      f.look = null;
      const you = this.nearestOf(f.pos, playerPos);
      const dx = f.pos.x - you.x, dy = f.pos.y - you.y, dz = f.pos.z - you.z;
      const pd = Math.hypot(dx, dy, dz);
      const react = f.sp.react || 'school';
      if (f.delay > 0 && (f.delay -= dt) <= 0) this.bolt(f);
      let push = 0;
      if (pd < SENSE[react] && pd > 0.001) {
        const near = 1 - pd / SENSE[react];
        switch (react) {
          case 'curious':
            // Turn and watch. Back off, slowly, only when you are close.
            f.look = you;
            if (pd < 2.0) push = near * 2.5;
            if (pd < 1.1) this.frighten(f, you, 0.1);
            break;
          case 'retreat':
            // Back away toward the bottom, still facing you.
            f.look = you;
            push = near * 3.0;
            this._tgt.y -= near * 1.2;
            if (pd < 1.3) this.frighten(f, you, 0.12);
            break;
          case 'circle': {
            // Swing the station round you, wide and slow, at your depth.
            const ang = time * 0.22 + f.orbit;
            this._tgt.set(you.x + Math.cos(ang) * CIRCLE, you.y + Math.sin(ang * 0.7) * 1.2,
                          you.z + Math.sin(ang) * CIRCLE);
            if (pd < 2.5) {
              f.vel.x += (-dz / pd) * near * 3 * dt;
              f.vel.z += (dx / pd) * near * 3 * dt;
            }
            break;
          }
          case 'ignore':
            // Keep going; swerve round you if you are in the way.
            if (pd < 1.8) {
              f.vel.x += (-dz / pd) * near * 4 * dt;
              f.vel.z += (dx / pd) * near * 4 * dt;
            }
            break;
          default:
            this.frighten(f, you, react === 'dart' ? 0.04 : 0.1);
            push = near * 6;
        }
      }

      // Steer for the station — or, bolting, for away.
      const coasting = f.swim.coasting;
      if (f.fright > 0) {
        f.fright -= dt;
        this._v.copy(f.flee).multiplyScalar(f.speed * st.burst);
        f.vel.lerp(this._v, Math.min(1, dt * 7));
      } else {
        this._v.copy(this._tgt).sub(f.pos);
        const reach = this._v.length();
        if (reach > 0.001) {
          this._v.multiplyScalar(f.speed / reach);
          // Big fish turn wide; a coasting fish is not steering at all.
          f.vel.lerp(this._v, Math.min(1, dt * st.agility * (coasting ? 0.3 : 1)));
        }
        if (coasting) f.vel.multiplyScalar(1 - dt * 0.35);
      }
      if (push > 0) {
        f.vel.x += (dx / pd) * push * dt;
        f.vel.y += (dy / pd) * push * dt;
        f.vel.z += (dz / pd) * push * dt;
      }

      const spd = f.vel.length();
      const cap = f.speed * (f.fright > 0 ? st.burst * 1.1 : 2.6);
      if (spd > cap) f.vel.multiplyScalar(cap / spd);

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

      // ── heading ──
      // From the horizontal motion, and a resting fish keeps the one it last
      // had rather than snapping round to face +Z. One watching you turns to
      // face you instead. Pitch is limited: a barracuda hovering over a coral
      // head rises and sinks with it, and pointing along that velocity stood
      // it on its tail. Fish do not climb nose-up; they tilt a little and swim.
      const h = Math.hypot(f.vel.x, f.vel.z);
      let want = f.head;
      if (f.look && f.fright <= 0) want = Math.atan2(f.look.x - f.pos.x, f.look.z - f.pos.z);
      else if (h > 0.02) want = Math.atan2(f.vel.x, f.vel.z);
      let turn = want - f.head;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      // A watching fish turns slowly on the spot; a moving one follows its path.
      const step = f.look && f.fright <= 0 ? THREE.MathUtils.clamp(turn, -1.2 * dt, 1.2 * dt) : turn;
      f.head += step;
      f.yawRate += (step / Math.max(dt, 1e-4) - f.yawRate) * Math.min(1, dt * 6);

      // ── the stroke ──
      f.swim.step(dt, h / f.speed + (flat ? 0 : Math.abs(f.vel.y) / f.speed * 0.5), f.yawRate,
                  f.fright > 0 ? 1 : 0);
      f.swim.write(g.swimAttr.array, f.index * 4);

      // ── transform ──
      const d = this._dummy;
      d.position.copy(f.pos);
      const pitch = flat ? 0 : THREE.MathUtils.clamp(Math.atan2(f.vel.y, Math.max(h, f.speed)), -0.35, 0.35);
      const ch = Math.cos(pitch);
      this._v.set(f.pos.x + Math.sin(f.head) * ch, f.pos.y + Math.sin(pitch), f.pos.z + Math.cos(f.head) * ch);
      d.lookAt(this._v);
      // Bank into the turn a little, as a fish does — never a flatfish.
      // (A positive yaw rate turns toward the fish's +X; leaning the back that
      // way is a negative roll about the nose.)
      if (!flat) d.rotateZ(THREE.MathUtils.clamp(-f.yawRate * 0.1, -0.35, 0.35));
      d.scale.setScalar(f.size);
      d.updateMatrix();
      g.mesh.setMatrixAt(f.index, d.matrix);
    }

    for (const g of this.groups) {
      g.mesh.count = g.total;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.swimAttr.needsUpdate = true;
      g.material.userData.time.value = time;
    }

    this.animateLively(dt, time);
  }

  /** You, or another player if one is nearer to `p`. */
  nearestOf(p, you) {
    let best = you, bd = p.distanceToSquared(you);
    for (const o of this.others) {
      const d = p.distanceToSquared(o);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ── playing together ───────────────────────────────────────────────────────
  /** Where each school is: [x, y, z, alarm], in school order — the same on every machine. */
  schoolState() {
    const r = v => Math.round(v * 10) / 10;
    return this.schools.map(s => [r(s.center.x), r(s.center.y), r(s.center.z), s.alarm > 0 ? r(s.alarm) : 0]);
  }

  /**
   * Move the schools to where the host has them — eased if near, so the
   * fish in them swim across rather than jump; put there if far (a school
   * the host recycled somewhere else).
   */
  setSchools(list) {
    list.forEach((st, i) => {
      const s = this.schools[i];
      if (!s || !Array.isArray(st)) return;
      const [x, y, z, alarm] = st;
      const d = Math.hypot(x - s.center.x, z - s.center.z);
      if (d > 12) {
        s.center.set(x, y, z);
        for (const f of s.members) f.pos.set(x, y, z).add(f.offset);
      } else s.center.lerp(this._v.set(x, y, z), 0.5);
      if (alarm > s.alarm) { s.alarm = alarm; s.threat.copy(s.center); }
    });
  }

  // ── fright ─────────────────────────────────────────────────────────────────
  /**
   * Something alarming at `point`: a spear going past, a thrust, a fish taken
   * out of the shoal. Every fish within `radius` bolts, after its own
   * reaction time — which is why a well-aimed spear still gets there first.
   */
  startle(point, radius = 3, delay = 0.12) {
    const r2 = radius * radius;
    for (const f of this.fish) {
      if (f.caught > 0) continue;
      if (f.pos.distanceToSquared(point) < r2) this.frighten(f, point, delay);
    }
  }

  /**
   * Arm a fish to bolt from `from` once its reaction time is up, and pass the
   * alarm to its shoal: each fish reacts a moment after the one next to it,
   * so a fright visibly ripples through a school rather than every fish
   * jumping at once.
   */
  frighten(f, from, delay) {
    if (f.fright > 0 || f.delay > 0) return;
    f.from.copy(from);
    f.delay = delay + Math.random() * 0.08;
    const s = f.school;
    if (s.alarm <= 0.5) {
      s.alarm = ALARM;
      s.threat.copy(from);
      for (const m of s.members) {
        if (m === f || m.caught > 0 || m.fright > 0 || m.delay > 0) continue;
        m.from.copy(from);
        m.delay = f.delay + 0.05 + m.pos.distanceTo(f.pos) * 0.07;
      }
    }
  }

  /** The fast start itself: a C-shaped snap of the body, and away. */
  bolt(f) {
    const react = f.sp.react || 'school';
    f.flee.copy(f.pos).sub(f.from);
    if (react === 'bolt') f.flee.y = 0;                     // along the bottom
    if (react === 'hide') f.flee.y = -Math.abs(f.flee.length()) * 0.9;   // down into the coral
    if (f.flee.lengthSq() < 1e-6) f.flee.set(Math.sin(f.head), 0, Math.cos(f.head));
    f.flee.normalize();
    // Which way it has to turn: toward the fish's own +X or -X.
    const side = Math.cos(f.head) * f.flee.x - Math.sin(f.head) * f.flee.z;
    f.swim.startle(side);
    f.fright = rand(0.45, 0.9) * (react === 'dart' ? 1.4 : 1);
  }

  // ── fish out of the school ─────────────────────────────────────────────────
  /**
   * Keep a lone fish alive: on a spear it struggles in bursts that weaken over
   * a few seconds and stop; on a line the fishing code drives it instead (it
   * sets `userData.driven`). Either way its clock runs here.
   */
  animateLively(dt, time) {
    for (const m of this.lively) {
      const u = m.userData;
      u.age += dt;
      u.mat.userData.time.value = time;
      if (!m.parent && u.age > 2) { this.lively.delete(m); continue; }
      if (u.driven) continue;
      // Bursts of thrashing, further apart and weaker as it dies.
      u.burst -= dt;
      if (u.burst <= 0) {
        u.fighting = !u.fighting;
        u.burst = u.fighting ? rand(0.3, 0.8) : rand(0.5, 1.6) * (1 + u.age * 0.15);
        u.side = Math.random() < 0.5 ? -1 : 1;
      }
      const life = Math.exp(-u.age / 5);
      const effort = u.fighting ? 1.4 * life : 0.05 * life;
      u.swimmer.step(dt, 0, u.fighting ? u.side * 5 * life * Math.sin(u.age * 9) : 0, effort);
      if (life < 0.1) u.swimmer.amp *= 1 - dt * 2;           // gone still, ~12 s on
      u.swimmer.writeVec(u.mat.userData.swim);
      if (u.age > 40) this.lively.delete(m);
    }
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

  /**
   * Take a fish out of the water: gone from its school until it respawns.
   * `told`: someone else took it, and has told everyone already.
   */
  take(f, told = false) {
    if (!told) this.onTake?.(this.fish.indexOf(f));
    // The rest of the shoal sees it go.
    this.startle(f.pos, 3.5, 0.05);
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
    geo.deleteAttribute('aSwim');
    // The same swim shader as the school, on one fish: it struggles on a
    // spear, fights on a line and flaps on the deck (see animateLively). The
    // tint goes on as the material colour.
    const mat = swimMaterial({ axis: g.axis, style: g.style, single: true, skin: g.skin });
    mat.color.copy(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(size);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.fish = { key: g.sp.key, name: g.sp.name };
    Object.assign(mesh.userData, {
      mat, age: 0, burst: 0, fighting: false, side: 1, driven: false,
      swimmer: new Swimmer(g.style, (size * BODY_LENGTH) / ((g.sp.length[0] + g.sp.length[1]) / 2)),
    });
    this.lively.add(mesh);
    return mesh;
  }

  get count() { return this.fish.length; }
}
