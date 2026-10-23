// Level 1, slice 1 — "الصقر الذي لا يعود" (the opening of Stage 1: قرية الزيتون والوادي).
// Pure data + collision queries (no three.js): shared by the game, the renderer and Node tests.
//
// Layout (metres; the player walks toward -Z):
//   z +14 … +1   village edge plateau (h 4.0): mud houses, olive trees
//   z  +1 … -11  trail down into the wadi
//   z -23 … -31  rock terrace (h 1.45) with the acacia and the net — first climb, taught calmly
//   z -42 … -48  narrow pass between two boulders — the second man blocks it (first falcon dive)
//   z -57 …      exit shelf (h 2.4) — climbed under pressure; the cairn at z -63 ends the slice
import { makeNoise, clamp, smoothstep, lerp } from './rand.js';

const noise = makeNoise(1447);

export const PLATEAU_H = 4.0;
export const FLOOR_H = 0.3;

export const START = { x: 0.0, z: 9.0, yaw: Math.PI };                 // yaw PI = facing -Z
// The trap (a documented Arabian method): a live pigeon wearing a harness of fine nooses,
// tethered by a cord to a stone. The saker struck it and its talons are caught in the nooses.
export const TRAP = {
  x: 2.0, z: -26.8,
  calmRadius: 7.5,          // inside this the bird reacts to how Najd moves
  reach: 1.5,               // close enough to kneel and work the nooses
  knots: 3,                 // nooses around the talons at the start
  maxKnots: 5,              // panicking can tangle it further
  stone: { x: 3.5, z: -25.3 },
};
export const FALCON_TRAP_POS = { x: TRAP.x, y: 0, z: TRAP.z };   // y filled at load (ground + 0.16)
export const CAIRN = { x: 0.0, z: -63.0, radius: 2.2 };

export const LEDGES = [
  // terrace: front face z=-23 (climb up from the wadi), back face z=-31 (drop down)
  { id: 'terrace', x0: -9, x1: 9, z0: -31, z1: -23, top: 1.45, climb: true, aiClimb: true },
  // exit shelf: front face z=-57; the men will not follow up here
  { id: 'exit', x0: -10, x1: 10, z0: -90, z1: -57, top: 2.4, climb: true, aiClimb: false },
];

// Circular blockers (boulders, tree trunks, cairn). r = collision radius.
export const CIRCLES = [
  { x: -3.75, z: -45.0, r: 2.6, kind: 'boulder', h: 3.2 },
  { x: 3.75, z: -45.0, r: 2.6, kind: 'boulder', h: 3.0 },
  { x: -4.6, z: -16.0, r: 1.1, kind: 'boulder', h: 1.3 },
  { x: 4.9, z: -19.5, r: 0.8, kind: 'boulder', h: 1.0 },
  { x: -5.2, z: -36.0, r: 1.0, kind: 'boulder', h: 1.2 },
  { x: 5.4, z: -51.5, r: 0.9, kind: 'boulder', h: 1.1 },
  { x: 3.3, z: -28.4, r: 0.28, kind: 'acacia', h: 0 },
  { x: CAIRN.x, z: CAIRN.z, r: 0.7, kind: 'cairn', h: 1.2 },
  { x: -6.5, z: 2.6, r: 0.35, kind: 'olive', h: 0 },
  { x: 7.2, z: 4.0, r: 0.35, kind: 'olive', h: 0 },
  { x: -2.8, z: 4.6, r: 0.3, kind: 'olive', h: 0 },
];

// Volumes the camera must not pass through (tree crowns): centre, radius, vertical band.
export const CAMERA_BLOCKERS = [
  { x: 3.2, z: -28.3, r: 2.4, y0: 3.7, y1: 5.2 },
];

// Axis-aligned houses on the plateau (x0,x1,z0,z1, wall height).
export const HOUSES = [
  { x0: -10.5, x1: -5.5, z0: 9.5, z1: 14.5, h: 3.0 },
  { x0: -4.5, x1: -1.5, z0: 12.0, z1: 15.0, h: 2.6 },
  { x0: 2.0, x1: 6.5, z0: 11.0, z1: 15.0, h: 3.2 },
  { x0: 7.0, x1: 10.5, z0: 6.5, z1: 10.5, h: 2.7 },
  { x0: -10.8, x1: -7.8, z0: 4.5, z1: 7.8, h: 2.5 },
];

// Where the two men enter, and where the falcon perches after it is freed.
export const MAN_A_SPAWN = { x: -1.5, z: -14.0 };        // comes down the trail behind Najd
export const MAN_B_HIDE = { x: 4.2, z: -50.2 };          // behind the right boulder
export const MAN_B_BLOCK = { x: 0.0, z: -47.6 };         // steps into the mouth of the pass
export const MAN_B_TRIGGER_Z = -32.5;
export const PERCHES = [
  { x: 8.6, y: 0, z: -37.0 },                            // east rim, overlooking the pass (y filled at load)
  { x: -8.4, y: 0, z: -60.0 },                           // west rim above the exit shelf
];
export const CHECKPOINTS = {
  start: { x: START.x, z: START.z, yaw: START.yaw },
  freed: { x: 1.0, z: -25.2, yaw: Math.PI },
  pass: { x: 0.0, z: -52.5, yaw: Math.PI },
};

export function canyonHalfWidth(z) {
  if (z >= 0) return 11.5;
  if (z > -12) return lerp(11.5, 7.0, -z / 12);
  if (z > -38) return 7.0;
  if (z > -42) return lerp(7.0, 5.6, (-38 - z) / 4);
  if (z > -48) return 5.6;
  if (z > -53) return lerp(5.6, 7.0, (-48 - z) / 5);
  return 7.0;
}

// Ground without the rock shelves.
export function baseHeight(x, z) {
  const trail = lerp(FLOOR_H, PLATEAU_H, smoothstep(-11.5, 1.5, z));
  let h = trail + 0.12 * noise(x * 0.3 + 11, z * 0.3) + 0.1 * noise(x * 0.11, z * 0.11 + 7);
  const e = Math.abs(x) - canyonHalfWidth(z);
  if (e > 0) h += Math.min(e, 2.8) * 2.3 + 0.35 * noise(x * 0.5, z * 0.5) * Math.min(e, 1);
  if (z > 16) h += (z - 16) * 1.6;
  return h;
}

export function ledgeAt(x, z) {
  let best = null;
  for (const L of LEDGES) {
    if (x >= L.x0 && x <= L.x1 && z >= L.z0 && z <= L.z1 && (!best || L.top > best.top)) best = L;
  }
  return best;
}

export function heightAt(x, z) {
  const b = baseHeight(x, z);
  const L = ledgeAt(x, z);
  return L ? Math.max(b, L.top) : b;
}

// Push a circle of radius r out of every blocker; returns the corrected {x, z}.
export function resolveCircles(x, z, r) {
  for (const c of CIRCLES) {
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m && d > 1e-6) { x = c.x + (dx / d) * m; z = c.z + (dz / d) * m; }
  }
  for (const H of HOUSES) {
    const cx = clamp(x, H.x0, H.x1), cz = clamp(z, H.z0, H.z1);
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d > 1e-6) { x = cx + (dx / d) * r; z = cz + (dz / d) * r; } else {
        // centre inside the box: leave by the nearest face
        const opts = [[H.x0 - r - x, 0], [H.x1 + r - x, 0], [0, H.z0 - r - z], [0, H.z1 + r - z]];
        opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        x += opts[0][0]; z += opts[0][1];
      }
    }
  }
  return { x, z };
}
