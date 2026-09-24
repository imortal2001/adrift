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
* **Dressed as cave people are drawn** (see "the cave outfit" below): a
  leopard-spotted hide over the right shoulder, the left bare, a ragged,
  jagged hem at mid thigh, a leather belt, bare arms, legs and feet. The woman's
  dress is repainted and cut — her body is modelled beneath it, so the hem
  and the bare shoulder are alpha cut-outs — and she goes barefoot: her
  shoes, and the half-made feet inside them, are replaced by bare feet built
  here (barefoot()). So does the man: his trainers are cut from his mesh and
  he gets bare feet of his own size, in his skin tone. The man is
  one mesh on one atlas in a T-shirt and jeans, with no body under them: his
  clothes are found by the bones that move them, his top repainted, his jeans
  and sleeves reshaped into bare legs and arms — a leg's profile of thigh,
  knee, calf and ankle, in his own skin, the creases flattened out of the
  normal map — and a hide skirt added as a mesh of its own, bound to his hips
  and thighs.
* **Textures as WebP** (small, and it keeps the alpha a cut-out needs),
  colour at 1024² at most and normal maps at 512².
"""
import json
import os
import re
import sys

import bpy
import bmesh
import mathutils
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = {
    "woman": "~/Downloads/ready_player_me_female_character",
    "man": "~/Downloads/ready_player_me_male_avatar__vrchatgame_ready",
}
TEX = 1024

# How a plain material is repainted: a tint over the texture's own light and
# shade, so the folds and seams survive. (r, g, b) in 0..1, as stored.
LEATHER = (0.23, 0.13, 0.07)

# ── the cave outfit ──────────────────────────────────────────────────────────
# Both are dressed as cave people are drawn: a leopard-spotted hide worn over
# the right shoulder with the left one bare, a ragged, jagged hem at mid
# thigh, a leather belt, bare arms and legs, and hide wrapped round the feet.
# Everything is placed on the body in metres — the hem's height, the line of
# the bare shoulder, the spots — by giving every texel the 3D point of the
# model it colours, so the spots run on across UV seams and the hem is level
# all the way round.
HIDE = (0.86, 0.60, 0.21)           # ochre, as stored (sRGB)
SPOT = (0.34, 0.19, 0.07)           # dark brown
BELT = (0.30, 0.18, 0.09)           # leather
SPOT_CELL = 0.1                     # metres between spots
REGION_OF = [("Foot", "feet"), ("Toe", "feet"), ("UpLeg", "legs"), ("Leg", "legs"),
             ("Hips", "body"), ("Spine", "body"), ("Shoulder", "body"), ("ForeArm", "arms"),
             ("Arm", "arms"), ("Hand", None), ("Neck", None), ("Head", None), ("Eye", None)]
# Per character: the hem's height (the woman's dress ends at 0.73 m, so hers
# is cut from just above it) and whether the bare parts are cut away (her
# body is modelled under the dress) or painted as skin (his is not).
STYLE = {
    "woman": {"hem": 0.80, "cut": True, "clothes": ["Wolf3D_Outfit_Top"], "feet": [],
              "barefoot": {"length": 0.235, "breadth": 1.0, "ankle": 0.075}},
    # His shoes are part of his one mesh: they go by the bones that move them.
    "man": {"hem": 0.74, "cut": False, "clothes": ["Wolf3D_Avatar"], "feet": [], "skirt": True,
            "barefoot": {"length": 0.265, "breadth": 1.12, "ankle": 0.082, "by_bone": True}},
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


def tint(px, mask, colour):
    """Repaint the masked pixels in `colour`, keeping their light and shade."""
    lum = px[..., :3] @ np.array([0.3, 0.59, 0.11])
    shade = np.clip(lum / max(np.median(lum[mask]), 1e-3), 0.25, 1.8)[..., None]
    out = np.array(colour)[None, None, :] * shade
    px[..., :3] = np.where(mask[..., None], np.clip(out, 0, 1), px[..., :3])


def raster(o, W, H):
    """
    For each texel of the mesh's texture: the 3D point of the model it
    colours (rest pose, metres) and the region of the body its face moves
    with (see REGION_OF). Faces are drawn into UV space with barycentric
    weights; texels no face covers are left unfilled.
    """
    me = o.data
    names = {g.index: g.name for g in o.vertex_groups}
    V = np.array([tuple(o.matrix_world @ v.co) for v in me.vertices])
    region = []
    for v in me.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        bone = names.get(best.group, "") if best else ""
        region.append(next((r for key, r in REGION_OF if key in bone), None))
    kinds = [None, "body", "legs", "feet", "arms"]
    pos = np.zeros((H, W, 3), np.float32)
    cls = np.zeros((H, W), np.uint8)
    filled = np.zeros((H, W), bool)
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        votes = [region[i] for i in poly.vertices]
        r = kinds.index(max(set(votes), key=votes.count))
        pts = np.array([tuple(uv[li].uv) for li in poly.loop_indices]) * (W, H)
        P = V[list(poly.vertices)]
        x0, y0 = np.floor(pts.min(0)).astype(int); x1, y1 = np.ceil(pts.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 2, W), min(y1 + 2, H)
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1] + 0.5
        for k in range(1, len(pts) - 1):                  # fan into triangles
            a, b, c = pts[0], pts[k], pts[k + 1]
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / d
            l2 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / d
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.03) & (l2 >= -0.03) & (l3 >= -0.03)
            if not inside.any():
                continue
            p3 = (l1[..., None] * P[0] + l2[..., None] * P[k] + l3[..., None] * P[k + 1])
            sub = pos[y0:y1, x0:x1]; sub[inside] = p3[inside]
            subc = cls[y0:y1, x0:x1]; subc[inside] = r
            subf = filled[y0:y1, x0:x1]; subf[inside] = True
    return pos, cls, filled, kinds, V, region


def _hash(ix, iy, iz, k):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (k * 2654435761)
    return ((h & 0xFFFFFF) / float(0xFFFFFF))


def leopard(P):
    """
    Leopard hide at 3D points P (N x 3, metres): ochre, mottled, with dark
    irregular spots — the nearest of a jittered lattice of spot centres,
    each its own size, its edge wobbling round it.
    """
    c = P / SPOT_CELL
    base = np.floor(c).astype(np.int64)
    best = np.full(len(P), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cell = base + (dx, dy, dz)
                jit = np.stack([_hash(cell[:, 0], cell[:, 1], cell[:, 2], k) for k in range(4)], -1)
                centre = cell + 0.15 + 0.7 * jit[:, :3]
                size = 0.34 + 0.16 * jit[:, 3]
                off = c - centre
                d = np.linalg.norm(off, axis=1)
                wob = 1 + 0.22 * np.sin(np.arctan2(off[:, 1], off[:, 0]) * 3 + jit[:, 0] * 6)
                best = np.minimum(best, d / (size * wob))
    spot = np.clip((1.0 - best) * 6, 0, 1)[:, None]                 # soft edge
    mott = 0.92 + 0.08 * np.sin(P[:, 0] * 23 + np.sin(P[:, 2] * 17) * 2)[:, None] * np.sin(P[:, 1] * 19)[:, None]
    return np.array(HIDE) * mott * (1 - spot) + np.array(SPOT) * spot


TEETH, TOOTH = 9, 0.07              # round the hem, and how deep each

def tooth(ang):
    """0..1 round the body: a ragged saw, nine teeth, no two quite alike."""
    t = (ang / (2 * np.pi) * TEETH) % 1.0
    return np.abs(t - 0.5) * 2 * (0.8 + 0.2 * np.sin(ang * 5.0 + 0.7))


def hem_at(P, base):
    """The hem's height round the body: jagged, and a little uneven."""
    ang = np.arctan2(P[:, 1], P[:, 0])
    return base - TOOTH * tooth(ang) + 0.012 * np.sin(ang * 3.0 + 1.3)


def blur(img, r):
    """Box-blur a 2D array twice (about a gaussian of radius r)."""
    out = img.astype(np.float32)
    for _ in range(2):
        for ax in (0, 1):
            pad = [(r + 1, r) if a == ax else (0, 0) for a in (0, 1)]
            cs = np.cumsum(np.pad(out, pad, mode="edge"), axis=ax)
            n = out.shape[ax]
            out = (np.take(cs, range(2 * r + 1, 2 * r + 1 + n), axis=ax)
                   - np.take(cs, range(0, n), axis=ax)) / (2 * r + 1)
    return out


def bare_shoulder(P, H):
    """Above the line from the left armpit to over the right shoulder: bare."""
    x, z = P[:, 0], P[:, 2]
    t = np.clip((x + 0.17) / 0.31, 0, 1)
    line = H * (0.70 + 0.14 * t) + 0.012 * np.sin(x * 60)
    return (z > line) & (x < 0.14)


def restyle(who, arm, meshes):
    st = STYLE[who]
    H = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
    hips = next(b for b in arm.data.bones if b.name == "Hips")
    belt_z = (arm.matrix_world @ hips.head_local).z + 0.07
    for o in meshes:
        mat = o.data.materials[0]
        node = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                     and "normal" not in n.image.name.lower()
                     and "metallic" not in n.image.name.lower()), None)
        if node is None:
            continue
        if mat.name in st["feet"]:
            px = pixels(node.image)
            tint(px, px[..., :3].sum(-1) > 0.01, LEATHER)
            node.image.pixels.foreach_set(px.ravel()); node.image.update()
            print(f"  {mat.name}: leather foot wraps")
            continue
        if mat.name not in st["clothes"]:
            continue
        px = pixels(node.image)
        Hh, Ww = px.shape[:2]
        pos, cls, filled, kinds, V, region = raster(o, Ww, Hh)
        rgb = px[..., :3]
        mx, mn = rgb.max(-1), rgb.min(-1)
        skin_px = ((mx - mn) / np.maximum(mx, 1e-3) > 0.3) & (rgb[..., 0] > rgb[..., 2]) & (rgb[..., 0] > 0.15)
        body, legs, feet, arms_ = (cls == kinds.index(k) for k in ("body", "legs", "feet", "arms"))
        # What is clothing, of all this texture: on the man, not his skin, head
        # or hands; on the woman, all of her dress.
        cloth = filled & (body | legs | feet | arms_) & (~skin_px if not st["cut"] else True)
        P = pos.reshape(-1, 3)
        hide = cloth & ~feet & ~arms_
        bare = bare_shoulder(P, H).reshape(Hh, Ww)
        if st.get("skirt"):
            # The skirt (a mesh of its own, see skirt()) hangs from the belt;
            # what it covers is painted the same hide, so wherever the body
            # shows through it — a hip, as the leg swings — it is not skin.
            # On the legs it stops above the skirt's notches, so it can never
            # show below the hem as shorts.
            hide &= ~bare & ((~legs & (pos[..., 2] > belt_z - 0.12)) | (legs & (pos[..., 2] > st["hem"] + 0.02)))
        else:
            hide &= (pos[..., 2] > hem_at(P, st["hem"]).reshape(Hh, Ww)) & ~bare
        belt = hide & (np.abs(pos[..., 2] - belt_z) < 0.022)
        # Light and shade from the old texture, blurred: its broad folds, not
        # its pattern — the woman's dress was striped, and those stripes must
        # not show through the spots as dark bands.
        lum = blur(rgb @ np.array([0.3, 0.59, 0.11]), max(4, Ww // 96))
        shade = np.clip(lum / max(np.median(lum[hide]), 1e-3), 0.7, 1.25)[..., None]
        coat = leopard(pos[hide])
        px[..., :3][hide] = np.clip(coat * shade[hide], 0, 1)
        px[..., :3][belt] = np.clip(np.array(BELT) * shade[belt] * 0.9, 0, 1)
        # A darker line along the hem and the bare shoulder's edge: the cut
        # edge of a hide, which is what makes it read as one.
        edge = hide & ((pos[..., 2] - hem_at(P, st["hem"]).reshape(Hh, Ww)) < 0.012)
        px[..., :3][edge] *= 0.7
        rest = cloth & ~hide
        if st["cut"]:
            # Cut away: her body is modelled beneath. The texture takes an
            # alpha channel, and the material clips on it.
            px[..., 3] = np.where(rest, 0.0, 1.0)
            clip(mat, node)
            print(f"  {mat.name}: leopard hide, jagged hem and bare shoulder cut out")
        else:
            # Painted: his own skin over what were clothes — the jeans, the
            # sleeves, the bare shoulder — flat, in the colour of his arms and
            # ankles, not lit by the cloth's creases; the creases taken out of
            # the normal map too; and the jeans and sleeves reshaped as legs
            # and arms (limbs()).
            own = rgb[skin_px & filled & (arms_ | legs)]
            tone = np.median(own, axis=0) if len(own) else np.array([0.45, 0.25, 0.15])
            st["tone"] = tone                            # for his bare feet
            skin = rest & ~feet
            px[..., :3][skin] = np.clip(tone * (0.97 + 0.06 * blur(np.random.default_rng(3).random((Hh, Ww)), 6)[skin][:, None]), 0, 1)
            smooth_normals(mat, skin)
            tint(px, cloth & feet, LEATHER)
            limbs(o, arm, V, region, belt_z)
            print(f"  {mat.name}: leopard hide, jagged hem, bare arms and legs painted, leather feet")
        node.image.pixels.foreach_set(px.ravel())
        node.image.update()
    if st.get("skirt"):
        skirt(arm, meshes, belt_z, st["hem"])


def skirt(arm, meshes, top, hem):
    """
    A hide skirt from the belt to mid thigh, its hem cut ragged: the tunic's
    lower half, for a character whose clothes below the waist are trousers.
    Fitted round the body at each height, textured with the same leopard
    hide, and bound to the hips and — toward the hem — the thigh on its side,
    so it swings with the stride.
    """
    V = np.array([tuple(o.matrix_world @ v.co) for o in meshes for v in o.data.vertices])
    def girth(z, band=0.04, pad=0.03):
        near = V[np.abs(V[:, 2] - z) < band]
        near = near[np.abs(near[:, 0]) < 0.3]
        return np.abs(near[:, 0]).max() + pad, np.abs(near[:, 1]).max() + pad, near[:, 1].mean()
    N, rings = 44, [top, (top + hem) / 2, hem]
    fits = [girth(top, pad=0.03), girth(rings[1], pad=0.065), girth(hem, pad=0.07)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    verts = []
    for ri, z in enumerate(rings):
        rx, ry, cy = fits[ri]
        row = []
        for i in range(N + 1):
            ang = i / N * 2 * np.pi
            x, y = np.cos(ang) * rx, cy + np.sin(ang) * ry
            zz = z - (TOOTH * float(tooth(np.array([np.arctan2(y, x)]))[0]) if ri == 2 else 0)
            row.append(bm.verts.new((x, y, zz)))
        verts.append(row)
    for ri in range(len(rings) - 1):
        for i in range(N):
            f = bm.faces.new((verts[ri][i], verts[ri][i + 1], verts[ri + 1][i + 1], verts[ri + 1][i]))
            for loop, (u, v) in zip(f.loops, ((i / N, ri / 2), ((i + 1) / N, ri / 2), ((i + 1) / N, (ri + 1) / 2), (i / N, (ri + 1) / 2))):
                loop[uvl].uv = (u, v)
    me = bpy.data.meshes.new("player_skirt")
    bm.to_mesh(me); bm.free()
    me.shade_smooth() if hasattr(me, "shade_smooth") else None
    ob = bpy.data.objects.new("player_skirt", me)
    bpy.context.scene.collection.objects.link(ob)
    # Its texture: the leopard hide, texel by texel at the point it covers.
    S = 512
    img = bpy.data.images.new("player_skirt_hide", S, S // 2, alpha=False)
    uu, vv = np.meshgrid((np.arange(S) + 0.5) / S, (np.arange(S // 2) + 0.5) / (S // 2))
    ang = uu * 2 * np.pi
    zc = np.interp(vv, [0, 0.5, 1], rings)
    rx = np.interp(vv, [0, 0.5, 1], [f[0] for f in fits]); ry = np.interp(vv, [0, 0.5, 1], [f[1] for f in fits])
    cyv = np.interp(vv, [0, 0.5, 1], [f[2] for f in fits])
    P = np.stack([np.cos(ang) * rx, cyv + np.sin(ang) * ry, zc], -1).reshape(-1, 3)
    col = leopard(P).reshape(S // 2, S, 3)
    col *= (1 - 0.3 * np.clip((vv - 0.85) / 0.15, 0, 1))[..., None]      # darker at the cut edge
    img.pixels.foreach_set(np.concatenate([col, np.ones((S // 2, S, 1))], -1).astype(np.float32).ravel())
    img.file_format = "JPEG"
    img.pack()
    mat = bpy.data.materials.new("player_skirt")
    mat.use_nodes = True
    mat.use_backface_culling = False                 # seen from inside, too
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = img
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    me.materials.append(mat)
    # Bound to the hips, and toward the hem to the thigh on its side.
    hips = ob.vertex_groups.new(name="Hips")
    legL = ob.vertex_groups.new(name="LeftUpLeg"); legR = ob.vertex_groups.new(name="RightUpLeg")
    for v in me.vertices:
        k = np.clip((top - v.co.z) / max(top - hem, 1e-3), 0, 1) * 0.6
        side = np.clip(0.5 + v.co.x / 0.2, 0, 1)          # 0 left .. 1 right
        hips.add([v.index], 1 - k, "REPLACE")
        if k > 0:
            legR.add([v.index], k * side, "REPLACE")
            legL.add([v.index], k * (1 - side), "REPLACE")
    ob.parent = arm
    m = ob.modifiers.new("Armature", "ARMATURE"); m.object = arm
    meshes.append(ob)
    print(f"  skirt: {len(me.polygons)} faces, belt {top:.2f} m to hem {hem:.2f} m")


# A bare foot, heel (0) to toe tip (1): width and height in metres, for a
# woman's foot about 23.5 cm long; the sole is flat on the ground. A larger
# foot scales it (STYLE's barefoot: length, breadth, ankle height).
# From the heel up over the ankle the foot is as tall as the ankle and as
# wide as the leg there, so the leg — cut just above the ankle bone — stands
# down inside it and the two meet without a step.
# Both ends close down almost to a point: a wide flat cap there shades as a
# dark patch on the toes.
FOOT = [(-0.03, 0.020, 0.030), (0.00, 0.054, 0.075), (0.07, 0.064, 0.100), (0.14, 0.068, 0.104),
        (0.26, 0.068, 0.098), (0.40, 0.074, 0.072), (0.58, 0.086, 0.052), (0.72, 0.094, 0.042),
        (0.84, 0.092, 0.034), (0.93, 0.082, 0.026), (0.985, 0.052, 0.018), (1.00, 0.012, 0.007)]
def barefoot(arm, meshes, spec, tone=None):
    """
    Take the shoes off. The shoes go, and so does the body below the ankle:
    neither character has feet modelled inside them — the woman only their
    tops, set on tiptoe for a heel; the man nothing at all. In their place
    each leg gets a bare foot built here: flat sole, heel, arch, the ball of
    the foot and five toes, the leg standing down into it at the ankle, in the
    character's own skin, bound to the foot and toe bones. Shoes had raised
    them; the whole character comes down to stand on the new soles — after
    being dressed, since the outfit's heights (the hem) are measured on them
    as they stood in shoes.

    spec: length (m), breadth (x the woman's), ankle (height off the ground),
          by_bone (the shoes are part of the body mesh, found by their bones)
    """
    L, breadth = spec["length"], spec["breadth"]
    shoes = [o for o in meshes if o.data.materials and o.data.materials[0].name == "Wolf3D_Outfit_Footwear"]
    for o in shoes:
        meshes.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
    body = next(o for o in meshes if o.data.materials[0].name in ("Wolf3D_Body", "Wolf3D_Avatar"))
    bone = lambda n: (np.array(arm.matrix_world @ arm.data.bones[n].head_local),
                      np.array(arm.matrix_world @ arm.data.bones[n].tail_local))
    ankle_z = bone("LeftFoot")[0][2]
    cut = ankle_z + 0.012
    # The body below the cut, gone.
    bm = bmesh.new(); bm.from_mesh(body.data)
    mw = body.matrix_world
    groups = {g.index: g.name for g in body.vertex_groups}
    deform = bm.verts.layers.deform.active
    def shoe(v):
        if (mw @ v.co).z < cut:
            return True
        if spec.get("by_bone") and deform is not None:
            return any(w > 0.3 and ("Foot" in groups[g] or "Toe" in groups[g]) for g, w in v[deform].items())
        return False
    doomed = [v for v in bm.verts if shoe(v)]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(body.data); bm.free()
    V = np.array([tuple(mw @ v.co) for v in body.data.vertices])
    sole = ankle_z - spec["ankle"]
    if tone is not None:
        colour = np.array(tone)
    else:
        skin = next((n.image for n in body.data.materials[0].node_tree.nodes
                     if n.type == "TEX_IMAGE" and n.image and "normal" not in n.image.name.lower()), None)
        colour = np.array(skin.pixels[:]).reshape(-1, 4)[:, :3].mean(0) if skin else np.array([0.65, 0.31, 0.2])
    mat = bpy.data.materials.new("player_bare_feet")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    # The body's colour texture is stored sRGB; a material colour is linear.
    lin = np.where(colour <= 0.04045, colour / 12.92, ((colour + 0.055) / 1.055) ** 2.4)
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.7
    for side, sx in (("Left", -1), ("Right", 1)):
        a_head, a_tail = bone(f"{side}Foot")
        # Where the leg stands: the shin bone's line, at the cut.
        l_head, l_tail = bone(f"{side}Leg")
        k = (cut - l_head[2]) / (l_tail[2] - l_head[2])
        centre = (l_head + (l_tail - l_head) * k)[:2]
        fwd = np.array([a_tail[0] - a_head[0], a_tail[1] - a_head[1], 0.0])
        fwd /= np.linalg.norm(fwd)
        toe_out = np.radians(7) * sx                     # a little splayed, as feet stand
        c, s_ = np.cos(toe_out), np.sin(toe_out)
        fwd = np.array([fwd[0] * c - fwd[1] * s_, fwd[0] * s_ + fwd[1] * c, 0.0])
        right = np.array([fwd[1], -fwd[0], 0.0])
        heel = np.array([centre[0], centre[1], sole]) - fwd * (0.24 * L)
        bm = bmesh.new()
        M = 30
        rows = []
        tall = spec["ankle"] / 0.075                    # the foot scales with the ankle's height
        for t, w, h in FOOT:
            w, h = w * breadth, h * tall
            row = []
            for k in range(M):
                ang = k / M * 2 * np.pi
                sa, ca = np.sin(ang), np.cos(ang)
                zz = sole + h / 2 * (1 + sa) if sa >= 0 else sole + h / 2 * (1 + sa) ** 1.8
                ww = w / 2 * ca * (1.06 if sa < 0 else 1.0)
                p = heel + fwd * (t * L) + right * ww
                p[2] = zz
                # The big toe side is the higher: a foot is not symmetrical.
                if t > 0.7:
                    p[2] += 0.006 * (1 - ca * sx) * (sa > 0)
                # Five toes: shallow grooves between them along the top of the
                # front of the foot.
                if t > 0.8 and sa > 0:
                    p[2] -= 0.0045 * (0.5 - 0.5 * np.cos(ca * np.pi * 4.6)) * sa
                row.append(bm.verts.new(tuple(p)))
            rows.append(row)
        for r in range(len(rows) - 1):
            for k in range(M):
                bm.faces.new((rows[r][k], rows[r][(k + 1) % M], rows[r + 1][(k + 1) % M], rows[r + 1][k]))
        bm.faces.new(rows[0][::-1]); bm.faces.new(rows[-1])
        # Every face turned outward — the end caps included, which the loop
        # order alone leaves facing in on one foot or the other.
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f"player_foot_{side.lower()}")
        bm.to_mesh(me); bm.free()
        me.shade_smooth() if hasattr(me, "shade_smooth") else None
        me.materials.append(mat)
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        g_foot = ob.vertex_groups.new(name=f"{side}Foot")
        g_toe = ob.vertex_groups.new(name=f"{side}ToeBase")
        g_leg = ob.vertex_groups.new(name=f"{side}Leg")
        for v in me.vertices:
            along = np.dot(np.array(v.co) - heel, fwd) / L
            toe = np.clip((along - 0.7) / 0.15, 0, 1)
            up = np.clip((v.co.z - (sole + 0.07 * tall)) / 0.03, 0, 1) * (along < 0.4)
            g_foot.add([v.index], (1 - toe) * (1 - up), "REPLACE")
            if toe > 0: g_toe.add([v.index], toe * (1 - up), "REPLACE")
            if up > 0: g_leg.add([v.index], up, "REPLACE")
        ob.parent = arm
        mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = arm
        meshes.append(ob)
    # Down onto the new soles.
    bpy.context.view_layer.update()
    arm.matrix_world = mathutils.Matrix.Translation((0, 0, -sole)) @ arm.matrix_world
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    print(f"  barefoot: shoes off, feet built, {sole * 100:.1f} cm lower")


def clip(mat, node):
    """Make a material alpha-clipped on its colour texture (glTF: alphaMode MASK)."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"
    nt.links.new(node.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    node.image.alpha_mode = "STRAIGHT"
    node.image["cutout"] = True


def smooth_normals(mat, mask):
    """Flatten a material's normal map where `mask` is: bare skin has no creases."""
    node = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                 and "normal" in n.image.name.lower()), None)
    if node is None:
        return
    px = pixels(node.image)
    h, w = px.shape[:2]
    mh, mw = mask.shape
    m = mask[(np.arange(h) * mh // h)[:, None], (np.arange(w) * mw // w)[None, :]]
    px[..., :3][m] = (0.5, 0.5, 1.0)
    node.image.pixels.foreach_set(px.ravel())
    node.image.update()


# Radius of a bare leg along it, hip (0) to ankle (1), in metres for a man of
# about 1.85 m: full at the top of the thigh, in above the knee, the knee, the
# calf swelling a third of the way down the shin, slim at the ankle.
LEG = [(0.0, 0.086), (0.25, 0.074), (0.45, 0.058), (0.52, 0.052), (0.66, 0.057),
       (0.85, 0.043), (1.0, 0.036)]
ARM = [(0.0, 0.052), (0.5, 0.046), (1.0, 0.040)]           # shoulder to elbow


def limbs(o, arm, V, region, top):
    """
    Reshape clothes into the limbs they covered. Each leg vertex is put at
    the leg's own radius from the bone at that point along it — the calf
    fuller behind, the knee a little proud in front — and a sleeve is drawn
    in to the upper arm (never pushed out: the arm below it is his own).
    """
    bones = {b.name: (np.array(arm.matrix_world @ b.head_local), np.array(arm.matrix_world @ b.tail_local))
             for b in arm.data.bones}
    def chain(names):
        segs = [bones[n] for n in names if n in bones]
        lens = [np.linalg.norm(b - a) for a, b in segs]
        return segs, lens, sum(lens)
    legs = {s: chain((f"{s}UpLeg", f"{s}Leg")) for s in ("Left", "Right")}
    arms = {s: chain((f"{s}Arm",)) for s in ("Left", "Right")}
    fwd = np.array([0.0, 1.0, 0.0])                      # he faces +Y here
    me = o.data
    moved = 0
    for i, v in enumerate(me.vertices):
        w = V[i]
        kind = region[i]
        if kind == "legs" and w[2] < top - 0.02:
            side = "Right" if w[0] > 0 else "Left"
            segs, lens, total = legs[side]
            prof = LEG
        elif kind == "arms":
            side = "Right" if w[0] > 0 else "Left"
            segs, lens, total = arms[side]
            prof = ARM
        else:
            continue
        # Nearest point on the chain, and how far along it that is.
        best = None
        run = 0.0
        for (a, b), L in zip(segs, lens):
            ab = b - a
            t = np.clip(np.dot(w - a, ab) / max(L * L, 1e-9), 0, 1)
            q = a + ab * t
            d = np.linalg.norm(w - q)
            if best is None or d < best[0]:
                best = (d, q, (run + t * L) / total, ab / max(L, 1e-9))
            run += L
        d, q, t, axis = best
        if kind == "arms" and t > 0.98:
            continue                                     # the elbow and below are his own
        radial = w - q
        radial -= axis * np.dot(radial, axis)
        rn = np.linalg.norm(radial)
        if rn < 1e-5:
            continue
        dirn = radial / rn
        r = np.interp(t, [p for p, _ in prof], [x for _, x in prof])
        if kind == "legs":
            back = -np.dot(dirn, fwd)
            r *= 1 + 0.14 * max(0.0, back) * np.exp(-((t - 0.66) / 0.12) ** 2)     # the calf
            r *= 1 + 0.06 * max(0.0, -back) * np.exp(-((t - 0.52) / 0.05) ** 2)   # the knee
            r *= 0.94 + 0.06 * abs(np.dot(dirn, np.array([1.0, 0, 0])))            # a leg is not round
        else:
            r = min(r, rn)
        new = q + dirn * r
        v.co = o.matrix_world.inverted() @ mathutils.Vector(new)
        moved += 1
    me.update()
    print(f"  reshaped {moved} vertices of jeans and sleeves into legs and arms")


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
                    keep_alpha = n.image.get("cutout") or "metallic" in n.image.name.lower()
                    n.image.file_format = "PNG" if keep_alpha else "JPEG"
                    n.image.pack()


def build(who, src, preview=None):
    out = os.path.join(ROOT, "assets", "models", f"player_{who}.glb")
    arm, meshes = load(src)
    orient(arm, meshes)
    clean_names(arm)
    restyle(who, arm, meshes)
    if STYLE[who].get("barefoot"):
        barefoot(arm, meshes, STYLE[who]["barefoot"], STYLE[who].get("tone"))
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
                   export_image_format="WEBP", export_jpeg_quality=85, export_image_quality=85,
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
