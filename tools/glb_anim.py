"""
Write animation clips straight into a glTF binary, without a DCC round-trip.

    python3 tools/glb_anim.py <input.glb> <output.glb> [--biped]

Plenty of rigged models ship with no actions at all: the skeleton is there,
nobody keyed it. The obvious fix — import to Blender, animate, export — does
not survive contact with rigs whose bind space disagrees with their node
transforms; Blender reads them, but what comes back out is a shredded mesh.

So this leaves the asset alone. Meshes, skins, materials, textures and every
existing node transform are copied through untouched; the only additions are
new accessors holding rotation curves, and the `animations` array that points
at them. Nothing that already renders can change, because nothing that already
renders is rewritten.

Rotations are authored in model space (glTF: +X right, +Y up, +Z forward) and
converted into each joint's parent frame as
    local' = conj(Qp) * R * Qp * local_rest
which is scale-free, and therefore immune to the bind-space problem above.
"""
import json
import math
import os
import re
import struct
import sys

FPS = 24.0


# ── quaternion helpers (w, x, y, z) ──────────────────────────────────────────
def qmul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw)


def qconj(q):
    return (q[0], -q[1], -q[2], -q[3])


def qaxis(axis, ang):
    h = ang * 0.5
    s = math.sin(h)
    return (math.cos(h), s if axis == "X" else 0.0,
            s if axis == "Y" else 0.0, s if axis == "Z" else 0.0)


def qnorm(q):
    n = math.sqrt(sum(c * c for c in q)) or 1.0
    return tuple(c / n for c in q)


# ── glb container ────────────────────────────────────────────────────────────
def read_glb(path):
    d = open(path, "rb").read()
    magic, ver, _ = struct.unpack("<III", d[:12])
    if magic != 0x46546C67:
        raise SystemExit(f"{path}: not a glb")
    off, js, bin_ = 12, None, b""
    while off < len(d):
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        chunk = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    return js, bytearray(bin_)


def write_glb(path, js, bin_):
    while len(bin_) % 4:
        bin_.append(0)
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    while len(jb) % 4:
        jb += b" "
    total = 12 + 8 + len(jb) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)


def add_accessor(js, bin_, data, kind):
    """Append raw float data as a new bufferView + accessor; return its index."""
    while len(bin_) % 4:
        bin_.append(0)
    offset = len(bin_)
    flat = [c for v in data for c in v] if kind == "VEC4" else list(data)
    bin_ += struct.pack(f"<{len(flat)}f", *flat)
    js.setdefault("bufferViews", []).append(
        {"buffer": 0, "byteOffset": offset, "byteLength": len(flat) * 4})
    acc = {"bufferView": len(js["bufferViews"]) - 1, "componentType": 5126,
           "count": len(data), "type": kind}
    if kind == "SCALAR":
        acc["min"], acc["max"] = [min(data)], [max(data)]
    js.setdefault("accessors", []).append(acc)
    return len(js["accessors"]) - 1


# ── rest pose ────────────────────────────────────────────────────────────────
def node_rest(js):
    """Parent map, local rest rotations, and each node's world rest rotation."""
    nodes = js["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    local = {}
    for i, n in enumerate(nodes):
        if "rotation" in n:
            x, y, z, w = n["rotation"]          # glTF stores xyzw
            local[i] = qnorm((w, x, y, z))
        else:
            local[i] = (1.0, 0.0, 0.0, 0.0)
    world = {}

    def resolve(i):
        if i in world:
            return world[i]
        p = parent.get(i)
        world[i] = local[i] if p is None else qmul(resolve(p), local[i])
        return world[i]

    for i in range(len(nodes)):
        resolve(i)
    return parent, local, world


def apply(js, local, world, parent, node, *rots):
    """A model-space rotation, expressed in `node`'s parent frame."""
    R = (1.0, 0.0, 0.0, 0.0)
    for axis, ang in rots:
        R = qmul(qaxis(axis, ang), R)
    p = parent.get(node)
    qp = world[p] if p is not None else (1.0, 0.0, 0.0, 0.0)
    return qnorm(qmul(qmul(qmul(qconj(qp), R), qp), local[node]))


# ── skeleton roles ───────────────────────────────────────────────────────────
def canon(name):
    return re.sub(r"_\d+$", "", name or "")


def find_roles(js, biped):
    idx = {}
    for i, n in enumerate(js["nodes"]):
        idx.setdefault(canon(n.get("name")), i)

    def one(*names):
        for n in names:
            if n in idx:
                return idx[n]
        return None

    def chain(stem, limit=16):
        out = []
        first = one(stem)
        if first is not None:
            out.append(first)
        for i in range(1, limit):
            nxt = one(f"{stem}_{i}")
            if nxt is None:
                break
            out.append(nxt)
        return out

    def leg(u, l, f):
        trio = (one(u), one(l), one(f))
        return trio if trio[0] is not None else None

    roles = {
        "root": one("bip_pelvis", "bip_root"),
        "spine": [i for i in (one(f"bip_spine_{k}") for k in range(6)) if i is not None],
        "neck": chain("bip_neck"),
        "head": one("bip_head"),
        "jaw": one("bip_jaw"),
        "tail": chain("bip_tail"),
    }
    if biped:
        roles["legs"] = {"l": leg("bip_hip_l", "bip_knee_l", "bip_foot_l"),
                         "r": leg("bip_hip_r", "bip_knee_r", "bip_foot_r")}
        roles["phase"] = {"l": 0.0, "r": 0.5}
    else:
        roles["legs"] = {
            "fl": leg("bip_upperarm_l", "bip_lowerarm_l", "bip_hand_l"),
            "fr": leg("bip_upperarm_r", "bip_lowerarm_r", "bip_hand_r"),
            "bl": leg("bip_hip_l", "bip_knee_l", "bip_foot_l"),
            "br": leg("bip_hip_r", "bip_knee_r", "bip_foot_r"),
        }
        roles["phase"] = {"bl": 0.00, "fl": 0.25, "br": 0.50, "fr": 0.75}
    roles["legs"] = {k: v for k, v in roles["legs"].items() if v}
    return roles


# ── motion ───────────────────────────────────────────────────────────────────
# glTF is Y-up, +Z forward: X pitches (fore/aft swing), Y yaws (side to side),
# Z rolls. A leg bone points along -Y, so a positive X rotation drives it back.
def lagof(bones, total):
    """Per-segment phase lag that sums to `total` radians across the chain."""
    return total / max(1, len(bones))


class Clip:
    def __init__(self, name, frames, loop=True):
        self.name, self.frames, self.loop = name, frames, loop
        self.curves = {}                     # node -> [quat per sampled frame]
        self.times = []

    def put(self, node, q):
        if node is None:
            return
        self.curves.setdefault(node, []).append(q)


def leg_pose(clip, ctx, trio, t, swing, fold, ankle):
    upper, lower, foot = trio
    a = -swing * math.cos(2 * math.pi * t)
    f = fold * max(0.0, math.sin(2 * math.pi * (t - 0.55)))
    clip.put(upper, ctx(upper, ("X", a)))
    if lower is not None:
        clip.put(lower, ctx(lower, ("X", f)))
    if foot is not None:
        clip.put(foot, ctx(foot, ("X", -(a * 0.30 + f * ankle))))


def wave(clip, ctx, bones, t, amp, lag, taper_out, pitch=0.0, pitch_amp=0.0,
         floor=0.35):
    """
    A travelling wave down a neck or tail.

    `lag` is the phase each segment trails the one before it. Total lag across
    the chain wants to stay well under a full 2*pi: at a full wavelength the
    segments sit at opposing phases and cancel, and the tail ends up shivering
    in place instead of swinging. `floor` keeps the root of the chain in the
    motion — tapering straight from zero leaves the base third rigid, which is
    the other half of the same stiff look.
    """
    n = max(1, len(bones))
    for i, nd in enumerate(bones, start=1):
        ph = 2 * math.pi * t - i * lag
        u = i / n
        k = (floor + (1.0 - floor) * u) if taper_out else (1.0 - 0.5 * (i - 1) / max(1, n - 1))
        clip.put(nd, ctx(nd, ("Y", amp * k * math.sin(ph)),
                             ("X", pitch * k + pitch_amp * k * math.sin(ph * 0.5))))


def gait(roles, ctx, name, frames, cfg, step=2):
    jaw = cfg.get("jaw", 0.0)
    clip = Clip(name, frames)
    for f in range(1, frames + 2, step):
        t = (f - 1) / frames
        clip.times.append((f - 1) / FPS)
        for tag, trio in roles["legs"].items():
            leg_pose(clip, ctx, trio, (t + roles["phase"][tag]) % 1.0,
                     cfg["swing"], cfg["fold"], cfg.get("ankle", 0.6))
        clip.put(roles["root"], ctx(roles["root"],
                 ("Z", cfg["roll"] * math.sin(2 * math.pi * t)),
                 ("Y", cfg["yaw"] * math.sin(2 * math.pi * t)),
                 ("X", (cfg["bob"] + cfg.get("pitch", 0.0)) * math.sin(4 * math.pi * t))))
        for i, nd in enumerate(roles["spine"]):
            clip.put(nd, ctx(nd, ("Y", cfg["yaw"] * 0.5 * math.sin(2 * math.pi * t + 0.5 + i * 0.3)),
                                 ("X", cfg["bob"] * 0.5 * math.sin(4 * math.pi * t))))
        wave(clip, ctx, roles["neck"], t, cfg["neck"], lagof(roles["neck"], 1.5),
             False, pitch_amp=cfg["neck"] * 0.5)
        wave(clip, ctx, roles["tail"], t, cfg["tail"], lagof(roles["tail"], 2.2),
             True, pitch_amp=cfg["tail"] * 0.22)
        clip.put(roles["head"], ctx(roles["head"],
                 ("Y", -cfg["neck"] * 0.6 * math.sin(2 * math.pi * t))))
        clip.put(roles["jaw"], ctx(roles["jaw"], ("X", -jaw)))
    return clip


def idle(roles, ctx, frames=96, jaw=0.0):
    clip = Clip("Idle", frames)
    for f in range(1, frames + 2, 3):
        t = (f - 1) / frames
        clip.times.append((f - 1) / FPS)
        breath, look = math.sin(4 * math.pi * t), math.sin(2 * math.pi * t)
        clip.put(roles["root"], ctx(roles["root"], ("Z", 0.005 * look), ("X", 0.006 * breath)))
        for nd in roles["spine"]:
            clip.put(nd, ctx(nd, ("X", 0.010 * breath)))
        for tag, trio in roles["legs"].items():
            clip.put(trio[0], ctx(trio[0], ("X", 0.012 * math.sin(2 * math.pi * t + len(tag)))))
        wave(clip, ctx, roles["neck"], t, 0.06, lagof(roles["neck"], 1.2), False,
             pitch=-0.04 * look, pitch_amp=0.02)
        wave(clip, ctx, roles["tail"], t, 0.10, lagof(roles["tail"], 1.8), True,
             pitch_amp=0.022)
        clip.put(roles["head"], ctx(roles["head"], ("Y", -0.05 * look), ("X", 0.03 * breath)))
        clip.put(roles["jaw"], ctx(roles["jaw"], ("X", -jaw + 0.02 * breath)))
    return clip


def keyed(roles, ctx, name, poses, jaw=0.0):
    """One-shot clip from explicit (frame, params) poses, linearly sampled."""
    last = poses[-1][0]
    clip = Clip(name, last, loop=False)
    for f in range(1, last + 1, 2):
        # find the bracketing poses and blend between them
        prev, nxt = poses[0], poses[-1]
        for i in range(len(poses) - 1):
            if poses[i][0] <= f <= poses[i + 1][0]:
                prev, nxt = poses[i], poses[i + 1]
                break
        span = max(1, nxt[0] - prev[0])
        u = (f - prev[0]) / span
        u = u * u * (3 - 2 * u)                       # smoothstep, so it eases
        p = {k: prev[1][k] + (nxt[1][k] - prev[1][k]) * u for k in prev[1]}
        clip.times.append((f - 1) / FPS)
        for trio in roles["legs"].values():
            upper, lower, foot = trio
            clip.put(upper, ctx(upper, ("X", p["fold"] * 0.9)))
            if lower is not None:
                clip.put(lower, ctx(lower, ("X", p["fold"] * 1.5)))
            if foot is not None:
                clip.put(foot, ctx(foot, ("X", -p["fold"] * 0.8)))
        nn = max(1, len(roles["neck"]))
        for nd in roles["neck"]:
            clip.put(nd, ctx(nd, ("X", p["neck"] / nn), ("Y", p["neckyaw"] / nn)))
        tn = max(1, len(roles["tail"]))
        for i, nd in enumerate(roles["tail"], start=1):
            clip.put(nd, ctx(nd, ("Y", p["tail"] * (i / tn)), ("X", p["taildrop"] * (i / tn))))
        clip.put(roles["head"], ctx(roles["head"], ("X", p["neck"] * 0.4)))
        clip.put(roles["jaw"], ctx(roles["jaw"], ("X", -jaw + p["gape"])))
        clip.put(roles["root"], ctx(roles["root"], ("Y", p["yaw"]), ("Z", p["tilt"]), ("X", p["pitch"])))
    return clip


def P(fold=0, neck=0, neckyaw=0, tail=0, taildrop=0, gape=0, yaw=0, tilt=0, pitch=0):
    return dict(fold=fold, neck=neck, neckyaw=neckyaw, tail=tail,
                taildrop=taildrop, gape=gape, yaw=yaw, tilt=tilt, pitch=pitch)


def attack(roles, ctx, biped, jaw=0.0):
    if biped:                                   # rear back, then drive the jaws in
        poses = [(1, P()), (8, P(neck=-0.34, neckyaw=0.10, tail=-0.20, yaw=0.06, gape=0.45, pitch=-0.10)),
                 (16, P(neck=0.42, neckyaw=-0.06, tail=0.26, yaw=-0.05, gape=0.55, pitch=0.08)),
                 (22, P(neck=0.30, tail=0.18, gape=0.05, pitch=0.04)), (34, P())]
    else:                                       # coil away, lash the tail across
        poses = [(1, P()), (9, P(neck=-0.26, neckyaw=0.20, tail=-0.42, yaw=0.10, gape=0.12)),
                 (17, P(neck=-0.14, neckyaw=-0.18, tail=0.62, yaw=-0.13, gape=0.10)),
                 (25, P(neck=0.04, neckyaw=-0.06, tail=0.28, yaw=-0.04)), (36, P())]
    return keyed(roles, ctx, "Attack", poses, jaw)


def death(roles, ctx, jaw=0.0):
    return keyed(roles, ctx, "Death", jaw=jaw, poses=[
        (1,  P()),
        (10, P(fold=-0.10, neck=-0.50, tail=0.10, tilt=-0.05, pitch=-0.04)),
        (24, P(fold=0.55, neck=0.30, tail=0.24, tilt=0.22, pitch=0.12)),
        (40, P(fold=1.15, neck=0.90, tail=0.40, tilt=0.46, pitch=0.24)),
        (60, P(fold=1.30, neck=1.10, tail=0.48, tilt=0.52, pitch=0.28)),
    ])


# ── assembly ─────────────────────────────────────────────────────────────────
def main():
    argv = sys.argv[1:]
    if len(argv) < 2:
        raise SystemExit(__doc__.strip().splitlines()[2])
    src, dst = os.path.expanduser(argv[0]), os.path.expanduser(argv[1])
    biped = "--biped" in argv
    jaw = 0.0
    if "--jaw" in argv:
        jaw = float(argv[argv.index("--jaw") + 1])
    # How freely the tail carries the wave. A diplodocid tail is a whip; a
    # hadrosaur's was stiffened with ossified tendons and a theropod's is a
    # counterbalance held rigid, so they want scaling down from the default.
    tailmul = 1.0
    if "--tail" in argv:
        tailmul = float(argv[argv.index("--tail") + 1])

    js, bin_ = read_glb(src)
    if js.get("animations"):
        print(f"  note: {len(js['animations'])} existing clip(s) kept")
    parent, local, world = node_rest(js)
    roles = find_roles(js, biped)
    if not roles["legs"]:
        raise SystemExit("no limbs found — bone names not recognised")
    print(f"  legs={sorted(roles['legs'])} spine={len(roles['spine'])} "
          f"neck={len(roles['neck'])} tail={len(roles['tail'])} "
          f"head={'y' if roles['head'] is not None else 'n'} "
          f"jaw={'y' if roles['jaw'] is not None else 'n'}")

    def ctx(node, *rots):
        return apply(js, local, world, parent, node, *rots)

    walk = dict(swing=0.20, fold=0.16, bob=0.030, roll=0.020, yaw=0.026,
                neck=0.055, tail=0.175, ankle=0.6)
    run = dict(swing=0.34, fold=0.30, bob=0.055, roll=0.034, yaw=0.042,
               neck=0.090, tail=0.290, ankle=0.7)
    if biped:
        walk.update(swing=0.26, fold=0.34, pitch=0.010, ankle=0.85)
        run.update(swing=0.44, fold=0.52, pitch=0.022, ankle=0.95)

    walk["jaw"] = run["jaw"] = jaw
    walk["tail"] *= tailmul
    run["tail"] *= tailmul
    clips = [idle(roles, ctx, jaw=jaw), gait(roles, ctx, "Walk", 44, walk),
             gait(roles, ctx, "Run", 26, run), attack(roles, ctx, biped, jaw),
             death(roles, ctx, jaw)]

    js.setdefault("animations", [])
    for clip in clips:
        tin = add_accessor(js, bin_, clip.times, "SCALAR")
        channels, samplers = [], []
        for node, quats in clip.curves.items():
            # glTF wants xyzw; the maths above carries wxyz
            out = add_accessor(js, bin_, [(q[1], q[2], q[3], q[0]) for q in quats], "VEC4")
            samplers.append({"input": tin, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1,
                             "target": {"node": node, "path": "rotation"}})
        js["animations"].append({"name": clip.name, "channels": channels,
                                 "samplers": samplers})
        print(f"  {clip.name:7s} {len(clip.times):3d} keys x {len(clip.curves):3d} joints")

    js["buffers"][0]["byteLength"] = len(bin_) + ((-len(bin_)) % 4)
    write_glb(dst, js, bin_)
    print(f"  -> {dst}  ({os.path.getsize(dst) // 1024:,} KB)")


if __name__ == "__main__":
    main()
