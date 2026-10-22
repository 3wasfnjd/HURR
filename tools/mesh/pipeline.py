"""HURR — Nouf cleanup test: scale, decimate, flat facet colours, export GLB, previews."""
import json
import sys
import time

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, "/home/claude/hurr/tools")
from glbio import read_glb, write_glb  # noqa: E402
from decimate import weld, decimate  # noqa: E402
from render import render, sheet  # noqa: E402
from fix_head import flatten_ring, recolor  # noqa: E402
FIX = len(sys.argv) > 2 and sys.argv[2] == "fix"
TAG = "_fixed" if FIX else ""

TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
HEIGHT = 1.65
OUT = "/home/claude/hurr"

m = read_glb(f"{OUT}/nouf_raw.glb")
pos, F0, uv, tex = m["pos"], m["faces"], m["uv"], m["tex"]
H, W = tex.shape[:2]


def sample(uvs):
    px = np.clip((uvs[:, 0] * (W - 1)).round().astype(int), 0, W - 1)
    py = np.clip((uvs[:, 1] * (H - 1)).round().astype(int), 0, H - 1)
    return tex[py, px]


# scale: feet on y=0, height 1.65 m, centred on x/z
pos = pos - np.array([(pos[:, 0].min() + pos[:, 0].max()) / 2, pos[:, 1].min(),
                      (pos[:, 2].min() + pos[:, 2].max()) / 2])
pos *= HEIGHT / pos[:, 1].max()
if FIX:
    pos, nb, nm = flatten_ring(pos)
    print("ring band verts", nb, "moved", nm)

# dense colour samples on the original surface (vertices + face centroids)
samp_p = np.concatenate([pos, pos[F0].mean(1)])
samp_c = np.concatenate([sample(uv), sample(uv[F0].mean(1))])
if FIX:
    samp_c, nv, nr = recolor(samp_p, samp_c)
    print("recoloured violet", nv, "ring", nr)
tree = cKDTree(samp_p)

V, F, first = weld(pos, F0)
vcol = sample(uv[first])
if FIX:
    vcol, _, _ = recolor(V, vcol)

# protect the face, hands/glove and belt details: higher collapse cost
y = V[:, 1] / HEIGHT
w = np.ones(len(V))
w[(y > 0.86) & (V[:, 2] > 0.0)] = 6.0          # front of the head / face
w[(y > 0.40) & (y < 0.62) & (np.abs(V[:, 0]) > 0.20)] = 2.5   # hands + glove
t = time.time()
Vd, Fd = decimate(V, F, TARGET, vcol=vcol, color_w=0.5, vweight=w,
                  log=lambda k: print("  faces", k, f"{time.time()-t:.0f}s", flush=True))
print("decimated", len(Fd), "tris", len(Vd), "verts", f"{time.time()-t:.0f}s")

# facet colour = mean of 7 points per triangle, looked up on the original surface
bary = np.array([[1/3, 1/3, 1/3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6],
                 [.45, .45, .1], [.1, .45, .45], [.45, .1, .45]])
tri = Vd[Fd]
pts = np.einsum("kj,fjd->fkd", bary, tri).reshape(-1, 3)
_, idx = tree.query(pts)
fcol = samp_c[idx].reshape(len(Fd), len(bary), 3)
fcol = np.median(fcol, axis=1)

# checks
e = np.sort(np.concatenate([Fd[:, [0, 1]], Fd[:, [1, 2]], Fd[:, [2, 0]]]), axis=1)
u, c = np.unique(e, axis=0, return_counts=True)
nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
area = np.linalg.norm(nrm, axis=1)
dist, _ = cKDTree(pos).query(Vd)
report = {
    "triangles": int(len(Fd)), "unique_vertices": int(len(Vd)),
    "boundary_edges": int((c == 1).sum()), "nonmanifold_edges": int((c > 2).sum()),
    "degenerate_tris": int((area < 1e-10).sum()), "nan": bool(np.isnan(Vd).any()),
    "height_m": round(float(Vd[:, 1].max() - Vd[:, 1].min()), 4),
    "max_vertex_deviation_mm": round(float(dist.max() * 1000), 2),
    "mean_vertex_deviation_mm": round(float(dist.mean() * 1000), 3),
}

# flat-shaded export: each facet gets its own 3 vertices, normal and colour
fn = nrm / (area[:, None] + 1e-20)
P = tri.reshape(-1, 3)
N = np.repeat(fn, 3, axis=0)
C = np.repeat(fcol, 3, axis=0) ** 2.2            # sRGB texture -> linear vertex colour
glb = f"{OUT}/nouf_lowpoly_{TARGET//1000}k{TAG}.glb"
write_glb(glb, P, N, C, faces=np.arange(len(P)).reshape(-1, 3))
import os  # noqa: E402
report["glb_bytes"] = os.path.getsize(glb)
report["gpu_vertices_flat"] = int(len(P))
print(json.dumps(report, indent=1))
json.dump(report, open(f"{OUT}/report_{TARGET//1000}k{TAG}.json", "w"), indent=1)

sheet([render(Vd, Fd, fcol, yaw=a, h=700) for a in (0, 90, 180)]).save(f"{OUT}/preview_{TARGET//1000}k{TAG}.png")
sheet([render(Vd, Fd, fcol, yaw=0, h=700, wire=True), render(Vd, Fd, fcol, yaw=35, h=700)]).save(
    f"{OUT}/preview_{TARGET//1000}k{TAG}_wire.png")
