// ── Player ───────────────────────────────────────────────────────────────────
// Three states: on the deck, in the air (jumping or stepping off the edge), and
// swimming. Horizontal motion is world space; deck height comes from the raft
// transform so you rise and fall with the swell you are standing on.
//
// Every state takes its heading from moveDir() — one definition of "forward",
// so walking, falling and swimming cannot disagree about which way W is.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { CELL } from './raft.js';
import { heightAt as landHeight, isLand } from './terrain.js';

// Side order matches Raft: 0 = -z, 1 = +x, 2 = +z, 3 = -x.
const NEIGHBOUR_OFFSET = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const EYE = 1.62;
const RADIUS = 0.36;
const WALK = 3.2, SPRINT = 5.3, SWIM = 2.4;
const GRAVITY = 19, JUMP = 5.0;
const AIR_ACCEL = 8.0, AIR_DRAG = 0.8;
const CLIMB_REACH = 2.1;

// Leaping off the side: the reach test has to use the distance the leap really
// covers, or F either refuses when there is water ahead or drops you back on
// your own deck. Derive it from the ballistic range instead of guessing.
const DIVE_SPEED = 4.2, DIVE_VY = 5.0;
const DIVE_RANGE = DIVE_SPEED * (2 * DIVE_VY / GRAVITY);

const SURFACE_EYE = 0.24;    // how far your eyes float above the waterline
// A dive has to be survivable: at these rates a trip to 12m and back costs
// about 8 of the ~18 seconds of air, leaving time to actually look around.
const SWIM_DOWN = 2.4, SWIM_UP = 3.2, BUOYANCY = 1.6, MAX_DEPTH = -26;
const RISE_CAP = 2.4, SINK_CAP = 1.2;

export class Player {
  constructor(camera, raft) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.raft = raft;

    this.pos = new THREE.Vector3(0, 0, 0);      // feet
    this.vel = new THREE.Vector3();             // horizontal, while airborne
    this.vy = 0;
    this.yaw = Math.PI * 0.75;
    this.pitch = -0.34;   // start looking at your own deck
    this.state = 'deck';
    this.bob = 0;
    this.roll = 0;
    this.submerged = false;
    this.sheltered = false;
    this.onLand = false;      // standing on the continent rather than the raft
    this.depth = 0;      // metres of water above your eyes

    this.health = 100;
    this.hunger = 100;
    this.thirst = 100;
    this.breath = 100;
    this.deaths = 0;

    this._fwd = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._p2 = new THREE.Vector2();
    this.events = [];      // messages for the HUD, drained by the game each frame
  }

  say(text, kind = '') { this.events.push({ text, kind }); }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  /** Where the camera is actually looking, unit length. */
  forward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  /**
   * Turn a WASD wish into a world-space direction on the XZ plane.
   *
   * With YXZ euler order and yaw θ, the camera's right axis is (cosθ, 0, -sinθ)
   * and its forward is (-sinθ, 0, -cosθ). `wish.z` is -1 for W, matching the
   * camera looking down its own -Z.
   */
  moveDir(wish, out = new THREE.Vector3()) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    out.set(wish.x * c + wish.z * s, 0, -wish.x * s + wish.z * c);
    return out;
  }

  /** Turn by radians. */
  turn(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dPitch, -1.45, 1.45);
  }

  look(dx, dy, sens) { this.turn(dx * sens, dy * sens); }

  // Camera yaw that looks out through each of a cell's four sides.
  static SIDE_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

  /**
   * Stand up somewhere you can actually see from. Picking the arithmetic centre
   * of the deck is not enough: on a built-up raft that lands you inside the
   * shelter with your face in a wall, which reads as "the raft is gone".
   * So score every cell for openness and start on the best one, looking out.
   */
  respawnOnRaft() {
    const cells = [...this.raft.cells.values()];
    if (!cells.length) {
      this.pos.set(0, 0, 0);
      this.state = 'deck';
      return;
    }

    let mx = 0, mz = 0;
    for (const c of cells) { mx += c.cx; mz += c.cz; }
    mx /= cells.length; mz /= cells.length;

    let best = cells[0], bestScore = -Infinity, bestSides = null, bestSea = null;
    for (const c of cells) {
      // A railing is waist high, so it blocks walking but not the view. Only a
      // full wall counts as something you cannot see past.
      const sightlines = [], seaViews = [];
      for (let s = 0; s < 4; s++) {
        const e = this.raft.edge(c.cx, c.cz, s);
        if (e && e.type === 'wall') continue;
        sightlines.push(s);
        const [dx, dz] = NEIGHBOUR_OFFSET[s];
        if (!this.raft.hasCell(c.cx + dx, c.cz + dz)) seaViews.push(s);
      }

      let score = sightlines.length * 6;
      if (seaViews.length) score += 25;                              // wake up facing the ocean
      if (this.raft.objs.has(`${c.cx},${c.cz}`)) score -= 100;       // not in the campfire
      if (this.raft.isSheltered(c.cx, c.cz)) score -= 40;             // not inside the hut
      if (this.raft.tops.has(`${c.cx},${c.cz}`)) score -= 12;         // open sky preferred
      score -= Math.hypot(c.cx - mx, c.cz - mz) * 2;                  // then near the middle

      if (score > bestScore) {
        bestScore = score; best = c; bestSides = sightlines; bestSea = seaViews;
      }
    }

    this.pos.set(best.cx * CELL, 0, best.cz * CELL);
    this.pos.y = this.raft.deckY(this.pos.x, this.pos.z);
    this.vel.set(0, 0, 0);
    this.state = 'deck';
    this.vy = 0;

    // Face out through a sightline, preferring one that looks at open water.
    const facing = (bestSea && bestSea.length) ? bestSea
                 : (bestSides && bestSides.length) ? bestSides : null;
    if (facing) {
      this.yaw = Player.SIDE_YAW[facing[0]];
      this.pitch = -0.22;
    }
  }

  update(dt, time, input, moveLocked) {
    const wish = new THREE.Vector3();
    if (!moveLocked) {
      if (input.down('KeyW')) wish.z -= 1;
      if (input.down('KeyS')) wish.z += 1;
      if (input.down('KeyA')) wish.x -= 1;
      if (input.down('KeyD')) wish.x += 1;
    }
    if (wish.lengthSq()) wish.normalize();
    const sprinting = input.down('ShiftLeft') || input.down('ShiftRight');

    if (this.state === 'deck') this.walk(dt, time, wish, sprinting, input, moveLocked);
    else if (this.state === 'air') this.fly(dt, time, wish);
    else this.swim(dt, time, wish, sprinting, input, moveLocked);

    this.vitals(dt, time);
    this.applyCamera(dt, time, wish.lengthSq() > 0);
  }

  /**
   * What is holding me up at this point — the raft, the land, or nothing.
   * Every state asks this, so they can never disagree about where the floor is.
   */
  support(x, z) {
    if (this.raft.solidAtWorld(x, z)) return { land: false, y: this.raft.deckY(x, z) };
    if (isLand(x, z)) return { land: true, y: landHeight(x, z) };
    return null;
  }

  /** Slide along walls instead of stopping dead. */
  moveFlat(dx, dz, collide = true) {
    this._p2.set(this.pos.x + dx, this.pos.z + dz);
    if (collide) this.raft.resolve(this._p2, RADIUS);
    this.pos.x = this._p2.x;
    this.pos.z = this._p2.y;
  }

  // ── on the deck ────────────────────────────────────────────────────────────
  walk(dt, time, wish, sprinting, input, moveLocked) {
    this.depth = 0;
    const speed = (sprinting && this.hunger > 5 ? SPRINT : WALK);
    const d = this.moveDir(wish, this._dir);
    const prev = this._prev.copy(this.pos);
    this.moveFlat(d.x * speed * dt, d.z * speed * dt);

    if (!moveLocked && input.pressed('Space')) {
      this.vel.set(d.x * speed, 0, d.z * speed);      // carry momentum into the jump
      this.vy = JUMP;
      this.state = 'air';
      return;
    }
    if (!moveLocked && input.pressed('KeyF')) {
      // A real leap off the side, in the direction you face. From the middle of
      // a big deck there is nothing to leap into, so say that instead of
      // hopping uselessly in place.
      const f = this.moveDir({ x: 0, z: -1 }, this._dir);
      if (this.raft.solidAtWorld(this.pos.x + f.x * DIVE_RANGE, this.pos.z + f.z * DIVE_RANGE)) {
        this.say('Walk to the edge first, then press F to get in the water.');
      } else {
        this.vel.set(f.x * DIVE_SPEED, 0, f.z * DIVE_SPEED);
        this.vy = DIVE_VY;
        this.state = 'air';
        return;
      }
    }

    const ground = this.support(this.pos.x, this.pos.z);
    if (!ground) {
      this.vel.set(d.x * speed * 0.7, 0, d.z * speed * 0.7);
      this.state = 'air';
      this.vy = 0;
      return;
    }
    this.onLand = ground.land;
    // Step up onto a rise, but fall off anything you have walked over the top of.
    if (ground.y > this.pos.y + 0.75) { this.pos.copy(prev); return; }
    this.pos.y = ground.y;
    this.bob += Math.hypot(d.x, d.z) * speed * dt * (sprinting ? 3.6 : 2.8);
  }

  // ── airborne ───────────────────────────────────────────────────────────────
  fly(dt, time, wish) {
    // Air control nudges existing momentum rather than replacing it.
    const d = this.moveDir(wish, this._dir);
    this.vel.x += d.x * AIR_ACCEL * dt;
    this.vel.z += d.z * AIR_ACCEL * dt;
    const drag = Math.max(0, 1 - AIR_DRAG * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > SPRINT) { this.vel.x *= SPRINT / sp; this.vel.z *= SPRINT / sp; }

    this.moveFlat(this.vel.x * dt, this.vel.z * dt);

    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;

    if (this.vy <= 0) {
      const ground = this.support(this.pos.x, this.pos.z);
      if (ground && this.pos.y <= ground.y) {
        this.pos.y = ground.y;
        this.vy = 0;
        this.vel.set(0, 0, 0);
        this.onLand = ground.land;
        this.state = 'deck';
        return;
      }
    }
    const sea = waveHeight(this.pos.x, this.pos.z, time);
    if (this.pos.y <= sea) {
      this.pos.y = sea - EYE + SURFACE_EYE;
      this.vy = 0;
      this.vel.set(0, 0, 0);
      this.state = 'swim';
      this.say('Cold water closes over you. Space to climb out, Z to dive.');
    }
  }

  // ── in the water ───────────────────────────────────────────────────────────
  swim(dt, time, wish, sprinting, input, moveLocked) {
    // Climbing out takes priority over everything else.
    if (!moveLocked && input.pressed('Space')) {
      const spot = this.raft.nearestDeck(this.pos.x, this.pos.z, CLIMB_REACH);
      if (spot) {
        this.pos.set(spot.cx * 2, 0, spot.cz * 2);
        this.pos.y = this.raft.deckY(this.pos.x, this.pos.z);
        this.vy = 0;
        this.vel.set(0, 0, 0);
        this.state = 'deck';
        return;
      }
    }

    // Find your feet as soon as the seabed comes up to meet you.
    const shore = landHeight(this.pos.x, this.pos.z);
    if (shore > waveHeight(this.pos.x, this.pos.z, time) - 0.55) {
      this.pos.y = shore;
      this.vy = 0;
      this.vel.set(0, 0, 0);
      this.onLand = true;
      this.state = 'deck';
      this.say('You wade ashore.');
      return;
    }

    const sea = waveHeight(this.pos.x, this.pos.z, time);
    const floatY = sea - EYE + SURFACE_EYE;    // eyes just above the waterline
    const speed = SWIM * (sprinting ? 1.45 : 1);
    const diving = !moveLocked && input.down('KeyZ');
    const rising = !moveLocked && input.down('Space');

    this.forward(this._fwd);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const strafe = wish.x, fwd = -wish.z;      // fwd = +1 for W

    // Strafing always stays flat. Once your head is under, forward follows the
    // way you are looking, so you dive by aiming down and swimming.
    let mx, mz, my = 0;
    if (this.submerged) {
      mx = strafe * c + fwd * this._fwd.x;
      mz = strafe * -s + fwd * this._fwd.z;
      my = fwd * this._fwd.y;
    } else {
      mx = strafe * c + fwd * -s;
      mz = strafe * -s + fwd * -c;
    }

    // Only collide with raft structures near the surface — you can swim under it.
    const nearDeck = this.pos.y + EYE > this.raft.group.position.y - 0.25;
    this.moveFlat(mx * speed * dt, mz * speed * dt, nearDeck);

    let vy = my * speed;
    if (diving) vy -= SWIM_DOWN;
    else if (rising) vy += SWIM_UP;
    else vy += THREE.MathUtils.clamp((floatY - this.pos.y) * BUOYANCY, -SINK_CAP, RISE_CAP);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y + vy * dt, MAX_DEPTH, floatY + 0.35);

    const eyeY = this.pos.y + EYE;
    const surface = waveHeight(this.pos.x, this.pos.z, time);
    this.submerged = eyeY < surface;
    this.depth = Math.max(0, surface - eyeY);
  }

  // ── hunger, thirst, breath ─────────────────────────────────────────────────
  vitals(dt, time) {
    const sheltered = this.state === 'deck' && !this.onLand &&
                      this.raft.shelteredAtWorld(this.pos.x, this.pos.z);
    this.sheltered = sheltered;

    const exertion = this.state === 'swim' ? 1.5 : 1;
    this.hunger = Math.max(0, this.hunger - dt * 0.105 * exertion * (sheltered ? 0.55 : 1));
    this.thirst = Math.max(0, this.thirst - dt * 0.155 * exertion * (sheltered ? 0.75 : 1));

    if (this.submerged) this.breath = Math.max(0, this.breath - dt * 5.5);
    else this.breath = Math.min(100, this.breath + dt * 24);

    let drain = 0;
    if (this.hunger <= 0) drain += 0.8;
    if (this.thirst <= 0) drain += 1.1;
    if (this.breath <= 0) drain += 7;
    if (drain > 0) this.health = Math.max(0, this.health - dt * drain);
    else if (this.hunger > 30 && this.thirst > 30) this.health = Math.min(100, this.health + dt * 0.5);

    if (this.health <= 0) {
      this.deaths++;
      this.health = 55;
      this.hunger = Math.max(this.hunger, 40);
      this.thirst = Math.max(this.thirst, 40);
      this.breath = 100;
      this.respawnOnRaft();
      this.say('You black out, and wake on the deck. Still adrift.', 'bad');
    }
  }

  // ── camera ─────────────────────────────────────────────────────────────────
  applyCamera(dt, time, moving) {
    const bobY = this.state === 'deck' && moving ? Math.sin(this.bob) * 0.045 : 0;

    // Inherit a little of the raft's roll so the deck feels like it is moving.
    const e = new THREE.Euler().setFromQuaternion(this.raft.group.quaternion, 'YXZ');
    const want = (this.state === 'deck' && !this.onLand)
      ? e.z * 0.45 : Math.sin(time * 0.6) * 0.02;
    this.roll = THREE.MathUtils.lerp(this.roll, want, Math.min(1, dt * 3));

    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
  }

  // Position deliberately isn't saved: you always wake up standing on your own
  // deck, which makes it impossible to load into the middle of the ocean.
  toJSON() {
    return { yaw: this.yaw, health: this.health, hunger: this.hunger, thirst: this.thirst };
  }

  load(d) {
    if (!d) return;
    this.yaw = d.yaw ?? this.yaw;
    this.health = d.health ?? 100;
    this.hunger = d.hunger ?? 100;
    this.thirst = d.thirst ?? 100;
  }
}
