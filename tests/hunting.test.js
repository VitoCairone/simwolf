// Hunting by scent (see WOLVES, TRACKING in mind.js; DEATH SCENT in sim.js):
//  - FAMISHED: a wolf hungrier than half (hunger: 1 - its food meter), its stomach under
//    half full, hunts before it drinks, thirsty as it is; less hungry, it drinks first
//  - a hunting wolf that can't see or hear a deer follows the freshest deer trail about,
//    the way the deer went
//  - DASHING: after prey it gallops while its stamina meter is above its food meter and
//    its wind above half, else trots
//  - a carcass spreads death scent over the land around it, out to 20 tiles, the circle
//    growing over 20 s from the death, renewed every 5 minutes, always stronger toward
//    the carcass; never on water
//  - a hungry wolf that knows of no carcass follows death scent to one, and eats
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  vm.runInContext(`
    var S = sim.internals, H = sim.gridHeightN;
    var wolf = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a !== sim.pcWolf);
    var deer = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; if (a !== wolf && a !== deer) { a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; } });
    var put = (a, x, y, hx = 1, hy = 0) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; a.stunnedUntil = 0; a.climbingUntil = -1;
      a.eating = false; S.setCritterIdle(a); a.hx = hx; a.hy = hy; };
    var tick = s => { for (let n = 0; n < s / sim.tempo; n++) S.tick(); };
    // open dry land, level within a level, R tiles each way
    var openAt = R => sim.internals.allLandTiles.find(([i, j]) => {
      for (let di = -R; di <= R; di += 2) for (let dj = -R; dj <= R; dj += 2)
        if (sim.getTerrainAt(i + di, j + dj) === "water" || sim.isBlockedTile(i + di, j + dj)) return false;
      return true;
    });
    // a land tile with dry land R tiles each way and along +i or -i from -16 to 22 tiles:
    // [i, j, dir]
    var lineAt = R => { for (const t of sim.internals.allLandTiles) {
      if (t[0] % 3 || t[1] % 3) continue;
      for (const dir of [1, -1]) {
        let ok = true;
        for (let k = -16; k <= 22 && ok; k++) ok = sim.getTerrainAt(t[0] + dir * k, t[1]) !== "water" && !sim.isBlockedTile(t[0] + dir * k, t[1]);
        for (let di = -R; di <= R && ok; di++) for (let dj = -R; dj <= R && ok; dj++) ok = sim.getTerrainAt(t[0] + di, t[1] + dj) !== "water" && !sim.isBlockedTile(t[0] + di, t[1] + dj);
        if (ok) return [t[0], t[1], dir];
      }
    } return null; };
    // a deer trail along +i from (x, y), fresher the farther along: n tiles, made t s ago at its end
    var trail = (x, y, n, t = 5) => { for (let k = 0; k < n; k++) S.scentMarks.deer.set((Math.floor(x) + k) * H + Math.floor(y), [sim.now - t - (n - k), deer.uid]); };
    var clearScent = () => { for (const sp of ["deer", "wolf", "death"]) S.scentMarks[sp].clear(); };
    var think = (a, s) => { mind.forget(a); mind.ignore(a, false); const modes = new Set(), poses = new Set();
      for (let n = 0; n < s / sim.tempo; n++) { S.tick(); modes.add(mind.stateOf(a)?.mode); poses.add(a.pose); }
      mind.ignore(a); return { modes: [...modes], poses: [...poses] }; };
    deer.gx = deer.nextGX = deer.gy = deer.nextGY = -800;
  `, c);

  // FAMISHED: hunts (here, along a trail) before it drinks
  const famished = vm.runInContext(`(() => {
    const t = openAt(10); if (!t) return null;
    const out = {};
    for (const food of [0.4, 0.6]) {
      clearScent(); put(wolf, t[0] + 0.5, t[1] + 0.5); S.setFood(wolf, food);
      wolf.tissues.waterKg -= 0.5 * S.lethalWaterShare * wolf.frameKg; S.updateBody(wolf); // thirsty
      trail(t[0] + 1, t[1], 6);
      out[food] = think(wolf, 0.5).modes;
    }
    return out;
  })()`, c);
  r.check(famished && famished["0.4"].includes("track") && !famished["0.4"].includes("drink") && famished["0.6"].includes("drink"),
    `famished (hunger 60%, stomach empty), a thirsty wolf hunts first (${famished && famished["0.4"]}); less hungry (40%), it drinks first (${famished && famished["0.6"]})`);

  // TRACKING and DASHING: along a trail, the way the deer went, galloping or trotting
  // (thirst aside from here: see helpers.js)
  vm.runInContext("S.holdWater(true)", c);
  const dash = vm.runInContext(`(() => {
    const t = openAt(14); if (!t) return null;
    const out = [];
    for (const [stamina, wind] of [[1, 1], [1, 0.4], [0.3, 1]]) {
      clearScent(); put(wolf, t[0] - 4.5, t[1] + 0.5); S.setFood(wolf, 0.6); wolf.stamina = stamina; wolf.wind = wind;
      trail(t[0] - 5, t[1], 12);
      const x0 = wolf.gx, r = think(wolf, 1.5);
      out.push({ stamina, wind, food: 0.6, moved: +(wolf.gx - x0).toFixed(1), modes: r.modes, gallop: r.poses.includes("gallop"), trot: r.poses.includes("trot") });
    }
    return out;
  })()`, c);
  r.check(dash && dash.every(d => d.modes.includes("track") && d.moved > 1),
    `a hunting wolf with no deer in sight follows a deer trail the way the deer went (${dash && dash.map(d => d.moved + " tiles").join(", ")} along it in 1.5 s)`);
  r.check(dash && dash[0].gallop && !dash[1].gallop && dash[1].trot && !dash[2].gallop && dash[2].trot,
    `...galloping with stamina above its food meter and wind above half (${dash && dash[0].gallop}), trotting with wind at 40% (${dash && !dash[1].gallop}) or stamina below its food meter (${dash && !dash[2].gallop})`);

  // DEATH SCENT: the circle growing, stronger toward the carcass, renewed
  const death = vm.runInContext(`(() => {
    const t = lineAt(3); if (!t) return null;
    clearScent(); put(deer, t[0] + 0.5, t[1] + 0.5); S.startCritterDeath(deer, "predation");
    const ci = t[0], cj = t[1], dir = t[2], at = (d) => sim.scentAt(ci + dir * d, cj, "death");
    tick(10.05);
    const at10 = { in: !!at(9), out: !at(12) };
    tick(10.5);
    const full = [0, 5, 10, 15, 20].map(d => at(d) && +at(d).ageS.toFixed(0));
    const beyond = !at(21);
    // no mark on water within its reach
    let wet = 0;
    for (let di = -20; di <= 20; di++) for (let dj = -20; dj <= 20; dj++)
      if (sim.getTerrainAt(ci + di, cj + dj) === "water" && sim.scentAt(ci + di, cj + dj, "death")) wet++;
    const before = at(0).ageS;
    tick(300 - 20.55 + 0.5);
    const renewed = at(0).ageS;
    return { at10, full, beyond, wet, before: +before.toFixed(1), renewed: +renewed.toFixed(1), carcass: [ci, cj, dir] };
  })()`, c);
  const ages = death && death.full;
  r.check(death && death.at10.in && death.at10.out && ages.every(a => a !== null) && death.beyond && ages.every((a, k) => k === 0 || a > ages[k - 1]),
    `a carcass spreads death scent: 10 s on, out to about 10 tiles; 20 s on, to 20 and no farther, older (fainter) outward (ages ${ages && ages.join(", ")} s at 0, 5, 10, 15, 20 tiles)`);
  r.check(death && death.wet === 0 && death.renewed < 1 && death.before > 0,
    `...none on water (${death && death.wet} wet tiles marked); renewed after 5 minutes (age at the carcass ${death && death.renewed} s)`);

  // a hungry wolf, the carcass out of sight and not on the wind, follows death scent to it
  const scavenge = vm.runInContext(`(() => {
    const [ci, cj, dir] = ${JSON.stringify(death && death.carcass)};
    put(wolf, ci + 0.5 - dir * 14, cj + 0.5, -dir, 0); S.setFood(wolf, 0.6); // facing away
    S.setWind(dir > 0 ? 0 : Math.PI); // from the wolf toward the carcass: it can't smell the carcass on the wind
    mind.forget(wolf); mind.ignore(wolf, false);
    const modes = new Set(); let ate = false, n = 0;
    for (; n < 20 / sim.tempo && !ate; n++) { S.tick(); modes.add(mind.stateOf(wolf)?.mode); if (wolf.eating && wolf.gut > 0) ate = true; }
    mind.ignore(wolf);
    return { ate, s: +(n * sim.tempo).toFixed(1), modes: [...modes] };
  })()`, c);
  r.check(scavenge && scavenge.ate && scavenge.modes.includes("track"),
    `a hungry wolf 14 tiles off, facing away, the carcass not on the wind, follows its death scent to it and eats (${scavenge && scavenge.s} s; ${scavenge && scavenge.modes})`);
}

module.exports = { name: "hunting by scent", main };
if (require.main === module) runStandalone(module.exports.name, main);
