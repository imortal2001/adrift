// ── The whale ────────────────────────────────────────────────────────────────
// One humpback, passing along the reef. It is not a thing to catch or fight —
// nothing on a raft lands forty tonnes — it is there to make the sea feel
// bigger than the water you can reach.
//
// It does what a humpback does on the move: cruises a few metres down, comes
// up every few minutes and blows three or four times a dozen seconds apart —
// a bushy spout, three or four metres tall, you can see from the raft — then
// arches its back and sounds, the flukes coming up clear of the water as it
// goes down. Then nothing for a while.
//
// The body is whale_humpback.glb — a textured humpback ("Game-ready Humpback
// Whale" by Allie2k, CC BY 4.0), converted by tools/build_whale.py — or, without
// it, the `whale` mesh in reef_fish.glb. Either is bent by the same swim shader
// as the fish, but up and down: a whale's flukes are horizontal. No model, no
// whale; nothing depends on it.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { normalise, BODY_LENGTH } from './fish.js';
import { swimMaterial, styleFor, Swimmer, applySkin, skinOf } from './swim.js';

const LENGTH = 12.5;                 // metres; a grown humpback is 12-16
const CRUISE_DEPTH = -9;             // where its back rides between breaths
const CRUISE_SPEED = 2.0;            // m/s — an unhurried humpback
const DOWN_TIME = [55, 95];          // seconds under between surfacings
const BLOWS = [3, 5];                // breaths per surfacing
const BLOW_GAP = [9, 14];            // seconds between them
const SOUND_TIME = 9;                // the dive, flukes and all
const ROUTE = [48, 110];             // metres from the raft it keeps to
// Water it will swim in: a sea bed at least this deep. The back rides at 9m
// and the body is ~3m deep, so shallower than this and it would be shoved up
// the beach by the floor — out of the water, or on the sand. The land is only
// ~80m from the raft on one side, so a plain ring round the raft runs aground
// on a quarter of its length; it has to know where the deep water is.
const DEEP = -15;                    // a goal, or a place to start from
const SHOAL = -12.5;                 // ahead of it: turn away from anything shallower
const LOOK = [14, 28, 42];           // metres ahead it checks the depth at
const TURN = 0.12, TURN_HARD = 0.24; // rad/s: cruising, and swinging off a shoal
const SPOUT = 160;                   // particles in the blow
const SPOUT_BURST = 0.45;            // seconds the blow lasts at the blowhole

const rand = (a, b) => a + Math.random() * (b - a);

export class Whale {
  /**
   * @param fish  the FishSchools, for its model library — one fetch of the
   *              .glb serves both
   */
  constructor(scene, terrain, raft, fish) {
    this.scene = scene;
    this.terrain = terrain;
    this.raft = raft;
    this.ready = false;
    this.style = styleFor('whale');
    this.material = swimMaterial({ axis: 'y', style: this.style });
    this.swimmer = new Swimmer(this.style);
    this.lastPitch = 0;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.state = 'cruise';           // cruise → rise → breathe → sound → cruise
    this.timer = rand(20, 45);       // the first surfacing comes early
    this.blows = 0;
    this.sounds = 0;                 // times it has gone down, for tests

    this.spout = this.makeSpout();
    scene.add(this.spout.points);

    this.load(fish.library);
  }

  async load(library) {
    // Its own model first; the procedural one in reef_fish.glb if that is missing.
    let body = null;
    for (const file of ['whale_humpback', 'reef_fish']) {
      const entry = await library.get(file);
      entry?.scene.traverse(o => { if (o.isMesh && o.name === 'whale') body = o; });
      if (body) break;
    }
    if (!body) return;
    const geo = normalise(body.geometry);
    this.skin = skinOf(body);
    if (this.skin) applySkin(this.material, this.skin);
    this.swimAttr = new THREE.InstancedBufferAttribute(new Float32Array(4), 4);
    this.swimAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSwim', this.swimAttr);
    this.mesh = new THREE.InstancedMesh(geo, this.material, 1);
    this.mesh.setColorAt(0, new THREE.Color(0xffffff));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);
    this._m = new THREE.Object3D();
    this._m.rotation.order = 'YXZ';

    // Start out on the ring, in deep water.
    const r = this.raft.group.position;
    const start = this.deepSpot(Math.random() * Math.PI * 2, ROUTE[1]);
    this.pos.set(start.x, CRUISE_DEPTH, start.z);
    this.yaw = Math.atan2(r.x - start.x, r.z - start.z) + Math.PI / 2;
    this.pickGoal();
    this.ready = true;
  }

  /** Height of the sea bed, coral heads and all. */
  floor(x, z) {
    return this.terrain ? this.terrain.clearanceAt(x, z) : -30;
  }

  /** The shallowest the bed gets on a straight swim from here to (x, z). */
  shallowest(x0, z0, x1, z1) {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 8));
    let top = -Infinity;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      top = Math.max(top, this.floor(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t));
    }
    return top;
  }

  /**
   * A point in deep water near bearing `a` from the raft: tries the ring
   * either side of the bearing, then further out, and settles for the deepest
   * it found if the raft is somewhere with no deep water close by at all.
   */
  deepSpot(a, d) {
    const r = this.raft.group.position;
    let best = null, bestFloor = Infinity;
    for (const reach of [d, d * 1.4, d * 2]) {
      for (let k = 0; k < 16; k++) {
        const b = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
        const x = r.x + Math.cos(b) * reach, z = r.z + Math.sin(b) * reach;
        const f = this.floor(x, z);
        if (f <= DEEP) return { x, z };
        if (f < bestFloor) { bestFloor = f; best = { x, z }; }
      }
    }
    return best;
  }

  /**
   * The next place to swim to: somewhere else on the ring round the raft,
   * in deep water and with deep water all the way there. Failing that, any
   * deep spot on the ring; the steering keeps it off the shoals between.
   */
  pickGoal() {
    const r = this.raft.group.position;
    const here = Math.atan2(this.pos.z - r.z, this.pos.x - r.x);
    for (let tries = 0; tries < 24; tries++) {
      const a = here + rand(0.6, 1.4) * (Math.random() < 0.8 ? 1 : -1);
      const d = rand(...ROUTE);
      const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      if (this.floor(x, z) > DEEP) continue;
      if (tries < 16 && this.shallowest(this.pos.x, this.pos.z, x, z) > SHOAL) continue;
      this.goal.set(x, 0, z);
      return;
    }
    const spot = this.deepSpot(here + Math.PI, ROUTE[0]);
    this.goal.set(spot.x, 0, spot.z);
  }

  /**
   * Which way to swim: at the goal, unless there is a shoal ahead, in which
   * case the heading nearest the goal with deep water in front of it. Looks
   * a good way ahead because a humpback turns wide — at cruising speed it
   * needs 25m or so to come round a quarter turn.
   */
  heading(want) {
    const clear = yaw => {
      let top = -Infinity;
      for (const d of LOOK) {
        top = Math.max(top, this.floor(this.pos.x + Math.sin(yaw) * d, this.pos.z + Math.cos(yaw) * d));
      }
      return top;
    };
    if (clear(want) <= SHOAL && clear(this.yaw) <= SHOAL) return { yaw: want, hard: false };
    // Fan out from the current heading, toward the goal side first.
    const side = Math.sign(Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw))) || 1;
    let best = null, bestTop = Infinity;
    for (let k = 1; k <= 12; k++) {
      const yaw = this.yaw + side * (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.4;
      const top = clear(yaw);
      if (top <= SHOAL) return { yaw, hard: true };
      if (top < bestTop) { bestTop = top; best = yaw; }
    }
    return { yaw: best, hard: true };
  }

  makeSpout() {
    const pos = new Float32Array(SPOUT * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // A soft round puff, not the square a bare point draws.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const mat = new THREE.PointsMaterial({
      color: 0xf4f8fa, size: 0.9, map: new THREE.CanvasTexture(c), transparent: true,
      opacity: 0, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    const vel = new Float32Array(SPOUT * 3);
    const delay = new Float32Array(SPOUT);   // when each drop leaves the blowhole
    return { points, pos, vel, delay, at: new THREE.Vector3(), age: 0, t: 1 };
  }

  /** A blow: a column of spray up out of the blowhole, spreading as it falls. */
  blow() {
    const sp = this.spout;
    // The blowhole is on top of the head, about a third of the way back.
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const at = this.pos.clone().addScaledVector(fwd, LENGTH * 0.28);
    at.y = Math.max(at.y + 1.2, waveHeight(at.x, at.z, this.time) + 0.2);
    sp.at.copy(at);
    sp.age = 0;
    for (let i = 0; i < SPOUT; i++) {
      // Out over half a second, not all at once: that is what makes it a
      // column rather than a ball of spray.
      sp.delay[i] = Math.random() * SPOUT_BURST;
      sp.pos[i * 3] = at.x + rand(-0.15, 0.15);
      sp.pos[i * 3 + 1] = at.y - 0.6;       // waiting its turn, under water
      sp.pos[i * 3 + 2] = at.z + rand(-0.15, 0.15);
      const up = rand(6.5, 9.5);          // ~4m: v² / 2g
      sp.vel[i * 3] = rand(-1, 1) * 0.9;
      sp.vel[i * 3 + 1] = up;
      sp.vel[i * 3 + 2] = rand(-1, 1) * 0.9;
    }
    sp.t = 0;
    sp.points.visible = true;
    this.blows++;
  }

  update(dt, time) {
    this.time = time;
    this.updateSpout(dt);
    if (!this.ready) return;
    this.material.userData.time.value = time;

    const sea = waveHeight(this.pos.x, this.pos.z, time);
    // Its back, not its belly, rides at the depth, and never through a
    // coral head: over the reef it goes up and over. Taken under the head and
    // the tail as well as the middle — it is 12m long, and a nose driven into
    // a rising bed is as wrong as a belly.
    const fx = Math.sin(this.yaw) * LENGTH * 0.4, fz = Math.cos(this.yaw) * LENGTH * 0.4;
    const floor = Math.max(this.floor(this.pos.x, this.pos.z),
      this.floor(this.pos.x + fx, this.pos.z + fz), this.floor(this.pos.x - fx, this.pos.z - fz));
    // Never lifted clear of the water, whatever is under it: the steering
    // keeps it off the shoals, and if the raft ever drifts it into them it
    // lies low and swims out rather than riding up the beach.
    const lowest = Math.min(floor + 2.2, sea - 0.9);

    // Head for the goal, around any shoal on the way; pick another when it
    // gets there, or when a shoal has turned it well off its line.
    const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
    if (Math.hypot(dx, dz) < 8) this.pickGoal();
    const want = Math.atan2(dx, dz);
    this.steerIn = (this.steerIn ?? 0) - dt;
    if (this.steerIn <= 0) {
      this.steerIn = 0.25;
      this.course = this.heading(want);
      if (this.course.hard && Math.abs(Math.atan2(Math.sin(want - this.course.yaw),
          Math.cos(want - this.course.yaw))) > 1.2) this.pickGoal();
    }
    let turn = this.course.yaw - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const rate = this.course.hard ? TURN_HARD : TURN;                  // wide, slow turns
    this.yaw += THREE.MathUtils.clamp(turn, -rate * dt, rate * dt);

    let targetY, speed = CRUISE_SPEED, pitch = 0;
    this.timer -= dt;
    switch (this.state) {
      case 'cruise':
        targetY = CRUISE_DEPTH;
        if (this.timer <= 0) { this.state = 'rise'; this.timer = 12; }
        break;
      case 'rise':
        targetY = sea - 0.9;
        if (this.pos.y > sea - 1.3 || this.timer <= 0) {
          this.state = 'breathe';
          this.blowsLeft = Math.round(rand(...BLOWS));
          this.timer = 0.6;
        }
        break;
      case 'breathe':
        // Rolling along the top, the back just awash.
        targetY = sea - 0.9 + Math.sin(time * 0.5) * 0.15;
        speed = CRUISE_SPEED * 0.8;
        if (this.timer <= 0) {
          if (this.blowsLeft-- > 0) {
            this.blow();
            this.timer = rand(...BLOW_GAP);
          } else {
            this.state = 'sound';
            this.timer = SOUND_TIME;
          }
        }
        break;
      case 'sound': {
        // The arch: nose down steeply, so the tail comes up and over. The
        // pitch ramps up and eases off again as it levels out below.
        const p = 1 - this.timer / SOUND_TIME;
        pitch = Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.85;
        // It tips over more than it sinks at first — the body rolls forward
        // over the head, which is what lifts the tail clear — and only then
        // goes down in earnest.
        this.descent = 0.2 + 0.8 * THREE.MathUtils.smoothstep(p, 0.3, 0.65);
        targetY = null;
        speed = CRUISE_SPEED * 1.1;
        if (this.timer <= 0) {
          this.state = 'cruise';
          this.timer = rand(...DOWN_TIME);
          this.sounds++;
        }
        break;
      }
    }

    // Vertical: a gentle approach to the depth wanted, or, sounding, along
    // wherever its nose is pointing.
    if (targetY !== null) {
      const y = Math.max(targetY, lowest);
      this.vel.y += ((y - this.pos.y) * 0.5 - this.vel.y) * Math.min(1, dt * 1.2);
      this.pitch += (THREE.MathUtils.clamp(-this.vel.y * 0.25, -0.35, 0.35) - this.pitch) * Math.min(1, dt * 1.5);
    } else {
      this.pitch += (pitch - this.pitch) * Math.min(1, dt * 2.5);
      this.vel.y = -Math.sin(this.pitch) * speed * this.descent;
    }
    const flat = speed * Math.cos(this.pitch);
    this.vel.x = Math.sin(this.yaw) * flat;
    this.vel.z = Math.cos(this.yaw) * flat;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < lowest) { this.pos.y = lowest; if (this.vel.y < 0) this.vel.y = 0; }

    const m = this._m;
    m.position.copy(this.pos);
    m.rotation.set(this.pitch, this.yaw, 0);
    m.scale.setScalar(LENGTH / BODY_LENGTH);
    m.updateMatrix();
    this.mesh.setMatrixAt(0, m.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    // The stroke: harder as it climbs or sounds, and the arch of a dive is
    // the body curving — which for a whale is up and down, not sideways.
    const pitchRate = (this.pitch - this.lastPitch) / Math.max(dt, 1e-4);
    this.lastPitch = this.pitch;
    const effort = this.state === 'sound' || this.state === 'rise' ? 0.5 : 0;
    this.swimmer.step(dt, speed / CRUISE_SPEED, -pitchRate, effort);
    this.swimmer.write(this.swimAttr.array, 0);
    this.swimAttr.needsUpdate = true;
  }

  updateSpout(dt) {
    const sp = this.spout;
    if (sp.t >= 1) { sp.points.visible = false; return; }
    sp.t = Math.min(1, sp.t + dt / 3.2);
    sp.age += dt;
    for (let i = 0; i < SPOUT; i++) {
      if (sp.age < sp.delay[i]) continue;
      if (sp.pos[i * 3 + 1] < sp.at.y - 0.3) sp.pos[i * 3 + 1] = sp.at.y;   // away it goes
      sp.vel[i * 3 + 1] -= 9.8 * dt;
      // Air drag spreads the column into the bushy cloud a humpback blows.
      sp.vel[i * 3] *= 1 + dt * 0.6;
      sp.vel[i * 3 + 2] *= 1 + dt * 0.6;
      sp.vel[i * 3 + 1] *= 1 - dt * 0.9;
      sp.pos[i * 3] += sp.vel[i * 3] * dt;
      sp.pos[i * 3 + 1] += sp.vel[i * 3 + 1] * dt;
      sp.pos[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
    }
    sp.points.geometry.attributes.position.needsUpdate = true;
    sp.points.material.opacity = 0.75 * (1 - sp.t) * Math.min(1, sp.t * 12);
  }
}
