// Speed changes (see SPEED CHANGES in sim.js): a critter's speed changes at most by
// SPEEDS.accelMaxMps2 a second at low speed, and faster by no more than its power allows
// (SPEEDS.powerWPerKg), the same up as down: from standing it reaches a full gallop (and
// stops from one) in the time that works out to (a wolf about 2.3 s, a deer 1.9), quick off
// the mark and slow near the top. Its gait (pose) changes at
// once; told to stop, it keeps its moving pose until it has stopped, then idles. A stun
// stops it dead.

const { openGame, moveToOpenLand, runStandalone } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser);
  await p.evaluate(() => sim.pause());
  await moveToOpenLand(p, { radius: 10, clearOthers: true });
  const res = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf, out = {};
    const d = sim.allCritters.find(c => c.species === "deer" && sim.isLiveCritter(c));
    mind.ignore(w); mind.ignore(d);
    for (const a of [w, d]) {
      // on the open land, alone (the other off the map meanwhile)
      const other = a === w ? d : w, home = [w.gx, w.gy];
      other.gx = other.nextGX = -80; other.gy = other.nextGY = -80;
      a.gx = a.nextGX = home[0]; a.gy = a.nextGY = home[1];
      a.speed = 0; S.setCritterIdle(a); a.wind = a.stamina = 1; a.stunnedUntil = 0;
      const full = S.travelSpeedBySpeciesAndPose[a.species].gallop;
      const back = () => { a.gx = a.nextGX = home[0]; a.gy = a.nextGY = home[1]; a.wind = a.stamina = 1; };
      S.setCritterMoving(a, sim.DIR_E, "gallop");
      a.hx = a.wantHx; a.hy = a.wantHy; // (already facing that way)
      const pose0 = a.pose;
      let up = 0;
      const speeds = [];
      for (; up < 600 && a.speed < full; up++) { S.tick(); back(); speeds.push(a.speed / sim.tempo); }
      // (gained in the first quarter second, and in the last)
      const q = Math.round(0.25 / sim.tempo), first = speeds[q - 1], last = speeds.at(-1) - speeds.at(-1 - q);
      S.setCritterIdle(a);
      const poses = new Set();
      let down = 0;
      for (; down < 600 && a.speed > 0; down++) { poses.add(a.pose); S.tick(); back(); }
      S.tick();
      out[a.species] = { pose0, upS: up * sim.tempo, downS: down * sim.tempo, posesWhileStopping: [...poses],
        poseAfter: a.pose, first: +first.toFixed(2), last: +last.toFixed(2), wantFirst: S.SPEEDS.accelMaxMps2[a.species] * 0.25 };
      // the time worked out: at accelMaxMps2 up to the speed where the power runs short, then
      // power-limited (dv/dt = P / v: t = (v2^2 - v1^2) / 2P)
      const A = S.SPEEDS.accelMaxMps2[a.species], P = S.SPEEDS.powerWPerKg[a.species], vg = full / sim.tempo, v1 = Math.min(vg, P / A);
      out[a.species].wantS = +(v1 / A + (vg * vg - v1 * v1) / (2 * P)).toFixed(2);
      // a stun stops it dead
      S.setCritterMoving(a, sim.DIR_E, "gallop");
      for (let k = 0; k < 30; k++) { S.tick(); back(); }
      const before = a.speed; S.stun(a);
      out[a.species].stun = { before, after: a.speed, pose: a.pose };
      a.stunnedUntil = 0; S.setCritterIdle(a); a.speed = 0; S.tick();
    }
    return out;
  });
  for (const sp of ["wolf", "deer"]) {
    const x = res[sp];
    r.check(x.pose0 === "gallop" && Math.abs(x.upS - x.wantS) < 0.05,
      `a ${sp} reaches a full gallop from standing in ${x.upS.toFixed(2)} s (${x.wantS} s), galloping from the start`);
    r.check(Math.abs(x.first - x.wantFirst) < 0.01 && x.last < 0.6 * x.first,
      `...quick off the mark, ${x.first} m/s in the first quarter second (${x.wantFirst}), slow near the top (${x.last} m/s in the last)`);
    r.check(Math.abs(x.downS - x.wantS) < 0.05 && x.posesWhileStopping.join() === "gallop" && x.poseAfter === "idle",
      `...stops from one in ${x.downS.toFixed(2)} s, galloping until stopped, then idle (${x.posesWhileStopping}, then ${x.poseAfter})`);
    r.check(x.stun.before > 0 && x.stun.after === 0 && x.stun.pose === "idle",
      `...and a stun stops it dead (speed ${x.stun.before.toFixed(3)} -> ${x.stun.after})`);
  }
  r.noProblems(p);
  await p.close();
}

module.exports = { name: "speed changes (acceleration)", main };
if (require.main === module) runStandalone(module.exports.name, main);
