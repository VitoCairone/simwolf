// THE SIMULATION: the world, its critters and its rules, advanced one tick at a time.
//
// This file has no idea how (or whether) the world is drawn or controlled: it never
// touches the DOM, and it runs as is without a browser (see tests/headless.test.js).
// Everything it offers is on the one global it defines, `sim` (the interface at the end
// of this file). Drawing is animat.js, which reads sim's state; input is controls.js,
// which turns the player's input into intents for sim. Neither is required: without them
// (consoleOnly) the world simply runs on its own as fast as it can.
//
// Positions are grid coordinates: tile (i, j) covers [i, i+1) x [j, j+1).

const sim = (() => {

let consoleOnlyMode = false; // set by start(): run as fast as possible, log each tick
let tempo = 1/60;
// TODO: change speed convert so it responds when tempo is changed at runtime
let g_tick = 0; // updates ONE PLACE ONLY in tick()
let g_now = 0; // also updates ONLY ONE PLACE in tick()
// g_now is elapsed seconds; IFF tempo stays constant, g_now = g_tick * tempo
let g_next_uid = 0;
let isPaused = false;

// parameters
const gridWidthN = 900; //3533088 = c * 1/60 sec / root2
const gridHeightN = 900;

// NOTE: tileMap and terrainTypes below are not used by anything (kept as reference).
// when source becomes multiple files, read this sort of fixed data from its own file
const tileMap = [
  ["dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt"],
  ["dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt", "dirt"],
  ["grass", "grass", "grass", "dirt", "dirt", "grass", "grass", "plant", "plant", "plant", "plant"],
  ["bush", "bush", "bush", "bush", "grass", "tallgrass", "tallgrass", "grass", "+ flower", "+ flower", "+ bush"],
  ["+ flower", "+ bush", "+ flower", "+ flower", "+ log", "+ log", "+ log", "+ log", "+ log", "+ rock", "+ rock"],
  ["+ rock", "+ rock", "+ rock", "+ rock", "+ rock", "+ rock", "stone", "+ stone", "stone", "rock", "rock"],
  ["+ rock", "+ rock", "w-stone", "w-stone", "w-rock", "w-rock", "w-rock", "w-rock", "w-rock", "w-rock", "w-rock"],
  ["w-rock", "w-rock", "w-rock", "w-rock", "w-rock", "splash", "splash", "splash", "splash", null, null],
  ["water", "water", "water", "water", "water", "water", "water", "water", "water", null, null],
  ["water", "water", "water", "water", "water", "water", "water", "water", "water", null, null],
  ["ice", "ice", "ice", "ice", "ice", "ice", "ice", "ice", "ice", "ice", "ice"]
];

const terrainTypes = [
  "dirt", "grass", "bush", "tallgrass", "flower", "rock", "stone", "water", "ice"
];

function sqr(x) { return x * x; }

function sample(list) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// How long a dying critter is in the "death" pose before it becomes a corpse ("dead").
// (animat times the death animation to play through exactly once in this time, and
// checks that it does.)
const deathDurationSBySpecies = { deer: 2 / 3 }; // deer: 5 frames of 8 ticks

const hourS = 60 * 60;
const dayS = 24 * hourS;
const yearS = dayS * 365;
const monthS = yearS / 12;

// full table here fo reference is simplified for MVP use to one value each
const canAtAgeBySpecies =  {
  wolf: {
    see:    { min: 9 * dayS,  avg: 12 * dayS,  max: 15 * dayS },
    hear:   { min: 10 * dayS, avg: 14 * dayS,  max: 18 * dayS },
    walk:   { min: 14 * dayS, avg: 18 * dayS,  max: 21 * dayS },
    eat:    { min: 19 * dayS, avg: 25 * dayS,  max: 35 * dayS },
    run:    { min: 25 * dayS, avg: 28 * dayS,  max: 35 * dayS },
    mate:   { min: 18 * monthS, avg: 24 * monthS,  max: 36 * monthS },
    liveTo: { min: 6 * yearS, avg: 8 * yearS, max: 16 * yearS }
  },
  deer: {
    see:    { min: 0, avg: 0, max: 0 },
    hear:   { min: 0, avg: 0, max: 0 },
    walk:   { min: 0.25 * hourS, avg: 0.5 * hourS, max: 1 * hourS},
    eat:    { min: 10 * dayS, avg: 20 * dayS, max: 30 * dayS },
    run:    { min: 1 * dayS, avg: 2 * dayS, max: 3 * dayS },
    mate:   { min: 16 * monthS, avg: 24 * monthS,  max: 36 * monthS },
    liveTo: { min: 8 * yearS, avg: 12 * yearS, max: 25 * yearS }
  }
};

['wolf', 'deer'].forEach(species => {
  ['see', 'hear', 'walk', 'eat', 'run', 'mate'].forEach(cap => {
    canAtAgeBySpecies[species][cap] = canAtAgeBySpecies[species][cap].avg;
  });
  canAtAgeBySpecies[species].liveTo = canAtAgeBySpecies[species].liveTo.max;
});

function _can(a, capability) {
  if (a.isHaltedUntil) return false;
  return g_now - a.birthTime >= canAtAgeBySpecies[a.species][capability];
}

//  wolf
//  halfWeight:  { min: 5 * monthS, avg: 6.5 * monthS, max: 7 * monthS },
//  fullWeight:  { min: 18 * monthS, avg: 21 * monthS,  max: 24 * monthS},
//  gestation:   { min: 61 * dayS, avg: 62 * dayS,  max: 63 * dayS }

// redDeer: {
//    halfWeight:   { min: 10, avg: 12, max: 14 },  // months
//    fullWeight:   { min: 48, avg: 54, max: 60 },  // months
//    gestation:    { min: 230, avg: 233, max: 240 } // days
//  }


// Every change of a critter's pose goes through here. a.poseTick records the tick it
// started, which is all a viewer needs to animate the pose (the simulation itself has no
// notion of animation frames).
function setPose(a, pose) {
  if (a.pose === pose) return;
  a.pose = pose;
  a.poseTick = g_tick;
}

// Wolf setup
const nWolves = 10;
const wolves = Array.from({length: nWolves}, () => ({}));
const pcWolf = wolves[0];

const nDeer = 10;
const deer = Array.from({length: nDeer}, () => ({}));

const allLandTiles = [];

function randomlyPlaceCritter(a) {
  if (!allLandTiles.length) {
    if (gridHeightN * gridWidthN > 1000000) {
      alert("ERORR: randomlyPlaceCritter not implemented yet for maps > 1M tiles");
    }
    // collect all land tiles once
    for (var i = 0; i < gridWidthN; i++) {
      for (var j = 0; j < gridHeightN; j++) {
        if (getTerrainAt(i, j) !== "water" && !isBlockedTile(i, j)) allLandTiles.push([i, j]);
      }
    }
  }

  const [randLandX, randLandY] = sample(allLandTiles);

  // used for initial assignment of [gx, gy] -- should update ONLY in moveAllTogether()
  // position tile centered (on half-integer vals) for simple initial overlap check
  a.gx = randLandX + 0.5;
  a.gy = randLandY + 0.5;
  a.redecideCd = 0; // Cd = Cooldown (ticks)
  a.currentDirection = Math.floor(Math.random() * 4) * 2;
  setCritterIdle(a);
}

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

// searchmeta makeCritter createCritter makeWolf createWolf makeWisp createWisp
function initCritter(a, species, isNewborn = false) {
  if (!a) return alert("Falsy ref to initCritter");
  if (a.kind) return alert("Already-kind ref to initCritter");
  a.kind = 'critter';
  a.species = species;
  a.birthTime = g_now - (isNewborn ? 0 : randBetween(
    canAtAgeBySpecies[species].mate, canAtAgeBySpecies[species].liveTo * 0.5
  ));
  
  // UIDs are unique across all kind objects and permanent
  a.uid = g_next_uid++;
  a.isMale = Math.random() < 0.5;

  a.speed = 0;
  a.wind = 1;    // burst reserve, 0..1 (see EXERTION)
  a.stamina = 1; // endurance reserve, 0..1

  randomlyPlaceCritter(a);

  return a;
}

const allCritters = [];
const allCorpses = [];

const ROOT2 = Math.sqrt(2);
const INVROOT2 = 1 / ROOT2;

const moveVecByDir = [
  [ 1, 0 ],
  [ INVROOT2, INVROOT2 ],
  [ 0, 1 ],
  [ -INVROOT2, INVROOT2 ],
  [ -1, 0 ],
  [ -INVROOT2, -INVROOT2 ],
  [ 0, -1 ],
  [ INVROOT2, -INVROOT2 ],
];

// THE PLAYER
// The player's wolf (pcWolf) is driven by the player's intent when there is one, and by
// its own decisions (like every other critter) when there isn't. How the intent is
// produced (keys, the movement pad, a script) is not the simulation's business: it is
// set with setPlayerIntent and applied at the start of every tick, so the world never
// changes while paused.
//   null                  no intent: the wolf decides for itself
//   { gait: "idle" }      stand still (tread water, in water)
//   { dir, gait }         move in grid direction dir (DIR_*) at gait walk/trot/gallop,
//                         or the best gait wind and stamina allow
let playerIntent = null;
let playerIntentApplied = false; // whether the player was in control at the last tick

function setPlayerIntent(intent) {
  playerIntent = intent || null;
}

function playerHasControl() {
  return playerIntent !== null;
}

function applyPlayerIntent() {
  if (playerIntent) {
    playerIntentApplied = true;
    if (playerIntent.gait === "idle") setCritterIdle(pcWolf);
    else setCritterMoving(pcWolf, playerIntent.dir, playerIntent.gait);
  } else if (playerIntentApplied) {
    // the player let go: stop, and let the wolf's own decisions resume after a normal
    // interval instead of instantly overriding the stop (redecideCd keeps counting down
    // while the player is in control)
    playerIntentApplied = false;
    setCritterIdle(pcWolf);
    pcWolf.redecideCd = Math.max(pcWolf.redecideCd, 120);
  }
}

// TERRAIN
// Everything about the ground is a pure function of the tile: no memory, no random
// numbers, cheap to evaluate anywhere, built from the two waves below. Each question has
// its own field, and the fields are independent of each other:
//   1. SEA           seaFieldAt     where the sea is: draws the coastline
//   2. RELIEF        reliefAt       where the lakes are, and how high the land is
//   3. GROUND COVER  groundCoverAt  grass, dirt or stone on land
//   4. OBSTACLES     obstacleAt     boulders standing on land
// getTerrainAt combines 1-3 into a tile's terrain type, and is the ONE place that decides
// what is water (sea or lake): everything else asks it. TERRAIN HEIGHT (below) uses 2
// for the land's height, and flattens whatever getTerrainAt calls water.
//
// Because 1 and 2 are independent, the sea's coastline cuts across the land at whatever
// height the land has there (giving sea cliffs), while lakes, being the lowest relief,
// always have gentle shores.

// Triangle wave: 0 at whole numbers, 1 halfway between, straight lines in between.
function jag(x) {
  return 2 * Math.abs(x - Math.floor(x + 0.5));
}

// Smooth wave: like jag, but eased (smoothstep) so it rounds off at 0 and 1 instead of
// turning sharply. Thresholds on sums of these give rounded regions, not polygons.
function wave(x) {
  const t = jag(x);
  return t * t * (3 - 2 * t);
}

// 1. SEA: a ring pattern around the map's center, made irregular by jitter. Below
// seaBelow is sea: the map is a sea in the middle, a ring of land, a ring of sea, and
// land again in the corners. The rings come from a triangle wave of the squared distance
// from the center (q): the inner sea is the wave's first rise, the land ring is around
// its first crest (q = 1/2), the outer sea its next trough, and so on. The field is that
// wave minus 0.7, plus jitter: four very slow triangle waves (periods 103 to 199 tiles,
// in four directions) weighted 0.25 between them, which push the coasts in and out by
// different amounts in different places, so the rings' edges aren't circles.
//
// innerSeaShrink pulls the inner sea's coast out toward the crest, shrinking the inner
// sea while leaving everything from the crest outward - the ring's outer coast, the
// outer sea, the corners - exactly as it was. (At 0.5 that was about 25% less sea with
// the gentler jitter it was tuned with; with the jitter at 0.25 the inner water is about
// 12% smaller than without it, lakes included.) Inside the crest q is remapped by
// t -> t * (1 + innerSeaShrink * (1 - t)), with t = 2q: 0 stays 0 and the crest stays
// the crest, so the field stays continuous. (Keep it within 0..1.)
const seaBelow = 0.2;
const innerSeaShrink = 0.5;
const mapCenterX = gridWidthN / 2;
const mapCenterY = gridHeightN / 2;
const mapCornerDist = Math.sqrt(mapCenterX * mapCenterX + mapCenterY * mapCenterY);

function seaFieldAt(x, y) {
  // For desmos.com/3d:
  // 2*abs((x*x+y*y)-floor(x*x+y*y+0.5)) - 0.7  (the ring wave, before jitter)
  // for x,y in range [-1.25, 1.25]
  const [rx, ry] = [x - mapCenterX, y - mapCenterY].map(v => v * 1.25 / mapCornerDist);
  let q = rx * rx + ry * ry;
  if (q < 0.5) { // inside the land ring's crest: shrink the inner sea
    const t = 2 * q;
    q = 0.5 * t * (1 + innerSeaShrink * (1 - t));
  }
  return jag(q) - 0.7 + (
    jag(x / 103) + jag(y / 109) + jag ((x + y) / 127) + jag((x - y) / 199)
  ) * 0.25
}

// 2. RELIEF, about 0..1: the lie of the land. Below lakeBelow is a lake; above it, the
// land's elevation is how far above lakeBelow it is (landElevationAt), so the land rises
// from the lakes' shores. lakeBelow is used for both: change it in one place only.
// It is made of three parts, on two scales:
//   - REGIONS, hundreds of tiles across, give large areas their own character:
//       hilliness  0 in plains .. 1 in hill country (with soft borders between)
//       upland     -1 in lowlands .. 1 in uplands: how high the land lies overall, so
//                  plains may be low (where shallow lakes gather) or raised plateaus
//   - DETAIL, tens of tiles across: hills and hollows, scaled by the hilliness. Flat
//     in plains (gentle undulation only), full height in hill country, where lakes lie in
//     the valleys. It uses smooth waves for rounded tops and floors, and is sampled on
//     warped coordinates so it doesn't repeat in a regular pattern.
// (Region sizes are in tiles, not fractions of the map: a small map may lie within one
// or two regions.)
const lakeBelow = 0.44;
const reliefBase = 0.52;           // relief of the average plain
const reliefUplandRange = 0.08;    // how much higher uplands are, and lowlands lower
const reliefHillsLift = 0.06;      // hill country also lies a little higher
const reliefPlainsDetail = 0.1;    // share of the full detail left in plains
const hillinessFrom = 0.35;        // the hilliness field's plains (below) ...
const hillinessTo = 0.65;          // ... and hill country (above)

function reliefAt(x, y) {
  // regions: how hilly...
  const h = (wave(x / 311 + 0.6 * wave(y / 263)) + wave(y / 337 + 0.6 * wave(x / 229))) / 2;
  const t = Math.min(1, Math.max(0, (h - hillinessFrom) / (hillinessTo - hillinessFrom)));
  const hilliness = t * t * (3 - 2 * t);
  // ...and how high the land lies
  const upland = wave(x / 401 + 0.3) + wave(y / 367 + 0.7) - 1;

  // detail, on warped coordinates
  const wx = x + 22 * (wave(y / 97 + 0.5 * wave(x / 71)) - 0.5) + 12 * (wave((x + y) / 53) - 0.5);
  const wy = y + 22 * (wave(x / 89 + 0.5 * wave(y / 83)) - 0.5) + 12 * (wave((x - y) / 59) - 0.5);
  const sum = wx + wy;
  const dif = wx - wy;
  const fastNoise = wave(wx / 19) + wave(wy / 23) + wave(sum / 29) + wave(dif / 31); // => [0, 4]
  const slowNoise = (jag(wx / 37) + jag(wy / 41) + jag(sum / 43) + jag(dif / 47)) * 0.3
    + (jag(wx / 53) + jag(wy / 59) + jag(sum / 61) + jag(dif / 67)) * 0.2; // => [0, 2]
  const detail = (fastNoise + slowNoise) / 6 - 0.5; // -0.5..0.5

  return reliefBase + reliefUplandRange * upland + reliefHillsLift * hilliness
    + detail * (reliefPlainsDetail + (1 - reliefPlainsDetail) * hilliness);
}

// The highest relief reliefAt can give: uplands (upland 1), full hill country (hilliness
// 1) and the detail at its top (0.5). Keep in step with reliefAt.
const reliefHighest = reliefBase + reliefUplandRange + reliefHillsLift + 0.5;

// Elevation of land above the lakes' level, in relief units (negative = a lake).
function landElevationAt(x, y) {
  return reliefAt(x, y) - lakeBelow;
}

// The terrain type of the tile containing (gx, gy): "water" (sea or lake), or the land's
// ground cover ("grass", "dirt", "stone").
function getTerrainAt(gx, gy) {
  // ensure the same result for any point in the tile
  const [x, y] = [gx, gy].map(v => Math.floor(v));

  const seaField = seaFieldAt(x, y);
  if (seaField < seaBelow) return "water"; // sea
  if (landElevationAt(x, y) < 0) return "water"; // lake

  return groundCoverAt(x, y);
}

// (Earlier experiments, not used. Note they rely on pseudorandom hashing, which the
// terrain functions above avoid.)
//   const hash = Math.sin((x * 374761393 + y * 668265263) % 1000000) * 43758.5453;
//   const pseudoRandom = hash - Math.floor(hash); // [0, 1)
//   if (pseudoRandom < 0.75 * Math.pow(1 - (unitVariant * 2 - 0.5), 3)) return "bush";
//
//   const typePseudorandInt = (x * 73856093) ^ (y * 19349663);
//   const types = ["dirt", "grass", "bush"];
//   return types[Math.abs(typePseudorandInt) % types.length];

// 3. GROUND COVER of land: grass, dirt or stone, independent of height (all passable;
// boulders are separate, see OBSTACLES). It makes continuous regions:
//   1. warp: the tile's position is shifted by amounts that themselves vary slowly over
//      the map (twice: broad and finer), so region edges meander instead of running
//      along the straight lines and regular spacing of the waves below
//   2. patch: four smooth waves of incommensurate periods, in four directions, sampled
//      at the warped position; their average (0..1, mostly near 0.5) sets the region
//   3. fringe: a little fast variation, so edges are ragged at the scale of single tiles
// Highest patch values are stone, set inside the next band, dirt: stony ground in bare
// patches, among grass. (About 71% grass, 25% dirt, 4% stone on the current map.)
const coverPatchTiles = 23;   // patch size: the waves' base period, in tiles
const coverWarpTiles = 14;    // how far the broad warp moves a point, at most
const coverFineWarpTiles = 5; // how far the finer warp moves it
const coverFringe = 0.08;     // weight of the tile-scale raggedness
const coverDirtAbove = 0.6;   // patch value above which ground is dirt...
const coverStoneAbove = 0.8;  // ...and stone

function groundCoverAt(x, y) {
  const ox = coverWarpTiles * (wave(y / 37 + 0.5 * wave(x / 53)) + wave((x - y) / 47) - 1);
  const oy = coverWarpTiles * (wave(x / 41 + 0.5 * wave(y / 59)) + wave((x + y) / 61) - 1);
  const wx = x + ox, wy = y + oy;
  const vx = wx + coverFineWarpTiles * (wave(wy / 13) - 0.5);
  const vy = wy + coverFineWarpTiles * (wave(wx / 11) - 0.5);

  const s = coverPatchTiles;
  const patch = (wave(vx / s) + wave(vy / (s * 1.13))
    + wave((vx + vy) / (s * 1.41)) + wave((vx - vy) / (s * 1.73))) / 4;
  const fringe = (jag(x / 3.7) + jag(y / 4.3) + jag((x + y) / 5.9)) / 3;
  const v = patch + coverFringe * (fringe - 0.5);

  if (v > coverStoneAbove) return "stone";
  if (v > coverDirtAbove) return "dirt";
  return "grass";
}

// 4. OBSTACLES: impassable objects standing on a tile, separate from what the ground is.
// For now the only one is the boulder, on any land tile (none on water: it asks
// getTerrainAt). It is kept cheap: a few triangle and smooth waves, no square roots or
// trig, and most tiles are decided after the first test or two. Boulders cover about 4% of land, in two forms:
//   - WALLS one or two boulders thick, meandering in roughly parallel lines, only in some
//     regions (running one way in some, another way in others) and broken by gaps. A
//     wall is where jag(u) = 1/2 for a smoothly warped coordinate u: jag's slope is the
//     same everywhere, so the walls keep an even width without measuring it. They can
//     still cut off small patches of land here and there.
//   - lone boulders, scattered in some areas, so that elsewhere there are open expanses.
// Boulders block movement and sight.
const wallHalfWidth = 0.085;  // of jag's 0..1 range; with wallSpacingTiles about 1.5 tiles thick
const wallRag = 0.03;         // how much the walls' edges wander
const wallWarpTiles = 9;      // how far the walls bend from straight lines
const wallSpacingTiles = 23;  // distance between neighbouring walls in a region
const wallRegionAbove = 0.8;  // walls running one way where the region field is above this...
const wallRegionBelow = 0.2;  // ...and the other way where it is below this
const wallGapTiles = 7;       // spacing of the gaps along walls
const wallGapAbove = 0.75;    // larger = fewer, shorter gaps
const loneBoulderAreaAbove = 0.55; // lone boulders only where this area field is above...
const loneBoulderAbove = 0.8;      // ...and there, larger = fewer of them

// The obstacle on tile (i, j) ("boulder"), or null.
function obstacleAt(gx, gy) {
  const x = Math.floor(gx), y = Math.floor(gy);
  return isBoulderSite(x, y) && getTerrainAt(x, y) !== "water" ? "boulder" : null;
}

function isBoulderSite(x, y) {
  const region = (jag(x / 71 + 0.3) + jag(y / 61 + 0.6)) / 2; // 0..1
  let u = null;
  if (region > wallRegionAbove) {
    u = (x + wallWarpTiles * (wave(y / 17) + 0.6 * wave((x + y) / 29))) / wallSpacingTiles;
  } else if (region < wallRegionBelow) {
    u = (x + y + wallWarpTiles * (wave((x - y) / 19) + 0.6 * wave(y / 31))) / (wallSpacingTiles * 1.3);
  }
  if (u !== null) {
    const rag = jag(x / 2.9) + jag(y / 3.3) - 1; // -1..1
    if (Math.abs(jag(u) - 0.5) < wallHalfWidth + wallRag * rag
      && jag(x / wallGapTiles) + jag(y / (wallGapTiles * 1.21)) < 2 * wallGapAbove) return true;
  }
  // lone boulders: only in some areas (leaving others open), scattered there
  if (jag(x / 43 + 0.2) + jag(y / 37 + 0.7) < 2 * loneBoulderAreaAbove) return false;
  return jag(x / 2.9) + jag(y / 3.3) + jag((x + y) / 4.7) + jag((x - y) / 5.3) > 4 * loneBoulderAbove;
}

// Whether a critter can't enter tile (i, j): impassable terrain or an obstacle on it.
function isBlockedTile(gx, gy) {
  return isImpassable(getTerrainAt(gx, gy)) || obstacleAt(gx, gy) !== null;
}

// TERRAIN HEIGHT
// Heights are in whole LEVELS, set at the grid's vertices (tile corners); between them a
// tile's surface is the bilinear blend of its four corners. A tile's corners are all at
// its base level m or m + 1, so a tile is flat or one of 14 slope shapes. (One level is
// drawn as one block riser high; see animat.js.)
//   - Land rises with its elevation (landElevationAt, from RELIEF), scaled so that the
//     highest relief possible (reliefHighest) would be at maxElevation levels.
//   - All water (whatever getTerrainAt calls water: sea or lake) is flat at level 0, and
//     so is every vertex touching water: lakes and the sea share one water level, and
//     shores meet it. Where the sea cuts across high land, that makes a sea cliff.
//   - Where a tile's corners would differ by 2 or more levels the ground is too steep
//     for a slope: the tile becomes a CLIFF tile. It keeps its tilt with its corners
//     squeezed into [m, m + 1] (m = the floor of their average), so its edges no longer
//     meet its neighbours' and a cliff face stands between them.
// Moving, a critter can step up or down a ledge of up to maxStepLevels; anything higher
// blocks it, like a boulder does.
// maxElevation: the elevation, in levels, of the highest ground the terrain could
// possibly have. Tiles are whole levels, so no tile can be higher than
// floor(maxElevation) (14); a given map's highest is usually lower (maxLevel: 11 on the
// 900 x 900 map). Raise it for taller hills and deeper valleys, lower it for gentler
// land: every elevation scales with it.
const maxElevation = 90;
const levelsPerReliefUnit = maxElevation / (reliefHighest - lakeBelow); // 20
const maxStepLevels = 1.5; // a one-level ledge can be stepped; two levels or more can't

function isWaterTile(i, j) {
  return i >= 0 && j >= 0 && i < gridWidthN && j < gridHeightN && getTerrainAt(i, j) === "water";
}

// Corner levels of every tile, 4 per tile in the order NW, NE, SW, SE (NW = (i, j), the
// tile's top corner on screen). Computed once: the terrain never changes.
const tileCornerLevels = new Int16Array(gridWidthN * gridHeightN * 4);
let maxLevel = 0;
(function computeTerrainHeights() {
  const W = gridWidthN, H = gridHeightN;
  const vertex = new Int16Array((W + 1) * (H + 1)); // level of vertex (i, j) at i * (H + 1) + j
  for (let i = 0; i <= W; i++) for (let j = 0; j <= H; j++) {
    const touchesWater = isWaterTile(i, j) || isWaterTile(i - 1, j)
      || isWaterTile(i, j - 1) || isWaterTile(i - 1, j - 1);
    vertex[i * (H + 1) + j] = touchesWater ? 0
      : Math.max(0, Math.floor(landElevationAt(i, j) * levelsPerReliefUnit));
  }
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    let c = [vertex[i * (H + 1) + j], vertex[(i + 1) * (H + 1) + j],
             vertex[i * (H + 1) + j + 1], vertex[(i + 1) * (H + 1) + j + 1]];
    if (isWaterTile(i, j)) c = [0, 0, 0, 0];
    if (Math.max(...c) - Math.min(...c) >= 2) { // too steep: a cliff tile
      const m = Math.floor((c[0] + c[1] + c[2] + c[3]) / 4);
      c = c.map(l => Math.min(m + 1, Math.max(m, l)));
    }
    tileCornerLevels.set(c, (i * H + j) * 4);
    maxLevel = Math.max(maxLevel, ...c);
  }
})();

// The corner levels [NW, NE, SW, SE] of tile (i, j) (read only); all 0 off the map.
const offMapCorners = new Int16Array(4);
function tileCorners(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return offMapCorners;
  const k = (i * gridHeightN + j) * 4;
  return tileCornerLevels.subarray(k, k + 4);
}

// Height of the ground (in levels, fractional) at any grid point.
function heightAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  const [nw, ne, sw, se] = tileCorners(i, j);
  const u = gx - i, v = gy - j;
  return nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
}

function getOnTileXY(a) {
  if (!a || !(a.hasOwnProperty('gx'))) return alert("Invalid arg to getOnTileXY");

  return [a.gx, a.gy].map(v => Math.floor(v));
}

function canSee(a, b) {
  if (!a || !b || a.kind !== 'critter') return alert("Invalid arg to canSee");
  if (distBetweenL2(a, b) > 10000) return false;

  const [aX, aY] = getOnTileXY(a);
  const [bX, bY] = getOnTileXY(b);

  const [visX, visY] = traverseGrid(aX, aY, bX, bY);
  return visX === bX && visY === bY;
}

function areSetsEqual(setA, setB) {
  if (!setA || !setB) return (!setA && !setB);
  if (setA.size !== setB.size) return false;
  for (const element of setA) if (!setB.has(element)) return false;
  return true;
}

function dirDiff(dirA, dirB) {
  const diff = Math.abs(dirA - dirB);
  return Math.min(diff, 8 - diff);
}

function isVisionFacing(a, b) {
  return true; // TODO: FIX! isVisonFacing still causes deer to jitter in place
  const dirTo = getDir(...vecToObj(a, b));
  const diff = dirDiff(dirTo, a.currentDirection);
  return diff <= 1 || (a.species === "deer" && diff === 2);
}

function setPresentOthersIneffMethod() {
  // this scales O(n^2), rendering somewhat irrelevant
  // the efficiency benefits in other methods like collision detection.
  // TODO: replace with faster logic,
  // e.g. a similar tile-based nearness groupings with larger scale tiles

  allCritters.forEach(a => {
    // TODO: evaluate whether there is a clean way to do everything we
    // want in-place with two sets, or better yet one,
    // and not write a new set every time
    a.priorOthers = a.presentOthers || new Set();
    a.presentOthers = new Set();
  });

  for (var iA = 0; iA < allCritters.length; iA++) {
    const a = allCritters[iA];
    for (var iB = iA + 1; iB < allCritters.length; iB++) {
      const b = allCritters[iB];
      if (canSee(a, b)) {
        if (isVisionFacing(a, b)) a.presentOthers.add(b);
        if (isVisionFacing(b, a)) b.presentOthers.add(a);
      }
      if (canHear(a, b)) a.presentOthers.add(b);
      if (canHear(b, a)) b.presentOthers.add(a);
    }
  }
}

// function signalSnapshots(others) {
//   // produces snapshots of critters so that the gx, gy of these objects
//   // will not continue to update

//   // TODO: record actual signal data only, expect and handle nodata
//   if (!others || !others.size) return [];
//   return [...others].map(o => {
//     return {
//       kind: o.kind,
//       species: o.species,
//       gx: o.gx,
//       gy: o.gy,
//       speed: o.speed,
//       currentDirection: o.currentDirection
//     };
//   });
// }

function traverseGrid(aX, aY, bX, bY, fullTrace = false) {
  // For simplicity we are tracing from tile center to tile center,
  // not from exact point to point
  const [sI, sJ] = [aX, aY].map(v => Math.floor(v));
  const [eI, eJ] = [bX, bY].map(v => Math.floor(v));
  
  let [crossI, crossJ] = [eI - sI, eJ - sJ];
  if (crossI === 0 && crossJ === 0) return fullTrace? [[sI, sJ]] : [sI, sJ];

  const [xSign, ySign] = [crossI, crossJ].map(v => Math.sign(v));
  [crossI, crossJ] = [crossI, crossJ].map(v => Math.abs(v));

  // Imagine the 'time' of the tracing === 1,
  // then recipCx is the time it takes between each X boundary
  // and recipCy is the time between each Y boundary.
  const [recipCx, recipCy] = [crossI, crossJ].map(v => {
    return v === 0 ? Infinity : 1 / v
  });
  
  // start at center i.e. halfway between boundaries
  let [timeToX, timeToY] = [recipCx, recipCy].map(v => v / 2);

  const shifts = [];
  let [i, j] = [0, 0];

  function shiftToGrid(s) { return [sI + xSign * s[0], sJ + ySign * s[1]]; }

  while (i < crossI || j < crossJ) {
    if (i > crossI || j > crossJ)
      return alert("axis crossing error in traverseGrid");
    if (timeToX === timeToY) {
      i++;
      j++;
      timeToX = recipCx;
      timeToY = recipCy;
    } else if (timeToX < timeToY) {
      i++;
      timeToY -= timeToX;
      timeToX = recipCx;
    } else {
      j++;
      timeToX -= timeToY;
      timeToY = recipCy;
    }
    if (fullTrace) {
      shifts.push([i, j]);
    } else {
      if (blocksSight(...shiftToGrid([i, j]))) break;
    }
  }

  return fullTrace ? shifts.map(s => shiftToGrid(s)) : shiftToGrid([i, j]);
}

function updateAllCritters() {
  setPresentOthersIneffMethod();

  allCritters.forEach(a => {
    // Wind and stamina change every tick for every critter's current pose, including
    // idle (recovery) and blocked movers.
    applyExertion(a);

    // todo: combine this better with setPresentOthers() so that a wolf
    // which spots a deer or vice versa will respond on a predictable delay
    // e.g. a realistic reaction time of 120 ms (7 ticks)
    a.redecideCd--;
    if (a.redecideCd <= 0) updateCritterAction(a);
    if (a.returnToLand) steerToLand(a);

    if (a.speed === 0) {
      a.nextGX = a.gx;
      a.nextGY = a.gy;
      return;
    }

    const moveVec = moveVecByDir[a.currentDirection];
    const [velGX, velGY] = moveVec.map(v => v * a.speed);
    const nextGX = a.gx + velGX;
    const nextGY = a.gy + velGY;
    // keep the collision box (radius critterBoxRad) inside the grid
    if (nextGX >= critterBoxRad && nextGX < (gridWidthN - critterBoxRad)
      && nextGY >= critterBoxRad && nextGY < (gridHeightN - critterBoxRad)) {
      if (Math.abs(heightAt(nextGX, nextGY) - heightAt(a.gx, a.gy)) > maxStepLevels) {
        // a cliff in the way: stay put and decide what to do instead, as at a boulder
        a.nextGX = a.gx;
        a.nextGY = a.gy;
        updateCritterAction(a);
        return;
      }
      a.nextGX = nextGX;
      a.nextGY = nextGY;
    } else {
      setCritterIdle(a);
    }
  });

  moveAllTogether(allCritters, allCorpses);
}

function applyExertion(a) {
  const ex = exertionBySpecies[a.species];
  const dt = tempo; // game seconds per tick
  if (a.pose === "gallop") {
    a.wind = Math.max(0, a.wind - dt / ex.gallopFullWindS);
    a.stamina = Math.max(0, a.stamina - gallopStaminaCostFactor * dt / ex.trotFullStaminaS);
  } else if (a.pose === "trot") {
    a.stamina = Math.max(0, a.stamina - dt / ex.trotFullStaminaS);
  }
  const windHalfLifeS = windRefillHalfLifeSByPose[a.pose];
  if (windHalfLifeS) a.wind += (1 - a.wind) * (1 - Math.pow(0.5, dt / windHalfLifeS));
  const staminaRefillS = staminaFullRefillSByPose[a.pose];
  if (staminaRefillS) a.stamina = Math.min(1, a.stamina + dt / staminaRefillS);

  // out of a reserve: drop to the next gait down (trot falls through to walk if
  // stamina is too low to start it)
  if (a.pose === "gallop" && (a.wind <= 0 || a.stamina <= 0)) {
    setCritterMoving(a, a.currentDirection, "trot");
  } else if (a.pose === "trot" && a.stamina <= 0) {
    setCritterMoving(a, a.currentDirection, "walk");
  }
}

function moveAllTogether(movers, statics = []) {
  const allColliders = movers.concat(statics);
  const collidePairs = findCollidingPairs(allColliders);
  let didCollide = {};
  collidePairs.forEach(pair => pair.forEach(m => didCollide[m] = true));

  // RESOLVE COLLISIONS

  // lazy first pass: halt colliders pre-collisions

  const wasKilledBy = {};

  // console.log("collidePairs");
  // console.log(collidePairs);

  collidePairs.forEach(pair => {
    // CURRENT: wolf KOs deer on any collide
    // FUTURE: kill only when wolf is in Bite pose and front-on
    // console.log(pair[1])
    // console.log(allColliders[pair[1]]);
    if (pair[0] === -1) return;
    const [c0, c1] = [allColliders[pair[0]], allColliders[pair[1]]];
    // corpses and already-dying critters can't kill or be killed
    if (!isLiveCritter(c0) || !isLiveCritter(c1) || c0.species === c1.species) return;

    console.log("KILL COLLIDE");

    if (allColliders[pair[1]].species === "deer") {
      wasKilledBy[pair[1]] = pair[0];
    } else {
      wasKilledBy[pair[0]] = pair[1];
    }
  });

  allColliders.forEach((thing, idx) => {
    // Kills must be checked BEFORE the stationary early-return,
    // otherwise a standing (idle) deer could never be killed.
    if (idx in wasKilledBy) {
      startCritterDeath(thing, allColliders[wasKilledBy[idx]]);
      return;
    }

    // for a stationary thing, do nothing (??)
    if (thing.nextGX === thing.gx && thing.nextGY === thing.gy) return;

    if (didCollide[idx]) {
      // this thing's gx and gy do NOT get updated this tick
      // and it should decide on a new movement to try for next tick

      // TODO: allow a rear-ended collider to continue moving when space in front is open
      // this 'should' already be the behavior since creatures move all together, investigate
      updateCritterAction(thing);
    } else {
      // this is the ONLY PLACE ANYWHERE that thing gx and gy should change!
      thing.gx = thing.nextGX;
      thing.gy = thing.nextGY;
      // all-water check for this position, worked out by findCollidingPairs above
      thing.waterState = { gx: thing.gx, gy: thing.gy, allWater: thing.nextAllWater };
      if (thing.returnToLand) thing.returnToLand.blockedTicks = 0;
      updateTerrainPose(thing); // swim <-> land pose when crossing a shoreline
    }
  });
}

function isLiveCritter(c) {
  return c.kind === "critter" && c.pose !== "death" && c.pose !== "dead";
}

function deleteCritter(critter, toCorpse = false) {
  if (!critter) return; // return alert("falsy arg to deleteCritter");
  if (typeof critter !== "object") return alert("invalid arg type to deleteCritter");
  const idx = allCritters.indexOf(critter);
  if (idx === -1) return alert("arg object to deleteCritter not in list");
  if (idx === 0) return alert("cannot delete critter 0 in this version");

  if (toCorpse) {
    critter.kind = "corpse";
    setPose(critter, "dead");
    allCorpses.push(critter);
  }
  allCritters.splice(idx, 1);

  // NOTE initial critters remain referenced in their species initialization arrays only
}

function forbidOverlapsOnStart() {
  allCritters.forEach(m => {
    m.nextGX = m.gx;
    m.nextGY = m.gy;
  });
  let overlapPairs = findCollidingPairs(allCritters);
  for (let tries = 0; overlapPairs.length && tries < 10; tries++) {
    overlapPairs.forEach(pair =>  {
      const a = allCritters[pair[1]];
      randomlyPlaceCritter(a);
      a.nextGX = a.gx;
      a.nextGY = a.gy;
    });
    // recollect for next cycle
    overlapPairs = findCollidingPairs(allCritters);
  }
  if (overlapPairs.length) {
    // Resolve indices to objects BEFORE deleting: deleteCritter splices allCritters,
    // which would shift the indices of every later pair. Never delete critter 0 (pcWolf).
    const toDelete = new Set();
    overlapPairs.forEach(pair => {
      const idx = pair[1] !== 0 ? pair[1] : pair[0];
      if (idx > 0) toDelete.add(allCritters[idx]);
    });
    toDelete.forEach(c => deleteCritter(c));
    console.log("Initial density too high, reduced start population.");
  }
}

// GAME LOOP
// The simulation advances in fixed ticks of `tempo` seconds of game time. The browser
// loop (runFrame) runs as many ticks as real time has elapsed, so game speed is the same
// at any display refresh rate (30, 60, 120, 144 Hz...) instead of one tick per frame.
//
// Exactly one loop may be scheduled at a time: loopHandle is non-null while a frame is
// pending, and startLoop() refuses to schedule a second one.

// Longest real-time gap one frame will catch up on. Longer gaps (tab hidden, debugger
// stop, slow frame) are dropped rather than simulated in one burst.
const maxCatchUpS = 0.25;

let loopHandle = null;    // pending requestAnimationFrame / setTimeout id, or null
let lastFrameMs = null;   // timestamp of the previous frame; null = (re)starting
let tickDebtS = 0;        // real time elapsed but not yet simulated

// LISTENERS: how the outside world keeps up with the simulation without the simulation
// knowing who is listening. Each is a plain function with no arguments.
//   tick listeners  run at the start of every tick, before the world changes (e.g.
//                   controls.js turning held keys into this tick's input)
//   frame listeners run after each real-time frame's ticks, and after a single step
//                   (e.g. animat.js drawing the world as it now is)
const tickListeners = [];
const frameListeners = [];
function onTick(fn) { tickListeners.push(fn); }
function onFrame(fn) { frameListeners.push(fn); }
function notifyFrame() { frameListeners.forEach(fn => fn()); }

// Advance the simulation by exactly one tick. The only place g_tick and g_now change.
function tick() {
  if (consoleOnlyMode) {
    const tps = g_tick / ((Date.now() - startRealtime) / 1000)
    console.log("Begin tick=" + g_tick + " + tps=" + tps);
  }
  tickListeners.forEach(fn => fn());

  applyPlayerIntent();

  deqCurrentDelayed();

  updateAllCritters();

  g_tick++; // nowhere else may update g_tick
  g_now += tempo; //nowhere else may update g_now
}

// One browser frame: run the ticks owed for the real time since the last frame.
function runFrame(nowMs) {
  loopHandle = null;
  if (isPaused) return;

  if (lastFrameMs !== null) {
    tickDebtS += Math.min((nowMs - lastFrameMs) / 1000, maxCatchUpS);
  }
  lastFrameMs = nowMs;

  // small epsilon so float drift in the debt can't skip a whole tick
  while (tickDebtS >= tempo - 1e-9) {
    tick();
    tickDebtS -= tempo;
  }
  notifyFrame();

  scheduleFrame();
}

// Console-only mode runs as fast as possible rather than in real time.
function runConsoleBatch() {
  loopHandle = null;
  if (isPaused) return;
  tick();
  scheduleFrame();
  // TODO: recursion achieves a speed on same hardware of 1045 tk/s
  // vs only 165 tk/s with setTimeout. See about running ticks in
  // batches per setTimeout to improve runspeed.
}

function scheduleFrame() {
  if (isPaused || loopHandle !== null) return; // never more than one pending frame
  // setTimeout yields between ticks, avoiding unbounded recursion
  loopHandle = consoleOnlyMode
    ? setTimeout(runConsoleBatch, 0)
    : requestAnimationFrame(runFrame);
}

function startLoop() {
  // restarting: don't count the time spent stopped/paused as owed ticks
  lastFrameMs = null;
  tickDebtS = 0;
  scheduleFrame();
}

function stopLoop() {
  if (loopHandle === null) return;
  if (consoleOnlyMode) clearTimeout(loopHandle);
  else cancelAnimationFrame(loopHandle);
  loopHandle = null;
}

function setCritterIdle(a) {
  if (a.pose === "death" || a.pose === "dead") return;
  // A critter can't stand still in water: it treads water (swim pose, no speed).
  const stillPose = isInWater(a) ? "swim" : "idle";
  if (a.pose === stillPose && a.speed === 0) return;
  a.speed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  setPose(a, stillPose);
  a.landPose = "idle";
}

// SWIMMING
// Water is passable. A critter is in water only when ALL the tiles it occupies are water
// (any land under it means it's on land); then it is always in the "swim" pose, at its
// species' single swim speed (or 0 when treading water). Swimming changes neither wind
// nor stamina (see EXERTION).
// landPose remembers the land pose that was asked for (walk/trot/gallop/idle), so a
// critter climbing out of the water resumes it.

// a.waterState caches the answer for the position it was computed at. In normal play it
// is set by moveAllTogether from findCollidingPairs, which already checks every tile a
// critter will occupy, so this costs nothing extra per tick. The lookup below only runs
// when a critter was placed directly (spawning, or a test or debug teleport).
function isInWater(a) {
  const s = a.waterState;
  if (s && s.gx === a.gx && s.gy === a.gy) return s.allWater;
  const allWater = getOccupiedTiles(a.gx, a.gy).every(tile =>
    getTerrainAt(...tile.split("_").map(Number)) === "water");
  a.waterState = { gx: a.gx, gy: a.gy, allWater };
  return allWater;
}

// Called whenever a critter's position changes: switch between swimming and land poses
// when it crosses a shoreline.
function updateTerrainPose(a) {
  if (!isLiveCritter(a)) return;
  const inWater = isInWater(a);
  if (inWater && a.pose !== "swim") {
    a.landPose = a.pose;
    setPose(a, "swim");
    a.speed = a.speed > 0 ? travelSpeedBySpeciesAndPose[a.species].swim : 0;
  } else if (!inWater && a.pose === "swim") {
    endReturnToLand(a); // arrived, if it was heading for land
    const resume = a.landPose || "walk";
    if (a.speed > 0 && resume !== "idle") {
      setPose(a, null); // no current pose, so setCritterMoving applies the change and its checks
      setCritterMoving(a, a.currentDirection, resume);
    } else {
      setCritterIdle(a);
    }
  }
}

// RETURNING TO LAND
// At each decision, a swimming critter may decide to head back to land, with a chance
// that grows with its distance from the nearest land: distance / returnToLandSureDist,
// so certain at returnToLandSureDist tiles or more. Once decided it swims straight for
// the closest land tile and makes no other decisions until it is ashore. (If it stays
// blocked for returnToLandGiveUpTicks, e.g. by a boulder in the way, it gives up and
// decides normally again, so it can't be stuck forever.)
const returnToLandSureDist = 4;
const returnToLandGiveUpTicks = 60;

// Land = a tile a critter can stand on and climb onto from the water: not water, not
// impassable, and low enough somewhere to step up onto from the water (level 0).
function isLandTile(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return false;
  const t = getTerrainAt(i, j);
  return t !== "water" && !isBlockedTile(i, j) && Math.min(...tileCorners(i, j)) <= maxStepLevels;
}

// Nearest land tile to a critter: { tile: [i, j], distL2 } where distL2 is the SQUARED
// distance from the critter to the closest point of that tile (squared, so no square
// root is needed); null if there is no land on the map.
function findNearestLand(a) {
  const ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const distToTileL2 = (i, j) => sqr(Math.max(i - a.gx, 0, a.gx - (i + 1)))
    + sqr(Math.max(j - a.gy, 0, a.gy - (j + 1)));
  let best = null;
  const maxR = Math.max(gridWidthN, gridHeightN);
  // search square rings outward; a ring at radius r can't beat a find closer than r - 1
  for (let r = 0; r <= maxR; r++) {
    if (best && r >= 1 && best.distL2 <= sqr(r - 1)) break;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // ring only
      if (!isLandTile(i, j)) continue;
      const d = distToTileL2(i, j);
      if (!best || d < best.distL2) best = { tile: [i, j], distL2: d };
    }
  }
  return best;
}

// Called at a swimming critter's decision time. Returns true if it decided to go ashore.
function maybeDecideReturnToLand(a) {
  const land = findNearestLand(a);
  // chance min(1, distance / returnToLandSureDist), compared squared:
  // random * sureDist >= distance  <=>  (random * sureDist)^2 >= distance^2
  const roll = Math.random() * returnToLandSureDist;
  if (!land || sqr(roll) >= land.distL2) return false;
  a.returnToLand = { gx: land.tile[0] + 0.5, gy: land.tile[1] + 0.5, blockedTicks: 0 };
  a.redecideCd = Infinity; // no other decisions until ashore (see endReturnToLand)
  steerToLand(a);
  return true;
}

// Each tick while returning: head straight for the target land tile's center.
function steerToLand(a) {
  const t = a.returnToLand;
  if (!t) return;
  if (a === pcWolf && playerHasControl()) return endReturnToLand(a); // the player took over
  setCritterMoving(a, getDir(t.gx - a.gx, t.gy - a.gy), "walk"); // swims while in water
}

function endReturnToLand(a) {
  if (!a.returnToLand) return;
  delete a.returnToLand;
  a.redecideCd = 0; // free to decide again on the next tick
}

const wolfAudibleToDeerL2ByTerrainAndSpeed = {
  grass:   { walk: sqr(3),  trot: sqr(11), gallop: sqr(30) },
  dirt:    { walk: sqr(4),  trot: sqr(15), gallop: sqr(40) },
  leaves:  { walk: sqr(6),  trot: sqr(22), gallop: sqr(60) },
  stone:   { walk: sqr(8),  trot: sqr(30), gallop: sqr(80) },
  gravel:  { walk: sqr(9),  trot: sqr(37), gallop: sqr(95) },
  water:   { walk: sqr(9),  trot: sqr(37), gallop: sqr(95), swim: sqr(12) }, // placeholder
  bush:    { walk: sqr(3),  trot: sqr(11), gallop: sqr(30) }, // placeholder
};

function vecTo(a, b) { return [b[0] - a[0], b[1] - a[1]]; }

function vecToObj(a, b) { return vecTo([a.gx, a.gy], [b.gx, b.gy]); }

function pairL2(pair) { return pair[0] * pair[0] + pair[1] * pair[1]; }

// distBetweenL2 returns the SQUARED distance (L2) between points
// which assumes we only need to sort or compare against another L2
function distBetweenL2(a, b) {
  if (!a || !b || !a.hasOwnProperty('gx') || !b.hasOwnProperty('gx')) return alert("Invalid arg to distBetween");
  return pairL2(vecToObj(a, b));
}

function canHear(a, b) {
  // a is the listener, and b is the potential sound origin
  if (!_can(a, "hear")) return false;

  // movement is currently the only source of sound
  // for now we use one table based on moving wolf and listening deer
  // revise in future to account for actual origin and listener species
  if (b.hasOwnProperty('speed') && b.speed === 0) return false;

  const terrain = getTerrainAt(...getOnTileXY(b));
  if (!wolfAudibleToDeerL2ByTerrainAndSpeed.hasOwnProperty(terrain))
    return alert("Unknown terrain type for canHear origin");

  const rangeByPoseL2 = wolfAudibleToDeerL2ByTerrainAndSpeed[terrain];

  if (!rangeByPoseL2.hasOwnProperty(b.pose))
    return alert("Uknown pose for canHear origin");

  return distBetweenL2(a, b) <= rangeByPoseL2[b.pose];
}

const kphToTpTk = 0.277777 * tempo; // kilometers-per-hour to tiles-per-tick
const travelSpeedBySpeciesAndPose = {
  "wolf": {
    "walk": 5 * kphToTpTk,    // all day (estimate; no direct figure found)
    "trot": 9 * kphToTpTk,    // the travel gait, kept up for hours (8-9 km/h, Mech & Boitani)
    "gallop": 55 * kphToTpTk, // chasing prey: 50-64 km/h for 1-8 km, a few minutes
    "swim": 5 * kphToTpTk, // grey wolf, ~3 mph; reported figures are sparse
    "idle": 0,
    "death": 0
  },
  "deer": { 
    "walk": 5 * kphToTpTk,    // all day
    "trot": 15 * kphToTpTk,   // sustained escape for hours (estimate from elk "dogtrot")
    "gallop": 65 * kphToTpTk, // escape burst of about 1 km (top reported 72 km/h)
    "swim": 8 * kphToTpTk, // red deer, ~5 mph; deer outswim wolves
    "idle": 0,
    "death": 0
  }
}

// EXERTION
// Each critter has two reserves, each from 0 (empty) to 1 (full):
//   wind    - the burst reserve, which limits galloping. It drains while galloping and
//             refills whenever the critter isn't galloping: quickly at first, then more
//             slowly (exponentially), faster the more restful the gait.
//   stamina - the endurance reserve, which limits trotting. It drains slowly while
//             trotting (and faster while galloping) and refills slowly while idle or
//             walking. In a realtime session it hardly moves; it matters at longer
//             timescales (consoleOnlyMode, or a larger tempo).
// Swimming changes neither reserve (no drowning yet). A gait can only be STARTED with
// some reserve in hand (windStartFrac / staminaStartFrac), so critters don't flicker in
// and out of it near empty; once in it, they keep going until the reserve runs out.
const exertionBySpecies = {
  wolf: {
    gallopFullWindS: 240,     // gallop from full wind: 4 minutes (chases of several km)
    trotFullStaminaS: 30000,  // trot from full stamina: ~8.3 hours (the travel gait)
  },
  deer: {
    gallopFullWindS: 60,      // gallop from full wind: 1 minute (a burst of about 1 km)
    trotFullStaminaS: 10800,  // trot from full stamina: 3 hours (elk "dogtrot")
  },
};
// Wind refill: half of the missing wind comes back every this many seconds, by pose.
// Poses not listed (gallop, swim, death, dead) don't refill wind.
const windRefillHalfLifeSByPose = { idle: 45, walk: 60, trot: 180 };
// Stamina refill: seconds to go from empty to full, by pose (others don't refill it).
const staminaFullRefillSByPose = { idle: 30000, walk: 120000 }; // ~8.3 h idle, ~33 h walking
const gallopStaminaCostFactor = 2; // galloping uses stamina twice as fast as trotting
const windStartFrac = 0.25;        // wind needed to START a gallop
const staminaStartFrac = 0.1;      // stamina needed to START a trot or gallop

// TODO: consider rolling canUseGait into _can()
function canUseGait(a, gait, isAlready = false) {
  if (!_can(a, 'run')) return false; // age check: old enough to run at all
  if (gait === "gallop") {
    return isAlready ? (a.wind > 0 && a.stamina > 0)
                     : (a.wind >= windStartFrac && a.stamina >= staminaStartFrac);
  }
  if (gait === "trot") return isAlready ? a.stamina > 0 : a.stamina >= staminaStartFrac;
  return true;
}

function setCritterMoving(a, dir, newPose = "walk") {
  if (!isLiveCritter(a)) return;
  if (a.isHaltedUntil > g_tick) return;

  if (newPose === a.pose && a.currentDirection === dir) return;

  if (isInWater(a)) {
    // in water every movement is swimming; remember what was asked for on land
    a.landPose = newPose;
    newPose = "swim";
  } else {
    if (newPose === "gallop" && !canUseGait(a, "gallop", a.pose === "gallop"))
      newPose = "trot";
    if (newPose === "trot" && !canUseGait(a, "trot", a.pose === "trot"))
      newPose = "walk";
    a.landPose = newPose;
  }
  // (a swimmer treading water has speed 0, so it still needs to start moving)
  if (newPose === a.pose && a.currentDirection === dir && a.speed > 0) return;

  setPose(a, newPose);
  a.currentDirection = dir;
  a.speed = travelSpeedBySpeciesAndPose[a.species][a.pose];

  // prevent critters from bumping directly into walls
  // TODO: improve blocking for on-edge or to-corner motion
  const moveVec = moveVecByDir[dir];
  const [nextX, nextY] = [a.gx + moveVec[0], a.gy + moveVec[1]];
  // (not while heading for land: that makes no new decisions until ashore)
  if (isBlockedTile(nextX, nextY) && !a.returnToLand) {
    a.redecideCd = Math.min(a.redecideCd, 5);
  }
}

function enactDecision(a, decision) {
  if (!decision) return alert("falsy decision to enactDecision");
  const [act, options] = decision;
  switch (act) {
    case "flee":
      // while fleeing a critter should make frequent redecisions
      // so that it always flees from the closest predator
      a.redecideCd = Math.min(a.redecideCd, 10);

      if (options.from.length === 1) {
        const dir = getDir(...vecToObj(options.from[0], a));
        setCritterMoving(a, dir);
        return;
      }

      let [fleeX, fleeY] = [0, 0];
      options.from.forEach(b => {
        const fleeVec = vecToObj(b, a);
        const wt = 1 / Math.max(distBetweenL2(a, b), 1);
        fleeX += fleeVec[0] * wt;
        fleeY += fleeVec[1] * wt;
      });
      setCritterMoving(a, getDir(fleeX, fleeY));
      break;
    default:
      return alert("unknown decision to enactDecision");
  }
}

// TODO: array is currently used for simplicity, but
// it is slow to insert-in-place sorted. Consider using
// Linked List instead which is both fast insert-in-place and 
// fast deque.
// The arr version is stored DESCENDING sorted for fast deque.
const delayedRxnArr = []

function enqDelayed(rxn, timeS, opts = {}) {
  const end = g_now + timeS; // same clock that deqCurrentDelayed compares against
  var iNew = 0;
  // list is sorted decreasing
  while (iNew < delayedRxnArr.length && delayedRxnArr[iNew].end > end) iNew++;
  delayedRxnArr.splice(iNew, 0, {rxn: rxn, opts: opts, end: end});
  return;
}

function runRxn(rxn) {
  const opts = rxn.opts;
  const a = opts.a;
  switch (rxn.rxn) {
    case 'decontrol':
      if (a.kind !== "critter") {
        console.log("Err: Non-critter to decontrol rxn");
        return;
      }
      if (a.pose !== "death" && a.pose !== "dead") {
        console.log("Err: Live-posed critter to decontrol rxn")
        return;
      }
      deleteCritter(a, true);
    break;
    default:
      console.log("Err: Unknown reaction to runRxn");
      return;
  }
}

function deqCurrentDelayed() {
  // half-tick tolerance so float drift in g_now can't push a reaction one tick late
  while (delayedRxnArr.length && delayedRxnArr.at(-1).end <= g_now + tempo / 2)
    runRxn(delayedRxnArr.pop());
}

function startCritterDeath(a, killer) {
  if (!a || a.species !== "deer") return alert("Invalid arg to startCritterDeath");

  if (a.pose === "death") return;
  a.speed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  setPose(a, "death");
  enqDelayed("decontrol", deathDurationSBySpecies[a.species], { a: a, killer: killer });
}

function updateCritterAction(a) {
  // a dying critter must not pick a new action, or it would come back to life
  if (!isLiveCritter(a)) return;
  if (a === pcWolf && playerHasControl()) return;
  if (a.isHaltedUntil) {
    if (a.isHaltedUntil <= g_tick) delete a.isHaltedUntil;
    return;
  }
  if (a.returnToLand) {
    // Heading for land makes no new decisions; the only way here is a collision.
    if (++a.returnToLand.blockedTicks < returnToLandGiveUpTicks) return;
    endReturnToLand(a); // blocked too long: give up and decide normally below
  }
  a.redecideCd = 120 + Math.floor(Math.random() * 500 + Math.random() * 500);
  // note this is only the default time, decisions may override

  if (isInWater(a) && maybeDecideReturnToLand(a)) return;

  const decision = null; // makeDecision(a); // Not Yet Implemented
  if (decision) { 
    enactDecision(a, decision); 
    return;
  }

  // no decision, update action at random
  if (Math.random() < 0.1) { setCritterIdle(a); return; }

  const dir = Math.floor(Math.random() * 4) * 2;
  // any gait; setCritterMoving downgrades it if wind/stamina (or water) don't allow it
  setCritterMoving(a, dir, sample(["walk", "trot", "gallop"]));
}

const critterBoxRad = 0.4;

function getOccupiedTiles(gx, gy, boxRad = critterBoxRad) {
  const left = Math.floor(gx - boxRad);
  const right = Math.floor(gx + boxRad);
  const top = Math.floor(gy - boxRad);
  const bottom = Math.floor(gy + boxRad);

  const tiles = [];
  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      tiles.push(`${x}_${y}`); // string key
    }
  }
  return tiles;
}


function doNextBoundingBoxesOverlap(a, b) {
  // Must use the same box as getOccupiedTiles (the broad phase). Previously this used
  // 1.0 (i.e. radius 0.5) while the broad phase used radius 0.4, so critters 0.8-1.0
  // apart in different tiles were never tested and could walk into each other.
  // TODO: individual-specific box sizes
  const span = 2 * critterBoxRad;
  return Math.abs(a.nextGX - b.nextGX) < span && Math.abs(a.nextGY - b.nextGY) < span;
}

// Terrain no critter can enter. (Water is passable: critters swim, see
// updateTerrainPose. Boulders are obstacles, not terrain: see isBlockedTile.)
function isImpassable(terrain) {
  return terrain === "bush";
}

// Whether tile (i, j) blocks the line of sight: a boulder does.
function blocksSight(i, j) {
  return obstacleAt(i, j) !== null;
}

// returns a list of pairs of integers e.g. [[1,2], [3,6]]
function findCollidingPairs(creatures) {
  // Note that this is a grid-based method which is O(n) for the list
  // creatures, when creatures are close in size to tiles.

  // If necessary, further runtime improvement is likely attainable.
  // For example it is likely that the sizable majority of creatures don't
  // change occupancy at all on any given tick, so we could set occupancy
  // only when it changes and not have to collect it for everything every tick.

  const tileMap = new Map();  // key: tile "x_y", value: critter indexes
  const potentialPairs = new Set();  // store "i|j" where i < j
  // terrain of each tile looked at this call, and whether it's blocked, so each is
  // computed once
  const terrainByTile = new Map();
  const blockedByTile = new Map();

  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i];
    // TODO: individual-specific bounding boxes, ideally rectangular rather than square

    // tiles is array of strings in x_y format
    const tiles = getOccupiedTiles(creature.nextGX, creature.nextGY);
    // Whether every tile under the creature's next position is water. Recorded here,
    // where occupancy and terrain are already worked out, for the swim check
    // (isInWater) once the creature actually moves there.
    let allWater = true;

    for (const tile of tiles) {
      let terrain = terrainByTile.get(tile);
      if (terrain === undefined) {
        const [tileX, tileY] = tile.split("_").map(Number);
        terrain = getTerrainAt(tileX, tileY);
        terrainByTile.set(tile, terrain);
        blockedByTile.set(tile, isBlockedTile(tileX, tileY));
      }
      if (terrain !== "water") allWater = false;

      if (!tileMap.has(tile)) {
        if (blockedByTile.get(tile)) {
          potentialPairs.add(`-1|${i}`);
        } else {
          tileMap.set(tile, [i]);
        }
      } else {
        for (const j of tileMap.get(tile)) {
          const pairKey = i < j ? `${i}|${j}` : `${j}|${i}`;
          potentialPairs.add(pairKey);
        }
        tileMap.get(tile).push(i);
      }
    }
    creature.nextAllWater = allWater;
  }

  // Now check actual bounding box overlap
  const collisions = [];
  for (const pairKey of potentialPairs) {
    const [i, j] = pairKey.split('|').map(Number);
    // i == -1 for a blocked tile (impassable terrain or an obstacle)
    if (i === -1 || doNextBoundingBoxesOverlap(creatures[i], creatures[j])) {
      collisions.push([i, j]);
    }
  }

  return collisions;
}


const DIR_E  = 0;
const DIR_SE = 1;
const DIR_S  = 2;
const DIR_SW = 3;
const DIR_W  = 4;
const DIR_NW = 5;
const DIR_N  = 6;
const DIR_NE = 7;

const DIR_NAME = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]

// produces a random distribution in [0, 1) with a parabolic curve
function randomPara() {
  const x = Math.random();
  return 4 * x * (1 - x);
}

function rpMod(x) {
  return x * (0.8 + 0.4 * randomPara());
}

function getDir(x, y, defaultRV = 0) {
  if (x === 0) return y === 0 ? defaultRV : (y > 0 ? DIR_S : DIR_N );
  if (y === 0) return (x > 0 ? DIR_E : DIR_W)

  const absX = Math.abs(x);
  const absY = Math.abs(y);
  // tan(1/8 circle) ~= 0.414, tan(3/8 circle) ~= 2.414
  if (absX >= absY * 2.414) return x > 0 ? DIR_E : DIR_W;
  if (absY >= absX * 2.414) return y > 0 ? DIR_S : DIR_N;
  return x > 0 ? (y > 0 ? DIR_SE : DIR_NE) : (y > 0 ? DIR_SW : DIR_NW);
}

function pause() {
  isPaused = true;
  stopLoop(); // takes effect immediately; no stray tick from an already-pending frame
}

function unpause() {
  if (!isPaused) return;
  isPaused = false;
  startLoop();
}

function togglePause() {
  isPaused ? unpause() : pause();
}

// While paused, advance exactly one tick.
function stepOnce() {
  if (!isPaused) return;
  tick();
  notifyFrame();
}

let startRealtime = Date.now();
let isInitialized = false;

// Creates the world's critters. Call once, before attaching a view or starting.
function init() {
  if (isInitialized) return alert("sim.init called twice");
  isInitialized = true;
  wolves.forEach(wolf => { allCritters.push(initCritter(wolf, "wolf")); });
  deer.forEach(aDeer => { allCritters.push(initCritter(aDeer, "deer")); });
  forbidOverlapsOnStart(); // must run after critters exist
}

// Starts the game loop: in real time (one requestAnimationFrame loop), or with
// consoleOnly, as fast as possible with no browser needed.
function start({ consoleOnly = false } = {}) {
  if (!isInitialized) return alert("sim.start called before sim.init");
  consoleOnlyMode = consoleOnly;
  startRealtime = Date.now();
  startLoop();
}

// THE INTERFACE
// What viewers and controllers use. They read critters' fields directly (gx, gy, pose,
// poseTick, currentDirection, species, wind, stamina, uid) but change the world only
// through the functions here.
return {
  // lifecycle and time
  init, start, pause, unpause, togglePause, stepOnce,
  get isPaused() { return isPaused; },
  get tickCount() { return g_tick; }, // ticks run so far
  get now() { return g_now; },        // game seconds so far
  get tempo() { return tempo; },      // game seconds per tick
  onTick, onFrame,

  // the world
  gridWidthN, gridHeightN, getTerrainAt, obstacleAt,
  tileCorners, heightAt, get maxLevel() { return maxLevel; },
  allCritters, allCorpses, pcWolf, deathDurationSBySpecies,

  // the player
  setPlayerIntent, playerHasControl,
  getDir, DIR_E, DIR_SE, DIR_S, DIR_SW, DIR_W, DIR_NW, DIR_N, DIR_NE,

  // Everything else, for tests and debugging from the console only: views and
  // controllers must not use these.
  internals: {
    tick, wolves, deer, allLandTiles,
    setCritterIdle, setCritterMoving, isInWater, isImpassable, isBlockedTile, getOccupiedTiles,
    forbidOverlapsOnStart, critterBoxRad, travelSpeedBySpeciesAndPose,
    windRefillHalfLifeSByPose, staminaFullRefillSByPose, maxStepLevels,
    get loopHandle() { return loopHandle; },
  },
};

})();

// In Node (tests/headless.test.js), sim.js is a module; in the browser this adds nothing.
if (typeof module !== "undefined" && module.exports) module.exports = sim;