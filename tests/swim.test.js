// Swimming: water is passable, critters switch to the swim pose (own sprite sheet,
// one speed per species, no effect on wind or stamina) in water and back to land poses on shore.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 750 } });

  // Find a straight shoreline: land tiles to the west, open water to the east (grid E).
  const setup = await p.evaluate(() => {
    sim.pause();
    sim.allCritters.filter(c => c !== sim.pcWolf && c !== sim.internals.deer[0]).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    const T = (i, j) => sim.getTerrainAt(i, j);
    for (let i = 4; i < sim.gridWidthN - 12; i++) for (let j = 4; j < sim.gridHeightN - 4; j++) {
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) for (let dj = -1; dj <= 1 && ok; dj++)
        if (sim.isBlockedTile(i - k, j + dj) || T(i - k, j + dj) === "water") ok = false;
      for (let k = 1; k <= 8 && ok; k++) for (let dj = -1; dj <= 1 && ok; dj++)
        if (T(i + k, j + dj) !== "water") ok = false;
      if (ok) return { shore: [i, j] };
    }
    return { shore: null };
  });
  r.check(!!setup.shore, `found a shoreline to test on (${JSON.stringify(setup.shore)})`);
  if (!setup.shore) { await p.close(); return; }

  // 1. a wolf walks east off the shore into the water and swims
  const w1 = await p.evaluate(([i, j]) => {
    const w = sim.pcWolf;
    w.gx = w.nextGX = i - 1 + 0.5; w.gy = w.nextGY = j + 0.5; w.wind = 0.4; w.stamina = 0.7;
    sim.internals.setCritterIdle(w); mind.ignore(w);
    sim.internals.setCritterMoving(w, sim.DIR_E, "walk");
    let enteredAt = null;
    for (let n = 0; n < 600 && enteredAt === null; n++) { sim.internals.tick(); if (w.pose === "swim") enteredAt = n; }
    const startGX = w.gx, reservesAtEntry = [w.wind, w.stamina];
    for (let n = 0; n < 120; n++) sim.internals.tick(); // 2 s of swimming
    const tilesPerS = (w.gx - startGX) / (120 * sim.tempo);
    animat.render();
    const el = animat.spriteEl(w);
    return {
      enteredAt, inWater: sim.internals.isInWater(w), pose: w.pose, kmh: tilesPerS * 3.6,
      reservesAtEntry, reserves: [w.wind, w.stamina], cls: el.className,
      sheet: getComputedStyle(el).backgroundImage, size: [getComputedStyle(el).width, getComputedStyle(el).height],
    };
  }, setup.shore);
  r.check(w1.enteredAt !== null && w1.inWater && w1.pose === "swim",
    `wolf walks into water and swims (pose ${w1.pose}, entered after ${w1.enteredAt} ticks)`);
  r.check(Math.abs(w1.kmh - 5) < 0.1, `wolf swims at ${w1.kmh.toFixed(2)} km/h (expected 5)`);
  r.check(w1.reserves.join() === w1.reservesAtEntry.join(),
    `swimming changes neither wind nor stamina (${w1.reservesAtEntry.map(v => v.toFixed(4))} on entering, ${w1.reserves.map(v => v.toFixed(4))} after 2 s)`);
  r.check(w1.cls === "critter wolf-swim" && w1.sheet.includes("wolf-swim.png") && w1.size.join() === "64px,64px",
    `wolf uses its swim sheet (class "${w1.cls}", ${w1.size.join(" x ")})`);

  // screenshot of the swimming wolf
  const outDir = ensureOutputDir("swim");
  await p.evaluate(() => { animat.setZoom(4); animat.followWolf(); });
  const clip = await p.evaluate(() => {
    const b = document.getElementById("field-wrapper").getBoundingClientRect();
    return { x: b.left + b.width / 2 - 120, y: b.top + b.height / 2 - 140, width: 240, height: 240 };
  });
  await p.screenshot({ path: path.join(outDir, "wolf-swimming.png"), clip });

  // 2. stopping in water: treads water (swim pose, speed 0), not "idle"
  const tread = await p.evaluate(() => { sim.internals.setCritterIdle(sim.pcWolf); sim.internals.tick(); return [sim.pcWolf.pose, sim.pcWolf.speed]; });
  r.check(tread[0] === "swim" && tread[1] === 0, `stopping in water treads water (pose ${tread[0]}, speed ${tread[1]})`);

  // 3. asking to gallop in water still swims at swim speed
  const spr = await p.evaluate(() => {
    sim.internals.setCritterMoving(sim.pcWolf, sim.DIR_W, "gallop");
    return [sim.pcWolf.pose, sim.pcWolf.speed === sim.internals.travelSpeedBySpeciesAndPose.wolf.swim, sim.pcWolf.landPose];
  });
  r.check(spr[0] === "swim" && spr[1], `gallop request in water = swim at swim speed (pose ${spr[0]})`);

  // 4. swimming back west onto land resumes the requested land pose and the land sheet
  const back = await p.evaluate(() => {
    sim.pcWolf.wind = 1; sim.pcWolf.stamina = 1;
    for (let n = 0; n < 1200 && sim.internals.isInWater(sim.pcWolf); n++) sim.internals.tick();
    sim.internals.tick();
    animat.render();
    const el = animat.spriteEl(sim.pcWolf);
    return { inWater: sim.internals.isInWater(sim.pcWolf), pose: sim.pcWolf.pose, cls: el.className,
      sheet: getComputedStyle(el).backgroundImage };
  });
  r.check(!back.inWater && back.pose === "gallop" && back.cls === "critter wolf" && back.sheet.includes("wolf-run-stand.png"),
    `climbing out resumes the requested land pose (${back.pose}) and the land sheet (class "${back.cls}")`);

  // 5. a deer swims too, with its own sheet and 40x48 frames, at its own speed
  const d = await p.evaluate(([i, j]) => {
    sim.pcWolf.gx = sim.pcWolf.gy = sim.pcWolf.nextGX = sim.pcWolf.nextGY = -80; sim.internals.setCritterIdle(sim.pcWolf);
    const a = sim.internals.deer[0];
    a.gx = a.nextGX = i - 1 + 0.5; a.gy = a.nextGY = j + 0.5; mind.ignore(a);
    sim.internals.setCritterIdle(a); sim.internals.setCritterMoving(a, sim.DIR_E, "walk");
    for (let n = 0; n < 600 && a.pose !== "swim"; n++) sim.internals.tick();
    const startGX = a.gx;
    for (let n = 0; n < 120; n++) sim.internals.tick();
    animat.render();
    const el = animat.spriteEl(a);
    return { pose: a.pose, kmh: (a.gx - startGX) / (120 * sim.tempo) * 3.6,
      cls: el.className, size: [getComputedStyle(el).width, getComputedStyle(el).height] };
  }, setup.shore);
  r.check(d.pose === "swim" && Math.abs(d.kmh - 8) < 0.1,
    `deer swims at ${d.kmh.toFixed(2)} km/h (expected 8)`);
  r.check(d.cls === "critter deer-swim" && d.size.join() === "40px,48px",
    `deer uses its swim sheet (class "${d.cls}", ${d.size.join(" x ")} frames)`);
  await p.evaluate(() => { const a = sim.internals.deer[0]; animat.setZoom(4);
    animat.centerCameraOn(a.gx, a.gy); });
  await p.screenshot({ path: path.join(outDir, "deer-swimming.png"), clip });
  r.noProblems(p);
  await p.close();

  // 6. normal play: critters wander into the water without errors or alerts
  const s = await openGame(browser);
  await s.waitForTimeout(8000);
  const seen = await s.evaluate(() => sim.allCritters.filter(a => a.pose === "swim").length);
  r.check(true, `normal play for 8 s: ${seen} of 20 critters swimming at the end`);
  r.noProblems(s, "in normal play with swimming");
  await s.close();
  console.log(`      screenshots saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "swimming", main };
if (require.main === module) runStandalone(module.exports.name, main);
