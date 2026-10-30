// Senses and decisions (senses.js, mind.js):
//  - sight: every creature within the game view's rectangle at 2x zoom, nothing further
//  - a deer flees a wolf it sees; a wolf chases a deer it sees
//  - memory: a deer keeps fleeing a wolf it can no longer see, and a wolf keeps after a
//    deer it can no longer see, toward where the deer was heading
//  - forgetting: both give up once the sighting is old enough
//  - no dithering: a wolf with two deer about as near in opposite directions picks the
//    one ahead of it and keeps to it, without flipping between them
//  - a chase ends in a kill: a hungry wolf runs down a tired deer, and eats it straight
//    away (fills its stomach)
//  - galloping is only for chasing and fleeing: over a minute of play, no calm critter
//    gallops
//  - any heading: a critter moves along whatever grid vector it is told, facing the
//    nearest of its 8 directions; the vector is scaled (a square root) only when it changes
//  - turns: each critter decides at most 10 times a game-second and once a tick, and about
//    as many wolves (and deer) decide on each tick as on any other
//  - grass under a boulder: a third as much grows there; a hungry deer eats it from beside
//    the boulder, facing it, in a third of the time a full tile takes
//  - giving way: bumped while standing, a critter steps aside (so a family resting around
//    one of them doesn't pen it in)
//  - no pacing (mind.pacing flags a critter going to and fro over 6 tiles or fewer): a
//    paired stag kept from his hind comes well back to her, rather than to and fro across
//    his limit
// Each encounter is set up on open land (no water or boulders nearby) with every other
// critter parked off the map and left alone by the mind, and the two starting with no
// memories.

const { openGame, runStandalone } = require("./helpers");

// in the page: put a wolf and a deer on open dry ground, everyone else away
function setup({ deerAt, deer2At = null, wolfThinks = true, deerThinks = true }) {
  sim.pause();
  // (live ones: one may have been killed in the moment of play before the test paused)
  const w = sim.internals.wolves.find(c => c !== sim.pcWolf && sim.isLiveCritter(c));
  const liveDeer = sim.internals.deer.filter(c => sim.isLiveCritter(c));
  const d = liveDeer[0], d2 = deer2At ? liveDeer[1] : null;
  sim.allCritters.filter(c => c !== w && c !== d && c !== d2).forEach(c => {
    c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; mind.ignore(c);
  });
  const R = 6;
  const dry = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
  const t = sim.internals.allLandTiles.find(([i, j]) => {
    if (i < R || j < R || i >= sim.gridWidthN - R || j >= sim.gridHeightN - R) return false;
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) if (!dry(i + di, j + dj)) return false;
    return true;
  });
  if (!t) return null;
  w.gx = w.nextGX = t[0] + 0.5; w.gy = w.nextGY = t[1] + 0.5; w.stunnedUntil = 0;
  d.gx = d.nextGX = w.gx + deerAt[0]; d.gy = d.nextGY = w.gy + deerAt[1]; d.stunnedUntil = 0;
  if (d2) { d2.gx = d2.nextGX = w.gx + deer2At[0]; d2.gy = d2.nextGY = w.gy + deer2At[1]; d2.stunnedUntil = 0; }
  for (const c of [w, d, d2].filter(Boolean)) {
    c.wind = 1; c.stamina = 1; c.stunnedUntil = 0; sim.internals.setCritterIdle(c); // (not stunned)
    c.speed = 0; // placed: standing, not slowing from how it moved before
    sim.internals.setFood(c, c.species === "wolf" ? 0.3 : 1); // a hungry wolf (it hunts), a fed deer (it doesn't graze)
    mind.ignore(c, c === w ? !wolfThinks : !deerThinks);
    mind.forget(c); // nothing remembered from before the test
  }
  window.__w = w; window.__d = d; window.__d2 = d2;
  return t;
}

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 650 } });
  const fresh = async () => {
    await p.reload(); await p.waitForTimeout(300);
    await p.evaluate(() => { sim.internals.holdClock(12); }); // (as openGame)
    await p.evaluate(`window.setup = ${setup.toString()}`);
  };

  // 1. sight: within the rectangle only
  const sight = await p.evaluate(() => {
    sim.pause();
    const w = sim.internals.wolves[1], [d1, d2, d3, d4] = sim.internals.deer;
    const W = senses.sightHalfWidthTiles, H = senses.sightHalfHeightTiles;
    // offsets for a point (u across the screen, v down it): dx = (u + v) / 2, dy = (v - u) / 2
    const put = (d, u, v) => { d.gx = w.gx + (u + v) / 2; d.gy = w.gy + (v - u) / 2; };
    put(d1, 0.99 * W, 0); put(d2, 1.01 * W, 0); put(d3, 0, 0.99 * H); put(d4, 0, -1.01 * H);
    // the rectangle alone (line of sight is tested in senses.test.js)
    senses.use.lineOfSight = false;
    const seen = senses.perceive(w).filter(o => o.by === "sight").map(o => o.uid);
    senses.use.lineOfSight = true;
    return { W, H, side: seen.includes(d1.uid), pastSide: seen.includes(d2.uid),
      top: seen.includes(d3.uid), pastTop: seen.includes(d4.uid) };
  });
  r.check(sight.side && !sight.pastSide && sight.top && !sight.pastTop,
    `sight is the game view's rectangle: |dx - dy| up to ${sight.W}, |dx + dy| up to ${sight.H} ` +
    `(just inside: ${sight.side}, ${sight.top}; just outside: ${sight.pastSide}, ${sight.pastTop})`);

  // 2. a deer flees a wolf in sight
  await fresh();
  const flee = await p.evaluate(`(() => {
    if (!setup({ deerAt: [4, 4], wolfThinks: false })) return null;
    const [w, d] = [__w, __d];
    const d0 = Math.hypot(d.gx - w.gx, d.gy - w.gy);
    for (let n = 0; n < 60; n++) sim.internals.tick(); // (picking up speed from a standstill)
    return { d0, d1: Math.hypot(d.gx - w.gx, d.gy - w.gy), mode: mind.stateOf(d).mode, pose: d.pose };
  })()`);
  r.check(flee && flee.mode === "flee" && flee.d1 > flee.d0 + 3,
    `a deer flees a wolf it sees (${flee && flee.d0.toFixed(1)} -> ${flee && flee.d1.toFixed(1)} tiles in 1 s, ${flee && flee.pose})`);

  // 3. a wolf chases a deer in sight
  await fresh();
  const chase = await p.evaluate(`(() => {
    if (!setup({ deerAt: [5, 5], deerThinks: false })) return null;
    const [w, d] = [__w, __d];
    const d0 = Math.hypot(d.gx - w.gx, d.gy - w.gy);
    for (let n = 0; n < 60; n++) sim.internals.tick(); // (picking up speed from a standstill)
    return { d0, d1: Math.hypot(d.gx - w.gx, d.gy - w.gy), mode: mind.stateOf(w).mode, pose: w.pose };
  })()`);
  r.check(chase && chase.mode === "chase" && chase.d1 < chase.d0 - 1,
    `a wolf chases a deer it sees (${chase && chase.d0.toFixed(1)} -> ${chase && chase.d1.toFixed(1)} tiles in 1 s, ${chase && chase.pose})`);

  // 4. a deer remembers a wolf it can no longer see
  await fresh();
  const deerMem = await p.evaluate(`(() => {
    if (!setup({ deerAt: [4, 4], wolfThinks: false })) return null;
    const [w, d] = [__w, __d];
    for (let n = 0; n < mind.turnTicks; n++) sim.internals.tick(); // its turn: sees the wolf
    const wolfWas = [w.gx, w.gy];
    w.gx = w.gy = w.nextGX = w.nextGY = -900;               // the wolf vanishes from sight
    const from0 = Math.hypot(d.gx - wolfWas[0], d.gy - wolfWas[1]);
    for (let n = 0; n < 120; n++) sim.internals.tick();     // 2 s
    const s2 = mind.stateOf(d);
    const from2 = Math.hypot(d.gx - wolfWas[0], d.gy - wolfWas[1]);
    const seesWolf = senses.perceive(d).some(o => o.species === "wolf");
    for (let n = 0; n < 15 * 60; n++) sim.internals.tick(); // 15 s more
    return { from0, from2, mode2: s2.mode, seesWolf, modeLater: mind.stateOf(d).mode };
  })()`);
  r.check(deerMem && !deerMem.seesWolf && deerMem.mode2 === "flee" && deerMem.from2 > deerMem.from0 + 5,
    `out of sight, a deer keeps fleeing where it last saw the wolf (${deerMem && deerMem.from0.toFixed(1)} -> ` +
    `${deerMem && deerMem.from2.toFixed(1)} tiles from that spot after 2 s)`);
  r.check(deerMem && deerMem.modeLater === "calm", `...and calms down later (17 s on: ${deerMem && deerMem.modeLater})`);

  // 5. a wolf remembers a deer it can no longer see, and where it was going
  await fresh();
  const wolfMem = await p.evaluate(`(() => {
    if (!setup({ deerAt: [3, -3], deerThinks: false })) return null;
    const [w, d] = [__w, __d];
    sim.internals.setCritterMoving(d, sim.DIR_E, "trot");    // the deer heads east...
    for (let n = 0; n < mind.turnTicks; n++) sim.internals.tick(); // ...the wolf sees it
    const seen = [d.gx, d.gy];
    d.gx = d.gy = d.nextGX = d.nextGY = -900; d.speed = 0;   // ...and loses it
    const w0 = [w.gx, w.gy];
    for (let n = 0; n < 60; n++) sim.internals.tick();       // 1 s
    const s = mind.stateOf(w), w1 = [w.gx, w.gy];
    const seesDeer = senses.perceive(w).some(o => o.species === "deer");
    const tgt = s.target !== null && sim.internals.critterByUid.get(s.target);
    const chasing = tgt ? { same: tgt === d, at: [tgt.gx - w0[0], tgt.gy - w0[1]].map(v => +v.toFixed(1)), age: +(sim.now - tgt.birthTime).toFixed(1), alive: sim.isLiveCritter(tgt) } : null;
    for (let n = 0; n < 21 * 60; n++) sim.internals.tick();  // 21 s more
    return { seen, w0, w1, mode: s.mode, seesDeer, modeLater: mind.stateOf(w).mode, chasing };
  })()`);
  const east = wolfMem && wolfMem.w1[0] - wolfMem.w0[0];
  r.check(wolfMem && !wolfMem.seesDeer && wolfMem.mode === "chase" && east > 1,
    `out of sight, a wolf keeps after a deer, the way it was heading (moved ${east && east.toFixed(1)} tiles east in 1 s, ${wolfMem && wolfMem.mode}; after ${JSON.stringify(wolfMem && wolfMem.chasing)})`);
  // (a hungry wolf may then follow the trails deer left on the map: see senses.test.js)
  r.check(wolfMem && (wolfMem.modeLater === "calm" || wolfMem.modeLater === "track"),
    `...and gives up the chase later (22 s on: ${wolfMem && wolfMem.modeLater})`);

  // 6. two deer about as near, in opposite directions: the wolf picks the one it faces
  // (though the other is a little nearer) and keeps to it
  await fresh();
  const two = await p.evaluate(`(() => {
    if (!setup({ deerAt: [4, -4], deer2At: [-3.8, 3.8], deerThinks: false })) return null;
    const [w, ahead, behind] = [__w, __d, __d2];
    w.currentDirection = sim.DIR_NE;                       // facing the first deer
    [w.hx, w.hy] = sim.moveVecByDir[sim.DIR_NE];            // ...and heading that way
    const targets = [], dirs = [];
    for (let n = 0; n < 90; n++) {                          // 1.5 s
      sim.internals.tick();
      const t = mind.stateOf(w)?.target;
      if (t !== undefined && t !== null) targets.push(t);
      dirs.push(w.currentDirection);
    }
    let turns = 0;
    for (let n = 1; n < dirs.length; n++) if (dirs[n] !== dirs[n - 1]) turns++;
    // kept: never went for the other one (it may catch this one, and then rest)
    return { first: targets[0], ahead: ahead.uid, kept: !targets.includes(behind.uid), turns,
      caught: ahead.pose === "death" || ahead.pose === "dead" };
  })()`);
  r.check(two && two.first === two.ahead && two.kept && two.turns <= 2,
    `two deer about as near, opposite ways: the wolf picks the one ahead and keeps to it ` +
    `(${two && (two.first === two.ahead ? "ahead" : "behind")}, ${two && (two.kept ? "kept" : "switched")}, ` +
    `${two && two.turns} turns in 1.5 s${two && two.caught ? ", caught it" : ""})`);

  // 7. a chase ends in a kill: a tired deer can only walk
  await fresh();
  const kill = await p.evaluate(`(() => {
    if (!setup({ deerAt: [5, 4] })) return null;
    const [w, d] = [__w, __d];
    d.wind = 0; d.stamina = 0;
    let n = 0;
    for (; n < 30 * 60 && d.pose !== "death" && d.pose !== "dead"; n++) sim.internals.tick();
    const modes = new Set();
    for (let k = 0; k < 120; k++) { sim.internals.tick(); modes.add(mind.stateOf(w).mode); }
    return { s: n / 60, pose: d.pose, wolfMode: mind.stateOf(w).mode, modes: [...modes].join(","),
      gut: w.gut, meatLeft: d.carcass ? sim.carcassMeatKg(d) / d.carcassFullKg : null };
  })()`);
  r.check(kill && (kill.pose === "death" || kill.pose === "dead"),
    `a hungry wolf runs down a tired deer (killed after ${kill && kill.s.toFixed(1)} s)`);
  r.check(kill && kill.gut > 0.5 && kill.meatLeft < 1 && kill.modes.includes("feed") && !kill.modes.includes("rest"),
    `...and eats it straight away, no resting (its stomach ${kill && kill.gut.toFixed(2)} full, ` +
    `${kill && (kill.meatLeft * 100).toFixed(0)}% of the meat left; ${kill && kill.modes})`);

  // 8. any heading, and square roots only for new headings
  await fresh();
  const heading = await p.evaluate(`(() => {
    if (!setup({ deerAt: [8, 8], wolfThinks: false, deerThinks: false })) return null;
    const w = __w;
    let roots = 0; const sqrt = Math.sqrt;
    Math.sqrt = x => { roots++; return sqrt(x); };
    try {
      const from = [w.gx, w.gy];
      w.currentDirection = sim.DIR_N; // facing well away (a facing within 30 degrees is kept)
      sim.setIntent(w, { dx: 3, dy: 1, gait: "walk" });
      for (let n = 0; n < 60; n++) {
        if (n % 6 === 0) sim.setIntent(w, { dx: 3, dy: 1, gait: "walk" }); // the same, again
        sim.internals.tick();
      }
      const rootsSame = roots;
      const slope = (w.gy - from[1]) / (w.gx - from[0]), facing = w.currentDirection;
      sim.setIntent(w, { dx: 1, dy: 3, gait: "walk" });                  // a new heading
      sim.internals.tick();
      return { slope, facing, rootsSame, rootsNew: roots - rootsSame, facingNew: w.currentDirection,
        E: sim.DIR_E, S: sim.DIR_S };
    } finally { Math.sqrt = sqrt; }
  })()`);
  r.check(heading && Math.abs(heading.slope - 1 / 3) < 0.01,
    `any heading: told to go along (3, 1), a wolf goes along it (slope ${heading && heading.slope.toFixed(3)}, wanted 0.333)`);
  r.check(heading && heading.facing === heading.E && heading.facingNew === heading.S,
    `...facing the nearest of its 8 directions ((3, 1): ${heading && heading.facing}, wanted E; ` +
    `(1, 3): ${heading && heading.facingNew}, wanted S)`);
  r.check(heading && heading.rootsSame === 1 && heading.rootsNew === 1,
    `square roots only for a new heading (${heading && heading.rootsSame} for one heading set 11 times, ` +
    `${heading && heading.rootsNew} for a new one)`);

  // 9. turns: at most 10 a game-second, once a tick; spread evenly across ticks
  await fresh();
  const turns = await p.evaluate(() => {
    sim.pause();
    const T = 600, period = mind.turnTicks, perCritter = new Map(), byTick = [];
    for (let n = 0; n < T; n++) {
      sim.internals.tick();
      const now = sim.tickCount - 1, count = { wolf: 0, deer: 0 };
      for (const c of sim.allCritters) {
        const st = mind.stateOf(c);
        if (!st || st.lastTurn !== now || !sim.isLiveCritter(c)) continue;
        if (c === sim.pcWolf && sim.playerHasControl()) continue;
        count[c.species]++;
        perCritter.set(c, (perCritter.get(c) || 0) + 1);
      }
      byTick.push(count);
    }
    const perS = [...perCritter.values()].map(v => v / (T * sim.tempo));
    // per slot of the cycle, over the first cycle after everyone has started
    const slots = byTick.slice(period, 2 * period);
    const spread = sp => Math.max(...slots.map(c => c[sp])) - Math.min(...slots.map(c => c[sp]));
    return { period, maxPerS: Math.max(...perS), spreadWolf: spread("wolf"), spreadDeer: spread("deer"),
      slots: slots.map(c => c.wolf + "w" + c.deer + "d").join(" ") };
  });
  r.check(turns.maxPerS <= 10 + 1e-9, `each critter decides at most 10 times a game-second (most: ${turns.maxPerS.toFixed(2)})`);
  r.check(turns.spreadWolf <= 1 && turns.spreadDeer <= 1,
    `turns are spread evenly over the ${turns.period} ticks of each 0.1 s, for wolves and for deer (${turns.slots})`);

  // 10. galloping only to chase or flee
  await fresh();
  const gallops = await p.evaluate(() => {
    sim.pause();
    const byMode = {};
    for (let n = 0; n < 60 * 60; n++) {
      sim.internals.tick();
      for (const c of sim.allCritters) {
        // (a critter told to stop keeps its gait's pose while it slows)
        if (c.pose !== "gallop" || !(c.targetSpeed > 0) || c === sim.pcWolf && sim.playerHasControl()) continue;
        const mode = mind.stateOf(c)?.mode;
        byMode[mode] = (byMode[mode] || 0) + 1;
      }
    }
    return byMode;
  });
  const calmGallops = Object.entries(gallops).filter(([mode]) => mode !== "chase" && mode !== "flee");
  r.check(calmGallops.length === 0,
    `galloping only to chase or flee (critter-ticks galloping in a minute: ${JSON.stringify(gallops)})`);

  // PACING: grass under a boulder, and a paired stag keeping near his hind
  await fresh();
  const pace = await p.evaluate(() => {
    const S = sim.internals, out = {};
    const free = (i, j) => sim.getTerrainAt(i, j) === "grass" && !sim.isBlockedTile(i, j);
    // a boulder on grass with open grass around it
    let b = null;
    for (let i = 8; i < sim.gridWidthN - 8 && !b; i++) for (let j = 8; j < sim.gridHeightN - 8 && !b; j++) {
      if (sim.obstacleAt(i, j) !== "boulder" || sim.getTerrainAt(i, j) !== "grass") continue;
      let ok = true;
      for (let di = -4; di <= 4 && ok; di++) for (let dj = -4; dj <= 4 && ok; dj++)
        if ((di || dj) && !free(i + di, j + dj)) ok = false;
      if (ok) b = [i, j];
    }
    if (!b) return null;
    sim.allCritters.forEach(c => { c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; mind.ignore(c); });
    const H = sim.gridHeightN;
    for (let di = -30; di <= 30; di++) for (let dj = -30; dj <= 30; dj++) // (all it can see)
      if (sim.getTerrainAt(b[0] + di, b[1] + dj) === "grass") S.setGrassKg((b[0] + di) * H + b[1] + dj, 0);
    S.growGrass(1e9); // (grows back to its limit: under the rock, a third as much)
    out.most = { rock: sim.grassFoodAt(b[0], b[1]) / sim.grassMaxKg, open: sim.grassFoodAt(b[0] + 5, b[1]) / sim.grassMaxKg };
    for (let di = -30; di <= 30; di++) for (let dj = -30; dj <= 30; dj++)
      if (sim.getTerrainAt(b[0] + di, b[1] + dj) === "grass") S.setGrassKg((b[0] + di) * H + b[1] + dj, 0);
    const rockKg = sim.grassMostAt(b[0], b[1]);
    S.setGrassKg(b[0] * H + b[1], rockKg); // only the grass under the rock
    const [stag, hind] = [true, false].map(male => sim.allCritters.find(c => c.species === "deer" && c.isMale === male && sim.isGrown(c)));
    const put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; c.wind = c.stamina = 1; S.setCritterIdle(c); };
    put(hind, b[0] - 1.5, b[1] + 0.5); sim.internals.setFood(hind, 0.5); hind.mateUid = null; mind.forget(hind); mind.ignore(hind, false);
    let eatingTicks = 0, facing = true, inside = false;
    for (let k = 0; k < 15 / sim.tempo && sim.grassFoodAt(b[0], b[1]) > 0; k++) {
      S.tick();
      if (hind.eating && hind.eatAt) {
        eatingTicks++;
        if (sim.getDir(b[0] + 0.5 - hind.gx, b[1] + 0.5 - hind.gy, -1) !== hind.currentDirection) facing = false;
      }
      if (Math.floor(hind.gx) === b[0] && Math.floor(hind.gy) === b[1]) inside = true;
    }
    const rate = S.SPEEDS.eatKgPerS.deer;
    out.boulder = { left: sim.grassFoodAt(b[0], b[1]), eatingS: +(eatingTicks * sim.tempo).toFixed(2),
      expectS: +(rockKg / rate).toFixed(2), fullTileS: +(sim.grassMaxKg / rate).toFixed(2), facing, inside,
      at: [hind.gx - b[0], hind.gy - b[1]].map(v => +v.toFixed(1)) };
    mind.ignore(hind);
    // a pair: the hind stands; the stag starts just beyond pairStay (6) of her
    S.critterByUid.forEach(o => { if (o.mateUid === stag.uid || o.mateUid === hind.uid) o.mateUid = null; });
    stag.mateUid = null; hind.mateUid = null; S.pair(stag, hind);
    hind.lastBredAt = stag.lastBredAt = sim.now; // (not in heat)
    put(hind, b[0] - 3.5, b[1] - 3.5); sim.setIntent(hind, { gait: "idle" });
    put(stag, hind.gx + 7, hind.gy); sim.internals.setFood(stag, 1); mind.forget(stag); mind.ignore(stag, false);
    const log0 = mind.pacing.log.length;
    let closest = Infinity;
    for (let k = 0; k < 20 / sim.tempo; k++) { S.tick(); closest = Math.min(closest, Math.hypot(stag.gx - hind.gx, stag.gy - hind.gy)); }
    out.pair = { closest: +closest.toFixed(2), flagged: mind.pacing.log.slice(log0).filter(e => e.uid === stag.uid).length };
    mind.ignore(stag);
    return out;
  });
  r.check(pace && Math.abs(pace.most.rock - 1 / 3) < 1e-6 && Math.abs(pace.most.open - 1) < 1e-6,
    `grass under a boulder grows to a third of the most (${JSON.stringify(pace && pace.most)})`);
  const B = pace && pace.boulder;
  r.check(B && B.left === 0 && !B.inside && B.facing && Math.abs(B.eatingS / B.expectS - 1) < 0.1
    && Math.abs(B.eatingS / B.fullTileS - 1 / 3) < 0.05,
    `a hungry deer eats the grass under a boulder from beside it, facing it, in ${B && B.eatingS} s (a full open tile: ${B && B.fullTileS} s) (${JSON.stringify(B)})`);
  r.check(pace && pace.pair.closest <= 3.2 && pace.pair.flagged === 0,
    `a paired stag beyond his limit comes well back to his hind, not to and fro across it (${JSON.stringify(pace && pace.pair)})`);

  // GIVING WAY: a deer standing in another's path, bumped, steps aside, and the other walks
  // on through
  await fresh();
  const way = await p.evaluate(() => {
    if (!setup({ deerAt: [30, 30], deerThinks: false })) return null;
    const S = sim.internals, w = __w, out = {};
    w.gx = w.nextGX = w.gy = w.nextGY = -800; mind.ignore(w);
    // (two hinds: one wouldn't court the other)
    const [a, b] = sim.allCritters.filter(c => c.species === "deer" && sim.isGrown(c) && !c.isMale && c !== __d).slice(0, 2);
    const at = [__d.gx - 30, __d.gy - 30];
    __d.gx = __d.nextGX = __d.gy = __d.nextGY = -820; mind.ignore(__d);
    const put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; sim.internals.setFood(c, 1); c.wind = c.stamina = 1; c.lifespanS = 1e9; S.setCritterIdle(c); };
    put(a, at[0] + 2, at[1]); mind.forget(a); mind.ignore(a, false);
    put(b, at[0], at[1]); mind.ignore(b);
    // at rest: planning to stand a long while (as a calm critter may: mind.js calm)
    mind.rest(a, 100);
    for (let k = 0; k < 60; k++) S.tick();
    out.standing = a.pose === "idle";
    const a0 = [a.gx, a.gy];
    sim.setIntent(b, { dx: 1, dy: 0, gait: "walk" });
    const modes = new Set();
    for (let k = 0; k < 6 / sim.tempo && b.gx < a0[0] + 1.5; k++) { S.tick(); modes.add(mind.stateOf(a).mode); }
    out.passed = b.gx >= a0[0] + 1.5; out.modes = [...modes];
    out.aside = +Math.hypot(a.gx - a0[0], a.gy - a0[1]).toFixed(2);
    mind.ignore(a);
    return out;
  });
  r.check(way && way.standing && way.passed && way.modes.includes("yield") && way.aside > 0.3,
    `a deer standing in another's way, bumped, steps aside; the other walks on through (${JSON.stringify(way)})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "senses and decisions", main };
if (require.main === module) runStandalone(module.exports.name, main);
