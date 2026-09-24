"""
Bring a Ready Player Me character into the game as the player's body.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_player.py -- woman|man [SOURCE_DIR] [--preview OUT_DIR]

SOURCE_DIR defaults to the unzipped Sketchfab download for that character in
~/Downloads (see SOURCES). Both are by Ready Player Me, CC BY-NC-SA 4.0 —
credited in CREDITS.md. That licence allows changing them but only for
non-commercial use, and what comes out of this script carries the same
licence: assets/models/player_woman.glb and player_man.glb are CC BY-NC-SA
4.0, whatever the rest of the game is.

The sources are rigged (a Mixamo-style humanoid skeleton) but have no
animation — the game moves the bones itself (src/body.js). What this does:

* **One armature and its meshes**, nothing else: the stray icosphere the
  woman's file carries is dropped.
* **Facing -Z, feet at 0**, the way the game's player faces at yaw 0.
* **Bone names cleaned** of the numeric suffixes the Sketchfab export gave
  them ("LeftUpLeg_60" → "LeftUpLeg"), so body.js finds them by name.
* **Dressed for the Stone Age**, by repainting, not remodelling: the woman's
  striped dress already reads as hide, so only her black belt and shoes go
  to worn leather; the man's T-shirt becomes a hide tunic, his jeans leather
  leggings and his trainers leather wraps (see OUTFITS).
* **Textures as JPEG**, colour at 1024² at most and normal maps at 512².
"""
import json
import os
import re
import sys

import bpy
import mathutils
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = {
    "woman": "~/Downloads/ready_player_me_female_character",
    "man": "~/Downloads/ready_player_me_male_avatar_vrchatgame_ready",
}
TEX = 1024

# How each outfit material is repainted: a tint over the texture's own
# light and shade, so the folds and seams survive. (r, g, b) in 0..1, linear.
LEATHER = (0.23, 0.13, 0.07)
OUTFITS = {
    "woman": {"Wolf3D_Outfit_Footwear": ("tint", LEATHER)},
    "man": {
        "Wolf3D_Outfit_Top": ("hide", (0.42, 0.27, 0.14)),
        "Wolf3D_Outfit_Bottom": ("tint", (0.26, 0.16, 0.09)),
        "Wolf3D_Outfit_Footwear": ("tint", LEATHER),
    },
}


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, "scene.gltf"))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.context.scene.objects
              if o.type == "MESH" and o.data.materials and o.find_armature() == arm]
    # Everything else goes: empties the export wrapped it in, stray objects.
    for o in list(bpy.context.scene.objects):
        if o is not arm and o not in meshes:
            if o.type == "EMPTY":
                for ch in o.children:
                    mw = ch.matrix_world.copy()
                    ch.parent = None
                    ch.matrix_world = mw
            bpy.data.objects.remove(o, do_unlink=True)
    return arm, meshes


def orient(arm, meshes):
    """Turn to face -Y in Blender (-Z in glTF, the game's forward); feet at 0."""
    bpy.context.view_layer.update()
    mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
    # The characters face -Y in Blender as they come (+Z in glTF). The game's
    # player looks down -Z, so a half turn.
    turn = mathutils.Matrix.Rotation(np.pi, 4, "Z")
    lift = mathutils.Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    arm.matrix_world = turn @ lift @ arm.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    print(f"  {mx.z - mn.z:.2f} m tall")


def clean_names(arm):
    for b in arm.data.bones:
        b.name = re.sub(r"_\d+$", "", b.name)


def pixels(img):
    w, h = img.size
    return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)


def repaint(meshes, outfit):
    for o in meshes:
        for m in o.data.materials:
            if m.name not in outfit:
                continue
            how, colour = outfit[m.name]
            node = next((n for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                         and "normal" not in n.image.name.lower()
                         and "metallic" not in n.image.name.lower()), None)
            if node is None:
                continue
            px = pixels(node.image)
            lum = px[..., :3] @ np.array([0.3, 0.59, 0.11])
            # Keep the texture's shading, normalised round mid grey, as the
            # light and dark of the new colour.
            shade = np.clip(lum / max(np.median(lum), 1e-3), 0.25, 1.8)[..., None]
            out = np.array(colour)[None, None, :] * shade
            if how == "hide":
                # Hide: blotched and mottled, not a dyed cloth.
                h, w = lum.shape
                yy, xx = np.mgrid[0:h, 0:w] / max(h, w)
                blot = (np.sin(xx * 23 + np.sin(yy * 17) * 2) * np.sin(yy * 19 + np.sin(xx * 13) * 2))
                out *= (0.85 + 0.2 * blot)[..., None]
            px[..., :3] = np.clip(out, 0, 1)
            node.image.pixels.foreach_set(px.ravel())
            node.image.update()
            print(f"  {m.name}: repainted ({how})")


def shrink(meshes):
    seen = set()
    for o in meshes:
        for m in o.data.materials:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and n.image.name not in seen:
                    seen.add(n.image.name)
                    w, h = n.image.size
                    # Normal maps at half: fine folds, seen from a few metres.
                    cap = TEX // 2 if "normal" in n.image.name.lower() else TEX
                    if max(w, h) > cap:
                        n.image.scale(cap, cap)
                    n.image.file_format = "JPEG" if "metallic" not in n.image.name.lower() else "PNG"
                    n.image.pack()


def build(who, src, preview=None):
    out = os.path.join(ROOT, "assets", "models", f"player_{who}.glb")
    arm, meshes = load(src)
    orient(arm, meshes)
    clean_names(arm)
    repaint(meshes, OUTFITS.get(who, {}))
    shrink(meshes)
    arm.name = f"player_{who}"
    if preview:
        render(meshes, preview, who)

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in meshes:
        o.select_set(True)
    desired = dict(filepath=out, export_format="GLB", use_selection=True, export_apply=False,
                   export_yup=True, export_animations=False, export_skins=True,
                   export_image_format="JPEG", export_jpeg_quality=85,
                   export_cameras=False, export_lights=False, export_extras=False,
                   export_morph=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in desired.items() if k == "filepath" or k in known})
    print(f"\n→ {os.path.relpath(out, ROOT)}  ({os.path.getsize(out) / 1024:,.1f} KB)")

    man = os.path.join(ROOT, "assets", "models", "manifest.json")
    data = json.load(open(man))
    if f"player_{who}" not in data["models"]:
        data["models"].append(f"player_{who}")
        json.dump(data, open(man, "w"), indent=2)
        open(man, "a").write("\n")


def render(meshes, out_dir, who):
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 500, 700
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.clip_start = 0.01
    tgt = bpy.data.objects.new("t", None)
    sc.collection.objects.link(tgt)
    tgt.location = (0, 0, 0.9)
    tr = cam.constraints.new("TRACK_TO"); tr.target = tgt
    tr.track_axis, tr.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    for name, loc in (("front", (0, -3.2, 1.0)), ("back", (0, 3.2, 1.0))):
        cam.location = loc
        sc.render.filepath = os.path.join(out_dir, f"player_{who}_{name}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    rest = [a for a in argv if not a.startswith("--") and a != preview]
    who = rest[0] if rest else "woman"
    src = os.path.expanduser(rest[1] if len(rest) > 1 else SOURCES[who])
    build(who, src, preview)
