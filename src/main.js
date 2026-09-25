// ── Adrift ───────────────────────────────────────────────────────────────────
// Ocean raft survival prototype. Gather → craft → build → upgrade the raft.

import * as THREE from 'three';
import { Ocean, waveHeight } from './ocean.js';
import { Sky } from './sky.js';
import { Raft } from './raft.js';
import { DebrisField } from './debris.js';
import { Hook } from './hook.js';
import { FishSchools } from './fish.js';
import { Whale } from './whale.js';
import { Underwater } from './underwater.js';
import { Viewmodel, THRUST_REACH, COOKED } from './viewmodel.js';
import { CameraRig } from './camera.js';
import { PlayerBody } from './body.js';
import { Net, newCode, cleanCode } from './net.js';
import { Together } from './together.js';
import { pickStart, WAKING } from './spawn.js';
import { Statues, newStatueId, scatter } from './statue.js';
import { ThrownSpears, travelTime } from './spear.js';
import { Fishing } from './fishing.js';
import { Terrain, heightAt as landHeight, coastDistance, CHUNK } from './terrain.js';
import { Wildlife } from './wildlife.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { BuildMode } from './build.js';
import { Inventory, RECIPES, ITEMS, DEBRIS_KINDS, CATCHES, FIRE, fishItem, fishOf, foodOf, cookedItem, isCooked } from './items.js';
import { Hotbar, SLOTS } from './hotbar.js';

const SAVE_KEY = 'adrift.save.v2';
const THROW_RELEASE = 0.27;         // s into the body's throw (body.js) that the spear leaves the hand
const SPIT_Y = 0.77;                 // the spit's cross-stick, above the campfire (raft.js)


// What the admin "give" buttons hand over. Enough to build without grinding,
// not so much that the numbers stop being readable.
const ADMIN_MATERIALS = { wood: 50, plank: 50, rope: 50, leaf: 50, scrap: 50, coconut: 10 };
const ADMIN_EQUIPMENT = ['hammer', 'hook', 'spear', 'rod'];

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

// ── milestones ───────────────────────────────────────────────────────────────
// Light guidance instead of a tutorial: each fires once, in order of discovery.
const GOALS = [
  { id: 'wood',    test: g => g.inv.count('wood') > 0 || g.inv.count('plank') > 0,
    text: 'Driftwood aboard. Open crafting with C and split it into planks.' },
  { id: 'plank',   test: g => g.inv.count('plank') > 0,
    text: 'Planks made. A hammer comes next — you cannot build without one.' },
  { id: 'hammer',  test: g => g.inv.has('hammer'),
    text: 'Hammer in hand. Press B to build and extend the deck.' },
  { id: 'grew',    test: g => g.raft.size > 4,
    text: 'The raft is growing. Thirst kills first: build a Collector.' },
  { id: 'water',   test: g => [...g.raft.objs.values()].some(o => o.type === 'collector'),
    text: 'Collector up. Wait for it to fill, then press E to drink.' },
  { id: 'fire',    test: g => [...g.raft.objs.values()].some(o => o.type === 'campfire'),
    text: 'Campfire built — but not lit. Craft a bow drill (C), hold it at the fire and hold click. It takes 1 Palm for tinder.' },
  { id: 'lit',     test: g => [...g.raft.objs.values()].some(o => o.type === 'campfire' && o.lit),
    text: 'Fire lit. Hold a raw fish and press E at the fire to cook it — and feed it wood before it burns out.' },
  { id: 'hook',    test: g => g.inv.has('hook'),
    text: 'Hook ready. Right-click to throw it at debris out of reach.' },
  { id: 'shelter', test: g => [...g.raft.cells.values()].some(c => g.raft.isSheltered(c.cx, c.cz)),
    text: 'Shelter finished. You will keep your strength far longer in there.' },
];

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.sky = new Sky(this.scene, this.ocean);
    this.raft = new Raft(this.scene);
    this.inv = new Inventory();
    this.hotbar = new Hotbar();
    // Terrain first: the player and the fish both collide against its reef.
    this.terrain = new Terrain(this.scene);
    this.terrain.shareSky(this.ocean.uniforms);
    this.player = new Player(this.eye, this.raft, this.terrain);
    // Where you came to (spawn.js) and the statue you wake at (statue.js).
    this.start = null;
    this.statues = new Statues(this.scene);
    this.registered = null;          // {id, world} or {raft, cx, cz, world}: world null for your own, else the room's code
    this.found = new Set();          // the ids of the statues you have come across
    this.player.onDeath = () => this.respawn();
    this.debris = new DebrisField(this.scene, this.raft);
    // Seed the wildlife around a point well inland from the nearest coast.
    this.wildlife = new Wildlife(this.scene, { x: 210, z: -150 }, this.terrain);
    this.fish = new FishSchools(this.scene, this.terrain, this.raft);
    this.whale = new Whale(this.scene, this.terrain, this.raft, this.fish);
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
                         log: (text, kind, ms) => this.hud.log(text, kind, ms),
                         raft: this.raft, together: this.together,
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

    this.hud.onCraft = id => this.craft(id);
    this.hud.onSelectSlot = i => { if (this.hotbar.select(i)) this.flashSlotHint(); };
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
    this.raft.update(0, this.time);
    this.sky.update(0, this.raft.group.position);
    this.player.applyCamera(0, this.time, false);
    this.view.update(0);
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
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ── plumbing ───────────────────────────────────────────────────────────────
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
    name.value = store.get('adrift.name') || `Castaway ${Math.floor(Math.random() * 90 + 10)}`;
    const who = () => (name.value.trim() || 'Castaway').slice(0, 20);
    for (const el of box.querySelectorAll('input, button')) el.addEventListener('click', e => e.stopPropagation());
    // Renamed, you are renamed in the game you are in too, once you stop typing.
    let typing;
    name.oninput = () => {
      store.set('adrift.name', who());
      clearTimeout(typing);
      typing = setTimeout(() => this.net.rename(who()), 500);
    };
    const go = code => { store.set('adrift.name', who()); this.net.join(code, who(), this.character); };
    $('mpHost').onclick = () => go(newCode());
    $('mpJoin').onclick = () => { const c = cleanCode($('mpCode').value); if (c.length >= 4) go(c); };
    $('mpLeave').onclick = () => this.net.leave();
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
      $('mpStatus').textContent = n.status;
      const again = n.lastRoom;
      $('mpRejoin').hidden = !again || (!!n.code && !!n.ws);
      $('mpRejoin').textContent = again ? `Rejoin ${again}` : '';
      $('mpInvite').value = n.invite;
      const crew = n.crew();
      $('crew').hidden = crew.length === 0;
      $('crew').innerHTML = crew.length ? `<b>${n.code}</b>` + crew.map(c => `<div></div>`).join('') : '';
      [...$('crew').querySelectorAll('div')].forEach((d, i) => { d.textContent = crew[i]; });
    };
    this.net.onChange = refresh;
    this.refreshCrew = refresh;          // and twice a second, for how far off everyone is
    refresh();
    const code = cleanCode(new URLSearchParams(location.search).get('room'));
    if (code.length >= 4 && this.net.available) { $('mpCode').value = code; go(code); }
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
      this.input.enabled = true;
    };
    this.openChat = () => {
      if (this.chatting || !this.net.connected) return;
      this.chatting = true;
      this.input.held.clear();
      this.input.enabled = false;
      box.parentElement.hidden = false;
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
  craft(id) {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return;
    const item = ITEMS[r.out[0]];
    if (item.tool && this.inv.count(r.out[0]) > 0) return;
    if (!this.inv.pay(r.cost)) { this.hud.log('Not enough materials.', 'bad'); return; }
    this.inv.add(r.out[0], r.out[1]);
    this.hud.log(`Crafted ${item.name}${r.out[1] > 1 ? ` ×${r.out[1]}` : ''}.`, 'good');
    const slot = this.hotbar.autoAssign(r.out[0]);
    if (slot !== -1) this.hud.log(`${item.name} goes to slot ${slot + 1}.`);
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

  gather(it) {
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
    const g = { spear: 'thrust', build: 'swing', eat: 'eat', hook: 'toss', paddle: 'paddle' }[kind];
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
        this.hud.log('Hold click at an unlit campfire to drill an ember.');
        break;
      default:
        this.hud.log(`${ITEMS[id].name} is raw material — nothing to do with it in hand.`);
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
    if (!f) {
      // A miss still scares everything near the point.
      if (this.player.submerged) this.fish.startle(eye.clone().addScaledVector(dir, THRUST_REACH), 2.5, 0.05);
      this.hud.log('A thrust at nothing. Right-click to throw it.');
      return;
    }
    this.fish.take(f);
    this.viewmodel.skewer(this.fish.bodyFor(f));
    this.net.event({ k: 'caught', i: this.fish.fish.indexOf(f) });   // on the spear they see you hold
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
    const done = o.spitFish.filter(f => f.t >= FIRE.cook);
    if (done.length) {
      return { prompt: `<b>E</b> take ${this.describeCatch(done)} off the fire`, act: () => this.takeCooked(o) };
    }
    const held = this.hotbar.held;
    const cooking = o.spitFish.length ? ` — ${this.describeCatch(o.spitFish)} cooking` : '';
    if (!o.lit) {
      if (o.fuel <= 0) {
        return this.inv.has('wood')
          ? { prompt: `<b>E</b> lay wood in the burnt-out fire${cooking}`, act: () => this.feedFire(o) }
          : { prompt: `Burnt out — it needs Wood before it will light again${cooking}`, act: null };
      }
      if (held === 'bowdrill' && this.inv.has('bowdrill')) {
        if (!this.inv.has('leaf')) return { prompt: 'You need 1 Palm as tinder to catch the ember', act: null };
        const p = this.drill?.rec === o ? this.drill.p : 0;
        return { prompt: p > 0 ? `Drilling an ember <span class="meter"><i style="width:${Math.round(p * 100)}%"></i></span>`
                               : '<b>Hold click</b> to drill an ember (1 Palm for tinder)',
                 act: null, drill: o };
      }
      return { prompt: (this.inv.has('bowdrill') ? 'Unlit — take out the bow drill to light it'
                                                 : 'Unlit — craft a bow drill (C) to light it') + cooking, act: null };
    }
    const raw = fishOf(held) && !isCooked(held) && this.inv.has(held) ? held : null;
    if (raw && o.spitFish.length < FIRE.spit) {
      return { prompt: `<b>E</b> cook the ${ITEMS[raw].name.toLowerCase()}${cooking}`, act: () => this.cook(o, raw) };
    }
    const pct = Math.round(o.fuel / FIRE.max * 100);
    if (this.inv.has('wood') && o.fuel <= FIRE.max - FIRE.perWood / 2) {
      return { prompt: `<b>E</b> add wood — burning, ${pct}%${cooking}`, act: () => this.feedFire(o) };
    }
    const hint = !cooking && !raw && this.anyRawFish() ? ' — hold a raw fish to cook it' : '';
    return { prompt: `Burning, ${pct}%${cooking}${hint}`, act: null };
  }

  anyRawFish() {
    for (const [id, n] of this.inv.slots) if (n > 0 && fishOf(id) && !isCooked(id)) return id;
    return null;
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
    for (const o of this.raft.objs.values()) {
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
    for (const o of this.raft.objs.values()) for (const f of o.spitFish || []) this.unhang(f);
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

  takeCooked(o) {
    const done = o.spitFish.filter(f => f.t >= FIRE.cook);
    for (const f of done) {
      this.inv.add(f.done, 1);
      this.hotbar.takeFish(f.done);
      this.unhang(f);
    }
    o.spitFish = o.spitFish.filter(f => f.t < FIRE.cook);
    this.layoutSpit(o);
    this.together.touched(o);
    this.hud.log(`You take ${this.describeCatch(done)} off the fire, cooked.`, 'good');
    this.hud.refreshInventory(this.inv);
  }

  /** Fish on a lit fire cook, and brown as they do; a fire that is out holds them. */
  updateFires(dt) {
    for (const o of this.raft.objs.values()) {
      if (o.type !== 'campfire' || !o.lit) continue;
      for (const f of o.spitFish) {
        const was = f.t;
        f.t = Math.min(FIRE.cook, f.t + dt);
        this.brown(f);
        if (was < FIRE.cook && f.t >= FIRE.cook) this.hud.log(`The ${f.name} is done — take it off the fire.`, 'good');
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
    const parts = [...counts].map(([name, n]) => (n === 1 ? `a ${name}` : `${n} ${name}`));
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  }

  // ── coming to, and coming back ─────────────────────────────────────────────
  /** A new castaway: somewhere on the edge of the world (spawn.js), with whatever that start gives. */
  newStart(kind) {
    const st = this.start = pickStart(kind);
    this.raft.clear();
    const heading = Math.random() * Math.PI * 2;
    // On a beach there is no raft yet: its place is the water offshore,
    // where the flotsam will gather and a first foundation can go.
    const at = st.kind === 'shore' ? st.sea : st;
    this.raft.setPose([at.x, at.z, heading]);
    if (st.kind === 'raft') this.raft.startingRaft();
    else if (st.kind === 'debris') this.raft.place('foundation', { cx: 0, cz: 0, force: true });
    if (this.raft.size) this.player.respawnOnRaft();
    else this.player.standAt(st.x, st.z, st.yaw);
    for (const line of WAKING[st.kind]) this.hud.log(line);
    // Statues stand all over the land, to be found.
    this.statues.clear();
    for (const s of scatter()) this.statues.add(s);
    this.found = new Set();
    this.registered = null;
  }

  /** The world you are in: null your own, else the code of the game you are a guest in. */
  get world() { return this.together.guest ? this.net.code : null; }

  /**
   * Your statue, if you have one and it is in this world: {s} for one on
   * land, {o} for one on the raft's deck.
   */
  myStatue() {
    const r = this.registered;
    if (!r || (r.world ?? null) !== this.world) return null;
    if (r.raft) {
      const o = this.raft.objs.get(`${r.cx},${r.cz}`);
      return o?.type === 'statue' ? { o } : null;
    }
    const s = this.statues.find(r.id);
    return s ? { s } : null;
  }

  /** The garland on yours, wherever it is. */
  markMine() {
    const m = this.myStatue();
    this.statues.mark(m?.s?.id ?? null);
    for (const o of this.raft.objs.values()) {
      if (o.type === 'statue') o.obj.getObjectByName('garland').visible = o === m?.o;
    }
  }

  /** Statues you come near are found — the ones that were standing out there, not those carved since. */
  lookForStatues() {
    for (const s of this.statues.near(this.player.pos, 10, this.found)) {
      this.found.add(s.id);
      if (!s.id.startsWith('w')) continue;
      const n = [...this.found].filter(id => id.startsWith('w')).length;
      this.hud.log(`You find a statue, standing alone — carved long ago. (${n} found)`, 'good');
    }
  }

  /**
   * Dead: you wake beside your statue, if you registered at one and it
   * still stands; if not, where you first came to.
   */
  respawn() {
    const mine = this.myStatue();
    if (mine?.o) {
      // Aboard, beside it — wherever the raft has got to.
      const o = mine.o, p = this.player;
      const at = this.raft.cellWorld(o.cx, o.cz);
      const side = this.raft.toWorld(o.cx * 2 + 0.7, o.cz * 2 + 0.5);
      p.pos.set(side.x, this.raft.deckY(side.x, side.z), side.z);
      p.state = 'deck'; p.onLand = false; p.vel.set(0, 0, 0); p.vy = 0;
      p.yaw = Math.atan2(-(side.x - at.x), -(side.z - at.z));
      this.hud.log('You black out, and wake on the deck beside your statue.', 'bad');
      return;
    }
    const s = mine?.s;
    if (s) {
      // In front of it, facing the way it faces.
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      this.player.standAt(s.x + fx * 1.4, s.z + fz * 1.4, s.yaw);
      this.hud.log('You black out, and wake beside your statue.', 'bad');
      return;
    }
    const st = this.start || { x: 0, z: 0, yaw: 0 };
    this.player.standAt(st.x, st.z, st.yaw);
    this.hud.log(this.registered ? 'You black out. Your statue is gone — you wake where you first came to.'
                                 : 'You black out, and wake where you first came to. A statue would bring you back nearer.', 'bad');
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
    this.markMine();
    this.hud.log('This statue is where you will wake, now, if you die.', 'good');
  }

  registerAboard(o) {
    this.registered = { raft: true, cx: o.cx, cz: o.cz, world: this.world };
    this.markMine();
    this.hud.log('This statue is where you will wake, now — aboard, wherever the raft is.', 'good');
  }

  // ── the paddle ─────────────────────────────────────────────────────────────
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
    let best = null, bestD = reach;
    const c = this._crewV ||= new THREE.Vector3();
    for (const r of this.net.remotes.values()) {
      if (!r.body.visible) continue;
      c.copy(r.pose.pos).y += r.pose.state === 'swim' ? 1.4 : 1.1;     // the chest (a swimmer's head)
      const along = c.clone().sub(eye).dot(dir);
      if (along < 0 || along > bestD) continue;
      const off = c.clone().sub(eye).addScaledVector(dir, -along).length();
      if (off < 0.55) { best = r; bestD = along; }
    }
    return best;
  }

  /** One of what is in hand, to someone else. */
  give(mate, id) {
    if (!this.net.connected || !this.inv.remove(id, 1)) return;
    this.net.event({ k: 'give', id }, mate.id);
    if (fishOf(id)) this.hotbar.refillFish(this.inv);
    this.body.gesture('toss');                    // handed over, underarm
    this.net.event({ k: 'g', g: 'toss' });
    this.hud.log(`You give ${mate.name} 1 ${ITEMS[id].name}.`, 'good');
    this.hud.refreshInventory(this.inv);
    this.hud.refreshHotbar(this.hotbar, this.inv);
  }

  /** Something the others did that is yours to deal with (net.js onEvent). */
  fromCrew(e, r) {
    if (e.k === 'give') {
      if (!ITEMS[e.id]) return true;
      this.inv.add(e.id, 1);
      this.hotbar.autoAssign(e.id);
      this.hud.log(`${r.name} gives you 1 ${ITEMS[e.id].name}.`, 'good');
      this.hud.refreshInventory(this.inv);
      this.hud.refreshHotbar(this.hotbar, this.inv);
      this.hud.refreshCraft(this.inv);
      return true;
    }
    if (e.k === 'caught') {
      const f = this.fish.fish[e.i];
      if (f && r.body.heldId === 'spear') r.body.skewer(this.fish.bodyFor(f));
      return true;
    }
    return false;
  }

  /** Where the end of your line is, if one is out: the rod's float, or the hook. [x, y, z, kind] */
  lineOut() {
    const f = this.fishing.float;
    if (f.visible) return [f.position.x, f.position.y, f.position.z, 0];
    const h = this.hook;
    if (h.state !== 'idle' && h.head.visible) return [h.head.position.x, h.head.position.y, h.head.position.z, 1];
    return null;
  }

  // ── what is under the crosshair ────────────────────────────────────────────
  /** @returns {{prompt:string, act:Function}|null} */
  findInteraction(eye, dir) {
    const reach = this.player.state === 'swim' ? 4.2 : 3.6;
    // Someone else, close enough to hand something to.
    const mate = this.crewAt(eye, dir, 3.2);
    if (mate) {
      const id = this.hotbar.held;
      if (id && this.inv.has(id)) {
        return { prompt: `<b>E</b> give ${ITEMS[id].name.toLowerCase()} to ${mate.name}`, act: () => this.give(mate, id) };
      }
      return { prompt: `${mate.name} — hold something to give it`, act: null };
    }
    const spear = this.spears.pick(eye, dir, reach);
    if (spear) {
      return { prompt: '<b>E</b> take your spear', act: () => this.retrieveSpear(spear) };
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
      return { prompt: mine ? 'Your statue — you wake here, aboard · <b>X</b> lift it' : '<b>E</b> make this where you wake · <b>X</b> lift it',
               act: mine ? null : () => this.registerAboard(piece.rec) };
    }
    const statue = this.statues.pick(eye, dir);
    if (statue) {
      const mine = this.myStatue()?.s === statue;
      return { prompt: mine ? 'Your statue — where you wake · <b>X</b> lift it' : '<b>E</b> make this where you wake · <b>X</b> lift it',
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

    const plant = this.terrain.pickPlant(eye, dir);
    if (plant) {
      return {
        prompt: `<b>E</b> harvest ${plant.sp.label}`,
        act: () => {
          const { label, yield: y } = this.terrain.harvest(plant);
          const parts = [];
          for (const id in y) {
            this.inv.add(id, y[id]);
            this.hotbar.autoAssign(id);
            parts.push(`${y[id]} ${ITEMS[id].name}`);
          }
          this.hud.log(`${label}: ${parts.join(', ')}`, 'good');
          this.hud.refreshInventory(this.inv);
          this.hud.refreshHotbar(this.hotbar, this.inv);
          this.hud.refreshCraft(this.inv);
        },
      };
    }

    const beast = this.wildlife.pick(eye, dir);
    if (beast) {
      const hunting = beast.state === 'hunt';
      const fleeing = beast.state === 'flee';
      return {
        prompt: beast.sp.diet === 'meat'
          ? `${beast.sp.label} — ${hunting ? 'it has your scent' : 'hunting'}`
          : `${beast.sp.label} — ${fleeing ? 'it is running from something' : 'grazing'}`,
        act: null,
      };
    }

    // A fish under the crosshair: say what would actually catch it from here.
    // The two reaches are the thrust's (the shaft ahead of the hand) and the
    // throw's (how far a spear stays fast enough to skewer) — offering a thrust at
    // a fish two metres out of reach is worse than saying nothing.
    const armed = this.hotbar.held === 'spear' && this.inv.has('spear');
    if (armed) {
      if (this.fish.pick(eye, dir, THRUST_REACH, 0.9)) {
        return { prompt: '<b>Click</b> to thrust', act: null };
      }
      if (this.fish.pick(eye, dir, this.player.submerged ? 3.7 : 9, 0.985)) {
        return { prompt: '<b>Right-click</b> to throw', act: null };
      }
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
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const input = this.input;
    const now = performance.now();

    if (this.paused) {
      // Paused, you stand still, but the others go on: they are still drawn,
      // and a host still keeps the shared raft in step.
      // Playing together, the sea's clock keeps going, paused or not, so
      // the others' seas are not held back by yours.
      if (this.net.connected) this.time = this.net.seaTime(this.time + dt, dt);
      this.net.update(dt, this.player, this.body.heldId, this.time, this.lineOut(), this.camera.position);
      this.together.update(dt);
      this.renderer.render(this.scene, this.camera);
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
    if (input.pressed('KeyH')) { this.pause(); return; }

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
    this.raft.update(dt, this.time, this.sky.night);
    // Standing on the raft — or in the air just off its deck — you go where it
    // goes, and turn as it turns. `drift` is how far that took you, which the
    // body and the view do not mistake for walking.
    const pl = this.player;
    pl.drift ||= new THREE.Vector3();
    pl.drift.set(0, 0, 0);
    if (pl.state !== 'swim' && !pl.onLand && this.raft.solidAtWorld(pl.pos.x, pl.pos.z)) {
      const x0 = pl.pos.x, z0 = pl.pos.z;
      pl.yaw += this.raft.carry(pl.pos);
      pl.drift.set(pl.pos.x - x0, 0, pl.pos.z - z0);
    }
    if (this.raft.aground && !this.wasAground && this.raft.speed > 0.05 && this.time - (this.groundedSaid ?? -99) > 10) {
      this.groundedSaid = this.time;
      this.hud.log('The raft grinds onto the bottom. Paddle it back off.', 'bad');
    }
    this.wasAground = this.raft.aground;
    if (this.paddleIn > 0) this.paddleIn -= dt;
    if ((this.lookIn = (this.lookIn ?? 0) - dt) <= 0) { this.lookIn = 0.5; this.lookForStatues(); this.markMine(); }
    this.updateFires(dt);
    this.player.update(dt, this.time, input, panelOpen);
    if (!panelOpen && input.pressed('KeyV')) this.cycleView();
    this.view.update(dt);
    this.ocean.update(this.time, this.camera.position);

    const eye = this.eye.position;
    const dir = this.player.forward(this.tmpDir);
    // Stream terrain around whoever is looking at it, then run the ecosystem.
    this.terrain.update(dt, this.player.pos, this.time);
    this.wildlife.setPlayerPos(this.player.pos);
    this.wildlife.update(dt, this.time, this.player,
                         this.player.state === 'deck' && this.player.onLand);
    this.debris.update(dt, this.time, this.player.pos);
    this.fish.update(dt, this.time, eye);      // the others it shies from too: sharedworld.js
    this.whale.update(dt, this.time);
    this.spears.update(dt, this.time);
    this.hook.update(dt, eye.clone().addScaledVector(dir, 0.5), this.time, this.debris,
                     it => this.gather(it));

    // Interaction
    let prompt = null;
    if (!panelOpen) {
      if (this.build.active) {
        prompt = this.build.update(eye, dir, input);
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
        // The bow drill is sawn, not clicked: the ember builds while the
        // button is held at an unlit fire, and cools if you stop.
        if (act?.drill && input.mouseDown(0)) {
          if (this.drill?.rec !== act.drill) this.drill = { rec: act.drill, p: 0 };
          this.drill.p += dt / FIRE.light;
          this.viewmodel.drilling = true;
          if (this.drill.p >= 1) this.lightFire(act.drill);
        } else {
          this.viewmodel.drilling = false;
          if (this.drill && (this.drill.p -= dt * 0.35) <= 0) this.drill = null;
        }
        if (act) {
          prompt = act.prompt;
          if (act.act && input.pressed('KeyE')) act.act();
        } else if (this.player.state === 'swim' && this.raft.nearestDeck(this.player.pos.x, this.player.pos.z, 2.1)) {
          prompt = '<b>Space</b> climb aboard';
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
      if (standing) {
        // Taken up again, to set up somewhere else.
        this.statues.remove(standing.id);
        this.together.world.statueDown(standing);
        this.inv.add('statue', 1);
        this.hotbar.autoAssign('statue');
        if (this.registered?.id === standing.id) this.registered = null;
        this.hud.log('You lift the statue. Carry it, and click to set it down somewhere else — on land, or on the raft.', 'good');
        this.hud.refreshInventory(this.inv);
      } else if (input.pressed('KeyX')) {
        this.ray.set(eye, dir);
        const r = this.build.salvage(this.ray);
        if (r?.blocked) this.hud.log(r.blocked, 'bad');
        else if (r) {
          this.together.took(r.piece);
          // A statue comes back to your hands (its "cost" is itself); yours no longer is.
          if (r.refund.statue && this.registered?.raft && !this.myStatue()) this.registered = null;
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

    // After underwater.update(), which has just dimmed the lights the tool
    // copies — so what is in your hand goes dark and blue with the world.
    const held = this.hotbar.held;
    this.viewmodel.update(dt, {
      drift: this.player.drift,
      held,
      owned: !!held && this.inv.has(held),
      hidden: held === 'hook' && this.hook.busy,     // it is out on the line
    });
    // The body, outside first person: where you are, holding what you hold.
    const outside = !this.view.first;
    this.body.visible = outside;
    const inHand = held && this.inv.has(held) && !(held === 'hook' && this.hook.busy)
      && !(held === 'spear' && !this.viewmodel.current) ? held : null;
    if (inHand !== this.body.heldId) this.body.hold(inHand, inHand ? this.viewmodel.cloneBody(inHand) : null);
    this.body.update(dt, this.player);
    this.net.update(dt, this.player, inHand, this.time, this.lineOut(), this.camera.position);
    if (this.net.connected && (this.crewIn = (this.crewIn ?? 0) - dt) <= 0) { this.crewIn = 0.5; this.refreshCrew?.(); }
    this.together.update(dt);
    if (this.pendingThrow != null && (this.pendingThrow -= dt) <= 0) {
      this.pendingThrow = null;
      this.launchSpear(eye, dir);
    }
    document.body.classList.toggle('view-second', this.view.mode === 'second');

    // After the viewmodel, so the line hangs from where the rod tip is now.
    this.fishing.update(dt, this.time, this.player, held === 'rod' && this.inv.has('rod'));
    for (const e of this.fishing.events.splice(0)) {
      if (e.catch) {
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
      this.hud.log(`Loaded ${u.key} model (${u.count} animals, ${u.clips} clips).`, 'good');
    }
    for (const id of this.viewmodel.upgraded.splice(0)) {
      this.hud.log(`Loaded ${ITEMS[id].name.toLowerCase()} model.`, 'good');
    }
    for (const u of this.fish.upgraded.splice(0)) {
      this.viewmodel.dropFishBodies();      // a fish in hand was the stand-in body
      this.hud.log(`Loaded sea life models (${u.meshes} bodies).`, 'good');
    }
    for (const k of this.wildlife.kills.splice(0)) {
      this.together.world.killed(k);
      if (k.pos.distanceTo(this.player.pos) < 150) {
        this.hud.log(`A ${k.hunter} brings down a ${k.victim}.`);
      }
    }
    if (bites.length && this.time > this.lastBite + 0.8) {
      this.lastBite = this.time;
      const worst = bites.reduce((a, b) => (b.damage > a.damage ? b : a));
      this.player.health = Math.max(0, this.player.health - worst.damage);
      this.hud.log(`The ${worst.label} tears into you.`, 'bad');
    }

    this.hud.updateVitals(this.player);
    this.hud.updateClock(this.sky, this.player, this.raft);
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

    this.renderer.render(this.scene, this.camera);
    if (this.view.first) this.viewmodel.render();
    input.endFrame();
  }

  checkGoals() {
    for (const g of GOALS) {
      if (this.goalsDone.has(g.id)) continue;
      if (g.test(this)) { this.goalsDone.add(g.id); this.hud.log(g.text); }
    }
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
  save() {
    if (this.wiped) return;
    try {
      // Thrown spears are not saved where they lie; count them as carried,
      // so reloading never costs you one — and the fish on them, and a fish
      // on the hook as bait, as fish in the bag, each its own species.
      const inv = this.inv.toJSON();
      const bag = (id, n = 1) => { if (ITEMS[id]) inv[id] = (inv[id] || 0) + n; };
      if (this.spears.count) bag('spear', this.spears.count);
      for (const s of this.spears.list) for (const f of s.catch) bag(fishItem(f.key));
      // Fish on a spit are not saved hanging there: they go in the bag, cooked
      // if they were done.
      // On someone else's raft, it is your own that is saved (together.js),
      // and the fish on their fires are theirs.
      const guest = this.together.guest;
      if (!guest) for (const o of this.raft.objs.values()) for (const f of o.spitFish || []) bag(f.t >= FIRE.cook ? f.done : f.raw);
      if (this.fishing.bait && this.baitId) bag(this.baitId);
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        raft: guest ? this.together.own : this.raft.toJSON(),
        // Your statues are your world's; on someone else's, theirs are put by with your raft.
        statues: guest ? this.together.ownStatues : this.statues.toJSON(),
        start: this.start,
        registered: this.registered,
        found: [...this.found],
        scattered: true,
        inv,
        hotbar: this.hotbar.toJSON(),
        player: this.player.toJSON(),
        view: this.view.mode,
        character: this.character,
        // On someone else's raft, the time of day is theirs; yours is put by.
        time: this.together.world.ownSky?.[0] ?? this.sky.time,
        day: this.together.world.ownSky?.[1] ?? this.sky.day,
        goals: [...this.goalsDone],
      }));
    } catch { /* storage full or blocked — not worth interrupting play */ }
  }

  loadSave() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return false; }
    // A save with no raft is still a save, if it knows where you started
    // (washed up on a beach, say, with nothing built yet).
    if (!d || (!d.raft?.cells?.length && !d.start)) return false;
    this.raft.load(d.raft || {});
    // Before starts were chosen, everyone started on the raft, here.
    this.start = d.start || { kind: 'raft', x: 0, z: 0, yaw: 0 };
    this.statues.load(d.statues);
    // A save from before statues stood about the land gets them now.
    if (!d.scattered) for (const s of scatter()) this.statues.add(s);
    this.registered = d.registered || null;
    this.found = new Set(d.found || []);
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
    if (was && was !== 'deck' && Array.isArray(pos)) this.player.standAt(pos[0], pos[2], d.player.yaw);
    else if (this.raft.size) this.player.respawnOnRaft();
    else this.player.standAt(this.start.x, this.start.z, this.start.yaw);
    this.sky.time = d.time ?? this.sky.time;
    this.sky.day = d.day ?? 1;
    for (const g of d.goals || []) this.goalsDone.add(g);
    if (d.view) this.view.set(d.view);
    if (d.character) this.character = d.character;
    return true;
  }
}

new Game();
