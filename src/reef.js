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
