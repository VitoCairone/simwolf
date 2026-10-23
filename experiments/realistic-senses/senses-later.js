// REALISTIC VISION AND HEARING: shelved, not loaded by the game.
//
// Written for an earlier sim.js, so it calls the simulation's internals directly
// (allCritters, getTerrainAt, blocksSight, getDir, _can, sqr). To use it, rewrite those
// as sim.* questions and call it from senses.perceive.
//   canSee(a, b)   a sees b if a line from tile to tile (traverseGrid) reaches b
//                  without crossing a tile that blocks sight
//   isVisionFacing a field of view (disabled: it made deer jitter)
//   canHear(a, b)  a hears b moving, within a range set by the ground b moves on and
//                  its gait
//   setPresentOthersIneffMethod   everyone's perceived others: O(n^2) a tick

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
