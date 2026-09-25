// ── Where you start ──────────────────────────────────────────────────────────
// A new castaway comes to somewhere on the edge of the world, never inland:
//
//   shore    washed up on a beach, with nothing — the flotsam is offshore
//   sea      treading water out in the open, the flotsam around you
//   debris   clinging to a single square of wreckage, afloat
//   raft     on the small raft of four lashed pallets
//
// Where that was is kept: it is your starting point, where you wake if you
// die without a statue to wake at (statue.js).

import { heightAt, coastDistance, slopeAt } from './terrain.js';

const KINDS = [['shore', 3], ['sea', 2], ['debris', 2.5], ['raft', 2.5]];
const rand = (a, b) => a + Math.random() * (b - a);

function pickKind() {
  const total = KINDS.reduce((n, [, w]) => n + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of KINDS) if ((r -= w) <= 0) return k;
  return 'raft';
}

/** A beach: just above the waterline, flat enough to stand on, with the sea close by. */
function isBeach(x, z) {
  const h = heightAt(x, z);
  if (h < 0.35 || h > 2.6 || slopeAt(x, z) > 0.12) return false;
  const c = coastDistance(x, z);
  if (c < 1 || c > 30) return false;
  // Open water within a stone's throw — not a pond, not a river bank.
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    if (heightAt(x + Math.cos(a) * 28, z + Math.sin(a) * 28) < -2.5) return true;
  }
  return false;
}

/** Open sea: deep enough to float anything, near enough the coast to see it. */
function isOpenSea(x, z) {
  if (heightAt(x, z) > -5) return false;
  const c = coastDistance(x, z);
  return c < -30 && c > -170;
}

/** The nearest spot from (x, z) that passes `test`, and the yaw that faces it (facing -Z at 0). */
function nearest(x, z, test) {
  for (let r = 6; r <= 90; r += 3) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (test(px, pz)) return { x: px, z: pz, yaw: Math.atan2(-(px - x), -(pz - z)) };
    }
  }
  return null;
}

/**
 * A new start: { kind, x, z, yaw } — for a beach, x, z is on the sand, and
 * `sea` is the nearest open water, for the raft to be built from.
 */
export function pickStart(kind = pickKind()) {
  for (let tries = 0; tries < 3000; tries++) {
    const a = Math.random() * Math.PI * 2, r = rand(30, 700);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (kind === 'shore') {
      if (!isBeach(x, z)) continue;
      // Facing the sea: that is where everything will come from, and where
      // the raft will go — water deep enough to float it.
      const sea = nearest(x, z, (px, pz) => heightAt(px, pz) < -2.5);
      if (!sea) continue;
      return { kind, x, z, yaw: sea.yaw, sea: { x: sea.x, z: sea.z } };
    }
    if (!isOpenSea(x, z)) continue;
    // Out at sea, facing land: something to aim for.
    return { kind, x, z, yaw: nearest(x, z, (px, pz) => heightAt(px, pz) > 0.5)?.yaw ?? 0 };
  }
  // Nowhere found (it should not happen): out at sea, or at worst the old start, on the raft.
  if (kind !== 'sea') return pickStart('sea');
  return { kind: 'raft', x: 0, z: 0, yaw: 0 };
}

/** What you are told when you come to. */
export const WAKING = {
  shore: ['You come to on a beach, soaked, with nothing but what you are wearing.',
          'Flotsam washes about offshore. Gather it (E) — planks and rope make a hammer, and a raft.'],
  sea: ['You come to in the open sea, treading water.',
        'Flotsam drifts all around. Gather it (E), and build a raft to climb onto: a hammer, then a foundation on the water.'],
  debris: ['You come to clinging to a square of wreckage, adrift.',
           'Flotsam drifts past on the current. Gather it (E) — there is a raft to be built from this.'],
  raft: ['You come to on a raft of four lashed pallets. No land in sight.',
         'Debris drifts past on the current. Look at it and press E.'],
};
