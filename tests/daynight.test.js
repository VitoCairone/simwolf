// Day and night (see DAY AND NIGHT in sim.js, sightShare in senses.js):
//  - days are long in summer and short in winter, as at 45 degrees north; a game day lasts
//    SPEEDS.dayLengthS (GAMIFIED: 10 minutes); the light is full by day, none at night, between in the twilight
//  - grass grows only while the sun is up, faster by the year's share of daylight, so a
//    year's growth is as before
//  - sight shrinks at night (a wolf sees less far than a deer)
//  - sleep is off: through a minute of play at dusk no critter lies down to sleep, and no
//    wakeful meter is drawn

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

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

  // sight by day and night
  const sight = await p.evaluate(() => {
    const S = sim.internals;
    senses.use.hearing = senses.use.smell = false;
    const wolf = sim.allCritters.find(c => c.species === "wolf" && c !== sim.pcWolf && sim.isGrown(c) && sim.isLiveCritter(c));
    const deer = sim.allCritters.find(c => c.species === "deer" && sim.isGrown(c) && sim.isLiveCritter(c));
    const put = (c, x, y) => { c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; S.setCritterIdle(c); c.pose = "idle"; };
    // 6 tiles apart along the screen's vertical (dx + dy = 12 of the 25.3 half-height)
    put(wolf, home[0] - 3, home[1] - 3); put(deer, home[0] + 3, home[1] + 3);
    const sees = (a, b) => senses.perceive(a).some(o => o.uid === b.uid && o.by === "sight");
    S.holdClock(12); const day = [sees(wolf, deer), sees(deer, wolf)];
    S.holdClock(0); const night = [sees(wolf, deer), sees(deer, wolf)];
    S.holdClock(12);
    senses.use.hearing = senses.use.smell = true;
    return { day, night, share: senses.nightSightShare };
  });
  r.check(sight.day.every(Boolean) && sight.night[0] === false && sight.night[1] === true,
    `12 tiles apart (on screen) they see each other by day; at night only the deer sees the wolf (keeping ${JSON.stringify(sight.share)} of their sight)`);

  // sleep is off: a minute of play at dusk (when wolves woke and deer bedded down)
  const awake = await p.evaluate(() => {
    const S = sim.internals;
    S.holdClock(19);
    sim.allCritters.forEach(c => { mind.ignore(c, c === sim.pcWolf); c.lifespanS = 1e9; });
    const poses = new Set(), intents = new Set();
    for (let k = 0; k < 60 / sim.tempo; k += 10) {
      for (let n = 0; n < 10; n++) S.tick();
      sim.allCritters.forEach(c => { poses.add(c.pose); intents.add(mind.stateOf(c)?.mode); });
    }
    return { sleeping: poses.has("sleep") || intents.has("sleep"), meters: ["wake-meter-fill", "inspect-wake-fill"].filter(id => document.getElementById(id)).length,
      hasWake: sim.allCritters.some(c => "wake" in c) };
  });
  r.check(!awake.sleeping && awake.meters === 0 && !awake.hasWake,
    `sleep is off: through a minute at dusk no critter sleeps, and there is no wakeful meter (${JSON.stringify(awake)})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "day and night", main };
if (require.main === module) runStandalone(module.exports.name, main);
