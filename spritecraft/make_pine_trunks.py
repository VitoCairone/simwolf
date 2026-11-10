#!/usr/bin/env python3
"""Pine trunks, as wide as the trees' own, drawn by this script.

PLACEHOLDER: AI-generated (the artist drew no trees), not canonical: to be replaced, and
not to be used as a base for new art (admin/design_notes.md).

    ->  images/pine-trunks.png

Usage (from anywhere; needs Python 3 with Pillow):

    python3 spritecraft/make_pine_trunks.py                 # regenerate images/pine-trunks.png
    python3 spritecraft/make_pine_trunks.py --out-dir /tmp  # write somewhere else to compare
    python3 spritecraft/make_pine_trunks.py --preview p.png # also save an enlarged preview

(make_pines.py runs this too, and writes where the trunks are into images/pines.js.)

A tree's trunk blocks sight as wide as its diameter (sim.js PINES), so it is drawn that
wide: a metre across the line of sight is PX_PER_M_ACROSS px on screen (a tile's diagonal,
32 px, is 1.41 m), so trees of 10-79 cm are 2-18 px. Seen from the game's angle (30 degrees
above the ground: a tile is twice as wide as it is deep), a level circle is an ellipse
half as deep as it is wide, so a trunk's foot is the front half of one.

THE SHEET: one row of CELL_W x CELL_H cells, a column for each width, WIDTHS[0] px to
WIDTHS[-1]; the trunk's foot (its axis at the ground) at (FOOT_X, FOOT_Y) in each (the
boundary between pixels FOOT_X - 1 and FOOT_X: the tile's center). Each trunk rises
TRUNK_PX from its foot, as tall as the tallest crown's base and some way into it: a tree
draws only as much of it as reaches into its own crown (images/pines.js, trunkPX). Bark
lit from the left, darker toward the right, with seams between plates.
"""

import argparse
import math
import random
from pathlib import Path

from PIL import Image

PX_PER_M_ACROSS = 32 / math.sqrt(2)
CELL_W = 24
FOOT_X = CELL_W // 2
WIDTHS = list(range(2, 19))
TRUNK_PX = 480
FOOT_Y = TRUNK_PX + 1
CELL_H = FOOT_Y + WIDTHS[-1] // 4 + 2

BARK = {
    "dark": (52, 28, 39),
    "mid": (77, 43, 50),
    "light": (122, 72, 65),
}


def put(im, x, y, colour):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), colour + (255,))


def trunk(im, x0, width, seed):
    rng = random.Random(seed)
    rx, ry = width / 2, width / 4
    cx = x0 + FOOT_X
    for k in range(width):
        xc = -rx + k + 0.5                         # the pixel's center, from the axis
        s = xc / rx                                # -1 left (lit) .. 1 right
        # its foot: the front half of the ellipse
        bottom = FOOT_Y + ry * math.sqrt(max(0.0, 1 - s * s))
        if width >= 3 and k == width - 1:
            c = "dark"
        elif s < -0.3:
            c = "light"
        elif s < 0.5:
            c = "mid"
        else:
            c = "dark"
        for y in range(FOOT_Y - TRUNK_PX, math.floor(bottom - 0.5) + 1):
            put(im, cx - width // 2 + k, y, BARK[c])
        # the foot's rim, a shade darker
        if width >= 4:
            put(im, cx - width // 2 + k, math.floor(bottom - 0.5), BARK["dark" if c != "light" else "mid"])
    # seams between the plates
    if width >= 4:
        for _ in range(TRUNK_PX * width // 24):
            k = rng.randrange(1, width - 1)
            y = rng.randrange(FOOT_Y - TRUNK_PX, FOOT_Y - 2)
            seam = "mid" if (k + 0.5) / width < 0.35 else "dark"
            for d in range(rng.randrange(2, 6)):
                put(im, cx - width // 2 + k, y + d, BARK[seam])


def build():
    im = Image.new("RGBA", (len(WIDTHS) * CELL_W, CELL_H), (0, 0, 0, 0))
    for c, width in enumerate(WIDTHS):
        trunk(im, c * CELL_W, width, 500 + c)
    return im


def layout():
    """Where the trunks are, for images/pines.js."""
    return {"cellW": CELL_W, "cellH": CELL_H, "footX": FOOT_X, "footY": FOOT_Y, "trunkPX": TRUNK_PX, "widths": WIDTHS}


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out-dir", default=str(here.parent / "images"))
    ap.add_argument("--preview")
    args = ap.parse_args()
    im = build()
    out = Path(args.out_dir) / "pine-trunks.png"
    im.save(out)
    print("wrote", out, im.size)
    if args.preview:
        bg = Image.new("RGBA", im.size, (96, 140, 70, 255))
        bg.alpha_composite(im)
        bg.crop((0, CELL_H - 60, im.width, CELL_H)).resize((im.width * 4, 240), Image.NEAREST).save(args.preview)


if __name__ == "__main__":
    main()
