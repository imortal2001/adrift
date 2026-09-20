# Adrift — Ocean Raft Survival (prototype)

You wake on four lashed pallets in open ocean. Debris drifts past on the
current; everything you will ever own starts as something you pulled out of the
water. This prototype covers the first ring of the loop:

**Gather → Craft → Build → Upgrade the raft**

You can dive: press `F` at the deck edge, `Z` to swim down, and the swell, the
light and the colour of the water all change as you go. Schools of small fish
drift past below the raft.

And roughly **80 metres off the bow there is land** — a continent, not an
island. Swim for it and you come ashore on a beach that climbs through conifer
forest to a bare mountain ridge. It is inhabited: sauropods and stegosaurs
browse the slopes, parasaur herds bolt at the first sign of trouble, raptors
hunt in the treeline and a pair of tyrannosaurs work the high ground. They hunt
*each other*, not just you — stand still long enough and you will hear a kill
somewhere in the trees.

Fishing, spearfishing, shipwrecks and weather are deliberately left out — see
*Where to go next* for where each one plugs in.

## Running it

ES modules need to be served over HTTP (`file://` will not work):

```bash
cd adrift && python3 serve.py 8124
```

Then open <http://localhost:8124>. `serve.py` is `http.server` with caching
turned off, which matters while editing: browsers hold on to ES modules hard
enough that you end up testing the previous version of a file. Any static
server works for just playing.

Three.js r170 is vendored in `vendor/`, so there is no install step and the game
needs no network access.

## Controls

| | |
|---|---|
| `W A S D` / `Shift` | move / sprint |
| Mouse | look (no button held) |
| `Esc` | pause |
| Arrow keys | also turn the view |
| `Space` | jump — and climb aboard when you are in the water |
| `E` | gather the debris you are looking at, drink from a collector |
| `1`–`5`, wheel | pick a hotbar slot |
| Left-click | use whatever is in your hands |
| `I` | pack — register tools and items into the five slots |
| `Backspace` | (in the pack) empty the selected slot |
| `C` / `B` | crafting / take out the hammer |
| wheel, `[` `]` | with the hammer out: pick a build piece |
| Right-click | shortcut for throwing the hook when it is in hand |
| `Q` | eat a coconut |
| `X` | salvage the piece under the crosshair — materials come back |
| `F` | step off into the water |
| `Z` / `Space` | swim down / swim up — `Space` climbs out when the deck is in reach |
| `H` | pause and show the help |

### The hotbar

Five slots, `1`–`5`. Whatever is in the selected slot is what your hands are
holding, and left-click uses it — so there is one "what am I doing" state
instead of a key per tool:

| In hand | Left-click |
|---|---|
| Hammer | build mode is on; click places the piece (wheel or `[` `]` picks it) |
| Hook | throw it at debris and reel the debris in |
| Coconut | eat it |
| Spear / Rod | reserved — they say so until spearfishing and fishing exist |
| Material, or nothing | nothing |

Build mode is no longer a toggle: it is simply *holding the hammer*. Take out
another slot and you put the hammer away.

Tools and edible items claim a free slot the moment you first craft or gather
one; raw materials never do, or the bar would fill with driftwood in the first
minute. Press `I` for the pack to register anything by hand — click a slot chip
(or `1`–`5`), then click an item. An item can only be in one slot, so assigning
it somewhere else moves it rather than duplicating it.

A registration is independent of whether you still own the item. Eat your last
coconut and the slot stays bound and greyed out, ready for the next one.

### Mouse look

Moving the mouse turns the view; no button is held, as in any first-person
game. Where the browser grants **pointer lock** the cursor is captured and it
behaves exactly like a native game.

Some contexts refuse pointer lock outright — an embedded preview pane is the
common one. The game detects the refusal and keeps free look working from the
same raw `movementX/Y` deltas, so looking feels the same. The one thing a
captured pointer gives that this cannot is an *unbounded* cursor, so instead of
stopping dead when the pointer reaches the window edge, **holding it against an
edge keeps turning** at a steady rate. The cursor is hidden while you are
looking and comes back whenever a panel wants it.

Free look only applies over the world: moving across the admin panel adjusts it
without swinging the camera, and the crafting and pack panels freeze the view
entirely. The arrow keys turn in either mode, so the game is playable with no
usable mouse at all.

### Admin panel (local development only)

Press <code>`</code> to open a dev panel for the time of day, plus buttons to
top yourself up so you can test building and diving without grinding for
materials first. It exists only
when the page is served from a development machine — a loopback host, a
`file://` page, a `*.local` name, or a private LAN address so that testing on
your phone over your own wifi still counts. Served from a real domain, the key
does nothing and the panel never appears.

| | |
|---|---|
| <code>`</code> | open / close the panel |
| `M` / `N` | jump to midday / midnight |
| `T` | hold the clock still, or let it run again |
| `[` `]` | nudge an hour either way |
| `R` | restore health, hunger and thirst to full |
| `G` | give a stack of every material |
| `K` | give every tool |

Picking a preset also **holds** the clock, otherwise the 12-minute day cycle
would slide you back toward dawn within a minute or two. While the clock is
held the HUD shows a `TIME HELD` badge, so a frozen sun is never a mystery.
Releasing the hold resumes the cycle from wherever you left it.

Restoring sets health, hunger and thirst to 100. Breath is left out because it
refills on its own the moment your head is above water.

**Materials** hands over 50 each of wood, plank, rope, palm and scrap plus 10
coconuts. **Equipment** hands over every tool, registering each to a free
hotbar slot so it is usable immediately — tools are unique, so pressing it
again tops up only what is missing rather than stacking duplicates. Both
amounts are the `ADMIN_MATERIALS` and `ADMIN_EQUIPMENT` tables at the top of
`main.js`.

The panel releases the mouse cursor, and because free look only applies over
the world, moving across the panel adjusts it without swinging the camera —
you can watch the sky while you change it. Its shortcuts only fire while it is
open, and nothing about it is written to the save.

Progress saves to `localStorage` every 10 seconds. "Erase saved raft" on the
pause screen starts over.

## How it fits together

| File | Responsibility |
|---|---|
| `src/ocean.js` | The wave field. One table of four directional waves, compiled into **both** a JS sampler and GLSL, so the raft rides the swell you actually see. |
| `src/sky.js` | Sun, sky dome, stars and the time-of-day palette that drives the ocean colours and fog. 12 real minutes per day. |
| `src/raft.js` | The 2m cell grid, buoyancy, wall collision, shelter test, and every buildable's geometry. |
| `src/build.js` | Build mode: grid snapping, the translucent ghost, placement and salvage. |
| `src/debris.js` | A recycled pool of 60 pieces of flotsam drifting down one current. |
| `src/fish.js` | Schools of small fish. Two instanced meshes per species, so ~105 fish cost a handful of draw calls. |
| `src/terrain.js` | The continent: one height function, streamed as LOD chunks around the viewer, with biome colouring and instanced forests. |
| `src/wildlife.js` | The ecosystem — five species, predator/prey targeting, kills and repopulation. |
| `src/models.js` | Optional glTF bodies for the wildlife, with the procedural ones as fallback. |
| `tools/make_starters.py` | Generates a correctly set up starter `.blend` per species. |
| `tools/convert_glb.py` | Round-trips a third-party `.glb` through Blender to fix deprecated materials. |
| `tools/export_models.py` | Blender-side exporter: settings, manifest upkeep and pre-flight checks. |
| `src/underwater.js` | Light, colour and marine snow falling off with depth. |
| `src/hook.js` | The throwable hook — ballistic flight, attach, reel in. |
| `src/player.js` | Deck / air / swim states, and hunger, thirst and breath. |
| `src/items.js` | All game data: items, recipes, buildables, debris yields, and what each item does in hand. |
| `src/hotbar.js` | The five slots: registration, selection, and auto-assignment. |
| `src/hud.js`, `src/input.js` | DOM HUD (including the dev admin panel); held-vs-tapped keys, mouse look with and without pointer lock. |
| `src/textures.js` | Every texture is painted into a canvas at load time — no image assets. |
| `src/main.js` | Wiring, the frame loop, interaction targeting, milestones, save/load. |

### The continent

The landmass is generated from a single `heightAt(x, z)` — the same discipline
as the ocean. A wobbling radial mask makes the coastline, layered noise makes
the hills, and ridged noise deep inland makes a mountain spine. The mesh, the
player's feet, the trees and every animal all read that one function, so
nothing can hover or sink.

It is streamed in **64m chunks** around whoever is looking: fine near you,
progressively coarser out to about 450m, rebuilt two chunks per frame so
walking never stutters, and disposed once out of range. Chunks carry their own
instanced forest — redwoods, conifers and cycads placed by height, slope and a
moisture field, which is what makes forests and clearings rather than an even
sprinkle. Roughly 2,300 trees are resident at any time for about 100 draw calls.

### Swapping in real models

Animals are built from primitives at runtime, which is why they look like
primitives. `src/models.js` will load a `.glb` per species instead — scaled to
match the body it replaces, stood on the ground from its own bounding box, and
animated through `AnimationMixer` with clips matched by name (`idle`, `walk`,
`run`, `attack`, `death`) and crossfaded from the AI state.

It is entirely optional. Species are listed in `assets/models/manifest.json`;
anything not listed keeps its procedural body, so a missing or broken asset
can never break the world.

`tools/make_starters.py` generates a starter `.blend` per species — right name,
size, orientation, rig and five named actions — and `tools/export_models.py`
exports from Blender straight into the game, updating the manifest for you:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background raptor.blend --python tools/export_models.py
```

See `assets/models/README.md` for the export settings it applies and what it
checks.

### Survival of the fittest

Predators in `wildlife.js` do not have a special "attack the player" mode. They
look for the nearest thing on the prey table and chase it; you are simply an
entry on that table, and often not the most convenient one. Herbivores watch
for predators and bolt. A kill removes an animal and the population tops itself
back up a minute or so later, so the island does not empty out.

Raptors will not take on a sauropod — size is checked before a chase starts —
and nothing follows you into the sea, which makes the water a genuine escape.

Three ideas do most of the work:

**One wave definition, two consumers.** `WAVES` in `ocean.js` is compiled into
the vertex shader *and* sampled on the CPU by `waveHeight()`. Nothing can drift
out of sync, so a barrel bobbing 40m away is genuinely on the surface it
appears to be on.

**The raft never yaws.** It heaves and tilts, but its horizontal frame matches
world space, so "which cell am I standing on" stays a rounding operation while
height still comes from the real transform. Player position is cheap and never
jitters.

**Grid, not physics.** Cells, four edges, one roof slot and one object slot each.
Walls and railings canonicalise to a shared boundary, so a wall between two
cells exists once. Salvaging a foundation flood-fills to refuse any cut that
would split the raft in two.

## Tuning

- Survival pressure: the rates in `Player.vitals()` (`player.js`).
- Debris density and drift: `POOL`, `SPEED`, `BAND` in `debris.js`.
- Fish: `SCHOOLS`, `PER_SCHOOL`, `DEPTH_MIN/MAX`, `FLEE_RADIUS` in `fish.js`.
- Continent shape and distance from the raft: `WORLD` in `terrain.js`.
- Terrain cost: `VIEW_CHUNKS`, `LOD_SEGMENTS`, `TREE_LOD`, `BUILD_BUDGET`.
- Forest make-up: the `FLORA` table (heights, slopes, moisture, yields).
- Animals: the `SPECIES` table in `wildlife.js` — counts, speed, sight, damage,
  and the body proportions each one is built from.
- Underwater darkness: `DARK_DEPTH` in `underwater.js`.
- Diving budget: `SWIM_DOWN`, `SWIM_UP` and the breath drain in `player.js`.
  They are balanced together — ~18s of air, and a trip to 12m and back costs
  about 8s of it. Slowing the ascent without extending the air means drowning
  on the way up.
- Costs and yields: `RECIPES`, `BUILDABLES`, `DEBRIS_KINDS` in `items.js`.
- Slot count: `SLOTS` in `hotbar.js` (the HUD and the number keys both read it).
- Look feel: `sensitivity`, and `EDGE_MARGIN` / `EDGE_RATE` for the edge turn,
  in `input.js`.
- What an item does in hand: its `action` and `hint` in `ITEMS`, plus the
  matching `case` in `Game.useHeld()`.
- Day length: `DAY_SECONDS` in `sky.js`.
- Performance: the ocean is ~180k triangles. Drop the segment count in
  `new THREE.PlaneGeometry(900, 900, 300, 300)` first.

## Where to go next

Each of these has a deliberate hook already in place:

- **Fishing** — `rod` is craftable and already holdable; it has an `action` of
  `'rod'` that currently just says so. Fill in that `case` in `useHeld()`: a
  cast, a timer, a bite, a yield table like `DEBRIS_KINDS`.
- **Spearfishing** — `spear` is craftable and unused, and the fish are already
  there: `FishSchools.pick()` returns the fish under the crosshair (it drives
  the "you need a spear" prompt today) and `nearest()` is there for a thrown
  spear's hit test. A speared fish wants a yield table like `DEBRIS_KINDS`.
- **Cooking** — the campfire is built and lit but has no interaction. Give it an
  input slot and turn raw fish into cooked food.
- **Marine animals** — a shark that circles the raft and punishes swimming is
  the cheapest way to make the water feel dangerous, and would close off the
  "swim away from anything" escape. `Wildlife` already has the targeting.
- **Fighting back** — nothing on land can be killed by the player yet. The
  spear is craftable and holdable, and `Wildlife.pick()` already returns the
  animal under the crosshair; it needs damage and a death state for the player
  as attacker.
- **Building ashore** — the raft grid is anchored to the raft. Letting
  foundations sit on terrain would turn the continent into a second base.
- **Shipwrecks & ruins** — the chunk loader is the natural hook: give a chunk a
  deterministic chance of carrying a landmark, built the same way as its trees.
- **Storms** — `Sky` already centralises the palette, fog and light. A storm is
  a weather state that scales wave amplitudes and darkens that palette.
- **Larger construction** — the grid supports multiple storeys already
  (`ROOF_Y`); stairs and a second floor are new `kind`s in `BUILDABLES`.

## Credits

Rendering uses [three.js](https://threejs.org) r170 (MIT), vendored in
`vendor/` so the game runs with no install step and no network access. Every
texture, mesh and shader in the game itself is generated procedurally at load
time — there are no other third-party assets.
