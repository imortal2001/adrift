// ── How the dinosaurs move, on top of their clips ───────────────────────────
// The five models share one set of clips — idle, walk, run, attack, death —
// made to look like the films, not like the animals. What the palaeontology
// says they did differently is put right here, after the clip has posed the
// skeleton each frame (wildlife.js draw()):
//
//   tyrannosaur  An adult could not run: no moment with both feet off the
//                ground, only a fast walk — about 1.3 m/s at ease, 5–8 at most
//                (Hutchinson & Garcia 2002, Nature 415:1018; Sellers et al.
//                2017, PeerJ 5:e3420; van Bijlert et al. 2021, R. Soc. Open
//                Sci. 8:201441). Feeds by puncture and pull: bite, then yank
//                the head up and aside (Snively & Russell 2007).
//   raptor       The mouth shut at rest (the clips leave it hanging open).
//                At a kill, the prey pinned under the feet and eaten where it
//                lies, the arms flapping for balance ("raptor prey restraint",
//                Fowler et al. 2011, PLoS ONE 6:e28964). The sickle claw is
//                already carried off the ground, as the two-toed trackways
//                show it was (Li et al. 2008).
//   parasaur     Walked on all fours, ran on two (Maidment & Barrett 2014,
//                Biol. Rev. 89:1); fed on four, up to ~2 m (Mallon et al.
//                2013). Tail stiffened by ossified tendons and held level off
//                the ground (Organ 2006) — the model's droops to the ground.
//                Chews: a grinding battery of teeth (Erickson et al. 2012).
//   stegosaur    Never ran: graviportal, a walk of ~0.8 m/s in the trackways
//                (Deltapodus, 2024) and no more than ~1.5 at a push. Fed low,
//                under a metre, with a weak snipping bite (Reichel 2010).
//                Turned its tail on a predator and swung the spikes sideways
//                (Carpenter et al. 2005; Mallison 2011) — see wildlife.js.
//   sauropod     Neck raised, but not upright: the mid-neck ~60–70° above
//                level at rest and ~20° lower on the move (Christian & Dzemski
//                2007; Taylor, Wedel & Naish 2009) — the model holds it
//                near-vertical. A walk only, ~2 m/s at most (Sellers et al.
//                2013). No chewing: nip, and swallow.
//   not done     Resting: theropods crouched like birds, on the shins (Milner
//                et al. 2009) — these rigs' leg bones do not sit at the joints
//                (the "foot" is above the "knee" standing), so two-bone IK
//                cannot fold them; it wants a model with a resting clip.
//                Nor the theropods' palms-inward hands and the raptor's wing
//                feathers: those are the models' own shape.
//
// Everything is done in world space against the bones as the clip left them,
// so it needs no knowledge of how each rig's bones are oriented: a turn about
// the body's own side axis pitches, about its forward axis rolls.

import * as THREE from 'three';

/** Per species: how the gait is played, and which corrections apply. */
export const MOTION = {
  tyrannosaur: { run: false, maxRate: 2.7, feed: 'pull' },
  raptor:      { jawClose: 20, feed: 'pin' },
  // (`fours` — dropping onto the hands to walk and feed — is written, but this
  // model's arms are 40% of its legs and its shoulders stand above its hips:
  // it would take a 57° pitch to reach the ground. A model with a hadrosaur's
  // forelimbs, ~55–60% of the hind, can have it back.)
  parasaur:    { tail: -4, graze: 'grind', lean: 0.55 },
  stegosaur:   { run: false, maxRate: 3, maxStride: 1.45, graze: 'snip' },
  sauropod:    { run: false, neck: { rest: 66, walk: 46, feed: 74 }, graze: 'nip' },
};

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _f = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x, goal, dt, rate = 3) => x + (goal - x) * Math.min(1, dt * rate);

/** Turn a bone by `angle` about a world-space axis, keeping it where it is. */
function turn(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.parent.getWorldQuaternion(_pq);
  _wq.copy(_pq).multiply(bone.quaternion);
  _q.setFromAxisAngle(axis, angle);
  _wq.premultiply(_q);
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateMatrixWorld(true);
}

/** Turn a bone so that the direction from it to `from` points to `to` instead (world points). */
function aim(bone, from, to) {
  const o = bone.getWorldPosition(_e);
  const u = _a.copy(from).sub(o).normalize(), v = _b.copy(to).sub(o).normalize();
  if (u.lengthSq() < 1e-8 || v.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(u, v);
  bone.parent.getWorldQuaternion(_pq);
  _wq.copy(_pq).multiply(bone.quaternion).premultiply(_q);
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: turn `upper` and `lower` so that `end` reaches `target`, the
 * middle joint bending the way it already bends (so a knee stays a knee) — or
 * toward `pole`, a world direction, when it is given.
 */
function reach(upper, lower, end, target, pole = null) {
  const pa = upper.getWorldPosition(new THREE.Vector3());
  const pb = lower.getWorldPosition(new THREE.Vector3());
  const pc = end.getWorldPosition(new THREE.Vector3());
  const la = pa.distanceTo(pb), lb = pb.distanceTo(pc);
  const d = THREE.MathUtils.clamp(pa.distanceTo(target), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  const dir = _c.copy(target).sub(pa).normalize();
  // The way the joint points now, square to the line from root to end.
  const mid = _d.copy(pa).lerp(pc, la / (la + lb));
  const bend = pole ? _f.copy(pole) : _f.copy(pb).sub(mid);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dir, -dir.z);
  bend.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const knee = pa.clone().addScaledVector(dir, la * cosA).addScaledVector(bend, la * Math.sqrt(1 - cosA * cosA));
  aim(upper, pb, knee);
  aim(lower, end.getWorldPosition(new THREE.Vector3()), target);
}

/**
 * The bones a species' corrections work on, found once per rig — when it is
 * made (wildlife.js), since finding which way the jaw opens plays the clips.
 */
export function prepareDino(rig) {
  if (rig.dino || !rig.root) return rig.dino;
  const all = [];
  rig.root.traverse(o => { if (o.isBone) all.push(o); });
  const one = re => all.find(o => re.test(o.name)) || null;
  const chain = re => all.filter(o => re.test(o.name) && !/_end/.test(o.name));
  const b = rig.dino = {
    pelvis: one(/^bip_pelvis/),
    spine: chain(/^bip_spine_\d/),
    neck: chain(/^bip_neck/),
    head: one(/^bip_head/),
    jaw: one(/^bip_jaw/),
    tail: chain(/^bip_tail/),
    leg: ['l', 'r'].map(s => ({ hip: one(new RegExp(`^bip_hip_${s}_`)), knee: one(new RegExp(`^bip_knee_${s}_`)),
                                 foot: one(new RegExp(`^bip_foot_${s}_`)) })),
    arm: ['l', 'r'].map(s => ({ upper: one(new RegExp(`^bip_upperarm_${s}_`)), lower: one(new RegExp(`^bip_lowerarm_${s}_`)),
                                 hand: one(new RegExp(`^bip_hand_${s}_`)) })),
    w: { graze: 0, feed: 0, fours: 0, walk: 0, jaw: 1 },
  };
  // Which way the jaw opens: from the walk (shut) to the widest the attack opens it.
  if (b.jaw && rig.actions?.walk && rig.actions?.attack) {
    const pose = (act, t) => { rig.mixer.stopAllAction(); act.reset().play(); act.time = t; rig.mixer.update(0); return b.jaw.quaternion.clone(); };
    const shut = pose(rig.actions.walk, 0);
    let open = shut, best = 0;
    const dur = rig.actions.attack.getClip().duration;
    for (let i = 0; i < 16; i++) {
      const q = pose(rig.actions.attack, (dur * i) / 16);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(shut))));
      if (ang > best) { best = ang; open = q; }
    }
    const delta = shut.clone().invert().multiply(open);
    b.jawAxis = new THREE.Vector3(delta.x, delta.y, delta.z).normalize();
  }
  rig.mixer?.stopAllAction();
  rig.current = null;
  return b;
}

/** The body's own axes, from its heading: forward, and side (to its right). */
function axes(a) {
  const h = a.heading;
  return { fwd: new THREE.Vector3(Math.sin(h), 0, Math.cos(h)), side: new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)) };
}

/** Where each end of a chain is, and its angle above level (degrees), along the body. */
function elevation(from, to, fwd) {
  const p = from.getWorldPosition(new THREE.Vector3()), q = to.getWorldPosition(new THREE.Vector3());
  const along = q.clone().sub(p);
  return Math.atan2(along.y, Math.max(1e-4, along.dot(fwd))) * THREE.MathUtils.RAD2DEG;
}

/**
 * Pose a model rig for what the animal is doing — after the clip, every frame
 * it is drawn. `a` is the animal (wildlife.js), `time` the clock for the
 * rhythmic parts (chewing, tugging, flapping).
 */
export function poseDino(a, dt, time) {
  const m = MOTION[a.key], rig = a.rig;
  if (!m || !rig.model || !rig.root || a.dead) return;
  const b = rig.dino, w = b?.w;
  if (!b?.pelvis) return;
  const { fwd, side } = axes(a);
  const moving = Math.min(1, Math.abs(a.speed) / Math.max(0.3, a.sp.walk));
  const grazing = (a.state === 'graze' || (a.state === 'feed' && a.sp.diet === 'plants')) && a.speed < 0.2;
  const drinking = grazing && a.drinking;
  const eating = a.state === 'feed' && a.sp.diet === 'meat' && a.speed < 0.3;
  const striking = a.bite > a.sp.biteEvery - 0.5;
  w.graze = smooth(w.graze, grazing ? 1 : 0, dt, 1.5);
  w.feed = smooth(w.feed, eating ? 1 : 0, dt, 2);
  w.walk = smooth(w.walk, moving, dt, 2);
  rig.root.updateMatrixWorld(true);

  // ── the hadrosaur on all fours: walking at ease, or feeding.
  if (m.fours) {
    const alert = a.state === 'hunt' || a.state === 'flee';
    const goal = alert || a.speed > a.sp.walk * 1.6 ? 0 : 1;
    w.fours = smooth(w.fours, goal, dt, 1.4);
    if (w.fours > 0.01) {
      const arm = b.arm[0];
      if (arm.upper && arm.hand) {
        const sh = arm.upper.getWorldPosition(new THREE.Vector3());
        const pel = b.pelvis.getWorldPosition(new THREE.Vector3());
        const ground = a.y;
        const len = arm.upper.getWorldPosition(new THREE.Vector3()).distanceTo(arm.lower.getWorldPosition(new THREE.Vector3())) +
                    arm.lower.getWorldPosition(new THREE.Vector3()).distanceTo(arm.hand.getWorldPosition(new THREE.Vector3()));
        // Pitch the body forward about the hips until the shoulders are an arm's length up.
        const span = Math.hypot(sh.x - pel.x, sh.z - pel.z) || 1;
        const drop = Math.max(0, (sh.y - ground) - len * 0.97);
        const pitch = Math.asin(Math.min(0.9, drop / span)) * w.fours;
        turn(b.pelvis, side, pitch);
        // Legs and tail kept as they were: only the front of the body goes down.
        for (const l of b.leg) turn(l.hip, side, -pitch);
        turn(b.tail[0], side, -pitch);
        // Hands to the ground, under the shoulders, a little ahead.
        for (const r of b.arm) {
          if (!r.upper || !r.lower || !r.hand) continue;
          const s = r.upper.getWorldPosition(new THREE.Vector3());
          const hand = r.hand.getWorldPosition(new THREE.Vector3());
          const target = hand.clone().lerp(new THREE.Vector3(s.x + fwd.x * 0.15 * len, ground + 0.04 * len, s.z + fwd.z * 0.15 * len), w.fours);
          // On the move the hands step with the feet: lift one as the other plants.
          if (a.speed > 0.1) target.y += Math.max(0, Math.sin(time * 3.4 * a.pace + (r === b.arm[0] ? 0 : Math.PI))) * 0.12 * len * w.fours;
          reach(r.upper, r.lower, r.hand, target);
        }
      }
    }
  }

  // ── a tail held level (the hadrosaur's, stiff with ossified tendons).
  if (m.tail !== undefined && b.tail.length > 2) {
    const now = elevation(b.tail[0], b.tail.at(-1), fwd.clone().negate());
    // (A turn about the side axis lifts what points back, as it lowers what points ahead.)
    turn(b.tail[0], side, (m.tail - now) * THREE.MathUtils.DEG2RAD * 0.9);
  }

  // ── the sauropod's neck: raised, not upright; lower on the move, higher to feed.
  if (m.neck && b.neck.length > 2 && b.head) {
    // Browsing, the neck goes up to the crowns; drinking, all the way down to the water.
    const goal = THREE.MathUtils.lerp(THREE.MathUtils.lerp(m.neck.rest, m.neck.walk, w.walk), drinking ? -10 : m.neck.feed, w.graze);
    const now = elevation(b.neck[0], b.head, fwd);
    const delta = (now - goal) * THREE.MathUtils.DEG2RAD;
    // Most of it at the base, the rest along the neck; the head kept near level.
    turn(b.neck[0], side, delta * 0.6);
    turn(b.neck[Math.floor(b.neck.length / 2)], side, delta * 0.4);
    turn(b.head, side, -delta * 0.8);
  }

  // ── head down: grazing, or at a kill.
  const down = Math.max(w.graze * (m.neck && !drinking ? 0 : 1), w.feed);
  if (down > 0.01 && b.neck.length && b.head) {
    const head = b.head.getWorldPosition(new THREE.Vector3());
    const reachTo = a.y + (a.rig.size?.y ?? 2) * (m.graze === 'snip' ? 0.12 : 0.18);
    const drop = Math.max(0, head.y - reachTo);
    const neckLen = b.neck[0].getWorldPosition(new THREE.Vector3()).distanceTo(head) || 1;
    const bow = Math.min(1.25, Math.asin(Math.min(1, drop / (neckLen * 1.4)))) * down;
    // Carnivores lean into it with the body too, and so does a grazer that
    // stands tall (the hadrosaur): the head goes down to the plants, not just
    // curled under.
    const lean = w.feed > 0.01 ? 0.35 : (m.lean ?? 0);
    if (lean && b.spine.length) turn(b.spine[0], side, bow * lean);
    for (const n of b.neck) turn(n, side, (bow * (1 - lean * 0.6)) / b.neck.length);
    // Puncture and pull: the bite held, then a yank up and aside.
    if (w.feed > 0.01 && m.feed === 'pull') {
      const tug = Math.max(0, Math.sin(time * 2.1 + a.pace * 5)) ** 3 * w.feed;
      turn(b.neck.at(-1), side, -0.35 * tug);
      turn(b.head, UP, 0.3 * tug * Math.sign(Math.sin(time * 0.37 + a.pace * 9)));
    }
    // Pinned under the feet and torn at in quick jerks; the arms flapping for balance.
    if (w.feed > 0.01 && m.feed === 'pin') {
      turn(b.head, side, -0.25 * Math.max(0, Math.sin(time * 5.5 + a.pace * 3)) * w.feed);
      const flap = (0.25 + 0.25 * Math.sin(time * 7 + a.pace)) * w.feed;
      if (b.arm[0].upper) turn(b.arm[0].upper, fwd, -flap);
      if (b.arm[1].upper) turn(b.arm[1].upper, fwd, flap);
    }
  }

  // ── the jaw: shut at rest; working as it feeds.
  if (b.jaw && b.jawAxis) {
    let open = 0;
    if (w.graze > 0.3) {
      open = m.graze === 'grind' ? 0.1 + 0.08 * Math.sin(time * 9 + a.pace * 4)          // a quick grinding chew
           : m.graze === 'snip' ? 0.14 * Math.max(0, Math.sin(time * 3 + a.pace * 4))    // snip, and swallow
           : 0.22 * Math.max(0, Math.sin(time * 1.3 + a.pace * 4)) ** 4;                 // a nip, now and then
      open *= w.graze;
    } else if (w.feed > 0.3) open = 0.3 * Math.max(0, Math.sin(time * 2.1 + a.pace * 5)) * w.feed;
    const shut = m.jawClose && !striking && w.feed < 0.3 ? m.jawClose * THREE.MathUtils.DEG2RAD : 0;
    w.jaw = smooth(w.jaw, striking ? 0 : 1, dt, 6);
    const angle = open - shut * w.jaw;
    if (angle) {
      _q.setFromAxisAngle(b.jawAxis, angle);
      b.jaw.quaternion.multiply(_q);
    }
  }
}
