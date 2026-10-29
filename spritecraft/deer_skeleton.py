#!/usr/bin/env python3
"""The red deer's skeleton in true space, reverse-engineered from the artist's standing
stag (images/deer-land.png), and checked by projecting it back onto the sprites.

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/deer_skeleton.py                 # fit, print measurements and errors
    python3 spritecraft/deer_skeleton.py --overlay o.png # also draw the projected skeleton
                                                         # over the sprites, enlarged
    python3 spritecraft/deer_skeleton.py --wire w.png    # the whole skeleton in all 8 facings

PROJECTION (as spritecraft/isomet-render.html): a point (x, y, z) in true space, x and y
along the map's grid axes and z up, lands on screen at
    u = x - y,   v = (x + y) / 2 - z
in sprite pixels. So a unit of true space is a pixel of height; a grid axis is drawn at
2:1. The deer's own axes: forward f, left s (its left side), up z. Facing grid direction
F (a unit grid vector), with L its left (F turned a quarter clockwise on the map seen
from above, as the grid's y axis points down-left on screen), a body point (f, s, z)
is at origin + f F + s L in the grid.

THE FRAMES READ: the idle sequence's straight-ahead standing pose, column 27, in the two
facings the artist drew (the other two are these mirrored): row 1 facing grid E
(screen down-right) and row 0 facing grid N (up-right). Both show the deer's left side.
LANDMARKS (pixel centres, read by eye from the 32 x 41 frames; see READINGS):
    feet          where each hoof meets the ground: the bottom pixel of each leg
    hip, withers  the top of the body (the spine) above the hind and the front legs
    belly, chest  the bottom of the body below the hind and the front legs
    tail          the tip of the tail
    poll          the back of the head, where the neck's spine ends
    crown         the top-centre of the head, between the antlers' bases
    eye           the near (left) eye
    nose          the tip of the nose
The body points lie on its midline (s = 0), the feet on the ground (z = 0), and the
model is left-right symmetric; with two views of each point, the fit (least squares) is
over-determined, and its errors on reprojection say how far the art departs from one
rigid 3D deer (pixel art is drawn by eye, a pixel at a time).
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

PROJECT = Path(__file__).resolve().parent.parent
FW, FH = 32, 41

# facing: (sheet row, F, L) with F, L grid unit vectors
VIEWS = {
    "E": (1, (1, 0), (0, 1)),
    "N": (0, (0, -1), (1, 0)),
}

# READINGS: (u, v) pixel centres, by view (+0.5 is the centre of a pixel's cell)
c = lambda x, y: (x + 0.5, y + 0.5)
READINGS = {
    "E": {
        "footHL": c(7, 33), "footHR": c(10, 32), "footFL": c(16, 37), "footFR": c(17, 35),
        "hip": c(8.5, 19), "belly": c(8.5, 28), "withers": c(15.5, 21), "chest": c(16.5, 29.5),
        "tail": c(2, 17), "poll": c(17, 16), "crown": c(19.5, 15.5), "eye": c(19, 16.5),
        "nose": c(24, 17),
    },
    "N": {
        "footHL": c(10, 37), "footHR": c(7, 36), "footFL": c(17, 33), "footFR": c(15, 31),
        "hip": c(8.5, 21), "belly": c(8.5, 30), "withers": c(14.5, 20), "chest": c(16, 29.5),
        "tail": c(2, 23.5), "poll": c(15, 15), "crown": c(17, 13.5), "eye": c(19, 17),
        "nose": c(24, 18),
    },
}

# The model's unknowns, and each landmark in terms of them: (f, s, z), each a name of an
# unknown, a number, or a (sign, name) pair.
PARAMS = ["fH", "sH", "fF", "sF", "zHip", "zBelly", "zWithers", "zChest", "fTail", "zTail",
          "fPoll", "zPoll", "fCrown", "zCrown", "fEye", "sEye", "zEye", "fNose", "zNose"]
MODEL = {
    "footHL": ("fH", "sH", 0), "footHR": ("fH", (-1, "sH"), 0),
    "footFL": ("fF", "sF", 0), "footFR": ("fF", (-1, "sF"), 0),
    "hip": ("fH", 0, "zHip"), "belly": ("fH", 0, "zBelly"),
    "withers": ("fF", 0, "zWithers"), "chest": ("fF", 0, "zChest"),
    "tail": ("fTail", 0, "zTail"), "poll": ("fPoll", 0, "zPoll"), "crown": ("fCrown", 0, "zCrown"),
    "eye": ("fEye", "sEye", "zEye"), "nose": ("fNose", 0, "zNose"),
}


def term(t, n):
    """t as a coefficient row over PARAMS (and a constant)."""
    row = np.zeros(n)
    if isinstance(t, str):
        row[PARAMS.index(t)] = 1
        return row, 0.0
    if isinstance(t, tuple):
        row[PARAMS.index(t[1])] = t[0]
        return row, 0.0
    return row, float(t)


def project(f, s, z, F, L, origin):
    x = origin[0] + f * F[0] + s * L[0]
    y = origin[1] + f * F[1] + s * L[1]
    return np.array([x - y, (x + y) / 2 - z])


HEAD = {"poll", "crown", "eye", "nose"}


def fit(yaws=None):
    """Least squares over PARAMS and each view's origin (its ground point, in grid units
    relative to the frame's: u0, v0), with the neck and head turned by yaws[view] (radians,
    to the deer's left) about the withers."""
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
            if name in HEAD:  # turned about the withers: f' = fF + (f-fF) cos - s sin, s' = (f-fF) sin + s cos
                co, si = np.cos(yaws[view]), np.sin(yaws[view])
                rW, _ = term("fF", n)
                rf, rs, cf, cs = (rW + (rf - rW) * co - rs * si, (rf - rW) * si + rs * co,
                                  cf * co - cs * si, cf * si + cs * co)
            # u = (f F + s L).x - (...).y + u0 ;  v = ((...).x + (...).y) / 2 - z + v0
            ru = rf * (F[0] - F[1]) + rs * (L[0] - L[1])
            rv = rf * (F[0] + F[1]) / 2 + rs * (L[0] + L[1]) / 2 - rz
            ru[len(PARAMS) + 2 * vi] = 1
            rv[len(PARAMS) + 2 * vi + 1] = 1
            A += [ru, rv]
            b += [u - (cf * (F[0] - F[1]) + cs * (L[0] - L[1])),
                  v - (cf * (F[0] + F[1]) / 2 + cs * (L[0] + L[1]) / 2 - cz)]
    A, b = np.array(A), np.array(b)
    # gauge: f is measured from the midpoint between the hind and front feet
    gauge = np.zeros(n); gauge[PARAMS.index("fH")] = 1; gauge[PARAMS.index("fF")] = 1
    A = np.vstack([A, gauge * 100]); b = np.append(b, 0)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    p = dict(zip(PARAMS, sol[:len(PARAMS)]))
    origins = {view: sol[len(PARAMS) + 2 * vi: len(PARAMS) + 2 * vi + 2] for vi, view in enumerate(views)}
    return p, origins, float(np.sum((A[:-1] @ sol - b[:-1]) ** 2))


def fit_yaws():
    """The head's turn in each view that best fits (searched by degrees)."""
    best = None
    for a in range(-90, 91, 3):
        for b in range(-90, 91, 3):
            yaws = {"E": np.radians(a), "N": np.radians(b)}
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
    uv0 = origins[view]
    return np.array([f * (F[0] - F[1]) + s * (L[0] - L[1]), f * (F[0] + F[1]) / 2 + s * (L[0] + L[1]) / 2 - z]) + uv0


def measurements(p):
    """The lengths asked for, in true-space units (a pixel of height)."""
    d = lambda a, b: float(np.linalg.norm(np.subtract(a, b)))
    hip, withers = (p["fH"], 0, p["zHip"]), (p["fF"], 0, p["zWithers"])
    tail, poll = (p["fTail"], 0, p["zTail"]), (p["fPoll"], 0, p["zPoll"])
    nose, crown, eye = (p["fNose"], 0, p["zNose"]), (p["fCrown"], 0, p["zCrown"]), (p["fEye"], p["sEye"], p["zEye"])
    return {
        "foot to bottom of body (hind, front)": (p["zBelly"], p["zChest"]),
        "foot to top of body (hind, front)": (p["zHip"], p["zWithers"]),
        "spine, hips to shoulders": d(hip, withers),
        "spine, hips to tail tip": d(hip, tail),
        "spine in the neck (withers to poll)": d(withers, poll),
        "end of spine (poll) to nose tip": d(poll, nose),
        "nose tip to crown: along the body, across it (up)": (p["fNose"] - p["fCrown"], p["zCrown"] - p["zNose"]),
        "nose tip to eye: along the body, sideways, up": (p["fNose"] - p["fEye"], p["sEye"], p["zEye"] - p["zNose"]),
        "feet apart (hind, front)": (2 * p["sH"], 2 * p["sF"]),
    }


# THE INFERRED SKELETON. The sprites draw only the lowest part of each leg as a stick (the
# pastern, the cannon and a little above); the upper leg is body-coloured, unoutlined, inside
# the body's silhouette. So the joints are placed by a real red deer stag's proportions
# (withers about 1.2 m; approximate), fitted to the art's own body, whose chest and belly
# are deeper and legs shorter than life: a height is mapped piecewise, below the body's
# underline (brisket, flank) in proportion to it, above it between the underline and the
# topline. Fore-and-aft and sideways offsets are a stag's centimetres at the art's length
# scale (its hoof-to-hoof length, fF - fH, against a stag's STAG_HOOVES_CM).
# Shoulders and hips are on the sides of the body, not on the spine: the shoulder blade is
# slung in muscle beside the withers (no joint with the spine); the hip joints are in the
# pelvis, which hangs from the spine at the sacrum (the art's "hip" landmark).
#   joint: (height as a share of withers, forward of the leg's hoof in cm, out from the midline in cm)
STAG_FORE = {
    "scapula": (0.88, -8, 8),      # top of the shoulder blade
    "shoulder": (0.67, 12, 14),    # point of the shoulder: the shoulder joint
    "elbow": (0.53, -4, 12),
    "carpus": (0.30, 1, None),     # the foreleg's "knee" (the wrist); None: as the hoof
    "fetlockF": (0.09, -4, None),
}
STAG_HIND = {
    "coxa": (0.92, 10, 18),        # point of the hip: the wing of the pelvis
    "hipjoint": (0.77, -6, 15),
    "ischium": (0.82, -24, 8),     # pin bone
    "stifle": (0.58, 10, 16),      # the hind "knee"
    "hock": (0.36, -10, None),
    "fetlockH": (0.09, -4, None),
}
STAG_UNDERLINE = 0.52              # brisket and flank height, as a share of withers
STAG_HOOVES_CM = 75                # hind hooves to fore hooves, standing square
EYE_S = 1.0                        # the eyes' half-spacing (both views show one side: the fit can't see it)

SIDES = {"L": 1, "R": -1}
BONES = ([("tail", "sacrum"), ("sacrum", "withers"), ("withers", "poll"), ("poll", "crown"),
          ("crown", "nose"), ("poll", "nose")]
         + [(a + x, b + x) for x in SIDES for a, b in [
             ("sacrum", "coxa"), ("coxa", "hipjoint"), ("hipjoint", "ischium"), ("ischium", "sacrum"),
             ("hipjoint", "stifle"), ("stifle", "hock"), ("hock", "fetlockH"), ("fetlockH", "hoofH"),
             ("scapula", "shoulder"), ("shoulder", "elbow"), ("elbow", "carpus"), ("carpus", "fetlockF"),
             ("fetlockF", "hoofF")]])
SOFT = ([("scapula" + x, "withers") for x in SIDES]                 # muscle, not bone
        + [("shoulderL", "shoulderR"), ("hipjointL", "hipjointR")])  # across the body, for reading depth
_midline = lambda n: n[:-1] if n[:-1] == "sacrum" else n  # the sacrum is one, on the midline
BONES = [(_midline(a), _midline(b)) for a, b in BONES]


def joints(p, yaw=0.0):
    """Every joint of the skeleton, name -> (f, s, z), with the neck and head turned by
    yaw (radians, to the deer's left) about the withers."""
    cm = (p["fF"] - p["fH"]) / STAG_HOOVES_CM

    def height(share, under, top):
        return share / STAG_UNDERLINE * under if share <= STAG_UNDERLINE else \
            under + (share - STAG_UNDERLINE) / (1 - STAG_UNDERLINE) * (top - under)

    J = {"tail": (p["fTail"], 0, p["zTail"]), "sacrum": (p["fH"], 0, p["zHip"]),
         "withers": (p["fF"], 0, p["zWithers"])}
    head = {"poll": (p["fPoll"], 0, p["zPoll"]), "crown": (p["fCrown"], 0, p["zCrown"]),
            "nose": (p["fNose"], 0, p["zNose"]),
            "eyeL": (p["fEye"], EYE_S, p["zEye"]), "eyeR": (p["fEye"], -EYE_S, p["zEye"])}
    co, si = np.cos(yaw), np.sin(yaw)
    for n, (f, s, z) in head.items():
        J[n] = (p["fF"] + (f - p["fF"]) * co - s * si, (f - p["fF"]) * si + s * co, z)
    for x, side in SIDES.items():
        for table, f0, s0, under, top, hoof in ((STAG_FORE, p["fF"], p["sF"], p["zChest"], p["zWithers"], "hoofF"),
                                                (STAG_HIND, p["fH"], p["sH"], p["zBelly"], p["zHip"], "hoofH")):
            J[hoof + x] = (f0, side * s0, 0.0)
            for n, (share, fwd, out) in table.items():
                J[n + x] = (f0 + fwd * cm, side * (s0 if out is None else out * cm), height(share, under, top))
    return {n: np.array(v, float) for n, v in J.items()}


def bone_lengths(J):
    d = lambda a, b: float(np.linalg.norm(J[a] - J[b]))
    return {"shoulder blade": d("scapulaL", "shoulderL"), "upper arm (humerus)": d("shoulderL", "elbowL"),
            "forearm (radius)": d("elbowL", "carpusL"), "fore cannon": d("carpusL", "fetlockFL"),
            "fore pastern": d("fetlockFL", "hoofFL"), "pelvis, hip joint to point of hip": d("hipjointL", "coxaL"),
            "thigh (femur)": d("hipjointL", "stifleL"), "shank (tibia)": d("stifleL", "hockL"),
            "hind cannon": d("hockL", "fetlockHL"), "hind pastern": d("fetlockHL", "hoofHL")}


def to_screen(q, F, L, uv0):
    """A body point (f, s, z) on screen, the body's origin at uv0."""
    f, s, z = q
    return np.array([f * (F[0] - F[1]) + s * (L[0] - L[1]), f * (F[0] + F[1]) / 2 + s * (L[0] + L[1]) / 2 - z]) + uv0


def leg_check(p, origins, yaws):
    """Where the lower legs' joints land on the artist's standing frames: for each, the
    distance (pixels) to the nearest opaque pixel of the sprite (0: on the deer)."""
    sheet = Image.open(PROJECT / "images/deer-land.png").convert("RGBA")
    out = {}
    for view, (row, F, L) in VIEWS.items():
        a = np.array(sheet.crop((27 * FW, row * FH, 28 * FW, (row + 1) * FH)))[:, :, 3] == 255
        ys, xs = np.nonzero(a)
        J = joints(p, yaws[view])
        res = {}
        for n in ("carpus", "fetlockF", "hoofF", "hock", "fetlockH", "hoofH"):
            for x in SIDES:
                u, v = to_screen(J[n + x], F, L, origins[view])
                res[n + x] = float(np.min(np.hypot(xs + 0.5 - u, ys + 0.5 - v)) if not a[int(v), int(u)] else 0.0)
        out[view] = res
    return out


NEAR, FAR, SOFTC, HEADC = (200, 30, 30), (240, 150, 150), (150, 150, 150), (30, 60, 200)


def draw_skeleton(d, J, place, S, near_side):
    """Bones on an ImageDraw: place(q) -> screen (u, v) in frame pixels; S the enlargement."""
    P = {n: place(q) * S for n, q in J.items()}
    far = "R" if near_side == "L" else "L"
    order = sorted(BONES, key=lambda e: 0 if e[0].endswith(far) or e[1].endswith(far) else 1)
    for a, b in SOFT:
        d.line([tuple(P[a]), tuple(P[b])], fill=SOFTC, width=1)
    for a, b in order:
        col = FAR if a.endswith(far) or b.endswith(far) else NEAR if a[-1] in SIDES and a != "sacrum" else HEADC
        d.line([tuple(P[a]), tuple(P[b])], fill=col, width=max(1, S // 4))
    for n, q in P.items():
        r = max(2, S // 4)
        d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=FAR if n.endswith(far) and n != "sacrum" else (0, 0, 0))


def overlay(p, origins, out, yaws):
    """The skeleton over the artist's two standing frames (yellow rings: the landmarks read)."""
    sheet = Image.open(PROJECT / "images/deer-land.png").convert("RGBA")
    S = 16
    panels = []
    for view, (row, F, L) in VIEWS.items():
        fr = sheet.crop((27 * FW, row * FH, 28 * FW, (row + 1) * FH))
        bg = Image.new("RGBA", fr.size, (120, 170, 90, 255)); bg.paste(fr, (0, 0), fr)
        big = bg.resize((FW * S, FH * S), Image.NEAREST)
        d = ImageDraw.Draw(big)
        draw_skeleton(d, joints(p, yaws[view]), lambda q: to_screen(q, F, L, origins[view]), S, "L")
        for n, (u, v) in READINGS[view].items():
            d.ellipse([u * S - 6, v * S - 6, u * S + 6, v * S + 6], outline=(255, 255, 0, 255), width=2)
        panels.append(big)
    img = Image.new("RGBA", (sum(x.width for x in panels) + 20, panels[0].height), (255, 255, 255, 255))
    x = 0
    for pnl in panels:
        img.paste(pnl, (x, 0)); x += pnl.width + 20
    img.save(out)


# the eight facings: grid unit vectors of the deer's forward F and left L, by the game's
# DIR_* order; with the frame's ground point (the critter's position: animat.js) POSITION_F
# forward of the middle between the hooves (the fit's ground points)
S2 = 2 ** -0.5
FACINGS = {
    "E": ((1, 0), (0, 1)), "SE": ((S2, S2), (-S2, S2)), "S": ((0, 1), (-1, 0)), "SW": ((-S2, S2), (-S2, -S2)),
    "W": ((-1, 0), (0, -1)), "NW": ((-S2, -S2), (S2, -S2)), "N": ((0, -1), (1, 0)), "NE": ((S2, -S2), (S2, S2)),
}
GROUND = (16, 33)
POSITION_F = 3.4


def near_side(F, L):
    """The side nearer the camera (which looks along -(1, 1, 1)): the one whose L points toward +x+y."""
    return "L" if L[0] + L[1] > 0 or (L[0] + L[1] == 0 and L[0] > 0) else "R"


def wireframe(p, out):
    """The skeleton, head straight, in all eight facings."""
    S = 10
    order = list(FACINGS)
    img = Image.new("RGB", (len(order) * (FW * S + 10), FH * S), (235, 235, 235))
    d = ImageDraw.Draw(img)
    J = joints(p)
    for k, fc in enumerate(order):
        F, L = (np.array(v, float) for v in FACINGS[fc])
        ox = k * (FW * S + 10)
        d.rectangle([ox, 0, ox + FW * S, FH * S], outline=(180, 180, 180))
        d.text((ox + 5, 5), fc, fill=(0, 0, 0))
        uv0 = np.array(GROUND, float) - to_screen((POSITION_F, 0, 0), F, L, (0, 0)) + np.array([ox / S, 0])
        draw_skeleton(d, J, lambda q: to_screen(q, F, L, uv0), S, near_side(F, L))
    img.save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--overlay", type=Path)
    ap.add_argument("--wire", type=Path)
    args = ap.parse_args()
    p, origins, _ = fit()
    errs0 = {view: max(float(np.linalg.norm(screen(p, origins, view, n) - READINGS[view][n])) for n in MODEL) for view in VIEWS}
    print("one rigid deer, head straight ahead in both views: worst error", {k: round(v, 2) for k, v in errs0.items()})
    p, origins, yaws, _ = fit_yaws()
    print("head turned:", {k: round(float(np.degrees(v))) for k, v in yaws.items()}, "degrees (to its left)")
    print("model (f forward, s left, z up; true-space units = a pixel of height):")
    for k in PARAMS: print(f"  {k:8} {p[k]:7.2f}")
    print("ground points of the frames (u, v):", {k: tuple(np.round(v, 2)) for k, v in origins.items()})
    print("measurements:")
    for k, v in measurements(p).items():
        print(f"  {k}: {np.round(v, 2)}")
    print("reprojection errors (pixels):")
    worst = 0
    for view in VIEWS:
        errs = {n: float(np.linalg.norm(screen(p, origins, view, n, yaws) - READINGS[view][n])) for n in MODEL}
        worst = max(worst, *errs.values())
        print(f"  {view}: " + ", ".join(f"{n} {e:.2f}" for n, e in errs.items()))
    print(f"  worst {worst:.2f}")
    J = joints(p)
    print("the inferred skeleton (f, s, z; the left side):")
    for n, q in J.items():
        if not n.endswith("R"):
            print(f"  {n:10} {q[0]:6.2f} {q[1]:6.2f} {q[2]:6.2f}")
    print("bone lengths (left side):")
    for k, v in bone_lengths(J).items():
        print(f"  {k}: {v:.2f}")
    print("lower legs on the artist's frames (pixels off the sprite; 0: on it):")
    for view, res in leg_check(p, origins, yaws).items():
        print(f"  {view}: " + ", ".join(f"{n} {e:.1f}" for n, e in res.items()))
    if args.overlay:
        overlay(p, origins, args.overlay, yaws)
        print("wrote", args.overlay)
    if args.wire:
        wireframe(p, args.wire)
        print("wrote", args.wire)


if __name__ == "__main__":
    main()
