#!/usr/bin/env python3
"""Generate the wolf's stalking sheets (placeholder art: see admin/design_notes.md): the
wolf's land sheet and its young stages' (make_young_sheets.py), every opaque pixel shaded
SHADE of the way toward dark purple, into images/wolf-stalk.png and
images/young/wolf-stalk-stage<k>.png. animat.js draws a stalking wolf with the run frames
of these, slowly.
TODO: draw real stalking frames (crouched, head low).

Usage (needs Python 3 with Pillow and numpy), after make_young_sheets.py:

    python3 spritecraft/make_stalk_sheets.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

SHADE = 0.2
DARK_PURPLE = np.array([48, 16, 64], dtype=np.float32)


def shade(src, dst):
    im = np.asarray(Image.open(src).convert("RGBA")).astype(np.float32)
    rgb = im[..., :3] * (1 - SHADE) + DARK_PURPLE * SHADE
    out = np.concatenate([rgb, im[..., 3:]], axis=-1).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(dst)
    print("wrote", dst.relative_to(PROJECT))


shade(IMAGES / "wolf-land.png", IMAGES / "wolf-stalk.png")
for k in range(1, 5):
    shade(IMAGES / "young" / f"wolf-land-stage{k}.png", IMAGES / "young" / f"wolf-stalk-stage{k}.png")
