// A wolf litter's survival (PUPS STAY PUT, BROODING, CALLS and DENS in mind.js; BARKING in
// sim.js; BARKS in senses.js; GAMIFIED's infant hunger in sim.js), on open land, by day:
//  - an infant's full meter lasts gameInfantHungerSlowdown times its scaled time, never
//    longer than an adult's; it burns that slowly, and no biomass is made or lost
//  - a pup too young to walk, its mother out of its senses, stays put (doesn't crawl to
//    where it last knew her, and doesn't take her as lost); hungry, it whimpers
//  - its mother, 20 tiles off and thirsty, goes for water while it is quiet; it whimpering,
//    she hears it and comes back to it first, and it suckles
//  - she goes back to a pup she had lost track of, where she knew it to be
//  - away from the litter half an infant's full meter, she goes back before drinking;
//    badly thirsty, she drinks first
//  - a parent calls ("come") a walking youngster it has lost; the youngster, 60 tiles off
//    out of sight, hears it and comes; a paired wolf calls a mate it hasn't perceived
//  - a whimper carries less far than a bark
//  - DENS: knowing fresh water only 300 tiles off, a pregnant female picks no den but
//    heads for it; within denWaterTiles of it she picks one within that of it
//  - (litterlife.test.js, slow) a litter born at a den, with water 100 tiles off, lives
//    to walk (the mother's meter kept up, as if fed)
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, testStart, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({ simStart: testStart,
    console: { log() {}, info() {}, warn() {}, error() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r, survive = false) {
  const c = load();
  c.survive = survive;
  const res = vm.runInContext(`(() => {
    const S = sim.internals, out = {};
    S.holdWater(true); S.holdClock(12);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry land, 100 tiles each way along i and 12 across, levelled and cleared
    const [i0, j0] = S.allLandTiles.find(([i, j]) => {
      if (i % 4 || j % 4) return false;
      for (let di = -100; di <= 100; di += 3) for (let dj = -12; dj <= 12; dj += 3) if (sim.getTerrainAt(i + di, j + dj) === "water") return false;
      return true;
    });
    const lv = sim.tileCorners(i0, j0)[0];
    for (let di = -102; di <= 102; di++) for (let dj = -14; dj <= 14; dj++) { S.setTileCorners(i0 + di, j0 + dj, [lv, lv, lv, lv]); S.setBoulder(i0 + di, j0 + dj, false); }
    const put = (a, x, y) => { a.gx = a.nextGX = i0 + x; a.gy = a.nextGY = j0 + y; a.speed = 0; a.stunnedUntil = 0; S.setCritterIdle(a); };
    const away = a => { mind.ignore(a); a.gx = a.nextGX = a.gy = a.nextGY = -700 - a.uid * 3; a.speed = 0; };
    const grownOf = male => sim.allCritters.filter(a => a.species === "wolf" && sim.isGrown(a) && a.isMale === male && a !== sim.pcWolf);
    const F = grownOf(false), Mm = grownOf(true); // (picked now: made young, one is no longer grown)
    const grown = (male, k = 0) => (male ? Mm : F)[k];
    const net = () => S.worldBiomassKg() - S.ledgerNetKg();
    const dist = (a, b) => Math.hypot(a.gx - b.gx, a.gy - b.gy);
    const setWater = (a, w) => {
      let lo = 0, hi = a.tissues.waterKg, full = hi;
      for (let n = 0; n < 50; n++) { const mid = (lo + hi) / 2; a.tissues.waterKg = mid; S.updateBody(a); if (a.water < w) lo = mid; else hi = mid; }
    };

    // 1. the infant meter
    {
      const G = S.SPEEDS, k = S.GAMIFIED.foodFullS.wolf / S.REALISTIC.foodFullS.wolf;
      out.meter = {};
      for (const sp of ["wolf", "deer"]) out.meter[sp] = { s: G.infantFoodFullS[sp], scaled: S.REALISTIC.infantFoodFullS[sp] * k, adult: G.foodFullS[sp] };
    }

    // a litter: born to her where she stands, his
    const she = grown(false), he = grown(true);
    S.pair(he, she); put(she, 0.5, 0.5); put(he, -40.5, 10.5); S.setFood(she, 1);
    she.lastBredAt = sim.now; S.conceive(she, he); she.pregnancy.dueAt = sim.now + 1;
    for (let n = 0; n < 5 / sim.tempo && !she.youngUids.length; n++) S.tick();
    const pups = she.youngUids.map(uid => S.critterByUid.get(uid));
    const pup = pups[0];
    out.born = pups.length;
    mind.ignore(he);

    // burning slowly; no biomass made
    {
      const f0 = 0.9; S.setFood(pup, f0); const n0 = net();
      const t0 = sim.now;
      for (let n = 0; n < 10 / sim.tempo; n++) S.tick();
      out.burn = { rate: (f0 - pup.food) / (sim.now - t0), expect: 1 / S.SPEEDS.infantFoodFullS.wolf, astray: Math.abs(net() - n0) };
    }

    // 2. stays put; whimpers; 3. she hears and comes; it suckles
    {
      pups.forEach(p => { mind.forget(p); mind.ignore(p, false); S.setFood(p, 1); });
      put(pup, 0.5, 0.5); pups.slice(1).forEach((p, k) => put(p, 60.5 + k, 8.5)); // (the others well off)
      mind.forget(she); put(she, 0.5, 2.5); mind.ignore(she, false);
      for (let n = 0; n < 1 / sim.tempo; n++) S.tick(); // (they know each other)
      mind.ignore(she); put(she, 20.5, 0.5); she.hx = 1; she.hy = 0;
      S.setFood(pup, 0.5);
      const at = [pup.gx, pup.gy];
      let whimpered = false, moved = 0;
      for (let n = 0; n < 20 / sim.tempo; n++) {
        S.tick();
        moved = Math.max(moved, Math.hypot(pup.gx - at[0], pup.gy - at[1]));
        if (sim.tickCount < pup.barkUntil && pup.signal.kind === "whimper") whimpered = true;
      }
      const k = mind.stateOf(pup).known.find(k => k.uid === she.uid);
      out.stay = { moved: +moved.toFixed(2), lost: !!(k && k.lost), whimpered };
      // she, 20 tiles off facing away and thirsty, goes for water while the pup is fed and
      // quiet; hungry, it whimpers: she hears it and comes back to it first
      S.holdWater(false); mind.knowShore(she, i0 + 100, j0);
      const thirsty = () => { mind.ignore(she); put(she, 20.5, 0.5); she.hx = 1; she.hy = 0; S.setFood(she, 1); setWater(she, 0.7); mind.ignore(she, false); };
      thirsty(); S.setFood(pup, 1);
      const quiet = new Set();
      for (let n = 0; n < 3 / sim.tempo; n++) { S.tick(); if (n > 0.5 / sim.tempo) quiet.add(mind.stateOf(she).mode); }
      thirsty(); S.setFood(pup, 0.5);
      let heard = null, back = null, suckled = false, modes = new Set();
      for (let n = 0; n < 60 / sim.tempo && !suckled; n++) {
        S.tick();
        const kp = mind.stateOf(she).known.find(k => k.uid === pup.uid);
        if (heard === null && kp && kp.by === "hearing" && kp.call && kp.call.kind === "whimper") heard = +(n * sim.tempo).toFixed(1);
        if (back === null && dist(she, pup) < 3) back = +(n * sim.tempo).toFixed(1);
        modes.add(mind.stateOf(she).mode);
        if (pup.nursingOn === she.uid) suckled = true;
      }
      out.heard = { heard, back, suckled, modes: [...modes], quiet: [...quiet] };
      S.holdWater(true); setWater(she, 1);
    }

    // she goes back to a pup she had lost track of, where she knew it to be
    {
      S.setFood(pup, 1); mind.ignore(she); put(she, 30.5, 0.5);
      mind.ignore(she, false);
      let back = null;
      mind.markLost(she, pup.uid); // (as if she had looked for it and not found it)
      for (let n = 0; n < 40 / sim.tempo && back === null; n++) { S.tick(); if (dist(she, pup) <= 3) back = +(n * sim.tempo).toFixed(1); }
      out.lostBack = back;
    }

    // 4. away too long: back before drinking; badly thirsty, drinks first
    {
      mind.knowShore(she, i0 + 100, j0);
      const trip = water => {
        S.holdWater(false); mind.ignore(she); put(she, 60.5, 0.5); S.setFood(she, 1); S.setFood(pup, 1); setWater(she, water);
        mind.ignore(she, false);
        mind.awayFromLitter(she, 1e9);
        let modes = new Set(), closest = Infinity;
        for (let n = 0; n < 8 / sim.tempo; n++) { S.tick(); if (n > 0.5 / sim.tempo) modes.add(mind.stateOf(she).mode); closest = Math.min(closest, dist(she, pup)); }
        return { modes: [...modes], nearer: closest < 59 };
      };
      out.tripLong = trip(0.7);
      out.tripThirsty = trip(0.2);
      S.holdWater(true); setWater(she, 1);
    }

    // 5. CALLS: a parent calls a walking youngster it has lost; it hears and comes
    {
      const mom = grown(false, 1), kid = grown(false, 2);
      const old = kid.parentUids; kid.parentUids = [mom.uid]; mom.youngUids.push(kid.uid);
      let lo = 0, hi = sim.now - kid.birthTime;
      for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; kid.birthTime = sim.now - mid; if (sim.can(kid, "wean")) hi = mid; else lo = mid; }
      kid.birthTime = sim.now - hi * 1.5; S.setBodyByAge(kid); kid.mateUid = null;
      put(mom, -20.5, 0.5); put(kid, -18.5, 0.5);
      for (const a of [mom, kid]) { mind.forget(a); mind.ignore(a, false); S.setFood(a, 1); }
      for (let n = 0; n < 1 / sim.tempo; n++) S.tick();
      put(kid, 40.5, 0.5); kid.hx = 1; kid.hy = 0; mom.hx = -1; mom.hy = 0;
      mind.markLost(mom, kid.uid);
      let called = null, heard = null, closest = Infinity;
      for (let n = 0; n < 40 / sim.tempo; n++) {
        S.tick();
        if (called === null && sim.tickCount < mom.barkUntil && mom.signal.kind === "come") called = +(n * sim.tempo).toFixed(1);
        const k = mind.stateOf(kid).known.find(k => k.uid === mom.uid);
        if (heard === null && k && k.by === "hearing" && k.call && k.call.kind === "come") heard = true;
        closest = Math.min(closest, dist(mom, kid));
      }
      out.come = { called, heard, from: 60, closest: +closest.toFixed(1) };
      // a paired wolf calls a mate it hasn't perceived in callAfterS
      mind.ignore(she); mind.ignore(mom); mind.ignore(kid);
      const m2 = grown(true, 1), f2 = grown(false, 3);
      S.pair(m2, f2); put(m2, -80.5, -8.5); put(f2, -78.5, -8.5);
      for (const a of [m2, f2]) { mind.forget(a); mind.ignore(a, false); S.setFood(a, 1); }
      for (let n = 0; n < 1 / sim.tempo; n++) S.tick();
      mind.ignore(f2); put(f2, -900, -900);
      let mateCall = null;
      for (let n = 0; n < 40 / sim.tempo && mateCall === null; n++) { S.tick(); if (sim.tickCount < m2.barkUntil && m2.signal.kind === "come") mateCall = +(n * sim.tempo).toFixed(1); }
      out.mateCall = mateCall;
      [mom, kid, m2, f2].forEach(away); kid.parentUids = old; mom.youngUids.pop();
    }
    out.ranges = { bark: senses.barkHeardTiles, whimper: senses.whimperHeardTiles, detect: senses.detectTiles };

    // DENS near water
    {
      const f3 = grown(false, 1), m3 = grown(true, 2);
      S.pair(m3, f3); put(f3, -60.5, 0.5); put(m3, -60.5, 4.5);
      for (const a of [m3, f3]) { mind.forget(a); S.setFood(a, 1); }
      f3.lastBredAt = sim.now; S.conceive(f3, m3); f3.pregnancy.dueAt = sim.now + 1e6;
      mind.ignore(m3); mind.ignore(f3, false);
      // fresh water known only 300 tiles off, beyond the levelled land (east, past i0 + 100)
      mind.knowShore(f3, i0 + 240, j0);
      let modes = new Set(), start = f3.gx;
      for (let n = 0; n < 5 / sim.tempo; n++) { S.tick(); modes.add(mind.stateOf(f3).mode); }
      out.denFar = { den: mind.stateOf(f3).den, modes: [...modes], east: +(f3.gx - start).toFixed(1) };
      mind.ignore(f3); mind.forget(f3); put(f3, -60.5, 0.5); mind.ignore(f3, false);
      mind.knowShore(f3, i0 + 80, j0);
      for (let n = 0; n < 3 / sim.tempo; n++) S.tick();
      const den = mind.stateOf(f3).den;
      out.denNear = den && Math.hypot(den[0] - (i0 + 80), den[1] - j0);
      [m3, f3].forEach(away);
    }

    // a litter born at a den, with water 100 tiles off, lives to walk (slow: litterlife.test.js)
    if (survive) {
      pups.forEach(p => { mind.forget(p); mind.ignore(p, false); S.setFood(p, 1); });
      pups.forEach((p, k) => put(p, 0.5 + (k % 3) * 0.6, 0.5 + Math.floor(k / 3) * 0.6));
      mind.forget(she); put(she, 0.5, 1.5); mind.ignore(she, false); mind.knowShore(she, i0 + 100, j0);
      S.holdWater(false);
      const walkS = Math.max(...pups.map(p => S.SPEEDS.lifeStageAgesS.wolf.walk.max - (sim.now - p.birthTime)));
      let n = 0, lowest = 1, drank = false, farthest = 0;
      const steps = walkS / sim.tempo;
      for (; n < steps && pups.every(sim.isLiveCritter); n++) {
        S.tick();
        if (n % 60 === 0) { if (she.food < 0.6) S.setFood(she, 1); lowest = Math.min(lowest, ...pups.map(p => p.food)); }
        if (mind.stateOf(she).mode === "drink" && sim.waterInReach(she)) drank = true;
        farthest = Math.max(farthest, dist(she, pup));
      }
      out.survive = { s: +(n * sim.tempo).toFixed(0), of: +walkS.toFixed(0), alive: pups.filter(sim.isLiveCritter).length, of2: pups.length,
        walk: pups.every(p => sim.can(p, "walk")), lowest: +lowest.toFixed(2), drank, farthest: +farthest.toFixed(0) };
    }
    return out;
  })()`, c);

  const M = res.meter;
  r.check(["wolf", "deer"].every(sp => Math.abs(M[sp].s - Math.min(4 * M[sp].scaled, M[sp].adult)) < 1e-6 && M[sp].s <= M[sp].adult && M[sp].s > 2 * M[sp].scaled),
    `an infant's full meter lasts 4 times its scaled time, no longer than an adult's (wolf ${M.wolf.s.toFixed(0)} s of scaled ${M.wolf.scaled.toFixed(0)}, adult ${M.wolf.adult.toFixed(0)}; deer ${M.deer.s.toFixed(0)} of ${M.deer.scaled.toFixed(0)}, adult ${M.deer.adult.toFixed(0)})`);
  r.check(Math.abs(res.burn.rate / res.burn.expect - 1) < 0.05 && res.burn.astray < 1e-6,
    `a pup's meter falls that slowly (${(res.burn.rate * 1000).toFixed(3)} vs ${(res.burn.expect * 1000).toFixed(3)} per 1000 s), no biomass made or lost (${res.burn.astray.toExponential(1)} kg); litter ${res.born}`);
  r.check(res.stay.moved < 0.5 && !res.stay.lost && res.stay.whimpered,
    `a pup too young to walk, its mother out of its senses, stays put (moved ${res.stay.moved} tiles), doesn't take her as lost (${res.stay.lost}), and hungry, whimpers (${res.stay.whimpered})`);
  r.check(res.heard.quiet.includes("drink") && !res.heard.quiet.includes("brood") && res.heard.heard !== null && res.heard.back !== null && res.heard.suckled && res.heard.modes.includes("brood"),
    `its mother, 20 tiles off facing away and thirsty, goes for water while it is quiet (${res.heard.quiet}); it whimpering, she hears it (after ${res.heard.heard} s), comes back first (${res.heard.back} s; ${res.heard.modes}), and it suckles (${res.heard.suckled})`);
  r.check(res.lostBack !== null, `she goes back to a pup she had lost track of, where she knew it (within 3 tiles in ${res.lostBack} s)`);
  r.check(res.tripLong.nearer && res.tripLong.modes.includes("brood") && !res.tripLong.modes.includes("drink"),
    `away from the litter too long, she heads back before drinking (${res.tripLong.modes}), but badly thirsty she drinks first (${res.tripThirsty.modes})`);
  r.check(res.tripThirsty.modes.includes("drink") && !res.tripThirsty.modes.includes("brood"), `...badly thirsty: ${res.tripThirsty.modes}`);
  r.check(res.come.called !== null && res.come.heard && res.come.closest < 20,
    `a parent calls ("come") a walking youngster it has lost (after ${res.come.called} s); the youngster, ${res.come.from} tiles off, hears it (${res.come.heard}) and comes (within ${res.come.closest})`);
  r.check(res.mateCall !== null, `a paired wolf calls a mate it hasn't perceived lately (after ${res.mateCall} s)`);
  r.check(res.ranges.whimper[0] < res.ranges.bark[0] && res.ranges.whimper[1] < res.ranges.bark[1] && res.ranges.bark[1] <= res.ranges.detect,
    `a whimper carries less far than a bark (${res.ranges.whimper} vs ${res.ranges.bark} tiles), and a bark within the grid's ${res.ranges.detect}`);
  r.check(!res.denFar.den && res.denFar.modes.includes("den") && res.denFar.east > 2,
    `knowing fresh water only 300 tiles off, a pregnant female picks no den (${JSON.stringify(res.denFar.den)}) but heads for it (${res.denFar.east} tiles east; ${res.denFar.modes})`);
  r.check(res.denNear !== null && res.denNear <= 200, `within reach of it, she picks a den within 200 tiles of it (${res.denNear && res.denNear.toFixed(0)})`);
  const V = res.survive;
  if (V) r.check(V.alive === V.of2 && V.walk,
    `a litter born at a den, water 100 tiles off, lives to walk: ${V.alive} of ${V.of2} alive after ${V.s} s of ${V.of} (all walk ${V.walk}; lowest meter ${V.lowest}; she drank ${V.drank}, went ${V.farthest} tiles off)`);
}

module.exports = { name: "litter survival (wolves)", main: (browser, r) => main(browser, r), run: main };
if (require.main === module) runStandalone(module.exports.name, main);
