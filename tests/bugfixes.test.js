// Regression tests for the first round of bug fixes:
//  1 spawn at tile centers (no spawning against impassable terrain)
//  2 overlap check at start + collision broad/narrow phase use the same box
//  3 an idle (standing) deer can be killed
//  4 a dying deer can't come back to life
//  5 death animation timing and corpse frame
//  6 resting recovers: wind and stamina refill while idle and stay within 0..1
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
      sim.allCritters.forEach((a, i) => {
        if (sim.internals.getOccupiedTiles(a.gx, a.gy).some(t =>
          sim.isBlockedTile(...t.split("_").map(Number)))) s++;
        sim.allCritters.slice(i + 1).forEach(b => {
          const span = 2 * sim.internals.critterBoxRad;
          if (Math.abs(a.gx - b.gx) < span && Math.abs(a.gy - b.gy) < span) o++;
        });
      });
      return [s, o];
    });
    badSpawns += s; overlaps += o;
    if (page.problems.length) r.noProblems(page, `(load ${k})`);
    await page.close();
  }
  r.check(badSpawns === 0, `bug 1: spawns touching blocked tiles across ${LOADS} loads = ${badSpawns}`);
  r.check(overlaps === 0, `bug 2: overlapping spawn pairs across ${LOADS} loads = ${overlaps}`);

  const page = await openGame(browser);

  const separated = await page.evaluate(() => {
    sim.pause();
    const [a, b] = [sim.allCritters[3], sim.allCritters[4]];
    b.gx = a.gx; b.gy = a.gy;
    sim.internals.forbidOverlapsOnStart();
    const span = 2 * sim.internals.critterBoxRad;
    return Math.abs(a.gx - b.gx) >= span || Math.abs(a.gy - b.gy) >= span;
  });
  r.check(separated, "bug 2: forbidOverlapsOnStart separates a forced overlap");

  // 3 + 4 + 5: a wolf walks into an idle deer
  const k = await page.evaluate(() => {
    const w = sim.internals.wolves[1], d = sim.internals.deer[0];
    // find open ground with room for both
    const t = sim.internals.allLandTiles.find(([i, j]) =>
      [-1, 0, 1, 2, 3].every(di => [-1, 0, 1].every(dj => {
        return !sim.isBlockedTile(i + di, j + dj) && sim.getTerrainAt(i + di, j + dj) !== "water"; })));
    // move everyone else far away
    sim.allCritters.filter(c => c !== w && c !== d).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    w.gx = t[0] + 0.5; w.gy = t[1] + 0.5; d.gx = t[0] + 1.6; d.gy = t[1] + 0.5;
    w.stunnedUntil = d.stunnedUntil = 0; // not stunned from before they were moved
    sim.internals.setCritterIdle(d); mind.ignore(d); mind.ignore(w); w.wind = 1; w.stamina = 1;
    sim.internals.setCritterMoving(w, sim.DIR_E, "walk");
    let diedAt = null; const poses = [], bgs = [];
    for (let n = 0; n < 120; n++) {
      sim.internals.tick(); animat.render();
      if (d.pose === "death" && diedAt === null) { diedAt = sim.tickCount; sim.setIntent(d, { dir: sim.DIR_W, gait: "gallop" }); } // told to run while dying
      poses.push(d.pose);
      if (d.pose === "death" || d.pose === "dead") bgs.push([animat.spriteOf(d).col, animat.spriteOf(d).row].join());
    }
    const deadData = animat.frameDataBySpeciesAndPose.deer.dead;
    const deathData = animat.frameDataBySpeciesAndPose.deer.death;
    return {
      diedAt, final: d.pose, kind: d.kind, inCorpses: sim.allCorpses.includes(d),
      deathTicks: poses.filter(x => x === "death").length,
      expectedDeathTicks: deathData.nFrames * deathData.holdTks,
      walkedAfterDeath: poses.slice(poses.indexOf("death")).includes("walk"),
      corpseClass: animat.spriteOf(d).cls,
      corpseLayers: animat.spriteOf(d).layers?.length,
    };
  });
  r.check(k.diedAt !== null, "bug 3: a wolf kills an IDLE deer");
  r.check(!k.walkedAfterDeath && k.final === "dead" && k.kind === "corpse" && k.inCorpses,
    "bug 4: a dying deer told to run still becomes a corpse");
  r.check(k.deathTicks === k.expectedDeathTicks,
    `bug 5: death animation plays in full (${k.deathTicks} ticks, expected ${k.expectedDeathTicks})`);
  r.check(k.corpseClass === "critter deer-carcass" && k.corpseLayers === 9,
    `bug 5: the corpse shows the whole carcass, skeleton and all 8 pieces (${k.corpseClass}, ${k.corpseLayers} layers)`);

  // 6: resting recovers (on dry land: swimming changes neither reserve)
  await moveToOpenLand(page);
  const f = await page.evaluate(() => {
    const w = sim.pcWolf;
    w.wind = 0; w.stamina = 0.5; w.pose = "walk"; sim.internals.setCritterIdle(w);
    for (let n = 0; n < 600; n++) sim.internals.tick(); // 10 s idle
    const after = { wind: w.wind, stamina: w.stamina };
    w.wind = 1; w.stamina = 1;
    for (let n = 0; n < 600; n++) sim.internals.tick();
    return { after, capped: [w.wind, w.stamina],
      expectWind: 1 - Math.pow(0.5, 10 / sim.internals.windRefillHalfLifeSByPose.idle),
      expectStamina: 0.5 + 10 / sim.internals.staminaFullRefillSByPose.idle };
  });
  r.check(Math.abs(f.after.wind - f.expectWind) < 1e-6 && Math.abs(f.after.stamina - f.expectStamina) < 1e-6,
    `bug 6: 10 s idle refills wind 0 -> ${f.after.wind.toFixed(3)} and stamina 0.5 -> ${f.after.stamina.toFixed(5)}`);
  r.check(f.capped[0] === 1 && f.capped[1] === 1, `bug 6: reserves never exceed full (got ${f.capped})`);

  r.noProblems(page);
  await page.close();

  // soak: run normally for a while, then check sprite depth ordering
  const soak = await openGame(browser);
  await soak.waitForTimeout(10000);
  const s = await soak.evaluate(() => ({ tick: sim.tickCount, live: sim.allCritters.length, corpses: sim.allCorpses.length }));
  r.check(s.tick > 500, `soak: 10 s of normal play ran ${s.tick} ticks (${s.live} live, ${s.corpses} corpses)`);

  // 7: after normal play, every sprite's z-index is a valid integer that follows the
  // drawing order (animat.spriteZIndex: depth-based, swimmers interleaved with land tiles)
  const z = await soak.evaluate(() => sim.allCritters.map(a => [animat.spriteOf(a).z, animat.spriteZIndex(a)]));
  r.check(z.length > 1 && z.every(([zz, expected]) => zz === expected && Number.isInteger(expected)),
    `bug 7: every live sprite's z-index tracks its position (${z.length} checked)`);
  r.noProblems(soak, "during soak");
  await soak.close();
}

module.exports = { name: "bug fixes (round 1)", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
