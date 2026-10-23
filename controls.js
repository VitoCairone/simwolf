// THE CONTROLS: the player's input. Keys, the movement pad, the sidebar buttons and the
// pointer become the player's wolf's intent, pause and step (through sim's interface),
// and zoom and camera moves (through animat). It draws nothing itself.
//
// Everything it offers is on the one global it defines, `controls`. Connect it with
// controls.attach(sim, animat).

const controls = (() => {

let sim = null;    // set by attach()
let animat = null;

const arrowKeyNames = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const keysPressed = {};
const cameraSpeed = 50; // screen px per tick while panning with the arrow keys

// The sidebar toggle: the arrow keys move the wolf (true) or pan the camera.
let arrowsMoveWolf = false;
// While the pointer is in one of the movement pad's rings: { pose, dx, dy }, the gait and
// grid vector to move along; else null.
let pad = null;

// Standing still, the player's wolf eats any carcass in reach.
const STAND = { gait: "eat" };

// The player's intent, from what is held: the movement pad while in use; else in wolf
// mode the arrow keys (as screen directions, two combining into a diagonal, opposites
// cancelling; none held: stand); else none, and the mind steers the wolf.

function updatePlayerIntent() {
  let intent = null;
  if (pad) {
    intent = pad.pose === "idle" ? STAND : { dx: pad.dx, dy: pad.dy, gait: pad.pose };
  } else if (arrowsMoveWolf) {
    const screenX = (keysPressed["ArrowRight"] ? 1 : 0) - (keysPressed["ArrowLeft"] ? 1 : 0);
    const screenY = (keysPressed["ArrowDown"] ? 1 : 0) - (keysPressed["ArrowUp"] ? 1 : 0);
    intent = (screenX !== 0 || screenY !== 0)
      ? { dir: animat.screenDirToGridDir(sim.getDir(screenX, screenY)), gait: "walk" }
      : STAND;
  }
  sim.setPlayerIntent(intent);
}

// Camera mode: held arrow keys pan the camera every tick, even while the pad is in use.
function panWithArrowKeys() {
  if (arrowsMoveWolf) return;
  const dx = (keysPressed["ArrowRight"] ? cameraSpeed : 0) - (keysPressed["ArrowLeft"] ? cameraSpeed : 0);
  const dy = (keysPressed["ArrowDown"] ? cameraSpeed : 0) - (keysPressed["ArrowUp"] ? cameraSpeed : 0);
  if (arrowKeyNames.some(k => keysPressed[k])) animat.panCamera(dx, dy);
}

function onKeyDown(e) {
  if (e.key === "p") return sim.togglePause();
  if (e.key === "s") return sim.stepOnce();
  keysPressed[e.key] = true;
  if (arrowKeyNames.includes(e.key)) updatePlayerIntent();
}

function onKeyUp(e) {
  keysPressed[e.key] = false;
  if (arrowKeyNames.includes(e.key)) updatePlayerIntent();
}

function toggleArrowMode() {
  arrowsMoveWolf = !arrowsMoveWolf;
  animat.showArrowMode(arrowsMoveWolf);
  if (arrowsMoveWolf) animat.followWolf();
  updatePlayerIntent();
}

// MOVEMENT PAD (#move-pad in index.html): the pointer's offset from the pad's center
// is the heading, exactly as drawn on screen, and the ring it is in the gait. The rings'
// radii are read from the SVG, so the drawing and the logic can't disagree.
let movePadEl = null;
let movePadRings = [];

function onMovePadPointer(e) {
  const rect = movePadEl.getBoundingClientRect();
  const radPX = rect.width / 2;
  // the pointer's offset from the center, 1 at the outer ring
  const vx = (e.clientX - (rect.left + radPX)) / radPX;
  const vy = (e.clientY - (rect.top + rect.height / 2)) / radPX;
  const radiusL2 = vx * vx + vy * vy;
  const ring = movePadRings.find(r => radiusL2 <= r.frac * r.frac);

  if (!ring) return releaseMovePad(); // in the square element's corners, outside the rings

  if (!pad) animat.followWolf(); // taking the wolf: the camera goes back to it
  const [dx, dy] = animat.screenVecToGridVec(vx, vy);
  pad = { pose: ring.pose, dx, dy };
  animat.showMovePad(vx, vy, ring.pose);
  updatePlayerIntent();
}

function releaseMovePad() {
  if (!pad) return;
  pad = null;
  animat.showMovePad(0, 0, null);
  updatePlayerIntent();
}

function attach(theSim, theAnimat) {
  if (sim) return alert("controls.attach called twice");
  if (!theSim || typeof theSim.setPlayerIntent !== "function")
    return alert("controls.attach needs the simulation (load sim.js)");
  if (!theAnimat || typeof theAnimat.showMovePad !== "function")
    return alert("controls.attach needs the view (load animat.js)");
  sim = theSim;
  animat = theAnimat;

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  sim.onTick(panWithArrowKeys);

  document.getElementById("arrow-mode-toggle").addEventListener("click", toggleArrowMode);
  document.getElementById("zoom-in").addEventListener("click", () => animat.zoomIn());
  document.getElementById("zoom-out").addEventListener("click", () => animat.zoomOut());

  movePadEl = document.getElementById("move-pad");
  movePadRings = [...movePadEl.querySelectorAll(".ring")]
    .map(c => ({ pose: c.dataset.pose, frac: Number(c.getAttribute("r")) / 100 }))
    .sort((a, b) => a.frac - b.frac); // inner to outer
  movePadEl.addEventListener("pointerdown", onMovePadPointer);
  movePadEl.addEventListener("pointermove", onMovePadPointer);
  movePadEl.addEventListener("pointerleave", releaseMovePad);
  movePadEl.addEventListener("pointercancel", releaseMovePad);

  // debug readout of the grid point under the pointer
  const fieldWrapper = document.getElementById("field-wrapper");
  fieldWrapper.addEventListener("mousemove", e =>
    animat.showCursorCoords(animat.screenToGrid(e.clientX, e.clientY)));
  fieldWrapper.addEventListener("mouseleave", () => animat.showCursorCoords(null));
}

return {
  attach,
  // for tests and debugging
  get arrowsMoveWolf() { return arrowsMoveWolf; },
  get padInUse() { return pad !== null; },
};

})();
