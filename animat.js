// requires main.js
// Animat is exclusively responsible for making visual layer updates.

const tileLayer = document.getElementById("tile-layer");
const spriteLayer = document.getElementById("sprite-layer");
// const debugLayer = document.getElementById("debug-layer");
const debugWolfEl = document.getElementById("dbel-pc-wolf");

const renderedTiles = new Map();

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
        tile.style.zIndex = i + j;

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

  animat.addCritter = function(a) {
    const el = document.createElement("div");
    el.classList.add(a.species);
    spriteLayer.appendChild(el);
    a.element = el;
  }

  animat.updateFatigueMeter = function() {
    document.getElementById("fatigue-meter-fill").style.width =
      `${Math.min(100 * pcWolf.fatigue / fatigueBySpeciesAndPose.wolf.run.forceEnd, 100)}%`;
  }

  animat.updateCritterFrame = function(a, frameData) {
    const frameCol = frameData.colZero + a.frame;
    a.element.style.backgroundPosition =
      `-${frameCol * frameData.frameW}px -${this.spriteRow(a) * frameData.frameH}px`;
  }

  // TODO: rearrange sprite rows to match DIR_NAME order
  animat.spriteRow = function (a) {
    // TODO: rearrange sprite rows for simpler formula floor(dir/2)
    return (Math.floor(a.currentDirection / 2) + 1) % 4;
  }

  animat.placeDebugWolfEl = function() {
    // debug element, which has the dimensions of a tile (32 x 16),
    // should be placed so that its center is the same as the wolf's center;
    // to simplify the math it is its own image with no extra pixels.
    const [isoX, isoY] = isoProject(pcWolf.gx, pcWolf.gy);
    debugWolfEl.style.left = (isoX - halfTile) + "px";
    debugWolfEl.style.top = (isoY - qtrTile) + "px";
  }

  animat.centerCameraOnGXY = function(gx, gy) {
    const [px , py] = isoProject(gx, gy);
    worldShiftPX = px - viewportWidth / 2;
    worldShiftPY = py - viewportHeight / 2;
    this.updateCamera();
  }

  animat.setCameraToPCWolf = function() { this.centerCameraOnGXY(pcWolf.gx, pcWolf.gy); }

  animat.placeCritterSprite = function(a) {
    const [isoX, isoY] = isoProject(a.gx, a.gy);

    // critter image is offset so its noon-shadow center is at its grid coordinate
    const frameData = frameDataBySpeciesAndPose[a.species][a.pose];
    const leftOffset = frameData.frameW / 2;
    const topOffset = frameData.hasOwnProperty('topToShadow')
      ? frameData.topToShadow : (frameData.frameH / 2);

    a.element.style.left = (isoX - leftOffset) + "px";
    a.element.style.top = (isoY - topOffset) + "px";
    a.element.style.zIndex = a.gx + a.gy;

    if (a === pcWolf) this.placeDebugWolfEl();
  }

  animat.updateZoomButtons = function() {
    zoomInBtn.disabled = zoom >= zoomMax;
    zoomOutBtn.disabled = zoom <= zoomMin;
  }

  // on-load
  animat.updateZoomButtons();
}


  