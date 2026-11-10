// HYDROLOGY: the land's shape and its water, as a pure function of the grid point, with
// sea, freshwater lakes and long rivers, for maps of any size (50,000 tiles square: 50 km
// at a metre a tile). sim.js builds its map with it (see TERRAIN there); nothing else
// reads it. Everything it offers is on the one global it defines, `hydrology`:
// makeMap(options) -> { P (the settings), sampleAt, terrainAt, broadHeight, graph }.
//
// A pure function of one tile can't tell a lake from a bay (that depends on whether a way
// below sea level leads to the open sea) or how big a river is (that depends on all the
// land upstream). So the map is built in two parts:
//   GRAPH: worked out once, from the seed alone: a coarse lattice of nodes (one each
//     nodeTiles, jittered), each with the height of the broad land at it.
//     - OCEAN: the nodes below sea level reachable from the map's edge through nodes
//       below sea level (a flood fill): sea, bays and connected seas. Low ground cut off
//       from it is not sea.
//     - PRIORITY-FLOOD (Barnes, Lehman & Mulla 2014), inward from the ocean: each land
//       node drains to the neighbour it was reached from, so all the land drains, down a
//       tree, to the sea; a hollow is filled to where it spills over (its water level,
//       waterLevel): the nodes under water there are a freshwater lake, with a flat
//       surface; and its water goes on from the spill toward the sea.
//     - FLOW: each node adds its area to all the nodes downstream of it (once, in reverse
//       of the flood's order). Where enough land drains through a node (riverMinNodes),
//       a river runs from it to the node downstream, as wide as the root of its flow.
//       Each river reach is bent into a meandering line by midpoint displacement, from a
//       hash of its node, so neighbouring reaches meet at the nodes.
//   POINT (sampleAt, at any grid point; terrainAt, a tile's center): from the graph near
//     it only (a constant amount of work): the broad land plus fine detail, then, first
//     that applies (details there):
//     - sea: below sea level near an ocean node
//     - lake: below the water level of a lake node near it
//     - river: within half the width of a river reach
//     - land, cut down into a valley around any river near it (so the river runs in it)
//   A river's bed falls from each node's filled level to the next one's, never rising,
//   so every river runs downhill to a lake or the sea.
// Heights are in levels (0.41 m: see TERRAIN HEIGHT in sim.js). Deterministic: integer hashes of the seed, no Math.random.

const hydrology = (() => {
"use strict";
// (a local Math: looking globals up is slow where the code runs in a Node vm context)
const Math = globalThis.Math;

// HASHING AND NOISE
function hash2(i, j, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Value noise, -1..1, smooth (quintic easing), on a lattice of unit cells.
function vnoise(x, y, seed) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
  const su = u * u * u * (u * (u * 6 - 15) + 10), sv = v * v * v * (v * (v * 6 - 15) + 10);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return 2 * (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) - 1;
}

// Fractal sum of value noise, about -1..1: octaves from wavelength `wl` down, each half
// as long and half as strong.
function fbm(x, y, octaves, wl, seed) {
  let sum = 0, amp = 1, norm = 0;
  for (let k = 0; k < octaves; k++) {
    sum += amp * vnoise(x / wl, y / wl, seed + k * 101);
    norm += amp; amp *= 0.5; wl *= 0.5;
  }
  return sum / norm;
}

const smooth = (a, b, t) => { const s = Math.min(1, Math.max(0, (t - a) / (b - a))); return s * s * (3 - 2 * s); };

// THE MAP
const defaults = {
  seed: 1,
  width: 50000, height: 50000, // tiles (metres)
  nodeTiles: 128,              // the graph's lattice spacing
  jitter: 0.35,                // of a lattice cell, each node's random offset at most
  continentTiles: 24000,       // the broad land's longest wavelength
  warpTiles: 4000,             // how far the broad land is pushed about (coastlines bend)
  edgeSeaShare: 0.12,          // the map's edges sink into the sea over this share of it
  edgeSinkLevels: 1500,        // ...by this much at the edge (more than any land rises)
  plainLevels: 120,            // the broad land's height scale...
  mountainLevels: 900,         // ...and its mountain ranges'
  seaShiftLevels: 30,          // raises the land (more land than sea)
  detailLevels: 8,             // fine detail's height, at most
  detailTiles: 300,            // its longest wavelength
  riverMinNodes: 150,          // land draining through a node to make a river (in nodes)
  riverWidthPerRoot: 0.35,     // a river's width: this times the root of its flow (tiles)
  riverMinWidth: 2,
  riverBankDepthLevels: 1.5,   // its bed below the land at its edge
  valleySlope: 0.04,           // the valley's sides rise this many levels a tile...
  valleyTiles: 220,            // ...and reach no further than this from the river
  meanderShare: 0.22,          // midpoint displacement: share of a reach's length
  meanderLevels: 4,            // halvings: 2^levels pieces a reach
};

function makeMap(options = {}) {
  const P = { ...defaults, ...options };
  const { seed, width: W, height: H, nodeTiles: S } = P;

  // THE BROAD LAND, in levels (sea level 0): a warped fractal, sunk at the map's edges,
  // with ridged mountain ranges on the higher ground.
  function broadHeight(x, y) {
    const wx = x + P.warpTiles * fbm(x, y, 3, P.continentTiles, seed + 11);
    const wy = y + P.warpTiles * fbm(x, y, 3, P.continentTiles, seed + 23);
    const c = fbm(wx, wy, 6, P.continentTiles, seed + 37);
    const edge = smooth(0, P.edgeSeaShare, Math.min(x, y, W - x, H - y) / Math.min(W, H));
    const ridge = 1 - Math.abs(fbm(wx, wy, 4, P.continentTiles / 3, seed + 53));
    const highland = smooth(0.05, 0.45, c);
    return P.plainLevels * 2.5 * c + P.seaShiftLevels + P.mountainLevels * highland * ridge * ridge * ridge
      - P.edgeSinkLevels * (1 - edge);
  }
  function detailHeight(x, y) {
    return P.detailLevels * fbm(x, y, 4, P.detailTiles, seed + 71);
  }

  // GRAPH: nodes
  const nx = Math.ceil(W / S) + 1, ny = Math.ceil(H / S) + 1, N = nx * ny;
  const px = new Float64Array(N), py = new Float64Array(N), elev = new Float32Array(N);
  const id = (i, j) => i * ny + j;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const k = id(i, j);
    const edgeNode = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
    const jx = edgeNode ? 0 : (hash2(i, j, seed + 3) * 2 - 1) * P.jitter * S;
    const jy = edgeNode ? 0 : (hash2(i, j, seed + 5) * 2 - 1) * P.jitter * S;
    px[k] = Math.min(W, i * S + jx); py[k] = Math.min(H, j * S + jy);
    elev[k] = broadHeight(px[k], py[k]);
  }
  const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  // OCEAN: flood fill from the map's edge through nodes below sea level
  const ocean = new Uint8Array(N);
  {
    const stack = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if ((i === 0 || j === 0 || i === nx - 1 || j === ny - 1) && elev[id(i, j)] < 0) { ocean[id(i, j)] = 1; stack.push(id(i, j)); }
    }
    while (stack.length) {
      const k = stack.pop(), i = Math.floor(k / ny), j = k % ny;
      for (const [di, dj] of nbrs) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const n = id(a, b);
        if (!ocean[n] && elev[n] < 0) { ocean[n] = 1; stack.push(n); }
      }
    }
  }

  // PRIORITY-FLOOD from the ocean: waterLevel (a lake's flat surface where filled), bed
  // (the same, rising a hair each node upstream, so every node's way down is strict),
  // downstream (-1: the sea), and the order nodes were reached in.
  const waterLevel = new Float32Array(N), bed = new Float64Array(N), down = new Int32Array(N).fill(-1);
  const order = new Int32Array(N); let nOrder = 0;
  {
    const heapK = new Float64Array(N), heapN = new Int32Array(N); let hn = 0;
    const push = (key, n) => {
      let c = hn++;
      while (c > 0) { const p = (c - 1) >> 1; if (heapK[p] <= key) break; heapK[c] = heapK[p]; heapN[c] = heapN[p]; c = p; }
      heapK[c] = key; heapN[c] = n;
    };
    const pop = () => {
      const top = heapN[0], key = heapK[--hn], n = heapN[hn];
      let c = 0;
      for (;;) {
        let ch = 2 * c + 1;
        if (ch >= hn) break;
        if (ch + 1 < hn && heapK[ch + 1] < heapK[ch]) ch++;
        if (heapK[ch] >= key) break;
        heapK[c] = heapK[ch]; heapN[c] = heapN[ch]; c = ch;
      }
      heapK[c] = key; heapN[c] = n;
      return top;
    };
    const closed = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (ocean[k]) { closed[k] = 1; waterLevel[k] = elev[k]; bed[k] = elev[k]; push(elev[k], k); }
    const eps = 1e-3;
    while (hn) {
      const k = pop(), i = Math.floor(k / ny), j = k % ny;
      for (const [di, dj] of nbrs) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const n = id(a, b);
        if (closed[n]) continue;
        closed[n] = 1;
        waterLevel[n] = Math.max(elev[n], ocean[k] ? 0 : waterLevel[k]);
        bed[n] = Math.max(elev[n], bed[k] + eps, 0);
        down[n] = k;
        order[nOrder++] = n;
        push(bed[n], n);
      }
    }
  }
  // lakes: the nodes under their hollow's water (a little, so a flat isn't a lake)
  const lakeDepthMinM = 0.5;
  const lake = new Int32Array(N).fill(-1); // lake number
  const lakeLevels = [];
  for (let k = 0; k < N; k++) {
    if (ocean[k] || lake[k] >= 0 || !(waterLevel[k] - elev[k] > lakeDepthMinM)) continue;
    const L = lakeLevels.length, level = waterLevel[k];
    lakeLevels.push(level);
    const stack = [k]; lake[k] = L;
    while (stack.length) {
      const m = stack.pop(), i = Math.floor(m / ny), j = m % ny;
      for (const [di, dj] of nbrs) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const n = id(a, b);
        if (ocean[n] || lake[n] >= 0 || waterLevel[n] !== level || !(level - elev[n] > 0)) continue;
        lake[n] = L; stack.push(n);
      }
    }
  }

  // FLOW: nodes draining through each (itself included)
  const flow = new Float64Array(N);
  for (let k = 0; k < N; k++) if (!ocean[k]) flow[k] = 1;
  for (let t = nOrder - 1; t >= 0; t--) { const n = order[t], d = down[n]; if (d >= 0 && !ocean[d]) flow[d] += flow[n]; }

  // RIVERS: a reach from each node with enough flow to the next one down, unless both
  // are in the same lake; bent by midpoint displacement
  const reaches = []; // { from, to, pts: [x, y, ...], bed0, bed1, width, x0, y0, x1, y1 }
  for (let k = 0; k < N; k++) {
    if (ocean[k] || flow[k] < P.riverMinNodes) continue;
    const d = down[k];
    if (d < 0 || (lake[k] >= 0 && lake[k] === lake[d])) continue;
    let pts = [px[k], py[k], px[d], py[d]];
    let amp = P.meanderShare;
    for (let level = 0; level < P.meanderLevels; level++) {
      const out = [pts[0], pts[1]];
      for (let s = 0; s + 3 < pts.length; s += 2) {
        const ax = pts[s], ay = pts[s + 1], bx = pts[s + 2], by = pts[s + 3];
        const dx = bx - ax, dy = by - ay;
        const r = (hash2(k, level * 64 + s, seed + 89) * 2 - 1) * amp;
        out.push((ax + bx) / 2 - dy * r, (ay + by) / 2 + dx * r, bx, by);
      }
      pts = out; amp *= 0.6;
    }
    const width = Math.max(P.riverMinWidth, P.riverWidthPerRoot * Math.sqrt(flow[k]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let s = 0; s < pts.length; s += 2) {
      x0 = Math.min(x0, pts[s]); x1 = Math.max(x1, pts[s]); y0 = Math.min(y0, pts[s + 1]); y1 = Math.max(y1, pts[s + 1]);
    }
    // cumulative length along it, as a share, for the bed's fall
    const along = [0];
    for (let s = 2; s < pts.length; s += 2) along.push(along.at(-1) + Math.hypot(pts[s] - pts[s - 2], pts[s + 1] - pts[s - 1]));
    const total = along.at(-1) || 1;
    reaches.push({ from: k, to: d, pts: Float64Array.from(pts), along: Float64Array.from(along, a => a / total),
      bed0: bed[k], bed1: ocean[d] ? Math.min(bed[d], 0) : bed[d], width, x0, y0, x1, y1 });
  }
  // bucket the reaches by lattice cell, over all the cells their valleys can reach
  const reach = P.valleyTiles;
  const buckets = new Map();
  reaches.forEach((r, n) => {
    const pad = reach + r.width;
    for (let i = Math.floor((r.x0 - pad) / S); i <= Math.floor((r.x1 + pad) / S); i++)
      for (let j = Math.floor((r.y0 - pad) / S); j <= Math.floor((r.y1 + pad) / S); j++) {
        const key = i * 100003 + j;
        let b = buckets.get(key);
        if (!b) buckets.set(key, b = []);
        b.push(n);
      }
  });

  // POINT: what is at grid point (cx, cy): { kind: "sea" | "lake" | "river" | "land", salt,
  // height (of the water's surface, or the land), ground (the land, under any water), lake
  // (its number) }. Water is judged on the uncut ground (raw); only land is cut into valleys.
  //   sea: raw below sea level within seaReach of an ocean node
  //   lake: in the basin of the nearest lake node (its LAKENESS: the nodes about the
  //     tile, weighted by nearness, that are in that lake, as a share, at least a half:
  //     so a lake ends at its outlet, where the nodes about are downstream of it), and
  //     below its water level, the raw ground or the broad land (without the fine
  //     detail: so the lake always covers its own nodes, where the broad land is below
  //     its level, and the rivers that leave them start in its water). Land a little in
  //     its basin is no lower than its water (no dry hollow beside it, below it).
  //   river: within half a reach's width of its line
  //   land: the lowest of the raw ground and each nearby reach's valley (so valleys join
  //     smoothly where reaches meet); nowhere below sea level (no dry pits by the sea)
  const nodeAt = (i, j) => i < 0 || j < 0 || i >= nx || j >= ny ? -1 : id(i, j);
  // (the 6 x 6 cells searched hold every node within 2 cells, jitter and all)
  const seaReach = 2 * S, lakeWeighTiles = 1.5 * S, lakeAbove = 0.5, lakeBankAbove = 0.15;
  const near = new Int32Array(36), nearW = new Float64Array(36);

  function sampleAt(cx, cy) {
    const broad = broadHeight(cx, cy), raw = broad + detailHeight(cx, cy);
    const i0 = Math.floor(cx / S), j0 = Math.floor(cy / S);
    let oceanD2 = Infinity, lakeN = -1, lakeD2 = Infinity, nNear = 0, sumW = 0;
    const R2 = lakeWeighTiles * lakeWeighTiles;
    for (let i = i0 - 2; i <= i0 + 3; i++) for (let j = j0 - 2; j <= j0 + 3; j++) {
      const n = nodeAt(i, j);
      if (n < 0) { oceanD2 = 0; continue; } // beyond the map's edge: the sea
      const d2 = (px[n] - cx) ** 2 + (py[n] - cy) ** 2;
      if (ocean[n] && d2 < oceanD2) oceanD2 = d2;
      if (lake[n] >= 0 && d2 < lakeD2) { lakeD2 = d2; lakeN = n; }
      if (d2 < R2) { const f = 1 - d2 / R2; near[nNear] = n; nearW[nNear++] = f * f; sumW += f * f; }
    }
    if (raw < 0 && oceanD2 <= seaReach * seaReach) return { kind: "sea", salt: true, height: 0, ground: raw };
    let ground = raw;
    if (lakeN >= 0 && sumW > 0) {
      const L = lake[lakeN], level = lakeLevels[L];
      let w = 0;
      for (let k = 0; k < nNear; k++) if (lake[near[k]] === L) w += nearW[k];
      const lakeness = w / sumW;
      if (lakeness >= lakeAbove && (raw < level || broad < level))
        return { kind: "lake", salt: false, height: level, ground: Math.min(raw, broad), lake: L };
      if (lakeness >= lakeBankAbove) ground = Math.max(ground, level);
    }

    // the reaches about it: in one, a river; else the land, cut into their valleys
    const b = buckets.get(i0 * 100003 + j0);
    if (b) for (const n of b) {
      const r = reaches[n], half = r.width / 2, pad = P.valleyTiles + half;
      if (cx < r.x0 - pad || cx > r.x1 + pad || cy < r.y0 - pad || cy > r.y1 + pad) continue;
      const p = r.pts;
      let best = Infinity, at = 0;
      for (let s = 0; s + 3 < p.length; s += 2) {
        const ax = p[s], ay = p[s + 1], dx = p[s + 2] - ax, dy = p[s + 3] - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d2 = (ax + dx * t - cx) ** 2 + (ay + dy * t - cy) ** 2;
        if (d2 < best) { best = d2; at = r.along[s / 2] + (r.along[s / 2 + 1] - r.along[s / 2]) * t; }
      }
      const bedHere = r.bed0 + (r.bed1 - r.bed0) * at;
      if (best <= half * half) {
        return { kind: "river", salt: false, height: Math.max(0, bedHere), ground: Math.max(0, Math.min(raw, bedHere - P.riverBankDepthLevels)) };
      }
      const out = Math.sqrt(best) - half, f = out / P.valleyTiles;
      ground = Math.min(ground, bedHere + P.valleySlope * out + 2000 * f * f * f * f);
    }
    return { kind: "land", salt: false, height: Math.max(ground, 0), ground: Math.max(ground, 0) };
  }

  // What tile (x, y) is: its center's sample.
  function terrainAt(x, y) { return sampleAt(x + 0.5, y + 0.5); }

  return {
    P, sampleAt, terrainAt, broadHeight,
    graph: { nx, ny, S, px, py, elev, ocean, waterLevel, bed, down, flow, lake, lakeLevels, reaches, order: order.subarray(0, nOrder) },
  };
}

return { makeMap, defaults, fbm, vnoise, hash2 };
})();

// In Node, hydrology.js is a module; in the browser this does nothing.
if (typeof module !== "undefined" && module.exports) module.exports = hydrology;
