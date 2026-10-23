// Speed changes (see SPEED CHANGES in sim.js): a critter's speed changes at a steady rate,
// the same up as down, reaching a full gallop from standing in SPEEDS.accelToGallopS
// (wolf 2.5 s, deer 1.5 s) and stopping from one in as long. Its gait (pose) changes at
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
      const pose0 = a.pose;
      let up = 0;
      for (; up < 600 && a.speed < full; up++) { S.tick(); back(); }
      S.setCritterIdle(a);
      const poses = new Set();
      let down = 0;
      for (; down < 600 && a.speed > 0; down++) { poses.add(a.pose); S.tick(); back(); }
      S.tick();
      out[a.species] = { pose0, upS: up * sim.tempo, downS: down * sim.tempo, posesWhileStopping: [...poses],
        poseAfter: a.pose, wantS: S.SPEEDS.accelToGallopS[a.species] };
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
