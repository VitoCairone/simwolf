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
// screen-vertical dx + dy, so the rectangle needs no square root), in its FIELD OF VIEW
// (inView: within fovDegBySpecies, centered on its heading, all of it seen alike) and in
// its LINE OF SIGHT: the straight line from its eye to the other's (eyeLevelsBySpecies, by its size)
// passes above the ground and boulders (sim.sightHeightAt) of every tile in between.
// Only creatures inside the rectangle are traced: O(n^2) in critters, for now. Sight
// alone tells a creature's sex, age (an infant, grown), its partner, and whether a female
// is in heat (as smell would, up close). Grass, land and water a critter can see are
// likewise in the rectangle and in line of sight (canSeeTile); sight doesn't tell fresh
// water from the sea (taste does: sim.waterInReach, for the mind).
// KEEPING SIGHT: a creature it has seen it can see again however far off, in its field of
// view and line of sight, until keepSightS after it last saw it (seesNow): one it has
// spotted it doesn't lose for being out of the rectangle (by day, beyond the view at 2x
// zoom; at night, beyond its shrunken sight), only behind something or behind it.
// AT NIGHT the rectangle shrinks (sightShare), from the whole of it in daylight
// (sim.clock.light 1) to nightSightShare of its area in the dark, through the twilight.
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
// The player sees what the player's wolf sees while the camera follows it (animat.js,
// SIGHT VIEW: canSeePoint, seesCreature), and the whole screen otherwise.
// TODO: uncertainty (sound and scent give only rough places); field of view; scent that
// takes time to drift.

const senses = (() => {

// (a local Math: looking globals up is slow where the code runs in a Node vm context)
const Math = globalThis.Math;

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

// How much of its daylight sight's area a critter keeps in the dark (estimates). Both have
// eyes built for dim light (many rods, a reflecting tapetum lucidum): deer gather some 18
// times the light a human eye does at night (K. Miller, University of Georgia), wolves
// some 5 times or more; both see less detail than by day. Moonlight is left out (TODO).
const nightSightShare = { wolf: 0.4, deer: 0.5 };

// FIELD OF VIEW, degrees: wolves about 250 (Mexican Wolf Conservation), deer about 310
// (white-tailed deer: Grand View Outdoors). As the cosine of half of it, for inView.
const fovDegBySpecies = { wolf: 250, deer: 310 };
const fovHalfCos = Object.fromEntries(Object.entries(fovDegBySpecies).map(([sp, d]) => [sp, Math.cos(d / 2 * Math.PI / 180)]));

// KEEPING SIGHT: how long after it last saw a creature a critter still sees it beyond its
// sight rectangle; and when each critter last saw each creature (game time).
const keepSightS = 6;
const lastSeen = new WeakMap(); // critter -> Map(uid -> sim.now)

// The share of its sight rectangle's width and height critter a sees now, by the light:
// the square root of the share of its area (worked out again only as the light changes).
let shareLight = NaN;
const shareBySpecies = {};
function sightShare(a) {
  const light = sim.clock.light;
  if (light !== shareLight) {
    shareLight = light;
    for (const [sp, n] of Object.entries(nightSightShare)) shareBySpecies[sp] = Math.sqrt(n + (1 - n) * light);
  }
  return shareBySpecies[a.species];
}

// Whether grid offset (dx, dy) from critter a is in its field of view (along its heading;
// a critter with none sees all round), or within nearViewTiles (the ground about its feet,
// under its nose). No square root: the angle's cosine is compared squared, by its sign.
const nearViewTiles = 1;
function inView(a, dx, dy) {
  const hx = a.hx || 0, hy = a.hy || 0, d2 = dx * dx + dy * dy;
  if (hx === 0 && hy === 0 || d2 <= nearViewTiles * nearViewTiles) return true;
  const along = dx * hx + dy * hy, c = fovHalfCos[a.species], d2c2 = c * c * d2;
  return c < 0 ? along >= 0 || along * along <= d2c2 : along > 0 && along * along >= d2c2;
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

// Walks the straight line from point (ex, ey) at height ez to (tx, ty) at height tz, tile
// by tile (a grid traversal), over every tile in between (not the first or the last),
// calling stop(i, j, z) with the line's height z where it comes nearest the tile's
// center, until stop returns true; whether it did. The last tile too if an obstacle
// stands on it and the line ends beyond its center (behind the obstacle). Distances along the line are
// fractions: no square roots.
function walkLine(ex, ey, ez, tx, ty, tz, stop) {
  let ci = Math.floor(ex), cj = Math.floor(ey);
  const ti = Math.floor(tx), tj = Math.floor(ty);
  if (ci === ti && cj === tj) return false;
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
    if (ci === ti && cj === tj) break;
    let t = ((ci + 0.5 - ex) * dx + (cj + 0.5 - ey) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (stop(ci, cj, ez + dz * t)) return true;
  }
  // the last tile's obstacle hides the part of it beyond its center
  if (sim.obstacleHeightAt(ti, tj) <= 0) return false;
  const t = ((ti + 0.5 - ex) * dx + (tj + 0.5 - ey) * dy) / len2;
  return t > 0 && t < 1 && stop(ti, tj, ez + dz * t);
}

// Whether the line passes above every tile in between: the ground at each one's center,
// and any obstacle on it.
const sightBlocked = (i, j, z) => sim.sightHeightAt(i, j) > z;
function clearLine(ex, ey, ez, tx, ty, tz) {
  return !walkLine(ex, ey, ez, tx, ty, tz, sightBlocked);
}

// Whether critter a, sight aside, has a line of sight from its eye to b's.
function canSee(a, b) {
  if (!use.lineOfSight) return true;
  return clearLine(a.gx, a.gy, sim.heightAt(a.gx, a.gy) + eyeLevels(a),
    b.gx, b.gy, sim.heightAt(b.gx, b.gy) + eyeLevels(b));
}

// Whether critter a sees grid point (gx, gy) at height gz (by default, the ground there):
// in its sight rectangle and line of sight.
function canSeePoint(a, gx, gy, gz = sim.heightAt(gx, gy)) {
  if (!sim.can(a, "see") || !inSight(gx - a.gx, gy - a.gy, sightShare(a)) || !inView(a, gx - a.gx, gy - a.gy)) return false;
  if (!use.lineOfSight) return true;
  return clearLine(a.gx, a.gy, sim.heightAt(a.gx, a.gy) + eyeLevels(a), gx, gy, gz);
}

// Whether critter a sees the ground at the center of tile (i, j).
function canSeeTile(a, i, j) {
  return canSeePoint(a, i + 0.5, j + 0.5);
}

// Whether an obstacle (sim.obstacleHeightAt) stands in the way of critter a's line of
// sight to grid point (gx, gy) at height gz (by default, the ground there), whatever else
// does.
const obstacleBlocks = (i, j, z) => sim.obstacleHeightAt(i, j) > 0 && sim.sightHeightAt(i, j) > z;
function obstacleInWay(a, gx, gy, gz = sim.heightAt(gx, gy)) {
  if (!use.lineOfSight) return false;
  return walkLine(a.gx, a.gy, sim.heightAt(a.gx, a.gy) + eyeLevels(a), gx, gy, gz,
    obstacleBlocks);
}

// Whether critter a sees creature b (alive or a corpse) now: in its field of view, in its
// sight rectangle or seen within keepSightS (see KEEPING SIGHT), and in line of sight.
function seesNow(a, b) {
  if (!sim.can(a, "see")) return false;
  const dx = b.gx - a.gx, dy = b.gy - a.gy;
  let mine = lastSeen.get(a);
  const last = mine && mine.get(b.uid);
  const kept = last !== undefined && sim.now - last <= keepSightS;
  if (last !== undefined && !kept) mine.delete(b.uid);
  if (!inView(a, dx, dy) || !kept && !inSight(dx, dy, sightShare(a))) return false;
  if (!canSee(a, b)) return false;
  if (!mine) lastSeen.set(a, mine = new Map());
  mine.set(b.uid, sim.now);
  return true;
}

// Whether critter a sees creature b, as perceive tells by sight (for the view).
const seesCreature = seesNow;

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
// Airborne: how far downwind a critter smells another, in tiles (wolves about 2.4 km,
// deer about 400 m); within what angle of straight upwind (estimate; as its cosine,
// squared, for comparing without a square root); and how near it smells anything, wind
// or not (estimate).
const airScentRangeTiles = { wolf: 2400, deer: 400 };
const airScentHalfAngle = 20 * Math.PI / 180;
const airScentCos2 = Math.cos(airScentHalfAngle) ** 2;
const sniffTiles = 3;
// Trails: how far around itself a critter smells the ground, in tiles (r: a nearly round
// patch, the square r tiles out each way, plus on each of its sides a row of 2r - 1 tiles
// and beyond that one of 2r - 3, centered: for a wolf 7 x 7, with rows of 5 and of 3);
// and the faintest trail it can smell (a share of a fresh one's strength: older than that
// many half-lives, sim.scentHalfLifeS, it can't). Wolves track; deer don't follow trails (yet).
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

// Whether tile offset (di, dj) is in a sniffing patch of reach r (see Trails).
function inSniffPatch(di, dj, r) {
  const far = Math.max(Math.abs(di), Math.abs(dj)), side = Math.min(Math.abs(di), Math.abs(dj));
  return far <= r || far === r + 1 && side <= r - 1 || far === r + 2 && side <= r - 2;
}

// The trails of species in the sniffing patch of critter a (trailSniffTiles) that it can
// still smell: [{ i, j, ageS, uid }].
function trailsAround(a, species) {
  if (!use.smell) return [];
  const r = trailSniffTiles[a.species], R = r + 2, ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const maxAgeS = Math.log2(1 / trailMinStrength[a.species]) * sim.scentHalfLifeS;
  const out = [];
  for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
    if (!inSniffPatch(i - ci, j - cj, r)) continue;
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
  const hears = use.hearing && sim.can(a, "hear"), smells = use.smell, wind = sim.wind;
  for (const list of [sim.allCritters, sim.allCorpses]) {
    for (const b of list) {
      if (b === a) continue;
      const dx = b.gx - a.gx, dy = b.gy - a.gy, alive = sim.isLiveCritter(b);
      let by = null;
      if (seesNow(a, b)) by = "sight";
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

// The tiles with plant food on them (grass, undergrowth: sim.plantFoodAt) whose centers
// are in the sight rectangle of critter a (as much of it as it sees now: sightShare), or
// within share k of that, and in its field of view: [{ i, j, kg }]. (Line of sight is left
// to the mind to check, with canSeeTile, for the few it considers: there are thousands.)
function plantsAround(a, k = 1) {
  k *= sightShare(a);
  const out = [], ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const r = Math.ceil(k * (sightHalfWidthTiles + sightHalfHeightTiles) / 2) + 1;
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    if (!inSight(i + 0.5 - a.gx, j + 0.5 - a.gy, k) || !inView(a, i + 0.5 - a.gx, j + 0.5 - a.gy)) continue;
    const kg = sim.plantFoodAt(i, j);
    if (kg > 0) out.push({ i, j, kg });
  }
  return out;
}

// The shores whose centers are in the sight rectangle of critter a (as much of it as it
// sees now) and its field of view: open land tiles beside water (on one of their four sides), [{ i, j }]. Line
// of sight is left to the mind, as for plantsAround.
function shoresAround(a) {
  const k = sightShare(a), ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const r = Math.ceil(k * (sightHalfWidthTiles + sightHalfHeightTiles) / 2) + 2, n = 2 * r + 1;
  const wet = new Uint8Array(n * n); // 1 water, 2 open land
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    const i = ci - r + x, j = cj - r + y;
    wet[x * n + y] = sim.getTerrainAt(i, j) === "water" ? 1 : sim.isBlockedTile(i, j) ? 0 : 2;
  }
  const out = [];
  for (let x = 1; x < n - 1; x++) for (let y = 1; y < n - 1; y++) {
    const c = x * n + y;
    if (wet[c] !== 2 || !(wet[c - n] === 1 || wet[c + n] === 1 || wet[c - 1] === 1 || wet[c + 1] === 1)) continue;
    const i = ci - r + x, j = cj - r + y;
    if (inSight(i + 0.5 - a.gx, j + 0.5 - a.gy, k) && inView(a, i + 0.5 - a.gx, j + 0.5 - a.gy)) out.push({ i, j });
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
  attach, perceive, plantsAround, shoresAround, trailsAround, inSight, inView, canSee, canSeeTile, canSeePoint, seesCreature, obstacleInWay, use, sightShare, sky, nightSightShare,
  sightHalfWidthTiles, sightHalfHeightTiles, fovDegBySpecies, keepSightS, trailMinStrength, hearingRangeTiles, airScentRangeTiles, eyeLevelsBySpecies, sniffTiles,
};

})();

// In Node, senses.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = senses;
