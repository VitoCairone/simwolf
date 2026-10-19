// Every critter can move: none stays frozen in place for 50 simulated seconds.
// (Catches spawn/collision deadlocks, e.g. critters stuck against terrain or each other.)

const { openGame, runStandalone } = require("./helpers");

async function main(browser, r) {
  const LOADS = 10;
  let frozen = 0, total = 0;
  for (let k = 0; k < LOADS; k++) {
    const p = await openGame(browser);
    const [f, t, details] = await p.evaluate(() => {
      sim.pause();
      const start = new Map(sim.allCritters.map(a => [a, [a.gx, a.gy]]));
      const idleTicks = new Map(sim.allCritters.map(a => [a, 0]));
      for (let n = 0; n < 3000; n++) { // 50 s of game time
        sim.allCritters.forEach(a => { if (a.pose === "idle") idleTicks.set(a, idleTicks.get(a) + 1); });
        sim.internals.tick();
      }
      const stuck = [...start].filter(([a, [x, y]]) => sim.allCritters.includes(a) && a.gx === x && a.gy === y);
      // Explain each frozen critter: how much of the time it chose to stand still, and
      // how big the patch of passable land it's on is (1 = an enclosed single tile).
      const passable = (i, j) => i >= 0 && j >= 0 && i < sim.gridWidthN && j < sim.gridHeightN
        && !sim.internals.isBlockedTile(i, j);
      const regionSize = (i0, j0, cap = 500) => {
        const seen = new Set([i0 + "_" + j0]); const q = [[i0, j0]];
        while (q.length && seen.size < cap) {
          const [i, j] = q.pop();
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const k = (i + di) + "_" + (j + dj);
            if (!seen.has(k) && passable(i + di, j + dj)) { seen.add(k); q.push([i + di, j + dj]); }
          }
        }
        return seen.size >= cap ? `${cap}+` : seen.size;
      };
      const details = stuck.map(([a]) => ({
        critter: `${a.species} #${a.uid}`, tile: [Math.floor(a.gx), Math.floor(a.gy)],
        idlePct: Math.round(100 * idleTicks.get(a) / 3000),
        landPatchTiles: regionSize(Math.floor(a.gx), Math.floor(a.gy)),
        neighbours: sim.allCritters.filter(b => b !== a && Math.hypot(b.gx - a.gx, b.gy - a.gy) < 1.5).length,
      }));
      return [stuck.length, start.size, details];
    });
    frozen += f; total += t;
    details.forEach(d => console.log(`      frozen: ${JSON.stringify(d)}`));
    if (p.problems.length) r.noProblems(p, `(load ${k})`);
    await p.close();
  }
  r.check(frozen === 0, `critters that never moved in 50 game-seconds: ${frozen} of ${total} (${LOADS} loads)`);
}

module.exports = { name: "no frozen critters", main };
if (require.main === module) runStandalone(module.exports.name, main);
