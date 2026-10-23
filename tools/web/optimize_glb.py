"""Web copies of HURR's faceted, vertex-coloured GLBs: keep POSITION, drop NORMAL (the web
material uses flatShading, so facets are lit per pixel exactly as before), store COLOR_0 as
normalized uint16 RGB (glTF 2.0 allows UNSIGNED_SHORT normalized for COLOR_0; 8-bit linear
colour would band in the dark tones). Non-indexed.
python3 tools/web/optimize_glb.py in.glb out.glb"""
import json
import struct
import sys

import numpy as np


def read(path):
    d = open(path, "rb").read()
    jl, _ = struct.unpack("<II", d[12:20])
    j = json.loads(d[20:20 + jl])
    b = d[20 + jl + 8:]
    prim = j["meshes"][0]["primitives"][0]

    def acc(i, n):
        a = j["accessors"][i]
        v = j["bufferViews"][a["bufferView"]]
        return np.frombuffer(b, np.float32, count=a["count"] * n,
                             offset=v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(-1, n)
    pos = acc(prim["attributes"]["POSITION"], 3)
    col = acc(prim["attributes"]["COLOR_0"], 4)[:, :3]
    if "indices" in prim:
        a = j["accessors"][prim["indices"]]
        v = j["bufferViews"][a["bufferView"]]
        idx = np.frombuffer(b, np.uint32, count=a["count"], offset=v.get("byteOffset", 0))
        pos, col = pos[idx], col[idx]
    return pos, col, j["meshes"][0].get("name", "mesh")


def pad(b, fill=b"\x00"):
    return b + fill * ((4 - len(b) % 4) % 4)


def write(path, pos, col, name):
    # glTF COLOR_0 is linear; 16-bit keeps the dark facets distinct.
    c8 = np.clip(np.round(col * 65535.0), 0, 65535).astype(np.uint16)
    c8 = np.concatenate([c8, np.zeros((len(c8), 1), np.uint16)], 1)   # pad to an 8-byte stride
    pb = pos.astype(np.float32).tobytes()
    cb = c8.tobytes()
    views = [{"buffer": 0, "byteOffset": 0, "byteLength": len(pb), "target": 34962},
             {"buffer": 0, "byteOffset": len(pb), "byteLength": len(cb), "byteStride": 8, "target": 34962}]
    accs = [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3",
             "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
            {"bufferView": 1, "componentType": 5123, "normalized": True, "count": len(pos), "type": "VEC3"}]
    j = {"asset": {"version": "2.0", "generator": "ABODEN HURR web optimizer"}, "scene": 0,
         "scenes": [{"nodes": [0]}], "nodes": [{"name": name, "mesh": 0}],
         "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "COLOR_0": 1}, "mode": 4}]}],
         "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(pb) + len(cb)}]}
    jb = pad(json.dumps(j, separators=(",", ":")).encode(), b" ")
    binb = pb + cb
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack("<II", len(binb), 0x004E4942) + binb)


if __name__ == "__main__":
    p, c, n = read(sys.argv[1])
    write(sys.argv[2], p, c, n)
    import os
    print(f"{sys.argv[2]}: {len(p)//3} tris, {os.path.getsize(sys.argv[1])/1e6:.2f} MB -> {os.path.getsize(sys.argv[2])/1e6:.2f} MB")
