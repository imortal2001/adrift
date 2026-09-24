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

* **One armature and its meshes**, nothing else — not the icosphere the
  importer draws bones with — **and a rest pose that is the pose shown**: the
  man's skeleton rests lying along the ground and is stood up by a turn on its
  root, so the pose is baked in and made the rest before anything is moved.
* **Facing -Z, feet at 0, in metres**, the way the game's player faces at
  yaw 0 (a source in centimetres is scaled down).
* **Bone names cleaned** of the numeric suffixes the Sketchfab export gave
  them ("LeftUpLeg_60" → "LeftUpLeg"), so body.js finds them by name.
* **Dressed for the Stone Age**, by repainting, not remodelling: the woman's
  striped dress already reads as hide, so only her shoes go to worn leather
  (OUTFITS, by material); the man is one mesh on one atlas, so his T-shirt,
  jeans and trainers are found by the bones that move them and repainted: the
  shirt in the woman's own striped animal skin, as a hide tunic, the jeans as
  dark hide leggings, the trainers as leather wraps (ATLAS).
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
    "man": "~/Downloads/ready_player_me_male_avatar__vrchatgame_ready",
}
TEX = 1024

# How each outfit material is repainted: a tint over the texture's own
# light and shade, so the folds and seams survive. (r, g, b) in 0..1, linear.
LEATHER = (0.23, 0.13, 0.07)
OUTFITS = {
    "woman": {"Wolf3D_Outfit_Footwear": ("tint", LEATHER)},
}
# The man is one mesh on one texture atlas — his clothes are not materials
# of their own — so his are repainted by region: each triangle is classed by
# the bone that moves it (feet → shoes, legs → leggings, torso and upper arms
# → tunic), that is drawn into the atlas, and only those pixels change —
# never skin-coloured ones, which are his arms and neck.
#
# His tunic is the woman's own animal skin — the striped hide of her dress,
# a clean patch of it from below her belt, tiled mirror-wise across his
# shirt at her scale — so the two are dressed alike; his shirt's folds and
# shading are kept on top of it. Both are Ready Player Me, CC BY-NC-SA, so
# taking from one for the other stays within the licence the output carries.
DRESS = "~/Downloads/ready_player_me_female_character/textures/Wolf3D_Outfit_Top_baseColor.jpeg"
ATLAS = {
    "man": {
        "tunic": ("pattern", {"from": DRESS, "rect": (0.10, 0.04, 0.65, 0.33), "scale": 0.5}),
        "leggings": ("tint", (0.22, 0.13, 0.07)),
        "shoes": ("tint", LEATHER),
    },
}
REGION_OF = [("Foot", "shoes"), ("Toe", "shoes"), ("UpLeg", "leggings"), ("Leg", "leggings"),
             ("Hips", "waist"), ("Spine", "tunic"), ("Shoulder", "tunic"), ("ForeArm", None),
             ("Arm", "tunic"), ("Hand", None), ("Neck", None), ("Head", None), ("Eye", None)]


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
    rest_as_posed(arm, meshes)
    # The glTF importer draws bones with an icosphere; it is not the model.
    for pb in arm.pose.bones:
        pb.custom_shape = None
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    return arm, meshes


def rest_as_posed(arm, meshes):
    """
    Make the pose the model is shown in its rest pose. In some exports (the
    man's) they differ: the skeleton's rest lies along the ground and a turn
    on the root bone stands it up, and turning or scaling the character then
    goes wrong between the two. Bake the pose into the meshes, make it the
    rest, and bind them to it again.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        mod = next((m for m in o.modifiers if m.type == "ARMATURE"), None)
        if mod is None:
            continue
        bpy.context.view_layer.objects.active = o
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in meshes:
        m = o.modifiers.new("Armature", "ARMATURE")
        m.object = arm


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
    # Some exports are in centimetres (the man's is): a person 186 "metres"
    # tall is 1.86 m.
    tall = mx.z - mn.z
    unit = 0.01 if tall > 10 else 1.0
    scale = mathutils.Matrix.Diagonal((unit, unit, unit, 1.0))
    arm.matrix_world = scale @ turn @ lift @ arm.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    print(f"  {tall * unit:.2f} m tall" + (" (source in centimetres)" if unit != 1 else ""))


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


_PATTERNS = {}


def pattern(spec, h, w):
    """A source texture's patch, tiled mirror-wise over an h x w image."""
    path = os.path.expanduser(spec["from"])
    if path not in _PATTERNS:
        img = bpy.data.images.load(path)
        _PATTERNS[path] = pixels(img)[..., :3].copy()
        bpy.data.images.remove(img)
    src = _PATTERNS[path]
    sh, sw = src.shape[:2]
    u0, v0, u1, v1 = spec["rect"]
    x0, x1, y0, y1 = int(u0 * sw), int(u1 * sw), int(v0 * sh), int(v1 * sh)
    pw, ph = x1 - x0, y1 - y0
    k = spec.get("scale", 1.0)
    def fold(t, n):                                   # mirror-repeat: no seams
        t = t % (2 * n)
        return np.where(t < n, t, 2 * n - 1 - t)
    ys = (np.arange(h) * k).astype(int)
    xs = (np.arange(w) * k).astype(int)
    return src[y0 + fold(ys, ph)][:, x0 + fold(xs, pw)]


def recolour(px, mask, how, colour):
    """Repaint the masked pixels in `colour`, keeping their light and shade."""
    lum = px[..., :3] @ np.array([0.3, 0.59, 0.11])
    shade = np.clip(lum / max(np.median(lum[mask]), 1e-3), 0.25, 1.8)[..., None]
    if how == "pattern":
        # The pattern's own colour, lit by this texture's folds and shading.
        out = pattern(colour, *lum.shape) * np.clip(shade, 0.5, 1.4)
        px[..., :3] = np.where(mask[..., None], np.clip(out, 0, 1), px[..., :3])
        return
    out = np.array(colour)[None, None, :] * shade
    if how == "hide":
        h, w = lum.shape
        yy, xx = np.mgrid[0:h, 0:w] / max(h, w)
        blot = (np.sin(xx * 23 + np.sin(yy * 17) * 2) * np.sin(yy * 19 + np.sin(xx * 13) * 2))
        out *= (0.85 + 0.2 * blot)[..., None]
    px[..., :3] = np.where(mask[..., None], np.clip(out, 0, 1), px[..., :3])


def repaint_atlas(arm, meshes, plan):
    """Repaint regions of a single-atlas character by the bones that move them."""
    for o in meshes:
        me = o.data
        node = next((n for m in me.materials for n in m.node_tree.nodes if n.type == "TEX_IMAGE"
                     and n.image and "normal" not in n.image.name.lower()), None)
        if node is None:
            continue
        px = pixels(node.image)
        H, W = px.shape[:2]
        names = {g.index: g.name for g in o.vertex_groups}
        # Each vertex's strongest bone, and so its region.
        region = []
        for v in me.vertices:
            best = max(v.groups, key=lambda g: g.weight, default=None)
            bone = names.get(best.group, "") if best else ""
            region.append(next((r for key, r in REGION_OF if key in bone), None))
        classes = {r: i + 1 for i, r in enumerate(["tunic", "leggings", "shoes", "waist"])}
        cmap = np.zeros((H, W), np.uint8)
        uv = me.uv_layers.active.data
        for poly in me.polygons:
            votes = [region[i] for i in poly.vertices]
            r = max(set(votes), key=votes.count)
            if r is None:
                continue
            pts = np.array([tuple(uv[li].uv) for li in poly.loop_indices]) * (W, H)
            x0, y0 = np.floor(pts.min(0)).astype(int); x1, y1 = np.ceil(pts.max(0)).astype(int)
            x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 2, W), min(y1 + 2, H)
            if x1 <= x0 or y1 <= y0:
                continue
            yy, xx = np.mgrid[y0:y1, x0:x1] + 0.5
            inside = np.ones(xx.shape, bool)
            for k in range(1, len(pts) - 1):            # fan the polygon into triangles
                a, b, c = pts[0], pts[k], pts[k + 1]
                d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
                if abs(d) < 1e-9:
                    continue
                l1 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / d
                l2 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / d
                tri = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
                inside = tri if k == 1 else (inside | tri)
            cmap[y0:y1, x0:x1][inside] = classes[r]
        # Never skin: warm, saturated pixels stay as they are.
        rgb = px[..., :3]
        mx, mn = rgb.max(-1), rgb.min(-1)
        skin = ((mx - mn) / np.maximum(mx, 1e-3) > 0.3) & (rgb[..., 0] > rgb[..., 2])
        lum = rgb @ np.array([0.3, 0.59, 0.11])
        # The waist is where tunic meets leggings: the pale part is tunic.
        waist = cmap == classes["waist"]
        cmap[waist & (lum > 0.08)] = classes["tunic"]
        cmap[waist & (lum <= 0.08)] = classes["leggings"]
        for name, (how, colour) in plan.items():
            mask = (cmap == classes[name]) & ~skin
            if mask.any():
                recolour(px, mask, how, colour)
                print(f"  {name}: repainted ({how}), {mask.mean() * 100:.1f}% of the atlas")
        node.image.pixels.foreach_set(px.ravel())
        node.image.update()


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
    if who in ATLAS:
        repaint_atlas(arm, meshes, ATLAS[who])
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
