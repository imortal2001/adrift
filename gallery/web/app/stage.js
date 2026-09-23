// ── Stage ────────────────────────────────────────────────────────────────────
// Where an asset is shown. Three backdrops:
//
//   studio      neutral grey, three-point light, a floor with a metre grid
//   world       the game's own sky, sun and ocean, at a time of day you pick
//   underwater  ten metres down, through the game's own underwater pass — fog,
//               dimmed light, drifting motes and caustics on the sea bed —
//               which is how corals and fish are actually seen in play
//
// World and underwater are not imitations: they are Sky, Ocean and Underwater
// from the game's src/, driven the way the game drives them.

import * as THREE from 'three';
import { Sky } from '/src/sky.js';
import { Ocean, waveHeight } from '/src/ocean.js';
import { Underwater, CAUSTICS, applyCaustics } from '/src/underwater.js';
import { setReefTime } from '/src/reef.js';

export const DEPTH = 10;         // how far down the underwater backdrop puts things

export class Stage {
  constructor() {
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();          // the asset goes in here
    this.scene.add(this.root);

    // ── studio ──
    this.studio = new THREE.Group();
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.03;
    this.key = key;
    const fill = new THREE.DirectionalLight(0xc8dcff, 0.7);
    fill.position.set(-8, 4, -3);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-2, 6, -9);
    this.studio.add(key, key.target, fill, rim,
      new THREE.HemisphereLight(0xe8eef4, 0x3a3f44, 0.9));
    this.scene.add(this.studio);

    // A floor that takes shadows (and caustics, underwater), a metre grid, and
    // a 1.75 m person for scale.
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64),
      applyCaustics(new THREE.MeshStandardMaterial({ color: 0x8b8f93, roughness: 1 })));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(1, 1, 0x70767c, 0x5d6268);
    this.scene.add(this.grid);
    this.figure = figure();
    this.scene.add(this.figure);

    // ── world ──
    this.ocean = new Ocean(this.scene);
    this.sky = new Sky(this.scene, this.ocean);
    this.sky.held = true;                   // the clock only moves when you move it
    this.fog = this.scene.fog;
    this.underwater = new Underwater(this.scene, this.ocean);
    this.worldBits = [this.sky.dome, this.sky.sun, this.sky.hemi, this.sky.moon, this.ocean.mesh];

    this.asset = null;
    this.minutes = 12 * 60;
    this.bounds = null;
    this.setBackdrop('studio');
  }

  /**
   * @param kind     'studio' | 'world' | 'underwater'
   * @param minutes  time of day, for the world backdrops
   */
  setBackdrop(kind, minutes = this.minutes) {
    this.backdrop = kind;
    this.minutes = minutes;
    const world = kind !== 'studio';
    this.studio.visible = !world;
    for (const o of this.worldBits) o.visible = world;
    // The drifting motes belong to being under water; the game's underwater
    // pass shows them again when the camera is.
    this.underwater.motes.visible = false;
    // The sea is there underwater, overhead, and in the world backdrop only
    // for an asset that lives in it — a dinosaur on a sand floor does not
    // want to be standing in the ocean.
    this.ocean.mesh.visible = kind === 'underwater' || (kind === 'world' && !!this.asset?.ownsWater);
    this.scene.fog = world ? this.fog : null;
    this.scene.background = world ? null : new THREE.Color(0x2a2e33);
    this.sky.setMinutes(minutes);
    // Sunk for the underwater look — unless the asset already sits at its
    // real height in the world, like a chunk of sea bed.
    this.root.position.y = kind === 'underwater' && !this.asset?.keepHeight ? -DEPTH : 0;
    this.floor.material.color.setHex(kind === 'studio' ? 0x8b8f93 : kind === 'world' ? 0xcdbb8f : 0xc0ac83);
    this.place();
  }

  /** Put an asset on the stage and return its framing. */
  show(asset) {
    this.clear();
    this.asset = asset;
    if (asset?.object) this.root.add(asset.object);
    this.setBackdrop(this.backdrop);
    return this.bounds;
  }

  clear() {
    if (this.asset?.object) this.root.remove(this.asset.object);
    this.asset = null;
  }

  /** Size the floor, grid, figure and shadow to what is on show. */
  place() {
    const a = this.asset;
    const box = new THREE.Box3();
    // From the root down: the root has just moved if the backdrop changed
    // between studio and underwater, and measuring against its old matrix
    // frames the camera ten metres from where the model is.
    this.root.updateMatrixWorld(true);
    if (a?.object) box.setFromObject(a.object);
    if (a?.frame) {
      // Some assets are larger than what is worth framing — the ocean is a
      // 900 m sheet — so they say what to look at instead.
      const c = this.root.position.clone().add(a.frame.center);
      box.setFromCenterAndSize(c, a.frame.size);
    }
    if (box.isEmpty()) box.setFromCenterAndSize(this.root.position, new THREE.Vector3(1, 1, 1));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Framed on the longest side rather than the diagonal: the diagonal
    // leaves a long, low animal as a speck in the middle of the view.
    const radius = Math.max(0.12, Math.max(size.x, size.y, size.z) * 0.62);
    this.bounds = { center, radius, size, box };

    const ground = a?.ground !== false;
    const floorY = this.root.position.y + (a?.floorY ?? 0);
    const span = Math.max(2.5, Math.max(size.x, size.z) * 1.7 + 2);
    this.floor.visible = ground;
    this.floor.scale.setScalar(span);
    // Caustics light anything at or below the waterline, and the floor sits
    // at y=0 — so above water it is lifted a hair clear of it.
    const sunk = this.root.position.y < 0;
    this.floor.position.set(center.x, floorY + (sunk ? -0.003 : 0.003), center.z);

    // One square a metre, however big the asset.
    const n = Math.min(300, Math.ceil(span * 2));
    this.grid.geometry.dispose();
    this.grid.geometry = new THREE.GridHelper(n, n).geometry;
    this.grid.position.set(center.x, floorY, center.z);
    this.grid.userData.ground = ground;
    this.grid.visible = ground && this.gridOn !== false;
    this.figure.visible = ground && this.figureOn !== false;
    // Beside the tail end (models face +Z), a little to the side: visible from
    // the default and side views, and never between the camera and the asset.
    this.figure.position.set(box.min.x - 0.35, floorY, box.min.z - 0.6);

    const s = this.key.shadow.camera;
    const r = Math.max(3, radius * 1.3);
    s.left = s.bottom = -r; s.right = s.top = r;
    s.near = 0.5; s.far = r * 6;
    s.updateProjectionMatrix();
    this.key.position.copy(center).add(new THREE.Vector3(0.6, 1, 0.7).multiplyScalar(r * 2));
    this.key.target.position.copy(center);
    // The game's sun follows a focus point; give it this one. (Studio has no
    // fog for the sky to colour, and does not use the sky.)
    if (this.backdrop !== 'studio') this.sky.update(0, center);
  }

  set showGrid(v) { this.gridOn = v; this.grid.visible = v && this.floor.visible; }
  set showFigure(v) { this.figureOn = v; this.figure.visible = v && this.floor.visible; }

  tick(dt, time, camera) {
    this.asset?.update?.(dt, time, camera, this);
    setReefTime(time);
    if (this.backdrop === 'studio') {
      CAUSTICS.uTime.value = time;
      CAUSTICS.uCaustics.value = 0;        // no sea over the studio
      return;
    }
    this.sky.update(dt, this.bounds.center);
    this.ocean.update(time, camera.position);
    const eye = camera.position;
    const submerged = eye.y < waveHeight(eye.x, eye.z, time);
    this.underwater.update(dt, eye, submerged, Math.max(0, -eye.y),
                           this.sky, this.scene, this.sky.night);
  }
}

/** A plain grey person, 1.75 m to the top of the head. */
function figure() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.8 });
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 10), m);
  legs.position.y = 0.15;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 10), m);
  body.position.y = 0.67;
  body.scale.x = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), m);
  head.position.y = 1.62;
  for (const o of [legs, body, head]) { o.castShadow = true; g.add(o); }
  return g;
}
