// THE MIND: what each critter decides to do, and nothing else.
//
// On its TURN, each critter (other than one being steered by the player) takes in what it
// perceives (senses.js), updates its MEMORY, and decides on an INTENT, which it hands to
// the simulation (sim.setIntent). The simulation only carries intents out; it never
// decides. A critter's decisions use only what it knows: what it perceives now, and what
// it remembers having perceived before - never the simulation's own state of other
// critters.
//
// TURNS: a critter decides decideEveryS of game time apart (10 times a game-second), and
// so at most once a tick; between turns it carries on with its last intent. The turns are
// spread out: each critter gets a slot (which tick of every decideEveryS is its own),
// given so that each slot has about as many critters as any other, counting wolves and
// deer each separately and both together.
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
//          straight ahead, so it carries on the way it is heading. It then keeps to its
//          choice for wolfCommitS; only a deer in sight and much nearer (a quarter of the
//          squared distance) takes it off its prey sooner. After that it changes only to
//          a deer clearly nearer (wolfSwitchRatio), and then keeps to that one for
//          wolfCommitS. In sight, straight for it. Out of sight, for where it should be
//          by now (where it was, moved on along its last heading for up to wolfLeadMaxS),
//          and once there, on along the way it was heading, searching. A deer searched for
//          and not found is lost: not chosen again until seen again. They give up when
//          the last sighting is wolfForgetPreyS old. A wolf that sees its prey die rests
//          for wolfRestAfterKillS.
//   Calm   (no threat or prey known): wander - a random heading, walking or trotting,
//          for a random while, or a pause (never a gallop: that is only for chasing and
//          fleeing); a swimmer may decide to head for land, the more surely the farther
//          away it is.
// STEERING: headings are any direction (a grid vector), not just 8. Straight the wanted
// way, if the critter can go that way (sim.canStepTo). If not, it goes round by the 8
// directions: it picks a side and keeps turning that way (the first direction it can step
// in, turning from the wanted one) until the wanted way is open again, so it slides along
// a wall instead of dithering back and forth. A dead end turns it right round, and it
// keeps going back out for the rest of the detour (detourS), following the wall the same
// way. After a move is blocked anyway (by another critter or a corpse, say; the
// simulation stuns it for a moment) it avoids that direction for a while (each direction
// blocked, not just the last). It keeps its current heading while that is within
// keepHeadingCos2 of the wanted way, so a small change of aim doesn't make a new heading
// (each new heading costs the simulation a square root). Hysteresis keeps it from
// flipping between ways: carrying on needs one tile clear ahead, turning into a new way
// needs two. And it never turns right round twice within reverseAgainS: rather than that
// it stands still (facing the way it was going) until it may.

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
const keepHeadingCos2 = 0.97;    // keep the current heading within 10 degrees (cos^2 10)
const detourS = 3;               // keep going round an obstacle the same way this long
const reverseAgainS = 1;         // don't turn right round again sooner than this
const decideEveryS = 0.1;        // a critter's turns to decide are this far apart
const returnToLandSureTiles = 4; // a swimmer this far from land surely heads for it
const returnToLandGiveUpS = 1;   // ...but gives up after being blocked this long

const IDLE = { gait: "idle" };

const memories = new Map(); // critter -> its memory
const ignored = new Set();  // critters the mind leaves alone (tests, debugging)

function ticks(seconds) { return seconds / sim.tempo; }

// TURNS: how many ticks apart a critter's turns are, and how many critters (of each
// species, and in all) have each slot.
let turnTicks = 1;
let slotLoad = null; // { all: [..], wolf: [..], deer: [..] }, one count per slot

function takeSlot(a) {
  const mine = slotLoad[a.species] || (slotLoad[a.species] = new Array(turnTicks).fill(0));
  let best = 0;
  for (let k = 1; k < turnTicks; k++) {
    if (mine[k] < mine[best] || mine[k] === mine[best] && slotLoad.all[k] < slotLoad.all[best]) best = k;
  }
  mine[best]++; slotLoad.all[best]++;
  return best;
}

function dropMemory(a) {
  const m = memories.get(a);
  if (!m) return;
  slotLoad[a.species][m.slot]--; slotLoad.all[m.slot]--;
  memories.delete(a);
}

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
      lastTurn: -Infinity,  // the tick of its last turn (perceiving and deciding)
      intent: null,         // the intent it decided on last
      slot: takeSlot(a),    // its turn: ticks where tickCount % turnTicks === slot
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
      // in sight since: now, unless it was in sight at its last turn too
      sightedTick: before && before.seenTick === m.lastTurn ? before.sightedTick : now });
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

// STEERING: the way to go to go along (dx, dy): a grid vector [x, y] (any length), KEEP
// (carry on with its current heading), or null if boxed in.
// Hysteresis, so it never flips between ways: to keep going the way it is going, one tile
// ahead must be clear; to turn into another way, two tiles ahead must be (falling back to
// one if nothing else is open). And once it has had to turn right round (a dead end), it
// keeps going that way until the detour is over.
const KEEP = "keep";
function steer(a, m, dx, dy, now) {
  const moving = a.speed > 0;
  const bin = (vx, vy) => sim.getDir(vx, vy, a.currentDirection || 0); // nearest of the 8
  // blocked since its last turn: avoid that way for a while
  if (a.blockedTick > m.lastTurn) m.avoid[bin(a.hx, a.hy)] = now + ticks(avoidBlockedS);
  // `tiles` ahead along (vx, vy) is clear. The vector is scaled to make its larger part
  // `tiles` long (no square root needed), so this looks 1 to 1.4 times that far.
  const clear = (vx, vy, tiles) => {
    if (m.avoid[bin(vx, vy)] > now) return false;
    const k = tiles / Math.max(Math.abs(vx), Math.abs(vy));
    return sim.canStepTo(a, a.gx + vx * k, a.gy + vy * k);
  };
  const curBin = moving ? bin(a.hx, a.hy) : -1;
  const vec = d => sim.moveVecByDir[d];
  const open8 = d => d === curBin ? clear(...vec(d), 1) : clear(...vec(d), 1) && clear(...vec(d), 2);
  const near8 = d => clear(...vec(d), 1);
  if (m.detour && m.detour.until <= now) m.detour = null;

  // turned right round (a dead end): carry on that way for now, following the wall
  // (turning further the same way when blocked again) until the detour is over
  if (m.detour && m.detour.reversed && moving) {
    if (clear(a.hx, a.hy, 1)) return KEEP;
    for (const ok of [open8, near8]) {
      for (let k = 1; k < 8; k++) {
        const d = (curBin + 8 + m.detour.side * k) % 8;
        if (ok(d)) return vec(d);
      }
    }
    return null;
  }

  // close enough to the wanted way already: carry on
  if (moving && !m.detour) {
    const along = a.hx * dx + a.hy * dy;
    if (along > 0 && along * along >= keepHeadingCos2 * (dx * dx + dy * dy) && clear(a.hx, a.hy, 1)) return KEEP;
  }
  // straight the wanted way
  if (clear(dx, dy, 1) && clear(dx, dy, 2)) { m.detour = null; return [dx, dy]; }

  // blocked: go round by the 8 directions, always turning the same way
  const want = bin(dx, dy);
  const turned = k => (want + 8 + m.detour.side * k) % 8;
  if (!m.detour) {
    let side = 0;
    for (const ok of [open8, near8]) { // two tiles clear if it can, else one
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
  for (const ok of [open8, near8]) {
    for (let k = 1; k < 8; k++) {
      if (!ok(turned(k))) continue;
      if (k >= 3 && k <= 5) m.detour.reversed = true; // facing back the way it wanted
      return turned(k) === curBin ? KEEP : vec(turned(k));
    }
  }
  return null;
}

// The intent to go along (dx, dy) at a gait, steering round what's in the way.
function move(a, m, dx, dy, gait, now) {
  const way = steer(a, m, dx, dy, now);
  if (way === null) return IDLE;
  if (way === KEEP) {
    // the same vector as its intent (so the simulation keeps the heading as it is)
    const prev = m.intent && m.intent.dx !== undefined ? m.intent : { dx: a.hx, dy: a.hy };
    return prev.gait === gait ? prev : { dx: prev.dx, dy: prev.dy, gait };
  }
  const [vx, vy] = way;
  // turning right round (135 degrees or more: cos^2 >= 1/2, backwards) again so soon:
  // stand still instead
  if (a.hx !== undefined) {
    const along = vx * a.hx + vy * a.hy;
    if (along < 0 && along * along >= 0.5 * (vx * vx + vy * vy)) {
      if (now - m.reversedTick < ticks(reverseAgainS)) return IDLE;
      m.reversedTick = now;
    }
  }
  return { dx: vx, dy: vy, gait };
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
      const [ux, uy] = [a.hx || 0, a.hy || 0]; // its heading
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
  const [fx, fy] = [a.hx || 0, a.hy || 0]; // its heading
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
  const blocked = a.blockedTick > m.lastTurn;
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
    // a random heading it can go along, walking or trotting (galloping is only for
    // chasing and fleeing; the simulation downgrades a gait if wind, stamina or water
    // don't allow it). The same intent all plan long, so the heading is worked out once.
    let dx = 1, dy = 0;
    for (let tries = 0; tries < 4; tries++) {
      dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1;
      const k = 1 / Math.max(Math.abs(dx), Math.abs(dy), 0.01); // about a tile ahead
      if (sim.canStepTo(a, a.gx + dx * k, a.gy + dy * k)) break;
    }
    const gait = Math.random() < 0.5 ? "walk" : "trot";
    m.plan = { kind: "wander", until, intent: { dx, dy, gait } };
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

// EVERY TICK: the critters whose turn it is perceive, remember and decide
function think() {
  const now = sim.tickCount;
  for (const a of sim.allCritters) {
    if (!sim.isLiveCritter(a) || ignored.has(a)) continue;
    const m = memoryOf(a);
    if (a === sim.pcWolf && sim.playerHasControl()) {
      // the player's: drop its own last decision, so it doesn't take that up again the
      // moment the player lets go (it waits for its turn, standing still)
      if (m.intent) { sim.setIntent(a, null); m.intent = null; }
      m.playerTick = now; m.plan = null;
      continue;
    }
    if (now % turnTicks !== m.slot) continue; // not its turn
    remember(a, m, now);
    let intent;
    if (now - m.playerTick < ticks(playerHandoverS)) intent = IDLE; // just let go: wait
    else intent = a.species === "wolf" ? decideWolf(a, m, now) : decideDeer(a, m, now);
    m.intent = intent;
    m.lastTurn = now;
    sim.setIntent(a, intent);
  }
  for (const a of memories.keys()) if (!sim.allCritters.includes(a)) dropMemory(a); // gone
}

// For tests and debugging: leave a critter alone (it keeps doing whatever it is told
// directly), or take it back.
function ignore(a, on = true) {
  if (on) { ignored.add(a); sim.setIntent(a, null); }
  else ignored.delete(a);
}

// For tests and debugging: wipe a critter's memory and its last decision (it starts
// afresh, knowing nothing and doing nothing until its turn).
function forget(a) {
  dropMemory(a);
  sim.setIntent(a, null);
}

// For tests and debugging: what a critter has in mind.
function stateOf(a) {
  const m = memories.get(a);
  if (!m) return null;
  return { mode: m.mode, target: m.target, searching: m.searching, flee: m.flee, detour: m.detour,
    slot: m.slot, lastTurn: m.lastTurn,
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
  turnTicks = Math.max(1, Math.round(ticks(decideEveryS)));
  slotLoad = { all: new Array(turnTicks).fill(0) };
  sim.onTick(think);
}

// THE INTERFACE
return { attach, ignore, forget, stateOf, get turnTicks() { return turnTicks; } };

})();

// In Node, mind.js is a module; in the browser this adds nothing.
if (typeof module !== "undefined" && module.exports) module.exports = mind;
