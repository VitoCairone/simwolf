#!/usr/bin/env python3
"""From a posed wolf (wolf_pose.py) to pixel art: the rules that colour it, a pixel at a time;
the wolf's counterpart of deer_pixels.py, whose Scene and helpers this reuses.

THE PALETTE (images/wolf-land.png, as wolf_runfit.letters reads it):
    D coat   E light   F shade   H pale (bib, cheeks)   J darkest (paws, nose)   G black (eyes)
    'j' the shadow, '.' clear

GENERATED ART: frames drawn by these rules are not the artist's, and not canonical
(admin/design_notes.md).
"""

import numpy as np

import deer_pixels as px
import wolf_pose as wp

FW, FH = 64, 64

RULE_PARAMS = {  # fitted to the artist's frames (wolf_runtest.py --tune); a rule the fit
                 # found no help is switched off by its number (0, or a threshold never met)
    "leg.near": "FDD",         # a lower leg's colours, up from the paw (the last repeats)
    "leg.far": "FFJ",
    "paw.fwd": 1,              # the paw: this many pixels more, toward the front, at the bottom
    "leg.wide_near": 1,        # a near lower leg two pixels wide: the second toward the front (1)
    "leg.wc_near": "D",        # ...or the back (-1), in this colour; (0: one pixel wide)
    "leg.wide_far": 0, "leg.wc_far": "D",   # ...and a far one
    "near.arm": -0.6,          # the near foreleg's upper part lit (E) where its normal faces
                               # the camera's side this much (across the body)
    "near.thigh": 1.0,         # ...and the near thigh, where it faces forward this much,
    "thigh.rows": 1,           # ...and its lowest pixels, this many up from its edge
    "bib.facing": 0.8,         # the pale bib: the chest, throat and neck where they face forward this much,
    "bib.z0": 0.15,            # ...above this share of the body's depth,
    "bib.f": 1.0,              # ...forward of this share of the way from hips to withers
    "bib.rim": 0,              # ...with a light rim this wide behind it
    "front.f": 0.95,           # the front of the body lit: forward of this share of hips to withers,
    "front.z": 0.65,           # ...below this share of its depth
    "under.rows": 3,           # the light along the underside: this many pixels up from its edge,
    "under.z": 0.3,            # ...below this share of the body's depth
    "under.edge": 0,           # ...its very edge in shade (1) or not (0)
    "far.limbs": 0,            # the far legs' upper parts in shade (1) or not (0)
    "tail.tip": 0.05,          # the tail's tip lit: this share of its length,
    "tail.tipc": "E",          # ...this colour
    "tail.under": 0,           # the tail's lower edge in shade (1) or not (0)
    "shadow.len": 1.85, "shadow.wide": 2.0, "shadow.f": -0.95,
}


def edges(sc, out, ctx):
    return px.edges(sc, out, ctx)


def r_fur(sc, out, P, ctx):
    """Every pixel the body covers starts in the coat colour."""
    ctx["fur"] = sc.part != None  # noqa: E711
    out[ctx["fur"]] = "D"


def r_lower_legs(sc, out, P, ctx):
    """The lower legs (carpus or hock down): a line a pixel or two wide, coloured by its steps
    up from the paw; the paw wider toward the front. Hidden where the body is nearer."""
    dx, dy = px.front_step(sc.caster)
    for leg, pts in px.lower_legs(sc).items():
        far = leg.endswith(sc.far)
        seq = P["leg.far"] if far else P["leg.near"]
        wide, wc = (P["leg.wide_far"], P["leg.wc_far"]) if far else (P["leg.wide_near"], P["leg.wc_near"])
        for i, (x, y, d) in enumerate(reversed(pts)):
            cells = [(x, y, seq[min(i, len(seq) - 1)])]
            if i == 0:
                cells += [(x + dx * k, y + dy * k, cells[0][2]) for k in range(1, int(P["paw.fwd"]) + 1)]
            elif wide:
                cells.append((x + dx * wide, y + dy * wide, wc))
            for (cx, cy, col) in cells:
                if not (0 <= cx < out.shape[1] and 0 <= cy < out.shape[0]):
                    continue
                if sc.part[cy, cx] is not None and sc.dep[cy, cx] > d:
                    continue
                out[cy, cx] = col
                ctx["fur"][cy, cx] = False


def r_head(sc, out, P, ctx):
    """The head: the artist's block, pasted with its poll on the skeleton's."""
    px.r_head(sc, out, P, ctx)


def r_near_legs(sc, out, P, ctx):
    """The near foreleg's upper parts are lit; so are the near thigh's front and bottom."""
    n = sc.near
    side = sc.nlocal[:, :, 1] * (1 if n == "L" else -1)       # facing out of the near side
    out[ctx["fur"] & sc.is_part("arm" + n, "fore" + n) & (side > P["near.arm"])] = "E"
    thigh = ctx["fur"] & sc.is_part("thigh" + n, "shank" + n)
    out[thigh & (sc.nlocal[:, :, 0] > P["near.thigh"])] = "E"
    e = edges(sc, out, ctx)
    out[thigh & (e["down"] < P["thigh.rows"])] = "E"


def r_far_legs(sc, out, P, ctx):
    """The far legs' upper parts are in shade."""
    if P["far.limbs"]:
        f = sc.far
        out[ctx["fur"] & sc.is_part("arm" + f, "fore" + f, "thigh" + f, "shank" + f)] = "F"


def r_bib(sc, out, P, ctx):
    """The pale bib: the chest, throat and neck where they face forward; a light rim behind."""
    z, f = px.shares(sc)
    m = (ctx["fur"] & sc.is_part("trunk", "neck") & (sc.nlocal[:, :, 0] > P["bib.facing"]) & (z > P["bib.z0"])
         & (f > P["bib.f"]))
    out[m] = "H"
    dx, dy = px.front_step(sc.caster)
    rim = m.copy()
    for k in range(1, int(P["bib.rim"]) + 1):
        rim |= px.neighbours(m, dy * k, dx * k)
    out[ctx["fur"] & rim & ~m & (out == "D")] = "E"


def r_front_light(sc, out, P, ctx):
    """The front of the body, low down (the chest's side, behind the forelegs), is lit."""
    z, f = px.shares(sc)
    out[ctx["fur"] & sc.is_part("trunk") & (f > P["front.f"]) & (z < P["front.z"]) & (out == "D")] = "E"


def r_underside(sc, out, P, ctx):
    """The underside, low on the body, is lit from the ground: a light band up from its
    bottom edge; that edge in shade."""
    e = edges(sc, out, ctx)
    z, f = px.shares(sc)
    low = ctx["fur"] & sc.is_part("trunk", "neck", "thigh" + sc.near, "arm" + sc.near) & (z < P["under.z"])
    out[low & (e["down"] < P["under.rows"]) & (out == "D")] = "E"
    if P["under.edge"]:
        out[low & (e["down"] == 0)] = "F"


def r_tail(sc, out, P, ctx):
    """The tail: its tip pale, its lower edge in shade."""
    J = sc.J
    t = sc.is_part("tail") & ctx["fur"]
    root, tip = J["tailroot"], J["tail"]
    a = tip - root
    s = ((sc.hit - root) @ a) / max(1e-9, a @ a)
    out[t & (s > 1 - P["tail.tip"])] = P["tail.tipc"]
    if P["tail.under"]:
        below = px.neighbours(~np.isin(out, [".", "j"]), 1, 0)
        out[t & ~below & (s <= 1 - P["tail.tip"])] = "F"


def r_shadow(sc, out, P, ctx):
    px.r_shadow(sc, out, P, ctx)


def shadow_alpha(sc, P=RULE_PARAMS):
    return px.shadow_alpha(sc, P)


RULES = [("fur", r_fur), ("lower legs", r_lower_legs), ("head", r_head), ("near legs", r_near_legs),
         ("far legs", r_far_legs), ("bib", r_bib), ("front light", r_front_light),
         ("underside", r_underside), ("tail", r_tail),
         ("shadow", r_shadow)]


def paint(scene, params=RULE_PARAMS, head=None, upto=None):
    """The frame as palette letters ('.' clear, 'j' shadow). head: (block letters, poll
    place in the block) to paste at the poll."""
    P = dict(RULE_PARAMS); P.update(params)
    out = np.full((scene.caster.fh, scene.caster.fw), ".", dtype="<U1")
    ctx = {"head": head}
    for i, (name, rule) in enumerate(RULES):
        if upto is not None and i >= upto:
            break
        rule(scene, out, P, ctx)
    return out


def score(painted, art):
    return px.score(painted, art)
