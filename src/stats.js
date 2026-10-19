/**
 * UCF — penghitung statistik model (mesh, material, tekstur, skeleton, tulang, morph).
 * Hanya membaca scene graph; tidak mengubah objek.
 */
import * as THREE from 'three';

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap',
  'bumpMap', 'displacementMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap',
  'iridescenceMap', 'iridescenceThicknessMap', 'transmissionMap', 'thicknessMap', 'anisotropyMap'
];

function materialsOf(object) {
  const material = object.material;
  if (!material) return [];
  return Array.isArray(material) ? material.filter(Boolean) : [material];
}

/**
 * @param {THREE.Object3D} root
 * @param {{clips?: THREE.AnimationClip[], json?: object}} [options]
 */
export function summarize(root, { clips = [], json = null } = {}) {
  const stats = {
    nodes: 0,
    meshes: 0,
    skinnedMeshes: 0,
    bones: 0,
    skeletons: 0,
    materials: 0,
    textures: 0,
    images: Array.isArray(json?.images) ? json.images.length : 0,
    vertices: 0,
    triangles: 0,
    morphTargets: 0,
    morphMeshes: 0,
    clips: Array.isArray(clips) ? clips.length : 0,
    clipNames: Array.isArray(clips) ? clips.map((clip) => clip?.name || '(tanpa nama)') : [],
    materialsList: [],
    size: [0, 0, 0],
    center: [0, 0, 0]
  };

  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    stats.nodes += 1;
    if (object.isBone) stats.bones += 1;

    if (object.isMesh) {
      stats.meshes += 1;
      if (object.isSkinnedMesh) {
        stats.skinnedMeshes += 1;
        if (object.skeleton) skeletons.add(object.skeleton);
      }
      const geometry = object.geometry;
      if (geometry) {
        const position = geometry.getAttribute?.('position');
        if (position) stats.vertices += position.count;
        const index = geometry.getIndex?.();
        const drawCount = index ? index.count : position?.count || 0;
        const instances = object.isInstancedMesh ? Math.max(1, object.count) : 1;
        stats.triangles += Math.floor(drawCount / 3) * instances;
        const morphPositions = geometry.morphAttributes?.position;
        if (Array.isArray(morphPositions) && morphPositions.length) {
          stats.morphTargets += morphPositions.length;
          stats.morphMeshes += 1;
        }
      }
      for (const material of materialsOf(object)) materials.add(material);
    }
  });

  stats.skeletons = skeletons.size;
  stats.materials = materials.size;

  for (const material of materials) {
    for (const slot of TEXTURE_SLOTS) {
      const texture = material[slot];
      if (texture && texture.isTexture) textures.add(texture);
    }
    if (stats.materialsList.length < 24) stats.materialsList.push(material.name || '(tanpa nama)');
  }
  stats.textures = textures.size;

  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    stats.size = [size.x, size.y, size.z];
    stats.center = [center.x, center.y, center.z];
  }

  return stats;
}
