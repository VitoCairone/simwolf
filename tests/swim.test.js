// Swimming: water is passable, critters switch to the swim pose (own sprite sheet) in water
// and back to land poses on shore. In water a critter swims at its species' swim speed,
// or sprints (swimBurst) when asked to gallop with the wind for it; it never stands still
// in water (told to stand or eat, or after a stun, it swims on); swimming uses stamina (a
// full reserve lasts swimTimeS: GAMIFIED 12 minutes for a wolf, 3 for a deer), a sprint
// also wind; out of wind a sprint drops to swimming; out of stamina a swimmer swims on at
// its swim speed (so it can get back to land: see shorewait.test.js).
// The land in front of a swimmer covers it, and is drawn as it is around it.

const path = require("path");
const { openGame, makeStags, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 750 } });
  await makeStags(p); // (the stag's sheets)

  // Find a straight shoreline: land tiles to the west, open water to the east (grid E).
  const setup = await p.evaluate(() => {
    sim.pause();
    window.__d = sim.internals.deer.find(c => sim.isLiveCritter(c)); // (one may have been killed already)
    sim.allCritters.filter(c => c !== sim.pcWolf && c !== window.__d).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    const T = (i, j) => sim.getTerrainAt(i, j);
    for (let i = sim.startNear.i0; i < sim.startNear.i1; i++) for (let j = sim.startNear.j0; j < sim.startNear.j1; j++) {
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
    w.speed = 0; w.climbingUntil = -1; // placed: standing, not slowing or climbing from before
    sim.internals.setCritterMoving(w, sim.DIR_E, "walk");
    let enteredAt = null;
    for (let n = 0; n < 600 && enteredAt === null; n++) { sim.internals.tick(); if (w.pose === "swim") enteredAt = n; }
    const startGX = w.gx, reservesAtEntry = [w.wind, w.stamina];
    for (let n = 0; n < 120; n++) sim.internals.tick(); // 2 s of swimming
    const tilesPerS = (w.gx - startGX) / (120 * sim.tempo);
    animat.render();
    const s = animat.spriteOf(w);
    return {
      enteredAt, inWater: sim.internals.isInWater(w), pose: w.pose, kmh: tilesPerS * 3.6,
      reservesAtEntry, reserves: [w.wind, w.stamina], cls: s.cls,
      sheet: s.image, size: [s.w + "px", s.h + "px"],
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
  //    out of stamina it swims on, at its swim speed
  const spr = await p.evaluate(() => {
    const w = sim.pcWolf, S = sim.internals, v = S.travelSpeedBySpeciesAndPose.wolf;
    const start = [w.gx, w.gy];
    w.wind = 1; w.stamina = 1;
    S.setCritterMoving(w, sim.DIR_N, "gallop");
    const sprint = { pose: w.pose, burst: w.targetSpeed === v.swimBurst, wind: w.wind };
    S.tick(); sprint.windUsed = sprint.wind - w.wind;
    w.wind = 1e-9; S.tick();
    const outOfWind = { swim: w.targetSpeed === v.swim, burst: w.swimBurst };
    S.setCritterMoving(w, sim.DIR_N, "gallop"); // can't start a sprint without wind
    const noRestart = w.targetSpeed === v.swim;
    w.stamina = 1e-9; S.tick();
    const at = [w.gx, w.gy];
    S.setCritterMoving(w, sim.DIR_W, "walk"); w.hx = w.wantHx; w.hy = w.wantHy; // (turned that way)
    for (let n = 0; n < 60; n++) S.tick();
    const exhausted = { stamina: w.stamina, speed: w.speed, pose: w.pose, moved: +(at[0] - w.gx).toFixed(2), swim: v.swim };
    w.gx = w.nextGX = start[0]; w.gy = w.nextGY = start[1]; // (back where it was)
    w.wind = 1; w.stamina = 1; // rested again: gallop back west, for what follows
    S.setCritterMoving(w, sim.DIR_W, "gallop");
    return { sprint, outOfWind, noRestart, exhausted };
  });
  r.check(spr.sprint.pose === "swim" && spr.sprint.burst && spr.sprint.windUsed > 0,
    `gallop request in water = a sprint at swimBurst speed, using wind (pose ${spr.sprint.pose})`);
  r.check(spr.outOfWind.swim && !spr.outOfWind.burst && spr.noRestart,
    `out of wind, a sprint drops to swimming, and can't start again without wind`);
  r.check(spr.exhausted.stamina === 0 && spr.exhausted.pose === "swim" && Math.abs(spr.exhausted.speed - spr.exhausted.swim) < 1e-9 && spr.exhausted.moved > 0.5,
    `out of stamina, a swimmer swims on at its swim speed (${spr.exhausted.moved} tiles west in 1 s)`);

  // 4. swimming back west onto land resumes the requested land pose and the land sheet
  const back = await p.evaluate(() => {
    sim.pcWolf.wind = 1; sim.pcWolf.stamina = 1;
    for (let n = 0; n < 1200 && sim.internals.isInWater(sim.pcWolf); n++) sim.internals.tick();
    sim.internals.tick();
    // (up a bank higher than a step it first walks for a moment: see shorewait.test.js)
    for (let n = 0; n < 200 && sim.pcWolf.climbingUntil >= sim.tickCount; n++) sim.internals.tick();
    animat.render();
    const s = animat.spriteOf(sim.pcWolf);
    return { inWater: sim.internals.isInWater(sim.pcWolf), pose: sim.pcWolf.pose, cls: s.cls, sheet: s.image };
  });
  r.check(!back.inWater && back.pose === "gallop" && back.cls === "critter wolf" && back.sheet.includes("wolf-land.png"),
    `climbing out resumes the requested land pose (${back.pose}) and the land sheet (class "${back.cls}")`);

  // 5. a deer swims too, with its own sheet and 40x48 frames, at its own speed
  const d = await p.evaluate(([i, j]) => {
    sim.pcWolf.gx = sim.pcWolf.gy = sim.pcWolf.nextGX = sim.pcWolf.nextGY = -80; sim.internals.setCritterIdle(sim.pcWolf);
    const a = window.__d;
    a.gx = a.nextGX = i - 1 + 0.5; a.gy = a.nextGY = j + 0.5; mind.ignore(a); a.stunnedUntil = 0;
    sim.internals.setCritterIdle(a); a.speed = 0; a.climbingUntil = -1; sim.internals.setCritterMoving(a, sim.DIR_E, "walk");
    for (let n = 0; n < 600 && a.pose !== "swim"; n++) sim.internals.tick();
    const startGX = a.gx;
    for (let n = 0; n < 120; n++) sim.internals.tick();
    animat.render();
    const s = animat.spriteOf(a);
    return { pose: a.pose, kmh: (a.gx - startGX) / (120 * sim.tempo) * 3.6,
      cls: s.cls, size: [s.w + "px", s.h + "px"] };
  }, setup.shore);
  r.check(d.pose === "swim" && Math.abs(d.kmh - sp.kph.deer.swim) < 0.1,
    `deer swims at ${d.kmh.toFixed(2)} km/h (expected ${sp.kph.deer.swim})`);
  r.check(d.cls === "critter deer-swim" && d.size.join() === "48px,48px",
    `deer uses its swim sheet (class "${d.cls}", ${d.size.join(" x ")} frames)`);
  await p.evaluate(() => { const a = window.__d; animat.setZoom(4);
    animat.centerCameraOn(a.gx, a.gy); });
  await p.screenshot({ path: path.join(outDir, "deer-swimming.png"), clip });

  // 5b. land just in front of a swimmer (screen-down) is drawn as it is: the view outside
  // the swimmer's frame is the same with the swimmer as without it
  const front = await p.evaluate(() => {
    sim.pause();
    const T = sim.getTerrainAt, land = (i, j) => T(i, j) !== "water";
    let at = null;
    for (let i = sim.startNear.i0; i < sim.startNear.i1 && !at; i++) for (let j = sim.startNear.j0; j < sim.startNear.j1 && !at; j++)
      if (T(i, j) === "water" && land(i, j + 1) && land(i + 1, j + 1)) at = [i, j];
    if (!at) return null;
    // the land in front raised 2 levels above the water (the shores here are flat beaches)
    const w = sim.waterLevelAt(...at);
    for (let i = at[0] - 1; i <= at[0] + 2; i++) for (let j = at[1] + 1; j <= at[1] + 3; j++)
      if (land(i, j)) sim.internals.setTileCorners(i, j, [w + 2, w + 2, w + 2, w + 2]);
    animat.redrawTerrain();
    const a = window.__d;
    a.gx = a.nextGX = at[0] + 0.5; a.gy = a.nextGY = at[1] + 0.5;
    a.pose = "swim"; a.speed = 0; // (as drawn: the view only reads it)
    animat.setZoom(4); animat.centerCameraOn(a.gx, a.gy);
    animat.showOnly([a]);
    return { at, rect: animat.spriteRect(animat.spriteOf(a)) };
  });
  let differ = null;
  if (front) {
    const withIt = (await p.screenshot()).toString("base64");
    await p.evaluate(() => animat.showOnly([]));
    const without = (await p.screenshot()).toString("base64");
    await p.evaluate(() => animat.showOnly(null));
    differ = await p.evaluate(async ([a, b, rect]) => {
      const load = async png => {
        const im = new Image(); im.src = "data:image/png;base64," + png; await im.decode();
        const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
        const g = c.getContext("2d"); g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const [A, B] = [await load(a), await load(b)];
      const field = document.getElementById("field-wrapper").getBoundingClientRect();
      let n = 0;
      for (let y = Math.ceil(field.top); y < field.bottom; y++) for (let x = Math.ceil(field.left); x < field.right; x++) {
        if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) continue;
        const k = (y * A.width + x) * 4;
        if (A.data[k] !== B.data[k] || A.data[k + 1] !== B.data[k + 1] || A.data[k + 2] !== B.data[k + 2]) n++;
      }
      return n;
    }, [withIt, without, front.rect]);
  }
  r.check(front && differ === 0,
    `land in front of a swimmer isn't drawn raised: outside its frame the view is the same without it (${differ} pixels differ, at ${front && front.at})`);
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

module.exports = { name: "swimming", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
