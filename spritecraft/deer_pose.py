#!/usr/bin/env python3
"""The stag's skeleton (deer_skeleton.py) posed, and cast into pixel coverage: which part
of the deer each pixel of a 32 x 41 frame shows, with its 3D point and surface normal.
The rules that colour those pixels are in deer_pixels.py.

POSE (true space, the deer's own axes f forward, s left, z up):
    df, ds, dz   the whole deer moved
    pitch        the trunk tipped nose-up (radians) about its middle
    neck         the neck tipped up from its rest, about the withers
    tail         the tail swung down (radians), about the sacrum
    each leg     each bone's swing forward from its rest direction (on top of the pitch):
                 fore  scap, hum, rad, can   (shoulder blade, upper arm, forearm, cannon)
                 hind  fem, tib, can         (thigh, shank, cannon)
                 the pastern swings with the cannon
Every joint keeps its rest lateral (s) place: legs swing fore and aft.

THE SOLIDS: the trunk as three ellipsoids (barrel, rump, chest) riding the pitch; the neck
and the upper legs as chains of spheres (tapering capsules). Their sizes are SHAPE, shared
by every pose. The lower legs and the tail are strokes a pixel or two wide, drawn by
deer_pixels.py.

CASTING: the camera looks along -(1, 1, 1) in the grid, so a pixel centre (u, v) is the ray
of grid points (x, y, z) with x - y = u - u0, (x + y) / 2 - z = v - v0; the nearest solid
along it (the greatest x + y + z) is what the pixel shows.
"""

import numpy as np

import deer_skeleton as sk

FW, FH = 32, 41

FORE_BONES = [("scapula", "shoulder", "scap"), ("shoulder", "elbow", "hum"), ("elbow", "carpus", "rad"),
              ("carpus", "fetlockF", "can"), ("fetlockF", "hoofF", "can")]
HIND_BONES = [("hipjoint", "stifle", "fem"), ("stifle", "hock", "tib"), ("hock", "fetlockH", "can"),
              ("fetlockH", "hoofH", "can")]
LEGS = {"FL": ("L", FORE_BONES), "FR": ("R", FORE_BONES), "HL": ("L", HIND_BONES), "HR": ("R", HIND_BONES)}
TRUNK = ["sacrum", "withers", "scapulaL", "scapulaR", "coxaL", "coxaR", "hipjointL", "hipjointR",
         "ischiumL", "ischiumR"]

POSE_KEYS = (["df", "ds", "dz", "pitch", "neck", "tail"]
             + [f"{leg}.{k}" for leg in ("FL", "FR") for k in ("scap", "hum", "rad", "can")]
             + [f"{leg}.{k}" for leg in ("HL", "HR") for k in ("fem", "tib", "can")])

# SHAPE: the solids' sizes (true-space units); the trunk solids' and the neck base's places
# are in the rest skeleton's frame
SHAPE0 = {
    "barrel.f": -0.5, "barrel.z": 9.6, "barrel.a": 6.6, "barrel.b": 2.3, "barrel.c": 4.3,
    "rump.f": -4.6, "rump.z": 10.4, "rump.a": 2.8, "rump.b": 2.3, "rump.c": 4.0,
    "chest.f": 4.4, "chest.z": 8.8, "chest.a": 2.4, "chest.b": 2.1, "chest.c": 4.4,
    "neck.f": 3.6, "neck.z": 11.5, "neck.r0": 2.3, "neck.r1": 1.4,
    "thigh.r0": 2.0, "thigh.r1": 1.1, "arm.r0": 1.4, "arm.r1": 0.9,
    "fore.r0": 0.7, "fore.r1": 0.45, "shank.r0": 0.9, "shank.r1": 0.45,
}
ELLIPSOIDS = ("barrel", "rump", "chest")

# THE HEAD, drawn (deer_pixels.py: where no artist's head block is used). Its frame: from the
# poll, h along the head (to the nose; the poll-to-nose line runs along the top of the head),
# s to its left, u up from that line; turned by the pose's "head" (nose-up, radians, from the
# skeleton's rest; not with the trunk's pitch) and "head_yaw" (to the deer's left). A red deer's head: about twice as
# long as it is deep at the jaw, the eye some 40% of the way from poll to nose, on the side
# of the skull; the muzzle tapering to the nose; the lower jaw under it, from its angle below
# the ear to the chin; the throat from the jaw's angle down into the neck. In true-space
# units at the skeleton's (its poll to nose: 6.6), all scaled by "scale"; deep, as the artist
# draws a head (about two thirds as deep as long, the jaw included).
HEAD = {
    "scale": 1.0,
    # skull and muzzle: chains of spheres, (h, u) of their ends and radii; the muzzle
    # continues the skull
    "skull.h0": 0.5, "skull.u0": -1.4, "skull.h1": 3.0, "skull.u1": -1.5, "skull.r0": 1.8, "skull.r1": 1.5,
    "muzzle.h1": 6.0, "muzzle.u1": -1.0, "muzzle.r1": 0.75,
    "jaw.h0": 1.4, "jaw.u0": -3.1, "jaw.h1": 5.7, "jaw.u1": -1.9, "jaw.r0": 0.8, "jaw.r1": 0.5,
    "throat": 0.5, "throat.r0": 0.8, "throat.r1": 1.2,   # to this share down the neck
    "ear.h0": 0.5, "ear.s0": 0.8, "ear.u0": 0.1, "ear.h1": -0.9, "ear.s1": 1.9, "ear.u1": 1.4, "ear.r": 0.35,
    # the eyes: how far along the head and up; each on its side of the skull's surface
    "eye.h": 2.6, "eye.u": -0.6,
}


def head_spheres(H):
    """The drawn head's sphere chains: {part: ((h0, u0), (h1, u1), r0, r1)}, scaled."""
    k = H["scale"]
    S = lambda *v: tuple(x * k for x in v)
    return {
        "skull": (S(H["skull.h0"], H["skull.u0"]), S(H["skull.h1"], H["skull.u1"]), H["skull.r0"] * k, H["skull.r1"] * k),
        "muzzle": (S(H["skull.h1"], H["skull.u1"]), S(H["muzzle.h1"], H["muzzle.u1"]), H["skull.r1"] * k, H["muzzle.r1"] * k),
        "jaw": (S(H["jaw.h0"], H["jaw.u0"]), S(H["jaw.h1"], H["jaw.u1"]), H["jaw.r0"] * k, H["jaw.r1"] * k),
    }


def head_features(H):
    """(h, s, u) of the eyes (left; the right mirrors it), the nose and the chin: the eye on
    the skull's surface, the nose at the muzzle's tip, the chin at the jaw's."""
    ch = head_spheres(H)
    k = H["scale"]
    (h0, u0), (h1, u1), r0, r1 = ch["skull"]
    eh, eu = H["eye.h"] * k, H["eye.u"] * k
    t = min(1.0, max(0.0, (eh - h0) / (h1 - h0)))
    ch_u, ch_r = u0 + (u1 - u0) * t, r0 + (r1 - r0) * t
    es = np.sqrt(max(0.0, ch_r ** 2 - (eu - ch_u) ** 2))
    (m0h, m0u), (m1h, m1u), _, mr = ch["muzzle"]
    (j0h, j0u), (j1h, j1u), _, jr = ch["jaw"]
    return {"eye": (eh, es, eu), "nose": (m1h + mr * 0.8, 0.0, m1u + mr * 0.4),
            "chin": (j1h + jr * 0.5, 0.0, j1u - jr * 0.5)}


HEAD_PARTS = ("skull", "muzzle", "jaw", "throat", "earL", "earR")
# with a drawn head, the neck as a deer's: from over the withers, thick up to the head (the
# fitted SHAPE's neck is shaped to the artist's frames, its top hidden by the head block)
DRAWN_NECK = {"neck.f": 3.0, "neck.z": 12.0, "neck.r0": 2.3, "neck.r1": 1.5}


def rot(V, a):
    """Points or vectors (..., 3) = (f, s, z) turned nose-up by a about the s axis."""
    V = np.asarray(V, float)
    c, s_ = np.cos(a), np.sin(a)
    return np.stack([V[..., 0] * c - V[..., 2] * s_, V[..., 1], V[..., 0] * s_ + V[..., 2] * c], -1)


class Model:
    def __init__(self):
        self.p, self.origins, self.yaws, _ = sk.fit_yaws()
        self.rest = sk.joints(self.p)
        self.pivot = np.array([0.0, 0.0, (self.p["zHip"] + self.p["zBelly"]) / 2])

    def trunk_point(self, q, pose):
        """A rest-frame point riding the trunk."""
        g = lambda k: pose.get(k, 0.0)
        return self.pivot + rot(np.asarray(q, float) - self.pivot, g("pitch")) + np.array([g("df"), g("ds"), g("dz")])

    def posed(self, pose):
        """Joint positions for a pose (a dict over POSE_KEYS; a missing key rests)."""
        g = lambda k: pose.get(k, 0.0)
        a = g("pitch")
        R = self.rest
        J = {n: self.trunk_point(R[n], pose) for n in TRUNK}
        J["tail"] = J["sacrum"] + rot(R["tail"] - R["sacrum"], a + g("tail"))
        J["poll"] = J["withers"] + rot(R["poll"] - R["withers"], a + g("neck"))
        for leg, (side, bones) in LEGS.items():
            for j0, j1, k in bones:
                J[j1 + side] = J[j0 + side] + rot(R[j1 + side] - R[j0 + side], a + g(f"{leg}.{k}"))
        # the head's frame (HEAD): along it, up from its top line, to its left
        p = self.p
        d0 = np.array([p["fNose"] - p["fPoll"], 0.0, p["zNose"] - p["zPoll"]])
        d0 /= np.linalg.norm(d0)
        up0 = np.array([-d0[2], 0.0, d0[0]])
        y = g("head_yaw")
        cy, sy = np.cos(y), np.sin(y)
        yaw = lambda v: np.array([v[0] * cy - v[1] * sy, v[0] * sy + v[1] * cy, v[2]])
        b = g("head")                    # (a running deer holds its head steady: not with the trunk)
        J["_head"] = (J["poll"], yaw(rot(d0, b)), yaw(np.array([0.0, 1.0, 0.0])), yaw(rot(up0, b)))
        feat = head_features(HEAD)
        for n in ("nose", "chin"):
            J[n] = self.head_point(J, feat[n])
        for x, side in (("L", 1), ("R", -1)):
            h, s_, u = feat["eye"]
            J["eye" + x] = self.head_point(J, (h, side * s_, u))
        return J

    @staticmethod
    def head_point(J, hsu):
        """A point (h, s, u) of the head's frame, posed."""
        P, d, side, up = J["_head"]
        h, s_, u = hsu
        return P + h * d + s_ * side + u * up

    def solids(self, pose, shape, head=False):
        """(ellipsoids: [(centre, radii, pitch)], spheres: (centres (n, 3), radii (n,), parts (n,))).
        head: the head too (HEAD), for drawing it rather than pasting the artist's block."""
        J = self.posed(pose)
        a = pose.get("pitch", 0.0)
        if head:
            shape = {**shape, **DRAWN_NECK}
        ell = [(self.trunk_point((shape[k + ".f"], 0, shape[k + ".z"]), pose),
                np.array([shape[k + ".a"], shape[k + ".b"], shape[k + ".c"]]), a) for k in ELLIPSOIDS]
        cs, rs, ps = [], [], []

        def chain(p0, p1, r0, r1, part):
            n = max(2, int(np.linalg.norm(p1 - p0) / 0.25) + 1)
            for t in np.linspace(0, 1, n):
                cs.append(p0 + (p1 - p0) * t); rs.append(r0 + (r1 - r0) * t); ps.append(part)

        chain(self.trunk_point((shape["neck.f"], 0, shape["neck.z"]), pose), J["poll"],
              shape["neck.r0"], shape["neck.r1"], "neck")
        if head:
            H, k = HEAD, HEAD["scale"]
            hp = lambda h, u, s_=0.0: self.head_point(J, (h, s_, u))
            for part, ((h0, u0), (h1, u1), r0, r1) in head_spheres(H).items():
                chain(hp(h0, u0), hp(h1, u1), r0, r1, part)
            (j0h, j0u), _, _, _ = head_spheres(H)["jaw"]
            neck0 = self.trunk_point((shape["neck.f"], 0, shape["neck.z"]), pose)
            chain(hp(j0h, j0u), J["poll"] + (neck0 - J["poll"]) * H["throat"],
                  H["throat.r0"] * k, H["throat.r1"] * k, "throat")
            for x, side in (("L", 1), ("R", -1)):
                chain(hp(H["ear.h0"] * k, H["ear.u0"] * k, side * H["ear.s0"] * k),
                      hp(H["ear.h1"] * k, H["ear.u1"] * k, side * H["ear.s1"] * k),
                      H["ear.r"] * k, H["ear.r"] * k * 0.8, "ear" + x)
        for x in "LR":
            chain(J["hipjoint" + x], J["stifle" + x], shape["thigh.r0"], shape["thigh.r1"], "thigh" + x)
            chain(J["stifle" + x], J["hock" + x], shape["shank.r0"], shape["shank.r1"], "shank" + x)
            chain(J["shoulder" + x], J["elbow" + x], shape["arm.r0"], shape["arm.r1"], "arm" + x)
            chain(J["elbow" + x], J["carpus" + x], shape["fore.r0"], shape["fore.r1"], "fore" + x)
        return J, ell, (np.array(cs), np.array(rs), np.array(ps))


PARTS = (["trunk", "neck"] + [p + x for x in "LR" for p in ("thigh", "shank", "arm", "fore")]
         + list(HEAD_PARTS))


class Caster:
    """The pixel rays of one facing (F, L: grid unit vectors of forward and left) with the
    deer's origin at screen uv0, in a frame size = (width, height) pixels; parts: the
    names a cast pixel's part indexes (PARTS; the wolf's: wolf_pose.PARTS)."""

    def __init__(self, F, L, uv0, size=(FW, FH), parts=None):
        self.parts = PARTS if parts is None else parts
        self.F, self.L = np.array(F, float), np.array(L, float)
        self.uv0 = np.array(uv0, float)
        self.fw, self.fh = size
        v, u = np.mgrid[0:self.fh, 0:self.fw] + 0.5
        du, dv = u - self.uv0[0], v - self.uv0[1]
        x, y = dv + du / 2, dv - du / 2
        f = x * self.F[0] + y * self.F[1]
        s = x * self.L[0] + y * self.L[1]
        self.O = np.stack([f, s, np.zeros_like(f)], -1).reshape(-1, 3)
        self.D = np.array([self.F[0] + self.F[1], self.L[0] + self.L[1], 1.0])

    def screen(self, P):
        """Body points (..., 3) -> screen (u, v)."""
        P = np.asarray(P, float)
        x = P[..., 0] * self.F[0] + P[..., 1] * self.L[0]
        y = P[..., 0] * self.F[1] + P[..., 1] * self.L[1]
        return np.stack([x - y + self.uv0[0], (x + y) / 2 - P[..., 2] + self.uv0[1]], -1)

    def depth(self, P):
        """Nearness to the camera."""
        return np.asarray(P, float) @ self.D

    def cast(self, ell, spheres):
        """Per pixel: part (index into parts, -1 for none), hit point, normal, depth."""
        O, D = self.O, self.D
        n = len(O)
        best = np.full(n, -np.inf)
        part = np.full(n, -1)
        hit = np.zeros((n, 3)); nrm = np.zeros((n, 3))

        def take(t, N, name):
            P = O + t[:, None] * D
            dep = P @ D
            better = np.isfinite(t) & (dep > best)
            best[better] = dep[better]
            part[better] = self.parts.index(name)
            hit[better] = P[better]; nrm[better] = N[better]

        for c, r, a in ell:
            o = rot(O - c, -a) / r
            d = rot(D, -a) / r
            A = d @ d; B = 2 * o @ d; C = (o * o).sum(1) - 1
            disc = B * B - 4 * A * C
            ok = disc >= 0
            t = np.full(n, np.nan)
            t[ok] = (-B[ok] + np.sqrt(disc[ok])) / (2 * A)
            P = O + np.nan_to_num(t)[:, None] * D
            N = rot(rot(P - c, -a) / (r * r), a)
            N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
            take(t, N, "trunk")
        cs, rs, ps = spheres
        A = D @ D
        for name in dict.fromkeys(ps):
            m = ps == name
            C_, R_ = cs[m], rs[m]
            # only the rays near the chain: its screen box, widened by its largest sphere
            # (a sphere of radius r projects within 2r on screen: the u axis is stretched)
            uv = self.screen(C_)
            pad = 2 * R_.max() + 1
            u0, u1 = int(max(0, uv[:, 0].min() - pad)), int(min(self.fw, uv[:, 0].max() + pad + 1))
            v0, v1 = int(max(0, uv[:, 1].min() - pad)), int(min(self.fh, uv[:, 1].max() + pad + 1))
            if u0 >= u1 or v0 >= v1:
                continue
            idx = (np.arange(v0, v1)[:, None] * self.fw + np.arange(u0, u1)[None, :]).ravel()
            oc = O[idx][:, None, :] - C_[None, :, :]
            B = 2 * (oc @ D)
            Cc = (oc * oc).sum(-1) - R_[None, :] ** 2
            disc = B * B - 4 * A * Cc
            t = np.where(disc >= 0, (-B + np.sqrt(np.maximum(disc, 0))) / (2 * A), -np.inf)
            k = np.argmax(t, 1)
            tsub = t[np.arange(len(idx)), k]
            tb = np.full(n, np.nan)
            tb[idx] = np.where(np.isfinite(tsub), tsub, np.nan)
            P = O + np.nan_to_num(tb)[:, None] * D
            kk = np.zeros(n, int); kk[idx] = k
            N = P - C_[kk]; N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
            take(tb, N, name)
        shape = (self.fh, self.fw)
        return part.reshape(shape), hit.reshape(*shape, 3), nrm.reshape(*shape, 3), best.reshape(shape)
