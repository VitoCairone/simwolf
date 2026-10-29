#!/usr/bin/env python3
"""Generate the swimming sprite sheets from the run frames of the land sheets.

    images/wolf-land.png           -> images/wolf-swim.png   (8 frames x 7 facings, 64x64)
    images/stag-land.png           -> images/stag-swim.png   (10 frames x 7 facings, 48x48)
    images/hind-land.png           -> images/hind-swim.png   (the same without antlers, from the
                                                              walk frames: see make_hind_sheets.py)

Usage (from anywhere; needs Python 3 with Pillow and numpy):

    python3 spritecraft/make_swim_sheets.py                 # regenerate both sheets in images/
    python3 spritecraft/make_swim_sheets.py --wolf-cut 14   # try a different waterline height
    python3 spritecraft/make_swim_sheets.py --out-dir /tmp  # write somewhere else to compare

After generating, it checks the swim pose's `topToShadow` in animat.js
(frameDataBySpeciesAndPose.<species>.swim). The swim frames keep the land frames' ground
point, so it must equal the land poses' value (39 wolf, 33 deer): the frames themselves
draw the waterline WATER_SINK_PX lower, on the water surface. Land tiles in front of a
swimmer are drawn over it by the game (animat.js, DRAWING ORDER), so no extra raise is
needed to keep swimmers off the land in front of them.

How each run frame becomes a swim frame:
  1. Drop the ground-shadow pixels (nothing casts a ground shadow in water).
  2. Cut the body at a level water plane `cut` pixels above the ground point (vertical
     distances are drawn unforeshortened in this projection, so pre-projection height =
     screen pixels). The cut follows the near edge of the water ring, since a level plane
     meets the body's near side lower on screen.
  3. Lower the result so the waterline sits on the water tile's surface, which is drawn
     WATER_SINK_PX below the land surface (the ground point).
  4. Draw the water ring: its far half behind the body, its near half in front.

Two ring shapes:
  * Flat ellipse, for bodies seen side-on (right), head-on (down) or from behind (up),
    and for the deer, whose rings are nearly circular.
  * Tilted ring, for the wolf's diagonal facings, whose bodies lie along an isometric
    grid axis: an oval on the water surface around the body, drawn the way the game
    draws the ground, grid offset (ox, oy) -> screen (16(ox-oy), 8(ox+oy)).
"""
import argparse
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

SHADOW = np.array([21, 29, 40])                          # ground-shadow color in land sheets
FOAM, RIPPLE, DEEP = (115, 190, 211), (79, 143, 186), (60, 94, 139)  # from tiles.png water
WATER_SINK_PX = 8            # water surface is drawn this far below the land surface

TILE_AXIS_PX = math.hypot(16, 8)   # screen length of one tile along a grid axis
RING_HALF_WIDTH_TILES = 0.3        # tilted ring: half-width across the body, in tiles

# What to build. ground = the frame's ground point (x, topToShadow of the land poses).
SHEETS = {
    "wolf": dict(
        src="wolf-land.png", out="wolf-swim.png",
        rows=range(7), cols=range(8),            # run uses the walk frames, all 7 facings
        frame=(64, 64), ground=(32, 39), out_frame=(64, 64), cut=13,
        # rows 0-3 are the diagonal facings. 0 (up-right) / 2 (down-left) lie along grid
        # axis (0, 1); 1 (down-right) / 3 (up-left) along (1, 0). They get tilted rings.
        axis_by_row={0: (0, 1), 1: (1, 0), 2: (0, 1), 3: (1, 0)},
        sheet_class="wolf-swim",
    ),
    "deer": dict(
        src="stag-land.png", out="stag-swim.png",
        rows=range(7), cols=range(35, 45),       # run frames, all 7 facings
        frame=(48, 41), ground=(24, 33), out_frame=(48, 48), cut=17,  # taller for the ring
        axis_by_row={},
        sheet_class="deer-swim",
    ),
    "hind": dict(
        src="hind-land.png", out="hind-swim.png",
        # the walk frames: the run's lowered head would be under water, and a hind has no
        # antlers above it
        rows=range(7), cols=range(0, 10),
        # lower: without antlers, more of the head, neck and back must show above water
        frame=(48, 41), ground=(24, 33), out_frame=(48, 48), cut=12,
        axis_by_row={},
        sheet_class="deer-swim",
    ),
}


def load(path):
    return np.array(Image.open(path).convert("RGBA"))


def iso(ox, oy):
    return 16 * (ox - oy), 8 * (ox + oy)


def remove_shadow_and_pad(src, out_w, out_h, x_off):
    f = src.copy()
    rgb = f[:, :, :3].astype(int)
    f[(f[:, :, 3] > 0) & (np.abs(rgb - SHADOW).max(2) <= 2)] = 0
    h, w = f.shape[:2]
    canvas = np.zeros((out_h, out_w, 4), np.uint8)
    canvas[:h, x_off:x_off + w] = f
    return canvas


def cut_and_lower(canvas, near_y, cut):
    """Keep body pixels above near_y(x), then lower everything to the water surface."""
    out_h, out_w = canvas.shape[:2]
    body = np.zeros_like(canvas)
    for y in range(out_h):
        for x in range(out_w):
            if canvas[y, x, 3] and y + 0.5 < near_y(x):
                body[y, x] = canvas[y, x]
    shift = cut + WATER_SINK_PX
    out = np.zeros_like(body)
    out[shift:] = body[:out_h - shift]
    return out, shift


def draw_ring(out, far_pts, near_pts):
    out_h, out_w = out.shape[:2]
    for x, y in far_pts:            # behind the body: only where nothing is drawn
        if 0 <= x < out_w and 0 <= y < out_h and out[y, x, 3] == 0:
            out[y, x] = (*DEEP, 255)
    for x, y in near_pts:           # in front: foam line with a ripple line under it
        if 0 <= x < out_w and 0 <= y < out_h:
            out[y, x] = (*FOAM, 255)
            if y + 1 < out_h and out[y + 1, x, 3] == 0:
                out[y + 1, x] = (*RIPPLE, 255)


def draw_point(out, x, y):
    if 0 <= x < out.shape[1] and 0 <= y < out.shape[0]:
        out[y, x] = (*FOAM, 255)


def swim_frame_flat(src, ground, cut, out_w, out_h, x_off, phase):
    canvas = remove_shadow_and_pad(src, out_w, out_h, x_off)
    yw = ground[1] - cut                          # waterline height on the body
    a = canvas[:, :, 3] > 0
    cols = np.nonzero(a[max(0, yw - 1): yw + 2].any(0))[0]
    if len(cols) == 0:                            # nothing at that height: use whole body
        cols = np.nonzero(a.any(0))[0]
    x0, x1 = cols.min(), cols.max()
    cx = (x0 + x1) / 2 + 0.5
    rx = (x1 - x0 + 1) / 2 + 2 + (phase % 2)      # ring breathes by 1px across frames
    ry = min(4.0, max(2.0, rx * 0.35))

    def near_y(x):                                # near (lower) arc of the ring
        t = 1 - ((x + 0.5 - cx) / rx) ** 2
        return yw + ry * math.sqrt(t) if t > 0 else yw

    out, shift = cut_and_lower(canvas, near_y, cut)
    cyw = yw + shift

    def ring_pts(upper):
        pts = set()
        for i in range(720):
            th = 2 * math.pi * i / 720
            x, y = cx + rx * math.cos(th), cyw + ry * math.sin(th)
            if (y < cyw) == upper:
                pts.add((int(math.floor(x)), int(math.floor(y))))
        return pts

    draw_ring(out, ring_pts(True), ring_pts(False))
    for sx in ((-1, 1) if phase % 2 == 0 else (1, -1)):   # wake splashes at the ends
        draw_point(out, int(cx + sx * (rx + 1)), int(cyw + (phase % 3) - 1))
    return out


def tilted_ring(cx, cy, half_len_px, body_axis):
    """Points of a water-surface oval centered on screen point (cx, cy), lying along the
    grid unit vector body_axis. Returns [(x, y, is_near)]; near points face the camera,
    which looks along grid (-1, -1)."""
    u = body_axis
    v = (u[1], u[0])                          # the other grid axis (perpendicular)
    L = half_len_px / TILE_AXIS_PX            # half-length along the body, in tiles
    W = RING_HALF_WIDTH_TILES
    pts = []
    for i in range(1440):
        t = 2 * math.pi * i / 1440
        ox = L * math.cos(t) * u[0] + W * math.sin(t) * v[0]
        oy = L * math.cos(t) * u[1] + W * math.sin(t) * v[1]
        sx, sy = iso(ox, oy)
        pts.append((cx + sx, cy + sy, ox + oy > 0))
    return pts


def swim_frame_tilted(src, ground, cut, out_w, out_h, x_off, phase, body_axis):
    canvas = remove_shadow_and_pad(src, out_w, out_h, x_off)
    yw = ground[1] - cut
    a = canvas[:, :, 3] > 0
    # body extent along its screen axis, near the waterline
    sx_, sy_ = iso(*body_axis)
    n = math.hypot(sx_, sy_)
    ax = (sx_ / n, sy_ / n)
    ys, xs = np.nonzero(a[max(0, yw - 4): yw + 5])
    ys = ys + max(0, yw - 4)
    if len(xs) == 0:
        ys, xs = np.nonzero(a)
    proj = (xs + 0.5) * ax[0] + (ys + 0.5) * ax[1]
    half_len = (proj.max() - proj.min()) / 2 + 2 + (phase % 2)   # ring breathes by 1px
    cx = (xs.min() + xs.max()) / 2 + 0.5
    pts = tilted_ring(cx, yw, half_len, body_axis)

    cols = {}                                 # lowest (nearest) edge of the oval per column
    for x, y, _ in pts:
        c = int(math.floor(x))
        cols[c] = max(cols.get(c, -1e9), y)
    cmin, cmax = min(cols), max(cols)

    def near_y(x):
        return cols.get(min(max(x, cmin), cmax), yw)

    out, shift = cut_and_lower(canvas, near_y, cut)
    ring = [(int(math.floor(x)), int(math.floor(y + shift)), near) for x, y, near in pts]
    draw_ring(out, [(x, y) for x, y, near in ring if not near],
                   [(x, y) for x, y, near in ring if near])
    for sgn in ((-1, 1) if phase % 2 == 0 else (1, -1)):   # wake splashes at the ends
        draw_point(out, int(cx + sgn * (half_len + 1) * ax[0]),
                   int(yw + shift + sgn * (half_len + 1) * ax[1] + (phase % 3) - 1))
    return out


def build(spec, cut, src_dir, out_path):
    S = load(src_dir / spec["src"])
    fw, fh = spec["frame"]
    out_w, out_h = spec["out_frame"]
    rows, cols = list(spec["rows"]), list(spec["cols"])
    x_off = (out_w - fw) // 2
    ground = (spec["ground"][0] + x_off, spec["ground"][1])
    sheet = np.zeros((len(rows) * out_h, len(cols) * out_w, 4), np.uint8)
    for ri, r in enumerate(rows):
        for ci, c in enumerate(cols):
            src = S[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw]
            axis = spec["axis_by_row"].get(r)
            frame = (swim_frame_tilted(src, ground, cut, out_w, out_h, x_off, ci, axis)
                     if axis else swim_frame_flat(src, ground, cut, out_w, out_h, x_off, ci))
            sheet[ri * out_h:(ri + 1) * out_h, ci * out_w:(ci + 1) * out_w] = frame
    Image.fromarray(sheet).save(out_path)
    return sheet


def current_top_to_shadow(sheet_class):
    """Read the swim pose's topToShadow for this sheet class from animat.js, if found."""
    try:
        src = (PROJECT / "animat.js").read_text()
    except OSError:
        return None
    m = re.search(r'sheet:\s*"' + re.escape(sheet_class) + r'".*?topToShadow:\s*(\d+)', src, re.S)
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wolf-cut", type=int, default=SHEETS["wolf"]["cut"],
                    help="wolf waterline height above the ground point, px (default %(default)s)")
    ap.add_argument("--deer-cut", type=int, default=SHEETS["deer"]["cut"],
                    help="deer waterline height above the ground point, px (default %(default)s)")
    ap.add_argument("--hind-cut", type=int, default=SHEETS["hind"]["cut"],
                    help="hind waterline height above the ground point, px (default %(default)s)")
    ap.add_argument("--src-dir", type=Path, default=IMAGES, help="where the land sheets are")
    ap.add_argument("--out-dir", type=Path, default=IMAGES, help="where to write the swim sheets")
    ap.add_argument("--only", choices=list(SHEETS), help="build just one species' sheet")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    for species, spec in SHEETS.items():
        if args.only and species != args.only:
            continue
        cut = {"wolf": args.wolf_cut, "deer": args.deer_cut, "hind": args.hind_cut}[species]
        out_path = args.out_dir / spec["out"]
        build(spec, cut, args.src_dir, out_path)
        need = spec["ground"][1]   # same as the land poses: frames keep the ground point
        have = current_top_to_shadow(spec["sheet_class"])
        status = ("matches animat.js" if have == need else
                  f"animat.js has {have}: update it to {need}" if have is not None else
                  "(not found in animat.js)")
        print(f"{species}: wrote {out_path}  (waterline {cut}px)  "
              f"swim topToShadow needed: {need}  {status}")


if __name__ == "__main__":
    main()
