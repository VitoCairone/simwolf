# Tools

## ecorun.js: long runs of the ecology

Runs the sim in plain Node with nothing drawn (`sim.js`, `senses.js`, `mind.js`, `hydrology.js`; no
browser, no `animat.js`), for game hours on end, and logs what happens to a JSON-lines file. The same
seed gives the same run.

    node tools/ecorun.js                     # the game's own start, 30 game hours, seed 1, to eco.jsonl
    node tools/ecorun.js --hours 24 --seed 3 --out runs/s3.jsonl
    node tools/ecorun.js --start '{"wolves":4,"deer":114,"deerSideTiles":386}'   # a quarter-size start (faster)
    node tools/ecorun.js --socket eco.sock   # and let you look in while it runs (below)

Every 10 game minutes it prints a line: the game time, wolves and deer alive, the newest generation of
each, and how many seconds a game minute takes. Ctrl-C ends it cleanly. The full start takes about
30-60 s per game minute; a game year is about 8.7 game hours.

The log, one JSON object a line, by `t`:

- `birth`, `death` (cause `of`, `stage`, `food`, `water`, `mode`, mother and whether alive), as they happen
- `wolf`: each wolf every 2 game minutes (food, mode, mate, pregnant, carrying a leg, where)
- `pop`: every 10 game minutes, numbers by species, generation and stage; pregnant; mean food
- `gone`: a carcass (or leg) rotted away, with the meat left on it (`leftKg`)
- `end`

For example, from another terminal:

    grep '"t":"pop"' eco.jsonl | tail -1                     # the latest numbers
    grep '"t":"death"' eco.jsonl | grep '"sp":"wolf"'        # every wolf death
    grep -c '"t":"birth".*"sp":"deer"' eco.jsonl             # deer born so far

### Looking in while it runs

With `--socket eco.sock` it opens a Node prompt on that Unix socket, with `sim`, `S` (`sim.internals`),
`mind`, `senses` and the helpers `live()`, `deer()`, `wolves()`, `stageOf(a)` and `gameMin()` at hand. The
sim answers between game minutes, so an answer can take as long as a game minute's computing. In
another terminal:

    nc -U eco.sock                                            # then type, e.g.
    sim> deer().length
    sim> wolves().map(a => [a.uid, a.food.toFixed(2), mind.stateOf(a).mode])
    sim> deer().filter(a => a.generation >= 2).length
    sim> .exit

or one question at a time:

    printf 'deer().length\n.exit\n' | nc -U eco.sock

What you change there (a critter's food, say) changes the run.
