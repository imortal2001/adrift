// ── Grappling hook ───────────────────────────────────────────────────────────
// Right-click throws a weighted hook on a rope. If it lands near flotsam the
// rope goes taut and the debris is reeled in; otherwise it sinks and comes
// back empty. This is the reach upgrade that makes gathering stop being a
// matter of waiting for the current.

import * as THREE from 'three';
import { waveHeight } from './ocean.js';
import { textures } from './textures.js';

const SEGMENTS = 12;
// Tuned so a throw aimed straight at debris 20m out actually reaches it: a
// heavy arc means players aim at the target and sail over the top of it.
const THROW_SPEED = 32;
const GRAVITY = 6;
const LOFT = 1.6;           // arcs the throw over the swell between here and there
const CATCH_RADIUS = 1.9;
const MAX_RANGE = 26;
const REEL_IN = 2.4;        // debris this close counts as landed

export class Hook {
  constructor(scene) {
    this.state = 'idle';    // idle | flying | attached | returning
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = null;
    this.origin = new THREE.Vector3();

    const t = textures();
    this.head = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.34, 7),
      new THREE.MeshStandardMaterial({ map: t.metal, roughness: 0.5, metalness: 0.5 })
    );
    this.head.castShadow = true;
    this.head.visible = false;
    scene.add(this.head);

    const pts = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
    this.ropeGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this.rope = new THREE.Line(this.ropeGeo, new THREE.LineBasicMaterial({ color: 0xd8c79a }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    scene.add(this.rope);
  }

  get busy() { return this.state !== 'idle'; }

  throwFrom(origin, dir) {
    if (this.busy) return false;
    this.pos.copy(origin).addScaledVector(dir, 0.6);
    this.vel.copy(dir).multiplyScalar(THROW_SPEED).add(new THREE.Vector3(0, LOFT, 0));
    this.state = 'flying';
    this.head.visible = this.rope.visible = true;
    return true;
  }

  release() {
    if (this.target) this.target.held = false;
    this.target = null;
    this.state = 'returning';
  }

  reset() {
    this.state = 'idle';
    this.target = null;
    this.head.visible = this.rope.visible = false;
  }

  /**
   * @param handPos where the rope is held
   * @param debris   DebrisField
   * @param onCatch  called with the debris once it is within reach
   */
  update(dt, handPos, time, debris, onCatch) {
    if (this.state === 'idle') return;
    this.origin.copy(handPos);

    if (this.state === 'flying') {
      this.vel.y -= GRAVITY * dt;
      this.pos.addScaledVector(this.vel, dt);

      let hit = debris.nearestTo(this.pos, CATCH_RADIUS);
      // A thrown hook skims through crests rather than stopping dead at the
      // first one, and gets one last generous grab as it goes under.
      const sinking = this.pos.y < waveHeight(this.pos.x, this.pos.z, time) - 0.45;
      const spent = this.pos.distanceTo(handPos) > MAX_RANGE;
      if (!hit && (sinking || spent)) hit = debris.nearestTo(this.pos, CATCH_RADIUS * 1.4);
      if (hit) {
        hit.held = true;
        this.target = hit;
        this.state = 'attached';
      } else if (sinking || spent) {
        this.state = 'returning';
      }
    } else if (this.state === 'attached') {
      const t = this.target;
      if (!t) { this.state = 'returning'; }
      else {
        this.pos.set(t.x, t.y + 0.16, t.z);
        if (Math.hypot(t.x - handPos.x, t.z - handPos.z) < REEL_IN) {
          t.held = false;
          this.target = null;
          onCatch(t);
          this.reset();
          return;
        }
      }
    } else if (this.state === 'returning') {
      this.pos.lerp(handPos, Math.min(1, dt * 7));
      if (this.pos.distanceTo(handPos) < 0.7) { this.reset(); return; }
    }

    this.head.position.copy(this.pos);
    this.head.lookAt(handPos);
    this.head.rotateX(Math.PI / 2);

    // Rope with a little catenary sag, so it doesn't look like a laser.
    const p = this.ropeGeo.attributes.position;
    const span = handPos.distanceTo(this.pos);
    const sag = Math.min(1.1, span * 0.06) * (this.state === 'attached' ? 0.55 : 1);
    for (let i = 0; i <= SEGMENTS; i++) {
      const k = i / SEGMENTS;
      p.setXYZ(i,
        THREE.MathUtils.lerp(handPos.x, this.pos.x, k),
        THREE.MathUtils.lerp(handPos.y, this.pos.y, k) - Math.sin(k * Math.PI) * sag,
        THREE.MathUtils.lerp(handPos.z, this.pos.z, k));
    }
    p.needsUpdate = true;
    this.ropeGeo.computeBoundingSphere();
  }
}
