"""Minimal GLB reader/writer for the HURR mesh-cleanup test (numpy only)."""
import io
import json
import struct

import numpy as np
from PIL import Image

_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
       5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    d = open(path, "rb").read()
    jl, _ = struct.unpack("<II", d[12:20])
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl, _ = struct.unpack("<II", d[off:off + 8])
    binc = d[off + 8:off + 8 + bl]

    def view(i):
        bv = j["bufferViews"][i]
        o = bv.get("byteOffset", 0)
        return binc[o:o + bv["byteLength"]]

    def acc(i):
        a = j["accessors"][i]
        raw = view(a["bufferView"])
        o = a.get("byteOffset", 0)
        n = _NC[a["type"]]
        arr = np.frombuffer(raw, dtype=_CT[a["componentType"]], count=a["count"] * n, offset=o)
        return arr.reshape(a["count"], n) if n > 1 else arr.copy()

    prim = j["meshes"][0]["primitives"][0]
    out = {
        "pos": acc(prim["attributes"]["POSITION"]).astype(np.float64),
        "uv": acc(prim["attributes"]["TEXCOORD_0"]).astype(np.float64),
        "faces": acc(prim["indices"]).reshape(-1, 3).astype(np.int64),
    }
    mat = j["materials"][prim["material"]]
    tex = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    t = j["textures"][tex]
    src = t.get("source", t.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
    img = Image.open(io.BytesIO(view(j["images"][src]["bufferView"]))).convert("RGB")
    out["tex"] = np.asarray(img).astype(np.float64) / 255.0
    return out


def _pad4(b, fill=b"\x00"):
    return b + fill * ((4 - len(b) % 4) % 4)


def write_glb(path, pos, nrm, col, faces=None, name="Nouf"):
    """Write a lit, vertex-coloured, non-metallic GLB. col: float RGB 0..1 (linear)."""
    pos = np.ascontiguousarray(pos, np.float32)
    nrm = np.ascontiguousarray(nrm, np.float32)
    col4 = np.ones((len(col), 4), np.float32)
    col4[:, :3] = col
    blobs, views, accs = [], [], []
    off = 0

    def add(arr, comp, typ, target, minmax=False):
        nonlocal off
        b = arr.tobytes()
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": target})
        a = {"bufferView": len(views) - 1, "componentType": comp,
             "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(0).tolist()
            a["max"] = arr.max(0).tolist()
        accs.append(a)
        b = _pad4(b)
        blobs.append(b)
        off += len(b)
        return len(accs) - 1

    attrs = {"POSITION": add(pos, 5126, "VEC3", 34962, True),
             "NORMAL": add(nrm, 5126, "VEC3", 34962),
             "COLOR_0": add(col4, 5126, "VEC4", 34962)}
    prim = {"attributes": attrs, "mode": 4, "material": 0}
    if faces is not None:
        prim["indices"] = add(np.ascontiguousarray(faces, np.uint32).reshape(-1), 5125, "SCALAR", 34963)
    j = {"asset": {"version": "2.0", "generator": "ABODEN HURR cleanup test"},
         "scene": 0, "scenes": [{"nodes": [0]}],
         "nodes": [{"name": name, "mesh": 0}],
         "meshes": [{"name": name, "primitives": [prim]}],
         "materials": [{"name": "nouf_vertex_colour",
                        "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1],
                                                 "metallicFactor": 0.0, "roughnessFactor": 1.0}}],
         "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": off}]}
    jb = _pad4(json.dumps(j, separators=(",", ":")).encode(), b" ")
    binb = b"".join(blobs)
    total = 12 + 8 + len(jb) + 8 + len(binb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack("<II", len(binb), 0x004E4942) + binb)
