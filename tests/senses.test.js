// The senses (see senses.js), and how the mind uses them (mind.js):
//  - SIGHT: in the sight rectangle and in line of sight: a boulder (as tall as 3 levels)
//    between two critters hides each from the other; on open level ground they see each
//    other; grass and land too are seen only in line of sight
//  - HEARING: a critter moving on land is heard within a range set by its gait and the
//    ground under it (galloping farther than trotting, trotting than walking); standing
//    still it is silent; swimming it splashes
//  - SMELL: on the wind, a critter downwind smells another far beyond sight, not upwind or
//    across the wind; any within a few tiles, whatever the wind; carcasses with meat too
//  - TRAILS: critters on land leave scent that fades with time; a hungry wolf that knows of
//    no deer follows a deer's trail the way the deer went, never back, and gives it up
//    where it ends (at a kill, say)
//  - MEMORY: what only sight tells (sex, age, partner) is kept when a critter is only heard
//    or smelled afterwards

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 800, height: 600 } });
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 8, clearOthers: true });
  await p.evaluate(() => {
    window.home = [sim.pcWolf.gx, sim.pcWolf.gy];
    window.S = sim.internals;
    window.far = c => { c.gx = c.nextGX = c.gy = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c); };
    window.put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; S.setCritterIdle(c); };
    window.wolfA = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isGrown(c));
    window.deerA = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c));
    window.deerB = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c) && c !== deerA);
    [sim.pcWolf, wolfA, deerA, deerB].forEach(c => { far(c); c.lifespanS = 1e9; c.food = 1; });
    window.by = (a, b) => (senses.perceive(a).find(o => o.uid === b.uid) || {}).by || null;
  });

  // SIGHT
  const sight = await p.evaluate(() => {
    senses.use.hearing = senses.use.smell = false;
    const [hx, hy] = home;
    put(wolfA, hx - 3, hy); put(deerA, hx + 3, hy);
    const open = by(wolfA, deerA);
    // a boulder with level, open ground three tiles either side of it, along i
    const level = (i, j) => { const c = sim.tileCorners(i, j); return Math.max(...c) === Math.min(...c) ? c[0] : null; };
    const free = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
    let b = null;
    for (let i = 4; i < sim.gridWidthN - 4 && !b; i++) for (let j = 0; j < sim.gridHeightN && !b; j++) {
      if (sim.obstacleAt(i, j) !== "boulder") continue;
      const l = level(i - 3, j);
      if (l === null) continue;
      // (walls are 1 or 2 boulders thick: the next tile on may be one too)
      if ([-3, -2, 2, 3].every(d => free(i + d, j) && level(i + d, j) === l)) b = [i, j];
    }
    if (!b) { senses.use.hearing = senses.use.smell = true; return { open, none: true }; }
    put(wolfA, b[0] - 2.5, b[1] + 0.5); put(deerA, b[0] + 3.5, b[1] + 0.5);
    const hidden = [by(wolfA, deerA), by(deerA, wolfA)];
    const tile = senses.canSeeTile(wolfA, b[0] + 3, b[1]);
    const tileNear = senses.canSeeTile(wolfA, b[0] - 1, b[1]);
    senses.use.lineOfSight = false;
    const without = by(wolfA, deerA);
    senses.use.lineOfSight = true;
    senses.use.hearing = senses.use.smell = true;
    return { open, hidden, tile, tileNear, without };
  });
  r.check(sight.open === "sight", `on open level ground, a wolf sees a deer 6 tiles away (${sight.open})`);
  r.check(!sight.none && sight.hidden.every(x => x === null) && !sight.tile && sight.tileNear && sight.without === "sight",
    `a boulder between them hides each from the other, and the ground behind it (${JSON.stringify(sight)})`);

  // HEARING
  const hearing = await p.evaluate(() => {
    senses.use.smell = false;
    const [hx, hy] = home, out = {};
    const terrain = sim.getTerrainAt(hx, hy), R = senses.hearingRangeTiles[terrain];
    // the wolf behind the deer's back is out of its sight only if far: test by hearing alone
    senses.use.lineOfSight = true;
    const tryAt = (gait, dist) => {
      put(deerA, hx, hy); put(wolfA, hx - dist, hy);
      wolfA.wind = wolfA.stamina = 1;
      mind.ignore(wolfA); sim.setIntent(wolfA, { dx: 0, dy: 1, gait });
      for (let k = 0; k < 60; k++) { wolfA.wind = wolfA.stamina = 1; wolfA.gx = wolfA.nextGX = hx - dist; wolfA.gy = wolfA.nextGY = hy; S.tick(); }
      // keep it out of sight: just past the rectangle's edge, straight along -i is |dx - dy| = dist
      return by(deerA, wolfA);
    };
    out.terrain = terrain; out.R = R;
    // just beyond sight's half-width (20.2) along -i: only hearing can tell
    out.walkFar = tryAt("walk", 21);
    out.trotNear = R.trot > 21 ? tryAt("trot", 21) : "n/a";
    out.gallop = R.gallop > 21 ? tryAt("gallop", 21) : "n/a";
    sim.setIntent(wolfA, { gait: "idle" });
    for (let k = 0; k < 200; k++) S.tick();
    put(wolfA, hx - 21, hy);
    S.tick();
    out.still = by(deerA, wolfA);
    senses.use.smell = true;
    return out;
  });
  r.check(hearing.walkFar === null && (hearing.gallop === "hearing" || hearing.gallop === "n/a") && hearing.still === null,
    `hearing on ${hearing.terrain} (ranges ${JSON.stringify(hearing.R)} tiles): a wolf just out of sight is heard galloping (${hearing.gallop}), ` +
    `not walking (${hearing.walkFar}), trotting ${hearing.trotNear}; standing still it is silent (${hearing.still})`);

  // SMELL on the wind
  const smell = await p.evaluate(() => {
    senses.use.hearing = false;
    const [hx, hy] = home, out = {};
    put(deerA, hx, hy); put(wolfA, hx + 100, hy); // 100 tiles along +i: far beyond sight
    S.setWind(0);            // blowing toward +i: from the deer to the wolf
    out.downwind = by(wolfA, deerA);
    S.setWind(Math.PI);      // toward -i: the wolf is upwind
    out.upwind = by(wolfA, deerA);
    S.setWind(Math.PI / 2);  // across
    out.across = by(wolfA, deerA);
    put(wolfA, hx + 2, hy);  // up close, whatever the wind
    out.close = by(wolfA, deerA);
    // a deer smells a wolf downwind of it, less far
    put(wolfA, hx - 60, hy); S.setWind(0);
    out.deerSmellsWolf = by(deerA, wolfA);
    put(wolfA, hx - 120, hy);
    out.deerTooFar = by(deerA, wolfA);
    senses.use.hearing = true;
    return out;
  });
  r.check(smell.downwind === "smell" && smell.upwind === null && smell.across === null && smell.close !== null,
    `a wolf smells a deer 100 tiles upwind of it (${smell.downwind}), not downwind (${smell.upwind}) or across the wind (${smell.across}); up close, any (${smell.close})`);
  r.check(smell.deerSmellsWolf === "smell" && smell.deerTooFar === null,
    `a deer smells a wolf 60 tiles upwind (${smell.deerSmellsWolf}), not 120 (${smell.deerTooFar})`);

  // TRAILS, and a wolf tracking
  const trail = await p.evaluate(() => {
    const [hx, hy] = home, out = {};
    // the deer walks 12 tiles along +j, leaving its trail, then is taken far away
    put(deerA, hx - 4, hy - 6); mind.ignore(deerA);
    sim.setIntent(deerA, { dx: 0, dy: 1, gait: "walk" });
    for (let k = 0; k < 9 / sim.tempo; k++) S.tick();
    const end = [deerA.gx, deerA.gy];
    const t0 = sim.scentAt(Math.floor(hx - 4), Math.floor(hy - 6), "deer"), t1 = sim.scentAt(Math.floor(end[0]), Math.floor(end[1]), "deer");
    out.fades = t0 && t1 && t0.ageS > t1.ageS;
    far(deerA);
    // a hungry wolf crossing the start of the trail, the wind blowing away from it
    S.setWind(Math.PI * 1.5);
    put(wolfA, hx - 4.5, hy - 5); wolfA.food = 0.3; mind.forget(wolfA); mind.ignore(wolfA, false);
    const modes = new Set();
    out.moved = [0, 0];
    for (let k = 0; k < 6 / sim.tempo; k++) {
      S.tick(); modes.add(mind.stateOf(wolfA)?.mode);
      // the farthest it got along the trail, tracking
      const along = wolfA.gy - (hy - 5);
      if (mind.stateOf(wolfA)?.mode === "track" && along > out.moved[1]) out.moved = [wolfA.gx - (hx - 4.5), along];
    }
    out.modes = [...modes];
    // where the trail ends (as at a kill), it gives it up rather than pace about there
    let nearEnd = 0, samples = 0;
    for (let k = 0; k < 30 / sim.tempo; k++) {
      wolfA.food = 0.3; S.tick();
      if (k % 30) continue;
      samples++;
      if (Math.hypot(wolfA.gx - end[0], wolfA.gy - end[1]) < 2.5) nearEnd++;
    }
    out.nearEnd = nearEnd / samples;
    mind.ignore(wolfA);
    return out;
  });
  r.check(trail.fades && trail.modes.includes("track") && trail.moved[1] > 4 && Math.abs(trail.moved[0]) < 3,
    `a deer leaves a trail, older where it passed first; a hungry wolf finding it follows it the way the deer went ` +
    `(${trail.moved.map(v => v.toFixed(1)).join(", ")} tiles, modes ${trail.modes.join(", ")})`);
  r.check(trail.nearEnd < 0.25,
    `where the trail ends, it gives it up instead of pacing about there (near the end ${(trail.nearEnd * 100).toFixed(0)}% of the next 30 s)`);

  // MEMORY: sight's details kept when only heard or smelled
  const memory = await p.evaluate(() => {
    const [hx, hy] = home;
    put(wolfA, hx, hy); put(deerA, hx + 4, hy); mind.forget(wolfA); mind.ignore(wolfA, false); wolfA.food = 1;
    S.tick(); for (let k = 0; k < 10; k++) S.tick();
    const seen = mind.stateOf(wolfA).known.find(k => k.uid === deerA.uid);
    put(deerA, hx + 60, hy); S.setWind(Math.PI); // now only smelled: the wolf is downwind
    for (let k = 0; k < 10; k++) S.tick();
    const smelled = mind.stateOf(wolfA).known.find(k => k.uid === deerA.uid);
    mind.ignore(wolfA);
    return { seenBy: seen && seen.by, smelledBy: smelled && smelled.by, sexKept: smelled && smelled.isMale === deerA.isMale, grownKept: smelled && smelled.grown === true };
  });
  r.check(memory.seenBy === "sight" && memory.smelledBy === "smell" && memory.sexKept && memory.grownKept,
    `a deer seen, then only smelled, is remembered with what sight told of it (${JSON.stringify(memory)})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "senses: sight, hearing, smell", main };
if (require.main === module) runStandalone(module.exports.name, main);
