"""Retarget CMU motion-capture BVH clips onto the HURR humanoid skeleton (numpy only).

Source: CMU Graphics Lab Motion Capture Database, BVH conversion by B. Hahne
("free for use in research and commercial projects worldwide"; frame 1 of every file is a
T-pose facing +Z). The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

Method (world-space delta from the T-pose, per bone):
    G_tgt(t) = G_src(t) . G_src(T)^-1 . G_tgt(T)
G_tgt(T) is the rotation that takes the target bone from its rest pose (an A-pose) to the
direction the matching source bone has in the source T-pose. Target rest rotations are
identity, so the glTF local rotation is L = G_parent^-1 . G.

Usage: python3 tools/anim/retarget.py <cmu-bvh-root> <out.json>
"""
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "web"))
from skeleton import SKELETON, NAMES, TIPS  # noqa: E402

# target bone -> (source joint, source child used for the bone direction)
MAP = {
    "hips": ("Hips", "Spine"), "spine": ("Spine", "Spine1"), "chest": ("Spine1", "Neck1"),
    "neck": ("Neck", "Head"), "head": ("Head", "@end"),
    "clavicle_L": ("LeftShoulder", "LeftArm"), "upperarm_L": ("LeftArm", "LeftForeArm"),
    "forearm_L": ("LeftForeArm", "LeftHand"), "hand_L": ("LeftHand", "LeftHandIndex1"),
    "clavicle_R": ("RightShoulder", "RightArm"), "upperarm_R": ("RightArm", "RightForeArm"),
    "forearm_R": ("RightForeArm", "RightHand"), "hand_R": ("RightHand", "RightHandIndex1"),
    "thigh_L": ("LeftUpLeg", "LeftLeg"), "shin_L": ("LeftLeg", "LeftFoot"),
    "foot_L": ("LeftFoot", "LeftToeBase"), "toe_L": ("LeftToeBase", "@end"),
    "thigh_R": ("RightUpLeg", "RightLeg"), "shin_R": ("RightLeg", "RightFoot"),
    "foot_R": ("RightFoot", "RightToeBase"), "toe_R": ("RightToeBase", "@end"),
}

# clip name -> (file, start s, end s, mode). Times are in seconds of the source file
# (frame 0 = T-pose is always skipped). mode: loop | once | hold
CLIPS = {
    "idle":      ("082/82_08.bvh", 0.5, 3.5, "loop"),
    "walk":      ("007/07_01.bvh", 0.6, None, "cycle"),
    "run":       ("009/09_01.bvh", 0.2, None, "cycle"),
    "climb":     ("015/15_02.bvh", None, None, "once"),
    "kneel":     ("069/69_70.bvh", None, None, "hold"),
    "wave":      ("013/13_26.bvh", None, None, "once"),
    "stumble":   ("022/22_12.bvh", None, None, "once"),
    "duck":      ("077/77_09.bvh", None, None, "once"),
    "angry":     ("018/18_10.bvh", None, None, "loop"),
    "sneak":     ("120/120_08.bvh", None, None, "cycle"),
}


# ------------------------------------------------------------------ BVH
class Bvh:
    def __init__(self, path):
        txt = open(path).read()
        head, motion = txt.split("MOTION")
        self.joints, self.parent, self.offset, self.channels, self.end = [], {}, {}, {}, {}
        stack, last = [], None
        toks = re.findall(r"[^\s{}]+|[{}]", head)
        i = 0
        while i < len(toks):
            t = toks[i]
            if t in ("ROOT", "JOINT"):
                name = toks[i + 1]
                self.joints.append(name)
                self.parent[name] = stack[-1] if stack else None
                last = name
                i += 2
            elif t == "End":
                last = "@end:" + stack[-1]
                i += 2
            elif t == "{":
                stack.append(last)
                i += 1
            elif t == "}":
                stack.pop()
                i += 1
            elif t == "OFFSET":
                v = np.array([float(x) for x in toks[i + 1:i + 4]])
                if last.startswith("@end:"):
                    self.end[last[5:]] = v
                else:
                    self.offset[last] = v
                i += 4
            elif t == "CHANNELS":
                n = int(toks[i + 1])
                self.channels[last] = toks[i + 2:i + 2 + n]
                i += 2 + n
            else:
                i += 1
        lines = motion.strip().splitlines()
        self.frames = int(lines[0].split(":")[1])
        self.dt = float(lines[1].split(":")[1])
        self.data = np.array([[float(x) for x in ln.split()] for ln in lines[2:2 + self.frames]])

    def fk(self):
        """World rotation (F,3,3) and position (F,3) for every joint."""
        F = self.frames
        R, P, col = {}, {}, 0
        for j in self.joints:
            ch = self.channels[j]
            vals = self.data[:, col:col + len(ch)]
            col += len(ch)
            loc = np.tile(np.eye(3), (F, 1, 1))
            trans = np.zeros((F, 3))
            for k, c in enumerate(ch):
                if c.endswith("position"):
                    trans[:, "XYZ".index(c[0])] = vals[:, k]
                else:
                    loc = loc @ rotm(c[0], np.radians(vals[:, k]))
            p = self.parent[j]
            if p is None:
                R[j] = loc
                P[j] = trans + self.offset[j]
            else:
                R[j] = R[p] @ loc
                P[j] = P[p] + np.einsum("fij,j->fi", R[p], self.offset[j])
        self.R, self.P = R, P
        return R, P

    def child_pos(self, j, child):
        if child == "@end":
            return self.P[j] + np.einsum("fij,j->fi", self.R[j], self.end[j])
        return self.P[child]


def rotm(axis, a):
    c, s = np.cos(a), np.sin(a)
    o, z = np.ones_like(a), np.zeros_like(a)
    if axis == "X":
        m = [[o, z, z], [z, c, -s], [z, s, c]]
    elif axis == "Y":
        m = [[c, z, s], [z, o, z], [-s, z, c]]
    else:
        m = [[c, -s, z], [s, c, z], [z, z, o]]
    return np.moveaxis(np.array(m), [0, 1], [-2, -1])


def from_to(a, b):
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(a @ b)
    if c < -0.9999:
        ax = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        ax /= np.linalg.norm(ax)
        return 2 * np.outer(ax, ax) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def quat(m):
    """(F,3,3) -> (F,4) xyzw, sign-continuous."""
    q = np.zeros((len(m), 4))
    for i, r in enumerate(m):
        t = np.trace(r)
        if t > 0:
            s = 2 * np.sqrt(t + 1)
            q[i] = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
        else:
            k = np.argmax(np.diag(r))
            if k == 0:
                s = 2 * np.sqrt(1 + r[0, 0] - r[1, 1] - r[2, 2])
                q[i] = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
            elif k == 1:
                s = 2 * np.sqrt(1 + r[1, 1] - r[0, 0] - r[2, 2])
                q[i] = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
            else:
                s = 2 * np.sqrt(1 + r[2, 2] - r[0, 0] - r[1, 1])
                q[i] = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
        if i and q[i] @ q[i - 1] < 0:
            q[i] = -q[i]
    return q


# ------------------------------------------------------------------ retarget
def target_rest():
    pos = {n: np.array(p) for n, (_, p) in SKELETON.items()}
    kids = {}
    for n, (par, _) in SKELETON.items():
        if par:
            kids.setdefault(par, []).append(n)
    child_dir = {}
    for n in NAMES:
        tip = TIPS.get(n)
        if tip is not None:
            child_dir[n] = np.array(tip) - pos[n]
        else:
            # first child that is the chain continuation
            c = {"hips": "spine", "spine": "chest", "chest": "neck", "neck": "head", "clavicle_L": "upperarm_L",
                 "clavicle_R": "upperarm_R", "upperarm_L": "forearm_L", "forearm_L": "hand_L", "upperarm_R": "forearm_R",
                 "forearm_R": "hand_R", "thigh_L": "shin_L", "shin_L": "foot_L", "foot_L": "toe_L",
                 "thigh_R": "shin_R", "shin_R": "foot_R", "foot_R": "toe_R"}[n]
            child_dir[n] = pos[c] - pos[n]
    return pos, child_dir


def retarget(bvh, t0=None, t1=None, fps=30):
    R, P = bvh.fk()
    pos, cdir = target_rest()
    # T-pose correction per target bone
    GT = {}
    for n, (sj, sc) in MAP.items():
        d0 = bvh.child_pos(sj, sc)[0] - P[sj][0]
        GT[n] = from_to(cdir[n], d0)
    # time range (frame 0 is the T-pose)
    i0 = max(1, int(round((t0 or 0) / bvh.dt)))
    i1 = bvh.frames if t1 is None else min(bvh.frames, int(round(t1 / bvh.dt)))
    idx = np.arange(i0, i1, max(1, int(round(1 / (fps * bvh.dt)))))
    G = {}
    for n, (sj, _) in MAP.items():
        G[n] = R[sj][idx] @ np.linalg.inv(R[sj][0]) @ GT[n]
    # heading: remove the source's average yaw so every clip faces +Z
    fwd = np.einsum("fij,j->fi", G["hips"], [0, 0, 1.0])
    yaw = np.arctan2(fwd[:, 0], fwd[:, 2])
    y0 = np.arctan2(np.mean(np.sin(yaw)), np.mean(np.cos(yaw)))
    Ry = rotm("Y", np.array([-y0]))[0]
    for n in G:
        G[n] = Ry @ G[n]
    local = {}
    for n in NAMES:
        par = SKELETON[n][0]
        local[n] = G[n] if par is None else np.linalg.inv(G[par]) @ G[n]
    # root height relative to the T-pose, scaled to Najd's hip height
    src_hip = P["Hips"][0][1] - min(P["LeftToeBase"][0][1], P["RightToeBase"][0][1])
    scale = (pos["hips"][1] - 0.03) / src_hip
    root = (P["Hips"][idx] - P["Hips"][0]) * scale
    root = (Ry @ root.T).T
    return local, root, len(idx) / fps


def make_clip(bvh, mode, t0, t1, fps=30):
    local, root, dur = retarget(bvh, t0, t1, fps)
    n = len(root)
    # in place: drop horizontal travel; keep the vertical bob (and crouch depth)
    tr = root.copy()
    tr[:, 0] = 0
    tr[:, 2] = 0
    if mode == "cycle":
        # find the best loop: the frame after >= 0.7 s that best matches frame 0 (joint rotations)
        best, bi = 1e9, n - 1
        for k in range(int(0.7 * fps), n):
            e = sum(np.linalg.norm(local[b][k] - local[b][0]) for b in ("thigh_L", "thigh_R", "shin_L", "shin_R", "upperarm_L", "upperarm_R"))
            if e < best:
                best, bi = e, k
        n = bi
    if mode in ("once", "hold"):
        tr[:, 1] -= tr[0, 1]
    out = {"duration": n / fps, "fps": fps, "mode": mode, "tracks": {}}
    for b in NAMES:
        out["tracks"][b] = np.round(quat(local[b][:n]), 5).tolist()
    out["root"] = np.round(tr[:n] + np.array(SKELETON["hips"][1]), 4).tolist()
    return out


def main():
    src, dst = sys.argv[1], sys.argv[2]
    clips = {}
    for name, (f, t0, t1, mode) in CLIPS.items():
        p = os.path.join(src, f)
        if not os.path.exists(p):
            print("missing", f)
            continue
        clips[name] = make_clip(Bvh(p), mode, t0, t1)
        print(f"{name:8s} {f:16s} {clips[name]['duration']:.2f}s")
    json.dump({"source": "CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH by B. Hahne",
               "clips": clips}, open(dst, "w"))


if __name__ == "__main__":
    main()
