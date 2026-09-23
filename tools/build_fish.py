"""
Build the sea life: fourteen species of fish — each with its own face, from
the species descriptions — and a humpback whale, each textured with a painted
colour map and normal map, exported as one .glb the game draws instanced.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_fish.py [-- --preview OUT_DIR]

Writes assets/models/reef_fish.glb and adds it to the model manifest. Original
work, so nothing goes in CREDITS.md — see the note at the top of that file.

Decisions worth knowing before you edit this:

**No armature.** A hundred fish with a hundred skinned meshes and a hundred
animation mixers is a lot of CPU for a body that only ever does one thing. The
swim is a travelling sine down the length of the body, and a sine is something
the vertex shader can do for free — so these export as static meshes and
src/swim.js bends them on the GPU. That is also why the mesh has rings of
vertices along its length rather than a minimal shell: the wave needs something
to bend. Which part of the fish each vertex belongs to rides in the alpha of
its vertex colour, for the shader.

**Textured like the dinosaurs.** They are the benchmark: textured models
with a colour map and a normal map. So every species gets a 1024² atlas
painted by tools/fish_textures.py — overlapping scales in relief, the species'
pattern, mottle, lateral-line pores, fin rays — and a material the exporter
writes as baseColorTexture + normalTexture, the same shape of material the
dinosaurs carry. Vertex colour stays for what the texture does not cover (the
eyes, mouth lines, teeth and other decals point at a white patch of the atlas).

**Two colour schemes.** The yellow tang, chromis and wrasse are painted in
greyscale and the game multiplies a per-instance tint over them. Everything
else carries a `colors` entry — a yellowfin's blue back, silver belly and
yellow finlets; a blacktip's black fin tips; a peacock flounder's blue rings —
and is painted in real colour, which the game leaves untinted.

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
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fish_textures as FT                                   # noqa: E402

OUT_NAME = "reef_fish.glb"
SEG = 14                     # vertices around each body ring, by default
# Mesh density against the species' own numbers. The dinosaurs run 16-29k
# triangles; a fish drawn two hundred times over cannot, but it can be dense
# enough that its outline is smooth and its normal map has something to bend.
RING_SCALE, SEG_SCALE = 1.7, 1.6


def _small(sp):
    # The shoaling fish — chromis, silversides, tangs — are drawn by the
    # hundred and are a few centimetres on screen; their normal map carries
    # the detail, and a lighter mesh keeps two hundred of them affordable.
    return sp["length"] <= 0.2


def rings_of(sp):
    return int(round(sp.get("rings", 18) * (1.25 if _small(sp) else RING_SCALE)))


def seg_of(sp):
    return int(round(sp.get("seg", SEG) * (1.3 if _small(sp) else SEG_SCALE)))


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

# Faces follow the species descriptions — FishBase, the Smithsonian's Shorefishes
# and Caribbean fish databases, Animal Diversity Web and the like (the list is
# in README.md). A fish's face is most of what makes it that fish: a yellow
# tang's long, down-turned snout; a barracuda's jutting jaw and fangs; a
# grouper's mouth running back past its eye; a bull mahi's flat forehead.

SPECIES = {
    # ── greyscale + tint ────────────────────────────────────────────────────
    # Yellow tang (Zebrasoma flavescens): a deep, compressed disc with a steep
    # head, eyes set high, and a long protruding snout, concave above and below,
    # ending in a small down-turned grazing mouth. A pale scalpel on the stalk.
    "tang": dict(
        length=0.20, rings=20, section=1.75,
        texture=dict(scales=90, scale_amount=0.5, roughness=0.55),
        profile=[(0.00, 0.030, 0.018), (0.05, 0.075, 0.035), (0.10, 0.17, 0.07),
                 (0.17, 0.33, 0.105), (0.26, 0.45, 0.125), (0.38, 0.49, 0.13),
                 (0.52, 0.47, 0.12), (0.66, 0.39, 0.10), (0.80, 0.26, 0.07),
                 (0.91, 0.13, 0.04), (1.00, 0.07, 0.03)],
        dorsal=(0.24, 0.80, 0.20), anal=(0.46, 0.84, 0.15),
        fin_styles=dict(dorsal="round"),
        tail=dict(shape="truncate", span=0.40, sweep=0.20),
        pectoral=(0.30, 0.15, 0.13), pelvic=(0.30, 0.10),
        head=dict(mouth=0.035, mouth_up=-0.05, oblique=-0.1, gape=0.3, snout=(0.2, 0.32),
                  gills=[0.27]),
        eye_t=0.18, eye_z=0.4, eye_r=0.032, iris=0x2a2a26,
        bands=[(0.16, 0.05), (0.60, 0.04), (0.885, 0.012)],
        lateral=(0.55, 0.24, 0.85, 1.12),
        fin_tone=0.72,
    ),
    # Blue-green chromis: a small neat oval with a short snout, a small,
    # slightly upturned terminal mouth and a big eye.
    "chromis": dict(
        length=0.13, rings=18,
        texture=dict(scales=26, scale_amount=1.0, roughness=0.5),
        profile=[(0.00, 0.06, 0.03), (0.08, 0.20, 0.09), (0.22, 0.29, 0.12),
                 (0.40, 0.31, 0.12), (0.56, 0.28, 0.11), (0.72, 0.21, 0.08),
                 (0.86, 0.12, 0.05), (1.00, 0.06, 0.03)],
        dorsal=(0.24, 0.78, 0.13), anal=(0.52, 0.80, 0.10),
        tail=dict(span=0.30, sweep=0.16, fork=0.09),
        pectoral=(0.32, 0.13, 0.10), pelvic=(0.33, 0.12),
        head=dict(mouth=0.05, mouth_up=0.05, oblique=0.2, gape=0.25, gills=[0.27]),
        eye_t=0.12, eye_z=0.22, eye_r=0.046, iris=0x8fa4a8,
        bands=[], lateral=(0.55, 0.25, 0.7, 1.12),
        fin_tone=0.80,
    ),
    # Wrasse (Thalassoma): cigar-shaped with a pointed snout, thick lips, a
    # protractile mouth and a pair of canines jutting at the front of each jaw.
    "wrasse": dict(
        length=0.24, rings=20,
        texture=dict(scales=34, scale_amount=0.9, roughness=0.5),
        profile=[(0.00, 0.035, 0.022), (0.08, 0.11, 0.065), (0.24, 0.18, 0.10),
                 (0.44, 0.19, 0.10), (0.60, 0.17, 0.09), (0.76, 0.13, 0.07),
                 (0.90, 0.08, 0.04), (1.00, 0.04, 0.02)],
        dorsal=(0.18, 0.84, 0.09), anal=(0.54, 0.84, 0.07),
        fin_styles=dict(dorsal="round"),
        tail=dict(shape="truncate", span=0.24, sweep=0.14),
        pectoral=(0.26, 0.14, 0.09), pelvic=(0.28, 0.08),
        head=dict(mouth=0.06, mouth_up=-0.1, gape=0.3, lips=True, gills=[0.24],
                  teeth=dict(n=2, size=0.12, t=(0.004, 0.012), width=0.004)),
        eye_t=0.11, eye_z=0.3, eye_r=0.03, iris=0xb04030,
        bands=[(0.34, 0.06)], lateral=(0.55, 0.22, 0.95, 1.14),
        fin_tone=0.76,
    ),

    # ── baked colour ────────────────────────────────────────────────────────
    # Blue tang (Paracanthurus hepatus): royal blue, an oval disc with a
    # pointed snout, a small mouth low on the head and eyes set high; the
    # black "palette" — a band from the eye to the tail that loops back over
    # the upper flank round a blue patch — and a yellow tail with dark edges.
    "bluetang": dict(
        length=0.20, rings=24, seg=18, section=1.8,
        texture=dict(scales=85, scale_amount=0.5, roughness=0.5),
        profile=[(0.00, 0.045, 0.025), (0.06, 0.16, 0.06), (0.16, 0.31, 0.10),
                 (0.32, 0.39, 0.12), (0.50, 0.38, 0.115), (0.66, 0.31, 0.09),
                 (0.80, 0.20, 0.06), (0.91, 0.11, 0.04), (1.00, 0.07, 0.03)],
        dorsal=(0.22, 0.82, 0.13), anal=(0.46, 0.84, 0.11),
        fin_styles=dict(dorsal="round"),
        tail=dict(shape="truncate", span=0.34, sweep=0.2),
        pectoral=(0.28, 0.15, 0.12), pelvic=(0.29, 0.09),
        head=dict(mouth=0.04, mouth_up=-0.4, gape=0.3, snout=(0.16, 0.25), gills=[0.25]),
        eye_t=0.15, eye_z=0.35, eye_r=0.034, iris=0x1c1c20,
        lateral=(0.55, 0.24, 0.85, 1.1),
        colors=dict(back=0x2a5fd0, belly=0x5d8fe0, line=-0.4, soft=0.4, fin=0x1d3f9a, palette=0x0d0f18,
                    fins=dict(caudal=0xf0cf30, pectoral=0xe8c840), tips=0x10131c),
    ),
    # Hardhead silverside (Atherinomorus stipes): small and slender with a
    # head wider than the body, a huge eye — twice the snout — a small oblique
    # mouth, a translucent green back and a bright silver stripe down the side.
    "silverside": dict(
        length=0.13, rings=20, section=2.4,
        texture=dict(scales=38, scale_amount=0.8, roughness=0.38),
        profile=[(0.00, 0.030, 0.028), (0.07, 0.085, 0.065), (0.18, 0.12, 0.085),
                 (0.40, 0.13, 0.08), (0.60, 0.115, 0.07), (0.80, 0.075, 0.045),
                 (1.00, 0.035, 0.022)],
        dorsal=(0.40, 0.50, 0.08), dorsal2=(0.60, 0.72, 0.08), anal=(0.58, 0.74, 0.07),
        fin_styles=dict(dorsal="round", dorsal2="falcate", anal="falcate"),
        tail=dict(span=0.2, sweep=0.14, fork=0.1),
        pectoral=(0.22, 0.12, 0.06), pelvic=(0.38, 0.06),
        head=dict(mouth=0.04, mouth_up=0.25, oblique=0.3, gape=0.2, gills=[0.22]),
        eye_t=0.1, eye_z=0.12, eye_r=0.04, eye_bulge=0.3, iris=0xd6dde0, lateral=None,
        colors=dict(back=0x7fa596, belly=0xeef2f2, line=0.25, soft=0.2, fin=0xc8d4d0,
                    stripes=[(0.12, 0.96, -0.06, 0.22, 0xf6fafc), (0.12, 0.96, 0.22, 0.32, 0x4e6c66)]),
    ),
    # Red snapper: deep, forked, red above fading to pale pink below; a
    # triangular head, a large mouth reaching under the front of its red eye,
    # and the canine teeth every snapper has.
    "snapper": dict(
        length=0.34, rings=22,
        texture=dict(scales=48, scale_amount=1.0, roughness=0.5),
        profile=[(0.00, 0.03, 0.022), (0.08, 0.12, 0.06), (0.20, 0.17, 0.08),
                 (0.36, 0.18, 0.085), (0.52, 0.16, 0.075), (0.68, 0.12, 0.06),
                 (0.84, 0.07, 0.035), (1.00, 0.035, 0.020)],
        dorsal=(0.20, 0.76, 0.10), anal=(0.56, 0.80, 0.07),
        tail=dict(span=0.18, sweep=0.16, fork=0.10),
        pectoral=(0.26, 0.14, 0.08), belly=0.92,
        head=dict(mouth=0.105, mouth_up=-0.25, oblique=0.12, gape=0.35, jaw=0.005, snout=(0.14, 0.12),
                  gills=[0.26], preop=True,
                  teeth=dict(n=2, size=0.09, t=(0.012, 0.03), width=0.004)),
        eye_t=0.12, eye_z=0.32, eye_r=0.03,
        lateral=(0.55, 0.24, 0.95, 1.12),
        colors=dict(back=0xc8413a, belly=0xf2c7bd, line=0.0, soft=0.45,
                    fin=0xd4574a, eye=0xc02a1c),
    ),
    # Jolthead porgy: a deep body and a long, sloping snout; a large mouth with
    # thick lips and a heavy lower jaw, orange at the corner; a blue line along
    # the lower rim of the eye, and pale stripes below it and toward the mouth.
    "porgy": dict(
        length=0.45, rings=22,
        texture=dict(scales=44, scale_amount=1.0, roughness=0.48),
        profile=[(0.00, 0.035, 0.02), (0.06, 0.12, 0.042), (0.16, 0.20, 0.063),
                 (0.30, 0.23, 0.070), (0.48, 0.21, 0.065), (0.66, 0.15, 0.050),
                 (0.82, 0.08, 0.030), (1.00, 0.04, 0.020)],
        dorsal=(0.20, 0.78, 0.09), anal=(0.50, 0.80, 0.07),
        tail=dict(span=0.18, sweep=0.16, fork=0.09),
        pectoral=(0.26, 0.18, 0.09), belly=0.9,
        head=dict(mouth=0.075, mouth_up=-0.5, oblique=0.08, gape=0.3, jaw=0.004, snout=(0.2, 0.3),
                  lips=0xc9b89a, corner=0xe08a3a, gills=[0.25], preop=True),
        eye_t=0.15, eye_z=0.42, eye_r=0.03, iris=0xb8a86a,
        marks=[dict(type="eyerim", arc=(195, 345), color=0x3f8fd8, w=0.3),
               dict(type="path", pts=[(0.13, 0.12), (0.10, -0.05), (0.075, -0.25)], w=0.07, color=0xe9e4d6),
               dict(type="path", pts=[(0.15, -0.02), (0.13, -0.2), (0.105, -0.36)], w=0.06, color=0xe9e4d6)],
        lateral=(0.55, 0.22, 0.95, 1.1),
        colors=dict(back=0xa89878, belly=0xeee9de, line=0.2, soft=0.4, fin=0xc8b89a, face=(0.2, 0x6e5838)),
    ),
    # Peacock flounder: a flat disc lying on its blind side, fringed all round
    # by its dorsal and anal fins, both eyes on the upper side — widely spaced
    # and raised on short stalks — and a small mouth ending under the front of
    # the lower eye. Sandy, and ringed with blue.
    "flounder": dict(
        length=0.40, rings=24, seg=16, roll=True, eyes="top",
        texture=dict(scales=70, scale_amount=0.6, roughness=0.6), ring_spots=True,
        profile=[(0.00, 0.06, 0.020), (0.06, 0.17, 0.030), (0.18, 0.24, 0.035),
                 (0.36, 0.26, 0.035), (0.56, 0.24, 0.032), (0.74, 0.18, 0.028),
                 (0.88, 0.10, 0.020), (1.00, 0.05, 0.015)],
        dorsal=(0.03, 0.93, 0.06), anal=(0.16, 0.93, 0.06),
        fin_styles=dict(dorsal="round", anal="round"),
        tail=dict(shape="round", span=0.08, sweep=0.14),
        pectoral=(0.22, 0.08, 0.05), pelvic=None,
        head=dict(mouth=0.075, mouth_up=-0.25, oblique=0.15, gape=0.25, gills=[0.2], nares=False),
        eye_t=0.12, eye_r=0.03, eye_bulge=1.1, iris=0x8a8a6a,
        colors=dict(axis="side", back=0xb49e76, belly=0xf2f0ea, line=0.0, soft=0.12,
                    fin=0xa89270,
                    spots=dict(color=0x4f8fd0, density=0.12, size=0.06, up=(0.3, 1.0), t=(0.08, 0.95))),
    ),
    # King mackerel: a slim, pointed torpedo with a snout shorter than the
    # rest of its head, a large mouth with the end of the jaw bone showing and
    # knife-like triangular teeth; the lateral line drops abruptly under the
    # second dorsal and runs wavy to the tail.
    "mackerel": dict(
        length=0.90, rings=26, seg=14, section=2.0,
        texture=dict(scales=120, scale_amount=0.35, roughness=0.4),
        profile=[(0.00, 0.012, 0.010), (0.07, 0.050, 0.035), (0.18, 0.075, 0.048),
                 (0.35, 0.085, 0.050), (0.55, 0.075, 0.045), (0.72, 0.055, 0.035),
                 (0.87, 0.028, 0.020), (1.00, 0.014, 0.012)],
        dorsal=(0.25, 0.45, 0.05), dorsal2=(0.55, 0.64, 0.05), anal=(0.56, 0.65, 0.05),
        fin_styles=dict(dorsal2="falcate", anal="falcate"),
        finlets=(0.67, 0.95, 8, 0.02),
        tail=dict(shape="lunate", span=0.16, sweep=0.10),
        pectoral=(0.22, 0.08, 0.05), pelvic=(0.28, 0.04),
        head=dict(mouth=0.105, mouth_up=-0.2, oblique=0.05, gape=0.3, jaw=0.006, gills=[0.2],
                  teeth=dict(n=9, size=0.07, t=(0.01, 0.085), width=0.003)),
        eye_t=0.105, eye_z=0.3, eye_r=0.02,
        lateral=(0.5, 0.2, 0.97, 0.78),
        lateral_path=[(0.2, 0.6), (0.48, 0.55), (0.58, 0.12), (0.7, 0.18), (0.82, 0.08), (0.97, 0.12)],
        colors=dict(back=0x3e6b88, belly=0xe9eef0, line=0.25, soft=0.2, fin=0x51708a,
                    spots=dict(color=0xd9c25a, density=0.08, size=0.03, up=(-0.1, 0.55), t=(0.15, 0.85))),
    ),
    # Yellowfin tuna: a conical snout, a small eye and a small mouth ending
    # well before it; deep blue-black over silver, a golden stripe, long yellow
    # sickle fins, yellow finlets and a narrow crescent tail.
    "tuna": dict(
        length=1.20, rings=24, seg=14, section=2.1,
        texture=dict(scales=140, scale_amount=0.3, roughness=0.4),
        profile=[(0.00, 0.010, 0.009), (0.05, 0.058, 0.044), (0.12, 0.095, 0.070),
                 (0.25, 0.125, 0.088), (0.40, 0.130, 0.090), (0.55, 0.115, 0.080),
                 (0.70, 0.075, 0.055), (0.85, 0.035, 0.028), (1.00, 0.014, 0.012)],
        dorsal=(0.28, 0.42, 0.07), dorsal2=(0.50, 0.60, 0.17), anal=(0.53, 0.63, 0.16),
        fin_styles=dict(dorsal2="falcate", anal="falcate"),
        finlets=(0.64, 0.95, 7, 0.025),
        tail=dict(shape="lunate", span=0.22, sweep=0.10),
        pectoral_style="wing", pectoral=(0.20, 0.13, 0.06, 0.25), pelvic=(0.24, 0.05),
        head=dict(mouth=0.065, mouth_up=-0.18, oblique=0.05, gape=0.22, gills=[0.21], preop=True),
        eye_t=0.105, eye_z=0.25, eye_r=0.017, iris=0x3a3a30,
        colors=dict(back=0x1c2f5a, belly=0xdfe6ea, line=0.15, soft=0.25, fin=0x3a4660,
                    stripes=[(0.16, 0.82, -0.2, 0.4, 0xe8c23a)],
                    fins=dict(dorsal2=0xf0c93a, anal=0xf0c93a, finlets=0xf2cf44)),
    ),
    # Great barracuda: a large, pointed, pike-like head, flat on top; a big
    # mouth with the lower jaw jutting past the upper, and fangs of unequal
    # size showing even with it closed. Steel grey with dark bars above and
    # black spots low on the tail end.
    "barracuda": dict(
        length=1.30, rings=34, seg=12, section=2.0,
        texture=dict(scales=90, scale_amount=0.6, roughness=0.45),
        profile=[(0.00, 0.008, 0.008), (0.05, 0.030, 0.024), (0.14, 0.052, 0.038),
                 (0.32, 0.066, 0.045), (0.55, 0.063, 0.042), (0.75, 0.049, 0.032),
                 (0.90, 0.028, 0.020), (1.00, 0.015, 0.013)],
        dorsal=(0.34, 0.42, 0.045), dorsal2=(0.66, 0.72, 0.04), anal=(0.67, 0.73, 0.04),
        fin_styles=dict(dorsal2="falcate", anal="falcate"),
        tail=dict(span=0.11, sweep=0.10, fork=0.06),
        pectoral=(0.20, 0.07, 0.04), pelvic=(0.38, 0.04),
        head=dict(mouth=0.14, mouth_up=-0.15, oblique=0.06, gape=0.35, jaw=0.024, flat_top=(0.2, 0.3),
                  gills=[0.19], preop=True,
                  teeth=dict(n=8, size=0.2, t=(0.012, 0.11), width=0.004, uneven=True)),
        eye_t=0.115, eye_z=0.35, eye_r=0.013, eye_bulge=0.3, iris=0xd8c890,
        lateral=(0.3, 0.2, 0.95, 1.15),
        colors=dict(back=0x5a6e72, belly=0xeef2f2, line=0.3, soft=0.2, fin=0x6f7c80,
                    bars=dict(color=0x2f3a3e, count=13, t=(0.2, 0.85), up=(0.2, 1.0)),
                    spots=dict(color=0x1b2224, density=0.10, size=0.02, up=(-0.8, -0.1), t=(0.55, 0.92)),
                    fins=dict(caudal=0x3b4648)),
    ),
    # Coral grouper: heavy and deep, the head flat between the eyes, a huge
    # mouth whose jaw bone reaches past the back of the eye, a protruding
    # lower jaw and thick lips, and a rounded preopercle. Red-brown and covered
    # in small blue spots.
    "grouper": dict(
        length=0.80, rings=28, seg=16,
        texture=dict(scales=110, scale_amount=0.5, roughness=0.55),
        profile=[(0.00, 0.040, 0.030), (0.07, 0.100, 0.070), (0.18, 0.140, 0.085),
                 (0.35, 0.150, 0.090), (0.55, 0.145, 0.085), (0.72, 0.110, 0.065),
                 (0.86, 0.070, 0.040), (1.00, 0.045, 0.028)],
        dorsal=(0.20, 0.82, 0.07), anal=(0.58, 0.82, 0.07),
        tail=dict(shape="round", span=0.09, sweep=0.12),
        pectoral=(0.26, 0.14, 0.10), pelvic=(0.28, 0.10),
        head=dict(mouth=0.15, mouth_up=-0.22, oblique=0.1, gape=0.45, jaw=0.014, flat_top=(0.22, 0.2),
                  lips=True, gills=[0.28], preop=True,
                  teeth=dict(n=2, size=0.07, t=(0.01, 0.025), width=0.004)),
        eye_t=0.12, eye_z=0.42, eye_r=0.017,
        lateral=(0.55, 0.26, 0.95, 1.1),
        colors=dict(back=0xa0402f, belly=0xd98a6a, line=-0.1, soft=0.5, fin=0xa84a36,
                    eye=0xb89a50,
                    spots=dict(color=0x6fb0e0, density=0.10, size=0.022, up=(-0.7, 1.0), t=(0.06, 0.96)),
                    fins=dict(caudal=0x8a3526)),
    ),
    # Mahi-mahi — a bull: the tall, flat, near-vertical forehead of the male,
    # a small eye set low near the mouth, a dorsal running head to tail and a
    # deeply forked tail; blue-green back over gold, speckled blue.
    "mahi": dict(
        length=1.10, rings=26, seg=14, section=1.9,
        texture=dict(scales=130, scale_amount=0.3, roughness=0.42),
        profile=[(0.00, 0.095, 0.024), (0.012, 0.135, 0.038), (0.05, 0.148, 0.05),
                 (0.25, 0.135, 0.050), (0.45, 0.110, 0.045), (0.65, 0.080, 0.035),
                 (0.85, 0.040, 0.022), (1.00, 0.020, 0.014)],
        dorsal=(0.03, 0.92, 0.07), anal=(0.48, 0.92, 0.05),
        fin_styles=dict(dorsal="crest"),
        tail=dict(span=0.18, sweep=0.15, fork=0.12),
        pectoral=(0.18, 0.09, 0.04), pelvic=(0.2, 0.06),
        head=dict(mouth=0.06, mouth_up=-0.62, oblique=0.1, gape=0.2, snout=(0.1, 0.35), gills=[0.19]),
        eye_t=0.07, eye_z=-0.15, eye_r=0.017, iris=0x6a5a30,
        colors=dict(back=0x2f8f8a, belly=0xf0d64a, line=0.35, soft=0.25, fin=0x2f7fb0,
                    spots=dict(color=0x2c6fb0, density=0.10, size=0.022, up=(-0.3, 0.8), t=(0.08, 0.9)),
                    fins=dict(caudal=0xd8c040)),
    ),
    # Blacktip reef shark: a short, broadly rounded snout, flattened; moderately
    # large oval eyes; nostrils under the snout, each with a nipple-shaped flap;
    # an arched, down-turned mouth set underneath, with serrated triangular
    # teeth; five gill slits. Grey-brown over white — and black fin tips.
    "blacktip": dict(
        length=1.50, rings=26, seg=14, section=2.3, smooth_fins=True,
        texture=dict(scales=0, denticles=True, flank_band=True, normal=1.5, roughness=0.5),
        profile=[(0.00, 0.014, 0.020), (0.04, 0.036, 0.048), (0.12, 0.065, 0.072),
                 (0.26, 0.085, 0.082), (0.42, 0.088, 0.080), (0.58, 0.075, 0.066),
                 (0.74, 0.050, 0.042), (0.88, 0.025, 0.022), (1.00, 0.015, 0.013)],
        dorsal=(0.33, 0.45, 0.11), dorsal2=(0.72, 0.77, 0.035), anal=(0.74, 0.79, 0.03),
        fin_styles=dict(dorsal="shark", dorsal2="falcate", anal="falcate"),
        tail=dict(shape="shark", span=0.17, sweep=0.17),
        pectoral_style="wing", pectoral=(0.22, 0.15, 0.08, 0.30), pelvic=(0.6, 0.05),
        head=dict(mouth=0.12, mouth_up=-0.62, arch=0.12, oblique=-0.15, gape=0.2, snout_flat=0.3,
                  gills=[0.16, 0.175, 0.19, 0.205, 0.22], nares="shark",
                  teeth=dict(n=10, size=0.05, t=(0.03, 0.11), width=0.004, color=0xe8e4d8)),
        # A moderately large oval eye set in the head under a fold of lid, with
        # the pale edge of the nictitating membrane below it, a vertical slit
        # pupil, and an iris golden near the pupil and olive-dark outside it.
        eye_t=0.085, eye_z=0.3, eye_r=0.0135, eye_shape=(1.5, 0.88), pupil="slit", slit=0.3,
        eye_bulge=0.2, iris=0x4a4630,
        eye_rings=[(0.72, 1.0, 0x040404, True), (0.8, 0.92, 0x7c7442, False), (0.94, 0.7, 0x4a4630, False),
                   (1.03, 0.5, 0x121210, False), (1.28, 0.0, 0x3a3a34, False)],
        eye_lids=dict(cover=0.24, third=0.12, lower=0xb9bbb4),
        colors=dict(back=0x8e8f86, belly=0xf3f1ea, line=-0.05, soft=0.15, fin=0x8a8b82,
                    tips=0x141414),
    ),
    # Humpback whale: vast, dark above and white below, with long white
    # flippers, throat pleats and horizontal flukes. Its head is its own: a
    # broad flat rostrum studded with tubercles — golf-ball knobs, each with a
    # hair — more on the jaw and chin, twin blowholes behind a raised
    # splashguard, and a long mouth line with the small eye just past its
    # corner.
    "whale": dict(
        length=12.0, rings=30, seg=14, smooth_fins=True, pleats=True, tubercles=True, blowholes=0.2,
        texture=dict(scales=0, whale=True, normal=2.6, roughness=0.45),
        profile=[(0.00, 0.035, 0.040), (0.05, 0.060, 0.070), (0.14, 0.085, 0.100),
                 (0.30, 0.110, 0.120), (0.46, 0.105, 0.110), (0.62, 0.080, 0.080),
                 (0.78, 0.045, 0.042), (0.90, 0.025, 0.022), (1.00, 0.016, 0.014)],
        dorsal=(0.62, 0.69, 0.02), anal=None, fin_styles=dict(dorsal="falcate"),
        tail=dict(shape="fluke", span=0.16, sweep=0.12),
        pectoral_style="wing", pectoral=(0.26, 0.30, 0.06, 0.20), pelvic=None,
        head=dict(mouth=0.25, mouth_up=-0.2, arch=-0.25, gape=0.08, gills=[], nares=False),
        eye_t=0.26, eye_z=-0.2, eye_r=0.006, eye_bulge=0.2, iris=0x3a3a38,
        colors=dict(back=0x2a2e33, belly=0xe8e8e4, line=-0.35, soft=0.25, fin=0x2a2e33,
                    fins=dict(pectoral=0xecebe6)),
    ),
}


# What each vertex belongs to, for the swim shader: it reads this from the
# first UV channel (u = part + flex) and moves each part its own way — the body
# bends with the wave, paired fins row, median fins ripple, the tail lags.
# `flex` runs 0 at a fin's root to 1 at its edge.
BODY, MEDIAN, CAUDAL, PAIRED, EYE = 0, 1, 2, 3, 4


class Mesh:
    """Accumulates verts / faces / colours / part tags, then hands over a bpy mesh."""

    def __init__(self):
        self.v, self.f, self.c, self.u, self.uv = [], [], [], [], []
        self.fuv = {}            # face index -> per-loop UVs, where a face crosses a seam
        self.fins = {}           # atlas slot -> what the texture needs to paint that fin

    def add(self, x, y, z, col, part=BODY, flex=0.0, uv=None):
        self.v.append((x, y, z))
        self.c.append(col if isinstance(col, tuple) else (col, col, col))
        self.u.append(part + min(0.99, max(0.0, flex)))
        # Anything that does not say otherwise samples the atlas's white slot,
        # so its vertex colour shows through as it is: decals, eyes, teeth.
        self.uv.append(uv or FT.WHITE_UV)
        return len(self.v) - 1

    def poly(self, idx, uvs=None):
        if uvs is not None:
            self.fuv[len(self.f)] = uvs
        self.f.append(tuple(idx))

    def poly_out(self, idx):
        """A face on the skin, wound so it faces out, away from the body's
        axis — decals are built from both sides and either direction along
        the hull, and one wound inward shades black."""
        a, b, c = (self.v[i] for i in idx[:3])
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        cx = sum(self.v[i][0] for i in idx) / len(idx)
        cz = sum(self.v[i][2] for i in idx) / len(idx)
        self.f.append(tuple(idx) if n[0] * cx + n[2] * cz >= 0 else tuple(reversed(idx)))


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


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


def outline(sp, t):
    """Half-depth and half-width of the body at t, interpolated."""
    prof = sp["profile"]
    t = max(0.0, min(1.0, t))
    for j in range(len(prof) - 1):
        a, b = prof[j], prof[j + 1]
        if a[0] <= t <= b[0]:
            k = (t - a[0]) / ((b[0] - a[0]) or 1)
            return a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k
    return prof[-1][1], prof[-1][2]


# ── colour ───────────────────────────────────────────────────────────────────
def base_colour(sp, t, up, side, ring, k):
    """The hull's pattern at t along the body, `up` round it (+1 is the spine)."""
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
    fm = c.get("face")
    if fm:
        # A differently coloured face — the jolthead's brown one.
        col = mix(col, rgb(fm[1]), smooth(fm[0], fm[0] - 0.06, t) * smooth(-0.7, -0.3, v))
    pal = c.get("palette")
    if pal is not None:
        # The blue tang's palette: a black band from the eye to the tail base
        # that loops back forward along the upper flank, round a blue patch.
        band = 0.12 < t < 0.9 and 0.08 < v < 0.6
        loop = (0.64 < t < 0.9 and 0.6 <= v < 0.86) or (0.3 < t < 0.9 and v >= 0.86)
        if band or loop:
            col = rgb(pal)
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


def body_colour(sp, t, up, side, ring, k):
    """The pattern, plus the anatomy painted over it: lips, gill cover, lateral
    line, and a faint mottle so no flank is one flat colour."""
    col = base_colour(sp, t, up, side, ring, k)
    head = sp.get("head", {})

    # The lips: a dark crease where the jaws meet, fading back from the snout
    # (the line itself is a decal; see face()).
    mt, mu = head.get("mouth", 0.07), head.get("mouth_up", -0.22)
    if t < mt and abs(up - mu) < 0.3:
        k_ = (1 - abs(up - mu) / 0.3) * (1 - t / mt) ** 0.6
        col = mix(col, shade(col, 0.28), 0.85 * k_)

    # A whale's throat pleats: long grooves down the underside of the head.
    if sp.get("pleats") and t < 0.45 and up < -0.5:
        col = shade(col, 0.78 if k % 2 else 1.0)

    # Mottle. Real skin is never one flat colour, and the swim shader lights
    # each vertex anyway.
    return shade(col, 0.95 + 0.10 * hash2(ring * 13 + 1, k * 7 + 5))


def fin_colour(sp, which):
    c = sp.get("colors")
    if not c:
        tone = sp["fin_tone"] * {"caudal": 0.92, "pectoral": 0.86, "pelvic": 0.86}.get(which, 1.0)
        return (tone, tone, tone)
    return rgb(c.get("fins", {}).get(which, c["fin"]))


def tip_colour(sp):
    c = sp.get("colors") or {}
    return rgb(c["tips"]) if "tips" in c else None


# ── the hull ─────────────────────────────────────────────────────────────────
def mouth_line(head, t):
    """How far round the hull the jaws meet at t: `mouth_up` at the corner,
    tilted by `oblique` toward the front (an upturned mouth is positive) and
    bowed by `arch` (a shark's crescent)."""
    mt, mu = head.get("mouth", 0.07), head.get("mouth_up", -0.22)
    k = max(0.0, min(1.0, t / mt)) if mt > 0 else 1.0
    return mu + head.get("oblique", 0.0) * (1 - k) - head.get("arch", 0.0) * math.sin(math.pi * k)


def hull(sp, t, up, side, lift=0.0):
    """
    A point on the hull at t along the body and (up, side) round it — the one
    shape everything is built on, so the rings, the decals and the eyes all
    agree about where the skin is.

    The head is where species differ most, and it is shaped here:
      snout      (length, drop): the front of the head shifted down (or up),
                 so a tang's mouth sits at the bottom of a long snout and a
                 bull mahi's under a flat, vertical forehead
      flat_top   a flattened crown — a barracuda's, a grouper's
      snout_flat a shark's snout: wider than it is deep
      mouth      the hull pinched along the line of the jaws (mouth_line)
      jaw        the lower jaw reaching past the upper
    """
    L = sp["length"]
    depth, width = outline(sp, t)
    head = sp.get("head", {})
    e = 2 / sp.get("section", 2.2)
    su = math.copysign(abs(up) ** e, up)
    ss = math.copysign(abs(side) ** e, side)
    d = depth * (sp.get("belly", 1.0) if up < 0 else 1.0)
    w = width
    y = t * L
    zc = 0.0
    sn = head.get("snout")
    if sn and t < sn[0]:
        zc = -sn[1] * outline(sp, sn[0])[0] * (1 - t / sn[0]) ** 2
    ft = head.get("flat_top")
    if ft and up > 0.3 and t < ft[0]:
        d *= 1 - ft[1] * (1 - t / ft[0]) * (up - 0.3) / 0.7
    sf = head.get("snout_flat")
    if sf and t < 0.16:
        k = 1 - t / 0.16
        d *= 1 - sf * k
        w *= 1 + sf * 0.35 * k
    # The crease is kept shallow: pinched deep, the groove falls into shadow
    # and reads as a black band. The mouth decal draws the line itself.
    mt, gape, jaw = head.get("mouth", 0.07), min(0.16, head.get("gape", 0.25)), head.get("jaw", 0.0)
    ml = mouth_line(head, t)
    if t < mt and abs(up - ml) < 0.3:
        pinch = gape * (1 - abs(up - ml) / 0.3) * (1 - t / mt)
        d *= 1 - pinch * 0.5
        w *= 1 - pinch
    if jaw and t < 0.06 and up < ml:
        y -= jaw * L * (1 - t / 0.06)
    gills = head.get("gills", [0.24])
    if any(gt - 0.03 < t < gt for gt in gills[:1]) and abs(up) < 0.8:
        w *= 1.035
    return (ss * w * L * (1 + lift), y, (su * d + zc) * L * (1 + lift * 0.3))


def surface(sp, t, up, sgn, lift=0.0):
    """
    The skin at (t, up) on side `sgn`, raised `lift` off it — interpolated
    from the mesh's own vertices, not from the ideal shape. The two differ
    where the hull bends sharply between vertices (the crease of the mouth
    most of all), and a decal placed on the ideal shape ends up buried inside
    the real one. `lift` pushes out from the head's axis, as a fraction of the
    distance to it.
    """
    seg = seg_of(sp)
    st = [p[0] for p in resample(sp["profile"], rings_of(sp))]
    t = max(0.0, min(1.0, t))
    j = max(0, min(len(st) - 2, next((i for i in range(len(st) - 1) if st[i] <= t <= st[i + 1]), len(st) - 2)))
    ft = (t - st[j]) / ((st[j + 1] - st[j]) or 1)
    side = sgn * math.sqrt(max(0.0, 1 - up * up))
    a = math.atan2(side, up) % (2 * math.pi)
    k = a / (2 * math.pi / seg)
    k0 = int(math.floor(k)) % seg
    fk = k - math.floor(k)

    def ring(tj, kk):
        aa = 2 * math.pi * kk / seg
        return hull(sp, tj, math.cos(aa), math.sin(aa))

    p00, p01 = ring(st[j], k0), ring(st[j], k0 + 1)
    p10, p11 = ring(st[j + 1], k0), ring(st[j + 1], k0 + 1)
    pt = [(1 - ft) * ((1 - fk) * p00[i] + fk * p01[i]) + ft * ((1 - fk) * p10[i] + fk * p11[i])
          for i in range(3)]
    if lift:
        zc = (hull(sp, t, 1.0, 0.0)[2] + hull(sp, t, -1.0, 0.0)[2]) / 2
        pt[0] += pt[0] * lift
        pt[2] += (pt[2] - zc) * lift
    return tuple(pt)


def body(sp, m):
    """
    Rings along the length, welded into a hull. Each ring is a superellipse,
    not an ellipse: a fish in section is fuller than an oval, and a disc-bodied
    tang is lens-shaped.
    """
    seg = seg_of(sp)
    prof = resample(sp["profile"], rings_of(sp))
    rings, ts = [], []
    v0 = FT.BODY_V0
    for ri, (t, depth, width) in enumerate(prof):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            up, side = math.cos(a), math.sin(a)
            # The texture paints the hull; the vertex colour stays white.
            ring.append(m.add(*hull(sp, t, up, side), (1.0, 1.0, 1.0),
                              uv=(t, v0 + (1 - v0) * k / seg)))
        rings.append(ring)
        ts.append(t)

    for r in range(len(rings) - 1):
        a, b = rings[r], rings[r + 1]
        for k in range(seg):
            k2 = (k + 1) % seg
            uvs = None
            if k2 == 0:
                # Round the seam at the spine: the far edge is v = 1, not 0.
                vk = v0 + (1 - v0) * k / seg
                uvs = [(ts[r], vk), (ts[r], 1.0), (ts[r + 1], 1.0), (ts[r + 1], vk)]
            m.poly([a[k], a[k2], b[k2], b[k]], uvs)
    m.poly(list(reversed(rings[0])))               # nose cap
    m.poly(rings[-1])                              # peduncle cap
    return rings


def strip(m, a, b, col):
    """A decal: a ribbon of quads between two matching rows of hull points.
    `col` is one colour or one per point."""
    cols = col if isinstance(col, list) else [col] * len(a)
    ia = [m.add(*p, c) for p, c in zip(a, cols)]
    ib = [m.add(*p, c) for p, c in zip(b, cols)]
    for i in range(len(a) - 1):
        m.poly_out([ia[i], ia[i + 1], ib[i + 1], ib[i]])


def patch(m, sp, t, up, sgn, rt, ru, col, lift=0.01, dome=0.0, n=8):
    """A small round decal on the skin — a nostril, a mouth corner, a knob —
    as an ellipse in (t, up), `rt` by `ru`. `dome` raises the centre, which
    turns a spot into a bump."""
    c = m.add(*surface(sp, t, up, sgn, lift + dome), col)
    ring = [m.add(*surface(sp, t + rt * math.cos(a), up + ru * math.sin(a), sgn, lift), col)
            for a in (2 * math.pi * i / n for i in range(n))]
    for i in range(n):
        m.poly_out([c, ring[i], ring[(i + 1) % n]])


def face(sp, m):
    """
    The face, and the rest of the anatomy vertex colour is too coarse for,
    laid on the skin as decals: the gill cover's edge (or a shark's five slits)
    and the preopercle in front of it, the mouth line, lips, the corner of the
    mouth, teeth, nostrils, markings round the eye, the lateral line — and a
    humpback's knobs, blowholes and splashguard.
    """
    L = sp["length"]
    head = sp.get("head", {})
    gills = head.get("gills", [0.24])
    mt = head.get("mouth", 0.07)
    for sgn in (1, -1):
        if sp.get("eyes") == "top" and sgn < 0:
            continue                             # the blind side lies on the sand
        here = lambda t, up: body_colour(sp, t, up, sgn, 0, 0)
        dark = lambda t, up, k=0.5: shade(here(t, up), k)

        # ── gills ──
        if len(gills) == 1:
            gt = gills[0]
            ups = [0.72 - 1.4 * i / 8 for i in range(9)]
            a = [surface(sp, gt + 0.032 * (1 - u * u), u, sgn, 0.012) for u in ups]
            b = [surface(sp, gt + 0.032 * (1 - u * u) + 0.006, u, sgn, 0.012) for u in ups]
            strip(m, a, b, dark(gt, 0.2, 0.68))
            if head.get("preop"):
                # The preopercle: a rounded ridge in front of the gill cover,
                # its corner low and swept back.
                pt = gt - 0.05
                ups = [0.45 - 1.2 * i / 8 for i in range(9)]
                a = [surface(sp, pt + 0.03 * (1 - ((u + 0.3) / 0.75) ** 2), u, sgn, 0.012) for u in ups]
                b = [surface(sp, pt + 0.03 * (1 - ((u + 0.3) / 0.75) ** 2) + 0.004, u, sgn, 0.012) for u in ups]
                strip(m, a, b, dark(pt, 0.0, 0.8))
        else:
            for gt in gills:                     # a shark's gill slits
                ups = [0.28 - 0.62 * i / 3 for i in range(4)]
                a = [surface(sp, gt + 0.004 * u, u, sgn, 0.015) for u in ups]
                b = [surface(sp, gt + 0.004 * u + 0.004, u, sgn, 0.015) for u in ups]
                strip(m, a, b, dark(gt, 0.0, 0.42))

        # ── the mouth ──
        if mt > 0:
            ts = [0.012 + (mt * 0.97 - 0.012) * i / 7 for i in range(8)]
            ml = [mouth_line(head, t) for t in ts]
            a = [surface(sp, t, u + 0.022, sgn, 0.02) for t, u in zip(ts, ml)]
            b = [surface(sp, t, u - 0.022, sgn, 0.02) for t, u in zip(ts, ml)]
            strip(m, a, b, dark(0.02, ml[0], 0.28))
            lips = head.get("lips")
            if lips:
                # Fleshy lips: a raised band either side of the gape, paler
                # than the face — lips catch the light.
                # (bool is an int in Python: `lips=True` must not read as a colour)
                lc = rgb(lips) if type(lips) is int else \
                    shade(base_colour(sp, 0.03, ml[0], sgn, 0, 0), 1.18)
                for off in (0.1, -0.1):
                    a = [surface(sp, t, u + off * 0.3, sgn, 0.03) for t, u in zip(ts, ml)]
                    b = [surface(sp, t, u + off, sgn, 0.026) for t, u in zip(ts, ml)]
                    strip(m, a, b, lc)
            if head.get("corner"):
                patch(m, sp, mt * 0.96, ml[-1], sgn, 0.008, 0.07, rgb(head["corner"]), lift=0.028)
            teeth = head.get("teeth")
            if teeth:
                n, size = teeth["n"], teeth["size"]
                t0, t1 = teeth.get("t", (0.01, mt * 0.8))
                ivory = rgb(teeth.get("color", 0xefe8d6))
                for i in range(n):
                    t = t0 + (t1 - t0) * i / max(1, n - 1)
                    u = mouth_line(head, t)
                    # Fangs of unequal size, the way a barracuda's are.
                    h = size * (1.0 if not teeth.get("uneven") else (0.45 + 0.55 * hash2(i, 7)))
                    w = teeth.get("width", 0.006)
                    for s_ in (1, -1):           # upper row points down, lower up
                        base = u + s_ * 0.03
                        tri = [surface(sp, t - w, base, sgn, 0.03), surface(sp, t + w, base, sgn, 0.03),
                               surface(sp, t + w * 0.3, base - s_ * h, sgn, 0.034)]
                        m.poly_out([m.add(*q, ivory) for q in tri])

        # ── nostrils ──
        nares = head.get("nares", True)
        if nares == "shark":
            # Under the snout, each with a nipple-shaped flap in front.
            patch(m, sp, 0.035, -0.55, sgn, 0.006, 0.12, dark(0.03, -0.5, 0.3), lift=0.02)
            patch(m, sp, 0.028, -0.5, sgn, 0.004, 0.08, shade(here(0.03, -0.5), 1.05), lift=0.03)
        elif nares:
            et = sp.get("eye_t", 0.11)
            eu = sp.get("eye_z", 0.30)
            for f in (0.55, 0.75):
                patch(m, sp, et * f, eu + 0.08, sgn, 0.0035, 0.05, dark(et * f, eu, 0.3), lift=0.02)

        # ── markings round the eye ──
        for mk in sp.get("marks", []):
            if mk["type"] == "eyerim":
                # A line along part of the rim of the eye.
                et, eu, er = sp.get("eye_t", 0.11), sp.get("eye_z", 0.3), sp.get("eye_r", 0.028)
                depth = outline(sp, et)[0]
                a0, a1 = mk["arc"]
                pts = [math.radians(a0 + (a1 - a0) * i / 8) for i in range(9)]
                rr = mk.get("r", 1.35)
                ring = lambda k: [surface(sp, et + math.cos(a) * er * k, eu + math.sin(a) * er * k / depth,
                                          sgn, 0.02) for a in pts]
                strip(m, ring(rr), ring(rr + mk.get("w", 0.35)), rgb(mk["color"]))
            elif mk["type"] == "path":
                # A stripe across the face: points in (t, up), `w` wide in up.
                pts = mk["pts"]
                a = [surface(sp, t, u + mk["w"] / 2, sgn, 0.018) for t, u in pts]
                b = [surface(sp, t, u - mk["w"] / 2, sgn, 0.018) for t, u in pts]
                strip(m, a, b, rgb(mk["color"]))

        # ── the lateral line ── (painted into the texture now, as pores)
        ll = None
        if ll is not None:
            path = sp.get("lateral_path") or [(ll[1], ll[0] + 0.12), (0.45, ll[0]), (ll[2], ll[0])]
            ts, us = [], []
            for j in range(len(path) - 1):
                (ta, ua), (tb, ub) = path[j], path[j + 1]
                for i in range(6):
                    k = i / 6
                    ts.append(ta + (tb - ta) * k)
                    us.append(ua + (ub - ua) * smooth(0, 1, k))
            ts.append(path[-1][0]); us.append(path[-1][1])
            a = [surface(sp, t, u + 0.018, sgn, 0.008) for t, u in zip(ts, us)]
            b = [surface(sp, t, u - 0.018, sgn, 0.008) for t, u in zip(ts, us)]
            strip(m, a, b, [shade(here(t, u), ll[3]) for t, u in zip(ts, us)])

        # ── a humpback's head ──
        if sp.get("tubercles"):
            # Golf-ball knobs, each with a single hair, in rows along the top
            # of the rostrum and scattered on the lower jaw and chin.
            knob = shade(here(0.1, 0.8), 0.85)
            for i in range(7):
                t = 0.02 + 0.03 * i
                for u in (0.72, 0.5):
                    patch(m, sp, t + 0.01 * (u < 0.6), u, sgn, 0.006, 0.07, knob, lift=0.0, dome=0.06, n=6)
            for i in range(5):
                patch(m, sp, 0.03 + 0.035 * i, -0.45 - 0.08 * (i % 2), sgn, 0.006, 0.07,
                      shade(here(0.1, -0.5), 0.9), lift=0.0, dome=0.06, n=6)
    if sp.get("blowholes"):
        # Twin blowholes on top of the head, behind a raised splashguard.
        bt = sp["blowholes"]
        crest = shade(body_colour(sp, bt - 0.02, 1.0, 0, 0, 0), 0.9)
        patch(m, sp, bt - 0.02, 1.0, 1, 0.012, 0.18, crest, lift=0.0, dome=0.07, n=8)
        for sgn in (1, -1):
            patch(m, sp, bt + 0.01, 0.96, sgn, 0.012, 0.035, (0.05, 0.05, 0.06), lift=0.015)


# ── fins ─────────────────────────────────────────────────────────────────────
def fan(m, base, edge, colour, part, rows=(0.0, 0.25, 0.5, 0.75, 1.0), notch=0.0, rays=0.78,
        tip=None, tip_at=0.72, slot=None, spiny=False):
    """
    A fin: rays from `base` (points along the root) to `edge` (the matching
    points on the outer edge), with a strip of membrane between each pair.
    Rays are painted darker than the membrane, which is what makes a fin read
    as a fin and not a flap of card. `notch` pulls the membrane's edge in
    toward the root between rays — the webbing between the spines of a spiny
    dorsal. `tip` paints everything past `tip_at` in another colour, with a
    hard edge: a blacktip's black tips.
    """
    cols = []
    n = len(base) - 1
    for i in range(n + 1):
        cols.append((base[i], edge[i], True))
        if i < n:
            bm = lerp3(base[i], base[i + 1], 0.5)
            em = lerp3(edge[i], edge[i + 1], 0.5)
            cols.append((bm, lerp3(bm, em, 1 - notch), False))
    rws = list(rows)
    if tip is not None and tip_at not in rws:
        rws = sorted(set(rws) | {tip_at - 0.02, tip_at})
    if slot:
        # The texture paints this fin — rays, membrane, tips — into its slot.
        m.fins[slot] = dict(color=colour, rays=n, rays_visible=rays < 1.0, tip=tip,
                            tip_at=tip_at, spiny=spiny)
        su0, sv0, sw, sh = FT.slot_rect(slot)
    grid = []
    ncol = len(cols)
    for ci, (b, e, is_ray) in enumerate(cols):
        column = []
        for r in rws:
            if slot:
                c, uv = (1.0, 1.0, 1.0), (su0 + sw * ci / (ncol - 1), sv0 + sh * r)
            else:
                c, uv = (shade(colour, rays) if is_ray else colour), None
                if tip is not None and r >= tip_at:
                    c = tip
            column.append(m.add(*lerp3(b, e, r), c, part, r, uv=uv))
        grid.append(column)
    for i in range(len(grid) - 1):
        for j in range(len(rws) - 1):
            m.poly([grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]])


def median(sp, m, key, spec, sign, style):
    """Dorsal and anal fins: a row of rays standing out of the back or belly."""
    L = sp["length"]
    t0, t1, h = spec
    n = max(4, min(14, int((t1 - t0) * 40)))
    base, edge = [], []
    for i in range(n + 1):
        u = i / n
        t = t0 + (t1 - t0) * u
        r = outline(sp, t)[0] * L * sign * (sp.get("belly", 1.0) if sign < 0 else 1.0) * 0.94
        if style == "spiny":        # tall spines in front, soft rays behind
            hh, rake = h * (1.0 - 0.3 * u), 0.35
        elif style == "falcate":    # a sickle: tall at the front, swept right back
            hh, rake = h * max(0.06, (1 - u) ** 1.3), 0.95
        elif style == "shark":      # a shark's first dorsal: a swept, concave triangle
            hh, rake = h * max(0.04, (1 - u) ** 0.85), 1.25
        elif style == "crest":      # mahi-mahi: a sail from the head, falling away
            hh, rake = h * (1.0 - 0.55 * u), 0.3
        else:                       # round: a soft, rounded fin
            hh, rake = h * (0.3 + 0.7 * math.sin(math.pi * (0.08 + 0.84 * u))), 0.4
        base.append((0.0, t * L, r))
        edge.append((0.0, t * L + rake * hh * L, r + hh * L * sign))
    notch = 0.32 if style == "spiny" else 0.05
    rays = 1.0 if sp.get("smooth_fins") else 0.78
    fan(m, base, edge, fin_colour(sp, key), MEDIAN, notch=notch, rays=rays,
        tip=tip_colour(sp) if key == "dorsal" else None, tip_at=0.62, slot=key,
        spiny=style == "spiny")


def finlets(sp, m):
    """The little triangles along a tuna's or mackerel's back and belly."""
    if not sp.get("finlets"):
        return
    L = sp["length"]
    t0, t1, n, h = sp["finlets"]
    col = fin_colour(sp, "finlets")
    m.fins["finlets"] = dict(color=col, rays=1, rays_visible=False, tip=None, tip_at=1.0)
    su0, sv0, sw, sh = FT.slot_rect("finlets")
    white = (1.0, 1.0, 1.0)
    for i in range(n):
        t = t0 + (t1 - t0) * i / max(1, n - 1)
        dr = outline(sp, t)[0] * L * 0.95
        for sign in (1, -1):
            a = m.add(0.0, t * L, dr * sign, white, MEDIAN, 0.0, uv=(su0, sv0))
            b = m.add(0.0, (t + 0.022) * L, dr * sign, white, MEDIAN, 0.0, uv=(su0 + sw, sv0))
            c = m.add(0.0, (t + 0.032) * L, (dr + h * L) * sign, white, MEDIAN, 1.0, uv=(su0 + sw, sv0 + sh))
            m.poly([a, b, c])


def caudal(sp, m):
    """The tail, as a fan of rays from the peduncle."""
    L = sp["length"]
    tl = sp["tail"]
    shape = tl.get("shape", "fork")
    y0 = L * 0.985
    s, w = tl["span"] * L, tl["sweep"] * L
    fork = tl.get("fork", 0.08) * L
    bd = outline(sp, 1.0)[0] * L * 0.9
    col = fin_colour(sp, "caudal")
    n = 10
    if shape == "fluke":
        # Horizontal, in the XY plane: a whale's tail is not a fish's.
        base, edge = [], []
        for i in range(n + 1):
            v = 1 - 2 * i / n
            base.append((bd * v, y0, 0.0))
            notchy = 0.25 * w * (1 - abs(v)) ** 3
            edge.append((s * v, y0 + w * (0.55 + 0.45 * abs(v) ** 0.8) - notchy, 0.0))
        fan(m, base, edge, col, CAUDAL, rays=1.0, slot="caudal")
        return
    base, edge = [], []
    for i in range(n + 1):
        v = 1 - 2 * i / n                      # +1 top lobe, -1 bottom lobe
        base.append((0.0, y0, bd * v))
        if shape == "fork":
            y, z = y0 + w - fork * (1 - abs(v)) ** 0.9, s * v
        elif shape == "lunate":
            y, z = y0 + w * (0.5 + 0.5 * abs(v) ** 1.25), s * v
        elif shape == "round":
            y, z = y0 + w * (0.62 + 0.38 * math.sqrt(max(0.0, 1 - v * v))), s * v * 0.9
        elif shape == "truncate":
            y, z = y0 + w * (0.9 + 0.1 * abs(v)), s * v
        else:                                  # shark: a long upper lobe
            if v >= 0:
                y, z = y0 + w * (0.3 + 0.7 * v ** 0.9), s * v
            else:
                y, z = y0 + w * (0.25 + 0.3 * abs(v) ** 0.7), s * 0.48 * v
        edge.append((0.0, y, z))
    rays = 1.0 if sp.get("smooth_fins") else 0.8
    fan(m, base, edge, col, CAUDAL, rays=rays, tip=tip_colour(sp), tip_at=0.74,
        rows=(0.0, 0.25, 0.5, 0.75, 1.0), slot="caudal")


def paired(sp, m):
    """Pectorals — paddles against the flank, or wings out from it — and the
    pelvic fins under the belly."""
    L = sp["length"]
    col, tip = fin_colour(sp, "pectoral"), tip_colour(sp)
    rays = 1.0 if sp.get("smooth_fins") else 0.8
    if sp.get("pectoral_style") == "wing":
        # Out from the flank, swept back and drooping: (t, span, chord, droop).
        pt, span, chord, droop = sp["pectoral"]
        z0 = -outline(sp, pt)[0] * L * 0.45
        wb = outline(sp, pt)[1] * L
        for side in (1, -1):
            root = side * wb * 0.85
            tipx = side * (wb * 0.85 + span * L)
            n = 4
            base = [(root, (pt + chord * i / n) * L, z0) for i in range(n + 1)]
            edge = [(tipx, (pt + chord * (1.0 + 0.4 * i / n)) * L, z0 - droop * span * L)
                    for i in range(n + 1)]
            fan(m, base, edge, col, PAIRED, rays=rays, tip=tip, tip_at=0.68,
                rows=(0.0, 0.25, 0.5, 0.75, 1.0), slot="pectoral")
    else:
        pt, pl, ph = sp["pectoral"]
        d, wb = outline(sp, pt)
        for side in (1, -1):
            x0 = side * wb * L * 0.9
            n = 5
            base, edge = [], []
            for i in range(n + 1):
                u = i / n                               # top ray to bottom ray
                base.append((x0, pt * L + 0.004 * L * i, (0.3 - 0.6 * u) * ph * L * 0.5))
                ang = 0.6 - 1.3 * u
                edge.append((x0 + side * pl * L * 0.25,
                             (pt + pl * (0.75 + 0.25 * math.cos(ang))) * L,
                             math.sin(ang) * ph * L * 0.85))
            fan(m, base, edge, col, PAIRED, rays=rays, slot="pectoral")

    pv = sp.get("pelvic", (sp["pectoral"][0] + 0.05, 0.10))
    if pv:
        t, length = pv
        d, wb = outline(sp, t)
        z = -d * L * sp.get("belly", 1.0) * 0.92
        pcol = fin_colour(sp, "pelvic")
        for side in (1, -1):
            x = side * wb * L * 0.35
            base = [(x, t * L + length * L * 0.25 * i, z) for i in range(3)]
            edge = [(x + side * length * L * 0.2, (t + length * (0.8 + 0.2 * i / 2)) * L,
                     z - length * L * (0.55 - 0.2 * i / 2)) for i in range(3)]
            fan(m, base, edge, pcol, PAIRED, rays=rays, tip=tip, tip_at=0.7, slot="pelvic")


def fins(sp, m):
    styles = sp.get("fin_styles", {})
    for key, sign in (("dorsal", 1), ("dorsal2", 1), ("anal", -1)):
        spec = sp.get(key)
        if spec:
            default = "round" if key == "anal" else "spiny"
            median(sp, m, key, spec, sign, styles.get(key, default))
    finlets(sp, m)
    caudal(sp, m)
    paired(sp, m)


def eyes(sp, m):
    """
    Eyes as domes, not stickers, seated on the skin wherever the head shaping
    has put it: a pupil, an iris and a dark socket, the centre raised so it
    catches the light. Per species:

      eye_t, eye_z   where: along the body, and how high on the head (-1..1)
      eye_r          size, as a fraction of body length
      eye_shape      (along, vertical) stretch — a shark's eye is oval
      pupil          'round', or 'slit' for a shark's vertical pupil
      eye_bulge      how far it stands out: a flounder's sit up on stalks
      iris           colour (or colors.eye)

    Tagged EYE, which the swim shader makes glossy.
    """
    L = sp["length"]
    t = sp.get("eye_t", 0.11)
    r = L * sp.get("eye_r", 0.028)
    sx, sz = sp.get("eye_shape", (1.0, 1.0))
    bulge = sp.get("eye_bulge", 0.45)
    c = sp.get("colors", {})
    iris = rgb(c["eye"]) if "eye" in c else rgb(sp.get("iris", 0xc9b27a))
    pupil = (0.02, 0.02, 0.025)
    slit = sp.get("pupil") == "slit"
    if sp.get("eyes") == "top":
        # Both eyes on the upper side, widely spaced, the migrated one a little
        # further forward — a bothid flounder's. Upper side here is +X; the
        # roll makes it face the sky.
        places = [(1, t, 0.48), (1, t - 0.035, -0.22)]
    else:
        places = [(side, t, sp.get("eye_z", 0.30)) for side in (1, -1)]
    n = 12
    L_ = L

    def seat(t, u, side, h):
        """A point on the skin at (t, u), pushed `h` outward from the head's
        axis — so the eye follows the curve of the head and domes out of it."""
        x, y, z = surface(sp, t, u, side)
        zc = (surface(sp, t, 1.0, side)[2] + surface(sp, t, -1.0, side)[2]) / 2
        dx, dz = x, z - zc
        ln = math.hypot(dx, dz) or 1.0
        return (x + dx / ln * h, y, z + dz / ln * h)

    # The eye, from the centre out: (radius, how far it stands out as a share
    # of the bulge, colour, is-pupil). A species can give its own; the
    # default is pupil, iris, socket.
    rings_spec = sp.get("eye_rings") or [(0.45, 0.8, "pupil", True), (1.0, 0.35, "iris", False),
                                         (1.3, 0.0, "socket", False)]
    slit_w = sp.get("slit", 0.35)
    lids = sp.get("eye_lids")

    def colour_of(c_):
        if c_ == "pupil":
            return pupil
        if c_ == "iris":
            return iris
        if c_ == "socket":
            return shade(iris, 0.35)
        return rgb(c_)

    def ellipse(et, eu, depth, side, rr, lift, slit_=False, drop=0.0, arc=None):
        """Points round the eye at radius `rr` (of r), `lift` out, optionally
        only along an arc (degrees, 0 = toward the tail, 90 = up), and with the
        inner edge dropped by `drop` (of r) — which is how a lid covers."""
        pts = []
        angs = [2 * math.pi * k / n for k in range(n)] if arc is None else \
            [math.radians(arc[0] + (arc[1] - arc[0]) * k / 8) for k in range(9)]
        for a in angs:
            ca, sa = math.cos(a) * sx, math.sin(a) * sz
            if slit_:
                ca *= slit_w                 # a vertical slit
            pts.append(seat(et + ca * r * rr / L_, eu + (sa * rr - drop) * r / depth, side, r * lift))
        return pts

    for side, et, eu in places:
        depth = outline(sp, et)[0] * L_
        if lids:
            # The skin round a shark's eye is a shade darker than its flank.
            skin_ = shade(body_colour(sp, et, eu, side, 0, 0), 0.88)
            patch(m, sp, et, eu, side, r * 2.3 * sx / L_, r * 2.0 * sz / depth, skin_, lift=0.004, n=16)
        centre = m.add(*seat(et, eu, side, r * bulge * rings_spec[0][1]), pupil, EYE)
        rings = []
        for rr, lf, c_, ps in rings_spec:
            col = colour_of(c_)
            rings.append([m.add(*q, col, EYE)
                          for q in ellipse(et, eu, depth, side, rr, bulge * lf, ps)])
        for k in range(n):
            k2 = (k + 1) % n
            m.poly_out([centre, rings[0][k], rings[0][k2]])
            for a_, b_ in zip(rings, rings[1:]):
                m.poly_out([a_[k], b_[k], b_[k2], a_[k2]])
        if lids:
            # An upper lid: a fold of skin over the top of the eye, standing
            # proud of it, so the eye looks set in the head, not stuck on it.
            skin = shade(body_colour(sp, et, eu + 0.2, side, 0, 0), 0.9)
            # Its inner edge is pulled down over the top of the iris.
            outer = ellipse(et, eu, depth, side, 1.38, bulge * 0.3, arc=(-10, 190))
            inner = ellipse(et, eu, depth, side, 1.0, bulge * 1.15, arc=(-10, 190),
                            drop=lids.get("cover", 0.25))
            strip(m, outer, inner, skin)
            # The nictitating membrane: the third eyelid, a pale edge rising
            # from below.
            low_out = ellipse(et, eu, depth, side, 1.2, bulge * 0.35, arc=(200, 340))
            low_in = ellipse(et, eu, depth, side, 0.98, bulge * 0.95, arc=(200, 340), drop=-lids.get("third", 0.18))
            strip(m, low_out, low_in, rgb(lids.get("lower", 0xc6c8c2)))


def build(name, sp):
    m = Mesh()
    body(sp, m)
    face(sp, m)
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

    # Colour, with the part tag in alpha (part + flex, over 5): the swim shader
    # reads it to move each part of the fish its own way. The UVs are the
    # texture's.
    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(m.c):
        layer.data[i].color = tuple(_linear(v) for v in c) + (m.u[i] / 5.0,)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        over = m.fuv.get(poly.index)
        for j, li in enumerate(poly.loop_indices):
            uv.data[li].uv = over[j] if over else m.uv[me.loops[li].vertex_index]
    me.validate()
    me.update()

    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(skin(name, sp, m))

    # Flat-ish shading with a smoothed hull reads better than either extreme.
    for poly in me.polygons:
        poly.use_smooth = True
    return obj


def lateral_path(sp):
    ll = sp.get("lateral")
    if ll is None:
        return None
    return sp.get("lateral_path") or [(ll[1], ll[0] + 0.12), (0.45, ll[0]), (ll[2], ll[0])]


def skin(name, sp, m):
    """
    The species' material: the painted atlas as base colour and its normal
    map, on a Principled BSDF — which is what the glTF exporter turns into a
    PBR material with baseColorTexture and normalTexture, the same shape of
    material the dinosaurs carry.
    """
    col, nrm = FT.atlas(sp, m.fins, outline, lateral_path(sp))
    images = []
    for kind, data in (("albedo", col), ("normal", nrm)):
        img = bpy.data.images.new(f"{name}_{kind}", FT.S, FT.S, alpha=False)
        if kind == "normal":
            img.colorspace_settings.name = "Non-Color"
        rgba = np.concatenate([data, np.ones((FT.S, FT.S, 1))], axis=2).astype(np.float32)
        img.pixels.foreach_set(rgba.ravel())
        img.file_format = "JPEG"
        img.pack()
        images.append(img)
    mat = bpy.data.materials.new(f"{name}_skin")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = images[0]
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = images[1]
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = sp.get("texture", {}).get("roughness", 0.55)
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def preview(made, out_dir):
    """A side-on render of each, to check shapes and markings by eye."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
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

    # And the face: three-quarters from the front, close in, which is where
    # the species differ most and where a side view shows least.
    target = bpy.data.objects.new("face_target", None)
    scene.collection.objects.link(target)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis, track.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    for o in made:
        for other in made:
            other.hide_render = other is not o
        sp = SPECIES[o.name]
        L = sp["length"]
        head = [v.co for v in o.data.vertices if v.co.y < 0.3 * L]
        z0, z1 = min(v.z for v in head), max(v.z for v in head)
        x1 = max(v.x for v in head)
        target.location = (0, 0.1 * L, (z0 + z1) / 2)
        cam_data.ortho_scale = max(0.34 * L, (z1 - z0) * 1.9, x1 * 3.4) * 1.1
        if sp.get("roll"):
            cam.location = (L * 0.6, -L * 0.9, z1 + L * 2)
        else:
            cam.location = (L * 1.6, -L * 1.4, (z0 + z1) / 2 + L * 0.35)
        scene.render.filepath = os.path.join(out_dir, f"{o.name}_face.png")
        bpy.ops.render.render(write_still=True)
    cam.constraints.remove(track)
    bpy.data.objects.remove(target, do_unlink=True)
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
        "export_vertex_color": "ACTIVE",
        "export_image_format": "JPEG",
        "export_jpeg_quality": 90,
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
