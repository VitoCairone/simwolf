// requires main.js
// Animat is exclusively responsible for making visual layer updates.

const tileLayer = document.getElementById("tile-layer");
const spriteLayer = document.getElementById("sprite-layer");
// const debugLayer = document.getElementById("debug-layer");
const debugWolfEl = document.getElementById("dbel-pc-wolf");

const renderedTiles = new Map();

// DRAWING ORDER (z-index) of tiles and critter sprites, which share one stacking order
// (the layers in index.html don't set their own). Depth = gx + gy: larger is nearer the
// camera. z-index must be an integer, so depths are scaled by 100.
//   water tiles      0 .. 254         always lowest: the water surface is below land
//   land tiles       1000 + 100*depth by depth, interleaved with swimmers
//   swimmers         1000 + 100*depth so a land tile in front of a swimmer covers it
//   land critters    100000 + depth   above all tiles (land is level, nothing hides them)
// A land tile's depth is its center's (i + j + 1); a swimmer counts as half a tile
// further back, so only land clearly in front of it (by more than half a tile) covers it.
const zSwimLandBase = 1000;
const zLandCritterBase = 100000;

function tileZIndex(i, j, terrain) {
  if (terrain === "water") return i + j;
  return zSwimLandBase + (i + j + 1) * 100;
}

if (!consoleOnlyMode) {
  animat ||= {};

  animat.clearAllRenderedTiles = function() {
    for (const key of renderedTiles.keys()) {
      tileLayer.removeChild(renderedTiles.get(key));
      renderedTiles.delete(key);
    }
  }

  animat.renderVisibleTiles = function() {
    // Note the absence of factoring for zoom;
    // this method collects the square which contains
    // all tiles (actually twice as many because it surrounds the displayed diamond)
    // at zoom = 1, ergo always more than enough at higher zoom.
    
    const cornerPs = [
      [worldShiftPX, worldShiftPY], // TopLeft
      [worldShiftPX + viewportWidth, worldShiftPY], // TopRight
      [worldShiftPX, worldShiftPY + viewportHeight], // BotLeft
      [worldShiftPX + viewportWidth, worldShiftPY + viewportHeight] // BotRight
    ];
    const cornerGs = cornerPs.map(pair => rectiProject(...pair));

    const iMin = Math.max(0, Math.floor(cornerGs[0][0]));
    const iMax = Math.min(gridWidthN - 1, Math.floor(cornerGs[3][0]));
    const jMin = Math.max(0, Math.floor(cornerGs[1][1]));
    const jMax = Math.min(gridHeightN - 1 ,Math.floor(cornerGs[2][1]));

    for (const key of renderedTiles.keys()) {
      const [i, j] = key.split('_').map(Number);
      if (i < iMin || i > iMax || j < jMin || j > jMax) {
        tileLayer.removeChild(renderedTiles.get(key));
        renderedTiles.delete(key);
      }
    }
    
    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        const key = `${i}_${j}`;
        if (renderedTiles.has(key)) continue;

        // TODO: cache this check to reduce redundant work
        const tileClass = getTileClassAt(i, j);

        const tile = document.createElement("div");
        tile.className = `tile ${tileClass}`;
        tile.style.zIndex = tileZIndex(i, j, tileClass);

        const [px, py] = isoProject(i, j);
        tile.style.left = `${px - halfTile}px`;
        tile.style.top = `${py - tileRiserPY}px`;

        tileLayer.appendChild(tile);
        renderedTiles.set(key, tile);
      }
    }
  }

  animat.updateCamera = function() {
    worldShiftPX = boundVal(worldShiftPX, -worldRadPX, worldRadPX - viewportWidth);
    worldShiftPY = boundVal(worldShiftPY, 0, (worldDiamPY + tileRiserPY) - viewportHeight);
    
    animat.renderVisibleTiles();

    const [zoX, zoY] = [worldShiftPX + viewportWidth / 2, worldShiftPY + viewportHeight / 2];
    document.getElementById("field").style.transformOrigin = `${zoX}px ${zoY}px`;
    document.getElementById("field").style.transform = `translate(${-worldShiftPX}px, ${-worldShiftPY}px) scale(${zoom})`;
  }

  // TODO: animat currently creates critters when world does and updates
  // all critters per frame. Change to have only the number of divs needed
  // for the number of critters visible in the window, and only update
  // sprite frames and placements for those which are visible.
  animat.addCritter = function(a) {
    const el = document.createElement("div");
    el.className = "critter"; // the sheet class is added by updateCritterFrame
    spriteLayer.appendChild(el);
    a.element = el;
  }

  // Wind (top) and stamina (bottom) bars for the player's wolf; full bar = full reserve.
  animat.updateExertionMeter = function() {
    document.getElementById("wind-meter-fill").style.width = `${100 * pcWolf.wind}%`;
    document.getElementById("stamina-meter-fill").style.width = `${100 * pcWolf.stamina}%`;
  }


  // Sprite row (and horizontal mirroring) for each grid direction, indexed by DIR_*:
  //            E(↘) SE(↓) S(↙) SW(←) W(↖) NW(↑) N(↗) NE(→)
  // Wolf sheet rows: 0 ↗, 1 ↘, 2 ↙, 3 ↖, 4 ↑, 5 →, 6 ↓. Facing ← is row 5 mirrored.
  const spriteRowByDir = {
    wolf: [1, 6, 2, 5, 3, 4, 0, 5],
  };
  const mirrorByDir = {
    wolf: [false, false, false, true, false, false, false, false],
  };

  animat.updateCritterFrame = function(a, frameData) {
    // Each pose names its sprite sheet's CSS class (see .critter in index.html), which
    // sets the sheet image and frame size. Swap the class when the sheet changes.
    const sheetClass = "critter " + frameData.sheet;
    if (a.element.className !== sheetClass) {
      a.element.className = sheetClass;
      // frame size may have changed, which moves the sprite's anchor point
      if (a.gx !== undefined) this.placeCritterSprite(a);
    }
    const frameCol = frameData.colZero + a.frame;
    a.element.style.backgroundPosition =
      `-${frameCol * frameData.frameW}px -${this.spriteRow(a) * frameData.frameH}px`;
    // the element is centered on the critter's x, so mirroring about its center is safe
    const mirror = mirrorByDir[a.species]?.[a.currentDirection] ?? false;
    a.element.style.transform = mirror ? "scaleX(-1)" : "";
  }

  animat.spriteRow = function (a) {
    const rows = spriteRowByDir[a.species];
    if (rows) return rows[a.currentDirection];
    // species with only the 4 diagonal rows (e.g. deer): odd directions borrow a neighbor
    return (Math.floor(a.currentDirection / 2) + 1) % 4;
  }

  animat.placeDebugWolfEl = function() {
    // debug element, which has the dimensions of a tile (32 x 16),
    // should be placed so that its center is the same as the wolf's center;
    // to simplify the math it is its own image with no extra pixels.
    // In water the wolf is on the water surface, which is drawn lower than land.
    const [isoX, isoY] = isoProject(pcWolf.gx, pcWolf.gy);
    const surfaceDrop = pcWolf.pose === "swim" ? waterSurfaceDropPY : 0;
    debugWolfEl.style.left = (isoX - halfTile) + "px";
    debugWolfEl.style.top = (isoY - qtrTile + surfaceDrop) + "px";
  }

  animat.centerCameraOnGXY = function(gx, gy) {
    const [px , py] = isoProject(gx, gy);
    worldShiftPX = px - viewportWidth / 2;
    worldShiftPY = py - viewportHeight / 2;
    this.updateCamera();
  }

  animat.setCameraToPCWolf = function() { this.centerCameraOnGXY(pcWolf.gx, pcWolf.gy); }

  animat.spriteZIndex = function(a) {
    const depth = a.gx + a.gy;
    if (a.pose === "swim") return zSwimLandBase + Math.round((depth + 0.5) * 100);
    return zLandCritterBase + Math.round(depth * 100);
  }

  animat.placeCritterSprite = function(a) {
    const [isoX, isoY] = isoProject(a.gx, a.gy);

    // critter image is offset so its noon-shadow center is at its grid coordinate
    const frameData = frameDataBySpeciesAndPose[a.species][a.pose];
    const leftOffset = frameData.frameW / 2;
    const topOffset = frameData.hasOwnProperty('topToShadow')
      ? frameData.topToShadow : (frameData.frameH / 2);

    a.element.style.left = (isoX - leftOffset) + "px";
    a.element.style.top = (isoY - topOffset) + "px";
    // z-index must be an integer; a fractional value is silently ignored by the
    // browser, which froze each sprite's depth at its spawn value.
    a.element.style.zIndex = this.spriteZIndex(a);

    if (a === pcWolf) this.placeDebugWolfEl();
  }

  const movePadKnob = document.getElementById("move-pad-knob");
  const movePadRingEls = [...document.querySelectorAll("#move-pad .ring")];

  // vx, vy: pointer offset from pad center, normalized so the outer ring = 1.
  // pose: the ring the pointer is in, or null when the pad is not in use.
  animat.updateMovePad = function(vx, vy, pose) {
    movePadKnob.classList.toggle("visible", pose !== null);
    movePadKnob.setAttribute("cx", vx * 100);
    movePadKnob.setAttribute("cy", vy * 100);
    movePadRingEls.forEach(el => el.classList.toggle("active", el.dataset.pose === pose));
  }

  animat.updateZoomButtons = function() {
    zoomInBtn.disabled = zoom >= zoomMax;
    zoomOutBtn.disabled = zoom <= zoomMin;
  }

  // on-load
  animat.updateZoomButtons();
}


  