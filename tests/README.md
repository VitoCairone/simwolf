# SimWolf tests

Browser tests that load the real `index.html` in headless Chromium (via
[Playwright](https://playwright.dev)) and check the game's behaviour by reading
its globals and sending real mouse and keyboard input.

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
| `bugfixes.test.js` | First-round fixes: spawning at tile centers, no overlapping spawns, idle deer can be killed, dying deer stay dead, death animation timing and corpse frame, fatigue recovery and floor, sprite z-index. Ends with a 10 s soak run. |
| `movepad.test.js` | Movement pad rings, direction, leaving the pad, camera mode vs wolf mode for the arrow keys, pad fixed under zoom. |
| `gameloop.test.js` | Same game speed at 30/60/120/144 Hz, pause is immediate, step = one tick, rapid pause/unpause never starts a second loop, long stalls are capped. |
| `movement.test.js` | No critter stays frozen for 50 game-seconds across 10 loads (spawn/collision deadlocks). |
| `facings.test.js` | Wolf sprite row and mirroring for all 8 directions, walking and idle. Saves screenshots to `output/facings/`. |

`output/` holds generated screenshots and is git-ignored.

## Writing tests

Each suite exports `{ name, main(browser, r) }`. Use `openGame(browser)` from
`helpers.js` to load the page, `page.evaluate(...)` to read or drive the game,
and `r.check(condition, message)` to record a result. Call `pause()` first and
then `tick()` to step the simulation deterministically.
