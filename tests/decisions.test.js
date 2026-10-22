// Senses and decisions (senses.js, mind.js):
//  - sight: every creature within 10 tiles, nothing further
//  - a deer flees a wolf it sees; a wolf chases a deer it sees
//  - memory: a deer keeps fleeing a wolf it can no longer see, and a wolf keeps after a
//    deer it can no longer see, toward where the deer was heading
//  - forgetting: both give up once the sighting is old enough
//  - no dithering: a wolf with two deer about as near in opposite directions picks the
//    one ahead of it and keeps to it, without flipping between them
//  - a chase ends in a kill: a wolf runs down a tired deer
// Each encounter is set up on open land (no water or boulders nearby) with every other
// critter parked off the map and left alone by the mind, and the two starting with no
// memories.

const { openGame, runStandalone } = require("./helpers");

// in the page: put a wolf and a deer on open dry ground, everyone else away
function setup({ deerAt, deer2At = null, wolfThinks = true, deerThinks = true }) {
  sim.pause();
  const w = sim.internals.wolves[1], d = sim.internals.deer[0];
  const d2 = deer2At ? sim.internals.deer[1] : null;
  sim.allCritters.filter(c => c !== w && c !== d && c !== d2).forEach(c => {
    c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c);
  });
  const R = 6;
  const dry = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
  const t = sim.internals.allLandTiles.find(([i, j]) => {
    if (i < R || j < R || i >= sim.gridWidthN - R || j >= sim.gridHeightN - R) return false;
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) if (!dry(i + di, j + dj)) return false;
    return true;
  });
  if (!t) return null;
  w.gx = w.nextGX = t[0] + 0.5; w.gy = w.nextGY = t[1] + 0.5;
  d.gx = d.nextGX = w.gx + deerAt[0]; d.gy = d.nextGY = w.gy + deerAt[1];
  if (d2) { d2.gx = d2.nextGX = w.gx + deer2At[0]; d2.gy = d2.nextGY = w.gy + deer2At[1]; }
  for (const c of [w, d, d2].filter(Boolean)) {
    c.wind = 1; c.stamina = 1; sim.internals.setCritterIdle(c);
    mind.ignore(c, c === w ? !wolfThinks : !deerThinks);
    mind.forget(c); // nothing remembered from before the test
  }
  window.__w = w; window.__d = d; window.__d2 = d2;
  return t;
}

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 650 } });
  const fresh = async () => {
    await p.reload(); await p.waitForTimeout(300);
    await p.evaluate(`window.setup = ${setup.toString()}`);
  };

  // 1. sight: within 10 tiles only
  const sight = await p.evaluate(() => {
    sim.pause();
    const w = sim.internals.wolves[1], [d1, d2] = sim.internals.deer;
    d1.gx = w.gx + 6; d1.gy = w.gy + 7.9;     // 9.98 tiles away
    d2.gx = w.gx - 7; d2.gy = w.gy + 7.2;     // 10.04 tiles away
    const seen = senses.perceive(w).map(o => o.uid);
    return { near: seen.includes(d1.uid), far: seen.includes(d2.uid) };
  });
  r.check(sight.near && !sight.far, `sight reaches 10 tiles and no further (9.98: ${sight.near}, 10.04: ${sight.far})`);

  // 2. a deer flees a wolf in sight
  await fresh();
  const flee = await p.evaluate(`(() => {
    if (!setup({ deerAt: [4, 4], wolfThinks: false })) return null;
    const [w, d] = [__w, __d];
    const d0 = Math.hypot(d.gx - w.gx, d.gy - w.gy);
    for (let n = 0; n < 30; n++) sim.internals.tick();
    return { d0, d1: Math.hypot(d.gx - w.gx, d.gy - w.gy), mode: mind.stateOf(d).mode, pose: d.pose };
  })()`);
  r.check(flee && flee.mode === "flee" && flee.d1 > flee.d0 + 3,
    `a deer flees a wolf it sees (${flee && flee.d0.toFixed(1)} -> ${flee && flee.d1.toFixed(1)} tiles in 0.5 s, ${flee && flee.pose})`);

  // 3. a wolf chases a deer in sight
  await fresh();
  const chase = await p.evaluate(`(() => {
    if (!setup({ deerAt: [5, 5], deerThinks: false })) return null;
    const [w, d] = [__w, __d];
    const d0 = Math.hypot(d.gx - w.gx, d.gy - w.gy);
    for (let n = 0; n < 15; n++) sim.internals.tick();
    return { d0, d1: Math.hypot(d.gx - w.gx, d.gy - w.gy), mode: mind.stateOf(w).mode, pose: w.pose };
  })()`);
  r.check(chase && chase.mode === "chase" && chase.d1 < chase.d0 - 1,
    `a wolf chases a deer it sees (${chase && chase.d0.toFixed(1)} -> ${chase && chase.d1.toFixed(1)} tiles in 0.25 s, ${chase && chase.pose})`);

  // 4. a deer remembers a wolf it can no longer see
  await fresh();
  const deerMem = await p.evaluate(`(() => {
    if (!setup({ deerAt: [4, 4], wolfThinks: false })) return null;
    const [w, d] = [__w, __d];
    sim.internals.tick();                                   // sees the wolf
    const wolfWas = [w.gx, w.gy];
    w.gx = w.gy = w.nextGX = w.nextGY = -90;                // the wolf vanishes from sight
    const from0 = Math.hypot(d.gx - wolfWas[0], d.gy - wolfWas[1]);
    for (let n = 0; n < 120; n++) sim.internals.tick();     // 2 s
    const s2 = mind.stateOf(d);
    const from2 = Math.hypot(d.gx - wolfWas[0], d.gy - wolfWas[1]);
    const seesWolf = senses.perceive(d).some(o => o.species === "wolf");
    for (let n = 0; n < 15 * 60; n++) sim.internals.tick(); // 15 s more
    return { from0, from2, mode2: s2.mode, seesWolf, modeLater: mind.stateOf(d).mode };
  })()`);
  r.check(deerMem && !deerMem.seesWolf && deerMem.mode2 === "flee" && deerMem.from2 > deerMem.from0 + 5,
    `out of sight, a deer keeps fleeing where it last saw the wolf (${deerMem && deerMem.from0.toFixed(1)} -> ` +
    `${deerMem && deerMem.from2.toFixed(1)} tiles from that spot after 2 s)`);
  r.check(deerMem && deerMem.modeLater === "calm", `...and calms down later (17 s on: ${deerMem && deerMem.modeLater})`);

  // 5. a wolf remembers a deer it can no longer see, and where it was going
  await fresh();
  const wolfMem = await p.evaluate(`(() => {
    if (!setup({ deerAt: [3, -3], deerThinks: false })) return null;
    const [w, d] = [__w, __d];
    sim.internals.setCritterMoving(d, sim.DIR_E, "trot");    // the deer heads east...
    sim.internals.tick();                                     // ...the wolf sees it
    const seen = [d.gx, d.gy];
    d.gx = d.gy = d.nextGX = d.nextGY = -90; d.speed = 0;    // ...and loses it
    const w0 = [w.gx, w.gy];
    for (let n = 0; n < 60; n++) sim.internals.tick();       // 1 s
    const s = mind.stateOf(w);
    const seesDeer = senses.perceive(w).some(o => o.species === "deer");
    for (let n = 0; n < 21 * 60; n++) sim.internals.tick();  // 21 s more
    return { seen, w0, w1: [w.gx, w.gy], mode: s.mode, seesDeer, modeLater: mind.stateOf(w).mode };
  })()`);
  const east = wolfMem && wolfMem.w1[0] - wolfMem.w0[0];
  r.check(wolfMem && !wolfMem.seesDeer && wolfMem.mode === "chase" && east > 2,
    `out of sight, a wolf keeps after a deer, the way it was heading (moved ${east && east.toFixed(1)} tiles east in 1 s, ${wolfMem && wolfMem.mode})`);
  r.check(wolfMem && wolfMem.modeLater === "calm", `...and gives up later (22 s on: ${wolfMem && wolfMem.modeLater})`);

  // 6. two deer about as near, in opposite directions: the wolf picks the one it faces
  // (though the other is a little nearer) and keeps to it
  await fresh();
  const two = await p.evaluate(`(() => {
    if (!setup({ deerAt: [4, -4], deer2At: [-3.8, 3.8], deerThinks: false })) return null;
    const [w, ahead, behind] = [__w, __d, __d2];
    w.currentDirection = sim.DIR_NE;                       // facing the first deer
    const targets = [], dirs = [];
    for (let n = 0; n < 90; n++) {                          // 1.5 s
      sim.internals.tick();
      targets.push(mind.stateOf(w).target); dirs.push(w.currentDirection);
    }
    let turns = 0;
    for (let n = 1; n < dirs.length; n++) if (dirs[n] !== dirs[n - 1]) turns++;
    // kept: never went for the other one (it may catch this one, and then rest)
    return { first: targets[0], ahead: ahead.uid, kept: !targets.includes(behind.uid), turns,
      caught: ahead.pose === "death" || ahead.pose === "dead" };
  })()`);
  r.check(two && two.first === two.ahead && two.kept && two.turns <= 2,
    `two deer about as near, opposite ways: the wolf picks the one ahead and keeps to it ` +
    `(${two && (two.first === two.ahead ? "ahead" : "behind")}, ${two && (two.kept ? "kept" : "switched")}, ` +
    `${two && two.turns} turns in 1.5 s${two && two.caught ? ", caught it" : ""})`);

  // 7. a chase ends in a kill: a tired deer can only walk
  await fresh();
  const kill = await p.evaluate(`(() => {
    if (!setup({ deerAt: [5, 4] })) return null;
    const [w, d] = [__w, __d];
    d.wind = 0; d.stamina = 0;
    let n = 0;
    for (; n < 30 * 60 && d.pose !== "death" && d.pose !== "dead"; n++) sim.internals.tick();
    for (let k = 0; k < 120; k++) sim.internals.tick();
    return { s: n / 60, pose: d.pose, wolfMode: mind.stateOf(w).mode };
  })()`);
  r.check(kill && (kill.pose === "death" || kill.pose === "dead"),
    `a wolf runs down a tired deer (killed after ${kill && kill.s.toFixed(1)} s; the wolf then ${kill && kill.wolfMode}s)`);
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "senses and decisions", main };
if (require.main === module) runStandalone(module.exports.name, main);
