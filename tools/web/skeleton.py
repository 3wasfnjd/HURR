"""HURR humanoid skeleton v2 (21 bones) — single source of truth for Blender rigging,
mocap retargeting and the web game. Rest = Najd's A-pose, facing +Z, feet at y=0, metres.
'L' is the character's left (+X)."""
SKELETON = {
    "hips":       (None,         (0.0, 0.90, 0.0)),
    "spine":      ("hips",       (0.0, 1.06, -0.01)),
    "chest":      ("spine",      (0.0, 1.24, -0.01)),
    "neck":       ("chest",      (0.0, 1.41, -0.01)),
    "head":       ("neck",       (0.0, 1.50, 0.0)),
    "clavicle_L": ("chest",      (0.035, 1.37, -0.02)),
    "upperarm_L": ("clavicle_L", (0.19, 1.32, -0.02)),
    "forearm_L":  ("upperarm_L", (0.285, 1.02, -0.05)),
    "hand_L":     ("forearm_L",  (0.34, 0.80, 0.03)),
    "clavicle_R": ("chest",      (-0.035, 1.37, -0.02)),
    "upperarm_R": ("clavicle_R", (-0.19, 1.32, -0.02)),
    "forearm_R":  ("upperarm_R", (-0.285, 1.02, -0.05)),
    "hand_R":     ("forearm_R",  (-0.34, 0.80, 0.03)),
    "thigh_L":    ("hips",       (0.11, 0.88, 0.0)),
    "shin_L":     ("thigh_L",    (0.14, 0.48, 0.0)),
    "foot_L":     ("shin_L",     (0.17, 0.10, -0.04)),
    "toe_L":      ("foot_L",     (0.17, 0.025, 0.10)),
    "thigh_R":    ("hips",       (-0.11, 0.88, 0.0)),
    "shin_R":     ("thigh_R",    (-0.14, 0.48, 0.0)),
    "foot_R":     ("shin_R",     (-0.17, 0.10, -0.04)),
    "toe_R":      ("foot_R",     (-0.17, 0.025, 0.10)),
}
NAMES = list(SKELETON)
# end points of bones without a chain child (bone tails)
TIPS = {
    "head": (0.0, 1.66, 0.0),
    "hand_L": (0.355, 0.64, 0.04), "hand_R": (-0.355, 0.64, 0.04),
    "toe_L": (0.17, 0.0, 0.18), "toe_R": (-0.17, 0.0, 0.18),
}
