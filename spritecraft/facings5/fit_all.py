"""Pose fits of every frame of an animal: python3 fit_all.py wolf|deer"""
import pickle, sys, numpy as np
from fit import *
import os as _os
def W(name): return _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'work', name)
animal = sys.argv[1]; only = sys.argv[2:]; suffix = ('_' + '_'.join(only)) if only else ''
lib = pickle.load(open(W('library.pkl'), 'rb'))[animal]
S, pose0, cam0 = pickle.load(open(W(f'fit_{animal}_shape.pkl'), 'rb'))
CAM = [('az_DR', 5), ('el_DR', 4), ('ox_DR', 3), ('oy_DR', 3), ('hy_DR', 15), ('az_UR', 5), ('el_UR', 4), ('ox_UR', 3), ('oy_UR', 3), ('hy_UR', 12)]
POSE = [('hz', 2), ('trunk', 10), ('stretch', 0.08), ('neck', 15), ('head', 15), ('tail1', 30), ('tail2', 30),
        ('flu', 22), ('fll', 22), ('fru', 22), ('frl', 22), ('hlu', 22), ('hll', 22), ('hru', 22), ('hrl', 22)]
EXTRA = {'death': [('roll', 25), ('trunk', 25)], 'bite': [('trunk', 20)], 'howl': [('trunk', 15)]}
def prior(spec, x, x0, sg): return 0.01 * (((x - x0) / sg) ** 2).sum()
out = {}
for name, frames in lib.items():
    if name.startswith('_') or (only and name not in only): continue
    prev = None; res = []
    for k, f in enumerate(frames):
        T = {v: target(f[v]) for v in ('DR', 'UR')}
        free = [('cam', a, None, s) for a, s in CAM] + [('pose', a, None, s) for a, s in POSE + EXTRA.get(name, [])]
        cands = []
        starts = [(pose0, cam0, 1.0, 0)] + ([(prev[0], prev[1], 0.5, 1)] if prev else [])
        for p0, c0, k_sig, seed in starts:
            sp = Spec(S, p0, c0, [(w, a, i, s * k_sig) for w, a, i, s in free])
            l = fit(sp, T, iters=220, seed=seed, prior=prior)
            cands.append((loss(sp, T), sp))
        l, sp = min(cands, key=lambda t: t[0])
        prev = (dict(sp.pose), dict(sp.cam))
        res.append({'pose': dict(sp.pose), 'cam': dict(sp.cam), 'loss': l})
        print(name, k, round(l, 3), flush=True)
    out[name] = res
    pickle.dump(out, open(W(f'fit_{animal}_poses{suffix}.pkl'), 'wb'))
