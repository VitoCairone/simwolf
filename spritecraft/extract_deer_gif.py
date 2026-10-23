#!/usr/bin/env python3
"""The deer's land sprites and their timing, taken from the artist's animated preview.

    images_raw/OvN65m.gif  ->  images/deer-land.png

Usage (from anywhere; needs Python 3 with Pillow and numpy):

    python3 spritecraft/extract_deer_gif.py            # write images/deer-land.png, print the timing
    python3 spritecraft/extract_deer_gif.py --out-dir /tmp

THE GIF: 64 frames at 3x scale, showing one stag in each of the 4 diagonal facings at
once (top left facing up-left, top right up-right, bottom left down-left, bottom right
down-right), on a flat background, with a caption below. Each frame lasts 100 ms, but for
three of 500 ms. In order:
    frames  0-20  "walk": the walk cycle twice (10 frames), then a frame to start running
    frames 21-39  "run":  the run cycle twice (9 frames), then a frame to stop
    frames 40-63  "idle": standing, looking about (one 500 ms pause), turning the head
                          (another), and lowering the head to graze (the third): 24 frames
Facing left (up-left, down-left), the idle frames are the right-facing ones mirrored.
Every drawn stag is a frame of our sheet; this takes each from the GIF exactly as drawn:
the stag's pixels as they are, and its soft shadow (blended into the background in the
GIF) as the shadow colour with the alpha the blend shows.

THE SHEET: 32 x 41 frames, as images/stag-walk-idle-run.png and in its columns: rows 0
facing up-right, 1 down-right, 2 down-left, 3 up-left; columns 0-9 the walk cycle, 10 the
start of a run, 11-34 the idle sequence, 35-43 the run cycle, 44 the stop. (animat.js
frameDataBySpeciesAndPose: the deer's frames and their timing, from TIMING below.)
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

PROJECT = Path(__file__).resolve().parent.parent
SCALE = 3
FW, FH = 32, 41
# Each facing's frame in the GIF (at 1x): its sheet row, and where the frame's top left is.
QUADRANTS = {  # name: (sheet row, x, y)
    "top right": (0, 78, 4),
    "bottom right": (1, 81, 36),
    "bottom left": (2, 33, 37),
    "top left": (3, 35, 4),
}
# GIF frame -> sheet column
COLUMN_OF_FRAME = {**{k: k for k in range(10)}, **{10 + k: k for k in range(10)}, 20: 10,
                   **{21 + k: 35 + k for k in range(9)}, **{30 + k: 35 + k for k in range(9)}, 39: 44,
                   **{40 + k: 11 + k for k in range(24)}}
SHADOW = np.array([21, 29, 40])      # the shadow's colour (blended at up to ~80%)
HOOF = (231, 213, 179)               # a hoof's glint (and dust kicked up), not in our old sheet
CAPTION_FROM_Y = 75                  # (1x) the caption is below this

# The cycles as the GIF plays them: sheet columns and how long each is shown (ms).
TIMING = {
    "walk": ([*range(0, 10)], [100] * 10),
    "run": ([*range(35, 44)], [100] * 9),
    "idle": ([*range(11, 35)], [500 if c in (19, 26, 33) else 100 for c in range(11, 35)]),
}


def load_frames(path):
    gif = Image.open(path)
    frames, ms = [], []
    for f in ImageSequence.Iterator(gif):
        frames.append(np.array(f.convert("RGB")).astype(int)[::SCALE, ::SCALE])
        ms.append(f.info["duration"])
    return frames, ms


def components(mask, diagonal):
    """Label connected regions of mask (8-connected if diagonal, else 4): (labels, count)."""
    H, W = mask.shape
    steps = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
             if (dy or dx) and (diagonal or not (dy and dx))]
    lab = np.zeros((H, W), int)
    n = 0
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not lab[y, x]:
                n += 1
                stack = [(y, x)]
                lab[y, x] = n
                while stack:
                    cy, cx = stack.pop()
                    for dy, dx in steps:
                        yy, xx = cy + dy, cx + dx
                        if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((yy, xx))
    return lab, n


def inside(q, y, x):
    _, x0, y0 = QUADRANTS[q]
    return 0 <= y - y0 < FH and 0 <= x - x0 < FW


def extract(frame, bg, palette):
    """{row: 41 x 32 RGBA frame} for one GIF frame; and the count of the stag's pixels
    that fell outside its frame (should be 0).
    Neighbouring frames overlap a little (a top stag's hooves and shadow, the antler tips
    of the stag below), so: each solid piece (4-connected) belongs to the stag whose frame
    holds all of it; where two frames do, a hoof's glint belongs to the upper stag (at its
    feet), anything else to the stag whose frame centre is nearest; shadow belongs to the
    stag whose frame holds it lowest down (a shadow is at a stag's feet)."""
    mask = (frame != bg).any(2)
    mask[CAPTION_FROM_Y:] = False
    solid = mask & np.array([[tuple(p) in palette for p in r] for r in frame])
    lab, n = components(solid, diagonal=False)
    centres = {q: (x + FW / 2, y + FH / 2) for q, (_, x, y) in QUADRANTS.items()}
    owner = np.full(mask.shape, None, object)
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        holds = [q for q in QUADRANTS if all(inside(q, y, x) for y, x in zip(ys, xs))]
        if len(holds) > 1 and any(tuple(frame[y, x]) == HOOF for y, x in zip(ys, xs)):
            # a hoof's glint, where two frames overlap: the upper stag's, at its feet
            owner[ys, xs] = max(holds, key=lambda q: ys.mean() - QUADRANTS[q][2])
            continue
        cx, cy = xs.mean(), ys.mean()
        near = lambda q: (centres[q][0] - cx) ** 2 + (centres[q][1] - cy) ** 2
        owner[ys, xs] = min(holds or QUADRANTS, key=near)
    for y, x in zip(*np.nonzero(mask & ~solid)):
        holds = [q for q in QUADRANTS if inside(q, y, x)]
        if holds:
            owner[y, x] = max(holds, key=lambda q: y - QUADRANTS[q][2])
    out, lost = {}, 0
    for q, (row, x0, y0) in QUADRANTS.items():
        img = np.zeros((FH, FW, 4), np.uint8)
        for y, x in zip(*np.nonzero(owner == q)):
            fy, fx = y - y0, x - x0
            if not (0 <= fy < FH and 0 <= fx < FW):
                lost += 1
                continue
            p = frame[y, x]
            if solid[y, x]:
                img[fy, fx] = (*p, 255)
            else:  # the shadow, blended into the background
                a = float(np.mean((bg - p) / (bg - SHADOW)))
                back = bg * (1 - a) + SHADOW * a
                if np.abs(back - p).max() > 3:
                    raise ValueError(f"pixel {tuple(p)} at ({x}, {y}) is neither the stag nor its shadow")
                img[fy, fx] = (*SHADOW, round(255 * a))
        out[row] = img
    # shadow outside every frame
    lost += int(sum(1 for y, x in zip(*np.nonzero(mask & ~solid)) if owner[y, x] is None))
    return out, lost


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gif", type=Path, default=PROJECT / "images_raw" / "OvN65m.gif")
    ap.add_argument("--old-sheet", type=Path, default=PROJECT / "images" / "stag-walk-idle-run.png")
    ap.add_argument("--out-dir", type=Path, default=PROJECT / "images")
    args = ap.parse_args()
    frames, ms = load_frames(args.gif)
    bg = frames[0][0, 0]
    # the stag's colours: those of the old sheet, and a hoof's glint
    old = np.array(Image.open(args.old_sheet).convert("RGBA"))
    palette = {tuple(int(c) for c in p[:3]) for p in old.reshape(-1, 4) if p[3] == 255}
    palette -= {tuple(SHADOW)}
    palette.add(HOOF)

    sheet = np.zeros((FH * 4, FW * 45, 4), np.uint8)
    seen = {}
    for k, f in enumerate(frames):
        imgs, lost = extract(f, bg, palette)
        if lost:
            raise ValueError(f"frame {k}: {lost} of a stag's pixels outside its frame")
        col = COLUMN_OF_FRAME[k]
        for row, img in imgs.items():
            if (row, col) in seen:  # a cycle's second time: the same drawing (the GIF's
                # palette may round a shadow's blend by a step or so)
                if np.abs(seen[(row, col)].astype(int) - img.astype(int)).max() > 3:
                    raise ValueError(f"frame {k}: row {row} column {col} differs the second time")
                continue
            seen[(row, col)] = img
            sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW] = img
    assert len(seen) == 4 * 45, len(seen)
    for name, (cols, durs) in TIMING.items():
        gif_ms = [ms[k] for k in sorted(COLUMN_OF_FRAME) if COLUMN_OF_FRAME[k] in cols][:len(cols)]
        assert gif_ms == durs, (name, gif_ms, durs)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / "deer-land.png"
    Image.fromarray(sheet).save(out)
    print(f"wrote {out}  ({sheet.shape[1]}x{sheet.shape[0]})")
    for name, (cols, durs) in TIMING.items():
        print(f"  {name}: columns {cols[0]}-{cols[-1]}, ms {durs}")


if __name__ == "__main__":
    main()
