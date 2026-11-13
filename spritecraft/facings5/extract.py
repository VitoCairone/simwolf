"""Extract the artist's sprites from the two source GIFs (native pixels, shadows as alpha)."""
import numpy as np, hashlib, collections, pickle, sys
from PIL import Image

BG = np.array([119, 104, 100.])
SHADOW = np.array([21, 29, 40.])

def native_frames(path, scale):
    im = Image.open(path); frames = []; durs = []
    for k in range(im.n_frames):
        im.seek(k)
        frames.append(np.array(im.convert("RGB"))[::scale, ::scale].astype(int)); durs.append(im.info["duration"])
    return frames, durs

def classify(f):
    """-> kind (0 background, 1 shadow, 2 sprite), alpha of shadow."""
    v = f - BG; d = SHADOW - BG
    a = (v @ d) / (d @ d)
    res = np.abs(v - a[..., None] * d).max(-1)
    online = (res <= 2.5) & (a > -0.01) & (a < 0.995)
    kind = np.where(online, 1, 2)
    kind[(f == BG.astype(int)).all(-1)] = 0
    return kind, np.clip(a, 0, 1)

def deer_quadrants(f):
    """The four deer of a native deer frame -> {(col,row): (kind, alpha) masks limited to that deer}."""
    from scipy import ndimage
    kind, a = classify(f)
    kind[72:] = 0  # the caption
    H, W = kind.shape
    out = {}
    for col, (x0, x1) in enumerate(((0, 73), (73, W))):
        k = np.zeros_like(kind); k[:, x0:x1] = kind[:, x0:x1]
        lab, n = ndimage.label(k == 2, structure=np.ones((3, 3)))
        owner = np.zeros(n + 1, int)  # 0 top, 1 bottom
        big = []
        for i in range(1, n + 1):
            ys, xs = np.nonzero(lab == i)
            big.append((len(ys), i, ys.mean(), xs.mean()))
        big.sort(reverse=True)
        # the two largest: the top deer and the bottom one
        (_, i1, y1, _), (_, i2, y2, _) = big[0], big[1]
        top, bot = (i1, i2) if y1 < y2 else (i2, i1)
        owner[top] = 0; owner[bot] = 1
        dt = ndimage.distance_transform_edt(lab != top); db = ndimage.distance_transform_edt(lab != bot)
        for _, i, _, _ in big[2:]:
            m = lab == i
            owner[i] = 0 if dt[m].min() <= db[m].min() else 1
        spr = [np.isin(lab, [i for i in range(1, n + 1) if owner[i] == o]) for o in (0, 1)]
        # shadows: the top deer's lie above the bottom deer's feet
        ys = np.nonzero(spr[1])[0]
        cut = int(np.percentile(ys, 60))
        shadow = k == 1
        rows = np.arange(H)[:, None]
        sh = [shadow & (rows < cut), shadow & (rows >= cut)]
        for row in (0, 1):
            kk = np.zeros_like(kind); kk[spr[row]] = 2; kk[sh[row]] = 1
            out[(col, row)] = kk
    return out, a
