#!/usr/bin/env python3
"""The deer carcass: its 8 pieces of meat, each drawn either whole or as its bones, and a
shadow under it.

    images/stag-walk-idle-run.png  ->  images/deer-carcass.png

Usage (from anywhere; needs Python 3 with Pillow):

    python3 spritecraft/make_deer_carcass.py
    python3 spritecraft/make_deer_carcass.py --preview /tmp/carcass.png   # also an enlarged preview

The whole carcass is the deer lying dead on its side: the last frame of the death
animation (make_deer_death.py), put together from parts (legs, body, tail, antlers, head,
ear) - except its shadow, which here hugs the body's underside so it lies on the ground.
A wolf eats its pieces in any order, so the carcass is drawn as 9 layers, always all of
them, each piece as its MEAT or, once eaten, its BONES (sim.js and animat.js, CARCASSES):

  1. the shadow                                   (always)
  2. the GROUND legs (the far side, under it), hind and fore: each leg, with a drumstick
     of meat reaching up into the body, so that it still looks like a whole leg when the
     body in front of it is eaten. Hidden behind the body while that is whole.
  3. the BODY - everything but the legs - in 4 sections, every pixel in exactly one:
       hips     the tail and the rear of the body       (Butt/Hips)
       midback  the middle of the body                  (Stomach/MidBack)
       chest    the front of the body, and the neck     (Chest/UpperBack)
       head     the head, ear and antlers               (Neck/Head)
  4. the SKY legs (the near side, on top), hind and fore: each leg as drawn on the dead
     deer, with its thigh's meat over the body (the body's own pixels, so the whole
     carcass is unchanged); as bones, the leg's whole skeleton, up to its hip or
     shoulder joint, over the body however much of that is left.
With every piece whole it is exactly the dead deer (but for the shadow).

The bones: the spine along the back, ribs down through the mid back and chest, the
pelvis in the hips, neck vertebrae from the chest to the skull, the skull where the head
was (antlers kept), and each leg's bones (hooves kept) up to its joint in the body.

THE SHEET: 48 x 48 frames, as the death sheet; row 0 facing N, row 1 facing E (mirrored
for the others, as the death sheet). Column 0 the shadow; then for each piece, in
SHEET_PIECES order (bottom to top), its meat and then its bones.
"""

import argparse
from pathlib import Path

from PIL import Image

import make_deer_death as D

PROJECT = Path(__file__).resolve().parent.parent
IMAGES = PROJECT / "images"

# The pieces, bottom layer to top (animat.js carcassSheetPieces: keep in step).
SHEET_PIECES = ["groundHind", "groundFore", "hips", "midback", "chest", "head", "skyHind", "skyFore"]
BODY_SECTIONS = ["hips", "midback", "chest", "head"]

# Bone colours (with the deer's own darks for sockets and hooves).
BONE = {
    "W": (226, 216, 190),  # bone, lit
    "V": (186, 170, 140),  # bone, shaded
    "U": (128, 110, 92),   # bone, deep shade
}
PALETTE = {**D.PALETTE, **BONE}
SHADOW_ALPHA = 150  # the shadow is see-through, like a shadow

W, H = D.FRAME_W, D.CANVAS_H


def blank():
    return [["."] * W for _ in range(H)]


def corpse_parts(facing_fn, stand):
    """The dead frame's parts, in drawing order: [(lines, (x, y))]."""
    calls = []
    original = D.compose

    def recording(parts, W=D.FRAME_W, H=D.CANVAS_H):
        calls.append(parts)
        return original(parts, W, H)

    D.compose = recording
    try:
        facing_fn(stand)
    finally:
        D.compose = original
    return calls[-1]


def pixels(lines, pos):
    """{(x, y): ch} of a part placed at pos."""
    ox, oy = pos
    out = {}
    for y, l in enumerate(lines):
        for x, ch in enumerate(l):
            if ch != "." and 0 <= oy + y < H and 0 <= ox + x < W:
                out[(ox + x, oy + y)] = ch
    return out


def edge(p, region):
    x, y = p
    return any((x + dx, y + dy) not in region for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def line(x0, y0, x1, y1):
    steps = max(1, abs(x1 - x0) + abs(y1 - y0))
    return [(round(x0 + (x1 - x0) * k / steps), round(y0 + (y1 - y0) * k / steps)) for k in range(steps + 1)]


def carcass(facing_fn, stand, names, legs, splits, hips_joint):
    """{column name: canvas} for one facing. names: each part's name, in drawing order;
    legs: which leg part is which piece; splits: x where the mid back and the chest
    begin; hips_joint: x of the pelvis."""
    parts = dict(zip(names, corpse_parts(facing_fn, stand)))
    hips_to, mid_to = splits

    # THE BODY: its parts drawn together (later over earlier), each pixel in one section
    body, section, skull = {}, {}, set()
    for name in names:
        if name == "shadow" or name in legs:
            continue
        for p, ch in pixels(*parts[name]).items():
            body[p] = ch
            section[p] = ("hips" if name == "tail" else "head" if name in ("head", "ear", "antlers")
                          else "hips" if p[0] < hips_to else "midback" if p[0] < mid_to else "chest")
            if name in ("head", "ear"):
                skull.add(p)
            else:
                skull.discard(p)

    cols = {}
    for s in BODY_SECTIONS:
        meat = blank()
        for (x, y), ch in body.items():
            if section[(x, y)] == s:
                meat[y][x] = ch
        cols[s] = meat

    # the body's bones (each in the section it lies in), within the body's outline
    bones = {}

    def put(x, y, ch):
        if (x, y) in body:
            bones[(x, y)] = ch

    top, bottom = {}, {}
    for (x, y) in body:
        if section[(x, y)] != "head":
            top[x] = min(top.get(x, y), y)
            bottom[x] = max(bottom.get(x, y), y)
    for x in sorted(top):  # the spine, a row in from the back
        put(x, top[x] + 1, "W" if x % 2 else "V")
    for x in sorted(top):  # ribs, every other column of the mid back and chest
        if x >= hips_to and x % 2 == 0:
            depth = bottom[x] - top[x]
            for y in range(top[x] + 2, top[x] + 2 + max(1, int(depth * 0.6))):
                put(x, y, "W" if y < top[x] + 2 + depth * 0.35 else "V")
    for x in range(hips_joint - 2, hips_joint + 2):  # the pelvis
        if x in top:
            mid = (top[x] + bottom[x]) // 2
            for y in range(mid - 1, mid + 1):
                put(x, y, "V" if (x + y) % 2 else "W")
    for (x, y) in skull:  # the skull: the head's shape in bone, an eye socket
        put(x, y, "k" if body[(x, y)] == "z" else "V" if edge((x, y), skull) else "W")
    for p, ch in body.items():  # antlers as they were
        if section[p] == "head" and p not in skull:
            bones[p] = ch
    if skull and top:  # neck vertebrae, from the chest's top front to the skull
        x0 = max(top)
        hx0 = min(x for x, y in skull)
        ys = sorted(y for x, y in skull if x == hx0)
        for k, (x, y) in enumerate(line(x0, top[x0] + 1, hx0, ys[len(ys) // 2])):
            if (x, y) not in skull:
                put(x, y, "W" if k % 2 else "V")
    for s in BODY_SECTIONS:
        g = blank()
        for (x, y), ch in bones.items():
            if section[(x, y)] == s:
                g[y][x] = ch
        cols[s + ":bones"] = g

    # THE LEGS
    shape = set(body)
    for name, piece in legs.items():
        own = pixels(*parts[name])
        ground = piece.startswith("ground")
        hind = piece.endswith("Hind")
        # the leg's top: its highest pixel (the one nearest the body's middle if several)
        ty = min(y for x, y in own)
        tx = min((x for x, y in own if y == ty), key=lambda x: abs(x - (hips_to + mid_to) / 2))
        # the thigh: a round of meat above the leg's top, within the body's outline
        r = (3.2 if hind else 2.6) - (0 if ground else 0.6)
        cx, cy = tx, ty - r + 1
        thigh = {(x, y) for (x, y) in body if ((x - cx) / r) ** 2 + ((y - cy) / (r * 0.9)) ** 2 <= 1}
        meat = blank()
        if ground:
            # its own drumstick, seen only once the body in front of it is eaten
            for (x, y) in thigh:
                meat[y][x] = ("m" if (x, y + 1) not in thigh else "R") if edge((x, y), thigh) else "O"
        else:
            for (x, y) in thigh:  # the body's own pixels: the whole carcass is unchanged
                meat[y][x] = body[(x, y)]
        for (x, y), ch in own.items():
            meat[y][x] = ch
        cols[piece] = meat
        shape |= set(own)
        # its bones: the leg in bone (hooves kept), then the thigh bone up to the joint
        g = blank()
        for (x, y), ch in own.items():
            g[y][x] = ch if ch in ("k", "n", "K") else "W" if (x, y + 1) in own else "V"
        jx, jy = round(cx), round(cy)
        for k, (x, y) in enumerate(line(tx, ty, jx, jy)):
            g[y][x] = "W" if k % 2 else "V"
        for dx, dy, ch in ((0, 0, "W"), (1, 0, "V"), (0, -1, "W"), (1, -1, "U")):  # the joint
            if 0 <= jx + dx < W and 0 <= jy + dy < H:
                g[jy + dy][jx + dx] = ch
        cols[piece + ":bones"] = g

    # THE SHADOW: hugging the underside of the whole carcass
    lowest = {}
    for x, y in shape:
        lowest[x] = max(lowest.get(x, y), y)
    shadow = blank()
    xs = sorted(lowest)
    for x in xs:
        y = lowest[x]
        for k in range(1, 3 if (x, y) in body else 2):  # under the body a little deeper
            if y + k < H and (x, y + k) not in shape:
                shadow[y + k][x] = "s"
    for x, nx in ((xs[0] - 1, xs[0]), (xs[-1] + 1, xs[-1])):  # rounded ends
        if 0 <= x < W and lowest[nx] + 1 < H:
            shadow[lowest[nx] + 1][x] = "s"
    cols["shadow"] = shadow
    return {k: ["".join(r) for r in g] for k, g in cols.items()}


def sheet_columns():
    out = ["shadow"]
    for p in SHEET_PIECES:
        out += [p, p + ":bones"]
    return out


def render(rows):
    cols = sheet_columns()
    sheet = Image.new("RGBA", (D.FRAME_W * len(cols), D.FRAME_H * len(rows)), (0, 0, 0, 0))
    for r, canvases in enumerate(rows):
        for k, name in enumerate(cols):
            alpha = SHADOW_ALPHA if name == "shadow" else 255
            for y, l in enumerate(canvases[name]):
                for x, ch in enumerate(l):
                    if ch != ".":
                        sheet.putpixel((k * D.FRAME_W + x, r * D.FRAME_H + D.CANVAS_TOP + y), PALETTE[ch] + (alpha,))
    return sheet


def compose_state(sheet, row, eaten, shadow=True):
    """The carcass as drawn with the pieces in `eaten` gone (for previews and checks)."""
    cols = sheet_columns()
    out = Image.new("RGBA", (D.FRAME_W, D.FRAME_H), (0, 0, 0, 0))
    names = (["shadow"] if shadow else []) + [p + (":bones" if p in eaten else "") for p in SHEET_PIECES]
    for n in names:
        k = cols.index(n)
        out.alpha_composite(sheet.crop((k * D.FRAME_W, row * D.FRAME_H, (k + 1) * D.FRAME_W, (row + 1) * D.FRAME_H)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=IMAGES / "stag-walk-idle-run.png")
    ap.add_argument("--out-dir", type=Path, default=IMAGES)
    ap.add_argument("--preview", type=Path, help="also save an enlarged preview here")
    args = ap.parse_args()
    src = Image.open(args.src).convert("RGBA")
    # the dead frame's parts in drawing order (see make_deer_death.py, frame F4); legA and
    # legB are drawn before the body (the ground side), legC and legD after it (the sky side)
    n_parts = ["shadow", "legA", "legB", "body", "tail", "antlers", "head", "legC", "legD"]
    e_parts = ["shadow", "legA", "legB", "body", "tail", "antlers", "head", "ear", "legC", "legD"]
    rows = [
        # facing N: sky legs at x 21 (fore) and 13 (hind), ground legs at 24 (fore) and 16 (hind)
        carcass(D.facing_n, D.standing(src, 0), n_parts,
                {"legA": "groundFore", "legB": "groundHind", "legC": "skyFore", "legD": "skyHind"}, (16, 22), 13),
        # facing E: sky legs at x 23 (fore) and 12 (hind), ground legs at 28 (fore) and 17 (hind)
        carcass(D.facing_e, D.standing(src, 1), e_parts,
                {"legA": "groundHind", "legB": "groundFore", "legC": "skyHind", "legD": "skyFore"}, (16, 22), 13),
    ]
    sheet = render(rows)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / "deer-carcass.png"
    sheet.save(out)
    print(f"wrote {out}  ({sheet.width}x{sheet.height}: shadow + {len(SHEET_PIECES)} pieces as meat and bones, rows facing N and E)")
    if args.preview:
        states = [set(), {"hips", "midback"}, {"chest", "skyFore"}, {"groundHind", "hips", "midback", "skyHind"},
                  {"hips", "midback", "chest", "head"}, set(SHEET_PIECES) - {"groundFore", "skyHind"}, set(SHEET_PIECES)]
        prev = Image.new("RGBA", (D.FRAME_W * len(states), D.FRAME_H * 2), (120, 170, 80, 255))
        for r in range(2):
            for k, st in enumerate(states):
                prev.alpha_composite(compose_state(sheet, r, st), (k * D.FRAME_W, r * D.FRAME_H))
        prev.resize((prev.width * 6, prev.height * 6), Image.NEAREST).save(args.preview)


if __name__ == "__main__":
    main()
