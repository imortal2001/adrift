"""
Build the sauropod: fuse the starter blockout into one skin, rig it, and
author the five clips for real.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_sauropod.py

Writes blender/sauropod_procedural.blend. This is the original, licence-clean
body — kept as the fallback if the downloaded models ever have to come out.

The starter's blockout is a pile of overlapping primitives, which reads as a
pile of primitives. A voxel remesh welds them into a single continuous surface
first, so what gets skinned is a creature rather than an assembly.

The clips are keyed per part — legs on a lateral-sequence gait, body bob and
roll off that gait, neck and tail as travelling waves with a lag down the
chain, which is what stops a long animal looking like it is made of sticks.
"""
import math
import os
import sys

import bpy
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_starters as MS

SPECIES = "sauropod"
FPS = 24

# Lateral-sequence walk: left hind, left fore, right hind, right fore. It is
# what heavy quadrupeds actually use, and it keeps three feet down at all times.
GAIT = {"bl": 0.00, "fl": 0.25, "br": 0.50, "fr": 0.75}

def _linear(c):
    """Blender colour attributes are linear; the game's palette is sRGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgba(hexcode):
    return tuple(_linear(((hexcode >> s) & 0xFF) / 255) for s in (16, 8, 0)) + (1.0,)


# Reshaped from the starter. The starter gives every species the same generic
# proportions; a sauropod needs a longer neck than tail-equal, a whip tail, and
# — the thing that actually reads — a skull clearly wider than the neck it sits
# on. At the starter's 0.52 width the skull came out the same radius as the
# neck tip and the voxel remesh simply swallowed it.
SHAPE = dict(
    length=23.0, legs=4, hip=5.4, girth=1.80, torso=5.6,
    neck=dict(length=10.0, segments=6, rise=26, settle=12, base=0.78, tip=0.26),
    tail=dict(length=10.5, segments=6, rise=-4, settle=-34, base=0.82, tip=0.03),
    head=dict(length=1.6, width=0.66, height=0.60),
    hump=0.40, foot=1.5,
)

BODY_COLOUR = _rgba(0x6b7a58)     # matches wildlife.js
BELLY_COLOUR = _rgba(0x93a279)


# ── pose helpers ─────────────────────────────────────────────────────────────
# Rotations are written in world axes and converted into each bone's own rest
# basis, so the maths never has to care which way a bone's roll happens to
# point. X = pitch (fore/aft swing), Y = roll, Z = yaw (side to side).
def wrot(pb, *rots):
    rest = pb.bone.matrix_local.to_3x3()
    R = mathutils.Matrix.Identity(3)
    for axis, ang in rots:
        R = mathutils.Matrix.Rotation(ang, 3, axis) @ R
    pb.rotation_quaternion = (rest.inverted() @ R @ rest).to_quaternion()


def wloc(pb, v):
    rest = pb.bone.matrix_local.to_3x3()
    pb.location = rest.inverted() @ mathutils.Vector(v)


def key(pb, frame, loc=False):
    pb.keyframe_insert("rotation_quaternion", frame=frame)
    if loc:
        pb.keyframe_insert("location", frame=frame)


# ── mesh ─────────────────────────────────────────────────────────────────────
def column_leg(p, lx, ly):
    """
    A heavier pillar than the starter's.

    The starter runs every leg at girth*0.30 and lands the belly close to the
    ground, which on an animal this size reads as a barrel on sticks. Real
    weight-bearing sauropod limbs are close to elephantine: thick at the
    shoulder, barely tapering, on a broad spreading pad.
    """
    hip, girth, foot = p["hip"], p["girth"], p["foot"]
    r_top, r_mid, r_ankle = girth * 0.44, girth * 0.36, girth * 0.30
    parts = [
        MS.tube((lx, ly, hip), (lx, ly, hip * 0.52), r_top, r_mid),
        MS.tube((lx, ly, hip * 0.52), (lx, ly, hip * 0.10), r_mid, r_ankle),
        MS.add_mesh("primitive_cylinder_add", radius=r_ankle * foot * 1.15,
                    depth=hip * 0.11, vertices=12, location=(lx, ly, hip * 0.055)),
    ]
    MS.apply_scale(parts[-1])
    for a in (-0.6, -0.2, 0.2, 0.6):
        parts.append(MS.claw_at(
            (lx + math.sin(a) * r_ankle * 0.95, ly - math.cos(a) * r_ankle * 1.05, hip * 0.06),
            (math.sin(a), -math.cos(a), -0.12), girth * 0.22, girth * 0.10))
    return [o for o in parts if o]


MS.column_leg = column_leg          # the starter builds legs through this name



def fuse(body, voxel=0.11, adaptivity=0.09, target_tris=13000):
    """Weld the overlapping primitives into one continuous surface."""
    bpy.context.view_layer.objects.active = body
    m = body.modifiers.new("remesh", "REMESH")
    m.mode, m.voxel_size, m.adaptivity = "VOXEL", voxel, adaptivity
    bpy.ops.object.modifier_apply(modifier=m.name)

    tris = sum(len(f.vertices) - 2 for f in body.data.polygons)
    if tris > target_tris:
        d = body.modifiers.new("dec", "DECIMATE")
        d.ratio = target_tris / tris
        bpy.ops.object.modifier_apply(modifier=d.name)

    bpy.ops.object.shade_smooth()
    return sum(len(f.vertices) - 2 for f in body.data.polygons)


def paint(body):
    """A belly-to-back gradient as vertex colour, plus the material to show it."""
    me = body.data
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    span = max(hi - lo, 1e-6)

    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        t = (v.co.z - lo) / span
        t = t ** 0.75                       # keep the pale belly low and tight
        layer.data[i].color = tuple(
            BELLY_COLOUR[c] + (BODY_COLOUR[c] - BELLY_COLOUR[c]) * t for c in range(4)
        )



# ── skin ─────────────────────────────────────────────────────────────────────
# Geometry was never what separated this from a bought model — surface was. A
# flat vertex colour reads as plastic at any polycount. These two functions
# build a procedural hide (mottling, scales, a pale belly) and bake it down to
# a colour map and a normal map, which is what the game's material can show.
def unwrap(body):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def skin_material(body):
    """Mottled hide over the belly gradient, with scales as bump."""
    mat = bpy.data.materials.new("sauropod_hide")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    bsdf.inputs["Metallic"].default_value = 0.0

    def node(kind, **kw):
        n = nt.nodes.new(kind)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    vcol = node("ShaderNodeVertexColor"); vcol.layer_name = "Col"
    coord = node("ShaderNodeTexCoord")

    # large blotches, so the hide is not one flat tone
    blot = node("ShaderNodeTexNoise"); blot.noise_dimensions = "3D"
    blot.inputs["Scale"].default_value = 3.2
    blot.inputs["Detail"].default_value = 4.0
    nt.links.new(coord.outputs["Object"], blot.inputs["Vector"])
    blot_ramp = node("ShaderNodeValToRGB")
    blot_ramp.color_ramp.elements[0].position = 0.40
    blot_ramp.color_ramp.elements[1].position = 0.62
    nt.links.new(blot.outputs["Fac"], blot_ramp.inputs["Fac"])

    darker = node("ShaderNodeMixRGB"); darker.blend_type = "MULTIPLY"
    darker.inputs["Fac"].default_value = 0.45
    darker.inputs["Color2"].default_value = (0.55, 0.60, 0.48, 1.0)
    nt.links.new(vcol.outputs["Color"], darker.inputs["Color1"])

    body_col = node("ShaderNodeMixRGB"); body_col.blend_type = "MIX"
    nt.links.new(blot_ramp.outputs["Color"], body_col.inputs["Fac"])
    nt.links.new(vcol.outputs["Color"], body_col.inputs["Color1"])
    nt.links.new(darker.outputs["Color"], body_col.inputs["Color2"])

    # pebbled scales, both as a faint colour break and as the bump height
    scales = node("ShaderNodeTexVoronoi"); scales.feature = "F1"
    scales.inputs["Scale"].default_value = 85.0
    nt.links.new(coord.outputs["Object"], scales.inputs["Vector"])

    grain = node("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 55.0
    grain.inputs["Detail"].default_value = 6.0
    nt.links.new(coord.outputs["Object"], grain.inputs["Vector"])

    scale_tint = node("ShaderNodeMixRGB"); scale_tint.blend_type = "OVERLAY"
    scale_tint.inputs["Fac"].default_value = 0.16
    nt.links.new(body_col.outputs["Color"], scale_tint.inputs["Color1"])
    nt.links.new(scales.outputs["Distance"], scale_tint.inputs["Color2"])
    nt.links.new(scale_tint.outputs["Color"], bsdf.inputs["Base Color"])

    height = node("ShaderNodeMixRGB"); height.blend_type = "ADD"
    height.inputs["Fac"].default_value = 0.35
    nt.links.new(scales.outputs["Distance"], height.inputs["Color1"])
    nt.links.new(grain.outputs["Fac"], height.inputs["Color2"])
    bump = node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(height.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    body.data.materials.clear()
    body.data.materials.append(mat)
    return mat


def bake_skin(body, mat, size=1024):
    """Bake the procedural hide down to a colour map and a normal map."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False

    nt = mat.node_tree
    baked = {}
    for kind, name, space in (("DIFFUSE", "sauropod_colour", "sRGB"),
                              ("NORMAL", "sauropod_normal", "Non-Color")):
        img = bpy.data.images.new(name, size, size,
                                  alpha=False, is_data=(space == "Non-Color"))
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        bpy.ops.object.select_all(action="DESELECT")
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        if kind == "DIFFUSE":
            scene.render.bake.use_pass_direct = False
            scene.render.bake.use_pass_indirect = False
            scene.render.bake.use_pass_color = True
        bpy.ops.object.bake(type=kind, margin=8, use_clear=True)
        baked[kind] = (img, tex)

    # rebuild the material around the baked maps, so glTF carries real textures
    bsdf = nt.nodes["Principled BSDF"]
    col_tex = baked["DIFFUSE"][1]
    nrm_tex = baked["NORMAL"][1]
    nrm_tex.image.colorspace_settings.name = "Non-Color"
    for link in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(link)
    for link in list(bsdf.inputs["Normal"].links):
        nt.links.remove(link)
    nt.links.new(col_tex.outputs["Color"], bsdf.inputs["Base Color"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nrm_tex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return baked


# ── clips ────────────────────────────────────────────────────────────────────
def new_action(arm, name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    return act


def leg_pose(pbs, tag, t, swing_amp, fold_amp):
    """One leg at cycle position t. Stance drives back, swing folds and returns."""
    swing = -swing_amp * math.cos(2 * math.pi * t)
    fold = fold_amp * max(0.0, math.sin(2 * math.pi * (t - 0.55)))
    th, sh, ft = pbs.get(f"thigh_{tag}"), pbs.get(f"shin_{tag}"), pbs.get(f"foot_{tag}")
    if th:
        wrot(th, ("X", swing))
    if sh:
        wrot(sh, ("X", fold))
    if ft:
        wrot(ft, ("X", -(swing * 0.30 + fold * 0.75)))
    return [b for b in (th, sh, ft) if b]


def chain_wave(pbs, prefix, n, t, amp, lag, taper_out, pitch=0.0, pitch_amp=0.0):
    """A travelling wave down a neck or tail — each segment lags the one before."""
    touched = []
    for i in range(1, n + 1):
        pb = pbs.get(f"{prefix}_{i}")
        if not pb:
            continue
        ph = 2 * math.pi * t - i * lag
        scale = (i / n) if taper_out else (1.0 - 0.5 * (i - 1) / max(1, n - 1))
        wrot(pb, ("Z", amp * scale * math.sin(ph)),
                 ("X", pitch * scale + pitch_amp * scale * math.sin(ph * 0.5)))
        touched.append(pb)
    return touched


def gait_clip(arm, pbs, name, frames, swing, fold, bob, roll, yaw,
              neck_amp, tail_amp, step=2):
    """A looping gait. Frame 1 and frame `frames`+1 hold the same pose."""
    new_action(arm, name)
    nn, tn = count(pbs, "neck"), count(pbs, "tail")
    for f in range(1, frames + 2, step):
        t = (f - 1) / frames
        touched = []
        for tag, ph in GAIT.items():
            touched += leg_pose(pbs, tag, (t + ph) % 1.0, swing, fold)

        root = pbs.get("root")
        if root:
            wloc(root, (0, 0, bob * math.sin(4 * math.pi * t)))
            wrot(root, ("Y", roll * math.sin(2 * math.pi * t)),
                       ("Z", yaw * math.sin(2 * math.pi * t)))
            key(root, f, loc=True)

        sp = pbs.get("spine")
        if sp:
            wrot(sp, ("Z", yaw * 0.6 * math.sin(2 * math.pi * t + 0.6)),
                     ("X", bob * 0.5 * math.sin(4 * math.pi * t)))
            touched.append(sp)

        touched += chain_wave(pbs, "neck", nn, t, neck_amp, 0.42, taper_out=False,
                              pitch_amp=neck_amp * 0.5)
        touched += chain_wave(pbs, "tail", tn, t, tail_amp, 0.62, taper_out=True,
                              pitch_amp=tail_amp * 0.35)
        head = pbs.get("head")
        if head:
            wrot(head, ("Z", -neck_amp * 0.7 * math.sin(2 * math.pi * t - 0.42 * nn)))
            touched.append(head)

        for pb in touched:
            key(pb, f)


def count(pbs, prefix):
    n = 0
    while f"{prefix}_{n + 1}" in pbs:
        n += 1
    return n


def idle_clip(arm, pbs, frames=96):
    """Breathing and a slow look around — almost still, but never frozen."""
    new_action(arm, "Idle")
    nn, tn = count(pbs, "neck"), count(pbs, "tail")
    for f in range(1, frames + 2, 3):
        t = (f - 1) / frames
        touched = []
        breath = math.sin(2 * math.pi * t * 2)
        root = pbs.get("root")
        if root:
            wloc(root, (0, 0, 0.018 * breath))
            wrot(root, ("Y", 0.006 * math.sin(2 * math.pi * t)))
            key(root, f, loc=True)
        sp = pbs.get("spine")
        if sp:
            wrot(sp, ("X", 0.012 * breath))
            touched.append(sp)
        # one slow sweep of the neck across the cycle, as if browsing
        look = math.sin(2 * math.pi * t)
        touched += chain_wave(pbs, "neck", nn, t, 0.075, 0.30, taper_out=False,
                              pitch=-0.05 * look, pitch_amp=0.02)
        touched += chain_wave(pbs, "tail", tn, t, 0.055, 0.45, taper_out=True)
        head = pbs.get("head")
        if head:
            wrot(head, ("Z", -0.05 * look), ("X", 0.04 * breath))
            touched.append(head)
        for pb in touched:
            key(pb, f)


def posed_clip(arm, pbs, name, poses):
    """A one-shot clip from explicit keyframes: [(frame, {bone: (rots, loc)})]."""
    new_action(arm, name)
    for frame, spec in poses:
        for bone, entry in spec.items():
            pb = pbs.get(bone)
            if not pb:
                continue
            rots, loc = entry
            wrot(pb, *rots)
            if loc is not None:
                wloc(pb, loc)
            key(pb, frame, loc=loc is not None)


def attack_clip(arm, pbs):
    """Tail whip — coil away, lash across, follow through, settle."""
    tn = count(pbs, "tail")

    def tail(amount, lag=0.0):
        return {f"tail_{i}": ((("Z", amount * (i / tn)),), None) for i in range(1, tn + 1)}

    def neck(pitch, yaw_):
        nn = count(pbs, "neck")
        return {f"neck_{i}": ((("X", pitch / nn), ("Z", yaw_ / nn)), None)
                for i in range(1, nn + 1)}

    posed_clip(arm, pbs, "Attack", [
        (1,  {**tail(0.0), **neck(0.0, 0.0), "root": ((), (0, 0, 0))}),
        (9,  {**tail(-0.42), **neck(-0.30, 0.22),
              "root": ((("Z", 0.10),), (0, 0, 0.05))}),
        (17, {**tail(0.62), **neck(-0.18, -0.20),
              "root": ((("Z", -0.13),), (0, 0, 0.02))}),
        (25, {**tail(0.28), **neck(0.05, -0.08), "root": ((("Z", -0.04),), (0, 0, 0))}),
        (36, {**tail(0.0), **neck(0.0, 0.0), "root": ((), (0, 0, 0))}),
    ])


def death_clip(arm, pbs):
    """Legs buckle, the body goes down, the neck follows it and stays there."""
    nn, tn = count(pbs, "neck"), count(pbs, "tail")
    hip = SHAPE["hip"]

    def legs(fold):
        out = {}
        for tag in GAIT:
            out[f"thigh_{tag}"] = ((("X", fold * 0.9),), None)
            out[f"shin_{tag}"] = ((("X", fold * 1.5),), None)
            out[f"foot_{tag}"] = ((("X", -fold * 0.8),), None)
        return out

    def neck(pitch, yaw_=0.0):
        return {f"neck_{i}": ((("X", pitch / nn * 1.4), ("Z", yaw_ / nn)), None)
                for i in range(1, nn + 1)}

    def tail(pitch, yaw_=0.0):
        return {f"tail_{i}": ((("X", pitch * (i / tn)), ("Z", yaw_ * (i / tn))), None)
                for i in range(1, tn + 1)}

    posed_clip(arm, pbs, "Death", [
        (1,  {**legs(0.0), **neck(0.0), **tail(0.0),
              "root": ((), (0, 0, 0))}),
        (10, {**legs(-0.10), **neck(-0.55, 0.10), **tail(-0.12),
              "root": ((("Y", -0.05),), (0, 0, 0.06))}),          # head snaps up
        (24, {**legs(0.55), **neck(0.35, 0.28), **tail(0.18, 0.20),
              "root": ((("Y", 0.22),), (0, 0, -hip * 0.30))}),     # knees go
        (40, {**legs(1.15), **neck(0.95, 0.42), **tail(0.42, 0.34),
              "root": ((("Y", 0.46),), (0, 0, -hip * 0.62))}),     # down on its side
        (60, {**legs(1.30), **neck(1.15, 0.46), **tail(0.52, 0.30),
              "root": ((("Y", 0.52),), (0, 0, -hip * 0.70))}),     # settled, still
    ])


# ── build ────────────────────────────────────────────────────────────────────
def main():
    out_dir = os.path.join(os.path.dirname(HERE), "blender")
    os.makedirs(out_dir, exist_ok=True)

    MS.reset()
    p = SHAPE

    coll = bpy.data.collections.new(SPECIES)
    bpy.context.scene.collection.children.link(coll)

    body = MS.build_blockout(p)
    tris = fuse(body)
    paint(body)
    unwrap(body)
    mat = skin_material(body)
    bake_skin(body, mat)
    arm = MS.build_rig(p)

    for obj in (body, arm):
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        coll.objects.link(obj)

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    bpy.context.view_layer.objects.active = arm
    arm.animation_data_create()
    pbs = {}
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pbs[pb.name] = pb

    gait_clip(arm, pbs, "Walk", 48, swing=0.22, fold=0.16, bob=0.05,
              roll=0.022, yaw=0.030, neck_amp=0.045, tail_amp=0.075)
    gait_clip(arm, pbs, "Run", 30, swing=0.34, fold=0.26, bob=0.10,
              roll=0.038, yaw=0.046, neck_amp=0.070, tail_amp=0.120)
    idle_clip(arm, pbs)
    attack_clip(arm, pbs)
    death_clip(arm, pbs)

    arm.animation_data.action = bpy.data.actions.get("Idle")

    path = os.path.join(out_dir, f"{SPECIES}_procedural.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"RESULT tris={tris} bones={len(arm.pose.bones)} "
          f"actions={sorted(a.name for a in bpy.data.actions)}")
    print(f"RESULT saved={path}")


main()
