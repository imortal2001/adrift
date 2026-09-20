"""
Move skin weights off unusable bones onto a stable parent.

    python3 tools/glb_reweight.py in.glb out.glb --onto Lhand --from Lfinger \
                                                 --onto Rhand --from Rfinger

Some rigs carry joint chains that zigzag: a helper joint juts far out from the
limb and its child comes back. The bind pose looks correct, because the net
position of the real joint is fine -- but the moment anything rotates that
helper, its child swings through an arc proportional to the offset, and the
geometry riding it is stretched into long spikes.

In the raptor the hand is a chain like

    Lhand -> joint29 -> LfingerA1 -> LfingerA2_correct -> LfingerA2 -> ...

where `LfingerA1` sits 18 units from the hand but `LfingerA2_correct` sits 88
and `LfingerA3_correct` 105 -- four times the length of the forearm. Every clip
rotates them, so the fingertips sweep out and the claws render as sabres about
a quarter of the animal's body length.

Rebuilding that chain would mean rewriting the bind matrices and every
translation track that feeds it. Since these are fingers on a creature seen
from ten metres away, the cheaper and far safer fix is to stop them deforming
independently: hand the weights to the wrist. The fingers go rigid, which at
that distance is invisible, and the swinging is gone.

That alone does not shorten anything, though. This model's claws are also
authored long -- they reach 43 units from the wrist against a 26-unit forearm,
about 1.6x -- so `--shrink` additionally pulls the affected geometry in toward
the anchor joint. The displacement is scaled by how strongly the folded joints
hold each vertex, so the knuckle blends smoothly instead of tearing away from
the hand.
"""
import json
import os
import struct
import sys

COMPONENT = {5126: ("f", 4), 5123: ("H", 2), 5121: ("B", 1), 5125: ("I", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    d = open(path, "rb").read()
    off, js, bin_ = 12, None, bytearray()
    while off < len(d):
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        chunk = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_ = bytearray(chunk)
        off += 8 + clen
    return js, bin_


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


class Access:
    def __init__(self, js, bin_, idx):
        a = js["accessors"][idx]
        bv = js["bufferViews"][a["bufferView"]]
        self.fmt, sz = COMPONENT[a["componentType"]]
        self.n = NCOMP[a["type"]]
        self.base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        self.stride = bv.get("byteStride") or sz * self.n
        self.count = a["count"]
        self.bin = bin_

    def get(self, i):
        return struct.unpack_from("<" + self.fmt * self.n, self.bin,
                                  self.base + i * self.stride)

    def set(self, i, v):
        struct.pack_into("<" + self.fmt * self.n, self.bin,
                         self.base + i * self.stride, *v)


def main():
    argv = sys.argv[1:]
    if len(argv) < 2:
        raise SystemExit("usage: glb_reweight.py in.glb out.glb "
                         "--onto <joint> --from <prefix> [--from <prefix>] ...")
    src, dst = os.path.expanduser(argv[0]), os.path.expanduser(argv[1])

    jobs, i = [], 2
    while i < len(argv):
        if argv[i] == "--onto":
            jobs.append({"onto": argv[i + 1], "from": [], "shrink": 1.0}); i += 2
        elif argv[i] == "--from":
            jobs[-1]["from"].append(argv[i + 1]); i += 2
        elif argv[i] == "--shrink":
            jobs[-1]["shrink"] = float(argv[i + 1]); i += 2
        else:
            i += 1
    if not jobs:
        raise SystemExit("nothing to do — pass --onto and --from")

    js, bin_ = read_glb(src)
    nodes, skin = js["nodes"], js["skins"][0]
    joints = skin["joints"]
    jname = [(nodes[j].get("name") or "").replace("skeleton:", "") for j in joints]

    prim = js["meshes"][0]["primitives"][0]
    jidx = Access(js, bin_, prim["attributes"]["JOINTS_0"])
    jw = Access(js, bin_, prim["attributes"]["WEIGHTS_0"])
    pos = Access(js, bin_, prim["attributes"]["POSITION"])
    ibm = Access(js, bin_, skin["inverseBindMatrices"])

    def bind_origin(slot):
        m = ibm.get(slot)
        r = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
        t = [m[12], m[13], m[14]]
        return [-(r[0][k] * t[0] + r[1][k] * t[1] + r[2][k] * t[2]) for k in range(3)]

    # slot index -> slot it should be folded into
    remap = {}
    shrinks = []                      # (anchor origin, member slots, factor)
    for job in jobs:
        targets = [s for s, n in enumerate(jname) if n.startswith(job["onto"])]
        if not targets:
            raise SystemExit(f"no joint named {job['onto']}")
        tgt = targets[0]
        members = set()
        for pre in job["from"]:
            for s, n in enumerate(jname):
                if n.startswith(pre) and s != tgt:
                    remap[s] = tgt
                    members.add(s)
        if job["shrink"] != 1.0:
            shrinks.append((bind_origin(tgt), members, job["shrink"]))
        print(f"  {', '.join(job['from'])} -> {jname[tgt]}  "
              f"({len(members)} joints, shrink {job['shrink']:.2f})")

    # pull the geometry in first, while the original weights still identify it
    pulled = 0
    for anchor, members, factor in shrinks:
        for v in range(pos.count):
            idxs, ws = jidx.get(v), jw.get(v)
            w = sum(ws[c] for c in range(4) if idxs[c] in members)
            if w <= 0.001:
                continue
            p = pos.get(v)
            tgt_p = [anchor[k] + (p[k] - anchor[k]) * factor for k in range(3)]
            pos.set(v, [p[k] + (tgt_p[k] - p[k]) * w for k in range(3)])
            pulled += 1
    if shrinks:
        print(f"  pulled in {pulled} vertices")

    touched = 0
    for v in range(jidx.count):
        idxs, ws = list(jidx.get(v)), list(jw.get(v))
        if not any(idxs[c] in remap and ws[c] > 0 for c in range(4)):
            continue
        acc = {}
        for c in range(4):
            if ws[c] <= 0:
                continue
            acc[remap.get(idxs[c], idxs[c])] = acc.get(remap.get(idxs[c], idxs[c]), 0.0) + ws[c]
        pairs = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in pairs) or 1.0
        out_i = [0, 0, 0, 0]
        out_w = [0.0, 0.0, 0.0, 0.0]
        for k, (b, w) in enumerate(pairs):
            out_i[k], out_w[k] = b, w / total
        jidx.set(v, out_i)
        jw.set(v, out_w)
        touched += 1

    print(f"  re-weighted {touched} of {jidx.count} vertices")
    write_glb(dst, js, bin_)
    print(f"  -> {dst}  ({os.path.getsize(dst) // 1024:,} KB)")


if __name__ == "__main__":
    main()
