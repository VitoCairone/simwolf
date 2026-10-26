// Day and night, and sleep (see DAY AND NIGHT and SLEEP in sim.js, sleep in mind.js,
// sightShare in senses.js):
//  - days are long in summer and short in winter, as at 45 degrees north; a game day lasts
//    SPEEDS.dayLengthS (GAMIFIED: 10 minutes); the light is full by day, none at night, between in the twilight
//  - grass grows only while the sun is up, faster by the year's share of daylight, so a
//    year's growth is as before
//  - the wakeful meter empties awake over wakeLastsS and fills asleep over sleepFillS, as
//    much of the day asleep as the species sleeps (a wolf a third, a deer about a quarter);
//    asleep, a critter lies down; any other intent gets it up; at empty it collapses and
//    sleeps whatever it is told until forcedWakeAt
//  - critters sleep at their time of rest when the meter is low: a wolf by day, a deer in
//    the dark or around midday; a sleeping deer that hears a wolf wakes and flees
//  - sight shrinks at night (a wolf sees less far than a deer); asleep, a critter sees
//    nothing
//  - the wakeful meter is drawn in purple, for the player's wolf and an inspected critter;
//    sleepers are drawn lying down
// Saves a screenshot of sleepers to tests/output/daynight/.

const path = require("path");
const { openGame, moveToOpenLand, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 900, height: 600 }, dayNight: true });
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 8, clearOthers: true });
  // the player's wolf stands aside, left alone
  await p.evaluate(() => { const w = sim.pcWolf; window.home = [w.gx, w.gy]; mind.ignore(w); w.gx = w.nextGX = w.gx - 12; w.gy = w.nextGY = w.gy - 12; });

  // the clock and the light
  const clock = await p.evaluate(() => {
    const S = sim.internals, out = {};
    out.summer = sim.daylightHoursAt(79 + 92); out.winter = sim.daylightHoursAt(79 + 275); out.equinox = sim.daylightHoursAt(79);
    out.mean = sim.meanDaylightShare;
    const R = S.REALISTIC, G = S.GAMIFIED;
    out.days = { real: R.dayLengthS / 3600, game: G.dayLengthS };
    const light = h => { S.holdClock(h); return sim.clock.light; };
    out.light = { noon: light(12), midnight: light(0), dusk: light(18.2), late: light(19) };
    S.holdClock(null);
    const h0 = sim.clock.hour;
    for (let k = 0; k < Math.round(sim.dayLengthS / 40 / sim.tempo); k++) S.tick();
    out.fortieth = (sim.clock.hour - h0 + 24) % 24;
    return out;
  });
  r.check(Math.abs(clock.summer - 15.4) < 0.2 && Math.abs(clock.winter - 8.6) < 0.2 && Math.abs(clock.equinox - 12) < 0.1
    && Math.abs(clock.mean - 0.5) < 0.01,
    `at 45 degrees north the sun is up ${clock.summer.toFixed(1)} h at midsummer, ${clock.winter.toFixed(1)} h at midwinter, ${clock.equinox.toFixed(1)} h at the equinox (a year's share ${clock.mean.toFixed(3)})`);
  r.check(clock.days.real === 24 && clock.days.game === 600 && Math.abs(clock.fortieth - 0.6) < 0.01,
    `a day is 24 h in REALISTIC, ${clock.days.game / 60} minutes in GAMIFIED; a fortieth of it passes 0.6 h (${clock.fortieth.toFixed(3)})`);
  r.check(clock.light.noon === 1 && clock.light.midnight === 0 && clock.light.dusk > 0 && clock.light.dusk < 1 && clock.light.late === 0,
    `the light: full at noon, none at midnight, fading in the dusk (${JSON.stringify(clock.light)})`);

  // grass by daylight
  const grass = await p.evaluate(() => {
    const S = sim.internals, H = sim.gridHeightN;
    const [i, j] = S.allLandTiles.find(([i, j]) => sim.getTerrainAt(i, j) === "grass" && !sim.isBlockedTile(i, j));
    const grow = hour => {
      S.holdClock(hour); S.setGrassKg(i * H + j, 0);
      for (let k = 0; k < 600; k++) S.tick(); // 10 s
      return sim.grassFoodAt(i, j);
    };
    const day = grow(12), night = grow(0);
    S.holdClock(null);
    return { day, night, expect: 10 * S.SPEEDS.grassRegrowKgPerS / sim.meanDaylightShare };
  });
  r.check(grass.night === 0 && Math.abs(grass.day / grass.expect - 1) < 0.15,
    `grass grows only while the sun is up, faster by the year's share of daylight (${(grass.day * 1000).toFixed(3)} g by day in 10 s, ${grass.night} by night)`);

  // the wakeful meter and sleeping
  const wake = await p.evaluate(() => {
    const S = sim.internals, out = {};
    S.holdClock(12);
    const deer = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c) && sim.isLiveCritter(c));
    deer.gx = deer.nextGX = home[0] + 2; deer.gy = deer.nextGY = home[1]; deer.speed = 0; S.setCritterIdle(deer);
    mind.ignore(deer); deer.wake = 0.8; deer.lifespanS = 1e9; deer.food = 1;
    const run = s => { for (let k = 0; k < s / sim.tempo; k++) S.tick(); };
    sim.setIntent(deer, { gait: "idle" }); run(1);
    out.drain = (0.8 - deer.wake) / 1; out.drainExpect = 1 / S.SPEEDS.wakeLastsS.deer;
    sim.setIntent(deer, { gait: "sleep" }); run(0.5);
    out.lies = deer.pose; const w0 = deer.wake; run(1);
    out.fill = deer.wake - w0; out.fillExpect = 1 / S.SPEEDS.sleepFillS.deer;
    sim.setIntent(deer, { dx: 1, dy: 0, gait: "walk" }); run(0.5);
    out.up = deer.pose;
    // collapse at empty, while walking
    deer.wake = 0.002; run(1.5);
    out.collapsed = { pose: deer.pose, forced: deer.sleepForced };
    sim.setIntent(deer, { dx: -1, dy: 0, gait: "trot" }); run(0.5);
    out.ignores = deer.pose;
    let k = 0; for (; k < 60 / sim.tempo && deer.sleepForced; k++) S.tick();
    out.forcedUntil = deer.wake; run(0.5); out.thenUp = deer.pose;
    const share = sp => S.REALISTIC.sleepFillS[sp] / (S.REALISTIC.sleepFillS[sp] + S.REALISTIC.wakeLastsS[sp]);
    out.share = { wolf: share("wolf"), deer: share("deer") };
    return out;
  });
  r.check(Math.abs(wake.drain / wake.drainExpect - 1) < 0.05 && wake.lies === "sleep" && Math.abs(wake.fill / wake.fillExpect - 1) < 0.05 && wake.up === "walk",
    `the wakeful meter empties awake over wakeLastsS and fills lying asleep over sleepFillS; told to walk, it gets up (${JSON.stringify({ lies: wake.lies, up: wake.up })})`);
  r.check(Math.abs(wake.share.wolf - 1 / 3) < 1e-9 && Math.abs(wake.share.deer - 6.3 / 24) < 1e-9,
    `asleep, as much of the day as the species sleeps: a wolf ${(wake.share.wolf * 24).toFixed(1)} h, a deer ${(wake.share.deer * 24).toFixed(1)} h`);
  r.check(wake.collapsed.pose === "sleep" && wake.collapsed.forced && wake.ignores === "sleep"
    && Math.abs(wake.forcedUntil - sim_forcedWakeAt) < 0.01 && wake.thenUp !== "sleep",
    `at empty it collapses where it is, sleeping whatever it's told until ${sim_forcedWakeAt} (${JSON.stringify(wake.collapsed)}, then ${wake.thenUp})`);

  // the mind: when each sleeps
  const when = await p.evaluate(() => {
    const S = sim.internals;
    const wolf = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isGrown(c) && sim.isLiveCritter(c));
    const deer = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c) && sim.isLiveCritter(c));
    const out = {};
    // each alone (the other parked far off, beyond every sense)
    const alone = (c, hour) => {
      S.holdClock(hour);
      const other = c === wolf ? deer : wolf;
      other.gx = other.nextGX = other.gy = other.nextGY = -900; mind.ignore(other);
      c.gx = c.nextGX = home[0]; c.gy = c.nextGY = home[1] + 6; c.speed = 0; c.stunnedUntil = 0;
      c.sleepForced = false; c.wantsSleep = false; S.setCritterIdle(c); if (c.pose === "sleep") c.pose = "idle";
      c.wake = 0.4; c.food = 0.95; c.lifespanS = 1e9; mind.forget(c); mind.ignore(c, false);
      for (let k = 0; k < 30; k++) S.tick();
      return mind.stateOf(c).mode;
    };
    const at = hour => ({ wolf: alone(wolf, hour), deer: alone(deer, hour) });
    out.morning = at(9); out.noon = at(13); out.midnight = at(0);
    // a sleeping deer hears a wolf galloping up
    const d = deer, w = wolf;
    alone(deer, 0);
    for (let k = 0; k < 60; k++) S.tick();
    w.gx = w.nextGX = d.gx - 9; w.gy = w.nextGY = d.gy; mind.ignore(w); w.wind = w.stamina = 1; w.wake = 1;
    sim.setIntent(w, { dx: 1, dy: 0, gait: "gallop" });
    const asleep = d.pose === "sleep";
    let fled = false;
    for (let k = 0; k < 60 && !fled; k++) { S.tick(); fled = mind.stateOf(d).mode === "flee"; }
    out.wakes = { asleep, fled, pose: d.pose };
    mind.ignore(w); mind.ignore(d);
    S.holdClock(12);
    return out;
  });
  r.check(when.morning.wolf === "sleep" && when.morning.deer !== "sleep" && when.noon.wolf === "sleep" && when.noon.deer === "sleep"
    && when.midnight.wolf !== "sleep" && when.midnight.deer === "sleep",
    `with the meter low, a wolf sleeps by day, a deer in the dark and around midday (${JSON.stringify({ morning: when.morning, noon: when.noon, midnight: when.midnight })})`);
  r.check(when.wakes.asleep && when.wakes.fled && when.wakes.pose !== "sleep",
    `a sleeping deer that hears a wolf galloping up wakes and flees (${JSON.stringify(when.wakes)})`);

  // sight by day and night, and asleep
  const sight = await p.evaluate(() => {
    const S = sim.internals;
    senses.use.hearing = senses.use.smell = false;
    const wolf = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isGrown(c) && sim.isLiveCritter(c));
    const deer = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c) && sim.isLiveCritter(c));
    const put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.sleepForced = c.wantsSleep = false; S.setCritterIdle(c); c.pose = "idle"; };
    // 6 tiles apart along the screen's vertical (dx + dy = 12 of the 25.3 half-height)
    put(wolf, home[0] - 3, home[1] - 3); put(deer, home[0] + 3, home[1] + 3);
    const sees = (a, b) => senses.perceive(a).some(o => o.uid === b.uid && o.by === "sight");
    S.holdClock(12); const day = [sees(wolf, deer), sees(deer, wolf)];
    S.holdClock(0); const night = [sees(wolf, deer), sees(deer, wolf)];
    S.holdClock(12); deer.pose = "sleep"; const asleep = sees(deer, wolf); deer.pose = "idle";
    senses.use.hearing = senses.use.smell = true;
    return { day, night, asleep, share: senses.nightSightShare };
  });
  r.check(sight.day.every(Boolean) && sight.night[0] === false && sight.night[1] === true && sight.asleep === false,
    `12 tiles apart (on screen) they see each other by day; at night only the deer sees the wolf (keeping ${JSON.stringify(sight.share)} of their sight); asleep, a deer sees nothing`);

  // drawing: purple meters, sleepers lying down
  const drawn = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    const wolf = sim.allCritters.find(c => c.species === "wolf" && c !== w && sim.isGrown(c) && sim.isLiveCritter(c));
    const deer = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c) && sim.isLiveCritter(c));
    [[wolf, 1.5, -1], [deer, -1, 1.5]].forEach(([c, dx, dy]) => {
      c.gx = c.nextGX = home[0] + dx; c.gy = c.nextGY = home[1] + dy; c.speed = 0; c.sleepForced = false; c.wantsSleep = false;
      S.setCritterIdle(c); mind.ignore(c); sim.setIntent(c, { gait: "sleep" }); c.wake = 0.4;
    });
    mind.ignore(w); w.wake = 0.7; S.setCritterIdle(w);
    for (let k = 0; k < 20; k++) S.tick();
    animat.pinCamera(deer); animat.setZoom(4); animat.render();
    const fill = id => document.getElementById(id);
    const cols = (c, fw) => Math.round(-parseFloat(animat.spriteEl(c).style.backgroundPosition.split(" ")[0]) / fw);
    const wolfCols = new Set();
    for (let k = 0; k < 200; k++) { S.tick(); animat.render(); wolfCols.add(cols(wolf, 64)); }
    return { own: parseFloat(fill("wake-meter-fill").style.width), ownWake: w.wake, color: getComputedStyle(fill("wake-meter-fill")).backgroundColor,
      inspected: parseFloat(fill("inspect-wake-fill").style.width), deerWake: deer.wake,
      wolf: { pose: wolf.pose, cls: animat.spriteEl(wolf).className, cols: [...wolfCols].sort() },
      deer: { pose: deer.pose, cls: animat.spriteEl(deer).className, col: cols(deer, 48) } };
  });
  r.check(Math.abs(drawn.own - 100 * drawn.ownWake) < 1 && drawn.color === "rgb(106, 47, 160)" && Math.abs(drawn.inspected - 100 * drawn.deerWake) < 1,
    `the wakeful meter is drawn in purple, for the player's wolf (${drawn.own.toFixed(0)}%) and the inspected deer (${drawn.inspected.toFixed(0)}%)`);
  r.check(drawn.wolf.pose === "sleep" && drawn.wolf.cols.join() === "48,49" && drawn.deer.pose === "sleep"
    && /deer-death/.test(drawn.deer.cls) && drawn.deer.col === 2,
    `sleepers are drawn lying down: a wolf on its side, breathing (columns ${drawn.wolf.cols}), a deer bedded down (${drawn.deer.cls}, column ${drawn.deer.col})`);
  const outDir = ensureOutputDir("daynight");
  await p.screenshot({ path: path.join(outDir, "sleepers.png") });

  r.noProblems(p);
  await p.close();
}

const sim_forcedWakeAt = 0.3; // (sim.forcedWakeAt)

module.exports = { name: "day and night, sleep", main };
if (require.main === module) runStandalone(module.exports.name, main);
