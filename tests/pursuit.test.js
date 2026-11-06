// Pursuit (see HUNTING and PACE in mind.js): a hungry wolf on the trail of a grazing deer
// far ahead along level open land (ground levelled and cleared for the test), the deer
// unaware of it:
//  - 100 tiles behind, and 400: it follows the trail, striding (galloping with wind to
//    spare, walking to get it back: each gallop a good stretch, no stuttering in and out
//    of it), comes up on the deer with wind enough to run it down, and kills it
//  - once the deer flees, it keeps after that deer: out of sight and hearing, it follows
//    that deer's trail, at a gallop while its wind lasts
//  - a deer 100 tiles ahead spooked by another wolf flees at once, unseen by this one; the
//    wolf strides along its trail all the same (a trail laid faster than it trots), and kills it
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {}, error() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  const pursue = (gap, spooked = false) => vm.runInContext(`(() => {
    const S = sim.internals, H = sim.gridHeightN, D = ${gap};
    S.holdWater(true);
    const wolf = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a !== sim.pcWolf);
    const deer = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a) && sim.isLiveCritter(a));
    sim.allCorpses.forEach(a => { a.gx = a.gy = -500 - a.uid * 3; });
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12;
      if (a !== wolf && a !== deer) { a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; } });
    // a dry strip D + 60 tiles long (400 more for a deer that flees from the start) and 13
    // wide, levelled, its boulders taken away
    const L = D + (${spooked} ? 400 : 60), W = 6;
    const t0 = S.allLandTiles.find(([i, j]) => {
      if (i % 2 || j % 2) return false;
      for (let k = -20; k <= L; k += 2) for (let dj = -W; dj <= W; dj += 2) if (sim.getTerrainAt(i + k, j + dj) === "water") return false;
      return true;
    });
    if (!t0) return null;
    const [i0, j0] = t0, lv = sim.tileCorners(i0, j0)[0];
    for (let k = -22; k <= L + 2; k++) for (let dj = -W - 2; dj <= W + 2; dj++) {
      S.setTileCorners(i0 + k, j0 + dj, [lv, lv, lv, lv]); S.setBoulder(i0 + k, j0 + dj, false);
    }
    const put = (a, x, y) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; a.stunnedUntil = 0; a.climbingUntil = -1;
      a.eating = false; S.setCritterIdle(a); a.hx = 1; a.hy = 0; };
    for (const sp of ["deer", "wolf", "death"]) S.scentMarks[sp].clear();
    put(wolf, i0 + 0.5, j0 + 0.5); put(deer, i0 + D + 0.5, j0 + 0.5);
    S.setFood(wolf, 0.4); S.setFood(deer, 0.5); wolf.wind = deer.wind = 1; wolf.stamina = deer.stamina = 1;
    // the deer walked here along the strip
    for (let k = 1; k <= D; k++) S.scentMarks.deer.set((i0 + k) * H + j0, [sim.now - 2 - (D - k) / 1.4, deer.uid]);
    mind.forget(wolf); mind.forget(deer); mind.ignore(wolf, false); mind.ignore(deer, false);
    // (another wolf, a moment beside the deer, then gone: the deer flees, far from this one)
    const other = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a !== wolf && a !== sim.pcWolf);
    if (${spooked}) {
      put(other, i0 + D - 5.5, j0 + 0.5);
      for (let k = 0; k < 0.5 / sim.tempo; k++) S.tick();
      other.gx = other.nextGX = other.gy = other.nextGY = -900 - other.uid * 3;
    }
    let n = 0, caughtS = null, fledAt = null, windAtFlee = null, last = wolf.pose, since = 0;
    const gallops = [], after = { track: 0, kept: 0, galloping: 0 };
    for (; n < 150 / sim.tempo; n++) {
      S.tick();
      if (!sim.isLiveCritter(deer)) { caughtS = n * sim.tempo; break; }
      const ws = mind.stateOf(wolf), ds = mind.stateOf(deer);
      if (fledAt === null && ds?.mode === "flee") { fledAt = n * sim.tempo; windAtFlee = wolf.wind; }
      if (fledAt === null && wolf.pose !== last) {
        if (last === "gallop") gallops.push((n - since) * sim.tempo);
        last = wolf.pose; since = n;
      }
      // after the deer fled, out of its sight and hearing
      if (fledAt !== null && ws.mode === "track") {
        after.track++;
        if (ws.target === deer.uid) after.kept++;
        if (wolf.pose === "gallop" || wolf.wind < 0.05) after.galloping++;
      }
    }
    sim.allCritters.forEach(a => mind.ignore(a));
    return { caughtS: caughtS && +caughtS.toFixed(1), fledAt: fledAt && +fledAt.toFixed(1), windAtFlee: windAtFlee && +windAtFlee.toFixed(2),
      gallops: gallops.map(s => +s.toFixed(1)), after };
  })()`, c);

  for (const gap of [100, 400]) {
    const p = pursue(gap);
    if (!p) { r.check(false, `a dry strip ${gap + 60} tiles long to chase along`); continue; }
    r.check(p.caughtS !== null && p.windAtFlee >= 0.5 && p.gallops.length >= 1 && p.gallops.every(s => s >= 2) && (gap < 400 || p.gallops.length >= 3),
      `a hungry wolf on a grazing deer's trail ${gap} tiles behind it strides along it (gallops of ${p.gallops.join(", ")} s), ` +
      `comes up on it with ${p.windAtFlee} of its wind (the deer fleeing after ${p.fledAt} s), and kills it (after ${p.caughtS} s)`);
    r.check(p.after.kept === p.after.track && p.after.galloping === p.after.track,
      `...the deer fleeing, out of sight and hearing (if it ever is) the wolf keeps after that deer along its trail, galloping (${p.after.kept} of ` +
      `${p.after.track} ticks after that deer, ${p.after.galloping} galloping or out of wind)`);
  }
  const s = pursue(100, true);
  r.check(s && s.fledAt !== null && s.fledAt < 1 && s.caughtS !== null,
    `a deer 100 tiles ahead, spooked by another wolf, flees at once, unseen by this one; the wolf, striding along its trail (the deer laid it ` +
    `faster than a wolf trots), runs it down all the same (after ${s && s.caughtS} s)`);
}

module.exports = { name: "pursuit", main };
if (require.main === module) runStandalone(module.exports.name, main);
