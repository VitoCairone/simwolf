// THE VIEW: everything the player sees. It draws the simulation's current state (tiles
// and critters on one canvas, the field; the meters, the movement pad's highlight and the
// debug readouts) and only ever reads the simulation.
//
// Everything it offers is on the one global it defines, `animat`. Connect it with
// animat.attach(sim); it then redraws after every frame of ticks. controls.js calls the
// functions that change the view itself (zoom, camera, pad highlight).

const animat = (() => {

let sim = null; // set by attach()
let senses = null; // set by attach(), if given: for the SIGHT VIEW

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
    // crawling (a newborn: CRAWLING in sim.js): the walk, at 30% of its pace
    // TODO: placeholder art, not canonical (admin/design_notes.md): real crawling frames
    crawl: {sheet: "wolf", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 17, topToShadow: 39 },
    // stalking: the run, slowly, shaded dark purple
    // TODO: placeholder art, not canonical (admin/design_notes.md): real stalking frames
    stalk: {sheet: "wolf-stalk", nFrames: 8, colZero: 0, frameW: 64, frameH: 64,
      holdTks: 6, topToShadow: 39 },
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
    // signalling (sim.js: HOWLING): plays exactly once in sim's howl (attach checks this)
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
    // crawling (a newborn: CRAWLING in sim.js): the walk, at 30% of its pace
    // TODO: placeholder art, not canonical (admin/design_notes.md): real crawling frames
    crawl: {sheet: "deer", nFrames: 10, colZero: 0, frameW: 48, frameH: 41,
      holdTks: 20, topToShadow: 33},
    // standing, looking about, turning its head and lowering it, with a pause at each
    idle: {sheet: "deer", cols: deerIdleCols,
      holds: deerIdleCols.map(c => (c === 19 || c === 26 || c === 33 ? 30 : 6)),
      frameW: 48, frameH: 41, topToShadow: 33},
    // TODO: a trot of its own (this is the run cycle, as for the gallop)
    trot: {sheet: "deer", nFrames: 9, colZero: 35, frameW: 48, frameH: 41,
      holdTks: 6, topToShadow: 33},
    gallop: {sheet: "deer", nFrames: 9, colZero: 35, frameW: 48, frameH: 41,
      holdTks: 6, topToShadow: 33},
    // standing and eating or drinking (sim's a.eating): lowers its head, then keeps it down
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
//   3. land critters and corpses (100000 + 100 * depth), boulders and pines (100000 + 100
//      * their tile center's depth) and undergrowth (100000 + 100 * its tile's back corner's depth,
//      so a critter standing on its tile is drawn after it), in depth order; on a tie a
//      boulder or undergrowth first; a heart over its pair. A critter or corpse on a tile
//      with undergrowth has the undergrowth's foreground half drawn again over it.
//   4. the crown layer: the see-through pine crowns, over everything but the critters in
//      front of them (see CROWN LAYER)
//   5. the debug outline
// In the SIGHT VIEW each chunk's mask of unseen ground goes right after its terrain; the
// scent marks (SCENT VIEW) go among the land critters, at their tile's back corner's depth
// like undergrowth (over its own tile's undergrowth, under a critter standing there).
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

function undergrowthZIndex(i, j) {
  return zLandCritterBase + (i + j) * 100;
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
const sightBackgroundColor = "#000"; // beyond the map in the SIGHT VIEW
const windFillEl = el("wind-meter-fill");
const staminaFillEl = el("stamina-meter-fill");
const foodFillEl = el("food-meter-fill");
const gutFillEl = el("gut-meter-fill");
const waterFillEl = el("water-meter-fill");
const inspectPanelEl = el("inspect-panel");
const inspectFillEls = ["wind", "stamina", "food", "gut", "water"].map(m => el(`inspect-${m}-fill`));
const zoomInBtn = el("zoom-in");
const zoomOutBtn = el("zoom-out");
const arrowsIconEl = el("arrow-mode-icon");
const cursorCoordsEl = el("cursor-coords");
const debugPanelEl = el("debug-panel");
const debugLineEls = { wolf: el("debug-wolves"), deer: el("debug-deer") };
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
  "wolf-stalk":   { adult: "wolf-stalk.png",   young: "young/wolf-stalk-stage" }, // TODO: placeholder art (admin/design_notes.md)
  "wolf-swim":    { adult: "wolf-swim.png",    young: "young/wolf-swim-stage" },
  "deer":         { adult: "stag-land.png",    hind: "hind-land.png",    young: "young/hind-land-stage" },
  "deer-swim":    { adult: "stag-swim.png",    hind: "hind-swim.png",    young: "young/hind-swim-stage" },
  "deer-death":   { adult: "stag-death.png",   hind: "hind-death.png",   young: "young/hind-death-stage" },
  "deer-carcass": { adult: "deer-carcass.png", hind: "hind-carcass.png", young: "young/hind-carcass-stage" },
};
// CARRYING: a wolf carrying a deer leg (sim's a.carrying) is drawn with its sheet's leg
// overlay (made by spritecraft/make_carried_leg.py: the leg in its mouth, frame by frame,
// for the run, idle and swim columns) over its frame; only grown wolves and the last young
// stage carry. TODO: placeholder art (admin/design_notes.md).
const legOverlays = {
  "wolf":       { adult: "wolf-land-leg.png",  young: "young/wolf-land-leg-stage" },
  "wolf-stalk": { adult: "wolf-stalk-leg.png", young: "young/wolf-stalk-leg-stage" },
  "wolf-swim":  { adult: "wolf-swim-leg.png",  young: "young/wolf-swim-leg-stage" },
};
function legOverlay(sheet, stage) {
  const s = legOverlays[sheet];
  return s ? IMG + (stage ? `${s.young}${stage}.png` : s.adult) : null;
}
function sheetImage(sheet, stage, hind) {
  const s = sheetImages[sheet];
  return IMG + (stage ? `${s.young}${stage}.png` : hind && s.hind ? s.hind : s.adult);
}
const tilesImage = IMG + "tiles.png";
const groundImage = IMG + "ground-slopes.png";
const shoreOuterImage = IMG + "shore-outer.png";
const shoreInnerImage = IMG + "shore-inner.png";
const heartImage = IMG + "heart.png";
const debugTileImage = IMG + "debug-tile.png";
const undergrowthImage = IMG + "undergrowth.png";
const pinesImage = IMG + "pines.png";
const pineTrunksImage = IMG + "pine-trunks.png";
const waterCell = [192, 288]; // plain water in tiles.png
const terrainImages = [tilesImage, groundImage, shoreOuterImage, shoreInnerImage, undergrowthImage];

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

// SHORES: the sea lapping at the land (lakes and rivers lie still, as plain water), drawn
// as an OUTGOING WAVE: a wave front running out from the land that always joins up, ending
// at land or carrying on into the next tile's wave, never stopping short in open water
// (except where the sea meets a river's mouth). Three sprite sets draw it, each set's
// columns being its animation frames:
//   STRAIGHT  tiles.png row 9, columns 0-1: light along one edge, the front parallel to it
//   CORNER    images/shore-outer.png: light in one corner, the front an arc around it
//   INTERIOR  images/shore-inner.png: light along two edges that meet, the front a V
// (both made from the straight sprites by spritecraft/make_shore_tiles.py, so the three
// join seamlessly; tiles.png's own corner sprites, row 9 columns 2-5, aren't used)
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
// Sprites are mirrored about the diamond's center; the corner and interior sets have a
// row for a light corner at the top and one at the right (a quarter turn no mirroring can
// make). One clock steps every shore together: every shoreFrameTicks of game time, 4-frame
// sets advance a frame and 2-frame sets hold each frame for two steps, so all loops stay
// in step.
// Water and placements are worked out once per tile and kept: the terrain never changes.
const shoreFrameTicks = 24;
const shoreLoopSteps = 4;       // steps in a loop (the interior set's frames)
const shoreSheetRowY = 9 * 32;  // y of row 9 in tiles.png
const shoreLookTiles = 3;

const shoreSets = {
  linear: { columns: [0, 1] },
  corner: { columns: [0, 1] },     // (columns of images/shore-outer.png)
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
    TR: { set: "linear", flipX: false, flipY: false },
    TL: { set: "linear", flipX: true,  flipY: false },
    BR: { set: "linear", flipX: false, flipY: true },
    BL: { set: "linear", flipX: true,  flipY: true },
  },
  corner: { // row: of images/shore-outer.png
    T: { set: "corner", flipX: false, flipY: false, row: 0 },
    B: { set: "corner", flipX: false, flipY: true,  row: 0 },
    R: { set: "corner", flipX: false, flipY: false, row: 1 },
    L: { set: "corner", flipX: true,  flipY: false, row: 1 },
  },
  inner: { // row: of images/shore-inner.png
    T: { set: "inner", flipX: false, flipY: false, row: 0 },
    B: { set: "inner", flipX: false, flipY: true,  row: 0 },
    R: { set: "inner", flipX: false, flipY: false, row: 1 },
    L: { set: "inner", flipX: true,  flipY: false, row: 1 },
  },
};

// Whether tile (i, j) is water; off the map counts as water.
function isWaterAt(i, j) {
  return sim.getTerrainAt(i, j) === "water";
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
// corner }, or null for plain water (and for lakes and rivers). Kept, up to placementsKept tiles, then forgotten.
const placements = new Map();
const placementsKept = 200000;
function shorePlacementAt(i, j) {
  const key = i * sim.gridHeightN + j;
  if (placements.has(key)) return placements.get(key);
  if (placements.size >= placementsKept) placements.clear();
  let p = null;
  if (isWaterAt(i, j) && i >= 0 && j >= 0 && i < sim.gridWidthN && j < sim.gridHeightN && sim.waterKindAt(i, j) === "sea") {
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
  placements.clear();
  brinkBlocks.clear(); sight.field = null; sight.tick = -Infinity;
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
  // shore-outer.png and shore-inner.png have a row per light corner (see shoreVariants)
  if (v.set === "corner") return { image: shoreOuterImage, sx: columns[k] * tileSize, sy: v.row * tileSize, flipX: v.flipX, flipY: v.flipY, shore: v, frame: k };
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
// BOULDERS: each is one of the artist's free-standing rocks in tiles.png: sim decides which
// (sim.boulderRockAt: see BOULDER FOOTPRINTS in sim.js, measured from these sprites);
// boulderRockCells has its [column, row], in sim.boulderRocks' order.
const boulderRockCells = [[9, 4], [10, 4], [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [7, 5], [9, 5], [10, 5], [0, 6], [1, 6]];

// UNDERGROWTH: low bushes and flowers (sim.undergrowthAt), the artist's from tiles.png,
// in images/undergrowth.png (made by spritecraft/make_undergrowth.py): row 0 the whole
// sprite, row 1 its foreground half (drawn again over a critter standing on its tile);
// columns by kind (undergrowthCols). Drawn as the artist placed them in their cells, the
// cell on the tile like a ground tile's (undergrowthFootY: the tile's center's row in the
// cell). Which sprite of its kind: mostly one for a patch of undergrowthPatchTiles a side
// (flowers of a kind growing together), else the tile's own; like the terrain, a pure
// function of the tile. Flowers eaten nearly bare aren't drawn (sim.undergrowthShownAt).
const undergrowthCols = { bush: [0, 1], flowers: [2, 3, 4, 5, 6] };
const undergrowthFootY = 24;
const undergrowthPatchTiles = 6;
const undergrowthOwnShare = 0.25; // of tiles, a sprite of their own

function tileHash(i, j, s = 0) {
  let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(s, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

// What the undergrowth on tile (i, j) is drawn as, or null: { i, j, col, left, top, z }.
function describeUndergrowth(i, j) {
  const kind = sim.undergrowthAt(i, j);
  if (!kind) return null;
  const cols = undergrowthCols[kind];
  const own = tileHash(i, j, 1) % 1000 < undergrowthOwnShare * 1000;
  const h = own ? tileHash(i, j, 2) : tileHash(Math.floor(i / undergrowthPatchTiles), Math.floor(j / undergrowthPatchTiles), 3);
  const corners = sim.tileCorners(i, j), base = Math.min(...corners);
  const [px, py] = isoProject(i, j);
  const centerY = isoProject(0.5, 0.5)[1] - ((corners[0] + corners[1] + corners[2] + corners[3]) / 4 - base) * levelHeightPY;
  return { i, j, col: cols[h % cols.length], left: px - halfTile, top: py - base * levelHeightPY + centerY - undergrowthFootY,
    z: undergrowthZIndex(i, j) };
}

// Paints undergrowth u from sheet img (undergrowthImage, or a sight sheet of it): whole
// (row 0) or its foreground half (row 1).
function paintUndergrowth(target, img, u, row = 0) {
  drawCell(target, img, u.col * tileSize, row * tileSize, tileSize, tileSize, u.left, u.top);
}

// The level a tile's front sides must reach down to, given the tile (i, j) in front of
// it: its lowest corner, or for water a level below its surface's (the water surface is
// drawn a level below land at the same level; off the map, the sea's).
function frontGroundLevel(i, j) {
  if (i >= sim.gridWidthN || j >= sim.gridHeightN) return -1;
  if (sim.getTerrainAt(i, j) === "water") return sim.waterLevelAt(i, j) - 1;
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
    const level = sim.waterLevelAt(i, j);
    // how far the water in front of it is lower (a river stepping down): STEPS
    const front = [[i, j + 1], [i + 1, j], [i + 1, j + 1]].map(([a, b]) => sim.getTerrainAt(a, b) === "water" ? sim.waterLevelAt(a, b) : level);
    return { i, j, kind: "water", terrain, level, step: Math.max(0, level - Math.min(...front)),
      left: px - halfTile, top: py - tileRiserPY - level * levelHeightPY,
      z: tileZIndex(i, j, terrain), ...waterCellAt(i, j, clock) };
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
    const [col, brow] = boulderRockCells[sim.boulderRockAt(i, j)];
    const centerAboveBase = (corners[0] + corners[1] + corners[2] + corners[3]) / 4 - base;
    const centerY = isoProject(0.5, 0.5)[1] - centerAboveBase * levelHeightPY;
    t.boulder = { i, j, col, row: brow, left: t.left, top: t.top + centerY - boulderFootCenterY, z: boulderZIndex(i, j) };
  }
  return t;
}

// STEPS: where water in front of a water tile is lower (a river falling a level), the
// tile is drawn again as plain water at each level down to it, beneath itself, so the
// fall shows as water, not as a gap.
function paintWater(target, t) {
  const plain = image(tilesImage);
  for (let k = t.step; k >= 1; k--)
    drawCell(target, plain, waterCell[0], waterCell[1], tileSize, tileSize, t.left, t.top + k * levelHeightPY);
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

// PINES (sim.pineOn): drawn at their real size, from images/pines.png and
// images/pine-trunks.png, as images/pines.js (pineSheet) lays them out (all made by
// spritecraft/make_pines.py: placeholders). A sprite's foot goes on its tile's center; a
// pine is drawn among the critters at that depth, as a boulder. A sapling is one sprite
// (the nearest of 1, 2 and 3 m). A tree, the sprite of its diameter class, grown in a
// forest or the open: its shadow (its crown's footprint), its trunk, then its crown. Its
// trunk is as wide as it blocks sight (sim.pineOn's halfM: a metre across is
// pineSheet.pxPerMAcross, a tile's diagonal), drawn trunkPX up into the crown but not
// where its own crown covers it (clippedTrunk). Which of two sprites: a hash of the tile.
// A crown is see-through if its tree is taller than pineSeeThroughAboveM, or if it covers a
// critter (or a corpse) drawn before it, so that none is lost among the trees: drawn into
// the CROWN LAYER. (Only the drawing: what blocks sight is the sim's.)
const pineSeeThroughAboveM = 8;
const pineTrees = new Map(pineSheet.trees.map(t => [t.size * 4 + t.open * 2 + t.variant, t]));
// how far up a pine reaches above its foot, px, at the most
const pineReachPY = Math.max(...pineSheet.trees.map(t => t.crown[5]), ...pineSheet.saplings.map(t => t.rect[5]));

// What the pine on tile (i, j) is drawn as, or null: { i, j, z, fx, fy (its foot),
// crown, shadow (rects as pineSheet's, or null), trunk: { col, px } or null, box: the
// screen rect it covers [left, top, w, h], tall: its crown always see-through }.
function describePine(i, j) {
  const p = sim.pineOn(i, j);
  if (!p) return null;
  const corners = sim.tileCorners(i, j), base = Math.min(...corners);
  const [px, py] = isoProject(i, j);
  const fy = py - base * levelHeightPY + isoProject(0.5, 0.5)[1] - ((corners[0] + corners[1] + corners[2] + corners[3]) / 4 - base) * levelHeightPY;
  const v = tileHash(i, j, 4) % 2;
  const out = { i, j, z: boulderZIndex(i, j), fx: px, fy, crown: null, shadow: null, trunk: null, box: null, tall: p.heightM > pineSeeThroughAboveM };
  if (p.size === 1) {
    const h = boundVal(Math.round(p.heightM), 1, 3);
    out.crown = pineSheet.saplings.find(t => t.heightM === h && t.variant === v).rect;
  } else {
    const t = pineTrees.get(p.size * 4 + p.open * 2 + v), tr = pineSheet.trunks;
    out.crown = t.crown; out.shadow = t.shadow;
    const w = boundVal(Math.round(2 * p.halfM * pineSheet.pxPerMAcross), tr.widths[0], tr.widths[tr.widths.length - 1]);
    out.trunk = { col: tr.widths.indexOf(w), px: t.trunkPX };
  }
  const c = out.crown, sh = out.shadow || c;
  const left = Math.min(px - c[4], px - sh[4]), top = fy - c[5];
  out.box = [left, top, Math.max(px - c[4] + c[2], px - sh[4] + sh[2]) - left, Math.max(fy - c[5] + c[3], fy - sh[5] + sh[3]) - top];
  return out;
}

// Draws rect r (as pineSheet's) of sheet img with its foot at (fx, fy).
function drawPineRect(target, img, r, fx, fy) {
  drawCell(target, img, r[0], r[1], r[2], r[3], fx - r[4], fy - r[5]);
}

// Paints pine p from sheets img (pinesImage, or a sight sheet of it) and trunks
// (pineTrunksImage, or one of it); its crown into the crown layer if `thin`.
function paintPine(target, img, trunks, p, thin = false) {
  if (p.shadow) drawPineRect(target, img, p.shadow, p.fx, p.fy);
  if (p.trunk && trunks) {
    const t = clippedTrunk(trunks, img, p), tr = pineSheet.trunks;
    if (t) drawCell(target, t, 0, 0, t.width, t.height, p.fx - tr.footX, p.fy - p.trunk.px);
  }
  drawPineRect(thin ? crownLayerFor(target) : target, img, p.crown, p.fx, p.fy);
}

// Pine p's trunk from sheet trunks as drawn: up trunkPX from its foot, but not where its
// crown (from sheet img) covers it; a canvas, its foot at (footX, trunkPX), kept by sheet,
// trunk and crown (null until both sheets have loaded).
const clippedTrunks = new WeakMap();
function clippedTrunk(trunks, img, p) {
  const ready = im => !(im instanceof HTMLImageElement) || (im.complete && im.naturalWidth > 0);
  if (!ready(trunks) || !ready(img)) return null;
  let kept = clippedTrunks.get(trunks);
  if (!kept) clippedTrunks.set(trunks, kept = new Map());
  const c = p.crown, key = p.trunk.col + ":" + p.trunk.px + ":" + c.join();
  let cv = kept.get(key);
  if (!cv) {
    const tr = pineSheet.trunks, top = tr.footY - p.trunk.px;
    cv = document.createElement("canvas"); cv.width = tr.cellW; cv.height = tr.cellH - top;
    const g = cv.getContext("2d");
    g.drawImage(trunks, p.trunk.col * tr.cellW, top, tr.cellW, cv.height, 0, 0, tr.cellW, cv.height);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(img, c[0], c[1], c[2], c[3], tr.footX - c[4], p.trunk.px - c[5], c[2], c[3]);
    kept.set(key, cv);
  }
  return cv;
}

// CROWN LAYER: the see-through crowns, drawn whole into a canvas the screen's size, in
// depth order (a nearer one hiding a farther one), then laid over the whole frame at
// crownLayerAlpha: where crowns overlap, no more opaque than one. A critter or corpse
// (not a swimmer) cuts itself out of the layer as it is painted, so the crowns behind it
// (drawn before it) don't cover it, and those in front (drawn after) do.
const crownLayerAlpha = 0.65;
let crownLayer = null; // { ctx, A, Bx, By, frame } (as screen; the frame it was cleared for)

// The crown layer as a target over target (screen), cleared for this frame when first asked.
function crownLayerFor(target) {
  if (!crownLayer || crownLayer.frame !== frameCount) {
    const cv = crownLayer ? crownLayer.ctx.canvas : document.createElement("canvas");
    if (cv.width !== canvas.width || cv.height !== canvas.height) { cv.width = canvas.width; cv.height = canvas.height; }
    const g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false;
    crownLayer = { ctx: g, A: target.A, Bx: target.Bx, By: target.By, frame: frameCount };
  }
  return crownLayer;
}

// Cuts sprite r (painted by paint) out of the crown layer drawn so far (the crowns behind
// it), so only the crowns in front of it, drawn later, cover it.
function cutFromCrownLayer(paint, r) {
  if (!crownLayer || crownLayer.frame !== frameCount) return;
  crownLayer.ctx.globalCompositeOperation = "destination-out";
  paint(crownLayer, r);
  crownLayer.ctx.globalCompositeOperation = "source-over";
}

// Lays this frame's crown layer, if any, over the screen.
function paintCrownLayer() {
  if (!crownLayer || crownLayer.frame !== frameCount) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = crownLayerAlpha;
  ctx.drawImage(crownLayer.ctx.canvas, 0, 0);
  ctx.globalAlpha = 1;
}

// Whether pine p's crown, drawn after sprite r, covers it.
function pineCovers(p, r) {
  if (!r || p.z <= r.z) return false;
  const c = p.crown, left = p.fx - c[4], top = p.fy - c[5];
  return r.left < left + c[2] && r.left + r.w > left && r.top < top + c[3] && r.top + r.h > top;
}

// The pines on chunk c's tiles (kept on it, until its land is painted again).
function chunkPines(c) {
  if (!c.pines) {
    c.pines = [];
    forEachChunkTile(c, (i, j) => {
      const p = sim.getTerrainAt(i, j) !== "water" && describePine(i, j);
      if (p) c.pines.push(p);
    });
  }
  return c.pines;
}

// CHUNKS: the terrain is painted once into canvases of chunkTiles x chunkTiles tiles, two
// a chunk (its water, its land), and those are painted each frame (with their masks in the
// SIGHT VIEW). A chunk is painted afresh when its grass changes height (land), when the
// shores step (water with shores), or when an image loads; chunks out of view for
// chunkKeepFrames frames are dropped.
// PAINTED BACK TO FRONT: within a chunk, tiles by depth (i + j); chunks by i + j of their
// own (a tile in front of another that it can cover is never in a chunk painted before
// it). All water before all land.
const chunkTiles = 8;
const chunkKeepFrames = 120;
const chunks = new Map(); // ci * 10000 + cj -> chunk
let frameCount = 0;

const chunkLayers = ["water", "land", "waterMask", "landMask", "waterGrey", "landGrey"];
function clearChunks() {
  for (const c of chunks.values()) for (const k of chunkLayers) if (c[k]) c[k].width = 0;
  chunks.clear();
}

// Chunk (ci, cj): its tiles' world bounds (every pixel they can paint: from their highest
// corner down to the lowest ground in front of them), and its layers.
function chunkAt(ci, cj) {
  const key = ci * 10000 + cj;
  let c = chunks.get(key);
  if (c) return c;
  const i0 = ci * chunkTiles, j0 = cj * chunkTiles;
  const i1 = Math.min(sim.gridWidthN, i0 + chunkTiles) - 1, j1 = Math.min(sim.gridHeightN, j0 + chunkTiles) - 1;
  let hi = -Infinity, lo = Infinity;
  for (let i = i0; i <= i1 + 1; i++) for (let j = j0; j <= j1 + 1; j++) {
    const cs = sim.tileCorners(i, j);
    lo = Math.min(lo, cs[0], cs[1], cs[2], cs[3]);
    if (i <= i1 && j <= j1) hi = Math.max(hi, cs[0], cs[1], cs[2], cs[3]);
  }
  const x0 = (i0 - j1) * halfTile - halfTile, x1 = (i1 - j0) * halfTile + halfTile;
  const y0 = (i0 + j0) * qtrTile - hi * levelHeightPY - groundBaseY - tileRiserPY;
  const y1 = (i1 + j1) * qtrTile - (lo - 1) * levelHeightPY + groundCellH + tileRiserPY;
  c = { ci, cj, i0, j0, i1, j1, x0, y0, w: x1 - x0, h: y1 - y0, water: null, land: null,
    hasWater: false, hasLand: false, shores: false, waterClock: -1, landDirty: true, boulders: [], plants: [], pines: null, used: 0, scanned: false,
    waterMask: null, landMask: null, waterGrey: null, landGrey: null, maskDirty: true, greyDirty: true, maskScale: 0 };
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
    c.boulders = []; c.plants = []; c.pines = null;
    forEachChunkTile(c, (i, j) => {
      if (sim.getTerrainAt(i, j) === "water") return;
      const d = describeTile(i, j, clock);
      paintColumn(t, d);
      if (d.boulder) c.boulders.push(d.boulder);
      const u = describeUndergrowth(i, j);
      if (u) c.plants.push(u);
    });
    c.landDirty = false;
  }
}

// The grid point drawn at world pixel (px, py) on the ground: found by trying heights,
// from `level` (the ground's height near it, if known).
function groundUnder(px, py, level = 0) {
  let g = rectiProject(px, py + level * levelHeightPY);
  for (let k = 0; k < 4; k++) {
    const h = sim.heightAt(boundVal(g[0], 0, sim.gridWidthN - 1), boundVal(g[1], 0, sim.gridHeightN - 1));
    g = rectiProject(px, py + h * levelHeightPY);
  }
  return g;
}

// The chunks in view, back to front: the grid rectangle drawn in view, at the height of
// the ground at the view's center (viewLevel), and as much further down-screen as ground
// near it rises above that (it reaches up into view), and up-screen as it sinks below it.
let viewLevel = 0;
function chunksInView(reachPY = 0) {
  const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
  const gc = groundUnder(cx, cy, viewLevel);
  viewLevel = sim.heightAt(boundVal(gc[0], 0, sim.gridWidthN - 1), boundVal(gc[1], 0, sim.gridHeightN - 1));
  const lift = viewLevel * levelHeightPY;
  const g = [[view.x0, view.y0], [view.x1, view.y0], [view.x0, view.y1], [view.x1, view.y1]].map(([x, y]) => rectiProject(x, y + lift));
  const reliefTiles = 64;
  const [lo, hi] = sim.levelRangeIn(Math.floor(g[0][0]) - reliefTiles, Math.floor(g[1][1]) - reliefTiles,
    Math.ceil(g[3][0]) + reliefTiles, Math.ceil(g[2][1]) + reliefTiles);
  // (and, with reachPY, what stands below the view reaching up into it)
  const raised = Math.ceil((Math.max(0, hi - viewLevel) * levelHeightPY + reachPY) / qtrTile) + 2;
  const sunk = Math.ceil(Math.max(0, viewLevel - lo) * levelHeightPY / qtrTile) + 2;
  const n = chunkTiles;
  const ciMin = Math.max(0, Math.floor((g[0][0] - sunk) / n)), ciMax = Math.min(Math.ceil(sim.gridWidthN / n) - 1, Math.floor((g[3][0] + raised) / n));
  const cjMin = Math.max(0, Math.floor((g[1][1] - sunk) / n)), cjMax = Math.min(Math.ceil(sim.gridHeightN / n) - 1, Math.floor((g[2][1] + raised) / n));
  const out = [];
  for (let s = ciMin + cjMin; s <= ciMax + cjMax; s++)
    for (let ci = Math.max(ciMin, s - cjMax); ci <= Math.min(ciMax, s - cjMin); ci++) {
      const c = chunkAt(ci, s - ci);
      if (inView(c.x0, c.y0 - reachPY, c.w, c.h + reachPY)) out.push(c);
    }
  return out;
}

// Marks the chunks whose grass changed height for painting afresh.
let grassSerial = 0;
function noteGrass() {
  const { serial, tiles } = sim.grassChangesSince(grassSerial);
  grassSerial = serial;
  // (the masks too: grass changes its tiles' shapes; see SIGHT VIEW)
  if (!tiles) { for (const c of chunks.values()) c.landDirty = c.maskDirty = c.greyDirty = true; return; }
  for (const [i, j] of tiles) {
    const c = chunks.get(Math.floor(i / chunkTiles) * 10000 + Math.floor(j / chunkTiles));
    if (c) c.landDirty = c.maskDirty = c.greyDirty = true;
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

// SIGHT VIEW: while the camera follows the player's wolf, the view shows what it sees: ground
// in sight as usual; ground it has seen before but not now greyed out (no colour, darker:
// sightGrey), with its boulders; ground it has never seen black, and the map's surroundings
// black. Only the critters and corpses it sees are drawn (senses.seesCreature; and itself),
// and, greyed, the corpses and sleepers it saw (REMEMBERED). What it has seen is the wolf's
// own: a new player's wolf starts having seen nothing.
// THE REGION IN SIGHT is drawn as one shape, worked out again at most every sightEveryS of
// game time while the wolf moves or turns (or the light changes its sight): its SIGHT
// RANGE, the circle of its sight radius within its field of view (and within
// senses.nearViewTiles all round), less the SHADOWS of what stands in its way. The circle is
// drawn at the height of the ground (or water) under the wolf, so on screen it is a true
// ellipse, but for higher ground beyond it, which would be drawn within it: that is cut
// back to the circle on the ground. The field of view's edges, and the shadows', are
// straight lines on the ground, drawn over its (smooth) heights. Nothing is decided tile by
// tile.
// SHADOWS: each blocker is a straight piece of line with a top height: a boulder's rock,
// across the line of sight from the eye (its span, sim.obstacleAcross, as senses.js reckons
// it: top its sim.sightHeightAt), and the BRINKS of the land. A shadow is where a deer could
// stand hidden: between the lines from the eye past the blocker's ends, where the line of
// sight from the wolf's eye to a standing deer's (senses.eyeLevelsBySpecies) would pass
// below the blocker's top, the ground behind taken as level (a boulder's ground; behind a
// brink, its foot; on top of a cliff, its top). So a blocker below the wolf's eye hides
// only a deer close behind it, and none at all unless it stands above the deer's eye; one
// above the wolf's eye hides a deer from as far behind it as needed on (to beyond the
// circle). Near the eye a blocker is cut in pieces (sightShadowPieceShare of their
// distance), so the shadow's far side stays out of the circle.
// BRINKS: where the land bends down: an edge between two tiles, the ground (at their
// centers, as senses.js reckons it) falling across it by brinkLeastDropLevels at least,
// where it falls by brinkMinLevels more over the two tiles after it than over the two
// before (a crest, a step, a cliff, a slope steepening; not a steady slope), and by more
// than at the edges either side (the bend's sharpest). Within each square of
// brinkBlockTiles, the edges are joined into lines and straightened (to within
// brinkStraightTiles: a staircase along a diagonal becomes one straight line), each
// straight piece with the mean height of its top (the higher tile) and its foot (two tiles
// below). Seen from the top side, a brink shades the ground below it; a cliff (a fall of
// cliffLevels across the edge itself) seen from its foot, the ground on top (taken to go
// on level): as SHADOWS. (The view's own
// reckoning, close to the senses': it is the senses that say what the wolf sees.)
// TILE STATES (what it has seen, and which masks need painting; never where an outline
// runs): by each tile's center: in sight (SEEN) or out (GREYED, or BLACK if never seen)
// with no outline within sightClearTiles of it (the range's edge as drawn), else crossed by
// one (PART). A tile is seen, for good, once any of it is in sight (its center, corners or
// the middles of its edges), or its boulder's top: from then on it is greyed out of sight,
// never black. A tile never seen shows nothing on it (undergrowth, boulder).
// MASKS: each chunk keeps a grey layer for its water and one for its land, painted back to
// front like its terrain (each tile first clearing what it covers) from greyed-out copies
// of its tiles' sprites (sightSheet), or black ones for tiles never seen, afresh when its
// tiles are first seen (or their grass changes); and from each, a mask: none with all its
// tiles in sight, the grey layer itself with none in sight or crossed, else the grey layer
// clipped to the region out of sight as drawn (unseenPath), so the outlines run through the
// pixels, not the tiles. They are painted at sight.maskScale times the world's pixels (2
// from zoom 2), so the outlines are finer than the art's pixels; a mask afresh when the
// region changes about it, sightMasksAFrame a frame or as many as sightMaskMS allows. Each
// chunk's mask is painted right after its terrain layer, so the chunks in front cover it as
// their terrain does. Boulders and critters, drawn after, are greyed out or left out whole
// (a boulder by whether the wolf sees its top; undergrowth by its tile's center); swimmers'
// land, by the same region. Water is greyed as plain water (its shores still).
const sightEveryS = 0.1;
const sightMasksAFrame = 4;
const sightMaskMS = 6; // ...or as many more as this many milliseconds a frame allows
const sightGrey = "#8c8c8c"; // greying out: no colour, then darkened by this
const sightArcSteps = 720;   // the sight range's outline, in steps round the circle
const sightClearTiles = Math.SQRT1_2 + 0.35; // a tile's half diagonal, and its sprite's overhang
const sightShadowPieceShare = 0.5;
const sightTilesPerLevel = levelHeightPY / (2 * qtrTile); // a level up is drawn where the ground is this many tiles back along i and j
const sightBeyondTiles = 16;  // the ground beyond the range drawn out of sight this much further on
const sightCellTiles = 1.5;
const sightCullTiles = 1;     // ...but none drawn wholly this far outside the circle   // the region out of sight drawn in cells at most about this wide
const sightBucketPX = 256;    // ...kept in buckets this square (world pixels)
const sightEdgeTiles = 8; // (a tile this far within the range is taken to be drawn within it)
const sightShadowLeastTiles = 0.2; // a shadow narrower than this at the range's edge isn't drawn
const sightShadowReach = 1.15; // ...and its far side this share of the sight radius out (at least)
const brinkMinLevels = 1;
const brinkLeastDropLevels = 0.25; // ...and by this at least itself
const cliffLevels = 2;
const brinkBlockTiles = 32;
const brinkStraightTiles = 0.75;
const sightArc = Array.from({ length: sightArcSteps }, (_, k) =>
  [Math.cos(2 * Math.PI * k / sightArcSteps), Math.sin(2 * Math.PI * k / sightArcSteps)]);
// a tile's state in the view
const SEEN = 0, PART = 1, GREYED = 2, BLACK = 3;
const sight = {
  wolf: null,       // whose sight
  seen: null,       // by tile (TILE BYTES): 1 once the wolf has seen it
  shown: null,      // by tile (TILE BYTES): its state (SEEN ... BLACK) as last worked out
  field: null,      // the region in sight (fieldFor)
  tick: -Infinity, gx: NaN, gy: NaN, hx: NaN, hy: NaN, share: NaN, stage: -1,
  maskScale: 0,
};

function sightViewOn() {
  return !!senses && pinned === sim.pcWolf && sim.isLiveCritter(sim.pcWolf);
}

// TILE BYTES: a byte for each tile of the map, kept in blocks of tileBytesTiles square
// only where one has been set (the rest read as `fill`).
const tileBytesTiles = 64;
function tileBytes(fill) { return { fill, blocks: new Map() }; }
function tileByte(t, i, j) {
  const B = tileBytesTiles, b = t.blocks.get(Math.floor(i / B) * 100000 + Math.floor(j / B));
  return b ? b[(i - Math.floor(i / B) * B) * B + j - Math.floor(j / B) * B] : t.fill;
}
function setTileByte(t, i, j, v) {
  const B = tileBytesTiles, bi = Math.floor(i / B), bj = Math.floor(j / B), key = bi * 100000 + bj;
  let b = t.blocks.get(key);
  if (!b) { if (v === t.fill) return; t.blocks.set(key, b = new Uint8Array(B * B).fill(t.fill)); }
  b[(i - bi * B) * B + j - bj * B] = v;
}

// Every chunk's masks to be painted afresh at once.
function resetSightMasks() {
  for (const c of chunks.values()) c.maskScale = 0;
}

// Works out the region in sight again when due, what the wolf has now seen, and each
// tile's state.
function updateSight() {
  const w = sim.pcWolf, W = sim.gridWidthN, H = sim.gridHeightN;
  if (w !== sight.wolf) {
    sight.wolf = w; sight.seen = tileBytes(0); sight.shown = tileBytes(BLACK);
    sight.field = null; sight.tick = -Infinity; resetSightMasks();
  }
  if (!sim.isLiveCritter(w)) return;
  const share = sim.can(w, "see") ? senses.sightShare(w) : 0, stage = sim.youngStage(w);
  const changed = w.gx !== sight.gx || w.gy !== sight.gy || w.hx !== sight.hx || w.hy !== sight.hy
    || Math.abs(share - sight.share) > 0.005 || stage !== sight.stage;
  if (sight.field && (!changed || sim.tickCount - sight.tick < Math.round(sightEveryS / sim.tempo))) return;
  Object.assign(sight, { tick: sim.tickCount, gx: w.gx, gy: w.gy, hx: w.hx, hy: w.hy, share, stage });
  const old = sight.field, f = sight.field = fieldFor(w, share);
  const boxes = [f.box];
  if (old) boxes.push(old.box);
  const chunkOf = (i, j) => chunks.get(Math.floor(i / chunkTiles) * 10000 + Math.floor(j / chunkTiles));
  for (const [i0, j0, i1, j1] of boxes) {
    for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++) {
        const v = fieldTileState(f, i, j);
        // (seen once any of it is in sight: then never black again)
        if (!tileByte(sight.seen, i, j) && (v.st === SEEN || v.inSight || v.st === PART && seesAnyOf(f, i, j)
          || sim.obstacleHeightAt(i, j) > 0 && (i + 0.5 - f.ex) ** 2 + (j + 0.5 - f.ey) ** 2 <= f.R2 && seesBoulder(i, j))) {
          setTileByte(sight.seen, i, j, 1);
          const c = chunkOf(i, j);
          if (c) c.greyDirty = true;
        }
        const st = v.st === SEEN ? SEEN : v.st === PART ? PART : tileByte(sight.seen, i, j) ? GREYED : BLACK;
        const was = tileByte(sight.shown, i, j);
        // (a chunk's mask changes where a tile's state does, or an outline crosses one)
        if (st !== was || st === PART || was === PART) {
          const c = chunkOf(i, j);
          if (c && !c.maskDirty) { c.maskDirty = true; c.dirtySince = sim.tickCount; }
        }
        setTileByte(sight.shown, i, j, st);
      }
  }
}

// The height a grid point's surface is drawn at: the ground, or a water tile's surface.
function surfaceLevelAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  return sim.getTerrainAt(i, j) === "water" ? sim.waterLevelAt(i, j) : sim.heightAt(gx, gy);
}
// Where a grid point on the surface is drawn (world pixels): a water tile's surface as
// describeTile draws it; at height z instead, if given.
function surfaceProject(gx, gy, z) {
  if (z !== undefined) { const [px, py] = isoProject(gx, gy); return [px, py - z * levelHeightPY]; }
  const x = Math.min(Math.max(gx, 0), sim.gridWidthN - 0.001), y = Math.min(Math.max(gy, 0), sim.gridHeightN - 0.001);
  const [px, py] = isoProject(gx, gy), i = Math.floor(x), j = Math.floor(y);
  if (sim.getTerrainAt(i, j) === "water") return [px, py + waterSurfaceDropPY - sim.waterLevelAt(i, j) * levelHeightPY];
  return [px, py - sim.heightAt(x, y) * levelHeightPY];
}

// THE REGION IN SIGHT of wolf w, its sight at `share` of its radius: { eye (a copy of the
// wolf), ex, ey, ez (its eye's height), R, outline (the sight range: grid points, the
// circle's at the height of the ground under it as floor), shadows ({ pts, edges (unit
// outward normals and offsets), box }), box (the tiles it spans), path (lazily: the region
// out of sight, drawn) }.
function fieldFor(w, share) {
  const R = share * senses.sightRadiusTiles, ex = w.gx, ey = w.gy;
  const floor = surfaceLevelAt(ex, ey), ez = sim.heightAt(ex, ey) + senses.eyeLevels(w);
  const r = Math.ceil(R + sightClearTiles) + 1;
  const f = { eye: { ...w }, ex, ey, ez, R, R2: R * R, floor, outline: [], shadows: [], path: null,
    box: [Math.floor(ex) - r, Math.floor(ey) - r, Math.floor(ex) + r, Math.floor(ey) + r] };
  if (R <= 0) return f;
  f.outline = sightRangeOutline(f, w);
  if (senses.use.lineOfSight) {
    for (let i = f.box[0]; i <= f.box[2]; i++) for (let j = f.box[1]; j <= f.box[3]; j++) {
      if (!(sim.obstacleHeightAt(i, j) > 0) || (i + 0.5 - ex) ** 2 + (j + 0.5 - ey) ** 2 > (R + 1) ** 2) continue;
      // the rock's span across the line of sight to its center (as walkLine sees it)
      const cx = i + 0.5, cy = j + 0.5, dir = sim.getDir(cx - ex, cy - ey), [ux, uy] = sim.moveVecByDir[dir];
      const across = sim.obstacleAcross(i, j, dir);
      if (!across || across[1] <= across[0]) continue;
      const nx = -uy, ny = ux;
      castShadow(f, [cx + nx * across[0], cy + ny * across[0]], [cx + nx * across[1], cy + ny * across[1]],
        sim.sightHeightAt(i, j), sim.centerHeightAt(i, j));
    }
    const B = brinkBlockTiles;
    for (let bi = Math.floor(f.box[0] / B); bi <= Math.floor(f.box[2] / B); bi++)
      for (let bj = Math.floor(f.box[1] / B); bj <= Math.floor(f.box[3] / B); bj++)
        for (const s of brinksIn(bi, bj)) {
          if (segmentDist2(ex, ey, s.p, s.q) > f.R2) continue;
          const top = (ex - s.p[0]) * s.nx + (ey - s.p[1]) * s.ny > 0; // (the eye on its top side)
          if (top) castShadow(f, s.p, s.q, s.top, s.foot, s.top);
          else if (s.cliff) castShadow(f, s.p, s.q, s.top, s.top, s.top);
        }
  }
  return f;
}

// The sight range's outline (see THE REGION IN SIGHT): round the circle, within the field
// of view; round senses.nearViewTiles, outside it.
function sightRangeOutline(f, w) {
  const { ex, ey, R } = f, near = Math.min(R, senses.nearViewTiles), N = sightArcSteps;
  const hx = w.hx || 0, hy = w.hy || 0, deg = senses.fovDegBySpecies[w.species];
  const pts = [];
  if (hx === 0 && hy === 0 || deg >= 360) { for (const [c, s] of sightArc) pts.push([ex + c * R, ey + s * R]); return pts; }
  const half = fovHalf(deg), steps = Math.floor(half.rad / (2 * Math.PI) * N - 1e-9);
  const at = (c, s, r) => [ex + (hx * c - hy * s) * r, ey + (hx * s + hy * c) * r];
  pts.push(at(half.cos, -half.sin, near), at(half.cos, -half.sin, R));
  for (let k = -steps; k <= steps; k++) { const [c, s] = sightArc[(k + N) % N]; pts.push(at(c, s, R)); }
  pts.push(at(half.cos, half.sin, R), at(half.cos, half.sin, near));
  for (let k = steps + 1; k < N - steps; k++) { const [c, s] = sightArc[k]; pts.push(at(c, s, near)); }
  return pts;
}
const fovHalves = new Map();
function fovHalf(deg) {
  let h = fovHalves.get(deg);
  if (!h) { const rad = deg * Math.PI / 360; fovHalves.set(deg, h = { rad, cos: Math.cos(rad), sin: Math.sin(rad) }); }
  return h;
}

// The squared distance from (x, y) to segment pq.
function segmentDist2(x, y, p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - p[0]) * dx + (y - p[1]) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (p[0] + dx * t - x) ** 2 + (p[1] + dy * t - y) ** 2;
}

// Adds the shadow of blocker pq to field f (see SHADOWS): its top's height, and the
// height of the ground behind it (taken as level), where a standing deer's eye would be
// hidden: from k0 to k1 times as far from the eye as the blocker (k > 1). In pieces near
// the eye; its near side drawn at height `edge` if given (a brink's top) and the shadow
// starts at the blocker, else on the ground.
function castShadow(f, p, q, top, ground, edge) {
  const { ex, ey, ez } = f, zt = ground + senses.eyeLevelsBySpecies.deer;
  if (segmentDist2(ex, ey, p, q) < 0.01) return;
  // a line of sight from the eye to the deer's eye, k times as far as the blocker, passes it
  // at ez + (zt - ez) / k: hidden while that is below the top
  let k0 = 1, k1 = Infinity;
  if (top > ez) { if (zt > ez) k0 = Math.max(1, (zt - ez) / (top - ez)); }
  else if (zt < ez) k1 = (ez - zt) / (ez - top);
  else return;
  if (!(k1 > k0)) return;
  const dp = Math.hypot(p[0] - ex, p[1] - ey), dq = Math.hypot(q[0] - ex, q[1] - ey);
  // (one seen all but end on, at most sightShadowLeastTiles wide at the range's edge: none)
  if (Math.abs((p[0] - ex) * (q[1] - ey) - (p[1] - ey) * (q[0] - ex)) * f.R < sightShadowLeastTiles * dp * dq) return;
  if (k0 * Math.min(dp, dq) > f.R) return; // (starting beyond the range)
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(1, Math.ceil(len / (sightShadowPieceShare * Math.max(0.1, Math.min(dp, dq)))));
  const at = (x, y, k) => {
    const s = Math.min(k, Math.max(1, sightShadowReach * f.R / Math.max(0.05, Math.hypot(x - ex, y - ey))));
    return [ex + (x - ex) * s, ey + (y - ey) * s];
  };
  for (let m = 0; m < n; m++) {
    let a = [p[0] + (q[0] - p[0]) * m / n, p[1] + (q[1] - p[1]) * m / n];
    let b = [p[0] + (q[0] - p[0]) * (m + 1) / n, p[1] + (q[1] - p[1]) * (m + 1) / n];
    const fa = at(...a, k1), fb = at(...b, k1);
    if (k0 > 1) { a = at(...a, k0); b = at(...b, k0); }
    else if (edge !== undefined) { a.push(edge); b.push(edge); }
    addShadow(f, [a, b, fb, fa]);
  }
}

// Adds convex polygon pts to f's shadows, wound one way (positive area), with its edges'
// outward normals.
function addShadow(f, pts) {
  let area = 0;
  for (let k = 0; k < pts.length; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % pts.length]; area += x0 * y1 - x1 * y0; }
  if (Math.abs(area) < 1e-9) return;
  if (area < 0) pts.reverse();
  const edges = [];
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % pts.length], l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 0) { const nx = (y1 - y0) / l, ny = -(x1 - x0) / l; edges.push([nx, ny, nx * x0 + ny * y0]); }
    i0 = Math.min(i0, x0); j0 = Math.min(j0, y0); i1 = Math.max(i1, x0); j1 = Math.max(j1, y0);
  }
  f.shadows.push({ pts, edges, box: [i0, j0, i1, j1] });
}

// Tile (i, j)'s state by field f (see TILE STATES): { st: SEEN, PART or (out) GREYED,
// inSight: its center in sight }.
function fieldTileState(f, i, j) {
  const cx = i + 0.5, cy = j + 0.5, dx = cx - f.ex, dy = cy - f.ey, d2 = dx * dx + dy * dy, m = sightClearTiles;
  const out = { st: GREYED, inSight: false };
  if (f.R <= 0) return out;
  // the range's edge as drawn (at the floor's height): the tile's center where it would be
  // drawn at that height, give or take its slope and its sides (sightTilesPerLevel a level)
  let part = d2 <= (senses.nearViewTiles + m) ** 2;
  if (d2 > (f.R + m) ** 2) return out;
  if (d2 > (f.R - m) ** 2) part = true;
  if (d2 > (f.R - sightEdgeTiles) ** 2) {
    const z = surfaceLevelAt(cx, cy), [n0, n1, n2, n3] = sim.tileCorners(i, j);
    const low = Math.min(n0, n1, n2, n3, surfaceLevelAt(cx + 1, cy), surfaceLevelAt(cx, cy + 1), surfaceLevelAt(cx + 1, cy + 1));
    const sh = (z - f.floor) * sightTilesPerLevel, mR = m + (Math.max(n0, n1, n2, n3, z) - low) * sightTilesPerLevel * Math.SQRT2;
    const r2 = (dx - sh) ** 2 + (dy - sh) ** 2;
    if (r2 > (f.R + mR) ** 2) return out;
    if (r2 > (f.R - mR) ** 2) part = true;
  }
  // the field of view's edges: its corners some in it and some out (or all out)
  let ins = 0;
  for (const [x, y] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) if (senses.inView(f.eye, x - f.ex, y - f.ey)) ins++;
  if (ins === 0 && !part) return out;
  if (ins < 4) part = true;
  let inShadow = false;
  for (const s of f.shadows) {
    const b = s.box;
    if (cx < b[0] - m || cx > b[2] + m || cy < b[1] - m || cy > b[3] + m) continue;
    let most = -Infinity;
    for (const [nx, ny, c] of s.edges) { const e = nx * cx + ny * cy - c; if (e > most) most = e; }
    if (most > m) continue;
    if (most < -m) return out; // (deep in this shadow)
    part = true;
    if (most <= 0) inShadow = true;
  }
  out.inSight = !inShadow && d2 <= f.R2 && senses.inView(f.eye, dx, dy);
  out.st = part ? PART : SEEN;
  return out;
}

// Whether field f has any of tile (i, j) in sight: its corners, the middles of its edges.
function seesAnyOf(f, i, j) {
  for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) if (fieldSees(f, i + a / 2, j + b / 2)) return true;
  return false;
}

// Whether field f has grid point (x, y) in sight.
function fieldSees(f, x, y) {
  const dx = x - f.ex, dy = y - f.ey;
  if (dx * dx + dy * dy > f.R2 || !senses.inView(f.eye, dx, dy)) return false;
  for (const s of f.shadows) {
    const b = s.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (s.edges.every(([nx, ny, c]) => nx * x + ny * y <= c)) return false;
  }
  return true;
}

// The region out of sight, as drawn (world pixels): outside, all but the sight range's
// circle, at the floor's height (a path: even-odd); and CELLS, small quadrilaterals on the
// ground, each drawn over the ground's heights (so a line bends with them) and wound one way,
// whose union is the rest: the ground beyond the range (out to sightBeyondTiles more:
// higher ground beyond it, drawn within the circle, is cut back to the circle on the
// ground), behind (out of the field of view, beyond senses.nearViewTiles) and the shadows.
// Being small, a cell keeps its shape where the ground folds as drawn (a cliff, the ground
// behind it hidden by it: one large shape there would turn inside out and cancel itself
// out). Cells are kept in buckets of sightBucketPX square (world pixels), by their boxes.
function unseenShapes(f) {
  if (f.shapes) return f.shapes;
  const big = 1e7, outside = new Path2D(), buckets = new Map(), cells = [], B = sightBucketPX;
  outside.moveTo(-big, -big); outside.lineTo(big, -big); outside.lineTo(big, big); outside.lineTo(-big, big); outside.closePath();
  const proj = v => v.length > 2 ? surfaceProject(v[0], v[1], v[2]) : surfaceProject(v[0], v[1]);
  let covering = []; // (shadows already cut in cells: a cell wholly within one is left out)
  const within = (s, v) => v[0] >= s.box[0] && v[0] <= s.box[2] && v[1] >= s.box[1] && v[1] <= s.box[3] && s.edges.every(([nx, ny, c]) => nx * v[0] + ny * v[1] <= c);
  const cell = (q, cull) => { // (grid points, in order round it; with cull, left out where drawn outside the circle anyway)
    if (covering.length && covering.some(s => q.every(v => within(s, v)))) return;
    if (cull && q.every(v => { const sh = (v.length > 2 ? v[2] : surfaceLevelAt(v[0], v[1])) - f.floor, o = sh * sightTilesPerLevel;
      return (v[0] - o - f.ex) ** 2 + (v[1] - o - f.ey) ** 2 > (f.R + sightCullTiles) ** 2; })) return;
    let pts = q.map(proj), area = 0;
    for (let k = 0; k < 4; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 4]; area += x0 * y1 - x1 * y0; }
    if (area < 0) pts = pts.reverse();
    const xs = pts.map(v => v[0]), ys = pts.map(v => v[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], c = { pts, box };
    cells.push(c);
    for (let bx = Math.floor(box[0] / B); bx <= Math.floor(box[2] / B); bx++) for (let by = Math.floor(box[1] / B); by <= Math.floor(box[3] / B); by++) {
      const key = bx * 100000 + by;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    }
  };
  // a quadrilateral on the ground (a, b one side; fb, fa the other), in cells about a tile
  // long and sightCellTiles across; a side drawn at the height its points carry, if they do
  const quad = (a, b, fb, fa) => {
    const z0 = a[2] !== undefined && a[2] === b[2] ? a[2] : undefined, z1 = fa[2] !== undefined && fa[2] === fb[2] ? fa[2] : undefined;
    const L = Math.max(Math.hypot(fa[0] - a[0], fa[1] - a[1]), Math.hypot(fb[0] - b[0], fb[1] - b[1]));
    const W = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(fb[0] - fa[0], fb[1] - fa[1]));
    const n = Math.max(1, Math.ceil(L / sightCellTiles)), m = Math.max(1, Math.ceil(W / sightCellTiles));
    const at = (u, v) => { // (u along, v across)
      const p = [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v], q = [fa[0] + (fb[0] - fa[0]) * v, fa[1] + (fb[1] - fa[1]) * v];
      const g = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
      return u === 0 && z0 !== undefined ? [g[0], g[1], z0] : u === 1 && z1 !== undefined ? [g[0], g[1], z1] : g;
    };
    for (let k = 0; k < n; k++) for (let l = 0; l < m; l++) cell([at(k / n, l / m), at(k / n, (l + 1) / m), at((k + 1) / n, (l + 1) / m), at((k + 1) / n, l / m)], true);
  };
  // a ring's sector about the eye: radii r0 to r1, angles a0 to a1 (radians from the +x axis)
  const sector = (r0, r1, a0, a1, size = sightCellTiles) => {
    const n = Math.max(1, Math.ceil((r1 - r0) / size)), m = Math.max(1, Math.ceil((a1 - a0) * r1 / size));
    const at = (r, a) => [f.ex + r * Math.cos(a), f.ey + r * Math.sin(a)];
    for (let k = 0; k < n; k++) for (let l = 0; l < m; l++) {
      const ra = r0 + (r1 - r0) * k / n, rb = r0 + (r1 - r0) * (k + 1) / n, aa = a0 + (a1 - a0) * l / m, ab = a0 + (a1 - a0) * (l + 1) / m;
      cell([at(ra, aa), at(ra, ab), at(rb, ab), at(rb, aa)], true);
    }
  };
  if (f.R > 0) {
    const flat = ([x, y]) => { const [px, py] = isoProject(x, y); return [px, py - f.floor * levelHeightPY]; };
    const pts = sightArc.map(([c, s]) => flat([f.ex + c * f.R, f.ey + s * f.R]));
    outside.moveTo(...pts[0]);
    for (const v of pts) outside.lineTo(...v);
    outside.closePath();
    const far = f.R + sightBeyondTiles;
    sector(f.R, far, 0, 2 * Math.PI);
    const w = f.eye, hx = w.hx || 0, hy = w.hy || 0, deg = senses.fovDegBySpecies[w.species];
    if ((hx || hy) && deg < 360) {
      const half = fovHalf(deg).rad, h = Math.atan2(hy, hx);
      sector(Math.min(f.R, senses.nearViewTiles), far, h + half, h + 2 * Math.PI - half); // (on into the ground beyond: no seam at the circle)
    }
  }
  for (const s of f.shadows) {
    const [a, b, fb, fa] = s.pts;
    covering = f.shadows.slice(0, f.shadows.indexOf(s));
    if (s.pts.length === 4) quad(a, b, fb, fa);
  }
  return f.shapes = { outside, buckets, cells };
}

// Field f's sight range's circle (as drawn: a true ellipse), wound against the cells.
function unseenCellsRing(f) {
  const P = new Path2D();
  if (f.R <= 0) return P;
  let pts = sightArc.map(([c, s]) => { const [px, py] = isoProject(f.ex + c * f.R, f.ey + s * f.R); return [px, py - f.floor * levelHeightPY]; });
  let area = 0;
  for (let k = 0; k < pts.length; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % pts.length]; area += x0 * y1 - x1 * y0; }
  if (area > 0) pts = pts.reverse();
  P.moveTo(...pts[0]);
  for (const v of pts) P.lineTo(...v);
  P.closePath();
  return P;
}

// The cells of field f's region out of sight within box (world pixels), in one path
// (nonzero: their union, with no seams where they meet).
function unseenCells(f, box) {
  const { buckets, cells } = unseenShapes(f), B = sightBucketPX, seen = new Set(), P = new Path2D();
  if (box[0] === -Infinity) {
    for (const c of cells) { P.moveTo(...c.pts[0]); P.lineTo(...c.pts[1]); P.lineTo(...c.pts[2]); P.lineTo(...c.pts[3]); P.closePath(); }
    return P;
  }
  for (let bx = Math.floor(box[0] / B); bx <= Math.floor(box[2] / B); bx++) for (let by = Math.floor(box[1] / B); by <= Math.floor(box[3] / B); by++)
    for (const c of buckets.get(bx * 100000 + by) || []) {
      if (seen.has(c) || c.box[2] < box[0] || c.box[0] > box[2] || c.box[3] < box[1] || c.box[1] > box[3]) continue;
      seen.add(c);
      P.moveTo(...c.pts[0]); P.lineTo(...c.pts[1]); P.lineTo(...c.pts[2]); P.lineTo(...c.pts[3]); P.closePath();
    }
  return P;
}

// The region out of sight in field f (within box, world pixels, if given; else all of it,
// kept), as one path (nonzero): everything, the circle wound against it, the cells with it.
function unseenPath(f, box) {
  if (!box && f.path) return f.path;
  const P = new Path2D(), big = 1e7;
  P.moveTo(-big, -big); P.lineTo(big, -big); P.lineTo(big, big); P.lineTo(-big, big); P.closePath();
  P.addPath(unseenCellsRing(f));
  P.addPath(unseenCells(f, box || [-Infinity, -Infinity, Infinity, Infinity]));
  if (!box) f.path = P;
  return P;
}

// The points between p and q, one a tile or so apart (so a line bends with the ground).
function densify(p, q) {
  const n = Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])));
  const out = [];
  for (let k = 1; k < n; k++) {
    const v = [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n];
    if (p[2] !== undefined && q[2] !== undefined) v.push(p[2] + (q[2] - p[2]) * k / n);
    out.push(v);
  }
  return out;
}

// BRINKS of the square of tiles (bi, bj), brinkBlockTiles a side (worked out once): straight
// pieces { p, q, nx, ny (the unit normal toward its top side), top, foot }.
const brinkBlocks = new Map();
function brinksIn(bi, bj) {
  const key = bi * 100000 + bj;
  let out = brinkBlocks.get(key);
  if (out) return out;
  brinkBlocks.set(key, out = []);
  const B = brinkBlockTiles, W = sim.gridWidthN, H = sim.gridHeightN;
  const h = (i, j) => sim.centerHeightAt(Math.min(Math.max(i, 0), W - 1), Math.min(Math.max(j, 0), H - 1));
  // the edges, each directed with its top side on its left: from vertex a to b
  const edges = [];
  for (let i = bi * B; i < Math.min(W, bi * B + B); i++) for (let j = bj * B; j < Math.min(H, bj * B + B); j++) {
    if (i < 0 || j < 0) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (i + di >= W || j + dj >= H) continue;
      // the shared edge
      const a = di ? [i + 1, j] : [i, j + 1], b = [i + 1, j + 1];
      for (const down of [1, -1]) {
        // X the higher tile, the ground falling away from it by (ei, ej) a tile
        const [xi, xj] = down > 0 ? [i, j] : [i + di, j + dj], ei = di * down, ej = dj * down;
        const at = k => h(xi + ei * k, xj + ej * k); // (k = 0: X; 1: the tile below it)
        const top = at(0);
        if (top - at(1) < brinkLeastDropLevels) continue;
        // how much more it falls over the two tiles after the edge than over the two before
        const bend = k => (at(k) - at(k + 2)) - (at(k - 2) - at(k));
        const here = bend(0);
        if (here < brinkMinLevels || here < bend(-1) || here <= bend(1)) continue;
        // directed with its top side (toward X) on its left
        let p = a, q = b;
        if ((q[1] - p[1]) * -ei + -(q[0] - p[0]) * -ej < 0) [p, q] = [q, p];
        edges.push({ p, q, top, foot: at(2), cliff: top - at(1) >= cliffLevels, used: false });
      }
    }
  }
  // joined into lines, end to start
  const vkey = v => v[0] * 100000 + v[1];
  const from = new Map();
  for (const e of edges) { const k = vkey(e.p); if (!from.has(k)) from.set(k, []); from.get(k).push(e); }
  const to = new Map();
  for (const e of edges) { const k = vkey(e.q); if (!to.has(k)) to.set(k, []); to.get(k).push(e); }
  const next = e => (from.get(vkey(e.q)) || []).find(x => !x.used);
  const prev = e => (to.get(vkey(e.p)) || []).find(x => !x.used);
  for (const e0 of edges) {
    if (e0.used) continue;
    e0.used = true;
    const line = [e0];
    for (let e = next(e0); e; e = next(e)) { e.used = true; line.push(e); }
    for (let e = prev(e0); e; e = prev(e)) { e.used = true; line.unshift(e); }
    const vs = [line[0].p, ...line.map(e => e.q)];
    const keep = straighten(vs);
    for (let k = 0; k + 1 < keep.length; k++) {
      const part = line.slice(keep[k], keep[k + 1]);
      const top = part.reduce((s, e) => s + e.top, 0) / part.length, foot = part.reduce((s, e) => s + e.foot, 0) / part.length;
      const cliff = part.filter(e => e.cliff).length * 2 > part.length;
      const p = vs[keep[k]], q = vs[keep[k + 1]], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > 0) out.push({ p, q, nx: (q[1] - p[1]) / l, ny: -(q[0] - p[0]) / l, top, foot, cliff });
    }
  }
  return out;
}

// The indices of the points of polyline vs kept straightening it to within
// brinkStraightTiles (Douglas-Peucker).
function straighten(vs) {
  const keep = new Set([0, vs.length - 1]);
  const go = (a, b) => {
    const [x0, y0] = vs[a], [x1, y1] = vs[b], l = Math.hypot(x1 - x0, y1 - y0);
    let most = 0, at = -1;
    for (let k = a + 1; k < b; k++) {
      const [x, y] = vs[k];
      const d = l > 0 ? Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / l : Math.hypot(x - x0, y - y0);
      if (d > most) { most = d; at = k; }
    }
    if (most > brinkStraightTiles) { keep.add(at); go(a, at); go(at, b); }
  };
  go(0, vs.length - 1);
  return [...keep].sort((a, b) => a - b);
}

function tileSightState(i, j) {
  if (i < 0 || j < 0 || i >= sim.gridWidthN || j >= sim.gridHeightN) return BLACK;
  return sight.shown ? tileByte(sight.shown, i, j) : SEEN;
}

// Whether the wolf sees the top of the boulder on tile (i, j) (kept for the field).
function seesBoulder(i, j) {
  const f = sight.field;
  if (!f) return false;
  if (!f.boulders) f.boulders = new Map();
  const k = i * sim.gridHeightN + j;
  let v = f.boulders.get(k);
  if (v === undefined) {
    v = senses.canSeePoint(f.eye, i + 0.5, j + 0.5, sim.heightAt(i + 0.5, j + 0.5) + sim.obstacleHeightAt(i, j));
    f.boulders.set(k, v);
  }
  return v;
}

// Whether the wolf sees the undergrowth on tile (i, j): the tile in sight, or crossed and
// its center in sight.
function seesUndergrowth(i, j) {
  const st = tileSightState(i, j);
  if (st !== PART) return st === SEEN;
  return !!sight.field && fieldSees(sight.field, i + 0.5, j + 0.5);
}

// Paints undergrowth u, whole (row 0) or its foreground half (row 1), as the sight view
// shows it: in sight, as it is; seen before, greyed; never seen, not at all.
function paintUndergrowthSeen(u, row = 0) {
  if (!tileByte(sight.seen, u.i, u.j)) return;
  if (seesUndergrowth(u.i, u.j)) { paintUndergrowth(screen, image(undergrowthImage), u, row); return; }
  const img = sightSheet(undergrowthImage, "greyed");
  if (img) paintUndergrowth(screen, img, u, row);
}

// SHEETS for the masks, boulders, undergrowth and swimmers' land: a sheet greyed out ("greyed": its
// colour taken out (blend "saturation"), then darkened (blend "multiply")), or its shapes
// in black ("black"); null until its image has loaded.
const sightSheets = new Map();
function sightSheet(path, kind) {
  const key = kind + " " + path;
  let cv = sightSheets.get(key);
  if (cv) return cv;
  const im = image(path);
  if (!im.complete || !im.naturalWidth) return null;
  cv = document.createElement("canvas");
  cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const g = cv.getContext("2d");
  g.drawImage(im, 0, 0);
  const fill = (op, colour) => { g.globalCompositeOperation = op; g.fillStyle = colour; g.fillRect(0, 0, cv.width, cv.height); };
  if (kind === "greyed") {
    fill("saturation", sightGrey); fill("multiply", sightGrey);
    g.globalCompositeOperation = "destination-in"; g.drawImage(im, 0, 0);
  } else fill("source-in", "#000");
  sightSheets.set(key, cv);
  return cv;
}

// Paints tile d from a sight sheet ("greyed" or "black"), water as plain water.
function paintTileShape(t, d, kind) {
  if (d.kind === "water") {
    const img = sightSheet(tilesImage, kind);
    if (img) for (let k = d.step; k >= 0; k--) // (and its STEPS)
      drawCell(t, img, waterCell[0], waterCell[1], tileSize, tileSize, d.left, d.top + k * levelHeightPY);
    return;
  }
  const img = sightSheet(groundImage, kind);
  if (!img) return;
  for (const p of d.pieces)
    drawCell(t, img, p.col * groundCellW, p.row * groundCellH, groundCellW, groundCellH, d.left, d.top + p.top);
}

// Paints tile d's part out of sight (state st) from the sight sheets: greyed if seen
// before, else black; a crossed tile clipped to the region out of sight (unseenShapes).
function paintUnseenPart(t, d, st) {
  if (st === SEEN) return;
  const kind = tileByte(sight.seen, d.i, d.j) ? "greyed" : "black";
  if (st !== PART || !sight.field) { paintTileShape(t, d, kind); return; }
  t.ctx.save();
  t.ctx.setTransform(t.A, 0, 0, t.A, t.Bx, t.By);
  const [x0, y0] = [d.left - tileSize, d.top - 4 * tileSize];
  t.ctx.clip(unseenPath(sight.field, [x0, y0, x0 + 3 * tileSize, y0 + 6 * tileSize]));
  paintTileShape(t, d, kind);
  t.ctx.restore();
}

// Paints chunk c's grey layers (see MASKS) afresh: its water's and its land's.
function paintChunkGreys(c) {
  const S = sight.maskScale;
  for (const [grey, isWater] of [["waterGrey", true], ["landGrey", false]]) {
    if (!(isWater ? c.hasWater : c.hasLand)) continue;
    const cv = c[grey] || (c[grey] = document.createElement("canvas"));
    if (cv.width !== c.w * S || cv.height !== c.h * S) { cv.width = c.w * S; cv.height = c.h * S; }
    const t = { ctx: cv.getContext("2d"), A: S, Bx: -c.x0 * S, By: -c.y0 * S };
    t.ctx.setTransform(1, 0, 0, 1, 0, 0);
    t.ctx.imageSmoothingEnabled = false;
    t.ctx.globalCompositeOperation = "source-over";
    t.ctx.clearRect(0, 0, cv.width, cv.height);
    forEachChunkTile(c, (i, j) => {
      if ((sim.getTerrainAt(i, j) === "water") !== isWater) return;
      const d = describeTile(i, j);
      t.ctx.globalCompositeOperation = "destination-out";
      paintTileShape(t, d, "black");
      t.ctx.globalCompositeOperation = "source-over";
      paintTileShape(t, d, tileByte(sight.seen, i, j) ? "greyed" : "black");
    });
  }
  c.greyDirty = false;
  c.maskScale = S;
  c.maskDirty = true;
}

// Paints chunk c's masks (see MASKS): its grey layers afresh if due; a mask: none with
// all its tiles in sight, its grey layer with none in sight or crossed, else its grey layer
// clipped to the region out of sight (unseenPath).
function paintChunkMasks(c) {
  const S = sight.maskScale;
  if (c.greyDirty || c.maskScale !== S) paintChunkGreys(c);
  let path = null;
  for (const [layer, grey, isWater] of [["waterMask", "waterGrey", true], ["landMask", "landGrey", false]]) {
    if (!(isWater ? c.hasWater : c.hasLand)) continue;
    let seen = 0, all = 0, part = false;
    forEachChunkTile(c, (i, j) => {
      if ((sim.getTerrainAt(i, j) === "water") !== isWater) return;
      all++;
      const st = tileSightState(i, j);
      if (st === SEEN) seen++; else if (st === PART) part = true;
    });
    if (seen === all) { if (c[layer] && c[layer] !== c[grey]) c[layer].width = 0; c[layer] = null; continue; }
    if (!part && !seen || !sight.field) { if (c[layer] && c[layer] !== c[grey]) c[layer].width = 0; c[layer] = c[grey]; continue; }
    const cv = c[layer] && c[layer] !== c[grey] ? c[layer] : (c[layer] = document.createElement("canvas"));
    if (cv.width !== c.w * S || cv.height !== c.h * S) { cv.width = c.w * S; cv.height = c.h * S; }
    const g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.save();
    g.setTransform(S, 0, 0, S, -c.x0 * S, -c.y0 * S);
    g.clip(path || (path = unseenPath(sight.field, [c.x0, c.y0, c.x0 + c.w, c.y0 + c.h])));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(c[grey], 0, 0);
    g.restore();
  }
  c.maskDirty = false;
}

// Brings the masks of the chunks in view up to date: a chunk's first, or at a new scale, at
// once; the rest out of date sightMasksAFrame a frame or as many as sightMaskMS allows: those
// with no mask (all in colour) first, then the longest out of date, then the nearest the
// wolf (the rest on later frames).
function updateChunkMasks(chunksShown) {
  const S = sight.maskScale, w = sim.pcWolf, stale = [];
  for (const c of chunksShown) {
    if (c.maskScale !== S) paintChunkMasks(c);
    else if (c.maskDirty || c.greyDirty) stale.push(c);
  }
  const d2 = c => ((c.i0 + c.i1) / 2 - w.gx) ** 2 + ((c.j0 + c.j1) / 2 - w.gy) ** 2, t0 = performance.now();
  // (one with no mask yet, showing all in colour, before one with)
  const bare = c => c.landMask || c.waterMask ? 1 : 0;
  stale.sort((a, b) => bare(a) - bare(b) || (a.dirtySince || 0) - (b.dirtySince || 0) || d2(a) - d2(b));
  for (let k = 0; k < stale.length && (k < sightMasksAFrame || performance.now() - t0 < sightMaskMS); k++) paintChunkMasks(stale[k]);
}

function paintChunkMask(c, layer) {
  const cv = c[layer], S = sight.maskScale;
  if (!cv) return;
  ctx.setTransform(screen.A / S, 0, 0, screen.A / S, Math.round(c.x0 * screen.A + screen.Bx), Math.round(c.y0 * screen.A + screen.By));
  ctx.drawImage(cv, 0, 0);
}

// Whether a sprite is drawn in the sight view: the wolf's own, and what it sees.
function sightShows(a) {
  return a === sim.pcWolf || senses.seesCreature(sim.pcWolf, a);
}

// REMEMBERED (in the SIGHT VIEW): a corpse, or a sleeping critter, the wolf has seen stays
// drawn while it doesn't see it, greyed out, as and where it last saw it (like the ground
// and boulders it has seen), so it doesn't vanish when the wolf turns away. Forgotten once
// the wolf sees the ground where it lay and it is no longer lying there (gone, woken, or
// moved); seen again, it is drawn as it is. What the wolf remembers is its own: a new
// player's wolf remembers nothing.
const remembered = { wolf: null, byUid: new Map() }; // uid -> its sprite as last seen, with its gx, gy

function staysPut(a) {
  return a.kind === "corpse" || a.pose === "sleep";
}

// This frame's remembered sprites not seen now, to draw greyed; and what is seen now
// remembered.
function rememberedSprites() {
  const w = sim.pcWolf;
  if (w !== remembered.wolf) { remembered.wolf = w; remembered.byUid.clear(); }
  for (const { rec } of sprites.values())
    if (!rec.hidden && !rec.swim && rec.critter !== w && staysPut(rec.critter))
      remembered.byUid.set(rec.uid, { ...rec, layers: rec.layers && [...rec.layers], gx: rec.critter.gx, gy: rec.critter.gy });
  const out = [];
  for (const [uid, r] of remembered.byUid) {
    const now = sprites.get(uid)?.rec;
    if (now && !now.hidden) continue; // (drawn as it is)
    const a = now?.critter, there = a && staysPut(a) && a.gx === r.gx && a.gy === r.gy;
    if (!there && senses.canSeePoint(w, r.gx, r.gy)) { remembered.byUid.delete(uid); continue; }
    out.push(r);
  }
  return out;
}

// Paints sprite r greyed out (sightSheet).
function paintSpriteGreyed(target, r) {
  const img = sightSheet(r.image, "greyed");
  if (!img) return;
  for (const col of r.layers ? [...r.layers].reverse() : [r.col])
    drawCell(target, img, col * r.w, r.row * r.h, r.w, r.h, r.left, r.top, r.mirror);
}

// Paints pine p as the sight view shows it (as a boulder: by whether the wolf sees its top).
function paintPineSeen(p, thin) {
  if (!tileByte(sight.seen, p.i, p.j)) return;
  if (tileSightState(p.i, p.j) === SEEN || seesBoulder(p.i, p.j)) { paintPine(screen, image(pinesImage), image(pineTrunksImage), p, thin); return; }
  const img = sightSheet(pinesImage, "greyed");
  if (img) paintPine(screen, img, sightSheet(pineTrunksImage, "greyed"), p, thin);
}

function paintBoulderSeen(b) {
  if (!tileByte(sight.seen, b.i, b.j)) return;
  const st = tileSightState(b.i, b.j);
  if (st === SEEN || seesBoulder(b.i, b.j)) { paintBoulder(screen, b); return; }
  const img = sightSheet(tilesImage, "greyed");
  if (img) drawCell(screen, img, b.col * tileSize, b.row * tileSize, tileSize, tileSize, b.left, b.top);
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
  // a deer standing and eating (or drinking) is drawn grazing, timed from when it started
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
    z: spriteZIndex(a), swim: a.pose === "swim", layers: null,
    overlay: a.carrying ? legOverlay(fd.sheet, stage) : null };
}

// CARCASSES: 9 layers: the shadow, then each of the 8 pieces as meat while any is left,
// else as bones; a leg torn off (sim's c.carcass.torn: CARRYING) not at all. A morsel (a
// leg put down: c.morsel) is just that leg. images/deer-carcass.png (made by spritecraft/make_deer_carcass.py) has
// the shadow in column 0, then each piece's meat and bones, bottom layer to top in
// carcassSheetPieces order.
const carcassSheetPieces = ["groundHind", "groundFore", "hips", "midback", "chest", "head", "skyHind", "skyFore"];
const carcassFrame = 48, carcassTopToShadow = 40;

function describeCarcass(a) {
  const layers = []; // top first
  for (let k = carcassSheetPieces.length - 1; k >= 0; k--) {
    const name = carcassSheetPieces[k];
    if (a.morsel ? name !== a.morsel : a.carcass.torn?.has(name)) continue;
    layers.push(1 + 2 * k + (sim.carcassPieceKg(a, name) > 0 ? 0 : 1));
  }
  if (!a.morsel) layers.push(0); // the shadow, at the bottom
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
  if (r.overlay) drawCell(target, image(r.overlay), r.col * r.w, r.row * r.h, r.w, r.h, r.left, r.top, r.mirror);
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
// fading in and out over the act; keyed by the pair's lower uid: { pair, left, top, opacity,
// z }.
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
    hearts.set(a.uid, { pair: [a, b], left: Math.round((ax + bx) / 2 - heartW / 2),
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

// DEBUG MODE (the global debugMode, set in index.html): while on, the debug panel shows
// (drawDebugPanel) and the outline under the player's wolf (paintDebugWolf); while off,
// neither.
function debugOn() { return typeof debugMode !== "undefined" && !!debugMode; }

// DEBUG PANEL: the simulation's tick, every debugTickEvery ticks (0, 100, ...); each
// species' live population and its greatest generation (a.generation); each written only
// when it changes.
const debugTickEvery = 100;
const debugTickEl = el("debug-tick").querySelector("span");
const debugShown = { on: null, tick: null, wolf: "", deer: "" };
function drawDebugPanel() {
  const on = debugOn();
  if (on !== debugShown.on) { debugShown.on = on; debugPanelEl.hidden = !on; }
  if (!on) return;
  const tick = Math.floor(sim.tickCount / debugTickEvery) * debugTickEvery;
  if (tick !== debugShown.tick) { debugShown.tick = tick; debugTickEl.textContent = tick; }
  const n = { wolf: 0, deer: 0 }, gen = { wolf: -1, deer: -1 };
  for (const a of sim.allCritters) {
    if (!sim.isLiveCritter(a) || !(a.species in n)) continue;
    n[a.species]++;
    gen[a.species] = Math.max(gen[a.species], a.generation);
  }
  for (const sp of ["wolf", "deer"]) {
    const text = `${n[sp]} ${n[sp] ? gen[sp] : "–"}`;
    if (text === debugShown[sp]) continue;
    debugShown[sp] = text;
    debugLineEls[sp].querySelector(".debug-count").textContent = n[sp];
    debugLineEls[sp].querySelector(".debug-gen").textContent = n[sp] ? gen[sp] : "–";
  }
}

// DEBUG: a tile-sized outline centered on the player's wolf (on the water surface when
// it swims), while debugMode is on (and showDebug, for tests).
let showDebug = true;
function paintDebugWolf() {
  const w = sim.pcWolf;
  const [isoX, isoY] = groundProject(w.gx, w.gy);
  const surfaceDrop = w.pose === "swim" ? waterSurfaceDropPY : 0;
  drawCell(screen, image(debugTileImage), 0, 0, tileSize, halfTile, isoX - halfTile, isoY - qtrTile + surfaceDrop);
}

// SCENT VIEW (in the SIGHT VIEW only): the scent on every tile the player's wolf can smell
// on the ground (senses.trailsAround: deer's, wolves' and death scent), as a round mark on
// the ground at the tile's center (an ellipse, seen isometrically; drawn over its own
// tile's undergrowth: see DRAWING ORDER): red for death scent of a carcass with meat on it
// (when laid), black for one with none, brown for deer, blue for
// a male wolf's, pink for a female's, the wolf's own in its own sex's colour. This is
// drawing only: what the wolf's mind makes of the scent is its own (see TRACKING in
// mind.js).
// TRAILS: the marks are taken trail by trail: those laid by one critter (a wolf tells one
// deer's scent from another's), or around one carcass. Within a trail, by how fresh
// (newest first): the newest in its nose the trail's largest, each older one smaller, down
// to scentTrailLeast of that for the oldest, evenly by their order, so every trail runs
// from small to large the way it was laid, whatever its age.
// AMONG TRAILS of a kind (death scent; deer; other wolves), the fresher the trail (its
// newest mark) the more it shows:
//   its largest mark: scentMaxM, times scentRankScale by its rank among them (freshest
//     first), times its freshness: from 1 for scent scentFreshS old or less to
//     scentStaleScale at the oldest the wolf can smell, by the logarithm of its age (so
//     minutes apart still tell)
//   its marks' fill (scentRankFill, by rank): the freshest solid, the next a thick ring
//     (that share of the radius), older ones thin rings (scentThinPX wide)
// The wolf's own trail, and once it has mated its partner's: thin rings (scentRingPX wide),
// in the maker's sex's colour, each trail's largest scentOwnMaxM.
const scentMaxM = 0.9;              // metres: a tile is 1 m a side
const scentOwnMaxM = 0.8;
const scentTrailLeast = 0.25;
const scentRankScale = [1, 0.75, 0.6];
const scentRankFill = [1, 0.5, 0];  // share of the radius filled (0: a thin ring)
const scentFreshS = 10;
const scentStaleScale = 0.6;
const scentThinPX = 1;              // world pixels
const scentRingPX = 1;              // world pixels: 2 screen pixels at 2x zoom
const scentColors = { death: "rgba(200, 30, 30, 0.85)", bare: "rgba(0, 0, 0, 0.85)", deer: "rgba(120, 72, 30, 0.85)", male: "rgba(40, 90, 210, 0.85)", female: "rgba(225, 95, 170, 0.85)" };
const scentSexes = new Map(); // uid -> isMale, for marks whose maker is gone
// the marks last drawn (for tests): { i, j, species, uid, kind ("death", "deer", "wolf",
// "mate", "own"), rank (its trail's among its kind), s, ageS, d (diameter, m), fill, colour }
let scentShown = [];

function scentMakerIsMale(uid) {
  if (!scentSexes.has(uid)) {
    const c = sim.allCritters.find(c => c.uid === uid) || sim.allCorpses.find(c => c.uid === uid);
    if (!c) return true;
    scentSexes.set(uid, c.isMale);
  }
  return scentSexes.get(uid);
}

// The marks to draw now (scentShown): see SCENT VIEW.
function describeScent() {
  const w = sim.pcWolf, half = sim.scentHalfLifeS, sMin = senses.trailMinStrength.wolf;
  const pxM = 1 / (Math.SQRT2 * halfTile); // a world pixel across, in metres
  const oldestS = Math.log2(1 / sMin) * half, logFresh = Math.log2(scentFreshS), logSpan = Math.log2(oldestS) - logFresh;
  // the trails: by kind, then maker
  const kinds = { death: new Map(), deer: new Map(), wolf: new Map(), mate: new Map(), own: new Map() };
  for (const species of ["death", "deer", "wolf"]) for (const m of senses.trailsAround(w, species)) {
    const kind = species !== "wolf" ? species : m.uid === w.uid ? "own" : m.uid === w.mateUid ? "mate" : "wolf";
    let trail = kinds[kind].get(m.uid);
    if (!trail) kinds[kind].set(m.uid, trail = []);
    trail.push({ i: m.i, j: m.j, species, uid: m.uid, kind, rank: 0, s: Math.pow(2, -m.ageS / half), ageS: m.ageS, d: 0, fill: 1,
      colour: scentColors[species === "death" ? (m.meaty ? "death" : "bare") : species !== "wolf" ? species : scentMakerIsMale(m.uid) ? "male" : "female"] });
  }
  const shown = [];
  for (const kind of ["death", "deer", "wolf", "mate", "own"]) {
    const trails = [...kinds[kind].values()];
    for (const t of trails) t.sort((a, b) => a.ageS - b.ageS);
    trails.sort((a, b) => a[0].ageS - b[0].ageS);
    trails.forEach((t, rank) => {
      const r = Math.min(rank, scentRankScale.length - 1);
      const fresh = 1 - (1 - scentStaleScale) * Math.max(0, Math.min(1, (Math.log2(Math.max(scentFreshS, t[0].ageS)) - logFresh) / logSpan));
      const ringed = kind === "own" || kind === "mate";
      const top = ringed ? scentOwnMaxM : scentMaxM * scentRankScale[r] * fresh;
      t.forEach((m, k) => {
        m.rank = rank;
        m.d = Math.max(pxM, top * (1 - (1 - scentTrailLeast) * (t.length > 1 ? k / (t.length - 1) : 0)));
        m.fill = ringed ? 0 : scentRankFill[r];
        shown.push(m);
      });
    });
  }
  scentShown = shown;
  return shown;
}

// Paints scent mark m (describeScent): solid, or a ring, its width a share of the radius
// (at least a pixel), or thin.
function paintScentMark(m) {
  const [px, py] = groundProject(m.i + 0.5, m.j + 0.5), rx = m.d / 2 * halfTile * Math.SQRT2;
  const width = m.kind === "own" || m.kind === "mate" ? scentRingPX : m.fill > 0 ? Math.max(1, m.fill * rx) : scentThinPX;
  ctx.setTransform(screen.A, 0, 0, screen.A, screen.Bx, screen.By);
  ctx.beginPath();
  ctx.ellipse(px, py, rx, rx / 2, 0, 0, 2 * Math.PI);
  if (m.fill < 1 && width < rx) ctx.ellipse(px, py, rx - width, (rx - width) / 2, 0, 0, 2 * Math.PI, true);
  ctx.fillStyle = m.colour;
  ctx.fill("evenodd");
}

// Swimmer r, then the land in front of it that covers it (see DRAWING ORDER): the tiles
// nearer the camera, in the screen columns it spans, whose columns reach up over it,
// painted again back to front within the swimmer's frame only (outside it, a tile's sides
// would be drawn over the land in front of it, as if raised). In the sight view that land
// is greyed out or black as its tiles are (SIGHT VIEW).
function paintSwimmer(r, sightOn) {
  paintSprite(screen, r);
  const c = screen.ctx;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.beginPath();
  c.rect(Math.round(r.left * screen.A + screen.Bx), Math.round(r.top * screen.A + screen.By), r.w * screen.A, r.h * screen.A);
  c.clip();
  const a = r.critter, d0 = Math.floor(a.gx + a.gy);
  const [, hi] = sim.levelRangeIn(Math.floor(a.gx) - 2, Math.floor(a.gy) - 2, Math.floor(a.gx) + 64, Math.floor(a.gy) + 64);
  const rows = Math.ceil((Math.max(0, hi - sim.heightAt(a.gx, a.gy)) * levelHeightPY + groundBaseY + r.h) / qtrTile) + 2;
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
      if (!(t.left < r.left + r.w && t.left + tileSize > r.left && top < r.top + r.h && top + h > r.top)) continue;
      paintColumn(screen, t);
      if (sightOn) paintUnseenPart(screen, t, tileSightState(i, j));
    }
  }
  c.restore();
}

// METERS: the player's wolf's wind, stamina and food: its body's (a.food) on the left,
// its stomach's (a.gut) on the right (see BODY in sim.js); and water (a.water, below
// them); a full bar when full. No labels:
// the game shows no words or numbers. INSPECTING: while the camera follows another
// critter (or its corpse), that critter's meters show below, under an eye.
const windCss = {};
const staminaCss = {};
const foodCss = {};
const gutCss = {};
const waterCss = {};
const inspectCss = [{}, {}, {}, {}, {}];
let inspectShown = false;
function drawExertion() {
  drawDebugPanel();
  setStyle(windFillEl, windCss, "width", `${100 * sim.pcWolf.wind}%`);
  setStyle(staminaFillEl, staminaCss, "width", `${100 * sim.pcWolf.stamina}%`);
  setStyle(foodFillEl, foodCss, "width", `${100 * sim.pcWolf.food}%`);
  setStyle(gutFillEl, gutCss, "width", `${100 * sim.pcWolf.gut}%`);
  setStyle(waterFillEl, waterCss, "width", `${100 * sim.pcWolf.water}%`);
  const other = pinned && pinned !== sim.pcWolf ? pinned : null;
  if (!!other !== inspectShown) { inspectShown = !!other; inspectPanelEl.hidden = !other; }
  if (other) [other.wind, other.stamina, other.food, other.gut, other.water].forEach((v, k) =>
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
  if (senses) updateSight();
  const sightOn = sightViewOn();
  if (sightOn) {
    const S = camera.zoom >= 2 ? 2 : 1;
    sight.maskScale = S;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = sightOn ? sightBackgroundColor : backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const inView2 = chunksInView();
  for (const c of inView2) { c.used = frameCount; paintChunk(c, clock); }
  if (sightOn) updateChunkMasks(inView2);
  for (const c of inView2) { paintChunkLayer(c, "water"); if (sightOn) paintChunkMask(c, "waterMask"); }
  for (const c of inView2) { paintChunkLayer(c, "land"); if (sightOn) paintChunkMask(c, "landMask"); }
  const scentMarksNow = sightOn ? describeScent() : (scentShown = []);

  // (in the sight view, only what the wolf sees: see SIGHT VIEW)
  for (const s of sprites.values()) s.rec.hidden = sightOn && !sightShows(s.rec.critter);
  const shown = r => (!showOnlySet || showOnlySet.has(r.critter)) && !r.hidden && inView(r.left, r.top, r.w, r.h);
  const recs = [...sprites.values()].map(s => s.rec).filter(shown);
  // swimmers among the land tiles
  recs.filter(r => r.swim).sort((p, q) => p.z - q.z).forEach(r => paintSwimmer(r, sightOn));
  // land critters, boulders, undergrowth, scent marks and hearts, by depth (on a tie:
  // boulders and undergrowth, then scent marks, then sprites, then hearts)
  const items = [];
  for (const m of scentMarksNow) items.push([undergrowthZIndex(m.i, m.j), 0.5, items.length, () => paintScentMark(m)]);
  const boulderPaint = b => sightOn ? () => paintBoulderSeen(b) : () => paintBoulder(screen, b);
  const plantPaint = (u, row = 0) => sightOn ? () => paintUndergrowthSeen(u, row) : () => paintUndergrowth(screen, image(undergrowthImage), u, row);
  for (const c of inView2) for (const b of c.boulders) if (inView(b.left, b.top, tileSize, tileSize)) items.push([b.z, 0, items.length, boulderPaint(b)]);
  for (const c of chunksInView(pineReachPY)) for (const p of (c.used = frameCount, chunkPines(c))) if (inView(...p.box)) {
    const thin = p.tall || recs.some(r => pineCovers(p, r));
    items.push([p.z, 0, items.length, sightOn ? () => paintPineSeen(p, thin) : () => paintPine(screen, image(pinesImage), image(pineTrunksImage), p, thin)]);
  }
  for (const c of inView2) for (const u of c.plants)
    if (inView(u.left, u.top, tileSize, tileSize) && sim.undergrowthShownAt(u.i, u.j)) items.push([u.z, 0, items.length, plantPaint(u)]);
  const spriteItem = (r, gx, gy, paint) => {
    // standing in undergrowth: its foreground half over the critter
    const i = Math.floor(gx), j = Math.floor(gy);
    const u = sim.undergrowthShownAt(i, j) ? describeUndergrowth(i, j) : null;
    const front = u && plantPaint(u, 1);
    items.push([r.z, 1, items.length, () => { paint(screen, r); if (front) front(); cutFromCrownLayer(paint, r); }]);
  };
  for (const r of recs) if (!r.swim) spriteItem(r, r.critter.gx, r.critter.gy, paintSprite);
  if (sightOn && !showOnlySet) for (const r of rememberedSprites()) if (inView(r.left, r.top, r.w, r.h)) spriteItem(r, r.gx, r.gy, paintSpriteGreyed);
  const heartShown = h => !sightOn || h.pair.every(a => !sprites.get(a.uid)?.rec?.hidden);
  if (!showOnlySet) for (const h of hearts.values()) if (heartShown(h)) items.push([h.z, 2, items.length, () => paintHeart(screen, h)]);
  items.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  for (const it of items) it[3]();
  paintCrownLayer();
  if (showDebug && debugOn()) paintDebugWolf();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // drop the chunks long out of view
  if (frameCount % 60 === 0) {
    for (const [key, c] of chunks) {
      if (frameCount - c.used < chunkKeepFrames) continue;
      for (const k of chunkLayers) if (c[k]) c[k].width = 0;
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
    if (!s.rec || s.rec.hidden) continue;
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
  return groundUnder(px, py, viewLevel);
}

// DEBUG: the grid coordinates under the pointer (g null: not over the field).
function showCursorCoords(g) {
  cursorCoordsEl.textContent = g
    ? `x: ${g[0].toFixed(3)}, y: ${g[1].toFixed(3)}`
    : `x: –, y: –`;
}

function attach(theSim, theSenses = null) {
  if (sim) return alert("animat.attach called twice");
  if (!theSim || typeof theSim.onFrame !== "function")
    return alert("animat.attach needs the simulation (load sim.js before animat.js)");
  if (theSenses && typeof theSenses.canSeePoint !== "function")
    return alert("animat.attach: that's not the senses (load senses.js)");
  sim = theSim;
  senses = theSenses;

  worldRadPX = halfTile + (sim.gridWidthN + sim.gridHeightN - 2) * qtrTile;
  worldDiamPY = worldRadPX;

  for (const [species, deathS] of Object.entries(sim.deathDurationSBySpecies)) {
    const d = frameDataBySpeciesAndPose[species].death;
    const ticks = d.cols ? d.holds.reduce((x, y) => x + y, 0) : d.nFrames * d.holdTks;
    if (Math.abs(ticks * sim.tempo - deathS) > 1e-9)
      return alert(`animat: ${species} death animation doesn't last sim's ${deathS} s`);
  }
  { // the howl plays exactly once in sim's howl (HOWLING)
    const h = frameDataBySpeciesAndPose.wolf.howl, ticks = h.holds.reduce((x, y) => x + y, 0);
    if (Math.abs(ticks - Math.round(sim.howlS / sim.tempo)) > 0)
      return alert(`animat: the wolf's howl doesn't last sim's ${sim.howlS} s`);
  }
  // load every image now, so none is missing when first drawn
  [...terrainImages, heartImage, debugTileImage].forEach(image);
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
  // HEARTS, by either of the pair; tileOf, tilesInView: describeTile; undergrowthOf:
  // describeUndergrowth, with its sheet undergrowthImage), with sprites'
  // frames on the page (spriteRect); drawing only some critters; the debug outline
  spriteOf: a => sprites.get(a.uid)?.rec, spriteRect,
  heartOf: a => hearts.get(Math.min(a.uid, a.matingWith ?? a.uid)),
  tileOf: (i, j) => describeTile(i, j), tilesInView, undergrowthOf: (i, j) => describeUndergrowth(i, j), undergrowthImage,
  pineOf: (i, j) => describePine(i, j), pinesImage, pineTrunksImage,
  showOnly: list => { showOnlySet = list ? new Set(list) : null; render(); },
  showDebug: on => { showDebug = on; render(); },
  get scentShown() { return scentShown.map(m => ({ ...m })); },
  // the sight view: whether it is on, and tile (i, j)'s state in it ("seen", "part",
  // "greyed", "black")
  sightViewOn: () => sightViewOn(), tileSight: (i, j) => ["seen", "part", "greyed", "black"][tileSightState(i, j)],
  // the region in sight (THE REGION IN SIGHT): whether it takes in grid point (x, y); its
  // eye, radius, floor and shadows; the brinks of the land in the square of tiles (bi, bj)
  sightSees: (x, y) => !!sight.field && fieldSees(sight.field, x, y),
  sightField: () => sight.field && { ex: sight.field.ex, ey: sight.field.ey, ez: sight.field.ez, R: sight.field.R, floor: sight.field.floor,
    shadows: sight.field.shadows.map(s => s.pts.map(p => [...p])) },
  brinksIn: (bi, bj) => brinksIn(bi, bj).map(b => ({ ...b })), brinkBlockTiles,
  // for tests: whether the wolf has ever seen tile (i, j); every chunk's masks painted
  // afresh now (what the view should show, with none left out of date)
  sightSeen: (i, j) => !!sight.seen && !!tileByte(sight.seen, i, j),
  refreshSightMasks: () => { for (const c of chunks.values()) if (c.maskScale) paintChunkMasks(c); },
  remembered: () => [...remembered.byUid.keys()], // (REMEMBERED: the uids)
  youngStage: a => sim.youngStage(a), hasAntlers,
  spriteRow, spriteZIndex, frameDataBySpeciesAndPose,
};

})();
