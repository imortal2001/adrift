// ── Reef and pond animals, from their models ─────────────────────────────────
// The glTF bodies of reeflife.js's animals, when their files are in
// assets/models/ (converted by tools/build_sealife.py; credited in
// CREDITS.md). Each is the same animal as the code-built one it replaces — the
// same size, facing +z, standing on y = 0, with the same `userData.animate` —
// so ReefLife swaps one for the other and nothing else changes. Without the
// files, the code-built ones stay.
//
//   octopus      its rig's eight arm chains curled and swept in code: they
//                reach and coil as it creeps, and trail behind as it jets
//   stingray     its own swim clip, run as slow or as fast as it is going
//   crab         a shell, two claws and ten legs, each part drawn instanced
//                for every crab and turned about its own joint (reeflife.js)
//   sea turtle,  one mesh each; the legs (or flippers), head and tail are
//   tortoise,    found in the mesh (limbs()) and moved in the vertex shader —
//   pond turtle  beating, walking, paddling, grazing, and drawn in under the
//                shell when you come close

import * as THREE from 'three';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';

/**
 * Scale `root` so it is `size` across its `axis`, centred on x and z, standing
 * on y = 0 — measured as posed, since a rig's rest bounds are not its posed ones.
 */
function fit(root, size, axis = 'x') {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  box.setFromObject(root, true);
  root.scale.multiplyScalar(size / (box.max[axis] - box.min[axis] || 1));
  root.updateMatrixWorld(true);
  box.setFromObject(root, true);
  root.position.x -= (box.min.x + box.max.x) / 2;
  root.position.z -= (box.min.z + box.max.z) / 2;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
}

const shadows = root => root.traverse(o => {
  if (!o.isMesh) return;
  o.castShadow = true;
  o.frustumCulled = false;            // skinned bounds go stale as it moves
});

// ── octopus ──────────────────────────────────────────────────────────────────
/**
 * The octopus, `across` metres from arm tip to arm tip. `animate(t, speed, mode)`
 * as octopusBody()'s; `tint(colour)` is its camouflage.
 */
export function octopusModel(entry, across = 0.8) {
  const group = new THREE.Group();
  const root = cloneSkinned(entry.scene);
  group.add(root);
  let mat = null;
  root.traverse(o => { if (o.isSkinnedMesh) { o.material = mat = o.material.clone(); } });
  shadows(root);
  fit(root, across, 'x');

  // The arms: eight chains of joints fanning from one hub. (The rig also has
  // stubs of a first attempt at arms, a joint or two long; those are not them.)
  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  const kids = b => b.children.filter(c => c.isBone);
  const chain = b => { const c = []; for (let x = b; x; x = kids(x)[0]) c.push(x); return c; };
  const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion();
  const arms = bones
    .filter(x => /leg/i.test(x.name) && x.parent?.isBone && kids(x.parent).length > 2 && kids(x).length === 1 && chain(x).length >= 4)
    .map((first, k) => {
      const joints = chain(first).map((bone, i, all) => {
        bone.getWorldPosition(a);
        (all[i + 1] || all[i - 1]).getWorldPosition(b);
        const dir = all[i + 1] ? b.sub(a) : a.clone().sub(b);
        dir.y = 0; dir.normalize();
        // Its axes, in its own frame: up (to sweep it round) and across the
        // arm (to curl it up or down).
        bone.getWorldQuaternion(q).invert();
        const side = new THREE.Vector3().crossVectors(dir, up).normalize();
        return { bone, rest: bone.quaternion.clone(), up: up.clone().applyQuaternion(q),
                 side: side.applyQuaternion(q), ang: Math.atan2(dir.x, dir.z) };
      });
      return { joints, k };
    });

  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  let jet = 0, last = 0;
  group.userData.animate = (t, speed, mode) => {
    const dt = Math.min(0.1, Math.max(0, t - last)); last = t;
    jet += ((mode ? 1 : 0) - jet) * Math.min(1, dt * 6 || 1);
    for (const { joints, k } of arms) {
      const n = joints.length;
      joints.forEach((j, i) => {
        const f = i / (n - 1);
        // Creeping: each arm reaching on its own beat, and the last of it coiling one way or the other.
        const reach = Math.sin(t * (0.8 + speed * 3) + k * 1.7 + f * 3) * 0.14 + (k % 2 ? 1 : -1) * Math.max(0, f - 0.4) * 0.55;
        const lift = f > 0.5 ? Math.max(0, Math.sin(t * 1.3 + k)) * 0.35 : -0.04;
        // Jetting: all of them swept back behind it, straight and together.
        const trail = i === 0 ? -j.ang * 0.85 : Math.sin(t * 9 + k + i) * 0.04;
        const sweep = reach + (trail - reach) * jet, curl = lift * (1 - jet) + 0.06 * jet;
        j.bone.quaternion.copy(j.rest).multiply(qa.setFromAxisAngle(j.up, sweep)).multiply(qb.setFromAxisAngle(j.side, curl));
      });
    }
  };
  // The texture is its colour; the camouflage tints it, lighter than the
  // code-built one's plain colours would (a texture is darker than white).
  const tint = new THREE.Color();
  group.userData.skin = { color: tint };
  group.userData.tint = c => mat.color.copy(c).offsetHSL(0, -0.1, 0.22);
  group.userData.model = true;
  return group;
}

/** A still copy of a posed skinned model: its geometry as posed, in `root`'s frame, one mesh per material. */
export function stillOf(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  const out = [], v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const src = o.geometry, pos = src.attributes.position, p = new Float32Array(pos.count * 3);
    m.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      o.getVertexPosition(i, v);
      v.applyMatrix4(m).toArray(p, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
    if (src.index) g.setIndex(src.index);
    g.computeVertexNormals();
    out.push({ geometry: g, material: o.material });
  });
  return out;
}

// ── stingray ─────────────────────────────────────────────────────────────────
/** The stingray, `width` metres wingtip to wingtip. `animate(t, beat, amp)` as rayBody()'s. */
export function rayModel(entry, width = 1.1) {
  const group = new THREE.Group();
  const root = cloneSkinned(entry.scene);
  group.add(root);
  shadows(root);
  const mixer = new THREE.AnimationMixer(root);
  const clip = entry.clips[0];
  if (clip) mixer.clipAction(clip).play();
  mixer.setTime(0);
  fit(root, width, 'x');
  let phase = Math.random() * 10, last = 0;
  group.userData.animate = (t, beat, amp) => {
    const dt = Math.min(0.1, Math.max(0, t - last)); last = t;
    // Lying on the sand it barely stirs; gliding, a slow beat; fleeing, fast.
    phase += dt * (amp < 0.01 ? 0.06 : beat * 1.25);
    if (clip) mixer.setTime(phase % clip.duration);
  };
  group.userData.model = true;
  return group;
}

// ── tortoise and pond turtle ─────────────────────────────────────────────────
// Each vertex of a shelled animal carries aLimb = (reach, head, tail): reach
// how far out it is from the shell (0 on it, 1 at a foot's or the nose's
// end), head and tail how much it is the head or the tail. Which leg it is
// the shader works out from which way it lies from the middle, blended
// between the four legs' own directions (measured here) — all of it smooth,
// so neighbouring vertices never pull apart, whatever the mesh.

/**
 * Find the limbs in a shelled animal's meshes (facing +z, standing on y = 0).
 * Looked at from above, the shell is the top of everything under it: a
 * height map of the tallest point in each column says where the shell is and
 * how far below its top a vertex hangs. What is near the top is shell; what
 * reaches out past it, or hangs well below its rim, is limb.
 */
function limbs(meshes) {
  const all = [];
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) all.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  let top = 0, bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (let i = 0; i < all.length; i += 3) {
    top = Math.max(top, all[i + 1]);
    bx0 = Math.min(bx0, all[i]); bx1 = Math.max(bx1, all[i]);
    bz0 = Math.min(bz0, all[i + 2]); bz1 = Math.max(bz1, all[i + 2]);
  }
  const N = 32, cw = (bx1 - bx0) / N || 1, ch = (bz1 - bz0) / N || 1;
  const cell = (x, z) => [Math.min(N - 1, Math.max(0, (x - bx0) / cw | 0)), Math.min(N - 1, Math.max(0, (z - bz0) / ch | 0))];
  const high = new Float32Array(N * N);
  for (let i = 0; i < all.length; i += 3) {
    const [u, v] = cell(all[i], all[i + 2]);
    high[v * N + u] = Math.max(high[v * N + u], all[i + 1]);
  }
  const around = (grid, u, v, r, f, h) => {
    for (let dv = -r; dv <= r; dv++) for (let du = -r; du <= r; du++) {
      const uu = u + du, vv = v + dv;
      if (uu >= 0 && vv >= 0 && uu < N && vv < N) h = f(h, grid[vv * N + uu]);
    }
    return h;
  };
  // The top over a column, taken over its neighbours too, so the very edge of the shell counts as under it.
  const over = (x, z) => { const [u, v] = cell(x, z); return around(high, u, v, 1, Math.max, 0); };
  // Where the shell is: the columns that stand high, opened (shrunk, then
  // grown back) so that a head held up on its neck is not taken for shell.
  // (A sparse mesh leaves some columns with no vertex in them: filled from their neighbours.)
  const shellHigh = top * 0.5, R = 3;
  const up = high.map((_, i) => (around(high, i % N, i / N | 0, 1, Math.max, 0) >= shellHigh ? 1 : 0));
  const shrunk = up.map((_, i) => around(up, i % N, i / N | 0, R, Math.min, 1));
  const mask = shrunk.map((_, i) => around(shrunk, i % N, i / N | 0, R + 1, Math.max, 0));
  const shelled = (x, z) => { const [u, v] = cell(x, z); return mask[v * N + u] > 0; };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    if (!mask[v * N + u]) continue;
    x0 = Math.min(x0, bx0 + u * cw); x1 = Math.max(x1, bx0 + (u + 1) * cw);
    z0 = Math.min(z0, bz0 + v * ch); z1 = Math.max(z1, bz0 + (v + 1) * ch);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ax = (x1 - x0) / 2, az = (z1 - z0) / 2;
  const s = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));

  // How far out each vertex is, and a first rough sort, for the directions.
  const reach = meshes.map(m => {
    const p = m.geometry.attributes.position, w = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i), y = p.getY(i), Z = p.getZ(i), r = Math.hypot((X - cx) / ax, (Z - cz) / az);
      const under = over(X, Z) - y, inside = shelled(X, Z);
      w[i] = inside && under < top * 0.16 ? 0
           : Math.max(inside ? s(top * 0.16, top * 0.75, under) * s(0.45, 0.7, r) : 0, s(0.95, 1.45, r));
    }
    return w;
  });
  // The head: what reaches out in front and stands up, or straight ahead — it may be turned to one side.
  let hx = 0, hz = 0;
  meshes.forEach((m, k) => {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) - cx, y = p.getY(i), z = p.getZ(i) - cz, w = reach[k][i];
      if (w > 0.3 && z > az * 0.3 && (y > top * 0.4 || Math.abs(x) < ax * 0.3)) { hx += x * w; hz += z * w; }
    }
  });
  const hl = Math.hypot(hx, hz) || 1;
  const head = [hx / hl || 0, hz / hl || 1], straight = Math.abs(head[0]) < 0.25;
  const legs = [[0, 0], [0, 0], [0, 0], [0, 0]];
  meshes.forEach((m, k) => {
    const p = m.geometry.attributes.position, out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) - cx, y = p.getY(i), z = p.getZ(i) - cz, w = reach[k][i];
      const along = x * head[0] + z * head[1], lateral = Math.abs(x * head[1] - z * head[0]);
      const h = s(az * 0.55, az * 0.85, along) * s(ax * 0.32, ax * 0.18, lateral) * (straight ? 1 : s(top * 0.38, top * 0.55, y));
      const t = s(az * 0.7, az * 0.95, -z) * s(ax * 0.3, ax * 0.15, Math.abs(x));
      out[i * 3] = w; out[i * 3 + 1] = h; out[i * 3 + 2] = t;
      if (w > 0.3 && h < 0.3 && t < 0.3) {
        const leg = legs[(x > 0 ? 0 : 1) + (z > 0 ? 0 : 2)];
        leg[0] += x * w; leg[1] += z * w;
      }
    }
    m.geometry.setAttribute('aLimb', new THREE.BufferAttribute(out, 3));
  });
  const dirs = legs.map(([x, z], i) => {
    const l = Math.hypot(x, z);
    return l ? [x / l, z / l] : [i % 2 ? -0.7 : 0.7, i < 2 ? 0.7 : -0.7];
  });
  return { cx, cz, ax, az, top, length: Math.max(az * 2, 1e-6), head, legs: dirs };
}

/** The limb shader's uniforms, shared by the materials of one animal. */
function limbUniforms(shape) {
  const [a, b, c, d] = shape.legs;
  return {
    uPhase: { value: 0 },  uStride: { value: 0 }, uLift: { value: 0 }, uSwim: { value: 0 }, uFlap: { value: 0 },
    uHide: { value: 0 },   uGraze: { value: 0 },  uLook: { value: 0 },
    uShape: { value: new THREE.Vector4(shape.cx, shape.cz, shape.length, shape.top) },
    uHeadDir: { value: new THREE.Vector2(...shape.head) },
    uLegsF: { value: new THREE.Vector4(...a, ...b) },    // left front, right front
    uLegsH: { value: new THREE.Vector4(...c, ...d) },    // left hind, right hind
  };
}

function limbMaterial(material, u) {
  const m = material.clone();
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aLimb;
        uniform float uPhase, uStride, uLift, uSwim, uFlap, uHide, uGraze, uLook;
        uniform vec4 uShape, uLegsF, uLegsH;
        uniform vec2 uHeadDir;
        // One leg's move: walking, paddling. ph its step; front, left ±1.
        vec3 legMove(float ph, float front, float left, float L) {
          float sw = sin(ph);
          vec3 d = vec3(0.0);
          // Walking: each foot swung forward clear of the ground, and set down.
          d.z += sw * uStride * L;
          d.y += max(0.0, cos(ph)) * uLift * L;
          // Paddling: a broad stroke, out and back, the hind feet kicking.
          d.z += (front > 0.0 ? sw * 0.9 : sin(ph + 1.2) * 0.5) * uSwim * L;
          d.x += left * cos(ph) * uSwim * L * 0.35;
          // Flying (a sea turtle): the front flippers beating together, down
          // and back — the downstroke the quicker — the hind ones only steering.
          float fl = uPhase + 0.6 * sin(uPhase);
          d.y += (front > 0.0 ? -sin(fl) : 0.2 * sin(fl * 0.5 + left)) * uFlap * L;
          d.z += (front > 0.0 ? -cos(fl) * 0.35 : 0.0) * uFlap * L;
          return d;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float w = aLimb.x, hd = aLimb.y, tl = aLimb.z, L = uShape.z;
          vec2 q = transformed.xz - uShape.xy;
          vec2 dir = q / max(length(q), 1e-5);
          // Which leg: blended by how nearly it lies each leg's way.
          vec4 m = exp(6.0 * vec4(dot(dir, uLegsF.xy), dot(dir, uLegsF.zw), dot(dir, uLegsH.xy), dot(dir, uLegsH.zw)));
          m /= m.x + m.y + m.z + m.w;
          // Diagonal pairs together: left front with right hind.
          vec3 d = m.x * legMove(uPhase, 1.0, 1.0, L) + m.y * legMove(uPhase + 3.14159, 1.0, -1.0, L)
                 + m.z * legMove(uPhase + 3.14159, -1.0, 1.0, L) + m.w * legMove(uPhase, -1.0, -1.0, L);
          // Drawn in, under the shell's rim.
          d.xz -= q * 0.4 * uHide;
          d.y += max(0.0, uShape.w * 0.35 - transformed.y) * uHide;
          d *= max(0.0, 1.0 - hd - tl);
          // The head: in under the shell; down to graze; turned to look.
          vec3 h = vec3(0.0);
          // (Drawn in by shrinking it toward where it leaves the shell: sliding it back would fold the neck.)
          vec2 base = uShape.xy + uHeadDir * L * 0.4;
          h.xz += (base - transformed.xz) * 0.6 * uHide;
          h.y += (uShape.w * 0.45 - transformed.y) * 0.45 * uHide;
          h.y -= uGraze * 0.1 * L;
          h.xz += vec2(uHeadDir.y, -uHeadDir.x) * uLook * w * L * 0.06;
          d += h * hd;
          d.x += tl * sin(uPhase * 0.5) * L * 0.24 * (uStride + uSwim);
          transformed += d * w;
        }`);
  };
  m.customProgramCacheKey = () => 'limbs';
  return m;
}

/**
 * A tortoise or a pond turtle, `length` metres nose to tail, its legs, head
 * and tail moved by `userData.limbs` (the shader's uniforms): uPhase the
 * step, uStride/uLift walking, uSwim paddling, uHide drawn in, uGraze head
 * down, uLook head turned, uFlap a sea turtle's flippers beating. `bright` lifts a texture painted too dark for
 * the game's light.
 */
export function shelledModel(entry, length, bright = 1) {
  if (!entry.shape) {
    const meshes = [];
    entry.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    entry.shape = limbs(meshes);
  }
  const group = new THREE.Group();
  const root = entry.scene.clone();
  group.add(root);
  const u = limbUniforms(entry.shape);
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material = limbMaterial(o.material, u);
    if (o.material.map) o.material.color.setScalar(bright);
  });
  shadows(root);
  fit(root, length, 'z');
  group.userData.limbs = u;
  group.userData.model = true;
  return group;
}

/**
 * The sea turtle, `length` metres nose to tail, centred on y = 0 as the
 * code-built one is (it swims; it does not stand). `animate(t, beat, push)` as
 * turtleBody()'s: `beat` strokes a second, `push` how hard (0..1).
 */
export function seaTurtleModel(entry, length = 1.1) {
  const group = shelledModel(entry, length);
  const root = group.children[0];
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= (box.min.y + box.max.y) / 2;
  const u = group.userData.limbs;
  group.userData.animate = (t, beat, push) => {
    u.uPhase.value = t * beat * Math.PI * 2;
    u.uFlap.value = 0.14 * push;
    u.uLook.value = Math.sin(t * 0.3) * 0.6;
  };
  return group;
}
