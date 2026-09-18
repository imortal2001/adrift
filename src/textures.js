// ── Procedural textures ──────────────────────────────────────────────────────
// Everything is painted into a canvas at load time: no image assets to ship,
// and the raft still reads as weathered wood rather than flat colour.

import * as THREE from 'three';

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function finish(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function grain(ctx, size, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const w = 6 + Math.random() * 60, h = 0.6 + Math.random() * 1.6;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '60,38,20' : '215,180,130'},${alpha * Math.random()})`;
    ctx.fillRect(x, y, w, h);
  }
}

/** Planks running along U, with gaps, knots and grain. */
export function woodTexture({ size = 512, planks = 5, base = [166, 116, 66], repeat = 1 } = {}) {
  const [c, ctx] = canvas(size);
  const ph = size / planks;
  for (let i = 0; i < planks; i++) {
    const v = 0.82 + Math.random() * 0.32;
    ctx.fillStyle = `rgb(${base.map(n => Math.min(255, n * v) | 0).join(',')})`;
    ctx.fillRect(0, i * ph, size, ph);
    // seam shadow between boards
    const g = ctx.createLinearGradient(0, i * ph, 0, i * ph + ph);
    g.addColorStop(0, 'rgba(0,0,0,.42)');
    g.addColorStop(0.08, 'rgba(0,0,0,0)');
    g.addColorStop(0.92, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, i * ph, size, ph);
    // grain
    ctx.save();
    ctx.beginPath(); ctx.rect(0, i * ph, size, ph); ctx.clip();
    grain(ctx, size, 90, 0.22);
    // a knot or two
    if (Math.random() < 0.5) {
      const kx = Math.random() * size, ky = i * ph + ph * (0.3 + Math.random() * 0.4);
      const rg = ctx.createRadialGradient(kx, ky, 1, kx, ky, ph * 0.3);
      rg.addColorStop(0, 'rgba(48,30,16,.75)');
      rg.addColorStop(1, 'rgba(48,30,16,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(kx, ky, ph * 0.3, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  return finish(c, repeat);
}

/** Bark-ish, for the log floats under the deck. */
export function logTexture() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#6b4a2c'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 256;
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,26,14' : '140,104,66'},${0.1 + Math.random() * 0.4})`;
    ctx.lineWidth = 0.5 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 14, 85, x - 14, 170, x + Math.random() * 8, 256);
    ctx.stroke();
  }
  return finish(c);
}

/** Woven palm / sailcloth for the water collector. */
export function clothTexture() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#cbbb92'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(120,102,70,.4)';
  for (let i = 0; i < 256; i += 7) {
    ctx.lineWidth = i % 14 ? 1 : 2;
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  grain(ctx, 256, 60, 0.1);
  return finish(c);
}

/** Rusted metal for barrels and scrap. */
export function metalTexture() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#7d5a3e'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 3 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const rust = Math.random() < 0.5 ? '150,70,30' : '60,64,66';
    g.addColorStop(0, `rgba(${rust},.6)`);
    g.addColorStop(1, `rgba(${rust},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  return finish(c);
}

/** Palm frond: green blades fanning off a central rib. */
export function palmTexture() {
  const [c, ctx] = canvas(256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = '#3f6b2e'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '30,58,22' : '124,164,74'},${0.2 + Math.random() * 0.5})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath(); ctx.moveTo(128, y);
    ctx.lineTo(Math.random() < 0.5 ? 0 : 256, y + (Math.random() - 0.5) * 70);
    ctx.stroke();
  }
  ctx.fillStyle = '#2b4a1e'; ctx.fillRect(122, 0, 12, 256);
  return finish(c);
}

/** Soft radial glow, for the firelight sprite. */
export function glowTexture() {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255,215,150,.95)');
  g.addColorStop(0.25, 'rgba(255,150,60,.45)');
  g.addColorStop(0.60, 'rgba(255,110,40,.13)');
  g.addColorStop(1.00, 'rgba(255,90,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let cache = null;
/** Shared texture set — built once, reused by every mesh. */
export function textures() {
  if (cache) return cache;
  cache = {
    deck:  woodTexture({ planks: 5, repeat: 1 }),
    wall:  woodTexture({ planks: 6, base: [150, 104, 60] }),
    roof:  woodTexture({ planks: 7, base: [128, 88, 52] }),
    plank: woodTexture({ planks: 2, base: [178, 128, 76] }),
    log:   logTexture(),
    cloth: clothTexture(),
    metal: metalTexture(),
    palm:  palmTexture(),
    glow:  glowTexture(),
  };
  return cache;
}
