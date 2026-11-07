// No critter stuck in place (see WAYFINDING, KEEPING DRY, TIRED SWIMMERS and CALM in mind.js):
//  - over 20 minutes of play, from two starts, no critter stays within a tile and a half for
//    a minute while not eating, mating, nursing, resting, waiting ashore for swimming prey,
//    brooding, keeping to its den or staying with its young (all by choice) for most of it;
//    none stands (out of its swimming pose) on a water tile for long
//  - a deer too tired to swim, standing in the shallows with land beside it, walks out
//  - a wolf penned in by boulders, its mate outside, doesn't stand waiting: it wanders
//  - BROODING: a mother with a newborn litter (too young to walk) stays by it, and the
//    pups crawl to her: every one suckles, at the same time
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

function load(seed) {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {}, error() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  if (seed !== undefined) // (a start that can be told again)
    vm.runInContext(`Math.random = (() => { let s = ${seed}; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();`, context);
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  for (const seed of [777, 4242]) {
    const c = load(seed);
    const res = vm.runInContext(`(() => {
      const S = sim.internals, per = Math.round(1 / sim.tempo), W = 60, hist = new Map(), cases = [];
      let wetStand = 0, wetStandLong = 0;
      const wetSince = new Map();
      for (let n = 0; n < 20 * 60 / sim.tempo; n++) {
        S.tick();
        if (n % per) continue;
        for (const a of sim.allCritters) {
          if (!sim.isLiveCritter(a)) continue;
          const wet = sim.getTerrainAt(Math.floor(a.gx), Math.floor(a.gy)) === "water" && a.pose !== "swim";
          if (wet) { wetStand++; wetSince.set(a, (wetSince.get(a) || 0) + 1); if (wetSince.get(a) === 20) wetStandLong++; }
          else wetSince.delete(a);
          let h = hist.get(a);
          if (!h) hist.set(a, h = []);
          h.push([a.gx, a.gy, a.eating || !!a.matingWith || a.nursingOn !== null || ["rest", "wait", "brood", "den", "guard"].includes(mind.stateOf(a)?.mode)]);
          if (h.length > W) h.shift();
          if (h.length < W) continue;
          const xs = h.map(q => q[0]), ys = h.map(q => q[1]), busy = h.filter(q => q[2]).length;
          if (Math.max(...xs) - Math.min(...xs) <= 1.5 && Math.max(...ys) - Math.min(...ys) <= 1.5 && busy < W / 2) {
            cases.push({ uid: a.uid, species: a.species, min: +(n * sim.tempo / 60).toFixed(1), mode: mind.stateOf(a)?.mode });
            h.length = 0;
          }
        }
      }
      return { cases, wetStand, wetStandLong };
    })()`, c);
    r.check(res.cases.length === 0 && res.wetStandLong === 0,
      `start ${seed}: over 20 minutes no critter is stuck within a tile and a half for a minute (${JSON.stringify(res.cases.slice(0, 4))}); ` +
      `none stands on a water tile 20 s or more (${res.wetStandLong} times; ${res.wetStand} critter-seconds standing on water in all)`);
  }

  const c = load();
  const res = vm.runInContext(`(() => {
    const S = sim.internals, out = {};
    S.holdWater(true);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    const put = (a, x, y) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; a.stunnedUntil = 0; a.climbingUntil = -1; S.setCritterIdle(a); };
    // the shallows: a water tile at the level of the land beside it to its east, land all
    // about that, and water to the west
    const t = S.allLandTiles.find(([i, j]) => {
      if (sim.getTerrainAt(i - 1, j) !== "water" || sim.getTerrainAt(i - 2, j) !== "water") return false;
      for (let di = 0; di <= 4; di++) for (let dj = -3; dj <= 3; dj++)
        if (sim.getTerrainAt(i + di, j + dj) === "water" || sim.isBlockedTile(i + di, j + dj)) return false;
      return Math.abs(sim.heightAt(i - 0.5, j + 0.5) - sim.heightAt(i + 0.5, j + 0.5)) < 1;
    });
    if (t) {
      const [i, j] = t, d = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
      put(d, i - 1 + 0.75, j + 0.5); // on the water tile, its box over the land beside it
      d.stamina = 0.15; S.setFood(d, 1); mind.forget(d); mind.ignore(d, false);
      const pose0 = d.pose;
      let wetS = 0;
      for (let n = 0; n < 10 / sim.tempo; n++) { S.tick(); if (sim.getTerrainAt(Math.floor(d.gx), Math.floor(d.gy)) === "water") wetS += sim.tempo; }
      out.shallows = { pose0, wetS: +wetS.toFixed(1), out: sim.getTerrainAt(Math.floor(d.gx), Math.floor(d.gy)) !== "water", stamina: +d.stamina.toFixed(2) };
      mind.ignore(d); put(d, -800, -800);
    }
    // a pen of boulders 5 tiles square inside, on open level land; the wolf's mate 15 tiles off
    const [i0, j0] = S.allLandTiles.find(([i, j]) => {
      const lv = sim.tileCorners(i, j)[0];
      for (let di = -18; di <= 18; di++) for (let dj = -4; dj <= 4; dj++)
        if (sim.getTerrainAt(i + di, j + dj) === "water" || sim.isBlockedTile(i + di, j + dj) || sim.tileCorners(i + di, j + dj).some(h => h !== lv)) return false;
      return true;
    });
    const rocks = [];
    for (let k = -3; k <= 3; k++) rocks.push([i0 + k, j0 - 3], [i0 + k, j0 + 3], [i0 - 3, j0 + k], [i0 + 3, j0 + k]);
    for (const [i, j] of rocks) S.setBoulder(i, j);
    const he = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a.isMale && a !== sim.pcWolf);
    const she = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && !a.isMale && a !== sim.pcWolf);
    S.pair(he, she);
    put(he, i0 + 0.5, j0 + 0.5); put(she, i0 + 15.5, j0 + 0.5);
    S.setFood(he, 1); S.setFood(she, 1); mind.forget(he); mind.ignore(he, false);
    he.hx = 1; he.hy = 0;
    let idle = 0, longest = 0, run = 0;
    const modes = new Set();
    for (let n = 0; n < 60 / sim.tempo; n++) {
      S.tick(); modes.add(mind.stateOf(he)?.mode);
      if (he.speed === 0) { run++; idle++; longest = Math.max(longest, run); } else run = 0;
    }
    out.pen = { idleS: +(idle * sim.tempo).toFixed(1), longestS: +(longest * sim.tempo).toFixed(1), modes: [...modes] };
    for (const [i, j] of rocks) S.setBoulder(i, j, false);
    // BROODING: a litter born beside its mother, too young to walk: they crawl to her
    put(he, i0 + 3.5, j0 + 0.5); S.setFood(he, 1); S.setFood(she, 1);
    put(she, i0 + 0.5, j0 + 0.5); she.lastBredAt = -Infinity; S.conceive(she, he); she.pregnancy.dueAt = sim.now + 1;
    for (const a of [he, she]) { mind.forget(a); mind.ignore(a, false); }
    for (let n = 0; n < 2 / sim.tempo; n++) S.tick();
    she.lastBredAt = sim.now; // (not in heat again)
    const pups = sim.allCritters.filter(a => a.parentUids[0] === she.uid);
    pups.forEach(a => { mind.forget(a); mind.ignore(a, false); a.lifespanS = 1e12; });
    pups.forEach(p => S.setFood(p, 0.5)); // (hungry)
    const fed = new Set(), still = pups.map(p => [p.gx, p.gy]), her = [she.gx, she.gy], poses = new Set();
    let together = 0, herMoved = 0;
    for (let n = 0; n < 60 / sim.tempo; n++) {
      S.tick();
      const now = pups.filter(p => p.nursingOn !== null);
      now.forEach(p => fed.add(p.uid)); together = Math.max(together, now.length);
      pups.forEach(p => poses.add(p.pose));
      herMoved = Math.max(herMoved, Math.hypot(she.gx - her[0], she.gy - her[1]));
    }
    out.litter = { n: pups.length, fed: fed.size, together, crawled: pups.filter((p, k) => p.gx !== still[k][0] || p.gy !== still[k][1]).length,
      poses: [...poses], herMoved: +herMoved.toFixed(1), mode: mind.stateOf(she).mode, foods: pups.map(p => +p.food.toFixed(2)) };
    return out;
  })()`, c);
  const { shallows, pen, litter } = res;
  r.check(shallows && shallows.out && shallows.wetS < 5,
    `a deer too tired to swim (stamina ${shallows && shallows.stamina}), standing in the shallows with land beside it, walks out (after ${shallows && shallows.wetS} s; ${JSON.stringify(shallows)})`);
  r.check(pen.longestS < 30,
    `a wolf penned in by boulders, its mate outside, doesn't stand waiting: it wanders the pen (still ${pen.idleS} s of 60, ${pen.longestS} s at most at a time; ${pen.modes})`);
  r.check(litter.n >= 2 && litter.fed === litter.n && litter.together >= Math.min(litter.n, 3) && litter.poses.includes("crawl")
    && !litter.poses.includes("walk") && litter.herMoved <= 3,
    `a mother stays by her newborn litter, too young to walk (she went ${litter.herMoved} tiles at most; ${litter.mode}), and the pups crawl to her ` +
    `(${litter.crawled} of ${litter.n}; ${litter.poses}): every one suckles in a minute, ${litter.together} at once (their meters ${litter.foods.join(", ")})`);
}

module.exports = { name: "no critter stuck", main, slow: true };
if (require.main === module) runStandalone(module.exports.name, main);
