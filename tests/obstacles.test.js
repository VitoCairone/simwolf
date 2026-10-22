// Obstacles (see OBSTACLES in sim.js): boulders stand on tiles, separate from the ground.
//  - only on land, infrequent, on every kind of ground, some joined into barrier walls
//  - stone ground is passable like grass and dirt; a boulder blocks a walking wolf
// Saves a screenshot of a barrier to tests/output/obstacles/.

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
      w.gx = w.nextGX = tile[0] + 0.5; w.gy = w.nextGY = tile[1] + 0.5;
      sim.internals.setCritterIdle(w);
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" });
      for (let n = 0; n < 60; n++) sim.internals.tick();
      sim.setPlayerIntent(null); sim.internals.tick();
      return { from: tile, gx: w.gx };
    };
    const stone = tryWalk(find((i, j) => T(i + 1, j) === "stone" && T(i + 2, j) === "stone"
      && !sim.isBlockedTile(i + 1, j) && !sim.isBlockedTile(i + 2, j)));
    const boulder = tryWalk(find((i, j) => sim.obstacleAt(i + 1, j) === "boulder"));
    return { stone, boulder };
  });
  r.check(walk.stone && walk.stone.gx > walk.stone.from[0] + 1.5,
    `a wolf walks onto stone ground (${walk.stone ? "reached x " + walk.stone.gx.toFixed(2) + " from " + walk.stone.from[0] : "no stone found"})`);
  r.check(walk.boulder && walk.boulder.gx < walk.boulder.from[0] + 1,
    `a boulder stops a walking wolf (${walk.boulder ? "stopped at x " + walk.boulder.gx.toFixed(2) + ", boulder at " + (walk.boulder.from[0] + 1) : "no boulder found"})`);

  // 3. boulders are drawn: look at the longest barrier
  const drawn = await p.evaluate(at => {
    animat.setZoom(2); animat.centerCameraOn(at[0], at[1]);
    return { shown: document.querySelectorAll(".tile.boulder").length };
  }, b.longestAt);
  r.check(drawn.shown > 10, `boulders are drawn (${drawn.shown} in view)`);
  const outDir = ensureOutputDir("obstacles");
  await p.screenshot({ path: path.join(outDir, "barrier.png") });
  r.noProblems(p);
  await p.close();
  console.log(`      screenshot saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "obstacles (boulders)", main };
if (require.main === module) runStandalone(module.exports.name, main);
