// Autopilot for the Level 1 slice: steers through waypoints with the same input the touch
// controls produce. Used by the Node tests and by ?auto=1 in the browser (visual check).
import { Slice } from './sim.js';

export const ROUTE = [
  { x: 0, z: -20 }, { x: 0.6, z: -24.0 }, { x: 1.8, z: -26.1, act: 'trap' },
  { x: 0, z: -33 }, { x: -0.3, z: -42 }, { x: -0.4, z: -50 }, { x: 0, z: -56.5 }, { x: 0, z: -61.5 },
];

export class Autopilot {
  constructor(slice, { pressFalcon = true, idleAfterFree = 0, rush = false, freePigeon = false } = {}) {
    Object.assign(this, { slice, pressFalcon, idleAfterFree, rush, freePigeon, wp: 0, idle: 0, freed: false, tick: 0 });
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
    else if (s.trap.mode === 'work') { input.action = true; input.pull = this.rush ? 0.05 : 0.014; input.pullFast = this.rush; }
    else if (this.freePigeon && s.canFreePigeon) input.action = true;
    else if (w.act === 'trap' && d < 0.3) { input.action = s.canWork && this.tick % 2 === 0; }
    else if (d < 0.5 && this.wp < ROUTE.length - 1 && !w.act) this.wp++;
    else {
      // world direction -> stick, relative to the camera (forward = -sin/-cos of camYaw)
      const ux = dx / d, uz = dz / d, fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      // creep near the trapped bird (unless testing a careless player)
      const k = !this.rush && s.phase === 'explore' && s.trapDist < 8 ? 0.45 : 1;
      input.my = (ux * fx + uz * fz) * k;
      input.mx = (ux * -fz + uz * fx) * k;
    }
    if (w.act === 'trap' && s.phase === 'escape' && (!this.freePigeon || s.pigeon.state === 'free')) { this.wp++; this.freed = true; }
    if (this.pressFalcon && s.diveTarget()?.id === 'B') input.falcon = true;
    return input;
  }
}

export function runBot({ pressFalcon = true, idleAfterFree = 0, rush = false, freePigeon = false, maxSeconds = 240, slice = new Slice(), onTick = null } = {}) {
  const ap = new Autopilot(slice, { pressFalcon, idleAfterFree, rush, freePigeon });
  for (let i = 0; i < maxSeconds * 60; i++) {
    if (slice.phase === 'end') return { result: 'end', slice, seconds: slice.time };
    slice.tick(ap.input(0));
    if (onTick) onTick(slice, i);
  }
  return { result: slice.phase === 'end' ? 'end' : 'timeout', slice, seconds: slice.time };
}
