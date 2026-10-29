#!/usr/bin/env python3
"""Fit the posable skeleton (deer_pose.py) to the artist's running stag, frame by frame,
each at the facing its sheet row is drawn at (row 1 grid E, row 0 grid N).

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/deer_runfit.py --out p.json                    # fit every frame's pose
    python3 spritecraft/deer_runfit.py --start p.json --shape --out s.json  # fit the solids' sizes
    python3 spritecraft/deer_runfit.py --start s.json --out p2.json        # and the poses again

(spritecraft/deer_run_poses.json is the result of four such rounds, with the pixel rules'
numbers fitted by deer_runtest.py --tune: about 20 minutes a round.)

THE ART: images/deer-land.png, columns 35-43 (the run). The head and antlers are one block of
pixels the artist moves from frame to frame unchanged (HEAD_BLOCK: cut from column 35); the
rest is redrawn each frame. The fit places the skeleton's poll under the block.

WHAT A FIT SCORES (lower is better):
    outline      pixels inside the deer's outline in one of the art and the cast (with the
                 lower legs and the tail drawn as deer_pixels.py draws them) but not the other
                 (outside the head block; the dust excepted)
    hooves       how far each of the art's hoof pixels is from the nearest cast hoof, and
                 (more lightly) each cast hoof from the nearest of the art's
    poll         how far the poll is from its place under the head block
    limits       joints bent past what a deer's can
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import deer_pixels as px
import deer_pose as dp

PROJECT = Path(__file__).resolve().parent.parent
FW, FH = 32, 41
RUN = range(35, 44)
WALK = list(range(0, 11)) + [44]   # the walk, the run's start (10) and its stop (44): the
                                   # run's head block too
ROWS = {"E": (1, (1, 0), (0, 1)), "N": (0, (0, -1), (1, 0))}

PALETTE = {"D": (207, 87, 60), "E": (218, 134, 62), "F": (165, 48, 48), "I": (117, 36, 56),
           "H": (232, 193, 112), "G": (16, 20, 31), "J": (21, 29, 40), "K": (77, 43, 50),
           "A": (96, 44, 44), "B": (52, 28, 39), "C": (136, 75, 43), "h": (231, 213, 179)}
ANTLER = "ABC"

# the head block, in column 35's frame: rows above `below` (and on `below`, columns from `cols`)
HEAD_BLOCK = {"E": (19, 17), "N": (14, 99)}
# the poll's place in the head block (column 35's frame), by eye: the back of the skull
POLL_AT = {"E": (18.5, 15.5), "N": (17.5, 12.5)}


def letters(fr):
    """A frame as palette letters ('.' clear, 'j' shadow: the shadow is drawn translucent)."""
    out = np.full(fr.shape[:2], ".", dtype="<U1")
    for k, c in PALETTE.items():
        m = (fr[:, :, :3] == c).all(-1) & (fr[:, :, 3] > 0)
        out[m] = k
    out[(fr[:, :, 3] > 0) & (fr[:, :, 3] < 255)] = "j"
    return out


class Art:
    def __init__(self, columns=RUN):
        sheet = np.array(Image.open(PROJECT / "images/deer-land.png").convert("RGBA")).astype(int)
        self.frames = {}
        for view, (row, F, L) in ROWS.items():
            base = letters(sheet[row * FH:(row + 1) * FH, 35 * FW:36 * FW])
            below, cols = HEAD_BLOCK[view]
            yy, xx = np.mgrid[0:FH, 0:FW]
            block = (base != ".") & (base != "j") & ((yy < below) | ((yy == below) & (xx >= cols)))
            antler = np.isin(base, list(ANTLER)) & block
            for col in columns:
                fr = letters(sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW])
                dx, dy = self.align(antler, np.isin(fr, list(ANTLER)))
                head = np.roll(np.roll(block, dy, 0), dx, 1)
                # the block's own pixels, as drawn in this frame (antler tips vary a little)
                near = np.zeros_like(head)
                ys, xs = np.nonzero(head)
                y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
                near[y0:y1 + 1, x0:x1 + 1] = np.isin(fr[y0:y1 + 1, x0:x1 + 1], list(ANTLER))
                self.frames[view, col] = {
                    "letters": fr, "head": head | near, "shift": (dx, dy),
                    "poll": np.array(POLL_AT[view]) + (dx, dy),
                    "block": np.roll(np.roll(np.where(block, base, "."), dy, 0), dx, 1),
                }

    @staticmethod
    def align(a, b):
        best = None
        for dy in range(-8, 9):
            for dx in range(-6, 7):
                sc = (np.roll(np.roll(a, dy, 0), dx, 1) & b).sum()
                if best is None or sc > best[0]:
                    best = (sc, dx, dy)
        return best[1], best[2]


def leg_pixels(caster, J):
    """The lower legs' pixels: {leg: [(x, y, depth), ...]} from the carpus or hock down,
    and each hoof's pixel."""
    out, hooves = {}, {}
    for leg, chain in (("FL", ("carpusL", "fetlockFL", "hoofFL")), ("FR", ("carpusR", "fetlockFR", "hoofFR")),
                       ("HL", ("hockL", "fetlockHL", "hoofHL")), ("HR", ("hockR", "fetlockHR", "hoofHR"))):
        pts = []
        for a, b in zip(chain, chain[1:]):
            for t in np.linspace(0, 1, 12):
                P = J[a] + (J[b] - J[a]) * t
                u, v = caster.screen(P)
                pts.append((int(np.floor(u)), int(np.floor(v)), float(caster.depth(P))))
        out[leg] = pts
        u, v = caster.screen(J[chain[-1]])
        hooves[leg] = (u, v)
    return out, hooves


LIMITS = {  # (low, high), radians: the bone's swing relative to its parent's
    "pitch": (-0.6, 0.6), "neck": (-0.9, 0.9), "tail": (-1.6, 0.8),
    "scap": (-0.5, 0.5), "hum-scap": (-1.3, 1.3), "rad-hum": (-0.3, 2.2), "can-rad": (-2.4, 0.15),
    "fem": (-1.3, 1.3), "tib-fem": (-1.8, 0.3), "can-tib": (-0.3, 2.2),
}


def limit_penalty(pose, model, J):
    g = lambda k: pose.get(k, 0.0)
    pen = 0.0

    def out(x, lo, hi):
        return max(0.0, lo - x) + max(0.0, x - hi)

    for k in ("pitch", "neck", "tail"):
        pen += out(g(k), *LIMITS[k])
    for leg in ("FL", "FR"):
        pen += out(g(leg + ".scap"), *LIMITS["scap"])
        pen += out(g(leg + ".hum") - g(leg + ".scap"), *LIMITS["hum-scap"])
        pen += out(g(leg + ".rad") - g(leg + ".hum"), *LIMITS["rad-hum"])
        pen += out(g(leg + ".can") - g(leg + ".rad"), *LIMITS["can-rad"])
    for leg in ("HL", "HR"):
        pen += out(g(leg + ".fem"), *LIMITS["fem"])
        pen += out(g(leg + ".tib") - g(leg + ".fem"), *LIMITS["tib-fem"])
        pen += out(g(leg + ".can") - g(leg + ".tib"), *LIMITS["can-tib"])
    for h in ("hoofFL", "hoofFR", "hoofHL", "hoofHR"):
        pen += max(0.0, -0.3 - J[h][2])
    return pen


class Fitter:
    def __init__(self, model, art, shape):
        self.model, self.art, self.shape = model, art, dict(shape)
        self.casters = {v: dp.Caster(F, L, model.origins[v]) for v, (_, F, L) in ROWS.items()}
        self.targets = {}
        for key, fr in art.frames.items():
            lt = fr["letters"]
            care = ~fr["head"] & (lt != "h")
            deer = np.isin(lt, list("DEFIHGJKABC"))
            hoof = np.argwhere(np.isin(lt, ["G", "J"]) & care)  # (y, x)
            self.targets[key] = (care, deer, hoof[:, ::-1] + 0.5, fr["poll"])

    def cover(self, view, pose):
        """The cast deer mask (no head block), the joints and the hooves' screen points."""
        c = self.casters[view]
        J, ell, sph = self.model.solids(pose, self.shape)
        part, _, _, _ = c.cast(ell, sph)
        mask = part >= 0
        legs, hooves = leg_pixels(c, J)
        for pts in legs.values():
            for x, y, _ in pts:
                if 0 <= x < FW and 0 <= y < FH:
                    mask[y, x] = True
        for x, y in px.tail_stroke(self.model, c, pose, px.RULE_PARAMS)[0]:
            mask[y, x] = True
        return mask, J, hooves

    def loss(self, key, pose, parts=False):
        view = key[0]
        care, deer, hoof, poll = self.targets[key]
        mask, J, hooves = self.cover(view, pose)
        outline = float(((mask ^ deer) & care).sum())
        H = np.array(list(hooves.values()))
        if len(hoof):
            d = np.sqrt(((hoof[:, None, :] - H[None, :, :]) ** 2).sum(-1))
            hooves_l = float(np.minimum(d.min(1), 4).sum() + 0.3 * np.minimum(d.min(0), 4).sum())
        else:
            hooves_l = 0.0
        pu = self.casters[view].screen(J["poll"])
        poll_l = float(((pu - poll) ** 2).sum())
        # the block is pasted at the poll rounded to a pixel: a pixel off is ~100 pixels wrong
        poll_l += 4.0 * float(np.abs(np.round(pu - poll)).sum())
        lim = limit_penalty(pose, self.model, J)
        total = outline + 2.0 * hooves_l + 8.0 * poll_l + 40.0 * lim
        if parts:
            return total, {"outline": outline, "hooves": hooves_l, "poll": poll_l, "limits": lim}
        return total

    def descend(self, key, pose, steps=(0.4, 0.2, 0.1, 0.05, 0.025), sweeps=4):
        pose = dict(pose)
        best = self.loss(key, pose)
        for st in steps:
            for _ in range(sweeps):
                improved = False
                for k in dp.POSE_KEYS:
                    s = st * (2.5 if k in ("df", "ds", "dz") else 1.0)
                    for sign in (1, -1):
                        trial = dict(pose); trial[k] = pose.get(k, 0.0) + sign * s
                        l = self.loss(key, trial)
                        if l < best - 1e-9:
                            best, pose, improved = l, trial, True
                            break
                if not improved:
                    break
        return pose, best

    def fit_frame(self, key, starts, rng, restarts=4):
        best = None
        for s in starts:
            p, l = self.descend(key, s)
            if best is None or l < best[1]:
                best = (p, l)
        for _ in range(restarts):
            trial = {k: v + rng.normal(0, 0.25 if k not in ("df", "ds", "dz") else 0.6) for k, v in best[0].items()}
            for k in dp.POSE_KEYS:
                trial.setdefault(k, rng.normal(0, 0.2))
            p, l = self.descend(key, trial, steps=(0.2, 0.1, 0.05, 0.025))
            if l < best[1]:
                best = (p, l)
        return best


def fit_shape(fitter, poses, steps=(0.6, 0.3, 0.15), sweeps=2):
    """The solids' sizes that best fit every frame, the poses held."""
    def total():
        return sum(fitter.loss(k, p) for k, p in poses.items())
    best = total()
    for st in steps:
        for _ in range(sweeps):
            improved = False
            for k in dp.SHAPE0:
                s = st * (0.25 if k.endswith("from") else 1.0)
                for sign in (1, -1):
                    old = fitter.shape[k]
                    fitter.shape[k] = old + sign * s
                    if fitter.shape[k] <= 0.2 and not k.endswith(".f"):
                        fitter.shape[k] = old
                        continue
                    l = total()
                    if l < best - 1e-9:
                        best, improved = l, True
                        break
                    fitter.shape[k] = old
            print("  shape step", st, "total", round(best, 1), flush=True)
            if not improved:
                break
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--restarts", type=int, default=4)
    ap.add_argument("--start", type=Path, help="poses (and shape) to start from")
    ap.add_argument("--shape", action="store_true", help="fit the solids' sizes to the --start poses only")
    ap.add_argument("--walk", action="store_true", help="the walk's frames (WALK), not the run's")
    ap.add_argument("--views", default="EN", help="the rows to fit: E, N or both")
    args = ap.parse_args()
    cols = WALK if args.walk else RUN
    model, art = dp.Model(), Art(cols)
    shape = dict(dp.SHAPE0)
    poses = {}
    if args.start:
        prev = json.loads(args.start.read_text())
        shape.update(prev["shape"])
        poses = {(k.split(":")[0], int(k.split(":")[1])): v for k, v in prev["poses"].items()}
    fitter = Fitter(model, art, shape)
    if args.shape:
        print("start total", round(sum(fitter.loss(k, p) for k, p in poses.items()), 1))
        fit_shape(fitter, poses)
        args.out.write_text(json.dumps({"shape": fitter.shape, "poses": {f"{v}:{c}": p for (v, c), p in poses.items()}}, indent=1))
        print("wrote", args.out)
        return
    rng = np.random.default_rng(1)
    for view in args.views:
        prev = None
        for col in cols:
            key = (view, col)
            starts = [{}]
            if prev is not None:
                starts.append(prev)
            if key in poses:
                starts.append(poses[key])
            pose, l = fitter.fit_frame(key, starts, rng, args.restarts)
            poses[key] = pose
            prev = pose
            print(view, col, round(l, 1), {k: round(v, 1) for k, v in fitter.loss(key, pose, True)[1].items()}, flush=True)
    args.out.write_text(json.dumps({"shape": fitter.shape, "poses": {f"{v}:{c}": p for (v, c), p in poses.items()}}, indent=1))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
