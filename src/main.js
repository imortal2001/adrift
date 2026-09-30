// ── Adrift ───────────────────────────────────────────────────────────────────
// Ocean raft survival prototype. Gather → craft → build → upgrade the raft.

import * as THREE from 'three';
import { Ocean, waveHeight, setSeabed } from './ocean.js';
import { Sky, DAY_SECONDS } from './sky.js';
import { Rafts, windAt } from './raft.js';
import { setFloraWind } from './flora.js';
import { DebrisField, CURRENT } from './debris.js';
import { Hook } from './hook.js';
import { FishSchools } from './fish.js';
import { Whale } from './whale.js';
import { ReefLife } from './reeflife.js';
import { Underwater } from './underwater.js';
import { Viewmodel, THRUST_REACH, COOKED } from './viewmodel.js';
import { CameraRig } from './camera.js';
import { PlayerBody } from './body.js';
import { Net, newCode, cleanCode, PUB } from './net.js';
import { Together } from './together.js';
import { pickStart, WAKING } from './spawn.js';
import { Statues, newStatueId, scatter } from './statue.js';
import { ThrownSpears, travelTime } from './spear.js';
import { Fishing } from './fishing.js';
import { Terrain, heightAt as landHeight, coastDistance, CHUNK, landAt, freshWaterAt } from './terrain.js';
import { Caves, CAVES } from './caves.js';
import { FLAME } from './viewmodel.js';
import * as sound from './sound.js';
import { Wildlife } from './wildlife.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { BuildMode } from './build.js';
import { Inventory, RECIPES, ITEMS, DEBRIS_KINDS, CATCHES, FIRE, TORCH, CHOP_TIME, CHOP_HIT, fishItem, fishOf, foodOf, cookedItem, isCooked } from './items.js';
import { Hotbar, SLOTS } from './hotbar.js';

// A tab given a player of its own (sessionStorage 'adrift.pid' — net.js: for
// trying several players side by side in one browser) keeps its own game and
// name too, rather than each tab saving over the others'.
const TAB = (() => { try { return sessionStorage.getItem('adrift.pid'); } catch { return null; } })();
const SAVE_KEY = TAB ? `adrift.save.v2:${TAB}` : 'adrift.save.v2';
const NAME_KEY = TAB ? `adrift.name:${TAB}` : 'adrift.name';
const THROW_RELEASE = 0.27;         // s into the body's throw (body.js) that the spear leaves the hand
const SPIT_Y = 0.77;                 // the spit's cross-stick, above the campfire (raft.js)


// What the admin "give" buttons hand over. Enough to build without grinding,
// not so much that the numbers stop being readable.
const ADMIN_MATERIALS = { wood: 50, plank: 50, rope: 50, leaf: 50, scrap: 50, bamboo: 50, coconut: 10, flint: 10 };
// (Every tool there is — the axe, the paddle, the fire kit too — so testing does not mean crafting.)
const ADMIN_EQUIPMENT = ['hammer', 'hook', 'spear', 'rod', 'axe', 'paddle', 'bowdrill', 'torch', 'striker'];

/**
 * Admin tools exist only when the page is served from a development machine:
 * a loopback host, a file:// page, an mDNS *.local name, or a private LAN
 * address (so testing on a phone over your own wifi still counts). Anything
 * served from a real domain gets no admin mode at all — the key does nothing
 * and the panel is never created.
 */
function isLocalDev() {
  const h = location.hostname;
  if (location.protocol === 'file:') return true;
  if (h === '' || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '[::1]' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
  return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

const TORCH_EMBERS = 45;   // seconds a torch put away keeps smouldering, ready to flare again
const TORCH_LIGHT = 24;    // a lit torch's brightness: the cave wall beside you plain, the far end of the tunnel dim

// ── milestones ───────────────────────────────────────────────────────────────
// Light guidance instead of a tutorial: one thing to do next, always on screen
// (the objective line, top left), in the order a castaway needs them. Each is
// done once it has happened, whatever the order you got there in — the line
// shows the first that has not. `todo` is what to do; `done`, said as it ticks.
const has = type => g => [...g.raft.objs.values()].some(o => o.type === type);
// `where` is where you have to be to do it: the objective line prefers what
// can be done where you are — ashore, the island's; afloat, the raft's.
const GOALS = [
  { id: 'wood',    test: g => g.inv.count('wood') > 0 || g.inv.count('plank') > 0 || g.inv.has('hammer'),
    todo: 'Gather driftwood as it floats past: look at it and press <b>E</b>.', done: 'Driftwood gathered.' },
  { id: 'plank',   test: g => g.inv.count('plank') > 0 || g.inv.has('hammer'),
    todo: 'Open crafting (<b>C</b>) and split the wood into planks.', done: 'Planks made.' },
  { id: 'hammer',  test: g => g.inv.has('hammer'),
    todo: 'Craft a hammer (<b>C</b>): 2 planks and a rope. Rope is twisted from palm fibre.', done: 'A hammer.' },
  { id: 'aboard',  test: g => g.raft.size > 0 && g.player.state === 'deck' && !g.player.onLand,
    todo: g => g.raft.size ? 'Climb aboard your raft: swim up to it and press <b>Space</b>.'
                           : 'With the hammer out (<b>B</b>), look at the water and <b>click</b>: a first foundation, to climb onto.',
    done: 'Aboard.' },
  { id: 'grew',    where: 'sea', test: g => g.raft.size > 4,
    todo: 'With the hammer out (<b>B</b>), lay foundations: grow the raft to five decks.', done: 'The raft is growing.' },
  { id: 'water',   where: 'sea', test: has('collector'),
    todo: 'Thirst kills first: build a collector. It fills with rain and dew — <b>E</b> to drink.', done: 'Collector up.' },
  { id: 'hook',    where: 'sea', test: g => g.inv.has('hook'),
    todo: 'Craft a hook (<b>C</b>) and <b>right-click</b> to throw it at debris out of reach.', done: 'Hook ready.' },
  { id: 'fire',    where: 'sea', test: has('campfire'),
    todo: 'Build a campfire on the deck — fish is better cooked.', done: 'Campfire built.' },
  { id: 'lit',     where: 'sea', test: g => [...g.raft.objs.values()].some(o => o.type === 'campfire' && o.lit),
    todo: 'Light the fire: craft a bow drill (<b>C</b>) and <b>hold E</b> at the fire. It takes 1 Palm fibre.', done: 'Fire lit.' },
  { id: 'cook',    where: 'sea', test: g => g.cookedOnce || [...g.inv.slots].some(([id, n]) => n > 0 && isCooked(id)),
    todo: 'Cook a fish: catch one (a rod or a spear, <b>C</b>), then <b>E</b> at the lit fire.', done: 'A hot meal.' },
  { id: 'shelter', where: 'sea', test: g => [...g.raft.cells.values()].some(c => g.raft.isSheltered(c.cx, c.cz)),
    todo: 'Walls and a roof over a deck: sheltered, you tire and thirst far slower.', done: 'Shelter finished.' },
  { id: 'land',    where: 'sea', test: g => g.player.onLand,
    todo: g => `Land, ${g.wayTo(g.nearestLand())}. Paddle there (craft a paddle, <b>C</b>) or swim for it.`, done: 'Ashore.' },
  { id: 'statue',  where: 'land', test: g => !!g.registered,
    todo: 'Find a statue standing on the land — or craft one (<b>C</b>) — and press <b>E</b> at it: if you die, you wake beside it.',
    done: 'You will wake by your statue.' },
  { id: 'axe',     where: 'land', test: g => g.inv.has('axe'),
    todo: 'Craft an axe (<b>C</b>) to fell trees for wood. Branches and fronds come by hand.', done: 'An axe.' },
  { id: 'torch',   where: 'land', test: g => g.torchLitOnce || g.inv.has('striker'),
    todo: 'Craft a torch (<b>C</b>) and light it — at a burning fire (<b>E</b>), or anywhere with a fire striker: the caves are dark.', done: 'Torch lit.' },
  { id: 'cave',    where: 'land', test: g => !!g.player.cave || g.inv.has('flint') || g.inv.has('striker'),
    todo: g => `The nearest cave is ${g.wayTo(g.nearestCave())}, at the foot of the cliffs. Caves hide springs, and flint.`,
    done: 'A cave.' },
  { id: 'striker', where: 'land', test: g => g.inv.has('striker'),
    todo: 'Chip flint from a cave wall (<b>E</b>) — there is some by the mouth, in the light — and craft a fire striker (<b>C</b>).',
    done: 'Fire at a strike.' },
];

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // A felled tree is drawn clipped at its cut: the stump below, what falls above (terrain.js).
    this.renderer.localClippingEnabled = true;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Far enough for the whole continent: its far coast is ~2 km from the raft.
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 3200);
    // Your eyes. The player moves these, and everything you do works from
    // them — reach, aim, what notices you. The camera is put somewhere
    // relative to them each frame (camera.js): at them in first person,
    // behind you in third, in front looking back in second.
    this.eye = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 3200);

    this.ocean = new Ocean(this.scene);
    // The sea knows the ground under it: calm in the shallows, still over the land.
    setSeabed(landHeight);
    this.sky = new Sky(this.scene, this.ocean);
    // Every raft in the world (raft.js Rafts); `raft` is the one you are on
    // or by, which everything below is pointed at (setRaft).
    this.rafts = new Rafts(this.scene);
    this.raft = this.rafts.make();
    this.inv = new Inventory();
    this.hotbar = new Hotbar();
    // Terrain first: the player and the fish both collide against its reef.
    this.terrain = new Terrain(this.scene);
    // Before the first chunk is built: they keep their plants out of the cave mouths.
    this.caves = new Caves(this.scene);
    // A torch's light — yours, and one each for two of the others. Always in
    // the scene, dark until lit: adding a light later would make every
    // material in the world recompile at the moment you lit it.
    this.torch = { lit: false, fuel: 0, embers: 0 };
    // Trees part-chopped: plant key → { n: strokes so far, at: when the last was }.
    this.chops = new Map();
    this.plantClaims = new Map();   // a guest's plants, taken and waiting on the host's word (takeShared)
    this.plantTakers = new Map();   // hosting: who took each plant, to tell whoever was too slow
    this.torchLights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xffa35a, 0, 26, 2);
      this.scene.add(l);
      return l;
    });
    this.terrain.shareSky(this.ocean.uniforms);
    this.player = new Player(this.eye, this.raft, this.terrain);
    // Where you came to (spawn.js) and the statue you wake at (statue.js).
    this.origin = null;
    this.statues = new Statues(this.scene);
    this.registered = null;          // {id, world} or {raft: raft id, cx, cz, world}: world null for your own, else the room's code
    this.statueTip = false;          // told, this session, what a statue is for
    // Who wakes where in this world (not only you): a statue's key — its id,
    // or r:<raft>:<cx>,<cz> on a deck — to a Map of tag -> name. One that
    // someone else wakes at stays where it is.
    this.wakers = new Map();
    this.player.onDeath = () => this.respawn();
    this.debris = new DebrisField(this.scene, this.raft);
    // Seed the wildlife around a point well inland from the nearest coast.
    this.wildlife = new Wildlife(this.scene, { x: 210, z: -150 }, this.terrain);
    this.fish = new FishSchools(this.scene, this.terrain, this.raft);
    this.whale = new Whale(this.scene, this.terrain, this.raft, this.fish);
    // Turtles, stingrays, octopus and crabs (reeflife.js); crab and octopus are catches, as fish are.
    this.reef = new ReefLife(this.scene, this.terrain);
    this.fish.extra = this.reef;
    this.underwater = new Underwater(this.scene, this.ocean);
    this.hook = new Hook(this.scene);
    this.viewmodel = new Viewmodel(this.renderer, this.eye, this.sky);
    this.view = new CameraRig(this.camera, this.eye, this.raft, this.terrain);
    // You, from the outside: a character (woman or man) holding what you hold.
    this.body = new PlayerBody(this.scene);
    this.character = 'woman';
    // Others, when playing together (net.js): drawn from what the relay
    // passes on, in the same world, on the host's raft (together.js).
    this.together = new Together(this);
    this.net = new Net({ scene: this.scene, library: this.viewmodel.library,
                         cloneHeld: id => this.viewmodel.cloneBody(id),
                         catchBody: (key, length) => this.fish.displayBody(key, length),
                         log: (text, kind, ms) => this.hud.log(text, kind, ms),
                         raft: this.raft, rafts: this.rafts, together: this.together,
                         onEvent: (e, r) => this.fromCrew(e, r) });
    // Outside first person, a line hangs from the rod in the body's hand,
    // not the invisible one at your eye.
    this.viewmodel.tipOutside = (id, out) => {
      if (this.view.first || this.body.heldId !== id || !this.body.held) return null;
      this.body.held.updateWorldMatrix(true, false);
      return this.body.held.localToWorld(out.set(0, id === 'rod' ? 1.98 : 1.01, 0));
    };
    this.debris.dress(this.viewmodel.library);     // the scanned coconut, afloat too
    // Thrown spears wear the same body the hand holds, glTF or procedural.
    this.spears = new ThrownSpears(this.scene, this.terrain, this.raft, this.fish,
                                   () => this.viewmodel.cloneBody('spear'));
    this.spears.extra = this.reef;
    this.fishing = new Fishing(this.scene, this.raft, this.fish, this.viewmodel);
    // A fish in hand is the species it is: a still, hand-sized copy — a big
    // one scaled down, or a tuna held at arm's length would fill the view.
    this.viewmodel.fishBody = key => {
      const sp = this.fish.species(key);
      const mesh = sp && this.fish.displayBody(key, Math.min(sp.big ? 0.36 : 0.40, sp.length[1]));
      if (mesh) this.fish.lively.delete(mesh);   // held still, not struggling
      return mesh;
    };
    this.baitId = null;                          // which fish is on the hook as bait
    this.pendingThrow = null;                    // seconds until a third-person throw lets go
    this.hud = new HUD();
    this.input = new Input(this.renderer.domElement);
    this.build = new BuildMode(this.raft, this.inv, this.hud);
    // Away from any raft, a first foundation starts a new one.
    this.build.rafts = this.rafts;
    this.build.newRaft = () => !this.onDeck() && !this.raft.nearestDeck(this.player.pos.x, this.player.pos.z, 5);
    this.build.onNewRaft = r => { this.setRaft(r); this.hud.log('You lay the first foundation of a new raft.', 'good'); };
    this.build.guard = piece => this.salvageGuard(piece);

    this.ray = new THREE.Raycaster();
    this.tmpDir = new THREE.Vector3();
    this.clock = new THREE.Clock();
    this.time = 0;
    this.goalsDone = new Set();
    this.playing = false;
    this.wiped = false;
    this.slotHintUntil = 0;
    this.lastBite = -99;
    this.lastSave = 0;
    this.lastHealth = 100;

    this.hud.onCraft = (id, n) => this.craft(id, n);
    this.hud.onSelectSlot = i => { if (this.hotbar.select(i)) this.flashSlotHint(); };
    // The pack opened at someone (E, empty-handed): what you click goes to them.
    this.hud.onGive = (id, n) => {
      const mate = this.giveMate && this.net.remotes.get(this.giveMate.id);
      const near = mate?.body.visible && mate.pose && this.player.pos.distanceTo(mate.pose.pos) < 5;
      if (!near) { this.hud.log(`${this.giveMate?.name || 'They'} moved off — get close to hand things over.`, 'bad'); return; }
      this.give(mate, id, n);
      this.hud.refreshPack(this.inv, this.hotbar, true);
    };
    this.hud.onAssign = (slot, id) => {
      this.hotbar.assign(slot, id);
      this.hud.log(`${ITEMS[id].name} registered to slot ${slot + 1}.`, 'good');
    };

    this.admin = isLocalDev();
    if (this.admin) {
      this.hud.enableAdmin();
      this.hud.onAdminTime = (minutes, hold = false) => {
        this.sky.setMinutes(minutes);
        // Picking a preset means "make it this" — pointless if the cycle
        // slides it back to dawn a minute later.
        if (hold) this.sky.held = true;
        this.hud.syncAdmin(this.sky, true);
      };
      this.hud.onAdminHold = on => {
        this.sky.held = on;
        this.hud.syncAdmin(this.sky, true);
      };
      this.hud.onAdminGive = kind => {
        if (kind === 'equipment') {
          const added = [];
          for (const id of ADMIN_EQUIPMENT) {
            // Tools are unique, so top up only what is missing.
            if (!this.inv.has(id)) { this.inv.add(id, 1); added.push(ITEMS[id].name); }
            this.hotbar.autoAssign(id);     // usable straight away
          }
          this.hud.log(added.length
            ? `Admin: ${added.join(', ')} added.`
            : 'Admin: you already carry every tool.', 'good');
        } else {
          const parts = [];
          for (const id in ADMIN_MATERIALS) {
            this.inv.add(id, ADMIN_MATERIALS[id]);
            this.hotbar.autoAssign(id);     // no-op for raw stock
            parts.push(`${ADMIN_MATERIALS[id]} ${ITEMS[id].name}`);
          }
          this.hud.log(`Admin: ${parts.join(', ')}.`, 'good');
        }
        this.hud.refreshInventory(this.inv);
        this.hud.refreshHotbar(this.hotbar, this.inv);
        this.hud.refreshCraft(this.inv);
        this.hud.refreshPack(this.inv, this.hotbar);
      };

      this.hud.onAdminRestore = () => {
        this.player.health = 100;
        this.player.hunger = 100;
        this.player.thirst = 100;
        // Keep the damage flash from firing on the way back up.
        this.lastHealth = 100;
        this.hud.updateVitals(this.player);
        this.hud.log('Admin: health, hunger and thirst restored.', 'good');
      };
    }

    if (!this.loadSave()) {
      this.newStart();
    } else {
      this.hud.log('You pick up where you left off.');
    }
    // Place the world and the camera once before the first paint. The loop
    // renders while paused but returns early, so without this the splash
    // screen is backed by a camera still sitting at the origin — inside the
    // deck, which looks like the raft has vanished.
    this.rafts.update(0, this.time);
    this.sky.update(0, this.raft.group.position);
    this.player.applyCamera(0, this.time, false);
    this.view.update(0, this.time);
    this.ocean.update(this.time, this.camera.position);
    this.dress(this.character);               // from the save, or the default

    // Paint the HUD once up front, or the pause screen shows placeholder values
    // until the loop starts running.
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
    this.hud.updateVitals(this.player);
    this.hud.updateClock(this.sky, this.player, this.raft);

    this.bindUI();
    window.game = this;          // debug handle: inspect or poke state from the console
    this.renderer.setAnimationLoop(() => this.tick());
    this.keepTicking();
  }

  // ── plumbing ───────────────────────────────────────────────────────────────
  /**
   * Paused, playing together: you stand still — hunger and thirst wait, and
   * nothing hunts you — but the world is everyone's, and goes on. The host's
   * above all: its sky, its fires and collectors, the flotsam, the fish and
   * the dinosaurs are what the others see, and would stop for them too.
   */
  worldTick(dt) {
    const pl = this.player;
    this.sky.update(dt, pl.pos);
    this.rafts.update(dt, this.time, this.sky.night);
    // Aboard, the raft still carries you where it goes.
    if (pl.state !== 'swim' && !pl.onLand && this.raft.wasUnder(pl.pos.x, pl.pos.z)) pl.yaw += this.raft.carry(pl.pos);
    this.updateFires(dt);
    this.wildlife.setPlayerPos(pl.pos);
    this.wildlife.update(dt, this.time, pl, false);
    // A bite on one of the others is theirs to feel; a kill is everyone's.
    for (const b of this.wildlife.events.splice(0)) {
      if (b.to !== undefined) this.net.event({ k: 'bite', damage: b.damage, label: b.label }, b.to);
    }
    for (const k of this.wildlife.kills.splice(0)) this.together.world.killed(k);
    this.tellHunted();
    this.debris.update(dt, this.time, pl.pos);
    this.fish.update(dt, this.time, this.eye.position);
    this.whale.update(dt, this.time);
    this.spears.update(dt, this.time);
  }

  /**
   * A browser stops drawing a tab that is not in front — and with it the
   * frames the game runs on. Alone, that is a pause; playing together it would
   * stop the world for everyone (the host's game runs the time, the flotsam,
   * the dinosaurs) and leave you standing frozen in theirs. So while the tab is
   * hidden and you are in a game, a worker's timer — which the browser does not
   * slow the way it does the page's — keeps it going four times a second, in
   * steps no bigger than a frame, drawing nothing.
   */
  keepTicking() {
    let worker = null;
    const tick = () => {
      if (!document.hidden || !this.net.connected) return;
      const total = Math.min(this.clock.getDelta(), 1);
      const n = Math.max(1, Math.ceil(total / 0.05));
      for (let i = 0; i < n; i++) this.frame(total / n);
    };
    const watch = () => {
      if (document.hidden && !worker) {
        try {
          worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250);'], { type: 'text/javascript' })));
          worker.onmessage = tick;
        } catch { worker = { terminate: clearInterval.bind(null, setInterval(tick, 250)) }; }
        this.clock.getDelta();                // from now, not from the last frame drawn
      } else if (!document.hidden && worker) {
        worker.terminate();
        worker = null;
      }
    };
    document.addEventListener('visibilitychange', watch);
    watch();                                  // opened in the background: hidden from the start
  }

  /**
   * Pointer lock is refused outright in some contexts — an embedded frame, for
   * one. That is not an error: free look covers it, so we stop asking.
   */
  lockPointer() {
    if (this.input.lockDenied) return;
    try {
      const p = this.renderer.domElement.requestPointerLock?.();
      if (p?.catch) p.catch(() => this.onLockDenied());
    } catch {
      this.onLockDenied();     // older browsers throw instead of rejecting
    }
  }

  onLockDenied() {
    if (this.input.lockDenied) return;
    this.input.lockDenied = true;
    this.hud.log('This browser will not capture the mouse pointer here.', 'bad');
    this.hud.log('Free look is on instead — just move the mouse. Push it to the ' +
                 'edge of the window to keep turning.');
  }

  bindUI() {
    const canvas = this.renderer.domElement;

    document.getElementById('go').onclick = () => this.start();
    for (const b of document.querySelectorAll('#who [data-who]')) {
      b.onclick = e => { e.stopPropagation(); this.dress(b.dataset.who); };
    }
    this.bindTogether();
    this.bindChat();
    canvas.addEventListener('click', () => {
      if (this.cursorPanel) return;          // a panel owns the cursor
      if (!this.playing) this.start();
      else if (!this.input.locked) this.lockPointer();
    });

    document.getElementById('resetbtn').onclick = () => {
      // Must latch, or the beforeunload save writes the file straight back
      // during the reload and the wipe silently does nothing.
      this.wiped = true;
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    };

    // Losing the pointer lock mid-game (Esc) is a pause. Mouse look needs the
    // lock, but the loop does not: if a browser refuses it, the game still runs.
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.playing && !this.cursorPanel) {
        // A refused lock must not look like the player pressing Esc, and
        // neither must a panel deliberately releasing the pointer.
        if (!this.input.lockDenied) this.pause();
      }
    });
    document.addEventListener('pointerlockerror', () => this.onLockDenied());

    addEventListener('resize', () => {
      for (const c of [this.camera, this.eye]) {
        c.aspect = innerWidth / innerHeight;
        c.updateProjectionMatrix();
      }
      this.renderer.setSize(innerWidth, innerHeight);
    });

    addEventListener('beforeunload', () => this.save());
    // Closing the page, you have left the game, not dropped out of it.
    addEventListener('pagehide', () => this.net.goodbye());
  }

  /**
   * The splash screen's "Play together": a name, then host (a new room code
   * and an invite link) or join (a code, or opening someone's link). A link
   * with ?room= joins as soon as the page is up.
   */
  bindTogether() {
    const $ = id => document.getElementById(id);
    const box = $('together');
    if (!box) return;
    const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
    const name = $('mpName');
    name.value = store.get(NAME_KEY) || `Castaway ${Math.floor(Math.random() * 90 + 10)}`;
    const who = () => (name.value.trim() || 'Castaway').slice(0, 20);
    for (const el of box.querySelectorAll('input, button')) el.addEventListener('click', e => e.stopPropagation());
    // Renamed, you are renamed in the game you are in too, once you stop typing.
    let typing;
    name.oninput = () => {
      store.set(NAME_KEY, who());
      clearTimeout(typing);
      typing = setTimeout(() => this.net.rename(who()), 500);
    };
    const go = code => { store.set(NAME_KEY, who()); this.net.join(code, who(), this.character); };
    $('mpHost').onclick = () => go(newCode());
    $('mpJoin').onclick = () => {
      const c = cleanCode($('mpCode').value);
      if (c.length >= 4) go(c);
      else $('mpStatus').textContent = c ? 'That code is too short — a game code is 4 to 8 letters.' : 'Type the code of the game to join — the host has it.';
    };
    $('mpCode').addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') $('mpJoin').click(); });
    // Left is left: the invite link in the address bar must not take you back in on a reload.
    const unlink = () => {
      const u = new URL(location.href);
      if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u); }
    };
    $('mpLeave').onclick = () => { this.net.leave(); unlink(); };
    $('mpRejoin').onclick = () => { const c = this.net.lastRoom; if (c) go(c); };
    $('mpCopy').onclick = () => {
      navigator.clipboard?.writeText(this.net.invite).then(() => { $('mpCopy').textContent = 'Copied'; },
        () => { $('mpInvite').select?.(); });
      setTimeout(() => { $('mpCopy').textContent = 'Copy invite link'; }, 1600);
    };
    const refresh = () => {
      const n = this.net;
      box.classList.toggle('off', !n.available);
      box.classList.toggle('in', !!n.code && n.connected);
      // In a game, its code, big enough to read out to someone.
      if (n.code && n.connected) {
        $('mpStatus').innerHTML = `Room code <b class="roomcode"></b> — read it out, or send the link`;
        $('mpStatus').querySelector('.roomcode').textContent = n.code;
      } else $('mpStatus').textContent = n.status;
      const again = n.lastRoom;
      $('mpRejoin').hidden = !again || (!!n.code && !!n.ws);
      $('mpRejoin').textContent = again ? `Rejoin ${again}` : '';
      $('mpInvite').value = n.invite;
      const crew = n.crew(at => this.arrowTo(at));
      // On the splash too — the HUD's list is hidden while it is up.
      $('mpCrew').hidden = crew.length === 0;
      $('mpCrew').innerHTML = crew.length ? `<b>In ${n.code} · ${crew.length} castaway${crew.length === 1 ? "" : "s"}</b>` + crew.map(() => '<div></div>').join('') : '';
      [...$('mpCrew').querySelectorAll('div')].forEach((d, i) => { d.textContent = crew[i]; });
      $('crew').hidden = crew.length === 0;
      $('crew').innerHTML = crew.length ? `<b>${n.code}</b>` + crew.map(c => `<div></div>`).join('') : '';
      [...$('crew').querySelectorAll('div')].forEach((d, i) => { d.textContent = crew[i]; });
    };
    this.net.onChange = refresh;
    this.refreshCrew = refresh;          // and twice a second, for how far off everyone is
    refresh();
    // Opened from an invite link: straight in, if you have played before and
    // have a name. New, you are asked for one first — or everyone would meet
    // you as "Castaway 57", and then see you renamed.
    const code = cleanCode(new URLSearchParams(location.search).get('room'));
    if (code.length >= 4 && this.net.available) {
      $('mpCode').value = code;
      if (store.get(NAME_KEY)) go(code);
      else {
        $('mpStatus').textContent = `You are invited to ${code}. Type your name, then Join.`;
        name.select();
        setTimeout(() => name.focus(), 0);
      }
    }
    name.addEventListener('keydown', e => {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && cleanCode($('mpCode').value).length >= 4 && !this.net.code) $('mpJoin').click();
    });
  }

  /**
   * Playing together, Enter opens a line to say something in; Enter again
   * says it, Esc thinks better of it. While it is open the keys are the
   * line's, not the game's.
   */
  bindChat() {
    const box = document.getElementById('chatBox');
    if (!box) return;
    this.chatting = false;
    const close = () => {
      if (!this.chatting) return;
      this.chatting = false;
      box.value = '';
      box.blur();
      box.parentElement.hidden = true;
      this.hud.showChatHistory(false);
      this.input.enabled = true;
    };
    this.openChat = () => {
      if (this.chatting || !this.net.connected) return;
      this.chatting = true;
      this.input.held.clear();
      this.input.enabled = false;
      box.parentElement.hidden = false;
      this.hud.showChatHistory(true);
      // After this key's own keydown, or it types into the box.
      setTimeout(() => box.focus(), 0);
    };
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const text = box.value.trim();
        if (text && !this.net.chat(text)) return;      // too soon after the last: keep it
        close();
      } else if (e.code === 'Escape') close();
    });
    box.addEventListener('blur', close);
  }

  /** Play as the woman or the man. */
  dress(who) {
    this.character = who === 'man' ? 'man' : 'woman';
    for (const b of document.querySelectorAll('#who [data-who]')) b.classList.toggle('on', b.dataset.who === this.character);
    this.net.event({ k: 'who', who: this.character });
    this.body.wear(this.character, this.viewmodel.library).then(ok => {
      if (!ok && this.body.who === this.character) {
        this.hud.log(`No ${this.character}'s model in assets/models — a stand-in for now.`, 'bad');
      }
    });
  }

  /** V: first person, third, second, and round again. */
  cycleView() {
    this.view.cycle();
    this.hud.log(`${this.view.name} — V to change`);
  }

  start() {
    this.playing = true;
    this.hud.showSplash(false);
    this.lockPointer();
  }

  pause() {
    this.playing = false;
    document.body.classList.remove('freelook');
    this.hud.setPrompt(null);
    this.hud.showSplash(true);
    document.getElementById('go').textContent = 'Resume';
    document.exitPointerLock?.();
    this.save();
  }

  get paused() { return !this.playing; }

  /** True while a panel has taken the mouse cursor. */
  get cursorPanel() { return this.hud.craftOpen || this.hud.adminOpen || this.hud.packOpen; }

  // ── crafting & eating ──────────────────────────────────────────────────────
  /** Make `n` of a recipe — as many of them as there is the stuff for. */
  craft(id, n = 1) {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return;
    const item = ITEMS[r.out[0]];
    if (item.tool && this.inv.count(r.out[0]) > 0) { this.hud.log(`You already have a ${item.name.toLowerCase()}.`); return; }
    if (item.tool) n = 1;
    let made = 0;
    while (made < n && this.inv.pay(r.cost)) { this.inv.add(r.out[0], r.out[1]); made++; }
    if (!made) { this.hud.log('Not enough materials.', 'bad'); return; }
    const total = made * r.out[1];
    this.hud.log(`Crafted ${item.name}${total > 1 ? ` ×${total}` : ''}` +
                 (made < n ? ` — the materials ran out after ${made}.` : '.'), 'good');
    const slot = this.hotbar.autoAssign(r.out[0]);
    if (slot !== -1) this.hud.log(`${item.name} goes to slot ${slot + 1}.`);
    else if (item.pack) this.hud.log(`${item.name} works from your pack — it needs no slot.`);
    // Something to use, and no room for it in the slots: say where it went.
    else if (item.action && !this.hotbar.slots.includes(r.out[0])) {
      this.hud.log(`${item.name} is in your pack — the slots are full. Press I to put it in one.`);
    }
    this.hud.refreshInventory(this.inv);
    this.hud.refreshCraft(this.inv);
  }

  eat(id = 'coconut') {
    const food = foodOf(id);
    if (!food || !this.inv.remove(id, 1)) return;
    this.hotbar.refillFish(this.inv);
    this.player.hunger = THREE.MathUtils.clamp(this.player.hunger + food.hunger, 0, 100);
    this.player.thirst = THREE.MathUtils.clamp(this.player.thirst + food.thirst, 0, 100);
    this.hud.log(food.text, 'good');
    this.hud.refreshInventory(this.inv);
  }

  /**
   * Gather a piece of flotsam. Playing together, the host settles it (two
   * hooks on one crate get one crate): a guest in the host's sea asks, and is
   * handed what it gives — or told someone was quicker. Far off, in a sea of
   * your own, it is yours to take.
   */
  gather(it) {
    if (this.net.connected && !this.net.isHost && this.together.world.nearHost) {
      // Where it floats in the host's sea: a hooked piece has come your way only here.
      const i = this.debris.items.indexOf(it), [x, z] = it.hookedAt || [it.x, it.z];
      it.hookedAt = null;
      this.net.event({ k: 'claimgather', i, p: [Math.round(x * 10) / 10, Math.round(z * 10) / 10] }, this.net.host);
      this.debris.harvest(it);                   // gone here at once; what it gives comes from the host
      return;
    }
    const [x, z] = it.hookedAt || [it.x, it.z];
    it.took = { x, z, at: this.time, by: this.net.name };
    it.hookedAt = null;
    this.together.world.gathered(it);
    const { label, yield: y } = this.debris.harvest(it);
    const parts = [];
    for (const id in y) {
      this.inv.add(id, y[id]);
      parts.push(`${y[id]} ${ITEMS[id].name}`);
      this.hotbar.autoAssign(id);
    }
    this.hud.log(`${label}: ${parts.join(', ')}`, 'good');
    this.hud.refreshInventory(this.inv);
    this.hud.refreshCraft(this.inv);
  }

  /** A use of what is in hand, seen: the arm in first person, the body outside it. */
  useAnim(kind) {
    this.viewmodel.use(kind);
    // The axe going through the air, a moment into the swing.
    if (kind === 'chop') sound.swish(this.player.eyePos.addScaledVector(this.player.forward(), 0.5), CHOP_TIME * 0.34);
    const g = { spear: 'thrust', build: 'swing', eat: 'eat', hook: 'toss', paddle: 'paddle', chop: 'chop' }[kind];
    this.body.gesture(g);
    this.net.event({ k: 'g', g });                // the others see it too
  }

  /**
   * The line a throw is aimed along. In first person that is your eyes'. In
   * third it is the camera's — the crosshair is the centre of *its* view,
   * half a metre right of and three behind your head, and a throw along your
   * own line would land that far off it. In second person the camera is
   * looking at you, so it is your own line again.
   */
  aimRay(eye, dir) {
    if (this.view.mode !== 'third') return { from: eye, dir, extra: 0 };
    const cam = this.camera.position;
    return { from: cam, dir: this.camera.getWorldDirection(new THREE.Vector3()), extra: cam.distanceTo(eye) };
  }

  /** Left-click (and right-click for the hook) acts through the held item. */
  useHeld(eye, dir) {
    const id = this.hotbar.held;
    if (!id) return;
    if (!this.inv.has(id)) {
      this.hud.log(`No ${ITEMS[id].name} left.`, 'bad');
      return;
    }
    switch (ITEMS[id].action) {
      case 'hook':
        if (this.hook.busy) this.hook.release();
        else {
          this.useAnim('hook');
          this.hook.throwFrom(eye.clone().addScaledVector(dir, 0.5), dir.clone());
        }
        break;
      case 'eat':
        this.useAnim('eat');
        this.eat(id);
        break;
      // The thrust plays whether or not it lands; thrust() decides if it did.
      case 'spear':
        this.useAnim('spear');
        this.thrust(eye, dir);
        break;
      case 'rod':
        break;                         // the rod reads the button itself; see frame()
      case 'paddle':
        break;                         // held, not clicked: see frame()
      case 'place':
        this.placeStatue(eye, dir);
        break;
      case 'drill':
        // At a fire, the prompt says what there is to do; anywhere else, say where it works.
        if (!this.fireInView(eye, dir)) this.hud.log('Hold E (or click) at an unlit campfire to drill an ember.');
        break;
      case 'torch':
        this.clickTorch();
        break;
      case 'chop': {
        // At a tree (or anything else you could take): the same as E.
        const plant = this.terrain.pickPlant(eye, dir);
        if (plant?.sp.chop) this.chop(plant, dir);
        else if (plant) { this.useAnim('chop'); this.takePlant(plant); }
        else { this.useAnim('chop'); }
        break;
      }
      case 'strike':
        if (!this.fireInView(eye, dir)) this.hud.log('Look at an unlit campfire and press E to strike a spark into it. With the striker in your pack, a torch lights anywhere.');
        break;
      case 'build':
        break;                         // the hammer's click places a piece: build mode, in frame()
      default:
        if (!ITEMS[id].action) this.hud.log(`${ITEMS[id].name} is a material — nothing to do with it in hand. See crafting (C).`);
    }
  }

  /**
   * Right-click with a spear in hand. It leaves the inventory the moment it
   * leaves the hand — until you pull it back out of whatever it hit.
   */
  throwSpear(eye, dir) {
    if (!this.inv.has('spear')) {
      this.hud.log('No spear in hand — go and fetch the one you threw.', 'bad');
      return;
    }
    if (!this.viewmodel.canRelease('spear')) return;   // still being drawn
    if (this.pendingThrow != null) return;               // already winding up

    // Seen from outside, a throw is a throw: the arm cocks back over the
    // shoulder with the spear in it and whips forward, and the spear leaves
    // the hand at the release — THROW_RELEASE seconds in — not the instant
    // you click, from wherever the hand happened to be. In first person the
    // hand is the viewmodel's, and it lets go at once, as it always has.
    this.net.event({ k: 'g', g: 'throw' });
    if (!this.view.first) {
      this.body.gesture('throw');
      this.pendingThrow = THROW_RELEASE;
      return;
    }
    this.launchSpear(eye, dir);
  }

  /** The spear leaves the hand, aimed at what the crosshair is on. */
  launchSpear(eye, dir) {
    if (!this.inv.has('spear')) return;
    // Leave from the hand, but aim at what the crosshair is on. Throwing
    // parallel to the view from a hand up by your right ear would land
    // everything a foot to the right of where you looked.
    //
    // A fish under the crosshair is a target, and the throw converges on it —
    // on where it will be when the point arrives, not where it is now. A
    // silverside is a hand's width across and swims 1-2 m/s, which is half a
    // metre over a half-second throw; without the lead a dead-centre throw
    // misses behind it every time. This is soft aim assist, and deliberately
    // tight: the fish has to be within ~10 degrees of the crosshair.
    const submerged = this.player.submerged;
    // It leaves from the hand you can see: the first-person one, or the body's.
    const from = this.view.first ? this.viewmodel.gripWorld(new THREE.Vector3())
                                 : this.body.gripWorld(new THREE.Vector3());
    const aim = this.aimRay(eye, dir);
    const fish = this.fish.pick(aim.from, aim.dir, 30 + aim.extra, 0.985);
    let point;
    if (fish) {
      const t = travelTime(fish.pos.distanceTo(from), submerged);
      point = fish.pos.clone().addScaledVector(fish.vel, t);
    } else {
      point = aim.from.clone().addScaledVector(aim.dir, (submerged ? 6 : 25) + aim.extra);
    }
    const heading = point.sub(from).normalize();

    this.inv.remove('spear', 1);
    const thrown = this.spears.throw(from, heading, submerged, !fish);
    this.together.world.threw(thrown, from, heading, submerged, !fish);
    this.viewmodel.release();
    this.hud.refreshInventory(this.inv);
  }

  retrieveSpear(s) {
    this.together.world.tookBack(s);
    const { where, fish } = this.spears.take(s);
    this.inv.add('spear', 1);
    const how = { drifting: 'You catch the spear as it drifts up',
                  water: 'You fish the spear out of the water',
                  deck: 'You work the spear out of the deck',
                  seabed: 'You pull the spear out of the sand',
                  ground: 'You pull the spear out of the ground' };
    let text = how[where] || 'You take the spear back';
    if (fish.length) {
      for (const f of fish) this.addCatch(f.key);
      text += ` — ${this.describeCatch(fish)} on it`;
    }
    this.hud.log(`${text}.`, 'good');
    this.hud.refreshInventory(this.inv);
  }

  /**
   * Left-click with the spear: a thrust that skewers the fish on the
   * crosshair, if one is within THRUST_REACH — which is exactly where the
   * animation puts the point, so what you see is what you catch.
   */
  thrust(eye, dir) {
    const f = this.fish.pick(eye, dir, THRUST_REACH, 0.9);
    const octo = !f && this.reef.pick(eye, dir, THRUST_REACH, 'octopus');
    if (octo) {
      const body = this.reef.take(octo);
      this.viewmodel.skewer(body);
      if (!this.view.first) this.body.skewer(this.reef.bodyFor('octopus', 0.6));
      this.net.event({ k: 'caught', key: 'octopus' });   // on the spear they see you hold
      this.addCatch('octopus');
      this.hud.log('You spear an octopus. Its arms wrap the shaft.', 'good');
      this.hud.refreshInventory(this.inv);
      return;
    }
    if (!f) {
      // A miss still scares everything near the point.
      if (this.player.submerged) this.fish.startle(eye.clone().addScaledVector(dir, THRUST_REACH), 2.5, 0.05);
      this.hud.log('A thrust at nothing. Right-click to throw it.');
      return;
    }
    this.fish.take(f);
    this.viewmodel.skewer(this.fish.bodyFor(f));
    this.net.event({ k: 'caught', i: this.fish.fish.indexOf(f), key: f.sp.key });   // on the spear they see you hold
    if (!this.view.first) this.body.skewer(this.fish.bodyFor(f));   // on the spear you can see
    this.addCatch(f.sp.key);
    this.hud.log(`You spear a ${f.sp.name}.`, 'good');
    this.hud.refreshInventory(this.inv);
  }

  /**
   * A caught fish into the bag as its own species — a red snapper stays a red
   * snapper — and into the fish slot, so it is the one you hold next.
   */
  addCatch(key, n = 1) {
    const id = fishItem(key);
    if (!ITEMS[id]) return;
    this.inv.add(id, n);
    this.hotbar.takeFish(id);
  }

  /** The fish you would reach for: the one in hand, else the one you have most of. */
  anyFish() {
    const held = this.hotbar.held;
    if (fishOf(held) && this.inv.has(held)) return held;
    // Cooked before raw — it does more for you and costs no water.
    let best = null;
    const better = (id, n) => !best || isCooked(id) > isCooked(best) ||
      (isCooked(id) === isCooked(best) && n > this.inv.count(best));
    for (const [id, n] of this.inv.slots) if (fishOf(id) && n > 0 && better(id, n)) best = id;
    return best;
  }

  // ── the campfire ───────────────────────────────────────────────────────────
  /**
   * What a campfire offers, most pressing first: taking off fish that are
   * done; lighting it, with the bow drill in hand; cooking the raw fish in
   * hand; feeding it wood. `drill` marks the fire the bow drill is at, for
   * frame() to saw at while the button is down.
   */
  fireInteraction(o) {
    const held = this.hotbar.held;
    const cooking = o.spitFish.length ? ` — ${this.describeCatch(o.spitFish)} cooking` : '';
    const pct = Math.round(o.fuel / FIRE.max * 100);
    // Wood goes on with R whatever else E is doing here, while there is room for it.
    const wood = o.lit && this.inv.has('wood') && o.fuel <= FIRE.max - FIRE.perWood / 2
      ? { key: 'KeyR', act: () => this.feedFire(o) } : null;
    const orWood = wood ? ` · <b>R</b> add wood (${pct}%)` : '';
    const done = o.spitFish.filter(f => f.t >= FIRE.cook);
    if (done.length) {
      return { prompt: `<b>E</b> take ${this.describeCatch(done)} off the fire${orWood}`, act: () => this.takeCooked(o), alt: wood };
    }
    if (!o.lit) {
      if (o.fuel <= 0) {
        return this.inv.has('wood')
          ? { prompt: `<b>E</b> lay wood in the burnt-out fire${cooking}`, act: () => this.feedFire(o) }
          : { prompt: `Burnt out — it needs Wood before it will light again${cooking}`, act: null };
      }
      // The striker and the bow drill work from the pack: neither needs a slot.
      if (this.inv.has('striker')) {
        if (!this.inv.has('leaf')) return { prompt: 'You need 1 Palm fibre as tinder to catch the spark', act: null };
        return { prompt: '<b>E</b> strike a spark into the tinder (1 Palm fibre)', act: () => this.strikeFire(o) };
      }
      if (this.inv.has('bowdrill')) {
        if (!this.inv.has('leaf')) return { prompt: 'You need 1 Palm fibre as tinder to catch the ember', act: null };
        const p = this.drill?.rec === o ? this.drill.p : 0;
        const how = held === 'bowdrill' ? '<b>Hold E</b> or <b>hold click</b>' : '<b>Hold E</b>';
        return { prompt: p > 0 ? `Drilling an ember <span class="meter"><i style="width:${Math.round(p * 100)}%"></i></span>`
                               : `${how} to drill an ember with the bow drill (1 Palm fibre)`,
                 act: null, drill: o };
      }
      return { prompt: 'Unlit — craft a bow drill (C) to light it' + cooking, act: null };
    }
    if (held === 'torch' && this.inv.has('torch') && !this.torch.lit) {
      return { prompt: `<b>E</b> light your torch${cooking}${orWood}`, act: () => this.lightTorch('at the fire'), alt: wood };
    }
    // The fish in hand — or failing that, one from the pack.
    const inHand = fishOf(held) && !isCooked(held) && this.inv.has(held) ? held : null;
    const raw = inHand || this.anyRawFish();
    if (raw && o.spitFish.length < FIRE.spit) {
      return { prompt: `<b>E</b> cook ${inHand ? 'the' : 'a'} ${ITEMS[raw].name.toLowerCase()}${cooking}${orWood}`,
               act: () => this.cook(o, raw), alt: wood };
    }
    if (wood) return { prompt: `<b>E</b> add wood — burning, ${pct}%${cooking}`, act: wood.act };
    return { prompt: `Burning, ${pct}%${cooking}`, act: null };
  }

  /**
   * The bow drill is sawn, not clicked: the ember builds while E is held at
   * an unlit fire — or the button, with the drill in hand — and cools if you
   * stop. It works from the pack; it needs no slot.
   */
  sawDrill(act, dt, input) {
    const sawing = act?.drill && (input.down('KeyE') || (this.hotbar.held === 'bowdrill' && input.mouseDown(0)));
    if (sawing) {
      if (this.drill?.rec !== act.drill) this.drill = { rec: act.drill, p: 0 };
      this.drill.p += dt / FIRE.light;
      this.viewmodel.drilling = this.hotbar.held === 'bowdrill';
      if (this.drill.p >= 1) this.lightFire(act.drill);
    } else {
      this.viewmodel.drilling = false;
      if (this.drill && (this.drill.p -= dt * 0.35) <= 0) this.drill = null;
    }
  }

  anyRawFish() {
    for (const [id, n] of this.inv.slots) if (n > 0 && fishOf(id) && !isCooked(id)) return id;
    return null;
  }

  /** A spark from the striker catches in the tinder: lit at once, no sawing. */
  strikeFire(o) {
    if (!this.inv.remove('leaf', 1)) return;
    o.lit = true;
    this.together.touched(o);
    this.useAnim('eat');
    this.hud.log('Flint on iron: a shower of sparks, and the palm fibre catches. The fire is lit.', 'good');
    this.hud.refreshInventory(this.inv);
  }

  // ── the torch ──────────────────────────────────────────────────────────────
  /** Click with a torch in hand: light it, if there is the means. */
  clickTorch() {
    if (this.torch.lit) {
      this.hud.log(`Your torch is burning — about ${Math.ceil(this.torch.fuel / 60)} minute${this.torch.fuel > 60 ? 's' : ''} left in it.`);
      return;
    }
    if (this.player.state === 'swim') { this.hud.log('Not in the water — it would only go straight out.'); return; }
    if (this.inv.has('striker')) { this.lightTorch('with the striker'); return; }
    this.hud.log('Light it at a burning campfire (look at the fire, E) — or craft a fire striker from cave flint, to light it anywhere.');
  }

  lightTorch(how) {
    if (!this.inv.has('torch')) return;
    // A torch put away keeps what it had left; a spent one, a new torch.
    if (this.torch.fuel <= 0) this.torch.fuel = TORCH.burn;
    this.torch.lit = true;
    this.torch.embers = 0;
    this.torchLitOnce = true;
    this.useAnim('eat');
    this.hud.log(how === 'with the striker' ? 'Sparks from the striker, and the palm fibre flares: your torch is lit.'
                                            : 'You hold the torch in the flames until it catches.', 'good');
  }

  /** Once a frame: the torch burns down, goes out in the water, and gives its light. */
  updateTorch(dt, held) {
    const t = this.torch;
    // Put away, a lit torch is not out at once: it smoulders for a while, and
    // taken out again it blows back into flame — so a slot changed in a cave
    // (to eat, or for the axe) does not leave you in the dark for good.
    if (t.lit && held !== 'torch') {
      t.lit = false;
      t.embers = TORCH_EMBERS;
      this.hud.log('You tuck the torch away, smouldering. Take it out again soon and it will catch.');
    } else if (!t.lit && t.embers > 0) {
      if (this.player.state === 'swim') t.embers = 0;
      else if (held === 'torch' && this.inv.has('torch')) {
        t.lit = true; t.embers = 0;
        this.hud.log('You blow on the embers, and the torch flares up again.', 'good');
      } else if ((t.fuel -= dt) <= 0) {
        t.embers = t.fuel = 0;
        this.inv.remove('torch', 1);
        this.hud.log('The torch you put away has burned down to nothing.', 'bad');
        this.hud.refreshInventory(this.inv);
      } else if ((t.embers -= dt) <= 0) {
        t.embers = 0;
        this.hud.log('The torch you put away has gone out. It will need lighting again.', 'bad');
      }
    }
    if (t.lit && this.player.state === 'swim') {
      t.lit = false;
      this.hud.log('The water hisses over your torch, and it is out.', 'bad');
    }
    if (t.lit && (t.fuel -= dt) <= 0) {
      t.lit = false;
      t.fuel = 0;
      this.inv.remove('torch', 1);
      this.hud.log(this.inv.has('torch') ? 'Your torch burns down and gutters out. You have another.' : 'Your torch burns down and gutters out.', 'bad');
      this.hud.refreshInventory(this.inv);
      this.hud.refreshHotbar(this.hotbar, this.inv);
    }
    FLAME.uTime.value = this.time;
    const flicker = 0.82 + 0.1 * Math.sin(this.time * 17.3) * Math.sin(this.time * 7.1 + 1) + 0.08 * Math.sin(this.time * 31);
    // Where the flame is: up at your right hand, a little ahead.
    const mine = this.torchLights[0], p = this.player, yaw = p.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    mine.position.set(p.pos.x + fx * 0.45 + rx * 0.3, p.pos.y + 1.75, p.pos.z + fz * 0.45 + rz * 0.3);
    mine.intensity = t.lit ? TORCH_LIGHT * flicker : 0;
    this.viewmodel.glow.intensity = t.lit && this.view.first ? 1.6 * flicker : 0;
    // The others' torches, as many as there are lights for.
    let k = 1;
    for (const r of this.net.remotes?.values?.() || []) {
      if (k >= this.torchLights.length) break;
      if (r.held !== 'torch_lit' || !r.body?.visible) continue;
      this.torchLights[k].position.copy(r.body.gripPos).y += 0.45;
      this.torchLights[k++].intensity = TORCH_LIGHT * flicker;
    }
    for (; k < this.torchLights.length; k++) this.torchLights[k].intensity = 0;
  }

  /** Whether a campfire on the raft is under the crosshair, within reach. */
  fireInView(eye, dir) {
    this.ray.set(eye, dir);
    this.ray.far = 4.2;
    const hit = this.ray.intersectObjects(this.raft.pickables, false)[0];
    this.ray.far = Infinity;
    return hit?.object.userData.piece?.id === 'campfire';
  }

  /** A plant down, or picked: what it gives, into the pack. */
  takePlant(plant, how = null) {
    this.chops.delete(plant.key);
    const got = this.takeShared(plant, null, how);
    if (got) this.gain(got, how);
  }

  /**
   * A plant taken, cut down (falling `away`) or picked: gone for everyone.
   * Playing together, the host settles who had it (two of you at one tree get
   * one lot of wood): a guest's is gone at once here, and what it gives comes
   * from the host (claimPlant), so this gives nothing — or someone was
   * quicker. Otherwise, what it gives.
   */
  takeShared(plant, away = null, how = null) {
    const a = away ? [+away.x.toFixed(2), +away.z.toFixed(2)] : null;
    const got = this.terrain.harvest(plant);
    if (this.net.connected && !this.net.isHost) {
      this.plantClaims.set(plant.key, { how: how || got.label, wait: !!a && !!plant.sp.falls, y: undefined });
      this.net.event({ k: 'claimplant', key: plant.key, a, r: plant.sp.regrow, y: got.yield }, this.net.host);
      return null;
    }
    this.plantTakers.set(plant.key, this.net.name || 'Someone');
    this.together.world.plantTaken(plant.key, a, plant.sp.regrow);
    return got;
  }

  /** A guest's plant, settled: what it gave (the host said), once any tree it was is down. */
  settlePlant(key) {
    const c = this.plantClaims.get(key);
    if (!c || c.wait || c.y === undefined) return;
    this.plantClaims.delete(key);
    if (c.y) this.gain({ label: c.how, yield: c.y }, c.how);
    else this.hud.log(`${c.who || 'Someone else'} got to it first.`, 'bad');
  }

  /** Someone else took a plant: gone here too — and a tree, near enough, comes down where you can see it. */
  plantGone(key, a, regrow) {
    const p = this.terrain.takenElsewhere(key, regrow);
    this.chops.delete(key);
    if (!p || !p.sp.falls || !Array.isArray(a)) return;
    if (Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) > 300) return;
    const away = new THREE.Vector3(a[0], 0, a[1]);
    if (away.lengthSq() < 1e-6) return;
    this.fellTree(p, away.normalize());
  }

  /** Someone's axe at a tree: it shudders and the chips fly here too, and the stroke counts. */
  chopSeen(key, a) {
    const p = this.terrain.plantsByKey.get(key);
    if (!p || this.terrain.felled.has(key)) return;
    const c = this.chops.get(key) || { n: 0 };
    c.n++; c.at = this.time;
    this.chops.set(key, c);
    if (!Array.isArray(a) || Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) > 120) return;
    const away = new THREE.Vector3(a[0], 0, a[1]);
    if (away.lengthSq() < 1e-6) return;
    away.normalize();
    const bamboo = p.sp.name === 'bamboo';
    const bite = this.terrain.bitePoint(p, away);
    this.terrain.burst(bite, away, bamboo ? 'bamboo' : 'wood', 12);
    sound.chop(bite, { bamboo, last: false });
    this.terrain.shake(p, away);
  }

  /** A tree coming down, away from the axe: the creak, the rush, the crash, felt underfoot. `onDown` as it lands. */
  fellTree(plant, away, onDown = null) {
    const fell = this.terrain.topple(plant, away, f => {
      onDown?.(f);
      sound.crash(new THREE.Vector3(plant.x + away.x * f.H * 0.45, plant.y + 1, plant.z + away.z * f.H * 0.45), Math.min(1, f.H / 45));
      // Felt underfoot, if you are near.
      const d = Math.hypot(plant.x + away.x * f.H * 0.5 - this.player.pos.x, plant.z + away.z * f.H * 0.5 - this.player.pos.z);
      const k = Math.max(0, 1 - d / 40) * Math.min(1, f.H / 20);
      if (k > 0) this.quake = { t: 0, amp: 0.09 * k };
    });
    // As it goes: the creak of it giving way, then the rush of it coming down.
    const size = Math.min(1, fell.H / 45);
    sound.creak(new THREE.Vector3(plant.x, plant.y + 2, plant.z), fell.fall * 0.55);
    sound.fall(new THREE.Vector3(plant.x + away.x * fell.H * 0.35, plant.y + fell.H * 0.35, plant.z + away.z * fell.H * 0.35), fell.fall, size);
  }

  /** What a plant gave (terrain.harvest()), into the pack, and said. */
  gain({ label, yield: y }, how = null) {
    const parts = [];
    for (const id in y) {
      this.inv.add(id, y[id]);
      this.hotbar.autoAssign(id);
      parts.push(`${y[id]} ${ITEMS[id].name}`);
    }
    this.hud.log(`${how || label}: ${parts.join(', ')}`, 'good');
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
    this.hud.refreshCraft(this.inv);
  }

  /**
   * A stroke of the axe at a tree (or a log, a stump, bamboo): it shudders;
   * enough of them, and it is down — a standing one falls, away from you.
   */
  chop(plant, dir) {
    if (this.time - (this.lastChop ?? -9) < CHOP_TIME) return;     // one stroke at a time
    this.lastChop = this.time;
    this.useAnim('chop');
    // The blow lands when the blade does, a moment into the swing.
    this.pendingChop = { plant, dir: dir.clone(), at: this.time + CHOP_TIME * CHOP_HIT };
  }

  /** The axe bites: the tree shudders and the chips fly — or, the last stroke, down it comes. */
  landChop({ plant, dir }) {
    if (this.terrain.felled.has(plant.key)) return;               // gone meanwhile (a regrow timer, a reload)
    const away = new THREE.Vector3(plant.x - this.player.pos.x, 0, plant.z - this.player.pos.z);
    if (away.lengthSq() < 1e-6) away.set(dir.x, 0, dir.z);
    away.normalize();
    const bamboo = plant.sp.name === 'bamboo';
    const bite = this.terrain.bitePoint(plant, away);
    const c = this.chops.get(plant.key) || { n: 0 };
    c.n++; c.at = this.time;
    this.chops.set(plant.key, c);
    const last = c.n >= (plant.chop ?? plant.sp.chop);
    this.terrain.burst(bite, away, bamboo ? 'bamboo' : 'wood', last ? 26 : 12);
    sound.chop(bite, { bamboo, last });
    if (!last) {
      this.terrain.shake(plant, away);
      this.together.world.chopped(plant.key, [+away.x.toFixed(2), +away.z.toFixed(2)]);
      return;
    }
    const name = plant.sp.label.toLowerCase();
    this.chops.delete(plant.key);
    if (!plant.sp.falls) {
      const how = `You chop the ${name} up`, got = this.takeShared(plant, away, how);
      if (got) this.gain(got, how);
      return;
    }
    const how = `The ${name} comes down with a crash`, got = this.takeShared(plant, away, how);
    this.hud.log(`The ${name} creaks, and leans…`);
    this.fellTree(plant, away, () => {
      if (got) { this.gain(got, how); return; }
      const claim = this.plantClaims.get(plant.key);
      if (claim) { claim.wait = false; this.settlePlant(plant.key); }
    });
  }

  /** Chip a flint face off a cave wall. */
  chipFlint(f) {
    const n = this.caves.chip(f);
    this.together.world.chipped(f.key);
    this.inv.add('flint', n);
    this.hotbar.autoAssign('flint');
    this.useAnim('eat');
    this.hud.log(`You work ${n === 1 ? 'a nodule of flint' : 'two nodules of flint'} out of the rock.` +
                 (this.inv.count('flint') === n && !this.inv.has('striker') ? ' Struck on scrap iron, flint makes fire — see crafting (C).' : ''), 'good');
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
    this.hud.refreshCraft(this.inv);
  }

  /** The ember catches: the fire is lit, and the tinder is gone. */
  lightFire(o) {
    this.drill = null;
    if (!this.inv.remove('leaf', 1)) return;
    o.lit = true;
    this.together.touched(o);
    this.hud.log('The ember catches in the palm fibre. The fire is lit.', 'good');
    this.hud.refreshInventory(this.inv);
  }

  feedFire(o) {
    if (!this.inv.remove('wood', 1)) return;
    const was = o.fuel;
    o.fuel = Math.min(FIRE.max, o.fuel + FIRE.perWood);
    this.together.touched(o);
    this.hud.log(was <= 0 ? 'You lay fresh wood in the ashes. It will need lighting.' : 'You feed the fire.', 'good');
    this.hud.refreshInventory(this.inv);
  }

  /** A raw fish onto the spit, hung by the tail over the flames. */
  cook(o, id) {
    const sp = this.fish.species(fishOf(id));
    if (!sp || !this.inv.remove(id, 1)) return;
    this.hotbar.refillFish(this.inv);
    this.hang(o, id);
    this.layoutSpit(o);
    this.together.touched(o);
    this.hud.log(`You hang the ${sp.name} over the fire.`, 'good');
    this.hud.refreshInventory(this.inv);
  }

  /** A fish on a spit, `t` seconds cooked (layoutSpit() puts it in its place). */
  hang(o, id, t = 0) {
    const key = fishOf(id);
    const sp = this.fish.species(key);
    if (!sp) return;
    const mesh = this.fish.displayBody(key, Math.min(sp.big ? 0.4 : 0.34, sp.length[1]));
    if (mesh) {
      this.fish.lively.delete(mesh);
      mesh.rotation.set(Math.PI / 2, 0, 0);            // nose down, tail to the stick
      mesh.userData.raw = mesh.material.color.clone();
      o.obj.getObjectByName('spit').add(mesh);
    }
    const f = { raw: id, done: cookedItem(key), name: sp.name, t, mesh };
    o.spitFish.push(f);
    this.brown(f);
  }

  unhang(f) {
    if (!f.mesh) return;
    f.mesh.removeFromParent();
    f.mesh.geometry.dispose();
    f.mesh.material.dispose();
  }

  /** A fish browns as it cooks. */
  brown(f) {
    if (f.mesh) f.mesh.material.color.copy(f.mesh.userData.raw).lerp(
      f.mesh.userData.raw.clone().multiply(COOKED), f.t / FIRE.cook);
  }

  /** A spit's fish as someone else's raft has them: [[raw id, seconds cooked], …]. */
  setSpit(o, list) {
    const same = list.length === o.spitFish.length && list.every(([raw], i) => o.spitFish[i].raw === raw);
    if (same) {
      list.forEach(([, t], i) => { o.spitFish[i].t = Math.min(FIRE.cook, t); this.brown(o.spitFish[i]); });
      return;
    }
    for (const f of o.spitFish) this.unhang(f);
    o.spitFish = [];
    for (const [raw, t] of list) if (ITEMS[raw] && fishOf(raw)) this.hang(o, raw, Math.min(FIRE.cook, t));
    this.layoutSpit(o);
  }

  /** Every fish on every fire into the bag, cooked if done — before your raft is put by. */
  pocketSpit() {
    let n = 0;
    for (const o of this.rafts.list.flatMap(r => [...r.objs.values()])) {
      for (const f of o.spitFish || []) {
        const id = f.t >= FIRE.cook ? f.done : f.raw;
        this.inv.add(id, 1);
        this.hotbar.autoAssign(id);
        this.unhang(f);
        n++;
      }
      if (o.spitFish) o.spitFish = [];
    }
    if (n) {
      this.hud.log(`You take your fish off the fire and bring ${n === 1 ? 'it' : 'them'} with you.`, 'good');
      this.hud.refreshInventory(this.inv);
      this.hud.refreshHotbar(this.hotbar, this.inv);
    }
  }

  /** The fish on every fire gone, as a raft is cleared away. */
  clearSpits() {
    for (const r of this.rafts.list) for (const o of r.objs.values()) for (const f of o.spitFish || []) this.unhang(f);
  }

  /** Spread the fish along the stick, each hanging from it by the tail. */
  layoutSpit(o) {
    const n = o.spitFish.length;
    o.spitFish.forEach((f, i) => {
      if (!f.mesh) return;
      // Nose down, its body's -Z end (the tail) is the top: put that at the stick.
      const g = f.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      f.mesh.position.set((i - (n - 1) / 2) * 0.3, SPIT_Y + g.boundingBox.min.z * f.mesh.scale.z, 0);
    });
  }

  /**
   * Take the cooked fish off a fire: they are whoever takes them's, whoever
   * hung them. Playing together that is the host's to settle — two hands
   * reaching for one fish get one fish — so a guest asks, and the host hands
   * them over (or says someone was quicker).
   */
  takeCooked(o) {
    if (this.net.connected && !this.net.isHost) {
      this.net.event({ k: 'claimfish', ri: this.raft.id, cx: o.cx, cz: o.cz }, this.net.host);
      return;
    }
    this.settleCooked(this.raft, o, null);
  }

  /** Hosting, or alone: a fire's cooked fish to whoever took them off — `taker` (a Remote), or null for you. */
  settleCooked(raft, o, taker) {
    const done = o.spitFish.filter(f => f.t >= FIRE.cook);
    if (!done.length) {
      // (Who, if it was only just now: the other hand at the same fish.)
      const who = o.took && this.time - o.took.at < 5 ? o.took.by : null;
      if (taker) this.net.event({ k: 'grant', none: true, items: {}, note: `${who || 'Someone else'} took the fish off first.` }, taker.id);
      return;
    }
    o.took = { by: taker ? taker.name : this.net.name, at: this.time };
    o.spitFish = o.spitFish.filter(f => f.t < FIRE.cook);
    this.layoutSpit(o);
    for (const f of done) this.unhang(f);
    const what = this.describeCatch(done);
    if (taker) {
      const items = {};
      for (const f of done) items[f.done] = (items[f.done] || 0) + 1;
      this.net.event({ k: 'grant', items, note: `You take ${what} off the fire, cooked.` }, taker.id);
    } else {
      this.cookedOnce = true;
      for (const f of done) { this.inv.add(f.done, 1); this.hotbar.takeFish(f.done); }
      this.hud.log(`You take ${what} off the fire, cooked.`, 'good');
    }
    this.together.touched(o, raft);
    this.hud.refreshInventory(this.inv);
  }

  /** Fish on a lit fire cook, and brown as they do; a fire that is out holds them. */
  updateFires(dt) {
    for (const o of this.raft.objs.values()) {
      if (o.type !== 'campfire' || !o.lit) continue;
      // Burning low: said once, while there is still time to feed it — to
      // anyone close enough to do something about it.
      if (o.fuel > FIRE.perWood) o.lowSaid = false;
      else if (!o.lowSaid && o.fuel < FIRE.perWood / 2) {
        o.lowSaid = true;
        const at = this.raft.cellWorld(o.cx, o.cz);
        if (Math.hypot(at.x - this.player.pos.x, at.z - this.player.pos.z) < 60) {
          this.hud.log(`The campfire is burning low — under a minute left. ${this.inv.has('wood') ? 'Feed it wood: R at the fire.' : 'It needs wood.'}`, 'bad', 8000);
        }
      }
      // Done: said to whoever is by the fire — not to someone away up a hill.
      const by = () => { const at = this.raft.cellWorld(o.cx, o.cz); return Math.hypot(at.x - this.player.pos.x, at.z - this.player.pos.z) < 40; };
      for (const f of o.spitFish) {
        const was = f.t;
        f.t = Math.min(FIRE.cook, f.t + dt);
        this.brown(f);
        if (was < FIRE.cook && f.t >= FIRE.cook && by()) this.hud.log(`The ${f.name} is done — take it off the fire.`, 'good');
      }
    }
    for (const o of this.raft.wentOut.splice(0)) {
      this.hud.log(o.spitFish.length ? 'The campfire has burned out, with fish still on it. It needs wood.'
                                     : 'The campfire has burned out. It needs wood, and lighting again.', 'bad');
    }
  }

  /** A fish to bait the hook with: the smallest you have, the way you would. */
  baitFish() {
    for (const [key] of CATCHES) if (this.inv.has(fishItem(key))) return fishItem(key);
    return null;
  }

  /** "a blue tang", "2 chromis and a snapper" — for the log. */
  describeCatch(fish) {
    const counts = new Map();
    for (const f of fish) counts.set(f.name, (counts.get(f.name) || 0) + 1);
    const parts = [...counts].map(([name, n]) => (n === 1 ? `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}` : `${n} ${name}`));
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  }

  // ── coming to, and coming back ─────────────────────────────────────────────
  /** A new castaway: somewhere on the edge of the world (spawn.js), with whatever that start gives. */
  newStart(kind) {
    // A new castaway has nothing, whatever the last one carried.
    this.inv = new Inventory();
    this.build.inv = this.inv;
    this.hotbar = new Hotbar();
    Object.assign(this.player, { health: 100, hunger: 100, thirst: 100, breath: 100 });
    const st = this.origin = pickStart(kind);
    this.rafts.load([]);
    this.setRaft(this.rafts.make());
    const heading = Math.random() * Math.PI * 2;
    // On a beach there is no raft yet: its place is the water offshore,
    // where the flotsam will gather and a first foundation can go.
    const at = st.kind === 'shore' ? st.sea : st;
    this.raft.setPose([at.x, at.z, heading]);
    if (st.kind === 'raft') this.raft.startingRaft();
    else if (st.kind === 'debris') this.raft.place('foundation', { cx: 0, cz: 0, force: true });
    // Come to on a raft, it is where you come back to, wherever it goes.
    if (this.raft.size) { st.raft = this.raft.id; this.player.respawnOnRaft(); this.faceUpstream(); }
    // In the open sea, facing up the current too: the flotsam you are to gather is coming from there.
    else this.player.standAt(st.x, st.z, st.kind === 'sea' ? Math.atan2(CURRENT.x, CURRENT.y) : st.yaw);
    for (const line of WAKING[st.kind]) this.hud.log(line, '', 9000);
    // Statues stand here and there over the land: places to wake, if you die.
    this.statues.clear();
    for (const s of scatter()) this.statues.add(s);
    this.registered = null;
    // And the land as it grew: a new castaway finds none of the last one's stumps.
    this.terrain.clearFelled();
    this.caves.restoreChipped([]);
    this.chops.clear();
  }

  /**
   * The first look on waking aboard: up the current, where the flotsam comes
   * from, and from the back of the square you are on, looking a little down —
   * so the deck is in front of you and the first piece of wood is in view.
   */
  faceUpstream() {
    const p = this.player, r = this.raft;
    p.yaw = Math.atan2(CURRENT.x, CURRENT.y);           // forward (-sin, -cos) = -CURRENT
    p.pitch = -0.32;
    const bx = p.pos.x + CURRENT.x * 0.75, bz = p.pos.z + CURRENT.y * 0.75;
    if (r.solidAtWorld(bx, bz) && !r.objs.has(r.cellAtWorld(bx, bz).join(','))) {
      p.pos.x = bx; p.pos.z = bz; p.pos.y = r.deckY(bx, bz);
    }
  }

  /** The world you are in: null your own, else the code of the game you are a guest in. */
  get world() { return this.room || null; }

  /**
   * Your statue, if you have one and it is in this world: {s} for one on
   * land, {o} for one on the raft's deck.
   */
  myStatue() {
    const r = this.registered;
    if (!r || (r.world ?? null) !== this.world) return null;
    if (r.raft) {
      // On the deck of the raft it was registered on — not whichever you are on now.
      // (An older save said only `true`: the raft you are on, then.)
      const raft = typeof r.raft === 'string' ? this.rafts.byId(r.raft) : this.raft;
      const o = raft?.objs.get(`${r.cx},${r.cz}`);
      return o?.type === 'statue' ? { o, raft } : null;
    }
    const s = this.statues.find(r.id);
    return s ? { s } : null;
  }

  /** The garland on yours, wherever it is. */
  markMine() {
    const m = this.myStatue();
    this.statues.mark(m?.s?.id ?? null);
    for (const r of this.rafts.list) for (const o of r.objs.values()) {
      if (o.type === 'statue') o.obj.getObjectByName('garland').visible = o === m?.o;
    }
  }

  /** The fresh water a look lands on, within reach — or null. Only near a river or a lake. */
  freshLookedAt(eye, dir) {
    const p = this.player;
    if (!p.onLand || p.state === 'swim' || landAt(p.pos.x, p.pos.z).edge > 6) return null;
    const at = this._fresh ||= new THREE.Vector3();
    for (let t = 0.3; t <= 3.6; t += 0.15) {
      at.copy(eye).addScaledVector(dir, t);
      const w = freshWaterAt(at.x, at.z);
      if (w && at.y <= w.level + 0.02) return w;
      if (at.y < landHeight(at.x, at.z)) return null;       // the ground, before any water
    }
    return null;
  }

  drinkFresh(where) {
    const p = this.player;
    p.thirst = Math.min(100, p.thirst + 30);
    this.useAnim('eat');
    this.hud.log(p.thirst >= 100 ? `You drink your fill from ${where}.` : `You drink from ${where} — cold, and fresh.`, 'good');
    this.hud.updateVitals(p);
  }

  /**
   * A statue is a place to wake, nothing more — not something to collect.
   * The first one you come near with nowhere to wake yet says what it is for.
   */
  lookForStatues() {
    if (this.statueTip || this.myStatue() || !this.statues.near(this.player.pos, 8).length) return;
    this.statueTip = true;
    this.hud.log('A carved statue. E at it to make it where you wake if you die — rather than back where you first came to.');
  }

  /**
   * Dead: you wake beside your statue, if you registered at one and it
   * still stands; if not, where you first came to.
   */
  respawn(died = true) {
    this.died = died;
    // Playing together, the others hear of it.
    if (died && this.net.connected) this.net.event({ k: 'died' });
    const mine = this.myStatue();
    if (mine?.o) {
      // Aboard, beside it — wherever that raft has got to.
      this.setRaft(mine.raft);
      const o = mine.o, p = this.player;
      const at = this.raft.cellWorld(o.cx, o.cz);
      const side = this.raft.toWorld(o.cx * 2 + 0.7, o.cz * 2 + 0.5);
      p.pos.set(side.x, this.raft.deckY(side.x, side.z), side.z);
      p.state = 'deck'; p.onLand = false; p.vel.set(0, 0, 0); p.vy = 0;
      p.yaw = Math.atan2(-(side.x - at.x), -(side.z - at.z));
      this.deathSay('You black out, and wake on the deck beside your statue.', 'bad');
      return;
    }
    const s = mine?.s;
    if (s) {
      // In front of it, facing the way it faces.
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      this.player.standAt(s.x + fx * 1.4, s.z + fz * 1.4, s.yaw);
      this.deathSay('You black out, and wake beside your statue.', 'bad');
      return;
    }
    const st = this.origin || { x: 0, z: 0, yaw: 0 };
    // Come to on a raft or on wreckage, you wake on it — wherever it has got to.
    const home = st.raft && this.rafts.byId(st.raft);
    if (home?.size) {
      this.setRaft(home);
      if (this.net.connected) this.placeAmong(home);
      else this.player.respawnOnRaft();
      this.deathSay(this.registered ? 'You black out. Your statue is gone — you wake on the raft you came to on.'
                                   : 'You black out, and wake on the raft you came to on. A statue would bring you back elsewhere.', 'bad');
      return;
    }
    this.player.standAt(st.x, st.z, st.yaw);
    this.deathSay(this.registered ? 'You black out. Your statue is gone — you wake where you first came to.'
                                 : 'You black out, and wake where you first came to. A statue would bring you back nearer.', 'bad');
  }

  /** What dying says: in the log, and over the blackout. */
  deathSay(text, kind) {
    this.hud.log(text, kind, 9000);
    if (this.died) this.hud.blackout(text);
  }

  /** Set the statue in hand up on the raft's deck, or on the land, where you are looking. */
  placeStatue(eye, dir) {
    // On the deck: a square with nothing on it, close by.
    const t = this.raft.size ? this.raft.targetFromRay(eye, dir) : null;
    if (t && t.dist < 4.5 && this.raft.hasCell(t.cx, t.cz)) {
      if (this.raft.objs.has(`${t.cx},${t.cz}`)) { this.hud.log('Something already stands on that square.', 'bad'); return; }
      if (!this.inv.remove('statue', 1)) return;
      this.raft.place('statue', { cx: t.cx, cz: t.cz });
      this.together.placed('statue', { cx: t.cx, cz: t.cz });
      this.hud.log('You lash the statue to the deck. It sails with you — E at it to wake aboard.', 'good');
      this.hud.refreshInventory(this.inv);
      return;
    }
    const p = eye.clone(), step = dir.clone().multiplyScalar(0.25);
    let ground = null;
    for (let i = 0; i < 36; i++) {
      p.add(step);
      const h = this.terrain.clearanceAt(p.x, p.z);
      if (p.y <= Math.max(h, 0.2)) { ground = h > 0.3 ? p : null; break; }
    }
    if (!ground) { this.hud.log('Look at open ground on land to set it up.', 'bad'); return; }
    if (!this.statues.canStand(ground.x, ground.z)) { this.hud.log('Not there — it needs level ground, clear of other statues.', 'bad'); return; }
    if (!this.inv.remove('statue', 1)) return;
    // Facing you, as you set it down.
    const s = this.statues.add({ id: newStatueId(), x: ground.x, z: ground.z, yaw: this.player.yaw + Math.PI });
    this.together.world.statueUp(s);
    this.hud.log('You set up the statue. E at it to make it where you wake.', 'good');
    this.hud.refreshInventory(this.inv);
  }

  register(s) {
    this.registered = { id: s.id, world: this.world };
    this.setWake(s.id);
    this.markMine();
    this.hud.log('This statue is where you will wake, now, if you die.', 'good');
  }

  registerAboard(o) {
    this.registered = { raft: this.raft.id, cx: o.cx, cz: o.cz, world: this.world };
    this.setWake(this.deckKey(this.raft, o.cx, o.cz));
    this.markMine();
    this.hud.log('This statue is where you will wake, now — aboard, wherever the raft is.', 'good');
  }

  // ── a room's world: kept on the relay ──────────────────────────────────────
  /** The world as it stands, for the room to keep: the rafts, the statues, the time of day, what is cut and chipped. */
  worldJSON() {
    return { v: 1, rafts: this.rafts.toJSON(), statues: this.statues.toJSON(), sky: [+this.sky.time.toFixed(1), this.sky.day],
             wakers: this.wakersJSON(), felled: this.terrain.felledList(), chipped: this.caves.chippedList() };
  }

  /** You, in the room's world. */
  meJSON() {
    return { v: 1, character: this.character, inv: this.carried(false), hotbar: this.hotbar.toJSON(),
             player: this.player.toJSON(), start: this.origin, registered: this.registered,
             goals: [...this.goalsDone] };
  }

  /** To the relay: you, and (hosting) the world. */
  keepRoom() {
    if (!this.room || !this.net.connected) return;
    this.net.keepMe(this.meJSON());
    if (this.net.isHost) this.net.keep(this.worldJSON());
  }

  /**
   * In a room: its world (as kept, or — a new room, hosting — a fresh one),
   * and you in it (as you were, or new here, somewhere on the edge of it).
   * Your own world is saved first and waits at home.
   */
  enterRoom(code, { world = null, me = null } = {}, host = false) {
    if (this.room === code) return;          // back after a drop: still here
    this.save();
    this.clearSpits();
    this.room = code;
    // The trees you cut at home are standing in this world, and its own are down.
    this.terrain.clearFelled();
    this.caves.restoreChipped([]);
    this.chops.clear();
    this.plantClaims.clear();
    if (world) this.loadWorld(world);
    else if (host) this.freshWorld();
    else { this.rafts.load([]); this.raft = null; this.setRaft(this.rafts.make()); this.statues.clear(); }
    // What was said at home is not what is so here: a clean log for the room.
    this.hud.clearLog();
    if (me) this.loadMe(me);
    else this.newHere(host);
    this.refreshAll();
    if (me) this.hud.log(`You are back in ${code}'s world.`, 'good');
    if (host && !world) this.keepRoom();      // a new world, kept from the start
  }

  /** Out of the room: back home, to your own world as you left it. */
  leaveRoom() {
    if (!this.room) return;
    this.room = null;
    this.wakers = new Map();
    this.clearSpits();
    this.hud.clearLog();
    this.terrain.clearFelled();
    this.caves.restoreChipped([]);
    this.chops.clear();
    this.plantClaims.clear();
    if (!this.loadSave()) this.newStart();
    this.refreshAll();
    this.hud.log('You are back in your own world.');
  }

  /** A new room's world: no rafts yet, the statues scattered, morning of the first day. */
  freshWorld() {
    this.wakers = new Map();
    this.rafts.load([]);
    this.raft = null;
    this.setRaft(this.rafts.make());
    this.statues.clear();
    for (const s of scatter()) this.statues.add(s);
    this.sky.time = DAY_SECONDS * 0.42;
    this.sky.day = 1;
  }

  loadWorld(w) {
    this.rafts.load(w.rafts || []);
    this.raft = null;
    this.setRaft(this.rafts.list[0] || this.rafts.make());
    this.statues.load(w.statues);
    this.loadWakers(w.wakers);
    if (Array.isArray(w.sky)) [this.sky.time, this.sky.day] = w.sky;
    this.terrain.restoreFelled(Array.isArray(w.felled) ? w.felled : []);
    this.caves.restoreChipped(w.chipped);
  }

  /** You, as the room kept you: what you carry, how you are, and where — aboard your raft, wherever it has got to. */
  loadMe(me) {
    this.inv = Inventory.fromJSON(me.inv || {});
    this.build.inv = this.inv;
    this.hotbar = Hotbar.fromJSON(me.hotbar);
    this.player.load(me.player);
    this.origin = me.start || pickStart();
    this.registered = me.registered || null;
    for (const g of me.goals || []) this.goalsDone.add(g);
    if (me.character && me.character !== this.character) this.dress(me.character);
    const w = me.player || {};
    const raft = w.where === 'deck' && this.rafts.byId(w.raft);
    if (raft && Array.isArray(w.local)) {
      this.setRaft(raft);
      const at = raft.toWorld(w.local[0], w.local[1]);
      const p = this.player;
      p.pos.set(at.x, raft.deckY(at.x, at.z), at.z);
      p.state = 'deck'; p.onLand = false; p.vel.set(0, 0, 0); p.vy = 0;
      if (Number.isFinite(w.localYaw)) p.yaw = w.localYaw + raft.heading;
    } else if (w.where && w.where !== 'deck' && Array.isArray(w.pos)) this.player.standAt(w.pos[0], w.pos[2], w.yaw, w.pos[1]);
    else this.respawn(false);
    this.markMine();
  }

  /**
   * New to this world: nothing in your hands. Hosting a new one, you come to
   * on the crew's raft — four lashed pallets, a first deck for everyone. Joining,
   * you come to aboard the biggest raft there is, among the others rather than
   * a long swim from them; only a world with no raft at all puts you
   * somewhere on its edge. A raft or wreckage you come to on is the world's
   * from the start: the others hear of it.
   */
  newHere(host = false) {
    this.inv = new Inventory();
    this.build.inv = this.inv;
    this.hotbar = new Hotbar();
    Object.assign(this.player, { health: 100, hunger: 100, thirst: 100 });
    this.registered = null;
    const crew = !host && this.rafts.list.filter(r => r.size).sort((a, b) => b.size - a.size)[0];
    if (crew) {
      const at = crew.group.position;
      this.origin = { kind: 'raft', x: at.x, z: at.z, yaw: 0, raft: crew.id };
      this.setRaft(crew);
      this.placeAmong(crew);
      this.hud.log(`You come to aboard the crew's raft — ${crew.size} deck${crew.size === 1 ? '' : 's'} of it.`, 'good');
      this.hud.log('The others are about: the crew list, under the clock, says how far and which way.');
      return;
    }
    const st = this.origin = pickStart(host ? 'raft' : undefined);
    const heading = Math.random() * Math.PI * 2;
    // The empty raft you were given coming in will do; there is no need of two.
    const blank = () => (this.raft && !this.raft.size && this.rafts.list.includes(this.raft) ? this.raft : this.rafts.make());
    if (st.kind === 'raft' || st.kind === 'debris') {
      const r = blank();
      r.setPose([st.x, st.z, heading]);
      if (st.kind === 'raft') r.startingRaft();
      else r.place('foundation', { cx: 0, cz: 0, force: true });
      this.setRaft(r);
      st.raft = r.id;
      for (const c of r.cells.values()) this.together.placed('foundation', { cx: c.cx, cz: c.cz });
      this.player.respawnOnRaft();
    } else {
      // A raft of your own is not built yet: one to build, offshore.
      const at = st.kind === 'shore' ? st.sea : st;
      const r = blank();
      r.setPose([at.x, at.z, heading]);
      this.setRaft(r);
      this.player.standAt(st.x, st.z, st.yaw);
    }
    for (const line of WAKING[st.kind]) this.hud.log(line);
    if (host) this.hud.log('A new world, and the crew\'s raft in it: whoever joins comes to aboard.', 'good');
  }

  /**
   * Aboard a raft others are on too: a square of its own for each of you —
   * picked by your number in the room, so two who come to at once are not
   * one inside the other — facing in, toward the rest of the deck.
   */
  placeAmong(raft) {
    const open = [...raft.cells.values()].filter(c => !raft.objs.has(`${c.cx},${c.cz}`))
      .sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    if (!open.length) { this.player.respawnOnRaft(); return; }
    // A square nobody is standing on, if there is one.
    const taken = new Set([...this.net.remotes.values()].filter(r => r.snaps.length && r.body.visible)
      .map(r => raft.cellAtWorld(r.pose.pos.x, r.pose.pos.z).join(',')));
    const clear = open.filter(c => !taken.has(`${c.cx},${c.cz}`));
    const free = clear.length ? clear : open;
    const c = free[(this.net.id ?? 0) % free.length], p = this.player;
    const at = raft.cellWorld(c.cx, c.cz), mid = { x: 0, z: 0 };
    for (const k of raft.cells.values()) { const w = raft.cellWorld(k.cx, k.cz); mid.x += w.x / raft.size; mid.z += w.z / raft.size; }
    p.pos.set(at.x, raft.deckY(at.x, at.z), at.z);
    p.state = 'deck'; p.onLand = false; p.vel.set(0, 0, 0); p.vy = 0;
    if (Math.hypot(mid.x - at.x, mid.z - at.z) > 0.3) p.yaw = Math.atan2(-(mid.x - at.x), -(mid.z - at.z));
    p.pitch = -0.15;
  }

  // ── who is who, playing together ───────────────────────────────────────────
  deckKey(raft, cx, cz) { return `r:${raft.id}:${cx},${cz}`; }

  /** Who else (not you) wakes at this statue: a name, or null. */
  otherWaker(key) {
    const w = key && this.wakers.get(key);
    if (!w) return null;
    for (const [tag, name] of w) if (tag !== PUB) return name || 'Someone';
    return null;
  }

  unwake(key, tag) {
    const w = this.wakers.get(key);
    if (!w) return;
    w.delete(tag);
    if (!w.size) this.wakers.delete(key);
  }

  /** You wake at `key` now (or nowhere: null) — and the others hear of it. */
  setWake(key) {
    const prev = [...this.wakers].find(([, w]) => w.has(PUB))?.[0] ?? null;
    if (prev === key) return;
    if (prev) this.unwake(prev, PUB);
    if (key) { if (!this.wakers.has(key)) this.wakers.set(key, new Map()); this.wakers.get(key).set(PUB, this.net.name || ''); }
    if (this.net.connected) this.net.event({ k: 'wake', key, prev, name: this.net.name || '' });
  }

  wakersJSON() { return Object.fromEntries([...this.wakers].map(([k, w]) => [k, Object.fromEntries(w)])); }
  loadWakers(o) {
    this.wakers = new Map(Object.entries(o || {}).filter(([, w]) => w && typeof w === 'object')
      .map(([k, w]) => [k, new Map(Object.entries(w))]));
  }

  /**
   * Why this piece may not be taken apart, if it may not: a statue someone
   * else wakes at — or the square it stands on — stays. Anything else can
   * come off, and what it gives is whoever salvages it's, whoever built it.
   */
  salvageGuard(piece) {
    const r = this.raft;
    const at = piece.kind === 'cell' ? r.objs.get(`${piece.rec.cx},${piece.rec.cz}`) : piece.id === 'statue' ? piece.rec : null;
    if (at?.type !== 'statue') return null;
    const who = this.otherWaker(this.deckKey(r, at.cx, at.cz));
    return who ? `${who} wakes at the statue there — it stays.` : null;
  }

  refreshAll() {
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
    this.hud.refreshPack(this.inv, this.hotbar);
    this.hud.refreshCraft(this.inv);
    this.hud.updateVitals(this.player);
  }

  // ── the paddle ─────────────────────────────────────────────────────────────
  /** Point everything that works with "the raft" at this one. */
  setRaft(r) {
    if (!r || r === this.raft) return;
    this.raft = r;
    for (const s of [this.player, this.debris, this.fish, this.whale, this.view, this.spears, this.fishing, this.build, this.net]) {
      if (s) s.raft = r;
    }
    this.build.clearGhost();
    this.drill = null;
  }

  /** On the raft's deck (not ashore, not in the water). */
  onDeck() {
    const p = this.player;
    return p.state === 'deck' && !p.onLand && this.raft.solidAtWorld(p.pos.x, p.pos.z);
  }

  /**
   * One stroke of the paddle, from where you stand, the way you face: +1
   * forward, -1 back. Made at one side of the raft it turns it too.
   */
  paddleStroke(sign) {
    if (this.paddleIn > 0) return;
    if (!this.onDeck()) {
      this.paddleIn = 1.2;
      this.hud.log('Paddle from the deck of the raft.', 'bad');
      return;
    }
    this.paddleIn = 0.85;
    const p = this.player;
    const dir = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).multiplyScalar(sign);
    this.raft.paddle(p.pos, dir, 1);
    this.together.world.paddled(p.pos, dir);
    this.useAnim('paddle');
  }

  // ── the others ─────────────────────────────────────────────────────────────
  /** Another player under the crosshair, within `reach`. */
  crewAt(eye, dir, reach) {
    // Not through something nearer: a sail, a fire, a statue or a wall in front of them.
    this.ray.set(eye, dir);
    this.ray.far = reach;
    const hit = this.ray.intersectObjects(this.raft.pickables, false)
      .find(h => h.object.userData.piece?.kind === 'object' || h.object.userData.piece?.id === 'wall');
    this.ray.far = Infinity;
    let best = null, bestD = hit ? hit.distance : reach;
    const c = this._crewV ||= new THREE.Vector3();
    for (const r of this.net.remotes.values()) {
      if (!r.body.visible) continue;
      c.copy(r.pose.pos).y += r.pose.state === 'swim' ? 1.4 : 1.1;     // the chest (a swimmer's head)
      const along = c.clone().sub(eye).dot(dir);
      // Not someone standing in you (the same spot, a moment after waking): that is not who you look at.
      if (along < 0.45 || along > bestD) continue;
      const off = c.clone().sub(eye).addScaledVector(dir, -along).length();
      if (off < 0.55) { best = r; bestD = along; }
    }
    return best;
  }

  /**
   * Twice a second, playing together: someone coming aboard the raft you are
   * on is said. Off it yourself, who is aboard is not known — not "no one":
   * that had you, climbing back on (or waking there), told everyone already
   * standing on it had just climbed aboard.
   */
  watchCrew() {
    if (!this.onDeck()) { for (const r of this.net.remotes.values()) r.aboard = null; return; }
    for (const r of this.net.remotes.values()) {
      // Not yet placed (just joined, or back after a dropped connection): no telling yet.
      if (!r.snaps.length || !r.body.visible) continue;
      const p = r.pose, on = p.state === 'deck' && !p.onLand && this.raft.solidAtWorld(p.pos.x, p.pos.z);
      if (on && r.aboard === false) this.hud.log(`${r.name} climbs aboard.`);
      r.aboard = on;
    }
  }

  /** Warned that something is hunting you — the first time, and again if it has been a while. */
  sayHunted(label) {
    if (this.time - (this.huntedSaid ?? -1e9) <= 180) return;
    this.huntedSaid = this.time;
    this.hud.log(`A ${label.toLowerCase()} is coming for you. You cannot fight it: sprint (Shift) for the water, or into a cave — it will not follow.`, 'bad', 9000);
  }

  /**
   * Hosting: the dinosaurs are yours to run, so what they hunt only you know.
   * Someone else they have turned on is told — once a hunt — so they get the
   * same warning you would.
   */
  tellHunted() {
    if (!this.net.connected || !this.net.isHost) return;
    for (const a of this.wildlife.all) {
      const who = a.state === 'hunt' && !a.dead ? a.prey?.remote : undefined;
      if (who !== undefined && a.told !== who) this.net.event({ k: 'hunted', label: a.sp.label }, who);
      a.told = who;
    }
  }

  /** The pack, open to hand things to `mate` (E at them, empty-handed). */
  openGive(mate) {
    this.giveMate = { id: mate.id, name: mate.name };
    if (this.hud.packOpen) this.hud.closePack();
    this.hud.togglePack(this.inv, this.hotbar, mate.name);
    this.hud.closeCraft(); this.hud.closeAdmin();
    this.input.allowLook = false;
    document.exitPointerLock?.();
  }

  /** Hand `n` of what you carry to `mate` — as many as you have, up to that. */
  give(mate, id, n = 1) {
    if (!this.net.connected) return;
    n = Math.min(n, this.inv.count(id));
    if (n < 1 || !this.inv.remove(id, n)) return;
    this.net.event({ k: 'give', id, n }, mate.id);
    if (fishOf(id)) this.hotbar.refillFish(this.inv);
    this.body.gesture('toss');                    // handed over, underarm
    this.net.event({ k: 'g', g: 'toss' });
    this.hud.log(`You give ${mate.name} ${n} ${ITEMS[id].name}.`, 'good');
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
  }

  /** Something the others did that is yours to deal with (net.js onEvent). */
  fromCrew(e, r) {
    if (e.k === 'hunted' && typeof e.label === 'string') {
      this.sayHunted(e.label.slice(0, 24));
      return true;
    }
    if (e.k === 'died') {
      this.hud.log(`${r.name} blacks out — and comes round again, where they wake.`, 'bad');
      return true;
    }
    if (e.k === 'give') {
      if (!ITEMS[e.id]) return true;
      const n = Math.max(1, Math.min(99, Math.floor(e.n) || 1));
      this.inv.add(e.id, n);
      this.hotbar.autoAssign(e.id);
      this.hud.log(`${r.name} gives you ${n} ${ITEMS[e.id].name}.`, 'good');
      this.hud.refreshInventory(this.inv);
      this.hud.refreshHotbar(this.hotbar, this.inv);
      this.hud.refreshCraft(this.inv);
      return true;
    }
    if (e.k === 'landed' && typeof e.key === 'string') {
      const sp = this.fish.species(e.key);
      if (sp) this.hud.log(`${r.name} lands a ${sp.name}.`);
      return true;
    }
    if (e.k === 'caught') {
      if (r.body.heldId !== 'spear') return true;
      // A fish of the shared schools, by which; an octopus (each of you has your own), by kind.
      if (e.key === 'octopus') { r.body.skewer(this.reef.bodyFor('octopus', 0.6)); return true; }
      // (In a sea of their own, the fish in that slot here may be some other kind: then one of theirs.)
      const f = this.fish.fish[e.i], sp = e.key && this.fish.species(e.key);
      if (f && (!e.key || f.sp.key === e.key)) r.body.skewer(this.fish.bodyFor(f));
      else if (sp) r.body.skewer(this.fish.displayBody(e.key, (sp.length[0] + sp.length[1]) / 2));
      return true;
    }
    // Handed things (what you gathered, fish off a fire, a piece of yours
    // someone took apart) — or your materials back, for a piece someone
    // else built on that spot first.
    if (e.k === 'grant' || e.k === 'refund') {
      const items = e.k === 'refund' ? e.cost : e.items;
      // Paid back for a piece that did not go: the host's next copy of the rafts is the right one.
      if (e.k === 'refund') this.together.edited = -Infinity;
      for (const [id, n] of Object.entries(items || {})) {
        if (!ITEMS[id] || !(n > 0)) continue;
        this.inv.add(id, Math.min(40, n | 0));
        if (fishOf(id)) this.hotbar.takeFish(id); else this.hotbar.autoAssign(id);
      }
      const note = e.k === 'refund' ? `Someone built there first — your materials for the ${String(e.name || 'piece').toLowerCase()} are back.`
                                    : String(e.note || '').slice(0, 160);
      if (note) this.hud.log(note, e.none ? 'bad' : 'good');
      this.hud.refreshInventory(this.inv);
      this.hud.refreshHotbar(this.hotbar, this.inv);
      this.hud.refreshCraft(this.inv);
      return true;
    }
    if (e.k === 'claimfish') {
      if (!this.net.isHost) return true;
      const raft = this.rafts.byId(e.ri);
      const o = raft?.objs.get(`${e.cx},${e.cz}`);
      if (o?.type === 'campfire') this.settleCooked(raft, o, r);
      return true;
    }
    // A guest took a plant: theirs, if nobody had it first — it is gone for
    // everyone, and what it gives (the guest's own count) goes to them.
    if (e.k === 'claimplant') {
      if (!this.net.isHost || typeof e.key !== 'string') return true;
      if (this.terrain.felled.has(e.key)) {
        this.net.event({ k: 'plantno', key: e.key, who: this.plantTakers.get(e.key) || null }, r.id);
        return true;
      }
      if (this.plantTakers.size > 400) this.plantTakers.clear();
      this.plantTakers.set(e.key, r.name);
      this.plantGone(e.key, e.a, e.r);
      this.together.world.plantTaken(e.key, e.a, e.r);
      const y = {};
      for (const [id, n] of Object.entries(e.y || {})) if (ITEMS[id] && n > 0) y[id] = Math.min(20, n | 0);
      this.net.event({ k: 'plantok', key: e.key, y }, r.id);
      return true;
    }
    if (e.k === 'plantok' || e.k === 'plantno') {
      const c = this.plantClaims.get(e.key);
      if (!c) return true;
      c.y = e.k === 'plantok' && e.y && typeof e.y === 'object' ? e.y : null;
      if (e.k === 'plantno') { c.who = typeof e.who === 'string' ? e.who.slice(0, 20) : null; c.wait = false; }
      this.settlePlant(e.key);
      return true;
    }
    if (e.k === 'claimgather') {
      if (!this.net.isHost) return true;
      const it = this.debris.items[e.i];
      const at = (x, z) => Array.isArray(e.p) && Math.hypot(x - e.p[0], z - e.p[1]) < 6;
      // Taken there a moment ago: the slot floats in somewhere else now, but it was that piece.
      const gone = it?.took && this.time - it.took.at < 2 && at(it.took.x, it.took.z);
      if (!it || it.held || gone || !at(it.x, it.z)) {
        this.net.event({ k: 'grant', none: true, items: {}, note: `${(gone && it.took.by) || 'Someone else'} got to it first.` }, r.id);
        return true;
      }
      it.took = { x: e.p[0], z: e.p[1], at: this.time, by: r.name };
      this.together.world.gathered(it);
      const { label, yield: y } = this.debris.harvest(it);
      this.net.event({ k: 'grant', items: y, note: `${label}: ${Object.entries(y).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ')}` }, r.id);
      return true;
    }
    if (e.k === 'wake') {
      if (!r.pub) return true;
      if (typeof e.prev === 'string') this.unwake(e.prev, r.pub);
      if (typeof e.key === 'string') {
        if (!this.wakers.has(e.key)) this.wakers.set(e.key, new Map());
        this.wakers.get(e.key).set(r.pub, String(e.name || r.name || '').slice(0, 20));
      }
      return true;
    }
    return false;
  }

  /** Where the end of your line is, if one is out: the rod's float, or the hook. [x, y, z, kind] */
  lineOut() {
    const f = this.fishing.float;
    if (f.visible) {
      // A fish on it: that too, for the others to see it fight (net.js drawCatch).
      const c = this.fishing.catch, m = c?.mesh;
      if (m?.parent) {
        return [f.position.x, f.position.y, f.position.z, 0, c.key, c.length,
                m.position.x, m.position.y, m.position.z, m.rotation.x, m.rotation.y, m.rotation.z];
      }
      return [f.position.x, f.position.y, f.position.z, 0];
    }
    const h = this.hook;
    if (h.state !== 'idle' && h.head.visible) return [h.head.position.x, h.head.position.y, h.head.position.z, 1];
    return null;
  }

  // ── what is under the crosshair ────────────────────────────────────────────
  /** @returns {{prompt:string, act:Function}|null} */
  findInteraction(eye, dir) {
    const reach = this.player.state === 'swim' ? 4.2 : 3.6;
    // Someone else, close enough to hand something to.
    // Not with the hammer out: E there is for the fire and the flotsam, and a
    // press meant for them must not hand your hammer to whoever is in the way.
    const mate = !this.build.active && this.crewAt(eye, dir, 3.2);
    if (mate) {
      const id = this.hotbar.held;
      const five = () => this.input.down('ShiftLeft') || this.input.down('ShiftRight');
      if (id && this.inv.has(id)) {
        const more = !ITEMS[id].tool && this.inv.count(id) > 1 ? ' (<b>Shift+E</b> five)' : '';
        return { prompt: `<b>E</b> give ${ITEMS[id].name.toLowerCase()} to ${mate.name}${more}`,
                 act: () => this.give(mate, id, five() ? 5 : 1) };
      }
      return { prompt: `<b>E</b> give ${mate.name} something from your pack`, act: () => this.openGive(mate) };
    }
    const spear = this.spears.pick(eye, dir, reach);
    if (spear) {
      return { prompt: '<b>E</b> take your spear', act: () => this.retrieveSpear(spear) };
    }
    // A crab, near enough to grab — on the beach or on the reef.
    const crab = this.reef.pick(eye, dir, this.player.state === 'swim' ? 2.2 : 2.6, 'crab');
    if (crab) {
      return { prompt: '<b>E</b> grab the crab', act: () => {
        this.reef.take(crab);
        this.addCatch('crab');
        this.useAnim('eat');
        this.hud.log('You grab the crab from behind, clear of its claws.', 'good');
        this.hud.refreshInventory(this.inv);
      } };
    }
    const it = this.debris.pick(eye, dir, reach);
    if (it) {
      return { prompt: `<b>E</b> gather ${DEBRIS_KINDS[it.kind].label}`, act: () => this.gather(it) };
    }
    this.ray.set(eye, dir);
    this.ray.far = 4.2;
    const hits = this.ray.intersectObjects(this.raft.pickables, false);
    this.ray.far = Infinity;
    const piece = hits[0]?.object.userData.piece;
    if (piece?.id === 'statue') {
      const mine = this.myStatue()?.o === piece.rec;
      const keeper = this.otherWaker(this.deckKey(this.raft, piece.rec.cx, piece.rec.cz));
      const lift = keeper ? ` · ${keeper} wakes here${mine ? ' too' : ''}` : ' · <b>X</b> lift it';
      return { prompt: mine ? `Your statue — you wake here, aboard${lift}` : `<b>E</b> make this where you wake${lift}`,
               act: mine ? null : () => this.registerAboard(piece.rec) };
    }
    const statue = this.statues.pick(eye, dir);
    if (statue) {
      const mine = this.myStatue()?.s === statue;
      const keeper = this.otherWaker(statue.id);
      const lift = keeper ? ` · ${keeper} wakes here${mine ? ' too' : ''}` : ' · <b>X</b> lift it';
      return { prompt: mine ? `Your statue — where you wake${lift}` : `<b>E</b> make this where you wake${lift}`,
               act: mine ? null : () => this.register(statue) };
    }
    if (piece?.id === 'collector') {
      const c = piece.rec;
      if (c.water >= 1) {
        return {
          prompt: `<b>E</b> drink (${Math.floor(c.water)} left)`,
          act: () => {
            c.water -= 1;
            this.raft.refreshCollector(c);
            this.together.touched(c);
            this.player.thirst = Math.min(100, this.player.thirst + 32);
            this.hud.log('Cool rainwater. That buys you time.', 'good');
          },
        };
      }
      return { prompt: `Collector is filling (${Math.round(c.water / c.capacity * 100)}%)`, act: null };
    }
    if (piece?.id === 'campfire') return this.fireInteraction(piece.rec);
    if (piece?.id === 'sail') {
      const o = piece.rec;
      return {
        prompt: o.raised ? '<b>E</b> lower the sail' : '<b>E</b> raise the sail — the wind will take the raft',
        act: () => {
          o.raised = !o.raised;
          this.together.touched(o);
          this.hud.log(o.raised ? 'The sail fills. The raft starts to move with the wind — paddle to steer.'
                                : 'You furl the sail.', 'good');
        },
      };
    }

    // In a cave: flint in the walls to chip out, and the spring to drink from.
    if (this.player.cave) {
      const flint = this.caves.pickFlint(eye, dir);
      if (flint) return { prompt: '<b>E</b> chip out the flint', act: () => this.chipFlint(flint) };
      if (this.caves.pickSpring(eye, dir)) return { prompt: '<b>E</b> drink from the spring', act: () => this.drinkFresh('the spring') };
    }

    // Fresh water under the crosshair — a river, a lake, the pool under a
    // fall: drink. (The sea is salt: that is what the collector is for.)
    const fresh = this.freshLookedAt(eye, dir);
    if (fresh) {
      const where = { river: 'the river', lake: 'the lake', tarn: 'the lake', pool: 'the pool' }[fresh.kind];
      return { prompt: `<b>E</b> drink from ${where}`, act: () => this.drinkFresh(where) };
    }

    const plant = this.terrain.pickPlant(eye, dir);
    if (plant) {
      // A tree, a log, a stump, bamboo: that takes an axe. Branches and
      // fronds come away in your hands.
      if (plant.sp.chop) {
        const name = plant.sp.label.toLowerCase();
        if (this.hotbar.held === 'axe' && this.inv.has('axe')) {
          const done = this.chops.get(plant.key)?.n ?? 0;
          return { prompt: `<b>Click</b> or <b>E</b>: chop the ${name}${done ? ` — ${done} of ${plant.chop ?? plant.sp.chop}` : ''}`,
                   act: () => this.chop(plant, dir) };
        }
        return { prompt: this.inv.has('axe') ? `Take out the axe to chop the ${name}`
                                             : `The ${name} is too big to break by hand — it needs an axe (craft one: C)`, act: null };
      }
      const what = plant.sp.label.toLowerCase();
      const verb = plant.sp.name === 'deadfall' ? `gather the ${what}` : plant.sp.yield?.leaf ? `strip the fronds from the ${what}` : `take the ${what}`;
      return { prompt: `<b>E</b> ${verb}`, act: () => this.takePlant(plant) };
    }

    const beast = this.wildlife.pick(eye, dir);
    if (beast) {
      const hunting = beast.state === 'hunt';
      const fleeing = beast.state === 'flee';
      return {
        prompt: beast.sp.diet === 'meat'
          ? `${beast.sp.label} — ${hunting ? (beast.prey === 'player' ? 'it has your scent. Get to the water, or into a cave!' : 'on the hunt') : 'prowling'}`
          : `${beast.sp.label} — ${fleeing ? 'it is running from something'
                                 : beast.state === 'defend' ? 'standing its ground, tail to a hunter'
                                 : beast.state === 'rest' ? 'resting' : beast.speed > 0.2 ? 'on the move' : 'grazing'}`,
        act: null,
      };
    }

    // A fish under the crosshair: say what would actually catch it from here.
    // The two reaches are the thrust's (the shaft ahead of the hand) and the
    // throw's (how far a spear stays fast enough to skewer) — offering a thrust at
    // a fish two metres out of reach is worse than saying nothing.
    const armed = this.hotbar.held === 'spear' && this.inv.has('spear');
    const octo = this.reef.pick(eye, dir, this.player.submerged ? 3.7 : 9, 'octopus');
    if (armed) {
      if (this.fish.pick(eye, dir, THRUST_REACH, 0.9) || this.reef.pick(eye, dir, THRUST_REACH, 'octopus')) {
        return { prompt: '<b>Click</b> to thrust', act: null };
      }
      if (this.fish.pick(eye, dir, this.player.submerged ? 3.7 : 9, 0.985) || octo) {
        return { prompt: '<b>Right-click</b> to throw', act: null };
      }
    } else if (octo && octo.pos.distanceTo(eye) < 3.5) {
      return { prompt: 'An octopus — it would take a spear', act: null };
    } else if (this.fish.pick(eye, dir, 3.0)) {
      return { prompt: 'Too quick to catch by hand — you need a spear', act: null };
    }
    // Nothing that size goes on a spear. Said once you are near enough to see
    // how big it is, so a shark passing does not look like a missed target —
    // and only in the water with it, not through the deck at the mahi-mahi
    // circling under the raft.
    const big = this.player.submerged && this.fish.pick(eye, dir, 9, 0.97, true);
    if (big) {
      return { prompt: big.sp.catchable === false
        ? 'Far too big to catch — give it room'
        : 'Far too big for a spear — that is one for a baited line', act: null };
    }
    return null;
  }

  // ── frame ──────────────────────────────────────────────────────────────────
  /**
   * Each frame the browser draws. Alone, a slow one is a step of no more than
   * a twentieth of a second — a slow machine plays slower. Playing together
   * the time is everyone's (a host's world is the others' too, and they carry
   * its animals on in real time), so a slow frame is made up, in steps no
   * bigger than that, only the last of them drawn.
   */
  tick() {
    const total = Math.min(this.clock.getDelta(), this.net.connected ? 0.25 : 0.05);
    const n = Math.max(1, Math.ceil(total / 0.05 - 1e-6));
    for (let i = 1; i < n; i++) this.frame(total / n, false);
    this.frame(total / n);
  }

  frame(step = null, draw = true) {
    const dt = step ?? Math.min(this.clock.getDelta(), 0.05);
    const drawn = draw && !document.hidden;   // hidden, the world goes on (keepTicking) but nothing is drawn
    const input = this.input;
    const now = performance.now();

    if (this.paused) {
      // Paused, you stand still, but the others go on: they are still drawn,
      // and a host still keeps the shared raft in step.
      // Playing together, the sea's clock keeps going, paused or not, so
      // the others' seas are not held back by yours.
      if (this.net.connected) {
        this.time = this.net.seaTime(this.time + dt, dt);
        this.worldTick(dt);
      }
      this.net.update(dt, this.player, this.body.heldId, this.time, this.lineOut(), this.camera.position);
      this.together.update(dt);
      if (drawn) this.renderer.render(this.scene, this.camera);
      input.endFrame();
      return;
    }

    // Playing together, everyone's sea keeps one time (net.js).
    this.time = this.net.seaTime(this.time + dt, dt);
    // The craft panel takes the cursor and the view; the admin panel takes the
    // cursor but leaves you free to look at the sky you are changing.
    const panelOpen = this.cursorPanel;
    const canLook = !this.hud.craftOpen && !this.hud.packOpen;

    // Look — the same raw deltas locked or not, plus edges and arrow keys.
    if (canLook) {
      if (input.mouseDX || input.mouseDY) {
        this.player.look(input.mouseDX, input.mouseDY, input.sensitivity);
      }
      // Without pointer lock the cursor runs out of window; hold it against an
      // edge to keep turning.
      const edge = input.edgeLook(dt);
      if (edge) this.player.turn(edge[0], edge[1]);
      const arrows = input.arrowLook(dt);
      if (arrows) this.player.turn(arrows[0], arrows[1]);
    }

    // Panels
    if (input.pressed('KeyC')) {
      const open = this.hud.toggleCraft(this.inv);
      input.allowLook = !open;
      if (open) { document.exitPointerLock?.(); this.build.toggle(false); this.hud.closeAdmin(); }
      else this.lockPointer();
    }

    if (input.pressed('KeyI')) {
      const open = this.hud.togglePack(this.inv, this.hotbar);
      input.allowLook = !open;
      if (open) { this.hud.closeCraft(); this.hud.closeAdmin(); document.exitPointerLock?.(); }
      else this.lockPointer();
    }
    // Esc closes an open panel; with none open it pauses — also in free look,
    // where there is no pointer lock for the browser to let go of (and pause on).
    if (input.pressed('Escape') && !this.chatting) {
      if (this.hud.craftOpen || this.hud.packOpen || this.hud.adminOpen) {
        this.hud.closeCraft(); this.hud.closePack(); this.hud.closeAdmin();
        input.allowLook = true;
        this.lockPointer();
      } else { this.pause(); input.endFrame(); return; }
    }
    if (this.hud.packOpen && input.pressed('Backspace')) {
      if (this.hotbar.clear(this.hotbar.selected)) {
        this.hud.log(`Slot ${this.hotbar.selected + 1} emptied.`);
      }
    }

    // Admin panel, local dev only.
    if (this.admin && input.pressed('Backquote')) {
      const open = this.hud.toggleAdmin(this.sky);
      if (open) {
        this.hud.closeCraft();
        this.build.toggle(false);
        document.exitPointerLock?.();
        input.allowLook = true;       // free look still works over the world
      } else {
        this.lockPointer();
      }
    }
    if (this.admin && this.hud.adminOpen) {
      if (input.pressed('KeyM')) this.hud.onAdminTime(720, true);
      if (input.pressed('KeyN')) this.hud.onAdminTime(0, true);
      if (input.pressed('KeyT')) this.hud.onAdminHold(!this.sky.held);
      if (input.pressed('BracketLeft')) this.hud.onAdminTime(this.sky.minutes - 60);
      if (input.pressed('BracketRight')) this.hud.onAdminTime(this.sky.minutes + 60);
      if (input.pressed('KeyR')) this.hud.onAdminRestore();
      if (input.pressed('KeyG')) this.hud.onAdminGive('materials');
      if (input.pressed('KeyK')) this.hud.onAdminGive('equipment');
    }
    if (input.pressed('KeyH')) { this.pause(); input.endFrame(); return; }

    // Q eats whatever there is, coconut first — it does not cost you water.
    if (!panelOpen && input.pressed('KeyQ')) {
      if (this.inv.count('coconut') > 0) this.eat('coconut');
      else if (this.anyFish()) this.eat(this.anyFish());
    }

    // Hotbar: the number keys are the slots, and the wheel cycles them unless
    // the hammer is out, where it picks the build piece instead.
    for (let i = 0; i < SLOTS; i++) {
      if (input.pressed(`Digit${i + 1}`) && this.hotbar.select(i)) this.flashSlotHint();
    }
    if (!panelOpen && !this.build.active && input.wheel &&
        this.hotbar.cycle(input.wheel)) this.flashSlotHint();

    // B is now just "take out the hammer".
    if (!panelOpen && input.pressed('KeyB')) this.takeOutHammer();

    // Build mode simply mirrors what is in your hand.
    const wantBuild = this.hotbar.heldAction(this.inv) === 'build';
    if (wantBuild !== this.build.active) this.build.toggle(wantBuild);

    // World
    this.sky.update(dt, this.player.pos);
    this.rafts.update(dt, this.time, this.sky.night);
    // The flotsam, the fish and the whale keep near you out at sea; ashore,
    // they wait offshore, where you left the water.
    if (!this.player.onLand) {
      this.focus ||= new THREE.Vector3();
      this.focus.set(this.player.pos.x, 0, this.player.pos.z);
      this.debris.focus = this.fish.focus = this.whale.focus = this.reef.focus = this.focus;
    }
    // Stepped onto another raft, or swimming by one: that is the raft now.
    {
      const p = this.player;
      const next = p.state === 'swim' ? this.rafts.nearest(p.pos.x, p.pos.z, 2.5)
                 : !p.onLand ? this.rafts.under(p.pos.x, p.pos.z) : null;
      if (next) this.setRaft(next);
    }
    // Standing on the raft — or in the air just off its deck — you go where it
    // goes, and turn as it turns. `drift` is how far that took you, which the
    // body and the view do not mistake for walking.
    const pl = this.player;
    pl.drift ||= new THREE.Vector3();
    pl.drift.set(0, 0, 0);
    if (pl.state !== 'swim' && !pl.onLand && this.raft.wasUnder(pl.pos.x, pl.pos.z)) {
      const x0 = pl.pos.x, z0 = pl.pos.z;
      pl.yaw += this.raft.carry(pl.pos);
      pl.drift.set(pl.pos.x - x0, 0, pl.pos.z - z0);
    }
    // Aground: said once for a place — it bumps on and off as the swell lifts
    // it — and, run in to the shore, as the landing it is.
    if (this.raft.aground && !this.wasAground && this.raft.speed > 0.05) {
      const at = this.raft.group.position, was = this.groundedAt;
      if (!was || Math.hypot(at.x - was.x, at.z - was.z) > 15 || this.time - was.t > 120) {
        this.groundedAt = { x: at.x, z: at.z, t: this.time };
        const shore = this.landNear(at.x, at.z, 30);
        this.hud.log(shore ? 'The raft runs aground — as close to the shore as it will go. Walk to the edge and press F to wade in.'
                           : 'The raft grinds onto a shoal. Back-paddle (right-click) to float it off.', shore ? '' : 'bad', 8000);
      }
    }
    this.wasAground = this.raft.aground;
    if (this.paddleIn > 0) this.paddleIn -= dt;
    if ((this.lookIn = (this.lookIn ?? 0) - dt) <= 0) { this.lookIn = 0.5; this.lookForStatues(); this.markMine(); }
    this.updateFires(dt);
    this.player.update(dt, this.time, input, panelOpen);
    if (!panelOpen && input.pressed('KeyV')) this.cycleView();
    this.view.update(dt, this.time);
    this.ocean.update(this.time, this.camera.position);

    const eye = this.eye.position;
    const dir = this.player.forward(this.tmpDir);
    // Stream terrain around whoever is looking at it, then run the ecosystem.
    // The plants bend to the wind the sail takes.
    const wind = windAt(this.time, this._wind ||= { x: 0, z: 0, strength: 0 });
    setFloraWind(wind.x, wind.z, wind.strength);
    this.terrain.update(dt, this.player.pos, this.time, this.sky.night);
    this.caves.update(dt, this.player.pos);
    this.wildlife.setPlayerPos(this.player.pos);
    this.wildlife.update(dt, this.time, this.player,
                         this.player.state === 'deck' && this.player.onLand);
    this.debris.update(dt, this.time, this.player.pos);
    this.fish.update(dt, this.time, eye);      // the others it shies from too: sharedworld.js
    this.reef.update(dt, this.time, eye, this.player.pos);
    this.whale.update(dt, this.time);
    this.spears.update(dt, this.time);
    this.hook.update(dt, eye.clone().addScaledVector(dir, 0.5), this.time, this.debris,
                     it => this.gather(it));

    // Interaction
    let prompt = null;
    if (!panelOpen) {
      if (this.build.active) {
        prompt = this.build.update(eye, dir, input);
        // Ashore, away from the water, there is nothing to build: no nagging to look at it.
        const pl = this.player;
        if (!this.build.target && pl.onLand && (pl.cave || !this.waterNear(pl.pos.x, pl.pos.z, 14))) prompt = null;
        // The hammer in hand still leaves E free: the fire, the collector, the
        // flotsam you are looking at answer it as they would empty-handed.
        const act = this.findInteraction(eye, dir);
        this.sawDrill(act, dt, input);
        const sub = prompt ? `<span class="sub">${prompt}</span>` : '';
        if (act?.act || act?.drill) {
          prompt = act.prompt + sub;
          if (act.act && input.pressed('KeyE')) act.act();
        } else if (pl.state === 'swim' && this.raft.nearestDeck(pl.pos.x, pl.pos.z, 2.1)) {
          prompt = '<b>Space</b> climb aboard' + sub;
        }
        if (act?.alt && input.pressed(act.alt.key)) act.alt.act();
        if (input.clicked(0)) {
          this.useAnim('build');
          const placed = this.build.place();
          if (placed) {
            this.together.placed(placed.id, this.build.placedAt);
            this.hud.log(`${placed.name} built.`, 'good');
            this.hud.refreshInventory(this.inv);
            this.hud.refreshCraft(this.inv);
          }
        }
      } else {
        const act = this.findInteraction(eye, dir);
        this.sawDrill(act, dt, input);
        if (act) {
          prompt = act.prompt;
          if (act.act && input.pressed('KeyE')) act.act();
          if (act.alt && input.pressed(act.alt.key)) act.alt.act();
        } else if (this.player.state === 'swim' && this.raft.nearestDeck(this.player.pos.x, this.player.pos.z, 2.1)) {
          prompt = '<b>Space</b> climb aboard';
        } else if (this.hotbar.held === 'statue' && this.inv.has('statue')) {
          prompt = '<b>Click</b> set the statue up — on level ground, or a free square of deck';
        } else if (this.hotbar.held === 'paddle' && this.inv.has('paddle') && this.onDeck()) {
          prompt = `<b>Hold click</b> paddle · <b>right-click</b> back-paddle — ${this.raft.speed.toFixed(1)} m/s` +
                   (this.raft.aground ? ' · aground' : '');
        } else if (now < this.slotHintUntil) {
          const id = this.hotbar.held;
          if (id && this.inv.has(id) && ITEMS[id].hint) {
            prompt = ITEMS[id].hint.replace('Click', '<b>Click</b>');
          }
        }
        // The rod is held, not clicked: the swing meter charges while the
        // button is down and the reel winds while it is down, so it gets the
        // button's whole state rather than one click.
        if (this.hotbar.held === 'rod' && this.inv.has('rod')) {
          this.fishing.control({ press: input.clicked(0), hold: input.mouseDown(0),
                                 release: input.released(0) }, eye, dir, this.player);
        } else if (this.hotbar.held === 'paddle' && this.inv.has('paddle')) {
          // Held down, it keeps stroking — forward, or back with the other button.
          if (input.mouseDown(0)) this.paddleStroke(1);
          else if (input.mouseDown(2)) this.paddleStroke(-1);
        } else if (input.clicked(0) && !act?.drill) this.useHeld(eye, dir);
      }

      // Playing together: say something.
    if (!panelOpen && !this.chatting && (input.pressed('Enter') || input.pressed('NumpadEnter'))) this.openChat?.();

    // Salvage works whether or not build mode is on.
      const standing = input.pressed('KeyX') && this.statues.pick(eye, dir);
      const keeper = standing && this.otherWaker(standing.id);
      if (keeper) this.hud.log(`${keeper} wakes at this statue — it stays.`, 'bad');
      else if (standing) {
        // Taken up again, to set up somewhere else.
        this.statues.remove(standing.id);
        this.together.world.statueDown(standing);
        this.inv.add('statue', 1);
        this.hotbar.autoAssign('statue');
        if (this.registered?.id === standing.id) { this.registered = null; this.setWake(null); }
        this.hud.log('You lift the statue. Carry it, and click to set it down somewhere else — on land, or on the raft.', 'good');
        this.hud.refreshInventory(this.inv);
      } else if (input.pressed('KeyX')) {
        this.ray.set(eye, dir);
        const r = this.build.salvage(this.ray);
        if (r?.blocked) this.hud.log(r.blocked, 'bad');
        else if (r) {
          this.together.took(r.piece);
          // A statue comes back to your hands (its "cost" is itself); yours no longer is.
          if (r.refund.statue && this.registered?.raft && !this.myStatue()) { this.registered = null; this.setWake(null); }
          this.hud.log(r.piece.id === 'statue' ? 'You unlash the statue and lift it.' : `Salvaged ${r.name}.`, 'good');
          this.hud.refreshInventory(this.inv);
        }
      }

      // Right-click throws: the spear if it is in hand, otherwise the hook.
      // With the rod, it baits the hook with one of your fish instead.
      if (input.clicked(2)) {
        const held = this.hotbar.held;
        if (held === 'rod' && this.inv.has('rod')) {
          const bait = this.fishing.bait ? this.baitId : this.baitFish();
          const d = this.fishing.toggleBait(!!bait, bait && ITEMS[bait].name.toLowerCase());
          if (d > 0) { this.inv.remove(bait, 1); this.baitId = bait; this.hotbar.refillFish(this.inv); }
          else if (d < 0 && bait) { this.inv.add(bait, 1); this.baitId = null; }
          if (d) this.hud.refreshInventory(this.inv);
          if (!d && this.fishing.busy) this.hud.log('Reel in first to change the bait.', 'bad');
        } else if (held === 'spear') this.throwSpear(eye, dir);
        else if (held === 'paddle') { /* back-paddling: held, above */ }
        else if (held === 'hook') this.useHeld(eye, dir);
        else if (this.inv.has('hook') || this.inv.has('spear')) {
          this.hud.log('Select the hook or the spear first.', 'bad');
        } else this.hud.log('You have nothing to throw. Craft a hook.', 'bad');
      }
    }
    // A line in the water says what it is doing over anything else.
    if (this.fishing.prompt) prompt = this.fishing.prompt;
    this.hud.setPrompt(prompt);
    // A visible cursor sliding around mid-look is a distraction; panels get it back.
    document.body.classList.toggle('freelook', input.allowLook && !this.cursorPanel);

    // Underwater look & feel — colour, light and motes all fall off with depth.
    // What the camera sees, not where your eyes are: in third person the
    // camera can be in the air while you swim, or under while you tread.
    const lens = this.camera.position;
    const surface = waveHeight(lens.x, lens.z, this.time);
    const submerged = lens.y < surface;
    const depth = Math.max(0, surface - lens.y);
    const light = this.underwater.update(dt, lens, submerged, depth, this.sky,
                                         this.scene, this.sky.night);
    this.hud.setUnderwater(submerged, submerged ? 1 - light : 0);
    // In a cave, the daylight falls away with how far in you are: the sky's
    // light, the moon's, and what lights your hands (caves.js has the rock's).
    const day = this.caves.daylightAt(lens);
    this.sky.hemi.intensity *= day;
    this.sky.moon.intensity *= day;
    this.viewmodel.shade = day;
    this.ocean.uniforms.uShade.value = day;
    if (this.player.cave && day < 0.25 && !this.torch.lit && !this.saidDark) {
      this.saidDark = true;
      const striker = this.inv.has('striker') || this.inv.has('torch');
      this.hud.log('Past the first few metres it is black. A torch would light the way in — Wood and Palm fibre, crafting (C)' +
                   (striker ? '. ' : ' — and back by the mouth, in the light, is flint: struck on scrap, it lights a torch anywhere. ') +
                   'Nothing that hunts you out there can follow you in here.', '', 9000);
    }

    // After underwater.update(), which has just dimmed the lights the tool
    // copies — so what is in your hand goes dark and blue with the world.
    const held = this.hotbar.held;
    this.updateTorch(dt, held);
    if (this.pendingChop && this.time >= this.pendingChop.at) { const c = this.pendingChop; this.pendingChop = null; this.landChop(c); }
    // A tree left half-chopped long enough is whole again, as far as you are concerned.
    for (const [key, c] of this.chops) if (this.time - c.at > 60) this.chops.delete(key);
    // A lit torch is a body of its own — flame and all — in your hand, on your body and in the others' view.
    const shown = held === 'torch' && this.torch.lit ? 'torch_lit' : held;
    this.viewmodel.update(dt, {
      drift: this.player.drift,
      held: shown,
      owned: !!held && this.inv.has(held),
      hidden: held === 'hook' && this.hook.busy,     // it is out on the line
    });
    // The body, outside first person: where you are, holding what you hold.
    const outside = !this.view.first;
    this.body.visible = outside;
    const inHand = held && this.inv.has(held) && !(held === 'hook' && this.hook.busy)
      && !(held === 'spear' && !this.viewmodel.current) ? shown : null;
    if (inHand !== this.body.heldId) this.body.hold(inHand, inHand ? this.viewmodel.cloneBody(inHand) : null);
    this.body.update(dt, this.player);
    this.net.update(dt, this.player, inHand, this.time, this.lineOut(), this.camera.position);
    if (this.net.connected && (this.crewIn = (this.crewIn ?? 0) - dt) <= 0) { this.crewIn = 0.5; this.refreshCrew?.(); this.watchCrew(); }
    this.together.update(dt);
    if (this.pendingThrow != null && (this.pendingThrow -= dt) <= 0) {
      this.pendingThrow = null;
      this.launchSpear(eye, dir);
    }
    document.body.classList.toggle('view-second', this.view.mode === 'second');
    document.body.classList.toggle('view-out', this.view.mode !== 'first');
    document.body.classList.toggle('building', this.build.active);

    // After the viewmodel, so the line hangs from where the rod tip is now.
    this.fishing.update(dt, this.time, this.player, held === 'rod' && this.inv.has('rod'));
    for (const e of this.fishing.events.splice(0)) {
      if (e.catch) {
        this.net.event({ k: 'landed', key: e.catch });     // "Ben lands a grouper", for the others
        this.addCatch(e.catch, e.count);
        this.hud.refreshInventory(this.inv);
      }
      if (e.text) this.hud.log(e.text, e.kind);
    }
    this.hud.setFishing(this.fishing.meter);
    if (submerged && this.player.breath < 30 && !this._gasping) {
      this._gasping = true;
      this.hud.log('Your chest is burning. Get to the surface.', 'bad');
    } else if (this.player.breath > 60) {
      this._gasping = false;
    }

    // HUD
    // A short grace period after being hit, so a pack cannot stack three bites
    // into the same instant. Caps incoming damage no matter how many close in,
    // which leaves time to run for the water — the only escape there is.
    // A bite on someone else, by the host's animals, is theirs to take (sharedworld.js).
    const bites = this.wildlife.events.splice(0).filter(b => {
      if (b.to === undefined) return true;
      this.net.event({ k: 'bite', damage: b.damage, label: b.label }, b.to);
      return false;
    });
    // Report any species that upgraded itself to a glTF body.
    for (const u of this.wildlife.upgraded.splice(0)) {
      console.info(`Loaded ${u.key} model (${u.count} animals, ${u.clips} clips).`);
    }
    for (const id of this.viewmodel.upgraded.splice(0)) {
      console.info(`Loaded ${ITEMS[id].name.toLowerCase()} model.`);
    }
    for (const u of this.fish.upgraded.splice(0)) {
      this.viewmodel.dropFishBodies();      // a fish in hand was the stand-in body
      console.info(`Loaded sea life models (${u.meshes} bodies).`);
    }
    for (const k of this.wildlife.kills.splice(0)) {
      this.together.world.killed(k);
      if (k.pos.distanceTo(this.player.pos) < 150) {
        this.hud.log(`A ${k.hunter.toLowerCase()} brings down a ${k.victim.toLowerCase()}.`);
      }
    }
    // Hunted: there is no fighting one off, so say what does work — the first
    // time, and again if it has been a while.
    const hunter = this.wildlife.all.find(a => a.state === 'hunt' && a.prey === 'player' && !a.dead);
    if (hunter) this.sayHunted(hunter.sp.label);
    this.tellHunted();
    if (bites.length && this.time > this.lastBite + 0.8) {
      this.lastBite = this.time;
      const worst = bites.reduce((a, b) => (b.damage > a.damage ? b : a));
      this.player.health = Math.max(0, this.player.health - worst.damage);
      this.hud.log(`The ${worst.label.toLowerCase()} tears into you.`, 'bad');
    }

    this.hud.updateVitals(this.player);
    this.warnLow();
    this.hud.updateClock(this.sky, this.player, this.raft, this.raftWay());
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
    this.hud.refreshPack(this.inv, this.hotbar);
    this.hud.refreshCraft(this.inv);
    this.hud.tickMessages(now);
    if (this.admin) this.hud.syncAdmin(this.sky);
    for (const e of this.player.events.splice(0)) this.hud.log(e.text, e.kind);
    if (this.player.health < this.lastHealth - 0.6) this.hud.flashHurt();
    this.lastHealth = this.player.health;

    this.checkGoals();
    if (this.time - this.lastSave > 10) { this.save(); this.lastSave = this.time; }

    // A tree coming down near you: the ground shakes, for half a second.
    let quake = null;
    if (this.quake && (this.quake.t += dt) < 0.6) {
      const k = this.quake.amp * (1 - this.quake.t / 0.6);
      quake = new THREE.Vector3(Math.sin(this.quake.t * 61) * k, Math.sin(this.quake.t * 47 + 1) * k, Math.sin(this.quake.t * 53 + 2) * k);
      this.camera.position.add(quake);
    } else this.quake = null;
    sound.listen(this.camera);
    if (drawn) {
      this.renderer.render(this.scene, this.camera);
      if (this.view.first) this.viewmodel.render();
    }
    if (quake) this.camera.position.sub(quake);
    input.endFrame();
  }

  checkGoals() {
    let ticked = null;
    for (const g of GOALS) {
      if (!this.goalsDone.has(g.id) && g.test(this)) { this.goalsDone.add(g.id); ticked = g; }
    }
    // The first look (a save just loaded, a world just joined) ticks off
    // quietly whatever was already so: only what you do from then on is said.
    if (!this.goalsSeen) { this.goalsSeen = true; ticked = null; }
    // What can be done where you are, first; failing that, whatever is left.
    const here = this.player.onLand ? 'land' : 'sea';
    const open = GOALS.filter(g => !this.goalsDone.has(g.id));
    const next = open.find(g => !g.where || g.where === here) || open[0];
    const todo = next && (typeof next.todo === 'function' ? next.todo(this) : next.todo);
    this.hud.setObjective(todo, ticked?.done, GOALS.length - GOALS.filter(g => !this.goalsDone.has(g.id)).length, GOALS.length);
  }

  /**
   * Thirst or hunger running low: said once as it drops under 25, and again
   * at empty — with what would help — then not until it has been put right.
   */
  warnLow() {
    const p = this.player, w = this._low ||= {};
    const say = (key, v, low, empty) => {
      if (v > 40) { w[key] = 0; return; }
      if (v <= 0 && w[key] < 2) { w[key] = 2; this.hud.log(empty, 'bad', 8000); }
      else if (v < 25 && !w[key]) { w[key] = 1; this.hud.log(low, 'bad', 8000); }
    };
    const drink = [...this.raft.objs.values()].some(o => o.type === 'collector')
      ? 'drink from the collector (E)' : 'build a collector, or find fresh water ashore';
    say('thirst', p.thirst, `Your mouth is dry. Drink soon — ${drink}.`,
        'You are parched, and it is costing you health. Drink!');
    say('hunger', p.hunger, 'Your stomach cramps. Eat — a coconut (Q), or a fish.',
        'You are starving, and it is costing you health. Eat something.');
  }

  /** Whether there is water deep enough to float a foundation within `r` metres of (x, z). */
  waterNear(x, z, r) {
    for (let d = 3; d <= r; d += 3.5) {
      for (let a = 0; a < 12; a++) {
        const b = (a / 12) * Math.PI * 2;
        if (landHeight(x + Math.cos(b) * d, z + Math.sin(b) * d) < -0.6) return true;
      }
    }
    return false;
  }

  /** Whether there is dry land within `r` metres of (x, z). */
  landNear(x, z, r) {
    for (let d = 5; d <= r; d += 5) {
      for (let a = 0; a < 16; a++) {
        const b = (a / 16) * Math.PI * 2;
        if (landHeight(x + Math.cos(b) * d, z + Math.sin(b) * d) > 0.3) return true;
      }
    }
    return false;
  }

  /** The nearest dry land, {x, z, d}, or null — looked for every two seconds. */
  nearestLand() {
    if (this._land && this.time - this._land.at < 2) return this._land.best;
    const p = this.player.pos;
    let best = null;
    for (let d = 20; d <= 900 && !best; d += 20) {
      for (let a = 0; a < 48; a++) {
        const b = (a / 48) * Math.PI * 2, x = p.x + Math.cos(b) * d, z = p.z + Math.sin(b) * d;
        if (landHeight(x, z) > 0.5) { best = { d, x, z }; break; }
      }
    }
    this._land = { at: this.time, best };
    return best;
  }

  /** The nearest cave mouth, {x, z, d}, or null. */
  nearestCave() {
    const p = this.player.pos;
    let best = null;
    for (const c of CAVES) {
      const d = Math.hypot(c.mouth.x - p.x, c.mouth.z - p.z);
      if (!best || d < best.d) best = { x: c.mouth.x, z: c.mouth.z, d };
    }
    return best;
  }

  /**
   * Off your raft — ashore, or swimming — how far it is and which way, for the
   * tags under the clock: "Raft 87 m ↓". Null aboard, close by, or with no raft.
   */
  raftWay() {
    const r = this.raft;
    if (!r?.size || this.onDeck()) return null;
    let near = null;
    for (const c of r.cells.values()) {
      const w = r.cellWorld(c.cx, c.cz), d = Math.hypot(w.x - this.player.pos.x, w.z - this.player.pos.z);
      if (!near || d < near.d) near = { x: w.x, z: w.z, d };
    }
    if (!near || near.d < 12) return null;
    return `Raft ${near.d < 100 ? Math.round(near.d) : Math.round(near.d / 10) * 10} m ${this.arrowTo(near)}`;
  }

  /** Which way a place is from where you are looking, as an arrow: ↑ ahead, ↓ behind. */
  arrowTo(at) {
    const p = this.player.pos, dx = at.x - p.x, dz = at.z - p.z;
    if (Math.hypot(dx, dz) < 3) return '';
    const yaw = this.player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ahead = fx * dx + fz * dz, right = -fz * dx + fx * dz;
    const a = Math.atan2(right, ahead);                       // 0 ahead, + to the right
    return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }

  /**
   * How far a place is, and which way from where you are looking: "about 80 m
   * ahead, to your left" — for the objective line, which has no map to point at.
   */
  wayTo(at) {
    if (!at) return 'somewhere out there';
    const p = this.player.pos, d = Math.hypot(at.x - p.x, at.z - p.z) || 1;
    if (d < 12) return 'right here';
    // Relative to the way you face: forward is (-sin yaw, -cos yaw).
    const yaw = this.player.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), dx = (at.x - p.x) / d, dz = (at.z - p.z) / d;
    const ahead = fx * dx + fz * dz, right = -fz * dx + fx * dz;
    const side = `to your ${right > 0 ? 'right' : 'left'}`;
    const way = ahead > 0.8 ? 'straight ahead' : ahead < -0.8 ? 'behind you'
              : ahead > 0.3 ? `ahead, ${side}` : ahead < -0.3 ? `behind you, ${side}` : side;
    const far = d < 100 ? Math.round(d / 10) * 10 : Math.round(d / 50) * 50;
    return `about ${far} m ${way}`;
  }


  /** Briefly explain the newly selected item instead of nagging permanently. */
  flashSlotHint() { this.slotHintUntil = performance.now() + 2600; }

  /** Put the hammer in hand, registering it to a slot if it is not in one. */
  takeOutHammer() {
    if (!this.inv.has('hammer')) {
      this.hud.log('You need a hammer before you can build.', 'bad');
      return;
    }
    if (this.hotbar.selectItem('hammer')) return;
    const slot = this.hotbar.autoAssign('hammer');
    if (slot !== -1) { this.hotbar.select(slot); return; }
    this.hotbar.assign(this.hotbar.selected, 'hammer');
    this.hud.log(`Hammer registered to slot ${this.hotbar.selected + 1}.`);
  }

  // ── persistence ────────────────────────────────────────────────────────────
  /**
   * What you carry, as saved. Thrown spears are not saved where they lie;
   * they count as carried, so reloading never costs you one — and the fish
   * on them, and a fish on the hook as bait, as fish in the bag, each its own
   * species. At home, fish on a spit go in the bag too (cooked if done); in a
   * room's world the fires are everyone's.
   */
  carried(spits = true) {
    const inv = this.inv.toJSON();
    const bag = (id, n = 1) => { if (ITEMS[id]) inv[id] = (inv[id] || 0) + n; };
    if (this.spears.count) bag('spear', this.spears.count);
    for (const s of this.spears.list) for (const f of s.catch) bag(fishItem(f.key));
    if (spits) for (const r of this.rafts.list) for (const o of r.objs.values()) for (const f of o.spitFish || []) bag(f.t >= FIRE.cook ? f.done : f.raw);
    if (this.fishing.bait && this.baitId) bag(this.baitId);
    return inv;
  }

  save() {
    if (this.wiped) return;
    // In a room, what is kept is the room's (on the relay); your own world
    // stays at home as you left it.
    if (this.room) { this.keepRoom(); return; }
    try {
      const inv = this.carried();
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        rafts: this.rafts.toJSON(this.raft),
        raftId: this.raft.id,
        statues: this.statues.toJSON(),
        start: this.origin,
        registered: this.registered,
        scattered: true,
        inv,
        hotbar: this.hotbar.toJSON(),
        player: this.player.toJSON(),
        view: this.view.mode,
        character: this.character,
        time: this.sky.time,
        day: this.sky.day,
        goals: [...this.goalsDone],
        // The trees you cut and the plants you took, until they grow back —
        // or a reload would put them all back at once.
        felled: this.terrain.felledList(),
        chipped: this.caves.chippedList(),
      }));
    } catch { /* storage full or blocked — not worth interrupting play */ }
  }

  loadSave() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return false; }
    // A save with no raft is still a save, if it knows where you started
    // (washed up on a beach, say, with nothing built yet).
    if (!d || (!d.raft?.cells?.length && !d.start)) return false;
    // Every raft (an old save has the one); you are with the one you were with.
    this.rafts.load(d.rafts || d.raft || {});
    this.setRaft(this.rafts.byId(d.raftId) || this.rafts.list[0] || this.rafts.make());
    // Before starts were chosen, everyone started on the raft, here.
    this.origin = d.start || { kind: 'raft', x: 0, z: 0, yaw: 0 };
    this.statues.load(d.statues);
    // A save from before statues stood about the land gets them now.
    if (!d.scattered) for (const s of scatter()) this.statues.add(s);
    this.registered = d.registered || null;
    this.markMine();
    this.inv = Inventory.fromJSON(d.inv || {});
    this.hotbar = Hotbar.fromJSON(d.hotbar);
    // A save from before fish were told apart: its "raw fish" slot goes to
    // the fish it has most of (Inventory.fromJSON has already sorted them).
    const oldFish = d.hotbar?.slots?.indexOf?.('fish') ?? -1;
    if (oldFish !== -1 && !this.hotbar.slots[oldFish]) {
      const most = [...this.inv.slots].filter(([id]) => fishOf(id)).sort((a, b) => b[1] - a[1])[0];
      if (most) this.hotbar.slots[oldFish] = most[0];
    }
    this.build.inv = this.inv;
    this.player.load(d.player);
    // Back where you were: on the deck (wherever it has got to), or ashore or
    // in the water where you left off.
    const was = d.player?.where, pos = d.player?.pos;
    if (was && was !== 'deck' && Array.isArray(pos)) this.player.standAt(pos[0], pos[2], d.player.yaw, pos[1]);
    else if (this.raft.size) this.player.respawnOnRaft();
    else this.player.standAt(this.origin.x, this.origin.z, this.origin.yaw);
    this.sky.time = d.time ?? this.sky.time;
    this.sky.day = d.day ?? 1;
    for (const g of d.goals || []) this.goalsDone.add(g);
    this.terrain.restoreFelled(d.felled);
    this.caves.restoreChipped(d.chipped);
    if (d.view) this.view.set(d.view);
    if (d.character) this.character = d.character;
    return true;
  }
}

new Game();
