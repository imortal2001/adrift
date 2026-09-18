"""
Generate a starter .blend per species: correct name, scale, orientation and
rig, with the five clip slots the game looks for already created.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/make_starters.py

Each file gets:

* a **collection named after the species**, which is how the exporter knows
  what it is looking at;
* proportions taken from side-view reference — necks and tails are chains that
  turn as they go, so they arc rather than reading as straight pipes, and the
  bipeds get digitigrade legs, clawed toes and forelimbs;
* a rough blockout at the right real-world size, **facing -Y** — the direction
  that exports to the game's forward;
* an armature with a sensible bone chain, skinned with automatic weights;
* five actions — Idle, Walk, Run, Attack, Death — each with a couple of keys,
  so the export produces all five clips from the start.

The blockout is scaffolding, not art. Reshape it, replace it, sculpt over it —
as long as the collection name, the facing and the action names survive, the
export keeps working.
"""

import os
import sys
import math

import bpy
import mathutils

OUT_DIR_NAME = "blender"

# Real-world sizes, matching the procedural bodies they replace so the swap
# does not change reach, collision or sight ranges.
#
# Necks and tails are built as chains that turn as they go, because a single
# straight cone reads as a pipe. `rise` is the angle above horizontal where the
# chain leaves the body, `settle` where it ends — so a sauropod's neck sweeps up
# off the shoulders and then flattens out ahead of it, and its tail leaves the
# hips level and droops.
SPECIES = {
    # Proportions taken from a reference side-view: low arcing neck carried
    # roughly horizontal, deep barrel chest with a shoulder hump, thick-based
    # drooping tail, and heavy column legs holding the belly well clear.
    "sauropod": dict(
        length=23.0, legs=4, hip=4.2, girth=1.85, torso=6.4,
        neck=dict(length=8.2, segments=5, rise=32, settle=5, base=0.80, tip=0.30),
        tail=dict(length=8.4, segments=5, rise=-6, settle=-26, base=0.80, tip=0.05),
        head=dict(length=1.3, width=0.52, height=0.5),
        hump=0.34, foot=1.5,
    ),
    "stegosaur": dict(
        length=8.0, legs=4, hip=1.8, girth=1.2, torso=3.2,
        neck=dict(length=1.3, segments=2, rise=18, settle=-8, base=0.42, tip=0.26),
        tail=dict(length=3.0, segments=4, rise=4, settle=14, base=0.46, tip=0.06),
        head=dict(length=0.62, width=0.32, height=0.3),
        hump=0.42, foot=1.3,
    ),
    "parasaur": dict(
        length=6.5, legs=4, hip=1.7, girth=0.92, torso=2.6,
        neck=dict(length=1.6, segments=3, rise=42, settle=22, base=0.34, tip=0.2),
        tail=dict(length=2.6, segments=4, rise=-4, settle=-18, base=0.4, tip=0.05),
        head=dict(length=0.66, width=0.28, height=0.3),
        hump=0.2, foot=1.15,
    ),
    "raptor": dict(
        length=5.0, legs=2, hip=1.45, girth=0.55, torso=1.7,
        neck=dict(length=1.0, segments=3, rise=48, settle=4, base=0.24, tip=0.16),
        tail=dict(length=2.4, segments=5, rise=4, settle=-2, base=0.28, tip=0.03),
        head=dict(length=0.62, width=0.26, height=0.26),
        hump=0.16, foot=1.0,
        thigh=0.85, arms=dict(scale=0.95, fingers=3), toes=3,
    ),
    # Proportions from a side-view reference: spine carried horizontally and
    # balanced over the hips, tail held out straight as a counterweight,
    # enormous thigh stepping down to a digitigrade ankle, deep boxy skull on
    # a short thick neck — and the famously small two-fingered arms.
    "tyrannosaur": dict(
        length=13.0, legs=2, hip=3.9, girth=1.55, torso=4.6,
        neck=dict(length=2.0, segments=3, rise=24, settle=-16, base=0.80, tip=0.60),
        tail=dict(length=5.6, segments=6, rise=4, settle=-2, base=0.88, tip=0.05),
        head=dict(length=1.75, width=0.74, height=0.9),
        hump=0.26, foot=1.0,
        thigh=1.10, arms=dict(scale=0.30, fingers=2), toes=3,
    ),
}

CLIPS = ["Idle", "Walk", "Run", "Attack", "Death"]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def add_mesh(kind, **kw):
    getattr(bpy.ops.mesh, kind)(**kw)
    return bpy.context.active_object


def apply_scale(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def chain(start, spec, forward):
    """
    Walk a neck or tail outward, turning a little at each step.

    `forward` is -1 toward the head, +1 toward the tail. Returns the joint
    positions, so the mesh segments and the bones follow the same curve and
    automatic weights have something sensible to bind to.
    """
    pts = [mathutils.Vector(start)]
    n = spec["segments"]
    seg = spec["length"] / n
    for i in range(n):
        t = i / max(1, n - 1)
        ang = math.radians(spec["rise"] + (spec["settle"] - spec["rise"]) * t)
        step = mathutils.Vector((0.0, forward * math.cos(ang) * seg, math.sin(ang) * seg))
        pts.append(pts[-1] + step)
    return pts


def tube(p0, p1, r0, r1):
    """A tapering segment running from p0 to p1."""
    v = mathutils.Vector(p1) - mathutils.Vector(p0)
    depth = v.length
    if depth < 1e-5:
        return None
    mid = (mathutils.Vector(p0) + mathutils.Vector(p1)) / 2
    obj = add_mesh("primitive_cone_add", radius1=r0, radius2=r1, depth=depth,
                   vertices=12, location=mid)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = v.to_track_quat("Z", "Y")
    apply_scale(obj)
    return obj


def claw_at(point, direction, length, radius):
    """A claw cone pointing along `direction`."""
    v = mathutils.Vector(direction).normalized()
    obj = add_mesh("primitive_cone_add", radius1=radius, radius2=0.0,
                   depth=length, vertices=6,
                   location=tuple(mathutils.Vector(point) + v * length * 0.5))
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = v.to_track_quat("Z", "Y")
    apply_scale(obj)
    return obj


def column_leg(p, lx, ly):
    """A pillar for the heavy quadrupeds, with a spread foot pad and toes."""
    hip, girth = p["hip"], p["girth"]
    parts = [
        tube((lx, ly, hip), (lx, ly, hip * 0.08), girth * 0.30, girth * 0.22),
        add_mesh("primitive_cylinder_add", radius=girth * 0.30 * p["foot"],
                 depth=hip * 0.09, vertices=10, location=(lx, ly, hip * 0.045)),
    ]
    apply_scale(parts[-1])
    for a in (-0.5, 0.0, 0.5):
        parts.append(claw_at((lx + math.sin(a) * girth * 0.24, ly - math.cos(a) * girth * 0.30,
                              hip * 0.05), (math.sin(a), -math.cos(a), -0.15),
                             girth * 0.20, girth * 0.09))
    return [o for o in parts if o]


def theropod_leg(p, lx, ly):
    """
    A bird leg: heavy thigh forward, shin back, long metatarsus forward again,
    then toes flat on the ground. That Z is what makes it read as a theropod
    rather than a body on posts.
    """
    hip, girth = p["hip"], p["girth"]
    th = p.get("thigh", 0.9)

    knee = (lx, ly - hip * 0.10, hip * 0.52)
    ankle = (lx, ly + hip * 0.14, hip * 0.22)
    sole = (lx, ly - hip * 0.02, hip * 0.045)

    parts = [
        tube((lx, ly + hip * 0.05, hip), knee, girth * 0.42 * th, girth * 0.24 * th),
        tube(knee, ankle, girth * 0.24 * th, girth * 0.15),
        tube(ankle, sole, girth * 0.15, girth * 0.12),
    ]
    # Toes splayed forward, each finished with a claw.
    toes = p.get("toes", 3)
    span = 0.42
    for i in range(toes):
        a = (i - (toes - 1) / 2) * span
        toe_len = hip * 0.20
        tip = (sole[0] + math.sin(a) * toe_len, sole[1] - math.cos(a) * toe_len, hip * 0.03)
        parts.append(tube(sole, tip, girth * 0.11, girth * 0.07))
        parts.append(claw_at(tip, (math.sin(a), -math.cos(a), -0.2), hip * 0.09, girth * 0.06))
    # A short backward toe for balance.
    heel = (sole[0], sole[1] + hip * 0.10, hip * 0.035)
    parts.append(tube(sole, heel, girth * 0.09, girth * 0.05))
    return [o for o in parts if o]


def foreleg(p, side):
    """Small forelimbs held in against the chest."""
    hip, girth, torso = p["hip"], p["girth"], p["torso"]
    cfg = p["arms"]
    k = cfg["scale"]
    sx = side * girth * 0.86
    shoulder = (sx, -torso * 0.30, hip + girth * 0.30)
    elbow = (sx + side * girth * 0.10, -torso * 0.30 - girth * 0.34 * k, hip + girth * 0.30 - girth * 0.52 * k)
    wrist = (elbow[0], elbow[1] + girth * 0.22 * k, elbow[2] - girth * 0.40 * k)

    parts = [
        tube(shoulder, elbow, girth * 0.17 * k, girth * 0.13 * k),
        tube(elbow, wrist, girth * 0.13 * k, girth * 0.10 * k),
    ]
    for i in range(cfg["fingers"]):
        a = (i - (cfg["fingers"] - 1) / 2) * 0.4
        tip = (wrist[0] + math.sin(a) * girth * 0.20 * k,
               wrist[1] - girth * 0.20 * k,
               wrist[2] - girth * 0.10 * k)
        parts.append(tube(wrist, tip, girth * 0.07 * k, girth * 0.045 * k))
        parts.append(claw_at(tip, (math.sin(a), -1, -0.5), girth * 0.16 * k, girth * 0.04 * k))
    return [o for o in parts if o]


def build_blockout(p):
    """Body parts, facing -Y. Returns one joined mesh object."""
    parts = []
    hip, girth, torso = p["hip"], p["girth"], p["torso"]
    back = hip + girth * p["hump"]

    # Barrel body: a deeper chest and a slightly higher rump, overlapping, so
    # the back has a hump instead of being a single even sausage.
    # Two masses sat close enough to merge into one barrel: further apart and
    # they read as a pair of balls with a pinch between them.
    chest = add_mesh("primitive_uv_sphere_add", radius=1, segments=20, ring_count=12,
                     location=(0, -torso * 0.16, hip))
    chest.scale = (girth, torso * 0.44, girth * 1.04)
    apply_scale(chest)
    parts.append(chest)

    rump = add_mesh("primitive_uv_sphere_add", radius=1, segments=20, ring_count=12,
                    location=(0, torso * 0.17, hip + girth * p["hump"] * 0.4))
    rump.scale = (girth * 0.97, torso * 0.42, girth * 1.0)
    apply_scale(rump)
    parts.append(rump)

    # A saddle over the shoulders, so the neck leaves a hump instead of a gap.
    withers = add_mesh("primitive_uv_sphere_add", radius=1, segments=16, ring_count=10,
                       location=(0, -torso * 0.34, hip + girth * p["hump"] * 0.55))
    withers.scale = (girth * 0.82, torso * 0.22, girth * 0.78)
    apply_scale(withers)
    parts.append(withers)

    # Neck, off the front of the chest and forward.
    neck_pts = chain((0, -torso * 0.46, back * 0.98), p["neck"], forward=-1)
    ns = p["neck"]
    for i in range(len(neck_pts) - 1):
        t0, t1 = i / (len(neck_pts) - 1), (i + 1) / (len(neck_pts) - 1)
        seg = tube(neck_pts[i], neck_pts[i + 1],
                   ns["base"] + (ns["tip"] - ns["base"]) * t0,
                   ns["base"] + (ns["tip"] - ns["base"]) * t1)
        if seg:
            parts.append(seg)

    # Head on the end of the neck, pointing the way the neck was going.
    h = p["head"]
    tip, prev = neck_pts[-1], neck_pts[-2]
    facing = (tip - prev).normalized()
    # Skull as a taper: wide and deep at the jaw hinge, narrowing to the snout.
    skull = tube(tuple(tip), tuple(tip + facing * h["length"]),
                 max(h["width"], h["height"]) * 0.62, h["width"] * 0.34)
    if skull:
        skull.scale = (1.0, 1.0, h["height"] / max(h["width"], 1e-5) * 0.92)
        apply_scale(skull)
        parts.append(skull)
    jaw = tube(tuple(tip + facing * h["length"] * 0.12 - mathutils.Vector((0, 0, h["height"] * 0.42))),
               tuple(tip + facing * h["length"] * 0.94 - mathutils.Vector((0, 0, h["height"] * 0.34))),
               h["width"] * 0.42, h["width"] * 0.26)
    if jaw:
        parts.append(jaw)

    # Tail, off the rump and back.
    tail_pts = chain((0, torso * 0.46, hip + girth * p["hump"] * 0.4), p["tail"], forward=1)
    ts = p["tail"]
    for i in range(len(tail_pts) - 1):
        t0, t1 = i / (len(tail_pts) - 1), (i + 1) / (len(tail_pts) - 1)
        seg = tube(tail_pts[i], tail_pts[i + 1],
                   ts["base"] + (ts["tip"] - ts["base"]) * t0,
                   ts["base"] + (ts["tip"] - ts["base"]) * t1)
        if seg:
            parts.append(seg)

    # Legs
    for lx, ly in leg_positions(p):
        if p["legs"] == 4:
            parts += column_leg(p, lx, ly)
        else:
            parts += theropod_leg(p, lx, ly)

    # Forelimbs, for the ones that have them.
    if p.get("arms"):
        for side in (-1, 1):
            parts += foreleg(p, side)

    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "body"
    return body


def leg_positions(p):
    girth, torso = p["girth"], p["torso"]
    if p["legs"] == 4:
        return [(-girth * 0.72, -torso * 0.30), (girth * 0.72, -torso * 0.30),
                (-girth * 0.78, torso * 0.30), (girth * 0.78, torso * 0.30)]
    return [(-girth * 0.78, 0.0), (girth * 0.78, 0.0)]


def build_rig(p):
    """Bones following the same curves the mesh was built from."""
    hip, girth, torso = p["hip"], p["girth"], p["torso"]
    back = hip + girth * p["hump"]

    arm_data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head, b.tail = tuple(head), tuple(tail)
        if parent:
            b.parent = parent
            b.use_connect = False
        return b

    root = bone("root", (0, torso * 0.3, hip), (0, -torso * 0.1, hip))
    spine = bone("spine", (0, torso * 0.3, hip), (0, -torso * 0.46, back * 0.98), root)

    neck_pts = chain((0, -torso * 0.46, back * 0.98), p["neck"], forward=-1)
    parent = spine
    for i in range(len(neck_pts) - 1):
        parent = bone(f"neck_{i + 1}", neck_pts[i], neck_pts[i + 1], parent)
    tip, prev = neck_pts[-1], neck_pts[-2]
    bone("head", tip, tip + (tip - prev).normalized() * p["head"]["length"], parent)

    tail_pts = chain((0, torso * 0.46, hip + girth * p["hump"] * 0.4), p["tail"], forward=1)
    parent = root
    for i in range(len(tail_pts) - 1):
        parent = bone(f"tail_{i + 1}", tail_pts[i], tail_pts[i + 1], parent)

    tags = ["fl", "fr", "bl", "br"] if p["legs"] == 4 else ["l", "r"]
    for tag, (lx, ly) in zip(tags, leg_positions(p)):
        thigh = bone(f"thigh_{tag}", (lx, ly, hip), (lx, ly, hip * 0.58), root)
        shin = bone(f"shin_{tag}", (lx, ly, hip * 0.58), (lx, ly, hip * 0.2), thigh)
        bone(f"foot_{tag}", (lx, ly, hip * 0.2), (lx, ly - hip * 0.18, 0.0), shin)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def add_clips(arm):
    """Five named actions, each with a small pose change so the clip is real."""
    arm.animation_data_create()
    pb = arm.pose.bones.get("spine") or arm.pose.bones[0]
    pb.rotation_mode = "XYZ"
    amounts = {"Idle": 0.03, "Walk": 0.12, "Run": 0.22, "Attack": 0.35, "Death": -0.5}
    for name in CLIPS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True          # survives a save with nothing assigned
        arm.animation_data.action = act
        amp = amounts[name]
        for frame, a in ((1, 0.0), (12, amp), (24, 0.0)):
            pb.rotation_euler = (a, 0, 0)
            pb.keyframe_insert("rotation_euler", frame=frame)


def build(species, params, out_dir):
    reset()

    coll = bpy.data.collections.new(species)
    bpy.context.scene.collection.children.link(coll)

    body = build_blockout(params)
    arm = build_rig(params)

    for obj in (body, arm):
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        coll.objects.link(obj)

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    add_clips(arm)

    path = os.path.join(out_dir, f"{species}_starter.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return path


def main():
    here = globals().get("__file__")
    root = os.path.dirname(os.path.dirname(os.path.abspath(here))) if here else os.getcwd()
    out_dir = os.path.join(root, OUT_DIR_NAME)
    os.makedirs(out_dir, exist_ok=True)

    print("\n" + "=" * 58)
    print("Adrift starter rigs")
    print("=" * 58)
    for species, params in SPECIES.items():
        path = build(species, params, out_dir)
        kb = os.path.getsize(path) / 1024
        print(f"  {species:<13} {params['length']:>5.1f} m  "
              f"{params['legs']} legs  →  {os.path.relpath(path, root)} ({kb:,.0f} KB)")
    print("\nOpen one, reshape or replace the blockout, then:")
    print("  Blender --background blender/raptor_starter.blend --python tools/export_models.py")
    print("=" * 58 + "\n")


if __name__ == "__main__":
    main()
