"""New views of a fitted puppet as pixels: coloured from the artist's own pixels where its
surface shows in the artist's two views (straight, or by its mirror image), else by rule;
then edges, face marks, a shadow."""
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from quad import *

SHADOW = (21, 29, 40)
WOLF_PAL = {"K": (16, 20, 31), "D2": (21, 29, 40), "D1": (32, 46, 55), "B": (57, 74, 80), "L1": (87, 114, 119), "L2": (129, 151, 150), "P": (162, 62, 140)}
WOLF_RAMP = ["L2", "L1", "B", "D1", "D2"]
DEER_PAL = {"K": (16, 20, 31), "S": (21, 29, 40), "d": (52, 28, 39), "m": (96, 44, 44), "p": (117, 36, 56), "r": (165, 48, 48), "o": (207, 87, 60),
            "h": (218, 134, 62), "y": (232, 193, 112), "a": (136, 75, 43), "w": (231, 213, 179)}
DEER_RAMP = ["h", "o", "r", "p", "d"]

def _tags(blobs, I): return (np.array([b.tag for b in blobs])[I], np.array([b.mat for b in blobs])[I], np.array([b.t for b in blobs])[I])

def wolf_rule(blobs, P, N, I, U):
    tags, mats, tt = _tags(blobs, I); st = np.char.startswith
    col = np.full(len(P), "B", dtype="<U2"); nz = N[:, 2]; nx = N[:, 0]
    col[np.isin(tags, ["hips", "belly", "chest"]) & (nz < -0.5)] = "L1"
    col[(tags == "chest") & (nx > 0.5) & (nz < 0.45)] = "L2"
    col[(tags == "neck") & (nx > 0.35) & (nz < 0.6)] = "L2"
    col[(tags == "head") & (U[:, 2] < -0.3) & (U[:, 0] > -0.5)] = "L2"
    col[(tags == "snout") & (U[:, 2] < -0.2)] = "L2"
    col[tags == "tailtip"] = "L1"
    col[st(tags, "fshin") | st(tags, "hshin") | st(tags, "paw")] = "L1"
    col[st(tags, "fleg") & (nx > 0.2)] = "L1"
    col[mats == "nose"] = "K"; col[mats == "eye"] = "K"; col[mats == "mouth"] = "P"
    return np.array([WOLF_PAL[c] for c in col])

def deer_rule(blobs, P, N, I, U):
    tags, mats, tt = _tags(blobs, I); st = np.char.startswith
    col = np.full(len(P), "o", dtype="<U2"); nz = N[:, 2]; nx = N[:, 0]
    trunk = np.isin(tags, ["hips", "belly", "chest"])
    col[trunk & (nz > 0.75)] = "h"; col[trunk & (nz < -0.45)] = "r"
    col[(tags == "chest") & (nx > 0.6) & (nz < 0.3)] = "y"
    col[(tags == "neck") & (nx > 0.5) & (tt < 0.5)] = "y"
    col[(tags == "neck") & (nx < -0.3) & (nz > 0.2)] = "h"
    col[st(tags, "fleg") | st(tags, "hleg")] = "r"
    col[st(tags, "hleg") & (tt < 0.4)] = "o"
    col[st(tags, "fshin") | st(tags, "hshin")] = "p"
    col[(st(tags, "fshin") | st(tags, "hshin")) & (tt > 0.6)] = "d"
    col[st(tags, "paw")] = "K"
    col[(tags == "tail") | (tags == "tailtip")] = "h"
    col[(tags == "snout") & (U[:, 2] < -0.3)] = "y"
    col[tags == "ear"] = "h"
    col[mats == "antler"] = "m"; col[(mats == "antler") & (N[:, 2] > 0.5)] = "a"
    col[mats == "nose"] = "K"; col[mats == "eye"] = "S"
    return np.array([DEER_PAL[c] for c in col])

ANIMALS = {"wolf": dict(rule=wolf_rule, pal=WOLF_PAL, ramp=WOLF_RAMP, eye="K", shadow=0.7, bands=0),
           "deer": dict(rule=deer_rule, pal=DEER_PAL, ramp=DEER_RAMP, eye="S", shadow=0.6, bands=4)}

def pack(rgb): rgb = np.asarray(rgb).astype(int); return (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]

def view_colours(P, cam, origin, cell, size=64, tol=1.2):
    r, u, c = cam
    sx = np.floor(origin[0] + P @ r).astype(int); sy = np.floor(origin[1] - P @ u).astype(int); d = P @ c
    ok = (sx >= 0) & (sx < size) & (sy >= 0) & (sy < size)
    zb = np.full((size, size), -1e9); np.maximum.at(zb, (sy[ok], sx[ok]), d[ok])
    vis = ok.copy(); vis[ok] = d[ok] >= zb[sy[ok], sx[ok]] - tol
    op = np.zeros(len(P), bool); op[vis] = cell[sy[vis], sx[vis], 3] == 255
    out = np.full(len(P), -1); out[op] = pack(cell[sy[op], sx[op], :3])
    return out

def render_view(animal, S, pose, cams, cells, az, el, anchor, prefer, size=64, ss=3, density=24, thresh=0.4, marks=True, wide=1.0, shift=0.0, rim_at=2.0, eye_min=2):
    """anchor: where the ground under the middle of its trunk (standing) is drawn; shift: its
    way forward from there (pixels of its own length); wide: its width's factor (drawn stockier)."""
    """-> rgba (size x size), with its shadow under it."""
    A = ANIMALS[animal]
    blobs, p, piv = build(S, pose)
    P0, N0, I, U = posed(blobs, p, piv, density, 0)
    mats = np.array([b.mat for b in blobs])[I]
    rule = pack(A["rule"](blobs, P0, N0, I, U))
    _, mirror = cKDTree(P0 * [1, -1, 1]).query(P0)
    col = np.full(len(P0), -1)
    for v in prefer:
        caz, cel, ox, oy, hy = cams[v]
        Pv, _, _, _ = posed(blobs, p, piv, density, hy)
        vc = view_colours(Pv, camera(caz, cel), (ox, oy), cells[v])
        col = np.where(col < 0, vc, col); col = np.where(col < 0, vc[mirror], col)
    # features keep their own colours; antlers and legs' ends too thin to trust a lookup
    keep = np.isin(mats, ["nose", "eye", "mouth"])
    col = np.where((col < 0) | keep, rule, col)
    tg = np.array([b.tag for b in blobs])[I]
    grp = np.zeros(len(P0), int)   # parts that read apart: 0 trunk and neck, 1 head, 2 tail, 3.. each leg
    grp[np.isin(tg, ["head", "snout", "ear", "nose", "eye", "jaw", "mouth", "antler"])] = 1
    grp[np.isin(tg, ["tail", "tailtip"])] = 2
    for gi, (a, b2) in enumerate((("fleg", "fshin"), ("hleg", "hshin"))):
        for si, sd in enumerate("lr"):
            grp[np.isin(tg, [a + sd, b2 + sd])] = 3 + gi * 2 + si
    for si, sd in enumerate("lr"):
        grp[(tg == "paw" + sd) & (P0[:, 0] > 0.5 * S["trunk"])] = 3 + si
        grp[(tg == "paw" + sd) & (P0[:, 0] <= 0.5 * S["trunk"])] = 5 + si
    cam = camera(az, el)
    side = np.abs(N0 @ cam[0])
    mid = np.array([0.5 * S["trunk"] - shift, 0, 0])
    origin = (anchor[0] - mid @ cam[0], anchor[1] + mid @ cam[1])
    P0 = P0 * [1, wide, 1]
    idx = splat(P0, cam, origin, size, ss)
    depth = np.where(idx >= 0, (P0 @ cam[2])[np.maximum(idx, 0)], -1e9)
    n = size
    sub = idx.reshape(n, ss, n, ss).transpose(0, 2, 1, 3).reshape(n, n, ss * ss)
    dsub = depth.reshape(n, ss, n, ss).transpose(0, 2, 1, 3).reshape(n, n, ss * ss)
    cov = (sub >= 0).mean(-1)
    out = np.zeros((n, n, 4), np.uint8); dep = np.full((n, n), -1e9); gimg = np.full((n, n), -1); rim = np.zeros((n, n), bool)
    dark = pack(A["pal"][A["eye"]]); nose = pack(A["pal"]["K"])
    for y, x in zip(*np.nonzero(cov >= thresh)):
        s = sub[y, x]; s = s[s >= 0]
        vals, counts = np.unique(col[s], return_counts=True)
        k = vals[counts.argmax()]
        if marks:
            m = mats[s]
            if (m == "eye").sum() >= eye_min: k = dark
            elif (m == "nose").sum() >= 5: k = nose
        out[y, x] = ((k >> 16) & 255, (k >> 8) & 255, k & 255, 255); dep[y, x] = dsub[y, x].max()
        gimg[y, x] = np.bincount(grp[s]).argmax(); rim[y, x] = gimg[y, x] <= 1 and side[s].mean() > rim_at
    out = smooth(tidy(out, A), A)
    out = edges(out, dep, A, gimg, rim if rim_at < 1 else None)
    # the shadow: the puppet's footprint, soft
    G = P0.copy(); G[:, 2] = 0
    r, u, c = cam
    sx = origin[0] + G @ r + 1.0; sy = origin[1] - G @ u + 0.5
    foot = np.zeros((n, n)); ok = (sx >= 0) & (sx < n) & (sy >= 0) & (sy < n)
    foot[np.floor(sy[ok]).astype(int), np.floor(sx[ok]).astype(int)] = 1
    sh = np.clip(ndimage.gaussian_filter(foot, 1.2) * 0.9, 0, 1) * A["shadow"]
    if A["bands"]: sh = np.round(sh * A["bands"] / A["shadow"]) / A["bands"] * A["shadow"]
    sh[sh < 0.04] = 0
    res = np.zeros_like(out); res[..., :3] = SHADOW; res[..., 3] = np.round(sh * 255)
    res[out[..., 3] > 0] = out[out[..., 3] > 0]
    return res

def tidy(img, A):
    """Lone pixels unlike all their neighbours take the commonest neighbour's colour (but an eye, a nose)."""
    out = img.copy(); H, W = img.shape[:2]; keep = {A["pal"]["K"], A["pal"][A["eye"]]}
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if img[y, x, 3] == 0: continue
            nb = [tuple(img[y + dy, x + dx, :3]) for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)) if img[y + dy, x + dx, 3]]
            me = tuple(img[y, x, :3])
            if len(nb) >= 3 and me not in nb and me not in keep: out[y, x, :3] = max(set(nb), key=nb.count)
    return out

def edges(img, dep, A, gimg, rim=None, jump=1.6):
    """A pixel just behind a nearer, other part is a shade darker (parts read apart); and
    (rim) one on the trunk's or head's flank turning away."""
    out = img.copy(); H, W = img.shape[:2]
    ramp = [A["pal"][k] for k in A["ramp"]]
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if img[y, x, 3] == 0: continue
            me = tuple(int(v) for v in img[y, x, :3])
            if me not in ramp: continue
            behind = any(img[y + dy, x + dx, 3] and gimg[y + dy, x + dx] != gimg[y, x] and dep[y + dy, x + dx] - dep[y, x] > jump
                         for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)))
            if behind or (rim is not None and rim[y, x]):
                out[y, x, :3] = ramp[min(len(ramp) - 1, ramp.index(me) + 1)]
    return out

def level(cell, slope, pivot_x):
    """The artist's cell with its columns shifted to take a slope out (pure pixel moves)."""
    out = np.zeros_like(cell)
    for x in range(cell.shape[1]):
        dy = int(round(-slope * (x - pivot_x)))
        col = cell[:, x]
        if dy > 0: out[dy:, x] = col[:-dy]
        elif dy < 0: out[:dy, x] = col[-dy:]
        else: out[:, x] = col
    return out

def smooth(img, A):
    """A pixel unlike 6 or more of its 8 neighbours takes their commonest colour (speckle from the lookups)."""
    out = img.copy(); H, W = img.shape[:2]; keep = {A["pal"]["K"], A["pal"][A["eye"]]}
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if img[y, x, 3] == 0: continue
            me = tuple(img[y, x, :3])
            if me in keep: continue
            nb = [tuple(img[y + dy, x + dx, :3]) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and img[y + dy, x + dx, 3]]
            if len(nb) >= 5 and sum(c != me for c in nb) >= max(6, len(nb) - 1): out[y, x, :3] = max(set(nb), key=nb.count)
    return out
