// Obstacles (see OBSTACLES in sim.js): boulders stand on tiles, separate from the ground.
//  - only on land, infrequent, on every kind of ground, some joined into barrier walls
//  - stone ground is passable like grass and dirt; a boulder blocks a walking wolf, which
//    is stunned: stopped at its last legal position for 0.1 - 0.5 s, then tries again
//    (its intent waits while it is stunned)
//  - boulders and land critters are drawn back to front together: a critter behind a
//    boulder is hidden by it, one in front covers it
// Saves screenshots of a barrier and of critters around a boulder to tests/output/obstacles/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 750 } });

  // 1. where the boulders are
  const b = await p.evaluate(() => {
    sim.pause();
    const W = sim.gridWidthN, H = sim.gridHeightN;
    const isB = (i, j) => i >= 0 && j >= 0 && i < W && j < H && sim.obstacleAt(i, j) === "boulder";
    let land = 0, boulders = 0, onWater = 0; const onGround = {};
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      const t = sim.getTerrainAt(i, j);
      if (t !== "water") land++;
      if (!isB(i, j)) continue;
      boulders++;
      if (t === "water") onWater++; else onGround[t] = (onGround[t] || 0) + 1;
    }
    // the longest run of boulders touching (also diagonally: a critter can't squeeze
    // between two boulders that meet at a corner)
    const seen = new Set(); let longest = 0, longestAt = null;
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      if (!isB(i, j) || seen.has(i + "_" + j)) continue;
      const q = [[i, j]]; seen.add(i + "_" + j); let n = 0, sum = [0, 0];
      while (q.length) {
        const [a, c] = q.pop(); n++; sum[0] += a; sum[1] += c;
        for (let da = -1; da <= 1; da++) for (let dc = -1; dc <= 1; dc++) {
          const k = (a + da) + "_" + (c + dc);
          if (isB(a + da, c + dc) && !seen.has(k)) { seen.add(k); q.push([a + da, c + dc]); }
        }
      }
      if (n > longest) { longest = n; longestAt = [sum[0] / n, sum[1] / n]; }
    }
    return { land, boulders, onWater, onGround, longest, longestAt };
  });
  const pct = 100 * b.boulders / b.land;
  r.check(b.onWater === 0, `no boulders on water (${b.onWater})`);
  r.check(pct > 1 && pct < 8, `boulders are infrequent: ${b.boulders} on ${pct.toFixed(1)}% of land`);
  r.check(["grass", "dirt", "stone"].every(t => b.onGround[t] > 0),
    `boulders stand on every kind of ground (${JSON.stringify(b.onGround)})`);
  r.check(b.longest >= 12, `some boulders join into barriers (longest: ${b.longest} boulders)`);

  // 2. stone is passable, boulders are not
  const walk = await p.evaluate(() => {
    const T = (i, j) => sim.getTerrainAt(i, j);
    sim.allCritters.filter(c => c !== sim.pcWolf).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    // walk east from tile (i, j) for 1 s; flat, level ground on the way
    const level = (i, j) => { const c = sim.tileCorners(i, j); return Math.max(...c) === Math.min(...c); };
    const ok = (i, j) => T(i, j) !== "water" && level(i, j);
    const find = test => {
      for (let i = 2; i < sim.gridWidthN - 4; i++) for (let j = 2; j < sim.gridHeightN - 2; j++)
        if (ok(i, j) && ok(i + 1, j) && ok(i + 2, j) && !sim.isBlockedTile(i, j)
          && sim.tileCorners(i, j)[0] === sim.tileCorners(i + 1, j)[0]
          && sim.tileCorners(i + 1, j)[0] === sim.tileCorners(i + 2, j)[0] && test(i, j)) return [i, j];
      return null;
    };
    const tryWalk = tile => {
      if (!tile) return null;
      const w = sim.pcWolf;
      w.gx = w.nextGX = tile[0] + 0.5; w.gy = w.nextGY = tile[1] + 0.5; w.stunnedUntil = 0;
      sim.internals.setCritterIdle(w);
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" });
      for (let n = 0; n < 60; n++) sim.internals.tick();
      sim.setPlayerIntent(null); sim.internals.tick();
      return { from: tile, gx: w.gx };
    };
    const stone = tryWalk(find((i, j) => T(i + 1, j) === "stone" && T(i + 2, j) === "stone"
      && !sim.isBlockedTile(i + 1, j) && !sim.isBlockedTile(i + 2, j)));
    const boulderTile = find((i, j) => sim.obstacleAt(i + 1, j) === "boulder");
    const boulder = tryWalk(boulderTile);
    // stunned: walk into the boulder again and watch the moment it is blocked
    let stun = null;
    if (boulderTile) {
      const w = sim.pcWolf;
      w.gx = w.nextGX = boulderTile[0] + 0.5; w.gy = w.nextGY = boulderTile[1] + 0.5;
      w.stunnedUntil = 0; sim.internals.setCritterIdle(w);
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" });
      let n = 0;
      for (; n < 120 && w.blockedTick !== sim.tickCount - 1; n++) sim.internals.tick();
      const at = [w.gx, w.gy], ticks = w.stunnedUntil - w.blockedTick;
      let stayed = true, still = true;
      while (sim.tickCount < w.stunnedUntil) {
        sim.internals.tick();
        if (w.gx !== at[0] || w.gy !== at[1]) stayed = false;
        if (w.speed !== 0 || w.pose !== "idle") still = false;
      }
      // recovered: its intent applies again, into the boulder again (picking up speed
      // from a standstill, so it may take a few ticks to reach it)
      const after = w.blockedTick;
      for (let k = 0; k < 30 && w.blockedTick === after; k++) sim.internals.tick();
      stun = { blocked: n < 120, ticks, stayed, still, again: w.blockedTick !== after };
      sim.setPlayerIntent(null); sim.internals.tick();
    }
    return { stone, boulder, stun };
  });
  r.check(walk.stone && walk.stone.gx > walk.stone.from[0] + 1.5,
    `a wolf walks onto stone ground (${walk.stone ? "reached x " + walk.stone.gx.toFixed(2) + " from " + walk.stone.from[0] : "no stone found"})`);
  r.check(walk.boulder && walk.boulder.gx < walk.boulder.from[0] + 1,
    `a boulder stops a walking wolf (${walk.boulder ? "stopped at x " + walk.boulder.gx.toFixed(2) + ", boulder at " + (walk.boulder.from[0] + 1) : "no boulder found"})`);

  const st = walk.stun;
  r.check(st && st.blocked && st.ticks >= 6 && st.ticks <= 30 && st.stayed && st.still && st.again,
    `a blocked wolf is stunned: stopped where it was for ${st ? st.ticks : "?"} ticks (0.1 - 0.5 s), ` +
    `then tries again (${st ? (st.stayed ? "stayed put" : "MOVED") + ", " + (st.still ? "idle" : "NOT idle") + ", then " + (st.again ? "blocked again" : "did NOT try") : "no boulder"})`);

  // 3. boulders are drawn: look at the longest barrier
  const drawn = await p.evaluate(at => {
    animat.setZoom(2); animat.centerCameraOn(at[0], at[1]);
    return { shown: animat.tilesInView().filter(t => t.boulder).length };
  }, b.longestAt);
  r.check(drawn.shown > 10, `boulders are drawn (${drawn.shown} in view)`);
  const outDir = ensureOutputDir("obstacles");
  await p.screenshot({ path: path.join(outDir, "barrier.png") });

  // 4. critters behind a boulder are drawn behind it, those in front over it
  const depth = await p.evaluate(() => {
    const S = sim.internals;
    const free = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
    let b = null;
    for (let i = 3; i < sim.gridWidthN - 3 && !b; i++) for (let j = 3; j < sim.gridHeightN - 3 && !b; j++) {
      if (sim.obstacleAt(i, j) !== "boulder") continue;
      const lv = sim.tileCorners(i, j)[0];
      let ok = true;
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++)
        if ((di || dj) && (!free(i + di, j + dj) || sim.tileCorners(i + di, j + dj).some(c => c !== lv))) ok = false;
      if (ok) b = [i, j];
    }
    if (!b) return null;
    sim.allCritters.forEach(c => { c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid; mind.ignore(c); });
    const deer = sim.allCritters.filter(c => c.species === "deer").slice(0, 3);
    const wolf = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf);
    const put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; S.setCritterIdle(c); };
    put(wolf, b[0] - 0.4, b[1] - 0.4);       // right behind it
    put(deer[0], b[0] - 0.5, b[1] + 0.5);    // behind, up-screen to the left
    put(deer[1], b[0] + 1.6, b[1] + 1.6);    // in front
    put(deer[2], b[0] + 1.5, b[1] + 0.5);    // in front, down-screen to the right
    animat.setZoom(4); animat.centerCameraOn(b[0] + 0.5, b[1] + 0.5); animat.render();
    const z = c => animat.spriteOf(c).z;
    const rock = animat.tileOf(b[0], b[1]).boulder.z;
    return { rock, behind: [wolf, deer[0]].map(c => z(c) < rock), front: [deer[1], deer[2]].map(c => z(c) > rock) };
  });
  r.check(depth && depth.behind.every(Boolean) && depth.front.every(Boolean),
    `critters behind a boulder are drawn behind it, those in front over it (${JSON.stringify(depth)})`);
  await p.screenshot({ path: path.join(outDir, "depth.png") });
  r.noProblems(p);
  await p.close();
  console.log(`      screenshot saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "obstacles (boulders)", main };
if (require.main === module) runStandalone(module.exports.name, main);
