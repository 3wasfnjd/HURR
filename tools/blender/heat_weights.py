"""Run inside Blender (background): compute skin weights for Najd with Blender's bone-heat
("Automatic Weights") two ways, and save them per welded vertex for comparison:
  A) directly on the scanned mesh
  B) on a watertight voxel-remesh proxy, then transferred back (nearest face, interpolated)
blender -b -P tools/blender/heat_weights.py -- <in.glb> <out_dir>
Coordinates in the output are glTF (Y-up), same as tools/web/skeleton.py."""
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
os.makedirs(out, exist_ok=True)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web"))
from skeleton import SKELETON, NAMES, TIPS  # noqa: E402

CHAIN = {"hips": "spine", "spine": "chest", "chest": "neck", "neck": "head", "clavicle_L": "upperarm_L",
         "upperarm_L": "forearm_L", "forearm_L": "hand_L", "clavicle_R": "upperarm_R", "upperarm_R": "forearm_R",
         "forearm_R": "hand_R", "thigh_L": "shin_L", "shin_L": "foot_L", "foot_L": "toe_L",
         "thigh_R": "shin_R", "shin_R": "foot_R", "foot_R": "toe_R"}


def b(p):          # glTF (x, y, z) -> Blender (x, -z, y)
    return Vector((p[0], -p[2], p[1]))


def g(v):          # Blender -> glTF
    return (v[0], v[2], -v[1])


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.00005)
bpy.ops.object.mode_set(mode="OBJECT")
print("body verts", len(body.data.vertices), "faces", len(body.data.polygons))


def make_armature():
    arm_data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for n in NAMES:
        bone = arm_data.edit_bones.new(n)
        bone.head = b(SKELETON[n][1])
        tail = SKELETON[CHAIN[n]][1] if n in CHAIN else TIPS[n]
        bone.tail = b(tail)
        eb[n] = bone
    for n in NAMES:
        p = SKELETON[n][0]
        if p:
            eb[n].parent = eb[p]
            eb[n].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def auto_weights(mesh, arm):
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def dump(mesh, path):
    vg = {v.index: v.name for v in mesh.vertex_groups}
    pos, W = [], np.zeros((len(mesh.data.vertices), len(NAMES)), np.float32)
    for v in mesh.data.vertices:
        pos.append(g(mesh.matrix_world @ v.co))
        for ge in v.groups:
            n = vg[ge.group]
            if n in NAMES:
                W[v.index, NAMES.index(n)] = ge.weight
    pos = np.array(pos, np.float32)
    empty = int((W.sum(1) < 1e-6).sum())
    np.savez_compressed(path, pos=pos, w=W, names=np.array(NAMES))
    print(os.path.basename(path), "verts", len(pos), "unweighted", empty)
    return empty


# A) direct
arm = make_armature()
auto_weights(body, arm)
dump(body, os.path.join(out, "weights_direct.npz"))

# B) voxel proxy -> transfer
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.duplicate()
proxy = bpy.context.view_layer.objects.active
proxy.parent = None
for m in list(proxy.modifiers):
    proxy.modifiers.remove(m)
proxy.vertex_groups.clear()
rm = proxy.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = 0.009
bpy.ops.object.modifier_apply(modifier="remesh")
print("proxy verts", len(proxy.data.vertices))
arm2 = make_armature()
auto_weights(proxy, arm2)
dump(proxy, os.path.join(out, "weights_proxy_self.npz"))

for m in list(body.modifiers):
    body.modifiers.remove(m)
body.vertex_groups.clear()
for n in NAMES:
    body.vertex_groups.new(name=n)
dt = body.modifiers.new("dt", "DATA_TRANSFER")
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier="dt")
dump(body, os.path.join(out, "weights_proxy.npz"))
json.dump({"blender": bpy.app.version_string}, open(os.path.join(out, "blender.json"), "w"))
