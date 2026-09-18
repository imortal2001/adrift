// ── Adrift ───────────────────────────────────────────────────────────────────
// Ocean raft survival prototype. Gather → craft → build → upgrade the raft.

import * as THREE from 'three';
import { Ocean, waveHeight } from './ocean.js';
import { Sky } from './sky.js';
import { Raft } from './raft.js';
import { DebrisField } from './debris.js';
import { Hook } from './hook.js';
import { FishSchools } from './fish.js';
import { Underwater } from './underwater.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { BuildMode } from './build.js';
import { Inventory, RECIPES, ITEMS, DEBRIS_KINDS } from './items.js';
import { Hotbar, SLOTS } from './hotbar.js';

const SAVE_KEY = 'adrift.save.v2';

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
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 1400);

    this.ocean = new Ocean(this.scene);
    this.sky = new Sky(this.scene, this.ocean);
    this.raft = new Raft(this.scene);
    this.inv = new Inventory();
    this.hotbar = new Hotbar();
    this.player = new Player(this.camera, this.raft);
    this.debris = new DebrisField(this.scene, this.raft);
    this.fish = new FishSchools(this.scene);
    this.underwater = new Underwater(this.scene);
    this.hook = new Hook(this.scene);
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
      this.raft.startingRaft();
      this.player.respawnOnRaft();
      this.hud.log('You come to on a raft of four lashed pallets. No land in sight.');
      this.hud.log('Debris drifts past on the current. Look at it and press E.');
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
    this.ocean.update(this.time, this.camera.position);

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
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    addEventListener('beforeunload', () => this.save());
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

  eat() {
    if (!this.inv.remove('coconut', 1)) return;
    this.player.hunger = Math.min(100, this.player.hunger + 26);
    this.player.thirst = Math.min(100, this.player.thirst + 11);
    this.hud.log('You crack the coconut open. Milk and flesh.', 'good');
    this.hud.refreshInventory(this.inv);
  }

  gather(it) {
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
        else this.hook.throwFrom(eye.clone().addScaledVector(dir, 0.5), dir.clone());
        break;
      case 'eat':
        this.eat();
        break;
      case 'spear':
        this.hud.log('Nothing to spear yet — fish are still too quick.', 'bad');
        break;
      case 'rod':
        this.hud.log('Fishing is not built yet.', 'bad');
        break;
      default:
        this.hud.log(`${ITEMS[id].name} is raw material — nothing to do with it in hand.`);
    }
  }

  // ── what is under the crosshair ────────────────────────────────────────────
  /** @returns {{prompt:string, act:Function}|null} */
  findInteraction(eye, dir) {
    const it = this.debris.pick(eye, dir, this.player.state === 'swim' ? 4.2 : 3.6);
    if (it) {
      return { prompt: `<b>E</b> gather ${DEBRIS_KINDS[it.kind].label}`, act: () => this.gather(it) };
    }
    this.ray.set(eye, dir);
    this.ray.far = 4.2;
    const hits = this.ray.intersectObjects(this.raft.pickables, false);
    this.ray.far = Infinity;
    const piece = hits[0]?.object.userData.piece;
    if (piece?.id === 'collector') {
      const c = piece.rec;
      if (c.water >= 1) {
        return {
          prompt: `<b>E</b> drink (${Math.floor(c.water)} left)`,
          act: () => {
            c.water -= 1;
            this.raft.refreshCollector(c);
            this.player.thirst = Math.min(100, this.player.thirst + 32);
            this.hud.log('Cool rainwater. That buys you time.', 'good');
          },
        };
      }
      return { prompt: `Collector is filling (${Math.round(c.water / c.capacity * 100)}%)`, act: null };
    }
    if (piece?.id === 'campfire') return { prompt: 'The fire holds the dark back', act: null };

    // Fish are ambient for now; the prompt points at what a spear is for.
    if (this.fish.pick(eye, dir, 3.0)) {
      return { prompt: 'Too quick to catch by hand — you need a spear', act: null };
    }
    return null;
  }

  // ── frame ──────────────────────────────────────────────────────────────────
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const input = this.input;
    const now = performance.now();

    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      input.endFrame();
      return;
    }

    this.time += dt;
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

    if (!panelOpen && input.pressed('KeyQ')) {
      if (this.inv.count('coconut') > 0) this.eat();
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
    this.sky.update(dt, this.raft.group.position);
    this.raft.update(dt, this.time, this.sky.night);
    this.player.update(dt, this.time, input, panelOpen);
    this.ocean.update(this.time, this.camera.position);

    const eye = this.camera.position;
    const dir = this.player.forward(this.tmpDir);
    this.debris.update(dt, this.time, this.player.pos);
    this.fish.update(dt, this.time, eye);
    this.hook.update(dt, eye.clone().addScaledVector(dir, 0.5), this.time, this.debris,
                     it => this.gather(it));

    // Interaction
    let prompt = null;
    if (!panelOpen) {
      if (this.build.active) {
        prompt = this.build.update(eye, dir, input);
        if (input.clicked(0)) {
          const placed = this.build.place();
          if (placed) {
            this.hud.log(`${placed.name} built.`, 'good');
            this.hud.refreshInventory(this.inv);
            this.hud.refreshCraft(this.inv);
          }
        }
      } else {
        const act = this.findInteraction(eye, dir);
        if (act) {
          prompt = act.prompt;
          if (act.act && input.pressed('KeyE')) act.act();
        } else if (this.player.state === 'swim' && this.raft.nearestDeck(this.player.pos.x, this.player.pos.z, 2.1)) {
          prompt = '<b>Space</b> climb aboard';
        } else if (now < this.slotHintUntil) {
          const id = this.hotbar.held;
          if (id && this.inv.has(id) && ITEMS[id].hint) {
            prompt = ITEMS[id].hint.replace('Click', '<b>Click</b>');
          }
        }
        if (input.clicked(0)) this.useHeld(eye, dir);
      }

      // Salvage works whether or not build mode is on.
      if (input.pressed('KeyX')) {
        this.ray.set(eye, dir);
        const r = this.build.salvage(this.ray);
        if (r?.blocked) this.hud.log(r.blocked, 'bad');
        else if (r) {
          this.hud.log(`Salvaged ${r.name}.`, 'good');
          this.hud.refreshInventory(this.inv);
        }
      }

      // Right-click stays a shortcut for the hook, when it is the thing in hand.
      if (input.clicked(2)) {
        if (this.hotbar.held === 'hook') this.useHeld(eye, dir);
        else if (this.inv.has('hook')) this.hud.log('Select the hook slot first.', 'bad');
        else this.hud.log('You have nothing to throw. Craft a hook.', 'bad');
      }
    }
    this.hud.setPrompt(prompt);
    // A visible cursor sliding around mid-look is a distraction; panels get it back.
    document.body.classList.toggle('freelook', input.allowLook && !this.cursorPanel);

    // Underwater look & feel — colour, light and motes all fall off with depth.
    const surface = waveHeight(eye.x, eye.z, this.time);
    const submerged = eye.y < surface;
    const depth = Math.max(0, surface - eye.y);
    const light = this.underwater.update(dt, eye, submerged, depth, this.sky,
                                         this.scene, this.sky.night);
    this.hud.setUnderwater(submerged, submerged ? 1 - light : 0);
    if (submerged && this.player.breath < 30 && !this._gasping) {
      this._gasping = true;
      this.hud.log('Your chest is burning. Get to the surface.', 'bad');
    } else if (this.player.breath > 60) {
      this._gasping = false;
    }

    // HUD
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
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        raft: this.raft.toJSON(),
        inv: this.inv.toJSON(),
        hotbar: this.hotbar.toJSON(),
        player: this.player.toJSON(),
        time: this.sky.time,
        day: this.sky.day,
        goals: [...this.goalsDone],
      }));
    } catch { /* storage full or blocked — not worth interrupting play */ }
  }

  loadSave() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return false; }
    if (!d?.raft?.cells?.length) return false;
    this.raft.load(d.raft);
    this.inv = Inventory.fromJSON(d.inv || {});
    this.hotbar = Hotbar.fromJSON(d.hotbar);
    this.build.inv = this.inv;
    this.player.load(d.player);
    this.player.respawnOnRaft();
    this.sky.time = d.time ?? this.sky.time;
    this.sky.day = d.day ?? 1;
    for (const g of d.goals || []) this.goalsDone.add(g);
    return true;
  }
}

new Game();
