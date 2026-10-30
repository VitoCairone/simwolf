#!/usr/bin/env python3
"""The wolf in the facings the artist didn't draw, from its one skeleton (wolf_pose.py) posed
as fitted to the artist's frames (wolf_poses.json) and painted by the pixel rules
(wolf_pixels.py); as deer_facings.py for the deer. So far: the run facing right (grid NE).

GENERATED ART: not the artist's, and not canonical (admin/design_notes.md).

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/wolf_facings.py --compare c.png --gif c.gif
        the run facing right, beside the artist's two facings and the sheet's earlier
        right-facing run (images/wolf-land.png row 5, made another way)

THE HEAD: the artist's head block for the N facing, pasted at the poll. The artist turns the
head toward the screen's profile on the diagonals (wolf_skeleton: about 37 degrees), so the
N block is the head nearly side-on. (TODO: a drawn head, as the deer's, seen side-on.)
PLACING: each pose as fitted (the column's one pose), its sideways shift dropped and its
surge taken about the run's mean, the point POSITION_F forward of the middle between the
paws on the frame's ground point (GROUND: animat.js topToShadow).
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

import deer_pixels as px
import deer_skeleton as dsk
import wolf_pixels as wpx
import wolf_pose as wp
import wolf_runfit as rf

PROJECT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
FW, FH = 64, 64
GROUND = (32, 39)
POSITION_F = 0.0
RUN = rf.RUN
SHADOW = (21, 29, 40)

class Drawer:
    def __init__(self, poses_file=HERE / "wolf_poses.json", rules=None):
        self.shape, skeleton, cols, saved = rf.load(poses_file)
        self.rules = {**wpx.RULE_PARAMS, **(rules if rules is not None else saved)}
        self.model = wp.Model(skeleton)
        self.art = rf.Art(sorted(cols))
        mean_df = np.mean([cols[c].get("df", 0.0) for c in RUN])
        self.poses = {}
        for c, p in cols.items():
            q = rf.view_pose(p, "E")
            q["df"] = q.get("df", 0.0) - (mean_df if c in RUN else q.get("df", 0.0))
            q["ds"] = 0.0
            self.poses[c] = q

    def caster(self, facing):
        F, L = dsk.FACINGS[facing]
        c0 = wp.caster(F, L, (0, 0))
        uv0 = np.array(GROUND, float) - c0.screen(np.array([POSITION_F, 0, 0]))
        return wp.caster(F, L, uv0)

    def frame(self, facing, col):
        """(palette letters, shadow alpha) of a column's pose seen facing `facing`."""
        c = self.caster(facing)
        fr = self.art.frames[("N", col)]
        P = self.rules
        sc = px.Scene(self.model, c, self.poses[col], self.shape, *dsk.FACINGS[facing], P=P)
        return wpx.paint(sc, P, (fr["block"], fr["poll"])), wpx.shadow_alpha(sc, P)


def rgba(letters, shadow=None):
    a = np.zeros((*letters.shape, 4), np.uint8)
    for k, col in rf.PALETTE.items():
        a[letters == k] = (*col, 255)
    clear = np.isin(letters, [".", "j", "h", "?"])
    a[clear] = 0
    if shadow is None:
        shadow = np.where(letters == "j", 102, 0).astype(np.uint8)
    m = clear & (shadow > 0)
    a[m] = (*SHADOW, 0)
    a[m, 3] = shadow[m]
    return a


def sheet_frame(row, col):
    img = np.array(Image.open(PROJECT / "images/wolf-land.png").convert("RGBA"))
    return img[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW]


CROP = (4, 8, 60, 52)       # (x0, y0, x1, y1): the part of a frame shown


def panels(drawer, col):
    """The column's frames: the artist's E (row 1) and N (row 0), the sheet's earlier right
    facing (row 5), and this one."""
    return [sheet_frame(1, col), sheet_frame(0, col), sheet_frame(5, col), rgba(*drawer.frame("NE", col))]


def picture(frames, S):
    x0, y0, x1, y1 = CROP
    w, h = x1 - x0, y1 - y0
    img = Image.new("RGBA", (len(frames) * (w + 2) * S, h * S), (120, 170, 90, 255))
    for i, f in enumerate(frames):
        im = Image.fromarray(np.ascontiguousarray(f[y0:y1, x0:x1]), "RGBA").resize((w * S, h * S), Image.NEAREST)
        img.paste(im, (i * (w + 2) * S, 0), im)
    return img


def compare(drawer, path, S=4):
    """Every run column: artist E | artist N | earlier right | new right."""
    rows = [picture(panels(drawer, c), S) for c in RUN]
    img = Image.new("RGBA", (rows[0].width, sum(r.height + 2 * S for r in rows)), (255, 255, 255, 255))
    y = 0
    for r in rows:
        img.paste(r, (0, y)); y += r.height + 2 * S
    img.save(path)


def gif(drawer, path, S=4, ms=70):
    frames = [picture(panels(drawer, c), S).convert("RGB") for c in RUN] * 1
    slow = [f for f in frames for _ in range(3)]        # (at a third of the game's speed, to see it)
    slow[0].save(path, save_all=True, append_images=slow[1:], duration=ms, loop=0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--compare", type=Path)
    ap.add_argument("--gif", type=Path)
    args = ap.parse_args()
    d = Drawer()
    if args.compare:
        compare(d, args.compare); print("wrote", args.compare)
    if args.gif:
        gif(d, args.gif); print("wrote", args.gif)


if __name__ == "__main__":
    main()
