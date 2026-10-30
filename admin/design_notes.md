# SimWolf design notes

Rules that hold for the whole project. Code and tests should never break them.

## No text or numbers on screen

The game shows no words and no numbers. Everything the player needs is shown in
pictures: sprites, meters as bare bars, icons. The only exception is developer debug
information (such as the pointer's grid coordinates), which is not part of the game.

## No magical knowledge

A critter knows nothing of the world outside itself that does not come from its
senses (`senses.js`), either now or remembered from earlier (the mind's memory in
`mind.js`). This holds everywhere, for any reason, without exception:

- where any other critter is, or was, or is heading: prey, predators, carcasses, a mate,
  a parent, its young, a rival
- what another critter is: species, sex, age, whether alive, whether paired or in heat
- the terrain and grass beyond its own next steps: land, water, shores, food

Outside its senses and memory, a critter knows only **itself**. Its own state is always
available to it:

- its meters: wind, stamina, food (its body's and its stomach's)
- its own body: position, heading, pose, age and what it is old enough to do, whether
  it is in heat or pregnant
- its own ties: whom it is paired with, its parents, its young. These are identities only:
  where any of them is must still come from its senses or memory.

  Known exception, for now: a newborn knows its father, and a critter pairing with a
  parent knows its new partner's young (its step-children), without having met them.
  This is "magical social knowledge", allowed only because critters can't yet
  communicate. Once they can (a mother showing her young to her partner, say),
  communication should establish both, and this exception should go.
- the ground under its next steps (its footing: whether it can step there)

The simulation (`sim.js`) may use the whole world's state to apply physics (collisions,
eating what is in reach, nursing, a mating both critters intend), but it never decides
for a critter. Decisions belong to the mind, which sees only through the senses.

## Biomass is never made but by grass

Everything living is biomass: fat, carbohydrate, protein, water and minerals, in kg (see
BIOMASS in `sim.js`). Only grass makes it, growing (from air, soil and sunlight, which
aren't counted). Everything else only moves it (eating, digesting, a womb filling,
suckling) or spends it, and it leaves the world (burned by metabolism, excreted, rotted
away with a corpse). A body may turn carbs and fat into each other, and protein into
either, keeping their energy; nothing makes protein. The ledger (`biomassLedger`) counts
all that grows and all that leaves, so the world's biomass always adds up
(`tests/biomass.test.js`).

## Placeholder art (not canonical)

Some sprites were not drawn by the artist (Scrabling, see ART_CREDIT.txt) and must be
replaced. Don't treat them as canonical: don't copy their style, and don't derive new
art from them.

- **Deer death.** The artist drew no death frames for deer. The death animation in
  `images/stag-death.png` (and `hind-death.png`, `young/hind-death-stage*.png`) was
  AI-generated (`spritecraft/make_deer_death.py`).
- **Derived from it:** the deer carcass (`deer-carcass.png`, `hind-carcass.png`,
  `young/hind-carcass-stage*.png`, from the death's last frame:
  `make_deer_carcass.py`), and the deer's sleeping pose (the death's third frame, used as
  is: `sleep` in animat.js; not used while sleep is off).
- **Wolf sleep.** The wolf's sleeping frames (columns 48-49 of `wolf-land.png` and the
  young sheets) are the artist's corpse frame, edited (mouth and eye closed, a breathing
  frame): `extract_wolf_sheet.py`. A stopgap until real lying-down frames are drawn.

- **Deer facing up, right and down.** The artist drew the stag on the 4 diagonals only
  (`images/deer-land.png`). Rows 4 (↑), 5 (→) and 6 (↓) of the game's sheet
  `images/stag-land.png` (← is → mirrored) are drawn by `spritecraft/deer_facings.py`:
  a skeleton fitted to the artist's frames, posed and drawn by pixel rules fitted to them
  (`deer_pose.py`, `deer_pixels.py`). Its head is the artist's block for its view, pasted
  at the poll; but seen side-on (the artist drew no profile head) it is drawn from a 3D
  head (`deer_pose.HEAD`: skull, muzzle, jaw, throat, ears, eyes on the sides of the skull),
  only the antlers the artist's.
  The same rows of `hind-land.png`, `stag-swim.png`, `hind-swim.png` and the young sheets
  are made from them. Rows 0-3 are the artist's, unchanged (centred in wider frames).
