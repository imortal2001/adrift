// ── Sound ────────────────────────────────────────────────────────────────────
// Made, not recorded: every sound here is built on the spot out of noise and
// oscillators with the Web Audio API — so there are no files to fetch or
// license, and no two strokes of an axe sound quite the same. Each is placed
// in the world where it happens (a PannerNode), and heard from the camera
// (the listener, moved every frame by listen()), so a tree coming down behind
// you or up the hill sounds like it.
//
//   chop    the axe biting: a wooden thunk and the crack of the cut — for
//           bamboo a hollow tock — and the swish of the swing before it
//   creak   a tree giving: wood grinding on wood, rising as it leans
//   fall    the rush of the air, and the leaves, as it comes down faster
//   crash   landing: a deep thump, branches snapping, leaves settling
//
// Browsers let a page make sound only after you have done something on it:
// the first click or key unlocks it (unlock()); until then sounds are dropped.

import * as THREE from 'three';

const VOLUME = 1.0;

let ctx = null, master = null, noise = null;

/** Start the audio, from inside a user gesture. Safe to call again. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    // A crash close by and a chop at once never clip: a gentle limiter last.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -10; limit.knee.value = 8; limit.ratio.value = 6;
    limit.attack.value = 0.003; limit.release.value = 0.2;
    master.connect(limit).connect(ctx.destination);
    // Two seconds of white noise: what every hiss, crack and rustle is cut from.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, { capture: true });

const ready = () => ctx && ctx.state === 'running';

/** 'none' before the first click or key, then the audio's state: 'running' once it is playing. */
export function state() { return ctx ? ctx.state : 'none'; }

/** Hear from the camera: where it is and which way it faces. Once a frame. */
export function listen(camera) {
  if (!ready()) return;
  const L = ctx.listener, p = camera.position;
  const f = camera.getWorldDirection(_f), u = _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const t = ctx.currentTime;
  if (L.positionX) {
    L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
    L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
    L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
  } else {
    L.setPosition(p.x, p.y, p.z);
    L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
  }
}
const _f = new THREE.Vector3(), _u = new THREE.Vector3();

/** A place in the world to play from: a panner at `at`, heard up to `far` metres. */
function place(at, ref = 3, far = 160) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.maxDistance = far;
  p.rolloffFactor = 1.1;
  if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; }
  else p.setPosition(at.x, at.y, at.z);
  p.connect(master);
  return p;
}

const vary = (x, k = 0.08) => x * (1 + (Math.random() * 2 - 1) * k);

/** A burst of noise through a filter, shaped by a gain envelope: [time, level] pairs from `t0`. */
function hiss(out, t0, { type = 'bandpass', freq, q = 1, to = null, env }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + env.at(-1)[0]);
  f.Q.value = q;
  const g = ctx.createGain();
  shape(g.gain, t0, env);
  src.connect(f).connect(g).connect(out);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + env.at(-1)[0] + 0.05);
}

/** A tone gliding from `f0` to `f1`, shaped by a gain envelope. */
function tone(out, t0, { type = 'sine', f0, f1 = f0, glide = 0.1, env }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + glide);
  const g = ctx.createGain();
  shape(g.gain, t0, env);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + env.at(-1)[0] + 0.05);
}

/** Envelope: [[seconds from t0, level], …], starting from silence. */
function shape(param, t0, env) {
  param.setValueAtTime(0.0001, t0);
  for (const [t, v] of env) param.exponentialRampToValueAtTime(Math.max(0.0001, v), t0 + t);
}

// ── the sounds ───────────────────────────────────────────────────────────────
/** The swish of an axe through the air, from `at` (the hand), `delay` s from now. */
export function swish(at, delay = 0) {
  if (!ready()) return;
  const out = place(at, 1.5, 30), t = ctx.currentTime + delay;
  hiss(out, t, { freq: 500, to: 2200, q: 1.4, env: [[0.09, 0.3], [0.2, 0.0001]] });
}

/**
 * The axe biting, at `at`: a thunk of the wood taking the blow, and the
 * crack of the cut. `bamboo` rings hollow; `last` (it is through) is louder.
 */
export function chop(at, { bamboo = false, last = false } = {}) {
  if (!ready()) return;
  const out = place(at, 4, 140), t = ctx.currentTime, loud = last ? 0.9 : 0.7;
  if (bamboo) {
    tone(out, t, { f0: vary(620), f1: vary(430), glide: 0.12, env: [[0.004, 0.9 * loud], [0.22, 0.0001]] });
    tone(out, t, { type: 'triangle', f0: vary(1240), f1: vary(900), glide: 0.08, env: [[0.003, 0.3 * loud], [0.12, 0.0001]] });
    hiss(out, t, { freq: vary(3200), q: 1.5, env: [[0.003, 0.55 * loud], [0.06, 0.0001]] });
    return;
  }
  // The blade stopping in the wood: a low knock with a quick drop in pitch…
  tone(out, t, { f0: vary(190), f1: vary(78), glide: 0.1, env: [[0.003, 0.9 * loud], [0.24, 0.0001]] });
  // …the body of the trunk sounding with it…
  hiss(out, t, { freq: vary(540), q: 3, env: [[0.004, 0.55 * loud], [0.16, 0.0001]] });
  // …and the crack of the fibres parting.
  hiss(out, t, { freq: vary(2100), q: 1.1, env: [[0.002, 0.5 * loud], [0.07, 0.0001]] });
  if (last) hiss(out, t + 0.03, { freq: vary(1400), q: 0.9, env: [[0.01, 0.35], [0.3, 0.0001]] });   // splitting
}

/**
 * A tree giving way, at `at`, for `dur` seconds: wood grinding on wood — a
 * stick-slip buzz through the trunk's resonance, quickening as it goes over.
 */
export function creak(at, dur = 1.2) {
  if (!ready()) return;
  const out = place(at, 6, 160), t = ctx.currentTime;
  for (const [base, res, level] of [[26, 620, 1.5], [41, 980, 0.85]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(vary(base, 0.15), t);
    // Slipping unevenly: the rate wanders, and climbs as the lean takes hold.
    for (let k = 1; k <= 8; k++) o.frequency.linearRampToValueAtTime(vary(base * (1 + k * 0.12), 0.25), t + (dur * k) / 8);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = vary(res, 0.1); f.Q.value = 9;
    const g = ctx.createGain();
    shape(g.gain, t, [[0.18, level], [dur * 0.6, level * 0.8], [dur, level * 0.5], [dur + 0.25, 0.0001]]);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.3);
  }
}

/**
 * A tree coming down, from `at`, over `dur` seconds: the rush of the air and
 * of its leaves, louder and higher the faster it goes. `size` 0..1.
 */
export function fall(at, dur, size = 1) {
  if (!ready()) return;
  const out = place(at, 8, 180), t = ctx.currentTime;
  const k = (0.25 + 0.75 * size) * 1.3;
  hiss(out, t, { freq: 260, to: 1300, q: 0.8, env: [[dur * 0.5, 0.05 * k], [dur * 0.95, 0.4 * k], [dur + 0.15, 0.0001]] });
  hiss(out, t, { type: 'highpass', freq: 2600, q: 0.5, env: [[dur * 0.6, 0.03 * k], [dur * 0.98, 0.22 * k], [dur + 0.2, 0.0001]] });
}

/**
 * A tree hitting the ground, at `at`: a thump you feel, the crack of branches
 * breaking under it one after another, and the leaves settling. `size` 0..1.
 */
export function crash(at, size = 1) {
  if (!ready()) return;
  const out = place(at, 10, 220), t = ctx.currentTime, k = (0.35 + 0.65 * size) * 1.4;
  tone(out, t, { f0: vary(62), f1: 34, glide: 0.6, env: [[0.01, 1.0 * k], [0.9, 0.0001]] });
  hiss(out, t, { type: 'lowpass', freq: 380, q: 0.7, env: [[0.01, 0.8 * k], [0.7, 0.0001]] });
  // Branches, snapping, over the half second it takes the whole tree to settle.
  const snaps = 5 + Math.round(6 * size);
  for (let i = 0; i < snaps; i++) {
    const at2 = t + Math.random() * 0.55;
    hiss(out, at2, { freq: vary(2600, 0.35), q: 1.3, env: [[0.002, (0.25 + Math.random() * 0.35) * k], [0.05 + Math.random() * 0.05, 0.0001]] });
  }
  hiss(out, t + 0.05, { type: 'highpass', freq: 3000, q: 0.4, env: [[0.1, 0.3 * k], [1.4, 0.0001]] });
}
