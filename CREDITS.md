# Credits

## Code

- [three.js](https://threejs.org) r170 — MIT. Vendored in `vendor/` (core build
  plus `GLTFLoader`, `SkeletonUtils` and `BufferGeometryUtils` from the
  examples), so the game runs with no install step and no network access.

## Art

Every texture, mesh, shader and animation in the game is generated
procedurally at load time. There are currently **no third-party art assets**.

Wildlife models authored in Blender are original work and need no entry here.

If you ever ship a *third-party* model in `assets/models/`, record it below —
one row per file, with the licence and a link to the original. CC BY requires
this; CC0 does not, but list it anyway so the provenance is never in doubt.
Models used only as on-screen reference while modelling are not distributed
and do not belong in this table.

| File | Model | Author | Licence | Source |
|---|---|---|---|---|
| `assets/models/raptor.glb` | Velociraptor | **TODO** | **TODO** | **TODO** |

> ⚠️ **`raptor.glb` needs its provenance filled in.** It was supplied as a
> download (`~/Downloads/velociraptor/`) whose folder carried no licence file —
> only `source/` and `textures/`. That layout is what a Sketchfab download
> looks like, and a Sketchfab zip normally ships a `license.txt` at its root,
> so the licence has most likely been separated from the files rather than
> never existed. Track down the original listing and record the author and
> licence here before this repository is shared or made public. If it turns out
> to be **ND** (no derivatives) it cannot stay: the file has already been
> converted, which is a derivative.
