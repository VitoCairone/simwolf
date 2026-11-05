// Water and tired critters (see SWIMMING in sim.js; waitAshore and toShore in mind.js):
//  - a wolf whose prey is swimming doesn't go in after it (nor kills it there): it waits
//    on the shore, going (trotting, never into the water) to where the deer is swimming to
//  - a critter with less than a quarter of its stamina may not go into the water (but the
//    player's wolf while the player steers it)
//  - a swimmer remembers where it entered the water, and the nearest land it has seen since;
//    once it has burned 45% of the stamina it went in with, it makes for the nearer,
//    whatever else it is doing (fleeing too); seeing no land, back where it went in
//  - out of stamina in the water (it shouldn't be), an error is logged, and it swims on to
//    the shore it knows of

const { openGame, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser);
  // a straight shore: land to the west (3 tiles), water to the east (6), 9 tiles long
  const shore = await p.evaluate(() => {
    sim.pause();
    sim.allCritters.forEach(c => { c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = c.targetSpeed = 0; mind.ignore(c); });
    const T = (i, j) => sim.getTerrainAt(i, j);
    for (let i = sim.startNear.i0; i < sim.startNear.i1; i++) for (let j = sim.startNear.j0; j < sim.startNear.j1; j++) {
      let ok = true;
      for (let dj = -4; dj <= 4 && ok; dj++) {
        if (!sim.isLandTile(i - 1, j + dj)) ok = false; // low enough to step onto from the water
        for (let k = 1; k <= 3 && ok; k++) if (sim.isBlockedTile(i - k, j + dj) || T(i - k, j + dj) === "water") ok = false;
        for (let k = 0; k < 10 && ok; k++) if (T(i + k, j + dj) !== "water") ok = false; // (far land farther than this side)
      }
      if (ok) return [i, j];
    }
    return null;
  });
  r.check(!!shore, `found a straight shore to test on (${JSON.stringify(shore)})`);
  if (!shore) { await p.close(); return; }

  // 1. a hungry wolf, a deer swimming toward the wolf's shore further along it: the wolf
  //    goes (along the shore, never into the water) to where the deer will come ashore
  const wait = await p.evaluate(([i, j]) => {
    const S = sim.internals;
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf);
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const place = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; S.setCritterIdle(c); c.speed = 0; };
    place(w, i - 2.5, j - 3.5); place(d, i + 4.5, j + 3.5);
    w.hx = w.hy = Math.SQRT1_2; // (facing the deer)
    sim.internals.setFood(w, 0.3); w.wind = w.stamina = 1; d.wind = d.stamina = 1;
    mind.forget(w); mind.ignore(w, false);
    S.setCritterMoving(d, sim.DIR_W, "walk"); // swimming for the shore (grid -x)
    let wolfSwam = false, galloped = false, modes = new Set(), spot = null;
    let n = 0;
    for (; n < 6 * 60 && d.pose === "swim"; n++) {
      S.setCritterMoving(d, sim.DIR_W, "walk");
      S.tick();
      if (w.pose === "swim") wolfSwam = true;
      if (w.pose === "gallop") galloped = true;
      const st = mind.stateOf(w);
      modes.add(st.mode);
      if (st.watch) spot = st.watch.spot;
    }
    const out = { wolfSwam, galloped, modes: [...modes].join(","), spot, landedAfterS: n * sim.tempo,
      deerAt: [d.gx, d.gy], wolfAt: [w.gx, w.gy], wolfToDeer: Math.hypot(w.gx - d.gx, w.gy - d.gy) };
    // swimming away from the shore: it looks for the far shore along its way
    place(d, i + 2.5, j); S.setCritterMoving(d, sim.DIR_E, "walk");
    let far = null;
    for (let k = 1; k <= 40 && !far; k++) if (sim.isLandTile(i + 2 + k, j)) far = [i + 2.5 + k, j + 0.5];
    for (let k = 0; k < 20; k++) { S.setCritterMoving(d, sim.DIR_E, "walk"); S.tick(); }
    out.awaySpot = mind.stateOf(w).watch?.spot ?? null; out.far = far; out.awayDeerX = d.gx;
    mind.ignore(w);
    place(w, -60, -60); place(d, -64, -64);
    return out;
  }, shore);
  const landing = [shore[0] - 0.5, shore[1] + 3.5];
  r.check(wait.modes.includes("wait") && !wait.modes.includes("chase") && !wait.wolfSwam && !wait.galloped,
    `a wolf doesn't go into the water after a swimming deer: it waits on the shore (modes ${wait.modes}; ` +
    `swam: ${wait.wolfSwam}, galloped: ${wait.galloped})`);
  r.check(wait.spot && wait.spot[0] === landing[0] && wait.spot[1] === landing[1] && wait.wolfToDeer < 2.5,
    `...where the deer is swimming to: it waits at ${JSON.stringify(wait.spot)} (the deer lands at ${JSON.stringify(landing)}), ` +
    `${wait.wolfToDeer.toFixed(1)} tiles from the deer as it comes ashore after ${wait.landedAfterS.toFixed(1)} s`);
  r.check(wait.far ? (wait.awaySpot && wait.awaySpot[0] === wait.far[0] && wait.awaySpot[1] === wait.far[1])
    : (wait.awaySpot && wait.awaySpot[0] < wait.awayDeerX),
    `...and when it swims away, the far shore it is heading for (${JSON.stringify(wait.awaySpot)}; far shore ` +
    `${wait.far ? JSON.stringify(wait.far) : "none within 40 tiles, so the land nearest it"})`);

  // a waiting wolf that loses sight of the swimmer loses interest at once
  const gaveUp = await p.evaluate(([i, j]) => {
    const S = sim.internals;
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf);
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const place = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; S.setCritterIdle(c); c.speed = 0; };
    place(w, i - 2.5, j - 3.5); place(d, i + 4.5, j + 3.5);
    sim.internals.setFood(w, 0.3); w.wind = w.stamina = 1; d.wind = d.stamina = 1;
    mind.forget(w); mind.ignore(w, false);
    for (let n = 0; n < 60; n++) { S.setCritterMoving(d, sim.DIR_E, "walk"); S.tick(); }
    const waiting = mind.stateOf(w).mode;
    place(d, -64, -64); // out of sight
    for (let n = 0; n < 12; n++) S.tick(); // two turns
    const st = mind.stateOf(w), k = st.known.find(o => o.uid === d.uid);
    const out = { waiting, after: st.mode, lost: !!(k && k.lost) };
    mind.ignore(w); place(w, -60, -60);
    return out;
  }, shore);
  r.check(gaveUp.waiting === "wait" && gaveUp.after !== "wait" && gaveUp.lost,
    `a waiting wolf that loses sight of the swimmer loses interest at once (${gaveUp.waiting} -> ${gaveUp.after})`);

  // no kills in the water: a wolf on top of a swimming deer doesn't kill it
  const noKill = await p.evaluate(([i, j]) => {
    const S = sim.internals;
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf);
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const place = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; S.setCritterIdle(c); c.speed = 0; };
    place(d, i + 3.5, j + 0.5); place(w, i + 3.5, j + 0.9);
    for (let k = 0; k < 30; k++) S.tick();
    const alive = sim.isLiveCritter(d) && d.pose === "swim";
    place(w, -60, -60); place(d, -64, -64);
    return alive;
  }, shore);
  r.check(noKill, `no kills in the water: a wolf on top of a swimming deer doesn't kill it`);

  // 2. tired (less than a quarter of its stamina): may not go into the water
  const tired = await p.evaluate(([i, j]) => {
    const S = sim.internals, pc = sim.pcWolf;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const place = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; S.setCritterIdle(c); c.speed = 0; };
    place(d, i - 1.5, j + 0.5); d.stamina = 0.2;
    const canStep = sim.canStepTo(d, i + 1.5, j + 0.5);
    S.setCritterMoving(d, sim.DIR_E, "walk");
    let swam = false, blocked = false;
    for (let n = 0; n < 120; n++) { S.tick(); if (d.pose === "swim") swam = true; if (d.blockedTick === sim.tickCount - 1) blocked = true;
      if (!(d.stunnedUntil > sim.tickCount)) S.setCritterMoving(d, sim.DIR_E, "walk"); }
    const deer = { canStep, swam, blocked, x: d.gx };
    place(d, -64, -64);
    // the player's wolf, steered by the player, may
    place(pc, i - 1.5, j + 0.5); pc.stamina = 0.2;
    sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" });
    let pcSwam = false;
    for (let n = 0; n < 180; n++) { S.tick(); if (pc.pose === "swim") pcSwam = true; }
    sim.setPlayerIntent(null); S.tick();
    place(pc, -60, -70);
    return { deer, pcSwam };
  }, shore);
  r.check(!tired.deer.canStep && !tired.deer.swam && tired.deer.blocked && tired.deer.x < shore[0] + 1,
    `a tired deer (20% stamina) may not go into the water: it is stopped at the edge ` +
    `(canStepTo: ${tired.deer.canStep}, swam: ${tired.deer.swam}, blocked: ${tired.deer.blocked})`);
  r.check(tired.pcSwam, `...but the player's wolf, steered by the player, may (swam: ${tired.pcSwam})`);

  // a deer goes into the water from the shore, walking east with full stamina, to x = i + out
  // (its mind meanwhile noting where it went in: TIRED SWIMMERS); then left to its mind
  await p.evaluate(() => {
    window.__swimOut = (i, j, out) => {
      const S = sim.internals, d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
      d.gx = d.nextGX = i - 1.5; d.gy = d.nextGY = j + 0.5; d.stunnedUntil = 0; d.speed = 0; d.stamina = 1;
      S.setCritterIdle(d); S.setFood(d, 1);
      mind.forget(d); mind.ignore(d, false);
      for (let n = 0; n < 20; n++) S.tick(); // (its footing noted)
      for (let n = 0; n < 8 * 60 && d.gx < i + out; n++) { sim.setIntent(d, { dx: 1, dy: 0, gait: "walk" }); S.tick(); }
      return d;
    };
  });

  // 3. once it has burned 45% of the stamina it went in with, a swimmer makes for land
  const back = await p.evaluate(([i, j]) => {
    const S = sim.internals, d = __swimOut(i, j, 4);
    const modes = new Set(), went = mind.stateOf(d).entryStamina;
    d.stamina = 0.56 * went; for (let n = 0; n < 30; n++) { S.tick(); modes.add(mind.stateOf(d)?.mode); }
    const before = [...modes].filter(Boolean);
    d.stamina = 0.55 * went;
    let n = 0;
    for (; n < 10 * 60 && d.pose === "swim"; n++) { S.tick(); modes.add(mind.stateOf(d)?.mode); }
    const out = { before, s: n * sim.tempo, pose: d.pose, x: d.gx, modes: [...modes].filter(Boolean).join(","), went };
    mind.ignore(d);
    return out;
  }, shore);
  r.check(!back.before.includes("ashore") && back.pose !== "swim" && back.x < shore[0] + 0.5 && back.modes.includes("ashore"),
    `a swimmer that has burned 45% of the stamina it went in with makes for land (not before: ${back.before}): ashore after ${back.s.toFixed(1)} s ` +
    `(x ${back.x.toFixed(2)} vs shore ${shore[0]})`);

  // 4. it remembers where it went in: seeing no land at all (its sight switched off for the
  // test), it swims back there, and forgets it once ashore
  const blind = await p.evaluate(([i, j]) => {
    const S = sim.internals, see = senses.canSeeTile;
    senses.canSeeTile = () => false;
    const d = __swimOut(i, j, 5);
    const st = mind.stateOf(d), out = { out: +d.gx.toFixed(2), entry: st.entry, landSeen: st.landSeen };
    d.stamina *= 0.5;
    const modes = new Set();
    let n = 0;
    for (; n < 12 * 60 && d.pose === "swim"; n++) { S.tick(); modes.add(mind.stateOf(d)?.mode); }
    Object.assign(out, { s: n * sim.tempo, pose: d.pose, modes: [...modes].filter(Boolean).join(",") });
    out.after = "kept";
    for (let k = 0; k < 30 && out.after === "kept"; k++) { S.tick(); if (d.pose !== "swim" && mind.stateOf(d).entry === null) out.after = null; } // (its next turn on land)
    senses.canSeeTile = see;
    mind.ignore(d);
    return out;
  }, shore);
  r.check(blind.entry && blind.entry[0] === shore[0] - 1 && Math.abs(blind.entry[1] - shore[1]) <= 1 && blind.landSeen === null && blind.pose !== "swim" && blind.modes.includes("ashore") && blind.after === null,
    `a swimmer remembers where it entered the water (${blind.entry}): seeing no land, it swims back there from ${blind.out} (ashore after ${blind.s.toFixed(1)} s, ` +
    `then forgets it: ${blind.after})`);

  // 5. turning back overrides all else: a deer swimming, fleeing a wolf in the water between
  // it and the shore
  const flight = await p.evaluate(([i, j]) => {
    const S = sim.internals;
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isGrown(c));
    const d = __swimOut(i, j, 3);
    const went = mind.stateOf(d).entryStamina, run = share => {
      const modes = new Set();
      // (from its next turn on; the wolf held 2 tiles west of it)
      for (let n = 0; n < 60; n++) {
        w.gx = w.nextGX = d.gx - 2; w.gy = w.nextGY = d.gy; w.speed = 0; w.hx = 1; w.hy = 0;
        d.stamina = share * went; S.tick(); if (d.pose === "swim" && n > mind.turnTicks) modes.add(mind.stateOf(d)?.mode);
      }
      return [...modes].filter(Boolean);
    };
    const out = { fresh: run(0.7), spent: run(0.5) };
    mind.ignore(d);
    w.gx = w.nextGX = w.gy = w.nextGY = -300;
    return out;
  }, shore);
  r.check(flight.fresh.includes("flee") && !flight.fresh.includes("ashore") && flight.spent.includes("ashore") && !flight.spent.includes("flee"),
    `a swimmer fleeing a wolf keeps fleeing (${flight.fresh}) until it has burned 45% of the stamina it went in with; then it makes for land all the same (${flight.spent})`);

  // 6. out of stamina in the water (which shouldn't happen): an error logged, and it swims
  // on to the shore it knows of
  const errors = [];
  p.on("console", msg => { if (msg.type() === "error" && msg.text().startsWith("[stamina]")) errors.push(msg.text()); });
  const spent = await p.evaluate(([i, j]) => {
    const S = sim.internals, d = __swimOut(i, j, 4);
    mind.ignore(d);
    d.stamina = 0.0001; S.setCritterMoving(d, sim.DIR_E, "walk");
    for (let n = 0; n < 10; n++) S.tick();
    const speed = d.speed;
    mind.ignore(d, false);
    let n = 0;
    for (; n < 12 * 60 && d.pose === "swim"; n++) S.tick();
    const out = { stamina: d.stamina, speed, s: n * sim.tempo, pose: d.pose, x: d.gx };
    mind.ignore(d);
    return out;
  }, shore);
  await p.waitForTimeout(100);
  r.check(errors.length === 1 && spent.speed > 0 && spent.pose !== "swim" && spent.x < shore[0] + 0.5,
    `a swimmer out of stamina logs an error (${JSON.stringify(errors)}), swims on (speed ${spent.speed.toFixed(3)}) and back to the shore it knows of (ashore after ${spent.s.toFixed(1)} s)`);

  // 7. a critter climbing out up a bank higher than a step is slowed; onto a flat beach,
  // not; either way it speeds up out of the water as on land
  const climb = await p.evaluate(() => {
    const S = sim.internals, A = sim.startNear;
    const water = (i, j) => sim.getTerrainAt(i, j) === "water";
    const maxC = (i, j) => Math.max(...sim.tileCorners(i, j));
    // water 4 tiles wide back from (i, j), a flat beach 4 tiles on (open, at the water's
    // level), along one of the 4 grid directions (u: [di, dj]). The shores here are
    // beaches; for a bank, a second one's land is raised a level.
    const ways = [[[1, 0], sim.DIR_E], [[-1, 0], sim.DIR_W], [[0, 1], sim.DIR_S], [[0, -1], sim.DIR_N]];
    const find = skip => {
      for (let i = A.i0; i < A.i1; i++) for (let j = A.j0; j < A.j1; j++) for (const [[ui, uj], dir] of ways) {
        if (skip && Math.abs(i - skip.i) < 12 && Math.abs(j - skip.j) < 12) continue;
        const at = (d, side = 0) => [i + ui * d + uj * side, j + uj * d + ui * side];
        if (![-3, -2, -1, 0].every(d => water(...at(d)) && water(...at(d, -1)) && water(...at(d, 1)))) continue;
        if (![1, 2, 3, 4].every(d => sim.isLandTile(...at(d)) && !sim.isBlockedTile(...at(d)))) continue;
        const w = sim.waterLevelAt(i, j);
        if ([1, 2, 3, 4].some(d => maxC(...at(d)) !== w)) continue;
        return { i, j, ui, uj, dir, at, w };
      }
      return null;
    };
    const spots = { flat: find(null) };
    spots.bank = find(spots.flat);
    if (spots.bank) {
      const b = spots.bank;
      for (let d = 1; d <= 6; d++) for (let side = -2; side <= 2; side++) {
        const [i, j] = b.at(d, side);
        if (!water(i, j)) S.setTileCorners(i, j, [b.w + 1, b.w + 1, b.w + 1, b.w + 1]);
      }
    }
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isLiveCritter(c));
    sim.allCritters.forEach(c => { c.gx = c.nextGX = c.gy = c.nextGY = -50 - c.uid * 3; mind.ignore(c); });
    const run = (c, spot) => {
      if (!spot) return null;
      c.gx = c.nextGX = spot.i + 0.5 - 3 * spot.ui; c.gy = c.nextGY = spot.j + 0.5 - 3 * spot.uj; c.speed = 0; c.stunnedUntil = 0;
      c.wind = c.stamina = 1; c.climbingUntil = 0;
      S.setCritterIdle(c);
      const poses = [], speeds = [];
      let swimSpeed = null;
      for (let k = 0; k < 6 / sim.tempo; k++) {
        c.wind = c.stamina = 1;
        sim.setIntent(c, { dir: spot.dir, gait: "gallop" });
        if (c.pose === "swim") swimSpeed = c.speed;
        S.tick();
        if (c.pose !== "swim") { poses.push(c.pose); speeds.push(c.speed); }
      }
      // the land poses in order, with how many ticks each
      const runs = [];
      for (const q of poses) { if (runs.length && runs.at(-1)[0] === q) runs.at(-1)[1]++; else runs.push([q, 1]); }
      const gallop = S.travelSpeedBySpeciesAndPose[c.species].gallop;
      const step = gallop / (S.SPEEDS.accelToGallopS[c.species] / sim.tempo);
      const rises = speeds.map((v, k) => v - (k ? speeds[k - 1] : swimSpeed));
      const reachedAt = speeds.findIndex(v => v >= gallop - 1e-9);
      c.gx = c.nextGX = c.gy = c.nextGY = -50 - c.uid * 3;
      return { runs, smooth: Math.max(...rises) <= step + 1e-9, fromSwim: swimSpeed, reachedS: reachedAt * sim.tempo };
    };
    return { deer: { bank: run(d, spots.bank), flat: run(d, spots.flat) }, wolf: { bank: run(w, spots.bank), flat: run(w, spots.flat) },
      accelS: S.SPEEDS.accelToGallopS };
  });
  const slowTicks = Math.round(1.5 * 60);
  for (const sp of ["deer", "wolf"]) {
    const { bank, flat } = climb[sp];
    r.check(bank && bank.runs[0][0] === "walk" && Math.abs(bank.runs[0][1] - slowTicks) <= 2 && bank.runs.some(([q]) => q === "gallop"),
      `a ${sp} galloping out of the water up a bank walks for 1.5 s, then gallops (${bank && JSON.stringify(bank.runs)})`);
    r.check(flat && flat.runs[0][0] === "gallop" && flat.smooth && bank.smooth && flat.reachedS > 0
      && flat.reachedS <= climb.accelS[sp] + 0.05,
      `...out onto a flat beach it gallops straight on; either way it speeds up from its swimming speed at the usual rate, ` +
      `reaching a full gallop off the beach in ${flat && flat.reachedS.toFixed(2)} s (at most ${climb.accelS[sp]} s from standing)`);
  }

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "water and tired critters", main };
if (require.main === module) runStandalone(module.exports.name, main);
