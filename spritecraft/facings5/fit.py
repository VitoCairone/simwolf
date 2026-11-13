"""Fitting the puppet to the artist's two views of a frame."""
import numpy as np, copy
from scipy import ndimage
from quad import *
from es import cmaes

def target(cell):
    m = cell[..., 3] == 255
    return m, ndimage.distance_transform_edt(~m)

def chamfer(m, tm, tdt, cap=6.0):
    """Mismatch of a rendered mask m with the target (mask tm, its distance map tdt)."""
    if not m.any(): return 1e4
    a = np.minimum(tdt[m], cap).sum()                                   # rendered pixels off the target
    b = np.minimum(ndimage.distance_transform_edt(~m)[tm], cap).sum()   # target pixels not covered
    return (a + b) / tm.sum()

class Spec:
    """Which numbers are free: [(where, key, index or None, sigma)], where in 'S', 'pose', 'cam'."""
    def __init__(self, S, pose, cam, free):
        self.S = copy.deepcopy(S); self.pose = {**POSE0, **pose}; self.cam = dict(cam); self.free = free
        for k, v in self.S.items():
            if isinstance(v, tuple): self.S[k] = list(v)
    def get(self):
        x = []
        for w, k, i, s in self.free:
            d = getattr(self, w); x.append(d[k] if i is None else d[k][i])
        return np.array(x, float)
    def put(self, x):
        for (w, k, i, s), v in zip(self.free, x):
            d = getattr(self, w)
            if i is None: d[k] = float(v)
            else: d[k][i] = float(v)
    def sig(self): return np.array([f[3] for f in self.free])

def loss(spec, targets, density=1.5):
    """targets: {'DR': (mask, dt), 'UR': (mask, dt)}; cam: az_DR, el_DR, ox_DR, oy_DR, hy_DR, ... """
    c = spec.cam; tot = 0
    for v, (tm, tdt) in targets.items():
        m = mask(spec.S, spec.pose, c["az_" + v], c["el_" + v], (c["ox_" + v], c["oy_" + v]), density=density, headyaw=c.get("hy_" + v))
        tot += chamfer(m, tm, tdt)
    return tot

def fit(spec, targets, iters=150, seed=0, verbose=False, prior=None):
    x0 = spec.get(); sg = spec.sig()
    def f(x):
        spec.put(x)
        return loss(spec, targets) + (prior(spec, x, x0, sg) if prior else 0)
    best = cmaes(f, x0, sg, iters=iters, seed=seed, verbose=verbose)
    spec.put(best[1])
    return best[0]
