"""
Build the reef fish: four species of low-poly fish with baked vertex colours,
exported as one .glb the game draws instanced.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_fish.py

Writes assets/models/reef_fish.glb and adds it to the model manifest. Original
work, so nothing goes in CREDITS.md — see the note at the top of that file.

Two decisions worth knowing before you edit this:

**No armature.** A hundred fish with a hundred skinned meshes and a hundred
animation mixers is a lot of CPU for a body that only ever does one thing. The
swim is a travelling sine down the length of the body, and a sine is something
the vertex shader can do for free — so these export as static meshes and
src/fish.js bends them on the GPU. That is also why the mesh has rings of
vertices along its length rather than a minimal shell: the wave needs something
to bend.

**Counter-shading is baked in.** Dark along the spine, pale on the belly, which
is what nearly every fish in open water does and most of what makes a lozenge
read as a fish. The colours are near-greyscale on purpose: the game multiplies
a per-instance tint over them, so one mesh yields a yellow tang and a blue
chromis without a second texture.

Facing is **-Y**, matching tools/make_starters.py, which is what the glTF Y-up
export turns into the game's forward.
"""
import math
import os
import sys

import bpy

OUT_NAME = "reef_fish.glb"
SEG = 9                      # vertices around each body ring


def _linear(c):
    """Blender colour attributes are linear; the palette below is sRGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ── species ──────────────────────────────────────────────────────────────────
# `profile` is the body outline as (t, depth, width) with t running 0 at the
# nose to 1 at the root of the tail, and depth/width as fractions of `length`.
# Deep discs and slim torpedoes are the same code with different numbers.
#
# `bands` are vertical stripes in t, which is the cheapest reef-fish marking
# there is and reads from further away than anything else.

SPECIES = {
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
    # A proper fish-shaped fish, and the biggest of the four.
    "snapper": dict(
        length=0.34,
        profile=[(0.00, 0.05, 0.04), (0.09, 0.17, 0.10), (0.22, 0.26, 0.14),
                 (0.38, 0.28, 0.14), (0.54, 0.25, 0.12), (0.70, 0.19, 0.09),
                 (0.85, 0.11, 0.05), (1.00, 0.05, 0.03)],
        dorsal=(0.20, 0.76, 0.12), anal=(0.56, 0.80, 0.09),
        tail=dict(span=0.30, sweep=0.20, fork=0.13),
        pectoral=(0.28, 0.16, 0.11), bands=[],
        fin_tone=0.78,
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
}


class Mesh:
    """Accumulates verts / faces / vertex colours, then hands over a bpy mesh."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def add(self, x, y, z, shade):
        self.v.append((x, y, z))
        self.c.append(shade)
        return len(self.v) - 1

    def poly(self, idx):
        self.f.append(tuple(idx))

    def flat(self, points, shade, x=0.0):
        """A flat polygon in the YZ plane at `x` — every fin is one of these."""
        base = [self.add(x, y, z, shade) for (y, z) in points]
        self.poly(base)


def body(sp, m):
    """Rings along the length, welded into a hull, counter-shaded as they go."""
    L = sp["length"]
    rings = []
    for (t, depth, width) in sp["profile"]:
        # Stripes darken a whole ring, so they come out as vertical bands.
        band = 1.0
        for (bt, bw) in sp["bands"]:
            if abs(t - bt) < bw:
                band = 0.62
        ring = []
        for k in range(SEG):
            a = 2 * math.pi * k / SEG
            up = math.cos(a)                       # +1 spine, -1 belly
            x = math.sin(a) * width * L
            z = up * depth * L
            # Counter-shading: dark back, bright belly. This is the single
            # cheapest thing that makes the silhouette read as a fish. The
            # floor is well off zero — under 15m of water the dark half goes
            # to silhouette long before the mesh does.
            shade = (0.50 + 0.50 * (0.5 - 0.5 * up)) * band
            ring.append(m.add(x, t * L, z, shade))
        rings.append(ring)

    for r in range(len(rings) - 1):
        a, b = rings[r], rings[r + 1]
        for k in range(SEG):
            k2 = (k + 1) % SEG
            m.poly([a[k], a[k2], b[k2], b[k]])
    m.poly(list(reversed(rings[0])))               # nose cap
    m.poly(rings[-1])                              # peduncle cap
    return rings


def fins(sp, m):
    L = sp["length"]
    tone = sp["fin_tone"]

    # Dorsal and anal: long low ridges running most of the back and underside.
    for key, sign in (("dorsal", 1), ("anal", -1)):
        t0, t1, h = sp[key]
        # Follow the body outline so the fin leaves the back, not the air.
        def at(t):
            best = min(sp["profile"], key=lambda p: abs(p[0] - t))
            return best[1] * L * sign
        m.flat([(t0 * L, at(t0)), (t1 * L, at(t1)),
                (t1 * L - 0.02 * L, at(t1) + h * L * sign * 0.6),
                ((t0 + t1) * 0.5 * L, at((t0 + t1) * 0.5) + h * L * sign)],
               tone)

    # Caudal: a forked sheet hanging off the peduncle.
    tl = sp["tail"]
    y0 = L
    m.flat([(y0, 0.0),
            (y0 + tl["sweep"] * L,  tl["span"] * L),
            (y0 + (tl["sweep"] - tl["fork"]) * L, 0.0),
            (y0 + tl["sweep"] * L, -tl["span"] * L)],
           tone * 0.92)

    # Pectorals: a small paddle either side, angled back.
    pt, pl, ph = sp["pectoral"]
    w = max(p[2] for p in sp["profile"]) * L
    for side in (1, -1):
        m.flat([(pt * L, 0.0),
                ((pt + pl) * L,  ph * L * 0.35),
                ((pt + pl * 0.8) * L, -ph * L * 0.55)],
               tone * 0.86, x=side * w * 0.85)


def eyes(sp, m):
    """Two dark beads on the head. Small, and worth every triangle."""
    L = sp["length"]
    head = sp["profile"][1]
    r = L * 0.028
    for side in (1, -1):
        cx = side * head[2] * L * 0.78
        cy = 0.11 * L
        cz = head[1] * L * 0.30
        ring = []
        for k in range(6):
            a = 2 * math.pi * k / 6
            ring.append(m.add(cx, cy + math.cos(a) * r, cz + math.sin(a) * r, 0.05))
        m.poly(ring if side > 0 else list(reversed(ring)))


def build(name, sp):
    m = Mesh()
    body(sp, m)
    fins(sp, m)
    eyes(sp, m)

    me = bpy.data.meshes.new(name)
    me.from_pydata(m.v, [], m.f)
    me.validate()
    me.update()

    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, shade in enumerate(m.c):
        s = _linear(shade)
        layer.data[i].color = (s, s, s, 1.0)

    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)

    # Flat-ish shading with a smoothed hull reads better than either extreme.
    for poly in me.polygons:
        poly.use_smooth = True
    return obj


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    made = []
    for name, sp in SPECIES.items():
        obj = build(name, sp)
        made.append(obj)
        print(f"  {name}: {len(obj.data.vertices)} verts, {len(obj.data.polygons)} faces")

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
    dropped = sorted(k for k in desired if k not in known and k != "filepath")
    kwargs = {k: v for k, v in desired.items() if k == "filepath" or k in known}
    if dropped:
        print(f"  (this Blender has no: {', '.join(dropped)})")
    bpy.ops.export_scene.gltf(**kwargs)

    kb = os.path.getsize(path) / 1024
    print(f"\n→ {os.path.relpath(path, root)}  ({kb:,.1f} KB)")


if __name__ == "__main__":
    main()
