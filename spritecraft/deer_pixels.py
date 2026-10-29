#!/usr/bin/env python3
"""From a posed skeleton to pixel art: the rules that colour the stag, a pixel at a time.

The skeleton is cast into coverage (deer_pose.py): each pixel knows the part it shows,
the 3D point and the surface's normal there. Then RULES, in order, each a small, named
piece of the artist's practice, paint it. A rule may read anything known: the part, the
normal, the joints, the pixels already painted and their neighbours. Every rule has a few
numbers (RULE_PARAMS), set by fitting to the artist's running frames.

GENERATED ART: frames drawn by these rules are not the artist's, and not canonical
(admin/design_notes.md).
"""

import numpy as np

import deer_pose as dp

FW, FH = 32, 41       # the artist's frames (a generated frame may be wider: its caster's size)

RULE_PARAMS = {  # fitted to the artist's running frames (deer_runtest.py --tune)
    "back.rows": 2,            # the light along the back: the top this many pixels...
    "back.f0": 0.3, "back.f1": 0.7,  # ...between these shares of the way from hips to withers
    "neck.up": 0.85,           # the neck and withers lit where they face up (normal's z) this much,
    "neck.back": 0.0,          # ...counting facing back this much,
    "neck.f0": 0.0,           # ...forward of this share of hips to withers
    "haunch.f": -0.45,         # the haunch's back: behind this share of hips to withers,
    "haunch.rows": 2,          # ...this many pixels in from the back edge,
    "haunch.z": 0.95,          # ...below this share of the depth: in shade;
    "haunch.rim": 0.5,         # ...its outer edge dark where it faces up less than this,
    "haunch.rim_rows": 1,      # ...this many pixels deep
    "arm.rows": 1,             # the near upper arm's front edge, this deep, in shade
    "bib.facing": 0.69,        # the pale bib: the chest and throat where they face forward this much,
    "bib.z1": 0.76,            # ...below this share of the body's depth (above: light; fitted: none)
    "low.z": 0.33,             # "low on the body": below this share of its depth
    "chest.facing": 0.54,      # the low front of the chest, facing forward this much, is dark
    "tail.f": -7.5, "tail.z": 14.0,  # the tail: a stroke from its root on the croup (in the
                               # rest trunk's frame; drawn from the body pixel nearest it), swung
                               # down by the pose's tail angle from straight back,
    "tail.len": 5.0,           # ...this long (in the pose fit; drawn, it stands out from the
                               # body's outline by tail.out pixels),
    "tail.out": 3.0,           # ...(standing out this many pixels past the outline)
    "tail.width": 1.3,         # ...this many pixels wide (across it, on screen) at its tip,
    "tail.root_width": 2.6,    # ...and this many at its root;
    "tail.raised": -0.1,       # ...raised when it climbs this much (rise over length);
    "tail.under": 0.6,         # ...toward the camera, light above this offset across it; below,
                               # its pale underside if raised, else coat
    "tail.over": 1,            # ...toward the camera, drawn over the body too (0: off it only)
    "face.pitch": -5.0,        # the drawn head: tipped nose-up this much (degrees) from the skeleton's,
    "face.up": 0.5,            # ...light where it faces up this much (normal's z),
    "face.chin": 0.9,          # ...pale within this of the chin,
    "face.eye_depth": 0.8,     # ...an eye seen where the head's surface is this near it
    "diag.head_yaw": 45.0,     # on a diagonal facing the artist turns the head this far
                               # (degrees) toward the screen's profile,
    "diag.both_eyes": 1,       # ...and shows both eyes (1), as a face
    "leg.near": "GKF",         # a lower leg's colours, up from the hoof (the last repeats)
    "leg.far": "GBI",
    "shadow.len": 1.2, "shadow.wide": 1.4,   # the shadow: the trunk's footprint, scaled,
    "shadow.f": 0.0,           # ...and moved forward
}


def neighbours(mask, dy, dx):
    """mask shifted so out[y, x] = mask[y + dy, x + dx] (False off the frame)."""
    FH, FW = mask.shape
    out = np.zeros_like(mask)
    ys = slice(max(0, -dy), FH - max(0, dy)); yd = slice(max(0, dy), FH - max(0, -dy))
    xs = slice(max(0, -dx), FW - max(0, dx)); xd = slice(max(0, dx), FW - max(0, -dx))
    out[ys, xs] = mask[yd, xd]
    return out


class Scene:
    """Everything the rules may read, for one pose at one facing."""

    def __init__(self, model, caster, pose, shape, F, L, head=False, P=None):
        """head: the head drawn (deer_pose.HEAD) rather than the artist's block pasted."""
        P = RULE_PARAMS if P is None else P
        if head and "head_yaw" not in pose:
            pose = dict(pose, head_yaw=diagonal_head_yaw(caster, P))
        if head and "head" not in pose:
            pose = dict(pose, head=np.radians(P["face.pitch"]))
        self.model, self.caster, self.pose, self.shape = model, caster, pose, shape
        self.F, self.L = np.array(F, float), np.array(L, float)
        self.drawn_head = head
        J, ell, sph = model.solids(pose, shape, head=head)
        self.J = J
        part, hit, nrm, dep = caster.cast(ell, sph)
        self.part = np.where(part >= 0, np.array(caster.parts + ["-"], dtype=object)[part], None)
        self.hit, self.nrm, self.dep = hit, nrm, dep
        # the trunk's own frame: undo the pitch and the move
        a = pose.get("pitch", 0.0)
        move = np.array([pose.get("df", 0.0), pose.get("ds", 0.0), pose.get("dz", 0.0)])
        self.local = model.pivot + dp.rot(hit - move - model.pivot, -a)
        self.nlocal = dp.rot(nrm, -a)
        # which side is nearer the camera (whose L points toward the camera)
        self.near = "L" if caster.D[1] > 0 else "R"
        self.far = "R" if self.near == "L" else "L"
        # the screen's left as a direction in the deer's frame (level): u = x - y grows to the right
        g = np.array([-1.0, 1.0]) / np.sqrt(2)              # grid direction of screen-left
        self.camera_left = np.array([g @ self.F, g @ self.L, 0.0])

    def is_part(self, *names):
        return np.isin(self.part.astype(str), names)


def front_step(caster):
    """The screen step (dx, dy) toward the deer's front: along the screen axis nearer its
    forward direction (right or left for a deer seen from the side, down or up for one
    facing the camera or away)."""
    fwd = caster.screen(np.array([1.0, 0, 0])) - caster.screen(np.zeros(3))
    if abs(fwd[0]) >= abs(fwd[1]):
        return (1 if fwd[0] >= 0 else -1), 0
    return 0, (1 if fwd[1] >= 0 else -1)


def edge_runs(mask, front=(1, 0)):
    """Per pixel of mask, how many pixels of mask lie beyond it before its edge: up, down,
    back and front (front: the screen step front_step; back: the other way)."""
    FH, FW = mask.shape
    def run(dy, dx):
        d = np.zeros(mask.shape, int)
        ys = range(FH) if dy <= 0 else range(FH - 1, -1, -1)
        xs = range(FW) if dx <= 0 else range(FW - 1, -1, -1)
        for y in ys:
            for x in xs:
                if mask[y, x]:
                    py, qx = y + dy, x + dx
                    inside = 0 <= py < FH and 0 <= qx < FW and mask[py, qx]
                    d[y, x] = d[py, qx] + 1 if inside else 0
        return d
    up, down = run(-1, 0), run(1, 0)
    dx, dy = front
    return {"up": up, "down": down, "front": run(dy, dx), "back": run(-dy, -dx)}


def lower_legs(scene):
    """{leg: [(x, y, depth)]}: the cannon and pastern, one pixel per step down the leg."""
    c, J = scene.caster, scene.J
    out = {}
    for leg, chain in (("FL", ("carpusL", "fetlockFL", "hoofFL")), ("FR", ("carpusR", "fetlockFR", "hoofFR")),
                       ("HL", ("hockL", "fetlockHL", "hoofHL")), ("HR", ("hockR", "fetlockHR", "hoofHR"))):
        pts, seen = [], set()
        for a, b in zip(chain, chain[1:]):
            n = int(np.ceil(np.abs(c.screen(J[b]) - c.screen(J[a])).max() * 2)) + 1
            for t in np.linspace(0, 1, n):
                P = J[a] + (J[b] - J[a]) * t
                u, v = c.screen(P)
                xy = (int(np.floor(u)), int(np.floor(v)))
                if xy not in seen:
                    seen.add(xy); pts.append((xy[0], xy[1], float(c.depth(P))))
        out[leg] = pts
    return out


def paint(scene, params=RULE_PARAMS, head=None, upto=None):
    """The frame as palette letters ('.' clear, 'j' shadow). head: (block letters, poll
    place in the block) to paste at the poll. upto: stop after this many rules."""
    P = dict(RULE_PARAMS); P.update(params)
    out = np.full((scene.caster.fh, scene.caster.fw), ".", dtype="<U1")
    ctx = {"head": head}
    for i, (name, rule) in enumerate(RULES):
        if upto is not None and i >= upto:
            break
        rule(scene, out, P, ctx)
    return out


def shares(sc):
    """Each pixel's place on the trunk: (height share, belly 0 to back 1; length share,
    hips 0 to withers 1)."""
    p = sc.model.p
    return ((sc.local[:, :, 2] - p["zBelly"]) / (p["zHip"] - p["zBelly"]),
            (sc.local[:, :, 0] - p["fH"]) / (p["fF"] - p["fH"]))


def edges(sc, out, ctx):
    """Edge runs (edge_runs) of everything painted so far, computed once."""
    if "edges" not in ctx:
        ctx["edges"] = edge_runs(~np.isin(out, [".", "j", "h"]), front_step(sc.caster))
    return ctx["edges"]


# THE RULES -------------------------------------------------------------------------------

def r_fur(sc, out, P, ctx):
    """Every pixel the body covers starts in the coat colour."""
    ctx["fur"] = sc.part != None  # noqa: E711
    out[ctx["fur"]] = "D"


def r_lower_legs(sc, out, P, ctx):
    """The cannons and pasterns: a pixel-wide line, coloured by its steps up from the hoof:
    a near leg black, then the darkest red, then shade up to the body; a far leg black,
    then the antlers' darkest brown, then dark. A leg is hidden where the body is nearer."""
    for leg, pts in lower_legs(sc).items():
        seq = P["leg.far"] if leg.endswith(sc.far) else P["leg.near"]
        for i, (x, y, d) in enumerate(reversed(pts)):
            if not (0 <= x < out.shape[1] and 0 <= y < out.shape[0]):
                continue
            if sc.part[y, x] is not None and sc.dep[y, x] > d:
                continue
            out[y, x] = seq[min(i, len(seq) - 1)]
            ctx["fur"][y, x] = False


# THE HEADS: the artist draws the head and antlers as one block, moved from frame to frame
# unchanged (the walk, the run), and in the idle turns the head to show it from other sides
# and lowers it to graze. So a head is drawn with the artist's block for the way it points on
# screen (an arrow: the head's heading, level, projected), pasted with its poll on the
# skeleton's. The blocks, cut from images/deer-land.png: arrow -> (sheet row, column, the
# block's pixels as a test on (y, x), the poll's place in the frame). An arrow pointing left
# uses its mirror image's block, mirrored.
HEAD_BLOCKS = {
    # as the run draws it for grid N, and for grid E
    "↗": (0, 35, lambda y, x: y < 14, (17.5, 12.5)),
    "↘": (1, 35, lambda y, x: (y < 19) | (y == 19) & (x >= 17), (18.5, 15.5)),
    # facing the camera, and facing away (the idle's look about, for grid E and grid N)
    "↓": (1, 15, lambda y, x: (y <= 16) & (x >= 9) | (y <= 23) & (x >= 17), (19.5, 17.5)),
    "↑": (0, 15, lambda y, x: (y <= 14) & (x >= 8), (18.0, 13.5)),
}
HEAD_BLOCKS["→"] = HEAD_BLOCKS["↗"]       # (no profile drawn: the nearest, three-quarters)
GRAZE_BLOCKS = {  # the head lowered to the grass (the idle's grazing, for grid N and grid E)
    "↗": (0, 33, lambda y, x: (x >= 22) & (y <= 29) | (x >= 19) & (y <= 20), (22.5, 24.5)),
    "↘": (1, 33, lambda y, x: (x >= 18) & (y >= 23) & (y <= 36), (20.5, 30.5)),
}
GRAZE_BLOCKS["→"] = GRAZE_BLOCKS["↗"]
GRAZE_BLOCKS["↓"] = HEAD_BLOCKS["↓"][:3] + ((19.5, 21.5),)  # toward the camera: the face,
                                         # lowered (attached higher: the neck is thin there)
GRAZE_BLOCKS["↑"] = HEAD_BLOCKS["↑"]     # away: the head behind the body, its antlers showing
ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"]   # by screen angle, clockwise from right
MIRROR = {"←": "→", "↙": "↘", "↖": "↗"}


def head_arrow(caster, yaw=0.0):
    """The screen arrow of a head turned yaw (radians, to the deer's left) from the body's
    forward: its level heading, projected (the camera's view of a heading: grid (x, y) ->
    screen (x - y, (x + y) / 2), so a heading toward the camera points down)."""
    d = caster.screen(np.array([np.cos(yaw), np.sin(yaw), 0.0])) - caster.screen(np.zeros(3))
    k = int(round(np.degrees(np.arctan2(d[1], d[0])) / 45.0)) % 8
    return ARROWS[k]


def head_block(caster, sheet, yaw=0.0, graze=False):
    """The head block for a deer seen through caster, its head turned yaw: (block letters,
    poll place, behind: the head is farther than the body, so drawn only where the body
    isn't). sheet: images/deer-land.png as palette letters (deer_runfit.letters)."""
    arrow = head_arrow(caster, yaw)
    mirror = arrow in MIRROR
    blocks = GRAZE_BLOCKS if graze else HEAD_BLOCKS
    row, col, test, poll = blocks[MIRROR.get(arrow, arrow)]
    fr = sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW]
    y, x = np.mgrid[0:FH, 0:FW]
    block = np.where(test(y, x) & ~np.isin(fr, [".", "j", "h"]), fr, ".")
    if mirror:
        block = block[:, ::-1]
        poll = (FW - poll[0], poll[1])
    pad = (caster.fw - FW) // 2                   # a wider frame: the block centred in it
    block = np.pad(block, ((0, caster.fh - FH), (pad, caster.fw - FW - pad)), constant_values=".")
    return block, np.array([poll[0] + pad, poll[1]]), arrow == "↑"


def is_diagonal(caster):
    """A diagonal facing: its forward neither level nor upright on screen."""
    fwd = caster.screen(np.array([1.0, 0, 0])) - caster.screen(np.zeros(3))
    return min(abs(fwd[0]), abs(fwd[1])) > 0.2 * max(abs(fwd[0]), abs(fwd[1]))


def diagonal_head_yaw(caster, P):
    """The artist's turn of the head on a diagonal facing (radians, to the deer's left):
    toward the screen's profile, the way that is level on screen; 0 off the diagonals."""
    if not is_diagonal(caster):
        return 0.0
    # which way to turn: the one that brings its heading nearer level on screen
    s = lambda yaw: caster.screen(np.array([np.cos(yaw), np.sin(yaw), 0.0])) - caster.screen(np.zeros(3))
    left = abs(s(0.3)[1]) < abs(s(-0.3)[1])
    return np.radians(P["diag.head_yaw"]) * (1 if left else -1)


def r_head(sc, out, P, ctx):
    """The head and antlers: the artist's block, pasted with its poll on the skeleton's;
    seen from behind, under the body. (A drawn head: r_face and r_antlers.)"""
    if ctx["head"] is None or sc.drawn_head:
        return
    block, poll_at = ctx["head"][:2]
    behind = len(ctx["head"]) > 2 and ctx["head"][2]
    u, v = sc.caster.screen(sc.J["poll"])
    dx, dy = int(round(u - poll_at[0])), int(round(v - poll_at[1]))
    m = block != "."
    ys, xs = np.nonzero(m)
    vals = block[ys, xs]
    ys, xs = ys + dy, xs + dx
    ok = (ys >= 0) & (ys < out.shape[0]) & (xs >= 0) & (xs < out.shape[1])
    if behind:
        ok[ok] &= (out[ys[ok], xs[ok]] == ".") | (sc.part[ys[ok], xs[ok]] == "neck")
    out[ys[ok], xs[ok]] = vals[ok]
    ctx["fur"][ys[ok], xs[ok]] = False


def tail_stroke(model, c, pose, P, body=None):
    """The tail's pixels: {(x, y): offset across the stroke, positive on the side toward the
    deer's front and the top of the screen (a raised tail's upper face)}, its root and
    tip on screen, and their 3D points. body: the body's pixels; the stroke then starts at
    the body pixel nearest its root, so it never stands apart from the rump, and ends
    tail.out pixels beyond the outline."""
    root3 = model.trunk_point((P["tail.f"], 0, P["tail.z"]), pose)
    angle = pose.get("pitch", 0.0) + pose.get("tail", 0.0)
    tip3 = root3 + dp.rot(np.array([-P["tail.len"], 0.0, 0.0]), angle)
    r, q = c.screen(root3), c.screen(tip3)
    if body is not None and body.any():
        ys, xs = np.nonzero(body)
        i = np.argmin((xs + 0.5 - r[0]) ** 2 + (ys + 0.5 - r[1]) ** 2)
        r = np.array([xs[i] + 0.5, ys[i] + 0.5])
        # it stands out from the outline by a fixed length, whatever the body's depth there
        u = (q - c.screen(root3)) / (np.hypot(*(q - c.screen(root3))) + 1e-9)
        # (from the body's farthest pixel along it, within a pixel or so of its line, so a
        # notch between croup and haunch doesn't cut it short)
        rel = np.stack([xs + 0.5 - r[0], ys + 0.5 - r[1]], 1)
        along = rel @ u
        across = np.abs(rel @ np.array([-u[1], u[0]]))
        reach = max(0.0, along[across <= 1.5].max(initial=0.0))
        # (but no longer on screen than the tail itself, plus a pixel: seen from behind, it
        # lies over the rump)
        q = r + u * min(reach + P["tail.out"], np.hypot(*(q - c.screen(root3))) + 1)
    a = q - r
    L = np.hypot(*a)
    if L < 1e-6:
        return {}, r, q, tip3, root3
    n = np.array([-a[1], a[0]]) / L
    fwd = c.screen(np.array([1.0, 0, 0])) - c.screen(np.zeros(3))
    if n @ (fwd / np.hypot(*fwd) + np.array([0.0, -1.0])) < 0:
        n = -n                                    # across the stroke, toward the deer's front and up
    px_ = {}
    x0, x1 = int(min(r[0], q[0])) - 2, int(max(r[0], q[0])) + 3
    y0, y1 = int(min(r[1], q[1])) - 2, int(max(r[1], q[1])) + 3
    for y in range(max(0, y0), min(c.fh, y1)):
        for x in range(max(0, x0), min(c.fw, x1)):
            p = np.array([x + 0.5, y + 0.5]) - r
            t = p @ a / (L * L)
            d = p @ n
            w = P["tail.root_width"] + (P["tail.width"] - P["tail.root_width"]) * t
            if 0 <= t <= 1 and abs(d) <= w / 2:
                px_[(x, y)] = d
    return px_, r, q, tip3, root3


def r_tail(sc, out, P, ctx):
    """The tail: a short stroke out of the rump, distinct from it.
    Toward the camera (pointing toward it, seen from above) its upper side is light, its
    lower side coat, or its pale underside when raised. Away from
    the camera, trailing, it is in shade; raised against the sky, coat with a light upper
    edge."""
    pix, r, q, tip3, root3 = tail_stroke(sc.model, sc.caster, sc.pose, P, body=ctx["fur"])
    if not pix:
        return
    c = sc.caster
    level = (tip3 - root3) * np.array([1.0, 1.0, 0.0])
    near = level @ c.D > 0                       # it points toward the camera, seen from above
    v = tip3 - root3
    raised = v[2] / (np.linalg.norm(v) + 1e-9) > P["tail.raised"]
    for (x, y), d in pix.items():
        if out[y, x] not in (".", "j") and not (near and P["tail.over"] and ctx["fur"][y, x]):
            continue
        if near:
            col = "E" if d >= P["tail.under"] else ("H" if raised else "D")
        else:
            col = ("E" if d > 0 else "D") if raised else "F"
        out[y, x] = col
        ctx["fur"][y, x] = False


def r_face(sc, out, P, ctx):
    """The drawn head (deer_pose.HEAD): light on top, the chin pale, the nose and the eyes
    dark. An eye shows where the head's surface is at it (the far one is behind the head);
    on a diagonal facing the artist shows both (diag.both_eyes)."""
    if not sc.drawn_head:
        return
    head = sc.is_part("skull", "muzzle", "jaw", "throat", "earL", "earR")
    m = ctx["fur"] & head
    out[m & sc.is_part("skull", "muzzle") & (sc.nrm[:, :, 2] > P["face.up"])] = "E"
    near_chin = np.linalg.norm(sc.hit - sc.J["chin"], axis=2) < P["face.chin"]
    out[m & sc.is_part("muzzle", "jaw") & near_chin] = "H"
    c = sc.caster
    both = P["diag.both_eyes"] and is_diagonal(c)
    for n in ("eyeL", "eyeR", "nose"):
        x, y = (int(np.floor(v)) for v in c.screen(sc.J[n]))
        if not (0 <= y < out.shape[0] and 0 <= x < out.shape[1]) or not head[y, x]:
            continue
        seen = abs(sc.dep[y, x] - c.depth(sc.J[n])) < P["face.eye_depth"]
        if seen or (both and n != "nose"):
            out[y, x] = "G"
            ctx["fur"][y, x] = False


def r_antlers(sc, out, P, ctx):
    """With a drawn head, the antlers: the artist's (the block's antler pixels), pasted with
    its poll on the skeleton's."""
    if ctx["head"] is None or not sc.drawn_head:
        return
    block, poll_at = ctx["head"][:2]
    u, v = sc.caster.screen(sc.J["poll"])
    dx, dy = int(round(u - poll_at[0])), int(round(v - poll_at[1]))
    ys, xs = np.nonzero(np.isin(block, list("ABC")))
    vals = block[ys, xs]
    ys, xs = ys + dy, xs + dx
    ok = (ys >= 0) & (ys < out.shape[0]) & (xs >= 0) & (xs < out.shape[1])
    out[ys[ok], xs[ok]] = vals[ok]


def r_back_light(sc, out, P, ctx):
    """The light along the back: its top pixels, over the middle of the back."""
    e = edges(sc, out, ctx)
    z, f = shares(sc)
    out[ctx["fur"] & sc.is_part("trunk", "neck") & (f > P["back.f0"]) & (f < P["back.f1"])
        & (e["up"] < P["back.rows"])] = "E"


def r_neck_light(sc, out, P, ctx):
    """The light on the back of the neck and over the withers, where they face up and back."""
    z, f = shares(sc)
    n = sc.nlocal
    lit = n[:, :, 2] - P["neck.back"] * n[:, :, 0] > P["neck.up"]
    out[ctx["fur"] & sc.is_part("trunk", "neck") & lit & (f > P["neck.f0"]) & (out == "D")] = "E"


def r_haunch(sc, out, P, ctx):
    """The back of the haunch, below the rump, is in shade, darkest at its edge."""
    e = edges(sc, out, ctx)
    z, f = shares(sc)
    m = ctx["fur"] & sc.is_part("trunk", "thighL", "thighR") & (f < P["haunch.f"]) & (z < P["haunch.z"])
    out[m & (e["back"] < P["haunch.rows"])] = "F"
    out[m & (e["back"] < P["haunch.rim_rows"]) & (sc.nrm[:, :, 2] < P["haunch.rim"])] = "I"


def r_arm(sc, out, P, ctx):
    """The front edge of the near upper arm is in shade."""
    e = edges(sc, out, ctx)
    out[ctx["fur"] & sc.is_part("arm" + sc.near) & (e["front"] < P["arm.rows"])] = "F"


def r_bib(sc, out, P, ctx):
    """The pale bib: the chest and throat, where they face forward; light above it."""
    z, f = shares(sc)
    facing = ctx["fur"] & sc.is_part("trunk", "neck") & (sc.nlocal[:, :, 0] > P["bib.facing"]) & (z > P["low.z"])
    out[facing & (z <= P["bib.z1"])] = "H"
    out[facing & (z > P["bib.z1"])] = "E"
    # the coat's edge against the bib is light: a coat pixel with the bib just in front
    dx, dy = front_step(sc.caster)
    ahead = neighbours(out == "H", dy, dx)
    out[ctx["fur"] & ahead & (out == "D")] = "E"


def r_belly_edge(sc, out, P, ctx):
    """The bottom edge of the body, low down, is in shade."""
    e = edges(sc, out, ctx)
    z, f = shares(sc)
    out[ctx["fur"] & (z <= P["low.z"]) & (e["down"] == 0)] = "F"


def r_chest_low(sc, out, P, ctx):
    """The low front of the chest, between the forelegs, is dark."""
    z, f = shares(sc)
    out[ctx["fur"] & sc.is_part("trunk") & (z <= P["low.z"]) & (sc.nlocal[:, :, 0] > P["chest.facing"])] = "I"


def r_limbs(sc, out, P, ctx):
    """The legs above the cannons: the far side's thigh and upper arm in shade, its
    forearm and shank dark; the near side's forearm and shank in shade."""
    n, f = sc.near, sc.far
    out[ctx["fur"] & sc.is_part("thigh" + f, "arm" + f)] = "F"
    out[ctx["fur"] & sc.is_part("shank" + f, "fore" + f)] = "I"
    out[ctx["fur"] & sc.is_part("shank" + n, "fore" + n)] = "F"


def shadow_radius(sc, P):
    """Per pixel, how far its ground point is into the trunk's footprint: 0 at the middle,
    1 at its edge (the nearest of the trunk solids')."""
    O = sc.caster.O.reshape(sc.caster.fh, sc.caster.fw, 3)
    pose, sh = sc.pose, sc.shape
    r = np.full(O.shape[:2], np.inf)
    for k in dp.ELLIPSOIDS:
        c = sc.model.trunk_point((sh[k + ".f"], 0, sh[k + ".z"]), pose)
        a = sh[k + ".a"] * P["shadow.len"]
        b = sh[k + ".b"] * P["shadow.wide"]
        r = np.minimum(r, np.sqrt(((O[:, :, 0] - c[0] - P["shadow.f"]) / a) ** 2 + ((O[:, :, 1] - c[1]) / b) ** 2))
    return r


# the shadow's see-through, by shadow_radius, as the artist's soft edge (alpha, 0-255)
SHADOW_ALPHA = ((0.0, 184), (0.15, 172), (0.3, 142), (0.45, 102), (0.6, 64), (0.75, 34),
                (0.9, 13), (1.05, 2), (1.1, 0))


def shadow_alpha(sc, P=RULE_PARAMS):
    """The shadow's alpha per pixel (where the frame is otherwise clear)."""
    r = shadow_radius(sc, P)
    xs, ys = zip(*SHADOW_ALPHA)
    return np.interp(r, xs, ys).round().astype(np.uint8)


def r_shadow(sc, out, P, ctx):
    """The shadow on the ground under the trunk (the sun overhead), behind everything."""
    out[(shadow_radius(sc, P) <= 1) & (out == ".")] = "j"


RULES = [("fur", r_fur), ("lower legs", r_lower_legs), ("head", r_head), ("tail", r_tail), ("back light", r_back_light),
         ("neck light", r_neck_light), ("haunch", r_haunch), ("arm", r_arm), ("bib", r_bib), ("belly edge", r_belly_edge), ("chest low", r_chest_low), ("limbs", r_limbs),
         ("face", r_face), ("antlers", r_antlers),
         ("shadow", r_shadow)]


def score(painted, art):
    """(share of the art's deer pixels painted the same letter, outline IoU, shadow IoU)."""
    deer_a = ~np.isin(art, [".", "j", "h"])
    deer_p = ~np.isin(painted, [".", "j", "h"])
    union = deer_a | deer_p
    same = (painted == art) & union
    sa, sp = art == "j", painted == "j"
    return (same.sum() / max(1, union.sum()), (deer_a & deer_p).sum() / max(1, union.sum()),
            (sa & sp).sum() / max(1, (sa | sp).sum()))
