#!/usr/bin/env python3
"""Fit the posable wolf (wolf_pose.py) to the artist's frames, each at the facing its sheet
row is drawn at (row 1 grid E, row 0 grid N); as deer_runfit.py for the deer.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/wolf_runfit.py --out p.json                       # every column's pose
    python3 spritecraft/wolf_runfit.py --start p.json --skeleton --out k.json  # the sections' lengths
    python3 spritecraft/wolf_runfit.py --start k.json --shape --out s.json  # the solids' sizes
    python3 spritecraft/wolf_runfit.py --start s.json --out p2.json          # the poses again
    (--cols 0-11: which columns: the run 0-7, the idle 8-11; with --skeleton, the columns whose
    poses it fits to: --cols 8 the idle's first only, --cols 0-7 the run only)

(spritecraft/wolf_poses.json: several such rounds, about half an hour each, with the run's
stretched-out columns (0, 1, 7) started from a galloping pose and its tail searched on a grid,
and the pixel rules' numbers fitted by wolf_runtest.py --tune.)

THE ART: images/wolf-land.png (the artist's, by extract_wolf_sheet.py). As with the deer, the
head is one block of pixels the artist moves from frame to frame unchanged (BLOCKS: cut
from the idle's first frame, column 8, and for the N run from column 7), but for the ears;
the rest is redrawn each frame. The fit places the
skeleton's poll under the block.

A COLUMN HAS ONE POSE: the artist's two rows draw the same moment (see ONE POSE, TWO VIEWS),
so a pose is fitted to both at once, and is the pose the other facings will be drawn from.

WHAT A FIT SCORES (lower is better, summed over the column's two frames):
    outline      pixels inside the wolf's outline in one of the art and the cast (lower legs
                 as strokes two pixels wide) but not the other (outside the head block; the dust excepted)
    paws         how far each cast paw is from the art's nearest paw (paw_points: the bottom of
                 a narrow column), and each of the art's paws from the nearest cast paw
    poll         how far the poll is from its place under the head block
    limits       joints bent past what a wolf's can (LIMITS)
    prior        joints bent from standing (pose_prior), lightly: the views leave some free
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

import deer_pixels as px
import deer_runfit as drf
import wolf_pose as wp
import wolf_skeleton as sk

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


LIMITS = {  # (low, high), radians: a bone's swing (forward positive) relative to its parent's,
    # from the standing pose: a dog's joints' range of motion (goniometry; approximate), the
    # standing joint angles about 110 (shoulder), 140 (elbow), 185 (carpus), 100 (hip),
    # 130 (stifle) and 135 degrees (hock)
    "scap": (-0.5, 0.5), "hum-scap": (-0.95, 0.95), "rad-hum": (-0.45, 1.8), "can-rad": (-2.6, 0.2),
    "fem": (-1.1, 0.9), "tib-fem": (-1.55, 0.55), "can-tib": (-0.5, 1.7),
    # the trunk tipped, the back bent, the neck and the tail
    "pitch": (-0.45, 0.45), "neck": (-0.9, 0.9),
    "back.w": (-0.25, 0.35), "back.t": (-0.25, 0.35), "back.l": (-0.25, 0.35),   # (a dog's back
    # flexes and extends most in the loins; these allow each joint about 35 degrees in all)
    "tail": (-2.6, 1.2), "tail.bend": (-1.2, 1.2), "tail.side": (-1.0, 1.0),
}
LIMIT_WEIGHT = 200          # the loss of a joint bent a radian past its limit
SCALE_LIMITS = (0.7, 1.4)
ARCH_LIMITS = (0.0, 2.5)    # the standing back's arch (wolf_pose.Model), true-space units   # a section's length: of the idle-fitted skeleton's


PRIOR_WEIGHT = 12.0  # the loss of a joint bent a radian from standing (squared): the two
                    # diagonal views leave a leg's swing toward or away from the camera nearly
                    # free; of the bends that draw the same, the fit takes the least


def pose_prior(pose):
    """Each joint's bend from standing, squared and summed: the legs' (relative to the bone
    above), the back's and the neck's."""
    g = lambda k: pose.get(k, 0.0)
    total = sum(g(k) ** 2 for k in ("back.w", "back.t", "back.l", "neck"))
    for leg in ("FL", "FR"):
        chain = [0.0] + [g(f"{leg}.{k}") for k in ("scap", "hum", "rad", "can")]
        total += sum((b - a) ** 2 for a, b in zip(chain, chain[1:]))
    for leg in ("HL", "HR"):
        chain = [0.0] + [g(f"{leg}.{k}") for k in ("fem", "tib", "can")]
        total += sum((b - a) ** 2 for a, b in zip(chain, chain[1:]))
    return total


def limit_penalty(pose, model, J):
    g = lambda k: pose.get(k, 0.0)
    out = lambda x, lo, hi: max(0.0, lo - x) + max(0.0, x - hi)
    pen = sum(out(g(k), *LIMITS[k]) for k in ("pitch", "neck", "tail", "tail.bend", "tail.side", "back.w", "back.t", "back.l"))
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


# ONE POSE, TWO VIEWS. The artist's two rows draw the same moment in each column (the same
# wolf, seen facing N and facing E), so a column has one pose; only where the wolf stands in
# the frame may differ between the rows (OFFSETS: the N row's, added to the pose's place).
OFFSETS = ["N.df", "N.ds", "N.dz"]
KEYS = wp.POSE_KEYS + OFFSETS
MOVES = ("df", "ds", "dz") + tuple(OFFSETS)


def view_pose(pose, view):
    """A column's pose as its row draws it."""
    p = {k: v for k, v in pose.items() if k not in OFFSETS}
    if view == "N":
        for k in ("df", "ds", "dz"):
            p[k] = p.get(k, 0.0) + pose.get("N." + k, 0.0)
    return p


PAW_CAP = 6.0       # pixels: a paw farther than this from any is as wrong as can be
PAW_RUN = 4         # the widest a paw's bottom row, and the row above it, may be


def paw_points(letters, head):
    """The art's paws: where a leg ends, the bottom of a narrow column (a wolf pixel with none
    below it, its row's run of wolf pixels, and the one above, no wider than PAW_RUN): one
    point (x, y) at the middle of each such bottom run (outside the head's block)."""
    W = np.isin(letters, list(WOLF + "?")) & ~head
    pts = []
    for y in range(1, W.shape[0] - 1):
        x = 0
        while x < W.shape[1]:
            if not W[y, x]:
                x += 1
                continue
            a = x
            while x < W.shape[1] and W[y, x]:
                x += 1
            b = x - 1                                     # the run a..b on row y
            if b - a + 1 > PAW_RUN:
                continue
            bottom = [xx for xx in range(a, b + 1) if not W[y + 1, xx]]
            up = [xx for xx in range(a, b + 1) if W[y - 1, xx]]
            if not bottom or not up:
                continue
            u0 = up[0]
            while u0 > 0 and W[y - 1, u0 - 1]:
                u0 -= 1
            u1 = up[-1]
            while u1 < W.shape[1] - 1 and W[y - 1, u1 + 1]:
                u1 += 1
            if u1 - u0 + 1 > PAW_RUN or len(bottom) < (b - a + 1):
                continue                                  # (a paw's whole run is its bottom)
            pts.append(((a + b) / 2 + 0.5, y + 0.5))
    return np.array(pts).reshape(-1, 2)


class Fitter:
    def __init__(self, model, art, shape):
        self.model, self.art, self.shape = model, art, dict(shape)
        self.casters = {v: wp.caster(F, L, model.origins[v]) for v, (_, F, L) in ROWS.items()}
        self.targets = {}
        for key, fr in art.frames.items():
            lt = fr["letters"]
            care = ~fr["head"] & (lt != "h")
            wolf = np.isin(lt, list(WOLF + "?"))
            self.targets[key] = (care, wolf, paw_points(lt, fr["head"]), fr["poll"])

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
        """One frame's loss; pose as its row draws it."""
        view = key[0]
        care, wolf, art_paws, poll = self.targets[key]
        mask, J, hooves = self.cover(view, pose)
        outline = float(((mask ^ wolf) & care).sum())
        H = np.array(list(hooves.values()))
        paws = 0.0
        if len(art_paws):
            d = np.sqrt(((art_paws[:, None, :] - H[None, :, :]) ** 2).sum(-1))
            paws = float(np.minimum(d.min(0), PAW_CAP).sum() + np.minimum(d.min(1), PAW_CAP).sum())
        pu = self.casters[view].screen(J["poll"])
        poll_l = float(((pu - poll) ** 2).sum()) + 4.0 * float(np.abs(np.round(pu - poll)).sum())
        lim = limit_penalty(pose, self.model, J)
        prior = pose_prior(pose)
        total = outline + 2.0 * paws + 8.0 * poll_l + LIMIT_WEIGHT * lim + PRIOR_WEIGHT * prior
        if parts:
            return total, {"outline": outline, "paws": paws, "poll": poll_l, "limits": lim, "prior": prior}
        return total

    def col_loss(self, col, pose):
        return sum(self.loss((v, col), view_pose(pose, v)) for v in ROWS if (v, col) in self.targets)

    def descend(self, col, pose, steps=(0.4, 0.2, 0.1, 0.05, 0.025), sweeps=4):
        pose = dict(pose)
        best = self.col_loss(col, pose)
        for st in steps:
            for _ in range(sweeps):
                improved = False
                for k in KEYS:
                    s = st * (2.5 if k in MOVES else 1.0)
                    for sign in (1, -1):
                        trial = dict(pose); trial[k] = pose.get(k, 0.0) + sign * s
                        l = self.col_loss(col, trial)
                        if l < best - 1e-9:
                            best, pose, improved = l, trial, True
                            break
                if not improved:
                    break
        return pose, best

    def fit_col(self, col, starts, rng, restarts=4):
        best = None
        for s in starts:
            p, l = self.descend(col, s)
            if best is None or l < best[1]:
                best = (p, l)
        for _ in range(restarts):
            trial = {k: v + rng.normal(0, 0.25 if k not in MOVES else 0.6) for k, v in best[0].items()}
            for k in KEYS:
                trial.setdefault(k, rng.normal(0, 0.2))
            p, l = self.descend(col, trial, steps=(0.2, 0.1, 0.05, 0.025))
            if l < best[1]:
                best = (p, l)
        return best

    def total(self, poses):
        return sum(self.col_loss(c, p) for c, p in poses.items())


def fit_shape(fitter, poses, steps=(0.6, 0.3, 0.15), sweeps=2):
    best = fitter.total(poses)
    for st in steps:
        for _ in range(sweeps):
            improved = False
            for k in wp.SHAPE0:
                for sign in (1, -1):
                    old = fitter.shape[k]
                    fitter.shape[k] = old + sign * st
                    lo, hi = wp.SHAPE_BOUNDS.get(k, (0.2 if not k.endswith((".f", ".z")) else -99, 99))
                    if not lo <= fitter.shape[k] <= hi:
                        fitter.shape[k] = old
                        continue
                    l = fitter.total(poses)
                    if l < best - 1e-9:
                        best, improved = l, True
                        break
                    fitter.shape[k] = old
            print("  shape step", st, "total", round(best, 1), flush=True)
            if not improved:
                break
    return best


_W = {}


def _init(cols, shape):
    _W["f"] = Fitter(wp.Model(), Art(cols), shape)


def _settle(args):
    """(column, pose, scales) -> (the pose settled on the skeleton so scaled, its loss)."""
    col, pose, scales = args
    f = _W["f"]
    if f.model.scales != scales:
        f.model.set_scales(scales)
    return f.descend(col, pose, steps=(0.1, 0.05), sweeps=2)


MARGIN = 0.003   # a length is changed only for a loss this much lower (as a share): the
                 # settling itself, repeated, lowers it a little whatever the length


def fit_skeleton(fitter, poses, steps=(0.1, 0.05), workers=2):
    """Each section's length (wolf_skeleton.SCALES) and the standing back's arch: the one
    skeleton that best fits every column given. A length tried, every column's pose settles to it (a short descent) before
    the columns' losses are summed: a pose fitted to one skeleton fits another worse until it
    has moved."""
    import multiprocessing as mp
    m = fitter.model
    cols = sorted(poses)
    with mp.Pool(workers, _init, (cols, fitter.shape)) as pool:
        def settle(scales):
            res = pool.map(_settle, [(c, poses[c], scales) for c in cols])
            return {c: p for c, (p, _) in zip(cols, res)}, sum(l for _, l in res)
        poses, best = settle(dict(m.scales))
        print("  settled on the start:", round(best, 1), flush=True)
        for st in steps:
            improved = True
            while improved:
                improved = False
                for k in list(sk.SCALES) + ["arch"]:
                    for sign in (1, -1):
                        if k == "arch":
                            new = round(m.scales.get(k, wp.ARCH0) + sign * st * 5, 3)
                            lo, hi = ARCH_LIMITS
                        else:
                            new = round(m.scales.get(k, 1.0) + sign * st, 3)
                            lo, hi = SCALE_LIMITS
                        if not lo <= new <= hi:
                            continue
                        trial = {**m.scales, k: new}
                        tp, l = settle(trial)
                        if l < best * (1 - MARGIN):
                            best, poses, improved = l, tp, True
                            m.set_scales(trial)
                            print(f"  {k} {new}: {round(best, 1)}", flush=True)
                            break
            print("  skeleton step", st, "total", round(best, 1),
                  {k: round(v, 3) for k, v in m.scales.items()}, flush=True)
    return best, poses


def parse_cols(s):
    out = []
    for part in s.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b) + 1)) if b else [int(a)]
    return out


def save(path, shape, skeleton, poses, rules=None):
    d = {"shape": shape, "skeleton": skeleton, "poses": {str(c): p for c, p in sorted(poses.items())}}
    if rules:
        d["rules"] = rules
    Path(path).write_text(json.dumps(d, indent=1))


def load(path):
    """(shape, skeleton scales, poses by column, rule numbers)."""
    d = json.loads(Path(path).read_text())
    shape = dict(wp.SHAPE0); shape.update(d["shape"])
    return shape, d.get("skeleton", {}), {int(c): p for c, p in d["poses"].items()}, d.get("rules", {})


def frames(poses):
    """Every frame's pose as its row draws it: {(view, column): pose}."""
    return {(v, c): view_pose(p, v) for c, p in poses.items() for v in ROWS}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--restarts", type=int, default=4)
    ap.add_argument("--start", type=Path)
    ap.add_argument("--shape", action="store_true", help="fit the solids' sizes, the poses held")
    ap.add_argument("--skeleton", action="store_true", help="fit the sections' lengths, the poses held")
    ap.add_argument("--cols", default="0-11")
    args = ap.parse_args()
    cols = parse_cols(args.cols)
    shape, skeleton, poses, rules = dict(wp.SHAPE0), {}, {}, {}
    if args.start:
        shape, skeleton, poses, rules = load(args.start)
    shape = wp.bounded(shape)
    model, art = wp.Model(skeleton), Art(cols)
    fitter = Fitter(model, art, shape)
    if args.shape or args.skeleton:
        held = {c: p for c, p in poses.items() if c in cols}
        print("start total", round(fitter.total(held), 1))
        if args.skeleton:
            _, held = fit_skeleton(fitter, held)
            poses.update(held)
            for k, v in sk.section_lengths(model.rest).items():
                print(f"  {k:5} {v:5.2f}  ({sk.SCALES[k]})")
        if args.shape:
            fit_shape(fitter, held)
        save(args.out, fitter.shape, model.scales, poses, rules)
        print("wrote", args.out)
        return
    rng = np.random.default_rng(1)
    prev = None
    for col in cols:
        starts = [{}] + ([prev] if prev is not None else []) + ([poses[col]] if col in poses else [])
        pose, l = fitter.fit_col(col, starts, rng, args.restarts)
        poses[col] = pose
        prev = pose
        print(col, round(l, 1), {v: {k: round(x, 1) for k, x in fitter.loss((v, col), view_pose(pose, v), True)[1].items()}
                                 for v in ROWS}, flush=True)
        save(args.out, fitter.shape, model.scales, poses, rules)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
