import sys,json,struct,numpy as np
sys.path.insert(0,'/home/claude/hurr/tools')
from render import render, sheet
src, out = sys.argv[1], sys.argv[2]
d=open(src,'rb').read()
jl,_=struct.unpack('<II',d[12:20]); j=json.loads(d[20:20+jl]); b=d[20+jl+8:]; bv=j['bufferViews']
P=np.frombuffer(b,np.float32,count=j['accessors'][0]['count']*3,offset=bv[0]['byteOffset']).reshape(-1,3).astype(float)
C=np.frombuffer(b,np.float32,count=j['accessors'][2]['count']*4,offset=bv[2]['byteOffset']).reshape(-1,4)[:,:3]**(1/2.2)
fc=C[::3]; T=P.reshape(-1,3,3); sel=T.mean(1)[:,1]>1.36
Ps=T[sel].reshape(-1,3); Fs=np.arange(len(Ps)).reshape(-1,3)
sheet([render(Ps,Fs,fc[sel],yaw=a,h=520) for a in (0,50,180)]).save(out)
