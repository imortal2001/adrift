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
  // Held tools, drawn by src/viewmodel.js. Prepared by tools/build_tools.py
  // into one frame — standing along +Y, origin at the grip — so `yaw` is
  // unused for them; the pose table in viewmodel.js does the turning.
  tool_hammer: { file: 'tool_hammer.glb', yaw: 0 },
  tool_spear:  { file: 'tool_spear.glb',  yaw: 0 },
  tool_rod:    { file: 'tool_rod.glb',    yaw: 0 },
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

    return { group, root, mixer, actions, stand, model: true, current: null };
  }
}

/** Crossfade a model rig to the action that suits what it is doing. */
export function playState(rig, kind, fade = 0.25) {
  if (!rig.mixer) return;
  const next = rig.actions[kind] || rig.actions.idle;
  if (!next || next === rig.current) return;
  next.reset().fadeIn(fade).play();
  if (rig.current) rig.current.fadeOut(fade);
  rig.current = next;
}
