#!/usr/bin/env python3
"""The test of the pixel rules (deer_pixels.py) on the fitted running poses (deer_runfit.py):
paint each of the artist's 18 running frames from its pose, at the facing the art is drawn
at, and compare a pixel at a time.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/deer_runtest.py spritecraft/deer_run_poses.json   # score each frame
        --sheet cmp.png    art | ours | difference, every frame
        --gif run.gif      the cycle animated, art above, ours below
        --bones b.png      the fitted skeletons over the art
        --ablate           the score after each rule in turn
        --tune --save p.json   fit the rules' numbers to these poses, and save them

SCORES: same (the share of pixels showing deer in the art or ours that are painted the
same palette colour), outline (the deer pixels' overlap: intersection over union) and
shadow (likewise).
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import deer_pixels as px
import deer_pose as dp
import deer_runfit as rf

FW, FH = 32, 41
COLOURS = dict(rf.PALETTE)


def load(path):
    d = json.loads(Path(path).read_text())
    poses = {(k.split(":")[0], int(k.split(":")[1])): v for k, v in d["poses"].items()}
    shape = dict(dp.SHAPE0); shape.update(d["shape"])
    return poses, shape, d.get("rules", {})


class Test:
    def __init__(self, poses, shape, columns=rf.RUN, drawn=False, params=None):
        """drawn: the head drawn (deer_pose.HEAD), not the artist's block pasted."""
        self.model, self.art = dp.Model(), rf.Art(columns)
        self.poses, self.shape = poses, shape
        self.casters = {v: dp.Caster(F, L, self.model.origins[v]) for v, (_, F, L) in rf.ROWS.items()}
        first = list(columns)[0]       # (the head block, as placed in some frame, and its poll there)
        self.heads = {v: (self.art.frames[(v, first)]["block"], self.art.frames[(v, first)]["poll"])
                      for v in rf.ROWS}
        self.scenes = {k: px.Scene(self.model, self.casters[k[0]], p, shape, *rf.ROWS[k[0]][1:],
                                   head=drawn, P=params)
                       for k, p in poses.items()}

    def run(self, params, upto=None):
        res = {}
        for k, sc in self.scenes.items():
            out = px.paint(sc, params, self.heads[k[0]], upto)
            res[k] = (out, px.score(out, self.art.frames[k]["letters"]))
        return res

    def head_score(self, res):
        """The same-colour share over the artist's head block (and wherever ours drew a head)."""
        same = n = 0
        for k, (out, _) in res.items():
            art = self.art.frames[k]["letters"]
            m = self.art.frames[k]["head"] | (self.scenes[k].is_part(*dp.HEAD_PARTS) & ~np.isin(out, [".", "j"]))
            m &= ~(np.isin(art, [".", "j", "h"]) & np.isin(out, [".", "j", "h"]))
            same += ((out == art) & m).sum(); n += m.sum()
        return same / max(1, n)

    @staticmethod
    def mean(res, i=0):
        return float(np.mean([r[1][i] for r in res.values()]))


def image(letters):
    a = np.zeros((*letters.shape, 4), np.uint8)
    for k, c in COLOURS.items():
        a[letters == k] = (*c, 255)
    a[letters == "j"] = (21, 29, 40, 110)
    return Image.fromarray(a, "RGBA")


DIFF = {"same": (240, 240, 240, 255), "colour": (250, 170, 40, 255), "art only": (40, 90, 230, 255),
        "ours only": (220, 30, 30, 255)}


def diff_image(ours, art):
    """White: the same colour; orange: deer in both, another colour; blue: deer only in the
    art; red: deer only in ours."""
    da, do = ~np.isin(art, [".", "j", "h"]), ~np.isin(ours, [".", "j", "h"])
    a = np.zeros((FH, FW, 4), np.uint8)
    a[da & do & (ours == art)] = DIFF["same"]
    a[da & do & (ours != art)] = DIFF["colour"]
    a[da & ~do] = DIFF["art only"]
    a[~da & do] = DIFF["ours only"]
    return Image.fromarray(a, "RGBA")


def sheet(test, res, path, S=6):
    """Art | ours | difference, for every frame: the E row's nine, then the N row's."""
    keys = sorted(res, key=lambda k: (k[0] != "E", k[1]))
    W = 3 * (FW + 2) * S + 20
    img = Image.new("RGBA", (W * 3, len(keys) // 3 * (FH + 2) * S), (120, 170, 90, 255))
    for i, k in enumerate(keys):
        ox, oy = (i % 3) * W, (i // 3) * (FH + 2) * S
        art = test.art.frames[k]["letters"]
        for j, im in enumerate((image(art), image(res[k][0]), diff_image(res[k][0], art))):
            im = im.resize((FW * S, FH * S), Image.NEAREST)
            img.paste(im, (ox + j * (FW + 2) * S, oy), im)
    img.save(path)


def objective(test, res):
    """What tuning maximises: the same-colour share, and a little of the shadow's overlap."""
    return test.mean(res, 0) + 0.2 * test.mean(res, 2)


def gif(test, res, path, S=6):
    """The run cycle animated: each row's art above, ours below."""
    frames = []
    for col in rf.RUN:
        img = Image.new("RGBA", (2 * (FW + 4) * S, 2 * (FH + 2) * S), (120, 170, 90, 255))
        for i, view in enumerate(("E", "N")):
            k = (view, col)
            for j, L in enumerate((test.art.frames[k]["letters"], res[k][0])):
                im = image(L).resize((FW * S, FH * S), Image.NEAREST)
                img.paste(im, (i * (FW + 4) * S, j * (FH + 2) * S), im)
        frames.append(img.convert("RGB"))
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=110, loop=0)


def bones(test, path, S=10):
    """Each fitted skeleton over the artist's frame (near side dark red, far side pink)."""
    import deer_skeleton as sk
    from PIL import ImageDraw
    keys = sorted(test.scenes, key=lambda k: (k[0] != "E", k[1]))
    img = Image.new("RGBA", (9 * (FW + 2) * S, 2 * (FH + 2) * S), (120, 170, 90, 255))
    for i, k in enumerate(keys):
        sc = test.scenes[k]
        im = image(test.art.frames[k]["letters"]).resize((FW * S, FH * S), Image.NEAREST)
        bg = Image.new("RGBA", im.size, (120, 170, 90, 255)); bg.paste(im, (0, 0), im)
        d = ImageDraw.Draw(bg)
        J = sc.J
        P = {n: sc.caster.screen(q) * S for n, q in J.items() if not n.startswith("_")}
        for a, b in sk.BONES + sk.SOFT:
            if a in P and b in P:
                far = a.endswith(sc.far) or b.endswith(sc.far)
                col = (250, 160, 160, 255) if far else (200, 20, 20, 255) if a[-1] in "LR" else (20, 60, 220, 255)
                d.line([tuple(P[a]), tuple(P[b])], fill=col, width=3 if not far else 2)
        for n, q in P.items():
            if any(n.startswith(j) for j in ("elbow", "carpus", "stifle", "hock")):
                d.ellipse([q[0] - 4, q[1] - 4, q[0] + 4, q[1] + 4], fill=(255, 255, 255, 255), outline=(0, 0, 0, 255))
        img.paste(bg, ((i % 9) * (FW + 2) * S, (i // 9) * (FH + 2) * S))
    img.save(path)


def tail_window(sc):
    """The pixels where a tail may be: behind the hip joints on screen, around the croup."""
    c = sc.caster
    hip = (c.screen(sc.J["hipjointL"]) + c.screen(sc.J["hipjointR"])) / 2
    top = c.screen(sc.J["sacrum"])
    back = 1 if (c.screen(np.array([1.0, 0, 0])) - c.screen(np.zeros(3)))[0] >= 0 else -1
    v, u = np.mgrid[0:FH, 0:FW] + 0.5
    return ((u - hip[0]) * back < 1) & (v > top[1] - 8) & (v < hip[1] + 4)


def tail_score(out, art, window):
    """The same-colour share of the deer pixels in the window."""
    da, do = ~np.isin(art, [".", "j", "h"]), ~np.isin(out, [".", "j", "h"])
    union = (da | do) & window
    return ((out == art) & union).sum() / max(1, union.sum())


def fit_tails(test, params, degrees=range(-90, 50, 5)):
    """Each frame's tail angle: the one that paints the croup closest to the art. The mean
    of those scores. (Running, a deer carries its tail out: never tucked more than 45
    degrees below straight back.)"""
    total = 0.0
    for k, sc in test.scenes.items():
        art = test.art.frames[k]["letters"]
        window = tail_window(sc)
        best = None
        for deg in degrees:
            pose = dict(sc.pose); pose["tail"] = np.radians(deg)
            sc.pose = pose
            sc.J = test.model.posed(pose)
            s = tail_score(px.paint(sc, params, test.heads[k[0]]), art, window)
            if best is None or s > best[0] + 1e-9:
                best = (s, pose)
        sc.pose = best[1]; sc.J = test.model.posed(best[1])
        test.poses[k] = best[1]
        total += best[0]
    return total / len(test.scenes)


def tune_tails(test, params, steps=(0.2, 0.1)):
    """The tail rule's numbers, by the croup windows' score (each frame's angle refitted)."""
    best = fit_tails(test, params)
    for st in steps:
        improved = True
        while improved:
            improved = False
            for k, v in list(params.items()):
                if not k.startswith("tail.") or k == "tail.over":
                    continue
                for sign in (1, -1):
                    trial = dict(params); trial[k] = v + sign * st * (5 if k in ("tail.f", "tail.z", "tail.len") else 1)
                    m = fit_tails(test, trial)
                    if m > best + 1e-9:
                        best, params, improved = m, trial, True
                        break
            print("  tail step", st, "window", round(best, 4), flush=True)
    fit_tails(test, params)
    return params


def tune(test, params, steps=(0.2, 0.1, 0.05), sweeps=2, only=None):
    best = objective(test, test.run(params))
    for st in steps:
        for _ in range(sweeps):
            improved = False
            for k, v in list(params.items()):
                if isinstance(v, str) or (only and not k.startswith(only)):
                    continue
                s = st if isinstance(v, float) else 1
                for sign in (1, -1):
                    trial = dict(params); trial[k] = v + sign * s
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
    ap.add_argument("--gif", type=Path, help="the cycle animated: art above, ours below")
    ap.add_argument("--bones", type=Path, help="the fitted skeletons over the art")
    ap.add_argument("--tune", action="store_true")
    ap.add_argument("--drawn-head", action="store_true", help="draw the head (deer_pose.HEAD), not paste the artist's")
    ap.add_argument("--tails", action="store_true", help="refit each frame's tail angle, and the tail rule's numbers")
    ap.add_argument("--ablate", action="store_true")
    ap.add_argument("--save", type=Path, help="write the poses, shape and tuned rule numbers here")
    args = ap.parse_args()
    poses, shape, rules = load(args.poses)
    test = Test(poses, shape, drawn=args.drawn_head, params={**px.RULE_PARAMS, **rules})
    params = dict(px.RULE_PARAMS); params.update(rules)
    if args.tails:
        for _ in range(2):
            fit_tails(test, params)
            params = tune_tails(test, params)
        print("tail angles:", {f"{k[0]}{k[1]}": round(float(np.degrees(p.get("tail", 0)))) for k, p in test.poses.items()})
    if args.tune:
        params = tune(test, params)
        print("rule numbers:", {k: round(v, 3) if isinstance(v, float) else v for k, v in params.items()})
    res = test.run(params)
    for k in sorted(res, key=lambda k: (k[0] != "E", k[1])):
        s = res[k][1]
        print(f"{k[0]} {k[1]}  same {s[0]:.3f}  outline {s[1]:.3f}  shadow {s[2]:.3f}")
    print(f"mean     same {test.mean(res, 0):.3f}  outline {test.mean(res, 1):.3f}  shadow {test.mean(res, 2):.3f}"
          f"  head {test.head_score(res):.3f}")
    if args.ablate:
        for i, (name, _) in enumerate(px.RULES):
            print(f"  after {name:12} same {test.mean(test.run(params, i + 1)):.3f}")
    if args.sheet:
        sheet(test, res, args.sheet)
        print("wrote", args.sheet)
    if args.bones:
        bones(test, args.bones)
        print("wrote", args.bones)
    if args.gif:
        gif(test, res, args.gif)
        print("wrote", args.gif)
    if args.save:
        d = json.loads(args.poses.read_text()); d["rules"] = params
        d["poses"] = {f"{v}:{c}": p for (v, c), p in test.poses.items()}
        args.save.write_text(json.dumps(d, indent=1))


if __name__ == "__main__":
    main()
