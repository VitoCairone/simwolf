# SimWolf tests

Browser tests that load the real `index.html` in headless Chromium (via
[Playwright](https://playwright.dev)) and check the game's behaviour by reading
its state and sending real mouse and keyboard input.

In the page the game is three objects: `sim` (the world; `sim.internals` has the
rest of its functions, for tests and debugging only), `animat` (the view) and
`controls` (input).

## Setup (once)

```
cd tests
npm run setup        # installs Playwright and its Chromium build
```

## Run

```
npm test                       # the fast suites (node run-all.js fast)
npm run test:slow              # the slow suites
npm run test:all               # every suite
node run-all.js all loop       # every suite whose file name contains "loop"
node gameloop.test.js          # one suite on its own
```

The suites come in two sets. The **fast** ones together run in 2 minutes at most (about
1.5 minutes now): run them freely while working. The **slow** ones (marked *slow* below,
and `slow: true` in their exports) take several minutes more: run them sparingly, those
relevant to what changed, and the whole suite only when asked. A fast suite that grows
slow should be marked slow (or sped up); `run-all.js` warns when the fast set goes over
its budget.

Each check prints `PASS` or `FAIL`; the exit code is non-zero if anything failed.

Any `alert()` or page error during a suite counts as a failure: an alert means
the game reached a state where it should halt.

Set `CHROMIUM_PATH` to use a specific Chromium build instead of Playwright's.

## Suites

| File | Checks |
| --- | --- |
| `bugfixes.test.js` *(slow)* | First-round fixes: spawning at tile centers, no overlapping spawns, idle deer can be killed, dying deer stay dead, death animation timing and corpse frame, wind/stamina refill at rest and capped at full, sprite z-index. Ends with a 10 s soak run. |
| `camera.test.js` | Camera: starts on the player's wolf a step in from the widest zoom; clicking a critter pins the camera to it, and it stays on its corpse; arrows to the wolf pin it back on the wolf, arrows to the camera unpin it in place; arrow panning is slower zoomed in, by the zoom factor. |
| `accel.test.js` | Speed changes: a wolf reaches a full gallop from standing in 2.5 s, a deer in 1.5 s, and stops from one in as long, keeping its gait until stopped, then idling; a stun stops it dead. |
| `arrowkeys.test.js` | Wolf mode: each arrow key and two-key diagonal moves the wolf in that screen direction; opposite keys cancel; releasing stops; camera mode still pans. |
| `movepad.test.js` | Movement pad rings, direction (any heading, exactly where the pointer is, not snapped to 8), leaving the pad, camera mode vs wolf mode for the arrow keys, pad fixed under zoom. |
| `gameloop.test.js` *(slow)* | Same game speed at 30/60/120/144 Hz, pause is immediate, step = one tick, rapid pause/unpause never starts a second loop, long stalls are capped. |
| `movement.test.js` *(slow)* | No critter stays frozen for 50 game-seconds across 10 loads (spawn/collision deadlocks). Prints details for any frozen critter. |
| `obstacles.test.js` | Boulders: only on land, infrequent, on every ground type, some forming barrier walls with gaps; stone ground is passable; a boulder blocks a walking wolf, which is stunned (stopped where it was for 0.1 - 0.5 s, then tries again). Saves a screenshot of a barrier to `output/obstacles/`. |
| `separation.test.js` *(slow)* | `sim.js` runs in Node with no browser and on its own decides nothing (no critter moves); an intent (the player's) steers the wolf; with `senses.js` and `mind.js` also loaded in Node, critters move by themselves; the page defines only `sim`, `senses`, `mind`, `animat` and `controls`. |
| `decisions.test.js` | Senses and decisions: sight is the game view's rectangle at 2x zoom and no further; a deer flees a wolf it sees and a wolf chases a deer it sees; out of sight, a deer keeps fleeing from where it last saw the wolf and a wolf keeps after a deer the way it was heading, and both give up later; a wolf with two deer about as near in opposite directions picks the one ahead and keeps to it; a wolf runs down a tired deer; over a minute of play, critters gallop only when chasing or fleeing; a critter goes along any heading it is told, facing the nearest of its 8 directions, with a square root only for a new heading; each critter decides at most 10 times a game-second, with turns spread evenly over the ticks for wolves and for deer. |
| `senses.test.js` | The senses: sight is the view's rectangle and line of sight (a boulder between two critters hides each from the other, and the ground behind it); hearing a critter moving on land within a range by gait and ground (a galloping wolf just out of sight is heard, a walking one not; standing still, silent); smell on the wind (a wolf smells a deer 100 tiles upwind, not downwind or across the wind; a deer a wolf 60 tiles upwind, not 120; anything up close); trails that fade, followed by a hungry wolf the way the deer went; memory keeping what sight told when a critter is afterwards only smelled. |
| `terrain.test.js` | Terrain height: every tile flat or a one-level slope, water flat at level 0, the map has slopes and cliffs, ground cover (grass/dirt/stone) found across many heights, critters drawn at the ground's height, a two-level cliff blocks a wolf and a one-level ledge doesn't. Saves a screenshot to `output/terrain/`. |
| `swim.test.js` | Water is passable: wolf and deer enter water and swim (own sheets, at their `travelKph` swim speeds), never stand still in water (told to stand or eat, or after a stun, they swim on), resume their land pose on shore. Swimming uses stamina (a full reserve lasts `swimTimeS`: gamified 12 minutes for a wolf, 3 for a deer); asked to gallop, a swimmer sprints at `swimBurst` speed using wind too, dropping to a swim out of wind; out of stamina it can't move. Saves screenshots to `output/swim/`. |
| `death.test.js` | Deer death: a killed deer plays the 5 death frames in order from its own sheet, the corpse holds the last frame, and all 8 directions use the right drawn facing or its mirror. Saves the fall frame by frame to `output/death/`. |
| `deeranim.test.js` | The deer's land animations as the artist's preview plays them (sprites from `images_raw/OvN65m.gif` in `images/deer-land.png`): walk columns 0-9 and the run cycle 35-43 (trot and gallop) at 6 ticks a frame; idle 11-34 at 6 ticks, 30 at its three pauses; grazing lowers the head (32) and keeps it down (33). Saves a screenshot. |
| `shore.test.js` | Shores, an outgoing wave from the land that always joins up. On the real map: shore tiles show the straight (`tiles.png` row 9, columns 0-1) or corner (columns 2-5) sprites, other water stays plain; one global clock steps every tile of a set to the same frame at once, the straight frames lasting twice as long so both loops repeat in sync; nothing laps while paused. On a test map (terrain swapped for water with shapes of land): a straight coast is all straight tiles facing the land; a rectangle of land and a 1-tile island have exactly 4 corner pieces, touching land only at their corner; a lake has an interior corner (`images/shore-inner.png`) in each corner; a staircase coast has an interior corner in each notch and a corner piece beyond each; every wave joins up. Saves screenshots to `output/shore/`. |
| `shorewait.test.js` | Water and tired critters: a hungry wolf doesn't follow a swimming deer into the water (nor kills it there) but waits on the shore where the deer is swimming to (the far shore when it swims away); a critter below a quarter of its stamina may not go into the water (the player's wolf, steered by the player, may); a tired swimmer heads for the nearest land; a deer or wolf climbing out up a bank higher than a step walks for 1.5 s, then gallops on, and either way speeds up out of the water at its usual rate. |
| `mortality.test.js` *(slow)* | Game speeds and forced mortality (Node, no browser): every speed constant is in both `REALISTIC` and `GAMIFIED`, and one line picks `GAMIFIED`; greatest ages wolf 20.6 / deer 31.5 years, shrunk alike so the wolf's is 90 minutes, life-stage ages with them; lifespans drawn about normally within bounds; the first critters start as adults younger than their lifespan; past it a deer, a wolf and the player's wolf die to corpses (the player's corpse still the player's); with `REALISTIC` chosen, lifespans are in years. |
| `food.test.js` | Food: every grass tile starts at its most grass and no other ground has any; a hungry deer grazes its tile and the tile is drawn shorter; grass grows back slowly to its limit; meters (the energy a body holds) empty over their full time; a body weighs its skeleton plus its fat and lean tissue, less as it starves; starving kills a deer or a wolf (death animation); a carcass is its body's food at death (a starved deer far less) and is drawn in 9 layers (a shadow, then 8 pieces each as meat or, once eaten, bones), eaten a piece at a time in a random order by the player's wolf standing still, which fills on its meter's worth; a full wolf eats no more than tops it up; the red food meter. Saves a carcass screenshot. |
| `breeding.test.js` | Breeding: every critter male or female, every one mortal, the player's wolf and newborns too; the young grow only by eating (a share of what they eat or suckle goes to the skeleton), about as fast as a well-fed one when eating as they use; every newborn, of either sex, starts at the smallest of 4 shrunk sheets (`images/young/`), drawn by skeleton size; antlers only on stags old enough to breed (hinds, young stags and their carcasses drawn from the antlerless `images/hind-*.png`), a corpse's age stopping at its death; an unpaired stag and hind court and mate, facing each other under a rising heart, then are a pair, she conceives, and they keep together; the smallest two sizes of young have collision boxes shrunk to their size, so a pup can come closer to its mother; critters met while either was an infant (Westermarck) never mate; pairs are faithful until death, the widowed pair again and the new partner adopts the young; gestation, litter sizes (wolf 1-11, mean 5.5; deer one calf, twins rare), one breeding a year and the oldest fertile ages are kept; a litter is born beside its mother, can't walk at first, and nurses: only touching its mother, filling over time, its meter rising by more than hers falls (the milk's energy, from hers at her efficiency), a hungry infant going to her and suckling while she stands still; an unweaned pup doesn't hunt. |
| `wolf.test.js` | The wolf's sprites and the player's wolf: `images/wolf-land.png` holds the artist's frames (`images_raw/wolf-all.png`: run, idle, howl, death, bite in the 4 diagonals) exactly, the run shifted to the others' ground point; the gallop plays the run at the artist's 70 ms a frame and the idle 200 ms (`images_raw/5V5aC4.gif`); a dying wolf plays the 11 death frames 100 ms each, then its corpse holds the last, facing the nearest diagonal; the player's wolf dies of age too and its corpse stays the player's (the arrow toggle brings the camera to it, the arrows move nothing) until the next wolf is born, which becomes the player's wolf, the camera going to it. |
| `facings.test.js` | Wolf sprite row and mirroring for all 8 directions, walking and idle. Saves screenshots to `output/facings/`. |

`output/` holds generated screenshots and is git-ignored.

## Writing tests

Each suite exports `{ name, main(browser, r) }`. Use `openGame(browser)` from
`helpers.js` to load the page, `page.evaluate(...)` to read or drive the game,
and `r.check(condition, message)` to record a result. Call `sim.pause()` first and
then `sim.internals.tick()` to step the simulation deterministically. Ticking by
hand doesn't redraw: call `animat.render()` before reading anything on the page
(sprite classes, positions, background frames).

Only stags old enough to breed have antlers; a test of the stag's sprites should first
call `makeStags(page)` from `helpers.js`, which makes every deer one.

Critters can swim, so a test that expects land poses (walk, trot, gallop, idle)
should first call `moveToOpenLand(page)` from `helpers.js`, which puts the wolf
(or another critter) in the middle of open dry ground.

Critters decide for themselves (`mind.js`). To drive one by hand, first call
`mind.ignore(critter)` so the mind leaves it alone, then tell it what to do with
`sim.internals.setCritterMoving(...)` or `sim.setIntent(critter, intent)`.
`mind.forget(critter)` wipes what it remembers.
