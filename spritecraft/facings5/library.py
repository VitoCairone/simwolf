"""The artist's sprites as a library: per animal, per animation, its unique frames, each the
right-facing views (DR down-right, UR up-right) and the left-facing ones (DL, UL), as
64x64 RGBA cells (shadow: SHADOW colour with alpha). Wolf: from the artist's sheet
(wolf-all.png), which the GIF shows cell for cell; deer: from its GIF."""
import numpy as np, pickle, sys
from PIL import Image
from extract import *

import os
import os as _os
def W(name): return _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'work', name)
HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.join(HERE, '..', '..', 'images_raw') + os.sep
WORK = os.path.join(HERE, 'work') + os.sep
CELL = 64

def rgba_from(f, kind, alpha):
    out = np.zeros(f.shape[:2] + (4,), np.uint8)
    s = kind == 2
    out[s, :3] = f[s]; out[s, 3] = 255
    h = kind == 1
    out[h, :3] = SHADOW.astype(int); out[h, 3] = np.round(alpha[h] * 255).astype(int)
    return out

def wolf_library():
    sh = np.array(Image.open(G + 'wolf-all.png'))
    wf, wd = native_frames(G + '5V5aC4.gif', 4)
    layout = pickle.load(open(W('wolf_layout.pkl'), 'rb'))
    anims = {'idle': (12, 4, 11), 'run': (12, 8, 0), 'howl': (8, 9, 0), 'bite': (0, 15, 0), 'death': (4, 12, 0)}
    lib = {}
    for name, (r0, n, c0) in anims.items():
        frames = []
        for c in range(n):
            cell = lambda r: sh[r * 64:(r + 1) * 64, (c + c0) * 64:(c + c0 + 1) * 64].copy()
            ks = [k for k, v in layout.items() if v[0] == name and v[1] == c]
            frames.append({'DL': cell(r0), 'DR': cell(r0 + 1), 'UL': cell(r0 + 2), 'UR': cell(r0 + 3),
                           'ms': wd[ks[0]], 'gif': ks, 'at': layout[ks[0]][2]})
        lib[name] = frames
    return lib

# the deer's cells in its GIF frame: [x0, y0] of the 64x64 window of each quadrant
DEER_WIN = {'UL': (18, -8), 'UR': (64, -8), 'DL': (18, 22), 'DR': (64, 22)}
def deer_library():
    df, dd = native_frames(G + 'OvN65m.gif', 3)
    quads = {'UL': (0, 0), 'UR': (1, 0), 'DL': (0, 1), 'DR': (1, 1)}
    cells = []
    for k, f in enumerate(df):
        q, a = deer_quadrants(f)
        c = {}
        for name, key in quads.items():
            full = rgba_from(f, q[key], a)
            x0, y0 = DEER_WIN[name]
            out = np.zeros((CELL, CELL, 4), np.uint8)
            ya, yb = max(0, y0), min(full.shape[0], y0 + CELL)
            out[ya - y0:yb - y0] = full[ya:yb, x0:x0 + CELL]
            c[name] = out
        cells.append(c)
    ranges = {'walk': range(0, 21), 'run': range(21, 40), 'idle': range(40, 64)}
    lib = {}
    for name, rg in ranges.items():
        frames = []; seen = {}
        order = []
        for k in rg:
            key = b''.join(cells[k][d][..., 3].tobytes() + cells[k][d][..., :3][cells[k][d][..., 3] == 255].tobytes() for d in ('DR', 'UR', 'DL', 'UL'))
            if key not in seen:
                seen[key] = len(frames)
                frames.append({**cells[k], 'ms': dd[k], 'gif': [k]})
            else: frames[seen[key]]['gif'].append(k)
            order.append(seen[key])
        lib[name] = frames
        lib.setdefault('_order', {})[name] = order
    return lib

if __name__ == '__main__':
    w = wolf_library(); d = deer_library()
    pickle.dump({'wolf': w, 'deer': d}, open(W('library.pkl'), 'wb'))
    for a, lib in (('wolf', w), ('deer', d)):
        for name, fr in lib.items():
            if name.startswith('_'): print(a, name, fr); continue
            print(a, name, len(fr), [f['ms'] for f in fr], [f['gif'] for f in fr])
