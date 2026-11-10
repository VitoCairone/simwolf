#!/usr/bin/env python3
"""Pine trees and saplings, drawn by this script at their real size.

PLACEHOLDER: AI-generated (the artist drew no trees), not canonical: to be replaced, and
not to be used as a base for new art (admin/design_notes.md).

    ->  images/pines.png        crowns, their shadows, and saplings
        images/pine-trunks.png  trunks, by width (make_pine_trunks.py)
        images/pines.js         where each sprite lies in them (read by animat.js PINES)

Usage (from anywhere; needs Python 3 with Pillow):

    python3 spritecraft/make_pines.py                 # regenerate all three
    python3 spritecraft/make_pines.py --out-dir /tmp  # write somewhere else to compare
    python3 spritecraft/make_pines.py --preview p.png # also save a preview on grass

SIZES: in real proportion, at the game's scale: a metre across the line of sight is
PX_PER_M_ACROSS px (a tile's 32 px diagonal is 1.41 m); the game looks down at 30
degrees (a tile is twice as wide as it is deep), so a metre up is PX_PER_M_UP px
(cos 30 of that) and a level circle is an ellipse half as deep as it is wide. Each tree
is drawn for the middle of its diameter class (sim.js pineClasses), grown in a forest or
in the open, by the same rules as sim.js PINES (FVS Lake States variant, white pine):
height by diameter (height_m), crown at its widest by diameter (crown_radius_m), its
live crown CROWN_RATIO of its height (a small tree, the first class, keeps its low
branches: SMALL_CROWN_RATIO). Saplings 1, 2 and 3 m tall, as wide as sim.js's foliage.

THE LOOK: a conifer of stacked tiers, each a cone seen from above: its lower edge the
front half of an ellipse, outlined, with the tier above casting a shade band onto it;
lit from the left. Its shadow on the ground (the crown's footprint, an ellipse) is a
sprite of its own, drawn beneath its trunk; the trunk comes from pine-trunks.png, as
wide as the tree's own, drawn up into the crown (trunkPX). Shapes vary by a seeded
random jitter (two of each), so the sheet is the same every run.
"""

import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image

import make_pine_trunks as trunks

PX_PER_M_ACROSS = trunks.PX_PER_M_ACROSS
PX_PER_M_UP = PX_PER_M_ACROSS * math.cos(math.radians(30))
SHEET_W = 2048
VARIANTS = 2

PALETTE = {
    "outline": (25, 51, 45),
    "dark": (37, 86, 46),
    "mid": (70, 130, 50),
    "light": (117, 167, 67),
    "glint": (168, 202, 88),
    "shadow": (16, 20, 31),
}

# as sim.js PINES
CLASSES = [(10, 18), (20, 28), (30, 38), (41, 48), (51, 58), (61, 69), (71, 79)]
CROWN_RATIO = {"forest": 0.4, "open": 0.7}
SMALL_CROWN_RATIO = 0.85
SAPLING_HEIGHTS = [1.0, 2.0, 3.0]
FT, INCH = 0.3048, 2.54


def height_m(dbh_cm):
    return (4.5 + 2108.8442 * math.exp(-5.6595 * (dbh_cm / INCH) ** -0.1856)) * FT


def crown_radius_m(dbh_cm, open_grown):
    d = dbh_cm / INCH
    ft = min(58, 1.62 + 3.197 * d ** 0.7981) if open_grown else min(45, 0.3914 + 0.9923 * d + 0.1080 * CROWN_RATIO["forest"] * 100)
    return ft * FT / 2


def sapling_radius_m(h):
    return min(0.6, 0.15 + 0.15 * h)


def blank(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def put(im, x, y, colour, alpha=255):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), colour + (alpha,))


def shadow_sprite(radius_m):
    """The crown's footprint on the ground: (image, foot x, foot y)."""
    rx = max(2.0, radius_m * PX_PER_M_ACROSS)
    ry = rx / 2
    w, h = math.ceil(2 * rx) + 2, math.ceil(2 * ry) + 2
    im = blank(w, h)
    fx, fy = w / 2, h / 2
    for y in range(h):
        for x in range(w):
            d = ((x + 0.5 - fx) / rx) ** 2 + ((y + 0.5 - fy) / ry) ** 2
            if d <= 1:
                put(im, x, y, PALETTE["shadow"], int(80 * (1 - d) ** 0.6))
    return im, w // 2, h // 2


def tier_mask(cx, cy, rx, ry, ax, ay, w, h):
    """The pixels of a cone seen from above: its rim an ellipse centered (cx, cy), its
    apex (ax, ay): {(x, y)}."""
    out = set()
    x0, x1 = max(0, math.floor(cx - rx) - 1), min(w, math.ceil(cx + rx) + 2)
    y0, y1 = max(0, math.floor(min(ay, cy - ry)) - 1), min(h, math.ceil(cy + ry) + 2)
    cxn, cyn = (cx - ax) / rx, (cy - ay) / ry
    for y in range(y0, y1):
        for x in range(x0, x1):
            dx, dy = (x + 0.5 - ax) / rx, (y + 0.5 - ay) / ry
            dd = dx * dx + dy * dy
            if dd == 0:
                continue
            u = max(1.0, (dx * cxn + dy * cyn) / dd)
            if (u * dx - cxn) ** 2 + (u * dy - cyn) ** 2 <= 1:
                out.add((x, y))
    return out


def crown(im, fx, fy, height, base, radius, seed):
    """Draws a crown of tiers into im: the tree's foot (fx, fy) (fx a pixel boundary),
    its top `height` m up, its crown from `base` m, at its widest `radius` m."""
    rng = random.Random(seed)
    S, V = PX_PER_M_ACROSS, PX_PER_M_UP
    length = height - base
    n = max(2, round(length / rng.uniform(1.5, 2.1) / max(1.0, (height / 20) ** 0.5)))
    painted = {}
    for i in range(n):
        t = i / n
        h0 = base + length * t + (rng.uniform(-0.15, 0.15) * length / n if i else 0)
        r = radius * (0.85 + 0.15 * t / 0.2 if t < 0.2 else ((1 - t) / 0.8) ** 0.9)
        r = max(0.12, r * rng.uniform(0.86, 1.04))
        top = height if i == n - 1 else min(height, h0 + length / n * rng.uniform(2.4, 3.2))
        cx = fx + rng.uniform(-0.6, 0.6) * (1 + r)
        cy = fy - h0 * V
        rx, ry = r * S, r * S / 2
        ax, ay = fx + rng.uniform(-0.5, 0.5), fy - top * V
        mask = tier_mask(cx, cy, rx, ry, ax, ay, im.width, im.height)
        rim = lambda x: cy + ry * math.sqrt(max(0.0, 1 - ((x + 0.5 - cx) / rx) ** 2))
        # tufts of needles hanging from its edge
        tufts = set()
        for x, y in mask:
            for dx, dy in ((1, 0), (-1, 0), (0, 1)):
                if (x + dx, y + dy) not in mask and rng.random() < 0.35:
                    for k in range(1, rng.randrange(2, 4)):
                        tufts.add((x + dx * k, y + dy * k + (k > 1 and dy == 0)))
        tufts -= mask
        # the shade this tier casts on what is below its rim
        for (x, y), _ in list(painted.items()):
            if abs(x + 0.5 - cx) < rx and 0 < y + 0.5 - rim(x) <= max(2, ry * 0.25):
                put(im, x, y, PALETTE["outline" if y + 0.5 - rim(x) <= 1 else "dark"])
        rows = {}
        for x, y in mask:
            lo, hi = rows.get(y, (x, x))
            rows[y] = (min(lo, x), max(hi, x))
        for x, y in mask:
            lo, hi = rows[y]
            mid, half = (lo + hi + 1) / 2, max(1.0, (hi - lo + 1) / 2)
            s = (x + 0.5 - mid) / half               # -1 left (lit) .. 1 right
            above = rim(x) - (y + 0.5)               # px above the rim's front edge
            front = y + 0.5 > cy and abs(x + 0.5 - cx) < rx
            edge = any((x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, -1)))
            if front and above <= 1.2:
                c = "outline"                        # the rim
            elif edge and s > -0.2:
                c = "outline"
            elif front and above <= max(2.5, ry * 0.3):
                c = "mid" if s < -0.3 else "dark"    # the rim's underside
            elif s < -0.35:
                c = "glint" if rng.random() < 0.12 else "light"
            elif s < 0.35:
                c = "light" if rng.random() < 0.1 else "mid"
            else:
                c = "outline" if rng.random() < 0.08 else "dark"
            put(im, x, y, PALETTE[c])
            painted[(x, y)] = True
        for x, y in tufts:
            if 0 <= x < im.width and 0 <= y < im.height:
                put(im, x, y, PALETTE["outline" if rng.random() < 0.6 else "dark"])
                painted[(x, y)] = True


def crown_sprite(height, base, radius, seed):
    """(image, foot x, foot y) of a crown, with room for its lowest rim."""
    S, V = PX_PER_M_ACROSS, PX_PER_M_UP
    w = math.ceil(2 * radius * S * 1.05) + 8
    w += w % 2
    below = max(0, math.ceil(radius * S / 2 - base * V)) + 3
    fy = math.ceil(height * V) + 3
    im = blank(w, fy + below)
    crown(im, w // 2, fy, height, base, radius, seed)
    return im, w // 2, fy


def sapling_sprite(height, seed):
    """(image, foot x, foot y): a sapling whole, shadow and stem and foliage."""
    radius = sapling_radius_m(height)
    shadow, sfx, sfy = shadow_sprite(radius)
    c, fx, fy = crown_sprite(height, 0.1, radius, seed)
    im = blank(c.width, c.height)
    im.alpha_composite(shadow, (fx - sfx, fy - sfy))
    for y in range(fy - round(height * 0.5 * PX_PER_M_UP), fy + 1):
        put(im, fx - 1, y, trunks.BARK["light"])
        put(im, fx, y, trunks.BARK["dark"])
    im.alpha_composite(c)
    return im, fx, fy


def pack(items):
    """Shelf-packs {key: image} into a sheet: (sheet, {key: (x, y)})."""
    order = sorted(items, key=lambda k: -items[k].height)
    at, x, y, row = {}, 0, 0, 0
    for k in order:
        im = items[k]
        if x + im.width > SHEET_W:
            x, y, row = 0, y + row + 1, 0
        at[k] = (x, y)
        x += im.width + 1
        row = max(row, im.height)
    sheet = blank(SHEET_W, y + row + 1)
    for k in order:
        sheet.alpha_composite(items[k], at[k])
    return sheet, at


def build():
    items, feet, saplings, trees = {}, {}, [], []
    for n, h in enumerate(SAPLING_HEIGHTS):
        for v in range(VARIANTS):
            key = ("sapling", n, v)
            items[key], *feet[key] = sapling_sprite(h, 100 + 7 * n + v)
            saplings.append({"heightM": h, "variant": v, "key": key})
    for k, (lo, hi) in enumerate(CLASSES):
        dbh = (lo + hi) / 2
        for form in ("forest", "open"):
            height = height_m(dbh)
            radius = crown_radius_m(dbh, form == "open")
            ratio = SMALL_CROWN_RATIO if k == 0 else CROWN_RATIO[form]
            base = height * (1 - ratio)
            for v in range(VARIANTS):
                ck, sk = ("crown", k, form, v), ("shadow", k, form, v)
                items[ck], *feet[ck] = crown_sprite(height, base, radius, 300 + 31 * k + 7 * v + (13 if form == "open" else 0))
                items[sk], *feet[sk] = shadow_sprite(radius)
                trunk_px = min(trunks.TRUNK_PX, round((base + 0.3 * (height - base)) * PX_PER_M_UP))
                trees.append({"size": k + 2, "open": form == "open", "variant": v, "dbhCm": dbh,
                              "heightM": round(height, 4), "crownBaseM": round(base, 4), "crownRadiusM": round(radius, 4),
                              "trunkPX": trunk_px, "keys": (ck, sk)})
    sheet, at = pack(items)
    rect = lambda key: [*at[key], items[key].width, items[key].height, *feet[key]]
    for s in saplings:
        s["rect"] = rect(s.pop("key"))
    for t in trees:
        ck, sk = t.pop("keys")
        t["crown"], t["shadow"] = rect(ck), rect(sk)
    layout = {"pxPerMAcross": PX_PER_M_ACROSS, "pxPerMUp": PX_PER_M_UP, "saplings": saplings, "trees": trees,
              "trunks": trunks.layout()}
    return sheet, trunks.build(), layout


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out-dir", default=str(here.parent / "images"))
    ap.add_argument("--preview")
    args = ap.parse_args()
    sheet, trunk_sheet, layout = build()
    out = Path(args.out_dir)
    sheet.save(out / "pines.png")
    trunk_sheet.save(out / "pine-trunks.png")
    with open(out / "pines.js", "w") as f:
        f.write("// Made by spritecraft/make_pines.py: do not edit. Where each pine sprite lies in\n"
                "// images/pines.png and images/pine-trunks.png (see that script and animat.js PINES):\n"
                "// a rect is [x, y, w, h, foot x, foot y], its foot going on the tile's center.\n")
        f.write("var pineSheet = " + json.dumps(layout, separators=(",", ":")) + ";\n")
    print("wrote", out / "pines.png", sheet.size, out / "pine-trunks.png", trunk_sheet.size, out / "pines.js")
    if args.preview:
        preview(sheet, trunk_sheet, layout, args.preview)


def preview(sheet, trunk_sheet, layout, path):
    """A row of the trees as the game draws them (forest-grown, then open-grown), on grass."""
    trees = [t for t in layout["trees"] if t["variant"] == 0]
    tr = layout["trunks"]
    gap = 10
    w = sum(t["crown"][2] for t in trees) + gap * len(trees) + 40
    h = max(t["crown"][5] for t in trees) + 80
    im = Image.new("RGBA", (w, h), (96, 140, 70, 255))
    x = 20
    for t in trees:
        cx, cy, cw, ch, cfx, cfy = t["crown"]
        fx, fy = x + cfx, h - 60
        sx, sy, sw, sh, sfx, sfy = t["shadow"]
        im.alpha_composite(sheet.crop((sx, sy, sx + sw, sy + sh)), (fx - sfx, fy - sfy))
        width = max(tr["widths"][0], min(tr["widths"][-1], round(t["dbhCm"] / 100 * layout["pxPerMAcross"])))
        col = tr["widths"].index(width)
        top = tr["footY"] - t["trunkPX"]
        im.alpha_composite(trunk_sheet.crop((col * tr["cellW"], top, (col + 1) * tr["cellW"], tr["cellH"])), (fx - tr["footX"], fy - t["trunkPX"]))
        im.alpha_composite(sheet.crop((cx, cy, cx + cw, cy + ch)), (fx - cfx, fy - cfy))
        x += cw + gap
    im.save(path)


if __name__ == "__main__":
    main()
