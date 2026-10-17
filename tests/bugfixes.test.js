// Regression tests for the first round of bug fixes:
//  1 spawn at tile centers (no spawning against impassable terrain)
//  2 overlap check at start + collision broad/narrow phase use the same box
//  3 an idle (standing) deer can be killed
//  4 a dying deer can't come back to life
//  5 death animation timing and corpse frame
//  6 fatigue recovers while idle and never goes below 0
//  7 sprite z-index is a valid integer that tracks position

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

async function main(browser, r) {
  // 1 + 2: spawn positions over many page loads
  let badSpawns = 0, overlaps = 0;
  const LOADS = 30;
  for (let k = 0; k < LOADS; k++) {
    const page = await openGame(browser);
    const [s, o] = await page.evaluate(() => {
      let s = 0, o = 0;
      allCritters.forEach((a, i) => {
        if (getOccupiedTiles(a.gx, a.gy).some(t =>
          isImpassable(getTerrainAt(...t.split("_").map(Number))))) s++;
        allCritters.slice(i + 1).forEach(b => {
          const span = 2 * critterBoxRad;
          if (Math.abs(a.gx - b.gx) < span && Math.abs(a.gy - b.gy) < span) o++;
        });
      });
      return [s, o];
    });
    badSpawns += s; overlaps += o;
    if (page.problems.length) r.noProblems(page, `(load ${k})`);
    await page.close();
  }
  r.check(badSpawns === 0, `bug 1: spawns touching impassable terrain across ${LOADS} loads = ${badSpawns}`);
  r.check(overlaps === 0, `bug 2: overlapping spawn pairs across ${LOADS} loads = ${overlaps}`);

  const page = await openGame(browser);

  const separated = await page.evaluate(() => {
    pause();
    const [a, b] = [allCritters[3], allCritters[4]];
    b.gx = a.gx; b.gy = a.gy;
    forbidOverlapsOnStart();
    const span = 2 * critterBoxRad;
    return Math.abs(a.gx - b.gx) >= span || Math.abs(a.gy - b.gy) >= span;
  });
  r.check(separated, "bug 2: forbidOverlapsOnStart separates a forced overlap");

  // 3 + 4 + 5: a wolf walks into an idle deer
  const k = await page.evaluate(() => {
    const w = wolves[1], d = deer[0];
    // find open ground with room for both
    const t = allLandTiles.find(([i, j]) =>
      [-1, 0, 1, 2, 3].every(di => [-1, 0, 1].every(dj => {
        const t = getTerrainAt(i + di, j + dj); return !isImpassable(t) && t !== "water"; })));
    // move everyone else far away
    allCritters.filter(c => c !== w && c !== d).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; c.redecideCd = 1e9;
    });
    w.gx = t[0] + 0.5; w.gy = t[1] + 0.5; d.gx = t[0] + 1.6; d.gy = t[1] + 0.5;
    setCritterIdle(d); d.redecideCd = 1e9; w.redecideCd = 1e9; w.fatigue = 0;
    setCritterMoving(w, DIR_E, "walk");
    let diedAt = null; const poses = [], bgs = [];
    for (let n = 0; n < 120; n++) {
      tick();
      if (d.pose === "death" && diedAt === null) { diedAt = g_tick; d.redecideCd = 1; } // force a redecision while dying
      poses.push(d.pose);
      if (d.pose === "death" || d.pose === "dead") bgs.push(d.element.style.backgroundPosition);
    }
    const deadData = frameDataBySpeciesAndPose.deer.dead;
    const deathData = frameDataBySpeciesAndPose.deer.death;
    return {
      diedAt, final: d.pose, kind: d.kind, inCorpses: allCorpses.includes(d),
      deathTicks: poses.filter(x => x === "death").length,
      expectedDeathTicks: deathData.nFrames * deathData.holdTks,
      walkedAfterDeath: poses.slice(poses.indexOf("death")).includes("walk"),
      corpseX: parseInt(d.element.style.backgroundPosition),
      expectedCorpseX: -deadData.colZero * deadData.frameW,
    };
  });
  r.check(k.diedAt !== null, "bug 3: a wolf kills an IDLE deer");
  r.check(!k.walkedAfterDeath && k.final === "dead" && k.kind === "corpse" && k.inCorpses,
    "bug 4: a dying deer forced to redecide still becomes a corpse");
  r.check(k.deathTicks === k.expectedDeathTicks,
    `bug 5: death animation plays in full (${k.deathTicks} ticks, expected ${k.expectedDeathTicks})`);
  r.check(k.corpseX === k.expectedCorpseX,
    `bug 5: corpse shows the frame set by deer.dead.colZero (x ${k.corpseX}px, expected ${k.expectedCorpseX}px)`);

  // 6: fatigue (on dry land: swimming is fatigue-neutral)
  await moveToOpenLand(page);
  const f = await page.evaluate(() => {
    const w = pcWolf;
    w.fatigue = 15000; w.pose = "walk"; setCritterIdle(w);
    for (let n = 0; n < 600; n++) tick(); // 10 s idle
    const afterIdle = w.fatigue;
    w.fatigue = 0.1;
    for (let n = 0; n < 600; n++) tick();
    return { afterIdle, floor: w.fatigue };
  });
  r.check(Math.abs(f.afterIdle - 14990) < 0.5,
    `bug 6: 10 s idle recovers 10 fatigue (15000 -> ${f.afterIdle.toFixed(2)})`);
  r.check(f.floor === 0, `bug 6: fatigue floors at 0 (got ${f.floor})`);

  r.noProblems(page);
  await page.close();

  // soak: run normally for a while, then check sprite depth ordering
  const soak = await openGame(browser);
  await soak.waitForTimeout(10000);
  const s = await soak.evaluate(() => ({ tick: g_tick, live: allCritters.length, corpses: allCorpses.length }));
  r.check(s.tick > 500, `soak: 10 s of normal play ran ${s.tick} ticks (${s.live} live, ${s.corpses} corpses)`);

  // 7: after normal play, every sprite's z-index is a valid integer tracking its position
  const z = await soak.evaluate(() => allCritters.map(a => [a.gx + a.gy, a.element.style.zIndex]));
  r.check(z.length > 1 && z.every(([sum, zz]) => String(Math.round(sum * 100)) === zz),
    `bug 7: every live sprite's z-index tracks its position (${z.length} checked)`);
  r.noProblems(soak, "during soak");
  await soak.close();
}

module.exports = { name: "bug fixes (round 1)", main };
if (require.main === module) runStandalone(module.exports.name, main);
