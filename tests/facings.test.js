// The wolf uses the right sprite row (and mirroring) for each of the 8 directions.
// Also saves a screenshot of every facing, walking and idle, to tests/output/facings/
// for a visual check.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

// Expected wolf sheet row and mirroring per grid direction (DIR_E .. DIR_NE):
//   E ↘ row 1, SE ↓ row 6, S ↙ row 2, SW ← row 5 mirrored, W ↖ row 3, NW ↑ row 4, N ↗ row 0, NE → row 5
const EXPECTED_ROW = [1, 6, 2, 5, 3, 4, 0, 5];
const EXPECTED_MIRROR = [false, false, false, true, false, false, false, false];
const DIR_LABEL = ["E-down-right", "SE-down", "S-down-left", "SW-left", "W-up-left", "NW-up", "N-up-right", "NE-right"];

async function main(browser, r) {
  const outDir = ensureOutputDir("facings");
  const p = await openGame(browser, { viewport: { width: 900, height: 700 } });
  await p.evaluate(() => {
    pause();
    document.getElementById("move-pad").style.display = "none";
    document.getElementById("dbel-pc-wolf").style.display = "none";
    allCritters.filter(c => c !== pcWolf).forEach(c => { c.element.style.display = "none"; });
    zoom = 4; animat.updateZoomButtons();
  });
  for (const pose of ["walk", "idle"]) {
    for (let dir = 0; dir < 8; dir++) {
      const got = await p.evaluate(([dir, pose]) => {
        pcWolf.currentDirection = dir; pcWolf.pose = pose; pcWolf.speed = 0;
        pcWolf.frame = pose === "walk" ? 2 : 0;
        updateCritterFrame(pcWolf); animat.placeCritterSprite(pcWolf); animat.setCameraToPCWolf();
        const fd = frameDataBySpeciesAndPose.wolf[pose];
        const [, y] = pcWolf.element.style.backgroundPosition.split(" ").map(v => parseInt(v));
        return { row: Math.round(-y / fd.frameH), mirror: pcWolf.element.style.transform === "scaleX(-1)" };
      }, [dir, pose]);
      r.check(got.row === EXPECTED_ROW[dir] && got.mirror === EXPECTED_MIRROR[dir],
        `${pose} ${DIR_LABEL[dir]}: row ${got.row}${got.mirror ? " mirrored" : ""}`);
      const rect = await p.evaluate(() => {
        const b = document.getElementById("field-wrapper").getBoundingClientRect();
        return { x: b.left + b.width / 2 - 110, y: b.top + b.height / 2 - 150, width: 220, height: 220 };
      });
      await p.screenshot({ path: path.join(outDir, `${pose}-${dir}-${DIR_LABEL[dir]}.png`), clip: rect });
    }
  }
  r.noProblems(p);
  await p.close();
  console.log(`      screenshots saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "wolf facings (8 directions)", main };
if (require.main === module) runStandalone(module.exports.name, main);
