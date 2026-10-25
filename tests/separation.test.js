// The parts of the game stay separate:
//  - sim.js runs on its own in Node, with no browser, page or view at all; on its own it
//    decides nothing (no critter moves unless told to), and with a mind (senses.js and
//    mind.js, also running in Node) critters move by themselves
//  - the page defines exactly five globals (sim, senses, mind, animat, controls)

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, openGame, runStandalone } = require("./helpers");

function bareContext() {
  // no window, no document, no requestAnimationFrame. alert() is the game's "halt" (see
  // README), so here it throws.
  return vm.createContext({
    console: { log() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); },
    setTimeout, clearTimeout,
  });
}
const load = (context, file) =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });

async function main(browser, r) {
  // 1a. sim.js alone, in a bare JavaScript context
  let alone = null;
  try {
    const context = bareContext();
    load(context, "sim.js");
    alone = vm.runInContext(`
      sim.init();
      const start = sim.allCritters.map(a => [a.gx, a.gy]);
      for (let n = 0; n < 600; n++) sim.internals.tick(); // 10 game-seconds
      const moved = sim.allCritters.filter((a, i) => a.gx !== start[i][0] || a.gy !== start[i][1]).length;
      sim.setPlayerIntent({ dir: sim.DIR_E, gait: "walk" }); sim.internals.tick();
      const obeyed = sim.pcWolf.currentDirection === sim.DIR_E && sim.pcWolf.speed > 0;
      ({ ticks: sim.tickCount, critters: sim.allCritters.length, moved, obeyed })`, context);
  } catch (e) {
    r.check(false, `sim.js runs without a browser: ${e.message}`);
  }
  if (alone) {
    r.check(alone.ticks === 601 && alone.critters > 0,
      `sim.js runs without a browser: ${alone.ticks} ticks, ${alone.critters} critters`);
    r.check(alone.moved === 0, `on its own the simulation decides nothing: ${alone.moved} critters moved in 10 s`);
    r.check(alone.obeyed, "an intent (the player's) moves the wolf with no controls attached");
  }

  // 1b. with senses and a mind, still with no browser
  let minded = null;
  try {
    const context = bareContext();
    load(context, "sim.js"); load(context, "senses.js"); load(context, "mind.js");
    minded = vm.runInContext(`
      sim.init(); senses.attach(sim); mind.attach(sim, senses);
      const start = sim.allCritters.map(a => [a.gx, a.gy]);
      for (let n = 0; n < 600; n++) sim.internals.tick();
      ({ moved: sim.allCritters.filter((a, i) => a.gx !== start[i]?.[0] || a.gy !== start[i]?.[1]).length,
         critters: sim.allCritters.length })`, context);
  } catch (e) {
    r.check(false, `sim.js with senses.js and mind.js runs without a browser: ${e.message}`);
  }
  if (minded) r.check(minded.moved > 0,
    `with a mind attached, critters move by themselves (${minded.moved} of ${minded.critters} moved in 10 s)`);

  // 2. in the page, the only globals the game adds are its five objects
  const p = await openGame(browser);
  const g = await p.evaluate(() => {
    const blank = document.createElement("iframe");
    document.body.appendChild(blank);
    const builtIn = new Set(Object.getOwnPropertyNames(blank.contentWindow));
    blank.remove();
    const added = Object.getOwnPropertyNames(window).filter(k => !builtIn.has(k));
    // top-level const/let/class don't appear on window: probe the old shared names
    const oldNames = ["tick", "pcWolf", "allCritters", "zoom", "worldShiftPX", "consoleOnlyMode",
      "frameDataBySpeciesAndPose", "renderedTiles", "keysPressed", "isoProject", "getTerrainAt",
      "perceive", "memories", "think", "canSee", "canHear"];
    const leaked = oldNames.filter(n => { try { eval(n); return true; } catch { return false; } });
    return { added, leaked, types: [typeof sim, typeof senses, typeof mind, typeof animat, typeof controls] };
  });
  r.check(g.types.every(t => t === "object"), "sim, senses, mind, animat and controls are defined");
  r.check(g.added.length === 0, `no other window properties (${g.added.join(", ") || "none"})`);
  r.check(g.leaked.length === 0, `no old shared globals (${g.leaked.join(", ") || "none"})`);
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "separation (sim / senses / mind / animat / controls)", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
