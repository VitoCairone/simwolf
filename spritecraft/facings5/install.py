#!/usr/bin/env python3
"""The game's sheets' up, right and down rows, from the five-facing sheets.

    images/wolf-5dir.png  ->  rows 4 (up), 5 (right), 6 (down) of images/wolf-land.png
    images/stag-5dir.png  ->  rows 4, 5, 6 of images/stag-land.png

PLACEHOLDER art (admin/design_notes.md): rows U and D are AI-generated, R is the artist's
down-right with its slope taken out (see README.md). Rows 0-3 (the artist's diagonals)
are left as they are.

Run after spritecraft/extract_wolf_sheet.py and spritecraft/deer_facings.py (which write
those sheets with older rows 4-6), then the sheets made from them:

    python3 spritecraft/facings5/install.py
    python3 spritecraft/make_hind_sheets.py
    python3 spritecraft/make_swim_sheets.py
    python3 spritecraft/make_young_sheets.py
    python3 spritecraft/make_stalk_sheets.py
    python3 spritecraft/make_carried_leg.py

PLACING: the wolf's land frames are the five-facing sheet's 64x64 cells as they are. The
stag's (48x41) are windows of them: R where the artist's down-right is (found by matching
its pixels, DEER_DR_AT); U and D, generated with the ground under the middle of the trunk
at (32, 44) of the cell, where the artist's frames have it (as fitted: about (22, 35) of a
land frame, up-right and down-right alike).
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent.parent
IMAGES = PROJECT / "images"

# animation -> its first column on the land sheet (its frames in the five-facing sheet's order)
WOLF_COLS = {"run": 0, "idle": 8, "howl": 12, "death": 21, "bite": 33}
DEER_COLS = {"walk": 0, "idle": 11, "run": 35}
LAND_ROWS = {"U": 4, "R": 5, "D": 6}
DEER_DR_AT = (9, 14)   # the land frame's top left in the five-facing cell, for R
DEER_UD_AT = (10, 9)   # for U and D


def install(sheet5, meta, land, fw, fh, cols, at):
    src = np.array(Image.open(IMAGES / sheet5).convert("RGBA"))
    m = json.load(open(IMAGES / meta))
    out = np.array(Image.open(IMAGES / land).convert("RGBA"))
    lost = 0
    for anim, col0 in cols.items():
        a = m["animations"][anim]
        for facing, lrow in LAND_ROWS.items():
            r = a["row"] + m["rows"].index(facing)
            x0, y0 = at[facing]
            for k in range(a["frames"]):
                cell = src[r * 64:(r + 1) * 64, k * 64:(k + 1) * 64]
                win = cell[y0:y0 + fh, x0:x0 + fw]
                lost += int((cell[..., 3] == 255).sum() - (win[..., 3] == 255).sum())
                c = col0 + k
                out[lrow * fh:(lrow + 1) * fh, c * fw:(c + 1) * fw] = win
    Image.fromarray(out).save(IMAGES / land)
    print("wrote", IMAGES / land, f"({lost} opaque px outside the frames)")


def main():
    install("wolf-5dir.png", "wolf-5dir.json", "wolf-land.png", 64, 64, WOLF_COLS, {f: (0, 0) for f in LAND_ROWS})
    install("stag-5dir.png", "stag-5dir.json", "stag-land.png", 48, 41, DEER_COLS,
            {"U": DEER_UD_AT, "R": DEER_DR_AT, "D": DEER_UD_AT})


if __name__ == "__main__":
    main()
