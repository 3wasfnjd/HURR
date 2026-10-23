// Touch-first controls: left half = floating joystick, right half = camera drag,
// two context buttons (net / falcon) that only appear when they mean something.
// Keyboard + mouse exist for desktop testing only (WASD, E = act, F = falcon).
export class Controls {
  constructor(el, ui) {
    this.el = el; this.ui = ui;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = { id: null, lx: 0, ly: 0 };
    this.camDX = 0; this.camDY = 0;
    this.actionHeld = false; this.falconPressed = false; this.touched = false;
    this.keys = new Set();
    this.R = 56;                                    // joystick radius in CSS px

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    const hold = (btn, on) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); on(true); btn.setPointerCapture(e.pointerId); });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(t, () => on(false));
    };
    hold(ui.actBtn, (v) => { this.actionHeld = v; });
    ui.falconBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.falconPressed = true; });

    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'KeyF') this.falconPressed = true; });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.actionHeld = false; this.release(); });
  }

  release() { this.stick.id = null; this.stick.x = this.stick.y = 0; this.look.id = null; this.ui.stickBase.style.display = 'none'; }

  down(e) {
    this.touched = true;
    if (e.clientX < window.innerWidth * 0.5 && this.stick.id === null) {
      Object.assign(this.stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      const b = this.ui.stickBase;
      b.style.display = 'block';
      b.style.left = `${e.clientX}px`; b.style.top = `${e.clientY}px`;
      this.ui.stickKnob.style.transform = 'translate(-50%,-50%)';
    } else if (this.look.id === null) {
      Object.assign(this.look, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
    }
    this.el.setPointerCapture?.(e.pointerId);
  }

  move(e) {
    if (e.pointerId === this.stick.id) {
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy), R = this.R;
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stick.x = dx / R; this.stick.y = -dy / R;
      this.ui.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.look.id) {
      this.camDX += e.clientX - this.look.lx; this.camDY += e.clientY - this.look.ly;
      this.look.lx = e.clientX; this.look.ly = e.clientY;
    }
  }

  up(e) {
    if (e.pointerId === this.stick.id) { this.stick.id = null; this.stick.x = this.stick.y = 0; this.ui.stickBase.style.display = 'none'; }
    if (e.pointerId === this.look.id) this.look.id = null;
  }

  // Called once per fixed tick: returns the stick, the action and an edge-triggered falcon press.
  sample() {
    let mx = this.stick.x, my = this.stick.y;
    const k = this.keys;
    if (k.size) {
      const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      if (kx || ky) { const n = Math.hypot(kx, ky); const sp = k.has('ShiftLeft') ? 0.6 : 1; mx = (kx / n) * sp; my = (ky / n) * sp; }
    }
    const out = { mx, my, action: this.actionHeld || k.has('KeyE') || k.has('Space'), falcon: this.falconPressed };
    this.falconPressed = false;
    return out;
  }

  takeCamera() { const d = [this.camDX, this.camDY]; this.camDX = this.camDY = 0; return d; }
}
