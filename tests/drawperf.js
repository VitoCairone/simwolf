// Drawing performance: how long a tick and a frame take, in a normal game and while
// panning the camera at zoom 1. Not a test suite (no checks): a measuring tool.
// Usage: node drawperf.js [seconds per scenario, default 8] [label]
// Prints, per scenario: the simulation's tick (sim, senses and mind) and the view's
// render (animat.render), timed in the page with the game paused; then the live game for
// the given seconds: frames drawn, frame intervals, and the main thread's time a frame
// (from a Chrome trace: script, style, layout, paint, compositing), and the raster
// threads' time. Headless Chromium rasterizes in software: compare runs, not absolutes.

const { launchBrowser, openGame, moveToOpenLand } = require("./helpers");

const seconds = +process.argv[2] || 8;
const label = process.argv[3] || "";
const VIEW = { width: 1280, height: 800 };

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

// the game paused: n ticks, each followed by a render; the time of each, ms
async function timedSteps(page, n) {
  return page.evaluate(n => {
    sim.pause();
    const S = sim.internals, tick = [], render = [];
    for (let k = 0; k < n; k++) {
      let t0 = performance.now(); S.tick(); tick.push(performance.now() - t0);
      t0 = performance.now(); animat.render(); document.body.offsetHeight; render.push(performance.now() - t0);
    }
    sim.unpause();
    return { tick, render };
  }, n);
}

// the live game for `seconds`, traced; `during` runs in Node meanwhile (e.g. keys held)
async function liveRun(browser, page, during) {
  await page.evaluate(() => {
    window.__frames = [];
    const f = t => { window.__frames.push(t); window.__raf = requestAnimationFrame(f); };
    window.__raf = requestAnimationFrame(f);
  });
  await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] });
  const t0 = await page.evaluate(() => [performance.now(), sim.tickCount]);
  if (during) await during.start();
  await page.waitForTimeout(seconds * 1000);
  if (during) await during.stop();
  const t1 = await page.evaluate(() => [performance.now(), sim.tickCount]);
  const trace = JSON.parse((await browser.stopTracing()).toString());
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames; });
  const gaps = frames.slice(1).map((t, k) => t - frames[k]);
  // trace: the renderer's main thread, and its raster threads
  const ev = trace.traceEvents || trace;
  const threads = new Map();
  for (const e of ev) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const sum = {};
  const add = (k, d) => { sum[k] = (sum[k] || 0) + d / 1000; };
  for (const e of ev) {
    if (e.ph !== "X" || !e.dur) continue;
    const th = threads.get(`${e.pid}:${e.tid}`) || "";
    if (th === "CrRendererMain") {
      if (["FunctionCall", "EvaluateScript", "FireAnimationFrame", "TimerFire"].includes(e.name)) add("script", e.dur);
      else if (e.name === "UpdateLayoutTree" || e.name === "RecalculateStyles") add("style", e.dur);
      else if (e.name === "Layout") add("layout", e.dur);
      else if (e.name === "Paint" || e.name === "PaintImage") add("paint", e.dur);
      else if (["UpdateLayer", "UpdateLayerTree", "CompositeLayers", "Layerize", "PrePaint", "Commit"].includes(e.name)) add("composite", e.dur);
      else if (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") add("mainTasks", e.dur);
    } else if (/Raster|Compositor|VizCompositor|GpuMain/i.test(th) && (e.name === "RasterTask" || e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask")) {
      add("raster:" + th.replace(/\d+$/, ""), e.dur);
    }
  }
  const nFrames = frames.length;
  const perFrame = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / nFrames).toFixed(2)]));
  const dom = await page.evaluate(() => document.getElementsByTagName("*").length);
  return {
    fps: +(1000 * (nFrames - 1) / (frames.at(-1) - frames[0])).toFixed(1),
    ticksPerS: +((t1[1] - t0[1]) / ((t1[0] - t0[0]) / 1000)).toFixed(1),
    gapMs: { mean: +mean(gaps).toFixed(1), p50: +pct(gaps, 0.5).toFixed(1), p95: +pct(gaps, 0.95).toFixed(1), max: +Math.max(...gaps).toFixed(1),
      over20: +(gaps.filter(g => g > 20).length / gaps.length * 100).toFixed(0) + "%" },
    mainMsPerFrame: perFrame, domElements: dom,
  };
}

function fmtSteps(s) {
  return `tick ${mean(s.tick).toFixed(2)} ms (p95 ${pct(s.tick, 0.95).toFixed(2)}), render ${mean(s.render).toFixed(2)} ms (p95 ${pct(s.render, 0.95).toFixed(2)})`;
}

(async () => {
  const browser = await launchBrowser();
  console.log(`drawing performance ${label} (viewport ${VIEW.width}x${VIEW.height}, ${seconds} s a scenario)`);

  // NORMAL: the camera on the player's wolf, at the starting zoom; the mind steering it
  {
    const page = await openGame(browser, { viewport: VIEW });
    await page.evaluate(() => { mind.takeOver && mind.takeOver(sim.pcWolf); });
    await page.waitForTimeout(1000);
    const steps = await timedSteps(page, 300);
    console.log(`\nNORMAL (zoom ${await page.evaluate(() => animat.camera.zoom)}, camera on the wolf)\n  paused steps: ${fmtSteps(steps)}`);
    const live = await liveRun(browser, page);
    console.log("  live:", JSON.stringify(live));
    await page.close();
  }

  // PANNING at zoom 1: camera mode, an arrow key held (cameraSpeed px a tick), turning
  // every second so it stays on the map
  {
    const page = await openGame(browser, { viewport: VIEW });
    await page.evaluate(() => { animat.setZoom(1); animat.centerCameraOn(sim.gridWidthN / 2, sim.gridHeightN / 2); });
    if (await page.evaluate(() => controls.arrowsMoveWolf)) await page.click("#arrow-mode-toggle");
    await page.waitForTimeout(500);
    // paused steps while panning: pan as the controls do, each tick
    const steps = await page.evaluate(() => {
      sim.pause();
      const S = sim.internals, tick = [], render = [];
      for (let k = 0; k < 300; k++) {
        const d = Math.floor(k / 60) % 2 ? -50 : 50;
        animat.panCamera(d, d / 2);
        let t0 = performance.now(); S.tick(); tick.push(performance.now() - t0);
        t0 = performance.now(); animat.render(); document.body.offsetHeight; render.push(performance.now() - t0);
      }
      sim.unpause();
      return { tick, render };
    });
    console.log(`\nPANNING (zoom 1, arrow keys)\n  paused steps: ${fmtSteps(steps)}`);
    let timer = null;
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    let k = 0;
    const during = {
      start: async () => { await page.keyboard.down(keys[0]); timer = setInterval(async () => { await page.keyboard.up(keys[k % 4]); k++; await page.keyboard.down(keys[k % 4]); }, 1000); },
      stop: async () => { clearInterval(timer); await page.keyboard.up(keys[k % 4]); },
    };
    const live = await liveRun(browser, page, during);
    console.log("  live:", JSON.stringify(live));
    await page.close();
  }
  await browser.close();
})();
