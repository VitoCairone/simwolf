"""A quadruped puppet: shape (dict S) and pose (dict) -> blobs in groups."""
import numpy as np
from puppet import *

def d2(ang): return np.array([np.cos(np.radians(ang)), np.sin(np.radians(ang))])

# pose: angles in degrees in the sagittal plane (0 forward, 90 up)
POSE0 = dict(hx=0.0, hz=14.0, trunk=2.0, stretch=1.0, neck=70.0, head=-10.0, jaw=0.0,
             tail1=-110.0, tail2=-100.0,
             flu=-92.0, fll=-90.0, fru=-88.0, frl=-90.0,
             hlu=-100.0, hll=-82.0, hru=-96.0, hrl=-84.0,
             yaw=0.0, roll=0.0, headyaw=0.0, headroll=0.0)

WOLF = dict(trunk=10.5,
            hips=(4.4, 3.5, 4.4), belly=(1.0, 3.5, 4.2), chest=(4.8, 3.9, 4.9),
            neck_at=(1.5, 2.0), neck=3.6, neck_r=(4.0, 3.5), neck_lat=0.85,
            head=(3.6, 3.5, 3.3), snout_at=(2.2, -0.8), snout=3.4, snout_r=(1.9, 1.4), snout_drop=0.5,
            ear_at=(-0.6, 2.4), ear=2.6, ear_r=(1.3, 0.5), ear_y=2.1, ear_ang=105.0,
            eye_at=(1.9, 0.8), eye_y=2.5,
            tail_at=(-3.4, 1.2), tail=(4.5, 4.0), tail_r=(1.6, 2.0, 0.9),
            fleg_at=(0.3, -2.2), fleg=(5.2, 5.2), fleg_r=(1.9, 1.3, 1.0), fleg_y=2.4,
            hleg_at=(-0.6, -1.2), hleg=(5.4, 5.2), hleg_r=(2.5, 1.4, 1.0), hleg_y=2.6,
            paw=(1.4, 1.1, 0.9))

def build(S, pose):
    p = {**POSE0, **pose}
    hip = np.array([p["hx"], p["hz"]])
    L = S["trunk"] * p["stretch"]
    ta = np.radians(p["trunk"]); tdir = d2(p["trunk"]); tup = d2(p["trunk"] + 90)
    sh = hip + L * tdir
    B = []
    def add(b, grp="body"):
        for x in (b if isinstance(b, list) else [b]): x.grp = grp; B.append(x)
    add(Blob((hip[0], 0, hip[1]), S["hips"], ta, "fur", "hips"))
    mid = hip + 0.5 * L * tdir - 0.2 * tup
    add(Blob((mid[0], 0, mid[1]), (0.5 * L + S["belly"][0], S["belly"][1], S["belly"][2]), ta, "fur", "belly"))
    add(Blob((sh[0], 0, sh[1]), S["chest"], ta, "fur", "chest"))
    nb = sh + S["neck_at"][0] * tdir + S["neck_at"][1] * tup
    hc = nb + S["neck"] * d2(p["neck"])
    add(chain(nb - 1.0 * d2(p["neck"]), hc, S["neck_r"][0], S["neck_r"][1], S["neck_lat"], mat="fur", tag="neck"))
    hd = d2(p["head"]); hu = d2(p["head"] + 90); ha = np.radians(p["head"])
    add(Blob((hc[0], 0, hc[1]), S["head"], ha, "fur", "head"), "head")
    sn0 = hc + S["snout_at"][0] * hd + S["snout_at"][1] * hu
    sn1 = sn0 + S["snout"] * hd - S["snout_drop"] * hu
    add(chain(sn0, sn1, S["snout_r"][0], S["snout_r"][1], 0.9, n=4, mat="fur", tag="snout"), "head")
    nz = sn1 + 0.7 * hd + 0.25 * hu
    add(Blob((nz[0], 0, nz[1]), (0.85, 0.9, 0.8), ha, "nose", "nose"), "head")
    if p["jaw"] > 0:
        j1 = sn0 + (S["snout"] - 0.5) * d2(p["head"] - p["jaw"]) - 1.2 * hu
        add(chain(sn0 - 0.8 * hu, j1, 1.2, 0.8, 0.9, n=3, mat="fur", tag="jaw"), "head")
        mo = sn0 + 0.55 * S["snout"] * d2(p["head"] - 0.5 * p["jaw"]) - 1.0 * hu
        add(Blob((mo[0], 0, mo[1]), (1.2, 0.9, 0.5 + p["jaw"] / 60), ha, "mouth", "mouth"), "head")
    for s in (1, -1):
        e0 = hc + S["ear_at"][0] * hd + S["ear_at"][1] * hu
        e1 = e0 + S["ear"] * d2(p["head"] + S["ear_ang"])
        add(chain(e0, e1, S["ear_r"][0], S["ear_r"][1], 0.7, n=4, mat="fur", tag="ear", y=s * S["ear_y"]), "head")
        ey = hc + S["eye_at"][0] * hd + S["eye_at"][1] * hu
        add(Blob((ey[0], s * S["eye_y"], ey[1]), (0.75, 0.7, 0.75), 0, "eye", "eye"), "head")
    if "antler" in S:
        # each antler: [(along, up, out, radius)] points of the beam, then tines [(k, along, up, out)] from beam point k
        for s in (1, -1):
            pts = [(hc + a * hd + u * hu, s * o, r) for a, u, o, r in S["antler"]]
            for (a, ya, ra), (b, yb, rb) in zip(pts[:-1], pts[1:]):
                n = max(2, int(np.hypot(np.hypot(*(b - a)), yb - ya) / 0.5) + 1)
                for i in range(n):
                    t = i / (n - 1); q = a + (b - a) * t; r = ra + (rb - ra) * t
                    add(Blob((q[0], ya + (yb - ya) * t, q[1]), (r, r, r), 0, "antler", "antler", t), "head")
            for k, a, u, o in S["tines"]:
                a0, y0, r0 = pts[k]; b = hc + a * hd + u * hu
                n = max(2, int(np.hypot(np.hypot(*(b - a0)), s * o - y0) / 0.5) + 1)
                for i in range(n):
                    t = i / (n - 1); q = a0 + (b - a0) * t
                    add(Blob((q[0], y0 + (s * o - y0) * t, q[1]), (0.55, 0.55, 0.55), 0, "antler", "antler", t), "head")
    tb = hip + S["tail_at"][0] * tdir + S["tail_at"][1] * tup
    t1 = tb + S["tail"][0] * d2(p["tail1"]); t2 = t1 + S["tail"][1] * d2(p["tail2"])
    add(chain(tb, t1, S["tail_r"][0], S["tail_r"][1], 0.9, mat="fur", tag="tail"))
    add(chain(t1, t2, S["tail_r"][1], S["tail_r"][2], 0.9, mat="fur", tag="tailtip"))
    for side, s, ua, la in (("l", 1, "flu", "fll"), ("r", -1, "fru", "frl")):
        top = sh + S["fleg_at"][0] * tdir + S["fleg_at"][1] * tup
        k = top + S["fleg"][0] * d2(p[ua]); f = k + S["fleg"][1] * d2(p[la])
        y = s * S["fleg_y"]
        add(chain(top, k, S["fleg_r"][0], S["fleg_r"][1], 0.9, mat="fur", tag="fleg" + side, y=y))
        add(chain(k, f, S["fleg_r"][1], S["fleg_r"][2], 0.9, mat="fur", tag="fshin" + side, y=y))
        add(Blob((f[0] + 0.5, y, f[1] + 0.1), S["paw"], 0, "fur", "paw" + side))
    for side, s, ua, la in (("l", 1, "hlu", "hll"), ("r", -1, "hru", "hrl")):
        top = hip + S["hleg_at"][0] * tdir + S["hleg_at"][1] * tup
        k = top + S["hleg"][0] * d2(p[ua]); f = k + S["hleg"][1] * d2(p[la])
        y = s * S["hleg_y"]
        add(chain(top, k, S["hleg_r"][0], S["hleg_r"][1], 0.8, mat="fur", tag="hleg" + side, y=y))
        add(chain(k, f, S["hleg_r"][1], S["hleg_r"][2], 0.9, mat="fur", tag="hshin" + side, y=y))
        add(Blob((f[0] + 0.5, y, f[1] + 0.1), S["paw"], 0, "fur", "paw" + side))
    piv = dict(head=(hc[0], 0, hc[1]), body=(hip[0] + 0.5 * L * tdir[0], 0, hip[1]))
    return B, p, piv

def posed(blobs, p, piv, density, headyaw=None):
    """Samples of the posed puppet: P, N (world), I, U."""
    P, N, I, U = sample(blobs, density)
    grp = np.array([b.grp for b in blobs])[I]
    hy = p["headyaw"] if headyaw is None else headyaw
    if hy or p["headroll"]:
        m = grp == "head"
        P[m] = body_rot(P[m], np.radians(hy), np.radians(p["headroll"]), piv["head"])
        N[m] = body_rot(N[m], np.radians(hy), np.radians(p["headroll"]))
    if p["yaw"] or p["roll"]:
        P = body_rot(P, np.radians(p["yaw"]), np.radians(p["roll"]), piv["body"]); N = body_rot(N, np.radians(p["yaw"]), np.radians(p["roll"]))
    return P, N, I, U

def mask(S, pose, az, el, origin, size=64, density=1.6, headyaw=None):
    blobs, p, piv = build(S, pose)
    P, N, I, U = posed(blobs, p, piv, density, headyaw)
    return splat(P, camera(az, el), origin, size) >= 0

DEER = dict(trunk=11.0,
            hips=(4.6, 3.6, 4.8), belly=(1.0, 3.6, 4.6), chest=(4.8, 3.8, 5.0),
            neck_at=(2.0, 2.5), neck=7.0, neck_r=(3.4, 2.2), neck_lat=0.8,
            head=(2.8, 2.3, 2.3), snout_at=(1.6, -0.5), snout=3.2, snout_r=(1.5, 1.1), snout_drop=0.6,
            ear_at=(-1.2, 1.2), ear=2.2, ear_r=(0.9, 0.5), ear_y=2.4, ear_ang=150.0,
            eye_at=(1.0, 0.6), eye_y=1.9,
            antler=[(-0.8, 1.6, 1.2, 0.7), (-2.2, 5.0, 3.0, 0.65), (-2.0, 8.5, 4.6, 0.6), (-0.5, 11.5, 5.2, 0.5)],
            tines=[(1, 1.2, 6.0, 2.6), (2, 1.2, 9.5, 4.2), (2, -4.0, 10.0, 5.5)],
            tail_at=(-4.2, 2.5), tail=(2.2, 2.0), tail_r=(1.3, 1.2, 0.7),
            fleg_at=(0.5, -3.0), fleg=(4.6, 5.0), fleg_r=(1.5, 0.8, 0.6), fleg_y=2.4,
            hleg_at=(-0.8, -2.2), hleg=(5.0, 5.0), hleg_r=(2.2, 0.9, 0.6), hleg_y=2.5,
            paw=(0.8, 0.7, 0.7))
DEER_POSE = dict(hz=14.5, neck=62.0, head=-8.0, tail1=140.0, tail2=120.0, trunk=2.0)
