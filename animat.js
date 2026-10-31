// THE VIEW: everything the player sees. It draws the simulation's current state (tiles
// and critters on one canvas, the field; the meters, the movement pad's highlight and the
// debug readouts) and only ever reads the simulation.
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
//   sheet           its sheet (sheetImages: which image, by age and antlers)
//   frameW, frameH  a frame's size on the sheet
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
    // asleep: lying on its side, breathing (made from the corpse: extract_wolf_sheet.py);
    // not used while sleep is off
    // TODO: placeholder art, not canonical (admin/design_notes.md): real sleeping frames
    sleep: {sheet: "wolf", cols: [48, 49], holds: holdsFromMs([1400, 1000]), frameW: 64, frameH: 64,
      topToShadow: 39, ...wolfDiagonalFacing},
    // not used yet
    howl: {sheet: "wolf", cols: colsFrom(12, 9), holds: holdsFromMs([100, 100, 100, 100, 100, 150, 500, 100, 100]),
      frameW: 64, frameH: 64, topToShadow: 39, ...wolfDiagonalFacing},
    bite: {sheet: "wolf", cols: colsFrom(33, 15),
      holds: holdsFromMs([100, 40, 40, 40, 40, 40, 40, 40, 40, 100, 100, 100, 100, 100, 20]),
      frameW: 64, frameH: 64, topToShadow: 39, ...wolfDiagonalFacing},
  },
  deer: {
    // (columns 10 and 44 are the preview's start and stop of a run, in no cycle)
    walk: {sheet: "deer", nFrames: 10, colZero: 0, frameW: 48, frameH: 41,
      holdTks: 6, topToShadow: 33},
    // standing, looking about, turning its head and lowering it, with a pause at each
    idle: {sheet: "deer", cols: deerIdleCols,
      holds: deerIdleCols.map(c => (c === 19 || c === 26 || c === 33 ? 30 : 6)),
      frameW: 48, frameH: 41, topToShadow: 33},
    // TODO: a trot of its own (this is the run cycle, as for the gallop)
    trot: {sheet: "deer", nFrames: 9, colZero: 35, frameW: 48, frameH: 41,
      holdTks: 6, topToShadow: 33},
    gallop: {sheet: "deer", nFrames: 9, colZero: 35, frameW: 48, frameH: 41,
      holdTks: 6, topToShadow: 33},
    // standing and eating (sim's a.eating): lowers its head, then keeps it down
    graze: {sheet: "deer", cols: [32, 33], holds: [6, 30], loopFrom: 1,
      frameW: 48, frameH: 41, topToShadow: 33},
    mate: {sheet: "deer", nFrames: 1, colZero: 11, frameW: 48, frameH: 41,
      holdTks: Infinity, topToShadow: 33},
    // larger frames, to fit the ripple ring
    swim: {sheet: "deer-swim", nFrames: 10, colZero: 0, frameW: 48, frameH: 48,
      holdTks: 10, topToShadow: 33 },
    // Plays exactly once in the simulation's death pose (attach checks this). A corpse
    // with a carcass is drawn by drawCarcass instead of "dead".
    // TODO: the deer's death, carcass and sleep are AI-generated placeholders, not the
    // artist's, and not canonical (admin/design_notes.md): replace them.
    death: {sheet: "deer-death", nFrames: 5, colZero: 0, frameW: 48, frameH: 48,
      holdTks: 8, topToShadow: 40, ...deerDeathFacing},
    dead: {sheet: "deer-death", nFrames: 1, colZero: 4, frameW: 48, frameH: 48,
      holdTks: Infinity, topToShadow: 40, ...deerDeathFacing},
    // asleep: bedded down, legs folded, head up (the death's third frame); not used while
    // sleep is off
    sleep: {sheet: "deer-death", nFrames: 1, colZero: 2, frameW: 48, frameH: 48,
      holdTks: Infinity, topToShadow: 40, ...deerDeathFacing},
  }
};

// YOUNG STAGES: a critter is drawn from one of 5 versions of each sheet by its size class
// (sim.youngStage, see SIZES in sim.js): the adult's, or one of 4 shrunk to
// sim.youngScales (images/young/<sheet>-stage<k>.png, made by
// spritecraft/make_young_sheets.py; keep its scales in step): see sheetImages.

// ANTLERS: only a stag old enough to breed (sim.isGrown) has antlers. Every other deer is
// drawn from the antlerless sheets (images/hind-*.png, made by
// spritecraft/make_hind_sheets.py; class "hind"); the young stages are shrunk from those.
// (A deer reaches adult size before breeding age, so no grown stag is drawn young.)
function hasAntlers(a) {
  return a.species === "deer" && a.isMale && sim.isGrown(a);
}


// Sheet row and mirroring by direction (DIR_*), for species with a row per direction:
//            E(↘) SE(↓) S(↙) SW(←) W(↖) NW(↑) N(↗) NE(→)
// The wolf's and the deer's rows: 0 ↗, 1 ↘, 2 ↙, 3 ↖, 4 ↑, 5 →, 6 ↓; ← is → mirrored.
// (The deer's rows 4-6 are drawn by spritecraft/deer_facings.py: placeholder art, not
// canonical, admin/design_notes.md.)
const spriteRowByDir = {
  wolf: [1, 6, 2, 5, 3, 4, 0, 5],
  deer: [1, 6, 2, 5, 3, 4, 0, 5],
};
const mirrorByDir = {
  wolf: [false, false, false, true, false, false, false, false],
  deer: [false, false, false, true, false, false, false, false],
};

function spriteRow(a) {
  const rows = spriteRowByDir[a.species];
  if (rows) return rows[a.currentDirection];
  // a species drawn only on the 4 diagonals: the others borrow the next one clockwise
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

// DRAWING ORDER (as painted, back to front; depth = gx + gy, larger nearer the camera):
//   1. water tiles, below all land (the water surface is below all land)
//   2. land tiles, and swimmers among them: land in front of a swimmer covers it. Depth
//      order (z): a land tile 1000 + 100 * depth of its center (i + j + 1), a swimmer
//      1000 + 100 * (depth + 0.5), so only land clearly in front of it covers it
//   3. land critters and corpses (100000 + 100 * depth) and boulders (100000 + 100 * their
//      tile center's depth), in depth order; on a tie a boulder first; a heart over its pair
//   4. the debug outline
// spriteZIndex and the tiles' z keep these numbers (as the DOM view's z-indexes were).
const zSwimLandBase = 1000;
const zLandCritterBase = 100000;

function tileZIndex(i, j, terrain) {
  if (terrain === "water") return i + j;
  return zSwimLandBase + (i + j + 1) * 100;
}

function boulderZIndex(i, j) {
  return zLandCritterBase + (i + j + 1) * 100;
}

function spriteZIndex(a) {
  const depth = a.gx + a.gy;
  if (a.pose === "swim") return zSwimLandBase + Math.round((depth + 0.5) * 100);
  return zLandCritterBase + Math.round(depth * 100);
}

// DOM: the field is one canvas; the sidebar and the movement pad are elements.
const el = id => document.getElementById(id);
const fieldWrapper = el("field-wrapper");
const canvas = el("field-canvas");
const ctx = canvas.getContext("2d");
const backgroundColor = "#9dd4f3"; // beyond the map
const windFillEl = el("wind-meter-fill");
const staminaFillEl = el("stamina-meter-fill");
const foodFillEl = el("food-meter-fill");
const gutFillEl = el("gut-meter-fill");
const inspectPanelEl = el("inspect-panel");
const inspectFillEls = ["wind", "stamina", "food", "gut"].map(m => el(`inspect-${m}-fill`));
const zoomInBtn = el("zoom-in");
const zoomOutBtn = el("zoom-out");
const arrowsIconEl = el("arrow-mode-icon");
const cursorCoordsEl = el("cursor-coords");
const movePadKnob = el("move-pad-knob");
const movePadRingEls = [...document.querySelectorAll("#move-pad .ring")];

// Writes a style property only when it changes (the meters are updated every frame).
function setStyle(node, cache, prop, value) {
  if (cache[prop] === value) return;
  cache[prop] = value;
  node.style[prop] = value;
}

// IMAGES: every sheet, loaded once by its path. Anything drawn before its image has loaded
// is drawn again once it has, on the next frame (the terrain's chunks painted afresh, for
// the terrain's sheets: see CHUNKS).
const images = new Map(); // path -> HTMLImageElement
let redrawPending = false;
function image(path) {
  let im = images.get(path);
  if (!im) {
    im = new Image();
    im.onload = () => {
      if (terrainImages.includes(path)) clearChunks();
      if (!sim || redrawPending) return;
      redrawPending = true;
      requestAnimationFrame(() => { redrawPending = false; render(); });
    };
    im.src = path;
    images.set(path, im);
  }
  return im;
}
const IMG = "./images/";
// Critter sheets, by the sheet named in frameDataBySpeciesAndPose: the grown animal's (a
// stag's, for deer), an antlerless deer's (see ANTLERS) and the young stages' prefix (see
// YOUNG STAGES); the frame sizes are frameDataBySpeciesAndPose's.
const sheetImages = {
  "wolf":         { adult: "wolf-land.png",    young: "young/wolf-land-stage" },
  "wolf-swim":    { adult: "wolf-swim.png",    young: "young/wolf-swim-stage" },
  "deer":         { adult: "stag-land.png",    hind: "hind-land.png",    young: "young/hind-land-stage" },
  "deer-swim":    { adult: "stag-swim.png",    hind: "hind-swim.png",    young: "young/hind-swim-stage" },
  "deer-death":   { adult: "stag-death.png",   hind: "hind-death.png",   young: "young/hind-death-stage" },
  "deer-carcass": { adult: "deer-carcass.png", hind: "hind-carcass.png", young: "young/hind-carcass-stage" },
};
function sheetImage(sheet, stage, hind) {
  const s = sheetImages[sheet];
  return IMG + (stage ? `${s.young}${stage}.png` : hind && s.hind ? s.hind : s.adult);
}
const tilesImage = IMG + "tiles.png";
const groundImage = IMG + "ground-slopes.png";
const shoreRotatedImage = IMG + "shore-rotated.png";
const shoreInnerImage = IMG + "shore-inner.png";
const heartImage = IMG + "heart.png";
const debugTileImage = IMG + "debug-tile.png";
const waterCell = [192, 288]; // plain water in tiles.png
const terrainImages = [tilesImage, groundImage, shoreRotatedImage, shoreInnerImage];

// PAINTING: a target is a 2D context and how world pixels map to its pixels: x * A + Bx,
// y * A + By. Pixel art is scaled without smoothing, and every cell lands on whole pixels.
// drawCell paints a cell of an image (sx, sy, sw, sh) with its top-left at world (left,
// top), mirrored if asked about the cell's point (ox, oy) (by default its middle).
function drawCell(t, img, sx, sy, sw, sh, left, top, flipX = false, flipY = false, ox = sw / 2, oy = sh / 2) {
  const fx = flipX ? -1 : 1, fy = flipY ? -1 : 1;
  const x0 = left + ox - fx * ox, y0 = top + oy - fy * oy; // where the cell's (0, 0) goes
  t.ctx.setTransform(fx * t.A, 0, 0, fy * t.A, Math.round(x0 * t.A + t.Bx), Math.round(y0 * t.A + t.By));
  t.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
}

// CAMERA: shiftPX, shiftPY is the world pixel at the viewport's top-left at zoom 1; zoom
// scales about the viewport's center. It can be pinned to a critter (the player's wolf
// at first), following it, and its corpse if it dies; if it is gone altogether, the
// camera stays where it was. Pinned to the player's wolf (or its corpse), it moves to the
// player's next wolf when there is one. Panning unpins it. At any zoom it pans as far as
// brings the map's edges to the viewport's edges (panLimits).
const zoomMin = 1;
const zoomMax = 8;
const camera = { shiftPX: 0, shiftPY: 0, zoom: 2 }; // starts a step in from the widest
let pinned = null; // the critter or corpse the camera follows
let playerWolf = null; // the player's wolf when the camera last looked
let viewportWidth = 0;
let viewportHeight = 0;
let dpr = 1;       // device pixels a CSS pixel
let screen = null; // the canvas as a target (see PAINTING), for this frame's camera
let view = null;   // the world rectangle in view: { x0, y0, x1, y1 }

function measureViewport() {
  viewportWidth = fieldWrapper.clientWidth;
  viewportHeight = fieldWrapper.clientHeight;
  dpr = window.devicePixelRatio || 1;
  const w = Math.round(viewportWidth * dpr), h = Math.round(viewportHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.style.width = `${viewportWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
}

function centerShiftOn(gx, gy) {
  const [px, py] = groundProject(gx, gy);
  camera.shiftPX = px - viewportWidth / 2;
  camera.shiftPY = py - viewportHeight / 2;
}

// The shifts that put the map's edges at the viewport's: zoom scales about the viewport's
// center, so the world in view is that center's, plus or minus half the viewport over
// the zoom.
function panLimits() {
  const halfW = viewportWidth / 2, halfH = viewportHeight / 2;
  const seenW = halfW / camera.zoom, seenH = halfH / camera.zoom;
  return {
    minX: -worldRadPX - halfW + seenW, maxX: worldRadPX - halfW - seenW,
    minY: -halfH + seenH, maxY: worldDiamPY + tileRiserPY - halfH - seenH,
  };
}

function drawCamera() {
  if (sim.pcWolf !== playerWolf) { // the player has a new wolf
    if (pinned === playerWolf) pinned = sim.pcWolf;
    playerWolf = sim.pcWolf;
  }
  if (pinned && !sim.allCritters.includes(pinned) && !sim.allCorpses.includes(pinned)) pinned = null;
  if (pinned) centerShiftOn(pinned.gx, pinned.gy);
  const lim = panLimits();
  camera.shiftPX = boundVal(camera.shiftPX, lim.minX, lim.maxX);
  camera.shiftPY = boundVal(camera.shiftPY, lim.minY, lim.maxY);
  const z = camera.zoom, cx = camera.shiftPX + viewportWidth / 2, cy = camera.shiftPY + viewportHeight / 2;
  const A = z * dpr;
  screen = { ctx, A, Bx: Math.round(dpr * (viewportWidth / 2) - cx * A), By: Math.round(dpr * (viewportHeight / 2) - cy * A) };
  view = { x0: cx - viewportWidth / 2 / z, x1: cx + viewportWidth / 2 / z, y0: cy - viewportHeight / 2 / z, y1: cy + viewportHeight / 2 / z };
}

// Whether a world rectangle is in view.
function inView(left, top, w, h) {
  return left < view.x1 && left + w > view.x0 && top < view.y1 && top + h > view.y0;
}

// Where world pixel (px, py) is on the page (client coordinates).
function worldToScreen(px, py) {
  const r = canvas.getBoundingClientRect();
  return [r.left + (px * screen.A + screen.Bx) / dpr, r.top + (py * screen.A + screen.By) / dpr];
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
  clearChunks();
  render();
}

const shoreFlipOrigin = [16, 24]; // the water diamond's center in its 32 x 32 cell

function shoreClockNow() {
  return Math.floor(sim.tickCount / shoreFrameTicks);
}

// A water tile's cell at shore clock `clock`: { image, sx, sy, flipX, flipY } (see SHORES).
function waterCellAt(i, j, clock) {
  const v = shoreVariantAt(i, j);
  if (!v) return { image: tilesImage, sx: waterCell[0], sy: waterCell[1], flipX: false, flipY: false };
  const columns = shoreSets[v.set].columns;
  // the set's frame for this step of the loop
  const k = Math.floor((clock % shoreLoopSteps) * columns.length / shoreLoopSteps);
  // shore-rotated.png holds just the corner frames, in a row; shore-inner.png a row per
  // drawn notch
  if (v.rotated) return { image: shoreRotatedImage, sx: k * tileSize, sy: 0, flipX: v.flipX, flipY: v.flipY, shore: v, frame: k };
  if (v.set === "inner") return { image: shoreInnerImage, sx: columns[k] * tileSize, sy: v.row * tileSize, flipX: v.flipX, flipY: v.flipY, shore: v, frame: k };
  return { image: tilesImage, sx: columns[k] * tileSize, sy: shoreSheetRowY, flipX: v.flipX, flipY: v.flipY, shore: v, frame: k };
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

// What tile (i, j) is drawn as: { i, j, kind, left, top (its cell's, or its column's origin:
// world px), z, ... }. Water: kind "water", its cell (waterCellAt) at the shore clock. Land:
// kind "ground", its column's pieces (ground-slopes.png cells: { col, row, top below the
// origin }) and its boulder if any ({ col, row (tiles.png cells), left, top, z }).
function describeTile(i, j, clock = shoreClockNow()) {
  const terrain = sim.getTerrainAt(i, j);
  const [px, py] = isoProject(i, j);
  if (terrain === "water") {
    return { i, j, kind: "water", terrain, left: px - halfTile, top: py - tileRiserPY, z: tileZIndex(i, j, terrain),
      ...waterCellAt(i, j, clock) };
  }
  // the column's origin is its base plane's N corner, less half a tile in x
  const corners = sim.tileCorners(i, j);
  const base = Math.min(...corners);
  const shape = (corners[0] - base) | (corners[1] - base) << 1
    | (corners[2] - base) << 2 | (corners[3] - base) << 3;
  const row = groundRowAt(i, j, terrain);
  if (row === undefined) return alert(`animat: no ground sprites for terrain "${terrain}"`);
  const t = { i, j, kind: "ground", terrain, left: px - halfTile, top: py - base * levelHeightPY,
    z: tileZIndex(i, j, terrain), pieces: [{ col: shape, row, top: -groundBaseY }], boulder: null };
  const floor = Math.min(frontGroundLevel(i, j + 1), frontGroundLevel(i + 1, j));
  for (let k = 1; k <= base - 1 - floor; k++) t.pieces.push({ col: riserCol, row, top: k * levelHeightPY });
  if (sim.obstacleAt(i, j) === "boulder") {
    // drawn among the critters (see DRAWING ORDER), its foot on the tile's center
    const [col, brow] = boulderSpriteAt(i, j, terrain);
    const centerAboveBase = (corners[0] + corners[1] + corners[2] + corners[3]) / 4 - base;
    const centerY = isoProject(0.5, 0.5)[1] - centerAboveBase * levelHeightPY;
    t.boulder = { col, row: brow, left: t.left, top: t.top + centerY - boulderFootCenterY, z: boulderZIndex(i, j) };
  }
  return t;
}

function paintWater(target, t) {
  drawCell(target, image(t.image), t.sx, t.sy, tileSize, tileSize, t.left, t.top, t.flipX, t.flipY, ...shoreFlipOrigin);
}

function paintColumn(target, t) {
  const img = image(groundImage);
  for (const p of t.pieces)
    drawCell(target, img, p.col * groundCellW, p.row * groundCellH, groundCellW, groundCellH, t.left, t.top + p.top);
}

function paintBoulder(target, b) {
  drawCell(target, image(tilesImage), b.col * tileSize, b.row * tileSize, tileSize, tileSize, b.left, b.top);
}

// CHUNKS: the terrain is painted once into canvases of chunkTiles x chunkTiles tiles, two
// a chunk (its water, its land), and those are painted each frame. A chunk is painted
// afresh when its grass changes height (land), when the shores step (water with shores),
// or when an image loads; chunks out of view for chunkKeepFrames frames are dropped.
// PAINTED BACK TO FRONT: within a chunk, tiles by depth (i + j); chunks by i + j of their
// own (a tile in front of another that it can cover is never in a chunk painted before
// it). All water before all land.
const chunkTiles = 16;
const chunkKeepFrames = 120;
const chunks = new Map(); // ci * 10000 + cj -> chunk
let frameCount = 0;

function clearChunks() {
  for (const c of chunks.values()) for (const k of ["water", "land"]) if (c[k]) c[k].width = 0;
  chunks.clear();
}

// Chunk (ci, cj): its tiles' world bounds (every pixel they can paint), and its layers.
function chunkAt(ci, cj) {
  const key = ci * 10000 + cj;
  let c = chunks.get(key);
  if (c) return c;
  const i0 = ci * chunkTiles, j0 = cj * chunkTiles;
  const i1 = Math.min(sim.gridWidthN, i0 + chunkTiles) - 1, j1 = Math.min(sim.gridHeightN, j0 + chunkTiles) - 1;
  const x0 = (i0 - j1) * halfTile - halfTile, x1 = (i1 - j0) * halfTile + halfTile;
  const y0 = (i0 + j0) * qtrTile - sim.maxLevel * levelHeightPY - groundBaseY - tileRiserPY;
  const y1 = (i1 + j1) * qtrTile + groundCellH + tileRiserPY;
  c = { ci, cj, i0, j0, i1, j1, x0, y0, w: x1 - x0, h: y1 - y0, water: null, land: null,
    hasWater: false, hasLand: false, shores: false, waterClock: -1, landDirty: true, boulders: [], used: 0, scanned: false };
  chunks.set(key, c);
  return c;
}

function forEachChunkTile(c, f) {
  for (let s = c.i0 + c.j0; s <= c.i1 + c.j1; s++)
    for (let i = Math.max(c.i0, s - c.j1); i <= Math.min(c.i1, s - c.j0); i++) f(i, s - i);
}

function newLayer(c) {
  const cv = document.createElement("canvas");
  cv.width = c.w; cv.height = c.h;
  return cv;
}

// Paints chunk c's layers that are out of date.
function paintChunk(c, clock) {
  if (!c.scanned) {
    c.scanned = true;
    forEachChunkTile(c, (i, j) => {
      if (sim.getTerrainAt(i, j) === "water") { c.hasWater = true; if (shoreVariantAt(i, j)) c.shores = true; }
      else c.hasLand = true;
    });
  }
  const at = cv => ({ ctx: cv.getContext("2d"), A: 1, Bx: -c.x0, By: -c.y0 });
  if (c.hasWater && (c.waterClock < 0 || (c.shores && c.waterClock !== clock))) {
    if (!c.water) c.water = newLayer(c);
    const t = at(c.water);
    t.ctx.setTransform(1, 0, 0, 1, 0, 0); t.ctx.clearRect(0, 0, c.w, c.h);
    forEachChunkTile(c, (i, j) => { if (sim.getTerrainAt(i, j) === "water") paintWater(t, describeTile(i, j, clock)); });
    c.waterClock = clock;
  }
  if (c.hasLand && c.landDirty) {
    if (!c.land) c.land = newLayer(c);
    const t = at(c.land);
    t.ctx.setTransform(1, 0, 0, 1, 0, 0); t.ctx.clearRect(0, 0, c.w, c.h);
    c.boulders = [];
    forEachChunkTile(c, (i, j) => {
      if (sim.getTerrainAt(i, j) === "water") return;
      const d = describeTile(i, j, clock);
      paintColumn(t, d);
      if (d.boulder) c.boulders.push(d.boulder);
    });
    c.landDirty = false;
  }
}

// The chunks in view, back to front.
function chunksInView() {
  // the grid rectangle around the view, and further down-screen, where raised ground can
  // reach up into view
  const g = [[view.x0, view.y0], [view.x1, view.y0], [view.x0, view.y1], [view.x1, view.y1]].map(p => rectiProject(...p));
  const raised = Math.ceil(sim.maxLevel * levelHeightPY / qtrTile) + 2;
  const n = chunkTiles;
  const ciMin = Math.max(0, Math.floor((g[0][0] - 2) / n)), ciMax = Math.min(Math.ceil(sim.gridWidthN / n) - 1, Math.floor((g[3][0] + raised) / n));
  const cjMin = Math.max(0, Math.floor((g[1][1] - 2) / n)), cjMax = Math.min(Math.ceil(sim.gridHeightN / n) - 1, Math.floor((g[2][1] + raised) / n));
  const out = [];
  for (let s = ciMin + cjMin; s <= ciMax + cjMax; s++)
    for (let ci = Math.max(ciMin, s - cjMax); ci <= Math.min(ciMax, s - cjMin); ci++) {
      const c = chunkAt(ci, s - ci);
      if (inView(c.x0, c.y0, c.w, c.h)) out.push(c);
    }
  return out;
}

// Marks the chunks whose grass changed height for painting afresh.
let grassSerial = 0;
function noteGrass() {
  const { serial, tiles } = sim.grassChangesSince(grassSerial);
  grassSerial = serial;
  if (!tiles) { for (const c of chunks.values()) c.landDirty = true; return; }
  for (const [i, j] of tiles) {
    const c = chunks.get(Math.floor(i / chunkTiles) * 10000 + Math.floor(j / chunkTiles));
    if (c) c.landDirty = true;
  }
}

function paintChunkLayer(c, layer) {
  if (!c[layer]) return;
  ctx.setTransform(screen.A, 0, 0, screen.A, Math.round(c.x0 * screen.A + screen.Bx), Math.round(c.y0 * screen.A + screen.By));
  ctx.drawImage(c[layer], 0, 0);
}

// The tiles in view, as drawn (describeTile), for tests.
function tilesInView() {
  const out = [];
  for (const c of chunksInView()) forEachChunkTile(c, (i, j) => {
    const t = describeTile(i, j);
    const h = t.kind === "water" ? tileSize : t.pieces.at(-1).top + groundCellH + groundBaseY;
    if (inView(t.left, t.top - (t.kind === "water" ? 0 : groundBaseY), tileSize, h)) out.push(t);
  });
  return out;
}

// CRITTER SPRITES: what each critter and corpse is drawn as this frame (describeCritter):
// { uid, critter, sheet (frameDataBySpeciesAndPose's, or "deer-carcass"), stage, hind,
// cls (all three in one: "critter <sheet>", and " stage<k>" or " hind"; a carcass just
// "critter deer-carcass"), image, col, row, w, h, left, top (world px of its frame), mirror
// (about the frame's middle), z, swim (drawn among the land tiles), layers (a carcass's
// columns, top first) }.
// Kept per uid while the critter or corpse exists (spriteOf), with what a deer grazing
// started at (s.grazeSince).
const sprites = new Map(); // uid -> { rec, grazeSince }
let showOnlySet = null;    // for tests: draw only these critters (null: all)

function describeCritter(a, s) {
  if (a.kind === "corpse" && a.carcass) return describeCarcass(a);
  // a deer standing and eating is drawn grazing, timed from when it started
  const grazing = a.species === "deer" && a.pose === "idle" && a.eating;
  if (grazing && s.grazeSince === undefined) s.grazeSince = sim.tickCount - 1;
  if (!grazing) s.grazeSince = undefined;
  const fd = frameDataBySpeciesAndPose[a.species][grazing ? "graze" : a.pose];
  if (!fd) return alert(`animat: no sprite frames for ${a.species} pose "${a.pose}"`);
  const stage = sim.youngStage(a);
  const hind = a.species === "deer" && !stage && !hasAntlers(a);
  const col = frameColumn(a, fd, grazing ? s.grazeSince : undefined);
  const row = fd.rowByDir ? fd.rowByDir[a.currentDirection] : spriteRow(a);
  const mirror = fd.mirrorByDir ? fd.mirrorByDir[a.currentDirection]
    : (mirrorByDir[a.species]?.[a.currentDirection] ?? false);
  // the shadow's center on the critter's ground point
  const [isoX, isoY] = groundProject(a.gx, a.gy);
  const topOffset = fd.topToShadow ?? (fd.frameH / 2);
  return { uid: a.uid, critter: a, sheet: fd.sheet, stage, hind, image: sheetImage(fd.sheet, stage, hind),
    cls: "critter " + fd.sheet + (stage ? " stage" + stage : hind ? " hind" : ""),
    col, row, w: fd.frameW, h: fd.frameH, left: isoX - fd.frameW / 2, top: isoY - topOffset, mirror,
    z: spriteZIndex(a), swim: a.pose === "swim", layers: null };
}

// CARCASSES: 9 layers: the shadow, then each of the 8 pieces as meat while any is left,
// else as bones. images/deer-carcass.png (made by spritecraft/make_deer_carcass.py) has
// the shadow in column 0, then each piece's meat and bones, bottom layer to top in
// carcassSheetPieces order.
const carcassSheetPieces = ["groundHind", "groundFore", "hips", "midback", "chest", "head", "skyHind", "skyFore"];
const carcassFrame = 48, carcassTopToShadow = 40;

function describeCarcass(a) {
  const layers = []; // top first
  for (let k = carcassSheetPieces.length - 1; k >= 0; k--) {
    layers.push(1 + 2 * k + (sim.carcassPieceKg(a, carcassSheetPieces[k]) > 0 ? 0 : 1));
  }
  layers.push(0); // the shadow, at the bottom
  const stage = sim.youngStage(a), hind = !hasAntlers(a);
  const [isoX, isoY] = groundProject(a.gx, a.gy);
  return { uid: a.uid, critter: a, sheet: "deer-carcass", stage, hind, image: sheetImage("deer-carcass", stage, hind),
    cls: "critter deer-carcass",
    col: layers[0], row: deerDeathFacing.rowByDir[a.currentDirection], w: carcassFrame, h: carcassFrame,
    left: isoX - carcassFrame / 2, top: isoY - carcassTopToShadow,
    mirror: deerDeathFacing.mirrorByDir[a.currentDirection], z: spriteZIndex(a), swim: false, layers };
}

function paintSprite(target, r) {
  const img = image(r.image);
  for (const col of r.layers ? [...r.layers].reverse() : [r.col])
    drawCell(target, img, col * r.w, r.row * r.h, r.w, r.h, r.left, r.top, r.mirror);
}

// This frame's sprites, for every critter and corpse.
function describeCritters() {
  const present = new Set();
  for (const list of [sim.allCritters, sim.allCorpses]) {
    for (const a of list) {
      present.add(a.uid);
      let s = sprites.get(a.uid);
      if (!s) { s = { rec: null, grazeSince: undefined }; sprites.set(a.uid, s); }
      s.rec = describeCritter(a, s);
    }
  }
  for (const uid of sprites.keys()) if (!present.has(uid)) sprites.delete(uid);
}

// HEARTS: a pink heart (images/heart.png) between a mating pair, above both, rising and
// fading in and out over the act; keyed by the pair's lower uid: { left, top, opacity, z }.
const heartW = 11, heartH = 10;
const heartFromPY = 18, heartRisePY = 22; // above the pair's ground points
const hearts = new Map(); // lower uid -> heart

function describeHearts() {
  hearts.clear();
  for (const a of sim.allCritters) {
    if (a.pose !== "mate" || a.matingWith === null || a.uid > a.matingWith) continue;
    const b = sprites.get(a.matingWith)?.rec?.critter;
    if (!b) continue;
    const p = Math.min(1, Math.max(0, (sim.tickCount - a.poseTick) * sim.tempo / sim.mateActSBySpecies[a.species]));
    const [ax, ay] = groundProject(a.gx, a.gy), [bx, by] = groundProject(b.gx, b.gy);
    hearts.set(a.uid, { left: Math.round((ax + bx) / 2 - heartW / 2),
      top: Math.round((ay + by) / 2 - heartFromPY - heartRisePY * p - heartH),
      opacity: +Math.min(1, p / 0.15, (1 - p) / 0.25).toFixed(2),
      z: Math.max(spriteZIndex(a), spriteZIndex(b)) + 1 });
  }
}

function paintHeart(target, h) {
  target.ctx.globalAlpha = Math.max(0, h.opacity);
  drawCell(target, image(heartImage), 0, 0, heartW, heartH, h.left, h.top);
  target.ctx.globalAlpha = 1;
}

// DEBUG: a tile-sized outline centered on the player's wolf (on the water surface when
// it swims).
let showDebug = true;
function paintDebugWolf() {
  const w = sim.pcWolf;
  const [isoX, isoY] = groundProject(w.gx, w.gy);
  const surfaceDrop = w.pose === "swim" ? waterSurfaceDropPY : 0;
  drawCell(screen, image(debugTileImage), 0, 0, tileSize, halfTile, isoX - halfTile, isoY - qtrTile + surfaceDrop);
}

// Swimmer r, then the land in front of it that covers it (see DRAWING ORDER): the tiles
// nearer the camera, in the screen columns it spans, whose columns reach up over it.
function paintSwimmer(r) {
  paintSprite(screen, r);
  const a = r.critter, d0 = Math.floor(a.gx + a.gy);
  const rows = Math.ceil((sim.maxLevel * levelHeightPY + groundBaseY + r.h) / qtrTile) + 2;
  // m = i - j: the screen columns the sprite spans (a tile spans (m -+ 1) * halfTile)
  const mMin = Math.floor(r.left / halfTile) - 1, mMax = Math.ceil((r.left + r.w) / halfTile) + 1;
  for (let d = d0 - 1; d <= d0 + rows; d++) {
    for (let m = mMin; m <= mMax; m++) {
      if ((d + m) & 1) continue;
      const i = (d + m) / 2, j = (d - m) / 2;
      if (i < 0 || j < 0 || i >= sim.gridWidthN || j >= sim.gridHeightN) continue;
      if (tileZIndex(i, j, "land") <= r.z || sim.getTerrainAt(i, j) === "water") continue;
      const t = describeTile(i, j);
      const top = t.top - groundBaseY, h = t.pieces.at(-1).top + groundCellH + groundBaseY;
      if (t.left < r.left + r.w && t.left + tileSize > r.left && top < r.top + r.h && top + h > r.top) paintColumn(screen, t);
    }
  }
}

// METERS: the player's wolf's wind, stamina and food: its body's (a.food) on the left,
// its stomach's (a.gut) on the right (see BODY in sim.js), a full bar when full. No labels:
// the game shows no words or numbers. INSPECTING: while the camera follows another
// critter (or its corpse), that critter's meters show below, under an eye.
const windCss = {};
const staminaCss = {};
const foodCss = {};
const gutCss = {};
const inspectCss = [{}, {}, {}, {}];
let inspectShown = false;
function drawExertion() {
  setStyle(windFillEl, windCss, "width", `${100 * sim.pcWolf.wind}%`);
  setStyle(staminaFillEl, staminaCss, "width", `${100 * sim.pcWolf.stamina}%`);
  setStyle(foodFillEl, foodCss, "width", `${100 * sim.pcWolf.food}%`);
  setStyle(gutFillEl, gutCss, "width", `${100 * sim.pcWolf.gut}%`);
  const other = pinned && pinned !== sim.pcWolf ? pinned : null;
  if (!!other !== inspectShown) { inspectShown = !!other; inspectPanelEl.hidden = !other; }
  if (other) [other.wind, other.stamina, other.food, other.gut].forEach((v, k) =>
    setStyle(inspectFillEls[k], inspectCss[k], "width", `${100 * v}%`));
}

// Draws the whole view as the simulation is now (see DRAWING ORDER): after every frame of
// ticks, and after any change to the view while paused.
function render() {
  frameCount++;
  drawCamera();
  noteGrass();
  describeCritters();
  describeHearts();
  const clock = shoreClockNow();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const inView2 = chunksInView();
  for (const c of inView2) { c.used = frameCount; paintChunk(c, clock); }
  for (const c of inView2) paintChunkLayer(c, "water");
  for (const c of inView2) paintChunkLayer(c, "land");

  const shown = r => (!showOnlySet || showOnlySet.has(r.critter)) && inView(r.left, r.top, r.w, r.h);
  const recs = [...sprites.values()].map(s => s.rec).filter(shown);
  // swimmers among the land tiles
  recs.filter(r => r.swim).sort((p, q) => p.z - q.z).forEach(paintSwimmer);
  // land critters, boulders and hearts, by depth (on a tie: boulders, then sprites, then hearts)
  const items = [];
  for (const c of inView2) for (const b of c.boulders) if (inView(b.left, b.top, tileSize, tileSize)) items.push([b.z, 0, items.length, () => paintBoulder(screen, b)]);
  for (const r of recs) if (!r.swim) items.push([r.z, 1, items.length, () => paintSprite(screen, r)]);
  if (!showOnlySet) for (const h of hearts.values()) items.push([h.z, 2, items.length, () => paintHeart(screen, h)]);
  items.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  for (const it of items) it[3]();
  if (showDebug) paintDebugWolf();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // drop the chunks long out of view
  if (frameCount % 60 === 0) {
    for (const [key, c] of chunks) {
      if (frameCount - c.used < chunkKeepFrames) continue;
      for (const k of ["water", "land"]) if (c[k]) c[k].width = 0;
      chunks.delete(key);
    }
  }
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
  camera.zoom = newZoom;
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

// Sprite r's frame on the page (client coordinates): { left, top, right, bottom, width, height }.
function spriteRect(r) {
  const [left, top] = worldToScreen(r.left, r.top);
  const width = r.w * camera.zoom, height = r.h * camera.zoom;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

// The critter or corpse drawn at a screen position (clientX/Y), or null: of the sprites
// there, the one whose middle is nearest (a sprite's frame is larger than its drawing).
function critterAtScreen(clientX, clientY) {
  let best = null, bestL2 = Infinity;
  for (const s of sprites.values()) {
    if (!s.rec) continue;
    const r = spriteRect(s.rec);
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const l2 = (clientX - (r.left + r.right) / 2) ** 2 + (clientY - (r.top + r.bottom) / 2) ** 2;
    if (l2 < bestL2) { best = s.rec.critter; bestL2 = l2; }
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
  // the world is scaled by zoom about the viewport's center
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
  // load every image now, so none is missing when first drawn
  [tilesImage, groundImage, shoreRotatedImage, shoreInnerImage, heartImage, debugTileImage].forEach(image);
  for (const sheet of Object.keys(sheetImages)) for (const stage of [0, 1, 2, 3, 4]) for (const hind of [false, true]) image(sheetImage(sheet, stage, hind));

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
  screenToGrid, worldToScreen, screenDirToGridDir, screenVecToGridVec, isoProject, critterAtScreen,
  get camera() {
    return { ...camera, pinned, viewportWidth, viewportHeight, worldRadPX, worldBottomPY: worldDiamPY + tileRiserPY, zoomMin, zoomMax };
  },
  // for tests and debugging: what is drawn (spriteOf: see CRITTER SPRITES; heartOf: see
  // HEARTS, by either of the pair; tileOf, tilesInView: describeTile), with sprites'
  // frames on the page (spriteRect); drawing only some critters; the debug outline
  spriteOf: a => sprites.get(a.uid)?.rec, spriteRect,
  heartOf: a => hearts.get(Math.min(a.uid, a.matingWith ?? a.uid)),
  tileOf: (i, j) => describeTile(i, j), tilesInView,
  showOnly: list => { showOnlySet = list ? new Set(list) : null; render(); },
  showDebug: on => { showDebug = on; render(); },
  youngStage: a => sim.youngStage(a), hasAntlers,
  spriteRow, spriteZIndex, frameDataBySpeciesAndPose,
};

})();
