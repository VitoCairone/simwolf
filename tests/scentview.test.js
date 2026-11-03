// The scent view (see SCENT VIEW in animat.js): in the player's wolf's sight view, every
// tile it can smell on the ground (a nearly round patch: 7 x 7, with rows of 5 and of 3 on
// each side) has a round mark, brown for deer and blue for wolves,
// its own scent hollow:
//  - a deer that walked past leaves marks the bigger the fresher (contrast-enhanced: the
//    freshest about the biggest, with no deer scent where the wolf stands), drawn brown on
//    the ground
//  - the wolf's own marks are hollow and blue, the one where it stands the reference
//  - none while the camera follows another critter, or is panned
// Saves a screenshot to tests/output/scentview/.

const path = require("path");
const { openGame, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 650 } });
  const outDir = ensureOutputDir("scentview");
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 6, clearOthers: true });

  // a deer walks past (+i, 2.5 tiles off the wolf's line), then is taken away; then the
  // wolf walks 2 tiles along +i
  const marks = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    const [hx, hy] = [w.gx, w.gy];
    sim.allCritters.filter(c => c !== d).forEach(c => { c.gx = c.nextGX = c.gy = c.nextGY = -900 - c.uid; mind.ignore(c); });
    d.gx = d.nextGX = hx - 6; d.gy = d.nextGY = hy + 2.5; d.lifespanS = 1e12; d.stunnedUntil = 0; mind.ignore(d); S.setCritterIdle(d);
    for (let n = 0; n < 4 / sim.tempo; n++) { S.setCritterMoving(d, sim.DIR_E, "walk"); S.tick(); }
    d.gx = d.nextGX = d.gy = d.nextGY = -500;
    w.gx = w.nextGX = hx - 2; w.gy = w.nextGY = hy; w.stunnedUntil = 0; S.setCritterIdle(w);
    for (let n = 0; n < 1.5 / sim.tempo; n++) { S.setCritterMoving(w, sim.DIR_E, "walk"); S.tick(); }
    S.setCritterIdle(w); for (let n = 0; n < 30; n++) S.tick();
    animat.setZoom(4); animat.followWolf(); for (let k = 0; k < 30; k++) animat.render();
    return { shown: animat.scentShown, wi: Math.floor(w.gx), wj: Math.floor(w.gy) };
  });
  const deer = marks.shown.filter(m => m.species === "deer").sort((a, b) => b.strength - a.strength);
  const own = marks.shown.filter(m => m.species === "wolf" && m.own);
  const ordered = deer.every((m, k) => k === 0 || m.r < deer[k - 1].r);
  r.check(deer.length >= 2 && ordered && Math.abs(deer[0].t - 1) < 1e-9 && deer.every(m => !m.own),
    `a deer's trail is marked, the fresher the bigger (radii ${deer.map(m => m.r.toFixed(2)).join(", ")} tiles), the freshest at full contrast`);
  const here = own.find(m => m.i === marks.wi && m.j === marks.wj);
  r.check(own.length >= 2 && here && Math.abs(here.t) < 1e-9 && own.filter(m => m !== here).every(m => m.r < here.r),
    `the wolf's own trail is marked hollow, the reference where it stands (${own.length} marks; staler ones smaller)`);

  // the deer marks' colour on screen: brown, at the biggest one's center
  const at = await p.evaluate(m => {
    const [px, py] = animat.isoProject(m.i + 0.5, m.j + 0.5);
    return animat.worldToScreen(px, py - sim.heightAt(m.i + 0.5, m.j + 0.5) * 8);
  }, deer[0]);
  const px = await p.evaluate(async ([png, x, y]) => {
    const im = new Image(); im.src = "data:image/png;base64," + png; await im.decode();
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    return [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
  }, [(await p.screenshot()).toString("base64"), at[0], at[1]]);
  r.check(px[0] > px[2] + 40 && px[0] > px[1], `drawn on the ground in brown (${px})`);
  await p.screenshot({ path: path.join(outDir, "scent.png") });

  // the patch the wolf smells: 7 x 7, with rows of 5 and of 3 on each side (69 tiles), all
  // marked where it walks over a trail made everywhere about it
  const patch = await p.evaluate(() => {
    const w = sim.pcWolf, S = sim.internals, wi = Math.floor(w.gx), wj = Math.floor(w.gy), H = sim.gridHeightN;
    const t = sim.now - 60, uid = sim.allCritters.find(c => c.species === "deer").uid;
    for (let i = wi - 7; i <= wi + 7; i++) for (let j = wj - 7; j <= wj + 7; j++) S.scentMarks.deer.set(i * H + j, [t, uid]);
    animat.render();
    const rows = {};
    for (const m of animat.scentShown) if (m.species === "deer") {
      const di = m.i - wi, dj = m.j - wj;
      rows[di] = (rows[di] || 0) + 1;
    }
    for (let i = wi - 7; i <= wi + 7; i++) for (let j = wj - 7; j <= wj + 7; j++) S.scentMarks.deer.delete(i * H + j);
    return Object.keys(rows).map(Number).sort((a, b) => a - b).map(k => rows[k]);
  });
  r.check(patch.join() === "3,5,7,9,11,11,11,9,7,5,3",
    `the wolf smells the ground in a nearly round patch: rows of ${patch.join(", ")} tiles`);

  // not while the camera follows another critter, nor while panned
  const others = await p.evaluate(() => {
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    animat.pinCamera(d); animat.render(); const pinned = animat.scentShown.length;
    animat.followWolf(); animat.panCamera(1, 0); animat.render(); const panned = animat.scentShown.length;
    animat.followWolf(); animat.render(); const back = animat.scentShown.length;
    return { pinned, panned, back };
  });
  r.check(others.pinned === 0 && others.panned === 0 && others.back > 0,
    `no marks while following another critter (${others.pinned}) or panned (${others.panned}); back on the wolf, again (${others.back})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "scent view", main };
if (require.main === module) runStandalone(module.exports.name, main);
