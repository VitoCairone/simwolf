// Seeking mates by scent (see MATES AND FAMILY in mind.js; SMELL in senses.js):
//  - an unpaired grown critter that knows of no one to court follows the freshest trail
//    about of an unpaired grown critter of its species and the other sex, the way it was
//    laid (mode "seek"): a deer, and a wolf
//  - not a paired critter's trail, nor one of its own sex, nor its kin's
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
    const S = sim.internals, H = sim.gridHeightN;
    S.holdWater(true);
    sim.allCritters.forEach(a => { mind.ignore(a); a.lifespanS = 1e12; a.gx = a.nextGX = a.gy = a.nextGY = -900 - a.uid * 3; a.speed = 0; });
    // open dry level land, 12 tiles each way
    const t = S.allLandTiles.find(([i, j]) => {
      const lv = sim.tileCorners(i, j)[0];
      for (let di = -12; di <= 12; di += 2) for (let dj = -12; dj <= 12; dj += 2)
        if (sim.getTerrainAt(i + di, j + dj) === "water" || sim.isBlockedTile(i + di, j + dj) || sim.tileCorners(i + di, j + dj)[0] !== lv) return false;
      return true;
    });
    const [i0, j0] = t;
    const grownOf = (sp, male, paired = false) => sim.allCritters.find(a => a.species === sp && sim.isGrown(a) && a.isMale === male && (a.mateUid !== null) === paired);
    // a seeker at (i0, j0); a trail along +i, from 1 tile behind it to 10 ahead, fresher
    // ahead (laid by maker, 60 s ago at its far end), the seeker facing along it
    const seek = (seeker, maker) => {
      for (const sp of ["deer", "wolf"]) S.scentMarks[sp].clear();
      for (let k = -1; k <= 10; k++) S.scentMarks[seeker.species].set((i0 + k) * H + j0, [sim.now - 60 - (10 - k), maker.uid]);
      seeker.gx = seeker.nextGX = i0 + 0.5; seeker.gy = seeker.nextGY = j0 + 0.5; seeker.speed = 0; seeker.stunnedUntil = 0;
      S.setCritterIdle(seeker); seeker.hx = 1; seeker.hy = 0; S.setFood(seeker, 0.9);
      mind.forget(seeker); mind.ignore(seeker, false);
      const modes = new Set(), x0 = seeker.gx;
      for (let n = 0; n < 2 / sim.tempo; n++) { S.tick(); modes.add(mind.stateOf(seeker)?.mode); }
      mind.ignore(seeker);
      const out = { modes: [...modes].filter(Boolean), moved: +(seeker.gx - x0).toFixed(2), off: +Math.abs(seeker.gy - j0 - 0.5).toFixed(2) };
      seeker.gx = seeker.nextGX = seeker.gy = seeker.nextGY = -700 - seeker.uid * 3;
      return out;
    };
    const hind = grownOf("deer", false), stag = grownOf("deer", true), stag2 = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a) && a.isMale && a !== stag);
    const she = grownOf("wolf", false), he = grownOf("wolf", true);
    const out = {};
    out.deer = seek(hind, stag);
    out.wolf = seek(she, he);
    out.sameSex = seek(stag2, stag);
    // paired: the stag paired for the test
    const hind2 = sim.allCritters.find(a => a.species === "deer" && sim.isGrown(a) && !a.isMale && a !== hind);
    const was = [stag.mateUid, hind2.mateUid];
    S.pair(stag, hind2);
    out.paired = seek(hind, stag);
    stag.mateUid = was[0]; hind2.mateUid = was[1];
    // kin: her father's trail
    hind.parentUids.push(stag.uid);
    out.kin = seek(hind, stag);
    hind.parentUids.pop();
    return out;
  })()`, c);
  r.check(res.deer.modes.includes("seek") && res.deer.moved > 2 && res.deer.off < 0.6,
    `an unpaired hind knowing of no stag follows an unpaired stag's trail the way it was laid (${res.deer.moved} tiles along it in 2 s; ${res.deer.modes})`);
  r.check(res.wolf.modes.includes("seek") && res.wolf.moved > 2 && res.wolf.off < 0.6,
    `...and an unpaired she-wolf a he-wolf's (${res.wolf.moved} tiles; ${res.wolf.modes})`);
  r.check(!res.sameSex.modes.includes("seek") && !res.paired.modes.includes("seek") && !res.kin.modes.includes("seek"),
    `not one of its own sex (${res.sameSex.modes}), nor a paired one's (${res.paired.modes}), nor its kin's (${res.kin.modes})`);
}

module.exports = { name: "seeking mates by scent", main };
if (require.main === module) runStandalone(module.exports.name, main);
