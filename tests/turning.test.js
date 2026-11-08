// Turning (see TURNING in sim.js), on open level land:
//  - turning right round takes about 0.75 s standing or walking, about 1 s trotting, about
//    2 s galloping (a wolf and a deer alike, near enough)
//  - turning right round at speed, it slows (to a stop, or near) and speeds up again; a
//    small change of heading at speed costs no slowing, and is quicker
//  - turning right round in 45-degree steps asked one after another is no quicker
//  - it turns by its speed, not its gait: just into a gallop, still slow, it turns quicker
//    than at full gallop
// Runs sim.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, testStart, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({ simStart: testStart,
    console: { log() {}, info() {}, warn() {}, error() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init();", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  const res = vm.runInContext(`(() => {
    const S = sim.internals;
    S.holdWater(true);
    sim.allCritters.forEach(a => { a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry land, 60 tiles each way along i and 32 across (levelled, its boulders taken away)
    const [i0, j0] = S.allLandTiles.find(([i, j]) => {
      if (i % 3 || j % 3) return false;
      const lv = sim.tileCorners(i, j)[0];
      for (let di = -60; di <= 60; di += 2) for (let dj = -32; dj <= 32; dj += 4)
        if (sim.getTerrainAt(i + di, j + dj) === "water") return false;
      return true;
    });
    for (let di = -62; di <= 62; di++) for (let dj = -34; dj <= 34; dj++) {
      const lv = sim.tileCorners(i0, j0)[0];
      S.setTileCorners(i0 + di, j0 + dj, [lv, lv, lv, lv]); S.setBoulder(i0 + di, j0 + dj, false);
    }
    const wolf = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a !== sim.pcWolf);
    const deer = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    // at full speed in a gait going +i (from -i, or -i for a gallop: room to run), then
    // asked the other way (in one, or in steps of 45 degrees each asked once the last is
    // done): seconds until it heads the other way, its least speed meanwhile (share of the
    // gait's), and whether it faces that way at the end
    const turn = (a, gait, steps = false) => {
      const x0 = gait === "gallop" ? i0 - 58 : i0 - 20;
      a.gx = a.nextGX = x0 + 0.5; a.gy = a.nextGY = j0 + 0.5; a.speed = 0; a.stunnedUntil = 0;
      S.setCritterIdle(a); a.hx = 1; a.hy = 0; a.wind = a.stamina = 1;
      if (gait !== "idle") {
        sim.setIntent(a, { dx: 1, dy: 0, gait });
        for (let n = 0; n < (gait === "gallop" ? 2.6 : 2) / sim.tempo; n++) { S.tick(); a.wind = a.stamina = 1; }
      }
      const v0 = a.speed;
      let n = 0, least = v0, k = 1;
      const ask = k => sim.setIntent(a, { dx: Math.cos(k * Math.PI / 4), dy: Math.sin(k * Math.PI / 4), gait: gait === "idle" ? "walk" : gait });
      if (steps) ask(1); else sim.setIntent(a, { dx: -1, dy: 0, gait: gait === "idle" ? "walk" : gait });
      for (; n < 6 / sim.tempo; n++) {
        S.tick(); a.wind = a.stamina = 1;
        if (n > 0 && a.speed < least) least = a.speed;
        if (steps && k < 4 && a.hx === a.wantHx && a.hy === a.wantHy) ask(++k);
        if (a.hx < -0.999) break;
      }
      const out = { s: +((n + 1) * sim.tempo).toFixed(2), least: v0 ? +(least / v0).toFixed(2) : 0, faces: a.currentDirection === sim.DIR_W };
      sim.setIntent(a, null); S.setCritterIdle(a);
      return out;
    };
    const out = {};
    for (const a of [wolf, deer]) {
      const o = out[a.species] = {};
      for (const g of ["idle", "walk", "trot", "gallop"]) o[g] = turn(a, g);
      o.steps = turn(a, "gallop", true);
    }
    // a small change of heading, 45 degrees, after running up s seconds in a gait
    const small = (gait, s) => {
      const a = wolf;
      a.gx = a.nextGX = i0 - 40.5; a.gy = a.nextGY = j0 + 0.5; a.stunnedUntil = 0; S.setCritterIdle(a); a.hx = 1; a.hy = 0; a.speed = 0;
      sim.setIntent(a, { dx: 1, dy: 0, gait });
      for (let n = 0; n < s / sim.tempo; n++) { S.tick(); a.wind = a.stamina = 1; }
      const v0 = a.speed, pose = a.pose;
      sim.setIntent(a, { dx: 1, dy: 1, gait });
      let n = 0, least = v0;
      do { S.tick(); a.wind = a.stamina = 1; least = Math.min(least, a.speed); n++; } while (n < 3 / sim.tempo && !(a.hx === a.wantHx && a.hy === a.wantHy));
      sim.setIntent(a, null); S.setCritterIdle(a);
      return { s: +(n * sim.tempo).toFixed(2), least: +(least / v0).toFixed(2), mps: +(v0 / sim.tempo).toFixed(1), pose };
    };
    out.small = small("trot", 3);
    out.fresh = small("gallop", 0.3);
    out.full = small("gallop", 2.6);
    return out;
  })()`, c);
  const near = (s, lo, hi) => s >= lo && s <= hi;
  for (const sp of ["wolf", "deer"]) {
    const o = res[sp];
    r.check(near(o.idle.s, 0.6, 0.9) && near(o.walk.s, 0.65, 1) && near(o.trot.s, 0.8, 1.2) && near(o.gallop.s, 1.6, 2.3)
      && ["idle", "walk", "trot", "gallop"].every(g => o[g].faces),
      `a ${sp} turns right round in ${o.idle.s} s standing, ${o.walk.s} walking, ${o.trot.s} trotting, ${o.gallop.s} galloping, facing the new way`);
    r.check(o.gallop.least < 0.7 && o.trot.least < 0.6,
      `...slowing as it turns right round: to ${o.gallop.least} of its galloping speed, ${o.trot.least} of its trotting`);
    r.check(o.steps.s >= o.gallop.s - 0.05,
      `...and no quicker galloping round in 45-degree steps (${o.steps.s} s; in one, ${o.gallop.s})`);
  }
  r.check(res.small.least > 0.95 && res.small.s < res.wolf.trot.s / 2,
    `a wolf trotting turns 45 degrees in ${res.small.s} s without slowing (to ${res.small.least} of its speed at least)`);
  r.check(res.fresh.pose === "gallop" && res.full.pose === "gallop" && res.fresh.s < res.full.s,
    `galloping, it turns 45 degrees in ${res.fresh.s} s just into its gallop (at ${res.fresh.mps} m/s), ${res.full.s} s at full gallop (${res.full.mps} m/s)`);
}

module.exports = { name: "turning", main };
if (require.main === module) runStandalone(module.exports.name, main);
