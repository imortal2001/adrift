// ── Ground detail ────────────────────────────────────────────────────────────
// The land's colour comes from its vertices — metres apart — so up close it
// was flat paint. This adds what a vertex cannot carry: grain at a few
// centimetres (pebbles, grass tufts, grit) and blotches at a few metres,
// sampled in world space so there are no UVs to lay out, and lit as relief as
// well as colour. On steep ground it is sampled from the side (triplanar), so
// a cliff face gets strata rather than stretched smears.
//
// Shared by the terrain and the rocks, so a boulder sits in the ground it
// came out of.

import * as THREE from 'three';

let tex = null;
function detailTexture() {
  if (tex) return tex;
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  // Tileable value noise: the lattice wraps at the period.
  const lattice = (p, seed) => {
    const g = new Float32Array(p * p);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; g[i] = s / 4294967296; }
    return g;
  };
  const octave = (x, y, p, g) => {
    const fx = x * p / N, fy = y * p / N;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    const at = (i, j) => g[((j % p + p) % p) * p + ((i % p + p) % p)];
    return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
  };
  const periods = [8, 16, 32, 64, 128, 256];
  const grids = periods.map((p, i) => lattice(p, 17 + i * 31));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = periods.map((p, i) => octave(x, y, p, grids[i]));
      const fine = o[3] * 0.25 + o[4] * 0.4 + o[5] * 0.35;          // grit
      const mid = o[0] * 0.5 + o[1] * 0.3 + o[2] * 0.2;              // blotches
      const ridge = 1 - Math.abs(o[2] * 2 - 1);                      // cracks
      const i = (y * N + x) * 4;
      data[i] = fine * 255;
      data[i + 1] = mid * 255;
      data[i + 2] = Math.pow(ridge, 3) * 255;
      data[i + 3] = 255;
    }
  }
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Add world-space detail to a MeshStandardMaterial. `strength` scales the
 * colour variation, `bump` the relief; `rock` biases it toward cracks.
 */
export function applyGroundDetail(material, { strength = 1, bump = 1, rock = 0 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uDetail = { value: detailTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDetailPos;
        varying vec3 vDetailNrm;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 dp = vec4(transformed, 1.0);
          vec3 dn = objectNormal;
          #ifdef USE_INSTANCING
            dp = instanceMatrix * dp;
            dn = mat3(instanceMatrix) * dn;
          #endif
          vDetailPos = (modelMatrix * dp).xyz;
          vDetailNrm = normalize(mat3(modelMatrix) * dn);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail;
        varying vec3 vDetailPos;
        varying vec3 vDetailNrm;
        float gDetailH;
        // Triplanar: blend the three axis projections by how much the surface
        // faces each, so steep faces are not stretched.
        vec4 detailAt(float scale) {
          vec3 w = pow(abs(normalize(vDetailNrm)), vec3(4.0));
          w /= (w.x + w.y + w.z);
          vec4 a = texture2D(uDetail, vDetailPos.zy / scale);
          vec4 b = texture2D(uDetail, vDetailPos.xz / scale);
          vec4 c = texture2D(uDetail, vDetailPos.xy / scale);
          return a * w.x + b * w.y + c * w.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec4 near = detailAt(2.3);
          vec4 far = detailAt(19.0);
          float steep = 1.0 - abs(normalize(vDetailNrm).y);
          float rocky = clamp(${rock.toFixed(2)} + smoothstep(0.35, 0.7, steep), 0.0, 1.0);
          float grit = near.r;
          float blot = far.g;
          float cracks = mix(near.b, far.b, 0.5) * rocky;
          // Fade the fine grain with distance: past ~60 m it would only shimmer.
          float fade = 1.0 - smoothstep(40.0, 110.0, length(vDetailPos - cameraPosition));
          float v = mix(1.0, 0.72 + grit * 0.56, fade) * (0.84 + blot * 0.32) * (1.0 - cracks * 0.55);
          diffuseColor.rgb *= mix(1.0, v, ${strength.toFixed(2)});
          gDetailH = (grit * fade * 0.6 + blot * 0.4 - cracks * 0.8);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Relief from the same detail: three's bump-map perturbation, fed
          // the detail height instead of a texture it would need UVs for.
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dBx = dFdx(gDetailH), dBy = dFdy(gDetailH);
          vec3 R1 = cross(dpdy, normal), R2 = cross(normal, dpdx);
          float fDet = dot(dpdx, R1) * faceDirection;
          vec3 grad = sign(fDet) * (dBx * R1 + dBy * R2);
          normal = normalize(abs(fDet) * normal - grad * ${(0.035 * bump).toFixed(4)});
        }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `detail-${strength}-${bump}-${rock}-${key ? key() : ''}`;
  return material;
}
