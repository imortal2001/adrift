// ── Floating debris ──────────────────────────────────────────────────────────
// A fixed pool of flotsam drifting down one current. Items are recycled
// upstream when they pass out of range, so the ocean always looks inhabited
// without ever growing the scene graph.

import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain.js';
import { waveHeight, waveNormal } from './ocean.js';
import { textures } from './textures.js';
import { DEBRIS_KINDS } from './items.js';

const POOL = 60;
const SPAWN_DIST = 98;      // metres upstream
const KILL_DIST = 112;      // metres downstream before recycling
const BAND = 14;            // lateral spread of the current
const SPEED = 1.35;
// Playing together, the host's flotsam is the sea for everyone within this of
// the host (sharedworld.js; as the fish's) — so it drifts past each of them.
const SHARED_SEA = 160;
const COCONUT_SCALE = 2.4;  // the scanned nut is hand-sized, ~17 cm; afloat it is shown at 40, as the old one was

export const CURRENT = new THREE.Vector2(0.60, 0.80).normalize();
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
    bamboo: std(null, { color: 0xb09a68, roughness: 0.75 }),
    rope:  std(null, { color: 0xb39360, roughness: 0.95 }),
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
    // A torn-off palm frond: a rib curving a little along its length, and the
    // leaflets off both sides of it, long at the base and short at the tip,
    // lying on the water. (It was two flat green rectangles, one stood up out
    // of the sea like a sail — its underside, turned from the light, black.)
    palm() {
      const g = new THREE.Group();
      const L = 1.9, N = 15, parts = [];
      const rib = new THREE.CylinderGeometry(0.018, 0.035, L, 5);
      rib.rotateZ(Math.PI / 2);
      parts.push(rib);
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N, x = -L / 2 + t * L * 0.96;
        const len = 0.62 * (1 - t * 0.7), w = 0.11 * (1 - t * 0.4);
        for (const side of [-1, 1]) {
          const leaf = new THREE.PlaneGeometry(len, w, 3, 1);
          // Narrowing to its tip, and laid flat, angled forward off the rib.
          const p = leaf.attributes.position;
          for (let k = 0; k < p.count; k++) {
            const u = (p.getX(k) + len / 2) / len;
            p.setY(k, p.getY(k) * (1 - u * 0.8));
            p.setZ(k, -0.02 * u * u);                    // the tip dips a touch
          }
          leaf.translate(len / 2, 0, 0);
          leaf.rotateX(-Math.PI / 2);
          leaf.rotateY(side * (0.95 + ((i * 7) % 5) * 0.05));
          leaf.translate(x, 0.004 * i, 0);
          parts.push(leaf);
        }
      }
      // (mergeGeometries wants every part indexed alike: none.)
      const geo = mergeGeometries(parts.map(q => (q.index ? q.toNonIndexed() : q)), false);
      geo.computeVertexNormals();
      const frond = put(geo, M.palm, 0, 0.02, 0);
      // The rib's curve: the whole frond bowed gently.
      frond.rotation.set(0, 0, 0.04);
      g.add(frond);
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
    // A few canes, lashed in a bundle, washed off somewhere.
    bamboo() {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const c = new THREE.CylinderGeometry(0.055, 0.05, 2.2 + Math.random() * 0.6, 7);
        c.rotateZ(Math.PI / 2);
        g.add(put(c, M.bamboo, (Math.random() - 0.5) * 0.4, (i % 2) * 0.09, (i - 1.5) * 0.11, 0, (Math.random() - 0.5) * 0.04, 0));
      }
      // Two lashings, snug round the bundle: wide across it, flat over it.
      const band = new THREE.TorusGeometry(0.23, 0.014, 4, 14);
      band.scale(1, 0.46, 1);
      for (const d of [-0.55, 0.55]) g.add(put(band, M.rope, d, 0.045, 0, 0, Math.PI / 2, 0));
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
    // Playing together (sharedworld.js): where the others are, hosting; and
    // whether the pieces are the host's, and so where they go the host's to say.
    this.others = [];
    this.follow = false;

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
    }
    this.scatter();
  }

  /**
   * Spread every piece along the whole corridor round where the flotsam is
   * centred — at the start, and whenever that centre jumps (you wake
   * somewhere else, or die and come to elsewhere). Recycling them all at the
   * upstream end instead sends them down as one clump, then leaves the sea
   * empty for a minute and a half until the next.
   */
  scatter() {
    for (const it of this.items) {
      if (!it.held) this.respawn(it, Math.random() * (SPAWN_DIST + KILL_DIST) - SPAWN_DIST);
    }
    const h = this.hub;
    this.lastHub = { x: h.x, z: h.z };
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

  /**
   * Who the flotsam comes past: you — and, hosting, whoever of the others is
   * in your sea. Round you alone, one of them a hundred metres off the line of
   * it had none; and their own copy, recycling the pieces round them, had them
   * pop in and out as your word put them back — and one hooked there was
   * never there to be had.
   */
  hubs() {
    const hub = this.hub, out = this._hubs ||= [];
    out.length = 0;
    out.push(hub);
    if (!this.follow) {
      for (const o of this.others) if (Math.hypot(o.x - hub.x, o.z - hub.z) < SHARED_SEA) out.push(o);
    }
    return out;
  }

  /** Is (x, z) in the stretch of current flowing past `h`? */
  inReach(x, z, h) {
    const rx = x - h.x, rz = z - h.z;
    const along = rx * CURRENT.x + rz * CURRENT.y;
    return along <= KILL_DIST && along >= -SPAWN_DIST - 30 && Math.abs(rx * SIDE.x + rz * SIDE.y) <= BAND + 60;
  }

  /** Where a piece put back comes down: past whichever of you has the fewest first, then the next. */
  byCrowd() {
    const hubs = this.hubs();
    if (hubs.length === 1) return hubs;
    return hubs.map(h => {
      let n = Math.random() * 0.5;              // (ties broken either way)
      for (const it of this.items) if (this.inReach(it.x, it.z, h)) n++;
      return [n, h];
    }).sort((a, b) => a[0] - b[0]).map(e => e[1]);
  }

  respawn(it, along = -SPAWN_DIST - Math.random() * 12) {
    // Somewhere afloat: a spot over land is tried again a little further up
    // the current; land all the way up (an island up-current), and it comes
    // out in the lee of it instead — left on the land, it was put back there
    // again every frame, and none came by at all. Then past the next of you.
    const hubs = this.byCrowd();
    const afloat = (h, a) => {
      const lateral = (Math.random() * 2 - 1) * BAND;
      it.x = h.x + CURRENT.x * a + SIDE.x * lateral;
      it.z = h.z + CURRENT.y * a + SIDE.y * lateral;
      return heightAt(it.x, it.z) < -1;
    };
    found: for (const h of hubs) {
      for (let tries = 0; tries < 6; tries++) if (afloat(h, along - tries * 15)) break found;
      for (let tries = 1; tries <= 4; tries++) if (afloat(h, along + tries * 20)) break found;
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
    // The centre moved further than drifting could take it: start afresh round
    // it. (Ten metres in a frame is no swim or sail: a new start, a waking. At
    // forty, the 36 m from where the game loads to a new castaway's wreckage
    // left the flotsam drifting past 25 m to one side, out of reach for the
    // first two minutes of every game.)
    if (!this.lastHub || Math.hypot(h.x - this.lastHub.x, h.z - this.lastHub.z) > 10) this.scatter();
    this.lastHub.x = h.x; this.lastHub.z = h.z;
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
        // up — it comes round again upstream of where you are now. (The
        // host's pieces: the host puts them back.)
        if (!this.follow && (heightAt(it.x, it.z) > -0.3 || !this.hubs().some(o => this.inReach(it.x, it.z, o)))) this.respawn(it);
      }

      // A shadow only over the shallows. Through fifteen metres of water the
      // shade of a plank is scattered to nothing; drawn crisp, the flotsam's
      // shadows lay on the sea bed under you like black cut-outs.
      const shade = heightAt(it.x, it.z) > -3;
      if (shade !== it.shade) { it.shade = shade; it.obj.traverse(o => { if (o.isMesh) o.castShadow = shade; }); }

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
