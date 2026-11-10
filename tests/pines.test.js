// Pines (see PINES, PINE NEEDLES and PINE BROWSE in sim.js, PINES in animat.js):
//  - placed by the tile alone: the same however often worked out, and in a block made afresh
//  - forests' hearts about 600 trees a hectare (a tile is a square metre), open stands
//    about 120, lone pines a few, and none in much of the map; never two on neighbouring
//    tiles
//  - sizes: fewer trees in each larger diameter class (the "reverse J"), saplings besides;
//    heights 9-27 m (trees), 0.6-3 m (saplings)
//  - a trunk blocks the way and sight only as wide as it is; a sapling blocks only sight,
//    up to its height
//  - deer browse the needles in reach (a sapling's): at half grass's fresh rate, the ledger
//    balanced; they regrow to their most; a grazing deer takes grass it sees over needles,
//    and needles when there is nothing better
//  - height and crown by diameter (FVS-LS, white pine), forest- or open-grown
//  - drawn at its real size, from sprites made for those sizes: a tree's crown on its
//    tile, its trunk as wide as it blocks sight with a foot the front half of an
//    ellipse, not drawn under its crown; a tree's crown (over 8 m) always see-through, a
//    sapling's where it covers a critter (purely drawing), all see-through crowns drawn as
//    one layer at 65%, so overlapping ones are no more opaque than one
// Runs sim.js, senses.js and mind.js in Node; then the game in the browser. Saves
// screenshots to tests/output/pines/.

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, testStart, openGame, runStandalone, ensureOutputDir } = require("./helpers");

function load() {
  const context = vm.createContext({ simStart: testStart,
    console: { log() {}, info() {}, warn() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  vm.runInContext(`
    var S = sim.internals, H = sim.gridHeightN;
    var deer = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; if (a !== deer) { a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; } });
    S.holdWater(true);
    var put = (a, x, y, hx = 1, hy = 0) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; a.stunnedUntil = 0; a.climbingUntil = -1;
      a.eating = false; S.setCritterIdle(a); a.hx = hx; a.hy = hy; };
    // which part of the pine country tile (i, j) is in (by the density alone)
    var zone = (i, j) => { const [d, h] = S.pineDensityAt(i, j, "grass"); return d === 0 ? "none" : h >= 1 ? "heart" : h > 0 ? "edge" : d > 0.005 ? "stand" : "lone"; };
    // a level, open patch about the start, R tiles each way of (i, j), cleared of boulders,
    // pines, undergrowth and grass
    var A = sim.startArea, ci = (A.i0 + A.i1) >> 1, cj = (A.j0 + A.j1) >> 1;
    var patch = (i, j, R, grassKg = 0) => {
      const lv = sim.tileCorners(i, j)[0];
      for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
        const a = i + di, b = j + dj;
        S.setTileCorners(a, b, [lv, lv, lv, lv]); S.setBoulder(a, b, false);
        if (sim.undergrowthAt(a, b)) S.setUndergrowthKg(a, b, 0);
        if (sim.getTerrainAt(a, b) === "grass") S.setGrassKg(a * H + b, grassKg);
      }
    };
    var grassSpot = () => { // a grass tile in the start square with grass all about it
      for (let i = ci; i < A.i1; i++) for (let j = cj; j < A.j1; j++) {
        let ok = true;
        for (let di = -26; di <= 26 && ok; di += 2) for (let dj = -26; dj <= 26 && ok; dj += 2) ok = sim.getTerrainAt(i + di, j + dj) === "grass";
        if (ok) return [i, j];
      }
      return null;
    };
  `, c);

  // placed by the tile alone
  const fixed = vm.runInContext(`(() => {
    // a forest heart near the start
    let at = null;
    for (let r = 0; r < 6000 && !at; r += 16) for (let t = 0; t < 64 && !at; t++) {
      const i = Math.round(ci + r * Math.cos(t / 64 * 6.2832)), j = Math.round(cj + r * Math.sin(t / 64 * 6.2832));
      if (zone(i, j) === "heart" && zone(i + 40, j) === "heart" && zone(i, j + 40) === "heart" && zone(i + 40, j + 40) === "heart") at = [i, j];
    }
    if (!at) return null;
    const [i0, j0] = at, read = () => { const out = []; for (let i = i0; i < i0 + 40; i++) for (let j = j0; j < j0 + 40; j++) out.push(JSON.stringify(sim.pineOn(i, j))); return out.join(); };
    const first = read(), again = read();
    S.terrainBlocks.clear();
    const afresh = read();
    return { at, same: first === again && first === afresh, n: first.split("null").length };
  })()`, c);
  r.check(fixed && fixed.same, `pines are placed by the tile alone: the same read twice and in blocks made afresh (${JSON.stringify(fixed && fixed.at)})`);

  // density, spacing, sizes, heights
  const counts = vm.runInContext(`(() => {
    const z = { heart: [0, 0], edge: [0, 0], stand: [0, 0], lone: [0, 0], none: [0, 0] };
    const sizes = new Array(9).fill(0), heights = { tree: [Infinity, 0], sapling: [Infinity, 0] };
    const grown = { forest: [0, 0], outside: [0, 0] }; // [in a forest, in the open]
    let neighbours = 0;
    for (let k = 0; k < 300; k++) {
      const i0 = Math.floor(S.hash01(k, 3, 7) * 40000) + 5000, j0 = Math.floor(S.hash01(k, 4, 7) * 40000) + 5000;
      for (let i = i0; i < i0 + 48; i++) for (let j = j0; j < j0 + 48; j++) {
        const n = zone(i, j), p = S.pineIn(i, j, "grass");
        z[n][0]++;
        if (!p) continue;
        z[n][1]++;
        const size = p[0] & 15, open = (p[0] & 16) !== 0;
        if (n === "heart") sizes[size]++;
        grown[n === "heart" || n === "edge" ? "forest" : "outside"][open ? 1 : 0]++;
        const h = heights[size === 1 ? "sapling" : "tree"], m = p[2] / 2 / sim.levelsPerMetre;
        h[0] = Math.min(h[0], m); h[1] = Math.max(h[1], m);
        for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) if (S.pineIn(i + di, j + dj, "grass")) neighbours++;
      }
    }
    const perHa = Object.fromEntries(Object.entries(z).map(([k, [n, p]]) => [k, n ? Math.round(p / n * 1e4) : null]));
    const share = Object.fromEntries(Object.entries(z).map(([k, [n]]) => [k, n]));
    return { perHa, share, sizes, heights, neighbours, grown };
  })()`, c);
  const ha = counts.perHa, land = Object.values(counts.share).reduce((a, b) => a + b, 0);
  r.check(ha.heart > 500 && ha.heart < 700 && ha.stand > 90 && ha.stand < 150 && ha.lone > 5 && ha.lone < 30 && ha.none === 0
    && counts.share.none / land > 0.25 && (counts.share.heart + counts.share.edge) / land > 0.1,
    `pines a hectare: forest hearts ${ha.heart}, forest edges ${ha.edge}, open stands ${ha.stand}, lone pines ${ha.lone}, ` +
    `and none on ${Math.round(counts.share.none / land * 100)}% of the land (forests on ${Math.round((counts.share.heart + counts.share.edge) / land * 100)}%)`);
  r.check(counts.neighbours === 0, `never two pines on neighbouring tiles (${counts.neighbours})`);
  const trees = counts.sizes.slice(2), weights = vm.runInContext("S.pineClasses.map(c => c[2])", c);
  const ratios = trees.map((n, k) => n / trees[0] / (weights[k] / weights[0]));
  const saplingShare = counts.sizes[1] / (counts.sizes[1] + trees.reduce((a, b) => a + b, 0));
  r.check(trees.every((n, k) => k === 0 || n < trees[k - 1]) && ratios.every(x => x > 0.8 && x < 1.25) && saplingShare > 0.2 && saplingShare < 0.3,
    `in a forest's heart, fewer trees in each larger diameter class, as the guide's (${trees.join(", ")}: ` +
    `${ratios.map(x => x.toFixed(2)).join(", ")} of its shares), and saplings besides (${Math.round(saplingShare * 100)}%)`);
  const hs = counts.heights;
  // (heights kept to half a level, 0.2 m)
  r.check(hs.tree[0] >= 8.5 && hs.tree[1] <= 35 && hs.tree[1] > 32 && hs.sapling[0] >= 0.45 && hs.sapling[1] <= 3.15,
    `trees stand ${hs.tree[0].toFixed(1)}-${hs.tree[1].toFixed(1)} m, saplings ${hs.sapling[0].toFixed(1)}-${hs.sapling[1].toFixed(1)} m`);
  const gr = counts.grown;
  r.check(gr.forest[1] === 0 && gr.forest[0] > 0 && gr.outside[0] === 0 && gr.outside[1] > 0,
    `pines in forests are grown in a forest (${gr.forest[0]}), those outside, in the open (${gr.outside[1]})`);

  // height and crown by diameter: FVS Lake States, white pine (feet and inches)
  const allometry = vm.runInContext(`[10, 40, 75].map(d => [d, sim.pineHeightM(d), sim.pineCrownRadiusM(d, false), sim.pineCrownRadiusM(d, true)])`, c);
  const fvs = d => { const D = d / 2.54; return [d, (4.5 + 2108.8442 * Math.exp(-5.6595 * D ** -0.1856)) * 0.3048,
    Math.min(45, 0.3914 + 0.9923 * D + 0.1080 * 40) * 0.3048 / 2, Math.min(58, 1.62 + 3.197 * D ** 0.7981) * 0.3048 / 2]; };
  r.check(allometry.every(a => fvs(a[0]).every((v, k) => Math.abs(v - a[k]) < 1e-9)),
    `a tree's height and crown at its widest go by its diameter, as FVS's for white pine: ` +
    allometry.map(([d, h, f, o]) => `${d} cm: ${h.toFixed(1)} m tall, crown ${f.toFixed(1)} m in radius in a forest, ${o.toFixed(1)} in the open`).join("; "));
  // and the sprites are made for them
  const sheetCtx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, "images/pines.js"), "utf8"), sheetCtx);
  const layout = vm.runInContext("pineSheet", sheetCtx);
  const off = layout.trees.map(t => {
    const want = vm.runInContext(`[sim.pineHeightM(${t.dbhCm}), sim.pineCrownRadiusM(${t.dbhCm}, ${t.open}), sim.pineClasses[${t.size - 2}]]`, c);
    const px = t.crown[5] - want[0] * layout.pxPerMUp, w = t.crown[2] - 2 * want[1] * layout.pxPerMAcross;
    return Math.abs(t.heightM - want[0]) < 1e-3 && Math.abs(t.crownRadiusM - want[1]) < 1e-3 && t.dbhCm === (want[2][0] + want[2][1]) / 2
      && px >= 0 && px < 8 && w >= 0 && w < want[1] * layout.pxPerMAcross * 0.15 + 12 ? null : t;
  }).filter(Boolean);
  r.check(layout.trees.length === 7 * 2 * 2 && off.length === 0 && Math.abs(layout.pxPerMUp - 32 / Math.SQRT2 * Math.sqrt(3) / 2) < 1e-9,
    `the pine sprites are drawn in real proportion, a metre ${layout.pxPerMAcross.toFixed(1)} px across and ${layout.pxPerMUp.toFixed(1)} px up, ` +
    `each class's (forest- and open-grown) as tall and wide as its middle diameter's (${off.length ? JSON.stringify(off[0]) : "all " + layout.trees.length})`);

  // the way and sight
  const block = vm.runInContext(`(() => {
    const t = grassSpot(); if (!t) return null;
    const [i, j] = t, out = {};
    patch(i, j, 8, sim.grassMaxKg);
    const g = sim.tileCorners(i, j)[0], eye = senses.eyeLevelsBySpecies.deer;
    const walk = () => {
      put(deer, i - 2.5, j + 0.5); S.setFood(deer, 1);
      for (let n = 0; n < 3 / sim.tempo; n++) { sim.setIntent(deer, { dx: 1, dy: 0, gait: "walk" }); S.tick(); }
      sim.setIntent(deer, null);
      return +deer.gx.toFixed(2);
    };
    const sees = (dy, z, behind = 2.5) => { put(deer, i - 3.5, j + 0.5); return senses.canSeePoint(deer, i + behind, j + 0.5 + dy, g + z); };
    // a tree 30 cm across, 20 m tall
    S.setPine(i, j, 4, 0.15, 20);
    Object.assign(out, { treeObstacle: sim.obstacleAt(i, j), treeWalkedTo: walk(), treeBehind: sees(0, eye), treeBeside: sees(0.6, eye) });
    // a 3 m sapling, and a 0.8 m one (eyes and heights in levels: 0.41 m)
    S.setPine(i, j, 1, 0.6, 3);
    Object.assign(out, { saplingObstacle: sim.obstacleAt(i, j), saplingWalkedTo: walk(), tallSaplingDeer: sees(0, eye) });
    S.setPine(i, j, 1, 0.27, 0.8);
    Object.assign(out, { shortSaplingDeer: sees(0, eye, 1.5), shortSaplingLyingWolf: sees(0, 1, 1.5) });
    S.setBoulder(i, j, false);
    out.i = i;
    return out;
  })()`, c);
  r.check(block && block.treeObstacle === "pine" && block.treeWalkedTo < block.i - 0.3 && !block.treeBehind && block.treeBeside,
    `a tree's trunk blocks the way (a deer walking at it stops at ${block && (block.treeWalkedTo - block.i).toFixed(2)} tiles) and sight only as wide as it is: ` +
    `a deer's eye straight behind it is hidden, one 0.6 tiles to the side seen (${JSON.stringify(block)})`);
  r.check(block && block.saplingObstacle === null && block.saplingWalkedTo > block.i + 1 && !block.tallSaplingDeer && block.shortSaplingDeer && !block.shortSaplingLyingWolf,
    `a sapling blocks only sight, up to its height: a deer walks through one; a 3 m sapling hides a deer behind it, a 0.8 m one doesn't (a deer's eye is about 1 m up), but hides a wolf lying behind it`);

  // browsing
  const browse = vm.runInContext(`(() => {
    const t = grassSpot(); if (!t) return null;
    const [i, j] = t;
    patch(i, j, 3);
    S.setPine(i, j, 1, 0.5, 2);
    const most = sim.pineMostAt(i, j);
    put(deer, i + 0.5, j + 0.5); S.setFood(deer, 0.3);
    for (const k in deer.stomach) deer.stomach[k] = 0;
    const W0 = S.worldBiomassKg(), N0 = S.ledgerNetKg();
    let n = 0, half = null;
    for (; n < 300 / sim.tempo && sim.pineFoodAt(i, j) > 0; n++) {
      sim.setIntent(deer, { gait: "eat" }); S.tick();
      if (half === null && sim.pineFoodAt(i, j) <= most / 2) half = n + 1;
    }
    sim.setIntent(deer, null);
    const kgPerS = most / 2 / (half * sim.tempo), want = S.SPEEDS.eatKgPerS.deer * S.pineBiteShare;
    const astray = Math.abs((S.worldBiomassKg() - W0) - (S.ledgerNetKg() - N0));
    // energy a kg (fresh) a deer gets: needles against grass
    const mj = sh => sh.fatKg * 37.7 + sh.proteinKg * 16.7 + sh.carbsKg * 16.7 * S.carbsDigestedBySpecies.deer;
    const perHour = { pine: mj(S.pineShares) * want, grass: mj(S.grassShares) * S.SPEEDS.eatKgPerS.deer };
    // growing back
    deer.gx = deer.nextGX = deer.gy = deer.nextGY = -800;
    const W1 = S.worldBiomassKg(), N1 = S.ledgerNetKg();
    const rate = most * S.SPEEDS.pineRegrowShare;
    let grown = 0;
    const grow = s => { S.growUndergrowth(s); const g = S.biomassLedger.grownKg; S.growPines(); grown += S.biomassLedger.grownKg - g; };
    grow(0.5 * most / rate);
    const halfway = sim.pineFoodAt(i, j);
    grow(most / rate);
    return { most, left: sim.pineFoodAt(i, j) === most ? 0 : 1, kgPerS, want, astray, perHour, halfway, full: sim.pineFoodAt(i, j),
      grown, astray2: Math.abs((S.worldBiomassKg() - W1) - (S.ledgerNetKg() - N1)), tile: [i, j] };
  })()`, c);
  r.check(browse && Math.abs(browse.kgPerS / browse.want - 1) < 0.05 && browse.astray < 1e-6 && browse.perHour.pine < 0.7 * browse.perHour.grass,
    `a deer on a sapling browses its needles (${browse && browse.most.toFixed(2)} kg in reach) at ${browse && (browse.kgPerS * 3600).toFixed(2)} kg an hour of play, ` +
    `about half grass's fresh rate, for ${browse && Math.round(browse.perHour.pine / browse.perHour.grass * 100)}% of its energy; the ledger balances (${browse && browse.astray.toExponential(1)} kg astray)`);
  r.check(browse && Math.abs(browse.halfway - browse.most / 2) < 1e-6 && Math.abs(browse.full - browse.most) < 1e-9 && Math.abs(browse.grown - browse.most) < 1e-6 && browse.astray2 < 1e-6,
    `browsed needles grow back to their most and no further, the ledger counting what grew (${browse && browse.grown.toFixed(3)} kg)`);

  // a grazing deer: grass over needles, needles when nothing better
  const choose = vm.runInContext(`(() => {
    const t = grassSpot(); if (!t) return null;
    const [i, j] = t;
    patch(i, j, 26);
    S.setPine(i - 3, j, 1, 0.5, 2);
    S.setGrassKg((i + 4) * H + j, sim.grassMaxKg);
    const run = () => {
      put(deer, i + 0.5, j + 0.5); S.setFood(deer, 0.3);
      for (const k in deer.stomach) deer.stomach[k] = 0;
      mind.forget(deer); mind.ignore(deer, false);
      const pine0 = sim.pineFoodAt(i - 3, j), grass0 = sim.grassFoodAt(i + 4, j);
      let n = 0;
      for (; n < 30 / sim.tempo && sim.pineFoodAt(i - 3, j) > pine0 - 0.05 && sim.grassFoodAt(i + 4, j) > grass0 - 0.05; n++) S.tick();
      mind.ignore(deer);
      return { s: +(n * sim.tempo).toFixed(1), needles: sim.pineFoodAt(i - 3, j) < pine0 - 0.01, grass: sim.grassFoodAt(i + 4, j) < grass0 - 0.01 };
    };
    const withGrass = run();
    S.setGrassKg((i + 4) * H + j, 0);
    const without = run();
    return { withGrass, without };
  })()`, c);
  r.check(choose && choose.withGrass.grass && !choose.withGrass.needles && choose.without.needles,
    `a grazing deer walks past a sapling 3 tiles off to grass 4 tiles the other way; with no grass about, it browses the sapling (${JSON.stringify(choose)})`);

  // drawn
  const p = await openGame(browser, { viewport: { width: 900, height: 700 } });
  const outDir = ensureOutputDir("pines");
  const R = 24;
  const spot = await p.evaluate(R => {
    sim.pause();
    const S = sim.internals, A = sim.startArea, w = sim.pcWolf;
    sim.allCritters.forEach(c => { mind.ignore(c); if (c !== w) { c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; } });
    let t = null;
    for (let i = (A.i0 + A.i1) >> 1; i < A.i1 && !t; i++) for (let j = (A.j0 + A.j1) >> 1; j < A.j1 && !t; j++) {
      let ok = true;
      for (let di = -R; di <= R && ok; di += 2) for (let dj = -R; dj <= R && ok; dj += 2) ok = sim.getTerrainAt(i + di, j + dj) !== "water";
      if (ok) t = [i, j];
    }
    const [i, j] = t, lv = sim.tileCorners(i, j)[0];
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) { S.setTileCorners(i + di, j + dj, [lv, lv, lv, lv]); S.setBoulder(i + di, j + dj, false); }
    S.setPine(i, j, 6, 0.25, sim.pineHeightM(54.5));
    w.gx = w.nextGX = i + R - 0.5; w.gy = w.nextGY = j + R - 0.5; w.speed = 0; S.setCritterIdle(w); // (out of the way)
    animat.redrawTerrain();
    animat.setZoom(1); animat.centerCameraOn(i - 14, j - 14); animat.render(); // (panned: no sight view)
    return { i, j };
  }, R);
  await p.waitForTimeout(400);
  // (the sheets as data, so the page may read their pixels)
  const data = async k => "data:image/png;base64," + fs.readFileSync(path.join(ROOT, await p.evaluate(k => animat[k], k))).toString("base64");
  const sheets = { crowns: await data("pinesImage"), trunks: await data("pineTrunksImage") };
  // the crown's opaque pixels in its sheet, and where they are on screen
  const look = async (step = [9, 11]) => p.evaluate(async ({ i, j, sheets, step }) => {
    animat.render();
    const pine = animat.pineOf(i, j), c = pine.crown;
    const im = new Image(); im.src = sheets.crowns; await im.decode();
    const cv = document.createElement("canvas"); cv.width = c[2]; cv.height = c[3];
    const g = cv.getContext("2d"); g.drawImage(im, c[0], c[1], c[2], c[3], 0, 0, c[2], c[3]);
    const px = g.getImageData(0, 0, c[2], c[3]).data, pts = [];
    for (let y = 4; y < c[3]; y += step[1]) for (let x = 2; x < c[2]; x += step[0]) {
      const k = (y * c[2] + x) * 4;
      const w = [pine.fx - c[4] + x + 0.5, pine.fy - c[5] + y + 0.5];
      if (px[k + 3] === 255) pts.push({ want: [px[k], px[k + 1], px[k + 2]], w, s: animat.worldToScreen(...w) });
    }
    return { pine, pts };
  }, { ...spot, sheets, step });
  const shot = async (pts, name) => {
    const png = await p.screenshot({ path: path.join(outDir, name) });
    return p.evaluate(async ([png, pts]) => {
      const im = new Image(); im.src = "data:image/png;base64," + png; await im.decode();
      const cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height;
      const g = cv.getContext("2d"); g.drawImage(im, 0, 0);
      return pts.map(q => [...g.getImageData(Math.floor(q.s[0]), Math.floor(q.s[1]), 1, 1).data].slice(0, 3));
    }, [png.toString("base64"), pts]);
  };
  const same = (x, y) => x.every((v, k) => Math.abs(v - y[k]) <= 2);
  // a tree (taller than 8 m): its crown drawn see-through, always: on screen, the sheet's
  // pixels at 65% over the ground without it (as the browser blends them): its trunk is
  // not drawn under it
  const a = await look();
  const seen = await shot(a.pts, "tree.png");
  await p.evaluate(({ i, j }) => { sim.internals.setBoulder(i, j, false); animat.redrawTerrain(); animat.render(); }, spot);
  const ground = await shot(a.pts, "no-tree.png");
  const blend = (fg, bg) => fg.map((v, k) => v * 0.65 + bg[k] * 0.35);
  const near = (x, y) => x.every((v, k) => Math.abs(v - y[k]) <= 3);
  const blended = a.pts.filter((q, k) => near(seen[k], blend(q.want, ground[k]))).length;
  const opaque = a.pts.filter((q, k) => same(seen[k], q.want)).length;
  r.check(a.pts.length >= 100 && blended === a.pts.length && opaque < a.pts.length * 0.1,
    `a tree (${a.pine.tall ? "over" : "under"} 8 m) is drawn on its tile at its real size, its crown always see-through: ` +
    `${blended}/${a.pts.length} of its crown's pixels on screen are the sheet's at 65% over the ground (its crown ${a.pine.crown[2]} x ${a.pine.crown[3]} px)`);
  // a second tree behind it: where their crowns overlap, the nearer one's alone shows (no
  // more opaque than one), but for the farther one's trunk below its own crown
  const over = await p.evaluate(async ({ i, j, sheets, pts }) => {
    const S = sim.internals, h = sim.pineHeightM(54.5);
    S.setPine(i, j, 6, 0.25, h); S.setPine(i - 6, j - 6, 6, 0.25, h); animat.redrawTerrain(); animat.render();
    const far = animat.pineOf(i - 6, j - 6), c = far.crown;
    const im = new Image(); im.src = sheets.crowns; await im.decode();
    const cv = document.createElement("canvas"); cv.width = c[2]; cv.height = c[3];
    const g = cv.getContext("2d"); g.drawImage(im, c[0], c[1], c[2], c[3], 0, 0, c[2], c[3]);
    const a = g.getImageData(0, 0, c[2], c[3]).data;
    return pts.map(q => {
      const x = Math.floor(q.w[0] - (far.fx - c[4])), y = Math.floor(q.w[1] - (far.fy - c[5]));
      return x >= 0 && y >= 0 && x < c[2] && y < c[3] && a[(y * c[2] + x) * 4 + 3] === 255 && Math.abs(q.w[0] - far.fx) > 12;
    });
  }, { ...spot, sheets, pts: a.pts });
  const both = await shot(a.pts, "two-trees.png");
  const overlap = a.pts.filter((q, k) => over[k]);
  const asOne = a.pts.filter((q, k) => over[k] && near(both[k], seen[k])).length;
  r.check(overlap.length >= 30 && asOne === overlap.length,
    `where a tree's crown overlaps a farther tree's, the nearer crown alone shows, as over bare ground (${asOne}/${overlap.length} pixels): ` +
    `the see-through crowns are drawn as one layer, laid over the frame at 65%`);
  await p.evaluate(({ i, j }) => { sim.internals.setBoulder(i - 6, j - 6, false); animat.redrawTerrain(); }, spot);
  // a sapling: drawn as the sheet's, but see-through over a deer behind it
  const sap = await p.evaluate(({ i, j }) => {
    sim.internals.setPine(i, j, 1, 0.6, 3); animat.redrawTerrain();
    return animat.pineOf(i, j).tall;
  }, spot);
  const s1 = await look([2, 3]);
  const sapSeen = await shot(s1.pts, "sapling.png");
  const sapShown = s1.pts.filter((q, k) => same(sapSeen[k], q.want)).length;
  await p.evaluate(({ i, j }) => {
    const d = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    d.gx = d.nextGX = i - 0.5; d.gy = d.nextGY = j - 0.5; d.speed = 0; sim.internals.setCritterIdle(d); d.hx = 1; d.hy = 0;
    sim.internals.tick();
  }, spot);
  const s2 = await look([2, 3]);
  const sapOver = await shot(s2.pts, "sapling-over-deer.png");
  const sapChanged = s2.pts.filter((q, k) => !same(sapOver[k], q.want)).length;
  r.check(!sap && s1.pts.length >= 20 && sapShown === s1.pts.length && sapChanged > s2.pts.length * 0.8,
    `a 3 m sapling's crown is drawn as the sheet's (${sapShown}/${s1.pts.length} pixels), but see-through over a deer behind it ` +
    `(${sapChanged}/${s2.pts.length} differ from the sheet's)`);
  await p.evaluate(() => { const d = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a)); d.gx = d.nextGX = d.gy = d.nextGY = -400; sim.internals.tick(); });
  // its trunk as wide on screen as it blocks sight: a row of it below the crown shows the
  // trunk sheet's pixels; and its foot is an ellipse's front half
  const widths = [];
  for (const [halfM, name] of [[0.12, "trunk-24cm.png"], [0.25, "trunk-50cm.png"], [0.38, "trunk-76cm.png"]]) {
    const t = await p.evaluate(async ({ i, j, halfM, sheets }) => {
      sim.internals.setPine(i, j, 6, halfM, sim.pineHeightM(54.5));
      animat.redrawTerrain();
      const pine = animat.pineOf(i, j), tr = pineSheet.trunks;
      const im = new Image(); im.src = sheets.trunks; await im.decode();
      const cv = document.createElement("canvas"); cv.width = tr.cellW; cv.height = tr.cellH;
      const g = cv.getContext("2d"); g.drawImage(im, pine.trunk.col * tr.cellW, 0, tr.cellW, tr.cellH, 0, 0, tr.cellW, tr.cellH);
      const y = tr.footY - 20, row = g.getImageData(0, y, tr.cellW, 1).data, pts = [];
      for (let x = 0; x < tr.cellW; x++) pts.push({ opaque: row[x * 4 + 3] === 255, want: [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]],
        s: animat.worldToScreen(pine.fx - tr.footX + x + 0.5, pine.fy - 20 + 0.5) });
      // how far below the foot each column of it reaches
      const all = g.getImageData(0, 0, tr.cellW, tr.cellH).data, reach = [];
      for (let x = 0; x < tr.cellW; x++) {
        let low = -1;
        for (let yy = 0; yy < tr.cellH; yy++) if (all[(yy * tr.cellW + x) * 4 + 3] === 255) low = yy;
        if (low >= 0) reach.push(low - tr.footY);
      }
      return { want: 2 * halfM * pineSheet.pxPerMAcross, pts, reach };
    }, { ...spot, halfM, sheets });
    const px = await shot(t.pts, name);
    const opaque = t.pts.filter(q => q.opaque).length;
    const asSheet = t.pts.filter((q, k) => q.opaque && same(px[k], q.want)).length;
    const mid = t.reach[t.reach.length >> 1], ends = Math.max(t.reach[0], t.reach[t.reach.length - 1]);
    widths.push({ wantPx: +t.want.toFixed(1), drawnPx: opaque, onScreen: asSheet, footDepthPx: [ends, mid] });
  }
  r.check(widths.every(w => Math.abs(w.drawnPx - w.wantPx) <= 1 && w.onScreen === w.drawnPx && w.footDepthPx[1] >= w.footDepthPx[0] + Math.floor(w.drawnPx / 4) - 1),
    `a tree's trunk is drawn as wide as it blocks sight (a metre across a tile's diagonal, ${(32 / Math.SQRT2).toFixed(1)} px), ` +
    `its foot the front half of an ellipse (its middle reaching lower than its sides): ${JSON.stringify(widths)}`);
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "pines", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
