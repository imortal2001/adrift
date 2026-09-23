"""
Build the sea life: fourteen species of low-poly fish and a humpback whale,
with baked vertex colours, exported as one .glb the game draws instanced.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_fish.py [-- --preview OUT_DIR]

Writes assets/models/reef_fish.glb and adds it to the model manifest. Original
work, so nothing goes in CREDITS.md — see the note at the top of that file.

Decisions worth knowing before you edit this:

**No armature.** A hundred fish with a hundred skinned meshes and a hundred
animation mixers is a lot of CPU for a body that only ever does one thing. The
swim is a travelling sine down the length of the body, and a sine is something
the vertex shader can do for free — so these export as static meshes and
src/fish.js bends them on the GPU. That is also why the mesh has rings of
vertices along its length rather than a minimal shell: the wave needs something
to bend.

**Two colour schemes.** The original six reef fish are near-greyscale with
counter-shading baked in, and the game multiplies a per-instance tint over
them — one mesh yields a yellow tang and a blue one. Everything with more than
one hue — a yellowfin's blue back, silver belly and yellow finlets; a blacktip's
black fin tips; a peacock flounder's blue rings — carries a `colors` entry and
bakes real colour instead, and the game leaves those untinted.

**Shaped from the real fish.** Proportions, fin placement and markings follow
what each species actually looks like, because that is what makes a catch
worth looking at: a tuna's crescent tail and finlets, a grouper's rounded tail
and spotted flanks, a shark's long upper tail lobe, a flounder lying flat with
both eyes on top. The research behind them is summarised in README.md.

Facing is **-Y**, matching tools/make_starters.py, which is what the glTF Y-up
export turns into the game's forward. Up is +Z, side is X.
"""
import math
import os
import sys

import bpy

OUT_NAME = "reef_fish.glb"
SEG = 9                      # vertices around each body ring, by default


def _linear(c):
    """Blender colour attributes are linear; the palette below is sRGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(h):
    return (((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def hash2(a, b):
    h = (a * 374761393 + b * 668265263) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


# ── species ──────────────────────────────────────────────────────────────────
# `profile` is the body outline as (t, depth, width) with t running 0 at the
# nose to 1 at the root of the tail, and depth/width as fractions of `length`.
# Deep discs and slim torpedoes are the same code with different numbers.
#
# `bands` (greyscale fish) are vertical stripes in t — the cheapest reef-fish
# marking there is, and it reads from further away than anything else.
#
# `tail.shape` is one of fork (default), lunate, round, shark or fluke.
# `pectoral_style` wing sticks the fins out sideways, the way a shark's, a
# tuna's or a whale's do; the default paddle is a small fin against the flank.

SPECIES = {
    # ── the original reef fish, greyscale + tint ────────────────────────────
    # Deep, laterally flattened disc — a surgeonfish shape. The one that most
    # says "reef" at a glance.
    "tang": dict(
        length=0.20,
        profile=[(0.00, 0.06, 0.03), (0.08, 0.26, 0.09), (0.20, 0.42, 0.12),
                 (0.34, 0.48, 0.13), (0.50, 0.47, 0.12), (0.64, 0.40, 0.10),
                 (0.78, 0.27, 0.07), (0.90, 0.14, 0.04), (1.00, 0.07, 0.03)],
        dorsal=(0.22, 0.80, 0.20), anal=(0.46, 0.84, 0.15),
        tail=dict(span=0.40, sweep=0.20, fork=0.10),
        pectoral=(0.30, 0.15, 0.13), bands=[(0.16, 0.05), (0.60, 0.04)],
        fin_tone=0.72,
    ),
    # Small, neat oval. These are the ones that hang in clouds over the coral.
    "chromis": dict(
        length=0.13,
        profile=[(0.00, 0.05, 0.03), (0.10, 0.20, 0.09), (0.24, 0.29, 0.12),
                 (0.40, 0.31, 0.12), (0.56, 0.28, 0.11), (0.72, 0.21, 0.08),
                 (0.86, 0.12, 0.05), (1.00, 0.06, 0.03)],
        dorsal=(0.24, 0.78, 0.13), anal=(0.52, 0.80, 0.10),
        tail=dict(span=0.30, sweep=0.16, fork=0.09),
        pectoral=(0.32, 0.13, 0.10), bands=[],
        fin_tone=0.80,
    ),
    # Long and cigar-shaped with a pointed snout; breaks up the silhouette of
    # a school made only of ovals.
    "wrasse": dict(
        length=0.24,
        profile=[(0.00, 0.03, 0.02), (0.10, 0.12, 0.07), (0.26, 0.18, 0.10),
                 (0.44, 0.19, 0.10), (0.60, 0.17, 0.09), (0.76, 0.13, 0.07),
                 (0.90, 0.08, 0.04), (1.00, 0.04, 0.02)],
        dorsal=(0.18, 0.84, 0.09), anal=(0.54, 0.84, 0.07),
        tail=dict(span=0.24, sweep=0.14, fork=0.04),
        pectoral=(0.26, 0.14, 0.09), bands=[(0.34, 0.06)],
        fin_tone=0.76,
    ),

    # ── baked colour ────────────────────────────────────────────────────────
    # Red snapper: the classic reef snapper — deep, forked, red above fading to
    # pale pink below, with red eyes.
    "snapper": dict(
        length=0.34, rings=16,
        profile=[(0.00, 0.035, 0.025), (0.08, 0.12, 0.06), (0.20, 0.17, 0.08),
                 (0.36, 0.18, 0.085), (0.52, 0.16, 0.075), (0.68, 0.12, 0.06),
                 (0.84, 0.07, 0.035), (1.00, 0.035, 0.020)],
        dorsal=(0.20, 0.76, 0.10), anal=(0.56, 0.80, 0.07),
        tail=dict(span=0.18, sweep=0.16, fork=0.10),
        pectoral=(0.26, 0.14, 0.08),
        colors=dict(back=0xc8413a, belly=0xf2c7bd, line=0.0, soft=0.45,
                    fin=0xd4574a, eye=0x8a1a14),
    ),
    # Jolthead porgy: deep, silvery-brassy, a steep forehead and a blue line
    # under the eye.
    "porgy": dict(
        length=0.45, rings=16,
        profile=[(0.00, 0.04, 0.020), (0.06, 0.14, 0.045), (0.16, 0.21, 0.065),
                 (0.30, 0.23, 0.070), (0.48, 0.21, 0.065), (0.66, 0.15, 0.050),
                 (0.82, 0.08, 0.030), (1.00, 0.04, 0.020)],
        dorsal=(0.18, 0.78, 0.09), anal=(0.50, 0.80, 0.07),
        tail=dict(span=0.18, sweep=0.16, fork=0.09),
        pectoral=(0.26, 0.18, 0.09),
        colors=dict(back=0xa89878, belly=0xeee9de, line=0.2, soft=0.4, fin=0xc8b89a,
                    stripes=[(0.04, 0.16, -0.25, 0.35, 0x5f86aa)]),
    ),
    # Peacock flounder: a flat disc lying on its blind side, fringed all round
    # by its dorsal and anal fins, with both eyes on the upper side. Sandy, and
    # ringed with blue — it matches whatever it is lying on.
    "flounder": dict(
        length=0.40, rings=20, seg=14, roll=True, eyes="top",
        profile=[(0.00, 0.06, 0.020), (0.06, 0.17, 0.030), (0.18, 0.24, 0.035),
                 (0.36, 0.26, 0.035), (0.56, 0.24, 0.032), (0.74, 0.18, 0.028),
                 (0.88, 0.10, 0.020), (1.00, 0.05, 0.015)],
        dorsal=(0.03, 0.93, 0.06), anal=(0.16, 0.93, 0.06),
        tail=dict(shape="round", span=0.08, sweep=0.14),
        pectoral=(0.22, 0.08, 0.05),
        colors=dict(axis="side", back=0xb49e76, belly=0xf2f0ea, line=0.0, soft=0.12,
                    fin=0xa89270,
                    spots=dict(color=0x4f8fd0, density=0.12, up=(0.3, 1.0), t=(0.08, 0.95))),
    ),
    # King mackerel: a slim, pointed torpedo; iron blue-green over silver, two
    # dorsals, a row of finlets and a crescent tail.
    "mackerel": dict(
        length=0.90, rings=20, seg=12,
        profile=[(0.00, 0.012, 0.010), (0.07, 0.050, 0.035), (0.18, 0.075, 0.048),
                 (0.35, 0.085, 0.050), (0.55, 0.075, 0.045), (0.72, 0.055, 0.035),
                 (0.87, 0.028, 0.020), (1.00, 0.014, 0.012)],
        dorsal=(0.25, 0.45, 0.05), dorsal2=(0.55, 0.64, 0.05), anal=(0.56, 0.65, 0.05),
        finlets=(0.67, 0.95, 8, 0.02),
        tail=dict(shape="lunate", span=0.16, sweep=0.10, fork=0.06),
        pectoral=(0.22, 0.08, 0.05),
        colors=dict(back=0x3e6b88, belly=0xe9eef0, line=0.25, soft=0.2, fin=0x51708a,
                    spots=dict(color=0xd9c25a, density=0.08, up=(-0.1, 0.55), t=(0.15, 0.85))),
    ),
    # Yellowfin tuna: deep blue-black over silver, a golden lateral stripe, long
    # yellow second dorsal and anal fins, yellow finlets and a narrow crescent
    # tail on a pencil-thin peduncle.
    "tuna": dict(
        length=1.20, rings=20, seg=12,
        profile=[(0.00, 0.012, 0.010), (0.05, 0.060, 0.045), (0.12, 0.095, 0.070),
                 (0.25, 0.125, 0.088), (0.40, 0.130, 0.090), (0.55, 0.115, 0.080),
                 (0.70, 0.075, 0.055), (0.85, 0.035, 0.028), (1.00, 0.014, 0.012)],
        dorsal=(0.28, 0.42, 0.07), dorsal2=(0.50, 0.60, 0.14), anal=(0.53, 0.63, 0.13),
        finlets=(0.64, 0.95, 7, 0.025),
        tail=dict(shape="lunate", span=0.22, sweep=0.10, fork=0.06),
        pectoral_style="wing", pectoral=(0.20, 0.13, 0.06, 0.25),
        colors=dict(back=0x1c2f5a, belly=0xdfe6ea, line=0.15, soft=0.25, fin=0x3a4660,
                    stripes=[(0.16, 0.82, -0.2, 0.4, 0xe8c23a)],
                    fins=dict(dorsal2=0xf0c93a, anal=0xf0c93a, finlets=0xf2cf44)),
    ),
    # Great barracuda: very long and slim, a pointed jaw, two small widely
    # separated dorsals; steel grey with dark bars above and black spots low
    # on the tail end.
    "barracuda": dict(
        length=1.30, rings=20, seg=10,
        profile=[(0.00, 0.010, 0.010), (0.05, 0.032, 0.025), (0.14, 0.053, 0.038),
                 (0.32, 0.066, 0.045), (0.55, 0.063, 0.042), (0.75, 0.049, 0.032),
                 (0.90, 0.028, 0.020), (1.00, 0.015, 0.013)],
        dorsal=(0.34, 0.42, 0.045), dorsal2=(0.66, 0.72, 0.04), anal=(0.67, 0.73, 0.04),
        tail=dict(span=0.11, sweep=0.10, fork=0.06),
        pectoral=(0.20, 0.07, 0.04),
        colors=dict(back=0x5a6e72, belly=0xeef2f2, line=0.3, soft=0.2, fin=0x6f7c80,
                    bars=dict(color=0x2f3a3e, count=18, t=(0.2, 0.85), up=(0.2, 1.0)),
                    spots=dict(color=0x1b2224, density=0.10, up=(-0.8, -0.1), t=(0.55, 0.92)),
                    fins=dict(caudal=0x3b4648)),
    ),
    # Coral grouper: heavy and deep with a big head, long spiny dorsal and a
    # rounded tail; red-brown and covered in small blue spots.
    "grouper": dict(
        length=0.80, rings=24, seg=16,
        profile=[(0.00, 0.040, 0.030), (0.07, 0.100, 0.070), (0.18, 0.140, 0.085),
                 (0.35, 0.150, 0.090), (0.55, 0.145, 0.085), (0.72, 0.110, 0.065),
                 (0.86, 0.070, 0.040), (1.00, 0.045, 0.028)],
        dorsal=(0.18, 0.82, 0.07), anal=(0.58, 0.82, 0.07),
        tail=dict(shape="round", span=0.09, sweep=0.12),
        pectoral=(0.24, 0.14, 0.10), eye_r=0.020,
        colors=dict(back=0xa0402f, belly=0xd98a6a, line=-0.1, soft=0.5, fin=0xa84a36,
                    spots=dict(color=0x6fb0e0, density=0.10, up=(-0.7, 1.0), t=(0.06, 0.96)),
                    fins=dict(caudal=0x8a3526)),
    ),
    # Mahi-mahi: a steep blunt forehead, a dorsal running head to tail and a
    # deeply forked tail; blue-green back over gold, speckled blue.
    "mahi": dict(
        length=1.10, rings=22, seg=14,
        profile=[(0.00, 0.050, 0.030), (0.02, 0.110, 0.045), (0.08, 0.140, 0.055),
                 (0.25, 0.135, 0.050), (0.45, 0.110, 0.045), (0.65, 0.080, 0.035),
                 (0.85, 0.040, 0.022), (1.00, 0.020, 0.014)],
        dorsal=(0.04, 0.92, 0.07), anal=(0.48, 0.92, 0.05),
        tail=dict(span=0.18, sweep=0.15, fork=0.12),
        pectoral=(0.18, 0.09, 0.04),
        colors=dict(back=0x2f8f8a, belly=0xf0d64a, line=0.35, soft=0.25, fin=0x2f7fb0,
                    spots=dict(color=0x2c6fb0, density=0.10, up=(-0.3, 0.8), t=(0.08, 0.9)),
                    fins=dict(caudal=0xd8c040)),
    ),
    # Blacktip reef shark: grey-brown over white, a tall first dorsal, the long
    # upper tail lobe of every requiem shark, wide pectorals — and black tips
    # on all of them, which is the whole point of the name.
    "blacktip": dict(
        length=1.50, rings=20, seg=12,
        profile=[(0.00, 0.012, 0.015), (0.04, 0.035, 0.045), (0.12, 0.065, 0.070),
                 (0.26, 0.085, 0.082), (0.42, 0.088, 0.080), (0.58, 0.075, 0.066),
                 (0.74, 0.050, 0.042), (0.88, 0.025, 0.022), (1.00, 0.015, 0.013)],
        dorsal=(0.33, 0.45, 0.11), dorsal_shape="shark", dorsal2=(0.72, 0.77, 0.035),
        anal=(0.74, 0.79, 0.03),
        tail=dict(shape="shark", span=0.17, sweep=0.17),
        pectoral_style="wing", pectoral=(0.22, 0.15, 0.08, 0.30),
        eye_r=0.010,
        colors=dict(back=0x8e8f86, belly=0xf3f1ea, line=-0.05, soft=0.15, fin=0x8a8b82,
                    tips=0x141414),
    ),
    # Humpback whale: vast, dark above and white below, with the long white
    # flippers the species is named for (Megaptera, "big wing") and horizontal
    # flukes. It is not a fish, and it swims by beating those flukes up and
    # down — src/whale.js bends it on the other axis.
    "whale": dict(
        length=12.0, rings=24, seg=14,
        profile=[(0.00, 0.035, 0.040), (0.05, 0.060, 0.070), (0.14, 0.085, 0.100),
                 (0.30, 0.110, 0.120), (0.46, 0.105, 0.110), (0.62, 0.080, 0.080),
                 (0.78, 0.045, 0.042), (0.90, 0.025, 0.022), (1.00, 0.016, 0.014)],
        dorsal=(0.62, 0.69, 0.02), anal=None,
        tail=dict(shape="fluke", span=0.16, sweep=0.12),
        pectoral_style="wing", pectoral=(0.20, 0.30, 0.06, 0.20),
        eye_r=0.006, eye_t=0.14, eye_z=-0.35,
        colors=dict(back=0x2a2e33, belly=0xe8e8e4, line=-0.35, soft=0.25, fin=0x2a2e33,
                    fins=dict(pectoral=0xecebe6)),
    ),
}


class Mesh:
    """Accumulates verts / faces / vertex colours, then hands over a bpy mesh."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def add(self, x, y, z, col):
        self.v.append((x, y, z))
        self.c.append(col if isinstance(col, tuple) else (col, col, col))
        return len(self.v) - 1

    def poly(self, idx):
        self.f.append(tuple(idx))

    def flat(self, points, col, x=0.0):
        """
        A flat polygon in the YZ plane at `x` — every vertical fin is one. `col`
        is one colour or one per point, which is how a fin gets a dark tip.
        """
        cols = col if isinstance(col, list) else [col] * len(points)
        base = [self.add(x, y, z, c) for (y, z), c in zip(points, cols)]
        self.poly(base)

    def cap(self, points, col, axis, eps):
        """
        A patch laid just proud of both faces of a fin — a blacktip's black
        tip. Colour at one vertex only fades across the whole fin; a patch has
        an edge, which is what makes it read as a marking.
        """
        for off in (eps, -eps):
            pts = [tuple(v + (off if i == axis else 0) for i, v in enumerate(p)) for p in points]
            self.poly([self.add(*p, col) for p in (pts if off > 0 else list(reversed(pts)))])

    def sheet(self, points, col):
        """A flat polygon given in full xyz — for fins that stick out sideways."""
        cols = col if isinstance(col, list) else [col] * len(points)
        self.poly([self.add(x, y, z, c) for (x, y, z), c in zip(points, cols)])


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def resample(profile, n):
    """The profile at `n` evenly spaced stations — more rings to bend and paint."""
    if not n or n <= len(profile):
        return profile
    out = []
    for i in range(n):
        t = i / (n - 1)
        for j in range(len(profile) - 1):
            a, b = profile[j], profile[j + 1]
            if a[0] <= t <= b[0]:
                k = (t - a[0]) / ((b[0] - a[0]) or 1)
                out.append((t, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k))
                break
    return out


def body_colour(sp, t, up, side, ring, k):
    """The colour of the hull at t along the body, `up` round it (+1 is the spine)."""
    c = sp.get("colors")
    if not c:
        # Greyscale counter-shading: dark back, bright belly. The floor is well
        # off zero — under 15m of water the dark half goes to silhouette long
        # before the mesh does.
        band = 0.62 if any(abs(t - bt) < bw for bt, bw in sp.get("bands", [])) else 1.0
        s = (0.50 + 0.50 * (0.5 - 0.5 * up)) * band
        return (s, s, s)

    # A flounder is coloured on one side, not along its back: `axis` side.
    v = side if c.get("axis") == "side" else up
    col = mix(rgb(c["belly"]), rgb(c["back"]), smooth(c["line"] - c["soft"], c["line"] + c["soft"], v))
    for (t0, t1, u0, u1, h) in c.get("stripes", []):
        if t0 <= t <= t1 and u0 <= v <= u1:
            col = mix(col, rgb(h), 0.85)
    bars = c.get("bars")
    if bars and bars["t"][0] <= t <= bars["t"][1] and bars["up"][0] <= v <= bars["up"][1]:
        phase = (t - bars["t"][0]) / (bars["t"][1] - bars["t"][0]) * bars["count"]
        if phase % 1.0 < 0.35:
            col = mix(col, rgb(bars["color"]), 0.7)
    sp_ = c.get("spots")
    if sp_ and sp_["t"][0] <= t <= sp_["t"][1] and sp_["up"][0] <= v <= sp_["up"][1]:
        if hash2(ring * 31 + 7, k * 17 + 3) < sp_["density"]:
            col = mix(col, rgb(sp_["color"]), 0.9)
    return col


def fin_colour(sp, which, tip=False):
    c = sp.get("colors")
    if not c:
        tone = sp["fin_tone"] * {"caudal": 0.92, "pectoral": 0.86}.get(which, 1.0)
        return (tone, tone, tone)
    base = rgb(c.get("fins", {}).get(which, c["fin"]))
    if tip and "tips" in c:
        return rgb(c["tips"])
    return base


def body(sp, m):
    """Rings along the length, welded into a hull, coloured as they go."""
    L = sp["length"]
    seg = sp.get("seg", SEG)
    prof = resample(sp["profile"], sp.get("rings"))
    rings = []
    for ri, (t, depth, width) in enumerate(prof):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            up, side = math.cos(a), math.sin(a)
            ring.append(m.add(side * width * L, t * L, up * depth * L,
                              body_colour(sp, t, up, side, ri, k)))
        rings.append(ring)

    for r in range(len(rings) - 1):
        a, b = rings[r], rings[r + 1]
        for k in range(seg):
            k2 = (k + 1) % seg
            m.poly([a[k], a[k2], b[k2], b[k]])
    m.poly(list(reversed(rings[0])))               # nose cap
    m.poly(rings[-1])                              # peduncle cap
    return rings


def outline(sp, t):
    """Half-depth and half-width of the body at t, interpolated."""
    prof = sp["profile"]
    for j in range(len(prof) - 1):
        a, b = prof[j], prof[j + 1]
        if a[0] <= t <= b[0]:
            k = (t - a[0]) / ((b[0] - a[0]) or 1)
            return a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k
    return prof[-1][1], prof[-1][2]


def fins(sp, m):
    L = sp["length"]

    # Dorsal and anal: ridges along the back and underside, following the body
    # outline so they leave the hull rather than the air.
    for key, sign in (("dorsal", 1), ("dorsal2", 1), ("anal", -1)):
        spec = sp.get(key)
        if not spec:
            continue
        t0, t1, h = spec
        r0, r1 = outline(sp, t0)[0] * L * sign, outline(sp, t1)[0] * L * sign
        rm = outline(sp, (t0 + t1) / 2)[0] * L * sign
        col, tip = fin_colour(sp, key), fin_colour(sp, key, tip=True)
        if key == "dorsal" and sp.get("dorsal_shape") == "shark":
            # A shark's first dorsal: a tall triangle, apex forward of centre,
            # trailing edge swept back and notched.
            rf, rb = (t0 * L, r0), (t1 * L, r1)
            notch = ((t1 + 0.03) * L, r1 + 0.03 * L * sign)
            apex = ((t0 + 0.30 * (t1 - t0)) * L, rm + h * L * sign)
            m.flat([rf, rb, notch, apex], col)
            if "tips" in sp.get("colors", {}):
                a, b = lerp2(apex, rf, 0.32), lerp2(apex, notch, 0.40)
                m.cap([(0, *apex), (0, *a), (0, *b)], tip, 0, L * 0.0015)
        else:
            m.flat([(t0 * L, r0), (t1 * L, r1),
                    (t1 * L - 0.02 * L, r1 + h * L * sign * 0.6),
                    ((t0 + t1) * 0.5 * L, rm + h * L * sign)],
                   [col, col, col, tip])

    # Finlets: the little triangles along a tuna's or mackerel's back and belly.
    if sp.get("finlets"):
        t0, t1, n, h = sp["finlets"]
        col = fin_colour(sp, "finlets")
        for i in range(n):
            t = t0 + (t1 - t0) * i / max(1, n - 1)
            dr = outline(sp, t)[0] * L
            for sign in (1, -1):
                m.flat([(t * L, dr * sign), ((t + 0.025) * L, dr * sign),
                        ((t + 0.03) * L, (dr + h * L) * sign)], col)

    tail(sp, m)
    pectorals(sp, m)


def tail(sp, m):
    L = sp["length"]
    tl = sp["tail"]
    shape = tl.get("shape", "fork")
    y0 = L
    col, tip = fin_colour(sp, "caudal"), fin_colour(sp, "caudal", tip=True)
    s, w = tl["span"] * L, tl["sweep"] * L
    if shape == "fork":
        m.flat([(y0, 0.0), (y0 + w, s), (y0 + w - tl["fork"] * L, 0.0), (y0 + w, -s)], col)
    elif shape == "lunate":
        # A crescent, as two blades — each one convex, so it triangulates true.
        n = tl.get("fork", 0.07) * L
        m.flat([(y0, 0.0), (y0 + w, s), (y0 + w - n * 0.4, s * 0.8), (y0 + w - n, 0.0)], col)
        m.flat([(y0, 0.0), (y0 + w - n, 0.0), (y0 + w - n * 0.4, -s * 0.8), (y0 + w, -s)], col)
    elif shape == "round":
        m.flat([(y0, s * 0.45), (y0 + w * 0.75, s), (y0 + w, 0.0), (y0 + w * 0.75, -s), (y0, -s * 0.45)], col)
    elif shape == "shark":
        # Heterocercal: the spine runs up into a long upper lobe.
        up = [(y0, 0.02 * L), (y0 + w, s), (y0 + w * 0.55, 0.02 * L)]
        lo = [(y0, 0.0), (y0 + w * 0.5, 0.0), (y0 + w * 0.38, -s * 0.45)]
        m.flat(up, col)
        m.flat(lo, col)
        if "tips" in sp.get("colors", {}):
            for tri, apex in ((up, 1), (lo, 2)):
                ap = tri[apex]
                o1, o2 = [tri[i] for i in range(3) if i != apex]
                m.cap([(0, *ap), (0, *lerp2(ap, o1, 0.30)), (0, *lerp2(ap, o2, 0.30))],
                      tip, 0, L * 0.0015)
    elif shape == "fluke":
        # Horizontal, in the XY plane: a whale's tail is not a fish's.
        for side in (1, -1):
            pts = [(0.0, y0, 0.0), (side * s, y0 + w, 0.0), (side * s * 0.5, y0 + w, 0.0), (0.0, y0 + w * 0.75, 0.0)]
            m.sheet(pts if side > 0 else list(reversed(pts)), col)


def pectorals(sp, m):
    L = sp["length"]
    col, tip = fin_colour(sp, "pectoral"), fin_colour(sp, "pectoral", tip=True)
    w = max(p[2] for p in sp["profile"]) * L
    if sp.get("pectoral_style") == "wing":
        # Out from the flank, swept back and drooping: (t, span, chord, droop).
        pt, span, chord, droop = sp["pectoral"]
        z0 = -outline(sp, pt)[0] * L * 0.45
        for side in (1, -1):
            root = side * w * 0.8
            tipx = side * (w * 0.8 + span * L)
            pts = [(root, pt * L, z0), (root, (pt + chord) * L, z0),
                   (tipx, (pt + chord * 1.4) * L, z0 - droop * span * L),
                   (tipx, (pt + chord * 1.0) * L, z0 - droop * span * L)]
            m.sheet(pts if side > 0 else list(reversed(pts)), col)
            if "tips" in sp.get("colors", {}):
                rf, rb, tb, tf = pts
                m.cap([lerp3(rf, tf, 0.62), lerp3(rb, tb, 0.62), tb, tf], tip, 2, L * 0.0015)
        return
    pt, pl, ph = sp["pectoral"]
    for side in (1, -1):
        m.flat([(pt * L, 0.0), ((pt + pl) * L, ph * L * 0.35), ((pt + pl * 0.8) * L, -ph * L * 0.55)],
               col, x=side * w * 0.85)


def eyes(sp, m):
    """Two dark beads on the head. Small, and worth every triangle."""
    L = sp["length"]
    t = sp.get("eye_t", 0.11)
    depth, width = outline(sp, t)
    r = L * sp.get("eye_r", 0.028)
    c = sp.get("colors", {})
    col = rgb(c["eye"]) if "eye" in c else (0.05, 0.05, 0.05)
    if sp.get("eyes") == "top":
        # Both eyes on the upper side, one above the other — the flounder's
        # migrated eye. Upper side here is +X; the roll makes it face the sky.
        places = [(1, depth * L * 0.35), (1, -depth * L * 0.05)]
    else:
        places = [(1, depth * L * sp.get("eye_z", 0.30)), (-1, depth * L * sp.get("eye_z", 0.30))]
    for side, cz in places:
        cx = side * width * L * 0.9
        ring = [m.add(cx, t * L + math.cos(a) * r, cz + math.sin(a) * r, col)
                for a in (2 * math.pi * k / 6 for k in range(6))]
        m.poly(ring if side > 0 else list(reversed(ring)))


def build(name, sp):
    m = Mesh()
    body(sp, m)
    fins(sp, m)
    eyes(sp, m)

    verts = m.v
    if sp.get("roll"):
        # Lay it on its side: +X, the eyed side, turns to face +Z. The swim
        # wave in src/fish.js bends along X, which after this is up and down —
        # exactly how a flatfish swims.
        verts = [(-z, y, x) for (x, y, z) in verts]

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], m.f)
    me.validate()
    me.update()

    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(m.c):
        layer.data[i].color = tuple(_linear(v) for v in c) + (1.0,)

    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)

    # Flat-ish shading with a smoothed hull reads better than either extreme.
    for poly in me.polygons:
        poly.use_smooth = True
    return obj


def preview(made, out_dir):
    """A side-on render of each, to check shapes and markings by eye."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.render.resolution_x, scene.render.resolution_y = 640, 360
    cam_data = bpy.data.cameras.new("preview")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("preview", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    for o in made:
        for other in made:
            other.hide_render = other is not o
        xs = [v.co for v in o.data.vertices]
        y0, y1 = min(v.y for v in xs), max(v.y for v in xs)
        z0, z1 = min(v.z for v in xs), max(v.z for v in xs)
        span = max(y1 - y0, (z1 - z0) * 16 / 9)
        cam_data.ortho_scale = span * 1.15
        # From the fish's left — or, for the flounder lying flat, from above.
        if SPECIES[o.name].get("roll"):
            cam.location = (0, (y0 + y1) / 2, z1 + span * 3)
            cam.rotation_euler = (0, 0, math.radians(90))
        else:
            cam.location = (span * 3, (y0 + y1) / 2, (z0 + z1) / 2 + span * 0.35)
            cam.rotation_euler = (math.radians(84), 0, math.radians(90))
        scene.render.filepath = os.path.join(out_dir, f"{o.name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview_dir = argv[argv.index("--preview") + 1] if "--preview" in argv else None

    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    made = []
    for name, sp in SPECIES.items():
        obj = build(name, sp)
        made.append(obj)
        print(f"  {name}: {len(obj.data.vertices)} verts, {len(obj.data.polygons)} faces")

    if preview_dir:
        preview(made, os.path.expanduser(preview_dir))
        for o in made:
            o.hide_render = False

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "assets", "models")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, OUT_NAME)

    bpy.ops.object.select_all(action="DESELECT")
    for o in made:
        o.select_set(True)
    bpy.context.view_layer.objects.active = made[0]

    desired = {
        "filepath": path,
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_animations": False,
        "export_skins": False,
        "export_colors": True,
        "export_vertex_color": "MATERIAL",
        "export_all_vertex_colors": True,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
    }
    try:
        known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    except Exception:
        known = set(desired)
    kwargs = {k: v for k, v in desired.items() if k == "filepath" or k in known}
    bpy.ops.export_scene.gltf(**kwargs)

    kb = os.path.getsize(path) / 1024
    print(f"\n→ {os.path.relpath(path, root)}  ({kb:,.1f} KB)")


if __name__ == "__main__":
    main()
