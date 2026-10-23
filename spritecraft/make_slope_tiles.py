#!/usr/bin/env python3
"""Generate the sloped ground tiles from the flat blocks in tiles.png.

    images/tiles.png  ->  images/ground-slopes.png

Usage (from anywhere; needs Python 3 with Pillow and numpy):

    python3 spritecraft/make_slope_tiles.py                 # regenerate images/ground-slopes.png
    python3 spritecraft/make_slope_tiles.py --out-dir /tmp  # write somewhere else to compare

THE TERRAIN MODEL (see "TERRAIN HEIGHT" in sim.js)
Heights are whole levels; one level is LEVEL_PX = 8 screen pixels, exactly the height of
a block's side (its "riser") in tiles.png. Each tile has a base level m and four corners,
each at m or m + 1, so there are 15 tile shapes (all four corners up is just a flat tile
one level higher). The game draws a land tile as its shape's sprite, whose sides reach one
level below its base (like a flat block), plus a stack of riser strips below that where a
cliff drops further.

THE SHEET: one row per ground material, 16 cells of CELL_W x CELL_H each:
    cells 0..14   the 15 shapes. Cell index = corner bits: NW 1, NE 2, SW 4, SE 8, where
                  a bit is set when that corner is one level above the base. (NW is the
                  tile's top corner on screen, NE right, SW left, SE bottom.)
    cell 15       one level of riser (side faces only), for stacking under cliffs.
In every cell, the N (top) corner of the tile's base plane is at (16, BASE_Y): a shape
cell is drawn with its top-left at (screen x of N corner - 16, screen y - BASE_Y). A
riser cell has the N corner at (16, 0) and is drawn k levels down for the k-th riser.

How each shape is made from a flat block:
  - Top: every point (u, v) of the tile (0..1 on each grid axis) keeps the flat block's
    texture at that point, and is drawn raised by its height (bilinear between the
    corners), back to front. Slopes are shaded a little by which way they face (light
    from the upper left of the screen).
  - Sides: the two visible faces (SW-SE on the lower left, NE-SE on the lower right)
    run from the tile's top edge down to one level below the base. The flat block's side
    is used for them: its top rows (grass lip etc.) at the top, its earth below, repeated
    for taller faces.
  - Shape 0 (flat) is the flat block exactly.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

LEVEL_PX = 8          # screen pixels per level: one block riser
CELL_W, CELL_H = 32, 40
BASE_Y = 16           # in a shape cell, the y of the base plane's N corner
N_SHAPES = 15
RISER_COL = 15

# Ground materials, one sheet row each: (name, flat block cell in tiles.png, riser source).
# The riser (cliff) source is the block whose side fills cliff faces below the lip.
MATERIALS = [
    ("grass", (64, 64), (288, 0)),     # grass top, short; earth (dirt block) cliffs
    ("dirt",  (288, 0), (288, 0)),
    ("stone", (192, 160), (192, 160)),
    ("grass-medium", (0, 64), (288, 0)),   # medium grass (tufts at the edges)
    ("grass-tall", (32, 64), (288, 0)),    # tall grass (tufts standing above the top)
    ("grass-bare", "grazed", (288, 0)),    # grazed-out grass: dirt with stubble (grazed_block)
]

LIP_ROWS = 3          # top rows of a block side that belong at the top of any face
SHADE = 0.10          # brightness change per level of rise across a tile


def load_block(tiles, xy):
    if xy == "grazed":
        return grazed_block(tiles)
    x, y = xy
    return np.array(tiles.crop((x, y, x + 32, y + 32)).convert("RGBA"))


# GRAZED-OUT GRASS: no such block in tiles.png, so it is made from the dirt block (288, 0)
# with stubble on its top - small clumps of the grass block's greens, cropped short - and
# a few darker, trampled specks.
STUBBLE = {"L": (168, 202, 88, 255), "M": (117, 167, 67, 255), "D": (70, 130, 50, 255)}
TRAMPLED = (122, 72, 65, 255)
TUFTS = [["L.L", ".M."], ["LL", "MD"], [".L.", "LMD"], ["L", "M"], ["L.", ".D"], ["M"]]


def grazed_block(tiles):
    out = load_block(tiles, (288, 0)).copy()
    dirt = tuple(int(c) for c in out[16, 16])

    def on_top(x, y):  # well inside the top diamond (centre (16, 16), 32 x 16)
        return abs(x + 0.5 - 16) / 16 + abs(y + 0.5 - 16) / 8 <= 0.85

    for gy in range(9, 24, 3):  # clumps on a jittered lattice
        for gx in range(2, 31, 5):
            x0, y0 = gx + (gy * 7) % 5 - 2, gy + (gx * 3) % 3 - 1
            if not on_top(x0, y0):
                continue
            for dy, line in enumerate(TUFTS[(gx * 5 + gy * 3) % len(TUFTS)]):
                for dx, ch in enumerate(line):
                    if ch != "." and on_top(x0 + dx, y0 + dy):
                        out[y0 + dy, x0 + dx] = STUBBLE[ch]
    for x, y in [(9, 15), (20, 12), (24, 18), (14, 20), (17, 16)]:
        if on_top(x, y) and tuple(int(c) for c in out[y, x]) == dirt:
            out[y, x] = TRAMPLED
    return out


def side_band(block, col):
    """The side pixels of a flat block in one column: from just below the top face down
    to the block's bottom (inclusive), top to bottom."""
    u = (col + 0.5) / 16 if col < 16 else (31 - col + 0.5) / 16
    start = int(16 + 8 * u)          # first row below the top diamond, block coords
    alpha = block[:, col, 3]
    bottom = int(np.nonzero(alpha)[0].max())
    return block[start:bottom + 1, col]


def face_color(band, earth_band, d, length):
    """Colour at depth d (0 = top) of a face `length` px tall, from the block side band."""
    n = len(band)
    if length <= n:                   # no taller than a flat side: the side as is
        return band[d] if d < n else band[-1]
    if d < LIP_ROWS:
        return band[d]
    from_bottom = length - 1 - d
    if from_bottom < n - LIP_ROWS:    # keep the band's own bottom rows (outline) at the bottom
        return band[n - 1 - from_bottom]
    body = earth_band[LIP_ROWS:-1] if len(earth_band) > LIP_ROWS + 1 else earth_band
    return body[(d - LIP_ROWS) % len(body)]


def corners_of(bits):
    return {"nw": bits & 1, "ne": (bits >> 1) & 1, "sw": (bits >> 2) & 1, "se": (bits >> 3) & 1}


def height(c, u, v):
    return (c["nw"] * (1 - u) * (1 - v) + c["ne"] * u * (1 - v)
            + c["sw"] * (1 - u) * v + c["se"] * u * v)


def shape_cell(block, earth, bits):
    cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    if bits == 0:
        cell[BASE_Y - 8:BASE_Y + 24] = block      # the flat block, unchanged
        return cell
    c = corners_of(bits)

    # sides: lower-left face (SW-SE edge, v = 1) for columns 0..15, lower-right face
    # (NE-SE edge, u = 1) for columns 16..31
    for col in range(32):
        if col < 16:
            u, v = (col + 0.5) / 16, 1.0
        else:
            u, v = 1.0, (31 - col + 0.5) / 16
        edge_y = BASE_Y + (u + v) * 8                       # top edge at the base level
        top = int(round(edge_y - height(c, u, v) * LEVEL_PX))
        band = side_band(block, col)
        earth_band = side_band(earth, col)
        bottom = int(edge_y) + len(band) - 1                # same bottom as the flat block
        length = bottom - top + 1
        for d in range(length):
            cell[top + d, col] = face_color(band, earth_band, d, length)

    # top surface, back to front
    steps = 96
    for s in range(2 * steps + 1):                          # s = (u + v) * steps
        for iu in range(max(0, s - steps), min(steps, s) + 1):
            iv = s - iu
            u, v = (iu + 0.5) / (steps + 1), (iv + 0.5) / (steps + 1)
            # texture from slightly inside the flat top, so its outline pixels don't
            # speckle the slope's edges
            su, sv = 0.04 + 0.92 * u, 0.04 + 0.92 * v
            tx = 16 + (su - sv) * 16
            ty = 8 + (su + sv) * 8
            src = block[min(31, int(ty)), min(31, int(tx))]
            if src[3] == 0:
                continue
            x = int(16 + (u - v) * 16)
            y = int(BASE_Y + (u + v) * 8 - height(c, u, v) * LEVEL_PX)
            dzdu = (c["ne"] - c["nw"]) * (1 - v) + (c["se"] - c["sw"]) * v
            dzdv = (c["sw"] - c["nw"]) * (1 - u) + (c["se"] - c["ne"]) * u
            f = 1 + SHADE * (dzdu + 0.4 * dzdv)            # faces lit from grid W (screen upper left)
            rgb = np.clip(src[:3].astype(float) * f, 0, 255).astype(np.uint8)
            if 0 <= y < CELL_H and 0 <= x < CELL_W:
                cell[y, x, :3] = rgb
                cell[y, x, 3] = 255
    return cell


def riser_cell(earth):
    """One level of side faces, with the base plane's N corner at (16, 0)."""
    cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    for col in range(32):
        u = (col + 0.5) / 16 if col < 16 else 1.0
        v = 1.0 if col < 16 else (31 - col + 0.5) / 16
        edge_y = (u + v) * 8
        band = side_band(earth, col)
        body = band[LIP_ROWS:]                              # no lip: this is below the surface
        for d in range(LEVEL_PX + 1):                       # 8 rows + the bottom outline row
            src = body[d] if d < len(body) - 1 else band[-1]
            if d == LEVEL_PX:
                src = band[-1]                              # outline; the next riser covers it
            cell[int(edge_y) + d, col] = src
    return cell


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=IMAGES / "tiles.png")
    ap.add_argument("--out-dir", type=Path, default=IMAGES)
    args = ap.parse_args()
    tiles = Image.open(args.src)

    sheet = np.zeros((CELL_H * len(MATERIALS), CELL_W * 16, 4), np.uint8)
    for row, (name, block_xy, earth_xy) in enumerate(MATERIALS):
        block, earth = load_block(tiles, block_xy), load_block(tiles, earth_xy)
        for bits in range(N_SHAPES):
            sheet[row * CELL_H:(row + 1) * CELL_H, bits * CELL_W:(bits + 1) * CELL_W] = \
                shape_cell(block, earth, bits)
        sheet[row * CELL_H:(row + 1) * CELL_H, RISER_COL * CELL_W:(RISER_COL + 1) * CELL_W] = \
            riser_cell(earth)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / "ground-slopes.png"
    Image.fromarray(sheet).save(out)
    print(f"wrote {out}  ({sheet.shape[1]}x{sheet.shape[0]}: rows "
          f"{', '.join(m[0] for m in MATERIALS)}; cells 0-14 shapes, 15 riser)")


if __name__ == "__main__":
    main()
