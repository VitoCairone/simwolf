#!/usr/bin/env python3
"""The wolf's land sprites and their timing, from the artist's sheet and animated preview.

    images_raw/wolf-all.png (frames) + images_raw/5V5aC4.gif (timing)
        + images/wolf-run-stand.png (our up, right and down facings)  ->  images/wolf-land.png

Usage (from anywhere; needs Python 3 with Pillow and numpy):

    python3 spritecraft/extract_wolf_sheet.py            # write images/wolf-land.png, print the timing
    python3 spritecraft/extract_wolf_sheet.py --out-dir /tmp

THE ARTIST'S SHEET (wolf-all.png): 64 x 64 frames, 4 rows per animation, one per diagonal
facing, in the order down-left, down-right, up-left, up-right:
    rows  0-3   bite  (15 frames)
    rows  4-7   death (12 frames, the last the corpse)
    rows  8-11  howl  (9 frames)
    rows 12-15  run   (columns 0-7) and idle (columns 11-14)
Its shadows are soft (the shadow colour at partial alpha), kept as drawn.

THE PREVIEW (5V5aC4.gif, 4x scale): all four facings at once, playing run (3 cycles),
howl, death, idle (3 cycles) and bite, frame for frame the sheet's columns in order; its
frame durations are the timing below (GIF_SECTIONS). It draws everything in place, but
for three things:
  * the run's up-left and up-right frames 2 px further out and 1 px higher than the rest
    of that facing: this sheet shifts them so every animation shares one ground point.
  * the death: the body slides back some 17 px as it falls (a knock-back, as if struck).
    The frames are kept in place here, so a corpse lies where its wolf stood.
    TODO: the knock-back, for a wolf that is killed.
  * the bite: a lunge forward and back. Kept in place too (the game has no bite yet).

THE SHEET (wolf-land.png): 64 x 64 frames; rows 0 facing up-right, 1 down-right, 2
down-left, 3 up-left (as our old sheet), then 4 up, 5 right, 6 down, which the artist didn't
draw: those rows have only the run and idle, from images/wolf-run-stand.png. Columns:
    0-7 run, 8-11 idle, 12-20 howl, 21-32 death (32 the corpse), 33-47 bite, 48-49 sleep
SLEEP (ours, rows 0-3 only; a placeholder, not canonical: admin/design_notes.md): the corpse lying on its side, its mouth and eye closed (the
red of tongue and eye painted over in its coat's colour), then the same breathing in: the
top of its outline a pixel lower.
(animat.js frameDataBySpeciesAndPose: the wolf's frames and their timing, from this.)
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

PROJECT = Path(__file__).resolve().parent.parent
F = 64
# our row -> the artist's row within each animation's 4 (down-left 0, down-right 1, up-left 2, up-right 3)
ARTIST_ROW_OF = {0: 3, 1: 1, 2: 0, 3: 2}
# animation: (artist's first row, artist's columns, our first column)
ANIMS = {
    "run": (12, range(0, 8), 0),
    "idle": (12, range(11, 15), 8),
    "howl": (8, range(0, 9), 12),
    "death": (4, range(0, 12), 21),
    "bite": (0, range(0, 15), 33),
}
# the run's shift, by our row, to the other animations' ground point (see THE PREVIEW)
RUN_SHIFT = {3: (2, 1), 0: (-2, 1)}
# The preview's sections: the GIF frames each takes, in the sheet's column order.
GIF_SECTIONS = {"run": range(0, 8), "howl": range(24, 33), "death": range(33, 45),
                "idle": range(45, 49), "bite": range(57, 72)}


def shifted(frame, dx, dy):
    out = np.zeros_like(frame)
    h, w = frame.shape[:2]
    out[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] = \
        frame[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
    return out


COAT = (57, 74, 80, 255)       # the corpse's commonest colour
COAT_DARK = (32, 46, 55, 255)  # ...and its shading


def sleeping(corpse):
    """The corpse frame with its reds (tongue, mouth, open eye) painted over in its coat's colours."""
    f = corpse.copy()
    r, g, a = f[:, :, 0].astype(int), f[:, :, 1].astype(int), f[:, :, 3]
    red = (a == 255) & (r > g + 20)
    f[red & (r < 80)] = COAT_DARK
    f[red & (r >= 80)] = COAT
    return f


def breathing(frame):
    """The frame with the top of its outline a pixel lower (its back settling)."""
    f = frame.copy()
    opaque = f[:, :, 3] == 255
    for x in range(F):
        ys = np.nonzero(opaque[:, x])[0]
        if len(ys) > 1 and opaque[ys[0] + 1, x]:
            f[ys[0], x] = 0
    return f


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", type=Path, default=PROJECT / "images")
    args = ap.parse_args()

    artist = np.array(Image.open(PROJECT / "images_raw/wolf-all.png").convert("RGBA"))
    ours = np.array(Image.open(PROJECT / "images/wolf-run-stand.png").convert("RGBA"))
    sheet = np.zeros((7 * F, 50 * F, 4), np.uint8)
    cell = lambda img, r, c: img[r * F:(r + 1) * F, c * F:(c + 1) * F]

    for row in range(4):
        for name, (r0, cols, c0) in ANIMS.items():
            for k, c in enumerate(cols):
                f = cell(artist, r0 + ARTIST_ROW_OF[row], c)
                if name == "run" and row in RUN_SHIFT:
                    f = shifted(f, *RUN_SHIFT[row])
                sheet[row * F:(row + 1) * F, (c0 + k) * F:(c0 + k + 1) * F] = f
    for row in range(4, 7):  # up, right, down: run and idle as before
        sheet[row * F:(row + 1) * F, 0:12 * F] = ours[row * F:(row + 1) * F, 0:12 * F]
    for row in range(4):
        asleep = sleeping(cell(sheet, row, 32))
        sheet[row * F:(row + 1) * F, 48 * F:49 * F] = asleep
        sheet[row * F:(row + 1) * F, 49 * F:50 * F] = breathing(asleep)

    out = args.out_dir / "wolf-land.png"
    Image.fromarray(sheet, "RGBA").save(out)
    print("wrote", out)

    gif = Image.open(PROJECT / "images_raw/5V5aC4.gif")
    ms = [f.info["duration"] for f in ImageSequence.Iterator(gif)]
    for name, frames in GIF_SECTIONS.items():
        c0 = ANIMS[name][2]
        print(f"{name:6} columns {c0}-{c0 + len(frames) - 1}: ms {[ms[i] for i in frames]}")


if __name__ == "__main__":
    main()
