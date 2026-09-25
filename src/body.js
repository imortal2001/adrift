// ── The player's body ────────────────────────────────────────────────────────
// What you look like from the outside: seen in the third- and second-person
// views (camera.js), standing where the player stands, facing where they
// face, walking, running, jumping and swimming as they do, with whatever is
// in hand in the right hand.
//
// The body is one of two characters (player_woman.glb, player_man.glb —
// Ready Player Me, CC BY-NC-SA 4.0, converted by tools/build_player.py). They
// are rigged but come with no animation, so the motion is made here: one set
// of joint angles a frame — the stride, the swim, the jump, a swing of the
// arm when you use something — worked out from what the player is doing, and
// put onto the character's bones. Without the file, the same angles drive a
// mannequin built in code, in a hide tunic.
//
// The angles are in the body's own frame — it faces -Z, +X is its right —
// so +x swings a hanging limb forward, and a limb's own joints follow it:
//   thigh/arm  +x forward, -x back;  z opens the limb out to the side
//   knee       -x bends (the foot goes back)
//   elbow      +x bends (the hand comes forward and up)
//   chest      +  leans forward — the one exception: the spine points up,
//              and +x would tip it back, so it is applied as -x
//   neck       +x looks up; `turn` + turns the face to its left
//   openL/R    opens one arm out to the side; `legs` spreads the legs
//              (both default to what `spread` does)

import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';
import { ITEMS } from './items.js';

const SKIN = 0xc08a62, HIDE = 0x86633f, HIDE_DARK = 0x5e4430, HAIR = 0x2b1d14;
const EYE = 1.62;

const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });

/** A limb segment hanging down from its joint: a group, so it can swing. */
function segment(parent, x, y, len, r0, r1, m) {
  const joint = new THREE.Group();
  joint.position.set(x, y, 0);
  const g = new THREE.CapsuleGeometry((r0 + r1) / 2, len - (r0 + r1), 3, 8);
  g.translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  joint.add(mesh);
  parent.add(joint);
  return joint;
}

// ── the stand-in ─────────────────────────────────────────────────────────────
function mannequin() {
  const root = new THREE.Group();
  const skin = mat(SKIN), hide = mat(HIDE), dark = mat(HIDE_DARK), hair = mat(HAIR);
  const j = {};
  j.hips = new THREE.Group();
  j.hips.position.y = 0.95;
  root.add(j.hips);
  j.chest = new THREE.Group();
  j.hips.add(j.chest);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 4, 10), hide);
  torso.position.y = 0.32;
  torso.scale.set(1.12, 1, 0.78);
  torso.castShadow = true;
  j.chest.add(torso);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.25, 0.3, 12, 1, true), dark);
  skirt.position.y = -0.02;
  skirt.material.side = THREE.DoubleSide;
  skirt.castShadow = true;
  j.hips.add(skirt);
  j.neck = new THREE.Group();
  j.neck.position.y = 0.62;
  j.chest.add(j.neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
  head.position.y = 0.06;
  head.scale.set(0.92, 1.08, 1);
  head.castShadow = true;
  const mop = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  mop.position.set(0, 0.08, 0.012);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 6), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.06, -0.11);
  j.neck.add(head, mop, nose);
  j.arm = {}; j.fore = {}; j.thigh = {}; j.shin = {};
  for (const [side, sx] of [['l', -1], ['r', 1]]) {
    j.arm[side] = segment(j.chest, sx * 0.24, 0.5, 0.31, 0.058, 0.05, skin);
    j.fore[side] = segment(j.arm[side], 0, -0.3, 0.28, 0.048, 0.04, skin);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
    hand.position.y = -0.3;
    hand.scale.set(0.8, 1.1, 0.6);
    j.fore[side].add(hand);
    j.thigh[side] = segment(j.hips, sx * 0.1, -0.02, 0.46, 0.08, 0.062, skin);
    j.shin[side] = segment(j.thigh[side], 0, -0.45, 0.46, 0.058, 0.045, skin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.22), dark);
    foot.position.set(0, -0.46, -0.05);
    foot.castShadow = true;
    j.shin[side].add(foot);
  }
  j.grip = new THREE.Group();
  j.grip.position.y = -0.31;
  j.fore.r.add(j.grip);
  return { root, j };
}

function applyMannequin({ j }, a) {
  const legs = a.legs ?? a.spread;
  j.thigh.l.rotation.set(a.thighL, 0, -legs * 0.5);
  j.thigh.r.rotation.set(a.thighR, 0, legs * 0.5);
  j.shin.l.rotation.x = a.kneeL;
  j.shin.r.rotation.x = a.kneeR;
  j.arm.l.rotation.set(a.armL, 0, -0.1 - a.spread - (a.openL || 0));
  j.arm.r.rotation.set(a.armR, 0, 0.1 + a.spread + (a.openR || 0));
  j.fore.l.rotation.x = a.elbowL;
  j.fore.r.rotation.x = a.elbowR;
  j.chest.rotation.x = -a.chest;
  j.neck.rotation.set(a.neck, a.turn || 0, 0);
}

// ── a rigged character ───────────────────────────────────────────────────────
// A bone's new local rotation, for a turn `d` in the body's frame at that
// joint: q = K⁻¹ · d · K · q0, with K the parent's rest orientation in the
// body frame and q0 the bone's rest local rotation. Composed down the chain,
// each bone's turn rides on its parent's, and a bone left alone keeps its
// rest pose — so the angles mean the same here as on the mannequin.
const DRIVEN = ['Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm',
                'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'];

function rigged(scene) {
  const root = cloneSkinned(scene);
  const bones = {};
  root.traverse(o => {
    if (o.isBone) bones[o.name.replace(/_\d+$/, '')] = o;
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  if (!DRIVEN.every(n => bones[n]) || !bones.RightHand) return null;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const rest = {};
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  for (const n of DRIVEN) {
    const b = bones[n];
    // Decomposed rather than read off the matrix, so a scaled armature
    // (some exports work in centimetres) still gives a clean rotation.
    const K = new THREE.Quaternion();
    _m.multiplyMatrices(inv, b.parent.matrixWorld).decompose(_p, K, _s);
    rest[n] = { K, Ki: K.clone().invert(), q0: b.quaternion.clone() };
  }
  // How far the arms stand out from the sides in the rest pose (an A-pose),
  // so a zero angle means hanging down, as on the mannequin.
  const out = side => {
    const a = new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(inv, bones[`${side}Arm`].matrixWorld));
    const f = new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(inv, bones[`${side}ForeArm`].matrixWorld));
    return Math.atan2(Math.abs(f.x - a.x), a.y - f.y);
  };
  return { root, bones, rest, handRest: bones.RightHand.quaternion.clone(),
           splay: { l: out('Left'), r: out('Right') },
           hands: { l: hand(bones, 'Left', inv), r: hand(bones, 'Right', inv) } };
}

// ── hands ────────────────────────────────────────────────────────────────────
// Fingers curl toward the palm, each joint about the axis square to both the
// finger and the palm's normal — found from the rest pose, so it works for
// whichever way the rig's bones happen to be built. Curled all the way it is
// a fist, and a fist is what holds a spear: the shaft runs through it from
// the little finger to the index, not along the forearm.
const DIGITS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];
const CURL = { Index: [1.25, 1.45, 1.0], Middle: [1.3, 1.5, 1.0], Ring: [1.3, 1.5, 1.0],
               Pinky: [1.3, 1.45, 1.0], Thumb: [0.45, 0.55, 0.5] };

function hand(bones, side, inv) {
  const at = n => bones[n] && new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, bones[n].matrixWorld));
  const h = at(`${side}Hand`), i1 = at(`${side}HandIndex1`), p1 = at(`${side}HandPinky1`), t3 = at(`${side}HandThumb3`);
  if (!h || !i1 || !p1 || !t3) return null;
  // The palm's normal, pointing out of the palm: the side the thumb folds to.
  let flip = 1;
  const n = new THREE.Vector3().crossVectors(i1.clone().sub(h), p1.clone().sub(h)).normalize();
  if (n.dot(t3.clone().sub(h)) < 0) { n.negate(); flip = -1; }
  const joints = [];
  for (const d of DIGITS) {
    for (let k = 1; k <= 3; k++) {
      const b = bones[`${side}Hand${d}${k}`], next = at(`${side}Hand${d}${k + 1}`);
      if (!b || !next) continue;
      const dir = next.clone().sub(at(`${side}Hand${d}${k}`)).normalize();
      const axis = new THREE.Vector3().crossVectors(dir, n).normalize();
      const K = new THREE.Quaternion();
      new THREE.Matrix4().multiplyMatrices(inv, b.parent.matrixWorld).decompose(new THREE.Vector3(), K, new THREE.Vector3());
      joints.push({ b, axis, full: CURL[d][k - 1], K, Ki: K.clone().invert(), q0: b.quaternion.clone() });
    }
  }
  return { joints, flip, side };
}

const _c = new THREE.Quaternion();
/** Close a hand: 0 open, 1 a fist. */
function curl(h, k) {
  if (!h) return;
  for (const j of h.joints) {
    _c.setFromAxisAngle(j.axis, j.full * k);
    j.b.quaternion.copy(j.Ki).multiply(_c).multiply(j.K).multiply(j.q0);
  }
}

const _d = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'XYZ');
function drive(r, name, x, z = 0, y = 0) {
  _d.setFromEuler(_e.set(x, y, z));
  turnBone(r, name, _d);
}
function turnBone(r, name, d) {
  const b = r.bones[name], s = r.rest[name];
  b.quaternion.copy(s.Ki).multiply(d).multiply(s.K).multiply(s.q0);
}

// An elbow bends in the frame of the arm as it is *lowered*, not as it rests:
// the arm's turn is Rx(swing)·Rz(lower), so the forearm's is Rz(lower)⁻¹ ·
// Rx(bend) · Rz(lower) — lowered, bent, then carried by the arm's swing. A
// T-pose forearm points straight out sideways at rest, and a bend about the
// rest frame's x would not move it at all.
const _zq = new THREE.Quaternion(), _zi = new THREE.Quaternion(), _b = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
function elbow(r, name, lower, bend, twist = 0) {
  _zq.setFromAxisAngle(_Z, lower);
  _zi.copy(_zq).invert();
  _b.setFromEuler(_e.set(bend, twist, 0));
  turnBone(r, name, _zi.multiply(_b).multiply(_zq));
}

function applyRig(r, a) {
  r.bones.RightHand.quaternion.copy(r.handRest);     // rollHand() turns it from here
  const legs = a.legs ?? a.spread;
  drive(r, 'LeftUpLeg', a.thighL, -legs * 0.5);
  drive(r, 'RightUpLeg', a.thighR, legs * 0.5);
  drive(r, 'LeftLeg', a.kneeL);
  drive(r, 'RightLeg', a.kneeR);
  // The left arm is on the body's -x side: bringing it in from the A-pose
  // is a +z turn, opening it out a -z one; the right arm the mirror.
  const lowerL = r.splay.l - 0.1 - a.spread - (a.openL || 0);
  const lowerR = -r.splay.r + 0.1 + a.spread + (a.openR || 0);
  drive(r, 'LeftArm', a.armL, lowerL);
  drive(r, 'RightArm', a.armR, lowerR);
  elbow(r, 'LeftForeArm', lowerL, a.elbowL);
  // Turned in a little toward the midline as it comes up: a tool carried
  // out at the side is not carried.
  elbow(r, 'RightForeArm', lowerR, a.elbowR, a.foreInR || 0);
  // Hands loosely closed at rest — a flat hand looks like a mannequin's —
  // and the right one a fist round whatever it holds.
  curl(r.hands.l, 0.3);
  curl(r.hands.r, a.grip ?? 0.3);
  drive(r, 'Spine2', -a.chest);
  drive(r, 'Neck', a.neck * 0.45, 0, (a.turn || 0) * 0.45);
  drive(r, 'Head', a.neck * 0.55, 0, (a.turn || 0) * 0.55);
}

// ── gestures ─────────────────────────────────────────────────────────────────
// Each a duration and a curve from progress 0..1 to joint angles (and, for
// the spear, `aim`: how far it has turned from its carry to point where you
// look). The thrust keeps the first-person thrust's timing — draw back to
// 0.2, drive to 0.38, hold to 0.5, recover — so the two views agree on when
// the point arrives.
const ease = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const GESTURES = {
  swing: { time: 0.45, pose: u => {
    const up = Math.sin(Math.min(1, u / 0.35) * Math.PI / 2), down = u > 0.35 ? (u - 0.35) / 0.65 : 0;
    return { armR: 0.3 + 1.7 * up * (1 - down) - 0.5 * Math.sin(down * Math.PI), elbowR: 0.6 };
  } },
  thrust: { time: 0.5,
    aim: u => ease(u / 0.12) * (1 - ease((u - 0.62) / 0.3)),
    pose: (u, a) => {
      let arm, elbow, lean;
      if (u < 0.2) { const k = ease(u / 0.2); arm = 0.3 - 0.5 * k; elbow = 1.1 + 0.45 * k; lean = -0.06 * k; }
      else if (u < 0.38) { const k = ease((u - 0.2) / 0.18); arm = -0.2 + 1.1 * k; elbow = 1.55 - 1.25 * k; lean = -0.06 + 0.3 * k; }
      else if (u < 0.5) { arm = 0.9; elbow = 0.3; lean = 0.24; }
      else { const k = ease((u - 0.5) / 0.5); arm = 0.9 - 0.6 * k; elbow = 0.3 + 0.8 * k; lean = 0.24 * (1 - k); }
      // The body leans into it and the free arm swings back against it, the
      // way you balance a push — low, not raised.
      const drive = Math.max(0, lean) / 0.24;
      return { armR: arm, elbowR: elbow, foreInR: 0.1, chest: (a.chest || 0) + lean,
               armL: 0.05 - 0.35 * drive, elbowL: 0.25 + 0.15 * drive };
    } },
  // A javelin throw at head height: the hand drawn back beside the head, the
  // elbow out, the spear level and pointing where you look; then the forearm
  // snaps forward and the arm reaches out level in front, and the spear goes
  // from there — at u = 0.45 (0.27 s, THROW_RELEASE in main.js) — straight
  // ahead, not flung down from overhead. The free arm points at the target
  // and pulls down as the throw comes through.
  // (Aimed a little past the release: the throw's clock and main.js's run a
  // frame apart, and the spear must not flip upright on its way out.)
  throw: { time: 0.6, aim: u => (u < 0.6 ? 1 : 0), pose: u => {
    const k = ease((u - 0.18) / 0.27), f = ease((u - 0.45) / 0.55);
    let arm, elbow, open, lean;
    if (u < 0.18) { const c = ease(u / 0.18); arm = 0.3 + 1.3 * c; elbow = 1.1 + 1.3 * c; open = 0.5 * c; lean = -0.12 * c; }
    else if (u < 0.45) { arm = 1.6 - 0.1 * k; elbow = 2.4 - 2.2 * k; open = 0.5 - 0.4 * k; lean = -0.12 + 0.37 * k; }
    else { arm = 1.5 - 0.9 * f; elbow = 0.2 + 0.4 * f; open = 0.1 * (1 - f); lean = 0.25 * (1 - f); }
    const point = u < 0.45 ? 1 - k : 0;
    return { armR: arm, elbowR: elbow, openR: open, foreInR: 0.05, chest: lean,
             armL: 0.1 + 1.3 * point, elbowL: 0.15 };
  } },
  eat: { time: 0.7, pose: u => {
    const k = Math.sin(Math.PI * u);
    return { armR: 0.3 + 0.7 * k, elbowR: 1.1 + 1.25 * k, foreInR: 0.15 + 0.35 * k, neck: -0.15 * k };
  } },
  toss: { time: 0.45, pose: u => {
    const back = ease(u / 0.35), fwd = ease((u - 0.35) / 0.3);
    return { armR: u < 0.35 ? 0.2 - 0.8 * back : -0.6 + 2.0 * fwd, elbowR: 0.3 };
  } },
};

// ── swimming ─────────────────────────────────────────────────────────────────
// Three ways of being in the water, each a curve from a stroke's progress
// 0..1 to joint angles — the body's frame, as it lies: face down, an arm at
// π points ahead past the head, at π/2 down into the water, at -π/2 up out
// of it. The crawl and breaststroke are swum lying out (PlayerBody.pose tips
// the body over); treading water is upright.
const TAU = Math.PI * 2;
const PULL = 0.6;                      // of a crawl stroke, the part under water

/** One arm's crawl: a long pull under the body, a quick high-elbow recovery over it. */
function crawlArm(u) {
  if (u < PULL) {
    const k = u / PULL;
    return { arm: Math.PI * (1 - ease(k)), elbow: 0.2 + 0.85 * Math.sin(Math.PI * k), open: 0 };
  }
  const k = (u - PULL) / (1 - PULL);
  // Swung out wide, the elbow up, the forearm hanging from it: the hand
  // comes forward low over the water rather than windmilling over the top.
  return { arm: -Math.PI * k, elbow: 0.3 + 1.6 * Math.sin(Math.PI * k), open: 0.85 * Math.sin(Math.PI * k) };
}

const STROKES = {
  // Front crawl, at the surface: the arms half a stroke apart, the body
  // rolling toward each pull, a breath to the right every second stroke,
  // and six kicks a stroke from the hips.
  crawl: { time: 1.35, pose: (u, n) => {
    const L = crawlArm((u + 0.5) % 1), R = crawlArm(u);
    const kick = Math.sin(u * TAU * 3);
    const breathe = n % 2 === 1 && u > 0.5 && u < 0.98 ? Math.sin(Math.PI * (u - 0.5) / 0.48) : 0;
    return { armL: L.arm, elbowL: L.elbow, openL: L.open, armR: R.arm, elbowR: R.elbow, openR: R.open,
             thighL: 0.24 * kick, thighR: -0.24 * kick,
             kneeL: -(0.12 + 0.4 * Math.max(0, Math.cos(u * TAU * 3))),
             kneeR: -(0.12 + 0.4 * Math.max(0, -Math.cos(u * TAU * 3))),
             spread: 0.04, legs: 0.08, neck: 0.3 + 0.15 * breathe, turn: -1.1 * breathe,
             roll: 0.45 * Math.cos(TAU * (u - 0.3)) - 0.25 * breathe };
  } },
  // Breaststroke, under water: the arms sweep out and round to the chest,
  // then shoot forward as the legs draw up and kick back together, then a
  // glide, arms ahead.
  breast: { time: 1.7, pose: u => {
    let arm, elbow, open, knee = 0, thigh = 0, legs = 0.06;
    if (u < 0.32) { const k = ease(u / 0.32); arm = Math.PI - 0.95 * k; elbow = 1.5 * k; open = 0.95 * Math.sin(Math.PI * Math.min(1, k * 1.3)); }
    else if (u < 0.45) { const k = ease((u - 0.32) / 0.13); arm = Math.PI - 0.95 - 0.25 * k; elbow = 1.5 + 0.5 * k; open = 0.12 * (1 - k); }
    else if (u < 0.65) { const k = ease((u - 0.45) / 0.2); arm = Math.PI - 1.2 + 1.2 * k; elbow = 2.0 * (1 - k); open = 0; }
    else { arm = Math.PI; elbow = 0.05; open = 0; }
    if (u > 0.36 && u < 0.56) { const k = Math.sin(Math.PI / 2 * (u - 0.36) / 0.2); knee = -1.9 * k; thigh = 0.55 * k; legs = 0.06 + 0.7 * k; }
    else if (u >= 0.56 && u < 0.74) { const k = ease((u - 0.56) / 0.18); knee = -1.9 * (1 - k); thigh = 0.55 * (1 - k); legs = 0.76 - 0.7 * k; }
    return { armL: arm, armR: arm, elbowL: elbow, elbowR: elbow, openL: open, openR: open,
             thighL: thigh, thighR: thigh, kneeL: knee, kneeR: knee, spread: 0.02, legs,
             neck: 0.35, roll: 0 };
  } },
  // Treading water: upright, hands sculling in and out in front, the legs
  // in an alternating eggbeater, the whole body bobbing with it.
  tread: { time: 1.6, pose: u => {
    const s = Math.sin(u * TAU), c = Math.cos(u * TAU);
    return { armL: 0.75, armR: 0.75, elbowL: 1.0, elbowR: 1.0, openL: 0.3 + 0.35 * s, openR: 0.3 + 0.35 * s,
             thighL: 0.85 + 0.25 * s, thighR: 0.85 - 0.25 * s, kneeL: -1.25 + 0.35 * c, kneeR: -1.25 - 0.35 * c,
             spread: 0.04, legs: 0.55 + 0.12 * c, neck: 0, roll: 0, bob: 0.035 * Math.sin(u * TAU * 2) };
  } },
};

/** Blend two poses: from `a` toward `b` by k, joint by joint. */
function blend(a, b, k) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key] ?? 0, y = b[key] ?? 0;
    out[key] = x + (y - x) * k;
  }
  return out;
}

// ── the body ─────────────────────────────────────────────────────────────────
export class PlayerBody {
  constructor(scene) {
    this.group = new THREE.Group();          // at the feet, turned to face where the player faces
    this.pivot = new THREE.Group();          // at eye height: swimming lies the body down about the head
    this.pivot.position.y = EYE;
    this.group.add(this.pivot);
    this.frame = new THREE.Group();          // the body's own frame, feet at 0
    this.frame.position.y = -EYE;
    this.pivot.add(this.frame);
    scene.add(this.group);
    this.scene = scene;

    this.stand = mannequin();
    this.frame.add(this.stand.root);
    this.rig = null;
    this.who = null;

    this.phase = 0;
    this.lastPos = new THREE.Vector3();
    this.speed = 0;
    this.use = 1;                            // 0..1 through a use gesture; 1 = none
    this.held = null;
    this.heldId = null;
    this.swim = 0;                           // 0 treading water upright .. 1 lying out, swimming
    this.under = 0;                          // 0 at the surface (crawl) .. 1 under it (breaststroke)
    this.tilt = 0;                           // how far the body is tipped over, about the head
    this.stroke = { crawl: 0, breast: 0, tread: 0 };   // each stroke's progress, in strokes
    this.useKind = 'swing';
    this.aimK = 0;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.gripPos = new THREE.Vector3();
    this.skewered = null;
    this._fore = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  set visible(v) { this.group.visible = v; if (this.held) this.held.visible = v; }
  get visible() { return this.group.visible; }

  /**
   * Dress as one of the characters — 'woman' or 'man' — from its .glb, or
   * stay the mannequin if the file is not there. Returns whether it worked.
   */
  async wear(who, library) {
    this.who = who;
    const entry = await library.get(`player_${who}`);
    if (this.who !== who) return false;      // changed your mind while it loaded
    const r = entry && rigged(entry.scene);
    if (this.rig) this.frame.remove(this.rig.root);
    this.rig = r;
    // The stand-in out of the scene altogether, not just hidden, while a
    // character is worn.
    if (r) { this.frame.remove(this.stand.root); this.frame.add(r.root); }
    else this.frame.add(this.stand.root);
    this.hold(this.heldId, this.held, true);
    return !!r;
  }

  /** Put an object (a clone of what is in hand) in the right hand, or none. */
  hold(id, obj, again = false) {
    if (id === this.heldId && !again) return;
    if (this.held && this.held !== obj) this.held.removeFromParent();
    this.heldId = id;
    this.held = obj || null;
    // A tool is gripped through the fist; anything else rests in the palm.
    this.heldTool = !!ITEMS[id]?.tool && id !== 'bowdrill';
    if (!this.held) return;
    this.held.updateMatrixWorld(true);
    this.heldRadius = new THREE.Box3().setFromObject(this.held).getBoundingSphere(new THREE.Sphere()).radius;
    this.held.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    if (this.rig) {
      // Placed each frame at the rig's hand (see update); lives in the world.
      this.scene.add(this.held);
    } else {
      // Items are built standing along +Y from the grip; the mannequin's
      // round hand holds them up and forward from the end of the forearm.
      this.held.rotation.set(-Math.PI / 2 + 0.6, 0, 0);
      this.stand.j.grip.add(this.held);
    }
    this.held.visible = this.group.visible;
  }

  /**
   * Use what is in hand, seen from outside: 'thrust' (the spear, driven
   * forward along where you look), 'throw' (overhand, the spear gone from the
   * hand), 'swing' (the hammer's overhead strike), 'eat' (hand to mouth) or
   * 'toss' (the hook, underarm).
   */
  gesture(kind = 'swing') {
    this.useKind = GESTURES[kind] ? kind : 'swing';
    this.use = 0;
  }

  /** Where a thrown thing leaves the hand, in the world. */
  gripWorld(out) {
    if (this.rig) return out.copy(this.gripPos);
    return this.stand.j.grip.getWorldPosition(out);
  }

  /**
   * A fish on the point of the spear in hand, for a thrust that caught it:
   * shown as long as it is in the first-person view, then gone to the bag.
   */
  skewer(mesh) {
    if (!this.held || !mesh) return;
    this.clearSkewer();
    mesh.position.set(0, 0.7, 0);
    mesh.rotation.set(0, 0.9, Math.PI / 2);
    this.held.add(mesh);
    this.skewered = { mesh, t: 0 };
  }

  clearSkewer() {
    const k = this.skewered;
    if (!k) return;
    k.mesh.removeFromParent();
    k.mesh.geometry?.dispose();
    k.mesh.material?.dispose?.();
    this.skewered = null;
  }

  /**
   * @param p  the player: pos (feet), yaw, pitch, state ('deck' | 'air' |
   *           'swim'), submerged (head under), and optionally speed, to
   *           animate without moving
   */
  update(dt, p) {
    const g = this.group;
    g.position.copy(p.pos);
    g.rotation.y = p.yaw;
    // Under water, going up or down is swimming too.
    const up = p.state === 'swim' && p.submerged ? p.pos.y - this.lastPos.y : 0;
    const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z, up) / Math.max(dt, 1e-4);
    this.lastPos.copy(p.pos);
    // `p.speed` stands in for real movement (the gallery walks it on the spot).
    this.speed += (Math.min(p.speed ?? moved, 8) - this.speed) * Math.min(1, dt * 8);

    // Where you are looking, for a spear driven at it.
    const cp = Math.cos(p.pitch);
    this.aimDir.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
    const a = this.pose(dt, p);
    if (this.rig) applyRig(this.rig, a); else applyMannequin(this.stand, a);
    if (this.rig && this.held) {
      if (this.heldTool) this.rollHand(p);
      this.placeHeld();
    }
  }

  /** This frame's joint angles, from what the player is doing. */
  pose(dt, p) {
    const v = this.speed;
    const swimming = p.state === 'swim';
    const air = p.state === 'air';
    // Swimming somewhere, lying out: a crawl at the surface, breaststroke
    // under it. Not going anywhere, upright, treading water.
    this.swim += ((swimming && v > 0.6 ? 1 : 0) - this.swim) * Math.min(1, dt * 3);
    this.under += ((swimming && p.submerged ? 1 : 0) - this.under) * Math.min(1, dt * 2.5);

    // The stride: faster and longer the faster you go.
    const stride = swimming ? 0 : Math.min(1, v / 5);
    this.phase += dt * (1.6 + v * 1.9);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    let a = { spread: 0.06, chest: 0, neck: 0 };
    let roll = 0, bob = 0;

    if (swimming) {
      // Each stroke keeps its own count, quicker the faster you go, so
      // changing from one to another does not jump either.
      const pace = 0.75 + 0.25 * Math.min(1.6, v / 1.6);
      for (const k in this.stroke) this.stroke[k] += dt / STROKES[k].time * (k === 'tread' ? 1 : pace);
      const at = k => { const n = Math.floor(this.stroke[k]); return STROKES[k].pose(this.stroke[k] - n, n); };
      const going = blend(at('crawl'), at('breast'), this.under);
      a = { chest: 0, ...blend(at('tread'), going, this.swim) };
      roll = a.roll; bob = a.bob;
      // A tool in hand goes ahead of you, where you are looking — a spear
      // ready — and the other arm and the legs do the swimming.
      if (this.heldTool) {
        Object.assign(a, { armR: 0.75 + (Math.PI - 0.85 - 0.75) * this.swim, elbowR: 0.9 * (1 - this.swim) + 0.15,
                           openR: 0.1, foreInR: 0.1 });
        roll *= 0.4;
      }
      // Lying out at the surface, the body is in the water, not on it: the
      // head drops from treading height to the waterline.
      const lie = -(Math.PI / 2 - 0.2);
      const dive = THREE.MathUtils.clamp(p.pitch, -1.3, 1.1) * 0.9;
      const want = -0.12 + (lie + dive * this.under + 0.12) * this.swim;
      this.tilt += (want - this.tilt) * Math.min(1, dt * 4);
    } else {
      this.tilt += (0 - this.tilt) * Math.min(1, dt * 8);
      for (const k in this.stroke) this.stroke[k] = 0;
    }
    this.pivot.rotation.set(this.tilt, roll * this.swim, 0);
    this.pivot.position.y = EYE - 0.34 * this.swim * (1 - this.under);

    if (air) {
      a.thighL = 0.6; a.thighR = 0.25; a.kneeL = -0.95; a.kneeR = -0.55;
      a.armL = a.armR = 0.35; a.elbowL = a.elbowR = 0.4; a.spread = 0.25;
    } else if (!swimming) {
      a.thighL = s * 0.62 * stride; a.thighR = -a.thighL;
      a.kneeL = -Math.max(0, -s) * 0.95 * stride - 0.04;
      a.kneeR = -Math.max(0, s) * 0.95 * stride - 0.04;
      a.armL = -s * 0.5 * stride; a.armR = -a.armL;
      a.elbowL = a.elbowR = 0.15 + 0.45 * stride;
      a.chest = 0.1 * stride;                // leaning into it
    }
    // A step bobs the body; so does treading water.
    this.frame.position.y = -EYE + (swimming ? bob : air ? 0 : Math.abs(c) * 0.035 * stride);

    // Carrying something: the right forearm comes up to hold it out, and a
    // use swings the arm up and through.
    if (this.held && !swimming) {
      a.armR = 0.3 + a.armR * 0.3;
      a.elbowR = 1.1;
      a.foreInR = 0.15;
    }
    // A fist round a tool, cupped round anything else.
    a.grip = this.held ? (this.heldTool ? 1 : 0.6) : 0.3;
    // A use: the arm (and for a spear, the spear's heading) through its
    // gesture. Each is a curve from progress 0..1 to the joints it moves.
    this.aimK = 0;
    if (this.use < 1) {
      const gst = GESTURES[this.useKind];
      this.use = Math.min(1, this.use + dt / gst.time);
      Object.assign(a, gst.pose(this.use, a));
      this.aimK = gst.aim ? gst.aim(this.use) : 0;
    } else if (swimming && this.heldTool) this.aimK = this.swim;
    if (this.skewered && (this.skewered.t += dt) > 1.7) this.clearSkewer();
    if (!swimming) a.neck = THREE.MathUtils.clamp(p.pitch, -0.9, 0.7) * 0.8;
    // Treading water, you look where you are looking.
    else a.neck += THREE.MathUtils.clamp(p.pitch, -0.9, 0.7) * 0.8 * (1 - this.swim);
    return a;
  }

  /**
   * Turn the fist about the forearm — the twist a forearm has, not a bent
   * wrist — so what it grips lines up with the way it should point: carried
   * upright and a little forward, or mid-thrust and mid-throw where you look.
   * Characters differ in how their hands sit at rest (the woman's rig rests
   * in an A-pose, palms in; the man's in a T-pose, palms down), and without
   * this the same pose would carry a spear upright in one and slantwise
   * across the body in the other.
   */
  rollHand(p) {
    const b = this.rig.bones;
    this.rig.root.updateMatrixWorld(true);
    const fore = b.RightForeArm.getWorldPosition(new THREE.Vector3());
    const hand = b.RightHand.getWorldPosition(new THREE.Vector3());
    const axis = hand.clone().sub(fore).normalize();
    const index = b.RightHandIndex1.getWorldPosition(new THREE.Vector3());
    const pinky = b.RightHandPinky1.getWorldPosition(new THREE.Vector3());
    const fist = index.sub(pinky).normalize();
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const want = new THREE.Vector3(0, 1, 0).addScaledVector(fwd, 0.3).normalize()
      .lerp(this.aimDir, this.aimK).normalize();
    // Both onto the plane square to the forearm: the roll is the angle
    // between them there. Nothing to do if what it should point along is the
    // forearm itself.
    const a = fist.addScaledVector(axis, -fist.dot(axis));
    const w = want.addScaledVector(axis, -want.dot(axis));
    if (a.lengthSq() < 1e-4 || w.lengthSq() < 0.04) return;
    a.normalize(); w.normalize();
    let ang = Math.acos(THREE.MathUtils.clamp(a.dot(w), -1, 1));
    if (new THREE.Vector3().crossVectors(a, w).dot(axis) < 0) ang = -ang;
    ang = THREE.MathUtils.clamp(ang, -1.7, 1.7);
    // A world-space turn about the forearm, put into the hand bone's frame.
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    const parentQ = b.RightHand.parent.getWorldQuaternion(new THREE.Quaternion());
    const handQ = b.RightHand.getWorldQuaternion(new THREE.Quaternion());
    b.RightHand.quaternion.copy(parentQ.invert().multiply(turn).multiply(handQ));
    b.RightHand.updateMatrixWorld(true);
  }

  /**
   * The held item in the rig's right hand, where the fist closes on it. A
   * tool's shaft runs through the fist, across the palm from the little
   * finger to the index, working end up the index side; anything else sits
   * in the cupped palm.
   */
  placeHeld() {
    const b = this.rig.bones, h = this.rig.hands.r;
    this.held.visible = this.group.visible;
    const w = (bone, out) => bone.getWorldPosition(out);
    const hand = w(b.RightHand, this._hand), knuck = w(b.RightHandMiddle1, this._fore);
    const index = w(b.RightHandIndex1, new THREE.Vector3()), pinky = w(b.RightHandPinky1, new THREE.Vector3());
    const across = index.clone().sub(pinky).normalize();
    const palm = new THREE.Vector3().crossVectors(index.clone().sub(hand), pinky.clone().sub(hand)).normalize()
      .multiplyScalar(h ? h.flip : 1);
    // The middle of the grip: most of the way to the knuckles, and in from
    // the palm by about the half-thickness of a closed hand.
    const grip = hand.clone().lerp(knuck, 0.8).addScaledVector(palm, 0.028);
    this.gripPos.copy(grip);
    if (this.heldTool) {
      this.held.position.copy(grip);
      // Mid-thrust the spear turns from its carry to point where you look.
      const dir = this.aimK > 0 ? across.clone().lerp(this.aimDir, this.aimK).normalize() : across;
      this.held.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    } else {
      const fingers = knuck.clone().sub(hand).normalize();
      this.held.position.copy(grip).addScaledVector(palm, Math.min(this.heldRadius * 0.6, 0.12));
      this.held.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fingers);
    }
  }
}
