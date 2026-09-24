// ── Fire ─────────────────────────────────────────────────────────────────────
// What a campfire looks like: a ring of stones, a teepee of sticks over a bed
// of coals, and — when it is lit — a flame, sparks going up, and the wood
// glowing where it burns. raft.js builds the campfire and keeps its fuel; this
// is only how it is drawn, so the same fire can go anywhere.
//
// The flame is not a mesh of cones. It is two billboards drawn by a shader:
// a teardrop of fire eaten away from the top by rising noise, white-yellow at
// the heart, through orange, to red at the edges — so it billows and licks
// the way a wood fire does, from every side. The sparks are points on their
// own short lives. The wood chars from the heart of the fire outward as its
// fuel goes, and glows orange there while it burns.
//
// Built here, not borrowed: the look takes its lead from two Sketchfab pieces
// used as reference only — "Fire animated" by lampyre3d for the flame and
// sparks, "Stylized Campfire" by AndresX for the stones and the teepee.
// Neither model is in the game.

import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

const TIME = { value: 0 };             // shared by every flame and spark
const SPARKS = 34;                      // per fire
const HEART = new THREE.Vector3(0, 0.05, 0);   // where the wood burns hottest: down among the coals

// ── the wood ─────────────────────────────────────────────────────────────────
/**
 * One stick: a tapered, slightly bent cylinder from `a` to `b`, with each
 * vertex's distance from the heart of the fire kept as `aHeat` — what the
 * shader chars and lights it by.
 */
function stick(a, b, r0, r1, rnd) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 4);
  const pos = g.attributes.position;
  // A bend and a knot or two, so no two sticks are the same dowel.
  const bend = (rnd() - 0.5) * 0.05, twist = rnd() * 6;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / len + 0.5;
    const s = 1 + Math.sin(y * 9 + twist) * 0.08;
    pos.setX(i, pos.getX(i) * s + Math.sin(y * Math.PI) * bend);
    pos.setZ(i, pos.getZ(i) * s);
  }
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
  return heat(g);
}

function heat(g) {
  const pos = g.attributes.position, h = new Float32Array(pos.count), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) h[i] = v.fromBufferAttribute(pos, i).distanceTo(HEART);
  g.setAttribute('aHeat', new THREE.BufferAttribute(h, 1));
  return g;
}

let WOOD_GEO = null;
/** The teepee, the two logs it leans on and the coals under it — one geometry. */
function woodGeometry() {
  if (WOOD_GEO) return WOOD_GEO;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const parts = [];
  // Seven sticks leaning in, their tops crossing a hand's width above the
  // heart — a teepee, the fire that draws best.
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + rnd() * 0.4;
    const foot = new THREE.Vector3(Math.cos(ang) * 0.3, 0.02, Math.sin(ang) * 0.3);
    const top = new THREE.Vector3(Math.cos(ang + 2.6) * 0.05, 0.5 + rnd() * 0.08, Math.sin(ang + 2.6) * 0.05);
    parts.push(stick(foot, top, 0.028 + rnd() * 0.01, 0.012, rnd));
  }
  // Two thicker split logs laid across the base.
  for (const [a, b] of [[[-0.3, 0.05, -0.1], [0.28, 0.06, 0.08]], [[-0.08, 0.05, 0.3], [0.1, 0.07, -0.28]]]) {
    parts.push(stick(new THREE.Vector3(...a), new THREE.Vector3(...b), 0.045, 0.04, rnd));
  }
  // The coal bed: lumps in the middle of the ring.
  for (let i = 0; i < 14; i++) {
    const r = Math.sqrt(rnd()) * 0.2, ang = rnd() * Math.PI * 2;
    const c = new THREE.IcosahedronGeometry(0.035 + rnd() * 0.025, 0);
    c.scale(1, 0.55, 1);
    c.rotateY(rnd() * 3);
    c.translate(Math.cos(ang) * r, 0.035, Math.sin(ang) * r);
    parts.push(heat(c.toNonIndexed()));
  }
  WOOD_GEO = mergeGeometries(parts.map(p => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aHeat'].includes(k)) g.deleteAttribute(k);
    return g;
  }));
  WOOD_GEO.computeVertexNormals();
  return WOOD_GEO;
}

/**
 * The wood's material, one per fire (its heat is its own): bark, charred
 * black from the heart outward as far as the fire has burned, and glowing
 * orange close in while it is alight.
 */
function woodMaterial(bark) {
  const m = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, color: 0xb59474 });
  const u = { uBurn: { value: 0 }, uGlow: { value: 0 }, uTime: TIME };
  m.userData.fire = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBurn, uGlow, uTime;\nvarying float vHeat;\nvarying vec3 vLocal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Charred as far out from the heart as the fire has eaten.
        float charR = 0.12 + 0.3 * uBurn;
        float charred = 1.0 - smoothstep(charR - 0.05, charR + 0.06, vHeat);
        diffuseColor.rgb *= mix(1.0, 0.1, charred);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Embers: hottest at the heart, flickering in cracks along the grain.
        float crack = 0.55 + 0.45 * sin(vLocal.y * 60.0 + vLocal.x * 40.0 + uTime * 3.0);
        float ember = (1.0 - smoothstep(0.06, 0.34, vHeat)) * crack;
        totalEmissiveRadiance += vec3(1.0, 0.36, 0.08) * ember * uGlow * 2.2;`);
  };
  return m;
}

// ── the flame ────────────────────────────────────────────────────────────────
const FLAME_VERT = /* glsl */`
  uniform float uSize;
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    // Faces the camera but stays upright with the raft: a flame leans with
    // the deck, never over onto its side because you looked down at it.
    vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 up = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 toCam = cameraPosition - c;
    vec3 side = cross(up, toCam);
    side = length(side) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(side);
    vec3 wp = c + (side * position.x + up * position.y) * uSize;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const FLAME_FRAG = /* glsl */`
  uniform float uTime, uSeed, uPower, fogDensity;
  varying vec2 vUv;
  varying float vFogDepth;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  void main() {
    float t = uTime * 1.9 + uSeed * 17.0;
    vec2 q = vec2(vUv.x * 2.4 + uSeed * 5.0, vUv.y * 1.7 - t);
    float n = fbm(q + vec2(fbm(q * 1.6 + t * 0.4), 0.0));
    // The tongue sways more the higher it goes.
    float x = vUv.x - 0.5 + (n - 0.5) * 0.5 * vUv.y;
    float width = 0.34 * pow(max(1.0 - vUv.y, 0.0), 0.6) * smoothstep(0.0, 0.1, vUv.y + 0.02);
    float body = 1.0 - smoothstep(width * 0.45, width, abs(x));
    // Eaten away from the top by the rising noise: the licks and the gaps.
    float heat = body * smoothstep(0.0, 0.6, (1.0 - vUv.y) * 1.1 - (n - 0.42) * 1.1);
    if (heat < 0.01) discard;
    vec3 col = mix(vec3(0.8, 0.14, 0.02), vec3(1.0, 0.5, 0.1), smoothstep(0.08, 0.42, heat));
    col = mix(col, vec3(1.0, 0.92, 0.62), smoothstep(0.5, 0.95, heat));
    float a = smoothstep(0.0, 0.3, heat) * uPower;
    // Fog takes the light away rather than adding its own colour: this is
    // drawn additively.
    float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    gl_FragColor = vec4(col * a * 1.25 * (1.0 - fog), 1.0);
  }`;

function flameMaterial(seed) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uSeed: { value: seed }, uSize: { value: 1 }, uPower: { value: 1 },
                fogDensity: { value: 0.00115 } },
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ── sparks ───────────────────────────────────────────────────────────────────
const SPARK_VERT = /* glsl */`
  attribute float aLife;
  uniform float uPx;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPx * (1.0 - aLife * 0.7) / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }`;
const SPARK_FRAG = /* glsl */`
  uniform float uPower;
  varying float vLife;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || vLife >= 1.0) discard;
    float a = (1.0 - d * 2.0) * (1.0 - vLife) * uPower;
    vec3 col = mix(vec3(1.0, 0.85, 0.45), vec3(0.9, 0.25, 0.05), vLife);
    gl_FragColor = vec4(col * a, 1.0);
  }`;

/** One fire's sparks: each a short life from the heart, up and drifting. */
function sparks() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SPARKS * 3), life = new Float32Array(SPARKS).fill(1);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 26 * Math.min(devicePixelRatio || 1, 2) }, uPower: { value: 1 } },
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.userData.spark = Array.from({ length: SPARKS }, () => ({ age: 1, life: 1, vx: 0, vz: 0, vy: 0, x: 0, y: 0, z: 0 }));
  return p;
}

function stepSparks(p, dt, rate) {
  const g = p.geometry, pos = g.attributes.position.array, life = g.attributes.aLife.array;
  p.userData.spare = (p.userData.spare || 0) + rate * dt;
  for (let i = 0; i < SPARKS; i++) {
    const s = p.userData.spark[i];
    if (s.age >= s.life && p.userData.spare >= 1) {
      p.userData.spare -= 1;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.12;
      Object.assign(s, { age: 0, life: 0.7 + Math.random() * 1.1,
        x: Math.cos(a) * r, y: 0.3 + Math.random() * 0.2, z: Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 0.25, vz: (Math.random() - 0.5) * 0.25, vy: 0.7 + Math.random() * 0.8 });
    }
    s.age += dt;
    // Up on the heat, wandering, slowing as they cool.
    s.vx += (Math.random() - 0.5) * dt * 1.6;
    s.vz += (Math.random() - 0.5) * dt * 1.6;
    s.vy *= 1 - dt * 0.6;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    life[i] = Math.min(1, s.age / s.life);
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.aLife.needsUpdate = true;
}

// ── the campfire ─────────────────────────────────────────────────────────────
/**
 * A campfire at (x, z) in its parent's space. `M` is raft.js's material
 * lookup (stone, bark, glow). Returns the group; its `userData.fire` is what
 * updateFire() drives.
 */
export function buildCampfire(x, z, M, bark) {
  const g = new THREE.Group();
  const at = new THREE.Group();
  at.position.set(x, 0, z);
  g.add(at);

  // Rounded river stones, a little sunk and tilted, nine to the ring.
  const stoneG = new THREE.IcosahedronGeometry(0.15, 1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.sin(i * 7.3) * 0.12;
    const s = new THREE.Mesh(stoneG, M('stone'));
    s.position.set(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5);
    s.rotation.set(Math.sin(i * 3.1), i * 1.7, Math.cos(i * 2.3) * 0.4);
    const k = 0.8 + ((i * 37) % 10) / 22;
    s.scale.set(k * 1.1, k * 0.62, k * 0.9);
    s.castShadow = s.receiveShadow = true;
    at.add(s);
  }

  const woodMat = woodMaterial(bark);
  const wood = new THREE.Mesh(woodGeometry(), woodMat);
  wood.name = 'wood';
  wood.castShadow = wood.receiveShadow = true;
  at.add(wood);

  // Two flames, one broad and one narrow and taller, turning on different
  // noise so the fire never repeats.
  const flame = new THREE.Group();
  flame.name = 'flame';
  flame.position.y = 0.08;
  const quad = new THREE.PlaneGeometry(0.9, 1.25).translate(0, 0.62, 0);
  const tongues = [];
  for (const [seed, size] of [[0.0, 1.0], [0.37, 0.78]]) {
    const t = new THREE.Mesh(quad, flameMaterial(seed));
    t.frustumCulled = false;
    t.renderOrder = 2;
    t.userData.size = size;
    tongues.push(t);
    flame.add(t);
  }
  const glow = new THREE.Sprite(M('glow'));
  glow.position.y = 0.35;
  flame.add(glow);
  at.add(flame);

  const sp = sparks();
  at.add(sp);

  const light = new THREE.PointLight(0xff9b3d, 6, 16, 2);
  light.position.set(0, 0.85, 0);
  light.name = 'firelight';
  at.add(light);

  g.userData.fire = { at, wood, woodMat, flame, tongues, glow, sparks: sp, light };
  return g;
}

/** Advance the flames' clock — once a frame, however many fires there are. */
export function tickFire(time) { TIME.value = time; }

/**
 * Draw a campfire as it is now.
 * @param size  0 when out, up to 1 for a full fire
 * @param burnt 0..1, how much of its wood has burned (chars it)
 */
export function updateFire(obj, { lit, size, burnt, flicker, night, dt, fogDensity }) {
  const f = obj.userData.fire;
  if (!f) return;
  f.flame.visible = lit;
  f.sparks.visible = lit;
  const heat = lit ? size * flicker : 0;
  f.woodMat.userData.fire.uGlow.value = lit ? 0.35 + 0.65 * heat : 0;
  f.woodMat.userData.fire.uBurn.value = burnt;
  f.light.intensity = lit ? ((1.6 + flicker * 1.6) + (3.4 + flicker * 1.2) * night) * size : 0;
  if (!lit) return;
  for (const t of f.tongues) {
    const u = t.material.uniforms;
    u.uSize.value = t.userData.size * (0.45 + 0.55 * size) * (0.94 + 0.12 * flicker);
    u.uPower.value = 0.75 + 0.25 * night;
    if (fogDensity !== undefined) u.fogDensity.value = fogDensity;
  }
  f.glow.scale.setScalar((1.6 + 1.4 * size) * (0.9 + 0.2 * flicker));
  f.sparks.material.uniforms.uPower.value = size;
  stepSparks(f.sparks, dt, 7 * size);
}
