// Game loop timing and pause behaviour:
//  - game speed is the same at any display refresh rate
//  - pause is immediate, step advances exactly one tick, rapid pause/unpause never
//    starts a second loop, and long stalls are capped instead of replayed

const { openGame, runStandalone } = require("./helpers");

// Replaces requestAnimationFrame with a timer at the given rate (a simulated display).
function simulateDisplay(hz) {
  let id = 0; const pending = new Map();
  window.requestAnimationFrame = cb => {
    const t = ++id;
    pending.set(t, setTimeout(() => { pending.delete(t); cb(performance.now()); }, 1000 / hz));
    return t;
  };
  window.cancelAnimationFrame = t => { clearTimeout(pending.get(t)); pending.delete(t); };
  window.__rafPending = () => pending.size;
}

const ticksPerSecond = (page, ms) => page.evaluate(async ms => {
  const a = [sim.tickCount, performance.now()];
  await new Promise(r => setTimeout(r, ms));
  return (sim.tickCount - a[0]) / ((performance.now() - a[1]) / 1000);
}, ms);

async function main(browser, r) {
  for (const hz of [30, 60, 120, 144]) {
    const p = await openGame(browser, { initScript: simulateDisplay, initArg: hz });
    const tps = await ticksPerSecond(p, 3000);
    r.check(Math.abs(tps - 60) < 4, `${hz} Hz display: ${tps.toFixed(1)} ticks/s (expected 60)`);
    r.noProblems(p, `at ${hz} Hz`);
    await p.close();
  }

  const p = await openGame(browser, { initScript: simulateDisplay, initArg: 60 });
  const res = await p.evaluate(async () => {
    sim.pause();
    const a = sim.tickCount; await new Promise(r => setTimeout(r, 500)); const b = sim.tickCount;
    sim.stepOnce(); sim.stepOnce(); sim.stepOnce();
    return { frozen: b - a, stepped: sim.tickCount - b, pending: __rafPending(), handle: sim.internals.loopHandle };
  });
  r.check(res.frozen === 0, `paused: no ticks in 0.5 s (got ${res.frozen}), not even one from an already-pending frame`);
  r.check(res.stepped === 3, `three steps while paused = 3 ticks (got ${res.stepped})`);
  r.check(res.pending === 0 && res.handle === null, "no frame is scheduled while paused");

  // rapid double-presses of p with real key events
  for (let i = 0; i < 20; i++) { await p.keyboard.press("p"); await p.keyboard.press("p"); }
  await p.evaluate(() => sim.unpause());
  const tps = await ticksPerSecond(p, 2000);
  const pending = await p.evaluate(() => __rafPending());
  r.check(Math.abs(tps - 60) < 4 && pending <= 1,
    `after 20 rapid double-presses of p: ${tps.toFixed(1)} ticks/s, ${pending} frame pending (one loop)`);

  // a 2 s stall in one frame is capped (0.25 s of catch-up), not replayed
  const caught = await p.evaluate(async () => {
    const realRaf = window.requestAnimationFrame; let stalled = false;
    window.requestAnimationFrame = cb => realRaf(t => {
      if (!stalled) { stalled = true; const end = performance.now() + 2000; while (performance.now() < end) {} }
      cb(performance.now());
    });
    const a = sim.tickCount; await new Promise(r => setTimeout(r, 2300));
    window.requestAnimationFrame = realRaf;
    return sim.tickCount - a;
  });
  r.check(caught < 50, `a 2 s stall caught up only ${caught} ticks (not 120+)`);

  // unpausing after a long pause doesn't replay the paused time
  const burst = await p.evaluate(async () => {
    sim.pause(); await new Promise(r => setTimeout(r, 1500));
    const a = sim.tickCount; sim.unpause(); await new Promise(r => setTimeout(r, 100));
    return sim.tickCount - a;
  });
  r.check(burst <= 8, `unpausing after 1.5 s: ${burst} ticks in the first 0.1 s (no burst)`);
  r.noProblems(p);
  await p.close();

  // the same pause/unpause race against the browser's real requestAnimationFrame
  const p2 = await openGame(browser);
  await p2.evaluate(() => { for (let i = 0; i < 50; i++) { sim.pause(); sim.unpause(); } });
  const tps2 = await ticksPerSecond(p2, 2000);
  r.check(Math.abs(tps2 - 60) < 5, `real display, 50 pause/unpause pairs in one frame: ${tps2.toFixed(1)} ticks/s`);
  const stepped = await p2.evaluate(() => { const a = sim.tickCount; sim.stepOnce(); return sim.tickCount - a; });
  r.check(stepped === 0, "step does nothing while the game is running");
  r.noProblems(p2);
  await p2.close();
}

module.exports = { name: "game loop timing + pause", main, slow: true }; // (see SPEED in run-all.js)
if (require.main === module) runStandalone(module.exports.name, main);
