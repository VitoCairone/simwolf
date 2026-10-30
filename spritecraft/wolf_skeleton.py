#!/usr/bin/env python3
"""The wolf's skeleton in true space, reverse-engineered from the artist's standing wolf
(images/wolf-land.png), and checked by projecting it back onto the sprites. The wolf's
counterpart of deer_skeleton.py, with the same projection and axes.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/wolf_skeleton.py                 # fit, print measurements and errors
    python3 spritecraft/wolf_skeleton.py --overlay o.png # the fitted skeleton over the sprites
    python3 spritecraft/wolf_skeleton.py --wire w.png    # the skeleton in all 8 facings

PROJECTION (deer_skeleton.py): u = x - y, v = (x + y) / 2 - z, in sprite pixels; the wolf's
own axes f forward, s left (its left side), z up; facing grid direction F, left L.

THE FRAMES READ: the idle's first frame, column 8, in the two facings the artist drew:
row 1 facing grid E (screen down-right), row 0 grid N (up-right). Both show its left side.
In both the wolf stands, its head held high and turned toward the screen's side.
LANDMARKS (pixel centres, read by eye from the 64 x 64 frames; see READINGS):
    feet          the bottom pixel of each paw
    hip           the top of the body above the hind legs
    back          the top of the body midway between the hind and front feet (E only: in
                  the N view the neck hides it)
    belly, chest  the bottom of the body below the hind and the front legs
    breast        the front of the chest (the pale bib's foremost pixels)
    tail          the tail's tip (its root is hidden in the rump's fur: placed by WOLF_TAIL_ROOT)
    poll          the back of the head, where the neck's spine ends
    crown         the top of the head between the ears
    eye           the near (left) eye
    nose          the tip of the nose
Neither view shows the withers (the raised head hides them); the skeleton places them
from a wolf's proportions (WOLF_*).
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import deer_skeleton as dsk

PROJECT = Path(__file__).resolve().parent.parent
FW, FH = 64, 64
SHEET = "images/wolf-land.png"
STAND_COL = 8

VIEWS = {
    "E": (1, (1, 0), (0, 1)),
    "N": (0, (0, -1), (1, 0)),
}

c = lambda x, y: (x + 0.5, y + 0.5)
READINGS = {
    "E": {
        "footHL": c(22, 39), "footHR": c(27, 37), "footFL": c(33, 44), "footFR": c(38, 42),
        "hip": c(24, 27), "back": c(30, 28), "belly": c(24, 34), "chest": c(35, 36),
        "breast": c(40, 31), "tail": c(19, 29),
        "poll": c(34, 24), "crown": c(37, 21), "eye": c(38, 24), "nose": c(43, 26),
    },
    "N": {
        "footHL": c(29, 46), "footHR": c(25.5, 44), "footFL": c(40.5, 41), "footFR": c(35, 39),
        "hip": c(27, 31), "belly": c(27, 37), "chest": c(38, 35),
        "breast": c(42, 30), "tail": c(17, 42),
        "poll": c(35, 23), "crown": c(38.5, 20), "eye": c(43, 22), "nose": c(46, 22),
    },
}

EYE_S = 1.2                        # the eyes' half-spacing (unseen by the fit: one side shows)
PARAMS = ["fH", "sH", "fF", "sF", "zHip", "zBack", "zBelly", "zChest", "fBreast", "zBreast",
          "fTail", "zTail", "fPoll", "zPoll", "fCrown", "zCrown", "fEye", "zEye", "fNose", "zNose"]
MODEL = {
    "footHL": ("fH", "sH", 0), "footHR": ("fH", (-1, "sH"), 0),
    "footFL": ("fF", "sF", 0), "footFR": ("fF", (-1, "sF"), 0),
    "hip": ("fH", 0, "zHip"), "back": (0, 0, "zBack"), "belly": ("fH", 0, "zBelly"),
    "chest": ("fF", 0, "zChest"), "breast": ("fBreast", 0, "zBreast"),
    "tail": ("fTail", 0, "zTail"),
    "poll": ("fPoll", 0, "zPoll"), "crown": ("fCrown", 0, "zCrown"),
    "eye": ("fEye", EYE_S, "zEye"), "nose": ("fNose", 0, "zNose"),
}
HEAD = {"poll", "crown", "eye", "nose"}


def term(t, n):
    row = np.zeros(n)
    if isinstance(t, str):
        row[PARAMS.index(t)] = 1
        return row, 0.0
    if isinstance(t, tuple):
        row[PARAMS.index(t[1])] = t[0]
        return row, 0.0
    return row, float(t)


def fit(yaws=None):
    """Least squares over PARAMS and each view's origin, the head turned by yaws[view]
    (radians, to the wolf's left) about the front feet's line (f = fF); as
    deer_skeleton.fit."""
    yaws = yaws or {v: 0.0 for v in VIEWS}
    views = list(VIEWS)
    n = len(PARAMS) + 2 * len(views)
    A, b = [], []
    for vi, view in enumerate(views):
        _, F, L = VIEWS[view]
        for name, (u, v) in READINGS[view].items():
            ft, st, zt = MODEL[name]
            rf, cf = term(ft, n)
            rs, cs = term(st, n)
            rz, cz = term(zt, n)
            if name in HEAD:
                co, si = np.cos(yaws[view]), np.sin(yaws[view])
                rW, _ = term("fF", n)
                rf, rs, cf, cs = (rW + (rf - rW) * co - rs * si, (rf - rW) * si + rs * co,
                                  cf * co - cs * si, cf * si + cs * co)
            ru = rf * (F[0] - F[1]) + rs * (L[0] - L[1])
            rv = rf * (F[0] + F[1]) / 2 + rs * (L[0] + L[1]) / 2 - rz
            ru[len(PARAMS) + 2 * vi] = 1
            rv[len(PARAMS) + 2 * vi + 1] = 1
            A += [ru, rv]
            b += [u - (cf * (F[0] - F[1]) + cs * (L[0] - L[1])),
                  v - (cf * (F[0] + F[1]) / 2 + cs * (L[0] + L[1]) / 2 - cz)]
    A, b = np.array(A), np.array(b)
    gauge = np.zeros(n); gauge[PARAMS.index("fH")] = 1; gauge[PARAMS.index("fF")] = 1
    A = np.vstack([A, gauge * 100]); b = np.append(b, 0)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    p = dict(zip(PARAMS, sol[:len(PARAMS)]))
    origins = {view: sol[len(PARAMS) + 2 * vi: len(PARAMS) + 2 * vi + 2] for vi, view in enumerate(views)}
    return p, origins, float(np.sum((A[:-1] @ sol - b[:-1]) ** 2))


def fit_yaws():
    """The head's turn that best fits: toward the screen's profile by the same angle in both
    views (to the wolf's right facing E, its left facing N; searched by degrees): the
    artist's habit on the diagonals, as the deer's (deer_pixels: diag.head_yaw). (Free in
    each view, the fit turns the head 3 and 78 degrees, a little closer to the art.)"""
    best = None
    for a in range(0, 91):
        yaws = {"E": -np.radians(a), "N": np.radians(a)}
        p, o, err = fit(yaws)
        if best is None or err < best[3]:
            best = (p, o, yaws, err)
    return best


def point(p, name):
    def val(t):
        if isinstance(t, str): return p[t]
        if isinstance(t, tuple): return t[0] * p[t[1]]
        return t
    return tuple(val(t) for t in MODEL[name])


def screen(p, origins, view, name, yaws=None):
    _, F, L = VIEWS[view]
    f, s, z = point(p, name)
    if yaws and name in HEAD:
        co, si = np.cos(yaws[view]), np.sin(yaws[view])
        f, s = p["fF"] + (f - p["fF"]) * co - s * si, (f - p["fF"]) * si + s * co
    return dsk.to_screen((f, s, z), F, L, origins[view])


# THE INFERRED SKELETON. As the deer's (deer_skeleton.py): the sprites show the legs below
# the body as sticks, the upper legs inside the body's silhouette; the joints are placed by
# a grey wolf's proportions (withers about 0.75 m; approximate), fitted to the art's body:
# a height below the underline (brisket, flank) in proportion to it, above it between the
# underline and the topline; fore-and-aft and sideways offsets in a wolf's centimetres at the
# art's scale (its paw-to-paw length against WOLF_PAWS_CM). A wolf walks on its toes: the
# "fetlock" here is the joint at the top of the toes (the metacarpo- and metatarso-
# phalangeal joints, as a deer's fetlock), the "hoof" the paw's middle on the ground; its
# carpus (wrist) and hock are high, its cannons (metacarpus, metatarsus) long.
#   joint: (height as a share of withers, forward of the leg's paw in cm, out from the midline in cm)
WOLF_FORE = {
    "scapula": (0.95, -10, 6),     # top of the shoulder blade
    "shoulder": (0.66, 8, 10),     # point of the shoulder
    "elbow": (0.47, -4, 9),
    "carpus": (0.20, 1, None),
    "fetlockF": (0.05, -1, None),
}
WOLF_HIND = {
    "coxa": (0.93, 8, 11),         # point of the hip: the wing of the pelvis
    "hipjoint": (0.77, -6, 9),
    "ischium": (0.79, -16, 6),     # the seat bone
    "stifle": (0.52, 7, 10),
    "hock": (0.27, -9, None),
    "fetlockH": (0.05, -1, None),
}
WOLF_UNDERLINE = 0.48              # brisket height, as a share of withers
WOLF_PAWS_CM = 60                  # hind paws to fore paws, standing square
WOLF_WITHERS_OVER_HIP = 1.04       # withers height over the croup's
WOLF_TAIL_ROOT = (0.92, -14)       # the tail's root: share of the croup's height, cm forward of the hind paws

SIDES = dsk.SIDES
BONES = ([("tail", "tailroot"), ("tailroot", "sacrum"), ("sacrum", "withers"), ("withers", "poll"),
          ("poll", "crown"), ("crown", "nose"), ("poll", "nose")]
         + [(a + x, b + x) for x in SIDES for a, b in [
             ("sacrum", "coxa"), ("coxa", "hipjoint"), ("hipjoint", "ischium"), ("ischium", "sacrum"),
             ("hipjoint", "stifle"), ("stifle", "hock"), ("hock", "fetlockH"), ("fetlockH", "hoofH"),
             ("scapula", "shoulder"), ("shoulder", "elbow"), ("elbow", "carpus"), ("carpus", "fetlockF"),
             ("fetlockF", "hoofF")]])
SOFT = dsk.SOFT
BONES = [(dsk._midline(a), dsk._midline(b)) for a, b in BONES]


def withers_height(p):
    return p["zHip"] * WOLF_WITHERS_OVER_HIP


def joints(p, yaw=0.0):
    """Every joint, name -> (f, s, z), the head turned by yaw about f = fF."""
    cm = (p["fF"] - p["fH"]) / WOLF_PAWS_CM
    zW = withers_height(p)

    def height(share, under, top):
        return share / WOLF_UNDERLINE * under if share <= WOLF_UNDERLINE else \
            under + (share - WOLF_UNDERLINE) / (1 - WOLF_UNDERLINE) * (top - under)

    J = {"tail": (p["fTail"], 0, p["zTail"]),
         "tailroot": (p["fH"] + WOLF_TAIL_ROOT[1] * cm, 0, p["zHip"] * WOLF_TAIL_ROOT[0]),
         "sacrum": (p["fH"], 0, p["zHip"]), "withers": (p["fF"] - 6 * cm, 0, zW)}
    head = {"poll": (p["fPoll"], 0, p["zPoll"]), "crown": (p["fCrown"], 0, p["zCrown"]),
            "nose": (p["fNose"], 0, p["zNose"]),
            "eyeL": (p["fEye"], EYE_S, p["zEye"]), "eyeR": (p["fEye"], -EYE_S, p["zEye"])}
    co, si = np.cos(yaw), np.sin(yaw)
    for n, (f, s, z) in head.items():
        J[n] = (p["fF"] + (f - p["fF"]) * co - s * si, (f - p["fF"]) * si + s * co, z)
    for x, side in SIDES.items():
        for table, f0, s0, under, top, hoof in ((WOLF_FORE, p["fF"], p["sF"], p["zChest"], zW, "hoofF"),
                                                (WOLF_HIND, p["fH"], p["sH"], p["zBelly"], p["zHip"], "hoofH")):
            J[hoof + x] = (f0, side * s0, 0.0)
            for n, (share, fwd, out) in table.items():
                J[n + x] = (f0 + fwd * cm, side * (s0 if out is None else out * cm), height(share, under, top))
    return {n: np.array(v, float) for n, v in J.items()}


# THE ONE WIREFRAME. The joints above are where the idle frames put them; the lengths of the
# skeleton's sections are then fitted to the artist's frames (wolf_runfit.py --skeleton), as a
# scale on each (1: as above): every column's pose refitted (briefly) to each length tried.
# Fitted to the idle's 4 columns alone, to the run's 8 alone, and to all 12, the lengths agree
# but for two: the tail (idle 1.15, run 1.3, all 1.3) and the hind cannon (idle 1, run 1.15,
# all 1.1); the rest stay as the idle put them (a change of 0.05 moves no fit by 0.3%). With
# the back jointed (wolf_pose.Model: THE BACK), refitted to all: the tail 1.25, the hind cannon
# 1, the standing back's arch 1 (an arch of 3, which lets the back straighten to 23% longer
# than standing, fits the stretched-out gallop frames only 2% better, and the rest no better).
# The poses file keeps the fit to all (its "skeleton"). Every pose moves this one skeleton: no
# section changes length from pose to pose.
SCALES = {
    "back": "the back: withers to sacrum (the hind quarters move along it)",
    "neck": "the neck: withers to poll (the head moves with the poll)",
    "scap": "the shoulder blade", "hum": "the upper arm", "rad": "the forearm",
    "fcan": "the fore cannon and toes (carpus to paw)",
    "fem": "the thigh", "tib": "the shank", "hcan": "the hind cannon and toes (hock to paw)",
    "tail": "the tail",
}
HIND_GROUP = ["sacrum", "tailroot", "tail"] + [n + x for x in SIDES for n in
                                               ("coxa", "hipjoint", "ischium", "stifle", "hock", "fetlockH", "hoofH")]
HEAD_GROUP = ["poll", "crown", "nose", "eyeL", "eyeR"]
CHAINS = {  # (joints from the top down, the scale of each section)
    "F": (["scapula", "shoulder", "elbow", "carpus", "fetlockF", "hoofF"], ["scap", "hum", "rad", "fcan", "fcan"]),
    "H": (["hipjoint", "stifle", "hock", "fetlockH", "hoofH"], ["fem", "tib", "hcan", "hcan"]),
}


def scaled(J, scales=None):
    """The joints J with each section's length scaled (SCALES; a missing key: 1)."""
    k = lambda n: (scales or {}).get(n, 1.0)
    J = {n: np.array(v, float) for n, v in J.items()}
    d = (k("back") - 1) * (J["sacrum"] - J["withers"]) * np.array([1.0, 0, 0])
    for n in HIND_GROUP:
        J[n] = J[n] + d
    poll = J["withers"] + (J["poll"] - J["withers"]) * k("neck")
    dh = poll - J["poll"]
    for n in HEAD_GROUP:
        J[n] = J[n] + dh
    J["tail"] = J["tailroot"] + (J["tail"] - J["tailroot"]) * k("tail")
    for x in SIDES:
        for names, keys in CHAINS.values():
            old = [J[n + x].copy() for n in names]
            for i in range(1, len(names)):
                J[names[i] + x] = J[names[i - 1] + x] + (old[i] - old[i - 1]) * k(keys[i - 1])
    return J


def section_lengths(J):
    """Each section's length (the left side's), true-space units."""
    d = lambda a, b: float(np.linalg.norm(J[a] - J[b]))
    out = {"back": d("withers", "sacrum"), "neck": d("withers", "poll"), "tail": d("tailroot", "tail")}
    for names, keys in CHAINS.values():
        for i in range(1, len(names)):
            out[keys[i - 1]] = out.get(keys[i - 1], 0.0) + d(names[i - 1] + "L", names[i] + "L")
    return out


def measurements(p):
    d = lambda a, b: float(np.linalg.norm(np.subtract(a, b)))
    return {
        "paws, hind to fore": p["fF"] - p["fH"],
        "paws apart (hind, fore)": (2 * p["sH"], 2 * p["sF"]),
        "body bottom (belly, chest), top (hip, back)": (p["zBelly"], p["zChest"], p["zHip"], p["zBack"]),
        "breast forward of the fore paws": p["fBreast"] - p["fF"],
        "tail's tip (f, z)": (p["fTail"], p["zTail"]),
        "poll (f, z), above the back": ((p["fPoll"], p["zPoll"]), p["zPoll"] - p["zBack"]),
        "poll to nose": d((p["fPoll"], 0, p["zPoll"]), (p["fNose"], 0, p["zNose"])),
        "eye: back from nose, out, up from nose": (p["fNose"] - p["fEye"], EYE_S, p["zEye"] - p["zNose"]),
    }


def draw_skeleton(d, J, place, S, near_side):
    P = {n: place(q) * S for n, q in J.items()}
    far = "R" if near_side == "L" else "L"
    order = sorted(BONES, key=lambda e: 0 if e[0].endswith(far) or e[1].endswith(far) else 1)
    for a, b in SOFT:
        d.line([tuple(P[a]), tuple(P[b])], fill=dsk.SOFTC, width=1)
    for a, b in order:
        col = dsk.FAR if a.endswith(far) or b.endswith(far) else dsk.NEAR if a[-1] in SIDES and a != "sacrum" else dsk.HEADC
        d.line([tuple(P[a]), tuple(P[b])], fill=col, width=max(1, S // 4))
    for n, q in P.items():
        r = max(2, S // 4)
        d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=dsk.FAR if n.endswith(far) and n != "sacrum" else (0, 0, 0))


def overlay(p, origins, out, yaws, crop=(8, 10, 54, 52)):
    sheet = Image.open(PROJECT / SHEET).convert("RGBA")
    S = 12
    x0, y0, x1, y1 = crop
    panels = []
    for view, (row, F, L) in VIEWS.items():
        fr = sheet.crop((STAND_COL * FW, row * FH, (STAND_COL + 1) * FW, (row + 1) * FH))
        bg = Image.new("RGBA", fr.size, (120, 170, 90, 255)); bg.alpha_composite(fr)
        big = bg.resize((FW * S, FH * S), Image.NEAREST)
        d = ImageDraw.Draw(big)
        draw_skeleton(d, joints(p, yaws[view]), lambda q: dsk.to_screen(q, F, L, origins[view]), S, "L")
        for n, (u, v) in READINGS[view].items():
            d.ellipse([u * S - 6, v * S - 6, u * S + 6, v * S + 6], outline=(255, 255, 0, 255), width=2)
            q = screen(p, origins, view, n, yaws) * S
            d.line([(u * S, v * S), tuple(q)], fill=(255, 255, 0, 255), width=2)
        panels.append(big.crop((x0 * S, y0 * S, x1 * S, y1 * S)))
    img = Image.new("RGBA", (sum(x.width for x in panels) + 20, panels[0].height), (255, 255, 255, 255))
    x = 0
    for pnl in panels:
        img.paste(pnl, (x, 0)); x += pnl.width + 20
    img.save(out)


FACINGS = dsk.FACINGS
GROUND = (32, 39)                  # the critter's position in a frame (animat.js: topToShadow 39)


def wireframe(p, out, position_f=0.0, scales=None):
    S = 8
    order = list(FACINGS)
    img = Image.new("RGB", (len(order) * (FW * S + 10), FH * S), (235, 235, 235))
    d = ImageDraw.Draw(img)
    J = scaled(joints(p), scales)
    for k, fc in enumerate(order):
        F, L = (np.array(v, float) for v in FACINGS[fc])
        ox = k * (FW * S + 10)
        d.rectangle([ox, 0, ox + FW * S, FH * S], outline=(180, 180, 180))
        uv0 = np.array(GROUND, float) - dsk.to_screen((position_f, 0, 0), F, L, (0, 0)) + np.array([ox / S, 0])
        draw_skeleton(d, J, lambda q: dsk.to_screen(q, F, L, uv0), S, dsk.near_side(F, L))
    img.save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--overlay", type=Path)
    ap.add_argument("--wire", type=Path)
    args = ap.parse_args()
    p, origins, err0 = fit()
    print("head straight ahead in both views: squared error", round(err0, 1))
    p, origins, yaws, err = fit_yaws()
    print("head turned:", {k: round(float(np.degrees(v))) for k, v in yaws.items()}, "degrees (to its left); squared error", round(err, 1))
    for k in PARAMS: print(f"  {k:8} {p[k]:7.2f}")
    print("ground points of the frames (u, v):", {k: tuple(np.round(v, 2)) for k, v in origins.items()})
    for k, v in measurements(p).items():
        print(f"  {k}: {np.round(v, 2) if not isinstance(v, tuple) else v}")
    worst = 0
    for view in VIEWS:
        errs = {n: float(np.linalg.norm(screen(p, origins, view, n, yaws) - READINGS[view][n])) for n in READINGS[view]}
        worst = max(worst, *errs.values())
        print(f"  {view}: " + ", ".join(f"{n} {e:.2f}" for n, e in errs.items()))
    print(f"  worst {worst:.2f}")
    if args.overlay:
        overlay(p, origins, args.overlay, yaws)
        print("wrote", args.overlay)
    import json
    poses = Path(__file__).resolve().parent / "wolf_poses.json"
    scales = json.loads(poses.read_text()).get("skeleton", {}) if poses.exists() else {}
    J0 = joints(p)
    print("sections (true-space units): as the idle fit puts them, and the one skeleton (wolf_poses.json):")
    for k, v in section_lengths(J0).items():
        print(f"  {k:5} {v:5.2f} {section_lengths(scaled(J0, scales))[k]:5.2f}  {SCALES[k]}")
    if args.wire:
        wireframe(p, args.wire, scales=scales)
        print("wrote", args.wire)


if __name__ == "__main__":
    main()
