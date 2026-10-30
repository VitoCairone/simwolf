#!/usr/bin/env python3
"""From a posed wolf (wolf_pose.py) to pixel art: the rules that colour it, a pixel at a time;
the wolf's counterpart of deer_pixels.py, whose Scene and helpers this reuses.

THE PALETTE (images/wolf-land.png, as wolf_runfit.letters reads it), dark to light:
    G black   J darkest   F shade   D coat   E light   H pale (bib, cheeks, the tail's tip)
    'j' the shadow, '.' clear

THE ARTIST'S PRACTICE, as read from the canonical frames (the idle and the run, facing grid E
and grid N) and made into the rules below:
  * A lower leg is two pixels wide: its back pixel darker than its front one (shade behind,
    light or pale in front), a far leg no lighter than a near one.
  * A paw is a row of three at the leg's foot, reaching a pixel forward of the leg, its toes a
    pixel higher, no lighter than the leg's back: shade facing the camera, darkest or black
    facing away. So every foot ends in a dark, flat pad.
  * Facing away from the camera (grid N) the legs are darker than facing toward it (grid E):
    the camera sees their backs. The legs' colours are chosen by which way the wolf faces
    (FACING: its forward's share toward the camera; a side view counts as facing toward).
  * The far legs' upper parts are in shade; where one is seen under the body, its top, against
    the belly, is darkest.
  * The near legs' upper parts are light where they face forward; a line of shade divides them
    from the body behind them (the back of the thigh, of the upper arm).
  * The body's lower edge is lit (the belly, the brisket) facing the camera; in shade facing
    away. Its back edge (the rump, the haunch) is in shade.
  * The bib (throat, chest front) is pale, with light round it; the tail's tip is pale.
  * About 4% of the wolf is darkest (J), 1% black (G) and 11% shade (F), outside the head; the
    rules' numbers are fitted to the art's colours and to those shares, keeping to the practice
    above (wolf_runtest.py: valid).

GENERATED ART: frames drawn by these rules are not the artist's, and not canonical
(admin/design_notes.md).
"""

import numpy as np

import deer_pixels as px
import wolf_pose as wp

FW, FH = 64, 64

RULE_PARAMS = {  # fitted to the artist's frames (wolf_runtest.py --tune)
    # the lower legs, facing the camera (prefix "a.": facing away): the back and front pixels'
    # colours, near and far legs; the paw's
    "leg.near.back": "F", "leg.near.front": "H", "leg.far.back": "F", "leg.far.front": "E",
    "paw.near": "F", "paw.far": "F",
    "a.leg.near.back": "F", "a.leg.near.front": "E", "a.leg.far.back": "F", "a.leg.far.front": "E",
    "a.paw.near": "J", "a.paw.far": "G",
    "paw.len": 3,              # the paw: this many pixels long, from the leg's back pixel forward
    "paw.top": 1,              # ...and its toes a pixel higher at its front (1) or not (0)
    "facing.away": -0.3,       # facing away: the forward's share toward the camera below this
    # the upper legs
    "far.up": "F",             # the far legs' upper parts' colour,
    "far.top": "J",            # ...this colour where one meets the belly (its topmost pixels),
    "far.top_rows": 1,         # ...this many deep
    "near.lit": -0.15,           # the near upper legs light (E) where they face forward this much,
    "near.seam": 2,            # ...with a line of shade (this wide) behind them, against the body
    # the body
    "belly.rows": 3,           # its lower edge, this many pixels: lit facing the camera,
    "belly.z": 0.4,            # ...below this share of the body's depth,
    "a.belly": "F",            # ...facing away, this colour
    "rump.rows": 1,            # its back edge in shade, this many pixels,
    "rump.f": 0.4,             # ...behind this share of the way from hips to withers
    "bib.facing": 0.7,        # the pale bib: the chest, throat and neck where they face forward this much,
    "bib.z0": 0.15,            # ...above this share of the body's depth,
    "bib.f": 0.95,             # ...forward of this share of the way from hips to withers
    "bib.rim": 1,              # ...with a light rim this wide behind it
    "front.f": 0.75,           # the front of the body lit: forward of this share of hips to withers,
    "front.z": 0.65,           # ...below this share of its depth
    "tail.tip": -0.15,           # the tail's tip pale: this share of its length,
    "tail.tipc": "H",          # ...this colour,
    "tail.under": "J",         # ...and its lower edge this colour ("D": none)
    "shadow.len": 2.6, "shadow.wide": 4.9, "shadow.f": 0.15,   # the shadow (shadow_radius)
}


def facing_away(sc, P):
    """The wolf faces away from the camera: its forward's share toward the camera (level:
    the camera looks down along -(1, 1, 1)) is below facing.away."""
    toward = (sc.F[0] + sc.F[1]) / np.sqrt(2)
    return toward < P["facing.away"]


def pick(sc, P, key):
    """A colour by facing: the "a." number when facing away."""
    return P["a." + key] if facing_away(sc, P) and ("a." + key) in P else P[key]


def edges(sc, out, ctx):
    return px.edges(sc, out, ctx)


def r_fur(sc, out, P, ctx):
    """Every pixel the body covers starts in the coat colour."""
    ctx["fur"] = sc.part != None  # noqa: E711
    out[ctx["fur"]] = "D"


def r_upper_legs(sc, out, P, ctx):
    """The upper legs: the far ones in shade, darkest at their top against the belly; the near
    ones light where they face forward, with a line of shade behind them against the body."""
    n, f = sc.near, sc.far
    fur = ctx["fur"]
    far = fur & sc.is_part("arm" + f, "fore" + f, "thigh" + f, "shank" + f)
    out[far] = P["far.up"]
    body = sc.is_part("trunk", "neck")
    above_body = np.zeros_like(far)
    for k in range(1, int(P["far.top_rows"]) + 1):
        above_body |= far & px.neighbours(body, -k, 0)
    out[above_body] = P["far.top"]
    near = fur & sc.is_part("arm" + n, "fore" + n, "thigh" + n, "shank" + n)
    out[near & (sc.nlocal[:, :, 0] > P["near.lit"])] = "E"
    dx, dy = px.front_step(sc.caster)
    behind = np.zeros_like(near)
    for k in range(1, int(P["near.seam"]) + 1):
        behind |= px.neighbours(near, dy * k, dx * k)    # a body pixel with near leg in front
    out[fur & body & behind] = "F"


def r_lower_legs(sc, out, P, ctx):
    """The lower legs (carpus or hock down), two pixels wide, the back one darker; the paw a
    flat dark row at the foot, reaching forward. Hidden where the body is nearer."""
    dx, dy = px.front_step(sc.caster)
    for leg, pts in px.lower_legs(sc).items():
        side = "far" if leg.endswith(sc.far) else "near"
        back, front = pick(sc, P, f"leg.{side}.back"), pick(sc, P, f"leg.{side}.front")
        paw = pick(sc, P, f"paw.{side}")
        cells = []
        for i, (x, y, d) in enumerate(reversed(pts)):
            if i == 0:
                cells += [(x + dx * k, y + dy * k, d, paw) for k in range(int(P["paw.len"]))]
                if P["paw.top"]:
                    k = int(P["paw.len"]) - 1
                    cells.append((x + dx * k - dy, y + dy * k - abs(dx), d, front))
            else:
                cells += [(x, y, d, back), (x + dx, y + dy, d, front)]
        for (cx, cy, d, col) in cells:
            if not (0 <= cx < out.shape[1] and 0 <= cy < out.shape[0]):
                continue
            if sc.part[cy, cx] is not None and sc.dep[cy, cx] > d:
                continue
            out[cy, cx] = col
            ctx["fur"][cy, cx] = False


def r_head(sc, out, P, ctx):
    """The head: the artist's block, pasted with its poll on the skeleton's."""
    px.r_head(sc, out, P, ctx)


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


def r_body_edges(sc, out, P, ctx):
    """The body's lower edge, low down, lit facing the camera and in shade facing away; its
    back edge, at the rump, in shade."""
    e = px.edge_runs(sc.part != None, px.front_step(sc.caster))   # noqa: E711
    z, f = px.shares(sc)
    body = ctx["fur"] & sc.is_part("trunk", "neck")
    low = body & (e["down"] < P["belly.rows"]) & (z < P["belly.z"])
    out[low] = P["a.belly"] if facing_away(sc, P) else "E"
    out[body & (e["back"] < P["rump.rows"]) & (f < P["rump.f"])] = "F"


def r_tail(sc, out, P, ctx):
    """The tail: its tip pale, its lower edge in shade."""
    J = sc.J
    t = sc.is_part("tail") & ctx["fur"]
    root, tip = J["tailroot"], J["tail"]
    a = tip - root
    s = ((sc.hit - root) @ a) / max(1e-9, a @ a)
    out[t & (s > 1 - P["tail.tip"])] = P["tail.tipc"]
    below = px.neighbours(~np.isin(out, [".", "j"]), 1, 0)
    out[t & ~below & (s <= 1 - P["tail.tip"])] = P["tail.under"]


def shadow_radius(sc, P):
    """Per pixel, how far its ground point is into the shadow: 0 at its middle, 1 at its edge.
    The shadow is one oval on the ground (the artist's are), under the trunk: as long as from
    withers to sacrum, by shadow.len, and shadow.wide wide (half-widths, true-space units),
    moved shadow.f forward."""
    O = sc.caster.O.reshape(sc.caster.fh, sc.caster.fw, 3)
    w, s = sc.J["withers"], sc.J["sacrum"]
    axis = (w - s)[:2]
    half = np.linalg.norm(axis) / 2
    axis = axis / max(half * 2, 1e-9)
    mid = (w + s)[:2] / 2 + axis * P["shadow.f"]
    d = O[:, :, :2] - mid
    along = d @ axis
    across = d @ np.array([-axis[1], axis[0]])
    return np.sqrt((along / (half * P["shadow.len"])) ** 2 + (across / P["shadow.wide"]) ** 2)


def r_shadow(sc, out, P, ctx):
    """The shadow on the ground under the trunk (the sun overhead), behind everything."""
    out[(shadow_radius(sc, P) <= 1) & (out == ".")] = "j"


def shadow_alpha(sc, P=RULE_PARAMS):
    """The shadow's alpha per pixel (where the frame is otherwise clear): the artist's soft
    edge (deer_pixels.SHADOW_ALPHA)."""
    xs, ys = zip(*px.SHADOW_ALPHA)
    return np.interp(shadow_radius(sc, P), xs, ys).round().astype(np.uint8)


RULES = [("fur", r_fur), ("upper legs", r_upper_legs), ("lower legs", r_lower_legs), ("head", r_head),
         ("bib", r_bib), ("front light", r_front_light), ("body edges", r_body_edges), ("tail", r_tail),
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


LETTERS = "GJFDEH"


def shares(letters, mask=None):
    """Each palette colour's share of the wolf's pixels (within mask)."""
    w = np.isin(letters, list(LETTERS))
    if mask is not None:
        w &= mask
    n = max(1, w.sum())
    return {c: float(((letters == c) & w).sum()) / n for c in LETTERS}
