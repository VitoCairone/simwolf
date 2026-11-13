"""The five-facing sheets: python3 make5.py wolf|deer [animations...] -> out/<animal>-5dir.png, .json, preview"""
import pickle, sys, json, os, numpy as np
from PIL import Image
from render5 import *
from viz import strip
import os as _os
def W(name): return _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'work', name)
animal = sys.argv[1]; only = sys.argv[2:]
lib = pickle.load(open(W('library.pkl'), 'rb'))[animal]
S, pose0, cam0 = pickle.load(open(W(f'fit_{animal}_shape.pkl'), 'rb'))
fits = pickle.load(open(W(f'fit_{animal}_poses.pkl'), 'rb'))
ORDER = {'wolf': ['idle', 'run', 'howl', 'bite', 'death'], 'deer': ['idle', 'walk', 'run']}[animal]
ROWS = ['U', 'UR', 'R', 'DR', 'D'] + (['UL', 'DL'] if animal == 'deer' else [])
SLOPE = np.cos(np.radians(cam0['az_DR'])) * np.sin(np.radians(cam0['el_DR'])) / np.sin(np.radians(cam0['az_DR']))
ANCHOR = (32, 44); WIDE = 1.25
OUT = W('out') + os.sep; os.makedirs(OUT, exist_ok=True)
cache_f = OUT + f'{animal}_cells.pkl'
cache = pickle.load(open(cache_f, 'rb')) if os.path.exists(cache_f) else {}
anims = [a for a in ORDER if a in fits and len(fits[a]) == len(lib[a]) and (not only or a in only)]
for name in anims:
    oxs = np.array([f['cam']['ox_DR'] for f in fits[name]]); ref = np.median(oxs)
    for k, (f, ft) in enumerate(zip(lib[name], fits[name])):
        if animal == 'wolf' and name == 'death' and k >= 8: ft = {**ft, 'pose': fits[name][7]['pose']}   # (it lies as it fell)
        if (name, k) in cache and not only: continue
        c = ft['cam']; cams = {v: (c['az_' + v], c['el_' + v], c['ox_' + v], c['oy_' + v], c['hy_' + v]) for v in ('DR', 'UR')}
        shift = float(np.clip((c['ox_DR'] - ref) / np.sin(np.radians(c['az_DR'])), -14, 14))
        if abs(shift) < 3: shift = 0.0
        cells = {'UR': f['UR'], 'DR': f['DR'], 'UL': f['UL'], 'DL': f['DL']}
        cells['R'] = level(f['DR'], SLOPE, 32)
        cells['U'] = render_view(animal, S, ft['pose'], cams, f, 180, 38, ANCHOR, [], wide=WIDE, shift=shift, rim_at=0.8)
        cells['D'] = render_view(animal, S, ft['pose'], cams, f, 0, 24, ANCHOR, [], wide=WIDE, shift=shift, rim_at=0.8, eye_min=1)
        cache[(name, k)] = cells
        print(name, k, flush=True)
    pickle.dump(cache, open(cache_f, 'wb'))
# frames alike but for their shadows' rounding in the GIF are one
def same(a, b): return all(np.array_equal(a[d][..., 3] == 255, b[d][..., 3] == 255) and np.array_equal(a[d][a[d][..., 3] == 255], b[d][b[d][..., 3] == 255]) for d in ('DR', 'UR', 'DL', 'UL'))
KEEP = {}; REMAP = {}
for name in ORDER:
    keep = []; remap = []
    for k, f in enumerate(lib[name]):
        j = next((i for i, kk in enumerate(keep) if same(lib[name][kk], f)), None)
        if j is None: keep.append(k); j = len(keep) - 1
        remap.append(j)
    KEEP[name] = keep; REMAP[name] = remap
ncol = max(len(KEEP[a]) for a in ORDER)
sheet = np.zeros((len(ORDER) * len(ROWS) * 64, ncol * 64, 4), np.uint8)
meta = {'cell': 64, 'rows': ROWS, 'anchor': ANCHOR, 'animations': {}}
for ai, name in enumerate(ORDER):
    keep = KEEP[name]
    gif = [sorted(g for k, f in enumerate(lib[name]) if REMAP[name][k] == j for g in f['gif']) for j in range(len(keep))]
    meta['animations'][name] = {'row': ai * len(ROWS), 'frames': len(keep), 'ms': [lib[name][k]['ms'] for k in keep], 'gifFrames': gif}
    if animal == 'deer': meta['animations'][name]['order'] = [REMAP[name][i] for i in lib['_order'][name]]
    for j, k in enumerate(keep):
        if (name, k) not in cache: continue
        for ri, r in enumerate(ROWS):
            sheet[(ai * len(ROWS) + ri) * 64:(ai * len(ROWS) + ri + 1) * 64, j * 64:(j + 1) * 64] = cache[(name, k)][r]
Image.fromarray(sheet).save(OUT + f'{animal}-5dir.png')
json.dump(meta, open(OUT + f'{animal}-5dir.json', 'w'), indent=1)
for name in anims:
    strip([[cache[(name, k)][r] for k in KEEP[name]] for r in ROWS], z=4, crop=(4, 4, 60, 60)).save(OUT + f'prev_{animal}_{name}.png')
print('done', anims)
