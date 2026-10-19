// THE VIEW: everything the player sees, and nothing else.
//
// animat draws the simulation's current state: tiles, critter sprites and their
// animation, the camera and zoom, the exertion meters, the movement pad's highlight, the
// arrow-mode icon, and the debug readouts. It only ever READS the simulation (sim.js);
// it never changes it. Its own state (camera, zoom, which DOM elements exist) is its own.
//
// Everything it offers is on the one global it defines, `animat`. Connect it to a
// simulation with animat.attach(sim); it then redraws after every frame of ticks
// (sim.onFrame). Functions that change the view itself (zoom, camera, pad highlight) are
// called by controls.js in response to the player's input.

const animat = (() => {

let sim = null; // set by attach()

// PROJECTION
// Isometric: a tile that is SQUARE in grid space appears as a SQUASHED DIAMOND, its
// surface half as many pixels high as it is wide.
const tileSize = 32;
const tileRiserPY = 8;
const halfTile = tileSize / 2;
const qtrTile = tileSize / 4;
// Water tiles in tiles.png draw their surface this many px lower than land surfaces, so
// water looks sunken. Anything in water is drawn on that lower surface: a point on it
// appears this far below the same grid point on land (half a tile, diagonally).
const waterSurfaceDropPY = 8;
// Terrain height (see TERRAIN HEIGHT in sim.js): one level is drawn one block riser high,
// so stacked blocks make cliffs and the water surface sits one level below level-0 land.
const levelHeightPY = tileRiserPY;
let worldRadPX = 0;  // set by attach(), from the grid size
let worldDiamPY = 0;

function boundVal(val, min, max) { return Math.max(min, Math.min(val, max)); }

// rendering errors occur abruptly at x == 1677740
// unknown why at this time
// also observed at: [369092, 1404710] and other values which are
// close to 1500k in Y and 300k+ in X
function isoProject(gx, gy) {
  const px = (gx - gy) * halfTile;
  const py = (gx + gy) * qtrTile;
  return [px, py];
}

// Where a grid point on the ground is drawn: its isometric position raised by the
// ground's height there.
function groundProject(gx, gy) {
  const [px, py] = isoProject(gx, gy);
  return [px, py - sim.heightAt(gx, gy) * levelHeightPY];
}

function rectiProject(px, py) {
  const gx = (px / tileSize + py / halfTile);
  const gy = (py / halfTile - px / tileSize);
  return [gx, gy];
}

// Converts a direction measured on SCREEN (from sim.getDir of a pixel vector, e.g.
// DIR_N = straight up on screen) to the grid direction that is drawn that way.
// The isometric view turns the grid 45 degrees, so this is a rotation by one step:
// screen up -> grid NW, screen right -> grid NE, screen down -> grid SE, etc.
function screenDirToGridDir(screenDir) {
  return (screenDir + 7) % 8;
}

// SPRITE SHEETS
// A pose may set its own facing rows (rowByDir, mirrorByDir: by grid direction DIR_*),
// for a sheet laid out differently from its species' usual one.

// The deer's death sheet has two drawn facings, row 0 facing N (up-right) and row 1
// facing E (down-right); S (down-left) is E mirrored and W (up-left) is N mirrored. A
// deer facing between two diagonals (SE, SW, NW, NE) dies facing the next diagonal
// clockwise: SE -> S, SW -> W, NW -> N, NE -> E.
//                  E(↘)   SE(↓) S(↙)  SW(←) W(↖)  NW(↑)  N(↗)   NE(→)
const deerDeathFacing = {
  rowByDir:    [1,     1,    1,    0,    0,    0,     0,     1],
  mirrorByDir: [false, true, true, true, true, false, false, false],
};
// `sheet` names the sprite sheet's CSS class in style.css (.wolf, .wolf-swim, ...),
// which sets the sheet image and frame size; frameW/frameH must match that class.
// holdTks: how many simulation ticks each frame is shown.
const frameDataBySpeciesAndPose = {
  wolf: {
    walk: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 },
    idle: {sheet: "wolf", nFrames: 4, colZero: 8, frameW: 64, frameH: 64,
      holdTks: 12, topToShadow: 39 },
    trot: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 }, // placeholder
    gallop: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 }, // placeholder
    // swim sheet is made from the run frames, same 7 facing rows. Its frames already
    // draw the waterline waterSurfaceDropPY below the ground point, so the same
    // topToShadow as on land puts the swimmer on the (lower) water surface. Land tiles
    // in front of a swimmer are drawn over it (see spriteZIndex).
    swim: {sheet: "wolf-swim", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 8, topToShadow: 39 },
  },
  deer: {
    walk: {sheet: "deer", nFrames: 11, colZero: 0, frameW: 32, frameH: 41,
      holdTks: 5, topToShadow: 33},
    idle: {sheet: "deer", nFrames: 24, colZero: 11, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33},
    trot: {sheet: "deer", nFrames: 10, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33},
    gallop: {sheet: "deer", nFrames: 10, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 12, topToShadow: 33}, // placeholder
    // swim frames are 40x48 (wider/taller than land frames to fit the ripple ring).
    // same topToShadow as the deer's land poses, as for the wolf's swim (see there)
    swim: {sheet: "deer-swim", nFrames: 10, colZero: 0, frameW: 40, frameH: 48,
      holdTks: 10, topToShadow: 33 },
    // death: its own sheet (made by spritecraft/make_deer_death.py), 48x48 frames: the
    // knees give, it rolls over and lies on its side. Two drawn facings, mirrored for the
    // other two (deerDeathFacing). Must play through exactly once in the simulation's
    // deathDurationSBySpecies (checked by attach). The corpse ("dead") is its last frame.
    death: {sheet: "deer-death", nFrames: 5, colZero: 0, frameW: 48, frameH: 48,
      holdTks: 8, topToShadow: 40, ...deerDeathFacing},
    dead: {sheet: "deer-death", nFrames: 1, colZero: 4, frameW: 48, frameH: 48,
      holdTks: Infinity, topToShadow: 40, ...deerDeathFacing},
  }
};

// Sprite row (and horizontal mirroring) for each grid direction, indexed by DIR_*:
//            E(↘) SE(↓) S(↙) SW(←) W(↖) NW(↑) N(↗) NE(→)
// Wolf sheet rows: 0 ↗, 1 ↘, 2 ↙, 3 ↖, 4 ↑, 5 →, 6 ↓. Facing ← is row 5 mirrored.
const spriteRowByDir = {
  wolf: [1, 6, 2, 5, 3, 4, 0, 5],
};
const mirrorByDir = {
  wolf: [false, false, false, true, false, false, false, false],
};

function spriteRow(a) {
  const rows = spriteRowByDir[a.species];
  if (rows) return rows[a.currentDirection];
  // species with only the 4 diagonal rows (e.g. deer): odd directions borrow a neighbor
  return (Math.floor(a.currentDirection / 2) + 1) % 4;
}

// Animation frame from how long the critter has been in its pose (sim's a.poseTick):
// each frame shows for holdTks ticks, looping.
function frameIndex(a, frameData) {
  const ticksInPose = sim.tickCount - (a.poseTick ?? 0); // 1 after the pose's first tick
  return Math.floor(Math.max(0, ticksInPose - 1) / frameData.holdTks) % frameData.nFrames;
}

// DRAWING ORDER (z-index) of tiles and critter sprites, which share one stacking order
// (the layers in style.css don't set their own). Depth = gx + gy: larger is nearer the
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

function spriteZIndex(a) {
  const depth = a.gx + a.gy;
  if (a.pose === "swim") return zSwimLandBase + Math.round((depth + 0.5) * 100);
  return zLandCritterBase + Math.round(depth * 100);
}

// DOM
const el = id => document.getElementById(id);
const fieldWrapper = el("field-wrapper");
const field = el("field");
const tileLayer = el("tile-layer");
const spriteLayer = el("sprite-layer");
const debugWolfEl = el("dbel-pc-wolf");
const windFillEl = el("wind-meter-fill");
const staminaFillEl = el("stamina-meter-fill");
const zoomInBtn = el("zoom-in");
const zoomOutBtn = el("zoom-out");
const arrowsIconEl = el("arrow-mode-icon");
const cursorCoordsEl = el("cursor-coords");
const movePadKnob = el("move-pad-knob");
const movePadRingEls = [...document.querySelectorAll("#move-pad .ring")];

// Writes a style property only when it changes (the view redraws every frame).
function setStyle(node, cache, prop, value) {
  if (cache[prop] === value) return;
  cache[prop] = value;
  node.style[prop] = value;
}

// CAMERA
// worldShift is the world pixel at the viewport's top-left corner (at zoom 1); zoom
// scales about the viewport's center. The camera follows the player's wolf unless the
// player has panned away (controls.js re-attaches it).
// TODO: pan limits are based on zoom = 1, so you cannot pan to the edges when zoomed in
const zoomMin = 1;
const zoomMax = 8;
const camera = { shiftPX: 0, shiftPY: 0, zoom: 1, followsWolf: true };
let viewportWidth = 0;
let viewportHeight = 0;
let drawnCameraKey = null; // camera state the field and tiles were last drawn for

function measureViewport() {
  viewportWidth = fieldWrapper.clientWidth;
  viewportHeight = fieldWrapper.clientHeight;
}

function centerShiftOn(gx, gy) {
  const [px, py] = groundProject(gx, gy);
  camera.shiftPX = px - viewportWidth / 2;
  camera.shiftPY = py - viewportHeight / 2;
}

function drawCamera() {
  const w = sim.pcWolf;
  if (camera.followsWolf && w.gx !== undefined) centerShiftOn(w.gx, w.gy);
  camera.shiftPX = boundVal(camera.shiftPX, -worldRadPX, worldRadPX - viewportWidth);
  camera.shiftPY = boundVal(camera.shiftPY, 0, (worldDiamPY + tileRiserPY) - viewportHeight);

  const key = [camera.shiftPX, camera.shiftPY, camera.zoom, viewportWidth, viewportHeight].join();
  if (key === drawnCameraKey) return;
  drawnCameraKey = key;

  renderVisibleTiles();
  const [zoX, zoY] = [camera.shiftPX + viewportWidth / 2, camera.shiftPY + viewportHeight / 2];
  field.style.transformOrigin = `${zoX}px ${zoY}px`;
  field.style.transform = `translate(${-camera.shiftPX}px, ${-camera.shiftPY}px) scale(${camera.zoom})`;
}

// TILES
const renderedTiles = new Map();

function clearAllRenderedTiles() {
  for (const tile of renderedTiles.values()) tileLayer.removeChild(tile);
  renderedTiles.clear();
}

// TODO: cache the terrain-to-class lookup to reduce redundant work
function getTileClassAt(i, j) {
  return sim.getTerrainAt(i, j);
}

function renderVisibleTiles() {
  // Note the absence of factoring for zoom;
  // this method collects the square which contains
  // all tiles (actually twice as many because it surrounds the displayed diamond)
  // at zoom = 1, ergo always more than enough at higher zoom.
  const { shiftPX, shiftPY } = camera;
  const cornerPs = [
    [shiftPX, shiftPY], // TopLeft
    [shiftPX + viewportWidth, shiftPY], // TopRight
    [shiftPX, shiftPY + viewportHeight], // BotLeft
    [shiftPX + viewportWidth, shiftPY + viewportHeight] // BotRight
  ];
  const cornerGs = cornerPs.map(pair => rectiProject(...pair));

  const iMin = Math.max(0, Math.floor(cornerGs[0][0]));
  const iMax = Math.min(sim.gridWidthN - 1, Math.floor(cornerGs[3][0]));
  const jMin = Math.max(0, Math.floor(cornerGs[1][1]));
  const jMax = Math.min(sim.gridHeightN - 1, Math.floor(cornerGs[2][1]));
  // ...and further down-screen, where raised ground can still reach up into view
  const raisedRows = Math.ceil(sim.maxLevel * levelHeightPY / qtrTile);
  const iMaxRaised = Math.min(sim.gridWidthN - 1, iMax + raisedRows);
  const jMaxRaised = Math.min(sim.gridHeightN - 1, jMax + raisedRows);

  for (const [key, tile] of renderedTiles) {
    const [i, j] = key.split('_').map(Number);
    if (i < iMin || i > iMaxRaised || j < jMin || j > jMaxRaised) {
      tileLayer.removeChild(tile);
      renderedTiles.delete(key);
    }
  }

  for (let j = jMin; j <= jMaxRaised; j++) {
    for (let i = iMin; i <= iMaxRaised; i++) {
      const key = `${i}_${j}`;
      if (renderedTiles.has(key)) continue;
      const tile = makeTileElement(i, j);
      tileLayer.appendChild(tile);
      renderedTiles.set(key, tile);
    }
  }
}

// GROUND: each land tile is drawn as a column (see images/ground-slopes.png, made by
// spritecraft/make_slope_tiles.py): the sprite of its shape at its base level, whose
// sides reach one level below the base like a flat block, then as many riser strips as
// needed to reach down to the ground in front of it (where a cliff drops). Columns are
// painted back to front (tileZIndex), so anything further down is covered by the ground
// in front of it.
const groundRowByTerrain = { grass: 0, dirt: 1, stone: 2 }; // sheet rows
const groundCellW = 32, groundCellH = 40;
const groundBaseY = 16;    // y of the base plane's N corner within a shape cell
const riserCol = 15;       // sheet column of the one-level riser strip
// The boulder (.tile.boulder: its image in tiles.png) has no ground of its own: it rests on
// its tile. In its 32 x 32 cell its footprint's widest corners are on row 25 (columns 7
// and 25) and its front tip on row 30, so the footprint's center, row 25, goes on the
// ground at the tile's center.
const boulderFootCenterY = 25;

// The level a tile's front sides must reach down to, for the tile at (i, j) in front of
// it: that tile's lowest corner; water and the map's edge show sides down to level -1
// (the water surface is drawn one level below level-0 land).
function frontGroundLevel(i, j) {
  if (i >= sim.gridWidthN || j >= sim.gridHeightN) return -1;
  if (sim.getTerrainAt(i, j) === "water") return -1;
  return Math.min(...sim.tileCorners(i, j));
}

function groundPiece(col, row, top) {
  const piece = document.createElement("div");
  piece.className = "ground";
  piece.style.top = `${top}px`;
  piece.style.backgroundPosition = `-${col * groundCellW}px -${row * groundCellH}px`;
  return piece;
}

function makeTileElement(i, j) {
  const terrain = getTileClassAt(i, j);
  const [px, py] = isoProject(i, j);
  const tile = document.createElement("div");
  tile.style.zIndex = tileZIndex(i, j, terrain);
  tile.style.left = `${px - halfTile}px`;

  if (terrain === "water") { // water is flat at level 0, its own flat tile
    tile.className = `tile ${terrain}`;
    tile.style.top = `${py - tileRiserPY}px`;
    return tile;
  }

  // the column's origin is its base plane's N corner (less half a tile in x)
  const corners = sim.tileCorners(i, j);
  const base = Math.min(...corners);
  const shape = (corners[0] - base) | (corners[1] - base) << 1
    | (corners[2] - base) << 2 | (corners[3] - base) << 3;
  const row = groundRowByTerrain[terrain];
  if (row === undefined) return alert(`animat: no ground sprites for terrain "${terrain}"`);
  tile.className = "ground-column";
  tile.style.top = `${py - base * levelHeightPY}px`;

  tile.appendChild(groundPiece(shape, row, -groundBaseY));
  const floor = Math.min(frontGroundLevel(i, j + 1), frontGroundLevel(i + 1, j));
  for (let k = 1; k <= base - 1 - floor; k++) {
    tile.appendChild(groundPiece(riserCol, row, k * levelHeightPY));
  }
  if (sim.obstacleAt(i, j) === "boulder") { // resting on the middle of the tile
    const boulder = document.createElement("div");
    boulder.className = "tile boulder";
    // the tile's center on its surface, in the column's coordinates (base N corner = 0)
    const centerAboveBase = (corners[0] + corners[1] + corners[2] + corners[3]) / 4 - base;
    const centerY = isoProject(0.5, 0.5)[1] - centerAboveBase * levelHeightPY;
    boulder.style.left = "0px";
    boulder.style.top = `${centerY - boulderFootCenterY}px`;
    tile.appendChild(boulder);
  }
  return tile;
}

// CRITTER SPRITES
// One element per critter (live or corpse), keyed by uid; created when a critter first
// appears and removed when it leaves the simulation.
// TODO: only keep elements for critters inside the viewport.
const sprites = new Map(); // uid -> { node, css }

function drawCritter(a) {
  let s = sprites.get(a.uid);
  if (!s) {
    s = { node: document.createElement("div"), css: {} };
    spriteLayer.appendChild(s.node);
    sprites.set(a.uid, s);
  }
  const fd = frameDataBySpeciesAndPose[a.species][a.pose];
  if (!fd) return alert(`animat: no sprite frames for ${a.species} pose "${a.pose}"`);

  // Each pose names its sprite sheet's CSS class (see .critter in style.css), which
  // sets the sheet image and frame size.
  const className = "critter " + fd.sheet;
  if (s.node.className !== className) s.node.className = className;

  const frameCol = fd.colZero + frameIndex(a, fd);
  const row = fd.rowByDir ? fd.rowByDir[a.currentDirection] : spriteRow(a);
  setStyle(s.node, s.css, "backgroundPosition",
    `-${frameCol * fd.frameW}px -${row * fd.frameH}px`);
  // the element is centered on the critter's x, so mirroring about its center is safe
  const mirror = fd.mirrorByDir ? fd.mirrorByDir[a.currentDirection]
    : (mirrorByDir[a.species]?.[a.currentDirection] ?? false);
  setStyle(s.node, s.css, "transform", mirror ? "scaleX(-1)" : "");

  // critter image is offset so its noon-shadow center is at its grid coordinate, on the
  // ground (flat sprites for now, also on slopes)
  const [isoX, isoY] = groundProject(a.gx, a.gy);
  const topOffset = fd.topToShadow ?? (fd.frameH / 2);
  setStyle(s.node, s.css, "left", `${isoX - fd.frameW / 2}px`);
  setStyle(s.node, s.css, "top", `${isoY - topOffset}px`);
  // z-index must be an integer; a fractional value is silently ignored by the browser
  setStyle(s.node, s.css, "zIndex", String(spriteZIndex(a)));
}

function drawCritters() {
  const present = new Set();
  for (const list of [sim.allCritters, sim.allCorpses]) {
    for (const a of list) {
      present.add(a.uid);
      drawCritter(a);
    }
  }
  for (const [uid, s] of sprites) {
    if (!present.has(uid)) {
      s.node.remove();
      sprites.delete(uid);
    }
  }
}

// DEBUG OUTLINE of the player's wolf's tile-sized footprint
const debugWolfCss = {};
function drawDebugWolf() {
  // debug element, which has the dimensions of a tile (32 x 16),
  // should be placed so that its center is the same as the wolf's center;
  // to simplify the math it is its own image with no extra pixels.
  // In water the wolf is on the water surface, which is drawn lower than land.
  const w = sim.pcWolf;
  const [isoX, isoY] = groundProject(w.gx, w.gy);
  const surfaceDrop = w.pose === "swim" ? waterSurfaceDropPY : 0;
  setStyle(debugWolfEl, debugWolfCss, "left", (isoX - halfTile) + "px");
  setStyle(debugWolfEl, debugWolfCss, "top", (isoY - qtrTile + surfaceDrop) + "px");
}

// EXERTION METERS: wind (top) and stamina (bottom) of the player's wolf; full bar = full
// reserve. No labels: no words or numbers in gameplay UI.
const windCss = {};
const staminaCss = {};
function drawExertion() {
  setStyle(windFillEl, windCss, "width", `${100 * sim.pcWolf.wind}%`);
  setStyle(staminaFillEl, staminaCss, "width", `${100 * sim.pcWolf.stamina}%`);
}

// Draws the whole view as the simulation is now. Called after every frame of ticks, and
// directly after anything that changes the view while the game is paused.
function render() {
  drawCamera();
  drawCritters();
  drawDebugWolf();
  drawExertion();
}

// SIDEBAR AND PAD (changed by controls.js)

function updateZoomButtons() {
  zoomInBtn.disabled = camera.zoom >= zoomMax;
  zoomOutBtn.disabled = camera.zoom <= zoomMin;
}

function setZoom(z) {
  const newZoom = boundVal(z, zoomMin, zoomMax);
  if (newZoom === camera.zoom) return;
  // zooming out shows more of the world: start the tiles afresh
  // (temporary artifacting can still appear when zooming out and then panning)
  if (newZoom < camera.zoom) clearAllRenderedTiles();
  camera.zoom = newZoom;
  drawnCameraKey = null;
  updateZoomButtons();
  render();
}

function zoomIn() { setZoom(camera.zoom * 2); }
function zoomOut() { setZoom(camera.zoom / 2); }

// The camera stops following the wolf and moves by this many screen pixels.
function panCamera(dxPX, dyPX) {
  camera.followsWolf = false;
  camera.shiftPX += dxPX;
  camera.shiftPY += dyPX;
}

// The camera stops following the wolf and centers on this grid point.
function centerCameraOn(gx, gy) {
  camera.followsWolf = false;
  centerShiftOn(gx, gy);
  render();
}

// The camera centers on the player's wolf and keeps following it.
function followWolf() {
  camera.followsWolf = true;
  render();
}

// Movement pad highlight. vx, vy: pointer offset from pad center, normalized so the
// outer ring = 1. pose: the ring the pointer is in, or null when the pad is not in use.
function showMovePad(vx, vy, pose) {
  movePadKnob.classList.toggle("visible", pose !== null);
  movePadKnob.setAttribute("cx", vx * 100);
  movePadKnob.setAttribute("cy", vy * 100);
  movePadRingEls.forEach(ring => ring.classList.toggle("active", ring.dataset.pose === pose));
}

const wolfIconSVG = `
  <!-- Face outline: top, left, right, bottom point -->
  <path d="M6 6 H18 V18 L12 22 L6 18 Z" />
  <!-- Ears: verticals -->
  <line x1="7" y1="6" x2="7" y2="3" />
  <line x1="17" y1="6" x2="17" y2="3" />
  <!-- Ears: angled tops -->
  <line x1="7" y1="3" x2="10" y2="6" />
  <line x1="17" y1="3" x2="14" y2="6" />`;

const cameraIconSVG = `
  <!-- Main camera body: rounded rectangle -->
  <rect x="3" y="6" width="10" height="12" rx="2" ry="2" />
  <!-- Right-facing lens hood / extension -->
  <path d="M13 10 L17 7 V17 L13 14 Z" />`;

// Arrow-mode icon: a wolf when the arrow keys move the wolf, a camera when they pan.
function showArrowMode(arrowsMoveWolf) {
  arrowsIconEl.innerHTML = arrowsMoveWolf ? wolfIconSVG : cameraIconSVG;
}

// The grid point drawn at a screen position (clientX/Y), or null if it is off the field.
function screenToGrid(clientX, clientY) {
  const rect = fieldWrapper.getBoundingClientRect();
  const sx = clientX - rect.left, sy = clientY - rect.top;
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return null;
  // the field is scaled by zoom about the viewport's center
  const px = camera.shiftPX + viewportWidth / 2 + (sx - viewportWidth / 2) / camera.zoom;
  const py = camera.shiftPY + viewportHeight / 2 + (sy - viewportHeight / 2) / camera.zoom;
  return rectiProject(px, py);
}

// Developer debug readout of grid coordinates (null = pointer not over the field).
function showCursorCoords(g) {
  cursorCoordsEl.textContent = g
    ? `x: ${g[0].toFixed(3)}, y: ${g[1].toFixed(3)}`
    : `x: –, y: –`;
}

// CONNECTING TO A SIMULATION
function attach(theSim) {
  if (sim) return alert("animat.attach called twice");
  if (!theSim || typeof theSim.onFrame !== "function")
    return alert("animat.attach needs the simulation (load sim.js before animat.js)");
  sim = theSim;

  worldRadPX = halfTile + (sim.gridWidthN + sim.gridHeightN - 2) * qtrTile;
  worldDiamPY = worldRadPX;

  for (const [species, deathS] of Object.entries(sim.deathDurationSBySpecies)) {
    const d = frameDataBySpeciesAndPose[species].death;
    if (Math.abs(d.nFrames * d.holdTks * sim.tempo - deathS) > 1e-9)
      return alert(`animat: ${species} death animation doesn't last sim's ${deathS} s`);
  }

  measureViewport();
  window.addEventListener("resize", () => { measureViewport(); render(); });
  showArrowMode(false);
  updateZoomButtons();

  sim.onFrame(render);
  render();
}

// THE INTERFACE
return {
  attach, render,
  // view changes, for controls.js
  zoomIn, zoomOut, setZoom, panCamera, centerCameraOn, followWolf,
  showMovePad, showArrowMode, showCursorCoords,
  // reading the view
  screenToGrid, screenDirToGridDir, isoProject,
  get camera() {
    return { ...camera, viewportWidth, viewportHeight, worldRadPX, zoomMin, zoomMax };
  },
  // for tests and debugging
  spriteEl: a => sprites.get(a.uid)?.node,
  spriteRow, spriteZIndex, frameDataBySpeciesAndPose,
};

})();
