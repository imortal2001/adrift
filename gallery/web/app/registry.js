// ── Registry ─────────────────────────────────────────────────────────────────
// Every asset the gallery knows about, and how to build it.
//
// Nothing here draws its own version of anything. Each builder asks the game
// for the real thing — a glTF from assets/models/, or the procedural body the
// game's own code makes — through the game's public API, so what you inspect
// is exactly what is drawn in play. The game is not modified for the gallery.
//
// Most entries are generated from the game's own tables, so a new species,
// coral, tree, flotsam kind, raft piece or held item appears here with no
// change to this file:
//
//   dinosaurs        SPECIES in src/wildlife.js
//   fish             FishSchools' species (src/fish.js)
//   corals           REEF in src/reef.js
//   trees & plants   SPECIES in src/flora.js (and the rocks and deadfall)
//   flotsam          DEBRIS_KINDS in src/items.js
//   raft pieces      BUILDABLES in src/items.js
//   held items       POSES in src/viewmodel.js
//
// One-off assets — the whale, the float, terrain samples, the ocean — are
// listed by hand below. And any .glb in assets/models/ that no entry claims
// still shows up, under "Other world objects", flagged as unregistered.
//
// See gallery/README.md, "Registering an asset".

import * as THREE from 'three';
import { ModelLibrary } from '/src/models.js';
import { SPECIES as DINOS, Wildlife } from '/src/wildlife.js';
import { FishSchools, normalise, BODY_LENGTH, BIG } from '/src/fish.js';
import { swimMaterial, styleFor, Swimmer, skinOf } from '/src/swim.js';
import { Whale } from '/src/whale.js';
import { FIGHTERS } from '/src/fight.js';
import { REEF, reefGeometry, reefMaterial } from '/src/reef.js';
import { Terrain, CHUNK, WORLD, heightAt, coastDistance, reefMask, landAt, RIVERS, riverGeometry } from '/src/terrain.js';
import { SPECIES as FLORA, speciesMesh, setFloraTime } from '/src/flora.js';
import { ITEMS, DEBRIS_KINDS, BUILDABLES, FIRE } from '/src/items.js';
import { POSES, Viewmodel } from '/src/viewmodel.js';
import { Fishing } from '/src/fishing.js';
import { Hook } from '/src/hook.js';
import { DebrisField } from '/src/debris.js';
import { Raft } from '/src/raft.js';
import { PlayerBody } from '/src/body.js';

// ── categories ───────────────────────────────────────────────────────────────
export const CATEGORIES = [
  { id: 'dinosaurs',  name: 'Dinosaurs',          blurb: 'The continent’s wildlife: every species that roams, grazes and hunts on land.' },
  { id: 'animals',    name: 'Living animals',     blurb: 'Everything alive that is not a dinosaur — the fish, the shark, the whale, and you.' },
  { id: 'equipment',  name: 'Equipment',          blurb: 'Tools, weapons and fishing gear: what you hold, and what you throw.' },
  { id: 'vegetation', name: 'Trees & vegetation', blurb: 'What grows on land.' },
  { id: 'terrain',    name: 'Land & terrain',     blurb: 'Real 64 m chunks of the world, cut from where each kind of ground is, plus the rocks.' },
  { id: 'water',      name: 'Water',              blurb: 'The sea, from above and below, and where it meets the land.' },
  { id: 'reef',       name: 'Corals & reefs',     blurb: 'What grows on the sea bed, and a colony as the game lays it out.' },
  { id: 'objects',    name: 'Other world objects', blurb: 'Flotsam, the raft and everything built on it, and anything not yet registered.' },
];

/**
 * What the game does not have yet: shown in the gallery's "Gaps" view so the
 * library says what is missing as well as what is there. Keep it honest —
 * delete a line when the thing arrives.
 */
export const GAPS = [
  { category: 'animals', name: 'Land animals (not dinosaurs)', note: 'Nothing but dinosaurs lives on the continent.' },
  { category: 'animals', name: 'Birds and flying animals', note: 'There is nothing in the air at all — no gulls over the sea, no pterosaurs.' },
  { category: 'water', name: 'Lakes and waterfalls', note: 'Two rivers run off the range to the sea; there is no standing fresh water, and nothing falls.' },
  { category: 'equipment', name: 'Survival gear', note: 'No water bottle, knife, net, torch, or armour.' },
  { category: 'terrain', name: 'Caves and overhangs', note: 'Terrain is one heightfield: cliffs are steep, but nothing overhangs.' },
  { category: 'reef', name: 'Reef animals that move', note: 'Nothing on the reef moves but the fish: no octopus, turtles, rays or crabs.' },
  { category: 'objects', name: 'Shipwrecks and weather', note: 'Deliberately out of scope for the prototype (see README).' },
];

// ── shared game objects ──────────────────────────────────────────────────────
// Built lazily, once. Each is the game's own class, made without a real
// scene — the gallery only takes the bodies it builds.
const lib = new ModelLibrary();
const scratch = new THREE.Scene();                 // somewhere for game classes to add things
const once = f => { let p; return () => (p ||= f()); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const raftStub = { group: { position: V() }, cells: new Map() };

/** One of every wildlife species, procedural, without the glTF swap. */
const wildlife = once(async () => {
  const swap = Wildlife.prototype.loadModels;
  Wildlife.prototype.loadModels = () => {};        // the gallery loads models itself
  try { return new Wildlife(scratch, { x: 210, z: -150 }); }
  finally { Wildlife.prototype.loadModels = swap; }
});

/** The fish species table, as FishSchools holds it. */
const schools = once(async () => new FishSchools(scratch, null, null));

/** The held-tool procedural bodies, taken before any glTF arrives. */
const heldBodies = once(async () => {
  const vm = new Viewmodel(null, new THREE.PerspectiveCamera(), null);
  const out = {};
  for (const id of Object.keys(POSES)) out[id] = vm.body(id);
  return out;
});

/** One of each kind of flotsam, from the game's own debris field. */
const flotsam = once(async () => {
  const found = {};
  for (let tries = 0; tries < 6 && Object.keys(found).length < Object.keys(DEBRIS_KINDS).length; tries++) {
    const field = new DebrisField(scratch, raftStub);
    for (const it of field.items) {
      if (!found[it.kind]) found[it.kind] = it.obj;
      else it.obj.removeFromParent();
    }
  }
  for (const o of Object.values(found)) o.removeFromParent();
  return found;
});

const terrain = once(async () => new Terrain(scratch));

function disposeChunk(c) {
  c.group.removeFromParent();
  c.group.traverse(o => { if (o.isMesh && !o.isInstancedMesh) o.geometry.dispose(); });
}

// ── helpers ──────────────────────────────────────────────────────────────────
/** Stand an object on the floor: bottom at y=0, centred on the origin. */
function rest(obj, lift = 0) {
  const g = new THREE.Group();
  g.add(obj);
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const c = b.getCenter(V());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b.min.y - lift;
  return g;
}

function shadows(obj) {
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}

/** A body from reef_fish.glb, with its painted skin. */
async function reefFishMesh(name, model = null) {
  // A species with a model file of its own takes its body from that, as the
  // game does (the blacktip: tools/build_shark.py).
  const entry = await lib.get(model || 'reef_fish');
  let src = null;
  entry?.scene.traverse(o => { if (o.isMesh && (o.name === name || (model && !src))) src = o; });
  if (!src && model) return reefFishMesh(name);
  return src;
}

/**
 * A fish that swims: the game's swim shader and swim driver on one fish, as
 * speared and hooked fish are drawn in play. Its "animations" are the ways a
 * fish moves in the game, so each can be inspected on its own.
 */
const MOVES = ['Cruise', 'Fast', 'Glide', 'Turning', 'Startle', 'Hooked', 'Landed'];
function swimmer(geo, key, { axis = 'x', color = 0xffffff, length = 1, lift = 0.3, skin = null }) {
  const g = normalise(geo);
  const style = styleFor(key);
  const mat = swimMaterial({ axis, style, single: true, skin });
  mat.color.set(color);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  g.computeBoundingBox();
  const s = length / BODY_LENGTH;
  const size = g.boundingBox.getSize(V()).multiplyScalar(s);
  const y = size.y / 2 + lift;
  mesh.position.set(0, y, 0);
  mesh.scale.setScalar(s);
  const sw = new Swimmer(style, 1);
  let move = 'Cruise', since = 0;
  return {
    object: mesh,
    frame: { center: V(0, y, 0), size },
    // Side-on and a little from the front: a fish is its profile. A flatfish
    // is its back, so that one is seen from above.
    view: axis === 'y' ? { yaw: 1.2, pitch: 0.75 } : { yaw: 1.2, pitch: 0.12 },
    clips: MOVES,
    play: name => { move = name; since = 0; },
    current: () => move,
    update: (dt, t) => {
      mat.userData.time.value = t;
      since += dt;
      switch (move) {
        case 'Fast': sw.step(dt, 2.2, 0, 0.3); break;
        case 'Glide': sw.coasting = true; sw.coastT = 1; sw.step(dt, 0.6, 0, 0); break;
        case 'Turning': sw.step(dt, 1, 1.3 * Math.sin(t * 0.7), 0); break;
        case 'Startle':
          // A fright every two seconds: the C-start snap, then a burst.
          if (since > 2) { since = 0; sw.startle(Math.random() < 0.5 ? -1 : 1); }
          sw.step(dt, since < 0.8 ? 3 : 1, 0, since < 0.8 ? 1 : 0);
          break;
        case 'Hooked': sw.step(dt, 1.6, Math.sin(t * 11) * 3, 1.2); break;
        case 'Landed': {
          const slap = Math.sin(t * 3.2) > 0.2;
          sw.step(dt, 0, slap ? Math.sin(t * 14) * 6 : 0, slap ? 1.4 : 0.1);
          break;
        }
        default: sw.step(dt, 1, 0, 0);
      }
      sw.writeVec(mat.userData.swim);
    },
  };
}

const range = (a, unit = 'm') => `${a[0]}–${a[1]} ${unit}`;
const pct = x => `${Math.round(x * 100)}%`;
const mid = a => (a[0] + a[1]) / 2;

// ── the list ─────────────────────────────────────────────────────────────────
/**
 * Every registered asset. Each is
 *   { id, name, category, group?, kind, files[], source, facts[[k, v]],
 *     backdrop, variants?[{ id, label }], build(variant) → asset }
 * and an asset is { object, update?, clips?, play?, frame?, ground?, ownsWater?, view? }.
 */
export async function loadRegistry() {
  const list = [];
  const add = e => list.push({ variants: null, backdrop: 'studio', files: [], ...e });
  const manifest = new Set((await lib.listed()) || []);

  // ── dinosaurs ──
  const wl = await wildlife();
  for (const [key, sp] of Object.entries(DINOS)) {
    const animal = () => wl.all.find(a => a.key === key);
    const hasModel = manifest.has(key);
    add({
      id: `dino-${key}`, name: sp.label, category: 'dinosaurs',
      group: sp.diet === 'meat' ? 'Carnivores' : 'Herbivores',
      kind: hasModel ? 'glTF model' : 'built in code',
      files: [`${key}.glb`],
      source: hasModel ? `assets/models/${key}.glb · src/wildlife.js` : 'src/wildlife.js · buildBody()',
      facts: [
        ['Diet', sp.diet === 'meat' ? 'carnivore' : 'herbivore'],
        ['In the world', `${sp.count}${sp.pack ? ', hunts in packs' : ''}`],
        ['Top speed', `${sp.speed} m/s`], ['Sight', `${sp.sight} m`], ['Health', sp.hp],
        ...(sp.damage ? [['Bite', `${sp.damage} damage every ${sp.biteEvery} s`]] : []),
      ],
      variants: hasModel ? [{ id: 'model', label: 'glTF model' }, { id: 'fallback', label: 'Built-in fallback' }] : null,
      async build(variant) {
        const a = animal();
        if (variant !== 'fallback' && hasModel) {
          const entry = await lib.get(key);
          if (entry) {
            // Sized exactly as the game sizes it: to the procedural body.
            const rig = lib.instantiate(entry, a.rig.length * sp.scale);
            rig.group.position.y = rig.stand;
            const clips = entry.clips.map(c => c.name);
            let action = null;
            const play = name => {
              const clip = entry.clips.find(c => c.name === name);
              if (!clip || !rig.mixer) return;
              const next = rig.mixer.clipAction(clip);
              if (action && action !== next) action.fadeOut(0.2);
              next.reset().fadeIn(0.2).play();
              action = next;
            };
            const idle = rig.actions.idle?.getClip().name ?? clips[0];
            if (idle) play(idle);
            return {
              object: rig.group, clips, play, current: () => action?.getClip().name,
              update: dt => rig.mixer?.update(dt),
            };
          }
        }
        const g = a.rig.group.clone(true);
        g.position.set(0, a.rig.stand * sp.scale, 0);
        g.rotation.set(0, 0, 0);
        g.visible = true;
        return { object: shadows(g) };
      },
    });
  }

  // ── fish ──
  const fish = await schools();
  for (const { sp } of fish.groups) {
    const fighter = FIGHTERS[sp.key];
    const where = { reef: 'over the reef', sand: 'on the open sand', mid: 'mid-water',
                    surface: 'near the surface', raft: 'under the raft', deep: 'past the drop-off' }[sp.zone];
    add({
      id: `fish-${sp.key}`, name: cap(sp.name), category: 'animals', group: 'Aquatic',
      kind: 'glTF model', backdrop: 'underwater',
      files: sp.model ? [`${sp.model}.glb`, 'reef_fish.glb'] : ['reef_fish.glb'],
      source: sp.model ? `assets/models/${sp.model}.glb · tools/${sp.model === 'shark_greatwhite' ? 'build_great_white' : 'build_shark'}.py · CREDITS.md`
                       : `assets/models/reef_fish.glb · mesh "${sp.mesh}" · tools/build_fish.py`,
      facts: [
        ['Lives', where], ['Length', range(sp.length)],
        ['Schools', `${sp.schools} × ${sp.per === 1 ? 'a lone fish' : sp.per + ' fish'}`],
        ['Caught with', sp.catchable === false ? 'nothing \u2014 scenery, like the whale'
          : sp.length[1] > BIG ? 'a baited line only' : 'spear or rod'],
        ['When approached', { hide: 'dives into the coral', bolt: 'bolts along the bottom, then settles',
          curious: 'turns to watch you; backs off only when close', retreat: 'backs away toward its hole, facing you',
          ignore: 'keeps its line; swerves at arm\u2019s length', dart: 'the school bursts away',
          circle: 'comes over and circles you, wide, to look',
          school: 'a fright ripples through the shoal' }[sp.react || 'school']],
        ...(fighter ? [['Fights', fighter.style]] : []),
        ...(sp.color !== 0xffffff ? [['Tint', '#' + sp.color.toString(16).padStart(6, '0')]] : []),
      ],
      variants: [{ id: 'model', label: 'glTF model' }, { id: 'fallback', label: 'Built-in fallback' }],
      async build(variant) {
        const body = variant === 'fallback' ? null : await reefFishMesh(sp.mesh, sp.model);
        const geo = variant === 'fallback' ? fallbackGeo(fish) : body?.geometry;
        if (!geo) return { object: null, missing: 'reef_fish.glb has no mesh named ' + sp.mesh };
        return swimmer(geo, sp.key, { axis: sp.zone === 'sand' ? 'y' : 'x', color: sp.color,
                                      length: mid(sp.length), lift: sp.zone === 'sand' ? 0.02 : 0.35,
                                      skin: skinOf(body) });
      },
    });
  }

  add({
    id: 'whale', name: 'Humpback whale', category: 'animals', group: 'Aquatic',
    kind: 'glTF model', files: ['whale_humpback.glb', 'reef_fish.glb'], backdrop: 'underwater',
    source: 'assets/models/whale_humpback.glb (tools/build_whale.py; fallback reef_fish.glb "whale") · src/whale.js',
    facts: [['Lives', '50–95 m from the raft'], ['Behaviour', 'cruises at 9 m, surfaces to blow, sounds flukes-up'],
            ['Caught with', 'nothing — scenery only']],
    async build() {
      const w = new Whale(scratch, null, raftStub, { library: lib });
      for (let i = 0; i < 200 && !w.ready; i++) await new Promise(r => setTimeout(r, 25));
      if (!w.ready) return { object: null, missing: 'neither whale_humpback.glb nor reef_fish.glb has a whale' };
      w.mesh.removeFromParent();
      w.update(0.001, 0);                          // lets it write its own scale
      const s = new THREE.Vector3();
      new THREE.Matrix4().fromArray(w.mesh.instanceMatrix.array).decompose(V(), new THREE.Quaternion(), s);
      const length = s.x * BODY_LENGTH;
      return swimmer(w.mesh.geometry, 'whale', { axis: 'y', length, lift: 0.8, skin: w.skin });
    },
  });

  // ── equipment ──
  const held = await heldBodies();
  for (const [id, pose] of Object.entries(POSES)) {
    const hasModel = !!pose.model && manifest.has(pose.model);
    add({
      id: `held-${id}`, name: ITEMS[id]?.name || cap(id), category: 'equipment',
      group: id === 'coconut' || id === 'fish' ? 'Food' : ITEMS[id]?.action ? 'Tools' : 'Crafting materials',
      kind: hasModel ? 'glTF model' : 'built in code',
      files: pose.model ? [`${pose.model}.glb`] : [],
      source: hasModel ? `assets/models/${pose.model}.glb · tools/${pose.model === 'coconut' ? 'build_coconut' : 'build_tools'}.py · CREDITS.md`
                       : `src/viewmodel.js · BODIES.${id}()`,
      facts: [['In hand', ITEMS[id]?.hint || 'nothing to do with it — a material, carried'],
              ...(id === 'fish' ? [['In play', 'every fish is its own item and is held as its own species; this is the stand-in for one the schools cannot draw']] : []),
              ['Frame', id === 'bowdrill' ? 'its own: the bow across, the spindle down, as held' : 'stands along +Y, origin at the grip']],
      variants: hasModel ? [{ id: 'model', label: 'glTF model' }, { id: 'fallback', label: 'Built-in fallback' }] : null,
      async build(variant) {
        let obj = null;
        if (hasModel && variant !== 'fallback') obj = (await lib.get(pose.model))?.scene.clone(true);
        obj ||= held[id].clone(true);
        // The game holds tools along +Y. For display they lie on the floor,
        // working end to the right, the way you would lay one out on a bench;
        // on end, a spear is a vertical hairline across a 4:3 card.
        const long = ['hammer', 'spear', 'rod', 'plank', 'leaf', 'fish'].includes(id);
        if (long) obj.rotation.z = -Math.PI / 2;
        return { object: rest(shadows(obj)), view: long ? { yaw: 0.25, pitch: 0.55 } : undefined };
      },
    });
  }
  // ── you ──
  // The player's body, as the third- and second-person views show it: the
  // game's own PlayerBody, walked on the spot by the same code as in play.
  const GAITS = { idle: ['deck', 0], walk: ['deck', 2.6], run: ['deck', 5.6], tread: ['swim', 0],
                  swim: ['swim', 1.6], dive: ['swim', 1.6, true], spear: ['swim', 1.6, false, true] };
  for (const [who, name] of [['woman', 'The player (woman)'], ['man', 'The player (man)']]) {
    const hasModel = manifest.has(`player_${who}`);
    add({
      id: `player-${who}`, name, category: 'animals', group: 'You',
      kind: hasModel ? 'glTF model' : 'built in code',
      files: hasModel ? [`player_${who}.glb`] : [],
      source: hasModel ? `assets/models/player_${who}.glb · tools/build_player.py · src/body.js · CREDITS.md`
                       : 'src/body.js · mannequin() — the stand-in until the model is converted',
      facts: [['Seen', 'in third person (behind you) and second (facing you) — V changes the view'],
              ['Motion', 'no animation in the file: the stride, swim, jump and arm swings are made in code (src/body.js)'],
              ['In the water', 'treading water upright; a front crawl at the surface; breaststroke under it, tipped toward where you are going'],
              ['Licence', hasModel ? 'Ready Player Me, CC BY-NC-SA 4.0 — non-commercial, and changes share alike' : 'original']],
      variants: [{ id: 'idle', label: 'Standing' }, { id: 'walk', label: 'Walking' }, { id: 'run', label: 'Running' },
                 { id: 'tread', label: 'Treading water' }, { id: 'swim', label: 'Front crawl' },
                 { id: 'dive', label: 'Breaststroke, under water' }, { id: 'spear', label: 'Swimming with a spear' }],
      async build(variant = 'idle') {
        const holder = new THREE.Group();
        const body = new PlayerBody(holder);
        await body.wear(who, lib);
        const [state, speed, submerged = false, spear = false] = GAITS[variant] || GAITS.idle;
        if (spear && held.spear) body.hold('spear', held.spear.clone(true));
        const p = { pos: new THREE.Vector3(0, state === 'swim' ? 0.6 : 0, 0), yaw: Math.PI, pitch: 0, state, speed, submerged };
        body.update(0.016, p);
        // Swimming somewhere, the body lies out behind the head.
        const lying = state === 'swim' && speed > 0;
        return { object: holder, update: dt => body.update(dt, p),
                 frame: lying ? { center: V(0, 1.75, -0.75), size: V(1.3, 0.8, 2.1) }
                              : { center: V(0, 0.9 + p.pos.y, 0), size: V(1.1, 1.9, 1.1) } };
      },
    });
  }

  add({
    id: 'float', name: 'Fishing float', category: 'equipment', group: 'Fishing gear',
    kind: 'built in code', source: 'src/fishing.js · Fishing constructor',
    facts: [['Used by', 'the rod'], ['Size', '20 cm — bigger than a real one, so it reads at 20 m']],
    async build() {
      const f = new Fishing(scratch, null, null, null);
      f.line.removeFromParent(); f.ripple.removeFromParent();
      f.float.visible = true;
      return { object: rest(shadows(f.float.removeFromParent())) };
    },
  });
  add({
    id: 'grapple', name: 'Grappling hook (thrown)', category: 'equipment', group: 'Tools',
    kind: 'built in code', source: 'src/hook.js · Hook constructor',
    facts: [['Used by', 'the hook, once thrown'], ['Reach', 'about 26 m']],
    async build() {
      const h = new Hook(scratch);
      h.rope.removeFromParent();
      h.head.visible = true;
      return { object: rest(h.head.removeFromParent()) };
    },
  });

  // ── trees & vegetation, rocks and deadfall ──
  const t = await terrain();
  for (const sp of FLORA) {
    const rock = sp.material === 'rock';
    const variants = Array.from({ length: sp.variants }, (_, v) => ({ id: String(v), label: `Variant ${v + 1}` }));
    if (sp.farFrom !== undefined) variants.push({ id: 'far', label: 'Far (level of detail)' });
    add({
      id: `flora-${sp.name}`, name: sp.label, category: rock ? 'terrain' : 'vegetation',
      group: rock ? 'Rocks' : sp.group, kind: 'built in code', backdrop: 'world',
      source: `src/flora.js · SPECIES.${sp.name}`,
      variants: variants.length > 1 ? variants : null,
      facts: [['Grows', sp.habitat],
              ['Size', `×${sp.scale[0]}–${sp.scale[1]} of this`],
              ['Drawn', `out to ${sp.rings} chunk${sp.rings > 1 ? 's' : ''} (${Math.round((sp.rings + 0.5) * CHUNK)} m)` +
                        (sp.farFrom !== undefined ? `, the cheap build from ${Math.round((sp.farFrom - 0.5) * CHUNK)} m` : '')],
              ...(sp.yield ? [['Harvest', Object.entries(sp.yield).map(([k, n]) => `${n} ${k}`).join(', ')],
                              ['Regrows', `${sp.regrow} s`]] : []),
              ...(sp.trunk || sp.solid ? [['Blocks you', 'yes']] : [])],
      async build(variant) {
        const far = variant === 'far';
        const mesh = speciesMesh(sp, far ? 0 : Number(variant || 0), far ? 1 : 0);
        return { object: shadows(mesh), update: (dt, time) => setFloraTime(time) };
      },
    });
  }
  const reefGeo = reefGeometry();

  // ── corals & rocks ──
  REEF.forEach((sp, i) => {
    const rock = sp.name === 'rock';
    add({
      id: `reef-${sp.name}`, name: REEF_NAMES[sp.name] || cap(sp.name),
      category: rock ? 'terrain' : 'reef', group: rock ? 'Rocks' : REEF_GROUPS[sp.name] || 'Corals & sponges',
      kind: 'built in code', backdrop: 'underwater', source: `src/reef.js · REEF.${sp.name}`,
      facts: [['Grows', `sea bed ${sp.depth[1]} to ${sp.depth[0]} m`],
              ['Where', sp.reef[0] >= 0.3 ? 'on the coral colonies' : sp.reef[1] < 0.5 ? 'on open sand between colonies' : 'anywhere on the sea bed'],
              ['Size', `×${sp.scale[0]}–${sp.scale[1]} of this`],
              ['In the surge', sp.soft === 0 ? 'rigid' : sp.soft < 1 ? 'sways a little' : 'sways'],
              ['Blocks you', sp.soft < 0.5 ? 'yes' : 'no — bends round you']],
      async build() {
        return { object: shadows(new THREE.Mesh(reefGeo[i], reefMaterial())) };
      },
    });
  });

  // ── terrain samples: real chunks of the world ──
  for (const s of await terrainSamples()) {
    add({
      id: `chunk-${s.id}`, name: s.name, category: s.category, group: s.group,
      // Sea bed is shown dry by default — from above the waves you would see
      // only water, and from inside it, 20 m of fog. The in-game look is one
      // click away: In-game daylight, then orbit down under the surface.
      kind: 'built in code', backdrop: s.hi < -2 ? 'studio' : 'world',
      source: `src/terrain.js · Terrain.buildChunk(${s.i}, ${s.j})`,
      facts: [['Where', s.where], ['Chunk', `${CHUNK} × ${CHUNK} m at (${s.i * CHUNK}, ${s.j * CHUNK})`],
              ['Height', `${s.lo.toFixed(0)} to ${s.hi.toFixed(0)} m`],
              ['Contains', s.contains],
              ...(s.hi < -2 ? [['In-game look', 'choose In-game daylight and orbit down under the surface']] : [])],
      async build() {
        const c = t.buildChunk({ i: s.i, j: s.j, segs: 64, ring: 0 });
        c.group.removeFromParent();
        if (s.river) {
          // The water, cut to this chunk.
          const inside = (x, z) => Math.abs(x - s.i * CHUNK) < CHUNK / 2 + 4 && Math.abs(z - s.j * CHUNK) < CHUNK / 2 + 4;
          for (const rv of RIVERS) {
            const geo = riverGeometry(rv, inside);
            if (geo) c.group.add(new THREE.Mesh(geo, t.rivers.material));
          }
        }
        const holder = new THREE.Group();
        holder.add(c.group);
        c.group.position.set(-s.i * CHUNK, 0, -s.j * CHUNK);
        const midY = (s.lo + s.hi) / 2;
        return {
          object: holder, ground: false, ownsWater: s.lo < 0.5, keepHeight: true,
          frame: { center: V(0, s.focusY ?? midY, 0), size: V(CHUNK * 0.8, Math.max(8, s.hi - s.lo), CHUNK * 0.8) },
        };
      },
    });
  }

  add({
    id: 'continent', name: 'The whole continent', category: 'terrain', group: 'Land',
    // In daylight, in its own sea: seen from kilometres off, the game's haze
    // would leave only a pale silhouette, so it asks for less (`distant`).
    kind: 'built in code', backdrop: 'world', source: 'src/terrain.js · Terrain.buildFar()',
    facts: [['What', 'the far land: every hill, the range and the forest canopy, coarse, as seen from the raft'],
            ['Size', `about ${Math.round((WORLD.radius + 300) * 2 / 100) / 10} km across; peaks near 400 m`],
            ['Sea', 'a flat stand-in, for the coastline: the game’s ocean only reaches 450 m from the camera'],
            ['Raft', 'the red post, where the game starts you'],
            ['In play', 'drawn wherever the detailed chunks do not reach']],
    async build() {
      const g = new THREE.Group();
      for (const m of [t.far.ground, t.far.canopy]) g.add(new THREE.Mesh(m.geometry, m.material));
      g.position.set(-WORLD.cx, 0, -WORLD.cz);
      const holder = new THREE.Group();
      holder.add(g);
      // A sea round it, so the coast reads as a coast rather than the edge
      // of a floating slab. The far land is only drawn above y 0.2, so this
      // takes over at the waterline.
      const sea = new THREE.Mesh(new THREE.CircleGeometry(40000, 96),
        new THREE.MeshStandardMaterial({ color: 0x1f5570, roughness: 0.75, metalness: 0 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = 0.05;
      holder.add(sea);
      // Where the raft is (the world origin), so you can see how far the
      // swim to the beach is: a post big enough to read from kilometres up.
      const post = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 120, 16),
        new THREE.MeshStandardMaterial({ color: 0xd8483a, roughness: 0.6 }));
      post.position.set(-WORLD.cx, 60, -WORLD.cz);
      holder.add(post);
      return { object: holder, ground: false, keepHeight: true, distant: true,
               frame: { center: V(0, 60, 0), size: V(2200, 300, 2200) }, view: { yaw: 0.5, pitch: 0.6 } };
    },
  });

  // ── water ──
  add({
    id: 'ocean', name: 'Open ocean', category: 'water', group: 'Sea',
    kind: 'shader', backdrop: 'world', source: 'src/ocean.js · Ocean (a 900 m sheet, waves in the vertex shader)',
    facts: [['Waves', 'four summed swells, ~1 m peak to trough'], ['Size', '900 × 900 m, follows the camera'],
            ['Tip', 'switch the time of day: the sea takes its colour from the sky']],
    variants: [{ id: 'above', label: 'From above' }, { id: 'below', label: 'From below' }],
    async build(variant) {
      const below = variant === 'below';
      return {
        object: null, ownsWater: true, ground: false, keepHeight: true,
        // From below, a small patch just under the surface, so the camera
        // stays in the bright top few metres rather than twenty down.
        frame: below ? { center: V(0, -0.8, 0), size: V(4, 0.6, 4) } : { center: V(0, 0, 0), size: V(14, 3, 14) },
        view: below ? { yaw: 0.6, pitch: -0.8 } : { yaw: 0.6, pitch: 0.22 },
      };
    },
  });

  // ── other world objects: flotsam ──
  const debris = await flotsam();
  for (const [kind, info] of Object.entries(DEBRIS_KINDS)) {
    if (!debris[kind]) continue;
    // The coconut wears the scanned nut once it loads (DebrisField.dress()).
    const scanned = kind === 'coconut' && manifest.has('coconut');
    add({
      id: `debris-${kind}`, name: info.label, category: 'objects', group: 'Flotsam',
      kind: scanned ? 'glTF model' : 'built in code',
      files: scanned ? ['coconut.glb'] : [],
      source: scanned ? 'assets/models/coconut.glb · tools/build_coconut.py · DebrisField.dress() · CREDITS.md'
                      : `src/debris.js · shapes().${kind}`,
      facts: [['Gives', Object.entries(info.yield).map(([k, n]) => `${n} ${k}`).join(', ')],
              ['How common', pct(info.weight / Object.values(DEBRIS_KINDS).reduce((s, d) => s + d.weight, 0))],
              ...(scanned ? [['Size', 'the nut in hand at 2.4 times the size (40 cm), so it reads at 20 m']] : [])],
      variants: scanned ? [{ id: 'model', label: 'glTF model' }, { id: 'fallback', label: 'Built-in fallback' }] : null,
      async build(variant) {
        let o = debris[kind].clone(true);
        if (scanned && variant !== 'fallback') {
          const field = { items: [{ kind, obj: o }] };
          await DebrisField.prototype.dress.call(field, lib);
        }
        o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
        return { object: rest(shadows(o)) };
      },
    });
  }

  // ── the raft and what is built on it ──
  for (const b of BUILDABLES) {
    add({
      id: `raft-${b.id}`, name: b.name, category: 'objects', group: 'Raft pieces',
      kind: 'built in code', source: b.id === 'campfire' ? 'src/raft.js · BUILD.campfire · src/fire.js' : `src/raft.js · BUILD.${b.id}`,
      facts: [['Costs', Object.entries(b.cost).map(([k, n]) => `${n} ${k}`).join(', ')], ['What', b.desc],
              ['Goes', { cell: 'in an empty grid square', edge: 'on a side of a square', top: 'over a square', object: 'in the middle of a square' }[b.kind]],
              ...(b.id === 'campfire' ? [['Fire', `built unlit; lit with a bow drill and 1 Palm; burns ${FIRE.perWood / 60} min per Wood, ${FIRE.max / 60} min at most`]] : [])],
      // A campfire is built unlit now, so both are worth seeing.
      variants: b.id === 'campfire' ? [{ id: 'lit', label: 'Lit' }, { id: 'unlit', label: 'Unlit' }] : null,
      async build(variant) {
        const raft = new Raft(scratch);
        raft.place('foundation', { cx: 0, cz: 0, force: true });
        const t = { cx: 0, cz: 0, ex: 0, ez: 0, es: 1, force: true };
        let obj;
        if (b.id === 'foundation') obj = raft.cells.values().next().value.obj;
        else {
          raft.place(b.id, t);
          obj = ({ edge: raft.edges, top: raft.tops, object: raft.objs })[b.kind].values().next().value?.obj;
        }
        if (!obj) return { object: null, missing: 'could not place ' + b.id };
        if (b.id === 'campfire' && variant !== 'unlit') {
          const rec = raft.objs.values().next().value;
          rec.lit = true; rec.fuel = Infinity;          // never burns down on show
        }
        obj.removeFromParent();
        return {
          object: rest(obj),
          update: (dt, time, camera, stage) => {
            raft.update(dt, time, stage.backdrop === 'studio' ? 0.4 : stage.sky.night);
            raft.group.position.set(0, 0, 0); raft.group.quaternion.identity();
          },
        };
      },
    });
  }
  add({
    id: 'raft', name: 'The raft', category: 'objects', group: 'Raft pieces',
    kind: 'built in code', backdrop: 'world', source: 'src/raft.js · Raft',
    facts: [['Starts as', 'four foundations, 2 × 2'], ['Shown with', 'walls, a roof, railings, a collector and a campfire'],
            ['On the water', 'heaves and tilts with the swell, as in play']],
    async build() {
      const raft = new Raft(scratch);
      raft.group.removeFromParent();
      raft.startingRaft();
      // A shelter on one square — three walls and a roof — railings round the
      // open side, and the two deck objects.
      for (const [ex, ez, es] of [[0, -1, 2], [-1, 0, 1], [0, 0, 2]]) raft.place('wall', { ex, ez, es });
      for (const [ex, ez, es] of [[1, 0, 1], [1, 1, 1], [1, 1, 2], [0, 1, 2], [-1, 1, 1]]) {
        raft.place('railing', { ex, ez, es });
      }
      raft.place('roof', { cx: 0, cz: 0 });
      raft.place('collector', { cx: 1, cz: 0 });
      raft.place('campfire', { cx: 1, cz: 1 });
      return {
        object: raft.group, ownsWater: true, keepHeight: true, ground: false,
        frame: { center: V(1, 1, 1), size: V(5, 3, 5) },
        update: (dt, time, camera, stage) => {
          raft.update(dt, time, stage.backdrop === 'studio' ? 0.4 : stage.sky.night);
          if (stage.backdrop === 'studio') { raft.group.position.set(0, 0.38, 0); raft.group.quaternion.identity(); }
        },
      };
    },
  });

  return list;
}

const REEF_NAMES = { brain: 'Brain coral', staghorn: 'Staghorn coral', fan: 'Sea fan',
                     barrel: 'Barrel sponge', anemone: 'Anemone', grass: 'Seagrass', rock: 'Boulder (sea bed)',
                     kelp: 'Kelp', urchin: 'Sea urchin', starfish: 'Starfish', clam: 'Giant clam' };
const REEF_GROUPS = { grass: 'Underwater plants', kelp: 'Underwater plants',
                      urchin: 'Reef animals', starfish: 'Reef animals', clam: 'Reef animals' };

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function fallbackGeo(fish) {
  // FishSchools keeps its fallback body normalised already.
  return fish.fallback;
}

/**
 * Pick real places in the world for each kind of ground, by asking the
 * terrain rather than hard-coding coordinates — reshape the world and these
 * follow it.
 */
async function terrainSamples() {
  const chunkOf = (x, z) => [Math.round(x / CHUNK), Math.round(z / CHUNK)];
  const stats = (i, j) => {
    let lo = Infinity, hi = -Infinity, reef = 0;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const x = i * CHUNK + a * 15, z = j * CHUNK + b * 15;
      const h = heightAt(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      reef += reefMask(x, z, -coastDistance(x, z)) / 25;
    }
    return { lo, hi, reef };
  };
  // A ray out from the continent's centre through the raft, and on to sea.
  const out = V(-WORLD.cx, 0, -WORLD.cz).normalize();
  const at = cd => {
    // The point on that ray whose coast distance is `cd` (positive inland).
    let best = null, bestErr = Infinity;
    for (let d = 0; d < 900; d += 4) {
      const x = WORLD.cx + out.x * d, z = WORLD.cz + out.z * d;
      const err = Math.abs(coastDistance(x, z) - cd);
      if (err < bestErr) { bestErr = err; best = [x, z]; }
    }
    return chunkOf(...best);
  };
  const pick = (id, name, category, group, where, contains, ij, extra = {}) => {
    const [i, j] = ij;
    return { id, name, category, group, where, contains, i, j, ...stats(i, j), ...extra };
  };

  // The highest ground near the centre: the ridge.
  let peak = [0, 0], peakH = -Infinity;
  for (let x = WORLD.cx - 300; x <= WORLD.cx + 300; x += 16) {
    for (let z = WORLD.cz - 300; z <= WORLD.cz + 300; z += 16) {
      const h = heightAt(x, z);
      if (h > peakH) { peakH = h; peak = [x, z]; }
    }
  }
  // Around the raft: the most reef, and the most bare sand.
  let reefIJ = [0, 0], sandIJ = [0, 0], most = -1, least = 2;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const s = stats(i, j);
    if (s.lo < -24 || s.hi > -4) continue;
    if (s.reef > most) { most = s.reef; reefIJ = [i, j]; }
    if (s.reef < least) { least = s.reef; sandIJ = [i, j]; }
  }

  const samples = [
    pick('beach', 'Beach & coastal plain', 'terrain', 'Land', 'where the sea meets the continent',
         'sand, driftwood logs, the forest edge behind the beach', at(0)),
    pick('forest', 'Forest hills', 'terrain', 'Land', 'about 100 m inland',
         'redwood and araucaria forest, tree ferns, ferns, shrubs, fallen logs and stumps, vines', at(100)),
    pick('ridge', 'Mountain ridge', 'terrain', 'Land', 'the high spine of the continent',
         'rock, scree, snow above ~250 m', chunkOf(...peak)),
    pick('shelf', 'Sea bed — sand shelf', 'terrain', 'Sea bed', 'the open sand between reef colonies, near the raft',
         'sand at ~18 m, seagrass, the odd boulder', sandIJ),
    pick('dropoff', 'The drop-off', 'terrain', 'Sea bed', 'where the shelf ends and the basin begins, past the raft',
         'the slope down to deep silt, deeper than one breath', at(-200)),
    pick('colony', 'Reef colony', 'reef', 'Formations', 'the densest coral near the raft',
         'coral heads with brain coral, staghorn, sea fans, sponges and anemones', reefIJ),
    pick('shallows', 'Shallows', 'water', 'Coast', 'the beach, seen as water',
         'the ocean over sand, from a metre deep to dry land', at(-10)),
  ];
  // Kinds of country found by what the land says it is, not by coordinates.
  const best = (score) => {
    let top = null, topS = -Infinity;
    for (let x = WORLD.cx - 1400; x <= WORLD.cx + 1400; x += 24) {
      for (let z = WORLD.cz - 1400; z <= WORLD.cz + 1400; z += 24) {
        const L = { ...landAt(x, z) };
        const v = score(L, x, z);
        if (v > topS) { topS = v; top = [x, z]; }
      }
    }
    return chunkOf(...top);
  };
  const near = (x, z) => Math.hypot(x, z) / 4000;       // prefer what is closest to the raft
  samples.push(
    pick('plains', 'Open plains', 'terrain', 'Land', 'the grassland between the forests',
         'tall seeding grass, shrubs, cycads, the odd araucaria and rock tor', best((L, x, z) => (L.h > 8 ? L.plain : 0) - near(x, z))),
    pick('escarpment', 'Escarpment', 'terrain', 'Land', 'where harder rock weathers into benches',
         'sandstone benches and cliff risers, crags, vines down the faces', best((L, x, z) => (L.h > 20 ? L.mesa : 0) - near(x, z))),
    pick('seacliff', 'Sea cliff', 'terrain', 'Coast', 'the exposed coast, well away from the raft',
         'a cliff straight out of the sea, forest along its top, sea stacks offshore',
         best((L, x, z) => (L.m > 0 && L.m < 25 ? L.cliff : 0) - near(x, z))),
    pick('river', 'River valley', 'water', 'Rivers', 'a river on its way down to the sea',
         'the river, mud and pebble banks, reeds, horsetails, tree ferns',
         best((L, x, z) => (L.h > 6 && L.river < 4 ? 1 : 0) - near(x, z)), { river: true }),
  );
  for (const s of samples) if (s.id === 'shallows') s.focusY = 0;
  return samples;
}
