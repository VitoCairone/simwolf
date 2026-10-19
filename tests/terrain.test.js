// Terrain height (see TERRAIN HEIGHT in sim.js): slopes, cliffs and flat water.
//  - every tile is flat or one of the 14 slope shapes (corners within one level); water
//    is flat at level 0; the map has both slopes and cliffs
//  - a critter is drawn at the ground's height, rising and falling as it walks a slope
//  - a cliff of two levels or more blocks a critter; a one-level ledge doesn't
// Saves a screenshot of the highest ground to tests/output/terrain/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 750 } });

  // 1. the terrain itself
  const t = await p.evaluate(() => {
    sim.pause();
    let badShape = 0, wetNotFlat = 0, slopes = 0, cliffEdges = 0, ledgeEdges = 0;
    for (let i = 0; i < sim.gridWidthN; i++) for (let j = 0; j < sim.gridHeightN; j++) {
      const c = [...sim.tileCorners(i, j)];
      const spread = Math.max(...c) - Math.min(...c);
      if (spread > 1 || Math.min(...c) < 0) badShape++;
      if (spread === 1) slopes++;
      if (sim.getTerrainAt(i, j) === "water" && c.some(l => l !== 0)) wetNotFlat++;
      if (i + 1 < sim.gridWidthN) { // the shared edge with the tile to the east
        const n = sim.tileCorners(i + 1, j);
        const step = Math.min(Math.abs(c[1] - n[0]), Math.abs(c[3] - n[2]));
        if (step >= 2) cliffEdges++; else if (step === 1) ledgeEdges++;
      }
    }
    return { badShape, wetNotFlat, slopes, cliffEdges, ledgeEdges, maxLevel: sim.maxLevel };
  });
  r.check(t.badShape === 0, `every tile is flat or a one-level slope (${t.badShape} not)`);
  r.check(t.wetNotFlat === 0, `water is flat at level 0 (${t.wetNotFlat} water tiles not)`);
  r.check(t.slopes > 500 && t.cliffEdges > 20 && t.maxLevel >= 4,
    `the map has slopes and cliffs: ${t.slopes} slope tiles, ${t.cliffEdges} cliff edges, ` +
    `${t.ledgeEdges} one-level ledges, heights up to level ${t.maxLevel}`);

  // 2. a critter is drawn at the ground's height
  const drawn = await p.evaluate(() => {
    const w = sim.pcWolf;
    // a land tile whose surface rises at least half a level from its middle to a corner
    let tile = null;
    for (const [i, j] of sim.internals.allLandTiles) {
      const c = sim.tileCorners(i, j);
      if (Math.min(...c) >= 1 && Math.max(...c) > Math.min(...c)) { tile = [i, j]; break; }
    }
    if (!tile) return null;
    w.gx = w.nextGX = tile[0] + 0.5; w.gy = w.nextGY = tile[1] + 0.5;
    sim.internals.setCritterIdle(w); animat.render();
    const el = animat.spriteEl(w);
    const fd = animat.frameDataBySpeciesAndPose.wolf[w.pose];
    const [, isoY] = animat.isoProject(w.gx, w.gy);
    const h = sim.heightAt(w.gx, w.gy);
    return { h, top: parseFloat(el.style.top), expected: isoY - fd.topToShadow - h * 8 };
  });
  r.check(drawn && Math.abs(drawn.top - drawn.expected) < 1e-6 && drawn.h > 0,
    `a wolf on raised ground is drawn ${drawn && (drawn.h * 8).toFixed(1)} px up, at the ground's height`);

  // 3. cliffs block, ledges don't. Find a two-level cliff and a one-level ledge between
  // dry, passable tiles, and walk a wolf straight at each from the tile beside it.
  const walk = await p.evaluate(() => {
    const T = (i, j) => sim.getTerrainAt(i, j);
    const dry = (i, j) => T(i, j) !== "water" && !sim.internals.isImpassable(T(i, j));
    sim.allCritters.filter(c => c !== sim.pcWolf).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; c.redecideCd = 1e9;
    });
    // edge between (i, j) and (i + 1, j): its step (drop going east) at both ends
    const edgeStep = (i, j) => {
      const a = sim.tileCorners(i, j), b = sim.tileCorners(i + 1, j);
      return [a[1] - b[0], a[3] - b[2]];
    };
    const find = want => {
      for (let i = 2; i < sim.gridWidthN - 3; i++) for (let j = 2; j < sim.gridHeightN - 2; j++) {
        if (!dry(i, j) || !dry(i + 1, j)) continue;
        const [s1, s2] = edgeStep(i, j);
        if (s1 === s2 && Math.abs(s1) === want) return [i, j]; // the same step all along
      }
      return null;
    };
    const tryCross = tile => {
      if (!tile) return null;
      const w = sim.pcWolf;
      w.gx = w.nextGX = tile[0] + 0.5; w.gy = w.nextGY = tile[1] + 0.5;
      sim.internals.setCritterIdle(w);
      // the player's intent keeps the wolf pushing east (decisions can't turn it)
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" });
      for (let n = 0; n < 120; n++) sim.internals.tick();
      sim.setPlayerIntent(null); sim.internals.tick();
      return { crossed: w.gx > tile[0] + 1, gx: w.gx, step: edgeStep(...tile)[0] };
    };
    return { cliff: tryCross(find(2)), ledge: tryCross(find(1)) };
  });
  r.check(walk.cliff && !walk.cliff.crossed,
    `a ${walk.cliff && Math.abs(walk.cliff.step)}-level cliff stops a walking wolf ` +
    `(${walk.cliff ? "stopped at x " + walk.cliff.gx.toFixed(2) : "no cliff found"})`);
  r.check(walk.ledge && walk.ledge.crossed,
    `a one-level ledge (${walk.ledge && (walk.ledge.step > 0 ? "down" : "up")}) doesn't ` +
    `(${walk.ledge ? "reached x " + walk.ledge.gx.toFixed(2) : "no ledge found"})`);

  // screenshot of the highest ground
  const outDir = ensureOutputDir("terrain");
  await p.evaluate(() => {
    let best = null;
    for (let i = 0; i < sim.gridWidthN; i++) for (let j = 0; j < sim.gridHeightN; j++) {
      const m = Math.max(...sim.tileCorners(i, j));
      if (!best || m > best[0]) best = [m, i, j];
    }
    animat.setZoom(2); animat.centerCameraOn(best[1] + 0.5, best[2] + 0.5);
  });
  await p.screenshot({ path: path.join(outDir, "highest-ground.png") });
  r.noProblems(p);
  await p.close();
  console.log(`      screenshot saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "terrain height", main };
if (require.main === module) runStandalone(module.exports.name, main);
