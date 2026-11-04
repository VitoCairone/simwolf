"""Undergrowth sprites (see UNDERGROWTH in animat.js): the artist's low bushes and flowers
from tiles.png, each with its FOREGROUND HALF as a separate overlay, drawn again over a
critter standing on its tile (so the critter stands in the plant, not on it).

images/undergrowth.png: one 32 x 32 cell a sprite, in SPRITES' order; row 0 the whole
sprite, as the artist drew it; row 1 its foreground half.

THE FOREGROUND HALF is the part below a cut about halfway up the plant (the cut row in
SPRITES, in the cell, set by eye for each sprite), adjusted so the overlay's edge looks
drawn rather than sliced:
  - along the cut, each column's edge moves down to a leaf's dark outline when there is one
    within SNAP rows (so the overlay starts at a leaf's edge);
  - a flower (a 4-connected patch of non-green pixels, with the dark outline touching it)
    is kept or left out whole: kept when most of it lies below the cut (not for a bush
    whose flowers touch, WHOLE_FLOWERS False);
  - scraps left over (under MIN_SCRAP pixels, 8-connected) are dropped.

Run from the project root:  python3 spritecraft/make_undergrowth.py
"""
import colorsys
from PIL import Image

CELL = 32
# (tiles.png [column, row], kind, cut row, whole flowers): bushes, then flowers
SPRITES = [
    ((1, 4), "bush", 18, False),
    ((10, 3), "bush", 21, False),
    ((0, 4), "flowers", 19, False),
    ((2, 4), "flowers", 22, True),
    ((8, 3), "flowers", 22, True),
    ((9, 3), "flowers", 23, True),
    ((3, 4), "flowers", 23, True),
]
SNAP = 2
MIN_SCRAP = 6

sheet = Image.open("images/tiles.png").convert("RGBA")


def is_dark(p):
    return p[3] and (p[0] + p[1] + p[2]) / 3 < 50


def is_petal(p):
    if not p[3] or is_dark(p):
        return False
    h, s, v = colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)
    return s > 0.25 and not (0.17 < h < 0.5)  # not green


def foreground(cell, cut, whole_flowers):
    px = cell.load()
    keep = [[False] * CELL for _ in range(CELL)]
    for x in range(CELL):
        edge = cut
        for y in range(cut, min(CELL, cut + SNAP + 1)):
            if is_dark(px[x, y]) and (y == 0 or not is_dark(px[x, y - 1])):
                edge = y
                break
        for y in range(edge, CELL):
            keep[y][x] = px[x, y][3] > 0
    # flowers whole
    seen = set()
    for y0 in range(CELL if whole_flowers else 0):
        for x0 in range(CELL):
            if (x0, y0) in seen or not is_petal(px[x0, y0]):
                continue
            patch, todo = [], [(x0, y0)]
            seen.add((x0, y0))
            while todo:
                x, y = todo.pop()
                patch.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < CELL and 0 <= ny < CELL and (nx, ny) not in seen and is_petal(px[nx, ny]):
                        seen.add((nx, ny))
                        todo.append((nx, ny))
            below = sum(1 for _, y in patch if y >= cut) * 2 >= len(patch)
            outline = {(nx, ny) for x, y in patch for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
                       if 0 <= nx < CELL and 0 <= ny < CELL and is_dark(px[nx, ny])}
            for x, y in patch + sorted(outline):
                keep[y][x] = below
    # scraps
    seen = set()
    for y0 in range(CELL):
        for x0 in range(CELL):
            if (x0, y0) in seen or not keep[y0][x0]:
                continue
            part, todo = [], [(x0, y0)]
            seen.add((x0, y0))
            while todo:
                x, y = todo.pop()
                part.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < CELL and 0 <= ny < CELL and (nx, ny) not in seen and keep[ny][nx]:
                            seen.add((nx, ny))
                            todo.append((nx, ny))
            if len(part) < MIN_SCRAP:
                for x, y in part:
                    keep[y][x] = False
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    po = out.load()
    for y in range(CELL):
        for x in range(CELL):
            if keep[y][x]:
                po[x, y] = px[x, y]
    return out


out = Image.new("RGBA", (CELL * len(SPRITES), CELL * 2), (0, 0, 0, 0))
for k, ((col, row), kind, cut, whole) in enumerate(SPRITES):
    cell = sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL))
    out.paste(cell, (k * CELL, 0))
    out.paste(foreground(cell, cut, whole), (k * CELL, CELL))
out.save("images/undergrowth.png")
print("images/undergrowth.png:", ", ".join(kind for _, kind, _, _ in SPRITES))
