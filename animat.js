// THE VIEW: everything the player sees. It draws the simulation's current state (tiles,
// critters, the camera, the meters, the movement pad's highlight and the debug readouts)
// and only ever reads the simulation.
//
// Everything it offers is on the one global it defines, `animat`. Connect it with
// animat.attach(sim); it then redraws after every frame of ticks. controls.js calls the
// functions that change the view itself (zoom, camera, pad highlight).

const animat = (() => {

let sim = null; // set by attach()

// PROJECTION: isometric, a grid square drawn as a diamond half as high as it is wide.
const tileSize = 32;
const tileRiserPY = 8;
const halfTile = tileSize / 2;
const qtrTile = tileSize / 4;
// Water tiles in tiles.png draw their surface this much lower than land, so anything in
// water is drawn this far below the same grid point on land.
const waterSurfaceDropPY = 8;
// One terrain level (see TERRAIN HEIGHT in sim.js) is one block riser high, so the water
// surface sits one level below level-0 land.
const levelHeightPY = tileRiserPY;
let worldRadPX = 0;  // set by attach(), from the grid size
let worldDiamPY = 0;

function boundVal(val, min, max) { return Math.max(min, Math.min(val, max)); }

// TODO: drawing breaks down at pixel coordinates around 1.4-1.7 million (likely the
// browser's limit on CSS positions); far beyond this map's size, but it caps the map.
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

// The grid direction drawn as screen direction screenDir (sim.getDir of a pixel vector):
// the view turns the grid 45 degrees, so screen up is grid NW, screen right grid NE.
function screenDirToGridDir(screenDir) {
  return (screenDir + 7) % 8;
}

// The grid vector drawn as screen vector (sx, sy) on flat ground, up to scale: the
// inverse of isoProject's linear part.
function screenVecToGridVec(sx, sy) {
  return [sx + 2 * sy, 2 * sy - sx];
}

// SPRITE SHEETS
// The deer's death and carcass sheets have two facings, row 0 facing N (up-right) and
// row 1 E (down-right); S and W are those mirrored, and the in-between directions use
// the next diagonal clockwise.
//                  E(↘)   SE(↓) S(↙)  SW(←) W(↖)  NW(↑)  N(↗)   NE(→)
const deerDeathFacing = {
  rowByDir:    [1,     1,    1,    0,    0,    0,     0,     1],
  mirrorByDir: [false, true, true, true, true, false, false, false],
};
// Each pose's frames:
//   sheet           the sheet's CSS class in style.css, which sets its image and frame
//                   size (frameW and frameH must match it)
//   colZero, nFrames, holdTks   a run of columns, each shown holdTks ticks, looping
//   cols, holds, loopFrom       or: columns and ticks each, looping from cols[loopFrom]
//   topToShadow     y of the shadow's center (the critter's ground point) in a frame
//   rowByDir, mirrorByDir       the sheet's rows by direction, if not the species' own
// The deer's land frames and timing follow the artist's preview (images_raw/OvN65m.gif,
// via spritecraft/extract_deer_gif.py): 100 ms a frame, 500 ms at the idle's pauses.
// The wolf's follow its preview (images_raw/5V5aC4.gif) and sheet (images_raw/wolf-all.png),
// via spritecraft/extract_wolf_sheet.py: run 70 ms a frame, idle 200, death 100, and the
// howl and bite as listed. Frames held a time that isn't a whole number of ticks are
// timed by holdsFromMs.
const deerIdleCols = Array.from({ length: 24 }, (_, k) => 11 + k);
const colsFrom = (first, n) => Array.from({ length: n }, (_, k) => first + k);

// Ticks to hold each frame, the times in ms rounded as they add up, so the whole loop
// keeps the right length.
function holdsFromMs(ms) {
  const tickMs = 1000 / 60; // (sim.tempo, which this runs before attach can read)
  let sum = 0, done = 0;
  return ms.map(t => { sum += t; const end = Math.round(sum / tickMs), h = end - done; done = end; return h; });
}

// The wolf's diagonal-only sheet columns (death, howl, bite): its rows 0-3 are the
// diagonals; the in-between directions use the next diagonal clockwise.
//                    E(↘) SE(↓) S(↙) SW(←) W(↖) NW(↑) N(↗) NE(→)
const wolfDiagonalFacing = {
  rowByDir:          [1,   1,    2,   2,    3,   3,    0,   0],
  mirrorByDir: Array(8).fill(false),
};
const wolfRun = {sheet: "wolf", cols: colsFrom(0, 8), holds: holdsFromMs(Array(8).fill(70)),
  frameW: 64, frameH: 64, topToShadow: 39};
const frameDataBySpeciesAndPose = {
  wolf: {
    // TODO: walk and trot frames of their own (the artist drew only the run); here the
    // run, more slowly
    walk: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 },
    trot: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 5, topToShadow: 39 },
    gallop: wolfRun,
    idle: {sheet: "wolf", nFrames: 4, colZero: 8, frameW: 64, frameH: 64,
      holdTks: 12, topToShadow: 39 },
    // The swim frames already draw the waterline waterSurfaceDropPY below the ground
    // point, so the land's topToShadow puts the swimmer on the lower water surface.
    swim: {sheet: "wolf-swim", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 8, topToShadow: 39 },
    // mating, all but censored: standing, facing its partner (see HEARTS)
    mate: {sheet: "wolf", nFrames: 4, colZero: 8, frameW: 64, frameH: 64,
      holdTks: 12, topToShadow: 39 },
    // Plays exactly once in the simulation's death pose (attach checks this); the corpse
    // holds the last frame.
    death: {sheet: "wolf", nFrames: 11, colZero: 21, frameW: 64, frameH: 64,
      holdTks: 6, topToShadow: 39, ...wolfDiagonalFacing},
    dead: {sheet: "wolf", nFrames: 1, colZero: 32, frameW: 64, frameH: 64,
      holdTks: Infinity, topToShadow: 39, ...wolfDiagonalFacing},
    // not used yet
    howl: {sheet: "wolf", cols: colsFrom(12, 9), holds: holdsFromMs([100, 100, 100, 100, 100, 150, 500, 100, 100]),
      frameW: 64, frameH: 64, topToShadow: 39, ...wolfDiagonalFacing},
    bite: {sheet: "wolf", cols: colsFrom(33, 15),
      holds: holdsFromMs([100, 40, 40, 40, 40, 40, 40, 40, 40, 100, 100, 100, 100, 100, 20]),
      frameW: 64, frameH: 64, topToShadow: 39, ...wolfDiagonalFacing},
  },
  deer: {
    // (columns 10 and 44 are the preview's start and stop of a run, in no cycle)
    walk: {sheet: "deer", nFrames: 10, colZero: 0, frameW: 32, frameH: 41,
      holdTks: 6, topToShadow: 33},
    // standing, looking about, turning its head and lowering it, with a pause at each
    idle: {sheet: "deer", cols: deerIdleCols,
      holds: deerIdleCols.map(c => (c === 19 || c === 26 || c === 33 ? 30 : 6)),
      frameW: 32, frameH: 41, topToShadow: 33},
    // TODO: a trot of its own (this is the run cycle, as for the gallop)
    trot: {sheet: "deer", nFrames: 9, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 6, topToShadow: 33},
    gallop: {sheet: "deer", nFrames: 9, colZero: 35, frameW: 32, frameH: 41,
      holdTks: 6, topToShadow: 33},
    // standing and eating (sim's a.eating): lowers its head, then keeps it down
    graze: {sheet: "deer", cols: [32, 33], holds: [6, 30], loopFrom: 1,
      frameW: 32, frameH: 41, topToShadow: 33},
    mate: {sheet: "deer", nFrames: 1, colZero: 11, frameW: 32, frameH: 41,
      holdTks: Infinity, topToShadow: 33},
    // larger frames, to fit the ripple ring
    swim: {sheet: "deer-swim", nFrames: 10, colZero: 0, frameW: 40, frameH: 48,
      holdTks: 10, topToShadow: 33 },
    // Plays exactly once in the simulation's death pose (attach checks this). A corpse
    // with a carcass is drawn by drawCarcass instead of "dead".
    death: {sheet: "deer-death", nFrames: 5, colZero: 0, frameW: 48, frameH: 48,
      holdTks: 8, topToShadow: 40, ...deerDeathFacing},
    dead: {sheet: "deer-death", nFrames: 1, colZero: 4, frameW: 48, frameH: 48,
      holdTks: Infinity, topToShadow: 40, ...deerDeathFacing},
  }
};

// YOUNG STAGES: a critter is drawn from one of 5 versions of each sheet by its size class
// (sim.youngStage, see SIZES in sim.js): the adult's, or one of 4 shrunk to
// sim.youngScales (images/young/<sheet>-stage<k>.png, made by
// spritecraft/make_young_sheets.py; keep its scales in step). style.css sets each stage's
// images.

// ANTLERS: only a stag old enough to breed (sim.isGrown) has antlers. Every other deer is
// drawn from the antlerless sheets (images/hind-*.png, made by
// spritecraft/make_hind_sheets.py; class "hind"); the young stages are shrunk from those.
// (A deer reaches adult size before breeding age, so no grown stag is drawn young.)
function hasAntlers(a) {
  return a.species === "deer" && a.isMale && sim.isGrown(a);
}


// Sheet row and mirroring by direction (DIR_*), for species with a row per direction:
//            E(↘) SE(↓) S(↙) SW(←) W(↖) NW(↑) N(↗) NE(→)
// The wolf's rows: 0 ↗, 1 ↘, 2 ↙, 3 ↖, 4 ↑, 5 →, 6 ↓; ← is → mirrored.
const spriteRowByDir = {
  wolf: [1, 6, 2, 5, 3, 4, 0, 5],
};
const mirrorByDir = {
  wolf: [false, false, false, true, false, false, false, false],
};

function spriteRow(a) {
  const rows = spriteRowByDir[a.species];
  if (rows) return rows[a.currentDirection];
  // only the 4 diagonals drawn (the deer): the others borrow the next one clockwise
  return (Math.floor(a.currentDirection / 2) + 1) % 4;
}

// The sheet column to show, from how long the critter has been in its pose (or since
// sinceTick).
function frameColumn(a, fd, sinceTick = a.poseTick ?? 0) {
  const t = Math.max(0, sim.tickCount - sinceTick - 1); // 0 on the pose's first tick
  if (!fd.cols) return fd.colZero + Math.floor(t / fd.holdTks) % fd.nFrames;
  const from = fd.loopFrom ?? 0;
  if (fd.introTks === undefined) { // worked out on first use
    fd.introTks = fd.holds.slice(0, from).reduce((x, y) => x + y, 0);
    fd.loopTks = fd.holds.slice(from).reduce((x, y) => x + y, 0);
  }
  let left = t < fd.introTks ? t : fd.introTks + (t - fd.introTks) % fd.loopTks, k = 0;
  while (left >= fd.holds[k]) left -= fd.holds[k++];
  return fd.cols[k];
}

// DRAWING ORDER: tiles and sprites share one stacking order (z-index, which must be an
// integer). Depth = gx + gy, larger nearer the camera:
//   water tiles      i + j               lowest: the water surface is below all land
//   land tiles       1000 + 100 * depth  interleaved with swimmers, so land in front of
//   swimmers         1000 + 100 * depth  a swimmer covers it
//   land critters    100000 + 100 * depth  above all tiles
// A land tile's depth is its center's (i + j + 1); a swimmer counts half a tile further
// back, so only land clearly in front of it covers it.
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
const foodFillEl = el("food-meter-fill");
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

// CAMERA: shiftPX, shiftPY is the world pixel at the viewport's top-left at zoom 1; zoom
// scales about the viewport's center. It can be pinned to a critter (the player's wolf
// at first), following it, and its corpse if it dies; if it is gone altogether, the
// camera stays where it was. Pinned to the player's wolf (or its corpse), it moves to the
// player's next wolf when there is one. Panning unpins it.
// TODO: the pan limits assume zoom 1, so zoomed in you can't pan to the map's edges.
const zoomMin = 1;
const zoomMax = 8;
const camera = { shiftPX: 0, shiftPY: 0, zoom: 2 }; // starts a step in from the widest
let pinned = null; // the critter or corpse the camera follows
let playerWolf = null; // the player's wolf when the camera last looked
let viewportWidth = 0;
let viewportHeight = 0;
let drawnCameraKey = null; // the camera the tiles were last drawn for

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
  if (sim.pcWolf !== playerWolf) { // the player has a new wolf
    if (pinned === playerWolf) pinned = sim.pcWolf;
    playerWolf = sim.pcWolf;
  }
  if (pinned && !sim.allCritters.includes(pinned) && !sim.allCorpses.includes(pinned)) pinned = null;
  if (pinned) centerShiftOn(pinned.gx, pinned.gy);
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
  shoreTiles.clear();
}

// TODO: cache this; tiles coming into view ask for the same terrain again.
function getTileClassAt(i, j) {
  return sim.getTerrainAt(i, j);
}

// Creates the tiles in view and removes those out of it. It takes the grid rectangle
// around the viewport at zoom 1 (twice the tiles in view), which covers any higher zoom.
function renderVisibleTiles() {
  const { shiftPX, shiftPY } = camera;
  const cornerPs = [
    [shiftPX, shiftPY],
    [shiftPX + viewportWidth, shiftPY],
    [shiftPX, shiftPY + viewportHeight],
    [shiftPX + viewportWidth, shiftPY + viewportHeight]
  ];
  const cornerGs = cornerPs.map(pair => rectiProject(...pair));

  const iMin = Math.max(0, Math.floor(cornerGs[0][0]));
  const iMax = Math.min(sim.gridWidthN - 1, Math.floor(cornerGs[3][0]));
  const jMin = Math.max(0, Math.floor(cornerGs[1][1]));
  const jMax = Math.min(sim.gridHeightN - 1, Math.floor(cornerGs[2][1]));
  // and further down-screen, where raised ground can reach up into view
  const raisedRows = Math.ceil(sim.maxLevel * levelHeightPY / qtrTile);
  const iMaxRaised = Math.min(sim.gridWidthN - 1, iMax + raisedRows);
  const jMaxRaised = Math.min(sim.gridHeightN - 1, jMax + raisedRows);

  for (const [key, tile] of renderedTiles) {
    const [i, j] = key.split('_').map(Number);
    if (i < iMin || i > iMaxRaised || j < jMin || j > jMaxRaised) {
      tileLayer.removeChild(tile);
      renderedTiles.delete(key);
      shoreTiles.delete(tile);
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

// SHORES: water lapping at the land, drawn as an OUTGOING WAVE: a wave front running out
// from the land that always joins up, ending at land or carrying on into the next tile's
// wave, never stopping short in open water. Three sprite sets draw it, each set's
// columns being its animation frames:
//   STRAIGHT  tiles.png row 9, columns 0-1: light along one edge, the front parallel to it
//   CORNER    tiles.png row 9, columns 2-5: light in one corner, the front an arc around it
//   INTERIOR  images/shore-inner.png: light along two edges that meet, the front a V
// Which water tile gets which (shorePlacementAt), by the land along its edges:
//   one edge          STRAIGHT, light to it
//   two edges meeting INTERIOR, carrying the straight waves either side round the bend
//   two opposite      STRAIGHT, light to the side whose coast runs on furthest
//                     (shoreLookTiles each way), so neighbours along a channel agree
//   three edges       STRAIGHT, light to the middle one
//   none, but land beyond a corner   CORNER around it, if both neighbours beside that
//                     corner have a wave crossing to it, so a rectangle of land gets
//                     exactly 4 corners
//   otherwise         plain water
// Sprites are mirrored about the diamond's center, or for a corner on the left or right,
// taken from images/shore-rotated.png (a quarter turn no mirroring can make). One clock
// steps every shore together: every shoreFrameTicks of game time, 4-frame sets advance a
// frame and 2-frame sets hold each frame for two steps, so all loops stay in step.
// Water and placements are worked out once per tile and kept: the terrain never changes.
const shoreFrameTicks = 24;
const shoreLoopSteps = 4;       // steps in a loop (the corner set's frames)
const shoreSheetRowY = 9 * 32;  // y of row 9 in tiles.png
const shoreLookTiles = 3;
const shoreTiles = new Set();   // rendered shore tiles (they animate)

const shoreSets = {
  linear: { columns: [0, 1] },
  corner: { columns: [2, 3, 4, 5] },
  inner: { columns: [0, 1, 2, 3] }, // (columns of images/shore-inner.png)
};
// A tile's edges as drawn: TL top-left (grid W), TR top-right (N), BL bottom-left (S),
// BR bottom-right (E). Its corners, at grid vertices: T top (i, j), R right (i + 1, j),
// B bottom (i + 1, j + 1), L left (i, j + 1).
const edgeStep = { TL: [-1, 0], TR: [0, -1], BL: [0, 1], BR: [1, 0] };
const oppositeEdge = { TL: "BR", BR: "TL", TR: "BL", BL: "TR" };
const edgeCorners = { TL: ["L", "T"], TR: ["T", "R"], BR: ["R", "B"], BL: ["B", "L"] };
const cornerEdges = { T: ["TL", "TR"], R: ["TR", "BR"], B: ["BR", "BL"], L: ["BL", "TL"] };
const cornerVertex = { T: [0, 0], R: [1, 0], B: [1, 1], L: [0, 1] };
// the tile diagonally beyond each corner
const cornerStep = { T: [-1, -1], R: [1, -1], B: [1, 1], L: [-1, 1] };
// How each sprite is shown, by the edge (straight) or corner (corner, interior) its light
// is at.
const shoreVariants = {
  linear: {
    TR: { set: "linear", flipX: false, flipY: false, rotated: false },
    TL: { set: "linear", flipX: true,  flipY: false, rotated: false },
    BR: { set: "linear", flipX: false, flipY: true,  rotated: false },
    BL: { set: "linear", flipX: true,  flipY: true,  rotated: false },
  },
  corner: {
    T: { set: "corner", flipX: false, flipY: false, rotated: false },
    B: { set: "corner", flipX: false, flipY: true,  rotated: false },
    R: { set: "corner", flipX: false, flipY: false, rotated: true },
    L: { set: "corner", flipX: true,  flipY: false, rotated: true },
  },
  inner: { // row: of images/shore-inner.png
    T: { set: "inner", flipX: false, flipY: false, row: 0 },
    B: { set: "inner", flipX: false, flipY: true,  row: 0 },
    R: { set: "inner", flipX: false, flipY: false, row: 1 },
    L: { set: "inner", flipX: true,  flipY: false, row: 1 },
  },
};

// Whether tile (i, j) is water; off the map counts as water. Kept per tile: 0 unknown,
// 1 water, 2 land.
let waterKnown = null;
function isWaterAt(i, j) {
  if (i < 0 || j < 0 || i >= sim.gridWidthN || j >= sim.gridHeightN) return true;
  if (!waterKnown) waterKnown = new Uint8Array(sim.gridWidthN * sim.gridHeightN);
  const k = i * sim.gridHeightN + j;
  if (!waterKnown[k]) waterKnown[k] = sim.getTerrainAt(i, j) === "water" ? 1 : 2;
  return waterKnown[k] === 1;
}

// The edges of water tile (i, j) with land beyond them.
function landEdgesOf(i, j) {
  return ["TL", "TR", "BL", "BR"].filter(e => !isWaterAt(i + edgeStep[e][0], j + edgeStep[e][1]));
}

// How far the coast runs along edge e of water tile (i, j): the water tiles in line with
// it, up to shoreLookTiles each way, with land on that same side.
function coastRun(i, j, e) {
  const [di, dj] = edgeStep[e];
  let run = 0;
  for (const [ai, aj] of [[dj, di], [-dj, -di]]) { // the two ways along the edge
    for (let k = 1; k <= shoreLookTiles; k++) {
      const ni = i + ai * k, nj = j + aj * k;
      if (!isWaterAt(ni, nj) || isWaterAt(ni + di, nj + dj)) break;
      run++;
    }
  }
  return run;
}

// Where a placement's wave crosses its tile's edges: [edge, corner] pairs, "crosses this
// edge near this corner".
function waveCrossings(placement) {
  // a straight wave along edge e: crosses the edge beside each of e's corners
  const straight = e => edgeCorners[e].map(c => [cornerEdges[c].find(f => f !== e), c]);
  if (placement.kind === "straight") return straight(placement.edge);
  if (placement.kind === "inner") return cornerEdges[placement.corner].flatMap(straight); // both
  return cornerEdges[placement.corner].map(e => [e, placement.corner]); // around its corner
}

// Whether water tile (i, j)'s wave crosses its edge e near its corner c (as placed).
function waveCrossesAt(i, j, e, c) {
  const p = shorePlacementAt(i, j);
  return !!p && waveCrossings(p).some(([pe, pc]) => pe === e && pc === c);
}

// The same edge and grid vertex, as seen from the tile beyond edge e.
function acrossEdge(e, c) {
  const [di, dj] = edgeStep[e], [vi, vj] = cornerVertex[c];
  const v = [vi - di, vj - dj]; // the vertex in the other tile's terms
  const c2 = Object.keys(cornerVertex).find(k => cornerVertex[k][0] === v[0] && cornerVertex[k][1] === v[1]);
  return [oppositeEdge[e], c2];
}

// Water tile (i, j)'s wave: { kind: "straight", edge }, { kind: "corner" | "inner",
// corner }, or null for plain water.
const placements = new Map();
function shorePlacementAt(i, j) {
  const key = i * sim.gridHeightN + j;
  if (placements.has(key)) return placements.get(key);
  let p = null;
  if (isWaterAt(i, j) && i >= 0 && j >= 0 && i < sim.gridWidthN && j < sim.gridHeightN) {
    const land = landEdgesOf(i, j);
    if (land.length === 1) p = { kind: "straight", edge: land[0] };
    else if (land.length === 2 && land[0] !== oppositeEdge[land[1]]) {
      const corner = Object.keys(cornerEdges).find(c => cornerEdges[c].every(e => land.includes(e)));
      p = { kind: "inner", corner };
    } else if (land.length === 2) {
      // a channel (ties: the first side)
      const [a, b] = land;
      p = { kind: "straight", edge: coastRun(i, j, b) > coastRun(i, j, a) ? b : a };
    } else if (land.length === 3) {
      p = { kind: "straight", edge: land.find(e => land.includes(oppositeEdge[e]) === false) };
    } else if (land.length === 0) {
      // a point of land beyond a corner
      for (const c of ["T", "R", "B", "L"]) {
        const [si, sj] = cornerStep[c];
        if (isWaterAt(i + si, j + sj)) continue;
        const joins = cornerEdges[c].every(e => {
          const [ni, nj] = [i + edgeStep[e][0], j + edgeStep[e][1]];
          const [e2, c2] = acrossEdge(e, c);
          return landEdgesOf(ni, nj).length > 0 && waveCrossesAt(ni, nj, e2, c2);
        });
        if (joins) { p = { kind: "corner", corner: c }; break; }
      }
    }
  }
  placements.set(key, p);
  return p;
}

// The sprite to draw a tile's placement with, or null.
function shoreVariantAt(i, j) {
  const p = shorePlacementAt(i, j);
  if (!p) return null;
  if (p.kind === "straight") return shoreVariants.linear[p.edge];
  return shoreVariants[p.kind][p.corner];
}

// For tests: forget what is known about the terrain and draw it afresh.
function redrawTerrain() {
  waterKnown = null;
  placements.clear();
  clearAllRenderedTiles();
  drawnCameraKey = null;
  render();
}

const shoreFlipOrigin = "16px 24px"; // the water diamond's center in its 32 x 32 cell

function shoreClockNow() {
  return Math.floor(sim.tickCount / shoreFrameTicks);
}

function drawShoreTile(tile, clock) {
  const columns = shoreSets[tile.shore.set].columns;
  // the set's frame for this step of the loop
  const k = Math.floor((clock % shoreLoopSteps) * columns.length / shoreLoopSteps);
  if (k === tile.shoreFrame) return;
  tile.shoreFrame = k;
  // shore-rotated.png holds just the corner frames, in a row; shore-inner.png a row per
  // drawn notch
  tile.style.backgroundPosition = tile.shore.rotated ? `-${k * tileSize}px 0px`
    : tile.shore.set === "inner" ? `-${columns[k] * tileSize}px -${tile.shore.row * tileSize}px`
    : `-${columns[k] * tileSize}px -${shoreSheetRowY}px`;
}

let drawnShoreClock = -1;
function drawShores() {
  const clock = shoreClockNow();
  if (clock === drawnShoreClock) return; // new tiles start at the current frame
  drawnShoreClock = clock;
  for (const tile of shoreTiles) drawShoreTile(tile, clock);
}

// GROUND: each land tile is a column (images/ground-slopes.png, made by
// spritecraft/make_slope_tiles.py): its shape's sprite at its base level, with sides
// reaching one level below like a flat block, and riser strips below that down to the
// ground in front of it (a cliff). Painted back to front, the ground in front covers
// what is further down.
const groundRowByTerrain = { grass: 0, dirt: 1, stone: 2 }; // sheet rows
const grassRowByHeight = [5, 0, 3, 4]; // by sim.grassHeightAt: bare, short, medium, tall

function groundRowAt(i, j, terrain) {
  if (terrain === "grass") return grassRowByHeight[Math.max(0, sim.grassHeightAt(i, j))];
  return groundRowByTerrain[terrain];
}

// Redraws the tiles in view whose grass height has changed.
let grassSerial = 0;
function drawGrass() {
  const { serial, tiles } = sim.grassChangesSince(grassSerial);
  grassSerial = serial;
  const redraw = tiles || [...renderedTiles.keys()].map(k => k.split("_").map(Number));
  for (const [i, j] of redraw) {
    const key = `${i}_${j}`, old = renderedTiles.get(key);
    if (!old || (!tiles && sim.grassHeightAt(i, j) < 0)) continue;
    const tile = makeTileElement(i, j);
    tileLayer.replaceChild(tile, old);
    renderedTiles.set(key, tile);
  }
}
const groundCellW = 32, groundCellH = 40;
const groundBaseY = 16;    // y of the base plane's N corner within a shape cell
const riserCol = 15;       // sheet column of the one-level riser strip
// A boulder rests on its tile: row 25 of its 32 x 32 cell, its footprint's center, goes
// on the ground at the tile's center.
const boulderFootCenterY = 25;
// BOULDERS: each is one of the free-standing rocks in tiles.png, [column, row]: brown or
// grey. The colour goes with the ground under it (grey on stone, brown on dirt) and, on
// grass, a broad smooth field (rocks near each other, and along a wall, mostly share it);
// which rock of that colour, a hash of the tile. Like the terrain, a pure function of the
// tile: no random numbers, the same rock every time it is drawn.
const boulderSprites = {
  brown: [[9, 4], [10, 4], [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5]],
  grey: [[7, 5], [9, 5], [10, 5], [0, 6], [1, 6]],
};
const greyGrassAbove = 1.1; // of the colour field's 0..2 range: less than half the grass grey

function boulderSpriteAt(i, j, terrain) {
  const tri = x => 2 * Math.abs(x - Math.floor(x + 0.5)); // a triangle wave, 0..1
  const grey = terrain === "stone" || (terrain === "grass" && tri(i / 57 + 0.3) + tri(j / 49 + 0.6) > greyGrassAbove);
  const set = boulderSprites[grey ? "grey" : "brown"];
  let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return set[((h ^ (h >>> 15)) >>> 0) % set.length];
}

// The level a tile's front sides must reach down to, given the tile (i, j) in front of
// it: its lowest corner, or -1 for water and off the map (the water surface is drawn a
// level below level-0 land).
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

  if (terrain === "water") {
    tile.className = `tile ${terrain}`;
    tile.style.top = `${py - tileRiserPY}px`;
    const v = shoreVariantAt(i, j);
    if (v) {
      tile.shore = v;
      tile.shoreFrame = -1;
      if (v.rotated) tile.style.backgroundImage = "url('./images/shore-rotated.png')";
      if (v.set === "inner") tile.style.backgroundImage = "url('./images/shore-inner.png')";
      if (v.flipX || v.flipY) {
        tile.style.transformOrigin = shoreFlipOrigin;
        tile.style.transform = `scale(${v.flipX ? -1 : 1}, ${v.flipY ? -1 : 1})`;
      }
      shoreTiles.add(tile);
      drawShoreTile(tile, shoreClockNow());
    }
    return tile;
  }

  // the column's origin is its base plane's N corner, less half a tile in x
  const corners = sim.tileCorners(i, j);
  const base = Math.min(...corners);
  const shape = (corners[0] - base) | (corners[1] - base) << 1
    | (corners[2] - base) << 2 | (corners[3] - base) << 3;
  const row = groundRowAt(i, j, terrain);
  if (row === undefined) return alert(`animat: no ground sprites for terrain "${terrain}"`);
  tile.className = "ground-column";
  tile.style.top = `${py - base * levelHeightPY}px`;

  tile.appendChild(groundPiece(shape, row, -groundBaseY));
  const floor = Math.min(frontGroundLevel(i, j + 1), frontGroundLevel(i + 1, j));
  for (let k = 1; k <= base - 1 - floor; k++) {
    tile.appendChild(groundPiece(riserCol, row, k * levelHeightPY));
  }
  if (sim.obstacleAt(i, j) === "boulder") {
    const boulder = document.createElement("div");
    boulder.className = "tile boulder";
    const [col, row] = boulderSpriteAt(i, j, terrain);
    boulder.style.backgroundPosition = `-${col * tileSize}px -${row * tileSize}px`;
    // the tile's center on its surface, relative to the column's origin
    const centerAboveBase = (corners[0] + corners[1] + corners[2] + corners[3]) / 4 - base;
    const centerY = isoProject(0.5, 0.5)[1] - centerAboveBase * levelHeightPY;
    boulder.style.left = "0px";
    boulder.style.top = `${centerY - boulderFootCenterY}px`;
    tile.appendChild(boulder);
  }
  return tile;
}

// CRITTER SPRITES: one element per critter and corpse, by uid, for as long as it exists.
// TODO: keep elements only for critters in view.
const sprites = new Map(); // uid -> { node, css, critter }

function drawCritter(a) {
  let s = sprites.get(a.uid);
  if (!s) {
    s = { node: document.createElement("div"), css: {}, critter: a };
    spriteLayer.appendChild(s.node);
    sprites.set(a.uid, s);
  }
  if (a.kind === "corpse" && a.carcass) return drawCarcass(a, s);
  // a deer standing and eating is drawn grazing, timed from when it started
  const grazing = a.species === "deer" && a.pose === "idle" && a.eating;
  if (grazing && s.grazeSince === undefined) s.grazeSince = sim.tickCount - 1;
  if (!grazing) s.grazeSince = undefined;
  const fd = frameDataBySpeciesAndPose[a.species][grazing ? "graze" : a.pose];
  if (!fd) return alert(`animat: no sprite frames for ${a.species} pose "${a.pose}"`);

  const stage = sim.youngStage(a);
  const hind = a.species === "deer" && !stage && !hasAntlers(a);
  const className = "critter " + fd.sheet + (stage ? " stage" + stage : hind ? " hind" : "");
  if (s.node.className !== className) s.node.className = className;

  const frameCol = frameColumn(a, fd, grazing ? s.grazeSince : undefined);
  const row = fd.rowByDir ? fd.rowByDir[a.currentDirection] : spriteRow(a);
  setStyle(s.node, s.css, "backgroundPosition",
    `-${frameCol * fd.frameW}px -${row * fd.frameH}px`);
  // the element is centered on the critter, so mirroring keeps it in place
  const mirror = fd.mirrorByDir ? fd.mirrorByDir[a.currentDirection]
    : (mirrorByDir[a.species]?.[a.currentDirection] ?? false);
  setStyle(s.node, s.css, "transform", mirror ? "scaleX(-1)" : "");

  // the shadow's center on the critter's ground point
  const [isoX, isoY] = groundProject(a.gx, a.gy);
  const topOffset = fd.topToShadow ?? (fd.frameH / 2);
  setStyle(s.node, s.css, "left", `${isoX - fd.frameW / 2}px`);
  setStyle(s.node, s.css, "top", `${isoY - topOffset}px`);
  // (a fractional z-index is silently ignored)
  setStyle(s.node, s.css, "zIndex", String(spriteZIndex(a)));
}

// CARCASSES: 9 background layers of one element: the shadow, then each of the 8 pieces as
// meat while any is left, else as bones. images/deer-carcass.png (made by
// spritecraft/make_deer_carcass.py) has the shadow in column 0, then each piece's meat
// and bones, bottom layer to top in carcassSheetPieces order.
const carcassSheetPieces = ["groundHind", "groundFore", "hips", "midback", "chest", "head", "skyHind", "skyFore"];
const carcassFrame = 48, carcassTopToShadow = 40;

function drawCarcass(a, s) {
  if (s.node.className !== "critter deer-carcass") s.node.className = "critter deer-carcass";
  const row = deerDeathFacing.rowByDir[a.currentDirection];
  const layers = []; // top first
  for (let k = carcassSheetPieces.length - 1; k >= 0; k--) {
    layers.push(1 + 2 * k + (a.carcass[carcassSheetPieces[k]] > 0 ? 0 : 1));
  }
  layers.push(0); // the shadow, at the bottom
  const stage = sim.youngStage(a);
  const url = stage ? `url('./images/young/hind-carcass-stage${stage}.png')`
    : `url('./images/${hasAntlers(a) ? "deer" : "hind"}-carcass.png')`;
  setStyle(s.node, s.css, "backgroundImage", layers.map(() => url).join(", "));
  setStyle(s.node, s.css, "backgroundPosition",
    layers.map(col => `-${col * carcassFrame}px -${row * carcassFrame}px`).join(", "));
  setStyle(s.node, s.css, "transform", deerDeathFacing.mirrorByDir[a.currentDirection] ? "scaleX(-1)" : "");
  const [isoX, isoY] = groundProject(a.gx, a.gy);
  setStyle(s.node, s.css, "left", `${isoX - carcassFrame / 2}px`);
  setStyle(s.node, s.css, "top", `${isoY - carcassTopToShadow}px`);
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
  drawHearts();
}

// HEARTS: a pink heart (images/heart.png) between a mating pair, above both, rising and
// fading in and out over the act. One element per pair, keyed by the lower uid.
const heartW = 11, heartH = 10;
const heartFromPY = 18, heartRisePY = 22; // above the pair's ground points
const hearts = new Map(); // lower uid -> { node, css }

function drawHearts() {
  const now = new Set();
  for (const a of sim.allCritters) {
    if (a.pose !== "mate" || a.matingWith === null || a.uid > a.matingWith) continue;
    const b = sprites.get(a.matingWith)?.critter;
    if (!b) continue;
    now.add(a.uid);
    let h = hearts.get(a.uid);
    if (!h) {
      h = { node: document.createElement("div"), css: {} };
      h.node.className = "heart";
      spriteLayer.appendChild(h.node);
      hearts.set(a.uid, h);
    }
    const p = Math.min(1, Math.max(0, (sim.tickCount - a.poseTick) * sim.tempo / sim.mateActSBySpecies[a.species]));
    const [ax, ay] = groundProject(a.gx, a.gy), [bx, by] = groundProject(b.gx, b.gy);
    setStyle(h.node, h.css, "left", `${Math.round((ax + bx) / 2 - heartW / 2)}px`);
    setStyle(h.node, h.css, "top", `${Math.round((ay + by) / 2 - heartFromPY - heartRisePY * p - heartH)}px`);
    setStyle(h.node, h.css, "opacity", String(Math.min(1, p / 0.15, (1 - p) / 0.25).toFixed(2)));
    setStyle(h.node, h.css, "zIndex", String(Math.max(spriteZIndex(a), spriteZIndex(b)) + 1));
  }
  for (const [uid, h] of hearts) {
    if (!now.has(uid)) { h.node.remove(); hearts.delete(uid); }
  }
}

// DEBUG: a tile-sized outline centered on the player's wolf (on the water surface when
// it swims).
const debugWolfCss = {};
function drawDebugWolf() {
  const w = sim.pcWolf;
  const [isoX, isoY] = groundProject(w.gx, w.gy);
  const surfaceDrop = w.pose === "swim" ? waterSurfaceDropPY : 0;
  setStyle(debugWolfEl, debugWolfCss, "left", (isoX - halfTile) + "px");
  setStyle(debugWolfEl, debugWolfCss, "top", (isoY - qtrTile + surfaceDrop) + "px");
}

// METERS: the player's wolf's wind, stamina and food, a full bar when full. No labels:
// the game shows no words or numbers.
const windCss = {};
const staminaCss = {};
const foodCss = {};
function drawExertion() {
  setStyle(windFillEl, windCss, "width", `${100 * sim.pcWolf.wind}%`);
  setStyle(staminaFillEl, staminaCss, "width", `${100 * sim.pcWolf.stamina}%`);
  setStyle(foodFillEl, foodCss, "width", `${100 * sim.pcWolf.food}%`);
}

// Draws the whole view as the simulation is now: after every frame of ticks, and after
// any change to the view while paused.
function render() {
  drawCamera();
  drawGrass();
  drawShores();
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
  // TODO: tiles can still be briefly missing when zooming out and then panning.
  if (newZoom < camera.zoom) clearAllRenderedTiles();
  camera.zoom = newZoom;
  drawnCameraKey = null;
  updateZoomButtons();
  render();
}

function zoomIn() { setZoom(camera.zoom * 2); }
function zoomOut() { setZoom(camera.zoom / 2); }

// The camera, unpinned, moves by this many screen pixels at zoom 1.
function panCamera(dxPX, dyPX) {
  pinned = null;
  camera.shiftPX += dxPX;
  camera.shiftPY += dyPX;
}

// The camera, unpinned, centers on this grid point.
function centerCameraOn(gx, gy) {
  pinned = null;
  centerShiftOn(gx, gy);
  render();
}

// The camera follows critter a (or its corpse).
function pinCamera(a) {
  pinned = a;
  render();
}

// The camera stops following anything and stays where it is.
function unpinCamera() {
  pinned = null;
}

function followWolf() {
  pinCamera(sim.pcWolf);
}

// The critter or corpse drawn at a screen position (clientX/Y), or null: of the sprites
// there, the one whose middle is nearest (a sprite's frame is larger than its drawing).
function critterAtScreen(clientX, clientY) {
  let best = null, bestL2 = Infinity;
  for (const s of sprites.values()) {
    const r = s.node.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const l2 = (clientX - (r.left + r.right) / 2) ** 2 + (clientY - (r.top + r.bottom) / 2) ** 2;
    if (l2 < bestL2) { best = s.critter; bestL2 = l2; }
  }
  return best;
}

// The movement pad's knob and lit ring. vx, vy: the pointer's offset from the pad's
// center (1 at the outer ring); pose: its ring, or null when the pad isn't in use.
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

// DEBUG: the grid coordinates under the pointer (g null: not over the field).
function showCursorCoords(g) {
  cursorCoordsEl.textContent = g
    ? `x: ${g[0].toFixed(3)}, y: ${g[1].toFixed(3)}`
    : `x: –, y: –`;
}

function attach(theSim) {
  if (sim) return alert("animat.attach called twice");
  if (!theSim || typeof theSim.onFrame !== "function")
    return alert("animat.attach needs the simulation (load sim.js before animat.js)");
  sim = theSim;

  worldRadPX = halfTile + (sim.gridWidthN + sim.gridHeightN - 2) * qtrTile;
  worldDiamPY = worldRadPX;

  for (const [species, deathS] of Object.entries(sim.deathDurationSBySpecies)) {
    const d = frameDataBySpeciesAndPose[species].death;
    const ticks = d.cols ? d.holds.reduce((x, y) => x + y, 0) : d.nFrames * d.holdTks;
    if (Math.abs(ticks * sim.tempo - deathS) > 1e-9)
      return alert(`animat: ${species} death animation doesn't last sim's ${deathS} s`);
  }

  measureViewport();
  window.addEventListener("resize", () => { measureViewport(); render(); });
  showArrowMode(false);
  updateZoomButtons();
  pinned = playerWolf = sim.pcWolf;

  sim.onFrame(render);
  render();
}

return {
  attach, render,
  // view changes, for controls.js
  zoomIn, zoomOut, setZoom, panCamera, centerCameraOn, pinCamera, unpinCamera, followWolf,
  redrawTerrain, showMovePad, showArrowMode, showCursorCoords,
  // reading the view
  screenToGrid, screenDirToGridDir, screenVecToGridVec, isoProject, critterAtScreen,
  get camera() {
    return { ...camera, pinned, viewportWidth, viewportHeight, worldRadPX, zoomMin, zoomMax };
  },
  // for tests and debugging
  spriteEl: a => sprites.get(a.uid)?.node,
  heartEl: a => hearts.get(Math.min(a.uid, a.matingWith ?? a.uid))?.node,
  youngStage: a => sim.youngStage(a), hasAntlers,
  tileEl: (i, j) => renderedTiles.get(`${i}_${j}`),
  spriteRow, spriteZIndex, frameDataBySpeciesAndPose,
};

})();
