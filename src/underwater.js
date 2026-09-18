// ── Underwater ambience ──────────────────────────────────────────────────────
// What makes going under feel like going under: light and colour falling away
// with depth, and motes of marine snow drifting through the beam of the sun.
//
// The particle field is a fixed cloud that wraps around the camera, so a few
// hundred points read as an endless volume.

import * as THREE from 'three';

const COUNT = 620;
const BOX = 26;                 // metres; the cloud wraps at half this
const FALL = 0.12;              // m/s, slow sink
const DARK_DEPTH = 24;          // by here, most light is gone

export class Underwater {
  constructor(scene) {
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xcfeaf6, size: 0.038, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    scene.add(this.motes);

    this.fogColor = new THREE.Color();
    this.shallow = new THREE.Color(0x2a89ab);
    this.deep = new THREE.Color(0x03151f);
  }

  /**
   * @param depth  metres the camera is below the surface (0 when above)
   * @param sky    so the lights can be attenuated for this frame only
   */
  update(dt, camPos, submerged, depth, sky, scene, night) {
    this.motes.visible = submerged;
    if (!submerged) {
      sky.uniforms.uUnderwater.value = 0;
      return 1;
    }

    // Positions are world space; wrap each axis into the box centred on the
    // camera. A true modulo, so it still works after a long swim.
    const p = this.motes.geometry.attributes.position;
    const arr = p.array, half = BOX / 2;
    const wrap = (v, c) => c + (((v - c + half) % BOX) + BOX) % BOX - half;
    const cx = camPos.x, cy = camPos.y, cz = camPos.z;
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      arr[j]     = wrap(arr[j], cx);
      arr[j + 1] = wrap(arr[j + 1] - FALL * dt, cy);
      arr[j + 2] = wrap(arr[j + 2], cz);
    }
    p.needsUpdate = true;

    // How much daylight is left at this depth.
    const light = THREE.MathUtils.clamp(1 - depth / DARK_DEPTH, 0.1, 1) * (1 - night * 0.8);

    this.fogColor.copy(this.shallow).lerp(this.deep, 1 - light);
    scene.fog.color.copy(this.fogColor);
    scene.fog.density = 0.055 + 0.085 * (1 - light);

    // Scale this frame's lighting; sky.update() rewrites it from scratch next
    // frame, so there is nothing to restore.
    sky.sun.intensity *= light * 0.8;
    sky.hemi.intensity *= light * 0.85;
    sky.hemi.color.copy(this.fogColor);
    this.motes.material.opacity = 0.2 + 0.4 * light;

    // The sky dome becomes the water column while we are under it.
    sky.uniforms.uUnderwater.value = 1;
    sky.uniforms.uWaterColor.value.copy(this.fogColor);

    return light;
  }
}
