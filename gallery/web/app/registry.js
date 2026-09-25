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
import { mergeGeometries } from '/vendor/jsm/utils/BufferGeometryUtils.js';
import { ModelLibrary } from '/src/models.js';
import { SPECIES as DINOS, Wildlife } from '/src/wildlife.js';
import { FishSchools, normalise, BODY_LENGTH, BIG } from '/src/fish.js';
import { swimMaterial, styleFor, Swimmer, skinOf } from '/src/swim.js';
import { statueBody } from '/src/statue.js';
import { Whale } from '/src/whale.js';
import { FIGHTERS } from '/src/fight.js';
import { REEF, reefGeometry, reefMaterial } from '/src/reef.js';
import { Terrain, CHUNK, WORLD, heightAt, coastDistance, reefMask, landAt, RIVERS, riverGeometry, riverCourse, LAKES, FALLS } from '/src/terrain.js';
import { Waterfall, lakeGeometry } from '/src/waterfall.js';
import { REEF_ANIMALS, turtleBody, rayBody, octopusBody, Crabs, OCTO_SHADES } from '/src/reeflife.js';
import { octopusModel, rayModel, shelledModel, seaTurtleModel } from '/src/reefmodels.js';
import { SPECIES as FLORA, speciesMesh, setFloraTime } from '/src/flora.js';
import { ITEMS, DEBRIS_KINDS, BUILDABLES, FIRE } from '/src/items.js';
import { POSES, Viewmodel, FLAME } from '/src/viewmodel.js';
import { CAVES, ARCH_LIST, SHELF_LIST, survey as surveyCaves, caveGeometry, archGeometry, shelfGeometry, caveMaterial } from '/src/caves.js';
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
  { category: 'animals', name: 'Land animals (not dinosaurs)', note: 'Nothing but dinosaurs, tortoises and pond turtles lives on the continent — no mammals.' },
  { category: 'animals', name: 'Birds and flying animals', note: 'There is nothing in the air at all — no gulls over the sea, no pterosaurs.' },
  { category: 'equipment', name: 'Survival gear', note: 'No water bottle, knife, net, or armour.' },
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

  // ── reef animals (src/reeflife.js): built in code, moving as they do in play ──
  const reefFacts = (key, extra) => [['Lives', REEF_ANIMALS[key].where], ['Round you', `${REEF_ANIMALS[key].count} at a time`], ...extra];
  // Where a model is here (src/reefmodels.js; CREDITS.md) it is shown, and the code-built one is a variant.
  const reefModel = key => (manifest.has(key) ? lib.get(key) : Promise.resolve(null));
  const modelled = (key, file) => manifest.has(key)
    ? { kind: 'glTF model', files: [file], source: `assets/models/${file} · tools/build_sealife.py · src/reefmodels.js · CREDITS.md` }
    : { kind: 'built in code' };
  add({
    id: 'reef-turtle', name: 'Sea turtle', category: 'animals', group: 'Reef animals',
    ...modelled('sea_turtle', 'sea_turtle.glb'), backdrop: 'underwater',
    source: (manifest.has('sea_turtle') ? 'assets/models/sea_turtle.glb · tools/build_sealife.py · seaTurtleModel(); fallback ' : '') + 'src/reeflife.js · turtleBody() · ReefLife.turtle()',
    facts: reefFacts('turtle', [['Size', 'about a metre, shell plated olive and brown'],
      ['Behaviour', 'glides on slow sweeps of its front flippers; rises every minute or two to breathe at the surface; turns away, unhurried, if you swim at it'],
      ['Moves by', manifest.has('sea_turtle') ? 'its flippers found in the mesh and beaten in the vertex shader' : 'four flippers, each turned about its shoulder'],
      ['Caught with', 'nothing — it is left alone']]),
    variants: [{ id: 'cruise', label: 'Cruising' }, { id: 'flee', label: 'Swimming off' }, { id: 'code', label: 'Built in code' }],
    async build(variant) {
      const entry = variant === 'code' ? null : await reefModel('sea_turtle');
      const t = entry ? seaTurtleModel(entry, 1.1) : turtleBody(), fast = variant === 'flee';
      return { object: t, keepHeight: true, frame: { center: V(0, 0.05, 0.1), size: V(1.4, 0.4, 1.5) },
               update: (dt, time) => t.userData.animate(time, fast ? 0.7 : 0.28, 1) };
    },
  });
  add({
    id: 'reef-ray', name: 'Stingray', category: 'animals', group: 'Reef animals',
    ...modelled('stingray', 'stingray.glb'), backdrop: 'underwater',
    source: (manifest.has('stingray') ? 'assets/models/stingray.glb (CC BY-NC — see CREDITS.md) · tools/build_sealife.py · rayModel(); fallback ' : '') + 'src/reeflife.js · rayBody() · ReefLife.ray()',
    facts: reefFacts('ray', [['Size', 'a metre across the wings, and a whip of a tail'],
      ['Behaviour', 'lies on the sand; lifts off and flies low on rippling wings; off at a rush if you come within 3.5 m'],
      ['Moves by', manifest.has('stingray') ? 'its own swim clip, run as slow or as fast as it is going' : 'its disc re-shaped every frame'],
      ['Caught with', 'nothing — it is left alone']]),
    variants: [{ id: 'glide', label: 'Gliding' }, { id: 'flee', label: 'Fleeing' }, { id: 'rest', label: 'Resting' },
               { id: 'code', label: 'Built in code' }],
    async build(variant) {
      const entry = variant === 'code' ? null : await reefModel('stingray');
      const r = entry ? rayModel(entry, 1.1) : rayBody();
      const [beat, amp] = { glide: [0.5, 0.06], flee: [1.4, 0.12], rest: [0.5, 0.004], code: [0.5, 0.06] }[variant || 'glide'];
      r.userData.animate(0, beat, amp);
      return { object: r, keepHeight: true,
               frame: entry ? { center: V(0, 0.15, 0), size: V(1.3, 0.5, 1.6) } : { center: V(0, 0.05, -0.2), size: V(1.3, 0.4, 1.9) },
               update: (dt, time) => r.userData.animate(time, beat, amp) };
    },
  });
  add({
    id: 'reef-octopus', name: 'Octopus', category: 'animals', group: 'Reef animals',
    ...modelled('octopus', 'octopus.glb'), backdrop: 'underwater',
    source: (manifest.has('octopus') ? 'assets/models/octopus.glb · tools/build_sealife.py · octopusModel(); fallback ' : '') + 'src/reeflife.js · octopusBody() · ReefLife.octopus()',
    facts: reefFacts('octopus', [['Size', 'half a metre to a metre across the arms'],
      ['Behaviour', 'creeps over the coral, arms curling, its colour sliding to match what it is on; startled within 2.8 m, it blanches, jets off backwards and leaves a cloud of ink — then hides'],
      ['Moves by', manifest.has('octopus') ? 'its rig’s eight arm chains, curled and swept in code' : 'its arms re-shaped every frame'],
      ['Caught with', 'the spear — thrown, or thrust once it has hidden'], ['Eats as', 'a fish: cooks on the spit']]),
    variants: [{ id: 'crawl', label: 'Creeping' }, { id: 'jet', label: 'Jetting off' }, { id: 'code', label: 'Built in code' }],
    async build(variant) {
      const entry = variant === 'code' ? null : await reefModel('octopus');
      const o = entry ? octopusModel(entry, 0.8) : octopusBody(), jet = variant === 'jet';
      for (let k = 0; k < 30; k++) o.userData.animate(k * 0.05, jet ? 3 : 0.14, jet ? 1 : 0);   // its arms shaped before it is framed
      const shade = new THREE.Color(), a = new THREE.Color(), b = new THREE.Color();
      const tint = c => (o.userData.tint ? o.userData.tint(c) : o.userData.skin.color.copy(c));
      return { object: o, keepHeight: true, frame: { center: V(0, 0.1, 0), size: V(1.0, 0.35, 1.0) },
               update: (dt, time) => {
                 // It shifts through its colours, as it does to match the reef.
                 const k = time / 4, i = Math.floor(k) % OCTO_SHADES.length;
                 a.set(OCTO_SHADES[i]); b.set(OCTO_SHADES[(i + 1) % OCTO_SHADES.length]);
                 tint(jet ? shade.set(0xe8ddd0) : a.lerp(b, k - Math.floor(k)));
                 o.userData.animate(time, jet ? 3 : 0.14, jet ? 1 : 0);
               } };
    },
  });
  add({
    id: 'reef-crab', name: 'Crab', category: 'animals', group: 'Reef animals',
    ...modelled('crab', 'crab.glb'), backdrop: 'underwater',
    source: (manifest.has('crab') ? 'assets/models/crab.glb (a blue crab, in 13 parts) · tools/build_sealife.py; fallback ' : '') + 'src/reeflife.js · Crabs (instanced, part by part) · ReefLife.crab()',
    facts: reefFacts('crab', [['On the beaches', '8 more, sand-coloured, near you when you are ashore'],
      ['Size', '18–26 cm long, a third more across the legs'],
      ['Behaviour', 'scuttles sideways in short bursts; on the reef it runs a few metres from you, on a beach it runs for the sea'],
      ['Caught with', 'your hands: E, if you can get close'], ['Eats as', 'a fish: cooks on the spit']]),
    variants: [{ id: 'reef', label: 'On the reef' }, { id: 'beach', label: 'On the beach' }, { id: 'code', label: 'Built in code' }],
    async build(variant) {
      const g = new THREE.Group(), crabs = new Crabs(g, 1);
      const entry = variant === 'code' ? null : await reefModel('crab');
      if (entry) crabs.useModel(entry.scene);
      const colour = variant === 'beach' ? 0xd9c79c : entry ? 0xffffff : 0xc24a2c;
      const k = { pos: V(0, 0, 0), heading: 0, size: 1.1, colour: new THREE.Color(colour), gait: 0, moving: 1, claws: 0.4 };
      return { object: g, keepHeight: true, backdrop: variant === 'beach' ? 'world' : 'underwater',
               frame: { center: V(0, 0.05, 0.01), size: V(0.42, 0.14, 0.3) },
               update: (dt, time) => { k.gait = time * 3; k.claws = 0.4 + 0.3 * Math.sin(time * 2); crabs.draw([k]); } };
    },
  });
  // The tortoise and the pond turtle are models only: with no file, they are not in the game.
  // Their legs, head and tail move in the vertex shader; this drives it as ReefLife.limbs() does.
  const shelled = (key, sp, drive) => async variant => {
    const entry = await reefModel(key);
    if (!entry) return { object: null, missing: `assets/models/${key}.glb is not here (tools/build_sealife.py)` };
    const L = (sp.length[0] + sp.length[1]) / 2;
    const t = shelledModel(entry, L, key === 'tortoise' ? 2.6 : 1), u = t.userData.limbs;
    let step = 0;
    return { object: t, keepHeight: true, backdrop: drive.backdrop?.(variant) || 'world',
             frame: { center: V(0, L * 0.2, 0), size: V(L * 1.3, L * 0.5, L * 1.5) },
             update: (dt, time) => {
               const m = drive(variant, time);
               step += dt * (m.walk * 2.4 + m.swim * 3.2) * (0.35 / L) ** 0.5;
               u.uPhase.value = step;
               u.uStride.value = 0.06 * m.walk; u.uLift.value = 0.035 * m.walk; u.uSwim.value = 0.1 * m.swim;
               u.uHide.value = m.hide || 0; u.uGraze.value = (m.graze || 0) * (1 - (m.hide || 0));
               u.uLook.value = Math.sin(time * 0.4) * (1 - (m.hide || 0)) * (1 - m.walk);
             } };
  };
  add({
    id: 'tortoise', name: 'Tortoise', category: 'animals', group: 'Land animals',
    ...modelled('tortoise', 'tortoise.glb'),
    facts: [['Lives', REEF_ANIMALS.tortoise.where], ['Round you', `${REEF_ANIMALS.tortoise.count} at a time`],
      ['Size', '40–60 cm long'],
      ['Behaviour', 'plods a little way, stops to graze, plods on; come within 3 m and it stops and draws in its head and legs until you have gone'],
      ['Moves by', 'its legs, head and tail found in the mesh and moved in the vertex shader'],
      ['Caught with', 'nothing — it is left alone']],
    variants: [{ id: 'walk', label: 'Walking' }, { id: 'graze', label: 'Grazing' }, { id: 'hide', label: 'Drawn in' }],
    build: shelled('tortoise', REEF_ANIMALS.tortoise, (v, time) => ({
      walk: v === 'walk' ? 1 : 0, swim: 0,
      graze: v === 'graze' ? 0.5 + 0.5 * Math.sin(time * 1.7) : 0,
      hide: v === 'hide' ? 0.5 + 0.5 * Math.sin(time * 0.8) : 0,
    })),
  });
  add({
    id: 'pond-turtle', name: 'Pond turtle', category: 'animals', group: 'Land animals',
    ...modelled('pond_turtle', 'pond_turtle.glb'),
    facts: [['Lives', REEF_ANIMALS.pond_turtle.where], ['Round you', `${REEF_ANIMALS.pond_turtle.count}, when a lake is near`],
      ['Size', '17–24 cm long'],
      ['Behaviour', 'paddles about at the surface, shell awash; hauls out onto the bank to bask; come near and it slides back in, dives, and stays down a while'],
      ['Moves by', 'its legs, head and tail found in the mesh and moved in the vertex shader'],
      ['Caught with', 'nothing — it is left alone']],
    variants: [{ id: 'swim', label: 'Paddling' }, { id: 'walk', label: 'Hauling out' }, { id: 'bask', label: 'Basking' }],
    build: shelled('pond_turtle', REEF_ANIMALS.pond_turtle, Object.assign((v) => ({
      walk: v === 'walk' ? 1 : 0, swim: v === 'swim' ? 1 : 0,
    }), { backdrop: v => (v === 'swim' ? 'underwater' : 'world') })),
  });

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
    if (id === 'torch_lit') continue;                 // the torch's card shows it lit
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
      variants: hasModel ? [{ id: 'model', label: 'glTF model' }, { id: 'fallback', label: 'Built-in fallback' }]
              : id === 'torch' ? [{ id: 'lit', label: 'Burning' }, { id: 'unlit', label: 'Unlit' }] : null,
      async build(variant) {
        let obj = null;
        if (hasModel && variant !== 'fallback') obj = (await lib.get(pose.model))?.scene.clone(true);
        if (id === 'torch' && variant !== 'unlit') {
          obj = held.torch_lit.clone(true);
          return { object: rest(shadows(obj)), update: (dt, time) => { FLAME.uTime.value = time; } };
        }
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
    id: 'statue', name: 'Statue', category: 'objects', group: 'On land',
    kind: 'built in code', source: 'src/statue.js · statueBody()',
    facts: [['Where', 'two dozen stand about the land, to be found — or carve one (6 wood, 2 rope, 3 palm)'],
            ['What', 'register at it (E) and you wake beside it if you die; without one you wake where you first came to'],
            ['Moving it', 'X lifts it; click sets it down on land, or on the raft\'s deck, where it sails with you'],
            ['Size', 'about 1.9 m'], ['Garland', 'on the one you are registered at, on your screen']],
    variants: [{ id: 'plain', label: 'Standing' }, { id: 'yours', label: 'Yours (garlanded)' }],
    async build(variant = 'plain') {
      const obj = statueBody();
      obj.getObjectByName('garland').visible = variant === 'yours';
      return { object: shadows(obj) };
    },
  });

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

  // ── the falling water alone, against plain rock ──
  add({
    id: 'waterfall-water', name: 'Waterfall — the water', category: 'water', group: 'Lakes & falls',
    kind: 'built in code', backdrop: 'world', source: 'src/waterfall.js · Waterfall',
    facts: [['Curtains', 'three: a pale sheet at the back, two of bright streaks and clumps in front, each shuddering on its own'],
            ['Speed', 'the streaks run on time-of-fall, so they stretch as the water speeds up'],
            ['At the foot', 'two layers of foam turning against each other, a foam trail downstream, droplets flung up, spray drifting off'],
            ['In play', 'on each river, where it comes off the range: see Waterfall 1 and 2']],
    variants: FALLS.map((f, k) => ({ id: String(k), label: `As fall ${k + 1} (${Math.round(f.height)} m × ${Math.round(f.width)} m)` })),
    async build(variant) {
      const f0 = FALLS[+variant || 0] || { height: 18, width: 8 };
      const f = { ...f0, x: 0, z: 0, dx: 0, dz: 1, flow: { x: 0, z: 1 }, top: f0.height, bottom: 0 };
      const g = new THREE.Group();
      const w = new Waterfall(f);
      g.add(w.group);
      // The rock it falls over, the ledge above and the pool floor below.
      const rock = new THREE.MeshStandardMaterial({ color: 0x5b5750, roughness: 0.95 });
      const face = new THREE.Mesh(new THREE.BoxGeometry(f.width + 10, f.height, 8), rock);
      face.position.set(0, f.height / 2 - 0.02, -4);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(f.width + 10, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x4a4636, roughness: 1 }));
      bed.position.set(0, -1.3, 8);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(f.width + 10, 16), (await terrain()).rivers.still);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0, 8);
      for (const m of [face, bed]) { m.castShadow = m.receiveShadow = true; g.add(m); }
      g.add(pool);
      return {
        object: g, ground: false, keepHeight: true,
        frame: { center: V(0, f.height / 2, 4), size: V(f.width + 12, f.height + 4, 16) },
        update: (dt, time) => w.update(dt, time, null),
      };
    },
  });

  // ── caves and overhangs (src/caves.js): the ones the survey finds in the world ──
  surveyCaves();
  const rockWith = (geo, opts = {}) => {
    const m = new THREE.Mesh(geo, caveMaterial());
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const seaSheet = (w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1d6f86, transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false }));
    return m;
  };
  for (const kind of ['land', 'sea']) {
    const c = CAVES.find(x => x.kind === kind);
    const n = CAVES.filter(x => x.kind === kind).length;
    add({
      id: `cave-${kind}`, name: kind === 'land' ? 'Cave' : 'Sea cave', category: 'terrain', group: 'Caves & overhangs',
      kind: 'built in code', backdrop: 'studio', source: 'src/caves.js · caveGeometry() · survey()',
      facts: c ? [
        ['In the world', `${n}, ${kind === 'land' ? 'at the foot of the cliffs inland — none near the landing beach' : 'at the waterline under the sea cliffs'}`],
        ['This one', `at ${Math.round(c.mouth.x)}, ${Math.round(c.mouth.z)}: ${Math.round(c.o.tunnel)} m of tunnel, ${(c.o.width * 2).toFixed(1)} m wide, to a chamber ${Math.round(c.o.room * 2)} m across`],
        ['Inside', kind === 'land' ? 'a spring pool in the chamber to drink from, flint in the walls, stalactites — and dark past the first few metres'
                                   : 'you swim in; at the back a shingle beach to climb out on, flint in the walls, dark'],
        ['In play', 'a torch lights it; dinosaurs will not follow you in; your torch goes out in the water'],
        ['How it is made', 'a tube of rock set into the hill, the terrain cut away where it comes out of the cliff face; its floor and walls are what you walk on inside'],
      ] : [['In the world', 'none: the survey found nowhere for one']],
      variants: [{ id: 'whole', label: 'The whole tube' }, { id: 'cutaway', label: 'Cut away' }],
      async build(variant) {
        if (!c) return { object: null, missing: `the survey found no ${kind} cave` };
        const open = variant === 'cutaway';
        const g = new THREE.Group(), inner = new THREE.Group();
        inner.add(rockWith(caveGeometry(c, { open })));
        if (open && c.spring) {
          const w = new THREE.Mesh(new THREE.CircleGeometry(c.spring.r * 0.97, 28).rotateX(-Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x2c4a4c, roughness: 0.14, transparent: true, opacity: 0.7 }));
          w.position.set(c.spring.x, c.spring.level, c.spring.z);
          inner.add(w);
        }
        if (open) {
          const flint = new THREE.MeshStandardMaterial({ color: 0x33333a, roughness: 0.25, metalness: 0.2 });
          for (const f of c.flint) {
            const m = new THREE.Mesh(new THREE.IcosahedronGeometry(f.size, 1), flint);
            m.position.set(f.x, f.y, f.z);
            inner.add(m);
          }
        }
        if (kind === 'sea') { const sea = seaSheet(c.bound.r * 2.2, c.bound.r * 2.2); sea.position.set(c.bound.x, 0, c.bound.z); inner.add(sea); }
        inner.position.set(-c.bound.x, -c.mouth.y, -c.bound.z);
        g.add(inner);
        const r = c.bound.r;
        return { object: g, ground: false, keepHeight: true,
                 frame: { center: V(0, 1.5, 0), size: V(r * 1.6, open ? 3 : 6, r * 1.6) },
                 view: { yaw: Math.atan2(c.mouth.x - c.bound.x, c.mouth.z - c.bound.z) + 0.5, pitch: open ? 0.95 : 0.35 } };
      },
    });
  }
  add({
    id: 'sea-arch', name: 'Sea arch', category: 'terrain', group: 'Caves & overhangs',
    kind: 'built in code', backdrop: 'studio', source: 'src/caves.js · archGeometry() · survey()',
    facts: [['In the world', `${ARCH_LIST.length}, in the shallows off the sea cliffs`],
            ['Size', ARCH_LIST[0] ? `${Math.round(Math.hypot(ARCH_LIST[0].b.x - ARCH_LIST[0].a.x, ARCH_LIST[0].b.z - ARCH_LIST[0].a.z))} m foot to foot, ${Math.round(ARCH_LIST[0].top)} m over the sea` : '—'],
            ['In play', 'swim or sail under it; its legs are solid to you and to the raft']],
    async build() {
      const A = ARCH_LIST[0];
      if (!A) return { object: null, missing: 'the survey found nowhere for an arch' };
      const g = new THREE.Group(), inner = new THREE.Group();
      inner.add(rockWith(archGeometry(A)));
      const sea = seaSheet(40, 40);
      sea.position.set(A.x, 0, A.z);
      inner.add(sea);
      inner.position.set(-A.x, 0, -A.z);
      g.add(inner);
      return { object: g, ground: false, keepHeight: true, frame: { center: V(0, A.top * 0.45, 0), size: V(24, A.top + 4, 12) },
               view: { yaw: Math.atan2(A.nx, A.nz), pitch: 0.12 } };
    },
  });
  add({
    id: 'rock-shelf', name: 'Rock shelf', category: 'terrain', group: 'Caves & overhangs',
    kind: 'built in code', backdrop: 'studio', source: 'src/caves.js · shelfGeometry() · survey()',
    facts: [['In the world', `${SHELF_LIST.length}, jutting from the lips of the cliffs inland`],
            ['Size', SHELF_LIST[0] ? `${SHELF_LIST[0].d.toFixed(1)} m out from the lip, ${SHELF_LIST[0].w.toFixed(1)} m across` : '—'],
            ['In play', 'walk out onto it, or under it; its top is a floor like any other']],
    async build() {
      const sh = SHELF_LIST[0];
      if (!sh) return { object: null, missing: 'the survey found nowhere for a shelf' };
      const g = new THREE.Group(), inner = new THREE.Group();
      inner.add(rockWith(shelfGeometry(sh)));
      // The cliff it comes out of, as a plain face.
      const face = new THREE.Mesh(new THREE.BoxGeometry(sh.w + 4, 8, 3), new THREE.MeshStandardMaterial({ color: 0x6e6962, roughness: 0.95 }));
      face.position.set(sh.x - sh.ox * 2.2, sh.top - 4, sh.z - sh.oz * 2.2);
      face.rotation.y = sh.yaw;
      face.castShadow = face.receiveShadow = true;
      inner.add(face);
      inner.position.set(-sh.x, -sh.top + 4, -sh.z);
      g.add(inner);
      return { object: g, ground: false, keepHeight: true, frame: { center: V(sh.ox * sh.d * 0.4, 3, sh.oz * sh.d * 0.4), size: V(sh.w + 4, 8, sh.d + 4) },
               view: { yaw: sh.yaw + 0.9, pitch: 0.2 } };
    },
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
              ...(s.facts || []),
              ...(s.hi < -2 ? [['In-game look', 'choose In-game daylight and orbit down under the surface']] : [])],
      async build() {
        // One chunk — or, round a fall, every chunk near it, so nothing is cut through.
        const world = new THREE.Group();
        const chunks = s.chunks || [[s.i, s.j]];
        const c = { group: world };
        for (const [i, j] of chunks) {
          const k = t.buildChunk({ i, j, segs: 64, ring: 0 });
          k.group.removeFromParent();
          world.add(k.group);
        }
        const falls = [];
        if (s.river) {
          // The water, cut to these chunks: the rivers, the lakes and falls on them.
          const inside = (x, z, pad = 4) => chunks.some(([i, j]) =>
            Math.abs(x - i * CHUNK) < CHUNK / 2 + pad && Math.abs(z - j * CHUNK) < CHUNK / 2 + pad);
          for (const rv of RIVERS) {
            const geo = riverGeometry(rv, inside);
            if (geo) c.group.add(new THREE.Mesh(geo, t.rivers.material));
          }
          for (const L of LAKES) if (inside(L.x, L.z, L.a)) c.group.add(new THREE.Mesh(lakeGeometry(L), t.rivers.still));
          for (const f of FALLS) {
            if (!inside(f.x, f.z, 8)) continue;
            const w = new Waterfall(f);
            c.group.add(w.group);
            falls.push(w);
          }
        }
        const holder = new THREE.Group();
        holder.add(c.group);
        c.group.position.set(-s.i * CHUNK, 0, -s.j * CHUNK);
        const midY = (s.lo + s.hi) / 2;
        return {
          object: holder, ground: false, ownsWater: s.lo < 0.5, keepHeight: true,
          frame: s.frame ? { center: s.frame.center.clone().sub(V(s.i * CHUNK, 0, s.j * CHUNK)), size: s.frame.size }
                         : { center: V(0, s.focusY ?? midY, 0), size: V(CHUNK * 0.8, Math.max(8, s.hi - s.lo), CHUNK * 0.8) },
          ...(s.view ? { view: s.view } : {}),
          ...(falls.length ? { update: (dt, time) => { for (const w of falls) w.update(dt, time, null); } } : {}),
        };
      },
    });
  }

  add({
    id: 'continent', name: 'The whole continent', category: 'terrain', group: 'Land',
    // The island as you find it in play: every chunk of it built by the game
    // itself — its ground, its forests and plants, its rocks, its rivers,
    // lakes and falls — then drawn in a few big meshes so all of it fits.
    kind: 'built in code', backdrop: 'world', source: 'src/terrain.js · Terrain.buildChunk() for every chunk of land · buildRivers() · src/waterfall.js',
    facts: [['What', 'the whole island as the game builds it, chunk by chunk: ground, trees and plants, rocks, rivers, lakes and waterfalls'],
            ['Size', `about ${Math.round((WORLD.radius + 300) * 2 / 100) / 10} km across; peaks near 400 m`],
            ['Detail', 'as the game draws the land a couple of chunks from you: ground at 4 m, trees at their far detail; finer (2 m, every plant) along the rivers and round the lakes'],
            ['Rivers', `${RIVERS.length}, from springs in the range to the sea`],
            ['Waterfalls', FALLS.map((f, k) => `${Math.round(f.height)} m on river ${f.river + 1}`).join('; ')],
            ['Lakes', `${LAKES.filter(L => L.kind === 'tarn').length} tarns above the falls, ${LAKES.filter(L => L.kind === 'pool').length} plunge pools below them, ${LAKES.filter(L => L.kind === 'lake').length} lake on the plain`],
            ['Sea', 'a stand-in, see-through over the shallows: the game’s ocean only reaches 450 m from the camera'],
            ['Takes', 'a few seconds to build: some 800 chunks']],
    async build() {
      const C = CHUNK;
      const world = new THREE.Group();
      // Every chunk with land in it, or shallows off it; finer where there is fresh water.
      const near = (x, z) => {
        const L = landAt(x, z);
        return L.river < C * 0.75 || LAKES.some(k => Math.hypot(k.x - x, k.z - z) < k.a + C * 0.75);
      };
      const chunks = [];
      for (let i = Math.floor((WORLD.cx - 1500) / C); i <= Math.ceil((WORLD.cx + 1500) / C); i++) {
        for (let j = Math.floor((WORLD.cz - 1500) / C); j <= Math.ceil((WORLD.cz + 1500) / C); j++) {
          if (coastDistance(i * C, j * C) > -90) chunks.push({ i, j, ring: near(i * C, j * C) ? 1 : 2 });
        }
      }
      // Built one by one, as the game does, and gathered: the ground (and the
      // vines down the cliffs) by material, each plant by its shape and material.
      const plain = new Map(), herds = new Map();
      let n = 0;
      for (const { i, j, ring } of chunks) {
        const c = t.buildChunk({ i, j, ring });
        c.group.removeFromParent();
        c.group.updateMatrixWorld(true);
        c.group.traverse(o => {
          if (o.isInstancedMesh) {
            const k = o.geometry.uuid + '|' + (Array.isArray(o.material) ? o.material.map(m => m.uuid).join(',') : o.material.uuid);
            if (!herds.has(k)) herds.set(k, { geometry: o.geometry, material: o.material, parts: [], shadow: o.castShadow });
            herds.get(k).parts.push(o);
          } else if (o.isMesh) {
            if (!plain.has(o.material)) plain.set(o.material, []);
            plain.get(o.material).push(o.geometry.clone().applyMatrix4(o.matrixWorld));
          }
        });
        if (++n % 40 === 0) await new Promise(r => setTimeout(r, 0));
      }
      for (const [material, geos] of plain) {
        const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        const list = merged ? [merged] : geos;           // attributes that will not merge: left apart
        for (const g of list) {
          const m = new THREE.Mesh(g, material);
          m.receiveShadow = true;
          world.add(m);
        }
      }
      const m4 = new THREE.Matrix4(), col = new THREE.Color();
      for (const { geometry, material, parts, shadow } of herds.values()) {
        const total = parts.reduce((s, p) => s + p.count, 0);
        const all = new THREE.InstancedMesh(geometry, material, total);
        let k = 0;
        for (const p of parts) {
          for (let q = 0; q < p.count; q++, k++) {
            p.getMatrixAt(q, m4);
            all.setMatrixAt(k, m4.premultiply(p.matrixWorld));
            if (p.instanceColor) { p.getColorAt(q, col); all.setColorAt(k, col); }
          }
        }
        all.castShadow = shadow;
        all.receiveShadow = true;
        all.frustumCulled = false;
        world.add(all);
      }
      // The water, the game's own: the rivers and lakes, and the falls, pouring.
      for (const m of t.rivers.meshes) {
        const w = new THREE.Mesh(m.geometry, m.material);
        w.renderOrder = 2;
        world.add(w);
      }
      const falls = FALLS.map(f => { const w = new Waterfall(f); world.add(w.group); return w; });
      world.position.set(-WORLD.cx, 0, -WORLD.cz);
      const holder = new THREE.Group();
      holder.add(world);
      // A sea round it. Over the island's shelf, a sheet whose colour and
      // see-through follow the depth under it: pale turquoise over the sand
      // off the beaches, deep blue and opaque well before the built shallows
      // end. Beyond, a plain ring of deep sea to the horizon.
      const R = 1500, STEP = 20, N = R * 2 / STEP;
      const shallow = new THREE.Color(0x49b3c2), deep = new THREE.Color(0x1b5a7a), c3 = new THREE.Color();
      const pos = [], cols = [], idx = [];
      for (let b = 0; b <= N; b++) {
        for (let a = 0; a <= N; a++) {
          const x = -R + a * STEP, z = -R + b * STEP, wx = x + WORLD.cx, wz = z + WORLD.cz;
          const m = coastDistance(wx, wz), depth = Math.max(0, -heightAt(wx, wz));
          const d = m < -80 ? 1 : THREE.MathUtils.smoothstep(depth, 0, 16);
          c3.copy(shallow).lerp(deep, d);
          pos.push(x, 0.02, z);
          cols.push(c3.r, c3.g, c3.b, 0.45 + 0.55 * d);
          if (a && b) {
            const i = b * (N + 1) + a;
            idx.push(i - N - 2, i - 1, i - N - 1, i - N - 1, i - 1, i);
          }
        }
      }
      const sheet = new THREE.BufferGeometry();
      sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sheet.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
      sheet.setIndex(idx);
      sheet.computeVertexNormals();
      const seaMat = { roughness: 0.3, metalness: 0 };
      const sea = new THREE.Mesh(sheet, new THREE.MeshStandardMaterial({ ...seaMat, vertexColors: true, transparent: true, depthWrite: false }));
      sea.renderOrder = 1;
      const open = new THREE.Mesh(new THREE.RingGeometry(R * 0.98, 40000, 96, 1), new THREE.MeshStandardMaterial({ ...seaMat, color: deep }));
      open.rotation.x = -Math.PI / 2;
      open.position.y = 0.02;
      holder.add(sea, open);
      return { object: holder, ground: false, keepHeight: true, distant: true,
               frame: { center: V(0, 60, 0), size: V(2200, 300, 2200) }, view: { yaw: 0.5, pitch: 0.6 },
               update: (dt, time) => { setFloraTime(time); for (const w of falls) w.update(dt, time, null); } };
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
          // A stand-in field with the real one's methods (dress() calls dressNut()).
          const field = Object.assign(Object.create(DebrisField.prototype), { items: [{ kind, obj: o }] });
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
        // A foundation of any kind is shown alone; everything else on a plank one.
        raft.place(b.kind === 'cell' ? b.id : 'foundation', { cx: 0, cz: 0, force: true });
        const t = { cx: 0, cz: 0, ex: 0, ez: 0, es: 1, force: true };
        let obj;
        if (b.kind === 'cell') obj = raft.cells.values().next().value.obj;
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
  // The falls and the lakes: where terrain.js put them, on the rivers.
  const r1 = v => Math.round(v * 10) / 10;
  FALLS.forEach((f, k) => {
    const tarn = LAKES.find(L => L.kind === 'tarn' && Math.hypot(L.x - f.x, L.z - f.z) < 80);
    samples.push(pick(`fall-${k}`, `Waterfall ${k + 1}`, 'water', 'Lakes & falls', `where river ${f.river + 1} comes off the range, ${Math.round(f.x)}, ${Math.round(f.z)}`,
      'the fall, the tarn it spills from, the plunge pool, spray, the rock of the lip', chunkOf(f.x + f.dx * 8, f.z + f.dz * 8), {
        river: true,
        // Framed on the fall, not the middle of its chunk.
        frame: { center: V(f.x + f.dx * 3, (f.top + f.bottom) / 2, f.z + f.dz * 3), size: V(f.width + 4, f.height + 2, f.width + 4) },
        // From downstream, a little to one side, looking back up at it.
        view: { yaw: Math.atan2(f.dx, f.dz) + 0.35, pitch: 0.12 },
        chunks: (() => {
          const cx = f.x + f.dx * 6, cz = f.z + f.dz * 6, out = [];
          for (let i = Math.floor((cx - 60) / CHUNK); i <= Math.ceil((cx + 60) / CHUNK); i++) {
            for (let j = Math.floor((cz - 60) / CHUNK); j <= Math.ceil((cz + 60) / CHUNK); j++) {
              const dx = Math.max(0, Math.abs(cx - i * CHUNK) - CHUNK / 2), dz = Math.max(0, Math.abs(cz - j * CHUNK) - CHUNK / 2);
              if (Math.hypot(dx, dz) < 60) out.push([i, j]);
            }
          }
          return out;
        })(),
        facts: [['Drop', `${r1(f.height)} m, from ${r1(f.top)} m to ${r1(f.bottom)} m`], ['Width', `${r1(f.width)} m across the lip`],
                ['Above it', tarn ? `a tarn, ${Math.round(tarn.a * 2)} × ${Math.round(tarn.b * 2)} m, spilling over the lip` : 'the river'],
                ['Below it', 'a plunge pool, wading deep'],
                ['The water', 'three curtains that shudder and speed up as they fall, clumps tumbling, churning foam, a foam trail, droplets, spray']],
      }));
  });
  LAKES.filter(L => L.kind === 'lake').forEach((L, k) => samples.push(
    pick(`lake-${k}`, 'Lake', 'water', 'Lakes & falls', `where the first river idles across the plain, ${Math.round(L.x)}, ${Math.round(L.z)}`,
         'still water, a sandy shore, reeds and bamboo, the river in and out', chunkOf(L.x, L.z), {
           river: true,
           facts: [['Size', `about ${Math.round(L.a * 2)} × ${Math.round(L.b * 2)} m`], ['Level', `${r1(L.level)} m above the sea`],
                   ['Depth', 'wading: 1.3 m at the deepest'], ['Drink', 'E at the water: +30 thirst — it is fresh']],
         })));
  for (const s of samples) if (s.id === 'shallows') s.focusY = 0;
  return samples;
}
