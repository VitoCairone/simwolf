// THE CONTROLS: the player's input, and nothing else.
//
// controls listens to the keyboard, the movement pad, the sidebar buttons and the
// pointer, and turns them into intents: for the simulation (where the player's wolf
// should go, pause, step) through sim.setPlayerIntent etc., and for the view (zoom,
// camera) through animat. It draws nothing itself and changes the world only through
// sim's interface.
//
// Everything it offers is on the one global it defines, `controls`. Connect it with
// controls.attach(sim, animat).

const controls = (() => {

let sim = null;    // set by attach()
let animat = null;

const arrowKeyNames = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const keysPressed = {};
const cameraSpeed = 50; // screen px per tick while panning with the arrow keys

// Arrow mode (sidebar toggle): the arrow keys move the wolf (true) or pan the camera.
let arrowsMoveWolf = false;
// The movement pad while the pointer is in one of its rings: { pose, dx, dy } (the grid
// vector to move along: any heading), else null.
let pad = null;

// THE PLAYER'S INTENT for the wolf, from everything currently held:
//   the movement pad, while in use, has priority (the arrow keys are ignored)
//   otherwise in wolf mode, the arrow keys: Up = straight up on screen, two keys
//     combine into a screen diagonal, opposite keys cancel; none held = stand still
//   otherwise no intent: the wolf decides for itself
function updatePlayerIntent() {
  let intent = null;
  if (pad) {
    intent = pad.pose === "idle" ? { gait: "idle" } : { dx: pad.dx, dy: pad.dy, gait: pad.pose };
  } else if (arrowsMoveWolf) {
    const screenX = (keysPressed["ArrowRight"] ? 1 : 0) - (keysPressed["ArrowLeft"] ? 1 : 0);
    const screenY = (keysPressed["ArrowDown"] ? 1 : 0) - (keysPressed["ArrowUp"] ? 1 : 0);
    intent = (screenX !== 0 || screenY !== 0)
      ? { dir: animat.screenDirToGridDir(sim.getDir(screenX, screenY)), gait: "walk" }
      : { gait: "idle" };
  }
  sim.setPlayerIntent(intent);
}

// Camera mode: held arrow keys pan the camera, once per tick (even while the pad is in
// use). Panning detaches the camera from the wolf.
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

// MOVEMENT PAD
// Fixed on-screen joystick (see #move-pad in index.html). The pointer's offset from the
// pad center gives the direction (any heading, not just 8: exactly where it points); which concentric ring it is in gives the gait.
// Ring radii are read from the SVG (viewBox radius 100) so drawing and logic can't drift.
let movePadEl = null;
let movePadRings = [];

function onMovePadPointer(e) {
  const rect = movePadEl.getBoundingClientRect();
  const radPX = rect.width / 2;
  // normalized vector from pad center; |v| = 1 at the outer ring
  const vx = (e.clientX - (rect.left + radPX)) / radPX;
  const vy = (e.clientY - (rect.top + rect.height / 2)) / radPX;
  const radiusL2 = vx * vx + vy * vy; // squared, compared with each ring's squared radius
  const ring = movePadRings.find(r => radiusL2 <= r.frac * r.frac);

  // the pad element is square; its corners are outside the circles
  if (!ring) return releaseMovePad();

  if (!pad) animat.followWolf(); // taking the wolf: bring the camera back to it
  // any heading: the way the pointer is from the pad's center, on screen, as a grid vector
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

// CONNECTING
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

// THE INTERFACE
return {
  attach,
  // for tests and debugging
  get arrowsMoveWolf() { return arrowsMoveWolf; },
  get padInUse() { return pad !== null; },
};

})();
