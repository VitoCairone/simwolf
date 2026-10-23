// THE SENSES: what a critter perceives right now. It reads the simulation and never
// changes it; what a critter perceives is all its mind (mind.js) may know of others.
//
// Everything it offers is on the one global it defines, `senses`. Connect it with
// senses.attach(sim).
//
// For now there is one sense: SIGHT of every creature within sightRangeTiles, in any
// direction and through anything, and of the grass near a critter.
// TODO: sight blocked by boulders and terrain, a field of view, and hearing. Earlier
// attempts are shelved in experiments/realistic-senses/ and experiments/sight-overlay/.

const senses = (() => {

let sim = null; // set by attach()

const sightRangeTiles = 20;

// What critter a perceives now, one snapshot per creature in sight (the dying and the
// dead included):
//   { uid, species, alive, gx, gy, vx, vy, swimming, meat }
//   vx, vy: its velocity, tiles a tick
//   meat:   for a carcass, the share of its meat left (1 all, 0 only bones)
function perceive(a) {
  const range2 = sightRangeTiles * sightRangeTiles;
  const seen = [];
  for (const list of [sim.allCritters, sim.allCorpses]) {
    for (const b of list) {
      if (b === a) continue;
      const dx = b.gx - a.gx, dy = b.gy - a.gy;
      if (dx * dx + dy * dy > range2) continue;
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

// The grass tiles within radius of critter a that have grass on them: [{ i, j, kg }].
function grassAround(a, radius) {
  const out = [], ci = Math.floor(a.gx), cj = Math.floor(a.gy), r2 = radius * radius;
  for (let i = ci - radius; i <= ci + radius; i++) for (let j = cj - radius; j <= cj + radius; j++) {
    if ((i + 0.5 - a.gx) ** 2 + (j + 0.5 - a.gy) ** 2 > r2) continue;
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

return { attach, perceive, grassAround, sightRangeTiles };

})();

// In Node, senses.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = senses;
