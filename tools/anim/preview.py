"""Stick-figure contact sheet of retargeted clips (front + side), for checking timing and poses.
python3 tools/anim/preview.py clips.json out.png [clip ...]"""
import json
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "web"))
from skeleton import SKELETON, NAMES, TIPS  # noqa: E402


def qm(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def pose(clip, f):
    rest = {n: np.array(p) for n, (_, p) in SKELETON.items()}
    G, P = {}, {}
    for n in NAMES:
        par = SKELETON[n][0]
        L = qm(clip["tracks"][n][f])
        if par is None:
            G[n], P[n] = L, np.array(clip["root"][f])
        else:
            G[n] = G[par] @ L
            P[n] = P[par] + G[par] @ (rest[n] - rest[par])
    for n, t in TIPS.items():
        P[n + "_tip"] = P[n] + G[n] @ (np.array(t) - rest[n])
    return P


def segs(P):
    out = []
    for n in NAMES:
        par = SKELETON[n][0]
        if par:
            out.append((P[par], P[n], n))
    for n in TIPS:
        out.append((P[n], P[n + "_tip"], n))
    return out


def main():
    data = json.load(open(sys.argv[1]))["clips"]
    names = sys.argv[3:] or list(data)
    cols = 8
    fig, axes = plt.subplots(len(names) * 2, cols, figsize=(cols * 1.6, len(names) * 2 * 2.0))
    for r, name in enumerate(names):
        clip = data[name]
        nf = len(clip["root"])
        for c in range(cols):
            f = int(c * (nf - 1) / (cols - 1))
            P = pose(clip, f)
            for k, (axis, view) in enumerate(((0, "front"), (2, "side"))):
                ax = axes[r * 2 + k, c]
                for a, b, n in segs(P):
                    colr = "tab:red" if n.endswith("_L") else ("tab:blue" if n.endswith("_R") else "k")
                    ax.plot([a[axis], b[axis]], [a[1], b[1]], color=colr, lw=1.6)
                ax.set_xlim(-1, 1); ax.set_ylim(-0.1, 1.9); ax.set_aspect("equal"); ax.axis("off")
                if c == 0:
                    ax.set_title(f"{name} {view}", fontsize=7, loc="left")
                else:
                    ax.set_title(f"{f / clip['fps']:.1f}s", fontsize=6)
    plt.tight_layout()
    plt.savefig(sys.argv[2], dpi=70)


if __name__ == "__main__":
    main()
