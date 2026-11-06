// Stalking (see MOVING and EXERTION in sim.js, HEARING in senses.js, PACE in mind.js), on
// open level land:
//  - a wolf stalks faster than it walks and slower than it trots; a deer told to stalk
//    walks
//  - it goes less far on its stamina stalking than trotting (and walking costs none)
//  - all but silent: a deer just ahead of a wolf, its back to it, hears it trotting, not
//    stalking; by day or by night, a wolf stalking is heard no farther than 2 tiles off on
//    any ground (a newborn crawling, wolf or deer, as far), a deer farther than a wolf at
//    any gait, and anything farther by night
// Runs sim.js, senses.js and mind.js in Node (no browser).

const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { ROOT, runStandalone } = require("./helpers");

function load() {
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {}, error() {} }, Math, Date, Map, Set, Array, Object, Number, String, JSON,
    alert: msg => { throw new Error("alert: " + msg); }, setTimeout, clearTimeout,
  });
  for (const f of ["hydrology.js", "sim.js", "senses.js", "mind.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), context, { filename: f });
  vm.runInContext("sim.init(); senses.attach(sim); mind.attach(sim, senses);", context);
  return context;
}

async function main(browser, r) {
  const c = load();
  const res = vm.runInContext(`(() => {
    const S = sim.internals;
    S.holdWater(true);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry level land, 40 tiles along i
    const [i0, j0] = S.allLandTiles.find(([i, j]) => {
      const lv = sim.tileCorners(i, j)[0];
      for (let di = -2; di <= 40; di++) for (let dj = -2; dj <= 2; dj++)
        if (sim.getTerrainAt(i + di, j + dj) === "water" || sim.isBlockedTile(i + di, j + dj) || sim.tileCorners(i + di, j + dj).some(h => h !== lv)) return false;
      return true;
    });
    const put = (a, x, y) => { a.gx = a.nextGX = x; a.gy = a.nextGY = y; a.speed = 0; a.stunnedUntil = 0; S.setCritterIdle(a); a.hx = 1; a.hy = 0; };
    const wolf = sim.allCritters.find(a => a.species === "wolf" && sim.isGrown(a) && a !== sim.pcWolf);
    const deer = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a));
    // 10 s along i at each gait: tiles gone, stamina used, the pose it went at
    const go = (a, gait) => {
      put(a, i0 + 0.5, j0 + 0.5); a.stamina = 0.8; a.wind = 1;
      sim.setIntent(a, { dx: 1, dy: 0, gait });
      const poses = new Set();
      for (let n = 0; n < 10 / sim.tempo; n++) { S.tick(); poses.add(a.pose); }
      const out = { tiles: +(a.gx - i0 - 0.5).toFixed(2), used: +(0.8 - a.stamina).toFixed(4), poses: [...poses] };
      sim.setIntent(a, null); put(a, -800, -800 - a.uid);
      return out;
    };
    const out = { wolf: {}, deer: {} };
    for (const g of ["walk", "stalk", "trot"]) out.wolf[g] = go(wolf, g);
    out.deer.stalk = go(deer, "stalk");
    // heard? the deer facing away from the wolf, 2.2 tiles ahead of it (smell aside)
    senses.use.smell = false;
    const heard = gait => {
      put(deer, i0 + 4.7, j0 + 0.5); put(wolf, i0 + 2.5, j0 + 0.5);
      mind.ignore(deer);
      sim.setIntent(wolf, { dx: 0, dy: 1, gait });
      let by = null;
      for (let n = 0; n < 30; n++) {
        wolf.gx = wolf.nextGX = i0 + 2.5; wolf.gy = wolf.nextGY = j0 + 0.5; wolf.stamina = 1; S.tick();
        by = by || (senses.perceive(deer).find(o => o.uid === wolf.uid)?.by ?? null);
      }
      sim.setIntent(wolf, null);
      return by;
    };
    out.heard = { trot: heard("trot"), stalk: heard("stalk"), light: sim.clock.light };
    senses.use.smell = true;
    // the tables
    const T = senses.hearingRangeTiles, grounds = ["grass", "dirt", "stone"];
    out.stalkMax = Math.max(...grounds.flatMap(g => T.wolf[g].stalk));
    out.crawlSame = ["wolf", "deer"].every(sp => grounds.every(g => T[sp][g].crawl.join() === T.wolf[g].stalk.join()));
    out.deerLouder = grounds.every(g => ["walk", "trot", "gallop"].every(k => T.deer[g][k][0] > T.wolf[g][k][0] && T.deer[g][k][1] > T.wolf[g][k][1]));
    out.nightFarther = ["wolf", "deer"].every(sp => grounds.every(g => Object.values(T[sp][g]).every(([day, night]) => night >= day)));
    return out;
  })()`, c);
  const { wolf, deer, heard } = res;
  r.check(wolf.walk.tiles < wolf.stalk.tiles && wolf.stalk.tiles < wolf.trot.tiles && wolf.stalk.poses.includes("stalk") && deer.stalk.poses.includes("walk") && !deer.stalk.poses.includes("stalk"),
    `in 10 s a wolf walks ${wolf.walk.tiles} tiles, stalks ${wolf.stalk.tiles}, trots ${wolf.trot.tiles}; a deer told to stalk walks (${deer.stalk.poses})`);
  const per = g => wolf[g].used / wolf[g].tiles;
  r.check(per("stalk") > per("trot") && wolf.walk.used <= 0,
    `stalking goes less far on its stamina than trotting (${(1 / per("stalk")).toFixed(0)} tiles a unit of stamina, trotting ${(1 / per("trot")).toFixed(0)}); walking uses none (${wolf.walk.used})`);
  r.check(heard.trot === "hearing" && heard.stalk === null,
    `a deer 2.2 tiles ahead of a wolf, its back to it, hears it trotting (${heard.trot}), not stalking (${heard.stalk}) (daylight ${heard.light})`);
  r.check(res.stalkMax <= 2 && res.crawlSame && res.deerLouder && res.nightFarther,
    `a wolf stalking is heard ${res.stalkMax} tiles off at most, a newborn crawling as far (${res.crawlSame}); a deer farther than a wolf at any gait (${res.deerLouder}); anything farther by night (${res.nightFarther})`);
}

module.exports = { name: "stalking", main };
if (require.main === module) runStandalone(module.exports.name, main);
