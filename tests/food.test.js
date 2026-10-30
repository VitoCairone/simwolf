// Food (see BIOMASS, FOOD and BODY in sim.js, graze and feed in mind.js):
//  - every critter has a food meter (0 - 1), the energy its body's tissues hold above the
//    lethal point, that empties from full over SPEEDS.foodFullS (REALISTIC: wolf 14 days,
//    deer ~33); a wolf's or deer's meter reaching 0 kills it
//  - a body weighs its tissues (fat, carbs, protein, water and minerals), its stomach and
//    womb; a well-fed grown deer as published, less as its meter falls
//  - every grass tile holds grass (fresh kg, at most SPEEDS.grassMaxKg), starting short (a
//    tenth of that), that grows back slowly to that limit; its height (bare, short,
//    medium, tall) is drawn with that ground sprite
//  - a hungry deer grazes: eats the grass of its tile into its stomach, down to bare
//  - a dead deer is a carcass: all its biomass, as meat (soft tissue and some bone) in 8
//    pieces and bones (a starved deer's far less meat); a hungry wolf eats it, straight
//    after its kill, until its stomach is full, over feedingMinS (2 s) at least: one
//    piece at a time, each picked at random from those left; it is drawn in 9 layers (a
//    shadow, and each piece as meat until it is eaten, then as bones)
//  - a full stomach takes no more; the body takes it in as it drips through
//  - every wolf starts just hungry enough to hunt and eat (just under mind.js's wolfHuntBelow)
//  - the player's wolf eats when it stands still by a carcass; its meters are shown, the
//    body's in red on the left, the stomach's in orange on the right
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
    && grass.total <= 0.1 * grass.max * grass.tiles * 1.002, // (+ a few seconds' regrowth before the pause)
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
    S.setFood(d, 0.5);
    animat.setZoom(2); animat.centerCameraOn(i + 0.5, j + 0.5); animat.render();
    const rowOf = () => {
      const el = animat.tileEl(i, j), g = el && el.querySelector(".ground");
      return g ? -parseInt(g.style.backgroundPosition.split(" ")[1]) / 40 : null;
    };
    const before = { kg: sim.grassFoodAt(i, j), h: sim.grassHeightAt(i, j), row: rowOf(), food: d.food, gut: d.gut };
    const serial = sim.grassChangesSince(0).serial;
    const modes = new Set(); let eatingTicks = 0;
    for (let n = 0; n < 8 * 60; n++) { // (a tile takes ~5 s to crop)
      S.tick(); modes.add(mind.stateOf(d).mode); if (d.eating) eatingTicks++;
    }
    animat.render();
    const onTile = Math.floor(d.gx) === i && Math.floor(d.gy) === j;
    const after = { kg: sim.grassFoodAt(i, j), h: sim.grassHeightAt(i, j), row: rowOf(), food: d.food, gut: d.gut };
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
  r.check(graze.eatingTicks > 0 && graze.after.kg < graze.before.kg - 0.05 && graze.after.gut > graze.before.gut,
    `a hungry deer grazes its tile into its stomach: grass ${graze.before.kg.toFixed(2)} -> ${graze.after.kg.toFixed(2)} kg, ` +
    `its stomach ${graze.before.gut.toFixed(3)} -> ${graze.after.gut.toFixed(3)}, its meter ${graze.before.food.toFixed(4)} -> ${graze.after.food.toFixed(4)} (${graze.modes}; on the tile: ${graze.onTile})`);
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
    S.setCritterIdle(d); mind.forget(d); mind.ignore(d, false); S.setFood(d, 0.5);
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
    S.setCritterIdle(d); mind.forget(d); mind.ignore(d, false); S.setFood(d, 0.5);
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
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c) && !sim.isInfant(c));
    const w = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isLiveCritter(c) && !sim.isInfant(c));
    [d, w].forEach(c => { mind.ignore(c); S.setFood(c, 0.5); c.eating = false; });
    const t0 = sim.now, d0 = d.food;
    for (let n = 0; n < 60; n++) S.tick();
    const fell = (d0 - d.food) / (sim.now - t0), expect = 1 / S.SPEEDS.foodFullS.deer;
    S.setFood(d, 1e-6); S.setFood(w, 1e-6);
    for (let n = 0; n < 5; n++) S.tick();
    return { fell, expect, deerPose: d.pose, deerLive: sim.isLiveCritter(d),
      wolfPose: w.pose, wolfLive: sim.isLiveCritter(w) };
  });
  r.check(Math.abs(starve.fell / starve.expect - 1) < 0.01,
    `the meter empties from full over ${(1 / starve.expect / 60).toFixed(1)} game minutes (${grass.speeds})`);
  r.check(!starve.deerLive && starve.deerPose === "death" && !starve.wolfLive && starve.wolfPose === "death",
    `at 0 a deer or a wolf starves (to its death animation: ${starve.deerPose}, ${starve.wolfPose})`);

  // a body's weight and make-up, and a starved deer as a carcass
  const body = await p.evaluate(() => {
    const S = sim.internals, sh = sim.bodySharesBySpecies.deer;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c) && sim.isGrown(c));
    const save = [d.frameKg, d.tissues];
    const at = f => {
      S.setBody(d, d.adultKg, f);
      const c = S.newCarcass({ tissues: S.bodyOf("deer", d.adultKg, f), stomach: S.biomass(), womb: S.biomass() });
      const meat = sim.carcassPieces.reduce((p, [name]) => p + sim.biomassKg(c.pieces[name]), 0);
      return { kg: d.weightKg, food: d.food, frame: d.frameKg, meat, all: meat + sim.biomassKg(c.bones),
        shares: Object.fromEntries(Object.entries(d.tissues).map(([k, v]) => [k, v / d.weightKg])) };
    };
    const full = at(1), half = at(0.5), empty = at(0);
    [d.frameKg, d.tissues] = save; S.updateBody(d);
    return { full, half, empty, adultKg: d.adultKg, sh };
  });
  const sharesOk = Object.keys(body.sh).every(k => Math.abs(body.full.shares[k] - body.sh[k]) < 1e-9);
  r.check(Math.abs(body.full.kg - body.adultKg) < 1e-9 && sharesOk && body.half.kg < body.full.kg && body.empty.kg < body.half.kg
    && [body.full, body.half, body.empty].every(b => Math.abs(b.frame - body.adultKg) < 1e-9),
    `a grown deer weighs ${body.full.kg.toFixed(0)} kg well fed, made of ${JSON.stringify(body.sh)}; ${body.half.kg.toFixed(0)} at half, ` +
    `${body.empty.kg.toFixed(0)} starved (its frame ${body.adultKg} kg all the while)`);
  r.check(body.empty.meat < 0.8 * body.full.meat && Math.abs(body.full.all - body.full.kg) < 1e-9 && Math.abs(body.empty.all - body.empty.kg) < 1e-9,
    `a carcass is all of a deer's biomass: a starved deer's ${body.empty.meat.toFixed(0)} kg of meat, a well-fed one's ${body.full.meat.toFixed(0)}`);

  // 4. the player's wolf eats a carcass, a piece at a time in a random order, by standing still next to it
  const tile = await moveToOpenLand(p, { radius: 3, clearOthers: true });
  const eat = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    d.gx = d.nextGX = w.gx + 1; d.gy = d.nextGY = w.gy; d.speed = 0; S.setCritterIdle(d);
    S.setBody(d, d.adultKg, 1); // grown and full
    const deerWeight = d.weightKg;
    S.startCritterDeath(d, w);
    const deerMeat = sim.carcassMeatKg(d), deerBones = sim.biomassKg(d.carcass.bones);
    const deathTicks = Math.ceil(sim.deathDurationSBySpecies.deer / sim.tempo) + 2;
    S.setFood(w, 0.99); // not hungry while it dies
    for (let n = 0; n < deathTicks; n++) S.tick();
    animat.render();
    const el = animat.spriteEl(d);
    const layersOf = () => (el.style.backgroundImage.match(/url\(/g) || []).length;
    // the sheet columns drawn: 0 the shadow, odd a piece's meat, even (but 0) its bones
    const colsOf = () => el.style.backgroundPosition.split(",").map(v => Math.round(-parseFloat(v) / 48));
    const bonesOf = () => colsOf().filter(c => c > 0 && c % 2 === 0).length;
    const full = { cls: el.className, layers: layersOf(), bones: bonesOf(), shadowLast: colsOf().at(-1) === 0,
      meat: sim.carcassMeatKg(d) };
    const kg = (c, name) => sim.carcassPieceKg(c, name);
    // eats a carcass to the bones (kept hungry, its stomach emptied every tick): the order
    // the pieces went in, and the most pieces ever partly eaten at once
    const eatUp = c => {
      // (any eaten already, while it filled its stomach the first time, first)
      const order = sim.carcassPieces.filter(([name]) => !(kg(c, name) > 0)).map(([name]) => name); let most = 0;
      const shares = Object.fromEntries(sim.carcassPieces.map(([name]) => [name, kg(c, name)]));
      for (let k = 0; k < 60 * 60 && sim.carcassMeatKg(c) > 0; k++) {
        S.setFood(w, 0.5);
        const left = sim.carcassPieces.map(([name]) => kg(c, name) > 0);
        S.tick();
        sim.carcassPieces.forEach(([name], k) => { if (left[k] && !(kg(c, name) > 0)) order.push(name); });
        most = Math.max(most, sim.carcassPieces.filter(([name]) => kg(c, name) > 0 && kg(c, name) < shares[name] - 1e-9).length);
        if (k % 10 === 0) { animat.render(); layersSeen.push(layersOf()); bonesSeen.push(bonesOf()); }
      }
      return { order, most };
    };
    // stand still (as the controls do with no input), hungry and empty: eat until the stomach is full...
    S.setFood(w, 0.5);
    sim.setPlayerIntent({ gait: "eat" });
    const meat0 = sim.carcassMeatKg(d), food0 = w.food;
    let n = 0;
    for (; n < 20 * 60 && w.gut < 0.99; n++) S.tick();
    animat.render();
    const fill = id => document.getElementById(id);
    const afterFull = { food: w.food, gut: w.gut, s: n * sim.tempo, meter: parseFloat(fill("food-meter-fill").style.width),
      gutMeter: parseFloat(fill("gut-meter-fill").style.width),
      meterColor: getComputedStyle(fill("food-meter-fill")).backgroundColor, gutColor: getComputedStyle(fill("gut-meter-fill")).backgroundColor,
      ateKg: meat0 - sim.carcassMeatKg(d), stomachKg: S.stomachKg(w), inStomach: sim.biomassKg(w.stomach), T: S.stomachTS(w), minS: S.SPEEDS.feedingMinS,
      widths: [fill("food-meter-fill").parentElement, fill("gut-meter-fill").parentElement].map(e => e.getBoundingClientRect().width) };
    // ...a full stomach takes no more...
    for (let k = 0; k < 5; k++) S.tick(); // (topped right up)
    const before = sim.carcassMeatKg(d); S.tick();
    const ateWhenFull = before - sim.carcassMeatKg(d);
    const dripATick = S.stomachKg(w) * sim.tempo / S.stomachTS(w);
    // ...and its body takes it in as it drips through
    sim.setPlayerIntent(null); S.tick(); w.eating = false;
    const t0 = sim.now, f0 = w.food;
    for (n = 0; n < 60 / sim.tempo && w.gut > 0; n++) S.tick();
    const digested = { s: sim.now - t0, food: w.food - f0, expectS: S.stomachTS(w) * S.stomachEmptiesInT,
      realH: S.stomachTS(w) * S.stomachEmptiesInT * S.REALISTIC.foodFullS.wolf / S.SPEEDS.foodFullS.wolf / 3600 };
    // then kept hungry, to the bones
    const layersSeen = [], bonesSeen = [];
    sim.setPlayerIntent({ gait: "eat" });
    const first = eatUp(d);
    animat.render();
    const bones = { layers: layersOf(), bones: bonesOf(), meat: sim.carcassMeatKg(d), cls: el.className, left: sim.biomassKg(d.carcass.bones) };
    // another carcass: another order
    const d2 = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    d2.gx = d2.nextGX = w.gx; d2.gy = d2.nextGY = w.gy + 1; d2.speed = 0; S.setCritterIdle(d2);
    S.startCritterDeath(d2, w);
    for (let k = 0; k < deathTicks; k++) { S.setFood(w, 0.99); S.tick(); }
    const second = eatUp(d2);
    sim.setPlayerIntent(null); S.tick();
    return { full, afterFull, ateWhenFull, dripATick, digested, first, second, pieces: sim.carcassPieces.map(p => p[0]),
      bones, layersSeen, bonesSeen, at: [d.gx, d.gy], deerMeat, deerBones, deerWeight, food0 };
  });
  r.check(eat.full.cls === "critter deer-carcass" && eat.full.layers === 9 && eat.full.bones === 0 && eat.full.shadowLast
    && Math.abs(eat.deerMeat + eat.deerBones - eat.deerWeight) < 1e-9,
    `a dead deer is a whole carcass: ${eat.full.meat.toFixed(1)} kg of meat in 8 pieces and ${eat.deerBones.toFixed(1)} of bones, its whole ${eat.deerWeight.toFixed(0)} kg; all meat, over a shadow (${eat.full.layers} layers)`);
  const F = eat.afterFull;
  r.check(F.gut >= 0.99 && F.ateKg > 0.98 * F.stomachKg && F.ateKg < F.stomachKg * (1 + F.s / F.T) && F.s >= F.minS && F.s < F.minS + 1,
    `the player's wolf, hungry and standing still beside it, eats until its stomach is full in ${F.s.toFixed(1)} s (at least ${F.minS} s, though it could gorge faster): ` +
    `${F.ateKg.toFixed(1)} kg (its stomach holds ${F.stomachKg.toFixed(1)}, and passed some on meanwhile)`);
  r.check(eat.ateWhenFull <= eat.dripATick + 1e-9,
    `a full stomach takes no more than drips out of it (${(eat.ateWhenFull * 1000).toFixed(1)} g in a tick; ${(eat.dripATick * 1000).toFixed(1)} g drips out)`);
  r.check(Math.abs(eat.digested.s / eat.digested.expectS - 1) < 0.1 && eat.digested.food > 0.2,
    `its stomach empties in ${eat.digested.s.toFixed(1)} s (a full one in ${eat.digested.expectS.toFixed(1)}: ${eat.digested.realH.toFixed(1)} h, REALISTIC), its meter up ${eat.digested.food.toFixed(2)}`);
  const more = eat.bonesSeen.every((x, k) => k === 0 || x >= eat.bonesSeen[k - 1] || x === 0);
  r.check(more && eat.layersSeen.every(x => x === 9) && eat.bonesSeen.length > 3,
    `kept hungry, it eats the whole deer; the pieces go as they're eaten ` +
    `(always 9 layers; pieces drawn as bones: ${[...new Set(eat.bonesSeen)].join(" ")})`);
  const perm = o => o.length === 8 && [...o].sort().join() === [...eat.pieces].sort().join();
  r.check(perm(eat.first.order) && perm(eat.second.order) && eat.first.order.join() !== eat.second.order.join()
    && eat.first.most <= 1 && eat.second.most <= 1,
    `one piece at a time, in a random order: ${eat.first.order.join(", ")}; then another carcass: ${eat.second.order.join(", ")} (most partly eaten at once: ${eat.first.most}, ${eat.second.most})`);
  r.check(eat.bones.meat === 0 && eat.bones.layers === 9 && eat.bones.bones === 8 && eat.bones.cls === "critter deer-carcass" && eat.bones.left > 0,
    `all the meat eaten, every piece drawn as its bones (${eat.bones.bones} of ${eat.bones.layers - 1}); ${eat.bones.left.toFixed(1)} kg of bone left`);
  const A = eat.afterFull;
  r.check(Math.abs(A.meter - 100 * A.food) < 0.01 && Math.abs(A.gutMeter - 100 * A.gut) < 0.01 && A.meterColor === "rgb(224, 60, 60)"
    && A.gutColor === "rgb(240, 144, 74)" && Math.abs(A.widths[0] / A.widths[1] - 3) < 0.05,
    `the player's food meters show it: the body's in red (${A.meter.toFixed(1)}%), the stomach's in orange (${A.gutMeter.toFixed(1)}%), three times as wide (${A.widths.map(x => x.toFixed(1)).join(" : ")})`);

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
    ["hips", "midback", "skyHind", "groundHind"].forEach(k => { ds[1].carcass.pieces[k] = S.biomass(); });
    ["chest", "head", "skyFore"].forEach(k => { ds[2].carcass.pieces[k] = S.biomass(); });
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
    put(d, home[0] + 2, home[1]); S.setFood(d, 1); S.startCritterDeath(d);
    run(sim.deathDurationSBySpecies.deer + 0.1);
    out.corpse = sim.allCorpses.includes(d);
    // walked over: a wolf walking straight along through it
    put(w, home[0] - 1, home[1]); mind.ignore(w); S.setFood(w, 1); w.wind = w.stamina = 1; w.lifespanS = 1e9;
    sim.setIntent(w, { dx: 1, dy: 0, gait: "walk" });
    let stunned = 0;
    for (let k = 0; k < 10 / sim.tempo && w.gx < d.gx + 1.5; k++) { S.tick(); if (w.stunnedUntil > sim.tickCount) stunned++; }
    out.over = { passed: w.gx >= d.gx + 1.5, stunned };
    // a hungry wolf sees a carcass with meat and goes for it...
    const meat = JSON.stringify(d.carcass.pieces);
    const modes = () => mind.stateOf(w).mode;
    const memo = () => mind.stateOf(w).known.find(k => k.uid === d.uid);
    put(w, d.gx - 6, d.gy); S.setFood(w, 0.3); mind.forget(w); mind.ignore(w, false);
    run(0.3); out.goes = modes();
    // ...but seeing it eaten bare meanwhile, leaves it be
    sim.carcassPieces.forEach(([name]) => { d.carcass.pieces[name] = S.biomass(); });
    let fed = 0; run(3, () => { if (modes() === "feed") fed++; });
    out.bare = { fedTicksAfter: fed, rememberedMeat: memo() && memo().meat };
    // remembered with meat, but gone when it gets there: forgotten
    d.carcass.pieces = JSON.parse(meat);
    put(w, d.gx - 6, d.gy); S.setFood(w, 0.3); mind.forget(w);
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
