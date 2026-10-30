// Game speeds and forced mortality (see GAME SPEEDS and FORCED MORTALITY in sim.js):
//  - every speed constant is in both datasets, REALISTIC and GAMIFIED, and one line picks
//    which the game uses (GAMIFIED)
//  - forced mortality maxima: REALISTIC grey wolf 20.6 years, red deer 31.5 years;
//    GAMIFIED the same shrunk by metabolism's factor (a wolf's full meter: 14 days to 20
//    minutes), so the wolf's is about 7.5 days, and the life-stage ages with it
//  - each critter's lifespan, drawn when it is made, is about normal around its species'
//    mean share of the maximum, within bounds; the first critters start as adults
//    younger than their lifespan
//  - a critter past its lifespan dies: a deer through its death animation to a corpse, a
//    wolf likewise, the player's too
// Runs sim.js in Node (no browser), as a second copy with the choice flipped to REALISTIC.

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

function loadSim(source) {
  const context = vm.createContext({
    console: { log() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  vm.runInContext(source, context, { filename: "sim.js" });
  vm.runInContext("sim.init()", context);
  return context;
}

async function main(browser, r) {
  const source = fs.readFileSync(path.join(ROOT, "sim.js"), "utf8");
  const choice = /^const SPEEDS = (\w+);$/m.exec(source);
  r.check(choice && choice[1] === "GAMIFIED" && source.match(/^const SPEEDS = /mg).length === 1,
    `one line chooses the speeds: ${choice && choice[0]}`);

  const g = loadSim(source);
  const res = vm.runInContext(`(() => {
    const S = sim.internals, R = S.REALISTIC, G = S.GAMIFIED, year = 365 * 24 * 3600;
    const keysOf = o => Object.keys(o).filter(k => k !== "name").sort().join();
    // the same constants, all the way down
    const shape = o => typeof o === "object" ? Object.keys(o).sort().map(k => k + ":" + shape(o[k])).join(",") : "";
    const scale = G.forcedMortalityMaxS.wolf / R.forcedMortalityMaxS.wolf;
    const stagesScaled = Object.keys(R.lifeStageAgesS).every(sp => Object.keys(R.lifeStageAgesS[sp]).every(cap =>
      ["min", "avg", "max"].every(k => Math.abs(G.lifeStageAgesS[sp][cap][k] - R.lifeStageAgesS[sp][cap][k] * scale) < 1e-6)));
    // lifespan draws
    const draws = {};
    for (const sp of ["wolf", "deer"]) {
      const xs = [];
      for (let k = 0; k < 20000; k++) xs.push(S.drawLifespanS(sp) / S.SPEEDS.forcedMortalityMaxS[sp]);
      const mean = xs.reduce((a, b) => a + b) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      const m = S.SPEEDS.mortalityRatio[sp];
      // about normal: about 68% within one spread of the mean
      const within1 = xs.filter(x => Math.abs(x - mean) < sd).length / xs.length;
      draws[sp] = { mean, sd, within1, inBounds: xs.every(x => x >= m.min - 1e-9 && x <= m.max + 1e-9), m };
    }
    // the first critters
    const starts = sim.allCritters.map(a => {
      const age = sim.now - a.birthTime;
      return { ok: age < a.lifespanS && age >= Math.min(S.SPEEDS.lifeStageAgesS[a.species].mate.avg, a.lifespanS / 2) };
    });
    return {
      sameKeys: keysOf(R) === keysOf(G) && shape(R) === shape(G), speeds: sim.speeds,
      realWolfY: R.forcedMortalityMaxS.wolf / year, realDeerY: R.forcedMortalityMaxS.deer / year,
      gameWolfMin: G.forcedMortalityMaxS.wolf / 60, gameDeerMin: G.forcedMortalityMaxS.deer / 60,
      metabolism: Math.abs(scale - G.foodFullS.wolf / R.foodFullS.wolf) < 1e-15,
      sameScale: Math.abs(G.forcedMortalityMaxS.deer / R.forcedMortalityMaxS.deer - scale) < 1e-12,
      stagesScaled, draws, startsOk: starts.every(s => s.ok), starts: starts.length,
    };
  })()`, g);
  r.check(res.sameKeys, "REALISTIC and GAMIFIED list the same constants");
  r.check(res.speeds === "gamified", `the game runs at the GAMIFIED speeds (${res.speeds})`);
  r.check(Math.abs(res.realWolfY - 20.6) < 1e-9 && Math.abs(res.realDeerY - 31.5) < 1e-9,
    `REALISTIC greatest ages: wolf ${res.realWolfY} years, deer ${res.realDeerY} years`);
  r.check(res.metabolism && Math.abs(res.gameWolfMin / 60 / 24 - 7.46) < 0.01 && res.sameScale,
    `GAMIFIED: wolf ${(res.gameWolfMin / 60 / 24).toFixed(2)} days, deer ${(res.gameDeerMin / 60 / 24).toFixed(2)} days (shrunk alike, as meals are)`);
  r.check(res.stagesScaled, "GAMIFIED life-stage ages are shrunk by the same factor");
  for (const sp of ["wolf", "deer"]) {
    const d = res.draws[sp];
    r.check(Math.abs(d.mean - d.m.mean) < 0.005 && Math.abs(d.sd - d.m.sd) < 0.01 && d.inBounds
      && d.within1 > 0.64 && d.within1 < 0.72,
      `${sp} lifespans: about normal, mean ${d.mean.toFixed(3)} (set ${d.m.mean}) and spread ${d.sd.toFixed(3)} ` +
      `(set ${d.m.sd}) of the greatest age, ${(d.within1 * 100).toFixed(0)}% within one spread, all within ${d.m.min}-${d.m.max}`);
  }
  r.check(res.startsOk, `the ${res.starts} first critters start as adults younger than their lifespan`);

  // old age
  const old = vm.runInContext(`(() => {
    const deer = sim.allCritters.find(a => a.species === "deer");
    const wolf = sim.allCritters.find(a => a.species === "wolf" && a !== sim.pcWolf);
    for (const a of [deer, wolf, sim.pcWolf]) a.birthTime = sim.now - a.lifespanS - 1;
    sim.internals.tick();
    const pc = sim.pcWolf, poses = [deer, wolf, pc].map(a => a.pose);
    for (let n = 0; n < 70; n++) sim.internals.tick();
    const corpse = a => sim.allCorpses.includes(a) && !sim.allCritters.includes(a) && a.pose === "dead";
    return { poses, corpses: [deer, wolf, pc].map(corpse), stillPlayers: sim.pcWolf === pc };
  })()`, g);
  r.check(old.poses.every(p => p === "death") && old.corpses.every(c => c),
    `a deer, a wolf and the player's wolf past their lifespans die (${old.poses.join(", ")}), then are corpses`);
  r.check(old.stillPlayers, "the player's wolf, dead, is still the player's (until the next wolf is born)");

  // the other choice
  const real = loadSim(source.replace(/^const SPEEDS = GAMIFIED;$/m, "const SPEEDS = REALISTIC;"));
  const rr = vm.runInContext(`(() => {
    const year = 365 * 24 * 3600;
    const ages = sim.allCritters.map(a => [(sim.now - a.birthTime) / year, a.lifespanS / year, a.species]);
    return { speeds: sim.speeds, ok: ages.every(([age, life]) => age >= 2 && age < life),
      wolfLife: ages.filter(a => a[2] === "wolf").map(a => a[1]) };
  })()`, real);
  r.check(rr.speeds === "realistic" && rr.ok && rr.wolfLife.every(l => l >= 9 && l <= 20.6),
    `with REALISTIC chosen: lifespans in years (wolves ${Math.min(...rr.wolfLife).toFixed(1)}-${Math.max(...rr.wolfLife).toFixed(1)}), adults to start`);
}

module.exports = { name: "game speeds and forced mortality", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
