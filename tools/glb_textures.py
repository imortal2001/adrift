"""
Shrink the textures embedded in a .glb, leaving everything else byte-identical.

    python3 tools/glb_textures.py in.glb out.glb --colour 2048 --normal 1024 --quality 85

These models carry their skins as PNG inside the binary chunk, and some of them
are enormous: a 4096x4096 normal map costs about 16 MB on its own, which on the
raptor and the stegosaur is most of the file. At the distance the game draws an
animal that detail is invisible, and the two species already converted use
1024 normals, so there is a precedent to match.

Base colour is re-encoded to JPEG, which it tolerates well. Normal maps are
only resized, never re-encoded -- JPEG ringing on a normal map shows up as
shimmering facets across a curved surface, which is very visible and not worth
the megabyte it saves.

The buffer is rebuilt compactly rather than appended to; otherwise the old
image bytes stay in the file as dead weight and nothing actually shrinks.
Accessor offsets are relative to their bufferView, so moving views around is
safe as long as each view's contents and 4-byte alignment survive.

Resizing goes through `sips`, which ships with macOS, because Pillow is not a
dependency of this project.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def read_glb(path):
    d = open(path, "rb").read()
    off, js, bin_ = 12, None, b""
    while off < len(d):
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        chunk = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    return js, bin_


def write_glb(path, js, bin_):
    bin_ = bytearray(bin_)
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


def png_size(blob):
    if blob[:8] == PNG_SIG:
        return struct.unpack(">II", blob[16:24])
    return None


def roles(js):
    """image index -> what the material uses it for."""
    out = {}
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})

        def tag(t, name):
            if t:
                out[js["textures"][t["index"]]["source"]] = name

        tag(pbr.get("baseColorTexture"), "baseColor")
        tag(pbr.get("metallicRoughnessTexture"), "metalRough")
        tag(m.get("normalTexture"), "normal")
        tag(m.get("occlusionTexture"), "occlusion")
        tag(m.get("emissiveTexture"), "emissive")
    return out


def convert(blob, max_dim, to_jpeg, quality, tmp):
    """Resize (and optionally re-encode) one image via sips. Returns (blob, mime)."""
    src = os.path.join(tmp, "in.png")
    with open(src, "wb") as f:
        f.write(blob)
    size = png_size(blob)
    needs_resize = size and max(size) > max_dim
    dst = os.path.join(tmp, "out." + ("jpg" if to_jpeg else "png"))
    cmd = ["sips"]
    if needs_resize:
        cmd += ["-Z", str(max_dim)]
    if to_jpeg:
        cmd += ["-s", "format", "jpeg", "-s", "formatOptions", str(quality)]
    if len(cmd) == 1:
        return blob, None
    cmd += [src, "--out", dst]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not os.path.exists(dst):
        raise SystemExit(f"sips failed: {r.stderr.decode()[:200]}")
    return open(dst, "rb").read(), ("image/jpeg" if to_jpeg else "image/png")


def main():
    argv = sys.argv[1:]
    if len(argv) < 2:
        raise SystemExit("usage: glb_textures.py in.glb out.glb "
                         "[--colour N] [--normal N] [--quality Q]")
    src, dst = os.path.expanduser(argv[0]), os.path.expanduser(argv[1])
    opt = {"--colour": 2048, "--normal": 1024, "--quality": 85}
    for k in list(opt):
        if k in argv:
            opt[k] = int(argv[argv.index(k) + 1])

    js, bin_ = read_glb(src)
    role = roles(js)
    before = os.path.getsize(src)

    replacement = {}                    # bufferView index -> new bytes
    with tempfile.TemporaryDirectory() as tmp:
        for i, im in enumerate(js.get("images", [])):
            if "bufferView" not in im:
                continue
            bv = js["bufferViews"][im["bufferView"]]
            o = bv.get("byteOffset", 0)
            blob = bin_[o:o + bv["byteLength"]]
            what = role.get(i, "?")
            is_normal = what in ("normal", "metalRough", "occlusion")
            limit = opt["--normal"] if is_normal else opt["--colour"]
            new, mime = convert(blob, limit, to_jpeg=not is_normal,
                                quality=opt["--quality"], tmp=tmp)
            if mime is None or len(new) >= len(blob):
                print(f"   image[{i}] {what:10s} {len(blob)/1e6:6.2f} MB  kept")
                continue
            replacement[im["bufferView"]] = new
            if mime:
                im["mimeType"] = mime
            was = png_size(blob)
            now = png_size(new) or ("jpeg",)
            print(f"   image[{i}] {what:10s} {len(blob)/1e6:6.2f} -> {len(new)/1e6:5.2f} MB"
                  f"   {('%dx%d' % was) if was else '?':>9s} -> "
                  f"{('%dx%d' % now) if len(now) == 2 else 'jpeg':<9s} {mime}")

    if not replacement:
        print("  nothing to shrink")
        return

    # rebuild the buffer compactly, in the views' original order
    order = sorted(range(len(js["bufferViews"])),
                   key=lambda k: js["bufferViews"][k].get("byteOffset", 0))
    out = bytearray()
    for k in order:
        bv = js["bufferViews"][k]
        if k in replacement:
            data = replacement[k]
        else:
            o = bv.get("byteOffset", 0)
            data = bin_[o:o + bv["byteLength"]]
        while len(out) % 4:
            out.append(0)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
    js["buffers"][0]["byteLength"] = len(out) + ((-len(out)) % 4)
    write_glb(dst, js, out)
    after = os.path.getsize(dst)
    print(f"  {before/1e6:.1f} MB -> {after/1e6:.1f} MB  "
          f"({(1-after/before)*100:.0f}% smaller)  -> {dst}")


if __name__ == "__main__":
    main()
