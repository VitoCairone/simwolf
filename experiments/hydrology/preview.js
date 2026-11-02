// Draws previews of a hydrology map (see hydrology.js, at the project root) as PNGs:
//   node preview.js [seed] [outDir]
// seed<n>-overview.png: the whole map, 2048 px square (about 24 tiles a pixel): sea, lakes,
//   land shaded by height and lit from the north-west, rivers drawn over it as lines at
//   least a pixel wide (most are narrower than a pixel at this scale)
// seed<n>-crop-*.png: 1024 x 1024 tiles at a tile a pixel, everything straight from terrainAt:
//   a river mouth, the outlet of the biggest lake, and the biggest river confluence
// Prints the graph's numbers and checks that every river reaches the sea downhill.

"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const { makeMap } = require("../../hydrology.js");

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const seed = +process.argv[2] || 1;
const outDir = process.argv[3] || path.join(__dirname, "output");
fs.mkdirSync(outDir, { recursive: true });
let t0 = Date.now();
const map = makeMap({ seed });
const g = map.graph, P = map.P;
console.log(`seed ${seed}: graph in ${Date.now() - t0} ms, ${g.nx * g.ny} nodes, ${g.reaches.length} river reaches, ${g.lakeLevels.length} lakes`);

const SEA = [28, 66, 112], LAKE = [72, 142, 196], RIVER = [52, 130, 200];
function landColour(h) {
  const stops = [[0, [104, 150, 86]], [80, [138, 168, 96]], [250, [176, 160, 108]], [600, [150, 128, 110]], [1000, [235, 235, 235]]];
  for (let k = 1; k < stops.length; k++) if (h <= stops[k][0]) {
    const [h0, c0] = stops[k - 1], [h1, c1] = stops[k], f = Math.max(0, (h - h0) / (h1 - h0));
    return c0.map((v, n) => v + (c1[n] - v) * f);
  }
  return stops.at(-1)[1];
}

// Draws the map's tiles from (x0, y0), `step` tiles a pixel, w x h pixels.
function draw(file, x0, y0, step, w, h, riverLines) {
  const t = Date.now();
  const cells = new Array(w * h);
  const height = new Float32Array((w + 1) * (h + 1));
  for (let py = 0; py <= h; py++) for (let px = 0; px <= w; px++) {
    const r = map.terrainAt(Math.floor(x0 + px * step), Math.floor(y0 + py * step));
    height[py * (w + 1) + px] = r.height;
    if (px < w && py < h) cells[py * w + px] = r;
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const r = cells[py * w + px];
    let c;
    if (r.kind === "sea") { const d = Math.min(1, -r.ground / 300); c = SEA.map(v => v * (1 - 0.45 * d)); }
    else if (r.kind === "lake") c = LAKE;
    else if (r.kind === "river") c = RIVER;
    else {
      const hz = height[py * (w + 1) + px];
      const dx = height[py * (w + 1) + px + 1] - hz, dy = height[(py + 1) * (w + 1) + px] - hz;
      const shade = Math.max(0.55, Math.min(1.3, 1 - (dx + dy) / step * 0.9));
      c = landColour(hz).map(v => v * shade);
    }
    rgb[(py * w + px) * 3] = Math.min(255, c[0]); rgb[(py * w + px) * 3 + 1] = Math.min(255, c[1]); rgb[(py * w + px) * 3 + 2] = Math.min(255, c[2]);
  }
  if (riverLines) for (const r of g.reaches) {
    const halfPx = Math.max(0.5, r.width / step / 2);
    for (let s = 0; s + 3 < r.pts.length; s += 2) {
      const ax = (r.pts[s] - x0) / step, ay = (r.pts[s + 1] - y0) / step, bx = (r.pts[s + 2] - x0) / step, by = (r.pts[s + 3] - y0) / step;
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
      for (let k = 0; k <= n; k++) {
        const cx = ax + (bx - ax) * k / n, cy = ay + (by - ay) * k / n;
        for (let yy = Math.floor(cy - halfPx); yy <= Math.ceil(cy + halfPx); yy++) for (let xx = Math.floor(cx - halfPx); xx <= Math.ceil(cx + halfPx); xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || (xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 > halfPx * halfPx + 0.25) continue;
          const kind = cells[yy * w + xx].kind;
          if (kind === "sea" || kind === "lake") continue;
          RIVER.forEach((v, q) => { rgb[(yy * w + xx) * 3 + q] = v; });
        }
      }
    }
  }
  writePNG(path.join(outDir, `seed${seed}-${file}`), w, h, rgb);
  console.log(`  seed${seed}-${file}: ${w} x ${h} px, ${step} tiles a pixel, ${((Date.now() - t) / 1000).toFixed(1)} s`);
}

draw("overview.png", 0, 0, P.width / 2048, 2048, 2048, true);

// the crops: centred on a river's mouth (its biggest), the biggest lake's outlet, and the
// biggest confluence (the node where two big rivers join, by the smaller of them)
const N = g.nx * g.ny;
const mouth = g.reaches.filter(r => g.ocean[r.to]).sort((a, b) => g.flow[b.from] - g.flow[a.from])[0];
const sizes = new Map(); for (let k = 0; k < N; k++) if (g.lake[k] >= 0) sizes.set(g.lake[k], (sizes.get(g.lake[k]) || 0) + 1);
const bigLake = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
const outlet = g.reaches.find(r => g.lake[r.from] === bigLake);
const inflows = new Map(); for (const r of g.reaches) { if (!inflows.has(r.to)) inflows.set(r.to, []); inflows.get(r.to).push(g.flow[r.from]); }
let conf = -1, confScore = 0;
for (const [n, fl] of inflows) if (fl.length >= 2 && !g.ocean[n] && g.lake[n] < 0) { const s = fl.sort((a, b) => b - a)[1]; if (s > confScore) { confScore = s; conf = n; } }
const crops = [["crop-river-mouth.png", mouth && mouth.pts[mouth.pts.length - 2], mouth && mouth.pts[mouth.pts.length - 1]],
  ["crop-lake-outlet.png", outlet && g.px[outlet.from], outlet && g.py[outlet.from]],
  ["crop-confluence.png", conf >= 0 && g.px[conf], conf >= 0 && g.py[conf]]];
for (const [file, x, y] of crops) {
  if (x === undefined || x === false) { console.log(`  ${file}: none found`); continue; }
  draw(file, Math.round(x - 512), Math.round(y - 512), 1, 1024, 1024, false);
}

// checks: every river node drains to the sea; no river's bed rises
let stranded = 0, rising = 0;
for (const r of g.reaches) {
  if (r.bed1 > r.bed0) rising++;
  let n = r.from, steps = 0;
  while (n >= 0 && !g.ocean[n] && steps++ < N) n = g.down[n];
  if (n < 0 || !g.ocean[n]) stranded++;
}
console.log(`checks: ${stranded} river reaches that don't drain to the sea, ${rising} whose bed rises downstream`);
