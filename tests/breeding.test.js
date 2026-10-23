// Breeding (see BREEDING in sim.js, MATES AND FAMILY in mind.js, YOUNG STAGES and HEARTS
// in animat.js):
//  - every critter is male or female; every critter has a lifespan,
//    newborns too, so all die in the end
//  - weight grows from birth to the sex's adult weight; the young are drawn from 4
//    shrunk sheets by size, the grown from the adult's
//  - two unpaired grown critters of opposite sexes court and mate: they stand facing each
//    other while a heart rises between them, then are a pair, and the male keeps near her
//  - Westermarck: those met while either was an infant never court
//  - pairs are faithful until death; the widowed pair again, and the new partner adopts
//    the young
//  - a female in heat mated by a fertile male conceives; gestation, litter size, the
//    oldest fertile age and one breeding a year are kept; the litter is born beside her,
//    can't walk until old enough, and nurses from her
//  - unweaned pups don't hunt

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 800, height: 600 } });
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 8, clearOthers: true });
  // In the page: stage(...) brings critters (by species and sex) to the open land, grown,
  // fed and unpaired, all others far off and left alone.
  await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    window.home = [w.gx, w.gy];
    w.gx = w.nextGX = 5; w.gy = w.nextGY = 5; mind.ignore(w);
    window.grownAge = sp => S.SPEEDS.lifeStageAgesS[sp].mate.avg * 1.5;
    // fetch(...) brings more, leaving the rest as they are.
    window.fetch = (...specs) => specs.map(([sp, male, dx, dy]) => {
      const c = sim.allCritters.find(c => c.species === sp && c.isMale === male && c !== w && c.gx < 0 && sim.isLiveCritter(c));
      S.critterByUid.forEach(o => { if (o.mateUid === c.uid) o.mateUid = null; });
      Object.assign(c, { mateUid: null, pregnancy: null, lastBredAt: -Infinity, parentUids: [], youngUids: [],
        food: 1, speed: 0, stunnedUntil: 0, lifespanS: 1e9, birthTime: sim.now - grownAge(sp) });
      S.updateWeight(c);
      c.gx = c.nextGX = home[0] + dx; c.gy = c.nextGY = home[1] + dy;
      S.setCritterIdle(c); mind.forget(c); mind.ignore(c, false);
      return c;
    });
    window.stage = (...specs) => {
      sim.allCritters.forEach(c => { if (c !== w) { c.gx = c.nextGX = c.gy = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c); } });
      sim.allCorpses.forEach(c => { c.gx = c.nextGX = c.gy = c.nextGY = -50 - c.uid * 3; }); // (from earlier checks)
      return fetch(...specs);
    };
    window.runUntil = (cond, maxS) => { let n = 0; while (n < maxS / sim.tempo && !cond()) { S.tick(); n++; } return n * sim.tempo; };
  });

  // sexes and lifespans
  const sexes = await p.evaluate(() => {
    const by = sp => sim.allCritters.filter(c => c.species === sp);
    return { ok: sim.allCritters.every(c => typeof c.isMale === "boolean"),
      both: ["wolf", "deer"].every(sp => by(sp).some(c => c.isMale) && by(sp).some(c => !c.isMale)),
      lifespans: sim.allCritters.every(c => c.lifespanS > 0 && isFinite(c.lifespanS)) };
  });
  r.check(sexes.ok && sexes.both, "every critter is male or female, and both are found in each species");
  r.check(sexes.lifespans, "every critter, the player's wolf too, has a lifespan, at which it dies of age (see mortality.test.js)");

  // growth
  const growth = await p.evaluate(() => {
    const S = sim.internals, out = {};
    for (const sp of ["wolf", "deer"]) {
      const ages = S.SPEEDS.growthAgesS[sp], last = ages[ages.length - 1];
      const ws = [];
      for (let k = 0; k <= 40; k++) ws.push(S.growthShare(sp, last * k / 40));
      out[sp] = { start: ws[0], end: ws[40], rising: ws.every((x, k) => k === 0 || x >= ws[k - 1]) };
    }
    const b = S.bodyKgBySpecies.wolf, month = S.SPEEDS.growthAgesS.wolf[1];
    out.wolf3mo = [b.female, b.male].map(adult => b.birth + (adult - b.birth) * S.growthShare("wolf", 3 * month));
    // stages by share of adult weight
    const fake = share => animat.youngStage({ weightKg: share, adultKg: 1 });
    out.stages = [0.01, 0.1, 0.2, 0.5, 0.9, 1].map(fake);
    return out;
  });
  r.check(["wolf", "deer"].every(sp => growth[sp].start === 0 && growth[sp].end === 1 && growth[sp].rising)
    && growth.wolf3mo[0] > 7 && growth.wolf3mo[1] < 11,
    `weight grows steadily from birth weight to adult weight (a wolf pup at 3 months: ${growth.wolf3mo.map(x => x.toFixed(1)).join(" / ")} kg, female / male)`);
  r.check(growth.stages.join() === "1,2,3,4,0,0",
    `the young are drawn from 4 shrunk sheets by size, the grown from the adult's (stages by weight share: ${growth.stages.join(" ")})`);
  const images = await p.evaluate(async () => {
    const names = ["wolf-land", "wolf-swim", "hind-land", "hind-swim", "hind-death", "hind-carcass"];
    const urls = names.flatMap(n => [1, 2, 3, 4].map(k => `./images/young/${n}-stage${k}.png`)).concat(["./images/heart.png"])
      .concat(names.slice(2).map(n => `./images/${n}.png`));
    const sizes = await Promise.all(urls.map(u => new Promise(res => {
      const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = u;
    })));
    return { n: urls.length, loaded: sizes.filter(x => x > 0).length };
  });
  r.check(images.loaded === images.n, `every young sheet, the antlerless sheets and the heart load (${images.loaded} of ${images.n})`);

  // antlers: only on stags old enough to breed
  const antlers = await p.evaluate(() => {
    const S = sim.internals, mate = S.SPEEDS.lifeStageAgesS.deer.mate.avg;
    const [stag, hind, young, calf] = stage(["deer", true, -3, 0], ["deer", false, 0, 0], ["deer", true, 3, 0], ["deer", true, 0, 3]);
    young.birthTime = sim.now - mate * 0.97; S.updateWeight(young); // full size, not quite old enough
    calf.birthTime = sim.now - mate * 0.2; S.updateWeight(calf);
    [stag, hind, young, calf].forEach(c => mind.ignore(c));
    S.tick(); animat.render();
    const cls = c => animat.spriteEl(c).className;
    const bg = c => getComputedStyle(animat.spriteEl(c)).backgroundImage.split("/").pop();
    const out = { stag: [cls(stag), bg(stag)], hind: [cls(hind), bg(hind)], young: [cls(young), bg(young)],
      calf: [cls(calf), bg(calf)], youngStage: animat.youngStage(young) };
    // the young stag dies a second short of breeding age: its corpse stays antlerless (its
    // age stopped at its death)
    young.birthTime = sim.now - (mate - 1); S.updateWeight(young);
    S.startCritterDeath(young);
    for (let k = 0; k < 5 / sim.tempo; k++) S.tick();
    animat.render();
    out.corpse = [animat.spriteEl(young).style.backgroundImage.split("/").pop(), sim.isGrown(young)];
    return out;
  });
  r.check(antlers.stag[0] === "critter deer" && /deer-land\.png/.test(antlers.stag[1])
    && antlers.hind[0] === "critter deer hind" && /hind-land\.png/.test(antlers.hind[1])
    && antlers.young[0] === "critter deer hind" && antlers.youngStage === 0 && /hind-land\.png/.test(antlers.young[1])
    && /^hind-land-stage\d\.png/.test(antlers.calf[1]),
    `antlers only on a stag old enough to breed: stag ${antlers.stag[1]}, hind ${antlers.hind[1]}, ` +
    `full-grown stag not yet old enough ${antlers.young[1]}, calf ${antlers.calf[1]}`);
  r.check(antlers.corpse[0].includes("hind-carcass.png") && !antlers.corpse[1],
    `a young stag's carcass is antlerless too, its age stopped at death (${antlers.corpse[0].replace(/"\).*$/, "")})`);

  // courting and mating
  const court = await p.evaluate(() => {
    const [m, f] = stage(["deer", true, -2, 0], ["deer", false, 2, 1]);
    animat.setZoom(4); animat.centerCameraOn(...home);
    const t = runUntil(() => m.pose === "mate" && f.pose === "mate", 30);
    for (let k = 0; k < 30; k++) sim.internals.tick();
    animat.render();
    const top0 = parseFloat(animat.heartEl(m)?.style.top);
    for (let k = 0; k < 60; k++) sim.internals.tick();
    animat.render();
    const top1 = parseFloat(animat.heartEl(m)?.style.top);
    const heartZ = +animat.heartEl(m)?.style.zIndex;
    const face = c => sim.getDir((c === m ? f : m).gx - c.gx, (c === m ? f : m).gy - c.gy);
    const facing = [m, f].every(c => c.currentDirection === face(c));
    const cls = animat.spriteEl(m).className;
    const tEnd = runUntil(() => m.pose !== "mate", 10);
    const paired = m.mateUid === f.uid && f.mateUid === m.uid;
    const pregnant = !!f.pregnancy;
    animat.render();
    const heartGone = !animat.heartEl(m);
    // the male keeps near her as she wanders
    let farthest = 0, near = 0, n = 0;
    for (let k = 0; k < 60 / sim.tempo; k++) {
      sim.internals.tick();
      if (k < 10 / sim.tempo) continue;
      const d = Math.hypot(m.gx - f.gx, m.gy - f.gy);
      farthest = Math.max(farthest, d); n++; if (d < 9) near++;
    }
    window.deerPair = [m, f];
    return { t, top0, top1, heartZ, z: Math.max(+animat.spriteEl(m).style.zIndex, +animat.spriteEl(f).style.zIndex),
      facing, cls, tEnd, paired, pregnant, heartGone, farthest, nearShare: near / n };
  });
  r.check(court.t < 30 && court.facing && court.cls.startsWith("critter deer"),
    `an unpaired stag and hind court and mate within ${court.t.toFixed(1)} s, standing facing each other`);
  r.check(court.top1 < court.top0 && court.heartZ > court.z && court.heartGone,
    `a heart rises between them (top ${court.top0} -> ${court.top1} px), drawn above both, gone when they are done`);
  r.check(court.paired && court.pregnant && court.tEnd > 1 && court.tEnd < 4,
    `after the ${(court.tEnd + 1.5).toFixed(1)} s act they are a pair, and she has conceived`);
  r.check(court.farthest < 16 && court.nearShare > 0.8,
    `a pair keeps together (the male near her, she not far from him): over a minute, within 9 tiles ${(court.nearShare * 100).toFixed(0)}% of the time, always well in sight (${court.farthest.toFixed(1)} at most)`);

  // Westermarck
  const wester = await p.evaluate(() => {
    const S = sim.internals;
    const [m, f] = stage(["deer", true, -2, 0], ["deer", false, 2, 1]);
    f.birthTime = sim.now; S.updateWeight(f); // she is an infant when they meet
    runUntil(() => false, 1);
    const familiar = mind.stateOf(m).familiar.includes(f.uid) && mind.stateOf(f).familiar.includes(m.uid);
    f.birthTime = sim.now - grownAge("deer"); S.updateWeight(f); // grown up
    f.gx = f.nextGX = m.gx + 2; f.gy = f.nextGY = m.gy;
    let mated = false;
    runUntil(() => (mated = mated || m.pose === "mate"), 30);
    // a stranger she never met as an infant
    f.gx = f.nextGX = home[0] + 1; f.gy = f.nextGY = home[1];
    const [m2] = fetch(["deer", true, -2, 1]);
    mind.ignore(m);
    m.gx = m.nextGX = m.gy = m.nextGY = -400;
    const t = runUntil(() => f.mateUid === m2.uid, 30);
    return { familiar, mated, strangerPaired: f.mateUid === m2.uid, t };
  });
  r.check(wester.familiar && !wester.mated, "critters that met while one was an infant remember it, and never mate once grown");
  r.check(wester.strangerPaired, `...while one she never met as an infant pairs with her (in ${wester.t.toFixed(1)} s)`);

  // fidelity, widowhood, adoption
  const faith = await p.evaluate(() => {
    const S = sim.internals;
    const [m, f, m2, pup] = stage(["wolf", true, -2, 0], ["wolf", false, 0, 1], ["wolf", true, 2, 2], ["wolf", false, -3, 3]);
    S.pair(m, f);
    f.lastBredAt = sim.now; // not in heat: no reason to mate
    // her pup from before
    pup.birthTime = sim.now - S.SPEEDS.lifeStageAgesS.wolf.mate.avg / 3; S.updateWeight(pup);
    pup.parentUids = [f.uid]; f.youngUids = [pup.uid];
    let strayed = false;
    runUntil(() => (strayed = strayed || m2.pose === "mate" || f.matingWith === m2.uid), 10);
    const canStray = S.canPair(f, m2);
    m2.gx = m2.nextGX = f.gx + 2; m2.gy = m2.nextGY = f.gy; // (he may have wandered off)
    const mUid = m.uid;
    m.lifespanS = 0; sim.internals.tick(); // dies of age
    const widowed = f.mateUid === null && m.pose === "death";
    const t = runUntil(() => f.mateUid === m2.uid, 40);
    return { strayed, canStray, widowed, repaired: f.mateUid === m2.uid && m2.mateUid === f.uid, t,
      adopted: pup.parentUids.includes(m2.uid) && m2.youngUids.includes(pup.uid), mUid };
  });
  r.check(!faith.strayed && !faith.canStray, "a paired female and another unpaired male never mate (pairs are faithful)");
  r.check(faith.widowed && faith.repaired,
    `when her partner dies she is free, and pairs with the other male (in ${faith.t.toFixed(1)} s)`);
  r.check(faith.adopted, "...who adopts her pup from her first partner");

  // conception, gestation, litters, birth, nursing
  const birth = await p.evaluate(() => {
    const S = sim.internals, B = S.SPEEDS.breeding.wolf;
    const [m, f] = stage(["wolf", true, -1, 0], ["wolf", false, 1, 0]);
    S.pair(m, f);
    const dues = [];
    for (let k = 0; k < 200; k++) { S.conceive(f, m); dues.push(f.pregnancy.dueAt - sim.now); }
    const litters = { wolf: [], deer: [] };
    for (let k = 0; k < 4000; k++) for (const sp of ["wolf", "deer"]) litters[sp].push(S.litterSize(sp));
    const stats = xs => ({ min: Math.min(...xs), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b) / xs.length });
    S.conceive(f, m);
    f.pregnancy.dueAt = sim.now + 0.5;
    const before = Math.max(...sim.allCritters.map(c => c.uid));
    mind.ignore(f); mind.ignore(m);
    runUntil(() => !f.pregnancy, 2);
    const young = sim.allCritters.filter(c => c.uid > before);
    young.forEach(c => mind.ignore(c, false));
    const near = young.every(c => Math.max(Math.abs(c.gx - f.gx), Math.abs(c.gy - f.gy)) <= 3.01 && !sim.isWaterAt(c.gx, c.gy));
    const parents = young.every(c => c.parentUids.join() === [f.uid, m.uid].join()) && f.youngUids.length === young.length;
    const kg = young.map(c => c.weightKg);
    const mortal = young.every(c => c.lifespanS > 0 && isFinite(c.lifespanS));
    // can't walk yet
    const pup = young[0];
    sim.setIntent(pup, { dx: 1, dy: 0, gait: "walk" }); mind.ignore(pup);
    const at = [pup.gx, pup.gy];
    runUntil(() => false, 1);
    const stayed = pup.gx === at[0] && pup.gy === at[1];
    // nursing: an empty pup by its mother fills from her
    pup.food = 0; const motherBefore = f.food;
    pup.gx = pup.nextGX = f.gx + 1; pup.gy = pup.nextGY = f.gy;
    runUntil(() => false, 1);
    const nursed = pup.food > 0.05 && f.food < motherBefore;
    animat.render();
    const stages = young.map(c => animat.spriteEl(c)?.className);
    // collision boxes by size; a newborn-sized pup walks straight at its mother until stopped
    const boxes = { newborn: pup.boxRad };
    const at2 = S.SPEEDS.growthAgesS.wolf[1] * 1.2, at3 = S.SPEEDS.growthAgesS.wolf[2] * 1.5;
    pup.birthTime = sim.now - at2; S.updateWeight(pup); boxes.stage2 = pup.boxRad;
    pup.birthTime = sim.now - at3; S.updateWeight(pup); boxes.stage3 = pup.boxRad;
    pup.birthTime = sim.now - S.SPEEDS.lifeStageAgesS.wolf.walk.avg * 1.1; S.updateWeight(pup);
    young.concat(sim.allCorpses).forEach(c => { if (c !== pup) { c.gx = c.nextGX = c.gy = c.nextGY = -300 - c.uid; } });
    pup.gx = pup.nextGX = f.gx + 3; pup.gy = pup.nextGY = f.gy; pup.speed = 0; pup.stunnedUntil = 0; S.setCritterIdle(pup);
    let closest = Infinity;
    for (let k = 0; k < 240; k++) {
      sim.setIntent(pup, { dx: f.gx - pup.gx, dy: 0, gait: "walk" });
      S.tick();
      closest = Math.min(closest, Math.abs(pup.gx - f.gx));
    }
    boxes.closest = closest;
    return { dueMin: Math.min(...dues), dueMax: Math.max(...dues), g: B.gestationS, wolf: stats(litters.wolf),
      deer: stats(litters.deer), twins: litters.deer.filter(n => n === 2).length / litters.deer.length,
      n: young.length, near, parents, kg, mortal, boxes, stayed, nursed, stages, wolfPreg: !!f.pregnancy };
  });
  r.check(birth.dueMin >= birth.g.min - 1e-6 && birth.dueMax <= birth.g.max + 1e-6,
    `gestation is ${(birth.dueMin / 60).toFixed(2)}-${(birth.dueMax / 60).toFixed(2)} game minutes, within the wolf's (63 days, gamified)`);
  r.check(birth.wolf.min >= 1 && birth.wolf.max <= 11 && Math.abs(birth.wolf.mean - 5.5) < 0.15
    && birth.deer.min === 1 && birth.deer.max <= 2 && birth.twins < 0.02,
    `litters: wolf ${birth.wolf.min}-${birth.wolf.max}, mean ${birth.wolf.mean.toFixed(2)}; deer one calf, twins ${(birth.twins * 100).toFixed(1)}%`);
  r.check(birth.n >= 1 && birth.near && birth.parents && birth.kg.every(k => Math.abs(k - 0.4) < 0.01),
    `a litter of ${birth.n} is born beside its mother on land, weighing 0.4 kg each, children of both parents`);
  r.check(birth.mortal, "newborns get a lifespan too");
  r.check(birth.stages.every(c => c === "critter wolf stage1"), "newborn pups are drawn from the smallest sheet");
  r.check(birth.boxes.newborn === 0.4 * 0.3 && birth.boxes.stage2 === 0.4 * 0.45 && birth.boxes.stage3 === 0.4
    && birth.boxes.closest < 0.8 && birth.boxes.closest >= 0.52 - 0.05,
    `the smallest two sizes have collision boxes shrunk to their size (half-widths ${birth.boxes.newborn.toFixed(2)}, ` +
    `${birth.boxes.stage2.toFixed(2)}, then ${birth.boxes.stage3}): a pup walks up to ${birth.boxes.closest.toFixed(2)} tiles ` +
    `from its mother (an adult stops at 0.8)`);
  r.check(birth.stayed, "a newborn pup can't walk yet");
  r.check(birth.nursed, "an infant beside its mother nurses: its meter fills from hers");

  // fertility limits
  const limits = await p.evaluate(() => {
    const S = sim.internals, B = S.SPEEDS.breeding.deer;
    const [m, f] = stage(["deer", true, -1, 0], ["deer", false, 1, 0]);
    const out = { young: true };
    out.inHeat = sim.inHeat(f);
    f.birthTime = sim.now - B.maxFertileAgeS.female - 1;
    out.oldInHeat = sim.inHeat(f);
    f.birthTime = sim.now - grownAge("deer");
    f.lastBredAt = sim.now - B.intervalS / 2;
    out.recentInHeat = sim.inHeat(f);
    f.lastBredAt = -Infinity;
    f.pregnancy = { dueAt: sim.now + 100, fatherUid: m.uid };
    out.pregnantInHeat = sim.inHeat(f);
    f.pregnancy = null;
    // an old male mates her: her heat is spent, but she doesn't conceive
    m.birthTime = sim.now - B.maxFertileAgeS.male - 1;
    S.pair(m, f);
    runUntil(() => m.pose === "mate", 30);
    runUntil(() => m.pose !== "mate", 10);
    out.oldMale = { conceived: !!f.pregnancy, spent: !sim.inHeat(f) };
    let again = false;
    runUntil(() => (again = again || m.pose === "mate"), 20);
    out.again = again;
    out.limits = { wolfF: S.REALISTIC.breeding.wolf.maxFertileAgeS.female / (365 * 86400),
      deerF: S.REALISTIC.breeding.deer.maxFertileAgeS.female / (365 * 86400),
      wolfG: S.REALISTIC.breeding.wolf.gestationS.avg / 86400, deerG: S.REALISTIC.breeding.deer.gestationS.avg / 86400 };
    return out;
  });
  r.check(limits.inHeat && !limits.oldInHeat && !limits.recentInHeat && !limits.pregnantInHeat,
    `a female is in heat only while fertile (to ${limits.limits.deerF} years for a hind, ${limits.limits.wolfF} for a she-wolf), not pregnant, and once a year`);
  r.check(!limits.oldMale.conceived && limits.oldMale.spent && !limits.again,
    `mated by a male past his fertile age, she doesn't conceive, and her heat is spent for the year (${JSON.stringify(limits.oldMale)}, again ${limits.again})`);

  // pups don't hunt
  const pups = await p.evaluate(() => {
    const S = sim.internals;
    const [pup, d] = stage(["wolf", false, 0, 0], ["deer", false, 6, 0]);
    pup.birthTime = sim.now - S.SPEEDS.lifeStageAgesS.wolf.run.avg * 1.2; S.updateWeight(pup);
    pup.food = 0.3; mind.ignore(d);
    const modes = new Set();
    for (let k = 0; k < 120; k++) { S.tick(); modes.add(mind.stateOf(pup)?.mode); }
    return [...modes];
  });
  r.check(!pups.includes("chase"), `a hungry unweaned pup doesn't hunt (modes: ${pups.join(", ")})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "breeding", main };
if (require.main === module) runStandalone(module.exports.name, main);
