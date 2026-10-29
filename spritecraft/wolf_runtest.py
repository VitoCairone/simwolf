#!/usr/bin/env python3
"""The test of the wolf's pixel rules (wolf_pixels.py) on its fitted poses (wolf_runfit.py):
paint each of the artist's frames (the run, columns 0-7, and the idle, 8-11) from its pose, at
the facing the art is drawn at, and compare a pixel at a time; as deer_runtest.py.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/wolf_runtest.py spritecraft/wolf_poses.json      # score each frame
        --sheet cmp.png    art | ours | difference, every frame
        --gif run.gif      the run and the idle animated, art above, ours below
        --bones b.png      the fitted skeletons over the art
        --ablate           the score after each rule in turn
        --tune --save p.json   fit the rules' numbers to these poses, and save them

SCORES: same (the share of pixels showing the wolf in the art or ours that are painted the
same palette colour), outline (intersection over union) and shadow (likewise). The head
is the artist's block for the frame (wolf_runfit.BLOCKS), pasted at the fitted poll.
"""

import argparse
import itertools
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import deer_pixels as px
import deer_runtest as drt
import wolf_pixels as wpx
import wolf_pose as wp
import wolf_runfit as rf
import wolf_skeleton as sk

FW, FH = 64, 64
COLOURS = dict(rf.PALETTE)
CROP = (6, 12, 58, 52)          # (x0, y0, x1, y1): the part of a frame the pictures show


class Test:
    def __init__(self, poses, shape, params=None):
        self.model = wp.Model()
        self.art = rf.Art(sorted({k[1] for k in poses}))
        self.poses, self.shape = poses, shape
        self.casters = {v: wp.caster(F, L, self.model.origins[v]) for v, (_, F, L) in rf.ROWS.items()}
        self.scenes = {k: px.Scene(self.model, self.casters[k[0]], p, shape, *rf.ROWS[k[0]][1:], P=params)
                       for k, p in poses.items()}

    def head(self, k):
        fr = self.art.frames[k]
        return fr["block"], fr["poll"]

    def run(self, params, upto=None):
        res = {}
        for k, sc in self.scenes.items():
            out = wpx.paint(sc, params, self.head(k), upto)
            res[k] = (out, wpx.score(out, self.art.frames[k]["letters"]))
        return res

    @staticmethod
    def mean(res, i=0):
        return float(np.mean([r[1][i] for r in res.values()]))


def image(letters):
    a = np.zeros((*letters.shape, 4), np.uint8)
    for k, c in COLOURS.items():
        a[letters == k] = (*c, 255)
    a[letters == "j"] = (21, 29, 40, 110)
    return Image.fromarray(a, "RGBA")


def diff_image(ours, art):
    da, do = ~np.isin(art, [".", "j", "h"]), ~np.isin(ours, [".", "j", "h"])
    a = np.zeros((*art.shape, 4), np.uint8)
    a[da & do & (ours == art)] = drt.DIFF["same"]
    a[da & do & (ours != art)] = drt.DIFF["colour"]
    a[da & ~do] = drt.DIFF["art only"]
    a[~da & do] = drt.DIFF["ours only"]
    return Image.fromarray(a, "RGBA")


def crop(im):
    return im.crop(CROP)


def order(keys):
    return sorted(keys, key=lambda k: (k[0] != "E", k[1] < 8, k[1]))


def sheet(test, res, path, S=5):
    """Art | ours | difference for every frame, two frames to a line."""
    keys = order(res)
    w, h = CROP[2] - CROP[0], CROP[3] - CROP[1]
    W = 3 * (w + 2) * S + 20
    img = Image.new("RGBA", (W * 2, (len(keys) + 1) // 2 * (h + 2) * S), (120, 170, 90, 255))
    for i, k in enumerate(keys):
        ox, oy = (i % 2) * W, (i // 2) * (h + 2) * S
        art = test.art.frames[k]["letters"]
        for j, im in enumerate((image(art), image(res[k][0]), diff_image(res[k][0], art))):
            im = crop(im).resize((w * S, h * S), Image.NEAREST)
            img.paste(im, (ox + j * (w + 2) * S, oy), im)
    img.save(path)


def gif(test, res, path, S=5):
    w, h = CROP[2] - CROP[0], CROP[3] - CROP[1]
    seq = [(c, 70) for c in rf.RUN] * 3 + [(c, 200) for c in rf.IDLE] * 3
    frames, durs = [], []
    for col, ms in seq:
        img = Image.new("RGBA", (2 * (w + 4) * S, 2 * (h + 2) * S), (120, 170, 90, 255))
        for i, view in enumerate(("E", "N")):
            k = (view, col)
            if k not in res:
                continue
            for j, L in enumerate((test.art.frames[k]["letters"], res[k][0])):
                im = crop(image(L)).resize((w * S, h * S), Image.NEAREST)
                img.paste(im, (i * (w + 4) * S, j * (h + 2) * S), im)
        frames.append(img.convert("RGB")); durs.append(ms)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durs, loop=0)


def bones(test, path, S=8):
    keys = order(test.scenes)
    w, h = CROP[2] - CROP[0], CROP[3] - CROP[1]
    per = 6
    img = Image.new("RGBA", (per * (w + 2) * S, (len(keys) + per - 1) // per * (h + 2) * S), (120, 170, 90, 255))
    for i, k in enumerate(keys):
        sc = test.scenes[k]
        im = image(test.art.frames[k]["letters"]).resize((FW * S, FH * S), Image.NEAREST)
        bg = Image.new("RGBA", im.size, (120, 170, 90, 255)); bg.paste(im, (0, 0), im)
        d = ImageDraw.Draw(bg)
        P = {n: sc.caster.screen(q) * S for n, q in sc.J.items() if not n.startswith("_")}
        for a, b in sk.BONES + sk.SOFT + [("tailroot", "tailmid"), ("tailmid", "tail")]:
            if a in P and b in P and not (a, b) == ("tail", "tailroot"):
                far = a.endswith(sc.far) or b.endswith(sc.far)
                col = (250, 160, 160, 255) if far else (200, 20, 20, 255) if a[-1] in "LR" else (20, 60, 220, 255)
                d.line([tuple(P[a]), tuple(P[b])], fill=col, width=3 if not far else 2)
        bg = bg.crop((CROP[0] * S, CROP[1] * S, CROP[2] * S, CROP[3] * S))
        img.paste(bg, ((i % per) * (w + 2) * S, (i // per) * (h + 2) * S))
    img.save(path)


def objective(test, res):
    return test.mean(res, 0) + 0.2 * test.mean(res, 2)


LEG_LETTERS = "DEFJG"


def tune(test, params, steps=(0.2, 0.1, 0.05), sweeps=2):
    """Coordinate search over the rules' numbers (and the legs' colour sequences)."""
    best = objective(test, test.run(params))
    for st in steps:
        for _ in range(sweeps):
            improved = False
            for k, v in list(params.items()):
                if k.startswith("leg.wide"):
                    trials = [w for w in (-1, 0, 1) if w != v]
                elif isinstance(v, str) and len(v) == 1:
                    trials = [c for c in "DEFHJ" if c != v]
                elif isinstance(v, str):
                    trials = []
                    for i in range(len(v)):
                        for c in LEG_LETTERS:
                            if c != v[i]:
                                trials.append(v[:i] + c + v[i + 1:])
                else:
                    s = st if isinstance(v, float) else 1
                    trials = [v + s, v - s]
                for t in trials:
                    trial = dict(params); trial[k] = t
                    m = objective(test, test.run(trial))
                    if m > best + 1e-9:
                        best, params, improved = m, trial, True
                        break
            print("  tune step", st, "objective", round(best, 4), flush=True)
            if not improved:
                break
    return params


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("poses", type=Path)
    ap.add_argument("--sheet", type=Path)
    ap.add_argument("--gif", type=Path)
    ap.add_argument("--bones", type=Path)
    ap.add_argument("--tune", action="store_true")
    ap.add_argument("--ablate", action="store_true")
    ap.add_argument("--save", type=Path)
    args = ap.parse_args()
    shape, poses, rules = rf.load(args.poses)
    params = dict(wpx.RULE_PARAMS); params.update(rules)
    test = Test(poses, shape, params)
    if args.tune:
        params = tune(test, params)
        print("rule numbers:", {k: round(v, 3) if isinstance(v, float) else v for k, v in params.items()})
    res = test.run(params)
    for k in order(res):
        s = res[k][1]
        print(f"{k[0]} {k[1]:2}  same {s[0]:.3f}  outline {s[1]:.3f}  shadow {s[2]:.3f}")
    for name, keys in (("run", [k for k in res if k[1] < 8]), ("idle", [k for k in res if k[1] >= 8])):
        sub = {k: res[k] for k in keys}
        if sub:
            print(f"{name:5} mean same {test.mean(sub, 0):.3f}  outline {test.mean(sub, 1):.3f}  shadow {test.mean(sub, 2):.3f}")
    print(f"all   mean same {test.mean(res, 0):.3f}  outline {test.mean(res, 1):.3f}  shadow {test.mean(res, 2):.3f}")
    if args.ablate:
        for i, (name, _) in enumerate(wpx.RULES):
            print(f"  after {name:12} same {test.mean(test.run(params, i + 1)):.3f}")
    if args.sheet:
        sheet(test, res, args.sheet); print("wrote", args.sheet)
    if args.bones:
        bones(test, args.bones); print("wrote", args.bones)
    if args.gif:
        gif(test, res, args.gif); print("wrote", args.gif)
    if args.save:
        d = json.loads(args.poses.read_text()); d["rules"] = params
        args.save.write_text(json.dumps(d, indent=1))


if __name__ == "__main__":
    main()
