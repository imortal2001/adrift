// ── Floating debris ──────────────────────────────────────────────────────────
// A fixed pool of flotsam drifting down one current. Items are recycled
// upstream when they pass out of range, so the ocean always looks inhabited
// without ever growing the scene graph.

import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { waveHeight, waveNormal } from './ocean.js';
import { textures } from './textures.js';
import { DEBRIS_KINDS } from './items.js';

const POOL = 60;
const SPAWN_DIST = 98;      // metres upstream
const KILL_DIST = 112;      // metres downstream before recycling
const BAND = 14;            // lateral spread of the current
const SPEED = 1.35;
const COCONUT_SCALE = 2.4;  // the scanned nut is hand-sized, ~17 cm; afloat it is shown at 40, as the old one was

const CURRENT = new THREE.Vector2(0.60, 0.80).normalize();
const SIDE = new THREE.Vector2(-CURRENT.y, CURRENT.x);

const WEIGHTED = [];
for (const k in DEBRIS_KINDS) for (let i = 0; i < DEBRIS_KINDS[k].weight; i++) WEIGHTED.push(k);

let GEOS = null;
function shapes() {
  if (GEOS) return GEOS;
  const t = textures();
  const std = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...o });
  const M = {
    log:   std(t.log, { roughness: 0.95 }),
    plank: std(t.plank),
    metal: std(t.metal, { roughness: 0.6, metalness: 0.4 }),
    palm:  std(t.palm, { side: THREE.DoubleSide, roughness: 0.75 }),
    husk:  std(null, { color: 0x6d4a2b, roughness: 0.9 }),
  };

  const put = (g, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    o.castShadow = true;
    return o;
  };

  GEOS = {
    log() {
      const g = new THREE.Group();
      const c = new THREE.CylinderGeometry(0.19, 0.16, 2.3, 9);
      c.rotateZ(Math.PI / 2);
      g.add(put(c, M.log, 0, 0, 0));
      const b = new THREE.CylinderGeometry(0.08, 0.06, 0.6, 6);
      b.rotateZ(Math.PI / 2);
      g.add(put(b, M.log, 0.9, 0.12, 0.2, 0, 0.6, 0.3));
      return g;
    },
    flotsam() {
      const g = new THREE.Group();
      const b = new THREE.BoxGeometry(1.5, 0.09, 0.3);
      for (let i = 0; i < 3; i++) {
        g.add(put(b, M.plank, (Math.random() - 0.5) * 0.3, i * 0.06,
                  (i - 1) * 0.33, 0, (Math.random() - 0.5) * 0.5, 0));
      }
      return g;
    },
    palm() {
      const g = new THREE.Group();
      const q = new THREE.PlaneGeometry(1.9, 0.62);
      for (let i = 0; i < 2; i++) {
        g.add(put(q, M.palm, 0, 0.03 + i * 0.03, (i - 0.5) * 0.28,
                  -Math.PI / 2 + 0.1, (i ? 0.3 : -0.25), 0));
      }
      return g;
    },
    barrel() {
      const g = new THREE.Group();
      const c = new THREE.CylinderGeometry(0.33, 0.33, 0.9, 14);
      c.rotateZ(Math.PI / 2);
      g.add(put(c, M.metal, 0, 0, 0));
      const r = new THREE.TorusGeometry(0.34, 0.035, 6, 16);
      for (const d of [-0.28, 0.28]) g.add(put(r, M.metal, d, 0, 0, 0, Math.PI / 2, 0));
      return g;
    },
    crate() {
      const g = new THREE.Group();
      g.add(put(new THREE.BoxGeometry(0.78, 0.66, 0.78), M.plank, 0, 0, 0));
      const s = new THREE.BoxGeometry(0.82, 0.07, 0.07);
      for (const d of [-0.24, 0.24]) {
        g.add(put(s, M.plank, 0, d, 0.4));
        g.add(put(s, M.plank, 0, d, -0.4));
      }
      return g;
    },
    // The stand-in until the scanned nut (assets/models/coconut.glb) loads;
    // see DebrisField.dress().
    coconut() {
      const g = new THREE.Group();
      const s = new THREE.SphereGeometry(0.21, 10, 8);
      s.scale(1, 0.88, 0.94);
      g.add(put(s, M.husk, 0, 0, 0));
      return g;
    },
  };
  return GEOS;
}

export class DebrisField {
  constructor(scene, raft) {
    this.scene = scene;
    this.raft = raft;
    this.items = [];
    const make = this.make = shapes();
    this.nut = null;          // the scanned coconut, once dress() has it

    for (let i = 0; i < POOL; i++) {
      const kind = WEIGHTED[(Math.random() * WEIGHTED.length) | 0];
      const obj = make[kind]();
      obj.userData.debrisIndex = i;
      scene.add(obj);
      const it = {
        kind, obj,
        x: 0, z: 0, y: 0,
        yaw: Math.random() * 7,
        spin: (Math.random() - 0.5) * 0.35,
        // A coconut rides high, a third of it out of the water.
        buoy: kind === 'coconut' ? 0.02 : kind === 'palm' ? 0.01 : -0.04,
        held: false,          // hooked and being reeled in
      };
      this.items.push(it);
      // Seed the first batch spread along the whole corridor so the ocean
      // isn't empty for the first two minutes.
      this.respawn(it, Math.random() * (SPAWN_DIST + KILL_DIST) - SPAWN_DIST);
    }
  }

  /**
   * Swap the procedural coconuts for the scanned one once it has loaded —
   * the same file the one in your hand uses, from the same library, so it is
   * fetched once. Well over twice the size of the nut in hand: at 20 m a real
   * one is a speck, and most of a floating nut is under the water. Lying on its side, the way a round nut floats. Best-effort; the
   * stand-ins stay if there is no file.
   */
  async dress(library) {
    const entry = await library.get('coconut');
    let nut = null;
    entry?.scene.traverse(o => { if (o.isMesh && !nut) nut = o; });
    if (!nut) return;
    this.nut = nut;
    for (const it of this.items) if (it.kind === 'coconut') this.dressNut(it.obj);
  }

  dressNut(obj) {
    const m = this.nut.clone();
    m.scale.setScalar(COCONUT_SCALE);
    m.rotation.set(1.3 + Math.random() * 0.5, Math.random() * 7, 0);
    m.castShadow = true;
    obj.clear();
    obj.add(m);
  }

  // ── playing together ───────────────────────────────────────────────────────
  /** Every piece: [kind, x, z], in slot order. */
  snapshot() {
    const r = v => Math.round(v * 10) / 10;
    return this.items.map(it => [it.kind, r(it.x), r(it.z)]);
  }

  /**
   * The host's flotsam: each slot takes its kind (a new body if it differs)
   * and its place — eased there if close, since both drift on the same
   * current, put there if not (the host has recycled it). A piece you have
   * on the hook stays yours until it is in.
   */
  adopt(list) {
    list.forEach((st, i) => {
      const it = this.items[i];
      if (!it || !Array.isArray(st) || it.held) return;
      const [kind, x, z] = st;
      if (kind !== it.kind && DEBRIS_KINDS[kind]) this.rekind(it, kind);
      if (Math.hypot(x - it.x, z - it.z) > 2) { it.x = x; it.z = z; }
      else { it.x += (x - it.x) * 0.5; it.z += (z - it.z) * 0.5; }
    });
  }

  rekind(it, kind) {
    const obj = this.make[kind]();
    obj.userData.debrisIndex = it.obj.userData.debrisIndex;
    this.scene.remove(it.obj);
    this.scene.add(obj);
    if (kind === 'coconut' && this.nut) this.dressNut(obj);
    it.obj = obj;
    it.kind = kind;
    it.buoy = kind === 'coconut' ? 0.02 : kind === 'palm' ? 0.01 : -0.04;
  }

  /**
   * Where the flotsam is centred: you, out at sea (main.js sets `focus`) —
   * or, failing that, the raft.
   */
  get hub() {
    if (this.focus) return this.focus;
    const r = this.raft;
    return { x: r.x ?? r.group.position.x, z: r.z ?? r.group.position.z };
  }

  respawn(it, along = -SPAWN_DIST) {
    const h = this.hub;
    // Somewhere afloat: a spot over land is tried again, a little way along.
    for (let tries = 0; tries < 6; tries++) {
      const lateral = (Math.random() * 2 - 1) * BAND;
      it.x = h.x + CURRENT.x * along + SIDE.x * lateral;
      it.z = h.z + CURRENT.y * along + SIDE.y * lateral;
      if (heightAt(it.x, it.z) < -1) break;
      along -= 15;
    }
    it.held = false;
    it.yaw = Math.random() * 7;
    return it;
  }

  /** How far the raft reaches, so debris can be steered around it. */
  raftRadius() {
    let r = 2.4;
    for (const c of this.raft.cells.values()) {
      r = Math.max(r, Math.hypot(c.cx * 2, c.cz * 2) + 1.5);
    }
    return r;
  }

  update(dt, time, playerPos) {
    const R = this.raftRadius();
    const n = new THREE.Vector3();
    const h = this.hub;
    const rx0 = this.raft.x ?? this.raft.group.position.x, rz0 = this.raft.z ?? this.raft.group.position.z;

    for (const it of this.items) {
      if (it.held) {
        // Reeled in by the hook: pull straight toward the player.
        const dx = playerPos.x - it.x, dz = playerPos.z - it.z;
        const d = Math.hypot(dx, dz) || 1;
        const pull = Math.min(7.5, 2.5 + d * 0.5) * dt;
        it.x += (dx / d) * pull;
        it.z += (dz / d) * pull;
      } else {
        it.x += CURRENT.x * SPEED * dt;
        it.z += CURRENT.y * SPEED * dt;

        // Drift around the raft instead of straight through it.
        const ox = it.x - rx0, oz = it.z - rz0;
        const dist = Math.hypot(ox, oz);
        if (dist < R && this.raft.size !== 0) {
          const push = (R - dist) * dt * 1.6;
          it.x += (ox / (dist || 1)) * push;
          it.z += (oz / (dist || 1)) * push;
        }

        // Gone by downstream — or left behind, you having gone on, or washed
        // up — it comes round again upstream of where you are now.
        const rx = it.x - h.x, rz = it.z - h.z;
        const along = rx * CURRENT.x + rz * CURRENT.y;
        if (along > KILL_DIST || along < -SPAWN_DIST - 30 || Math.abs(rx * SIDE.x + rz * SIDE.y) > BAND + 60 ||
            heightAt(it.x, it.z) > -0.3) this.respawn(it);
      }

      it.yaw += it.spin * dt;
      it.y = waveHeight(it.x, it.z, time) + it.buoy;

      const o = it.obj;
      o.position.set(it.x, it.y, it.z);
      waveNormal(it.x, it.z, time, n);
      // Lie along the surface, then spin about it.
      o.rotation.set(0, 0, 0);
      o.rotation.x = Math.atan2(-n.z, n.y) * 0.9;
      o.rotation.z = Math.atan2(n.x, n.y) * 0.9;
      o.rotateY(it.yaw);
    }
  }

  /**
   * The best debris to gather from where the player is looking.
   * Prefers what is close and near the centre of the screen.
   */
  pick(origin, dir, maxDist = 3.6, minDot = 0.55) {
    let best = null, bestScore = -Infinity;
    for (const it of this.items) {
      const dx = it.x - origin.x, dy = it.y - origin.y, dz = it.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxDist) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < minDot) continue;
      const score = dot * 2 - d / maxDist;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  /** Nearest debris to a point in space — used by the flying hook head. */
  nearestTo(p, maxDist = 1.5) {
    let best = null, bestD = maxDist * maxDist;
    for (const it of this.items) {
      if (it.held) continue;
      const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2 + (it.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  /** Take an item out of the world and hand back what it yields. */
  harvest(it) {
    const kind = DEBRIS_KINDS[it.kind];
    this.respawn(it);
    // Fresh look for the recycled slot.
    return { label: kind.label, yield: kind.yield };
  }
}
