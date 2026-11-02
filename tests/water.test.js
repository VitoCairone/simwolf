// Water (see WATER in BODY in sim.js, THIRST in mind.js):
//  - a body loses water as fast as it burns energy and makes some by burning: with neither
//    food nor water a wolf dies of thirst in about two days, a deer in about three (real
//    days, by its metabolism), long before it would starve
//  - food holds water: a deer grazing without pause needs nothing more; a wolf living on
//    meat still dries out, more slowly than with nothing
//  - standing still by fresh water (a lake or river) it drinks, to full within seconds,
//    and swimming in it too; by the sea it drinks nothing; the world's biomass still
//    changes by exactly what the ledger says (drunk and made water in, the rest out)
//  - a thirsty wolf goes to a lake shore it sees and drinks its fill; knowing of no water,
//    it searches, at a trot; by the sea, it tastes the salt and drinks nothing, and the
//    shores there are the sea's to it
//  - the player's wolf's water meter is shown, in blue, below its food
// Runs sim.js, senses.js and mind.js in Node (no browser), then the game for the meter.

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, openGame, runStandalone } = require("./helpers");

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
  // helpers in the simulation's context
  vm.runInContext(`
    var S = sim.internals;
    // a real day by metabolism, in game seconds
    var realDayS = 86400 * S.GAMIFIED.foodFullS.wolf / S.REALISTIC.foodFullS.wolf;
    var wolf = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a !== sim.pcWolf);
    var deer = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    // everyone else far off and left alone
    sim.allCritters.forEach(a => { mind.ignore(a); if (a !== wolf && a !== deer) { a.gx = a.nextGX = a.gy = a.nextGY = -500 - a.uid * 3; a.speed = 0; } });
    var put = (a, x, y) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; a.stunnedUntil = 0; a.climbingUntil = -1;
      a.lifespanS = 1e12; a.eating = false; a.stomach = S.biomass(); S.setCritterIdle(a); };
    var thirsty = (a, water) => { S.setFood(a, 1); a.tissues.waterKg -= (1 - water) * S.lethalWaterShare * a.frameKg; S.updateBody(a); };
    // open land tiles beside water of a kind ("lake", "sea") on one side, the tiles inland
    // from it open land too: { shore: [i, j], way: [di, dj] (toward the water) }
    var shoreOf = (kind, i0, j0, i1, j1, inland = 10) => {
      for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) for (const [di, dj] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        if (sim.waterKindAt(i + di, j + dj) !== kind) continue;
        let ok = true;
        for (let k = 0; k <= inland && ok; k++) ok = !sim.getTerrainAt(i - di * k, j - dj * k).startsWith("water") && !sim.isBlockedTile(i - di * k, j - dj * k)
          && Math.abs(sim.heightAt(i - di * k + 0.5, j - dj * k + 0.5) - sim.heightAt(i + 0.5, j + 0.5)) < 1;
        if (ok) return { shore: [i, j], way: [di, dj] };
      }
      return null;
    };
  `, c);

  // 1. with neither food nor water (only its body runs: S.updateFood, tick by tick)
  const dry = vm.runInContext(`(() => {
    const out = {};
    for (const a of [wolf, deer]) {
      put(a, -9000 - a.uid * 50, -9000); thirsty(a, 1);
      let n = 0, of = null, food = null;
      while (!of && n * sim.tempo < 6 * realDayS) { food = a.food; of = S.updateFood(a); n++; }
      out[a.species] = { days: n * sim.tempo / realDayS, of, food };
      thirsty(a, 1);
    }
    return out;
  })()`, c);
  r.check(dry.wolf.of === "thirst" && dry.wolf.days > 1.5 && dry.wolf.days < 2.5 && dry.deer.of === "thirst" && dry.deer.days > 2.5 && dry.deer.days < 3.5,
    `with neither food nor water, a wolf dies of thirst in ${dry.wolf.days.toFixed(2)} days, a deer in ${dry.deer.days.toFixed(2)} ` +
    `(their food meters still at ${dry.wolf.food.toFixed(2)}, ${dry.deer.food.toFixed(2)})`);

  // 2. food holds water: eating as much as it burns (its usual food, put in its stomach)
  // for a few days (a deer's rumen takes a day or two to fill), against a wolf with nothing
  const food = vm.runInContext(`(() => {
    const meat = S.newCarcass({ tissues: S.bodyOf("deer", 100, 1), stomach: S.biomass(), womb: S.biomass() }).pieces.hips;
    const day = Math.round(realDayS / sim.tempo), out = {};
    for (const [a, src, days] of [[wolf, meat, 1], [deer, S.biomass(S.grassShares, 1), 3]]) {
      thirsty(a, 1);
      // the energy it digests of a kg of its food (all of meat's; of grass's carbs, a share)
      const kg = sim.biomassKg(src);
      const mjPerKg = (sim.energyMJ(src) - src.carbsKg * (1 - S.carbsDigestedBySpecies[a.species]) * 16.7) / kg;
      const kgPerTick = S.rangeMJ(a) * sim.tempo / S.SPEEDS.foodFullS[a.species] / mjPerKg;
      const daily = [];
      for (let n = 1; n <= days * day; n++) {
        for (const key in src) a.stomach[key] += src[key] * kgPerTick / kg;
        S.updateFood(a);
        if (n % day === 0) daily.push(+a.water.toFixed(3));
      }
      out[a.species] = daily; out[a.species + "Food"] = a.food;
    }
    thirsty(wolf, 1);
    for (let n = 0; n < day; n++) S.updateFood(wolf);
    out.none = wolf.water;
    thirsty(wolf, 1); thirsty(deer, 1);
    return out;
  })()`, c);
  const deerW = food.deer[food.deer.length - 1], wolfW = food.wolf[0];
  r.check(deerW > 0.99 && wolfW < 0.9 && wolfW > food.none + 0.1,
    `food holds water: eating as much as it burns (food meters ${food.wolfFood.toFixed(2)}, ${food.deerFood.toFixed(2)}), ` +
    `a deer on grass needs no more (its water by day: ${food.deer.join(", ")}); a wolf on meat dries out (${wolfW.toFixed(3)} after a day), ` +
    `less than one with nothing (${food.none.toFixed(3)})`);

  // 3. drinking, by a lake and by the sea, and swimming
  const drink = vm.runInContext(`(() => {
    const A = sim.startNear, L = S.biomassLedger;
    const lake = shoreOf("lake", A.i0, A.j0, A.i1, A.j1, 2);
    if (!lake) return null;
    const [i, j] = lake.shore;
    put(wolf, i + 0.5, j + 0.5); thirsty(wolf, 0.05);
    const W0 = S.worldBiomassKg(), net0 = S.ledgerNetKg();
    const drunk0 = L.drunkKg, water0 = wolf.tissues.waterKg;
    sim.setIntent(wolf, { gait: "eat" });
    let s = 0; while (wolf.water < 0.999 && s < 10) { S.tick(); s += sim.tempo; }
    const lakeDrink = { s, water: wolf.water, drunk: L.drunkKg - drunk0, gained: wolf.tissues.waterKg - water0 };
    const astray = Math.abs(S.worldBiomassKg() - W0 - (S.ledgerNetKg() - net0));
    // swimming in the lake, eating
    const [di, dj] = lake.way;
    put(wolf, i + di * 3 + 0.5, j + dj * 3 + 0.5); thirsty(wolf, 0.5);
    sim.setIntent(wolf, { gait: "eat" });
    for (let n = 0; n < 1 / sim.tempo; n++) S.tick();
    const swim = { pose: wolf.pose, water: wolf.water, kind: sim.waterKindAt(Math.floor(wolf.gx), Math.floor(wolf.gy)) };
    sim.setIntent(wolf, null);
    return { lake: lakeDrink, swim, astray };
  })()`, c);
  r.check(drink && drink.lake.water >= 0.999 && drink.lake.s <= 6 && Math.abs(drink.lake.drunk - drink.lake.gained) < 0.05 * drink.lake.drunk,
    `a wolf near death of thirst, standing by a lake, drinks its fill in ${drink && drink.lake.s.toFixed(1)} s ` +
    `(${drink && drink.lake.drunk.toFixed(2)} kg drunk, its tissues ${drink && drink.lake.gained.toFixed(2)} kg the wetter)`);
  r.check(drink && drink.swim.pose === "swim" && drink.swim.kind === "lake" && drink.swim.water > 0.6,
    `...and drinks swimming in it (${drink && JSON.stringify(drink.swim)})`);
  r.check(drink && drink.astray < 1e-6, `the world's biomass changes by what the ledger says, drinking too (astray by ${drink && drink.astray.toExponential(1)} kg)`);

  // 4. the mind: a thirsty wolf near a lake shore it can see
  const goes = vm.runInContext(`(() => {
    const A = sim.startNear, lake = shoreOf("lake", A.i0, A.j0, A.i1, A.j1, 10);
    if (!lake) return null;
    const [i, j] = lake.shore, [di, dj] = lake.way;
    put(wolf, i - di * 8 + 0.5, j - dj * 8 + 0.5); wolf.hx = di; wolf.hy = dj; // (facing it)
    thirsty(wolf, 0.5); mind.forget(wolf); mind.ignore(wolf, false);
    const modes = new Set(); let s = 0;
    while (s < 20 && !(modes.has("drink") && wolf.water >= 0.99)) { S.tick(); s += sim.tempo; modes.add(mind.stateOf(wolf)?.mode); }
    const water = wolf.water;
    for (let n = 0; n < 0.5 / sim.tempo; n++) S.tick();
    const after = mind.stateOf(wolf).mode;
    mind.ignore(wolf);
    return { s, water, modes: [...modes], after };
  })()`, c);
  r.check(goes && goes.water >= 0.99 && goes.s < 20 && goes.after !== "drink",
    `a thirsty wolf 8 tiles from a lake shore it sees goes to it and drinks its fill (${goes && goes.s.toFixed(1)} s, ` +
    `water ${goes && goes.water.toFixed(3)}, ${goes && goes.modes.join(",")}), then does something else (${goes && goes.after})`);

  // 5. knowing of no water, it searches
  const search = vm.runInContext(`(() => {
    const A = sim.startArea;
    let at = null;
    for (let i = A.i0; i < A.i1 && !at; i += 4) for (let j = A.j0; j < A.j1 && !at; j += 4) {
      put(wolf, i + 0.5, j + 0.5);
      if (sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j) && !senses.shoresAround(wolf).length) at = [i, j];
    }
    if (!at) return null;
    put(wolf, at[0] + 0.5, at[1] + 0.5); thirsty(wolf, 0.7); mind.forget(wolf); mind.ignore(wolf, false);
    const x0 = wolf.gx, y0 = wolf.gy, gaits = new Set(), modes = new Set();
    for (let n = 0; n < 8 / sim.tempo; n++) { S.tick(); gaits.add(wolf.pose); modes.add(mind.stateOf(wolf).mode); }
    mind.ignore(wolf);
    return { d: Math.hypot(wolf.gx - x0, wolf.gy - y0), gaits: [...gaits], modes: [...modes] };
  })()`, c);
  r.check(search && search.d > 12 && search.gaits.includes("trot") && search.modes.includes("drink"),
    `knowing of no water, a thirsty wolf searches for some at a trot (${search && search.d.toFixed(1)} tiles in 8 s; ${search && search.gaits.join(",")}; ${search && search.modes.join(",")})`);

  // 6. by the sea: the nearest coast to the start, found on the hydrology's graph
  const sea = vm.runInContext(`(() => {
    const G = S.terrainMap.graph, A = sim.startArea, cx = (A.i0 + A.i1) / 2, cy = (A.j0 + A.j1) / 2;
    let best = -1, bestD2 = Infinity;
    for (let n = 0; n < G.px.length; n++) {
      if (!G.ocean[n]) continue;
      const d2 = (G.px[n] - cx) ** 2 + (G.py[n] - cy) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = n; }
    }
    // walk from the start toward it to the first sea, then look about there for a shore
    const len = Math.sqrt(bestD2), ux = (G.px[best] - cx) / len, uy = (G.py[best] - cy) / len;
    let hit = null;
    for (let s = 0; s < len + 500 && !hit; s += 4) if (S.terrainMap.terrainAt(Math.floor(cx + ux * s), Math.floor(cy + uy * s)).kind === "sea") hit = [Math.floor(cx + ux * s), Math.floor(cy + uy * s)];
    if (!hit) return null;
    const coast = shoreOf("sea", hit[0] - 40, hit[1] - 40, hit[0] + 40, hit[1] + 40, 3);
    if (!coast) return null;
    const [i, j] = coast.shore;
    put(wolf, i + 0.5, j + 0.5); thirsty(wolf, 0.5); mind.forget(wolf); mind.ignore(wolf, false);
    const reach = sim.waterInReach(wolf);
    sim.setIntent(wolf, { gait: "eat" });
    S.tick(); // (its turn comes within the next few)
    const water0 = wolf.water;
    for (let n = 0; n < 3 / sim.tempo; n++) S.tick();
    const st = mind.stateOf(wolf);
    mind.ignore(wolf);
    return { reach, water0, water: wolf.water, mode: st.mode, shores: st.waters.length, salt: st.waters.filter(s => s.salt).length };
  })()`, c);
  r.check(sea && sea.reach && sea.reach.kind === "sea" && sea.water <= sea.water0 && sea.mode === "drink" && sea.shores > 0 && sea.salt === sea.shores,
    `a thirsty wolf on the coast tastes the sea and drinks none of it (water ${sea && sea.water0.toFixed(3)} -> ${sea && sea.water.toFixed(3)}); ` +
    `the shores it has seen there are the sea's to it (${sea && sea.salt} of ${sea && sea.shores})`);

  // 7. the meter, in the game
  const p = await openGame(browser, { viewport: { width: 900, height: 650 }, thirst: true });
  const meter = await p.evaluate(() => {
    sim.pause();
    const w = sim.pcWolf, S = sim.internals;
    S.setFood(w, 1); w.tissues.waterKg -= 0.6 * S.lethalWaterShare * w.frameKg; S.updateBody(w);
    animat.render();
    const fill = document.getElementById("water-meter-fill"), bar = fill.parentElement;
    const food = document.getElementById("food-meter-fill").getBoundingClientRect();
    return { water: w.water, share: fill.getBoundingClientRect().width / bar.getBoundingClientRect().width,
      colour: getComputedStyle(fill).backgroundColor, below: fill.getBoundingClientRect().top >= food.bottom };
  });
  r.check(Math.abs(meter.share - meter.water) < 0.02 && meter.below && meter.colour === "rgb(47, 111, 214)",
    `the player's wolf's water meter shows its water (${meter.water.toFixed(2)}: a bar ${meter.share.toFixed(2)} full, ${meter.colour}), below its food`);
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "water (thirst and drinking)", main };
if (require.main === module) runStandalone(module.exports.name, main);
