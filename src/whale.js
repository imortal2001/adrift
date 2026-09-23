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
const ROUTE = [48, 95];              // metres from the raft it keeps to
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

    const r = this.raft.group.position;
    const a = Math.random() * Math.PI * 2;
    this.pos.set(r.x + Math.cos(a) * ROUTE[1], CRUISE_DEPTH, r.z + Math.sin(a) * ROUTE[1]);
    this.pickGoal();
    this.ready = true;
  }

  /** The next place to swim to: somewhere else on the ring round the raft. */
  pickGoal() {
    const r = this.raft.group.position;
    const here = Math.atan2(this.pos.z - r.z, this.pos.x - r.x);
    const a = here + rand(0.6, 1.4) * (Math.random() < 0.8 ? 1 : -1);
    const d = rand(...ROUTE);
    this.goal.set(r.x + Math.cos(a) * d, 0, r.z + Math.sin(a) * d);
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
    // coral head: over the reef it goes up and over.
    const floor = this.terrain ? this.terrain.clearanceAt(this.pos.x, this.pos.z) : -30;
    const lowest = floor + 2.2;

    // Head for the goal; pick another when it gets there.
    const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
    if (Math.hypot(dx, dz) < 8) this.pickGoal();
    const want = Math.atan2(dx, dz);
    let turn = want - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.yaw += THREE.MathUtils.clamp(turn, -0.12 * dt, 0.12 * dt);   // wide, slow turns

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
