// Shared helpers for the SimWolf browser tests.
// Tests drive the real index.html in headless Chromium via Playwright.

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
async function openGame(browser, { viewport, initScript, initArg } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  page.problems = [];
  page.on("pageerror", e => page.problems.push("pageerror: " + e.message));
  page.on("dialog", d => { page.problems.push("alert: " + d.message()); d.dismiss(); });
  if (initScript) await page.addInitScript(initScript, initArg);
  await page.goto(PAGE_URL);
  await page.waitForTimeout(300); // let window.onload create critters and start the loop
  return page;
}

// Moves a critter (default: the player's wolf) to the middle of open dry land, at least
// `radius` tiles from any water, rock or bush, stops it, and centers the camera on it.
// Use this before tests that expect land poses (walk/trot/sprint/idle): critters can
// otherwise wander into water and swim. With clearOthers, every other critter is moved
// off the map so nothing gets in the way.
async function moveToOpenLand(page, { who = "pcWolf", radius = 6, clearOthers = false } = {}) {
  return page.evaluate(({ who, radius, clearOthers }) => {
    const a = who === "pcWolf" ? pcWolf : eval(who);
    const dry = (i, j) => { const t = getTerrainAt(i, j); return t !== "water" && !isImpassable(t); };
    const tile = allLandTiles.find(([i, j]) => {
      if (i < radius || j < radius || i >= gridWidthN - radius || j >= gridHeightN - radius) return false;
      for (let di = -radius; di <= radius; di++)
        for (let dj = -radius; dj <= radius; dj++) if (!dry(i + di, j + dj)) return false;
      return true;
    });
    if (!tile) return null;
    if (clearOthers) allCritters.filter(c => c !== a).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; c.redecideCd = 1e9;
      animat.placeCritterSprite(c);
    });
    a.gx = a.nextGX = tile[0] + 0.5; a.gy = a.nextGY = tile[1] + 0.5;
    setCritterIdle(a);
    animat.placeCritterSprite(a);
    if (a === pcWolf) animat.setCameraToPCWolf();
    return tile;
  }, { who, radius, clearOthers });
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

module.exports = { ROOT, PAGE_URL, launchBrowser, openGame, moveToOpenLand, makeReporter, runStandalone, ensureOutputDir };
