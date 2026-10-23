"""Auto-rig Najd's faceted mesh onto the shared skeleton (tools/web/rig.py).

Region rules instead of heat diffusion: the mesh is a single fused surface (robe, arms resting
on the vest, bag at the hip), so pure distance weights would glue the hands to the robe.
  * below the robe hem  -> legs (thigh/shin/foot by height, blended at the knee and ankle)
  * near the arm chain and outside the torso gap -> arm (upper/fore/hand, chest at the shoulder)
  * everything else     -> spine chain by height; the robe skirt also follows the thighs a little
Usage: python3 tools/web/rig_najd.py  (reads assets/models/nouf_20k.glb, writes web/assets/models/najd.glb)
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rig import IDX, NAMES, HAND_TIP_Y, joint_pos, limit4, read_colored_glb, seg_dist, smooth, write_skinned_glb  # noqa: E402

HEM = 0.56          # bottom of the robe
GAP_X = 0.205       # the robe/vest never reaches past this |x| below the elbow


def geodesic_arm_mask(pos, scale=1.0):
    """Surface (geodesic) test: a vertex belongs to an arm only if it is closer, walking over the
    mesh, to that hand than to the torso. Euclidean distance alone glues the vest to the sleeve."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    J = joint_pos(scale)
    key = np.round(pos * 1e5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    nu = inv.max() + 1
    up = np.zeros((nu, 3))
    up[inv] = pos
    f = inv.reshape(-1, 3)
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    ln = np.linalg.norm(up[e[:, 0]] - up[e[:, 1]], axis=1) + 1e-6
    g = coo_matrix((ln, (e[:, 0], e[:, 1])), shape=(nu, nu)).tocsr()
    torso_seed = np.where((np.abs(up[:, 0]) < 0.07 * scale) & (up[:, 1] > 0.95 * scale) & (up[:, 1] < 1.3 * scale))[0]
    dT = dijkstra(g, directed=False, indices=torso_seed, min_only=True)
    masks = {}
    for sd in ("L", "R"):
        wr = J["hand_" + sd]
        seed = np.where((np.linalg.norm(up - wr, axis=1) < 0.06 * scale) & (up[:, 1] < wr[1]))[0]
        dH = dijkstra(g, directed=False, indices=seed, min_only=True)
        masks[sd] = (dH < dT)[inv]
    return masks


def weights_for(pos, scale=1.0, hem=HEM, gap_x=GAP_X, skirt=0.55, geodesic=True):
    J = joint_pos(scale)
    n = len(pos)
    W = np.zeros((n, len(NAMES)))
    x, y = pos[:, 0], pos[:, 1]
    s = np.where(x >= 0, 1, -1)
    side = np.where(s > 0, "L", "R")

    # --- spine chain by height (base for torso, robe, head) ---
    hy = [J[k][1] for k in ("hips", "spine", "chest", "neck", "head")]
    b1 = smooth(hy[1] - 0.06, hy[1] + 0.04, y)
    b2 = smooth(hy[2] - 0.05, hy[2] + 0.05, y)
    b3 = smooth(hy[3] - 0.03, hy[3] + 0.03, y)
    b4 = smooth(hy[4] - 0.03, hy[4] + 0.04, y)
    torso = np.stack([1 - b1, b1 - b2, b2 - b3, b3 - b4, b4], 1)
    torso = np.clip(torso, 0, 1)
    for k, nm in enumerate(("hips", "spine", "chest", "neck", "head")):
        W[:, IDX[nm]] = torso[:, k]

    # --- robe skirt follows each thigh partly (cloth swing, no tearing between the legs) ---
    k = skirt * np.clip((J["hips"][1] - y) / (J["hips"][1] - hem), 0, 1)
    k *= (y < J["hips"][1]) & (y >= hem)
    lr = np.clip(x / (0.12 * scale), -1, 1)
    W[:, IDX["thigh_L"]] += k * (0.5 + 0.5 * lr)
    W[:, IDX["thigh_R"]] += k * (0.5 - 0.5 * lr)
    W[:, IDX["hips"]] *= 1 - k

    # --- legs below the hem ---
    legs = y < hem
    for sd in ("L", "R"):
        m = legs & (side == sd)
        yy = y[m]
        knee, ankle = J["shin_" + sd][1], J["foot_" + sd][1]
        a = smooth(knee - 0.05, knee + 0.05, yy)            # 1 = thigh
        b = smooth(ankle - 0.03, ankle + 0.05, yy)          # 1 = shin (vs foot)
        rows = np.zeros((m.sum(), len(NAMES)))
        rows[:, IDX["thigh_" + sd]] = a
        rows[:, IDX["shin_" + sd]] = (1 - a) * b
        rows[:, IDX["foot_" + sd]] = (1 - a) * (1 - b)
        W[m] = rows

    # --- arms ---
    gmask = geodesic_arm_mask(pos, scale) if geodesic else None
    for sd, sg in (("L", 1), ("R", -1)):
        sh, el, wr = J["upperarm_" + sd], J["forearm_" + sd], J["hand_" + sd]
        tip = wr + np.array([sg * 0.015, HAND_TIP_Y * scale - wr[1], 0.01])
        d1, _ = seg_dist(pos, sh, el)
        d2, _ = seg_dist(pos, el, wr)
        d3, _ = seg_dist(pos, wr, tip)
        dmin = np.minimum(np.minimum(d1, d2), d3)
        below_elbow = y < el[1]
        m = (sg * x > gap_x * scale) & (dmin < 0.085 * scale) & (y < sh[1] + 0.05 * scale)
        m &= below_elbow | (dmin < 0.065 * scale)           # upper arm hugs the vest: stay tight
        if gmask is not None:
            m &= gmask[sd]
        inv = 1 / np.maximum(np.stack([d1, d2, d3], 1)[m], 0.01) ** 4
        inv /= inv.sum(1, keepdims=True)
        rows = np.zeros((m.sum(), len(NAMES)))
        rows[:, IDX["upperarm_" + sd]] = inv[:, 0]
        rows[:, IDX["forearm_" + sd]] = inv[:, 1]
        rows[:, IDX["hand_" + sd]] = inv[:, 2]
        cb = smooth(sh[1] - 0.10 * scale, sh[1] + 0.02 * scale, y[m])   # shoulder cap blends to chest
        rows *= (1 - cb)[:, None]
        rows[:, IDX["chest"]] += cb
        W[m] = rows
    return W


def main():
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    pos, col = read_colored_glb(os.path.join(root, "assets/models/nouf_20k.glb"))
    W = weights_for(pos)
    # welded vertices (same position on neighbouring facets) must share weights or the mesh cracks
    key = np.round(pos * 1e5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    acc = np.zeros((inv.max() + 1, W.shape[1]))
    np.add.at(acc, inv, W)
    cnt = np.bincount(inv)[:, None]
    W = acc[inv] / cnt[inv]
    joints, weights = limit4(W)
    out = os.path.join(root, "web/assets/models/najd.glb")
    size = write_skinned_glb(out, pos, col, joints, weights, name="Najd")
    used = sorted({NAMES[j] for j in np.unique(joints[weights.max(1) > 0])})
    print(f"najd.glb {size / 1e6:.2f} MB, {len(pos) // 3} tris, bones used: {len(used)}/{len(NAMES)}")


if __name__ == "__main__":
    main()
