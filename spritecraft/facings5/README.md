# Five facings from the artist's two GIFs

Makes `images/wolf-5dir.png` and `images/stag-5dir.png` (and their `.json` layouts) from
the artist's animations in `images_raw/` (`5V5aC4.gif` the wolf, `OvN65m.gif` the stag).

PLACEHOLDER, in part: the rows U (up) and D (down) are AI-generated, and R (right) is the
artist's DR with a slope taken out; not canonical (admin/design_notes.md).

## The sheets

64x64 cells. Each animation is a block of rows, one row a facing, one column a frame:

    U   up           generated (a 3D puppet fitted to the artist's two views, drawn from behind)
    UR  up-right     the artist's
    R   right        the artist's DR, its columns shifted to level it (every pixel the artist's)
    DR  down-right   the artist's
    D   down         generated (the puppet from the front)
    UL, DL           (stag only) the artist's own left-facing sprites: not mirror images of
                     UR and DR (the antlers are lit from the same side; the idle differs)

Left, up-left and down-left are R, UR and DR mirrored. Shadows are in the cells (the shadow
colour 21,29,40 with alpha). The `.json` gives each animation's first row, its frames, their
durations (ms) and the GIF frames each came from; the stag's also its GIF playing order.

The wolf's GIF shows the artist's sheet `images_raw/wolf-all.png` cell for cell (checked:
every opaque pixel), so its UR and DR cells are taken from that sheet (true alpha, nothing
cut by the GIF's edges). Its left-facing sprites are exact mirror images (but 3 half-clear
pixels in bite 12), so they have no rows.

## Making them again

    python3 library.py            # the artist's sprites from the sources -> work/library.pkl
    python3 make5.py wolf         # -> work/out/wolf-5dir.png, .json, previews
    python3 make5.py deer

`work/` holds the fits these use: the puppet's shape and the artist's two cameras for each
animal (`fit_*_shape.pkl`, by `fit_wolf_shape.py`, `fit_deer_shape.py`), its pose in every
frame (`fit_*_poses.pkl`, by `fit_all.py wolf|deer`: about an hour each), and where the
GIF puts the wolf sheet's cells (`wolf_layout.pkl`).

## Into the game

    python3 install.py            # rows 4 (U), 5 (R), 6 (D) of images/wolf-land.png, stag-land.png

then the sheets made from those (hind, swim, young, stalk, carried leg); the order is in
`install.py`. The wolf's sleep keeps the diagonals only. `spritecraft/extract_wolf_sheet.py`
and `spritecraft/deer_facings.py` write older rows 4-6: run `install.py` again after either.

## How U and D are made

`quad.py` is a quadruped of ellipsoids (trunk, neck, head, ears, tail, four two-part legs,
antlers); `fit.py` finds, for each frame, the pose whose outline best covers the artist's
DR and UR sprites at once (the artist's views turn out to be about 55 and 130 degrees
round from head-on, 26-36 degrees above the ground). `render5.py` draws that pose from
head-on and from behind in the artist's palette (colours by rule, a darker shade where a
part passes behind another and where the flanks turn away), a quarter wider than fitted
(the artist draws them stocky), with a soft shadow of its footprint.

Known limits: effects (dust, the bite's slash, the open mouth) are only in the artist's
rows and R; the stag's head turns in its idle are not in U and D; the wolf's death lies as
it fell from frame 8 on (the pose of frame 7).
