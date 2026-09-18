"""
Round-trip a .glb through Blender to modernise it.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/convert_glb.py -- input.glb output.glb

Why this exists: plenty of models in the wild still use
`KHR_materials_pbrSpecularGlossiness`, a glTF extension that was deprecated and
which three.js no longer supports. Loading one gives you a default material —
no colour texture and metalness 1 — so the model renders black. Blender still
reads the old extension, converts it to a Principled BSDF on import, and writes
standard metallic-roughness on export.

It also reports what survived, because a silent conversion that drops the
textures is worse than no conversion at all.
"""

import os
import sys

import bpy


def gltf_kwargs(filepath):
    """Export settings, filtered against this Blender's actual properties."""
    desired = {
        "filepath": filepath,
        "export_format": "GLB",
        "use_selection": False,
        "export_apply": False,        # keep shape keys / armature modifiers intact
        "export_yup": True,
        "export_animations": True,
        "export_skins": True,
        "export_animation_mode": "ACTIONS",
        "export_cameras": False,
        "export_lights": False,
    }
    try:
        known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    except Exception:
        known = set(desired)
    return {k: v for k, v in desired.items() if k == "filepath" or k in known}


def describe_materials():
    rows = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            rows.append((mat.name, "no nodes", "", ""))
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            rows.append((mat.name, "no principled BSDF", "", ""))
            continue

        def linked(socket_name):
            sock = bsdf.inputs.get(socket_name)
            if not sock or not sock.is_linked:
                return ""
            node = sock.links[0].from_node
            while node and node.type not in {"TEX_IMAGE"} and node.inputs:
                nxt = next((i.links[0].from_node for i in node.inputs if i.is_linked), None)
                if nxt is node:
                    break
                node = nxt
            return node.image.name if node and node.type == "TEX_IMAGE" and node.image else "(value)"

        metal = bsdf.inputs.get("Metallic")
        rows.append((
            mat.name,
            linked("Base Color") or "(none)",
            linked("Normal") or "(none)",
            f"{metal.default_value:.2f}" if metal else "?",
        ))
    return rows


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        raise SystemExit("usage: ... --python tools/convert_glb.py -- input.glb output.glb")
    src, dst = os.path.abspath(argv[0]), os.path.abspath(argv[1])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = sum(len(m.data.loop_triangles) or len(m.data.polygons) for m in meshes)
    print("\n" + "=" * 62)
    print(f"convert  {os.path.basename(src)}  →  {os.path.basename(dst)}")
    print("=" * 62)
    print(f"  objects: {len(bpy.data.objects)}   meshes: {len(meshes)}   "
          f"armatures: {len([o for o in bpy.data.objects if o.type == 'ARMATURE'])}")
    print(f"  actions: {len(bpy.data.actions)}")
    print(f"  images:  {len(bpy.data.images)}  "
          f"({', '.join(i.name for i in bpy.data.images) or 'none'})")
    print("\n  materials after import (Blender converts spec-gloss to Principled):")
    print(f"    {'name':<22} {'base colour':<22} {'normal':<20} metallic")
    for name, base, nrm, metal in describe_materials():
        print(f"    {name:<22} {base:<22} {nrm:<20} {metal}")

    # Nothing should be fully metallic on a living creature; that is the
    # fallback value that makes an unsupported material render black.
    fixed = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        m = bsdf.inputs.get("Metallic")
        if m and not m.is_linked and m.default_value > 0.5:
            m.default_value = 0.0
            fixed += 1
    if fixed:
        print(f"\n  reset metallic to 0 on {fixed} material(s)")

    bpy.ops.export_scene.gltf(**gltf_kwargs(dst))
    before = os.path.getsize(src) / 1048576
    after = os.path.getsize(dst) / 1048576
    print(f"\n  {before:.1f} MB  →  {after:.1f} MB")
    print("=" * 62 + "\n")


if __name__ == "__main__":
    main()
