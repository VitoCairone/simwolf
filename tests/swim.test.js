// Swimming: water is passable, critters switch to the swim pose (own sprite sheet) in water
// and back to land poses on shore. In water a critter swims at its species' swim speed,
// or sprints (swimBurst) when asked to gallop with the wind for it; it never stands still
// in water (told to stand or eat, or after a stun, it swims on); swimming uses stamina (a
// full reserve lasts swimTimeS: GAMIFIED 12 minutes for a wolf, 3 for a deer), a sprint
// also wind; out of wind a sprint drops to swimming, out of stamina a swimmer can't move.

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
    w.gx = w.nextGX = i - 1 + 0.5; w.gy = w.nextGY = j + 0.5; w.wind = 0.4; w.stamina = 0.7; w.stunnedUntil = 0;
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
  const sp = await p.evaluate(() => ({ kph: sim.internals.SPEEDS.travelKph, ex: sim.internals.SPEEDS.exertion,
    name: sim.speeds }));
  r.check(Math.abs(w1.kmh - sp.kph.wolf.swim) < 0.1, `wolf swims at ${w1.kmh.toFixed(2)} km/h (expected ${sp.kph.wolf.swim})`);
  const used = w1.reservesAtEntry[1] - w1.reserves[1], expectUsed = 2 / sp.ex.wolf.swimTimeS;
  r.check(w1.reserves[0] === w1.reservesAtEntry[0] && Math.abs(used / expectUsed - 1) < 0.02,
    `swimming uses stamina, not wind: ${(used * 100).toFixed(3)}% of it in 2 s ` +
    `(a full reserve lasts ${(sp.ex.wolf.swimTimeS / 60).toFixed(0)} minutes)`);
  r.check(sp.name !== "gamified" || (sp.ex.wolf.swimTimeS === 12 * 60 && sp.ex.deer.swimTimeS === 3 * 60),
    `gamified, a full stamina swims a wolf 12 minutes and a deer 3 (${sp.ex.wolf.swimTimeS / 60}, ${sp.ex.deer.swimTimeS / 60})`);
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

  // 2. no standing still in water: told to stand, or eat, or after a stun, it swims on
  const still = await p.evaluate(() => {
    const w = sim.pcWolf, S = sim.internals, swim = S.travelSpeedBySpeciesAndPose.wolf.swim;
    const out = {};
    for (const gait of ["idle", "eat"]) {
      sim.setPlayerIntent({ gait }); S.tick();
      const at = [w.gx, w.gy]; S.tick();
      out[gait] = w.pose === "swim" && w.speed === swim && (w.gx !== at[0] || w.gy !== at[1]);
    }
    sim.setPlayerIntent(null); S.tick();
    // a stun halts it; once over, it swims on
    S.stun(w);
    const stunned = w.speed === 0;
    for (let n = 0; n < 40; n++) S.tick();
    out.afterStun = stunned && w.speed === swim && w.pose === "swim";
    return out;
  });
  r.check(still.idle && still.eat && still.afterStun,
    `no standing still in water: told to stand (${still.idle}) or eat (${still.eat}), or after a stun (${still.afterStun}), it swims on the way it faces`);

  // 3. asking to gallop in water sprints (swimBurst), using wind; out of wind it swims;
  //    out of stamina it can't move at all
  const spr = await p.evaluate(() => {
    const w = sim.pcWolf, S = sim.internals, v = S.travelSpeedBySpeciesAndPose.wolf;
    w.wind = 1; w.stamina = 1;
    S.setCritterMoving(w, sim.DIR_N, "gallop");
    const sprint = { pose: w.pose, burst: w.targetSpeed === v.swimBurst, wind: w.wind };
    S.tick(); sprint.windUsed = sprint.wind - w.wind;
    w.wind = 1e-9; S.tick();
    const outOfWind = { swim: w.targetSpeed === v.swim, burst: w.swimBurst };
    S.setCritterMoving(w, sim.DIR_N, "gallop"); // can't start a sprint without wind
    const noRestart = w.targetSpeed === v.swim;
    w.stamina = 1e-9; S.tick();
    for (let n = 0; n < 200 && w.speed > 0; n++) S.tick(); // (slowing to a stop)
    const exhausted = { speed: w.speed, pose: w.pose };
    const at = [w.gx, w.gy];
    S.setCritterMoving(w, sim.DIR_W, "walk"); // asked to move, it can't
    for (let n = 0; n < 60; n++) S.tick();
    exhausted.stayed = w.gx === at[0] && w.gy === at[1] && w.speed === 0 && w.pose === "swim";
    w.wind = 1; w.stamina = 1; // rested again: gallop back west, for what follows
    S.setCritterMoving(w, sim.DIR_W, "gallop");
    return { sprint, outOfWind, noRestart, exhausted };
  });
  r.check(spr.sprint.pose === "swim" && spr.sprint.burst && spr.sprint.windUsed > 0,
    `gallop request in water = a sprint at swimBurst speed, using wind (pose ${spr.sprint.pose})`);
  r.check(spr.outOfWind.swim && !spr.outOfWind.burst && spr.noRestart,
    `out of wind, a sprint drops to swimming, and can't start again without wind`);
  r.check(spr.exhausted.speed === 0 && spr.exhausted.stayed,
    `out of stamina, a swimmer can't move: it treads water where it is (stuck, for now)`);

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
    a.gx = a.nextGX = i - 1 + 0.5; a.gy = a.nextGY = j + 0.5; mind.ignore(a); a.stunnedUntil = 0;
    sim.internals.setCritterIdle(a); sim.internals.setCritterMoving(a, sim.DIR_E, "walk");
    for (let n = 0; n < 600 && a.pose !== "swim"; n++) sim.internals.tick();
    const startGX = a.gx;
    for (let n = 0; n < 120; n++) sim.internals.tick();
    animat.render();
    const el = animat.spriteEl(a);
    return { pose: a.pose, kmh: (a.gx - startGX) / (120 * sim.tempo) * 3.6,
      cls: el.className, size: [getComputedStyle(el).width, getComputedStyle(el).height] };
  }, setup.shore);
  r.check(d.pose === "swim" && Math.abs(d.kmh - sp.kph.deer.swim) < 0.1,
    `deer swims at ${d.kmh.toFixed(2)} km/h (expected ${sp.kph.deer.swim})`);
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
