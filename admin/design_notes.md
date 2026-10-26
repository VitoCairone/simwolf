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

- its meters: wind, stamina, food
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
  is: `sleep` in animat.js).
- **Wolf sleep.** The wolf's sleeping frames (columns 48-49 of `wolf-land.png` and the
  young sheets) are the artist's corpse frame, edited (mouth and eye closed, a breathing
  frame): `extract_wolf_sheet.py`. A stopgap until real lying-down frames are drawn.

