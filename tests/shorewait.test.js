// Water and tired critters (see SWIMMING in sim.js; waitAshore and toShore in mind.js):
//  - a wolf whose prey is swimming doesn't go in after it (nor kills it there): it waits
//    on the shore, going (trotting, never into the water) to where the deer is swimming to
//  - a critter with less than a quarter of its stamina may not go into the water (but the
//    player's wolf while the player steers it); in the water, it heads for the nearest
//    land it can climb onto

const { openGame, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser);
  // a straight shore: land to the west (3 tiles), water to the east (6), 9 tiles long
  const shore = await p.evaluate(() => {
    sim.pause();
    sim.allCritters.forEach(c => { c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = c.targetSpeed = 0; mind.ignore(c); });
    const T = (i, j) => sim.getTerrainAt(i, j);
    for (let i = 8; i < sim.gridWidthN - 12; i++) for (let j = 8; j < sim.gridHeightN - 8; j++) {
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

  // 3. a tired swimmer heads for the nearest land
  const ashore = await p.evaluate(([i, j]) => {
    const S = sim.internals;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    d.gx = d.nextGX = i + 3.5; d.gy = d.nextGY = j + 0.5; d.stunnedUntil = 0; d.speed = 0;
    S.setCritterIdle(d); S.setCritterMoving(d, sim.DIR_E, "walk"); // swimming away from the shore
    d.stamina = 0.2; sim.internals.setFood(d, 1);
    mind.forget(d); mind.ignore(d, false);
    const modes = new Set();
    let n = 0;
    for (; n < 10 * 60 && d.pose === "swim"; n++) { S.tick(); modes.add(mind.stateOf(d)?.mode); }
    const out = { s: n * sim.tempo, pose: d.pose, x: d.gx, modes: [...modes].filter(Boolean).join(",") };
    mind.ignore(d);
    return out;
  }, shore);
  r.check(ashore.pose !== "swim" && ashore.x < shore[0] + 0.5 && ashore.modes.includes("ashore"),
    `a tired swimmer heads for the nearest land: ashore after ${ashore.s.toFixed(1)} s (${ashore.modes}; pose ${ashore.pose}, x ${ashore.x.toFixed(2)} vs shore ${shore[0]})`);

  // 4. a critter climbing out up a bank higher than a step is slowed; onto a flat beach,
  // not; either way it speeds up out of the water as on land
  const climb = await p.evaluate(() => {
    const S = sim.internals, W = sim.gridWidthN, H = sim.gridHeightN;
    const water = (i, j) => sim.getTerrainAt(i, j) === "water";
    const maxC = (i, j) => Math.max(...sim.tileCorners(i, j));
    // water at i-3..i, land at i+1..i+4 (open), along +i; bank: the first land tile rises
    const find = bank => {
      for (let i = 4; i < W - 6; i++) for (let j = 2; j < H - 2; j++) {
        if (![-3, -2, -1, 0].every(d => water(i + d, j) && water(i + d, j - 1) && water(i + d, j + 1))) continue;
        if (![1, 2, 3, 4].every(d => sim.isLandTile(i + d, j) && !sim.isBlockedTile(i + d, j))) continue;
        if (bank ? maxC(i + 1, j) !== 1 : [1, 2, 3, 4].some(d => maxC(i + d, j) !== 0)) continue;
        return [i, j];
      }
      return null;
    };
    const spots = { bank: find(true), flat: find(false) };
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isLiveCritter(c));
    sim.allCritters.forEach(c => { c.gx = c.nextGX = c.gy = c.nextGY = -50 - c.uid * 3; mind.ignore(c); });
    const run = (c, spot) => {
      if (!spot) return null;
      c.gx = c.nextGX = spot[0] - 2.5; c.gy = c.nextGY = spot[1] + 0.5; c.speed = 0; c.stunnedUntil = 0;
      c.wind = c.stamina = 1; c.climbingUntil = 0;
      S.setCritterIdle(c);
      const poses = [], speeds = [];
      let swimSpeed = null;
      for (let k = 0; k < 6 / sim.tempo; k++) {
        c.wind = c.stamina = 1;
        sim.setIntent(c, { dir: sim.DIR_E, gait: "gallop" });
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
