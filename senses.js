// THE SENSES: what a critter perceives right now. It reads the simulation and never
// changes it; what a critter perceives is all its mind (mind.js) may know of others.
//
// Everything it offers is on the one global it defines, `senses`. Connect it with
// senses.attach(sim).
//
// For now there is one sense: SIGHT, through anything, of every creature and of the
// grass within a rectangle on screen around the critter, the shape and size of the game
// view at the default 2x zoom on a full-screen MacBook (about 1,290 x 810 CSS pixels).
// In grid terms, screen-horizontal is dx - dy and screen-vertical dx + dy, so the
// rectangle needs no square root.
// TODO: sight blocked by boulders and terrain, a field of view, and hearing. Earlier
// attempts are shelved in experiments/realistic-senses/ and experiments/sight-overlay/.

const senses = (() => {

let sim = null; // set by attach()

// In grid steps; one tile across the screen is 2 of |dx - dy|, one tile down it 2 of |dx + dy|.
const sightHalfWidthTiles = 20.2;  // |dx - dy| at most this
const sightHalfHeightTiles = 25.3; // |dx + dy| at most this

// Whether grid offset (dx, dy) is in sight, or with k < 1, within that share of it.
function inSight(dx, dy, k = 1) {
  return Math.abs(dx - dy) <= k * sightHalfWidthTiles && Math.abs(dx + dy) <= k * sightHalfHeightTiles;
}

// What critter a perceives now, one snapshot per creature in sight (the dying and the
// dead included):
//   { uid, species, alive, gx, gy, vx, vy, swimming, meat }
//   vx, vy: its velocity, tiles a tick
//   meat:   for a carcass, the share of its meat left (1 all, 0 only bones)
function perceive(a) {
  const seen = [];
  for (const list of [sim.allCritters, sim.allCorpses]) {
    for (const b of list) {
      if (b === a) continue;
      if (!inSight(b.gx - a.gx, b.gy - a.gy)) continue;
      const speed = b.speed || 0;
      seen.push({
        uid: b.uid, species: b.species, alive: sim.isLiveCritter(b),
        gx: b.gx, gy: b.gy, vx: speed ? b.hx * speed : 0, vy: speed ? b.hy * speed : 0,
        swimming: b.pose === "swim",
        meat: b.carcass ? sim.carcassMeatKg(b) / sim.deerMeatKg : undefined,
      });
    }
  }
  return seen;
}

// The tiles with grass on them whose centers are in sight of critter a, or within share k
// of it: [{ i, j, kg }].
function grassAround(a, k = 1) {
  const out = [], ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const r = Math.ceil(k * (sightHalfWidthTiles + sightHalfHeightTiles) / 2) + 1;
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    if (!inSight(i + 0.5 - a.gx, j + 0.5 - a.gy, k)) continue;
    const kg = sim.grassFoodAt(i, j);
    if (kg > 0) out.push({ i, j, kg });
  }
  return out;
}

function attach(theSim) {
  if (sim) return alert("senses.attach called twice");
  if (!theSim || typeof theSim.isLiveCritter !== "function")
    return alert("senses.attach needs the simulation (load sim.js)");
  sim = theSim;
}

return { attach, perceive, grassAround, inSight, sightHalfWidthTiles, sightHalfHeightTiles };

})();

// In Node, senses.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = senses;
