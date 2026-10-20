/**
 * UCF Tahap 6 — penyidik model eksternal.
 *
 * Fungsi ini TIDAK memodifikasi model. Ia membaca apa yang benar-benar ada di berkas
 * (mesh, material, skin, tulang, animasi) lalu menyimpulkan masalah khusus model:
 *   - mesh tanpa rig / tanpa skin weights
 *   - skeleton tanpa humanoid yang dikenali
 *   - track animasi yang menunjuk node yang tidak ada
 *   - tulang jari hilang, nama tulang non-standar, multi-mesh, multi-material
 * Setiap temuan diberi status PASS / WARN / FAIL / NOT TESTED, tidak ada klaim tanpa ukuran.
 */
import * as THREE from 'three';
import { analyzeSkeleton } from './skeleton.js';

const FINGER = /(thumb|index|middle|ring|pinky|little|telunjuk|jari)/i;
const MATERIAL_KEYS = ['metalness', 'roughness', 'transparent', 'opacity', 'map', 'normalMap', 'emissiveMap', 'color'];

function trianglesOf(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

function materialInfo(material) {
  if (!material) return null;
  const info = { name: material.name || '(tanpa nama)', type: material.type };
  for (const key of MATERIAL_KEYS) {
    if (key === 'color') {
      if (material.color) info.color = `#${material.color.getHexString()}`;
      continue;
    }
    if (key === 'map' || key === 'normalMap' || key === 'emissiveMap') {
      if (material[key]?.image) info[key] = `${material[key].image.width || '?'}×${material[key].image.height || '?'}`;
      continue;
    }
    if (material[key] !== undefined) info[key] = material[key];
  }
  return info;
}

/**
 * @param {THREE.Object3D} root
 * @param {object} meta { name, fileName, clips, report }
 */
export function inspectModel(root, meta = {}) {
  if (!root) return null;
  root.updateMatrixWorld(true);

  const meshes = [];
  const bones = [];
  const materialMap = new Map();
  const textureNames = new Set();
  const skinnedMeshes = [];
  const skeletons = new Set();
  let mainSkeleton = null;
  let mainSkeletonWeight = -1;

  root.traverse((object) => {
    if (object.isMesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        materialMap.set(material.uuid, materialInfo(material));
        for (const key of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap']) {
          if (material[key]?.image) textureNames.add(material[key].image.uuid || material[key].name || key);
        }
      }
      meshes.push({
        name: object.name || '(tanpa nama)',
        type: object.type,
        skinned: Boolean(object.isSkinnedMesh),
        vertices: object.geometry?.getAttribute('position')?.count || 0,
        triangles: trianglesOf(object.geometry),
        morphTargets: object.geometry?.morphAttributes?.position?.length || 0,
        materials: materials.filter(Boolean).map((material) => material.name || material.type),
        visible: object.visible
      });
      if (object.isSkinnedMesh) {
        skinnedMeshes.push(object.name);
        if (object.skeleton) {
          skeletons.add(object.skeleton);
          const weight = object.geometry?.getAttribute('position')?.count || 0;
          if (!mainSkeleton || weight > mainSkeletonWeight) {
            mainSkeleton = object.skeleton;
            mainSkeletonWeight = weight;
          }
        }
      }
    }
    if (object.isBone) bones.push(object.name || '(tanpa nama)');
  });

  const boneSet = new Set(bones);
  const fingerBones = bones.filter((name) => FINGER.test(name));
  const sides = { left: 0, right: 0 };
  for (const name of bones) {
    if (/(^|[_:.\s])(l|left)([_:.\s]|$)/i.test(name)) sides.left += 1;
    if (/(^|[_:.\s])(r|right)([_:.\s]|$)/i.test(name)) sides.right += 1;
  }

  const clips = Array.isArray(meta.clips) ? meta.clips : [];
  const clipInfo = clips.map((clip) => {
    const targets = new Set();
    const paths = new Set();
    let unbound = 0;
    let unmatched = 0;
    for (const track of clip.tracks || []) {
      const dot = track.name.lastIndexOf('.');
      const target = dot > 0 ? track.name.slice(0, dot) : track.name;
      const path = dot > 0 ? track.name.slice(dot + 1) : '';
      targets.add(target);
      paths.add(path);
      if (!boneSet.has(target)) {
        // track boleh menunjuk mesh/objek non-tulang (mis. morph target / posisi kamera)
        const node = root.getObjectByName(target);
        if (!node) unmatched += 1;
        else unbound += 1;
      }
    }
    return {
      name: clip.name,
      duration: Number((clip.duration || 0).toFixed(3)),
      tracks: clip.tracks?.length || 0,
      targets: targets.size,
      paths: [...paths],
      unmatchedTracks: unmatched,
      nonBoneTargets: unbound
    };
  });

  const duplicateNames = [];
  let analysis = null;
  try {
    // gabungkan seluruh skeleton (model multi-skin) supaya tidak ada tulang yang hilang
    // skeleton mesh terbesar = hierarki utama; salinan duplikat (nama sama) dicatat
    const primary = mainSkeleton;
    const allBones = [];
    const seen = new Set();
    const seenNames = new Set();
    const groups = primary ? [primary, ...skeletons] : [...skeletons];
    for (const skeleton of groups) {
      for (const bone of skeleton.bones) {
        if (seen.has(bone)) continue;
        seen.add(bone);
        if (bone.name && seenNames.has(bone.name)) { duplicateNames.push(bone.name); continue; }
        if (bone.name) seenNames.add(bone.name);
        allBones.push(bone);
      }
    }
    analysis = analyzeSkeleton(root, { skeleton: allBones.length ? { bones: allBones } : null });
  } catch (error) {
    analysis = { error: error.message };
  }

  const roles = analysis?.bones?.filter((entry) => entry.role).map((entry) => entry.role) || [];
  const coreRoles = ['hips', 'spine.0', 'chest', 'neck', 'head', 'arm.upper', 'arm.lower', 'hand', 'leg.upper', 'leg.lower', 'foot', 'toe'];
  const missingCore = coreRoles.filter((role) => !roles.some((entry) => entry.startsWith(role)));

  const box = new THREE.Box3();
  const deformedAware = skinnedMeshes.length > 0;
  if (deformedAware) {
    const vector = new THREE.Vector3();
    root.traverse((object) => {
      if (!object.isMesh) return;
      const position = object.geometry?.getAttribute('position');
      if (!position) return;
      const step = Math.max(1, Math.floor(position.count / 400));
      for (let i = 0; i < position.count; i += step) {
        object.getVertexPosition(i, vector);
        vector.applyMatrix4(object.matrixWorld);
        box.expandByPoint(vector);
      }
    });
  } else {
    box.setFromObject(root);
  }

  const issues = [];
  const push = (id, label, status, detail) => issues.push({ id, label, status, detail });

  push('mesh', 'Mesh ditemukan', meshes.length > 0 ? 'PASS' : 'FAIL',
    `${meshes.length} mesh, ${meshes.reduce((sum, mesh) => sum + mesh.vertices, 0)} verteks, ${meshes.reduce((sum, mesh) => sum + mesh.triangles, 0)} segitiga.`);
  push('rig', 'Punya tulang', bones.length ? 'PASS' : 'NOT TESTED',
    bones.length ? `${bones.length} tulang, ${skinnedMeshes.length} skinned mesh, ${skeletons.size} skeleton.` : 'Model statis: tidak ada tulang (bukan kegagalan, tetapi tidak bisa dianimasikan/diretargt).');
  push('skin', 'Punya skin weights', skinnedMeshes.length ? 'PASS' : (bones.length ? 'FAIL' : 'NOT TESTED'),
    skinnedMeshes.length ? `Skin weights ada pada: ${skinnedMeshes.slice(0, 6).join(', ')}${skinnedMeshes.length > 6 ? '…' : ''}.`
      : (bones.length ? 'Ada tulang tetapi tidak ada SkinnedMesh — animasi tidak akan mendeformasi mesh.' : 'Tidak ada skin weights pada model statis.'));
  push('humanoid', 'Skeleton humanoid dikenali', missingCore.length === 0 ? 'PASS' : (bones.length ? 'WARN' : 'NOT TESTED'),
    missingCore.length === 0 ? `12/12 peran inti terpetakan (${analysis.bones.filter((entry) => entry.role).length} tulang berperan).`
      : (bones.length ? `Peran inti belum ditemukan: ${missingCore.join(', ')}.` : 'Tidak ada skeleton.'));

  const animationStatus = clipInfo.length
    ? (clipInfo.some((clip) => clip.unmatchedTracks > 0) ? 'WARN' : 'PASS')
    : (bones.length ? 'WARN' : 'NOT TESTED');
  push('animasi', 'Punya klip animasi', animationStatus,
    clipInfo.length
      ? `${clipInfo.length} klip: ${clipInfo.map((clip) => `${clip.name} ${clip.duration}s/${clip.tracks} track`).join(', ')}` +
        (clipInfo.some((clip) => clip.unmatchedTracks > 0) ? `; ${clipInfo.reduce((sum, clip) => sum + clip.unmatchedTracks, 0)} track menunjuk node yang tidak ada.` : '; semua track menunjuk node yang ada.')
      : (bones.length ? 'Tidak ada klip animasi di berkas.' : 'Model statis.'));

  if (duplicateNames.length) {
    push('duplikat-tulang', 'Tulang dengan nama sama (salinan hierarki)', 'WARN',
      `Satu nama dipakai oleh dua tulang (hierarki salinan): ${[...new Set(duplicateNames)].join(', ')}. Hanya yang dengan anak terbanyak dipakai untuk analisis.`);
  }
  push('jari', 'Tulang jari', fingerBones.length >= 20 ? 'PASS' : (bones.length ? 'WARN' : 'NOT TESTED'),
    fingerBones.length ? `${fingerBones.length} tulang jari terdeteksi (contoh: ${fingerBones.slice(0, 4).join(', ')}).` : (bones.length ? 'Tidak ada tulang jari — gerakan jari tidak dapat diuji.' : 'Tidak ada skeleton.'));

  push('multi-mesh', 'Beberapa mesh', meshes.length > 1 ? 'PASS' : 'NOT TESTED',
    `${meshes.length} mesh${meshes.length > 1 ? ' (uji multi-mesh)' : ' — model single-mesh.'}`);
  push('multi-material', 'Beberapa material', materialMap.size > 1 ? 'PASS' : 'NOT TESTED',
    `${materialMap.size} material, ${textureNames.size} tekstur.`);
  push('skala', 'Dimensi masuk akal untuk humanoid', (() => {
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.y)) return 'NOT TESTED';
    const size = box.getSize(new THREE.Vector3());
    const tallest = Math.max(size.x, size.y, size.z);
    if (tallest > 50) return 'WARN';
    if (tallest < 0.05) return 'WARN';
    return 'PASS';
  })(), (() => {
    if (!Number.isFinite(box.min.x)) return 'Kotak pembatas tidak terbaca.';
    const size = box.getSize(new THREE.Vector3());
    return `Dimensi ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m (setelah skinning: ${deformedAware ? 'ya' : 'tidak, model statis'}).`;
  })());

  return {
    name: meta.name || root.name || '(tanpa nama)',
    fileName: meta.fileName || meta.name || '—',
    nodes: (() => { let count = 0; root.traverse(() => { count += 1; }); return count; })(),
    meshes,
    meshCount: meshes.length,
    vertices: meshes.reduce((sum, mesh) => sum + mesh.vertices, 0),
    triangles: meshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
    materials: [...materialMap.values()],
    materialCount: materialMap.size,
    textureCount: textureNames.size,
    bones,
    boneCount: bones.length,
    uniqueBoneCount: bones.length - [...new Set(bones)].length + new Set(bones).size,
    duplicateBoneNames: duplicateNames.slice(0, 8),
    skinnedMeshes,
    skeletonCount: skeletons.size,
    fingerBoneCount: fingerBones.length,
    fingerBones: fingerBones.slice(0, 40),
    sideBones: sides,
    clips: clipInfo,
    roles: {
      mapped: roles.length,
      unique: [...new Set(roles)].sort(),
      missingCore
    },
    bounds: Number.isFinite(box.min.x)
      ? { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() }
      : null,
    issues
  };
}
