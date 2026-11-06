// The senses (see senses.js), and how the mind uses them (mind.js):
//  - SIGHT: in the sight rectangle, the field of view and in line of sight: a boulder (as tall as 3 levels)
//    between two critters hides each from the other; on open level ground they see each
//    other; grass and land too are seen only in line of sight
//  - KEEPING SIGHT: a critter it has seen it still sees however far off, in its field of
//    view and line of sight, until 6 s after it last saw it; several at once
//  - HEARING: a critter moving on land is heard within a range set by its gait and the
//    ground under it (galloping farther than trotting, trotting than walking); standing
//    still it is silent; swimming it splashes
//  - SMELL: a critter smells another within a few tiles, unseen, whatever the wind; none
//    farther off (no scent rides the wind)
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
    [sim.pcWolf, wolfA, deerA, deerB].forEach(c => { far(c); c.lifespanS = 1e9; sim.internals.setFood(c, 1); });
    window.by = (a, b) => (senses.perceive(a).find(o => o.uid === b.uid) || {}).by || null;
  });

  // SIGHT
  const sight = await p.evaluate(() => {
    senses.use.hearing = senses.use.smell = false;
    const [hx, hy] = home;
    put(wolfA, hx - 3, hy); put(deerA, hx + 3, hy);
    wolfA.hx = 1; wolfA.hy = 0; deerA.hx = -1; deerA.hy = 0; // (facing each other)
    const open = by(wolfA, deerA);
    // a boulder with level, open ground three tiles either side of it, along i
    const level = (i, j) => { const c = sim.tileCorners(i, j); return Math.max(...c) === Math.min(...c) ? c[0] : null; };
    const free = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
    let b = null;
    for (let i = sim.startNear.i0; i < sim.startNear.i1 && !b; i++) for (let j = sim.startNear.j0; j < sim.startNear.j1 && !b; j++) {
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

  // FIELD OF VIEW AND KEEPING SIGHT: a wolf facing +i sees a deer ahead, not one behind it;
  // once seen, deer far off ahead (beyond its sight rectangle) are still seen while in line
  // of sight, each for keepSightS after it was last seen, and seeing it again starts that
  // afresh; but not once behind it
  const keep = await p.evaluate(() => {
    senses.use.hearing = senses.use.smell = false;
    const [hx, hy] = home, deerC = sim.allCritters.find(c => c.species === "deer" && c !== deerA && c !== deerB);
    const herd = [deerA, deerB, deerC];
    herd.forEach(c => { c.lifespanS = 1e9; mind.ignore(c); });
    const wait = s => { for (let n = 0; n < s / sim.tempo; n++) S.tick(); };
    put(wolfA, hx - 3, hy); wolfA.hx = 1; wolfA.hy = 0;
    put(deerC, hx - 6, hy); // (one it hasn't seen yet)
    const behind = by(wolfA, deerC);
    // ahead of it, then each far off ahead, beyond the rectangle, where nothing stands in the
    // line of sight
    herd.forEach((c, k) => put(c, hx, hy + k - 1));
    const ahead = herd.map(c => by(wolfA, c));
    const spots = [];
    for (let d = 26; d <= 80 && spots.length < 3; d += 3) for (let a = -30; a <= 30 && spots.length < 3; a += 15) {
      const x = wolfA.gx + d * Math.cos(a * Math.PI / 180), y = wolfA.gy + d * Math.sin(a * Math.PI / 180);
      if (sim.getTerrainAt(x, y) === "water" || sim.isBlockedTile(Math.floor(x), Math.floor(y))) continue;
      put(deerA, x, y);
      if (senses.canSee(wolfA, deerA) && !senses.inSight(x - wolfA.gx, y - wolfA.gy)
        && !spots.some(([u, v]) => Math.hypot(u - x, v - y) < 3)) spots.push([x, y]);
    }
    if (spots.length < 3) { herd.forEach(c => far(c)); senses.use.hearing = senses.use.smell = true; return { none: true, spots }; }
    herd.forEach((c, k) => put(c, ...spots[k]));
    wait(4);
    const at4 = herd.map(c => by(wolfA, c));          // seen 4 s ago: still seen (and afresh)
    wait(5);
    const at9 = herd.map(c => by(wolfA, c));          // seen 5 s ago: still seen
    put(deerC, wolfA.gx - (spots[2][0] - wolfA.gx), spots[2][1]); // behind it now
    const turned = by(wolfA, deerC);
    put(deerC, ...spots[2]);
    wait(7);
    const at16 = herd.map(c => by(wolfA, c));         // seen 7 s ago: lost
    herd.forEach(c => far(c));
    senses.use.hearing = senses.use.smell = true;
    return { behind, ahead, at4, at9, turned, at16, far: Math.round(Math.hypot(spots[0][0] - wolfA.gx, spots[0][1] - wolfA.gy)) };
  });
  r.check(!keep.none && keep.behind === null && keep.ahead.every(x => x === "sight"),
    `a wolf sees deer ahead of it (${keep.ahead}), not one close behind it (${keep.behind}), out of its field of view`);
  r.check(!keep.none && keep.at4.every(x => x === "sight") && keep.at9.every(x => x === "sight") && keep.turned === null && keep.at16.every(x => x === null),
    `once seen, three deer far ahead of it, beyond its sight rectangle (${keep.far} tiles), are still seen in line of sight 4 s on (${keep.at4}), and ` +
    `5 s after that (${keep.at9}), each time afresh; not behind it (${keep.turned}); 7 s after it last saw them, no more (${keep.at16})`);

  // HEARING
  const hearing = await p.evaluate(() => {
    senses.use.smell = false;
    const [hx, hy] = home, out = {};
    const terrain = sim.getTerrainAt(hx, hy), R = {};
    for (const g of ["stalk", "walk", "trot", "gallop"]) R[g] = +senses.hearingRangeOf("wolf", terrain, g).toFixed(1);
    // the wolf behind the deer's back is out of its sight only if far: test by hearing alone
    senses.use.lineOfSight = true;
    // (on the side, -i or +i, with open ground where the wolf runs on the spot)
    const open = x => [-1, 0, 1].every(di => [-1, 0, 1].every(dj =>
      sim.getTerrainAt(x + di, hy + dj) !== "water" && !sim.isBlockedTile(x + di, hy + dj)));
    const side = open(hx - 21) ? -1 : 1;
    const tryAt = (gait, dist) => {
      put(deerA, hx, hy); put(wolfA, hx + side * dist, hy);
      wolfA.wind = wolfA.stamina = 1;
      mind.ignore(wolfA); sim.setIntent(wolfA, { dx: 0, dy: 1, gait });
      for (let k = 0; k < 60; k++) { wolfA.wind = wolfA.stamina = 1; wolfA.gx = wolfA.nextGX = hx + side * dist; wolfA.gy = wolfA.nextGY = hy; S.tick(); }
      // keep it out of sight: just past the rectangle's edge, straight along i is |dx - dy| = dist
      return by(deerA, wolfA);
    };
    out.terrain = terrain; out.R = R;
    // just beyond sight's half-width (20.2) along i: only hearing can tell
    out.walkFar = tryAt("walk", 21);
    out.trotNear = R.trot > 21 ? tryAt("trot", 21) : "n/a";
    out.gallop = R.gallop > 21 ? tryAt("gallop", 21) : "n/a";
    sim.setIntent(wolfA, { gait: "idle" });
    for (let k = 0; k < 200; k++) S.tick();
    put(wolfA, hx + side * 21, hy);
    S.tick();
    out.still = by(deerA, wolfA);
    senses.use.smell = true;
    return out;
  });
  r.check(hearing.walkFar === null && (hearing.gallop === "hearing" || hearing.gallop === "n/a") && hearing.still === null,
    `hearing on ${hearing.terrain} (ranges ${JSON.stringify(hearing.R)} tiles): a wolf just out of sight is heard galloping (${hearing.gallop}), ` +
    `not walking (${hearing.walkFar}), trotting ${hearing.trotNear}; standing still it is silent (${hearing.still})`);

  // SMELL up close only
  const smell = await p.evaluate(() => {
    senses.use.hearing = false;
    const [hx, hy] = home, out = {};
    put(deerA, hx, hy); put(wolfA, hx - 2.5, hy); wolfA.hx = -1; wolfA.hy = 0; // the deer behind it: unseen
    for (const [k, angle] of [["toward", Math.PI], ["away", 0], ["across", Math.PI / 2]]) { S.setWind(angle); out[k] = by(wolfA, deerA); }
    put(wolfA, hx - 10, hy); wolfA.hx = -1; wolfA.hy = 0;
    S.setWind(Math.PI); out.ten = by(wolfA, deerA);   // downwind of the deer, 10 tiles off
    put(wolfA, hx - 2000, hy); out.far = by(wolfA, deerA);
    put(deerA, hx, hy); deerA.hx = 1; deerA.hy = 0; put(wolfA, hx - 2.5, hy);
    out.deerClose = by(deerA, wolfA);
    put(wolfA, hx - 400, hy); S.setWind(0); out.deerFar = by(deerA, wolfA);
    senses.use.hearing = true;
    return out;
  });
  r.check(smell.toward === "smell" && smell.away === "smell" && smell.across === "smell" && smell.ten === null && smell.far === null,
    `a wolf smells a deer 2.5 tiles off, unseen, whatever the wind (${smell.toward}, ${smell.away}, ${smell.across}); ` +
    `not 10 tiles off (${smell.ten}) nor 2000 (${smell.far}), downwind as it is: no scent rides the wind`);
  r.check(smell.deerClose === "smell" && smell.deerFar === null,
    `a deer likewise smells a wolf just behind it (${smell.deerClose}), not one 400 tiles upwind (${smell.deerFar})`);

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
    put(wolfA, hx - 4.5, hy - 5); sim.internals.setFood(wolfA, 0.3); mind.forget(wolfA); mind.ignore(wolfA, false);
    const modes = new Set();
    out.moved = [0, 0];
    for (let k = 0; k < 6 / sim.tempo; k++) {
      S.tick(); modes.add(mind.stateOf(wolfA)?.mode);
      // the farthest it got along the trail, tracking (to the trail's end: it may gallop on,
      // onto other trails about)
      const along = wolfA.gy - (hy - 5);
      if (mind.stateOf(wolfA)?.mode === "track" && along > out.moved[1] && along <= end[1] - (hy - 5)) out.moved = [wolfA.gx - (hx - 4.5), along];
    }
    out.modes = [...modes];
    // where the trail ends (as at a kill), it gives it up rather than pace about there
    let nearEnd = 0, samples = 0;
    for (let k = 0; k < 30 / sim.tempo; k++) {
      sim.internals.setFood(wolfA, 0.3); S.tick();
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
    put(wolfA, hx, hy); wolfA.hx = 1; wolfA.hy = 0; put(deerA, hx + 4, hy);
    mind.forget(wolfA); mind.ignore(wolfA, false); sim.internals.setFood(wolfA, 1);
    S.tick(); for (let k = 0; k < 10; k++) S.tick();
    const seen = mind.stateOf(wolfA).known.find(k => k.uid === deerA.uid);
    // now only smelled: just behind the wolf, and not looked for since it was seen (else
    // it would keep it in sight: see KEEPING SIGHT in senses.js)
    mind.ignore(wolfA); mind.ignore(deerA); sim.setIntent(wolfA, null); put(wolfA, hx, hy); put(deerA, hx - 2.5, hy);
    for (let k = 0; k < (senses.keepSightS + 1) / sim.tempo; k++) S.tick();
    wolfA.hx = 1; wolfA.hy = 0; mind.rest(wolfA, 5); // (standing, facing away from it)
    mind.ignore(wolfA, false);
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
