// ── Underwater ambience ──────────────────────────────────────────────────────
// What makes going under feel like going under: light and colour falling away
// with depth, and motes of marine snow drifting through the beam of the sun.
//
// The particle field is a fixed cloud that wraps around the camera, so a few
// hundred points read as an endless volume.

import * as THREE from 'three';

const WHITE = new THREE.Color(0xffffff);

const COUNT = 900;
const BOX = 26;                 // metres; the cloud wraps at half this
const FALL = 0.12;              // m/s, slow sink
const DARK_DEPTH = 38;          // by here, most light is gone

// Shared clock + reach for the caustics, so every material that takes them is
// on the same one.
export const CAUSTICS = {
  uTime: { value: 0 },
  uCaustics: { value: 1 },        // faded out at night and killed by cloud
};

/**
 * Sunlight focused through the swell and thrown across whatever is below it.
 * Two crossed sine grids beaten against each other and sharpened — cheaper
 * than a real projection and, at the distances you see the sea bed from, no
 * one can tell the difference.
 *
 * Applies to any MeshStandardMaterial. Only fragments below the waterline and
 * facing roughly upward take it, so the same material can be used on land.
 */
export function applyCaustics(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uCausTime = CAUSTICS.uTime;
    shader.uniforms.uCausAmt = CAUSTICS.uCaustics;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCausPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 causWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          causWP = instanceMatrix * causWP;
        #endif
        vCausPos = (modelMatrix * causWP).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uCausTime;
        uniform float uCausAmt;
        varying vec3 vCausPos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // The light that reaches the bed has come down through the water,
          // and the water takes the red out of it first, then the green:
          // half the red is gone by 15 m, little of the blue. So the reef top
          // at 8 m is warmer than the sand at 18 m beside it, as on a dive —
          // the fog does the same for the light on its way back to the eye.
          float under = max(0.0, -vCausPos.y);
          diffuseColor.rgb *= exp(-vec3(0.036, 0.009, 0.006) * under);
        }
        {
          // Fades out with depth as the swell stops focusing anything, and
          // stops at the waterline so the beach never shimmers.
          float reach = smoothstep(-32.0, -1.0, vCausPos.y) * step(vCausPos.y, 0.0);
          // The surface normal here is derived from the world position. The
          // shader's own normal is not defined this early in the standard
          // fragment chain, and this costs nothing we were not already paying.
          vec3 causN = normalize(cross(dFdx(vCausPos), dFdy(vCausPos)));
          float face = abs(causN.y);
          if (reach * face * uCausAmt > 0.001) {
            // Three sine grids at different angles, beaten together. Where
            // all three crest you get a bright node; the high power turns the
            // broad interference into the narrow web the surface actually
            // throws, rather than soft blobs.
            float t = uCausTime;
            vec2 q = vCausPos.xz;
            float g1 = sin(dot(q, vec2( 1.00,  0.18)) * 2.30 + t * 1.05);
            float g2 = sin(dot(q, vec2(-0.47,  0.88)) * 2.75 - t * 0.81);
            float g3 = sin(dot(q, vec2( 0.62, -0.79)) * 3.45 + t * 1.32);
            float web = pow(clamp((g1 + g2 + g3) / 3.0 * 0.5 + 0.5, 0.0, 1.0), 6.0);
            // A slower, larger pattern under it, so the web drifts across bands
            // of light instead of sitting on flat sand.
            float roll = sin(dot(q, vec2(0.71, 0.70)) * 0.42 - t * 0.31) * 0.5 + 0.5;
            float caus = web * (0.55 + 0.75 * roll) * 2.6;
            diffuseColor.rgb += caus * reach * face * uCausAmt * vec3(0.26, 0.34, 0.36);
          }
        }`);
  };
  // Materials that share a type but not a shader need distinct keys, or three
  // hands the second one the first one's program.
  material.customProgramCacheKey = () => 'caustics:' + material.uuid;
  return material;
}

// ── sun shafts ───────────────────────────────────────────────────────────────
// The swell focuses the sunlight into sheets that plunge down through the
// water and show where there is anything in it to light — the "god rays" of
// every reef photograph. Here, a few dozen long soft quads hung from the
// surface along the sun's direction *after* it bends into the water (Snell:
// steeper than in the air), each turned about its own axis to face you,
// brightest just under the surface and dying away with depth, each swaying
// and flickering on its own as the waves above refocus it. Like the motes,
// they wrap round you, so a few dozen read as an endless sea of them.

const SHAFTS = 40;
const SHAFT_BOX = 46;             // metres; they wrap at half this
const SHAFT_LEN = 34;             // from the surface down

const shaftVert = `
  uniform vec3 uCam;
  uniform vec3 uDir;            // down along the refracted sun
  uniform float uTime;
  attribute vec4 aShaft;        // x, z (box offset), width, phase
  attribute vec2 aCorner;       // across -1..1, along 0..1
  varying vec2 vCorner;
  varying float vPhase;
  varying vec3 vWorld;
  void main() {
    float hb = ${(SHAFT_BOX / 2).toFixed(1)};
    vec2 c = uCam.xz + mod(aShaft.xy - uCam.xz + hb, ${SHAFT_BOX.toFixed(1)}) - hb;
    c += vec2(sin(uTime * 0.21 + aShaft.w * 6.0), cos(uTime * 0.17 + aShaft.w * 4.0)) * 0.8;
    // Wrapped round you at your own depth, then traced back up to the
    // surface it hangs from, so they stand round you wherever you are.
    vec3 top = vec3(c.x, uCam.y, c.y) + uDir * (-uCam.y / uDir.y);
    vec3 p = top + uDir * aCorner.y * ${SHAFT_LEN.toFixed(1)};
    vec3 toCam = normalize(cameraPosition - p);
    vec3 across = normalize(cross(uDir, toCam));
    p += across * aCorner.x * aShaft.z * 0.5;
    vCorner = aCorner;
    vPhase = aShaft.w;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const shaftFrag = `
  uniform float uTime;
  uniform float uStrength;
  uniform float uDensity;       // the water's fog, so they go into the haze with everything else
  uniform vec3 uColor;
  varying vec2 vCorner;
  varying float vPhase;
  varying vec3 vWorld;
  void main() {
    float across = 1.0 - vCorner.x * vCorner.x;
    across *= across;
    // In from the surface, then dying away with depth.
    float along = smoothstep(0.0, 0.06, vCorner.y) * exp(-vCorner.y * 3.2);
    // Refocused as the swell passes over: each brightens and fades on its own.
    float flicker = 0.45 + 0.55 * sin(uTime * (0.55 + vPhase * 0.6) + vPhase * 40.0);
    flicker = max(0.0, flicker);
    float d = distance(vWorld, cameraPosition);
    float near = smoothstep(1.5, 6.0, d);               // not a sheet across your face
    float fog = exp(-uDensity * uDensity * d * d * 0.55);
    float a = across * along * flicker * near * fog * uStrength;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

function makeShafts() {
  const corner = [], shaft = [], index = [];
  const r = () => Math.random();
  for (let i = 0; i < SHAFTS; i++) {
    const x = r() * SHAFT_BOX, z = r() * SHAFT_BOX, w = 0.5 + Math.pow(r(), 2) * 3.2, ph = r();
    for (const [a, b] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { corner.push(a, b); shaft.push(x, z, w, ph); }
    const v = i * 4;
    index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  const geo = new THREE.BufferGeometry();
  // (Positions are made in the shader; this only sizes the draw.)
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SHAFTS * 4 * 3), 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array(corner), 2));
  geo.setAttribute('aShaft', new THREE.BufferAttribute(new Float32Array(shaft), 4));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, -1, 0) },
      uTime: CAUSTICS.uTime, uStrength: { value: 0 }, uDensity: { value: 0.03 },
      uColor: { value: new THREE.Color(0.55, 0.78, 0.82) },
    },
    vertexShader: shaftVert, fragmentShader: shaftFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export class Underwater {
  constructor(scene, ocean) {
    this.ocean = ocean;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xcfeaf6, size: 0.038, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    scene.add(this.motes);

    this.shafts = makeShafts();
    this.shafts.visible = false;
    scene.add(this.shafts);
    this._sun = new THREE.Vector3();

    this.caustics = CAUSTICS;      // the live uniforms, reachable for tuning
    this.fogColor = new THREE.Color();
    this.shallow = new THREE.Color(0x3aa6c4);
    this.deep = new THREE.Color(0x07283c);
  }

  /**
   * @param depth  metres the camera is below the surface (0 when above)
   * @param sky    so the lights can be attenuated for this frame only
   */
  update(dt, camPos, submerged, depth, sky, scene, night) {
    CAUSTICS.uTime.value += dt;
    CAUSTICS.uCaustics.value = 0.85 * (1 - night);
    this.motes.visible = submerged;
    this.shafts.visible = submerged;
    if (!submerged) {
      sky.uniforms.uUnderwater.value = 0;
      this.ocean.uniforms.uUnderwater.value = 0;
      return 1;
    }

    // Positions are world space; wrap each axis into the box centred on the
    // camera. A true modulo, so it still works after a long swim.
    const p = this.motes.geometry.attributes.position;
    const arr = p.array, half = BOX / 2;
    const wrap = (v, c) => c + (((v - c + half) % BOX) + BOX) % BOX - half;
    const cx = camPos.x, cy = camPos.y, cz = camPos.z;
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      arr[j]     = wrap(arr[j], cx);
      arr[j + 1] = wrap(arr[j + 1] - FALL * dt, cy);
      arr[j + 2] = wrap(arr[j + 2], cz);
    }
    p.needsUpdate = true;

    // How much daylight is left at this depth.
    const light = THREE.MathUtils.clamp(1 - depth / DARK_DEPTH, 0.1, 1) * (1 - night * 0.8);

    // Hold the tropical blue through the first few metres instead of sliding
    // straight toward black — the water column should not be darker than the
    // sea bed it is lighting.
    this.fogColor.copy(this.shallow).lerp(this.deep, Math.pow(1 - light, 1.35));
    scene.fog.color.copy(this.fogColor);
    // Clear water up top, closing in as the light goes. The old curve gave
    // about 12m of visibility on the reef, which is why the sea bed read as a
    // grey wall — you could never see enough of it at once for it to be a
    // place. The exponent keeps the deep dark without fogging the shallows.
    scene.fog.density = 0.030 + 0.078 * Math.pow(1 - light, 1.6);

    // Scale this frame's lighting; sky.update() rewrites it from scratch next
    // frame, so there is nothing to restore.
    // Water scatters as well as absorbs, so there is always some fill down
    // there. Straight multiplication crushed the reef to silhouettes.
    sky.sun.intensity *= 0.18 + light * 0.78;
    sky.hemi.intensity *= 0.30 + light * 0.72;
    // Ambient takes the water's colour, but lifted — using the fog colour neat
    // tints every surface down there the same grey as the distance.
    sky.hemi.color.copy(this.fogColor).lerp(WHITE, 0.30);
    this.motes.material.opacity = 0.2 + 0.4 * light;

    // The shafts follow the sun as it comes through the surface, bent
    // steeper by it (sin t = sin i / 1.33), and are only as bright as the
    // sun is high, the sky clear and you near enough the top to see them.
    const sd = sky.sunDir, horiz = Math.hypot(sd.x, sd.z);
    const st = Math.min(0.98, horiz / Math.max(1e-3, Math.hypot(horiz, sd.y)) / 1.33);
    const ct = Math.sqrt(1 - st * st);
    this._sun.set(-sd.x / (horiz || 1) * st, -ct, -sd.z / (horiz || 1) * st);
    const su = this.shafts.material.uniforms;
    su.uDir.value.copy(this._sun);
    su.uCam.value.copy(camPos);
    su.uDensity.value = scene.fog.density;
    su.uStrength.value = 0.16 * Math.max(0, Math.min(1, sd.y * 2.5)) * CAUSTICS.uCaustics.value;

    // The sky dome becomes the water column while we are under it, and the
    // ocean's underside fogs into the same water rather than into air.
    sky.uniforms.uUnderwater.value = 1;
    sky.uniforms.uWaterColor.value.copy(this.fogColor);
    this.ocean.uniforms.uUnderwater.value = 1;
    this.ocean.uniforms.uUnderDensity.value = scene.fog.density;
    this.ocean.uniforms.uUnderFog.value.copy(this.fogColor);

    return light;
  }
}
