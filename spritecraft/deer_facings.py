#!/usr/bin/env python3
"""The stag in the facings the artist didn't draw: up (grid NW), right (NE) and down (SE),
drawn from the posed skeleton (deer_pose.py) by the pixel rules (deer_pixels.py). Left
(SW) is right mirrored, in the game.

GENERATED ART: not the artist's, and not canonical (admin/design_notes.md). The heads and
antlers are the artist's blocks (deer_pixels.HEAD_BLOCKS), chosen by the way the head points.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/deer_facings.py --preview p.png    # every column, the 3 facings
    python3 spritecraft/deer_facings.py --gif g.gif        # walk, run and idle animated
    python3 spritecraft/deer_facings.py --sheet            # write images/stag-land.png

THE SHEET (images/stag-land.png, the game's; 45 columns): rows 0 up-right (grid N), 1
down-right (E), 2 down-left (S), 3 up-left (W): the artist's (images/deer-land.png, as
extract_deer_gif.py takes them from the artist's preview); 4 up (NW), 5 right (NE), 6 down
(SE): these.
Frames are FRAME (48 x 41): a deer in profile is about 1.2 times as long on screen as on a
diagonal (the artist's wolf likewise), more than the artist's 32; the artist's frames are
centred in the wider ones, unchanged.

THE POSES (deer_facing_poses.json, fitted by deer_runfit.py to the artist's grid-N row):
the walk (columns 0-10, 44), the run (35-43, from deer_run_poses.json), and one standing
pose for the idle (11-34), whose head turns (IDLE_TURNS) as the artist's grid-N idle turns
it, and lowers to graze (column 33). Each is drawn at the facing with the same point of
the deer (POSITION_F forward of the middle between the hooves) on the frame's ground point.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import deer_pixels as px
import deer_pose as dp
import deer_runfit as rf
import deer_skeleton as sk

PROJECT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
FRAME = (48, 41)
GROUND = (FRAME[0] / 2, 33)            # the critter's position (animat.js: topToShadow 33)
POSITION_F = 3.4                       # ...this far forward of the middle between the hooves
NEW_ROWS = {4: "NW", 5: "NE", 6: "SE"}
N_COLS = 45
WALK = list(range(0, 11)) + [44]
RUN = list(range(35, 44))
IDLE = list(range(11, 35))
# the idle's head, as the artist turns it for grid N: column -> degrees to the deer's left
IDLE_TURNS = {14: -20, 15: -45, 16: -90, 17: -90, 18: -90, 19: -90, 20: -45,
              22: 45, 23: 90, 24: 90, 25: 90, 26: 90, 27: 90, 28: 90, 29: 90, 30: 45}
GRAZE = {33}
GRAZE_NECK, GRAZE_PITCH = -110.0, -8.0  # degrees: the neck lowered to the grass, the trunk tipped
GRAZE_HEAD = -35.0                      # ...and a drawn head's nose down to it


def load_poses():
    run = json.loads((HERE / "deer_run_poses.json").read_text())
    more = json.loads((HERE / "deer_facing_poses.json").read_text())
    shape = dict(dp.SHAPE0); shape.update(run["shape"])
    rules = dict(px.RULE_PARAMS); rules.update(run.get("rules", {}))
    poses = {}
    for cols, src in ((RUN, run["poses"]), (WALK, more["walk"])):
        cycle = [dict(src[f"N:{c}"]) for c in cols]
        # the fit's sideways shift and mean surge only set the deer on the artist's frame
        mean_df = np.mean([p.get("df", 0.0) for p in cycle])
        for c, p in zip(cols, cycle):
            p["df"] = p.get("df", 0.0) - mean_df
            p["ds"] = 0.0
            poses[c] = p
    stand = dict(more["stand"]); stand["df"] = 0.0; stand["ds"] = 0.0
    for c in IDLE:
        p = dict(stand)
        if c in GRAZE:
            p["neck"], p["pitch"] = np.radians(GRAZE_NECK), np.radians(GRAZE_PITCH)
        poses[c] = p
    return poses, shape, rules


def caster(facing):
    F, L = sk.FACINGS[facing]
    c0 = dp.Caster(F, L, (0, 0))
    uv0 = np.array(GROUND, float) - c0.screen(np.array([POSITION_F, 0, 0]))
    return dp.Caster(F, L, uv0, size=FRAME)


class Drawer:
    def __init__(self):
        self.model = dp.Model()
        self.poses, self.shape, self.rules = load_poses()
        img = np.array(Image.open(PROJECT / "images/deer-land.png").convert("RGBA")).astype(int)
        self.sheet = rf.letters(img[:, :N_COLS * px.FW])     # the artist's frames, as letters

    def frame(self, facing, col):
        """One frame as palette letters, and its shadow's alpha (see rgba)."""
        c = caster(facing)
        pose = self.poses[col]
        yaw = np.radians(IDLE_TURNS.get(col, 0))
        graze = col in GRAZE
        head = px.head_block(c, self.sheet, yaw, graze=graze)
        # seen side-on, the head is drawn (deer_pose.HEAD: the artist drew none side-on), only
        # the antlers kept from the artist's block; seen from the front, behind or on a
        # diagonal, it is the artist's
        drawn = px.head_arrow(c, yaw) in ("→", "←")
        if drawn:
            pitch = GRAZE_HEAD if graze else self.rules["face.pitch"]
            pose = dict(pose, head_yaw=yaw, head=np.radians(pitch))
        sc = px.Scene(self.model, c, pose, self.shape, *sk.FACINGS[facing], head=drawn, P=self.rules)
        return px.paint(sc, self.rules, head), px.shadow_alpha(sc, self.rules)


def rgba(letters, shadow=None):
    """Palette letters as RGBA pixels; where nothing else is drawn, the shadow: its colour,
    see-through by shadow (alpha per pixel), soft-edged as the artist's."""
    a = np.zeros((*letters.shape, 4), np.uint8)
    for k, col in rf.PALETTE.items():
        a[letters == k] = (*col, 255)
    clear = np.isin(letters, [".", "j"])
    if shadow is None:
        shadow = np.where(letters == "j", 102, 0).astype(np.uint8)
    a[clear] = 0
    m = clear & (shadow > 0)
    a[m] = (*rf.PALETTE["J"], 0)
    a[m, 3] = shadow[m]
    return a


def write_sheet(drawer, path):
    """Rows 0-3: the artist's frames (images/deer-land.png), centred in the wider frames;
    rows 4-6: drawn."""
    W, H = FRAME
    old = np.array(Image.open(PROJECT / "images/deer-land.png").convert("RGBA"))
    pad = (W - px.FW) // 2
    out = np.zeros((7 * H, N_COLS * W, 4), np.uint8)
    for row in range(4):
        for col in range(N_COLS):
            out[row * H:(row + 1) * H, col * W + pad:col * W + pad + px.FW] = \
                old[row * px.FH:(row + 1) * px.FH, col * px.FW:(col + 1) * px.FW]
    for row, facing in NEW_ROWS.items():
        for col in range(N_COLS):
            out[row * H:(row + 1) * H, col * W:(col + 1) * W] = rgba(*drawer.frame(facing, col))
    Image.fromarray(out, "RGBA").save(path)


def preview(drawer, path, cols, S=4):
    W, H = FRAME
    img = Image.new("RGBA", (len(cols) * (W + 1) * S, 4 * (H + 1) * S), (120, 170, 90, 255))
    for i, col in enumerate(cols):
        art = np.pad(drawer.sheet[0:px.FH, col * px.FW:(col + 1) * px.FW], ((0, 0), (8, 8)), constant_values=".")
        frames = [(art, None)] + [drawer.frame(f, col) for f in NEW_ROWS.values()]
        for r, L in enumerate(frames):
            im = Image.fromarray(rgba(*L), "RGBA").resize((W * S, H * S), Image.NEAREST)
            img.paste(im, (i * (W + 1) * S, r * (H + 1) * S), im)
    img.save(path)


def gif(drawer, path, S=4):
    W, H = FRAME
    seq = [(c, 6) for c in range(0, 10)] * 2 + [(c, 6) for c in RUN] * 2 + \
          [(c, 30 if c in (19, 26, 33) else 6) for c in IDLE]
    frames, durations = [], []
    for col, hold in seq:
        img = Image.new("RGBA", (4 * W * S, H * S), (120, 170, 90, 255))
        art = np.pad(drawer.sheet[0:px.FH, col * px.FW:(col + 1) * px.FW], ((0, 0), (8, 8)), constant_values=".")
        for r, L in enumerate([(art, None)] + [drawer.frame(f, col) for f in NEW_ROWS.values()]):
            im = Image.fromarray(rgba(*L), "RGBA").resize((W * S, H * S), Image.NEAREST)
            img.paste(im, (r * W * S, 0), im)
        frames.append(img.convert("RGB")); durations.append(hold * 1000 // 60)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations, loop=0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", type=Path)
    ap.add_argument("--cols", default="0,3,6,11,15,17,25,33,35,37,39,41")
    ap.add_argument("--gif", type=Path)
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    d = Drawer()
    if args.preview:
        preview(d, args.preview, [int(c) for c in args.cols.split(",")])
        print("wrote", args.preview)
    if args.gif:
        gif(d, args.gif)
        print("wrote", args.gif)
    if args.sheet:
        write_sheet(d, PROJECT / "images/stag-land.png")
        print("wrote images/stag-land.png")


if __name__ == "__main__":
    main()
