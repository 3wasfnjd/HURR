// Autopilot for the Level 1 slice: steers through waypoints with the same input the touch
// controls produce. Used by the Node tests and by ?auto=1 in the browser (visual check).
import { Slice } from './sim.js';

export const ROUTE = [
  { x: 0, z: -20 }, { x: 0.6, z: -24.0 }, { x: 1.3, z: -25.7, act: 'net' },
  { x: 0, z: -33 }, { x: -0.3, z: -42 }, { x: -0.4, z: -50 }, { x: 0, z: -56.5 }, { x: 0, z: -61.5 },
];

export class Autopilot {
  constructor(slice, { pressFalcon = true, idleAfterFree = 0 } = {}) {
    Object.assign(this, { slice, pressFalcon, idleAfterFree, wp: 0, idle: 0, freed: false });
  }
  // camYaw: the camera yaw the input is relative to (the game passes its real camera).
  input(camYaw = 0) {
    const s = this.slice, p = s.player, input = { mx: 0, my: 0, camYaw, action: false, falcon: false };
    if (s.phase === 'end') return input;
    if (s.phase === 'caught') { this.wp = s.checkpoint === 'pass' ? 6 : (s.checkpoint === 'freed' ? 3 : 0); return input; }
    if (this.freed && this.idle < this.idleAfterFree) { this.idle += 1 / 60; return input; }
    const w = ROUTE[Math.min(this.wp, ROUTE.length - 1)];
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    const B = s.men[1], dB = Math.hypot(B.mover.x - p.x, B.mover.z - p.z);
    const wait = this.pressFalcon && (B.state === 'stepout' || B.state === 'block') && dB < 7;
    if (wait) { /* hold still: the falcon is on its way */ }
    else if (w.act === 'net' && d < 0.6) input.action = true;
    else if (d < 0.5 && this.wp < ROUTE.length - 1 && !w.act) this.wp++;
    else {
      // world direction -> stick, relative to the camera (forward = -sin/-cos of camYaw)
      const ux = dx / d, uz = dz / d, fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      input.my = ux * fx + uz * fz;
      input.mx = ux * -fz + uz * fx;
    }
    if (w.act === 'net' && s.phase === 'escape') { this.wp++; this.freed = true; }
    if (this.pressFalcon && s.diveTarget()?.id === 'B') input.falcon = true;
    return input;
  }
}

export function runBot({ pressFalcon = true, idleAfterFree = 0, maxSeconds = 240, slice = new Slice(), onTick = null } = {}) {
  const ap = new Autopilot(slice, { pressFalcon, idleAfterFree });
  for (let i = 0; i < maxSeconds * 60; i++) {
    if (slice.phase === 'end') return { result: 'end', slice, seconds: slice.time };
    slice.tick(ap.input(0));
    if (onTick) onTick(slice, i);
  }
  return { result: slice.phase === 'end' ? 'end' : 'timeout', slice, seconds: slice.time };
}
