#!/usr/bin/env python3
"""Fit the posable wolf (wolf_pose.py) to the artist's frames, each at the facing its sheet
row is drawn at (row 1 grid E, row 0 grid N); as deer_runfit.py for the deer.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/wolf_runfit.py --out p.json                       # every frame's pose
    python3 spritecraft/wolf_runfit.py --start p.json --shape --out s.json  # the solids' sizes
    python3 spritecraft/wolf_runfit.py --start s.json --out p2.json          # the poses again
    (--cols 0-11: which columns: the run 0-7, the idle 8-11)

(spritecraft/wolf_poses.json is the result of five such rounds, the tail's length and girth
searched between them, with the pixel rules' numbers fitted by wolf_runtest.py --tune: about
half an hour a round.)

THE ART: images/wolf-land.png (the artist's, by extract_wolf_sheet.py). As with the deer, the
head is one block of pixels the artist moves from frame to frame unchanged (BLOCKS: cut
from the idle's first frame, column 8, and for the N run from column 7), but for the ears;
the rest is redrawn each frame. The fit places the
skeleton's poll under the block.

WHAT A FIT SCORES (lower is better):
    outline      pixels inside the wolf's outline in one of the art and the cast (lower legs
                 as strokes two pixels wide) but not the other (outside the head block; the dust excepted)
    paws         how far each cast paw is from the art's nearest bottom edge (a wolf pixel
                 with none below it), and each of the art's low bottom-edge pixels from the
                 nearest cast paw (more lightly)
    poll         how far the poll is from its place under the head block
    limits       joints bent past what a wolf's can
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import deer_pixels as px
import deer_runfit as drf
import wolf_pose as wp

PROJECT = Path(__file__).resolve().parent.parent
FW, FH = 64, 64
RUN = list(range(0, 8))
IDLE = list(range(8, 12))
ROWS = {"E": (1, (1, 0), (0, 1)), "N": (0, (0, -1), (1, 0))}

PALETTE = {"D": (57, 74, 80), "E": (87, 114, 119), "F": (32, 46, 55), "H": (129, 151, 150),
           "J": (21, 29, 40), "G": (16, 20, 31)}
DUST = [(215, 181, 148), (192, 148, 115)]          # the run's kicked-up dust: 'h'
WOLF = "DEFHJG"

# The head blocks, by view: (the frame cut from, its pixels as a test on (y, x), the pixels
# that place it (the face: the ears are redrawn from frame to frame), the poll's place in it
# (the idle's: wolf_skeleton's reading)). Facing N the running wolf stretches its head
# forward, ears back: a block of its own, from the run; and lowest, in column 2, another.
BLOCKS = {
    "E": [(8, lambda y, x: (y <= 26) & (x >= 33) | (y == 27) & (x >= 41),
           lambda y, x: (y >= 23) & (y <= 26) & (x >= 33) | (y == 27) & (x >= 41), (34.5, 24.5))],
    "N": [(8, lambda y, x: (y <= 23) & (x >= 35) | (y <= 26) & (x >= 40),
           lambda y, x: (y >= 21) & (y <= 23) & (x >= 35) | (y >= 21) & (y <= 26) & (x >= 40), (35.5, 23.5)),
          (7, lambda y, x: (y >= 22) & (y <= 28) & (x >= 37),
           lambda y, x: (y >= 22) & (y <= 28) & (x >= 37), (36.5, 24.5)),
          (2, lambda y, x: (y >= 23) & (y <= 29) & (x >= 35),     # (only in this frame: the head
           lambda y, x: (y >= 23) & (y <= 29) & (x >= 35), (35.5, 25.5))],  # lowest, foreshortened)
}
EARS = 4                                            # the art's pixels this far above a placed face are its ears


def letters(fr):
    """A frame as palette letters ('.' clear, 'j' shadow, 'h' dust, '?' another colour)."""
    out = np.full(fr.shape[:2], ".", dtype="<U1")
    solid = fr[:, :, 3] == 255
    out[solid] = "?"
    for k, c in PALETTE.items():
        out[(fr[:, :, :3] == c).all(-1) & solid] = k
    for c in DUST:
        out[(fr[:, :, :3] == c).all(-1) & solid] = "h"
    out[(fr[:, :, 3] > 0) & (fr[:, :, 3] < 255)] = "j"
    return out


def sheet_letters():
    img = np.array(Image.open(PROJECT / "images/wolf-land.png").convert("RGBA")).astype(int)
    return letters(img)


def frame(sheet, row, col):
    return sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW]


class Art:
    def __init__(self, columns=RUN + IDLE):
        sheet = sheet_letters()
        self.frames = {}
        yy, xx = np.mgrid[0:FH, 0:FW]
        for view, (row, F, L) in ROWS.items():
            cands = []
            for ref, test, place, poll in BLOCKS[view]:
                base = frame(sheet, row, ref)
                ok = np.isin(base, list(WOLF))
                cands.append((base, test(yy, xx) & ok, place(yy, xx) & ok, poll))
            for col in columns:
                fr = frame(sheet, row, col)
                best = None
                for base, block, place, poll in cands:
                    dx, dy, m = self.align(base, place, fr)
                    if best is None or m > best[0]:
                        best = (m, base, block, place, poll, dx, dy)
                m, base, block, place, poll, dx, dy = best
                sh = lambda a: np.roll(np.roll(a, dy, 0), dx, 1)
                head = sh(block)
                # the art's own ears: its pixels just above the placed face
                face = sh(place)
                ys, xs = np.nonzero(face)
                ears = (yy >= ys.min() - EARS) & (yy < ys.min()) & (xx >= xs.min()) & (xx <= xs.max())
                head = head | ears & np.isin(fr, list(WOLF))
                self.frames[view, col] = {
                    "letters": fr, "head": head, "shift": (dx, dy), "match": m,
                    "poll": np.array(poll) + (dx, dy),
                    "block": sh(np.where(block, base, ".")),
                }

    @staticmethod
    def align(base, place, fr):
        """The shift that best lays the placing pixels on the frame's: (dx, dy, the share matched)."""
        best = None
        for dy in range(-12, 13):
            for dx in range(-12, 13):
                b = np.roll(np.roll(place, dy, 0), dx, 1)
                bl = np.roll(np.roll(base, dy, 0), dx, 1)
                sc = (b & (bl == fr)).sum()
                if best is None or sc > best[0]:
                    best = (sc, dx, dy)
        return best[1], best[2], best[0] / max(1, place.sum())


LIMITS = {  # (low, high), radians: a bone's swing relative to its parent's (deer_runfit's,
            # but for the wolf's hind legs reaching straight back and its tail raised straight up)
    **drf.LIMITS, "pitch": (-0.7, 0.7), "fem": (-1.9, 1.3), "tail": (-2.6, 1.2), "tail.bend": (-1.2, 1.2),
    "spine": (-0.5, 0.5), "stretch": (-1.5, 4.0),
}


def limit_penalty(pose, model, J):
    g = lambda k: pose.get(k, 0.0)
    out = lambda x, lo, hi: max(0.0, lo - x) + max(0.0, x - hi)
    pen = sum(out(g(k), *LIMITS[k]) for k in ("pitch", "neck", "tail", "tail.bend", "spine", "stretch"))
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
        self.casters = {v: wp.caster(F, L, model.origins[v]) for v, (_, F, L) in ROWS.items()}
        self.targets = {}
        for key, fr in art.frames.items():
            lt = fr["letters"]
            care = ~fr["head"] & (lt != "h")
            wolf = np.isin(lt, list(WOLF + "?"))
            below = np.zeros_like(wolf); below[:-1] = wolf[1:]
            bottom = np.argwhere(wolf & ~below & ~fr["head"])[:, ::-1] + 0.5      # (x, y)
            self.targets[key] = (care, wolf, bottom, fr["poll"])

    def cover(self, view, pose):
        c = self.casters[view]
        J, ell, sph = self.model.solids(pose, self.shape)
        part, _, _, _ = c.cast(ell, sph)
        mask = part >= 0
        legs, hooves = drf.leg_pixels(c, J)
        dx, dy = px.front_step(c)
        for pts in legs.values():           # two pixels wide (wolf_pixels: leg.wide_*)
            for x, y, _ in pts:
                for (u, v) in ((x, y), (x + dx, y + dy)):
                    if 0 <= u < FW and 0 <= v < FH:
                        mask[v, u] = True
        return mask, J, hooves

    def loss(self, key, pose, parts=False):
        view = key[0]
        care, wolf, bottom, poll = self.targets[key]
        mask, J, hooves = self.cover(view, pose)
        outline = float(((mask ^ wolf) & care).sum())
        H = np.array(list(hooves.values()))
        d = np.sqrt(((bottom[:, None, :] - H[None, :, :]) ** 2).sum(-1))
        low = bottom[:, 1] > H[:, 1].min() - 3              # the art's bottom edges near the ground
        paws = float(np.minimum(d.min(0), 6).sum())
        if low.any():
            paws += 0.3 * float(np.minimum(d[low].min(1), 6).sum())
        pu = self.casters[view].screen(J["poll"])
        poll_l = float(((pu - poll) ** 2).sum()) + 4.0 * float(np.abs(np.round(pu - poll)).sum())
        lim = limit_penalty(pose, self.model, J)
        total = outline + 2.0 * paws + 8.0 * poll_l + 40.0 * lim
        if parts:
            return total, {"outline": outline, "paws": paws, "poll": poll_l, "limits": lim}
        return total

    def descend(self, key, pose, steps=(0.4, 0.2, 0.1, 0.05, 0.025), sweeps=4):
        pose = dict(pose)
        best = self.loss(key, pose)
        for st in steps:
            for _ in range(sweeps):
                improved = False
                for k in wp.POSE_KEYS:
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
            for k in wp.POSE_KEYS:
                trial.setdefault(k, rng.normal(0, 0.2))
            p, l = self.descend(key, trial, steps=(0.2, 0.1, 0.05, 0.025))
            if l < best[1]:
                best = (p, l)
        return best


def fit_shape(fitter, poses, steps=(0.6, 0.3, 0.15), sweeps=2):
    def total():
        return sum(fitter.loss(k, p) for k, p in poses.items())
    best = total()
    for st in steps:
        for _ in range(sweeps):
            improved = False
            for k in wp.SHAPE0:
                for sign in (1, -1):
                    old = fitter.shape[k]
                    fitter.shape[k] = old + sign * st * (0.25 if k == "tail.len" else 1.0)
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


def parse_cols(s):
    out = []
    for part in s.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b) + 1)) if b else [int(a)]
    return out


def save(path, shape, poses):
    path.write_text(json.dumps({"shape": shape, "poses": {f"{v}:{c}": p for (v, c), p in poses.items()}}, indent=1))


def load(path):
    d = json.loads(Path(path).read_text())
    shape = dict(wp.SHAPE0); shape.update(d["shape"])
    return shape, {(k.split(":")[0], int(k.split(":")[1])): v for k, v in d["poses"].items()}, d.get("rules", {})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--restarts", type=int, default=4)
    ap.add_argument("--start", type=Path)
    ap.add_argument("--shape", action="store_true")
    ap.add_argument("--cols", default="0-11")
    ap.add_argument("--views", default="EN")
    args = ap.parse_args()
    cols = parse_cols(args.cols)
    model, art = wp.Model(), Art(cols)
    shape, poses = dict(wp.SHAPE0), {}
    if args.start:
        shape, poses, _ = load(args.start)
    fitter = Fitter(model, art, shape)
    if args.shape:
        poses = {k: p for k, p in poses.items() if k[1] in cols and k[0] in args.views}
        print("start total", round(sum(fitter.loss(k, p) for k, p in poses.items()), 1))
        fit_shape(fitter, poses)
        save(args.out, fitter.shape, poses)
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
            save(args.out, fitter.shape, poses)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
