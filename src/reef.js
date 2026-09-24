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
  rock:    col(0x6d6f66), rockMoss: col(0x4d6b48),
  kelpA:   col(0x8a7a2e), kelpB:   col(0xb09a3c), bladder: col(0x6f5f24),
  urchin:  col(0x3a1f3f), urchinB: col(0x5c2d63),
  starA:   col(0xe0663a), starB:   col(0xf2a25c),
  shell:   col(0xcfc3a8), shellB:  col(0x9d9178), mantleA: col(0x2f9fb0), mantleB: col(0x5fd0a0),
};

// ── species ──────────────────────────────────────────────────────────────────

/** A dome of fused lobes. The workhorse of the reef floor. */
function brainCoral() {
  const parts = [];
  const lobes = [
    { r: 1.00, x: 0, z: 0, y: 0.00, c: PALETTE.brainA },
    { r: 0.62, x: 0.78, z: 0.22, y: -0.12, c: PALETTE.brainB },
    { r: 0.54, x: -0.46, z: 0.68, y: -0.16, c: PALETTE.brainA },
    { r: 0.40, x: 0.12, z: -0.78, y: -0.22, c: PALETTE.brainB },
  ];
  for (const l of lobes) {
    const g = new THREE.IcosahedronGeometry(l.r, 1);
    g.scale(1, 0.66, 1);                 // domed, not spherical
    g.translate(l.x, l.r * 0.58 + l.y, l.z);
    parts.push({ geo: g, color: l.c });
  }
  return mergeParts(parts);
}

/** Branching coral. Three generations, each thinner and more splayed. */
function staghorn() {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();

  // Lay one branch from `from` along `dir` and recurse off its tip.
  const branch = (from, pitch, yaw, len, rad, depth) => {
    dir.set(Math.sin(pitch) * Math.cos(yaw), Math.cos(pitch), Math.sin(pitch) * Math.sin(yaw));
    const g = new THREE.CylinderGeometry(rad * 0.62, rad, len, 5);
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, dir);
    g.applyQuaternion(q);
    g.translate(from.x, from.y, from.z);
    parts.push({ geo: g, color: depth > 1 ? PALETTE.stagB : PALETTE.stagA });

    if (depth === 0) return;
    const tip = from.clone().addScaledVector(dir, len * 0.92);
    const forks = depth === 2 ? 3 : 2;
    for (let i = 0; i < forks; i++) {
      branch(tip, pitch + 0.38 + i * 0.12, yaw + (i / forks) * Math.PI * 2 + depth,
             len * 0.62, rad * 0.66, depth - 1);
    }
  };

  branch(new THREE.Vector3(0, 0, 0), 0.05, 0, 0.55, 0.115, 2);
  return mergeParts(parts);
}

/** A sea fan: rods radiating in one plane, so it reads as a net from the side. */
function seaFan() {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.05, 0.075, 0.30, 5);
  stem.translate(0, 0.15, 0);
  parts.push({ geo: stem, color: PALETTE.fanB });

  const RIBS = 9;
  for (let i = 0; i < RIBS; i++) {
    const t = i / (RIBS - 1);
    const a = (t - 0.5) * 1.55;                      // fan opening angle
    const len = 0.85 - Math.abs(t - 0.5) * 0.55;
    const g = new THREE.CylinderGeometry(0.015, 0.032, len, 4);
    g.translate(0, len / 2, 0);
    g.rotateZ(a);
    g.translate(0, 0.28, 0);
    parts.push({ geo: g, color: PALETTE.fanA });
  }
  // Two cross-ties turn the ribs into a mesh rather than a comb.
  for (const [y, w] of [[0.62, 0.62], [0.88, 0.46]]) {
    const g = new THREE.CylinderGeometry(0.012, 0.012, w, 4);
    g.rotateZ(Math.PI / 2);
    g.translate(0, y, 0);
    parts.push({ geo: g, color: PALETTE.fanB });
  }
  return mergeParts(parts);
}

/** Barrel sponge — a fat tube with a dark mouth sunk into the top. */
function barrelSponge() {
  const body = new THREE.CylinderGeometry(0.46, 0.30, 0.95, 10);
  body.translate(0, 0.475, 0);
  const rim = new THREE.CylinderGeometry(0.46, 0.42, 0.10, 10);
  rim.translate(0, 0.95, 0);
  // Recessed disc: cheaper than an open-ended tube with an inner wall, and at
  // reef distances it reads the same.
  const mouth = new THREE.CircleGeometry(0.34, 10);
  mouth.rotateX(-Math.PI / 2);
  mouth.translate(0, 0.90, 0);
  return mergeParts([
    { geo: body, color: PALETTE.spongeA },
    { geo: rim, color: PALETTE.spongeA },
    { geo: mouth, color: PALETTE.mouth },
  ]);
}

/** Anemone: a squat column under a crown of tentacles that catch the surge. */
function anemone() {
  const parts = [];
  const foot = new THREE.CylinderGeometry(0.17, 0.22, 0.20, 8);
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

/** Bare rock, for the stretches of sand where nothing has taken hold. */
function boulder() {
  const a = new THREE.DodecahedronGeometry(0.62, 0);
  a.scale(1.15, 0.72, 0.95);
  a.translate(0, 0.40, 0);
  const b = new THREE.DodecahedronGeometry(0.34, 0);
  b.scale(1.0, 0.8, 1.2);
  b.translate(0.42, 0.22, -0.28);
  return mergeParts([
    { geo: a, color: PALETTE.rock },
    { geo: b, color: PALETTE.rockMoss },
  ]);
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
      const blade = new THREE.PlaneGeometry(0.13, len, 1, 2);
      blade.translate(0, len / 2, 0);
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
// `reef` is the reef-mask window from terrain.js: coral wants rock to settle
// on, seagrass wants the open sand between the colonies. `depth` is the height
// band of sea bed the species tolerates, and `soft` is how much of it bends in
// the surge (0 rigid, 1 fully).
export const REEF = [
  { name: 'brain',    make: brainCoral,   reef: [0.40, 1.01], maxSlope: 0.50,
    depth: [-21, -7.5], weight: 0.50, scale: [0.63, 2.94], soft: 0, tint: 0.30 },
  { name: 'staghorn', make: staghorn,     reef: [0.50, 1.01], maxSlope: 0.45,
    depth: [-20, -8.5], weight: 0.60, scale: [0.70, 2.73], soft: 0.25, tint: 0.26 },
  { name: 'fan',      make: seaFan,       reef: [0.45, 1.01], maxSlope: 0.70,
    depth: [-21, -8.5], weight: 0.45, scale: [0.77, 3.08], soft: 1, tint: 0.34 },
  { name: 'barrel',   make: barrelSponge, reef: [0.35, 1.01], maxSlope: 0.38,
    depth: [-22, -8.0], weight: 0.30, scale: [0.77, 2.59], soft: 0, tint: 0.22 },
  { name: 'anemone',  make: anemone,      reef: [0.25, 1.01], maxSlope: 0.55,
    depth: [-22, -6.0], weight: 0.40, scale: [0.70, 2.24], soft: 1, tint: 0.38 },
  { name: 'grass',    make: seagrass,     reef: [0.00, 0.34], maxSlope: 0.26,
    depth: [-20, -4.0], weight: 0.85, scale: [0.77, 2.66], soft: 1, tint: 0.22 },
  { name: 'rock',     make: boulder,      reef: [0.00, 1.01], maxSlope: 0.75,
    depth: [-27, -2.5], weight: 0.26, scale: [0.63, 3.36], soft: 0, tint: 0.14 },
  // Kelp stands in the shallower water, on rock or the sand beside it.
  { name: 'kelp',     make: kelp,         reef: [0.00, 0.75], maxSlope: 0.45,
    depth: [-16, -4.5], weight: 0.30, scale: [0.8, 1.9], soft: 1, tint: 0.22 },
  // Grazers and filterers on the colonies, starfish out on the sand.
  { name: 'urchin',   make: urchin,       reef: [0.30, 1.01], maxSlope: 0.60,
    depth: [-22, -5.0], weight: 0.28, scale: [0.8, 1.6], soft: 0, tint: 0.25 },
  { name: 'starfish', make: starfish,     reef: [0.00, 0.60], maxSlope: 0.35,
    depth: [-22, -3.0], weight: 0.22, scale: [0.8, 1.8], soft: 0, tint: 0.45 },
  { name: 'clam',     make: clam,         reef: [0.45, 1.01], maxSlope: 0.30,
    depth: [-18, -6.0], weight: 0.16, scale: [0.8, 2.0], soft: 0, tint: 0.35 },
];

// ── geometry + material ──────────────────────────────────────────────────────
let GEO = null;

/**
 * Build every species once. Each gets a `sway` attribute — how far that vertex
 * is allowed to move in the surge — derived from its height up the plant, so
 * the base stays planted and the tips travel.
 */
export function reefGeometry() {
  if (GEO) return GEO;
  GEO = REEF.map(sp => {
    const g = sp.make();
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
  return GEO;
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
    flatShading: true, side: THREE.DoubleSide,
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
