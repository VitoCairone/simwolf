// The start (see THE START in sim.js), at the game's own numbers (no simStart):
// 14 wolves in the start square, 256 tiles a side, and 200 deer in the square twice as
// wide about the same center, every one on dry, unblocked land.
// Runs hydrology.js and sim.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

async function main(browser, r) {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  const res = vm.runInContext(`(() => {
    sim.init();
    const A = sim.startArea, ci = (A.i0 + A.i1) / 2, cj = (A.j0 + A.j1) / 2;
    const of = sp => sim.allCritters.filter(a => a.species === sp);
    const off = a => Math.max(Math.abs(a.gx - ci), Math.abs(a.gy - cj)); // from the center, along either axis
    const land = a => sim.getTerrainAt(Math.floor(a.gx), Math.floor(a.gy)) !== "water" && !sim.isBlockedTile(Math.floor(a.gx), Math.floor(a.gy));
    const w = of("wolf"), d = of("deer");
    return { side: A.i1 - A.i0, wolves: w.length, deer: d.length, wolfOff: Math.max(...w.map(off)), deerOff: Math.max(...d.map(off)),
      deerOut: d.filter(a => off(a) > 128).length, onLand: sim.allCritters.every(land) };
  })()`, context);
  r.check(res.wolves === 14 && res.deer === 200, `14 wolves and 200 deer start (${res.wolves}, ${res.deer})`);
  r.check(res.side === 256 && res.wolfOff <= 128, `the wolves start in the start square, ${res.side} tiles a side (farthest ${res.wolfOff.toFixed(1)} from its center)`);
  r.check(res.deerOff <= 256 && res.deerOut > 100, `the deer in the square twice as wide about it (farthest ${res.deerOff.toFixed(1)}; ${res.deerOut} outside the start square, about 3/4 expected)`);
  r.check(res.onLand, "every critter starts on dry, unblocked land");
}

module.exports = { name: "the start", main };
if (require.main === module) runStandalone(module.exports.name, main);
