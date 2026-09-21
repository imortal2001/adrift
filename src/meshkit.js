// ── Mesh kit ─────────────────────────────────────────────────────────────────
// Shared geometry plumbing. Both the forest and the reef are built the same
// way — a handful of primitives, each with its own colour, welded into one
// buffer so a whole plant costs a single instanced draw.

import * as THREE from 'three';

/**
 * Concatenate parts into one geometry, baking each part's colour into vertex
 * colours. Positions and normals come across as-is, so transform the parts
 * before merging, not after.
 *
 * @param parts  [{ geo, color }]
 */
export function mergeParts(parts) {
  let vCount = 0, iCount = 0;
  for (const { geo } of parts) {
    vCount += geo.attributes.position.count;
    iCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;

  for (const { geo, color } of parts) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nrm[(vo + i) * 3] = n.getX(i);
      nrm[(vo + i) * 3 + 1] = n.getY(i);
      nrm[(vo + i) * 3 + 2] = n.getZ(i);
      col[(vo + i) * 3] = color.r;
      col[(vo + i) * 3 + 1] = color.g;
      col[(vo + i) * 3 + 2] = color.b;
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) idx[io + i] = geo.index.getX(i) + vo;
      io += geo.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
