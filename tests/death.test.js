// A deer's death animation (images/stag-death.png, see spritecraft/make_deer_death.py):
//  - a killed deer plays the 5 death frames in order, then its corpse holds the last one
//  - it faces the right way in every direction: two drawn facings (N, E) plus their
//    mirrors (W, S); between two diagonals it uses the next one clockwise
// Saves the fall, frame by frame, to tests/output/death/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

// expected [sheet row, mirrored] by grid direction E, SE, S, SW, W, NW, N, NE
const FACING = [[1, false], [1, true], [1, true], [0, true], [0, true], [0, false], [0, false], [1, false]];
const DIR_LABEL = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 700, height: 520 } });
  const outDir = ensureOutputDir("death");

  // a wolf walks into a standing deer on open ground (as in bugfixes.test.js)
  const setup = await p.evaluate(() => {
    sim.pause();
    const w = sim.internals.wolves[1], d = sim.internals.deer[0];
    const free = (i, j) => sim.getTerrainAt(i, j) !== "water" && !sim.isBlockedTile(i, j);
    const level = (i, j) => { const c = sim.tileCorners(i, j); return Math.max(...c) === Math.min(...c); };
    const t = sim.internals.allLandTiles.find(([i, j]) =>
      [-1, 0, 1, 2, 3].every(di => [-1, 0, 1].every(dj => free(i + di, j + dj) && level(i + di, j + dj))));
    sim.allCritters.filter(c => c !== w && c !== d).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -50 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    w.gx = t[0] + 0.5; w.gy = t[1] + 0.5; d.gx = t[0] + 1.6; d.gy = t[1] + 0.5;
    w.stunnedUntil = d.stunnedUntil = 0; // not stunned from before they were moved
    sim.internals.setCritterIdle(d); mind.ignore(d); mind.ignore(w);
    d.currentDirection = sim.DIR_E;
    sim.internals.setCritterMoving(w, sim.DIR_E, "walk");
    for (let n = 0; n < 120 && d.pose !== "death"; n++) sim.internals.tick();
    // the wolf steps back out of the picture
    w.gx = w.gy = w.nextGX = w.nextGY = -90; sim.internals.setCritterIdle(w);
    animat.setZoom(4); animat.centerCameraOn(d.gx, d.gy);
    return d.pose;
  });
  r.check(setup === "death", `the wolf kills the deer (pose ${setup})`);

  // the fall: frame by frame, screenshots at each frame
  const fd = await p.evaluate(() => animat.frameDataBySpeciesAndPose.deer.death);
  const seq = [];
  for (let n = 0; n < 48; n++) {
    const s = await p.evaluate(() => {
      const d = sim.internals.deer[0];
      animat.render();
      const el = animat.spriteEl(d);
      const [x, y] = el.style.backgroundPosition.split(" ").map(v => -parseInt(v));
      return { pose: d.pose, col: x / 48, row: y / 48, cls: el.className };
    });
    seq.push(s);
    if (s.pose === "death" && n % fd.holdTks === 0 || (s.pose === "dead" && seq[seq.length - 2]?.pose === "death")) {
      const clip = await p.evaluate(() => {
        const b = document.getElementById("field-wrapper").getBoundingClientRect();
        return { x: b.left + b.width / 2 - 120, y: b.top + b.height / 2 - 150, width: 240, height: 200 };
      });
      await p.screenshot({ path: path.join(outDir, `deer-death-${String(seq.length).padStart(2, "0")}-${s.pose}-${s.col}.png`), clip });
    }
    await p.evaluate(() => sim.internals.tick());
  }
  const dying = seq.filter(s => s.pose === "death");
  const cols = dying.map(s => s.col);
  const expected = Array.from({ length: fd.nFrames * fd.holdTks }, (_, k) => Math.floor(k / fd.holdTks));
  r.check(dying.length === fd.nFrames * fd.holdTks && cols.join() === expected.join(),
    `the 5 death frames play in order, ${fd.holdTks} ticks each (${dying.length} ticks: ${[...new Set(cols)].join(" ")})`);
  r.check(dying.every(s => s.cls === "critter deer-death"), "dying uses its own sheet (class deer-death)");
  const dead = seq.filter(s => s.pose === "dead");
  r.check(dead.length > 0 && dead.every(s => s.col === fd.nFrames - 1 && s.cls === "critter deer-death"),
    `the corpse holds the last frame (${dead.length} ticks at frame ${dead[0]?.col})`);

  // facings, on the corpse
  const facings = await p.evaluate(() => {
    const d = sim.internals.deer[0];
    return [0, 1, 2, 3, 4, 5, 6, 7].map(dir => {
      d.currentDirection = dir; animat.render();
      const el = animat.spriteEl(d);
      const y = -parseInt(el.style.backgroundPosition.split(" ")[1]);
      return [y / 48, el.style.transform === "scaleX(-1)"];
    });
  });
  facings.forEach(([row, mirror], dir) => {
    const [er, em] = FACING[dir];
    r.check(row === er && mirror === em,
      `facing ${DIR_LABEL[dir]}: row ${row}${mirror ? " mirrored" : ""} (expected row ${er}${em ? " mirrored" : ""})`);
  });

  r.noProblems(p);
  await p.close();
  console.log(`      screenshots saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "deer death animation", main };
if (require.main === module) runStandalone(module.exports.name, main);
