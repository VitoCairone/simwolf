#!/usr/bin/env python3
"""Generate the carried deer leg overlays (placeholder art: see admin/design_notes.md): for
each wolf sheet a wolf can carry in (the land, stalk and swim sheets, grown and the
largest young stage), a sheet the same size with only a deer leg held crosswise in the
wolf's mouth, frame by frame, for the frames of the poses it can carry in (the run, the
idle, the swim). animat.js draws it over the wolf's frame (CARRYING).

The mouth is found in each frame from the wolf's own pixels (MOUTH), and the leg is held
across it, square to the wolf's heading on the ground; the half beyond the head is hidden
behind the wolf (drawn only where the wolf isn't), the near half drawn over it. Seen from
behind (row 4) all of it is behind the wolf.
TODO: real art for a wolf carrying a leg.

Usage (needs Python 3 with Pillow and numpy), after make_young_sheets.py and
make_stalk_sheets.py:

    python3 spritecraft/make_carried_leg.py            # write the overlay sheets
    python3 spritecraft/make_carried_leg.py --check c.png  # and a contact sheet to look at
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"
FW = FH = 64

# (source sheet, overlay sheet, columns of the poses a wolf can carry in, leg scale)
SHEETS = [
    ("wolf-land.png", "wolf-land-leg.png", list(range(12)), 1.0),       # run 0-7, idle 8-11
    ("wolf-stalk.png", "wolf-stalk-leg.png", list(range(8)), 1.0),
    ("wolf-swim.png", "wolf-swim-leg.png", list(range(8)), 1.0),
    ("young/wolf-land-stage4.png", "young/wolf-land-leg-stage4.png", list(range(12)), 0.8),
    ("young/wolf-stalk-stage4.png", "young/wolf-stalk-leg-stage4.png", list(range(8)), 0.8),
    ("young/wolf-swim-stage4.png", "young/wolf-swim-leg-stage4.png", list(range(8)), 0.8),
]
ROWS = 7

# Each sheet row's facing (animat.js spriteRowByDir): its grid heading, and its screen
# vector (u = x - y, v = (x + y) / 2): row 0 N, 1 E, 2 S, 3 W, 4 NW (from behind), 5 NE,
# 6 SE (from the front).
GRID = {0: (0, -1), 1: (1, 0), 2: (0, 1), 3: (-1, 0), 4: (-1, -1), 5: (1, -1), 6: (1, 1)}


def screen(gx, gy):
    return np.array([gx - gy, (gx + gy) / 2], dtype=float)


# The deer's own colours (images/deer-land.png, deer-carcass.png)
HOOF = (52, 28, 39)
FUR = (136, 75, 43)
FUR_DARK = (96, 44, 44)
MEAT = (207, 87, 60)
MEAT_DARK = (165, 48, 48)
BONE = (232, 193, 112)

# The leg along its length s (pixels, grown): from the hoof (beyond the head) to the torn
# top (near), each stretch its colour and half-thickness.
LEG = [  # (from s, to s, colour, shade, half-thickness)
    (-6.5, -5.0, HOOF, HOOF, 0.7),
    (-5.0, -0.5, FUR, FUR_DARK, 0.6),
    (-0.5, 4.5, MEAT, MEAT_DARK, 1.2),
    (4.5, 6.0, BONE, BONE, 0.9),
]


def mouth(alpha, row):
    """MOUTH: the mouth in a frame (pixel x, y), from its opaque pixels: seen side on, the
    nose is the farthest pixel the way the wolf faces on screen, above the bottom third
    (the paws), and the mouth just behind and below it; from the front, below the middle of
    the head's top (the top 40% of the body); from behind, just below the head's top."""
    ys, xs = np.nonzero(alpha >= 128)
    if len(xs) == 0:
        return None
    top, bottom = ys.min(), ys.max()
    head = ys <= top + 0.4 * (bottom - top)
    hx, hy = xs[head], ys[head]
    if row == 6:
        near = hy <= top + 4
        return np.array([hx[near].mean(), top + 9.0])
    if row == 4:
        near = hy <= top + 4
        return np.array([hx[near].mean(), top + 5.0])
    f = screen(*GRID[row])
    f /= np.linalg.norm(f)
    # (side on, the head may be low, lunging, and the tail high: the nose is the farthest
    # pixel forward above the paws, the bottom third)
    band = ys <= top + 0.65 * (bottom - top)
    hx, hy = xs[band], ys[band]
    score = hx * f[0] + hy * f[1] + 0.01 * hy
    k = int(np.argmax(score))
    nose = np.array([hx[k] + 0.5, hy[k] + 0.5])
    return nose - 2.0 * f + np.array([0.0, 1.5])


def draw_leg(frame_alpha, row, m, scale):
    """The overlay frame (RGBA) with the leg held at mouth m."""
    out = np.zeros((FH, FW, 4), dtype=np.uint8)
    gx, gy = GRID[row]
    u = screen(-gy, gx)  # square to the heading, on the ground
    u /= np.linalg.norm(u)
    if u[1] < 0 or (abs(u[1]) < 1e-9 and u[0] < 0):
        u = -u  # toward the viewer: s > 0 near, s < 0 beyond the head
    n = np.array([-u[1], u[0]])  # across the leg
    if n[1] < 0:
        n = -n  # its lower edge, for the shade
    for s0, s1, colour, dark, half in LEG:
        for s in np.arange(s0 * scale, s1 * scale, 0.2):
            for t in np.arange(-half * scale, half * scale + 1e-9, 0.2):
                x, y = m + u * s + n * t
                xi, yi = int(np.floor(x)), int(np.floor(y))
                if not (0 <= xi < FW and 0 <= yi < FH):
                    continue
                behind = row == 4 or s < 0
                if behind and frame_alpha[yi, xi] >= 128:
                    continue
                c = dark if t > 0.35 * half * scale else colour
                out[yi, xi] = (*c, 255)
    return out


def make(src, dst, cols, scale):
    sheet = np.asarray(Image.open(IMAGES / src).convert("RGBA"))
    out = np.zeros_like(sheet)
    mouths = {}
    for row in range(ROWS):
        for col in cols:
            fr = sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW]
            m = mouth(fr[..., 3], row)
            if m is None:
                continue
            mouths[(row, col)] = m
            out[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW] = draw_leg(fr[..., 3], row, m, scale)
    Image.fromarray(out, "RGBA").save(IMAGES / dst)
    print("wrote", (IMAGES / dst).relative_to(PROJECT))
    return sheet, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", help="also write a contact sheet of every frame with its leg, 3x")
    args = ap.parse_args()
    made = [(make(src, dst, cols, scale), cols) for src, dst, cols, scale in SHEETS]
    if args.check:
        tiles = []
        for (sheet, over), cols in made:
            for row in range(ROWS):
                for col in cols:
                    fr = Image.fromarray(sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW])
                    ov = Image.fromarray(over[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW])
                    bg = Image.new("RGBA", (FW, FH), (90, 140, 90, 255))
                    bg.alpha_composite(fr)
                    bg.alpha_composite(ov)
                    tiles.append(bg)
        per = 12
        rows = (len(tiles) + per - 1) // per
        out = Image.new("RGBA", (per * FW * 3, rows * FH * 3), (60, 60, 60, 255))
        for k, t in enumerate(tiles):
            out.paste(t.resize((FW * 3, FH * 3), Image.NEAREST), ((k % per) * FW * 3, (k // per) * FH * 3))
        out.save(args.check)
        print("wrote", args.check)


if __name__ == "__main__":
    main()
