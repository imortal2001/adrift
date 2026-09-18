// ── Sky & time of day ────────────────────────────────────────────────────────
// Drives one sun, one sky dome and the palette that the ocean shader and the
// fog both read from, so dusk changes the whole world at once.

import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  p.z = p.w;               // pin to the far plane
  gl_Position = p;
}`;

const frag = /* glsl */`
uniform vec3 uTop, uHorizon, uSunColor, uSunDir, uWaterColor;
uniform float uNight, uUnderwater;
varying vec3 vDir;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);

  // Submerged: the backdrop is the water column — lit from above, black below.
  if (uUnderwater > 0.5) {
    vec3 w = uWaterColor * (0.22 + 0.78 * smoothstep(-0.65, 1.0, up));
    gl_FragColor = vec4(w, 1.0);
    return;
  }

  vec3 col = mix(uHorizon, uTop, pow(clamp(up, 0.0, 1.0), 0.42));
  col = mix(col, uHorizon * 0.62, clamp(-up * 3.0, 0.0, 1.0));   // below the horizon

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 900.0) * 14.0;                       // disc
  col += uSunColor * pow(sd, 7.0) * 0.35;                         // bloom
  col += uSunColor * pow(sd, 1.6) * 0.10 * clamp(1.0 - up, 0.0, 1.0);

  if (uNight > 0.01 && up > -0.02) {
    vec2 cell = floor(d.xz / max(abs(d.y), 0.08) * 46.0);
    float s = hash(cell);
    float star = smoothstep(0.9975, 1.0, s) * (0.55 + 0.45 * sin(s * 90.0));
    col += vec3(0.85, 0.9, 1.0) * star * uNight * clamp(up * 3.0, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Keyframes around the clock. `t` is 0..1 across a full day, 0 = midnight.
const KEYS = [
  { t: 0.00, top: 0x030913, hor: 0x0a1526, sun: 0x22304d, night: 1.00, amb: 0.10 },
  { t: 0.21, top: 0x1d3050, hor: 0x5d4a52, sun: 0x8f6a58, night: 0.60, amb: 0.22 },
  { t: 0.27, top: 0x3c6d9e, hor: 0xe8a172, sun: 0xffb27a, night: 0.10, amb: 0.45 },
  { t: 0.35, top: 0x2f7fb5, hor: 0xc8dcea, sun: 0xfff1d6, night: 0.00, amb: 0.62 },
  { t: 0.50, top: 0x2472b0, hor: 0xbfd9e8, sun: 0xfffaf0, night: 0.00, amb: 0.72 },
  { t: 0.68, top: 0x2f7fb5, hor: 0xd3dfe6, sun: 0xfff0d2, night: 0.00, amb: 0.62 },
  { t: 0.76, top: 0x44639b, hor: 0xf0a06a, sun: 0xff9d5c, night: 0.06, amb: 0.44 },
  { t: 0.82, top: 0x24365e, hor: 0x7c4f57, sun: 0x9c6250, night: 0.55, amb: 0.22 },
  { t: 0.92, top: 0x070d1a, hor: 0x0c1728, sun: 0x2a3855, night: 1.00, amb: 0.11 },
  { t: 1.00, top: 0x030913, hor: 0x0a1526, sun: 0x22304d, night: 1.00, amb: 0.10 },
];

const cA = new THREE.Color(), cB = new THREE.Color();

function sample(t) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  return {
    top:   cA.setHex(a.top).lerp(cB.setHex(b.top), k).clone(),
    hor:   cA.setHex(a.hor).lerp(cB.setHex(b.hor), k).clone(),
    sun:   cA.setHex(a.sun).lerp(cB.setHex(b.sun), k).clone(),
    night: THREE.MathUtils.lerp(a.night, b.night, k),
    amb:   THREE.MathUtils.lerp(a.amb, b.amb, k),
  };
}

export const DAY_SECONDS = 720;   // 12 real minutes per in-game day

export class Sky {
  constructor(scene, ocean) {
    this.scene = scene;
    this.ocean = ocean;

    this.uniforms = {
      uTop:       { value: new THREE.Color(0x2f7fb5) },
      uHorizon:   { value: new THREE.Color(0xbfd9e8) },
      uSunColor:  { value: new THREE.Color(0xfff1d6) },
      uSunDir:    { value: new THREE.Vector3(0, 1, 0) },
      uNight:     { value: 0 },
      uUnderwater:{ value: 0 },
      uWaterColor:{ value: new THREE.Color(0x11536b) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
        side: THREE.BackSide, depthWrite: false,
      })
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -2;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.near = 1; c.far = 90; c.left = -26; c.right = 26; c.top = 26; c.bottom = -26;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd9e8, 0x0d3b4a, 0.7);
    scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x9fc2e8, 0.16);
    scene.add(this.moon);

    scene.fog = new THREE.FogExp2(0xbfd9e8, 0.0016);

    this.time = DAY_SECONDS * 0.42;   // wake up mid-morning, in good light
    this.day = 1;
    this.held = false;   // admin tools can stop the clock without stopping the game
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
  }

  get dayFraction() { return (this.time / DAY_SECONDS) % 1; }

  /** "06:42" */
  get clock() {
    const m = this.dayFraction * 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  }

  get isNight() { return this.night > 0.5; }

  /** Minutes since midnight, 0..1440. */
  get minutes() { return this.dayFraction * 1440; }

  /** Jump to a time of day. Does not touch the day counter. */
  setMinutes(m) {
    const wrapped = ((m % 1440) + 1440) % 1440;
    this.time = (wrapped / 1440) * DAY_SECONDS;
  }

  update(dt, focus) {
    if (!this.held) {
      this.time += dt;
      if (this.time >= DAY_SECONDS) { this.time -= DAY_SECONDS; this.day++; }
    }

    const f = this.dayFraction;
    const p = sample(f);

    // Sun rises in the east (+x) at 06:00 and sets in the west at 18:00.
    const ang = (f - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.34).normalize();
    this.night = p.night;

    this.uniforms.uTop.value.copy(p.top);
    this.uniforms.uHorizon.value.copy(p.hor);
    this.uniforms.uSunColor.value.copy(p.sun);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uNight.value = p.night;

    const o = this.ocean.uniforms;
    o.uSkyTop.value.copy(p.top);
    o.uSkyHorizon.value.copy(p.hor);
    o.uSunColor.value.copy(p.sun);
    o.uSunDir.value.copy(this.sunDir);
    o.uNight.value = p.night;
    o.uDeep.value.setHex(0x05222f).multiplyScalar(0.35 + 0.65 * (1 - p.night));
    o.uShallow.value.setHex(0x1d7d91).multiplyScalar(0.28 + 0.72 * (1 - p.night));
    o.uFog.value.copy(p.hor);
    this.scene.fog.color.copy(p.hor);

    const above = Math.max(this.sunDir.y, 0);
    this.sun.color.copy(p.sun);
    this.sun.intensity = 2.6 * Math.pow(above, 0.45);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 45);
    this.sun.target.position.copy(focus);

    this.moon.position.copy(focus).add(new THREE.Vector3(-this.sunDir.x, 0.9, -this.sunDir.z).multiplyScalar(40));
    this.moon.intensity = 0.22 * p.night;

    this.hemi.intensity = p.amb;
    this.hemi.color.copy(p.hor);
    this.scene.fog.density = 0.0016 + 0.0012 * p.night;
  }
}
