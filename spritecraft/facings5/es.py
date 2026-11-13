"""A small CMA-ES (minimise)."""
import numpy as np
def cmaes(f, x0, sigma, iters=200, popsize=None, seed=0, verbose=False, lo=None, hi=None):
    rng = np.random.default_rng(seed)
    x0 = np.asarray(x0, float); n = len(x0)
    scale = np.asarray(sigma, float) * np.ones(n)
    lam = popsize or 4 + int(3 * np.log(n)); mu = lam // 2
    w = np.log(mu + 0.5) - np.log(np.arange(1, mu + 1)); w /= w.sum(); mueff = 1 / (w ** 2).sum()
    cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n); cs = (mueff + 2) / (n + mueff + 5)
    c1 = 2 / ((n + 1.3) ** 2 + mueff); cmu = min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((n + 2) ** 2 + mueff))
    damps = 1 + 2 * max(0, np.sqrt((mueff - 1) / (n + 1)) - 1) + cs
    pc = np.zeros(n); ps = np.zeros(n); C = np.eye(n); s = 1.0; m = np.zeros(n)
    chiN = np.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))
    best = (np.inf, x0.copy())
    clip = (lambda x: np.clip(x, lo, hi)) if lo is not None else (lambda x: x)
    for it in range(iters):
        D2, Bm = np.linalg.eigh(C); D = np.sqrt(np.maximum(D2, 1e-20))
        z = rng.standard_normal((lam, n)); y = (z * D) @ Bm.T
        xs = [clip(x0 + scale * (m + s * yi)) for yi in y]
        fs = np.array([f(x) for x in xs])
        o = np.argsort(fs)
        if fs[o[0]] < best[0]: best = (fs[o[0]], xs[o[0]].copy())
        ysel = y[o[:mu]]; yw = w @ ysel
        m = m + s * yw
        ps = (1 - cs) * ps + np.sqrt(cs * (2 - cs) * mueff) * (Bm @ ((Bm.T @ yw) / D))
        hs = np.linalg.norm(ps) / np.sqrt(1 - (1 - cs) ** (2 * (it + 1))) / chiN < 1.4 + 2 / (n + 1)
        pc = (1 - cc) * pc + hs * np.sqrt(cc * (2 - cc) * mueff) * yw
        C = (1 - c1 - cmu) * C + c1 * (np.outer(pc, pc) + (not hs) * cc * (2 - cc) * C) + cmu * (ysel.T * w) @ ysel
        s *= np.exp((cs / damps) * (np.linalg.norm(ps) / chiN - 1))
        if verbose and it % 20 == 0: print(it, round(best[0], 3), round(s, 4))
        if s < 1e-4: break
    return best
