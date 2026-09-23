// ── Orbit camera ─────────────────────────────────────────────────────────────
// Drag to turn round the model, wheel or pinch to zoom, right-drag (or shift-
// drag, or two fingers) to pan. Written here rather than vendored: the game
// ships only the three.js pieces it uses, and this is short.

import * as THREE from 'three';

export class Orbit {
  constructor(camera, el) {
    this.camera = camera;
    this.el = el;
    this.target = new THREE.Vector3();
    this.yaw = 0.7;
    this.pitch = 0.3;
    this.dist = 5;
    this.minDist = 0.05;
    this.maxDist = 2000;
    this.autoRotate = false;

    this._pointers = new Map();
    this._pinch = 0;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e));
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  /**
   * Frame a box from a given angle: the closest distance at which all eight
   * corners are inside the view, with a margin. A bounding sphere would do,
   * but it leaves a long, low animal as a strip across the middle.
   */
  frame(box, yaw = 0.7, pitch = 0.3, margin = 1.14) {
    box.getCenter(this.target);
    this.yaw = yaw;
    this.pitch = pitch;
    const corners = [];
    for (let i = 0; i < 8; i++) {
      corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x,
                                     i & 2 ? box.max.y : box.min.y,
                                     i & 4 ? box.max.z : box.min.z));
    }
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * (this.camera.aspect || 1);
    const p = new THREE.Vector3();
    const fits = d => {
      this.dist = d;
      this.update();
      for (const c of corners) {
        p.copy(c).applyMatrix4(this.camera.matrixWorldInverse);
        const z = -p.z;
        if (z <= 0.01) return false;
        if (Math.max(Math.abs(p.x) / (z * tanH), Math.abs(p.y) / (z * tanV)) * margin > 1) return false;
      }
      return true;
    };
    let lo = 0.02, hi = 20000;
    for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (fits(m)) hi = m; else lo = m; }
    this.dist = hi;
    const size = box.getSize(new THREE.Vector3()).length();
    this.minDist = Math.max(0.02, size * 0.08);
    this.maxDist = Math.max(60, size * 12);
    this.update();
  }

  view(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; this.update(); }

  zoom(f) {
    this.dist = THREE.MathUtils.clamp(this.dist * f, this.minDist, this.maxDist);
    this.update();
  }

  down(e) {
    this.el.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    this._pinch = 0;
  }

  move(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (this._pointers.size === 2) {
      // Two fingers: the spread zooms and the midpoint pans.
      const [a, b] = [...this._pointers.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinch) this.zoom(this._pinch / spread);
      this._pinch = spread;
      this.pan(dx / 2, dy / 2);
      return;
    }
    if (p.button === 2 || p.button === 1 || p.shift) this.pan(dx, dy);
    else {
      this.yaw -= dx * 0.008;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.008, -1.55, 1.55);
      this.update();
    }
  }

  up(e) { this._pointers.delete(e.pointerId); this._pinch = 0; }

  pan(dx, dy) {
    const h = this.el.clientHeight || 1;
    const per = 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * per).addScaledVector(up, dy * per);
    this.update();
  }

  tick(dt) {
    if (this.autoRotate && !this._pointers.size) { this.yaw += dt * 0.35; this.update(); }
  }

  update() {
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * c * this.dist);
    this.camera.lookAt(this.target);
    this.camera.near = Math.max(0.01, this.dist / 400);
    this.camera.far = Math.max(2500, this.dist * 40);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
