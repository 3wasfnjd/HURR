"""Build the web characters from Najd's scanned mesh + Blender bone-heat weights + CMU mocap.

  najd.glb     Najd, skinned (Blender automatic weights computed on a voxel-remesh proxy and
               transferred back — tools/blender/heat_weights.py), with all animation clips.
  trapper.glb  the same mesh and weights re-dressed as a poacher: earth-coloured thobe, dark vest,
               red-and-white shemagh worn as a litham (face covered below the eyes). The game scales
               it x1.07 and plays Najd's clips on it (same bone names).

python3 tools/web/build_characters.py <clips.json>
"""
import json
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path.insert(0, HERE)
from rig import limit4, read_colored_glb, write_skinned_glb  # noqa: E402


def blender_weights(pos):
    d = np.load(os.path.join(ROOT, "tools/blender/out/weights_proxy.npz"))
    names = list(d["names"])
    from skeleton import NAMES
    assert names == NAMES, "Blender weights were made for another skeleton"
    _, i = cKDTree(d["pos"]).query(pos)
    W = d["w"][i].astype(np.float64)
    bad = W.sum(1) < 1e-6
    if bad.any():                                    # tiny loose pieces: copy the nearest weighted vertex
        good = np.where(~bad)[0]
        _, j = cKDTree(pos[good]).query(pos[bad])
        W[bad] = W[good[j]]
    return W / W.sum(1, keepdims=True), int(bad.sum())


def redress(pos, col):
    """Najd's palette -> the poachers'. Works per triangle so facets stay flat-coloured."""
    c = col.copy()
    lin = c.reshape(-1, 3, 3)[:, 0]                  # facet colour (linear, as stored)
    tri = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, 1), 1 / 2.4) - 0.055)   # judge in sRGB
    cen = pos.reshape(-1, 3, 3).mean(1)
    r, g, b = tri[:, 0], tri[:, 1], tri[:, 2]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    out = tri.copy()
    scarf = (b > r + 0.04) & (cen[:, 1] > 1.2)
    tunic = (r > 0.25) & (r > 1.9 * g) & (cen[:, 1] < 1.42)
    vest = (r > 0.35) & (r < 0.62) & (g > 0.22) & (g < 0.40) & (b < 0.3) & (cen[:, 1] > 0.95) & (cen[:, 1] < 1.42)
    skin = (r > 0.6) & (g > 0.38) & (g < 0.6) & (b > 0.28) & (b < 0.5)
    litham = (r > g) & (r > 0.3) & ~(b > r + 0.04) & (cen[:, 1] > 1.38) & (cen[:, 1] < 1.522) & (np.abs(cen[:, 0]) < 0.115) & (cen[:, 2] > -0.03)
    # shemagh: red cloth with a fine pale check (2 cm cells, one in four pale)
    cell = (np.floor(cen[:, 0] / 0.02) + 2 * np.floor(cen[:, 1] / 0.02) + np.floor(cen[:, 2] / 0.02)) % 4 == 0
    shemagh = np.where(cell[:, None], [0.78, 0.66, 0.60], [0.58, 0.12, 0.10])
    k_s = (lum / max(1e-3, lum[scarf].mean()))[:, None] if scarf.any() else 1
    out[scarf] = np.clip(shemagh[scarf] * np.clip(k_s[scarf], 0.6, 1.4), 0, 1)
    out[litham] = shemagh[litham] * 0.92
    k_t = np.clip(lum / max(1e-3, lum[tunic].mean()), 0.55, 1.5)[:, None]
    out[tunic] = np.clip(np.array([0.44, 0.37, 0.28]) * k_t[tunic], 0, 1)
    k_v = np.clip(lum / max(1e-3, lum[vest].mean()), 0.6, 1.4)[:, None]
    out[vest & ~tunic] = np.clip(np.array([0.20, 0.18, 0.16]) * k_v[vest & ~tunic], 0, 1)
    out = np.where(out <= 0.04045, out / 12.92, np.power((np.clip(out, 0, 1) + 0.055) / 1.055, 2.4))
    out[~(scarf | litham | tunic | vest)] = lin[~(scarf | litham | tunic | vest)]
    return np.repeat(out, 3, axis=0), {k: int(v.sum()) for k, v in
                                      (("scarf", scarf), ("tunic", tunic), ("vest", vest), ("litham", litham))}


def main():
    clips = json.load(open(sys.argv[1]))["clips"]
    pos, col = read_colored_glb(os.path.join(ROOT, "assets/models/nouf_20k.glb"))
    W, patched = blender_weights(pos)
    joints, weights = limit4(W)
    out = os.path.join(ROOT, "web/assets/models")
    n = write_skinned_glb(os.path.join(out, "najd.glb"), pos, col, joints, weights, name="Najd", clips=clips)
    print(f"najd.glb {n / 1e6:.2f} MB, {len(pos) // 3} tris, {len(clips)} clips, {patched} verts patched")
    # the poachers use the 10k-triangle version of the same mesh (two of them on screen at once)
    pos10, col10 = read_colored_glb(os.path.join(ROOT, "assets/models/nouf_10k.glb"))
    W10, _ = blender_weights(pos10)
    j10, w10 = limit4(W10)
    col_t, stats = redress(pos10, col10)
    n = write_skinned_glb(os.path.join(out, "trapper.glb"), pos10, col_t, j10, w10, name="Trapper")
    print(f"trapper.glb {n / 1e6:.2f} MB, recoloured facets {stats}")


if __name__ == "__main__":
    main()
