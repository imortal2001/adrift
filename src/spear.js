// ── Thrown spears ────────────────────────────────────────────────────────────
// Right-click with a spear in hand and it leaves your hand: it flies, lands,
// and stays where it landed until you go and pull it out with E. Throwing one
// takes it out of your inventory, so a spear in the sand is a spear you do not
// have until you fetch it.
//
// What a spear does on the way:
//
// * In air it is a ballistic dart — gravity, and the shaft turns to follow its
//   own velocity so it always arrives point first.
// * It sticks in whatever the point meets hard enough: the beach, the sea bed,
//   the top of a coral head, or the deck (where it is re-parented to the raft
//   so it rides the swell with it).
// * In water it is a stick of wood. Drag kills its speed within a couple of
//   metres, and it floats back up. So a spear thrown into deep water is never
//   lost at the bottom of the basin: it surfaces and bobs where it came up.
//
// And it skewers fish. Every frame the stretch the point covered is tested
// against the schools; each fish it passes through is taken out of the water
// and hung on the shaft, and the spear carries on — slower — so a throw
// through a tight shoal can come back with more than one. Pull the spear out
// and the fish come with it.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';

const AIR_SPEED = 22;          // m/s off the hand — a decent javelin throw
// What an arm manages against water. Set against the fish rather than the
// physics: they scatter from anything within 3.2m (fish.js, FLEE_RADIUS), so a
// throw has to stay fast enough to skewer a little past that — about 3.7m.
const WATER_SPEED = 12;
const LOFT = 1.4;              // m/s of lift, so a throw at the horizon carries
const GRAVITY = 9.8;
const WATER_DRAG = 2.6;        // per second, exponential: a couple of metres
const FLOAT = 12.8;            // upward accel in water; minus gravity, it rises
const STICK_SPEED = 3.5;       // slower than this and it glances, not sticks
const EMBED = 0.16;            // how far the point buries itself
const FISH_DRAG = 0.72;        // speed kept through each fish it skewers
// Where skewered fish hang: just behind the lashing, stacking towards the grip.
const SKEWER_AT = 0.70, SKEWER_STEP = 0.14, SKEWER_MAX = 4;

// Along the shaft, from the grip — tools/build_tools.py puts the origin at 42%
// of a 1.75m spear, so the point is 1.01m ahead of it and the butt 0.74m behind.
const TIP = 1.01, BUTT = 0.74;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Seconds for a spear to cover `dist` through water, where drag makes its
 * speed fall off linearly with distance (v = v0 - k·s). Used to lead a moving
 * fish. It treats the whole path as water, which slightly over-leads a throw
 * from the deck — by the length of the air gap, a metre or two at 20 m/s.
 */
export function travelTime(dist, underwater) {
  const v0 = underwater ? WATER_SPEED : AIR_SPEED;
  return Math.log(v0 / Math.max(0.5, v0 - WATER_DRAG * dist)) / WATER_DRAG;
}

export class ThrownSpears {
  /**
   * @param makeBody  returns a fresh spear Object3D in the tool frame (along
   *                  +Y, origin at the grip) — the same body the hand holds
   */
  constructor(scene, terrain, raft, fish, makeBody) {
    this.scene = scene;
    this.terrain = terrain;
    this.raft = raft;
    this.fish = fish;
    this.makeBody = makeBody;
    this._hits = [];
    this._prevTip = new THREE.Vector3();
    this.list = [];
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  get count() { return this.list.length; }

  /** Fish hanging on spears still out in the world. */
  get fishCount() { return this.list.reduce((n, s) => n + s.catch.length, 0); }

  /**
   * @param from        world position of the grip at release
   * @param dir         unit direction to throw along
   * @param underwater  whether the throw starts under the surface
   * @param loft        add a little lift — for a throw at nothing in
   *                    particular, so it carries; not for one aimed at a fish
   */
  throw(from, dir, underwater, loft = true) {
    const body = this.makeBody();
    body.visible = true;
    body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(body);

    const s = {
      body,
      pos: from.clone(),
      vel: dir.clone().multiplyScalar(underwater ? WATER_SPEED : AIR_SPEED),
      axis: dir.clone(),
      state: 'flying',        // flying -> stuck | floating
      where: null,            // what it stuck in, for the pickup message
      age: 0,
      catch: [],              // { key, name } per fish on the shaft
    };
    if (!underwater && loft) s.vel.y += LOFT;
    this.list.push(s);
    this.place(s);
    return s;
  }

  update(dt, time) {
    for (const s of this.list) {
      if (s.state === 'flying') this.fly(s, dt, time);
      else if (s.state === 'floating') this.float(s, dt, time);
    }
  }

  fly(s, dt, time) {
    s.age += dt;
    this._prevTip.copy(s.pos).addScaledVector(s.axis, TIP);
    const wet = s.pos.y < waveHeight(s.pos.x, s.pos.z, time);
    if (wet) {
      // Drag acts along the flight, so it slows the spear without bending it.
      // Buoyancy would bend it — so it is faded in only as the spear slows. A
      // spear at 15 m/s holds its line; the same spear at 1 m/s is driftwood.
      const lift = THREE.MathUtils.clamp(1 - s.vel.length() / 6, 0, 1);
      s.vel.multiplyScalar(Math.exp(-WATER_DRAG * dt));
      s.vel.y += (FLOAT - GRAVITY) * lift * dt;
    } else {
      s.vel.y -= GRAVITY * dt;
    }
    s.pos.addScaledVector(s.vel, dt);

    // Point first. Once it has slowed in the water it stops steering by its
    // velocity and is left to settle.
    const speed = s.vel.length();
    if (speed > 1.2) s.axis.copy(s.vel).divideScalar(speed);

    // ── what the point has run into ──
    const tip = this._v.copy(s.pos).addScaledVector(s.axis, TIP);

    // Fish first: they are in the way of the ground, not behind it. Only a
    // point moving with some force skewers anything; a spear drifting up to
    // the surface just nudges past.
    if (speed > 2.5 && s.catch.length < SKEWER_MAX) {
      this._hits.length = 0;
      for (const f of this.fish.hitSegment(this._prevTip, tip, this._hits)) {
        if (s.catch.length >= SKEWER_MAX) break;
        this.skewer(s, this.fish.bodyFor(this.fish.take(f)));
        s.vel.multiplyScalar(FISH_DRAG);
      }
    }

    if (this.raft.solidAtWorld(tip.x, tip.z)) {
      const deck = this.raft.deckY(tip.x, tip.z);
      if (tip.y <= deck && tip.y > deck - 0.6) {
        this.stick(s, tip, deck, 'deck');
        this.raft.group.attach(s.body);    // ride the swell with the raft
        return;
      }
    }

    // The sea bed, the land, or the top of a coral head — clearanceAt knows
    // all three.
    const ground = this.terrain.clearanceAt(tip.x, tip.z);
    if (tip.y <= ground) {
      if (speed >= STICK_SPEED) {
        this.stick(s, tip, ground, wet ? 'seabed' : 'ground');
        return;
      }
      s.pos.y += ground - tip.y;           // too slow to bite: rest on it
      s.vel.set(0, 0, 0);
    }

    // Slowed right down in the water: it is driftwood now. Horizontal speed,
    // not total — rising, it settles at over 1 m/s (buoyancy against drag), so
    // a total-speed test only passed once it had shot clean out of the water.
    const drift = Math.hypot(s.vel.x, s.vel.z);
    if (wet && drift < 1.0 && s.pos.y > waveHeight(s.pos.x, s.pos.z, time) - 0.6) {
      s.state = 'floating';
      s.vel.set(0, 0, 0);
    }
    // Never leave one flying forever, whatever happened.
    if (s.age > 25) s.state = 'floating';

    this.place(s);
  }

  /**
   * Hang a fish on the shaft. The shaft goes through its flanks — in the
   * fish's frame that is its X axis — which is how a fish ends up on a spear,
   * rather than threaded nose to tail like a kebab. Each one after the first
   * sits further down the shaft, turned a different way about it.
   */
  skewer(s, body) {
    const k = s.catch.length;
    body.position.set(0, SKEWER_AT - SKEWER_STEP * k, 0);
    body.rotation.set(0, 0.9 + k * 2.1, Math.PI / 2);
    s.body.add(body);
    s.catch.push(body.userData.fish);
  }

  /** Bury the point `EMBED` past the contact and freeze it there. */
  stick(s, tip, surface, where) {
    const contact = this._v.set(tip.x, surface, tip.z);
    s.pos.copy(contact).addScaledVector(s.axis, EMBED - TIP);
    s.vel.set(0, 0, 0);
    s.state = 'stuck';
    s.where = where;
    this.place(s);
  }

  /** Lie along the surface and ride the waves where it came up. */
  float(s, dt, time) {
    s.axis.y *= 0.9;                       // settle towards horizontal
    if (s.axis.lengthSq() < 1e-4) s.axis.set(1, 0, 0);
    s.axis.normalize();
    // Ease up to the surface rather than snap: it turns to driftwood half a
    // metre under, and a half-metre jump in one frame is very visible.
    const surface = waveHeight(s.pos.x, s.pos.z, time) + 0.02;
    s.pos.y += (surface - s.pos.y) * Math.min(1, dt * 4);
    s.where = 'water';
    this.place(s);
  }

  place(s) {
    s.body.position.copy(s.pos);
    s.body.quaternion.copy(this._q.setFromUnitVectors(UP, s.axis));
  }

  /**
   * The spear under the crosshair, if one is close enough to take. Tested
   * along the whole shaft, not just its middle, so you can grab the end that
   * is sticking out of the sand.
   */
  pick(origin, dir, maxDist) {
    let best = null, bestPerp = 0.32;
    const grip = new THREE.Vector3(), axis = new THREE.Vector3(), q = new THREE.Quaternion(),
          p = new THREE.Vector3();
    for (const s of this.list) {
      // Anything but a spear still in full flight. One drifting up from the
      // reef is technically still flying — for the ten-odd seconds it takes
      // to surface — and making you watch it float past out of reach, just
      // because it has not arrived yet, would be absurd.
      if (s.state === 'flying' && s.vel.length() > 2.5) continue;
      s.body.getWorldPosition(grip);
      axis.copy(UP).applyQuaternion(s.body.getWorldQuaternion(q));
      for (let k = 0; k <= 6; k++) {
        p.copy(grip).addScaledVector(axis, -BUTT + (TIP + BUTT) * (k / 6));
        const along = p.clone().sub(origin).dot(dir);
        if (along < 0 || along > maxDist) continue;
        const perp = p.clone().sub(origin).addScaledVector(dir, -along).length();
        if (perp < bestPerp) { bestPerp = perp; best = s; }
      }
    }
    return best;
  }

  /**
   * Pull it out: gone from the world, with whatever it caught. The caller puts
   * both back in the inventory.
   */
  take(s) {
    s.body.removeFromParent();
    s.body.traverse(o => {                 // the skewered fish are clones
      if (o.isMesh && o.userData.fish) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.list.splice(this.list.indexOf(s), 1);
    return { where: s.state === 'flying' ? 'drifting' : s.where, fish: s.catch };
  }
}
