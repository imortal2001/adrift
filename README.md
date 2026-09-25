# Adrift — Ocean Raft Survival (prototype)

You wake on four lashed pallets in open ocean. Debris drifts past on the
current; everything you will ever own starts as something you pulled out of the
water. This prototype covers the first ring of the loop:

**Gather → Craft → Build → Upgrade the raft**

You can dive: press `F` at the deck edge, `Z` to swim down, and the swell, the
light and the colour of the water all change as you go. **Under the raft is a
coral reef** — sand at about 18m with coral heads standing 8m off it, brain
coral and staghorn and barrel sponges and sea fans swaying in the surge, with
sunlight thrown across the sand in caustics. Reef fish work the coral in
schools — yellow and blue tangs, chromis, wrasse, red snapper, porgies — and
the predators work the reef fish: a barracuda hanging motionless over a coral
head, a grouper by its hole, blacktip reef sharks on patrol. A flounder lies
on the open sand, mackerel pass through mid-water, mahi-mahi circle under the
raft, and yellowfin tuna run out past the drop-off. Every so often a humpback
whale surfaces within sight of the raft, blows a few times and sounds, flukes
up. Swim far enough out and the shelf falls away into a basin deeper than one
breath will take you.

And roughly **80 metres off the bow there is land** — a continent, not an
island, two and a half kilometres across. Swim for it and you come ashore on a
beach under a wall of giant redwoods, fifty metres tall and three across at
the foot, hung with vines, with tree ferns, cycads and ferns under them. Past
the forest are open plains of waist-high grass, a river cutting down to the
sea, stepped sandstone escarpments, sea cliffs with stacks standing off them,
and in the middle a range of jagged peaks, snow on the tops, that you can see
from the raft. It is inhabited: sauropods and stegosaurs
browse the slopes, parasaur herds bolt at the first sign of trouble, raptors
hunt in the treeline and a pair of tyrannosaurs work the high ground. They hunt
*each other*, not just you — stand still long enough and you will hear a kill
somewhere in the trees.

Food comes from the sea two ways: a **spear** you throw or thrust, and a **rod**
you cast from the deck and strike with when the float goes under. Bait the
hook with a fish you have caught and the big ones come for it. Cook it over a
campfire you light yourself, with a bow drill. Shipwrecks and weather are
deliberately left out — see *Where to go next* for where each one plugs in.

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

### Asset gallery

A separate app, for looking at every asset the game draws — dinosaurs, fish,
tools, trees, terrain, water, corals, flotsam and the raft — in a 3D viewer,
without launching the game:

```bash
python3 gallery/serve.py
```

Then open <http://localhost:8125>. It builds everything with the game's own
code and models, runs on this machine only, and has its own
[README](gallery/README.md), including how to register a new asset.

## Controls

| | |
|---|---|
| `W A S D` / `Shift` | move / sprint |
| Mouse | look (no button held) |
| `Esc` | pause |
| Arrow keys | also turn the view |
| `Space` | jump — and climb aboard when you are in the water |
| `V` | change the view: first person → third (behind you) → second (facing you) |
| `E` | gather the debris you are looking at, drink from a collector, take back a thrown spear; at a campfire, cook the raw fish in hand, take fish that are done, or feed it wood |
| `1`–`5`, wheel | pick a hotbar slot |
| Left-click | use whatever is in your hands |
| `I` | pack — register tools and items into the five slots |
| `Backspace` | (in the pack) empty the selected slot |
| `C` / `B` | crafting / take out the hammer |
| wheel, `[` `]` | with the hammer out: pick a build piece |
| Right-click | throw what is in hand — the spear, or the hook |
| Hold left / right click | with the paddle, on the deck: paddle forward / back-paddle |
| `Q` | eat — a coconut if you have one, otherwise a fish (the one in hand, else the one you have most of) |
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
| Coconut, any fish | eat it (raw or cooked) |
| Bow drill | **hold** at an unlit campfire to saw up an ember — it takes 1 Palm for tinder |
| Spear | a thrust that skewers the fish on the crosshair; **right-click throws it** — pull it back out with `E` |
| Rod | **hold** to swing and let go to cast; click when the float goes under; then **hold to reel, let go to give line**. **Right-click** puts a fish on the hook as bait — the smallest you have (right-click again takes it back off) |
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
| `src/raft.js` | The 2m cell grid, buoyancy, wall collision, shelter test, and every buildable's geometry — and where the raft is: paddled, blown by the wind in a sail, slowed by the water, run aground on the shallows, carrying whoever stands on it. |
| `src/fire.js` | How a campfire looks: rounded stones, a teepee of sticks over coals that char from the heart outward as the fuel goes and glow while it burns, a shader-drawn flame that billows and licks, and sparks. |
| `src/camera.js` | The three views: first person at the eye, third behind you over the shoulder, second in front looking back; pulled in short of walls, roof and ground. |
| `src/body.js` | The player's body, seen outside first person: a rigged character (or a code-built stand-in) walked, run, swum and jumped by joint angles made in code, holding what you hold. |
| `src/net.js` | Playing together: joining a room through the relay, sending where you are and what you do, and drawing the others — their characters, smoothed between updates, holding what they hold, with a name over their heads. |
| `src/sharedworld.js` | Playing together in one world, the host's: the time of day, the flotsam, the fish schools, the whale and the dinosaurs, a catch or a gather gone for everyone, the others' spears in flight, a bite on a guest sent to them. |
| `src/spawn.js` | Where a new castaway comes to: a beach, the open sea, a square of wreckage or a small raft — never inland — and what they are told. |
| `src/statue.js` | The statues — respawn points: carved in code, standing here and there over the land, lifted and set up on land or on the deck, registered at to wake beside when you die. |
| `src/together.js` | Playing together on one raft, the host's: your own put by while you are away from it, each change sent as it happens, and the host's copy settling anything contested. |
| `server/` | The multiplayer relay: a Cloudflare Worker with one Durable Object per room, and `dev-relay.mjs`, the same on this machine. See `server/README.md`. |
| `src/build.js` | Build mode: grid snapping, the translucent ghost, placement and salvage. |
| `src/debris.js` | A recycled pool of 60 pieces of flotsam drifting down one current. |
| `src/fish.js` | The fish, in schools — glTF bodies, one instanced draw per species. Fourteen species, ~220 fish, 14 draw calls. Where each lives (reef, sand, mid-water, under the raft, past the drop-off), how it steers, and how it reacts to you. |
| `src/swim.js` | How a fish moves its body: the swim shader (per-part motion, scales, sheen) and the per-fish stroke driver, with every species' swimming style. Shared by the schools, the whale, and speared and hooked fish. |
| `src/whale.js` | One humpback, ambient: cruises, surfaces to blow, sounds flukes-up. Not catchable. |
| `src/reef.js` | What lives on the sea bed: coral, sponges, anemones, seagrass, kelp, urchins, starfish, giant clams and rock, plus the surge that bends the soft ones. |
| `src/meshkit.js` | Welds a pile of coloured primitives into one geometry. Used by the reef. |
| `src/terrain.js` | The continent: one height function (coast, hills, plains, escarpments, the range, rivers), streamed as LOD chunks around the viewer, with biome colouring, the scatter of plants and rocks, the far land and canopy, and the rivers' water. |
| `src/flora.js` | Everything that grows on land, and the rocks and deadfall: sixteen species built from trunks, branches and painted foliage cards, the leaf atlas and bark they are drawn with, wind, and where each grows. |
| `src/detail.js` | World-space ground detail — grain, blotches, cracks, and the relief they make — shared by the terrain and the rocks. |
| `src/wildlife.js` | The ecosystem — five species, predator/prey targeting, kills and repopulation. |
| `src/models.js` | Optional glTF bodies for the wildlife, with the procedural ones as fallback. |
| `tools/build_fish.py` | Builds all fifteen sea-life bodies in Blender — each species' own face, textured skin (via `tools/fish_textures.py`), fins with rays, gills, eyes, every vertex tagged with its part for the swim shader — and exports them as one `.glb`. |
| `gallery/` | The asset gallery: a separate app and server that shows every asset in a 3D viewer. See its README. |
| `tools/build_great_white.py` | Converts a third-party great white (CC BY 4.0, see CREDITS.md) for the game: rest pose, the game's frame, fin tags from its bones, its teeth joined in, a dark eye, textures downsized. |
| `tools/build_whale.py` | Converts a third-party humpback whale (CC BY 4.0, see CREDITS.md) for the game: centred and scaled to 12.5 m, flipper and fluke tags from its shape, dark eyes, its normal map flipped to glTF's convention. |
| `tools/build_coconut.py` | Converts a third-party photoscanned coconut (CC BY 4.0, see CREDITS.md) for the game: a smooth 3,072-triangle shell fitted to the 199,500-triangle scan, pores up, ~17 cm, with the scan's colour and relief baked onto it at 1024² (23 MB down to 270 KB). Held in hand, and afloat as flotsam at 2.4 times the size. |
| `tools/build_player.py` | Converts the Ready Player Me woman and man (CC BY-NC-SA 4.0, see CREDITS.md) into the player's body: pose made the rest pose, facing the game's forward in metres, bone names cleaned, dressed for the Stone Age by repainting (the man's atlas by the bones that move each part), textures shrunk. |
| `tools/build_shark.py` | Converts a third-party blacktip reef shark (CC BY 4.0, see CREDITS.md) for the game: rest pose, the game's frame, one mesh and one texture atlas, fin tags for the swim shader, a normal map. |
| `tools/simulate_fight.mjs` | Plays the rod's fight thousands of times per species with five kinds of player, for tuning `fight.js` by numbers rather than feel. |
| `tools/build_tools.py` | Puts the three third-party tool models in the frame the hand holds them by, colours the spear, and shrinks their textures. |
| `tools/make_starters.py` | Generates a correctly set up starter `.blend` per species. |
| `tools/convert_glb.py` | Round-trips a third-party `.glb` through Blender to fix deprecated materials. |
| `tools/export_models.py` | Blender-side exporter: settings, manifest upkeep and pre-flight checks. |
| `src/underwater.js` | Light, colour and marine snow falling off with depth. |
| `src/hook.js` | The throwable hook — ballistic flight, attach, reel in. |
| `src/player.js` | Deck / air / swim states, and hunger, thirst and breath. |
| `src/items.js` | All game data: items, recipes, buildables, debris yields, and what each item does in hand. |
| `src/hotbar.js` | The five slots: registration, selection, and auto-assignment. |
| `src/viewmodel.js` | What is in your hand: drawn as a second pass over the frame, with bob, sway, swap and a click animation per action. |
| `src/spear.js` | Thrown spears: flight, sticking into ground, sea bed and deck, floating in water, and pulling them back out. |
| `src/fishing.js` | The rod: the swing meter and cast, the float, nibbles and the bite, drawing the fight, and what bites where. |
| `src/fight.js` | The fight once a fish is hooked — tension, line and stamina, and how each species fights. Pure maths, no imports, so it can be simulated on its own. |
| `src/hud.js`, `src/input.js` | DOM HUD (including the dev admin panel); held-vs-tapped keys, mouse look with and without pointer lock. |
| `src/textures.js` | Every texture is painted into a canvas at load time — no image assets. |
| `src/main.js` | Wiring, the frame loop, interaction targeting, milestones, save/load. |

### The continent

The landmass is generated from a single `heightAt(x, z)` — the same discipline
as the ocean. The mesh, the player's feet, the trees and every animal all read
that one function, so nothing can hover or sink.

It is built the way land is, every part sampled through a *warped* domain so
nothing lines up in rows:

- **The coast** — a radial mask with headlands and bays swung round it by
  bearing. The sheltered side, where the raft is, is beach; the exposed side
  rises straight out of the sea as cliffs, 25–50 m high, with sea stacks
  standing off them. Cliffs are kept 300 m and more from the raft, so the first
  landing is always sand.
- **Hills and plains** — rolling fbm hills behind the beach, flattened in
  places into wide plains of tall grass.
- **Escarpments** — patches of harder rock stepped into flat benches and
  cliff risers (terracing), in sandstone.
- **The range** — ridged multifractal noise deep inland, peaks near 400 m,
  snow above ~250 m, bare rock above the treeline at ~190 m.
- **Rivers** — two, each a curve in polar coordinates from a spring in the
  range to a mouth on the coast. Their water level is surveyed once from the
  land they cross (always a little under it, never rising downstream), and
  near the channel the land is set to it: carved into gorges through ridges,
  banked into a flood plain across hollows. The first reaches the sea about
  200 m up the coast from the landing beach. The water is a ribbon at the
  surveyed level, flowing, reflecting the sky; you wade it, about a metre deep.

It is streamed in **64m chunks** around whoever is looking: fine near you,
progressively coarser out to about 450m, rebuilt two chunks per frame so
walking never stutters, and disposed once out of range. Normals are sampled
across the chunk edges and each chunk hangs a skirt, so there are no seams.
Beyond the chunks the **far land** takes over: the whole continent at 16 m, in
two sheets — the ground, and the forest canopy as a lumpy shell over it — each
sunk out of sight inside the square the chunks draw for real. That is what you
see of the far coast and the range from the raft.

The ground's colour comes from what the land is — sand, straw on the plains,
leaf litter and moss under the canopy, mud and pebbles on the river banks,
sandstone on the escarpments, rock, scree and snow up high — and `detail.js`
adds grain, blotches and relief in world space on top, triplanar on the
steep faces.

### The forest

Everything that grows is in `flora.js`, built the way a real plant is: a
trunk that flares into buttresses at the ground, branches, and foliage on the
branches — not geometry but **painted cards**, cut-outs from one leaf atlas
painted at load time (needle sprays, araucaria ropes, fern and cycad fronds,
grass, reeds, vine strands). The species are the Mesozoic's, since the
animals are:

| | |
|---|---|
| Canopy | **giant redwoods** (~55 m, buttressed, crowns in the top half, some hung with vines) and **araucarias** (monkey puzzles: a tall grey trunk under a flat umbrella crown) |
| Understorey | **tree ferns**, **cycads**, **shrubs**, stands of **giant horsetail** and groves of **bamboo** by the rivers; and the first flowering plants — **fan palms** behind the beaches and along the rivers, **magnolias** in flower at the forest edge (the tyrannosaurs and parasaurs are late Cretaceous, when both were already about) |
| Ground | **ferns** thick on the forest floor; **grass** in the open, **tall grass** on the plains, **reeds** at the water |
| Deadfall | **fallen logs** (mossy, snapped at one end, ferns growing out of them), **stumps** with their roots, **fallen branches** |
| Rock | **boulders**, **crags** heaped on the slopes and escarpments, and **spires** — sea stacks and lone pillars on the plains |

Vines also hang down the steep faces — cliffs and escarpment risers — draped
strand by strand down the rock.

Each species has a rule, `where(site)`, from what the land says the spot is:
how wooded (moisture, shelter, the treeline, clearings), how wet, how steep,
whether it is plain, beach, cliff or mountain, how far from the river's
edge. Each layer (canopy, understorey, ground, grass, deadfall, rocks,
landmarks) is a jittered grid at its own spacing, and each cell holds a
weighted lottery among the layer's species — always over every species, so
walking closer never changes what grows where, only how finely it is drawn.
So the forest is dense where it is wet and sheltered, thins onto the beach,
stops at the treeline, gives way to grass on the plains and to rock on the
cliffs.

Detail falls off with distance: grass and ferns within ~100 m (fading out
rather than stopping), full trees within ~100 m and a cheap build of each out
to ~220 m, the far canopy beyond; landmarks — crags and spires — to the edge
of the chunks. Foliage sways in the wind in the vertex shader. Trunks, stumps
and rocks are solid; you walk round them. Anything with a harvest can be
felled, and stays felled — through a rebuild or a reload of its chunk — until
it grows back.

### The reef

The sea bed comes out of the same `heightAt(x, z)` as the land — there is one
surface, and the waterline is just where it crosses zero. Out from the beach it
shelves to a sand floor at about 18m, ridged noise piles coral heads up to 8m
off that, and past the shelf edge it drops into a basin at 42m.

The depths are set against the **air supply**, not against a reference photo.
You have about 18 seconds and you descend at 2.4 m/s, so coral tops at ~10m are
a comfortable visit, the sand at ~18m spends most of a breath, and the basin is
deliberately below `MAX_DEPTH` — deep water is meant to stay out of reach.

`reefMask(x, z, out)` says where coral grows, and everything downstream reads
it: the terrain raises coral heads where the mask is high, the props grow on
the colonies while the seagrass takes the sand between them, and the reef fish
school over ground the mask likes. Species are picked by **weighted lottery**
among everything that could live at that spot rather than first-match-wins,
which is the difference between a reef and one coral repeated 800 times.

Besides the corals there is golden **kelp**, standing four and five metres tall
in the shallower water and swaying in the surge; **sea urchins** and **giant
clams**, gaping to show their blue-green mantles, on the colonies; and
**starfish** out on the sand.

Two things do most of the work for how it *reads*. Water clarity is a depth
curve in `underwater.js`, opened up so you can see 25–30m on the shelf; the
first cut fogged out at 12m and the sea bed came across as a grey wall you
could never see enough of. And the sunlight is focused into **caustics** —
three sine grids beaten together and sharpened, gated to fragments below the
waterline, applied to the terrain and the reef from the same clock.

The props are geometry standing **on** the sea bed, not part of it, so nothing
that reads `heightAt` knows they exist — which is how the first cut had a third
of the reef fish swimming through boulders. `Terrain.clearanceAt(x, z)` answers
the question they actually need: the height of the sea bed *or the top of
whatever is standing on it*. It is backed by a 1.5m obstacle field stamped as
the props are scattered, rebuilt whole whenever the reef chunk set changes
(props near a chunk edge stamp cells on both sides, and unpicking one chunk's
contribution from a shared maximum costs more than the rebuild). One lookup per
fish per frame, about 0.05ms for the lot.

The swimmer gets the sharper version of the same problem. `heightAt` is the
sea bed, so clamping to it stops you sinking through the sand — but the props
stand *on* that floor, and a height field is too blunt for something you are
steering yourself. `Terrain.collideReef()` treats each solid prop as a vertical
cylinder and resolves overlaps along the **axis of least penetration**: barely
under the lip of a boulder and you are lifted onto it, well into its flank and
you are pushed out sideways. Resolving always-sideways flings anyone who swims
down onto a wide coral head clear across the reef; always-up lets you climb a
barrel sponge like a ladder. Props are bucketed 4m to a cell — wider than the
biggest prop plus a body, so a 3×3 lookup sees everything that could reach you
and nothing is bucketed twice. About 0.0001ms a frame.

Soft props are not solid. A sea fan, an anemone and a clump of seagrass bend in
the surge, so they bend around you too; it is the same `soft` column in the
`REEF` table that drives the sway shader.

The two radii come from one measurement pulling opposite ways: the fish field
pads it (nothing should end up inside a rock) and player collision shrinks it
(a bounding box round a lumpy boulder is mostly empty at the corners, and being
stopped by that is an invisible wall).

**The bodies** are built by `tools/build_fish.py` from each species' real
proportions: superellipse sections (a tang is lens-shaped, a tuna a torpedo),
fins made of rays with membrane between them, notched webbing on the spiny
dorsals, sickle fins on the tuna and mackerel, and pelvic fins.

**The skin** is textured, to the standard the dinosaurs set: they are
textured models with a 2048² colour map and a normal map, and next to them
flat vertex colour looked like plastic. Each species now carries the same two
maps, in a 1024² atlas painted by `tools/fish_textures.py`:

- **scales** that overlap the way real ones do — each lies over the front of
  the one behind, is raised toward its free edge and throws a shadow where it
  tucks under — sized per species (a tuna's tiny, a chromis's large), each a
  slightly different shade, fading to bare skin over the head;
- the species' **pattern**: counter-shading, the grouper's round blue spots,
  the peacock flounder's blue rings, the barracuda's bars, the tuna's gold
  stripe, the blue tang's palette, the porgy's brown face;
- **mottle and grain**, so no flank is one flat colour, and the **lateral
  line** as a row of pores — the mackerel's dropping sharply under its second
  dorsal, as a king mackerel's does;
- **fins** with rays that are segmented and fork toward the edge, over a
  lighter membrane, and black tips where the species has them;
- a shark's **denticle** grain and pale flank band; a humpback's wrinkles,
  throat grooves, scars, barnacles and blotched white belly.

The normal map carries the relief — scales, rays, grooves — so the fish catch
the light underwater instead of reading as smooth. The yellow tang, chromis
and wrasse are painted in greyscale and take a per-instance tint; everything
else is painted in its own colours. Meshes are about twice as dense as before
(1,000–2,000 vertices a species), lighter for the small shoaling fish that are
drawn by the hundred; all the fish together are about 460k triangles, and the
model file is 4.4 MB — about the size of one dinosaur.

**The faces** are each species' own, from the species descriptions (sources
below). The head is shaped per fish — the front of it dropped or raised, the
crown flattened, a shark's snout flattened — and then the face is laid on it:
mouth line (its size, position and tilt), lips, jaw, teeth, nostrils, gill
cover and preopercle, eyes (size, height, shape, pupil) and markings.

| Fish | Face |
|---|---|
| Yellow tang | steep head, eyes set high, a long snout concave above and below, a small down-turned mouth |
| Blue tang | a pointed but shorter snout, a small mouth low on the head, eyes high; the black palette starts at the eye |
| Chromis | short snout, a big eye, a small, slightly upturned mouth |
| Wrasse | pointed snout, thick lips, canines jutting at the front of the jaws |
| Silverside | a head wider than the body, a huge eye (twice the snout), a small oblique mouth |
| Red snapper | a triangular head, a large mouth reaching under the front of its red eye, canines |
| Porgy | a long sloping snout, a large mouth with thick lips and a heavy lower jaw, orange at the corner; a brown face with a blue line under the eye and pale stripes below it |
| Flounder | both eyes on the upper side, widely spaced and raised on short stalks; a small mouth ending under the lower eye |
| King mackerel | a pointed snout shorter than the rest of the head, a large mouth with knife-like teeth |
| Yellowfin tuna | a conical snout, a small eye, a small mouth ending well before it |
| Great barracuda | a long pike-like head, flat on top; the lower jaw jutting past the upper; fangs of unequal size |
| Grouper | flat between the eyes, a huge mouth running back past the eye, a protruding lower jaw, thick lips, a rounded preopercle |
| Mahi-mahi | a bull: the tall, flat forehead of the male, a small eye set low near the mouth |
| Blacktip reef shark | a short, broadly rounded snout; oval eyes with slit pupils; nostrils under the snout with their nipple-shaped flaps; an arched, down-turned mouth with serrated teeth; five gill slits |
| Humpback whale | (the procedural fallback; the game's whale is now a textured model, below) tubercles — golf-ball knobs — along the rostrum and on the jaw, twin blowholes behind a raised splashguard, a long arching mouth line with the eye just past its corner, throat pleats |

The blacktip is the exception to "built from scratch": its body is a
textured model of the real species ("Blacktip Reef Shark" by Lais.Marques,
CC BY 4.0 — see CREDITS.md) — slim, the short rounded snout, the author's
black tips, pale flank band and slit-pupilled eyes — converted by
`tools/build_shark.py` into one mesh with one texture atlas, given a normal
map, and swum by the same shader as everything else. The procedural blacktip
in `reef_fish.glb` is its fallback. The great white is the same kind of
import ("Shark" by AndrejKrebs, CC BY 4.0), kept in its own slate-and-white
colours and teeth, converted by `tools/build_great_white.py`. So is the
humpback whale ("Game-ready Humpback Whale" by Allie2k, CC BY 4.0): the long
white-edged flippers, tubercles, throat pleats and knobbly dorsal hump are the
author's, converted by `tools/build_whale.py` — flippers and flukes tagged for
the swim shader from the shape (it has no rig), the eyes darkened, and its
normal map flipped from DirectX's convention to glTF's. The procedural whale
in `reef_fish.glb` is its fallback.

The blue tang and the silverside used to borrow the yellow tang's and the
chromis's bodies; each now has its own, because the faces and shapes are too
different to share.

Sources for the faces: yellow tang ([FishBase](https://www.fishbase.se/summary/zebrasoma-flavescens),
[Smithsonian](https://biogeodb.stri.si.edu/caribbean/en/thefishes/species/5690));
blue tang ([Australian Museum](https://australian.museum/learn/animals/fishes/blue-tang-paracanthurus-hepatus/),
[Reef Life Survey](https://reeflifesurvey.com/species/paracanthurus-hepatus/));
chromis ([FishBase](https://fishbase.se/summary/5679)); wrasse
([Smithsonian](https://biogeodb.stri.si.edu/caribbean/en/thefishes/species/3906));
silverside ([Smithsonian](https://biogeodb.stri.si.edu/sftep/en/thefishes/species/804),
[FishBase](https://www.fishbase.se/summary/Atherinomorus-stipes)); red snapper
([Florida Museum](https://www.floridamuseum.ufl.edu/discover-fish/species-profiles/lutjanus-campechanus/),
[Smithsonian](https://biogeodb.stri.si.edu/caribbean/en/thefishes/species/3686));
porgy ([Smithsonian](https://biogeodb.stri.si.edu/caribbean/en/thefishes/species/3743),
[Wikipedia](https://en.wikipedia.org/wiki/Jolthead_porgy)); flounder
([Smithsonian](https://biogeodb.stri.si.edu/caribbean/en/thefishes/species/4313),
[Animal Diversity Web](https://animaldiversity.org/accounts/Bothus_lunatus/));
king mackerel ([Smithsonian](https://biogeodb.stri.si.edu/caribbean/en/thefishes/species/4261),
[SC DNR](https://www.dnr.sc.gov/swap/supplemental/marine/kingmackerel2015.pdf));
yellowfin tuna ([NCFishes](https://ncfishes.com/marine-fishes-of-north-carolina/thunnus-albacares/));
barracuda ([Animal Diversity Web](https://animaldiversity.org/accounts/Sphyraena_barracuda/),
[Wikipedia](https://en.wikipedia.org/wiki/Great_barracuda)); grouper
([Wikipedia](https://en.wikipedia.org/wiki/Coral_grouper),
[FishBase](https://www.fishbase.se/summary/Cephalopholis-miniata.html));
mahi-mahi ([Wikipedia](https://en.wikipedia.org/wiki/Mahi-mahi)); blacktip reef
shark ([Shark Research Institute](https://www.sharks.org/blacktip-reef-shark-carcharhinus-melanopterus),
[Aquarium of the Pacific](https://www.aquariumofpacific.org/onlinelearningcenter/species/blacktip_reef_shark));
humpback ([Marine Mammal Center](https://www.marinemammalcenter.org/animal-care/learn-about-marine-mammals/cetaceans/humpback-whale),
[Whale Watch Western Australia](https://whalewatchwesternaustralia.com/humpback-whale-tubercles/)).

**The material** (`src/swim.js`) takes those maps and adds a silvery
flash on a flank turned edge-on (strongest on silversides, mackerel and tuna);
glassy eyes; and fins that glow faintly, as thin fins do with light behind
them. (Without the model file, the fallback body gets procedural scales from
the shader instead.)

**The swim.** Nothing is skinned. Every vertex is tagged with the part of the
fish it belongs to, and the vertex shader moves each part its own way: the
body with a travelling wave and a C-curve into turns, the tail lagging it so
it flicks, the dorsal and anal fins rippling, the pectorals rowing or — for a
shark, a tuna or the whale — lifting like wings. Each species has its own
style (`STYLES` in `swim.js`), close to the real one:

| Swims like | Who |
|---|---|
| thunniform: a rigid body, a narrow tail beating fast | tuna, and mackerel nearly |
| labriform: rowing with the pectorals, body kept still | wrasse, tangs, chromis when hovering |
| burst and coast: a few strokes, then a glide | barracuda, grouper, snapper, porgy, tangs |
| the whole body sweeping, head included | blacktip shark |
| an up-and-down wave, fins rippling round the edge | flounder |
| slow up-and-down flukes | whale |

The stroke follows what the fish is doing: it beats faster and wider as it
speeds up, a bigger fish of the same species beats slower, it bends into its
turns and banks slightly, it glides between bursts, and it sculls with its
fins to hold station. Big fish accelerate and turn wide; small ones dart.

**Reactions** are per species (`react` in `SPECIES`, `SENSE` for the
distances): come within about 2.5 m of a shoal and one fish snaps into a
C-start and bolts, and the fright ripples through the rest, each fish a beat
after its neighbour; the shoal moves off and regroups. Chromis drop into the
coral instead. A flounder shoots off along the bottom and settles again. A
barracuda turns to watch you and only backs off when you are close; a grouper
backs away toward its hole, still facing you; the shark keeps its line and
swerves at arm's length. A spear through the water frightens what it passes
(after each fish's reaction time, so the one it was aimed at is hit first), so
does a missed thrust, and so does taking a fish out of its shoal. With a
couple of seconds between throws, spear hit rates are the same as before any
of this — measured; a quick second throw into a school you have just scared
is harder.

**Caught.** A speared fish struggles on the spear in bursts that weaken over
about ten seconds and stop. A hooked one fights as it pulls (see Fishing): it
swims away on its runs, hangs off the line nose-away when resting, is towed in
head-first and twisting when you reel against it, turns its flank to the line
if it is a tang, circles if it is a spent tuna, arcs through its jumps — a
mahi twisting as it goes — and sharks, barracuda and a grouper heading for its
hole shake their heads. Swung out of the water it thrashes on the line, and a
big one landed on the deck flops.

**Where each one lives**, and how it behaves there, follows the real fish:

| Fish | Where | How |
|---|---|---|
| Red snapper | a few metres over the reef | small schools around structure |
| Porgy | low over the reef | in ones and twos, picking at the bottom |
| Flounder | on the open sand, between colonies | lies flat and still, camouflaged; bolts along the bottom if you get close |
| Mackerel | mid-water | a fast school |
| Barracuda | 3-6 m over a coral head | hangs almost motionless; turns to watch you rather than moving off |
| Grouper | just off the bottom | solitary, stays by its hole, and backs into it if you come close |
| Blacktip reef shark | over the reef | a slow, wide patrol; does not get out of your way |
| Mahi-mahi | under the raft, near the surface | circles it — dorado gather under anything floating |
| Yellowfin tuna | past the drop-off | a fast school over deep water |
| Great white shark | past the drop-off, rarely | a lone 4 m patroller over deep water; comes over to circle you at about six metres, and cannot be caught — like the whale, it is there to be seen |

Anything longer than 80 cm (`BIG` in `fish.js`) will not go on a spear: the
throw and the thrust pass through it, and looking at one underwater says it is
one for a baited line.

### What is in your hand

The hotbar has always decided what a click does, but until `src/viewmodel.js`
nothing was drawn — the only way to tell a hammer from a spear was the slot
number. Now the selected item is held in your hand, lowers and raises
when you swap, bobs as you move, lags a little behind the look, and plays a
motion on click: an overhead strike for the hammer, a thrust for the spear, a
back-swing and flick for the rod, a fling for the hook and the coconut raised
to your mouth.

Materials have bodies too, so a slot holding one shows what it is: an armful of
split wood, a sawn plank, a coil of cord, a palm frond, a bent sheet of rusted
scrap.

**Every fish is its own item.** What you catch goes in the bag as that species —
a red snapper stays a red snapper, a blue tang a blue tang — so the pack lists
each kind with its own count, and one you take out is the one you caught: its
own body, face and colours, held up by the tail. Fish share one hotbar slot
rather than filling all five: a catch goes into the fish slot (the one in hand
if you are holding a fish), so what you just caught is what you hold next, and
when you eat or bait the last of one kind the slot moves on to another you
carry. Register a particular species to a slot from the pack (`I`) to keep it
there. Saves from before this carried one count of "raw fish"; those come back
as the small reef fish they most likely were.

The spear is carried **low at the right, point forward** — along the right-hand
side of the view, not across it — and right-click throws it. `src/spear.js` takes
it from there: it flies as a ballistic dart, point first, and sticks in the
beach, the sea bed, the top of a coral head, or the deck (where it rides the
swell with the raft).

**It skewers fish.** Each frame the stretch the point covered is tested against
the schools — the segment, not the point, because at 20 m/s it moves further
in a frame than a chromis is long. A fish it passes through is taken out of the
water and hung on the shaft through its flanks, and the spear carries on,
slower; a throw through a tight shoal can come back with more than one. Pull
the spear out with `E` and the fish come with it, each as its own species. A thrust does the
same at arm's length — the fish shows on the point of the spear in your hand
for a moment, then goes in the bag.

Two things make aimed throws land, and both are tuned against measurements
rather than feel. A fish under the crosshair is a target, and the throw leads
it — aims where it will be when the point gets there — which is soft aim assist
and deliberately tight (within ~10° of the crosshair). And fish scatter from
anything within 3.2 m, so an underwater throw stays fast enough to skewer out
to ~3.7 m; from the deck a spear stays deadly for 6-7 m of water. Measured:
11 of 12 aimed throws hit. A speared fish is replaced in its school after 45
seconds, and never while you are near enough to see it appear. In water it is a stick of wood — drag stops it within
about three metres and it floats back up, so a spear thrown out over the basin
is never lost at the bottom. Throwing takes it out of your inventory until you
walk up to it and press `E`; if you have another, the next one is drawn up into
your hand. A thrown spear is counted as carried when the game saves, so a
reload never costs you one.

It is drawn as **a second pass over the finished frame**, into its own scene,
after clearing depth. A 1.75 m spear held at the hip would otherwise push
through the deck, the walls and every coral head you swim past. Its lights are
copied from the world each frame after `underwater.js` has dimmed them, so the
tool goes dark and blue at depth with everything else, plus a small fill of its
own so a dark stone head at midnight is still recognisably what you selected.

The hammer, spear and rod are third-party models (CC BY 4.0, credited in
`CREDITS.md`), prepared by `tools/build_tools.py` into one frame — standing
along +Y, working end up, origin at the grip — so the pose table only has to say
where the hand is. Everything held also has a procedural body in that same
frame: what you see before the `.glb` arrives, forever if it never does, and
always for the hook and the coconut, which have no model.

### Fishing

The rod is the patient way to eat, where the spear is the active one. It plays
in four parts.

**The swing.** Hold the button and the rod draws back over your shoulder while
a meter fills — and then empties again, so the skill is letting go at the top.
Power sets the distance, 4-26 m, in the direction you are facing.

**The wait.** The float rides the swell. A nibble or two may twitch it first;
strike on one and you pull the hook out of its mouth. Then the float is dragged
under and you have about a second to click and set the hook.

**The fight.** Hold to reel, let go to give line, and watch three meters:

- **Tension.** Reeling raises it, and the fish pulling raises it more — both at
  once is how a line breaks. Past the red mark it strains, and a line kept
  there snaps.
- **Line.** Reeling takes it in, slowly while the fish pulls and quickly while
  it rests. A running fish takes line out while you give it slack, and one that
  takes all 60 m is gone. Leave the line slack too long and the fish throws
  the hook.
- **Fight.** The fish's stamina. It tires fastest pulling against a tight line,
  so the way to land a big one is to let it run, take line back while it
  rests, and keep it from ever quite resting.

**You are not told what it is.** Nothing names the fish until it is on the
deck — the strike just says *Fish on!*, the meters say *Something on the line*,
and one that gets away stays a mystery. What you have to go on is how it
fights, which is different for every species:

**Every species fights to its own body** (`FIGHTERS` in `src/fight.js`):

| Fish | How it fights |
|---|---|
| Silverside | tiny and frantic — darting bursts, and it leaps. Cannot break a line, but can shake a loose one |
| Chromis | bolts straight down for the coral |
| Wrasse | slim and quick — sudden jerks that shock-load the line |
| Tang, blue tang | turns its disc of a body side-on and planes against you in long steady pulls, leaning on the line even at rest |
| Red snapper | a hard first surge for the bottom, then shorter ones. Reel against one mid-surge and the line goes |
| Porgy | short, stubborn dives for the bottom |
| Flounder | flat and heavy — it lies flat against the pull more than it runs; long rests |
| Mackerel | a blistering first run, and it jumps |
| Barracuda | explosive runs and leaps, and shakes its head hard enough to shock-load the line |
| Grouper | bolts for its hole the moment it is hooked. Let it get there and the line parts on the rock: you have to turn it early, then it gives up quickly |
| Mahi-mahi | acrobatic — jumping, tail-walking, changing direction |
| Yellowfin tuna | runs long and deep, then circles down below you. Not violent, just endless: the longest fight in the game |
| Blacktip reef shark | long, heavy runs and it does not tire quickly |

The fight is pure maths with no rendering in it, which is what let it be tuned
by simulation rather than by feel — `node tools/simulate_fight.mjs` plays 400
fights per species, by six kinds of player with a human reaction delay.
Measured, per player, the share landed:

| | silver | chromis | wrasse | tangs | snapper | porgy | flounder | mackerel | barracuda | grouper | mahi | tuna | blacktip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| skilled (eases off early, turns a grouper) | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| typical (slower, lets it go at 0.85) | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 55% | 100% | 100% | 100% | 100% |
| casual (sloppier still) | 100% | 100% | 96% | 100% | 100% | 81% | 100% | 25% | 0% | 0% | 65% | 0% | 0% |
| just holds the button | 100% | 63% | 14% | 1-23% | 0% | 0% | 100% | 6% | 0% | 0% | 1% | 0% | 0% |
| never reels | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0%* | 0% | 0% | 0% |

\* a grouper that is never reeled against gets back into the rocks 99% of the time.

So the small fish forgive anything, the big ones need you to watch the
tension, and the barracuda needs you to watch it closely. A skilled fight
takes 8 s for a flounder, about 20 s for a grouper, 28 s for a blacktip and
40 s for a tuna.

Size counts: a fish bigger than its species' usual pulls harder (strength
goes with size^0.8) and lasts longer (stamina with size^0.4). Running fish
change direction mid-run, a darting wrasse all the time and a tuna hardly at
all (`TURNS` in `fight.js`) — that only moves where the fish is drawn, so the
numbers above are unchanged by it. How the hooked fish looks while it does
all this is under **Caught**, above.

**What bites** depends on the water under the float, and on the hook:

| | Bare hook | Baited with a fish |
|---|---|---|
| Over the reef | chromis, wrasse, porgy, red snapper, the odd tang | grouper, barracuda, red snapper, blacktip, now and then a mackerel or a tuna |
| Over the sand | red snapper, porgy, silversides, flounder, mackerel | mackerel, barracuda, flounder, blacktip, red snapper, sometimes a tuna |
| Past the drop-off | silversides, mackerel, red snapper | yellowfin tuna, mahi-mahi, mackerel, blacktip |
| Near the raft | — | mahi-mahi, on top of whichever of the above |

Right-click with the rod to bait the hook: it takes one fish, the smallest you have. A predator
does not peck at a bait the way a small fish nibbles a bare hook — there are
fewer nibbles, and you wait longer, because big fish are rarer. Miss the bite
and it usually steals the bait. Whatever takes it, the bait is gone. What a
catch is worth — how many of that fish go in the bag — goes with the size of it: one for a reef fish, two
for a snapper, porgy or flounder, three for a mackerel, up to eight for a
tuna. A big catch cannot be swung up on the rod, so it is hauled over the
side onto the deck beside you. A rod fish comes up from water you cannot see
into, so it is not one of the visible schools, and fishing never empties a
shoal.

**Research.** The habitats and fights come from what anglers, divers and
biologists say about each fish — for example: red snapper ([Great Days
Outdoors](https://greatdaysoutdoors.com/red-snapper-fishing/)), jolthead porgy
([Guidesly](https://guidesly.com/fishing/fish-species/jolthead-porgy)),
peacock flounder ([Animal Diversity
Web](https://animaldiversity.org/accounts/Bothus_lunatus/)), king mackerel
([Wikipedia](https://en.wikipedia.org/wiki/King_mackerel)), great barracuda
([The Tackle Room](https://thetackleroom.com/blogs/news/barracuda-fishing-guide)),
grouper ([How to Catch Any Fish](https://www.howtocatchanyfish.com/groupers)),
mahi-mahi ([AFTCO](https://www.aftco.com/blogs/species-spotlight/species-spotlight-mahi-mahi)),
yellowfin tuna ([Wide Open
Spaces](https://www.wideopenspaces.com/yellowfin-tuna-fishing-and-profile/)),
blacktip reef shark
([SeaWorld](https://seaworld.org/animals/facts/cartilaginous-fish/blacktip-reef-shark/))
and humpback whale ([CRRU](https://crru.org.uk/education/species/humpback-whale)).
The game compresses all of it — real fights last longer and real tuna do not
come this close to a reef — but the order of things is theirs.

### Where you come to, and where you wake

A new game starts you somewhere on the edge of the world, never inland
(`src/spawn.js`): washed up on a beach with nothing, treading water in the
open sea, clinging to a single square of wreckage, or on the little raft of
four pallets. Wherever it was is your starting point. From a beach or the sea,
the first foundation is laid on the water wherever you aim the hammer — deep
enough to float it — and the raft grows from there.

**A raft is made of whatever floats.** There are four foundations, and one
raft can mix them square by square (`src/raft.js`, `src/items.js`):

| Foundation | Cost | What it is |
|---|---|---|
| **Plank** | 2 planks | planks over three float logs — the raft you may start on |
| **Bamboo** | 4 bamboo, 1 rope | fifteen poles lashed side by side, two cross-poles on top, four thick canes under it |
| **Log** | 4 wood, 1 rope | driftwood and palm trunks side by side, two bars lashed across them |
| **Barrel** | 2 scrap, 1 plank | a deck of seven boards on two stringers, lashed down onto two barrels |

They look like what they are made of and handle the same. Poles and logs
run the length of a square, and where one square's meet the next is set per
row by the boundary between them, so both sides agree: the joints are
staggered like a real raft's and the ends at its edges are ragged. Bamboo
comes from the **bamboo groves** along the river banks (E harvests 4) and from
**bundles of it adrift** (2).

**Statues are respawn points, nothing more.** Two dozen stand here and there
over the land — on beaches, in the forest, up on the hills, well apart —
carved long ago. **E** at one makes it where you wake: die, and you come to
beside it; registering at another replaces it. They unlock nothing and you
need none to get on: the game is surviving, exploring, gathering and
building, and a statue just saves you the trip back. Any statue can be lifted (**X**) and carried,
and a click sets it down again: on open ground, or on a free square of the
raft's deck, where it is lashed down and sails with you — register at that one
and you wake aboard, wherever the raft has got to. You can carve your own,
too (6 wood, 2 rope, 3 palm). Without one — or if yours has been lifted — you
wake at your starting point. Yours wears a garland, on your screen. Statues are the world's: playing together, everyone sees the
host's, and yours wait at home with your raft. The game keeps where you are,
too: on the deck, ashore, or in the water where you left off.

### Paddling and sailing

The raft goes where you take it. Craft a **paddle** (2 plank, 1 rope), hold it
on the deck, and hold click to stroke: each stroke pushes the raft the way you
face, and the water slows it again over some seconds. Right-click back-paddles.
Where you stand matters — a stroke from the middle drives it straight, one
from a side turns it away from that side — so to turn, paddle from the edge.
A bigger raft is slower to get going and slower to turn. Playing together,
everyone paddling pushes the same raft.

Build a **sail** on a square of deck (4 plank, 3 rope, 6 palm) and **E**
raises it: the wind fills it and takes the raft downwind, and you steer with
the paddle. The wind swings round slowly through the day and freshens and
falls away; the sail turns to it, and more sails push harder (less than as
much again each). **E** furls it.

Run into water shallower than the raft's draught and it grounds where it
touched — paddle it back off. Whoever is standing on the deck goes with it,
turning as it turns. The flotsam, the fish that shelter under it and the whale
all follow the raft wherever it has got to, and it is saved where you left it.

### Playing together

Co-op by invite link. On the splash screen, under *Play together*, give a
name and **Host a game**: you get a five-letter room code and an invite link
to send. Whoever opens the link (or types the code and **Join**s) is in your
game — up to six of you. The crew is listed under the clock.

**Enter** opens a line to say something: it goes in everyone's log and in a
speech bubble over your head; Enter sends it, Esc thinks better of it. If
your connection drops, the game reconnects on its own — you stay on the
shared raft, in the shared world, and the others see that you lost the
connection and then that you are back; after 45 seconds of trying, you are
back on your own raft. Closing the page or pressing **Leave** is leaving, and
the others see you have gone. A game you were in lately has a **Rejoin**
button on the splash screen.

Look at someone close by and **E** hands them one of what you are holding.
Nothing tells you where anyone is. The crew list gives each of the others'
distance from you — how far, never which way — a name fades beyond
forty-odd metres, and behind a hill there is no telling
anyone is there — finding each other is looking for each other. You see the others' lines out too — the
rod's float, the hook on its rope — a fish on the spear they thrust with, the
spears they threw before you joined, and the dinosaurs' kills wherever you are.

You see each other as you are: where you stand or swim, which way you face,
walking, running, jumping, treading water, woman or man, what is in your
hand, and each thrust, throw, strike and swing — the same body and motion
you see of yourself in third person (`src/body.js`), with a name over it.

How: a small relay (`server/` — a Cloudflare Worker, one Durable Object per
room) keeps the players of a room connected and passes their messages on;
it does not run the game. Every browser runs its own game, sends where its
player is about twelve times a second, and draws the others from what it
hears, a tenth of a second behind so their movement can be smoothed. The
world is the same for all of you without being sent — the land, reef and
forest are built from the same code everywhere, and the raft sits at the
same place.

**A lasting world.** A room is a world of its own, and it lasts: the relay
keeps it when everyone has gone — its rafts, its statues, the time of day —
and keeps each player's record in it: what you carry, how you are, your start
and your statue, and where you were. Hosting a new room starts a fresh world.
Joining one, you come back as you left: aboard your raft, wherever it has
sailed since, or ashore or in the sea where you were. New to it, you come to
somewhere on its edge like any castaway — apart from everyone else, to find
them. Your own game waits at home, untouched, and is yours again when you
leave.

**Rafts, any number.** Anyone can build a raft — lay a first foundation on
the water away from any raft — and anyone can board, build on and paddle any
raft. The first player in is the **host**, whose game runs the world and whose
copy of every raft counts. On the shared
raft, anyone can build, salvage, drink from a collector, feed or light a fire,
and hang fish on it or take them off, and the others see it happen. What you
build costs your own materials, and whatever you salvage is yours — its
materials come to you, whoever built it (and a fire's fish come with it).
Cooked fish, likewise, go to whoever takes them off the fire. But a statue
someone wakes at cannot be lifted or taken apart from under them
(`src/together.js`, `src/main.js`).

Each change goes to the others as it happens. The host's raft settles
anything contested: shortly after each change, and every twenty seconds
regardless, the host sends it whole and the others' copies are brought into
line with it — so fires burning down and collectors filling at slightly
different rates on each machine never leave you on different rafts. Two of
you at one thing at once is the host's to settle too: two people building
on one spot get one piece, and whoever lost is paid back; two hooks on one
crate, or two hands at one fire, get one crate and one lot of fish, and
whoever was slower is told so. If the host leaves, the next player in takes
over — everyone is told who — and the raft goes on.

One sea, too. Every machine's waves come from how long it has been running,
so on its own each would have a different swell — the raft riding it
differently, a swimmer on a different wave. Playing together, everyone's sea
keeps the time of whoever's is furthest on (a clock behind is eased or
jumped forward, never back). And heights are sent from what they stand on —
above the deck on the raft, above the sea in the water — so whatever small
difference is left, the others stand on your deck and swim in your sea.

**One world.** The rest of it is the host's as well (`src/sharedworld.js`):
the time of day, what floats past, where the fish schools are, the whale and
the dinosaurs. The host's game runs them as it would alone and tells the
others how they stand three times a second; the others' games take that on
and carry it forward. The dinosaurs are the host's alone — a guest's are
drawn where the host says — so they hunt whichever of you is on land, and a
bite on a guest is sent to that guest. The flotsam, the whale and the
schools go on moving everywhere and are eased back onto the host's; each
school's fish are every machine's own, swimming round it and shying from
whoever is nearest, and a fish someone catches is gone for everyone. What
someone gathers is gone for everyone too. A thrown spear flies on every
screen and lands in the same place; what it skewers, the thrower's game
says. Your own time of day waits with your raft.

On this machine, run the relay with `node server/dev-relay.mjs` and the game
finds it. For the published game, deploy the relay to Cloudflare (free) and
put its address in `src/net.js` — `server/README.md` has the steps.

### Seeing yourself

`V` changes the view. **First person** is as it always was. **Third person**
puts the camera behind you and over your right shoulder, looking where you
look; **second person** puts it in front of you, looking back at your face.
Outside first person the camera is pulled in short of walls, the roof, the
ground and the sea bed, so it never shows the inside of a plank.

Play works from your eyes, not the camera: the player moves an invisible
*eye* (`this.eye` in `main.js`), and reach, aim, spear throws and what the
fish notice all work from it, while `src/camera.js` puts the camera somewhere
relative to it. So nothing about playing changes with the view — only what
you see. Underwater colour follows the camera, since that is what is seen.

You are a **woman or a man** (the splash screen's *Play as*): Ready Player
Me characters, dressed as cave people are drawn — leopard hide over one
shoulder, a ragged hem, bare arms and legs, bare feet — and
rigged but never animated. `src/body.js` animates them itself —
a stride that lengthens and quickens with speed, a lean into a run, knees up
in a jump, treading water upright and a crawl, prone, when swimming
somewhere, the head following where you look — and each use of what is in
hand its own motion. A **thrust** lowers the spear to point where you look,
draws the arm back to the hip and drives it forward from the chest, leaning
into it with the free arm swinging back for balance, on the same timing as
the first-person thrust, and a fish it catches
shows on the point. A **throw** is a javelin throw at head height: the hand
drawn back beside the head, the spear level and pointing where you look, the
free arm aimed at the target; then the arm snaps out level in front and the
spear leaves the hand there, straight ahead (0.27 s in) — from the hand you can see, aimed at what the crosshair
is on (third person aims along the camera's line, since the crosshair is its
centre; second person along your own). The hammer strikes overhead, eating
brings the hand to the mouth, the hook is tossed underarm. Whatever is in hand is held in the right hand: its fingers curl into a
fist round a tool, the shaft running through it from the little finger to the
index the way a real grip does, and cup round anything else — a coconut, a
fish. A rod's line hangs from the rod you can see. Without a character's file the same motion drives a
mannequin built in code. The characters are **CC BY-NC-SA** — non-commercial
(see `CREDITS.md`).

### Fire and cooking

A campfire is built with the hammer (3 Wood, 1 Scrap) and comes **unlit**,
with its first wood laid. Fire has to be made: craft a **bow drill** (1 Plank,
1 Rope — a bow with its cord round a spindle), hold it at the fire and hold
the button. The bow saws back and forth, the spindle spins, and after five
seconds of it an ember drops into a pinch of palm fibre — 1 **Palm**, the
tinder — and the fire is lit. Stop sawing and the ember cools again.

It burns its wood. What it was built with lasts five minutes; each Wood fed
to it (`E`) adds two, up to ten; as it runs low it shrinks to embers, and
when it is out the wood is ash and it needs wood laying and lighting again.
Friction fire is the oldest method you could manage on a raft — wood and
cord, both off the flotsam. Striking a spark takes flint and pyrite, which
only the land has; that is left for later.

**Cooking.** Hold a raw fish at a lit fire and press `E`: it is hung by the
tail from a spit over the flames, three at a time, and browns as it cooks.
After fourteen seconds it is done — `E` takes it off as a **cooked** fish of
the same species ("Cooked red snapper"), into the fish slot. Cooked fish fills
you up half again as much as raw (36 against 22) and, unlike raw, costs no
water. A fire that goes out stops cooking whatever is on it, and a fish left
on the spit when you leave goes in the bag — raw, or cooked if it was done.
`Q` eats cooked fish before raw.

**How it looks** (`src/fire.js`) is built in code, with two Sketchfab pieces
as reference only — neither is in the game: the stones and the teepee after
"Stylized Campfire" by AndresX (CC BY-ND, so not something to cut up and
ship), the flame and sparks after "Fire animated" by lampyre3d. Nine rounded
stones ring a teepee of seven tapered sticks and two split logs over a bed
of coals. The flame is two camera-facing billboards drawn by a shader — a
teardrop of fire eaten away from the top by rising noise, white-yellow at the
heart through orange to red — so it licks and billows from any side, and
sparks rise off it on short lives. The wood chars black from the heart
outward as its fuel goes, glows orange there while it burns, and is ash when
it is out.

Saves from before fires had to be lit keep theirs burning, with a full load
of wood. The numbers are `FIRE` in `items.js`.

### The whale

One humpback (`src/whale.js`), about 12 m long, keeps to a ring 50-110 m out
from the raft — in deep water only. The beach is ~80 m away on one side, so
it picks goals where the bed is at least 15 m down with deep water all the
way there, looks 40 m ahead as it swims, and swings off anything shallower
than 12.5 m; it is never lifted out of the water, whatever is under it. It
cruises at 9 m, and every minute or so comes up and blows
three to five times, a dozen seconds apart — a bushy spout about 4 m tall —
then arches over and sounds, the flukes coming up clear of the water as it
goes down. It is scenery, not a catch: nothing on a raft lands forty tonnes.
Its body is `whale_humpback.glb` (see *The faces* above), and it uses the same
swim shader as the fish, bending up and down: the flukes beat, and the long
flippers lift and droop slowly.

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
A kill falls where it was made and lies there for half a minute, the hunter
feeding at it, before the carcass is gone.

### How they move

Most of what made the animals look wrong was the feet. A walk or run clip is
authored in place, the feet sweeping back under a body that stays put; played
at a fixed rate on an animal going some other speed, the feet skate — the
raptors' by three times over at a chase, the sauropods' treading in place.
So `models.js` measures each clip once, when a model loads: how fast a
planted foot travels back, which is the speed the clip means the body to go
at this animal's size. `driveGait()` then plays the animal at the speed it is
really going — walk or run by speed (with hysteresis, and sooner when it is
hunting or fleeing), the clip's rate matched to it, and where the clip's own
stride is too short, the stride lengthened by swinging the hips (and the
shoulders, on the four-legged ones) further about their average pose. Walk
and run hand over mid-step, the legs keeping their phase.

The rest is in `wildlife.js`:

- **Turning has momentum.** It builds and eases off, is wider the faster the
  animal goes, and slows it into a sharp turn; a big animal walks round rather
  than spinning on the spot.
- **Speed is eased**, by how heavy the animal is: a sauropod takes seconds to
  get going, a raptor a stride. Each animal has a pace of its own, so a herd
  does not march in step, and a hunter closes the last few metres at a walk
  instead of backing off.
- **It looks ahead** a few times a second along the way it means to go and a
  few ways either side, and takes the best: clear of trunks and rocks, off
  ground too steep to stand on, out of the sea. Anything the look-ahead misses,
  it is pushed out of, as you are.
- **It stands on the ground as a body does**: pitched to the slope between its
  fore and hind feet, rolled a little across it, at their average height.
- **It stops**: grazers to feed, everything now and then to stand and look.

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
- Fish: the `SPECIES` table in `fish.js` — body, colour, zone, school count,
  size, and per species `hover`, `react`, `roam` and `bed` — plus `ZONES` for
  where each zone is, `SENSE` for how close you get before each kind of fish
  reacts, and `BIG` for what is too big to spear. How each species swims — its
  stroke, turning, gliding, fins, scales and sheen — is `STYLES` in `swim.js`.
  The whale: the constants at the top of `whale.js`.
- Reef shape: `SHELF_FLOOR`, `BASIN`, `SHELF_EDGE`, `REEF_HEIGHT` in
  `terrain.js`. Raising the shelf brings the coral into easier diving range.
- Reef make-up and density: the `REEF` table in `reef.js` (depth band, slope,
  reef-mask window, size and how much it sways), and `samples` in `buildReef`.
- How close fish will come to the reef: `BED_CLEARANCE` in `fish.js` and
  `REEF_CELL` (the obstacle field's resolution) in `terrain.js`.
- What the swimmer bumps into: the `soft < 0.5` test in `buildReef` decides
  which props are solid, and the `hit` radius beside it decides how wide they
  feel. `SOLID_CELL` is the collision bucket size.
- Water clarity and caustics: the fog curve and the `applyCaustics` shader in
  `underwater.js`.
- Continent shape and distance from the raft: `WORLD` in `terrain.js` (its
  centre is solved so the raft sits over the reef, ~80 m from the beach — move
  it along the same line if you change the size or the lobes).
- Relief: `MOUNTAIN_HEIGHT`, `TERRACE`, `SNOWLINE`, `TREELINE`,
  `LANDING_CLEAR` (how far from the raft the cliffs start) in `terrain.js`;
  the rivers are the `RIVERS` table beside them.
- Terrain cost: `VIEW_CHUNKS`, `LOD_SEGMENTS`, `TREE_RING`, `BUILD_BUDGET`.
- Forest make-up: `SPECIES` in `flora.js` — each species' `where(site)` rule,
  its size, how far out it is drawn (`rings`, `farFrom`) and its harvest —
  and `LAYERS` for the spacing of each scatter grid.
- Animals: the `SPECIES` table in `wildlife.js` — counts, `speed` (flat out),
  `walk` (its wandering pace), `accel`, `turn`, sight, damage,
  and the body proportions each one is built from.
- Underwater darkness: `DARK_DEPTH` in `underwater.js`.
- Diving budget: `SWIM_DOWN`, `SWIM_UP` and the breath drain in `player.js`.
  They are balanced together — ~18s of air, and a trip to 12m and back costs
  about 8s of it. Slowing the ascent without extending the air means drowning
  on the way up.
- Costs and yields: `RECIPES`, `BUILDABLES`, `DEBRIS_KINDS` in `items.js`.
- Fire: `FIRE` in `items.js` — how long it burns, per Wood, how long lighting
  and cooking take, and how many fish a spit holds.
- Slot count: `SLOTS` in `hotbar.js` (the HUD and the number keys both read it).
- How a tool is held: `POSES` in `viewmodel.js` — position and rotation in
  camera space. It is exported and read every frame, so it can be tuned live:
  `(await import('/src/viewmodel.js')).POSES.spear.rot[2] = 0.2` in the console.
  For a tool standing along +Y, `rot[2]` leans the tip in or out and `rot[0]`
  tips it away; `rot[1]` only spins it about its handle.
- How a click looks: `USES` in `viewmodel.js`, one duration and curve per
  action. The spear thrust is worked out from its carry pose and
  `THRUST_REACH`, which is also how far a thrust catches a fish — change one
  number and the animation and the catch move together.
- Fishing: `CAST_MIN` / `CAST_MAX` and `CHARGE_TIME` for the swing, `WAIT`
  and `NIBBLE_GAP` for patience, `BITE_WINDOW` for how quick you have to be,
  `BITES` for what bites where on a bare or a baited hook, `BAIT_WAIT` for how
  much rarer a big fish is, `LINE_MAX` for the reel and `YIELD` for what each
  catch is worth — in `fishing.js`. How hard each fish fights is `FIGHTERS` in
  `fight.js`, and the line itself is the constants above it. Change those,
  and re-run `node tools/simulate_fight.mjs` before trusting the feel: the
  fight is pure maths with no imports, so it runs outside the browser.
- How a spear throws: `AIR_SPEED`, `LOFT` and `GRAVITY` for range and arc,
  `WATER_SPEED` and `WATER_DRAG` for how far it gets underwater, and
  `STICK_SPEED` for how hard it has to hit to bite — all in `spear.js`. How
  big a target a fish is: the radius in `FishSchools.hitSegment()`. What eating
  does: `FOOD` in `items.js`.
- Look feel: `sensitivity`, and `EDGE_MARGIN` / `EDGE_RATE` for the edge turn,
  in `input.js`.
- What an item does in hand: its `action` and `hint` in `ITEMS`, plus the
  matching `case` in `Game.useHeld()`.
- Day length: `DAY_SECONDS` in `sky.js`.
- Performance: the ocean is ~180k triangles. Drop the segment count in
  `new THREE.PlaneGeometry(900, 900, 300, 300)` first.

## Where to go next

Each of these has a deliberate hook already in place:

- **Hunting on land** — the spear skewers fish but passes through animals.
  `Wildlife` already tracks health for its own kills; a hit test against it in
  `ThrownSpears.fly()`, like the one against fish, is most of the work.
- **More from the fire** — torches lit from it for the night and for going
  ashore; a water container to fill at a collector or a river; campfires on
  land (the build grid is the raft's); a spark kit of flint and pyrite from
  the rocks ashore, quicker than the bow drill.
- **Marine animals** — a shark that circles the raft and punishes swimming is
  the cheapest way to make the water feel dangerous, and would close off the
  "swim away from anything" escape. `Wildlife` already has the targeting.
- **Fighting back** — nothing on land can be killed by the player yet. The
  spear is craftable and holdable, and `Wildlife.pick()` already returns the
  animal under the crosshair; it needs damage and a death state for the player
  as attacker.
- **Building ashore** — the raft grid is anchored to the raft. Letting
  foundations sit on terrain would turn the continent into a second base.
- **Shipwrecks & ruins** — the scatter is the natural hook: a `landmark`
  species in `flora.js` with a rule for where it stands, as the rock spires do.
- **Storms** — `Sky` already centralises the palette, fog and light. A storm is
  a weather state that scales wave amplitudes and darkens that palette.
- **Larger construction** — the grid supports multiple storeys already
  (`ROOF_Y`); stairs and a second floor are new `kind`s in `BUILDABLES`.

## Credits

Rendering uses [three.js](https://threejs.org) r170 (MIT), vendored in
`vendor/` so the game runs with no install step and no network access. Every
texture, mesh and shader in the game itself is generated procedurally at load
time — there are no other third-party assets.
