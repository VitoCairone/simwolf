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

// (a local Math: looking globals up is slow where the code runs in a Node vm context)
const Math = globalThis.Math;

const tempo = 1 / 60;          // game seconds per tick
let consoleOnlyMode = false;   // set by start(): run as fast as possible, logging each tick
let g_tick = 0;                // ticks run so far; changed only by tick()
let g_now = 0;                 // game seconds so far; changed only by tick()
let g_next_uid = 0;
let isPaused = false;

// The map is square, 50 km a side. A deer eats ~639 kg of grass (dry) a year and a tile
// grows back 0.4 kg a year (see FOOD), so a deer needs ~1,600 grass tiles. Nothing is
// kept for the whole map: the terrain is worked out where it is wanted (TERRAIN CACHE),
// and grass, scent and the like are kept only where something has changed them.
const gridWidthN = 50000;
const gridHeightN = 50000;
const terrainSeed = 1;

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
//   accelMaxMps2, powerWPerKg   speeding up and slowing down: the most m/s each second,
//                          and the power a kilogram of it puts in or takes out (see SPEED
//                          CHANGES)
//   climbOutSlowS          how long a critter climbing out of the water up a bank is held
//                          to a walk (see SWIMMING); real time in both, like travel
//   stunMinS, stunMaxS     how long a blocked move stuns a critter (see INTENTS)
//   deathDurationSBySpecies   the death pose's length (animat.js fits its animation to it)
//   corpseLastsS           how long after its death a corpse is gone (two weeks)
//   lifeStageAgesS         ages a young critter can see, hear, walk, eat, run, is weaned,
//                          hunts (a wolf) and can mate
//   growthAgesS            ages at which a well-fed young critter's frame has grown
//                          growthSharesBySpecies of the way to an adult's (see BODY)
//   breeding               gestation, how often a female can conceive, the oldest a
//                          critter is fertile, and the mating act (see BREEDING)
//   forcedMortalityMaxS, mortalityRatio   how long critters live (see FORCED MORTALITY)
//   foodFullS, eatKgPerS, grassMaxKg, grassRegrowKgPerS, undergrowthRegrowKgPerS,
//   pineRegrowShare        how long a full meter lasts (and with it how fast a stomach
//                          empties), eating, grass, undergrowth and pine browse (see FOOD
//                          and BODY)
//   infantFoodFullS, nurseFullS   how long an infant's full meter lasts, and how long it
//                          takes to suckle it full (see BREEDING)
//   feedingMinS            the least time a meal at a carcass or a suckle takes (see
//                          FEEDING TIME); none in REALISTIC
//   drinkKgPerKgS          how fast it drinks, kg a second a kg of its frame (see WATER)
//   waterNeedScale         the share of its real need for water a body has (see WATER)
//   dayLengthS             a day and night; a year is 365 of them (see DAY AND NIGHT)
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
    // fed by the pack after weaning; travels and hunts with it from about 6 months
    // (Mech & Boitani 2003, Wolves: a range of estimates)
    hunt:   { min: 5 * monthS, avg: 6 * monthS, max: 8 * monthS },
    mate:   { min: 18 * monthS, avg: 24 * monthS,  max: 36 * monthS },
  },
  deer: {
    see:    { min: 0, avg: 0, max: 0 },
    hear:   { min: 0, avg: 0, max: 0 },
    walk:   { min: 0.25 * hourS, avg: 0.5 * hourS, max: 1 * hourS},
    eat:    { min: 10 * dayS, avg: 20 * dayS, max: 30 * dayS },
    run:    { min: 1 * dayS, avg: 2 * dayS, max: 3 * dayS },
    wean:   { min: 4 * monthS, avg: 5 * monthS, max: 8 * monthS }, // ~156 days (Add-my-Pet)
    hunt:   { min: 4 * monthS, avg: 5 * monthS, max: 8 * monthS }, // (deer don't: as weaned)
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
//   What a well-fed body is made of, as shares of its weight (the rest water): white-tailed
//   deer in early winter are 62% water, 12% fat, 20.5% protein and 4.5% ash (DelGiudice et
//   al. 1990, J. Wildlife Management), with about 0.5% glycogen (estimate). Wolf:
//   estimates, likewise (fasting wolves' loss is about 55% water: Kreeger et al. 1997).
//   Energy: 37.7 MJ a kg of fat, 16.7 of carbohydrate or protein (Atwater's 9, 4 and 4
//   kcal a gram); none in water or minerals. A starving mammal dies with about two thirds
//   of its protein left (estimate).
//   Bone is about 45% minerals, 20% protein, 25% water and 10% fat (estimates); wolves eat
//   a carcass's soft tissue and boneEdibleShare of its bone (estimate).
const bodyKgBySpecies = {
  wolf: { birth: { female: 0.4, male: 0.4 }, female: 41, male: 50 },
  deer: { birth: { female: 6, male: 6.5 }, female: 100, male: 160 },
};
const bodySharesBySpecies = withWater({
  wolf: { fatKg: 0.10, carbsKg: 0.005, proteinKg: 0.19, mineralKg: 0.04 },
  deer: { fatKg: 0.12, carbsKg: 0.005, proteinKg: 0.205, mineralKg: 0.045 },
});
const fatMJPerKg = 37.7, carbsMJPerKg = 16.7, proteinMJPerKg = 16.7;
const lethalProteinShare = 2 / 3;
const boneShares = withWater({ fatKg: 0.10, carbsKg: 0, proteinKg: 0.20, mineralKg: 0.45 });
const boneEdibleShare = 0.2;
// Food, as real animals eat it (shares of its fresh weight, the rest water):
//   Grass: fresh pasture is about 22% dry matter: about 17% carbohydrate, 3% protein, 0.5%
//   fat and 1.5% minerals (estimates). Red deer eat ~1.75 kg of it dry a day (Forestry and
//   Land Scotland), which yields them ~10 MJ a kg (grassDryYieldMJPerKg, estimate): all its
//   protein and fat, and the share of its carbohydrate (grassCarbsDigested) that makes up
//   the rest; the rest of it, fibre, passes through. They graze ~0.2 kg (dry) an hour.
//   An ungrazed field holds ~0.2-0.4 kg of dry matter a square metre (0.3 here) and
//   unfertilized grassland regrows ~0.4 kg a square metre a year.
//   Wolf: a full meter lasts 14 days (an adult wolf can go almost two weeks without food:
//   New York Wolf Center); it eats ~0.5 kg of meat a minute, and can gorge on up to 20%
//   of its weight at a time (International Wolf Center). A big meal has left the stomach
//   in about 8 hours (as a dog's: estimate).
//   Deer: a full meter lasts as long as a hind takes to spend it on grass (above). The
//   rumen holds about 12% of the deer's weight of fresh grass (estimate); full, it passes
//   grass on as fast as the deer grazes (so grazing without pause keeps it about full).
//   The young's stomachs hold as much for their size as their parents'; an infant digests
//   all of the carbohydrate it takes in (its milk's lactose; a calf's milk bypasses the
//   rumen).
//   Milk: red deer, about 8.5% fat, 7.1% protein, 4.5% lactose and 1.3% minerals; wolf,
//   about 9.5%, 9%, 3.5% and 1.2% (estimates from deer's and dogs' milk). Nursing (red deer,
//   via wildlifeonline.me.uk): bouts of 45 s to 4 minutes, of 150-600 ml of milk, 5-10 a
//   day at first; a hind gives up to ~2 kg a day, ~13 MJ, a newborn's full meter (see
//   BODY) in about 3 days. A mother turns her body into milk at about 65% (as livestock:
//   estimate); the rest she burns. Wolf pups: no figures found; as calves.
const grassShares = withWater({ fatKg: 0.005, carbsKg: 0.17, proteinKg: 0.03, mineralKg: 0.015 });
const grassDryShare = 1 - grassShares.waterKg;
// UNDERGROWTH (estimates): a low bush's leaves and shoots, richer in protein and drier
// than grass, about 0.4 kg dry within a deer's reach, regrowing in a year; flowers (forbs),
// wetter, about 0.15 kg dry a tile, regrowing in half a year.
const undergrowthShares = {
  bush: withWater({ fatKg: 0.01, carbsKg: 0.24, proteinKg: 0.06, mineralKg: 0.02 }),
  flowers: withWater({ fatKg: 0.005, carbsKg: 0.12, proteinKg: 0.035, mineralKg: 0.015 }),
};
const undergrowthMostKg = { bush: 0.4 / (1 - undergrowthShares.bush.waterKg), flowers: 0.15 / (1 - undergrowthShares.flowers.waterKg) };
const realUndergrowthRegrowKgPerS = { bush: undergrowthMostKg.bush / yearS, flowers: undergrowthMostKg.flowers / (yearS / 2) };
const grassDryYieldMJPerKg = 10;
const grassCarbsDigested = (grassDryYieldMJPerKg * grassDryShare - grassShares.fatKg * fatMJPerKg
  - grassShares.proteinKg * proteinMJPerKg) / (grassShares.carbsKg * carbsMJPerKg);
// PINE NEEDLES (estimates): deer browse needles and twig tips up to about 1.5 m (Michigan
// DNR: white pine a preferred food, jack pine fair, red pine a starvation food). Fresh,
// about 45% dry matter (pineDryShare): 8% of that protein, 3% fat, 3% minerals, and only
// about 40% digestible (grass, 65%): ~6 MJ a kg dry. Its carbohydrate is what yields that,
// digested as grass's is; the fibre counts as water. Within reach: about 0.3 kg dry on a
// sapling, 0.2 on a small tree's low branches (pineBrowseDryKg); regrowing in a year.
const pineDryShare = 0.45, pineDryYieldMJPerKg = 6;
const pineShares = (() => {
  const fatKg = 0.03 * pineDryShare, proteinKg = 0.08 * pineDryShare, mineralKg = 0.03 * pineDryShare;
  const carbsKg = (pineDryYieldMJPerKg * pineDryShare - fatKg * fatMJPerKg - proteinKg * proteinMJPerKg) / (carbsMJPerKg * grassCarbsDigested);
  return withWater({ fatKg, carbsKg, proteinKg, mineralKg });
})();
const pineBrowseDryKg = { sapling: 0.3, small: 0.2 };
// the most browse on a pine, fresh kg, by its size (pineOn): a sapling, a small tree, none on larger
const pineMostKgBySize = [0, pineBrowseDryKg.sapling / pineDryShare, pineBrowseDryKg.small / pineDryShare, 0, 0, 0, 0, 0, 0];
const realPineRegrowShare = 1 / yearS; // of its most, a second
const carbsDigestedBySpecies = { wolf: 1, deer: grassCarbsDigested };
const milkSharesBySpecies = {
  wolf: withWater({ fatKg: 0.095, carbsKg: 0.035, proteinKg: 0.09, mineralKg: 0.012 }),
  deer: withWater({ fatKg: 0.085, carbsKg: 0.045, proteinKg: 0.071, mineralKg: 0.013 }),
};
const milkEfficiency = 0.65;
const stomachShareBySpecies = { wolf: 0.2, deer: 0.12 };
const realFoodFullS = {
  wolf: 14 * dayS,
  // (a hind's full meter, over what she spends a day)
  deer: dayS * bodyKgBySpecies.deer.female * rangeMJPerKg("deer") / (1.75 * grassDryYieldMJPerKg),
};
const realEatKgPerS = { wolf: 0.5 / 60, deer: 0.2 / grassDryShare / hourS }; // fresh
const realGrassRegrowKgPerS = 0.4 / grassDryShare / yearS;
// Water (see WATER in BODY):
//   A body loses water all the time: urine (carrying off the urea of burned protein, and
//   salts), faeces, breath and evaporation (panting). Dogs need to take in about 1 ml a
//   kcal they spend, 50-60 ml a kg a day (Purina Institute); wolves as dogs (estimate:
//   in a northern winter they drink little, eating snow: International Wolf Center).
//   Red deer took in 2.6-3.9 litres a kg of dry matter eaten (Lincoln University, stags
//   on pellets and silage): 3 kg a kg of grass (dry) here, 0.3 kg a MJ it yields.
//   Burning makes water: 1.07 kg a kg of fat, 0.6 of carbohydrate, 0.41 of protein (Purina
//   Institute), so it loses what it needs to take in plus that (as if all fat).
//   Losing 10-15% of its body water is life-threatening to a dog (Purina Institute); man
//   dies having lost 15-25% of his weight (FAO): death at 15% of the frame's weight here.
//   Drinking: a wolf laps up about 0.6 litres a minute, a deer sucks up 2 (estimates).
const metabolicWaterPerKg = { fatKg: 1.07, carbsKg: 0.6, proteinKg: 0.41 };
const waterNeedKgPerMJ = { wolf: 1 / 4.184, deer: 3 / grassDryYieldMJPerKg };
// what a body loses a MJ burnt: its need, scaled for play (SPEEDS.waterNeedScale), plus
// what burning makes
function waterLossKgPerMJ(species) {
  return waterNeedKgPerMJ[species] * SPEEDS.waterNeedScale[species] + metabolicWaterPerKg.fatKg / fatMJPerKg;
}
const lethalWaterShare = 0.15;
const realDrinkKgPerKgS = { wolf: 0.6 / 60 / bodyKgBySpecies.wolf.female, deer: 2 / 60 / bodyKgBySpecies.deer.female };
// THE STOMACH'S DRIP (see BODY): each second it passes 1 / T of what it holds, but never
// less than stomachDripLeastShare of a full stomach's drip, until empty; so a full one
// empties in T (1 + ln(1 / stomachDripLeastShare)). T is a share of the time a full meter
// lasts (so a stomach keeps pace with the meter, at any game speed; an infant's too).
const stomachDripLeastShare = 0.1;
const stomachEmptiesInT = 1 + Math.log(1 / stomachDripLeastShare);
const stomachTShareBySpecies = {
  wolf: 8 * hourS / stomachEmptiesInT / realFoodFullS.wolf,
  deer: stomachShareBySpecies.deer * bodyKgBySpecies.deer.female / realEatKgPerS.deer / realFoodFullS.deer,
};

// Adds water to shares of fat, carbs, protein and minerals (one set, or one by key), as
// the rest of the whole.
function withWater(s) {
  if (!("fatKg" in s)) return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, withWater(v)]));
  return { ...s, waterKg: 1 - s.fatKg - s.carbsKg - s.proteinKg - s.mineralKg };
}
// MJ a kg of a well-fed body (its frame: see BODY) holds, at full, and at the lethal point;
// and from the one to the other.
function fullMJPerKg(species) {
  const s = bodySharesBySpecies[species];
  return s.fatKg * fatMJPerKg + s.carbsKg * carbsMJPerKg + s.proteinKg * proteinMJPerKg;
}
function lethalMJPerKg(species) {
  return bodySharesBySpecies[species].proteinKg * lethalProteinShare * proteinMJPerKg;
}
function rangeMJPerKg(species) { return fullMJPerKg(species) - lethalMJPerKg(species); }

const REALISTIC = {
  name: "realistic",
  travelKph: {
    wolf: {
      walk: 5,        // estimate; no direct figure found
      stalk: 7,       // creeping up on prey, all but silent (a game gait: see EXERTION)
      crawl: 1.5,     // a newborn too young to walk: 30% of a walk (a game gait: see MOVING)
      trot: 9,        // the travel gait, kept up for hours (Mech & Boitani: 8-9 km/h)
      gallop: 55,     // chasing prey: 50-64 km/h for 1-8 km
      swim: 3.5,      // ~3 mph; reported figures are sparse
      swimBurst: 6,
    },
    deer: {
      walk: 5,
      crawl: 1.5,
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
  windRefillHalfLifeSByPose: { idle: 45, walk: 60, crawl: 60, stalk: 180, trot: 180 },
  // Stamina: seconds from empty to full, by pose.
  staminaFullRefillSByPose: { idle: 30000, walk: 120000, crawl: 120000 },
  gallopStaminaCostFactor: 2, // galloping uses stamina twice as fast as trotting
  windStartFrac: 0.25,        // wind needed to start a gallop
  staminaStartFrac: 0.1,      // stamina needed to start a trot or gallop
  swimMinStaminaFrac: 0.25,
  // speeding up and slowing down (SPEED CHANGES): at low speed no more than accelMaxMps2
  // (it would pitch over: a greyhound about 10 m/s2, a pony 6), faster held to its power,
  // powerWPerKg (greyhound about 60 W/kg, pony 30), braking the same (a pony's braking
  // "largely mirrors" its speeding up): Williams et al. 2009, "Pitch then power", J Exp
  // Biol. A wolf put a little under a greyhound; a deer (no figures) quicker off the mark.
  // From standing to a full gallop: a wolf about 2.3 s, a deer 1.9.
  accelMaxMps2: { wolf: 9, deer: 12 },
  powerWPerKg: { wolf: 60, deer: 110 },
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
  eatKgPerS: realEatKgPerS,
  infantFoodFullS: { wolf: 3 * dayS, deer: 3 * dayS },
  nurseFullS: { wolf: 40 * 60, deer: 40 * 60 },
  feedingMinS: 0,
  drinkKgPerKgS: realDrinkKgPerKgS,
  waterNeedScale: { wolf: 1, deer: 1 },
  grassMaxKg: 0.3 / grassDryShare,
  grassRegrowKgPerS: realGrassRegrowKgPerS,
  undergrowthRegrowKgPerS: realUndergrowthRegrowKgPerS,
  pineRegrowShare: realPineRegrowShare,
};

// GAMIFIED shrinks real times by one factor per area: METABOLISM (gameMetabolismScale)
// for everything a body does over time, eating and growing alike: meters, eating,
// digesting, grass growing, corpses rotting, and lives (growing up, breeding, ageing),
// so a wolf's full meter lasts 20 minutes (and its greatest age some 7.5 days); and
// exertion (draining and refilling) 10 times as fast, and a deer's swimming twice that.
// The mating act lasts a few seconds, long enough to see. Thirst is slowed apart: a full
// water meter lasts 30 minutes with neither food nor water (gameThirstS). An infant's
// hunger is slowed apart too: its full meter lasts gameInfantHungerSlowdown times as long
// as scaled (burning that much slower: no biomass is made), but never longer than its
// species' adult's.
const gameMetabolismScale = (20 * 60) / realFoodFullS.wolf;
const gameThirstS = 30 * 60;
const gameInfantHungerSlowdown = 4;
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
    wolf: { walk: 5, crawl: 1.5, stalk: 7, trot: 9, gallop: 55, swim: 3.5, swimBurst: 6 },
    deer: { walk: 5, crawl: 1.5, trot: 15, gallop: 65, swim: 5, swimBurst: 10 },
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
  accelMaxMps2: { wolf: 9, deer: 12 },
  powerWPerKg: { wolf: 60, deer: 110 },
  climbOutSlowS: { wolf: 1.5, deer: 1.5 }, // estimate: scrambling up a bank
  stunMinS: 0.1,
  stunMaxS: 0.5,
  deathDurationSBySpecies: { deer: 2 / 3, wolf: 1.1 },
  corpseLastsS: 14 * dayS * gameMetabolismScale, // as long as a wolf's full meter lasts
  lifeStageAgesS: scaledAges(realLifeStageAgesS, gameMetabolismScale),
  growthAgesS: scaledTimes(realGrowthAgesS, gameMetabolismScale),
  breeding: (() => {
    const b = scaledTimes(realBreeding, gameMetabolismScale);
    b.wolf.mateActS = b.deer.mateActS = 3;
    return b;
  })(),
  forcedMortalityMaxS: {
    wolf: realForcedMortalityMaxS.wolf * gameMetabolismScale,
    deer: realForcedMortalityMaxS.deer * gameMetabolismScale,
  },
  mortalityRatio,
  foodFullS: { wolf: realFoodFullS.wolf * gameMetabolismScale, deer: realFoodFullS.deer * gameMetabolismScale },
  // Estimates: dogs follow trails hours old; breezes shift every minute or so.
  scentHalfLifeS: 30 * 60,
  windChangeEveryS: 60,
  // A day and night lasts 10 minutes (chosen for play; a year, 61 hours).
  // TODO: one scale for all of GAMIFIED (this is far from metabolism's).
  dayLengthS: gameDayS,
  eatKgPerS: { wolf: realEatKgPerS.wolf / gameMetabolismScale, deer: realEatKgPerS.deer / gameMetabolismScale },
  // Scaled, a newborn would starve in some 4 minutes: here in about 17 (chosen for play).
  infantFoodFullS: Object.fromEntries(Object.entries(REALISTIC.infantFoodFullS).map(([sp, t]) =>
    [sp, Math.min(t * gameMetabolismScale * gameInfantHungerSlowdown, realFoodFullS[sp] * gameMetabolismScale)])),
  nurseFullS: scaledTimes(REALISTIC.nurseFullS, gameMetabolismScale),
  // Scaled, a wolf would gorge its fill, or an infant suckle its, in under a second: too
  // quick to see (chosen for play).
  feedingMinS: 2,
  // Scaled, it would drink its fill in a blink: here it drinks it from the brink of death
  // (lethalWaterShare) in 6 s (chosen for play).
  drinkKgPerKgS: { wolf: lethalWaterShare / 6, deer: lethalWaterShare / 6 },
  // Scaled, a body with neither food nor water would die of thirst in about 3 minutes
  // (a wolf; 4 a deer): here its need is cut so it takes 30 (chosen for play).
  waterNeedScale: Object.fromEntries(["wolf", "deer"].map(sp => [sp, lethalWaterShare * realFoodFullS[sp] * gameMetabolismScale /
    (waterNeedKgPerMJ[sp] * rangeMJPerKg(sp) * gameThirstS)])),
  grassMaxKg: 0.3 / grassDryShare,
  grassRegrowKgPerS: realGrassRegrowKgPerS / gameMetabolismScale,
  undergrowthRegrowKgPerS: Object.fromEntries(Object.entries(realUndergrowthRegrowKgPerS).map(([k, v]) => [k, v / gameMetabolismScale])),
  pineRegrowShare: realPineRegrowShare / gameMetabolismScale,
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
// How much a critter's speed (tiles a tick) may change in one tick at most, and its power
// in the same units (speed change a tick, times speed), by species (see SPEED CHANGES).
const accelBySpecies = Object.fromEntries(Object.keys(travelSpeedBySpeciesAndPose).map(sp =>
  [sp, SPEEDS.accelMaxMps2[sp] * tempo * tempo]));
const powerBySpecies = Object.fromEntries(Object.keys(travelSpeedBySpeciesAndPose).map(sp =>
  [sp, SPEEDS.powerWPerKg[sp] * tempo * tempo * tempo]));
// How much the speed of a critter of a species going at speed v may change in one tick,
// up or down alike.
function speedStep(species, v) {
  const p = powerBySpecies[species];
  return v * accelBySpecies[species] > p ? p / v : accelBySpecies[species];
}

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function sample(list) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// TERRAIN
// Everything about the ground is a pure function of the tile (no random numbers), built
// from independent parts:
//   LAND AND WATER  hydrology.js (terrainMap)  the land's height in levels, and the sea,
//                   lakes and rivers on it (worked out once, at load, for the whole map:
//                   a coarse graph of a few MB; then any tile from the graph near it)
//   GROUND COVER    groundCoverAt              grass, dirt or stone, on land, by region
//   UNDERGROWTH     undergrowthAt              low bushes and flowers, on land
//   OBSTACLES       obstacleAt                 boulders, on land
//   PINES           pineAt                     pine trees and saplings, on land
// They are worked out a block at a time and kept for a while (TERRAIN CACHE): getTerrainAt
// and the rest read the cache.
const terrainMap = hydrology.makeMap({ seed: terrainSeed, width: gridWidthN, height: gridHeightN });

// Triangle wave: 0 at whole numbers, 1 halfway between.
function jag(x) {
  return 2 * Math.abs(x - Math.floor(x + 0.5));
}

// jag eased by smoothstep, so thresholds on sums of these give rounded regions.
function wave(x) {
  const t = jag(x);
  return t * t * (3 - 2 * t);
}

// The terrain of the tile containing (gx, gy): "water", "grass", "dirt" or "stone". Off
// the map, the sea.
function getTerrainAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return "water";
  const b = terrainBlock(i, j);
  return terrainKinds[b.kind[(i - b.i0) * terrainBlockTiles + j - b.j0]];
}

// GROUND COVER of land (grass, dirt or stone: all passable, independent of height) and its
// UNDERGROWTH (low bushes and flowers: see UNDERGROWTH), both pure functions of the tile.
//   REGIONS: the land is split into regions, the cells of a Voronoi diagram of points about
//     regionTiles apart, warped so their borders meander. Each has a style of its own
//     (coverStyle): how much of each cover, how large and how shaped its patches, how
//     ragged their edges, how much undergrowth and how clumped. A region meets each
//     neighbour either abruptly or interfingering over a band (regionBlendShare of pairs:
//     a band up to regionBlendMaxTiles wide, where the two styles' patches mix).
//   PROVINCES: regions draw their style from their province's theme (coverThemes), the
//     cells of a coarser diagram about provinceTiles apart, so places far apart differ in
//     kind (grassland, scrub, rocky ground...), and neighbouring regions mostly agree; one
//     region in regionOddShare takes another theme.
//   WITHIN A REGION two independent fields of value noise decide (each its own patch size,
//     stretched along one of four directions, with a little tile-scale fringe): where the
//     first is high, the region's first cover; elsewhere the second field picks between
//     the other two. Which cover is first varies by region, so any cover may border any
//     other. Each field's threshold is its quantile (noiseQuantile), so each cover's share
//     is as the style says.
const regionTiles = 600;          // spacing of the region points
const provinceTiles = 4000;       // ...and of the province points
const regionWarpTiles = 150;      // how far region borders bend from straight lines...
const regionWarpScaleTiles = 300; // ...over this length
const regionRagTiles = 25;        // and how far they wander at a finer scale...
const regionRagScaleTiles = 45;   // ...over this length
const regionBlendShare = 0.45;    // the share of borders that blend, not abrupt
const regionBlendMinTiles = 15, regionBlendMaxTiles = 150;
const regionOddShare = 0.2;
const coverOrder = ["grass", "dirt", "stone"];
// Themes: each cover's share [grass, dirt, stone]; the range of patch sizes, tiles; at
// most these shares of tiles with low bushes and with flowers (see UNDERGROWTH).
const coverThemes = [
  { cover: [0.85, 0.12, 0.03], patch: [20, 90], bush: 0.02, flowers: 0.10 },  // meadow
  { cover: [0.60, 0.30, 0.10], patch: [10, 50], bush: 0.12, flowers: 0.03 },  // scrub
  { cover: [0.30, 0.25, 0.45], patch: [5, 30], bush: 0.03, flowers: 0.01 },   // rocky
  { cover: [0.25, 0.60, 0.15], patch: [8, 60], bush: 0.05, flowers: 0.01 },   // barrens
  { cover: [0.50, 0.25, 0.25], patch: [6, 120], bush: 0.06, flowers: 0.05 },  // mixed
  { cover: [0.95, 0.04, 0.01], patch: [30, 150], bush: 0.01, flowers: 0.02 }, // grassland
];

// A hash of whole numbers (ix, iy) and a stream s: a 32-bit unsigned number.
function hashU(ix, iy, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s + terrainSeed * 7919, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function hash01(ix, iy, s) {
  return hashU(ix, iy, s) / 4294967296;
}

// Value noise: smooth, 0..1, varying over about 1 unit; stream s.
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, s), b = hash01(ix + 1, iy, s), c = hash01(ix, iy + 1, s), d = hash01(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// A field: value noise and, weighted rough, an octave finer; 0..1.
function noiseField(x, y, s, rough) {
  return (vnoise(x, y, s) + rough * vnoise(x * 2.7, y * 2.7, s + 1)) / (1 + rough);
}

// QUANTILES of noiseField for each roughness in coverRoughs: q[k] the value below which
// k/64 of it lies (sampled once, at load).
const coverRoughs = [0, 0.3, 0.6];
const noiseQuantiles = coverRoughs.map((rough, n) => {
  const xs = [];
  for (let k = 0; k < 8192; k++) xs.push(noiseField(hash01(k, n, 91) * 1000, hash01(k, n, 92) * 1000, 93, rough));
  xs.sort((p, q) => p - q);
  return Array.from({ length: 65 }, (_, k) => xs[Math.min(xs.length - 1, Math.floor(k / 64 * xs.length))]);
});

// The value of noiseField (roughness index r) below which share p of it lies.
function noiseQuantile(r, p) {
  const q = noiseQuantiles[r], x = Math.max(0, Math.min(64, p * 64)), k = Math.min(63, Math.floor(x));
  return q[k] + (q[k + 1] - q[k]) * (x - k);
}

// Directions a field may be stretched along: [dx, dy], unit length.
const stretchDirs = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];

// The point of region or province cell (cx, cy) on a grid `size` apart: [x, y].
function cellPoint(cx, cy, size, s) {
  return [(cx + 0.15 + 0.7 * hash01(cx, cy, s)) * size, (cy + 0.15 + 0.7 * hash01(cx, cy, s + 1)) * size];
}

// The theme of the province nearest (x, y).
function provinceThemeAt(x, y) {
  const cx = Math.floor(x / provinceTiles), cy = Math.floor(y / provinceTiles);
  let best = null, bestD2 = Infinity;
  for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
    const [px, py] = cellPoint(a, b, provinceTiles, 111);
    const d2 = (px - x) ** 2 + (py - y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = [a, b]; }
  }
  return coverThemes[hashU(best[0], best[1], 113) % coverThemes.length];
}

// A region's style, made once and kept (regionStyles; a few thousand at most are kept).
const regionStyles = new Map();
function regionStyle(cx, cy) {
  const key = cx * 100000 + cy;
  let r = regionStyles.get(key);
  if (r) return r;
  if (regionStyles.size > 4000) regionStyles.clear();
  const h = k => hash01(cx, cy, 120 + k);
  const [x, y] = cellPoint(cx, cy, regionTiles, 101);
  let theme = provinceThemeAt(x, y);
  if (h(0) < regionOddShare) theme = coverThemes[Math.floor(h(1) * coverThemes.length)];
  const shares = theme.cover.map((v, k) => v * (0.6 + 0.8 * h(2 + k)));
  const total = shares[0] + shares[1] + shares[2];
  // the first cover: any of the three, the likelier the more of it there is
  let pick = h(5) * total, first = 0;
  while (first < 2 && pick > shares[first]) pick -= shares[first++];
  const rest = [0, 1, 2].filter(k => k !== first);
  if (h(6) < 0.5) rest.reverse();
  const field = k => {
    const [lo, hi] = theme.patch, size = lo * (hi / lo) ** h(7 + k * 5);
    const stretch = h(8 + k * 5) < 0.5 ? 1 : 1.5 + 2.5 * h(9 + k * 5);
    const [dx, dy] = stretchDirs[Math.floor(h(10 + k * 5) * 4)];
    return { along: [dx / (size * stretch), dy / (size * stretch)], across: [-dy / size, dx / size],
      rough: Math.floor(h(11 + k * 5) * coverRoughs.length), s: 1000 + (hashU(cx, cy, 150 + k) & 0xffff) * 4 };
  };
  const a = field(0), b = field(1);
  const firstShare = shares[first] / total, secondShare = shares[rest[0]] / total;
  r = {
    cx, cy, x, y,
    first: coverOrder[first], second: coverOrder[rest[0]], third: coverOrder[rest[1]],
    a, b,
    aAbove: noiseQuantile(a.rough, 1 - firstShare),
    bAbove: noiseQuantile(b.rough, 1 - secondShare / Math.max(1e-6, 1 - firstShare)),
    fringe: 0.12 * h(17),                         // weight of the tile-scale raggedness
    warp: 0.8 * h(18) * (theme.patch[0] + theme.patch[1]) / 2, // how far patches bend, tiles
    warpScale: 1 / (theme.patch[0] + theme.patch[1]),
    soft: h(19) < regionBlendShare ? regionBlendMinTiles + (regionBlendMaxTiles - regionBlendMinTiles) * h(20) : 0,
    bush: theme.bush * (0.3 + 1.7 * h(21)), flowers: theme.flowers * (0.3 + 1.7 * h(22)),
    clump: 1 / (4 + 26 * h(23)),                  // undergrowth's clumps, about 4-30 tiles
  };
  regionStyles.set(key, r);
  return r;
}

// The region points that may be nearest some tile in [i0, i0 + n) x [j0, j0 + n), its
// borders warped: [{ x, y, style }].
function regionsNear(i0, j0, n) {
  const m = regionWarpTiles + regionRagTiles, out = [];
  for (let cx = Math.floor((i0 - m) / regionTiles) - 1; cx <= Math.floor((i0 + n + m) / regionTiles) + 1; cx++)
    for (let cy = Math.floor((j0 - m) / regionTiles) - 1; cy <= Math.floor((j0 + n + m) / regionTiles) + 1; cy++) {
      const style = regionStyle(cx, cy);
      out.push({ x: style.x, y: style.y, style });
    }
  return out;
}

// The style of the region tile (x, y) belongs to, among the points near (regionsNear).
// Near a blending border, either side's, patchily.
function regionAt(x, y, near) {
  const wx = x + regionWarpTiles * 2 * (vnoise(x / regionWarpScaleTiles, y / regionWarpScaleTiles, 1) - 0.5)
    + regionRagTiles * 2 * (vnoise(x / regionRagScaleTiles, y / regionRagScaleTiles, 3) - 0.5);
  const wy = y + regionWarpTiles * 2 * (vnoise(x / regionWarpScaleTiles, y / regionWarpScaleTiles, 2) - 0.5)
    + regionRagTiles * 2 * (vnoise(x / regionRagScaleTiles, y / regionRagScaleTiles, 4) - 0.5);
  let p = null, q = null, pd = Infinity, qd = Infinity;
  for (const r of near) {
    const d = (r.x - wx) ** 2 + (r.y - wy) ** 2;
    if (d < pd) { q = p; qd = pd; p = r; pd = d; } else if (d < qd) { q = r; qd = d; }
  }
  // a blending border: the far side's below a patchy threshold falling across the band
  // (distance to the border: (qd - pd) / (2 |pq|), compared squared)
  const w = Math.min(p.style.soft, q.style.soft);
  if (w > 0) {
    const t = 1 - 2 * vnoise(x / 9, y / 9, 5);
    if (t > 0 && (qd - pd) ** 2 < 4 * ((p.x - q.x) ** 2 + (p.y - q.y) ** 2) * w * w * t * t) return q.style;
  }
  return p.style;
}

// The ground cover of tile (x, y) in region style r.
function coverIn(r, x, y) {
  const wx = x + r.warp * 2 * (vnoise(x * r.warpScale, y * r.warpScale, 6) - 0.5);
  const wy = y + r.warp * 2 * (vnoise(x * r.warpScale, y * r.warpScale, 7) - 0.5);
  const fringe = r.fringe * (hash01(x, y, 8) - 0.5);
  const a = r.a, va = noiseField(wx * a.along[0] + wy * a.along[1], wx * a.across[0] + wy * a.across[1], a.s, coverRoughs[a.rough]);
  if (va + fringe > r.aAbove) return r.first;
  const b = r.b, vb = noiseField(wx * b.along[0] + wy * b.along[1], wx * b.across[0] + wy * b.across[1], b.s, coverRoughs[b.rough]);
  return vb + fringe > r.bAbove ? r.second : r.third;
}

// The ground cover of land tile (x, y) (not knowing whether it is land).
function groundCoverAt(x, y) {
  return coverIn(regionAt(x, y, regionsNear(x, y, 1)), x, y);
}

// UNDERGROWTH: low bushes and flowers on some land tiles (never under a boulder), about
// as many as the region's style says (its bush and flowers: shares of tiles), in clumps (a
// field at the region's clump size: none where it is below its middle; at most
// undergrowthClumpMost of the tiles even at a clump's heart). Flowers grow mostly on
// grass, bushes on grass and dirt, a few on stone (undergrowthOnCover). Short enough to
// step through and to see over, they neither block the way nor hide anything; deer eat
// them (see UNDERGROWTH FOOD).
const undergrowthKinds = [null, "bush", "flowers"];
const undergrowthClumpMost = 0.5;
const undergrowthOnCover = { bush: { grass: 1, dirt: 1, stone: 0.2 }, flowers: { grass: 1, dirt: 0.3, stone: 0 } };
// the mean of the clump field's part above its middle (sampled once, at load)
const clumpMean = (() => {
  let sum = 0;
  for (let k = 0; k < 8192; k++) sum += Math.max(0, vnoise(hash01(k, 0, 94) * 1000, hash01(k, 0, 95) * 1000, 96) - 0.5);
  return sum / 8192;
})();

// The undergrowth on land tile (x, y) of cover `cover` in region style r: an index into
// undergrowthKinds.
function undergrowthIn(r, x, y, cover) {
  const u = hash01(x, y, 10);
  const bush = Math.min(undergrowthClumpMost, r.bush * undergrowthOnCover.bush[cover] * Math.max(0, vnoise(x * r.clump, y * r.clump, 11) - 0.5) / clumpMean);
  if (u < bush) return 1;
  const flowers = Math.min(undergrowthClumpMost, r.flowers * undergrowthOnCover.flowers[cover] * Math.max(0, vnoise(x * r.clump, y * r.clump, 12) - 0.5) / clumpMean);
  return u < bush + flowers ? 2 : 0;
}

// "bush" or "flowers" if that grows on the tile containing (gx, gy), else null.
function undergrowthAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const b = terrainBlock(i, j);
  return undergrowthKinds[b.plant[(i - b.i0) * terrainBlockTiles + j - b.j0]];
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

// What blocks the way on the tile containing (gx, gy): "boulder", "pine" (a tree's trunk:
// see PINES; a sapling blocks nothing), else null.
function obstacleAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  return b.boulder[k] ? "boulder" : (b.pine[k] & pineSizeBits) > 1 ? "pine" : null;
}

// BOULDER FOOTPRINTS: each boulder is one of the artist's rocks (boulderRocks, measured
// from their sprites by spritecraft/measure_boulders.py: animat.js draws boulderRockAt's
// with its sprite), standing on part of its tile, which its sprite shows. A line of sight
// is stopped by the rock itself, not its whole tile: heading in direction d (sim's 8:
// E = +i, S = +j, ...), the rock spans `across[d]` = [lo, hi] along d's left-hand normal
// (-dy, dx), in tiles from the tile's center (see senses.js: walkLine). The colour goes
// with the ground under it (grey on stone, brown on dirt) and, on grass, a broad smooth
// field (rocks near each other, and along a wall, mostly share it); which rock of that
// colour, a hash of the tile: a pure function of the tile.
const boulderRocks = [ // across: [lo, hi] by direction (E, SE, S, SW, W, NW, N, NE)
  { colour: "brown", across: [[-0.33, 0.45], [-0.42, 0.38], [-0.42, 0.23], [-0.53, 0.31], [-0.45, 0.33], [-0.38, 0.42], [-0.23, 0.42], [-0.31, 0.53]] }, // tiles.png [9, 4]
  { colour: "brown", across: [[-0.61, 0.48], [-0.42, 0.51], [-0.45, 0.70], [-0.35, 0.62], [-0.48, 0.61], [-0.51, 0.42], [-0.70, 0.45], [-0.62, 0.35]] }, // tiles.png [10, 4]
  { colour: "brown", across: [[-0.48, 0.36], [-0.42, 0.46], [-0.45, 0.64], [-0.35, 0.57], [-0.36, 0.48], [-0.46, 0.42], [-0.64, 0.45], [-0.57, 0.35]] }, // tiles.png [0, 5]
  { colour: "brown", across: [[-0.67, 0.48], [-0.55, 0.60], [-0.45, 0.70], [-0.44, 0.75], [-0.48, 0.67], [-0.60, 0.55], [-0.70, 0.45], [-0.75, 0.44]] }, // tiles.png [1, 5]
  { colour: "brown", across: [[-0.48, 0.48], [-0.51, 0.60], [-0.48, 0.61], [-0.53, 0.62], [-0.48, 0.48], [-0.60, 0.51], [-0.61, 0.48], [-0.62, 0.53]] }, // tiles.png [2, 5]
  { colour: "brown", across: [[-0.42, 0.36], [-0.46, 0.29], [-0.42, 0.23], [-0.44, 0.35], [-0.36, 0.42], [-0.29, 0.46], [-0.23, 0.42], [-0.35, 0.44]] }, // tiles.png [3, 5]
  { colour: "brown", across: [[-0.27, 0.45], [-0.38, 0.51], [-0.48, 0.48], [-0.53, 0.40], [-0.45, 0.27], [-0.51, 0.38], [-0.48, 0.48], [-0.40, 0.53]] }, // tiles.png [4, 5]
  { colour: "brown", across: [[-0.67, 0.67], [-0.42, 0.60], [-0.33, 0.58], [-0.44, 0.62], [-0.67, 0.67], [-0.60, 0.42], [-0.58, 0.33], [-0.62, 0.44]] }, // tiles.png [5, 5]
  { colour: "grey", across: [[-0.61, 0.48], [-0.51, 0.51], [-0.48, 0.61], [-0.44, 0.62], [-0.48, 0.61], [-0.51, 0.51], [-0.61, 0.48], [-0.62, 0.44]] }, // tiles.png [7, 5]
  { colour: "grey", across: [[-0.55, 0.55], [-0.51, 0.51], [-0.48, 0.48], [-0.53, 0.53], [-0.55, 0.55], [-0.51, 0.51], [-0.48, 0.48], [-0.53, 0.53]] }, // tiles.png [9, 5]
  { colour: "grey", across: [[-0.55, 0.55], [-0.51, 0.51], [-0.48, 0.48], [-0.53, 0.53], [-0.55, 0.55], [-0.51, 0.51], [-0.48, 0.48], [-0.53, 0.53]] }, // tiles.png [10, 5]
  { colour: "grey", across: [[-0.36, 0.48], [-0.51, 0.42], [-0.73, 0.48], [-0.62, 0.35], [-0.48, 0.36], [-0.42, 0.51], [-0.48, 0.73], [-0.35, 0.62]] }, // tiles.png [0, 6]
  { colour: "grey", across: [[-0.64, 0.52], [-0.51, 0.51], [-0.48, 0.61], [-0.44, 0.62], [-0.52, 0.64], [-0.51, 0.51], [-0.61, 0.48], [-0.62, 0.44]] }, // tiles.png [1, 6]
];
const boulderRocksByColour = { brown: [], grey: [] };
boulderRocks.forEach((r, k) => boulderRocksByColour[r.colour].push(k));
const greyGrassAbove = 1.1; // of the colour field's 0..2 range: less than half the grass grey

// The rock (an index into boulderRocks) of the boulder on tile (i, j), which has one.
function boulderRockAt(i, j) {
  const terrain = getTerrainAt(i, j);
  const tri = x => 2 * Math.abs(x - Math.floor(x + 0.5)); // a triangle wave, 0..1
  const grey = terrain === "stone" || (terrain === "grass" && tri(i / 57 + 0.3) + tri(j / 49 + 0.6) > greyGrassAbove);
  const set = boulderRocksByColour[grey ? "grey" : "brown"];
  let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return set[((h ^ (h >>> 15)) >>> 0) % set.length];
}

// The span [lo, hi] of what stands on tile (i, j) across a line of sight heading dir (see
// BOULDER FOOTPRINTS; a pine's trunk or foliage, PINES); null for none.
function obstacleAcross(i, j, dir) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  if (b.boulder[k]) return boulderRocks[boulderRockAt(i, j)].across[dir];
  return b.pine[k] ? pineSpans[b.pineSpan[k]] : null;
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

// For tests: put a boulder on tile (i, j), or (on false) clear it of boulder and pine.
function setBoulder(i, j, on = true) {
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  b.boulder[k] = on ? 1 : 0;
  b.pine[k] = 0; b.pineSpan[k] = 0;
  b.tall[k] = on ? boulderHeightLevels * tallPerLevel : 0;
}

// Whether no critter can enter the tile containing (gx, gy).
function isBlockedTile(gx, gy) {
  return obstacleAt(gx, gy) !== null;
}

// Tile (i, j) for telling shores: 1 water (or off the map), 0 land with an obstacle on it,
// 2 open land.
function shoreKindAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 1;
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  return b.kind[k] === 3 ? 1 : b.boulder[k] || (b.pine[k] & pineSizeBits) > 1 ? 0 : 2;
}

// How high a boulder stands above the ground at its tile's center, in levels (see TERRAIN
// HEIGHT). The boulders' rocks are drawn 1.5 to 3 levels tall (12-25 px: 0.6-1.2 m); taken
// as 3, above a wolf's or a deer's eye, so a boulder hides what is behind it. (A pine's is
// its own: PINES.) Kept by tile in a block's `tall`, in 1/tallPerLevel levels.
const boulderHeightLevels = 3;
const tallPerLevel = 2;
const levelsPerMetre = Math.sqrt(6); // (see TERRAIN HEIGHT: 19.6 px / 8 px)

// How high what stands on tile (i, j) (a boulder, a pine or a sapling) rises above its
// ground, in levels (0: nothing).
function obstacleHeightAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  const b = terrainBlock(i, j);
  return b.tall[(i - b.i0) * terrainBlockTiles + j - b.j0] / tallPerLevel;
}

// PINES: pine forests in some parts of the map, open stands and lone pines in some others,
// none elsewhere; on land, never on a boulder's tile, fewer on stone. Figures (Arizona
// Cooperative Extension az1397, ponderosa pine; Michigan DNR, deer foods; the Forest
// Vegetation Simulator's Lake States variant, FVS-LS, eastern white pine):
//   Density: a forest's heart pineForestPerTile (600 a hectare, a tile being a square
//   metre: a closed forest, as today's unthinned stands are, far denser than the guide's
//   target), thinning out to its edge; open stands pineStandPerTile
//   (120 a hectare, as a restored ponderosa forest's 27-57 trees an acre over 4"), lone
//   pines pineLonePerTile. Trees keep apart: at most one in each pineCellTiles square, and
//   never two on neighbouring tiles, so a critter can always pass between two trunks.
//   Sizes: an uneven-aged stand has many small trees and few large (its "reverse J"):
//   trees an acre in the guide's 4" diameter classes (DBH, at breast height) 7.3, 5.9,
//   3.9, 3.1, 2.6, 2.1, 1.7 (pineClasses, in cm); saplings (under 10 cm) besides, more
//   of them toward a forest's edge and in open stands (pineSaplingShare).
//   Height (pineHeightM): FVS-LS's for white pine (Curtis-Arney): H = 4.5 + 2108.8442
//   e^(-5.6595 D^-0.1856) ft, D the DBH in inches: ~9 m at 10 cm, ~23 m at 40, ~33 m at
//   75. A sapling 0.6-3 m.
//   Crown (pineCrownRadiusM): its largest width, by FVS-LS's for white pine: grown in a
//   forest (Bechtold 2003), 0.3914 + 0.9923 D + 0.1080 CR ft (CR: the live crown, as a
//   percent of the height: pineCrownRatio's forest), at most 45 ft: ~1.3 m in radius at
//   10 cm, ~3.1 at 40, ~5.2 at 75; grown in the open (Ek 1974: lone pines and open stands),
//   1.62 + 3.197 D^0.7981 ft, at most 58 ft: ~1.7, ~4.6, ~7.5 m. A sapling's: its foliage.
//   Crowns block no sight (a sapling's and a small tree's foliage aside); animat.js draws
//   them, at real size.
// A tree's trunk blocks the way (obstacleAt "pine") and sight, as wide as its DBH; a small
// tree (the first class) keeps its low branches, so sight is blocked as wide as its
// foliage. A sapling blocks only sight, its foliage, up to its height: a deer sees over a
// short one, and a wolf lying behind it is hidden. In a block, by tile: pine (0 none; its
// size: 1 a sapling, 2.. a tree, by pineClasses + 2; plus pineOpenGrown if grown outside a
// forest), its span (pineSpan, an index into pineSpans:
// half its width in cm) and its height (tall, in levels). Deer browse the needles in reach (PINE
// BROWSE).
const pineCellTiles = 3;
const pineForestPerTile = 0.06, pineStandPerTile = 0.012, pineLonePerTile = 0.0015;
const pineForestShare = 0.18;   // of the land: forest
const pineForestEdge = 0.05;    // of the forest field's range: from its edge to its heart
const pineParkShare = 0.45;     // of the land outside forests: where stands and lone pines grow
const pineStandShare = 0.25;    // of that: stands
const pineOnCover = { grass: 1, dirt: 1, stone: 0.3 };
const pineClasses = [ // DBH, cm: [lo, hi], and trees an acre
  [10, 18, 7.3], [20, 28, 5.9], [30, 38, 3.9], [41, 48, 3.1], [51, 58, 2.6], [61, 69, 2.1], [71, 79, 1.7],
];
const pineClassTotal = pineClasses.reduce((t, c) => t + c[2], 0);
const pineSaplingShare = { heart: 0.25, edge: 0.6 };
const pineFoliageHalfM = 0.6;   // a small tree's foliage, or the widest sapling's
const pineSpans = Array.from({ length: 256 }, (_, cm) => [-cm / 100, cm / 100]);
const pineOpenGrown = 16, pineSizeBits = 15;
const pineCrownRatio = { forest: 0.4, open: 0.7 }; // (estimates)
const footM = 0.3048, inchCm = 2.54;

// A pine's height, m, by its DBH, cm (see PINES).
function pineHeightM(dbhCm) {
  return (4.5 + 2108.8442 * Math.exp(-5.6595 * Math.pow(dbhCm / inchCm, -0.1856))) * footM;
}

// A pine's crown at its widest, its radius, m, by its DBH, cm, and whether it grew in the
// open (see PINES).
function pineCrownRadiusM(dbhCm, open) {
  const d = dbhCm / inchCm;
  const ft = open ? Math.min(58, 1.62 + 3.197 * Math.pow(d, 0.7981))
    : Math.min(45, 0.3914 + 0.9923 * d + 0.1080 * pineCrownRatio.forest * 100);
  return ft * footM / 2;
}
const pineSeed = 141;

// The share of tiles a pine stands on near tile (x, y) of cover `cover`, and how far into
// a forest it is (0 outside or at its edge, 1 at its heart).
function pineDensityAt(x, y, cover) {
  const on = pineOnCover[cover];
  if (!on) return [0, 0];
  const f = noiseField(x / 600, y / 600, pineSeed, 0.6);
  const forest = (f - pineForestEdgeAt) / (pineForestHeartAt - pineForestEdgeAt);
  if (forest > 0) return [on * Math.max(pineStandPerTile, pineForestPerTile * Math.min(1, forest)), Math.min(1, forest)];
  if (noiseField(x / 900, y / 900, pineSeed + 2, 0) < pineParkAt) return [0, 0];
  return [on * (noiseField(x / 70, y / 70, pineSeed + 4, 0.3) > pineStandAt ? pineStandPerTile : pineLonePerTile), 0];
}
const pineForestEdgeAt = noiseQuantile(2, 1 - pineForestShare);
const pineForestHeartAt = pineForestEdgeAt + pineForestEdge;
const pineParkAt = noiseQuantile(0, 1 - pineParkShare);
const pineStandAt = noiseQuantile(1, 1 - pineStandShare);

// The tile of pine cell (ci, cj)'s one place a pine may stand: [i, j].
function pineSpotIn(ci, cj) {
  const h = hashU(ci, cj, pineSeed + 6);
  return [ci * pineCellTiles + h % pineCellTiles, cj * pineCellTiles + (h >>> 8) % pineCellTiles];
}

// Whether pine cell (ci, cj)'s spot is kept: not beside another cell's that comes first.
function pineSpotKeptIn(ci, cj) {
  const [x, y] = pineSpotIn(ci, cj), mine = hashU(ci, cj, pineSeed + 7);
  for (let a = ci - 1; a <= ci + 1; a++) for (let c = cj - 1; c <= cj + 1; c++) {
    if (a === ci && c === cj) continue;
    const [oi, oj] = pineSpotIn(a, c);
    if (Math.abs(oi - x) <= 1 && Math.abs(oj - y) <= 1 && hashU(a, c, pineSeed + 7) < mine) return false;
  }
  return true;
}
// the share of spots kept (sampled once, at load)
const pineSpotKept = (() => {
  let kept = 0;
  for (let k = 0; k < 4096; k++) kept += pineSpotKeptIn(k, 7 * k + 3);
  return kept / 4096;
})();

// The pine on land tile (x, y) of cover `cover`: [pine, span, tall] as a block keeps them
// (see PINES), or null. Most tiles are decided by the first test.
function pineIn(x, y, cover) {
  const ci = Math.floor(x / pineCellTiles), cj = Math.floor(y / pineCellTiles);
  const [si, sj] = pineSpotIn(ci, cj);
  if (si !== x || sj !== y || !pineSpotKeptIn(ci, cj)) return null;
  const [density, heart] = pineDensityAt(x, y, cover);
  if (hash01(x, y, pineSeed + 8) >= density * pineCellTiles * pineCellTiles / pineSpotKept) return null;
  const saplings = pineSaplingShare.edge + (pineSaplingShare.heart - pineSaplingShare.edge) * heart;
  const u = hash01(x, y, pineSeed + 9), v = hash01(x, y, pineSeed + 10);
  if (u < saplings) {
    const h = 0.6 + 2.4 * v;
    const half = Math.min(pineFoliageHalfM, 0.15 + 0.15 * h);
    return [1 + (heart ? 0 : pineOpenGrown), Math.round(half * 100), Math.round(h * levelsPerMetre * tallPerLevel)];
  }
  let w = (u - saplings) / (1 - saplings) * pineClassTotal, k = 0;
  while (k < pineClasses.length - 1 && w >= pineClasses[k][2]) w -= pineClasses[k++][2];
  const dbh = pineClasses[k][0] + (pineClasses[k][1] - pineClasses[k][0]) * v;
  const half = k === 0 ? pineFoliageHalfM : dbh / 200;
  return [k + 2 + (heart ? 0 : pineOpenGrown), Math.round(half * 100), Math.round(pineHeightM(dbh) * levelsPerMetre * tallPerLevel)];
}

// What grows on the tile containing (gx, gy): "sapling", "tree", or null.
function pineAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const b = terrainBlock(i, j), p = b.pine[(i - b.i0) * terrainBlockTiles + j - b.j0] & pineSizeBits;
  return p === 0 ? null : p === 1 ? "sapling" : "tree";
}

// The pine on tile (i, j) as a block keeps it: { size (1 a sapling, 2.. a tree's class + 2),
// open (grown in the open), halfM (half its width blocking sight), heightM }, or null.
function pineOn(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0, p = b.pine[k];
  return p ? { size: p & pineSizeBits, open: (p & pineOpenGrown) !== 0, halfM: b.pineSpan[k] / 100, heightM: b.tall[k] / tallPerLevel / levelsPerMetre } : null;
}

// For tests: put a pine of size `size` (as pineOn's) on tile (i, j), clearing a boulder.
function setPine(i, j, size, halfM, heightM, open = false) {
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  b.boulder[k] = 0; b.plant[k] = 0;
  b.pine[k] = size + (open ? pineOpenGrown : 0); b.pineSpan[k] = Math.round(halfM * 100); b.tall[k] = Math.round(heightM * levelsPerMetre * tallPerLevel);
}

// TERRAIN HEIGHT, in whole levels at tile corners; a tile's surface blends its four
// corners bilinearly. A level is drawn one block riser high (8 px: see animat.js); a metre
// up is drawn 19.6 px (the tiles' own projection: a metre across a tile's diagonal is
// 22.6 px, seen from 30 degrees up), so a level is 1/levelsPerMetre m (0.41 m). A vertex
// is at the floor of the land's height there (terrainMap). Water is flat, at the floor of
// its surface's height (waterLevelAt): the sea at 0, a lake at its level, a river falling
// from tile to tile; a vertex touching water is at the lowest water it touches. A tile
// whose corners would differ by 2 levels or more becomes a cliff tile: its corners are
// squeezed into [m, m + 1] (m: the floor of their average), so a cliff face stands
// between it and its neighbours. A critter can step up or down at most maxStepLevels.
const maxStepLevels = 1.5;

// TERRAIN CACHE: the terrain in blocks of terrainBlockTiles square, each worked out the
// first time anything asks about one of its tiles (a few milliseconds), kept while used,
// and the least recently used dropped beyond terrainBlocksKept (so memory stays bounded
// however far critters and the camera roam). A block holds, by tile: its kind (an index
// into terrainKinds), water's kind (into waterKinds) and level, its corners' levels and
// whether a boulder stands on it, its undergrowth (into undergrowthKinds), its pine (see
// PINES), how tall what stands on it is (tall); and its lowest and highest corner.
const terrainBlockTiles = 64;
const terrainBlocksKept = 800;
const terrainKinds = ["grass", "dirt", "stone", "water"];
const waterKinds = [null, "sea", "lake", "river"];
const noWater = -32768;
const terrainBlocks = new Map(); // bi * 100000 + bj -> block
let terrainBlockClock = 0;
let lastTerrainBlock = null;

function terrainBlock(i, j) {
  const B = terrainBlockTiles, bi = Math.floor(i / B), bj = Math.floor(j / B);
  let b = lastTerrainBlock;
  if (!b || b.bi !== bi || b.bj !== bj) {
    const key = bi * 100000 + bj;
    b = terrainBlocks.get(key);
    if (!b) {
      b = makeTerrainBlock(bi, bj);
      b.grassE = grassByBlock.get(key) || null;
      terrainBlocks.set(key, b);
      if (terrainBlocks.size > terrainBlocksKept) dropOldTerrainBlocks();
    }
    lastTerrainBlock = b;
  }
  b.used = ++terrainBlockClock;
  return b;
}

// Drops the least recently used tenth of the blocks.
function dropOldTerrainBlocks() {
  const byUse = [...terrainBlocks.entries()].sort((p, q) => p[1].used - q[1].used);
  for (const [key] of byUse.slice(0, Math.ceil(terrainBlocksKept / 10))) terrainBlocks.delete(key);
}

function makeTerrainBlock(bi, bj) {
  const B = terrainBlockTiles, i0 = bi * B, j0 = bj * B;
  // the water on each tile of the block and a tile around it: its kind and level
  const n = B + 2, wKind = new Uint8Array(n * n), wLevel = new Int16Array(n * n).fill(noWater);
  for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
    const i = i0 - 1 + a, j = j0 - 1 + c, k = a * n + c;
    if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) { wKind[k] = 1; wLevel[k] = 0; continue; }
    const t = terrainMap.terrainAt(i, j);
    if (t.kind === "land") continue;
    wKind[k] = waterKinds.indexOf(t.kind);
    wLevel[k] = Math.floor(t.height);
  }
  // each vertex's level: the lowest water it touches, else the land's
  const m = B + 1, vertex = new Int16Array(m * m);
  for (let a = 0; a < m; a++) for (let c = 0; c < m; c++) {
    let w = noWater;
    for (const k of [a * n + c, (a + 1) * n + c, a * n + c + 1, (a + 1) * n + c + 1])
      if (wLevel[k] !== noWater && (w === noWater || wLevel[k] < w)) w = wLevel[k];
    vertex[a * m + c] = w !== noWater ? w : Math.max(0, Math.floor(terrainMap.sampleAt(i0 + a, j0 + c).height));
  }
  const kind = new Uint8Array(B * B), waterKind = new Uint8Array(B * B), waterLevel = new Int16Array(B * B);
  const corners = new Int16Array(B * B * 4), boulder = new Uint8Array(B * B), plant = new Uint8Array(B * B);
  const pine = new Uint8Array(B * B), pineSpan = new Uint8Array(B * B), tall = new Uint8Array(B * B);
  const near = regionsNear(i0, j0, B);
  let minLevel = Infinity, maxLevel = -Infinity;
  for (let a = 0; a < B; a++) for (let c = 0; c < B; c++) {
    const i = i0 + a, j = j0 + c, k = a * B + c, wk = (a + 1) * n + c + 1;
    let cs;
    if (wLevel[wk] !== noWater) {
      kind[k] = 3; waterKind[k] = wKind[wk]; waterLevel[k] = wLevel[wk];
      cs = [wLevel[wk], wLevel[wk], wLevel[wk], wLevel[wk]];
    } else {
      const r = regionAt(i, j, near), cover = coverIn(r, i, j);
      kind[k] = terrainKinds.indexOf(cover);
      waterLevel[k] = noWater;
      boulder[k] = isBoulderSite(i, j) ? 1 : 0;
      const p = boulder[k] ? null : pineIn(i, j, cover);
      if (p) [pine[k], pineSpan[k], tall[k]] = p;
      else if (boulder[k]) tall[k] = boulderHeightLevels * tallPerLevel;
      plant[k] = boulder[k] || p ? 0 : undergrowthIn(r, i, j, cover);
      cs = [vertex[a * m + c], vertex[(a + 1) * m + c], vertex[a * m + c + 1], vertex[(a + 1) * m + c + 1]];
      if (Math.max(...cs) - Math.min(...cs) >= 2) {
        const mid = Math.floor((cs[0] + cs[1] + cs[2] + cs[3]) / 4);
        cs = cs.map(l => Math.min(mid + 1, Math.max(mid, l)));
      }
    }
    corners.set(cs, k * 4);
    minLevel = Math.min(minLevel, ...cs); maxLevel = Math.max(maxLevel, ...cs);
  }
  return { bi, bj, i0, j0, kind, waterKind, waterLevel, corners, boulder, plant, pine, pineSpan, tall, minLevel, maxLevel, used: 0 };
}

// The kind of water on tile (i, j) ("sea", "lake", "river"), or null on land. Off the
// map, the sea.
function waterKindAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return "sea";
  const b = terrainBlock(i, j);
  return waterKinds[b.waterKind[(i - b.i0) * terrainBlockTiles + j - b.j0]];
}

// The level of the water's surface on tile (i, j), or null on land.
function waterLevelAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  const b = terrainBlock(i, j), w = b.waterLevel[(i - b.i0) * terrainBlockTiles + j - b.j0];
  return w === noWater ? null : w;
}

// The lowest water level on the tiles around tile (i, j) and on it, or null if none.
function waterLevelNear(i, j) {
  let w = null;
  for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) {
    const l = waterLevelAt(a, c);
    if (l !== null && (w === null || l < w)) w = l;
  }
  return w;
}

// The corner levels [NW, NE, SW, SE] of tile (i, j), read only; off the map, the sea's.
const offMapCorners = new Int16Array(4);
function tileCorners(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return offMapCorners;
  const b = terrainBlock(i, j), k = ((i - b.i0) * terrainBlockTiles + j - b.j0) * 4;
  return b.corners.subarray(k, k + 4);
}

// For tests: sets tile (i, j)'s corner levels (while its block is kept).
function setTileCorners(i, j, cs) {
  const b = terrainBlock(i, j), k = ((i - b.i0) * terrainBlockTiles + j - b.j0) * 4;
  b.corners.set(cs, k);
  b.minLevel = Math.min(b.minLevel, ...cs); b.maxLevel = Math.max(b.maxLevel, ...cs);
}

// The lowest and highest corner levels of the tiles in [i0, i1] x [j0, j1] at most, by
// whole blocks: [min, max] (it may be a little wider).
function levelRangeIn(i0, j0, i1, j1) {
  const B = terrainBlockTiles;
  let lo = Infinity, hi = -Infinity;
  for (let bi = Math.floor(Math.max(0, i0) / B); bi <= Math.floor(Math.min(gridWidthN - 1, i1) / B); bi++)
    for (let bj = Math.floor(Math.max(0, j0) / B); bj <= Math.floor(Math.min(gridHeightN - 1, j1) / B); bj++) {
      const b = terrainBlock(bi * B, bj * B);
      lo = Math.min(lo, b.minLevel); hi = Math.max(hi, b.maxLevel);
    }
  return lo <= hi ? [lo, hi] : [0, 0];
}

// The height of the ground at tile (i, j)'s center: what a line of sight must clear over
// it, but for any obstacle (for senses.js).
function centerHeightAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0, c = b.corners;
  return (c[k * 4] + c[k * 4 + 1] + c[k * 4 + 2] + c[k * 4 + 3]) / 4;
}

// ...and with any obstacle on it: the height of the obstacle's top.
function sightHeightAt(i, j) {
  return centerHeightAt(i, j) + obstacleHeightAt(i, j);
}

// The ground's height, in levels, at any grid point.
function heightAt(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  const [nw, ne, sw, se] = tileCorners(i, j);
  const u = gx - i, v = gy - j;
  return nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
}

// Land a swimmer can climb onto: dry, unblocked, and with its lowest corner within a step
// of the water beside it (if any).
function isLandTile(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return false;
  if (getTerrainAt(i, j) === "water" || isBlockedTile(i, j)) return false;
  const w = waterLevelNear(i, j);
  return w === null || Math.min(...tileCorners(i, j)) <= w + maxStepLevels;
}

// CRITTERS
// Each is a plain object. Directions are indices into
// moveVecByDir, clockwise from grid E.
// The start's numbers, and the side of the deer's start square (THE START). A test may set
// others (simStart, before this loads), to run faster. Four wolves, two pairs (half
// male: init), to the 400 deer: a wolf lives off about 25 deer a year, and the deer can
// make up a quarter of their number a year at most (estimates), so about 100 deer to a wolf (real wolves
// live at about this ratio: Mech & Boitani 2003, Wolves); two pairs, so their young can
// find mates not of their family.
const startSetup = { wolves: 4, deer: 400, deerSideTiles: 724, ...globalThis.simStart };
const nWolves = startSetup.wolves;
const wolves = Array.from({length: nWolves}, () => ({}));
// THE PLAYER'S WOLF: wolves[0] at first. It lives and dies like any wolf; dying, and then
// as a corpse, it stays the player's until the next wolf is born: that newborn becomes the
// player's wolf. Meanwhile the player's intents do nothing.
let pcWolf = wolves[0];
const nDeer = startSetup.deer;
const deer = Array.from({length: nDeer}, () => ({}));

const allCritters = [];
const allCorpses = [];
const allLandTiles = [];  // every dry, unblocked tile of the start square (THE START)

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

// A critter placed at the start is a well-fed body of its age (see BODY), its meter
// wolfStartFood (a wolf) or anywhere from half full (a deer). A newborn is unpaired, its
// body `tissues` (from its mother's womb: see BREEDING), placed at random until its birth
// places it.
function initCritter(a, species, tissues = null) {
  const isNewborn = !!tissues;
  if (!a) return alert("Falsy ref to initCritter");
  if (a.kind) return alert("Already-kind ref to initCritter");
  a.kind = 'critter';
  a.species = species;
  a.lifespanS = drawLifespanS(species);
  // not newborn: an adult, somewhere between its mating age and half its lifespan
  const adultS = Math.min(canAtAgeBySpecies[species].mate, a.lifespanS / 2);
  a.birthTime = g_now - (isNewborn ? 0 : randBetween(adultS, a.lifespanS / 2));
  a.uid = g_next_uid++;
  setSex(a, Math.random() < 0.5);
  a.mateUid = null;        // its partner (see BREEDING)
  a.matingWith = null;     // ...or whoever it is mating with now
  a.parentUids = [];       // the mother first, if known
  a.generation = 0;        // those at the start 0; a newborn one past its younger-generation parent (BREEDING)
  a.youngUids = [];
  a.pregnancy = null;      // { since, dueAt, fatherUid, litter, generation (the litter's) }
  a.lastBredAt = -Infinity;
  a.speed = 0;
  a.targetSpeed = 0;
  a.wind = 1;
  a.stamina = 1;
  a.nursingOn = null;      // the mother it is suckling from (see BREEDING)
  a.bumpedTick = -Infinity; // (see COLLISIONS)
  a.touchedTick = -Infinity;
  a.womb = biomass();
  if (isNewborn) {
    a.frameKg = biomassKg(tissues); // (a well-fed body's weight: its mother's womb is made so)
    a.tissues = tissues;
    a.stomach = biomass();
    updateBody(a);
  } else setBodyByAge(a, species === "wolf" ? wolfStartFood : randBetween(0.5, 1));
  randomlyPlaceCritter(a);
  critterByUid.set(a.uid, a);
  return a;
}

// THE START: every wolf starts on a random land tile's center (allLandTiles) in one
// square, startTiles a side (startArea: { i0, j0, i1, j1 }, i1 and j1 just past it), and
// every deer on a random one in the square deerSideTiles a side (startSetup: about 2.8
// times as wide, twice the area of a 512-tile square) about the same center (deerArea, within the map). The start square is the first,
// spiralling out from the map's center by startSearchStepTiles, that is mostly land
// (startLandShare of startSamples^2 points in it) with a lake near (at startWaterMin of
// startSamples^2 points in the square startNearTiles a side about it), for swimming and
// shores, and fresh water (a lake or river) to drink near the center of each quarter of it
// (within startFreshTiles, along either axis: at one of the points startFreshStepTiles
// apart), so that every critter can find some soon. Sampled from terrainMap, not the cache.
const startTiles = 256;
const startNearTiles = 1024;
const startSearchStepTiles = 256;
const startFreshTiles = 48;
const startFreshStepTiles = 16;
const startSamples = 16;
const startLandShare = 0.85;
const startWaterMin = 3;
let startArea = null, deerArea = null;

function chooseStartArea() {
  const k = startSamples, c0 = Math.floor(gridWidthN / 2), c1 = Math.floor(gridHeightN / 2);
  // whether the hydrology graph has a lake or river node within startFreshTiles and half its
  // spacing of (x, y) (a quick test before sampling: fresh water could be that near)
  const G = terrainMap.graph, riverMin = terrainMap.P.riverMinNodes, near2 = (startFreshTiles + G.S / 2) ** 2;
  const graphFreshNear = (x, y) => {
    const gi = Math.round(x / G.S), gj = Math.round(y / G.S);
    for (let a = Math.max(0, gi - 1); a <= Math.min(G.nx - 1, gi + 1); a++)
      for (let b = Math.max(0, gj - 1); b <= Math.min(G.ny - 1, gj + 1); b++) {
        const n = a * G.ny + b;
        if ((G.lake[n] >= 0 || !G.ocean[n] && G.flow[n] >= riverMin) && (G.px[n] - x) ** 2 + (G.py[n] - y) ** 2 <= near2) return true;
      }
    return false;
  };
  // ...and a lake node in the square startNearTiles a side about (x, y)
  const graphLakeNear = (x, y) => {
    const r = startNearTiles / 2;
    for (let a = Math.max(0, Math.floor((x - r) / G.S)); a <= Math.min(G.nx - 1, Math.ceil((x + r) / G.S)); a++)
      for (let b = Math.max(0, Math.floor((y - r) / G.S)); b <= Math.min(G.ny - 1, Math.ceil((y + r) / G.S)); b++)
        if (G.lake[a * G.ny + b] >= 0) return true;
    return false;
  };
  const fits = (ci, cj) => {
    // fresh water near the center of each quarter of the square (the rarest, so first)
    const s = startFreshStepTiles, f = startFreshTiles, q = startTiles / 4;
    const quarters = [[ci - q, cj - q], [ci + q, cj - q], [ci - q, cj + q], [ci + q, cj + q]];
    if (!quarters.every(([x, y]) => graphFreshNear(x, y))) return false;
    for (const [x, y] of quarters) {
      let fresh = false;
      for (let a = -f; a <= f && !fresh; a += s) for (let b = -f; b <= f && !fresh; b += s) {
        const kind = terrainMap.terrainAt(x + a, y + b).kind;
        fresh = kind === "lake" || kind === "river";
      }
      if (!fresh) return false;
    }
    const at = (side, a, b) => terrainMap.terrainAt(ci + Math.floor((a + 0.5) / k * side - side / 2),
      cj + Math.floor((b + 0.5) / k * side - side / 2)).kind;
    if (!graphLakeNear(ci, cj)) return false;
    let notLand = 0, lakes = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++)
      if (at(startTiles, a, b) !== "land" && ++notLand > (1 - startLandShare) * k * k) return false;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++)
      if (at(startNearTiles, a, b) === "lake" && ++lakes >= startWaterMin) return true;
    return false;
  };
  const most = Math.floor(Math.min(gridWidthN, gridHeightN) / 2 / startSearchStepTiles) - 1;
  let at = [c0, c1];
  search: for (let r = 0; r <= most; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const ci = c0 + di * startSearchStepTiles, cj = c1 + dj * startSearchStepTiles;
    if (fits(ci, cj)) { at = [ci, cj]; break search; }
  }
  const i0 = at[0] - startTiles / 2, j0 = at[1] - startTiles / 2;
  startArea = { i0, j0, i1: i0 + startTiles, j1: j0 + startTiles };
  allLandTiles.length = 0;
  for (let i = startArea.i0; i < startArea.i1; i++) for (let j = startArea.j0; j < startArea.j1; j++)
    if (getTerrainAt(i, j) !== "water" && !isBlockedTile(i, j)) allLandTiles.push([i, j]);
  const m = (startSetup.deerSideTiles - startTiles) / 2;
  deerArea = { i0: Math.max(0, startArea.i0 - m), j0: Math.max(0, startArea.j0 - m),
    i1: Math.min(gridWidthN, startArea.i1 + m), j1: Math.min(gridHeightN, startArea.j1 + m) };
}
// A random dry, unblocked tile in the deer's start square: [i, j]. (Drawn till one is: the
// start square within it is mostly land.)
function randomDeerLandTile() {
  const A = deerArea;
  for (let n = 0; n < 10000; n++) {
    const i = A.i0 + Math.floor(Math.random() * (A.i1 - A.i0)), j = A.j0 + Math.floor(Math.random() * (A.j1 - A.j0));
    if (getTerrainAt(i, j) !== "water" && !isBlockedTile(i, j)) return [i, j];
  }
  return alert("No land found in the deer's start square");
}

// On a random land tile's center in its species' start square, facing one of the 4
// diagonals, standing.
function randomlyPlaceCritter(a) {
  if (!startArea) chooseStartArea();
  const [randLandX, randLandY] = a.species === "deer" ? randomDeerLandTile() : sample(allLandTiles);
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

// DEATHS: a critter dies of "starvation" (its food meter empty), "dehydration" (its water
// meter empty), "predation" (killed by a wolf: see COLLISIONS) or "old age" (FORCED
// MORTALITY): a.diedOf. Each death is logged to the console (logDeath). cause may be the
// killer instead (for tests: predation); with none, "unknown".
function startCritterDeath(a, cause = "unknown") {
  if (!a || a.kind !== "critter") return alert("Invalid arg to startCritterDeath");
  if (a.pose === "death") return;
  a.diedOf = typeof cause === "string" ? cause : cause && cause.kind === "critter" ? "predation" : "unknown";
  logDeath(a);
  endPairing(a);
  a.deathTime = g_now;
  a.speed = a.targetSpeed = 0;
  a.nextGX = a.gx;
  a.nextGY = a.gy;
  a.eating = false;
  a.nursingOn = null;
  a.taking = false;
  dropLeg(a);
  if (a.species === "deer") { // (wolves aren't eaten)
    a.carcass = newCarcass(a);
    a.carcassFullKg = carcassMeatKg(a);
  }
  setPose(a, "death");
  enqDelayed("decontrol", deathDurationSBySpecies[a.species], { a: a });
}

// A dying critter's line in the console: who, its age (as the real animal's: scaled back
// by the speeds' metabolism, see GAME SPEEDS; and in game seconds since its birth, which
// pass as the clock on the wall at full speed), sex, generation, meters as a share full,
// and cause.
function logDeath(a) {
  const ageS = g_now - a.birthTime, realS = ageS * REALISTIC.foodFullS.wolf / SPEEDS.foodFullS.wolf, pct = v => `${Math.round(100 * v)}%`;
  const age = realS >= yearS ? `${(realS / yearS).toFixed(1)} years` : `${(realS / dayS).toFixed(1)} days`;
  console.log(`[death] ${a.species} ${a.uid}: ${a.diedOf}; age ${age} (realtimeElapsedAge ${ageS.toFixed(1)} s), ` +
    `${a.isMale ? "male" : "female"}, generation ${a.generation}; meters: food ${pct(a.food)}, stomach ${pct(a.gut)}, ` +
    `water ${pct(a.water)}, wind ${pct(a.wind)}, stamina ${pct(a.stamina)}`);
}

// BIOMASS: everything living is made of five things, in kg: fat, carbohydrate ("carbs"),
// protein, water and minerals (everything else: the skeleton's matrix most of all). A
// biomass is { fatKg, carbsKg, proteinKg, waterKg, mineralKg } (NUTRIENTS); its mass is
// their sum (biomassKg), its energy that of its fat, carbs and protein (energyMJ).
// Only plants (grass and undergrowth) make biomass, from air and soil by sunlight (none
// of which is counted); besides, a critter drinks water (lakes and rivers aren't counted)
// and its burning makes water (with the air's oxygen: see WATER in BODY). Everything else
// MOVES it: from plants or a carcass into an eater's stomach, from a stomach into the body, from a mother into
// her womb or her young's stomachs; or spends it, and it leaves the world: burned by
// metabolism, excreted (water breathed out and evaporated too), or rotted away with a
// corpse. A body can turn carbs into fat and back, and protein into either, keeping their
// energy, and their mass (the balance is water: fatPerCarbsKg); nothing makes protein.
// THE LEDGER (biomassLedger) adds up, in kg, all plants have grown, all water drunk or
// made, and all that has left the world, by how: so the world's biomass (worldBiomassKg)
// is always what it was, plus what came in, less what left (ledgerNetKg;
// tests/biomass.test.js). Plants count only as they differ from uneaten ones, and their
// growth likewise (see KEPT ONLY WHERE GRAZED and UNDERGROWTH FOOD in FOOD).
const NUTRIENTS = ["fatKg", "carbsKg", "proteinKg", "waterKg", "mineralKg"];
const fatPerCarbsKg = carbsMJPerKg / fatMJPerKg;
const biomassLedger = { grownKg: 0, drunkKg: 0, madeWaterKg: 0, burnedKg: 0, excretedKg: 0, rottedKg: 0, lostKg: 0 };
const ledgerInKeys = ["grownKg", "drunkKg", "madeWaterKg"];
// What has come into the world, less what has left it, kg.
function ledgerNetKg() {
  let kg = 0;
  for (const [k, v] of Object.entries(biomassLedger)) kg += ledgerInKeys.includes(k) ? v : -v;
  return kg;
}

// A biomass: kg of these shares (none: empty).
function biomass(shares = null, kg = 0) {
  return {
    fatKg: shares ? shares.fatKg * kg : 0, carbsKg: shares ? shares.carbsKg * kg : 0,
    proteinKg: shares ? shares.proteinKg * kg : 0, waterKg: shares ? shares.waterKg * kg : 0,
    mineralKg: shares ? shares.mineralKg * kg : 0,
  };
}
function biomassKg(b) { return b.fatKg + b.carbsKg + b.proteinKg + b.waterKg + b.mineralKg; }
function energyMJ(b) { return b.fatKg * fatMJPerKg + b.carbsKg * carbsMJPerKg + b.proteinKg * proteinMJPerKg; }

// Moves `share` (0 to 1) of every part of `from` into `to` (null: out of the world, into
// the ledger's `left`). The kg moved.
function moveShare(from, to, share, left = null) {
  // (each of NUTRIENTS, in their order)
  const fat = from.fatKg * share, carbs = from.carbsKg * share, protein = from.proteinKg * share,
    water = from.waterKg * share, mineral = from.mineralKg * share;
  from.fatKg -= fat; from.carbsKg -= carbs; from.proteinKg -= protein; from.waterKg -= water; from.mineralKg -= mineral;
  if (to) { to.fatKg += fat; to.carbsKg += carbs; to.proteinKg += protein; to.waterKg += water; to.mineralKg += mineral; }
  const kg = 0 + fat + carbs + protein + water + mineral;
  if (left) biomassLedger[left] += kg;
  return kg;
}
function moveAll(from, to, left = null) { return moveShare(from, to, 1, left); }

// Turns kg of b's carbs (key "carbsKg") or protein ("proteinKg") into fat and water.
function toFat(b, key, kg) {
  b[key] -= kg;
  b.fatKg += kg * fatPerCarbsKg;
  b.waterKg += kg * (1 - fatPerCarbsKg);
}
// Makes up to kg of carbs in b from its fat (taking up water), then its protein. The kg made.
function makeCarbs(b, kg) {
  const fat = Math.max(0, Math.min(b.fatKg, kg * fatPerCarbsKg, b.waterKg * fatPerCarbsKg / (1 - fatPerCarbsKg)));
  b.fatKg -= fat;
  b.waterKg -= fat * (1 / fatPerCarbsKg - 1);
  b.carbsKg += fat / fatPerCarbsKg;
  const protein = Math.max(0, Math.min(b.proteinKg, kg - fat / fatPerCarbsKg));
  b.proteinKg -= protein;
  b.carbsKg += protein;
  return fat / fatPerCarbsKg + protein;
}

// Moves `want` (a biomass) out of body b into `to`, as near as b allows, keeping
// keepMineralKg of its minerals: fat it lacks it makes from its protein, carbs from its fat
// or protein. What it moved.
function withdraw(b, want, to, keepMineralKg = 0) {
  if (b.fatKg < want.fatKg) toFat(b, "proteinKg", Math.min(b.proteinKg, (want.fatKg - b.fatKg) / fatPerCarbsKg));
  if (b.carbsKg < want.carbsKg) makeCarbs(b, want.carbsKg - b.carbsKg);
  const got = biomass();
  for (const k of NUTRIENTS) {
    const v = Math.max(0, Math.min(want[k], b[k] - (k === "mineralKg" ? keepMineralKg : 0)));
    b[k] -= v;
    to[k] += v;
    got[k] = v;
  }
  return got;
}

// Burns mj of body b: its carbs first, then fat, then protein. The kg burned (it leaves
// the world).
function burn(b, mj) {
  let kg = 0;
  for (const [key, perKg] of [["carbsKg", carbsMJPerKg], ["fatKg", fatMJPerKg], ["proteinKg", proteinMJPerKg]]) {
    if (!(mj > 0)) break;
    const v = Math.min(b[key], mj / perKg);
    b[key] -= v;
    mj -= v * perKg;
    kg += v;
  }
  return kg;
}

// FOOD
// Critters eat into their stomachs (see BODY): a deer the plants on its tile (its
// undergrowth first, then its grass), a wolf a carcass in reach, once old enough to "eat"
// (and an infant suckles: see BREEDING), as fast as SPEEDS.eatKgPerS (but see FEEDING
// TIME), while the stomach has room.
//
// GRASS: every grass tile holds grass, fresh kg (grassShares): at most SPEEDS.grassMaxKg
// (under a boulder, rockGrassShare of that: grassMostAt), starting at grassStartShare of
// that, regrowing at SPEEDS.grassRegrowKgPerS (plants, grass, undergrowth and pines, are
// the only makers of biomass). Its HEIGHT (bare, short, medium, tall) is for the view; tiles
// whose height changes are logged (grassChangesSince) so the view redraws only those. It
// grows on every tile at once, and is kept only where grazed (KEPT ONLY WHERE GRAZED).
// UNDERGROWTH FOOD: each low bush or flowers (see UNDERGROWTH) holds plant mass of its
// own, fresh kg (undergrowthShares): at most undergrowthMostKg, as it starts, regrowing at
// SPEEDS.undergrowthRegrowKgPerS (it too makes biomass). A deer eats it before the grass
// on its tile. Kept only where eaten (undergrowthTouched, by tile index: its kg and when),
// until grown back; flowers eaten below flowersShownFrom of their most aren't drawn.
// PINE BROWSE: the needles in a deer's reach on a sapling or a small tree (see PINE
// NEEDLES), fresh kg (pineShares): at most pineMostKgBySize, as it starts, regrowing at
// SPEEDS.pineRegrowShare of that a second. Kept only where eaten (pineTouched), as
// undergrowth. A deer strips needles at the dry matter rate it crops grass (so about half
// as much fresh: pineBiteShare), eating them last on its tile: a sapling's from on its
// tile, a small tree's from beside it (as grass under a boulder).
// PLANT FOOD: a tile's grass, undergrowth and pine browse together (plantFoodAt,
// plantMostAt), what a grazing deer looks for.
// UNDER A BOULDER: a deer eats grass under a boulder it stands right beside
// (inGrassReach), turning to face it: the EAT intent with `at`, the boulder's tile. It
// eats at the same rate, so the little there is goes in a third of the time. So too on a
// tree's tile (a blocked tile like a boulder's): its grass, and a small tree's needles.
//
// CARCASSES: a dead deer's whole biomass (its body, stomach and womb) becomes its carcass:
// its bone (all its minerals, with bone's share of the rest: boneShares), and its soft
// tissue, the rest. Wolves eat the soft tissue and boneEdibleShare of the bone: that is
// the meat, in 8 pieces (c.carcass, a biomass by piece name); the rest of the bone lies
// (c.bones). c.carcassFullKg is the meat at the death. Like any corpse, it rots away (and
// leaves the world) SPEEDS.corpseLastsS after the death, and never blocks the way (see
// COLLISIONS). Wolves eat one piece until it is gone, then another picked at random from
// those left (c.eatingPiece is shared by every wolf at the carcass). The view shows each
// piece as meat until all of it is eaten.
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

// The carcass of a (dead): all its biomass, out of its body, stomach and womb.
function newCarcass(a) {
  const all = biomass();
  for (const b of [a.tissues, a.stomach, a.womb]) moveAll(b, all);
  const m = all.mineralKg, boneKg = m / boneShares.mineralKg;
  const bone = biomass();
  for (const k of NUTRIENTS) {
    bone[k] = k === "mineralKg" ? m : Math.min(all[k], boneShares[k] * boneKg);
    all[k] -= bone[k]; // (leaving the soft tissue)
  }
  moveShare(bone, all, boneEdibleShare);
  return {
    pieces: Object.fromEntries(carcassPieces.map(([name, share]) => {
      const piece = biomass();
      for (const k of NUTRIENTS) piece[k] = all[k] * share;
      return [name, piece];
    })),
    bones: bone,
  };
}

// The meat left of a piece of corpse c (carcassPieces), kg.
function carcassPieceKg(c, name) { return c.carcass ? biomassKg(c.carcass.pieces[name]) : 0; }

// The meat left on corpse c, kg.
function carcassMeatKg(c) {
  return c.carcass ? carcassPieces.reduce((sum, [name]) => sum + biomassKg(c.carcass.pieces[name]), 0) : 0;
}

// KEPT ONLY WHERE GRAZED: untouched grass is the same on every tile with the same most
// (grassMostAt): the start, plus all that has grown since (grassGrownKg), up to the most.
// A grazed tile is kept (grassTouched, by tile index i * gridHeightN + j: its kg as of
// grassGrownKg then, its most and its height) until it has grown back to its most and
// untouched grass has too. So the world's grass counts in the biomass only as it differs
// from untouched grass (grassTotalKg): grazing takes from that, and the ledger's grownKg
// is what grazed tiles regrow beyond what untouched grass does meanwhile.
const grassTouched = new Map();
// (the same by terrain block, for looking one up fast: block key -> { n: its grazed tiles,
// v: for the tile at index k in the block, v[3k] its kg, v[3k + 1] as of when (NaN: not
// grazed), v[3k + 2] its most }; a block in play has its own as b.grassE)
const grassByBlock = new Map();
const grassSpan = 3;
let grassGrownKg = 0;
const grassChanges = [];   // tile indices whose height changed, oldest first
let grassChangesBase = 0;  // the serial number of grassChanges[0]

function heightOfGrass(kg) {
  const share = kg / SPEEDS.grassMaxKg;
  return share >= grassTallFrom ? 3 : share >= grassMediumFrom ? 2 : share >= grassShortFrom ? 1 : 0;
}

function untouchedGrassKg(most, grown = grassGrownKg) {
  return Math.min(most, grassStartShare * SPEEDS.grassMaxKg + grown);
}

function grassNow(e) {
  return Math.min(e.most, e.kg + grassGrownKg - e.at);
}

function initGrass() {
  grassTouched.clear();
  grassByBlock.clear();
  for (const b of terrainBlocks.values()) b.grassE = null;
  undergrowthTouched.clear();
  pineTouched.clear();
  plantClockS = 0;
  grassGrownKg = 0;
  grassChangesAll();
}

function logGrassChange(k) {
  grassChanges.push(k);
  if (grassChanges.length > 50000) { // drop the older half
    grassChanges.splice(0, 25000);
    grassChangesBase += 25000;
  }
}

// Every tile may have changed height: the log starts afresh, past every serial given out.
function grassChangesAll() {
  grassChangesBase += grassChanges.length + 1;
  grassChanges.length = 0;
}

// Sets the grass on tile index k to kg: how much it changed by.
function setGrassKg(k, kg) {
  const i = Math.floor(k / gridHeightN), j = k % gridHeightN;
  if (getTerrainAt(i, j) !== "grass") return 0;
  let e = grassTouched.get(k);
  const most = grassMostAt(i, j);
  const before = e ? grassNow(e) : untouchedGrassKg(most);
  if (!e) {
    grassTouched.set(k, e = { kg, at: grassGrownKg, most, h: heightOfGrass(before) });
    const b = terrainBlock(i, j);
    if (!b.grassE) grassByBlock.set(b.bi * 100000 + b.bj, b.grassE = { n: 0, v: new Float64Array(grassSpan * terrainBlockTiles * terrainBlockTiles).fill(NaN) });
    b.grassE.n++;
  }
  e.kg = Math.min(most, kg); e.at = grassGrownKg;
  {
    const b = terrainBlock(i, j), v = b.grassE.v, at = grassSpan * ((i - b.i0) * terrainBlockTiles + j - b.j0);
    v[at] = e.kg; v[at + 1] = e.at; v[at + 2] = e.most;
  }
  const h = heightOfGrass(e.kg);
  if (h !== e.h) { e.h = h; logGrassChange(k); }
  return e.kg - before;
}

// Grass grows on every tile for dtS seconds.
function growGrass(dtS) {
  const g0 = grassGrownKg, g1 = g0 + SPEEDS.grassRegrowKgPerS * dtS;
  let grown = 0;
  grassGrownKg = g1;
  for (const [k, e] of grassTouched) {
    const was = Math.min(e.most, e.kg + g0 - e.at), now = grassNow(e);
    const untouchedNow = untouchedGrassKg(e.most, g1);
    grown += (now - untouchedNow) - (was - untouchedGrassKg(e.most, g0));
    const h = heightOfGrass(now);
    if (h !== e.h) { e.h = h; logGrassChange(k); }
    if (now >= e.most && untouchedNow >= e.most) {
      grassTouched.delete(k);
      const i = Math.floor(k / gridHeightN), j = k % gridHeightN, B = terrainBlockTiles;
      const key = Math.floor(i / B) * 100000 + Math.floor(j / B), g = grassByBlock.get(key);
      g.v[grassSpan * ((i % B) * B + j % B) + 1] = NaN;
      if (--g.n === 0) { // (none left in its block)
        grassByBlock.delete(key);
        const b = terrainBlocks.get(key);
        if (b) b.grassE = null;
      }
    }
  }
  biomassLedger.grownKg += grown;
  // untouched grass taller: everywhere at once
  for (const most of [SPEEDS.grassMaxKg, SPEEDS.grassMaxKg * rockGrassShare])
    if (heightOfGrass(untouchedGrassKg(most, g0)) !== heightOfGrass(untouchedGrassKg(most, g1))) grassChangesAll();
}

// The most grass tile (i, j) can hold, kg (0 where it isn't grass).
function grassMostAt(i, j) {
  if (getTerrainAt(i, j) !== "grass") return 0;
  return SPEEDS.grassMaxKg * (isBlockedTile(i, j) ? rockGrassShare : 1);
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
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  return grassInBlock(b, k);
}

// The same, for the tile at index k of terrain block b.
function grassInBlock(b, k) {
  if (b.grassE !== null) {
    const v = b.grassE.v, at = v[grassSpan * k + 1];
    if (at === at) return Math.min(v[grassSpan * k + 2], v[grassSpan * k] + grassGrownKg - at); // (grazed: as grassNow)
  }
  if (b.kind[k] !== 0) return 0; // (not grass)
  const blocked = b.boulder[k] || (b.pine[k] & pineSizeBits) > 1;
  return untouchedGrassKg(SPEEDS.grassMaxKg * (blocked ? rockGrassShare : 1));
}

// The height of the grass on tile (i, j): 0 bare, 1 short, 2 medium, 3 tall; -1 if not grass.
function grassHeightAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN || getTerrainAt(i, j) !== "grass") return -1;
  return heightOfGrass(grassFoodAt(i, j));
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

// The world's grass as it differs from untouched grass, kg (see KEPT ONLY WHERE GRAZED).
function grassTotalKg() {
  let kg = 0;
  for (const e of grassTouched.values()) kg += grassNow(e) - untouchedGrassKg(e.most);
  return kg;
}

const undergrowthTouched = new Map();
const flowersShownFrom = 1 / 4;
let plantClockS = 0; // growing time so far (as for grass: while the sun is up, sped up to make up the night)

// The plant mass of the undergrowth on tile (i, j), fresh kg; 0 where there is none.
function undergrowthFoodAt(i, j) {
  const u = undergrowthAt(i, j);
  if (!u) return 0;
  const e = undergrowthTouched.get(i * gridHeightN + j);
  return e ? Math.min(undergrowthMostKg[u], e.kg + SPEEDS.undergrowthRegrowKgPerS[u] * (plantClockS - e.at)) : undergrowthMostKg[u];
}

// Sets the undergrowth on tile (i, j) to kg (it has some): how much it changed by.
function setUndergrowthKg(i, j, kg) {
  const u = undergrowthAt(i, j), before = undergrowthFoodAt(i, j);
  kg = Math.max(0, Math.min(undergrowthMostKg[u], kg));
  undergrowthTouched.set(i * gridHeightN + j, { kg, at: plantClockS, kind: u });
  return kg - before;
}

// Undergrowth regrows for dtS seconds: the ledger counts it; what has grown back is
// forgotten.
function growUndergrowth(dtS) {
  plantClockS += dtS;
  let grown = 0;
  for (const [k, e] of undergrowthTouched) {
    const now = Math.min(undergrowthMostKg[e.kind], e.kg + SPEEDS.undergrowthRegrowKgPerS[e.kind] * (plantClockS - e.at));
    grown += now - e.kg;
    if (now >= undergrowthMostKg[e.kind]) undergrowthTouched.delete(k);
    else { e.kg = now; e.at = plantClockS; }
  }
  biomassLedger.grownKg += grown;
}

// The world's undergrowth as it differs from untouched undergrowth, kg.
function undergrowthTotalKg() {
  let kg = 0;
  for (const [k, e] of undergrowthTouched)
    kg += Math.min(undergrowthMostKg[e.kind], e.kg + SPEEDS.undergrowthRegrowKgPerS[e.kind] * (plantClockS - e.at)) - undergrowthMostKg[e.kind];
  return kg;
}

const pineTouched = new Map();
const pineBiteShare = grassDryShare / pineDryShare;

// The most pine browse tile (i, j) can hold, fresh kg.
function pineMostAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  const b = terrainBlock(i, j), p = b.pine[(i - b.i0) * terrainBlockTiles + j - b.j0];
  return p ? pineMostKgBySize[p & pineSizeBits] : 0;
}

// The pine browse on tile (i, j), fresh kg.
function pineFoodAt(i, j) {
  const most = pineMostAt(i, j);
  if (!most) return 0;
  const e = pineTouched.get(i * gridHeightN + j);
  return e ? Math.min(most, e.kg + most * SPEEDS.pineRegrowShare * (plantClockS - e.at)) : most;
}

// Sets the pine browse on tile (i, j) to kg (it has some): how much it changed by.
function setPineKg(i, j, kg) {
  const most = pineMostAt(i, j), before = pineFoodAt(i, j);
  kg = Math.max(0, Math.min(most, kg));
  pineTouched.set(i * gridHeightN + j, { kg, at: plantClockS, most });
  return kg - before;
}

// Pine browse regrows to the plant clock (after growUndergrowth moves it on): the ledger
// counts it; what has grown back is forgotten.
function growPines() {
  let grown = 0;
  for (const [k, e] of pineTouched) {
    const now = Math.min(e.most, e.kg + e.most * SPEEDS.pineRegrowShare * (plantClockS - e.at));
    grown += now - e.kg;
    if (now >= e.most) pineTouched.delete(k);
    else { e.kg = now; e.at = plantClockS; }
  }
  biomassLedger.grownKg += grown;
}

// The world's pine browse as it differs from untouched, kg.
function pineTotalKg() {
  let kg = 0;
  for (const e of pineTouched.values()) kg += Math.min(e.most, e.kg + e.most * SPEEDS.pineRegrowShare * (plantClockS - e.at)) - e.most;
  return kg;
}

// Whether the undergrowth on tile (i, j) shows (flowers eaten nearly bare don't).
function undergrowthShownAt(i, j) {
  const u = undergrowthAt(i, j);
  return u === "bush" || (u === "flowers" && undergrowthFoodAt(i, j) >= flowersShownFrom * undergrowthMostKg.flowers);
}

// PLANT FOOD on tile (i, j): its grass, undergrowth and pine browse, fresh kg.
function plantFoodAt(i, j) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return 0;
  const b = terrainBlock(i, j), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
  let kg = grassInBlock(b, k);
  kg += b.plant[k] ? undergrowthFoodAt(i, j) : 0;
  return kg + (b.pine[k] ? pineFoodAt(i, j) : 0);
}

// The most plant food tile (i, j) can hold, fresh kg.
function plantMostAt(i, j) {
  const u = undergrowthAt(i, j);
  return grassMostAt(i, j) + (u ? undergrowthMostKg[u] : 0) + pineMostAt(i, j);
}

// The nearest corpse within a's reach with meat left (withLeg: and a leg to tear off), or null.
function carcassInReach(a, withLeg = false) {
  let best = null, bestL2 = eatReachTiles * eatReachTiles;
  for (const c of allCorpses) {
    if (!c.carcass || withLeg && !legToTake(c)) continue;
    const l2 = (c.gx - a.gx) ** 2 + (c.gy - a.gy) ** 2;
    if (l2 <= bestL2 && carcassMeatKg(c) > 0) { best = c; bestL2 = l2; }
  }
  return best;
}

// One tick of a's eating, into its stomach (see FOOD).
function eat(a) {
  let bite = Math.min(SPEEDS.eatKgPerS[a.species] * tempo, stomachRoomKg(a));
  if (a.species === "deer") {
    if (!(bite > 0)) return;
    let i = Math.floor(a.gx), j = Math.floor(a.gy);
    if (a.eatAt && inGrassReach(a, a.eatAt[0], a.eatAt[1])) { // grass under a boulder beside it
      [i, j] = a.eatAt;
      a.currentDirection = getDir(i + 0.5 - a.gx, j + 0.5 - a.gy, a.currentDirection);
    }
    if (isInWater(a)) return;
    // the undergrowth first, then the grass
    const u = undergrowthAt(i, j);
    if (u) {
      const ukg = undergrowthFoodAt(i, j), take = Math.min(bite, ukg);
      if (take > 0) {
        const taken = -setUndergrowthKg(i, j, ukg - take);
        for (const k of NUTRIENTS) a.stomach[k] += undergrowthShares[u][k] * taken;
        bite -= taken;
      }
    }
    const kg = grassFoodAt(i, j);
    const take = Math.min(bite, kg);
    if (take > 0) {
      const taken = -setGrassKg(i * gridHeightN + j, kg - take);
      for (const k of NUTRIENTS) a.stomach[k] += grassShares[k] * taken;
      bite -= taken;
    }
    const pkg = pineFoodAt(i, j), ptake = Math.min(bite * pineBiteShare, pkg);
    if (ptake > 0) {
      const taken = -setPineKg(i, j, pkg - ptake);
      for (const k of NUTRIENTS) a.stomach[k] += pineShares[k] * taken;
    }
    return;
  }
  if (a.carrying) { // (the leg in its mouth: CARRYING)
    bite = Math.min(mealBiteKg(a, "meat", SPEEDS.eatKgPerS[a.species]), stomachRoomKg(a));
    const kg = biomassKg(a.carrying.food);
    moveShare(a.carrying.food, a.stomach, bite >= kg - 1e-9 ? 1 : bite / kg);
    legEaten(a); mealEaten(a);
    return;
  }
  const c = carcassInReach(a);
  if (!c) { a.meal = null; return; }
  bite = Math.min(mealBiteKg(a, "meat", SPEEDS.eatKgPerS[a.species]), stomachRoomKg(a));
  while (bite > 1e-12) {
    const pieces = c.carcass.pieces;
    if (!(biomassKg(pieces[c.eatingPiece] ?? biomass()) > 1e-9)) {
      const left = carcassPieces.filter(([name]) => pieces[name] && biomassKg(pieces[name]) > 1e-9);
      if (!left.length) break;
      c.eatingPiece = left[Math.floor(Math.random() * left.length)][0];
    }
    const piece = pieces[c.eatingPiece], kg = biomassKg(piece);
    bite -= moveShare(piece, a.stomach, bite >= kg - 1e-9 ? 1 : bite / kg);
  }
  mealEaten(a);
}

// FEEDING TIME: a wolf at a carcass, or an infant suckling, eats a meal: what its stomach
// has room for when it starts, taken in evenly over at least SPEEDS.feedingMinS, if eating
// (or suckling) as fast as it can would take less (a.meal: { kind, kgPerS }), as well as
// what its stomach passes on meanwhile (a.dripKg, the last tick's). The meal ends when its
// stomach is full, it stops eating, or it eats something else; eating on, it starts
// another, so it keeps its stomach topped up. (Deer cropping grass take long enough on
// their own.)
// The most a's meal lets it eat this tick, kg.
function mealBiteKg(a, kind, fastestKgPerS) {
  if (!a.meal || a.meal.kind !== kind)
    a.meal = { kind, kgPerS: Math.min(fastestKgPerS, stomachRoomKg(a) / SPEEDS.feedingMinS) };
  return Math.min(fastestKgPerS * tempo, a.meal.kgPerS * tempo + (a.dripKg || 0));
}
// Burns mj of tissues t (burn), which makes water (metabolicWaterPerKg).
function metabolize(t, mj) {
  const f = t.fatKg, c = t.carbsKg, p = t.proteinKg;
  biomassLedger.burnedKg += burn(t, mj);
  const made = (f - t.fatKg) * metabolicWaterPerKg.fatKg + (c - t.carbsKg) * metabolicWaterPerKg.carbsKg
    + (p - t.proteinKg) * metabolicWaterPerKg.proteinKg;
  t.waterKg += made;
  biomassLedger.madeWaterKg += made;
}

// After a's bite: a full stomach ends its meal.
function mealEaten(a) {
  if (!(stomachRoomKg(a) > 1e-12)) a.meal = null;
}

// CARRYING: a wolf grown, or in its last young stage (canCarry), tears a leg off a
// carcass in its reach (intent "take": tearLegS of tugging, standing still) and carries it
// in its mouth (a.carrying: { piece, food (the leg's meat, a biomass), from (the carcass),
// uid (the leg's own, once put down) }), however it goes, drawing it (animat.js:
// CARRYING). It takes the leg with the most meat left that is still on the carcass
// (carcassLegs); torn off, that leg is drawn on the carcass neither as meat nor as bones
// (c.carcass.torn). It puts the leg down (intent "drop"; or dying) as a morsel: a corpse
// of its own (c.morsel: the leg's name) at its mouth, holding just that leg's meat, drawn
// as just that leg, and spreading no death scent. A leg, carried or put down, rots away
// with the carcass it came from. A wolf with a leg in its mouth that eats eats the leg.
const carcassLegs = ["skyHind", "groundHind", "skyFore", "groundFore"];
const tearLegS = 2;            // tugging a leg off (estimate)
const mouthTiles = 0.5;        // a morsel put down lies this far ahead of the wolf's middle

function canCarry(a) {
  return a.species === "wolf" && isLiveCritter(a) && (youngStage(a) === 0 || youngStage(a) === youngScales.length);
}

// The leg corpse c would give up (the most meat, still on it), or null.
function legToTake(c) {
  if (!c || !c.carcass || c.morsel) return null;
  let best = null, bestKg = 1e-9;
  for (const name of carcassLegs) {
    if (c.carcass.torn?.has(name)) continue;
    const kg = carcassPieceKg(c, name);
    if (kg > bestKg) { best = name; bestKg = kg; }
  }
  return best;
}

// One tick of a's tugging at a leg of the carcass in its reach: torn off after tearLegS.
function tugLeg(a) {
  const c = canCarry(a) && !a.carrying ? carcassInReach(a, true) : null, piece = legToTake(c);
  if (!piece) { a.tugS = 0; return; }
  a.tugS = (a.tugS || 0) + tempo;
  if (a.tugS < tearLegS - 1e-9) return;
  a.tugS = 0;
  const food = biomass();
  moveAll(c.carcass.pieces[piece], food);
  (c.carcass.torn || (c.carcass.torn = new Set())).add(piece);
  if (c.eatingPiece === piece) c.eatingPiece = null;
  a.carrying = { piece, food, from: c, uid: g_next_uid++ }; // (the uid it will lie as, put down)
  a.currentDirection = getDir(c.gx - a.gx, c.gy - a.gy, a.currentDirection);
}

// a puts down the leg it carries, as a morsel at its mouth (on land: in the water, just
// where it is).
function dropLeg(a) {
  const l = a.carrying;
  if (!l) return null;
  a.carrying = null;
  const [hx, hy] = a.hx !== undefined ? [a.hx, a.hy] : moveVecByDir[a.currentDirection];
  let x = a.gx + hx * mouthTiles, y = a.gy + hy * mouthTiles;
  if (!isInWater(a) && (isWaterAt(x, y, 0) || !canStepTo(a, x, y))) { x = a.gx; y = a.gy; }
  const pieces = Object.fromEntries(carcassPieces.map(([name]) => [name, biomass()]));
  pieces[l.piece] = l.food;
  const m = { ...l.from, uid: l.uid, kind: "corpse", morsel: l.piece, gx: x, gy: y, nextGX: x, nextGY: y,
    speed: 0, pose: "dead", poseTick: g_tick, tissues: biomass(), stomach: biomass(), womb: biomass(),
    carcass: { pieces, bones: biomass(), torn: new Set() }, carcassFullKg: biomassKg(l.food),
    eatingPiece: l.piece, deathScent: null, carrying: null };
  allCorpses.push(m);
  return m;
}

// a's leg's last bite: it has eaten the whole leg.
function legEaten(a) {
  if (a.carrying && !(biomassKg(a.carrying.food) > 1e-12)) a.carrying = null;
}

// BODY: a critter's biomass is in three places: its body's tissues (a.tissues), its
// stomach (a.stomach) and, pregnant, its womb (a.womb: see BREEDING), each a biomass.
// FRAME: its size, a.frameKg: the weight of a well-fed body of its build (bodySharesBySpecies),
// as published weights are taken. Its meters, and how much of each part its tissues hold
// at most, go by its frame:
//   FOOD METER (a.food): the energy its tissues hold, from 0 at the lethal point (no fat or
//   carbs, and lethalProteinShare of a well-fed body's protein) to 1 at a well-fed body's
//   energy, or more (a.food stops at 1; fat has no limit). At the lethal point it dies of
//   hunger.
//   STOMACH METER (a.gut): the energy in its stomach, from 0 (empty) to 1 (a full stomach
//   of its usual food: usualFoodShares). The stomach holds stomachShareBySpecies of its
//   frame's weight; a.stomachFull, whether it is (as good as) full, whatever is in it (a
//   stomach full of poorer food reads less than full on the meter).
//   WATER METER (a.water): the water its tissues hold, from 0 (short of the water that goes
//   with their protein by lethalWaterShare of its frame's weight) to 1 (none short). At 0
//   it dies of thirst.
// METABOLISM: it burns its tissues (carbs, then fat, then protein: burn) so that a full
// meter lasts SPEEDS.foodFullS (an infant's, SPEEDS.infantFoodFullS), at the same pace
// whatever its meter.
// DIGESTION: its stomach drips whatever is in it on to the body, the faster the fuller
// (THE STOMACH'S DRIP), until empty. Of the drip, the body takes in
// (absorb): the carbs it digests (carbsDigestedBySpecies; an infant all), the rest of
// them, as fibre, excreted; protein and carbs up to a well-fed body's, and the rest of
// them made into fat; all the fat; and water. Its tissues keep the water that goes with
// their protein (a well-fed body's water to protein) and no more: the rest is excreted.
// WATER: its burning makes water (metabolicWaterPerKg), and it loses water as fast as it
// burns energy (waterLossKgPerMJ; under GAMIFIED its need is cut so a full meter lasts
// gameThirstS with neither food nor water), to be made up from its food and by drinking. Eating
// (the EAT intent: standing still, or swimming on) with fresh water (a lake or river, not
// the sea) in reach (waterInReach), it drinks it too, SPEEDS.drinkKgPerKgS of its frame a
// second, while its tissues are short of water. Grass holds all the water a deer grazing
// its fill needs; meat about half a wolf's (see Water above).
// GROWTH: its frame grows only from what it digests: by the minerals in it (once its
// tissues have their frame's), when the protein it digests with them can fill its frame's
// protein as it grows (so the young grow only when well fed), up to its adult weight
// (a.adultKg), at most growFastestRatio times as fast as a well-fed critter grows
// (growthAgesS); minerals it can't use are excreted. Its frame never shrinks. A mother
// gives minerals to her womb and milk (BREEDING) from her bones, down to
// mineralKeepShare of her frame's, and makes them up from what she digests.
const growFastestRatio = 2; // the fastest it grows, over a well-fed critter's pace (estimate)
const mineralKeepShare = 0.8; // estimate
const stomachFullRoomShare = 0.01; // a stomach with no more room than this share of it is full (a.stomachFull)
const drinkReachTiles = 0.3;       // reaches water this far from its box (estimate)...
const drinkReachLevels = 1;        // ...this far below the ground under it (estimate)
const fullBodyMJPerKg = Object.fromEntries(Object.keys(bodySharesBySpecies).map(sp => [sp, fullMJPerKg(sp)]));
const lethalBodyMJPerKg = Object.fromEntries(Object.keys(bodySharesBySpecies).map(sp => [sp, lethalMJPerKg(sp)]));
const leanWaterPerKg = Object.fromEntries(Object.entries(bodySharesBySpecies).map(([sp, s]) => [sp, s.waterKg / s.proteinKg]));
// Meat: a well-fed deer's soft tissue and the bone wolves eat with it (as newCarcass).
const meatShares = (() => {
  const body = bodySharesBySpecies.deer, boneKg = body.mineralKg / boneShares.mineralKg, m = biomass();
  for (const k of NUTRIENTS) m[k] = body[k] - (1 - boneEdibleShare) * Math.min(body[k], boneShares[k] * boneKg);
  const kg = biomassKg(m);
  for (const k of NUTRIENTS) m[k] /= kg;
  return m;
})();
const usualFoodShares = { wolf: meatShares, deer: grassShares };

function rangeMJ(a) { return a.frameKg * rangeMJPerKg(a.species); }
function stomachKg(a) { return stomachShareBySpecies[a.species] * a.frameKg; }
// The minerals its body keeps, giving to its womb or milk (see GROWTH).
function mineralKeptKg(a) { return mineralKeepShare * a.frameKg * bodySharesBySpecies[a.species].mineralKg; }
function stomachRoomKg(a) { return Math.max(0, stomachKg(a) - biomassKg(a.stomach)); }
function fullStomachMJ(a) {
  return stomachKg(a) * energyMJ(isInfant(a) ? milkSharesBySpecies[a.species] : usualFoodShares[a.species]);
}
function foodLastsS(a) { return (isInfant(a) ? SPEEDS.infantFoodFullS : SPEEDS.foodFullS)[a.species]; }
// Its stomach's T (THE STOMACH'S DRIP), seconds.
function stomachTS(a) { return stomachTShareBySpecies[a.species] * foodLastsS(a); }
// Its meter's share, uncapped: 0 or less, starved.
function foodShare(a) {
  const w = a.frameKg, lethal = w * lethalBodyMJPerKg[a.species];
  return (energyMJ(a.tissues) - lethal) / (w * fullBodyMJPerKg[a.species] - lethal);
}

// Its sex, and the weights that go with it.
function setSex(a, isMale) {
  a.isMale = isMale;
  const sex = isMale ? "male" : "female", kg = bodyKgBySpecies[a.species];
  a.adultKg = kg[sex];
  a.birthKg = kg.birth[sex];
}

// A well-fed body of frame w, less what it burns to bring its meter down to `food`.
function bodyOf(species, w, food = 1) {
  const b = biomass(bodySharesBySpecies[species], w);
  burn(b, (1 - food) * w * rangeMJPerKg(species));
  b.waterKg = Math.min(b.waterKg, b.proteinKg * leanWaterPerKg[species]);
  return b;
}

// Its body: of frame w, its meter at `food`, its stomach empty (for critters placed at the
// start, and tests).
function setBody(a, w, food = 1) {
  a.frameKg = w;
  a.tissues = bodyOf(a.species, w, food);
  a.stomach = biomass();
  updateBody(a);
}

// Its body as a well-fed critter's of its age.
function setBodyByAge(a, food = 1) {
  setBody(a, a.birthKg + (a.adultKg - a.birthKg) * growthShare(a.species, Math.max(0, ageS(a))), food);
}

// For tests: its body rebuilt at its frame, its meter at `food`, its stomach empty.
function setFood(a, food) { setBody(a, a.frameKg, food); }

// Its tissues' water, down to what goes with their protein (the rest excreted).
function balanceWater(a) {
  const t = a.tissues, most = t.proteinKg * leanWaterPerKg[a.species];
  if (t.waterKg > most) { biomassLedger.excretedKg += t.waterKg - most; t.waterKg = most; }
}

// Its water meter's share, uncapped: 0 or less, dead of thirst (see WATER).
function waterShare(a) {
  const t = a.tissues;
  return 1 - Math.max(0, t.proteinKg * leanWaterPerKg[a.species] - t.waterKg) / (lethalWaterShare * a.frameKg);
}

// The water critter a can drink (see WATER), the sea's too unless freshOnly: swimming,
// the water it is in; on land, the nearest within its reach: { i, j, kind }, or null.
function waterInReach(a, freshOnly = false) {
  const ci = Math.floor(a.gx), cj = Math.floor(a.gy), reach = a.boxRad + drinkReachTiles;
  if (isInWater(a)) {
    const kind = waterKindAt(ci, cj);
    return kind && !(freshOnly && kind === "sea") ? { i: ci, j: cj, kind } : null;
  }
  const low = heightAt(a.gx, a.gy) - drinkReachLevels;
  let best = null, bestGap = Infinity;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const kind = waterKindAt(i, j);
    if (!kind || freshOnly && kind === "sea" || waterLevelAt(i, j) < low) continue;
    const gap = Math.max(Math.abs(i + 0.5 - a.gx), Math.abs(j + 0.5 - a.gy)) - 0.5;
    if (gap <= reach && gap < bestGap) { best = { i, j, kind }; bestGap = gap; }
  }
  return best;
}

// For tests of other things: while held, every critter's tissues are kept full of water
// (as if drinking all the while).
let waterHeld = false;
function holdWater(on) { waterHeld = on; }

// One tick of a's drinking (see WATER).
function drink(a) {
  const t = a.tissues, short = t.proteinKg * leanWaterPerKg[a.species] - t.waterKg;
  if (!(short > 0) || !waterInReach(a, true)) return;
  const kg = Math.min(short, SPEEDS.drinkKgPerKgS[a.species] * a.frameKg * tempo);
  t.waterKg += kg;
  biomassLedger.drunkKg += kg;
}

// Its body takes in d, a biomass from its stomach (see BODY: DIGESTION and GROWTH).
function absorb(a, d) {
  const t = a.tissues, s = bodySharesBySpecies[a.species];
  const fibre = isInfant(a) ? 0 : d.carbsKg * (1 - carbsDigestedBySpecies[a.species]);
  d.carbsKg -= fibre;
  const w = a.frameKg;
  const refill = Math.max(0, Math.min(d.mineralKg, w * s.mineralKg - t.mineralKg));
  t.mineralKg += refill;
  d.mineralKg -= refill;
  const grow = Math.max(0, Math.min(a.adultKg - w, growFastestRatio * growthKgPerS(a) * tempo,
    d.mineralKg / s.mineralKg, (t.proteinKg + d.proteinKg) / s.proteinKg - w));
  const minerals = grow * s.mineralKg;
  t.mineralKg += minerals;
  biomassLedger.excretedKg += fibre + d.mineralKg - minerals;
  const w2 = a.frameKg = w + grow;
  for (const key of ["proteinKg", "carbsKg"]) {
    const keep = Math.max(0, Math.min(d[key], w2 * s[key] - t[key]));
    t[key] += d[key];
    toFat(t, key, d[key] - keep);
  }
  t.fatKg += d.fatKg;
  t.waterKg += d.waterKg;
}

// One tick of a's body: it burns, loses water, eats and drinks, digests, and its womb
// grows. What it died of ("starvation", "dehydration"), or null.
function updateFood(a) {
  if (!isLiveCritter(a)) return null;
  const t = a.tissues, mj = rangeMJ(a) * tempo / foodLastsS(a);
  metabolize(t, mj);
  const lose = Math.min(t.waterKg, waterLossKgPerMJ(a.species) * mj);
  t.waterKg -= lose;
  biomassLedger.excretedKg += lose;
  if (!a.eating) a.meal = null;
  a.nursingOn = a.eating && isInfant(a) ? nurse(a) : null;
  if (a.eating && a.nursingOn === null && _can(a, "eat")) { eat(a); drink(a); }
  if (a.taking) tugLeg(a); else a.tugS = 0;
  const kg = biomassKg(a.stomach);
  if (kg > 0) {
    const drip = biomass();
    a.dripKg = moveShare(a.stomach, drip, Math.min(1, Math.max(kg, stomachDripLeastShare * stomachKg(a)) * tempo / stomachTS(a) / kg));
    absorb(a, drip);
  } else a.dripKg = 0;
  if (waterHeld) {
    const short = t.proteinKg * leanWaterPerKg[a.species] - t.waterKg;
    if (short > 0) { t.waterKg += short; biomassLedger.drunkKg += short; }
  }
  balanceWater(a);
  updateWomb(a);
  updateBody(a);
  return foodShare(a) <= 0 ? "starvation" : waterShare(a) <= 0 ? "dehydration" : null;
}

// How fast a well-fed critter's frame grows at a's size, kg a second.
function growthKgPerS(a) {
  const ages = SPEEDS.growthAgesS[a.species], shares = growthSharesBySpecies[a.species];
  const p = growthProgress(a);
  let k = 1;
  while (k < shares.length - 1 && shares[k] <= p) k++;
  return (shares[k] - shares[k - 1]) / (ages[k] - ages[k - 1]) * (a.adultKg - a.birthKg);
}

// All the biomass in the world: grass, undergrowth, critters, corpses and carcasses, kg
// (plants as they differ from untouched).
function worldBiomassKg() {
  let kg = grassTotalKg() + undergrowthTotalKg() + pineTotalKg();
  for (const a of allCritters.concat(allCorpses)) {
    for (const b of [a.tissues, a.stomach, a.womb]) kg += biomassKg(b);
    if (a.carcass) kg += carcassMeatKg(a) + biomassKg(a.carcass.bones);
    if (a.carrying) kg += biomassKg(a.carrying.food);
  }
  return kg;
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

// For tests: hold the clock at an hour of the starting day (null: let it run).
let heldHour = null;
function holdClock(hour) { heldHour = hour; updateClock(); }

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

// SCENT AND WIND
// SCENT TRAILS: every live critter on dry land marks the tile under its middle with its
// species' scent each tick: the tile keeps when it was last marked by each species, and by
// whom. Scent fades: at age t its strength is 2^(-t / SPEEDS.scentHalfLifeS) (senses.js
// decides how faint a scent each critter can still smell). A young wolf (not grown) never
// marks over a mark of a parent's, so its parents' trails stay whole for it to find them
// by. Water holds no scent, the shore's included (a critter half on land marks nothing
// over water). Only marked tiles are kept, until scentKeepHalfLives half-lives old
// (fainter than anything can smell): a mark older than scentOldest counts as gone
// (ScentMarks; swept every scentSweepTicks).
// DEATH SCENT: a carcass spreads death scent (its own kind, scentMarks.death, by the
// carcass's uid) over the land within deathScentTiles of it: out to a circle that grows
// over deathScentGrowS from the death (each tile as the circle reaches it, once its death
// pose is done), and again over the whole circle every deathScentRenewS while the corpse
// lasts. Each tile's mark is
// made older by deathScentAgeSPerTile for each tile from the carcass, so the scent is
// always stronger toward it (a fresher mark is never replaced by an older one). A mark
// tells whether the carcass had meat on it when laid; once it has none, it lays its whole
// circle afresh at once (so the ground about it soon tells it is bare).
// WIND: one breeze over the whole map, blowing toward the unit vector (windX, windY); every
// SPEEDS.windChangeEveryS it turns by up to windTurnMaxRad either way. (No scent rides
// it for now: see SMELL in senses.js.)
const scentSpecies = ["wolf", "deer", "death"];
const deathScentTiles = 20;
const deathScentGrowS = 20;
const deathScentRenewS = 5 * 60;
const deathScentAgeSPerTile = SPEEDS.scentHalfLifeS / 40; // (at the edge, half a half-life older)
// The tiles within deathScentTiles of a point, nearest first: [di, dj, distance].
const deathScentDisk = (() => {
  const out = [], R = deathScentTiles;
  for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
    const d = Math.sqrt(di * di + dj * dj);
    if (d <= R) out.push([di, dj, d]);
  }
  return out.sort((p, q) => p[2] - q[2]);
})();
const windTurnMaxRad = Math.PI / 6;
const scentKeepHalfLives = 4; // (senses.js: the faintest smelled is 1/8, 3 half-lives)
let scentMarks = null; // by species: a ScentMarks, each tile's last mark
let scentOldest = -Infinity; // marks older are gone (as of the last tick's marking)
const scentSweepTicks = 3600;

// One kind of scent's marks: each tile's last, its game time, maker's uid and (death
// scent) whether meaty, kept by blocks of terrainBlockTiles a side (a block with none
// left that count is dropped at the sweep). For tests it also reads and writes as a Map
// of tile index (i * gridHeightN + j) -> [game time, uid, meaty].
class ScentMarks {
  constructor() { this.blocks = new Map(); this.last = null; }
  // The block of tile (i, j), made if `make`; else null.
  block(i, j, make) {
    const B = terrainBlockTiles, bi = Math.floor(i / B), bj = Math.floor(j / B);
    let b = this.last;
    if (b !== null && b.bi === bi && b.bj === bj) return b;
    const key = bi * 100000 + bj;
    b = this.blocks.get(key);
    if (!b) {
      if (!make) return null;
      b = { bi, bj, i0: bi * B, j0: bj * B, latest: -Infinity,
        at: new Float64Array(B * B).fill(-Infinity), uid: new Int32Array(B * B), meaty: new Uint8Array(B * B) };
      this.blocks.set(key, b);
    }
    return this.last = b;
  }
  mark(i, j, at, uid, meaty = true) {
    const b = this.block(i, j, true), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
    b.at[k] = at; b.uid[k] = uid; b.meaty[k] = meaty === false ? 0 : 1;
    if (at > b.latest) b.latest = at;
  }
  // Drops the blocks whose marks are all older than `oldest`.
  sweep(oldest) {
    for (const [key, b] of this.blocks) if (b.latest < oldest) this.blocks.delete(key);
    this.last = null;
  }
  clear() { this.blocks.clear(); this.last = null; }
  set(key, m) { this.mark(Math.floor(key / gridHeightN), key % gridHeightN, m[0], m[1], m[2]); return this; }
  get(key) {
    const i = Math.floor(key / gridHeightN), j = key % gridHeightN, b = this.block(i, j, false);
    if (b === null) return undefined;
    const k = (i - b.i0) * terrainBlockTiles + j - b.j0;
    return b.at[k] === -Infinity ? undefined : [b.at[k], b.uid[k], b.meaty[k] === 1];
  }
  delete(key) {
    const i = Math.floor(key / gridHeightN), j = key % gridHeightN, b = this.block(i, j, false);
    if (b !== null) b.at[(i - b.i0) * terrainBlockTiles + j - b.j0] = -Infinity;
  }
  get size() {
    let n = 0;
    for (const b of this.blocks.values()) for (let k = 0; k < b.at.length; k++) if (b.at[k] >= scentOldest) n++;
    return n;
  }
}
let windAngle = Math.random() * 2 * Math.PI;
let windX = Math.cos(windAngle), windY = Math.sin(windAngle);

function initScent() {
  scentMarks = {};
  scentOldest = -Infinity;
  for (const sp of scentSpecies) scentMarks[sp] = new ScentMarks();
}

function markScent() {
  for (const a of allCritters) {
    if (!isLiveCritter(a) || isInWater(a)) continue;
    const i = Math.floor(a.gx), j = Math.floor(a.gy);
    if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) continue;
    if (getTerrainAt(i, j) === "water") continue; // (a critter on land, its middle over the shore's water)
    const marks = scentMarks[a.species], b = marks.block(i, j, true), k = (i - b.i0) * terrainBlockTiles + j - b.j0;
    // (a young wolf never covers a parent's mark: it can always find their trail)
    if (a.species === "wolf" && b.at[k] !== -Infinity && b.at[k] >= scentOldest && !isGrown(a) && a.parentUids.includes(b.uid[k])) continue;
    b.at[k] = g_now; b.uid[k] = a.uid; b.latest = g_now;
  }
  // the marks too old to matter
  scentOldest = g_now - scentKeepHalfLives * SPEEDS.scentHalfLifeS;
  if (g_tick % scentSweepTicks === 0) for (const marks of Object.values(scentMarks)) marks.sweep(scentOldest);
}

// Death scent from every carcass (see DEATH SCENT), each tick: its growing circle, and its
// renewal when due. c.deathScent: { since, next (the disk's index it has reached), renewedAt,
// meaty (whether it had meat at its last marks) }.
function spreadDeathScent() {
  for (const c of allCorpses) {
    if (!c.carcass || c.morsel) continue;
    const meaty = carcassMeatKg(c) > 0;
    const ds = c.deathScent || (c.deathScent = { since: c.deathTime, next: 0, renewedAt: c.deathTime, meaty });
    const ci = Math.floor(c.gx), cj = Math.floor(c.gy);
    const lay = (di, dj, d) => {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN || getTerrainAt(i, j) === "water") return;
      const at = g_now - d * deathScentAgeSPerTile, b = scentMarks.death.block(i, j, true);
      if (b.at[(i - b.i0) * terrainBlockTiles + j - b.j0] >= at) return;
      scentMarks.death.mark(i, j, at, c.uid, meaty);
    };
    const r = deathScentTiles * Math.min(1, (g_now - ds.since) / deathScentGrowS);
    while (ds.next < deathScentDisk.length && deathScentDisk[ds.next][2] <= r) lay(...deathScentDisk[ds.next++]);
    if (g_now - ds.renewedAt >= deathScentRenewS || ds.meaty && !meaty) {
      ds.renewedAt = g_now; ds.meaty = meaty;
      for (const t of deathScentDisk) lay(...t);
    }
  }
}

// The latest scent of species on tile (i, j): { ageS, uid }, and for death scent meaty
// (whether its carcass had meat on it when laid), or null if none.
function scentAt(i, j, species) {
  if (i < 0 || j < 0 || i >= gridWidthN || j >= gridHeightN) return null;
  const b = scentMarks[species].block(i, j, false);
  if (b === null) return null;
  const k = (i - b.i0) * terrainBlockTiles + j - b.j0, at = b.at[k];
  if (at < scentOldest || at === -Infinity) return null;
  return species === "death" ? { ageS: g_now - at, uid: b.uid[k], meaty: b.meaty[k] === 1 } : { ageS: g_now - at, uid: b.uid[k] };
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
// conceives a litter (litterBySpecies), and after gestationS, once on land, gives birth
// beside herself: young whose parents are her, the father and her partner, while alive.
// GENERATIONS (a.generation): the critters at the start are generation 0; a litter is one
// past the younger generation of its mother and father, the higher number (fixed when
// it is conceived).
// THE WOMB (a.womb, a biomass: see BODY) fills from her tissues as the litter grows, to
// its newborns' weight (a well-fed body's make-up) at the birth, by the square of the
// share of her gestation gone; while her meter is below miscarryBelow she loses the
// litter, and takes its biomass back into her tissues. At the birth each newborn's body
// is its share of the womb; young that don't fit within birthSearchTiles of her are
// stillborn, and their shares lost.
// GROWTH: see BODY.
// NURSING: an infant's (not yet weaned) full meter lasts SPEEDS.infantFoodFullS. Eating
// (the EAT intent) while touching its mother (boxes within nurseContactTiles), neither in
// water, it suckles instead of eating anything else: her milk (milkSharesBySpecies) goes
// from her tissues into its stomach, as fast as would fill its meter in SPEEDS.nurseFullS
// (but see FEEDING TIME), while its stomach has room; a.nursingOn is her uid (else null). She burns as much again
// as making the milk takes (milkEfficiency), and keeps nurseMotherMinFood of her meter.
// The mind (mind.js) decides who courts whom; the simulation only checks that a pairing
// is possible (canPair).

// Shares of the way from birth to adult frame at SPEEDS.growthAgesS, for a well-fed
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
const miscarryBelow = 0.1;
const birthSearchTiles = 3;
const critterByUid = new Map(); // every critter in play (not corpses)

// Its age, which stops at its death.
function ageS(a) { return (a.deathTime ?? g_now) - a.birthTime; }
function isGrown(a) { return _can(a, "mate"); }
function isInfant(a) { return !_can(a, "wean"); }
// Fed by its family still: a wolf too young to hunt (a deer, once weaned, feeds itself).
function isDependent(a) { return !_can(a, "hunt"); }
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

// Its weight, meters and collision box, after its body changed.
function updateBody(a) {
  a.food = Math.min(1, Math.max(0, foodShare(a)));
  a.water = Math.min(1, Math.max(0, waterShare(a)));
  a.gut = Math.min(1, energyMJ(a.stomach) / fullStomachMJ(a));
  a.stomachFull = stomachRoomKg(a) <= stomachFullRoomShare * stomachKg(a);
  a.weightKg = biomassKg(a.tissues) + biomassKg(a.stomach) + biomassKg(a.womb);
  const stage = youngStage(a);
  a.boxRad = stage && stage <= smallBoxStages ? critterBoxRad * youngScales[stage - 1] : critterBoxRad;
}

// SIZES: by its frame's share of the way from birth to adult (growthProgress), taken as
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

// 0 at birth (or less) to 1 grown, by its frame.
function growthProgress(a) {
  return Math.max(0, (a.frameKg - a.birthKg) / (a.adultKg - a.birthKg));
}

// One tick of infant a suckling, if it is touching its mother: her uid, or null.
function nurse(a) {
  const mother = critterByUid.get(a.parentUids[0]);
  if (!mother || !isLiveCritter(mother) || isInWater(a) || isInWater(mother)) return null;
  const reach = a.boxRad + mother.boxRad + nurseContactTiles;
  if (Math.abs(mother.gx - a.gx) > reach || Math.abs(mother.gy - a.gy) > reach) return null;
  const milk = milkSharesBySpecies[a.species], mjPerKg = energyMJ(milk);
  const spareMJ = (foodShare(mother) - nurseMotherMinFood) * rangeMJ(mother) * milkEfficiency;
  const fastest = rangeMJ(a) / SPEEDS.nurseFullS[a.species] / mjPerKg;
  const kg = Math.min(mealBiteKg(a, "milk", fastest), stomachRoomKg(a), spareMJ / mjPerKg);
  if (!(kg > 0)) return null;
  const got = withdraw(mother.tissues, biomass(milk, kg), a.stomach, mineralKeptKg(mother));
  metabolize(mother.tissues, energyMJ(got) * (1 / milkEfficiency - 1));
  updateBody(mother);
  mealEaten(a);
  return mother.uid;
}

// One tick of a pregnant female's womb (see BREEDING).
function updateWomb(f) {
  const p = f.pregnancy;
  if (!p) return;
  if (foodShare(f) < miscarryBelow) {
    moveAll(f.womb, f.tissues);
    f.pregnancy = null;
    return;
  }
  const t = g_now >= p.dueAt ? 1 : (g_now - p.since) / (p.dueAt - p.since);
  const kg = p.litter * newbornKg(f.species) * t * t - biomassKg(f.womb);
  if (kg > 0) withdraw(f.tissues, biomass(bodySharesBySpecies[f.species], kg), f.womb, mineralKeptKg(f));
}

function newbornKg(species) {
  const b = bodyKgBySpecies[species].birth;
  return (b.female + b.male) / 2;
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
  female.pregnancy = { since: g_now, dueAt: g_now + dueIn, fatherUid: male.uid, litter: litterSize(female.species),
    generation: Math.max(female.generation, male.generation) + 1 };
}

// On a death: the partner is free to pair again, and any pregnancy ends (the womb's
// biomass stays with the body).
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
  const pregnancy = f.pregnancy, { fatherUid, litter } = pregnancy;
  f.pregnancy = null;
  const parents = [f.uid];
  for (const uid of [fatherUid, f.mateUid]) {
    const p = critterByUid.get(uid);
    if (p && isLiveCritter(p) && !parents.includes(uid)) parents.push(uid);
  }
  const spots = biomassKg(f.womb) > 0 ? birthSpots(f, litter) : [];
  for (const [k, [x, y]] of spots.entries()) {
    const tissues = biomass();
    moveShare(f.womb, tissues, 1 / (litter - k));
    const c = initCritter({}, f.species, tissues);
    c.gx = c.nextGX = x;
    c.gy = c.nextGY = y;
    c.parentUids = parents.slice();
    c.generation = pregnancy.generation;
    for (const uid of parents) critterByUid.get(uid).youngUids.push(c.uid);
    allCritters.push(c);
    if (c.species === "wolf" && !isLiveCritter(pcWolf)) pcWolf = c; // the player's new wolf
  }
  moveAll(f.womb, null, "lostKg"); // the stillborn
  updateBody(f);
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
//   { gait: "take" }       a wolf: stand still and tear a leg off the carcass in reach (CARRYING)
//   { gait: "drop" }       a wolf: stand still, putting down the leg it carries (CARRYING)
//   { gait: "howl" }       a wolf: stand still and howl (HOWLING)
//   any of these with bark: kind   a wolf: and give a soft bark, signal `kind` (BARKING)
//   { dx, dy, gait }       move along grid vector (dx, dy), any length, at walk, stalk, trot or
//                          gallop, or the best gait wind and stamina allow (a newborn
//                          too young to walk crawls: CRAWLING)
//   { dir, gait }          the same along one of the 8 directions
// HEADINGS: a moving critter goes along (a.hx, a.hy), a unit vector. An intent's vector
// is scaled to unit length when it is set (the only square root), and setting the same
// vector again reuses it. The sprite faces the nearest of 8 directions
// (a.currentDirection) but keeps its facing while the heading is within facingKeepCos of
// it, so a heading near a boundary doesn't flip the sprite. It turns to a new heading in
// its time (TURNING).
// STUNNED: a move that fails (another live critter in its way: see COLLISIONS; a boulder,
// a cliff, the map's edge, or water for a tired critter) leaves the critter at its last legal position,
// stopped, for stunMinS to stunMaxS; its intent waits. a.blockedTick and a.stunnedUntil
// record when, for whoever decides.
const intents = new Map(); // critter -> its prepared intent
let playerIntent = null;
let playerIntentApplied = false; // whether the player was in control last tick
const facingKeepCos = 0.866;     // cos 30 degrees
const standingGaits = new Set(["idle", "eat", "mate", "take", "drop", "howl"]);

// The intent with its heading (hx, hy) at unit length, reusing prev's for the same vector.
function prepareIntent(intent, prev) {
  if (!intent || standingGaits.has(intent.gait)) return intent || null;
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
  if (intent) { intents.set(a, prepareIntent(intent, intents.get(a))); if (intent.bark) startBark(a, intent.bark); }
  else intents.delete(a);
}

function setPlayerIntent(intent) {
  playerIntent = prepareIntent(intent, playerIntent);
}

function playerHasControl() {
  return playerIntent !== null;
}

function applyIntent(a, intent) {
  if (a.stunnedUntil > g_tick || isMating(a)) return;
  a.eating = intent.gait === "eat";
  a.eatAt = a.eating && intent.at || null;
  a.taking = intent.gait === "take" && a.species === "wolf";
  if (intent.gait === "drop") dropLeg(a);
  if (standingGaits.has(intent.gait)) setCritterIdle(a);
  else setCritterHeading(a, intent.hx, intent.hy, intent.gait, intent.dir);
  if (intent.gait === "howl") startHowl(a);
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

// HOWLING: a wolf standing still howls (pose "howl", for howlS, then idle again), heard
// far (senses.js: HOWLS). Asked to howl while howling, or again within howlAgainS, it
// doesn't (it stands). (The minds don't howl yet.)
const howlS = 1.35;       // the artist's howl, once (images_raw/5V5aC4.gif; animat.js checks it)
const howlAgainS = 5;
function startHowl(a) {
  if (a.species !== "wolf" || a.pose === "howl" || isInWater(a) || a.speed > 0) return;
  if (a.howlUntil !== undefined && g_tick - a.howlUntil < howlAgainS / tempo) return;
  a.howlUntil = g_tick + Math.round(howlS / tempo);
  setPose(a, "howl");
}

// BARKING: a wolf gives a soft bark (an intent's bark: whatever else it does), a signal to
// those near (a.signal: { kind, tick }), barkS long, heard like any other sound (senses.js
// BARKS). Kinds: "hunt" (it is going hunting) and "stay" (it is staying put), its role,
// kept in a.role too; "come" (come to me: a call); "follow" (follow me: LEADING in
// mind.js); and "whimper" (a hungry infant's, quieter). (Kinds are what is meant: when
// barks are drawn and given sounds, some may share one.) The same signal again within barkAgainS, it doesn't bark. TODO: no bark frames yet (it
// is heard, not seen).
const barkS = 0.3, barkAgainS = 5;
function startBark(a, kind) {
  if (a.species !== "wolf" || !isLiveCritter(a)) return;
  if (a.signal && a.signal.kind === kind && g_tick - a.signal.tick < barkAgainS / tempo) return;
  a.signal = { kind, tick: g_tick };
  if (kind === "hunt" || kind === "stay") a.role = a.signal;
  a.barkUntil = g_tick + Math.round(barkS / tempo);
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
// Gaits: walk, trot and gallop on land, swim in water; and for a wolf, STALKING: between a
// walk and a trot, all but silent (see HEARING in senses.js), and costing stamina as a
// trot does, so going a little less far on it (its use is stealth, not saving strength).
// A deer can't stalk (it walks). CRAWLING: a newborn too young to walk (lifeStageAgesS)
// crawls, whatever gait it is asked: at 30% of a walk, as quiet as a wolf stalking,
// costing what a walk does (nothing: its reserves refill as walking), and never into the
// water (it can't swim yet); none older crawls (asked to, it walks). A gait (a.pose)
// changes at once; the speed follows it (SPEED CHANGES).

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
  const same = a.wantHx === hx && a.wantHy === hy && a.wantFacing === facing;
  if (newPose === a.pose && same && a.targetSpeed > 0) return;

  if (!_can(a, "walk")) newPose = isInWater(a) ? "swim" : "crawl"; // (CRAWLING)
  else if (newPose === "crawl") newPose = "walk";
  if (isInWater(a)) {
    a.landPose = newPose;
    a.swimBurst = newPose === "gallop" && canUseGait(a, "gallop", a.pose === "swim" && a.swimBurst);
    newPose = "swim";
  } else {
    if (newPose === "gallop" && !canUseGait(a, "gallop", a.pose === "gallop"))
      newPose = "trot";
    if ((newPose === "trot" || newPose === "stalk") && !canUseGait(a, newPose, a.pose === newPose))
      newPose = "walk";
    a.landPose = newPose;
    if (a.climbingUntil > g_tick && newPose !== "idle") newPose = "walk"; // still scrambling up a bank
  }
  const speed = newPose === "swim" ? swimSpeed(a) : travelSpeedBySpeciesAndPose[a.species][newPose];
  // A swimmer can change speed (sprinting or not) in the same pose, and a stunned one
  // has speed 0, so compare speeds too.
  if (newPose === a.pose && same && a.targetSpeed > 0 && a.targetSpeed === speed) return;

  setPose(a, newPose);
  // (it turns to the heading at its turning rate: TURNING)
  if (!same) a.facingWas = a.currentDirection;
  a.wantHx = hx; a.wantHy = hy; a.wantFacing = facing;
  if (a.hx === undefined) { a.hx = hx; a.hy = hy; }
  if (a.hx === hx && a.hy === hy) a.currentDirection = facing !== undefined ? facing : facingFor(a, hx, hy);
  a.targetSpeed = speed;
}

// TURNING: a critter turns its heading (a.hx, a.hy) toward the one it was set
// (a.wantHx, a.wantHy) at no more than turnMaxRadS / (1 + v / turnHalfSpeedMps) radians a
// second, v its speed (m/s): quickest standing, slower the faster it goes (the same for
// wolf and deer: about 0.8 s to turn right round standing or walking, 0.8-0.9 s trotting,
// 2 s galloping, braking as below; at the same speed, as quick in any gait). With the heading it wants more than 90 degrees from
// its own, it brakes (SPEED CHANGES: toward a stop) and turns the quicker for slowing, then
// speeds up again: so turning right round costs a slowing and a speeding up, and a small
// change of heading doesn't. Turning in small steps is no quicker: the limit is on the
// heading itself, however it is asked. Its facing (a.currentDirection) follows the heading,
// and ends as it would have turned at once (HEADINGS: kept if near enough the new heading).
// At a walk or slower, it turns more than 45 degrees on the spot (pivotCos). A swimmer
// neither brakes nor turns on the spot: it swims on as it turns. Turning, or coming to a
// stop, at a trot or slower (or swimming), it doesn't step into a boulder, over a cliff
// or off the map along the way it faces (it feels it there, or sees it close enough to
// check its step): it stops short, turning on the spot until that way is clear; and it stops short of
// another critter it would bump, unstunned (though each feels the other: BUMPED). Faster,
// it bumps (STUNNED).
// No trig: a step of angle s turns the heading by cos s ~ 1 - s^2/2, sin s ~ s - s^3/6,
// and its length is kept 1 by a Newton step.
const turnMaxRadS = 4.2;        // ~240 degrees a second, standing
const turnHalfSpeedMps = 7.5;   // the rate halves at this speed
const pivotCos = Math.SQRT1_2;
// Whether it is turning or coming to a stop at a trot or slower (or swimming): it stops
// short of what it would bump.
function steadying(a) {
  const turning = a.turnedTick === g_tick || (a.wantHx !== undefined && !(a.hx === a.wantHx && a.hy === a.wantHy));
  return (turning || !(a.targetSpeed > 0)) && a.speed <= travelSpeedBySpeciesAndPose[a.species].trot;
}
function pivoting(a, nextGX, nextGY) {
  if (!steadying(a)) return false;
  const r = a.boxRad;
  if (!(nextGX >= r && nextGX < gridWidthN - r && nextGY >= r && nextGY < gridHeightN - r)) return true;
  if (Math.abs(heightAt(nextGX, nextGY) - heightAt(a.gx, a.gy)) > maxStepLevels) return true;
  for (let i = Math.floor(nextGX - r); i <= Math.floor(nextGX + r); i++)
    for (let j = Math.floor(nextGY - r); j <= Math.floor(nextGY + r); j++) if (isBlockedTile(i, j)) return true;
  return false;
}
function turnToward(a) {
  const wx = a.wantHx, wy = a.wantHy;
  if (wx === undefined || a.stunnedUntil > g_tick || !isLiveCritter(a) || isMating(a)) return;
  const hx = a.hx, hy = a.hy;
  if (hx === wx && hy === wy) return;
  a.turnedTick = g_tick;
  const step = turnMaxRadS * tempo / (1 + a.speed / tempo / turnHalfSpeedMps);
  const dot = hx * wx + hy * wy, cross = hx * wy - hy * wx;
  if (dot >= 1 - step * step / 2) { // within a step: there, facing as it would have turned at once
    a.hx = wx; a.hy = wy;
    if (a.wantFacing !== undefined) a.currentDirection = a.wantFacing;
    else { a.currentDirection = a.facingWas; a.currentDirection = facingFor(a, wx, wy); }
    return;
  }
  const c = 1 - step * step / 2, sn = (cross >= 0 ? 1 : -1) * (step - step * step * step / 6);
  let nx = hx * c - hy * sn, ny = hy * c + hx * sn;
  const k = 1.5 - 0.5 * (nx * nx + ny * ny);
  a.hx = nx * k; a.hy = ny * k;
  a.currentDirection = facingFor(a, a.hx, a.hy);
}

function setCritterIdle(a) {
  if (a.pose === "death" || a.pose === "dead" || isMating(a)) return;
  a.wantHx = a.wantHy = a.wantFacing = undefined; // (it stops turning)
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
  if (a.pose === "howl" && g_tick < a.howlUntil) return; // (howling on: HOWLING)
  setPose(a, "idle");
}

// SPEED CHANGES: a critter's speed (a.speed) moves toward its gait's (a.targetSpeed), up
// and down alike, by speedStep: at low speed by SPEEDS.accelMaxMps2, faster by no more
// than its power allows (SPEEDS.powerWPerKg: the change a second times the speed), so it
// gets off the mark and comes to a stop quickly, and gains or sheds speed slowly near a
// full gallop. A critter told to stop keeps its moving pose until it has
// stopped. Stopping dead (a stun, death) is immediate.
function changeSpeed(a) {
  // (turning right round, it brakes; at a walk or slower, turning more than 45 degrees, it
  // turns on the spot; swimming, it swims on as it turns: TURNING)
  const dot = a.wantHx !== undefined && a.pose !== "swim" ? a.hx * a.wantHx + a.hy * a.wantHy : 1;
  const braking = dot < 0 || (dot < pivotCos && a.speed <= travelSpeedBySpeciesAndPose[a.species].walk);
  const target = braking ? 0 : a.targetSpeed ?? 0;
  if (a.speed !== target) {
    const step = speedStep(a.species, a.speed);
    a.speed = a.speed < target ? Math.min(target, a.speed + step) : Math.max(target, a.speed - step);
  }
  if (a.pose === "howl" && !(g_tick < a.howlUntil && !(a.targetSpeed > 0))) setPose(a, "idle"); // (the howl done, or off it goes)
  if (a.speed === 0 && !(a.targetSpeed > 0) && a.pose !== "idle" && a.pose !== "howl" && a.pose !== "swim" && !isMating(a) && isLiveCritter(a)) {
    a.nextGX = a.gx;
    a.nextGY = a.gy;
    setPose(a, "idle");
  }
}

// EXERTION: two reserves, 0 (empty) to 1 (full).
//   wind     limits galloping: drains while galloping (or sprinting in water) and refills
//            otherwise, quickly at first, faster the more restful the gait
//   stamina  limits trotting: drains while trotting (or stalking, as fast), galloping and
//            swimming, and refills slowly while idle, walking or crawling
// A gait can only be started with some reserve in hand (windStartFrac,
// staminaStartFrac), so critters don't flicker in and out of it near empty; once in it,
// they keep going until the reserve runs out.
function canUseGait(a, gait, isAlready = false) {
  if (!_can(a, 'run')) return false;
  if (gait === "gallop") {
    return isAlready ? (a.wind > 0 && a.stamina > 0)
                     : (a.wind >= windStartFrac && a.stamina >= staminaStartFrac);
  }
  if (gait === "stalk" && !travelSpeedBySpeciesAndPose[a.species].stalk) return false;
  if (gait === "trot" || gait === "stalk") return isAlready ? a.stamina > 0 : a.stamina >= staminaStartFrac;
  return true;
}

function applyExertion(a) {
  const ex = exertionBySpecies[a.species];
  const dt = tempo;
  if (a.pose === "gallop") {
    a.wind = Math.max(0, a.wind - dt / ex.gallopFullWindS);
    a.stamina = Math.max(0, a.stamina - gallopStaminaCostFactor * dt / ex.trotFullStaminaS);
  } else if (a.pose === "trot" || a.pose === "stalk") {
    a.stamina = Math.max(0, a.stamina - dt / ex.trotFullStaminaS);
  } else if (a.pose === "swim") {
    if (a.swimBurst) a.wind = Math.max(0, a.wind - dt / ex.gallopFullWindS);
    const had = a.stamina;
    a.stamina = Math.max(0, a.stamina - (a.swimBurst ? gallopStaminaCostFactor : 1) * dt / ex.swimTimeS);
    // (the mind turns a swimmer back in time: see TIRED SWIMMERS in mind.js)
    if (had > 0 && a.stamina <= 0 && !(a === pcWolf && playerHasControl()))
      (console.error || console.log)(`[stamina] ${a.species} ${a.uid} ran out of stamina in the water (it shouldn't)`);
  }
  const windHalfLifeS = windRefillHalfLifeSByPose[a.pose];
  if (windHalfLifeS) a.wind += (1 - a.wind) * (1 - Math.pow(0.5, dt / windHalfLifeS));
  const staminaRefillS = staminaFullRefillSByPose[a.pose];
  if (staminaRefillS) a.stamina = Math.min(1, a.stamina + dt / staminaRefillS);

  // out of a reserve: the next gait down
  if (a.pose === "gallop" && (a.wind <= 0 || a.stamina <= 0)) {
    setCritterHeading(a, a.wantHx ?? a.hx, a.wantHy ?? a.hy, "trot", a.wantFacing);
  } else if ((a.pose === "trot" || a.pose === "stalk") && a.stamina <= 0) {
    setCritterHeading(a, a.wantHx ?? a.hx, a.wantHy ?? a.hy, "walk", a.wantFacing);
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
// a swimmer out of stamina swims on at its swim speed (so it can still get back to land:
// a critter's mind should turn it back long before; running out logs an error, but for
// the player's wolf while the player steers it).
// A critter below SPEEDS.swimMinStaminaFrac stamina may not enter the water, except the
// player's wolf while the player steers it: such a move is blocked like a boulder.
// a.landPose is the land gait last asked for, resumed on climbing out. A critter climbing
// out up a bank higher than one step (bankAboveStep) is held to a walk for
// SPEEDS.climbOutSlowS (until a.climbingUntil). Out of the water, any critter speeds up
// as on land (SPEED CHANGES), from its swimming speed.

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
  const x1 = Math.floor(gx + boxRad), y0 = Math.floor(gy - boxRad), y1 = Math.floor(gy + boxRad);
  for (let x = Math.floor(gx - boxRad); x <= x1; x++) for (let y = y0; y <= y1; y++) if (getTerrainAt(x, y) !== "water") return false;
  return true;
}

function mayEnterWater(a) {
  if (!_can(a, "walk")) return false; // (CRAWLING)
  return a.stamina >= SPEEDS.swimMinStaminaFrac || (a === pcWolf && playerHasControl());
}

// A swimmer's speed: its sprint, or its swim (out of stamina too).
function swimSpeed(a) {
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
      setCritterHeading(a, a.wantHx ?? a.hx, a.wantHy ?? a.hy, resume, a.wantFacing);
    } else {
      setCritterIdle(a);
    }
  }
}

// Whether the land critter a is climbing onto rises more than one step above the water:
// the water's surface is drawn a level below land at its level, so a tile (of those its
// box touches) with any corner above the water beside it is a bank higher than the
// smallest step.
function bankAboveStep(a) {
  const w = waterLevelNear(Math.floor(a.gx), Math.floor(a.gy));
  if (w === null) return false;
  return getOccupiedTiles(a.gx, a.gy, a.boxRad).some(tile => {
    const c = tileCorners(...tile.split("_").map(Number));
    return c[0] > w || c[1] > w || c[2] > w || c[3] > w;
  });
}

// Whether critter a could go straight to (gx, gy): inside the map, its box touching no
// blocked tile on the way, meeting no ledge it can't step, and (if it may not enter water)
// staying dry. Checked in steps of canStepSampleTiles, as moves are checked tick by tick, so a
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
  let h = height(a.gx, a.gy), px = a.gx, py = a.gy;
  for (let s = 1; s <= n; s++) {
    const x = a.gx + (gx - a.gx) * s / n, y = a.gy + (gy - a.gy) * s / n;
    if (x < r || y < r || x >= gridWidthN - r || y >= gridHeightN - r) return false;
    // the box over the whole step, so it can't clip a blocked tile's corner between samples
    const i0 = Math.floor(Math.min(px, x) - r), i1 = Math.floor(Math.max(px, x) + r);
    const j0 = Math.floor(Math.min(py, y) - r), j1 = Math.floor(Math.max(py, y) + r);
    px = x; py = y;
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
  const dying = []; // of hunger or thirst
  allCritters.forEach(a => { const cause = updateFood(a); if (cause) dying.push([a, cause]); });

  allCritters.forEach(a => {
    // done scrambling up a bank: back to the gait it was asked for
    if (a.climbingUntil === g_tick && a.pose === "walk" && a.landPose !== "walk" && a.targetSpeed > 0)
      setCritterHeading(a, a.wantHx ?? a.hx, a.wantHy ?? a.hy, a.landPose, a.wantFacing);
    applyExertion(a);
    if (a.pose === "swim" && a.targetSpeed === 0 && !(a.stunnedUntil > g_tick)) a.targetSpeed = swimSpeed(a);
    turnToward(a);
    changeSpeed(a);

    if (a.speed === 0) {
      a.nextGX = a.gx;
      a.nextGY = a.gy;
      return;
    }

    const nextGX = a.gx + a.hx * a.speed;
    const nextGY = a.gy + a.hy * a.speed;
    if (pivoting(a, nextGX, nextGY)) { a.speed = 0; a.nextGX = a.gx; a.nextGY = a.gy; return; }
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
  pastLifespan.forEach(a => startCritterDeath(a, "old age"));
  dying.forEach(([a, cause]) => { if (isLiveCritter(a) && allCritters.includes(a)) startCritterDeath(a, cause); });
  allCritters.filter(a => a.pregnancy && g_now >= a.pregnancy.dueAt && isLiveCritter(a)
    && !isMating(a) && !isInWater(a)).forEach(giveBirth);
  for (let k = allCorpses.length - 1; k >= 0; k--) {
    const c = allCorpses[k];
    if (g_now - c.deathTime < SPEEDS.corpseLastsS) continue;
    for (const b of [c.tissues, c.stomach, c.womb]) moveAll(b, null, "rottedKg"); // it rots away
    if (c.carcass) {
      for (const [name] of carcassPieces) moveAll(c.carcass.pieces[name], null, "rottedKg");
      moveAll(c.carcass.bones, null, "rottedKg");
    }
    allCorpses.splice(k, 1);
  }
  for (const a of allCritters) // (a leg carried rots away with its carcass)
    if (a.carrying && g_now - a.carrying.from.deathTime >= SPEEDS.corpseLastsS) { moveAll(a.carrying.food, null, "rottedKg"); a.carrying = null; }
  markScent();
  spreadDeathScent();
  if (g_tick % Math.round(SPEEDS.windChangeEveryS / tempo) === 0) shiftWind();
  if (g_tick % grassGrowEveryTicks === 0 && clock.sunUp) {
    growGrass(grassGrowEveryTicks * tempo / meanDaylightShare);
    growUndergrowth(grassGrowEveryTicks * tempo / meanDaylightShare);
    growPines();
  }
}

// COLLISIONS: every live critter's next position is checked against blocked tiles and
// every other live critter at once (the dying and corpses are walked over like ground).
// BUMPED: a critter that another moves into feels it: a.bumpedTick, a.bumpedBy (its uid)
// the way it was moving, (a.bumpedDx, a.bumpedDy), and where it was, (a.bumpedX,
// a.bumpedY). TOUCHED: each of two colliding critters feels the other there, whoever
// moved: a.touchedTick, a.touchedBy (its uid), and where it stands, (a.touchedX,
// a.touchedY). A mother and her young too young to walk pass through each other (she
// steps among them). A wolf touching a live deer on land kills it; any other collider is
// stunned where it is, but of two critters, one whose own move would be clear of the
// other where it stands goes on (a critter bumped from behind, or stepping away from the
// one that bumped it) while the other is stunned. This is the only place positions change.
// BITING: a wolf kills a deer it touches only biting it: facing it (the deer ahead of its
// shoulders), going at it (stalking, trotting or galloping), with room in its stomach, and
// old enough to hunt (sim: _can "hunt"). Otherwise they only bump.
const bitingPoses = new Set(["stalk", "trot", "gallop"]);
function bites(w, d) {
  return bitingPoses.has(w.pose) && !w.stomachFull && _can(w, "hunt")
    && w.hx * (d.gx - w.gx) + w.hy * (d.gy - w.gy) > 0;
}

function moveAllTogether(movers) {
  const allColliders = movers;
  // (a mother and her young too young to walk don't collide: she steps among them, and
  // they crawl in among each other to her)
  const litter = (p, q) => !_can(q, "walk") && (q.parentUids[0] === p.uid
    || (!_can(p, "walk") && p.parentUids[0] !== undefined && p.parentUids[0] === q.parentUids[0]));
  const collidePairs = findCollidingPairs(allColliders).filter(([i, j]) => i === -1
    || !(litter(allColliders[i], allColliders[j]) || litter(allColliders[j], allColliders[i])));
  const didCollide = {};
  const clearOf = (a, b) => !(a.nextGX === a.gx && a.nextGY === a.gy)
    && !doNextMovesCollide(a, { gx: b.gx, gy: b.gy, nextGX: b.gx, nextGY: b.gy, boxRad: b.boxRad });
  collidePairs.forEach(pair => {
    if (pair[0] !== -1) {
      const [c0, c1] = [allColliders[pair[0]], allColliders[pair[1]]];
      for (const [p, q] of [[c0, c1], [c1, c0]]) { p.touchedTick = g_tick; p.touchedBy = q.uid; p.touchedX = q.gx; p.touchedY = q.gy; }
      const ok0 = clearOf(c0, c1), ok1 = clearOf(c1, c0);
      if (ok0 !== ok1) { didCollide[pair[ok0 ? 1 : 0]] = true; return; }
    }
    pair.forEach(m => didCollide[m] = true);
  });

  const wasKilledBy = {};
  collidePairs.forEach(pair => {
    if (pair[0] === -1) return;
    const [c0, c1] = [allColliders[pair[0]], allColliders[pair[1]]];
    // each feels the other moving into it (BUMPED)
    for (const [felt, mover] of [[c0, c1], [c1, c0]]) {
      if (mover.nextGX === mover.gx && mover.nextGY === mover.gy) continue;
      felt.bumpedTick = g_tick;
      felt.bumpedBy = mover.uid;
      felt.bumpedDx = mover.nextGX - mover.gx; felt.bumpedDy = mover.nextGY - mover.gy;
      felt.bumpedX = mover.gx; felt.bumpedY = mover.gy;
    }
    if (!isLiveCritter(c0) || !isLiveCritter(c1) || c0.species === c1.species) return;
    // no kills in the water: a wolf couldn't eat the carcass there, or drag it ashore
    if (isInWater(c0.species === "deer" ? c0 : c1)) return;
    const [w, d] = c0.species === "wolf" ? [pair[0], pair[1]] : [pair[1], pair[0]];
    if (bites(allColliders[w], allColliders[d])) wasKilledBy[d] = w;
  });

  allColliders.forEach((thing, idx) => {
    // before the standing-still check, so a standing deer can be killed
    if (idx in wasKilledBy) {
      startCritterDeath(thing, "predation");
      return;
    }
    if (thing.nextGX === thing.gx && thing.nextGY === thing.gy) return;
    if (didCollide[idx]) {
      if (steadying(thing)) { thing.speed = 0; thing.nextGX = thing.gx; thing.nextGY = thing.gy; } // (TURNING)
      else stun(thing);
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
  const tileMap = new Map();         // tile key (x * gridHeightN + y) -> indexes of things on that tile
  const potentialPairs = new Set();  // (i + 1) * n + j, i < j (i -1: a blocked tile)
  const n = creatures.length, B = terrainBlockTiles;

  for (let i = 0; i < n; i++) {
    const creature = creatures[i], r = creature.boxRad;
    const left = Math.floor(creature.nextGX - r), right = Math.floor(creature.nextGX + r);
    const top = Math.floor(creature.nextGY - r), bottom = Math.floor(creature.nextGY + r);
    let allWater = true;
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
      const tile = x * gridHeightN + y;
      // (off the map: water, nothing on it)
      let water = true, blocked = false;
      if (x >= 0 && y >= 0 && x < gridWidthN && y < gridHeightN) {
        const b = terrainBlock(x, y), k = (x - b.i0) * B + y - b.j0;
        water = b.kind[k] === 3; blocked = b.boulder[k] !== 0 || (b.pine[k] & pineSizeBits) > 1;
      }
      if (!water) allWater = false;
      const on = tileMap.get(tile);
      if (!on) {
        if (blocked) potentialPairs.add(i);
        else tileMap.set(tile, [i]);
      } else {
        for (const j of on) potentialPairs.add(j < i ? (j + 1) * n + i : (i + 1) * n + j);
        on.push(i);
      }
    }
    creature.nextAllWater = allWater;
  }

  const collisions = [];
  for (const key of potentialPairs) {
    const i = Math.floor(key / n) - 1, j = key % n;
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
  // half of each species male, at random (the player's wolf either, the other wolves
  // making up the half with it)
  for (const list of [wolves.slice(1), deer]) {
    const first = list === deer || !wolves[0].isMale;
    const sexes = list.map((_, k) => (k % 2 === 0) === first);
    for (let k = sexes.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [sexes[k], sexes[r]] = [sexes[r], sexes[k]];
    }
    list.forEach((a, k) => {
      setSex(a, sexes[k]);
      setBodyByAge(a, a.food);
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
// stamina, food, gut, water, diedOf (see DEATHS), generation, stomachFull, tissues, stomach, womb,
// eating, carcass, carcassFullKg, uid, blockedTick, stunnedUntil, isMale, birthTime,
// deathTime, weightKg, adultKg, frameKg, boxRad, mateUid, matingWith, parentUids,
// youngUids, pregnancy, nursingOn, bumpedTick, bumpedBy, bumpedDx, bumpedDy, bumpedX,
// bumpedY, touchedTick, touchedBy, touchedX, touchedY, carrying, morsel, signal, role,
// howlUntil, barkUntil)
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
  gridWidthN, gridHeightN, getTerrainAt, obstacleAt, undergrowthAt,
  tileCorners, heightAt, levelRangeIn, waterKindAt, waterLevelAt, waterLevelNear, maxStepLevels,
  get startArea() { return startArea; }, // where the critters started (THE START)
  // the square startNearTiles a side about it (for tests: where to look for features)
  get startNear() { const m = (startNearTiles - startTiles) / 2; return startArea && { i0: startArea.i0 - m, j0: startArea.j0 - m, i1: startArea.i1 + m, j1: startArea.j1 + m }; },
  gaitSpeed: (species, gait) => travelSpeedBySpeciesAndPose[species][gait] || 0, // tiles a tick
  howlS, // (HOWLING)
  turnStep: v => turnMaxRadS * tempo / (1 + v / tempo / turnHalfSpeedMps), // radians a tick at v tiles a tick (TURNING)
  speedStep, // (species, speed in tiles a tick): the most it changes a tick (SPEED CHANGES)
  pivotCos,
  isBlockedTile, isLandTile, isWaterAt, canStepTo, mayEnterWater, obstacleHeightAt, sightHeightAt, centerHeightAt, isLiveCritter,
  boulderRockAt, obstacleAcross, boulderRocks, levelsPerMetre, pineAt, pineOn, pineHeightM, pineCrownRadiusM, pineCrownRatio, pineClasses,
  _pineZone(i, j) { const c = getTerrainAt(i, j); const [d, h] = pineDensityAt(i, j, c); return d === 0 ? 'none' : h >= 1 ? 'heart' : h > 0 ? 'forestEdge' : d > 0.005 ? 'stand' : 'lone'; },
  // scent and wind
  scentAt, shoreKindAt, get wind() { return { x: windX, y: windY }; },
  get scentHalfLifeS() { return SPEEDS.scentHalfLifeS; },
  // day and night
  get clock() { return clock; }, daylightHoursAt, meanDaylightShare, latitudeDeg,
  get dayLengthS() { return SPEEDS.dayLengthS; },
  allCritters, allCorpses, deathDurationSBySpecies,
  get pcWolf() { return pcWolf; },    // the player's wolf, or its corpse (see THE PLAYER'S WOLF)
  get speeds() { return SPEEDS.name; },
  get swimMinStamina() { return SPEEDS.swimMinStaminaFrac; },
  // food
  grassFoodAt, grassHeightAt, grassMostAt, inGrassReach, grassChangesSince,
  undergrowthFoodAt, undergrowthShownAt, pineFoodAt, pineMostAt, plantFoodAt, plantMostAt, undergrowthKinds: undergrowthKinds.slice(1), carcassPieces, carcassPieceKg, carcassMeatKg, eatReachTiles,
  canCarry, legToTake, carcassLegs, tearLegS, // (CARRYING)
  get grassMaxKg() { return SPEEDS.grassMaxKg; },
  bodySharesBySpecies, biomassKg, energyMJ, waterInReach,
  // ages and breeding
  can: _can, isGrown, isInfant, isDependent, isFertile, inHeat, mateReachTiles, youngStage, youngScales,
  adultBoxRad: critterBoxRad, nurseContactTiles, nurseMotherMinFood,
  get nurseFullS() { return SPEEDS.nurseFullS; },
  get infantFoodFullS() { return SPEEDS.infantFoodFullS; },
  mateActSBySpecies: Object.fromEntries(Object.entries(SPEEDS.breeding).map(([sp, b]) => [sp, b.mateActS])),

  // intents
  setIntent, setPlayerIntent, playerHasControl,
  getDir, moveVecByDir, DIR_E, DIR_SE, DIR_S, DIR_SW, DIR_W, DIR_NW, DIR_N, DIR_NE,

  // For tests and debugging only; views and controllers must not use these.
  internals: {
    tick, wolves, deer, allLandTiles, terrainMap, terrainBlocks, terrainBlocksKept, grassTouched, setTileCorners, setBoulder, setPine,
    get scentMarks() { return scentMarks; },
    setCritterIdle, setCritterMoving, setCritterHeading, isInWater, getOccupiedTiles,
    forbidOverlapsOnStart, critterBoxRad, travelSpeedBySpeciesAndPose,
    REALISTIC, GAMIFIED, SPEEDS, drawLifespanS, startCritterDeath, growGrass, setGrassKg, stun,
    windRefillHalfLifeSByPose, staminaFullRefillSByPose, maxStepLevels,
    critterByUid, bodyKgBySpecies, growthShare, litterSize, birthSpots, giveBirth,
    holdClock, holdWater, conceive, pair, milkEfficiency, canPair, setWind, growthProgress, growthKgPerS, updateBody,
    setBodyByAge, setBody, setFood, bodyOf, biomass, rangeMJ, stomachKg, foodShare, worldBiomassKg, biomassLedger,
    ledgerNetKg, waterShare, lethalWaterShare, waterLossKgPerMJ, metabolicWaterPerKg, drink,
    milkSharesBySpecies, grassShares, newCarcass, newbornKg, miscarryBelow, updateFood,
    toFat, makeCarbs, withdraw, burn, absorb, fullStomachMJ, carbsDigestedBySpecies, stomachTS, stomachEmptiesInT,
    get loopHandle() { return loopHandle; },
    dropLeg, howlS,
    setUndergrowthKg, growUndergrowth, undergrowthMostKg, undergrowthShares, undergrowthTotalKg, flowersShownFrom,
    setPineKg, growPines, pineTotalKg, pineShares, pineMostKgBySize, pineBiteShare, pineClasses, pineDensityAt, pineIn,
    groundCoverAt, regionAt, regionsNear, coverIn, undergrowthIn, coverThemes, regionTiles, provinceTiles, vnoise, hash01,
  },
};

})();

// In Node, sim.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = sim;
