/**
 * UCF Tahap 3 — tes unit skeleton, skin weights, dan deformasi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildHumanoid, measureHumanoid } from '../src/humanoid/builder.js';
import { measureDeformation, applyPose, candidateBonesForMesh } from '../src/humanoid/rig.js';

const DEFAULTS = {};

function build(params = {}, pose = 'T') {
  return buildHumanoid(params, pose);
}

function skinnedMeshes(content) {
  const meshes = [];
  content.traverse((object) => { if (object.isSkinnedMesh) meshes.push(object); });
  return meshes;
}

test('rig: 51 tulang dengan rantai tubuh, lengan, kaki, dan jari lengkap', () => {
  const { rig } = build();
  assert.equal(rig.stats.bones, 51);
  assert.equal(rig.list.length, 51);

  const parent = (name) => rig.bones.get(name)?.parent?.name || null;
  assert.equal(parent('Hips'), 'Root');
  assert.equal(parent('Spine'), 'Hips');
  assert.equal(parent('Chest'), 'Spine');
  assert.equal(parent('Neck'), 'Chest');
  assert.equal(parent('Head'), 'Neck');
  assert.equal(parent('HeadTop'), 'Head');

  for (const side of ['R', 'L']) {
    assert.equal(parent(`Clavicle_${side}`), 'Chest');
    assert.equal(parent(`UpperArm_${side}`), `Clavicle_${side}`);
    assert.equal(parent(`LowerArm_${side}`), `UpperArm_${side}`);
    assert.equal(parent(`Hand_${side}`), `LowerArm_${side}`);
    assert.equal(parent(`UpperLeg_${side}`), 'Hips');
    assert.equal(parent(`LowerLeg_${side}`), `UpperLeg_${side}`);
    assert.equal(parent(`Foot_${side}`), `LowerLeg_${side}`);
    assert.equal(parent(`Toe_${side}`), `Foot_${side}`);

    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      assert.equal(parent(`Finger_${finger}_${side}_1`), `Hand_${side}`);
      assert.equal(parent(`Finger_${finger}_${side}_2`), `Finger_${finger}_${side}_1`);
      assert.equal(parent(`Finger_${finger}_${side}_3`), `Finger_${finger}_${side}_2`);
    }
    assert.equal(parent(`Thumb_${side}_1`), `Hand_${side}`);
    assert.equal(parent(`Thumb_${side}_2`), `Thumb_${side}_1`);
  }

  // 28 tulang jari (4 jari x 3 ruas + ibu jari 2 ruas, dua tangan)
  const fingerBones = rig.list.filter((bone) => /^(Finger|Thumb)_/.test(bone.name));
  assert.equal(fingerBones.length, 28);
});

test('rig: setiap mesh ber-skin dan setiap verteks punya bobot normal', () => {
  const { content, rig } = build();
  const meshes = skinnedMeshes(content);
  assert.equal(meshes.length, 53);
  assert.equal(rig.stats.skinnedMeshes, 53);
  assert.equal(rig.stats.vertices, 4652);

  let checked = 0;
  for (const mesh of meshes) {
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    assert.ok(skinIndex && skinWeight, `${mesh.name} tanpa atribut skin`);
    assert.equal(skinIndex.itemSize, 4);
    assert.equal(skinWeight.itemSize, 4);

    for (let i = 0; i < skinIndex.count; i += 1) {
      let sum = 0;
      let influences = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = skinWeight.getComponent(i, slot);
        sum += weight;
        if (weight > 0) {
          influences += 1;
          const boneIndex = skinIndex.getComponent(i, slot);
          assert.ok(boneIndex >= 0 && boneIndex < rig.list.length, `indeks tulang ${boneIndex} di luar rentang`);
        }
      }
      assert.ok(influences >= 1, `${mesh.name} verteks ${i} tanpa bobot`);
      assert.ok(influences <= 4, `${mesh.name} verteks ${i} punya ${influences} pengaruh`);
      assert.ok(Math.abs(sum - 1) < 1e-5, `${mesh.name} verteks ${i} jumlah bobot ${sum}`);
      checked += 1;
    }
  }
  assert.equal(checked, 4652);
  assert.equal(rig.stats.unweighted, 0);
  assert.ok(rig.stats.maxInfluences <= 4);
});

test('rig: bobot dibatasi ke rantai tulang yang benar (tidak bocor antar anggota)', () => {
  assert.deepEqual(candidateBonesForMesh('Arm_Upper_R'), ['UpperArm_R', 'LowerArm_R']);
  assert.deepEqual(candidateBonesForMesh('Palm_L'), ['Hand_L']);
  assert.deepEqual(candidateBonesForMesh('Foot_Mesh_R'), ['Foot_R', 'Toe_R']);
  assert.deepEqual(candidateBonesForMesh('Body_Head'), ['Head']);
  assert.deepEqual(candidateBonesForMesh('Finger_Index_R_2'), ['Finger_Index_R_1', 'Finger_Index_R_2', 'Finger_Index_R_3']);

  const { content, rig } = build();
  const head = skinnedMeshes(content).find((mesh) => mesh.name === 'Body_Head');
  const headIndex = rig.list.findIndex((bone) => bone.name === 'Head');
  const skinIndex = head.geometry.getAttribute('skinIndex');
  const skinWeight = head.geometry.getAttribute('skinWeight');
  for (let i = 0; i < skinIndex.count; i += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      if (skinWeight.getComponent(i, slot) > 0) {
        assert.equal(skinIndex.getComponent(i, slot), headIndex, 'kepala hanya boleh terikat ke tulang Head');
      }
    }
  }
});

test('deformasi: memutar LowerArm_R menggerakkan tangan, kepala tetap, reset sempurna', () => {
  const { rig } = build();
  const result = measureDeformation(rig, { boneName: 'LowerArm_R', axis: 'z', angleDeg: 60 });
  assert.equal(result.ok, true);
  assert.ok(result.maxDisplacement > 0.05, `perpindahan hanya ${result.maxDisplacement}`);
  assert.ok(result.movedVertices > 100, `hanya ${result.movedVertices} verteks bergerak`);
  assert.ok(result.headDisplacement < 0.001, `kepala ikut bergerak ${result.headDisplacement}`);
  assert.ok(result.resetError < 1e-6, `galat reset ${result.resetError}`);
});

test('deformasi: jari menekuk sendiri tanpa menggeser telapak atau lengan', () => {
  const { rig } = build();
  const result = measureDeformation(rig, { boneName: 'Finger_Index_R_2', axis: 'z', angleDeg: 60 });
  assert.equal(result.ok, true);
  assert.ok(result.maxDisplacement > 0.005, `jari tidak bergerak (${result.maxDisplacement})`);
  assert.ok(result.headDisplacement < 1e-6);
  assert.ok(result.resetError < 1e-6);

  const thumb = measureDeformation(rig, { boneName: 'Thumb_R_2', axis: 'z', angleDeg: 45 });
  assert.ok(thumb.maxDisplacement > 0.002, `ibu jari tidak bergerak (${thumb.maxDisplacement})`);
});

test('pose A/netral diterapkan lewat rotasi tulang dan benar-benar mendeformasi mesh', () => {
  const t = build({}, 'T');
  const a = build({}, 'A');
  const neutral = build({}, 'netral');

  const widthT = measureHumanoid(t.content).size[0];
  const widthA = measureHumanoid(a.content).size[0];
  const widthN = measureHumanoid(neutral.content).size[0];
  assert.ok(widthT > widthA && widthA > widthN, `${widthT} / ${widthA} / ${widthN}`);

  const upperA = a.rig.bones.get('UpperArm_R');
  assert.ok(Math.abs(upperA.rotation.z + Math.PI / 4) < 1e-6, 'rotasi bahu A-pose salah');

  // tinggi total tidak berubah oleh pose
  assert.ok(Math.abs(measureHumanoid(a.content).size[1] - 1.75) < 0.01);
});

test('bind pose: tanpa rotasi tulang, bentuk sama dengan geometri sumber', () => {
  const { content, rig } = build();
  applyPose(rig, 'T');
  for (const bone of rig.list) {
    assert.ok(Math.abs(bone.rotation.x) < 1e-9 && Math.abs(bone.rotation.y) < 1e-9 && Math.abs(bone.rotation.z) < 1e-9, `${bone.name} tidak nol`);
  }
  const bounds = measureHumanoid(content);
  assert.ok(Math.abs(bounds.size[1] - 1.75) < 0.01);
  assert.ok(Math.abs(bounds.min[1]) < 1e-6);
});

test('rig mengikuti parameter: mengubah panjang lengan menggeser tulang tangan', () => {
  const base = build();
  const longer = build({ upperArmLength: 0.36 });
  const baseHand = base.rig.bones.get('Hand_R').getWorldPosition(new THREE.Vector3());
  const longerHand = longer.rig.bones.get('Hand_R').getWorldPosition(new THREE.Vector3());
  assert.ok(longerHand.x > baseHand.x + 0.05, `tulang tangan tidak ikut memanjang (${baseHand.x} → ${longerHand.x})`);
  assert.equal(DEFAULTS, DEFAULTS);
});
