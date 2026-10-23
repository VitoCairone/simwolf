"""Shore sprites made from tiles.png for the shores (see SHORES in animat.js): the corner
sprites turned a quarter turn, and interior-corner sprites (below).

tiles.png row 9 has the shore water sprites: columns 0-1 for water with land on ONE edge
(light along its top-right edge, as drawn), columns 2-5 for water with land on TWO
adjacent edges (light in its top corner, between the top-left and top-right edges); each
set's columns are the frames of its animation. Mirroring turns the one-edge sprite to
face any edge, and the two-edge sprite to the top or bottom corner; for land meeting at
the left or right corner the two-edge sprite has to be truly rotated, which this does.

  images/shore-rotated.png   tiles.png row 9, columns 2-5, each turned a quarter turn
                             (in the grid) so its light corner is on the right: four
                             32 x 32 cells in a row

A quarter turn of the grid moves the diamond's top corner to its right corner. On screen
it maps an offset (x, y) from the diamond's center to (-2y, x/2): the 2:1 staircases of
isometric pixel art map onto 2:1 staircases, so the pixels survive it. Each output pixel
takes the source pixel it comes from (nearest), and the diamond's outline is kept exactly.

Run from the project root:  python3 spritecraft/make_shore_tiles.py
"""
from PIL import Image

CELL = 32
ROW = 9
COLUMNS = [2, 3, 4, 5]
CX, CY = 16, 24  # the water diamond's center in its cell (pixel corners)

sheet = Image.open("images/tiles.png").convert("RGBA")
out = Image.new("RGBA", (CELL * len(COLUMNS), CELL), (0, 0, 0, 0))
for k, col in enumerate(COLUMNS):
    src = sheet.crop((col * CELL, ROW * CELL, (col + 1) * CELL, (ROW + 1) * CELL))
    sp = src.load()
    for y in range(CELL):
        for x in range(CELL):
            if sp[x, y][3] == 0:
                continue  # outside the diamond (it maps onto itself)
            dx, dy = x + 0.5 - CX, y + 0.5 - CY
            # where this pixel comes from: the inverse of (x, y) -> (-2y, x/2)
            sx, sy = 2 * dy, -dx / 2
            ix = min(max(int((CX + sx) // 1), 0), CELL - 1)
            iy = min(max(int((CY + sy) // 1), 0), CELL - 1)
            p = sp[ix, iy]
            if p[3] == 0:  # just outside the source diamond: take the nearest pixel inside
                best = None
                for ny in range(iy - 2, iy + 3):
                    for nx in range(ix - 2, ix + 3):
                        if 0 <= nx < CELL and 0 <= ny < CELL and sp[nx, ny][3]:
                            dd = (nx + 0.5 - CX - sx) ** 2 + (ny + 0.5 - CY - sy) ** 2
                            if best is None or dd < best[0]:
                                best = (dd, sp[nx, ny])
                p = best[1]
            out.putpixel((k * CELL + x, y), p)
out.save("images/shore-rotated.png")
print("wrote images/shore-rotated.png")


# INTERIOR CORNERS (a notch: water with land along two edges that meet at a corner, as in
# a lake's corner). Its wave front runs along both land edges and bends where they meet.
# Made from the straight sprites (columns 0-1) by folding: each pixel shows the straight
# sprite for the land edge it is nearer, so each arm is exactly the straight band beside
# it (joining the straight shore tiles on either side seamlessly) and the two meet in a V
# along the corner's bisector (a seamless join too: the halves mirror each other).
#
#   images/shore-inner.png   two rows of four 32 x 32 frames:
#     row 0: notch at the TOP corner (land along the top-left and top-right edges): the
#            right half the straight sprite as drawn, the left half its mirror image
#     row 1: notch at the RIGHT corner (land along the top-right and bottom-right edges):
#            the top half the straight sprite as drawn, the bottom half mirrored top to
#            bottom (about the diamond's center row)
#   (Notches at the bottom and left corners are these mirrored, by the game.)
#
# Four frames, to keep step with the exterior corner's four: the straight tiles on either
# side show straight frame 0 for the loop's first two steps and frame 1 for the next two,
# so frames 0 and 2 are the folds of those; frames 1 and 3 add the crest where the two
# wave fronts meet along the bisector (one shade lighter there): strong as the swell comes
# in (1), faint as it ebbs (3).
SHADES = [(21, 29, 40), (23, 32, 56), (32, 46, 55), (37, 58, 94), (60, 94, 139), (79, 143, 186)]
SHADE = {c: k for k, c in enumerate(SHADES)}


def straight(col):
    return sheet.crop((col * CELL, ROW * CELL, (col + 1) * CELL, (ROW + 1) * CELL))


def fold_top(im):
    out = im.copy()
    for y in range(CELL):
        for x in range(CX):
            out.putpixel((x, y), im.getpixel((CELL - 1 - x, y)))
    return out


def fold_right(im):
    out = im.copy()
    for y in range(CY, CELL):  # the diamond's rows 16-31 mirror about its center (row 24)
        for x in range(CELL):
            out.putpixel((x, y), im.getpixel((x, 2 * CY - 1 - y)))
    return out


def crest(im, notch, strong):
    out = im.copy()
    for y in range(CELL):
        for x in range(CELL):
            p = im.getpixel((x, y))
            if not p[3] or p[:3] not in SHADE:
                continue
            v = SHADE[p[:3]]
            # how far (px, on screen) from the bisector, and how far along it from the notch
            if notch == "top":
                d, along = abs(x + 0.5 - CX), (y + 0.5 - 16) / 16
            else:
                d, along = abs(y + 0.5 - CY) * 2, (CELL - (x + 0.5)) / CELL
            if d > 1.6 or along > 0.75:
                continue
            if strong and 2 <= v < 5 or not strong and v in (3, 4):
                out.putpixel((x, y), SHADES[v + 1] + (255,))
    return out


inner = Image.new("RGBA", (CELL * 4, CELL * 2), (0, 0, 0, 0))
for r, (notch, fold) in enumerate((("top", fold_top), ("right", fold_right))):
    f0, f1 = fold(straight(0)), fold(straight(1))
    for k, frame in enumerate((f0, crest(f0, notch, True), f1, crest(f1, notch, False))):
        inner.paste(frame, (k * CELL, r * CELL))
inner.save("images/shore-inner.png")
print("wrote images/shore-inner.png")
