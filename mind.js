// THE MIND: what each critter decides to do.
//
// On its turn, each critter (but the player's wolf while the player steers it) takes in
// what it perceives (senses.js), updates its memory, and hands the simulation an intent
// (sim.setIntent). NO MAGICAL KNOWLEDGE (see admin/design_notes.md): of the world outside
// itself it knows only what its senses tell it, now or in memory: where other critters
// are (prey, threats, carcasses, mates, parents, young alike), what they are, and the
// terrain and grass in sight. Its own state (meters, age, whether in heat, whom it is
// paired with or born of) is always its to read, as is the ground under its next steps
// (sim.canStepTo: it feels its footing).
//
// Everything it offers is on the one global it defines, `mind`. Connect it with
// mind.attach(sim, senses).
//
// TURNS: a critter decides every decideEveryS of game time (so at most once a tick) and
// carries on with its last intent in between. Each critter gets a slot, a tick within
// every decideEveryS, spread so every slot has about as many wolves, deer, and critters
// in all as any other.
//
// DECISIONS, in order of priority:
//   a tired swimmer heads for land (toShore)
//   a deer flees wolves it remembers (decideDeer)
//   a wolf eats a carcass it knows of while not full (decideWolf)
//   while its meter is above romanceAbove, a grown critter courts and mates, or mates
//     with its partner in heat (social, romance only)
//   a deer grazes while hungry (graze); a wolf hunts while hungry and weaned, waiting on
//     the shore for prey in the water (waitAshore)
//   mates and family (social): courting and mating as above, at any hunger; keeping near
//     a partner or infants; the young keep near a parent
//   anything else wanders (calm)
// Every move goes through steer, which finds a way round obstacles.

const mind = (() => {

let sim = null;    // set by attach()
let senses = null;

const deerAlarmS = 15;           // a deer keeps fleeing a wolf it saw this long ago
const deerSafeTiles = 30;        // ...unless it is this far from where it last saw it
const deerGallopWithinTiles = 8; // gallop while within this of where a wolf was last seen
const deerCommitS = 0.75;        // keep to a chosen way to flee at least this long
const deerCaughtBetween = 0.3;   // the pulls of wolves cancel to below this share: break sideways
// Above this share of a full meter, courting and mating come before eating.
const romanceAbove = 0.5;
const deerGrazeBelow = 0.8;      // a deer starts grazing with its food meter below this
const deerFullAt = 0.99;         // ...and grazes until it is this full
// A tile is worth walking to and starting on with at least this share of the most a tile
// holds. Grass regrows a little every second, so without it deer go back for the crumbs
// on tiles they have just cropped.
const deerBiteShare = 0.1;
const deerGrazeLookShare = 0.25; // looks this share of its sight for grass first, then all of it
const wolfHuntBelow = 0.75;      // a wolf hunts only with its food meter below this
const wolfFullAt = 0.99;         // ...and eats until it is this full
const wolfForgetPreyS = 20;      // gives up on prey it last saw this long ago
const wolfLeadMaxS = 2;          // expects unseen prey to carry on this long, at most
const wolfGallopWithinTiles = 12; // gallops at prey in sight this close; trots otherwise
const wolfCommitS = 5;           // keeps to a chosen prey at least this long
const wolfSimilarRatio = 2;      // deer within this of the nearest's squared distance are
                                 // about as near: choose among them by facing
const wolfSwitchRatio = 0.5;     // after wolfCommitS, changes prey only for one this much
                                 // nearer (squared distance)
const shoreWaitTiles = 1;        // a wolf this near its spot on the shore waits there
const shoreLookAheadTiles = 40;  // looks this far along a swimmer's way for its landing
const shoreRetryTurns = 10;      // a tired swimmer blocked this many turns looks for other land
const returnToLandSureTiles = 4; // a calm swimmer this far from land surely heads for it
const returnToLandGiveUpS = 1;   // ...but gives up after being blocked this long
const mateCloseTiles = 1.2;      // stands ready to mate this near (center to center)
const courtGiveUpS = 30;         // gives up courting one that hasn't mated after this long...
const courtRetryS = 120;         // ...and leaves it be this long
const pairStayTiles = 6;         // a paired male keeps within this of his partner
const motherStayTiles = 4;       // a mother keeps within this of her infants
const followParentTiles = 3;     // the young keep within this of a parent
const kinLostTiles = 2;          // kin not where last seen, this near: lost until seen again
const roamS = 40;                // an unpaired grown critter roams one way up to this long
const playerHandoverS = 2;       // after the player lets go, the wolf waits this long
const avoidBlockedS = 0.5;       // after a blocked move, avoid that direction this long
const keepHeadingCos2 = 0.97;    // keep the current heading within 10 degrees (cos^2)
const detourS = 3;               // keep going round an obstacle the same way this long
const reverseAgainS = 1;         // don't turn right round again sooner than this
const decideEveryS = 0.1;

const IDLE = { gait: "idle" };
const EAT = { gait: "eat" };

const memories = new Map(); // critter -> its memory
const ignored = new Set();  // critters left alone (tests, debugging)

function ticks(seconds) { return seconds / sim.tempo; }

let turnTicks = 1;   // ticks between a critter's turns
let slotLoad = null; // { all, wolf, deer }: how many critters have each slot

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
      known: new Map(),       // uid -> its latest sighting (see remember)
      familiar: new Set(),    // uids of its species met while it or they were infants
      court: null,            // the critter it is courting: { uid, since }
      refused: new Map(),     // uid -> courting it again only after this tick
      mode: "calm",           // calm | flee | chase | wait | feed | graze | ashore | court | mate | family
      target: null,           // a wolf's prey (uid)
      targetUntil: -Infinity, // ...kept until this tick at least
      flee: null,             // a deer's way to flee: { dx, dy, until, since }
      searching: false,       // a wolf has reached where its unseen prey should be
      watch: null,            // a wolf waiting ashore: { i, j, way (its prey's tile and way), spot }
      shore: null,            // a tired swimmer's land: { gx, gy, blockedTurns }
      grazing: false,         // a deer grazing (from hungry until full)
      grazeTo: null,          // ...the tile it is walking to, [i, j]
      cropping: null,         // ...the tile it is eating, [i, j]
      plan: null,             // a calm critter's plan: { kind, until, intent, ... }
      avoid: new Array(8).fill(-Infinity), // by direction: avoid until this tick
      detour: null,           // going round an obstacle: { side, until, reversed }
      reversedTick: -Infinity,
      lastTurn: -Infinity,
      intent: null,           // its last decision
      slot: takeSlot(a),      // its turns: ticks where tickCount % turnTicks === slot
      playerTick: -Infinity   // the last tick the player steered it
    };
    memories.set(a, m);
  }
  return m;
}

// MEMORY: the latest sighting of every creature a critter has perceived (where, which
// way and how fast, whether alive, swimming, the meat left on a carcass, its sex, age
// and partner, whether in heat, and when), kept after losing sight of it until too old
// to matter; its kin's (partner, parents, young) for good.
// WESTERMARCK: it never forgets those of its species it met while it or they were
// infants (m.familiar), and never mates with them.
function remember(a, m, now) {
  const selfInfant = sim.isInfant(a);
  for (const o of senses.perceive(a)) {
    const before = m.known.get(o.uid);
    m.known.set(o.uid, { species: o.species, alive: o.alive, gx: o.gx, gy: o.gy,
      vx: o.vx, vy: o.vy, swimming: o.swimming, meat: o.meat, seenTick: now,
      isMale: o.isMale, infant: o.infant, grown: o.grown, mateUid: o.mateUid, inHeat: o.inHeat,
      // in sight since now, unless it was in sight at its last turn too
      sightedTick: before && before.seenTick === m.lastTurn ? before.sightedTick : now });
    if (o.species === a.species && (selfInfant || o.infant)) m.familiar.add(o.uid);
  }
  const longest = ticks(Math.max(deerAlarmS, wolfForgetPreyS));
  for (const [uid, k] of m.known) {
    if (now - k.seenTick > longest && !isKin(a, uid)) m.known.delete(uid);
  }
}

function isKin(a, uid) {
  return uid === a.mateUid || a.parentUids.includes(uid) || a.youngUids.includes(uid);
}

// Where a remembered creature should be by now, had it carried on as last seen (for at
// most wolfLeadMaxS).
function expectedAt(k, now) {
  const t = Math.min(now - k.seenTick, ticks(wolfLeadMaxS));
  return [k.gx + k.vx * t, k.gy + k.vy * t];
}

// STEERING: the way to go to head along (dx, dy): a grid vector, KEEP (carry on as it
// is), or null if boxed in. Straight the wanted way if it can (sim.canStepTo); otherwise
// round by the 8 directions, always turning the same way, so it slides along a wall
// instead of dithering. A dead end turns it right round, and it keeps going back out for
// the rest of the detour. It avoids a direction it was just blocked in (by a critter,
// say), and keeps its heading while within keepHeadingCos2 of the wanted way, since each
// new heading costs the simulation a square root. Carrying on needs one tile clear
// ahead, turning needs two, so it doesn't flip between ways. With dry, it also keeps out
// of the water (while on land).
const KEEP = "keep";
function steer(a, m, dx, dy, now, dry = false) {
  const moving = a.targetSpeed > 0;
  const keepDry = dry && a.pose !== "swim";
  const bin = (vx, vy) => sim.getDir(vx, vy, a.currentDirection || 0);
  if (a.blockedTick > m.lastTurn) m.avoid[bin(a.hx, a.hy)] = now + ticks(avoidBlockedS);
  // Whether `tiles` ahead along (vx, vy) is clear. Scaling the vector by its larger part
  // (no square root) looks 1 to 1.4 times that far.
  const clear = (vx, vy, tiles) => {
    if (m.avoid[bin(vx, vy)] > now) return false;
    const k = tiles / Math.max(Math.abs(vx), Math.abs(vy));
    const x = a.gx + vx * k, y = a.gy + vy * k;
    return sim.canStepTo(a, x, y) && !(keepDry && sim.isWaterAt(x, y));
  };
  const curBin = moving ? bin(a.hx, a.hy) : -1;
  const vec = d => sim.moveVecByDir[d];
  const open8 = d => d === curBin ? clear(...vec(d), 1) : clear(...vec(d), 1) && clear(...vec(d), 2);
  const near8 = d => clear(...vec(d), 1);
  if (m.detour && m.detour.until <= now) m.detour = null;

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

  if (moving && !m.detour) {
    const along = a.hx * dx + a.hy * dy;
    if (along > 0 && along * along >= keepHeadingCos2 * (dx * dx + dy * dy) && clear(a.hx, a.hy, 1)) return KEEP;
  }
  if (clear(dx, dy, 1) && clear(dx, dy, 2)) { m.detour = null; return [dx, dy]; }

  const want = bin(dx, dy);
  const turned = k => (want + 8 + m.detour.side * k) % 8;
  if (!m.detour) {
    let side = 0;
    for (const ok of [open8, near8]) {
      for (let k = 1; k <= 4 && !side; k++) {
        const right = ok((want + k) % 8), left = ok((want + 8 - k) % 8);
        if (right && left) side = Math.random() < 0.5 ? 1 : -1;
        else if (right) side = 1;
        else if (left) side = -1;
      }
      if (side) break;
    }
    if (!side) return null;
    m.detour = { side, until: now + ticks(detourS), reversed: false };
  }
  for (const ok of [open8, near8]) {
    for (let k = 1; k < 8; k++) {
      if (!ok(turned(k))) continue;
      if (k >= 3 && k <= 5) m.detour.reversed = true;
      return turned(k) === curBin ? KEEP : vec(turned(k));
    }
  }
  return null;
}

// The intent to go along (dx, dy) at a gait, steering round what's in the way. Rather
// than turn right round twice within reverseAgainS, it stands still.
function move(a, m, dx, dy, gait, now, dry = false) {
  const way = steer(a, m, dx, dy, now, dry);
  if (way === null) return IDLE;
  if (way === KEEP) {
    // the same vector as before, so the simulation keeps its heading
    const prev = m.intent && m.intent.dx !== undefined ? m.intent : { dx: a.hx, dy: a.hy };
    return prev.gait === gait ? prev : { dx: prev.dx, dy: prev.dy, gait };
  }
  const [vx, vy] = way;
  if (a.hx !== undefined) {
    const along = vx * a.hx + vy * a.hy;
    if (along < 0 && along * along >= 0.5 * (vx * vx + vy * vy)) { // 135 degrees or more
      if (now - m.reversedTick < ticks(reverseAgainS)) return IDLE;
      m.reversedTick = now;
    }
  }
  return { dx: vx, dy: vy, gait };
}

// DEER flee every wolf seen within deerAlarmS, away from where each was, the nearest
// counting most. Between wolves (the pulls nearly cancel) a deer breaks away sideways, to
// the side it faces. It keeps to its way for deerCommitS unless a wolf newly comes into
// sight. It gallops near where a wolf was seen, trots otherwise, and stops fleeing a wolf
// once deerSafeTiles from its last sighting (until it sees that wolf again).
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
    if (age > 0 && d2 > deerSafeTiles * deerSafeTiles) { k.escaped = true; continue; }
    const w = 1 / Math.max(d2, 1); // each pull is 1 / distance long
    fx += dx * w; fy += dy * w;
    pull += d2 * w * w;            // the sum of the pulls' lengths, squared
    if (d2 < nearest2) { nearest2 = d2; nx = dx; ny = dy; }
    if (age === 0) inSight = true;
    if (age === 0 && (!m.flee || k.sightedTick > m.flee.since)) newSighting = true;
    threats++;
  }
  if (!threats) {
    m.flee = null;
    const romance = a.food > romanceAbove && social(a, m, now, true);
    if (romance) return romance;
    const grazing = graze(a, m, now);
    if (grazing) { m.mode = "graze"; return grazing; }
    return settle(a, m, now);
  }

  m.mode = "flee";
  m.plan = null;
  if (!m.flee || m.flee.until <= now || newSighting) {
    let hx = fx, hy = fy;
    // The pulls cancel if their sum is shorter than deerCaughtBetween of their lengths
    // added up (compared squared, bounding that by threats times the sum of squares).
    if (fx * fx + fy * fy < deerCaughtBetween * deerCaughtBetween * pull * threats || (hx === 0 && hy === 0)) {
      hx = -ny; hy = nx;
      const [ux, uy] = [a.hx || 0, a.hy || 0];
      if (hx * ux + hy * uy < 0) { hx = -hx; hy = -hy; }
      if (hx === 0 && hy === 0) hx = 1; // right on top of it: any way out
    }
    m.flee = { dx: hx, dy: hy, until: now + ticks(deerCommitS), since: now };
  }
  const close = inSight || nearest2 < deerGallopWithinTiles * deerGallopWithinTiles;
  return move(a, m, m.flee.dx, m.flee.dy, close ? "gallop" : "trot", now);
}

// DEER graze from when the food meter falls below deerGrazeBelow until full: eat the
// tile underfoot if worth it (and crop it bare once started), else walk to the nearest
// tile worth it, preferring ones at least half full. Looks deerGrazeLookShare of its
// sight around, or as far as it sees when nothing there is worth it. An intent, or null if not
// grazing or no grass worth it is in sight.
function graze(a, m, now) {
  if (a.pose === "swim" || !sim.can(a, "eat")) return null;
  if (m.grazing && a.food >= deerFullAt) m.grazing = false;
  if (!m.grazing && a.food < deerGrazeBelow) m.grazing = true;
  if (!m.grazing) return null;
  const worth = deerBiteShare * sim.grassMaxKg * 0.999; // (grass is stored as 32-bit floats)
  let grass = senses.grassAround(a, deerGrazeLookShare);
  const goingFar = m.grazeTo && !grass.some(g => g.i === m.grazeTo[0] && g.j === m.grazeTo[1]);
  if (goingFar || !grass.some(g => g.kg >= worth)) grass = senses.grassAround(a);
  const i = Math.floor(a.gx), j = Math.floor(a.gy);
  const here = grass.find(g => g.i === i && g.j === j);
  const onIt = m.cropping && m.cropping[0] === i && m.cropping[1] === j;
  if (here && (here.kg >= worth || onIt)) { m.grazeTo = null; m.cropping = [i, j]; return EAT; }
  m.cropping = null;
  const at = m.grazeTo && grass.find(g => g.i === m.grazeTo[0] && g.j === m.grazeTo[1] && g.kg >= worth);
  if (!at) {
    let best = null, bestScore = Infinity;
    for (const g of grass) {
      if (g.kg < worth) continue;
      const d2 = (g.i + 0.5 - a.gx) ** 2 + (g.j + 0.5 - a.gy) ** 2;
      const score = d2 + (g.kg >= sim.grassMaxKg / 2 ? 0 : 1e6);
      if (score < bestScore) { best = g; bestScore = score; }
    }
    if (!best) { m.grazeTo = null; return null; }
    m.grazeTo = [best.i, best.j];
  }
  return move(a, m, m.grazeTo[0] + 0.5 - a.gx, m.grazeTo[1] + 0.5 - a.gy, "walk", now);
}

// WOLVES eat first: while not full (and old enough to eat), the nearest carcass with meat
// it saw within wolfForgetPreyS. Otherwise they hunt while hungry, once weaned (pups stay
// with their family and eat what it kills). Of the deer it knows, a wolf picks
// the nearest, or among those about as near, the one most straight ahead; then keeps to
// it for wolfCommitS (unless a deer in sight is much nearer) and after that changes only
// for one clearly nearer. In sight it heads straight for its prey; out of sight, for
// where it should be by now, then on the way it went, searching. A deer searched for and
// not found is lost until seen again.
function decideWolf(a, m, now) {
  if (a.food < wolfFullAt && sim.can(a, "eat")) {
    let carcass = null, bestD2 = Infinity;
    for (const k of m.known.values()) {
      if (k.species !== "deer" || k.alive || !(k.meat > 0) || now - k.seenTick > ticks(wolfForgetPreyS)) continue;
      const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
      if (d2 < bestD2) { carcass = k; bestD2 = d2; }
    }
    if (carcass) {
      m.mode = "feed"; m.target = null; m.searching = false; m.plan = null;
      if (bestD2 <= sim.eatReachTiles * sim.eatReachTiles) return EAT;
      return move(a, m, carcass.gx - a.gx, carcass.gy - a.gy, "trot", now);
    }
  }
  const romance = a.food > romanceAbove && social(a, m, now, true);
  if (romance) { m.target = null; m.searching = false; m.watch = null; return romance; }
  if (a.food >= wolfHuntBelow || sim.isInfant(a)) {
    m.target = null; m.searching = false; m.watch = null;
    return settle(a, m, now);
  }

  let target = m.target !== null ? m.known.get(m.target) : undefined;
  if (target && !target.alive) { m.target = null; target = undefined; }
  if (target && (target.lost || now - target.seenTick > ticks(wolfForgetPreyS))) target = undefined;

  // each deer it could go after, with its squared distance (to where it should be by
  // now) and how straight ahead it is (cos^2, signed: no square root)
  const [fx, fy] = [a.hx || 0, a.hy || 0];
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
      const near = options.find(o => o.k.seenTick === now && o.d2 < 0.25 * d2 && o.uid !== m.target);
      if (near) choose(near);
    } else if (choice.d2 < wolfSwitchRatio * d2) choose(choice);
  }
  target = m.target !== null ? m.known.get(m.target) : undefined;
  if (!target) { m.searching = false; return settle(a, m, now); }

  m.plan = null;
  if (target.swimming) {
    // waiting for it: once out of sight, it is lost, and the wolf looks for other prey
    if (now - target.seenTick > 0) {
      target.lost = true; m.target = null; m.watch = null;
      return decideWolf(a, m, now);
    }
    return waitAshore(a, m, target, now);
  }
  m.watch = null;
  m.mode = "chase";
  const age = now - target.seenTick;
  if (age === 0) m.searching = false;
  const [tx, ty] = expectedAt(target, now);
  let dx = tx - a.gx, dy = ty - a.gy;
  if (age > 0 && dx * dx + dy * dy < 4) m.searching = true;
  if (m.searching) {
    if (target.vx === 0 && target.vy === 0) { // it was standing still, and isn't here
      target.lost = true; m.target = null; m.searching = false; m.mode = "calm"; return calm(a, m, now);
    }
    dx = target.vx; dy = target.vy;
  }
  const close = age === 0 && dx * dx + dy * dy < wolfGallopWithinTiles * wolfGallopWithinTiles;
  return move(a, m, dx, dy, close ? "gallop" : "trot", now);
}

// A wolf doesn't follow prey k into the water (nor can it kill it there): it trots,
// keeping dry, to where k seems to be swimming to (landingAhead), or failing that the
// land nearest k, no farther from k than the wolf is; and waits there, while k stays in
// sight.
function waitAshore(a, m, k, now) {
  m.mode = "wait"; m.searching = false;
  const ki = Math.floor(k.gx), kj = Math.floor(k.gy);
  const way = k.vx || k.vy ? sim.getDir(k.vx, k.vy, 0) : -1;
  if (!m.watch || m.watch.i !== ki || m.watch.j !== kj || m.watch.way !== way) {
    let spot = way >= 0 ? landingAhead(a, k) : null;
    if (!spot) {
      const reach = Math.ceil(Math.max(Math.abs(a.gx - k.gx), Math.abs(a.gy - k.gy))) + 1;
      const land = findNearestLand(a, k.gx, k.gy, reach);
      spot = land ? [land.tile[0] + 0.5, land.tile[1] + 0.5] : [a.gx, a.gy];
    }
    m.watch = { i: ki, j: kj, way, spot };
  }
  const dx = m.watch.spot[0] - a.gx, dy = m.watch.spot[1] - a.gy;
  if (dx * dx + dy * dy < shoreWaitTiles * shoreWaitTiles) return IDLE;
  return move(a, m, dx, dy, "trot", now, true);
}

// Where swimmer k would come ashore if it carried on, as far as critter a can see: the
// center of the first tile along its way it could climb onto, within shoreLookAheadTiles;
// null if none in a's sight, or if it would meet land too steep to climb (it will have to
// turn).
function landingAhead(a, k) {
  const s = 0.5 / Math.max(Math.abs(k.vx), Math.abs(k.vy)); // half-tile steps, no square root
  const sx = k.vx * s, sy = k.vy * s;
  let pi = NaN, pj = NaN;
  for (let n = 1; n <= 2 * shoreLookAheadTiles; n++) {
    const i = Math.floor(k.gx + sx * n), j = Math.floor(k.gy + sy * n);
    if (i === pi && j === pj) continue;
    pi = i; pj = j;
    if (!senses.inSight(i + 0.5 - a.gx, j + 0.5 - a.gy)) return null;
    if (sim.isLandTile(i, j)) return [i + 0.5, j + 0.5];
    if (sim.getTerrainAt(i, j) !== "water") return null;
  }
  return null;
}

// With nothing more pressing: mates and family, else wander.
function settle(a, m, now) {
  const s = social(a, m, now);
  if (s) return s;
  m.mode = "calm";
  return calm(a, m, now);
}

// MATES AND FAMILY: an intent, or null for nothing to do; with romanceOnly, only for
// courting and mating.
//   The young (not grown) keep within followParentTiles of a parent (the mother first).
//   A female keeps within motherStayTiles of her nearest infant.
//   A paired critter mates with its partner while she is in heat (she while she is); a
//     paired male otherwise keeps within pairStayTiles of her, and she within twice that
//     of him (so one trotting off at the other's speed can't leave the other behind).
//   (Going to them, it trots while 2 tiles beyond where it would stop, else walks.)
//   An unpaired grown critter courts the nearest unpaired grown critter of its species
//     and the other sex, if not kin or familiar (WESTERMARCK): goes to it and stands
//     ready to mate within mateCloseTiles. It gives up on one that hasn't mated with it in
//     courtGiveUpS.
// Kin out of sight are looked for where last seen; not there, they are lost until seen
// again.
function social(a, m, now, romanceOnly = false) {
  const live = uid => {
    const k = m.known.get(uid);
    return k && k.alive && !k.lost ? k : null;
  };
  const d2Of = k => (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
  // the intent to go to k (uid) until within `within` (in sight), or null when there
  const goTo = (uid, k, within) => {
    const d2 = d2Of(k);
    if (k.seenTick === now) { if (d2 <= within * within) return null; }
    else if (d2 <= kinLostTiles * kinLostTiles) { k.lost = true; return null; }
    return move(a, m, k.gx - a.gx, k.gy - a.gy, d2 > within * within + 4 ? "trot" : "walk", now);
  };
  const mateWith = (uid, k) => {
    const go = goTo(uid, k, mateCloseTiles);
    if (go) return go;
    return k.lost ? null : { gait: "mate", with: uid };
  };

  if (!sim.isGrown(a)) {
    m.court = null;
    if (romanceOnly) return null;
    const uid = a.parentUids.find(live);
    if (uid === undefined) return null;
    m.mode = "family";
    return goTo(uid, live(uid), followParentTiles);
  }

  if (!a.isMale && !romanceOnly) {
    let infant = null, infantD2 = Infinity;
    for (const uid of a.youngUids) {
      const k = live(uid);
      if (k && k.infant && d2Of(k) < infantD2) { infant = uid; infantD2 = d2Of(k); }
    }
    if (infant !== null) {
      m.mode = "family";
      const go = goTo(infant, live(infant), motherStayTiles);
      if (go) return go;
    }
  }

  if (a.mateUid !== null) {
    m.court = null;
    const p = live(a.mateUid);
    if (!p) return null;
    const inHeat = a.isMale ? p.inHeat : sim.inHeat(a);
    if (inHeat && p.seenTick === now) { m.mode = "mate"; return mateWith(a.mateUid, p); }
    if (romanceOnly) return null;
    m.mode = "family";
    return goTo(a.mateUid, p, a.isMale ? pairStayTiles : 2 * pairStayTiles);
  }

  let best = null, bestD2 = Infinity;
  for (const [uid, k] of m.known) {
    if (k.species !== a.species || !k.alive || k.lost || k.isMale === a.isMale || !k.grown) continue;
    if (k.mateUid !== null || now - k.seenTick > ticks(wolfForgetPreyS)) continue;
    if (m.familiar.has(uid) || isKin(a, uid) || (m.refused.get(uid) ?? -Infinity) > now) continue;
    const d2 = d2Of(k);
    if (d2 < bestD2) { best = uid; bestD2 = d2; }
  }
  if (best === null) { m.court = null; return null; }
  if (!m.court || m.court.uid !== best) m.court = { uid: best, since: now };
  else if (now - m.court.since > ticks(courtGiveUpS)) {
    m.refused.set(best, now + ticks(courtRetryS));
    m.court = null;
    return null;
  }
  m.mode = "court";
  return mateWith(best, m.known.get(best));
}

// A swimmer short of stamina (below sim.swimMinStamina) heads for the nearest land it
// can see and climb onto, whatever else it would do; with none in sight, it swims on.
function toShore(a, m, now) {
  m.mode = "ashore"; m.plan = null;
  const blocked = a.blockedTick > m.lastTurn;
  if (!m.shore || (blocked && ++m.shore.blockedTurns > shoreRetryTurns)) {
    const land = findNearestLand(a, a.gx, a.gy);
    m.shore = land ? { gx: land.tile[0] + 0.5, gy: land.tile[1] + 0.5, blockedTurns: 0 } : null;
  }
  if (!m.shore) return calm(a, m, now);
  return move(a, m, m.shore.gx - a.gx, m.shore.gy - a.gy, "walk", now);
}

// CALM: wander for a random while (a random heading at a walk or trot, or a pause;
// galloping is only for chasing and fleeing). An unpaired grown critter ROAMS instead,
// to meet others: one heading at a trot for roamS / 2 to roamS (as young wolves disperse
// to find mates). A swimmer may head for land instead, the more surely the farther away
// it is.
function calm(a, m, now) {
  const p = m.plan;
  const blocked = a.blockedTick > m.lastTurn;
  if (p && p.kind === "toLand") {
    if (a.pose !== "swim") { m.plan = null; return calm(a, m, now); }
    if (blocked && ++p.blockedTicks > ticks(returnToLandGiveUpS)) m.plan = null;
    else return move(a, m, p.gx - a.gx, p.gy - a.gy, "walk", now);
  }
  if (p && p.kind === "wander" && now < p.until && !blocked) return p.intent;

  const until = now + 120 + Math.floor(Math.random() * 500 + Math.random() * 500);
  if (a.pose === "swim") {
    const land = findNearestLand(a, a.gx, a.gy);
    // certain at returnToLandSureTiles; compared squared to avoid a square root
    const roll = Math.random() * returnToLandSureTiles;
    if (land && roll * roll < land.distL2) {
      m.plan = { kind: "toLand", gx: land.tile[0] + 0.5, gy: land.tile[1] + 0.5, blockedTicks: 0 };
      return move(a, m, m.plan.gx - a.gx, m.plan.gy - a.gy, "walk", now);
    }
  }
  const roam = sim.isGrown(a) && a.mateUid === null;
  if (!roam && Math.random() < 0.1) {
    m.plan = { kind: "wander", until, intent: IDLE };
  } else {
    // the same intent all plan long, so the simulation works out its heading once
    let dx = 1, dy = 0;
    for (let tries = 0; tries < 4; tries++) {
      dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1;
      const k = 1 / Math.max(Math.abs(dx), Math.abs(dy), 0.01); // about a tile ahead
      if (sim.canStepTo(a, a.gx + dx * k, a.gy + dy * k)) break;
    }
    const gait = roam || Math.random() < 0.5 ? "trot" : "walk";
    m.plan = { kind: "wander", until: roam ? now + ticks(roamS * (0.5 + Math.random() / 2)) : until,
      intent: { dx, dy, gait } };
  }
  return m.plan.intent;
}

// The nearest land tile to (gx, gy) a swimmer can climb onto that critter a can see,
// within maxR tiles: { tile: [i, j], distL2 (squared distance to the tile's nearest
// point) }, or null.
function findNearestLand(a, gx, gy, maxR = Infinity) {
  const sightReach = Math.ceil((senses.sightHalfWidthTiles + senses.sightHalfHeightTiles) / 2) + 1;
  maxR = Math.min(maxR, sightReach + Math.ceil(Math.max(Math.abs(gx - a.gx), Math.abs(gy - a.gy))));
  const ci = Math.floor(gx), cj = Math.floor(gy);
  const sq = v => v * v;
  const distToTileL2 = (i, j) => sq(Math.max(i - gx, 0, gx - (i + 1)))
    + sq(Math.max(j - gy, 0, gy - (j + 1)));
  let best = null;
  // square rings outward; no tile in ring r is nearer than r - 1
  for (let r = 0; r <= maxR; r++) {
    if (best && r >= 1 && best.distL2 <= sq(r - 1)) break;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
      if (!senses.inSight(i + 0.5 - a.gx, j + 0.5 - a.gy) || !sim.isLandTile(i, j)) continue;
      const d = distToTileL2(i, j);
      if (!best || d < best.distL2) best = { tile: [i, j], distL2: d };
    }
  }
  return best;
}

// Every tick: the critters whose turn it is perceive, remember and decide.
function think() {
  const now = sim.tickCount;
  for (const a of sim.allCritters) {
    if (!sim.isLiveCritter(a) || ignored.has(a)) continue;
    const m = memoryOf(a);
    if (a === sim.pcWolf && sim.playerHasControl()) {
      // drop its own last decision, so it doesn't resume it the moment the player lets go
      if (m.intent) { sim.setIntent(a, null); m.intent = null; }
      m.playerTick = now; m.plan = null;
      continue;
    }
    if (now % turnTicks !== m.slot) continue;
    remember(a, m, now);
    let intent;
    if (a.pose !== "swim") m.shore = null;
    if (now - m.playerTick < ticks(playerHandoverS)) intent = IDLE;
    else if (a.pose === "swim" && a.stamina < sim.swimMinStamina) intent = toShore(a, m, now);
    else intent = a.species === "wolf" ? decideWolf(a, m, now) : decideDeer(a, m, now);
    m.intent = intent;
    m.lastTurn = now;
    sim.setIntent(a, intent);
  }
  for (const a of memories.keys()) if (!sim.allCritters.includes(a)) dropMemory(a);
}

// For tests and debugging: leave a critter alone (it keeps doing what it was last told),
// or take it back.
function ignore(a, on = true) {
  if (on) { ignored.add(a); sim.setIntent(a, null); }
  else ignored.delete(a);
}

// The player has handed critter a over: it decides on its next turn, without the usual
// wait after the player lets go (playerHandoverS).
function takeOver(a) {
  const m = memories.get(a);
  if (m) m.playerTick = -Infinity;
}

// For tests and debugging: wipe a critter's memory and last decision.
function forget(a) {
  dropMemory(a);
  sim.setIntent(a, null);
}

// For tests and debugging: what a critter has in mind.
function stateOf(a) {
  const m = memories.get(a);
  if (!m) return null;
  return { mode: m.mode, target: m.target, searching: m.searching, flee: m.flee, detour: m.detour, watch: m.watch,
    slot: m.slot, lastTurn: m.lastTurn, court: m.court, familiar: [...m.familiar],
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

return { attach, takeOver, ignore, forget, stateOf, get turnTicks() { return turnTicks; }, wolfHuntBelow };

})();

// In Node, mind.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = mind;
