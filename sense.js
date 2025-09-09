// This code is not invoked
// It is a holding place for Sense code already written that is not yet in use

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

function canSee(a, b) {
  if (!a || !b || a.kind !== 'critter') return alert("Invalid arg to canSee");
  if (distBetweenL2(a, b) > 10000) return false;
  const [aX, aY] = getOnTileXY(a);
  const [bX, bY] = getOnTileXY(b);
  const [visX, visY] = traverseGrid(aX, aY, bX, bY);
  return visX === bX && visY === bY;
}

function isOpaque(terrain) {
  return terrain === "rock";
}

function traverseGrid(aX, aY, bX, bY, fullTrace = false) {
  // For simplicity we are tracing from tile center to tile center,
  // not from exact point to point
  const [sI, sJ] = [aX, aY].map(v => Math.floor(v));
  const [eI, eJ] = [bX, bY].map(v => Math.floor(v));
  let [crossI, crossJ] = [eI - sI, eJ - sJ];
  if (crossI === 0 && crossJ === 0) return fullTrace ? [[sI, sJ]] : [sI, sJ];
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