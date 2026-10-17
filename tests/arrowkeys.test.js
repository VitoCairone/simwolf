// Arrow keys in wolf mode move the wolf in SCREEN directions:
// Up = straight up on screen, Right = straight right, two keys = screen diagonal,
// opposite keys cancel. Uses real key events and the real game loop.

const { openGame, runStandalone } = require("./helpers");

// keys held -> expected sign of on-screen motion [x, y] (screen y grows downward)
const CASES = [
  [["ArrowUp"], [0, -1]],
  [["ArrowDown"], [0, 1]],
  [["ArrowLeft"], [-1, 0]],
  [["ArrowRight"], [1, 0]],
  [["ArrowUp", "ArrowRight"], [1, -1]],
  [["ArrowUp", "ArrowLeft"], [-1, -1]],
  [["ArrowDown", "ArrowRight"], [1, 1]],
  [["ArrowDown", "ArrowLeft"], [-1, 1]],
];

const sign = (v, tol) => (Math.abs(v) <= tol ? 0 : Math.sign(v));

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1200, height: 800 } });
  // wolf mode; keep the pointer away from the pad; clear the area around the wolf
  await p.click("#arrow-mode-toggle");
  await p.mouse.move(300, 300);
  await p.evaluate(() => {
    allCritters.filter(c => c !== pcWolf).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; c.redecideCd = 1e9;
    });
    window.__openTile = allLandTiles.find(([i, j]) => {
      for (let di = -6; di <= 6; di++) for (let dj = -6; dj <= 6; dj++)
        if (isImpassable(getTerrainAt(i + di, j + dj)) || getTerrainAt(i + di, j + dj) === "water") return false;
      return true;
    });
  });
  r.check(await p.evaluate(() => !!window.__openTile), "found open dry ground to test on");

  for (const [keys, [ex, ey]] of CASES) {
    await p.evaluate(() => {
      const [i, j] = window.__openTile;
      pcWolf.gx = pcWolf.nextGX = i + 0.5; pcWolf.gy = pcWolf.nextGY = j + 0.5;
      setCritterIdle(pcWolf); animat.placeCritterSprite(pcWolf);
    });
    const before = await p.evaluate(() => isoProject(pcWolf.gx, pcWolf.gy));
    for (const k of keys) await p.keyboard.down(k);
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => ({
      iso: isoProject(pcWolf.gx, pcWolf.gy), pose: pcWolf.pose,
      row: animat.spriteRow(pcWolf), mirror: pcWolf.element.style.transform === "scaleX(-1)",
    }));
    for (const k of keys) await p.keyboard.up(k);
    const dx = after.iso[0] - before[0], dy = after.iso[1] - before[1];
    const tol = 0.15 * Math.hypot(dx, dy);
    const ok = after.pose === "walk" && sign(dx, tol) === ex && sign(dy, tol) === ey;
    r.check(ok, `${keys.join("+").replace(/Arrow/g, "")}: moved (${dx.toFixed(1)}, ${dy.toFixed(1)}) px on screen, ` +
      `sprite row ${after.row}${after.mirror ? " mirrored" : ""}`);
  }

  // opposite keys cancel; releasing all keys stops the wolf
  await p.keyboard.down("ArrowLeft"); await p.keyboard.down("ArrowRight");
  await p.waitForTimeout(200);
  r.check(await p.evaluate(() => pcWolf.pose === "idle"), "Left+Right together cancel: the wolf stands still");
  await p.keyboard.down("ArrowUp"); await p.waitForTimeout(200);
  r.check(await p.evaluate(() => pcWolf.pose === "walk" && pcWolf.currentDirection === DIR_NW),
    "Left+Right+Up: the horizontal keys cancel, the wolf walks straight up");
  for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp"]) await p.keyboard.up(k);
  await p.waitForTimeout(200);
  r.check(await p.evaluate(() => pcWolf.pose === "idle"), "releasing all keys stops the wolf");

  // camera mode is unchanged: arrows pan the camera in screen directions
  await p.click("#arrow-mode-toggle"); await p.mouse.move(300, 300);
  const c0 = await p.evaluate(() => [worldShiftPX, worldShiftPY]);
  await p.keyboard.down("ArrowDown"); await p.waitForTimeout(200); await p.keyboard.up("ArrowDown");
  const c1 = await p.evaluate(() => [worldShiftPX, worldShiftPY, pcWolf.pose]);
  r.check(c1[1] > c0[1] && c1[0] === c0[0], "camera mode: ArrowDown still pans the camera straight down");
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "arrow keys (wolf mode)", main };
if (require.main === module) runStandalone(module.exports.name, main);
