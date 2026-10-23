// Minimal touch/mouse orbit for the preview: one finger orbits, two fingers pinch-zoom,
// double-tap resets. Pointer Events only (works on iOS Safari and Android Chrome).
import * as THREE from 'three';

export class OrbitTouch {
  constructor(camera, el, target) {
    this.camera = camera;
    this.target = target.clone();
    this.home = { yaw: 0.35, pitch: 0.18, dist: 3.2 };
    Object.assign(this, { yaw: this.home.yaw, pitch: this.home.pitch, dist: this.home.dist });
    this.pointers = new Map();
    this.lastTap = 0;
    this.pinch0 = 0;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, (e) => this.pointers.delete(e.pointerId));
    el.addEventListener('wheel', (e) => { this.dist = THREE.MathUtils.clamp(this.dist * (1 + e.deltaY * 0.001), 1.2, 12); }, { passive: true });
  }

  _down(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      const now = performance.now();
      if (now - this.lastTap < 300) Object.assign(this, { yaw: this.home.yaw, pitch: this.home.pitch, dist: this.home.dist });
      this.lastTap = now;
    }
    if (this.pointers.size === 2) this.pinch0 = this._spread();
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) {
      this.yaw -= dx * 0.008;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.006, -0.15, 1.2);
    } else if (this.pointers.size === 2) {
      const s = this._spread();
      if (this.pinch0 > 0) this.dist = THREE.MathUtils.clamp(this.dist * (this.pinch0 / s), 1.2, 12);
      this.pinch0 = s;
    }
  }

  _spread() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  update() {
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * c * this.dist);
    this.camera.lookAt(this.target);
  }
}
