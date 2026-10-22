// SHELVED with the sight overlay (see sight-overlay.js in this folder): reference only, not
// run (run-all.js only runs tests in tests/). It goes back in tests/ if the overlay does.
//
// Line of sight (an experiment, see LINE OF SIGHT in senses.js), shown only as an overlay
// for the player's wolf:
//  - the wolf's eye is 2.25 levels above the ground under it
//  - on flat open ground it sees the tiles around it
//  - a boulder hides the ground right behind it, as if its tile were raised to its top
//  - on screen, tiles it can't see are blacked out (their ground from the black sprites) and
//    their boulders hidden; tiles it can see are drawn as usual
//  - critters standing on tiles it can't see are hidden; the others are shown
// Saves a screenshot to tests/output/sight/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1000, height: 700 } });
  const outDir = ensureOutputDir("sight");

  const res = await p.evaluate(() => {
    sim.pause();
    const w = sim.pcWolf;
    const flat = (i, j, lvl) => {
      const c = sim.tileCorners(i, j);
      return sim.getTerrainAt(i, j) !== "water" && c.every(v => v === lvl);
    };
    // a boulder with flat, level, open ground on its W and E sides: [i-1, j] B [i+1, j]
    let spot = null;
    for (const [i, j] of sim.internals.allLandTiles) {
      if (sim.obstacleAt(i + 1, j) !== "boulder") continue;
      const lvl = sim.tileCorners(i, j)[0];
      if (![0, 1, 2].every(k => flat(i + k, j, lvl)) || sim.isBlockedTile(i + 2, j)) continue;
      spot = [i, j]; break;
    }
    if (!spot) return null;
    const [i, j] = spot;
    w.gx = w.nextGX = i + 0.5; w.gy = w.nextGY = j + 0.5; w.stunnedUntil = 0;
    sim.internals.setCritterIdle(w);
    const eye = senses.eyeOf(w);
    const eyeUp = eye[2] - sim.heightAt(w.gx, w.gy);
    const behind = senses.canSeeTile(eye, i + 2, j);
    // open flat ground: its neighbours (other than the boulder) are all seen
    const near = [[-1, 0], [0, -1], [0, 1], [-1, -1]].filter(([di, dj]) => sim.getTerrainAt(i + di, j + dj) !== "water")
      .every(([di, dj]) => senses.canSeeTile(eye, i + di, j + dj));
    // the overlay: tick so it is worked out for the new position, then look at the page
    for (let n = 0; n < 6; n++) sim.internals.tick();
    w.gx = w.nextGX = i + 0.5; w.gy = w.nextGY = j + 0.5; // (in case it moved)
    animat.setZoom(3); animat.followWolf();
    for (let n = 0; n < 6; n++) sim.internals.tick();
    animat.render();
    const tiles = [...document.querySelectorAll("#field-wrapper .ground-column, #field-wrapper .tile.water")]
      .filter(t => t.gi !== undefined);
    const e2 = senses.eyeOf(w);
    let agree = 0, veilOk = 0, boulderOk = 0, unseen = 0, boulders = 0;
    for (const t of tiles) {
      const seen = senses.canSeeTile(e2, t.gi, t.gj);
      if (t.classList.contains("unseen") === !seen) agree++;
      const top = t.querySelector(".ground.top") || t; // (a water tile is its own top)
      if (getComputedStyle(top).backgroundImage.includes("unseen") === !seen) veilOk++;
      const b = t.querySelector(".boulder");
      if (b) { boulders++; if ((getComputedStyle(b).display === "none") === !seen) boulderOk++; }
      if (!seen) unseen++;
    }
    // critters: put each deer on a seen or an unseen tile near the wolf, then draw
    const seenT = tiles.filter(t => !t.unseen && sim.getTerrainAt(t.gi, t.gj) !== "water" && !(t.gi === i && t.gj === j));
    const unseenT = tiles.filter(t => t.unseen && sim.getTerrainAt(t.gi, t.gj) !== "water");
    const deer = sim.internals.deer.filter(c => sim.isLiveCritter(c)).slice(0, 4);
    deer.forEach((c, k) => {
      const t = (k % 2 ? unseenT : seenT)[k * 7 % Math.max(1, (k % 2 ? unseenT : seenT).length)];
      c.gx = c.nextGX = t.gi + 0.5; c.gy = c.nextGY = t.gj + 0.5; mind.ignore(c);
    });
    animat.render();
    const shownRight = deer.filter((c, k) => {
      const node = [...document.querySelectorAll(".critter")].find(n => n === animat.spriteEl(c));
      return node && (getComputedStyle(node).display === "none") === (k % 2 === 1);
    }).length;
    const wolfShown = getComputedStyle(animat.spriteEl(w)).display !== "none";
    return { eyeUp, behind, near, tiles: tiles.length, agree, veilOk, boulders, boulderOk, unseen,
      deer: deer.length, shownRight, wolfShown };
  });
  r.check(res !== null, "found a boulder on flat open ground to test with");
  if (res) {
    r.check(Math.abs(res.eyeUp - 2.25) < 1e-9, `the wolf's eye is 2.25 levels up (${res.eyeUp})`);
    r.check(res.near, "on flat open ground the wolf sees the tiles next to it");
    r.check(!res.behind, "a boulder hides the ground right behind it");
    r.check(res.agree === res.tiles && res.veilOk === res.tiles,
      `on screen, unseen tiles are blacked out and seen ones are not (${res.agree}/${res.tiles} marked right, ` +
      `${res.veilOk} drawn right; ${res.unseen} unseen)`);
    r.check(res.deer > 0 && res.shownRight === res.deer && res.wolfShown,
      `critters on unseen tiles are hidden, the others shown (${res.shownRight}/${res.deer} deer right; ` +
      `the player's wolf ${res.wolfShown ? "shown" : "HIDDEN"})`);
    r.check(res.boulders > 0 && res.boulderOk === res.boulders,
      `boulders show only on seen tiles (${res.boulderOk}/${res.boulders})`);
  }
  await p.screenshot({ path: path.join(outDir, "sight.png") });
  r.noProblems(p);
  await p.close();
  console.log(`      screenshot saved to ${path.relative(process.cwd(), outDir) || outDir}`);
}

module.exports = { name: "line of sight (overlay)", main };
if (require.main === module) runStandalone(module.exports.name, main);
