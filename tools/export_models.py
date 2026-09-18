"""
Export wildlife models from Blender straight into the game.

Run it either way:

    # headless, one .blend at a time
    /Applications/Blender.app/Contents/MacOS/Blender --background raptor.blend \
        --python tools/export_models.py

    # or open this file in Blender's Text Editor and press Run Script

What it does
------------
* Works out which species each export belongs to: one **collection per
  species** if you have them (`raptor`, `tyrannosaur`, ...), otherwise the
  whole scene, named after the .blend file.
* Exports .glb with the settings the loader expects — Y-up, modifiers applied,
  skinning and one clip per action.
* Adds what it exported to `assets/models/manifest.json`, which is what makes
  the game pick the model up.
* Reports triangle counts and the clip names it found, and warns when an
  action name will not match anything the game looks for.

It never deletes a model or removes a species from the manifest: exporting one
animal cannot disturb the others.
"""

import json
import os
import sys

import bpy

# Species the game knows about. Anything else is exported but flagged, since
# the loader would ignore it.
SPECIES = ["sauropod", "stegosaur", "parasaur", "raptor", "tyrannosaur"]

# The clip names src/models.js matches, in the order it prefers them.
CLIP_WORDS = {
    "idle": ["idle", "stand", "breath", "rest"],
    "walk": ["walk", "amble"],
    "run": ["run", "sprint", "gallop", "charge"],
    "attack": ["attack", "bite", "roar", "strike"],
    "death": ["death", "die", "dead"],
}

TRIANGLE_BUDGET = 20000


# ── paths ────────────────────────────────────────────────────────────────────
def project_root():
    """The RaftSurvival directory, found from this script's own location."""
    here = globals().get("__file__")
    if here:
        return os.path.dirname(os.path.dirname(os.path.abspath(here)))
    # Running from an unsaved Text Editor block: fall back to an override.
    env = os.environ.get("ADRIFT_ROOT")
    if env:
        return env
    raise SystemExit(
        "Cannot locate the project. Save this script to disk and run it from "
        "there, or set ADRIFT_ROOT to the RaftSurvival directory."
    )


# ── helpers ──────────────────────────────────────────────────────────────────
def ensure_object_mode():
    obj = bpy.context.view_layer.objects.active
    if obj and obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def select_only(objects):
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def triangle_count(objects):
    total = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in objects:
        if o.type != "MESH":
            continue
        try:
            mesh = o.evaluated_get(depsgraph).to_mesh()
        except RuntimeError:
            continue
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        o.evaluated_get(depsgraph).to_mesh_clear()
    return total


def actions_for(objects):
    """
    Every action the exporter will emit as a clip.

    In ACTIONS mode the exporter takes all compatible actions in the file, not
    just the one currently assigned — so reporting only the assigned action
    under-reports badly (it claimed one clip when three were exported).
    """
    assigned = set()
    for o in objects:
        ad = o.animation_data
        if not ad:
            continue
        if ad.action:
            assigned.add(ad.action.name)
        for track in ad.nla_tracks:
            for strip in track.strips:
                if strip.action:
                    assigned.add(strip.action.name)

    everything = {a.name for a in bpy.data.actions}
    return sorted(everything or assigned), sorted(assigned)


def bounds(objects):
    """World-space size, to sanity-check which way the animal is facing."""
    xs, ys, zs = [], [], []
    for o in objects:
        if o.type not in {"MESH", "ARMATURE"}:
            continue
        for corner in o.bound_box:
            v = o.matrix_world @ type(o.location)(corner)
            xs.append(v.x)
            ys.append(v.y)
            zs.append(v.z)
    if not xs:
        return None
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def gltf_kwargs(filepath, use_selection):
    """
    Build the exporter arguments, then drop any this Blender does not have.

    The glTF operator's property names drift between releases; filtering
    against the live RNA means the script keeps working across versions
    instead of dying on an unexpected keyword.
    """
    desired = {
        "filepath": filepath,
        "export_format": "GLB",
        "use_selection": use_selection,
        "export_apply": True,          # apply modifiers
        "export_yup": True,            # glTF is Y-up; the game expects it
        "export_animations": True,
        "export_skins": True,
        "export_animation_mode": "ACTIONS",   # one clip per action
        "export_morph": True,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
    }
    try:
        known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    except Exception:
        known = set(desired)
    dropped = sorted(k for k in desired if k not in known and k != "filepath")
    kwargs = {k: v for k, v in desired.items() if k == "filepath" or k in known}
    return kwargs, dropped


def check_clips(names):
    """Which of the game's five clip slots these action names would fill."""
    lowered = [n.lower() for n in names]
    matched, missing = {}, []
    for kind, words in CLIP_WORDS.items():
        hit = next((n for n in lowered for w in words if w in n), None)
        if hit:
            matched[kind] = hit
        else:
            missing.append(kind)
    return matched, missing


def update_manifest(root, exported):
    path = os.path.join(root, "assets", "models", "manifest.json")
    data = {"models": []}
    if os.path.exists(path):
        try:
            with open(path) as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            print("  ! manifest.json unreadable; writing a fresh one")
    listed = set(data.get("models") or [])
    added = sorted(set(exported) - listed)
    data["models"] = sorted(listed | set(exported))
    data.setdefault(
        "_comment",
        "Species whose .glb is present in this folder. Written by "
        "tools/export_models.py; safe to edit by hand.",
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    return added, data["models"]


# ── jobs ─────────────────────────────────────────────────────────────────────
def find_jobs():
    """
    One job per species collection, or a single whole-scene job named after the
    .blend file.
    """
    jobs = []
    for coll in bpy.data.collections:
        name = coll.name.strip().lower()
        if name in SPECIES:
            objects = [o for o in coll.all_objects]
            if objects:
                jobs.append((name, objects))
    if jobs:
        return jobs

    blend = bpy.data.filepath
    stem = os.path.splitext(os.path.basename(blend))[0].strip().lower() if blend else ""
    objects = [o for o in bpy.context.scene.objects]
    if not objects:
        return []
    return [(stem or "untitled", objects)]


def main():
    root = project_root()
    out_dir = os.path.join(root, "assets", "models")
    os.makedirs(out_dir, exist_ok=True)

    jobs = find_jobs()
    if not jobs:
        raise SystemExit("Nothing to export: the scene is empty.")

    print("\n" + "=" * 62)
    print(f"Adrift model export  →  {out_dir}")
    print("=" * 62)

    exported, problems = [], []

    for species, objects in jobs:
        print(f"\n[{species}]  {len(objects)} object(s)")

        if species not in SPECIES:
            problems.append(
                f"{species}: not a species the game knows "
                f"({', '.join(SPECIES)}). Rename the collection or the .blend."
            )
            print("  ! unknown species — exporting anyway, but the game will ignore it")

        tris = triangle_count(objects)
        flag = "  (over budget)" if tris > TRIANGLE_BUDGET else ""
        print(f"  triangles: {tris:,}{flag}")
        if tris > TRIANGLE_BUDGET:
            problems.append(
                f"{species}: {tris:,} triangles, over the {TRIANGLE_BUDGET:,} "
                "guideline for 26 skinned animals."
            )

        size = bounds(objects)
        if size:
            print(f"  size (x, y, z): {size[0]:.2f}, {size[1]:.2f}, {size[2]:.2f}")
            if size[0] > size[1] * 1.3:
                print("  ! longer across X than Y — it may be facing sideways.")
                print("    The game wants the animal facing -Y in Blender.")
                problems.append(
                    f"{species}: looks like it faces sideways. If it moonwalks "
                    "in game, set yaw: Math.PI for it in src/models.js."
                )

        names, assigned = actions_for(objects)
        matched, missing = check_clips(names)
        label = ", ".join(names) if names else "(none)"
        if assigned and set(names) != set(assigned):
            label += f"    [currently assigned: {', '.join(assigned)}]"
        print(f"  actions: {label}")
        if matched:
            print("  clips the game will use: "
                  + ", ".join(f"{k} ← {v}" for k, v in matched.items()))
        if missing:
            print(f"  no match for: {', '.join(missing)}")
        if not names:
            problems.append(f"{species}: no actions — it will not animate.")

        select_only(objects)
        path = os.path.join(out_dir, f"{species}.glb")
        kwargs, dropped = gltf_kwargs(path, use_selection=True)
        if dropped:
            print(f"  (this Blender ignores: {', '.join(dropped)})")

        bpy.ops.export_scene.gltf(**kwargs)
        size_kb = os.path.getsize(path) / 1024 if os.path.exists(path) else 0
        print(f"  → {os.path.relpath(path, root)}  ({size_kb:,.0f} KB)")
        exported.append(species)

    added, listed = update_manifest(root, [s for s in exported if s in SPECIES])

    print("\n" + "-" * 62)
    print(f"exported: {', '.join(exported)}")
    if added:
        print(f"added to manifest: {', '.join(added)}")
    print(f"manifest now lists: {', '.join(listed) if listed else '(empty)'}")
    if problems:
        print("\nworth a look:")
        for p in problems:
            print(f"  - {p}")
    print("\nRefresh the game to see them.")
    print("-" * 62 + "\n")


if __name__ == "__main__":
    main()
