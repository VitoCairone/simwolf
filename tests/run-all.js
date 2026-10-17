// Runs every *.test.js suite in this folder and prints a combined summary.
// Usage: node run-all.js [name-filter]   e.g. `node run-all.js loop`

const fs = require("fs");
const path = require("path");
const { launchBrowser, makeReporter } = require("./helpers");

(async () => {
  const filter = process.argv[2] || "";
  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith(".test.js") && f.includes(filter))
    .sort();
  const browser = await launchBrowser();
  const results = [];
  for (const f of files) {
    const suite = require(path.join(__dirname, f));
    const r = makeReporter(suite.name);
    console.log(`\n== ${suite.name}  (${f}) ==`);
    const t0 = Date.now();
    try { await suite.main(browser, r); }
    catch (e) { r.check(false, `suite crashed: ${e.stack || e}`); }
    results.push({ file: f, name: suite.name, passed: r.passed, failed: r.failed, s: (Date.now() - t0) / 1000 });
  }
  await browser.close();

  console.log("\n== summary ==");
  for (const x of results) {
    console.log(`${x.failed ? "FAIL" : "ok  "}  ${x.name.padEnd(30)} ${x.passed} passed, ${x.failed} failed  (${x.s.toFixed(0)} s)`);
  }
  const failed = results.reduce((n, x) => n + x.failed, 0);
  const passed = results.reduce((n, x) => n + x.passed, 0);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
