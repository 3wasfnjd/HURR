import sys, numpy as np, time
sys.path.insert(0, '/home/claude/hurr/tools')
from glbio import read_glb
from render import render, sheet
m = read_glb('/home/claude/hurr/nouf_raw.glb')
pos, f, uv, tex = m['pos'], m['faces'], m['uv'], m['tex']
print('verts', len(pos), 'tris', len(f), 'tex', tex.shape)
# topology
e = np.sort(np.concatenate([f[:, [0,1]], f[:, [1,2]], f[:, [2,0]]]), axis=1)
u, c = np.unique(e, axis=0, return_counts=True)
print('edges', len(u), 'boundary', (c==1).sum(), 'nonmanifold', (c>2).sum())
# welded by position
_, inv = np.unique(np.round(pos, 6), axis=0, return_inverse=True)
fw = inv.reshape(-1)[f]
e = np.sort(np.concatenate([fw[:, [0,1]], fw[:, [1,2]], fw[:, [2,0]]]), axis=1)
u, c = np.unique(e, axis=0, return_counts=True)
print('welded verts', inv.max()+1, 'boundary', (c==1).sum(), 'nonmanifold', (c>2).sum())
# face colours from texture at centroid uv
cu = uv[f].mean(1)
H, W = tex.shape[:2]
px = np.clip((cu[:,0]*(W-1)).astype(int), 0, W-1); py = np.clip(((1-cu[:,1])*(H-1)).astype(int), 0, H-1)
fc = tex[py, px]
t=time.time()
imgs = [render(pos, f, fc, yaw=a, h=700) for a in (0, 90, 180)]
sheet(imgs).save('/home/claude/hurr/preview_raw.png'); print('render', time.time()-t)
