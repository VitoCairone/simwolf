// The scent view (see SCENT VIEW in animat.js): in the player's wolf's sight view, every
// tile it can smell on the ground (a nearly round patch: 7 x 7, with rows of 5 and of 3 on
// each side) has a round mark: death scent black, deer's brown, other wolves' blue for
// males and pink for females, its own scent thin rings in its sex's colour. Trail by
// trail (one critter's marks):
//  - within a trail the newest mark is the largest, each older one smaller, the oldest a
//    quarter of the newest: the trail runs small to large the way it was laid
//  - among trails of a kind (three deer passing minutes apart), the fresher the larger
//    overall, and the more filled: the freshest solid, the next a thick ring, older ones
//    thin rings; a trail alone is smaller the older it is
//  - its own trail: thin rings, the freshest (where it stands) the largest; once it has
//    mated, its partner's trail likewise
//  - drawn over its own tile's undergrowth
//  - none while the camera follows another critter, or is panned
// Saves screenshots to tests/output/scentview/.

const path = require("path");
const { openGame, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

// The screen's colour at each point [x, y] (page pixels).
async function pixels(page, pts) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async ([png, pts]) => {
    const im = new Image();
    im.src = "data:image/png;base64," + png;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
  }, [png, pts]);
}

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
    return { shown: animat.scentShown, wi: Math.floor(w.gx), wj: Math.floor(w.gy), deerUid: d.uid };
  });
  const deer = marks.shown.filter(m => m.species === "deer" && m.uid === marks.deerUid).sort((a, b) => a.ageS - b.ageS);
  const own = marks.shown.filter(m => m.kind === "own").sort((a, b) => a.ageS - b.ageS);
  const ordered = t => t.every((m, k) => k === 0 || m.d < t[k - 1].d);
  r.check(deer.length >= 3 && ordered(deer) && Math.abs(deer.at(-1).d - 0.25 * deer[0].d) < 1e-9 && deer.every(m => m.fill === 1),
    `a deer's trail runs small to large the way it was laid: the newest mark the largest, the oldest a quarter of it, solid (${deer.map(m => m.d.toFixed(2)).join(", ")} m)`);
  const here = own.find(m => m.i === marks.wi && m.j === marks.wj);
  r.check(own.length >= 2 && here === own[0] && ordered(own) && Math.abs(own[0].d - 0.8) < 1e-9 && own.every(m => m.fill === 0 && m.colour === own[0].colour),
    `the wolf's own trail is marked as thin rings, the freshest (where it stands) the largest (${own.map(m => m.d.toFixed(2)).join(", ")} m)`);

  // the deer marks' colour on screen: brown, at the largest one's center
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
    S.scentMarks.death.set(wi * H + wj + 2, [sim.now - 30, he.uid]);
    animat.render();
    const at = (i, j, sp = "wolf") => animat.scentShown.find(m => m.species === sp && m.i === i && m.j === j)?.colour;
    const out = { male: at(wi + 2, wj), female: at(wi - 2, wj), own: animat.scentShown.find(m => m.kind === "own")?.colour, ownMale: w.isMale,
      death: at(wi, wj + 2, "death") };
    S.scentMarks.wolf.delete((wi + 2) * H + wj); S.scentMarks.wolf.delete((wi - 2) * H + wj); S.scentMarks.death.delete(wi * H + wj + 2);
    return out;
  });
  const blue = "rgba(40, 90, 210, 0.85)", pink = "rgba(225, 95, 170, 0.85)";
  r.check(colours.male === blue && colours.female === pink && colours.own === (colours.ownMale ? blue : pink),
    `wolves' marks by sex: a male's blue, a female's pink; its own rings ${colours.ownMale ? "blue (male)" : "pink (female)"}`);
  r.check(colours.death === "rgba(0, 0, 0, 0.85)", `death scent is drawn black (${colours.death})`);

  // once mated, its partner's trail as thin rings, like its own; another's as before
  const mate = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    const partner = sim.allCritters.find(c => c.species === "wolf" && c.isMale !== w.isMale && c.mateUid === null);
    const other = sim.allCritters.find(c => c.species === "wolf" && c !== w && c !== partner);
    const was = [w.mateUid, partner.mateUid];
    const lay = (uid, j) => { for (let n = 0; n < 5; n++) S.scentMarks.wolf.set((wi - 2 + n) * H + wj + j, [sim.now - 30 - n, uid]); };
    lay(partner.uid, 2); lay(other.uid, -2);
    const look = () => { animat.render();
      const t = uid => animat.scentShown.filter(m => m.uid === uid).sort((a, b) => a.ageS - b.ageS).map(m => ({ kind: m.kind, d: +m.d.toFixed(3), fill: m.fill, colour: m.colour }));
      return { partner: t(partner.uid), other: t(other.uid) }; };
    const before = look();
    S.pair(w, partner);
    const after = look();
    w.mateUid = was[0]; partner.mateUid = was[1];
    for (const j of [2, -2]) for (let n = 0; n < 5; n++) S.scentMarks.wolf.delete((wi - 2 + n) * H + wj + j);
    return { before, after, partnerMale: partner.isMale };
  });
  const pinkOrBlue = mate.partnerMale ? blue : pink;
  const asOwn = t => t.length === 5 && t.every((m, k) => m.kind === "mate" && m.fill === 0 && m.colour === pinkOrBlue && (k === 0 ? m.d === 0.8 : m.d < t[k - 1].d));
  r.check(mate.before.partner.length === 5 && mate.before.partner.every(m => m.kind === "wolf" && m.fill > 0) && asOwn(mate.after.partner) && mate.after.other.every(m => m.kind === "wolf" && m.fill > 0),
    `once mated, its partner's trail is drawn as thin rings like its own (${mate.after.partner.map(m => m.d).join(", ")} m, ${mate.partnerMale ? "blue" : "pink"}); ` +
    `before, filled like any wolf's; another wolf's still filled`);

  // three deer passing minutes apart (1, 5 and 10 minutes ago), each along its own row
  // across the patch, 0.7 s a tile
  const three = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    const uids = sim.allCritters.filter(c => c.species === "deer").slice(0, 3).map(c => c.uid);
    const clear = () => { for (const sp of ["deer", "wolf", "death"]) for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) if (di || dj) S.scentMarks[sp].delete((wi + di) * H + wj + dj); };
    clear();
    const lay = (k, ageS, dj, way) => { for (let n = 0; n < 7; n++) S.scentMarks.deer.set((wi + (way > 0 ? 3 - n : n - 3)) * H + wj + dj, [sim.now - ageS - 0.7 * n, uids[k]]); };
    lay(0, 60, -3, 1); lay(1, 300, 0, -1); lay(2, 600, 3, 1);
    animat.setZoom(2); animat.render();
    const trails = uids.map(uid => animat.scentShown.filter(m => m.species === "deer" && m.uid === uid).sort((a, b) => a.ageS - b.ageS)
      .map(m => ({ i: m.i - wi, j: m.j - wj, d: m.d, fill: m.fill, rank: m.rank })));
    // drawn: the centers of each trail's newest mark, with the marks and without
    const centers = trails.map(t => { const m = t[0], [px, py] = animat.isoProject(wi + m.i + 0.5, wj + m.j + 0.5);
      return animat.worldToScreen(px, py - sim.heightAt(wi + m.i + 0.5, wj + m.j + 0.5) * 8); });
    return { trails, centers };
  });
  await p.screenshot({ path: path.join(outDir, "three-trails.png") });
  const withMarks = await pixels(p, three.centers);
  await p.evaluate(() => { const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) S.scentMarks.deer.delete((wi + di) * H + wj + dj); animat.render(); });
  const without = await pixels(p, three.centers);
  const T = three.trails, top = T.map(t => t[0] && t[0].d);
  r.check(T.every(t => t.length === 7 && ordered(t) && t.at(-1).d < 0.3 * t[0].d),
    `each of three deer's trails, passed 1, 5 and 10 minutes ago, runs small to large the way it was laid (the newest ${T.map(t => (t[0].d / t.at(-1).d).toFixed(1)).join(", ")} times the oldest)`);
  r.check(top[0] > top[1] && top[1] > top[2] && top[0] > 1.6 * top[2],
    `the fresher the trail, the larger overall (their largest marks ${top.map(d => d.toFixed(2)).join(", ")} m)`);
  const same = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 3);
  r.check(T.map(t => t.every(m => m.fill === t[0].fill) && t[0].fill).join() === "1,0.5,0" && !same(withMarks[0], without[0]) && same(withMarks[1], without[1]) && same(withMarks[2], without[2]),
    `and the more filled: the freshest solid, the next a thick ring, the oldest a thin ring (fills ${T.map(t => t[0].fill).join(", ")}; ` +
    `their newest marks' centers ${withMarks.map((c, k) => same(c, without[k]) ? "hollow" : "filled").join(", ")})`);

  // over its own tile's undergrowth: a fresh mark on a bush's tile shows at its center
  const bush = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    const uid = sim.allCritters.find(c => c.species === "deer").uid;
    let t = null;
    for (let di = -3; di <= 3 && !t; di++) for (let dj = -3; dj <= 3 && !t; dj++)
      if ((di || dj) && sim.undergrowthAt(wi + di, wj + dj) === "bush") t = [wi + di, wj + dj];
    if (!t) { // (none about: grows one, for the test)
      t = [wi + 2, wj + 2];
      const real = sim.undergrowthAt;
      sim.undergrowthAt = (i, j) => Math.floor(i) === t[0] && Math.floor(j) === t[1] ? "bush" : real(i, j);
      animat.redrawTerrain();
    }
    for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) S.scentMarks.deer.delete((wi + di) * H + wj + dj);
    S.scentMarks.deer.set(t[0] * H + t[1], [sim.now - 1, uid]);
    animat.render();
    const [px, py] = animat.isoProject(t[0] + 0.5, t[1] + 0.5);
    return { t, at: animat.worldToScreen(px, py - sim.heightAt(t[0] + 0.5, t[1] + 0.5) * 8) };
  });
  const [onBush] = await pixels(p, [bush.at]);
  await p.evaluate(() => { const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) S.scentMarks.deer.delete((wi + di) * H + wj + dj); animat.render(); });
  const [bushOnly] = await pixels(p, [bush.at]);
  r.check(!same(onBush, bushOnly) && onBush[0] > onBush[2] + 30,
    `a mark is drawn over its own tile's undergrowth: brown at a bush's center (${onBush}; the bush alone ${bushOnly})`);

  // a trail alone: the older, the smaller
  const alone = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, H = sim.gridHeightN, wi = Math.floor(w.gx), wj = Math.floor(w.gy);
    const uid = sim.allCritters.find(c => c.species === "deer").uid;
    const top = ageS => {
      for (let n = 0; n < 7; n++) S.scentMarks.deer.set((wi - 3 + n) * H + wj - 3, [sim.now - ageS - 0.7 * (6 - n), uid]);
      animat.render();
      return Math.max(...animat.scentShown.filter(m => m.species === "deer").map(m => m.d));
    };
    return [top(5), top(60), top(600), top(4800)];
  });
  r.check(alone.every((d, k) => k === 0 || d < alone[k - 1]) && alone[0] > 1.5 * alone[3],
    `a trail alone is smaller the older it is (fresh, 1, 10 and 80 minutes old: its largest mark ${alone.map(d => d.toFixed(2)).join(", ")} m)`);

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
