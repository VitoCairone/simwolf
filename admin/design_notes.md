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

## Biomass is never made but by plants

Everything living is biomass: fat, carbohydrate, protein, water and minerals, in kg (see
BIOMASS in `sim.js`). Only plants make it, growing (from air, soil and sunlight, which
aren't counted): grass, and the undergrowth (low bushes and flowers). The one other way
in is water: a critter drinks it (lakes and rivers aren't counted), and its burning makes
some (with the air's oxygen). Everything else only
moves it (eating, digesting, a womb filling, suckling) or spends it, and it leaves the
world (burned by metabolism, excreted, breathed out or evaporated, rotted away with a
corpse). A body may turn carbs and fat into each other, and protein into either, keeping
their energy; nothing makes protein. The ledger (`biomassLedger`) counts all that comes
in and all that leaves, so the world's biomass always adds up (`tests/biomass.test.js`).

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
- **Wolf stalking.** `images/wolf-stalk.png` (and `young/wolf-stalk-stage*.png`) is the
  wolf's land sheet shaded 20% toward dark purple (`spritecraft/make_stalk_sheets.py`),
  its run frames played slowly. A stopgap until real stalking frames (crouched, head low)
  are drawn.
- **Carried deer leg.** A wolf carrying a leg is drawn with an overlay sheet per wolf
  sheet (`images/wolf-land-leg.png`, `wolf-stalk-leg.png`, `wolf-swim-leg.png` and the
  last young stage's), made by `spritecraft/make_carried_leg.py`: a small leg in the deer's
  colours held across the mouth, which is found in each frame from the wolf's own pixels.
  A stopgap until real carrying frames are drawn. A howling wolf (the howl columns) is
  drawn without it.
- **Barking.** A wolf's soft bark (sim.js BARKING) has no frames: it is heard, not seen.
- **Crawling.** A newborn too young to walk crawls on its walk frames played at 30% of
  their pace (`crawl` in animat.js, wolf and deer alike). A stopgap until real crawling
  frames (belly low, legs splayed) are drawn.

- **Pines.** The artist drew no trees. `images/pines.png` (crowns, their shadows, and
  saplings, at real size), `images/pine-trunks.png` (trunks, each as wide as the tree
  blocks sight) and their layout `images/pines.js` were AI-generated by
  `spritecraft/make_pines.py` (which runs `spritecraft/make_pine_trunks.py`).

- **Shore corners.** `images/shore-outer.png` (outer corners, water off a corner of land)
  and `images/shore-inner.png` (interior corners, water in a notch of land) are made from
  the artist's straight shore sprites (`tiles.png` row 9, columns 0-1) by
  `spritecraft/make_shore_tiles.py`, so they join the straight ones seamlessly. The
  artist's own corner sprites (columns 2-5) are not used: they don't match the straight
  ones.
- **Five-facing sheets, and the game's up, right and down.** `images/wolf-5dir.png` and
  `images/stag-5dir.png` hold every sprite of the artist's two GIFs plus the facings the
  artist didn't draw: rows U (up) and D (down) are AI-generated (a 3D puppet fitted to the
  artist's views), and R (right) is the artist's down-right sprite with its slope taken
  out (`spritecraft/facings5/`, see its README). Rows 4 (↑), 5 (→) and 6 (↓) of the game's
  sheets `images/wolf-land.png` and `images/stag-land.png` (← is → mirrored) are copied
  from them by `spritecraft/facings5/install.py`: every wolf pose but sleep (which has the
  diagonals only), and every stag pose. The same rows of `hind-land.png`, the
  swim, stalk and carried-leg sheets and the young sheets are made from them. Rows 0-3
  are the artist's, unchanged.
