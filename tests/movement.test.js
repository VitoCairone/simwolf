// Every critter can move: none stays frozen in place for 50 simulated seconds.
// (Catches spawn/collision deadlocks, e.g. critters stuck against terrain or each other.)

const { openGame, runStandalone } = require("./helpers");

async function main(browser, r) {
  const LOADS = 10;
  let frozen = 0, total = 0;
  for (let k = 0; k < LOADS; k++) {
    const p = await openGame(browser);
    const [f, t] = await p.evaluate(() => {
      pause();
      const start = new Map(allCritters.map(a => [a, [a.gx, a.gy]]));
      for (let n = 0; n < 3000; n++) tick(); // 50 s of game time
      const stuck = [...start].filter(([a, [x, y]]) => allCritters.includes(a) && a.gx === x && a.gy === y);
      return [stuck.length, start.size];
    });
    frozen += f; total += t;
    if (p.problems.length) r.noProblems(p, `(load ${k})`);
    await p.close();
  }
  r.check(frozen === 0, `critters that never moved in 50 game-seconds: ${frozen} of ${total} (${LOADS} loads)`);
}

module.exports = { name: "no frozen critters", main };
if (require.main === module) runStandalone(module.exports.name, main);
