// Runs the test suites in this folder and prints a combined summary.
// Usage: node run-all.js [fast | slow | all] [name-filter]
//   node run-all.js              the fast suites (the default)
//   node run-all.js slow         the slow suites
//   node run-all.js all loop     every suite whose file name contains "loop"
//
// SPEED: a suite is slow if it says so (`slow: true` in its exports), fast otherwise. All
// the fast suites together must run in fastBudgetS at most: run them freely while
// working; run the slow ones sparingly, those relevant to what changed, and the whole
// suite only when asked. A fast suite that grows slow should be marked slow (or sped up).

const fs = require("fs");
const path = require("path");
const { launchBrowser, makeReporter } = require("./helpers");

const fastBudgetS = 120;

(async () => {
  const sets = ["fast", "slow", "all"];
  const args = process.argv.slice(2);
  const set = sets.includes(args[0]) ? args.shift() : "fast";
  const filter = args[0] || "";
  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith(".test.js") && f.includes(filter))
    .sort()
    .filter(f => set === "all" || !!require(path.join(__dirname, f)).slow === (set === "slow"));
  const browser = await launchBrowser();
  const results = [];
  const start = Date.now();
  for (const f of files) {
    const suite = require(path.join(__dirname, f));
    const r = makeReporter(suite.name);
    console.log(`\n== ${suite.name}  (${f}) ==`);
    const t0 = Date.now();
    try { await suite.main(browser, r); }
    catch (e) { r.check(false, `suite crashed: ${e.stack || e}`); }
    results.push({ file: f, name: suite.name, slow: !!suite.slow, passed: r.passed, failed: r.failed, s: (Date.now() - t0) / 1000 });
  }
  await browser.close();
  const totalS = (Date.now() - start) / 1000;

  console.log(`\n== summary (${set}) ==`);
  for (const x of results) {
    console.log(`${x.failed ? "FAIL" : "ok  "}  ${x.name.padEnd(30)} ${x.passed} passed, ${x.failed} failed  (${x.s.toFixed(0)} s${x.slow ? ", slow" : ""})`);
  }
  const failed = results.reduce((n, x) => n + x.failed, 0);
  const passed = results.reduce((n, x) => n + x.passed, 0);
  const fastS = results.filter(x => !x.slow).reduce((n, x) => n + x.s, 0);
  console.log(`\n${passed} passed, ${failed} failed, in ${totalS.toFixed(0)} s`);
  if (set === "fast" && !filter && fastS > fastBudgetS)
    console.log(`WARNING: the fast suites took ${fastS.toFixed(0)} s, over their ${fastBudgetS} s budget: mark the slowest slow.`);
  process.exitCode = failed ? 1 : 0;
})();
