// ── Clouds ───────────────────────────────────────────────────────────────────
// Trade-wind cumulus: one deck of scattered, flat-bottomed clouds a long way
// up, drifting with the wind the sail takes. The sky dome draws them and the
// ocean draws them again in its reflection, from the same GLSL and the same
// uniforms, so the clouds in the sea are the clouds in the sky. (The sky was
// a bare gradient: nothing in it, and nothing in the water.)

import * as THREE from 'three';

// Shared by the sky's material and the ocean's (both add these to their own).
export const CLOUDS = {
  uCloudShift: { value: new THREE.Vector2(0, 0) },   // how far the wind has carried the deck, in deck units
  uCloudCover: { value: 0.4 },                       // 0 clear .. 1 overcast
  uCloudDark:  { value: 0 },                         // a squall's: thick, grey-bottomed rain cloud
};

// The deck is a plane one unit up: a direction d meets it at d.xz / d.y. One
// unit is about a kilometre, so a cloud is a few hundred metres across.
const DRIFT = 0.011;   // deck units a second in a full wind: a cloud's width in a minute or so

/** Carry the clouds on with the wind (x, z: which way it blows; strength 0..1). */
export function driftClouds(wind, dt) {
  const k = DRIFT * (0.4 + 0.6 * wind.strength) * dt;
  CLOUDS.uCloudShift.value.x -= wind.x * k;
  CLOUDS.uCloudShift.value.y -= wind.z * k;
}

export const CLOUD_GLSL = /* glsl */`
uniform vec2 uCloudShift;
uniform float uCloudCover, uCloudDark;
float cHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float cNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), f.x), f.y);
}
float cFbm(vec2 p, int oct){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * cNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return s;
}
// How much cloud at a point of the deck, 0..1: big patches of weather, and in
// them the billows, warped by the patches so they are heaped, not a grid.
float cloudDensity(vec2 p, int oct){
  vec2 q = p + uCloudShift;
  float field = cFbm(q * 0.45, 2);
  float heap = cFbm(q * 2.6 + field * 1.6, oct);
  float c = field * 0.5 + heap * 0.68;
  float edge = 0.8 - uCloudCover * 0.38;
  // (A crisp edge: a cumulus is a heap with a boundary, not a smudge.)
  return smoothstep(edge, edge + 0.07, c);
}
// The clouds seen along d, lit by a sun (or the moon) in sunDir: colour, and
// how much of what is behind they hide. Looking up you see their bases — grey
// where they are thick, bright at the thin edges and on the side toward the
// sun, with a silver rim when the sun is behind them; low, at dawn and dusk,
// lit from underneath in the sun's own colour; and far off, in the haze, they
// go to the horizon's colour. (oct: fewer octaves where they are only seen in
// the water.)
vec4 cloudsAlong(vec3 d, vec3 sunDir, vec3 sunCol, vec3 top, vec3 hor, float night, int oct){
  if (d.y < 0.012) return vec4(0.0);
  vec2 p = d.xz / (d.y + 0.045);           // (the deck curving down to the horizon with the earth)
  float dens = cloudDensity(p, oct);
  if (dens < 0.003) return vec4(0.0);
  // In the shadow of the cloud between here and the sun: denser toward it.
  vec2 toSun = normalize(sunDir.xz + 1e-4) * (0.09 + 0.12 * (1.0 - abs(sunDir.y)));
  float shade = oct > 3 ? cloudDensity(p + toSun, oct - 2) : dens;
  float lit = clamp(1.05 - shade * 0.75 - dens * 0.2, 0.2, 1.0) * (1.0 - 0.75 * uCloudDark);
  float day = 1.0 - night;
  vec3 ambient = mix(hor, top, 0.35) * (0.82 + 0.25 * day) + vec3(0.05, 0.055, 0.06) * day;
  float sd = max(dot(d, sunDir), 0.0);
  // (Not in the water: there the rim, bent by the ripples, drew outlines.)
  float rim = oct > 3 ? pow(sd, 10.0) * (1.0 - dens) * 2.2 + pow(sd, 3.0) * 0.25 : pow(sd, 3.0) * 0.15;
  vec3 col = ambient * (1.0 - dens * (0.32 + 0.3 * uCloudDark)) * (1.0 - 0.35 * uCloudDark) + sunCol * (lit * (0.55 + 0.35 * day) + rim * (1.0 - uCloudDark));
  // A squall's: its thin edges the grey of the overcast lid they lie on,
  // its thick bellies darker — no bright rims. (Lit as a fair-weather cloud
  // is, they were dark lumps outlined in white.)
  col = mix(col, mix(hor, top, 0.35) * 0.95 * (1.0 - 0.5 * dens), uCloudDark * 0.9);
  // Into the haze toward the horizon.
  float haze = 1.0 - smoothstep(0.0, 0.3, d.y);
  col = mix(col, hor * (1.0 + 0.2 * day), haze * 0.55);
  float a = smoothstep(0.0, 0.4, dens) * smoothstep(0.012, 0.09, d.y) * (0.92 - 0.25 * night);
  return vec4(col, a);
}`;
