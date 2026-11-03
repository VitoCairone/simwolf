// Debug mode (the global debugMode in index.html; DEBUG MODE and DEBUG PANEL in animat.js,
// DEBUG PANEL in controls.js; GENERATIONS in sim.js):
//  - on: the debug panel shows each species' live population and greatest generation, and
//    the grid point under the pointer; the outline is drawn under the player's wolf
//  - clicking the wolves' line pins the camera to the first live wolf, then the next by
//    uid each time, back to the first after the last; the deer's line likewise, kept
//    apart
//  - the critters at the start are generation 0; a litter is conceived one generation
//    past the younger generation of its parents (the higher number)
//  - off: no debug panel, no outline
// Saves a screenshot of the panel to tests/output/debug/.

const path = require("path");
const { openGame, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 700 } });
  const outDir = ensureOutputDir("debug");
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 4 });

  // the panel, on
  const on = await p.evaluate(() => {
    animat.render();
    const live = sp => sim.allCritters.filter(a => a.species === sp && sim.isLiveCritter(a));
    const line = id => document.getElementById(id).innerText.replace(/\s+/g, " ").trim();
    return { shown: !document.getElementById("debug-panel").hidden, wolves: line("debug-wolves"), deer: line("debug-deer"),
      nWolves: live("wolf").length, nDeer: live("deer").length,
      genWolves: Math.max(...live("wolf").map(a => a.generation)), genDeer: Math.max(...live("deer").map(a => a.generation)),
      allZero: sim.allCritters.every(a => a.generation === 0) };
  });
  r.check(on.shown && on.wolves === `Wolves: ${on.nWolves} Max Gen ${on.genWolves}` && on.deer === `Deer: ${on.nDeer} Max Gen ${on.genDeer}`,
    `debug mode on: the panel shows the populations and greatest generations ("${on.wolves}", "${on.deer}")`);
  r.check(on.allZero, "the critters at the start are all generation 0");
  const panel = await p.evaluate(() => { const b = document.getElementById("sidebar").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await p.screenshot({ path: path.join(outDir, "panel.png"), clip: panel });

  // generations: a litter one past the younger-generation parent
  const gen = await p.evaluate(() => {
    const S = sim.internals;
    const f = sim.allCritters.find(a => a.species === "deer" && !a.isMale), m = sim.allCritters.find(a => a.species === "deer" && a.isMale);
    const g = [f.generation, m.generation, f.pregnancy];
    f.generation = 2; m.generation = 5; S.conceive(f, m);
    const litter = f.pregnancy.generation;
    f.generation = 7; m.generation = 3; S.conceive(f, m);
    const litter2 = f.pregnancy.generation;
    [f.generation, m.generation, f.pregnancy] = g;
    return [litter, litter2];
  });
  r.check(gen[0] === 6 && gen[1] === 8, `a litter is one generation past the younger-generation parent (2 and 5: ${gen[0]}; 7 and 3: ${gen[1]})`);

  // cycling the camera through each species
  const cycle = async (id, sp) => {
    const order = await p.evaluate(sp => sim.allCritters.filter(a => a.species === sp && sim.isLiveCritter(a)).map(a => a.uid).sort((a, b) => a - b), sp);
    const got = [];
    for (let k = 0; k <= order.length; k++) {
      await p.click(`#${id}`);
      got.push(await p.evaluate(() => animat.camera.pinned && animat.camera.pinned.uid));
    }
    return { order, got };
  };
  const wolves = await cycle("debug-wolves", "wolf");
  r.check(wolves.got.join() === [...wolves.order, wolves.order[0]].join(),
    `clicking the wolves' line pins the camera to each live wolf by uid, then the first again (${wolves.got.join(", ")})`);
  const deer = await cycle("debug-deer", "deer");
  r.check(deer.got.join() === [...deer.order, deer.order[0]].join(),
    `...and the deer's line each deer (${deer.got.slice(0, 6).join(", ")}${deer.got.length > 6 ? ", ..." : ""}), kept apart from the wolves'`);
  await p.evaluate(() => animat.followWolf());

  // the outline under the player's wolf: drawn only while on; and off, no panel
  const shot = async () => {
    await p.evaluate(() => animat.render());
    const at = await p.evaluate(() => {
      const w = sim.pcWolf, [px, py] = animat.isoProject(w.gx, w.gy);
      return animat.worldToScreen(px, py - sim.heightAt(w.gx, w.gy) * 8);
    });
    return (await p.screenshot({ clip: { x: at[0] - 40, y: at[1] - 20, width: 80, height: 40 } })).toString("base64");
  };
  const withOutline = await shot();
  await p.evaluate(() => { window.debugMode = false; });
  const without = await shot();
  const off = await p.evaluate(() => document.getElementById("debug-panel").hidden);
  r.check(withOutline !== without, "the outline under the player's wolf is drawn while debug mode is on, not while off");
  r.check(off, "debug mode off: no debug panel");
  await p.evaluate(() => { window.debugMode = true; });

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "debug mode", main };
if (require.main === module) runStandalone(module.exports.name, main);
