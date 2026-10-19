/**
 * UCF Tahap 3 — sidik jari bentuk untuk membandingkan karakter.
 * Untuk mesh ber-skin, hash memakai posisi verteks SETELAH deformasi tulang,
 * sehingga pose dan rotasi sendi ikut terukur.
 *
 * geometryHash  : bentuk relatif terhadap root karakter (tidak terpengaruh posisi di dunia)
 * worldHash     : bentuk + penempatan/transform root di dunia
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

function quantizedBytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i += 1) {
    view.setInt32(i * 4, Math.round(values[i] * 10000), true);
  }
  return bytes;
}

/**
 * @param {THREE.Object3D} root
 * @returns {{parts:number, vertices:number, triangles:number, materials:number,
 *   geometryHash:string, worldHash:string, size:number[], minY:number}}
 */
export function objectSignature(root) {
  if (!root) return null;
  root.updateMatrixWorld(true);

  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const localParts = [];
  const worldParts = [];
  const materials = new Set();
  let vertices = 0;
  let triangles = 0;

  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const local = new THREE.Vector3();

  const meshes = [];
  root.traverse((object) => {
    if (object.isMesh && object.geometry && !object.userData?.ucfHelper) meshes.push(object);
  });

  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute?.('position');
    if (!position) continue;

    vertices += position.count;
    const index = mesh.geometry.getIndex?.();
    triangles += Math.floor((index ? index.count : position.count) / 3);

    const materialList = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const material of materialList) if (material) materials.add(material);

    const worldValues = new Float32Array(position.count * 3);
    const localValues = new Float32Array(position.count * 3);

    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, point);
      point.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
      worldValues[i * 3] = point.x;
      worldValues[i * 3 + 1] = point.y;
      worldValues[i * 3 + 2] = point.z;

      local.copy(point).applyMatrix4(toLocal);
      localValues[i * 3] = local.x;
      localValues[i * 3 + 1] = local.y;
      localValues[i * 3 + 2] = local.z;
    }

    const name = mesh.name || `mesh-${localParts.length}`;
    localParts.push({ name, count: position.count, hash: fnv1aFromBytes(quantizedBytes(localValues)) });
    worldParts.push({ name, count: position.count, hash: fnv1aFromBytes(quantizedBytes(worldValues)) });
  }

  const sortByName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  localParts.sort(sortByName);
  worldParts.sort(sortByName);

  const geometryHash = fnv1aFromBytes(new TextEncoder().encode(JSON.stringify(localParts)));
  const worldHash = fnv1aFromBytes(new TextEncoder().encode(JSON.stringify(worldParts)));
  const size = box.getSize(new THREE.Vector3());

  return {
    parts: localParts.length,
    vertices,
    triangles,
    materials: materials.size,
    geometryHash,
    worldHash,
    size: size.toArray(),
    minY: box.isEmpty() ? 0 : box.min.y
  };
}
