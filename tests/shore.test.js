// Shores (see SHORES in animat.js): the sea's, an outgoing wave from the land that always
// joins up; lakes and rivers lie still.
//  On the real map:
//  - on the sea's coast, shore tiles show the straight sprites (tiles.png row 9, columns 0-1), the outer
//    corners (images/shore-outer.png) or the interior corners (images/shore-inner.png);
//    all other water stays on the plain frame
//  - one global clock: every interior corner shows the same frame at the same time (0, 1,
//    2, 3, 0, ...), and every straight and outer-corner tile holds each of its two frames
//    twice as long (0, 0, 1, 1, 0, ...), with the interior corner's frames 0-1 and 2-3, so
//    the loops repeat in sync; nothing moves while paused
//  - lakes and rivers lie still: their shores are plain water, never lapping
//  On a test map (the terrain swapped for sea with shapes of land):
//  - a straight coast is all straight tiles, light to the land, all the same way round
//  - a rectangle of land has exactly 4 corner pieces, at its corners, touching land only
//    there (so has a 1-tile island); water ringed by land has an interior corner in each
//    of its corners
//  - a staircase coast has an interior corner in each notch and a corner piece beyond each
//  - every wave joins up: wherever one crosses a tile edge into water, the tile across has
//    a wave crossing at the same point
// Saves screenshots to tests/output/shore/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 650 } });
  const outDir = ensureOutputDir("shore");

  const res = await p.evaluate(() => {
    sim.pause();
    const T = sim.getTerrainAt;
    // the sea's coast nearest the start (walking from the start toward the nearest ocean
    // node of the map's graph, by its own lookup: cheap), with shore and open sea on screen
    const M = sim.internals.terrainMap, G = M.graph, A = sim.startArea;
    const cx = (A.i0 + A.i1) / 2, cy = (A.j0 + A.j1) / 2;
    let best = -1, bestD2 = Infinity;
    for (let n = 0; n < G.nx * G.ny; n++)
      if (G.ocean[n] && (G.px[n] - cx) ** 2 + (G.py[n] - cy) ** 2 < bestD2) { best = n; bestD2 = (G.px[n] - cx) ** 2 + (G.py[n] - cy) ** 2; }
    const l = Math.sqrt(bestD2), ux = (G.px[best] - cx) / l, uy = (G.py[best] - cy) / l;
    let at = null;
    for (let t = 0; t <= l + 3000 && !at; t += 2) { // (on past the node: it may lie on the coast's land)
      const i = Math.floor(cx + ux * t), j = Math.floor(cy + uy * t);
      if (M.terrainAt(i, j).kind === "sea") at = [i + Math.round(ux * 4), j + Math.round(uy * 4)];
    }
    animat.setZoom(2); animat.centerCameraOn(at[0], at[1]); animat.render();

    // the water tiles drawn, by where they are drawn (left = (i - j) * 16 - 16,
    // top = (i + j) * 8 - 8, raised 8 a level of its water); each as drawn now (animat.tileOf)
    const gridOf = t => {
      const a = (t.left + 16) / 16, b = (t.top + 8) / 8 + t.level;
      return [Math.round((a + b) / 2), Math.round((b - a) / 2)];
    };
    const waters = animat.tilesInView().filter(t => t.kind === "water").map(gridOf);
    const now = ([i, j]) => animat.tileOf(i, j);
    const isLand = (i, j) => i >= 0 && j >= 0 && i < sim.gridWidthN && j < sim.gridHeightN && T(i, j) !== "water";
    // its land edges, by screen edge (TL = grid W, TR = N, BL = S, BR = E)
    const landEdges = ([i, j]) => ["TL", "TR", "BL", "BR"].filter((e, k) =>
      isLand(...[[i - 1, j], [i, j - 1], [i, j + 1], [i + 1, j]][k]));
    // the edges a shown sprite has its light on: as drawn (one-edge TR; a corner or interior
    // corner TL+TR on its sheet's row 0, TR+BR on row 1), then mirrored
    const lightEdges = t => {
      const col = frameOf(t)[0];
      let edges = col <= 1 ? ["TR"] : t.sy ? ["TR", "BR"] : ["TL", "TR"];
      const fx = t.flipX, fy = t.flipY;
      return edges.map(e => (fy ? (e[0] === "T" ? "B" : "T") : e[0]) + (fx ? (e[1] === "L" ? "R" : "L") : e[1])).sort();
    };
    const frameOf = t => {
      // (the outer corners' frames counted as "columns" 20-21, the interior corners' as
      // 10-13, to tell them apart)
      return t.image.includes("shore-outer") ? [20 + t.sx / 32, 9]
        : t.image.includes("shore-inner") ? [10 + t.sx / 32, 9] : [t.sx / 32, t.sy / 32];
    };

    // each water tile's frame over two whole two-edge loops
    const seq = waters.map(() => []);
    for (let n = 0; n <= 8 * 24; n++) {
      sim.internals.tick(); animat.render();
      waters.forEach((g, k) => seq[k].push(frameOf(now(g)).join()));
    }
    // paused: drawing again without ticking changes nothing
    const before = waters.map(g => frameOf(now(g)).join()); animat.render(); animat.render();
    const still = waters.every((g, k) => frameOf(now(g)).join() === before[k]);

    let open = 0, one = 0, two = 0, other = 0, misplaced = 0, wrongSet = 0, misfaced = 0;
    let openPlain = true, ordered = true;
    const bySet = { one: null, two: null, inner: null }; let together = true; let inner = 0;
    seq.forEach((frames, k) => {
      const [i, j] = waters[k], el = now(waters[k]), land = landEdges([i, j]);
      const cols = frames.map(f => +f.split(",")[0]);
      const set = cols.every(c => c <= 1) ? "one" : cols.every(c => c >= 20 && c <= 21) ? "two"
        : cols.every(c => c >= 10 && c <= 13) ? "inner" : "?";
      const laps = new Set(frames).size > 1;
      if (!laps) {
        open++;
        if (frames[0] !== "6,9") openPlain = false;
        return;
      }
      if (set === "one") one++; else if (set === "two") two++; else if (set === "inner") inner++; else wrongSet++;
      if (set === "?") return;
      // in order, round and round
      const loop = set === "one" ? [0, 1] : set === "two" ? [20, 21] : [10, 11, 12, 13];
      for (let n = 1; n < cols.length; n++) {
        const a = loop.indexOf(cols[n - 1]), b = loop.indexOf(cols[n]);
        if (a < 0 || b < 0 || (b !== a && b !== (a + 1) % loop.length)) ordered = false;
      }
      if (new Set(cols).size !== loop.length) ordered = false;
      // the same frame as every other tile of its set, at every moment
      if (!bySet[set]) bySet[set] = cols;
      else if (cols.some((c, n) => c !== bySet[set][n])) together = false;
    });
    // in sync: the outer corners show the straight tiles' frame at every moment; the
    // interior corners step twice as often, their frames 0-1 with the straight frame 0
    // and 2-3 with 1
    let synced = !!(bySet.one && bySet.two && bySet.inner);
    if (synced) {
      const changes = c => c.filter((x, n) => n > 0 && x !== c[n - 1]).length;
      if (bySet.two.some((c, n) => c - 20 !== bySet.one[n])) synced = false;
      if (bySet.inner.some((c, n) => (c - 10) >> 1 !== bySet.one[n])) synced = false;
      if (changes(bySet.inner) !== 2 * changes(bySet.one)) synced = false;
    }
    const sea = waters.every(([i, j]) => sim.waterKindAt(i, j) === "sea");
    return { synced, inner, open, one, two, other, misplaced, wrongSet, misfaced, openPlain, ordered, together, still, sea, at };
  });
  r.check(res.one > 0 && res.two > 0 && res.open > 0 && res.wrongSet === 0,
    `real map, on the sea's coast (at ${res.at}; all sea: ${res.sea}): ${res.one} straight shore tiles, ${res.two} corner ones, ${res.inner} interior ones, ${res.open} plain (${res.wrongSet} with mixed frames)`);
  r.check(res.openPlain, "open water stays on the plain water frame");
  r.check(res.ordered, "each shore plays its set's frames in order, round and round");
  r.check(res.together, "one clock: every tile of a set shows the same frame at the same time");
  r.check(res.synced, "the loops repeat in sync: the outer corners with the straight tiles, the interior corners twice as often");
  r.check(res.still, "nothing laps while the game is paused");

  await p.screenshot({ path: path.join(outDir, "shore.png") });

  // fresh water lies still: the lakes and rivers about the start, their shores too
  const fresh = await p.evaluate(() => {
    const A = sim.startArea, T = sim.getTerrainAt;
    const out = { lakeShores: 0, riverShores: 0, lapping: 0, plainFrame: true };
    tiles: for (let i = A.i0 - 64; i < A.i1 + 64; i++) for (let j = A.j0 - 64; j < A.j1 + 64; j++) {
      if (T(i, j) !== "water") continue;
      const k = sim.waterKindAt(i, j);
      if (k === "sea") continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => T(i + a, j + b) !== "water")) continue;
      if (k === "lake") out.lakeShores++; else out.riverShores++;
      const frames = new Set();
      for (const clock of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const t = animat.tileOf(i, j);
        frames.add(t.sx + "," + t.sy + "," + (t.shore ? 1 : 0));
        sim.internals.tick();
      }
      if (frames.size > 1 || [...frames][0].endsWith(",1")) out.lapping++;
      if ([...frames][0] !== "192,288,0") out.plainFrame = false;
      if (out.lakeShores >= 20 && out.riverShores >= 20) break tiles;
    }
    return out;
  });
  r.check(fresh.lakeShores + fresh.riverShores >= 20 && fresh.lapping === 0 && fresh.plainFrame,
    `lakes and rivers lie still: of ${fresh.lakeShores} lake and ${fresh.riverShores} river shore tiles about the start, ${fresh.lapping} lap; all plain water: ${fresh.plainFrame}`);

  // the test map
  const shapes = await p.evaluate(() => {
    const rect = (i, j) => i >= 40 && i <= 45 && j >= 40 && j <= 43;
    const island = (i, j) => i === 52 && j === 40;
    const lake = (i, j) => i >= 40 && i <= 48 && j >= 50 && j <= 58 && !(i >= 42 && i <= 46 && j >= 52 && j <= 56);
    const stairs = (i, j) => i >= 56 && j >= 48 && i <= 66 && j <= 60 && (i - 56) + (j - 48) <= 7;
    const land = (i, j) => rect(i, j) || island(i, j) || lake(i, j) || stairs(i, j);
    sim.getTerrainAt = (i, j) => land(i, j) ? "grass" : "water";
    sim.waterKindAt = (i, j) => land(i, j) ? null : "sea";
    sim.obstacleAt = () => null;
    sim.tileCorners = () => [0, 0, 0, 0];
    animat.setZoom(2); animat.centerCameraOn(52, 50);
    animat.redrawTerrain();
    // each water tile as drawn (animat.tileOf)
    const isWater = (i, j) => !land(i, j);
    const step = { TL: [-1, 0], TR: [0, -1], BL: [0, 1], BR: [1, 0] };
    const cornerStep = { T: [-1, -1], R: [1, -1], B: [1, 1], L: [-1, 1] };
    const cornerEdges = { T: ["TL", "TR"], R: ["TR", "BR"], B: ["BR", "BL"], L: ["BL", "TL"] };
    // what a tile shows: { kind: "straight", edge } / { kind: "corner", corner } / null,
    // read back from its sprite (straight: light along TR as drawn; corner: light at T, or
    // at R on its sheet's row 1), then its mirroring
    const shown = (i, j) => {
      const el = animat.tileOf(i, j);
      if (el.kind !== "water" || !el.shore) return null;
      const fx = el.flipX, fy = el.flipY;
      const flipEdge = e => (fy ? (e[0] === "T" ? "B" : "T") : e[0]) + (fx ? (e[1] === "L" ? "R" : "L") : e[1]);
      if (el.shore.set === "linear") return { kind: "straight", edge: flipEdge("TR") };
      if (el.shore.set === "inner") {
        let c = el.shore.row ? "R" : "T";
        if (fy) c = { T: "B", B: "T", L: "L", R: "R" }[c];
        if (fx) c = { L: "R", R: "L", T: "T", B: "B" }[c];
        return { kind: "inner", corner: c };
      }
      let c = el.shore.row ? "R" : "T";
      if (fy) c = { T: "B", B: "T", L: "L", R: "R" }[c];
      if (fx) c = { L: "R", R: "L", T: "T", B: "B" }[c];
      return { kind: "corner", corner: c };
    };
    const landEdges = (i, j) => Object.keys(step).filter(e => !isWater(i + step[e][0], j + step[e][1]));
    const tilesIn = (i0, i1, j0, j1) => {
      const out = [];
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (isWater(i, j)) out.push([i, j]);
      return out;
    };
    // around a shape: its straight tiles face their only land edge; corner pieces where
    const survey = (i0, i1, j0, j1) => {
      let straightOk = 0, straightBad = 0; const corners = [], notches = [], beyond = [];
      for (const [i, j] of tilesIn(i0, i1, j0, j1)) {
        const s = shown(i, j), le = landEdges(i, j);
        if (le.length === 1) { if (s && s.kind === "straight" && s.edge === le[0]) straightOk++; else straightBad++; }
        if (s && s.kind === "inner") {
          (cornerEdges[s.corner].every(e => le.includes(e)) ? notches : beyond).push([i, j]);
        }
        if (s && s.kind === "corner") {
          const [di, dj] = cornerStep[s.corner];
          (le.length === 0 && !isWater(i + di, j + dj) ? corners : beyond).push([i, j]);
        }
      }
      return { straightOk, straightBad, corners: corners.length, notches: notches.length, odd: beyond.length };
    };
    const r = {
      rect: survey(38, 47, 38, 45), island: survey(50, 54, 38, 42),
      lakeIn: survey(42, 46, 52, 56), stairs: survey(55, 68, 47, 62),
    };
    // staircase: no wave beyond its notches (water touching it only at a corner, beside
    // notches)
    const isNotch = (i, j) => {
      const le = landEdges(i, j);
      return isWater(i, j) && le.length === 2 && le[0] !== { TL: "BR", BR: "TL", TR: "BL", BL: "TR" }[le[1]];
    };
    // beyond the notches: water touching land only at a corner, with notches on both
    // sides of that corner - each should have a corner piece there
    let beyond = 0, beyondCornered = 0, notchTiles = 0;
    for (const [i, j] of tilesIn(55, 68, 47, 62)) {
      if (isNotch(i, j)) notchTiles++;
      if (landEdges(i, j).length) continue;
      for (const c of Object.keys(cornerStep)) {
        const [di, dj] = cornerStep[c];
        if (isWater(i + di, j + dj)) continue;
        if (!cornerEdges[c].every(e => isNotch(i + step[e][0], j + step[e][1]))) continue;
        beyond++;
        const s = shown(i, j);
        if (s && s.kind === "corner" && s.corner === c) beyondCornered++;
      }
    }
    r.stairs.notchTiles = notchTiles; r.stairs.beyond = beyond; r.stairs.beyondCornered = beyondCornered;
    // every wave joins up: its crossings into water are met by the tile across
    const edgeCorners = { TL: ["L", "T"], TR: ["T", "R"], BR: ["R", "B"], BL: ["B", "L"] };
    const cornerVertex = { T: [0, 0], R: [1, 0], B: [1, 1], L: [0, 1] };
    const opposite = { TL: "BR", BR: "TL", TR: "BL", BL: "TR" };
    const straightX = e => edgeCorners[e].map(c => [cornerEdges[c].find(f => f !== e), c]);
    const crossings = sh => sh.kind === "straight" ? straightX(sh.edge)
      : sh.kind === "inner" ? cornerEdges[sh.corner].flatMap(straightX)
      : cornerEdges[sh.corner].map(e => [e, sh.corner]);
    let joined = 0, dangling = 0;
    const dangles = [];
    for (let i = 36; i <= 70; i++) for (let j = 36; j <= 64; j++) {
      if (!isWater(i, j)) continue;
      const sh = shown(i, j);
      if (!sh) continue;
      for (const [e, c] of crossings(sh)) {
        const [ni, nj] = [i + step[e][0], j + step[e][1]];
        if (!isWater(ni, nj)) continue; // ends at land
        const v = [cornerVertex[c][0] - step[e][0], cornerVertex[c][1] - step[e][1]];
        const c2 = Object.keys(cornerVertex).find(k => cornerVertex[k][0] === v[0] && cornerVertex[k][1] === v[1]);
        const n = shown(ni, nj);
        if (n && crossings(n).some(([e3, c3]) => e3 === opposite[e] && c3 === c2)) joined++;
        else { dangling++; if (dangles.length < 5) dangles.push([i, j, e, c]); }
      }
    }
    r.joined = joined; r.dangling = dangling; r.dangles = dangles;
    return r;
  });
  r.check(shapes.rect.straightBad === 0 && shapes.rect.straightOk > 0,
    `rectangle: straight coast all straight tiles, light to the land (${shapes.rect.straightOk} right, ${shapes.rect.straightBad} wrong)`);
  r.check(shapes.rect.corners === 4 && shapes.rect.odd === 0 && shapes.rect.notches === 0,
    `rectangle: exactly 4 corner pieces, touching land only at their corner (${shapes.rect.corners}; ${shapes.rect.odd} elsewhere)`);
  r.check(shapes.island.corners === 4 && shapes.island.straightOk === 4 && shapes.island.straightBad === 0,
    `1-tile island: 4 straight tiles and 4 corner pieces (${shapes.island.straightOk}, ${shapes.island.corners})`);
  r.check(shapes.lakeIn.notches === 4 && shapes.lakeIn.straightBad === 0 && shapes.lakeIn.odd === 0,
    `water ringed by land: an interior corner in each of its 4 corners, straight tiles along its sides (${shapes.lakeIn.notches} corners, ${shapes.lakeIn.straightBad} wrong)`);
  r.check(shapes.stairs.notches === shapes.stairs.notchTiles && shapes.stairs.notchTiles > 3,
    `staircase: an interior corner in every notch (${shapes.stairs.notches}/${shapes.stairs.notchTiles})`);
  r.check(shapes.stairs.beyond > 3 && shapes.stairs.beyondCornered === shapes.stairs.beyond,
    `staircase: a corner piece beyond each pair of notches (${shapes.stairs.beyondCornered}/${shapes.stairs.beyond})`);
  r.check(shapes.joined > 0 && shapes.dangling === 0,
    `every wave joins up (${shapes.joined} joins, ${shapes.dangling} left hanging ${JSON.stringify(shapes.dangles)})`);
  await p.evaluate(() => { animat.setZoom(2); animat.centerCameraOn(52, 50); animat.render(); });
  await p.screenshot({ path: path.join(outDir, "shapes.png") });
  r.noProblems(p);
  await p.close();
  console.log(`      screenshot saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "shores (lapping water)", main };
if (require.main === module) runStandalone(module.exports.name, main);
