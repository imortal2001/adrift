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
// What changes in it is the host's, shared: the raft (together.js), and the
// time of day, the flotsam, the fish, the whale and the dinosaurs
// (sharedworld.js).

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

const GIVE_UP = 45;            // seconds of trying to reconnect before going back to your own raft
const LAST_ROOM = 3 * 3600e3;  // a game you were in this recently can be rejoined from the splash
const SAY = 140;               // characters of something said
const CHATTY = 0.7;            // seconds between one thing said and the next

// Who you are to the relay across a dropped connection (and a reload of the
// page): the same in this tab, different in the next.
const TOKEN = (() => {
  try {
    let t = sessionStorage.getItem('adrift.tok');
    if (!t) sessionStorage.setItem('adrift.tok', t = Math.random().toString(36).slice(2, 14));
    return t;
  } catch { return Math.random().toString(36).slice(2, 14); }
})();
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } },
};

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

/** Something said, over someone's head: a speech bubble, wrapped to a few lines. */
function speechBubble(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '500 34px system-ui, sans-serif', max = 520, lh = 42, pad = 22;
  ctx.font = font;
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].replace(/.{0,2}$/, '…'); }
  const w = Math.ceil(Math.min(max, Math.max(...lines.map(l => ctx.measureText(l).width)))) + pad * 2;
  const h = lines.length * lh + pad * 1.4 + 16;
  c.width = w; c.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(250,246,236,0.94)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h - 16, 22); ctx.fill();
  ctx.beginPath(); ctx.moveTo(w / 2 - 14, h - 17); ctx.lineTo(w / 2, h); ctx.lineTo(w / 2 + 14, h - 17); ctx.fill();
  ctx.fillStyle = '#1d2a33';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, pad * 0.7 + lh * (i + 0.5)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const k = 0.3 / 72;
  sp.scale.set(w * k, h * k, 1);
  sp.renderOrder = 6;
  return sp;
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Which way someone is from where you face, as an arrow: ↑ ahead, ↓ behind.
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
export function bearing(from, yaw, to) {
  const ang = Math.atan2(to.x - from.x, to.z - from.z);       // world: 0 is +Z
  const ahead = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));    // you face -Z at yaw 0
  let rel = ahead - ang;                                      // + is to your right
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return ARROWS[(Math.round(rel / (Math.PI / 4)) + 8) % 8];
}

// What is on the end of someone's line: a float (the rod) or the hook.
const LINE_SEGS = 10;
function lineEnd(kind) {
  const g = new THREE.Group();
  if (kind === 1) {
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 7),
                                new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.5 }));
    g.add(hook);
  } else {
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
                               new THREE.MeshStandardMaterial({ color: 0xd9412b, roughness: 0.6 }));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
                                  new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.6 }));
    g.add(top, bottom);
  }
  return g;
}

/** Where someone is pointing: a column of light, a ring, and their name, for a while. */
const POINT_TIME = 9;
function pointMarker(name) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 14, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 7;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32),
    new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  const tag = nameTag(name);
  tag.position.y = 14.5;
  tag.material.depthTest = false;
  g.add(beam, ring, tag);
  g.userData = { beam, ring, tag, base: tag.scale.clone() };
  return g;
}

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
    this.tagBase = this.tag.scale.clone();
    this.snaps = [];          // [{at, s}] as they arrive
    this.line = null;         // their rod's line or hook's rope, when it is out: {kind, rope, end}
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
    p.onLand = !!b.s.l;
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
    // Far off, a name stays big enough to read, and shows through what is
    // in the way — it is how you find each other.
    const far = this.net.eye ? this.net.eye.distanceTo(this.tag.position) : 0;
    this.tag.scale.copy(this.tagBase).multiplyScalar(Math.max(1, far / 14));
    this.tag.material.depthTest = far < 30;
    this.drawLine(a.s.ln, b.s.ln, k);
    if (this.bubble) {
      if (performance.now() / 1000 > this.bubbleUntil) this.dropBubble();
      else this.bubble.position.set(p.pos.x, p.pos.y + 2.25 + this.bubble.scale.y / 2, p.pos.z);
    }
  }

  /**
   * Their line, if one is out: from the rod's tip (or the hand, for the
   * hook) to where they have the float or the hook, sagging a little.
   */
  drawLine(la, lb, k) {
    if (!Array.isArray(lb)) { this.dropLine(); return; }
    const kind = lb[3] === 1 ? 1 : 0;
    if (this.line && this.line.kind !== kind) this.dropLine();
    if (!this.line) {
      const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: LINE_SEGS + 1 }, () => new THREE.Vector3())),
        new THREE.LineBasicMaterial({ color: kind === 1 ? 0xd8c79a : 0xe8e4da }));
      rope.frustumCulled = false;
      const end = lineEnd(kind);
      this.net.scene.add(rope, end);
      this.line = { kind, rope, end };
    }
    const e = this.line.end.position;
    if (Array.isArray(la) && (la[3] === 1 ? 1 : 0) === kind) {
      e.set(la[0] + (lb[0] - la[0]) * k, la[1] + (lb[1] - la[1]) * k, la[2] + (lb[2] - la[2]) * k);
    } else e.set(lb[0], lb[1], lb[2]);
    const start = this._start ||= new THREE.Vector3();
    const held = this.body.held;
    if (kind === 0 && held && this.body.heldId === 'rod') held.localToWorld(start.set(0, 1.98, 0));
    else if (held) start.copy(this.body.gripPos);
    else start.copy(this.pose.pos).y += 1.3;
    const pos = this.line.rope.geometry.attributes.position;
    const span = start.distanceTo(e), sag = Math.min(1.2, span * 0.06);
    for (let i = 0; i <= LINE_SEGS; i++) {
      const t = i / LINE_SEGS;
      pos.setXYZ(i, start.x + (e.x - start.x) * t, start.y + (e.y - start.y) * t - Math.sin(Math.PI * t) * sag,
                 start.z + (e.z - start.z) * t);
    }
    pos.needsUpdate = true;
    if (kind === 1) this.line.end.lookAt(start);
  }

  dropLine() {
    if (!this.line) return;
    this.line.rope.removeFromParent();
    this.line.rope.geometry.dispose();
    this.line.end.removeFromParent();
    this.line = null;
  }

  /** Something they said, over their head for a while. */
  say(text) {
    this.dropBubble();
    this.bubble = speechBubble(text);
    this.bubbleUntil = performance.now() / 1000 + 5 + text.length * 0.06;
    this.net.scene.add(this.bubble);
  }

  dropBubble() {
    if (!this.bubble) return;
    this.bubble.removeFromParent();
    this.bubble.material.map.dispose();
    this.bubble.material.dispose();
    this.bubble = null;
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
    else if (e.k === 'point' && Array.isArray(e.p) && e.p.length === 3 && e.p.every(Number.isFinite)) {
      const at = new THREE.Vector3(...e.p);
      this.net.mark(at, this.name);
      const me = this.net.me;
      const how = me ? ` — ${Math.round(Math.hypot(at.x - me.pos.x, at.z - me.pos.z))} m ${bearing(me.pos, me.yaw, at)}` : '';
      this.net.log(`${this.name} points${how}.`, 'chat', 7000);
    }
    else if (e.k === 'chat' && e.text) {
      const text = String(e.text).replace(/[\u0000-\u001f]/g, '').slice(0, SAY);
      this.say(text);
      this.net.log(`${this.name}: ${text}`, 'chat', 12000);
    }
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
    this.dropBubble();
    this.dropLine();
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
   * @param log       (text, kind, ms) => a line in the message log
   * @param raft      the raft, which others stand on
   * @param together  the shared raft (together.js): told of arrivals, and of world events
   */
  /**
   * @param onEvent   (e, remote) => true if the game took it: things that
   *                  are for you rather than about them — a gift, a point
   */
  constructor({ scene, library, cloneHeld, log, raft, together, onEvent }) {
    this.scene = scene;
    this.onEvent = onEvent;
    this.eye = null;            // where you look from, for how big their names are
    this.me = null;             // you: {pos, yaw}, for which way they are from you
    this.points = [];           // markers where someone pointed
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

  /** A game you were in lately and are not in now: its code, to rejoin. */
  get lastRoom() {
    const l = store.get('adrift.last');
    if (!l?.code || Date.now() - l.at > LAST_ROOM || (l.code === this.code && this.ws)) return null;
    return l.code;
  }

  /** Join (or, with a new code, host) a room. */
  join(code, name, who) {
    if (!RELAY) return;
    this.leave(true);
    this.code = cleanCode(code);
    this.name = name;
    this.who = who;
    store.set('adrift.last', { code: this.code, at: Date.now() });
    this.connect(false);
  }

  connect(again) {
    this.status = again ? `Reconnecting to ${this.code}…` : `Connecting to ${this.code}…`;
    this.onChange();
    const ws = new WebSocket(`${RELAY}/room/${this.code}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: this.name, who: this.who, tok: TOKEN }));
    ws.onmessage = e => this.hear(e.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.id !== null;
      this.clear();
      this.ws = null;
      // Dropped out of a game: try to get back in — still on the shared
      // raft, in the shared world — and only after a while give it up.
      if (was || this.retrying) { this.retry(); return; }
      this.together?.exit();
      this.status = 'Could not reach the relay';
      this.onChange();
    };
  }

  retry() {
    const now = performance.now() / 1000;
    if (!this.retrying) {
      this.retrying = { since: now, n: 0 };
      this.log('The connection dropped. Reconnecting…', 'bad');
    }
    if (now - this.retrying.since > GIVE_UP) {
      this.retrying = null;
      this.together?.exit();
      this.status = `Lost the connection to ${this.code}`;
      this.log(`Could not get back into ${this.code}.`, 'bad');
      this.onChange();
      return;
    }
    this.status = `Connection lost — reconnecting to ${this.code}…`;
    this.onChange();
    const wait = Math.min(5, 1 + this.retrying.n++ * 1.5);
    this.retryIn = setTimeout(() => this.connect(true), wait * 1000);
  }

  leave(quiet = false) {
    clearTimeout(this.retryIn);
    this.retrying = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // On purpose: the others hear you have gone, not that you dropped.
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'bye' }));
      ws.close();
    }
    this.clear();
    this.together?.exit();
    if (!quiet) { this.code = null; this.status = 'Not in a game'; this.onChange(); }
  }

  /** Closing the page is leaving on purpose too. */
  goodbye() { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'bye' })); }

  /** Say something to the others. Returns whether it went. */
  chat(text) {
    text = String(text || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, SAY);
    const now = performance.now() / 1000;
    if (!text || !this.connected || now - (this.said || 0) < CHATTY) return false;
    this.said = now;
    this.event({ k: 'chat', text });
    this.log(`${this.name}: ${text}`, 'chat mine', 12000);
    return true;
  }

  clear() {
    for (const p of [...this.points]) this.dropPoint(p);
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
      const names = [...this.remotes.values()].map(r => r.name).join(', ');
      if (this.retrying) this.log(`Back in ${this.code}.`, 'good');
      else this.log(this.remotes.size ? `You join ${this.code}: ${names} ${this.remotes.size === 1 ? 'is' : 'are'} here.`
                                      : `You are hosting ${this.code}. Share the invite link.`, 'good');
      this.retrying = null;
      this.onChange();
    } else if (m.t === 'join') {
      this.add(m);
      this.together?.joined(m.id);
      this.log(m.back ? `${m.name} is back.` : `${m.name} comes aboard.`, 'good');
      this.onChange();
    } else if (m.t === 'leave') {
      const r = this.remotes.get(m.id);
      if (r) { this.log(m.bye ? `${r.name} has gone.` : `${r.name} lost the connection.`); r.dispose(); this.remotes.delete(m.id); this.together?.left(m.id); this.onChange(); }
    } else if (m.t === 'state') {
      this.remotes.get(m.id)?.hear(m.s);
    } else if (m.t === 'ev' && m.e) {
      const r = this.remotes.get(m.id);
      if (WORLD.has(m.e.k)) this.together?.hear(m.e, m.id);
      else if (r && !this.onEvent?.(m.e, r)) r.event(m.e);
    } else if (m.t === 'host') {
      this.host = m.id;
      if (m.id === this.id) { this.log('You are the host now.'); this.together?.hosting(); }
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
  /**
   * @param line  what is on the end of your line, if anything: [x, y, z, kind]
   *              — kind 0 the rod's float, 1 the hook
   * @param eye   where you look from
   */
  update(dt, player, held, time, line = null, eye = null) {
    this.time = time;
    this.eye = eye;
    this.me = player;
    this.tickPoints(dt);
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
    if (line) s.ln = [r2(line[0]), r2(line[1]), r2(line[2]), line[3]];
    if (deck) s.r = 1;
    else if (swim) s.r = 2;
    if (player.onLand && !swim) s.l = 1;         // on land: prey, to the host's dinosaurs
    const text = JSON.stringify({ t: 'state', s });
    if (text === this.last && this.idle < IDLE_SEND) return;
    this.last = text;
    this.idle = 0;
    // The sea's clock rides along, but does not count as a change.
    this.ws.send(JSON.stringify({ t: 'state', s: { ...s, c: Math.round(time * 100) / 100 } }));
  }

  /** Names in the game, you first. */
  /** Names in the game, you first; the others with how far off they are, and which way. */
  crew() {
    if (!this.connected) return [];
    const mark = id => (id === this.host ? ' (host)' : '');
    const where = r => {
      if (!this.me || !r.body.visible) return '';
      const d = Math.hypot(r.pose.pos.x - this.me.pos.x, r.pose.pos.z - this.me.pos.z);
      return d < 4 ? ' · here' : ` · ${Math.round(d)} m ${bearing(this.me.pos, this.me.yaw, r.pose.pos)}`;
    };
    return [`${this.name}${mark(this.id)} — you`, ...[...this.remotes.values()].map(r => `${r.name}${mark(r.id)}${where(r)}`)];
  }

  // ── pointing ───────────────────────────────────────────────────────────────
  /** Point somewhere: a marker there, for you and for the others. */
  point(at) {
    if (!this.connected) return false;
    this.mark(at, this.name);
    const r = v => Math.round(v * 10) / 10;
    this.event({ k: 'point', p: [r(at.x), r(at.y), r(at.z)] });
    return true;
  }

  mark(at, name) {
    // One marker a person: pointing again moves it.
    const old = this.points.find(p => p.name === name);
    if (old) this.dropPoint(old);
    const obj = pointMarker(name);
    obj.position.copy(at);
    this.scene.add(obj);
    this.points.push({ name, obj, t: POINT_TIME });
  }

  tickPoints(dt) {
    for (const p of [...this.points]) {
      p.t -= dt;
      if (p.t <= 0) { this.dropPoint(p); continue; }
      const u = p.obj.userData, fade = Math.min(1, p.t / 1.5);
      u.beam.material.opacity = 0.55 * fade;
      u.ring.material.opacity = 0.8 * fade;
      u.ring.scale.setScalar(1 + 0.25 * Math.sin(p.t * 5));
      u.tag.material.opacity = fade;
      const far = this.eye ? this.eye.distanceTo(p.obj.position) : 0;
      u.tag.scale.copy(u.base).multiplyScalar(Math.max(1, far / 14));
    }
  }

  dropPoint(p) {
    p.obj.removeFromParent();
    p.obj.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    this.points.splice(this.points.indexOf(p), 1);
  }
}
