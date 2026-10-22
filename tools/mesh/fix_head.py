"""Remove the iqal-like ring from Nouf's head and recolour the headscarf to the approved indigo.

Geometry: vertices in the ring band are pulled radially onto a smooth profile interpolated
(per angle) between the scarf just below the ring and the cap just above it. Position-only,
so duplicated seam vertices stay welded.
Colour: dark ring colours in the band become indigo; violet/purple hues in the head and
shoulder area are rotated to indigo, keeping their light and shade.
"""
import colorsys

import numpy as np

# The ring is tilted: centre ~1.568 m at the front (+z), ~1.525 m at the back (measured).
RING_A, RING_B, HALF = 1.5465, 0.0215, 0.045
NBINS = 36
INDIGO_H = 228 / 360.0
_C = None


def _centre(pos):
    head = pos[:, 1] > 1.40
    return np.array([pos[head, 0].mean(), pos[head, 2].mean()])


def ring_offset(P, c):
    ang = np.arctan2(P[:, 2] - c[1], P[:, 0] - c[0])
    return P[:, 1] - (RING_A + RING_B * np.sin(ang)), ang


def flatten_ring(pos):
    global _C
    pos = pos.copy()
    c = _centre(pos); _C = c
    r = np.hypot(pos[:, 0] - c[0], pos[:, 2] - c[1])
    off, ang = ring_offset(pos, c)
    bins = ((ang + np.pi) / (2 * np.pi) * NBINS).astype(int) % NBINS
    near = pos[:, 1] > 1.38

    def prof(lo, hi):
        out = np.full(NBINS, np.nan)
        s = near & (off >= lo) & (off < hi)
        for b in range(NBINS):
            rb = r[s & (bins == b)]
            if len(rb):
                out[b] = np.percentile(rb, 90)
        good = ~np.isnan(out); idx = np.arange(NBINS)
        out[~good] = np.interp(idx[~good], idx[good], out[good], period=NBINS)
        return out

    rb, ra = prof(-HALF - 0.015, -HALF), prof(HALF, HALF + 0.015)
    s = near & (np.abs(off) < HALF)
    t = np.clip((off[s] + HALF) / (2 * HALF), 0, 1)
    tgt = (1 - t) * rb[bins[s]] + t * ra[bins[s]] + 0.003
    rs = r[s]
    k = np.minimum(rs, tgt) / np.maximum(rs, 1e-9)
    pos[s, 0] = c[0] + (pos[s, 0] - c[0]) * k
    pos[s, 2] = c[1] + (pos[s, 2] - c[1]) * k
    return pos, int(s.sum()), int((rs > tgt).sum())


def recolor(P, C):
    """P: sample positions (after flatten), C: sRGB colours 0..1."""
    C = C.copy()
    off, _ = ring_offset(P, _C)
    band = (P[:, 1] > 1.38) & (np.abs(off) < HALF + 0.006)
    upper = P[:, 1] > 1.22
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in C])
    h, s, v = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    violet = upper & (h > 0.66) & (h < 0.95) & (s > 0.12)
    crown = (P[:, 1] > 1.56) & (h > 0.05) & (h < 0.25) & (v < 0.5)
    ring = ((band & (v < 0.42) & (s < 0.55)) | crown) & ~violet
    for i in np.where(violet)[0]:
        C[i] = colorsys.hsv_to_rgb(INDIGO_H, min(s[i] * 1.05, 0.7), min(v[i] * 1.25, 0.8))
    for i in np.where(ring)[0]:
        C[i] = colorsys.hsv_to_rgb(INDIGO_H, 0.45, 0.24 + 0.6 * v[i])
    return C, int(violet.sum()), int(ring.sum())
