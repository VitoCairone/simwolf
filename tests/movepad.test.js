// Movement pad and arrow-key controls (see #move-pad in index.html).

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1400, height: 900 } });
  const pad = await p.evaluate(() => {
    const b = document.getElementById("move-pad").getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, R: b.width / 2,
             right: innerWidth - b.right, bottom: innerHeight - b.bottom };
  });
  r.check(pad.right === 24 && pad.bottom === 24 && pad.R === 80, `pad sits in the lower-right ${JSON.stringify(pad)}`);
  // these checks are about land poses, so keep the wolf on open dry ground
  r.check(!!(await moveToOpenLand(p, { radius: 6, clearOthers: true })), "wolf placed on open dry land");

  // mouse over the map does nothing to the wolf
  await p.mouse.move(700, 450); await p.mouse.move(300, 200, { steps: 5 });
  r.check(await p.evaluate(() => !controls.padInUse && !sim.playerHasControl()), "mouse over the map does not take control of the wolf");

  const state = () => p.evaluate(() => ({
    pose: sim.pcWolf.pose, dir: sim.pcWolf.currentDirection, inPad: controls.padInUse,
    knob: document.getElementById("move-pad-knob").classList.contains("visible"),
    active: [...document.querySelectorAll("#move-pad .ring.active")].map(e => e.dataset.pose),
  }));

  // each ring gives its pose
  for (const [f, pose] of [[0.05, "idle"], [0.3, "walk"], [0.6, "trot"], [0.9, "gallop"]]) {
    await p.evaluate(() => { sim.pcWolf.wind = 1; sim.pcWolf.stamina = 1; });
    await p.mouse.move(pad.x + f * pad.R, pad.y, { steps: 2 });
    const s = await state();
    r.check(s.pose === pose && s.inPad && s.knob && s.active.join() === pose,
      `pointer at ${f} of the radius -> ${pose} (got ${s.pose}, ring ${s.active})`);
  }

  // direction: pointer right of center moves the wolf right on screen
  await p.mouse.move(pad.x + 0.6 * pad.R, pad.y);
  const before = await p.evaluate(() => animat.isoProject(sim.pcWolf.gx, sim.pcWolf.gy));
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => ({ iso: animat.isoProject(sim.pcWolf.gx, sim.pcWolf.gy), pose: sim.pcWolf.pose }));
  const dx = after.iso[0] - before[0], dy = after.iso[1] - before[1];
  r.check((dx > 0 && Math.abs(dy) < Math.abs(dx) * 0.2) || after.pose === "idle",
    `pointer right -> wolf moves right on screen (dx ${dx.toFixed(1)}, dy ${dy.toFixed(1)})`);
  await p.mouse.move(pad.x, pad.y - 0.3 * pad.R, { steps: 3 });
  const up = await p.evaluate(() => sim.pcWolf.currentDirection === sim.DIR_NW);
  r.check(up, "pointer up -> grid NW (straight up on screen)");

  // the square pad's corners are outside the circles
  await p.mouse.move(pad.x + 0.95 * pad.R, pad.y + 0.95 * pad.R, { steps: 3 });
  let s = await state();
  r.check(!s.inPad && s.pose === "idle" && !s.knob, "pad corner counts as outside; the wolf stops");

  // leaving the pad
  await p.mouse.move(pad.x + 0.6 * pad.R, pad.y); await p.mouse.move(400, 300, { steps: 4 });
  s = await state();
  r.check(!s.inPad && s.pose === "idle" && !s.knob && s.active.length === 0, "leaving the pad stops the wolf and hides the knob");

  // camera mode: arrows pan even while the pad steers, and the camera stays put
  await p.mouse.move(400, 300, { steps: 2 }); await moveToOpenLand(p, { radius: 6 });
  await p.mouse.move(pad.x + 0.3 * pad.R, pad.y, { steps: 2 });
  const cam0 = await p.evaluate(() => animat.camera.shiftPX);
  await p.keyboard.down("ArrowLeft"); await p.waitForTimeout(400);
  const posePanning = await p.evaluate(() => sim.pcWolf.pose);
  await p.keyboard.up("ArrowLeft"); await p.waitForTimeout(50);
  const cam1 = [await p.evaluate(() => animat.camera.shiftPX), posePanning];
  await p.waitForTimeout(500);
  const cam2 = await p.evaluate(() => animat.camera.shiftPX);
  r.check(cam1[0] < cam0 - 100 && cam1[1] === "walk",
    `camera mode: arrows pan while the pad steers the wolf (${cam0.toFixed(0)} -> ${cam1[0].toFixed(0)})`);
  r.check(Math.abs(cam2 - cam1[0]) < 1, "camera stays where it was panned to");

  await p.mouse.move(400, 300, { steps: 3 }); await p.mouse.move(pad.x + 0.3 * pad.R, pad.y, { steps: 3 });
  await p.waitForTimeout(200);
  const recentered = await p.evaluate(() => {
    const [px] = animat.isoProject(sim.pcWolf.gx, sim.pcWolf.gy);
    return Math.abs(animat.camera.shiftPX + animat.camera.viewportWidth / 2 - px) < 40
      || animat.camera.shiftPX <= -animat.camera.worldRadPX + 1 || animat.camera.shiftPX >= animat.camera.worldRadPX - animat.camera.viewportWidth - 1;
  });
  r.check(recentered, "re-entering the pad re-centers the camera on the wolf");

  // wolf mode
  await p.mouse.move(400, 300, { steps: 2 }); await moveToOpenLand(p, { radius: 6 });
  await p.mouse.move(400, 300, { steps: 3 });
  await p.click("#arrow-mode-toggle"); await p.mouse.move(400, 300);
  r.check(await p.evaluate(() => controls.arrowsMoveWolf), "toggle switches arrows to moving the wolf");
  await p.keyboard.down("ArrowUp"); await p.waitForTimeout(150);
  let w = await p.evaluate(() => [sim.pcWolf.pose, sim.pcWolf.currentDirection === sim.DIR_NW]);
  r.check(w[0] === "walk" && w[1], "wolf mode, outside the pad: ArrowUp walks the wolf straight up on screen (grid NW)");
  await p.mouse.move(pad.x, pad.y + 0.9 * pad.R, { steps: 4 }); await p.waitForTimeout(300);
  w = await p.evaluate(() => [sim.pcWolf.pose, sim.pcWolf.currentDirection === sim.DIR_SE]);
  r.check(w[0] === "gallop" && w[1], "wolf mode, inside the pad with ArrowUp held: the pad wins");
  await p.mouse.move(pad.x, pad.y, { steps: 3 }); await p.waitForTimeout(200);
  r.check(await p.evaluate(() => sim.pcWolf.pose === "idle"), "pad center with ArrowUp held: the wolf stops");
  await p.keyboard.up("ArrowUp");
  await p.mouse.move(400, 300, { steps: 4 });
  await p.keyboard.down("ArrowRight"); await p.waitForTimeout(150); await p.keyboard.up("ArrowRight");
  await p.waitForTimeout(150);
  r.check(await p.evaluate(() => sim.pcWolf.pose === "idle"), "wolf mode: releasing the arrows stops the wolf");

  // the pad does not move with zoom
  await p.click("#zoom-in"); await p.waitForTimeout(100);
  const pad2 = await p.evaluate(() => {
    const b = document.getElementById("move-pad").getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  r.check(pad2.x === pad.x && pad2.y === pad.y, "the pad is unaffected by zoom");
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "movement pad + arrow keys", main };
if (require.main === module) runStandalone(module.exports.name, main);
