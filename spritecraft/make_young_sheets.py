#!/usr/bin/env python3
"""Generate the young critters' sprite sheets: each critter sheet scaled down, frame by
frame, about the frame's ground point, into images/young/<sheet>-stage<k>.png.

Stages 1-4 are drawn at YOUNG_SCALES of the adult's size; stage 5 is the adult sheet
itself. Each frame keeps its size and ground point, so the game draws a young critter
exactly as an adult (same frameW, frameH, topToShadow) from a different image.
sim.js (SIZES) picks the stage from the critter's weight; keep its youngScales in step
with YOUNG_SCALES.
TODO: draw real pups and calves (proportions change with age, not just size).

Usage (needs Python 3 with Pillow and numpy):

    python3 spritecraft/make_young_sheets.py              # write images/young/
    python3 spritecraft/make_young_sheets.py --out-dir /tmp

Also writes images/heart.png, the icon rising between a mating pair.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

YOUNG_SCALES = [0.3, 0.45, 0.6, 0.8]  # stages 1-4

# sheet: (frame width, frame height, anchor x, anchor y). The anchor is the ground point
# (x, topToShadow in animat.js); for swim sheets, the waterline 8 px below it, so a young
# swimmer still floats on the water surface. Young deer have no antlers: theirs are the
# hinds' sheets shrunk (see make_hind_sheets.py).
SHEETS = {
    "wolf-land.png": (64, 64, 32, 39),
    "wolf-swim.png": (64, 64, 32, 47),
    "hind-land.png": (32, 41, 16, 33),
    "hind-swim.png": (40, 48, 20, 41),
    "hind-death.png": (48, 48, 24, 40),
    "hind-carcass.png": (48, 48, 24, 40),
}


def scale_frame(frame, s, ax, ay, alpha_levels):
    """frame (h, w, 4 uint8) shrunk by s about (ax, ay), in a frame of the same size."""
    h, w = frame.shape[:2]
    # premultiply, so transparent pixels' colors don't bleed into the edges
    f = frame.astype(np.float64)
    a = f[:, :, 3:4] / 255
    pre = np.concatenate([f[:, :, :3] * a, f[:, :, 3:4]], axis=2)
    sw, sh = max(1, round(w * s)), max(1, round(h * s))
    small = np.stack([np.array(Image.fromarray(pre[:, :, c].astype(np.float32), "F")
                               .resize((sw, sh), Image.BOX)) for c in range(4)], axis=2)
    out = np.zeros((h, w, 4), np.float64)
    ox, oy = round(ax - ax * sw / w), round(ay - ay * sh / h)
    x0, y0 = max(0, ox), max(0, oy)
    x1, y1 = min(w, ox + sw), min(h, oy + sh)
    out[y0:y1, x0:x1] = small[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    alpha = out[:, :, 3]
    rgb = np.where(alpha[:, :, None] > 0, out[:, :, :3] / np.maximum(alpha, 1e-9)[:, :, None] * 255, 0)
    if alpha_levels is not None:
        # a sheet with a few alpha levels (crisp pixel art) keeps them: snap to the nearest
        levels = np.array(alpha_levels, np.float64)
        alpha = levels[np.abs(alpha[:, :, None] - levels[None, None, :]).argmin(axis=2)]
    res = np.concatenate([np.clip(rgb, 0, 255), alpha[:, :, None]], axis=2)
    res[alpha == 0] = 0
    return np.rint(res).astype(np.uint8)


def make_sheet(src, spec, s):
    fw, fh, ax, ay = spec
    img = np.array(Image.open(src).convert("RGBA"))
    levels = np.unique(img[:, :, 3])
    alpha_levels = levels.tolist() if len(levels) <= 3 else None
    out = np.zeros_like(img)
    for y in range(0, img.shape[0], fh):
        for x in range(0, img.shape[1], fw):
            out[y:y + fh, x:x + fw] = scale_frame(img[y:y + fh, x:x + fw], s, ax, ay, alpha_levels)
    return Image.fromarray(out, "RGBA")


# 11 x 10, pink with a darker rim and a highlight
HEART = [
    "..RR...RR..",
    ".RPPR.RPPR.",
    "RPHPPRPPPPR",
    "RPHPPPPPPPR",
    "RPPPPPPPPPR",
    ".RPPPPPPPR.",
    "..RPPPPPR..",
    "...RPPPR...",
    "....RPR....",
    ".....R.....",
]
HEART_COLORS = {"R": (194, 24, 91, 255), "P": (255, 126, 182, 255), "H": (255, 214, 232, 255)}


def make_heart():
    img = Image.new("RGBA", (len(HEART[0]), len(HEART)), (0, 0, 0, 0))
    for y, row in enumerate(HEART):
        for x, ch in enumerate(row):
            if ch in HEART_COLORS:
                img.putpixel((x, y), HEART_COLORS[ch])
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", type=Path, default=IMAGES)
    args = ap.parse_args()
    young = args.out_dir / "young"
    young.mkdir(parents=True, exist_ok=True)
    for name, spec in SHEETS.items():
        for k, s in enumerate(YOUNG_SCALES, start=1):
            out = young / f"{Path(name).stem}-stage{k}.png"
            make_sheet(IMAGES / name, spec, s).save(out)
            print("wrote", out.relative_to(args.out_dir.parent) if args.out_dir == IMAGES else out)
    make_heart().save(args.out_dir / "heart.png")
    print("wrote heart.png")


if __name__ == "__main__":
    main()
