// Food (see FOOD in sim.js, graze and feed in mind.js):
//  - every critter has a food meter (0 - 1), the energy its body holds, that empties from
//    full over SPEEDS.foodFullS (REALISTIC: wolf 14 days, deer ~32); a wolf's or deer's
//    meter reaching 0 kills it
//  - a body weighs its skeleton plus its fat and lean tissue, less as its meter falls
//  - every grass tile holds grass (kg, at most SPEEDS.grassMaxKg), starting short (a tenth
//    of that), that grows back slowly to that limit; its height (bare, short, medium, tall) is drawn with that ground sprite
//  - a hungry deer grazes: eats the grass of its tile, taking its food, down to bare (for now)
//  - a dead deer is a carcass of 8 pieces, its body's food at its death (a starved deer's
//    far less, each kg worth less); a hungry wolf eats them, straight after its kill, until
//    it is full: one at a time, each picked at random from those left; it is drawn
//    in 9 layers (a shadow, and each piece as meat until it is eaten, then as bones)
//  - every wolf starts just hungry enough to hunt and eat (just under mind.js's wolfHuntBelow)
//  - the player's wolf eats when it stands still by a carcass; its meter is shown in red
//  - corpses don't block the way, are gone two weeks (a wolf's full meter) after the
//    death, and a bare carcass, or one no longer where it was, draws no wolf
// Saves screenshots of a carcass being eaten to tests/output/food/.

const path = require("path");
const { openGame, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 700 } });
  await p.evaluate(() => sim.pause());

  // 1. the grass
  const grass = await p.evaluate(() => {
    const W = sim.gridWidthN, H = sim.gridHeightN, max = sim.grassMaxKg;
    let tiles = 0, other = 0, overMax = 0, otherFood = 0, total = 0;
    const heights = [0, 0, 0, 0];
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      const kg = sim.grassFoodAt(i, j);
      if (sim.getTerrainAt(i, j) === "grass") {
        tiles++; total += kg; if (kg > max + 1e-6) overMax++; // (kept as 32-bit floats)
        heights[sim.grassHeightAt(i, j)]++;
      } else { other++; if (kg !== 0 || sim.grassHeightAt(i, j) !== -1) otherFood++; }
    }
    return { tiles, other, overMax, otherFood, total, heights, max, speeds: sim.speeds };
  });
  r.check(grass.tiles > 0 && grass.overMax === 0 && grass.otherFood === 0,
    `every grass tile holds grass, at most ${grass.max} kg; no other ground does ` +
    `(${grass.tiles} grass tiles, ${grass.total.toFixed(0)} kg in all)`);
  r.check(grass.heights[2] === 0 && grass.heights[3] === 0 && grass.heights[1] > 0.9 * grass.tiles
    && grass.total <= 0.1 * grass.max * grass.tiles + 5, // (+ a few seconds' regrowth before the pause)
    `grass starts short: a tenth of the most on every tile (short ${grass.heights[1]}, bare ${grass.heights[0]} ` +
    `(grazed already), of ${grass.tiles}; ${grass.total.toFixed(0)} kg in all)`);

  // 2. a deer grazes; its tile's grass goes down and is drawn shorter; it grows back
  const graze = await p.evaluate(() => {
    const S = sim.internals, max = sim.grassMaxKg;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    sim.allCritters.filter(c => c !== d).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; mind.ignore(c); // (far beyond smell)
    });
    // a flat grass tile with grass all around it (so the deer has no reason to move off)
    const t = S.allLandTiles.find(([i, j]) => {
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++)
        if (sim.getTerrainAt(i + di, j + dj) !== "grass" || sim.isBlockedTile(i + di, j + dj)) return false;
      return true;
    });
    const [i, j] = t, k = i * sim.gridHeightN + j;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++)
      S.setGrassKg((i + di) * sim.gridHeightN + j + dj, max);
    d.gx = d.nextGX = i + 0.5; d.gy = d.nextGY = j + 0.5; d.stunnedUntil = 0;
    S.setCritterIdle(d); mind.forget(d);
    d.food = 0.5;
    animat.setZoom(2); animat.centerCameraOn(i + 0.5, j + 0.5); animat.render();
    const rowOf = () => {
      const el = animat.tileEl(i, j), g = el && el.querySelector(".ground");
      return g ? -parseInt(g.style.backgroundPosition.split(" ")[1]) / 40 : null;
    };
    const before = { kg: sim.grassFoodAt(i, j), h: sim.grassHeightAt(i, j), row: rowOf(), food: d.food };
    const serial = sim.grassChangesSince(0).serial;
    const modes = new Set(); let eatingTicks = 0;
    for (let n = 0; n < 8 * 60; n++) { // (a tile takes ~5 s to crop)
      S.tick(); modes.add(mind.stateOf(d).mode); if (d.eating) eatingTicks++;
    }
    animat.render();
    const onTile = Math.floor(d.gx) === i && Math.floor(d.gy) === j;
    const after = { kg: sim.grassFoodAt(i, j), h: sim.grassHeightAt(i, j), row: rowOf(), food: d.food };
    const logged = (sim.grassChangesSince(serial).tiles || []).some(([a, b]) => a === i && b === j);
    // growing back, to its limit and no more
    S.setGrassKg(k, 0);
    S.growGrass(60);
    const grown60 = sim.grassFoodAt(i, j);
    S.growGrass(1e9);
    const grownAll = sim.grassFoodAt(i, j);
    const perS = S.SPEEDS.grassRegrowKgPerS, fullS = S.SPEEDS.foodFullS.deer;
    return { before, after, onTile, logged, modes: [...modes].join(","), eatingTicks,
      grown60, grownAll, perS, max, fullS };
  });
  r.check(graze.eatingTicks > 0 && graze.after.kg < graze.before.kg - 0.05 && graze.after.food > graze.before.food,
    `a hungry deer grazes its tile: grass ${graze.before.kg.toFixed(2)} -> ${graze.after.kg.toFixed(2)} kg, ` +
    `its meter ${graze.before.food.toFixed(2)} -> ${graze.after.food.toFixed(2)} (${graze.modes}; on the tile: ${graze.onTile})`);
  r.check(graze.before.h === 3 && graze.after.kg < 0.001 && graze.after.h === 0 && graze.logged && graze.after.row === 5,
    `a deer crops its tile bare, drawn as grazed-out grass: height ${graze.before.h} -> ${graze.after.h}, ` +
    `ground sprite row ${graze.before.row} -> ${graze.after.row} (${(graze.after.kg * 1000).toFixed(2)} g left, as it starts to grow back)`);
  r.check(Math.abs(graze.grown60 - 60 * graze.perS) < 1e-6 && Math.abs(graze.grownAll - graze.max) < 1e-6,
    `grass grows back slowly (${(graze.grown60 * 1000).toFixed(2)} g a minute), up to ${graze.max} kg and no more`);

  // a deer passes over crumbs (cropped tiles grown back a little) for a tile worth eating
  const crumbs = await p.evaluate(() => {
    const S = sim.internals, max = sim.grassMaxKg, H = sim.gridHeightN;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const t = S.allLandTiles.find(([i, j]) => {
      for (let di = -6; di <= 6; di++) for (let dj = -6; dj <= 6; dj++)
        if (sim.getTerrainAt(i + di, j + dj) !== "grass" || sim.isBlockedTile(i + di, j + dj)) return false;
      return true;
    });
    const [i, j] = t;
    for (let di = -6; di <= 6; di++) for (let dj = -6; dj <= 6; dj++) S.setGrassKg((i + di) * H + j + dj, 0.0001); // crumbs
    S.setGrassKg((i + 4) * H + j, 0.1 * max); // one short tile, 4 tiles east
    d.gx = d.nextGX = i + 0.5; d.gy = d.nextGY = j + 0.5; d.stunnedUntil = 0; d.speed = 0;
    S.setCritterIdle(d); mind.forget(d); mind.ignore(d, false); d.food = 0.5;
    const visited = new Set();
    let n = 0;
    for (; n < 8 * 60 && sim.grassFoodAt(i + 4, j) > 0.05 * max; n++) {
      S.tick(); visited.add(Math.floor(d.gx) + "," + Math.floor(d.gy));
    }
    const out = { s: n * sim.tempo, left: sim.grassFoodAt(i + 4, j), tiles: visited.size };
    mind.ignore(d);
    return out;
  });
  r.check(crumbs.left <= 0.05 * grass.max,
    `a deer passes over crumbs (cropped tiles grown back a little) for a tile worth eating, 4 tiles off: ` +
    `eating it after ${crumbs.s.toFixed(1)} s, through ${crumbs.tiles} tiles`);

  // nothing worth eating within 6 tiles: a deer looks as far as it can see (20 tiles)
  const far = await p.evaluate(() => {
    const S = sim.internals, max = sim.grassMaxKg, H = sim.gridHeightN;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const t = S.allLandTiles.find(([i, j]) => {
      for (let di = -14; di <= 14; di++) for (let dj = -3; dj <= 3; dj++)
        if (sim.getTerrainAt(i + di, j + dj) !== "grass" || sim.isBlockedTile(i + di, j + dj)) return false;
      return true;
    });
    const [i, j] = t;
    for (let di = -20; di <= 20; di++) for (let dj = -20; dj <= 20; dj++)
      if (sim.getTerrainAt(i + di, j + dj) === "grass") S.setGrassKg((i + di) * H + j + dj, 0);
    S.setGrassKg((i + 12) * H + j, 0.1 * max); // one short tile, 12 tiles east
    d.gx = d.nextGX = i + 0.5; d.gy = d.nextGY = j + 0.5; d.stunnedUntil = 0; d.speed = 0;
    S.setCritterIdle(d); mind.forget(d); mind.ignore(d, false); d.food = 0.5;
    let n = 0;
    for (; n < 20 * 60 && sim.grassFoodAt(i + 12, j) > 0.05 * max; n++) S.tick();
    const out = { s: n * sim.tempo, left: sim.grassFoodAt(i + 12, j) };
    mind.ignore(d);
    return out;
  });
  r.check(far.left <= 0.05 * grass.max,
    `with nothing worth eating within 6 tiles, a deer looks as far as it can see: it finds a tile 12 off, eating it after ${far.s.toFixed(1)} s`);

  // wolves start just hungry enough to hunt, and eat, once (just under the hunting threshold)
  const start = await p.evaluate(() => ({
    wolves: sim.allCritters.filter(c => c.species === "wolf").map(c => c.food), below: mind.wolfHuntBelow }));
  r.check(start.wolves.every(f => f < start.below && f > start.below - 0.05), // (less what they have used since)
    `every wolf starts just hungry enough to hunt and eat (meters ${[...new Set(start.wolves.map(f => f.toFixed(3)))].join(", ")}; hunts below ${start.below})`);

  // 3. the meter empties over foodFullS; a critter starves at 0 (the player's wolf too: see breeding.test.js)
  const starve = await p.evaluate(() => {
    const S = sim.internals;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isLiveCritter(c));
    [d, w].forEach(c => { mind.ignore(c); c.food = 0.5; c.eating = false; });
    const t0 = sim.now, d0 = d.food;
    for (let n = 0; n < 60; n++) S.tick();
    const fell = (d0 - d.food) / (sim.now - t0), expect = 1 / S.SPEEDS.foodFullS.deer;
    d.food = w.food = 1e-6;
    const wolvesBefore = sim.allCritters.filter(c => c.species === "wolf").length;
    for (let n = 0; n < 5; n++) S.tick();
    return { fell, expect, deerPose: d.pose, deerLive: sim.isLiveCritter(d),
      wolfPose: w.pose, wolfLive: sim.isLiveCritter(w), wolvesBefore };
  });
  r.check(Math.abs(starve.fell / starve.expect - 1) < 0.01,
    `the meter empties from full over ${(1 / starve.expect / 60).toFixed(1)} game minutes (${grass.speeds})`);
  r.check(!starve.deerLive && starve.deerPose === "death" && !starve.wolfLive && starve.wolfPose === "death",
    `at 0 a deer or a wolf starves (to its death animation: ${starve.deerPose}, ${starve.wolfPose})`);

  // a body's weight, and a starved deer as a carcass
  const body = await p.evaluate(() => {
    const S = sim.internals;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c) && sim.isGrown(c));
    const save = [d.food, d.skeletonKg];
    d.skeletonKg = d.adultSkeletonKg;
    const at = f => { d.food = f; S.updateBody(d); return { kg: d.weightKg, meat: sim.edibleKg(d) }; };
    const full = at(1), half = at(0.5), empty = at(0);
    const b = sim.bodySharesBySpecies.deer;
    d.food = save[0]; d.skeletonKg = save[1]; S.updateBody(d);
    return { full, half, empty, adultKg: d.adultKg, skeletonKg: d.adultSkeletonKg, share: b.skeleton,
      fullMJ: sim.internals.energyRangeMJ(d) };
  });
  r.check(Math.abs(body.full.kg - body.adultKg) < 1e-9 && body.half.kg < body.full.kg && body.empty.kg < body.half.kg
    && body.empty.kg > body.skeletonKg && Math.abs(body.skeletonKg / body.adultKg - body.share) < 1e-9,
    `a grown deer weighs ${body.full.kg.toFixed(0)} kg full, ${body.half.kg.toFixed(0)} at half, ${body.empty.kg.toFixed(0)} starved ` +
    `(its skeleton ${body.skeletonKg.toFixed(0)}, the rest its fat and lean tissue)`);
  r.check(body.empty.meat < 0.65 * body.full.meat,
    `a starved deer would be ${body.empty.meat.toFixed(0)} kg of meat, a full one ${body.full.meat.toFixed(0)}`);

  // 4. the player's wolf eats a carcass, a piece at a time in a random order, by standing still next to it
  const tile = await moveToOpenLand(p, { radius: 3, clearOthers: true });
  const eat = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    d.gx = d.nextGX = w.gx + 1; d.gy = d.nextGY = w.gy; d.speed = 0; S.setCritterIdle(d);
    d.skeletonKg = d.adultSkeletonKg; d.food = 1; S.updateBody(d); // grown and full
    const deerMeat = sim.edibleKg(d), deerWeight = d.weightKg;
    S.startCritterDeath(d, w);
    const deathTicks = Math.ceil(sim.deathDurationSBySpecies.deer / sim.tempo) + 2;
    w.food = 1; // not hungry while it dies
    for (let n = 0; n < deathTicks; n++) S.tick();
    animat.render();
    const el = animat.spriteEl(d);
    const layersOf = () => (el.style.backgroundImage.match(/url\(/g) || []).length;
    // the sheet columns drawn: 0 the shadow, odd a piece's meat, even (but 0) its bones
    const colsOf = () => el.style.backgroundPosition.split(",").map(v => Math.round(-parseFloat(v) / 48));
    const bonesOf = () => colsOf().filter(c => c > 0 && c % 2 === 0).length;
    const full = { cls: el.className, layers: layersOf(), bones: bonesOf(), shadowLast: colsOf().at(-1) === 0,
      meat: sim.carcassMeatKg(d) };
    const shares = Object.fromEntries(sim.carcassPieces.map(([name, share]) => [name, share * deerMeat]));
    // eats a carcass to the bones (keeping the wolf hungry): the order the pieces went in,
    // and the most pieces ever partly eaten at once
    const eatUp = c => {
      const order = []; let most = 0;
      for (let k = 0; k < 60 * 60 && sim.carcassMeatKg(c) > 0; k++) {
        w.food = 0;
        const left = sim.carcassPieces.map(([name]) => c.carcass[name] > 0);
        S.tick();
        sim.carcassPieces.forEach(([name], k) => { if (left[k] && !(c.carcass[name] > 0)) order.push(name); });
        most = Math.max(most, sim.carcassPieces.filter(([name, share]) => c.carcass[name] > 0 && c.carcass[name] < share * c.carcassFullKg - 1e-9).length);
      }
      return { order, most };
    };
    // stand still (as the controls do with no input), empty: eat until full...
    w.food = 0;
    sim.setPlayerIntent({ gait: "eat" });
    const order = [], layersSeen = [], bonesSeen = [];
    let n = 0, most = 0;
    const meat0 = sim.carcassMeatKg(d);
    const step = () => {
      const left = sim.carcassPieces.map(([name]) => d.carcass[name] > 0);
      S.tick();
      sim.carcassPieces.forEach(([name], k) => { if (left[k] && !(d.carcass[name] > 0)) order.push(name); });
      most = Math.max(most, sim.carcassPieces.filter(([name]) => d.carcass[name] > 0 && d.carcass[name] < shares[name] - 1e-9).length);
    };
    for (; n < 20 * 60 && w.food < 0.99; n++) step();
    animat.render();
    const fill = document.getElementById("food-meter-fill");
    const afterFull = { food: w.food, s: n * sim.tempo, meter: parseFloat(fill.style.width),
      meterColor: getComputedStyle(fill).backgroundColor, ateKg: meat0 - sim.carcassMeatKg(d),
      wantKg: S.energyRangeMJ(w) / d.carcassMJPerKg, meals: S.energyRangeMJ(w) > 0 && deerMeat * d.carcassMJPerKg / S.energyRangeMJ(w) };
    // ...then kept hungry, to the bones
    for (n = 0; n < 60 * 60 && sim.carcassMeatKg(d) > 0; n++) {
      w.food = 0;
      step();
      if (n % 10 === 0) { animat.render(); layersSeen.push(layersOf()); bonesSeen.push(bonesOf()); }
    }
    animat.render();
    const bones = { layers: layersOf(), bones: bonesOf(), meat: sim.carcassMeatKg(d), cls: el.className };
    // a full wolf eats no more: a second carcass
    const d2 = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    d2.gx = d2.nextGX = w.gx; d2.gy = d2.nextGY = w.gy + 1; d2.speed = 0; S.setCritterIdle(d2);
    d2.skeletonKg = d2.adultSkeletonKg; d2.food = 1; S.updateBody(d2);
    S.startCritterDeath(d2, w);
    for (let k = 0; k < deathTicks; k++) { w.food = 1; S.tick(); }
    const meatFull = sim.carcassMeatKg(d2);
    w.food = 1; S.tick();
    const ateWhenFull = meatFull - sim.carcassMeatKg(d2);
    const usedATick = S.energyRangeMJ(w) * sim.tempo / S.SPEEDS.foodFullS.wolf / d2.carcassMJPerKg;
    // hungry again: another order
    const second = eatUp(d2);
    sim.setPlayerIntent(null); S.tick();
    return { full, afterFull, ateWhenFull, order, most, second, pieces: sim.carcassPieces.map(p => p[0]),
      bones, layersSeen, bonesSeen, usedATick, at: [d.gx, d.gy], deerMeat, deerWeight };
  });
  r.check(eat.full.cls === "critter deer-carcass" && eat.full.layers === 9 && eat.full.bones === 0 && eat.full.shadowLast
    && Math.abs(eat.full.meat - eat.deerMeat) < 1e-6 && eat.deerMeat < eat.deerWeight,
    `a dead deer is a whole carcass: ${eat.full.meat.toFixed(1)} kg (of its ${eat.deerWeight.toFixed(0)} kg) in 8 pieces, all meat, over a shadow (${eat.full.layers} layers)`);
  const more = eat.bonesSeen.every((x, k) => k === 0 || x >= eat.bonesSeen[k - 1]);
  r.check(eat.afterFull.food >= 0.99 && Math.abs(eat.afterFull.ateKg / eat.afterFull.wantKg - 1) < 0.05,
    `the player's wolf, empty and standing still beside it, eats until full in ${eat.afterFull.s.toFixed(1)} s: ` +
    `${eat.afterFull.ateKg.toFixed(1)} kg, its meter's worth (${eat.afterFull.wantKg.toFixed(1)} kg); a whole deer is ${eat.afterFull.meals.toFixed(1)} meters' worth`);
  r.check(more && eat.layersSeen.every(x => x === 9) && eat.bonesSeen.length > 3,
    `kept hungry, it eats the whole deer; the pieces go as they're eaten ` +
    `(always 9 layers; pieces drawn as bones: ${[...new Set(eat.bonesSeen)].join(" ")})`);
  const perm = o => o.length === 8 && [...o].sort().join() === [...eat.pieces].sort().join();
  r.check(perm(eat.order) && perm(eat.second.order) && eat.order.join() !== eat.second.order.join()
    && eat.most <= 1 && eat.second.most <= 1,
    `one piece at a time, in a random order: ${eat.order.join(", ")}; then another carcass: ${eat.second.order.join(", ")} (most partly eaten at once: ${eat.most}, ${eat.second.most})`);
  r.check(eat.bones.meat === 0 && eat.bones.layers === 9 && eat.bones.bones === 8 && eat.bones.cls === "critter deer-carcass",
    `all eaten, every piece drawn as its bones (${eat.bones.bones} of ${eat.bones.layers - 1})`);
  r.check(eat.ateWhenFull <= eat.usedATick + 1e-9,
    `a full wolf eats no more than tops it up (${(eat.ateWhenFull * 1000).toFixed(1)} g in a tick; its meter used ${(eat.usedATick * 1000).toFixed(1)} g)`);
  r.check(Math.abs(eat.afterFull.meter - 100 * eat.afterFull.food) < 0.01 && eat.afterFull.meterColor === "rgb(224, 60, 60)",
    `the player's food meter shows it, in red (${eat.afterFull.meter.toFixed(1)}%, ${eat.afterFull.meterColor})`);

  // screenshots: carcasses whole, partly eaten, and bones
  const outDir = ensureOutputDir("food");
  const shoot = await p.evaluate(at => {
    const S = sim.internals, w = sim.pcWolf;
    const ds = sim.allCritters.filter(c => c.species === "deer" && sim.isLiveCritter(c)).slice(0, 3);
    ds.forEach((d, k) => {
      d.gx = d.nextGX = at[0] + 1.6 * (k + 1); d.gy = d.nextGY = at[1] + 0.6; d.speed = 0;
      S.setCritterIdle(d); S.startCritterDeath(d, w);
    });
    w.gx = w.nextGX = at[0] - 2; w.gy = w.nextGY = at[1] - 1.5;
    for (let n = 0; n < Math.ceil(sim.deathDurationSBySpecies.deer / sim.tempo) + 2; n++) S.tick();
    // eat some of the second and third
    ["hips", "midback", "skyHind", "groundHind"].forEach(k => { ds[1].carcass[k] = 0; });
    ["chest", "head", "skyFore"].forEach(k => { ds[2].carcass[k] = 0; });
    animat.setZoom(3); animat.centerCameraOn(at[0] + 2.4, at[1] + 0.3); animat.render();
    return true;
  }, eat.at);
  await p.screenshot({ path: path.join(outDir, "carcasses.png") });
  r.check(shoot, `carcass screenshot saved`);

  // corpses: walked over, gone after corpseLastsS, and a bare one of no interest to wolves
  await moveToOpenLand(p, { radius: 8, clearOthers: true });
  const corpses = await p.evaluate(() => {
    const S = sim.internals, pc = sim.pcWolf, home = [pc.gx, pc.gy], out = {};
    sim.allCorpses.forEach(c => { c.gx = c.gy = -600 - c.uid; });
    pc.gx = pc.nextGX = pc.gy = pc.nextGY = -450; mind.ignore(pc);
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== pc && sim.isLiveCritter(c) && sim.isGrown(c));
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; S.setCritterIdle(c); };
    const run = (s, f = () => {}) => { for (let k = 0; k < s / sim.tempo; k++) { S.tick(); f(); } };
    put(d, home[0] + 2, home[1]); d.food = 1; S.startCritterDeath(d);
    run(sim.deathDurationSBySpecies.deer + 0.1);
    out.corpse = sim.allCorpses.includes(d);
    // walked over: a wolf walking straight along through it
    put(w, home[0] - 1, home[1]); mind.ignore(w); w.food = 1; w.wind = w.stamina = 1; w.lifespanS = 1e9;
    sim.setIntent(w, { dx: 1, dy: 0, gait: "walk" });
    let stunned = 0;
    for (let k = 0; k < 10 / sim.tempo && w.gx < d.gx + 1.5; k++) { S.tick(); if (w.stunnedUntil > sim.tickCount) stunned++; }
    out.over = { passed: w.gx >= d.gx + 1.5, stunned };
    // a hungry wolf sees a carcass with meat and goes for it...
    const meat = { ...d.carcass };
    const modes = () => mind.stateOf(w).mode;
    const memo = () => mind.stateOf(w).known.find(k => k.uid === d.uid);
    put(w, d.gx - 6, d.gy); w.food = 0.3; mind.forget(w); mind.ignore(w, false);
    run(0.3); out.goes = modes();
    // ...but seeing it eaten bare meanwhile, leaves it be
    sim.carcassPieces.forEach(([name]) => { d.carcass[name] = 0; });
    let fed = 0; run(3, () => { if (modes() === "feed") fed++; });
    out.bare = { fedTicksAfter: fed, rememberedMeat: memo() && memo().meat };
    // remembered with meat, but gone when it gets there: forgotten
    Object.assign(d.carcass, meat);
    put(w, d.gx - 6, d.gy); w.food = 0.3; mind.forget(w);
    run(0.3); out.goes2 = modes();
    const at = sim.allCorpses.indexOf(d); sim.allCorpses.splice(at, 1);
    let lastFeed = -1; run(8, () => { if (modes() === "feed") lastFeed = sim.now; });
    out.gone = { forgot: !memo(), stillFeeding: modes() === "feed", near: Math.hypot(w.gx - d.gx, w.gy - d.gy) };
    sim.allCorpses.push(d);
    mind.ignore(w);
    // it lasts corpseLastsS from the death
    animat.render();
    out.drawn = !!animat.spriteEl(d);
    d.deathTime = sim.now - S.SPEEDS.corpseLastsS + 0.5;
    run(0.25); out.before = sim.allCorpses.includes(d);
    run(0.5); animat.render(); out.after = sim.allCorpses.includes(d); out.drawnAfter = !!animat.spriteEl(d);
    out.lasts = S.SPEEDS.corpseLastsS; out.wolfMeter = S.SPEEDS.foodFullS.wolf;
    out.real = S.REALISTIC.corpseLastsS / 86400;
    return out;
  });
  r.check(corpses.corpse && corpses.over.passed && corpses.over.stunned === 0,
    `a wolf walks straight over a corpse, like the ground (${JSON.stringify(corpses.over)})`);
  r.check(corpses.goes === "feed" && corpses.bare.fedTicksAfter < 0.3 / (1 / 60) && corpses.bare.rememberedMeat === 0,
    `a hungry wolf goes for a carcass it sees, and leaves it be once it sees it bare (${JSON.stringify(corpses.bare)})`);
  r.check(corpses.goes2 === "feed" && corpses.gone.forgot && !corpses.gone.stillFeeding,
    `a carcass it remembers with meat but doesn't find where it was is forgotten (${JSON.stringify(corpses.gone)})`);
  r.check(corpses.drawn && corpses.before && !corpses.after && !corpses.drawnAfter
    && corpses.lasts === corpses.wolfMeter && corpses.real === 14,
    `a corpse is gone ${(corpses.lasts / 60).toFixed(0)} game minutes after the death (a wolf's full meter; REALISTIC ${corpses.real} days)`);

  r.noProblems(p);
  await p.close();
  console.log(`      screenshots saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "food (meters, grazing, carcasses)", main };
if (require.main === module) runStandalone(module.exports.name, main);
