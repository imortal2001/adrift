// ── The world, shared ────────────────────────────────────────────────────────
// Playing together, the raft is the host's (together.js), and so is the rest
// of the world: the time of day, what floats past, where the fish schools
// are, the whale, and the dinosaurs. The host's game runs them all, as it
// would alone, and a few times a second tells the others how they stand; the
// others' games take that on and carry it forward until the next word.
//
// How much each takes on differs. The dinosaurs are the host's alone: a
// guest's stop thinking and are drawn where the host says, going the way it
// says, so a hunt is one hunt — and when one bites a guest, the host tells
// that guest. The whale, the fish schools and the flotsam go on moving on
// every machine (they follow the same currents and the same sea clock) and
// are eased back onto the host's. A school's fish are each machine's own,
// swimming round it and shying from whichever of you is nearest; a fish
// someone takes is gone for everyone. A spear someone throws flies on every
// machine — what it catches, the thrower's game says.
//
// A guest's own time of day is put by with their raft, and comes back with it.

import * as THREE from 'three';
import { ThrownSpears } from './spear.js';
import { DAY_SECONDS } from './sky.js';

const EVERY = 1 / 3;           // the host tells the others how things stand this often…
const SLOW = 3;                // …and where the flotsam and the fish schools are, every this many

export const WORLD_EVENTS = ['world', 'gather', 'fish', 'spear', 'sk', 'spearBack', 'bite', 'kill', 'spears'];

export class SharedWorld {
  constructor(game) {
    this.game = game;
    this.in = 0;
    this.beat = 0;
    this.ownSky = null;         // [time, day]: yours, put by while you keep the host's
    this.following = false;
    this.ghosts = null;         // the others' thrown spears (spear.js, ghost)
    this.thrown = new Map();    // "player:spear" -> a ghost spear
    this._eyes = [];
  }

  get net() { return this.game.net; }

  // ── coming and going ───────────────────────────────────────────────────────
  enter(host) {
    const g = this.game;
    g.fish.onTake = i => this.send({ k: 'fish', i });
    g.spears.onSkewer = (s, i) => this.send({ k: 'sk', s: s.id, i });
    if (!host && !this.ownSky) this.ownSky = [g.sky.time, g.sky.day];
  }

  exit() {
    const g = this.game;
    this.follow(false);
    if (this.ownSky) { [g.sky.time, g.sky.day] = this.ownSky; this.ownSky = null; }
    for (const s of this.thrown.values()) this.ghosts.drop(s);
    this.thrown.clear();
    g.fish.others.length = 0;
    g.wildlife.others.length = 0;
  }

  /** Hosting now (the host left): the world is this game's to run. */
  hosting() { this.follow(false); }

  /**
   * Someone arrived: your spears already out in the world — stuck in the
   * sand, in the deck, floating, still on their way — go to them, with what
   * is on them.
   */
  joined(id) {
    const list = this.game.spears.list.map(s => {
      const p = s.body.getWorldPosition(new THREE.Vector3());
      const a = new THREE.Vector3(0, 1, 0).applyQuaternion(s.body.getWorldQuaternion(new THREE.Quaternion()));
      const r = v => Math.round(v * 1000) / 1000;
      return { s: s.id, p: p.toArray().map(r), a: a.toArray().map(r), w: s.where, st: s.state,
               v: s.vel.toArray().map(r), f: s.catch.map(f => f.key) };
    });
    if (list.length) this.net.event({ k: 'spears', list }, id);
  }

  /** A kill the host's animals made: news to everyone. */
  killed(k) { if (this.net.isHost) this.send({ k: 'kill', h: k.hunter, v: k.victim, p: [Math.round(k.pos.x), Math.round(k.pos.z)] }); }

  /** Someone left: their spears go with them. */
  left(id) {
    for (const [k, s] of this.thrown) {
      if (k.startsWith(`${id}:`)) { this.ghosts.drop(s); this.thrown.delete(k); }
    }
  }

  follow(on) {
    const g = this.game;
    this.following = on;
    g.wildlife.follow = on;
    g.fish.follow = on;
  }

  send(e) { if (this.net.connected) this.net.event(e); }

  // ── what you do ────────────────────────────────────────────────────────────
  gathered(it) { this.send({ k: 'gather', i: this.game.debris.items.indexOf(it) }); }

  threw(s, from, dir, underwater, loft) {
    const r = v => Math.round(v * 1000) / 1000;
    this.send({ k: 'spear', s: s.id, p: from.toArray().map(r), d: dir.toArray().map(r), u: underwater ? 1 : 0, l: loft ? 1 : 0 });
  }

  tookBack(s) { this.send({ k: 'spearBack', s: s.id }); }

  // ── what the others do ─────────────────────────────────────────────────────
  hear(e, from) {
    const g = this.game;
    if (e.k === 'world') {
      if (this.net.isHost) return;
      if (!this.following) this.follow(true);
      if (Array.isArray(e.sky)) this.setSky(e.sky);
      if (e.b) g.wildlife.adopt(e.b);
      if (e.w) g.whale.adopt(e.w);
      if (e.f) g.fish.setSchools(e.f);
      if (e.d) g.debris.adopt(e.d);
    } else if (e.k === 'gather') {
      const it = g.debris.items[e.i];
      if (it && !it.held) g.debris.harvest(it);
    } else if (e.k === 'fish') {
      const f = g.fish.fish[e.i];
      if (f && !(f.caught > 0)) g.fish.take(f, true);
    } else if (e.k === 'spear' && Array.isArray(e.p) && Array.isArray(e.d)) {
      this.ghosts ||= new ThrownSpears(g.scene, g.terrain, g.raft, g.fish, g.spears.makeBody, true);
      const s = this.ghosts.throw(new THREE.Vector3(...e.p), new THREE.Vector3(...e.d).normalize(), !!e.u, !!e.l);
      this.thrown.set(`${from}:${e.s}`, s);
    } else if (e.k === 'sk') {
      const s = this.thrown.get(`${from}:${e.s}`), f = g.fish.fish[e.i];
      if (!f) return;
      if (!(f.caught > 0)) g.fish.take(f, true);
      if (s) this.ghosts.skewer(s, g.fish.bodyFor(f));
    } else if (e.k === 'spearBack') {
      const k = `${from}:${e.s}`;
      this.ghosts?.drop(this.thrown.get(k));
      this.thrown.delete(k);
    } else if (e.k === 'spears' && Array.isArray(e.list)) {
      this.ghosts ||= new ThrownSpears(g.scene, g.terrain, g.raft, g.fish, g.spears.makeBody, true);
      for (const t of e.list) {
        if (!Array.isArray(t.p) || !Array.isArray(t.a) || this.thrown.has(`${from}:${t.s}`)) continue;
        const s = this.ghosts.throw(new THREE.Vector3(...t.p), new THREE.Vector3(...t.a).normalize(), false, false);
        const flying = t.st === 'flying' && Array.isArray(t.v);
        if (flying) s.vel.set(...t.v); else s.vel.set(0, 0, 0);
        s.state = flying ? 'flying' : t.st === 'floating' ? 'floating' : 'stuck';
        s.where = t.w;
        this.ghosts.place(s);
        if (t.w === 'deck') g.raft.group.attach(s.body);
        for (const key of t.f || []) {
          const sp = g.fish.species(key);
          const body = sp && g.fish.displayBody(key, (sp.length[0] + sp.length[1]) / 2);
          if (body) this.ghosts.skewer(s, body);
        }
        this.thrown.set(`${from}:${t.s}`, s);
      }
    } else if (e.k === 'kill' && Array.isArray(e.p)) {
      if (this.net.isHost) return;
      g.wildlife.kills.push({ hunter: String(e.h), victim: String(e.v), pos: new THREE.Vector3(e.p[0], g.player.pos.y, e.p[1]) });
    } else if (e.k === 'bite' && typeof e.damage === 'number') {
      g.wildlife.events.push({ damage: Math.min(60, e.damage), label: String(e.label || 'animal') });
    }
  }

  /** The host's time of day: eased to if close, taken if not. */
  setSky([time, day]) {
    const sky = this.game.sky;
    const gap = (day * DAY_SECONDS + time) - (sky.day * DAY_SECONDS + sky.time);
    if (Math.abs(gap) > 5) { sky.time = time; sky.day = day; }
    else {
      sky.time += gap * 0.5;
      if (sky.time >= DAY_SECONDS) { sky.time -= DAY_SECONDS; sky.day++; }
      else if (sky.time < 0) { sky.time += DAY_SECONDS; sky.day--; }
    }
  }

  // ── each frame ─────────────────────────────────────────────────────────────
  update(dt) {
    const g = this.game, net = this.net;
    this.ghosts?.update(dt, g.time);
    if (!net.connected) return;

    // Who the fish shy from, and — on the host — who the dinosaurs can hunt.
    const eyes = this._eyes, others = [];
    let n = 0;
    for (const r of net.remotes.values()) {
      if (!r.body.visible) continue;
      const e = eyes[n] ||= new THREE.Vector3();
      e.copy(r.pose.pos).y += 1.62;
      n++;
      others.push({ id: r.id, pos: r.pose.pos, onLand: !!r.pose.onLand });
    }
    eyes.length = n;
    g.fish.others = eyes;
    g.wildlife.others = net.isHost ? others : [];

    if (!net.isHost || !net.remotes.size) return;
    if ((this.in -= dt) > 0) return;
    this.in = EVERY;
    const e = { k: 'world', sky: [Math.round(g.sky.time * 10) / 10, g.sky.day],
                b: g.wildlife.snapshot(), w: g.whale.snapshot() };
    if (this.beat++ % SLOW === 0) { e.f = g.fish.schoolState(); e.d = g.debris.snapshot(); }
    net.event(e);
  }
}
