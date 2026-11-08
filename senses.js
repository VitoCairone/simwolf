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
// SIGHT, once old enough to "see": every creature within sightRadiusTiles of the critter
// (a circle on the ground, its square of distance compared with the radius's: no square
// root), in its FIELD OF VIEW
// (inView: within fovDegBySpecies, centered on its heading, all of it seen alike) and in
// its LINE OF SIGHT: the straight line from its eye to the other's (eyeLevelsBySpecies, by
// its size) passes above the ground at the center of every tile in between, and above or
// beside its boulder: a boulder stops it only where the rock itself stands, its width
// across the line's direction (the nearest of the 8) as its sprite shows (sim.js: BOULDER
// FOOTPRINTS), not across its whole tile.
// Only creatures inside the circle are traced. Sight
// alone tells a creature's sex, age (an infant, grown), its partner, and whether a female
// is in heat (as smell would, up close). Grass, land and water a critter can see are
// likewise in the circle and in line of sight (canSeeTile); sight doesn't tell fresh
// water from the sea (taste does: sim.waterInReach, for the mind).
// KEEPING SIGHT: a creature it has seen it can see again up to detectTiles off, in its
// field of view and line of sight, until keepSightS after it last saw it (seesNow): one it
// has spotted it doesn't lose for being out of the circle (by day, beyond
// sightRadiusTiles; at night, beyond its shrunken sight), only behind something, behind
// it, or beyond detectTiles.
// AT NIGHT the circle shrinks (sightShare), from the whole of it in daylight
// (sim.clock.light 1) to nightSightShare of its area in the dark, through the twilight.
// HEARING, once old enough to "hear": a creature moving on land, heard within a range set
// by its species, its gait and the ground under it, farther in the quiet of night
// (hearingRangeTiles: a deer galloping on stone loudest; a wolf stalking all but silent),
// or swimming. Standing still is silent. It tells its species, and where and how it moves.
// A wolf howling is heard much farther (HOWLS); a wolf barking softly about as far as a
// loud footfall, telling its signal (BARKS); a pup whimpering, less far.
// SMELL, from birth:
//   up close: a critter smells any creature or carcass within sniffTiles (not on the wind:
//   no scent carries farther). It tells species, whether alive, and a carcass's meat.
//   on the ground: trails (sim.scentAt), which trailsAround lists for the mind to follow,
//   as faint as the critter's nose can still smell (trailMinStrength). A critter's trail
//   tells who laid it, and (as scent marks do) its sex, whether grown and whether paired.
// NEAR (perceive): a critter perceives only creatures within detectTiles (its farthest
// sense but for howls), found in a coarse grid (NEARBY), and those howling wherever they
// are.
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
// How far a critter sees by day, in tiles (meters): a meter beyond the corner of the
// rectangle it once was (the game view at the default 2x zoom on a full-screen MacBook,
// |dx - dy| up to 20.2 and |dx + dy| up to 25.3, its corner some 22.9 m off).
const sightRadiusTiles = Math.sqrt((20.2 * 20.2 + 25.3 * 25.3) / 2) + 1; // about 23.9
const sightRadius2 = sightRadiusTiles * sightRadiusTiles;
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
// sight circle; and when each critter last saw each creature (game time).
const keepSightS = 6;
const lastSeen = new WeakMap(); // critter -> Map(uid -> sim.now)

// The share of its sight circle's radius critter a sees now, by the light:
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
// Whether grid offset (dx, dy) is in the sight circle, or with k < 1, within that share of its radius.
function inSight(dx, dy, k = 1) {
  return dx * dx + dy * dy <= k * k * sightRadius2;
}

function eyeLevels(a) {
  const stage = sim.youngStage(a);
  return eyeLevelsBySpecies[a.species] * (stage ? sim.youngScales[stage - 1] : 1);
}

// Walks the straight line from point (ex, ey) at height ez to (tx, ty) at height tz, tile
// by tile (a grid traversal), over every tile in between (not the first or the last),
// calling stop(i, j, z, off, dir) with the line's height z where it comes nearest the
// tile's center, how far from the center it passes there (off, along the left-hand normal
// of dir) and the nearest of sim's 8 directions to the line's (dir), until stop returns
// true; whether it did. The last tile too if an obstacle stands on it and the line ends
// beyond its center (behind the obstacle). Distances along the line are fractions: no
// square roots.
function walkLine(ex, ey, ez, tx, ty, tz, stop) {
  let ci = Math.floor(ex), cj = Math.floor(ey);
  const ti = Math.floor(tx), tj = Math.floor(ty);
  if (ci === ti && cj === tj) return false;
  const dx = tx - ex, dy = ty - ey, dz = tz - ez, len2 = dx * dx + dy * dy;
  const dir = sim.getDir(dx, dy), [ux, uy] = sim.moveVecByDir[dir], nx = -uy, ny = ux;
  const off = (i, j, t) => (ex + dx * t - i - 0.5) * nx + (ey + dy * t - j - 0.5) * ny;
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
    if (stop(ci, cj, ez + dz * t, off(ci, cj, t), dir)) return true;
  }
  // the last tile's obstacle hides the part of it beyond its center
  if (sim.obstacleHeightAt(ti, tj) <= 0) return false;
  const t = ((ti + 0.5 - ex) * dx + (tj + 0.5 - ey) * dy) / len2;
  return t > 0 && t < 1 && stop(ti, tj, ez + dz * t, off(ti, tj, t), dir);
}

// Whether the obstacle on tile (i, j), if any, stops a line at height z passing its center
// at off heading dir (see walkLine): above the line, and the rock across its way.
const obstacleBlocks = (i, j, z, off, dir) => {
  const across = sim.obstacleAcross(i, j, dir);
  return across !== null && off >= across[0] && off <= across[1] && sim.sightHeightAt(i, j) > z;
};

// Whether the line passes above every tile in between: the ground at each one's center,
// and any obstacle on it where the rock stands.
const sightBlocked = (i, j, z, off, dir) => sim.centerHeightAt(i, j) > z || obstacleBlocks(i, j, z, off, dir);
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
// in its sight circle and line of sight.
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
function obstacleInWay(a, gx, gy, gz = sim.heightAt(gx, gy)) {
  if (!use.lineOfSight) return false;
  return walkLine(a.gx, a.gy, sim.heightAt(a.gx, a.gy) + eyeLevels(a), gx, gy, gz,
    obstacleBlocks);
}

// COVER: how hidden a wolf lying at grid point (gx, gy) would be from creatures going by:
// the share of coverDirs ways, at coverLookTiles off, from which a deer's eye (and a
// wolf's is no higher) would have no line of sight to it (lying, its back coverLyingLevels
// up). For a den (mind.js: DENS).
const coverDirs = Array.from({ length: 16 }, (_, k) => [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);
const coverLookTiles = 6, coverLyingLevels = 1;
function coverAt(gx, gy) {
  const z = sim.heightAt(gx, gy) + coverLyingLevels;
  let hidden = 0;
  for (const [ux, uy] of coverDirs) {
    const x = gx + ux * coverLookTiles, y = gy + uy * coverLookTiles;
    if (!clearLine(x, y, sim.heightAt(x, y) + eyeLevelsBySpecies.deer, gx, gy, z)) hidden++;
  }
  return hidden / coverDirs.length;
}

// For tests: critter a forgets what it has seen lately (sees afresh: KEEPING SIGHT).
function forgetSight(a) { lastSeen.delete(a); }

// Whether critter a sees creature b (alive or a corpse) now: in its field of view, in its
// sight circle or seen within keepSightS (see KEEPING SIGHT), and in line of sight.
function seesNow(a, b) {
  if (!sim.can(a, "see")) return false;
  const dx = b.gx - a.gx, dy = b.gy - a.gy;
  let mine = lastSeen.get(a);
  const last = mine && mine.get(b.uid);
  const kept = last !== undefined && sim.now - last <= keepSightS;
  if (last !== undefined && !kept) mine.delete(b.uid);
  if (!inView(a, dx, dy) || (kept ? dx * dx + dy * dy > detect2 : !inSight(dx, dy, sightShare(a)))) return false;
  if (!canSee(a, b)) return false;
  if (!mine) lastSeen.set(a, mine = new Map());
  mine.set(b.uid, sim.now);
  return true;
}

// Whether critter a sees creature b, as perceive tells by sight (for the view).
const seesCreature = seesNow;

// HEARING: how far a creature moving on each ground, at each gait, can be heard, in tiles
// (1 m), as [by day, by night]: its footfalls standing out of a breezy day's background
// (30 dBA) or a calm night's (20 dBA), blended through the twilight by daylight
// (sim.clock.light). Worked out from each footfall's loudness at 1 m (estimates, in dBA:
// a wolf's padded feet walking on grass 30, on dirt 33, on stone 37; a deer's hooves 4 to
// 9 dB louder; a trot some 9 dB over a walk, a gallop some 20; a wolf stalking 10 dB under
// a walk, and a newborn crawling as quiet), fading 6 dB as the distance doubles, and 5 dB more each 100 m over the ground
// (admin/hearing.md). Splashing, swimming, is heard as far on any water.
const hearingRangeTiles = {
  wolf: {
    grass: { crawl: [0.5, 1],   stalk: [0.5, 1],   walk: [1, 3],     trot: [2.5, 8], gallop: [9, 27] },
    dirt:  { crawl: [0.5, 1.5], stalk: [0.5, 1.5], walk: [1.5, 4.5], trot: [4, 12],  gallop: [16, 44] },
    stone: { crawl: [0.5, 2],   stalk: [0.5, 2],   walk: [2, 7],     trot: [6, 18],  gallop: [27, 68] },
  },
  deer: {
    grass: { crawl: [0.5, 1],   walk: [1.5, 5],    trot: [5, 15],    gallop: [18, 48] },
    dirt:  { crawl: [0.5, 1.5], walk: [2.5, 8],    trot: [8, 22],    gallop: [30, 73] },
    stone: { crawl: [0.5, 2],   walk: [6, 18],     trot: [18, 48],   gallop: [57, 123] },
  },
};
const swimHeardTiles = [16, 44];
// HOWLS (sim.js: HOWLING): a wolf howling is heard this far, by day and by night: howls
// were identified some 3 km off by recorders (Suter et al. 2017, Bioacoustics), and are
// heard over as much as 130 km2 (some 6.4 km round) when the air is still (as at night);
// low and long, a howl loses far less on its way than a footfall (admin/hearing.md).
const howlHeardTiles = [3000, 6400];
// BARKS (sim.js: BARKING): a wolf's soft bark, its signal (o.signal) to those near: about
// 70 dBA at 1 m (wolves bark softer than dogs, whose barks reach 80-100 dB; a soft bark
// some 20 dB under), heard as any sound is (admin/hearing.md: by day to 68 m, by night 141,
// held to detectTiles' 123 so that barks are found in the grid: NEARBY). A pup's whimper
// some 10 dB softer (estimate): by day to 28 m, by night 69.
const barkHeardTiles = [68, 123];
const whimperHeardTiles = [28, 69];
const signalHeardTiles = signal => signal && signal.kind === "whimper" ? whimperHeardTiles : barkHeardTiles;

// The range now (by daylight) of [by day, by night].
const nowHeard = ([day, night]) => night + (day - night) * sim.clock.light;
// How far a creature of a species moving at a gait on a ground is heard now, in tiles.
function hearingRangeOf(species, ground, gait) {
  const r = gait === "swim" ? swimHeardTiles : hearingRangeTiles[species]?.[ground]?.[gait];
  return r ? nowHeard(r) : 0;
}

const loudestTiles = Math.max(swimHeardTiles[1],
  ...Object.values(hearingRangeTiles).flatMap(byGround => Object.values(byGround).flatMap(byGait => Object.values(byGait).map(r => r[1]))));

// How far critter b can be heard now: worked out once a tick per critter (the terrain
// lookup is costly), kept in heardRangeOf.
const heardRangeOf = new Map();
let heardTick = -1;
function hearingRange(b) {
  if (heardTick !== sim.tickCount) { heardRangeOf.clear(); heardTick = sim.tickCount; }
  let r = heardRangeOf.get(b);
  if (r === undefined) {
    if (!(b.speed > 0) || !sim.isLiveCritter(b)) r = 0;
    else r = hearingRangeOf(b.species, b.pose === "swim" ? null : sim.getTerrainAt(b.gx, b.gy), b.pose);
    heardRangeOf.set(b, r);
  }
  return r;
}

// The farthest any sense reaches but for howls (heard farther, and perceived wherever they
// are): a deer galloping on stone at night, heard loudestTiles off (a bark by night as far).
const detectTiles = Math.max(sightRadiusTiles, loudestTiles, barkHeardTiles[1]);
const detect2 = detectTiles * detectTiles;

// SMELL
// How near a critter smells another creature or a carcass, in tiles (estimate).
const sniffTiles = 3;
// Trails: how far around itself a critter smells the ground, in tiles (r: a nearly round
// patch, the square r tiles out each way, plus on each of its sides a row of 2r - 1 tiles
// and beyond that one of 2r - 3, centered: for a wolf 7 x 7, with rows of 5 and of 3);
// and the faintest trail it can smell (a share of a fresh one's strength: older than that
// many half-lives, sim.scentHalfLifeS, it can't). Wolves track; deer don't follow trails (yet).
const trailSniffTiles = { wolf: 3, deer: 2 };
const trailMinStrength = { wolf: 1 / 8, deer: 1 / 2 };

// Whether tile offset (di, dj) is in a sniffing patch of reach r (see Trails).
function inSniffPatch(di, dj, r) {
  const far = Math.max(Math.abs(di), Math.abs(dj)), side = Math.min(Math.abs(di), Math.abs(dj));
  return far <= r || far === r + 1 && side <= r - 1 || far === r + 2 && side <= r - 2;
}

// The trails of species in the sniffing patch of critter a (trailSniffTiles) that it can
// still smell: [{ i, j, ageS, uid }], and for a critter's trail its maker's isMale, grown
// and paired.
function trailsAround(a, species) {
  if (!use.smell) return [];
  const makers = new Map(); // uid -> { isMale, grown, paired }
  const maker = uid => {
    let k = makers.get(uid);
    if (k === undefined) {
      const c = sim.allCritters.find(c => c.uid === uid) || sim.allCorpses.find(c => c.uid === uid);
      k = c ? { isMale: c.isMale, grown: sim.isGrown(c), paired: c.mateUid !== null } : null;
      makers.set(uid, k);
    }
    return k;
  };
  const r = trailSniffTiles[a.species], R = r + 2, ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const maxAgeS = Math.log2(1 / trailMinStrength[a.species]) * sim.scentHalfLifeS;
  const out = [];
  for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
    if (!inSniffPatch(i - ci, j - cj, r)) continue;
    const s = sim.scentAt(i, j, species);
    if (s && s.ageS <= maxAgeS) out.push(species === "death" ? { i, j, ageS: s.ageS, uid: s.uid } : { i, j, ageS: s.ageS, uid: s.uid, ...maker(s.uid) });
  }
  return out;
}

// What critter a perceives now, one snapshot per creature it perceives (the dying and the
// dead included), by the most telling sense:
//   { uid, species, alive, gx, gy, vx, vy, swimming, meat, leg, by, littermate, signal,
//     isMale, infant, grown, walks, eats, carrying, mateUid, inHeat }   (these last by sight only)
//   signal:  barking, by sight or hearing, the signal it barks, { kind, tick } (BARKS)
//   leg:     for a carcass seen or smelled, whether a leg is still on it with meat to carry off
//   littermate: true for one born with it to its mother, by any sense (its scent tells)
//   by:      "sight", "hearing" or "smell"
//   vx, vy:  its velocity, tiles a tick (0 by smell)
//   meat:    for a carcass, the share of its meat left (1 all, 0 only bones)
//   mateUid: its partner's uid, or null
function perceive(a) {
  const out = [];
  const hears = use.hearing && sim.can(a, "hear"), smells = use.smell;
  const near = nearby(a), all = grid.all;
  for (let n = 0; n < near.length; n++) {
    const b = all[near[n]];
    if (b === a) continue;
    const dx = b.gx - a.gx, dy = b.gy - a.gy, d2 = dx * dx + dy * dy;
    if (d2 > detect2 && b.pose !== "howl") continue; // (beyond every sense but howls)
    const barking = sim.tickCount < b.barkUntil;
    const alive = sim.isLiveCritter(b);
    let by = null;
    if (seesNow(a, b)) by = "sight";
    else {
      // the cheap tests first: distance, then what it costs to find out more
      if (hears && (b.pose === "howl" && d2 <= nowHeard(howlHeardTiles) ** 2 || barking && d2 <= nowHeard(signalHeardTiles(b.signal)) ** 2)) by = "hearing";
      else if (hears && b.speed > 0 && d2 <= loudestTiles * loudestTiles) {
        const heard = hearingRange(b);
        if (heard && d2 <= heard * heard) by = "hearing";
      }
      if (!by && smells && (alive || b.carcass) && d2 <= sniffTiles * sniffTiles) by = "smell";
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
    if (b.carcass && (by === "sight" || by === "smell")) o.leg = !!sim.legToTake(b); // (a leg to carry off on it: CARRYING)
    if (suckling) o.nursingOnMe = true;
    if (sim.tickCount < b.barkUntil && (by === "sight" || by === "hearing")) o.signal = b.signal; // (barking now: BARKS)
    if (a.parentUids.length && b.parentUids && b.parentUids[0] === a.parentUids[0] && b.birthTime === a.birthTime) o.littermate = true;
    if (by === "sight") {
      o.isMale = b.isMale; o.infant = sim.isInfant(b); o.grown = sim.isGrown(b); o.walks = sim.can(b, "walk");
      o.eats = sim.can(b, "eat"); o.carrying = !!b.carrying;
      o.mateUid = b.mateUid; o.inHeat = alive && sim.inHeat(b);
    }
    out.push(o);
  }
  return out;
}

// NEARBY: every creature (critters, then corpses) in a square grid, cellTiles a side,
// built afresh at the first call in a tick (positions only change between ticks; a test
// that moves creatures within one calls regrid). Cells 2 apart along either axis hold
// creatures more than cellTiles (at least detectTiles) apart, so a critter's candidates
// are in the 3 x 3 cells about its own.
const cellTiles = Math.ceil(detectTiles);
if (!Number.isInteger(cellTiles) || cellTiles < 10) alert("senses: cellTiles must be an integer of 10 or more");
const cellKey = (i, j) => i * 65536 + j; // (|j| under 32768 cells: unique)
const grid = { tick: -1, all: [], cells: new Map(), howlers: [] };
function regrid() { grid.tick = -1; }
function buildGrid() {
  const all = grid.all, cells = grid.cells, howlers = grid.howlers;
  all.length = 0; howlers.length = 0; cells.clear();
  for (const list of [sim.allCritters, sim.allCorpses]) for (const b of list) all.push(b);
  for (let n = 0; n < all.length; n++) {
    const b = all[n], k = cellKey(Math.floor(b.gx / cellTiles), Math.floor(b.gy / cellTiles));
    const cell = cells.get(k);
    if (cell) cell.push(n); else cells.set(k, [n]);
    if (b.pose === "howl") howlers.push(n);
  }
  grid.tick = sim.tickCount;
}
// Indices into grid.all of the creatures that may be within detectTiles of critter a (a
// itself among them), and of those howling, in grid.all's order.
let nearBuf = new Int32Array(256);
function nearby(a) {
  if (grid.tick !== sim.tickCount) buildGrid();
  const ci = Math.floor(a.gx / cellTiles), cj = Math.floor(a.gy / cellTiles), cells = grid.cells;
  let m = 0;
  const add = n => {
    if (m === nearBuf.length) { const b = new Int32Array(m * 2); b.set(nearBuf); nearBuf = b; }
    nearBuf[m++] = n;
  };
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const cell = cells.get(cellKey(ci + di, cj + dj));
    if (cell) for (let k = 0; k < cell.length; k++) add(cell[k]);
  }
  for (const n of grid.howlers) {
    const b = grid.all[n], di = Math.floor(b.gx / cellTiles) - ci, dj = Math.floor(b.gy / cellTiles) - cj;
    if (di < -1 || di > 1 || dj < -1 || dj > 1) add(n);
  }
  return nearBuf.subarray(0, m).sort();
}

// The tiles with plant food on them (grass, undergrowth: sim.plantFoodAt) whose centers
// are in the sight circle of critter a (as much of it as it sees now: sightShare), or
// within share k of that, and in its field of view: [{ i, j, kg }]. (Line of sight is left
// to the mind to check, with canSeeTile, for the few it considers: there are thousands.)
function plantsAround(a, k = 1) {
  k *= sightShare(a);
  const out = [], ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const r = Math.ceil(k * sightRadiusTiles) + 1;
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    if (!inSight(i + 0.5 - a.gx, j + 0.5 - a.gy, k) || !inView(a, i + 0.5 - a.gx, j + 0.5 - a.gy)) continue;
    const kg = sim.plantFoodAt(i, j);
    if (kg > 0) out.push({ i, j, kg });
  }
  return out;
}

// The shores whose centers are in the sight circle of critter a (as much of it as it
// sees now) and its field of view: open land tiles beside water (on one of their four sides), [{ i, j }]. Line
// of sight is left to the mind, as for plantsAround.
function shoresAround(a) {
  const k = sightShare(a), ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const r = Math.ceil(k * sightRadiusTiles) + 2, n = 2 * r + 1;
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
  attach, perceive, coverAt, plantsAround, shoresAround, trailsAround, inSight, inView, canSee, canSeeTile, canSeePoint, seesCreature, obstacleInWay, use, sightShare, sky, nightSightShare,
  sightRadiusTiles, detectTiles, cellTiles, regrid, nearbyCreatures: a => Array.from(nearby(a), n => grid.all[n]), fovDegBySpecies, keepSightS, trailMinStrength, hearingRangeTiles, hearingRangeOf, forgetSight, eyeLevelsBySpecies, sniffTiles, barkHeardTiles, whimperHeardTiles, nowHeard,
};

})();

// In Node, senses.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = senses;
