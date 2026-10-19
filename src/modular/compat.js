/**
 * UCF Tahap 4 — pemeriksaan kompatibilitas modul terhadap body + rig.
 *
 * Semua angka di sini diukur dari geometri/tulang yang benar-benar ada.
 * Tidak ada modul yang dinyatakan kompatibel hanya karena nama tulang sama.
 */
import * as THREE from 'three';
import {
  BODY_PROFILE_ID,
  ORIENTATION,
  COMPAT_STATUS,
  VALIDATION_STATUS,
  targetProfileForRig,
  validateModuleManifest
} from './metadata.js';

const REGION_BY_CATEGORY = {
  body: ['full body'],
  skin: ['seluruh kulit', 'kulit'],
  face: ['kepala'],
  hair: ['kepala'],
  tops: ['torso'],
  bottoms: ['kaki', 'pinggul'],
  shoes: ['telapak kaki', 'kaki'],
  accessories: ['kepala', 'pinggang', 'tangan', 'punggung', 'kepala & leher']
};

/**
 * Band proporsi per kategori + dimensi yang dibandingkan dengan area tubuh.
 * height = tinggi modul / tinggi area; width = lebar; max = sisi terbesar.
 */
const PROPORTION_RULE = {
  tops: { dimension: 'height', band: [0.55, 1.45] },
  bottoms: { dimension: 'height', band: [0.5, 1.6] },
  shoes: { dimension: 'width', band: [0.7, 2.6] },
  hair: { dimension: 'width', band: [0.6, 2.0] },
  face: { dimension: 'width', band: [0.3, 1.5] },
  accessories: { dimension: 'width', band: [0.3, 2.6] },
  skin: null,
  body: null
};

/** Mesh badan yang memang ditutup modul; tidak dihitung sebagai penetrasi. */
/**
 * Mesh badan yang memang ditutupi modul (mis. kepala di dalam topi).
 * Penetrasi ke mesh ini dilaporkan sebagai "area tertutup", bukan sebagai
 * kesalahan; penetrasi ke bagian lain tetap dihitung.
 */
function coveredMeshFilter(module) {
  const excluded = new Set();
  if (module.category === 'shoes') {
    excluded.add('Foot_Mesh_R');
    excluded.add('Foot_Mesh_L');
  }
  if (module.category === 'hair' || module.category === 'face') {
    excluded.add('Body_Head');
  }
  if (module.category === 'accessories') {
    if (/Head/i.test(module.attachmentPoint)) excluded.add('Body_Head');
    if (/Hand/i.test(module.attachmentPoint)) {
      excluded.add('Palm_R');
      excluded.add('Palm_L');
    }
  }
  return (mesh) => !excluded.has(mesh.name);
}

function regionMeshes(rig, category, attachmentPoint) {
  const wanted = new Set();
  if (category === 'tops' || category === 'body') wanted.add('Body_Torso');
  if (category === 'bottoms') {
    for (const side of ['R', 'L']) {
      wanted.add(`Leg_Thigh_${side}`);
      wanted.add(`Leg_Calf_${side}`);
    }
  }
  if (category === 'shoes') {
    for (const side of ['R', 'L']) wanted.add(`Foot_Mesh_${side}`);
  }
  if (category === 'face' || category === 'hair') wanted.add('Body_Head');
  if (category === 'accessories') {
    if (/Head/i.test(attachmentPoint)) wanted.add('Body_Head');
    else if (/Hips/i.test(attachmentPoint)) wanted.add('Body_Torso');
    else if (/Hand/i.test(attachmentPoint)) {
      for (const side of ['R', 'L']) wanted.add(`Palm_${side}`);
    } else wanted.add('Body_Torso');
  }
  if (category === 'skin') return [];
  if (!wanted.size) wanted.add('Body_Torso');

  const found = [];
  rig.root.traverse((object) => {
    if (object.isMesh && wanted.has(object.name)) found.push(object);
  });
  return found;
}

export function worldBoxOf(meshes, step = 1) {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    for (let index = 0; index < position.count; index += step) {
      mesh.getVertexPosition(index, point);
      point.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
    }
  }
  return box;
}

function boxVolume(box) {
  if (!box || box.isEmpty()) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, 0) * Math.max(size.y, 0) * Math.max(size.z, 0);
}

function boxGap(a, b) {
  if (!a || !b || a.isEmpty() || b.isEmpty()) return Infinity;
  const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0);
  const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0);
  const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0);
  return Math.hypot(dx, dy, dz);
}

function overlapVolume(a, b) {
  if (!a || !b || a.isEmpty() || b.isEmpty()) return 0;
  const box = a.clone().intersect(b);
  return box.isEmpty() ? 0 : boxVolume(box);
}

function check(id, label, status, detail, measured = {}) {
  return { id, label, status, detail, measured };
}

/** Bobot skin modul: jumlah verteks, verteks tanpa bobot, pengaruh maksimum, galat jumlah. */
export function measureModuleWeights(meshes, boneCount) {
  let vertices = 0;
  let unweighted = 0;
  let maxInfluences = 0;
  let maxSumError = 0;
  let outOfRange = 0;

  for (const mesh of meshes) {
    if (!mesh.isSkinnedMesh) continue;
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!skinIndex || !skinWeight) {
      unweighted += mesh.geometry.getAttribute('position')?.count || 0;
      continue;
    }
    for (let index = 0; index < skinWeight.count; index += 1) {
      let sum = 0;
      let influences = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = skinWeight.getComponent(index, slot);
        if (weight > 0) {
          influences += 1;
          const boneIndex = skinIndex.getComponent(index, slot);
          if (boneIndex < 0 || boneIndex >= boneCount) outOfRange += 1;
        }
        sum += weight;
      }
      vertices += 1;
      if (influences === 0) unweighted += 1;
      maxInfluences = Math.max(maxInfluences, influences);
      maxSumError = Math.max(maxSumError, Math.abs(1 - sum));
    }
  }

  return { vertices, unweighted, maxInfluences, maxSumError, outOfRange };
}

/**
 * Uji penetrasi: sampel verteks modul, tembak 6 arah, hitung paritas
 * perpotongan dengan mesh badan. Berat = rasio verteks yang berada di dalam badan.
 */
export function measurePenetration(moduleMeshes, bodyMeshes, { sampleLimit = 120, seed = 7 } = {}) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 3;
  // Raycast perlu mengenai sisi belakang juga agar paritas perpotongan benar.
  const sides = new Map();
  for (const mesh of bodyMeshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (!material || sides.has(material)) continue;
      sides.set(material, material.side);
      material.side = THREE.DoubleSide;
    }
  }
  const directions = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1)
  ];

  const points = [];
  const point = new THREE.Vector3();
  for (const mesh of moduleMeshes) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    const stride = Math.max(1, Math.floor(position.count / 40));
    for (let index = 0; index < position.count; index += stride) {
      mesh.getVertexPosition(index, point);
      point.applyMatrix4(mesh.matrixWorld);
      points.push(point.clone());
    }
  }

  if (!points.length) return { sampleSize: 0, inside: 0, ratio: 0, checkable: false };

  // sampel deterministik; verteks dihitung menembus hanya bila lebih dalam
  // dari `depthTolerance` dari permukaan badan (verteks di sambungan bisa
  // nyaris berimpit dengan permukaan dan tidak dihitung).
  const depthTolerance = 0.004;
  const stride = Math.max(1, Math.ceil(points.length / sampleLimit));
  let sampled = 0;
  let inside = 0;
  let seam = 0;
  for (let index = 0; index < points.length; index += stride) {
    const origin = points[index].clone();
    let odd = 0;
    let minHit = Infinity;
    for (const direction of directions) {
      raycaster.set(origin, direction);
      const hits = raycaster.intersectObjects(bodyMeshes, false);
      if (hits.length % 2 === 1) {
        odd += 1;
        minHit = Math.min(minHit, hits[0]?.distance ?? Infinity);
      }
    }
    sampled += 1;
    if (odd >= 4) {
      if (minHit > depthTolerance) inside += 1;
      else seam += 1;
    }
  }

  for (const [material, side] of sides) material.side = side;

  return {
    sampleSize: sampled,
    inside,
    seam,
    ratio: sampled ? inside / sampled : 0,
    checkable: true,
    depthTolerance,
    seed
  };
}

/**
 * @returns {{status: string, checks: object[], warnings: string[], errors: string[], measured: object}}
 */
export function checkModuleCompatibility({ module, rig, meshes, bodyMeshes, options = {} }) {
  const checks = [];
  const warnings = [];
  const errors = [];
  const target = targetProfileForRig(rig);
  const boneCount = rig.list.length;
  const boneNames = new Set(rig.list.map((bone) => bone.name));

  /* 1. metadata */
  const meta = validateModuleManifest({ ...module, imported: false });
  if (meta.ok) {
    checks.push(check('metadata', 'Metadata 19 field', 'PASS', 'Semua field wajib terbaca dan bertipe benar.', { fields: 19 }));
  } else {
    checks.push(check('metadata', 'Metadata 19 field', 'FAIL', meta.errors.join(' '), { errors: meta.errors }));
    errors.push(...meta.errors);
  }

  /* 2. profil tubuh */
  const profileOk = module.compatibleBodyProfiles.includes(BODY_PROFILE_ID);
  checks.push(
    check(
      'profil-tubuh',
      'Profil body kompatibel',
      profileOk ? 'PASS' : 'FAIL',
      profileOk
        ? `Modul menyatakan dukungan untuk ${BODY_PROFILE_ID}.`
        : `Modul hanya menyatakan profil ${module.compatibleBodyProfiles.join(', ') || '(kosong)'} — bukan ${BODY_PROFILE_ID}.`,
      { declared: module.compatibleBodyProfiles, target: BODY_PROFILE_ID }
    )
  );
  if (!profileOk) errors.push('Profil body tidak cocok.');

  /* 3. skeleton */
  const skeletonOk = module.supportedSkeleton === target.skeleton;
  checks.push(
    check(
      'skeleton',
      'Skeleton target',
      skeletonOk ? 'PASS' : 'FAIL',
      skeletonOk
        ? `Skeleton target ${target.skeleton} (${target.bones} tulang) sama dengan yang dinyatakan modul.`
        : `Modul meminta ${module.supportedSkeleton}, rig aktif ${target.skeleton}. Nama tulang yang mirip tidak dianggap kompatibel.`,
      { declared: module.supportedSkeleton, target: target.skeleton, bones: target.bones }
    )
  );
  if (!skeletonOk) errors.push('Skeleton modul berbeda dari skeleton karakter.');

  /* 4. tulang wajib */
  const missing = module.requiredBones.filter((name) => !boneNames.has(name));
  checks.push(
    check(
      'tulang',
      'Tulang wajib tersedia',
      missing.length ? 'FAIL' : 'PASS',
      missing.length ? `Tulang tidak ditemukan: ${missing.join(', ')}.` : `${module.requiredBones.length} tulang wajib ditemukan di rig.`,
      { required: module.requiredBones, missing }
    )
  );
  if (missing.length) errors.push(`Tulang modul tidak ada: ${missing.join(', ')}.`);

  /* 5. titik pasang */
  let attachOk = true;
  let attachDetail = '';
  if (module.attachmentType === 'bone') {
    const boneTargets = module.attachmentPoint.split('/').map((entry) => entry.trim()).filter((entry) => boneNames.has(entry));
    attachOk = boneTargets.length > 0;
    attachDetail = attachOk ? `Titik pasang tulang ditemukan: ${boneTargets.join(', ')}.` : `Tulang titik pasang "${module.attachmentPoint}" tidak ada.`;
  } else if (module.attachmentType === 'material') {
    attachOk = meshes.materialTargets?.length > 0;
    attachDetail = attachOk
      ? `Material target ditemukan pada ${meshes.materialTargets.length} mesh badan.`
      : 'Material target tidak ditemukan pada badan.';
  } else if (module.attachmentType === 'static') {
    attachOk = Boolean(options.staticAnchor);
    attachDetail = attachOk ? 'Titik statis dihitung dari proporsi tubuh.' : 'Titik statis tidak dapat dihitung.';
  } else {
    attachOk = true;
    attachDetail = 'Modul base/skinned memakai ruang bind rig.';
  }
  checks.push(check('titik-pasang', 'Titik pemasangan', attachOk ? 'PASS' : 'FAIL', attachDetail, { attachmentType: module.attachmentType }));
  if (!attachOk) errors.push(attachDetail);

  /* 6. area tubuh */
  const allowed = REGION_BY_CATEGORY[module.category] || [];
  const regionOk = allowed.some((entry) => module.bodyRegion.toLowerCase().includes(entry));
  checks.push(
    check(
      'area-tubuh',
      'Kesesuaian area tubuh',
      regionOk ? 'PASS' : 'FAIL',
      regionOk ? `Area "${module.bodyRegion}" sesuai kategori ${module.category}.` : `Area "${module.bodyRegion}" tidak sesuai kategori ${module.category}.`,
      { bodyRegion: module.bodyRegion, allowed }
    )
  );
  if (!regionOk) errors.push('Area tubuh tidak sesuai kategori.');

  /* 7. skala & proporsi (diukur) */
  const region = regionMeshes(rig, module.category, module.attachmentPoint);
  const moduleBox = worldBoxOf(meshes.all || [], 1);
  const regionBox = worldBoxOf(region, 1);
  const moduleSize = moduleBox.isEmpty() ? new THREE.Vector3() : moduleBox.getSize(new THREE.Vector3());
  const regionSize = regionBox.isEmpty() ? new THREE.Vector3() : regionBox.getSize(new THREE.Vector3());

  if (module.dimensionless || !meshes.all?.length) {
    checks.push(check('skala', 'Skala terukur', 'PASS', 'Modul tanpa geometri (material swap) — skala tidak berlaku.', {}));
    checks.push(check('proporsi', 'Proporsi terhadap tubuh', 'PASS', 'Modul tanpa geometri (material swap) — proporsi tidak berlaku.', {}));
  } else {
    const ratioHeight = regionSize.y > 1e-6 ? moduleSize.y / regionSize.y : 0;
    const ratioWidth = regionSize.x > 1e-6 ? moduleSize.x / regionSize.x : 0;

    /* skala: dibandingkan dengan ukuran tubuh keseluruhan (deteksi salah satuan) */
    const bodyMeshesAll = [];
    rig.root.traverse((object) => {
      if (object.isMesh && !object.name.startsWith('ML_')) bodyMeshesAll.push(object);
    });
    const bodyBox = worldBoxOf(bodyMeshesAll, 3);
    const bodySize = bodyBox.isEmpty() ? new THREE.Vector3() : bodyBox.getSize(new THREE.Vector3());
    const moduleMax = Math.max(moduleSize.x, moduleSize.y, moduleSize.z);
    const bodyMax = Math.max(bodySize.x, bodySize.y, bodySize.z);
    const scaleRatio = bodyMax > 1e-6 ? moduleMax / bodyMax : 0;
    const scaleOk = scaleRatio >= 0.02 && scaleRatio <= 1.6;
    checks.push(
      check(
        'skala',
        'Skala terukur (modul vs tubuh)',
        scaleOk ? 'PASS' : 'FAIL',
        scaleOk
          ? `Sisi terbesar modul ${(moduleMax * 100).toFixed(1)} cm = ${scaleRatio.toFixed(2)}× sisi terbesar tubuh.`
          : `Sisi terbesar modul ${(moduleMax * 100).toFixed(1)} cm = ${scaleRatio.toFixed(2)}× tubuh — kemungkinan salah satuan.`,
        { scaleRatio, moduleMax, bodyMax, moduleSize: moduleSize.toArray(), regionSize: regionSize.toArray() }
      )
    );
    if (!scaleOk) errors.push('Skala modul tidak wajar terhadap tubuh.');

    const rule = PROPORTION_RULE[module.category] || { dimension: 'height', band: [0.2, 3.0] };
    const ratio = rule.dimension === 'height' ? ratioHeight : rule.dimension === 'width' ? ratioWidth : Math.max(ratioHeight, ratioWidth);
    const inBand = ratio >= rule.band[0] && ratio <= rule.band[1];
    checks.push(
      check(
        'proporsi',
        'Proporsi terhadap tubuh',
        inBand ? 'PASS' : 'WARN',
        inBand
          ? `Rasio ${rule.dimension} ${ratio.toFixed(2)}× terhadap area tubuh (band ${rule.band[0]}–${rule.band[1]}).`
          : `Rasio ${rule.dimension} ${ratio.toFixed(2)}× di luar band ${rule.band[0]}–${rule.band[1]} untuk kategori ${module.category}.`,
        { dimension: rule.dimension, ratio, band: rule.band, moduleHeight: moduleSize.y }
      )
    );
    if (!inBand) warnings.push('Proporsi modul di luar rentang yang diharapkan.');

    /* 8. posisi: tumpang tindih atau jarak sangat dekat dengan area tubuh */
    const overlap = overlapVolume(moduleBox, regionBox);
    const moduleVolume = boxVolume(moduleBox);
    const overlapRatio = moduleVolume > 0 ? overlap / moduleVolume : 0;
    const gap = boxGap(moduleBox, regionBox);
    const positionOk = overlapRatio >= 0.2 || gap <= 0.06;
    checks.push(
      check(
        'posisi',
        'Posisi & transformasi',
        positionOk ? 'PASS' : 'FAIL',
        positionOk
          ? `${(overlapRatio * 100).toFixed(0)}% volume modul berada di area tubuh target (jarak ${(gap * 100).toFixed(1)} cm).`
          : `Hanya ${(overlapRatio * 100).toFixed(0)}% volume modul berada di area tubuh target (jarak ${(gap * 100).toFixed(1)} cm).`,
        { overlapRatio, gap }
      )
    );
    if (!positionOk) errors.push('Modul tidak berada pada area tubuh target.');
  }

  /* 9. orientasi */
  const determinant = meshes.root ? new THREE.Matrix4().copy(meshes.root.matrixWorld).determinant() : 1;
  const orientationOk = module.orientation === ORIENTATION && determinant > 0;
  checks.push(
    check(
      'orientasi',
      'Orientasi',
      orientationOk ? 'PASS' : 'WARN',
      orientationOk
        ? `Orientasi "${module.orientation}" dan determinan matriks modul ${determinant.toFixed(3)} (tidak bercermin).`
        : `Orientasi "${module.orientation}" berbeda dari "${ORIENTATION}" atau matriks bercermin (det ${determinant.toFixed(3)}).`,
      { declared: module.orientation, determinant }
    )
  );
  if (!orientationOk) warnings.push('Orientasi modul perlu validasi manual.');

  /* 10. skin weights */
  const weights = measureModuleWeights(meshes.skinned || [], boneCount);
  if ((meshes.skinned || []).length) {
    const weightsOk = weights.unweighted === 0 && weights.maxInfluences <= 4 && weights.maxSumError < 1e-4 && weights.outOfRange === 0;
    checks.push(
      check(
        'weights',
        'Skin indices & weights',
        weightsOk ? 'PASS' : 'FAIL',
        weightsOk
          ? `${weights.vertices} verteks, 0 tanpa bobot, maks ${weights.maxInfluences} pengaruh, galat ${weights.maxSumError.toExponential(2)}.`
          : `Tanpa bobot ${weights.unweighted}, pengaruh ${weights.maxInfluences}, galat ${weights.maxSumError.toExponential(2)}, indeks luar rentang ${weights.outOfRange}.`,
        weights
      )
    );
    if (!weightsOk) errors.push('Skin weights modul tidak valid.');
  } else {
    checks.push(
      check(
        'weights',
        'Skin indices & weights',
        'PASS',
        'Modul tidak memakai skinning (bone/static/material) — bobot tidak berlaku.',
        weights
      )
    );
  }

  /* 11. material & tekstur */
  const materialNames = new Set();
  for (const mesh of meshes.all || []) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) if (material?.name) materialNames.add(material.name);
  }
  if (module.attachmentType === 'material') {
    for (const material of meshes.materialTargets || []) {
      if (material?.name) materialNames.add(material.name);
    }
  }
  const declaredMaterials = module.materialList || [];
  const missingMaterials = declaredMaterials.filter((name) => !materialNames.has(name));
  const texturesOk = (module.textureList || []).length === 0;
  const materialOk = declaredMaterials.length > 0 && missingMaterials.length === 0;
  checks.push(
    check(
      'material',
      'Material & tekstur',
      materialOk ? 'PASS' : 'FAIL',
      materialOk
        ? `${declaredMaterials.length} material terbaca; ${module.textureList.length} tekstur (${texturesOk ? 'prosedural, tanpa berkas eksternal' : 'berkas eksternal belum diverifikasi'}).`
        : `Material tidak ditemukan: ${missingMaterials.join(', ') || '(daftar kosong)'}.`,
      { declared: declaredMaterials, found: [...materialNames], missing: missingMaterials, textures: module.textureList }
    )
  );
  if (!materialOk) errors.push('Material modul tidak lengkap.');
  if (!texturesOk) warnings.push('Modul menyebut tekstur eksternal yang belum diverifikasi.');

  /* 12. clipping / penetrasi */
  if (!module.dimensionless && !(meshes.all || []).length) {
    checks.push(check('clipping', 'Clipping & penetrasi', 'PASS', 'Modul tanpa geometri (material swap) — penetrasi tidak berlaku.', {}));
  } else if (meshes.clipCheck === false) {
    checks.push(check('clipping', 'Clipping & penetrasi', 'UNKNOWN', 'Pemeriksaan clipping dilewati untuk modul ini (bagian sengaja tertanam).', {}));
  } else {
    const filteredBody = bodyMeshes.filter(coveredMeshFilter(module));
    const penetration = measurePenetration(meshes.all || [], filteredBody);
    const coveredOverlap = filteredBody.length === bodyMeshes.length
      ? null
      : measurePenetration(meshes.all || [], bodyMeshes);
    if (!penetration.checkable) {
      checks.push(check('clipping', 'Clipping & penetrasi', 'UNKNOWN', 'Tidak ada verteks modul untuk diuji.', penetration));
    } else {
      const ratio = penetration.ratio;
      const status = ratio <= 0.02 ? 'PASS' : ratio <= 0.2 ? 'WARN' : 'FAIL';
      checks.push(
        check(
          'clipping',
          'Clipping & penetrasi',
          status,
          status === 'PASS'
            ? `Diuji terhadap bagian tubuh yang tidak ditutup modul: ${penetration.inside}/${penetration.sampleSize} verteks di dalam badan.`
            : `${penetration.inside}/${penetration.sampleSize} verteks sampel berada di dalam badan di luar area tertutup (${(ratio * 100).toFixed(1)}%).`,
          { ...penetration, coveredRatio: coveredOverlap ? coveredOverlap.ratio : null }
        )
      );
      if (status !== 'PASS') warnings.push('Modul menembus badan — periksa ukuran/offset.');
      if (status === 'FAIL') errors.push('Modul menembus badan.');
    }
  }

  const hasFail = checks.some((entry) => entry.status === 'FAIL');
  const hasWarn = checks.some((entry) => entry.status === 'WARN');
  const hasUnknown = checks.some((entry) => entry.status === 'UNKNOWN');
  let status = COMPAT_STATUS.VALID;
  if (hasFail) status = COMPAT_STATUS.INCOMPATIBLE;
  else if (hasWarn || hasUnknown || module.validationStatus !== VALIDATION_STATUS.VALID) status = COMPAT_STATUS.NEEDS;

  return {
    status,
    checks,
    warnings,
    errors,
    measured: {
      bones: target.bones,
      moduleSize: moduleSize.toArray(),
      regionSize: regionSize.toArray(),
      weights,
      penetration: checks.find((entry) => entry.id === 'clipping')?.measured || null
    }
  };
}
