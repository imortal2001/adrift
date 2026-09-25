// ── Viewmodel ────────────────────────────────────────────────────────────────
// The thing in your hand. Until this existed the hotbar decided what a click
// did but nothing was ever drawn, so there was no way to tell a hammer from a
// spear except by reading the slot number.
//
// It is drawn as a second pass over the finished frame, into its own scene,
// after clearing depth. That is the standard trick and it earns its keep here:
// a 1.75m spear held at the hip would otherwise push through the deck, the
// walls and every coral head you swim past. It also means the tool never
// casts into the world's shadow map or picks up its fog.
//
// Lighting is copied from the world each frame — after underwater.js has
// dimmed it — so the tool goes blue and dark at depth along with everything
// else, with a small fill of its own so it never drops to a silhouette.
//
// Bodies: tools/build_tools.py prepares three glTF tools in a common frame —
// standing along +Y, working end up, origin at the grip. Everything held has
// a procedural body in that same frame, which is what you see until the .glb
// arrives, forever if it never does, and always for the hook. The coconut is
// a scan (tools/build_coconut.py), stood with its pores up like its stand-in.

import * as THREE from 'three';
import { ModelLibrary } from './models.js';
import { logTexture, woodTexture, metalTexture } from './textures.js';
import { leafAtlas, CELL, ATLAS_SIZE } from './flora.js';
import { ITEMS, fishOf } from './items.js';

// Where each item sits in camera space (the camera looks down -Z, +X is
// right) and how it is turned there. `model` names the glTF body in
// assets/models/, if there is one. Exported so a pose can be tuned live from
// the console — the arrays are read every frame.
//
// Reading `rot` for a tool that stands along +Y (three's default XYZ order):
// x tips the working end away from you, z leans it left (+) or right (-), and
// y only spins it about its own handle. So "point the spear at the middle of
// the screen" is z, not y — y does nothing to where the tip goes.
//
// Tuned in a narrow portrait window as well as widescreen. The narrow one is
// the harder case: at arm's length it shows only ~24cm either side of centre,
// so anything posed for a wide screen alone ends up off the right-hand edge.
export const POSES = {
  // The head runs front to back, the striking face forward, so the overhead
  // strike lands with the face and the blade trails toward you. Turned a
  // little about the handle (y), face in toward the crosshair: dead straight
  // it is seen end-on, a stub on a stick.
  hammer:  { model: 'tool_hammer', pos: [0.30, -0.37, -0.56], rot: [-0.30, 0.55, 0.30] },
  // Carried low at the right, point forward and a little up, the shaft
  // running along the right-hand side of the view rather than across it. The
  // tip leans slightly right (z < 0) so it stays right of the crosshair, and
  // rises enough that the stone point shows above the lashing instead of
  // hiding end-on behind it.
  spear:   { model: 'tool_spear',  pos: [0.24, -0.30, -0.18], rot: [-1.28, 0.0, -0.10] },
  rod:     { model: 'tool_rod',    pos: [0.27, -0.38, -0.34], rot: [-0.95, 0.0, 0.22] },
  hook:    { model: null,          pos: [0.19, -0.17, -0.52], rot: [0.12, 0.0, 0.20], scale: 1.3 },
  // The grip low at the right and the shaft going down over the side, the
  // blade out of sight in the water — a paddle from the eyes of the one
  // holding it. The stroke carries it forward and back.
  paddle:  { model: null,          pos: [0.30, -0.26, -0.60], rot: [-2.0, 0.0, -0.30] },
  // Held out in front of you, right of centre and clear of the hotbar, the
  // bow across the view and spindle down — the way you would hold it over a
  // hearth board — turned a little so the bow reads as a curve.
  bowdrill: { model: null,         pos: [0.14, -0.19, -0.50], rot: [0.45, -0.25, 0.0] },
  // Tipped toward you, so its three pores — the face of a coconut — show.
  coconut: { model: 'coconut',     pos: [0.17, -0.22, -0.60], rot: [0.75, 0.40, 0.0] },
  // Raw materials: nothing to do with them in hand, but you should see what
  // you are holding. Low at the right, the way you carry a thing you are not
  // using.
  wood:    { model: null,          pos: [0.25, -0.34, -0.62], rot: [0.25, 0.5, 1.25] },
  plank:   { model: null,          pos: [0.27, -0.36, -0.72], rot: [0.95, 0.3, 0.55] },
  rope:    { model: null,          pos: [0.20, -0.26, -0.56], rot: [0.55, 0.3, 0.25] },
  leaf:    { model: null,          pos: [0.22, -0.30, -0.56], rot: [-0.45, 0.4, 0.45] },
  scrap:   { model: null,          pos: [0.19, -0.25, -0.56], rot: [0.5, 0.6, 0.3] },
  // Held by the tail, head up. Every fish item wears this pose, and each
  // wears its own species' body (see body()); this `fish` body is only the
  // stand-in for one the schools cannot draw.
  fish:    { model: null,          pos: [0.24, -0.33, -0.60], rot: [0.15, 0.9, 0.25] },
};

/** What a fish's skin is multiplied by, cooked. Shared with main.js's spit. */
export const COOKED = new THREE.Color(0.62, 0.42, 0.27);

/** The pose an item is held in: its own, or the one all fish share. */
const poseOf = id => POSES[id] || (fishOf(id) ? POSES.fish : null);

// What a click looks like, per action: seconds, and a curve from progress
// 0..1 to a pose offset. Each is a wind-up, a fast stroke and a slow return,
// because that shape is what makes a motion read as effort rather than as a
// model being rotated.
const USES = {
  build: { time: 0.40, curve: t => {             // hammer: overhead strike
    const up = ease(t / 0.28), down = ease((t - 0.28) / 0.17), back = ease((t - 0.45) / 0.55);
    const rx = t < 0.28 ? 0.55 * up : t < 0.45 ? 0.55 - 1.45 * down : -0.90 * (1 - back);
    const py = t < 0.28 ? 0.05 * up : t < 0.45 ? 0.05 - 0.14 * down : -0.09 * (1 - back);
    return { rx, py, pz: -0.05 * Math.sin(Math.PI * Math.min(1, t * 1.6)) };
  } },
  spear: { time: 0.50, curve: t => thrust(t) },    // spear: point on target, drive
  rod: { time: 0.75, curve: t => {               // rod: swing it back, flick
    const back = ease(t / 0.38), flick = ease((t - 0.38) / 0.16), rest = ease((t - 0.54) / 0.46);
    const rx = t < 0.38 ? 0.75 * back : t < 0.54 ? 0.75 - 1.25 * flick : -0.50 * (1 - rest);
    return { rx, py: rx * 0.06 };
  } },
  hook: { time: 0.34, curve: t => {              // hook: arm back and let go
    const back = ease(t / 0.35), fling = ease((t - 0.35) / 0.25);
    return t < 0.35 ? { rx: 0.60 * back, pz: 0.08 * back }
                    : { rx: 0.60 - 1.2 * fling, pz: 0.08 - 0.30 * fling };
  } },
  // A stroke: the blade reaches forward into the water, pulls back past you
  // along the side, lifts out and comes forward again.
  paddle: { time: 0.85, curve: t => {
    const reach = ease(t / 0.25), pull = ease((t - 0.25) / 0.4), back = ease((t - 0.65) / 0.35);
    const pz = t < 0.25 ? -0.16 * reach : t < 0.65 ? -0.16 + 0.42 * pull : 0.26 * (1 - back);
    const py = t < 0.25 ? -0.05 * reach : t < 0.65 ? -0.05 - 0.04 * Math.sin(Math.PI * pull) : 0.06 * Math.sin(Math.PI * back);
    return { pz, py, rx: -pz * 0.9 };
  } },
  // The rod's forward flick after a wind-up. The wind-up itself is held, not
  // played — it is `windup` below — so this only has to carry it through.
  cast: { time: 0.55, curve: t => {
    const f = ease(t / 0.22), back = ease((t - 0.22) / 0.78);
    return { rx: t < 0.22 ? -0.6 * f : -0.6 * (1 - back) };
  } },
  eat: { time: 0.70, curve: t => {               // coconut: to the mouth
    const k = Math.sin(Math.PI * Math.min(1, t));
    return { px: -0.20 * k, py: 0.17 * k, pz: 0.22 * k, rx: -0.35 * k };
  } },
};

const SWAP_DOWN = 0.16, SWAP_UP = 0.22;    // seconds to lower and raise on a swap

// Grip to working end, along +Y — where tools/build_tools.py leaves them.
const TIPS = { rod: 1.98, spear: 1.01 };

// ── the spear thrust ─────────────────────────────────────────────────────────
// How far ahead of your eye the point lands at full extension — and so how
// far a thrust catches a fish. main.js reads this for the catch, so what you
// see and what you get cannot drift apart.
export const THRUST_REACH = 1.9;
const SPEAR_TIP = 1.01;                    // grip to point, tools/build_tools.py

const _aim = new THREE.Vector3();
/**
 * A thrust is not the carry pose slid forward. The spear is carried low at
 * the right, and sliding that forward drives the point off to the right of
 * the crosshair — while the fish it catches is dead centre. So the thrust
 * swings the point onto the crosshair and drives the spear along its own
 * shaft until the tip is THRUST_REACH out.
 *
 * Worked out from the carry pose each time rather than hard-coded, so it stays
 * right if POSES.spear is retuned.
 */
function thrust(t) {
  const p = POSES.spear;
  // Aim from where the grip rests to the point on the view axis.
  _aim.set(-p.pos[0], -p.pos[1], -THRUST_REACH - p.pos[2]).normalize();
  // Invert the pose convention (XYZ Euler on a +Y shaft): a tip direction of
  // (-sin z, cos z cos x, cos z sin x).
  const z = Math.asin(-_aim.x);
  const x = Math.atan2(_aim.z / Math.cos(z), _aim.y / Math.cos(z));
  // Where the grip has to be for the point to land on target at full reach.
  const gx = -_aim.x * SPEAR_TIP, gy = -_aim.y * SPEAR_TIP, gz = -THRUST_REACH - _aim.z * SPEAR_TIP;
  const dx = gx - p.pos[0], dy = gy - p.pos[1], dz = gz - p.pos[2];

  // Swing on target and draw back, drive, hold a beat, recover.
  let a, k;
  if (t < 0.20)      { a = ease(t / 0.20); k = -0.14 * a; }
  else if (t < 0.38) { a = 1; k = -0.14 + 1.14 * ease((t - 0.20) / 0.18); }
  else if (t < 0.50) { a = 1; k = 1; }
  else               { a = 1 - ease((t - 0.50) / 0.50); k = a; }
  return { rx: (x - p.rot[0]) * a, rz: (z - p.rot[2]) * a,
           px: dx * k, py: dy * k, pz: dz * k };
}

/** Seconds into a thrust at which the point reaches full extension. */
export const THRUST_HIT = 0.38 * 0.50;

// A fish speared with a thrust: it appears on the point the moment the point
// reaches it, and stays long enough to see what you caught.
const SKEWER_HIDE = 1.7;

function ease(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

// ── procedural bodies, in the glTF tools' frame ──────────────────────────────
const mat = (color, rough = 0.8, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });

function cyl(r0, r1, y0, y1, m, seg = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg);
  g.translate(0, (y0 + y1) / 2, 0);
  return new THREE.Mesh(g, m);
}

const tex = (t, rx = 1, ry = 1) => { t.repeat.set(rx, ry); return t; };

const BODIES = {
  // A paddle: a pole with a crossbar grip at the hand, and a broad blade at
  // the working end, lashed on.
  paddle() {
    const g = new THREE.Group();
    const wood = mat(0x7a5a3a, 0.85), blade = mat(0x8f6c45, 0.8), cord = mat(0xb39360, 0.95);
    g.add(cyl(0.017, 0.015, -0.12, 1.05, wood, 8));
    const grip = cyl(0.016, 0.016, -0.07, 0.07, wood, 6);
    grip.rotation.z = Math.PI / 2;
    grip.position.y = -0.12;
    g.add(grip);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.022), blade);
    b.position.y = 1.2;
    b.rotation.y = Math.PI / 2;          // face on to the stroke
    g.add(b);
    for (const y of [0.98, 1.03]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 5, 12), cord);
      t.rotation.x = Math.PI / 2;
      t.position.y = y;
      g.add(t);
    }
    return g;
  },
  // A bow drill, in its own frame (held, not a +Y tool): the bow a bent
  // stick across the view with its cord looped once round an upright
  // spindle, and the socket block you press down on over the spindle's top.
  bowdrill() {
    const g = new THREE.Group();
    const wood = mat(0x6e5234, 0.9), cord = mat(0xb39360, 0.95);
    const bow = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.24, 0, 0), new THREE.Vector3(0, 0, -0.14), new THREE.Vector3(0.24, 0, 0));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(bow, 16, 0.011, 6), wood));
    // The cord: from each tip to the spindle, where it takes its turn.
    const turn = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.235, 0, 0), new THREE.Vector3(-0.02, 0, -0.035),
      new THREE.Vector3(0, 0, -0.058), new THREE.Vector3(0.02, 0, -0.035), new THREE.Vector3(0.235, 0, 0)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(turn, 24, 0.0028, 5), cord));
    const spindle = cyl(0.012, 0.012, -0.17, 0.07, wood, 8);
    spindle.name = 'spindle';
    spindle.position.z = -0.04;
    g.add(spindle);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.05), mat(0x5c4a38, 0.95));
    block.position.set(0, 0.085, -0.04);
    g.add(block);
    return g;
  },
  // An armful of split wood: three short lengths, bark on, pale ends.
  wood() {
    const g = new THREE.Group();
    const bark = mat(0xffffff, 0.9, { map: tex(logTexture(), 1, 1) });
    const end = mat(0xc8a676, 0.85);
    for (const [x, z, r, l] of [[0, 0, 0.045, 0.44], [0.075, 0.02, 0.04, 0.4], [0.035, -0.06, 0.038, 0.42]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, l, 9), [bark, end, end]);
      c.position.set(x, 0, z);
      g.add(c);
    }
    return g;
  },
  // A sawn plank, grain along it.
  plank() {
    const g = new THREE.Group();
    const face = mat(0xffffff, 0.8, { map: tex(woodTexture({ size: 256, planks: 1 }), 1, 1) });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.028), face);
    b.position.y = 0.2;
    g.add(b);
    return g;
  },
  // A coil of palm-fibre cord with its tail hanging.
  rope() {
    const g = new THREE.Group();
    const cord = mat(0xb39360, 0.95);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.075 - i * 0.004, 0.011, 6, 22), cord);
      t.position.y = i * 0.018;
      t.rotation.x = Math.PI / 2;
      g.add(t);
    }
    const tail = cyl(0.011, 0.011, -0.16, 0.0, cord, 6);
    tail.position.x = 0.075;
    g.add(tail);
    return g;
  },
  // A palm frond: the painted frond from the forest's leaf atlas, folded along
  // its midrib the way a real one is carried, on its stalk.
  leaf() {
    const g = new THREE.Group();
    const green = mat(0xffffff, 0.85, { map: leafAtlas(), side: THREE.DoubleSide, alphaTest: 0.5 });
    const [cx, cy, cw, ch] = CELL.cycad;
    for (const side of [-1, 1]) {
      const card = new THREE.PlaneGeometry(0.13, 0.62);
      const uv = card.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        // Each half of the fold takes its half of the frond.
        const u = side < 0 ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5;
        uv.setXY(i, (cx + u * cw) / ATLAS_SIZE, (cy + ch - uv.getY(i) * ch) / ATLAS_SIZE);
      }
      card.translate(side * 0.065, 0.33, 0);
      const m = new THREE.Mesh(card, green);
      m.rotation.y = side * 0.35;
      g.add(m);
    }
    g.add(cyl(0.007, 0.011, -0.05, 0.62, mat(0x7d7a3e, 0.8), 5));
    return g;
  },
  // Scrap: a bent sheet of rusted metal and a strap, bolted.
  scrap() {
    const g = new THREE.Group();
    const rust = mat(0xffffff, 0.55, { map: tex(metalTexture()), metalness: 0.45 });
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.006, 4, 1, 1), rust);
    const p = sheet.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.pow(p.getX(i) * 4, 2) * 0.03);   // bent
    sheet.geometry.computeVertexNormals();
    sheet.position.y = 0.05;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.008), rust);
    strap.position.set(0.05, 0.07, 0.01);
    strap.rotation.z = 0.5;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), mat(0x5a5652, 0.4, { metalness: 0.7 }));
    bolt.position.set(0.05, 0.07, 0.015);
    bolt.rotation.x = Math.PI / 2;
    g.add(sheet, strap, bolt);
    return g;
  },
  // A fish the schools cannot draw: a silver body and a tail.
  fish() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(0x9aa4a8, 0.45, { metalness: 0.2 }));
    body.scale.set(0.55, 3.4, 1.2);
    body.position.y = 0.2;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 4), mat(0x7d878b, 0.5));
    tail.scale.set(0.3, 1, 1.2);
    tail.position.y = 0.02;
    tail.rotation.x = Math.PI;
    g.add(body, tail);
    return g;
  },
  hammer() {
    const g = new THREE.Group();
    g.add(cyl(0.020, 0.017, -0.06, 0.37, mat(0x5a3f28)));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), mat(0x6c6a64, 0.6, { flatShading: true }));
    head.position.y = 0.35;
    g.add(head);
    return g;
  },
  spear() {
    const g = new THREE.Group();
    g.add(cyl(0.020, 0.018, -0.74, 0.90, mat(0x7d5836)));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 6), mat(0x6f685e, 0.4, { flatShading: true }));
    tip.position.y = 0.95;
    g.add(tip, cyl(0.024, 0.024, 0.84, 0.90, mat(0x9f7c4b, 0.9)));
    return g;
  },
  rod() {
    const g = new THREE.Group();
    g.add(cyl(0.017, 0.004, -0.22, 1.98, mat(0x4a3a26)), cyl(0.022, 0.022, -0.20, 0.12, mat(0x2f261c)));
    return g;
  },
  hook() {
    // A bent scrap-iron hook on a coil of rope: the recipe is plank, rope and
    // scrap, so that is what it looks like.
    const g = new THREE.Group();
    const iron = mat(0x6d6a66, 0.45, { metalness: 0.55 });
    g.add(cyl(0.007, 0.007, 0.0, 0.12, iron, 6));
    const bend = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 14, Math.PI * 1.15), iron);
    bend.rotation.z = Math.PI;
    bend.position.set(0.035, 0.0, 0);
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.010, 0.03, 5), iron);
    barb.position.set(0.068, 0.018, 0);
    // The coil faces you, not the sky: seen edge-on it reads as a bar. It sits
    // on the top of the shank, where the rope is tied off.
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.0075, 6, 18), mat(0xb39360, 0.95));
    coil.position.y = 0.14;
    g.add(bend, barb, coil);
    return g;
  },
  coconut() {
    const g = new THREE.Group();
    const nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 1),
                               mat(0x6b4a2b, 0.95, { flatShading: true }));
    nut.scale.set(1, 1.12, 1);
    g.add(nut);
    // The three germination pores. Without them a brown low-poly ball is a
    // rock; with them it is a coconut.
    const pore = mat(0x241710, 1.0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), pore);
      d.position.set(Math.cos(a) * 0.022, 0.088, Math.sin(a) * 0.022);
      g.add(d);
    }
    return g;
  },
};

export class Viewmodel {
  /**
   * @param renderer  the game's renderer; this draws a second pass with it
   * @param camera    the game's camera, which the rig follows
   * @param sky       for the sun, sky light and night fraction
   */
  constructor(renderer, camera, sky) {
    this.renderer = renderer;
    this.camera = camera;
    this.sky = sky;

    this.scene = new THREE.Scene();
    this.rig = new THREE.Group();          // follows the camera exactly
    this.hand = new THREE.Group();         // the animated pose, in camera space
    this.rig.add(this.hand);
    this.scene.add(this.rig);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    // A little light of its own, so a dark stone head held at 20m down or at
    // midnight is still recognisably the thing you selected.
    this.fill = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(this.sun, this.sun.target, this.hemi, this.fill);

    this.bodies = new Map();               // item id -> Object3D, built lazily
    this.current = null;                   // what is drawn now
    this.want = null;                      // what should be drawn
    this.swap = 0;                         // 0 raised .. 1 fully lowered
    this.lowering = false;

    this.useKind = null;
    this.useT = 1;

    this.skewered = null;                  // { mesh, t } — a thrust-caught fish on show

    // How hard something is pulling on the rod, 0..1. Set by fishing.js; the
    // rod bows toward the pull and shakes with it.
    this.strain = 0;
    this._strain = 0;
    // How far the rod is drawn back for a cast, 0..1 — held while the swing
    // meter charges. Eased slowly on the way back, fast on the way through.
    this.windup = 0;
    this._windup = 0;
    this.windupRate = 6;
    // Sawing the bow drill at a fire, set by main.js while the button is held.
    this.drilling = false;
    this._drill = 0;

    this.bobPhase = 0;
    this.bobAmp = 0;
    this.sway = new THREE.Vector2();       // lag behind the look, yaw and pitch
    this.lastYaw = null;
    this.lastPitch = 0;
    this.lastPos = new THREE.Vector3();
    this.time = 0;
    this.visible = false;

    this.upgraded = [];                    // glTF bodies that arrived, for the log
    this.library = new ModelLibrary();
    this.loadModels();
  }

  body(id) {
    if (this.bodies.has(id)) return this.bodies.get(id);
    // A fish is the species it is: a still copy from the schools, through
    // `fishBody` (main.js wires it to FishSchools), standing on its tail.
    const key = fishOf(id);
    if (key) {
      const mesh = this.fishBody?.(key);
      // Cooked, the same fish browned: its skin darkened toward roast.
      if (mesh && ITEMS[id]?.cooked) mesh.material.color.multiply(COOKED);
      const obj = mesh ? this.standFish(mesh) : BODIES.fish();
      this.prepare(obj);
      this.bodies.set(id, obj);
      return obj;
    }
    const make = BODIES[id];
    const obj = make ? make() : null;
    if (obj) this.prepare(obj);
    this.bodies.set(id, obj);
    return obj;
  }

  prepare(obj) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;             // camera-space and always in view
    });
  }

  /** Swap each procedural body for its glTF one as it loads. Best-effort. */
  async loadModels() {
    const jobs = Object.entries(POSES).filter(([, p]) => p.model).map(async ([id, p]) => {
      const entry = await this.library.get(p.model);
      if (!entry) return;
      const obj = entry.scene.clone(true);
      this.prepare(obj);
      const old = this.bodies.get(id);
      this.bodies.set(id, obj);
      if (old && old.parent) {             // currently in hand: swap in place
        old.parent.remove(old);
        this.hand.add(obj);
      }
      this.upgraded.push(id);
    });
    await Promise.all(jobs);
  }

  /**
   * World position of a held tool's working end — the rod tip the line hangs
   * from — or null if that tool is not the one in hand.
   */
  tipWorld(id, out) {
    // Outside first person the tool shown is the one in the body's hand
    // (main.js sets this); the line hangs from that.
    const outside = this.tipOutside?.(id, out);
    if (outside) return outside;
    const b = this.bodies.get(id);
    if (!b || this.current !== id || !b.parent) return null;
    b.updateWorldMatrix(true, false);
    return b.localToWorld(out.set(0, TIPS[id] || 0, 0));
  }

  /** Whether what is in hand can be let go of now — not mid-swap. */
  canRelease(id) {
    return this.current === id && !this.lowering && this.swap < 0.5;
  }

  /** World position of the grip: where a thrown thing leaves the hand. */
  gripWorld(out) {
    return this.hand.getWorldPosition(out);
  }

  /**
   * A copy of an item's body for the world — the same one the hand holds, but
   * never with a thrust-caught fish still on show on it: that fish is already in
   * your bag, and throwing the spear should not throw a second copy of it.
   */
  cloneBody(id) {
    const b = this.body(id);
    if (!b) return new THREE.Group();
    const shown = this.skewered && this.skewered.mesh.parent === b ? this.skewered.mesh : null;
    if (shown) b.remove(shown);
    const copy = b.clone(true);
    if (shown) b.add(shown);
    return copy;
  }

  /**
   * Show a fish on the spear in hand, for a thrust that caught one. The fish is
   * a still copy from FishSchools.bodyFor(); this owns it from here on.
   */
  skewer(mesh) {
    this.clearSkewer();
    this.skewered = { mesh, t: 0 };
  }

  clearSkewer() {
    if (!this.skewered) return;
    const m = this.skewered.mesh;
    m.removeFromParent();
    m.geometry.dispose();
    m.material.dispose();
    this.skewered = null;
  }

  /**
   * The thing in hand has just left it. Drop straight to fully lowered with
   * nothing held, so the next one — if there is one — is drawn up fresh,
   * rather than lowering a spear that is already in the air.
   */
  release() {
    this.clearSkewer();
    this.setBody(null);
    this.swap = 1;
    this.lowering = false;
    this.useT = 1;
  }

  /** Play the click animation for an action. Ignored if one is running. */
  use(action) {
    if (!USES[action] || this.useT < 1 || this.swap > 0) return;
    this.useKind = action;
    this.useT = 0;
  }

  /**
   * @param held      item id in the selected slot, or null
   * @param owned     whether you actually have one — an empty bound slot
   *                  shows empty hands, not a ghost of the tool
   * @param hidden    true while the item is out of your hand (a thrown hook)
   * @param playing   false on the title screen and while paused
   */
  update(dt, { held, owned, hidden = false, playing = true, drift = null }) {
    this.time += dt;
    const want = playing && owned && poseOf(held) ? held : null;
    this.visible = playing;

    // ── swapping: lower what is there, change it at the bottom, raise ──
    if (want !== this.current && !this.lowering) {
      this.lowering = true;
      this.useT = 1;                       // a swap cancels a swing
    }
    if (this.lowering) {
      this.swap = Math.min(1, this.swap + dt / SWAP_DOWN);
      if (this.swap >= 1 || !this.current) {
        this.swap = 1;
        this.setBody(want);
        this.lowering = false;
      }
    } else if (this.swap > 0) {
      this.swap = Math.max(0, this.swap - dt / SWAP_UP);
    }
    if (this.current) {
      const b = this.bodies.get(this.current);
      if (b) b.visible = !hidden;
    }

    // ── follow the camera ──
    this.camera.updateMatrixWorld();
    this.rig.position.setFromMatrixPosition(this.camera.matrixWorld);
    this.rig.quaternion.setFromRotationMatrix(this.camera.matrixWorld);

    // ── bob from how fast the eye is actually moving ──
    // (Less what the raft carried you: riding it is not walking.)
    const moved = Math.hypot(this.rig.position.x - this.lastPos.x - (drift?.x || 0),
                             this.rig.position.z - this.lastPos.z - (drift?.z || 0));
    const speed = dt > 0 ? Math.min(8, moved / dt) : 0;
    this.lastPos.copy(this.rig.position);
    this.bobAmp += (Math.min(1, speed / 5.3) - this.bobAmp) * Math.min(1, dt * 6);
    this.bobPhase += dt * (2.2 + speed * 1.9);

    // ── lag behind the look ──
    const yaw = this.cameraYaw(), pitch = this.cameraPitch();
    if (this.lastYaw === null) { this.lastYaw = yaw; this.lastPitch = pitch; }
    let dy = yaw - this.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - this.lastPitch;
    this.lastYaw = yaw; this.lastPitch = pitch;
    this.sway.x = THREE.MathUtils.clamp(this.sway.x + dy * 0.9, -0.12, 0.12);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y + dp * 0.9, -0.10, 0.10);
    this.sway.multiplyScalar(Math.exp(-dt * 9));

    this.showSkewer(dt);
    this.pose(dt);
    this.light();
  }

  /**
   * Hang the fish on the point when the thrust reaches it, and take it
   * off again once it has been seen. The shaft goes through its flanks, the
   * same as on a thrown spear.
   */
  showSkewer(dt) {
    const k = this.skewered;
    if (!k) return;
    k.t += dt;
    const spear = this.current === 'spear' ? this.bodies.get('spear') : null;
    if (!spear || k.t > SKEWER_HIDE) { this.clearSkewer(); return; }
    if (k.t > THRUST_HIT && k.mesh.parent !== spear) {
      k.mesh.position.set(0, 0.70, 0);
      k.mesh.rotation.set(0, 0.9, Math.PI / 2);
      k.mesh.castShadow = false;
      k.mesh.frustumCulled = false;
      spear.add(k.mesh);
    }
  }

  /**
   * A still fish from FishSchools.displayBody(), stood on its tail in the item
   * frame, head up, gripped just above the tail.
   */
  standFish(mesh) {
    const g = new THREE.Group();
    mesh.rotation.set(-Math.PI / 2, 0, 0);          // nose (+Z) up the item frame
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.y = -box.min.y - 0.04;
    g.add(mesh);
    return g;
  }

  /**
   * Forget the fish bodies made so far — the schools' real models have just
   * arrived, and those were built from the stand-in. One in hand is swapped
   * for its new body where it is.
   */
  dropFishBodies() {
    for (const [id, old] of [...this.bodies]) {
      if (!fishOf(id)) continue;
      this.bodies.delete(id);
      if (old?.parent) {
        old.parent.remove(old);
        this.hand.add(this.body(id));
      }
      old?.traverse(o => { if (o.isMesh && o.userData.fish) { o.geometry.dispose(); o.material.dispose(); } });
    }
  }

  setBody(id) {
    if (this.current) {
      const old = this.bodies.get(this.current);
      if (old) this.hand.remove(old);
    }
    this.current = id;
    if (id) {
      const b = this.body(id);
      if (b) this.hand.add(b);
    }
  }

  cameraYaw() {
    const e = new THREE.Euler().setFromQuaternion(this.rig.quaternion, 'YXZ');
    return e.y;
  }

  cameraPitch() {
    const e = new THREE.Euler().setFromQuaternion(this.rig.quaternion, 'YXZ');
    return e.x;
  }

  pose(dt) {
    const p = poseOf(this.current);
    if (!p) return;
    const h = this.hand;

    let o = {};
    if (this.useT < 1) {
      this.useT = Math.min(1, this.useT + dt / USES[this.useKind].time);
      o = USES[this.useKind].curve(this.useT);
    }

    // Drawn back over the shoulder for a cast, as far as the swing is charged.
    this._windup += (this.windup - this._windup) * Math.min(1, dt * this.windupRate);
    if (this.current === 'rod' && this._windup > 0.001) {
      o = { ...o, rx: (o.rx || 0) + 0.9 * this._windup, py: (o.py || 0) + 0.05 * this._windup };
    }

    // A fish on the line: the rod bows toward it and shudders as it fights.
    this._strain += (this.strain - this._strain) * Math.min(1, dt * 6);
    if (this.current === 'rod' && this._strain > 0.01) {
      const k = this._strain;
      o = { ...o,
            rx: (o.rx || 0) - 0.34 * k + Math.sin(this.time * 23) * 0.035 * k,
            rz: (o.rz || 0) + Math.sin(this.time * 17 + 1.3) * 0.025 * k,
            pz: (o.pz || 0) - 0.05 * k };
    }

    // Sawing the bow drill: the bow runs back and forth along itself, pressed
    // down toward the hearth, and the spindle spins in the cord — one way on
    // the push, back on the pull.
    this._drill += ((this.drilling && this.current === 'bowdrill' ? 1 : 0) - this._drill) * Math.min(1, dt * 8);
    if (this._drill > 0.01) {
      const k = this._drill;
      o = { ...o, px: (o.px || 0) + Math.sin(this.time * 15) * 0.07 * k,
                  py: (o.py || 0) - 0.05 * k, rx: (o.rx || 0) + 0.25 * k };
      const sp = this.bodies.get('bowdrill')?.getObjectByName('spindle');
      if (sp) sp.rotation.y += Math.cos(this.time * 15) * dt * 70 * k;
    }

    // A walk is two steps per stride, so the vertical bob runs at twice the
    // side-to-side one. The idle drift keeps a held tool from looking bolted
    // to the screen.
    const b = this.bobAmp;
    const bobX = Math.sin(this.bobPhase) * 0.011 * b;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * -0.016 * b;
    const idle = Math.sin(this.time * 1.3) * 0.004;
    const s = ease(this.swap);

    h.position.set(
      p.pos[0] + (o.px || 0) + bobX - this.sway.x * 0.35,
      p.pos[1] + (o.py || 0) + bobY + idle - this.sway.y * 0.25 - 0.40 * s,
      p.pos[2] + (o.pz || 0));
    h.rotation.set(
      p.rot[0] + (o.rx || 0) + this.sway.y * 1.2 + 0.9 * s,
      p.rot[1] + (o.ry || 0) + this.sway.x * 1.6,
      p.rot[2] + (o.rz || 0) + bobX * 2.0);
    h.scale.setScalar(p.scale || 1);
  }

  /** Match the world's light this frame, which underwater.js has already dimmed. */
  light() {
    const sky = this.sky;
    this.sun.color.copy(sky.sun.color);
    this.sun.intensity = sky.sun.intensity;
    this.sun.position.copy(this.rig.position).addScaledVector(sky.sunDir, 5);
    this.sun.target.position.copy(this.rig.position);
    this.hemi.color.copy(sky.hemi.color);
    this.hemi.groundColor.copy(sky.hemi.groundColor);
    this.hemi.intensity = sky.hemi.intensity;
    this.fill.intensity = 0.30 * (1 - sky.night * 0.6);
  }

  /** Draw over the finished frame. Call after the world's render. */
  render() {
    if (!this.visible || !this.current) return;
    const r = this.renderer;
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }
}
