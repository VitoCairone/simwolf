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
//  - the sight range's edge is drawn as a true ellipse (the circle at the height of the
//    ground under the wolf): just inside it in colour, just outside without
//  - shadows are where a standing deer could hide: a cliff hides a deer on top of its block
//    (but near its edge) and behind it from below, its shadow's sides straight lines from
//    the eye past the cliff's ends; a step a level down hides none (no shadow below it)
//  - high ground beyond the range, drawn where the circle at the wolf's height would take
//    it in, is out of sight all the same
//  - ground it saw before but can't see now (behind the boulder, once it has moved) is
//    greyed out: drawn without colour, darker, not black; a tile seen even in part is never
//    black again; nothing (undergrowth) is drawn on ground never seen
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
    return { state: animat.tileSight(i, j), sees: animat.sightSees(i + 0.5, j + 0.5), at: animat.worldToScreen(px, py - sim.heightAt(i + 0.5, j + 0.5) * 8) };
  }, behind);
  const [greyPx] = await pixels(p, [greyed.at]);
  r.check((greyed.state === "greyed" || greyed.state === "part") && !greyed.sees && colourOf(greyPx) <= 3 && brightnessOf(greyPx) > 20,
    `ground it saw before, now behind the boulder, is greyed out: no colour, not black (${greyed.state}, ${greyPx})`);

  // never seen: black, the tile and beyond the map (at zoom 1, far to the screen's right)
  const far = await p.evaluate(() => {
    animat.setZoom(1);
    const w = sim.pcWolf;
    for (let k = 40; k >= 36; k -= 2) { // (beyond its sight circle, 23.9 tiles, and on screen)
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

  // ground once seen, even in part, is never black again: what any of the tiles about the
  // boulder shows from south of it, seen again from west of it, now partly in its shadow
  const memory = await p.evaluate(([bi, bj]) => {
    const seenAny = [];
    __wolfTo(bi + 0.5, bj + 4.5);
    for (let i = bi - 10; i <= bi + 10; i++) for (let j = bj - 10; j <= bj + 10; j++) {
      let any = false;
      for (let a = 0; a <= 2 && !any; a++) for (let b = 0; b <= 2 && !any; b++) any = animat.sightSees(i + a / 2, j + b / 2);
      if (any) seenAny.push([i, j]);
    }
    __wolfTo(bi + 0.5 - 3, bj + 0.7);
    const black = seenAny.filter(([i, j]) => animat.tileSight(i, j) === "black");
    // and drawn so: the middle of each such tile out of sight, not black
    const unseen = seenAny.filter(([i, j]) => !animat.sightSees(i + 0.5, j + 0.5) && !sim.obstacleAt(i, j)).slice(0, 20).map(([i, j]) => {
      const [px, py] = animat.isoProject(i + 0.5, j + 0.5);
      return animat.worldToScreen(px, py - sim.heightAt(i + 0.5, j + 0.5) * 8);
    });
    return { seen: seenAny.length, black, unseen };
  }, at.B);
  const memPx = await pixels(p, memory.unseen);
  r.check(memory.seen > 50 && memory.black.length === 0 && memPx.every(px => brightnessOf(px) > 20),
    `ground once seen, even in part, is never black again: of ${memory.seen} tiles seen from south of the boulder, ` +
    `none black from west of it (${JSON.stringify(memory.black.slice(0, 5))}), ${memPx.length} out of sight drawn grey (darkest ${Math.min(...memPx.map(brightnessOf))})`);

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

  // the sight range's edge: a true ellipse on screen (the circle at the floor's height);
  // probes just inside and just outside it, where nothing else hides the ground
  const range = await p.evaluate(([bi, bj]) => {
    const S = sim.internals, w = sim.pcWolf, wi = bi - 14, wj = bj + 12, L = sim.tileCorners(wi, wj)[0];
    for (let di = -30; di <= 30; di++) for (let dj = -30; dj <= 30; dj++) { S.setTileCorners(wi + di, wj + dj, [L, L, L, L]); S.setBoulder(wi + di, wj + dj, false); }
    sim.allCritters.filter(c => c !== w).forEach(c => { c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; });
    __put(w, wi + 0.5, wj + 0.5); w.hx = 1; w.hy = 0;
    animat.followWolf(); animat.setZoom(1); animat.redrawTerrain();
    for (let k = 0; k < 12; k++) S.tick(); for (let k = 0; k < 40; k++) animat.render();
    const f = animat.sightField(), out = [];
    for (let k = 0; k < 180; k++) {
      const a = k * Math.PI / 90, ux = Math.cos(a), uy = Math.sin(a);
      if (!senses.inView(w, ux, uy)) continue;
      const ins = [f.ex + ux * (f.R - 0.4), f.ey + uy * (f.R - 0.4)], outs = [f.ex + ux * (f.R + 0.4), f.ey + uy * (f.R + 0.4)];
      if (!animat.sightSees(...ins) || !animat.sightSees(f.ex + ux * (f.R - 1.5), f.ey + uy * (f.R - 1.5))) continue;
      let rock = false;
      for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) if (sim.obstacleAt(Math.floor(outs[0]) + di, Math.floor(outs[1]) + dj)) rock = true;
      // (level ground there, with no undergrowth: the pixel is the ground's)
      for (const [x, y] of [ins, outs]) {
        if (Math.abs(sim.heightAt(x, y) - f.floor) > 0.25) rock = true;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (animat.undergrowthOf(Math.floor(x) + di, Math.floor(y) + dj)) rock = true;
      }
      if (rock) continue;
      const flat = ([x, y]) => { const [px, py] = animat.isoProject(x, y); return animat.worldToScreen(px, py - f.floor * 8); };
      const q = { a: k * 2, ins: flat(ins), outs: flat(outs) };
      if ([q.ins, q.outs].every(([x, y]) => x > 160 && x < innerWidth - 10 && y > 10 && y < innerHeight - 10)) out.push(q);
    }
    return out;
  }, at.B);
  const rangePx = await pixels(p, range.flatMap(q => [q.ins, q.outs]));
  const rangeBad = range.filter((q, k) => !(colourOf(rangePx[2 * k]) > 20 && colourOf(rangePx[2 * k + 1]) <= 3));
  r.check(range.length >= 10 && rangeBad.length === 0,
    `the sight range's edge is a true ellipse: in colour just inside it, without colour just outside (${range.length} probes; wrong at ${rangeBad.map(q => q.a + " deg")})`);
  await p.screenshot({ path: path.join(outDir, "range.png") });

  // a cliff: a block of land 8 levels up, 7 tiles wide, 6 east of the wolf (on level ground
  // otherwise), hides a deer standing on its top (but near its edge) or behind it from the
  // wolf below it, between straight lines from its eye past the cliff's ends; just outside
  // them the ground beside the block is in colour
  const cliff = await p.evaluate(([bi, bj]) => {
    const S = sim.internals, w = sim.pcWolf, wi = bi - 14, wj = bj + 12, L = sim.tileCorners(wi, wj)[0];
    for (let di = -2; di <= 26; di++) for (let dj = -12; dj <= 12; dj++) {
      const up = di >= 6 && di <= 12 && dj >= -3 && dj <= 3 ? 8 : 0;
      S.setTileCorners(wi + di, wj + dj, [L + up, L + up, L + up, L + up]); S.setBoulder(wi + di, wj + dj, false);
    }
    sim.allCritters.filter(c => c !== w).forEach(c => { c.gx = c.gy = c.nextGX = c.nextGY = -500 - c.uid * 3; });
    __put(w, wi + 0.5, wj + 0.5); w.hx = 1; w.hy = 0;
    animat.followWolf(); animat.setZoom(1); animat.redrawTerrain();
    for (let k = 0; k < 12; k++) S.tick(); for (let k = 0; k < 40; k++) animat.render();
    const ex = w.gx, ey = w.gy, out = [], deer = senses.eyeLevelsBySpecies.deer;
    // the lateral lines past the cliff's ends, (wi + 6, wj - 3) and (wi + 6, wj + 4), on the
    // ground behind the block, 16 east
    for (const [cx, cy, way] of [[wi + 6, wj - 3, -1], [wi + 6, wj + 4, 1]]) {
      const x = wi + 16, y = ey + (cy - ey) * (x - ex) / (cx - ex);
      for (const [inside, off] of [[true, -0.3], [false, 0.3]]) {
        const py0 = y + way * off, z = L;
        const [px, py] = animat.isoProject(x, py0);
        out.push({ inside, sees: senses.canSeePoint(w, x, py0, z + deer), drawn: animat.sightSees(x, py0), at: animat.worldToScreen(px, py - z * 8) });
      }
    }
    // on the block's top, toward its back; and near its edge (a deer there seen, its head above it)
    for (const [x, inside] of [[wi + 11.5, true], [wi + 6.3, false]]) {
      const [px, py] = animat.isoProject(x, wj + 0.5);
      out.push({ inside, sees: senses.canSeePoint(w, x, wj + 0.5, L + 8 + deer), drawn: animat.sightSees(x, wj + 0.5), at: animat.worldToScreen(px, py - (L + 8) * 8) });
    }
    return out;
  }, at.B);
  const cliffPx = await pixels(p, cliff.map(q => q.at));
  await p.screenshot({ path: path.join(outDir, "cliff.png") });
  r.check(cliff.every((q, k) => q.sees === !q.inside && q.drawn === !q.inside && (q.inside ? colourOf(cliffPx[k]) <= 3 : colourOf(cliffPx[k]) > 20)),
    `a cliff 8 levels up hides a deer standing on its block (but near its edge) or behind it from the wolf below, between straight lines from its eye past the cliff's ends ` +
    `(${cliff.map((q, k) => `${q.inside ? "in" : "out"} sees ${q.sees} drawn ${q.drawn} ${colourOf(cliffPx[k])}`).join(", ")})`);

  // a step a level down, 6 tiles east of the wolf: the ground just below it is out of its
  // sight, but a deer standing there would be seen: no shadow, drawn in colour
  const step = await p.evaluate(([bi, bj]) => {
    const S = sim.internals, w = sim.pcWolf, wi = bi - 14, wj = bj + 12, L = sim.tileCorners(wi, wj)[0], deer = senses.eyeLevelsBySpecies.deer;
    for (let di = -30; di <= 30; di++) for (let dj = -30; dj <= 30; dj++) {
      const z = di < 6 ? L + 1 : L;
      S.setTileCorners(wi + di, wj + dj, [z, z, z, z]); S.setBoulder(wi + di, wj + dj, false);
    }
    __put(w, wi + 0.5, wj + 0.5); w.hx = 1; w.hy = 0;
    animat.redrawTerrain();
    for (let k = 0; k < 12; k++) S.tick(); for (let k = 0; k < 40; k++) animat.render();
    const out = [];
    for (const x of [6.4, 6.8, 7.5]) for (const dy of [-2, 0, 2]) {
      const gx = wi + x, gy = wj + 0.5 + dy, [px, py] = animat.isoProject(gx, gy);
      out.push({ ground: senses.canSeePoint(w, gx, gy), deer: senses.canSeePoint(w, gx, gy, L + deer), drawn: animat.sightSees(gx, gy),
        at: animat.worldToScreen(px, py - L * 8) });
    }
    return out;
  }, at.B);
  const stepPx = await pixels(p, step.map(q => q.at));
  r.check(step.some(q => !q.ground) && step.every((q, k) => q.deer && q.drawn && colourOf(stepPx[k]) > 20),
    `a step a level down casts no shadow: the ground just below it partly out of sight (${step.filter(q => !q.ground).length} of ${step.length}), ` +
    `but a deer there would be seen, and it is drawn in colour (${step.map((q, k) => colourOf(stepPx[k]))})`);

  // high ground beyond the range, 12 levels up, 27 tiles or more ahead of the wolf and
  // behind it: drawn where the circle at the wolf's height would take it in, but out of
  // sight all the same (no colour)
  const high = await p.evaluate(([bi, bj]) => {
    const S = sim.internals, w = sim.pcWolf, wi = bi - 14, wj = bj + 12, L = sim.tileCorners(wi, wj)[0];
    for (let di = -34; di <= 34; di++) for (let dj = -12; dj <= 12; dj++) {
      const z = Math.abs(di) >= 27 ? L + 12 : L;
      S.setTileCorners(wi + di, wj + dj, [z, z, z, z]); S.setBoulder(wi + di, wj + dj, false);
    }
    __put(w, wi + 0.5, wj + 0.5); w.hx = 1; w.hy = 0;
    animat.redrawTerrain();
    for (let k = 0; k < 12; k++) S.tick(); for (let k = 0; k < 40; k++) animat.render();
    const f = animat.sightField(), out = [];
    for (const di of [-29, -28, 28, 29]) for (const dj of [-4, 0, 4]) {
      const gx = wi + di + 0.5, gy = wj + dj + 0.5, [px, py] = animat.isoProject(gx, gy);
      // (where the circle at the wolf's height would have it: within the ellipse)
      const flat = Math.hypot(gx - (L + 12 - f.floor) * 0.5 - f.ex, gy - (L + 12 - f.floor) * 0.5 - f.ey) < f.R;
      const at = animat.worldToScreen(px, py - (L + 12) * 8);
      if (flat && at[0] > 160 && at[0] < innerWidth && at[1] > 0 && at[1] < innerHeight) out.push({ di, dj, at, beyond: Math.hypot(gx - f.ex, gy - f.ey) > f.R });
    }
    return out;
  }, at.B);
  const highPx = await pixels(p, high.map(q => q.at));
  await p.screenshot({ path: path.join(outDir, "high.png") });
  r.check(high.length >= 4 && high.every((q, k) => q.beyond && colourOf(highPx[k]) <= 3),
    `high ground beyond the range, ahead and behind, drawn within the circle at the wolf's height, is out of sight: ${high.length} probes, colour ${high.map((q, k) => `${q.di},${q.dj}: ${colourOf(highPx[k])}`)}`);

  // nothing drawn on ground never seen: undergrowth there (in the midst of ground never
  // seen) shows black, like the ground
  const unseenPlants = await p.evaluate(() => {
    // (somewhere new: a land tile with undergrowth 200 tiles off, or more)
    const S = sim.internals, w = sim.pcWolf, out = [];
    const far = S.allLandTiles.find(([i, j]) => Math.abs(i - w.gx) + Math.abs(j - w.gy) > 200 && animat.undergrowthOf(i + 3, j + 3) && animat.undergrowthOf(i - 3, j - 3) && !sim.obstacleAt(i, j));
    __put(w, far[0] + 0.5, far[1] + 0.5);
    animat.setZoom(1);
    for (let k = 0; k < 12; k++) S.tick(); for (let k = 0; k < 40; k++) animat.render();
    for (const t of animat.tilesInView()) {
      const { i, j } = t;
      let alone = true;
      for (let a = -1; a <= 1 && alone; a++) for (let b = -1; b <= 1 && alone; b++) if (animat.sightSeen(i + a, j + b) || animat.tileSight(i + a, j + b) !== "black") alone = false;
      const u = alone && animat.undergrowthOf(i, j);
      if (u) out.push(animat.worldToScreen(u.left + 16, u.top + 20));
      if (out.length >= 20) break;
    }
    return out;
  });
  const plantPx = await pixels(p, unseenPlants);
  r.check(unseenPlants.length >= 3 && plantPx.every(px => brightnessOf(px) <= 12),
    `undergrowth on ground never seen isn't drawn: ${unseenPlants.length} plants, the brightest at their middles ${Math.max(...plantPx.map(brightnessOf))}`);

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "sight view", main };
if (require.main === module) runStandalone(module.exports.name, main);
