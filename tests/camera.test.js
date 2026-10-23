// Camera pinning and panning (see CAMERA in animat.js, controls.js):
//  - clicking a critter pins the camera to it; it stays on its corpse when it dies
//  - toggling the arrows to the wolf pins it back to the player's wolf; toggling them to
//    the camera unpins it where it is
//  - arrow-key panning is slower zoomed in, by the zoom factor

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 700 } });
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 4, clearOthers: true });
  r.check(await p.evaluate(() => animat.camera.pinned === sim.pcWolf && animat.camera.zoom === 2),
    "the camera starts on the player's wolf, a step in from the widest zoom");

  // click a deer standing near the wolf
  const at = await p.evaluate(() => {
    const w = sim.pcWolf, d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    d.gx = d.nextGX = w.gx + 2.5; d.gy = d.nextGY = w.gy - 2.5; d.speed = 0; d.stunnedUntil = 0;
    sim.internals.setCritterIdle(d);
    window.__d = d;
    animat.render();
    const b = animat.spriteEl(d).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height * 0.6 };
  });
  await p.mouse.click(at.x, at.y);
  r.check(await p.evaluate(() => animat.camera.pinned === window.__d), "clicking a deer pins the camera to it");

  const follows = await p.evaluate(() => {
    const d = window.__d;
    d.gx = d.nextGX = d.gx + 3; animat.render();
    const c = animat.camera, [px, py] = animat.isoProject(d.gx, d.gy);
    const centered = Math.abs(c.shiftPX + c.viewportWidth / 2 - px) < 40;
    sim.internals.startCritterDeath(d);
    for (let n = 0; n < 60; n++) sim.internals.tick();
    animat.render();
    return { centered, corpse: d.kind === "corpse", stillPinned: animat.camera.pinned === d };
  });
  r.check(follows.centered && follows.corpse && follows.stillPinned,
    `the camera follows it, and stays on its corpse when it dies (${JSON.stringify(follows)})`);

  // toggles: to wolf mode pins the wolf; to camera mode unpins, leaving the camera put
  await p.click("#arrow-mode-toggle");
  const toWolf = await p.evaluate(() => animat.camera.pinned === sim.pcWolf);
  await p.click("#arrow-mode-toggle");
  const toCamera = await p.evaluate(() => {
    const before = animat.camera.shiftPX;
    const w = sim.pcWolf; w.gx = w.nextGX = w.gx + 2; animat.render();
    return { unpinned: animat.camera.pinned === null, stayed: animat.camera.shiftPX === before };
  });
  r.check(toWolf && toCamera.unpinned && toCamera.stayed,
    `arrows to the wolf pin the camera on it; arrows to the camera unpin it where it is (${toWolf}, ${JSON.stringify(toCamera)})`);

  // panning speed by zoom
  const pan = async zoom => {
    await p.evaluate(z => { animat.setZoom(z); animat.centerCameraOn(sim.gridWidthN / 2, sim.gridHeightN / 2); }, zoom);
    const x0 = await p.evaluate(() => animat.camera.shiftPX);
    await p.keyboard.down("ArrowRight");
    await p.evaluate(() => { for (let n = 0; n < 10; n++) sim.internals.tick(); });
    await p.keyboard.up("ArrowRight");
    return (await p.evaluate(() => animat.camera.shiftPX)) - x0;
  };
  const d1 = await pan(1), d8 = await pan(8);
  r.check(d1 > 0 && Math.abs(d1 / d8 - 8) < 0.01, `arrow panning is 8 times slower at zoom 8 (${d1} vs ${d8} world px in 10 ticks)`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "camera pinning and panning", main };
if (require.main === module) runStandalone(module.exports.name, main);
