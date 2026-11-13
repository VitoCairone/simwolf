import pickle, sys, numpy as np
from fit import *
from viz import strip
import os as _os
def W(name): return _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'work', name)
lib = pickle.load(open(W('library.pkl'), 'rb'))
f = lib['wolf']['idle'][0]
T = {v: target(f[v]) for v in ('DR', 'UR')}
cam = dict(az_DR=68, el_DR=25, ox_DR=22, oy_DR=44, hy_DR=-35, az_UR=140, el_UR=30, ox_UR=30, oy_UR=44, hy_UR=0)
free = [('cam', k, None, s) for k, s in (('az_DR', 8), ('el_DR', 6), ('ox_DR', 2), ('oy_DR', 2), ('hy_DR', 15), ('az_UR', 8), ('el_UR', 6), ('ox_UR', 2), ('oy_UR', 2), ('hy_UR', 10))]
free += [('pose', k, None, s) for k, s in (('hz', 1), ('trunk', 5), ('neck', 12), ('head', 12), ('tail1', 20), ('tail2', 20),
        ('flu', 10), ('fll', 10), ('fru', 10), ('frl', 10), ('hlu', 10), ('hll', 10), ('hru', 10), ('hrl', 10))]
free += [('S', 'trunk', None, 1.5), ('S', 'neck', None, 1), ('S', 'snout', None, 0.8)]
for k in ('hips', 'chest', 'head'): free += [('S', k, i, 0.5) for i in range(3)]
free += [('S', 'belly', 1, 0.4), ('S', 'belly', 2, 0.5), ('S', 'neck_r', 0, 0.5), ('S', 'neck_r', 1, 0.5), ('S', 'fleg', 0, 0.7), ('S', 'fleg', 1, 0.7), ('S', 'hleg', 0, 0.7), ('S', 'hleg', 1, 0.7),
         ('S', 'tail', 0, 0.8), ('S', 'tail', 1, 0.8), ('S', 'fleg_y', None, 0.4), ('S', 'hleg_y', None, 0.4)]
best = None
for seed in range(3):
    sp = Spec(WOLF, {}, cam, free)
    l = fit(sp, T, iters=250, seed=seed, prior=lambda spec, x, x0, sg: 0.012 * (((x - x0) / sg) ** 2).sum())
    print(seed, l)
    if best is None or l < best[0]: best = (l, sp)
sp = best[1]
pickle.dump((sp.S, sp.pose, sp.cam), open(W('fit_wolf_shape.pkl'), 'wb'))
print(sp.cam); print(sp.pose); print(sp.S)
def show(v):
    c = sp.cam; m = mask(sp.S, sp.pose, c['az_' + v], c['el_' + v], (c['ox_' + v], c['oy_' + v]), density=6, headyaw=c['hy_' + v])
    o = f[v].copy(); o[..., 3] = np.where(f[v][..., 3] == 255, 255, 0)
    ov = np.zeros((64, 64, 4), np.uint8); tm = T[v][0]
    ov[tm & m] = (90, 200, 90, 255); ov[tm & ~m] = (220, 60, 60, 255); ov[~tm & m] = (60, 90, 230, 255)
    return [o, ov]
strip([show('DR') + show('UR')], z=7, crop=(8, 10, 58, 52)).save(W('fit_wolf_shape.png'))
