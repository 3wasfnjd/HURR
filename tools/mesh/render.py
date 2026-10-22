"""Tiny numpy z-buffer rasterizer for previewing meshes (orthographic, lambert + ambient)."""
import numpy as np
from PIL import Image


def rot_y(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def render(pos, faces, facecol, yaw=0.0, h=900, flat=True, wire=False, bg=(0.93, 0.92, 0.90)):
    p = pos @ rot_y(yaw).T
    lo, hi = p.min(0), p.max(0)
    scale = (h * 0.92) / (hi[1] - lo[1])
    w = int(h * 0.75)
    cx = (lo[0] + hi[0]) / 2
    sx = (p[:, 0] - cx) * scale + w / 2
    sy = (hi[1] - p[:, 1]) * scale + h * 0.04
    sz = p[:, 2]
    img = np.ones((h, w, 3)) * np.array(bg)
    zb = np.full((h, w), -np.inf)
    tri = p[faces]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    light = np.array([-0.45, 0.55, 0.70]); light /= np.linalg.norm(light)
    shade = 0.35 + 0.65 * np.clip(n @ light, 0, 1)
    shade = np.where(n[:, 2] < 0, 0.35 + 0.65 * np.clip(-(n @ light), 0, 1), shade)
    cols = np.clip(facecol * shade[:, None], 0, 1)
    X, Y, Z = sx[faces], sy[faces], sz[faces]
    for i in range(len(faces)):
        x0, x1 = int(max(np.floor(X[i].min()), 0)), int(min(np.ceil(X[i].max()), w - 1))
        y0, y1 = int(max(np.floor(Y[i].min()), 0)), int(min(np.ceil(Y[i].max()), h - 1))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        ax, ay, bx, by, qx, qy = X[i][0], Y[i][0], X[i][1], Y[i][1], X[i][2], Y[i][2]
        d = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
        if abs(d) < 1e-12:
            continue
        l0 = ((by - qy) * (xs - qx) + (qx - bx) * (ys - qy)) / d
        l1 = ((qy - ay) * (xs - qx) + (ax - qx) * (ys - qy)) / d
        l2 = 1 - l0 - l1
        m = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not m.any():
            continue
        z = l0 * Z[i][0] + l1 * Z[i][1] + l2 * Z[i][2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]
        m &= z > sub
        sub[m] = z[m]
        img[y0:y1 + 1, x0:x1 + 1][m] = cols[i]
        if wire:
            e = m & ((l0 < 0.06) | (l1 < 0.06) | (l2 < 0.06))
            img[y0:y1 + 1, x0:x1 + 1][e] *= 0.55
    return Image.fromarray((img * 255).astype(np.uint8))


def sheet(images, gap=10, bg=(237, 235, 230)):
    w = sum(i.width for i in images) + gap * (len(images) - 1)
    h = max(i.height for i in images)
    out = Image.new("RGB", (w, h), bg)
    x = 0
    for i in images:
        out.paste(i, (x, 0)); x += i.width + gap
    return out
