import pickle, sys, numpy as np
from fit import *
from viz import strip
import os as _os
def W(name): return _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'work', name)
lib = pickle.load(open(W('library.pkl'), 'rb'))
f = lib['deer']['idle'][1]
T = {v: target(f[v]) for v in ('DR', 'UR')}
cam = dict(az_DR=55, el_DR=26, ox_DR=24, oy_DR=48, hy_DR=-20, az_UR=130, el_UR=34, ox_UR=30, oy_UR=47, hy_UR=0)
free = [('cam', k, None, s) for k, s in (('az_DR', 8), ('el_DR', 6), ('ox_DR', 3), ('oy_DR', 2), ('hy_DR', 20), ('az_UR', 8), ('el_UR', 6), ('ox_UR', 3), ('oy_UR', 2), ('hy_UR', 20))]
free += [('pose', k, None, s) for k, s in (('hz', 1.5), ('trunk', 5), ('neck', 12), ('head', 12), ('tail1', 20), ('tail2', 20),
        ('flu', 8), ('fll', 8), ('fru', 8), ('frl', 8), ('hlu', 8), ('hll', 8), ('hru', 8), ('hrl', 8))]
free += [('S', 'trunk', None, 1.5), ('S', 'neck', None, 1.2), ('S', 'snout', None, 0.6)]
for k in ('hips', 'chest', 'head'): free += [('S', k, i, 0.5) for i in range(3)]
free += [('S', 'belly', 1, 0.4), ('S', 'belly', 2, 0.5), ('S', 'neck_r', 0, 0.5), ('S', 'neck_r', 1, 0.4), ('S', 'fleg', 0, 0.7), ('S', 'fleg', 1, 0.7), ('S', 'hleg', 0, 0.7), ('S', 'hleg', 1, 0.7),
         ('S', 'fleg_y', None, 0.4), ('S', 'hleg_y', None, 0.4)]
best = None
for seed in range(3):
    sp = Spec(DEER, DEER_POSE, cam, free)
    l = fit(sp, T, iters=250, seed=seed, prior=lambda spec, x, x0, sg: 0.012 * (((x - x0) / sg) ** 2).sum())
    print(seed, l, flush=True)
    if best is None or l < best[0]: best = (l, sp)
sp = best[1]
pickle.dump((sp.S, sp.pose, sp.cam), open(W('fit_deer_shape.pkl'), 'wb'))
print(sp.cam)
def show(v):
    c = sp.cam; m = mask(sp.S, sp.pose, c['az_' + v], c['el_' + v], (c['ox_' + v], c['oy_' + v]), density=6, headyaw=c['hy_' + v])
    ov = np.zeros((64, 64, 4), np.uint8); tm = T[v][0]
    ov[tm & m] = (90, 200, 90, 255); ov[tm & ~m] = (220, 60, 60, 255); ov[~tm & m] = (60, 90, 230, 255)
    return [f[v], ov]
strip([show('DR') + show('UR')], z=7, crop=(6, 8, 58, 54)).save(W('fit_deer_shape.png'))
