// Starvation (see BIOMASS in sim.js): fifty wolves and three deer. The wolves kill and
// eat the deer (or a deer runs far off, beyond every wolf, or tires out in the water and
// starves: the map is big), and with nothing else to eat (wolves don't eat wolves), all
// of them starve, the young they bear meanwhile too (born of their mothers' bodies): all
// within four times as long as a full meter lasts.
// Runs sim.js, senses.js and mind.js in Node (no browser), with the start's numbers changed.

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

async function main(browser, r) {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  let src = fs.readFileSync(path.join(ROOT, "sim.js"), "utf8");
  r.check(src.includes("const nWolves = 10;") && src.includes("const nDeer = 50;"), "the start's numbers are where this test changes them");
  src = src.replace("const nWolves = 10;", "const nWolves = 50;").replace("const nDeer = 50;", "const nDeer = 3;");
  vm.runInContext(fs.readFileSync(path.join(ROOT, "hydrology.js"), "utf8"), context, { filename: "hydrology.js" });
  vm.runInContext(src, context, { filename: "sim.js" });
  for (const f of ["senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  const out = vm.runInContext(`(() => {
    sim.init(); senses.attach(sim); mind.attach(sim, senses);
    sim.internals.holdWater(true); // (they starve, rather than die of thirst)
    const S = sim.internals, L = S.biomassLedger, W0 = S.worldBiomassKg(), L0 = { ...L }, net0 = S.ledgerNetKg();
    const live = sp => sim.allCritters.filter(a => a.species === sp && sim.isLiveCritter(a)).length;
    const limitS = 4 * S.SPEEDS.foodFullS.wolf;
    // every deer dead, or far from every wolf (as last seen while wolves lived)
    const goneTiles = 300, livers = sp => sim.allCritters.filter(a => a.species === sp && sim.isLiveCritter(a));
    let deerGone = null, most = 0, escaped = 0;
    while (sim.now < limitS && live("wolf")) {
      for (let n = 0; n < 600; n++) S.tick();
      const wolves = livers("wolf"), deer = livers("deer");
      if (wolves.length && deer.every(d => wolves.every(w => Math.hypot(w.gx - d.gx, w.gy - d.gy) > goneTiles))) {
        if (deerGone === null) deerGone = sim.now;
        escaped = deer.length;
      } else deerGone = null;
      most = Math.max(most, live("wolf"));
    }
    const net = S.ledgerNetKg() - net0;
    return { deerGone, escaped, wolves: live("wolf"), t: sim.now, limitS, most, astray: Math.abs(S.worldBiomassKg() - W0 - net), W0 };
  })()`, context);
  r.check(out.deerGone !== null, `the three deer are all gone in ${out.deerGone && (out.deerGone / 60).toFixed(1)} game minutes ` +
    `(${3 - out.escaped} killed or starved, ${out.escaped} far off, beyond every wolf)`);
  r.check(out.wolves === 0,
    `...and then every wolf starves: none left after ${(out.t / 60).toFixed(1)} game minutes (at most ${out.most} at once; ${out.wolves} left; ${(out.limitS / 60).toFixed(0)} allowed)`);
  r.check(out.astray < 1e-6 * out.W0, `no biomass made or lost but by the ledger (${out.astray.toExponential(1)} kg astray)`);
}

module.exports = { name: "starvation", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
