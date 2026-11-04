// Remembered corpses and sleepers (see REMEMBERED in animat.js), in the sight view:
//  - a corpse the wolf has seen stays drawn, greyed out, where it lay once the wolf turns
//    away from it (it doesn't vanish), though it isn't seen (not pickable)
//  - one it never saw isn't drawn
//  - one gone while unseen is still drawn, until the wolf sees the ground where it lay:
//    then it is forgotten
//  - a sleeping critter likewise; an awake one isn't remembered
// Saves a screenshot to tests/output/remembered/.

const path = require("path");
const { openGame, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

const colourOf = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);

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
  const outDir = ensureOutputDir("remembered");
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 6, clearOthers: true });
  await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    mind.ignore(w);
    // the wolf faces (hx, hy) a while (its sight is worked out again as it turns)
    window.__face = (hx, hy, pose = null) => {
      for (let n = 0; n < 30; n++) {
        w.hx = hx; w.hy = hy; S.setCritterIdle(w); w.hx = hx; w.hy = hy;
        S.tick();
        if (pose) pose();
        animat.render();
      }
    };
    window.__deer = sim.allCritters.filter(c => c.species === "deer").slice(0, 4);
    window.__put = (a, di, dj) => { a.gx = a.nextGX = Math.floor(w.gx) + di + 0.5; a.gy = a.nextGY = Math.floor(w.gy) + dj + 0.5;
      a.speed = 0; a.lifespanS = 1e12; S.setCritterIdle(a); mind.ignore(a); };
    animat.setZoom(4); animat.followWolf();
  });

  // the ground 3 tiles east, unseen (the wolf facing west), before any corpse lies there
  const rect = await p.evaluate(() => {
    const d = __deer[0];
    __put(d, 3, 0); __face(1, 0);
    sim.internals.startCritterDeath(d, "predation");
    for (let n = 0; n < (sim.deathDurationSBySpecies.deer + 1) / sim.tempo; n++) sim.internals.tick();
    __face(1, 0); // (seen, dead)
    const c = sim.allCorpses.find(c => c.uid === d.uid), rec = animat.spriteOf(c);
    const tl = animat.worldToScreen(rec.left, rec.top), br = animat.worldToScreen(rec.left + rec.w, rec.top + rec.h);
    return { uid: d.uid, seen: !rec.hidden, carcass: !!c.carcass, tl, br };
  });
  const probes = [];
  for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++)
    probes.push([rect.tl[0] + (rect.br[0] - rect.tl[0]) * a / 8, rect.tl[1] + (rect.br[1] - rect.tl[1]) * b / 8]);
  // turned away: what is drawn there, with the corpse remembered and (hidden by a test
  // switch) without it
  await p.evaluate(() => __face(-1, 0));
  const turned = await p.evaluate(uid => {
    const c = sim.allCorpses.find(c => c.uid === uid), rec = animat.spriteOf(c), s = animat.spriteRect(rec);
    return { hidden: rec.hidden, remembered: animat.remembered().includes(uid),
      picked: animat.critterAtScreen((s.left + s.right) / 2, (s.top + s.bottom) / 2) === c };
  }, rect.uid);
  const withIt = await pixels(p, probes);
  await p.screenshot({ path: path.join(outDir, "remembered.png") });
  await p.evaluate(uid => { animat.showOnly([sim.pcWolf]); }, rect.uid);
  const withoutIt = await pixels(p, probes);
  await p.evaluate(() => animat.showOnly(null));
  const changed = probes.map((_, k) => k).filter(k => withIt[k].some((v, c) => Math.abs(v - withoutIt[k][c]) > 3));
  r.check(rect.seen && rect.carcass && turned.hidden && !turned.picked && turned.remembered && changed.length >= 5 && changed.every(k => colourOf(withIt[k]) <= 3),
    `a carcass the wolf saw stays drawn, greyed out, once it turns away (not seen: ${turned.hidden}; picked by a click: ${turned.picked}; ` +
    `${changed.length} of ${probes.length} points of its frame drawn, all without colour)`);

  // one it never saw (killed behind it, out of its field of view) isn't drawn
  const unseen = await p.evaluate(() => {
    const d = __deer[1];
    __put(d, 3, 2);
    sim.internals.startCritterDeath(d, "predation");
    for (let n = 0; n < (sim.deathDurationSBySpecies.deer + 1) / sim.tempo; n++) sim.internals.tick();
    __face(-1, 0);
    return { remembered: animat.remembered().includes(d.uid), hidden: animat.spriteOf(sim.allCorpses.find(c => c.uid === d.uid)).hidden };
  });
  r.check(unseen.hidden && !unseen.remembered, `a corpse it never saw isn't drawn (${JSON.stringify(unseen)})`);

  // gone while unseen: still drawn, until it sees where it lay
  const gone = await p.evaluate(uid => {
    const k = sim.allCorpses.findIndex(c => c.uid === uid);
    sim.allCorpses.splice(k, 1);
    __face(-1, 0);
    const kept = animat.remembered().includes(uid);
    __face(1, 0);
    return { kept, forgotten: !animat.remembered().includes(uid) };
  }, rect.uid);
  r.check(gone.kept && gone.forgotten,
    `a corpse gone while unseen is still drawn (${gone.kept}), until the wolf sees where it lay: then forgotten (${gone.forgotten})`);

  // a sleeping critter likewise; an awake one isn't remembered
  const sleepers = await p.evaluate(() => {
    const [, , asleep, awake] = __deer;
    __put(asleep, 3, -1); __put(awake, 3, 1);
    const sleep = () => { asleep.pose = "sleep"; };
    __face(1, 0, sleep);
    const seen = [!animat.spriteOf(asleep).hidden, !animat.spriteOf(awake).hidden];
    __face(-1, 0, sleep);
    return { seen, asleep: animat.remembered().includes(asleep.uid), awake: animat.remembered().includes(awake.uid),
      hidden: animat.spriteOf(asleep).hidden };
  });
  r.check(sleepers.seen.every(Boolean) && sleepers.hidden && sleepers.asleep && !sleepers.awake,
    `a sleeping deer it saw is remembered once out of sight (${sleepers.asleep}); an awake one isn't (${sleepers.awake})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "remembered corpses and sleepers", main };
if (require.main === module) runStandalone(module.exports.name, main);
