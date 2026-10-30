// Shared helpers for the SimWolf browser tests.
// Tests drive the real index.html in headless Chromium via Playwright.
// In the page, the game is three objects: sim (the world; sim.internals has the rest of
// its functions for tests), animat (the view) and controls (input).

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PAGE_URL = "file://" + path.join(ROOT, "index.html");
const OUTPUT_DIR = path.join(__dirname, "output");

// Set CHROMIUM_PATH to use a specific Chromium build; otherwise Playwright's own.
async function launchBrowser() {
  const opts = {};
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

// Opens the game in a new page and records page errors and alert() dialogs.
// An alert() means the program hit a state that should halt it, so the
// dialog is dismissed (to keep the test running) and counted as a failure.
// Unless dayNight is set, the clock is held at noon (see DAY AND NIGHT in sim.js), so
// other tests aren't upset by the time of day.
async function openGame(browser, { viewport, initScript, initArg, dayNight = false } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  page.problems = [];
  page.on("pageerror", e => page.problems.push("pageerror: " + e.message));
  page.on("dialog", d => { page.problems.push("alert: " + d.message()); d.dismiss(); });
  if (initScript) await page.addInitScript(initScript, initArg);
  await page.goto(PAGE_URL);
  await page.waitForTimeout(300); // let the page load create critters and start the loop
  if (!dayNight) await page.evaluate(() => { sim.internals.holdClock(12); });
  return page;
}

// Moves a critter (default: the player's wolf) to the middle of open, dry, level land, at
// least `radius` tiles from any water, blocked tile (boulder) or change of height, stops
// it, and centers the camera on it.
// Use this before tests that expect land poses (walk/trot/gallop/idle): critters can
// otherwise wander into water and swim. With clearOthers, every other critter is moved
// off the map so nothing gets in the way.
async function moveToOpenLand(page, { who = "pcWolf", radius = 4, clearOthers = false } = {}) {
  return page.evaluate(({ who, radius, clearOthers }) => {
    const a = who === "pcWolf" ? sim.pcWolf : eval(who);
    // dry, unblocked and level with the middle tile (so no step can stop it either)
    const dry = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
    const tile = sim.internals.allLandTiles.find(([i, j]) => {
      if (i < radius || j < radius || i >= sim.gridWidthN - radius || j >= sim.gridHeightN - radius) return false;
      const level = sim.tileCorners(i, j)[0];
      for (let di = -radius; di <= radius; di++)
        for (let dj = -radius; dj <= radius; dj++)
          if (!dry(i + di, j + dj) || sim.tileCorners(i + di, j + dj).some(c => c !== level)) return false;
      return true;
    });
    if (!tile) return null;
    if (clearOthers) sim.allCritters.filter(c => c !== a).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; mind.ignore(c); // (beyond smell)
    });
    a.gx = a.nextGX = tile[0] + 0.5; a.gy = a.nextGY = tile[1] + 0.5;
    a.stunnedUntil = 0; // not stunned from before it was moved
    sim.internals.setCritterIdle(a);
    a.speed = 0; // placed: standing, not slowing from how it moved before
    if (a === sim.pcWolf) animat.followWolf();
    animat.render();
    return tile;
  }, { who, radius, clearOthers });
}

// Makes every deer a grown stag (antlered: see ANTLERS in animat.js), for tests of the
// stag's sprites: other deer are drawn without antlers, from other sheets.
async function makeStags(page) {
  return page.evaluate(() => sim.allCritters.forEach(c => {
    if (c.species !== "deer") return;
    c.isMale = true;
    c.mateUid = null;
    c.pregnancy = null;
    c.lifespanS = 1e9;
    c.birthTime = Math.min(c.birthTime, sim.now - sim.internals.SPEEDS.lifeStageAgesS.deer.mate.max);
    sim.internals.setBodyByAge(c, c.food);
  }));
}

function makeReporter(suiteName) {
  const r = { suiteName, passed: 0, failed: 0 };
  r.check = (cond, msg) => {
    if (cond) r.passed++; else r.failed++;
    console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  };
  r.noProblems = (page, what = "") => {
    r.check(page.problems.length === 0,
      `no page errors or alerts${what ? " " + what : ""}` +
      (page.problems.length ? `: ${JSON.stringify(page.problems)}` : ""));
  };
  return r;
}

// Runs a suite's main(browser, reporter) on its own when the file is executed directly.
function runStandalone(name, main) {
  (async () => {
    const browser = await launchBrowser();
    const r = makeReporter(name);
    console.log(`\n== ${name} ==`);
    try { await main(browser, r); }
    catch (e) { r.check(false, `suite crashed: ${e.stack || e}`); }
    await browser.close();
    console.log(`-- ${name}: ${r.passed} passed, ${r.failed} failed`);
    process.exitCode = r.failed ? 1 : 0;
  })();
}

function ensureOutputDir(sub = "") {
  const dir = path.join(OUTPUT_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { ROOT, PAGE_URL, launchBrowser, openGame, moveToOpenLand, makeStags, makeReporter, runStandalone, ensureOutputDir };
