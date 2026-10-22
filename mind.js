// THE MIND: what each critter decides to do, and nothing else.
//
// Every tick, before the world moves, each critter (other than ones being steered by
// the player) takes in what it perceives (senses.js), updates its MEMORY, and decides
// on an INTENT, which it hands to the simulation (sim.setIntent). The simulation only
// carries intents out; it never decides. A critter's decisions use only what it knows:
// what it perceives now, and what it remembers having perceived before - never the
// simulation's own state of other critters.
//
// Everything it offers is on the one global it defines, `mind`. Connect it with
// mind.attach(sim, senses).
//
// MEMORY: for every creature it has perceived, a critter remembers the latest sighting:
// where it was, which way and how fast it was moving, whether it was alive, and when.
// It keeps that after losing sight of it, until it is too old to matter.
//
// DECISIONS
//   Deer   flee from every wolf they remember seeing within the last deerAlarmS seconds:
//          away from where each was (or is), the nearest counting most. With wolves on
//          opposite sides (the pulls nearly cancel out) a deer breaks away sideways
//          instead, to the side it is already facing. Once it picks a way to flee it
//          keeps to it for deerCommitS, unless a wolf it hadn't seen comes into sight,
//          so it doesn't flip back and forth as the balance shifts. Galloping while a
//          wolf is in sight or close to where one was last seen, trotting otherwise. They
//          calm down once the alarm is old, or once they are deerSafeTiles from where
//          each wolf was last seen (and that sighting no longer alarms them, even if they
//          wander back closer, until they see that wolf again).
//   Wolves chase a deer they know of. Choosing: the nearest, but among deer about as
//          near as that (within wolfSimilarRatio, by squared distance) the one most
//          straight ahead, so it carries on the way it is facing. It then keeps to its
//          choice for wolfCommitS; only a deer in sight and much nearer (a quarter of the
//          squared distance) takes it off its prey sooner. After that it changes only to
//          a deer clearly nearer (wolfSwitchRatio), and then keeps to that one for
//          wolfCommitS. In sight, straight for it. Out of sight, for where it should be
//          by now (where it was, moved on along its last heading for up to wolfLeadMaxS),
//          and once there, on along the way it was heading, searching. A deer searched for
//          and not found is lost: not chosen again until seen again. They give up when
//          the last sighting is wolfForgetPreyS old. A wolf that sees its prey die rests
//          for wolfRestAfterKillS.
//   Calm   (no threat or prey known): wander as before - a random diagonal and a random
//          gait for a random while, or a pause; a swimmer may decide to head for land,
//          the more surely the farther away it is.
// STEERING: straight the wanted way, if the critter can step that way (sim.canStepTo).
// If not, it goes round: it picks a side and keeps turning that way (the first direction
// it can step in, turning from the wanted one) until the wanted way is open again, so it
// slides along a wall instead of dithering back and forth. A dead end turns it right
// round, and it keeps going back out for the rest of the detour (detourS), following the
// wall the same way. After a move is blocked anyway (by another critter or a corpse, say)
// it avoids that direction for a moment (each direction blocked, not just the last). It
// keeps its current direction while that is close to the wanted way. Hysteresis keeps it
// from flipping between directions tick by tick: carrying on needs one tile clear ahead,
// turning into a new direction needs two. And it never turns right round twice within
// reverseAgainS: rather than that it stands still (facing the way it was going) until it
// may.

const mind = (() => {

let sim = null;    // set by attach()
let senses = null;

const deerAlarmS = 15;           // a deer keeps fleeing a wolf it saw this long ago
const deerSafeTiles = 30;        // ...unless it is this far from where it last saw it
const deerGallopWithinTiles = 8; // gallop while within this of where a wolf was last seen
const wolfForgetPreyS = 20;      // a wolf gives up on prey it last saw this long ago
const wolfLeadMaxS = 2;          // it expects unseen prey to carry on this long, at most
const wolfGallopWithinTiles = 12; // gallop at prey in sight this close; trot otherwise
const wolfRestAfterKillS = 30;   // rest this long after its prey dies
const wolfCommitS = 5;           // keep to a chosen prey at least this long
const wolfSimilarRatio = 2;      // deer within this of the nearest's squared distance are
                                 // about as near: choose among them by facing
const wolfSwitchRatio = 0.5;     // after wolfCommitS, change prey only for one this much
                                 // nearer (squared distance)
const deerCommitS = 0.75;        // keep to a chosen way to flee at least this long
const deerCaughtBetween = 0.3;   // the pulls cancel to below this share: break sideways
const playerHandoverS = 2;       // after the player lets go, the wolf waits this long
const avoidBlockedS = 0.5;       // after a blocked move, avoid that direction this long
const keepDirectionCos2 = 0.75;  // keep the current direction within 30 degrees (cos^2 30)
const detourS = 3;               // keep going round an obstacle the same way this long
const reverseAgainS = 1;         // don't turn right round again sooner than this
const returnToLandSureTiles = 4; // a swimmer this far from land surely heads for it
const returnToLandGiveUpS = 1;   // ...but gives up after being blocked this long

const IDLE = { gait: "idle" };

const memories = new Map(); // critter -> its memory
const ignored = new Set();  // critters the mind leaves alone (tests, debugging)

function ticks(seconds) { return seconds / sim.tempo; }

function memoryOf(a) {
  let m = memories.get(a);
  if (!m) {
    m = {
      known: new Map(),     // uid -> latest sighting: { species, alive, gx, gy, vx, vy, seenTick }
      mode: "calm",         // calm | flee | chase | rest (for debugging and tests)
      target: null,         // a wolf's prey (uid)
      targetUntil: -Infinity, // ...kept until this tick at least
      flee: null,           // a deer's chosen way to flee: { dx, dy, until, seen }
      searching: false,     // a wolf has reached where its unseen prey should be
      restUntil: -Infinity, // a wolf resting after a kill
      plan: null,           // a calm critter's current plan: { kind, until, intent, ... }
      avoid: new Array(8).fill(-Infinity), // by direction: avoid it until this tick (just blocked)
      detour: null,         // { side, until }: going round an obstacle, turning this way
      reversedTick: -Infinity, // the last time it turned right round
      playerTick: -Infinity // the last tick the player was steering this critter
    };
    memories.set(a, m);
  }
  return m;
}

// PERCEIVING AND REMEMBERING
function remember(a, m, now) {
  for (const o of senses.perceive(a)) {
    const before = m.known.get(o.uid);
    m.known.set(o.uid, { species: o.species, alive: o.alive, gx: o.gx, gy: o.gy,
      vx: o.vx, vy: o.vy, seenTick: now,
      // in sight since: this tick, unless it was in sight last tick too
      sightedTick: before && before.seenTick === now - 1 ? before.sightedTick : now });
  }
  const longest = ticks(Math.max(deerAlarmS, wolfForgetPreyS));
  for (const [uid, k] of m.known) if (now - k.seenTick > longest) m.known.delete(uid);
}

// Where a remembered creature should be by now, if it carried on as last seen (for up
// to wolfLeadMaxS).
function expectedAt(k, now) {
  const t = Math.min(now - k.seenTick, ticks(wolfLeadMaxS));
  return [k.gx + k.vx * t, k.gy + k.vy * t];
}

// STEERING: the direction to take to go along (dx, dy), or null if boxed in.
// Hysteresis, so it never flips between two directions tick by tick: to keep going the
// way it is going, one tile ahead must be clear; to turn into another direction, two
// tiles ahead must be (falling back to one if nothing else is open). And once it has had
// to turn right round (a dead end), it keeps going that way until the detour is over.
function steer(a, m, dx, dy, now) {
  if (a.blockedTick === now - 1) m.avoid[a.currentDirection] = now + ticks(avoidBlockedS);
  const cur = a.speed > 0 ? a.currentDirection : undefined;
  const clear = (d, tiles) => m.avoid[d] <= now
    && sim.canStepTo(a, a.gx + tiles * sim.moveVecByDir[d][0], a.gy + tiles * sim.moveVecByDir[d][1]);
  const open = d => d === cur ? clear(d, 1) : clear(d, 1) && clear(d, 2);
  if (m.detour && m.detour.until <= now) m.detour = null;

  // turned right round (a dead end): carry on that way for now, following the wall
  // (turning further the same way when blocked again) until the detour is over
  if (m.detour && m.detour.reversed && cur !== undefined) {
    for (const ok of [open, d => clear(d, 1)]) {
      for (let k = 0; k < 8; k++) {
        const d = (cur + 8 + m.detour.side * k) % 8;
        if (ok(d)) return d;
      }
    }
    return null;
  }

  // close enough to the wanted way already: carry on (no flicker)
  if (cur !== undefined && !m.detour) {
    const [ux, uy] = sim.moveVecByDir[cur];
    const along = ux * dx + uy * dy;
    if (along > 0 && along * along >= keepDirectionCos2 * (dx * dx + dy * dy) && open(cur)) return cur;
  }
  const want = sim.getDir(dx, dy, cur || 0);
  if (open(want)) { m.detour = null; return want; }

  // blocked: go round, always turning the same way
  const turned = k => (want + 8 + m.detour.side * k) % 8;
  if (!m.detour) {
    let side = 0;
    for (const ok of [open, d => clear(d, 1)]) { // two tiles clear if it can, else one
      for (let k = 1; k <= 4 && !side; k++) {
        const right = ok((want + k) % 8), left = ok((want + 8 - k) % 8);
        if (right && left) side = Math.random() < 0.5 ? 1 : -1;
        else if (right) side = 1;
        else if (left) side = -1;
      }
      if (side) break;
    }
    if (!side) return null; // boxed in
    m.detour = { side, until: now + ticks(detourS), reversed: false };
  }
  for (const ok of [open, d => clear(d, 1)]) {
    for (let k = 1; k < 8; k++) {
      if (!ok(turned(k))) continue;
      if (k >= 3 && k <= 5) m.detour.reversed = true; // facing back the way it wanted
      return turned(k);
    }
  }
  return null;
}

function move(a, m, dx, dy, gait, now) {
  const dir = steer(a, m, dx, dy, now);
  if (dir === null) return IDLE;
  // turning right round (135 degrees or more) again so soon: stand still instead
  const turn = (dir - a.currentDirection + 8) % 8;
  if (turn >= 3 && turn <= 5) {
    if (now - m.reversedTick < ticks(reverseAgainS)) return IDLE;
    m.reversedTick = now;
  }
  return { dir, gait };
}

// DEER: flee from remembered wolves
function decideDeer(a, m, now) {
  let fx = 0, fy = 0, pull = 0, nearest2 = Infinity, nx = 0, ny = 0;
  let inSight = false, threats = 0, newSighting = false;
  for (const k of m.known.values()) {
    if (k.species !== "wolf" || !k.alive) continue;
    const age = now - k.seenTick;
    if (age > ticks(deerAlarmS)) continue;
    const dx = a.gx - k.gx, dy = a.gy - k.gy;
    const d2 = dx * dx + dy * dy;
    if (k.escaped) continue;
    if (age > 0 && d2 > deerSafeTiles * deerSafeTiles) { k.escaped = true; continue; } // got away
    const w = 1 / Math.max(d2, 1); // the nearest counts most (1 / distance, in all)
    fx += dx * w; fy += dy * w;
    pull += d2 * w * w;            // ...and how much all the pulls add up to, squared
    if (d2 < nearest2) { nearest2 = d2; nx = dx; ny = dy; }
    if (age === 0) inSight = true;
    if (age === 0 && (!m.flee || k.sightedTick > m.flee.since)) newSighting = true;
    threats++;
  }
  if (!threats) { m.mode = "calm"; m.flee = null; return calm(a, m, now); }

  m.mode = "flee";
  m.plan = null;
  if (!m.flee || m.flee.until <= now || newSighting) {
    // choose a way to flee, and keep to it for a while
    let hx = fx, hy = fy;
    // Caught between wolves: the pulls cancel (compared squared: |sum| < share * sum of
    // |each|, with the sum of |each| squared bounded by threats * sum of |each|^2).
    if (fx * fx + fy * fy < deerCaughtBetween * deerCaughtBetween * pull * threats || (hx === 0 && hy === 0)) {
      // break away sideways to the nearest, on the side it is facing
      hx = -ny; hy = nx;
      const [ux, uy] = sim.moveVecByDir[a.currentDirection || 0];
      if (hx * ux + hy * uy < 0) { hx = -hx; hy = -hy; }
      if (hx === 0 && hy === 0) hx = 1; // right on top of it: any way out
    }
    m.flee = { dx: hx, dy: hy, until: now + ticks(deerCommitS), since: now };
  }
  const close = inSight || nearest2 < deerGallopWithinTiles * deerGallopWithinTiles;
  return move(a, m, m.flee.dx, m.flee.dy, close ? "gallop" : "trot", now);
}

// WOLVES: chase remembered deer
function decideWolf(a, m, now) {
  if (m.restUntil > now) { m.mode = "rest"; return IDLE; }

  let target = m.target !== null ? m.known.get(m.target) : undefined;
  if (target && !target.alive) {             // its prey died: rest
    m.target = null;
    m.restUntil = now + ticks(wolfRestAfterKillS);
    m.mode = "rest";
    return IDLE;
  }
  if (target && (target.lost || now - target.seenTick > ticks(wolfForgetPreyS))) target = undefined; // gave up

  // the deer it could go after: live, not lost, not forgotten; with the squared
  // distance to where each should be by now, and how straight ahead that is (the cosine
  // squared, signed: no square root)
  const [fx, fy] = sim.moveVecByDir[a.currentDirection || 0];
  const options = [];
  let nearestD2 = Infinity;
  for (const [uid, k] of m.known) {
    if (k.species !== "deer" || !k.alive || k.lost || now - k.seenTick > ticks(wolfForgetPreyS)) continue;
    const [ex, ey] = expectedAt(k, now);
    const dx = ex - a.gx, dy = ey - a.gy;
    const d2 = dx * dx + dy * dy;
    const along = dx * fx + dy * fy;
    options.push({ uid, k, d2, ahead: d2 > 0 ? along * Math.abs(along) / d2 : 1 });
    nearestD2 = Math.min(nearestD2, d2);
  }
  // of those about as near as the nearest, the one most straight ahead
  let choice = null;
  for (const o of options) {
    if (o.d2 > wolfSimilarRatio * nearestD2) continue;
    if (!choice || o.ahead > choice.ahead) choice = o;
  }
  const choose = o => {
    m.target = o ? o.uid : null;
    m.targetUntil = now + ticks(wolfCommitS);
    m.searching = false;
  };
  if (!target) choose(choice);
  else if (choice && choice.uid !== m.target) {
    const [ex, ey] = expectedAt(target, now);
    const d2 = (ex - a.gx) ** 2 + (ey - a.gy) ** 2;
    if (m.targetUntil > now) {
      // keeping to its prey for now: only a deer in sight and much nearer changes that
      const near = options.find(o => o.k.seenTick === now && o.d2 < 0.25 * d2 && o.uid !== m.target);
      if (near) choose(near);
    } else if (choice.d2 < wolfSwitchRatio * d2) choose(choice);
  }
  target = m.target !== null ? m.known.get(m.target) : undefined;
  if (!target) { m.mode = "calm"; m.searching = false; return calm(a, m, now); }

  m.mode = "chase";
  m.plan = null;
  const age = now - target.seenTick;
  if (age === 0) m.searching = false;
  const [tx, ty] = expectedAt(target, now);
  let dx = tx - a.gx, dy = ty - a.gy;
  // out of sight and where it should be, but it isn't there: search on the way it went
  if (age > 0 && dx * dx + dy * dy < 4) m.searching = true;
  if (m.searching) {
    if (target.vx === 0 && target.vy === 0) { // it was standing still, and isn't here: lost
      target.lost = true; m.target = null; m.searching = false; m.mode = "calm"; return calm(a, m, now);
    }
    dx = target.vx; dy = target.vy;
  }
  const close = age === 0 && dx * dx + dy * dy < wolfGallopWithinTiles * wolfGallopWithinTiles;
  return move(a, m, dx, dy, close ? "gallop" : "trot", now);
}

// CALM: wander; swimmers may head for land
function calm(a, m, now) {
  const p = m.plan;
  const blocked = a.blockedTick === now - 1;
  if (p && p.kind === "toLand") {
    if (a.pose !== "swim") { m.plan = null; return calm(a, m, now); } // ashore
    if (blocked && ++p.blockedTicks > ticks(returnToLandGiveUpS)) m.plan = null; // give up
    else return move(a, m, p.gx - a.gx, p.gy - a.gy, "walk", now);
  }
  if (p && p.kind === "wander" && now < p.until && !blocked) return p.intent;

  // a new plan, for a while
  const until = now + 120 + Math.floor(Math.random() * 500 + Math.random() * 500);
  if (a.pose === "swim") {
    const land = findNearestLand(a);
    // the chance grows with the distance: certain at returnToLandSureTiles, compared
    // squared (no square root): random * sure >= distance <=> (random * sure)^2 >= distance^2
    const roll = Math.random() * returnToLandSureTiles;
    if (land && roll * roll < land.distL2) {
      m.plan = { kind: "toLand", gx: land.tile[0] + 0.5, gy: land.tile[1] + 0.5, blockedTicks: 0 };
      return move(a, m, m.plan.gx - a.gx, m.plan.gy - a.gy, "walk", now);
    }
  }
  if (Math.random() < 0.1) {
    m.plan = { kind: "wander", until, intent: IDLE };
  } else {
    // a random diagonal it can step in (any gait: the simulation downgrades it if wind,
    // stamina or water don't allow it)
    const dirs = [0, 2, 4, 6].sort(() => Math.random() - 0.5);
    const dir = dirs.find(d => sim.canStepTo(a, a.gx + sim.moveVecByDir[d][0], a.gy + sim.moveVecByDir[d][1]))
      ?? dirs[0];
    const gait = ["walk", "trot", "gallop"][Math.floor(Math.random() * 3)];
    m.plan = { kind: "wander", until, intent: { dir, gait } };
  }
  return m.plan.intent;
}

// Nearest land tile a swimmer can climb onto: { tile: [i, j], distL2 } where distL2 is
// the SQUARED distance to the closest point of that tile; null if there is none.
function findNearestLand(a) {
  const ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const sq = v => v * v;
  const distToTileL2 = (i, j) => sq(Math.max(i - a.gx, 0, a.gx - (i + 1)))
    + sq(Math.max(j - a.gy, 0, a.gy - (j + 1)));
  let best = null;
  const maxR = Math.max(sim.gridWidthN, sim.gridHeightN);
  // search square rings outward; a ring at radius r can't beat a find closer than r - 1
  for (let r = 0; r <= maxR; r++) {
    if (best && r >= 1 && best.distL2 <= sq(r - 1)) break;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // ring only
      if (!sim.isLandTile(i, j)) continue;
      const d = distToTileL2(i, j);
      if (!best || d < best.distL2) best = { tile: [i, j], distL2: d };
    }
  }
  return best;
}

// EVERY TICK: every critter perceives, remembers and decides
function think() {
  const now = sim.tickCount;
  for (const a of sim.allCritters) {
    if (!sim.isLiveCritter(a) || ignored.has(a)) continue;
    const m = memoryOf(a);
    remember(a, m, now);
    if (a === sim.pcWolf && sim.playerHasControl()) { m.playerTick = now; m.plan = null; continue; }
    let intent;
    if (now - m.playerTick < ticks(playerHandoverS)) intent = IDLE; // just let go: wait
    else intent = a.species === "wolf" ? decideWolf(a, m, now) : decideDeer(a, m, now);
    sim.setIntent(a, intent);
  }
  for (const a of memories.keys()) if (!sim.allCritters.includes(a)) memories.delete(a); // gone
}

// For tests and debugging: leave a critter alone (it keeps doing whatever it is told
// directly), or take it back.
function ignore(a, on = true) {
  if (on) { ignored.add(a); sim.setIntent(a, null); }
  else ignored.delete(a);
}

// For tests and debugging: wipe a critter's memory (it starts afresh, knowing nothing).
function forget(a) {
  memories.delete(a);
}

// For tests and debugging: what a critter has in mind.
function stateOf(a) {
  const m = memories.get(a);
  if (!m) return null;
  return { mode: m.mode, target: m.target, searching: m.searching, flee: m.flee, detour: m.detour,
    avoid: m.avoid.map(t => t > sim.tickCount ? 1 : 0).join(""),
    known: [...m.known].map(([uid, k]) => ({ uid, ...k })) };
}

function attach(theSim, theSenses) {
  if (sim) return alert("mind.attach called twice");
  if (!theSim || typeof theSim.setIntent !== "function")
    return alert("mind.attach needs the simulation (load sim.js)");
  if (!theSenses || typeof theSenses.perceive !== "function")
    return alert("mind.attach needs the senses (load senses.js)");
  sim = theSim;
  senses = theSenses;
  sim.onTick(think);
}

// THE INTERFACE
return { attach, ignore, forget, stateOf };

})();

// In Node, mind.js is a module; in the browser this adds nothing.
if (typeof module !== "undefined" && module.exports) module.exports = mind;
