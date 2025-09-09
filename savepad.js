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

// produces a random distribution in [0, 1) with a parabolic curve
function randomPara() {
  const x = Math.random();
  return 4 * x * (1 - x);
}