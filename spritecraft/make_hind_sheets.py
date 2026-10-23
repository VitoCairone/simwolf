#!/usr/bin/env python3
"""The deer sheets without antlers, for hinds and young stags: each antlered sheet's
antlers removed, frame by frame.

    images/deer-land.png     -> images/hind-land.png
    images/stag-death.png    -> images/hind-death.png
    images/deer-carcass.png  -> images/hind-carcass.png

The swimming sheet, images/hind-swim.png, is made from hind-land.png's run frames as the
stag's is (make_swim_sheets.py): above the water, a swimming stag is mostly antler.

Usage (needs Python 3 with Pillow and numpy):

    python3 spritecraft/make_hind_sheets.py
    python3 spritecraft/make_hind_sheets.py --out-dir /tmp

ANTLERS are drawn in three colours (ANTLER), which the body also uses here and there (an
eye, a hoof's edge): an antler is a connected patch of them (8-connected) of at least
MIN_ANTLER_PX pixels, small patches are kept. Removing an antler leaves the background where
it was, but where it covered the head or body (a pixel with at least 3 of its 4 neighbours
still drawn), the hole is filled with its neighbours' commonest colour, repeatedly until
none is left.
TODO: drawn hinds (a hind's head and ears differ from a stag's beyond its antlers).
"""
import argparse
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

ANTLER = [(96, 44, 44), (52, 28, 39), (136, 75, 43)]
MIN_ANTLER_PX = 6
# antlered sheet -> (antlerless sheet, frame width, frame height)
SHEETS = {
    "deer-land.png": ("hind-land.png", 32, 41),
    "stag-death.png": ("hind-death.png", 48, 48),
    "deer-carcass.png": ("hind-carcass.png", 48, 48),
}


def components(mask):
    """8-connected regions of mask: a list of (ys, xs) arrays."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            stack, ys, xs = [(y0, x0)], [], []
            seen[y0, x0] = True
            while stack:
                y, x = stack.pop()
                ys.append(y)
                xs.append(x)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            out.append((np.array(ys), np.array(xs)))
    return out


def dehorn(frame):
    f = frame.copy()
    h, w = f.shape[:2]
    opaque = f[:, :, 3] == 255
    colour = np.zeros((h, w), bool)
    for c in ANTLER:
        colour |= (f[:, :, :3] == c).all(axis=2)
    colour &= opaque
    removed = np.zeros((h, w), bool)
    for ys, xs in components(colour):
        if len(ys) >= MIN_ANTLER_PX:
            removed[ys, xs] = True
    f[removed] = 0
    # fill holes in the head and body
    drawn = (f[:, :, 3] > 0) & ~removed
    for _ in range(4):
        filled = []
        for y, x in zip(*np.nonzero(removed & ~drawn)):
            near = [(y + dy, x + dx) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))
                    if 0 <= y + dy < h and 0 <= x + dx < w and drawn[y + dy, x + dx]]
            if len(near) >= 3:
                filled.append((y, x, Counter(tuple(f[p]) for p in near).most_common(1)[0][0]))
        if not filled:
            break
        for y, x, c in filled:
            f[y, x] = c
            drawn[y, x] = True
    return f


def make(src, fw, fh):
    img = np.array(Image.open(src).convert("RGBA"))
    out = img.copy()
    for y in range(0, img.shape[0], fh):
        for x in range(0, img.shape[1], fw):
            out[y:y + fh, x:x + fw] = dehorn(img[y:y + fh, x:x + fw])
    return Image.fromarray(out, "RGBA")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", type=Path, default=IMAGES)
    args = ap.parse_args()
    for src, (dst, fw, fh) in SHEETS.items():
        make(IMAGES / src, fw, fh).save(args.out_dir / dst)
        print("wrote", args.out_dir / dst)


if __name__ == "__main__":
    main()
