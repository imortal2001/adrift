// ── Sky & time of day ────────────────────────────────────────────────────────
// Drives one sun, one sky dome and the palette that the ocean shader and the
// fog both read from, so dusk changes the whole world at once.

import * as THREE from 'three';

/**
 * The light thrown back up off a sunlit deck, as irradiance: what lights the
 * underside of a roof and the shaded side of a wall on the raft (raft.js adds
 * it, by how far a face looks down). The sky's own light from below is the
 * sea's and the land's, far dimmer; under a roof, what is below is planking
 * in the sun. (Set as the sun moves; the gallery keeps this midday-ish one.)
 */
export const DECK_BOUNCE = { value: new THREE.Color(0.3, 0.25, 0.18) };
const DECK_TINT = new THREE.Color(0.95, 0.78, 0.55);   // sun-bleached planking

const vert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  p.z = p.w;               // pin to the far plane
  gl_Position = p;
}`;

const frag = /* glsl */`
uniform vec3 uTop, uHorizon, uSunColor, uSunDir, uWaterColor, uMoonDir;
uniform float uNight, uUnderwater, uTime;
varying vec3 vDir;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Stars: one to a cell of a grid laid round the sky in three dimensions, at a
// point jittered within it, drawn as a round point of light — the first cut
// read the cells of a flat grid off the sky, and every star was a little
// square, and stretched toward the horizon. A few bright ones, many faint, a
// little colour (blue-white to orange), and a twinkle that is strongest low
// down, where the air is thickest.
vec3 stars(vec3 d, float up){
  vec3 acc = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 90.0 : 190.0;
    vec3 p = d * scale, c = floor(p);
    float h = hash3(c + float(layer) * 17.0);
    if (h < (layer == 0 ? 0.93 : 0.82)) continue;
    vec3 at = c + 0.25 + 0.5 * vec3(hash3(c + 1.7), hash3(c + 4.3), hash3(c + 9.1));
    float r = length(p - at);
    float mag = pow(fract(h * 37.0), layer == 0 ? 3.0 : 6.0);
    float size = layer == 0 ? 0.09 + 0.12 * mag : 0.07;
    float point = smoothstep(size, 0.0, r);
    float tw = 1.0 - 0.45 * (1.0 - up) * (0.5 + 0.5 * sin(uTime * (3.0 + h * 9.0) + h * 80.0));
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.65), fract(h * 91.0));
    acc += tint * point * (0.35 + 1.6 * mag) * tw * (layer == 0 ? 1.0 : 0.45);
  }
  return acc;
}

void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);

  // Submerged: the backdrop is the water column — the fog's own colour out
  // to the horizon and above, so the far reef fades into it rather than
  // ending at a line; darker only looking down into the deep. And in the
  // colour space the fogged reef is drawn in: the fog colour is linear, and
  // put out as it was it showed as a navy far darker than the teal the same
  // fog gives the sea bed — a hard band along the edge of the view.
  if (uUnderwater > 0.5) {
    // (Darker only looking steeply down. Darkened from just below the
    // horizon, it was darker than the fogged sea bed in front of it, which
    // is the fog's colour exactly — and where there is no near ground, over
    // the open basin, the far sea bed beyond stood out of it as a pale flat
    // panel with straight edges.)
    vec3 w = uWaterColor * mix(0.6, 1.0, smoothstep(-0.97, -0.6, up));
    gl_FragColor = linearToOutputTexel(vec4(w, 1.0));
    return;
  }

  vec3 col = mix(uHorizon, uTop, pow(clamp(up, 0.0, 1.0), 0.42));
  col = mix(col, uHorizon * 0.62, clamp(-up * 3.0, 0.0, 1.0));   // below the horizon

  // Twilight: when the sun is near the horizon the glow along it is on the
  // sun's side — the opposite horizon goes blue-grey, with the pink band of
  // the Belt of Venus over the Earth's shadow rising from it. (The horizon
  // was one colour all the way round, as orange behind you as in front.)
  vec2 dh = normalize(d.xz + 1e-5), sh = normalize(uSunDir.xz + 1e-5);
  float toward = dot(dh, sh) * 0.5 + 0.5;
  float twi = smoothstep(0.32, 0.02, abs(uSunDir.y)) * (1.0 - uNight * 0.6);
  float low = 1.0 - smoothstep(0.0, 0.45, up);
  col = mix(col, col * mix(vec3(0.55, 0.6, 0.8), vec3(1.15, 1.0, 0.9), toward), twi * low * 0.8);
  col += uSunColor * pow(toward, 3.0) * low * low * twi * 0.35;
  col += vec3(0.32, 0.18, 0.24) * twi * (1.0 - toward) * smoothstep(0.02, 0.1, up) * smoothstep(0.32, 0.12, up)
         * smoothstep(-0.05, 0.02, uSunDir.y) * 0.6;

  // The sun: a disc a degree across — twice true, so it still reads on a
  // screen (drawn as pow(·, 900) it was five degrees, a beach ball on the
  // horizon) —
  // brightest at its middle (limb darkening), in the colour the air has
  // left it — orange-red when it is low; a tight aureole round it; and the
  // broad glow it puts in the sky.
  float sd = dot(d, uSunDir);
  float disc = smoothstep(0.999955, 0.999975, sd) * step(-0.01, up);
  float limb = 0.75 + 0.25 * smoothstep(0.999955, 0.999995, sd);
  col += uSunColor * disc * limb * 16.0;
  sd = max(sd, 0.0);
  col += uSunColor * pow(sd, 2200.0) * 2.5;                       // aureole
  col += uSunColor * pow(sd, 60.0) * 0.35;
  col += uSunColor * pow(sd, 7.0) * 0.22;                         // bloom
  col += uSunColor * pow(sd, 1.6) * 0.08 * clamp(1.0 - up, 0.0, 1.0);

  if (uNight > 0.01 && up > -0.02) {
    float sky = uNight * smoothstep(-0.02, 0.12, up);
    // The Milky Way: a band of faint light across the sky, mottled with dust.
    vec3 axis = normalize(vec3(0.35, 0.42, 0.84));
    float band = exp(-pow(dot(d, axis) / 0.16, 2.0));
    float dust = vnoise(d.xz / max(abs(d.y), 0.15) * 3.0 + d.y * 7.0);
    col += vec3(0.07, 0.075, 0.1) * band * (0.5 + 0.8 * dust) * sky;
    col += stars(d, up) * (1.0 + band * 1.5) * sky;
  }

  // The moon: a disc a degree across, lit grey-white with the dark of its
  // seas on it, and the haze of light round it; opposite the sun.
  float md = dot(d, uMoonDir);
  float mvis = smoothstep(-0.05, 0.08, uMoonDir.y) * smoothstep(0.15, 0.6, uNight);
  if (mvis > 0.0) {
    vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), my = cross(mx, uMoonDir);
    vec2 q = vec2(dot(d, mx), dot(d, my)) / 0.0095;                // within the disc, -1..1
    float r = length(q);
    float seas = smoothstep(0.45, 0.7, vnoise(q * 2.2 + 3.0)) * 0.35 + smoothstep(0.55, 0.8, vnoise(q * 5.0 - 1.0)) * 0.15;
    float body = smoothstep(1.0, 0.94, r) * step(-0.01, up);
    col = mix(col, vec3(0.92, 0.93, 0.88) * (1.0 - seas) * (0.85 + 0.15 * sqrt(max(0.0, 1.0 - r * r))) * 1.6, body * mvis);
    col += vec3(0.55, 0.62, 0.75) * (pow(max(md, 0.0), 900.0) * 0.5 + pow(max(md, 0.0), 40.0) * 0.06) * mvis;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Keyframes around the clock. `t` is 0..1 across a full day, 0 = midnight.
// The sun is up at 06:00 and down at 18:00, and twilight is tropical: short.
// Civil twilight there is about twenty-five minutes and the sky is fully dark
// an hour and ten after sunset — it was three hours, a pink horizon at nine
// at night and the cliffs lit mauve by it.
const KEYS = [
  { t: 0.000, top: 0x081430, hor: 0x16263f, sun: 0x22304d, night: 1.00, amb: 0.19 },   // 00:00 — a moonlit sky is blue, not black
  { t: 0.195, top: 0x08132c, hor: 0x16253e, sun: 0x24324f, night: 1.00, amb: 0.19 },   // 04:41 still night
  { t: 0.218, top: 0x16284a, hor: 0x3c3e58, sun: 0x6a5468, night: 0.75, amb: 0.18 },   // 05:14 blue hour
  { t: 0.238, top: 0x2a4a78, hor: 0xb0705c, sun: 0xd0745a, night: 0.35, amb: 0.28 },   // 05:43 the east reddens
  { t: 0.255, top: 0x34588a, hor: 0xe08a5c, sun: 0xff8a4a, night: 0.12, amb: 0.38 },   // 06:07 sunrise
  { t: 0.280, top: 0x3e70a2, hor: 0xeaae80, sun: 0xffbd86, night: 0.02, amb: 0.48 },   // 06:43
  { t: 0.350, top: 0x2f7fb5, hor: 0xc8dcea, sun: 0xfff1d6, night: 0.00, amb: 0.62 },
  { t: 0.500, top: 0x2472b0, hor: 0xbfd9e8, sun: 0xfffaf0, night: 0.00, amb: 0.72 },   // noon
  { t: 0.680, top: 0x2f7fb5, hor: 0xd3dfe6, sun: 0xfff0d2, night: 0.00, amb: 0.62 },
  { t: 0.725, top: 0x3f6ba2, hor: 0xe8b88a, sun: 0xffc88e, night: 0.00, amb: 0.52 },   // 17:24
  { t: 0.748, top: 0x44639b, hor: 0xf0a06a, sun: 0xff8a48, night: 0.06, amb: 0.42 },   // 17:57 sunset
  { t: 0.765, top: 0x2e4a7c, hor: 0xc0644c, sun: 0xc8583e, night: 0.30, amb: 0.30 },   // 18:22 afterglow
  { t: 0.785, top: 0x172a4c, hor: 0x4c3a52, sun: 0x6a4a5a, night: 0.70, amb: 0.19 },   // 18:50 blue hour
  { t: 0.805, top: 0x08132c, hor: 0x16253e, sun: 0x2a3855, night: 1.00, amb: 0.19 },   // 19:19 night
  { t: 1.000, top: 0x081430, hor: 0x16263f, sun: 0x22304d, night: 1.00, amb: 0.19 },
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
    this._sky = new THREE.Color();

    this.uniforms = {
      uTop:       { value: new THREE.Color(0x2f7fb5) },
      uHorizon:   { value: new THREE.Color(0xbfd9e8) },
      uSunColor:  { value: new THREE.Color(0xfff1d6) },
      uSunDir:    { value: new THREE.Vector3(0, 1, 0) },
      uNight:     { value: 0 },
      uTime:      { value: 0 },
      uMoonDir:   { value: new THREE.Vector3(0, -1, 0) },
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

    // From below, the light thrown back up off the sunlit deck, sand and sea —
    // a few percent of the sun's. (It was a deep sea-teal, next to nothing in
    // linear light: the underside of a roof, in the shade, came out black.)
    this.hemi = new THREE.HemisphereLight(0xbfd9e8, 0x6a6e5e, 0.7);
    scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x9fb8e0, 0.16);
    scene.add(this.moon, this.moon.target);
    this._moonC = new THREE.Color();

    // Thin enough that the range on the far side of the continent, a
    // kilometre and more away, still stands out of the haze.
    scene.fog = new THREE.FogExp2(0xbfd9e8, 0.00115);

    this.time = DAY_SECONDS * 0.42;   // wake up mid-morning, in good light
    this.day = 1;
    this.held = false;   // admin tools can stop the clock without stopping the game
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);   // where the one light comes from: the sun, or the moon
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
    // The moon opposite it — full, rising as the sun sets.
    this.moonDir.copy(this.sunDir).negate();
    this.night = p.night;
    this.uniforms.uTime.value += dt;
    this.uniforms.uMoonDir.value.copy(this.moonDir);

    this.uniforms.uTop.value.copy(p.top);
    this.uniforms.uHorizon.value.copy(p.hor);
    this.uniforms.uSunColor.value.copy(p.sun);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uNight.value = p.night;

    const o = this.ocean.uniforms;
    o.uSkyTop.value.copy(p.top);
    o.uSkyHorizon.value.copy(p.hor);
    // The sea's highlights come from the sun, and once it is down from the
    // moon: a path of moonlight on the water to it. (At night the sea only
    // glinted at a sun below the horizon, a dull navy: it was black.)
    const moonUp = Math.max(0, this.moonDir.y), lunar = THREE.MathUtils.smoothstep(-this.sunDir.y, 0.02, 0.15);
    o.uSunDir.value.copy(this.sunDir).lerp(this.moonDir, lunar).normalize();
    o.uSunColor.value.copy(p.sun).lerp(this._moonC.setHex(0x9fb2cc).multiplyScalar(0.55 * Math.pow(moonUp, 0.3)), lunar);
    o.uNight.value = p.night;
    // (A deep ocean blue: at 0x05222f the water under the raft, looked down into
    // with little of the sky in it, came out black.)
    o.uDeep.value.setHex(0x0b3a55).multiplyScalar(0.35 + 0.65 * (1 - p.night));
    o.uShallow.value.setHex(0x1d7d91).multiplyScalar(0.28 + 0.72 * (1 - p.night));
    o.uFog.value.copy(p.hor);
    this.scene.fog.color.copy(p.hor);

    const above = Math.max(this.sunDir.y, 0);
    // One light, one shadow map: the sun's by day, and once it is down the
    // moon's — so trees, the raft and you throw moon shadows. (The moon was
    // a light of its own with no shadows: a moonlit forest stood on the sand
    // with nothing under it.) The two hand over with the sun just under the
    // horizon, where each is next to nothing.
    const moonLight = 0.5 * p.night * Math.pow(Math.max(0, this.moonDir.y), 0.5);
    if (this.sunDir.y > -0.02) {
      this.sun.color.copy(p.sun);
      this.sun.intensity = 2.6 * Math.pow(above, 0.45);
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 45);
    } else {
      // Moonlight is sunlight, a little bluer to a night-adapted eye — but
      // only a little: deep blue, the green of the leaves went grey-white.
      this.sun.color.setHex(0xb8c4d6);
      this.sun.intensity = moonLight;
      this.sun.position.copy(focus).addScaledVector(this.moonDir, 45);
    }
    this.sun.target.position.copy(focus);
    this.lightDir.copy(this.sunDir.y > -0.02 ? this.sunDir : this.moonDir);
    // (Kept, at nothing: what dims the moon in a cave still has it.)
    this.moon.position.copy(focus).addScaledVector(this.moonDir, 40);
    this.moon.target.position.copy(focus);
    this.moon.intensity = 0;

    this.hemi.intensity = p.amb;
    this.hemi.color.copy(p.hor);
    // Planks reflect about a quarter of the light: the sun on them (half the
    // deck round a roof lies in its shadow) and the sky's.
    DECK_BOUNCE.value.copy(p.sun).multiplyScalar(this.sun.intensity * above * 0.15)
      .add(this._sky.copy(p.hor).multiplyScalar(p.amb * 0.22)).multiply(DECK_TINT);
    this.scene.fog.density = 0.00115 + 0.0016 * p.night;
  }
}
