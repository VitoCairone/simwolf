// Shores (see SHORES in animat.js): an outgoing wave from the land that always joins up.
//  On the real map:
//  - shore tiles show the straight sprites (tiles.png row 9, columns 0-1), the corner
//    sprites (columns 2-5) or the interior corners (images/shore-inner.png); all other
//    water stays on the plain frame
//  - one global clock: every corner tile shows the same frame at the same time (2, 3, 4,
//    5, 2, ...), every interior corner steps with them through its 4 frames, and every
//    straight tile holds each of its frames twice as long (0, 0, 1, 1, 0, ...), so the
//    loops repeat in sync; nothing moves while paused
//  On a test map (the terrain swapped for water with shapes of land):
//  - a straight coast is all straight tiles, light to the land, all the same way round
//  - a rectangle of land has exactly 4 corner pieces, at its corners, touching land only
//    there (so has a 1-tile island); a lake has an interior corner in each of its corners
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
    // somewhere with both shore and open water on screen
    let at = null;
    for (let i = 10; i < sim.gridWidthN - 10 && !at; i += 3)
      for (let j = 10; j < sim.gridHeightN - 10 && !at; j += 3)
        if (T(i, j) === "water" && T(i + 4, j) !== "water") at = [i, j];
    animat.setZoom(2); animat.centerCameraOn(at[0], at[1]); animat.render();

    const waters = [...document.querySelectorAll(".tile.water")];
    // a water tile's grid position, from where it is drawn (left = (i - j) * 16 - 16,
    // top = (i + j) * 8 - 8)
    const gridOf = el => {
      const a = (parseFloat(el.style.left) + 16) / 16, b = (parseFloat(el.style.top) + 8) / 8;
      return [Math.round((a + b) / 2), Math.round((b - a) / 2)];
    };
    const isLand = (i, j) => i >= 0 && j >= 0 && i < sim.gridWidthN && j < sim.gridHeightN && T(i, j) !== "water";
    // its land edges, by screen edge (TL = grid W, TR = N, BL = S, BR = E)
    const landEdges = ([i, j]) => ["TL", "TR", "BL", "BR"].filter((e, k) =>
      isLand(...[[i - 1, j], [i, j - 1], [i, j + 1], [i + 1, j]][k]));
    // the edges a shown sprite has its light on: as drawn (one-edge TR; two-edge TL+TR, or
    // TR+BR on the rotated sheet), then mirrored
    const lightEdges = el => {
      const rotated = (el.style.backgroundImage || "").includes("shore-rotated");
      const col = frameOf(el)[0];
      let edges = rotated ? ["TR", "BR"] : col <= 1 ? ["TR"] : ["TL", "TR"];
      const m = /scale\((-?1), (-?1)\)/.exec(el.style.transform || "");
      const fx = m && m[1] === "-1", fy = m && m[2] === "-1";
      return edges.map(e => (fy ? (e[0] === "T" ? "B" : "T") : e[0]) + (fx ? (e[1] === "L" ? "R" : "L") : e[1])).sort();
    };
    const frameOf = el => {
      const m = /(\d+)px -?(\d+)px/.exec(el.style.backgroundPosition || getComputedStyle(el).backgroundPosition);
      const img = el.style.backgroundImage || "";
      // (the interior sheet's frames counted as "columns" 10-13, to tell them apart)
      return m ? (img.includes("shore-rotated") ? [2 + +m[1] / 32, 9]
        : img.includes("shore-inner") ? [10 + +m[1] / 32, 9] : [+m[1] / 32, +m[2] / 32]) : null;
    };

    // each water tile's frame over two whole two-edge loops
    const seq = waters.map(() => []);
    for (let n = 0; n <= 8 * 24; n++) {
      sim.internals.tick(); animat.render();
      waters.forEach((el, k) => seq[k].push(frameOf(el).join()));
    }
    // paused: drawing again without ticking changes nothing
    const before = waters.map(el => frameOf(el).join()); animat.render(); animat.render();
    const still = waters.every((el, k) => frameOf(el).join() === before[k]);

    let open = 0, one = 0, two = 0, other = 0, misplaced = 0, wrongSet = 0, misfaced = 0;
    let openPlain = true, ordered = true;
    const bySet = { one: null, two: null, inner: null }; let together = true; let inner = 0;
    seq.forEach((frames, k) => {
      const el = waters[k], [i, j] = gridOf(el), land = landEdges([i, j]);
      const cols = frames.map(f => +f.split(",")[0]);
      const set = cols.every(c => c <= 1) ? "one" : cols.every(c => c >= 2 && c <= 5) ? "two"
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
      const loop = set === "one" ? [0, 1] : set === "two" ? [2, 3, 4, 5] : [10, 11, 12, 13];
      for (let n = 1; n < cols.length; n++) {
        const a = loop.indexOf(cols[n - 1]), b = loop.indexOf(cols[n]);
        if (a < 0 || b < 0 || (b !== a && b !== (a + 1) % loop.length)) ordered = false;
      }
      if (new Set(cols).size !== loop.length) ordered = false;
      // the same frame as every other tile of its set, at every moment
      if (!bySet[set]) bySet[set] = cols;
      else if (cols.some((c, n) => c !== bySet[set][n])) together = false;
    });
    // in sync: wherever the corner loop starts (frame 2), the linear loop starts (frame 0),
    // and the linear frames last twice as long
    let synced = !!(bySet.one && bySet.two);
    if (synced) {
      const changes = c => c.filter((x, n) => n > 0 && x !== c[n - 1]).length;
      for (let n = 0; n < bySet.two.length; n++) {
        if (bySet.two[n] === 2 && bySet.one[n] !== 0) synced = false;
        if (bySet.two[n] === 4 && bySet.one[n] !== 1) synced = false;
      }
      if (changes(bySet.two) !== 2 * changes(bySet.one)) synced = false;
      // the interior corners step with the corners: frame k of each at the same moment
      if (bySet.inner && bySet.inner.some((c, n) => c - 10 !== bySet.two[n] - 2)) synced = false;
    }
    return { synced, inner, open, one, two, other, misplaced, wrongSet, misfaced, openPlain, ordered, together, still };
  });
  r.check(res.one > 0 && res.two > 0 && res.open > 0 && res.wrongSet === 0,
    `real map: ${res.one} straight shore tiles, ${res.two} corner ones, ${res.inner} interior ones, ${res.open} plain (${res.wrongSet} with mixed frames)`);
  r.check(res.openPlain, "open water stays on the plain water frame");
  r.check(res.ordered, "each shore plays its set's frames in order, round and round");
  r.check(res.together, "one clock: every tile of a set shows the same frame at the same time");
  r.check(res.synced, "the loops repeat in sync: the straight frames last twice as long, the interior corners step with the corners");
  r.check(res.still, "nothing laps while the game is paused");

  await p.screenshot({ path: path.join(outDir, "shore.png") });

  // the test map
  const shapes = await p.evaluate(() => {
    const rect = (i, j) => i >= 40 && i <= 45 && j >= 40 && j <= 43;
    const island = (i, j) => i === 52 && j === 40;
    const lake = (i, j) => i >= 40 && i <= 48 && j >= 50 && j <= 58 && !(i >= 42 && i <= 46 && j >= 52 && j <= 56);
    const stairs = (i, j) => i >= 56 && j >= 48 && i <= 66 && j <= 60 && (i - 56) + (j - 48) <= 7;
    const land = (i, j) => rect(i, j) || island(i, j) || lake(i, j) || stairs(i, j);
    sim.getTerrainAt = (i, j) => land(i, j) ? "grass" : "water";
    sim.obstacleAt = () => null;
    sim.tileCorners = () => [0, 0, 0, 0];
    animat.setZoom(2); animat.centerCameraOn(52, 50);
    animat.redrawTerrain();
    // each water tile's grid position, from where it is drawn
    const at = new Map();
    for (const el of document.querySelectorAll(".tile.water")) {
      const a = (parseFloat(el.style.left) + 16) / 16, b = (parseFloat(el.style.top) + 8) / 8;
      at.set(Math.round((a + b) / 2) + "," + Math.round((b - a) / 2), el);
    }
    const isWater = (i, j) => !land(i, j);
    const step = { TL: [-1, 0], TR: [0, -1], BL: [0, 1], BR: [1, 0] };
    const cornerStep = { T: [-1, -1], R: [1, -1], B: [1, 1], L: [-1, 1] };
    const cornerEdges = { T: ["TL", "TR"], R: ["TR", "BR"], B: ["BR", "BL"], L: ["BL", "TL"] };
    // what a tile shows: { kind: "straight", edge } / { kind: "corner", corner } / null,
    // read back from its sprite (straight: light along TR as drawn; corner: light at T, or
    // at R on the rotated sheet), then its mirroring
    const shown = (i, j) => {
      const el = at.get(i + "," + j);
      if (!el || !el.shore) return null;
      const m = /scale\((-?1), (-?1)\)/.exec(el.style.transform || "");
      const fx = m && m[1] === "-1", fy = m && m[2] === "-1";
      const flipEdge = e => (fy ? (e[0] === "T" ? "B" : "T") : e[0]) + (fx ? (e[1] === "L" ? "R" : "L") : e[1]);
      if (el.shore.set === "linear") return { kind: "straight", edge: flipEdge("TR") };
      if (el.shore.set === "inner") {
        let c = el.shore.row ? "R" : "T";
        if (fy) c = { T: "B", B: "T", L: "L", R: "R" }[c];
        if (fx) c = { L: "R", R: "L", T: "T", B: "B" }[c];
        return { kind: "inner", corner: c };
      }
      let c = el.shore.rotated ? "R" : "T";
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
    `lake: an interior corner in each of its 4 corners, straight tiles along its sides (${shapes.lakeIn.notches} corners, ${shapes.lakeIn.straightBad} wrong)`);
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
