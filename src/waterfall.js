// ── Lakes and waterfalls, drawn ──────────────────────────────────────────────
// Where the land has them is terrain.js's to say (LAKES, FALLS); this draws
// the water.
//
//   A lake's surface is a disc cut to its shore, a little wider so its edge
//   tucks under the banks — except where a tarn spills over the lip of a
//   fall, where it stops short and the fall's own water takes over.
//
//   A fall is heavy, white, broken water. Three curtains of it pour over the
//   lip and arc out from the cliff, each shuddering on its own, their streaks
//   stretching as they drop: the texture runs on time-of-fall, not distance,
//   so the water accelerates the way falling water does. Clumps of white
//   water tear loose and tumble down in front of them. Where it lands the
//   pool churns — two layers of foam turning against each other, a trail of
//   it carried off downstream — droplets are flung up out of the impact and
//   fall back, and spray boils up off it all and drifts away.

import * as THREE from 'three';
import { lakeShore } from './terrain.js';

const TUCK = 2.2;          // m a lake's surface runs past its shore, under the bank

/** A lake's surface: a fan from its middle out to just past its shore. */
export function lakeGeometry(L, segments = 96) {
  const pos = [L.x, L.level, L.z], uv = [L.x / 7, L.z / 7], idx = [];
  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    let r = lakeShore(L, th) + TUCK;
    // A tarn's outlet, at the top of a fall: no further than its shore.
    if (L.outlet) r -= TUCK * THREE.MathUtils.smoothstep(Math.cos(th), 0.72, 0.95);
    const c = Math.cos(th), s = Math.sin(th);
    const x = L.x + (c * L.cos - s * L.sin) * r, z = L.z + (c * L.sin + s * L.cos) * r;
    pos.push(x, L.level, z);
    uv.push(x / 7, z / 7);
    if (i) idx.push(0, i + 1, i);                  // wound to face up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── textures, made once ──────────────────────────────────────────────────────
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const canvas = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // Falling water: dense streaks and clumps of white — on a pale wash for
  // the back curtain (`wash`), on nothing for the ones in front of it, so
  // the back shows through them. Drawn across the wrap, so it tiles.
  const water = wash => canvas(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    if (wash) { g.fillStyle = 'rgba(214,232,240,0.6)'; g.fillRect(0, 0, w, h); }
    const dash = (x, y, sw, len, a) => {
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.35, `rgba(250,253,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      for (const o of [0, -h, h]) g.fillRect(x, y + o, sw, len);
    };
    for (let i = 0; i < 520; i++) {
      dash(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 30 + Math.random() * 170, 0.35 + Math.random() * 0.6);
    }
    // Clumps: fat, soft, white knots of water.
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 11;
      for (const o of [0, -h, h]) {
        const grad = g.createRadialGradient(x, y + o, 0, x, y + o, r * 2.2);
        grad.addColorStop(0, 'rgba(255,255,255,0.85)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x - r * 2.2, y + o - r * 2.2, r * 4.4, r * 4.4 * 1.8);
      }
    }
  });
  const sheet = water(true), streaks = water(false);
  sheet.wrapS = sheet.wrapT = streaks.wrapS = streaks.wrapT = THREE.RepeatWrapping;
  // Foam: white blobs, dense in the middle, thinning to nothing at the rim.
  const foam = canvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.8) * w * 0.48;
      const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, r = 1.5 + Math.random() * 8;
      g.fillStyle = `rgba(255,255,255,${(0.65 * (1 - d / (w * 0.5))).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
  // A foam trail: streaks of it along the flow, fading at the sides.
  const trail = canvas(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const x = w / 2 + (Math.random() - 0.5) * w * Math.random(), y = Math.random() * h;
      const edge = 1 - Math.abs(x - w / 2) / (w / 2);
      g.fillStyle = `rgba(255,255,255,${(0.55 * edge).toFixed(3)})`;
      for (const o of [0, -h, h]) { g.beginPath(); g.ellipse(x, y + o, 1 + Math.random() * 3, 3 + Math.random() * 9, 0, 0, Math.PI * 2); g.fill(); }
    }
  });
  trail.wrapS = trail.wrapT = THREE.RepeatWrapping;
  // Spray and white water: a soft round puff.
  const puff = canvas(64, 64, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  TEX = { sheet, streaks, foam, trail, puff };
  return TEX;
}

const G = 9.8;
const SPRAY = 70;          // puffs of spray per fall
const CLUMPS = 60;         // clumps of white water tumbling down the face
const DROPS = 60;          // droplets flung up out of the pool

/** A cloud of sprites whose brightness is its colour (drawn additively, so that fades it). */
function sprites(n, map, size, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    map, size, sizeAttenuation: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, vertexColors: true, opacity,
  }));
  p.frustumCulled = false;
  return p;
}

export class Waterfall {
  /** @param f  a fall, from terrain.js's FALLS */
  constructor(f) {
    this.f = f;
    const t = textures();
    this.group = new THREE.Group();
    this.group.name = 'waterfall';
    this.d = new THREE.Vector2(f.dx, f.dz);
    this.side = new THREE.Vector2(-f.dz, f.dx);
    // How far out from the lip the water has got, t of the way down: it
    // leaves the lip moving, and falls away from the rock.
    const H = f.height;
    this.out = tt => 0.15 + (1.6 + 0.045 * H) * Math.pow(tt, 0.55);
    // How long water takes to fall to depth y: what the streaks run on.
    this.fallTime = y => Math.sqrt(2 * Math.max(0, y) / G);

    // Three curtains: back, middle and front, each denser and quicker.
    this.sheets = [];
    const layers = [
      // The back one grey-blue, water with the rock behind it; the front one
      // white and broken, so the layers read as depth, not a white board.
      { ahead: -0.08, opacity: 0.9,  speed: 0.55, widen: 1.12, shake: 0.06, tint: 0xc4d8e1, tex: 'sheet' },
      { ahead: 0.12,  opacity: 0.95, speed: 0.78, widen: 1.06, shake: 0.1,  tint: 0xf2f8fb, tex: 'streaks' },
      { ahead: 0.32,  opacity: 1.0,  speed: 1.05, widen: 1.0,  shake: 0.16, tint: 0xffffff, tex: 'streaks' },
    ];
    layers.forEach((L, k) => {
      const map = t[L.tex].clone();
      map.needsUpdate = true;
      map.repeat.set(Math.max(1, f.width / 2.4), 1);
      map.offset.x = k * 0.37;
      const mat = new THREE.MeshStandardMaterial({
        // White water holds its light even in the shade of the gorge.
        map, color: L.tint, emissive: 0x56666e, transparent: true, opacity: L.opacity,
        roughness: 0.4, metalness: 0, side: THREE.DoubleSide, depthWrite: false, vertexColors: true,
      });
      const geo = this.curtain(L.ahead, L.widen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.sheets.push({ mat, speed: L.speed, shake: L.shake, geo, base: geo.attributes.position.array.slice(), phase: k * 2.1 });
    });

    // The pool where it lands: churning foam, two layers turning against each other.
    const land = this.at(this.out(1) + 0.4, 0);
    this.land = land;
    this.foams = [1, -0.6].map((spin, k) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(f.width * (0.55 + k * 0.25) + 1.8 + k, 40),
        new THREE.MeshStandardMaterial({ map: t.foam, color: 0xffffff, emissive: 0x2a3438, transparent: true,
                                         opacity: k ? 0.6 : 0.95, roughness: 0.6, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(land.x, f.bottom + 0.04 + k * 0.02, land.y);
      m.renderOrder = 3;
      this.group.add(m);
      return { m, spin };
    });
    // …and a trail of it carried off downstream.
    const trailLen = 16 + f.width, tw = f.width * 0.9 + 2;
    const trailGeo = new THREE.PlaneGeometry(tw, trailLen, 1, 1);
    trailGeo.rotateX(-Math.PI / 2);
    const trailMap = t.trail.clone();
    trailMap.needsUpdate = true;
    trailMap.repeat.set(1, trailLen / 8);
    this.trail = new THREE.Mesh(trailGeo, new THREE.MeshStandardMaterial({
      map: trailMap, color: 0xffffff, transparent: true, opacity: 0.7, roughness: 0.6, depthWrite: false,
      alphaMap: null,
    }));
    // Along the river, which may leave the cliff at an angle.
    const flow = f.flow || { x: f.dx, z: f.dz };
    this.trail.position.set(land.x + flow.x * (trailLen / 2 + 1), f.bottom + 0.05, land.y + flow.z * (trailLen / 2 + 1));
    this.trail.rotation.y = Math.atan2(flow.x, flow.z);
    this.trail.renderOrder = 3;
    this.group.add(this.trail);

    // What flies about: spray boiling up, clumps tumbling down the face, droplets flung up.
    this.spray = sprites(SPRAY, t.puff, 3.4 + f.width * 0.18, 0.32);
    this.clumps = sprites(CLUMPS, t.puff, 2.4 + f.width * 0.08, 0.6);
    this.drops = sprites(DROPS, t.puff, 0.35, 1);
    for (const p of [this.spray, this.clumps, this.drops]) this.group.add(p);
    this.puffs = Array.from({ length: SPRAY }, () => this.puff({}, Math.random()));
    this.falling = Array.from({ length: CLUMPS }, () => this.clump({}, Math.random()));
    this.flung = Array.from({ length: DROPS }, () => this.drop({}, Math.random()));
  }

  /** A point `o` metres out from the lip and `s` across it, in the world (x, z). */
  at(o, s) {
    const f = this.f;
    return new THREE.Vector2(f.x + this.d.x * o + this.side.x * s, f.z + this.d.y * o + this.side.y * s);
  }

  /**
   * One curtain: a short run in over the lip, then down the drop to the pool,
   * `ahead` metres out from the rock, `widen` times as wide at the foot.
   * Faded at its ragged sides and its foot, in the vertex alpha.
   */
  curtain(ahead, widen) {
    const f = this.f, cols = 14, rows = 22;
    const pos = [], uv = [], col = [], idx = [];
    const path = [{ o: -1.3, y: f.top + 0.03, tt: 0 }, { o: 0, y: f.top + 0.03, tt: 0 }];
    for (let r = 1; r <= rows; r++) {
      const tt = Math.pow(r / rows, 1.4);            // closer rows near the top, where it curls over
      path.push({ o: this.out(tt) + ahead * tt, y: f.top + 0.03 - f.height * tt, tt });
    }
    // The streaks run on time of fall: v in seconds, times the texture's
    // pace — so they are short at the lip and stretch as the water speeds up.
    const edgeSeed = Math.random() * 10;
    path.forEach((p, k) => {
      const tt = p.tt, half = f.width / 2 * (1 + (widen - 1) * tt);
      const v = k === 0 ? -0.35 : -this.fallTime(tt * f.height) * 1.6;
      for (let c = 0; c <= cols; c++) {
        const u = c / cols, s = (u - 0.5) * 2 * half;
        const w = this.at(p.o, s);
        pos.push(w.x, p.y, w.y);
        uv.push(u * f.width / 2.4, v);
        // Ragged, broken sides, and thinning at the foot into the spray.
        const edge = Math.min(u, 1 - u) * 2;
        const rag = 0.2 + 0.18 * Math.sin(k * 1.7 + edgeSeed) * Math.sin(k * 0.6 + u * 9);
        const a = THREE.MathUtils.smoothstep(edge, 0, rag + 0.15) * (1 - THREE.MathUtils.smoothstep(tt, 0.88, 1) * 0.75);
        col.push(1, 1, 1, a);
      }
      if (k) {
        const a0 = (k - 1) * (cols + 1), a1 = k * (cols + 1);
        for (let c = 0; c < cols; c++) idx.push(a0 + c, a1 + c, a0 + c + 1, a0 + c + 1, a1 + c, a1 + c + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.cols = cols;
    return g;
  }

  /** A puff of spray, `age` of the way through its life already. */
  puff(p, age = 0) {
    const f = this.f;
    p.s = (Math.random() - 0.5) * f.width * 1.2;
    p.o = this.out(1) + (Math.random() - 0.3) * 2;
    p.y = f.bottom + 0.1 + Math.random() * 0.8;
    p.vy = 0.9 + Math.random() * 1.6;
    p.vo = 0.4 + Math.random() * 1.1;
    p.vs = (Math.random() - 0.5) * 0.9;
    p.life = 2.2 + Math.random() * 2.2;
    p.age = age * p.life;
    return p;
  }

  /** A clump of white water, torn loose at the lip, `age` of the way down already. */
  clump(p, age = 0) {
    const f = this.f;
    p.s = (Math.random() - 0.5) * f.width * 0.95;
    p.ahead = 0.25 + Math.random() * 0.5;
    p.t = age * this.fallTime(f.height);           // seconds since it went over
    p.wob = Math.random() * 6;
    return p;
  }

  /** A droplet flung up out of the impact. */
  drop(p, age = 0) {
    const f = this.f;
    p.s = (Math.random() - 0.5) * f.width;
    p.o = this.out(1) + (Math.random() - 0.5) * 1.2;
    p.y = f.bottom + 0.1;
    p.vy = 2 + Math.random() * 3.5;
    p.vo = (Math.random() - 0.2) * 2.5;
    p.vs = (Math.random() - 0.5) * 2;
    p.age = age;
    for (let t = 0; t < age * 1.2; t += 0.05) { p.vy -= G * 0.05; p.y += p.vy * 0.05; }   // part-way through
    return p;
  }

  update(dt, time, focus, night = 0) {
    const f = this.f;
    // White water keeps its light in the shade by day — not in the dark: the
    // glow that holds it up goes, and the spray and clumps dim with it.
    if (this.night !== night) {
      this.night = night;
      const day = 1 - 0.92 * night;
      for (const s of this.sheets) s.mat.emissiveIntensity = day;
      for (const { m } of this.foams) m.material.emissiveIntensity = day;
      this.spray.material.opacity = 0.32 * (1 - 0.8 * night);
      this.clumps.material.opacity = 0.6 * (1 - 0.8 * night);
      this.drops.material.opacity = 1 - 0.8 * night;
    }
    // The curtains: their streaks pouring, and each shuddering on its own.
    for (const s of this.sheets) {
      s.mat.map.offset.y = time * s.speed;
      const pos = s.geo.attributes.position, b = s.base, cols = s.geo.userData.cols + 1;
      for (let i = 0, n = pos.count; i < n; i++) {
        const row = (i / cols) | 0, u = (i % cols) / (cols - 1);
        const tt = Math.max(0, (row - 1) / (pos.count / cols - 2));
        const w = s.shake * tt * (Math.sin(time * 6.3 + row * 0.9 + u * 7 + s.phase) + 0.6 * Math.sin(time * 11.7 - row * 1.3 + u * 13));
        pos.setXYZ(i, b[i * 3] + this.d.x * w, b[i * 3 + 1], b[i * 3 + 2] + this.d.y * w);
      }
      pos.needsUpdate = true;
    }
    this.foams.forEach(({ m, spin }, k) => {
      m.rotation.z = time * 0.35 * spin;
      m.scale.setScalar(1 + 0.05 * Math.sin(time * (2.3 + k) + k));
    });
    // The trail's v runs upstream (the plane's far edge is its upstream end),
    // so the texture scrolls up in v to carry the foam downstream.
    this.trail.material.map.offset.y = time * 0.45;

    // The rest only matters where someone can see it.
    const near = !focus || Math.hypot(focus.x - f.x, focus.z - f.z) < 300;
    for (const p of [this.spray, this.clumps, this.drops]) p.visible = near;
    if (!near) return;

    const put = (points, i, o, s, y, a) => {
      const w = this.at(o, s);
      points.geometry.attributes.position.setXYZ(i, w.x, y, w.y);
      points.geometry.attributes.color.setXYZ(i, a, a, a);
    };
    this.puffs.forEach((p, i) => {
      p.age += dt;
      if (p.age >= p.life) this.puff(p);
      p.y += p.vy * dt; p.vy *= 1 - dt * 0.45;
      p.o += p.vo * dt; p.s += p.vs * dt;
      put(this.spray, i, p.o, p.s, p.y, Math.sin(Math.PI * p.age / p.life) * 0.4);
    });
    const tFall = this.fallTime(f.height);
    this.falling.forEach((p, i) => {
      p.t += dt;
      const y = 0.5 * G * p.t * p.t;
      if (y >= f.height) { this.clump(p); return; }
      const tt = y / f.height;
      const jig = Math.sin(time * 9 + p.wob) * 0.12;
      put(this.clumps, i, this.out(tt) + p.ahead * tt + jig, p.s + jig * 0.6, f.top - y,
          0.4 * Math.min(1, p.t / (tFall * 0.15)));
    });
    this.flung.forEach((p, i) => {
      p.vy -= G * dt;
      p.y += p.vy * dt; p.o += p.vo * dt; p.s += p.vs * dt;
      if (p.y < f.bottom) this.drop(p);
      put(this.drops, i, p.o, p.s, p.y, 0.8);
    });
    for (const p of [this.spray, this.clumps, this.drops]) {
      p.geometry.attributes.position.needsUpdate = p.geometry.attributes.color.needsUpdate = true;
    }
  }
}
