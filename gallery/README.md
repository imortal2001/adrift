# Adrift asset gallery

A separate app from the game: a 3D library of every asset Adrift draws, so you
can see what each dinosaur, fish, tool, plant, piece of ground, coral and
object looks like without launching the game.

```
python3 gallery/serve.py            # → http://localhost:8125
```

It has its own port, so it runs alongside the game's server (`serve.py`) and
needs nothing else. It listens on `127.0.0.1` only, and the page refuses to
run on anything that is not a development machine — it is a tool, not part
of the game.

## What you get

- **Categories** — Dinosaurs, Living animals, Equipment, Trees & vegetation,
  Land & terrain, Water, Corals & reefs, Other world objects — with a count
  each, search, and a filter by what an asset is made of (glTF model, built in
  code, shader).
- **A preview of every asset**, rendered on load.
- **A 3D viewer** for any one of them: drag to rotate, scroll to zoom,
  right-drag to pan; front / side / back / top / below views; slow turntable;
  wireframe; a metre grid and a 1.75 m person for scale; ← → to step through.
- **The real thing, not a copy.** Every asset is built by the game's own code
  from `src/`, and every model is the game's own file from `assets/models/`.
  Where the game has a built-in fallback for a model (dinosaurs, fish, tools),
  you can switch between the two.
- **Animations** — every clip in a glTF, playable; and for the fish, each way
  the game moves them: cruising, fast, gliding, turning, a startle, hooked and
  landed.
- **Three backdrops** — a neutral studio; *in-game daylight*, which is the
  game's own sky, sun and ocean at any time of day; and *underwater*, through
  the game's own underwater pass (fog, dimmed light, motes, caustics).
- **Gaps & missing** — what the game does not have yet (birds, rivers, survival
  gear…), and any model the manifest lists that is not on disk.
- **Unregistered** — any `.glb` in `assets/models/` that no entry claims shows
  up anyway, flagged red, so a new model is never silently invisible here.

## How it is put together

```
gallery/
  serve.py              the server: gallery/web/ plus read-only /src, /vendor, /assets
  web/index.html        the page
  web/app/main.js       the list, the thumbnails and the viewer
  web/app/registry.js   every asset, and how to build it   ← the one to edit
  web/app/stage.js      the backdrops
  web/app/orbit.js      the orbit camera
```

The game is not modified for the gallery. The registry reaches the game's
assets only through what its modules already export — its classes and tables —
so the two stay separate apps that happen to share the same files.

## Registering an asset

Most of the registry is **generated from the game's own tables**. Add to one of
these and the gallery picks it up with no change here:

| Add a… | in | and it appears under |
|---|---|---|
| dinosaur species | `SPECIES` in `src/wildlife.js` (plus its `.glb`, if it has one) | Dinosaurs |
| fish species | `SPECIES` in `src/fish.js` | Living animals |
| coral, sponge or reef plant | `REEF` in `src/reef.js` | Corals & reefs (`rock` goes to Land & terrain) |
| tree, plant, deadfall or rock | `SPECIES` in `src/flora.js` | Trees & vegetation (rocks go to Land & terrain) |
| kind of flotsam | `DEBRIS_KINDS` in `src/items.js` | Other world objects |
| raft piece | `BUILDABLES` in `src/items.js` | Other world objects |
| held item | `POSES` in `src/viewmodel.js` | Equipment |

Anything else — a new kind of thing, a one-off like the whale — gets an entry
of its own in `loadRegistry()` in `web/app/registry.js`:

```js
add({
  id: 'kelp', name: 'Kelp', category: 'reef', group: 'Underwater plants',
  kind: 'built in code',            // or 'glTF model', or 'shader'
  files: [],                        // any assets/models/ files it uses
  backdrop: 'underwater',           // 'studio' | 'world' | 'underwater'
  source: 'src/kelp.js · kelp()',
  facts: [['Grows', 'sea bed −20 to −6 m']],
  async build() {
    return { object: new THREE.Mesh(kelpGeometry(), kelpMaterial()) };
  },
});
```

`build()` returns `{ object }` at minimum; it can also return `update(dt, t)`
(anything that animates), `clips` and `play(name)` (animations), `frame` (what
to fit the camera to, if not the whole object), `view` (`{ yaw, pitch }`),
`ground: false` (no floor), `ownsWater: true` (show the sea in the daylight
backdrop) and `keepHeight: true` (it sits at its real height in the world).

And when something from **Gaps & missing** arrives, delete its line from `GAPS`
at the top of `registry.js`.
