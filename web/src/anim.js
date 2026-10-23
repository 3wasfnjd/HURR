// Procedural animation on the shared skeleton (tools/web/rig.py). Rest pose = A-pose facing +Z,
// bones with identity rest rotations, so a pose is just Euler angles per bone.
// Sign conventions: rotation.x < 0 swings a limb forward (+Z); shin.x > 0 bends the knee;
// upperarm_L.z > 0 / upperarm_R.z < 0 lifts the arm out to the side.
import { clamp, lerp } from './rand.js';

const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R',
  'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];

export class Rig {
  constructor(root) {
    this.root = root;
    this.bones = {};
    for (const n of BONES) {
      const b = root.getObjectByName(n);
      if (!b) throw new Error(`bone missing: ${n}`);
      this.bones[n] = b;
      b.rotation.order = 'ZXY';
    }
    this.hipsRest = this.bones.hips.position.y;
    this.cur = {};
    for (const n of BONES) this.cur[n] = [0, 0, 0];
    this.curDrop = 0;
  }
  // pose: { bone: [x, y, z] }, drop: metres to lower the hips; sharp: blend speed (1/s)
  apply(pose, drop, dt, sharp = 14) {
    const k = 1 - Math.exp(-dt * sharp);
    for (const n of BONES) {
      const t = pose[n] || ZERO, c = this.cur[n];
      c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k;
      this.bones[n].rotation.set(c[0], c[1], c[2]);
    }
    this.curDrop += ((drop || 0) - this.curDrop) * k;
    this.bones.hips.position.y = this.hipsRest - this.curDrop;
  }
}
const ZERO = [0, 0, 0];

// ---- building blocks
export function idle(t) {
  const b = Math.sin(t * 1.7);
  return {
    pose: {
      chest: [0.025 * b, 0, 0], head: [0.04, 0.18 * Math.sin(t * 0.37), 0],
      upperarm_L: [0.03 * b, 0, -0.06], upperarm_R: [0.03 * b, 0, 0.06], forearm_L: [-0.12, 0, 0], forearm_R: [-0.12, 0, 0],
    },
    drop: 0.005 * (1 + b),
  };
}

// phase in radians; run 0 = walk, 1 = full run
export function locomotion(phase, run) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const A = lerp(0.42, 0.78, run), K = lerp(0.55, 1.35, run), B = lerp(0.32, 0.75, run);
  const shinL = 0.1 + K * Math.max(0, c), shinR = 0.1 + K * Math.max(0, -c);
  return {
    pose: {
      hips: [0, 0.1 * s, 0], spine: [0.05 + 0.16 * run, -0.08 * s, 0], chest: [0.03, -0.05 * s, 0], head: [-0.05 - 0.12 * run, 0, 0],
      thigh_L: [-A * s - 0.1 * run, 0, 0], thigh_R: [A * s - 0.1 * run, 0, 0],
      shin_L: [shinL, 0, 0], shin_R: [shinR, 0, 0],
      foot_L: [-0.25 * shinL + 0.15 * s, 0, 0], foot_R: [-0.25 * shinR - 0.15 * s, 0, 0],
      upperarm_L: [B * s, 0, -0.1], upperarm_R: [-B * s, 0, 0.1],
      forearm_L: [-lerp(0.25, 1.2, run) - 0.15 * Math.max(0, -s), 0, 0], forearm_R: [-lerp(0.25, 1.2, run) - 0.15 * Math.max(0, s), 0, 0],
    },
    drop: (0.015 + 0.05 * run) * Math.abs(c),
  };
}

export function climb(u) {
  // reach (0-.35), pull (.35-.7), step over (.7-1)
  const reach = clamp(u / 0.35, 0, 1), pull = clamp((u - 0.35) / 0.35, 0, 1), over = clamp((u - 0.7) / 0.3, 0, 1);
  const arm = lerp(lerp(-0.3, -2.5, reach), -0.9, pull) * (1 - over) + over * -0.4;
  const fore = lerp(-0.2, -0.5, reach) * (1 - pull) + pull * -1.4 * (1 - over);
  return {
    pose: {
      spine: [0.3 * pull, 0, 0], chest: [0.15 * reach, 0, 0], head: [-0.4 * reach * (1 - pull), 0, 0],
      upperarm_L: [arm, 0, -0.15], upperarm_R: [arm * 0.95, 0, 0.15], forearm_L: [fore, 0, 0], forearm_R: [fore, 0, 0],
      thigh_L: [lerp(-1.1, -0.2, over) * reach, 0, 0], shin_L: [lerp(1.4, 0.3, over) * reach, 0, 0],
      thigh_R: [lerp(0.2, -1.0, pull) * (1 - over * 0.8), 0, 0], shin_R: [lerp(0.3, 1.5, pull) * (1 - over * 0.8), 0, 0],
    },
    drop: 0,
  };
}

export function kneel(t, k = 1) {
  const work = Math.sin(t * 9) * 0.22;
  return {
    pose: {
      thigh_L: [-0.95 * k, 0, 0], shin_L: [1.35 * k, 0, 0], foot_L: [-0.4 * k, 0, 0],
      thigh_R: [-0.35 * k, 0, 0], shin_R: [1.6 * k, 0, 0], foot_R: [0.2 * k, 0, 0],
      spine: [0.4 * k, 0, 0], chest: [0.2 * k, 0, 0], head: [0.25 * k, 0, 0],
      upperarm_L: [(-1.1 + work) * k, 0, -0.1], forearm_L: [-0.6 * k, 0, 0],
      upperarm_R: [(-1.0 - work) * k, 0, 0.1], forearm_R: [-0.7 * k, 0, 0],
    },
    drop: 0.33 * k,
  };
}

export function airborne() {
  return {
    pose: { upperarm_L: [-0.3, 0, 0.6], upperarm_R: [-0.3, 0, -0.6], thigh_L: [-0.5, 0, 0], shin_L: [0.7, 0, 0], thigh_R: [-0.1, 0, 0], shin_R: [0.4, 0, 0] },
    drop: 0,
  };
}

export function cower() {
  return {
    pose: { spine: [0.45, 0, 0], chest: [0.2, 0, 0], head: [0.3, 0, 0], upperarm_L: [-1.9, 0, -0.2], forearm_L: [-1.7, 0, 0],
      upperarm_R: [-1.9, 0, 0.2], forearm_R: [-1.7, 0, 0], thigh_L: [-0.5, 0, 0], shin_L: [0.8, 0, 0], thigh_R: [-0.3, 0, 0], shin_R: [0.6, 0, 0] },
    drop: 0.12,
  };
}

// Najd raises the gloved left fist: the call for the falcon (layered on top of anything)
export function layerCall(pose, k) {
  if (k <= 0) return pose;
  const p = { ...pose };
  const base = p.upperarm_L || ZERO;
  p.upperarm_L = [lerp(base[0], -2.2, k), 0, lerp(base[2], 0.15, k)];
  p.forearm_L = [lerp((p.forearm_L || ZERO)[0], -0.5, k), 0, 0];
  p.head = [lerp((p.head || ZERO)[0], -0.35, k), 0, 0];
  return p;
}

// ---- the men
export function blockArms(t) {
  const s = 0.08 * Math.sin(t * 3);
  return {
    pose: { spine: [0.15, 0, 0], upperarm_L: [-0.5, 0, 1.0 + s], forearm_L: [-0.6, 0, 0], upperarm_R: [-0.5, 0, -1.0 - s], forearm_R: [-0.6, 0, 0],
      thigh_L: [-0.25, 0, 0.1], shin_L: [0.4, 0, 0], thigh_R: [-0.25, 0, -0.1], shin_R: [0.4, 0, 0] },
    drop: 0.08,
  };
}

export function stunned(age) {
  if (age < 0.9) {      // reeling back, arms over the face
    const w = Math.sin(age * 18) * 0.3;
    return { pose: { spine: [-0.3, 0.2 * w, 0], head: [-0.4, 0, 0], upperarm_L: [-2.3 + w, 0, 0.3], forearm_L: [-1.6, 0, 0],
      upperarm_R: [-2.2 - w, 0, -0.3], forearm_R: [-1.6, 0, 0] }, drop: 0 };
  }
  return { pose: { thigh_L: [-1.2, 0, 0], shin_L: [1.9, 0, 0], thigh_R: [-0.4, 0, 0], shin_R: [1.8, 0, 0],
    spine: [0.55, 0, 0], head: [0.4, 0, 0], upperarm_L: [-2.0, 0, 0.1], forearm_L: [-1.9, 0, 0], upperarm_R: [-2.0, 0, -0.1], forearm_R: [-1.9, 0, 0] }, drop: 0.42 };
}

export function shakeFist(t) {
  const s = Math.sin(t * 11) * 0.25;
  return { pose: { spine: [-0.08, 0, 0], head: [-0.25, 0, 0], upperarm_R: [-2.6 + s, 0, -0.1], forearm_R: [-0.9 + s, 0, 0],
    upperarm_L: [0.1, 0, -0.1], forearm_L: [-0.4, 0, 0] }, drop: 0 };
}

export function crouchHide(t) {
  return { pose: { thigh_L: [-0.6, 0, 0], shin_L: [1.0, 0, 0], thigh_R: [-0.6, 0, 0], shin_R: [1.0, 0, 0], foot_L: [-0.3, 0, 0], foot_R: [-0.3, 0, 0],
    spine: [0.35, 0, 0], head: [-0.2, 0.15 * Math.sin(t * 0.8), 0], upperarm_R: [-0.4, 0, 0.1], forearm_R: [-0.8, 0, 0] }, drop: 0.25 };
}
