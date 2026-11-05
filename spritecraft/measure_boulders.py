"""Boulder footprints (see BOULDER FOOTPRINTS in sim.js): the ground each rock sprite of
tiles.png actually covers, and how wide it is across each of the 8 directions, so a rock
hides from sight only what is behind the rock itself, not its whole tile.

THE FRONT of a footprint is the sprite's bottom edge: in each column, the bottom of its
lowest opaque pixel touches the ground. Its BACK isn't drawn (and rocks are never drawn
turned), so it is taken to mirror the front: the front edge turned half round about the
footprint's center (its middle left to right; as far up from the lowest point of the front
as a round footprint that wide would be: a quarter of its width, the ground being drawn
half as tall as wide). From screen to ground, about the tile's center, row FOOT_Y of the
cell (column 16): screen x = (i - j) * 16, y = (i + j) * 8.

ACROSS EACH DIRECTION (sim's 8, E = +i, S = +j, ...): for a line of sight heading d, the
footprint spans [lo, hi] along d's left-hand normal n = (-dy, dx), in tiles, from the tile's
center: a line passing the center at offset s (along n) meets the rock if lo <= s <= hi.

Prints the table for sim.js (BOULDER FOOTPRINTS: boulderRocks), and saves a picture of each
rock with its footprint to admin/boulder_footprints.png.

Run from the project root:  python3 spritecraft/measure_boulders.py
"""
import math
from PIL import Image, ImageDraw

CELL = 32
FOOT_Y = 25  # the cell row on the tile's center (animat.js: boulderFootCenterY)
# [column, row] in tiles.png, and colour: in animat.js's order (boulderRockCells)
ROCKS = [((9, 4), "brown"), ((10, 4), "brown"), ((0, 5), "brown"), ((1, 5), "brown"), ((2, 5), "brown"),
         ((3, 5), "brown"), ((4, 5), "brown"), ((5, 5), "brown"),
         ((7, 5), "grey"), ((9, 5), "grey"), ((10, 5), "grey"), ((0, 6), "grey"), ((1, 6), "grey")]
R2 = 1 / math.sqrt(2)
DIRS = [(1, 0), (R2, R2), (0, 1), (-R2, R2), (-1, 0), (-R2, -R2), (0, -1), (R2, -R2)]

sheet = Image.open("images/tiles.png").convert("RGBA")


def to_ground(x, y):
    """Screen offset (px, from the tile's center) to ground offset (i, j), tiles."""
    a, b = x / 16, y / 8  # i - j, i + j
    return ((a + b) / 2, (b - a) / 2)


def footprint(cell):
    px = cell.load()
    front = []
    for x in range(CELL):
        ys = [y for y in range(CELL) if px[x, y][3] > 0]
        if ys:
            front.append((x + 0.5, max(ys) + 1.0))
    xl, xr = front[0][0] - 0.5, front[-1][0] + 0.5
    width = xr - xl
    cx, cy = (xl + xr) / 2, max(y for _, y in front) - width / 4
    back = [(2 * cx - x, 2 * cy - y) for x, y in front]
    pts = [to_ground(x - 16, y - FOOT_Y) for x, y in front + back]
    return pts, front, back


rows, pictures = [], []
for (col, row), colour in ROCKS:
    cell = sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL))
    pts, front, back = footprint(cell)
    bands = []
    for dx, dy in DIRS:
        nx, ny = -dy, dx
        s = [i * nx + j * ny for i, j in pts]
        bands.append((min(s), max(s)))
    rows.append((col, row, colour, bands))
    pictures.append((cell, front, back))

print("const boulderRocks = [ // [lo, hi] by direction (E, SE, S, SW, W, NW, N, NE)")
for col, row, colour, bands in rows:
    b = ", ".join(f"[{lo:.2f}, {hi:.2f}]" for lo, hi in bands)
    print(f'  {{ colour: "{colour}", across: [{b}] }}, // tiles.png [{col}, {row}]')
print("];")

Z = 8
out = Image.new("RGBA", (len(pictures) * (CELL * Z + 8), CELL * Z), (255, 255, 255, 255))
d = ImageDraw.Draw(out)
for k, (cell, front, back) in enumerate(pictures):
    ox = k * (CELL * Z + 8)
    bg = Image.new("RGBA", (CELL * Z, CELL * Z), (200, 220, 240, 255))
    bg.alpha_composite(cell.resize((CELL * Z, CELL * Z), Image.NEAREST))
    out.paste(bg, (ox, 0))
    c = (16 * Z + ox, FOOT_Y * Z)
    d.polygon([(c[0], c[1] - 8 * Z), (c[0] + 16 * Z, c[1]), (c[0], c[1] + 8 * Z), (c[0] - 16 * Z, c[1])], outline=(255, 0, 0, 255))
    poly = [(ox + x * Z, y * Z) for x, y in front] + [(ox + x * Z, y * Z) for x, y in back]
    d.line(poly + [poly[0]], fill=(255, 255, 0, 255), width=2)
out.save("admin/boulder_footprints.png")
