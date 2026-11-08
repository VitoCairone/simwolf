// Finding the way (see WAYFINDING and TRAPPED in mind.js), on open level land with
// boulders put down for the test:
//  - a deer fleeing a wolf toward a wall of boulders it sees turns along it, not into it
//    (never stunned)
//  - a hungry wolf goes to a carcass it knows of behind a wall through a gap in it, never
//    bumping a boulder
//  - a wolf kept pacing to and fro over a few tiles comes to know it is trapped, and goes off
//    to ground it hasn't been (mode "escape")
//  - a deer penned in by boulders never bumps them, and finds the way out once one is gone
//  - FORESEEING: a wolf striding along a deer trail that turns sharply by a wall of
//    boulders (levelled land) slows for the bend in time, galloping before and after it,
//    never bumping the wall
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, testStart, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({ simStart: testStart,
    console: { log() {}, info() {}, warn() {}, error() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  const res = vm.runInContext(`(() => {
    const S = sim.internals;
    S.holdWater(true);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry level land, 14 tiles each way
    const [i0, j0] = S.allLandTiles.find(([i, j]) => {
      const lv = sim.tileCorners(i, j)[0];
      for (let di = -14; di <= 14; di++) for (let dj = -14; dj <= 14; dj++)
        if (sim.getTerrainAt(i + di, j + dj) === "water" || sim.isBlockedTile(i + di, j + dj) || sim.tileCorners(i + di, j + dj).some(h => h !== lv)) return false;
      return true;
    });
    const rocks = [];
    const rock = (i, j) => { S.setBoulder(i0 + i, j0 + j); rocks.push([i0 + i, j0 + j]); };
    const clear = () => { rocks.forEach(([i, j]) => S.setBoulder(i, j, false)); rocks.length = 0; };
    const put = (a, i, j, hx = 1, hy = 0) => { a.gx = a.nextGX = i0 + i; a.gy = a.nextGY = j0 + j; a.speed = 0; a.stunnedUntil = 0;
      S.setCritterIdle(a); a.hx = hx; a.hy = hy; };
    const away = a => { mind.ignore(a); a.gx = a.nextGX = a.gy = a.nextGY = -700 - a.uid * 3; a.speed = 0; };
    // runs up to s seconds (until done()): the stuns of critter a, and its modes
    const run = (a, s, done = () => false) => {
      let stuns = 0, last = a.blockedTick, n = 0;
      const modes = new Set();
      for (; n < s / sim.tempo && !done(); n++) {
        S.tick();
        if (a.blockedTick !== last) { stuns++; last = a.blockedTick; }
        modes.add(mind.stateOf(a)?.mode);
      }
      return { stuns, modes: [...modes].filter(Boolean), s: +(n * sim.tempo).toFixed(1) };
    };
    const grown = (sp, k = 0) => sim.allCritters.filter(a => a.species === sp && sim.isGrown(a))[k];
    const out = {};

    // a deer fleeing a wolf toward a wall across its way, 4 tiles ahead
    {
      const d = grown("deer"), w = grown("wolf");
      for (let j = -6; j <= 6; j++) rock(4, j);
      put(w, -3.5, 0.5); put(d, 0.5, 0.5);
      S.setFood(d, 1); mind.forget(d); mind.ignore(d, false);
      const o = run(d, 5);
      out.flee = { ...o, from: +Math.hypot(d.gx - w.gx, d.gy - w.gy).toFixed(1), x: +(d.gx - i0).toFixed(1) };
      away(d); away(w); clear();
    }

    // a wolf, hungry, to a carcass it knows of 8 tiles off behind a wall with a gap in it
    {
      const w = grown("wolf"), d = grown("deer", 1);
      put(d, 8.5, 0.5);
      S.setBody(d, d.adultKg, 1);
      S.startCritterDeath(d, w);
      for (let n = 0; n < Math.ceil(sim.deathDurationSBySpecies.deer / sim.tempo) + 2; n++) S.tick();
      put(w, 0.5, 0.5); S.setFood(w, 0.3); mind.forget(w); mind.ignore(w, false);
      const seen = run(w, 0.3); // (it sees it)
      for (let j = -7; j <= 7; j++) if (j !== 4) rock(4, j);
      const meat0 = sim.carcassMeatKg(d);
      let pathed = false;
      const o = run(w, 15, () => { pathed = pathed || !!mind.stateOf(w)?.path; return w.eating && sim.carcassMeatKg(d) < meat0; });
      out.gap = { ...o, saw: seen.modes, ate: w.eating, pathed };
      away(w); clear();
      d.gx = d.nextGX = d.gy = d.nextGY = -600;
    }

    // a wolf, full and calm, kept pacing to and fro over 6 tiles for 40 s; then let be
    {
      const w = grown("wolf", 1);
      for (const sp of ["deer", "wolf"]) S.scentMarks[sp].clear();
      put(w, 0.5, 0.5); S.setFood(w, 1); mind.forget(w); mind.ignore(w, false);
      let trapped = 0;
      const v = 2 * sim.tempo; // 2 tiles a second
      for (let n = 0; n < 40 / sim.tempo; n++) {
        S.tick();
        const t = (n * v) % 12, x = t < 6 ? t : 12 - t;
        w.gx = w.nextGX = i0 + 0.5 + x - 3; w.gy = w.nextGY = j0 + 0.5; w.speed = v; w.hx = t < 6 ? 1 : -1; w.hy = 0;
        trapped = Math.max(trapped, mind.stateOf(w).trapped);
      }
      let far = 0;
      const o = run(w, 20, () => { far = Math.max(far, Math.hypot(w.gx - i0 - 0.5, w.gy - j0 - 0.5)); return far > 12; });
      out.paced = { ...o, trapped: +trapped.toFixed(2), far: +far.toFixed(1) };
      away(w);
    }

    // a deer, full and calm, in a pen 7 tiles square inside, without a way out; then a gap
    // opened in its wall
    {
      const d = grown("deer", 2);
      for (let k = -4; k <= 4; k++) { rock(k, -4); rock(k, 4); rock(-4, k); rock(4, k); }
      put(d, 0.5, 0.5);
      S.setFood(d, 1); mind.forget(d); mind.ignore(d, false);
      const inside = () => Math.abs(d.gx - i0 - 0.5) < 4 && Math.abs(d.gy - j0 - 0.5) < 4;
      const shut = run(d, 30);
      S.setBoulder(i0 + 4, j0 + 2, false);
      const o = run(d, 30, () => !inside());
      out.pen = { s: o.s, modes: [...new Set([...shut.modes, ...o.modes])], out: !inside(), stuns: shut.stuns + o.stuns };
      away(d); clear();
    }
    // a wolf striding along a minute-old deer trail: 20 tiles east, then sharply north
    // (-j), a wall of boulders 2 tiles beyond the bend (land levelled, boulders cleared)
    {
      const H = sim.gridHeightN, w = grown("wolf"), d = grown("deer", 3);
      const t0 = S.allLandTiles.find(([i, j]) => {
        if (i % 3 || j % 3) return false;
        for (let di = -8; di <= 34; di += 2) for (let dj = -30; dj <= 8; dj += 2) if (sim.getTerrainAt(i + di, j + dj) === "water") return false;
        return true;
      });
      const [a0, b0] = t0, lv = sim.tileCorners(a0, b0)[0];
      for (let di = -9; di <= 35; di++) for (let dj = -31; dj <= 9; dj++) { S.setTileCorners(a0 + di, b0 + dj, [lv, lv, lv, lv]); S.setBoulder(a0 + di, b0 + dj, false); }
      const wall = [];
      for (let dj = -4; dj <= 4; dj++) { S.setBoulder(a0 + 22, b0 + dj); wall.push([a0 + 22, b0 + dj]); }
      for (const sp of ["deer", "wolf", "death"]) S.scentMarks[sp].clear();
      const marks = [];
      for (let k = 1; k <= 20; k++) marks.push([a0 + k, b0]);
      for (let k = 1; k <= 25; k++) marks.push([a0 + 20, b0 - k]);
      marks.forEach(([i, j], k) => S.scentMarks.deer.set(i * H + j, [sim.now - 60 - (marks.length - k) / 1.4, d.uid]));
      put(w, a0 - 4.5 - i0, b0 + 0.5 - j0); w.gx = w.nextGX = a0 - 4.5; w.gy = w.nextGY = b0 + 0.5;
      d.gx = d.nextGX = d.gy = d.nextGY = -650; // (gone on, far off)
      S.setFood(w, 0.4); w.wind = w.stamina = 1; mind.forget(w); mind.ignore(w, false);
      let galloped = { before: false, after: false }, past = false, least = Infinity;
      const o = run(w, 14, () => {
        if (w.pose === "gallop") galloped[w.gy < b0 - 3 ? "after" : "before"] = true;
        if (Math.abs(w.gx - a0 - 20.5) < 3 && Math.abs(w.gy - b0) < 3) least = Math.min(least, w.speed / sim.tempo);
        return (past = w.gy < b0 - 12);
      });
      out.bend = { ...o, galloped, past, least: +least.toFixed(1) };
      wall.forEach(([i, j]) => S.setBoulder(i, j, false));
      away(w);
    }
    return out;
  })()`, c);
  const { flee, gap, paced, pen, bend } = res;
  const sim_gallop = vm.runInContext("sim.gaitSpeed('wolf', 'gallop') / sim.tempo", c);
  r.check(flee.modes.includes("flee") && flee.stuns === 0 && flee.from > 6,
    `a deer fleeing toward a wall of boulders it sees turns along it, never stunned (${flee.stuns} stuns in ${flee.s} s; ` +
    `${flee.from} tiles from the wolf; ${flee.modes})`);
  r.check(gap.saw.includes("feed") && gap.ate && gap.pathed && gap.stuns === 0,
    `a hungry wolf goes through the gap in a wall to a carcass it knows of behind it, never bumping a boulder ` +
    `(eating after ${gap.s} s; ${gap.stuns} stuns; ${gap.modes})`);
  r.check(paced.trapped > 0.3 && paced.modes.includes("escape") && paced.far >= 12,
    `a wolf that has paced to and fro over a few tiles a while comes to know it is trapped (up to ${paced.trapped}), ` +
    `and goes off to ground it hasn't been (${paced.far} tiles off in ${paced.s} s; ${paced.modes})`);
  r.check(bend.past && bend.stuns === 0 && bend.galloped.before && bend.least < 0.6 * sim_gallop,
    `a wolf striding along a deer trail that turns sharply by a wall slows for the bend in time (to ${bend.least} m/s), ` +
    `never bumping the wall (${bend.stuns} stuns; galloping before the bend ${bend.galloped.before}, after ${bend.galloped.after}; past it in ${bend.s} s; ${bend.modes})`);
  r.check(pen.out && pen.stuns === 0,
    `a deer penned in by boulders stands or walks about inside never bumping them, and finds the way out once one is taken away ` +
    `(in ${pen.s} s; ${pen.modes}; ${pen.stuns} stuns)`);
}

module.exports = { name: "finding the way", main };
if (require.main === module) runStandalone(module.exports.name, main);
