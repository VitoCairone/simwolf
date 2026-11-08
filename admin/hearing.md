# Hearing ranges (senses.js: HEARING)

How far a moving critter is heard, worked out from estimates and a simple model of sound
in the open. 1 tile = 1 m.

## The model

A footfall heard at distance d (m) is about

    L(d) = L1 - 20 log10(d) - 0.05 d      (dBA)

where L1 is its loudness at 1 m: 6 dB less each time the distance doubles (spherical
spreading), and 5 dB more each 100 m over open ground (ground effect and air
absorption; forest would take more, 3-25 dB per 100 m). It is heard while L(d) stands out
of the background: 30 dBA on a breezy day, 20 dBA on a calm night (the game blends the
two by daylight, sim.clock.light). 10 dB less background roughly doubles to triples the
range.

The listeners' ears don't limit it: a deer's best threshold is about -3 dB SPL at 8 kHz
(115 Hz to 54 kHz at 60 dB), a dog's (and so likely a wolf's) best near 8 kHz too, far
below any natural background. So both species hear alike; only the source differs.

## Footfall loudness at 1 m (estimates, dBA)

| | walk | trot | gallop |
|---|---|---|---|
| wolf, grass | 30 | 38 | 50 |
| wolf, dirt | 33 | 42 | 55 |
| wolf, stone | 37 | 46 | 60 |
| deer, grass | 34 | 44 | 56 |
| deer, dirt | 38 | 48 | 61 |
| deer, stone | 46 | 56 | 68 |

A wolf stalking: 10 dB under its walk; a newborn crawling (wolf or deer), as quiet. Splashing (swimming): about 55.

Scaled from human footsteps (soft shoes on a hard floor 37-39 dBA at 0.5 m; gravel about
58 dBA at the ear), by body mass and by how hard each gait strikes the ground (a trot
some 9 dB over a walk, a gallop some 20); hooves on hard ground 4-9 dB over padded paws.
Probably good to within about 6 dB, so the ranges to within about 2x either way. The
steps between gaits and grounds, and the backgrounds, are firmer than the absolute levels.

Not modelled yet: wind (more background), undergrowth and dry leaves (rustling up to
12-17 dB louder than soil), the listener's own footfalls masking what it hears.

## Sources

- Heffner & Heffner, The behavioral audiogram of whitetail deer:
  https://www.researchgate.net/publication/42438287_The_behavioral_audiogram_of_whitetail_deer_Odocoileus_virginianus
- Heffner 1983, Hearing in large and small dogs:
  https://labs.sonicfield.org/library/hearing-in-large-and-small-dogs-icanis-familiarisi
- Natural sound levels (NPS): https://www.nps.gov/subjects/sound/understandingsound.htm
- Ambient 33 dBA at a prairie-dog colony: https://sites.warnercnr.colostate.edu/soundandlightecologyteam/wp-content/uploads/sites/146/2020/11/behavioralecology2016.pdf
- Pasture ambient 37-40 dBA: https://www.frontiersin.org/journals/ethology/articles/10.3389/fetho.2026.1802957/full
- Sound in forests (Martens): https://www.ioa.org.uk/system/files/publications/MJM%20MARTENS%20SOUND%20PROPAGATION%20IN%20FORESTS.pdf
- Air absorption by octave band (ISO 9613 inputs): https://www.pleanala.ie/publicaccess/EIAR-NIS/322485/Vol%203%20-%20Appendices/Appendix%2012-3%20Noise%20Modelling%20Assumptions%20and%20Inputs.pdf
- Walking sounds by substrate (Goerlitz et al. 2008): https://bio.acousti.ca/sites/default/files/2799.full_.pdf
- Footstep levels: https://www.researchgate.net/publication/236117181_Investigating_the_amplitude_of_interactive_footstep_sounds_and_soundscape_reproduction ,
  https://www.scirp.org/journal/paperinformation.aspx?paperid=98579

## Calls

Not footfalls, so not this table:

- **A soft bark** (a wolf's signal to its mate: sim.js BARKING): about 70 dBA at 1 m. Dogs'
  barks reach 80-100 dB and wolves bark softer than dogs (startled, a few barks); a soft
  bark taken some 20 dB under a dog's full one. By the model above: heard to 68 m by day,
  141 m by night; the game holds the night's to 123 m, the farthest any other sense
  reaches (senses.js detectTiles), so barks are found in the grid of nearby creatures
  like footfalls (senses.js NEARBY). The same soft bark serves its calls ("come": to kin
  it has lost).
- **A pup's whimper** (sim.js BARKING, a hungry infant's call): taken some 10 dB under a soft
  bark, about 60 dBA at 1 m (estimate). By the model above: heard to 28 m by day, 69 m by
  night.
- **A howl** (sim.js HOWLING): low (150-780 Hz) and long, it loses far less on its way than
  the model's 5 dB per 100 m, so it is given its own range: 3,000 m by day (howls were
  identified some 3 km off by recorders: Suter et al. 2017, Bioacoustics 26:237-248) and
  6,400 m by night (heard over as much as 130 km2, some 6.4 km round, in good conditions).
