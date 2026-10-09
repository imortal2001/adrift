// ── The reef ─────────────────────────────────────────────────────────────────
// What grows on the sea bed. Built the same way as the forest on land: a few
// primitives welded into one geometry per species, scattered deterministically
// by the terrain chunks and drawn instanced.
//
// This file only knows how to *make* reef; where each species is allowed to
// grow is a table here, but the scattering itself lives in terrain.js, which is
// the thing that already knows the shape of the ground.
//
// Everything is modelled with its base at the origin and growing up +Y, so a
// prop can be dropped straight onto a sea-bed sample.

import * as THREE from 'three';
import { mergeParts } from './meshkit.js';
import { mergeVertices } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { applyCaustics } from './underwater.js';

const col = h => new THREE.Color(h);

// Reef colour is the first casualty of depth — red is gone by about 5m and the
// fog multiplies everything down on top of that. These are deliberately louder
// than they would be on a swatch, so that what reaches the eye at 15m is still
// coral and not grey.
const PALETTE = {
  brainA:  col(0xd9a271), brainB:  col(0xb87450),
  stagA:   col(0xe4b7c6), stagB:   col(0xc27d9a),
  fanA:    col(0xd05a52), fanB:    col(0x9a5ea8),
  spongeA: col(0xc87a4e), mouth:   col(0x2a1a16),
  anemA:   col(0x74cba4), anemB:   col(0xd4785f),
  grassA:  col(0x4f9a4c), grassB:  col(0x79b85c),
  rock:    col(0x6d6f66), turf: col(0x5e5c3a),
  kelpA:   col(0x8a7a2e), kelpB:   col(0xb09a3c), bladder: col(0x6f5f24),
  urchin:  col(0x3a1f3f), urchinB: col(0x5c2d63),
  starA:   col(0xe0663a), starB:   col(0xf2a25c),
  shell:   col(0xcfc3a8), shellB:  col(0x9d9178), mantleA: col(0x2f9fb0), mantleB: col(0x5fd0a0),
  // Most living coral is brown, tan and olive — the algae in its tissue — with
  // the colour in its growing edges and tips: blue, violet, pink, pale.
  stagBase: col(0xa8865e), stagTip: col(0xf0dcc4),
  tableA:  col(0xb79e72), tableTip: col(0x9cc2d4), tableUnder: col(0x5e4c38),
  plateA:  col(0x6c5838), plateRim: col(0xb49c68),
  poritesA: col(0xc0ab62), poritesB: col(0x8f8050), poritesDead: col(0x6c6a58),
  fingerA: col(0xb89650), fingerTip: col(0xe8d8a4),
  leatherA: col(0xa89a58), leatherStalk: col(0xd6cca4),
  tubeP:   col(0x7d4a9c), tubePIn: col(0x2b1830), tubeY: col(0xd0a636), tubeYIn: col(0x3a2c10),
  algaeA:  col(0x6a6626), algaeB: col(0x86903a),
  rubble:  col(0xcdc2a6), rubbleB: col(0x9c8f86), coralline: col(0xb08aa0),
  stone:   col(0x7a766c), slab: col(0x8c8474),
};

// A small seeded generator, for the pieces built from many random parts.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ── surfaces ─────────────────────────────────────────────────────────────────
// The solid pieces — rock, brain coral, a sponge's barrel — are smooth-shaded
// lumps with their surfaces worked: welded, displaced along the normal by a
// little noise, and lit across their curve. Flat-shaded raw polyhedra (a rock
// was two twelve-faced dodecahedra) showed every face as a facet, a low-poly
// prop dropped on the smooth, textured sea bed and among textured fish.

const hash3 = (x, y, z) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
const fade = t => t * t * (3 - 2 * t);
/** Value noise, 0..1, smooth in all three directions. */
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
           l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
const fbm3 = (x, y, z) => noise3(x, y, z) * 0.62 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.27 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.11;

/**
 * A primitive made one welded, smooth surface: its seams joined, every vertex
 * pushed out along its normal by `push(p, n)` (metres), and coloured by
 * `paint(p, n, out)`. Returns an indexed geometry with position, normal and
 * colour, ready for mergeColoured().
 */
function worked(geo, push, paint) {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const g = mergeVertices(geo);
  g.computeVertexNormals();
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    p.addScaledVector(n, push(p, n));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  const colour = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(g.attributes.normal, i);
    paint(p, n, c);
    colour[i * 3] = c.r; colour[i * 3 + 1] = c.g; colour[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  return g;
}

/** mergeParts for worked pieces (their own colour per vertex) and plain ones ({geo, color}) together. */
function mergeColoured(parts) {
  const merged = mergeParts(parts.map(q => (q.isBufferGeometry ? { geo: q, color: WHITE } : q)));
  const col = merged.attributes.color;
  let at = 0;
  for (const q of parts) {
    const g = q.isBufferGeometry ? q : q.geo, n = g.attributes.position.count;
    if (q.isBufferGeometry) for (let i = 0; i < n; i++) col.setXYZ(at + i, g.attributes.color.getX(i), g.attributes.color.getY(i), g.attributes.color.getZ(i));
    at += n;
  }
  return merged;
}
const WHITE = new THREE.Color(1, 1, 1);

// ── species ──────────────────────────────────────────────────────────────────

/** A dome of fused lobes. The workhorse of the reef floor. */
function brainCoral(lod = 0) {
  const parts = [];
  const lobes = [
    { r: 1.00, x: 0, z: 0, y: 0.00, c: PALETTE.brainA },
    { r: 0.62, x: 0.78, z: 0.22, y: -0.12, c: PALETTE.brainB },
    { r: 0.54, x: -0.46, z: 0.68, y: -0.16, c: PALETTE.brainA },
    { r: 0.40, x: 0.12, z: -0.78, y: -0.22, c: PALETTE.brainB },
  ];
  // The meandering ridges of a brain coral: bands along the contours of a
  // noise field, raised a little off the dome, the valleys between darker.
  const ridge = (p, k) => {
    const t = fbm3(p.x * 2.6 + k, p.y * 2.6, p.z * 2.6) * 9;
    return 1 - Math.abs(2 * (t - Math.floor(t)) - 1);
  };
  lobes.forEach((l, k) => {
    // (Fine enough to carry the ridges: 2000 triangles the main dome, 720 each lobe.)
    // (Out past the chunk you are in, a lighter one: there the ridges are a texture in the haze.)
    const g = new THREE.IcosahedronGeometry(l.r, lod ? (k === 0 ? 4 : 2) : (k === 0 ? 9 : 5));
    g.scale(1, 0.66, 1);                 // domed, not spherical
    g.translate(l.x, l.r * 0.58 + l.y, l.z);
    const dark = l.c.clone().multiplyScalar(0.5);
    parts.push(worked(g,
      p => (Math.pow(ridge(p, k), 0.6) - 0.5) * 0.085 * l.r + (fbm3(p.x * 3, p.y * 3, p.z * 3) - 0.5) * 0.06 * l.r,
      (p, n, c) => c.copy(dark).lerp(l.c, THREE.MathUtils.smoothstep(ridge(p, k), 0.15, 0.7))));
  });
  return mergeColoured(parts);
}

/**
 * Staghorn: a thicket, not a twig. Several stems from one base, each forking
 * twice, brown at the base and paling to the growing tips.
 */
function staghorn(lod = 0) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const r = rng(11);
  const shade = depth => PALETTE.stagBase.clone().lerp(PALETTE.stagTip, (2 - depth) / 2 * 0.75);

  // Lay one branch from `from` along `dir` and recurse off its tip.
  const branch = (from, pitch, yaw, len, rad, depth) => {
    dir.set(Math.sin(pitch) * Math.cos(yaw), Math.cos(pitch), Math.sin(pitch) * Math.sin(yaw));
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, lod ? 5 : 7);
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(from.x, from.y, from.z);
    parts.push({ geo: g, color: shade(depth) });
    const tip = from.clone().addScaledVector(dir, len * 0.94);
    // A rounded tip, pale: cut flat, every end showed as a faceted stub.
    if (depth === 0) {
      if (!lod) {
        const knob = new THREE.SphereGeometry(rad * 0.72, 6, 4);
        const end = from.clone().addScaledVector(dir, len);
        knob.translate(end.x, end.y, end.z);
        parts.push({ geo: knob, color: PALETTE.stagTip });
      }
      return;
    }
    const forks = 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < forks; i++) {
      branch(tip, Math.min(1.25, pitch + 0.22 + r() * 0.35), yaw + (i / forks) * Math.PI * 2 + r() * 1.2,
             len * (0.62 + r() * 0.2), rad * 0.7, depth - 1);
    }
  };

  const STEMS = lod ? 4 : 6;
  for (let k = 0; k < STEMS; k++) {
    const a = k * 2.4 + r(), d = 0.08 + r() * 0.28;
    branch(new THREE.Vector3(Math.cos(a) * d, -0.05, Math.sin(a) * d), 0.12 + d * 0.9, a + (r() - 0.5),
           0.42 + r() * 0.2, 0.085, 2);
  }
  return mergeParts(parts);
}

/**
 * A sea fan (a gorgonian): a short trunk, then branching and branching again
 * in one plane, so face on it is a lace of a hundred twigs and edge on almost
 * nothing — and the plane bowed a little, as the current bends it.
 */
function seaFan(lod = 0) {
  const parts = [];
  const r = rng(7);
  const stem = new THREE.CylinderGeometry(0.035, 0.06, 0.24, 5);
  stem.translate(0, 0.12, 0);
  parts.push({ geo: stem, color: PALETTE.fanB });
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  const DEPTH = lod ? 3 : 5;
  const twig = (x, y, ang, len, rad, depth) => {
    dir.set(Math.sin(ang), Math.cos(ang), 0);
    const g = new THREE.CylinderGeometry(rad * 0.75, rad, len, lod ? 3 : 4);
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(x, y, 0);
    parts.push({ geo: g, color: depth > 2 ? PALETTE.fanB : PALETTE.fanA });
    if (depth === 0) return;
    const ex = x + dir.x * len, ey = y + dir.y * len;
    const spread = 0.28 + r() * 0.22;
    for (const side of [-1, 1]) {
      twig(ex, ey, ang + side * spread + (r() - 0.5) * 0.15, len * (0.74 + r() * 0.12), rad * 0.74, depth - 1);
    }
  };
  for (const a of [-0.55, -0.1, 0.4]) twig(0, 0.22, a, 0.26, 0.032, DEPTH);
  // Bowed: the plane curves back a little toward its edges.
  const merged = mergeParts(parts);
  const p = merged.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.16 * p.getX(i) * p.getX(i));
  merged.computeVertexNormals();
  return merged;
}

/** Barrel sponge — a fat tube with a dark mouth sunk into the top. */
function barrelSponge(lod = 0) {
  // Ribbed up its sides, as a barrel sponge is, the ridges paler.
  const body = new THREE.CylinderGeometry(0.46, 0.30, 0.95, lod ? 16 : 24, lod ? 3 : 6, true);
  body.translate(0, 0.475, 0);
  const rib = p => Math.max(0, Math.cos(Math.atan2(p.z, p.x) * 9 + p.y * 1.5));
  const pale = PALETTE.spongeA.clone().lerp(new THREE.Color(1, 0.9, 0.78), 0.25);
  const wall = worked(body, p => rib(p) * 0.035 + (fbm3(p.x * 4, p.y * 4, p.z * 4) - 0.5) * 0.03,
                      (p, n, c) => c.copy(PALETTE.spongeA).lerp(pale, rib(p)));
  const rim = new THREE.CylinderGeometry(0.46, 0.42, 0.10, 24);
  rim.translate(0, 0.95, 0);
  // Recessed disc: cheaper than an open-ended tube with an inner wall, and at
  // reef distances it reads the same.
  const mouth = new THREE.CircleGeometry(0.34, 24);
  mouth.rotateX(-Math.PI / 2);
  mouth.translate(0, 0.90, 0);
  return mergeColoured([
    wall,
    { geo: rim, color: PALETTE.spongeA },
    { geo: mouth, color: PALETTE.mouth },
  ]);
}

/** Anemone: a squat column under a crown of tentacles that catch the surge. */
function anemone() {
  const parts = [];
  const foot = new THREE.CylinderGeometry(0.17, 0.22, 0.20, 16);
  foot.translate(0, 0.10, 0);
  parts.push({ geo: foot, color: PALETTE.anemB });

  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const lean = 0.55 + (i % 3) * 0.18;
    const len = 0.30 + (i % 4) * 0.055;
    const g = new THREE.ConeGeometry(0.026, len, 4);
    g.translate(0, len / 2, 0);
    g.rotateZ(lean);
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.08, 0.19, Math.sin(a) * 0.08);
    parts.push({ geo: g, color: PALETTE.anemA });
  }
  return mergeParts(parts);
}

/** A tuft of seagrass. Flat blades, because they have to bend in the surge. */
function seagrass() {
  const parts = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (i % 2) * 0.4;
    const h = 0.55 + ((i * 7) % 5) * 0.15;
    const g = new THREE.PlaneGeometry(0.075, h, 1, 3);
    g.translate(0, h / 2, 0);
    g.rotateZ((((i * 13) % 7) / 7 - 0.5) * 0.5);      // each blade leans its own way
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09);
    parts.push({ geo: g, color: i % 3 ? PALETTE.grassA : PALETTE.grassB });
  }
  return mergeParts(parts);
}

// Weathered stone: lumpy, not cut — broad lumps and a finer pitting over
// them — and over whatever faces up to the light, the skin everything on a
// reef wears: olive turf algae, and pink-lilac coralline crust in patches.
// (It was moss-green, and on the reef a field of green boulders.)
function stone(geo, k, base = PALETTE.rock, lumps = 0.34, crust = 0.85) {
  const skin = new THREE.Color();
  return worked(geo,
    p => (fbm3(p.x * 2.2 + k, p.y * 2.2, p.z * 2.2) - 0.5) * lumps + (noise3(p.x * 9, p.y * 9 + k, p.z * 9) - 0.5) * 0.05,
    (p, n, c) => {
      skin.copy(PALETTE.turf).lerp(PALETTE.coralline, THREE.MathUtils.smoothstep(fbm3(p.x * 1.8 - k, p.y * 1.8, p.z * 1.8 + k), 0.52, 0.64) * 0.8);
      c.copy(base).multiplyScalar(0.85 + fbm3(p.x * 6 + k, p.y * 6, p.z * 6) * 0.3)
        .lerp(skin, THREE.MathUtils.smoothstep(n.y, 0.2, 0.8) * crust);
    });
}

/** Bare rock, for the stretches of sand where nothing has taken hold. */
function boulder(lod = 0) {
  const a = new THREE.IcosahedronGeometry(0.62, lod ? 3 : 5);
  a.scale(1.15, 0.72, 0.95);
  a.translate(0, 0.40, 0);
  const b = new THREE.IcosahedronGeometry(0.34, lod ? 1 : 2);
  b.scale(1.0, 0.8, 1.2);
  b.translate(0.42, 0.22, -0.28);
  return mergeColoured([stone(a, 0), stone(b, 5.3)]);
}

/**
 * An outcrop: a pile of boulders of different sizes leaning on one another,
 * one up on the others — the big rock of a reef, and somewhere for the small
 * corals to grow on.
 */
function outcrop(lod = 0) {
  const r = rng(29), parts = [];
  const pieces = [[0, 0.5, 0, 0.95, 1.25, 0.85, 1.0], [0.95, 0.32, 0.35, 0.6, 1.1, 0.75, 0.9],
                  [-0.8, 0.3, 0.55, 0.55, 1.2, 0.7, 1.0], [0.25, 0.28, -0.95, 0.5, 1.0, 0.8, 1.3],
                  [-0.15, 1.12, 0.1, 0.48, 1.1, 0.75, 0.95], [-0.95, 0.18, -0.6, 0.32, 1, 0.8, 1]];
  pieces.forEach(([x, y, z, rad, sx, sy, sz], k) => {
    const g = new THREE.IcosahedronGeometry(rad, lod ? (k < 3 ? 2 : 1) : (k < 3 ? 5 : 3));
    g.scale(sx, sy, sz);
    g.rotateY(r() * 6.28);
    g.translate(x, y, z);
    parts.push(stone(g, k * 3.7, k % 2 ? PALETTE.stone : PALETTE.rock, 0.3));
  });
  return mergeColoured(parts);
}

/**
 * Slabs: old reef limestone broken into flat plates, one fallen across
 * another. Few faces, few lumps — the fracture planes are what reads.
 */
function slab(lod = 0) {
  const parts = [];
  const flat = (rad, sx, sy, sz, x, y, z, rx, rz, k) => {
    const g = new THREE.IcosahedronGeometry(rad, lod ? 1 : 2);
    g.scale(sx, sy, sz);
    g.rotateX(rx); g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(stone(g, k, PALETTE.slab, 0.12));
  };
  flat(0.85, 1.3, 0.26, 1.0, 0, 0.12, 0, 0, 0.04, 1.3);
  flat(0.6, 1.2, 0.3, 0.9, 0.35, 0.36, 0.2, 0.12, -0.18, 4.1);
  flat(0.4, 1.1, 0.35, 1.0, -0.8, 0.1, -0.45, -0.1, 0.25, 8.7);
  return mergeColoured(parts);
}

/** Cobbles, half sunk in the sand. */
function stones(lod = 0) {
  const r = rng(41), parts = [];
  for (let k = 0; k < 8; k++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.75, rad = 0.07 + Math.pow(r(), 2) * 0.22;
    const g = new THREE.IcosahedronGeometry(rad, lod ? 0 : 1);
    g.scale(1 + r() * 0.4, 0.55 + r() * 0.3, 1 + r() * 0.3);
    g.rotateY(r() * 6.28);
    g.translate(Math.cos(a) * d, rad * 0.25, Math.sin(a) * d);
    // (Rolled about by the surge: only a thin skin on them.)
    parts.push(stone(g, k * 2.3, r() < 0.5 ? PALETTE.stone : PALETTE.rock, 0.1, 0.35));
  }
  return mergeColoured(parts);
}

/**
 * Rubble: broken branch coral and shell grit washed off the reef — what the
 * sand round a colony is littered with. Flat to the bottom.
 */
function rubble(lod = 0) {
  const r = rng(53), parts = [];
  const N = lod ? 10 : 30;
  for (let k = 0; k < N; k++) {
    const a = r() * 6.28, d = Math.pow(r(), 0.7) * 0.95;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const colour = r() < 0.7 ? PALETTE.rubble : r() < 0.5 ? PALETTE.coralline : PALETTE.rubbleB;
    if (k % 4 === 3) {
      const g = new THREE.IcosahedronGeometry(0.03 + r() * 0.05, 0);
      g.scale(1, 0.6, 1);
      g.translate(x, 0.015, z);
      parts.push({ geo: g, color: PALETTE.rubbleB });
      continue;
    }
    const len = 0.1 + r() * 0.22, rad = 0.016 + r() * 0.02;
    const g = new THREE.CylinderGeometry(rad * 0.8, rad, len, 4);
    g.rotateZ(Math.PI / 2 + (r() - 0.5) * 0.3);
    g.rotateY(r() * 6.28);
    g.translate(x, rad * 0.8, z);
    parts.push({ geo: g, color: colour });
  }
  return mergeParts(parts);
}

/**
 * Table coral (tabular Acropora): a flat plate held up on one short stalk,
 * the top a carpet of tiny upright branchlets, the edge lobed and paler where
 * it is growing. The shape the reef top is known by.
 */
function tableCoral(lod = 0) {
  const segs = lod ? 20 : 44, rings = lod ? 5 : 10;
  const lobe = a => 0.84 + 0.32 * fbm3(Math.cos(a) * 1.4 + 5, 0.3, Math.sin(a) * 1.4);
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    prof.push(new THREE.Vector2(Math.max(0.001, t), 0.62 + 0.02 * t + Math.max(0, t - 0.8) * 0.2));
  }
  prof.push(new THREE.Vector2(1.03, 0.6), new THREE.Vector2(0.97, 0.55), new THREE.Vector2(0.65, 0.535),
            new THREE.Vector2(0.3, 0.52), new THREE.Vector2(0.14, 0.46));
  const plate = new THREE.LatheGeometry(prof, segs);
  const p = plate.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), k = lobe(Math.atan2(z, x));
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  const top = worked(plate,
    (q, n) => n.y > 0.5 ? (noise3(q.x * 7, q.y * 7, q.z * 7) - 0.5) * 0.035 : 0,
    (q, n, c) => {
      const out = Math.hypot(q.x, q.z) / lobe(Math.atan2(q.z, q.x));
      if (n.y < -0.2) c.copy(PALETTE.tableUnder);
      else c.copy(PALETTE.tableA).multiplyScalar(0.85 + noise3(q.x * 9, 0, q.z * 9) * 0.3)
             .lerp(PALETTE.tableTip, THREE.MathUtils.smoothstep(out, 0.82, 1.0) * 0.8);
    });
  const stalk = new THREE.CylinderGeometry(0.13, 0.22, 0.5, lod ? 8 : 12, 2);
  stalk.translate(0, 0.25, 0);
  const foot = worked(stalk, q => (noise3(q.x * 6, q.y * 6, q.z * 6) - 0.5) * 0.05,
                      (q, n, c) => c.copy(PALETTE.tableUnder).lerp(PALETTE.poritesDead, 0.5));
  return mergeColoured([top, foot]);
}

/**
 * Plate coral (foliose Montipora / Turbinaria): thin leaves grown out from one
 * base in a rosette, overlapping, each cupped up toward its rim and the rim
 * pale where it grows — a cabbage of plates on a reef slope.
 */
function plateCoral(lod = 0) {
  const parts = [];
  const LEAVES = lod ? 5 : 8;
  for (let k = 0; k < LEAVES; k++) {
    const yaw = k * 2.39996, y0 = 0.05 + (k % 3) * 0.13 + k * 0.02;
    const R = 0.55 + ((k * 7) % 5) * 0.09 - k * 0.02, span = 1.7 + ((k * 3) % 4) * 0.2;
    const rings = lod ? 3 : 6, prof = [];
    for (let i = 0; i <= rings; i++) {
      const t = 0.06 + 0.94 * i / rings;
      prof.push(new THREE.Vector2(t * R, y0 + Math.pow(t, 1.8) * 0.4 * R));
    }
    const g = new THREE.LatheGeometry(prof, lod ? 8 : 18, yaw - span / 2, span);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z) / R;
      // The leaf narrows to its base, and its margin is lobed and wavy, as
      // it grows faster in some places than others.
      const off = Math.atan2(Math.sin(a - yaw), Math.cos(a - yaw)) / (span / 2);
      const pinch = 1 - (1 - r) * Math.abs(off) * 0.9;
      const k2 = (0.85 + 0.3 * fbm3(Math.cos(a) * 1.6 + k * 3, 0, Math.sin(a) * 1.6)) * pinch;
      p.setXYZ(i, x * k2, p.getY(i) + Math.sin(a * 7 + k) * 0.015 * r * R, z * k2);
    }
    parts.push(worked(g, () => 0, (q, n, c) => {
      const r = Math.hypot(q.x, q.z) / R;
      c.copy(PALETTE.plateA).multiplyScalar(0.8 + 0.25 * r).lerp(PALETTE.plateRim, THREE.MathUtils.smoothstep(r, 0.8, 1.0) * 0.55);
    }));
  }
  const base = new THREE.CylinderGeometry(0.08, 0.16, 0.3, 8);
  base.translate(0, 0.15, 0);
  parts.push({ geo: base, color: PALETTE.plateA.clone().multiplyScalar(0.6) });
  return mergeColoured(parts);
}

/**
 * Massive coral (Porites): the boulders of the reef — broad, lumpy hummocks
 * of fused lobes, some of them centuries old and metres across, yellow-brown
 * on top and dead and grey with turf round the base where the sand scours it.
 */
function boulderCoral(lod = 0) {
  const parts = [];
  const lobes = [
    { r: 1.0, x: 0, z: 0, y: -0.18 }, { r: 0.68, x: 0.82, z: 0.3, y: -0.2 },
    { r: 0.6, x: -0.62, z: 0.6, y: -0.22 }, { r: 0.5, x: 0.1, z: -0.86, y: -0.24 },
  ];
  lobes.forEach((l, k) => {
    const g = new THREE.IcosahedronGeometry(l.r, lod ? (k ? 2 : 3) : (k ? 4 : 7));
    g.scale(1, 0.72, 1);
    g.translate(l.x, l.r * 0.62 + l.y, l.z);
    let hill = 0;
    parts.push(worked(g,
      q => {
        // Hillocks a few tens of centimetres across, and a fine pitting.
        hill = fbm3(q.x * 2.4 + k, q.y * 2.4, q.z * 2.4) - 0.5;
        return hill * 0.2 * l.r + (noise3(q.x * 11, q.y * 11, q.z * 11) - 0.5) * 0.025;
      },
      (q, n, c) => {
        const h = fbm3(q.x * 2.4 + k, q.y * 2.4, q.z * 2.4) - 0.5;
        c.copy(PALETTE.poritesB).lerp(PALETTE.poritesA, THREE.MathUtils.smoothstep(h, -0.15, 0.2))
          .lerp(PALETTE.poritesDead, THREE.MathUtils.smoothstep(q.y, 0.35, 0.0) * 0.8);
      }));
  });
  return mergeColoured(parts);
}

/** Finger coral: a clump of short, blunt, unbranched fingers off one base. */
function fingerCoral(lod = 0) {
  const r = rng(61), parts = [];
  const base = new THREE.IcosahedronGeometry(0.42, lod ? 1 : 2);
  base.scale(1, 0.35, 1);
  base.translate(0, 0.05, 0);
  parts.push({ geo: base, color: PALETTE.fingerA.clone().multiplyScalar(0.7) });
  const N = lod ? 12 : 26;
  for (let k = 0; k < N; k++) {
    const d = Math.sqrt((k + 0.5) / N) * 0.4, a = k * 2.39996;
    const h = 0.18 + (1 - d / 0.4) * 0.28 + r() * 0.1, rad = 0.04 + r() * 0.02;
    const g = new THREE.CylinderGeometry(rad, rad * 1.15, h, lod ? 5 : 7);
    g.translate(0, h / 2, 0);
    g.rotateZ(-d * 0.9 + (r() - 0.5) * 0.15);
    g.rotateY(-a);
    g.translate(Math.cos(a) * d, 0.04, Math.sin(a) * d);
    parts.push({ geo: g, color: PALETTE.fingerA });
    if (lod) continue;
    const cap = new THREE.SphereGeometry(rad, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.translate(0, h, 0);
    cap.rotateZ(-d * 0.9);
    cap.rotateY(-a);
    cap.translate(Math.cos(a) * d, 0.04, Math.sin(a) * d);
    parts.push({ geo: cap, color: PALETTE.fingerTip });
  }
  return mergeParts(parts);
}

/** Leather coral (Sarcophyton): a soft mushroom, the cap folded at its rim. */
function leatherCoral(lod = 0) {
  const stalk = new THREE.LatheGeometry([[0.17, 0], [0.13, 0.12], [0.12, 0.26], [0.16, 0.36], [0.26, 0.42]]
    .map(([x, y]) => new THREE.Vector2(x, y)), lod ? 8 : 14);
  const rings = lod ? 4 : 8, prof = [];
  for (let i = 0; i <= rings; i++) prof.push(new THREE.Vector2(Math.max(0.001, 0.6 * i / rings), 0.44));
  const cap = new THREE.LatheGeometry(prof, lod ? 16 : 32);
  const p = cap.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z) / 0.6;
    p.setY(i, p.getY(i) + Math.sin(a * 6) * 0.08 * r * r - r * r * 0.05);
  }
  return mergeColoured([
    worked(stalk, () => 0, (q, n, c) => c.copy(PALETTE.leatherStalk)),
    worked(cap, () => 0, (q, n, c) => c.copy(PALETTE.leatherA).multiplyScalar(0.85 + noise3(q.x * 14, 0, q.z * 14) * 0.3)
      .lerp(PALETTE.leatherStalk, n.y < 0 ? 0.6 : 0)),
  ]);
}

/** Tube sponges: a cluster of open tubes, dark down inside. */
function tubeSponge(outside, inside) {
  return (lod = 0) => {
    const r = rng(outside.getHex() & 0xffff), parts = [];
    const N = 4 + Math.floor(r() * 2);
    for (let k = 0; k < N; k++) {
      const a = k * 2.1 + r(), d = k ? 0.1 + r() * 0.14 : 0;
      const h = 0.45 + r() * 0.6, rad = 0.075 + r() * 0.045;
      const tube = new THREE.CylinderGeometry(rad * 1.12, rad * 0.85, h, lod ? 7 : 12, lod ? 1 : 3, true);
      tube.translate(0, h / 2, 0);
      const throat = new THREE.CylinderGeometry(rad * 0.9, rad * 0.75, 0.22, lod ? 7 : 12, 1, true);
      throat.translate(0, h - 0.11, 0);
      for (const g of [tube, throat]) {
        g.rotateZ(d * 0.8 + (r() - 0.5) * 0.1);
        g.rotateY(-a);
        g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
      }
      parts.push({ geo: tube, color: outside }, { geo: throat, color: inside });
    }
    return mergeParts(parts);
  };
}

/** Macroalgae: a bushy clump of short leafy fronds, olive and brown. */
function algae(lod = 0) {
  const r = rng(71), parts = [];
  const STEMS = 7;
  for (let s = 0; s < STEMS; s++) {
    const a = s * 0.9 + r(), lean = 0.15 + r() * 0.35, h = 0.25 + r() * 0.3;
    const bx = Math.cos(a) * 0.07, bz = Math.sin(a) * 0.07;
    const stipe = new THREE.CylinderGeometry(0.006, 0.01, h, 3);
    stipe.translate(0, h / 2, 0);
    stipe.rotateZ(lean); stipe.rotateY(-a);
    stipe.translate(bx, 0, bz);
    parts.push({ geo: stipe, color: PALETTE.algaeA });
    const leaves = lod ? 4 : 8;
    for (let i = 1; i <= leaves; i++) {
      const t = i / (leaves + 1), y = t * h;
      const leaf = new THREE.PlaneGeometry(0.05, 0.1);
      leaf.translate(0, 0.05, 0);
      leaf.rotateZ((i % 2 ? 1 : -1) * 0.9);
      leaf.rotateY(i * 1.3);
      leaf.translate(0, y, 0);
      leaf.rotateZ(lean); leaf.rotateY(-a);
      leaf.translate(bx, 0, bz);
      parts.push({ geo: leaf, color: i % 3 ? PALETTE.algaeB : PALETTE.algaeA });
    }
  }
  return mergeParts(parts);
}

/**
 * Kelp: a stand of tall stipes, blades all the way up, gas bladders holding
 * each blade to the light. Golden-brown, and the tallest thing on the shelf.
 */
function kelp() {
  const parts = [];
  const STIPES = 4;
  for (let s = 0; s < STIPES; s++) {
    const a = (s / STIPES) * Math.PI * 2 + s * 0.7;
    const bx = Math.cos(a) * 0.18, bz = Math.sin(a) * 0.18;
    const h = 3.2 + ((s * 7) % 5) * 0.45;
    const stipe = new THREE.CylinderGeometry(0.015, 0.03, h, 4);
    stipe.translate(bx, h / 2, bz);
    parts.push({ geo: stipe, color: PALETTE.kelpA });
    // Blades alternate up the stipe, each on a bladder.
    const blades = Math.round(h / 0.32);
    for (let i = 1; i < blades; i++) {
      const y = (i / blades) * h, side = i % 2 ? 1 : -1, yaw = a + side * 1.2 + i * 0.4;
      const len = 0.55 + (1 - Math.abs(i / blades - 0.5)) * 0.35;
      // A blade, not a slat: narrow at its stalk, widest past the middle,
      // drawn to a point, and drooping under its own weight.
      const blade = new THREE.PlaneGeometry(0.16, len, 2, 4);
      blade.translate(0, len / 2, 0);
      const bp = blade.attributes.position;
      for (let v = 0; v < bp.count; v++) {
        const t = bp.getY(v) / len;
        bp.setX(v, bp.getX(v) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.08)), 0.8) * (1 - t * 0.35));
        bp.setZ(v, bp.getZ(v) + t * t * 0.18 + Math.abs(bp.getX(v)) * 0.4);
      }
      blade.computeVertexNormals();
      blade.rotateZ(side * 0.9);
      blade.rotateY(yaw);
      blade.translate(bx, y, bz);
      parts.push({ geo: blade, color: i % 3 ? PALETTE.kelpB : PALETTE.kelpA });
      if (i % 2) continue;
      const bl = new THREE.OctahedronGeometry(0.04, 0);
      bl.translate(bx + Math.cos(yaw) * 0.04, y, bz + Math.sin(yaw) * 0.04);
      parts.push({ geo: bl, color: PALETTE.bladder });
    }
  }
  // The holdfast gripping the rock.
  const hold = new THREE.IcosahedronGeometry(0.22, 0);
  hold.scale(1.3, 0.45, 1.3);
  hold.translate(0, 0.08, 0);
  parts.push({ geo: hold, color: PALETTE.bladder });
  return mergeParts(parts);
}

/** A sea urchin: a dark test bristling with long spines. */
function urchin() {
  const parts = [];
  const body = new THREE.IcosahedronGeometry(0.12, 1);
  body.scale(1, 0.75, 1);
  body.translate(0, 0.09, 0);
  parts.push({ geo: body, color: PALETTE.urchin });
  const N = 34, up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    // Spread over the upper hemisphere and the sides (a Fibonacci sphere).
    const y = 1 - (i / (N - 1)) * 1.3, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.399;
    dir.set(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
    const len = 0.16 + (i % 3) * 0.05;
    const g = new THREE.ConeGeometry(0.008, len, 3);
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(dir.x * 0.1, 0.09 + dir.y * 0.07, dir.z * 0.1);
    parts.push({ geo: g, color: i % 2 ? PALETTE.urchin : PALETTE.urchinB });
  }
  return mergeParts(parts);
}

/** A starfish: five tapering arms, flat to the sand, with a ridge of warts. */
function starfish() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.ConeGeometry(0.055, 0.26, 5);
    arm.scale(1, 1, 0.45);
    arm.rotateZ(-Math.PI / 2);                   // point along +X
    arm.translate(0.13, 0.025, 0);
    arm.rotateY(a);
    parts.push({ geo: arm, color: PALETTE.starA });
    for (let k = 1; k <= 3; k++) {
      const w = new THREE.SphereGeometry(0.011, 4, 3);
      w.translate(0.04 + k * 0.05, 0.045, 0);
      w.rotateY(a);
      parts.push({ geo: w, color: PALETTE.starB });
    }
  }
  const disc = new THREE.CylinderGeometry(0.06, 0.07, 0.04, 10);
  disc.translate(0, 0.02, 0);
  parts.push({ geo: disc, color: PALETTE.starA });
  return mergeParts(parts);
}

/**
 * A giant clam: two fluted shell halves gaping open, and the mantle between
 * them in the blue-green the algae it farms give it.
 */
function clam() {
  const parts = [];
  const half = (up) => {
    const g = new THREE.SphereGeometry(0.34, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      // Flutes: the shell's ribs, scalloping the rim.
      const a = Math.atan2(z, x);
      const rib = 1 + 0.08 * Math.cos(a * 7);
      p.setXYZ(i, x * rib * 1.2, p.getY(i) * 0.55 * (up ? 1 : -1), z * rib * 0.8);
    }
    g.computeVertexNormals();
    return g;
  };
  const lower = half(false);
  lower.translate(0, 0.2, 0);
  const upper = half(true);
  upper.rotateZ(0.62);                           // gaping, the mantle out between
  upper.translate(-0.08, 0.26, 0);
  parts.push({ geo: lower, color: PALETTE.shell }, { geo: upper, color: PALETTE.shellB });
  const mantle = new THREE.SphereGeometry(0.3, 12, 4);
  mantle.scale(1.15, 0.16, 0.66);
  mantle.translate(0.02, 0.23, 0);
  parts.push({ geo: mantle, color: PALETTE.mantleA });
  const lip = new THREE.TorusGeometry(0.3, 0.03, 4, 16);
  lip.rotateX(Math.PI / 2);
  lip.scale(1.15, 1, 0.66);
  lip.translate(0.02, 0.24, 0);
  parts.push({ geo: lip, color: PALETTE.mantleB });
  return mergeParts(parts);
}

// ── where each of them grows ─────────────────────────────────────────────────
// The scatter (terrain.js, buildReef) lays a reef out the way one grows:
//
//   anchors     the big pieces — massive and brain coral, table coral, an
//               outcrop or slab of rock — where the colony is (`anchor` is
//               each one's weight in that lottery);
//   satellites  smaller colonies crowded round each anchor, thinning out
//               away from it (`weight`);
//   perched     small things grown up on top of a rock (`perch`): a rock
//               on a reef is never bare;
//   fill        the open ground between — seagrass meadows, rubble, cobbles,
//               starfish, the odd coral on a bedrock ledge (`weight` again).
//
// `reef` is the reef-mask window from terrain.js and `hard` how much of the
// ground is rock (the reef's framework and bedrock ledges, landAt().rock):
// a coral needs something hard to settle on, seagrass needs sand. `depth` is
// the band of sea bed it tolerates, `soft` how much of it bends in the surge
// (0 rigid, 1 fully), `lean` how far it leans with a slope it grows on (0
// plumb, 1 flat to it; 0.8 if not given), `carries` whether things can grow
// on top of it, and
// `solid` false for what lies too flat to stop you. `patch` makes a species
// grow in patches (seagrass in meadows): [noise frequency, from, to].
export const REEF = [
  { name: 'brain',    make: brainCoral,   reef: [0.20, 1.01], hard: [0.30, 1.01], maxSlope: 0.65,
    depth: [-21, -6.0], anchor: 0.45, weight: 0.30, scale: [0.6, 2.5], soft: 0, tint: 0.30 },
  { name: 'porites',  make: boulderCoral, reef: [0.20, 1.01], hard: [0.30, 1.01], maxSlope: 0.70,
    depth: [-22, -3.5], anchor: 0.75, weight: 0.12, scale: [0.7, 2.7], soft: 0, tint: 0.22 },
  { name: 'table',    make: tableCoral,   reef: [0.30, 1.01], hard: [0.40, 1.01], maxSlope: 0.55,
    depth: [-17, -4.0], anchor: 0.55, weight: 0.10, scale: [0.6, 1.9], lean: 0.35, soft: 0, tint: 0.28 },
  { name: 'staghorn', make: staghorn,     reef: [0.30, 1.01], hard: [0.30, 1.01], maxSlope: 0.60,
    depth: [-20, -5.0], anchor: 0.30, weight: 0.50, scale: [0.7, 2.0], soft: 0.15, tint: 0.30 },
  { name: 'plate',    make: plateCoral,   reef: [0.20, 1.01], hard: [0.30, 1.01], maxSlope: 0.90,
    depth: [-26, -7.0], anchor: 0.15, weight: 0.45, perch: 0.40, scale: [0.6, 1.7], soft: 0, tint: 0.32 },
  { name: 'finger',   make: fingerCoral,  reef: [0.15, 1.01], hard: [0.30, 1.01], maxSlope: 0.75,
    depth: [-20, -3.0], weight: 0.45, perch: 0.60, scale: [0.6, 1.6], soft: 0, tint: 0.34 },
  { name: 'fan',      make: seaFan,       reef: [0.00, 1.01], hard: [0.30, 1.01], maxSlope: 0.90,
    depth: [-27, -8.0], weight: 0.32, perch: 0.45, scale: [0.8, 2.6], lean: 0.3, soft: 1, tint: 0.34 },
  { name: 'barrel',   make: barrelSponge, reef: [0.00, 1.01], hard: [0.30, 1.01], maxSlope: 0.40,
    depth: [-26, -8.0], anchor: 0.10, weight: 0.07, scale: [0.7, 1.9], lean: 0.3, soft: 0, tint: 0.22 },
  { name: 'tube',     make: tubeSponge(PALETTE.tubeP, PALETTE.tubePIn), reef: [0.00, 1.01], hard: [0.30, 1.01],
    maxSlope: 0.70, depth: [-26, -6.0], weight: 0.22, perch: 0.45, scale: [0.7, 1.6], lean: 0.3, soft: 0, tint: 0.25 },
  { name: 'tubeYellow', make: tubeSponge(PALETTE.tubeY, PALETTE.tubeYIn), reef: [0.00, 1.01], hard: [0.30, 1.01],
    maxSlope: 0.70, depth: [-26, -6.0], weight: 0.16, perch: 0.35, scale: [0.7, 1.5], lean: 0.3, soft: 0, tint: 0.2 },
  { name: 'leather',  make: leatherCoral, reef: [0.20, 1.01], hard: [0.30, 1.01], maxSlope: 0.70,
    depth: [-20, -4.0], weight: 0.28, perch: 0.45, scale: [0.6, 1.7], lean: 0.5, soft: 0.3, tint: 0.28 },
  { name: 'anemone',  make: anemone,      reef: [0.00, 1.01], hard: [0.20, 1.01], maxSlope: 0.55,
    depth: [-22, -3.0], weight: 0.22, perch: 0.40, scale: [0.7, 2.0], lean: 0.7, soft: 1, tint: 0.38 },
  { name: 'grass',    make: seagrass,     reef: [0.00, 0.45], hard: [0.00, 0.30], maxSlope: 0.26,
    depth: [-20, -2.5], weight: 1.40, scale: [0.77, 2.4], lean: 0.4, soft: 1, tint: 0.22, patch: [0.045, 0.42, 0.56] },
  { name: 'algae',    make: algae,        reef: [0.00, 1.01], hard: [0.00, 1.01], maxSlope: 0.60,
    depth: [-18, -2.0], weight: 0.30, perch: 0.50, scale: [0.8, 2.0], lean: 0.6, soft: 1, tint: 0.25 },
  { name: 'rock',     make: boulder,      reef: [0.00, 0.80], hard: [0.00, 1.01], maxSlope: 0.75,
    depth: [-27, -2.5], anchor: 0.30, weight: 0.10, carries: true, scale: [0.63, 3.0], soft: 0, tint: 0.14 },
  { name: 'outcrop',  make: outcrop,      reef: [0.00, 0.70], hard: [0.00, 1.01], maxSlope: 0.70,
    depth: [-27, -3.0], anchor: 0.32, carries: true, scale: [0.8, 2.2], soft: 0, tint: 0.14 },
  { name: 'slab',     make: slab,         reef: [0.00, 0.60], hard: [0.25, 1.01], maxSlope: 0.60,
    depth: [-27, -3.0], anchor: 0.45, weight: 0.08, carries: true, scale: [0.7, 2.0], soft: 0, tint: 0.12 },
  { name: 'stones',   make: stones,       reef: [0.00, 1.01], hard: [0.00, 1.01], maxSlope: 0.60,
    depth: [-27, -1.5], weight: 0.30, scale: [0.7, 1.8], lean: 1.0, soft: 0, solid: false, tint: 0.15 },
  { name: 'rubble',   make: rubble,       reef: [0.10, 1.01], hard: [0.00, 0.60], maxSlope: 0.50,
    depth: [-24, -3.0], weight: 0.50, scale: [0.8, 2.2], lean: 1.0, soft: 0, solid: false, tint: 0.12 },
  // Kelp stands in the shallower water, on rock or the sand beside it.
  { name: 'kelp',     make: kelp,         reef: [0.00, 0.75], hard: [0.00, 1.01], maxSlope: 0.45,
    depth: [-16, -4.5], anchor: 0.08, weight: 0.10, scale: [0.8, 1.9], lean: 0.25, soft: 1, tint: 0.22 },
  // Grazers and filterers on the colonies, starfish out on the sand.
  { name: 'urchin',   make: urchin,       reef: [0.00, 1.01], hard: [0.20, 1.01], maxSlope: 0.60,
    depth: [-22, -3.0], weight: 0.22, perch: 0.35, scale: [0.8, 1.6], soft: 0, solid: false, tint: 0.25 },
  { name: 'starfish', make: starfish,     reef: [0.00, 1.01], hard: [0.00, 0.40], maxSlope: 0.35,
    depth: [-22, -3.0], weight: 0.16, scale: [0.8, 1.8], lean: 1.0, soft: 0, solid: false, tint: 0.45 },
  { name: 'clam',     make: clam,         reef: [0.30, 1.01], hard: [0.30, 1.01], maxSlope: 0.45,
    depth: [-16, -3.0], weight: 0.12, perch: 0.25, scale: [0.8, 2.0], soft: 0, tint: 0.35 },
];

// ── geometry + material ──────────────────────────────────────────────────────
// Built once each: [near, far]. The far set (lod 1) is for the reef past the
// chunk you are in, 32 m and more off, where the detail is lost in the haze.
const GEO = [null, null];
const LIGHTER = new Set(['brain', 'porites', 'table', 'staghorn', 'plate', 'finger', 'fan', 'barrel', 'tube', 'tubeYellow',
                         'leather', 'algae', 'rock', 'outcrop', 'slab', 'stones', 'rubble']);

/**
 * Build every species once. Each gets a `sway` attribute — how far that vertex
 * is allowed to move in the surge — derived from its height up the plant, so
 * the base stays planted and the tips travel.
 */
export function reefGeometry(lod = 0) {
  if (GEO[lod]) return GEO[lod];
  GEO[lod] = REEF.map((sp, f) => {
    // The far set: lighter only where it is worth it; the rest are the near ones.
    if (lod && !LIGHTER.has(sp.name)) return reefGeometry(0)[f];
    const g = sp.make(lod);
    // Contact shade: darker toward where it meets the bed, as the light down
    // there is shut out by everything round it. Without it each piece looked
    // set down on the sand rather than grown out of it.
    {
      const p = g.attributes.position, c = g.attributes.color;
      let top = 0;
      for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
      const reach = Math.min(0.4, top * 0.45);
      for (let i = 0; i < p.count; i++) {
        const k = 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.getY(i), 0, reach);
        c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
      }
    }
    if (sp.soft > 0) {
      const p = g.attributes.position;
      let top = 0;
      for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
      const sway = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        sway[i] = Math.pow(Math.max(0, p.getY(i)) / (top || 1), 1.6) * sp.soft;
      }
      g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
    } else {
      g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    }
    return g;
  });
  return GEO[lod];
}

let MAT = null;

/**
 * One material for the whole reef. The surge is a vertex-shader sway keyed off
 * the instance's own position, so a bed of seagrass ripples in a wave instead
 * of every blade moving as one.
 */
export function reefMaterial() {
  if (MAT) return MAT;
  MAT = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.82, metalness: 0,
    side: THREE.DoubleSide,
  });
  MAT.userData.time = { value: 0 };
  MAT.onBeforeCompile = shader => {
    shader.uniforms.uTime = MAT.userData.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute float sway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.55 + instanceMatrix[3].z * 0.77;
        #else
          float phase = 0.0;
        #endif
        transformed.x += sin(uTime * 1.05 + phase) * sway * 0.34;
        transformed.z += sin(uTime * 0.83 + phase * 1.37 + 1.7) * sway * 0.22;`);

    // Light at 15m has had the red taken out of it twice over — once on the way
    // down and once on the way back to the eye — so lit-only coral comes out
    // the same grey as the sand it sits on. A little self-colour holds the hue
    // together at the distances you actually see it from.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * 0.30;`);
  };
  applyCaustics(MAT);
  return MAT;
}

/** Advance the surge. Called once a frame, not once per chunk. */
export function setReefTime(t) {
  if (MAT) MAT.userData.time.value = t;
}
