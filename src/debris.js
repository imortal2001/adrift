// ── Floating debris ──────────────────────────────────────────────────────────
// A fixed pool of flotsam drifting down one current. Items are recycled
// upstream when they pass out of range, so the ocean always looks inhabited
// without ever growing the scene graph.

import * as THREE from 'three';
import { waveHeight, waveNormal } from './ocean.js';
import { textures } from './textures.js';
import { DEBRIS_KINDS } from './items.js';

const POOL = 60;
const SPAWN_DIST = 98;      // metres upstream
const KILL_DIST = 112;      // metres downstream before recycling
const BAND = 14;            // lateral spread of the current
const SPEED = 1.35;

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
    const make = shapes();

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
        buoy: kind === 'coconut' ? -0.06 : kind === 'palm' ? 0.01 : -0.04,
        held: false,          // hooked and being reeled in
      };
      this.items.push(it);
      // Seed the first batch spread along the whole corridor so the ocean
      // isn't empty for the first two minutes.
      this.respawn(it, Math.random() * (SPAWN_DIST + KILL_DIST) - SPAWN_DIST);
    }
  }

  respawn(it, along = -SPAWN_DIST) {
    const lateral = (Math.random() * 2 - 1) * BAND;
    it.x = CURRENT.x * along + SIDE.x * lateral;
    it.z = CURRENT.y * along + SIDE.y * lateral;
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
        const dist = Math.hypot(it.x, it.z);
        if (dist < R) {
          const push = (R - dist) * dt * 1.6;
          it.x += (it.x / (dist || 1)) * push;
          it.z += (it.z / (dist || 1)) * push;
        }

        const along = it.x * CURRENT.x + it.z * CURRENT.y;
        if (along > KILL_DIST) this.respawn(it);
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
