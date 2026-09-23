"""
Bring a third-party great white shark into the game.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/build_great_white.py -- [SOURCE_DIR] [--preview OUT_DIR]

SOURCE_DIR defaults to ~/Downloads/shark, and holds the unzipped Sketchfab
download: "Shark" by AndrejKrebs, CC BY 4.0 — credited in CREDITS.md. The
source is not in the repository (its textures alone are 22 MB); this writes
assets/models/shark_greatwhite.glb and adds it to the model manifest.

The source is a skinned, textured great white — slate grey over white, a
conical snout, a heavy body, teeth — kept as its author made it. What this
does to it:

* **Static, in the game's frame.** Taken at its rest pose, without the
  armature: the game swims every fish with one vertex shader (src/swim.js).
  The rest pose stands it on end, so it is turned into the game's frame (nose
  -Y, back +Z) from the animal itself — the head bone forward, the tail
  behind, the first dorsal fin up.
* **Parts from its bones.** Each fin has a bone, so the swim shader's part
  tags come from the skin weights: pectoral and pelvic fins, the dorsals and
  anal, the tail; `flex` from each fin's root to its tip.
* **Its teeth,** joined into the mesh as they sit in the jaw.
* **The eye.** The source paints a small dot; a great white's eye looks
  black, so it gets a small dark, glossy eye of the game's own there.
* **Textures at the dinosaurs' size.** 2048² colour and normal maps, JPEG,
  down from 4096² PNG; the specular map is dropped for a roughness value.
"""
import json
import math
import os
import sys

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "shark_greatwhite.glb")
TEX = 2048
BODY, MEDIAN, CAUDAL, PAIRED, EYE = 0, 1, 2, 3, 4

# Which bones move which part.
PART_GROUPS = {
    PAIRED: ("PectoralFin", "PelvicFin"),
    MEDIAN: ("FirstDorsalFin", "SeccondDorsalFin", "Bone.011"),
    CAUDAL: ("TailTop", "TailBottom"),
}
# Where this source paints its eyes, in UV (found by looking at
# SharkBody_diffuse.png). The texture is also black in its padding and inside
# the mouth, so a blind search for the darkest texel on the head does not work.
EYE_UV = [(0.081, 0.775), (0.081, 0.678)]


def _linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, "scene.gltf"))
    scene = bpy.context.scene
    for arm in (o for o in scene.objects if o.type == "ARMATURE"):
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    body = next(o for o in scene.objects if o.type == "MESH" and o.data.materials
                and o.data.materials[0].name == "SharkBody")
    teeth = [o for o in scene.objects if o.type == "MESH" and o.name.startswith("Cube")]
    return body, teeth


def body_geometry(body):
    """Rest-pose vertices, polygons, per-loop UVs, and part and flex per vertex."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    mw = body.matrix_world
    verts = np.array([tuple(mw @ v.co) for v in me.vertices])
    polys = [tuple(p.vertices) for p in me.polygons]
    uvl = me.uv_layers[0].data
    uvs = [[tuple(uvl[li].uv) for li in p.loop_indices] for p in me.polygons]
    ev.to_mesh_clear()

    names = [g.name for g in body.vertex_groups]
    wsum = np.zeros((len(verts), 4))
    groups = {}
    for i, v in enumerate(body.data.vertices):
        for g in v.groups:
            n = names[g.group]
            groups.setdefault(n, []).append((i, g.weight))
            for p, keys in PART_GROUPS.items():
                if any(n.startswith(k) for k in keys):
                    wsum[i, p] += g.weight
    part = np.where(wsum.max(axis=1) > 0.5, wsum.argmax(axis=1), BODY)

    # Flex: each fin is a connected set of its tagged vertices; its root is
    # where it meets the body.
    flex = np.zeros(len(verts))
    adj = [[] for _ in verts]
    for poly in polys:
        for a, b in zip(poly, poly[1:] + poly[:1]):
            adj[a].append(b)
            adj[b].append(a)
    seen = np.zeros(len(verts), dtype=bool)
    for i in range(len(verts)):
        if part[i] == BODY or seen[i]:
            continue
        comp, stack = [], [i]
        seen[i] = True
        while stack:
            k = stack.pop()
            comp.append(k)
            for j in adj[k]:
                if not seen[j] and part[j] == part[i]:
                    seen[j] = True
                    stack.append(j)
        comp = np.array(comp)
        root = [k for k in comp if any(part[j] == BODY for j in adj[k])] or list(comp)
        d = np.linalg.norm(verts[comp] - verts[root].mean(axis=0), axis=1)
        flex[comp] = d / (d.max() or 1)
    return verts, polys, uvs, part, flex, groups


def centroid(verts, groups, prefixes):
    acc, wt = np.zeros(3), 0.0
    for n, members in groups.items():
        if any(n.startswith(p) for p in prefixes):
            for i, w in members:
                acc += verts[i] * w
                wt += w
    return acc / (wt or 1)


def frame(verts, groups):
    """Rotation into the game's frame, from the animal."""
    head = centroid(verts, groups, ("Head",))
    tail = centroid(verts, groups, ("TailMid", "TailTop", "TailBottom"))
    dorsal = centroid(verts, groups, ("FirstDorsalFin",))
    fwd = head - tail
    fwd /= np.linalg.norm(fwd)
    mid = (head + tail) / 2
    up = dorsal - mid
    up -= fwd * np.dot(up, fwd)
    up /= np.linalg.norm(up)
    return np.stack([np.cross(up, fwd), -fwd, up]), mid


def textures(body):
    mat = body.data.materials[0]
    imgs = [n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]

    def arr(key):
        img = next(i for i in imgs if key in i.name)
        w, h = img.size
        return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    return arr("diffuse"), arr("normal")


def downscale(a, n):
    f = a.shape[0] // n
    return a.reshape(n, f, n, f, a.shape[2]).mean(axis=(1, 3))


def find_eyes(diffuse, polys, uvs, verts):
    """The source's painted eyes, mapped from UV back onto the mesh."""
    h, w, _ = diffuse.shape
    lum = diffuse.mean(axis=2)
    eyes = []
    for u0, v0 in EYE_UV:
        cx, cy, rad = int(u0 * w), int(v0 * h), int(0.02 * w)
        win = lum[cy - rad:cy + rad, cx - rad:cx + rad]
        yy, xx = np.unravel_index(np.argmin(win), win.shape)
        uv = np.array([(cx - rad + xx + 0.5) / w, (cy - rad + yy + 0.5) / h])
        for poly, puv in zip(polys, uvs):
            for k in range(1, len(poly) - 1):
                idx = (0, k, k + 1)
                a, b, c = (np.array(puv[j]) for j in idx)
                m = np.array([[b[0] - a[0], c[0] - a[0]], [b[1] - a[1], c[1] - a[1]]])
                if abs(np.linalg.det(m)) < 1e-12:
                    continue
                s_, t_ = np.linalg.solve(m, uv - a)
                if s_ >= 0 and t_ >= 0 and s_ + t_ <= 1:
                    pa, pb, pc = (verts[poly[j]] for j in idx)
                    pt = pa + s_ * (pb - pa) + t_ * (pc - pa)
                    nrm = np.cross(pb - pa, pc - pa)
                    nrm /= np.linalg.norm(nrm) or 1
                    if np.dot(nrm, [pt[0], 0, 0]) < 0:
                        nrm = -nrm
                    eyes.append((pt, nrm))
                    break
            else:
                continue
            break
    return eyes


def unused_patch(polys, uvs, res=128):
    """The centre of a texture cell no face touches, found by rasterising the
    UV layout coarsely."""
    used = np.zeros((res, res), dtype=bool)
    ys, xs = np.mgrid[0:res, 0:res]
    px, py = (xs + 0.5) / res, (ys + 0.5) / res
    for puv in uvs:
        pts = np.array(puv)
        x0, y0 = np.clip((pts.min(axis=0) * res).astype(int) - 1, 0, res - 1)
        x1, y1 = np.clip((pts.max(axis=0) * res).astype(int) + 1, 0, res - 1)
        used[y0:y1 + 1, x0:x1 + 1] = True             # bounding boxes: conservative
    # Farthest from anything used, so filtering never bleeds into a face.
    free = np.argwhere(~used)
    if not len(free):
        return (0.999, 0.999)
    usedpts = np.argwhere(used)
    best, bestd = free[0], -1
    for cell in free[::max(1, len(free) // 400)]:
        d = np.min(np.abs(usedpts - cell).max(axis=1))
        if d > bestd:
            best, bestd = cell, d
    return ((best[1] + 0.5) / res, (best[0] + 0.5) / res)


def eye_geometry(V, F, C, A, UVS, eyes, length, white_uv):
    """A great white's eye: black to look at, a faint blue-grey iris, a dark
    rim, domed and glossy (the swim shader makes EYE parts glossy)."""
    r = length * 0.0065
    n = 14
    rings = [(0.6, 0.9, (0.012, 0.012, 0.014)), (0.9, 0.55, (0.07, 0.08, 0.1)),
             (1.05, 0.3, (0.03, 0.03, 0.03)), (1.35, 0.0, (0.16, 0.17, 0.18))]

    def add(p, col):
        V.append(tuple(p)); C.append(col); A.append(EYE / 5.0)
        return len(V) - 1

    def face(idx, outward):
        a, b, c = (np.array(V[i]) for i in idx[:3])
        F.append(tuple(idx) if np.dot(np.cross(b - a, c - a), outward) >= 0 else tuple(reversed(idx)))
        UVS.append([white_uv] * len(idx))

    for pt, nrm in eyes:
        along = np.array([0.0, 1.0, 0.0]) - nrm * nrm[1]
        along /= np.linalg.norm(along)
        upv = np.cross(nrm, along)
        if upv[2] < 0:
            upv = -upv
        base = pt + nrm * r * 0.05
        ell = lambda rr, lift: [base + nrm * lift * r * 0.3 + along * math.cos(a) * rr * r * 1.3 +
                                upv * math.sin(a) * rr * r for a in (2 * math.pi * k / n for k in range(n))]
        centre = add(base + nrm * r * 0.32, rings[0][2])
        rs = [[add(p, col) for p in ell(rr, lift)] for rr, lift, col in rings]
        for k in range(n):
            k2 = (k + 1) % n
            face([centre, rs[0][k], rs[0][k2]], nrm)
            for a_, b_ in zip(rs, rs[1:]):
                face([a_[k], b_[k], b_[k2], a_[k2]], nrm)


def build(src, preview=None):
    body, teeth = load(src)
    verts, polys, uvs, part, flex, groups = body_geometry(body)
    R, mid = frame(verts, groups)
    turn = lambda p: (np.array(p) - mid) @ R.T
    verts = turn(verts)
    diffuse, normal = textures(body)
    eyes = find_eyes(diffuse, polys, uvs, verts)
    print(f"  body {len(verts)} verts, {len(polys)} faces; eyes found: {len(eyes)}")

    # A white patch for everything the texture should not colour (the teeth,
    # the eyes): the source has no true white, so one is painted into a part of
    # the texture no face uses.
    white_uv = unused_patch(polys, uvs)
    ph = diffuse.shape[0]
    cx, cy = int(white_uv[0] * ph), int(white_uv[1] * ph)
    diffuse[cy - 12:cy + 12, cx - 12:cx + 12] = 1.0
    print("  white patch at", tuple(round(v, 3) for v in white_uv))

    V = [tuple(v) for v in verts]
    F = list(polys)
    UVS = [list(u) for u in uvs]
    C = [(1.0, 1.0, 1.0)] * len(V)
    A = [(part[i] + min(0.99, flex[i])) / 5.0 for i in range(len(V))]
    for t in teeth:
        base = len(V)
        for v in t.data.vertices:
            V.append(tuple(turn(t.matrix_world @ v.co))); C.append((0.93, 0.9, 0.82)); A.append(0.0)
        for p in t.data.polygons:
            F.append(tuple(base + i for i in p.vertices))
            UVS.append([white_uv] * len(p.vertices))
    length = verts[:, 1].max() - verts[:, 1].min()
    eye_geometry(V, F, C, A, UVS, eyes, length, white_uv)

    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new("greatwhite")
    me.from_pydata(V, [], F)
    layer = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, (c, a) in enumerate(zip(C, A)):
        layer.data[i].color = tuple(_linear(x) for x in c) + (a,)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for j, li in enumerate(poly.loop_indices):
            uvl.data[li].uv = UVS[poly.index][j]
    me.validate()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new("greatwhite", me)
    bpy.context.scene.collection.objects.link(obj)

    mat = bpy.data.materials.new("greatwhite_skin")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    imgs = []
    for kind, data in (("albedo", downscale(diffuse, TEX)), ("normal", downscale(normal, TEX))):
        img = bpy.data.images.new(f"greatwhite_{kind}", TEX, TEX, alpha=False)
        if kind == "normal":
            img.colorspace_settings.name = "Non-Color"
        rgba = np.concatenate([data, np.ones((TEX, TEX, 1), dtype=np.float32)], axis=2)
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
    bsdf.inputs["Roughness"].default_value = 0.5
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
    if "shark_greatwhite" not in data["models"]:
        data["models"].append("shark_greatwhite")
        json.dump(data, open(man, "w"), indent=2)
        open(man, "a").write("\n")


def render(obj, out_dir):
    """Side and face views, textured, to check it by eye."""
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
    cam.data.clip_end = 1e6
    tgt = bpy.data.objects.new("t", None)
    sc.collection.objects.link(tgt)
    tr = cam.constraints.new("TRACK_TO"); tr.target = tgt
    tr.track_axis, tr.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    R = max(size) * 1.3
    for name, target, off in (("side", ctr, (R, 0, 0.12 * R)),
                              ("face", mathutils.Vector((ctr.x, mn.y + size.y * 0.12, ctr.z)),
                               (R * 0.28, -R * 0.1, R * 0.05))):
        tgt.location = target
        cam.location = target + mathutils.Vector(off)
        sc.render.filepath = os.path.join(out_dir, f"greatwhite_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(tgt, do_unlink=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    rest = [a for a in argv if not a.startswith("--") and a != preview]
    src = os.path.expanduser(rest[0]) if rest else os.path.expanduser("~/Downloads/shark")
    build(src, preview)
