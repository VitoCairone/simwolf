// The deer's land animations, as the artist's preview (images_raw/OvN65m.gif) plays them
// (sprites taken from it by spritecraft/extract_deer_gif.py into images/deer-land.png):
//  - walk: columns 0-9, trot and gallop: the run cycle, columns 35-43; 100 ms (6 ticks) each
//  - idle: columns 11-34, 6 ticks each but 30 (500 ms) for columns 19, 26 and 33
//  - grazing (standing, eating): the head lowers (column 32), then stays down (33)
// Saves a screenshot of deer standing, grazing and running to tests/output/deeranim/.

const path = require("path");
const { openGame, makeStags, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 650 } });
  await makeStags(p); // (the stag's sheets)
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 5, clearOthers: true });
  const res = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    mind.ignore(d); mind.ignore(w); // (the player's wolf, left alone, would hunt it)
    d.gx = d.nextGX = w.gx + 2; d.gy = d.nextGY = w.gy; d.stunnedUntil = 0; d.food = 0.5;
    w.gx = w.nextGX = w.gx - 3;
    d.wind = d.stamina = 1;
    const el = () => animat.spriteEl(d);
    const col = () => Math.round(-parseFloat(el().style.backgroundPosition.split(" ")[0]) / 32);
    const sheet = () => getComputedStyle(el()).backgroundImage;
    // the columns shown over n ticks, run together: [[column, ticks], ...]
    const watch = (n, set) => {
      const runs = [];
      for (let k = 0; k < n; k++) {
        if (set) set();
        S.tick(); animat.render();
        const c = col();
        if (runs.length && runs.at(-1)[0] === c) runs.at(-1)[1]++; else runs.push([c, 1]);
      }
      return runs;
    };
    const out = {};
    S.setCritterIdle(d); sim.setIntent(d, { gait: "idle" }); S.tick();
    out.idle = watch(2 * 216);
    out.sheet = sheet();
    for (const gait of ["walk", "trot", "gallop"]) {
      S.setCritterIdle(d); d.gx = d.nextGX = w.gx + 5; d.gy = d.nextGY = w.gy;
      d.wind = d.stamina = 1; d.stunnedUntil = 0;
      sim.setIntent(d, { dir: sim.DIR_SE, gait }); S.tick();
      const [x0, y0] = [d.gx, d.gy]; // kept in place: only the animation matters here
      out[gait] = { runs: watch(130, () => { d.wind = d.stamina = 1; d.gx = d.nextGX = x0; d.gy = d.nextGY = y0; }), pose: d.pose };
    }
    // grazing: stand on grass and eat
    S.setCritterIdle(d); d.speed = 0; S.tick(); // (stopped dead, not slowing from a gallop)
    d.gx = d.nextGX = w.gx + 5; d.gy = d.nextGY = w.gy;
    d.food = 0.2; sim.setIntent(d, { gait: "eat" }); S.tick();
    out.graze = watch(120, () => { d.food = 0.2; sim.setIntent(d, { gait: "eat" }); });
    out.grazeEating = d.eating;
    return out;
  });
  const flat = runs => runs.map(([c, n]) => `${c}x${n}`).join(" ");
  r.check(/deer-land\.png/.test(res.sheet), `the deer's land sheet is deer-land.png (${res.sheet.split("/").pop().replace(/"\)$/, "")})`);
  // idle: one whole cycle (from its first column, after wherever it started): every
  // column 11..34 in order, 6 ticks each (30 at 19, 26, 33), then the first again
  const start = res.idle.findIndex(([c], k) => k > 0 && c === 11);
  const idle = res.idle.slice(start, start + 24);
  const idleOk = start > 0 && idle.every(([c, n], k) => c === 11 + k && n === ([19, 26, 33].includes(c) ? 30 : 6))
    && res.idle[start + 24]?.[0] === 11;
  r.check(idleOk, `idle: columns 11-34 in order, 6 ticks each, 30 at 19, 26 and 33, then again (${flat(idle)})`);
  const cycle = (runs, from, n) => {
    const body = runs.slice(1, -1); // the first and last may be cut short
    return body.length > n && body.every(([c, t], k) => t === 6 && c === from + ((body[0][0] - from + k) % n));
  };
  r.check(res.walk.pose === "walk" && cycle(res.walk.runs, 0, 10),
    `walk: columns 0-9, 6 ticks each (${flat(res.walk.runs.slice(0, 12))})`);
  for (const gait of ["trot", "gallop"]) {
    r.check(res[gait].pose === gait && cycle(res[gait].runs, 35, 9),
      `${gait}: the run cycle, columns 35-43, 6 ticks each (${flat(res[gait].runs.slice(0, 11))})`);
  }
  r.check(res.grazeEating && res.graze.length === 2 && res.graze[0][0] === 32 && res.graze[1][0] === 33,
    `grazing: the head lowers (32), then stays down (33) while it eats (${flat(res.graze)})`);

  // a screenshot: deer standing, grazing and running
  await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    const ds = sim.allCritters.filter(c => c.species === "deer" && sim.isLiveCritter(c)).slice(0, 4);
    const gaits = [{ gait: "idle" }, { gait: "eat" }, { dir: sim.DIR_E, gait: "trot" }, { dir: sim.DIR_S, gait: "gallop" }];
    ds.forEach((d, k) => {
      mind.ignore(d); d.food = 0.2; d.wind = d.stamina = 1; d.stunnedUntil = 0;
      d.gx = d.nextGX = w.gx + 1.5 + 1.6 * k; d.gy = d.nextGY = w.gy - 1 + (k % 2); S.setCritterIdle(d);
      sim.setIntent(d, gaits[k]);
    });
    for (let n = 0; n < 20; n++) { ds.forEach((d, k) => { d.food = 0.2; sim.setIntent(d, gaits[k]); }); S.tick(); }
    animat.setZoom(3); animat.centerCameraOn(w.gx + 4, w.gy); animat.render();
  });
  const outDir = ensureOutputDir("deeranim");
  await p.screenshot({ path: path.join(outDir, "deer.png") });
  r.noProblems(p);
  await p.close();
  console.log(`      screenshot saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "deer animations (from the artist's preview)", main };
if (require.main === module) runStandalone(module.exports.name, main);
