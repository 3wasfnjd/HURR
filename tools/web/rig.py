"""Shared humanoid skeleton + skinned-GLB writer for the HURR web build (numpy only).

Every character (Najd, the trappers) uses the same bone names and rest layout, so one
procedural animation module drives them all. Rest pose: A-pose, facing +Z, feet at y=0.
Bones carry identity rest rotations; inverse bind matrices are pure translations.
"""
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from skeleton import SKELETON, NAMES, TIPS  # noqa: E402  (v2: 21 bones)
IDX = {n: i for i, n in enumerate(NAMES)}


def joint_pos(scale=1.0):
    return {n: np.array(p) * scale for n, (_, p) in SKELETON.items()}


def seg_dist(p, a, b):
    """Distance from points p (N,3) to segment ab, and the clamped parameter t."""
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0.0, 1.0)
    d = np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
    return d, t


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def limit4(w):
    """Keep the 4 largest influences per vertex, renormalise. Returns (joints uint8, weights uint8)."""
    order = np.argsort(-w, axis=1)[:, :4]
    ww = np.take_along_axis(w, order, axis=1)
    ww = ww / np.maximum(ww.sum(1, keepdims=True), 1e-9)
    q = np.round(ww * 255).astype(np.int32)
    q[:, 0] += 255 - q.sum(1)                   # exact sum 255 (glTF wants normalised sums of 1)
    q[ww == 0] = 0
    order[ww == 0] = 0
    return order.astype(np.uint8), np.clip(q, 0, 255).astype(np.uint8)


def _pad4(b, fill=b"\x00"):
    return b + fill * ((4 - len(b) % 4) % 4)


def write_skinned_glb(path, pos, col, joints, weights, scale=1.0, name="Character", clips=None):
    """Non-indexed, normal-less (flat-shaded in three.js), COLOR_0 as uint16 normalised."""
    n = len(pos)
    jp = joint_pos(scale)
    pos32 = pos.astype(np.float32)
    col16 = np.zeros((n, 4), np.uint16)                      # 8-byte stride keeps 4-byte alignment
    col16[:, :3] = np.round(np.clip(col, 0, 1) * 65535)
    ibm = np.zeros((len(NAMES), 4, 4), np.float32)
    for i, nm in enumerate(NAMES):
        m = np.eye(4, dtype=np.float32)
        m[:3, 3] = -jp[nm]
        ibm[i] = m.T                                         # glTF matrices are column-major
    blobs = [pos32.tobytes(), col16.tobytes(), joints.tobytes(), weights.tobytes(), ibm.tobytes()]
    strides = [12, 8, 4, 4, None]
    acc_extra, animations = [], []
    for cname, clip in (clips or {}).items():
        n_f = len(clip["root"])
        times = (np.arange(n_f) / clip["fps"]).astype(np.float32)
        base = len(blobs)
        blobs.append(times.tobytes()); strides.append(None)
        acc_extra.append({"bufferView": base, "componentType": 5126, "count": n_f, "type": "SCALAR",
                          "min": [float(times[0])], "max": [float(times[-1])]})
        t_acc = 5 + len(acc_extra) - 1
        samplers, channels = [], []
        for b in NAMES:
            q = np.asarray(clip["tracks"][b], np.float32)
            blobs.append(q.tobytes()); strides.append(None)
            acc_extra.append({"bufferView": len(blobs) - 1, "componentType": 5126, "count": n_f, "type": "VEC4"})
            samplers.append({"input": t_acc, "output": 5 + len(acc_extra) - 1, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": 1 + IDX[b], "path": "rotation"}})
        root = np.asarray(clip["root"], np.float32) * scale
        blobs.append(root.tobytes()); strides.append(None)
        acc_extra.append({"bufferView": len(blobs) - 1, "componentType": 5126, "count": n_f, "type": "VEC3"})
        samplers.append({"input": t_acc, "output": 5 + len(acc_extra) - 1, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": 1 + IDX["hips"], "path": "translation"}})
        animations.append({"name": cname, "samplers": samplers, "channels": channels})
    views, off, binary = [], 0, b""
    for b, st in zip(blobs, strides):
        b = _pad4(b)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
        if st:
            v["byteStride"] = st
            v["target"] = 34962
        views.append(v)
        binary += b
        off += len(b)
    acc = [
        {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3",
         "min": pos32.min(0).tolist(), "max": pos32.max(0).tolist()},
        {"bufferView": 1, "componentType": 5123, "normalized": True, "count": n, "type": "VEC3"},
        {"bufferView": 2, "componentType": 5121, "count": n, "type": "VEC4"},
        {"bufferView": 3, "componentType": 5121, "normalized": True, "count": n, "type": "VEC4"},
        {"bufferView": 4, "componentType": 5126, "count": len(NAMES), "type": "MAT4"},
    ] + acc_extra
    nodes = [{"name": name, "mesh": 0, "skin": 0}]
    for nm in NAMES:
        parent, _ = SKELETON[nm]
        t = jp[nm] - (jp[parent] if parent else 0)
        nodes.append({"name": nm, "translation": [float(x) for x in t]})
    for nm in NAMES:
        kids = [1 + IDX[c] for c, (p, _) in SKELETON.items() if p == nm]
        if kids:
            nodes[1 + IDX[nm]]["children"] = kids
    gltf = {
        "asset": {"version": "2.0", "generator": "HURR tools/web/rig.py"},
        "scene": 0,
        "scenes": [{"nodes": [0, 1 + IDX["hips"]]}],
        "nodes": nodes,
        "meshes": [{"name": name, "primitives": [{"attributes": {
            "POSITION": 0, "COLOR_0": 1, "JOINTS_0": 2, "WEIGHTS_0": 3}, "mode": 4}]}],
        "skins": [{"joints": [1 + i for i in range(len(NAMES))], "inverseBindMatrices": 4,
                   "skeleton": 1 + IDX["hips"]}],
        "accessors": acc,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    if animations:
        gltf["animations"] = animations
    js = _pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(binary), 0x004E4942) + binary
    open(path, "wb").write(out)
    return len(out)


def read_colored_glb(path):
    """Reads a (possibly strided / normalised) POSITION + COLOR_0 GLB; returns non-indexed pos, col."""
    ct = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    nc = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}
    d = open(path, "rb").read()
    jl, _ = struct.unpack("<II", d[12:20])
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl, _ = struct.unpack("<II", d[off:off + 8])
    binc = d[off + 8:off + 8 + bl]

    def acc(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        k, dt = nc[a["type"]], np.dtype(ct[a["componentType"]])
        st = bv.get("byteStride", k * dt.itemsize)
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        rows = np.frombuffer(binc, np.uint8, count=st * (a["count"] - 1) + k * dt.itemsize, offset=o)
        arr = np.lib.stride_tricks.as_strided(rows, (a["count"], k * dt.itemsize), (st, 1)).copy()
        arr = arr.view(dt).reshape(a["count"], k).astype(np.float64)
        return arr / np.iinfo(dt).max if a.get("normalized") else arr

    p = j["meshes"][0]["primitives"][0]
    pos, col = acc(p["attributes"]["POSITION"]), acc(p["attributes"]["COLOR_0"])[:, :3]
    if "indices" in p:
        idx = acc(p["indices"]).astype(int).ravel()
        pos, col = pos[idx], col[idx]
    return pos, col
