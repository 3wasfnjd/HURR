"""Cut the stone off the 8k falcon so it can fly: keep triangles above the stone top,
put the feet at y=0, write falcon_body.glb (flat-shaded, vertex colours) + preview."""
import json, struct, sys
import numpy as np
sys.path.insert(0, "/home/claude/hurr/tools")
from glbio import write_glb
from render import render, sheet

d = open("/home/claude/hurr/falcon/falcon_lowpoly_8k.glb", "rb").read()
jl, _ = struct.unpack("<II", d[12:20]); j = json.loads(d[20:20 + jl]); b = d[20 + jl + 8:]
bv, ac = j["bufferViews"], j["accessors"]
def arr(i, n, dt=np.float32):
    a = ac[i]; v = bv[a["bufferView"]]
    return np.frombuffer(b, dt, count=a["count"] * n, offset=v["byteOffset"]).reshape(-1, n)
P = arr(0, 3).astype(float); N = arr(1, 3); C = arr(2, 4)[:, :3]
T = P.reshape(-1, 3, 3); cen = T.mean(1)
col = (C[::3] ** (1 / 2.2))
grey = (np.abs(col - col.mean(1, keepdims=True)).max(1) < 0.06)
# stone: everything low, plus grey facets just above the stone top that are not feet
STONE_TOP = 0.118
import colorsys
hsv = np.array([colorsys.rgb_to_hsv(*c) for c in col])
brown = (hsv[:, 1] > 0.28) & (hsv[:, 2] < 0.5) & (hsv[:, 0] < 0.14)     # tail feathers
behind = cen[:, 2] < np.median(cen[:, 2])                                # tail hangs at the back
keep = (cen[:, 1] > STONE_TOP) | (brown & behind)
keep &= ~((cen[:, 1] < STONE_TOP + 0.02) & grey)
# keep only pieces connected to the bird itself (drops loose stone-shadow facets)
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
idx = np.where(keep)[0]
TK = T[idx]
_, inv = np.unique(np.round(TK.reshape(-1, 3), 5), axis=0, return_inverse=True)
fv = inv.reshape(-1, 3)
nv = fv.max() + 1
e = np.concatenate([fv[:, [0, 1]], fv[:, [1, 2]]])
_, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv)), directed=False)
flab = lab[fv[:, 0]]
good = np.unique(flab[TK.mean(1)[:, 1] > STONE_TOP + 0.03])
keep[:] = False
keep[idx[np.isin(flab, good)]] = True
T = T[keep]; NN = N.reshape(-1, 3, 3)[keep]; CC = C.reshape(-1, 3, 3)[keep]
feet = STONE_TOP - 0.016   # talons rest on the stone top
T[:, :, 1] -= feet
print("body tris", len(T), "height", round(T[:, :, 1].max(), 3), "feet lifted", round(feet, 3))
write_glb("/home/claude/hurr/falcon/falcon_body.glb", T.reshape(-1, 3), NN.reshape(-1, 3), CC.reshape(-1, 3),
          faces=np.arange(len(T) * 3).reshape(-1, 3), name="FalconBody")
Ps = T.reshape(-1, 3); Fs = np.arange(len(Ps)).reshape(-1, 3)
sheet([render(Ps, Fs, CC[:, 0] ** (1 / 2.2), yaw=a, h=500) for a in (0, 90, 180)]).save("/home/claude/hurr/falcon/body_preview.png")
