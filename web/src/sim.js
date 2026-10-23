// Level 1 slice — game logic, fixed 60 Hz, deterministic, no three.js (runs in Node tests).
// The renderer only reads this state; it never writes to it.
import * as L from './level1_data.js';
import { clamp, lerp } from './rand.js';

export const DT = 1 / 60;
export const TUNING = {
  walk: 1.6, run: 4.4, accel: 16, radius: 0.32,
  step: 0.45, climbMax: 2.2, slopeMax: 0.9, gravity: 20,
  manRun: 4.3, manChaseAfterStun: 3.4, manBlockSpeed: 1.4, manStepOut: 2.8, manRadius: 0.36,
  catchDist: 0.95, stunTime: 4.0, diveRange: 15, falconSpeed: 17, falconReturn: 11,
  respawnDelay: 1.8, slowMo: 0.35,
};

// ---------------------------------------------------------------- movement shared by Najd and the men
export class Mover {
  constructor(x, z, yaw = 0, radius = TUNING.radius) {
    this.radius = radius;
    this.place(x, z, yaw);
  }
  place(x, z, yaw = this.yaw) {
    this.x = x; this.z = z; this.y = L.heightAt(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0; this.yaw = yaw;
    this.mode = 'ground'; this.climb = null; this.speed = 0;
  }
  // dir: unit vector on XZ (or zero); allowClimb(ledge) -> bool. Returns an event name or null.
  step(dt, dirX, dirZ, maxSpeed, allowClimb) {
    let ev = null;
    if (this.mode === 'climb') {
      const c = this.climb;
      c.t += dt;
      const u = clamp(c.t / c.dur, 0, 1);
      const up = clamp(u / 0.6, 0, 1), over = clamp((u - 0.45) / 0.55, 0, 1);
      this.x = lerp(c.fx, c.tx, over);
      this.z = lerp(c.fz, c.tz, over);
      this.y = lerp(c.fy, c.ty, 1 - (1 - up) * (1 - up));
      if (u >= 1) { this.mode = 'ground'; this.climb = null; this.y = L.heightAt(this.x, this.z); ev = 'climbed'; }
      this.speed = 0;
      return ev;
    }
    // horizontal velocity toward the wish
    const wx = dirX * maxSpeed, wz = dirZ * maxSpeed;
    const a = TUNING.accel * dt * (this.mode === 'air' ? 0.25 : 1);
    this.vx += clamp(wx - this.vx, -a, a);
    this.vz += clamp(wz - this.vz, -a, a);
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.3 && Math.hypot(dirX, dirZ) > 0.1) {
      const target = Math.atan2(this.vx, this.vz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    ({ x: nx, z: nz } = L.resolveCircles(nx, nz, this.radius));
    const tryMove = (px, pz) => {
      const g = L.heightAt(px, pz), dh = g - this.y, dist = Math.hypot(px - this.x, pz - this.z);
      if (dh > TUNING.step) return { ok: false, g, dh, ledge: true };
      if (dh > 0.02 && dist > 1e-6 && dh / dist > TUNING.slopeMax && this.mode !== 'air') return { ok: false, g, dh, ledge: false };
      return { ok: true, g, dh };
    };
    let r = tryMove(nx, nz);
    if (!r.ok && r.ledge && this.mode === 'ground' && sp > 0.4) {
      const ledge = L.ledgeAt(nx, nz);
      if (ledge && ledge.climb && r.dh <= TUNING.climbMax && allowClimb(ledge)) {
        const ux = this.vx / sp, uz = this.vz / sp;
        const tx = nx + ux * 0.5, tz = nz + uz * 0.5;
        this.climb = { t: 0, dur: 0.9 + 0.35 * r.dh, fx: this.x, fz: this.z, fy: this.y, tx, tz, ty: L.heightAt(tx, tz), h: r.dh };
        this.mode = 'climb'; this.vx = this.vz = 0; this.yaw = Math.atan2(ux, uz);
        return 'climb';
      }
    }
    if (!r.ok) {                                   // slide along the obstacle
      const rx = tryMove(nx, this.z), rz = tryMove(this.x, nz);
      if (rx.ok && Math.abs(this.vx) > 0.05) { nz = this.z; r = rx; this.vz *= 0.5; }
      else if (rz.ok && Math.abs(this.vz) > 0.05) { nx = this.x; r = rz; this.vx *= 0.5; }
      else { nx = this.x; nz = this.z; this.vx *= 0.2; this.vz *= 0.2; r = { ok: true, g: L.heightAt(nx, nz), dh: 0 }; }
    }
    this.x = nx; this.z = nz;
    const g = L.heightAt(nx, nz);
    if (this.mode === 'air') {
      this.vy -= TUNING.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= g) { this.y = g; this.vy = 0; this.mode = 'ground'; ev = 'land'; }
    } else if (g < this.y - TUNING.step) {
      this.mode = 'air'; this.vy = 0;
    } else {
      this.y = g;
    }
    this.speed = Math.hypot(this.vx, this.vz);
    return ev;
  }
}

// ---------------------------------------------------------------- the saker falcon
class Falcon {
  constructor() { this.reset(); }
  reset() {
    this.state = 'netted';          // netted | flying | perched
    this.x = L.FALCON_NET_POS.x; this.y = L.FALCON_NET_POS.y; this.z = L.FALCON_NET_POS.z;
    this.yaw = 0; this.flap = 0; this.perch = -1; this.target = null; this.flight = null; this.purpose = null;
  }
  fly(to, speed, purpose, target = null) {
    const d = Math.hypot(to.x - this.x, to.y - this.y, to.z - this.z);
    this.flight = { t: 0, dur: Math.max(0.5, d / speed), sx: this.x, sy: this.y, sz: this.z, to, lift: purpose === 'dive' ? 2.0 : Math.min(6, d * 0.25) };
    this.state = 'flying'; this.purpose = purpose; this.target = target;
  }
  perchAt(i) {
    const p = L.PERCHES[i];
    this.state = 'perched'; this.perch = i; this.flight = null; this.target = null;
    this.x = p.x; this.y = p.y; this.z = p.z;
  }
  update(dt) {           // returns 'arrived' when a flight ends
    if (this.state !== 'flying') return null;
    const f = this.flight;
    if (this.target) {   // a dive keeps re-aiming at the man's head
      f.to = { x: this.target.mover.x, y: this.target.mover.y + 1.65, z: this.target.mover.z };
    }
    f.t += dt;
    const u = clamp(f.t / f.dur, 0, 1);
    const px = this.x, pz = this.z;
    const ease = this.purpose === 'dive' ? u * u : u;
    this.x = lerp(f.sx, f.to.x, ease);
    this.z = lerp(f.sz, f.to.z, ease);
    this.y = lerp(f.sy, f.to.y, ease) + Math.sin(Math.PI * u) * f.lift * (this.purpose === 'dive' ? 0.5 : 1);
    if (Math.hypot(this.x - px, this.z - pz) > 1e-4) this.yaw = Math.atan2(this.x - px, this.z - pz);
    this.flap += dt * (this.purpose === 'dive' && u > 0.6 ? 2 : 9);
    return u >= 1 ? 'arrived' : null;
  }
}

// ---------------------------------------------------------------- the men (trappers)
class Man {
  constructor(id) { this.id = id; this.mover = new Mover(0, 0, 0, TUNING.manRadius); this.reset(); }
  reset() {
    this.state = 'hidden'; this.timer = 0; this.hasCage = true; this.stunDir = { x: 0, z: 0 };
    if (this.id === 'A') this.mover.place(L.MAN_A_SPAWN.x, L.MAN_A_SPAWN.z, 0);
    else this.mover.place(L.MAN_B_HIDE.x, L.MAN_B_HIDE.z, Math.PI);
  }
  get active() { return this.state === 'chase' || this.state === 'block' || this.state === 'stepout'; }
  get targetable() { return this.state === 'chase' || this.state === 'block'; }
  stun(fromX, fromZ) {
    this.state = 'stunned'; this.timer = TUNING.stunTime; this.hasCage = false;
    const dx = this.mover.x - fromX, dz = this.mover.z - fromZ, d = Math.hypot(dx, dz) || 1;
    // stagger sideways out of the pass mouth (toward +x for B), so the way opens
    this.stunDir = this.id === 'B' ? { x: 1, z: -0.4 } : { x: dx / d, z: dz / d };
  }
}

// ---------------------------------------------------------------- the slice
export class Slice {
  constructor() {
    for (const p of L.PERCHES) p.y = L.heightAt(p.x, p.z) + 0.05;
    this.player = new Mover(L.START.x, L.START.z, L.START.yaw);
    this.falcon = new Falcon();
    this.men = [new Man('A'), new Man('B')];
    this.phase = 'explore';           // explore | escape | caught | end
    this.checkpoint = 'start';
    this.time = 0; this.timeScale = 1;
    this.netHold = 0; this.events = [];
    this.hint = 'move'; this.movedDist = 0;
    this.falconTaught = false; this.slowMo = false;
    this.caughtTimer = 0; this.deaths = 0; this.dives = 0;
    this.cryTimer = 2.0; this.actionPose = 0; this.callPose = 0;
  }

  emit(e, data = {}) { this.events.push({ e, t: this.time, ...data }); }

  diveTarget() {
    if (this.falcon.state !== 'perched' || this.phase !== 'escape') return null;
    let best = null, bd = TUNING.diveRange;
    for (const m of this.men) {
      if (!m.targetable) continue;
      const d = Math.hypot(m.mover.x - this.player.x, m.mover.z - this.player.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  get nearNet() {
    return this.phase === 'explore' && Math.hypot(this.player.x - L.NET.x, this.player.z - L.NET.z) < L.NET.standRadius
      && this.player.mode === 'ground';
  }

  // input: { mx, my (stick, my>0 = forward), camYaw, action (held), falcon (pressed this tick) }
  tick(input) {
    const dt = DT * this.timeScale;
    this.time += dt;
    const p = this.player;
    if (this.phase === 'caught') {
      this.caughtTimer -= DT;
      p.step(dt, 0, 0, 0, () => false);
      if (this.caughtTimer <= 0) this.respawn();
      return;
    }
    if (this.phase === 'end') { p.step(dt, 0, 0, 0, () => false); this.updateFalcon(dt); return; }

    // --- player movement (camera-relative stick)
    let mag = Math.min(1, Math.hypot(input.mx, input.my));
    const kneeling = this.nearNet && input.action;
    if (kneeling) mag = 0;
    let dx = 0, dz = 0, speed = 0;
    if (mag > 0.15) {
      const fx = -Math.sin(input.camYaw), fz = -Math.cos(input.camYaw);     // camera forward on XZ
      const rx = -fz, rz = fx;                                               // camera right
      dx = fx * input.my + rx * input.mx; dz = fz * input.my + rz * input.mx;
      const n = Math.hypot(dx, dz); dx /= n; dz /= n;
      speed = mag < 0.8 ? lerp(0.7, TUNING.walk, (mag - 0.15) / 0.65) : TUNING.run;
    }
    const ox = p.x, oz = p.z;
    const ev = p.step(dt, dx, dz, speed, () => true);
    if (ev) this.emit(ev);
    this.movedDist += Math.hypot(p.x - ox, p.z - oz);

    // --- hints
    if (this.hint === 'move' && this.movedDist > 3) this.hint = null;

    // --- the net
    this.actionPose = kneeling ? Math.min(1, this.actionPose + dt * 4) : Math.max(0, this.actionPose - dt * 4);
    if (kneeling) {
      this.netHold += dt;
      p.yaw = Math.atan2(L.FALCON_NET_POS.x - p.x, L.FALCON_NET_POS.z - p.z);
      if (this.netHold >= L.NET.holdTime) this.freeFalcon();
    } else if (this.phase === 'explore') {
      this.netHold = Math.max(0, this.netHold - dt * 2);
    }
    if (this.phase === 'explore') {
      this.cryTimer -= dt;
      if (this.cryTimer <= 0) { this.emit('falconCry', { x: this.falcon.x, y: this.falcon.y, z: this.falcon.z }); this.cryTimer = 5 + (this.time % 3); }
    }

    // --- falcon call
    this.callPose = Math.max(0, this.callPose - dt * 1.6);
    const target = this.diveTarget();
    if (input.falcon && target) {
      this.falcon.fly({ x: target.mover.x, y: target.mover.y + 1.65, z: target.mover.z }, TUNING.falconSpeed, 'dive', target);
      this.callPose = 1; this.dives++;
      this.emit('dive');
      if (this.slowMo) { this.slowMo = false; this.timeScale = 1; this.falconTaught = true; }
    }
    this.updateFalcon(dt);
    this.updateMen(dt);

    // --- checkpoints, the end
    if (this.phase === 'escape' && this.checkpoint === 'freed' && p.z < L.CHECKPOINTS.pass.z + 0.5 && p.mode === 'ground') {
      this.checkpoint = 'pass'; this.emit('checkpoint', { id: 'pass' });
    }
    const onExit = L.ledgeAt(p.x, p.z)?.id === 'exit' && p.y > 2.0 && p.mode === 'ground';
    if (this.phase === 'escape' && onExit && Math.hypot(p.x - L.CAIRN.x, p.z - L.CAIRN.z) < L.CAIRN.radius + 0.9) {
      this.phase = 'end'; this.emit('end'); this.hint = null;
      this.timeScale = 1; this.slowMo = false;
      if (this.falcon.state === 'perched' && this.falcon.perch !== 1) this.falcon.fly(L.PERCHES[1], TUNING.falconReturn, 'perch');
    }
  }

  freeFalcon() {
    this.phase = 'escape'; this.hint = null; this.netHold = 0;
    this.checkpoint = 'freed';
    this.emit('freed');
    this.falcon.fly(L.PERCHES[0], TUNING.falconReturn, 'perch');
    const a = this.men[0];
    a.state = 'wait'; a.timer = 0.6;
  }

  updateFalcon(dt) {
    const f = this.falcon;
    if (f.state === 'netted') { f.flap += dt * (Math.sin(this.time * 1.7) > 0.4 ? 14 : 0); return; }
    if (f.update(dt) === 'arrived') {
      if (f.purpose === 'dive') {
        const m = f.target;
        if (m && m.active) { m.stun(this.player.x, this.player.z); this.emit('strike', { man: m.id }); }
        // return to the perch ahead of Najd
        const next = this.player.z < -40 ? 1 : 0;
        f.fly(L.PERCHES[next], TUNING.falconReturn, 'perch');
      } else {
        f.perchAt(f.flight.to === L.PERCHES[1] ? 1 : 0);
        if (this.phase === 'escape') this.emit('falconCry', { x: f.x, y: f.y, z: f.z });
      }
    }
  }

  updateMen(dt) {
    const p = this.player;
    const playerOnExit = L.ledgeAt(p.x, p.z)?.id === 'exit' && p.y > 2.0;
    for (const m of this.men) {
      const mv = m.mover;
      const toP = { x: p.x - mv.x, z: p.z - mv.z }, dist = Math.hypot(toP.x, toP.z) || 1;
      const ux = toP.x / dist, uz = toP.z / dist;
      const allow = (ledge) => ledge.aiClimb;
      switch (m.state) {
        case 'hidden':
          mv.step(dt, 0, 0, 0, allow);
          if (m.id === 'B' && this.phase === 'escape' && p.z < L.MAN_B_TRIGGER_Z) { m.state = 'stepout'; this.emit('shout', { man: 'B' }); }
          break;
        case 'wait':
          m.timer -= dt; mv.step(dt, 0, 0, 0, allow);
          if (m.timer <= 0) { m.state = 'chase'; this.emit('shout', { man: m.id }); }
          break;
        case 'stepout': {
          const bx = L.MAN_B_BLOCK.x - mv.x, bz = L.MAN_B_BLOCK.z - mv.z, bd = Math.hypot(bx, bz);
          if (bd < 0.3) m.state = 'block';
          else mv.step(dt, bx / bd, bz / bd, TUNING.manStepOut, allow);
          break;
        }
        case 'block':
          // edge toward Najd, arms wide, but never leaves the mouth of the pass by much
          if (dist < 12 && mv.z < -44.0) mv.step(dt, ux, uz, TUNING.manBlockSpeed, allow);
          else mv.step(dt, 0, 0, 0, allow);
          if (dist < 12) mv.yaw = Math.atan2(ux, uz);
          break;
        case 'chase':
          if (playerOnExit) { m.state = 'giveup'; this.emit('shout', { man: m.id, giveup: true }); break; }
          mv.step(dt, ux, uz, m.hasCage ? TUNING.manRun : TUNING.manChaseAfterStun, allow);
          break;
        case 'stunned': {
          m.timer -= dt;
          const push = m.timer > TUNING.stunTime - 0.9 ? 2.2 : 0;
          mv.step(dt, m.stunDir.x, m.stunDir.z, push, allow);
          if (m.timer <= 0) { m.state = playerOnExit ? 'giveup' : 'chase'; }
          break;
        }
        case 'giveup':
        case 'down':
          mv.step(dt, 0, 0, 0, allow);
          mv.yaw = Math.atan2(ux, uz);
          break;
      }
      // the first block teaches the dive: slow time until the player calls the falcon
      if (m.id === 'B' && m.state === 'block' && !this.falconTaught && dist < 11 && this.falcon.state === 'perched') {
        if (!this.slowMo) { this.slowMo = true; this.timeScale = TUNING.slowMo; this.hint = 'falcon'; }
      }
      if (this.slowMo && (dist < 2.2 || this.falcon.state !== 'perched')) {
        if (m.id === 'B') { this.slowMo = false; this.timeScale = 1; }
      }
      if (this.hint === 'falcon' && !this.slowMo && this.falconTaught) this.hint = null;
      if (m.active && dist < TUNING.catchDist && p.mode !== 'climb' && Math.abs(mv.y - p.y) < 1.0) this.catchPlayer(m);
    }
  }

  catchPlayer(m) {
    this.phase = 'caught'; this.caughtTimer = TUNING.respawnDelay; this.deaths++;
    this.timeScale = 1; this.slowMo = false;
    this.player.vx = this.player.vz = 0;
    this.emit('caught', { man: m.id });
  }

  respawn() {
    const cp = L.CHECKPOINTS[this.checkpoint];
    this.player.place(cp.x, cp.z, cp.yaw);
    for (const m of this.men) m.reset();
    this.timeScale = 1; this.slowMo = false; this.hint = this.falconTaught ? null : this.hint;
    if (this.checkpoint === 'start') {
      this.phase = 'explore'; this.falcon.reset();
    } else {
      this.phase = 'escape';
      const A = this.men[0];
      if (this.checkpoint === 'freed') {
        this.falcon.perchAt(0);
      } else {
        A.mover.place(0.0, -37.5, 0);
        const B = this.men[1];
        B.state = 'down'; B.hasCage = false; B.mover.place(1.6, -49.6, 0);
        this.falcon.perchAt(1);
      }
      A.state = 'wait'; A.timer = 1.2;
    }
    this.emit('respawn', { checkpoint: this.checkpoint });
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}
