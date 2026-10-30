// Camera pinning and panning (see CAMERA in animat.js, controls.js):
//  - clicking a critter pins the camera to it; it stays on its corpse when it dies
//  - INSPECTING: while the camera follows a critter other than the player's wolf, that
//    critter's meters show below the wolf's, under an eye; not while on the wolf
//  - toggling the arrows to the wolf pins it back to the player's wolf; toggling them to
//    the camera unpins it where it is
//  - arrow-key panning is slower zoomed in, by the zoom factor
//  - at every zoom, panning goes exactly as far as brings each of the map's corners to the
//    viewport's edge

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
  const inspect = await p.evaluate(() => {
    const d = window.__d, w = sim.pcWolf;
    d.wind = 0.3; d.stamina = 0.6; sim.internals.setFood(d, 0.9); w.wind = 1; w.stamina = 1; sim.internals.setFood(w, 0.5);
    animat.render();
    const panel = document.getElementById("inspect-panel"), eye = document.getElementById("inspect-icon");
    const widths = ["wind", "stamina", "food"].map(m => parseFloat(document.getElementById(`inspect-${m}-fill`).style.width));
    const own = parseFloat(document.getElementById("food-meter-fill").style.width);
    const below = panel.getBoundingClientRect().top >= document.getElementById("exertion-meters").getBoundingClientRect().bottom;
    const eyeAbove = eye.getBoundingClientRect().bottom <= document.getElementById("inspect-wind-fill").getBoundingClientRect().top;
    return { shown: !panel.hidden && panel.getBoundingClientRect().height > 0, widths, own, below, eyeAbove,
      text: panel.textContent.trim() };
  });
  r.check(inspect.shown && inspect.widths.join() === "30,60,90" && inspect.own === 50 && inspect.below && inspect.eyeAbove && inspect.text === "",
    `following the deer, its meters show below the wolf's, under an eye, with no text (${JSON.stringify(inspect)})`);

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
  const toWolf = await p.evaluate(() => { animat.render(); return animat.camera.pinned === sim.pcWolf && document.getElementById("inspect-panel").hidden; });
  await p.click("#arrow-mode-toggle");
  const toCamera = await p.evaluate(() => {
    const before = animat.camera.shiftPX;
    const w = sim.pcWolf; w.gx = w.nextGX = w.gx + 2; animat.render();
    return { unpinned: animat.camera.pinned === null, stayed: animat.camera.shiftPX === before };
  });
  r.check(toWolf && toCamera.unpinned && toCamera.stayed,
    `arrows to the wolf pin the camera on it (the inspected meters hidden); arrows to the camera unpin it where it is (${toWolf}, ${JSON.stringify(toCamera)})`);

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

  // panning to the map's corners, at each zoom: where the map's leftmost, rightmost, top
  // and bottom points land on screen, against the viewport's edges
  const edges = await p.evaluate(() => {
    const wrap = document.getElementById("field-wrapper").getBoundingClientRect();
    const c = animat.camera, R = c.worldRadPX, D = document.getElementById("tile-layer");
    const probe = document.createElement("div");
    probe.style.position = "absolute"; probe.style.width = probe.style.height = "0px";
    D.appendChild(probe);
    const at = (x, y) => { probe.style.left = `${x}px`; probe.style.top = `${y}px`; const b = probe.getBoundingClientRect(); return [b.left, b.top]; };
    const out = {};
    for (const z of [1, 2, 4, 8]) {
      animat.setZoom(z);
      const off = [];
      animat.panCamera(-1e6, 0); animat.render(); off.push(at(-R, 0)[0] - wrap.left);
      animat.panCamera(2e6, 0); animat.render(); off.push(at(R, 0)[0] - wrap.right);
      animat.panCamera(0, -1e6); animat.render(); off.push(at(0, 0)[1] - wrap.top);
      animat.panCamera(0, 2e6); animat.render(); off.push(at(0, animat.camera.worldBottomPY)[1] - wrap.bottom);
      out[z] = off.map(v => +v.toFixed(2));
    }
    probe.remove();
    return out;
  });
  r.check(Object.values(edges).every(off => off.every(v => Math.abs(v) < 0.5)),
    `at every zoom, panning stops with the map's left, right, top and bottom at the viewport's edges (off by px, by zoom: ${JSON.stringify(edges)})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "camera pinning and panning", main };
if (require.main === module) runStandalone(module.exports.name, main);
