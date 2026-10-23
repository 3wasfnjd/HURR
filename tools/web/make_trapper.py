"""Procedural faceted trapper (falcon poacher) on the shared skeleton — tools/web/rig.py.

Built in Najd's skeleton units, then scaled x1.08 (a taller man). Thobe to the ankles, leather
belt, shemagh wrapped as a litham that leaves only an eye slit (hides who they are; common for
desert work), sleeves, hands, sandals. Weights are assigned per part as it is built.
Usage: python3 tools/web/make_trapper.py -> web/assets/models/trapper.glb
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from rig import IDX, NAMES, HAND_TIP_Y, joint_pos, limit4, smooth, write_skinned_glb  # noqa: E402

SCALE = 1.08
RNG = np.random.default_rng(7)
J = joint_pos(1.0)

THOBE = np.array([0.43, 0.36, 0.28])     # dusty earth brown
THOBE_DK = np.array([0.30, 0.25, 0.20])
BELT = np.array([0.20, 0.13, 0.08])
SKIN = np.array([0.55, 0.36, 0.25])
SHEMAGH = np.array([0.62, 0.20, 0.17])   # red-and-white checks read as alternating facets
SHEMAGH_W = np.array([0.80, 0.76, 0.70])
SANDAL = np.array([0.24, 0.16, 0.10])

tris, cols, wts = [], [], []


def add(tri_pts, col, weight_fn):
    """tri_pts (N,3,3); col (3,) or (N,3); weight_fn(points (M,3)) -> (M, bones)."""
    tri_pts = np.asarray(tri_pts, float)
    c = np.broadcast_to(np.asarray(col, float), (len(tri_pts), 3))
    jitter = 1 + RNG.uniform(-0.06, 0.06, (len(tri_pts), 1))      # facet-to-facet variation
    tris.append(tri_pts.reshape(-1, 3))
    cols.append(np.repeat(np.clip(c * jitter, 0, 1), 3, axis=0))
    wts.append(weight_fn(tri_pts.reshape(-1, 3)))


def loft(rings, close_bottom=False, close_top=False):
    """rings: list of (K,3) loops, top to bottom. Returns triangles (N,3,3), outward-facing (CCW)."""
    out = []
    for a, b in zip(rings[:-1], rings[1:]):
        k = len(a)
        for i in range(k):
            j = (i + 1) % k
            out.append([a[i], b[i], b[j]])
            out.append([a[i], b[j], a[j]])
    # orient outward: compare the first quad's normal with the direction away from the loop centre
    if out:
        t0 = np.array(out[0])
        nrm = np.cross(t0[1] - t0[0], t0[2] - t0[0])
        if nrm @ (t0.mean(0) - rings[0].mean(0)) < 0:
            out = [[q[0], q[2], q[1]] for q in out]
    if close_top:
        c = rings[0].mean(0)
        k = len(rings[0])
        out += [[c, rings[0][i], rings[0][(i + 1) % k]] for i in range(k)]
    if close_bottom:
        c = rings[-1].mean(0)
        k = len(rings[-1])
        out += [[c, rings[-1][(i + 1) % k], rings[-1][i]] for i in range(k)]
    return np.array(out)


def ring(center, rx, rz, k, phase=0.0, jitter=0.0):
    a = phase + np.arange(k) * 2 * np.pi / k
    r = 1 + RNG.uniform(-jitter, jitter, k)
    return np.stack([center[0] + np.sin(a) * rx * r, np.full(k, center[1]), center[2] + np.cos(a) * rz * r], 1)


def tube(p0, p1, r0, r1, k, n=3):
    """Rings along a segment (for sleeves). Ring plane perpendicular to the segment."""
    d = (p1 - p0) / np.linalg.norm(p1 - p0)
    u = np.cross(d, [0, 0, 1.0])
    if np.linalg.norm(u) < 1e-3:
        u = np.cross(d, [1.0, 0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(d, u)
    rings = []
    for t in np.linspace(0, 1, n):
        c = p0 + (p1 - p0) * t
        r = r0 + (r1 - r0) * t
        a = np.arange(k) * 2 * np.pi / k
        rings.append(c + np.outer(np.cos(a), u) * r + np.outer(np.sin(a), v) * r)
    return rings


def bones(**w):
    def fn(p):
        out = np.zeros((len(p), len(NAMES)))
        for k, v in w.items():
            out[:, IDX[k]] = v
        return out
    return fn


def spine_weights(p, skirt=0.92, hem=0.10):
    y, x = p[:, 1], p[:, 0]
    out = np.zeros((len(p), len(NAMES)))
    hy = [J[k][1] for k in ("hips", "spine", "chest", "neck", "head")]
    b1 = smooth(hy[1] - 0.06, hy[1] + 0.04, y)
    b2 = smooth(hy[2] - 0.05, hy[2] + 0.05, y)
    b3 = smooth(hy[3] - 0.03, hy[3] + 0.03, y)
    b4 = smooth(hy[4] - 0.03, hy[4] + 0.04, y)
    for k, (nm, w) in enumerate(zip(("hips", "spine", "chest", "neck", "head"),
                                    (1 - b1, b1 - b2, b2 - b3, b3 - b4, b4))):
        out[:, IDX[nm]] = np.clip(w, 0, 1)
    k = skirt * np.clip((J["hips"][1] - y) / (J["hips"][1] - hem), 0, 1) * (y < J["hips"][1])
    lr = np.clip(x / 0.12, -1, 1)
    out[:, IDX["thigh_L"]] += k * (0.5 + 0.5 * lr)
    out[:, IDX["thigh_R"]] += k * (0.5 - 0.5 * lr)
    out[:, IDX["hips"]] *= 1 - k
    return out


def arm_weights(sd):
    sh, el = J["upperarm_" + sd], J["forearm_" + sd]

    def fn(p):
        out = np.zeros((len(p), len(NAMES)))
        a = smooth(el[1] - 0.04, el[1] + 0.04, p[:, 1])     # 1 = upper arm
        cap = smooth(sh[1] - 0.08, sh[1] + 0.02, p[:, 1])
        out[:, IDX["upperarm_" + sd]] = a * (1 - cap)
        out[:, IDX["forearm_" + sd]] = 1 - a
        out[:, IDX["chest"]] = a * cap
        return out
    return fn


def build():
    # thobe: shoulders to ankles, flaring at the hem
    prof = [(1.43, 0.13, 0.09), (1.38, 0.205, 0.12), (1.25, 0.195, 0.13), (1.08, 0.175, 0.125),
            (0.95, 0.18, 0.13), (0.80, 0.20, 0.145), (0.55, 0.225, 0.17), (0.30, 0.245, 0.19), (0.10, 0.265, 0.21)]
    rings = [ring((0, y, 0), rx, rz, 14, jitter=0.03 if y < 0.9 else 0.01) for y, rx, rz in prof]
    t = loft(rings)
    shade = np.where(t[:, :, 1].mean(1) < 0.3, 0.85, 1.0)[:, None] * THOBE
    add(t, shade, spine_weights)
    # inner hem (back faces of the skirt opening, so you never see through it from low angles)
    add(loft([rings[-2], rings[-1]])[:, ::-1], THOBE_DK, spine_weights)
    # belt
    b = [ring((0, y, 0), 0.188, 0.138, 14) for y in (0.98, 0.93)]
    add(loft(b), BELT, spine_weights)
    # neck + head (skin), then the shemagh hood with an eye slit, and a tail down the back
    nk = [ring((0, y, -0.01), 0.05, 0.05, 8) for y in (1.47, 1.40)]
    add(loft(nk), SKIN, bones(neck=1.0))
    hc = np.array([0.0, 1.565, 0.0])
    head = []
    for lat0, lat1 in zip(np.linspace(np.pi / 2, -np.pi / 2, 7)[:-1], np.linspace(np.pi / 2, -np.pi / 2, 7)[1:]):
        a0 = ring(hc + [0, np.sin(lat0) * 0.105, 0], np.cos(lat0) * 0.085, np.cos(lat0) * 0.095, 10)
        a1 = ring(hc + [0, np.sin(lat1) * 0.105, 0], np.cos(lat1) * 0.085, np.cos(lat1) * 0.095, 10)
        head.append(loft([a0, a1]))
    head = np.concatenate(head)
    add(head, SKIN, bones(head=1.0))
    hood = []
    for lat0, lat1 in zip(np.linspace(np.pi / 2, -0.75, 8)[:-1], np.linspace(np.pi / 2, -0.75, 8)[1:]):
        a0 = ring(hc + [0, np.sin(lat0) * 0.125, -0.005], np.cos(lat0) * 0.103, np.cos(lat0) * 0.112, 12, jitter=0.04)
        a1 = ring(hc + [0, np.sin(lat1) * 0.125, -0.005], np.cos(lat1) * 0.103, np.cos(lat1) * 0.112, 12, jitter=0.04)
        hood.append(loft([a0, a1]))
    hood = np.concatenate(hood)
    c = hood.mean(1)
    eye = (c[:, 2] > 0.04) & (c[:, 1] > hc[1] - 0.005) & (c[:, 1] < hc[1] + 0.04) & (np.abs(c[:, 0]) < 0.075)
    hood = hood[~eye]
    checks = (RNG.random(len(hood)) < 0.3).astype(float)[:, None]
    add(hood, checks * SHEMAGH_W + (1 - checks) * SHEMAGH, bones(head=1.0))
    tail = [ring((0, y, -0.085 - (1.5 - y) * 0.12), 0.075 - (1.5 - y) * 0.05, 0.025, 6) for y in (1.50, 1.38, 1.26)]
    add(loft(tail), SHEMAGH, lambda p: spine_weights(p) * 0 + bones(neck=0.5, chest=0.5)(p))
    # sleeves + hands
    for sd, sg in (("L", 1), ("R", -1)):
        sh, el, wr = J["upperarm_" + sd], J["forearm_" + sd], J["hand_" + sd]
        sh = sh + [-sg * 0.01, 0.03, 0]
        rs = tube(sh, el, 0.062, 0.058, 8) + tube(el, wr, 0.058, 0.052, 8)[1:]
        add(loft(rs), THOBE, arm_weights(sd))
        tip = wr + np.array([sg * 0.015, HAND_TIP_Y - wr[1], 0.01])
        hr = tube(wr + (wr - el) * 0.02, tip, 0.038, 0.03, 6, 3)
        add(loft(hr, close_bottom=True), SKIN, bones(**{"hand_" + sd: 1.0}))
    # sirwal legs under the thobe (seen when the hem swings) + sandals
    for sd in ("L", "R"):
        th, kn, an = J["thigh_" + sd], J["shin_" + sd], J["foot_" + sd]
        kn_y = kn[1]

        def leg_w(p, sd=sd, kn_y=kn_y):
            out = np.zeros((len(p), len(NAMES)))
            a = smooth(kn_y - 0.05, kn_y + 0.05, p[:, 1])
            out[:, IDX["thigh_" + sd]] = a
            out[:, IDX["shin_" + sd]] = 1 - a
            return out
        rs = tube(th + (kn - th) * 0.35, kn, 0.05, 0.048, 7) + tube(kn, an + [0, 0.02, 0], 0.048, 0.04, 7)[1:]
        add(loft(rs), np.array([0.17, 0.15, 0.13]), leg_w)
    for sd, sg in (("L", 1), ("R", -1)):
        a = J["foot_" + sd]
        fr = [ring((a[0], y, a[2] + 0.06), 0.045, 0.11, 8) for y in (0.07, 0.0)]
        add(loft(fr, close_top=True), SANDAL, bones(**{"foot_" + sd: 1.0}))


def main():
    build()
    pos = np.concatenate(tris) * SCALE
    col = np.concatenate(cols)
    W = np.concatenate(wts)
    joints, weights = limit4(W)
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    out = os.path.join(root, "web/assets/models/trapper.glb")
    size = write_skinned_glb(out, pos, col, joints, weights, scale=SCALE, name="Trapper")
    print(f"trapper.glb {size / 1e3:.0f} KB, {len(pos) // 3} tris, height {pos[:, 1].max():.2f} m")


if __name__ == "__main__":
    main()
