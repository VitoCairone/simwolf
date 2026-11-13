"""A posable 3D puppet of ellipsoids, splatted to pixels.

World: x forward (the heading), y to the animal's left, z up; a unit is a sprite pixel.
A camera stands at bearing `az` from the heading, toward the animal's right (0 in front,
90 at its right side, 180 behind), `el` above the ground; orthographic."""
import numpy as np

def fib_sphere(n):
    k = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * k / n); th = np.pi * (1 + 5 ** 0.5) * k
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)

class Blob:
    """An ellipsoid: center c (3), radii (along, lateral, across), pitched `ang` in the
    sagittal plane (its `along` axis from +x toward +z), then rolled/yawed with the body.
    mat: material name; tag: free label for the texture rules."""
    __slots__ = ("c", "r", "ang", "mat", "tag", "t", "grp")
    def __init__(self, c, r, ang=0.0, mat="fur", tag="", t=0.0):
        self.c = np.asarray(c, float); self.r = np.asarray(r, float); self.ang = ang; self.mat = mat; self.tag = tag; self.t = t

def chain(a, b, ra, rb, lat=1.0, n=None, mat="fur", tag="", y=0.0):
    """Ellipsoids from sagittal point a to b (x, z), radii ra -> rb, lateral radius lat * r, at lateral y."""
    a = np.asarray(a, float); b = np.asarray(b, float)
    d = np.hypot(*(b - a)); n = n or max(2, int(np.ceil(d / (0.6 * min(ra, rb) + 0.3))) + 1)
    ang = np.arctan2(b[1] - a[1], b[0] - a[0])
    out = []
    for i in range(n):
        t = i / (n - 1); p = a + (b - a) * t; r = ra + (rb - ra) * t
        out.append(Blob((p[0], y, p[1]), (r, r * lat, r), ang, mat, tag, t))
    return out

def sample(blobs, density=2.2):
    """Surface samples of the blobs: points (N,3), normals (N,3), blob index (N), local unit-sphere coords (N,3)."""
    P = []; Nn = []; I = []; U = []
    for i, b in enumerate(blobs):
        area = 4 * np.pi * ((b.r[0] * b.r[1]) ** 1.6 / 3 + (b.r[0] * b.r[2]) ** 1.6 / 3 + (b.r[1] * b.r[2]) ** 1.6 / 3) ** (1 / 1.6)
        u = fib_sphere(max(24, int(area * density)))
        p = u * b.r; nn = u / b.r
        ca, sa = np.cos(b.ang), np.sin(b.ang)
        R = np.array([[ca, 0, -sa], [0, 1, 0], [sa, 0, ca]])  # local (along, lateral, across) -> world
        P.append(p @ R.T + b.c); n2 = nn @ R.T; Nn.append(n2 / np.linalg.norm(n2, axis=1, keepdims=True))
        I.append(np.full(len(u), i)); U.append(u)
    return np.concatenate(P), np.concatenate(Nn), np.concatenate(I), np.concatenate(U)

def camera(az, el):
    a, e = np.radians(az), np.radians(el)
    c = np.array([np.cos(a) * np.cos(e), -np.sin(a) * np.cos(e), np.sin(e)])
    u = np.array([-np.cos(a) * np.sin(e), np.sin(a) * np.sin(e), np.cos(e)])
    r = np.cross(u, c)
    return r, u, c

def body_rot(P, yaw=0.0, roll=0.0, pivot=(0, 0, 0)):
    """Points yawed (about z) and rolled (about x) about the pivot."""
    if not yaw and not roll: return P
    cy, sy, cr, sr = np.cos(yaw), np.sin(yaw), np.cos(roll), np.sin(roll)
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]); Rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    return (P - pivot) @ (Rz @ Rx).T + pivot

def splat(P, cam, origin, size, ss=1, attrs=()):
    """Z-buffered point splat. origin: screen position (x, y) of the world origin (pixels).
    -> index image (size*ss square) of the nearest sample at each sub-pixel (-1: none)."""
    r, u, c = cam
    sx = np.floor((origin[0] + P @ r) * ss).astype(int); sy = np.floor((origin[1] - P @ u) * ss).astype(int)
    d = P @ c
    n = size * ss
    ok = (sx >= 0) & (sx < n) & (sy >= 0) & (sy < n)
    idx = np.nonzero(ok)[0]
    flat = sy[idx] * n + sx[idx]
    order = np.lexsort((d[idx], flat))          # by pixel, then depth ascending: the last of each pixel is nearest
    flat_s = flat[order]; last = np.r_[flat_s[1:] != flat_s[:-1], True]
    img = np.full(n * n, -1); img[flat_s[last]] = idx[order][last]
    return img.reshape(n, n)

def silhouette(blobs, cam, origin, size, density=1.2):
    P, _, _, _ = sample(blobs, density)
    return splat(P, cam, origin, size) >= 0
