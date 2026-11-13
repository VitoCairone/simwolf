// THE MIND: what each critter decides to do.
//
// On its turn, each critter (but the player's wolf while the player steers it) takes in
// what it perceives (senses.js), updates its memory, and hands the simulation an intent
// (sim.setIntent). NO MAGICAL KNOWLEDGE (see admin/design_notes.md): of the world outside
// itself it knows only what its senses tell it, now or in memory: where other critters
// are (prey, threats, carcasses, mates, parents, young alike), what they are, and the
// terrain, grass and shores in sight. Its own state (meters, age, whether in heat, whom
// it is paired with or born of, whether it is suckling) is always its to read, as is the
// ground under its next steps (sim.canStepTo: it feels its footing), and whether water
// in its reach is fresh or the sea (sim.waterInReach: it tastes it).
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
//   a wolf howling howls on (HOWLING in sim.js); a wolf carrying a leg takes it to whom it
//     is for (SUPPORT FEEDING); a parent tells its mate it is going hunting or back with
//     a soft bark along with whatever it does (FAMILY ROLES)
//   a famished wolf (not an infant) eats, or else follows kin that barked "follow"
//     (FOLLOWING), or else, old enough, hunts (decideWolf: FAMISHED); but a parent stays
//     with its young while its mate is away hunting (FAMILY ROLES)
//   a mother long away from her young too young to walk, or hearing one whimper, goes
//     back to them, and stays by them a while (BROODING), unless badly thirsty
//   a thirsty critter drinks, or goes to water (thirst); but an infant suckles first, a
//     deer stands still for her young suckling first (nursing), and a hungry deer not
//     badly thirsty grazes first (graze)
//   a wolf eats a carcass it knows of while not full (decideWolf), but an infant suckles
//     first; then, fed, it may tear off a leg to carry home (SUPPORT FEEDING)
//   a wolf follows kin that barked "follow" lately, if it would eat (FOLLOWING); a grown
//     wolf going to a carcass with kin about barks "follow", along with it (LEADING)
//   a mother stands still while young suckle from her; an infant suckles while hungry
//     (nursing)
//   while its meter is above romanceAbove, a grown critter courts and mates, or mates
//     with its partner in heat (social, romance only)
//   a deer grazes while hungry (graze); a wolf hunts while hungry and old enough, waiting on
//     the shore for prey in the water (waitAshore), and following deer trails (track)
//     whenever it can't see or hear its prey
//   mates and family (social): courting and mating as above, at any hunger; keeping near
//     a partner or infants; the young keep near a parent (but one too young to walk stays
//     put unless it perceives her: PUPS STAY PUT)
//   a grown wolf not hunting calls ("come") kin it has lost, along with whatever it does
//     (CALLS)
//   a hungry infant not perceiving its mother whimpers (along with whatever it does)
//   a wolf with nothing else to do stays by a kill it knows of (STAYS BY ITS KILL)
//   anything else wanders (calm)
// And whatever it decides, if that is to stand still and something has just bumped into
// it, it steps aside first (giveWay).
// HUNGER: its two meters (sim.js, BODY): a.food, the energy its body holds, and a.gut, how
// full its stomach is. It eats while its body is hungry, until its stomach is full
// (a.stomachFull: it can take no more; or a.gut at gutFullAt) or its body is; and starts
// again only with room in its stomach.
// THIRST: its water meter, a.water (sim.js, BODY: WATER). It drinks while thirsty (see
// thirst).
// Every move goes through goTo (WAYFINDING): to a spot, round what it knows is in the way.
// A critter going round in a small patch escapes it (TRAPPED).

const mind = (() => {

// (a local Math: looking globals up is slow where the code runs in a Node vm context)
const Math = globalThis.Math;

let sim = null;    // set by attach()
let senses = null;

const deerAlarmS = 15;           // a deer keeps fleeing a wolf it perceived this long ago
const deerGallopWithinTiles = 8; // gallop while within this of where a wolf was last seen
const deerCommitS = 0.75;        // keep to a chosen way to flee at least this long
const deerCaughtBetween = 0.3;   // the pulls of wolves cancel to below this share: break sideways
// Above this share of a full meter, courting and mating come before eating.
const romanceAbove = 0.5;
const gutFullAt = 0.99;          // stops eating with its stomach this full (or full: see HUNGER)
const deerGrazeBelow = 0.8;      // a deer starts grazing with its food meter below this...
const deerGrazeGutBelow = 0.5;   // ...and its stomach below this
const deerFullAt = 0.99;         // ...and grazes until it is this full (or its stomach is)
const deerForageBelow = 0.45;     // seeing no grass worth it, goes looking for some (FORAGING) below this...
const forageLookS = 3;            // ...once it has seen none so long
// A tile is worth walking to and starting on with at least this share of the most a tile
// holds. Grass regrows a little every second, so without it deer go back for the crumbs
// on tiles they have just cropped.
const deerBiteShare = 0.1;
const deerGrazeLookShare = 0.25; // looks this share of its sight for grass first, then all of it
const grazeLosChecks = 40;       // ...checking line of sight to at most this many, best first
const grazeGiveUpS = 4;          // gives up on grass it has got no nearer to in this long...
const grazeAvoidS = 60;          // ...and leaves it be this long
const wolfFamishedHungerAbove = 0.5; // a wolf this hungry (1 - its food meter)...
const wolfFamishedGutBelow = 0.5; // ...its stomach below this, eats or hunts before all else
const wolfHuntBelow = 0.75;      // a wolf hunts only with its food meter below this...
const wolfHuntGutBelow = 0.25;   // ...and its stomach below this
const wolfFullAt = 0.99;         // eats until it is this full (or its stomach is)...
const wolfFeedBelow = 0.9;       // ...and goes back to a carcass only below this...
const wolfFeedGutBelow = 0.5;    // ...with its stomach below this
const feedQueueTiles = 3;        // blocked this near a carcass, a wolf waits its turn...
const feedWaitS = 1;             // ...this long, then tries again
const outOfReachS = 30;          // leaves be a carcass it knows no way to this long
const carcassKeepS = 10 * 60;    // remembers a carcass with meat on it this long since it last perceived it
const stayByKillTiles = 6;       // fed, stays this near a carcass with meat (STAYS BY ITS KILL)...
const stayOffKillTiles = 3;      // ...and no nearer
const wolfForgetPreyS = 20;      // gives up on prey it last perceived (or smelled the trail of) this long ago
const trailEndKeepS = 4 * 3600;  // remembers a trail's dead end this long (longer than any trail lasts)
const wolfLeadMaxS = 2;          // expects unseen prey to carry on this long, at most
const wolfCommitS = 5;           // keeps to a chosen prey at least this long
const wolfSimilarRatio = 2;      // deer within this of the nearest's squared distance are
                                 // about as near: choose among them by facing
const wolfSwitchRatio = 0.5;     // after wolfCommitS, changes prey only for one this much
                                 // nearer (squared distance)
const wolfRushTiles = 30;        // PACE: gallops at prey unaware of it this near...
const wolfFleeingShare = 0.7;    // ...or fleeing it (moving at this share of a deer's trot)...
const wolfPursueS = 10;          // ...perceived as lately as this
const wolfStalkTrailS = 30;      // on a deer trail fresher than this, it stalks...
const wolfStrideWindFrom = 0.8;  // ...on an older one gallops from this much wind...
const wolfStrideWindTo = 0.6;    // ...down to this, then walks until it has that much again
const shoreWaitTiles = 1;        // a wolf this near its spot on the shore waits there
const waitCommitS = 3;           // ...and keeps to that spot at least this long
const shoreLookAheadTiles = 40;  // looks this far along a swimmer's way for its landing
const shoreRetryTurns = 10;      // a tired swimmer blocked this many turns looks for other land
const swimTurnBackShare = 0.45;  // a swimmer that has burned this share of the stamina it
                                 // went in with makes for land (see TIRED SWIMMERS)
const entryNearTiles = 3;        // where it entered the water: the shore this near its last
                                 // footing on land
const landLookEveryS = 1;        // a swimmer looks for land this often
const returnToLandSureTiles = 4; // a calm swimmer this far from land surely heads for it
const returnToLandGiveUpS = 1;   // ...but gives up after being blocked this long
const mateCloseTiles = 1.2;      // stands ready to mate this near (center to center)
const courtGiveUpS = 30;         // gives up courting one that hasn't mated after this long...
const courtRetryS = 120;         // ...and leaves it be this long
const pairStayTiles = 6;         // a paired male keeps within this of his partner
const suckleBelow = 0.8;         // an infant goes to suckle with its meter below this...
const suckleGutBelow = 0.5;      // ...and its stomach below this
const suckleFullAt = 0.99;       // ...and suckles until it is this full (or its stomach is)
const suckleTouchTiles = 0.1;    // stops this near touching its mother (box to box)
const suckleGraceS = 0.6;        // getting nothing this long (longer than a stun)...
const suckleRetryS = 5;          // ...it tries again after this long
const keepCloseShare = 0.5;      // keeping near kin, it comes back to within this share of the distance
const broodTiles = 2;            // a mother keeps her young too young to walk within this of her (BROODING)
const followParentTiles = 3;     // an infant keeps within this of a parent...
const followWeanedTiles = 10;    // ...a weaned youngster, within this
const kinSpacingTiles = 1.5;     // coming back to kin, it stops at least this far off
const kinRetryS = 10;            // gives up going to kin it knows no way to this long
const yieldS = 0.8;              // bumped while standing, it steps aside this long
const kinLostTiles = 2;          // kin not where last seen, this near: lost until seen again
const roamS = 40;                // an unpaired grown critter roams one way up to this long
const calmRoamStamina = 0.5;     // ...with stamina above this
const calmRestShare = 0.1;       // at ease and fully rested, it rests this share of its plans
const playerHandoverS = 2;       // after the player lets go, the wolf waits this long
const keepHeadingCos2 = 0.97;    // keep the current heading within 10 degrees (cos^2)
const reverseAgainS = 1;         // don't turn right round again sooner than this
const drinkBelow = 0.8;           // goes to drink with its water meter below this (some 3%
                                  // of its weight lost: estimate)...
const drinkFullAt = 0.99;         // ...and drinks until it is this full;
const seekBelow = 0.99;           // ...but knowing of no fresh water, it looks for some below this;
const deerDrinkFirstBelow = 0.5;  // a hungry deer grazes first, unless its meter is below this
const waterLookS = 2;             // notes the shores in sight this often...
const waterCellTiles = 16;        // ...the nearest in each square of this many tiles a side
const shoreLosChecks = 4;         // ...in line of sight (checking this many, nearest first)
const watersKept = 48;            // ...remembering this many shores, the nearest
const saltNearTiles = 48;         // water tasted salt: shores remembered this near are the sea's
const drinkGiveUpS = 6;           // gives up on a shore it has got no nearer to in this long...
const drinkAvoidS = 120;          // ...and leaves it be this long
const searchLegS = 15;            // searching for water, it keeps to a way this long...
const searchNearTiles = 10;       // ...any way this near where it began, else away from there...
const searchFarTiles = 150;       // ...and beyond this, back toward it
const decideEveryS = 0.1;
// FAMILY ROLES, DENS, SUPPORT FEEDING
const denSearchTiles = 12;        // a female looks for her den among the spots in sight this near...
const denStepTiles = 2;           // ...every this many tiles
const denTiles = 1.5;             // at the den: within this of it
const guardTiles = 3;             // a parent staying with its young keeps within this of them (or the den)
const homeTiles = 5;              // back home: within this of its young (or the den)
const guardStarveBelow = 0.35;    // ...a parent staying with its young goes off to eat below this food meter (with time to find food)
const dropTiles = 1.8;            // a leg carried home is put down this near whom it is for (its mouth, a half tile on, within her eatReachTiles)
const denWaterTiles = 200;        // a den within this of fresh water (as real wolves' dens are)
const denWaterNearTiles = 150;    // ...knowing none so near, she goes to within this of some
const litterAwayShare = 0.5;      // a mother away from her young too young to walk this share of an infant's full meter heads back...
const litterThirstBelow = 0.3;    // ...unless her water meter is below this
const whimperHeedS = 10;          // a mother heeds a whimper of her young heard this lately
const litterStayS = 30;           // ...and back by them, stays this long (estimate: for them to suckle)
const callAfterS = 20;            // a wolf calls kin it has lost, or not perceived this long
const followHeedS = 15;           // a wolf follows kin it heard bark "follow" this lately (LEADING)...
const followTiles = 4;            // ...keeping within this of it

// Whether a's stomach can take no more: full to the brim, or its meter full (see HUNGER).
// (A stomach full of poorer food than its usual reads less than full.)
function stomachFull(a) { return a.stomachFull || a.gut >= gutFullAt; }

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
      mode: "calm",           // calm | flee | chase | wait | track | feed | graze | drink | ashore | court | seek | mate | family | nurse | yield | escape | prowl | rest | brood | den | guard | provide | carry
      yield: null,            // giving way: { until, intent } (see giveWay)
      target: null,           // a wolf's prey (uid)
      targetUntil: -Infinity, // ...kept until this tick at least
      flee: null,             // a deer's way to flee: { dx, dy, until, since }
      searching: false,       // a wolf has reached where its unseen prey should be
      trailEnds: new Map(),   // deer uid -> the game time its trail was given up at (see track)
      trackMark: null,        // { species, t, laid, tick }: the mark it is going to (TRACKING)
      outOfReach: new Map(),  // carcass uid -> the tick until which it leaves it be (WOLVES)
      preyTrail: null,        // { uid, tick }: its prey's trail, followed lately (see HUNTING)
      striding: false,        // galloping along a trail (PACE)
      pursuit: null,          // { uid, tick }: the prey it is running down, perceived then (PACE)
      prowl: null,            // { dx, dy, x, y, until }: its leg, searching for prey (PROWLING)
      mateTrailEnds: new Map(), // ...and a prospective mate's (see social)
      deathEnds: new Map(),   // ...and a carcass's death scent
      watch: null,            // a wolf waiting ashore: { i, j, way (its prey's tile and way), spot }
      shore: null,            // a tired swimmer's land: { gx, gy, blockedTurns }
      lastDry: null,          // where it last stood on land, [gx, gy] (see TIRED SWIMMERS)
      entry: null,            // swimming: the shore it entered the water from, [i, j]
      landSeen: null,         // ...and the nearest it has seen since, [i, j]
      landLook: -Infinity,    // ...the tick it last looked for land
      entryStamina: null,     // ...and the stamina it went in with
      closing: null,          // the kin it is coming back to: "parent", "young", "mate" (see social)
      grazeAvoid: new Map(),  // tile key -> tick: grass it couldn't get to, left be until then
      grazeSince: 0,          // ...the tick it set off for its grazeTo, and its best distance
      grazeBestD2: Infinity,  //    so far
      grazing: false,         // a deer grazing (from hungry until full)
      suckle: null,           // an infant suckling: { since (the tick it began getting no
                              // milk touching her, or null), retry (not again before this tick) }
      grazeTo: null,          // ...the tile it is walking to, [i, j]
      cropping: null,         // ...the tile it is eating, [i, j]
      waters: new Map(),      // cell key -> a shore it has seen there: { i, j, salt } (see thirst)
      saltCells: new Set(),   // ...cells whose water it knows is the sea's
      waterLook: -Infinity,   // ...the tick it last noted the shores in sight
      drinking: false,        // thirsty (from drinkBelow until drinkFullAt)
      waterTo: null,          // ...the cell key of the shore it is going to
      waterSince: 0,          // ...the tick it set off for it, and its best distance so far
      waterBestD2: Infinity,
      waterAvoid: new Map(),  // cell key -> tick: a shore it couldn't drink at, left be until then
      search: null,           // searching for water: { dx, dy, until }
      lookFrom: null,         // ...where it began to look, [gx, gy]
      plan: null,             // a calm critter's plan: { kind, until, intent, ... }
      rocks: new Set(),       // tile keys of the boulders it has seen (WAYFINDING)
      bumps: new Map(),       // ...and of those it has bumped into, to when it keeps them
      wet: new Set(),         // ...and of water it has seen, keeping dry
      path: null,             // the path it is following: { tx, ty (its spot), dry, made (tick), tiles, failed }
      heading: null,          // heading one way: { dx, dy, tx, ty (the spot it heads for) }
      visits: new Map(),      // square key -> { s (time spent there), at (game time) } (TRAPPED)
      trapSeen: [],           // ...where it was every trapLookS: [gx, gy, path so far]
      trapPath: 0,            // ...how far it has gone, tiles
      trapLook: -Infinity,    // ...the tick it last looked
      trapped: 0,             // ...how trapped it is, 0..1
      escape: null,           // ...escaping: { tx, ty, until }
      den: null,              // a paired wolf's den, [gx, gy] (DENS)
      kinTrailEnds: new Map(), // a young wolf's parents' trails given up (FINDING ITS PARENTS)
      fedSince: false,        // ate at a carcass since it last carried a leg off (SUPPORT FEEDING)
      given: new Set(),       // ...the legs it put down for others (by the uid they lie as)
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

// MEMORY: the latest perception of every creature a critter has seen, heard or smelled
// (k.seenTick, by k.by: where, which way and how fast, whether alive, swimming, the meat
// left on a carcass, and, from when it was last seen, its sex, age and partner and whether
// in heat), kept after losing track of it until too old to matter (a carcass with meat
// on it, carcassKeepS); its kin's (partner, parents, young) for good. A carcass it would
// smell (within senses.sniffTiles) but doesn't is forgotten: it is gone. Up close it
// smells whether any meat is left, so it stops going to a bare one.
// WESTERMARCK: it never forgets those of its species it met while it or they were
// infants (m.familiar), and a deer never mates with them. A wolf mates with any but its
// parents, young and siblings (by scent: perceive), familiar or not: a HACK for the tiny
// start population (4 wolves: THE START in sim.js), so that their young find mates.
function remember(a, m, now) {
  const selfInfant = sim.isInfant(a);
  for (const o of senses.perceive(a)) {
    const before = m.known.get(o.uid);
    // what only sight tells is kept from the last time it was seen (the entry updated in place)
    const seen = o.by === "sight", k = before || {};
    // perceived since now, unless it was at its last turn too
    k.sightedTick = before && before.seenTick === m.lastTurn ? before.sightedTick : now;
    k.species = o.species; k.alive = o.alive; k.gx = o.gx; k.gy = o.gy; k.vx = o.vx; k.vy = o.vy;
    if (o.swimming != null) k.swimming = o.swimming;
    if (o.meat != null) k.meat = o.meat;
    k.seenTick = now; k.by = o.by; k.lost = undefined; // (found, if it was lost)
    if (seen) {
      k.isMale = o.isMale; k.infant = o.infant; k.dependent = o.dependent; k.grown = o.grown; k.mateUid = o.mateUid;
      k.inHeat = o.inHeat; k.walks = o.walks; k.eats = o.eats; k.carrying = o.carrying;
    }
    k.nursingOnMe = !!o.nursingOnMe; k.littermate = !!o.littermate; k.sibling = !!o.sibling;
    if (o.leg != null) k.leg = o.leg;
    // (its last role bark, and apart from it its last call, and its last "follow": BARKS)
    if (o.signal) {
      if (isCall(o.signal)) k.call = o.signal;
      else if (o.signal.kind === "follow") k.follow = o.signal;
      else k.signal = o.signal;
    }
    if (!before) m.known.set(o.uid, k);
    if (seen && o.species === a.species && (selfInfant || o.infant)) m.familiar.add(o.uid);
  }
  const longest = ticks(Math.max(deerAlarmS, wolfForgetPreyS)), sniff2 = senses.sniffTiles ** 2;
  for (const [uid, k] of m.known) {
    const carcass = !k.alive && k.meat > 0;
    if (now - k.seenTick > (carcass ? ticks(carcassKeepS) : longest) && !isKin(a, uid)) m.known.delete(uid);
    // a carcass not smelled where it was, up close, is gone
    else if (senses.use.smell && !k.alive && k.species === "deer" && k.seenTick !== now
      && (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2 <= sniff2) m.known.delete(uid);
  }
}

function isCall(signal) { return signal.kind === "come" || signal.kind === "whimper"; }

function isKin(a, uid) {
  return uid === a.mateUid || a.parentUids.includes(uid) || a.youngUids.includes(uid);
}

// Whether a won't mate with uid (WESTERMARCK).
function barredMate(a, m, uid) {
  if (isKin(a, uid)) return true;
  return a.species === "wolf" ? !!m.known.get(uid)?.sibling : m.familiar.has(uid);
}

// Where a remembered creature should be by now, had it carried on as last seen (for at
// most wolfLeadMaxS).
function expectedAt(k, now) {
  const t = Math.min(now - k.seenTick, ticks(wolfLeadMaxS));
  return [k.gx + k.vx * t, k.gy + k.vy * t];
}

// WAYFINDING: a critter going to a spot (goTo) goes straight for it while the way ahead is
// clear as far as it knows (wayClear: straightTiles ahead, or to the spot); otherwise along
// a path (findPath: A* over the tiles within pathReachTiles of it, to the spot, or as near
// it as that reaches) round what it knows is in the way: boulders, ledges it can't step up
// or down, water while it keeps dry (or hasn't the stamina to go in), and critters within
// crowdTiles that it perceives now or touched within touchKeepS (where it stood then; see
// TOUCHED in sim.js: the path round their tiles, but an infant's, too small to bar one),
// but the one it is going to, `through` (a uid, or a list of them). Heading one way (head)
// is going to a spot headTiles off that way.
//   WHAT IT KNOWS OF THE GROUND: boulders it has seen (m.rocks: their tops in its line of
//   sight; kept, as boulders don't move) and water it has seen while keeping dry (m.wet);
//   tiles it was stopped going into by something it didn't know of, for bumpKeepS
//   (m.bumps: noteBump); the lie of the land (ledges, water) in its sight circle and
//   field of view; and all of it within feelTiles (it feels its footing). Elsewhere it
//   takes the ground to be open, and learns better as it goes.
//   FOLLOWING A PATH: it heads for the farthest of the next pathLookTiles tiles of it that it
//   can go straight to (cutting corners where it can). It plans afresh when the spot moves
//   off the path's end, when blocked, and when it can't go straight to the path's next tile;
//   at the end of a path that doesn't reach the spot, it stands there (as near as it knows
//   how to get) until replanS after planning it. Every replanS it looks for a better way,
//   taking it only if it reaches the spot where the old didn't, or is shorter by more than
//   pathSwitchTiles (so it doesn't waver between two ways about as good).
//   KEEPING DRY: told to keep dry (opts.dry true), it never plans through water it knows
//   of; rather dry ("rather"), it does when no dry way reaches the spot and a wet one
//   does, and keeps to that. Swimming, it keeps to no such thing (it is in the water).
//   It keeps its heading while within keepHeadingCos2 of the wanted way (each new heading
//   costs the simulation a square root). Rather than turn right round twice within
//   reverseAgainS, it stands still. It goes no faster than the way ahead is clear for, as
//   far as it would go before its next turn: coming to a bend, it slows for it (or stops);
//   within arriveTiles of where it will stop (the spot, or a path's end short of it), it
//   walks (but not closing on another critter).
const straightTiles = 10;
const pathReachTiles = 24;
const pathMaxNodes = 3000;
const pathLookTiles = 6;
const routeTiles = 12;           // foreseeing its way along a path, as far as this beyond its waypoint
const replanS = 2;
const pathSwitchTiles = 3;
const arriveTiles = 1.5;         // this near where it will stop, it walks
const feelTiles = 2;
const headTiles = 16;
const crowdTiles = 3;
const firstStepTiles = 0.001;    // (a first tick's step from standing, about)
const touchKeepS = 1;
const bumpKeepS = 20;
const crowdMarginTiles = 0.05;  // room it leaves past another's box
const waterCostFactor = 3;       // swimming a tile costs this much more than walking one
const rocksKept = 5000, wetKept = 5000;
const SQ2 = Math.SQRT2;
const dirSteps = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// The facts about the ground a critter goes by this turn (WHAT IT KNOWS OF THE GROUND),
// worked out as asked for and kept for the turn.
function wayContext(a, m, now, opts) {
  const dry = a.pose !== "swim" && (!!opts.dry || !sim.mayEnterWater(a));
  const crowd = new Set(), others = [];
  // (a newborn too young to walk crawls in among its littermates: CRAWLING in sim.js)
  const crawls = !sim.can(a, "walk");
  const through = uid => Array.isArray(opts.through) ? opts.through.includes(uid) : uid === opts.through;
  for (const [uid, k] of m.known) {
    if (!k.alive || k.seenTick !== now || through(uid) || (crawls && k.littermate)) continue;
    if (Math.abs(k.gx - a.gx) > crowdTiles || Math.abs(k.gy - a.gy) > crowdTiles) continue;
    if (!k.infant) crowd.add(Math.floor(k.gx) * 100000 + Math.floor(k.gy)); // (an infant is too small to bar a tile)
    others.push(k);
  }
  // (one it has just touched, seen or not: where it stood)
  const felt = m.known.get(a.touchedBy);
  if (now - a.touchedTick <= ticks(touchKeepS) && !through(a.touchedBy) && !(felt?.seenTick === now)) {
    if (!felt?.infant) crowd.add(Math.floor(a.touchedX) * 100000 + Math.floor(a.touchedY));
    others.push({ gx: a.touchedX, gy: a.touchedY, infant: felt?.infant });
  }
  return { a, m, now, dry, crowd, others, through: opts.through, share: senses.sightShare(a), sees: sim.can(a, "see"), known: new Map(), open: new Map(), corners: new Map() };
}

// Whether the critter knows the lie of the land on tile (i, j).
function groundKnown(c, i, j) {
  const key = i * 100000 + j;
  let v = c.known.get(key);
  if (v === undefined) {
    const dx = i + 0.5 - c.a.gx, dy = j + 0.5 - c.a.gy;
    v = (Math.abs(dx) <= feelTiles + 0.5 && Math.abs(dy) <= feelTiles + 0.5)
      || (c.sees && senses.inSight(dx, dy, c.share) && senses.inView(c.a, dx, dy));
    c.known.set(key, v);
  }
  return v;
}

function cornersOf(c, i, j) {
  const key = i * 100000 + j;
  let v = c.corners.get(key);
  if (v === undefined) { v = sim.tileCorners(i, j); c.corners.set(key, v); }
  return v;
}

// Notes the tile a critter bumped into, stunned by something it didn't know of (not
// another critter: it touches that), as a tile it may not go onto, for bumpKeepS: the one
// its box's leading corner was pushing into, or (that its own) the one ahead along its
// heading's greater part.
function noteBump(a, m, now) {
  if (!(a.blockedTick > m.lastTurn) || a.touchedTick === a.blockedTick || a.pose === "swim") return;
  const d = a.boxRad + 0.1, ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  let i = Math.floor(a.gx + Math.sign(a.hx) * d * (Math.abs(a.hx) > 0.38 ? 1 : 0));
  let j = Math.floor(a.gy + Math.sign(a.hy) * d * (Math.abs(a.hy) > 0.38 ? 1 : 0));
  if (i === ci && j === cj) {
    if (Math.abs(a.hx) >= Math.abs(a.hy)) i = Math.floor(a.gx + Math.sign(a.hx) * d);
    else j = Math.floor(a.gy + Math.sign(a.hy) * d);
  }
  if (i === ci && j === cj) return;
  m.bumps.set(i * 100000 + j, now + ticks(bumpKeepS));
  if (m.bumps.size > 50) for (const [k, until] of m.bumps) if (until < now) m.bumps.delete(k);
}

// Whether the critter may go onto tile (i, j), as far as it knows (a boulder it knows of,
// water it knows of while dry, a tile it bumped into lately: no; nor, with crowd, a critter
// about it there).
function tileOpen(c, i, j, crowd = true) {
  const key = i * 100000 + j;
  if (crowd && c.crowd.has(key)) return false;
  let v = c.open.get(key);
  if (v !== undefined) return v;
  v = !(c.m.bumps.get(key) > c.now);
  if (i < 0 || j < 0 || i >= sim.gridWidthN || j >= sim.gridHeightN) v = false;
  else if (sim.isBlockedTile(i, j)) {
    const rocks = c.m.rocks;
    if (rocks.has(key)) v = false;
    else {
      const dx = i + 0.5 - c.a.gx, dy = j + 0.5 - c.a.gy;
      const near = Math.abs(dx) <= feelTiles + 0.5 && Math.abs(dy) <= feelTiles + 0.5;
      if (near || (groundKnown(c, i, j) && senses.canSeePoint(c.a, i + 0.5, j + 0.5, sim.heightAt(i + 0.5, j + 0.5) + sim.obstacleHeightAt(i, j)))) {
        rocks.add(key);
        if (rocks.size > rocksKept) rocks.delete(rocks.values().next().value); // (the oldest)
        v = false;
      }
    }
  } else if (c.dry && sim.getTerrainAt(i, j) === "water") {
    const wet = c.m.wet;
    if (wet.has(key)) v = false;
    else if (groundKnown(c, i, j)) {
      wet.add(key);
      if (wet.size > wetKept) wet.delete(wet.values().next().value); // (the oldest)
      v = false;
    }
  }
  c.open.set(key, v);
  return v;
}

// Whether it can step from tile (i, j) to the tile beside it (ni, nj) (not diagonal), as
// far as it knows: the ground either side of their shared edge, at its middle, within a
// step.
function stepOK(c, i, j, ni, nj) {
  if (!groundKnown(c, i, j) || !groundKnown(c, ni, nj)) return true;
  const p = cornersOf(c, i, j), q = cornersOf(c, ni, nj); // [nw, ne, sw, se]
  let mine, theirs;
  if (ni > i) { mine = p[1] + p[3]; theirs = q[0] + q[2]; }
  else if (ni < i) { mine = p[0] + p[2]; theirs = q[1] + q[3]; }
  else if (nj > j) { mine = p[2] + p[3]; theirs = q[0] + q[1]; }
  else { mine = p[0] + p[1]; theirs = q[2] + q[3]; }
  return Math.abs(mine - theirs) / 2 <= sim.maxStepLevels;
}

// Whether it can go straight from where it is to (x, y), as far as it knows: in steps of a
// fifth of a tile, its box over the whole way over no tile it may not go onto, nor (within
// crowdTiles) over a critter about it (but one it is already against and drawing away
// from), no ledge it can't step (between tiles, or from step to step, as the simulation
// checks).
function wayClear(c, x, y) {
  const a = c.a, r = a.boxRad, n = Math.max(1, Math.ceil(Math.max(Math.abs(x - a.gx), Math.abs(y - a.gy)) * 5));
  let px = a.gx, py = a.gy, pi = Math.floor(px), pj = Math.floor(py), ph = sim.heightAt(px, py);
  const bi0 = Math.floor(a.gx - r), bi1 = Math.floor(a.gx + r), bj0 = Math.floor(a.gy - r), bj1 = Math.floor(a.gy + r);
  // (its first step, as the simulation checks it: grazing another's box)
  const f = firstStepTiles / Math.max(Math.abs(x - a.gx), Math.abs(y - a.gy), firstStepTiles);
  if (!crowdClear(c, a.gx + (x - a.gx) * f, a.gy + (y - a.gy) * f)) return false;
  for (let s = 1; s <= n; s++) {
    const sx = a.gx + (x - a.gx) * s / n, sy = a.gy + (y - a.gy) * s / n;
    // (its box over the whole step: from where it stands, it may touch nothing it is against;
    // but water its box is over already, keeping dry, it may stay over on its way out)
    const i0 = Math.floor(Math.min(px, sx) - r), i1 = Math.floor(Math.max(px, sx) + r);
    const j0 = Math.floor(Math.min(py, sy) - r), j1 = Math.floor(Math.max(py, sy) + r);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (i === Math.floor(a.gx) && j === Math.floor(a.gy)) continue; // (where it stands)
      if (tileOpen(c, i, j, false)) continue;
      if (c.dry && i >= bi0 && i <= bi1 && j >= bj0 && j <= bj1 && sim.getTerrainAt(i, j) === "water") continue;
      return false;
    }
    px = sx; py = sy;
    const si = Math.floor(sx), sj = Math.floor(sy);
    if (Math.abs(sx - a.gx) <= crowdTiles && Math.abs(sy - a.gy) <= crowdTiles && !crowdClear(c, sx, sy)) return false;
    if (si !== pi || sj !== pj) {
      // into the next tile: across an edge (or a corner: both ways round)
      if (si !== pi && sj !== pj) {
        if (!(stepOK(c, pi, pj, si, pj) && stepOK(c, si, pj, si, sj)) && !(stepOK(c, pi, pj, pi, sj) && stepOK(c, pi, sj, si, sj))) return false;
      } else if (!stepOK(c, pi, pj, si, sj)) return false;
      pi = si; pj = sj;
    }
    if (groundKnown(c, si, sj)) {
      const sh = sim.heightAt(sx, sy);
      if (Math.abs(sh - ph) > sim.maxStepLevels) return false;
      ph = sh;
    }
  }
  return true;
}

// A path from the critter's tile toward (tx, ty): A* over the tiles within pathReachTiles of
// it, 8 ways (a diagonal step only where both tiles beside it are open), swimming costing
// waterCostFactor. To the spot's tile, or failing that the tile it reached nearest the spot.
// [[i, j], ...], the critter's own tile left out; [] if it can get no nearer.
function findPath(c, tx, ty) {
  const a = c.a, R = pathReachTiles, W = 2 * R + 1;
  const si = Math.floor(a.gx), sj = Math.floor(a.gy);
  const gi = Math.floor(tx), gj = Math.floor(ty);
  const g = new Float32Array(W * W).fill(Infinity), from = new Int32Array(W * W).fill(-1), shut = new Uint8Array(W * W);
  const idx = (i, j) => (i - si + R) * W + (j - sj + R);
  const h = (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return dx + dy + (SQ2 - 2) * Math.min(dx, dy); };
  const water = (i, j) => sim.getTerrainAt(i, j) === "water";
  // a binary heap of [f, node]
  const heap = [];
  const push = (f, k) => {
    heap.push([f, k]);
    for (let n = heap.length - 1; n > 0;) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let n = 0; ;) {
        const l = 2 * n + 1, r = l + 1;
        let s = n;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === n) break;
        [heap[s], heap[n]] = [heap[n], heap[s]]; n = s;
      }
    }
    return top;
  };
  const start = idx(si, sj);
  g[start] = 0; push(h(si, sj), start);
  let best = start, bestH = h(si, sj), expanded = 0;
  while (heap.length && expanded < pathMaxNodes) {
    const [, k] = pop();
    if (shut[k]) continue;
    shut[k] = 1; expanded++;
    const i = Math.floor(k / W) - R + si, j = (k % W) - R + sj;
    const hk = h(i, j);
    if (hk < bestH) { best = k; bestH = hk; }
    if (i === gi && j === gj) break;
    for (const [di, dj] of dirSteps) {
      const ni = i + di, nj = j + dj;
      if (Math.abs(ni - si) > R || Math.abs(nj - sj) > R) continue;
      const nk = idx(ni, nj);
      if (shut[nk] || !tileOpen(c, ni, nj)) continue;
      if (di && dj) {
        if (!tileOpen(c, ni, j) || !tileOpen(c, i, nj)) continue;
        if (!(stepOK(c, i, j, ni, j) && stepOK(c, ni, j, ni, nj)) && !(stepOK(c, i, j, i, nj) && stepOK(c, i, nj, ni, nj))) continue;
      } else if (!stepOK(c, i, j, ni, nj)) continue;
      const cost = (di && dj ? SQ2 : 1) * (water(ni, nj) && groundKnown(c, ni, nj) ? waterCostFactor : 1);
      const ng = g[k] + cost;
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + h(ni, nj), nk); }
    }
  }
  const path = [];
  for (let k = best; k !== start && k >= 0; k = from[k]) path.push([Math.floor(k / W) - R + si, (k % W) - R + sj]);
  return path.reverse();
}

// The intent to go to spot (tx, ty) at a gait (WAYFINDING). opts: dry (keep out of the
// water), through (the uid of the critter it is going to: not in its way).
function goTo(a, m, tx, ty, gait, now, opts = {}) {
  const dx = tx - a.gx, dy = ty - a.gy;
  if (dx * dx + dy * dy < 0.0025) return IDLE;
  let p = m.path;
  const far2 = Math.max(4, 0.04 * (dx * dx + dy * dy));
  const wetOpts = opts.dry === "rather" ? { ...opts, dry: false } : null;
  // (rather dry, it goes on the wet way it took, finding no dry one, while going there)
  const w0 = m.wetTo, wet = wetOpts && w0 && now - w0.tick <= ticks(replanS) && (w0.tx - tx) ** 2 + (w0.ty - ty) ** 2 <= far2;
  if (wet) w0.tick = now;
  let c = wayContext(a, m, now, wet ? wetOpts : opts);
  // standing in the shallows, keeping dry (too tired to swim, say): out onto the land its
  // box is over first
  if (c.dry && a.pose !== "swim" && sim.getTerrainAt(Math.floor(a.gx), Math.floor(a.gy)) === "water") {
    const out = landBeside(c);
    if (out) { m.path = null; return toward(a, m, out[0] - a.gx, out[1] - a.gy, "walk", now, c); }
  }
  const k = Math.min(1, straightTiles / Math.max(Math.abs(dx), Math.abs(dy)));
  // (coming to where it will stop, it walks, so as to stop short of what is beyond: but not
  // closing on another critter)
  const arrive = (x, y) => opts.through === undefined && Math.max(Math.abs(x - a.gx), Math.abs(y - a.gy)) < arriveTiles ? "walk" : gait;
  if (wayClear(c, a.gx + dx * k, a.gy + dy * k)) { m.path = null; return toward(a, m, dx, dy, arrive(tx, ty), now, c); }
  const valid = p && p.dry === c.dry && !(a.blockedTick > m.lastTurn) && (p.tx - tx) ** 2 + (p.ty - ty) ** 2 <= far2;
  let way = valid ? nextWaypoint(c, p) : null;
  const planIn = w => {
    const tiles = findPath(w, tx, ty), end = tiles.at(-1);
    return { tx, ty, dry: w.dry, made: now, tiles, failed: tiles.length === 0,
      whole: !!end && end[0] === Math.floor(tx) && end[1] === Math.floor(ty) };
  };
  const plan = () => {
    const q = planIn(c);
    if (q.whole || !wetOpts || !c.dry) return q;
    const w = wayContext(a, m, now, wetOpts);
    if (w.dry) return q; // (too tired to swim)
    const q2 = planIn(w);
    if (!q2.whole) return q;
    c = w; m.wetTo = { tx, ty, tick: now };
    return q2;
  };
  if (way && now - p.made > ticks(replanS)) { // a better way? (else it keeps to this one)
    const q = plan();
    if ((q.whole && !p.whole) || (q.whole === p.whole && q.tiles.length + pathSwitchTiles < p.tiles.length)) {
      p = m.path = q;
      way = nextWaypoint(c, p);
    } else p.made = now;
  }
  // at the end of a way that doesn't reach the spot: as near as it knows how to get, for now
  if (!way && valid && !p.whole && !p.tiles.length && now - p.made <= ticks(replanS)) return IDLE;
  if (!way) {
    p = m.path = plan();
    way = nextWaypoint(c, p);
    // none it can go straight to (its box against a corner, say): to the middle of its own
    // tile first, then on; from there, it takes the path's first tile for closed (a ledge or
    // corner it can't manage: as if it had bumped into it; but not for others in the way)
    // and plans again; else a step off
    // what it is against, as near the path's way as it can; knowing no way nearer at all,
    // it stands
    const ci = Math.floor(a.gx) + 0.5, cj = Math.floor(a.gy) + 0.5, middle = (a.gx - ci) ** 2 + (a.gy - cj) ** 2 <= 0.02;
    const bare = { ...c, others: [] }; // (others aside: they move)
    for (let tries = 0; !way && middle && p.tiles.length && tries < 3; tries++) {
      const [i, j] = p.tiles[0], key = i * 100000 + j;
      if (wayClear(bare, i + 0.5, j + 0.5)) break; // (others in the way, not the ground)
      m.bumps.set(key, now + ticks(bumpKeepS)); c.open.delete(key);
      p = m.path = plan();
      way = nextWaypoint(c, p);
    }
    if (!way) {
      if (!p.tiles.length) return IDLE;
      way = !middle && wayClear(c, ci, cj) ? [ci, cj] : stepOff(c, p.tiles[0][0] + 0.5, p.tiles[0][1] + 0.5);
    }
  }
  const end = p && !p.whole && p.tiles.length ? p.tiles.at(-1) : null;
  // (the way on along the path, for foreseeing it: FORESEEING)
  if (p && p.tiles.length) {
    const wi = Math.floor(way[0]), wj = Math.floor(way[1]), at = p.tiles.findIndex(([i, j]) => i === wi && j === wj);
    c.route = [way, ...p.tiles.slice(at + 1, at + 1 + routeTiles).map(([i, j]) => [i + 0.5, j + 0.5])];
  }
  return toward(a, m, way[0] - a.gx, way[1] - a.gy, end ? arrive(end[0] + 0.5, end[1] + 0.5) : arrive(tx, ty), now, c);
}

// Whether the critter's box at (x, y) is clear of the others about it it knows of (their
// boxes, as far as it can tell: an adult's, or an infant's a newborn's), with
// crowdMarginTiles to spare: going no nearer
// one it is already that near, it may come within the margin, and (as the simulation lets
// it) overlap one it already overlaps.
function crowdClear(c, x, y) {
  const a = c.a, adult = a.boxRad + sim.adultBoxRad, newborn = a.boxRad + sim.adultBoxRad * sim.youngScales[0];
  for (const k of c.others) {
    const touch = k.infant ? newborn : adult, span = touch + crowdMarginTiles;
    const nx = Math.abs(x - k.gx), ny = Math.abs(y - k.gy);
    if (nx >= span || ny >= span) continue;
    const ox = Math.abs(a.gx - k.gx), oy = Math.abs(a.gy - k.gy);
    const apart = nx * nx + ny * ny > ox * ox + oy * oy;
    if (apart && ((ox < touch && oy < touch) || !(nx < touch && ny < touch))) continue;
    return false;
  }
  return true;
}

// The middle of the nearest open land tile beside the critter (or under its box), for one
// standing in the water; null if none.
function landBeside(c) {
  const a = c.a, ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  let best = null, bestD2 = Infinity;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    if ((i === ci && j === cj) || sim.getTerrainAt(i, j) === "water" || !tileOpen(c, i, j, false)) continue;
    const d2 = (Math.max(i - a.gx, 0, a.gx - i - 1)) ** 2 + (Math.max(j - a.gy, 0, a.gy - j - 1)) ** 2;
    if (d2 < bestD2) { best = [i + 0.5, j + 0.5]; bestD2 = d2; }
  }
  return best;
}

// A spot stepOffTiles off, in one of the 8 directions, where the critter's box is over no
// tile it may not go onto (or its own) and clear of others (crowdClear), the nearest the way
// to (x, y); else (x, y).
const stepOffTiles = 0.2;
function stepOff(c, x, y) {
  const a = c.a, r = a.boxRad, ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  let best = null, bestDot = -Infinity;
  for (const [ux, uy] of dirSteps) {
    const k = stepOffTiles / (ux && uy ? SQ2 : 1), sx = a.gx + ux * k, sy = a.gy + uy * k;
    let ok = true;
    for (let i = Math.floor(sx - r); i <= Math.floor(sx + r) && ok; i++) for (let j = Math.floor(sy - r); j <= Math.floor(sy + r) && ok; j++)
      ok = (i === ci && j === cj) || tileOpen(c, i, j, false);
    if (!ok || !crowdClear(c, sx, sy)) continue;
    const dot = (ux * (x - a.gx) + uy * (y - a.gy)) / (ux && uy ? SQ2 : 1);
    if (dot > bestDot) { best = [sx, sy]; bestDot = dot; }
  }
  return best || [x, y];
}

// Where to head along path p: the center of the farthest of its next pathLookTiles tiles
// (past the one the critter is on) it can go straight to; null if none.
function nextWaypoint(c, p) {
  const a = c.a, ci = Math.floor(a.gx), cj = Math.floor(a.gy);
  const on = p.tiles.findIndex(([i, j]) => i === ci && j === cj);
  if (on >= 0) p.tiles = p.tiles.slice(on + 1);
  const n = Math.min(pathLookTiles, p.tiles.length);
  for (let k = n - 1; k >= 0; k--) {
    const [i, j] = p.tiles[k];
    if (wayClear(c, i + 0.5, j + 0.5)) return [i + 0.5, j + 0.5];
  }
  return null;
}

// The intent to head one way (dx, dy): to a spot headTiles off that way (kept while it
// heads within headSameCos2 of that way and is still far from it). Knowing no way at least
// halfway there, it heads as near that way as it can: turned 45 degrees either side, then
// 90, then 135.
const headTurns = [0, 1, -1, 2, -2, 3, -3];
const headSameCos2 = 0.85; // about 23 degrees
function head(a, m, dx, dy, gait, now, opts = {}) {
  let h = m.heading;
  const dot = h ? h.dx * dx + h.dy * dy : 0;
  const same = dot > 0 && dot * dot >= headSameCos2 * (h.dx * h.dx + h.dy * h.dy) * (dx * dx + dy * dy);
  if (!same || (h.tx - a.gx) ** 2 + (h.ty - a.gy) ** 2 < (headTiles / 2) ** 2) {
    h = m.heading = { dx, dy, turn: 0 };
    for (const turn of headTurns) {
      let [vx, vy] = [dx, dy];
      for (let k = 0; k < Math.abs(turn); k++) [vx, vy] = turn > 0 ? [(vx - vy) * Math.SQRT1_2, (vx + vy) * Math.SQRT1_2] : [(vx + vy) * Math.SQRT1_2, (vy - vx) * Math.SQRT1_2];
      const k = headTiles / Math.max(Math.abs(vx), Math.abs(vy), 1e-9);
      h.tx = a.gx + vx * k; h.ty = a.gy + vy * k;
      const c = wayContext(a, m, now, opts);
      if (wayClear(c, a.gx + vx * k * straightTiles / headTiles, a.gy + vy * k * straightTiles / headTiles)) break;
      // (a way that gets it at least half as far that way)
      const end = findPath(c, h.tx, h.ty).at(-1);
      const along = end ? (end[0] + 0.5 - a.gx) * vx + (end[1] + 0.5 - a.gy) * vy : 0;
      if (along > 0 && along * along >= (headTiles / 2) ** 2 * (vx * vx + vy * vy)) break;
    }
  }
  return goTo(a, m, h.tx, h.ty, gait, now, opts);
}

// The intent to go along (dx, dy) as it goes now: keeping its heading if near enough and
// clear for a couple of tiles (the same vector as before, so the simulation keeps its
// heading); rather than turn right round twice within reverseAgainS, it stands still. Its
// gait no faster than the way ahead is clear for (as far as it would go before its next
// turn, with room to spare): coming to a turn of its path, it slows for it, and going
// faster than a walk with the way not clear even for that, it stops first. Turning to a
// new heading takes it a while (TURNING in sim.js), going on meanwhile much the way it
// faces at the speed it has. Faster than a trot, it foresees the way it will go at each
// gait (FORESEEING: along the path it follows, or to the new heading and on), and takes
// the fastest whose way keeps off all it knows would stop it, else slows to a walk,
// turning still; slower, it stops short of what it would bump (TURNING), so the way it
// faces need only be clear for as far as it goes turning, or it slows to a walk. Turning
// right round is from the heading it last asked for (or its own, having asked none).
function toward(a, m, dx, dy, gait, now, c) {
  let vx = dx, vy = dy;
  const k = 2 / Math.max(Math.abs(a.hx), Math.abs(a.hy), 1e-9);
  let keep = false;
  if (a.targetSpeed > 0) {
    const along = a.hx * dx + a.hy * dy;
    keep = along > 0 && along * along >= keepHeadingCos2 * (dx * dx + dy * dy) && wayClear(c, a.gx + a.hx * k, a.gy + a.hy * k);
  }
  const prev = m.intent && m.intent.dx !== undefined ? m.intent : { dx: a.hx, dy: a.hy };
  if (keep) { vx = prev.dx; vy = prev.dy; }
  else if (prev.dx !== undefined) {
    const along = dx * prev.dx + dy * prev.dy;
    if (along < 0 && along * along >= 0.5 * (dx * dx + dy * dy) * (prev.dx * prev.dx + prev.dy * prev.dy)) { // 135 degrees or more
      if (now - m.reversedTick < ticks(reverseAgainS) && m.reversedTick !== now) return IDLE; // (this turn's, asked again: fine)
      m.reversedTick = now;
    }
  }
  if (a.pose !== "swim") {
    const span = Math.max(Math.abs(vx), Math.abs(vy), 1e-9);
    // the angle to turn, near enough (from its cosine squared: no trig)
    const dot = a.hx * vx + a.hy * vy, c2 = dot * dot / (vx * vx + vy * vy || 1);
    const angle = keep ? 0 : Math.PI / 2 * (dot >= 0 ? 1 - c2 : 1 + c2);
    const walk = sim.gaitSpeed(a.species, "walk"), v0 = a.speed, fast = v0 > 1.05 * sim.gaitSpeed(a.species, "trot");
    const turning = angle > 0.1 && !fast && v0 > 1.05 * walk ? Math.min(straightTiles, v0 * angle / sim.turnStep(v0)) + 0.3 : 0;
    if (turning && !wayClear(c, a.gx + a.hx * turning, a.gy + a.hy * turning)) return { dx: vx, dy: vy, gait: "walk" };
    // (foreseeing its way: along the path it follows, or to (vx, vy) turning to it)
    const pts = fast ? c.route || [[a.gx + vx, a.gy + vy]] : null;
    let clear = false;
    for (const g of gait === "gallop" ? ["gallop", "trot", "walk"] : gait === "trot" ? ["trot", "walk"] : gait === "stalk" ? ["stalk", "walk"] : [gait]) {
      gait = g;
      const reach = Math.max(v0, sim.gaitSpeed(a.species, g)) * turnTicks * 1.5 + 0.3;
      if ((clear = wayClear(c, a.gx + vx / span * reach, a.gy + vy / span * reach) && (!pts || sweepClear(c, pts, g)))) break;
    }
    if (pts && !clear) return { dx: vx, dy: vy, gait: "walk" };
    // (too fast to stop short of what is ahead: it stops first)
    if (!clear && v0 > 1.2 * walk) return IDLE;
  }
  if (keep) return prev.gait === gait ? prev : { dx: prev.dx, dy: prev.dy, gait };
  return { dx: vx, dy: vy, gait };
}

// FORESEEING (FAST TURNS): the way critter c.a will go over the next sweepTicks, at gait
// g, steering for each of the spots pts in turn (the next once within a tile of one), and
// straight on past the last (going to another critter, which won't be there by then, only
// sweepTailTicks more), as the simulation turns and speeds it (TURNING
// and SPEED CHANGES in sim.js), in steps of sweepStepTicks: whether its box keeps off all
// it knows would stop it (tileOpen), with sweepMarginTiles to spare, while faster than a
// trot (slower, it would stop short). No square roots: it steers by the
// sign of the cross product, and its heading's length is kept 1 by a Newton step.
const sweepTicks = 90, sweepTailTicks = 40, sweepStepTicks = 2, sweepMarginTiles = 0.3;
function sweepClear(c, pts, g) {
  const a = c.a, r = a.boxRad, rm = r + sweepMarginTiles, cos2 = sim.pivotCos * sim.pivotCos;
  const vg = sim.gaitSpeed(a.species, g);
  const walk = sim.gaitSpeed(a.species, "walk"), trot = sim.gaitSpeed(a.species, "trot");
  const bi0 = Math.floor(a.gx - r), bi1 = Math.floor(a.gx + r), bj0 = Math.floor(a.gy - r), bj1 = Math.floor(a.gy + r);
  let x = a.gx, y = a.gy, hx = a.hx, hy = a.hy, v = a.speed, t = 0, tail = 0;
  for (let n = 0; n < sweepTicks; n += sweepStepTicks) {
    while (t < pts.length && Math.abs(pts[t][0] - x) < 1 && Math.abs(pts[t][1] - y) < 1) t++;
    if (t === pts.length && (tail += sweepStepTicks) > (c.through ? sweepTailTicks : sweepTicks)) return true;
    const [px, py] = t < pts.length ? pts[t] : [x + hx, y + hy]; // (past the last: straight on)
    const dx = px - x, dy = py - y, d2 = dx * dx + dy * dy, dot = hx * dx + hy * dy;
    const target = dot < 0 || (dot * dot < cos2 * d2 && v <= walk) ? 0 : vg;
    const acc = sim.speedStep(a.species, v) * sweepStepTicks;
    v = v < target ? Math.min(target, v + acc) : Math.max(target, v - acc);
    const s = sim.turnStep(v) * sweepStepTicks, c1 = 1 - s * s / 2;
    let nx, ny;
    if (dot > 0 && dot * dot >= c1 * c1 * d2) { const q = 1 / dot; nx = dx * q; ny = dy * q; } // (there)
    else {
      const sn = (hx * dy - hy * dx >= 0 ? 1 : -1) * (s - s * s * s / 6);
      nx = hx * c1 - hy * sn; ny = hy * c1 + hx * sn;
    }
    const k = 1.5 - 0.5 * (nx * nx + ny * ny);
    hx = nx * k; hy = ny * k;
    x += hx * v * sweepStepTicks; y += hy * v * sweepStepTicks;
    if (v > trot) {
      for (let i = Math.floor(x - rm); i <= Math.floor(x + rm); i++) for (let j = Math.floor(y - rm); j <= Math.floor(y + rm); j++) {
        if (i >= bi0 && i <= bi1 && j >= bj0 && j <= bj1) continue; // (against it already)
        if (!tileOpen(c, i, j, false)) return false;
      }
    }
  }
  return true;
}

// TRAPPED: every trapLookS a critter notes where it is (the last trapSamples places) and
// how far it has gone since; having gone at least trapPathTiles over them while staying
// within trapBoxTiles across, it is trapped: m.trapped grows by trapStep (to 1), and
// otherwise falls back by it. It keeps a rough map of where it has been (m.visits: time
// spent in each square visitCellTiles a side, fading by half every visitHalfLifeS). A
// trapped critter that is at ease, searching, going somewhere or fleeing (not chasing prey
// it perceives, eating or drinking, nursing or mating) ESCAPES, with chance m.trapped
// each turn: of spots trapEscapeTiles off it in 16 ways that it knows it can go to, to the
// least visited (none at all, best), by path, rather dry, until there or trapEscapeS has
// passed. Fleeing, it escapes only to a spot no nearer what it flees (not more than 90
// degrees off the way it flees), at its gait; it gives that up once it is no longer
// fleeing, or the spot comes to be that way (and likewise an escape begun at ease once it
// flees).
const trapLookS = 1, trapSamples = 30, trapPathTiles = 30, trapBoxTiles = 8, trapStep = 0.1;
const visitCellTiles = 4, visitHalfLifeS = 600, visitsKept = 4000;
const trapEscapeTiles = 20, trapEscapeS = 20;
const escapeWays = Array.from({ length: 16 }, (_, k) => [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);
const escapableModes = new Set(["calm", "track", "seek", "family", "court", "drink", "graze", "feed", "flee", "prowl"]);

function visitKey(x, y) { return Math.floor(x / visitCellTiles) * 100000 + Math.floor(y / visitCellTiles); }

// How long (s, faded) the critter has spent in the square containing (x, y).
function visitsAt(m, x, y) {
  const v = m.visits.get(visitKey(x, y));
  return v ? v.s * Math.pow(0.5, (sim.now - v.at) / visitHalfLifeS) : 0;
}

// Notes where the critter is (each turn), and whether it is trapped (every trapLookS).
function noteWhere(a, m, now) {
  const key = visitKey(a.gx, a.gy), dt = turnTicks * sim.tempo;
  const v = m.visits.get(key);
  if (v) { v.s = v.s * Math.pow(0.5, (sim.now - v.at) / visitHalfLifeS) + dt; v.at = sim.now; }
  else {
    m.visits.set(key, { s: dt, at: sim.now });
    if (m.visits.size > visitsKept) for (const [k2, w] of m.visits) { if (w.s * Math.pow(0.5, (sim.now - w.at) / visitHalfLifeS) < 1) m.visits.delete(k2); }
  }
  m.trapPath += a.speed * turnTicks;
  if (now - m.trapLook < ticks(trapLookS)) return;
  m.trapLook = now;
  const s = m.trapSeen;
  s.push([a.gx, a.gy, m.trapPath]);
  if (s.length > trapSamples) s.shift();
  if (s.length < trapSamples) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const trapped = s[s.length - 1][2] - s[0][2] >= trapPathTiles && x1 - x0 < trapBoxTiles && y1 - y0 < trapBoxTiles;
  m.trapped = Math.max(0, Math.min(1, m.trapped + (trapped ? trapStep : -trapStep)));
}

// A trapped critter's escape (TRAPPED): an intent, or null to do as it decided.
function escape(a, m, now, intent) {
  const e = m.escape;
  if (e && (now > e.until || (e.tx - a.gx) ** 2 + (e.ty - a.gy) ** 2 < 4)) { m.escape = null; m.trapped /= 2; }
  if (!escapableModes.has(m.mode) || intent === EAT || (intent && (intent.gait === "eat" || intent.gait === "mate"))) {
    m.escape = null;
    return null;
  }
  const f = m.mode === "flee" ? m.flee : null;
  if (!m.escape) {
    if (!(Math.random() < m.trapped)) return null;
    const c = wayContext(a, m, now, { dry: true });
    let best = null, bestV = Infinity;
    for (const [ux, uy] of escapeWays) {
      if (f && ux * f.dx + uy * f.dy < 0) continue; // (not back toward what it flees)
      const x = a.gx + ux * trapEscapeTiles, y = a.gy + uy * trapEscapeTiles;
      if (!tileOpen(c, Math.floor(x), Math.floor(y))) continue;
      const v = visitsAt(m, x, y) + Math.random() * 0.01;
      if (v < bestV) { best = [x, y]; bestV = v; }
    }
    if (!best) return null;
    m.escape = { tx: best[0], ty: best[1], until: now + ticks(trapEscapeS), flee: !!f };
  }
  const e2 = m.escape;
  if (e2.flee !== !!f || (f && (e2.tx - a.gx) * f.dx + (e2.ty - a.gy) * f.dy < 0)) { m.escape = null; return null; }
  m.mode = "escape";
  return goTo(a, m, m.escape.tx, m.escape.ty, intent && intent.gait === "gallop" ? "gallop" : "trot", now, { dry: "rather" });
}

// DEER flee every wolf perceived (seen, heard or smelled) within deerAlarmS, however far
// off, away from where each was, the nearest counting most. Between wolves (the pulls
// nearly cancel) a deer breaks away sideways, to the side it faces. It keeps to its way for deerCommitS unless a wolf newly comes into
// sight. It gallops near where a wolf was seen, trots otherwise. Knowing no way on the way
// it flees, it turns to one side of it, then the other, by turns.
function decideDeer(a, m, now) {
  let fx = 0, fy = 0, pull = 0, nearest2 = Infinity, nx = 0, ny = 0;
  let inSight = false, threats = 0, newSighting = false;
  for (const k of m.known.values()) {
    if (k.species !== "wolf" || !k.alive) continue;
    const age = now - k.seenTick;
    if (age > ticks(deerAlarmS)) continue;
    const dx = a.gx - k.gx, dy = a.gy - k.gy;
    const d2 = dx * dx + dy * dy;
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
    const nursing = nurseOrSuckle(a, m, now);
    if (nursing) return nursing;
    // (grass is mostly water: a deer short of it, but not badly, grazes first)
    const drinking = a.water < deerDrinkFirstBelow && thirst(a, m, now);
    if (drinking) return drinking;
    const romance = a.food > romanceAbove && social(a, m, now, true);
    if (romance) return romance;
    const grazing = graze(a, m, now);
    if (grazing) { m.mode = m.foraging ? "forage" : "graze"; return grazing; }
    const thirsty = thirst(a, m, now);
    if (thirsty) return thirsty;
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
  const go = head(a, m, m.flee.dx, m.flee.dy, close ? "gallop" : "trot", now);
  if (go !== IDLE) return go;
  // no way on that way (the water, a cliff): it breaks away to one side, else the other
  const f = m.flee, [ox, oy] = f.o || (f.o = [f.dx, f.dy]), side = (f.turns = (f.turns || 0) + 1) % 2 ? 1 : -1;
  f.dx = -oy * side; f.dy = ox * side;
  return go;
}

// DEER graze from when the food meter falls below deerGrazeBelow (with its stomach below
// deerGrazeGutBelow) until full (or its stomach is): eat the plants (grass and
// undergrowth: senses.plantsAround) on the tile underfoot if worth it (and crop it bare
// once started), else walk to the nearest tile worth it, preferring ones at least half
// full (sim.plantMostAt). Pine needles (sim.pineFoodAt), a poor food, it seeks out only
// when no tile it sees is worth it without them. Looks deerGrazeLookShare of its
// sight around, or as far as it sees when nothing there is worth it. Grass under a
// boulder (less of it: sim.grassMostAt) it eats from the open tile beside the boulder
// nearest it. Grass it gets no nearer to in grazeGiveUpS, or meets a dead end on the way
// to, it leaves be for grazeAvoidS. Grass where another critter stands it leaves for now.
// Below deerForageBelow, seeing no grass worth it, or only grass grazed down below half
// (and not only needles), for forageLookS, it goes looking for better (FORAGING, as
// PROWLING). An intent, or null if not grazing or no grass worth it is in sight.
function graze(a, m, now) {
  m.foraging = false;
  if (a.pose === "swim" || !sim.can(a, "eat")) return null;
  if (m.grazing && (a.food >= deerFullAt || stomachFull(a))) m.grazing = false;
  if (!m.grazing && a.food < deerGrazeBelow && a.gut < deerGrazeGutBelow) m.grazing = true;
  if (!m.grazing) return null;
  const worth = deerBiteShare * sim.grassMaxKg * 0.999; // (grass is stored as 32-bit floats)
  // (worth it without its needles)
  const good = g => g.kg - sim.pineFoodAt(g.i, g.j) >= worth;
  let grass = senses.plantsAround(a, deerGrazeLookShare);
  const goingFar = m.grazeTo && !grass.some(g => g.i === m.grazeTo[0] && g.j === m.grazeTo[1]);
  if (goingFar || !grass.some(good)) grass = senses.plantsAround(a);
  const i = Math.floor(a.gx), j = Math.floor(a.gy);
  const seen = (ti, tj) => grass.find(g => g.i === ti && g.j === tj);
  // cropping the grass under a boulder beside it, until bare
  const c = m.cropping;
  if (c && sim.isBlockedTile(c[0], c[1]) && sim.inGrassReach(a, c[0], c[1]) && seen(c[0], c[1])?.kg > 0) {
    m.grazeTo = null;
    return { gait: "eat", at: c };
  }
  const needlesOnly = !grass.some(good);
  const here = seen(i, j);
  const onIt = c && c[0] === i && c[1] === j;
  if (here && (good(here) || onIt || needlesOnly && here.kg >= worth)) { m.grazeTo = null; m.cropping = [i, j]; return EAT; }
  m.cropping = null;
  let at = m.grazeTo && grass.find(g => g.i === m.grazeTo[0] && g.j === m.grazeTo[1] && g.kg >= worth);
  if (at && sim.inGrassReach(a, at.i, at.j)) { // grass under a boulder it is beside
    m.grazeTo = null; m.cropping = [at.i, at.j];
    return { gait: "eat", at: m.cropping };
  }
  if (at) {
    // no nearer after grazeGiveUpS: it can't get there (a cliff, water in the way)
    const d2 = (at.i + 0.5 - a.gx) ** 2 + (at.j + 0.5 - a.gy) ** 2;
    if (d2 < m.grazeBestD2 - 0.25) { m.grazeBestD2 = d2; m.grazeSince = now; }
    // (or it knows no way there)
    if (now - m.grazeSince > ticks(grazeGiveUpS) || (m.path && m.path.failed)) {
      m.grazeAvoid.set(at.i * 100000 + at.j, now + ticks(grazeAvoidS));
      at = null;
    }
  }
  // (not where another critter stands)
  const taken = new Set();
  for (const k of m.known.values()) if (k.alive && k.seenTick === now) taken.add(Math.floor(k.gx) * 100000 + Math.floor(k.gy));
  if (at && taken.has(at.i * 100000 + at.j)) at = null;
  if (!at) {
    for (const [key, until] of m.grazeAvoid) if (until <= now) m.grazeAvoid.delete(key);
    // the best it can see (in line of sight: checked for the best few, nearest first)
    const options = [];
    for (const g of grass) {
      // (not where it couldn't get to, nor where another stands)
      if (g.kg < worth || !needlesOnly && !good(g) || m.grazeAvoid.has(g.i * 100000 + g.j) || taken.has(g.i * 100000 + g.j)) continue;
      const d2 = (g.i + 0.5 - a.gx) ** 2 + (g.j + 0.5 - a.gy) ** 2;
      options.push({ g, score: d2 + (g.kg >= sim.plantMostAt(g.i, g.j) / 2 ? 0 : 1e6) });
    }
    options.sort((p, q) => p.score - q.score);
    const best = options.slice(0, grazeLosChecks).find(o => senses.canSeeTile(a, o.g.i, o.g.j));
    // (hungry, seeing only grass grazed down, it goes looking for better: FORAGING; but
    // seeing only needles, it browses them)
    if (a.food < deerForageBelow && !(best && (best.score < 1e6 || needlesOnly))) {
      // (having looked about a while first)
      if (m.forageFrom === undefined || m.forageFrom === null) m.forageFrom = now + ticks(forageLookS);
      if (now >= m.forageFrom) { m.grazeTo = null; m.foraging = true; return prowl(a, m, now); }
    } else m.forageFrom = null;
    if (!best) { m.grazeTo = null; return null; }
    m.grazeTo = [best.g.i, best.g.j];
    m.grazeSince = now; m.grazeBestD2 = Infinity;
  }
  const [gi, gj] = m.grazeTo;
  if (!sim.isBlockedTile(gi, gj)) return goTo(a, m, gi + 0.5, gj + 0.5, "walk", now);
  if (sim.inGrassReach(a, gi, gj)) { m.grazeTo = null; m.cropping = [gi, gj]; return { gait: "eat", at: m.cropping }; }
  // under a boulder: it goes to the open tile beside the boulder nearest it
  let via = null, viaD2 = Infinity;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const vi = gi + di, vj = gj + dj;
    if (sim.isBlockedTile(vi, vj) || !sim.isLandTile(vi, vj)) continue;
    const d2 = (vi + 0.5 - a.gx) ** 2 + (vj + 0.5 - a.gy) ** 2;
    if (d2 < viaD2) { via = [vi, vj]; viaD2 = d2; }
  }
  if (!via) { m.grazeAvoid.set(gi * 100000 + gj, now + ticks(grazeAvoidS)); m.grazeTo = null; return null; }
  return goTo(a, m, via[0] + 0.5, via[1] + 0.5, "walk", now);
}

// THIRST: from when its water meter falls below drinkBelow (seekBelow, knowing of no fresh
// water) until drinkFullAt, a critter old enough to eat drinks: with fresh water in its
// reach, it stands and drinks (EAT); water it tastes salt (the sea) marks every shore it
// remembers within saltNearTiles as the sea's. Otherwise it trots to the nearest shore it remembers that isn't the sea's;
// one it gets no nearer to in drinkGiveUpS, or reaches with no water in reach (a high
// bank), it leaves be for drinkAvoidS. Knowing of none, it searches (search). Swimming,
// it drinks the water it swims in if fresh (it tastes it), and else leaves its thirst
// for later.
// SHORES IT HAS SEEN (m.waters, noteShores): every waterLookS, of the shores in sight
// (senses.shoresAround), the nearest in each waterCellTiles square in line of sight (as
// the sight view rounds terrain: where a deer standing on it would be seen, since a bank's
// brink hides the water's edge from afar); the watersKept nearest kept. Sight doesn't tell
// the sea from a lake: taste does.
// An intent, or null if not thirsty or with nothing to do about it.
const cellKey = (i, j) => Math.floor(i / waterCellTiles) * 100000 + Math.floor(j / waterCellTiles);

function noteShores(a, m, now) {
  if (now - m.waterLook < ticks(waterLookS) || !sim.can(a, "see")) return;
  m.waterLook = now;
  const byCell = new Map();
  for (const s of senses.shoresAround(a)) {
    const key = cellKey(s.i, s.j);
    s.d2 = (s.i + 0.5 - a.gx) ** 2 + (s.j + 0.5 - a.gy) ** 2;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(s);
  }
  const deerEye = senses.eyeLevelsBySpecies.deer;
  for (const [key, shores] of byCell) {
    const s = shores.sort((p, q) => p.d2 - q.d2).slice(0, shoreLosChecks)
      .find(s => senses.canSeePoint(a, s.i + 0.5, s.j + 0.5, sim.heightAt(s.i + 0.5, s.j + 0.5) + deerEye));
    if (s) m.waters.set(key, { i: s.i, j: s.j, salt: m.saltCells.has(key) });
  }
  if (m.waters.size > watersKept) {
    const far = [...m.waters].map(([key, s]) => [key, (s.i - a.gx) ** 2 + (s.j - a.gy) ** 2]).sort((p, q) => q[1] - p[1]);
    for (let k = 0; k < m.waters.size - watersKept; k++) m.waters.delete(far[k][0]);
  }
}

function markSalt(m, i, j) {
  const r = Math.ceil(saltNearTiles / waterCellTiles);
  const ci = Math.floor(i / waterCellTiles), cj = Math.floor(j / waterCellTiles);
  for (let a = ci - r; a <= ci + r; a++) for (let b = cj - r; b <= cj + r; b++) {
    const key = a * 100000 + b;
    m.saltCells.add(key);
    const s = m.waters.get(key);
    if (s) s.salt = true;
  }
}

function thirst(a, m, now) {
  if (!sim.can(a, "eat")) return null;
  if (m.drinking && a.water >= drinkFullAt) { m.drinking = false; m.waterTo = null; m.search = m.lookFrom = null; }
  if (!m.drinking && (a.water < drinkBelow || a.water < seekBelow && ![...m.waters.values()].some(s => !s.salt)))
    m.drinking = true;
  if (!m.drinking) return null;
  const w = sim.waterInReach(a);
  if (w && w.kind !== "sea") { m.mode = "drink"; m.plan = null; m.waterTo = null; return EAT; }
  if (w) markSalt(m, w.i, w.j);
  if (a.pose === "swim") return null;
  let to = m.waterTo !== null ? m.waters.get(m.waterTo) : null;
  if (to && !to.salt) {
    const d2 = (to.i + 0.5 - a.gx) ** 2 + (to.j + 0.5 - a.gy) ** 2;
    if (d2 < m.waterBestD2 - 0.25) { m.waterBestD2 = d2; m.waterSince = now; }
    // (there, with no water in reach: a high bank)
    if (now - m.waterSince > ticks(drinkGiveUpS) || d2 < 0.1) {
      m.waterAvoid.set(m.waterTo, now + ticks(drinkAvoidS));
      to = null;
    }
  } else to = null;
  if (!to) {
    for (const [key, until] of m.waterAvoid) if (until <= now) m.waterAvoid.delete(key);
    let bestD2 = Infinity;
    m.waterTo = null;
    for (const [key, s] of m.waters) {
      if (s.salt || m.waterAvoid.has(key)) continue;
      const d2 = (s.i + 0.5 - a.gx) ** 2 + (s.j + 0.5 - a.gy) ** 2;
      if (d2 < bestD2) { bestD2 = d2; m.waterTo = key; to = s; }
    }
    m.waterSince = now; m.waterBestD2 = Infinity;
  }
  m.mode = "drink"; m.plan = null;
  if (to) { m.search = m.lookFrom = null; return goTo(a, m, to.i + 0.5, to.j + 0.5, "trot", now, { dry: true }); }
  return search(a, m, now);
}

// Knowing of no water, it searches: for searchLegS at a time it trots one of the 8 ways:
// near where it began to look (m.lookFrom; within searchNearTiles), any; farther, one of
// the 3 nearest the way away from there; beyond searchFarTiles, back toward it. So it
// ranges out and back around where it began, a different way each time. A way it is
// blocked in it changes at once.
function search(a, m, now) {
  if (!m.lookFrom) m.lookFrom = [a.gx, a.gy];
  if (m.search && a.blockedTick > m.lastTurn) m.search.until = now;
  if (!m.search || m.search.until <= now) {
    const ox = a.gx - m.lookFrom[0], oy = a.gy - m.lookFrom[1], d2 = ox * ox + oy * oy;
    const out = sim.getDir(ox, oy, 0), turn = Math.floor(Math.random() * 3) - 1;
    const dir = d2 < searchNearTiles * searchNearTiles ? Math.floor(Math.random() * 8)
      : (out + (d2 > searchFarTiles * searchFarTiles ? 4 : 0) + 8 + turn) % 8;
    const [dx, dy] = sim.moveVecByDir[dir];
    m.search = { dx, dy, until: now + ticks(searchLegS) };
  }
  return head(a, m, m.search.dx, m.search.dy, "trot", now, { dry: true });
}

// WOLVES eat first: from below wolfFeedBelow (with its stomach below wolfFeedGutBelow)
// until full (or its stomach is), and once old enough to eat, the nearest carcass with
// meat (near it, with others in its way and no way round them, or blocked, it waits its
// turn: feedWaitS) it knows of (perceived within carcassKeepS: it comes back to its kills),
// but one it knew no way to lately (outOfReachS); knowing of none, it follows death scent
// (TRACKING).
// Otherwise they hunt while hungry (below wolfHuntBelow, with its stomach below
// wolfHuntGutBelow), once old enough to hunt (sim: "hunt"); till then the young stay with
// their family and eat what it kills and brings them (SUPPORT FEEDING). Fed, with nothing
// else to do, a wolf STAYS BY ITS KILL: near the nearest carcass with meat it knows of
// (within stayByKillTiles), so it comes back to it rather than kill again, but out of the
// way of those eating it (no nearer than stayOffKillTiles: it walks off from nearer), and
// not in the water; one rearing young keeps to home instead, and a grown one unpaired
// roams to meet others (calm).
// FAMISHED: hungrier than wolfFamishedHungerAbove (hunger: 1 - its food meter) with its
// stomach below wolfFamishedGutBelow, a weaned wolf eats or else (if it hunts) hunts before
// anything else (drinking, family, mating).
// HUNTING: of the deer it knows, a wolf picks the nearest, or among those about as near,
// the one most straight ahead; then keeps to it for wolfCommitS (unless a deer in sight
// is much nearer) and after that changes only for one clearly nearer. Seeing or hearing
// its prey now, it goes straight for it; otherwise it follows its prey's own trail
// (TRACKING), keeping to that prey while it smells its trail, however long since it last
// perceived it; and with none, goes for where its prey should be by now, then on the way
// it went, searching. A deer searched for and not found is lost until seen again. With no
// deer in mind, it follows the freshest deer trail about; smelling none, it PROWLS (but a
// mother with infants stays by them).
// PACE after prey (pace): it runs prey down, galloping, once it perceives it within
// wolfRushTiles, or fleeing it (perceived within wolfPursueS, moving at wolfFleeingShare
// of a deer's trot or faster); and keeps at it, in or out of sight and hearing, until it
// hasn't perceived that deer for wolfPursueS. At prey farther off, unaware of it, it STALKS
// (all but silent: see MOVING in sim.js; keeping its wind for the rush). Along a trail
// fresher than wolfStalkTrailS (the deer is near) it stalks likewise, if the deer laid it
// slower than a wolf stalks (from the marks underfoot and ahead: so stalking gains on it);
// along an older one, or a deer's going faster (fleeing it, say, unseen), it strides:
// gallops from wolfStrideWindFrom of its wind down to wolfStrideWindTo, then walks (getting
// its wind back three times as fast as trotting) until it has wolfStrideWindFrom again, so
// it closes on a far-off deer fast but comes up with wind enough to run it down (a deer's
// gallop is faster but lasts a quarter as long: see EXERTION in sim.js). It gallops only
// while its wind lasts.
function decideWolf(a, m, now) {
  m.bark = null;
  const intent = wolfChoice(a, m, now);
  if (!m.bark) callKin(a, m, now);
  if (!m.bark) leadKin(a, m, now);
  return m.bark && intent ? { ...intent, bark: m.bark } : intent; // (a soft bark along with it: BARKING in sim.js)
}

function wolfChoice(a, m, now) {
  // howling: on to the howl's end (HOWLING in sim.js)
  if (a.pose === "howl" && sim.tickCount < a.howlUntil) return { gait: "howl" };
  // an infant suckles rather than goes to a carcass
  const suckling = sim.isInfant(a) && nurseOrSuckle(a, m, now);
  if (suckling) return suckling;
  chooseDen(a, m, now);
  const famished = !sim.isInfant(a) && 1 - a.food > wolfFamishedHungerAbove && a.gut < wolfFamishedGutBelow;
  // a leg in its mouth: eaten if famished, else taken home (SUPPORT FEEDING)
  if (a.carrying) {
    if (famished) { m.mode = "feed"; return EAT; }
    const home = carryHome(a, m, now);
    if (home) return home;
  }
  // FAMISHED: eating, then hunting, before all else (but see FAMILY ROLES); one too young
  // to hunt only eats
  if (famished) {
    const eating = forFood(a, m, now, feed(a, m, now, true)) || followLead(a, m, now)
      || (sim.can(a, "hunt") && (stayWithYoung(a, m, now) || goingHunting(a, m, now) || hunt(a, m, now)));
    if (eating) return eating;
  }
  // a mother long away from her litter, or hearing it whimper, goes back first (BROODING)
  const back = backToLitter(a, m, now);
  if (back) { m.target = null; m.searching = false; m.watch = null; return back; }
  const drinking = thirst(a, m, now);
  if (drinking) { m.target = null; m.searching = false; m.watch = null; return drinking; }
  const eating = forFood(a, m, now, feed(a, m, now, false));
  if (eating) { if (eating === EAT) m.fedSince = true; return eating; }
  const taking = takeLegHome(a, m, now) || fetchLeg(a, m, now);
  if (taking) return taking;
  const following = followLead(a, m, now);
  if (following) { m.target = null; m.searching = false; m.watch = null; return following; }
  const nursing = nurseOrSuckle(a, m, now);
  if (nursing) { m.target = null; m.searching = false; m.watch = null; return nursing; }
  const romance = a.food > romanceAbove && social(a, m, now, true);
  if (romance) { m.target = null; m.searching = false; m.watch = null; return romance; }
  if (a.food >= wolfHuntBelow || a.gut >= wolfHuntGutBelow || !sim.can(a, "hunt")) {
    m.target = null; m.searching = false; m.watch = null;
    return backHome(a, m, now) || settle(a, m, now);
  }
  // FAMILY ROLES: staying with its young while its mate hunts; else telling it it is going
  const staying = stayWithYoung(a, m, now) || goingHunting(a, m, now);
  if (staying) return staying;
  // (a mother with infants stays by them rather than prowl)
  const mothering = !a.isMale && a.youngUids.some(uid => m.known.get(uid)?.infant);
  return hunt(a, m, now) || (mothering ? settle(a, m, now) : prowl(a, m, now));
}

// CALLS: a grown wolf, but while hunting, calls ("come": BARKS) young that could come to it
// (that walk, not grown), or its mate (neither of them off hunting), that it has lost or not
// perceived in callAfterS. (It only marks the bark, m.bark, to go along with what it does.)
const huntingModes = new Set(["chase", "wait", "track", "prowl", "ashore"]);
function callKin(a, m, now) {
  if (!sim.isGrown(a) || huntingModes.has(m.mode)) return;
  const missing = k => k && k.alive && (k.lost || now - k.seenTick > ticks(callAfterS));
  const mk = a.mateUid !== null && m.known.get(a.mateUid);
  if (a.youngUids.some(uid => { const k = m.known.get(uid); return k && k.walks === true && k.grown !== true && missing(k); })
    || mk && missing(mk) && mk.signal?.kind !== "hunt" && a.role?.kind !== "hunt") m.bark = "come";
}

// LEADING: a grown wolf on its way to a carcass with meat it knows (to eat, to fetch a leg,
// or to stay by its kill), farther than followTiles off, with kin about that walk (not
// infants, and not off hunting), barks "follow" (BARKS; barkAgainS apart, while it goes).
// (It only marks the bark, m.bark.)
const leadModes = new Set(["feed", "provide", "kill"]);
function leadKin(a, m, now) {
  if (!sim.isGrown(a) || !leadModes.has(m.mode)) return;
  let near2 = Infinity;
  for (const k of m.known.values()) if (!k.alive && k.species === "deer" && k.meat > 0)
    near2 = Math.min(near2, (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2);
  if (near2 <= followTiles * followTiles || near2 === Infinity) return;
  for (const [uid, k] of m.known) {
    if (!k.alive || k.seenTick !== now || k.species !== "wolf" || k.infant || k.walks === false) continue;
    if (!(isKin(a, uid) || k.sibling) || k.signal?.kind === "hunt") continue;
    m.bark = "follow"; return;
  }
}

// FOLLOWING: a wolf that heard kin bark "follow" within followHeedS (the latest of them)
// follows it, keeping within followTiles (trotting while 2 tiles beyond, else walking:
// mode "follow"), unless it's an infant, has infants of its own (it stays by them), or is
// grown and not hungry (food at wolfFeedBelow or more). Going with it, it comes on what it
// was led to (and eats: feed). An intent, or null.
function followLead(a, m, now) {
  if (sim.isInfant(a) || sim.isGrown(a) && a.food >= wolfFeedBelow) return null;
  if (a.youngUids.some(uid => { const k = m.known.get(uid); return k && k.alive && k.infant; })) return null;
  let lead = null, leadUid = null;
  for (const [uid, k] of m.known) {
    if (!k.alive || k.lost || !k.follow || now - k.follow.tick > ticks(followHeedS)) continue;
    if (!(isKin(a, uid) || k.sibling) || lead && lead.follow.tick >= k.follow.tick) continue;
    lead = k; leadUid = uid;
  }
  if (!lead) return null;
  m.mode = "follow";
  const [x, y] = expectedAt(lead, now), d2 = (x - a.gx) ** 2 + (y - a.gy) ** 2;
  if (d2 <= followTiles * followTiles) return IDLE;
  const go = goTo(a, m, x, y, d2 > (followTiles + 2) ** 2 ? "trot" : "walk", now, { through: leadUid });
  return go && !(m.path && m.path.failed) ? go : null;
}

// FAMILY ROLES: a paired wolf rearing young (rearing: with a den, or young of its own
// still dependent, too young to hunt, as far as it knows, alive: dependants) shares the
// work with its mate: one hunts, the other stays with the young (or at the den). Going off to hunt, it barks "hunt" (BARKING in sim.js) unless that was the last
// thing it barked; back home (within homeTiles of its young, or the den), done hunting,
// it barks "stay". While the last it heard or saw its mate bark was "hunt", it stays
// with the young (within guardTiles of them, or the den: mode "guard"), however hungry,
// until famished below guardStarveBelow.
function dependants(a, m) {
  const out = [];
  for (const uid of a.youngUids) {
    const k = m.known.get(uid);
    if (k && k.alive && k.dependent !== false) out.push(k);
  }
  return out;
}

// Whether it is rearing young, as far as it knows: it has a den (DENS: one gives it up
// once done), or young of its own dependent.
function rearing(a, m) { return !!m.den || dependants(a, m).length > 0; }

// Where its young are, as near as it knows (the nearest of them), else its den: [gx, gy], or null.
function homeOf(a, m) {
  let best = null, bestD2 = Infinity;
  for (const k of dependants(a, m)) {
    if (k.lost) continue;
    const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
    if (d2 < bestD2) { best = [k.gx, k.gy]; bestD2 = d2; }
  }
  return best || m.den;
}

function stayWithYoung(a, m, now) {
  if (a.mateUid === null || !rearing(a, m) || a.food < guardStarveBelow) return null;
  const mk = m.known.get(a.mateUid);
  if (!(mk && mk.signal && mk.signal.kind === "hunt")) return null;
  const home = homeOf(a, m);
  if (!home) return null;
  m.mode = "guard"; m.target = null; m.searching = false; m.watch = null;
  if (!a.isMale) { const s = social(a, m, now); if (s && m.mode === "brood") return s; m.mode = "guard"; }
  const d2 = (home[0] - a.gx) ** 2 + (home[1] - a.gy) ** 2;
  if (d2 <= guardTiles * guardTiles) return IDLE;
  const go = goTo(a, m, home[0], home[1], "trot", now, { through: a.youngUids });
  return go && !(m.path && m.path.failed) ? go : IDLE;
}

// Going for food it knows of (intent go: to the carcass at m.feedAt), as FAMILY ROLES
// would have it: a parent with dependants going beyond homeTiles of home stays with them
// while its mate is away hunting, and tells it it is going.
function forFood(a, m, now, go) {
  if (!go || go === EAT || !go.gait || a.mateUid === null || !rearing(a, m)) return go;
  const home = homeOf(a, m), f = m.feedAt;
  if (!home || !f || (f[0] - home[0]) ** 2 + (f[1] - home[1]) ** 2 <= homeTiles * homeTiles) return go;
  return stayWithYoung(a, m, now) || (goingHunting(a, m, now), go);
}

// (These two only mark the bark, m.bark, to go along with what it does: null.)
function goingHunting(a, m, now) {
  if (a.mateUid !== null && rearing(a, m) && a.role?.kind !== "hunt") m.bark = "hunt";
  return null;
}

function backHome(a, m, now) {
  if (a.mateUid === null || a.role?.kind !== "hunt" || !rearing(a, m)) return null;
  const home = homeOf(a, m);
  if (home && (home[0] - a.gx) ** 2 + (home[1] - a.gy) ** 2 <= homeTiles * homeTiles) m.bark = "stay";
  return null;
}

// DENS: a paired female, pregnant or with young, picks a den: of the spots on dry open
// land in sight within denSearchTiles (every denStepTiles) and within denWaterTiles of a
// shore she has seen and not tasted salt (DRINKING), the one most hidden from
// creatures going by (senses.coverAt), the nearest of those as hidden. Her mate learns it
// seeing her at it (within denTiles). Pregnant, she keeps to it (mode "den"), so the
// litter is born there; knowing no such shore, she goes to within denWaterNearTiles of the
// nearest she knows (mode "den"), or else carries on. While she is at it, her mate, at ease, stays by it too (within
// guardTiles: mode "guard"). She gives it up once neither pregnant nor with young
// dependent; he, once he knows their young all dead or no longer dependent.
function chooseDen(a, m, now) {
  if (a.mateUid === null) { m.den = null; return; }
  if (m.den) {
    // done with it: hers with no young dependent and none coming; his, knowing them grown out of it
    if (a.isMale ? doneRearing(a, m) : !a.pregnancy && !dependants(a, m).length) m.den = null;
    return;
  }
  if (a.isMale) {
    const k = m.known.get(a.mateUid);
    if (!k || k.seenTick !== now || k.by !== "sight") return;
    for (const [c, mm] of memories) {
      if (c.uid !== a.mateUid || !mm.den) continue;
      if ((k.gx - mm.den[0]) ** 2 + (k.gy - mm.den[1]) ** 2 <= denTiles * denTiles) m.den = mm.den.slice();
    }
    return;
  }
  if (!a.pregnancy && !dependants(a, m).length) return;
  if (m.denLook !== undefined && now - m.denLook < ticks(5)) return; // (none found: looks again in a while)
  m.denLook = now;
  let best = null, bestCover = -1, bestD2 = Infinity;
  const ci = Math.floor(a.gx), cj = Math.floor(a.gy), r = denSearchTiles;
  const reach = (denWaterTiles + r) ** 2, w2 = denWaterTiles * denWaterTiles;
  const fresh = [...m.waters.values()].filter(s => !s.salt && (s.i + 0.5 - a.gx) ** 2 + (s.j + 0.5 - a.gy) ** 2 <= reach);
  if (!fresh.length) return;
  for (let di = -r; di <= r; di += denStepTiles) for (let dj = -r; dj <= r; dj += denStepTiles) {
    const d2 = di * di + dj * dj;
    if (d2 > r * r) continue;
    const i = ci + di, j = cj + dj;
    if (!sim.isLandTile(i, j) || sim.isBlockedTile(i, j) || !senses.canSeeTile(a, i, j)) continue;
    if (!fresh.some(s => (s.i - i) ** 2 + (s.j - j) ** 2 <= w2)) continue;
    const cover = senses.coverAt(i + 0.5, j + 0.5);
    if (cover > bestCover || (cover === bestCover && d2 < bestD2)) { best = [i + 0.5, j + 0.5]; bestCover = cover; bestD2 = d2; }
  }
  if (best) m.den = best;
}

// SUPPORT FEEDING: fed at a carcass with a leg still on it, a wolf that can carry one
// (sim.canCarry) tears it off to take home: a paired male rearing young (rearing: he
// knows his mate's den, where she bears and rears them, or young of theirs still
// dependent), for her; a mother with young that eat meat, for them. One leg each time it
// has eaten there (m.fedSince). Carrying it, it takes it to her (where it last perceived
// her, or the den) or to the nearest of those young, and puts it down within dropTiles of
// them (sim.js: CARRYING), for them to eat; it leaves be a leg it put down for others
// (m.given) unless famished. Not finding them where it last knew them, it takes the leg
// to the den and puts it down there (m.carryToDen, till then); knowing no way all the way
// to them, where it is. Having put one down, it
// goes back for another (fetchLeg) to a carcass it knows with a leg on it, while there is
// one and someone to take it to.

// Whether a male knows young of his and knows all of them dead or no longer dependent.
function doneRearing(a, m) {
  const ks = a.youngUids.map(uid => m.known.get(uid)).filter(Boolean);
  return ks.length > 0 && ks.every(k => !k.alive || k.dependent === false);
}

function legFor(a, m) {
  if (a.isMale) {
    if (a.mateUid === null || !rearing(a, m)) return null;
    const k = m.known.get(a.mateUid);
    return k && k.alive ? { uid: a.mateUid, k } : null;
  }
  let best = null, bestD2 = Infinity;
  for (const k of dependants(a, m)) {
    if (!k.eats) continue;
    const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
    if (d2 < bestD2) { best = { uid: k.uid, k }; bestD2 = d2; }
  }
  return best;
}

function takeLegHome(a, m, now) {
  if (!m.fedSince || a.carrying || !sim.canCarry(a) || !legFor(a, m)) return null;
  let at = null;
  for (const k of m.known.values()) {
    if (k.alive || k.species !== "deer" || !k.leg || k.seenTick !== now) continue;
    if ((k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2 <= sim.eatReachTiles * sim.eatReachTiles) { at = k; break; }
  }
  if (!at) return null;
  m.mode = "provide"; m.target = null; m.searching = false; m.watch = null;
  return { gait: "take" };
}

// Going back for a leg (SUPPORT FEEDING): an intent, or null.
function fetchLeg(a, m, now) {
  if (a.carrying || !sim.canCarry(a) || !legFor(a, m)) return null;
  let carcass = null, bestD2 = Infinity;
  for (const k of m.known.values()) {
    if (k.species !== "deer" || k.alive || !k.leg || !(k.meat > 0) || now - k.seenTick > ticks(carcassKeepS)) continue;
    if (m.outOfReach.get(k.uid) > now || m.given.has(k.uid)) continue;
    const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
    if (d2 < bestD2) { carcass = k; bestD2 = d2; }
  }
  if (!carcass) return null;
  m.mode = "provide"; m.target = null; m.searching = false; m.watch = null;
  if (bestD2 <= sim.eatReachTiles * sim.eatReachTiles) return carcass.seenTick === now ? { gait: "take" } : null;
  const go = goTo(a, m, carcass.gx, carcass.gy, "trot", now);
  if (m.path && m.path.failed) { m.outOfReach.set(carcass.uid, now + ticks(outOfReachS)); return null; }
  return go;
}

function carryHome(a, m, now) {
  m.fedSince = false;
  const to = legFor(a, m);
  if (!to) return null;
  const k = to.k, d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
  m.mode = "carry"; m.target = null; m.searching = false; m.watch = null;
  if (k.seenTick === now && d2 <= dropTiles * dropTiles) { m.given.add(a.carrying.uid); m.carryToDen = false; return { gait: "drop" }; }
  // not finding them where it last knew them: to the den, and there it puts the leg down
  if (m.den && (k.lost || m.carryToDen)) {
    m.carryToDen = true;
    if ((m.den[0] - a.gx) ** 2 + (m.den[1] - a.gy) ** 2 <= dropTiles * dropTiles) { m.given.add(a.carrying.uid); m.carryToDen = false; return { gait: "drop" }; }
    const go = goTo(a, m, m.den[0], m.den[1], "trot", now, { through: to.uid, dry: "rather" });
    return go && !(m.path && m.path.failed) ? go : null;
  }
  const spot = [k.gx, k.gy];
  if (k.lost) return null;
  if (k.seenTick !== now && (spot[0] - a.gx) ** 2 + (spot[1] - a.gy) ** 2 <= kinLostTiles * kinLostTiles) {
    k.lost = true; return null;
  }
  const go = goTo(a, m, spot[0], spot[1], "trot", now, { through: to.uid, dry: "rather" });
  // knowing no way all the way to them: it puts the leg down where it is
  if (m.path && !m.path.whole && m.path.made === now) { m.given.add(a.carrying.uid); return { gait: "drop" }; }
  return go && !(m.path && m.path.failed) ? go : null;
}

// Going to eat (see WOLVES): to the nearest carcass with meat it knows of, or, knowing of
// none, along the freshest death scent about (track). An intent, or null.
function feed(a, m, now, famished) {
  const feeding = famished || (m.mode === "feed"
    ? a.food < wolfFullAt && !stomachFull(a) : a.food < wolfFeedBelow && a.gut < wolfFeedGutBelow);
  if (!feeding || !sim.can(a, "eat")) return null;
  let carcass = null, bestD2 = Infinity;
  for (const k of m.known.values()) {
    if (k.species !== "deer" || k.alive || !(k.meat > 0) || now - k.seenTick > ticks(carcassKeepS)) continue;
    if (m.outOfReach.get(k.uid) > now || (m.given.has(k.uid) && !famished)) continue; // (not a leg it brought others)
    const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
    if (d2 < bestD2) { carcass = k; bestD2 = d2; }
  }
  if (!carcass) {
    m.feedAt = [Infinity, Infinity]; // (wherever the death scent leads)
    const scent = track(a, m, now, "death", "trot");
    if (scent) { m.target = null; m.searching = false; m.watch = null; }
    return scent;
  }
  // (at it and not perceiving it: it isn't there, carried off, say)
  if (bestD2 <= sim.eatReachTiles * sim.eatReachTiles && carcass.seenTick !== now) {
    for (const [uid, k] of m.known) if (k === carcass) m.known.delete(uid);
    return null;
  }
  m.mode = "feed"; m.target = null; m.searching = false; m.plan = null; m.watch = null;
  m.feedAt = [carcass.gx, carcass.gy];
  if (bestD2 <= sim.eatReachTiles * sim.eatReachTiles) return EAT;
  // crowded out near it (others eating): waits its turn rather than circling
  if (bestD2 <= feedQueueTiles * feedQueueTiles && a.blockedTick > m.lastTurn) m.feedWaitUntil = now + ticks(feedWaitS);
  if (now < (m.feedWaitUntil ?? -Infinity)) return IDLE;
  // near it, with others in the way and no way round them to its side: waits its turn
  if (bestD2 <= feedQueueTiles * feedQueueTiles) {
    const c = wayContext(a, m, now, {});
    if (!wayClear(c, carcass.gx, carcass.gy)) {
      const end = findPath(c, carcass.gx, carcass.gy).at(-1);
      if (!end || (end[0] + 0.5 - carcass.gx) ** 2 + (end[1] + 0.5 - carcass.gy) ** 2 > sim.eatReachTiles * sim.eatReachTiles) return IDLE;
    }
  }
  const go = goTo(a, m, carcass.gx, carcass.gy, "trot", now);
  // knowing no way nearer it (across water, too tired to swim, say): leaves it be a while
  for (const [uid, until] of m.outOfReach) if (until <= now) m.outOfReach.delete(uid);
  if (m.path && m.path.failed) { m.outOfReach.set(carcass.uid, now + ticks(outOfReachS)); return null; }
  return go;
}

// The gait after prey k (null: none in mind), along a deer trail (null: off any): to its
// mark `to`, from the mark `here` underfoot (null: none) (PACE).
function pace(a, m, k, now, to = null, here = null) {
  const p = k && m.pursuit && m.pursuit.uid === k.uid ? m.pursuit : null;
  if (p && k.seenTick === now) p.tick = now; // (still at it)
  if (p && now - p.tick <= ticks(wolfPursueS)) return "gallop";
  if (k && now - k.seenTick <= ticks(wolfPursueS)) {
    const v = wolfFleeingShare * sim.gaitSpeed("deer", "trot");
    const rush = k.seenTick === now && k.by !== "smell" && (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2 <= wolfRushTiles * wolfRushTiles;
    if (rush || k.vx * k.vx + k.vy * k.vy >= v * v) { m.pursuit = { uid: k.uid, tick: now }; return "gallop"; }
    if (k.seenTick === now && k.by !== "smell") { m.striding = false; return "stalk"; }
  }
  if (to && to.ageS < wolfStalkTrailS) {
    // the deer laid it slower than a wolf stalks, so stalking it gains on it
    const dt = here ? (here.ageS - to.ageS) / sim.tempo : 0, v = sim.gaitSpeed("wolf", "stalk");
    if (!here || (to.i - here.i) ** 2 + (to.j - here.j) ** 2 < (v * dt) ** 2) { m.striding = false; return "stalk"; }
  }
  m.striding = a.wind >= (m.striding ? wolfStrideWindTo : wolfStrideWindFrom);
  return m.striding ? "gallop" : "walk";
}

// Hunting (see WOLVES): an intent, or null with no deer in mind and no trail about.
function hunt(a, m, now) {
  let target = m.target !== null ? m.known.get(m.target) : undefined;
  if (target && !target.alive) { m.target = null; target = undefined; }
  const smelt = m.preyTrail && m.preyTrail.uid === m.target ? m.preyTrail.tick : -Infinity;
  if (target && (target.lost || now - Math.max(target.seenTick, smelt) > ticks(wolfForgetPreyS))) target = undefined;

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
  if (!target) {
    m.searching = false;
    return track(a, m, now, "deer", (t, here) => pace(a, m, null, now, t, here));
  }

  m.plan = null;
  if (target.swimming) {
    // waiting for it: once out of sight, it is lost, and the wolf looks for other prey
    if (now - target.seenTick > 0) {
      target.lost = true; m.target = null; m.watch = null;
      return hunt(a, m, now);
    }
    return waitAshore(a, m, target, now);
  }
  m.watch = null;
  const age = now - target.seenTick;
  // seen or heard now, straight at it; else along its trail, if it smells it
  const present = age === 0 && (target.by === "sight" || target.by === "hearing");
  if (!present) {
    const uid = m.target;
    const trail = track(a, m, now, "deer", (t, here) => pace(a, m, target, now, t, here), t => t.uid === uid, m.trailEnds);
    if (trail) { m.searching = false; m.preyTrail = { uid, tick: now }; return trail; }
  }
  const gait = pace(a, m, target, now);
  m.mode = "chase";
  if (age === 0) m.searching = false;
  const [tx, ty] = expectedAt(target, now);
  let dx = tx - a.gx, dy = ty - a.gy;
  if (age > 0 && dx * dx + dy * dy < 4) m.searching = true;
  if (m.searching) {
    if (target.vx === 0 && target.vy === 0) { // it was standing still, and isn't here
      target.lost = true; m.target = null; m.searching = false; return track(a, m, now, "deer", gait) || prowl(a, m, now);
    }
    return head(a, m, target.vx, target.vy, gait, now, { through: m.target });
  }
  return goTo(a, m, tx, ty, gait, now, { through: m.target });
}

// PROWLING: a hungry wolf that knows of no deer and smells no trail doesn't idle about
// (nor keep to its family): it goes looking, covering ground it hasn't been over lately.
// (Prowling is searching for prey, at a trot or walk; stalking, the quiet gait it closes
// on prey in: see PACE.)
// It goes in legs of prowlLegTiles (or prowlLegS at most), each one of 16 ways: the way
// over the ground it has spent least time on lately (m.visits: see TRAPPED, at
// prowlLookTiles along it), not back the way it came (more than 90 degrees from its last
// leg), and of ways as good, the straightest on. It trots while it has the stamina for a
// long search (above prowlTrotStamina; else walks), keeping dry where it can. Knowing no
// way at all the way it goes, it picks another. A wolf with a home (its den, or young
// dependent: homeOf) keeps its prowling to its range: a leg that would end beyond
// prowlHomeTiles of home and farther from it than it is only if there is no other, and
// one back the way it came only if there is no other way on.
const prowlLegTiles = 60, prowlLegS = 60, prowlLookTiles = [15, 30, 45, 60], prowlTrotStamina = 0.3;
const prowlHomeTiles = 400; // estimate (gamified: real territories are tens of km across)
// FORAGING: a hungry deer that sees no grass worth walking to goes looking likewise (mode
// "forage"), at a walk, keeping dry.
function prowl(a, m, now) {
  const deer = a.species === "deer";
  let p = m.prowl;
  if (!p || (p.x - a.gx) ** 2 + (p.y - a.gy) ** 2 >= prowlLegTiles * prowlLegTiles || now > p.until) {
    const [px, py] = p ? [p.dx, p.dy] : [a.hx || 1, a.hy || 0];
    const home = deer ? null : homeOf(a, m), r2 = prowlHomeTiles * prowlHomeTiles;
    const d2 = home ? (a.gx - home[0]) ** 2 + (a.gy - home[1]) ** 2 : 0;
    let best = null, bestTier = Infinity, bestV = Infinity;
    for (const [ux, uy] of escapeWays) {
      const along = ux * px + uy * py;
      // (ways out of its range last, then ways back, then the rest)
      let tier = 0;
      if (home) {
        const e2 = (a.gx + ux * prowlLegTiles - home[0]) ** 2 + (a.gy + uy * prowlLegTiles - home[1]) ** 2;
        if (e2 > r2 && e2 > d2) tier = 2;
      }
      if (p && along < 0) { if (!home) continue; tier = Math.max(tier, 1); }
      let v = 0;
      for (const d of prowlLookTiles) v += visitsAt(m, a.gx + ux * d, a.gy + uy * d);
      v += (1 - along) * 0.5 + Math.random() * 0.1; // (straight on, of ways as good)
      if (tier < bestTier || tier === bestTier && v < bestV) { bestTier = tier; bestV = v; best = [ux, uy]; }
    }
    m.prowl = p = { dx: best[0], dy: best[1], x: a.gx, y: a.gy, until: now + ticks(prowlLegS) };
  }
  m.mode = deer ? "forage" : "prowl"; m.plan = null;
  const go = head(a, m, p.dx, p.dy, !deer && a.stamina > prowlTrotStamina ? "trot" : "walk", now, { dry: deer ? true : "rather" });
  if (go === IDLE) m.prowl = null;
  return go;
}

// TRACKING: a hunting wolf follows deer trails (senses.trailsAround) whenever it has no
// deer in sight or hearing; a wolf going to eat, knowing of no carcass, follows death
// scent (see DEATH SCENT in sim.js) the same way: it goes to the freshest scent about that
// is fresher than the scent underfoot, so along a trail it goes the way the deer went (and
// up death scent, to the carcass), never back; a mark it set off for it keeps in mind until
// there (or a fresher one turns up), though out of its sniffing patch (so it doesn't turn
// back and forth as marks come and go at the patch's edge). Where a trail ends (nothing
// fresher about: the deer was killed there, say, or went into the water; the carcass is
// gone), it gives up that one (by its maker: m.trailEnds, m.deathEnds) as far as that end,
// and looks for another, and likewise one it knows no way nearer to; death scent of a
// carcass it knows is bare, or that smells bare (laid when it had no meat), it leaves be. Deer trails it follows at its PACE (gait: a
// function of the mark it goes to and the one underfoot; see HUNTING), death scent at a
// trot. null if it smells none worth following. (Also for its prey's trail, keeping dry,
// or a prospective mate's, rather dry: those `suits` accepts; see hunt, social.)
function track(a, m, now, species = "deer", gait = "trot", suits = null, ends = species === "deer" ? m.trailEnds : m.deathEnds) {
  const i = Math.floor(a.gx), j = Math.floor(a.gy), t0 = sim.now;
  for (const [uid, at] of ends) if (t0 - at > trailEndKeepS) ends.delete(uid);
  const bare = uid => { const k = m.known.get(uid); return k && !k.alive && k.meat === 0; };
  const worth = t => !(t0 - t.ageS <= (ends.get(t.uid) ?? -Infinity)) && !(species === "death" && (bare(t.uid) || t.meaty === false)) && (!suits || suits(t));
  const trails = senses.trailsAround(a, species).filter(worth);
  const here = trails.find(t => t.i === i && t.j === j);
  let best = null;
  for (const t of trails) {
    if (t === here || (here && t.ageS >= here.ageS)) continue;
    if (!best || t.ageS < best.ageS) best = t;
  }
  // the mark it was going to at its last turn, kept in mind once out of its sniffing patch
  const r = m.trackMark;
  if (r && r.species === species && now - r.tick <= 2 * turnTicks && !(r.t.i === i && r.t.j === j)) {
    const t = { ...r.t, ageS: t0 - r.laid };
    if (worth(t) && (!here || t.ageS < here.ageS) && (!best || t.ageS < best.ageS)) best = t;
  }
  if (!best) {
    m.trackMark = null;
    if (here) ends.set(here.uid, t0 - here.ageS); // a dead end
    return null;
  }
  m.trackMark = { species, t: best, laid: t0 - best.ageS, tick: now };
  m.mode = "track"; m.plan = null;
  const dry = suits ? (species === "deer" && a.species === "wolf" ? true : "rather") : false; // (a wolf won't follow prey into the water)
  const go = goTo(a, m, best.i + 0.5, best.j + 0.5, typeof gait === "function" ? gait(best, here) : gait, now, { dry });
  if (m.path && m.path.failed) { ends.set(best.uid, t0 - best.ageS); return null; } // no way nearer it knows of
  return go;
}

// A wolf doesn't follow prey k into the water (nor can it kill it there): it trots,
// keeping dry, to where k seems to be swimming to (landingAhead), or failing that the
// land nearest k, no farther from k than the wolf is; and waits there, while k stays in
// sight. It keeps to a spot at least waitCommitS, so it doesn't run to and fro as k turns.
// Its spot for a swimmer whose way is unchanged it keeps when it can no longer see the
// shore ahead (turned away, going there).
function waitAshore(a, m, k, now) {
  m.mode = "wait"; m.searching = false;
  const ki = Math.floor(k.gx), kj = Math.floor(k.gy);
  const way = k.vx || k.vy ? sim.getDir(k.vx, k.vy, 0) : -1;
  // a new spot when its prey has moved on, but not more often than every waitCommitS
  if (!m.watch || ((m.watch.i !== ki || m.watch.j !== kj || m.watch.way !== way) && now - m.watch.since > ticks(waitCommitS))) {
    let spot = way >= 0 ? landingAhead(a, k) : null;
    // (its way unchanged and the shore ahead out of sight now: the spot it had for it)
    if (!spot && m.watch && way >= 0 && m.watch.way === way) spot = m.watch.spot;
    if (!spot) {
      const reach = Math.ceil(Math.max(Math.abs(a.gx - k.gx), Math.abs(a.gy - k.gy))) + 1;
      const land = findNearestLand(a, k.gx, k.gy, reach);
      spot = land ? [land.tile[0] + 0.5, land.tile[1] + 0.5] : a.pose === "swim" ? null : [a.gx, a.gy];
    }
    m.watch = spot && { i: ki, j: kj, way, spot, since: now };
  }
  // in the water itself, with no land to wait on in sight: it makes for land, or swims on
  if (!m.watch) return calm(a, m, now);
  const dx = m.watch.spot[0] - a.gx, dy = m.watch.spot[1] - a.gy;
  if (dx * dx + dy * dy < shoreWaitTiles * shoreWaitTiles) return IDLE;
  return goTo(a, m, m.watch.spot[0], m.watch.spot[1], "trot", now, { dry: true });
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
    if (!senses.canSeeTile(a, i, j)) return null;
    if (sim.isLandTile(i, j)) return [i + 0.5, j + 0.5];
    if (sim.getTerrainAt(i, j) !== "water") return null;
  }
  return null;
}

// With nothing more pressing: mates and family, else wander.
// NURSING: a mother that feels young suckling from her (by touch) stands still, carrying
// on eating if she was. An infant suckles from when its meter falls below suckleBelow
// (with its stomach below suckleGutBelow) until suckleFullAt (or its stomach is full):
// goes to its mother where it knows her to be (trotting while 3 tiles off; one too
// young to walk, only while it perceives her: PUPS STAY PUT; a wolf not perceiving her
// whimpers) and, touching her (box within suckleTouchTiles of hers) and perceiving her
// now, eats, which the simulation makes suckling. Getting no milk for suckleGraceS (she has none to spare, say),
// it leaves off for suckleRetryS. An intent, or null.
function nurseOrSuckle(a, m, now) {
  if (!a.isMale && a.youngUids.some(uid => { const k = m.known.get(uid); return k && k.nursingOnMe && k.seenTick === now; })) {
    m.mode = "nurse"; m.plan = null;
    return m.intent === EAT ? EAT : IDLE;
  }
  if (!sim.isInfant(a) || a.pose === "swim") { m.suckle = null; return null; }
  const s = m.suckle;
  const full = a.food >= suckleFullAt || stomachFull(a);
  if (s && (full || s.retry > now)) { if (full) m.suckle = null; return null; }
  if (!s && (a.food >= suckleBelow || a.gut >= suckleGutBelow)) return null;
  if (!s) m.suckle = { since: null, retry: -Infinity };
  const k = a.parentUids.length ? m.known.get(a.parentUids[0]) : undefined;
  // (hungry, not perceiving her now, it whimpers: BARKS)
  if (a.species === "wolf" && (!k || k.seenTick !== now)) m.bark = "whimper";
  if (!k || !k.alive || k.lost || k.swimming) { m.suckle.since = null; return null; }
  const dx = k.gx - a.gx, dy = k.gy - a.gy, d2 = dx * dx + dy * dy;
  const reach = a.boxRad + sim.adultBoxRad + suckleTouchTiles;
  if (k.seenTick === now && Math.abs(dx) <= reach && Math.abs(dy) <= reach) {
    if (a.nursingOn !== null) m.suckle.since = null;
    else if (m.suckle.since === null) m.suckle.since = now;
    else if (now - m.suckle.since > ticks(suckleGraceS)) {
      m.suckle = { since: null, retry: now + ticks(suckleRetryS) };
      return null;
    }
    m.mode = "nurse"; m.plan = null;
    return EAT;
  }
  m.suckle.since = null;
  if (k.seenTick !== now && !sim.can(a, "walk")) return null; // (PUPS STAY PUT)
  if (k.seenTick !== now && d2 <= kinLostTiles * kinLostTiles) { k.lost = true; return null; }
  m.mode = "nurse"; m.plan = null;
  return goTo(a, m, k.gx, k.gy, d2 > 9 ? "trot" : "walk", now, { through: a.parentUids[0] });
}

function settle(a, m, now) {
  // a pregnant female keeps to her den (DENS)
  if (a.species === "wolf" && a.pregnancy && m.den) {
    m.mode = "den";
    if ((m.den[0] - a.gx) ** 2 + (m.den[1] - a.gy) ** 2 <= denTiles * denTiles) return IDLE;
    const go = goTo(a, m, m.den[0], m.den[1], "walk", now, { dry: "rather" });
    if (go && !(m.path && m.path.failed)) return go;
  }
  if (a.species === "wolf" && a.pregnancy && !m.den && a.mateUid !== null) {
    let to = null, toD2 = denWaterNearTiles * denWaterNearTiles;
    for (const s of m.waters.values()) {
      const d2 = (s.i + 0.5 - a.gx) ** 2 + (s.j + 0.5 - a.gy) ** 2;
      if (!s.salt && d2 <= toD2) { to = null; break; }
      if (!s.salt && (!to || d2 < to.d2)) to = { s, d2 };
    }
    if (to) {
      m.mode = "den";
      const go = goTo(a, m, to.s.i + 0.5, to.s.j + 0.5, "walk", now, { dry: "rather" });
      if (go && !(m.path && m.path.failed)) return go;
    }
  }
  const s = social(a, m, now);
  if (s) return s;
  const kill = a.species === "wolf" && stayByKill(a, m, now);
  if (kill) return kill;
  m.mode = "calm";
  if (!sim.can(a, "walk")) return IDLE; // (a newborn lies still by its mother)
  return calm(a, m, now);
}

// STAYS BY ITS KILL (see WOLVES): an intent, or null knowing of no carcass with meat.
function stayByKill(a, m, now) {
  if (rearing(a, m) || a.mateUid === null && sim.isGrown(a)) return null; // (home instead; or, unpaired, off to meet others: calm)
  let carcass = null, bestD2 = Infinity;
  for (const k of m.known.values()) {
    if (k.species !== "deer" || k.alive || !(k.meat > 0) || now - k.seenTick > ticks(carcassKeepS)) continue;
    if (m.outOfReach.get(k.uid) > now || m.given.has(k.uid)) continue;
    const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
    if (d2 < bestD2) { carcass = k; bestD2 = d2; }
  }
  if (!carcass || sim.getTerrainAt(Math.floor(a.gx), Math.floor(a.gy)) === "water") return null; // (not standing in the water)
  m.mode = "kill";
  if (bestD2 < stayOffKillTiles * stayOffKillTiles) return head(a, m, a.gx - carcass.gx || 1, a.gy - carcass.gy, "walk", now);
  if (bestD2 <= stayByKillTiles * stayByKillTiles) return IDLE;
  const go = goTo(a, m, carcass.gx, carcass.gy, "walk", now, { through: [a.mateUid, ...a.youngUids] });
  return go && !(m.path && m.path.failed) ? go : null;
}

// BROODING: a mother keeps by her young too young to walk (those she hasn't seen walk),
// where she knows them to be (they stay put, so she goes back even to young she lost
// track of): to the farthest beyond broodTiles of her (or the latest to whimper, within
// whimperHeedS), else she stands by them (they crawl to her to suckle). Going off, she
// heads back once away litterAwayShare of an infant's full meter (by her own reckoning
// of the time), or on hearing one whimper, and back stays by them litterStayS, before
// drinking (unless her water meter is below litterThirstBelow), eating or hunting:
// backToLitter. An intent, or null with no
// such young.
function litterOf(a, m) {
  const out = [];
  if (a.isMale || a.species !== "wolf") return out;
  for (const uid of a.youngUids) {
    const k = m.known.get(uid);
    if (k && k.alive && k.walks !== true) out.push(k);
  }
  return out;
}

function brood(a, m, now) {
  const young = litterOf(a, m);
  if (!young.length) { m.byLitterTick = null; return null; }
  let far = null, farD2 = broodTiles * broodTiles, cry = null;
  for (const k of young) {
    const d2 = (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
    if (d2 > farD2) { far = k; farD2 = d2; }
    if (k.call && k.call.kind === "whimper" && now - k.call.tick <= ticks(whimperHeedS) && d2 > broodTiles * broodTiles
      && (!cry || k.call.tick > cry.call.tick)) cry = k;
  }
  m.mode = "brood"; m.closing = null;
  const to = cry || far;
  if (!to) { m.byLitterTick = now; return IDLE; }
  const go = goTo(a, m, to.gx, to.gy, farD2 > 36 ? "trot" : "walk", now, { through: a.youngUids });
  return go && !(m.path && m.path.failed) ? go : IDLE;
}

function backToLitter(a, m, now) {
  const young = litterOf(a, m);
  if (!young.length) { m.byLitterTick = null; return null; }
  const by = young.every(k => (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2 <= broodTiles * broodTiles);
  if (by || m.byLitterTick == null) m.byLitterTick = now;
  if (by && m.litterBack) { m.litterBack = false; m.litterStay = now + ticks(litterStayS); }
  if (a.water < litterThirstBelow) return null;
  if (by) return m.litterStay > now ? brood(a, m, now) : null;
  const away = now - m.byLitterTick > ticks(litterAwayShare * sim.infantFoodFullS.wolf);
  const cried = young.some(k => k.call && k.call.kind === "whimper" && now - k.call.tick <= ticks(whimperHeedS));
  if (!away && !cried) return null;
  m.litterBack = true;
  return brood(a, m, now);
}

// MATES AND FAMILY: an intent, or null for nothing to do; with romanceOnly, only for
// courting and mating.
//   The young (not grown) keep near a parent (the mother first): an infant within
//     followParentTiles, a weaned youngster within followWeanedTiles (it eats with its
//     family, then hunts or grazes for itself, and roams around the family).
//   A newborn too young to walk (CRAWLING in sim.js) crawls, to its mother to suckle and
//     back within followParentTiles of her; otherwise it lies still.
//   BROODING: a mother with young too young to walk (as she sees them) keeps by them: she
//     goes to the farthest of them while it is beyond broodTiles of her, and otherwise
//     stands by them (mode "brood"), so the litter crawls to her and suckles together.
//   A paired critter mates with its partner while she is in heat (she while she is); a
//     paired male otherwise keeps within pairStayTiles of her, and she within twice that
//     of him (so one trotting off at the other's speed can't leave the other behind).
//   Keeping near kin, once it sets off back it comes to within keepCloseShare of that
//     distance (but no nearer than kinSpacingTiles), then wanders afresh (so it doesn't go to and fro across the limit).
//   (Going to them, it trots while 2 tiles beyond where it would stop, else walks.)
//   An unpaired grown critter courts the nearest unpaired grown critter of its species
//     and the other sex, if not barred (kin, or familiar: WESTERMARCK): goes to it and stands
//     ready to mate within mateCloseTiles. It gives up on one that hasn't mated with it in
//     courtGiveUpS. (Not in the water: none courts or mates swimming.) Knowing of none, it follows the freshest trail about of one that would
//     do (its scent tells: see SMELL in senses.js), the way it was laid (as TRACKING, at a
//     trot: mode "seek"), until it meets the maker.
// Kin out of sight are looked for where last seen; not there, they are lost until seen
// again (hearing them, as a call, finds them again).
//   PUPS STAY PUT: one too young to walk goes (crawls) only to a parent it perceives now;
//     otherwise it lies still where it is, never taking her as lost, and whimpers while
//     hungry for milk (nurseOrSuckle).
//   Hearing a call ("come": CALLS), kin know where the caller is, and keep near it as kin do.
function social(a, m, now, romanceOnly = false) {
  const live = uid => {
    const k = m.known.get(uid);
    return k && k.alive && !k.lost ? k : null;
  };
  const d2Of = k => (k.gx - a.gx) ** 2 + (k.gy - a.gy) ** 2;
  // the intent to go to k (uid) until within `within` (in sight), or null when there. To
  // keep near its kin (keep: "parent", "young" or "mate", whichever of them is nearest),
  // once it sets off it goes on to within keepCloseShare of that, then wanders afresh.
  // To one it courts it keeps dry (round the water, or as near as it can); to its mate,
  // rather dry. Knowing no way nearer it at all, it gives that one up for kinRetryS (null).
  const goToKin = (uid, k, within, keep = null) => {
    if (m.kinOut && m.kinOut.uid === uid && now < m.kinOut.until) return null;
    const d2 = d2Of(k), going = keep !== null && m.closing === keep;
    const stop = going ? Math.max(within * keepCloseShare, kinSpacingTiles) : within;
    if (k.seenTick === now) {
      if (d2 <= stop * stop) { if (going) m.closing = null; return null; }
    } else if (d2 <= kinLostTiles * kinLostTiles) { k.lost = true; m.closing = null; return null; }
    if (keep !== null && !going) { m.closing = keep; m.plan = null; }
    const go = goTo(a, m, k.gx, k.gy, d2 > within * within + 4 ? "trot" : "walk", now,
      { through: uid, dry: keep === null ? true : keep === "mate" ? "rather" : false });
    if (m.path && m.path.failed) { m.kinOut = { uid, until: now + ticks(kinRetryS) }; m.closing = null; return null; }
    return go;
  };
  const mateWith = (uid, k) => {
    const go = goToKin(uid, k, mateCloseTiles);
    if (go) return go;
    return k.lost || (m.kinOut && m.kinOut.uid === uid && now < m.kinOut.until) ? null : { gait: "mate", with: uid };
  };

  if (!sim.isGrown(a)) {
    m.court = null;
    if (romanceOnly) return null;
    const uid = a.parentUids.find(live);
    // PUPS STAY PUT: one too young to walk crawls only to a parent it perceives now
    if (!sim.can(a, "walk")) {
      const k = uid !== undefined && live(uid);
      if (!k || k.seenTick !== now) return null;
      m.mode = "family";
      return goToKin(uid, k, followParentTiles, "parent");
    }
    if (uid === undefined) {
      // FINDING ITS PARENTS: a young wolf that has lost track of them follows a parent's
      // trail (which it never marks over: SCENT TRAILS in sim.js) the way the parent went
      if (a.species !== "wolf") return null;
      const back = track(a, m, now, "wolf", "trot", t => a.parentUids.includes(t.uid), m.kinTrailEnds);
      if (back) m.mode = "family";
      return back;
    }
    m.mode = "family";
    return goToKin(uid, live(uid), sim.isInfant(a) ? followParentTiles : followWeanedTiles, "parent");
  }

  if (!a.isMale && !romanceOnly) {
    const go = brood(a, m, now);
    if (go) return go;
  }


  if (a.mateUid !== null) {
    m.court = null;
    const p = live(a.mateUid);
    if (!p) return null;
    const inHeat = a.isMale ? p.inHeat : sim.inHeat(a);
    if (inHeat && p.seenTick === now && !p.swimming && a.pose !== "swim") { m.mode = "mate"; return mateWith(a.mateUid, p); }
    if (romanceOnly) return null;
    // (his mate keeping to the den, or with young there: he stays by it, DENS)
    if (a.isMale && m.den && (p.gx - m.den[0]) ** 2 + (p.gy - m.den[1]) ** 2 <= guardTiles * guardTiles) {
      m.mode = "guard";
      if ((a.gx - m.den[0]) ** 2 + (a.gy - m.den[1]) ** 2 <= guardTiles * guardTiles) return IDLE;
      const go = goTo(a, m, m.den[0], m.den[1], "walk", now, { through: a.mateUid, dry: "rather" });
      if (go && !(m.path && m.path.failed)) return go;
    }
    m.mode = "family";
    return goToKin(a.mateUid, p, a.isMale ? pairStayTiles : 2 * pairStayTiles, "mate");
  }

  let best = null, bestD2 = Infinity;
  for (const [uid, k] of m.known) {
    if (k.species !== a.species || !k.alive || k.lost || k.isMale === a.isMale || !k.grown) continue;
    if (k.mateUid !== null || k.swimming || now - k.seenTick > ticks(wolfForgetPreyS)) continue;
    if (barredMate(a, m, uid) || (m.refused.get(uid) ?? -Infinity) > now) continue;
    const d2 = d2Of(k);
    if (d2 < bestD2) { best = uid; bestD2 = d2; }
  }
  if (best === null || a.pose === "swim") {
    m.court = null;
    if (a.pose === "swim") return null;
    const suits = t => t.isMale !== a.isMale && t.grown && !t.paired && t.uid !== a.uid
      && !barredMate(a, m, t.uid) && !((m.refused.get(t.uid) ?? -Infinity) > now);
    const seek = track(a, m, now, a.species, "trot", suits, m.mateTrailEnds);
    if (seek) m.mode = "seek";
    return seek;
  }
  if (!m.court || m.court.uid !== best) m.court = { uid: best, since: now };
  else if (now - m.court.since > ticks(courtGiveUpS)) {
    m.refused.set(best, now + ticks(courtRetryS));
    m.court = null;
    return null;
  }
  m.mode = "court";
  return mateWith(best, m.known.get(best));
}

// TIRED SWIMMERS: entering the water, a critter remembers where (the shore nearest its
// last footing on land: entryNearTiles) and its stamina then; swimming, it keeps looking
// for land it could climb out onto (an open land tile beside water, its bank within a step
// of it, with room about it: climbable), every landLookEveryS, and remembers the nearest it has seen (by where it
// is now); it forgets all this back on land. Once it has burned swimTurnBackShare of the
// stamina it went in with, it makes for the nearer of the two (looking about afresh then),
// whatever else it would do: going back the way it came takes no more than it has burned,
// so it has the stamina to get there. Blocked on the way shoreRetryTurns turns, it forgets
// that shore and makes for the other; knowing of none, it swims on the way it was going.
// (The player's wolf decides for itself while the player steers it.)
function climbable(i, j) {
  return sim.isLandTile(i, j)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => sim.getTerrainAt(i + di, j + dj) === "water") && roomy(i, j);
}

// Whether land tile (i, j) has room about it: at least roomyTiles of open land joined to it
// over land, a level up or down at a time (not a nook among boulders and water, where a
// critter too tired to swim on would be stuck).
const roomyTiles = 12;
function roomy(i, j) {
  const seen = new Set([i * 100000 + j]), todo = [[i, j]];
  while (todo.length && seen.size < roomyTiles) {
    const [ci, cj] = todo.pop(), lv = Math.min(...sim.tileCorners(ci, cj));
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj, key = ni * 100000 + nj;
      if (seen.has(key) || sim.getTerrainAt(ni, nj) === "water" || sim.isBlockedTile(ni, nj) || Math.abs(Math.min(...sim.tileCorners(ni, nj)) - lv) > 1) continue;
      seen.add(key); todo.push([ni, nj]);
    }
  }
  return seen.size >= roomyTiles;
}

// Notes where a critter stands for TIRED SWIMMERS: on land, its footing; swimming, where it
// entered the water, and the nearest climbable land in sight (every landLookEveryS).
function noteLand(a, m, now) {
  if (a.pose !== "swim") { m.lastDry = [a.gx, a.gy]; m.entry = m.landSeen = m.entryStamina = null; m.landLook = -Infinity; return; }
  if (m.entryStamina === null) m.entryStamina = a.stamina;
  if (!m.entry && m.lastDry) {
    // (no need to see it: it has just stood there)
    const [x, y] = m.lastDry, ci = Math.floor(x), cj = Math.floor(y);
    let best = null, bestL2 = Infinity;
    for (let i = ci - entryNearTiles; i <= ci + entryNearTiles; i++) for (let j = cj - entryNearTiles; j <= cj + entryNearTiles; j++) {
      const l2 = (i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2;
      if (l2 < bestL2 && climbable(i, j)) { best = [i, j]; bestL2 = l2; }
    }
    m.entry = best;
  }
  if (now - m.landLook < ticks(landLookEveryS)) return;
  m.landLook = now;
  const land = findNearestLand(a, a.gx, a.gy);
  const d2 = t => (t[0] + 0.5 - a.gx) ** 2 + (t[1] + 0.5 - a.gy) ** 2;
  if (land && (!m.landSeen || d2(land.tile) < d2(m.landSeen))) m.landSeen = land.tile;
}

// The land a tired swimmer makes for: the nearer of where it entered the water and the
// nearest land it has seen since (TIRED SWIMMERS); null if it knows of neither.
function shoreToMakeFor(a, m) {
  const d2 = t => (t[0] + 0.5 - a.gx) ** 2 + (t[1] + 0.5 - a.gy) ** 2;
  const known = [m.entry, m.landSeen].filter(Boolean);
  return known.length ? known.reduce((p, q) => d2(q) < d2(p) ? q : p) : null;
}

function toShore(a, m, now) {
  if (m.mode !== "ashore") { m.landLook = -Infinity; noteLand(a, m, now); } // (a fresh look about)
  m.mode = "ashore";
  const blocked = a.blockedTick > m.lastTurn;
  if (m.shore && blocked && ++m.shore.blockedTurns > shoreRetryTurns) {
    // can't get there: forgets it
    for (const k of ["entry", "landSeen"]) if (m[k] && m[k][0] === m.shore.tile[0] && m[k][1] === m.shore.tile[1]) m[k] = null;
    m.shore = null;
  }
  const t = shoreToMakeFor(a, m);
  if (!t) { m.shore = null; return calm(a, m, now); } // swims on as it was going
  if (!m.shore || m.shore.tile[0] !== t[0] || m.shore.tile[1] !== t[1]) m.shore = { tile: t, gx: t[0] + 0.5, gy: t[1] + 0.5, blockedTurns: 0 };
  m.plan = null;
  return goTo(a, m, m.shore.gx, m.shore.gy, "walk", now);
}

// CALM: wander for a random while (a random heading at a walk), or RESTS (stands still,
// mode "rest"; not in the water, nor on a water tile): at full stamina calmRestShare of the time, and the more the
// more tired it is (all the time spent), so at ease it gets back the stamina its trotting
// cost (see EXERTION in sim.js). An unpaired grown critter with stamina to spare (above
// calmRoamStamina) ROAMS instead, to meet others: one heading at a trot for roamS / 2 to
// roamS (as young wolves disperse to find mates). A swimmer may head for land instead,
// the more surely the farther away it is. Knowing no way at all the way it heads, it picks
// another.
function calm(a, m, now) {
  const p = m.plan;
  const blocked = a.blockedTick > m.lastTurn;
  if (p && p.kind === "toLand") {
    if (a.pose !== "swim") { m.plan = null; return calm(a, m, now); }
    if (blocked && ++p.blockedTicks > ticks(returnToLandGiveUpS)) m.plan = null;
    else return goTo(a, m, p.gx, p.gy, "walk", now);
  }
  // (knowing no way at all that way, it picks another next turn)
  const wander = intent => {
    if (intent === IDLE) return IDLE;
    const go = head(a, m, intent.dx, intent.dy, intent.gait, now);
    if (go === IDLE) m.plan = null;
    return go;
  };
  if (p && p.kind === "wander" && now < p.until && !blocked) {
    if (p.intent === IDLE) m.mode = "rest";
    return wander(p.intent);
  }

  const until = now + 120 + Math.floor(Math.random() * 500 + Math.random() * 500);
  if (a.pose === "swim") {
    const land = findNearestLand(a, a.gx, a.gy);
    // certain at returnToLandSureTiles; compared squared to avoid a square root
    const roll = Math.random() * returnToLandSureTiles;
    if (land && roll * roll < land.distL2) {
      m.plan = { kind: "toLand", gx: land.tile[0] + 0.5, gy: land.tile[1] + 0.5, blockedTicks: 0 };
      return goTo(a, m, m.plan.gx, m.plan.gy, "walk", now);
    }
  }
  const roam = sim.isGrown(a) && a.mateUid === null && a.stamina > calmRoamStamina;
  const wet = a.pose === "swim" || sim.getTerrainAt(Math.floor(a.gx), Math.floor(a.gy)) === "water";
  if (!roam && !wet && Math.random() < calmRestShare + (1 - calmRestShare) * (1 - a.stamina)) {
    m.plan = { kind: "wander", until, intent: IDLE };
    m.mode = "rest";
  } else {
    // one way all plan long
    let dx = 1, dy = 0;
    for (let tries = 0; tries < 4; tries++) {
      dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1;
      const k = 1 / Math.max(Math.abs(dx), Math.abs(dy), 0.01); // about a tile ahead
      if (sim.canStepTo(a, a.gx + dx * k, a.gy + dy * k)) break;
    }
    const gait = roam ? "trot" : "walk";
    m.plan = { kind: "wander", until: roam ? now + ticks(roamS * (0.5 + Math.random() / 2)) : until,
      intent: { dx, dy, gait } };
  }
  return wander(m.plan.intent);
}

// The nearest land tile to (gx, gy) a swimmer can climb onto that critter a can see,
// within maxR tiles: { tile: [i, j], distL2 (squared distance to the tile's nearest
// point) }, or null.
function findNearestLand(a, gx, gy, maxR = Infinity) {
  const sightReach = Math.ceil(senses.sightRadiusTiles) + 1;
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
      if (!climbable(i, j) || !senses.canSeeTile(a, i, j)) continue;
      const d = distToTileL2(i, j);
      if (!best || d < best.distL2) best = { tile: [i, j], distL2: d };
    }
  }
  return best;
}

// GIVING WAY: a critter at ease (standing still, wandering or keeping near kin; not one
// suckling or being suckled)
// that another has just moved into (sim's BUMPED: it feels it) steps aside for yieldS,
// across the bumper's way, to the side it is on if it can step there; so a family around one of them
// never pens it in. Then it carries on.
function giveWay(a, m, intent, now) {
  const atEase = m.mode !== "nurse" && (intent === IDLE || (intent && intent.gait === "idle")
    || m.mode === "calm" || m.mode === "rest" || m.mode === "family" || m.mode === "yield");
  if (m.yield && now < m.yield.until && atEase) return m.yield.intent;
  m.yield = null;
  if (!atEase || a.pose === "swim" || !(sim.tickCount - a.bumpedTick <= turnTicks)) return intent;
  // across the bumper's way, to the side of it it is on (so it draws apart from it), else
  // the other
  const dx = a.bumpedDx, dy = a.bumpedDy;
  const left = -dy * (a.gx - a.bumpedX) + dx * (a.gy - a.bumpedY) >= 0;
  const sides = [[-dy, dx], [dy, -dx]];
  for (const [sx, sy] of left ? sides : sides.reverse()) {
    const k = 1 / Math.max(Math.abs(sx), Math.abs(sy), 1e-6);
    if (!sim.canStepTo(a, a.gx + sx * k, a.gy + sy * k)) continue;
    m.yield = { until: now + ticks(yieldS), intent: { dx: sx, dy: sy, gait: "walk" } };
    m.mode = "yield";
    return m.yield.intent;
  }
  return intent;
}

// Every tick: the critters whose turn it is perceive, remember and decide.
function think() {
  const now = sim.tickCount;
  senses.regrid();
  for (const a of sim.allCritters) {
    if (!sim.isLiveCritter(a) || ignored.has(a)) continue;
    const m = memoryOf(a);
    if (a === sim.pcWolf && sim.playerHasControl()) {
      // drop its own last decision, so it doesn't resume it the moment the player lets go
      if (m.intent) { sim.setIntent(a, null); m.intent = null; }
      m.playerTick = now; m.plan = null;
      if (now % turnTicks === m.slot) noteLand(a, m, now); // (for when the player lets go in the water)
      continue;
    }
    if (now % turnTicks !== m.slot) continue;
    remember(a, m, now);
    noteBump(a, m, now);
    noteShores(a, m, now);
    noteLand(a, m, now);
    let intent;
    if (a.pose !== "swim") m.shore = null;
    if (now - m.playerTick < ticks(playerHandoverS)) intent = IDLE;
    else if (a.pose === "swim" && a.stamina <= m.entryStamina * (1 - swimTurnBackShare)) intent = toShore(a, m, now);
    else intent = a.species === "wolf" ? decideWolf(a, m, now) : decideDeer(a, m, now);
    noteWhere(a, m, now);
    if (a.pose !== "swim") intent = escape(a, m, now, intent) || intent;
    intent = giveWay(a, m, intent, now);
    m.intent = intent;
    m.lastTurn = now;
    sim.setIntent(a, intent);
  }
  // the memories of critters no longer in play
  for (const a of sim.allCritters) { const m = memories.get(a); if (m) m.inPlayTick = now; }
  for (const [a, m] of memories) if (m.inPlayTick !== now) dropMemory(a);
  if (pacing.on) watchPacing(now);
}

// DEBUG, PACING: flags a critter whose last pacingTiles tiles entered hold no more than
// pacingDistinct different ones (going back and forth over a few tiles). Each flag goes
// into pacing.log (the newest pacingLogMax) with the modes and decisions over those
// steps, the ground around (patch) and the critters near, and to the console (info). A
// critter is flagged again only after it has left the pattern. In the browser's console:
// mind.pacing.log; mind.pacing.on = false turns it off.
const pacingTiles = 24, pacingDistinct = 6, pacingLogMax = 500;
const pacing = { on: true, log: [] };
// The ground around tile (i, j): a row of cells per j, each its terrain's initial (W
// water, g grass, d dirt, s stone; # a boulder) and lowest corner's level.
function pacingPatch(ci, cj, r) {
  const rows = [];
  for (let j = cj - r; j <= cj + r; j++) {
    const row = [];
    for (let i = ci - r; i <= ci + r; i++) {
      const t = sim.getTerrainAt(i, j);
      row.push(!t ? "  " : (sim.obstacleAt(i, j) ? "#" : t[0].replace("w", "W")) + Math.min(...sim.tileCorners(i, j)));
    }
    rows.push(`${j}: ` + row.join(" "));
  }
  return { from: [ci - r, cj - r], rows };
}
function watchPacing(now) {
  for (const a of sim.allCritters) {
    if (!sim.isLiveCritter(a)) continue;
    const m = memories.get(a);
    if (!m) continue;
    const i = Math.floor(a.gx), j = Math.floor(a.gy), key = i * 100000 + j;
    const steps = m.pacingSteps || (m.pacingSteps = []);
    if (steps.length && steps[steps.length - 1].key === key) continue;
    const it = m.intent;
    steps.push({ key, i, j, tick: now, mode: m.mode, food: +a.food.toFixed(2), pose: a.pose,
      intent: !it ? null : it.gait + (it.dx !== undefined ? ` ${it.dx.toFixed(2)},${it.dy.toFixed(2)}` : it.dir !== undefined ? ` dir ${it.dir}` : "") });
    if (steps.length > pacingTiles) steps.shift();
    if (steps.length < pacingTiles) continue;
    const distinct = new Set(steps.map(s => s.key)).size;
    if (distinct > pacingDistinct) { m.pacingFlagged = false; continue; }
    if (m.pacingFlagged) continue;
    m.pacingFlagged = true;
    const modes = {};
    for (const s of steps) modes[s.mode] = (modes[s.mode] || 0) + 1;
    const entry = { tick: now, uid: a.uid, species: a.species, grown: sim.isGrown(a), distinct,
      seconds: +((now - steps[0].tick) * sim.tempo).toFixed(1), modes, steps: steps.slice(),
      state: { target: m.target, searching: m.searching, flee: m.flee && { ...m.flee }, grazeTo: m.grazeTo,
        court: m.court && { ...m.court }, plan: m.plan && { kind: m.plan.kind }, path: m.path && m.path.tiles.length, trapped: m.trapped,
        mateUid: a.mateUid, parents: a.parentUids.slice(), young: a.youngUids.length,
        watch: m.watch && { ...m.watch }, shore: m.shore && { ...m.shore } },
      at: [+a.gx.toFixed(2), +a.gy.toFixed(2)], patch: pacingPatch(i, j, 4),
      near: sim.allCritters.concat(sim.allCorpses).filter(c => c !== a && Math.abs(c.gx - a.gx) < 4 && Math.abs(c.gy - a.gy) < 4)
        .map(c => ({ uid: c.uid, species: c.species, live: sim.isLiveCritter(c), at: [+c.gx.toFixed(1), +c.gy.toFixed(1)], mode: memories.get(c)?.mode })) };
    pacing.log.push(entry);
    if (pacing.log.length > pacingLogMax) pacing.log.shift();
    if (typeof console !== "undefined") console.info("[pacing]", a.species, a.uid, `${distinct} tiles in ${entry.seconds} s`, modes);
  }
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

// For tests and debugging: a critter at rest, planning to stand still for s seconds.
function rest(a, s) {
  const m = memoryOf(a);
  m.mode = "calm";
  m.plan = { kind: "wander", until: sim.tickCount + ticks(s), intent: IDLE };
}

// For tests and debugging: wipe a critter's memory and last decision.
function forget(a) {
  dropMemory(a);
  sim.setIntent(a, null);
}

// For tests: has it take kin uid as lost, or take itself as away from its litter s seconds.
function markLost(a, uid) { const k = memoryOf(a).known.get(uid); if (k) k.lost = true; }
function awayFromLitter(a, s) { memoryOf(a).byLitterTick = sim.tickCount - ticks(s); }

// For tests: has it remember a shore at tile (i, j), as if it had seen it.
function knowShore(a, i, j, salt = false) {
  memoryOf(a).waters.set(cellKey(i, j), { i, j, salt });
}

// For tests: a critter's den, as if it had picked or learnt it (DENS).
function setDen(a, at) { memoryOf(a).den = at && at.slice(); }

// For tests: a critter met uid as an infant (WESTERMARCK).
function setFamiliar(a, uid) { memoryOf(a).familiar.add(uid); }

// For tests and debugging: what a critter has in mind.
function stateOf(a) {
  const m = memories.get(a);
  if (!m) return null;
  return { mode: m.mode, target: m.target, searching: m.searching, flee: m.flee, watch: m.watch,
    path: m.path && { tx: m.path.tx, ty: m.path.ty, tiles: m.path.tiles.slice(), failed: m.path.failed }, rocks: m.rocks.size, wet: m.wet.size, bumps: m.bumps.size,
    trapped: m.trapped, escape: m.escape && { ...m.escape }, intent: m.intent, heading: m.heading && { ...m.heading },
    grazeTo: m.grazeTo, closing: m.closing, entry: m.entry, landSeen: m.landSeen, entryStamina: m.entryStamina, drinking: m.drinking, waterTo: m.waterTo !== null ? m.waters.get(m.waterTo) : null,
    waters: [...m.waters.values()].map(s => ({ ...s })),
    slot: m.slot, lastTurn: m.lastTurn, court: m.court, familiar: [...m.familiar], den: m.den && m.den.slice(),
    given: [...m.given],
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

return { attach, takeOver, ignore, forget, knowShore, setDen, setFamiliar, markLost, awayFromLitter, rest, stateOf, denWaterTiles, get turnTicks() { return turnTicks; }, wolfHuntBelow, drinkBelow,
  prowlHomeTiles, pacing };

})();

// In Node, mind.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = mind;
