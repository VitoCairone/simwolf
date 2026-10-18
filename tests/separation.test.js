// The three parts of the game stay separate:
//  - sim.js runs on its own in Node, with no browser, page or view at all
//  - the page defines exactly three globals (sim, animat, controls) and nothing else

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, openGame, runStandalone } = require("./helpers");

async function main(browser, r) {
  // 1. sim.js in a bare JavaScript context: no window, no document, no requestAnimationFrame.
  // alert() is the game's "halt" (see README), so here it throws.
  const context = vm.createContext({
    console: { log() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); },
    setTimeout, clearTimeout,
  });
  let headless = null;
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "sim.js"), "utf8") + "\n;sim", context, { filename: "sim.js" });
    headless = vm.runInContext(`
      sim.init();
      const start = sim.allCritters.map(a => [a.gx, a.gy]);
      for (let n = 0; n < 600; n++) sim.internals.tick(); // 10 game-seconds
      const moved = sim.allCritters.filter((a, i) => a.gx !== start[i]?.[0] || a.gy !== start[i]?.[1]).length;
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" }); sim.internals.tick();
      const obeyed = sim.pcWolf.currentDirection === sim.DIR_E && sim.pcWolf.speed > 0;
      ({ ticks: sim.tickCount, critters: sim.allCritters.length + sim.allCorpses.length, moved, obeyed })`,
      context);
  } catch (e) {
    r.check(false, `sim.js runs without a browser: ${e.message}`);
  }
  if (headless) {
    r.check(headless.ticks === 601 && headless.critters > 0,
      `sim.js runs without a browser: ${headless.ticks} ticks, ${headless.critters} critters`);
    r.check(headless.moved > 0, `critters move with no view attached (${headless.moved} moved)`);
    r.check(headless.obeyed, "a player intent steers the wolf with no controls attached");
  }

  // 2. in the page, the only globals the game adds are its three objects
  const p = await openGame(browser);
  const g = await p.evaluate(() => {
    const blank = document.createElement("iframe");
    document.body.appendChild(blank);
    const builtIn = new Set(Object.getOwnPropertyNames(blank.contentWindow));
    blank.remove();
    const added = Object.getOwnPropertyNames(window).filter(k => !builtIn.has(k));
    // top-level const/let/class don't appear on window: probe the old shared names
    const oldNames = ["tick", "pcWolf", "allCritters", "zoom", "worldShiftPX", "consoleOnlyMode",
      "frameDataBySpeciesAndPose", "renderedTiles", "keysPressed", "isoProject", "getTerrainAt"];
    const leaked = oldNames.filter(n => { try { eval(n); return true; } catch { return false; } });
    return { added, leaked, types: [typeof sim, typeof animat, typeof controls] };
  });
  r.check(g.types.every(t => t === "object"), "sim, animat and controls are defined");
  r.check(g.added.length === 0, `no other window properties (${g.added.join(", ") || "none"})`);
  r.check(g.leaked.length === 0, `no old shared globals (${g.leaked.join(", ") || "none"})`);
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "separation (sim / animat / controls)", main };
if (require.main === module) runStandalone(module.exports.name, main);
