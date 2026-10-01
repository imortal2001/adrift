// ── Model library ────────────────────────────────────────────────────────────
// Optional glTF bodies for the wildlife. Everything here is best-effort: if a
// .glb is absent, malformed, or the browser blocks it, the caller keeps the
// procedural body it already built and the game plays exactly as before.
//
// Drop a file into assets/models/ and that species upgrades itself on the next
// load. Nothing else has to change.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';

const DIR = 'assets/models/';

/**
 * Per-species overrides. `yaw` rotates the model so it faces +Z, which is what
 * the game treats as forward; artists disagree about this constantly.
 */
export const MODELS = {
  sauropod:    { file: 'sauropod.glb',    yaw: 0 },
  stegosaur:   { file: 'stegosaur.glb',   yaw: 0 },
  parasaur:    { file: 'parasaur.glb',    yaw: 0 },
  raptor:      { file: 'raptor.glb',      yaw: 0 },
  tyrannosaur: { file: 'tyrannosaur.glb', yaw: 0 },
  // Not an animal the wildlife system drives: one file holding every reef fish
  // body, which src/fish.js takes apart and draws instanced.
  reef_fish:   { file: 'reef_fish.glb',   yaw: 0 },
  // A species can take its body from a file of its own instead: the blacktip
  // is a third-party model of the species (CREDITS.md), converted by
  // tools/build_shark.py.
  shark_blacktip: { file: 'shark_blacktip.glb', yaw: 0 },
  shark_greatwhite: { file: 'shark_greatwhite.glb', yaw: 0 },     // tools/build_great_white.py
  whale_humpback: { file: 'whale_humpback.glb', yaw: 0 },         // tools/build_whale.py
  // Held tools, drawn by src/viewmodel.js. Prepared by tools/build_tools.py
  // into one frame — standing along +Y, origin at the grip — so `yaw` is
  // unused for them; the pose table in viewmodel.js does the turning.
  tool_hammer: { file: 'tool_hammer.glb', yaw: 0 },
  tool_spear:  { file: 'tool_spear.glb',  yaw: 0 },
  tool_rod:    { file: 'tool_rod.glb',    yaw: 0 },
  tool_axe:    { file: 'tool_axe.glb',    yaw: 0 },
  // A photoscanned coconut, pores up, ~17 cm (CREDITS.md): in hand, and on
  // the water as flotsam. Prepared by tools/build_coconut.py.
  coconut:     { file: 'coconut.glb',     yaw: 0 },
  // The player's body, seen in third and second person (src/body.js): Ready
  // Player Me characters, CC BY-NC-SA 4.0 (CREDITS.md), rigged, animated in
  // code. Prepared by tools/build_player.py.
  player_woman: { file: 'player_woman.glb', yaw: 0 },
  player_man:   { file: 'player_man.glb',   yaw: 0 },
  // The reef's and the ponds' animals (src/reefmodels.js), from
  // tools/build_sealife.py. The stingray is CC BY-NC (CREDITS.md).
  sea_turtle:  { file: 'sea_turtle.glb',  yaw: 0 },
  crab:        { file: 'crab.glb',        yaw: 0 },
  octopus:     { file: 'octopus.glb',     yaw: 0 },
  stingray:    { file: 'stingray.glb',    yaw: 0 },
  tortoise:    { file: 'tortoise.glb',    yaw: 0 },
  pond_turtle: { file: 'pond_turtle.glb', yaw: 0 },
};

// Clip names in the wild are a mess: "Walk", "walk", "Armature|Run",
// "TRex_Attack_01". Match on substrings, in order of preference.
const CLIP_WORDS = {
  idle:   ['idle', 'stand', 'breath', 'rest'],
  walk:   ['walk', 'amble'],
  run:    ['run', 'sprint', 'gallop', 'charge'],
  attack: ['attack', 'bite', 'roar', 'strike'],
  death:  ['death', 'die', 'dead'],
};

function matchClip(clips, kind) {
  for (const word of CLIP_WORDS[kind]) {
    const hit = clips.find(c => c.name.toLowerCase().includes(word));
    if (hit) return hit;
  }
  return null;
}

export class ModelLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();     // key -> { scene, clips } | null when unavailable
    this.pending = new Map();
    this.report = [];           // what loaded and what did not, for the log
    this.manifest = null;
  }

  /**
   * The manifest lists which species actually have a file. Probing for each
   * .glb instead would work, but every absent one leaves a red 404 in the
   * console — and the normal state of this folder is empty.
   */
  listed() {
    // Cache the in-flight promise: all five species ask at once, and without
    // this they each fetch the manifest.
    if (this.manifestJob) return this.manifestJob;
    this.manifestJob = this._readManifest();
    return this.manifestJob;
  }

  async _readManifest() {
    try {
      const res = await fetch(DIR + 'manifest.json', { cache: 'no-cache' });
      const data = res.ok ? await res.json() : null;
      this.manifest = new Set(Array.isArray(data?.models) ? data.models : []);
    } catch {
      this.manifest = new Set();
    }
    return this.manifest;
  }

  /**
   * Resolve a species to a loaded glTF, or null. Never throws, and stays silent
   * for the ordinary "no file yet" case.
   */
  get(key) {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.pending.has(key)) return this.pending.get(key);

    const cfg = MODELS[key];
    if (!cfg) { this.cache.set(key, null); return Promise.resolve(null); }
    const url = DIR + cfg.file;

    const job = (async () => {
      try {
        const listed = await this.listed();
        if (!listed.has(key)) { this.cache.set(key, null); return null; }

        const gltf = await this.loader.loadAsync(url);
        const entry = { scene: gltf.scene, clips: gltf.animations || [], cfg };
        this.cache.set(key, entry);
        this.report.push({ key, clips: entry.clips.map(c => c.name) });
        return entry;
      } catch (err) {
        this.cache.set(key, null);
        this.report.push({ key, error: String(err && err.message || err) });
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, job);
    return job;
  }

  /**
   * Build a ready-to-use instance: cloned skeleton, scaled to match the body
   * it replaces, with a mixer and whatever clips could be identified.
   *
   * @param targetLength  nose-to-tail size of the procedural body, so swapping
   *                      in a model does not change reach, collision or scale.
   */
  instantiate(entry, targetLength) {
    const root = cloneSkinned(entry.scene);

    // Normalise orientation first, then measure.
    root.rotation.y = entry.cfg.yaw || 0;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.z) || 1;
    const scale = targetLength / longest;

    const group = new THREE.Group();
    root.scale.setScalar(scale);
    root.position.set(0, 0, 0);
    group.add(root);

    // Re-measure after scaling so the animal stands on the ground, not in it.
    root.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(root);
    const stand = -scaled.min.y;

    root.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;   // skinned bounds go stale while animating
      }
    });

    const mixer = entry.clips.length ? new THREE.AnimationMixer(root) : null;
    const actions = {};
    if (mixer) {
      for (const kind of Object.keys(CLIP_WORDS)) {
        const clip = matchClip(entry.clips, kind);
        if (clip) actions[kind] = mixer.clipAction(clip);
      }
      // Something to play even if no name matched.
      if (!actions.idle && entry.clips.length) {
        actions.idle = mixer.clipAction(entry.clips[0]);
      }
      if (actions.attack) {
        actions.attack.setLoop(THREE.LoopOnce, 1);
        actions.attack.clampWhenFinished = true;
      }
    }

    if (actions.death) {
      actions.death.setLoop(THREE.LoopOnce, 1);
      actions.death.clampWhenFinished = true;
    }

    const rig = { group, root, mixer, actions, stand, model: true, current: null, scale,
                  size: scaled.getSize(new THREE.Vector3()) };
    if (mixer) rig.gait = measureGaits(entry, rig);
    return rig;
  }
}

// ── gaits ────────────────────────────────────────────────────────────────────
// A walk or run clip is authored in place: the feet sweep back under a body
// that stays put. Played at a fixed rate on an animal moving at some other
// speed, the feet skate — which is most of what makes an animal look wrong.
// So each clip is measured once: how fast a planted foot travels back, which
// is how fast the clip means the body to go. Playback is then matched to the
// animal's real speed (see driveGait).

const _v = new THREE.Vector3();

/**
 * Measure a rig's walk and run: natural speed in m/s at this rig's size, and
 * each limb bone's average pose through the cycle (the stride is lengthened
 * about that, not about the bind pose). Cached per model and scaled, since
 * every animal of a species uses the same clips at nearly the same size.
 */
function measureGaits(entry, rig) {
  const bones = {};
  rig.root.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const all = Object.values(bones);
  const find = re => all.filter(b => re.test(b.name));
  const feet = find(/^bip_(foot|hand)_[lr]/i);
  // The bones that swing a leg from its root: hips, and shoulders on the ones
  // that walk on four.
  const hips = find(/^bip_hip_[lr]/i), arms = find(/^bip_upperarm_[lr]/i);
  if (!entry.gaits) {
    entry.gaits = {};
    for (const kind of ['walk', 'run']) {
      const act = rig.actions[kind];
      if (!act) continue;
      rig.mixer.stopAllAction();
      act.reset().play();
      const T = act.getClip().duration, N = 96;
      const P = [], Q = [];
      for (let k = 0; k <= N; k++) {
        rig.mixer.setTime((k / N) * T);
        rig.root.updateMatrixWorld(true);
        P.push(feet.map(f => f.getWorldPosition(new THREE.Vector3())));
        Q.push([...hips, ...arms].map(b => b.quaternion.clone()));
      }
      // Only limbs that reach the ground count: a biped's hands never do.
      const lows = feet.map((_, i) => Math.min(...P.map(p => p[i].y)));
      const highs = feet.map((_, i) => Math.max(...P.map(p => p[i].y)));
      const floor = Math.min(...lows), tall = rig.size.y || 1;
      let sum = 0, n = 0, sweep = 0;
      const planted = [];
      // Weight-bearing: a foot that comes down within a little of the lowest.
      // (A four-legged body's hind feet may ride a little higher than its
      // front ones in a shared clip; a biped's hands are nowhere near.) The
      // pace is read off the hind feet where they bear weight: on a
      // four-legged body a front foot may hardly sweep at all.
      // (If the front feet bear weight, so do the hind ones, whatever the clip.)
      const fore = feet.some((f, i) => /hand/i.test(f.name) && lows[i] <= floor + tall * 0.11);
      const bears = i => lows[i] <= floor + tall * 0.11 || (fore && /foot/i.test(feet[i].name));
      const hind = feet.some((f, i) => bears(i) && /foot/i.test(f.name));
      feet.forEach((f, i) => {
        if (!bears(i)) return;
        planted.push(f.name);
        if (hind && !/foot/i.test(f.name)) return;
        const zs = P.map(p => p[i].z);
        sweep = Math.max(sweep, Math.max(...zs) - Math.min(...zs));
        // (Mid-stance only — the lowest few per cent: nearer the lift and the
        // touch-down a foot is already slowing or quickening.)
        for (let k = 0; k < N; k++) {
          if (P[k][i].y > lows[i] + (highs[i] - lows[i]) * 0.06) continue;
          sum += -(P[k + 1][i].z - P[k][i].z) / (T / N);
          n++;
        }
      });
      // Each limb that bears weight, for plantFeet(): how low its foot goes
      // (and how high), and how long the leg is — per unit of scale.
      const limbs = feet.map((f, i) => {
        const knee = f.parent, hip = knee?.parent;
        const len = hip ? hip.getWorldPosition(new THREE.Vector3()).distanceTo(knee.getWorldPosition(new THREE.Vector3())) +
                          knee.getWorldPosition(new THREE.Vector3()).distanceTo(f.getWorldPosition(new THREE.Vector3())) : 0;
        return { name: f.name, lo: lows[i] / rig.scale, hi: highs[i] / rig.scale, len: len / rig.scale,
                 planted: bears(i) && len > 0 };
      });
      // Some clips barely sweep a planted foot back at all — they lift and
      // set it down, stepping nearly in place. Then the foot's whole swing,
      // twice a cycle, is the better guide to how far the body should go.
      const bySweep = (sweep * 2) / T * 0.5;
      let natural = n ? sum / n : 0;
      if (natural < bySweep * 0.3) natural = bySweep;
      const means = [...hips, ...arms].map((b, j) => {
        const m = new THREE.Quaternion(0, 0, 0, 0);
        for (const q of Q) {
          const s = m.dot(q[j]) < 0 ? -1 : 1;
          m.x += q[j].x * s; m.y += q[j].y * s; m.z += q[j].z * s; m.w += q[j].w * s;
        }
        return { name: b.name, q: m.normalize() };
      });
      // Per unit of scale, so an animal a little bigger or smaller reads it right.
      entry.gaits[kind] = { perScale: Math.max(0.05, natural) / rig.scale, means, planted, limbs };
    }
    rig.mixer.stopAllAction();
  }
  const gait = { limbs: [], bones };
  for (const kind of ['walk', 'run']) {
    const g = entry.gaits[kind];
    if (!g) continue;
    gait[kind] = g.perScale * rig.scale;
    gait[`${kind}Means`] = g.means.map(m => ({ bone: bones[m.name], q: m.q }));
    gait[`${kind}Limbs`] = g.limbs.filter(l => l.planted && bones[l.name])
      .map(l => ({ foot: bones[l.name], lo: l.lo * rig.scale, hi: l.hi * rig.scale, len: l.len * rig.scale }));
    // Four-legged if the front feet were planted in the walk.
    if (kind === 'walk') gait.quadruped = g.planted.some(n => /hand/i.test(n));
  }
  return gait;
}

/** Crossfade a model rig to the action that suits what it is doing. */
export function playState(rig, kind, fade = 0.25) {
  if (!rig.mixer) return;
  const next = rig.actions[kind] || rig.actions.idle;
  if (!next || next === rig.current) return;
  const prev = rig.current;
  next.reset();
  // Walk into run and back: carry the step across, so the legs do not jump
  // to a different point in their stride.
  if (prev && (prev === rig.actions.walk || prev === rig.actions.run) &&
      (next === rig.actions.walk || next === rig.actions.run)) {
    next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
  }
  next.fadeIn(fade).play();
  if (prev) prev.fadeOut(fade);
  rig.current = next;
}

const _dq = new THREE.Quaternion(), _axis = new THREE.Vector3();

/**
 * Play a model rig at the speed its body is really going: walk or run by
 * speed, the clip's rate matched to it, and — where the clip's natural stride
 * is shorter than the animal needs — the stride lengthened, swinging the
 * hips (and shoulders, on four legs) further about their average pose. Both
 * together, so a sprint reads as long strides at a quick cadence, not a
 * frantic shuffle or a skate.
 *
 * @param speed  ground speed, m/s
 * @param alert  1 when it is hunting or fleeing: it runs sooner
 * @param run    false for an animal that could only walk (an adult T. rex, a
 *               stegosaur, a sauropod): the walk is quickened instead
 * @param maxRate, maxStride  how far the walk may be quickened and lengthened
 */
export function driveGait(rig, speed, dt, { alert = 0, attack = false, idle = 'idle',
                                          run = true, maxRate = 2.3, maxStride = null } = {}) {
  const g = rig.gait;
  if (!g || !g.walk) {
    playState(rig, attack ? 'attack' : speed > 0.15 ? 'walk' : idle);
    if (rig.mixer) rig.mixer.update(dt);
    return;
  }
  const s = Math.abs(speed);
  // Hysteresis, so an animal at the boundary does not flicker between gaits.
  const toRun = g.walk * (alert ? 1.5 : 2.1), toWalk = toRun * 0.8;
  let kind = attack ? 'attack' : s < 0.12 ? idle : rig.gaitKind === 'run' ? (s > toWalk ? 'run' : 'walk') : (s > toRun ? 'run' : 'walk');
  if (kind === 'run' && (!rig.actions.run || !run)) kind = 'walk';
  rig.gaitKind = kind;
  playState(rig, kind, kind === 'attack' ? 0.15 : 0.35);

  let stride = 1;
  if (kind === 'walk' || kind === 'run') {
    const natural = g[kind];
    const ratio = s / natural;
    // Split the difference between cadence and stride length.
    const longest = maxStride ?? (kind === 'run' ? 1.3 : 1.12);
    stride = THREE.MathUtils.clamp(Math.sqrt(ratio), 1, longest);
    const rate = THREE.MathUtils.clamp(ratio / stride, 0.45, maxRate);
    rig.actions[kind].setEffectiveTimeScale(rate);
  }
  rig.mixer.update(dt);

  // Lengthen the stride: after the clip has posed the limbs.
  rig.stride = (rig.stride ?? 1) + (stride - (rig.stride ?? 1)) * Math.min(1, dt * 3);
  if (rig.stride > 1.01 && (kind === 'walk' || kind === 'run')) {
    const means = g[`${kind}Means`];
    for (const { bone, q } of means) {
      if (!g.quadruped && /upperarm/i.test(bone.name)) continue;
      // delta = mean⁻¹ · current, scaled in angle, put back.
      _dq.copy(q).invert().multiply(bone.quaternion);
      if (_dq.w < 0) { _dq.x = -_dq.x; _dq.y = -_dq.y; _dq.z = -_dq.z; _dq.w = -_dq.w; }
      const angle = 2 * Math.acos(Math.min(1, _dq.w));
      if (angle < 1e-4) continue;
      _axis.set(_dq.x, _dq.y, _dq.z).normalize();
      _dq.setFromAxisAngle(_axis, angle * rig.stride);
      bone.quaternion.copy(q).multiply(_dq);
    }
  }
}

// ── feet on the ground ───────────────────────────────────────────────────────
// Even played at the right speed a shared clip cannot keep every foot still
// on every body: the same walk is stretched over a biped and a sauropod, and
// on a four-legged one the legs no longer sweep back at one speed. So a foot
// coming down in its stride is held where it came down — on the ground as it
// lies there — and the leg bent to reach it, the knee kept in the plane the
// clip bends it in and the foot turned as the clip turns it; and let go as the
// clip lifts it, or sooner if the leg would have to stretch too far.

const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _T = new THREE.Vector3();
const _d = new THREE.Vector3(), _n = new THREE.Vector3(), _B2 = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qf = new THREE.Quaternion();

/** Turn `bone` by `delta`, a rotation in the world's frame. */
function turnInWorld(bone, delta) {
  bone.getWorldQuaternion(_qb);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(delta.multiply(_qb)));
  bone.updateMatrixWorld(true);
}

/** Bend hip → knee → foot so the foot is at `target` (world), the knee on the side it was. */
function reach(hip, knee, foot, target) {
  hip.getWorldPosition(_A); knee.getWorldPosition(_B); foot.getWorldPosition(_C);
  foot.getWorldQuaternion(_qf);
  const l1 = _A.distanceTo(_B), l2 = _B.distanceTo(_C);
  _d.subVectors(target, _A);
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(l1 - l2) * 1.02 + 1e-4, (l1 + l2) * 0.999);
  _d.normalize();
  // The knee's way out from the hip-to-foot line, as the clip had it.
  _n.subVectors(_B, _A);
  _n.addScaledVector(_d, -_n.dot(_d));
  if (_n.lengthSq() < 1e-10) return;
  _n.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _B2.copy(_A).addScaledVector(_d, a).addScaledVector(_n, h);
  _u.subVectors(_B, _A).normalize(); _w.subVectors(_B2, _A).normalize();
  turnInWorld(hip, _q.setFromUnitVectors(_u, _w));
  knee.getWorldPosition(_B); foot.getWorldPosition(_C);
  _T.copy(_A).addScaledVector(_d, dist);
  _u.subVectors(_C, _B).normalize(); _w.subVectors(_T, _B).normalize();
  turnInWorld(knee, _q.setFromUnitVectors(_u, _w));
  // The foot as the clip turned it.
  foot.parent.getWorldQuaternion(_qp);
  foot.quaternion.copy(_qp.invert().multiply(_qf));
  foot.updateMatrixWorld(true);
}

/**
 * After the clip (driveGait) and any posing on top of it: the feet that are
 * down held where they came down. `groundAt(x, z)` is the ground's height.
 */
export function plantFeet(rig, dt, groundAt) {
  if (dt <= 0) return;
  const g = rig.gait;
  if (!g) return;
  const kind = rig.gaitKind;
  const moving = kind === 'walk' || kind === 'run';
  if (moving) rig.plantLimbs = g[`${kind}Limbs`];
  const limbs = rig.plantLimbs;
  const locks = rig.locks ||= new Map();
  if (!limbs || (!moving && !locks.size)) return;
  rig.group.updateMatrixWorld(true);
  const gp = rig.group.position, gy = gp.y, M = rig.group.matrixWorld.elements;
  const fl = Math.hypot(M[8], M[10]) || 1, fx = M[8] / fl, fz = M[10] / fl;      // the body's forward, flat
  const seen = rig.footSeen ||= new Map();
  for (const L of limbs) {
    const foot = L.foot, knee = foot.parent, hip = knee?.parent;
    if (!hip?.parent) continue;
    foot.getWorldPosition(_C);
    const h = _C.y - gy;
    // How low and how high this foot has been lately — as posed here, on this
    // ground, at this pace — so "down" is the bottom of its own stride.
    // And which way it is going along the body, as the clip moves it: back
    // while it bears the weight, forward as it swings through.
    const along = (_C.x - gp.x) * fx + (_C.z - gp.z) * fz;
    let r = seen.get(foot);
    if (!r) seen.set(foot, r = { buf: new Float32Array(48).fill(h), i: 0, along });
    r.buf[r.i = (r.i + 1) % r.buf.length] = h;
    const back = (r.along - along) / dt;
    r.along = along;
    let lo = Infinity, hi = -Infinity;
    for (const v of r.buf) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo, u = span > 1e-4 ? (h - lo) / span : 0;
    let lock = locks.get(foot);
    // Down: at the bottom of its stride, or low and going back; held, while it
    // is going back (or hardly moving) and not yet lifted high.
    const down = moving && span > L.len * 0.02 &&
      (lock && lock.w > 0 && !lock.lifting ? u < 0.7 && back > -0.25 * L.len : u < 0.3 || (u < 0.6 && back > 0));
    if (down) {
      // (Coming down again as the last step is let go: a new step, where it lands now.)
      if (!lock || lock.lifting) {
        lock = { x: _C.x, z: _C.z, dy: _C.y - groundAt(_C.x, _C.z), w: 0 };
        locks.set(foot, lock);
      }
      lock.w = Math.min(1, lock.w + dt / 0.06);
    } else if (lock) {
      lock.lifting = true;
      lock.w -= dt / 0.12;                                   // eased back onto the clip as it lifts
      if (lock.w <= 0) { locks.delete(foot); continue; }
    } else continue;
    _T.set(lock.x, groundAt(lock.x, lock.z) + lock.dy, lock.z);
    // Held too far behind (a turn, a burst of speed): let it go.
    if (_T.distanceTo(_C) > L.len * 0.35) { locks.delete(foot); continue; }
    _T.lerp(_C, 1 - lock.w * lock.w * (3 - 2 * lock.w));
    reach(hip, knee, foot, _T);
  }
}
