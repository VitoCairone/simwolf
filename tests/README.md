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
npm test             # every suite, with a summary at the end
node run-all.js loop # only suites whose file name contains "loop"
node gameloop.test.js  # one suite on its own
```

A full run takes about 2–3 minutes. Each check prints `PASS` or `FAIL`; the exit
code is non-zero if anything failed.

Any `alert()` or page error during a suite counts as a failure: an alert means
the game reached a state where it should halt.

Set `CHROMIUM_PATH` to use a specific Chromium build instead of Playwright's.

## Suites

| File | Checks |
| --- | --- |
| `bugfixes.test.js` | First-round fixes: spawning at tile centers, no overlapping spawns, idle deer can be killed, dying deer stay dead, death animation timing and corpse frame, wind/stamina refill at rest and capped at full, sprite z-index. Ends with a 10 s soak run. |
| `arrowkeys.test.js` | Wolf mode: each arrow key and two-key diagonal moves the wolf in that screen direction; opposite keys cancel; releasing stops; camera mode still pans. |
| `movepad.test.js` | Movement pad rings, direction, leaving the pad, camera mode vs wolf mode for the arrow keys, pad fixed under zoom. |
| `gameloop.test.js` | Same game speed at 30/60/120/144 Hz, pause is immediate, step = one tick, rapid pause/unpause never starts a second loop, long stalls are capped. |
| `movement.test.js` | No critter stays frozen for 50 game-seconds across 10 loads (spawn/collision deadlocks). Prints details for any frozen critter. |
| `separation.test.js` | `sim.js` runs in Node with no browser (critters move, a player intent steers the wolf); the page defines only `sim`, `animat` and `controls`. |
| `terrain.test.js` | Terrain height: every tile flat or a one-level slope, water flat at level 0, the map has slopes and cliffs, critters drawn at the ground's height, a two-level cliff blocks a wolf and a one-level ledge doesn't. Saves a screenshot to `output/terrain/`. |
| `swim.test.js` | Water is passable: wolf and deer enter water and swim (own sheets, 5 / 8 km/h, no effect on wind or stamina), tread water when stopped, resume their land pose on shore. Saves screenshots to `output/swim/`. |
| `facings.test.js` | Wolf sprite row and mirroring for all 8 directions, walking and idle. Saves screenshots to `output/facings/`. |

`output/` holds generated screenshots and is git-ignored.

## Writing tests

Each suite exports `{ name, main(browser, r) }`. Use `openGame(browser)` from
`helpers.js` to load the page, `page.evaluate(...)` to read or drive the game,
and `r.check(condition, message)` to record a result. Call `sim.pause()` first and
then `sim.internals.tick()` to step the simulation deterministically. Ticking by
hand doesn't redraw: call `animat.render()` before reading anything on the page
(sprite classes, positions, background frames).

Critters can swim, so a test that expects land poses (walk, trot, gallop, idle)
should first call `moveToOpenLand(page)` from `helpers.js`, which puts the wolf
(or another critter) in the middle of open dry ground.
