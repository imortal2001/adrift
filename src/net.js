// ── Playing together ─────────────────────────────────────────────────────────
// Invite-link co-op: one player hosts, the others open the link, and each
// sees the rest — where they are, which way they face, walking, swimming,
// what they hold and what they do with it — as a character of their own
// (body.js), with a name over their head.
//
// Nothing here runs the game for anyone else. A relay (server/: a Cloudflare
// Worker, or server/dev-relay.mjs on this machine) keeps the players in a
// room and passes their messages on; each browser draws the others from what
// it hears. The world they stand in is the same world — the land, the reef,
// the raft's place — because every copy of the game builds it the same way.
// The raft itself is the host's, shared (together.js); what floats past, the
// fish, the dinosaurs and the time of day are still each player's own.

import * as THREE from 'three';
import { PlayerBody } from './body.js';
import { waveHeight } from './ocean.js';
import { WORLD } from './together.js';

// Where the relay is. On this machine, the local stand-in; on the published
// game, the Worker you deployed — set this to its address (server/README.md).
const DEPLOYED_RELAY = 'wss://adrift-relay.kan0-adrift.workers.dev';
const LOCAL = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
export const RELAY = LOCAL ? `ws://${location.hostname}:8787` : DEPLOYED_RELAY;

const SEND_HZ = 12;            // your state, this many times a second
const BEHIND = 0.12;           // others are drawn this far in the past, to interpolate
const IDLE_SEND = 1.0;         // and resent this often even when nothing changed
const SLEW = 1.5;              // a sea behind closes this much of the gap a second…
const JUMP = 1.5;              // …or jumps, if it is this many seconds behind
const NEAR = 0.2;              // and within this, it is the same sea

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';       // no I, O, 0, 1
export function newCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_LETTERS[(Math.random() * CODE_LETTERS.length) | 0];
  return s;
}
export const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** A name floating over someone's head: a sprite of canvas text. */
function nameTag(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 44px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w; c.height = 72;
  ctx.font = font;
  ctx.fillStyle = 'rgba(12,20,28,0.55)';
  const r = 30;
  ctx.beginPath(); ctx.roundRect(0, 6, w, 60, r); ctx.fill();
  ctx.fillStyle = '#f4efe2';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 37);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(0.32 * w / 72, 0.32, 1);
  s.renderOrder = 5;
  return s;
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Another player, as this browser draws them. */
class Remote {
  constructor(net, id, name, who) {
    this.net = net;
    this.id = id;
    this.name = name;
    this.body = new PlayerBody(net.scene);
    this.body.wear(who, net.library);
    this.who = who;
    this.tag = nameTag(name);
    net.scene.add(this.tag);
    this.snaps = [];          // [{at, s}] as they arrive
    this.held = undefined;
    this.pose = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, state: 'deck', onLand: false };
    this.seen = false;
    this.clock = null;        // their sea's clock, as last heard: {c, at}
  }

  hear(s) {
    if (!s || !Array.isArray(s.p)) return;
    if (typeof s.c === 'number') this.clock = { c: s.c, at: performance.now() / 1000 };
    this.snaps.push({ at: performance.now() / 1000, s });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  update(dt) {
    const now = performance.now() / 1000 - BEHIND;
    const q = this.snaps;
    if (!q.length) { this.body.visible = false; this.tag.visible = false; return; }
    // The two snapshots either side of "now", interpolated; past the last,
    // hold it (a player gone quiet stands still rather than sliding on).
    let a = q[0], b = q[q.length - 1];
    for (let i = q.length - 1; i > 0; i--) {
      if (q[i - 1].at <= now) { a = q[i - 1]; b = q[i]; break; }
    }
    const k = b.at > a.at ? THREE.MathUtils.clamp((now - a.at) / (b.at - a.at), 0, 1) : 1;
    const p = this.pose;
    const x = a.s.p[0] + (b.s.p[0] - a.s.p[0]) * k, z = a.s.p[2] + (b.s.p[2] - a.s.p[2]) * k;
    // Each height as it stands here before the two are blended, so one on
    // the deck and the next in the water (climbing out, jumping in) blend as
    // heights, not as a height above the deck and one above the sea.
    const ya = this.height(a.s, x, z), yb = this.height(b.s, x, z);
    p.pos.set(x, ya + (yb - ya) * k, z);
    p.yaw = lerpAngle(a.s.y || 0, b.s.y || 0, k);
    p.pitch = (a.s.pi || 0) + ((b.s.pi || 0) - (a.s.pi || 0)) * k;
    p.state = { d: 'deck', a: 'air', s: 'swim' }[b.s.st] || 'deck';
    // Head under here, they are swimming under water (body.js swims that differently).
    p.submerged = p.state === 'swim' && p.pos.y + 1.62 < waveHeight(x, z, this.net.time);
    // Only a sudden leap (they respawned, or climbed aboard) is not smoothed.
    if (!this.seen) { this.body.lastPos.copy(p.pos); this.seen = true; }
    const held = b.s.h || null;
    if (held !== this.held) {
      this.held = held;
      this.body.hold(held, held ? this.net.cloneHeld(held) : null);
    }
    this.body.visible = true;
    this.body.update(dt, p);
    this.tag.visible = true;
    this.tag.position.set(p.pos.x, p.pos.y + 2.05, p.pos.z);
  }

  /**
   * A sent height, here. On the raft it was sent above the deck (r 1), in the
   * water above the sea (r 2): the deck and the sea are where this machine
   * has them now, which is not quite where theirs had them — the host's
   * shared clock (Net.seaTime) keeps the two seas close, not exact, and a height
   * drawn a moment behind would otherwise be a moment's swell out.
   */
  height(s, x, z) {
    if (s.r === 1) return s.p[1] + this.net.raft.deckY(x, z);
    if (s.r === 2) return s.p[1] + waveHeight(x, z, this.net.time);
    return s.p[1];
  }

  event(e) {
    if (e.k === 'g') this.body.gesture(e.g);
    else if (e.k === 'name' && e.name && e.name !== this.name) {
      this.net.log(`${this.name} is now ${e.name}.`);
      this.name = e.name;
      this.dropTag();
      this.tag = nameTag(e.name);
      this.net.scene.add(this.tag);
      this.net.onChange();
    }
    else if (e.k === 'who' && e.who !== this.who) {
      this.who = e.who;
      this.body.wear(e.who, this.net.library);
    }
  }

  dispose() {
    this.body.hold(null, null);
    this.body.group.removeFromParent();
    this.dropTag();
  }

  dropTag() {
    this.tag.removeFromParent();
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}

export class Net {
  /**
   * @param scene     where others are drawn
   * @param library   the ModelLibrary, for their characters
   * @param cloneHeld (id) => a copy of an item's body, for their hands
   * @param log       (text, kind) => a line in the message log
   * @param raft      the raft, which others stand on
   * @param together  the shared raft (together.js): told of arrivals, and of world events
   */
  constructor({ scene, library, cloneHeld, log, raft, together }) {
    this.scene = scene;
    this.raft = raft;
    this.together = together;
    this.library = library;
    this.cloneHeld = cloneHeld;
    this.log = log;
    this.ws = null;
    this.code = null;
    this.id = null;
    this.host = null;
    this.remotes = new Map();
    this.sendIn = 0;
    this.idle = 0;
    this.last = '';
    this.time = 0;              // this machine's sea clock (main.js's time)
    this.status = RELAY ? 'Not in a game' : 'Playing together is not set up on this server yet';
    this.onChange = () => {};
  }

  get available() { return !!RELAY; }
  get connected() { return !!this.ws && this.ws.readyState === 1 && this.id !== null; }
  get isHost() { return this.connected && this.id === this.host; }
  get invite() { return this.code ? `${location.origin}${location.pathname}?room=${this.code}` : ''; }

  /** Join (or, with a new code, host) a room. */
  join(code, name, who) {
    if (!RELAY) return;
    this.leave(true);
    this.code = cleanCode(code);
    this.name = name;
    this.who = who;
    this.status = `Connecting to ${this.code}…`;
    this.onChange();
    const ws = new WebSocket(`${RELAY}/room/${this.code}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, who }));
    ws.onmessage = e => this.hear(e.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.connected || this.id !== null;
      this.clear();
      this.ws = null;
      this.together?.exit();
      this.status = was ? `Lost the connection to ${this.code}` : `Could not reach the relay`;
      this.onChange();
    };
  }

  leave(quiet = false) {
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.clear();
    this.together?.exit();
    if (!quiet) { this.code = null; this.status = 'Not in a game'; this.onChange(); }
  }

  clear() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.id = null;
    this.host = null;
  }

  hear(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'welcome') {
      this.id = m.id;
      this.host = m.host;
      for (const p of m.peers) this.add(p);
      this.status = `In game ${this.code}`;
      this.together?.enter(this.isHost);
      this.log(this.remotes.size ? `You join ${this.code}: ${[...this.remotes.values()].map(r => r.name).join(', ')} ${this.remotes.size === 1 ? 'is' : 'are'} here.`
                                 : `You are hosting ${this.code}. Share the invite link.`, 'good');
      this.onChange();
    } else if (m.t === 'join') {
      this.add(m);
      this.together?.joined(m.id);
      this.log(`${m.name} comes aboard.`, 'good');
      this.onChange();
    } else if (m.t === 'leave') {
      const r = this.remotes.get(m.id);
      if (r) { this.log(`${r.name} has gone.`); r.dispose(); this.remotes.delete(m.id); this.onChange(); }
    } else if (m.t === 'state') {
      this.remotes.get(m.id)?.hear(m.s);
    } else if (m.t === 'ev' && m.e) {
      if (WORLD.has(m.e.k)) this.together?.hear(m.e, m.id);
      else this.remotes.get(m.id)?.event(m.e);
    } else if (m.t === 'host') {
      this.host = m.id;
      if (m.id === this.id) this.log('You are the host now.');
      this.onChange();
    } else if (m.t === 'full') {
      this.status = `${this.code} is full`;
      this.onChange();
    }
  }

  add(p) {
    if (this.remotes.has(p.id)) return;
    const r = new Remote(this, p.id, p.name, p.who);
    if (p.s) r.hear(p.s);
    this.remotes.set(p.id, r);
  }

  /** Go by another name, in the game you are in (or the next you join). */
  rename(name) {
    if (!name || name === this.name) return;
    this.name = name;
    this.event({ k: 'name', name });
    this.onChange();
  }

  /** Tell the others something happened: {k:'g', g:'thrust'}, {k:'who', who} — or, with `to`, one of them. */
  event(e, to) {
    if (this.connected) this.ws.send(JSON.stringify(to === undefined ? { t: 'ev', e } : { t: 'ev', e, to }));
  }

  /**
   * The sea's clock. Every machine's waves come from the time it has been
   * running (ocean.js), so on its own each has a different sea — the raft
   * riding a different swell, a swimmer on a different wave. Playing
   * together, everyone's goes with whoever's is furthest on: a clock behind
   * is eased up to it, or jumped if far behind. Only ever forward — the same
   * clock times the game's cooldowns and saves, which a clock going back
   * would stall. (Heard clocks are a moment old, so they are never ahead of
   * the truth and two equal seas do not push each other on.)
   */
  seaTime(time, dt) {
    if (!this.connected) return time;
    const now = performance.now() / 1000;
    let want = -Infinity;
    for (const r of this.remotes.values()) if (r.clock) want = Math.max(want, r.clock.c + now - r.clock.at);
    const gap = want - time;
    if (!(gap > NEAR)) return time;
    return gap > JUMP ? want : time + gap * Math.min(1, dt * SLEW);
  }

  /**
   * Each frame: send where you are (at SEND_HZ, and only when it changed,
   * or now and then so a newcomer sees you), and draw the others. `time`
   * is the sea's clock; the host's goes with what it sends.
   */
  update(dt, player, held, time) {
    this.time = time;
    for (const r of this.remotes.values()) r.update(dt);
    if (!this.connected) return;
    this.sendIn -= dt;
    this.idle += dt;
    if (this.sendIn > 0) return;
    this.sendIn = 1 / SEND_HZ;
    const r2 = v => Math.round(v * 100) / 100;
    const { x, y, z } = player.pos;
    // Over the raft, out of the water, height is sent above the deck; in the
    // water, above the sea (see Remote.height).
    const swim = player.state === 'swim';
    const deck = !swim && !player.onLand && this.raft.solidAtWorld(x, z);
    const h = deck ? y - this.raft.deckY(x, z) : swim ? y - waveHeight(x, z, time) : y;
    const s = { p: [r2(x), r2(h), r2(z)],
                y: Math.round(player.yaw * 1000) / 1000, pi: Math.round(player.pitch * 100) / 100,
                st: { deck: 'd', air: 'a', swim: 's' }[player.state] || 'd', h: held || null };
    if (deck) s.r = 1;
    else if (swim) s.r = 2;
    const text = JSON.stringify({ t: 'state', s });
    if (text === this.last && this.idle < IDLE_SEND) return;
    this.last = text;
    this.idle = 0;
    // The sea's clock rides along, but does not count as a change.
    this.ws.send(JSON.stringify({ t: 'state', s: { ...s, c: Math.round(time * 100) / 100 } }));
  }

  /** Names in the game, you first. */
  crew() {
    if (!this.connected) return [];
    const mark = id => (id === this.host ? ' (host)' : '');
    return [`${this.name}${mark(this.id)} — you`, ...[...this.remotes.values()].map(r => `${r.name}${mark(r.id)}`)];
  }
}
