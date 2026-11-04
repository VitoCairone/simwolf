// Undergrowth: low bushes and flowers (see UNDERGROWTH and UNDERGROWTH FOOD in sim.js,
// UNDERGROWTH in animat.js):
//  - no obstacle: a critter walks straight through, and it hides nothing (lines of sight
//    pass over it)
//  - each holds plant mass of its own (fresh kg): a deer standing on it eats it before the
//    tile's grass, its make-up its own (a bush's leaves richer in protein than grass);
//    it grows back to its most and no further, and the ledger counts what grows
//  - flowers eaten nearly bare aren't drawn; a bush always is
//  - a grazing deer with no grass about walks to undergrowth it sees and eats it
//  - drawn: a critter standing on its tile is drawn over the whole plant, and the plant's
//    foreground half is drawn again over the critter
// Runs sim.js, senses.js and mind.js in Node; then the game in the browser. Saves a
// screenshot to tests/output/undergrowth/.

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, openGame, runStandalone, ensureOutputDir } = require("./helpers");

function load() {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

// The screen's colour at each point [x, y] (page pixels).
async function pixels(page, pts) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async ([png, pts]) => {
    const im = new Image();
    im.src = "data:image/png;base64," + png;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
  }, [png, pts]);
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
    // a tile with undergrowth of this kind on grass, open land about it R tiles each way:
    // level (unless not asked), and bare of other undergrowth (if asked)
    var plantAt = (kind, R, bareAbout = false, level = true) => {
      const A = sim.startArea, m = 64; // (about the start: its terrain is worked out already)
      for (let i = A.i0 - m; i < A.i1 + m; i++) for (let j = A.j0 - m; j < A.j1 + m; j++) {
        if (sim.undergrowthAt(i, j) !== kind || sim.getTerrainAt(i, j) !== "grass") continue;
        let ok = true;
        const lv = sim.tileCorners(i, j)[0];
        for (let di = -R; di <= R && ok; di++) for (let dj = -R; dj <= R && ok; dj++) {
          const t = sim.getTerrainAt(i + di, j + dj);
          ok = t !== "water" && !sim.isBlockedTile(i + di, j + dj) && (!level || sim.tileCorners(i + di, j + dj).every(l => l === lv))
            && (!bareAbout || (di === 0 && dj === 0) || !sim.undergrowthAt(i + di, j + dj));
        }
        if (ok) return [i, j];
      }
      return null;
    };
  `, c);

  // no obstacle
  const through = vm.runInContext(`(() => {
    const t = plantAt("bush", 4); if (!t) return null;
    const [i, j] = t, cs = sim.tileCorners(i, j);
    const out = { blocked: sim.isBlockedTile(i, j), obstacle: sim.obstacleAt(i, j),
      sight: sim.sightHeightAt(i, j) === (cs[0] + cs[1] + cs[2] + cs[3]) / 4 };
    put(deer, i - 2.5, j + 0.5); S.setFood(deer, 1);
    const tiles = new Set();
    for (let n = 0; n < 3 / sim.tempo; n++) { sim.setIntent(deer, { dx: 1, dy: 0, gait: "walk" }); S.tick(); tiles.add(Math.floor(deer.gx) + "," + Math.floor(deer.gy)); }
    out.crossed = tiles.has(i + "," + j) && deer.gx > i + 1.5;
    out.stunned = deer.stunnedUntil > 0;
    sim.setIntent(deer, null);
    return out;
  })()`, c);
  r.check(through && !through.blocked && !through.obstacle && through.sight && through.crossed && !through.stunned,
    `undergrowth is no obstacle: a deer walks straight through a bush, and lines of sight pass over it (${JSON.stringify(through)})`);

  // eating: the bush, then the grass
  const eaten = vm.runInContext(`(() => {
    const t = plantAt("bush", 2); if (!t) return null;
    const [i, j] = t, most = S.undergrowthMostKg.bush;
    put(deer, i + 0.5, j + 0.5); S.setFood(deer, 0.3);
    for (const k in deer.stomach) deer.stomach[k] = 0;
    const W0 = S.worldBiomassKg(), N0 = S.ledgerNetKg();
    const grass0 = sim.grassFoodAt(i, j);
    const trace = [];
    let n = 0;
    for (; n < 120 / sim.tempo && sim.grassFoodAt(i, j) > grass0 - 0.01; n++) {
      sim.setIntent(deer, { gait: "eat" }); S.tick();
      if (n % 30 === 0) trace.push([+sim.undergrowthFoodAt(i, j).toFixed(3), +sim.grassFoodAt(i, j).toFixed(3)]);
    }
    sim.setIntent(deer, null);
    const out = { most, bushLeft: sim.undergrowthFoodAt(i, j), grass0, grassLeft: sim.grassFoodAt(i, j), s: n * sim.tempo,
      grassUntouchedWhileBush: trace.filter(([u]) => u > 0).every(([, g]) => g >= grass0 - 1e-6) };
    // (the stomach passes some on meanwhile: what it took in, by its make-up, before then)
    out.astray = Math.abs((S.worldBiomassKg() - W0) - (S.ledgerNetKg() - N0));
    out.tile = [i, j];
    return out;
  })()`, c);
  r.check(eaten && eaten.bushLeft < 1e-6 && eaten.grassUntouchedWhileBush && eaten.grassLeft < eaten.grass0 && eaten.astray < 1e-6,
    `a deer standing on a bush eats it (${eaten && eaten.most.toFixed(2)} kg) before the tile's grass (${eaten && eaten.grass0.toFixed(2)} kg), ` +
    `starting on the grass after ${eaten && eaten.s.toFixed(1)} s; the ledger balances (${eaten && eaten.astray.toExponential(1)} kg astray)`);

  // its own make-up
  const makeUp = vm.runInContext(`(() => {
    const sh = S.undergrowthShares, g = S.grassShares;
    return { bushProtein: sh.bush.proteinKg / (1 - sh.bush.waterKg), grassProtein: g.proteinKg / (1 - g.waterKg),
      flowersWater: sh.flowers.waterKg, grassWater: g.waterKg };
  })()`, c);
  r.check(makeUp.bushProtein > makeUp.grassProtein && makeUp.flowersWater > makeUp.grassWater,
    `undergrowth has its own make-up: a bush's leaves richer in protein than grass (${(makeUp.bushProtein * 100).toFixed(0)}% of dry weight against ${(makeUp.grassProtein * 100).toFixed(0)}%), flowers wetter (${(makeUp.flowersWater * 100).toFixed(0)}% water against ${(makeUp.grassWater * 100).toFixed(0)}%)`);

  // growing back
  const grows = vm.runInContext(`(() => {
    const [i, j] = ${JSON.stringify(eaten && eaten.tile)};
    deer.gx = deer.nextGX = deer.gy = deer.nextGY = -800;
    const most = S.undergrowthMostKg.bush, rate = S.SPEEDS.undergrowthRegrowKgPerS.bush;
    const W0 = S.worldBiomassKg(), N0 = S.ledgerNetKg(), G0 = S.biomassLedger.grownKg;
    S.growUndergrowth(60);
    const after60 = sim.undergrowthFoodAt(i, j);
    S.growUndergrowth(2 * most / rate);
    return { after60, perMinute: rate * 60, full: sim.undergrowthFoodAt(i, j), most,
      grown: S.biomassLedger.grownKg - G0, astray: Math.abs((S.worldBiomassKg() - W0) - (S.ledgerNetKg() - N0)) };
  })()`, c);
  r.check(Math.abs(grows.after60 - grows.perMinute) < 1e-9 && Math.abs(grows.full - grows.most) < 1e-9 && Math.abs(grows.grown - grows.most) < 1e-6 && grows.astray < 1e-6,
    `a bush grows back (${(grows.after60 * 1000).toFixed(2)} g in a minute's growing) to its most and no further (${grows.full.toFixed(3)} kg); ` +
    `the ledger counts what grew (${grows.grown.toFixed(3)} kg)`);

  // flowers eaten nearly bare aren't drawn
  const shown = vm.runInContext(`(() => {
    const t = plantAt("flowers", 1), b = plantAt("bush", 1); if (!t || !b) return null;
    const most = S.undergrowthMostKg.flowers, out = [sim.undergrowthShownAt(...t)];
    S.setUndergrowthKg(t[0], t[1], most * (S.flowersShownFrom + 0.01)); out.push(sim.undergrowthShownAt(...t));
    S.setUndergrowthKg(t[0], t[1], most * (S.flowersShownFrom - 0.01)); out.push(sim.undergrowthShownAt(...t));
    S.setUndergrowthKg(b[0], b[1], 0); out.push(sim.undergrowthShownAt(...b));
    return out;
  })()`, c);
  r.check(shown && shown.join() === "true,true,false,true",
    `flowers eaten below a quarter of their most aren't drawn; a bush eaten bare still is (${shown})`);

  // a grazing deer with no grass about finds undergrowth
  const browse = vm.runInContext(`(() => {
    const t = plantAt("bush", 6, true, false); if (!t) return null;
    const [i, j] = t;
    for (let di = -24; di <= 24; di++) for (let dj = -24; dj <= 24; dj++)
      if (sim.getTerrainAt(i + di, j + dj) === "grass") S.setGrassKg((i + di) * H + j + dj, 0);
    put(deer, i - 4.5, j + 0.5); S.setFood(deer, 0.3);
    for (const k in deer.stomach) deer.stomach[k] = 0;
    mind.forget(deer); mind.ignore(deer, false);
    const before = sim.undergrowthFoodAt(i, j);
    let n = 0;
    for (; n < 30 / sim.tempo && sim.undergrowthFoodAt(i, j) > before - 0.2; n++) S.tick();
    mind.ignore(deer);
    return { s: n * sim.tempo, before, after: sim.undergrowthFoodAt(i, j), on: Math.floor(deer.gx) === i && Math.floor(deer.gy) === j };
  })()`, c);
  r.check(browse && browse.after <= browse.before - 0.2 && browse.on,
    `a grazing deer, no grass about, walks to a bush 4 tiles off and eats it (${browse && browse.s.toFixed(1)} s; ${browse && browse.before.toFixed(2)} -> ${browse && browse.after.toFixed(2)} kg)`);

  // drawn: the critter over the plant, the foreground half over the critter
  const p = await openGame(browser, { viewport: { width: 900, height: 650 } });
  const outDir = ensureOutputDir("undergrowth");
  const spot = await p.evaluate(() => {
    sim.pause();
    const S = sim.internals, A = sim.startArea, w = sim.pcWolf;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c));
    sim.allCritters.forEach(c => { mind.ignore(c); if (c !== d && c !== w) { c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; } });
    let t = null;
    for (let i = A.i0 + 4; i < A.i1 - 4 && !t; i++) for (let j = A.j0 + 4; j < A.j1 - 4 && !t; j++)
      if (sim.undergrowthAt(i, j) === "bush" && sim.getTerrainAt(i - 3, j + 3) !== "water") t = [i, j];
    const [i, j] = t;
    const put = (a, x, y) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; S.setCritterIdle(a); a.hx = 1; a.hy = 0; };
    put(d, i + 0.5, j + 0.5); put(w, i - 2.5, j + 3.5);
    animat.setZoom(4); animat.centerCameraOn(i + 0.5, j + 0.5); animat.render(); // (panned: no sight view)
    return { i, j, uid: d.uid };
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => animat.render());
  await p.screenshot({ path: path.join(outDir, "deer-in-bush.png") });
  // world pixels where the deer's sprite and the plant's are both opaque: in the plant's
  // foreground half, and in its back half only
  // (the sheets as data, so the page may read their pixels)
  const sheets = await p.evaluate(uid => [animat.spriteOf(sim.allCritters.find(c => c.uid === uid)).image, animat.undergrowthImage], spot.uid);
  const data = sheets.map(f => "data:image/png;base64," + fs.readFileSync(path.join(ROOT, f)).toString("base64"));
  const where = await p.evaluate(async ({ i, j, uid, data }) => {
    const d = sim.allCritters.find(c => c.uid === uid), rec = animat.spriteOf(d), u = animat.undergrowthOf(i, j);
    const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const pixelsOf = (im, sx, sy, w, h, mirror) => {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d");
      if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
      g.drawImage(im, sx, sy, w, h, 0, 0, w, h);
      return g.getImageData(0, 0, w, h).data;
    };
    const sheet = await load(data[0]), plants = await load(data[1]);
    const dp = pixelsOf(sheet, rec.col * rec.w, rec.row * rec.h, rec.w, rec.h, rec.mirror);
    const whole = pixelsOf(plants, u.col * 32, 0, 32, 32), front = pixelsOf(plants, u.col * 32, 32, 32, 32);
    const at = (data, w, x, y) => { const k = (y * w + x) * 4; return [data[k], data[k + 1], data[k + 2], data[k + 3]]; };
    const pick = { front: [], back: [] };
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const wx = u.left + x, wy = u.top + y, dx = Math.round(wx - rec.left), dy = Math.round(wy - rec.top);
      if (dx < 0 || dy < 0 || dx >= rec.w || dy >= rec.h || at(dp, rec.w, dx, dy)[3] < 255 || at(whole, 32, x, y)[3] < 255) continue;
      const f = at(front, 32, x, y);
      const s = animat.worldToScreen(wx + 0.5, wy + 0.5);
      if (f[3] === 255) pick.front.push({ s, want: f.slice(0, 3) });
      else pick.back.push({ s, want: at(dp, rec.w, dx, dy).slice(0, 3) });
    }
    return pick;
  }, { ...spot, data });
  let frontOk = 0, backOk = 0;
  const sampleFront = where.front.slice(0, 40), sampleBack = where.back.slice(0, 40);
  const fr = await pixels(p, sampleFront.map(q => q.s)), bk = await pixels(p, sampleBack.map(q => q.s));
  const same = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 2);
  sampleFront.forEach((q, k) => { if (same(fr[k], q.want)) frontOk++; });
  sampleBack.forEach((q, k) => { if (same(bk[k], q.want)) backOk++; });
  r.check(sampleFront.length >= 5 && sampleBack.length >= 5 && frontOk === sampleFront.length && backOk === sampleBack.length,
    `a deer standing in a bush is drawn over the whole bush (${backOk}/${sampleBack.length} of its pixels over the bush's back half show the deer), ` +
    `and the bush's foreground half again over the deer (${frontOk}/${sampleFront.length} show the bush)`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "undergrowth", main };
if (require.main === module) runStandalone(module.exports.name, main);
