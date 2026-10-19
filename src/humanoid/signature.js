/**
 * UCF Tahap 2 — sidik jari geometri untuk membandingkan bentuk karakter.
 * Dipakai untuk membuktikan simpan/muat menghasilkan bentuk identik.
 */
import * as THREE from 'three';

export function fnv1aFromBytes(bytes) {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * @param {THREE.Object3D} root
 * @param {{world?: boolean}} [options]
 * @returns {{parts:number, vertices:number, triangles:number, materials:number,
 *   geometryHash:string, worldHash:string, size:number[], minY:number}}
 */
export function objectSignature(root, { world = true } = {}) {
  if (!root) return null;
  root.updateMatrixWorld(true);

  const encoder = new TextEncoder();
  const parts = [];
  const materials = new Set();
  let vertices = 0;
  let triangles = 0;

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const position = object.geometry.getAttribute?.('position');
    if (!position) return;

    vertices += position.count;
    const index = object.geometry.getIndex?.();
    triangles += Math.floor((index ? index.count : position.count) / 3);

    const materialList = object.material
      ? Array.isArray(object.material) ? object.material : [object.material]
      : [];
    for (const material of materialList) if (material) materials.add(material);

    const bytes = new Uint8Array(position.array.buffer, position.array.byteOffset, position.array.byteLength);
    const localHash = fnv1aFromBytes(bytes);
    const matrix = world
      ? object.matrixWorld.elements.map((value) => value.toFixed(5)).join(',')
      : '0';
    parts.push({ name: object.name || `mesh-${parts.length}`, count: position.count, hash: localHash, matrix });
  });

  parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const geometryHash = fnv1aFromBytes(encoder.encode(JSON.stringify(parts.map((part) => ({
    name: part.name,
    count: part.count,
    hash: part.hash
  })))));
  const worldHash = fnv1aFromBytes(encoder.encode(JSON.stringify(parts)));

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  return {
    parts: parts.length,
    vertices,
    triangles,
    materials: materials.size,
    geometryHash,
    worldHash,
    size: size.toArray(),
    minY: box.min.y
  };
}
