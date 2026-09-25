// ── Camera rig ───────────────────────────────────────────────────────────────
// Where the picture is taken from. The player does not move the camera any
// more: it moves an *eye* (player.js drives it exactly as it used to drive
// the camera), and every piece of play — what you can reach, where a spear
// flies from, what a fish notices — works from that eye. This decides where
// the camera goes relative to it:
//
//   first   at the eye, as it always was
//   third   behind you and over your right shoulder, looking where you look
//   second  out in front of you, looking back at your face
//
// Outside first person the camera is kept out of walls, the roof, the
// ground and the sea bed: it is pulled in along the line from your head, so
// what it shows is never the inside of a plank. And with your head above the
// water it stays above the swell too — a swimmer's eyes are a hand's breadth
// off the surface, and a camera at that height behind them is under every
// passing wave.

import { caveAt, roofAt } from './caves.js';
import * as THREE from 'three';
import { waveHeight } from './ocean.js';

export const VIEWS = ['first', 'third', 'second'];
const NAMES = { first: 'First person', third: 'Third person', second: 'Second person' };

const BACK = 3.1;            // metres behind the eye, third person
const SHOULDER = 0.42;       // metres to the right of it
const LIFT = 0.28;           // and above it
const FRONT = 2.5;           // metres in front, second person
const CLEAR = 0.22;          // how far short of an obstacle the camera stops
const ABOVE_SEA = 0.32;      // how far over the waves it keeps, your head being above them

const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _want = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class CameraRig {
  /**
   * @param camera  the camera the world is drawn with
   * @param eye     the camera-shaped object the player moves (never drawn with)
   */
  constructor(camera, eye, raft, terrain) {
    this.camera = camera;
    this.eye = eye;
    this.raft = raft;
    this.terrain = terrain;
    this.mode = 'first';
    this.reach = 0;          // eased distance out from the head, so walls do not snap it
  }

  get name() { return NAMES[this.mode]; }
  get first() { return this.mode === 'first'; }

  set(mode) {
    if (!VIEWS.includes(mode)) mode = 'first';
    this.mode = mode;
    this.reach = 0.3;        // grow out from the head on a switch, rather than cut
  }

  cycle() {
    this.set(VIEWS[(VIEWS.indexOf(this.mode) + 1) % VIEWS.length]);
    return this.mode;
  }

  /** @param time  the sea's clock, for where the waves are */
  update(dt, time = 0) {
    const eye = this.eye, cam = this.camera;
    eye.updateMatrixWorld();
    if (this.mode === 'first') {
      cam.position.copy(eye.position);
      cam.quaternion.copy(eye.quaternion);
      cam.updateMatrixWorld();
      return;
    }
    eye.getWorldDirection(_dir);
    let dist;
    if (this.mode === 'third') {
      _right.set(1, 0, 0).applyQuaternion(eye.quaternion);
      _want.copy(eye.position).addScaledVector(_dir, -BACK).addScaledVector(_right, SHOULDER);
      _want.y += LIFT;
    } else {
      _want.copy(eye.position).addScaledVector(_dir, FRONT);
      _want.y += 0.05;
    }
    // Pulled in short of anything between the head and where it wants to be.
    const to = _want.clone().sub(eye.position);
    const full = to.length();
    to.divideScalar(full || 1);
    dist = this.clearance(eye.position, to, full);
    // In fast, out slowly: a wall arriving must not let the camera through
    // it for a frame, and one leaving should not make it leap back.
    this.reach = dist < this.reach ? dist : this.reach + (dist - this.reach) * Math.min(1, dt * 4);
    cam.position.copy(eye.position).addScaledVector(to, this.reach);
    // Head above water: so is the camera. Under it (diving), it follows you down.
    if (eye.position.y > waveHeight(eye.position.x, eye.position.z, time) - 0.05) {
      cam.position.y = Math.max(cam.position.y, waveHeight(cam.position.x, cam.position.z, time) + ABOVE_SEA);
    }

    if (this.mode === 'third') {
      cam.quaternion.copy(eye.quaternion);
    } else {
      // Looking back at the face, a little below the eyes.
      cam.lookAt(eye.position.x, eye.position.y - 0.08, eye.position.z);
    }
    cam.updateMatrixWorld();
  }

  /** How far from `from` along `dir` the camera can go, up to `max`. */
  clearance(from, dir, max) {
    let best = max;
    // The raft: walls, roof, railings, the deck — not what stands on it: a
    // camera that ducks in for a campfire's flame or a collector's rim is
    // twitching at nothing.
    _ray.set(from, dir);
    _ray.far = max;
    const solid = this.raft.pickables.filter(m => m.userData.piece?.kind !== 'object');
    const hit = _ray.intersectObjects(solid, false)[0];
    if (hit) best = Math.min(best, hit.distance - CLEAR);
    // In a cave, the tube round you: the camera keeps inside it (caves.js) —
    // and the ground over you, the hill, is no floor of yours down here.
    if (caveAt(from.x, from.z, from.y - 1.5)) {
      for (let s = 0.1; s <= 1.0001; s += 0.1) {
        const d = max * s;
        const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
        const hit = caveAt(x, z, y - 0.2);
        if (!hit || y > roofAt(hit) - 0.15 || hit.d > hit.w * 0.75) { best = Math.min(best, d - max * 0.1 - CLEAR); break; }
      }
      return Math.max(0.15, best);
    }
    // The ground and the sea bed, sampled along the line.
    if (this.terrain) {
      for (let s = 0.25; s <= 1.0001; s += 0.25) {
        const d = max * s;
        const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
        if (y < this.terrain.heightAt(x, z) + 0.3) { best = Math.min(best, d - max * 0.25 - CLEAR); break; }
      }
    }
    return Math.max(0.15, best);
  }
}
