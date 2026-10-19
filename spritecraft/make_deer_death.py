#!/usr/bin/env python3
"""The deer's death animation, hand-drawn, and the script that renders it.

    images/stag-walk-idle-run.png  ->  images/stag-death.png

Usage (from anywhere; needs Python 3 with Pillow):

    python3 spritecraft/make_deer_death.py                 # regenerate images/stag-death.png
    python3 spritecraft/make_deer_death.py --out-dir /tmp  # write somewhere else to compare
    python3 spritecraft/make_deer_death.py --preview p.png # also save an enlarged preview

The frames are drawn here as text: one character per pixel, in the deer's own palette
(PALETTE below; '.' is transparent). Each frame is put together from PARTS: some drawn
here (the body lying down, the head laid on the ground, bent and outstretched legs,
shadows), some cut from the deer's standing frame in the land sheet (its antlers, head,
hindquarters, legs), so the dying deer stays the same animal. Edit a part's pixels,
or where it is placed in a frame, and run the script again.

THE SHEET: 5 frames of 48 x 48, two rows, one per drawn facing:
    row 0  facing N (up-right on screen)       row 1  facing E (down-right on screen)
The other two diagonals are these mirrored: S = E mirrored, W = N mirrored (animat.js).
Frames are drawn on a 48 x 40 canvas (the frame's bottom 40 rows); the ground point (the
critter's position) is at (24, 32) on it, (24, 40) in the frame: centered, so mirroring
keeps it in place.

THE FRAMES (the last one is also the corpse, held forever as the "dead" pose):
    0  hit: the legs give a little, the head sags
    1  the front legs buckle, the chest drops, the rear still up
    2  down on its chest, legs tucked, head drooping
    3  settling onto its side, legs sliding out, head going down
    4  dead, on its side: legs out stiff, head laid on the ground
"""

import argparse
from pathlib import Path

from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

FRAME_W, FRAME_H = 48, 48
CANVAS_H = 40                  # drawing canvas: the frame's bottom 40 rows
CANVAS_TOP = FRAME_H - CANVAS_H
SRC_W, SRC_H = 32, 41          # land sheet frame size
STAND_COL = 11                 # its first idle frame: standing still
SRC_OFFSET = (8, -1)           # standing frame -> canvas (puts its ground point at (24, 32))

# The deer's palette (from the land sheet). s/z: the ground shadow.
PALETTE = {
    "O": (207, 87, 60),    # body
    "R": (165, 48, 48),    # body, shaded
    "m": (117, 36, 56),    # body, deep shade
    "Y": (218, 134, 62),   # body, lit
    "c": (232, 193, 112),  # cream: throat, belly, muzzle, tail
    "b": (136, 75, 43),    # antler
    "d": (96, 44, 44),     # antler, dark; legs
    "n": (77, 43, 50),     # hoof
    "k": (52, 28, 39),     # darkest: antler tips, hooves, nose
    "K": (36, 21, 39),
    "s": (21, 29, 40),     # shadow
    "z": (16, 20, 31),     # shadow, darkest; eye
}


def P(s):
    """A part: a multi-line string of pixels (leading/trailing blank lines dropped)."""
    return [l for l in s.strip("\n").split("\n")]


def compose(parts, W=FRAME_W, H=CANVAS_H):
    """A canvas from [(part, (x, y)), ...]; later parts drawn over earlier ones."""
    g = [["."] * W for _ in range(H)]
    for lines, (ox, oy) in parts:
        for y, l in enumerate(lines):
            for x, ch in enumerate(l):
                if ch != "." and 0 <= oy + y < H and 0 <= ox + x < W:
                    g[oy + y][ox + x] = ch
    return ["".join(r) for r in g]


def cut(grid, x0, y0, x1, y1):
    """The region [x0, x1) x [y0, y1) of a canvas, as a part."""
    return [l[x0:x1] for l in grid[y0:y1]]


def standing(sheet, land_row):
    """The standing frame of the land sheet's row, as text on the canvas."""
    def ch(p):
        if p[3] == 0:
            return "."
        for k, v in PALETTE.items():
            if v == p[:3]:
                return k
        if p[0] < 32 and p[2] > p[0]:
            return "s"                 # the shadow's other near-identical shades
        raise ValueError(f"colour {p} not in the palette")
    g = [["."] * FRAME_W for _ in range(CANVAS_H)]
    for y in range(SRC_H):
        for x in range(SRC_W):
            c = ch(sheet.getpixel((STAND_COL * SRC_W + x, land_row * SRC_H + y)))
            cy, cx = y + SRC_OFFSET[1], x + SRC_OFFSET[0]
            if c != "." and 0 <= cy < CANVAS_H and 0 <= cx < FRAME_W:
                g[cy][cx] = c
    return ["".join(r) for r in g]


# FACING E (down-right): head on the right, rump on the left
def facing_e(STAND):
    # --- parts cut from the standing deer (facing E) ---
    RACK = cut(STAND, 19, 4, 37, 15)          # antlers
    HEAD_UP = cut(STAND, 24, 13, 36, 22)      # head and throat, standing
    REAR = cut(STAND, 9, 15, 21, 29)          # rump and hindquarters (no legs)
    FRONT = cut(STAND, 21, 15, 34, 29)        # chest and shoulders (no legs)
    HIND_LEGS = cut(STAND, 13, 28, 21, 37)    # rear legs + their shadow
    SHADOW_STAND = [''.join(c if c in 'sz' else '.' for c in l) for l in STAND]

    # --- hand-drawn parts ---
    BODY_LYING = P("""
......YYYYYYY......
....YYOOOOOOOYYY...
...YOOOOOOOOOOOOYY.
..YOOOOOOOOOOOOOOOY
.ROOOOOOOOOOOOOOOOO
ROOOOOOOOOOOOOOOOOO
ROOOOOOOOOOOOOOOOOO
ROOOOOOOOOOOOOOOOOR
.RROOOOOOOOOOOOORRm
..mRRccccccccRRRm..
....mmmmRRRmmmm....
""")
    TAIL = P("""
.c
Yc
Y.
""")
    HEAD_DOWN = P("""
YYOO.........
OOOOOY.......
OOOOOOYY.....
.ROOOOOOYYO..
..RROOOOYYYcc
...mRROOOYzccc
.....mmRRccccck
.......mmmRRcc.
""")
    HEAD_DROOP = P("""
YYO.......
OOOOY.....
OOOOOYY...
.ROOOOOYO.
..RROOOOYY
...mRROOYz
....mRROcc
.....mmRccc
.......mRck
........mc.
""")
    EAR = P("""
.YY
YOO
""")
    FRONT_LEGS_BENT = P("""
....OOORm.
....RROm..
...RRm....
..RRm.....
..Rm......
.kk.......
""")
    TUCKED = P("""
.mR....mR..
km....km...
""")
    LEG_NEAR = P("""
...RO
..RR.
..Rm.
.RR..
.Rm..
kk...
""")
    LEG_HALF = P("""
..RO
.RR.
.Rm.
kk..
""")
    LEG_FAR = P("""
..m
..m
.m.
.m.
n..
""")
    LEG_FAR_HALF = P("""
.m
m.
n.
""")
    SHADOW_LYING = P("""
.........sssssssssssssssssss
......sssssssssssssssssssss.
....ssssss......sssssss.....
""")
    SHADOW_KNEEL = P("""
.......ssssssssssssssssss
....sssssssssssssssssss..
.....ssssssssssss........
""")

    def stand_sagging(dy_body, dy_head):
        """Standing deer with the body sunk dy_body px (legs a little shorter) and the
        head sagging dy_head px further."""
        legs = cut(STAND, 0, 28 + dy_body, 48, 37)
        upper = cut(STAND, 0, 0, 48, 28)
        head = [l[24:37] for l in STAND[4:22]]
        upper_nohead = [l[:24] + '.' * 24 for l in upper[:22]] + upper[22:]
        return compose([(SHADOW_STAND, (0, 0)),
                        (legs, (0, 28 + dy_body)),
                        (upper_nohead, (0, dy_body)),
                        (cut(STAND, 19, 4, 24, 15), (19, 4 + dy_body + dy_head)),
                        (head, (24, 4 + dy_body + dy_head))])

    F0 = stand_sagging(1, 1)                     # hit: legs give a little, head sags
    F1 = compose([                               # buckle: front legs fold, chest drops
        (SHADOW_KNEEL, (12, 32)),
        (HIND_LEGS, (13, 28)),
        (REAR, (9, 16)),
        (FRONT, (21, 19)),
        (FRONT_LEGS_BENT, (17, 30)),
        (RACK, (21, 10)),
        (HEAD_UP, (25, 19)),
    ])
    F2 = compose([                               # down on its chest, head drooping
        (SHADOW_KNEEL, (12, 31)),
        (BODY_LYING, (10, 20)),
        (TAIL, (8, 21)),
        (TUCKED, (14, 30)),
        (RACK, (25, 11)),
        (HEAD_DROOP, (28, 20)),
        (EAR, (33, 20)),
    ])
    F3 = compose([                               # settling onto its side
        (SHADOW_LYING, (11, 31)),
        (LEG_FAR_HALF, (18, 30)), (LEG_FAR_HALF, (29, 30)),
        (BODY_LYING, (10, 20)),
        (TAIL, (8, 22)),
        (RACK, (26, 12)),
        (HEAD_DOWN, (28, 22)),
        (EAR, (33, 22)),
        (LEG_HALF, (13, 29)), (LEG_HALF, (24, 30)),
    ])
    F4 = compose([                               # dead, on its side
        (SHADOW_LYING, (11, 31)),
        (LEG_FAR, (17, 30)), (LEG_FAR, (28, 30)),
        (BODY_LYING, (10, 20)),
        (TAIL, (8, 22)),
        (RACK, (26, 13)),
        (HEAD_DOWN, (28, 22)),
        (EAR, (33, 22)),
        (LEG_NEAR, (12, 29)), (LEG_NEAR, (23, 30)),
    ])
    return [F0, F1, F2, F3, F4]


# FACING N (up-right): seen more from behind, head up and to the right
def facing_n(STAND):
    RACK = cut(STAND, 19, 3, 36, 12)          # antlers
    HEAD_UP = cut(STAND, 22, 12, 33, 20)      # head and neck, standing
    REAR = cut(STAND, 9, 19, 23, 32)          # rump and hindquarters, with hind legs' tops
    FRONT = cut(STAND, 22, 15, 31, 28)        # chest and shoulders
    HIND_LEGS = cut(STAND, 13, 27, 23, 37)
    SHADOW_STAND = [''.join(c if c in 'sz' else '.' for c in l) for l in STAND]

    BODY_LYING = P("""
...........YYYY....
........YYYOOOOYY..
......YYOOOOOOOOOY.
....YYOOOOOOOOOOOOR
...YOOOOOOOOOOOOOOR
..YOOOOOOOOOOOOOORc
.ROOOOOOOOOOOOORRcc
ROOOOOOOOOOOORRccm.
ROOOOOOOOOORRccm...
.RRmRRRRRmmmmm.....
...mmmmm...........
""")
    TAIL = P("""
c.
cY
.Y
""")
    HEAD_DOWN = P("""
.........YYc.
......YYOOOcz
....YYOOOOORc
..YYOOOOORRm.
.YOOOOORRm...
YOOORRmm.....
ORRmm........
""")
    HEAD_DROOP = P("""
.....YO..
...YYOOc.
..YOOOORz
.YOOORRcc
YOOORRm..
ORRm.....
Rm.......
""")
    FRONT_LEGS_BENT = P("""
..RRm..
...Rmm.
....Rm.
...mR..
..kk...
""")
    TUCKED = P("""
..Rm......Rm
...mk......k
""")
    LEG_NEAR = P("""
OR....
.RR...
..Rm..
...RR.
....kk
""")
    LEG_HALF = P("""
OR..
.RR.
..kk
""")
    LEG_FAR = P("""
m...
.m..
..m.
...n
""")
    LEG_FAR_HALF = P("""
m..
.m.
..n
""")
    SHADOW_LYING = P("""
...........sssssssss.
.......ssssssssssssssss
..sssssssssssssssssss..
...ssssssssssss........
""")
    SHADOW_KNEEL = P("""
..........ssssssss
.....sssssssssssss
..sssssssssssss...
...sssssssss......
""")

    def stand_sagging(dy_body, dy_head):
        """As for facing E."""
        legs = cut(STAND, 0, 27 + dy_body, 48, 37)
        upper = cut(STAND, 0, 0, 48, 27)
        head = [l[22:36] for l in STAND[3:20]]
        upper_nohead = [l[:22] + '.' * 26 for l in upper[:20]] + upper[20:]
        return compose([(SHADOW_STAND, (0, 0)),
                        (legs, (0, 27 + dy_body)),
                        (upper_nohead, (0, dy_body)),
                        (cut(STAND, 19, 3, 22, 12), (19, 3 + dy_body + dy_head)),
                        (head, (22, 3 + dy_body + dy_head))])

    F0 = stand_sagging(1, 1)                     # hit: legs give a little, head sags
    F1 = compose([                               # buckle: front legs fold, chest drops
        (SHADOW_KNEEL, (12, 30)),
        (HIND_LEGS, (13, 27)),
        (REAR, (9, 19)),
        (FRONT, (22, 18)),
        (FRONT_LEGS_BENT, (21, 29)),
        (RACK, (20, 8)),
        (HEAD_UP, (23, 17)),
    ])
    F2 = compose([                               # down on its chest, head drooping
        (SHADOW_KNEEL, (14, 28)),
        (BODY_LYING, (10, 20)),
        (TAIL, (8, 26)),
        (TUCKED, (16, 30)),
        (RACK, (21, 7)),
        (HEAD_DROOP, (25, 16)),
    ])
    F3 = compose([                               # settling onto its side
        (SHADOW_LYING, (11, 28)),
        (LEG_FAR_HALF, (23, 29)), (LEG_FAR_HALF, (15, 31)),
        (BODY_LYING, (10, 20)),
        (TAIL, (8, 26)),
        (RACK, (23, 7)),
        (HEAD_DOWN, (24, 15)),
        (LEG_HALF, (20, 29)), (LEG_HALF, (12, 31)),
    ])
    F4 = compose([                               # dead, on its side
        (SHADOW_LYING, (11, 28)),
        (LEG_FAR, (24, 28)), (LEG_FAR, (16, 30)),
        (BODY_LYING, (10, 20)),
        (TAIL, (8, 26)),
        (RACK, (24, 8)),
        (HEAD_DOWN, (25, 16)),
        (LEG_NEAR, (21, 28)), (LEG_NEAR, (13, 30)),
    ])
    return [F0, F1, F2, F3, F4]


def render(frames_by_row):
    sheet = Image.new("RGBA", (FRAME_W * len(frames_by_row[0]), FRAME_H * len(frames_by_row)), (0, 0, 0, 0))
    for row, frames in enumerate(frames_by_row):
        for k, canvas in enumerate(frames):
            for y, l in enumerate(canvas):
                for x, ch in enumerate(l):
                    if ch == ".":
                        continue
                    if ch not in PALETTE:
                        raise ValueError(f"row {row} frame {k}: unknown pixel {ch!r} at {x},{y}")
                    sheet.putpixel((k * FRAME_W + x, row * FRAME_H + CANVAS_TOP + y), PALETTE[ch] + (255,))
    return sheet


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=IMAGES / "stag-walk-idle-run.png")
    ap.add_argument("--out-dir", type=Path, default=IMAGES)
    ap.add_argument("--preview", type=Path, help="also save an enlarged preview here")
    args = ap.parse_args()
    src = Image.open(args.src).convert("RGBA")
    sheet = render([facing_n(standing(src, 0)), facing_e(standing(src, 1))])
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / "stag-death.png"
    sheet.save(out)
    print(f"wrote {out}  ({sheet.width}x{sheet.height}: 5 frames of {FRAME_W}x{FRAME_H}, rows facing N and E)")
    if args.preview:
        bg = Image.new("RGBA", sheet.size, (120, 170, 80, 255))
        bg.alpha_composite(sheet)
        bg.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST).save(args.preview)


if __name__ == "__main__":
    main()
