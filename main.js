const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");

let consoleOnlyMode = true;
let animat = null;
let tempo = 1/60;
// TODO: change speed convert so it responds when tempo is changed at runtime
let g_tick = 0; // updates ONE PLACE ONLY in gameLoop
let g_now = 0; // also updates ONLY ONE PLACE in gameLoop
// g_now is elapsed seconds; IFF tempo stays constant, g_now = g_tick * tempo
let g_next_uid = 0;
let isPaused = false;
// #zoom is mostly working except for two issues:
// (1) temporary artifacting when zooming out and then panning
// (1) pan limits based on zoom = 1, cannot pan to edges at higher zooms
let zoom = 1;
const zoomMin = 1;
const zoomMax = 8;

// parameters
const tileSize = 32;
const tileRiserPY = 8;

const gridWidthN = 3533088; // c * 1 tick / root2
const gridHeightN = 3533088;
const deerFrameW = 32;
const deerFrameH = 41;

// derived constants, set once on startup
const gCX = gridWidthN / 2;
const gCY = gridHeightN / 2;
const gRadL2 = gCX * gCX + gCY * gCY;
const gRad = Math.sqrt(gRadL2);

// Note that a tile which is SQUARE in grid space appears as a SQUASHED DIAMOND
// in isometric, with the surface height pixels being 1/2 of the surface width pixels
const halfTile = tileSize / 2;
const qtrTile = tileSize / 4;
const worldRadPX = halfTile + (gridWidthN + gridHeightN - 2) * qtrTile;
const worldDiamPY = worldRadPX;

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

const wolfIconSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <!-- Face outline: top, left, right, bottom point -->
  <path d="M6 6 H18 V18 L12 22 L6 18 Z" />
  <!-- Ears: verticals -->
  <line x1="7" y1="6" x2="7" y2="3" />
  <line x1="17" y1="6" x2="17" y2="3" />
  <!-- Ears: angled tops -->
  <line x1="7" y1="3" x2="10" y2="6" />
  <line x1="17" y1="3" x2="14" y2="6" />
</svg>`;

const cameraIconSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <!-- Main camera body: rounded rectangle -->
  <rect x="3" y="6" width="10" height="12" rx="2" ry="2" />
  <!-- Right-facing lens hood / extension -->
  <path d="M13 10 L17 7 V17 L13 14 Z" />
</svg>`

function sqr(x) { return x * x; }

function boundVal(val, min, max) { return Math.max(min, Math.min(val, max)); }

function isoProject(gx, gy) {
  const px = (gx - gy) * halfTile;
  const py = (gx + gy) * qtrTile;
  return [px, py];
}

function rectiProject(px, py) {
  const gx = (px / tileSize + py / halfTile);
  const gy = (py / halfTile - px / tileSize);
  return [gx, gy];
}

// TODO: consider what data should be allowed to vary by pose and what data 
// is fixed for the species
// TODO: consider if frame holds should be in time or in ticks,
// for now assumone animat only runs when tempo == 1/60 and adjust
// for main logic only
const frameDataBySpeciesAndPose = {
  wolf: { 
    walk: {nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 },
    idle: {nFrames: 4, colZero: 8, frameW: 64, frameH: 64,
      holdTks: 12, topToShadow: 39 },
    run: {nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 }, // placeholder
    sprint: {nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 }, // placeholder
  },
  deer: { 
    walk: {nFrames: 11, colZero: 0, frameW: 32, frameH: 41,
      holdTks: 5, topToShadow: 33},
    idle: {nFrames: 24, colZero: 11, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33},
    run: {nFrames: 10, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33},
    sprint: {nFrames: 10, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33} // placeholder
  }
}

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
    eat:    { min: 10 * dayS, avg: 20 * dayS,  max: 30 * dayS },
    run:    { min: 1 * dayS, avg: 2 * dayS, max: 3 * dayS },
    mate:   { min: 16 * monthS, avg: 24 * monthS,  max: 36 * monthS },
    liveTo: { min: 8 * yearS, avg: 12 * yearS, max: 25 * yearS }
  }
}
['wolf', 'deer'].forEach(species => {
  ['see', 'hear', 'walk', 'eat', 'run', 'mate'].forEach(cap => {
    canAtAgeBySpecies[species][cap] = canAtAgeBySpecies[species][cap].avg;
  });
  canAtAgeBySpecies[species].liveTo = canAtAgeBySpecies[species].liveTo.max;
});

function can(a, capability) {
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


// TODO: revise this name and calling method for use of tempo
function updateCritterFrame(a, rezero = false) {
  // At present World needs to control this method for proper
  // onceThenPose behavior to shift between poses
  a.animTimer = 0;
  const frameData = frameDataBySpeciesAndPose[a.species][a.pose];
  a.frame = rezero ? 0 : ( (a.frame + 1) % frameData.nFrames );
  if (!rezero && a.frame === 0 && frameData.onceThenPose) {
    a.pose = frameData.onceThenPose;
    return updateCritterFrame(a, true);
  }
  animat?.updateCritterFrame(a, frameData);
}

// Wolf setup
const nWolves = 10;
const wolves = Array.from({length: nWolves}, () => ({}));
const pcWolf = wolves[0];

const nDeer = 10;
const deer = Array.from({length: nDeer}, () => ({}));

let worldShiftPX = 0;
let worldShiftPY = 0;

function randomlyPlaceCritter(a) {
  // used for initial assignment of [gx, gy] -- should update ONLY in moveAllTogether()
  a.gx = boundVal(initX + Math.floor(Math.random() * 50), 0.5, gridWidthN - 0.5);
  a.gy = boundVal(initY + Math.floor(Math.random() * 50), 0.5, gridHeightN - 0.5);
  a.animTimer = 0;
  a.redecideCd = 0; // Cd = Cooldown (ticks)
  a.currentDirection = Math.floor(Math.random() * 4) * 2;
  a.frame = 0;
  setCritterIdle(a);

  updateCritterFrame(a, true);
  animat?.placeCritterSprite(a);
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
  a.heldInfo = {};
  a.holdInfoUntil = {};
  a.fatigue = 0;

  animat?.addCritter(a);
  randomlyPlaceCritter(a);

  return a;
}

// DOUBLECHECK if these are needed in main
let viewportWidth = document.getElementById('field-wrapper').clientWidth;
let viewportHeight = document.getElementById('field-wrapper').clientHeight;

let initX = 0;
let initY = 0;

// rendering errors occur abruptly at x == 1677740
// unknown why at this time
// also observed at: [369092, 1404710] and other values which are 
// close to 1500k in Y and 300k+ in X
const safeX = Math.min(gridWidthN, 1500000);
const safeY = Math.min(gridHeightN, 1500000);

for (let t = 0; t < 1000 && getTerrainAt(initX, initY) === "water"; t++) {
  initX = Math.floor(Math.random() * safeX);
  initY = Math.floor(Math.random() * safeY);
}
if (getTerrainAt(initX, initY) === "water") alert("No land found in map");

const allCritters = [];
const allCorpses = [];

forbidOverlapsOnStart();
const cameraSpeed = 50;
const keysPressed = {};

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

const arrowKeyNames = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const arrowsToggle = document.getElementById('arrow-mode-toggle');
const arrowsIcon = document.getElementById('arrow-mode-icon');
arrowsIcon.innerHTML = cameraIconSVG;

let mouseMovesWolf = true;
let arrowsMoveWolf = false;
let mouseInInputField = false;

function handMovesWolf() {
  return !consoleOnlyMode && (arrowsMoveWolf || (mouseMovesWolf && mouseInInputField));
}

arrowsToggle.addEventListener('click', () => {
  arrowsMoveWolf = !arrowsMoveWolf;
  arrowsIcon.innerHTML = arrowsMoveWolf ? wolfIconSVG : cameraIconSVG;
  if (arrowsMoveWolf) animat?.setCameraToPCWolf();
});

zoomInBtn.addEventListener("click", () => {
  if (!animat) return;
  if (zoom < zoomMax) {
    zoom *= 2;
    animat?.updateCamera();
    animat?.updateZoomButtons();
  }
});

zoomOutBtn.addEventListener("click", () => {
  if (zoom > zoomMin) {
    zoom /= 2;
    animat?.clearAllRenderedTiles();
    animat?.updateCamera();
    animat?.updateZoomButtons();
  }
});

function jag(x) {
  return 2 * Math.abs(x - Math.floor(x + 0.5));
}

function getTerrainAt(gx, gy) {
  // ensure the same result for any point in the tile
  const [x, y] = [gx, gy].map(v => Math.floor(v));

  // For desmos.com/3d:
  // 2*abs((x*x+y*y)-floor(x*x+y*y+0.5)) - 0.5
  // for x,y in range [-1.25, 1.25]
  const [rx, ry] = [x - gCX, y - gCY].map(v => v * 1.25 / gRad);
  const baseAlt = jag(rx * rx + ry * ry) - 0.5 + (
    jag(x / 103) + jag(y / 109) + jag ((x + y) / 127) + jag((x - y) / 199)
  ) * 0.04;

  if (baseAlt < 0.5) return "water"; // sea
  if (baseAlt > 0.875) return "rock"; // mountain

  const sum = x + y;
  const dif = x - y;
  const fastNoise = jag(x / 19) + jag(y / 23) + jag(sum / 29) + jag(dif / 31); // => [0, 4]
  const slowNoise = (jag(x / 37) + jag(y / 41) + jag(sum / 43) + jag(dif / 47)) * 0.3
    + (jag(x / 53) + jag(y / 59) + jag(sum / 61) + jag(dif / 67)) * 0.2; // => [0, 2]

  const unitVariant = (fastNoise + slowNoise) / 6;

  if (unitVariant < 0.25) return "water";
  if (unitVariant > 0.75) return "rock";

  // const hash = Math.sin((x * 374761393 + y * 668265263) % 1000000) * 43758.5453;
  // const pseudoRandom = hash - Math.floor(hash); // [0, 1)
  // if (pseudoRandom < 0.75 * Math.pow(1 - (unitVariant * 2 - 0.5), 3)) return "bush";

  // const typePseudorandInt = (x * 73856093) ^ (y * 19349663);
  // const types = ["dirt", "grass", "bush"];
  // return types[Math.abs(typePseudorandInt) % types.length];

  if (unitVariant < 0.5) return "grass";
  if (unitVariant < 0.75) return "dirt";
}

function getTileClassAt(x, y) {
  return getTerrainAt(x, y)
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
      if (isOpaque(getTerrainAt(...shiftToGrid([i, j])))) break;
    }
  }

  return fullTrace ? shifts.map(s => shiftToGrid(s)) : shiftToGrid([i, j]);
}

// currently not called
// function updateSignals(a) {
//   if (areSetsEqual(a.priorOthers, a.presentOthers)) return;

//   const newSignals = a.presentOthers.difference(a.priorOthers);
//   const lostSignals = a.priorOthers.difference(a.presentOthers);

//   if (lostSignals.size) {
//     console.log(`${a.species} lost signal`);
//     holdInfo(a, "lostSignals", {signals: lostSignals }, 360);
//   }

//   if (newSignals.size) {
//     console.log(`${a.species} got new signal`);
//     if (a.redecideCd < 7) a.redecideCd = 7;
//   }
// }

function updateAllCritters() {
  setPresentOthersIneffMethod();

  allCritters.forEach(a => {
    Object.keys(a.heldInfo).forEach(key => {
      if (g_tick > a.holdInfoUntil[key]) {
        console.log(`Deleted ${key} from ${a.species}'s heldInfo`);
        delete a.heldInfo[key];
        delete a.holdInfoUntil[key];
      }
    })
  });

  allCritters.forEach(a => {
    // todo: combine this better with setPresentOthers() so that a wolf
    // which spots a deer or vice versa will respond on a predictable delay
    // e.g. a realistic reaction time of 120 ms (7 ticks)
    a.redecideCd--;
    if (a.redecideCd <= 0) updateCritterAction(a);

    a.animTimer++;
    let holdTks = frameDataBySpeciesAndPose[a.species][a.pose].holdTks;
    if (a.animTimer >= holdTks) updateCritterFrame(a);

    if (a.speed === 0) {
      a.nextGX = a.gx;
      a.nextGY = a.gy;
      return;
    }

    const moveVec = moveVecByDir[a.currentDirection];
    const [velGX, velGY] = moveVec.map(v => v * a.speed);
    const nextGX = a.gx + velGX;
    const nextGY = a.gy + velGY;
    if (nextGX >= 0.6 && nextGX < (gridWidthN - 0.6) && nextGY >= 0.6 && nextGY < (gridHeightN - 0.6)) {
      a.nextGX = nextGX;
      a.nextGY = nextGY;
    } else {
      setCritterIdle(a);
    }
  });

  moveAllTogether(allCritters, allCorpses);
}

function applyFatigue(a) {
  const fatigueBySpecies = fatigueBySpeciesAndPose[a.species];
  if (!fatigueBySpecies.hasOwnProperty(a.pose)) return;
  const fatigueData = fatigueBySpecies[a.pose];
  a.fatigue += fatigueData.dps / 60;
  if (a.fatigue >= fatigueData.forceEnd) {
    if (fatigueData.downTo === "idle") {
      setCritterIdle(a);
    } else {
      setCritterMoving(a, a.currentDirection, fatigueData.downTo);
    }
  }
  if (a === pcWolf && g_tick % 6 === 0) animat?.updateFatigueMeter();
}

function moveAllTogether(movers, statics = []) {
  const allColliders = movers.concat(statics);
  const collidePairs = findCollidingPairs(allColliders);
  let didCollide = {};

  collidePairs.forEach(pair => pair.forEach(m => didCollide[m] = true));

  // RESOLVE COLLISIONS

  // lazy first pass: halt colliders pre-collisions

  const wasKilledBy = {};

  collidePairs.forEach(pair => {
    // CURRENT: wolf KOs deer on any collide
    // FUTURE: kill only when wolf is in Bite pose and front-on
    if (pair[0] === -1 || pair[0].species === pair[1].species) return;
    if (pair[1].kind === "corpse" && pair[0].kind === "critter"
      && pair[0].species === "wolf") {
        startEat(pair[0], pair[1]);
        return;
    }
    const deerIdx = pair[1].species === "deer" ? 1 : 0;
    const wolfIdx = deerIdx ? 0 : 1;
    wasKilledBy[pair[deerIdx]] = pair[wolfIdx];
  });

  movers.forEach((mover, idx) => {
    // for a stationary mover, do nothing
    if (mover.nextGX === mover.gx && mover.nextGY === mover.gy) return;

    if (didCollide[idx]) {
      if (wasKilledBy[idx]) {
        startCritterDeath(movers[idx], wasKilledBy[idx]);
      } else {
        // this mover's gx and gy do NOT get updated this tick
        // and it should decide on a new movement to try for next tick

        // TODO: allow a rear-ended collider to continue moving when space in front is open
        // this 'should' already be the behavior since creatures move all together, investigate
        updateCritterAction(mover);
      }
    } else {
      // this is the ONLY PLACE ANYWHERE that mover gx and gy should change!
      mover.gx = mover.nextGX;
      mover.gy = mover.nextGY;
      if (mover === pcWolf) { // TODO: allow for detaching camera from wolf
        animat?.setCameraToPCWolf();
      }
      animat?.placeCritterSprite(mover);
      applyFatigue(mover);
    }
  });
}

function deleteCritter(critter) {
  if (!critter) return; // return alert("falsy arg to deleteCritter");
  if (typeof critter !== "object") return alert("invalid arg type to deleteCritter");
  const idx = allCritters.indexOf(critter);
  if (idx === -1) return alert("arg object to deleteCritter not in list");
  if (idx === 0) return alert("cannot delete critter 0 in this version");

  critter.element.remove();
  allCritters.splice(idx, 1);

  // Note: Creatures created on-init will not be actually be garbage collected
  // because they are still referenced by the (unused) wolves and deer arrays,
  // but they will no longer be processed on-tick or rendered
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
    overlapPairs.forEach(pair => deleteCritter(allCritters[pair[1]]));
    console.log("Initial density too high, reduced start population.");
  }
}

function gameLoop(isStepThrough = false) {
  if (isPaused && !isStepThrough) return;

  if (consoleOnlyMode) {
    const tps = g_tick / ((Date.now() - startRealtime) / 1000)
    console.log("Begin gameLoop tick=" + g_tick + " + tps=" + tps);
  } else {
    const hasInput = arrowKeyNames.some(ak => keysPressed[ak]);
    if (hasInput) {
      if (arrowsMoveWolf) {
        // for simplicity, the arrow keys currently move along grid axis and don't combine
        if (keysPressed["ArrowUp"]) { setCritterMoving(pcWolf, DIR_N); }
        if (keysPressed["ArrowDown"]) { setCritterMoving(pcWolf, DIR_S); }
        if (keysPressed["ArrowLeft"]) { setCritterMoving(pcWolf, DIR_W); }
        if (keysPressed["ArrowRight"]) { setCritterMoving(pcWolf, DIR_E); }
      } else {
        if (keysPressed["ArrowUp"]) { worldShiftPY -= cameraSpeed; }
        if (keysPressed["ArrowDown"]) { worldShiftPY += cameraSpeed; }
        if (keysPressed["ArrowLeft"]) { worldShiftPX -= cameraSpeed; }
        if (keysPressed["ArrowRight"]) { worldShiftPX += cameraSpeed; }
        animat?.updateCamera();
      }
    }
  }

  deqCurrentDelayed();

  updateAllCritters();

  g_tick++; // nowhere else may update g_tick
  g_now += tempo; //nowhere else may update g_now
  if (!isPaused) {
    if (consoleOnlyMode) {
      // using setTimeout will trigger gameLoop in the next execution frame,
      // avoiding any issue of stack overflow from unbounded recursion
      return setTimeout(gameLoop, 0);
      // TODO: recursion achieves a speed on same hardware of 1045 tk/s
      // vs only 165 tk/s with setTimeout. See about implementing limited
      // iterative or recursive gameLoops() in batches to improve
      // runspeed.
    }
    requestAnimationFrame(gameLoop);
  }
}

let mouseVecX = 0;
let mouseVecY = 0;

function updateMovementByMouse() {
  if (consoleOnlyMode || !mouseMovesWolf) return alert("Called updateMovevementByMouse out of context");
  const mag = Math.hypot(mouseVecX, mouseVecY);

  if (mag >= 0.9) {
    mouseInInputField = false;
    return;
  }
  mouseInInputField = true;
  if (mag < 0.1) {
    setCritterIdle(pcWolf);
    return;
  }

  // rotate -1 converts Pixel dir to Grid dir
  let dir = getDir(mouseVecX, mouseVecY) - 1;
  if (dir < 0) dir = 7;

  const newPose = mag >= 0.7 ? "sprint" : (mag >= 0.4 ? "run" : "walk"); 
  setCritterMoving(pcWolf, dir, newPose);
}

function addCursorTracker() {
  const fieldWrapper = document.getElementById("field-wrapper");
  const cursorCoords = document.getElementById("cursor-coords");

  fieldWrapper.addEventListener("mousemove", (e) => {
    const rect = fieldWrapper.getBoundingClientRect();

    if (mouseMovesWolf) {
      const ctrPX = rect.left + rect.width / 2
      const ctrPY = rect.top + rect.height / 2;
      const [vx, vy] = [e.clientX - ctrPX, e.clientY - ctrPY]
      const minCircMag = Math.min(rect.width / 2, rect.height / 2);
      [mouseVecX, mouseVecY] = [vx / minCircMag, vy / minCircMag];
      updateMovementByMouse();
    }

    const mousePX = e.clientX - rect.left + worldShiftPX;
    const mousePY = e.clientY - rect.top + worldShiftPY;

    const [mouseGX, mouseGY] = rectiProject(mousePX, mousePY);

    const [dispGX, dispGY] = [mouseGX.toFixed(3), mouseGY.toFixed(3)];
    cursorCoords.textContent = `x: ${dispGX}, y: ${dispGY}`;
  });

  fieldWrapper.addEventListener("mouseleave", () => {
    cursorCoords.textContent = `x: –, y: –`;
  });
}

function setCritterIdle(a) {
  if (a.pose === "idle") return;
  a.speed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  a.pose = "idle";
  updateCritterFrame(a, true);
}

const wolfAudibleToDeerL2ByTerrainAndSpeed = {
  grass:   { walk: sqr(3),  run: sqr(11), sprint: sqr(30) },
  dirt:    { walk: sqr(4),  run: sqr(15), sprint: sqr(40) },
  leaves:  { walk: sqr(6),  run: sqr(22), sprint: sqr(60) },
  rock:    { walk: sqr(8),  run: sqr(30), sprint: sqr(80) },
  gravel:  { walk: sqr(9),  run: sqr(37), sprint: sqr(95) },
  water:   { walk: sqr(9),  run: sqr(37), sprint: sqr(95) }, // placeholder
  bush:    { walk: sqr(3),  run: sqr(11), sprint: sqr(30) }, // placeholder
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
    "walk": 6 * kphToTpTk, // all day
    "run": 10 * kphToTpTk, // 8 hours
    "sprint": 55 * kphToTpTk, // a few seconds only
    "idle": 0,
    "death": 0
  },
  "deer": { 
    "walk": 6 * kphToTpTk, // all day 
    "run": 45 * kphToTpTk, // 2 minutes
    "sprint": 65 * kphToTpTk, // a few seconds only; 0.3 tiles/tick
    "idle": 0, 
    "death": 0
  }
}

// FUTURE: consider tracking hiPowFatigue and loPowFatigue distinctly
const fatigueBySpeciesAndPose = {
  "wolf": {
    "idle": { forceEnd: Infinity, dps: -1, downTo: "idle" },
    "walk": { forceEnd: 60000, dps: -0.25, downTo: "idle" },
    "run": { forceEnd: 30000, dps: 1, downTo: "walk" }, // ~8 hours
    "sprint": { forceEnd: 15000, dps: 1500, downTo: "run" } // 10 seconds
  },
  "deer": {
    "idle": { forceEnd: Infinity, dps: -1, downTo: "idle" },
    "walk": { forceEnd: 60000, dps: -0.25, downTo: "idle" },
    "run": { forceEnd: 30000, dps: 250, downTo: "walk" }, // 2 minutes
    "sprint": { forceEnd: 15000, dps: 1500, downTo: "run" } // 10 seconds
  }
}


// TODO: consider rolling canSprint and canRun into can()
function canSprint(a, isAlready = false) {
  if (!can(a, 'run')) return false; // age check
  const limit = fatigueBySpeciesAndPose[a.species].sprint.forceEnd
    * (isAlready ? 1 : 0.7);
  return a.fatigue <= limit;
}

function canRun(a, isAlready = false) {
  if (!can(a, 'run')) return false; // age check
  const limit = fatigueBySpeciesAndPose[a.species].run.forceEnd
    * (isAlready ? 1 : 0.7);
  return a.fatigue <= limit;
}

function setCritterMoving(a, dir, newPose = "walk") {
  if (newPose === a.pose && a.currentDirection === dir) return;

  if (newPose === "sprint" && !canSprint(a, a.pose === "sprint"))
    newPose = "run";
  if (newPose === "run" && !canRun(a, a.pose === "run"))
    newPose = "walk";
  if (newPose === a.pose && a.currentDirection === dir) return;

  a.pose = newPose;
  a.currentDirection = dir;
  a.speed = travelSpeedBySpeciesAndPose[a.species][a.pose];
  updateCritterFrame(a);

  // prevent critters from bumping directly into walls
  // TODO: improve blocking for on-edge or to-corner motion
  const moveVec = moveVecByDir[dir];
  const [nextX, nextY] = [a.gx + moveVec[0], a.gy + moveVec[1]];
  if (isImpassable(getTerrainAt(nextX, nextY))) {
    a.redecideCd = Math.min(a.redecideCd, 5);
  }
}

function getOthers(a) {
  const present = a.presentOthers || new Set();
  return present.union(a.heldInfo?.lostSignals?.signals || new Set());
}

// makeDecision should not write any world or body state
function makeDecision(a) {
  // currently only decision making is deer fleeing
  if (a.species !== "deer") return null;

  const predators = [...getOthers(a)].filter(o => o.species !== 'deer');
  if (!predators.length) return null;
  return ["flee", { from: predators } ];
}

// function getNearestIdx(obj, choices) {
//   if (!choices || !choices.length) return -1;
//   let idx = -1;
//   let minDistL2 = Infinity;
//   choices.forEach((c, i) => {
//     const distL2 = distBetweenL2(obj, c);
//     if (distL2 < minDistL2) {
//       idx = i;
//       minDistL2 = distL2;
//     }
//   });
//   return idx;
// }

function holdInfo(a, key, options, ticks) {
  if (key === "lostSignals") {
    // TODO: provide some per-signal expiry mechanism so the restack effect
    // cannot refresh old data forever
    const oldSignals = a.heldInfo?.lostSignals?.signals || new Set();
    a.heldInfo["lostSignals"] = options.signals.union(oldSignals);
  } else {
    // default combine = override
    a.heldInfo[key] = options;
  }

  a.holdInfoUntil[key] = g_tick + ticks;
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
  const end = g_tick * tempo + timeS;
  var iNew = 0;
  // list is sorted decreasing
  while (iNew < delayedRxnArr.length && delayedRxnArr[iNew].end > end) iNew++;
  delayedRxnArr.splice(iNew, 0, {rxn: rxn, opts: opts, end: end});
  return;
}

function runRxn(rxn) {
  const opts = rxn.opts;
  switch (rxn.rxn) {
    case 'decontrol':
      if (a.kind !== 'critter') {
        console.log('Err: Non-critter to decontrol rxn');
        return;
      }
      deleteCritter(a);
      a.kind = 'corpse';
      allCorpses.push(a);
    break;
    default:
      console.log("Err: Unknown reaction to runRxn");
      return;
  }
}

function deqCurrentDelayed() {
  while (delayedRxnArr.length && delayedRxnArr.at(-1).end <= g_now)
    runRxn(delayedRxnArr.pop());
}

function startCritterDeath(a, killer) {
  if (!a || a.species !== "deer") return alert("Invalid arg to startCritterDeath");

  if (a.pose === "death" || a.pose === "dead") return;
  a.speed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  a.pose = "death";
  const deathAnimTime = 20 * tempo; // TODO: put in sprite data
  enqDelayed("decontrol", deathAnimTime, { a: a, killer: killer });
  updateCritterFrame(a, true);
}

function onStruck(a) {
  if (a.pose !== "halted") {
    a.speed = 0;
    a.nextGX = a.gx;
    a.nextGY = a.gy;
    a.pose = "halted";
    updateCritterFrame(a, true);
  }
  a.isHaltedUntil = g_tick + 120;
}

function updateCritterAction(a) {
  if (a === wolves[0] && handMovesWolf()) return;
  if (a.isHaltedUntil) {
    if (a.isHaltedUntil <= g_tick) delete a.isHaltedUntil;
    return;
  }
  a.redecideCd = 120 + Math.floor(Math.random() * 500 + Math.random() * 500);
  // note this is only the default time, decisions may override

  const decision = makeDecision(a);
  if (decision) { 
    enactDecision(a, decision); 
    return;
  }

  // no decision, update action at random
  if (Math.random() < 0.1) { setCritterIdle(a); return; }

  const dir = Math.floor(Math.random() * 4) * 2;
  setCritterMoving(a, dir);
}

function getOccupiedTiles(gx, gy, boxRad = 0.4) {
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
  // TODO: fix this hardcoded box size
  return Math.abs(a.nextGX - b.nextGX) < 1.0 && Math.abs(a.nextGY - b.nextGY) < 1.0;
}

function isImpassable(terrain) {
  return terrain === "rock" || terrain === "bush" || terrain === "water";
}

function isOpaque(terrain) {
  return terrain === "rock";
}

// returns a list of pairs of integers e.g. [[1,2], [3,6]]
function findCollidingPairs(creatures) {

  const tileMap = new Map();  // key: tile "x_y", value: critter indexes
  const potentialPairs = new Set();  // store "i|j" where i < j

  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i];
    // TODO: individual-specific bounding boxes, ideally rectangular rather than square
    // tiles is array of strings in x_y format
    const tiles = getOccupiedTiles(creature.nextGX, creature.nextGY);

    for (const tile of tiles) {
      if (!tileMap.has(tile)) {
        const [tileX, tileY] = tile.split("_").map(Number);
        if (isImpassable(getTerrainAt(tileX, tileY))) {
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
  }

  // Now check actual bounding box overlap
  const collisions = [];
  for (const pairKey of potentialPairs) {
    const [i, j] = pairKey.split('|').map(Number);
    // i == -1 for impassable terrain
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
}

function unpause() {
  if (!isPaused) return;
  isPaused = false;
  gameLoop();
}

document.addEventListener("keydown", (e) => { 
  if (e.key === "p") {
    isPaused ? unpause() : pause();
    return;
  } else if (e.key === "s") {
    if (isPaused) gameLoop(true);
    return;
  }
  keysPressed[e.key] = true; 
});
document.addEventListener("keyup", (e) => { keysPressed[e.key] = false; });

window.addEventListener('resize', () => {
  viewportWidth = document.getElementById('field-wrapper').clientWidth;
  viewportHeight = document.getElementById('field-wrapper').clientHeight;
  animat?.updateCamera();
});

let startRealtime = Date.now();

window.onload = function () {
  wolves.forEach(wolf => { allCritters.push(initCritter(wolf, "wolf")); });
  deer.forEach(aDeer => { allCritters.push(initCritter(aDeer, "deer")); });

  animat?.setCameraToPCWolf();
  if (!consoleOnlyMode) addCursorTracker();
  gameLoop();
};