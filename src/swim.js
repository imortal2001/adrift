// ── Swimming ─────────────────────────────────────────────────────────────────
// How a fish moves its body: the vertex shader that bends it, and the little
// state machine that says how hard to bend it this frame.
//
// Nothing is skinned. The body is bent by a travelling wave in the vertex
// shader, as before, but now each part of the mesh moves its own way — the
// model tags every vertex (tools/build_fish.py, UV u = part + flex):
//
//   body     the travelling wave, plus a C-curve into turns
//   caudal   follows the wave, lagging, so the tail flicks rather than slides
//   median   dorsal and anal fins ripple along their length
//   paired   pectorals and pelvics row — sculling at the flanks — or, for a
//            shark's, a tuna's or a whale's wings, lift and droop
//   eye      rides the body; the fragment shader makes it glossy
//
// Four numbers per fish drive all of it, per frame: phase (how far through
// its stroke), amplitude, bend (turning) and flap (fin sculling). Schools
// write them into an instanced attribute; a single fish on a spear or a line
// has its own uniform. Swimmer turns what the fish is doing — its speed, how
// fast it is turning, whether it is panicking — into those four numbers.
//
// The swim styles are the real ones, roughly: a tuna is thunniform — a rigid
// body and a tail that does all the work; a wrasse rows with its pectorals and
// hardly bends at all; a shark sweeps its whole body, head included; many reef
// fish swim in bursts and coast between them; a flounder ripples the fringe of
// fins round its edge.

import * as THREE from 'three';

export const BODY_LENGTH = 2.5;       // normalised model length; scale is metres / this

// ── swim styles ──────────────────────────────────────────────────────────────
// env     how far forward the wave reaches: higher is only the tail
// wave    wavenumber down the body; lower is a longer, stiffer wave
// head    how much the head swings too (sharks, flatfish)
// rate    stroke rate at cruising speed, radians of phase a second
// amp     tail amplitude at cruising speed, in model units
// turn    how much the body curves per radian/second of turning
// agility how quickly it can change its velocity
// glide   how often it coasts between bursts (0 never)
// flap    pectoral sculling strength, and flapRate its rate against the stroke
// ripple  how much the median fins undulate
// wing    1 if the pectorals are wings that lift, not paddles that row
// burst   top speed in a fright, as a multiple of cruising speed
// scales  [rows per model unit, contrast]; sheen: silvery flash at glancing angles
const DEFAULT = {
  env: 1.7, wave: 2.9, head: 0.0, rate: 8.5, amp: 0.40, turn: 0.45, agility: 2.0,
  glide: 0.15, flap: 0.3, flapRate: 1.3, ripple: 0.012, wing: 0, burst: 3.2,
  scales: [15, 0.4], sheen: 0.14, roughness: 0.62, finGlow: 0.18,
};

export const STYLES = {
  // Damselfish: pectoral sculling in place, quick tail bursts to dart.
  chromis:  { rate: 10, amp: 0.36, agility: 3.4, glide: 0.1, flap: 0.8, flapRate: 1.6, scales: [12, 0.48] },
  // Surgeonfish are labriform: they row with their pectorals and keep the
  // disc of the body nearly still, and coast a lot.
  tang:     { env: 2.3, rate: 6.5, amp: 0.26, agility: 2.4, glide: 0.35, flap: 1.0, flapRate: 1.1, scales: [24, 0.13] },
  bluetang: { env: 2.3, rate: 6.5, amp: 0.26, agility: 2.4, glide: 0.35, flap: 1.0, flapRate: 1.1, scales: [24, 0.13] },
  // Wrasses are the textbook pectoral swimmers: stiff body, flapping fins.
  wrasse:   { env: 2.6, rate: 7, amp: 0.22, agility: 3.0, glide: 0.2, flap: 1.1, flapRate: 1.4, scales: [13, 0.44] },
  // Silversides: a tiny fast tail and a mirror of a flank.
  silver:   { rate: 12, amp: 0.36, agility: 3.6, glide: 0.1, flap: 0.2, scales: [16, 0.26], sheen: 0.45, roughness: 0.45 },
  snapper:  { rate: 7.5, amp: 0.36, agility: 1.9, glide: 0.3, flap: 0.45, scales: [14, 0.44], sheen: 0.2 },
  porgy:    { rate: 7, amp: 0.34, agility: 1.9, glide: 0.35, flap: 0.6, scales: [13, 0.48], sheen: 0.3, roughness: 0.52 },
  // Flatfish: an up-and-down wave through the whole flat body, and the fringe
  // of fins round the edge rippling — which is most of how a flounder moves.
  flounder: { env: 1.05, wave: 4.5, head: 0.12, rate: 4.5, amp: 0.2, agility: 1.3, glide: 0.8, flap: 0.1,
              ripple: 0.09, burst: 3.6, scales: [20, 0.18] },
  // King mackerel: carangiform, fast, the rear third doing the work.
  mackerel: { env: 2.7, wave: 2.2, rate: 9.5, amp: 0.26, agility: 1.6, glide: 0.05, flap: 0.05,
              burst: 3.0, scales: [26, 0.15], sheen: 0.4, roughness: 0.45 },
  // Thunniform: a rigid torpedo, a narrow tail beating fast, wings held out.
  tuna:     { env: 3.6, wave: 1.7, rate: 8, amp: 0.2, turn: 0.3, agility: 0.9, glide: 0, flap: 0.04,
              wing: 1, burst: 2.4, scales: [30, 0.11], sheen: 0.35, roughness: 0.45 },
  // Barracuda hang almost motionless and then go: long glides, a few strokes.
  barracuda:{ env: 1.5, wave: 3.2, rate: 3.5, amp: 0.2, agility: 1.5, glide: 0.7, flap: 0.3,
              burst: 4.0, scales: [18, 0.31], sheen: 0.3, roughness: 0.5 },
  // Grouper: heavy, slow, sculling to hold station by its hole.
  grouper:  { env: 1.6, rate: 3.4, amp: 0.22, agility: 1.1, glide: 0.6, flap: 0.8, flapRate: 0.9,
              burst: 2.6, scales: [22, 0.26] },
  mahi:     { env: 2.2, rate: 7.5, amp: 0.3, agility: 1.9, glide: 0.1, flap: 0.1, burst: 3.0,
              scales: [28, 0.13], sheen: 0.3, roughness: 0.5 },
  // Sharks: the whole body sweeps, head too, long slow strokes; pectoral wings.
  blacktip: { env: 1.2, wave: 2.4, head: 0.12, rate: 3.5, amp: 0.26, turn: 0.35, agility: 0.8, glide: 0.25,
              flap: 0.05, wing: 1, burst: 2.4, scales: [0, 0.0], sheen: 0.12, roughness: 0.55, finGlow: 0.05 },
  // A great white: heavy and stiff-bodied, long slow sweeps of the tail, and
  // a steady cruise — it cannot stop, it breathes by swimming.
  greatwhite: { env: 1.5, wave: 2.1, head: 0.08, rate: 2.4, amp: 0.2, turn: 0.28, agility: 0.45, glide: 0.2,
                flap: 0.03, wing: 1, burst: 2.2, scales: [0, 0], sheen: 0.1, roughness: 0.5, finGlow: 0.03 },
  // The whale's flukes beat up and down, slowly; the long flippers lift and
  // droop slower still, steering more than swimming.
  whale:    { env: 1.9, wave: 2.0, rate: 1.3, amp: 0.1, turn: 0.2, agility: 0.4, glide: 0, flap: 0.25, flapRate: 0.5,
              wing: 1, burst: 1.5, scales: [0, 0.0], sheen: 0.1, roughness: 0.5, finGlow: 0 },
};

export const styleFor = key => ({ ...DEFAULT, ...(STYLES[key] || {}) });

// ── the material ─────────────────────────────────────────────────────────────
/**
 * The swim material for one species.
 *
 * @param axis    which way the body bends: 'x' side to side for a fish, 'y' up
 *                and down for a flatfish (which lies on its side) or a whale
 * @param style   a styleFor() result
 * @param single  a lone mesh rather than a school: the four swim numbers come
 *                from `material.userData.swim` (a Vector4) instead of an
 *                instanced attribute
 */
export function swimMaterial({ axis = 'x', style = styleFor(), single = false, skin = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: style.roughness, metalness: 0,
    side: THREE.DoubleSide, flatShading: false,
  });
  if (skin) applySkin(mat, skin);
  const other = axis === 'x' ? 'y' : 'x';     // the flank's other in-plane axis
  mat.userData.time = { value: 0 };
  mat.userData.swim = new THREE.Vector4(0, style.amp, 0, style.flap);
  const u = {
    uTime: mat.userData.time,
    uSwim: { value: mat.userData.swim },
    uShape: { value: new THREE.Vector4(style.env, style.wave, style.head, style.flapRate) },
    uFins: { value: new THREE.Vector3(style.ripple, style.wing, style.finGlow) },
    // A textured body has its scales painted and in its normal map; the
    // procedural ones are for the untextured fallback body only.
    uScales: { value: new THREE.Vector2(style.scales[0], skin?.map ? 0 : style.scales[1]) },
    uSheen: { value: style.sheen },
  };
  // Live, for tuning from the console: game.fish.groups[i].material.userData.uniforms
  mat.userData.uniforms = u;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec4 uShape;   // env, wave, head, flap rate
        uniform vec3 uFins;    // ripple, wing, fin glow
        attribute float aPart; // part + flex
        ${single ? 'uniform vec4 uSwim;' : 'attribute vec4 aSwim;'}
        varying float vPart;
        varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 sw = ${single ? 'uSwim' : 'aSwim'};   // phase, amplitude, bend, flap
        float part = floor(aPart + 0.001);
        float flex = aPart - part;
        vPart = aPart;
        vObj = transformed;
        float zn = transformed.z / ${(BODY_LENGTH / 2).toFixed(4)};   // +1 nose .. -1 tail
        float lat0 = transformed.${axis};

        // The travelling wave: pinned at the nose, growing toward the tail.
        float env = clamp((1.0 - zn) * 0.5, 0.0, 1.0);
        env = uShape.z + (1.0 - uShape.z) * pow(env, uShape.x);
        float beat = sin(zn * uShape.y + sw.x);
        float lat = beat * env * sw.y;
        // Into a turn: a C, nose and tail both toward the inside.
        lat += sw.z * (zn * zn - 0.33) * 0.55;

        if (part > 1.5 && part < 2.5) {
          // The tail fin lags the body, so it flicks through the stroke.
          lat += flex * sin(zn * uShape.y + sw.x - 0.9) * sw.y * 0.5;
        } else if (part > 0.5 && part < 1.5) {
          // Dorsal and anal fins ripple along their length.
          lat += flex * uFins.x * sin(zn * 10.0 + sw.x * 1.7) * (0.4 + sw.y * 2.0);
        } else if (part > 2.5 && part < 3.5) {
          // Paired fins: paddles row out and back; wings lift and droop.
          float fl = flex * sw.w * 0.16 * sin(sw.x * uShape.w);
          lat += (1.0 - uFins.y) * sign(lat0) * fl;
          transformed.y += uFins.y * fl * 0.5;
        }
        transformed.${axis} += lat;
        // The tail leans into the stroke as well as sweeping across it, which
        // is what stops it looking like a flag on a pole.
        transformed.z += abs(beat) * env * env * -0.15 * sw.y;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uFins;
        uniform vec2 uScales;
        uniform float uSheen;
        varying float vPart;
        varying vec3 vObj;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fPart = floor(vPart + 0.001);
        float fFlex = vPart - fPart;
        float isBody = 1.0 - step(0.5, fPart);
        float isEye = step(3.5, fPart);
        float isFin = (1.0 - isBody) * (1.0 - isEye);
        // Scales: rows of overlapping arcs on the flank, each a little brighter
        // at its free edge. Faded out where they would be finer than a pixel,
        // so a fish at range is smooth rather than shimmering.
        if (uScales.y > 0.0 && isBody > 0.5) {
          // Each scale is anchored toward the head (+z) and its free, rounded
          // edge points to the tail — so the arc is centred on the cell's head
          // side, with a shadow just behind the edge where it overlaps the next.
          vec2 q = vec2(vObj.z, vObj.${other} * 1.35) * uScales.x;
          q.y += 0.5 * mod(floor(q.x), 2.0);
          vec2 f = fract(q);
          float d = length(vec2(1.0 - f.x, (f.y - 0.5) * 1.15));
          float lit = smoothstep(0.25, 0.78, d) * (1.0 - smoothstep(0.78, 0.84, d));
          float shadow = smoothstep(0.84, 0.9, d);
          float grain = fwidth(q.x) + fwidth(q.y);
          float fade = uScales.y * (1.0 - smoothstep(0.25, 0.7, grain));
          diffuseColor.rgb *= 1.0 + fade * (0.35 * lit - 0.55 * shadow);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // A wet, glassy eye; fins a little softer than the flank.
        roughnessFactor = mix(roughnessFactor, 0.08, isEye);
        roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.15), isFin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Reef colour is the first thing the water takes. A little self-colour
        // keeps a yellow tang yellow at the distance you actually see it from.
        // \`.rgb\` because a glTF COLOR_0 with alpha makes vColor a vec4.
        // (diffuseColor by now is texture × vertex colour × tint.)
        // Not the eyes: an eye does not glow, it reflects — the gloss does that.
        totalEmissiveRadiance += diffuseColor.rgb * 0.38 * (1.0 - 0.8 * isEye);
        // Fins are thin: light comes through them, brightest at the edge.
        totalEmissiveRadiance += diffuseColor.rgb * uFins.z * isFin * (0.4 + fFlex);
        // The silvery flash of a flank turned edge-on to you.
        vec3 vDir = normalize(vViewPosition);
        float glance = pow(1.0 - abs(dot(normal, vDir)), 3.0);
        totalEmissiveRadiance += vec3(0.75, 0.85, 0.95) * uSheen * glance * isBody;`);
  };
  mat.customProgramCacheKey = () => `swim-${axis}-${single ? 1 : 0}`;
  return mat;
}

/**
 * The painted skin from the .glb — the species' colour texture and normal
 * map, which tools/build_fish.py paints into one atlas per species — put on a
 * swim material.
 */
export function applySkin(mat, skin) {
  if (skin.map) { mat.map = skin.map; mat.map.anisotropy = 4; }
  if (skin.normalMap) {
    mat.normalMap = skin.normalMap;
    mat.normalScale.set(0.9, 0.9);
  }
  if (skin.roughness != null) mat.roughness = skin.roughness;
  mat.needsUpdate = true;
  return mat;
}

/** The skin of a mesh loaded from the .glb, for applySkin(). */
export const skinOf = mesh => mesh?.material ? {
  map: mesh.material.map || null, normalMap: mesh.material.normalMap || null,
  roughness: mesh.material.roughness,
} : null;

/**
 * Give a body the part tags the shader reads. tools/build_fish.py stores them
 * in the alpha of the vertex colour (part + flex, over 5); the colour itself
 * goes back to three components so it is not taken for transparency. A body
 * without them (the procedural fallback) is all body.
 */
export function tagParts(geo) {
  const n = geo.attributes.position.count;
  const part = new Float32Array(n);
  const col = geo.attributes.color;
  if (col && col.itemSize === 4) {
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      part[i] = col.getW(i) * 5;
      rgb[i * 3] = col.getX(i); rgb[i * 3 + 1] = col.getY(i); rgb[i * 3 + 2] = col.getZ(i);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  }
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return geo;
}

// ── the driver ───────────────────────────────────────────────────────────────
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * One fish's stroke. Tell it each frame how fast the fish is going against
 * its cruising speed, how fast it is turning, and how hard it is trying
 * (panic, a fight on the line); it keeps phase, amplitude, bend and flap.
 *
 * Beat rate rises with speed and falls with size — a big fish of the same
 * species beats slower — and fish that coast do: between bursts the tail
 * stops and the fish glides, which is the single biggest difference between
 * a swimming fish and a wiggling one.
 */
export class Swimmer {
  /**
   * @param style   styleFor(key)
   * @param size    this fish's length over its species' usual length
   */
  constructor(style, size = 1) {
    this.st = style;
    this.sizeRate = Math.pow(1 / Math.max(0.3, size), 0.3);
    this.phase = Math.random() * Math.PI * 2;
    this.amp = style.amp;
    this.bend = 0;
    this.flap = style.flap;
    this.coasting = false;
    this.coastT = rand(0, 2);
    this.kick = 0;                 // a C-start: a hard bend held for an instant
  }

  /**
   * @param speed   speed over cruising speed (1 = cruising)
   * @param yawRate radians/second of turning, + toward the fish's +X
   * @param effort  0 calm .. 1+ panicking or fighting
   */
  step(dt, speed, yawRate, effort = 0) {
    const st = this.st;
    if (st.glide > 0) {
      this.coastT -= dt;
      if (this.coastT <= 0) {
        this.coasting = !this.coasting && effort < 0.1 && speed < 1.3 && Math.random() < st.glide;
        this.coastT = this.coasting ? rand(0.5, 1.6) : rand(1.0, 3.0);
      }
    }
    const coast = this.coasting && effort < 0.1;
    const drive = Math.min(2.2, speed) + effort * 1.5;
    this.phase += st.rate * this.sizeRate * (coast ? 0.25 : 0.4 + 0.75 * drive) * dt;
    const amp = st.amp * (coast ? 0.1 : clamp(0.3 + 0.6 * drive, 0.25, 1.9));
    this.amp += (amp - this.amp) * Math.min(1, dt * 5);
    this.kick *= Math.exp(-dt * 9);
    const bend = clamp(yawRate * st.turn, -0.55, 0.55) + this.kick;
    this.bend += (bend - this.bend) * Math.min(1, dt * 10);
    const flap = st.flap * (coast ? 0.6 : 0.3 + 0.7 * clamp(1.2 - speed, 0, 1)) + effort * 0.4 * st.flap;
    this.flap += (flap - this.flap) * Math.min(1, dt * 4);
    return this;
  }

  /** The C-start of a fright: the body snaps into a C away from the threat. */
  startle(side) { this.kick = 0.9 * Math.sign(side || 1); this.coasting = false; this.coastT = 2; }

  write(arr, i) {
    arr[i] = this.phase; arr[i + 1] = this.amp; arr[i + 2] = this.bend; arr[i + 3] = this.flap;
  }

  writeVec(v) { return v.set(this.phase, this.amp, this.bend, this.flap); }
}
