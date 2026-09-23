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
island. Swim for it and you come ashore on a beach that climbs through conifer
forest to a bare mountain ridge. It is inhabited: sauropods and stegosaurs
browse the slopes, parasaur herds bolt at the first sign of trouble, raptors
hunt in the treeline and a pair of tyrannosaurs work the high ground. They hunt
*each other*, not just you — stand still long enough and you will hear a kill
somewhere in the trees.

Food comes from the sea two ways: a **spear** you throw or thrust, and a **rod**
you cast from the deck and strike with when the float goes under. Bait the
hook with a fish you have caught and the big ones come for it. Shipwrecks,
weather and cooking are deliberately left out — see *Where to go next* for
where each one plugs in.

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
| `E` | gather the debris you are looking at, drink from a collector, take back a thrown spear |
| `1`–`5`, wheel | pick a hotbar slot |
| Left-click | use whatever is in your hands |
| `I` | pack — register tools and items into the five slots |
| `Backspace` | (in the pack) empty the selected slot |
| `C` / `B` | crafting / take out the hammer |
| wheel, `[` `]` | with the hammer out: pick a build piece |
| Right-click | throw what is in hand — the spear, or the hook |
| `Q` | eat — a coconut if you have one, otherwise raw fish |
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
| Coconut, Raw fish | eat it |
| Spear | a thrust that skewers the fish on the crosshair; **right-click throws it** — pull it back out with `E` |
| Rod | **hold** to swing and let go to cast; click when the float goes under; then **hold to reel, let go to give line**. **Right-click** puts a raw fish on the hook as bait (right-click again takes it back off) |
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
| `src/fish.js` | The fish, in schools — glTF bodies, one instanced draw per species, and the swim done in the vertex shader. Fourteen species, ~220 fish, 14 draw calls. Where each lives (reef, sand, mid-water, under the raft, past the drop-off) and how it behaves there. |
| `src/whale.js` | One humpback, ambient: cruises, surfaces to blow, sounds flukes-up. Not catchable. |
| `src/reef.js` | What grows on the sea bed: coral, sponges, anemones, seagrass and rock, plus the surge that bends the soft ones. |
| `src/meshkit.js` | Welds a pile of coloured primitives into one geometry. Shared by the forest and the reef. |
| `src/terrain.js` | The continent: one height function, streamed as LOD chunks around the viewer, with biome colouring and instanced forests. |
| `src/wildlife.js` | The ecosystem — five species, predator/prey targeting, kills and repopulation. |
| `src/models.js` | Optional glTF bodies for the wildlife, with the procedural ones as fallback. |
| `tools/build_fish.py` | Builds all thirteen sea-life bodies in Blender — colour patterns baked into vertex colours — and exports them as one `.glb`. |
| `gallery/` | The asset gallery: a separate app and server that shows every asset in a 3D viewer. See its README. |
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

Fish bodies are built by `tools/build_fish.py` and drawn instanced. Nothing is
skinned: the swim is a travelling sine down the length of the body with the
nose pinned, which the vertex shader does for free, so ~220 fish cost one draw
call per species and no CPU beyond steering them. Each species sets its own
beat and amplitude — a tuna's stiff, fast tail against a grouper's lazy sweep —
and the flounder and the whale bend up and down instead of side to side (the
flounder lies on its side; the whale's flukes are horizontal). Counter-shading
is baked into the vertex colours; the original reef fish take a per-instance
tint over the top (one mesh, yellow tang and blue), and the newer species
carry their whole pattern in the mesh — the snapper's red, the tuna's gold
stripe and finlets, the barracuda's bars, the grouper's blue spots, the
shark's black fin tips.

**Where each one lives**, and how it behaves there, follows the real fish:

| Fish | Where | How |
|---|---|---|
| Red snapper | a few metres over the reef | small schools around structure |
| Porgy | low over the reef | in ones and twos, picking at the bottom |
| Flounder | on the open sand, between colonies | lies flat and still, camouflaged; bolts along the bottom if you get close |
| Mackerel | mid-water | a fast school |
| Barracuda | 3-6 m over a coral head | hangs almost motionless; hardly bothers to move away from you |
| Grouper | just off the bottom | solitary, stays by its hole |
| Blacktip reef shark | over the reef | a slow, wide patrol; does not get out of your way |
| Mahi-mahi | under the raft, near the surface | circles it — dorado gather under anything floating |
| Yellowfin tuna | past the drop-off | a fast school over deep water |

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

The spear is carried **overhand, above head level** — the way you carry
something you mean to throw — and right-click throws it. `src/spear.js` takes
it from there: it flies as a ballistic dart, point first, and sticks in the
beach, the sea bed, the top of a coral head, or the deck (where it rides the
swell with the raft).

**It skewers fish.** Each frame the stretch the point covered is tested against
the schools — the segment, not the point, because at 20 m/s it moves further
in a frame than a chromis is long. A fish it passes through is taken out of the
water and hung on the shaft through its flanks, and the spear carries on,
slower; a throw through a tight shoal can come back with more than one. Pull
the spear out with `E` and the fish come with it as **Raw fish**. A thrust does the
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
39 s for a tuna.

**What bites** depends on the water under the float, and on the hook:

| | Bare hook | Baited with a fish |
|---|---|---|
| Over the reef | chromis, wrasse, porgy, red snapper, the odd tang | grouper, barracuda, red snapper, blacktip, now and then a mackerel or a tuna |
| Over the sand | red snapper, porgy, silversides, flounder, mackerel | mackerel, barracuda, flounder, blacktip, red snapper, sometimes a tuna |
| Past the drop-off | silversides, mackerel, red snapper | yellowfin tuna, mahi-mahi, mackerel, blacktip |
| Near the raft | — | mahi-mahi, on top of whichever of the above |

Right-click with the rod to bait the hook: it takes one raw fish. A predator
does not peck at a bait the way a small fish nibbles a bare hook — there are
fewer nibbles, and you wait longer, because big fish are rarer. Miss the bite
and it usually steals the bait. Whatever takes it, the bait is gone. What a
catch is worth in raw fish goes with the size of it: one for a reef fish, two
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

### The whale

One humpback (`src/whale.js`), about 12 m long, keeps to a ring 50-95 m out
from the raft. It cruises at 9 m, and every minute or so comes up and blows
three to five times, a dozen seconds apart — a bushy spout about 4 m tall —
then arches over and sounds, the flukes coming up clear of the water as it
goes down. It is scenery, not a catch: nothing on a raft lands forty tonnes.
It uses the same swim shader as the fish, bending up and down.

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
- Fish: the `SPECIES` table in `fish.js` — body, colour, zone, school count,
  size, and per species `hover`, `flee`, `roam`, `amp`/`rate` (the swim) and
  `bed` — plus `ZONES` for where each zone is, `FLEE_RADIUS`, and `BIG` for
  what is too big to spear. The whale: the constants at the top of `whale.js`.
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
- **Cooking** — the campfire is built and lit but has no interaction, and there
  is now something to cook: raw fish (`FOOD` in `items.js` has it costing a
  little water). Give the fire an input slot and a cooked fish better than
  either raw fish or a coconut.
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
