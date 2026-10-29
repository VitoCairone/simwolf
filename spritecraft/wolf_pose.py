#!/usr/bin/env python3
"""The wolf's skeleton (wolf_skeleton.py) posed, and cast into pixel coverage, as the deer's
(deer_pose.py, whose posing and casting this reuses: the wolf's joints have the deer's names;
see wolf_skeleton.py for what they are on a wolf).

POSE: deer_pose.POSE_KEYS, and
    tail       the tail swung down (radians) about its root, which rides the trunk
    tail.bend  its outer half swung further down, about its middle
    spine      the hind quarters tipped nose-up about the loins (LUMBAR_F): the back bent
    stretch    the hind quarters moved back: the back stretched (a gallop's reach)
THE SOLIDS: the trunk's three ellipsoids, the neck, the upper legs (deer_pose), and the tail,
a bushy chain of spheres, thickest in its middle. Sizes: SHAPE0 (fitted: wolf_runfit.py).
"""

import numpy as np

import deer_pose as dp
import wolf_skeleton as sk

FW, FH = 64, 64
PARTS = dp.PARTS + ["tail"]
POSE_KEYS = dp.POSE_KEYS + ["tail.bend", "spine", "stretch"]
TRUNK = dp.TRUNK + ["tailroot"]

SHAPE0 = {
    "barrel.f": 0.0, "barrel.z": 9.3, "barrel.a": 5.5, "barrel.b": 2.4, "barrel.c": 3.3,
    "rump.f": -4.5, "rump.z": 9.8, "rump.a": 2.6, "rump.b": 2.3, "rump.c": 2.9,
    "chest.f": 4.6, "chest.z": 9.2, "chest.a": 3.0, "chest.b": 2.4, "chest.c": 3.6,
    "neck.f": 4.5, "neck.z": 12.0, "neck.r0": 2.6, "neck.r1": 2.0,
    "thigh.r0": 2.0, "thigh.r1": 1.1, "arm.r0": 1.4, "arm.r1": 0.9,
    "fore.r0": 0.7, "fore.r1": 0.5, "shank.r0": 0.9, "shank.r1": 0.5,
    "tail.r0": 0.9, "tail.r1": 1.5, "tail.r2": 0.7, "tail.len": 1.0,   # (its length: of the skeleton's)
}
ELLIPSOIDS = dp.ELLIPSOIDS


HIND = ["sacrum", "coxaL", "coxaR", "hipjointL", "hipjointR", "ischiumL", "ischiumR", "tailroot"]
LUMBAR_F = -1.5         # the back bends and stretches about here (f; at the trunk's mid-height)


class Model(dp.Model):
    """deer_pose.Model with a supple back: pose keys "spine" (the hind quarters tipped
    nose-up, radians, about the loins: a galloping wolf's back flexes and extends) and
    "stretch" (the hind quarters moved back, true-space units)."""

    def __init__(self):
        self.p, self.origins, self.yaws, _ = sk.fit_yaws()
        self.rest = sk.joints(self.p)
        R = self.rest
        self.rest["tailmid"] = (R["tailroot"] + R["tail"]) / 2
        self.pivot = np.array([0.0, 0.0, (self.p["zHip"] + self.p["zBelly"]) / 2])
        self.loins = np.array([LUMBAR_F, 0.0, self.pivot[2]])

    def hind_point(self, q, pose, share=1.0):
        """A rest-frame point riding the hind quarters (share: of their bend and stretch)."""
        g = lambda k: pose.get(k, 0.0)
        q = self.loins + dp.rot(np.asarray(q, float) - self.loins, share * g("spine"))
        return self.trunk_point(q - np.array([share * g("stretch"), 0.0, 0.0]), pose)

    def posed(self, pose):
        J = super().posed(pose)
        g = lambda k: pose.get(k, 0.0)
        a = g("pitch") + g("spine")
        R = self.rest
        for n in HIND:
            J[n] = self.hind_point(R[n], pose)
        for leg in ("HL", "HR"):
            side, bones = dp.LEGS[leg]
            for j0, j1, k in bones:
                J[j1 + side] = J[j0 + side] + dp.rot(R[j1 + side] - R[j0 + side], a + g(f"{leg}.{k}"))
        J["tailmid"] = J["tailroot"] + dp.rot(R["tailmid"] - R["tailroot"], a + g("tail"))
        J["tail"] = J["tailmid"] + dp.rot(R["tail"] - R["tailmid"], a + g("tail") + g("tail.bend"))
        return J

    def solids(self, pose, shape, head=False):
        J, ell, (cs, rs, ps) = super().solids(pose, shape, head=head)
        g = lambda k: pose.get(k, 0.0)
        a = g("pitch")
        ell = []
        for k in ELLIPSOIDS:
            q = (shape[k + ".f"], 0, shape[k + ".z"])
            r = np.array([shape[k + ".a"], shape[k + ".b"], shape[k + ".c"]])
            if k == "rump":
                ell.append((self.hind_point(q, pose), r, a + g("spine")))
            elif k == "barrel":     # half the bend and the stretch: it spans the loins
                ell.append((self.hind_point(q, pose, 0.5), r + np.array([g("stretch") / 2, 0, 0]), a + g("spine") / 2))
            else:
                ell.append((self.trunk_point(q, pose), r, a))
        k = shape.get("tail.len", 1.0)
        mid = J["tailroot"] + (J["tailmid"] - J["tailroot"]) * k
        J["tail"] = mid + (J["tail"] - J["tailmid"]) * k
        J["tailmid"] = mid
        cs, rs, ps = list(cs), list(rs), list(ps)
        for p0, p1, r0, r1 in ((J["tailroot"], J["tailmid"], shape["tail.r0"], shape["tail.r1"]),
                               (J["tailmid"], J["tail"], shape["tail.r1"], shape["tail.r2"])):
            n = max(2, int(np.linalg.norm(p1 - p0) / 0.25) + 1)
            for t in np.linspace(0, 1, n):
                cs.append(p0 + (p1 - p0) * t); rs.append(r0 + (r1 - r0) * t); ps.append("tail")
        return J, ell, (np.array(cs), np.array(rs), np.array(ps))


def caster(F, L, uv0, size=(FW, FH)):
    return dp.Caster(F, L, uv0, size=size, parts=PARTS)
