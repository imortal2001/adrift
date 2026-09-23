"""
Prepare the hand-held tools: take three third-party .glb models, put each one
in the frame the game holds it by, and export them to assets/models/.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_tools.py -- [SOURCE_DIR] [--preview OUT_DIR]

SOURCE_DIR defaults to ~/Downloads. The sources are not in the repository —
the hammer alone is 19 MB — so fetch them from the Sketchfab pages listed in
CREDITS.md (all CC BY 4.0) and drop them there under their download names.

What the game needs from a held tool, and what this does to get it:

* **One frame for everything.** Every tool comes out standing along +Y with its
  working end up and facing +Z, and its origin *at the grip* — so src/
  viewmodel.js can put a hand anywhere and the tool pivots about the hand, not
  about the middle of its bounding box. The three sources were authored in
  three different frames and three different units (centimetres, metres, and
  something closer to model-railway scale), which is most of the work here.

* **Real sizes.** Scaled to a real-world length, so a hammer is a hammer's
  length from your eye and the spear reaches as far as a spear would.

* **The spear gets coloured.** It shipped as three untextured Phong materials,
  all pure white. Here it gets wood, knapped stone and rawhide lashing, baked
  into vertex colours so it costs no texture memory at all.

* **The spear gets a longer shaft.** Authored at 15:1 long to thick, which at
  spear length is an 11 cm shaft behind a 45 cm head — a club. The shaft is
  stretched along its own length only; the head and the lashing are exactly as
  the author made them. Set `lengthen` to None in its entry to keep the
  original proportions.

* **Textures sized for a hand, not a museum.** The hammer carries six PNG maps
  totalling 19 MB. Held at arm's length, 1024 is more than the screen can show.
  tools/glb_textures.py does the resizing, so its rules apply: base colour goes
  to JPEG, data maps are only resized.

CC BY 4.0 asks that changes be indicated, and these are changes. CREDITS.md
records them against each file.
"""
import math
import os
import subprocess
import sys

import bpy
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "assets", "models")


def _linear(c):
    """Blender colour attributes are linear; the palette below is sRGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgb(hexcode):
    return tuple(_linear(((hexcode >> s) & 0xFF) / 255) for s in (16, 8, 0))


# ── the tools ────────────────────────────────────────────────────────────────
# `up` is the authored axis the working end points along; it becomes +Z here,
# which the Y-up export turns into the game's +Y. `spin` then turns the tool
# about that axis so the right face points forward. `grip` is where the hand
# closes, as a fraction of the length from the butt.

TOOLS = {
    "hammer": dict(
        src="stone_hammer_axe_free.glb",
        up="-X", spin=90, length=0.46, grip=0.14,
        textures=dict(colour=1024, data=512),
    ),
    "spear": dict(
        src="stone_age_spear.glb",
        up="+Z", spin=0, length=1.75, grip=0.42,
        # Scale so the head is 7 cm across, then stretch everything below the
        # lashing until the spear is `length` long. None keeps the original.
        lengthen=dict(head_width=0.07, below_part="phong5"),
        recolour={
            # material name as shipped -> (what it is, sRGB, roughness)
            "phong3": ("wood",  0x7d5836, 0.74),
            "phong1": ("stone", 0x6f685e, 0.40),
            "phong5": ("cord",  0x9f7c4b, 0.90),
        },
    ),
    "rod": dict(
        src="fishing_rod.glb",
        up="+X", spin=0, length=2.20, grip=0.10,
        textures=dict(colour=1024, data=512),
    ),
}

AXES = {"+X": (1, 0, 0), "-X": (-1, 0, 0), "+Y": (0, 1, 0),
        "-Y": (0, -1, 0), "+Z": (0, 0, 1), "-Z": (0, 0, -1)}


# ── helpers ──────────────────────────────────────────────────────────────────
def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def flatten_hierarchy():
    """
    Unparent every mesh with its world transform intact and delete the empties.

    Sketchfab exports wrap the model in two or three empties carrying the
    FBX-to-glTF axis conversion; the transforms we want to reason about are the
    world ones, not the local ones inside that wrapper.
    """
    for o in meshes():
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        if o.data.users > 1:          # instanced data would be transformed twice
            o.data = o.data.copy()
    for o in [o for o in bpy.data.objects if o.type != "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)


def apply_transform(objs):
    """Bake object transforms into the mesh, custom normals included."""
    with bpy.context.temp_override(selected_editable_objects=objs,
                                   selected_objects=objs, active_object=objs[0],
                                   object=objs[0]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def world_verts(objs):
    return [o.matrix_world @ v.co for o in objs for v in o.data.vertices]


def bounds(objs):
    vs = world_verts(objs)
    lo = mathutils.Vector([min(v[i] for v in vs) for i in range(3)])
    hi = mathutils.Vector([max(v[i] for v in vs) for i in range(3)])
    return lo, hi


def transform_all(objs, m):
    for o in objs:
        o.matrix_world = m @ o.matrix_world
    apply_transform(objs)


def orient(objs, cfg):
    """Working end to +Z, then turn about Z so the right face leads."""
    q = mathutils.Vector(AXES[cfg["up"]]).rotation_difference(mathutils.Vector((0, 0, 1)))
    m = mathutils.Matrix.Rotation(math.radians(cfg["spin"]), 4, "Z") @ q.to_matrix().to_4x4()
    transform_all(objs, m)


def scale_to(objs, length):
    lo, hi = bounds(objs)
    transform_all(objs, mathutils.Matrix.Scale(length / (hi.z - lo.z), 4))


def lengthen_spear(objs, cfg):
    """
    Scale by the head, then stretch the shaft below the lashing. Stretching
    only along Z leaves a cylinder's side normals exactly as they were, so
    nothing about the shading changes but the length.
    """
    spec = cfg["lengthen"]
    head = [o for o in objs if any(m.name == "phong1" for m in o.data.materials)]
    lo, hi = bounds(head)
    width = max(hi.x - lo.x, hi.y - lo.y)
    transform_all(objs, mathutils.Matrix.Scale(spec["head_width"] / width, 4))

    lash = [o for o in objs if any(m.name == spec["below_part"] for m in o.data.materials)]
    cut = bounds(lash)[0].z                       # the bottom of the lashing
    lo, hi = bounds(objs)
    shaft_now = cut - lo.z
    shaft_want = cfg["length"] - (hi.z - cut)
    stretch = shaft_want / shaft_now
    for o in objs:
        for v in o.data.vertices:
            if v.co.z < cut:
                v.co.z = cut - (cut - v.co.z) * stretch
        o.data.update()
    return stretch


def grip_to_origin(objs, frac):
    """Put the origin on the handle's axis, `frac` of the way up from the butt."""
    lo, hi = bounds(objs)
    z = lo.z + (hi.z - lo.z) * frac
    band = (hi.z - lo.z) * 0.03
    near = [v for v in world_verts(objs) if abs(v.z - z) < band] or world_verts(objs)
    cx = sum(v.x for v in near) / len(near)
    cy = sum(v.y for v in near) / len(near)
    transform_all(objs, mathutils.Matrix.Translation((-cx, -cy, -z)))


# ── the spear's colour ───────────────────────────────────────────────────────
def _hash(*xs):
    h = 2166136261
    for x in xs:
        h = ((h ^ (int(x * 7919) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    return h / 0xFFFFFFFF


def paint(obj, kind, base):
    """
    Per-vertex colour for one part. The variation is what sells it: a flat
    brown cylinder reads as plastic, one with grain running along it reads as
    a stick somebody cut.
    """
    me = obj.data
    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        x, y, z = v.co
        if kind == "wood":
            # Grain runs along the shaft, so vary around it and barely along it.
            a = math.atan2(y, x)
            grain = 0.5 + 0.5 * math.sin(a * 9 + z * 3.1 + _hash(round(a, 1)) * 2.6)
            k = 0.72 + 0.42 * grain
            k *= 0.88 + 0.12 * min(1.0, abs(z) / 0.5)   # handled wood goes darker
        elif kind == "stone":
            # Knapped flint: flake scars leave patches lighter and darker.
            k = 0.78 + 0.42 * _hash(round(x, 3), round(y, 3), round(z, 3))
        else:
            # Rawhide lashing: strand-to-strand variation, plus the odd dark one.
            k = 0.82 + 0.26 * _hash(round(x, 3), round(z, 3))
            if _hash(round(z, 3)) > 0.92:
                k *= 0.72
        layer.data[i].color = tuple(c * k for c in base) + (1.0,)
    me.color_attributes.active_color = layer


def recolour(objs, cfg):
    for o in objs:
        for slot in o.material_slots:
            spec = cfg["recolour"].get(slot.material.name if slot.material else "")
            if not spec:
                continue
            kind, hexcode, rough = spec
            paint(o, kind, _rgb(hexcode))

            mat = bpy.data.materials.new(f"spear_{kind}")
            if mat.node_tree is None:     # 5.x materials come with nodes already
                mat.use_nodes = True
            nt = mat.node_tree
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            col = nt.nodes.new("ShaderNodeVertexColor")
            col.layer_name = "Col"
            nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = rough
            bsdf.inputs["Metallic"].default_value = 0.0
            slot.material = mat


# ── preview renders, for checking orientation by eye ─────────────────────────
def preview(name, objs, out_dir, colour_type):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = colour_type
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.film_transparent = False
    lo, hi = bounds(objs)
    span = max(hi.z - lo.z, hi.x - lo.x, hi.y - lo.y)
    mid = (lo + hi) / 2

    cam_data = bpy.data.cameras.new("preview")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span * 1.15
    cam = bpy.data.objects.new("preview", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Side on, then from behind the hand the way the player sees it.
    for view, pos, rot in (("side", (span * 3, 0, mid.z), (math.pi / 2, 0, math.pi / 2)),
                           ("player", (0, span * 3, mid.z), (math.pi / 2, 0, math.pi))):
        cam.location = (mid.x + pos[0], mid.y + pos[1], pos[2])
        cam.rotation_euler = rot
        scene.render.filepath = os.path.join(out_dir, f"{name}_{view}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


# ── export ───────────────────────────────────────────────────────────────────
def export(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    desired = {
        "filepath": path, "export_format": "GLB", "use_selection": True,
        "export_apply": True, "export_yup": True,
        "export_animations": False, "export_skins": False,
        "export_vertex_color": "MATERIAL",
        "export_cameras": False, "export_lights": False, "export_extras": False,
    }
    try:
        known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    except Exception:
        known = set(desired)
    kwargs = {k: v for k, v in desired.items() if k == "filepath" or k in known}
    bpy.ops.export_scene.gltf(**kwargs)


def shrink(path, spec):
    tmp = path + ".tmp.glb"
    os.replace(path, tmp)
    r = subprocess.run(["python3", os.path.join(HERE, "glb_textures.py"), tmp, path,
                        "--colour", str(spec["colour"]), "--normal", str(spec["data"])],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(path):
        os.replace(tmp, path)
        print(f"    texture shrink failed, kept full size:\n{r.stderr[-400:]}")
        return
    os.remove(tmp)


def build(name, cfg, src_dir, preview_dir):
    src = os.path.join(src_dir, cfg["src"])
    if not os.path.exists(src):
        print(f"  {name}: {cfg['src']} not found in {src_dir} — skipped")
        return None

    clear()
    bpy.ops.import_scene.gltf(filepath=src)
    flatten_hierarchy()
    objs = meshes()
    apply_transform(objs)

    orient(objs, cfg)
    note = ""
    if cfg.get("lengthen"):
        stretch = lengthen_spear(objs, cfg)
        note = f", shaft stretched x{stretch:.2f}"
    else:
        scale_to(objs, cfg["length"])
    if cfg.get("recolour"):
        recolour(objs, cfg)
    grip_to_origin(objs, cfg["grip"])

    # One object per tool: one mesh node in the file, materials kept as slots.
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=objs[0], object=objs[0],
                                       selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    obj = meshes()[0]
    obj.name = f"tool_{name}"

    lo, hi = bounds([obj])
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"  {name}: {hi.z - lo.z:.2f} m long, {tris} tris, grip at {cfg['grip']:.0%}{note}")

    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        preview(name, [obj], preview_dir, "VERTEX" if cfg.get("recolour") else "TEXTURE")

    path = os.path.join(OUT_DIR, f"tool_{name}.glb")
    export(obj, path)
    if cfg.get("textures"):
        shrink(path, cfg["textures"])
    print(f"    → {os.path.relpath(path, ROOT)}  ({os.path.getsize(path) / 1024:,.0f} KB)")
    return name


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview_dir = None
    if "--preview" in argv:
        i = argv.index("--preview")
        preview_dir = os.path.expanduser(argv[i + 1])
        del argv[i:i + 2]
    src_dir = os.path.expanduser(argv[0]) if argv else os.path.expanduser("~/Downloads")

    os.makedirs(OUT_DIR, exist_ok=True)
    built = [n for n in (build(k, v, src_dir, preview_dir) for k, v in TOOLS.items()) if n]
    print(f"\nbuilt: {', '.join(built) or 'nothing'}")
    print("Add any new ones to assets/models/manifest.json as tool_<name>.")


if __name__ == "__main__":
    main()
