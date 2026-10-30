#!/usr/bin/env python3
"""The wolf's skeleton (wolf_skeleton.py) posed, and cast into pixel coverage, as the deer's
(deer_pose.py, whose posing and casting this reuses: the wolf's joints have the deer's names;
see wolf_skeleton.py for what they are on a wolf).

POSE: deer_pose.POSE_KEYS, and
    tail       the tail swung down (radians) about its root, which rides the trunk
    tail.bend  its outer half swung further down, about its middle
    tail.side  the whole tail swung to the wolf's left (radians), about its root
    back.w, back.t, back.l   the back bent at its three joints (Model: THE BACK)
A pose moves the one skeleton (wolf_skeleton.py, its sections' lengths scaled as fitted:
SKELETON in the poses file): no section's length changes from pose to pose.
THE SOLIDS: the trunk's three ellipsoids and the fur along the back (Model), the neck, the
upper legs (deer_pose), and the tail, a bushy chain of spheres, thickest in its middle. Sizes: SHAPE0 (fitted: wolf_runfit.py).
"""

import numpy as np

import deer_pose as dp
import wolf_skeleton as sk

FW, FH = 64, 64
PARTS = dp.PARTS + ["tail"]
POSE_KEYS = dp.POSE_KEYS + ["tail.bend", "tail.side", "back.w", "back.t", "back.l"]
TRUNK = dp.TRUNK + ["tailroot"]

SHAPE0 = {
    "barrel.f": 0.0, "barrel.z": 9.3, "barrel.a": 5.5, "barrel.b": 2.4, "barrel.c": 3.3,
    "rump.f": -4.5, "rump.z": 9.8, "rump.a": 2.6, "rump.b": 2.3, "rump.c": 2.9,
    "chest.f": 4.6, "chest.z": 9.2, "chest.a": 3.0, "chest.b": 2.4, "chest.c": 3.6,
    "neck.f": 4.5, "neck.z": 12.0, "neck.r0": 2.6, "neck.r1": 2.0,
    "thigh.r0": 2.0, "thigh.r1": 1.1, "arm.r0": 1.4, "arm.r1": 0.9,
    "fore.r0": 0.7, "fore.r1": 0.5, "shank.r0": 0.9, "shank.r1": 0.5,
    "tail.r0": 0.9, "tail.r1": 1.5, "tail.r2": 0.7,
    "spine.r": 2.2, "spine.dz": 2.0,
}
# Each size's bounds (true-space units, about 6 cm each: wolf_skeleton's scale), from a grey
# wolf's build (approximate): a narrow, deep chest, a tucked-up belly, a thick ruffed neck,
# slim legs. The artist's two diagonal views alone can't tell a body's depth from its width,
# nor a leg's girth from the body behind it: the fit keeps to these.
SHAPE_BOUNDS = {
    "barrel.a": (4.0, 6.5), "barrel.b": (1.8, 2.6), "barrel.c": (2.2, 3.2),
    "rump.a": (2.5, 4.2), "rump.b": (1.8, 2.8), "rump.c": (2.2, 3.2),
    "chest.a": (2.5, 3.5), "chest.b": (1.8, 2.8), "chest.c": (2.6, 3.6),
    "neck.r0": (1.8, 2.8), "neck.r1": (1.2, 2.0),
    "thigh.r0": (1.3, 1.9), "thigh.r1": (0.7, 1.1), "arm.r0": (1.0, 1.5), "arm.r1": (0.6, 0.9),
    "fore.r0": (0.45, 0.7), "fore.r1": (0.35, 0.5), "shank.r0": (0.6, 0.9), "shank.r1": (0.35, 0.5),
    "tail.r0": (0.7, 1.1), "tail.r1": (1.0, 1.6), "tail.r2": (0.5, 1.2),
    "spine.r": (1.8, 2.6), "spine.dz": (1.5, 2.5),
}


def bounded(shape):
    """shape, each size held within SHAPE_BOUNDS."""
    return {k: (min(max(v, SHAPE_BOUNDS[k][0]), SHAPE_BOUNDS[k][1]) if k in SHAPE_BOUNDS else v)
            for k, v in shape.items()}


ELLIPSOIDS = dp.ELLIPSOIDS


HIND = ["sacrum", "coxaL", "coxaR", "hipjointL", "hipjointR", "ischiumL", "ischiumR", "tailroot"]
BACK = ("back.w", "back.t", "back.l")
# the posed skeleton's bones, for pictures: the skeleton's, the back as its segments, the tail's two
BONES = ([b for b in sk.BONES if set(b) != {"sacrum", "withers"} and set(b) != {"tail", "tailroot"}]
         + [("withers", "spineT"), ("spineT", "spineL"), ("spineL", "sacrum"),
            ("tailroot", "tailmid"), ("tailmid", "tail")])     # the back's three joints' bends (pose keys)
ARCH0 = 1.0             # the standing back's arch (true-space units; the skeleton's "arch")


class Model(dp.Model):
    """deer_pose.Model with a jointed back, and its skeleton's sections scaled (scales:
    wolf_skeleton.SCALES, and "arch").

    THE BACK: three segments, withers to thoracic joint T to lumbar joint L to sacrum, each of
    fixed length, bending at the withers, T and L (pose keys back.w, back.t, back.l: radians,
    positive flexing it, the hind end swung down and under; negative extending it). Standing,
    the back is arched: T and L stand "arch" above the line from withers to sacrum, so the
    segments are longer than that line, and a running wolf's back, straightened or flexed, puts
    its hips farther from or nearer to its shoulders. The body's solids ride the segments: the
    chest the front of the trunk, the barrel the middle segment, the rump the hind quarters;
    and over them the fur, a chain of spheres along the back (spine.r, spine.dz), which fills
    the bends as the coat does, loosely."""

    def __init__(self, scales=None):
        self.p, self.origins, self.yaws, _ = sk.fit_yaws()
        self.pivot = np.array([0.0, 0.0, (self.p["zHip"] + self.p["zBelly"]) / 2])
        self.set_scales(scales)

    def set_scales(self, scales):
        self.scales = dict(scales or {})
        self.rest = sk.scaled(sk.joints(self.p), {k: v for k, v in self.scales.items() if k in sk.SCALES})
        R = self.rest
        self.rest["tailmid"] = (R["tailroot"] + R["tail"]) / 2
        W, S = R["withers"], R["sacrum"]
        c = S - W
        up = np.array([c[2], 0.0, -c[0]]) / np.linalg.norm(c)
        if up[2] < 0:
            up = -up
        arch = self.scales.get("arch", ARCH0)
        R["spineT"] = W + c / 3 + up * arch
        R["spineL"] = W + 2 * c / 3 + up * arch

    def back_frames(self, pose):
        """Rest frame -> posed (still in the trunk's rest frame, before its pitch and move) for
        the middle segment and the hind quarters: (pivot rest, pivot posed, angle) each."""
        g = lambda k: pose.get(k, 0.0)
        R = self.rest
        bw, bt, bl = (g(k) for k in BACK)
        T = R["withers"] + dp.rot(R["spineT"] - R["withers"], bw)
        L = T + dp.rot(R["spineL"] - R["spineT"], bw + bt)
        S = L + dp.rot(R["sacrum"] - R["spineL"], bw + bt + bl)
        return {"mid": (R["spineT"], T, bw + bt), "hind": (R["sacrum"], S, bw + bt + bl), "T": T, "L": L}

    def riding(self, q, frame, pose, fr=None):
        """A rest-frame point riding a segment ("mid", "hind"), posed."""
        fr = fr or self.back_frames(pose)
        p0, p1, a = fr[frame]
        return self.trunk_point(p1 + dp.rot(np.asarray(q, float) - p0, a), pose)

    def posed(self, pose):
        J = super().posed(pose)
        g = lambda k: pose.get(k, 0.0)
        fr = self.back_frames(pose)
        A = fr["hind"][2]
        a = g("pitch") + A
        R = self.rest
        for n in HIND:
            J[n] = self.riding(R[n], "hind", pose, fr)
        J["spineT"], J["spineL"] = self.trunk_point(fr["T"], pose), self.trunk_point(fr["L"], pose)
        for leg in ("HL", "HR"):
            side, bones = dp.LEGS[leg]
            for j0, j1, k in bones:
                J[j1 + side] = J[j0 + side] + dp.rot(R[j1 + side] - R[j0 + side], a + g(f"{leg}.{k}"))
        y = g("tail.side")
        side = lambda v: np.array([v[0] * np.cos(y) - v[1] * np.sin(y), v[0] * np.sin(y) + v[1] * np.cos(y), v[2]])
        J["tailmid"] = J["tailroot"] + side(dp.rot(R["tailmid"] - R["tailroot"], a + g("tail")))
        J["tail"] = J["tailmid"] + side(dp.rot(R["tail"] - R["tailmid"], a + g("tail") + g("tail.bend")))
        return J

    def solids(self, pose, shape, head=False):
        J, ell, (cs, rs, ps) = super().solids(pose, shape, head=head)
        g = lambda k: pose.get(k, 0.0)
        a = g("pitch")
        fr = self.back_frames(pose)
        ell = []
        for k in ELLIPSOIDS:
            q = (shape[k + ".f"], 0, shape[k + ".z"])
            r = np.array([shape[k + ".a"], shape[k + ".b"], shape[k + ".c"]])
            if k == "rump":
                ell.append((self.riding(q, "hind", pose, fr), r, a + fr["hind"][2]))
            elif k == "barrel":
                ell.append((self.riding(q, "mid", pose, fr), r, a + fr["mid"][2]))
            else:
                ell.append((self.trunk_point(q, pose), r, a))
        cs, rs, ps = list(cs), list(rs), list(ps)

        def chain(p0, p1, r0, r1, part):
            n = max(2, int(np.linalg.norm(p1 - p0) / 0.25) + 1)
            for t in np.linspace(0, 1, n):
                cs.append(p0 + (p1 - p0) * t); rs.append(r0 + (r1 - r0) * t); ps.append(part)

        # the fur over the back: along the spine, below it by spine.dz
        down = np.array([0.0, 0.0, shape["spine.dz"]])
        pts = [J["withers"], J["spineT"], J["spineL"], J["sacrum"]]
        for p0, p1 in zip(pts, pts[1:]):
            chain(p0 - down, p1 - down, shape["spine.r"], shape["spine.r"], "trunk")
        chain(J["tailroot"], J["tailmid"], shape["tail.r0"], shape["tail.r1"], "tail")
        chain(J["tailmid"], J["tail"], shape["tail.r1"], shape["tail.r2"], "tail")
        return J, ell, (np.array(cs), np.array(rs), np.array(ps))


def caster(F, L, uv0, size=(FW, FH)):
    return dp.Caster(F, L, uv0, size=size, parts=PARTS)
