#!/usr/bin/env python3
"""A first pass at drawing the stag from its skeleton (deer_skeleton.py) in any facing:
simple solids hung on the skeleton, projected isometrically and painted in the artist's
palette. GENERATED ART: not the artist's, and not canonical (admin/design_notes.md).

Usage (needs Python 3 with numpy and Pillow):

    python3 spritecraft/deer_render.py --out /tmp/deer-facings.png   # the standing stag in
                                                                    # all 8 facings, beside
                                                                    # the artist's 4 (enlarged)

THE SOLIDS (true space, the deer's own axes: f forward, s left, z up; see deer_skeleton.py):
the body an ellipsoid between the hips and the withers; the neck and head capsules from
the withers to the poll and on to the nose; the legs thin capsules from the body to the
hooves; the tail; the antlers as branching lines. Each is sampled densely over its
surface, every sample projected (u = x - y, v = (x + y) / 2 - z) and the nearest to the
camera kept for each pixel (depth x + y + z: the camera looks down along -(1, 1, 1)).
SHADING: by the surface's normal: facing up, the highlight; facing down or away from the
light (from the camera's upper left), the shade; else the base coat.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

import deer_skeleton as sk

PROJECT = Path(__file__).resolve().parent.parent
FW, FH = 32, 41
GROUND = (16, 33)         # the critter's position in the frame (animat.js: x centre, topToShadow)
POSITION_F = 3.4          # ...is this far forward of the middle between the feet (fit: deer_skeleton.py)

# the artist's palette (images/deer-land.png)
COAT, LIGHT, SHADE, DARK = (207, 87, 60), (218, 134, 62), (165, 48, 48), (117, 36, 56)
PALE, BLACK, SHADOW = (232, 193, 112), (16, 20, 31), (21, 29, 40)
ANTLER = [(136, 75, 43), (96, 44, 44), (52, 28, 39)]

# facings: grid unit vectors of the deer's forward and left (left: forward turned a quarter
# clockwise on screen... as deer_skeleton.VIEWS), by the game's DIR_* order E..NE
S2 = 2 ** -0.5
FACINGS = {
    "E": ((1, 0), (0, 1)), "SE": ((S2, S2), (-S2, S2)), "S": ((0, 1), (-1, 0)), "SW": ((-S2, S2), (-S2, -S2)),
    "W": ((-1, 0), (0, -1)), "NW": ((-S2, -S2), (S2, -S2)), "N": ((0, -1), (1, 0)), "NE": ((S2, -S2), (S2, S2)),
}


def solids(p):
    """Sample points (f, s, z), their normals and colours."""
    pts, nrm, col = [], [], []

    def add(P, N, C):
        pts.append(P); nrm.append(N); col.append(np.broadcast_to(np.array(C, float), P.shape).copy() if np.ndim(C) == 1 else C)

    def ellipsoid(c, r, colour, n=60):
        a, b = np.meshgrid(np.linspace(0, np.pi, n), np.linspace(0, 2 * np.pi, 2 * n))
        d = np.stack([np.cos(a), np.sin(a) * np.cos(b), np.sin(a) * np.sin(b)], -1).reshape(-1, 3)
        add(np.array(c) + d * r, d / np.array(r), colour)

    def capsule(p0, p1, r0, r1, colour, n=24):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        axis = p1 - p0; L = np.linalg.norm(axis); ax = axis / L
        ref = np.array([0, 0, 1.0]) if abs(ax[2]) < 0.9 else np.array([0, 1.0, 0])
        e1 = np.cross(ax, ref); e1 /= np.linalg.norm(e1); e2 = np.cross(ax, e1)
        t, th = np.meshgrid(np.linspace(0, 1, max(4, int(L * 6))), np.linspace(0, 2 * np.pi, n))
        t, th = t.ravel(), th.ravel()
        r = r0 + (r1 - r0) * t
        d = np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2
        add(p0 + t[:, None] * axis + d * r[:, None], d, colour)
        for c, rr in ((p0, r0), (p1, r1)):
            ellipsoid(c, (rr, rr, rr), colour, 10)

    fH, fF, sH, sF = p["fH"], p["fF"], p["sH"], p["sF"]
    zMid = (p["zHip"] + p["zBelly"]) / 2
    half = (p["zHip"] - p["zBelly"]) / 2
    # body
    # (the art's body runs from the rump, 4 behind the hips, to the chest, 3 before the shoulders)
    ellipsoid(((fH - 4 + fF + 3) / 2, 0, zMid - 0.2), ((fF + 3 - fH + 4) / 2, 2.4, half), COAT)
    # neck and head (straight ahead)
    poll, nose = (p["fPoll"], 0, p["zPoll"]), (p["fNose"], 0, p["zNose"])
    capsule((fF + 0.8, 0, zMid + 1.5), poll, 2.2, 1.5, COAT)
    capsule(poll, (p["fNose"] - 0.8, 0, p["zNose"] + 0.2), 1.6, 1.0, COAT)
    ellipsoid((p["fNose"] - 1.6, 0, p["zNose"] - 0.6), (1.4, 0.9, 0.8), PALE)   # muzzle and jaw
    ellipsoid(nose, (0.6, 0.6, 0.6), BLACK, 8)
    for side in (1, -1):
        ellipsoid((p["fEye"], side * 1.25, p["zEye"]), (0.45, 0.3, 0.45), BLACK, 8)
        ellipsoid((p["fPoll"] - 0.3, side * 1.4, p["zPoll"] + 0.8), (0.4, 0.5, 0.9), COAT, 8)  # ears
    # throat patch
    capsule((fF + 1.6, 0, zMid + 0.5), (p["fPoll"] + 1.2, 0, p["zPoll"] - 1.4), 1.2, 0.8, PALE)
    # tail
    capsule((p["fTail"] + 2.6, 0, p["zTail"] - 0.6), (p["fTail"] + 0.6, 0, p["zTail"]), 0.9, 0.7, LIGHT)
    # legs: thigh and upper arm inside the body, the rest thin, the hoof black
    for f, s, top in ((fH, sH, p["zBelly"] + 2), (fF, sF, p["zChest"] + 2)):
        for side in (1, -1):
            capsule((f, side * s, top), (f, side * s, 1.4), 0.45, 0.35, DARK)
            capsule((f, side * s, 1.2), (f, side * s, 0.4), 0.35, 0.35, BLACK)
    # antlers: a beam each side, up and back, with tines (rough, from the art's spread)
    for side in (1, -1):
        b0 = np.array([p["fCrown"] - 0.4, side * 0.9, p["zCrown"]])
        beam = [b0, b0 + [-0.8, side * 2.0, 2.6], b0 + [-1.8, side * 3.8, 5.4], b0 + [-1.6, side * 5.0, 8.6]]
        for k in range(len(beam) - 1):
            capsule(beam[k], beam[k + 1], 0.45, 0.4, ANTLER[1])
        for k, tine in ((0, [2.2, side * 0.3, 1.2]), (1, [2.0, side * 0.5, 2.0]), (2, [1.4, side * 0.8, 2.4]), (3, [-0.8, side * 0.6, 1.4])):
            capsule(beam[k], beam[k] + tine, 0.4, 0.3, ANTLER[0])
    P = np.concatenate(pts); N = np.concatenate(nrm); C = np.concatenate(col)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    return P, N, C


def render(p, facing, light_dir=(-0.4, 0.3, 0.85)):
    """The stag standing, facing `facing` (a key of FACINGS): a 32 x 41 RGBA frame."""
    F, L = (np.array(v, float) for v in FACINGS[facing])
    P, N, C = solids(p)
    # deer axes -> grid: x, y = (f - POSITION_F) F + s L; normals likewise
    gx = (P[:, 0] - POSITION_F)[:, None] * F + P[:, 1][:, None] * L
    x, y, z = gx[:, 0], gx[:, 1], P[:, 2]
    u = x - y + GROUND[0]
    v = (x + y) / 2 - z + GROUND[1]
    depth = x + y + z
    nx = N[:, 0][:, None] * F + N[:, 1][:, None] * L
    n3 = np.stack([nx[:, 0], nx[:, 1], N[:, 2]], 1)
    # light from the camera's upper left on screen: in the grid, toward -x, +y a little, and up
    ld = np.array(light_dir); ld /= np.linalg.norm(ld)
    lit = n3 @ ld
    img = np.zeros((FH, FW, 4), np.uint8)
    zbuf = np.full((FH, FW), -np.inf)
    px, py = np.floor(u).astype(int), np.floor(v).astype(int)
    ok = (px >= 0) & (px < FW) & (py >= 0) & (py < FH)
    for i in np.nonzero(ok)[0][np.argsort(depth[ok])]:
        X, Y = px[i], py[i]
        if depth[i] < zbuf[Y, X]:
            continue
        zbuf[Y, X] = depth[i]
        c = tuple(int(t) for t in C[i])
        if c == COAT:
            c = LIGHT if n3[i, 2] > 0.75 else SHADE if lit[i] < -0.15 or n3[i, 2] < -0.55 else COAT
        elif c == PALE and lit[i] < -0.3:
            c = LIGHT
        elif c in ANTLER and lit[i] < 0:
            c = ANTLER[2]
        img[Y, X] = (*c, 255)
    # the shadow: a soft ellipse on the ground under the body, behind everything
    sh = np.zeros((FH, FW))
    for t in np.linspace(-1, 1, 60):
        for w in np.linspace(-1, 1, 20):
            f = (p["fH"] + p["fF"]) / 2 - 0.6 + t * ((p["fF"] - p["fH"]) / 2 + 3)
            s = w * 2.2
            g = (f - POSITION_F) * F + s * L
            U, V = int(np.floor(g[0] - g[1] + GROUND[0])), int(np.floor((g[0] + g[1]) / 2 + GROUND[1]))
            if 0 <= U < FW and 0 <= V < FH:
                sh[V, U] = max(sh[V, U], 1 - 0.6 * (t * t + w * w))
    for Y in range(FH):
        for X in range(FW):
            if img[Y, X, 3] == 0 and sh[Y, X] > 0:
                img[Y, X] = (*SHADOW, int(60 + 120 * sh[Y, X]))
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    p, _, _, _ = sk.fit_yaws()
    sheet = Image.open(PROJECT / "images/deer-land.png").convert("RGBA")
    art = {"E": sheet.crop((27 * FW, 1 * FH, 28 * FW, 2 * FH)), "N": sheet.crop((27 * FW, 0, 28 * FW, FH)),
           "W": sheet.crop((27 * FW, 3 * FH, 28 * FW, 4 * FH)), "S": sheet.crop((27 * FW, 2 * FH, 28 * FW, 3 * FH))}
    order = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
    S = 4
    out = Image.new("RGBA", (len(order) * (FW + 2) * S, 2 * (FH + 2) * S), (120, 170, 90, 255))
    for k, fc in enumerate(order):
        fr = Image.fromarray(render(p, fc), "RGBA")
        out.paste(fr.resize((FW * S, FH * S), Image.NEAREST), (k * (FW + 2) * S, 0), fr.resize((FW * S, FH * S), Image.NEAREST))
        if fc in art:
            a = art[fc].resize((FW * S, FH * S), Image.NEAREST)
            out.paste(a, (k * (FW + 2) * S, (FH + 2) * S), a)
    out.save(args.out)
    print("wrote", args.out, "(top: generated, by facing", " ".join(order) + "; bottom: the artist's, where drawn)")


if __name__ == "__main__":
    main()
