/**
 * UCF Tahap 1 — tes unit fungsi murni (node:test, tanpa browser).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  detectFormat,
  humanBytes,
  readGltfJson,
  classifyExtensions,
  describeExtensions,
  formatNumber,
  KNOWN_SUPPORTED_EXTENSIONS
} from '../src/format.js';
import {
  fitDistance,
  frameDistance,
  boxCorners,
  viewPlacement,
  directionErrorDegrees,
  cameraDistance,
  VIEW_PRESETS,
  VIEW_ORDER
} from '../src/camera.js';
import { summarize } from '../src/stats.js';
import { nodeType, nodeTypeLabel, nodeDisplayName, countNodes, objectDetails } from '../src/hierarchy.js';
import { ValidationLog, RESULT, summaryLabel } from '../src/validation.js';

/* ---------------------------------------------------------------- */
/* format                                                            */
/* ---------------------------------------------------------------- */

test('detectFormat menerima glb/gltf dan menolak format lain', () => {
  assert.equal(detectFormat('model.glb'), 'glb');
  assert.equal(detectFormat('MODEL.GLTF'), 'gltf');
  assert.equal(detectFormat('char.v1.gltf?token=1'), 'gltf');
  assert.equal(detectFormat('model.fbx'), null);
  assert.equal(detectFormat('model.vrm'), null);
  assert.equal(detectFormat('tanpaekstensi'), null);
  assert.equal(detectFormat(null), null);
});

test('humanBytes memformat ukuran secara wajar', () => {
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(2048), '2.0 KB');
  assert.equal(humanBytes(5 * 1024 * 1024), '5.00 MB');
  assert.equal(humanBytes(-1), '—');
});

test('formatNumber memakai pemisah ribuan Indonesia', () => {
  assert.equal(formatNumber(49112), '49.112');
  assert.equal(formatNumber(NaN), '—');
});

function makeGlb(jsonObject) {
  const jsonText = JSON.stringify(jsonObject);
  const enc = new TextEncoder().encode(jsonText);
  const pad = (4 - (enc.length % 4)) % 4;
  const chunkLength = enc.length + pad;
  const buffer = new ArrayBuffer(12 + 8 + chunkLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, chunkLength, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  new Uint8Array(buffer, 20, enc.length).set(enc);
  for (let i = 0; i < pad; i += 1) view.setUint8(20 + enc.length + i, 0x20);
  return buffer;
}

test('readGltfJson membaca JSON dari chunk GLB dan teks .gltf', () => {
  const glb = makeGlb({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] });
  const parsed = readGltfJson(glb);
  assert.equal(parsed.asset.version, '2.0');
  assert.equal(parsed.scenes.length, 1);

  const text = new TextEncoder().encode('{"asset":{"version":"2.0"},"nodes":[]}');
  const fromText = readGltfJson(text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength));
  assert.equal(fromText.asset.version, '2.0');

  assert.equal(readGltfJson(new ArrayBuffer(8)), null);
  const broken = new TextEncoder().encode('bukan json');
  assert.equal(readGltfJson(broken.buffer.slice(broken.byteOffset, broken.byteOffset + broken.byteLength)), null);
});

test('classifyExtensions menandai ekstensi yang tidak didukung', () => {
  const result = classifyExtensions({
    extensionsUsed: ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'KHR_lights_punctual', 'VENDOR_baru'],
    extensionsRequired: ['KHR_draco_mesh_compression']
  });
  assert.deepEqual(result.requiredUnsupported, ['KHR_draco_mesh_compression']);
  assert.equal(result.unsupported.length, 2);
  assert.ok(result.unsupported.every((item) => typeof item.reason === 'string' && item.reason.length > 5));
  assert.deepEqual(result.unverified, ['VENDOR_baru']);
  assert.deepEqual(result.supported, ['KHR_lights_punctual']);
  assert.match(describeExtensions(result), /tidak didukung/);
});

test('meshopt dianggap didukung (dekoder resmi three.js)', () => {
  assert.ok(KNOWN_SUPPORTED_EXTENSIONS.includes('EXT_meshopt_compression'));
  const result = classifyExtensions({
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression']
  });
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.requiredUnsupported.length, 0);
});

test('classifyExtensions mendeteksi resource eksternal', () => {
  const result = classifyExtensions({
    buffers: [{ uri: 'scene.bin' }],
    images: [{ uri: 'data:image/png;base64,AAAA' }, { uri: 'tex/albedo.png' }]
  });
  assert.equal(result.externalResources.length, 2);
  assert.equal(result.externalResources[0].kind, 'buffer');
  assert.equal(result.externalResources[1].kind, 'image');
});

/* ---------------------------------------------------------------- */
/* kamera                                                            */
/* ---------------------------------------------------------------- */

test('fitDistance tumbuh linear terhadap radius dan lebih besar pada aspect sempit', () => {
  const square = fitDistance(1, 45, 1, 1);
  assert.ok(Math.abs(square - 1 / Math.sin(THREE.MathUtils.degToRad(22.5))) < 1e-9);
  assert.ok(fitDistance(2, 45, 1, 1) > fitDistance(1, 45, 1, 1));
  assert.ok(fitDistance(1, 45, 0.5, 1) > fitDistance(1, 45, 1, 1));
  assert.ok(fitDistance(1, 45, 1, 1.2) > square);
});

test('frameDistance pada kotak setara lebih ketat daripada bola pembatas', () => {
  const box = new THREE.Box3(new THREE.Vector3(-0.2, 0, -0.15), new THREE.Vector3(0.2, 0.9, 0.15));
  const corners = boxCorners(box);
  const center = box.getCenter(new THREE.Vector3()).toArray();
  const sphereRadius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const boxed = frameDistance(corners, center, 45, 1, 'depan', 1);
  const sphere = fitDistance(sphereRadius, 45, 1, 1);
  assert.ok(boxed < sphere, `frame box ${boxed} harus < sphere ${sphere}`);
  assert.ok(boxed > 0.4);
});

test('viewPlacement menaruh kamera tepat pada arah preset', () => {
  const center = [0, 1, 0];
  for (const view of VIEW_ORDER) {
    const placement = viewPlacement({ center, radius: 1, fovDeg: 45, aspect: 1, view });
    const error = directionErrorDegrees(placement.position.clone().sub(placement.target).toArray(), view);
    assert.ok(error < 1e-6, `${view} galat ${error}`);
    assert.ok(Math.abs(cameraDistance(placement.position, placement.target) - placement.distance) < 1e-9);
    assert.deepEqual(placement.target.toArray(), center);
  }
  assert.equal(Object.keys(VIEW_PRESETS).length, 6);
});

test('directionErrorDegrees menghitung sudut dengan benar', () => {
  assert.ok(directionErrorDegrees([0, 0, 1], 'depan') < 1e-9);
  assert.ok(Math.abs(directionErrorDegrees([0, 0, -1], 'depan') - 180) < 1e-6);
  assert.ok(Math.abs(directionErrorDegrees([1, 0, 0], 'kanan')) < 1e-9);
});

test('boxCorners menghasilkan 8 sudut unik', () => {
  const corners = boxCorners({ min: [-1, 0, -2], max: [1, 3, 2] });
  assert.equal(corners.length, 8);
  assert.equal(new Set(corners.map((corner) => corner.join(','))).size, 8);
});

/* ---------------------------------------------------------------- */
/* statistik scene                                                   */
/* ---------------------------------------------------------------- */

function makeSkinnedFixture() {
  const material = new THREE.MeshStandardMaterial({ name: 'Kulit' });
  material.map = new THREE.Texture();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setIndex([0, 1, 2]);

  const root = new THREE.Group();
  root.name = 'Akar';
  const boneA = new THREE.Bone();
  boneA.name = 'Root';
  const boneB = new THREE.Bone();
  boneB.name = 'Anak';
  boneB.position.y = 1;
  boneA.add(boneB);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'Tubuh';
  mesh.add(boneA);
  mesh.bind(new THREE.Skeleton([boneA, boneB]));
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

test('summarize menghitung mesh, skeleton, tulang, material, tekstur, segitiga', () => {
  const { root } = makeSkinnedFixture();
  const stats = summarize(root, { clips: [{ name: 'idle' }, { name: 'walk' }] });
  assert.equal(stats.nodes, 4); // root + mesh + 2 tulang
  assert.equal(stats.meshes, 1);
  assert.equal(stats.skinnedMeshes, 1);
  assert.equal(stats.skeletons, 1);
  assert.equal(stats.bones, 2);
  assert.equal(stats.materials, 1);
  assert.equal(stats.textures, 1);
  assert.equal(stats.vertices, 3);
  assert.equal(stats.triangles, 1);
  assert.equal(stats.clips, 2);
  assert.deepEqual(stats.clipNames, ['idle', 'walk']);
  assert.ok(stats.size[1] >= 1);
});

test('summarize mencatat morph target bila ada', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geometry.morphAttributes.position = [geometry.getAttribute('position').clone()];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const stats = summarize(mesh);
  assert.equal(stats.morphTargets, 1);
  assert.equal(stats.morphMeshes, 1);
});

/* ---------------------------------------------------------------- */
/* hierarki                                                          */
/* ---------------------------------------------------------------- */

test('nodeType & label membedakan mesh, skinned, tulang, grup', () => {
  const { root, mesh } = makeSkinnedFixture();
  assert.equal(nodeType(root), 'group');
  assert.equal(nodeType(mesh), 'skinned');
  assert.equal(nodeType(mesh.children[0]), 'bone');
  assert.equal(nodeType(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())), 'mesh');
  assert.equal(nodeTypeLabel(mesh), 'Skinned mesh');
  assert.equal(nodeTypeLabel(mesh.children[0]), 'Tulang');
  assert.equal(countNodes(root), 4);
  assert.equal(nodeDisplayName({ name: '  ', isMesh: true }), '(Mesh tanpa nama)');
});

test('objectDetails mengembalikan info mesh & subtree tulang', () => {
  const { root, mesh } = makeSkinnedFixture();
  const details = objectDetails(mesh);
  assert.equal(details.type, 'skinned');
  assert.equal(details.vertices, 3);
  assert.equal(details.triangles, 1);
  assert.equal(details.skinned, true);
  assert.equal(details.skeletonBones, 2);
  assert.equal(details.boneCount, 2);
  assert.deepEqual(details.materials, ['Kulit']);
  const rootDetails = objectDetails(root);
  assert.equal(rootDetails.childCount, 1);
  assert.equal(rootDetails.boneCount, 2);
});

/* ---------------------------------------------------------------- */
/* validasi                                                          */
/* ---------------------------------------------------------------- */

test('ValidationLog menyimpan hasil, alasan, dan tidak menyamakan NOT TESTED dengan PASS', () => {
  const clock = () => new Date('2026-10-19T03:00:00.000Z');
  const log = new ValidationLog({ clock });
  log.add({ group: 'A. Impor', test: 'Impor GLB', model: 'a.glb', result: RESULT.PASS, details: { mesh: 2 } });
  log.add({ group: 'F. Regresi', test: 'Android fisik', result: RESULT.NOT_TESTED, details: { alasan: 'tidak ada perangkat' } });
  log.add({ group: 'A. Impor', test: 'Impor rusak', result: RESULT.FAIL, errors: ['JSON tidak valid'] });

  const summary = log.summary();
  assert.equal(summary.PASS, 1);
  assert.equal(summary['NOT TESTED'], 1);
  assert.equal(summary.FAIL, 1);
  assert.equal(summary.total, 3);
  assert.equal(summaryLabel(summary), 'PASS 1 · FAIL 1');

  const json = log.toJSON({ browser: 'chromium' });
  assert.equal(json.format, 'ucf-validation-log');
  assert.equal(json.stage, 1);
  assert.equal(json.environment.browser, 'chromium');
  assert.equal(json.records[0].at, '2026-10-19T03:00:00.000Z');
  assert.equal(json.records[2].errors[0], 'JSON tidak valid');
  assert.equal(log.has('Impor GLB'), true);
  assert.equal(log.has('Tidak ada'), false);

  const forced = log.add({ test: 'Hasil aneh', result: 'LULUS' });
  assert.equal(forced.result, RESULT.NOT_TESTED);
  assert.throws(() => log.add({ result: RESULT.PASS }), /Nama tes wajib/);
});
