# Wildlife models

Drop a `.glb` in here **and add its species to `manifest.json`** — that species
then upgrades itself the next time the page loads. If a species is not listed
the game keeps the procedural body it builds at runtime, so the world is never
broken by a missing or bad asset.

```json
{ "models": ["raptor", "tyrannosaur"] }
```

The manifest exists so that an empty folder costs nothing: probing for each
file instead would leave a red 404 in the console for every species you have
not made yet.

| File | Species |
|---|---|
| `sauropod.glb` | long-necked browser |
| `stegosaur.glb` | plated grazer |
| `parasaur.glb` | crested herd animal |
| `raptor.glb` | pack hunter |
| `tyrannosaur.glb` | apex predator |

## What the loader does for you

- **Scale**: the model is scaled so its nose-to-tail length matches the body it
  replaces, so reach, collision and sight ranges stay exactly as tuned.
- **Ground height**: measured from the model's own bounding box — it stands on
  the terrain, it does not sink or hover.
- **Facing**: the game treats **+Z as forward**. If your model faces the other
  way it will moonwalk; set `yaw: Math.PI` for that species in
  `src/models.js` → `MODELS`.
- **Animation**: clip names are matched on substrings, case-insensitively:
  `idle`/`stand`/`breath`, `walk`, `run`/`sprint`/`gallop`,
  `attack`/`bite`/`roar`, `death`/`die`. Anything unmatched falls back to the
  first clip. A model with no clips still works — it just does not animate.

Check the browser console and the in-game log: each species reports whether it
loaded and how many clips it found.

## Starting a model

`tools/make_starters.py` generates a `.blend` per species in `blender/`, each
already carrying the things the exporter cares about:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/make_starters.py
```

* collection named after the species
* rough blockout at the correct real-world size, **facing -Y**
* armature with a spine/neck/head/tail/leg chain, skinned
* five actions — `Idle`, `Walk`, `Run`, `Attack`, `Death`

The blockout is scaffolding, not art: reshape it, sculpt over it, or delete the
mesh and model your own. As long as the collection name, the facing and the
action names survive, the export keeps working.

## Exporting from Blender

The quickest route is the script — it applies the settings below, updates
`manifest.json`, and tells you which clips the game will actually use:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background raptor.blend --python tools/export_models.py
```

It takes the species from a **collection named after it** (`raptor`,
`tyrannosaur`, …) so one .blend can hold several, and falls back to the .blend
filename if there are no such collections. You can also open the script in
Blender's Text Editor and press **Run Script**.

To export by hand instead — **File → Export → glTF 2.0 (.glb)**, then:

| Setting | Value | Why |
|---|---|---|
| Format | **glTF Binary (.glb)** | One file, textures included — nothing to lose track of. |
| Transform → +Y Up | **on** (default) | glTF is Y-up; the game expects it. |
| Data → Mesh → Apply Modifiers | on | Otherwise your subsurf/mirror never makes it out. |
| Data → Animation | on | Including **Skinning**. |
| Animation → Animation Mode | **Actions** | Exports each action as its own named clip. |

**Name your actions** `Idle`, `Walk`, `Run`, `Attack`, `Death`. The loader
matches on case-insensitive substrings, so `TRex_Walk_01` is fine too. A model
with no animation still loads — it just stands there.

**Which way it faces.** The game treats **+Z as forward**. Blender's exporter
maps Blender `-Y` to glTF `+Z`, so model the animal facing **-Y** — that is,
facing *you* in Front view (Numpad 1). Axis conventions trip everyone up, so if
it walks backwards in game, just set `yaw: Math.PI` for that species in
`src/models.js` → `MODELS` and move on.

**Scale and units do not matter.** The loader measures the model and rescales
it to match the nose-to-tail length of the body it replaces, so reach,
collision and sight ranges stay exactly as tuned. Do **Ctrl+A → All Transforms**
before exporting anyway, so the rest is predictable.

**Budget.** Up to 26 animals are skinned every frame. Somewhere under
~20k triangles each leaves plenty of headroom.

## Models from elsewhere: convert them first

A lot of models in the wild still use `KHR_materials_pbrSpecularGlossiness`, a
glTF extension that has been deprecated and which three.js no longer supports.
Load one as-is and the loader falls back to a default material — no colour
texture, metalness 1 — so it renders **solid black**. It is not obvious from
the console, which stays silent.

`tools/convert_glb.py` round-trips the file through Blender, which still reads
the old extension and writes standard metallic-roughness on the way out:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/convert_glb.py -- input.glb assets/models/raptor.glb
```

It reports what survived — base colour, normal map, metallic value, action
count — because a silent conversion that drops the textures is worse than no
conversion at all. It also resets any fully-metallic material to 0, which is
the fallback value that causes the black render.

**Which way it faces** is the other thing to check on a downloaded model. Many
are built running along X rather than the game's +Z. Set `yaw` for that species
in `src/models.js` → `MODELS`; `raptor` uses `-Math.PI / 2` for exactly this
reason.

## Licensing — read before adding anything

This folder ships inside the repository, so whatever you put here is
distributed with the game.

**Modelling it yourself in Blender sidesteps almost all of this** — a model you
build is yours, and no one owns a dinosaur's anatomy. Using someone else's
model as *visual reference* for proportions and silhouette is fine; starting
from their mesh and editing it is a derivative work and carries their licence
with it. Keep the reference in a browser tab, not in your `.blend`.

If you do ship a third-party model, prefer **CC0** or **CC BY**, and avoid:

- **ND** (no derivatives) — converting and rescaling a model is arguably a
  derivative, and you cannot distribute those.
- **NC** (non-commercial) — locks the project out of commercial use for good,
  which is painful to unwind later.

Record every model in `CREDITS.md` at the repository root as you add it. CC BY
*requires* that attribution; CC0 does not, but it costs nothing to be decent
about it.
