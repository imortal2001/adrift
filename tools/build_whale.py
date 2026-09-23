"""
Bring a third-party humpback whale into the game.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_whale.py -- [SOURCE_DIR] [--preview OUT_DIR]

SOURCE_DIR defaults to ~/Downloads/game-ready_humpback_whale, and holds the
unzipped Sketchfab download: "Game-ready Humpback Whale" by Allie2k, CC BY 4.0
— credited in CREDITS.md. The source is not in the repository; this writes
assets/models/whale_humpback.glb and adds it to the model manifest.

The source is a 5,000-triangle humpback — the long white-edged flippers, the
tubercles on the head, the throat pleats, the knobbly dorsal hump, the flukes
— painted in Substance, with a normal map. It has no rig: the game swims it
with the same vertex shader as the fish (src/swim.js), bending it up and down.
What this does to it:

* **In the game's frame, in metres.** It already faces -Y with its back +Z;
  it is centred and scaled to 12.5 m. Edited in place, so the author's
  smoothing across the UV seams is kept.
* **Parts from its shape.** The flippers are islands of their own, so they are
  the paired fins, `flex` growing from the root to the tip; the flukes are the
  body behind the narrowest point of the tail stock, `flex` from there out to
  the trailing edge. The small hump of a dorsal stays body: it does not move.
* **The eyes.** The source leaves each eye an open ring in its lids — drawn
  from behind, that reads as an eye in a viewer that shows back faces, but
  three.js culls them, and through the hole you see the sea. Each is closed
  with a shallow dome, painted near black shading to dark brown, and tagged
  an eye (glossy).
* **Its normal map, flipped to glTF's convention.** It was made for Unreal,
  with green pointing down (DirectX); glTF and three.js want green up. That
  it is DirectX is measured, not assumed: a normal map is the slope of a
  surface, so it has no curl, and read with green down it has half the curl
  it has read with green up.
* **Textures as JPEG** at the source's 2048², from 8 MB of PNG.
"""
import json
import os
import sys

import bpy
import mathutils
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "whale_humpback.glb")
NAME = "whale"
LENGTH = 12.5                         # metres, nose to fluke tips
BODY, MEDIAN, CAUDAL, PAIRED, EYE = 0, 1, 2, 3, 4
EYE_DARK = np.array([0.045, 0.032, 0.024])      # linear; dark brown at the rim
PUPIL = np.array([0.008, 0.007, 0.007])


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, "scene.gltf"))
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    # Bake its place in the hierarchy into the mesh, and drop the hierarchy.
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mathutils.Matrix.Identity(4)
    obj.data.transform(mw)
    for o in list(bpy.context.scene.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    return obj


def boundary_loops(bm):
    """The mesh's open edges, chained into loops of vertices in order."""
    nb = {}
    for e in bm.edges:
        if e.is_boundary:
            u, v = e.verts
            nb.setdefault(u, []).append(v)
            nb.setdefault(v, []).append(u)
    seen, loops = set(), []
    for v in nb:
        if v in seen:
            continue
        loop, prev, cur = [v], None, v
        seen.add(v)
        while True:
            nxt = [u for u in nb[cur] if u is not prev and u not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    return loops


def fill_eyes(me):
    """Give it eyeballs. The source leaves each eye an open ring in its lids —
    fine where back faces are drawn, but three.js culls them, so through the
    hole you see the sea behind the whale. Each ring is closed with a shallow
    dome, UV-mapped onto the texture inside the ring (painted later). Returns
    the new faces' indices, per eye."""
    import bmesh
    corner = [tuple(c.vector) for c in me.corner_normals]
    keep = [corner[li] for p in me.polygons for li in p.loop_indices]
    old = len(me.polygons)
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    new_normals, eyes = {}, []
    for ring in boundary_loops(bm):
        P = np.array([tuple(v.co) for v in ring])
        c = P.mean(axis=0)
        perim = np.linalg.norm(P - np.roll(P, 1, axis=0), axis=1).sum()
        # The sockets: small rings on the side of the head, ahead of the
        # flippers (whose open roots sit flush against the body).
        if perim > 0.07 * LENGTH or abs(c[0]) < 0.05 * LENGTH or c[1] > -0.12 * LENGTH:
            continue
        n = np.array(sum((v.normal for v in ring), mathutils.Vector()))
        n /= np.linalg.norm(n)
        if n[0] * c[0] < 0:
            n = -n
        r = np.linalg.norm(P - c, axis=1).mean()
        uv = np.array([tuple(v.link_loops[0][uvl].uv) for v in ring])
        cuv = uv.mean(axis=0)
        sphere = c - n * r * 1.6              # the dome's centre of curvature
        inner = [bm.verts.new(tuple(c + (p - c) * 0.55 + n * r * 0.1)) for p in P]
        centre = bm.verts.new(tuple(c + n * r * 0.14))
        vuv = {v: uv[k] for k, v in enumerate(ring)}
        vuv.update({v: cuv + (uv[k] - cuv) * 0.55 for k, v in enumerate(inner)})
        vuv[centre] = cuv
        faces = []
        for k in range(len(ring)):
            k2 = (k + 1) % len(ring)
            for vs in ((ring[k], ring[k2], inner[k2], inner[k]), (inner[k], inner[k2], centre)):
                f = bm.faces.new(vs)
                f.normal_update()
                if f.normal.dot(mathutils.Vector(n)) < 0:
                    f.normal_flip()
                for lp in f.loops:
                    lp[uvl].uv = tuple(vuv[lp.vert])
                f.smooth = True
                faces.append(f)
        for v in list(ring) + inner + [centre]:
            d = np.array(tuple(v.co)) - sphere
            new_normals[v] = tuple(d / np.linalg.norm(d))
        eyes.append(faces)
    bm.faces.index_update()
    eyes = [[f.index for f in faces] for faces in eyes]
    order = [[new_normals[lp.vert] for lp in f.loops] for f in bm.faces if f.index >= old]
    bm.to_mesh(me)
    bm.free()
    # The author's normals everywhere they were; the dome's own on the new faces.
    me.normals_split_custom_set(keep + [nrm for f in order for nrm in f])
    print(f"  {len(eyes)} eye sockets closed")
    return eyes


def islands(me):
    adj = [[] for _ in me.vertices]
    for p in me.polygons:
        vs = list(p.vertices)
        for a, b in zip(vs, vs[1:] + vs[:1]):
            adj[a].append(b)
            adj[b].append(a)
    seen = np.zeros(len(me.vertices), dtype=bool)
    out = []
    for i in range(len(me.vertices)):
        if seen[i]:
            continue
        comp, stack = [], [i]
        seen[i] = True
        while stack:
            k = stack.pop()
            comp.append(k)
            for j in adj[k]:
                if not seen[j]:
                    seen[j] = True
                    stack.append(j)
        out.append(np.array(comp))
    return out


def fit(obj):
    """Centre it and scale it to LENGTH, nose to fluke tips."""
    me = obj.data
    V = np.array([tuple(v.co) for v in me.vertices])
    mn, mx = V.min(axis=0), V.max(axis=0)
    s = LENGTH / (mx[1] - mn[1])
    mid = (mn + mx) / 2
    me.transform(mathutils.Matrix.Diagonal((s, s, s, 1.0)) @ mathutils.Matrix.Translation(-mathutils.Vector(mid)))
    me.update()
    return np.array([tuple(v.co) for v in me.vertices])


def parts(V, comps, eye_verts):
    """Part and flex per vertex, from the shape."""
    part = np.full(len(V), BODY)
    flex = np.zeros(len(V))
    halfw = np.abs(V[:, 0]).max()
    for c in comps:
        P = V[c]
        ax = np.abs(P[:, 0])
        if ax.max() > 0.7 * halfw:
            # A flipper: out on its own, reaching far past the body.
            root = P[ax < ax.min() + 0.03 * LENGTH].mean(axis=0)
            d = np.linalg.norm(P - root, axis=1)
            part[c], flex[c] = PAIRED, d / d.max()

    # The flukes: behind the narrowest point of the tail stock.
    body = part == BODY
    y0, y1 = V[:, 1].min(), V[:, 1].max()
    t = (V[:, 1] - y0) / (y1 - y0)
    widths = []
    # Wide slices: the mesh is sparse along the tail, and a thin slice that
    # catches only the top of it reads as narrow.
    for k in np.arange(0.72, 0.9, 0.01):
        m = body & (t >= k) & (t < k + 0.03)
        if m.sum() > 20:
            widths.append((np.abs(V[m, 0]).max(), k))
    _, t_root = min(widths)
    m = body & (t >= t_root)
    ring = body & (np.abs(t - t_root) < 0.012)
    root = np.array([0.0, V[ring, 1].mean(), V[ring, 2].mean()])
    d = np.linalg.norm(V[m] - root, axis=1)
    part[m], flex[m] = CAUDAL, d / d.max()
    part[eye_verts] = EYE
    print(f"  flukes from t={t_root:.2f}; flippers {int((part == PAIRED).sum())} verts, "
          f"flukes {int(m.sum())}")
    return part, flex


def rasterise(me, polys, size):
    """Texels inside the given faces' UVs, grown by two to cover filtering."""
    mask = np.zeros((size, size), dtype=bool)
    uvl = me.uv_layers[0].data
    for pi in polys:
        p = me.polygons[pi]
        uv = [np.array(uvl[li].uv) * size for li in p.loop_indices]
        for k in range(1, len(uv) - 1):
            a, b, c = uv[0], uv[k], uv[k + 1]
            x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
            x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            pts = np.stack([xs + 0.5, ys + 0.5], axis=-1)
            m = np.array([[b[0] - a[0], c[0] - a[0]], [b[1] - a[1], c[1] - a[1]]])
            if abs(np.linalg.det(m)) < 1e-9:
                continue
            st = (pts - a) @ np.linalg.inv(m).T
            inside = (st[..., 0] >= 0) & (st[..., 1] >= 0) & (st.sum(axis=-1) <= 1)
            mask[ys[inside].clip(0, size - 1), xs[inside].clip(0, size - 1)] = True
    for _ in range(2):
        g = mask.copy()
        g[1:] |= mask[:-1]; g[:-1] |= mask[1:]; g[:, 1:] |= mask[:, :-1]; g[:, :-1] |= mask[:, 1:]
        mask = g
    return mask


def textures(obj, eyes):
    me = obj.data
    mat = me.materials[0]
    nodes = mat.node_tree.nodes
    tex = {("normal" if "normal" in n.image.name.lower() else "albedo"): n
           for n in nodes if n.type == "TEX_IMAGE" and n.image}
    out = {}
    for kind, node in tex.items():
        img = node.image
        w, h = img.size
        out[kind] = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3].copy()
    albedo, normal = out["albedo"], out["normal"]
    size = albedo.shape[0]

    # The eyes, each shaded from a near-black pupil out to dark brown.
    for polys in eyes:
        ys, xs = np.nonzero(rasterise(me, polys, size))
        r = np.hypot(ys - ys.mean(), xs - xs.mean())
        f = np.clip(r / (r.max() or 1), 0, 1)[:, None] ** 1.5
        albedo[ys, xs] = PUPIL * (1 - f) + EYE_DARK * f
        normal[ys, xs] = (0.5, 0.5, 1.0)

    # DirectX → OpenGL.
    normal[..., 1] = 1.0 - normal[..., 1]

    for kind, data in out.items():
        img = bpy.data.images.new(f"{NAME}_{kind}", size, size, alpha=False)
        if kind == "normal":
            img.colorspace_settings.name = "Non-Color"
        rgba = np.concatenate([data, np.ones((size, size, 1), dtype=np.float32)], axis=2)
        img.pixels.foreach_set(rgba.ravel())
        img.file_format = "JPEG"
        img.pack()
        tex[kind].image = img
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.5
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.name = f"{NAME}_skin"


def build(src, preview=None):
    obj = load(src)
    me = obj.data
    V = fit(obj)
    lids = len(V)                     # vertices from here on are the new eyeballs
    eyes = fill_eyes(me)
    comps = islands(me)
    V = np.array([tuple(v.co) for v in me.vertices])
    eye_verts = sorted({v for polys in eyes for pi in polys for v in me.polygons[pi].vertices if v >= lids})
    part, flex = parts(V, comps, eye_verts)
    print(f"  {len(V)} verts, {len(me.polygons)} faces, {len(comps)} islands")

    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    alpha = (part + np.minimum(0.99, flex)) / 5.0
    layer.data.foreach_set("color", np.column_stack([np.ones((len(V), 3)), alpha]).astype(np.float32).ravel())
    me.color_attributes.active_color = layer
    textures(obj, eyes)
    obj.name = me.name = NAME

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
    if "whale_humpback" not in data["models"]:
        data["models"].append("whale_humpback")
        json.dump(data, open(man, "w"), indent=2)
        open(man, "a").write("\n")


def render(obj, out_dir):
    """Side, eye and underside views, textured, to check it by eye."""
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 900, 500
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = bpy.data.objects.new("t", None)
    sc.collection.objects.link(tgt)
    tr = cam.constraints.new("TRACK_TO"); tr.target = tgt
    tr.track_axis, tr.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    L = LENGTH
    for name, target, off in (("side", (0, 0, 0), (L * 1.2, 0, L * 0.15)),
                              ("quarter", (0, 0, 0), (L * 0.7, -L * 0.6, L * 0.5)),
                              ("eye", (0.08 * L, -0.28 * L, 0.03 * L), (L * 0.2, -L * 0.05, L * 0.03)),
                              ("below", (0, -0.1 * L, 0), (L * 0.3, -L * 0.3, -L * 0.8))):
        tgt.location = target
        cam.location = mathutils.Vector(target) + mathutils.Vector(off)
        sc.render.filepath = os.path.join(out_dir, f"{NAME}_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(tgt, do_unlink=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    rest = [a for a in argv if not a.startswith("--") and a != preview]
    src = os.path.expanduser(rest[0]) if rest else os.path.expanduser("~/Downloads/game-ready_humpback_whale")
    build(src, preview)
