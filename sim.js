// THE SIMULATION: the world, its critters and its rules, advanced one tick at a time.
//
// It never touches the DOM and makes no decisions for anyone, so it runs without a
// browser (tests/separation.test.js checks this). Critters do what their INTENTS say:
// the mind (mind.js) sets them for every critter, and the controls (controls.js) for the
// player's wolf. The view (animat.js) only reads the simulation's state.
//
// Everything it offers is on the one global it defines, `sim` (see THE INTERFACE at the
// end). Positions are grid coordinates: tile (i, j) covers [i, i+1) x [j, j+1), 1 m a side.

const sim = (() => {

const tempo = 1 / 60;          // game seconds per tick
let consoleOnlyMode = false;   // set by start(): run as fast as possible, logging each tick
let g_tick = 0;                // ticks run so far; changed only by tick()
let g_now = 0;                 // game seconds so far; changed only by tick()
let g_next_uid = 0;
let isPaused = false;

// The map is square. Its grass feeds about 59 deer: a deer eats ~639 kg of grass a year
// and a tile grows back 0.4 kg a year (see FOOD), so a deer needs ~1,600 grass tiles;
// 414 x 414 has 94,881. The sea's ring scales with the map; land features are sized in
// tiles.
const gridWidthN = 414;
const gridHeightN = 414;

// GAME SPEEDS
// Every constant that sets how fast things happen is in one of two datasets: REALISTIC
// (real animals' figures, with their sources) and GAMIFIED (sped up for play and
// testing). Both list every key; SPEEDS picks the one the game runs at.
//   travelKph              speed by species and pose, km/h (1 tile = 1 m); swimBurst is
//                          a swimmer's sprint (see SWIMMING)
//   exertion               how long a full reserve lasts, by species (see EXERTION)
//   windRefillHalfLifeSByPose, staminaFullRefillSByPose, gallopStaminaCostFactor,
//   windStartFrac, staminaStartFrac   refilling the reserves, and starting a gait
//   swimMinStaminaFrac     stamina needed to go into the water (see SWIMMING)
//   accelToGallopS         from standing to a full gallop, and back (see SPEED CHANGES)
//   climbOutSlowS          how long a critter climbing out of the water up a bank is held
//                          to a walk (see SWIMMING); real time in both, like travel
//   stunMinS, stunMaxS     how long a blocked move stuns a critter (see INTENTS)
//   deathDurationSBySpecies   the death pose's length (animat.js fits its animation to it)
//   corpseLastsS           how long after its death a corpse is gone (two weeks)
//   lifeStageAgesS         ages a young critter can see, hear, walk, eat, run, is weaned
//                          and can mate
//   growthAgesS            ages at which a well-fed young critter's skeleton has grown
//                          growthSharesBySpecies of the way to an adult's (see BODY)
//   breeding               gestation, how often a female can conceive, the oldest a
//                          critter is fertile, and the mating act (see BREEDING)
//   forcedMortalityMaxS, mortalityRatio   how long critters live (see FORCED MORTALITY)
//   foodFullS, eatKgPerS, grassMaxKg, grassRegrowKgPerS
//                          food meters, eating and grass (see FOOD)
//   infantFoodFullS, nurseFullS   how long an infant's meter lasts, and how long it takes
//                          to suckle it full (see BREEDING); GAMIFIED's are chosen for
//                          play, not scaled from REALISTIC's
//   growthCostShare        the share of growth's real cost in food that it costs (see BODY)
//   dayLengthS             a day and night; a year is 365 of them (see DAY AND NIGHT)
//   wakeLastsS, sleepFillS how long a full wakeful meter lasts awake, and how long sleep
//                          takes to fill an empty one (see SLEEP)
//   scentHalfLifeS, windChangeEveryS   scent trails fading, and the wind shifting (see
//                          SCENT AND WIND); the same in both: they go with travel, which
//                          is at real speeds in both
const hourS = 60 * 60;
const dayS = 24 * hourS;
const yearS = dayS * 365;
const monthS = yearS / 12;

const realLifeStageAgesS = {
  wolf: {
    see:    { min: 9 * dayS,  avg: 12 * dayS,  max: 15 * dayS },
    hear:   { min: 10 * dayS, avg: 14 * dayS,  max: 18 * dayS },
    walk:   { min: 14 * dayS, avg: 18 * dayS,  max: 21 * dayS },
    eat:    { min: 19 * dayS, avg: 25 * dayS,  max: 35 * dayS },
    run:    { min: 25 * dayS, avg: 28 * dayS,  max: 35 * dayS },
    // weaned at 5-9 weeks, nursing on for a few more (San Diego Zoo Wildlife Alliance)
    wean:   { min: 5 * 7 * dayS, avg: 8 * 7 * dayS, max: 10 * 7 * dayS },
    mate:   { min: 18 * monthS, avg: 24 * monthS,  max: 36 * monthS },
  },
  deer: {
    see:    { min: 0, avg: 0, max: 0 },
    hear:   { min: 0, avg: 0, max: 0 },
    walk:   { min: 0.25 * hourS, avg: 0.5 * hourS, max: 1 * hourS},
    eat:    { min: 10 * dayS, avg: 20 * dayS, max: 30 * dayS },
    run:    { min: 1 * dayS, avg: 2 * dayS, max: 3 * dayS },
    wean:   { min: 4 * monthS, avg: 5 * monthS, max: 8 * monthS }, // ~156 days (Add-my-Pet)
    mate:   { min: 16 * monthS, avg: 24 * monthS,  max: 36 * monthS },
  }
};
// Growth: the ages at which a well-fed young critter has grown growthSharesBySpecies (see
// BODY) of the way from its birth weight to its adult weight. Wolves gain about linearly to
// ~30 kg at 10-12 months, then slowly (Canadian Field-Naturalist 2003: 8-10 kg at 3
// months); red deer: about 40% of a hind's weight at weaning, 50% at a year (estimates).
const realGrowthAgesS = {
  wolf: [0, 1 * monthS, 3 * monthS, 11 * monthS, 24 * monthS],
  deer: [0, 5 * monthS, 12 * monthS, 24 * monthS, 48 * monthS],
};
// Breeding:
//   Wolf: estrus once a year; gestation 60-65 days; litters (see BREEDING) average ~6
//   (San Diego Zoo Wildlife Alliance), Yellowstone's largest 11 (NPS); females breed to
//   about 10-11 years (Mech 1988), males a little longer (estimate). The copulatory tie
//   lasts some 15-30 minutes.
//   Red deer: one rut a year; gestation ~235 days; hinds' fecundity declines from about 9
//   years (Rum Red Deer Project) and few calve past ~18, stags' earlier (estimates).
//   Mating takes seconds.
const realBreeding = {
  wolf: {
    gestationS: { min: 60 * dayS, avg: 63 * dayS, max: 65 * dayS },
    intervalS: yearS,
    maxFertileAgeS: { female: 11 * yearS, male: 12 * yearS },
    mateActS: 20 * 60,
  },
  deer: {
    gestationS: { min: 228 * dayS, avg: 235 * dayS, max: 242 * dayS },
    intervalS: yearS,
    maxFertileAgeS: { female: 18 * yearS, male: 15 * yearS },
    mateActS: 10,
  },
};
// The greatest ages recorded in captivity, where hunger, predators and disease (modelled
// separately, or not at all) don't cut lives short. AnAge (genomics.senescence.info):
// grey wolf 20.6 years, red deer 31.5 years.
const realForcedMortalityMaxS = { wolf: 20.6 * yearS, deer: 31.5 * yearS };
// Each lifespan as a share of that greatest age: about normal, within [min, max].
// Estimates (no clean published distribution exists): captive wolves mostly die of age
// at 12-17 years; red deer age from about 9-10 and few pass 20-25.
const mortalityRatio = {
  wolf: { mean: 0.70, sd: 0.10, min: 0.45, max: 1 },
  deer: { mean: 0.55, sd: 0.10, min: 0.30, max: 1 },
};
// Bodies (see BODY):
//   Weights, kg: at birth and adult (well fed: see BODY), by sex. Wolf: 0.3-0.5 kg at
//   birth (San Diego Zoo Wildlife Alliance); adults average 41 (female) and 50 (male) in
//   Yellowstone (NPS). Red deer calves: about 6 kg (female) and 6.5 (male) (Arman et al.,
//   via wildlifeonline.me.uk); adults: estimates for European red deer.
//   Shares of a well-fed body: white-tailed deer in early winter are 62% water, 12% fat,
//   20.5% protein and 4.5% ash (DelGiudice et al. 1990, J. Wildlife Management). The
//   skeleton is taken as 10% (its ash, with its own protein and water: estimate), the
//   rest of the water as the lean tissue's. Wolf: estimates, likewise (fasting wolves'
//   loss is about 55% water: Kreeger et al. 1997).
//   Energy: 37.7 MJ a kg of fat, 16.7 of protein (Atwater's 9 and 4 kcal a gram). A
//   starving mammal dies with about two thirds of its protein left (estimate).
const bodyKgBySpecies = {
  wolf: { birth: { female: 0.4, male: 0.4 }, female: 41, male: 50 },
  deer: { birth: { female: 6, male: 6.5 }, female: 100, male: 160 },
};
const bodySharesBySpecies = {
  wolf: { fat: 0.10, protein: 0.19, skeleton: 0.10 },
  deer: { fat: 0.12, protein: 0.18, skeleton: 0.10 },
};
const fatMJPerKg = 37.7, proteinMJPerKg = 16.7;
const lethalProteinShare = 2 / 3;
// Food, as real animals eat:
//   Wolf: a full meter lasts 14 days (an adult wolf can go almost two weeks without food:
//   New York Wolf Center); it eats ~0.5 kg of meat a minute, and can gorge on up to 20%
//   of its weight at a time (International Wolf Center).
//   Deer: red deer eat ~1.75 kg of dry grass a day (Forestry and Land Scotland), of ~10
//   MJ a kg (estimate), so a full meter lasts as long as that takes to spend; they graze
//   ~0.2 kg an hour.
//   Grass: an ungrazed field holds ~0.2-0.4 kg of dry matter a square metre (0.3 here)
//   and unfertilized grassland regrows ~0.4 kg a square metre a year.
//   Nursing (red deer, via wildlifeonline.me.uk): bouts of 45 s to 4 minutes, of 150-600
//   ml of milk, 5-10 a day at first; a hind gives up to ~2 kg a day. At ~6 MJ a kg (its
//   fat and protein), that is ~12 MJ a day, a newborn's full meter (see BODY) in about 3
//   days, and its meter full in about 40 minutes of suckling. A hind turns food into milk
//   at about 65% (as livestock: estimate). Wolf pups: no figures found; as calves.
const grassMJPerKg = 10;
const milkEfficiency = 0.65;
const realFoodFullS = {
  wolf: 14 * dayS,
  // (a hind's full meter, over what she spends a day)
  deer: dayS * bodyKgBySpecies.deer.female * bodySharesBySpecies.deer.skeleton * energyRangePerKg("deer") / (1.75 * grassMJPerKg),
};
const realEatKgPerS = { wolf: 0.5 / 60, deer: 0.2 / hourS };
const realGrassRegrowKgPerS = 0.4 / yearS;
// Sleep:
//   Grey wolves sleep about a third of the time, mostly by day: in winter daylight, 34%
//   asleep and 31% resting (Mech 1992, J. Mammalogy, 405 radio-collared wolves); most
//   active at dawn and dusk. A wolf can keep going a whole day (estimate).
//   Red deer sleep in several short bouts, by night and around midday: reindeer, the
//   nearest measured, sleep about 6.3 hours a day (5.4 h non-REM, 0.9 h REM: Furrer et
//   al. 2023, Current Biology); a full meter lasts 8 hours awake (estimate).
//   Sleep fills the meter as fast as the day's sleep makes up for the day awake.
const realSleepShare = { wolf: 8 / 24, deer: 6.3 / 24 };
const realWakeLastsS = { wolf: 24 * hourS, deer: 8 * hourS };
const realSleepFillS = Object.fromEntries(Object.entries(realWakeLastsS).map(([sp, s]) =>
  [sp, s * realSleepShare[sp] / (1 - realSleepShare[sp])]));

const REALISTIC = {
  name: "realistic",
  travelKph: {
    wolf: {
      walk: 5,        // estimate; no direct figure found
      trot: 9,        // the travel gait, kept up for hours (Mech & Boitani: 8-9 km/h)
      gallop: 55,     // chasing prey: 50-64 km/h for 1-8 km
      swim: 3.5,      // ~3 mph; reported figures are sparse
      swimBurst: 6,
    },
    deer: {
      walk: 5,
      trot: 15,       // estimate from the elk's sustained "dogtrot"
      gallop: 65,     // an escape burst of about 1 km (top reported 72 km/h)
      swim: 5,        // ~5 mph: deer outswim wolves
      swimBurst: 10,
    },
  },
  exertion: {
    wolf: {
      gallopFullWindS: 240,     // chases of several km
      trotFullStaminaS: 30000,  // ~8.3 hours
      swimTimeS: 7200,
    },
    deer: {
      gallopFullWindS: 60,      // a burst of about 1 km
      trotFullStaminaS: 10800,  // 3 hours
      swimTimeS: 3600,
    },
  },
  // Wind: half of what's missing comes back every this many seconds, by pose.
  windRefillHalfLifeSByPose: { idle: 45, walk: 60, trot: 180 },
  // Stamina: seconds from empty to full, by pose.
  staminaFullRefillSByPose: { idle: 30000, walk: 120000 },
  gallopStaminaCostFactor: 2, // galloping uses stamina twice as fast as trotting
  windStartFrac: 0.25,        // wind needed to start a gallop
  staminaStartFrac: 0.1,      // stamina needed to start a trot or gallop
  swimMinStaminaFrac: 0.25,
  accelToGallopS: { wolf: 2.5, deer: 1.5 },
  climbOutSlowS: { wolf: 1.5, deer: 1.5 }, // estimate: scrambling up a bank
  stunMinS: 0.1,
  stunMaxS: 0.5,
  deathDurationSBySpecies: { deer: 2 / 3, wolf: 1.1 },
  corpseLastsS: 14 * dayS,
  lifeStageAgesS: realLifeStageAgesS,
  growthAgesS: realGrowthAgesS,
  breeding: realBreeding,
  forcedMortalityMaxS: realForcedMortalityMaxS,
  mortalityRatio,
  foodFullS: realFoodFullS,
  // Estimates: dogs follow trails hours old; breezes shift every minute or so.
  scentHalfLifeS: 30 * 60,
  windChangeEveryS: 60,
  dayLengthS: dayS,
  wakeLastsS: realWakeLastsS,
  sleepFillS: realSleepFillS,
  eatKgPerS: realEatKgPerS,
  infantFoodFullS: { wolf: 3 * dayS, deer: 3 * dayS },
  growthCostShare: 1,
  nurseFullS: { wolf: 40 * 60, deer: 40 * 60 },
  grassMaxKg: 0.3,
  grassRegrowKgPerS: realGrassRegrowKgPerS,
};

// GAMIFIED shrinks real times by one factor per area: lives (growing up and breeding
// too) so the wolf's greatest age is 90 minutes, food so a wolf's full meter lasts 20
// minutes, and exertion (draining and refilling) 10 times as fast, and a deer's swimming
// twice that. The mating act lasts a few seconds, long enough to see.
const gameLifeScale = (90 * 60) / Math.min(...Object.values(realForcedMortalityMaxS));
const gameFoodScale = (20 * 60) / realFoodFullS.wolf;
const gameExertionSpeedup = 10;
const gameDayS = 10 * 60;
const scaledAges = (table, k) => Object.fromEntries(Object.entries(table).map(([sp, caps]) =>
  [sp, Object.fromEntries(Object.entries(caps).map(([cap, t]) =>
    [cap, { min: t.min * k, avg: t.avg * k, max: t.max * k }]))]));
const scaledTimes = (table, k) => Array.isArray(table) ? table.map(v => v * k)
  : Object.fromEntries(Object.entries(table).map(([key, v]) => [key, typeof v === "object" ? scaledTimes(v, k) : v * k]));

const GAMIFIED = {
  name: "gamified",
  travelKph: {
    wolf: { walk: 5, trot: 9, gallop: 55, swim: 3.5, swimBurst: 6 },
    deer: { walk: 5, trot: 15, gallop: 65, swim: 5, swimBurst: 10 },
  },
  exertion: (() => {
    const ex = scaledTimes(REALISTIC.exertion, 1 / gameExertionSpeedup);
    ex.deer.swimTimeS /= 2; // deer tire twice as fast swimming, so they don't linger in water
    return ex;
  })(),
  windRefillHalfLifeSByPose: scaledTimes(REALISTIC.windRefillHalfLifeSByPose, 1 / gameExertionSpeedup),
  staminaFullRefillSByPose: scaledTimes(REALISTIC.staminaFullRefillSByPose, 1 / gameExertionSpeedup),
  gallopStaminaCostFactor: 2,
  windStartFrac: 0.25,
  staminaStartFrac: 0.1,
  swimMinStaminaFrac: 0.25,
  accelToGallopS: { wolf: 2.5, deer: 1.5 },
  climbOutSlowS: { wolf: 1.5, deer: 1.5 }, // estimate: scrambling up a bank
  stunMinS: 0.1,
  stunMaxS: 0.5,
  deathDurationSBySpecies: { deer: 2 / 3, wolf: 1.1 },
  corpseLastsS: 14 * dayS * gameFoodScale, // as long as a wolf's full meter lasts
  lifeStageAgesS: scaledAges(realLifeStageAgesS, gameLifeScale),
  growthAgesS: scaledTimes(realGrowthAgesS, gameLifeScale),
  breeding: (() => {
    const b = scaledTimes(realBreeding, gameLifeScale);
    b.wolf.mateActS = b.deer.mateActS = 3;
    return b;
  })(),
  forcedMortalityMaxS: {
    wolf: realForcedMortalityMaxS.wolf * gameLifeScale,
    deer: realForcedMortalityMaxS.deer * gameLifeScale,
  },
  mortalityRatio,
  foodFullS: { wolf: realFoodFullS.wolf * gameFoodScale, deer: realFoodFullS.deer * gameFoodScale },
  // Estimates: dogs follow trails hours old; breezes shift every minute or so.
  scentHalfLifeS: 30 * 60,
  windChangeEveryS: 60,
  // A day and night lasts 10 minutes (chosen for play; a year, 61 hours), and sleep goes
  // with it. TODO: one scale for all of GAMIFIED (this is far from food's, and lives').
  dayLengthS: gameDayS,
  wakeLastsS: scaledTimes(realWakeLastsS, gameDayS / dayS),
  sleepFillS: scaledTimes(realSleepFillS, gameDayS / dayS),
  eatKgPerS: { wolf: realEatKgPerS.wolf / gameFoodScale, deer: realEatKgPerS.deer / gameFoodScale },
  // Chosen for play, not scaled (scaled, a bout would last a few ticks): the young get
  // hungry every 15 s or so, and a bout (0.8 to full) takes a few seconds, to be seen.
  infantFoodFullS: { wolf: 86, deer: 86 },
  // Lives shrink far more than meals: growing at full cost, the young would need to eat
  // over a hundred times what they use. Growth costs what it would have at food's scale.
  growthCostShare: gameLifeScale / gameFoodScale,
  nurseFullS: { wolf: 14, deer: 14 },
  grassMaxKg: 0.3,
  grassRegrowKgPerS: realGrassRegrowKgPerS / gameFoodScale,
};

const SPEEDS = GAMIFIED;

// Values the code reads often, taken from SPEEDS once.
const deathDurationSBySpecies = SPEEDS.deathDurationSBySpecies;
const exertionBySpecies = SPEEDS.exertion;
const windRefillHalfLifeSByPose = SPEEDS.windRefillHalfLifeSByPose;
const staminaFullRefillSByPose = SPEEDS.staminaFullRefillSByPose;
const gallopStaminaCostFactor = SPEEDS.gallopStaminaCostFactor;
const windStartFrac = SPEEDS.windStartFrac;
const staminaStartFrac = SPEEDS.staminaStartFrac;
const stunMinS = SPEEDS.stunMinS;
const stunMaxS = SPEEDS.stunMaxS;
// The age at which a critter can do each thing (the average of its range).
const canAtAgeBySpecies = Object.fromEntries(Object.entries(SPEEDS.lifeStageAgesS).map(([sp, caps]) =>
  [sp, Object.fromEntries(Object.entries(caps).map(([cap, t]) => [cap, t.avg]))]));
// Speeds in tiles per tick, by species and pose.
const kphToTpTk = 0.277777 * tempo;
const travelSpeedBySpeciesAndPose = Object.fromEntries(Object.entries(SPEEDS.travelKph).map(([sp, kph]) =>
  [sp, { ...Object.fromEntries(Object.entries(kph).map(([pose, v]) => [pose, v * kphToTpTk])), idle: 0, death: 0 }]));
// How much a critter's speed may change in one tick (see SPEED CHANGES).
const accelBySpecies = Object.fromEntries(Object.keys(travelSpeedBySpeciesAndPose).map(sp =>
  [sp, travelSpeedBySpeciesAndPose[sp].gallop / (SPEEDS.accelToGallopS[sp] / tempo)]));

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function sample(list) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// TERRAIN
// Everything about the ground is a pure function of the tile (no stored map, no random
// numbers), built from independent fields:
//   SEA           seaFieldAt     where the sea is
//   RELIEF        reliefAt       where the lakes are, and how high the land is
//   GROUND COVER  groundCoverAt  grass, dirt or stone
//   OBSTACLES     obstacleAt     boulders
// getTerrainAt is the one place that decides what is water. Because the sea and relief
// are independent, the coast cuts across land at any height (making sea cliffs), while
// lakes, being the lowest relief, always have gentle shores.

// Triangle wave: 0 at whole numbers, 1 halfway between.
function jag(x) {
  return 2 * Math.abs(x - Math.floor(x + 0.5));
}

// jag eased by smoothstep, so thresholds on sums of these give rounded regions.
function wave(x) {
  const t = jag(x);
  return t * t * (3 - 2 * t);
}

// SEA: rings around the map's center (a ring of sea, land in the corners) from a
// triangle wave of the squared distance from the center, q. Inside the land ring's crest
// (seaCrestQ) the field holds at the crest's value, so the middle of the map is all land
// (no inner sea; lakes come from the relief). Four slow waves in four directions push the
// coasts in and out so the ring isn't a circle.
const seaBelow = 0.2;
const seaCrestQ = 0.5; // jag(q) peaks here
const mapCenterX = gridWidthN / 2;
const mapCenterY = gridHeightN / 2;
const mapCornerDist = Math.sqrt(mapCenterX * mapCenterX + mapCenterY * mapCenterY);

function seaFieldAt(x, y) {
  const [rx, ry] = [x - mapCenterX, y - mapCenterY].map(v => v * 1.25 / mapCornerDist);
  const q = Math.max(seaCrestQ, rx * rx + ry * ry);
  return jag(q) - 0.7 + (
    jag(x / 103) + jag(y / 109) + jag ((x + y) / 127) + jag((x - y) / 199)
  ) * 0.25
}

// RELIEF, about 0..1. Below lakeBelow is a lake; above it, the land's elevation is how
// far above lakeBelow it is. It sums:
//   regions (hundreds of tiles across): hilliness, 0 in plains to 1 in hill country, and
//     upland, -1 to 1, how high the land lies overall
//   detail (tens of tiles across): hills and hollows scaled by hilliness, on warped
//     coordinates so they don't repeat regularly
const lakeBelow = 0.44;
const reliefBase = 0.52;           // relief of the average plain
const reliefUplandRange = 0.08;    // how much higher uplands are, and lowlands lower
const reliefHillsLift = 0.06;      // hill country also lies a little higher
const reliefPlainsDetail = 0.1;    // share of the full detail left in plains
const hillinessFrom = 0.35;        // the hilliness field's plains (below) ...
const hillinessTo = 0.65;          // ... and hill country (above)

function reliefAt(x, y) {
  const h = (wave(x / 311 + 0.6 * wave(y / 263)) + wave(y / 337 + 0.6 * wave(x / 229))) / 2;
  const t = Math.min(1, Math.max(0, (h - hillinessFrom) / (hillinessTo - hillinessFrom)));
  const hilliness = t * t * (3 - 2 * t);
  const upland = wave(x / 401 + 0.3) + wave(y / 367 + 0.7) - 1;

  const wx = x + 22 * (wave(y / 97 + 0.5 * wave(x / 71)) - 0.5) + 12 * (wave((x + y) / 53) - 0.5);
  const wy = y + 22 * (wave(x / 89 + 0.5 * wave(y / 83)) - 0.5) + 12 * (wave((x - y) / 59) - 0.5);
  const sum = wx + wy;
  const dif = wx - wy;
  const fastNoise = wave(wx / 19) + wave(wy / 23) + wave(sum / 29) + wave(dif / 31); // 0..4
  const slowNoise = (jag(wx / 37) + jag(wy / 41) + jag(sum / 43) + jag(dif / 47)) * 0.3
    + (jag(wx / 53) + jag(wy / 59) + jag(sum / 61) + jag(dif / 67)) * 0.2; // 0..2
  const detail = (fastNoise + slowNoise) / 6 - 0.5; // -0.5..0.5

  return reliefBase + reliefUplandRange * upland + reliefHillsLift * hilliness
    + detail * (reliefPlainsDetail + (1 - reliefPlainsDetail) * hilliness);
}

// The highest relief reliefAt can return. Keep in step with reliefAt.
const reliefHighest = reliefBase + reliefUplandRange + reliefHillsLift + 0.5;

// Elevation above the lakes' level, in relief units (negative: a lake).
function landElevationAt(x, y) {
  return reliefAt(x, y) - lakeBelow;
}

// The terrain of the tile containing (gx, gy): "water", "grass", "dirt" or "stone".
function getTerrainAt(gx, gy) {
  const [x, y] = [gx, gy].map(v => Math.floor(v));
  if (seaFieldAt(x, y) < seaBelow) return "water";
  if (landElevationAt(x, y) < 0) return "water";
  return groundCoverAt(x, y);
}

// GROUND COVER of land, independent of height and all passable: a patch value from four
// smooth waves sampled at a twice-warped position (so region edges meander), plus a
// little tile-scale fringe (so edges are ragged). The highest values are stone, inside
// a band of dirt, among grass.
const coverPatchTiles = 23;   // patch size: the waves' base period, in tiles
const coverWarpTiles = 14;    // how far the broad warp moves a point, at most
const coverFineWarpTiles = 5; // how far the finer warp moves it
const coverFringe = 0.08;     // weight of the tile-scale raggedness
const coverDirtAbove = 0.6;   // patch value above which ground is dirt...
const coverStoneAbove = 0.8;  // ...and stone

function groundCoverAt(x, y) {
  const ox = coverWarpTiles * (wave(y / 37 + 0.5 * wave(x / 53)) + wave((x - y) / 47) - 1);
  const oy = coverWarpTiles * (wave(x / 41 + 0.5 * wave(y / 59)) + wave((x + y) / 61) - 1);
  const wx = x + ox, wy = y + oy;
  const vx = wx + coverFineWarpTiles * (wave(wy / 13) - 0.5);
  const vy = wy + coverFineWarpTiles * (wave(wx / 11) - 0.5);

  const s = coverPatchTiles;
  const patch = (wave(vx / s) + wave(vy / (s * 1.13))
    + wave((vx + vy) / (s * 1.41)) + wave((vx - vy) / (s * 1.73))) / 4;
  const fringe = (jag(x / 3.7) + jag(y / 4.3) + jag((x + y) / 5.9)) / 3;
  const v = patch + coverFringe * (fringe - 0.5);

  if (v > coverStoneAbove) return "stone";
  if (v > coverDirtAbove) return "dirt";
  return "grass";
}

// OBSTACLES: boulders, on land only. They block movement and sight, in two forms:
//   walls, one or two boulders thick, meandering in roughly parallel lines in some
//     regions and broken by gaps. A wall is where jag(u) = 1/2 for a warped coordinate
//     u; jag's slope is constant, so walls keep an even width without measuring it.
//   lone boulders, scattered in some areas, leaving open expanses elsewhere.
// Most tiles are decided by the first test or two.
const wallHalfWidth = 0.085;  // of jag's 0..1 range: about 1.5 tiles thick
const wallRag = 0.03;         // how much the walls' edges wander
const wallWarpTiles = 9;      // how far the walls bend from straight lines
const wallSpacingTiles = 23;  // distance between neighbouring walls in a region
const wallRegionAbove = 0.8;  // walls running one way where the region field is above this...
const wallRegionBelow = 0.2;  // ...and the other way where it is below this
const wallGapTiles = 7;       // spacing of the gaps along walls
const wallGapAbove = 0.75;    // larger: fewer, shorter gaps
const loneBoulderAreaAbove = 0.55; // lone boulders only where this area field is above...
const loneBoulderAbove = 0.8;      // ...and there, larger: fewer of them

// "boulder" if one stands on the tile containing (gx, gy), else null.
function obstacleAt(gx, gy) {
  const x = Math.floor(gx), y = Math.floor(gy);
  return isBoulderSite(x, y) && getTerrainAt(x, y) !== "water" ? "boulder" : null;
}

function isBoulderSite(x, y) {
  const region = (jag(x / 71 + 0.3) + jag(y / 61 + 0.6)) / 2;
  let u = null;
  if (region > wallRegionAbove) {
    u = (x + wallWarpTiles * (wave(y / 17) + 0.6 * wave((x + y) / 29))) / wallSpacingTiles;
  } else if (region < wallRegionBelow) {
    u = (x + y + wallWarpTiles * (wave((x - y) / 19) + 0.6 * wave(y / 31))) / (wallSpacingTiles * 1.3);
  }
  if (u !== null) {
    const rag = jag(x / 2.9) + jag(y / 3.3) - 1;
    if (Math.abs(jag(u) - 0.5) < wallHalfWidth + wallRag * rag
      && jag(x / wallGapTiles) + jag(y / (wallGapTiles * 1.21)) < 2 * wallGapAbove) return true;
  }
  if (jag(x / 43 + 0.2) + jag(y / 37 + 0.7) < 2 * loneBoulderAreaAbove) return false;
  return jag(x / 2.9) + jag(y / 3.3) + jag((x + y) / 4.7) + jag((x - y) / 5.3) > 4 * loneBoulderAbove;
}

// Whether no critter can enter the tile containing (gx, gy).
function isBlockedTile(gx, gy) {
  return obstacleAt(gx, gy) !== null;
}

// How high each kind of obstacle stands above the ground at its tile's center, in levels
// (see TERRAIN HEIGHT). The boulders' rocks are drawn 1.5 to 3 levels tall (12-25 px);
// taken as 3, above a wolf's or a deer's eye, so a boulder hides what is behind it.
const obstacleHeightLevels = { boulder: 3 };

// How high the obstacle on tile (i, j) stands above its ground, in levels (0: none).
function obstacleHeightAt(i, j) {
  const o = obstacleAt(i, j);
  return o ? obstacleHeightLevels[o] : 0;
}

// TERRAIN HEIGHT, in whole levels at tile corners; a tile's surface blends its four
// corners bilinearly. Land rises with its elevation; water, and every corner touching
// water, is level 0. A tile whose corners would differ by 2 levels or more becomes a
// cliff tile: its corners are squeezed into [m, m + 1] (m: the floor of their average),
// so a cliff face stands between it and its neighbours. A critter can step up or down
// at most maxStepLevels. (One level is drawn one block riser high: see animat.js.)
const maxElevation = 14;  // the highest level any terrain could reach; scales all heights
const levelsPerReliefUnit = maxElevation / (reliefHighest - lakeBelow);
const maxStepLevels = 1.5;

function isWaterTile(i, j) {
  return i >= 0 && j >= 0 && i < gridWidthN && j < gridHeightN && getTerrainAt(i, j) === "water";
}

// Corner levels, 4 per tile: NW, NE, SW, SE (NW is the tile's top corner on screen).
const tileCornerLevels = new Int16Array(gridWidthN * gridHeightN * 4);
let maxLevel = 0;
(function computeTerrainHeights() {
  const W = gridWidthN, H = gridHeightN;
  const vertex = new Int16Array((W + 1) * (H + 1)); // level of vertex (i, j) at i * (H + 1) + j
  for (let i = 0; i <= W; i++) for (let j = 0; j <= H; j++) {
    const touchesWater = isWaterTile(i, j) || isWaterTile(i - 1, j)
      || isWaterTile(i, j - 1) || isWaterTile(i - 1, j - 1);
    vertex[i * (H + 1) + j] = touchesWater ? 0
      : Math.max(0, Math.floor(landElevationAt(i, j) * levelsPerReliefUnit));
  }
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    let c = [vertex[i * (H + 1) + j], vertex[(i + 1) * (H + 1) + j],
             vertex[i * (H + 1) + j + 1], vertex[(i + 1) * (H + 1) + j + 1]];
    if (isWaterTile(i, j)) c = [0, 0, 0, 0];
    if (Math.max(...c) - Math.min(...c) >= 2) {
      const m = Math.floor((c[0] + c[1] + c[2] + c[3]) / 4);
      c = c.map(l => Math.min(m + 1, Math.max(m, l)));
    }
    tileCornerLevels.set(c, (i * H + j) * 4);
    maxLevel = Math.max(maxLevel, ...c);
  }
})();

// The corner levels [NW, NE, SW, SE] of tile (i, j), read only; all 0 off the map.
const offMapCorners = new Int16Array(4);
function tileCorners(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return offMapCorners;
  const k = (i * gridHeightN + j) * 4;
  return tileCornerLevels.subarray(k, k + 4);
}

// The ground's height, in levels, at any grid point.
function heightAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  const [nw, ne, sw, se] = tileCorners(i, j);
  const u = gx - i, v = gy - j;
  return nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
}

// Land a swimmer can climb onto: dry, unblocked, and low enough somewhere to step up
// onto from the water.
function isLandTile(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return false;
  const t = getTerrainAt(i, j);
  return t !== "water" && !isBlockedTile(i, j) && Math.min(...tileCorners(i, j)) <= maxStepLevels;
}

// CRITTERS
// Each is a plain object. Directions are indices into
// moveVecByDir, clockwise from grid E.
const nWolves = 10;
const wolves = Array.from({length: nWolves}, () => ({}));
// THE PLAYER'S WOLF: wolves[0] at first. It lives and dies like any wolf; dying, and then
// as a corpse, it stays the player's until the next wolf is born: that newborn becomes the
// player's wolf. Meanwhile the player's intents do nothing.
let pcWolf = wolves[0];
const nDeer = 50;
const deer = Array.from({length: nDeer}, () => ({}));

const allCritters = [];
const allCorpses = [];
const allLandTiles = [];  // every dry, unblocked tile: where critters are placed

// Half the side of an adult's square collision box; each critter's is a.boxRad (see SIZES).
const critterBoxRad = 0.4;

const DIR_E  = 0;
const DIR_SE = 1;
const DIR_S  = 2;
const DIR_SW = 3;
const DIR_W  = 4;
const DIR_NW = 5;
const DIR_N  = 6;
const DIR_NE = 7;
const INVROOT2 = 1 / Math.sqrt(2);
const moveVecByDir = [
  [ 1, 0 ],
  [ INVROOT2, INVROOT2 ],
  [ 0, 1 ],
  [ -INVROOT2, INVROOT2 ],
  [ -1, 0 ],
  [ -INVROOT2, -INVROOT2 ],
  [ 0, -1 ],
  [ INVROOT2, -INVROOT2 ],
];

// The nearest of the 8 directions to (x, y), without trig; defaultDir for (0, 0).
function getDir(x, y, defaultDir = 0) {
  if (x === 0) return y === 0 ? defaultDir : (y > 0 ? DIR_S : DIR_N );
  if (y === 0) return (x > 0 ? DIR_E : DIR_W)
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  // tan(22.5 degrees) ~= 0.414 and tan(67.5 degrees) ~= 2.414
  if (absX >= absY * 2.414) return x > 0 ? DIR_E : DIR_W;
  if (absY >= absX * 2.414) return y > 0 ? DIR_S : DIR_N;
  return x > 0 ? (y > 0 ? DIR_SE : DIR_NE) : (y > 0 ? DIR_SW : DIR_NW);
}

function isLiveCritter(c) {
  return c.kind === "critter" && c.pose !== "death" && c.pose !== "dead";
}

// Every change of pose goes through here: a.poseTick, the tick it started, is all a
// view needs to animate it.
function setPose(a, pose) {
  if (a.pose === pose) return;
  a.pose = pose;
  a.poseTick = g_tick;
}

// A newborn starts fed and unpaired, placed at random until its birth places it.
function initCritter(a, species, isNewborn = false) {
  if (!a) return alert("Falsy ref to initCritter");
  if (a.kind) return alert("Already-kind ref to initCritter");
  a.kind = 'critter';
  a.species = species;
  a.lifespanS = drawLifespanS(species);
  // not newborn: an adult, somewhere between its mating age and half its lifespan
  const adultS = Math.min(canAtAgeBySpecies[species].mate, a.lifespanS / 2);
  a.birthTime = g_now - (isNewborn ? 0 : randBetween(adultS, a.lifespanS / 2));
  a.uid = g_next_uid++;
  a.food = 1;
  setSex(a, Math.random() < 0.5);
  a.mateUid = null;        // its partner (see BREEDING)
  a.matingWith = null;     // ...or whoever it is mating with now
  a.parentUids = [];       // the mother first, if known
  a.youngUids = [];
  a.pregnancy = null;      // { dueAt, fatherUid }
  a.lastBredAt = -Infinity;
  a.speed = 0;
  a.targetSpeed = 0;
  a.wind = 1;
  a.stamina = 1;
  a.nursingOn = null;      // the mother it is suckling from (see BREEDING)
  a.wake = isNewborn ? 1 : randBetween(0.4, 1); // (see SLEEP)
  a.wantsSleep = false;
  a.sleepForced = false;
  a.food = isNewborn ? 1 : species === "wolf" ? wolfStartFood : randBetween(0.5, 1);
  updateBody(a);
  randomlyPlaceCritter(a);
  critterByUid.set(a.uid, a);
  return a;
}

// On a random land tile's center, facing one of the 4 diagonals, standing.
function randomlyPlaceCritter(a) {
  if (!allLandTiles.length) {
    // TODO: for maps over 1M tiles, sample tiles at random instead of listing them all.
    if (gridHeightN * gridWidthN > 1000000) {
      alert("ERORR: randomlyPlaceCritter not implemented yet for maps > 1M tiles");
    }
    for (var i = 0; i < gridWidthN; i++) {
      for (var j = 0; j < gridHeightN; j++) {
        if (getTerrainAt(i, j) !== "water" && !isBlockedTile(i, j)) allLandTiles.push([i, j]);
      }
    }
  }
  const [randLandX, randLandY] = sample(allLandTiles);
  a.gx = randLandX + 0.5;
  a.gy = randLandY + 0.5;
  a.currentDirection = Math.floor(Math.random() * 4) * 2;
  [a.hx, a.hy] = moveVecByDir[a.currentDirection];
  setCritterIdle(a);
}

// Moves any critter placed on top of another, a few times; then removes those still
// overlapping (never the player's wolf).
function forbidOverlapsOnStart() {
  allCritters.forEach(m => {
    m.nextGX = m.gx;
    m.nextGY = m.gy;
  });
  let overlapPairs = findCollidingPairs(allCritters);
  for (let tries = 0; overlapPairs.length && tries < 10; tries++) {
    overlapPairs.forEach(pair =>  {
      const a = allCritters[pair[1]];
      randomlyPlaceCritter(a);
      a.nextGX = a.gx;
      a.nextGY = a.gy;
    });
    overlapPairs = findCollidingPairs(allCritters);
  }
  if (overlapPairs.length) {
    // Indices to objects first: deleting shifts the indices of later pairs.
    const toDelete = new Set();
    overlapPairs.forEach(pair => {
      const idx = pair[1] !== 0 ? pair[1] : pair[0];
      if (idx > 0) toDelete.add(allCritters[idx]);
    });
    toDelete.forEach(c => deleteCritter(c));
    console.log("Initial density too high, reduced start population.");
  }
}

// Removes a critter from play; toCorpse keeps it as a corpse.
function deleteCritter(critter, toCorpse = false) {
  if (!critter) return;
  if (typeof critter !== "object") return alert("invalid arg type to deleteCritter");
  const idx = allCritters.indexOf(critter);
  if (idx === -1) return alert("arg object to deleteCritter not in list");
  endPairing(critter);
  critterByUid.delete(critter.uid);
  if (toCorpse) {
    critter.kind = "corpse";
    setPose(critter, "dead");
    allCorpses.push(critter);
  }
  allCritters.splice(idx, 1);
}

// Old enough to do a capability (a key of lifeStageAgesS).
function _can(a, capability) {
  return ageS(a) >= canAtAgeBySpecies[a.species][capability];
}

// FORCED MORTALITY: each critter dies of age at a.lifespanS old, a share of its
// species' greatest age drawn about normally when it is made. It dies as if killed: its
// death animation, then a corpse.
function drawLifespanS(species) {
  const m = SPEEDS.mortalityRatio[species];
  return aboutNormal(m.mean, m.sd, m.min, m.max) * SPEEDS.forcedMortalityMaxS[species];
}

// A draw about normal with this mean and spread, within [min, max]: the sum of 12
// uniform draws, less 6, is about normal with mean 0 and spread 1.
function aboutNormal(mean, sd, min, max) {
  let z = -6;
  for (let k = 0; k < 12; k++) z += Math.random();
  return Math.min(max, Math.max(min, mean + sd * z));
}

function isPastLifespan(a) {
  return isLiveCritter(a) && g_now - a.birthTime >= a.lifespanS;
}

function startCritterDeath(a) {
  if (!a || a.kind !== "critter") return alert("Invalid arg to startCritterDeath");
  if (a.pose === "death") return;
  endPairing(a);
  a.deathTime = g_now;
  a.speed = a.targetSpeed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  a.eating = false;
  a.nursingOn = null;
  if (a.species === "deer") { // (wolves aren't eaten)
    a.carcass = newCarcass(a);
    a.carcassFullKg = carcassMeatKg(a);
    a.carcassMJPerKg = bodyEnergyMJ(a) / a.carcassFullKg;
  }
  setPose(a, "death");
  enqDelayed("decontrol", deathDurationSBySpecies[a.species], { a: a });
}

// FOOD
// Every critter has a food meter, a.food, 0 (empty) to 1 (full): the energy its body holds
// (see BODY). It empties over SPEEDS.foodFullS and fills by eating: a deer the grass on its
// tile (grassMJPerKg), a wolf a carcass in reach, once old enough to "eat" (and an infant
// by nursing: see BREEDING). A critter whose meter empties dies of hunger.
//
// GRASS: every grass tile holds grass, in kg: at most SPEEDS.grassMaxKg (under a boulder,
// rockGrassShare of that: grassMostAt), starting at grassStartShare of that, regrowing at
// SPEEDS.grassRegrowKgPerS. Its HEIGHT (bare, short, medium, tall) is for the view; tiles
// whose height changes are logged (grassChangesSince) so the view redraws only those.
// UNDER A BOULDER: a deer eats grass under a boulder it stands right beside
// (inGrassReach), turning to face it: the EAT intent with `at`, the boulder's tile. It
// eats at the same rate, so the little there is goes in a third of the time.
//
// CARCASSES: a dead deer's meat is its body's food at its death (edibleKg: its fat and lean
// tissue, so a starved deer is a poor meal), c.carcassFullKg, in 8 pieces, each kg of it
// worth c.carcassMJPerKg. Like any corpse, it is gone SPEEDS.corpseLastsS after the death,
// and never blocks the way (see COLLISIONS). Wolves eat one piece until it is gone,
// then another picked at random from those left (c.eatingPiece is shared by every wolf
// at the carcass). The view shows each piece as meat until all of it is eaten.
const carcassPieces = [ // name, share of the meat
  ["hips", 0.20],
  ["midback", 0.14],
  ["chest", 0.16],
  ["head", 0.10],
  ["skyHind", 0.12], ["groundHind", 0.12], // the legs on top ("sky") and underneath
  ["skyFore", 0.08], ["groundFore", 0.08],
];
// Just below mind.js's wolfHuntBelow (keep in step), so every wolf hunts from the start.
const wolfStartFood = 0.74;
const eatReachTiles = 1.3;      // center to center
const grassGrowEveryTicks = 60;
const grassStartShare = 1 / 10; // the least that is still drawn short
const grassTallFrom = 2 / 3, grassMediumFrom = 1 / 3, grassShortFrom = 1 / 10; // shares of the most
const rockGrassShare = 1 / 3;    // the most grass under a boulder, of the most anywhere
const rockGrassReachTiles = 0.35; // a deer's box this near a boulder's tile reaches its grass

function newCarcass(a) {
  const kg = edibleKg(a);
  return Object.fromEntries(carcassPieces.map(([name, share]) => [name, share * kg]));
}

function carcassMeatKg(c) {
  return c.carcass ? carcassPieces.reduce((sum, [name]) => sum + c.carcass[name], 0) : 0;
}

// By tile index (i * gridHeightN + j): grass in kg, NaN where the terrain isn't grass;
// and its height, 0 bare to 3 tall, 255 where not grass.
let grassKg = null, grassHeight = null, grassMostKg = null;
const grassChanges = [];   // tile indices whose height changed, oldest first
let grassChangesBase = 0;  // the serial number of grassChanges[0]

function heightOfGrass(kg) {
  const share = kg / SPEEDS.grassMaxKg;
  return share >= grassTallFrom ? 3 : share >= grassMediumFrom ? 2 : share >= grassShortFrom ? 1 : 0;
}

function initGrass() {
  grassKg = new Float32Array(gridWidthN * gridHeightN).fill(NaN);
  grassHeight = new Uint8Array(gridWidthN * gridHeightN).fill(255);
  grassMostKg = new Float32Array(gridWidthN * gridHeightN);
  for (let i = 0; i < gridWidthN; i++) for (let j = 0; j < gridHeightN; j++) {
    if (getTerrainAt(i, j) !== "grass") continue;
    const k = i * gridHeightN + j;
    grassMostKg[k] = SPEEDS.grassMaxKg * (isBlockedTile(i, j) ? rockGrassShare : 1);
    grassKg[k] = grassStartShare * SPEEDS.grassMaxKg;
    grassHeight[k] = heightOfGrass(grassKg[k]);
  }
}

function setGrassKg(k, kg) {
  grassKg[k] = kg;
  const h = heightOfGrass(kg);
  if (h !== grassHeight[k]) {
    grassHeight[k] = h;
    grassChanges.push(k);
    if (grassChanges.length > 50000) { // drop the older half
      grassChanges.splice(0, 25000);
      grassChangesBase += 25000;
    }
  }
}

function growGrass(dtS) {
  const add = SPEEDS.grassRegrowKgPerS * dtS;
  for (let k = 0; k < grassKg.length; k++) {
    const kg = grassKg[k], most = grassMostKg[k];
    if (kg < most) setGrassKg(k, Math.min(most, kg + add)); // (false for NaN: not grass)
  }
}

// The most grass tile (i, j) can hold, kg (0 where it isn't grass).
function grassMostAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  return grassMostKg[i * gridHeightN + j];
}

// Whether critter a stands right beside the boulder on tile (i, j), so it can reach the
// grass under it: its box within rockGrassReachTiles of the tile.
function inGrassReach(a, i, j) {
  if (!isBlockedTile(i, j)) return false;
  const gap = Math.max(Math.abs(i + 0.5 - a.gx), Math.abs(j + 0.5 - a.gy)) - 0.5;
  return gap <= a.boxRad + rockGrassReachTiles;
}

// The grass on tile (i, j), in kg; 0 where it isn't grass.
function grassFoodAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  const kg = grassKg[i * gridHeightN + j];
  return kg === kg ? kg : 0;
}

// The height of the grass on tile (i, j): 0 bare, 1 short, 2 medium, 3 tall; -1 if not grass.
function grassHeightAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return -1;
  const h = grassHeight[i * gridHeightN + j];
  return h === 255 ? -1 : h;
}

// The tiles whose grass height changed since `serial` (0 at first, then the serial the
// last call returned): { serial, tiles: [[i, j], ...] }. tiles is null when the log no
// longer reaches back that far: then every tile may have changed.
function grassChangesSince(serial) {
  const end = grassChangesBase + grassChanges.length;
  if (serial < grassChangesBase) return { serial: end, tiles: null };
  const tiles = grassChanges.slice(serial - grassChangesBase)
    .map(k => [Math.floor(k / gridHeightN), k % gridHeightN]);
  return { serial: end, tiles };
}

// The nearest corpse within a's reach with meat left, or null.
function carcassInReach(a) {
  let best = null, bestL2 = eatReachTiles * eatReachTiles;
  for (const c of allCorpses) {
    if (!c.carcass) continue;
    const l2 = (c.gx - a.gx) ** 2 + (c.gy - a.gy) ** 2;
    if (l2 <= bestL2 && carcassMeatKg(c) > 0) { best = c; bestL2 = l2; }
  }
  return best;
}

// One tick of a's meter: it empties a little, and fills if a is eating. True if a starved.
function updateFood(a) {
  if (!isLiveCritter(a)) return false;
  const lasts = isInfant(a) ? SPEEDS.infantFoodFullS : SPEEDS.foodFullS;
  a.food = Math.max(0, a.food - tempo / lasts[a.species]);
  a.nursingOn = a.eating && isInfant(a) ? nurse(a) : null;
  if (a.eating && a.nursingOn === null && _can(a, "eat")) {
    const room = roomMJ(a);
    let bite = SPEEDS.eatKgPerS[a.species] * tempo;
    if (a.species === "deer") {
      let i = Math.floor(a.gx), j = Math.floor(a.gy);
      if (a.eatAt && inGrassReach(a, a.eatAt[0], a.eatAt[1])) { // grass under a boulder beside it
        [i, j] = a.eatAt;
        a.currentDirection = getDir(i + 0.5 - a.gx, j + 0.5 - a.gy, a.currentDirection);
      }
      const k = i * gridHeightN + j;
      const kg = grassFoodAt(i, j);
      const take = Math.min(bite, kg, room / grassMJPerKg);
      if (take > 0 && !isInWater(a)) {
        setGrassKg(k, kg - take);
        feed(a, take * grassMJPerKg);
      }
    } else {
      const c = carcassInReach(a);
      let roomKg = c ? room / c.carcassMJPerKg : 0;
      while (c && bite > 0 && roomKg > 0) {
        if (!(c.carcass[c.eatingPiece] > 0)) {
          const left = carcassPieces.filter(([name]) => c.carcass[name] > 0);
          if (!left.length) break;
          c.eatingPiece = left[Math.floor(Math.random() * left.length)][0];
        }
        const name = c.eatingPiece, take = Math.min(bite, c.carcass[name], roomKg);
        c.carcass[name] -= take;
        if (c.carcass[name] < 1e-9) c.carcass[name] = 0;
        feed(a, take * c.carcassMJPerKg);
        bite -= take; roomKg -= take;
      }
    }
  }
  growFromFood(a, tempo);
  updateBody(a);
  return a.food <= 0;
}

// BODY: a critter is its skeleton (a.skeletonKg) and the food its body holds, fat and
// protein (dry kg), each carrying water: fat none, protein the rest of the body's
// (leanWaterPerKg). At a full meter it holds bodySharesBySpecies of each, as a share of a
// whole body, for its skeleton; so its weight (a.weightKg) at a full meter is its
// skeleton over the skeleton's share, and less as it goes hungry. Published adult
// weights (a.adultKg) are taken as full meters. Its food value is their energy (fatMJPerKg,
// proteinMJPerKg). Its meter is the share of the energy it holds above the lethal point
// (no fat, lethalProteinShare of its protein): fat and protein are spent, and laid down
// again, together.
// GROWTH: the skeleton only grows by eating: from its birth weight's share to its adult
// weight's, it takes a share of the energy of all it eats or suckles (skeletonMJPerKg a kg
// of bone), so that a critter eating as it uses, and as it grows, follows a well-fed
// critter's growth (growthSharesBySpecies at SPEEDS.growthAgesS). It never shrinks. Its
// new tissue holds food as full as the rest: that too comes from what it eats, at
// SPEEDS.growthCostShare (with skeletonMJPerKg). What it eats for growing is laid down
// over time (a.growingKg, still to grow), at most growFastestRatio times as fast as a
// well-fed critter grows (growFromFood), so a meal never makes it grow at a stroke.
const skeletonMJPerKg = 4; // estimate: bone's protein, and laying down its mineral
const growFastestRatio = 2; // the fastest it grows, over a well-fed critter's pace (estimate)
const bodyPerSkeletonKg = Object.fromEntries(Object.entries(bodySharesBySpecies).map(([sp, b]) => [sp, {
  fat: b.fat / b.skeleton, protein: b.protein / b.skeleton,
  leanWaterPerKg: (1 - b.fat - b.protein - b.skeleton) / b.protein,
}]));

// MJ a kg of skeleton holds, from empty to full and at empty (the lethal point).
function energyRangePerKg(species) {
  const b = bodySharesBySpecies[species];
  return (b.fat * fatMJPerKg + b.protein * (1 - lethalProteinShare) * proteinMJPerKg) / b.skeleton;
}
function energyFloorPerKg(species) {
  const b = bodySharesBySpecies[species];
  return b.protein * lethalProteinShare * proteinMJPerKg / b.skeleton;
}

function energyRangeMJ(a) { return energyRangePerKg(a.species) * a.skeletonKg; }
function roomMJ(a) { return (1 - a.food) * energyRangeMJ(a); }

// Its fat and protein, dry kg.
function fatKg(a) { return a.food * bodyPerSkeletonKg[a.species].fat * a.skeletonKg; }
function proteinKg(a) {
  return (lethalProteinShare + (1 - lethalProteinShare) * a.food) * bodyPerSkeletonKg[a.species].protein * a.skeletonKg;
}
// Its fat and lean tissue (with their water), kg: what a wolf eats of it, dead.
function edibleKg(a) { return fatKg(a) + proteinKg(a) * (1 + bodyPerSkeletonKg[a.species].leanWaterPerKg); }
function bodyWeightKg(a) { return edibleKg(a) + a.skeletonKg; }
function bodyEnergyMJ(a) { return fatKg(a) * fatMJPerKg + proteinKg(a) * proteinMJPerKg; }

// Its sex, and the skeletons that go with it: a newborn's, or its age's (well fed).
function setSex(a, isMale) {
  a.isMale = isMale;
  const sex = isMale ? "male" : "female", kg = bodyKgBySpecies[a.species], share = bodySharesBySpecies[a.species].skeleton;
  a.adultKg = kg[sex];
  a.birthSkeletonKg = kg.birth[sex] * share;
  a.adultSkeletonKg = kg[sex] * share;
  setSkeletonByAge(a);
}

// Critter a takes in mj of food: a share grows its skeleton, the rest fills its meter (up
// to full; the rest is lost).
function feed(a, mj) {
  if (a.skeletonKg < a.adultSkeletonKg) {
    // a well-fed critter's skeleton growth now (kg a second), and what it eats meanwhile
    const v = growthKgPerS(a);
    const range = energyRangePerKg(a.species), floor = energyFloorPerKg(a.species);
    const lasts = isInfant(a) ? SPEEDS.infantFoodFullS : SPEEDS.foodFullS;
    const share = SPEEDS.growthCostShare;
    const eats = range * a.skeletonKg / lasts[a.species] + v * (range + floor + skeletonMJPerKg) * share;
    const grow = Math.min(mj * v / eats, a.adultSkeletonKg - a.skeletonKg - a.growingKg);
    if (grow > 0) { // its new bone, and the food it will hold as full as the rest
      a.growingKg += grow;
      mj -= grow * (floor + a.food * range + skeletonMJPerKg) * share;
    }
  }
  a.food = Math.min(1, a.food + mj / energyRangeMJ(a));
}

// dt seconds of a laying down what it ate for growing.
function growFromFood(a, dt) {
  if (!(a.growingKg > 0)) return;
  const kg = Math.min(a.growingKg, growFastestRatio * growthKgPerS(a) * dt);
  a.skeletonKg += kg;
  a.growingKg -= kg;
}

// How fast a well-fed critter's skeleton grows at a's size, kg a second.
function growthKgPerS(a) {
  const ages = SPEEDS.growthAgesS[a.species], shares = growthSharesBySpecies[a.species];
  const p = growthProgress(a);
  let k = 1;
  while (k < shares.length - 1 && shares[k] <= p) k++;
  return (shares[k] - shares[k - 1]) / (ages[k] - ages[k - 1]) * (a.adultSkeletonKg - a.birthSkeletonKg);
}

// DAY AND NIGHT: the map lies at latitudeDeg north. A day lasts SPEEDS.dayLengthS and a
// year 365 days; the game starts at startHour on the spring equinox. The sun's height
// follows the Earth's tilt (tiltDeg) by the day of the year, so days are long in summer
// and short in winter (at 45 degrees north, about 15.4 and 8.6 hours from sunrise to
// sunset). The LIGHT is 1 while the sun is up, 0 once it is twilightDeg below the horizon
// (the end of civil twilight), and between in the twilight. All of it is worked out once a
// tick (clock); comparing sines takes no inverse trig.
// GRASS grows only while the sun is up, faster by 1 / meanDaylightShare, so a year's
// growth is as before.
const latitudeDeg = 45, tiltDeg = 23.44, twilightDeg = 6;
const yearDays = 365;
const equinoxDay = 79;   // the spring equinox, as a day of the year (0 = 1 January)
const startHour = 8;
const degree = Math.PI / 180;
const sinLat = Math.sin(latitudeDeg * degree), cosLat = Math.cos(latitudeDeg * degree);
const sinTwilight = Math.sin(-twilightDeg * degree);
const clock = { day: 0, dayOfYear: equinoxDay, hour: startHour, light: 1, sunUp: true, daylightHours: 12 };

// The sun's declination on day d of the year, and how many hours it is up that day.
function declinationAt(d) { return tiltDeg * degree * Math.sin(2 * Math.PI * (d - equinoxDay) / yearDays); }
function daylightHoursAt(d) {
  const x = -Math.tan(latitudeDeg * degree) * Math.tan(declinationAt(d));
  return x <= -1 ? 24 : x >= 1 ? 0 : 24 * Math.acos(x) / Math.PI;
}
// the share of a whole year the sun is up (about a half)
const meanDaylightShare = Array.from({ length: yearDays }, (_, d) => daylightHoursAt(d)).reduce((p, q) => p + q) / (24 * yearDays);

// For tests: hold the clock at an hour of the starting day (null: let it run), and turn
// the need for sleep off (every meter kept full) or on.
let heldHour = null, needSleep = true;
function holdClock(hour) { heldHour = hour; updateClock(); }
function setNeedSleep(on) {
  needSleep = on;
  if (on) return;
  for (const a of allCritters) { // all awake, and staying so
    a.wake = 1; a.wantsSleep = a.sleepForced = false;
    if (a.pose === "sleep") setPose(a, "idle");
  }
}

function updateClock() {
  const days = heldHour !== null ? equinoxDay + heldHour / 24 : (equinoxDay + startHour / 24) + g_now / SPEEDS.dayLengthS;
  const dayOfYear = days % yearDays, hour = 24 * (days % 1);
  const decl = declinationAt(dayOfYear);
  const sinEl = sinLat * Math.sin(decl) + cosLat * Math.cos(decl) * Math.cos(2 * Math.PI * (hour - 12) / 24);
  clock.day = Math.floor(days - equinoxDay); // days since the first midnight
  clock.dayOfYear = dayOfYear;
  clock.hour = hour;
  clock.sunUp = sinEl > 0;
  clock.light = sinEl >= 0 ? 1 : sinEl <= sinTwilight ? 0 : 1 - sinEl / sinTwilight;
  if (Math.floor(dayOfYear) !== clock.daylightDay) {
    clock.daylightDay = Math.floor(dayOfYear);
    clock.daylightHours = daylightHoursAt(dayOfYear);
  }
}

// SLEEP: every critter has a wakeful meter, a.wake, 0 to 1: how long until it must sleep.
// Awake, it empties over SPEEDS.wakeLastsS; asleep (the "sleep" pose, lying down), it
// fills over SPEEDS.sleepFillS. The SLEEP intent lies it down once stopped, on land; any
// other intent gets it up. At empty it COLLAPSES: it stops and falls asleep where it is
// (in the water, as soon as it is ashore), and sleeps on whatever its intent until the
// meter is back to forcedWakeAt (a.sleepForced meanwhile).
const forcedWakeAt = 0.3;

function updateWake(a) {
  if (!isLiveCritter(a)) return;
  if (!needSleep) { a.wake = 1; return; }
  if (a.pose === "sleep") {
    a.wake = Math.min(1, a.wake + tempo / SPEEDS.sleepFillS[a.species]);
    if (a.sleepForced && a.wake >= forcedWakeAt) a.sleepForced = false;
    return;
  }
  a.wake = Math.max(0, a.wake - tempo / SPEEDS.wakeLastsS[a.species]);
  if (a.wake <= 0 && !a.sleepForced && !isMating(a) && !isInWater(a)) {
    a.sleepForced = true;
    a.eating = false;
    a.landPose = "idle"; a.targetSpeed = 0; // (as setCritterIdle, which a collapsed critter ignores)
  }
  if ((a.wantsSleep || a.sleepForced) && a.speed === 0 && a.pose === "idle" && !isInWater(a)) {
    a.nextGX = a.gx; a.nextGY = a.gy;
    setPose(a, "sleep");
  }
}

// SCENT AND WIND
// SCENT TRAILS: every live critter on dry land marks the tile under it with its species'
// scent each tick: the tile keeps when it was last marked by each species, and by whom.
// Scent fades: at age t its strength is 2^(-t / SPEEDS.scentHalfLifeS) (senses.js decides
// how faint a scent each critter can still smell). Water holds no scent.
// WIND: one breeze over the whole map, blowing toward the unit vector (windX, windY); every
// SPEEDS.windChangeEveryS it turns by up to windTurnMaxRad either way. It carries critters'
// scent downwind (see senses.js).
const scentSpecies = ["wolf", "deer"];
const windTurnMaxRad = Math.PI / 6;
let scentTime = null, scentUid = null; // by species: by tile index, game time and uid of the last mark
let windAngle = Math.random() * 2 * Math.PI;
let windX = Math.cos(windAngle), windY = Math.sin(windAngle);

function initScent() {
  scentTime = {}; scentUid = {};
  for (const sp of scentSpecies) {
    scentTime[sp] = new Float64Array(gridWidthN * gridHeightN).fill(-Infinity);
    scentUid[sp] = new Int32Array(gridWidthN * gridHeightN).fill(-1);
  }
}

function markScent() {
  for (const a of allCritters) {
    if (!isLiveCritter(a) || isInWater(a)) continue;
    const i = Math.floor(a.gx), j = Math.floor(a.gy);
    if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) continue;
    const k = i * gridHeightN + j;
    scentTime[a.species][k] = g_now;
    scentUid[a.species][k] = a.uid;
  }
}

// The latest scent of species on tile (i, j): { ageS, uid }, or null if none.
function scentAt(i, j, species) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const k = i * gridHeightN + j, t = scentTime[species][k];
  return t === -Infinity ? null : { ageS: g_now - t, uid: scentUid[species][k] };
}

function shiftWind() {
  setWind(windAngle + (Math.random() * 2 - 1) * windTurnMaxRad);
}

// The wind blows toward angle (radians, from grid E toward grid S).
function setWind(angle) {
  windAngle = angle;
  windX = Math.cos(windAngle);
  windY = Math.sin(windAngle);
}

// BREEDING
// Every critter is male or female (a.isMale). Once old enough to "mate" (grown), two
// unpaired critters of one species and opposite sexes pair by mating: both intend to
// mate with each other ({ gait: "mate", with: uid }), stand still on land within
// mateReachTiles, and then mate (pose "mate", facing each other, for the species'
// mateActS; nothing else moves them meanwhile). A pair (a.mateUid) lasts until one dies,
// and its two mate only with each other. On pairing, each adopts the other's young not
// yet grown (a.parentUids, a.youngUids).
// A female is in heat (inHeat) while fertile (grown and not past her maxFertileAgeS), not
// pregnant, and a year (intervalS) after she last mated in heat (a.lastBredAt). Mated
// while in heat, her heat is spent; by a fertile male (not past his maxFertileAgeS), she
// conceives, and after gestationS, once on land, gives birth beside herself:
// a litter (litterBySpecies) whose parents are her, the father and her partner, while
// alive; young that don't fit within birthSearchTiles of her are stillborn.
// GROWTH: see BODY.
// NURSING: an infant's (not yet weaned) meter empties in SPEEDS.infantFoodFullS. Eating
// (the EAT intent) while touching its mother (boxes within nurseContactTiles), neither in
// water, it suckles instead of eating anything else: its meter fills in SPEEDS.nurseFullS,
// and a.nursingOn is her uid (else null). The milk's energy leaves her meter, over
// milkEfficiency; her share still falls by far less than its share rises (her meter
// holds far more). She keeps nurseMotherMinFood of her own.
// The mind (mind.js) decides who courts whom; the simulation only checks that a pairing
// is possible (canPair).

// Shares of the way from birth to adult skeleton at SPEEDS.growthAgesS, for a well-fed
// critter (see BODY and GAME SPEEDS).
const growthSharesBySpecies = {
  wolf: [0, 0.06, 0.19, 0.73, 1],
  deer: [0, 0.35, 0.5, 0.75, 1],
};
// Litter size: base plus one for each of `tries` that comes up with `chance`. Wolf: mean
// 5.5, 1 to 11; red deer: a calf, twins rarely (estimate).
const litterBySpecies = {
  wolf: { base: 1, tries: 10, chance: 0.45 },
  deer: { base: 1, tries: 1, chance: 0.005 },
};
const mateReachTiles = 1.5;   // center to center
const nurseContactTiles = 0.15; // the most gap between boxes that still counts as touching
const nurseMotherMinFood = 0.25;
const birthSearchTiles = 3;
const critterByUid = new Map(); // every critter in play (not corpses)

// Its age, which stops at its death.
function ageS(a) { return (a.deathTime ?? g_now) - a.birthTime; }
function isGrown(a) { return _can(a, "mate"); }
function isInfant(a) { return !_can(a, "wean"); }
function isMating(a) { return a.pose === "mate"; }

function isFertile(a) {
  return isGrown(a) && ageS(a) <= SPEEDS.breeding[a.species].maxFertileAgeS[a.isMale ? "male" : "female"];
}

function inHeat(a) {
  return !a.isMale && isFertile(a) && !a.pregnancy
    && g_now - a.lastBredAt >= SPEEDS.breeding[a.species].intervalS;
}

// Whether a and b may mate: grown, of one species and opposite sexes, and both unpaired
// or paired to each other.
function canPair(a, b) {
  return a !== b && isLiveCritter(a) && isLiveCritter(b) && a.species === b.species
    && a.isMale !== b.isMale && isGrown(a) && isGrown(b)
    && (a.mateUid === null && b.mateUid === null || a.mateUid === b.uid && b.mateUid === a.uid);
}

function growthShare(species, age) {
  const ages = SPEEDS.growthAgesS[species], shares = growthSharesBySpecies[species];
  if (age >= ages[ages.length - 1]) return 1;
  let k = 1;
  while (ages[k] <= age) k++;
  return shares[k - 1] + (shares[k] - shares[k - 1]) * (age - ages[k - 1]) / (ages[k] - ages[k - 1]);
}

// Its skeleton as a well-fed critter's of its age (for critters placed at the start, and
// tests).
function setSkeletonByAge(a) {
  a.skeletonKg = a.birthSkeletonKg + (a.adultSkeletonKg - a.birthSkeletonKg) * growthShare(a.species, Math.max(0, ageS(a)));
  a.growingKg = 0;
  updateBody(a);
}

// Its weight and collision box, after its meter or skeleton changed.
function updateBody(a) {
  a.weightKg = bodyWeightKg(a);
  const stage = youngStage(a);
  a.boxRad = stage && stage <= smallBoxStages ? critterBoxRad * youngScales[stage - 1] : critterBoxRad;
}

// SIZES: by its skeleton's share of the way from birth to adult (growthProgress), taken as
// its size cubed, in one of 5 classes: young stages 1 (smallest, every newborn) to 4,
// sized youngScales of an adult, or adult (0).
// Each stage starts halfway (in size) from the one below; the thresholds are cubed, so no
// cube root is taken. The view draws each class from its own sprite set (animat.js, YOUNG
// STAGES). The smallest smallBoxStages stages have collision boxes (a.boxRad) shrunk to
// their size, so a litter or a calf hems its parents in less.
const youngScales = [0.3, 0.45, 0.6, 0.8];
const youngStageBelowShare = youngScales.map((s, k) => ((s + (youngScales[k + 1] ?? 1)) / 2) ** 3);
const smallBoxStages = 2;

// 1 (smallest) to 4, or 0 for adult size.
function youngStage(a) {
  const share = growthProgress(a);
  for (let k = 0; k < youngStageBelowShare.length; k++) if (share < youngStageBelowShare[k]) return k + 1;
  return 0;
}

// 0 at birth to 1 grown.
function growthProgress(a) {
  return (a.skeletonKg - a.birthSkeletonKg) / (a.adultSkeletonKg - a.birthSkeletonKg);
}

// One tick of infant a suckling, if it is touching its mother: her uid, or null.
function nurse(a) {
  const mother = critterByUid.get(a.parentUids[0]);
  if (!mother || !isLiveCritter(mother) || isInWater(a) || isInWater(mother)) return null;
  const reach = a.boxRad + mother.boxRad + nurseContactTiles;
  if (Math.abs(mother.gx - a.gx) > reach || Math.abs(mother.gy - a.gy) > reach) return null;
  const mj = Math.min(energyRangeMJ(a) * tempo / SPEEDS.nurseFullS[a.species], roomMJ(a),
    (mother.food - nurseMotherMinFood) * energyRangeMJ(mother) * milkEfficiency);
  if (!(mj > 0)) return null;
  mother.food -= mj / milkEfficiency / energyRangeMJ(mother);
  feed(a, mj);
  return mother.uid;
}

// Starts every mating that both critters intend and that can happen now.
function startMatings() {
  for (const [a, intent] of intents) {
    if (intent.gait !== "mate" || (a === pcWolf && playerIntent)) continue;
    const b = critterByUid.get(intent.with);
    if (!b || a.uid > b.uid) continue; // each pair once
    const theirs = b === pcWolf && playerIntent ? null : intents.get(b);
    if (!theirs || theirs.gait !== "mate" || theirs.with !== a.uid) continue;
    if (!canPair(a, b) || isMating(a) || isMating(b)) continue;
    if (a.speed > 0 || b.speed > 0 || a.stunnedUntil > g_tick || b.stunnedUntil > g_tick) continue;
    if (isInWater(a) || isInWater(b)) continue;
    if ((a.gx - b.gx) ** 2 + (a.gy - b.gy) ** 2 > mateReachTiles * mateReachTiles) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      x.eating = false;
      x.matingWith = y.uid;
      x.nextGX = x.gx;
      x.nextGY = x.gy;
      setPose(x, "mate");
      x.currentDirection = getDir(y.gx - x.gx, y.gy - x.gy, x.currentDirection);
    }
    enqDelayed("mated", SPEEDS.breeding[a.species].mateActS, { a, b });
  }
}

// The end of a mating act: if both lived through it, they are a pair, and the female may
// conceive.
function finishMating(a, b) {
  const bothLive = isMating(a) && isMating(b) && a.matingWith === b.uid && b.matingWith === a.uid;
  for (const x of [a, b]) {
    if (x.matingWith !== (x === a ? b : a).uid) continue;
    x.matingWith = null;
    intents.delete(x); // done: it waits for its next decision
    if (isMating(x)) setPose(x, "idle");
  }
  if (!bothLive) return;
  if (a.mateUid === null) pair(a, b);
  const [female, male] = a.isMale ? [b, a] : [a, b];
  if (!inHeat(female)) return;
  female.lastBredAt = g_now; // her heat is spent, conceiving or not
  if (isFertile(male)) conceive(female, male);
}

function pair(a, b) {
  a.mateUid = b.uid;
  b.mateUid = a.uid;
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const uid of x.youngUids) {
      const c = critterByUid.get(uid);
      if (!c || isGrown(c) || c.parentUids.includes(y.uid)) continue;
      c.parentUids.push(y.uid);
      y.youngUids.push(uid);
    }
  }
}

function conceive(female, male) {
  const g = SPEEDS.breeding[female.species].gestationS;
  const dueIn = aboutNormal(g.avg, (g.max - g.min) / 4, g.min, g.max);
  female.pregnancy = { dueAt: g_now + dueIn, fatherUid: male.uid };
}

// On a death: the partner is free to pair again, and any pregnancy ends.
function endPairing(a) {
  const p = a.mateUid !== null ? critterByUid.get(a.mateUid) : null;
  if (p && p.mateUid === a.uid) p.mateUid = null;
  a.mateUid = null;
  a.pregnancy = null;
}

function litterSize(species) {
  const l = litterBySpecies[species];
  let n = l.base;
  for (let k = 0; k < l.tries; k++) if (Math.random() < l.chance) n++;
  return n;
}

// Offsets of whole tiles around a mother, nearest first: young placed at these are at
// least a tile apart, so never overlap each other.
const birthOffsets = [];
for (let di = -birthSearchTiles; di <= birthSearchTiles; di++)
  for (let dj = -birthSearchTiles; dj <= birthSearchTiles; dj++)
    if (di || dj) birthOffsets.push([di, dj]);
birthOffsets.sort((p, q) => (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1]));

// Up to n places for newborns around female f: dry land she could walk straight to,
// clear of every critter and corpse.
function birthSpots(f, n) {
  const others = allCritters.concat(allCorpses), spots = [];
  for (const [di, dj] of birthOffsets) {
    if (spots.length >= n) break;
    const x = f.gx + di, y = f.gy + dj;
    if (isWaterAt(x, y) || !canStepTo(f, x, y)) continue;
    // (as if the newborn were adult-sized)
    if (others.some(c => Math.abs(c.gx - x) < critterBoxRad + c.boxRad && Math.abs(c.gy - y) < critterBoxRad + c.boxRad)) continue;
    spots.push([x, y]);
  }
  return spots;
}

function giveBirth(f) {
  const { fatherUid } = f.pregnancy;
  f.pregnancy = null;
  const parents = [f.uid];
  for (const uid of [fatherUid, f.mateUid]) {
    const p = critterByUid.get(uid);
    if (p && isLiveCritter(p) && !parents.includes(uid)) parents.push(uid);
  }
  for (const [x, y] of birthSpots(f, litterSize(f.species))) {
    const c = initCritter({}, f.species, true);
    c.gx = c.nextGX = x;
    c.gy = c.nextGY = y;
    c.parentUids = parents.slice();
    for (const uid of parents) critterByUid.get(uid).youngUids.push(c.uid);
    allCritters.push(c);
    if (c.species === "wolf" && !isLiveCritter(pcWolf)) pcWolf = c; // the player's new wolf
  }
}

// INTENTS
// The simulation decides nothing: each critter does what its intent says, applied at the
// start of every tick (so nothing changes while paused), within what the world allows.
// A mind sets intents for any critter; the player's intent for the player's wolf wins
// while the player has control.
//   null                   carry on as it is
//   { gait: "idle" }       stand still (in water: swim on; see SWIMMING)
//   { gait: "eat" }        stand still and eat what is there (see FOOD)
//   { gait: "eat", at }    a deer: the same, the grass under the boulder on tile at, [i, j],
//                          when right beside it (see GRASS)
//   { gait: "mate", with } stand still, ready to mate with critter uid `with` (see BREEDING)
//   { gait: "sleep" }      stop, lie down and sleep (see SLEEP)
//   { dx, dy, gait }       move along grid vector (dx, dy), any length, at walk, trot or
//                          gallop, or the best gait wind and stamina allow
//   { dir, gait }          the same along one of the 8 directions
// HEADINGS: a moving critter goes along (a.hx, a.hy), a unit vector. An intent's vector
// is scaled to unit length when it is set (the only square root), and setting the same
// vector again reuses it. The sprite faces the nearest of 8 directions
// (a.currentDirection) but keeps its facing while the heading is within facingKeepCos of
// it, so a heading near a boundary doesn't flip the sprite.
// STUNNED: a move that fails (another live critter, a boulder, a cliff, the map's
// edge, or water for a tired critter) leaves the critter at its last legal position,
// stopped, for stunMinS to stunMaxS; its intent waits. a.blockedTick and a.stunnedUntil
// record when, for whoever decides.
const intents = new Map(); // critter -> its prepared intent
let playerIntent = null;
let playerIntentApplied = false; // whether the player was in control last tick
const facingKeepCos = 0.866;     // cos 30 degrees

// The intent with its heading (hx, hy) at unit length, reusing prev's for the same vector.
function prepareIntent(intent, prev) {
  if (!intent || intent.gait === "idle" || intent.gait === "eat" || intent.gait === "mate" || intent.gait === "sleep") return intent || null;
  if (intent.dir !== undefined) {
    const [hx, hy] = moveVecByDir[intent.dir];
    return { dir: intent.dir, gait: intent.gait, hx, hy };
  }
  const { dx, dy } = intent;
  if (prev && prev.dx === dx && prev.dy === dy && prev.hx !== undefined)
    return { dx, dy, gait: intent.gait, hx: prev.hx, hy: prev.hy };
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return { gait: "idle" };
  const inv = 1 / Math.sqrt(len2);
  return { dx, dy, gait: intent.gait, hx: dx * inv, hy: dy * inv };
}

function setIntent(a, intent) {
  if (intent) intents.set(a, prepareIntent(intent, intents.get(a)));
  else intents.delete(a);
}

function setPlayerIntent(intent) {
  playerIntent = prepareIntent(intent, playerIntent);
}

function playerHasControl() {
  return playerIntent !== null;
}

function applyIntent(a, intent) {
  if (a.stunnedUntil > g_tick || isMating(a) || a.sleepForced) return;
  if (intent.gait === "sleep") { // lies down once stopped (see SLEEP)
    if (!a.wantsSleep) { a.eating = false; setCritterIdle(a); a.wantsSleep = true; }
    return;
  }
  a.wantsSleep = false;
  a.eating = intent.gait === "eat";
  a.eatAt = a.eating && intent.at || null;
  if (intent.gait === "idle" || intent.gait === "eat" || intent.gait === "mate") setCritterIdle(a);
  else setCritterHeading(a, intent.hx, intent.hy, intent.gait, intent.dir);
}

function applyIntents() {
  for (const [a, intent] of intents) {
    if (!isLiveCritter(a)) { intents.delete(a); continue; }
    if (a === pcWolf && playerIntent) continue;
    applyIntent(a, intent);
  }
  if (!isLiveCritter(pcWolf)) {
    playerIntentApplied = false; // dead: the player's intents do nothing
  } else if (playerIntent) {
    playerIntentApplied = true;
    applyIntent(pcWolf, playerIntent);
  } else if (playerIntentApplied) { // the player let go: stop
    playerIntentApplied = false;
    pcWolf.eating = false;
    setCritterIdle(pcWolf);
  }
}

function stun(a) {
  a.blockedTick = g_tick;
  a.eating = false;
  setCritterIdle(a);
  a.speed = a.targetSpeed = 0; // stopped dead, a swimmer too until the stun ends
  if (a.pose !== "swim") setPose(a, "idle");
  a.stunnedUntil = g_tick + Math.max(1, Math.round(randBetween(stunMinS, stunMaxS) / tempo));
}

// MOVING
// Gaits: walk, trot and gallop on land, swim in water. A gait (a.pose) changes at once;
// the speed follows it (SPEED CHANGES).

// Move along one of the 8 directions (for tests and debugging; intents use
// setCritterHeading).
function setCritterMoving(a, dir, newPose = "walk") {
  const [hx, hy] = moveVecByDir[dir];
  setCritterHeading(a, hx, hy, newPose, dir);
}

// The facing for heading (hx, hy): the current one while within facingKeepCos, else the
// nearest of the 8.
function facingFor(a, hx, hy) {
  const cur = a.currentDirection;
  if (cur !== undefined) {
    const [ux, uy] = moveVecByDir[cur];
    if (hx * ux + hy * uy >= facingKeepCos) return cur;
  }
  return getDir(hx, hy, cur || 0);
}

// Move along unit heading (hx, hy) at newPose, or the best gait the critter can manage;
// face `facing` if given, else the heading.
function setCritterHeading(a, hx, hy, newPose = "walk", facing = undefined) {
  if (!isLiveCritter(a) || isMating(a)) return;
  if (a.stunnedUntil > g_tick) return;
  if (!_can(a, "walk")) return; // a newborn that can't walk yet stays put
  const same = a.hx === hx && a.hy === hy && (facing === undefined || facing === a.currentDirection);
  if (newPose === a.pose && same) return;

  if (isInWater(a)) {
    a.landPose = newPose;
    a.swimBurst = newPose === "gallop" && canUseGait(a, "gallop", a.pose === "swim" && a.swimBurst);
    newPose = "swim";
  } else {
    if (newPose === "gallop" && !canUseGait(a, "gallop", a.pose === "gallop"))
      newPose = "trot";
    if (newPose === "trot" && !canUseGait(a, "trot", a.pose === "trot"))
      newPose = "walk";
    a.landPose = newPose;
    if (a.climbingUntil > g_tick && newPose !== "idle") newPose = "walk"; // still scrambling up a bank
  }
  const speed = newPose === "swim" ? swimSpeed(a) : travelSpeedBySpeciesAndPose[a.species][newPose];
  // A swimmer can change speed (sprinting or not) in the same pose, and a stunned one
  // has speed 0, so compare speeds too.
  if (newPose === a.pose && same && a.targetSpeed > 0 && a.targetSpeed === speed) return;

  setPose(a, newPose);
  a.currentDirection = facing !== undefined ? facing : facingFor(a, hx, hy);
  a.hx = hx;
  a.hy = hy;
  a.targetSpeed = speed;
}

function setCritterIdle(a) {
  if (a.pose === "death" || a.pose === "dead" || isMating(a) || a.sleepForced) return;
  a.landPose = "idle";
  a.swimBurst = false;
  if (isInWater(a)) { // nothing stands still in water: it swims on the way it faces
    setPose(a, "swim");
    a.targetSpeed = swimSpeed(a);
    return;
  }
  a.targetSpeed = 0;
  if (a.speed > 0) return; // still slowing in its gait; changeSpeed idles it once stopped
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  setPose(a, "idle");
}

// SPEED CHANGES: a critter's speed (a.speed) moves toward its gait's (a.targetSpeed) at a
// steady rate, up and down alike, reaching a full gallop from standing in
// SPEEDS.accelToGallopS. A critter told to stop keeps its moving pose until it has
// stopped. Stopping dead (a stun, death) is immediate.
function changeSpeed(a) {
  const target = a.targetSpeed ?? 0;
  if (a.speed !== target) {
    const step = accelBySpecies[a.species];
    a.speed = a.speed < target ? Math.min(target, a.speed + step) : Math.max(target, a.speed - step);
  }
  if (a.speed === 0 && target === 0 && a.pose !== "idle" && a.pose !== "swim" && a.pose !== "sleep" && !isMating(a) && isLiveCritter(a)) {
    a.nextGX = a.gx;
    a.nextGY = a.gy;
    setPose(a, "idle");
  }
}

// EXERTION: two reserves, 0 (empty) to 1 (full).
//   wind     limits galloping: drains while galloping (or sprinting in water) and refills
//            otherwise, quickly at first, faster the more restful the gait
//   stamina  limits trotting: drains while trotting, galloping and swimming, and refills
//            slowly while idle or walking
// A gait can only be started with some reserve in hand (windStartFrac,
// staminaStartFrac), so critters don't flicker in and out of it near empty; once in it,
// they keep going until the reserve runs out.
function canUseGait(a, gait, isAlready = false) {
  if (!_can(a, 'run')) return false;
  if (gait === "gallop") {
    return isAlready ? (a.wind > 0 && a.stamina > 0)
                     : (a.wind >= windStartFrac && a.stamina >= staminaStartFrac);
  }
  if (gait === "trot") return isAlready ? a.stamina > 0 : a.stamina >= staminaStartFrac;
  return true;
}

function applyExertion(a) {
  const ex = exertionBySpecies[a.species];
  const dt = tempo;
  if (a.pose === "gallop") {
    a.wind = Math.max(0, a.wind - dt / ex.gallopFullWindS);
    a.stamina = Math.max(0, a.stamina - gallopStaminaCostFactor * dt / ex.trotFullStaminaS);
  } else if (a.pose === "trot") {
    a.stamina = Math.max(0, a.stamina - dt / ex.trotFullStaminaS);
  } else if (a.pose === "swim") {
    if (a.swimBurst) a.wind = Math.max(0, a.wind - dt / ex.gallopFullWindS);
    a.stamina = Math.max(0, a.stamina - (a.swimBurst ? gallopStaminaCostFactor : 1) * dt / ex.swimTimeS);
  }
  const restPose = a.pose === "sleep" ? "idle" : a.pose;
  const windHalfLifeS = windRefillHalfLifeSByPose[restPose];
  if (windHalfLifeS) a.wind += (1 - a.wind) * (1 - Math.pow(0.5, dt / windHalfLifeS));
  const staminaRefillS = staminaFullRefillSByPose[restPose];
  if (staminaRefillS) a.stamina = Math.min(1, a.stamina + dt / staminaRefillS);

  // out of a reserve: the next gait down
  if (a.pose === "gallop" && (a.wind <= 0 || a.stamina <= 0)) {
    setCritterHeading(a, a.hx, a.hy, "trot");
  } else if (a.pose === "trot" && a.stamina <= 0) {
    setCritterHeading(a, a.hx, a.hy, "walk");
  } else if (a.pose === "swim" && a.targetSpeed > 0) {
    if (a.swimBurst && (a.wind <= 0 || a.stamina <= 0)) a.swimBurst = false;
    a.targetSpeed = swimSpeed(a);
  }
}

// SWIMMING
// A critter is in water when every tile it occupies is water, and then always in the
// "swim" pose: at its swim speed, or sprinting (a.swimBurst, at swimBurst speed) when it
// would gallop and has the wind to. It never stands still in water: told to stand or eat,
// or after a stun, it swims on the way it faces. Swimming uses stamina (a full reserve
// lasts swimTimeS; a sprint uses it gallopStaminaCostFactor times as fast, and wind as a
// gallop does) and nothing refills it in the water. A sprint out of wind drops to a swim;
// a swimmer out of stamina can't move.
// A critter below SPEEDS.swimMinStaminaFrac stamina may not enter the water, except the
// player's wolf while the player steers it: such a move is blocked like a boulder.
// a.landPose is the land gait last asked for, resumed on climbing out. A critter climbing
// out up a bank higher than one step (bankAboveStep) is held to a walk for
// SPEEDS.climbOutSlowS (until a.climbingUntil). Out of the water, any critter speeds up
// as on land (SPEED CHANGES), from its swimming speed.
// TODO: rescue (or drown) a swimmer out of stamina; for now it can only starve.

// a.waterState caches the answer for one position. moveAllTogether fills it from what
// findCollidingPairs has already looked up, so the lookup here only runs for critters
// placed directly (spawning, tests).
function isInWater(a) {
  const s = a.waterState;
  if (s && s.gx === a.gx && s.gy === a.gy) return s.allWater;
  const allWater = isWaterAt(a.gx, a.gy, a.boxRad);
  a.waterState = { gx: a.gx, gy: a.gy, allWater };
  return allWater;
}

// Whether a critter at (gx, gy), with a box boxRad, would be in water.
function isWaterAt(gx, gy, boxRad = critterBoxRad) {
  return getOccupiedTiles(gx, gy, boxRad).every(tile => getTerrainAt(...tile.split("_").map(Number)) === "water");
}

function mayEnterWater(a) {
  return a.stamina >= SPEEDS.swimMinStaminaFrac || (a === pcWolf && playerHasControl());
}

// A swimmer's speed: its sprint, its swim, or 0 out of stamina.
function swimSpeed(a) {
  if (a.stamina <= 0) return 0;
  return travelSpeedBySpeciesAndPose[a.species][a.swimBurst ? "swimBurst" : "swim"];
}

// Switches between swimming and land gaits when a critter crosses a shoreline.
function updateTerrainPose(a) {
  if (!isLiveCritter(a)) return;
  const inWater = isInWater(a);
  if (inWater && a.pose !== "swim") {
    a.landPose = a.pose;
    a.swimBurst = a.pose === "gallop" && canUseGait(a, "gallop", true);
    setPose(a, "swim");
    a.targetSpeed = swimSpeed(a);
  } else if (!inWater && a.pose === "swim") {
    a.swimBurst = false;
    const slow = SPEEDS.climbOutSlowS[a.species];
    if (slow && bankAboveStep(a)) a.climbingUntil = g_tick + Math.round(slow / tempo);
    const resume = a.landPose || "walk";
    if (a.targetSpeed > 0 && resume !== "idle") {
      setPose(a, null); // so setCritterHeading applies the gait and its checks
      setCritterHeading(a, a.hx, a.hy, resume);
    } else {
      setCritterIdle(a);
    }
  }
}

// Whether the land critter a is climbing onto rises more than one step above the water:
// the water's surface is a level below level-0 land, so a tile (of those its box touches)
// with any corner above level 0 is a bank higher than the smallest step.
function bankAboveStep(a) {
  return getOccupiedTiles(a.gx, a.gy, a.boxRad).some(tile => {
    const c = tileCorners(...tile.split("_").map(Number));
    return c[0] > 0 || c[1] > 0 || c[2] > 0 || c[3] > 0;
  });
}

// Whether critter a could go straight to (gx, gy): inside the map, its box touching no
// blocked tile, meeting no ledge it can't step, and (if it may not enter water) staying
// dry. Checked in steps of canStepSampleTiles, as moves are checked tick by tick, so a
// walkable run of slopes isn't mistaken for a cliff. Minds ask this many times a tick.
const canStepSampleTiles = 0.25;
// Tile facts canStepTo has looked up this tick: the terrain functions recompute
// everything on every call, and minds ask about the same tiles over and over.
const stepTileCache = { tick: -1, blocked: new Map(), corners: new Map() };
function stepTileFacts() {
  if (stepTileCache.tick !== g_tick) {
    stepTileCache.tick = g_tick; stepTileCache.blocked.clear(); stepTileCache.corners.clear();
  }
  return stepTileCache;
}
function canStepTo(a, gx, gy) {
  const facts = stepTileFacts(), r = a.boxRad;
  const keepDry = a.pose !== "swim" && !mayEnterWater(a);
  const blocked = (i, j) => {
    const key = i * gridHeightN + j;
    let b = facts.blocked.get(key);
    if (b === undefined) { b = isBlockedTile(i, j); facts.blocked.set(key, b); }
    return b;
  };
  const height = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), key = i * gridHeightN + j;
    let c = facts.corners.get(key);
    if (c === undefined) { c = tileCorners(i, j); facts.corners.set(key, c); }
    const u = x - i, v = y - j;
    return c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * (1 - u) * v + c[3] * u * v;
  };
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(gx - a.gx), Math.abs(gy - a.gy)) / canStepSampleTiles));
  let h = height(a.gx, a.gy);
  for (let s = 1; s <= n; s++) {
    const x = a.gx + (gx - a.gx) * s / n, y = a.gy + (gy - a.gy) * s / n;
    if (x < r || y < r || x >= gridWidthN - r || y >= gridHeightN - r) return false;
    const i0 = Math.floor(x - r), i1 = Math.floor(x + r);
    const j0 = Math.floor(y - r), j1 = Math.floor(y + r);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (blocked(i, j)) return false;
    const hNext = height(x, y);
    if (Math.abs(hNext - h) > maxStepLevels) return false;
    if (keepDry && isWaterAt(x, y, r)) return false;
    h = hNext;
  }
  return true;
}

// THE TICK'S WORLD UPDATE: food and age; then every critter's reserves, speed and next
// position; then all moves at once (moveAllTogether), deaths, births, and (every second)
// growth of grass and of critters.
function updateAllCritters() {
  const pastLifespan = allCritters.filter(isPastLifespan);
  const starved = [];
  allCritters.forEach(a => { if (updateFood(a)) starved.push(a); });
  allCritters.forEach(updateWake);

  allCritters.forEach(a => {
    // done scrambling up a bank: back to the gait it was asked for
    if (a.climbingUntil === g_tick && a.pose === "walk" && a.landPose !== "walk" && a.targetSpeed > 0)
      setCritterHeading(a, a.hx, a.hy, a.landPose);
    applyExertion(a);
    if (a.pose === "swim" && a.targetSpeed === 0 && !(a.stunnedUntil > g_tick)) a.targetSpeed = swimSpeed(a);
    changeSpeed(a);

    if (a.speed === 0) {
      a.nextGX = a.gx;
      a.nextGY = a.gy;
      return;
    }

    const nextGX = a.gx + a.hx * a.speed;
    const nextGY = a.gy + a.hy * a.speed;
    const r = a.boxRad;
    if (nextGX >= r && nextGX < gridWidthN - r && nextGY >= r && nextGY < gridHeightN - r) {
      if (Math.abs(heightAt(nextGX, nextGY) - heightAt(a.gx, a.gy)) > maxStepLevels) {
        stun(a); // a cliff
        return;
      }
      if (a.pose !== "swim" && !mayEnterWater(a) && isWaterAt(nextGX, nextGY, r)) {
        stun(a); // too tired to go into the water
        return;
      }
      a.nextGX = nextGX;
      a.nextGY = nextGY;
    } else {
      stun(a); // the map's edge
    }
  });

  moveAllTogether(allCritters.filter(isLiveCritter));
  pastLifespan.forEach(a => startCritterDeath(a));
  starved.forEach(a => { if (isLiveCritter(a) && allCritters.includes(a)) startCritterDeath(a); });
  allCritters.filter(a => a.pregnancy && g_now >= a.pregnancy.dueAt && isLiveCritter(a)
    && !isMating(a) && !isInWater(a)).forEach(giveBirth);
  for (let k = allCorpses.length - 1; k >= 0; k--) {
    if (g_now - allCorpses[k].deathTime >= SPEEDS.corpseLastsS) allCorpses.splice(k, 1);
  }
  markScent();
  if (g_tick % Math.round(SPEEDS.windChangeEveryS / tempo) === 0) shiftWind();
  if (g_tick % grassGrowEveryTicks === 0 && clock.sunUp) {
    growGrass(grassGrowEveryTicks * tempo / meanDaylightShare);
  }
}

// COLLISIONS: every live critter's next position is checked against blocked tiles and
// every other live critter at once (the dying and corpses are walked over like ground). A wolf touching a live deer on land kills it; any
// other collider is stunned where it is. This is the only place positions change.
// TODO: kill only when the wolf bites, front-on; and let a critter bumped from behind
// carry on when the space ahead is open.
function moveAllTogether(movers) {
  const allColliders = movers;
  const collidePairs = findCollidingPairs(allColliders);
  const didCollide = {};
  collidePairs.forEach(pair => pair.forEach(m => didCollide[m] = true));

  const wasKilledBy = {};
  collidePairs.forEach(pair => {
    if (pair[0] === -1) return;
    const [c0, c1] = [allColliders[pair[0]], allColliders[pair[1]]];
    if (!isLiveCritter(c0) || !isLiveCritter(c1) || c0.species === c1.species) return;
    // no kills in the water: a wolf couldn't eat the carcass there, or drag it ashore
    if (isInWater(c0.species === "deer" ? c0 : c1)) return;
    if (allColliders[pair[1]].species === "deer") {
      wasKilledBy[pair[1]] = pair[0];
    } else {
      wasKilledBy[pair[0]] = pair[1];
    }
  });

  allColliders.forEach((thing, idx) => {
    // before the standing-still check, so a standing deer can be killed
    if (idx in wasKilledBy) {
      startCritterDeath(thing);
      return;
    }
    if (thing.nextGX === thing.gx && thing.nextGY === thing.gy) return;
    if (didCollide[idx]) {
      stun(thing);
    } else {
      thing.gx = thing.nextGX;
      thing.gy = thing.nextGY;
      thing.waterState = { gx: thing.gx, gy: thing.gy, allWater: thing.nextAllWater };
      updateTerrainPose(thing);
    }
  });
}

// The tiles a box of radius boxRad at (gx, gy) touches, as "x_y" keys.
function getOccupiedTiles(gx, gy, boxRad = critterBoxRad) {
  const left = Math.floor(gx - boxRad);
  const right = Math.floor(gx + boxRad);
  const top = Math.floor(gy - boxRad);
  const bottom = Math.floor(gy + boxRad);
  const tiles = [];
  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      tiles.push(`${x}_${y}`);
    }
  }
  return tiles;
}

// Must use the same boxes as getOccupiedTiles, or near pairs in different tiles are
// never tested.
// TODO: rectangular boxes, fitting each species' shape.
function doNextBoundingBoxesOverlap(a, b) {
  const span = a.boxRad + b.boxRad;
  return Math.abs(a.nextGX - b.nextGX) < span && Math.abs(a.nextGY - b.nextGY) < span;
}

// Whether two things' next moves bump: their next boxes overlap, unless they already
// overlap and are moving apart (a wolf on the deer it just killed must be able to leave).
function doNextMovesCollide(a, b) {
  if (!doNextBoundingBoxesOverlap(a, b)) return false;
  const span = a.boxRad + b.boxRad;
  const overlapNow = Math.abs(a.gx - b.gx) < span && Math.abs(a.gy - b.gy) < span;
  if (!overlapNow) return true;
  const nowL2 = (a.gx - b.gx) ** 2 + (a.gy - b.gy) ** 2;
  const nextL2 = (a.nextGX - b.nextGX) ** 2 + (a.nextGY - b.nextGY) ** 2;
  return nextL2 <= nowL2;
}

// Index pairs [i, j] of things whose next positions collide; i is -1 for a blocked
// tile. Things are grouped by the tiles they will occupy, so only neighbours are
// compared. Also records each thing's nextAllWater, since its tiles' terrain is at hand.
// TODO: keep occupancy between ticks and update it only for things that move.
function findCollidingPairs(creatures) {
  const tileMap = new Map();         // "x_y" -> indexes of things on that tile
  const potentialPairs = new Set();  // "i|j", i < j
  const terrainByTile = new Map();
  const blockedByTile = new Map();

  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i];
    const tiles = getOccupiedTiles(creature.nextGX, creature.nextGY, creature.boxRad);
    let allWater = true;

    for (const tile of tiles) {
      let terrain = terrainByTile.get(tile);
      if (terrain === undefined) {
        const [tileX, tileY] = tile.split("_").map(Number);
        terrain = getTerrainAt(tileX, tileY);
        terrainByTile.set(tile, terrain);
        blockedByTile.set(tile, isBlockedTile(tileX, tileY));
      }
      if (terrain !== "water") allWater = false;

      if (!tileMap.has(tile)) {
        if (blockedByTile.get(tile)) {
          potentialPairs.add(`-1|${i}`);
        } else {
          tileMap.set(tile, [i]);
        }
      } else {
        for (const j of tileMap.get(tile)) {
          const pairKey = i < j ? `${i}|${j}` : `${j}|${i}`;
          potentialPairs.add(pairKey);
        }
        tileMap.get(tile).push(i);
      }
    }
    creature.nextAllWater = allWater;
  }

  const collisions = [];
  for (const pairKey of potentialPairs) {
    const [i, j] = pairKey.split('|').map(Number);
    if (i === -1 || doNextMovesCollide(creatures[i], creatures[j])) {
      collisions.push([i, j]);
    }
  }
  return collisions;
}

// DELAYED REACTIONS: things that happen a set game time later: "decontrol", a dying
// critter becomes a corpse; "mated", the end of a mating act.
// Kept sorted by end time, latest first, so the next one due pops off the end.
// TODO: a priority queue, if many reactions are ever pending at once.
const delayedRxnArr = []

function enqDelayed(rxn, timeS, opts = {}) {
  const end = g_now + timeS;
  let iNew = 0;
  while (iNew < delayedRxnArr.length && delayedRxnArr[iNew].end > end) iNew++;
  delayedRxnArr.splice(iNew, 0, {rxn: rxn, opts: opts, end: end});
}

function runRxn(rxn) {
  const a = rxn.opts.a;
  switch (rxn.rxn) {
    case 'decontrol':
      if (a.kind !== "critter") {
        console.log("Err: Non-critter to decontrol rxn");
        return;
      }
      if (a.pose !== "death" && a.pose !== "dead") {
        console.log("Err: Live-posed critter to decontrol rxn")
        return;
      }
      deleteCritter(a, true);
    break;
    case 'mated':
      finishMating(a, rxn.opts.b);
    break;
    default:
      console.log("Err: Unknown reaction to runRxn");
      return;
  }
}

function deqCurrentDelayed() {
  // half a tick of tolerance, so float drift in g_now can't make a reaction a tick late
  while (delayedRxnArr.length && delayedRxnArr.at(-1).end <= g_now + tempo / 2)
    runRxn(delayedRxnArr.pop());
}

// GAME LOOP
// The world advances in fixed ticks of `tempo` game seconds. In the browser, each frame
// runs as many ticks as real time has passed, so the game runs at the same speed at any
// refresh rate. At most one frame is ever pending (loopHandle).
const maxCatchUpS = 0.25;  // longer gaps (a hidden tab, a debugger pause) are dropped

let loopHandle = null;     // pending requestAnimationFrame / setTimeout id
let lastFrameMs = null;    // null when (re)starting
let tickDebtS = 0;         // real time passed but not yet simulated
let startRealtime = Date.now();
let isInitialized = false;

// LISTENERS let others keep up without the simulation knowing who they are:
//   tick listeners   run at the start of every tick, before the world changes (the mind
//                    decides, the controls pan the camera)
//   frame listeners  run after each frame's ticks and after a single step (the view draws)
const tickListeners = [];
const frameListeners = [];
function onTick(fn) { tickListeners.push(fn); }
function onFrame(fn) { frameListeners.push(fn); }
function notifyFrame() { frameListeners.forEach(fn => fn()); }

function tick() {
  if (consoleOnlyMode) {
    const tps = g_tick / ((Date.now() - startRealtime) / 1000)
    console.log("Begin tick=" + g_tick + " + tps=" + tps);
  }
  updateClock();
  tickListeners.forEach(fn => fn());
  applyIntents();
  startMatings();
  deqCurrentDelayed();
  updateAllCritters();
  g_tick++;
  g_now += tempo;
}

function runFrame(nowMs) {
  loopHandle = null;
  if (isPaused) return;
  if (lastFrameMs !== null) {
    tickDebtS += Math.min((nowMs - lastFrameMs) / 1000, maxCatchUpS);
  }
  lastFrameMs = nowMs;
  // the epsilon keeps float drift in the debt from skipping a tick
  while (tickDebtS >= tempo - 1e-9) {
    tick();
    tickDebtS -= tempo;
  }
  notifyFrame();
  scheduleFrame();
}

// Console-only mode: one tick per setTimeout, as fast as possible.
// TODO: run ticks in batches per setTimeout; one each is several times slower than
// running them back to back.
function runConsoleBatch() {
  loopHandle = null;
  if (isPaused) return;
  tick();
  scheduleFrame();
}

function scheduleFrame() {
  if (isPaused || loopHandle !== null) return;
  loopHandle = consoleOnlyMode
    ? setTimeout(runConsoleBatch, 0)
    : requestAnimationFrame(runFrame);
}

function startLoop() {
  lastFrameMs = null; // time spent stopped isn't owed as ticks
  tickDebtS = 0;
  scheduleFrame();
}

function stopLoop() {
  if (loopHandle === null) return;
  if (consoleOnlyMode) clearTimeout(loopHandle);
  else cancelAnimationFrame(loopHandle);
  loopHandle = null;
}

function pause() {
  isPaused = true;
  stopLoop(); // at once: no stray tick from an already pending frame
}

function unpause() {
  if (!isPaused) return;
  isPaused = false;
  startLoop();
}

function togglePause() {
  isPaused ? unpause() : pause();
}

// While paused, advance exactly one tick.
function stepOnce() {
  if (!isPaused) return;
  tick();
  notifyFrame();
}

// Creates the world's grass and critters. Call once, before attaching a view or starting.
function init() {
  if (isInitialized) return alert("sim.init called twice");
  isInitialized = true;
  initGrass();
  initScent();
  wolves.forEach(wolf => { allCritters.push(initCritter(wolf, "wolf")); });
  deer.forEach(aDeer => { allCritters.push(initCritter(aDeer, "deer")); });
  // half of each species male, at random (but the player's wolf, either)
  for (const list of [wolves.slice(1), deer]) {
    const sexes = list.map((_, k) => k % 2 === 0);
    for (let k = sexes.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [sexes[k], sexes[r]] = [sexes[r], sexes[k]];
    }
    list.forEach((a, k) => {
      setSex(a, sexes[k]);
    });
  }
  forbidOverlapsOnStart();
}

// Starts the game loop: in real time, or with consoleOnly as fast as possible and
// without a browser.
function start({ consoleOnly = false } = {}) {
  if (!isInitialized) return alert("sim.start called before sim.init");
  consoleOnlyMode = consoleOnly;
  startRealtime = Date.now();
  startLoop();
}

// THE INTERFACE
// Views and controllers read critters' fields directly (gx, gy, pose, poseTick,
// currentDirection (the facing), hx, hy (the heading), speed, targetSpeed, species, wind,
// stamina, food, eating, carcass, carcassFullKg, uid, blockedTick, stunnedUntil, isMale,
// birthTime, deathTime, weightKg, adultKg, skeletonKg, boxRad, mateUid, matingWith, parentUids, youngUids,
// pregnancy, nursingOn, wake, sleepForced)
// but change the world only through these functions.
return {
  // lifecycle and time
  init, start, pause, unpause, togglePause, stepOnce,
  get isPaused() { return isPaused; },
  get tickCount() { return g_tick; },
  get now() { return g_now; },        // game seconds
  get tempo() { return tempo; },      // game seconds per tick
  onTick, onFrame,

  // the world
  gridWidthN, gridHeightN, getTerrainAt, obstacleAt,
  tileCorners, heightAt, get maxLevel() { return maxLevel; },
  isBlockedTile, isLandTile, isWaterAt, canStepTo, obstacleHeightAt, isLiveCritter,
  // scent and wind
  scentAt, get wind() { return { x: windX, y: windY }; },
  get scentHalfLifeS() { return SPEEDS.scentHalfLifeS; },
  // day and night, and sleep
  get clock() { return clock; }, daylightHoursAt, meanDaylightShare, latitudeDeg, forcedWakeAt,
  get dayLengthS() { return SPEEDS.dayLengthS; },
  allCritters, allCorpses, deathDurationSBySpecies,
  get pcWolf() { return pcWolf; },    // the player's wolf, or its corpse (see THE PLAYER'S WOLF)
  get speeds() { return SPEEDS.name; },
  get swimMinStamina() { return SPEEDS.swimMinStaminaFrac; },
  // food
  grassFoodAt, grassHeightAt, grassMostAt, inGrassReach, grassChangesSince, carcassPieces, carcassMeatKg, eatReachTiles,
  get grassMaxKg() { return SPEEDS.grassMaxKg; },
  edibleKg, bodySharesBySpecies,
  // ages and breeding
  can: _can, isGrown, isInfant, isFertile, inHeat, mateReachTiles, youngStage, youngScales,
  adultBoxRad: critterBoxRad, nurseContactTiles, nurseMotherMinFood,
  get nurseFullS() { return SPEEDS.nurseFullS; },
  mateActSBySpecies: Object.fromEntries(Object.entries(SPEEDS.breeding).map(([sp, b]) => [sp, b.mateActS])),

  // intents
  setIntent, setPlayerIntent, playerHasControl,
  getDir, moveVecByDir, DIR_E, DIR_SE, DIR_S, DIR_SW, DIR_W, DIR_NW, DIR_N, DIR_NE,

  // For tests and debugging only; views and controllers must not use these.
  internals: {
    tick, wolves, deer, allLandTiles,
    setCritterIdle, setCritterMoving, setCritterHeading, isInWater, getOccupiedTiles,
    forbidOverlapsOnStart, critterBoxRad, travelSpeedBySpeciesAndPose,
    REALISTIC, GAMIFIED, SPEEDS, drawLifespanS, startCritterDeath, growGrass, setGrassKg, stun,
    windRefillHalfLifeSByPose, staminaFullRefillSByPose, maxStepLevels,
    critterByUid, bodyKgBySpecies, growthShare, litterSize, birthSpots, giveBirth,
    holdClock, setNeedSleep, updateWake, conceive, pair, energyRangeMJ, feed, growFromFood, milkEfficiency, canPair, setWind, growthProgress, growthKgPerS, setSkeletonByAge, updateBody,
    get loopHandle() { return loopHandle; },
  },
};

})();

// In Node, sim.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = sim;
