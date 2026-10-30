// Biomass (see BIOMASS, FOOD and BODY in sim.js):
//  - a biomass is fat, carbs, protein, water and minerals; its energy is 37.7 MJ a kg of
//    fat and 16.7 of carbs or protein, none of water or minerals; a well-fed body's make-up
//    sums to its weight
//  - a body's exchanges keep mass and energy: carbs or protein to fat (and water), fat to
//    carbs (taking up water); nothing makes protein
//  - a deer gets ~10 MJ from a kg of grass (dry), its fibre (and the minerals a grown
//    frame doesn't need) excreted; a full stomach of a
//    species' usual food reads full, an empty one empty; a well-fed body reads full and
//    eating more stores it as fat
//  - the ledger: over half a minute of play, all the world's biomass (grass, critters, their
//    stomachs and wombs, corpses and carcasses) changes by exactly what grass grew less
//    what was burned, excreted, rotted away or lost; no critter makes any
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
  for (const f of ["sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  const parts = vm.runInContext(`(() => {
    const S = sim.internals, out = {};
    const B = S.biomass, kg = sim.biomassKg, mj = sim.energyMJ;
    out.energy = [mj({ ...B(), fatKg: 1 }), mj({ ...B(), carbsKg: 1 }), mj({ ...B(), proteinKg: 1 }), mj({ ...B(), waterKg: 1 }), mj({ ...B(), mineralKg: 1 })];
    out.sums = Object.values(sim.bodySharesBySpecies).map(s => kg(s));
    // exchanges
    const body = () => S.bodyOf("deer", 100, 0.6);
    const kept = (f, b = body()) => { const m0 = kg(b), e0 = mj(b), p0 = b.proteinKg; f(b); return { kg: kg(b) - m0, mj: mj(b) - e0, protein: b.proteinKg - p0, b }; };
    const sweet = body(); sweet.carbsKg += 1;
    out.carbsToFat = kept(b => S.toFat(b, "carbsKg", 1), sweet);
    out.proteinToFat = kept(b => S.toFat(b, "proteinKg", 2));
    out.fatToCarbs = kept(b => { out.made = S.makeCarbs(b, 1); });
    const lean = body(); lean.fatKg = 0;
    out.carbsFromProtein = kept(b => S.makeCarbs(b, 1), lean);
    // grass: a grown deer (at its adult frame, so none goes to growing) takes in a kg of it, dry
    const d = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    S.setBody(d, d.adultKg, 0.5);
    const L = S.biomassLedger, ex0 = L.excretedKg, e0 = mj(d.tissues);
    const fresh = 1 / (1 - S.grassShares.waterKg);
    S.absorb(d, B(S.grassShares, fresh));
    out.grass = { mj: mj(d.tissues) - e0, fibre: L.excretedKg - ex0,
      expectFibre: fresh * (S.grassShares.carbsKg * (1 - S.carbsDigestedBySpecies.deer) + S.grassShares.mineralKg), digested: S.carbsDigestedBySpecies.deer };
    // the meters: well fed, at the lethal point, a full stomach, more food
    const w = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a));
    const meters = a => { S.updateBody(a); return [a.food, a.gut]; };
    S.setBody(w, w.adultKg, 1);
    out.full = meters(w);
    S.setBody(w, w.adultKg, 0); out.lethal = [S.foodShare(w), meters(w)[0]];
    S.setBody(w, w.adultKg, 0.5);
    w.stomach = B(S.newCarcass({ tissues: S.bodyOf("deer", 100, 1), stomach: B(), womb: B() }).pieces.hips, 1);
    const kgHips = kg(w.stomach); for (const k in w.stomach) w.stomach[k] *= S.stomachKg(w) / kgHips;
    out.gutFull = meters(w)[1];
    // fat has no limit: a full wolf given more than a full meter
    S.setBody(w, w.adultKg, 1);
    const fat0 = w.tissues.fatKg;
    S.absorb(w, B({ fatKg: 1, carbsKg: 0, proteinKg: 0, waterKg: 0, mineralKg: 0 }, 2));
    out.fat = { more: w.tissues.fatKg - fat0, share: S.foodShare(w), meter: meters(w)[0] };
    return out;
  })()`, c);
  const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
  r.check(parts.energy.join() === "37.7,16.7,16.7,0,0" && parts.sums.every(x => near(x, 1)),
    `energy a kg: fat, carbs, protein, water, minerals ${parts.energy.join(", ")} MJ; a well-fed body's make-up sums to its weight (${parts.sums.join(", ")})`);
  const ex = ["carbsToFat", "proteinToFat", "fatToCarbs", "carbsFromProtein"].map(k => [k, parts[k]]);
  r.check(ex.every(([, x]) => near(x.kg, 0) && near(x.mj, 0)) && near(parts.carbsToFat.protein, 0) && parts.proteinToFat.protein < 0
    && near(parts.fatToCarbs.protein, 0) && parts.carbsFromProtein.protein < 0 && near(parts.made, 1),
    `a body's exchanges keep mass and energy, and make no protein: ${ex.map(([k, x]) => `${k} ${x.kg.toExponential(0)} kg, ${x.mj.toExponential(0)} MJ, protein ${x.protein.toFixed(2)}`).join("; ")}`);
  r.check(near(parts.grass.mj, 10, 1e-6) && near(parts.grass.fibre, parts.grass.expectFibre, 1e-9),
    `a deer gets ${parts.grass.mj.toFixed(2)} MJ from a kg of grass (dry), digesting ${(parts.grass.digested * 100).toFixed(0)}% of its carbs; ${parts.grass.fibre.toFixed(3)} kg of fibre and minerals (a grown deer's frame takes none) excreted`);
  r.check(near(parts.full[0], 1) && parts.full[1] === 0 && Math.abs(parts.lethal[0]) < 1e-9 && parts.lethal[1] === 0 && near(parts.gutFull, 1, 1e-6),
    `meters: a well-fed wolf reads full, at the lethal point empty (${parts.lethal[0].toExponential(1)}); a stomach full of meat reads full (${parts.gutFull.toFixed(4)}), an empty one empty`);
  r.check(near(parts.fat.more, 2) && parts.fat.share > 1 && parts.fat.meter === 1,
    `fat has no limit: a well-fed wolf stores all it takes in (+${parts.fat.more} kg), its body over full (${parts.fat.share.toFixed(3)}), its meter at full`);

  // half a minute of play: the ledger
  const play = vm.runInContext(`(() => {
    const S = sim.internals, L = S.biomassLedger, L0 = { ...L }, W0 = S.worldBiomassKg();
    let worst = 0, ate = 0;
    for (let n = 0; n < 30 / sim.tempo; n++) {
      S.tick();
      if (n % 60 === 59) {
        const net = (L.grownKg - L0.grownKg) - ["burnedKg", "excretedKg", "rottedKg", "lostKg"].reduce((p, k) => p + L[k] - L0[k], 0);
        worst = Math.max(worst, Math.abs(S.worldBiomassKg() - W0 - net));
      }
      ate += sim.allCritters.filter(a => a.eating).length;
    }
    const d = {}; for (const k in L) d[k] = L[k] - L0[k];
    return { worst, W0, ledger: d, eatTicks: ate };
  })()`, c);
  r.check(play.worst < 1e-7 && play.ledger.grownKg > 0 && play.ledger.burnedKg > 0 && play.eatTicks > 0,
    `over half a minute of play, the world's ${play.W0.toFixed(0)} kg of biomass changes by just what grass grew, less what left ` +
    `(${Object.entries(play.ledger).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}; at most ${play.worst.toExponential(1)} kg astray)`);
}

module.exports = { name: "biomass", main };
if (require.main === module) runStandalone(module.exports.name, main);
