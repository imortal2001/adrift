// ── Flora ────────────────────────────────────────────────────────────────────
// Everything that grows on the land, and the rocks and deadfall between it.
//
// The first forest was cones on sticks. This one is built the way a real
// plant is put together — a trunk that flares into buttresses at the ground,
// branches, and foliage on the branches — and the foliage is not geometry but
// painted cards: sprays of needles, fern fronds, grass, vine leaves, each a
// cut-out in one texture atlas painted here at load time. That is how every
// game forest gets its leaves, and it is the difference between a tree and a
// green cone.
//
// The species are the Mesozoic's, since the animals are: giant redwoods and
// monkey-puzzle araucarias for the canopy, tree ferns and cycads under them,
// ferns and horsetails on the ground; and, since the tyrannosaurs and the
// parasaurs are late Cretaceous, the first flowering plants too — fan palms
// behind the beaches and magnolias at the forest edge. Grass in the open is
// a liberty (grasslands came later), but a plain without it reads as a car park. Fallen trunks,
// stumps, deadfall and rocks lie between them, and vines hang off the trees.
//
// Each species is one geometry with two groups — bark, then foliage — drawn
// with two shared materials, so a whole chunk of forest is a handful of
// instanced draws. Foliage sways in the wind in the vertex shader, weighted
// by a per-vertex `aSway` (0 at the trunk, 1 at a frond tip).
//
// Where each species grows is the `where(site)` rule in SPECIES at the bottom;
// src/terrain.js scatters them from those rules.

import * as THREE from 'three';
import { applyGroundDetail } from './detail.js';

// ── random ───────────────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => Math.min(1, Math.max(0, x));

// ── the leaf atlas ───────────────────────────────────────────────────────────
// One 2048² texture of cut-outs. Painted twice with the same random stream:
// once in colour over a solid backing of the cell's own green (so filtering
// never pulls black into a leaf's edge), once in white on clear for the alpha.
const ATLAS = 2048;
export const ATLAS_SIZE = ATLAS;
export const CELL = {
  needles:  [0, 0, 512, 512],
  scales:   [512, 0, 512, 512],
  leaves:   [1024, 0, 512, 512],
  ivy:      [1536, 0, 512, 512],
  fern:     [0, 512, 512, 1024],
  cycad:    [512, 512, 512, 1024],
  grass:    [1024, 512, 512, 1024],
  treefern: [1536, 512, 512, 1024],
  vine:     [0, 1536, 256, 512],
  horsetail:[256, 1536, 256, 256],
  flower:   [256, 1792, 256, 256],
  reeds:    [512, 1536, 512, 512],
  tallgrass:[1024, 1536, 512, 512],
  palmfan:  [1536, 1536, 512, 512],
};

// Base greens: dark and cool in the shade-tolerant, lighter in the open.
const BACKING = {
  needles: '#2d4526', scales: '#33492b', leaves: '#3d5a2c', ivy: '#35522a', fern: '#48692f',
  cycad: '#39562b', grass: '#62783a', treefern: '#4f7133', vine: '#3a5a2c', reeds: '#6c7a45',
  tallgrass: '#8a8446', horsetail: '#4c6a33', flower: '#e8d6d2', palmfan: '#4f7036',
};

function leafShape(ctx, x, y, len, wid, ang, fill, rib) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.45, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  if (rib) {
    ctx.strokeStyle = rib;
    ctx.lineWidth = Math.max(0.6, wid * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len * 0.92);
    ctx.stroke();
  }
  ctx.restore();
}

const green = (r, h, s, l) => `hsl(${h + (r() - 0.5) * 14}, ${s + (r() - 0.5) * 12}%, ${l + (r() - 0.5) * 10}%)`;

/** Each painter draws its cell in the box (x, y, w, h), the base at the bottom. */
const PAINTERS = {
  // A conifer spray: a twig, side twigs, needles all along them.
  needles(ctx, r, c, x, y, w, h) {
    // The mass first: overlapping dark blobs, so a card reads as a clump of
    // foliage and not a few sticks with the sky between them.
    for (let k = 0; k < 26; k++) {
      const bx = x + w * (0.2 + r() * 0.6), by = y + h * (0.18 + r() * 0.64), rad = w * (0.07 + r() * 0.09);
      ctx.fillStyle = c(green(r, 110, 34, 20 + r() * 7));
      ctx.beginPath();
      for (let a = 0; a <= 12; a++) {
        const t = (a / 12) * Math.PI * 2, rr = rad * (0.75 + r() * 0.45);
        ctx.lineTo(bx + Math.cos(t) * rr, by + Math.sin(t) * rr);
      }
      ctx.fill();
    }
    for (let spray = 0; spray < 9; spray++) {
      const bx = x + w * (0.25 + r() * 0.5), by = y + h * 0.98;
      const ang = (r() - 0.5) * 1.3;
      const len = h * (0.55 + r() * 0.4);
      const twig = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        twig.push([bx + Math.sin(ang) * len * t + Math.sin(t * 3 + spray) * 8, by - Math.cos(ang) * len * t]);
      }
      const drawTwig = (pts, thick, nlen) => {
        ctx.strokeStyle = c('#4a3a26');
        ctx.lineWidth = thick;
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1], [bx2, by2] = pts[i];
          for (let k = 0; k < 7; k++) {
            const t = k / 7, px = lerp(ax, bx2, t), py = lerp(ay, by2, t);
            const dir = Math.atan2(by2 - ay, bx2 - ax);
            for (const side of [-1, 1]) {
              const a2 = dir + side * (0.9 + r() * 0.4);
              ctx.strokeStyle = c(green(r, 108, 40, 28 + r() * 18));
              ctx.lineWidth = 3.4;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(px + Math.cos(a2) * nlen, py + Math.sin(a2) * nlen);
              ctx.stroke();
            }
          }
        }
      };
      drawTwig(twig, 4, 30 + r() * 10);
      for (let k = 2; k < 11; k += 2) {
        const [px, py] = twig[k];
        const side = k % 4 ? 1 : -1;
        const sub = [];
        const sl = len * 0.35 * (1 - k / 14);
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          sub.push([px + side * sl * t * 0.9, py - sl * t * 0.55]);
        }
        drawTwig(sub, 2.5, 22 + r() * 8);
      }
    }
  },
  // Araucaria: ropes of overlapping scale-leaves, fanning from a point.
  scales(ctx, r, c, x, y, w, h) {
    // A dark mass the ropes spring from, as a real tuft is solid at its heart.
    for (let k = 0; k < 18; k++) {
      const a = -1.2 + r() * 2.4, d = h * (0.2 + r() * 0.45);
      const bx = x + w / 2 + Math.sin(a) * d, by = y + h * 0.97 - Math.cos(a) * d, rad = w * (0.06 + r() * 0.07);
      ctx.fillStyle = c(green(r, 108, 32, 20 + r() * 6));
      ctx.beginPath();
      for (let q = 0; q <= 10; q++) {
        const t = (q / 10) * Math.PI * 2, rr = rad * (0.7 + r() * 0.5);
        ctx.lineTo(bx + Math.cos(t) * rr, by + Math.sin(t) * rr);
      }
      ctx.fill();
    }
    for (let rope = 0; rope < 11; rope++) {
      const ang = -1.2 + rope * 0.24 + (r() - 0.5) * 0.2;
      let px = x + w / 2, py = y + h * 0.97;
      const len = h * (0.6 + r() * 0.35);
      for (let i = 0; i < 38; i++) {
        const t = i / 38;
        const a = ang + Math.sin(t * 2.5) * 0.25;
        px += Math.sin(a) * len / 38;
        py -= Math.cos(a) * len / 38;
        const s = 21 * (1 - t * 0.45);
        for (const side of [-1, 1]) {
          leafShape(ctx, px, py, s * 1.6, s * 0.62, a + side * 0.55, c(green(r, 102, 36, 27 + r() * 14)), null);
        }
      }
    }
  },
  // A broad-leaved cluster, for shrubs.
  leaves(ctx, r, c, x, y, w, h) {
    for (let i = 0; i < 70; i++) {
      const lx = x + w * (0.1 + r() * 0.8), ly = y + h * (0.12 + r() * 0.82);
      const len = 50 + r() * 45;
      leafShape(ctx, lx, ly, len, len * 0.38, (r() - 0.5) * 5,
                c(green(r, 98, 42, 22 + r() * 18)), c('rgba(210,220,160,0.35)'));
    }
  },
  // Small heart-ish leaves along a thin stem: ivy, creepers.
  ivy(ctx, r, c, x, y, w, h) {
    for (let s = 0; s < 3; s++) {
      let px = x + w * (0.25 + s * 0.25), py = y + h;
      ctx.strokeStyle = c('#4b3c26');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const pts = [];
      for (let i = 0; i < 20; i++) {
        px += (r() - 0.5) * 18;
        py -= h / 20;
        ctx.lineTo(px, py);
        pts.push([px, py]);
      }
      ctx.stroke();
      for (const [lx, ly] of pts) {
        for (const side of [-1, 1]) {
          leafShape(ctx, lx, ly, 34 + r() * 16, 20, side * (1.2 + r() * 0.6),
                    c(green(r, 100, 40, 20 + r() * 16)), c('rgba(200,210,150,0.3)'));
        }
      }
    }
  },
  // A pinnate frond: a rachis, and pinnae all the way up it, each one lobed.
  fern(ctx, r, c, x, y, w, h, light = 30) {
    const cx = x + w / 2;
    ctx.strokeStyle = c('#5b6b33');
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, y + h);
    ctx.quadraticCurveTo(cx + 10, y + h * 0.5, cx, y + 6);
    ctx.stroke();
    const n = 30;
    for (let i = 2; i < n; i++) {
      const t = i / n;
      const py = y + h - t * (h - 10);
      const px = cx + Math.sin(t * 3.1) * 6;
      const reach = w * 0.46 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (1 - t * 0.35);
      for (const side of [-1, 1]) {
        const ang = side * (1.25 - t * 0.35);
        const lobes = 7;
        for (let k = 0; k < lobes; k++) {
          const kt = k / lobes;
          const lx = px + Math.sin(ang) * reach * kt, ly = py - Math.cos(ang) * reach * kt;
          const ll = (reach / lobes) * 2.1 * (1 - kt * 0.5);
          for (const s2 of [-1, 1]) {
            leafShape(ctx, lx, ly, ll, ll * 0.42, ang + s2 * 0.9,
                      c(green(r, 96, 44, light + r() * 12 - kt * 6)), null);
          }
        }
      }
    }
  },
  treefern(ctx, r, c, x, y, w, h) { PAINTERS.fern(ctx, r, c, x, y, w, h, 34); },
  // A cycad frond: stiff, straight, long narrow leaflets angled to the tip.
  cycad(ctx, r, c, x, y, w, h) {
    const cx = x + w / 2;
    ctx.strokeStyle = c('#6d6a3a');
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, y + h);
    ctx.lineTo(cx, y + 8);
    ctx.stroke();
    for (let i = 4; i < 46; i++) {
      const t = i / 46;
      const py = y + h - t * (h - 12);
      const len = w * 0.47 * Math.sin(Math.PI * Math.min(1, 0.1 + t)) ;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(cx, py);
        ctx.rotate(side * (1.05 - t * 0.2));
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.quadraticCurveTo(-3, -len * 0.6, 0, -len);
        ctx.quadraticCurveTo(3, -len * 0.6, 8, 0);
        ctx.fillStyle = c(green(r, 100, 40, 20 + r() * 10));
        ctx.fill();
        ctx.restore();
      }
    }
  },
  // Grass: tapering blades, green at the root to straw at the tips, a few
  // seed heads.
  grass(ctx, r, c, x, y, w, h, tall = false) {
    const blades = tall ? 60 : 85;
    for (let i = 0; i < blades; i++) {
      const bx = x + w * (0.05 + r() * 0.9), by = y + h;
      const len = h * (tall ? 0.55 + r() * 0.42 : 0.35 + r() * 0.6);
      const lean = (r() - 0.5) * w * 0.45;
      const wd = 5 + r() * 6;
      const grad = ctx.createLinearGradient(0, by, 0, by - len);
      const base = tall ? [58, 28, 30] : [95, 40, 24];
      grad.addColorStop(0, c(`hsl(${base[0] + 10}, ${base[1] + 10}%, ${base[2] - 6}%)`));
      grad.addColorStop(0.6, c(green(r, base[0], base[1] + 6, base[2] + 12)));
      grad.addColorStop(1, c(`hsl(${tall ? 46 : 70}, 36%, ${tall ? 62 : 52}%)`));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(bx - wd / 2, by);
      ctx.quadraticCurveTo(bx + lean * 0.3, by - len * 0.6, bx + lean, by - len);
      ctx.quadraticCurveTo(bx + lean * 0.3 + wd * 0.2, by - len * 0.6, bx + wd / 2, by);
      ctx.fill();
      if (tall && r() < 0.25) {
        for (let k = 0; k < 9; k++) {
          leafShape(ctx, bx + lean + (r() - 0.5) * 6, by - len + k * 5, 14, 5, (r() - 0.5) * 0.8,
                    c('hsl(42, 40%, 66%)'), null);
        }
      }
    }
  },
  tallgrass(ctx, r, c, x, y, w, h) { PAINTERS.grass(ctx, r, c, x, y, w, h, true); },
  // Reeds and rushes, for the river banks.
  reeds(ctx, r, c, x, y, w, h) {
    for (let i = 0; i < 40; i++) {
      const bx = x + w * (0.08 + r() * 0.84), by = y + h, len = h * (0.6 + r() * 0.38);
      const lean = (r() - 0.5) * 60, wd = 6 + r() * 5;
      ctx.fillStyle = c(green(r, 80, 30, 34 + r() * 14));
      ctx.beginPath();
      ctx.moveTo(bx - wd / 2, by);
      ctx.lineTo(bx + lean, by - len);
      ctx.lineTo(bx + wd / 2, by);
      ctx.fill();
      if (r() < 0.2) {
        ctx.fillStyle = c('#5a4128');
        ctx.fillRect(bx + lean * 0.8 - 4, by - len * 0.85, 8, 36);
      }
    }
  },
  // A hanging strand, leaves the whole way down (it tiles vertically).
  vine(ctx, r, c, x, y, w, h) {
    for (let s = 0; s < 2; s++) {
      const cx = x + w * (0.35 + s * 0.3);
      ctx.strokeStyle = c('#4d3d27');
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.bezierCurveTo(cx + 30, y + h * 0.33, cx - 30, y + h * 0.66, cx, y + h);
      ctx.stroke();
      for (let i = 0; i < 26; i++) {
        const t = i / 26, ly = y + t * h;
        const lx = cx + Math.sin(t * Math.PI * 2) * 22 * (s ? -1 : 1);
        leafShape(ctx, lx, ly, 46 + r() * 22, 22, (i % 2 ? 1 : -1) * (1.6 + r() * 0.7),
                  c(green(r, 104, 42, 20 + r() * 16)), c('rgba(200,215,150,0.3)'));
      }
    }
  },
  // A fan palm's leaf: stiff segments radiating from the top of the stalk,
  // the costa (the rib that makes it a *costa*palmate fan) down the middle.
  palmfan(ctx, r, c, x, y, w, h) {
    const bx = x + w / 2, by = y + h * 0.96;
    for (let i = 0; i < 38; i++) {
      const t = i / 37, ang = -1.5 + t * 3.0 + (r() - 0.5) * 0.04;
      const len = h * (0.78 + 0.16 * Math.cos((t - 0.5) * 3.1)) * (0.94 + r() * 0.08);
      leafShape(ctx, bx, by, len, 11 + r() * 3, ang, c(green(r, 100, 38, 24 + r() * 14)), c('rgba(210,215,150,0.35)'));
    }
    ctx.strokeStyle = c('#7c7a42');
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, by - h * 0.55);
    ctx.stroke();
  },
  // A magnolia flower, seen into the cup: eight broad petals, flushed pink at
  // the base, and the cone of stamens in the middle. (Magnolias are among the
  // first flowering plants — here with the tyrannosaurs, in the late Cretaceous.)
  flower(ctx, r, c, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2, R = w * 0.44;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + ring * 0.39 + (r() - 0.5) * 0.1;
        const len = R * (ring ? 0.72 : 1);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        const grad = ctx.createLinearGradient(0, 0, 0, -len);
        grad.addColorStop(0, c('#c46a8c'));
        grad.addColorStop(0.45, c('#efc6d2'));
        grad.addColorStop(1, c('#fbf4f0'));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(len * 0.45, -len * 0.3, len * 0.35, -len * 1.0, 0, -len);
        ctx.bezierCurveTo(-len * 0.35, -len * 1.0, -len * 0.45, -len * 0.3, 0, 0);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.fillStyle = c('#c9b24a');
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.16, R * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, d = r() * R * 0.14;
      ctx.fillStyle = c(r() < 0.5 ? '#8f8a3a' : '#e0cf6a');
      ctx.fillRect(cx + Math.cos(a) * d - 1.5, cy + Math.sin(a) * d - 1.5, 3, 3);
    }
  },
  // A horsetail whorl: fine needle-like leaves radiating from a node.
  horsetail(ctx, r, c, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      ctx.strokeStyle = c(green(r, 95, 38, 30 + r() * 12));
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * w * 0.46, cy + Math.sin(a) * h * 0.46);
      ctx.stroke();
    }
  },
};

let atlas = null;
/** The leaf atlas, painted once. */
export function leafAtlas() {
  if (atlas) return atlas;
  const col = document.createElement('canvas');
  const msk = document.createElement('canvas');
  col.width = col.height = msk.width = msk.height = ATLAS;
  const cc = col.getContext('2d'), mc = msk.getContext('2d');
  let seed = 11;
  for (const [name, [x, y, w, h]] of Object.entries(CELL)) {
    cc.fillStyle = BACKING[name];
    cc.fillRect(x, y, w, h);
    for (const [ctx, c] of [[cc, s => s], [mc, () => '#fff']]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, w - 4, h - 4);
      ctx.clip();
      PAINTERS[name](ctx, rng(seed), c, x, y, w, h);
      ctx.restore();
    }
    seed += 7;
  }
  const rgba = cc.getImageData(0, 0, ATLAS, ATLAS).data;
  const a = mc.getImageData(0, 0, ATLAS, ATLAS).data;
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = a[i];
  atlas = new THREE.DataTexture(rgba, ATLAS, ATLAS, THREE.RGBAFormat);
  atlas.mipmaps = coverageMips(rgba, ATLAS);
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  atlas.needsUpdate = true;
  return atlas;
}

/**
 * Mip levels that keep the cut-out's coverage. Averaged alpha fades toward
 * the cut-off as a card gets small on screen, and a tree thins to nothing
 * with distance; each level's alpha is scaled until as much of it passes the
 * cut-off as at full size.
 */
function coverageMips(top, size) {
  const levels = [{ data: top, width: size, height: size }];
  const covered = d => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n / (d.length / 4); };
  const target = covered(top);
  let src = top, s = size;
  while (s > 1) {
    const n = s >> 1, dst = new Uint8ClampedArray(n * n * 4);
    const alpha = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const i = ((y * 2 + oy) * s + x * 2 + ox) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        }
        const o = (y * n + x) * 4;
        dst[o] = r / 4; dst[o + 1] = g / 4; dst[o + 2] = b / 4;
        alpha[y * n + x] = a / 4;
      }
    }
    // Binary search for the alpha scale that matches the top level's coverage.
    let lo = 1, hi = 4;
    for (let it = 0; it < 10; it++) {
      const mid = (lo + hi) / 2;
      let c = 0;
      for (let i = 0; i < alpha.length; i++) if (alpha[i] * mid > 127) c++;
      if (c / alpha.length < target) lo = mid; else hi = mid;
    }
    for (let i = 0; i < alpha.length; i++) dst[i * 4 + 3] = Math.min(255, alpha[i] * hi);
    levels.push({ data: dst, width: n, height: n });
    src = dst;
    s = n;
  }
  return levels;
}

// ── bark ─────────────────────────────────────────────────────────────────────
// Deep vertical furrows and fibrous ridges, as a height field, then coloured
// and turned into a normal map from its own slope. Grey-brown: each species
// tints it through its vertex colour.
let bark = null;
export function barkTextures() {
  if (bark) return bark;
  const W = 512, H = 1024;
  const height = new Float32Array(W * H);
  const r = rng(5);
  // Ridges: long wavering strips of different widths.
  for (let k = 0; k < 90; k++) {
    let x = r() * W;
    const w = 3 + r() * 14, depth = 0.4 + r() * 0.6;
    const y0 = r() * H, len = H * (0.3 + r() * 0.9);
    for (let yy = 0; yy < len; yy++) {
      const y = Math.floor(y0 + yy) % H;
      x += (r() - 0.5) * 0.9;
      for (let dx = -w; dx <= w; dx++) {
        const px = ((Math.floor(x + dx) % W) + W) % W;
        const f = 1 - (dx / w) ** 2;
        height[y * W + px] = Math.max(height[y * W + px], f * depth);
      }
    }
  }
  // Fibre grain and pits.
  for (let i = 0; i < height.length; i++) height[i] += (r() - 0.5) * 0.08;
  const rgba = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, hgt = height[i];
      const l = 0.32 + hgt * 0.5;
      rgba[i * 4] = Math.min(255, 255 * l * 1.02);
      rgba[i * 4 + 1] = Math.min(255, 255 * l * 0.9);
      rgba[i * 4 + 2] = Math.min(255, 255 * l * 0.78);
      rgba[i * 4 + 3] = 255;
      const hx = height[y * W + (x + 1) % W] - height[y * W + (x + W - 1) % W];
      const hy = height[((y + 1) % H) * W + x] - height[((y + H - 1) % H) * W + x];
      const nx = -hx * 3.2, ny = -hy * 3.2, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nrm[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
    }
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  bark = { map: tex(rgba, true), normalMap: tex(nrm, false) };
  return bark;
}

// ── wind ─────────────────────────────────────────────────────────────────────
export const WIND = { uTime: { value: 0 }, uGust: { value: 1 } };
export function setFloraTime(t) { WIND.uTime.value = t; }

/**
 * Sway: the higher up a plant and the further out along a frond, the more it
 * moves (`aSway`). Two slow waves and a quick flutter, phased by where the
 * plant stands so a forest does not wave in unison.
 */
function addWind(material, { amount = 1, flutter = 1, fade = 0 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uWindTime = WIND.uTime;
    shader.uniforms.uGust = WIND.uGust;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSway;
        uniform float uWindTime;
        uniform float uGust;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 root = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            root = instanceMatrix * root;
          #endif
          root = modelMatrix * root;
          float ph = root.x * 0.043 + root.z * 0.037;
          float t = uWindTime;
          float w = aSway * ${amount.toFixed(3)} * uGust;
          float slow = sin(t * 0.9 + ph) * 0.6 + sin(t * 1.7 + ph * 1.9) * 0.3;
          float quick = sin(t * 5.3 + ph * 4.0 + position.y * 1.7 + position.x) * ${(0.12 * flutter).toFixed(3)};
          transformed.x += w * (slow + quick);
          transformed.z += w * (slow * 0.6 + quick * 0.8) * 0.7;
          transformed.y -= w * abs(slow) * 0.12;
          ${fade ? `
          // Grass fades into the ground with distance rather than stopping
          // at a line: shrink each clump to nothing over the last stretch.
          float fadeD = distance(root.xyz, cameraPosition);
          transformed *= 1.0 - smoothstep(${(fade * 0.72).toFixed(1)}, ${fade.toFixed(1)}, fadeD);` : ''}
        }`);
    // Foliage is lit as a mass, not card by card: the normals are set to
    // point out of the crown, and a double-sided card must not flip them on
    // its back face or half the leaves go black.
    if (material.side === THREE.DoubleSide) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        normal *= faceDirection;`);
    }
  };
  material.customProgramCacheKey = () => `wind-${amount}-${flutter}-${fade}-${material.side}`;
  return material;
}

// ── materials ────────────────────────────────────────────────────────────────
let mats = null;
/** [bark, foliage] for trees and plants; grass has its own (it fades out). */
export function floraMaterials() {
  if (mats) return mats;
  const b = barkTextures();
  const barkMat = addWind(new THREE.MeshStandardMaterial({
    map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(1.4, 1.4),
    vertexColors: true, roughness: 0.93, metalness: 0,
  }), { amount: 0.35, flutter: 0 });
  const leafMat = addWind(new THREE.MeshStandardMaterial({
    map: leafAtlas(), vertexColors: true, roughness: 0.92, metalness: 0,
    side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true,
  }), { amount: 1, flutter: 1 });
  const grassMat = addWind(new THREE.MeshStandardMaterial({
    map: leafAtlas(), vertexColors: true, roughness: 0.9, metalness: 0,
    side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true,
  }), { amount: 1, flutter: 1.6, fade: 95 });
  const rockMat = applyGroundDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }), { rock: 0.6, bump: 1.4 });
  mats = { tree: [barkMat, leafMat], grass: [barkMat, grassMat], rock: rockMat };
  return mats;
}

// ── geometry builder ─────────────────────────────────────────────────────────
// Two parts — bark and foliage — filled with tubes, cards and strips, then
// packed into one BufferGeometry with a group for each.
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);

class Builder {
  constructor() { this.parts = [this.part(), this.part()]; }
  part() { return { pos: [], nrm: [], uv: [], col: [], sway: [], idx: [] }; }
  vert(k, p, n, u, v, c, s) {
    const P = this.parts[k];
    P.pos.push(p.x, p.y, p.z);
    P.nrm.push(n.x, n.y, n.z);
    P.uv.push(u, v);
    P.col.push(c.r, c.g, c.b);
    P.sway.push(s);
    return P.pos.length / 3 - 1;
  }
  tri(k, a, b, c) { this.parts[k].idx.push(a, b, c); }

  /**
   * A generalised cylinder down a path of points with radii, framed by
   * parallel transport so it never twists. `radius(t, angle)` may add lobes
   * (a buttressed base); `color(t, n)` and `sway(t)` per ring.
   */
  tube(path, { sides = 8, radius, color, sway = () => 0, uTiles = 1, vMetres = 3, cap = false, k = 0 }) {
    const n = path.length;
    const tangents = path.map((p, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      return b.clone().sub(a).normalize();
    });
    let normal = Math.abs(tangents[0].y) < 0.9 ? V3(0, 1, 0).cross(tangents[0]).normalize()
                                               : V3(1, 0, 0).cross(tangents[0]).normalize();
    const rings = [];
    let along = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        along += path[i].distanceTo(path[i - 1]);
        const axis = tangents[i - 1].clone().cross(tangents[i]);
        const len = axis.length();
        if (len > 1e-6) {
          const ang = Math.asin(Math.min(1, len));
          normal.applyAxisAngle(axis.divideScalar(len), ang);
        }
      }
      const binormal = tangents[i].clone().cross(normal).normalize();
      const t = i / (n - 1);
      const ring = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const dir = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
        const r = radius(t, a);
        const p = path[i].clone().addScaledVector(dir, r);
        ring.push(this.vert(k, p, dir, (s / sides) * uTiles, along / vMetres, color(t, dir), sway(t)));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = rings[i][s], b = rings[i][s + 1], c = rings[i + 1][s], d = rings[i + 1][s + 1];
        this.tri(k, a, c, b);
        this.tri(k, b, c, d);
      }
    }
    if (cap) {
      const end = path[n - 1], tn = tangents[n - 1];
      const ci = this.vert(k, end.clone().addScaledVector(tn, radius(1, 0) * 0.3), tn, 0.5, along / vMetres, cap, sway(1));
      const last = rings[n - 1];
      for (let s = 0; s < sides; s++) this.tri(k, last[s], ci, last[s + 1]);
    }
  }

  /**
   * A ribbon of foliage along a curve: `pts` down the middle, `side` the
   * direction across it at each point, mapped onto one atlas cell with the
   * cell's base at the first point. `vTile` repeats the cell along it.
   */
  strip(pts, side, width, cell, { color, normals, sway, vTile = 1, k = 1 }) {
    // A cell cannot wrap inside the atlas, so a repeating strip is laid as one
    // run of vertices per repeat, each covering the cell once.
    if (vTile > 1.01) {
      const reps = Math.round(vTile), n = pts.length;
      const at = (arr, t) => {
        const f = t * (n - 1), i = Math.min(n - 2, Math.floor(f));
        return arr[i].clone().lerp(arr[i + 1], f - i);
      };
      const sides = Array.isArray(side) ? side : null;
      for (let rep = 0; rep < reps; rep++) {
        const seg = [], segSide = [];
        for (let q = 0; q <= 3; q++) {
          const t = (rep + q / 3) / reps;
          seg.push(at(pts, t));
          segSide.push(sides ? at(sides, t).normalize() : side);
        }
        const t0 = rep / reps, t1 = (rep + 1) / reps;
        const remap = f => (t => f(t0 + (t1 - t0) * t));
        this.strip(seg, segSide, typeof width === 'function' ? remap(width) : width, cell, {
          color: remap(color), sway: remap(sway), k,
          normals: normals ? (t, i) => normals(t0 + (t1 - t0) * t, i) : null,
        });
      }
      return;
    }
    const [cx, cy, cw, ch] = cell;
    const u0 = (cx + 3) / ATLAS, u1 = (cx + cw - 3) / ATLAS;
    const n = pts.length, idx = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const w = typeof width === 'function' ? width(t) : width;
      const sd = Array.isArray(side) ? side[i] : side;
      // v runs from the cell's bottom (the base) to its top (the tip).
      const v = (cy + ch - 3 - t * (ch - 6)) / ATLAS;
      const nrm = normals ? normals(t, i) : UP;
      const c = color(t);
      const s = sway(t);
      idx.push([
        this.vert(k, pts[i].clone().addScaledVector(sd, -w / 2), nrm, u0, v, c, s),
        this.vert(k, pts[i].clone().addScaledVector(sd, w / 2), nrm, u1, v, c, s),
      ]);
    }
    for (let i = 0; i < n - 1; i++) {
      const [a, b] = idx[i], [c, d] = idx[i + 1];
      this.tri(k, a, c, b);
      this.tri(k, b, c, d);
    }
  }

  /** A flat card: centre, the two directions across it, size, one cell. */
  card(centre, right, up, w, h, cell, { color, normal, sway, k = 1 }) {
    const pts = [centre.clone().addScaledVector(up, -h / 2), centre.clone().addScaledVector(up, h / 2)];
    this.strip(pts, right, w, cell, { color: () => color, normals: () => normal, sway: t => sway * (0.6 + 0.4 * t), k });
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    const all = { pos: [], nrm: [], uv: [], col: [], sway: [] };
    const index = [];
    let base = 0;
    this.parts.forEach((P, k) => {
      const start = index.length;
      for (const key of Object.keys(all)) all[key].push(...P[key]);
      for (const i of P.idx) index.push(i + base);
      base += P.pos.length / 3;
      if (P.idx.length) g.addGroup(start, P.idx.length, k);
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(all.sway, 1));
    g.setIndex(index.length > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const col = (hex, r, v = 0.12) => {
  const c = new THREE.Color(hex);
  const k = 1 + (r() - 0.5) * 2 * v;
  return c.multiplyScalar(k);
};

/** Foliage normal: out of the crown, tipped up — a canopy is lit as a mass. */
function crownNormal(p, centre, upBias = 0.8) {
  return p.clone().sub(centre).normalize().multiplyScalar(0.8).addScaledVector(UP, upBias).normalize();
}

/** Cards round a point: a tuft of foliage. */
function tuft(b, r, at, centre, size, count, cell, tint, sway, { flat = 0.45 } = {}) {
  for (let i = 0; i < count; i++) {
    const yaw = r() * Math.PI * 2;
    const right = V3(Math.cos(yaw), 0, Math.sin(yaw));
    // Somewhere between lying flat and standing up.
    const tilt = lerp(flat, 1.25, r());
    const up = V3(-Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt));
    const c = at.clone().add(V3((r() - 0.5) * size * 0.5, (r() - 0.3) * size * 0.35, (r() - 0.5) * size * 0.5));
    b.card(c, right, up.normalize(), size * (0.85 + r() * 0.3), size * (0.85 + r() * 0.3), cell,
           { color: col(tint, r, 0.14), normal: crownNormal(c, centre), sway });
  }
}

/** A hanging strand of vine from a point, `len` long. */
function hangVine(b, r, top, len, tint) {
  const n = Math.max(3, Math.round(len / 2.2));
  const pts = [], sides = [];
  const yaw = r() * Math.PI * 2;
  const side = V3(Math.cos(yaw), 0, Math.sin(yaw));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(top.clone().add(V3(Math.sin(t * 2.2 + yaw) * 0.3, -t * len, Math.cos(t * 1.7) * 0.3)));
    sides.push(side);
  }
  b.strip(pts, sides, 0.7 + r() * 0.4, CELL.vine, {
    color: t => col(tint, r, 0.08).multiplyScalar(1 - t * 0.15), normals: () => side.clone().cross(UP).normalize(),
    sway: t => 0.25 + t * 0.9, vTile: len / 2.4,
  });
}

// ── species ──────────────────────────────────────────────────────────────────
// Built at real size, in metres, standing on the origin.

/** Giant redwood: 55 m, a buttressed trunk three metres across, the crown
 *  only in the top half, sometimes hung with vines. */
function redwood(lod, seed) {
  const r = rng(seed), b = new Builder();
  const H = 55, R0 = 1.55;
  const lean = V3((r() - 0.5) * 0.02, 1, (r() - 0.5) * 0.02).normalize();
  const trunkAt = t => lean.clone().multiplyScalar(H * t).add(V3(Math.sin(t * 5 + seed) * 0.3, 0, Math.cos(t * 4) * 0.3));
  const path = [];
  // Rings packed toward the ground, where the buttresses change fastest.
  const rings = lod ? 6 : 18;
  for (let i = 0; i <= rings; i++) path.push(trunkAt(-0.02 + Math.pow(i / rings, 1.7) * 0.99));
  const lobes = 4 + Math.floor(r() * 3), phase = r() * 6;
  const barkTint = new THREE.Color(0x9a5a3c);
  b.tube(path, {
    sides: lod ? 7 : 14, uTiles: lod ? 2 : 4, vMetres: 3.2, k: 0,
    radius: (t, a) => {
      const taper = R0 * Math.pow(1 - t * 0.8, 1.15) + 0.12;
      const flare = 1 + 1.1 * Math.exp(-t * 26);
      const buttress = 1 + 0.35 * Math.exp(-t * 16) * Math.pow(Math.abs(Math.sin(a * lobes * 0.5 + phase)), 3);
      return taper * flare * buttress;
    },
    color: (t) => barkTint.clone().multiplyScalar(0.8 + t * 0.25),
    sway: t => t * t * 0.5,
  });
  // Branches, from half way up, shorter toward the top.
  const nb = lod ? 0 : 30;
  const foliage = new THREE.Color(0x5d8343);
  const crownTop = trunkAt(0.97);
  for (let i = 0; i < nb; i++) {
    const t = lerp(0.45, 0.95, i / nb) + (r() - 0.5) * 0.02;
    const base = trunkAt(t);
    const yaw = i * 2.399 + r() * 0.4;
    const dir = V3(Math.cos(yaw), 0, Math.sin(yaw));
    const len = lerp(9.5, 2.6, (t - 0.45) / 0.5) * (0.8 + r() * 0.4);
    const pts = [];
    for (let k = 0; k <= 3; k++) {
      const f = k / 3;
      pts.push(base.clone().addScaledVector(dir, len * f).add(V3(0, len * (0.25 * f - 0.3 * f * f), 0)));
    }
    b.tube(pts, { sides: 5, k: 0, uTiles: 1, vMetres: 2, radius: f => lerp(0.32, 0.06, f), color: () => barkTint,
                  sway: f => 0.15 + f * 0.25 + t * 0.2 });
    const centre = trunkAt(t).add(V3(0, 1.5, 0));
    for (let k = 0; k < 7; k++) {
      const f = 0.25 + (k / 7) * 0.9;
      const at = base.clone().addScaledVector(dir, len * f).add(V3(0, len * (0.25 * f - 0.3 * f * f) + 0.4, 0));
      tuft(b, r, at, centre, lerp(5.4, 3.2, (t - 0.45) / 0.5), 3, CELL.needles, foliage, 0.35 + t * 0.35);
    }
    // Vines off the lower limbs of the vine-hung variant.
    if (seed % 2 === 1 && t < 0.62 && r() < 0.55) {
      hangVine(b, r, base.clone().addScaledVector(dir, len * (0.4 + r() * 0.4)), 7 + r() * 16, 0x49683a);
    }
  }
  if (lod) {
    // The far tree: its crown as a few big cards in tiers.
    for (let tier = 0; tier < 5; tier++) {
      const t = lerp(0.5, 0.93, tier / 4);
      const centre = trunkAt(t);
      tuft(b, r, centre, trunkAt(t - 0.05), lerp(17, 8, tier / 4), 6, CELL.needles, foliage, 0.3, { flat: 0.2 });
    }
  }
  tuft(b, r, crownTop, trunkAt(0.9), 4, lod ? 2 : 4, CELL.needles, foliage, 0.8);
  return b.geometry();
}

/** Araucaria, the monkey puzzle: a tall straight grey trunk and a flat-topped
 *  umbrella of upcurved branches, roped with scale-leaves. */
function araucaria(lod, seed) {
  const r = rng(seed), b = new Builder();
  const H = 36, R0 = 0.85;
  const path = [];
  const rings = lod ? 5 : 12;
  for (let i = 0; i <= rings; i++) {
    const t = -0.02 + (i / rings);
    path.push(V3(Math.sin(t * 3 + seed) * 0.25, H * t, Math.cos(t * 2.3) * 0.25));
  }
  const barkTint = new THREE.Color(0x857a6e);
  b.tube(path, {
    sides: lod ? 6 : 11, uTiles: lod ? 2 : 3, vMetres: 2.4, k: 0,
    radius: t => (R0 * (1 - t * 0.82) + 0.08) * (1 + 0.6 * Math.exp(-t * 30)),
    color: t => barkTint.clone().multiplyScalar(0.85 + t * 0.2), sway: t => t * t * 0.45,
  });
  const foliage = new THREE.Color(0x547a3c);
  const whorls = lod ? 0 : 7;
  const crown = V3(0, H * 0.9, 0);
  for (let w = 0; w < whorls; w++) {
    const t = lerp(0.74, 0.98, w / (whorls - 1));
    const y = H * t;
    const spokes = 6 + (w % 2);
    // The umbrella: the lowest whorls reach furthest, so the crown is a
    // broad flat-topped dome and not a ball.
    const len = lerp(11, 3.5, Math.pow(w / (whorls - 1), 0.8)) * (0.9 + r() * 0.2);
    for (let s = 0; s < spokes; s++) {
      const yaw = (s / spokes) * Math.PI * 2 + w * 0.6 + r() * 0.3;
      const dir = V3(Math.cos(yaw), 0, Math.sin(yaw));
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const f = k / 4;
        // Out level, then up at the end: the umbrella's rim.
        pts.push(V3(0, y, 0).addScaledVector(dir, len * f).add(V3(0, -0.4 * f + 1.8 * f ** 3, 0)));
      }
      b.tube(pts, { sides: 5, k: 0, vMetres: 2, radius: f => lerp(0.22, 0.05, f), color: () => barkTint,
                    sway: f => 0.2 + f * 0.3 });
      for (let k = 2; k <= 4; k++) {
        const at = pts[k].clone().add(V3(0, 0.8, 0));
        tuft(b, r, at, crown, lerp(3.8, 5.4, k / 4), k === 4 ? 6 : 3, CELL.scales, foliage, 0.45, { flat: 0.35 });
      }
    }
  }
  if (lod) {
    for (let tier = 0; tier < 3; tier++) {
      const y = H * lerp(0.72, 0.95, tier / 2);
      tuft(b, r, V3(0, y, 0), V3(0, y - 3, 0), lerp(19, 10, tier / 2), 6, CELL.scales, foliage, 0.3, { flat: 0.05 });
    }
  }
  return b.geometry();
}

/** Tree fern: a shaggy trunk and a crown of great arching fronds. */
function treefern(lod, seed) {
  const r = rng(seed), b = new Builder();
  const H = 4.5 + r() * 1.5;
  const bend = V3((r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.8);
  const at = t => V3(0, H * t, 0).addScaledVector(bend, t * t);
  const path = [];
  for (let i = 0; i <= 6; i++) path.push(at(-0.03 + i / 6 * 1.03));
  b.tube(path, { sides: lod ? 5 : 8, k: 0, vMetres: 1.4, uTiles: 1,
                 radius: t => 0.2 + 0.1 * (1 - t) + (t > 0.9 ? 0.12 : 0),
                 color: () => new THREE.Color(0x6a5440), sway: t => t * 0.3 });
  const top = at(1);
  const fronds = lod ? 8 : 15;
  for (let i = 0; i < fronds; i++) {
    const yaw = i * 2.399 + r() * 0.3;
    const dir = V3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = V3(-Math.sin(yaw), 0, Math.cos(yaw));
    const rise = lerp(0.5, 1.2, r());
    const L = 3.2 + r() * 0.8;
    const pts = [], sides = [];
    for (let k = 0; k <= (lod ? 3 : 6); k++) {
      const f = k / (lod ? 3 : 6);
      const a = rise - f * 1.9;                      // arches over and droops
      pts.push(top.clone().addScaledVector(dir, L * f * Math.cos(Math.max(-0.6, a)) * 0.95)
        .add(V3(0, L * f * Math.sin(a) * 0.45 + 0.1, 0)));
      // Pinnae lie near flat: twist the ribbon toward the horizontal.
      sides.push(side.clone().multiplyScalar(1).add(V3(0, 0, 0)));
    }
    b.strip(pts, sides, 1.3, CELL.treefern, {
      color: t => col(0x6b8a45, r, 0.1).multiplyScalar(0.9 + t * 0.2),
      normals: () => V3(0, 1, 0).addScaledVector(dir, 0.4).normalize(),
      sway: t => 0.3 + t * 0.7,
    });
  }
  return b.geometry();
}

/** Cycad: a stout scaly trunk and a crown of stiff, glossy fronds. */
function cycad(lod, seed) {
  const r = rng(seed), b = new Builder();
  const H = 0.8 + r() * 1.2;
  const path = [];
  for (let i = 0; i <= 4; i++) path.push(V3(0, -0.1 + (H + 0.1) * i / 4, 0));
  b.tube(path, { sides: lod ? 5 : 9, k: 0, uTiles: 2, vMetres: 0.6,
                 radius: (t, a) => (0.42 - t * 0.1) * (1 + 0.06 * Math.sin(a * 6 + t * 30)),
                 color: () => new THREE.Color(0x6e5c3e), sway: () => 0 });
  const top = V3(0, H, 0);
  const n = lod ? 9 : 17;
  for (let i = 0; i < n; i++) {
    const yaw = i * 2.399;
    const dir = V3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = V3(-Math.sin(yaw), 0, Math.cos(yaw));
    const rise = lerp(0.35, 1.1, r()), L = 1.7 + r() * 0.5;
    const pts = [];
    for (let k = 0; k <= 3; k++) {
      const f = k / 3, a = rise - f * 0.6;
      pts.push(top.clone().addScaledVector(dir, L * f * Math.cos(a)).add(V3(0, L * f * Math.sin(a), 0)));
    }
    b.strip(pts, side, 1.05, CELL.cycad, {
      color: () => col(0x5d7d3e, r, 0.1), normals: () => UP.clone().addScaledVector(dir, 0.5).normalize(),
      sway: t => t * 0.35,
    });
  }
  return b.geometry();
}

/** Ground fern: a rosette of arching fronds. */
function fern(lod, seed) {
  const r = rng(seed), b = new Builder();
  const n = 8 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const yaw = i * 2.399 + r() * 0.5;
    const dir = V3(Math.cos(yaw), 0, Math.sin(yaw)), side = V3(-Math.sin(yaw), 0, Math.cos(yaw));
    const rise = lerp(1.0, 1.4, r()), L = 1.1 + r() * 0.7;
    // Walk out along the frond, turning over as it goes: up, then arching.
    const pts = [V3(0, 0.02, 0)];
    for (let k = 1; k <= 5; k++) {
      const a = rise - (k / 5) * 1.5, seg = L / 5;
      pts.push(pts[k - 1].clone().addScaledVector(dir, seg * Math.cos(a)).add(V3(0, seg * Math.sin(a), 0)));
    }
    b.strip(pts, side, 0.55, CELL.fern, {
      color: t => col(0x5f8540, r, 0.12).multiplyScalar(0.85 + t * 0.25),
      normals: () => UP.clone().addScaledVector(dir, 0.3).normalize(), sway: t => t * 0.55,
    });
  }
  return b.geometry();
}

/** Giant horsetail: a clump of jointed green stems with whorls of needles. */
function horsetail(lod, seed) {
  const r = rng(seed), b = new Builder();
  for (let s = 0; s < 9; s++) {
    const a = r() * Math.PI * 2, d = r() * 0.5;
    const base = V3(Math.cos(a) * d, -0.1, Math.sin(a) * d);
    const H = 1.6 + r() * 2.2, lean = V3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.1 + r() * 0.25);
    const pts = [];
    for (let k = 0; k <= 5; k++) pts.push(base.clone().add(V3(0, H * k / 5, 0)).addScaledVector(lean, (k / 5) ** 2 * H));
    b.tube(pts, { sides: 4, k: 0, vMetres: 0.5, radius: t => 0.05 * (1 - t * 0.5),
                  color: (t) => new THREE.Color(0x5f7a3a).multiplyScalar(0.9 + (Math.floor(t * 10) % 2) * 0.2),
                  sway: t => t * 0.6 });
    for (let k = 1; k <= 5; k++) {
      const at = pts[k];
      b.card(at, V3(1, 0, 0), V3(0, 0, 1), 0.7, 0.7, CELL.horsetail,
             { color: col(0x6a8a45, r), normal: UP, sway: 0.2 + (k / 5) * 0.5 });
    }
  }
  return b.geometry();
}

/** A shrub: a few woody stems in a mound of leaf clusters. */
function bush(lod, seed) {
  const r = rng(seed), b = new Builder();
  const R = 1.1 + r() * 0.6, Hb = 1.3 + r() * 0.8;
  const centre = V3(0, Hb * 0.5, 0);
  for (let s = 0; s < 4; s++) {
    const a = r() * 6.28;
    b.tube([V3(0, -0.1, 0), V3(Math.cos(a) * 0.4, Hb * 0.5, Math.sin(a) * 0.4)], {
      sides: 4, k: 0, radius: t => 0.07 * (1 - t * 0.6), color: () => new THREE.Color(0x5a4630), sway: () => 0.1,
    });
  }
  const n = lod ? 7 : 16;
  for (let i = 0; i < n; i++) {
    const u = r() * Math.PI * 2, v = Math.acos(lerp(-0.3, 1, r()));
    const p = V3(Math.sin(v) * Math.cos(u) * R, Math.cos(v) * Hb * 0.55 + Hb * 0.45, Math.sin(v) * Math.sin(u) * R);
    const out = p.clone().sub(centre).normalize();
    const right = out.clone().cross(UP).normalize();
    if (right.lengthSq() < 0.1) right.set(1, 0, 0);
    const up = right.clone().cross(out).normalize();
    b.card(p, right, up, 1.3 + r() * 0.5, 1.3 + r() * 0.5, CELL.leaves,
           { color: col(0x587a3a, r, 0.16), normal: crownNormal(p, centre, 0.5), sway: 0.3 });
  }
  return b.geometry();
}

/** A clump of grass: crossed cards of blades. `tall` for the plains. */
function grass(lod, seed, kind = 'grass') {
  const r = rng(seed), b = new Builder();
  const tall = kind === 'tallgrass', reeds = kind === 'reeds';
  const n = reeds ? 4 : tall ? 6 : 6;
  const H = reeds ? 1.9 : tall ? 1.3 : 0.85;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI + r() * 0.4;
    const side = V3(Math.cos(yaw), 0, Math.sin(yaw));
    const off = V3((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6);
    const lean = side.clone().cross(UP).multiplyScalar((r() - 0.5) * 0.4);
    const pts = [0, 0.5, 1].map(f => off.clone().add(V3(0, f * H * (0.85 + r() * 0.3) - 0.05, 0)).addScaledVector(lean, f * f));
    b.strip(pts, side, reeds ? 1.0 : tall ? 1.5 : 1.3, CELL[kind], {
      color: t => col(0xffffff, r, 0.1).multiplyScalar(0.8 + t * 0.25),
      // Lit like the ground it stands on, not like a wall.
      normals: () => UP, sway: t => t * t * (reeds ? 0.5 : 0.35),
    });
  }
  return b.geometry();
}

/** A fallen trunk: long, mossy on top, snapped at one end, a few stubs. */
function log(lod, seed) {
  const r = rng(seed), b = new Builder();
  const L = 11 + r() * 8, R = 0.75 + r() * 0.35;
  const path = [];
  for (let i = 0; i <= (lod ? 3 : 9); i++) {
    const t = i / (lod ? 3 : 9);
    path.push(V3(-L / 2 + L * t, R * 0.55 + Math.sin(t * 3 + seed) * 0.15, Math.sin(t * 2.2) * 0.4));
  }
  const barkC = new THREE.Color(0x76624c), moss = new THREE.Color(0x4f6a2c), heart = new THREE.Color(0xb49468);
  b.tube(path, {
    sides: lod ? 6 : 11, k: 0, uTiles: 3, vMetres: 2.8,
    radius: (t, a) => R * (1 - t * 0.3) * (1 + 0.05 * Math.sin(a * 7 + t * 20)),
    // Moss where rain lands and light is poor: on top.
    color: (t, n) => barkC.clone().lerp(moss, clamp01((n.y - 0.2) * 1.4) * (0.5 + 0.4 * Math.sin(t * 9 + seed))),
    cap: heart, sway: () => 0,
  });
  // The snapped end: splinters.
  const end = path[0];
  for (let i = 0; i < (lod ? 0 : 7); i++) {
    const a = (i / 7) * Math.PI * 2;
    const p0 = end.clone().add(V3(0, Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7));
    b.tube([p0, p0.clone().add(V3(-0.5 - r() * 0.9, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3))], {
      sides: 3, k: 0, radius: f => 0.16 * (1 - f), color: () => heart, sway: () => 0,
    });
  }
  // Branch stubs.
  for (let i = 0; i < (lod ? 0 : 4); i++) {
    const t = 0.2 + r() * 0.7;
    const p0 = V3(-L / 2 + L * t, R * 0.55, 0);
    const d = V3((r() - 0.5) * 0.4, 0.8 + r(), (r() - 0.5) * 1.2).normalize();
    b.tube([p0, p0.clone().addScaledVector(d, R + 0.3 + r() * 0.7)], {
      sides: 4, k: 0, radius: f => 0.16 * (1 - f * 0.7), color: () => barkC, sway: () => 0,
    });
  }
  // Ferns rooted in the rot.
  if (!lod) {
    for (let i = 0; i < 3; i++) {
      const at = V3(-L / 2 + L * (0.25 + r() * 0.6), R * 1.45, (r() - 0.5) * 0.4);
      for (let k = 0; k < 5; k++) {
        const yaw = k * 1.26 + r(), dir = V3(Math.cos(yaw), 0, Math.sin(yaw));
        const pts = [0, 0.5, 1].map(f => at.clone().addScaledVector(dir, f * 0.8).add(V3(0, f * 0.45 - f * f * 0.25, 0)));
        b.strip(pts, V3(-Math.sin(yaw), 0, Math.cos(yaw)), 0.4, CELL.fern,
                { color: () => col(0x6b8f45, r), normals: () => UP, sway: t => t * 0.4 });
      }
    }
  }
  return b.geometry();
}

/** A stump with its roots gripping the ground. */
function stump(lod, seed) {
  const r = rng(seed), b = new Builder();
  const R = 1.1 + r() * 0.5, H = 1.2 + r() * 1.4;
  const barkC = new THREE.Color(0x735a44), heart = new THREE.Color(0xa88c62);
  b.tube([V3(0, -0.3, 0), V3(0, H * 0.5, 0), V3(0, H, 0)], {
    sides: lod ? 6 : 12, k: 0, uTiles: 3, vMetres: 2,
    radius: (t, a) => R * (1 + 0.5 * Math.exp(-t * 5)) * (1 + (t > 0.9 ? 0.15 * Math.sin(a * 9) : 0)),
    color: () => barkC, cap: heart, sway: () => 0,
  });
  for (let i = 0; i < (lod ? 0 : 6); i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.4, dir = V3(Math.cos(a), 0, Math.sin(a));
    const len = 2 + r() * 2.2;
    const pts = [0, 0.33, 0.66, 1].map(f => V3(0, 0.4 - f * 0.8, 0).addScaledVector(dir, R * 0.8 + len * f).add(V3(0, Math.sin(f * 3) * 0.25, 0)));
    b.tube(pts, { sides: 5, k: 0, radius: f => lerp(0.42, 0.08, f), color: () => barkC, sway: () => 0 });
  }
  return b.geometry();
}

/** Deadfall: fallen branches, forked, lying in the litter. */
function branches(lod, seed) {
  const r = rng(seed), b = new Builder();
  const c = new THREE.Color(0x6d5d4a);
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2, L = 2 + r() * 3;
    const p0 = V3((r() - 0.5) * 2, 0.08, (r() - 0.5) * 2);
    const dir = V3(Math.cos(a), 0.02, Math.sin(a));
    const pts = [0, 0.5, 1].map(f => p0.clone().addScaledVector(dir, L * f).add(V3(0, Math.sin(f * 3) * 0.08, 0)));
    b.tube(pts, { sides: 4, k: 0, radius: f => 0.09 * (1 - f * 0.6), color: () => c, sway: () => 0 });
    const fork = pts[1].clone();
    const d2 = V3(Math.cos(a + 0.6), 0.03, Math.sin(a + 0.6));
    b.tube([fork, fork.clone().addScaledVector(d2, L * 0.4)], { sides: 3, k: 0, radius: f => 0.05 * (1 - f * 0.6), color: () => c, sway: () => 0 });
  }
  return b.geometry();
}

/**
 * Fan palm (Sabalites, a late Cretaceous palm): a slender ringed trunk, a
 * crown of stiff fan leaves on long stalks, and last year's dead fronds
 * hanging brown below them.
 */
function palm(lod, seed) {
  const r = rng(seed), b = new Builder();
  const H = 6 + r() * 4;
  const lean = V3((r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6);
  const at = t => V3(0, H * t, 0).addScaledVector(lean, t * t);
  const path = [];
  for (let i = 0; i <= (lod ? 4 : 9); i++) path.push(at(-0.02 + (i / (lod ? 4 : 9)) * 1.02));
  // Leaf scars ring the trunk: banded in the vertex colour.
  b.tube(path, { sides: lod ? 5 : 8, k: 0, uTiles: 2, vMetres: 1.2,
                 radius: t => 0.24 - t * 0.07 + (t < 0.05 ? 0.1 * (1 - t / 0.05) : 0),
                 color: t => new THREE.Color(0x8c775c).multiplyScalar(0.85 + 0.2 * Math.abs(Math.sin(t * 40))),
                 sway: t => t * t * 0.4 });
  const top = at(1);
  const leaves = lod ? 9 : 16;
  const frond = (yaw, rise, tint, dead) => {
    const dir = V3(Math.cos(yaw) * Math.cos(rise), Math.sin(rise), Math.sin(yaw) * Math.cos(rise));
    const stalkLen = 1.3 + r() * 0.5;
    const end = top.clone().addScaledVector(dir, stalkLen);
    b.tube([top, top.clone().addScaledVector(dir, stalkLen * 0.5), end], {
      sides: 3, k: 0, radius: f => lerp(0.05, 0.025, f), color: () => new THREE.Color(dead ? 0x7d6a4a : 0x7a7a42),
      sway: f => 0.3 + f * 0.4,
    });
    // The fan: its base at the stalk's end, spreading on along it and across.
    const side = V3(-Math.sin(yaw), 0, Math.cos(yaw));
    const on = dir.clone().setY(dir.y * 0.4 - 0.25).normalize();
    b.strip([end, end.clone().addScaledVector(on, 1.4), end.clone().addScaledVector(on, 2.6).add(V3(0, -0.3, 0))], side, 2.8,
      CELL.palmfan, { color: () => col(tint, r, 0.1), normals: () => UP.clone().addScaledVector(dir, 0.4).normalize(),
                      sway: t => 0.5 + t * 0.5 });
  };
  for (let i = 0; i < leaves; i++) frond(i * 2.399 + r() * 0.3, lerp(-0.1, 0.9, r()), 0x6f9048, false);
  // The dead skirt.
  for (let i = 0; i < (lod ? 0 : 4); i++) frond(i * 1.57 + r(), -0.9 - r() * 0.4, 0x8a6f45, true);
  return b.geometry();
}

/**
 * Magnolia: a small, open, grey-barked tree of the forest edge, its leathery
 * leaves in clusters at the branch ends and big pale cup flowers among them.
 */
function magnolia(lod, seed) {
  const r = rng(seed), b = new Builder();
  const barkC = new THREE.Color(0x938a7d), leafC = new THREE.Color(0x587d3c);
  const trunkTop = V3((r() - 0.5) * 0.4, 2 + r() * 0.8, (r() - 0.5) * 0.4);
  b.tube([V3(0, -0.1, 0), trunkTop.clone().multiplyScalar(0.5), trunkTop], {
    sides: lod ? 5 : 8, k: 0, vMetres: 1.5, radius: t => 0.2 - t * 0.06, color: () => barkC, sway: t => t * 0.15,
  });
  const centre = trunkTop.clone().add(V3(0, 2.2, 0));
  const branches = lod ? 3 : 6;
  for (let i = 0; i < branches; i++) {
    const yaw = (i / branches) * Math.PI * 2 + r() * 0.5;
    const out = V3(Math.cos(yaw), 0.9 + r() * 0.6, Math.sin(yaw)).normalize();
    const len = 2.4 + r() * 1.6;
    const mid = trunkTop.clone().addScaledVector(out, len * 0.5).add(V3(0, 0.3, 0));
    const tip = trunkTop.clone().addScaledVector(out, len);
    b.tube([trunkTop, mid, tip], { sides: 4, k: 0, vMetres: 1.5, radius: f => lerp(0.1, 0.03, f), color: () => barkC,
                                   sway: f => 0.15 + f * 0.3 });
    tuft(b, r, tip, centre, 1.8, lod ? 2 : 4, CELL.leaves, leafC, 0.45);
    tuft(b, r, mid.clone().lerp(tip, 0.5), centre, 1.5, lod ? 1 : 2, CELL.leaves, leafC, 0.35);
    // Flowers at the tips, facing up and out.
    for (let k = 0; k < (lod ? 2 : 5); k++) {
      const p = tip.clone().add(V3((r() - 0.5) * 1.6, 0.2 + r() * 0.8, (r() - 0.5) * 1.6));
      const face = p.clone().sub(centre).normalize().add(V3(0, 0.8, 0)).normalize();
      const right = face.clone().cross(UP).normalize();
      if (right.lengthSq() < 0.1) right.set(1, 0, 0);
      const up = right.clone().cross(face).normalize();
      b.card(p, right, up, 0.58, 0.58, CELL.flower, { color: new THREE.Color(0xffffff), normal: face, sway: 0.5 });
    }
  }
  return b.geometry();
}

// ── rocks ────────────────────────────────────────────────────────────────────
function noise3(x, y, z) {
  const h = (i, j, k) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let s = 0;
  for (let a = 0; a < 2; a++) for (let b2 = 0; b2 < 2; b2++) for (let c = 0; c < 2; c++) {
    s += h(xi + a, yi + b2, zi + c) * (a ? u : 1 - u) * (b2 ? v : 1 - v) * (c ? w : 1 - w);
  }
  return s;
}

/**
 * A boulder: a subdivided ball, dented and flattened by noise, bedded into the
 * ground, lichen in the light and dark in the cracks. `strata` stacks it into
 * ledges, for spires and crags.
 */
function rockGeometry(seed, { detail = 3, stretch = [1, 0.72, 1.1], strata = 0 } = {}) {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const o = [r() * 50, r() * 50, r() * 50];
  const colors = new Float32Array(p.count * 3);
  const base = new THREE.Color(0x7c7870), dark = new THREE.Color(0x4a4640), lichen = new THREE.Color(0x8a8a58);
  for (let i = 0; i < p.count; i++) {
    const v = V3(p.getX(i), p.getY(i), p.getZ(i));
    const n1 = noise3(v.x * 1.4 + o[0], v.y * 1.4 + o[1], v.z * 1.4 + o[2]);
    const n2 = noise3(v.x * 4 + o[1], v.y * 4 + o[2], v.z * 4 + o[0]);
    let k = 0.72 + n1 * 0.45 + n2 * 0.12;
    v.multiplyScalar(k);
    v.x *= stretch[0]; v.y *= stretch[1]; v.z *= stretch[2];
    if (strata) {
      const band = v.y * strata;
      const step = Math.floor(band) + Math.pow(band - Math.floor(band), 4);
      v.y = lerp(v.y, step / strata, 0.7);
      v.x *= 1 - 0.08 * Math.sin(band * 6.28);
      v.z *= 1 - 0.08 * Math.sin(band * 6.28);
    }
    if (v.y < -0.35 * stretch[1]) v.y = -0.35 * stretch[1] + (v.y + 0.35 * stretch[1]) * 0.25;   // flat-ish base
    p.setXYZ(i, v.x, v.y, v.z);
    const c = base.clone().lerp(dark, clamp01((0.55 - n2) * 1.6)).multiplyScalar(0.85 + n1 * 0.3);
    const up = v.clone().normalize().y;
    c.lerp(lichen, clamp01((up - 0.4) * 1.5) * clamp01((n1 - 0.45) * 3) * 0.6);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  const merged = mergeVertices(g);
  merged.computeVertexNormals();
  return merged;
}

// Icosahedron geometry is non-indexed with split faces; weld it so the
// noise does not tear it apart and it shades smooth.
function mergeVertices(g) {
  const p = g.attributes.position, c = g.attributes.color;
  const map = new Map(), pos = [], cols = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = pos.length / 3;
      map.set(key, k);
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      cols.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  out.setIndex(idx);
  return out;
}

function boulder(lod, seed) { return rockGeometry(seed, { detail: lod ? 1 : 3 }); }

/** A crag: several boulders heaped together with a slab across them. */
function outcrop(lod, seed) {
  const r = rng(seed);
  const parts = [];
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const g = rockGeometry(seed * 13 + i, { detail: lod ? 1 : 2, stretch: [1 + r() * 0.6, 0.7 + r() * 0.8, 1 + r() * 0.5] });
    const s = 1.5 + r() * 2.5;
    g.scale(s, s, s);
    g.rotateY(r() * 6.28);
    g.translate((r() - 0.5) * 5, s * 0.3 + (i === n - 1 ? 2 : 0), (r() - 0.5) * 5);
    parts.push(g);
  }
  return mergeGeos(parts);
}

/** A spire: a tall stacked pillar of rock — a sea stack, or a landmark. */
function spire(lod, seed) {
  const g = rockGeometry(seed, { detail: lod ? 2 : 3, stretch: [1, 4.5, 1.1], strata: 1.3 });
  g.translate(0, 3, 0);
  g.computeVertexNormals();
  return g;
}

function mergeGeos(list) {
  let vc = 0;
  for (const g of list) vc += g.attributes.position.count;
  const pos = new Float32Array(vc * 3), cols = new Float32Array(vc * 3), idx = [];
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    cols.set(g.attributes.color.array, o * 3);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

// ── the cliff drape ──────────────────────────────────────────────────────────
/**
 * Vines draped down a rock face: strands that follow the ground downhill,
 * built from strands [{ pts: [Vector3], side: Vector3, normal: Vector3 }].
 * Built per chunk (each strand fits its own piece of cliff), foliage only.
 */
export function drapeGeometry(strands) {
  const b = new Builder();
  const r = rng(strands.length * 31 + 7);
  for (const s of strands) {
    const len = s.pts.reduce((a, p, i) => i ? a + p.distanceTo(s.pts[i - 1]) : 0, 0);
    b.strip(s.pts, s.side, 0.9 + r() * 0.5, CELL.vine, {
      color: t => col(0x4a6a38, r, 0.1).multiplyScalar(1 - t * 0.2), normals: () => s.normal,
      sway: t => 0.05 + t * 0.25, vTile: Math.max(1, len / 2.4),
    });
  }
  return b.geometry();
}

// ── the species table ────────────────────────────────────────────────────────
// `layer` sets the spacing of the scatter grid (and so the densest it can
// get); `where(site)` is the chance, 0..1, that a grid cell here grows this;
// `rings` is how many chunks out it is drawn (and `farFrom`, from which ring
// the cheap `lod` build is used). Harvestable species carry a `yield`.
//
// `site` is what the terrain knows about the spot:
//   h        height above the sea            slope   0 flat .. 1 sheer
//   forest   0..1, how wooded the country is wet     0 dry .. 1 lush
//   plain    0..1, open grassland            mountain 0..1, in the range
//   river    metres to a river's middle      edge    metres from its water's edge
//   beach    0..1, on the sand
//   cliff    0..1, a sea-cliff coast         shore   metres inland

export const LAYERS = {
  canopy:   { cell: 10 },
  under:    { cell: 4.5 },
  ground:   { cell: 2.3 },
  grass:    { cell: 1.35 },
  debris:   { cell: 14 },
  rock:     { cell: 11 },
  landmark: { cell: 64 },
};

const band = (x, a, b, c, d) => (x <= a || x >= d) ? 0 : x < b ? (x - a) / (b - a) : x > c ? (d - x) / (d - c) : 1;

export const SPECIES = [
  { name: 'redwood', group: 'Canopy trees', habitat: 'moist forest from 6 m up to the treeline; not on steep ground, and set back from the rivers', label: 'Giant redwood', layer: 'canopy', make: redwood, variants: 3, material: 'tree',
    rings: 3, farFrom: 2, scale: [0.72, 1.25], trunk: 2.6, reach: 5.5, regrow: 300, yield: { wood: 8 },
    where: s => s.forest * s.wet * 1.3 * band(s.h, 6, 16, 150, TREE_H) * (s.slope < 0.42 ? 1 : 0) * (s.edge > 18 ? 1 : 0.25) },
  { name: 'araucaria', group: 'Canopy trees', habitat: 'drier forest and its edges, the foothills, and alone out on the plains', label: 'Araucaria', layer: 'canopy', make: araucaria, variants: 2, material: 'tree',
    rings: 3, farFrom: 2, scale: [0.75, 1.3], trunk: 1.4, reach: 3.6, regrow: 220, yield: { wood: 5 },
    // Drier ground than the redwoods, the forest edge, and alone on the plains.
    where: s => (s.forest * (1.05 - s.wet) * 0.9 + s.plain * 0.05 + s.mountain * s.forest * 0.3) *
                band(s.h, 4, 12, TREE_H - 10, TREE_H + 15) * (s.slope < 0.5 ? 1 : 0) },
  { name: 'treefern', group: 'Understorey', habitat: 'under the canopy where it is wet, and along the river banks', label: 'Tree fern', layer: 'under', make: treefern, variants: 3, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.7, 1.4], trunk: 0.35, reach: 2.8, regrow: 120, yield: { leaf: 4 },
    where: s => (s.forest * s.wet * 0.55 + band(s.edge, 1.5, 4, 25, 55) * 0.3) * band(s.h, 3, 8, 140, 170) * (s.slope < 0.55 ? 1 : 0) },
  { name: 'cycad', group: 'Understorey', habitat: 'dry forest, the back of the beach, and scattered across the plains', label: 'Cycad', layer: 'under', make: cycad, variants: 3, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.8, 1.6], trunk: 0.45, reach: 2.6, regrow: 90, yield: { leaf: 3 },
    where: s => (s.forest * (1 - s.wet) * 0.3 + s.plain * 0.05 + band(s.shore, 12, 30, 90, 160) * 0.18) *
                band(s.h, 2.5, 5, 120, 150) * (s.slope < 0.5 ? 1 : 0) },
  { name: 'bush', group: 'Understorey', habitat: 'everywhere below the treeline: thickest at the forest edge and behind the beach', label: 'Shrub', layer: 'under', make: bush, variants: 3, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.7, 1.5], reach: 2.2, regrow: 80, yield: { leaf: 2 },
    where: s => (s.forest * 0.22 + s.plain * 0.06 + (1 - s.forest) * 0.08 + band(s.shore, 5, 14, 40, 80) * 0.2) *
                band(s.h, 2.5, 5, TREE_H, TREE_H + 30) * (s.slope < 0.6 ? 1 : 0) },
  { name: 'palm', group: 'Understorey', habitat: 'the back of the beaches, the river banks and the warm lowlands', label: 'Fan palm', layer: 'under', make: palm, variants: 3, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.75, 1.3], trunk: 0.3, reach: 2.8, regrow: 150, yield: { leaf: 4 },
    where: s => (band(s.shore, 5, 12, 60, 130) * 0.4 + band(s.edge, 2, 5, 22, 45) * 0.3 + s.plain * 0.02) *
                band(s.h, 2, 4, 55, 80) * (s.slope < 0.45 ? 1 : 0) },
  { name: 'magnolia', group: 'Understorey', habitat: 'the forest edge and clearings, where it is moist and there is light', label: 'Magnolia', layer: 'under', make: magnolia, variants: 3, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.8, 1.3], trunk: 0.25, reach: 2.6, regrow: 120, yield: { leaf: 2 },
    where: s => band(s.forest, 0.08, 0.25, 0.55, 0.8) * s.wet * 0.4 * band(s.h, 4, 8, 120, 150) * (s.slope < 0.5 ? 1 : 0) },
  { name: 'horsetail', group: 'Understorey', habitat: 'in stands along the river banks', label: 'Giant horsetail', layer: 'under', make: horsetail, variants: 2, material: 'tree',
    rings: 1, scale: [0.8, 1.4],
    where: s => band(s.edge, 0.5, 2, 12, 26) * 0.7 * band(s.h, 2, 4, 150, 170) },
  { name: 'fern', group: 'Ground cover', habitat: 'the forest floor, thickest where it is wettest, and the river banks', label: 'Fern', layer: 'ground', make: fern, variants: 3, material: 'tree',
    rings: 1, scale: [0.7, 1.5],
    where: s => (s.forest * (0.55 + s.wet * 0.6) + band(s.edge, 1, 3, 20, 40) * 0.4) * band(s.h, 3, 6, 160, 190) * (s.slope < 0.65 ? 1 : 0) },
  { name: 'grass', group: 'Ground cover', habitat: 'open ground: clearings, the coastal plain, the hills above the treeline', label: 'Grass', layer: 'grass', make: (l, sd) => grass(l, sd, 'grass'), variants: 2, material: 'grass',
    rings: 1, scale: [0.7, 1.4],
    where: s => (1 - s.forest * 0.75) * (1 - s.plain * 0.6) * band(s.h, 1.8, 4, 200, 240) * (s.slope < 0.55 ? 1 : 0.2) *
                (s.edge > 0.8 ? 1 : 0) * 0.85 },
  { name: 'tallgrass', group: 'Ground cover', habitat: 'the open plains, waist high and seeding', label: 'Tall grass', layer: 'grass', make: (l, sd) => grass(l, sd, 'tallgrass'), variants: 2, material: 'grass',
    rings: 1, scale: [0.8, 1.35],
    where: s => s.plain * 0.95 * band(s.h, 4, 8, 180, 210) * (s.slope < 0.35 ? 1 : 0) },
  { name: 'reeds', group: 'Ground cover', habitat: 'the river’s shallows and the foot of its banks', label: 'Reeds', layer: 'grass', make: (l, sd) => grass(l, sd, 'reeds'), variants: 1, material: 'grass',
    rings: 1, scale: [0.8, 1.3], aquatic: true,
    // In the shallows at the edge and up the bank, not out in the stream.
    where: s => band(s.edge, -1.2, -0.2, 2.5, 6) * 0.9 },
  { name: 'log', group: 'Deadfall', habitat: 'the forest floor, and washed up on the beaches', label: 'Fallen log', layer: 'debris', make: log, variants: 3, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.7, 1.4], reach: 3.2, regrow: 400, yield: { wood: 4 }, lying: true,
    where: s => (s.forest * 0.5 + s.beach * 0.25) * (s.slope < 0.3 ? 1 : 0) * (s.h > 0.8 ? 1 : 0) },
  { name: 'stump', group: 'Deadfall', habitat: 'the forest floor', label: 'Stump', layer: 'debris', make: stump, variants: 2, material: 'tree',
    rings: 2, farFrom: 2, scale: [0.8, 1.3], trunk: 1.4, reach: 2.8, regrow: 400, yield: { wood: 2 },
    where: s => s.forest * 0.1 * (s.slope < 0.4 ? 1 : 0) * (s.h > 4 ? 1 : 0) },
  { name: 'deadfall', group: 'Deadfall', habitat: 'the forest floor', label: 'Fallen branches', layer: 'ground', make: branches, variants: 2, material: 'tree',
    rings: 1, scale: [0.8, 1.3], reach: 2, regrow: 150, yield: { wood: 1 },
    where: s => s.forest * 0.06 * (s.h > 3 ? 1 : 0) },
  { name: 'boulder', group: 'Rocks', habitat: 'steep ground, the mountains and the river banks; a few on the plains and beaches', label: 'Boulder', layer: 'rock', make: boulder, variants: 4, material: 'rock',
    rings: 3, farFrom: 2, scale: [0.6, 3.2], solid: true,
    where: s => (s.slope * 0.45 + s.mountain * 0.18 + s.plain * 0.03 + s.beach * 0.04 + band(s.edge, 0.5, 1.5, 8, 18) * 0.15 + 0.01) *
                (s.h > 0.5 ? 1 : 0) },
  { name: 'outcrop', group: 'Rocks', habitat: 'crags on the slopes, the escarpments and the mountains; tors on the plains', label: 'Rock outcrop', layer: 'landmark', make: outcrop, variants: 3, material: 'rock',
    rings: 6, farFrom: 2, scale: [1.2, 2.8], solid: true,
    where: s => (s.mountain * 0.6 + s.slope * 0.8 + s.plain * 0.35 + s.mesa * 0.5) * (s.h > 6 ? 1 : 0) * (s.edge > 15 ? 1 : 0) },
  { name: 'spire', group: 'Rocks', habitat: 'sea stacks off the cliff coasts, and lone pillars on the plains — landmarks you can see from afar', label: 'Rock spire', layer: 'landmark', make: spire, variants: 3, material: 'rock',
    rings: 7, farFrom: 2, scale: [3.2, 6.5], solid: true,
    // Sea stacks off the cliff coasts, and pillars standing out of the plains.
    where: s => s.cliff * band(-s.shore, 8, 20, 70, 110) * 0.9 + s.plain * s.rare * 0.8 },
];
const TREE_H = 190;   // the treeline, for the rules above (src/terrain.js has the same)

const cache = new Map();
/** A species' geometry: variant `v`, `lod` 0 near or 1 far. Built once. */
export function speciesGeometry(sp, v = 0, lod = 0) {
  const key = `${sp.name}:${v}:${lod}`;
  let g = cache.get(key);
  if (!g) {
    g = sp.make(lod, 1 + v * 7 + SPECIES.indexOf(sp) * 101);
    cache.set(key, g);
  }
  return g;
}

/** The material (or [bark, foliage] pair) a species is drawn with. */
export function speciesMaterial(sp) {
  const m = floraMaterials();
  return sp.material === 'rock' ? m.rock : sp.material === 'grass' ? m.grass : m.tree;
}

/** One of a species, as a mesh, for looking at on its own (the gallery). */
export function speciesMesh(sp, v = 0, lod = 0) {
  const mesh = new THREE.Mesh(speciesGeometry(sp, v, lod), speciesMaterial(sp));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
