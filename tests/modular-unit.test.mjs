/**
 * UCF Tahap 4 — tes unit sistem modular karakter.
 * Menguji metadata, library, kompatibilitas, pasang/lepas berulang,
 * weights, deformasi setelah modul terpasang, dan serialisasi config.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildHumanoid } from '../src/humanoid/builder.js';
import { applyPose, measureDeformation } from '../src/humanoid/rig.js';
import {
  MODULE_FIELDS,
  MODULE_CATEGORIES,
  ATTACHMENT_TYPES,
  VALIDATION_STATUS,
  BODY_PROFILE_ID,
  SKELETON_ID,
  validateModuleManifest
} from '../src/modular/metadata.js';
import { BUILTIN_MODULES } from '../src/modular/library.js';
import { ModularManager, BASE_MODULE_ID } from '../src/modular/manager.js';

const BODY_MESHES = 53;
const BODY_BONES = 51;

function makeEntry(manager, id = 'unit-1') {
  const built = buildHumanoid({}, 'T');
  return {
    id,
    modelId: `model-${id}`,
    name: `Unit ${id}`,
    params: { ...built.params },
    pose: built.pose,
    content: built.content
  };
}

function meshCount(entry) {
  let count = 0;
  entry.content.userData.ucfRig.root.traverse((object) => {
    if (object.isMesh) count += 1;
  });
  return count;
}

function boneNames(entry) {
  return entry.content.userData.ucfRig.list.map((bone) => bone.name).sort();
}

function bodyVertexHash(entry) {
  let hash = 0;
  let n = 0;
  entry.content.userData.ucfRig.root.traverse((object) => {
    if (!object.isMesh || object.name.startsWith('ML_')) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.array.length; i += 1) {
      hash = (hash * 31 + Math.round(position.array[i] * 1e6)) % 1_000_000_007;
      n += 1;
    }
  });
  return `${hash}:${n}`;
}

function instanceOf(manager, entry, moduleId) {
  return manager.attached(entry).find((instance) => instance.moduleId === moduleId) || null;
}

test('metadata: 19 field, 8 kategori, 5 tipe attachment', () => {
  assert.equal(MODULE_FIELDS.length, 19);
  assert.equal(MODULE_CATEGORIES.length, 8);
  assert.equal(ATTACHMENT_TYPES.length, 5);
  for (const id of ['body', 'skin', 'face', 'hair', 'tops', 'bottoms', 'shoes', 'accessories']) {
    assert.ok(MODULE_CATEGORIES.some((category) => category.id === id), `kategori ${id} hilang`);
  }
  for (const id of ['base', 'skinned', 'bone', 'static', 'material']) {
    assert.ok(ATTACHMENT_TYPES.some((type) => type.id === id), `attachment ${id} hilang`);
  }
});

test('metadata: manifest tidak lengkap ditolak dengan alasan yang bisa dibaca', () => {
  const result = validateModuleManifest({ moduleId: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.module, null);
  assert.ok(result.errors.length >= 15, 'harus ada satu alasan per field yang hilang');
  assert.ok(result.errors.some((line) => line.includes('moduleName')));
  assert.ok(result.errors.some((line) => line.includes('requiredBones')));
});

test('metadata: setiap modul bawaan punya 19 field valid dan orientasi UCF', () => {
  assert.equal(BUILTIN_MODULES.length, 18);
  for (const module of BUILTIN_MODULES) {
    const result = validateModuleManifest({ ...module, imported: false });
    assert.equal(result.ok, true, `${module.moduleId}: ${result.errors.join(' ')}`);
    assert.equal(module.orientation, '+Y up, +Z forward');
    assert.ok(module.compatibleBodyProfiles.includes(BODY_PROFILE_ID));
    assert.equal(module.supportedSkeleton, SKELETON_ID);
    assert.ok(module.moduleVersion.length > 0);
  }
});

test('library: 17 modul non-base mencakup semua kategori yang diminta', () => {
  const manager = new ModularManager();
  const nonBase = [...manager.library.values()].filter((module) => module.moduleId !== BASE_MODULE_ID);
  assert.equal(nonBase.length, 17);
  assert.equal(manager.getModule(BASE_MODULE_ID)?.attachmentType, 'base');
  for (const category of ['skin', 'face', 'hair', 'tops', 'bottoms', 'shoes', 'accessories']) {
    assert.ok(nonBase.some((module) => module.category === category), `kategori ${category} tidak punya modul`);
  }
  const statuses = nonBase.map((module) => module.validationStatus);
  assert.equal(statuses.filter((status) => status === VALIDATION_STATUS.VALID).length, 16);
  assert.equal(statuses.filter((status) => status === VALIDATION_STATUS.NEEDS).length, 1);
  assert.equal(manager.getModule('wajah-dasar').validationStatus, VALIDATION_STATUS.NEEDS);
  assert.ok(manager.getModule('wajah-dasar').knownLimitations.some((line) => line.includes('Clipping')));
});

test('pasang & lepas: jumlah mesh kembali ke 53, tulang tetap 51', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  assert.equal(meshCount(entry), BODY_MESHES);
  const beforeBones = boneNames(entry);
  const beforeHash = bodyVertexHash(entry);

  const result = manager.attach(entry, 'kaos-lengan-pendek');
  assert.equal(result.ok, true, result.error);
  assert.ok(instanceOf(manager, entry, 'kaos-lengan-pendek'));
  const attachedCount = meshCount(entry);
  assert.ok(attachedCount > BODY_MESHES, 'mesh modul harus menambah scene');
  assert.deepEqual(boneNames(entry), beforeBones, 'tulang tidak boleh berubah');

  const detach = manager.detach(entry, result.instance.instanceId);
  assert.equal(detach.ok, true);
  assert.equal(meshCount(entry), BODY_MESHES);
  assert.deepEqual(boneNames(entry), beforeBones);
  assert.equal(bodyVertexHash(entry), beforeHash, 'verteks body tidak boleh berubah');
});

test('pasang-lepas 3 kali: jumlah mesh & tulang tidak bertambah liar', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const counts = [];
  const bones = [];
  for (let i = 0; i < 3; i += 1) {
    const result = manager.attach(entry, 'jaket-lengan-panjang');
    assert.equal(result.ok, true, result.error);
    counts.push(meshCount(entry));
    bones.push(entry.content.userData.ucfRig.stats.bones);
    const detach = manager.detach(entry, result.instance.instanceId);
    assert.equal(detach.ok, true);
    counts.push(meshCount(entry));
    bones.push(entry.content.userData.ucfRig.stats.bones);
  }
  assert.deepEqual(counts, [BODY_MESHES + counts[0] - BODY_MESHES, BODY_MESHES, BODY_MESHES + counts[0] - BODY_MESHES, BODY_MESHES, BODY_MESHES + counts[0] - BODY_MESHES, BODY_MESHES]);
  assert.ok(bones.every((value) => value === BODY_BONES));
  assert.equal(new Set(counts).size, 2, 'hanya dua nilai mesh: dengan modul dan tanpa modul');
});

test('modul skinned: weights menunjuk tulang rig dan berjumlah 1', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const rig = entry.content.userData.ucfRig;
  const names = new Set(rig.list.map((bone) => bone.name));
  const result = manager.attach(entry, 'kaos-lengan-pendek');
  assert.equal(result.ok, true, result.error);
  const skinned = result.instance.meshes.filter((mesh) => mesh.isSkinnedMesh);
  assert.ok(skinned.length > 0, 'kaos harus berupa skinned mesh');
  for (const mesh of skinned) {
    assert.equal(mesh.skeleton, rig.skeleton, 'mesh memakai skeleton body, bukan skeleton baru');
    const index = mesh.geometry.getAttribute('skinIndex');
    const weight = mesh.geometry.getAttribute('skinWeight');
    assert.ok(index && weight, 'skinIndex/skinWeight wajib ada');
    for (let i = 0; i < index.count; i += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        const w = weight.getComponent(i, k);
        if (w > 0) {
          const boneIndex = index.getComponent(i, k);
          assert.ok(rig.skeleton.bones[boneIndex], `bone index ${boneIndex} di luar skeleton`);
          assert.ok(names.has(rig.skeleton.bones[boneIndex].name));
        }
        sum += w;
      }
      assert.ok(Math.abs(sum - 1) < 1e-4, `weight verteks ${i} = ${sum}`);
    }
  }
});

test('deformasi sendi & jari tetap bekerja setelah modul terpasang', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const rig = entry.content.userData.ucfRig;
  const baselineArm = measureDeformation(rig, { boneName: 'LowerArm_R', axis: 'z', angleDeg: 60 });
  assert.equal(baselineArm.ok, true);

  for (const moduleId of ['jaket-lengan-panjang', 'celana-panjang', 'sepatu-boot', 'rambut-pendek', 'topi-fedora', 'sarung-tangan', 'tas-punggung']) {
    const result = manager.attach(entry, moduleId);
    assert.equal(result.ok, true, `${moduleId}: ${result.error}`);
  }
  const before = meshCount(entry);

  const arm = measureDeformation(rig, { boneName: 'LowerArm_R', axis: 'z', angleDeg: 60 });
  assert.equal(arm.ok, true);
  assert.ok(arm.maxDisplacement > 0.4, `lengan hanya bergerak ${arm.maxDisplacement} m`);
  assert.ok(arm.movedVertices > 1200, 'jaket ikut bergerak bersama lengan');
  assert.ok(arm.resetError < 1e-6, `pose bisa dikembalikan ke nol (galat ${arm.resetError})`);

  const finger = measureDeformation(rig, { boneName: 'Finger_Index_R_2', axis: 'z', angleDeg: 60 });
  assert.equal(finger.ok, true);
  assert.ok(finger.maxDisplacement > 0.02, `jari hanya bergerak ${finger.maxDisplacement} m`);
  assert.ok(finger.movedVertices > 50);

  const jacket = instanceOf(manager, entry, 'jaket-lengan-panjang');
  const sleeve = jacket.meshes.find((mesh) => mesh.isSkinnedMesh && /LowerSleeve_R/i.test(mesh.name));
  assert.ok(sleeve, 'mesh lengan jaket harus ditemukan');
  const skinIndex = sleeve.geometry.getAttribute('skinIndex');
  const skinWeight = sleeve.geometry.getAttribute('skinWeight');
  const boneIndex = rig.skeleton.bones.indexOf(rig.bones.get('LowerArm_R'));
  assert.ok(boneIndex >= 0);
  let tipped = -1;
  let best = 0;
  for (let i = 0; i < skinIndex.count; i += 1) {
    let w = 0;
    for (let k = 0; k < 4; k += 1) {
      if (skinIndex.getComponent(i, k) === boneIndex) w += skinWeight.getComponent(i, k);
    }
    if (w > best) { best = w; tipped = i; }
  }
  assert.ok(tipped >= 0 && best > 0.2, `lengan jaket harus berbobot pada LowerArm_R (maks ${best.toFixed(2)})`);

  applyPose(rig, 'T');
  rig.root.updateMatrixWorld(true);
  const bind = sleeve.getVertexPosition(tipped, new THREE.Vector3()).applyMatrix4(sleeve.matrixWorld);
  applyPose(rig, 'A');
  rig.root.updateMatrixWorld(true);
  const posed = sleeve.getVertexPosition(tipped, new THREE.Vector3()).applyMatrix4(sleeve.matrixWorld);
  assert.ok(bind.distanceTo(posed) > 0.05, `lengan jaket harus ikut pose A (bergerak ${bind.distanceTo(posed).toFixed(3)} m)`);
  assert.equal(meshCount(entry), before, 'pose tidak boleh mengubah jumlah mesh');
});

test('satu slot per kategori: jaket menggantikan kaos', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const tee = manager.attach(entry, 'kaos-lengan-pendek');
  assert.equal(tee.ok, true);
  const jacket = manager.attach(entry, 'jaket-lengan-panjang');
  assert.equal(jacket.ok, true, jacket.error);
  const tops = manager.attached(entry).filter((instance) => instance.category === 'tops');
  assert.equal(tops.length, 1);
  assert.equal(tops[0].moduleId, 'jaket-lengan-panjang');
  assert.equal(instanceOf(manager, entry, 'kaos-lengan-pendek'), null);
  assert.ok(jacket.replaced.includes('kaos-lengan-pendek'));
});

test('operasi instance: rename, visible, material, transform', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const result = manager.attach(entry, 'topi-fedora');
  assert.equal(result.ok, true, result.error);
  const id = result.instance.instanceId;
  const mesh = result.instance.meshes[0];
  const originalColor = mesh.material.color.getHex();

  assert.equal(manager.rename(entry, id, 'Fedora Hitam'), true);
  assert.equal(instanceOf(manager, entry, 'topi-fedora').name, 'Fedora Hitam');

  assert.equal(manager.setVisible(entry, id, false), true);
  assert.ok(result.instance.meshes.every((item) => item.visible === false));
  assert.equal(manager.setVisible(entry, id, true), true);
  assert.ok(result.instance.meshes.every((item) => item.visible === true));

  assert.equal(manager.setMaterial(entry, id, { color: '#112233' }), true);
  assert.equal(mesh.material.color.getHex(), 0x112233);
  assert.notEqual(mesh.material.color.getHex(), originalColor);

  const skinned = manager.attach(entry, 'kaos-lengan-pendek');
  assert.equal(skinned.ok, true, skinned.error);
  assert.equal(manager.setTransform(entry, skinned.instance.instanceId, { scale: 1.2 }), false, 'modul skinned tidak boleh diubah transformasinya');

  const staticAttach = manager.attach(entry, 'tas-punggung');
  assert.equal(staticAttach.ok, true, staticAttach.error);
  assert.equal(manager.setTransform(entry, staticAttach.instance.instanceId, { scale: 1.1, offset: [0, 0.01, 0] }), true);
  assert.equal(staticAttach.instance.transform.scale, 1.1);
  assert.deepEqual(staticAttach.instance.transform.offset, [0, 0.01, 0]);
});

test('serialisasi & restore: modul, nama, warna, visibilitas tetap', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const tee = manager.attach(entry, 'kaos-lengan-pendek');
  manager.attach(entry, 'celana-panjang');
  const topi = manager.attach(entry, 'topi-fedora');
  manager.rename(entry, topi.instance.instanceId, 'Topi Uji');
  manager.setMaterial(entry, topi.instance.instanceId, { color: '#445566' });
  manager.setVisible(entry, tee.instance.instanceId, false);

  const saved = manager.serialize(entry);
  assert.equal(saved.modules.length, 3);
  for (const item of saved.modules) {
    for (const field of ['instanceId', 'moduleId', 'name', 'category', 'attachmentType', 'visible', 'material', 'transform', 'validationStatus', 'metadata']) {
      assert.ok(field in item, `field config ${field} hilang`);
    }
  }
  const countBefore = meshCount(entry);

  const freshManager = new ModularManager();
  const freshEntry = makeEntry(freshManager, 'unit-2');
  const restored = freshManager.restore(freshEntry, JSON.parse(JSON.stringify(saved.modules)));
  assert.equal(restored.restored, 3);
  assert.equal(restored.warnings.length, 0);
  assert.equal(meshCount(freshEntry), countBefore);
  const topiRestored = instanceOf(freshManager, freshEntry, 'topi-fedora');
  assert.equal(topiRestored.name, 'Topi Uji');
  assert.equal(topiRestored.meshes[0].material.color.getHex(), 0x445566);
  assert.equal(instanceOf(freshManager, freshEntry, 'kaos-lengan-pendek').visible, false);
});

test('import manifest: ditolak bila generator tak dikenal, diterima sebagai NEEDS VALIDATION', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const base = {
    moduleId: 'uji-impor-01',
    moduleName: 'Uji Impor',
    moduleVersion: '1.0',
    category: 'tops',
    sourceFile: 'internal',
    sourceFormat: 'procedural',
    sourceLicense: 'UCF internal',
    scale: 1,
    orientation: '+Y up, +Z forward',
    attachmentType: 'skinned',
    attachmentPoint: 'Spine',
    bodyRegion: 'torso',
    supportedSkeleton: SKELETON_ID,
    requiredBones: ['Spine', 'Chest'],
    materialList: ['Kaos Modul'],
    textureList: [],
    compatibleBodyProfiles: [BODY_PROFILE_ID],
    validationStatus: VALIDATION_STATUS.VALID,
    knownLimitations: [],
    generator: 'top_tee'
  };

  const bad = manager.importManifest(entry, JSON.stringify({ ...base, generator: 'tidak_ada' }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.join(' ').includes('tidak didukung'));

  const wrongSkeleton = manager.importManifest(entry, JSON.stringify({ ...base, moduleId: 'uji-impor-02', supportedSkeleton: 'mixamo-65' }));
  assert.equal(wrongSkeleton.ok, true, 'manifest tetap diterima, penolakan terjadi saat validasi pasang');
  assert.equal(wrongSkeleton.attach.ok, false);
  assert.ok(wrongSkeleton.attach.error.includes('Skeleton'), wrongSkeleton.attach.error);
  assert.equal(meshCount(entry), BODY_MESHES, 'modul dengan skeleton salah tidak menyisakan mesh');

  const good = manager.importManifest(entry, JSON.stringify({ ...base, moduleId: 'uji-impor-03' }));
  assert.equal(good.ok, true, JSON.stringify(good.warnings || []));
  assert.equal(good.module.validationStatus, VALIDATION_STATUS.NEEDS);
  assert.equal(good.attach.ok, true, good.attach.error);
  assert.equal(instanceOf(manager, entry, 'uji-impor-03').compat.status, VALIDATION_STATUS.NEEDS, 'modul impor selalu NEEDS VALIDATION sampai diverifikasi manual');
});

test('modul ketat tetap ditolak bila tulang wajib tidak ada', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const manifest = {
    moduleId: 'uji-tulang-hilang',
    moduleName: 'Tulang Hilang',
    moduleVersion: '1.0',
    category: 'accessories',
    sourceFile: 'internal',
    sourceFormat: 'procedural',
    sourceLicense: 'UCF internal',
    scale: 1,
    orientation: '+Y up, +Z forward',
    attachmentType: 'bone',
    attachmentPoint: 'Tail_01',
    bodyRegion: 'punggung',
    supportedSkeleton: SKELETON_ID,
    requiredBones: ['Tail_01'],
    materialList: ['metal'],
    textureList: [],
    compatibleBodyProfiles: [BODY_PROFILE_ID],
    validationStatus: VALIDATION_STATUS.VALID,
    knownLimitations: [],
    generator: 'backpack'
  };
  const result = manager.importManifest(entry, JSON.stringify(manifest));
  assert.equal(result.ok, true);
  assert.equal(result.attach.ok, false);
  assert.ok(result.attach.error.includes('Tulang'));
  assert.equal(meshCount(entry), BODY_MESHES, 'modul yang ditolak tidak boleh menyisakan mesh');
});

test('base body tidak bisa dipasang ulang atau dilepas', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  const attach = manager.attach(entry, BASE_MODULE_ID);
  assert.equal(attach.ok, false);
  assert.ok(attach.error.includes('Base body'));
  assert.equal(manager.detach(entry, 'ml-1').ok, false);
});

test('ubah tinggi karakter: reattachAll mempertahankan modul dan tulang', () => {
  const manager = new ModularManager();
  const entry = makeEntry(manager);
  for (const moduleId of ['kaos-lengan-pendek', 'celana-panjang', 'sepatu-boot']) {
    assert.equal(manager.attach(entry, moduleId).ok, true);
  }
  const withModules = meshCount(entry);
  const rebuilt = buildHumanoid({ ...entry.params, height: 1.9 }, entry.pose);
  entry.params = { ...rebuilt.params };
  entry.content = rebuilt.content;
  const result = manager.reattachAll(entry);
  assert.equal(result.restored, 3);
  assert.equal(result.failed, 0);
  assert.equal(meshCount(entry), withModules);
  assert.equal(entry.content.userData.ucfRig.stats.bones, BODY_BONES);
  const measured = new THREE.Box3().setFromObject(entry.content.userData.ucfRig.root);
  assert.ok(measured.max.y - measured.min.y > 1.85);
});
