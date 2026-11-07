// Family life among wolves (CARRYING and HOWLING in sim.js; SUPPORT FEEDING, FAMILY ROLES,
// DENS and FINDING ITS PARENTS in mind.js; HOWLS and COVER in senses.js), on open land:
//  - CARRYING: a grown wolf at a carcass tears off a leg (the one with most meat) in
//    tearLegS and carries it; the carcass loses it (torn); four legs at most; a young wolf
//    short of the last young stage can't; put down, the leg is a morsel of its own with the
//    leg's meat, which a wolf eats; a wolf eating with a leg in its mouth eats the leg; no
//    biomass is lost or made tearing one off
//  - HOWLING: a wolf howls a signal, heard 1,000 tiles off, telling it
//  - SCENT: a young wolf never marks over its parent's scent; a young wolf far from its
//    parents follows a parent's trail back to it
//  - DENS: a paired, pregnant female picks a den better hidden than where she stands, and
//    keeps to it; her mate learns it seeing her there
//  - SUPPORT FEEDING and FAMILY ROLES: with newborns at the den, the hungry male howls
//    "hunt" and goes to a carcass; the female, hungry once he has gone, having heard that,
//    stays with the litter;
//    the male eats, tears off a leg, brings it to her, puts it down beside her, and she
//    eats it; then, back home, he howls "stay"
//  - the view: a wolf carrying a leg is drawn with the leg (more pixels than without)
// Runs sim.js, senses.js and mind.js in Node (no browser), then the game in the browser.

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone, openGame, moveToOpenLand } = require("./helpers");

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
  const res = vm.runInContext(`(() => {
    const S = sim.internals, H = sim.gridHeightN, out = {};
    S.holdWater(true);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry land, 40 tiles each way along i and 12 across, levelled
    const [i0, j0] = S.allLandTiles.find(([i, j]) => {
      if (i % 3 || j % 3) return false;
      for (let di = -40; di <= 40; di += 2) for (let dj = -12; dj <= 12; dj += 2) if (sim.getTerrainAt(i + di, j + dj) === "water") return false;
      return true;
    });
    const lv = sim.tileCorners(i0, j0)[0];
    for (let di = -42; di <= 42; di++) for (let dj = -14; dj <= 14; dj++) { S.setTileCorners(i0 + di, j0 + dj, [lv, lv, lv, lv]); S.setBoulder(i0 + di, j0 + dj, false); }
    const put = (a, x, y) => { a.gx = a.nextGX = i0 + x; a.gy = a.nextGY = j0 + y; a.speed = 0; a.stunnedUntil = 0; S.setCritterIdle(a); };
    const away = a => { mind.ignore(a); a.gx = a.nextGX = a.gy = a.nextGY = -700 - a.uid * 3; a.speed = 0; };
    const run = s => { for (let n = 0; n < s / sim.tempo; n++) S.tick(); };
    const grown = (sp, male, k = 0) => sim.allCritters.filter(a => a.species === sp && sim.isGrown(a) && a.isMale === male && a !== sim.pcWolf)[k];
    const net = () => S.worldBiomassKg() - S.ledgerNetKg();
    // a grown wolf made young again: the age at which it can first do cap, times k, its body to match
    const makeYoung = (a, cap, k) => {
      let lo = 0, hi = sim.now - a.birthTime;
      for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; a.birthTime = sim.now - mid; if (sim.can(a, cap)) hi = mid; else lo = mid; }
      a.birthTime = sim.now - hi * k; S.setBodyByAge(a); a.mateUid = null;
      return a;
    };
    const kill = (d, x, y) => { put(d, x, y); S.setBody(d, d.adultKg, 1); S.startCritterDeath(d, "predation"); run(sim.deathDurationSBySpecies.deer + 0.1); };

    // CARRYING
    {
      const w = grown("wolf", true), w2 = grown("wolf", false), d = grown("deer", true);
      kill(d, 0.5, 0.5);
      put(w, 1.5, 0.5); put(w2, -10.5, 0.5);
      const n0 = net(), legs = sim.carcassLegs.map(p => [p, sim.carcassPieceKg(d, p)]).sort((p, q) => q[1] - p[1]);
      sim.setIntent(w, { gait: "take" });
      let n = 0;
      for (; n < 5 / sim.tempo && !w.carrying; n++) S.tick();
      const first = { s: +(n * sim.tempo).toFixed(2), piece: w.carrying?.piece, most: legs[0][0], kg: w.carrying && sim.biomassKg(w.carrying.food),
        left: sim.carcassPieceKg(d, legs[0][0]), torn: d.carcass.torn.has(legs[0][0]), biomass: +(net() - n0).toFixed(9) };
      // three more, then none
      const taken = [w.carrying.piece];
      for (let k = 0; k < 4; k++) {
        w.carrying = null; // (set aside: biomass counted below)
        sim.setIntent(w, { gait: "take" });
        run(sim.tearLegS + 0.2);
        if (w.carrying) { taken.push(w.carrying.piece); out.lastLeg = w.carrying; }
      }
      out.carry = { first, taken: [...new Set(taken)].length, fifth: !!sim.legToTake(d) };
      // put down (the last leg), and eaten by another wolf
      w.carrying = out.lastLeg;
      sim.setIntent(w, { dx: -1, dy: 0, gait: "walk" }); run(4);
      sim.setIntent(w, { gait: "drop" }); S.tick(); sim.setIntent(w, { gait: "idle" });
      const m = sim.allCorpses.find(c => c.morsel);
      out.drop = { morsel: m && m.morsel, kg: m && +sim.carcassMeatKg(m).toFixed(3), legKg: +sim.biomassKg(out.lastLeg.food).toFixed(3), carrying: !!w.carrying,
        nearMouth: m && Math.hypot(m.gx - w.gx, m.gy - w.gy) };
      put(w2, m.gx - i0 - 0.6, m.gy - j0); S.setFood(w2, 0.3);
      sim.setIntent(w2, { gait: "eat" }); run(3); sim.setIntent(w2, { gait: "idle" });
      out.drop.eaten = +(out.drop.kg - sim.carcassMeatKg(m)).toFixed(3);
      // eating with a leg in its mouth: the leg, not the carcass beside it
      const d2 = grown("deer", true, 1);
      kill(d2, 15.5, 0.5);
      put(w2, 16.5, 0.5); sim.setIntent(w2, { gait: "take" }); run(sim.tearLegS + 0.2);
      const legBefore = w2.carrying && sim.biomassKg(w2.carrying.food), carcBefore = sim.carcassMeatKg(d2);
      S.setFood(w2, 0.3); sim.setIntent(w2, { gait: "eat" }); run(1); sim.setIntent(w2, { gait: "idle" });
      out.mouth = { legEaten: legBefore - (w2.carrying ? sim.biomassKg(w2.carrying.food) : 0), carcassEaten: carcBefore - sim.carcassMeatKg(d2) };
      d2.gx = d2.nextGX = d2.gy = d2.nextGY = -602; w2.carrying = null;
      // a young wolf short of the last stage can't tear a leg off
      const pup = makeYoung(grown("wolf", true, 2), "eat", 1.2);
      {
        const stage = sim.youngStage(pup);
        put(pup, 1.5, -0.5); const wasCarrying = pup.carrying;
        sim.setIntent(pup, { gait: "take" }); run(sim.tearLegS + 0.3); sim.setIntent(pup, { gait: "idle" });
        out.pup = { stage, can: sim.canCarry(pup), took: !!pup.carrying && !wasCarrying };
        away(pup);
      }
      [w, w2].forEach(away); d.gx = d.nextGX = d.gy = d.nextGY = -600; m.gx = m.nextGX = m.gy = m.nextGY = -601;
    }

    // HOWLING: heard 1,000 tiles off
    {
      const w = grown("wolf", true), w2 = grown("wolf", false);
      put(w, 0.5, 0.5); put(w2, 0.5, 0.5); w2.gx = w2.nextGX = w.gx + 1000;
      sim.setIntent(w, { gait: "howl", signal: "hunt" });
      const poses = new Set(); let heard = null;
      for (let n = 0; n < 2 / sim.tempo; n++) { S.tick(); poses.add(w.pose); heard = heard || senses.perceive(w2).find(o => o.uid === w.uid) || null; }
      out.howl = { poses: [...poses], signal: w.signal?.kind, heardBy: heard && heard.by, heardSignal: heard && heard.signal?.kind };
      sim.setIntent(w, null); [w, w2].forEach(away);
    }

    // SCENT: a young wolf never marks over its parent's scent; lost, it follows a parent's trail
    {
      const mom = grown("wolf", false), pup = makeYoung(grown("wolf", false, 2), "wean", 1.5);
      const oldParents = pup.parentUids; pup.parentUids = [mom.uid];
      for (const sp of ["deer", "wolf", "death"]) S.scentMarks[sp].clear();
      // the mother walks east 30 tiles; the pup walks the same way after her
      put(mom, -10.5, 0.5); sim.setIntent(mom, { dx: 1, dy: 0, gait: "walk" });
      for (let n = 0; n < 60 / sim.tempo && mom.gx < i0 + 20; n++) S.tick();
      sim.setIntent(mom, null); put(mom, 20.5, 0.5); mind.ignore(mom);
      put(pup, -10.5, 0.5); sim.setIntent(pup, { dx: 1, dy: 0, gait: "walk" });
      for (let n = 0; n < 60 / sim.tempo && pup.gx < i0 + 10; n++) S.tick();
      sim.setIntent(pup, null);
      let mine = 0, hers = 0;
      for (let i = -9; i <= 9; i++) { const s = sim.scentAt(i0 + i, j0, "wolf"); if (s && s.uid === mom.uid) hers++; if (s && s.uid === pup.uid) mine++; }
      out.scent = { hers, mine };
      // lost: far behind on her trail, out of sight and smell; it follows the trail to her
      put(pup, -8.5, 0.5); mind.forget(pup); mind.ignore(pup, false); S.setFood(pup, 1);
      let n = 0, modes = new Set();
      for (; n < 30 / sim.tempo && Math.hypot(pup.gx - mom.gx, pup.gy - mom.gy) > 10; n++) { S.tick(); modes.add(mind.stateOf(pup).mode); }
      out.lost = { s: +(n * sim.tempo).toFixed(1), d: +Math.hypot(pup.gx - mom.gx, pup.gy - mom.gy).toFixed(1), modes: [...modes] };
      pup.parentUids = oldParents; [mom, pup].forEach(away);
    }

    // DENS; SUPPORT FEEDING and FAMILY ROLES
    {
      for (const sp of ["deer", "wolf", "death"]) S.scentMarks[sp].clear();
      // cover: a nook of boulders 6 tiles north of where she stands
      for (const [i, j] of [[-1, -7], [0, -7], [1, -7], [-1, -6], [1, -6], [-1, -5], [1, -5]]) S.setBoulder(i0 + i, j0 + j);
      const he = grown("wolf", true, 1), she = grown("wolf", false, 1);
      S.pair(he, she); put(she, 0.5, 0.5); put(he, 3.5, 0.5); S.setFood(he, 1); S.setFood(she, 1);
      she.lastBredAt = -Infinity; S.conceive(she, he); she.pregnancy.dueAt = sim.now + 20;
      for (const a of [he, she]) { mind.forget(a); mind.ignore(a, false); }
      const stand = senses.coverAt(she.gx, she.gy);
      let learnt = null;
      for (let n = 0; n < 15 / sim.tempo; n++) { S.tick(); if (learnt === null && mind.stateOf(he).den) learnt = +(n * sim.tempo).toFixed(1); }
      const den = mind.stateOf(she).den;
      out.den = { den: den && [den[0] - i0, den[1] - j0], cover: den && senses.coverAt(den[0], den[1]), stand,
        atDen: den && Math.hypot(she.gx - den[0], she.gy - den[1]), mode: mind.stateOf(she).mode, learnt };
      for (let n = 0; n < 10 / sim.tempo && !she.youngUids.length; n++) S.tick();
      out.den.born = she.youngUids.length;
      she.lastBredAt = sim.now; // (not in heat again)
      // both hungry; a carcass 25 tiles off that the male can see
      const d = grown("deer", false, 1);
      kill(d, 25.5, 0.5);
      // (she gets hungry once he has gone: S.setFood below)
      put(he, 3.5, 0.5); he.hx = 1; he.hy = 0; S.setFood(he, 0.6); S.setFood(she, 0.95);
      he.signal = she.signal = null; mind.forget(he);
      const log = { heHowls: [], sheModes: new Set(), dropAt: null, sheAte: false, stay: null };
      let n = 0;
      const pups = she.youngUids.map(uid => S.critterByUid.get(uid)), old = new Set(sim.allCorpses.filter(c => c.morsel));
      let farthest = 0;
      for (; n < 150 / sim.tempo; n++) {
        S.tick();
        if (he.pose === "howl" && !log.heHowls.includes(he.signal.kind)) { log.heHowls.push(he.signal.kind); if (he.signal.kind === "hunt") S.setFood(she, 0.8); }
        const ms = mind.stateOf(she).mode; log.sheModes.add(ms); (log.heModes = log.heModes || new Set()).add(mind.stateOf(he).mode + (he.carrying ? "+leg" : ""));
        farthest = Math.max(farthest, Math.hypot(she.gx - den[0], she.gy - den[1]));
        if (log.dropAt === null && sim.allCorpses.some(c => c.morsel && !old.has(c))) {
          const m = sim.allCorpses.find(c => c.morsel && !old.has(c));
          log.dropAt = { s: +(n * sim.tempo).toFixed(1), fromHer: +Math.hypot(m.gx - she.gx, m.gy - she.gy).toFixed(2), morsel: m };
        }
        if (log.dropAt && she.eating && Math.hypot(log.dropAt.morsel.gx - she.gx, log.dropAt.morsel.gy - she.gy) <= sim.eatReachTiles) log.sheAte = true;
        if (log.heHowls.includes("stay")) { log.stay = +(n * sim.tempo).toFixed(1); break; }
      }
      out.feeding = { howls: log.heHowls, sheModes: [...log.sheModes], drop: log.dropAt && { s: log.dropAt.s, fromHer: log.dropAt.fromHer }, sheAte: log.sheAte,
        stay: log.stay, pups: pups.length, heModes: [...log.heModes], heFood: +he.food.toFixed(2), farthest: +farthest.toFixed(1), morselLeft: log.dropAt && +sim.carcassMeatKg(log.dropAt.morsel).toFixed(2) };
      [he, she, d, ...pups].forEach(a => a && (a.kind === "critter" ? away(a) : null));
    }
    return out;
  })()`, c);

  const { carry, drop, mouth, howl, scent, lost, den, feeding } = res;
  r.check(carry.first.s >= 1.9 && carry.first.s <= 2.1 && carry.first.piece === carry.first.most && carry.first.kg > 1 && carry.first.left === 0 && carry.first.torn
    && Math.abs(carry.first.biomass) < 1e-6,
    `a grown wolf at a carcass tears off its meatiest leg (${carry.first.piece}, ${carry.first.kg.toFixed(1)} kg) in ${carry.first.s} s and carries it; the carcass has none of that leg left; ` +
    `no biomass lost or made (${carry.first.biomass} kg)`);
  r.check(carry.taken === 4 && !carry.fifth, `...four legs at most (${carry.taken} torn off; a fifth: ${carry.fifth})`);
  r.check(drop.morsel && !drop.carrying && Math.abs(drop.kg - drop.legKg) < 1e-6 && drop.nearMouth < 0.6 && drop.eaten > 0,
    `put down, the leg lies as a morsel of its own at the wolf's mouth (${drop.nearMouth && drop.nearMouth.toFixed(2)} tiles), with the leg's meat (${drop.kg} kg), which another wolf eats (${drop.eaten} kg in 3 s)`);
  r.check(mouth.legEaten > 0 && mouth.carcassEaten === 0,
    `a wolf eating with a leg in its mouth eats the leg (${mouth.legEaten.toFixed(3)} kg), not the carcass beside it (${mouth.carcassEaten})`);
  r.check(res.pup.can === (res.pup.stage === 0 || res.pup.stage === 4) && (res.pup.stage === 4 || !res.pup.took),
    `a young wolf can carry a leg only in the last young stage (stage ${res.pup.stage}: can ${res.pup.can}, took ${res.pup.took})`);
  r.check(howl.poses.includes("howl") && howl.signal === "hunt" && howl.heardBy === "hearing" && howl.heardSignal === "hunt",
    `a wolf howls "hunt" (${howl.poses}), and one 1,000 tiles off hears it (${howl.heardBy}: ${howl.heardSignal})`);
  r.check(scent.hers >= 15 && scent.mine === 0,
    `a young wolf walking its mother's trail never marks over her scent (${scent.hers} of 19 tiles hers, ${scent.mine} its own)`);
  r.check(lost.d <= 10 && lost.modes.includes("family"),
    `a young wolf far behind its mother, out of sight and smell, follows her trail to her (within ${lost.d} tiles in ${lost.s} s; ${lost.modes})`);
  r.check(den.den && den.cover > den.stand && den.atDen <= 1.5 && den.mode === "den" && den.learnt !== null && den.born > 0,
    `a paired, pregnant female picks a den better hidden than where she stood (cover ${den.cover} vs ${den.stand}, at ${JSON.stringify(den.den)}), ` +
    `keeps to it (${den.atDen && den.atDen.toFixed(1)} tiles off, ${den.mode}), and gives birth there (${den.born}); her mate learns it seeing her there (after ${den.learnt} s)`);
  r.check(feeding.howls[0] === "hunt" && feeding.sheModes.includes("brood") && feeding.farthest <= 5 && !feeding.sheModes.includes("prowl") && !feeding.sheModes.includes("track"),
    `the hungry male howls "hunt" and goes for the carcass (${feeding.howls}); the hungry female stays with the litter (${feeding.farthest} tiles from the den at most; ${feeding.sheModes})`);
  r.check(feeding.drop && feeding.drop.fromHer <= 1.5 && feeding.sheAte && feeding.stay !== null,
    `...he brings her a leg, puts it down beside her (${feeding.drop && feeding.drop.fromHer} tiles off, after ${feeding.drop && feeding.drop.s} s), and she eats it (${feeding.sheAte}); back home he howls "stay" (after ${feeding.stay} s; his modes ${feeding.heModes}, food ${feeding.heFood})`);

  // the view: a wolf carrying a leg is drawn with it
  const p = await openGame(browser, { viewport: { width: 600, height: 400 } });
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 6, clearOthers: true });
  const shot = async carrying => {
    await p.evaluate(on => {
      const w = sim.pcWolf;
      w.carrying = on ? { piece: "skyHind", food: sim.internals.biomass(), from: { deathTime: sim.now }, uid: -1 } : null;
      w.currentDirection = sim.DIR_E; animat.setZoom(4); animat.render();
    }, carrying);
    await p.waitForTimeout(300);
    await p.evaluate(() => animat.render());
    return p.screenshot({ clip: { x: 200, y: 100, width: 300, height: 200 } });
  };
  const without = await shot(false), withLeg = await shot(true);
  await p.evaluate(() => { sim.pcWolf.carrying = null; });
  const differ = Buffer.compare(without, withLeg) !== 0;
  r.check(differ, `a wolf carrying a leg is drawn with it (the view differs: ${differ})`);
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "family life (wolves)", main };
if (require.main === module) runStandalone(module.exports.name, main);
