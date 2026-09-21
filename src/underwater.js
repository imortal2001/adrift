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
