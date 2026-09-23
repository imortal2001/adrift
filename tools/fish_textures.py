"""
Textures for the sea life: an albedo and a height field per species, painted
procedurally with numpy and turned into a normal map — imported by
tools/build_fish.py, which runs it inside Blender.

The dinosaurs are the benchmark: each is a textured model with a 2048² colour
map and a normal map, and next to them flat vertex colour reads as plastic.
So each fish gets the same two maps, in one 1024² atlas:

    top half        the body, unwrapped: u runs nose to tail, v once round
    bottom half     a 4 × 2 grid of fin slots — dorsal, second dorsal, anal,
                    tail, pectorals, pelvics, finlets — and a white slot the
                    decals and eyes point at, so their vertex colour shows
                    through unchanged

What is painted, all of it in physical units along and round the fish so
nothing stretches:

  * scales: rows of overlapping scales, each a little different in shade,
    raised toward its free edge with a shadow where it overlaps the next —
    sized per species (a tuna's are tiny, a chromis's big)
  * the species pattern: counter-shading, stripes, bars, spots (round, or
    ringed like a peacock flounder's), a blue tang's palette, a porgy's face
  * the lateral line as a row of pores
  * mottle and grain, so no flank is one flat colour
  * fins: rays, segmented and forking toward the edge, over lighter membrane,
    with black tips where the species has them
  * a shark's denticle grain and pale flank band; a humpback's wrinkles,
    throat grooves, scars and barnacles

Everything is deterministic: the same species paints the same fish.
"""
import math

import numpy as np

S = 1024                                   # atlas size
BODY_V0 = 0.5                              # body occupies v 0.5 .. 1
SLOTS = ["dorsal", "dorsal2", "anal", "caudal", "pectoral", "pelvic", "finlets", "white"]


def slot_rect(name):
    """(u0, v0, w, h) of a fin slot in the lower half of the atlas."""
    i = SLOTS.index(name)
    col, row = i % 4, i // 4
    pad = 0.006
    return (col * 0.25 + pad, row * 0.25 + pad, 0.25 - 2 * pad, 0.25 - 2 * pad)


WHITE_UV = (slot_rect("white")[0] + 0.12, slot_rect("white")[1] + 0.12)


# ── noise ────────────────────────────────────────────────────────────────────
def _hash(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / float(0xFFFFFF)


def vnoise(x, y, seed=0):
    """Smooth value noise, 0..1, on arrays."""
    ix, iy = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = _hash(ix, iy, seed)
    b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed)
    d = _hash(ix + 1, iy + 1, seed)
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy


def fbm(x, y, oct=4, seed=0):
    out, amp, tot = 0.0, 0.5, 0.0
    for o in range(oct):
        out = out + vnoise(x, y, seed + o * 17) * amp
        tot += amp
        x, y, amp = x * 2.03, y * 2.03, amp * 0.5
    return out / tot


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rgb(h):
    return np.array([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255])


def lerp(a, b, t):
    t = t[..., None] if np.ndim(t) else t
    return a + (b - a) * t


# ── the body ─────────────────────────────────────────────────────────────────
def body_maps(sp, outline, lateral_path):
    """
    Albedo (H, W, 3) and height (H, W) for the body region: u = t along the
    body, v = angle round it from the spine (0) through the left flank to the
    belly (0.5) and back up the right. Rows of the arrays are v, bottom first,
    which is how Blender stores image pixels.
    """
    W, H = S, S // 2
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    T, V = np.meshgrid(u, v)
    A = V * 2 * math.pi
    up, side = np.cos(A), np.sin(A)
    L = sp["length"]

    # Physical coordinates on the skin, in metres: along the body and round
    # it, so a spot is round and a scale is scale-shaped wherever it is.
    depth = np.array([outline(sp, t)[0] for t in u])
    width = np.array([outline(sp, t)[1] for t in u])
    rmean = (depth + width) / 2
    X = T * L
    Y = A * rmean[None, :] * L

    c = sp.get("colors")
    tex = sp.get("texture", {})

    # ── colour ──
    if not c:
        # Greyscale, for the tinted species: counter-shaded, banded.
        g = 0.50 + 0.50 * (0.5 - 0.5 * up)
        for bt, bw in sp.get("bands", []):
            g = g * (1 - 0.38 * sstep(bw, bw * 0.55, np.abs(T - bt)))
        col = np.repeat(g[..., None], 3, axis=2)
    else:
        vv = side if c.get("axis") == "side" else up
        col = lerp(rgb(c["belly"]), rgb(c["back"]), sstep(c["line"] - c["soft"], c["line"] + c["soft"], vv))
        # A darker ridge down the spine, as every fish has.
        col = col * (1 - 0.12 * sstep(0.85, 1.0, vv))[..., None]
        fm = c.get("face")
        if fm:
            col = lerp(col, rgb(fm[1]), sstep(fm[0], fm[0] - 0.06, T) * sstep(-0.7, -0.3, vv))
        pal = c.get("palette")
        if pal is not None:
            wob = (fbm(X / L * 30, Y / L * 30, 3, 5) - 0.5) * 0.06
            band = sstep(0.1, 0.13, T) * sstep(0.9, 0.87, T) * sstep(0.06, 0.1, vv + wob) * sstep(0.62, 0.58, vv + wob)
            loop = (sstep(0.62, 0.66, T) * sstep(0.9, 0.87, T) * sstep(0.58, 0.62, vv + wob)) + \
                   (sstep(0.28, 0.32, T) * sstep(0.9, 0.87, T) * sstep(0.84, 0.88, vv + wob))
            col = lerp(col, rgb(pal), np.clip(band + loop, 0, 1))
        for (t0, t1, u0, u1, h) in c.get("stripes", []):
            e = 0.012
            m = sstep(t0 - e, t0 + e, T) * sstep(t1 + e, t1 - e, T) * sstep(u0 - 0.03, u0 + 0.03, vv) * \
                sstep(u1 + 0.03, u1 - 0.03, vv)
            col = lerp(col, rgb(h), 0.88 * m)
        bars = c.get("bars")
        if bars:
            (bt0, bt1), (bu0, bu1) = bars["t"], bars["up"]
            ph = (T - bt0) / (bt1 - bt0) * bars["count"] + (fbm(X / L * 20, Y / L * 20, 3, 9) - 0.5) * 0.5
            inside = sstep(bt0, bt0 + 0.02, T) * sstep(bt1, bt1 - 0.02, T) * \
                sstep(bu0, bu0 + 0.1, vv) * sstep(bu1 + 0.05, bu1 - 0.05, vv)
            bar = sstep(0.42, 0.3, np.abs((ph % 1.0) - 0.5) * 2 - 0.25) * inside
            col = lerp(col, rgb(bars["color"]), 0.7 * bar)
        spots = c.get("spots")
        if spots:
            col = paint_spots(col, X, Y, T, vv, spots, L, ring=sp.get("ring_spots", False))
        # A blacktip's pale flank band, running forward from the pelvic fins.
        if tex.get("flank_band"):
            fb = sstep(0.42, 0.5, T) * sstep(0.85, 0.78, T) * sstep(-0.5, -0.4, vv) * sstep(-0.12, -0.22, vv)
            col = lerp(col, rgb(c["belly"]), 0.7 * fb)

    # ── scales ──
    rows = tex.get("scales", 40)
    height = np.zeros_like(T)
    if rows > 0:
        sh, sc, rim = scales(X / (L / rows), Y / (L / rows * 0.82))
        # The head is mostly bare skin: scales start behind the snout and are
        # fully there by the gill cover.
        gill = (sp.get("head", {}).get("gills") or [0.24])[0]
        amt = tex.get("scale_amount", 1.0) * sstep(gill * 0.45, gill, T)
        height = height + sh * 0.6 * amt
        # Each scale its own shade, a highlight on its rim, and dark where it
        # tucks under the one in front.
        col = col * (1 + amt * (0.10 * (sc - 0.5) + 0.07 * rim))[..., None]
        col = col * (1 - 0.22 * amt * (1 - np.clip(sh / 0.25, 0, 1)))[..., None]

    # ── skin grain and mottle ──
    grain = fbm(X / L * 220, Y / L * 220, 2, 21)
    mottle = fbm(X / L * 9, Y / L * 9, 4, 31)
    col = col * (0.9 + 0.2 * mottle)[..., None] * (0.97 + 0.06 * grain)[..., None]
    height = height + (grain - 0.5) * 0.12

    # Sharks: dermal denticles — a fine, even grain, and no scales.
    if tex.get("denticles"):
        dn = vnoise(X / L * 900, Y / L * 900, 41)
        height = height + dn * 0.25
        col = col * (0.96 + 0.08 * fbm(X / L * 60, Y / L * 60, 3, 43))[..., None]

    # ── the lateral line: a row of pores ──
    if lateral_path:
        ts, us = zip(*lateral_path)
        lu = np.interp(u, ts, us)
        on = (T >= ts[0]) & (T <= ts[-1])
        for sgn in (1, -1):
            # The line's angle round the body on this side.
            ang = np.arccos(np.clip(lu, -1, 1))
            ang = ang if sgn > 0 else 2 * math.pi - ang
            dv = np.abs(A - ang[None, :]) * rmean[None, :] * L
            line = sstep(L * 0.004, L * 0.0015, dv) * on
            pores = 0.5 + 0.5 * np.cos(X / (L * 0.012) * 2 * math.pi)
            col = col * (1 - 0.18 * line * pores)[..., None]
            height = height - line * 0.25

    # ── the whale ──
    if tex.get("whale"):
        # Wrinkled skin, long throat grooves, old scars and barnacle clusters.
        wr = fbm(X / L * 70, Y / L * 25, 4, 51)
        height = height + (wr - 0.5) * 0.5
        throat = (T < 0.45) & (up < -0.45)
        groove = 0.5 + 0.5 * np.cos(Y / (L * 0.012) * 2 * math.pi)
        height = height - throat * sstep(0.7, 1.0, groove) * 0.8
        col = col * (1 - 0.18 * throat * sstep(0.75, 1.0, groove))[..., None]
        # A few old scratches, in patches — not a web of them.
        scars = sstep(0.993, 1.0, 1 - np.abs(fbm(X / L * 10, Y / L * 30, 2, 61) - 0.5) * 2)
        scars = scars * sstep(0.6, 0.7, fbm(X / L * 3, Y / L * 3, 2, 63)) * (up > -0.2)
        col = lerp(col, np.array([0.7, 0.7, 0.68]), 0.45 * scars)
        barn_zone = ((T < 0.12) & (up < 0.2)) | ((T > 0.22) & (T < 0.34) & (up < -0.3))
        barn = sstep(0.72, 0.8, fbm(X / L * 160, Y / L * 160, 2, 71)) * barn_zone
        col = lerp(col, np.array([0.85, 0.83, 0.78]), 0.8 * barn)
        height = height + barn * 0.9
        # A humpback's belly is blotched white and black, individually.
        blot = sstep(0.45, 0.6, fbm(X / L * 6, Y / L * 6, 3, 81)) * (up < -0.3)
        col = lerp(col, np.array([0.9, 0.9, 0.88]), 0.5 * blot)

    return np.clip(col, 0, 1), height


def scales(qx, qy):
    """
    Overlapping scales, the way they lie on a fish: in staggered columns, each
    anchored at its front, its rounded free edge toward the tail, and each
    lying over the front of the ones behind it. At any point the scale you see
    is the frontmost one that covers it. Returns height (0 at the anchor, 1 at
    the free edge — and 0 in the shadow just behind an overlapping edge), a
    per-scale random value, and a highlight along each exposed rim.
    `qx`, `qy` are in scale units: one column per unit along the body.
    """
    ix = np.floor(qx).astype(np.int64)
    best_d = np.full(qx.shape, 9.0)
    best_c = np.zeros(qx.shape)
    shadow = np.zeros(qx.shape)
    found = np.zeros(qx.shape, dtype=bool)
    for dc in (-1, 0):                         # the column in front first
        c = ix + dc
        off = 0.5 * (c % 2)
        r0 = np.floor(qy - off).astype(np.int64)
        for dr in (-1, 0, 1):
            r = r0 + dr
            jx = (_hash(c, r, 11) - 0.5) * 0.16
            jy = (_hash(c, r, 13) - 0.5) * 0.16
            ax, ay = c + jx, r + off + 0.5 + jy
            d = np.sqrt(((qx - ax) / 1.25) ** 2 + ((qy - ay) / 0.78) ** 2)
            take = (~found) & (d < 1.0)
            best_d = np.where(take, d, best_d)
            best_c = np.where(take, _hash(c, r, 17), best_c)
            found = found | take
            # Just past this scale's edge, where it overlaps the next one.
            shadow = np.maximum(shadow, sstep(1.18, 1.0, d) * (d >= 1.0))
    d = np.where(found, best_d, 1.0)
    height = d ** 1.4 * (1 - 0.8 * shadow)
    rim = sstep(0.8, 0.97, d)
    return height, best_c, rim


def paint_spots(col, X, Y, T, vv, spots, L, ring=False):
    """Round spots on a jittered grid in physical space — or rings, the peacock
    flounder's rosettes."""
    density = spots["density"]
    spacing = L * spots.get("size", 0.035) / math.sqrt(max(0.02, density) * 4)
    gx, gy = X / spacing, Y / spacing
    ix, iy = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    best = np.full(X.shape, 9.0)
    keep = np.zeros(X.shape)
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            cx, cy = ix + ox, iy + oy
            jx, jy = _hash(cx, cy, 91), _hash(cx, cy, 93)
            present = _hash(cx, cy, 97) < density * 4
            rad = 0.18 + 0.2 * _hash(cx, cy, 99)
            d = np.sqrt((gx - (cx + jx)) ** 2 + (gy - (cy + jy)) ** 2) / rad
            closer = present & (d < best)
            best = np.where(closer, d, best)
            keep = np.where(closer, 1.0, keep)
    (t0, t1), (u0, u1) = spots["t"], spots["up"]
    zone = sstep(t0, t0 + 0.03, T) * sstep(t1, t1 - 0.03, T) * sstep(u0, u0 + 0.1, vv) * sstep(u1, u1 - 0.1, vv)
    if ring:
        m = sstep(1.0, 0.85, best) * sstep(0.45, 0.6, best)
    else:
        m = sstep(1.0, 0.75, best)
    return lerp(col, rgb(spots["color"]), 0.92 * m * keep * zone)


# ── fins ─────────────────────────────────────────────────────────────────────
def fin_maps(info):
    """
    Albedo and height for one fin slot. `info` is what build_fish.py recorded
    for the fin: its colour, how many rays, whether it has rays at all, its tip
    colour and where the tip starts, and whether it is spiny.
    """
    n = max(1, info["rays"])
    px = int(S * 0.25)
    fu = (np.arange(px) + 0.5) / px
    FU, FV = np.meshgrid(fu, fu)
    base = np.array(info["color"])
    col = np.ones((px, px, 3)) * base
    height = np.zeros((px, px))
    if info.get("rays_visible", True):
        # Rays at the ray columns; soft rays fork into two past mid-fin.
        k = FU * n
        dr = np.abs(k - np.round(k)) / n
        fork = FV > 0.55
        k2 = FU * n * 2
        dr2 = np.abs(k2 - np.round(k2)) / (n * 2)
        dr = np.where(fork & (not info.get("spiny")), np.minimum(dr, dr2 + 0.002), dr)
        w = 0.14 / n
        ray = sstep(w, w * 0.35, dr)
        seg = 0.5 + 0.5 * np.cos(FV * 12 * math.pi)                 # segmented rays
        ray_col = base * (0.66 if not info.get("spiny") else 0.8)
        col = lerp(col * 1.06, ray_col, ray * (0.9 + 0.1 * seg))
        height = height + ray * 0.8
    # Membrane: lighter toward the edge, a little mottled; a darker margin.
    col = col * (0.92 + 0.14 * FV)[..., None]
    col = col * (0.95 + 0.1 * fbm(FU * 12, FV * 12, 3, 101))[..., None]
    col = col * (1 - 0.18 * sstep(0.93, 1.0, FV))[..., None]
    if info.get("tip") is not None:
        col = lerp(col, np.array(info["tip"]), sstep(info["tip_at"] - 0.012, info["tip_at"], FV))
    return np.clip(col, 0, 1), height


# ── assembling ───────────────────────────────────────────────────────────────
def atlas(sp, fins, outline, lateral_path):
    """The whole atlas: albedo (S, S, 3) and a tangent-space normal map
    (S, S, 3), both 0..1, rows bottom-up."""
    col = np.ones((S, S, 3))
    height = np.zeros((S, S))
    bc, bh = body_maps(sp, outline, lateral_path)
    col[S // 2:, :, :] = bc
    height[S // 2:, :] = bh
    for name in SLOTS:
        if name == "white":
            continue
        info = fins.get(name)
        if not info:
            continue
        u0, v0, w, h = slot_rect(name)
        x0, y0 = int(round(u0 * S)), int(round(v0 * S))
        fc, fh = fin_maps(info)
        wpx, hpx = int(round(w * S)), int(round(h * S))
        # Resample the slot to its padded size.
        ix = (np.arange(wpx) * fc.shape[1] / wpx).astype(int)
        iy = (np.arange(hpx) * fc.shape[0] / hpx).astype(int)
        col[y0:y0 + hpx, x0:x0 + wpx, :] = fc[iy][:, ix]
        height[y0:y0 + hpx, x0:x0 + wpx] = fh[iy][:, ix]
    strength = sp.get("texture", {}).get("normal", 2.2)
    gy, gx = np.gradient(height)
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / ln, ny / ln, nz / ln], axis=2) * 0.5 + 0.5
    return col, normal
