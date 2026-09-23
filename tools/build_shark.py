"""
Bring a third-party blacktip reef shark into the game.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_shark.py -- [SOURCE_DIR] [--preview OUT_DIR]

SOURCE_DIR defaults to ~/Downloads/blacktip_reef_shark, and holds the unzipped
Sketchfab download: "Blacktip Reef Shark" by Lais.Marques, CC BY 4.0 —
credited in CREDITS.md. The source is not in the repository; this writes
assets/models/shark_blacktip.glb and adds it to the model manifest.

The source is the real species — slim, a short rounded snout, the black tips,
the pale flank band, a proper eyeball with a slit pupil — as six skinned
meshes with a colour texture each. What this does to it:

* **Static, in the game's frame.** Taken at its rest pose, without the
  armature: the game swims every fish with one vertex shader (src/swim.js),
  and this one joins them. Turned so the nose is -Y and the back +Z, as
  tools/build_fish.py builds everything else — found from the animal (eyes
  forward, tail behind, dorsal fin up), not assumed from the file.
* **One mesh, one material.** The game draws each species as one instanced
  mesh, so the six parts are joined and their six textures packed into one
  2048² atlas, the UVs moved to match.
* **Parts for the swim shader,** from which mesh each vertex came: pectorals
  row, the dorsal ripples, the tail lags, the pelvic fins row and the anal and
  second dorsal ripple (the source keeps those four in one mesh; they are
  told apart by how far off the midline they sit), and the eyes are glossy.
  `flex` runs from each fin's root to its tip.
* **A normal map.** The source has none. One is made from the colour
  texture's own detail plus a fine denticle grain, so the skin catches the
  light instead of reading as smooth — the same standard as the fish from
  tools/fish_textures.py.
"""
import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fish_textures as FT                                   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "shark_blacktip.glb")
SIZE = 2048
BODY, MEDIAN, CAUDAL, PAIRED, EYE = 0, 1, 2, 3, 4

# Material -> (part, atlas rect (u0, v0, w, h)). The body gets the most room.
LAYOUT = {
    "Body":      (BODY,   (0.0, 0.0, 0.5, 1.0)),
    "TailFins":  (CAUDAL, (0.5, 0.5, 0.5, 0.5)),
    "DorsalFin": (MEDIAN, (0.5, 0.25, 0.25, 0.25)),
    "PecFins":   (PAIRED, (0.75, 0.25, 0.25, 0.25)),
    "ButtFins":  (None,   (0.5, 0.0, 0.25, 0.25)),     # pelvic, anal, second dorsal
    "Eyeballs1": (EYE,    (0.75, 0.0, 0.25, 0.25)),
}


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, "scene.gltf"))
    for arm in (o for o in bpy.context.scene.objects if o.type == "ARMATURE"):
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    parts = {}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.data.materials and o.data.materials[0].name in LAYOUT:
            parts[o.data.materials[0].name] = o
    return parts


def geometry(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = obj.matrix_world
    verts = np.array([tuple(mw @ v.co) for v in me.vertices])
    polys = [tuple(p.vertices) for p in me.polygons]
    uvl = me.uv_layers[0].data
    uvs = [[tuple(uvl[li].uv) for li in p.loop_indices] for p in me.polygons]
    ev.to_mesh_clear()
    return verts, polys, uvs


def texture(obj):
    mat = obj.data.materials[0]
    img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
    w, h = img.size
    return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]


def frame(geo):
    """Rotation into the game's frame, from the animal: eyes at the front, the
    tail behind, the dorsal fin on top."""
    head = geo["Eyeballs1"][0].mean(axis=0)
    tail = geo["TailFins"][0].mean(axis=0)
    dorsal = geo["DorsalFin"][0].mean(axis=0)
    fwd = head - tail
    fwd /= np.linalg.norm(fwd)
    mid = (head + tail) / 2
    up = dorsal - mid
    up -= fwd * np.dot(up, fwd)
    up /= np.linalg.norm(up)
    side = np.cross(up, fwd)
    return np.stack([side, -fwd, up]), mid


def resample(img, wpx, hpx):
    """Area-average an image down to (hpx, wpx) — integer factors only."""
    fy, fx = img.shape[0] // hpx, img.shape[1] // wpx
    return img[:hpx * fy, :wpx * fx].reshape(hpx, fy, wpx, fx, img.shape[2]).mean(axis=(1, 3))


def build(src, preview=None):
    parts = load(src)
    geo = {k: geometry(o) for k, o in parts.items()}
    R, mid = frame(geo)
    for k in geo:
        v, p, u = geo[k]
        geo[k] = ((v - mid) @ R.T, p, u)

    # The body's centreline, for how far out a fin vertex is.
    bv = geo["Body"][0]
    ys = np.linspace(bv[:, 1].min(), bv[:, 1].max(), 40)
    step = ys[1] - ys[0]
    zc = np.array([bv[np.abs(bv[:, 1] - y) < step, 2].mean() if (np.abs(bv[:, 1] - y) < step).any()
                   else 0.0 for y in ys])
    halfw = np.abs(bv[:, 0]).max()

    V, F, UV, A = [], [], [], []
    atlas = np.ones((SIZE, SIZE, 3), dtype=np.float32)
    height = np.zeros((SIZE, SIZE), dtype=np.float32)
    for name, (part, (u0, v0, w, h)) in LAYOUT.items():
        if name not in geo:
            continue
        verts, polys, uvs = geo[name]
        base = len(V)
        # Part and flex per vertex.
        tags = np.full(len(verts), part if part is not None else MEDIAN, dtype=float)
        if part is None:
            # Pelvic fins sit well off the midline; the anal fin and the second
            # dorsal are on it.
            tags[np.abs(verts[:, 0]) > halfw * 0.18] = PAIRED
        flex = np.zeros(len(verts))
        if part not in (BODY, EYE):
            out = np.hypot(verts[:, 0], verts[:, 2] - np.interp(verts[:, 1], ys, zc))
            for tag in np.unique(tags):
                sel = tags == tag
                lo, hi = out[sel].min(), out[sel].max()
                flex[sel] = (out[sel] - lo) / ((hi - lo) or 1)
        for i, p in enumerate(verts):
            V.append(tuple(p))
            A.append((tags[i] + min(0.99, flex[i])) / 5.0)
        for poly, puv in zip(polys, uvs):
            F.append(tuple(base + i for i in poly))
            UV.append([(u0 + a * w, v0 + b * h) for a, b in puv])
        # Its texture, into its rectangle of the atlas.
        tex = texture(parts[name])
        wpx, hpx = int(w * SIZE), int(h * SIZE)
        x0, y0 = int(u0 * SIZE), int(v0 * SIZE)
        small = resample(tex, wpx, hpx)
        atlas[y0:y0 + hpx, x0:x0 + wpx] = small
        if part != EYE:
            # Relief from the texture's own detail, plus denticle grain.
            lum = small.mean(axis=2)
            blur = resample(lum[..., None], wpx // 8, hpx // 8)[..., 0]
            blur = np.repeat(np.repeat(blur, 8, axis=0), 8, axis=1)[:hpx, :wpx]
            yy, xx = np.mgrid[0:hpx, 0:wpx]
            grain = FT.vnoise(xx / 3.0, yy / 3.0, 41)
            height[y0:y0 + hpx, x0:x0 + wpx] = (lum - blur) * 2.5 + grain * 0.18

    gy, gx = np.gradient(height)
    nx, ny, nz = -gx * 2.0, -gy * 2.0, np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / ln, ny / ln, nz / ln], axis=2) * 0.5 + 0.5
    print(f"  {len(V)} verts, {len(F)} faces from {len(geo)} parts")

    # ── the new object ──
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new("blacktip")
    me.from_pydata(V, [], F)
    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, a in enumerate(A):
        layer.data[i].color = (1.0, 1.0, 1.0, a)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for j, li in enumerate(poly.loop_indices):
            uvl.data[li].uv = UV[poly.index][j]
    me.validate()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new("blacktip", me)
    bpy.context.scene.collection.objects.link(obj)

    mat = bpy.data.materials.new("blacktip_skin")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    imgs = []
    for kind, data in (("albedo", atlas), ("normal", normal)):
        img = bpy.data.images.new(f"blacktip_{kind}", SIZE, SIZE, alpha=False)
        if kind == "normal":
            img.colorspace_settings.name = "Non-Color"
        rgba = np.concatenate([data, np.ones((SIZE, SIZE, 1), dtype=np.float32)], axis=2)
        img.pixels.foreach_set(rgba.astype(np.float32).ravel())
        img.file_format = "JPEG"
        img.pack()
        imgs.append(img)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = imgs[0]
    ntex = nt.nodes.new("ShaderNodeTexImage"); ntex.image = imgs[1]
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)

    if preview:
        render(obj, preview)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    desired = dict(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                   export_yup=True, export_animations=False, export_skins=False,
                   export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                   export_image_format="JPEG", export_jpeg_quality=90,
                   export_cameras=False, export_lights=False, export_extras=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in desired.items() if k == "filepath" or k in known})
    print(f"\n→ {os.path.relpath(OUT, ROOT)}  ({os.path.getsize(OUT) / 1024:,.1f} KB)")

    man = os.path.join(ROOT, "assets", "models", "manifest.json")
    data = json.load(open(man))
    if "shark_blacktip" not in data["models"]:
        data["models"].append("shark_blacktip")
        json.dump(data, open(man, "w"), indent=2)
        open(man, "a").write("\n")


def render(obj, out_dir):
    """Side, top and face views, textured, to check it by eye."""
    import mathutils
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 900, 500
    xs = [v.co for v in obj.data.vertices]
    mn = mathutils.Vector([min(v[i] for v in xs) for i in range(3)])
    mx = mathutils.Vector([max(v[i] for v in xs) for i in range(3)])
    ctr, size = (mn + mx) / 2, mx - mn
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.clip_end = 1e5
    tgt = bpy.data.objects.new("t", None)
    sc.collection.objects.link(tgt)
    tr = cam.constraints.new("TRACK_TO"); tr.target = tgt
    tr.track_axis, tr.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    R = max(size) * 1.25
    for name, target, off in (("side", ctr, (R, 0, 0.1 * R)),
                              ("top", ctr, (0.05 * R, 0, R)),
                              ("face", mathutils.Vector((ctr.x, mn.y + size.y * 0.1, ctr.z)),
                               (R * 0.22, -R * 0.12, R * 0.04))):
        tgt.location = target
        cam.location = target + mathutils.Vector(off)
        sc.render.filepath = os.path.join(out_dir, f"blacktip_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(tgt, do_unlink=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    rest = [a for a in argv if not a.startswith("--") and a != preview]
    src = os.path.expanduser(rest[0]) if rest else os.path.expanduser("~/Downloads/blacktip_reef_shark")
    build(src, preview)
