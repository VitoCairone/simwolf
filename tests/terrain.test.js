// Terrain (see TERRAIN and TERRAIN HEIGHT in sim.js, and hydrology.js): the land's height,
// and the sea, lakes and rivers on it, on a map 50,000 tiles square. Over the ground about
// the start (the map is far too big to look at whole):
//  - every tile is flat or one of the 14 slope shapes (corners within one level); the
//    land has slopes and spans many levels; ground cover isn't set by height
//  - water is flat at its surface's level; every water tile is sea, lake or river; a lake
//    is level all over
//  - a river runs downhill, its water never rising downstream (the biggest river on the
//    map, along its course); where it steps down a level, the step is drawn as water (no
//    gap showing what is behind); the map's edges are sea
//  - a critter is drawn at the ground's height, rising and falling as it walks a slope
//  - a cliff of two levels or more blocks a critter; a one-level ledge doesn't (on ground
//    made into a cliff and a ledge for the test: there are few cliffs on this land)
// Saves a screenshot of the highest ground about the start to tests/output/terrain/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 750 } });

  // 1. the terrain about the start
  const t = await p.evaluate(() => {
    sim.pause();
    const A = sim.startNear;
    let badShape = 0, wetNotFlat = 0, noKind = 0, slopes = 0, lo = Infinity, hi = -Infinity;
    const kinds = {}, levels = { grass: new Set(), dirt: new Set(), stone: new Set() };
    let lakeAt = null;
    for (let i = A.i0; i < A.i1; i++) for (let j = A.j0; j < A.j1; j++) {
      const c = [...sim.tileCorners(i, j)];
      const spread = Math.max(...c) - Math.min(...c);
      if (spread > 1 || Math.min(...c) < 0) badShape++;
      if (spread === 1) slopes++;
      lo = Math.min(lo, ...c); hi = Math.max(hi, ...c);
      const ter = sim.getTerrainAt(i, j);
      if (ter === "water") {
        const w = sim.waterLevelAt(i, j), k = sim.waterKindAt(i, j);
        if (c.some(l => l !== w)) wetNotFlat++;
        if (!["sea", "lake", "river"].includes(k)) noKind++;
        kinds[k] = (kinds[k] || 0) + 1;
        if (k === "lake" && !lakeAt) lakeAt = [i, j];
      } else levels[ter].add(Math.min(...c));
    }
    // a lake, flood-filled from one of its tiles (within the ground about the start): one level
    const lakeLevels = new Set();
    if (lakeAt) {
      const seen = new Set([lakeAt.join()]), q = [lakeAt];
      while (q.length && seen.size < 200000) {
        const [i, j] = q.pop();
        lakeLevels.add(sim.waterLevelAt(i, j));
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (a < A.i0 || b < A.j0 || a >= A.i1 || b >= A.j1 || seen.has(a + "," + b) || sim.waterKindAt(a, b) !== "lake") continue;
          seen.add(a + "," + b); q.push([a, b]);
        }
      }
    }
    return { badShape, wetNotFlat, noKind, slopes, lo, hi, kinds, lakeLevels: [...lakeLevels],
      cover: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, v.size])) };
  });
  r.check(t.badShape === 0, `every tile is flat or a one-level slope (${t.badShape} not)`);
  r.check(t.slopes > 500 && t.hi - t.lo >= 10,
    `the land has slopes and height: ${t.slopes} slope tiles, levels ${t.lo} to ${t.hi}`);
  r.check(t.wetNotFlat === 0 && t.noKind === 0,
    `water is flat at its level, and sea, lake or river (${t.wetNotFlat} water tiles not flat, ${t.noKind} of no kind; ${JSON.stringify(t.kinds)})`);
  r.check(t.lakeLevels.length === 1, `a lake is level all over (levels ${t.lakeLevels.join(", ")})`);
  r.check(t.cover.grass >= 4 && t.cover.dirt >= 4 && t.cover.stone >= 3,
    `ground cover is independent of height: grass at ${t.cover.grass} levels, dirt at ${t.cover.dirt}, stone at ${t.cover.stone}`);

  // 2. the biggest river, along its course: river tiles whose water never rises downstream,
  // and the sea at the map's edges
  const river = await p.evaluate(() => {
    const g = sim.internals.terrainMap.graph;
    let k = -1;
    for (let n = 0; n < g.flow.length; n++) if (!g.ocean[n] && (k < 0 || g.flow[n] > g.flow[k])) k = n;
    // from 30 nodes upstream of it down to the sea (its biggest tributary at each node)
    const ups = new Map();
    g.reaches.forEach(r => { if (!ups.has(r.to) || g.flow[r.from] > g.flow[ups.get(r.to).from]) ups.set(r.to, r); });
    let top = k;
    for (let s = 0; s < 30 && ups.has(top); s++) top = ups.get(top).from;
    let n = top, tiles = 0, rises = 0, last = Infinity;
    const byFrom = new Map(g.reaches.map(r => [r.from, r]));
    while (n >= 0 && !g.ocean[n] && byFrom.has(n)) {
      const r = byFrom.get(n);
      for (let s = 0; s < r.pts.length; s += 2) {
        const i = Math.floor(r.pts[s]), j = Math.floor(r.pts[s + 1]);
        if (sim.waterKindAt(i, j) !== "river") continue;
        const w = sim.waterLevelAt(i, j);
        tiles++; if (w > last) rises++; last = w;
      }
      n = r.to;
    }
    const edges = [[0, 0], [sim.gridWidthN - 1, 0], [0, sim.gridHeightN - 1], [sim.gridWidthN - 1, sim.gridHeightN - 1],
      [Math.floor(sim.gridWidthN / 2), 0], [0, Math.floor(sim.gridHeightN / 2)]].map(([i, j]) => sim.waterKindAt(i, j));
    return { tiles, rises, endsInSea: n >= 0 && !!g.ocean[n], edges };
  });
  r.check(river.tiles > 100 && river.rises === 0 && river.endsInSea,
    `the biggest river runs downhill to the sea: ${river.tiles} river tiles along its course, rising ${river.rises} times`);
  r.check(river.edges.every(k => k === "sea"), `the map's edges are sea (${river.edges.join(", ")})`);

  // a river's step down, drawn: no background colour about it on screen
  const step = await p.evaluate(() => {
    const g = sim.internals.terrainMap.graph;
    for (const r of g.reaches) for (let s = 0; s < r.pts.length; s += 2) {
      const i = Math.floor(r.pts[s]), j = Math.floor(r.pts[s + 1]);
      const a = sim.waterLevelAt(i, j), b = sim.waterLevelAt(i + 1, j), c = sim.waterLevelAt(i, j + 1);
      if (a === null || b === null || c === null || !(b < a || c < a)) continue;
      animat.setZoom(4); animat.centerCameraOn(i + 0.5, j + 0.5); animat.render();
      const [px, py] = animat.isoProject(i + 0.5, j + 0.5);
      return { at: [i, j], screen: animat.worldToScreen(px, py - a * 8) };
    }
    return null;
  });
  let gapPx = null;
  if (step) {
    const png = (await p.screenshot()).toString("base64");
    gapPx = await p.evaluate(async ([png, [x, y]]) => {
      const im = new Image(); im.src = "data:image/png;base64," + png; await im.decode();
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      const d = g.getImageData(Math.round(x) - 96, Math.round(y) - 64, 192, 128).data;
      let n = 0; // the background beyond the map: #9dd4f3
      for (let k = 0; k < d.length; k += 4) if (d[k] === 0x9d && d[k + 1] === 0xd4 && d[k + 2] === 0xf3) n++;
      return n;
    }, [png, step.screen]);
  }
  r.check(step && gapPx === 0, `a river's step down a level is drawn as water, with no gap (${gapPx} background pixels about it, at ${step && step.at})`);

  // 3. a critter is drawn at the ground's height
  const drawn = await p.evaluate(() => {
    const w = sim.pcWolf;
    // a land tile whose surface rises from its middle to a corner
    let tile = null;
    for (const [i, j] of sim.internals.allLandTiles) {
      const c = sim.tileCorners(i, j);
      if (Math.min(...c) >= 1 && Math.max(...c) > Math.min(...c)) { tile = [i, j]; break; }
    }
    if (!tile) return null;
    w.gx = w.nextGX = tile[0] + 0.5; w.gy = w.nextGY = tile[1] + 0.5; w.stunnedUntil = 0;
    sim.internals.setCritterIdle(w); animat.render();
    const s = animat.spriteOf(w);
    const fd = animat.frameDataBySpeciesAndPose.wolf[w.pose];
    const [, isoY] = animat.isoProject(w.gx, w.gy);
    const h = sim.heightAt(w.gx, w.gy);
    return { h, top: s.top, expected: isoY - fd.topToShadow - h * 8 };
  });
  r.check(drawn && Math.abs(drawn.top - drawn.expected) < 1e-6 && drawn.h > 0,
    `a wolf on raised ground is drawn ${drawn && (drawn.h * 8).toFixed(1)} px up, at the ground's height`);

  // 4. cliffs block, ledges don't: on a flat dry row of tiles about the start, the tiles
  // east of the second raised by 2 (a cliff) or 1 (a ledge); a wolf walks straight at it
  const walk = await p.evaluate(() => {
    const dry = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
    sim.allCritters.filter(c => c !== sim.pcWolf).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    const flat = (i, j, l) => sim.tileCorners(i, j).every(c => c === l);
    const find = skip => {
      for (const [i, j] of sim.internals.allLandTiles) {
        if (skip && Math.abs(i - skip[0]) < 12 && Math.abs(j - skip[1]) < 12) continue;
        const l = sim.tileCorners(i, j)[0];
        let ok = true;
        for (let di = 0; di < 8 && ok; di++) for (let dj = -2; dj <= 2 && ok; dj++) ok = dry(i + di, j + dj) && flat(i + di, j + dj, l);
        if (ok) return [i, j];
      }
      return null;
    };
    const tryCross = (tile, rise) => {
      if (!tile) return null;
      const [i, j] = tile, l = sim.tileCorners(i, j)[0];
      // the tiles from i + 2 east raised: the step is the edge between i + 1 and i + 2
      for (let di = 2; di < 8; di++) for (let dj = -2; dj <= 2; dj++) sim.internals.setTileCorners(i + di, j + dj, [l + rise, l + rise, l + rise, l + rise]);
      const w = sim.pcWolf;
      w.gx = w.nextGX = i + 0.5; w.gy = w.nextGY = j + 0.5; w.stunnedUntil = 0;
      sim.internals.setCritterIdle(w);
      // the player's intent keeps the wolf pushing east (decisions can't turn it)
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" });
      for (let n = 0; n < 120; n++) sim.internals.tick();
      sim.setPlayerIntent(null); sim.internals.tick();
      return { crossed: w.gx > i + 2, gx: w.gx - i, rise };
    };
    const cliffAt = find(null), ledgeAt = find(cliffAt);
    return { cliff: tryCross(cliffAt, 2), ledge: tryCross(ledgeAt, 1) };
  });
  r.check(walk.cliff && !walk.cliff.crossed,
    `a 2-level cliff stops a walking wolf (${walk.cliff ? "stopped " + walk.cliff.gx.toFixed(2) + " tiles on" : "no flat ground found"})`);
  r.check(walk.ledge && walk.ledge.crossed,
    `a one-level ledge doesn't (${walk.ledge ? "reached " + walk.ledge.gx.toFixed(2) + " tiles on" : "no flat ground found"})`);

  // screenshot of the highest ground about the start
  const outDir = ensureOutputDir("terrain");
  await p.evaluate(() => {
    const A = sim.startNear;
    let best = null;
    for (let i = A.i0; i < A.i1; i++) for (let j = A.j0; j < A.j1; j++) {
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

module.exports = { name: "terrain", main };
if (require.main === module) runStandalone(module.exports.name, main);
