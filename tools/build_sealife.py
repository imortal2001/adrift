"""
Bring the third-party reef and pond animals into the game.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_sealife.py -- [DOWNLOADS] [--only NAME]

DOWNLOADS defaults to ~/Downloads and holds the unzipped Sketchfab downloads
(credited in CREDITS.md; not in the repository). This writes, into
assets/models/, and adds each to the model manifest:

    sea_turtle.glb    "Sea turtle low poly", C.J..Goldman, CC BY 4.0
    tortoise.glb      "Tortoise - turtle", Daniel Zuleta Art, CC BY 4.0
    pond_turtle.glb   "CC0 Japanese Pond Turtle", ffish.asia / floraZia.com, CC0
    crab.glb          "Blue crab", Julian Johnson-Mortimer, CC BY 4.0
    octopus.glb       "Octopus", kenchoo, CC BY 4.0
    stingray.glb      "Stingray", LostBoyz2078, CC BY-NC 4.0 — NON-COMMERCIAL

What it does to each:

* **Down to a game's weight.** The pond turtle is a 1.6-million-triangle
  photoscan cut into 25 meshes at the 65,536-vertex limit — each one alone
  is a scatter of fragments, not a level of detail — so they are joined,
  welded along the cuts and brought down together (the 1 cm cube that came
  with it is dropped). The crab is 760 thousand, most of it in a pelt of
  "hair" meshes that are lost at 20 cm anyway and are dropped. Everything is
  decimated (collapse, which keeps UVs and, on the rigged ones, vertex
  weights) to a few thousand.
* **Plain lit materials** (clean_materials): as they came, the tortoise is
  half metal, the crab mirror-glossy and the pond turtle unlit.
* **Textures at TEX², as JPEG**, from up to 42 MB.
* **In the game's frame**: facing +Z (Blender -Y), up +Y, standing on y = 0,
  centred, at its real size (MODELS). The rigged two are turned here, but
  their size and footing are set by the game from the posed model — a rig's
  rest bounds and its posed bounds are not the same thing.
* **Kept apart where the game moves the parts.** The crab's shell, claws and
  ten legs stay separate objects, each with its origin at the joint it
  turns about (the end nearest the shell), named body, claw_L/R, leg_L0..4,
  leg_R0..4 (front to back; 4 the swimming paddle). The octopus and the stingray keep their rigs
  (the stingray its swim clip too); the game curls the octopus's arm chains
  itself. The sea turtle, the tortoise and the pond turtle are one mesh
  each — the game moves their flippers, legs and heads in the vertex shader
  (src/reefmodels.js).
"""
import json
import math
import os
import sys

import bpy
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "assets", "models")
TEX = 1024

# name: source folder, what to drop, which way it faces as it comes (Blender
# axes), what to measure and how big that is in metres, and triangle budgets.
MODELS = {
    # The outer eye is a glassy see-through lens over the painted one: as an
    # ordinary material it would be an opaque ball hiding it, so it goes.
    "sea_turtle":  dict(src="sea_turtle_low_poly", drop=["outer eyes"], front="+y", measure="y", size=1.0, tris=7000, rough=0.55),
    "tortoise":    dict(src="tortoise_-_turtle", front="-y", measure="y", size=0.55, tris=7000, rough=0.75),
    "pond_turtle": dict(src="cc0____japanese_pond_turtle", drop=["Object_4"], front="-x", measure="y", size=0.22, tris=6000, rough=0.5, weld=True),
    "crab":        dict(src="blue_crab", drop=["Hair", "hair"], front="+y", measure="x", size=0.34, parts=True, rough=0.45),
    "octopus":     dict(src="octopus", drop=["Icosphere"], front="-y", measure="x", size=0.8, tris=9000, rig=True, rough=0.45),
    "stingray":    dict(src="stingray", drop=["Icosphere"], front="-y", measure="x", size=1.1, rig=True, clips=True, rough=0.55),
}
TURN = {"-y": 0, "+y": math.pi, "+x": -math.pi / 2, "-x": math.pi / 2}   # about Z, to face -Y


def objs(kind=None):
    return [o for o in bpy.context.scene.objects if kind is None or o.type == kind]


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, "scene.gltf"))


def select(os_, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in os_:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (os_[0] if os_ else None)


def flatten(meshes):
    """Every mesh out of its hierarchy, its transform baked into its vertices."""
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mathutils.Matrix.Identity(4)
        o.data.transform(mw)
    for o in objs("EMPTY"):
        bpy.data.objects.remove(o, do_unlink=True)


def weld(o):
    """
    Join vertices that sit on top of each other: along the cuts of a scan
    that came in pieces, which would otherwise decimate apart into cracks.
    (UVs are per corner in Blender, so welding keeps them.)
    """
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    size = max(o.dimensions) or 1
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 1e-4)
    bm.to_mesh(o.data)
    bm.free()


def decimate(o, tris):
    if not o.find_armature():
        weld(o)
    now = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if not tris or now <= tris:
        return
    select([o])
    # Shape keys (the octopus has some) block it; the game does not use them.
    if o.data.shape_keys:
        o.shape_key_clear()
    m = o.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = tris / now
    # Before any armature modifier, so the weights come through.
    while o.modifiers.find("dec") > 0:
        bpy.ops.object.modifier_move_up(modifier="dec")
    bpy.ops.object.modifier_apply(modifier="dec")


def bbox(meshes):
    # From the vertices: bound_box is cached, and lags a data.transform().
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def clean_materials(rough):
    """
    Every material a plain lit one: its colour texture (and normal map, if it
    has one), not metallic, `rough`. As they came, the tortoise is half metal
    (black, in a game with no reflections to show), the crab mirror-glossy,
    and the pond turtle unlit — it would ignore the sun.
    """
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        imgs = [n.image for n in nt.nodes if n.type == "TEX_IMAGE" and n.image]
        colour = next((i for i in imgs if "normal" not in i.name.lower()), None)
        normal = next((i for i in imgs if "normal" in i.name.lower()), None)
        base = next((n.inputs["Base Color"].default_value[:] for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), (0.8, 0.8, 0.8, 1))
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = rough
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        if colour:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = colour
            nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            bsdf.inputs["Base Color"].default_value = base
        if normal:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = normal
            t.image.colorspace_settings.name = "Non-Color"
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(t.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])


def shrink_textures():
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > TEX:
            k = TEX / max(w, h)
            img.scale(max(1, round(w * k)), max(1, round(h * k)))


def origin_at(o, point):
    bpy.context.scene.cursor.location = point
    select([o])
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")



def crab_parts(meshes):
    """The shell joined into one; claws and legs kept, each pivoting where it meets the shell."""
    body = [o for o in meshes if "Body" in o.name or "body" in o.name.split("_")[0]]
    claws = [o for o in meshes if "Arm" in o.name or "Arem" in o.name]
    legs = [o for o in meshes if o not in body and o not in claws]
    select(body, body[0])
    bpy.ops.object.join()
    shell = bpy.context.view_layer.objects.active
    shell.name = "body"
    decimate(shell, 4000)
    for o in claws:
        decimate(o, 1500)
    for o in legs:
        decimate(o, 500)
    return shell, claws, legs


def name_parts(shell, claws, legs):
    """After turning: which side each is on, and the legs front to back; each origin at its joint."""
    for o in claws + legs:
        vs = [o.matrix_world @ v.co for v in o.data.vertices]
        inner = min(vs, key=lambda v: abs(v.x))                 # the end at the shell
        mid_y = sum(v.y for v in vs) / len(vs)
        origin_at(o, mathutils.Vector((inner.x, (inner.y + mid_y) / 2 if o in legs else inner.y, inner.z)))
    for o in claws:
        o.name = "claw_L" if o.location.x > 0 else "claw_R"
    for side, test in (("L", lambda o: o.location.x > 0), ("R", lambda o: o.location.x <= 0)):
        mine = sorted([o for o in legs if test(o)], key=lambda o: o.location.y)   # -Y is the front
        for i, o in enumerate(mine):
            o.name = f"leg_{side}{i}"
    origin_at(shell, mathutils.Vector((0, 0, 0)))


def build(name, cfg, downloads):
    src = os.path.join(downloads, cfg["src"])
    load(src)
    for o in list(objs()):
        if any(d in o.name for d in cfg.get("drop", [])) or (cfg.get("keep") and o.type == "MESH" and o.name not in cfg["keep"]):
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = objs("MESH")
    rig = objs("ARMATURE")[0] if cfg.get("rig") else None

    if rig:
        # Rigged: one mesh, decimated before its armature; the whole rig
        # hung from a root that turns, scales and stands it.
        for o in meshes:
            decimate(o, cfg.get("tris"))
        root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(root)
        rig.parent = root
        root.rotation_euler = (0, 0, TURN[cfg["front"]])
        bpy.context.view_layer.update()
        lo, hi = bbox(meshes)
        k = cfg["size"] / (hi - lo)["xyz".index(cfg["measure"])]
        root.scale = (k, k, k)
        bpy.context.view_layer.update()
        lo, hi = bbox(meshes)
        root.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
        export = [root, rig] + meshes
    else:
        flatten(meshes)
        meshes = objs("MESH")
        if cfg.get("parts"):
            shell, claws, legs = crab_parts(meshes)
            meshes = [shell] + claws + legs
        else:
            select(meshes)
            if len(meshes) > 1:
                bpy.ops.object.join()
            meshes = [bpy.context.view_layer.objects.active]
            meshes[0].name = name
            if cfg.get("weld"):
                weld(meshes[0])
            decimate(meshes[0], cfg["tris"])
        # Turn, scale and stand it, into the vertices.
        turn = mathutils.Matrix.Rotation(TURN[cfg["front"]], 4, "Z")
        for o in meshes:
            o.data.transform(turn)                      # (flatten() left every one at identity)
        lo, hi = bbox(meshes)
        k = cfg["size"] / (hi - lo)["xyz".index(cfg["measure"])]
        lo2 = lo * k
        move = mathutils.Matrix.Translation((-(lo.x + hi.x) / 2 * k, -(lo.y + hi.y) / 2 * k, -lo2.z)) @ mathutils.Matrix.Scale(k, 4)
        for o in meshes:
            o.data.transform(move)
        if cfg.get("parts"):
            name_parts(*crab_parts_split(meshes))
        export = meshes

    clean_materials(cfg.get("rough", 0.6))
    shrink_textures()
    select(export)
    out = os.path.join(OUTDIR, f"{name}.glb")
    desired = dict(filepath=out, export_format="GLB", use_selection=True, export_apply=not rig,
                   export_yup=True, export_animations=bool(cfg.get("clips")), export_skins=bool(rig),
                   export_image_format="JPEG", export_jpeg_quality=85,
                   export_cameras=False, export_lights=False, export_extras=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in desired.items() if k == "filepath" or k in known})
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs("MESH"))
    print(f"\n→ assets/models/{name}.glb  ({os.path.getsize(out) / 1024:,.1f} KB, {tris:,} triangles)")

    man = os.path.join(OUTDIR, "manifest.json")
    data = json.load(open(man))
    if name not in data["models"]:
        data["models"].append(name)
        json.dump(data, open(man, "w"), indent=2)
        open(man, "a").write("\n")


def crab_parts_split(meshes):
    return meshes[0], [o for o in meshes if o.name.startswith(("Carb", "carb"))], \
        [o for o in meshes[1:] if not o.name.startswith(("Carb", "carb"))]


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    rest = [a for i, a in enumerate(argv) if a != "--only" and (i == 0 or argv[i - 1] != "--only")]
    downloads = rest[0] if rest else os.path.expanduser("~/Downloads")
    for name, cfg in MODELS.items():
        if only and name != only:
            continue
        build(name, cfg, downloads)
