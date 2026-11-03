// The scent view (see SCENT VIEW in animat.js): in the player's wolf's sight view, every
// tile it can smell on the ground (a nearly round patch: 7 x 7, with rows of 5 and of 3 on
// each side) has a round mark, brown for deer and blue for wolves,
// its own scent hollow:
//  - a deer that walked past leaves marks the bigger the fresher: the strongest smelled in
//    the last 4 s sets the biggest (linear in strength, 1 pixel at the faintest smelled to
//    the whole tile fresh), and the least is stretched to half that; drawn brown
//  - other wolves' marks blue for males, pink for females; the wolf's own marks thin rings
//    in its sex's colour, the freshest the biggest
//  - a mark keeps the size it was given when it came into the wolf's nose until it leaves
//    it, fresher scent laid on it included; out of its nose it is still drawn for 1 s
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
    mind.ignore(w);
    d.gx = d.nextGX = hx - 6; d.gy = d.nextGY = hy + 2.5; d.lifespanS = 1e12; d.stunnedUntil = 0; mind.ignore(d); S.setCritterIdle(d);
    for (let n = 0; n < 4 / sim.tempo; n++) { S.setCritterMoving(d, sim.DIR_E, "walk"); S.tick(); }
    d.gx = d.nextGX = d.gy = d.nextGY = -500;
    w.gx = w.nextGX = hx - 2; w.gy = w.nextGY = hy; w.stunnedUntil = 0; S.setCritterIdle(w);
    for (let n = 0; n < 1.5 / sim.tempo; n++) { S.setCritterMoving(w, sim.DIR_E, "walk"); S.tick(); }
    S.setCritterIdle(w); for (let n = 0; n < 30; n++) S.tick();
    animat.setZoom(4); animat.followWolf(); for (let k = 0; k < 30; k++) animat.render();
    return { shown: animat.scentShown, wi: Math.floor(w.gx), wj: Math.floor(w.gy) };
  });
  const deer = marks.shown.filter(m => m.species === "deer").sort((a, b) => b.s - a.s);
  const own = marks.shown.filter(m => m.species === "wolf" && m.own);
  const ordered = deer.every((m, k) => k === 0 || m.d < deer[k - 1].d);
  const least = deer[deer.length - 1];
  // the strongest, the maximum: linear in s from 1 px at 1/8 to the whole tile at 1
  const pxTiles = 1 / (Math.SQRT2 * 16), raw = s => pxTiles + (1 - pxTiles) * (s - 1 / 8) / (7 / 8);
  r.check(deer.length >= 2 && ordered && Math.abs(deer[0].d - raw(deer[0].s)) < 1e-9 && Math.abs(least.d - 0.5 * deer[0].d) < 1e-9 && deer.every(m => !m.own),
    `a deer's trail is marked, the fresher the bigger: the freshest (strength ${deer[0].s.toFixed(4)}) ${deer[0].d.toFixed(3)} tiles across, ` +
    `the least stretched to half that (${deer.map(m => m.d.toFixed(3)).join(", ")})`);
  const here = own.find(m => m.i === marks.wi && m.j === marks.wj);
  r.check(own.length >= 2 && here && own.filter(m => m !== here).every(m => m.d < here.d) && own.every(m => m.colour === own[0].colour),
    `the wolf's own trail is marked as rings, the freshest (where it stands) the biggest (${own.length} rings)`);

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

  // colours by sex: another wolf's marks blue for a male, pink for a female; the wolf's own
  // rings by its own sex
  const colours = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    const he = sim.allCritters.find(c => c.species === "wolf" && c.isMale && c !== w), she = sim.allCritters.find(c => c.species === "wolf" && !c.isMale && c !== w);
    S.scentMarks.wolf.set((wi + 2) * H + wj, [sim.now - 30, he.uid]);
    S.scentMarks.wolf.set((wi - 2) * H + wj, [sim.now - 30, she.uid]);
    animat.render();
    const at = (i, j) => animat.scentShown.find(m => m.species === "wolf" && m.i === i && m.j === j)?.colour;
    const out = { male: at(wi + 2, wj), female: at(wi - 2, wj), own: animat.scentShown.find(m => m.own)?.colour, ownMale: w.isMale };
    S.scentMarks.wolf.delete((wi + 2) * H + wj); S.scentMarks.wolf.delete((wi - 2) * H + wj);
    return out;
  });
  const blue = "rgba(40, 90, 210, 0.85)", pink = "rgba(225, 95, 170, 0.85)";
  r.check(colours.male === blue && colours.female === pink && colours.own === (colours.ownMale ? blue : pink),
    `wolves' marks by sex: a male's blue, a female's pink; its own rings ${colours.ownMale ? "blue (male)" : "pink (female)"}`);

  // the maximum is the strongest smelled in the last 4 s; a mark keeps the size it was
  // given when first smelled, fresher scent on it included; out of its nose it is still
  // drawn for 1 s. (Each step's marks on a row of their own, new to its nose.)
  const memory = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    const uid = sim.allCritters.find(c => c.species === "deer").uid, tick = s => { for (let n = 0; n < s / sim.tempo; n++) S.tick(); };
    const set = (di, dj, ageS) => S.scentMarks.deer.set((wi + di) * H + wj + dj, [sim.now - ageS, uid]);
    const clear = () => { for (let di = -5; di <= 5; di++) for (let dj = -5; dj <= 5; dj++) S.scentMarks.deer.delete((wi + di) * H + wj + dj); };
    const dOf = (di, dj) => animat.scentShown.find(m => m.species === "deer" && m.i === wi + di && m.j === wj + dj);
    clear(); tick(1.1); animat.render();                                    // (nothing left from before)
    set(0, 1, 10); set(1, 1, 20); tick(0.1); animat.render();
    const fresh = dOf(0, 1);
    clear(); set(0, 2, 1800); set(1, 2, 1900); tick(0.1); animat.render();  // weaker: a fresher one smelled 0.1 s ago
    const weak = [dOf(0, 2), dOf(1, 2)];
    tick(4.2); clear(); set(0, 3, 1804.3); set(1, 3, 1904.3); animat.render(); // 4 s on: the maximum is what it smells now
    const later = [dOf(0, 3), dOf(1, 3)];
    set(0, 3, 5); set(1, 3, 5); tick(0.1); animat.render();                // fresh scent laid on them: their sizes kept
    const kept = [dOf(0, 3), dOf(1, 3)];
    clear(); tick(0.5); animat.render();
    const lingering = [dOf(0, 3), dOf(1, 3)];
    tick(0.6); animat.render();
    const gone = dOf(0, 3);
    return { fresh, weak, later, kept: kept.map(x => x && x.d), lingering: lingering.every(x => x && x.lingering), lingerD: lingering.map(x => x && x.d), gone: !gone };
  });
  const m = memory;
  // just after the fresh scent: the weak marks are their raw sizes (the least well under half
  // the remembered maximum: no stretching); 4 s on, the stronger is the maximum, the
  // weaker stretched to half it
  r.check(Math.abs(m.weak[0].d - raw(m.weak[0].s)) < 1e-6 && Math.abs(m.weak[1].d - raw(m.weak[1].s)) < 1e-6
    && Math.abs(m.later[0].d - raw(m.later[0].s)) < 1e-6 && Math.abs(m.later[1].d - 0.5 * m.later[0].d) < 1e-6,
    `the biggest mark is set by the strongest scent smelled in the last 4 s: weak scents just after a fresh one are drawn ` +
    `their own sizes (${m.weak.map(x => x.d.toFixed(2)).join(", ")}); 4 s on, the stronger is the biggest, the other half its size ` +
    `(${m.later.map(x => x.d.toFixed(2)).join(", ")})`);
  r.check(m.kept.every((d, k) => d === m.later[k].d),
    `a mark keeps the size it was given when it came into the wolf's nose, though fresher scent is laid on it (${m.kept.map(d => d && d.toFixed(2)).join(", ")})`);
  r.check(m.lingering && m.lingerD.every((d, k) => d === m.later[k].d) && m.gone,
    `a mark out of its nose is still drawn 0.5 s on, at the size it had when last smelled (${m.lingerD.map(d => d && d.toFixed(2)).join(", ")}), gone after 1 s`);

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
