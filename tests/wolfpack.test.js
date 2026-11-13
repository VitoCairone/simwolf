// Wolves living off deer for good (see BITING in sim.js; WOLVES, FAMILY ROLES, SUPPORT
// FEEDING in mind.js):
//  - BITING: a wolf kills a deer only biting it: galloping at it, facing it, it does;
//    walking into it, with a full stomach, or too young to hunt, it only bumps it
//  - a weaned young wolf too young to hunt doesn't hunt, hungry as it is, a deer in sight;
//    old enough, it does
//  - a father fed at a carcass takes a leg home while his young are weaned but too young
//    to hunt, and goes back for more
//  - a male that knows his mate's den (she pregnant there, no young yet) brings her a leg
//  - a wolf with a home (its den) keeps its prowling to its range (prowlHomeTiles)
//  - LEADING AND FOLLOWING: a wolf going to a carcass barks "follow"; his hungry mate
//    follows, and eats there
//  - STAYS BY ITS KILL: fed, a young wolf stays near the carcass (within 6 tiles), and eats from
//    it again once hungry, a deer in sight as there is
//  - FORAGING: a hungry deer in grazed-out land (grass only regrowing in sight) goes
//    looking and finds better
//  - WESTERMARCK (a hack for wolves): a wolf won't court a sister, but will one he met as
//    an infant
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, testStart, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({ simStart: testStart,
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
    var S = sim.internals;
    S.holdWater(true);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry land, 30 tiles each way, levelled
    var [i0, j0] = S.allLandTiles.find(([i, j]) => {
      for (let di = -30; di <= 30; di += 2) for (let dj = -30; dj <= 30; dj += 2) if (sim.getTerrainAt(i + di, j + dj) === "water") return false;
      return true;
    });
    var lv = sim.tileCorners(i0, j0)[0];
    for (let di = -32; di <= 32; di++) for (let dj = -32; dj <= 32; dj++) { S.setTileCorners(i0 + di, j0 + dj, [lv, lv, lv, lv]); S.setBoulder(i0 + di, j0 + dj, false); }
    var put = (a, x, y, hx = 1, hy = 0) => { a.gx = a.nextGX = i0 + x; a.gy = a.nextGY = j0 + y; a.speed = 0; a.stunnedUntil = 0; a.climbingUntil = -1;
      a.eating = false; S.setCritterIdle(a); a.hx = hx; a.hy = hy; };
    var away = a => { mind.ignore(a); sim.setIntent(a, null); a.gx = a.nextGX = a.gy = a.nextGY = -700 - a.uid * 3; a.speed = 0; };
    var run = s => { for (let n = 0; n < s / sim.tempo; n++) S.tick(); };
    // (the grown critters at the start, by species and sex, fixed: some are made young below)
    var adults = sim.allCritters.filter(a => sim.isGrown(a) && a !== sim.pcWolf);
    var grown = (sp, male, k = 0) => adults.filter(a => a.species === sp && a.isMale === male)[k];
    // a grown critter made young again: the age at which it can first do cap, times k, its body to match
    var makeYoung = (a, cap, k) => {
      let lo = 0, hi = sim.now - a.birthTime;
      for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; a.birthTime = sim.now - mid; if (sim.can(a, cap)) hi = mid; else lo = mid; }
      a.birthTime = sim.now - hi * k; S.setBodyByAge(a); a.mateUid = null;
      return a;
    };
    // a live grown deer not used before
    var usedDeer = new Set();
    var freshDeer = () => { const d = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a) && sim.isLiveCritter(a) && !usedDeer.has(a)); usedDeer.add(d); return d; };
    var kill = (d, x, y) => { put(d, x, y); S.setBody(d, d.adultKg, 1); S.startCritterDeath(d, "predation"); run(sim.deathDurationSBySpecies.deer + 0.1); };
  `, c);

  // BITING
  const bite = vm.runInContext(`(() => {
    const w = grown("wolf", true), out = {};
    const tryIt = (name, gait, each) => {
      const d = freshDeer();
      put(w, 0.5, 0.5); put(d, 4.5, 0.5); S.setFood(w, 0.5); w.stomach = S.biomass(); S.updateBody(w);
      sim.setIntent(w, { dx: 1, dy: 0, gait });
      let n = 0;
      for (; n < 3 / sim.tempo && sim.isLiveCritter(d) && w.gx < i0 + 6; n++) { if (each) each(w); S.tick(); }
      out[name] = { killed: !sim.isLiveCritter(d), pose: w.pose, x: +(w.gx - i0).toFixed(1) };
      sim.setIntent(w, null);
      if (sim.isLiveCritter(d)) away(d); else { d.gx = d.nextGX = d.gy = d.nextGY = -600 - d.uid * 3; }
    };
    tryIt("gallop", "gallop");
    tryIt("walk", "walk");
    // (its stomach kept full)
    tryIt("full", "gallop", w => { w.stomach = S.biomass(); w.stomach.proteinKg = S.stomachKg(w); S.updateBody(w); });
    const young = grown("wolf", false);
    const was = young.birthTime;
    makeYoung(young, "hunt", 0.9);
    const keepW = w;
    { // a young wolf, weaned, too young to hunt
      const d = freshDeer();
      put(young, 0.5, 0.5); put(d, 4.5, 0.5); S.setFood(young, 0.5);
      sim.setIntent(young, { dx: 1, dy: 0, gait: "gallop" });
      for (let n = 0; n < 3 / sim.tempo && sim.isLiveCritter(d) && young.gx < i0 + 6; n++) S.tick();
      out.young = { killed: !sim.isLiveCritter(d), pose: young.pose, weaned: sim.can(young, "wean"), hunts: sim.can(young, "hunt") };
      sim.setIntent(young, null); away(young); if (sim.isLiveCritter(d)) away(d);
    }
    away(keepW);
    return out;
  })()`, c);
  r.check(bite.gallop.killed && !bite.walk.killed && !bite.full.killed && !bite.young.killed && bite.young.weaned && !bite.young.hunts,
    `a wolf kills a deer only biting it: galloping at it, facing it (${bite.gallop.killed}); walking into it it doesn't (${bite.walk.killed}), ` +
    `nor with a full stomach (${bite.full.killed}), nor weaned but too young to hunt (${bite.young.killed})`);

  // a young wolf too young to hunt doesn't; old enough, it does
  const hunts = vm.runInContext(`(() => {
    const out = {};
    for (const [name, k, which] of [["dependent", 0.8, 1], ["old enough", 1.2, 3]]) {
      const y = grown("wolf", false, which), d = freshDeer();
      makeYoung(y, "hunt", k); y.parentUids = []; y.youngUids = [];
      put(y, 0.5, 0.5); put(d, 12.5, 0.5); S.setFood(y, 0.3); mind.ignore(d);
      mind.forget(y); mind.ignore(y, false);
      const modes = new Set();
      for (let n = 0; n < 4 / sim.tempo; n++) { S.tick(); modes.add(mind.stateOf(y).mode); }
      out[name] = { modes: [...modes], hunts: sim.can(y, "hunt") };
      away(y); if (sim.isLiveCritter(d)) away(d);
    }
    return out;
  })()`, c);
  const hunting = ms => ms.some(x => ["chase", "track", "prowl", "wait"].includes(x));
  r.check(!hunting(hunts.dependent.modes) && !hunts.dependent.hunts && hunts["old enough"].hunts && hunting(hunts["old enough"].modes),
    `a hungry young wolf, weaned but too young to hunt, doesn't hunt a deer 12 tiles off (${hunts.dependent.modes}); old enough, it does (${hunts["old enough"].modes})`);

  // SUPPORT FEEDING: a father takes a leg home for weaned young too young to hunt
  const leg = vm.runInContext(`(() => {
    const he = grown("wolf", true, 1), she = grown("wolf", false, 2), pup = makeYoung(grown("wolf", true, 2), "hunt", 0.6), d = freshDeer();
    S.pair(he, she); she.lastBredAt = sim.now;
    pup.parentUids = [she.uid, he.uid]; she.youngUids = [pup.uid]; he.youngUids = [pup.uid];
    put(she, -6.5, 0.5); put(pup, -7.5, 0.5); put(he, -4.5, 0.5);
    for (const a of [he, she, pup]) { mind.forget(a); mind.ignore(a, false); S.setFood(a, 0.95); }
    run(0.5); // (he sees them)
    kill(d, 6.5, 0.5);
    put(he, 5.5, 0.5); S.setFood(he, 0.6);
    mind.ignore(she); mind.ignore(pup); // (they stay where they are)
    let carried = false, n = 0;
    for (; n < 40 / sim.tempo && !carried; n++) { S.tick(); carried = !!he.carrying; S.setFood(she, 0.95); S.setFood(pup, 0.95); }
    const s = +(n * sim.tempo).toFixed(1);
    // then goes back for more: the legs he takes home in 90 s
    let legs = carried ? 1 : 0, was = carried;
    const modes = new Set();
    for (let k = 0; k < 90 / sim.tempo; k++) { S.tick(); if (!!he.carrying && !was) legs++; was = !!he.carrying; S.setFood(she, 0.95); S.setFood(pup, 0.95); modes.add(mind.stateOf(he).mode); }
    const out = { modes: [...modes], carried, s, legs, weaned: sim.can(pup, "wean"), hunts: sim.can(pup, "hunt") };
    [he, she, pup].forEach(away);
    return out;
  })()`, c);
  r.check(leg.carried && leg.weaned && !leg.hunts && leg.legs >= 2,
    `a father fed at a carcass takes a leg home while his young are weaned but too young to hunt (carrying after ${leg.s} s), ` +
    `and goes back for more (${leg.legs} legs in 90 s; ${leg.modes})`);

  // SUPPORT FEEDING: a male that knows his mate's den brings her a leg, no young yet
  const den = vm.runInContext(`(() => {
    const he = grown("wolf", true, 0), she = grown("wolf", false, 0), d = freshDeer();
    for (const a of [he, she]) { a.parentUids = []; a.youngUids = []; }
    S.pair(he, she);
    put(she, -6.5, 0.5); put(he, -4.5, 0.5);
    for (const a of [he, she]) { mind.forget(a); mind.ignore(a); S.setFood(a, 0.95); }
    she.pregnancy = { since: sim.now, dueAt: sim.now + 1e9, fatherUid: he.uid, litter: [], generation: 1 };
    mind.setDen(she, [she.gx, she.gy]);
    mind.ignore(he, false); mind.ignore(she, false);
    run(0.5); // (he sees her at it)
    const knows = !!mind.stateOf(he).den;
    kill(d, 6.5, 0.5);
    put(he, 5.5, 0.5); S.setFood(he, 0.6);
    mind.ignore(she); // (she stays at it)
    let dropped = false, n = 0;
    const modes = new Set();
    for (; n < 60 / sim.tempo && !dropped; n++) {
      S.tick(); S.setFood(she, 0.95); modes.add(mind.stateOf(he).mode);
      dropped = sim.allCorpses.some(c => c.morsel && Math.hypot(c.gx - she.gx, c.gy - she.gy) <= 2);
    }
    const out = { knows, dropped, s: +(n * sim.tempo).toFixed(1), modes: [...modes] };
    she.pregnancy = null;
    [he, she].forEach(away);
    return out;
  })()`, c);
  r.check(den.knows && den.dropped,
    `a male that knows his mate's den (${den.knows}), she pregnant there and no young yet, brings her a leg (put down by her ${den.dropped ? "after " + den.s + " s" : "never"}; ${den.modes})`);

  // PROWLING: a wolf with a den keeps to its range
  const range = vm.runInContext(`(() => {
    const he = grown("wolf", true, 1), she = grown("wolf", false, 1);
    for (const a of [he, she]) { a.parentUids = []; a.youngUids = []; }
    S.pair(he, she); away(she);
    put(he, 0.5, 0.5); mind.forget(he); mind.ignore(he, false);
    mind.setDen(he, [he.gx, he.gy]);
    const [hx, hy] = [he.gx, he.gy];
    let far = 0; const modes = new Set();
    for (let n = 0; n < 600 / sim.tempo; n++) {
      S.tick(); S.setFood(he, 0.5); S.setFood(she, 0.9); modes.add(mind.stateOf(he).mode);
      const d = Math.hypot(he.gx - hx, he.gy - hy);
      far = Math.max(far, d);
    }
    const out = { far: Math.round(far), modes: [...modes], tiles: mind.prowlHomeTiles };
    away(he);
    return out;
  })()`, c);
  r.check(range.modes.includes("prowl") && range.far > 150 && range.far <= range.tiles + 70,
    `a hungry wolf with a den, knowing of no deer, prowls (${range.modes}) but keeps to its range: ${range.far} tiles off at most in 10 min (range ${range.tiles})`);

  // LEADING AND FOLLOWING: going to a carcass she doesn't know of, he barks "follow"; she, hungry, follows and eats there
  const lead = vm.runInContext(`(() => {
    const he = grown("wolf", true, 0), she = grown("wolf", false, 0), d = freshDeer();
    for (const a of [he, she]) { a.parentUids = []; a.youngUids = []; mind.ignore(a); }
    S.pair(he, she);
    kill(d, 25.5, 0.5);
    put(he, 23.5, 0.5); mind.forget(he); mind.ignore(he, false); S.setFood(he, 1); run(0.5); // (he sees it)
    put(he, -1.5, 0.5, -1, 0); put(she, -3.5, 0.5, -1, 0); mind.forget(she); // (she knows nothing of it)
    S.setFood(he, 0.6); S.setFood(she, 0.6); mind.ignore(she, false);
    const barks = new Set(), modes = new Set();
    let ate = null, n = 0;
    for (; n < 60 / sim.tempo && ate === null; n++) {
      S.tick();
      if (sim.tickCount < he.barkUntil) barks.add(he.signal.kind);
      modes.add(mind.stateOf(she).mode);
      if (she.eating && Math.hypot(she.gx - d.gx, she.gy - d.gy) < 2) ate = +(n * sim.tempo).toFixed(1);
    }
    const out = { barks: [...barks], modes: [...modes], ate };
    [he, she].forEach(away);
    return out;
  })()`, c);
  r.check(lead.barks.includes("follow") && lead.modes.includes("follow") && lead.ate !== null,
    `going to a carcass 27 tiles off with his hungry mate by him, a wolf barks "follow" (${lead.barks}); she follows (${lead.modes}) and eats there (${lead.ate === null ? "never" : "after " + lead.ate + " s"})`);

  // STAYS BY ITS KILL
  const stay = vm.runInContext(`(() => {
    const w = grown("wolf", true, 2), d = freshDeer(), live = freshDeer();
    w.parentUids = []; w.youngUids = []; w.mateUid = null;
    kill(d, 0.5, 0.5);
    put(w, 1.5, 0.5); S.setFood(w, 0.6);
    mind.forget(w); mind.ignore(w, false);
    let far = 0, ate = false, n = 0;
    for (; n < 60 / sim.tempo; n++) { S.tick(); S.setFood(live, 1); if (w.food >= 0.95) break; }
    // fed: it stays by the carcass a minute
    const modes = new Set();
    for (let k = 0; k < 60 / sim.tempo; k++) { S.tick(); modes.add(mind.stateOf(w).mode); far = Math.max(far, Math.hypot(w.gx - d.gx, w.gy - d.gy)); }
    // hungry again, a deer in sight 15 tiles off: it eats from the carcass
    put(live, 0.5, 15.5); mind.ignore(live);
    S.setFood(w, 0.6); w.stomach = S.biomass(); S.updateBody(w);
    const meat0 = sim.carcassMeatKg(d), modes2 = new Set();
    for (let k = 0; k < 10 / sim.tempo; k++) { S.tick(); modes2.add(mind.stateOf(w).mode); }
    const out = { far: +far.toFixed(1), modes: [...modes], ate: sim.carcassMeatKg(d) < meat0, modes2: [...modes2], deerAlive: sim.isLiveCritter(live) };
    [w].forEach(away); away(live);
    return out;
  })()`, c);
  r.check(stay.far <= 6.5 && stay.modes.includes("kill") && stay.ate && stay.deerAlive,
    `fed, a wolf stays by its kill a minute (within ${stay.far} tiles; ${stay.modes}); hungry again, a deer 15 tiles off, it eats from the carcass (${stay.ate}; ${stay.modes2}), the deer left alive`);

  // FORAGING: a hungry deer in grazed-out land goes looking for grass
  const forage = vm.runInContext(`(() => {
    const d = freshDeer(), H = sim.gridHeightN;
    for (let di = -60; di <= 60; di++) for (let dj = -60; dj <= 60; dj++) {
      if (sim.getTerrainAt(i0 + di, j0 + dj) === "grass") S.setGrassKg((i0 + di) * H + j0 + dj, 0);
      if (sim.undergrowthAt(i0 + di, j0 + dj)) S.setUndergrowthKg(i0 + di, j0 + dj, 0);
    }
    put(d, 0.5, 0.5); S.setFood(d, 0.35); d.stomach = S.biomass(); S.updateBody(d); mind.forget(d); mind.ignore(d, false);
    const modes = new Set(); let ate = false, n = 0;
    for (; n < 180 / sim.tempo && !ate; n++) { S.tick(); modes.add(mind.stateOf(d).mode); ate = d.eating && Math.max(Math.abs(d.gx - i0), Math.abs(d.gy - j0)) > 60;
}
    const out = { ate, s: +(n * sim.tempo).toFixed(0), modes: [...modes] };
    away(d);
    return out;
  })()`, c);
  r.check(forage.ate && forage.modes.includes("forage"),
    `a hungry deer in grazed-out land, the grass in sight only regrowing, goes looking and finds better (eating beyond it ${forage.ate ? "after " + forage.s + " s" : "never"}; ${forage.modes})`);

  // WESTERMARCK (a HACK for wolves): a wolf won't court a sibling, but will one met as an infant
  const kin = vm.runInContext(`(() => {
    // (grown again, any of them made young above)
    const still = male => adults.filter(a => a.species === "wolf" && a.isMale === male && sim.isLiveCritter(a)).map(a => { a.birthTime = sim.now - 1e7; return makeYoung(a, "mate", 1.5); });
    const he = still(true)[0], [sis, other] = still(false);
    for (const a of [he, sis, other]) { const p = S.critterByUid.get(a.mateUid); if (p) p.mateUid = null; a.mateUid = null; a.youngUids = []; mind.forget(a); mind.ignore(a); S.setFood(a, 1); }
    he.parentUids = [9999]; sis.parentUids = [9999]; other.parentUids = [9998];
    mind.setFamiliar(he, other.uid);
    put(he, 0.5, 0.5); put(sis, 3.5, 0.5, -1, 0); mind.ignore(he, false);
    const courts = w => { for (let n = 0; n < 10 / sim.tempo; n++) { S.tick(); if (mind.stateOf(he).court?.uid === w.uid) return true; } return false; };
    const toSis = courts(sis);
    away(sis); put(other, 3.5, 0.5, -1, 0);
    const toOther = courts(other);
    [he, other].forEach(away);
    for (const a of [he, sis, other]) a.parentUids = [];
    return { toSis, toOther, n: [he, sis, other].filter(Boolean).length };
  })()`, c);
  r.check(kin.n === 3 && !kin.toSis && kin.toOther,
    `a wolf doesn't court his sister (${kin.toSis}), but courts one he met as an infant, not kin (${kin.toOther})`);
}

module.exports = { name: "wolves living off deer", main, slow: true };
if (require.main === module) runStandalone(module.exports.name, main);
