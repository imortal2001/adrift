"""
Bring a third-party coconut into the game.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_coconut.py -- [SOURCE_DIR] [--preview OUT_DIR]

SOURCE_DIR defaults to ~/Downloads/coconut, and holds the unzipped Sketchfab
download: "Coconut" by VaultPhil, CC BY 4.0 — credited in CREDITS.md. The
source is not in the repository; this writes assets/models/coconut.glb and
adds it to the model manifest.

The source is a photoscanned husked-off coconut — the brown fibre still on
the shell, the three germination pores at one end — at 199,500 triangles with
4096² colour and normal maps: 23 MB, for something you hold in one hand and
see a handful of bobbing in the current. What this does to it:

* **A new, clean shell, baked from the scan.** Decimating a scan does not
  work: its surface is a tangle of fibre and tiny UV islands, and collapsing
  it leaves creases and loose flaps. Instead a quad sphere of about TRIS
  triangles is fitted to the scan (each vertex moved in along its ray from
  the centre to the surface, then smoothed), unwrapped, and the scan's colour
  and its full relief (geometry and normal map together) are baked onto it
  with Cycles, at TEX². The fibre and the pores are all in the bake.
* **In the game's frame.** Stood with the pore end up (+Y) — the pores found
  from the scan's texture, as the darkest patch of the shell — the way the
  procedural nut in src/viewmodel.js stands. Centred and scaled to LENGTH.
* **Textures at 1024², as JPEG**, from 10 MB of 4096² JPEG and PNG. The scan's
  normal map is used as shipped. Whether it is DirectX or OpenGL cannot be
  measured on this one — it is fibre noise, which has no curl either way and
  looks the same flipped — so it is taken in the convention Sketchfab exports
  glTF in; the baked map is three.js's own (OpenGL, tangent space).
"""
import json
import os
import sys

import bmesh
import bpy
import mathutils
import mathutils.bvhtree
import mathutils.kdtree
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "coconut.glb")
NAME = "coconut"
LENGTH = 0.18                         # metres, pores to base: a big nut, hand-sized
TRIS = 3000
TEX = 1024


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, "scene.gltf"))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:                  # bake each one's place in the hierarchy
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mathutils.Matrix.Identity(4)
        o.data.transform(mw)
    for o in list(bpy.context.scene.objects):
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active

    # Weld the seams the split left, and keep only the nut: the scan carries
    # a few hundred loose wisps of fibre, and a shell fitted to those grows
    # spikes. Its custom normals go too — the bake reads the surface.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    seen, parts = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        part, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for n in e.link_faces:
                    if n.index not in seen:
                        seen.add(n.index)
                        stack.append(n)
        parts.append(part)
    parts.sort(key=len, reverse=True)
    loose = [f for part in parts[1:] for f in part]
    bmesh.ops.delete(bm, geom=loose, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    print(f"  scan: {len(parts[0]):,} faces kept, {len(parts) - 1} loose wisps ({len(loose)} faces) dropped")
    bm.to_mesh(obj.data)
    bm.free()
    with bpy.context.temp_override(object=obj, active_object=obj, selected_editable_objects=[obj]):
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except RuntimeError:
            pass
    return obj


def pore_direction(me, V, c):
    """
    Which way the pores face, from the centre. They are the three dark round
    spots in the scan's texture — found there, as the darkest blobs of a
    blurred copy, because on the mesh a fibrous shell is dark in a thousand
    places — and then found on the nut, through the UVs. The three that sit
    closest together on the nut are the pores.
    """
    img = next(n.image for n in me.materials[0].node_tree.nodes
               if n.type == "TEX_IMAGE" and n.image and "normal" not in n.image.name.lower())
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3] @ (0.3, 0.59, 0.11)
    k = max(1, w // 512)
    lum = px[:h // k * k, :w // k * k].reshape(h // k, k, w // k, k).mean(axis=(1, 3))
    H, W = lum.shape
    r = max(2, W // 90)                            # a pore is ~1% of the atlas across
    blur = lum.copy()
    for axis in (0, 1):                            # box blur, twice ~ gaussian
        for _ in range(2):
            cs = np.cumsum(np.pad(blur, [(r + 1, r) if a == axis else (0, 0) for a in (0, 1)], mode="edge"), axis=axis)
            blur = (np.take(cs, range(2 * r + 1, cs.shape[axis]), axis=axis)
                    - np.take(cs, range(0, cs.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    # Only texels the mesh uses count: the atlas has empty gaps between islands.
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    vi = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", vi)
    used = np.zeros((H, W), bool)
    used[np.clip((uv[:, 1] * H).astype(int), 0, H - 1), np.clip((uv[:, 0] * W).astype(int), 0, W - 1)] = True
    blur[~used] = np.inf
    kd = mathutils.kdtree.KDTree(len(uv))
    for i, (u, v) in enumerate(uv):
        kd.insert((u, v, 0), i)
    kd.balance()
    spots = []
    for _ in range(8):
        y, x = np.unravel_index(np.argmin(blur), blur.shape)
        _, loop, _ = kd.find(((x + 0.5) / W, (y + 0.5) / H, 0))
        spots.append((blur[y, x], V[vi[loop]]))
        blur[max(0, y - 4 * r):y + 4 * r, max(0, x - 4 * r):x + 4 * r] = np.inf
    # The tightest three of the darkest eight, on the nut.
    best, pick = np.inf, None
    for i in range(len(spots)):
        for j in range(i + 1, len(spots)):
            for m in range(j + 1, len(spots)):
                P = np.array([spots[i][1], spots[j][1], spots[m][1]])
                d = max(np.linalg.norm(P[0] - P[1]), np.linalg.norm(P[1] - P[2]), np.linalg.norm(P[0] - P[2]))
                if d < best:
                    best, pick = d, P
    size = max(V.max(0) - V.min(0))
    print(f"  pores: three dark spots {best / size * LENGTH * 1000:.0f} mm apart at most")
    up = pick.mean(0) - c
    return up / np.linalg.norm(up)


def pores_up(obj):
    """Stand the scan pore end up (+Z in Blender, +Y in glTF), centred, at LENGTH."""
    me = obj.data
    V = np.array([tuple(v.co) for v in me.vertices])
    c = (V.min(0) + V.max(0)) / 2
    up = pore_direction(me, V, c)
    rot = mathutils.Vector(up).rotation_difference(mathutils.Vector((0, 0, 1))).to_matrix().to_4x4()
    me.transform(rot @ mathutils.Matrix.Translation(-mathutils.Vector(c)))
    V = np.array([tuple(v.co) for v in me.vertices])
    mn, mx = V.min(0), V.max(0)
    s = LENGTH / (mx[2] - mn[2])
    me.transform(mathutils.Matrix.Diagonal((s, s, s, 1.0)) @ mathutils.Matrix.Translation(-mathutils.Vector((mn + mx) / 2)))
    me.update()
    V = np.array([tuple(v.co) for v in me.vertices])
    size = V.max(0) - V.min(0)
    print(f"  {size[0] * 100:.1f} x {size[1] * 100:.1f} cm across, {size[2] * 100:.1f} cm pores to base")
    return size


def shell(scan, size):
    """A quad sphere fitted to the scan: the game mesh."""
    # A cube subdivided and cast to a sphere has no poles — a UV sphere would
    # pinch its triangles together right on the pores.
    cuts = max(2, round((TRIS / 12) ** 0.5) - 1)
    bpy.ops.mesh.primitive_cube_add(size=1)
    low = bpy.context.view_layer.objects.active
    low.name = NAME
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=cuts, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    # Each vertex goes where a ray from outside, straight in at the middle,
    # first meets the nut: a nut is round enough that every point of it can be
    # seen from its centre, and unlike snapping to the nearest point this
    # never folds the shell over itself. Then the radii are smoothed, so the
    # fibre stays in the bake and out of the silhouette.
    tree = mathutils.bvhtree.BVHTree.FromObject(scan, bpy.context.evaluated_depsgraph_get())
    far = max(size) * 2
    dirs = [v.co.normalized() for v in bm.verts]
    radius = []
    for d in dirs:
        hit, *_ = tree.ray_cast(d * far, -d, far)
        radius.append((hit.length if hit else max(size) / 2))
    radius = np.array(radius)
    nbrs = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    for _ in range(4):
        radius = 0.5 * radius + 0.5 * np.array([radius[n].mean() for n in nbrs])
    for v, d, rr in zip(bm.verts, dirs, radius):
        v.co = d * rr
    bm.to_mesh(low.data)
    bm.free()
    for p in low.data.polygons:
        p.use_smooth = True

    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=np.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"  shell: {len(low.data.polygons):,} triangles")
    return low


def bake(scan, low):
    """The scan's colour and relief onto the shell, with Cycles."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 16
    sc.render.bake.use_selected_to_active = True
    # Rays start this far outside the shell and look this far in: the
    # smoothing leaves the shell a few millimetres off the fibre either way.
    sc.render.bake.cage_extrusion = LENGTH * 0.08
    sc.render.bake.max_ray_distance = LENGTH * 0.2
    sc.render.bake.margin = 8

    mat = bpy.data.materials.new(f"{NAME}_shell")
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.85     # dry fibre, not a polished shell
    bsdf.inputs["Metallic"].default_value = 0.0
    low.data.materials.clear()
    low.data.materials.append(mat)

    out = {}
    for kind, bake_type in (("albedo", "DIFFUSE"), ("normal", "NORMAL")):
        img = bpy.data.images.new(f"{NAME}_{kind}", TEX, TEX, alpha=False)
        if kind == "normal":
            img.colorspace_settings.name = "Non-Color"
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        nodes.active = node                 # bake writes into the active image node
        bpy.ops.object.select_all(action="DESELECT")
        scan.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        if bake_type == "DIFFUSE":
            sc.render.bake.use_pass_direct = False
            sc.render.bake.use_pass_indirect = False
            sc.render.bake.use_pass_color = True
        bpy.ops.object.bake(type=bake_type, normal_space="TANGENT")
        img.file_format = "JPEG"
        img.pack()
        out[kind] = node
        print(f"  baked {kind}")

    nodes.active = out["albedo"]            # what a textured viewport shows
    links.new(out["albedo"].outputs["Color"], bsdf.inputs["Base Color"])
    nm = nodes.new("ShaderNodeNormalMap")
    links.new(out["normal"].outputs["Color"], nm.inputs["Color"])
    links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])


def build(src, preview=None):
    scan = load(src)
    size = pores_up(scan)
    low = shell(scan, size)
    bake(scan, low)
    bpy.data.objects.remove(scan, do_unlink=True)
    obj = low
    obj.name = obj.data.name = NAME

    if preview:
        render(obj, preview)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    desired = dict(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                   export_yup=True, export_animations=False, export_skins=False,
                   export_image_format="JPEG", export_jpeg_quality=88,
                   export_cameras=False, export_lights=False, export_extras=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in desired.items() if k == "filepath" or k in known})
    print(f"\n→ {os.path.relpath(OUT, ROOT)}  ({os.path.getsize(OUT) / 1024:,.1f} KB)")

    man = os.path.join(ROOT, "assets", "models", "manifest.json")
    data = json.load(open(man))
    if NAME not in data["models"]:
        data["models"].append(NAME)
        json.dump(data, open(man, "w"), indent=2)
        open(man, "a").write("\n")


def render(obj, out_dir):
    """Side, top and quarter views, textured, to check it by eye."""
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.display.shading.show_specular_highlight = False
    sc.render.resolution_x, sc.render.resolution_y = 600, 600
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = bpy.data.objects.new("t", None)
    sc.collection.objects.link(tgt)
    tr = cam.constraints.new("TRACK_TO"); tr.target = tgt
    tr.track_axis, tr.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    L = LENGTH
    for name, off in (("side", (L * 2.6, 0, 0.001)), ("top", (0.001, 0.001, L * 2.6)),
                      ("quarter", (L * 1.6, -L * 1.6, L * 1.3))):
        cam.location = mathutils.Vector(off)
        sc.render.filepath = os.path.join(out_dir, f"{NAME}_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(tgt, do_unlink=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    rest = [a for a in argv if not a.startswith("--") and a != preview]
    src = os.path.expanduser(rest[0]) if rest else os.path.expanduser("~/Downloads/coconut")
    build(src, preview)
