// Ground cover by region (see GROUND COVER and UNDERGROWTH in sim.js):
//  - any cover borders any other: stone meets grass about as readily as dirt (no order of
//    grass, dirt, stone)
//  - places far apart differ: in windows spread over the map, each cover's share and the
//    size of the patches vary widely
//  - regions meet abruptly or blending (their patches interfingering over a band): along
//    a line across a blending border the region changes back and forth many times, across
//    an abrupt one about once
//  - a pure function of the tile
//  - undergrowth: low bushes and flowers on some land, more in some places than others;
//    never on water or under a boulder, no flowers on stone
// Runs hydrology.js and sim.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  return context;
}

async function main(browser, r) {
  const c = load();
  // 48 windows of 64 x 64 tiles, about 6000 tiles apart (the cover alone: water aside)
  const windows = vm.runInContext(`(() => {
    const S = sim.internals, out = [], n = 64, kinds = ["grass", "dirt", "stone"];
    for (let a = 0; a < 8; a++) for (let b = 0; b < 6; b++) {
      const x0 = 2000 + a * 6000 + (b * 1237) % 900, y0 = 2000 + b * 8000 + (a * 911) % 900;
      const near = S.regionsNear(x0, y0, n), cover = [], counts = { grass: 0, dirt: 0, stone: 0 };
      const borders = {}, plants = { bush: 0, flowers: 0, flowersOnStone: 0 };
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const st = S.regionAt(x0 + i, y0 + j, near), cv = S.coverIn(st, x0 + i, y0 + j);
        cover.push(cv); counts[cv]++;
        const u = S.undergrowthIn(st, x0 + i, y0 + j, cv);
        if (u === 1) plants.bush++;
        if (u === 2) { plants.flowers++; if (cv === "stone") plants.flowersOnStone++; }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= n || j + dj >= n) continue;
        const p = cover[i * n + j], q = cover[(i + di) * n + j + dj];
        if (p !== q) { const k = [p, q].sort().join("|"); borders[k] = (borders[k] || 0) + 1; }
      }
      out.push({ x0, y0, shares: kinds.map(k => counts[k] / (n * n)), borders,
        density: Object.values(borders).reduce((s, v) => s + v, 0) / (n * n),
        bush: plants.bush / (n * n), flowers: plants.flowers / (n * n), flowersOnStone: plants.flowersOnStone });
    }
    return out;
  })()`, c);

  // any cover borders any other
  const all = {};
  for (const w of windows) for (const [k, v] of Object.entries(w.borders)) all[k] = (all[k] || 0) + v;
  const gs = all["grass|stone"] || 0, ds = all["dirt|stone"] || 0, gd = all["dirt|grass"] || 0;
  r.check(gs > 0.4 * ds && ds > 0.2 * gs && gd > 0,
    `any cover borders any other: stone meets grass about as readily as dirt (tile edges: grass-stone ${gs}, dirt-stone ${ds}, grass-dirt ${gd})`);

  // far apart, different
  const grassShares = windows.map(w => w.shares[0]), stoneShares = windows.map(w => w.shares[2]);
  const dens = windows.filter(w => w.density > 0).map(w => w.density);
  const span = xs => Math.max(...xs) - Math.min(...xs);
  r.check(span(grassShares) > 0.5 && span(stoneShares) > 0.3 && Math.max(...dens) > 4 * Math.min(...dens),
    `places far apart differ: grass covers ${(Math.min(...grassShares) * 100).toFixed(0)}-${(Math.max(...grassShares) * 100).toFixed(0)}% of a window, ` +
    `stone ${(Math.min(...stoneShares) * 100).toFixed(0)}-${(Math.max(...stoneShares) * 100).toFixed(0)}%; patch edges per tile ${Math.min(...dens).toFixed(3)}-${Math.max(...dens).toFixed(3)}`);

  // borders: abrupt or blending
  const borders = vm.runInContext(`(() => {
    const S = sim.internals, near = S.regionsNear(20000, 20000, 6000);
    const out = { abrupt: [], blending: [] };
    for (const p of near) for (const q of near) {
      if (p === q || p.style.cx > q.style.cx || (p.style.cx === q.style.cx && p.style.cy >= q.style.cy)) continue;
      const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d2 > (1.2 * S.regionTiles) ** 2) continue;
      // along the line between them, 200 tiles each side of the middle, a tile at a time
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, l = Math.sqrt(d2), ux = (q.x - p.x) / l, uy = (q.y - p.y) / l;
      let last = null, switches = 0, both = 0;
      for (let t = -200; t <= 200; t++) {
        const s = S.regionAt(Math.floor(mx + ux * t), Math.floor(my + uy * t), near);
        if (s !== p.style && s !== q.style) continue;
        both++;
        if (last && s !== last) switches++;
        last = s;
      }
      if (both < 300) continue; // (the line crosses other regions)
      (Math.min(p.style.soft, q.style.soft) > 0 ? out.blending : out.abrupt).push(switches);
    }
    return out;
  })()`, c);
  const mean = xs => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  r.check(borders.abrupt.length >= 3 && borders.blending.length >= 3 && mean(borders.blending) > 3 * mean(borders.abrupt),
    `regions meet abruptly or blending: across ${borders.abrupt.length} abrupt borders the region changes ${mean(borders.abrupt).toFixed(1)} times on average, ` +
    `across ${borders.blending.length} blending ones ${mean(borders.blending).toFixed(1)} (interfingering)`);

  // a pure function of the tile
  const pure = vm.runInContext(`(() => {
    const S = sim.internals, pts = [];
    for (let k = 0; k < 400; k++) pts.push([(k * 7919) % 50000, (k * 104729) % 50000]);
    const a = pts.map(([x, y]) => S.groundCoverAt(x, y));
    const b = pts.reverse().map(([x, y]) => S.groundCoverAt(x, y)).reverse();
    return a.every((v, k) => v === b[k]);
  })()`, c);
  r.check(pure, "the cover is a pure function of the tile (the same, asked in any order)");

  // undergrowth
  const bush = windows.map(w => w.bush), flowers = windows.map(w => w.flowers);
  r.check(mean(bush) > 0.005 && mean(bush) < 0.1 && mean(flowers) > 0.005 && mean(flowers) < 0.15 &&
    Math.max(...bush) > 4 * Math.max(0.002, Math.min(...bush)) && Math.max(...flowers) > 4 * Math.max(0.002, Math.min(...flowers)),
    `undergrowth on some land: bushes on ${(mean(bush) * 100).toFixed(1)}% of tiles (${(Math.min(...bush) * 100).toFixed(1)}-${(Math.max(...bush) * 100).toFixed(1)}% by window), ` +
    `flowers ${(mean(flowers) * 100).toFixed(1)}% (${(Math.min(...flowers) * 100).toFixed(1)}-${(Math.max(...flowers) * 100).toFixed(1)}%)`);
  const placed = vm.runInContext(`(() => {
    sim.init();
    const A = sim.startArea, out = { wet: 0, rock: 0, stoneFlowers: 0, n: 0 };
    for (let i = A.i0; i < A.i1; i++) for (let j = A.j0; j < A.j1; j++) {
      const u = sim.undergrowthAt(i, j);
      if (!u) continue;
      out.n++;
      if (sim.getTerrainAt(i, j) === "water") out.wet++;
      if (sim.isBlockedTile(i, j)) out.rock++;
      if (u === "flowers" && sim.getTerrainAt(i, j) === "stone") out.stoneFlowers++;
    }
    return out;
  })()`, c);
  r.check(placed.n > 100 && placed.wet === 0 && placed.rock === 0 && placed.stoneFlowers === 0 && windows.every(w => w.flowersOnStone === 0),
    `undergrowth (${placed.n} tiles in the start area) is never on water (${placed.wet}), under a boulder (${placed.rock}), nor flowers on stone (${placed.stoneFlowers})`);
}

module.exports = { name: "ground cover regions", main };
if (require.main === module) runStandalone(module.exports.name, main);
