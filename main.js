const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");

let consoleOnlyMode = false;
let animat = null;
let tempo = 1/60;
// TODO: change speed convert so it responds when tempo is changed at runtime
let g_tick = 0; // updates ONE PLACE ONLY in tick()
let g_now = 0; // also updates ONLY ONE PLACE in tick()
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

const gridWidthN = 128; //3533088 = c * 1/60 sec / root2
const gridHeightN = 128;
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

function sample(list) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// TODO: consider if frame holds should be in time or in ticks,
// for now assumone animat only runs when tempo == 1/60 and adjust
// for main logic only
// `sheet` names the sprite sheet's CSS class in index.html (.wolf, .wolf-swim, ...),
// which sets the sheet image and frame size; frameW/frameH must match that class.
const frameDataBySpeciesAndPose = {
  wolf: {
    walk: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 },
    idle: {sheet: "wolf", nFrames: 4, colZero: 8, frameW: 64, frameH: 64,
      holdTks: 12, topToShadow: 39 },
    run: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 }, // placeholder
    sprint: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 }, // placeholder
    // swim sheet is made from the run frames, same 7 facing rows.
    // topToShadow is raised so swimmers never appear to sit on land in front of them.
    // Sprites draw over all tiles, and land is drawn 8px higher than water, so a land
    // tile screen-below the swimmer has its top corner 8px below the ground point, and
    // that shoreline rises 1px per 2px to either side (8 - |dx|/2, never above 0).
    // 57 is the smallest value that keeps every swim pixel above that worst case
    // (land directly in front and to both front sides). The down-facing diagonal rows'
    // tilted water rings reach lowest and set it; one value keeps every facing's
    // waterline at the same height, so a turning swimmer doesn't hop.
    swim: {sheet: "wolf-swim", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 8, topToShadow: 57 },
    // death: {nFrames: 2, colZero: 0, frameW: 64, frameH: 64,
    //   holdTks: 3, repeatLimit: 3, exitToPose: 'dead' }
  },
  deer: { 
    walk: {sheet: "deer", nFrames: 11, colZero: 0, frameW: 32, frameH: 41,
      holdTks: 5, topToShadow: 33},
    idle: {sheet: "deer", nFrames: 24, colZero: 11, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33},
    run: {sheet: "deer", nFrames: 10, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33},
    sprint: {sheet: "deer", nFrames: 10, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33}, // placeholder
    // swim frames are 40x48 (wider/taller than land frames to fit the ripple ring).
    // topToShadow raised for the same reason as the wolf's swim (see there).
    swim: {sheet: "deer-swim", nFrames: 10, colZero: 0, frameW: 40, frameH: 48,
      holdTks: 10, topToShadow: 45 },
    // death: col 45 is a pale hit-flash, col 46 the same pose in full color
    death: {sheet: "deer", nFrames: 2, colZero: 45, frameW: 32, frameH: 41,
      holdTks: 15, topToShadow: 33},
    dead: {sheet: "deer", nFrames: 1, colZero: 45, frameW: 32, frameH: 41,
      holdTks: Infinity, topToShadow: 33},
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


// TODO: revise this name and calling method for use of tempo ?
function updateCritterFrame(a, rezero = false) {
  // TODO: move frame into only Animat, World should not require concept of frame
  // any exitToPose behavior should be handled with enqDelayed
  a.animTimer = 0;
  const frameData = frameDataBySpeciesAndPose[a.species][a.pose];
  a.frame = rezero ? 0 : ( (a.frame + 1) % frameData.nFrames );
  if (!rezero && a.frame === 0 && frameData.onceThenPose) {
    a.pose = frameData.exitToPose
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

const allLandTiles = [];

function randomlyPlaceCritter(a) {
  if (!allLandTiles.length) {
    if (gridHeightN * gridWidthN > 1000000) {
      alert("ERORR: randomlyPlaceCritter not implemented yet for maps > 1M tiles");
    }
    // collect all land tiles once
    for (var i = 0; i < gridWidthN; i++) {
      for (var j = 0; j < gridHeightN; j++) {
        let ter = getTerrainAt(i, j);
        if (ter !== "water" && ter !== "rock") allLandTiles.push([i, j]);
      }
    }
  }

  const [randLandX, randLandY] = sample(allLandTiles);

  // used for initial assignment of [gx, gy] -- should update ONLY in moveAllTogether()
  // position tile centered (on half-integer vals) for simple initial overlap check
  a.gx = randLandX + 0.5;
  a.gy = randLandY + 0.5;
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
  a.fatigue = 0;

  animat?.addCritter(a);
  randomlyPlaceCritter(a);

  return a;
}

// DOUBLECHECK if these are needed in main
let viewportWidth = document.getElementById('field-wrapper').clientWidth;
let viewportHeight = document.getElementById('field-wrapper').clientHeight;

// rendering errors occur abruptly at x == 1677740
// unknown why at this time
// also observed at: [369092, 1404710] and other values which are 
// close to 1500k in Y and 300k+ in X

const allCritters = [];
const allCorpses = [];

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

let arrowsMoveWolf = false;
let mouseInMovePad = false;
// Camera tracks pcWolf unless the player has panned away with the arrow keys.
// Re-attached by entering the movement pad or switching arrows to wolf mode.
let cameraFollowsWolf = true;

function handMovesWolf() {
  return !consoleOnlyMode && (arrowsMoveWolf || mouseInMovePad);
}

arrowsToggle.addEventListener('click', () => {
  arrowsMoveWolf = !arrowsMoveWolf;
  arrowsIcon.innerHTML = arrowsMoveWolf ? wolfIconSVG : cameraIconSVG;
  if (arrowsMoveWolf) {
    cameraFollowsWolf = true;
    animat?.setCameraToPCWolf();
  }
});

// MOVEMENT PAD
// Fixed on-screen joystick (see #move-pad in index.html). The pointer's offset from the
// pad center gives the direction; which concentric ring it is in gives the pose/speed.
// Ring radii are read from the SVG (viewBox radius 100) so drawing and logic can't drift.
const movePadEl = document.getElementById("move-pad");
const movePadRings = [...movePadEl.querySelectorAll(".ring")]
  .map(c => ({ pose: c.dataset.pose, frac: Number(c.getAttribute("r")) / 100 }))
  .sort((a, b) => a.frac - b.frac); // inner to outer

function onMovePadPointer(e) {
  if (consoleOnlyMode) return;
  const rect = movePadEl.getBoundingClientRect();
  const radPX = rect.width / 2;
  // normalized vector from pad center; |v| = 1 at the outer ring
  const vx = (e.clientX - (rect.left + radPX)) / radPX;
  const vy = (e.clientY - (rect.top + rect.height / 2)) / radPX;
  const ring = movePadRings.find(r => Math.hypot(vx, vy) <= r.frac);

  // the pad element is square; its corners are outside the circles
  if (!ring) return releaseMovePad();

  if (!mouseInMovePad) {
    mouseInMovePad = true;
    cameraFollowsWolf = true;
    animat?.setCameraToPCWolf();
  }
  animat?.updateMovePad(vx, vy, ring.pose);

  if (ring.pose === "idle") return setCritterIdle(pcWolf);

  setCritterMoving(pcWolf, screenDirToGridDir(getDir(vx, vy)), ring.pose);
}

function releaseMovePad() {
  if (!mouseInMovePad) return;
  mouseInMovePad = false;
  animat?.updateMovePad(0, 0, null);
  setCritterIdle(pcWolf);
  // if the AI resumes control, let it wait a normal interval instead of instantly
  // overriding the stop (redecideCd keeps counting down while hand-controlled)
  pcWolf.redecideCd = Math.max(pcWolf.redecideCd, 120);
}

movePadEl.addEventListener("pointerdown", onMovePadPointer);
movePadEl.addEventListener("pointermove", onMovePadPointer);
movePadEl.addEventListener("pointerleave", releaseMovePad);
movePadEl.addEventListener("pointercancel", releaseMovePad);

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

  if (baseAlt < 0.2) return "water"; // sea
  if (baseAlt > 0.875) return "rock"; // mountain

  const sum = x + y;
  const dif = x - y;
  const fastNoise = jag(x / 19) + jag(y / 23) + jag(sum / 29) + jag(dif / 31); // => [0, 4]
  const slowNoise = (jag(x / 37) + jag(y / 41) + jag(sum / 43) + jag(dif / 47)) * 0.3
    + (jag(x / 53) + jag(y / 59) + jag(sum / 61) + jag(dif / 67)) * 0.2; // => [0, 2]

  const unitVariant = (fastNoise + slowNoise) / 6;

  if (unitVariant < 0.44) return "water";
  if (unitVariant > 0.7) return "rock";

  // const hash = Math.sin((x * 374761393 + y * 668265263) % 1000000) * 43758.5453;
  // const pseudoRandom = hash - Math.floor(hash); // [0, 1)
  // if (pseudoRandom < 0.75 * Math.pow(1 - (unitVariant * 2 - 0.5), 3)) return "bush";

  // const typePseudorandInt = (x * 73856093) ^ (y * 19349663);
  // const types = ["dirt", "grass", "bush"];
  // return types[Math.abs(typePseudorandInt) % types.length];

  if (unitVariant < 0.6) return "grass";
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

function updateAllCritters() {
  setPresentOthersIneffMethod();

  allCritters.forEach(a => {
    // Fatigue applies every tick for every critter's current pose, including idle
    // (recovery) and blocked movers. It used to be applied only after a successful
    // move, so idle recovery never happened.
    applyFatigue(a);

    // todo: combine this better with setPresentOthers() so that a wolf
    // which spots a deer or vice versa will respond on a predictable delay
    // e.g. a realistic reaction time of 120 ms (7 ticks)
    a.redecideCd--;
    if (a.redecideCd <= 0) updateCritterAction(a);
    if (a.returnToLand) steerToLand(a);

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
    // keep the collision box (radius critterBoxRad) inside the grid
    if (nextGX >= critterBoxRad && nextGX < (gridWidthN - critterBoxRad)
      && nextGY >= critterBoxRad && nextGY < (gridHeightN - critterBoxRad)) {
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
  // never bank "negative fatigue" while resting
  a.fatigue = Math.max(0, a.fatigue + fatigueData.dps * tempo);
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
      if (thing === pcWolf && cameraFollowsWolf) {
        animat?.setCameraToPCWolf();
      }
      animat?.placeCritterSprite(thing);
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

  const el = critter.element;
  if (toCorpse) {
    critter.kind = "corpse";
    critter.pose = "dead";
    allCorpses.push(critter);
    updateCritterFrame(critter, true);
  } else {
    el?.remove();
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

// Advance the simulation by exactly one tick. The only place g_tick and g_now change.
function tick() {
  if (consoleOnlyMode) {
    const tps = g_tick / ((Date.now() - startRealtime) / 1000)
    console.log("Begin tick=" + g_tick + " + tps=" + tps);
  } else {
    const hasInput = arrowKeyNames.some(ak => keysPressed[ak]);
    if (arrowsMoveWolf) {
      // the movement pad has priority: arrows are ignored entirely while it is in use
      if (!mouseInMovePad) {
        // Arrow keys move the wolf in SCREEN directions (Up = straight up on screen).
        // Two keys combine into a screen diagonal; opposite keys cancel out.
        const screenX = (keysPressed["ArrowRight"] ? 1 : 0) - (keysPressed["ArrowLeft"] ? 1 : 0);
        const screenY = (keysPressed["ArrowDown"] ? 1 : 0) - (keysPressed["ArrowUp"] ? 1 : 0);
        if (screenX !== 0 || screenY !== 0) {
          setCritterMoving(pcWolf, screenDirToGridDir(getDir(screenX, screenY)));
        } else {
          setCritterIdle(pcWolf); // stop when the keys are released (or all cancel out)
        }
      }
    } else if (hasInput) {
      // camera mode: arrows always pan, even while the pad is in use
      cameraFollowsWolf = false;
      if (keysPressed["ArrowUp"]) { worldShiftPY -= cameraSpeed; }
      if (keysPressed["ArrowDown"]) { worldShiftPY += cameraSpeed; }
      if (keysPressed["ArrowLeft"]) { worldShiftPX -= cameraSpeed; }
      if (keysPressed["ArrowRight"]) { worldShiftPX += cameraSpeed; }
      animat?.updateCamera();
    }
  }

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

function addCursorTracker() {
  const fieldWrapper = document.getElementById("field-wrapper");
  const cursorCoords = document.getElementById("cursor-coords");

  fieldWrapper.addEventListener("mousemove", (e) => {
    const rect = fieldWrapper.getBoundingClientRect();

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
  if (a.pose === "death" || a.pose === "dead") return;
  // A critter can't stand still in water: it treads water (swim pose, no speed).
  const stillPose = isInWater(a) ? "swim" : "idle";
  if (a.pose === stillPose && a.speed === 0) return;
  a.speed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  a.pose = stillPose;
  a.landPose = "idle";
  updateCritterFrame(a, true);
}

// SWIMMING
// Water is passable. A critter is in water only when ALL the tiles it occupies are water
// (any land under it means it's on land); then it is always in the "swim" pose, at its
// species' single swim speed (or 0 when treading water). Swimming is fatigue-neutral:
// "swim" has no fatigueBySpeciesAndPose entry, so applyFatigue skips it.
// landPose remembers the land pose that was asked for (walk/run/sprint/idle), so a
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
    a.pose = "swim";
    a.speed = a.speed > 0 ? travelSpeedBySpeciesAndPose[a.species].swim : 0;
    updateCritterFrame(a, true);
  } else if (!inWater && a.pose === "swim") {
    endReturnToLand(a); // arrived, if it was heading for land
    const resume = a.landPose || "walk";
    if (a.speed > 0 && resume !== "idle") {
      a.pose = null; // no current pose, so setCritterMoving applies the change and its checks
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
// blocked for returnToLandGiveUpTicks, e.g. by rock in the way, it gives up and
// decides normally again, so it can't be stuck forever.)
const returnToLandSureDist = 4;
const returnToLandGiveUpTicks = 60;

// Land = a tile a critter can stand on: not water, not impassable.
function isLandTile(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return false;
  const t = getTerrainAt(i, j);
  return t !== "water" && !isImpassable(t);
}

// Nearest land tile to a critter: { tile: [i, j], dist } where dist is the distance from
// the critter to the closest point of that tile; null if there is no land on the map.
function findNearestLand(a) {
  const ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const distToTile = (i, j) => Math.hypot(
    Math.max(i - a.gx, 0, a.gx - (i + 1)), Math.max(j - a.gy, 0, a.gy - (j + 1)));
  let best = null;
  const maxR = Math.max(gridWidthN, gridHeightN);
  // search square rings outward; a ring at radius r can't beat a find closer than r - 1
  for (let r = 0; r <= maxR; r++) {
    if (best && best.dist <= r - 1) break;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // ring only
      if (!isLandTile(i, j)) continue;
      const d = distToTile(i, j);
      if (!best || d < best.dist) best = { tile: [i, j], dist: d };
    }
  }
  return best;
}

// Called at a swimming critter's decision time. Returns true if it decided to go ashore.
function maybeDecideReturnToLand(a) {
  const land = findNearestLand(a);
  if (!land || Math.random() >= Math.min(1, land.dist / returnToLandSureDist)) return false;
  a.returnToLand = { gx: land.tile[0] + 0.5, gy: land.tile[1] + 0.5, blockedTicks: 0 };
  a.redecideCd = Infinity; // no other decisions until ashore (see endReturnToLand)
  steerToLand(a);
  return true;
}

// Each tick while returning: head straight for the target land tile's center.
function steerToLand(a) {
  const t = a.returnToLand;
  if (!t) return;
  if (a === pcWolf && handMovesWolf()) return endReturnToLand(a); // the player took over
  setCritterMoving(a, getDir(t.gx - a.gx, t.gy - a.gy), "walk"); // swims while in water
}

function endReturnToLand(a) {
  if (!a.returnToLand) return;
  delete a.returnToLand;
  a.redecideCd = 0; // free to decide again on the next tick
}

const wolfAudibleToDeerL2ByTerrainAndSpeed = {
  grass:   { walk: sqr(3),  run: sqr(11), sprint: sqr(30) },
  dirt:    { walk: sqr(4),  run: sqr(15), sprint: sqr(40) },
  leaves:  { walk: sqr(6),  run: sqr(22), sprint: sqr(60) },
  rock:    { walk: sqr(8),  run: sqr(30), sprint: sqr(80) },
  gravel:  { walk: sqr(9),  run: sqr(37), sprint: sqr(95) },
  water:   { walk: sqr(9),  run: sqr(37), sprint: sqr(95), swim: sqr(12) }, // placeholder
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
    "walk": 6 * kphToTpTk, // all day
    "run": 10 * kphToTpTk, // 8 hours
    "sprint": 55 * kphToTpTk, // a few seconds only
    "swim": 5 * kphToTpTk, // grey wolf, ~3 mph; reported figures are sparse
    "idle": 0,
    "death": 0
  },
  "deer": { 
    "walk": 6 * kphToTpTk, // all day 
    "run": 45 * kphToTpTk, // 2 minutes
    "sprint": 65 * kphToTpTk, // a few seconds only; 0.3 tiles/tick
    "swim": 8 * kphToTpTk, // red deer, ~5 mph; deer outswim wolves
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


// TODO: consider rolling canSprint and canRun into _can()
function canSprint(a, isAlready = false) {
  if (!_can(a, 'run')) return false; // age check
  const limit = fatigueBySpeciesAndPose[a.species].sprint.forceEnd
    * (isAlready ? 1 : 0.7);
  return a.fatigue <= limit;
}

function canRun(a, isAlready = false) {
  if (!_can(a, 'run')) return false; // age check
  const limit = fatigueBySpeciesAndPose[a.species].run.forceEnd
    * (isAlready ? 1 : 0.7);
  return a.fatigue <= limit;
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
    if (newPose === "sprint" && !canSprint(a, a.pose === "sprint"))
      newPose = "run";
    if (newPose === "run" && !canRun(a, a.pose === "run"))
      newPose = "walk";
    a.landPose = newPose;
  }
  // (a swimmer treading water has speed 0, so it still needs to start moving)
  if (newPose === a.pose && a.currentDirection === dir && a.speed > 0) return;

  a.pose = newPose;
  a.currentDirection = dir;
  a.speed = travelSpeedBySpeciesAndPose[a.species][a.pose];
  updateCritterFrame(a);

  // prevent critters from bumping directly into walls
  // TODO: improve blocking for on-edge or to-corner motion
  const moveVec = moveVecByDir[dir];
  const [nextX, nextY] = [a.gx + moveVec[0], a.gy + moveVec[1]];
  // (not while heading for land: that makes no new decisions until ashore)
  if (isImpassable(getTerrainAt(nextX, nextY)) && !a.returnToLand) {
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
  a.pose = "death";
  // become a corpse exactly when the death animation has played through once
  const deathAnim = frameDataBySpeciesAndPose[a.species].death;
  const deathTransitionS = deathAnim.nFrames * deathAnim.holdTks * tempo;
  enqDelayed("decontrol", deathTransitionS, { a: a, killer: killer });
  updateCritterFrame(a, true);
}

function updateCritterAction(a) {
  // a dying critter must not pick a new action, or it would come back to life
  if (!isLiveCritter(a)) return;
  if (a === wolves[0] && handMovesWolf()) return;
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
  setCritterMoving(a, dir);
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

function isImpassable(terrain) {
  // water is passable: critters swim (see updateTerrainPose)
  return terrain === "rock" || terrain === "bush";
}

function isOpaque(terrain) {
  return terrain === "rock";
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
  // terrain of each tile looked at this call, so each is computed once
  const terrainByTile = new Map();

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
      }
      if (terrain !== "water") allWater = false;

      if (!tileMap.has(tile)) {
        if (isImpassable(terrain)) {
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

// Converts a direction measured on SCREEN (from getDir of a pixel vector, e.g.
// DIR_N = straight up on screen) to the grid direction that is drawn that way.
// The isometric view turns the grid 45 degrees, so this is a rotation by one step:
// screen up -> grid NW, screen right -> grid NE, screen down -> grid SE, etc.
function screenDirToGridDir(screenDir) {
  return (screenDir + 7) % 8;
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

// While paused, advance exactly one tick.
function stepOnce() {
  if (isPaused) tick();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "p") {
    isPaused ? unpause() : pause();
    return;
  } else if (e.key === "s") {
    stepOnce();
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
  forbidOverlapsOnStart(); // must run after critters exist

  animat?.setCameraToPCWolf();
  if (!consoleOnlyMode) addCursorTracker();
  startLoop();
};