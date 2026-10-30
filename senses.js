// THE SENSES: what a critter perceives right now. It reads the simulation and never
// changes it; what a critter perceives is all its mind (mind.js) may know of the world
// outside itself (NO MAGICAL KNOWLEDGE: see admin/design_notes.md).
//
// Everything it offers is on the one global it defines, `senses`. Connect it with
// senses.attach(sim).
//
// Four senses, each telling where another creature is (exactly, for now) and some of
// what it is:
//
// SIGHT, once old enough to "see": every creature within a rectangle on screen around the
// critter (the shape and size of the game view at the default 2x zoom on a full-screen
// MacBook, about 1,290 x 810 CSS pixels; in grid terms, screen-horizontal is dx - dy and
// screen-vertical dx + dy, so the rectangle needs no square root) and in its LINE OF
// SIGHT: the straight line from its eye to the other's (eyeLevelsBySpecies, by its size)
// passes above the ground and boulders (sim.obstacleHeightAt) of every tile in between.
// Only creatures inside the rectangle are traced: O(n^2) in critters, for now. Sight
// alone tells a creature's sex, age (an infant, grown), its partner, and whether a female
// is in heat (as smell would, up close). Grass and land a critter can see are likewise
// in the rectangle and in line of sight (canSeeTile).
// AT NIGHT the rectangle shrinks (sightShare), from the whole of it in daylight
// (sim.clock.light 1) to nightSightShare of it in the dark, through the twilight.
// HEARING, once old enough to "hear": a creature moving on land, heard within a range set
// by its gait and the ground under it (hearingRangeTiles: loudest galloping on stone), or
// swimming. Standing still is silent. It tells its species, and where and how it moves.
// SMELL, from birth:
//   carried on the wind (sim.wind): every live creature, and a carcass with meat, gives off
//   scent that drifts downwind. A critter smells one within airScentRangeTiles (by its
//   species) that lies within airScentHalfAngle of straight upwind of it, and any within
//   sniffTiles whatever the wind. It tells species, whether alive, and a carcass's meat;
//   a carcass with no meat left is smelled only within sniffTiles.
//   on the ground: trails (sim.scentAt), which trailsAround lists for the mind to follow,
//   as faint as the critter's nose can still smell (trailMinStrength).
// TOUCH: a mother feels which of her young is suckling from her (nursingOnMe), and
// perceives it by "touch" if by nothing else.
// The player sees the whole screen, whatever the player's wolf can perceive.
// TODO: uncertainty (sound and scent give only rough places); field of view; scent that
// takes time to drift.

const senses = (() => {

let sim = null; // set by attach()

// Which senses are in use (for experiments and tests: all, normally).
const use = { lineOfSight: true, hearing: true, smell: true };

// SIGHT
// In grid steps; one tile across the screen is 2 of |dx - dy|, one tile down it 2 of |dx + dy|.
const sightHalfWidthTiles = 20.2;  // |dx - dy| at most this
const sightHalfHeightTiles = 25.3; // |dx + dy| at most this
// An adult's eye above the ground under it, in levels (8 px each), from its sprite: the
// wolf's eye is drawn about 18 px above its ground point (counting the ground's slope to
// its head), the deer's about 20. A young critter's is lower by its size (sim.youngScales).
const eyeLevelsBySpecies = { wolf: 2.25, deer: 2.5 };

// How much of its daylight sight a critter keeps in the dark (estimates). Both have eyes
// built for dim light (many rods, a reflecting tapetum lucidum): deer gather some 18 times
// the light a human eye does at night (K. Miller, University of Georgia), wolves some 5
// times or more; both see less detail than by day. Moonlight is left out (TODO).
const nightSightShare = { wolf: 0.4, deer: 0.5 };

// The share of its sight rectangle critter a sees now, by the light.
function sightShare(a) {
  const n = nightSightShare[a.species], light = sim.clock.light;
  return n + (1 - n) * light;
}

// What a critter can tell of the sky: how light it is, whether the sun is up, and whether
// it is high (around midday: within middayHours of 13:00, the sun's highest, by sight).
const middayHours = 1.5;
function sky() {
  const c = sim.clock;
  return { light: c.light, sunUp: c.sunUp, midday: c.sunUp && Math.abs(c.hour - 13) < middayHours };
}
// Whether grid offset (dx, dy) is in the sight rectangle, or with k < 1, within that share of it.
function inSight(dx, dy, k = 1) {
  return Math.abs(dx - dy) <= k * sightHalfWidthTiles && Math.abs(dx + dy) <= k * sightHalfHeightTiles;
}

function eyeLevels(a) {
  const stage = sim.youngStage(a);
  return eyeLevelsBySpecies[a.species] * (stage ? sim.youngScales[stage - 1] : 1);
}

// The height a line of sight must clear over tile (i, j): the ground at its center plus
// any obstacle. Worked out once per tile (the terrain doesn't change).
let sightZ = null; // by tile index; NaN: not yet known
function sightHeightAt(i, j) {
  if (i < 0 || j < 0 || i >= sim.gridWidthN || j >= sim.gridHeightN) return 0;
  if (!sightZ) sightZ = new Float32Array(sim.gridWidthN * sim.gridHeightN).fill(NaN);
  const k = i * sim.gridHeightN + j;
  let z = sightZ[k];
  if (z !== z) {
    z = sim.heightAt(i + 0.5, j + 0.5) + sim.obstacleHeightAt(i, j);
    sightZ[k] = z;
  }
  return z;
}

// Whether the straight line from point (ex, ey) at height ez to (tx, ty) at height tz
// passes above every tile in between, each compared at the point where the line comes
// nearest that tile's center. The line is walked tile by tile (a grid traversal), with
// distances along it as fractions: no square roots.
function clearLine(ex, ey, ez, tx, ty, tz) {
  let ci = Math.floor(ex), cj = Math.floor(ey);
  const ti = Math.floor(tx), tj = Math.floor(ty);
  if (ci === ti && cj === tj) return true;
  const dx = tx - ex, dy = ty - ey, dz = tz - ez, len2 = dx * dx + dy * dy;
  // t (0 at the eye, 1 at the target) at which the line next crosses a vertical (i) and a
  // horizontal (j) tile edge, and how much t each whole tile takes
  const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1;
  const tDeltaI = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaJ = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxI = dx !== 0 ? (dx > 0 ? ci + 1 - ex : ex - ci) * tDeltaI : Infinity;
  let tMaxJ = dy !== 0 ? (dy > 0 ? cj + 1 - ey : ey - cj) * tDeltaJ : Infinity;
  for (let n = Math.abs(ti - ci) + Math.abs(tj - cj); n > 0; n--) {
    if (tMaxI < tMaxJ) { ci += stepI; tMaxI += tDeltaI; } else { cj += stepJ; tMaxJ += tDeltaJ; }
    if (ci === ti && cj === tj) return true;
    let t = ((ci + 0.5 - ex) * dx + (cj + 0.5 - ey) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (sightHeightAt(ci, cj) > ez + dz * t) return false;
  }
  return true;
}

// Whether critter a, sight aside, has a line of sight from its eye to b's.
function canSee(a, b) {
  if (!use.lineOfSight) return true;
  return clearLine(a.gx, a.gy, sim.heightAt(a.gx, a.gy) + eyeLevels(a),
    b.gx, b.gy, sim.heightAt(b.gx, b.gy) + eyeLevels(b));
}

// Whether critter a sees the ground at the center of tile (i, j) (in its sight rectangle
// and line of sight).
function canSeeTile(a, i, j) {
  if (!sim.can(a, "see") || !inSight(i + 0.5 - a.gx, j + 0.5 - a.gy, sightShare(a))) return false;
  if (!use.lineOfSight) return true;
  return clearLine(a.gx, a.gy, sim.heightAt(a.gx, a.gy) + eyeLevels(a), i + 0.5, j + 0.5, sim.heightAt(i + 0.5, j + 0.5));
}

// HEARING: how far a creature moving on each ground, at each gait, can be heard, in tiles
// (estimates). Swimming splashes are heard as far on any water.
const hearingRangeTiles = {
  grass: { walk: 3, trot: 11, gallop: 30 },
  dirt:  { walk: 4, trot: 15, gallop: 40 },
  stone: { walk: 8, trot: 30, gallop: 80 },
};
const swimHeardTiles = 12;

const loudestTiles = Math.max(swimHeardTiles, ...Object.values(hearingRangeTiles).flatMap(Object.values));

// How far critter b can be heard now: worked out once a tick per critter (the terrain
// lookup is costly), kept in heardRangeOf.
const heardRangeOf = new Map();
let heardTick = -1;
function hearingRange(b) {
  if (heardTick !== sim.tickCount) { heardRangeOf.clear(); heardTick = sim.tickCount; }
  let r = heardRangeOf.get(b);
  if (r === undefined) {
    if (!(b.speed > 0) || !sim.isLiveCritter(b)) r = 0;
    else if (b.pose === "swim") r = swimHeardTiles;
    else {
      const byGait = hearingRangeTiles[sim.getTerrainAt(b.gx, b.gy)];
      r = (byGait && byGait[b.pose]) || 0;
    }
    heardRangeOf.set(b, r);
  }
  return r;
}

// SMELL
// Airborne: how far downwind a critter smells another, in tiles; within what angle of
// straight upwind (as its cosine, squared, for comparing without a square root); and how
// near it smells anything, wind or not. Estimates, short of the kilometres wolves are said
// to smell prey downwind, for a map half a kilometre across.
const airScentRangeTiles = { wolf: 150, deer: 80 };
const airScentHalfAngle = 20 * Math.PI / 180;
const airScentCos2 = Math.cos(airScentHalfAngle) ** 2;
const sniffTiles = 3;
// Trails: how far around itself a critter smells the ground, in tiles, and the faintest
// trail it can smell (a share of a fresh one's strength: older than that many half-lives,
// sim.scentHalfLifeS, it can't). Wolves track; deer don't follow trails (yet).
const trailSniffTiles = { wolf: 3, deer: 2 };
const trailMinStrength = { wolf: 1 / 8, deer: 1 / 2 };

// Whether a smells b on the wind (or up close).
function smellsOnWind(a, dx, dy, d2, wind) {
  if (d2 <= sniffTiles * sniffTiles) return true;
  const range = airScentRangeTiles[a.species];
  if (d2 > range * range) return false;
  // a must be downwind of b: from b to a (-dx, -dy) along the wind, within the angle
  const along = -dx * wind.x - dy * wind.y;
  return along > 0 && along * along >= airScentCos2 * d2;
}

// The trails of species within trailSniffTiles of critter a that it can still smell:
// [{ i, j, ageS, uid }].
function trailsAround(a, species) {
  if (!use.smell) return [];
  const r = trailSniffTiles[a.species], ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const maxAgeS = Math.log2(1 / trailMinStrength[a.species]) * sim.scentHalfLifeS;
  const out = [];
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    const s = sim.scentAt(i, j, species);
    if (s && s.ageS <= maxAgeS) out.push({ i, j, ageS: s.ageS, uid: s.uid });
  }
  return out;
}

// What critter a perceives now, one snapshot per creature it perceives (the dying and the
// dead included), by the most telling sense:
//   { uid, species, alive, gx, gy, vx, vy, swimming, meat, by,
//     isMale, infant, grown, mateUid, inHeat }   (these last by sight only)
//   by:      "sight", "hearing" or "smell"
//   vx, vy:  its velocity, tiles a tick (0 by smell)
//   meat:    for a carcass, the share of its meat left (1 all, 0 only bones)
//   mateUid: its partner's uid, or null
function perceive(a) {
  const out = [];
  const share = sim.can(a, "see") ? sightShare(a) : 0, sees = share > 0;
  const hears = use.hearing && sim.can(a, "hear"), smells = use.smell, wind = sim.wind;
  for (const list of [sim.allCritters, sim.allCorpses]) {
    for (const b of list) {
      if (b === a) continue;
      const dx = b.gx - a.gx, dy = b.gy - a.gy, alive = sim.isLiveCritter(b);
      let by = null;
      if (sees && inSight(dx, dy, share) && canSee(a, b)) by = "sight";
      else {
        // the cheap tests first: distance, then what it costs to find out more
        const d2 = dx * dx + dy * dy;
        if (hears && b.speed > 0 && d2 <= loudestTiles * loudestTiles) {
          const heard = hearingRange(b);
          if (heard && d2 <= heard * heard) by = "hearing";
        }
        // a bare carcass gives off no scent on the wind, but up close smells of no meat
        if (!by && smells && (alive || b.carcass) && smellsOnWind(a, dx, dy, d2, wind)
          && (alive || d2 <= sniffTiles * sniffTiles || sim.carcassMeatKg(b) > 0)) by = "smell";
      }
      const suckling = b.nursingOn === a.uid; // touching it
      if (!by && suckling) by = "touch";
      if (!by) continue;
      const speed = by !== "smell" && b.speed || 0;
      const o = {
        uid: b.uid, species: b.species, alive, gx: b.gx, gy: b.gy,
        vx: speed ? b.hx * speed : 0, vy: speed ? b.hy * speed : 0,
        swimming: by !== "smell" ? b.pose === "swim" : undefined,
        meat: b.carcass ? sim.carcassMeatKg(b) / b.carcassFullKg : undefined, by,
      };
      if (suckling) o.nursingOnMe = true;
      if (by === "sight") {
        o.isMale = b.isMale; o.infant = sim.isInfant(b); o.grown = sim.isGrown(b);
        o.mateUid = b.mateUid; o.inHeat = alive && sim.inHeat(b);
      }
      out.push(o);
    }
  }
  return out;
}

// The tiles with grass on them whose centers are in the sight rectangle of critter a (as
// much of it as it sees now: sightShare), or within share k of that: [{ i, j, kg }]. (Line of sight is left to the mind to check, with
// canSeeTile, for the few it considers: there are thousands.)
function grassAround(a, k = 1) {
  k *= sightShare(a);
  const out = [], ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const r = Math.ceil(k * (sightHalfWidthTiles + sightHalfHeightTiles) / 2) + 1;
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    if (!inSight(i + 0.5 - a.gx, j + 0.5 - a.gy, k)) continue;
    const kg = sim.grassFoodAt(i, j);
    if (kg > 0) out.push({ i, j, kg });
  }
  return out;
}

function attach(theSim) {
  if (sim) return alert("senses.attach called twice");
  if (!theSim || typeof theSim.isLiveCritter !== "function")
    return alert("senses.attach needs the simulation (load sim.js)");
  sim = theSim;
}

return {
  attach, perceive, grassAround, trailsAround, inSight, canSee, canSeeTile, use, sightShare, sky, nightSightShare,
  sightHalfWidthTiles, sightHalfHeightTiles, hearingRangeTiles, airScentRangeTiles, eyeLevelsBySpecies, sniffTiles,
};

})();

// In Node, senses.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = senses;
