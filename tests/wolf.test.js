// The wolf's sprites and the player's wolf (see SPRITE SHEETS in animat.js,
// spritecraft/extract_wolf_sheet.py, and THE PLAYER'S WOLF in sim.js):
//  - images/wolf-land.png holds the artist's frames (images_raw/wolf-all.png): run, idle,
//    howl, death and bite for the 4 diagonals, the run shifted to the others' ground point
//  - they play at the artist's timing (images_raw/5V5aC4.gif): the gallop 70 ms a frame,
//    the idle 200, the death 100 (once, then the corpse holds its last frame)
//  - the death faces the nearest diagonal, the next one clockwise between two
//  - every wolf dies to its death animation and a corpse, the player's too; the dead
//    player's wolf stays the player's (the arrow toggle brings the camera to its corpse,
//    and the arrows move nothing) until the next wolf is born, which becomes the
//    player's wolf, the camera going to it

const fs = require("fs");
const path = require("path");
const { ROOT, openGame, moveToOpenLand, runStandalone } = require("./helpers");
// (as data URLs: a page from file:// can't read back the pixels of its own images)
const dataUrl = file => "data:image/png;base64," + fs.readFileSync(path.join(ROOT, file)).toString("base64");

// our sheet row -> the artist's row within each animation (see extract_wolf_sheet.py)
const ARTIST_ROW_OF = [3, 1, 0, 2];
// animation: artist's first row, artist's first column, our first column, frames
const ANIMS = { idle: [12, 11, 8, 4], howl: [8, 0, 12, 9], death: [4, 0, 21, 12], bite: [0, 0, 33, 15], run: [12, 0, 0, 8] };
const RUN_SHIFT = { 3: [2, 1], 0: [-2, 1] };

async function main(browser, r) {
  const p = await openGame(browser, { viewport: { width: 800, height: 600 } });
  await p.evaluate(() => sim.pause());

  // the sheet against the artist's
  const sheet = await p.evaluate(async ({ ANIMS, ARTIST_ROW_OF, RUN_SHIFT, oursUrl, artUrl }) => {
    const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const pixels = im => {
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      return { w: im.width, h: im.height, d: g.getImageData(0, 0, im.width, im.height).data };
    };
    const ours = pixels(await load(oursUrl));
    const art = pixels(await load(artUrl));
    const px = (P, x, y) => (x < 0 || y < 0 || x >= P.w || y >= P.h) ? 0 : (P.d[(y * P.w + x) * 4 + 3] ? P.d.slice((y * P.w + x) * 4, (y * P.w + x) * 4 + 4).join() : 0);
    let bad = 0, frames = 0;
    for (const [name, [ar0, ac0, oc0, n]] of Object.entries(ANIMS)) {
      for (let row = 0; row < 4; row++) for (let k = 0; k < n; k++) {
        const [sx, sy] = name === "run" && RUN_SHIFT[row] ? RUN_SHIFT[row] : [0, 0];
        frames++;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const ax = x - sx, ay = y - sy;
          const a = ax < 0 || ay < 0 || ax >= 64 || ay >= 64 ? 0 : px(art, (ac0 + k) * 64 + ax, (ar0 + ARTIST_ROW_OF[row]) * 64 + ay);
          if (a !== px(ours, (oc0 + k) * 64 + x, row * 64 + y)) bad++;
        }
      }
    }
    return { w: ours.w, h: ours.h, bad, frames };
  }, { ANIMS, ARTIST_ROW_OF, RUN_SHIFT, oursUrl: dataUrl("images/wolf-land.png"), artUrl: dataUrl("images_raw/wolf-all.png") });
  r.check(sheet.w === 48 * 64 && sheet.h === 7 * 64 && sheet.bad === 0,
    `the wolf's sheet holds the artist's ${sheet.frames} diagonal frames exactly (${sheet.bad} pixels differ), the run shifted to the others' ground point`);

  await moveToOpenLand(p, { radius: 6, clearOthers: true });
  // timing: the gallop, idle and death columns tick by tick
  const timing = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    mind.ignore(w);
    const watch = (n, before = () => {}) => {
      const cols = [];
      for (let k = 0; k < n; k++) {
        before(); S.tick(); animat.render();
        cols.push(Math.round(-parseFloat(animat.spriteEl(w).style.backgroundPosition) / 64));
      }
      return cols;
    };
    const runs = cols => { const out = []; for (const c of cols) { if (out.length && out.at(-1)[0] === c) out.at(-1)[1]++; else out.push([c, 1]); } return out; };
    // idle
    const idle = runs(watch(110)).slice(1, -1);
    // gallop, from a gallop started a while ago
    w.wind = w.stamina = 1;
    sim.setPlayerIntent({ dir: sim.DIR_E, gait: "gallop" });
    S.tick();
    const gallop = runs(watch(100, () => { w.wind = w.stamina = 1; })).slice(1, -1);
    sim.setPlayerIntent(null);
    for (let k = 0; k < 200; k++) S.tick();
    return { idle, gallop };
  });
  // (a long gallop may meet the end of the open land: two cycles are enough)
  const cycle = timing.gallop.slice(0, 8), next = timing.gallop.slice(8, 16);
  const cycleMs = cycle.reduce((s, [, t]) => s + t, 0) * 1000 / 60;
  r.check(new Set(cycle.map(([c]) => c)).size === 8 && cycle.every(([c], k) => c === (cycle[0][0] + k) % 8)
    && next.map(([c, t]) => c + ":" + t).join() === cycle.map(([c, t]) => c + ":" + t).join()
    && Math.abs(cycleMs - 560) < 10,
    `a galloping wolf plays the run's 8 frames in order, 70 ms each as in the artist's preview: a cycle of ${cycleMs.toFixed(0)} ms ` +
    `(${timing.gallop.slice(0, 16).map(([c, t]) => c + ":" + t).join(" ")})`);
  r.check(timing.idle.every(([c, t]) => c >= 8 && c <= 11 && t === 12), `the idle shows columns 8-11, 200 ms each (${timing.idle.map(([c, t]) => c + ":" + t).join(" ")})`);

  // death, by direction
  const death = await p.evaluate(() => {
    const S = sim.internals, out = [];
    // all but a male and a female (for a litter later); the eighth direction by turning a corpse
    const others = sim.allCritters.filter(c => c.species === "wolf" && c !== sim.pcWolf && sim.isLiveCritter(c));
    const keep = [others.find(c => c.isMale), others.find(c => !c.isMale)];
    const wolves = others.filter(c => !keep.includes(c)).slice(0, 7);
    const w0 = sim.pcWolf;
    wolves.forEach((w, dir) => {
      w.gx = w.nextGX = w0.gx - 6 + 2 * (dir % 4); w.gy = w.nextGY = w0.gy - 3 + 3 * Math.floor(dir / 4);
      w.speed = 0; w.currentDirection = dir; S.setCritterIdle(w); w.currentDirection = dir; mind.ignore(w);
      w.lifespanS = 0;
    });
    const seq = [];
    for (let k = 0; k < 75; k++) {
      S.tick(); animat.render();
      const el = animat.spriteEl(wolves[0]);
      seq.push(Math.round(-parseFloat(el.style.backgroundPosition) / 64));
    }
    const look = w => {
      const el = animat.spriteEl(w), pos = el.style.backgroundPosition.split(" ").map(v => -parseFloat(v) / 64);
      out.push({ dir: w.currentDirection, kind: w.kind, pose: w.pose, col: pos[0], row: pos[1], mirror: el.style.transform.includes("-1") });
    };
    wolves.forEach(look);
    wolves[6].currentDirection = 7; animat.render(); look(wolves[6]);
    return { seq, out };
  });
  const runsOf = cols => { const o = []; for (const c of cols) { if (o.length && o.at(-1)[0] === c) o.at(-1)[1]++; else o.push([c, 1]); } return o; };
  const ds = runsOf(death.seq);
  r.check(ds.slice(0, 11).map(([c]) => c).join() === "21,22,23,24,25,26,27,28,29,30,31" && ds.slice(0, 11).every(([, t]) => t === 6)
    && ds[11][0] === 32 && ds.length === 12,
    `a wolf dying plays the death's 11 frames, 100 ms each, then its corpse holds the last (${ds.map(([c, t]) => c + ":" + t).join(" ")})`);
  const rows = [1, 1, 2, 2, 3, 3, 0, 0];
  r.check(death.out.map(o => o.dir).join() === "0,1,2,3,4,5,6,7" && death.out.every(o => o.kind === "corpse" && o.pose === "dead" && o.col === 32 && o.row === rows[o.dir] && !o.mirror),
    `every wolf dies to a corpse facing its nearest diagonal (rows by direction E..NE: ${death.out.map(o => o.row).join(" ")})`);

  // the player's wolf dies, and the next wolf born is the player's
  const player = await p.evaluate(() => {
    const S = sim.internals, w = sim.pcWolf;
    w.lifespanS = 0;
    for (let k = 0; k < 70; k++) S.tick();
    return { dead: w.kind === "corpse" && w.pose === "dead", stillPlayers: sim.pcWolf === w, at: [w.gx, w.gy] };
  });
  r.check(player.dead && player.stillPlayers, "the player's wolf dies of age too, and its corpse is still the player's");
  // camera mode, then the arrow toggle: to the corpse; arrows move nothing
  await p.evaluate(() => animat.centerCameraOn(5, 5));
  if (await p.evaluate(() => controls.arrowsMoveWolf)) await p.click("#arrow-mode-toggle");
  await p.click("#arrow-mode-toggle");
  await p.keyboard.down("ArrowRight");
  const onCorpse = await p.evaluate(() => {
    for (let k = 0; k < 60; k++) sim.internals.tick();
    animat.render();
    const w = sim.pcWolf;
    return { pinned: animat.camera.pinned === w, moved: w.gx !== w.nextGX || w.pose !== "dead" };
  });
  await p.keyboard.up("ArrowRight");
  const atNow = await p.evaluate(() => [sim.pcWolf.gx, sim.pcWolf.gy]);
  r.check(onCorpse.pinned && !onCorpse.moved && atNow.join() === player.at.join(),
    "the arrow toggle brings the camera to the corpse, and the arrows move nothing");
  const reborn = await p.evaluate(() => {
    const S = sim.internals, old = sim.pcWolf;
    const m = sim.allCritters.find(c => c.species === "wolf" && c.isMale && sim.isLiveCritter(c));
    const f = sim.allCritters.find(c => c.species === "wolf" && !c.isMale && sim.isLiveCritter(c));
    f.lifespanS = m.lifespanS = 1e9;
    f.gx = f.nextGX = old.gx + 3; f.gy = f.nextGY = old.gy + 3; f.speed = 0; S.setCritterIdle(f);
    S.conceive(f, m); f.pregnancy.dueAt = sim.now;
    S.tick(); animat.render();
    const pc = sim.pcWolf;
    return { newPlayer: pc !== old && pc.species === "wolf" && sim.isLiveCritter(pc) && pc.parentUids[0] === f.uid,
      pinned: animat.camera.pinned === pc, bornNow: sim.now - pc.birthTime < 0.1 };
  });
  r.check(reborn.newPlayer && reborn.bornNow && reborn.pinned,
    "the next wolf born becomes the player's wolf, and the camera goes to it");

  r.noProblems(p);
  await p.close();
}

module.exports = { name: "wolf sprites and the player's wolf", main };
if (require.main === module) runStandalone(module.exports.name, main);
