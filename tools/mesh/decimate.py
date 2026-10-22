"""Quadric-error edge-collapse decimation (Garland & Heckbert 1997), numpy + heapq.

Candidate positions are restricted to the two endpoints and the midpoint, which
keeps planar facets crisp (suits the faceted "Naqsh" style) and is numerically stable.
An extra colour term discourages collapsing across colour borders (eyes, trims, glove).
"""
import heapq

import numpy as np


def weld(pos, faces, decimals=6):
    _, first, inv = np.unique(np.round(pos, decimals), axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    f = inv[faces]
    keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 2] != f[:, 0])
    return pos[first], f[keep], first


def decimate(V, F, target, vcol=None, color_w=0.0, vweight=None, flip_dot=0.2, log=None):
    V = V.copy()
    n = len(V)
    faces = [list(t) for t in F]
    alive = [True] * len(faces)
    vfaces = [set() for _ in range(n)]
    for i, (a, b, c) in enumerate(faces):
        vfaces[a].add(i); vfaces[b].add(i); vfaces[c].add(i)

    tri = V[F]
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = np.linalg.norm(nrm, axis=1)
    nn = nrm / (area[:, None] + 1e-20)
    d = -np.einsum("ij,ij->i", nn, tri[:, 0])
    planes = np.concatenate([nn, d[:, None]], 1)
    Kp = np.einsum("fi,fj->fij", planes, planes) * area[:, None, None]
    Q = np.zeros((n, 4, 4))
    for k in range(3):
        np.add.at(Q, F[:, k], Kp)
    vw = np.ones(n) if vweight is None else vweight
    col = np.zeros((n, 3)) if vcol is None else vcol
    ver = [0] * n
    valive = [True] * n

    def cost(a, b):
        Qs = Q[a] + Q[b]
        best = None
        for p in (V[a], V[b], 0.5 * (V[a] + V[b])):
            h = np.append(p, 1.0)
            e = float(h @ Qs @ h)
            if best is None or e < best[0]:
                best = (e, p)
        e, p = best
        L2 = float(np.sum((V[a] - V[b]) ** 2))
        e += color_w * float(np.sum((col[a] - col[b]) ** 2)) * L2 * L2
        e *= 0.5 * (vw[a] + vw[b])
        return max(e, 0.0), p

    heap = []

    def push(a, b):
        if a > b:
            a, b = b, a
        e, p = cost(a, b)
        heapq.heappush(heap, (e, a, b, ver[a], ver[b], tuple(p)))

    edges = set()
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            edges.add((min(u, v), max(u, v)))
    for a, b in edges:
        push(a, b)

    nf = len(faces)
    while nf > target and heap:
        e, a, b, va, vb, p = heapq.heappop(heap)
        if not (valive[a] and valive[b]) or ver[a] != va or ver[b] != vb:
            continue
        shared = vfaces[a] & vfaces[b]
        if not shared:
            continue
        na = {x for fi in vfaces[a] for x in faces[fi]} - {a}
        nb = {x for fi in vfaces[b] for x in faces[fi]} - {b}
        if len(na & nb) > 2:          # link condition: keep the surface manifold
            ver[a] += 1; ver[b] += 1
            continue
        p = np.array(p)
        ok = True
        for fi in (vfaces[a] | vfaces[b]) - shared:
            t = faces[fi]
            P0 = V[t]
            n0 = np.cross(P0[1] - P0[0], P0[2] - P0[0])
            P1 = P0.copy()
            for k in range(3):
                if t[k] in (a, b):
                    P1[k] = p
            n1 = np.cross(P1[1] - P1[0], P1[2] - P1[0])
            l0, l1 = np.linalg.norm(n0), np.linalg.norm(n1)
            if l1 < 1e-14 or (l0 > 1e-14 and float(n0 @ n1) / (l0 * l1) < flip_dot):
                ok = False
                break
        if not ok:
            continue
        V[a] = p
        Q[a] += Q[b]
        col[a] = 0.5 * (col[a] + col[b])
        vw[a] = max(vw[a], vw[b])
        for fi in shared:
            alive[fi] = False
            for x in faces[fi]:
                vfaces[x].discard(fi)
            nf -= 1
        for fi in list(vfaces[b]):
            faces[fi] = [a if x == b else x for x in faces[fi]]
            vfaces[a].add(fi)
        vfaces[b].clear()
        valive[b] = False
        ver[a] += 1
        for x in {x for fi in vfaces[a] for x in faces[fi]} - {a}:
            push(a, x)
        if log and nf % 10000 < 2:
            log(nf)

    Fo = np.array([faces[i] for i in range(len(faces)) if alive[i]], dtype=np.int64)
    used = np.unique(Fo)
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return V[used], remap[Fo]
