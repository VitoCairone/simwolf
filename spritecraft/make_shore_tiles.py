"""Shore sprites made from tiles.png's straight shore sprites (see SHORES in animat.js), so
that every shore tile joins its neighbours seamlessly: outer corners and interior corners.

tiles.png row 9, columns 0-1 are the straight shore sprites: water with land along ONE
edge, the light along its top-right edge (as drawn), a band of wave fronts parallel to it;
the two columns are the animation's frames. (Its columns 2-5, the artist's corner
sprites, aren't used: they don't match the straight ones.)

GRID COORDINATES in a 32 x 32 water cell: the diamond's corners T (top) = (0, 0),
R (right) = (1, 0), B (bottom) = (1, 1), L (left) = (0, 1); a pixel's (u, v) from its
center (uv, px below). In the straight sprite v is how far a point is from the land edge
(T-R) and u how far along it.

Run from the project root:  python3 spritecraft/make_shore_tiles.py
"""
import math
from PIL import Image

CELL = 32
ROW = 9
CX, CY = 16, 24  # the water diamond's center in its cell (pixel corners)

sheet = Image.open("images/tiles.png").convert("RGBA")
water = sheet.crop((192, ROW * CELL, 224, (ROW + 1) * CELL))  # plain water


def straight(col):
    return sheet.crop((col * CELL, ROW * CELL, (col + 1) * CELL, (ROW + 1) * CELL))


def uv(x, y):
    """Pixel (x, y)'s center in grid coordinates."""
    a, b = (x + 0.5 - CX) / 16, (y + 0.5 - 16) / 8
    return (a + b) / 2, (b - a) / 2


def sample(src, u, v):
    """src's pixel at grid point (u, v): the nearest pixel inside the diamond."""
    x, y = 16 + 16 * (u - v) - 0.5, 16 + 8 * (u + v) - 0.5
    ix, iy = int(round(x)), int(round(y))
    best = None
    for ny in range(iy - 2, iy + 3):
        for nx in range(ix - 2, ix + 3):
            if 0 <= nx < CELL and 0 <= ny < CELL and src.getpixel((nx, ny))[3]:
                d = (nx - x) ** 2 + (ny - y) ** 2
                if best is None or d < best[0]:
                    best = (d, src.getpixel((nx, ny)))
    return best[1]


# OUTER CORNERS (water with land only beyond one corner, as off a rectangle's corner): the
# wave fronts run round that corner in arcs. Each pixel shows the straight sprite at the
# same distance from the land: r, its distance from the corner (in the grid), as the
# straight sprite's v. So where the corner tile meets the straight tiles on either side
# (along its two edges at that corner, each the side of a straight tile whose land edge
# ends at the same corner), a point r from the corner shows what the straight tile shows r
# from its land edge: the arcs carry the straight fronts round without a seam. Along the
# arc, the straight sprite's u: at the two edges the end of the straight sprite those
# neighbours show there (u = 1 for a corner at T, u = 0 at R), and toward the arc's middle
# up to SPREAD further in (1 - |cos 2 angle|), the two halves mirroring each other. Beyond
# r = 1, open water.
#
#   images/shore-outer.png   two rows of two 32 x 32 frames (the straight sprite's two):
#     row 0: land beyond the TOP corner
#     row 1: land beyond the RIGHT corner
#   (Land beyond the bottom and left corners: these mirrored, by the game.)
SPREAD = 0.25


def outer(src, corner):
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    vu, vv, end = (0, 0, 1) if corner == "T" else (1, 0, 0)
    for y in range(CELL):
        for x in range(CELL):
            if not water.getpixel((x, y))[3]:
                continue  # outside the diamond
            u, v = uv(x, y)
            du, dv = abs(u - vu), abs(v - vv)
            r = math.hypot(du, dv)
            if r >= 1:
                out.putpixel((x, y), water.getpixel((x, y)))
                continue
            off = SPREAD * (1 - abs(math.cos(2 * math.atan2(dv, du))))
            along = end - off if end == 1 else end + off
            out.putpixel((x, y), sample(src, min(max(along, 0.001), 0.999), r))
    return out


outers = Image.new("RGBA", (CELL * 2, CELL * 2), (0, 0, 0, 0))
for r, corner in enumerate("TR"):
    for k in (0, 1):
        outers.paste(outer(straight(k), corner), (k * CELL, r * CELL))
outers.save("images/shore-outer.png")
print("wrote images/shore-outer.png")


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
# Four frames: the straight tiles on either side show straight frame 0 for the loop's
# first two steps and frame 1 for the next two, so frames 0 and 2 are the folds of those; frames 1 and 3 add the crest where the two
# wave fronts meet along the bisector (one shade lighter there): strong as the swell comes
# in (1), faint as it ebbs (3).
SHADES = [(21, 29, 40), (23, 32, 56), (32, 46, 55), (37, 58, 94), (60, 94, 139), (79, 143, 186)]
SHADE = {c: k for k, c in enumerate(SHADES)}


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
