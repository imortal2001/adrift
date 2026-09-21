// ── Ocean ────────────────────────────────────────────────────────────────────
// One wave definition, two consumers: the GPU displaces the mesh with it, and
// the CPU samples the exact same sum so the raft, the player and every piece of
// floating debris ride the swell you actually see.

import * as THREE from 'three';

const TAU = Math.PI * 2;

// dir is normalised at build time. len = crest-to-crest metres, speed = m/s-ish.
const WAVES = [
  { dir: [ 1.00,  0.32], amp: 0.40, len: 27.0, speed: 1.00 },
  { dir: [-0.62,  0.88], amp: 0.24, len: 14.5, speed: 1.30 },
  { dir: [ 0.88, -0.52], amp: 0.13, len: 7.80, speed: 1.70 },
  { dir: [-0.24, -0.98], amp: 0.06, len: 4.10, speed: 2.15 },
].map(w => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  const k = TAU / w.len;
  return { dx: w.dir[0] / l, dz: w.dir[1] / l, amp: w.amp, k, w: w.speed * k };
});

export const WAVE_AMPLITUDE = WAVES.reduce((s, w) => s + w.amp, 0);

/** Surface height at world (x,z) and time t. */
export function waveHeight(x, z, t) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.k - t * w.w);
  }
  return h;
}

/** Analytic surface normal — same derivative the fragment shader uses. */
export function waveNormal(x, z, t, out = new THREE.Vector3()) {
  let dx = 0, dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const c = w.amp * w.k * Math.cos((w.dx * x + w.dz * z) * w.k - t * w.w);
    dx += c * w.dx;
    dz += c * w.dz;
  }
  return out.set(-dx, 1, -dz).normalize();
}

// The identical sum, compiled into GLSL from the table above so the two can
// never drift apart.
const WAVE_GLSL = /* glsl */`
struct Wave { vec2 dir; float amp; float k; float w; };
const int WAVE_N = ${WAVES.length};
Wave waves[WAVE_N] = Wave[WAVE_N](
${WAVES.map(w =>
  `  Wave(vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}), ${w.amp.toFixed(6)}, ${w.k.toFixed(6)}, ${w.w.toFixed(6)})`
).join(',\n')}
);
float waveHeight(vec2 p, float t){
  float h = 0.0;
  for(int i = 0; i < WAVE_N; i++){
    Wave wv = waves[i];
    h += wv.amp * sin(dot(wv.dir, p) * wv.k - t * wv.w);
  }
  return h;
}
vec3 waveNormal(vec2 p, float t){
  vec2 d = vec2(0.0);
  for(int i = 0; i < WAVE_N; i++){
    Wave wv = waves[i];
    float c = wv.amp * wv.k * cos(dot(wv.dir, p) * wv.k - t * wv.w);
    d += c * wv.dir;
  }
  return normalize(vec3(-d.x, 1.0, -d.y));
}`;

const vert = /* glsl */`
uniform float uTime;
varying vec3 vWorld;
varying float vHeight;
${WAVE_GLSL}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vHeight = waveHeight(wp.xz, uTime);
  wp.y += vHeight;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */`
uniform float uTime, uFogDensity, uNight;
uniform float uUnderwater, uUnderDensity;
uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uDeep, uShallow, uFog, uUnderFog;
varying vec3 vWorld;
varying float vHeight;
${WAVE_GLSL}
void main(){
  vec3 N = waveNormal(vWorld.xz, uTime);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // Soften the normal with distance or the horizon turns into aliased confetti.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), clamp(dist / 160.0, 0.0, 0.92)));

  // ── seen from underneath ──
  // Without this the surface is invisible from below and deep water reads as
  // empty void. Away from vertical the underside mirrors the water; looking
  // steeply up you see out through Snell's window.
  if (dot(N, V) < 0.0) {
    N = -N;
    // V runs fragment → camera, so a surface overhead gives V.y < 0: how
    // steeply we are looking up is -V.y.
    float upness = clamp(-V.y, 0.0, 1.0);
    float window = smoothstep(0.22, 0.88, upness);
    vec3 outside = mix(uSkyHorizon, uSkyTop, upness) * (1.0 - uNight * 0.7);
    vec3 mirrored = mix(uDeep, uShallow, 0.55);
    vec3 col = mix(mirrored, outside, window);
    // The sun, smeared across the window.
    float sunAlign = max(dot(-V, uSunDir), 0.0);
    col += uSunColor * pow(sunAlign, 16.0) * 0.7 * window;
    col += uSunColor * pow(sunAlign, 3.0) * 0.06 * window;
    // Fog the underside with the water we are actually standing in. Using the
    // air fog here made the whole ceiling fade to near-black a few metres out,
    // which is what the water column looked like from below: a lid, not a
    // surface.
    float dens = mix(uFogDensity * 3.0, uUnderDensity, uUnderwater);
    vec3 into = mix(uDeep * 0.75, uUnderFog, uUnderwater);
    float f = 1.0 - exp(-pow(dist * dens, 2.0));
    gl_FragColor = vec4(mix(col, into, clamp(f, 0.0, 1.0)), 1.0);
    return;
  }

  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);

  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));

  float crest = clamp(vHeight / ${WAVE_AMPLITUDE.toFixed(3)} * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, crest * crest);

  // Light bleeding through the thin water at a wave crest.
  float through = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  body += uShallow * through * smoothstep(0.45, 1.0, crest) * 0.55;

  vec3 col = mix(body, sky, fres);

  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 340.0) * 2.6;
  col += uSunColor * pow(max(dot(N, H), 0.0), 22.0) * 0.06;

  float foam = smoothstep(0.80, 0.99, crest) * 0.5;
  col = mix(col, vec3(0.86, 0.94, 0.98) * (1.0 - uNight * 0.75), foam);

  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.2));
  col = mix(col, uFog, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Ocean {
  constructor(scene) {
    // Dense near the camera, and re-centred every frame so it reads as endless.
    const geo = new THREE.PlaneGeometry(900, 900, 300, 300);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime:       { value: 0 },
      uFogDensity: { value: 0.0042 },
      uNight:      { value: 0 },
      uSunDir:     { value: new THREE.Vector3(0.3, 0.6, 0.4) },
      uSunColor:   { value: new THREE.Color(1, 0.96, 0.86) },
      uSkyTop:     { value: new THREE.Color(0x2f7fb5) },
      uSkyHorizon: { value: new THREE.Color(0xbfd9e8) },
      uDeep:       { value: new THREE.Color(0x05222f) },
      uShallow:    { value: new THREE.Color(0x1d7d91) },
      uFog:        { value: new THREE.Color(0xbfd9e8) },
      // Set by src/underwater.js while the camera is under the surface.
      uUnderwater:  { value: 0 },
      uUnderDensity:{ value: 0.045 },
      uUnderFog:    { value: new THREE.Color(0x11536b) },
    };

    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.DoubleSide,        // the underside is shaded separately
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(time, camPos) {
    this.uniforms.uTime.value = time;
    // Snap to the vertex spacing so vertices don't crawl as we follow the camera.
    const step = 900 / 300;
    this.mesh.position.x = Math.round(camPos.x / step) * step;
    this.mesh.position.z = Math.round(camPos.z / step) * step;
  }
}
