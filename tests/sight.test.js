// The sight view (see SIGHT VIEW in animat.js): while the camera follows the player's
// wolf, the view shows what it sees.
//  - on while the camera follows the player's wolf, off once it is panned
//  - ground it has never seen is black, and so are the map's surroundings
//  - the wolf sees only within its field of view (about 250 degrees about its heading):
//    beyond it the ground is drawn without colour, along straight lines from its eye
//  - a lone boulder casts a shadow as wide as the rock (not its whole tile: its span across
//    the line of sight, from its sprite), with straight edges, where the lines of sight
//    from the wolf's eye past the rock's edges run: just inside them the ground is drawn
//    without colour (greyed out, or black where never seen), just outside in colour
//  - the boulder hides the part of its own tile beyond its center too
//  - on water as on land, the field of view's edges run straight
//  - a tile seen before but now partly out of sight is shown as seen when a deer standing
//    on it would be seen and no obstacle hides any of it (the terrain's own shadows round
//    to whole tiles), and is split into seen and greyed parts otherwise
//  - ground it saw before but can't see now (behind the boulder, once it has moved) is
//    greyed out: drawn without colour, darker, not black
//  - a deer behind the boulder isn't drawn (nor picked by a click), one in sight is
//  - with the camera panned, everything is drawn as usual again
// Saves a screenshot to tests/output/sight/.

const path = require("path");
const { openGame, runStandalone, ensureOutputDir } = require("./helpers");

// The colours (r, g, b) on screen at client points pts.
async function pixels(page, pts) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async ([png, pts]) => {
    const im = new Image();
    im.src = "data:image/png;base64," + png;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3));
  }, [png, pts]);
}
const colourOf = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const brightnessOf = ([r, g, b]) => Math.max(r, g, b);

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 1100, height: 750 } });
  const outDir = ensureOutputDir("sight");

  // a lone boulder on grass or dirt, the ground about level, nothing else near; the wolf
  // west of it
  const at = await p.evaluate(() => {
    sim.pause();
    const S = sim.internals, R = 6, A = sim.startNear;
    const tiles = [];
    for (let i = A.i0; i < A.i1; i++) for (let j = A.j0; j < A.j1; j++) tiles.push([i, j]);
    const B = tiles.find(([i, j]) => {
      if (sim.obstacleAt(i, j) !== "boulder") return false;
      const level = sim.tileCorners(i, j)[0];
      for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
        const t = sim.getTerrainAt(i + di, j + dj);
        if (t === "water" || t === "stone" || (di || dj) && sim.isBlockedTile(i + di, j + dj)) return false;
        if (sim.tileCorners(i + di, j + dj).some(c => Math.abs(c - level) > 1)) return false;
      }
      return true;
    });
    if (!B) return null;
    const w = sim.pcWolf;
    sim.allCritters.filter(c => c !== w).forEach(c => {
      c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; c.speed = 0; mind.ignore(c);
    });
    mind.ignore(w);
    window.__put = (c, x, y) => {
      c.gx = c.nextGX = x; c.gy = c.nextGY = y; c.speed = 0; c.stunnedUntil = 0; c.climbingUntil = -1;
      S.setCritterIdle(c);
    };
    // first north of the boulder, then west of it, facing it: the sight view works out what it sees
    // afresh some ticks after the wolf moves
    // (and paints a few chunks' masks a frame)
    // (facing the boulder)
    window.__wolfTo = (x, y) => { __put(w, x, y);
      const dx = B[0] + 0.5 - x, dy = B[1] + 0.5 - y, l = Math.hypot(dx, dy); w.hx = dx / l; w.hy = dy / l;
      for (let k = 0; k < 12; k++) S.tick(); for (let k = 0; k < 40; k++) animat.render(); };
    animat.setZoom(2); animat.followWolf();
    __wolfTo(B[0] + 0.5, B[1] + 0.5 - 4);
    __wolfTo(B[0] + 0.5 - 3, B[1] + 0.7);
    return { B, eye: [w.gx, w.gy] };
  });
  if (!at) { r.check(false, "a lone boulder on level open ground to test by"); r.noProblems(p); await p.close(); return; }
  const [bi, bj] = at.B, [ex, ey] = at.eye;

  const onView = await p.evaluate(() => animat.sightViewOn());
  r.check(onView, "the sight view is on while the camera follows the player's wolf");

  // the shadow's edges: where lines from the eye pass the boulder's center just at the
  // rock's edges (its span across their direction: sim.obstacleAcross), found along
  // cross-lines 2.5 and 4.5 tiles past the boulder's center; points just inside and just
  // outside each. And the shadow the whole tile would cast there (past its outermost
  // corners), for comparison.
  const edgesAt = await p.evaluate(([bi, bj, ex, ey]) => {
    const cx = bi + 0.5, cy = bj + 0.5, l = Math.hypot(cx - ex, cy - ey), ux = (cx - ex) / l, uy = (cy - ey) / l;
    const at = (s, L) => [ex + ux * s - uy * L, ey + uy * s + ux * L];
    // how a line from the eye to (x, y) passes the boulder: inside the rock's span or not (as senses.js: walkLine)
    const passes = (x, y) => {
      const dx = x - ex, dy = y - ey, dir = sim.getDir(dx, dy), [vx, vy] = sim.moveVecByDir[dir];
      const t = ((cx - ex) * dx + (cy - ey) * dy) / (dx * dx + dy * dy);
      const off = (ex + dx * t - cx) * -vy + (ey + dy * t - cy) * vx, [lo, hi] = sim.obstacleAcross(bi, bj, dir);
      return off >= lo && off <= hi;
    };
    const out = [];
    for (const past of [2.5, 4.5]) {
      const s = l + past, edge = [];
      for (const way of [-1, 1]) { // bisect from the middle (inside) outward
        let a = 0, b = 3 * way;
        for (let n = 0; n < 30; n++) { const m = (a + b) / 2; if (passes(...at(s, m))) a = m; else b = m; }
        edge.push(a);
      }
      // the whole tile's shadow there: its corners' lateral offsets, scaled out to s
      const lat = [[bi, bj], [bi + 1, bj], [bi, bj + 1], [bi + 1, bj + 1]].map(([x, y]) => {
        const along = (x - ex) * ux + (y - ey) * uy, side = -(x - ex) * uy + (y - ey) * ux;
        return side * s / along;
      });
      out.push({ s, edge, rock: edge[1] - edge[0], tile: Math.max(...lat) - Math.min(...lat), at: [-1, 1].map((w, k) => [at(s, edge[k] + 0.15 * w), at(s, edge[k] - 0.15 * w)]) });
    }
    return out;
  }, [bi, bj, ex, ey]);
  const probes = [];
  for (const e of edgesAt) for (const [outside, inside] of e.at) {
    probes.push({ inside: true, x: inside[0], y: inside[1] });
    probes.push({ inside: false, x: outside[0], y: outside[1] });
  }
  r.check(edgesAt.every(e => e.rock < 0.85 * e.tile),
    `a boulder's shadow is as wide as the rock, narrower than its tile's would be (${edgesAt.map(e => `${e.rock.toFixed(2)} vs ${e.tile.toFixed(2)} tiles, ${(e.s - edgesAt[0].s + 2.5).toFixed(1)} past it`).join("; ")})`);
  const sightOf = await p.evaluate(probes => probes.map(q => {
    const [px, py] = animat.isoProject(q.x, q.y);
    return { sees: senses.canSeePoint(sim.pcWolf, q.x, q.y),
      at: animat.worldToScreen(px, py - sim.heightAt(q.x, q.y) * 8) };
  }), probes);
  const shadowPx = await pixels(p, sightOf.map(s => s.at));
  const okSenses = probes.every((q, k) => sightOf[k].sees === !q.inside);
  r.check(okSenses, `the wolf's senses: the ground just inside the lines past the rock's edges is hidden, just outside seen`);
  const okDrawn = probes.every((q, k) => q.inside ? colourOf(shadowPx[k]) <= 3 : colourOf(shadowPx[k]) > 20);
  r.check(okDrawn, `drawn so: in its shadow without colour, just beside it in colour, along two straight lines ` +
    `(${probes.map((q, k) => `${q.inside ? "in" : "out"} ${colourOf(shadowPx[k])}`).join(", ")})`);
  await p.screenshot({ path: path.join(outDir, "boulder-shadow.png") });

  // the boulder's own tile: hidden beyond its center, the shadow going on from the tiles
  // behind; seen before it
  const own = await p.evaluate(([bi, bj]) => {
    const w = sim.pcWolf, cx = bi + 0.5, cy = bj + 0.5, dx = cx - w.gx, dy = cy - w.gy, l = Math.hypot(dx, dy);
    const at = k => senses.canSeePoint(w, cx + dx / l * k, cy + dy / l * k);
    return { before: at(-0.4), beyond: at(0.4), next: at(0.9), state: animat.tileSight(bi, bj) };
  }, at.B);
  r.check(own.before && !own.beyond && !own.next && own.state === "part",
    `the boulder hides the part of its own tile beyond its center, as it does the tiles behind (before ${own.before}, beyond ${own.beyond}, ` +
    `the next tile ${own.next}): the tile is split, the shadow drawn on it too (${own.state})`);

  // a tile seen before, but not all of it now, is shown as seen when a deer standing on it
  // would be seen and no obstacle (nor the edge of its field of view) hides any of it;
  // split (partly greyed) only otherwise
  const rounding = await p.evaluate(() => {
    const w = sim.pcWolf, R = 24, deerEye = senses.eyeLevelsBySpecies.deer;
    const out = { rounded: 0, wrong: [] };
    for (let i = Math.floor(w.gx) - R; i <= w.gx + R; i++) for (let j = Math.floor(w.gy) - R; j <= w.gy + R; j++) {
      if (i < 0 || j < 0 || i >= sim.gridWidthN || j >= sim.gridHeightN || sim.obstacleAt(i, j)) continue;
      const state = animat.tileSight(i, j);
      if (state !== "seen" && state !== "part") continue;
      const hidden = [];
      for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++)
        if (!senses.canSeePoint(w, i + a / 2, j + b / 2)) hidden.push([i + a / 2, j + b / 2]);
      if (!hidden.length) continue;
      const deer = senses.canSeePoint(w, i + 0.5, j + 0.5, sim.heightAt(i + 0.5, j + 0.5) + deerEye);
      const rock = hidden.some(([x, y]) => senses.obstacleInWay(w, x, y) || !senses.inView(w, x - w.gx, y - w.gy));
      if (state === "seen") out.rounded++;
      if ((state === "seen") !== (deer && !rock)) out.wrong.push([i, j, state, deer, rock]);
    }
    return out;
  });
  r.check(rounding.rounded > 0 && rounding.wrong.length === 0,
    `a tile partly out of sight is shown as seen when a deer on it would be seen and no obstacle hides any of it, ` +
    `else split (${rounding.rounded} shown as seen; wrong: ${JSON.stringify(rounding.wrong.slice(0, 5))})`);

  // the edges of its field of view: just inside each, 3 tiles out, in colour; just outside,
  // without colour (greyed, or black where never seen)
  const fov = await p.evaluate(() => {
    const w = sim.pcWolf, half = senses.fovDegBySpecies.wolf / 2 * Math.PI / 180, h = Math.atan2(w.hy, w.hx), out = [];
    for (const side of [1, -1]) for (const [inside, off] of [[true, -0.15], [false, 0.15]]) {
      const a = h + side * half, x = w.gx + 3 * Math.cos(a) - side * off * Math.sin(a), y = w.gy + 3 * Math.sin(a) + side * off * Math.cos(a);
      const [px, py] = animat.isoProject(x, y);
      out.push({ inside, view: senses.inView(w, x - w.gx, y - w.gy), at: animat.worldToScreen(px, py - sim.heightAt(x, y) * 8) });
    }
    return out;
  });
  const fovPx = await pixels(p, fov.map(q => q.at));
  r.check(fov.every((q, k) => q.view === q.inside && (q.inside ? colourOf(fovPx[k]) > 20 : colourOf(fovPx[k]) <= 3)),
    `its field of view (${await p.evaluate(() => senses.fovDegBySpecies.wolf)} degrees) ends along two straight lines: in colour just inside them, without colour just outside ` +
    `(${fov.map((q, k) => `${q.inside ? "in" : "out"} ${colourOf(fovPx[k])}`).join(", ")})`);

  // ground seen from the north, now behind the boulder: greyed out
  const behind = [bi + 3, bj + 0];
  const greyed = await p.evaluate(([i, j]) => {
    const [px, py] = animat.isoProject(i + 0.5, j + 0.5);
    return { state: animat.tileSight(i, j), at: animat.worldToScreen(px, py - sim.heightAt(i + 0.5, j + 0.5) * 8) };
  }, behind);
  const [greyPx] = await pixels(p, [greyed.at]);
  r.check(greyed.state === "greyed" && colourOf(greyPx) <= 3 && brightnessOf(greyPx) > 20,
    `ground it saw before, now behind the boulder, is greyed out: no colour, not black (${greyed.state}, ${greyPx})`);

  // never seen: black, the tile and beyond the map (at zoom 1, far to the screen's right)
  const far = await p.evaluate(() => {
    animat.setZoom(1);
    const w = sim.pcWolf;
    for (let k = 34; k >= 24; k -= 2) {
      const i = Math.floor(w.gx) + k / 2, j = Math.floor(w.gy) - k / 2;
      if (animat.tileSight(i, j) !== "black") continue;
      const [px, py] = animat.isoProject(i + 0.5, j + 0.5);
      return { i, j, at: animat.worldToScreen(px, py - sim.heightAt(i + 0.5, j + 0.5) * 8) };
    }
    return null;
  });
  const [farPx] = far ? await pixels(p, [far.at]) : [null];
  r.check(far && brightnessOf(farPx) <= 3, `ground it has never seen is black (${far && farPx})`);
  await p.evaluate(() => animat.setZoom(2));

  // a deer behind the boulder isn't drawn, one in sight is
  const deer = await p.evaluate(([bi, bj]) => {
    const [d1, d2] = sim.allCritters.filter(c => c.species === "deer" && sim.isLiveCritter(c));
    __put(d1, bi + 4.5, bj + 0.6); __put(d2, bi - 2.5, bj - 3);
    animat.render();
    const r1 = animat.spriteOf(d1), r2 = animat.spriteOf(d2);
    const mid = rec => { const s = animat.spriteRect(rec); return [(s.left + s.right) / 2, (s.top + s.bottom) / 2]; };
    return { hidden: r1.hidden, shown: !r2.hidden,
      pickHidden: animat.critterAtScreen(...mid(r1)) === d1, pickShown: animat.critterAtScreen(...mid(r2)) === d2 };
  }, at.B);
  r.check(deer.hidden && !deer.pickHidden, `a deer behind the boulder isn't drawn, nor picked by a click (${JSON.stringify(deer)})`);
  r.check(deer.shown && deer.pickShown, "a deer in sight is drawn");

  // on water too, the field of view ends along straight lines: a wolf swimming in a lake,
  // having looked about, faces along +i; just inside each edge in colour, just outside
  // without (at several distances, through tiles split between the two)
  const lake = await p.evaluate(() => {
    const A = sim.startNear, w = sim.pcWolf;
    let L = null;
    for (let i = A.i0; i < A.i1 && !L; i++) for (let j = A.j0; j < A.j1 && !L; j++) {
      let ok = true;
      for (let di = -6; di <= 6 && ok; di++) for (let dj = -6; dj <= 6 && ok; dj++) ok = sim.waterKindAt(i + di, j + dj) === "lake";
      if (ok) L = [i, j];
    }
    if (!L) return null;
    for (const [hx, hy] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) {
      __put(w, L[0] + 0.5, L[1] + 0.5); w.hx = hx; w.hy = hy;
      for (let k = 0; k < 12; k++) sim.internals.tick(); for (let k = 0; k < 40; k++) animat.render();
    }
    const half = senses.fovDegBySpecies.wolf / 2 * Math.PI / 180, h = Math.atan2(w.hy, w.hx), out = [];
    for (const side of [1, -1]) for (const d of [2.3, 3.1, 3.9, 4.7]) for (const [inside, off] of [[true, -0.2], [false, 0.2]]) {
      const a = h + side * half, x = w.gx + d * Math.cos(a) - side * off * Math.sin(a), y = w.gy + d * Math.sin(a) + side * off * Math.cos(a);
      const [px, py] = animat.isoProject(x, y);
      out.push({ inside, view: senses.inView(w, x - w.gx, y - w.gy), state: animat.tileSight(Math.floor(x), Math.floor(y)),
        at: animat.worldToScreen(px, py - sim.waterLevelAt(Math.floor(x), Math.floor(y)) * 8 + 8) });
    }
    return out;
  });
  const lakePx = lake ? await pixels(p, lake.map(q => q.at)) : [];
  if (lake) await p.screenshot({ path: path.join(outDir, "lake-view.png") });
  r.check(lake && lake.some(q => q.state === "part") && lake.every((q, k) => q.view === q.inside && (q.inside ? colourOf(lakePx[k]) > 20 : colourOf(lakePx[k]) <= 3)),
    `on a lake too its field of view ends along straight lines, through split tiles ` +
    `(${lake && lake.map((q, k) => `${q.inside ? "in" : "out"} ${q.state} ${colourOf(lakePx[k])}`).join(", ")})`);

  // panned: as usual
  const panned = await p.evaluate(() => { animat.panCamera(1, 0); animat.render(); return animat.sightViewOn(); });
  const [panPx] = await pixels(p, [greyed.at.map((v, k) => v - (k === 0 ? 2 : 0))]); // (the camera moved 1 px at zoom 2)
  const deerBack = await p.evaluate(() => sim.allCritters.filter(c => c.species === "deer" && sim.isLiveCritter(c)).slice(0, 1).map(d => animat.spriteOf(d).hidden)[0]);
  r.check(!panned && colourOf(panPx) > 20 && deerBack === false,
    `panned away from the wolf, everything is drawn as usual (${panned}, ${panPx}, hidden deer ${deerBack})`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "sight view", main };
if (require.main === module) runStandalone(module.exports.name, main);
