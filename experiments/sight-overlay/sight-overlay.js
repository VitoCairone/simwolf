// SIGHT OVERLAY - a shelved experiment, kept for reference. NOT LOADED by the game.
//
// What it did: worked out which tiles the player's wolf could actually see from its eyes,
// over the terrain's heights and the boulders, and blacked out everything else on screen
// (unseen ground drawn as its shape in pure black, without its boulders, and any critter
// standing on it hidden). It was shown to the player only; nothing decided by it.
//
// Everything is below, commented out, by the file it went into. To bring it back, put each
// part back in its file (uncommented), and:
//   - index.html: animat.attach(sim, senses) instead of animat.attach(sim)
//   - sim.js: add obstacleHeightAt to the interface (next to obstacleAt)
//   - senses.js: add eyeOf, canSeeTile to the interface
//   - animat.js: see "ANIMAT.JS" below for the small changes inside existing functions
//   - images: move ground-slopes-unseen.png and water-unseen.png (in this folder) back to
//     images/, or regenerate them with make_unseen_tiles.py (in this folder; run it from
//     the project root after moving it back to spritecraft/)
//   - tests: sight.test.js (in this folder) goes back in tests/
//
// Measurements it relied on (from the art; one height level is drawn 8 px high):
//   - wolf eye: 2.25 levels above the ground under it. In the middle frames of its run
//     facing down-right (wolf-run-stand.png row 1, columns 3 and 4) the eye is drawn about
//     15.5 px above the sprite's ground point and 6 px forward of it; the head is about 0.4
//     tile ahead, where the ground is drawn about 3 px lower: about 18 px up in all.
//   - boulder: its top is drawn 12 px (1.5 levels) above the ground at its tile's center.
//
// Performance notes:
//   - A full pass over the ~6,500 tiles on screen took 2-5 ms; it was redone at most every
//     0.1 game-seconds, and only while the wolf moved (new tiles worked out as they came on
//     screen).
//   - The first version drew a separate see-through veil element over each unseen tile.
//     Tiles share their layer with the critter sprites (so ground in front can hide a
//     critter), so that layer is repainted whenever any critter moves, and thousands of
//     extra elements on it cut the frame rate from about 54 to 35. Baking the look into
//     copies of the tile sprites (an unseen tile just shows a different background image)
//     made it free.


// ================================ SIM.JS ================================
// (in the OBSTACLES part, before blocksSight)
// // How high each kind of obstacle stands above the ground at its tile's center, in levels
// // (measured from its picture: the boulder's top is drawn 12 px, 1.5 levels, above the
// // ground at its center).
// const obstacleHeightLevels = { boulder: 1.5 };
//
// // How high the obstacle on tile (i, j) stands above its ground, in levels (0: none).
// function obstacleHeightAt(i, j) {
//   const o = obstacleAt(i, j);
//   return o ? obstacleHeightLevels[o] : 0;
// }


// =============================== SENSES.JS ===============================
// (after perceive)
// // LINE OF SIGHT - an experiment. Not part of perceive() above and not used for deciding:
// // for now it only drives an overlay showing the player what the player's wolf can see
// // (animat.js).
// // Which tiles a critter can actually see from its eyes, over the terrain. Each tile is
// // sampled once, at its center: the ground's height there, raised to the top of any
// // obstacle on it (sim.obstacleHeightAt). A tile is seen when the straight line from the
// // eye down (or up) to the ground at its center passes above every tile in between, each
// // compared at the point where the line comes nearest that tile's center. The line is
// // walked tile by tile (a grid traversal), with distances along it as fractions: no square
// // roots.
// //
// // Eye heights, in levels above the ground under the critter, measured from its sprite:
// // the wolf's eye, in the middle frames of its run facing down-right (wolf-run-stand.png
// // row 1, columns 3 and 4), is drawn about 15.5 px above its ground point and 6 px forward
// // of it; the head is about 0.4 tile ahead, where the ground is drawn about 3 px lower. So
// // the eye is about 18 px up: 2.25 levels of 8 px.
// const eyeLevelsBySpecies = { wolf: 2.25 };
//
// let sightZ = null; // by tile: the height a line of sight must pass above (NaN: not yet known)
//
// // The height a line of sight must clear over tile (i, j): the ground at its center plus any
// // obstacle. Worked out once per tile (the terrain doesn't change).
// function sightHeightAt(i, j) {
//   if (!sightZ) sightZ = new Float32Array(sim.gridWidthN * sim.gridHeightN).fill(NaN);
//   const k = i * sim.gridHeightN + j;
//   let z = sightZ[k];
//   if (z !== z) { // NaN
//     z = sim.heightAt(i + 0.5, j + 0.5) + sim.obstacleHeightAt(i, j);
//     sightZ[k] = z;
//   }
//   return z;
// }
//
// // Where critter a's eye is: [gx, gy, height in levels].
// function eyeOf(a) {
//   const above = eyeLevelsBySpecies[a.species];
//   if (above === undefined) return alert(`senses: no eye height for ${a.species}`);
//   return [a.gx, a.gy, sim.heightAt(a.gx, a.gy) + above];
// }
//
// // Whether an eye at [ex, ey, ez] (from eyeOf) can see the ground at the center of tile (i, j).
// function canSeeTile(eye, i, j) {
//   const [ex, ey, ez] = eye;
//   let ci = Math.floor(ex), cj = Math.floor(ey);
//   if (ci === i && cj === j) return true; // its own tile
//   const tx = i + 0.5, ty = j + 0.5;
//   const dx = tx - ex, dy = ty - ey, dz = sim.heightAt(tx, ty) - ez;
//   const len2 = dx * dx + dy * dy;
//   // grid traversal: t (0 at the eye, 1 at the target) at which the line next crosses a
//   // vertical (i) and a horizontal (j) tile edge, and how much t each whole tile takes
//   const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1;
//   const tDeltaI = dx !== 0 ? Math.abs(1 / dx) : Infinity;
//   const tDeltaJ = dy !== 0 ? Math.abs(1 / dy) : Infinity;
//   let tMaxI = dx !== 0 ? (dx > 0 ? ci + 1 - ex : ex - ci) * tDeltaI : Infinity;
//   let tMaxJ = dy !== 0 ? (dy > 0 ? cj + 1 - ey : ey - cj) * tDeltaJ : Infinity;
//   for (let n = Math.abs(i - ci) + Math.abs(j - cj); n > 0; n--) {
//     if (tMaxI < tMaxJ) { ci += stepI; tMaxI += tDeltaI; } else { cj += stepJ; tMaxJ += tDeltaJ; }
//     if (ci === i && cj === j) return true; // reached it: nothing in between was in the way
//     // where the line comes nearest this tile's center, and how high it is there
//     let t = ((ci + 0.5 - ex) * dx + (cj + 0.5 - ey) * dy) / len2;
//     t = t < 0 ? 0 : t > 1 ? 1 : t;
//     if (sightHeightAt(ci, cj) > ez + dz * t) return false;
//   }
//   return true;
// }


// =============================== ANIMAT.JS ===============================
// Module variable, next to `let sim`:
//   let senses = null; // set by attach(), if given: for the line-of-sight overlay
//
// In makeTileElement:
//   - right after creating the tile element:   tile.gi = i; tile.gj = j;
//   - the top ground piece gets a class:
//       const top = groundPiece(shape, row, -groundBaseY);
//       top.classList.add("top"); // (blacked out when unseen)
//       tile.appendChild(top);
//
// In drawCritter, at the end:
//   // hidden on a tile the player's wolf can't see (the line-of-sight overlay)
//   setStyle(s.node, s.css, "display", standsUnseen(a) ? "none" : "");
//
// In render(), right after drawCamera():   drawSight();
//
// attach(theSim, theSenses = null): also
//   if (theSenses && typeof theSenses.canSeeTile !== "function")
//     return alert("animat.attach: that's not the senses (load senses.js)");
//   senses = theSenses;
//
// The interface: setSightOverlay (next to followWolf).
//
// The overlay itself (before CRITTER SPRITES):
// // LINE-OF-SIGHT OVERLAY (an experiment; see LINE OF SIGHT in senses.js): the tiles the
// // player's wolf can't see from its eyes are blacked out (their shape in pure black), and
// // without their obstacles, and any critter (or corpse) standing on one is hidden; the tiles it can see are drawn as usual. Only for the tiles on
// // screen. Worked out again at most every sightEveryS of game time while the wolf moves,
// // and for tiles as they come on screen. Off without senses (animat.attach(sim) alone), or
// // with setSightOverlay(false).
// // The black is baked into blacked-out copies of the tile sprites (spritecraft/
// // make_unseen_tiles.py): an unseen tile (class .unseen, see style.css) just shows its
// // ground pieces (its top and any cliff faces) from that sheet instead. Not a separate covering element: tiles share their layer with the
// // critter sprites (so ground in front can hide a critter), so that layer is repainted
// // whenever any critter moves, and thousands of extra see-through elements on it halve
// // the frame rate.
// const sightEveryS = 0.1;
// let sightOverlayOn = true;
// let sight = { gx: NaN, gy: NaN, tick: -Infinity, eye: null }; // the last eye position used
//
// function drawSight() {
//   if (!senses || !sightOverlayOn) return;
//   const w = sim.pcWolf;
//   const due = (w.gx !== sight.gx || w.gy !== sight.gy)
//     && sim.tickCount - sight.tick >= Math.round(sightEveryS / sim.tempo);
//   if (due) sight = { gx: w.gx, gy: w.gy, tick: sim.tickCount, eye: senses.eyeOf(w) };
//   if (!sight.eye) return;
//   for (const tile of renderedTiles.values()) {
//     if (tile.sightTick === sight.tick) continue; // up to date
//     tile.sightTick = sight.tick;
//     const unseen = !senses.canSeeTile(sight.eye, tile.gi, tile.gj);
//     if (tile.unseen !== unseen) { tile.classList.toggle("unseen", unseen); tile.unseen = unseen; }
//   }
// }
//
// // Show (or stop showing) the line-of-sight overlay.
// function setSightOverlay(on) {
//   sightOverlayOn = on;
//   if (!on) {
//     for (const tile of renderedTiles.values()) {
//       tile.classList.remove("unseen"); tile.unseen = false; tile.sightTick = undefined;
//     }
//   }
//   sight.tick = -Infinity; sight.gx = NaN; // work it out afresh when turned on
//   render(); // (critters on unseen tiles are shown or hidden again here too)
// }

// After drawCritter:
// // Whether critter a stands on a tile the line-of-sight overlay has blacked out.
// function standsUnseen(a) {
//   if (!senses || !sightOverlayOn || a === sim.pcWolf) return false;
//   const tile = renderedTiles.get(`${Math.floor(a.gx)}_${Math.floor(a.gy)}`);
//   return !!(tile && tile.unseen);
// }


// =============================== STYLE.CSS ===============================
// /* Line-of-sight overlay (see animat.js): a tile the player's wolf can't see gets the
//    .unseen class: its ground (top and any cliff faces below it) is drawn from blacked-out
//    copies of its sprites (their shapes in pure black; made by spritecraft/
//    make_unseen_tiles.py) and its boulder is hidden. */
// .unseen > .ground { background-image: url('./images/ground-slopes-unseen.png'); }
// .tile.water.unseen {
//   background-image: url('./images/water-unseen.png');
//   background-position: 0 0;
// }
// .unseen > .boulder { display: none; }
