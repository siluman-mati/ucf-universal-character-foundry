/**
 * UCF Tahap 5 — uji unit modul animasi (Node murni, tanpa browser).
 *
 * Yang diuji:
 *  - deteksi peran tulang dari GEOMETRI (bukan hanya nama), termasuk nama sisi
 *    yang berlawanan konvensi dan urutan jari;
 *  - pemetaan tulang eksplisit beserta pemeriksaan kualitasnya;
 *  - retarget + verifikasi (expected vs actual) pada rig sintetis;
 *  - grounding klip retarget (contact/clamp) memakai mesh telapak nyata;
 *  - metrik modul-mengikuti-tubuh: peka terhadap modul yang salah induk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { analyzeSkeleton, nameSignals, normalizeName } from '../src/anim/skeleton.js';
import { buildBoneMapping, validateMapping, nameOnlyMapping } from '../src/anim/mapping.js';
import { retargetClip, verifyRetarget, groundClip } from '../src/anim/retarget.js';
import { measureModuleFollow } from '../src/anim/measure.js';

const DEG = Math.PI / 180;

function bone(parent, name, x, y, z) {
  const object = new THREE.Bone();
  object.name = name;
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function addFingers(hand, prefix, side) {
  const names = ['Index', 'Middle', 'Ring', 'Pinky'];
  const sign = side === 'Left' ? 1 : -1;
  names.forEach((finger, index) => {
    let parent = hand;
    for (let joint = 1; joint <= 3; joint += 1) {
      const spread = index * 0.012;
      parent = bone(parent, `${prefix}${finger}${joint}`, sign * 0.03, 0, spread);
    }
  });
  let thumb = hand;
  for (let joint = 1; joint <= 3; joint += 1) {
    thumb = bone(thumb, `${prefix}Thumb${joint}`, sign * 0.025, 0.02, -0.03);
  }
}

/** Sumber sintetis meniru Mixamo: A-pose, +X adalah sisi KIRI, 67+ tulang. */
function buildSource() {
  const root = new THREE.Group();
  root.name = 'SourceRoot';
  const hips = bone(root, 'mixamorigHips', 0, 1.0, 0);
  const spine = bone(hips, 'mixamorigSpine', 0, 0.12, 0);
  const spine1 = bone(spine, 'mixamorigSpine1', 0, 0.14, 0);
  const spine2 = bone(spine1, 'mixamorigSpine2', 0, 0.14, 0);
  const neck = bone(spine2, 'mixamorigNeck', 0, 0.09, 0);
  const head = bone(neck, 'mixamorigHead', 0, 0.12, 0);
  bone(head, 'mixamorigHeadTop_End', 0, 0.2, 0);
  // A-pose: lengan turun 45° ke luar
  const armRoots = [
    { side: 'Left', sign: 1 },
    { side: 'Right', sign: -1 }
  ];
  for (const { side, sign } of armRoots) {
    const shoulder = bone(spine2, `mixamorig${side}Shoulder`, sign * 0.04, 0.03, 0);
    const upper = bone(shoulder, `mixamorig${side}Arm`, sign * 0.14, -0.03, 0);
    const lower = bone(upper, `mixamorig${side}ForeArm`, sign * 0.16, -0.16, 0);
    const hand = bone(lower, `mixamorig${side}Hand`, sign * 0.16, -0.16, 0);
    addFingers(hand, `mixamorig${side}Hand`, side);
  }
  for (const { side, sign } of armRoots) {
    const upLeg = bone(hips, `mixamorig${side}UpLeg`, sign * 0.1, -0.05, 0);
    const leg = bone(upLeg, `mixamorig${side}Leg`, 0, -0.43, 0);
    const foot = bone(leg, `mixamorig${side}Foot`, 0, -0.4, 0.02);
    const toe = bone(foot, `mixamorig${side}ToeBase`, 0, -0.04, 0.1);
    bone(toe, `mixamorig${side}Toe_End`, 0, 0, 0.08);
  }
  return { root, hips, head, spine2 };
}

/** Target sintetis meniru rig UCF: T-pose, +X adalah sisi "R" (kanan layar). */
function buildTarget({ withFeet = false } = {}) {
  const root = new THREE.Group();
  root.name = 'TargetRoot';
  const hips = bone(root, 'Hips', 0, 1.0, 0);
  const spine = bone(hips, 'Spine', 0, 0.13, 0);
  const chest = bone(spine, 'Chest', 0, 0.15, 0);
  const neck = bone(chest, 'Neck', 0, 0.12, 0);
  const head = bone(neck, 'Head', 0, 0.1, 0);
  bone(head, 'HeadTop', 0, 0.2, 0);
  for (const [side, sign] of [['R', 1], ['L', -1]]) {
    const clavicle = bone(chest, `Clavicle_${side}`, sign * 0.03, 0.02, 0);
    const upper = bone(clavicle, `UpperArm_${side}`, sign * 0.14, 0, 0);
    const lower = bone(upper, `LowerArm_${side}`, sign * 0.24, 0, 0);
    const hand = bone(lower, `Hand_${side}`, sign * 0.24, 0, 0);
    const names = ['Index', 'Middle', 'Ring', 'Pinky'];
    names.forEach((finger, index) => {
      let parent = hand;
      for (let joint = 1; joint <= 3; joint += 1) {
        parent = bone(parent, `Finger_${finger}_${side}_${joint}`, sign * 0.03, 0, index * 0.012);
      }
    });
    let thumb = hand;
    for (let joint = 1; joint <= 3; joint += 1) {
      thumb = bone(thumb, `Thumb_${side}_${joint}`, sign * 0.022, 0.02, -0.03);
    }
    const upperLeg = bone(hips, `UpperLeg_${side}`, sign * 0.09, -0.05, 0);
    const lowerLeg = bone(upperLeg, `LowerLeg_${side}`, 0, -0.42, 0);
    const foot = bone(lowerLeg, `Foot_${side}`, 0, -0.4, 0.02);
    bone(foot, `Toe_${side}`, 0, -0.04, 0.12);
  }
  root.updateMatrixWorld(true);
  return { root, hips, head, chest, withFeet };
}

function makeRig(target) {
  const list = [];
  target.root.traverse((object) => { if (object.isBone) list.push(object); });
  const bones = new Map(list.map((item) => [item.name, item]));
  return { root: target.root, list, bones };
}

function clipFromQuatTrack(name, times, quats, duration = 1) {
  const values = [];
  for (const quat of quats) values.push(quat.x, quat.y, quat.z, quat.w);
  return new THREE.AnimationClip('sintetis', duration, [new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values)]);
}

test('normalisasi nama & sinyal sisi/jari', () => {
  assert.equal(normalizeName('mixamorig:LeftHandIndex1'), 'lefthandindex1');
  const signals = nameSignals('mixamorigLeftHandRing2');
  assert.equal(signals.side, 'L');
  assert.equal(signals.finger, 'ring');
  assert.equal(nameSignals('Finger_Pinky_R_3').finger, 'pinky');
  assert.equal(nameSignals('Thumb_L_1').finger, 'thumb');
  assert.equal(nameSignals('UpperLeg_R').side, 'R');
});

test('analisis sumber: kepala, ujung kepala, dan arah tulang daun', () => {
  const source = buildSource();
  const analysis = analyzeSkeleton(source.root);
  assert.ok(analysis);
  assert.equal(analysis.hips, 'mixamorigHips');
  const head = analysis.byName.get('mixamorigHead');
  assert.equal(head.role, 'head');
  assert.equal(analysis.byName.get('mixamorigHeadTop_End').role, 'head.end');
  // tulang daun memakai arah induk→anak, bukan default +Y
  const toeEnd = analysis.byName.get('mixamorigLeftToe_End');
  assert.ok(Math.abs(toeEnd.direction[2]) > 0.9, `arah ujung kaki ${toeEnd.direction.join(',')}`);
});

test('analisis memakai geometri untuk sisi: +X sumber terdeteksi R', () => {
  const source = buildSource();
  const analysis = analyzeSkeleton(source.root);
  const leftArm = analysis.byName.get('mixamorigLeftArm');
  assert.equal(leftArm.role, 'arm.upper');
  assert.equal(leftArm.side, 'R', 'tulang bernama Left tetapi berada di +X harus terdeteksi sisi dunia R');
  assert.equal(analysis.byName.get('mixamorigRightArm').side, 'L');
});

test('peran jari mengikuti nama saat nama menyebut jari secara eksplisit', () => {
  const target = buildTarget();
  const analysis = analyzeSkeleton(target.root);
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
    for (let joint = 1; joint <= 3; joint += 1) {
      const entry = analysis.byName.get(`Finger_${finger}_R_${joint}`);
      assert.equal(entry.role, `finger.${finger.toLowerCase()}.${joint}`, `peran ${entry.name}`);
      assert.equal(entry.side, 'R');
    }
  }
  assert.equal(analysis.byName.get('Thumb_L_2').role, 'finger.thumb.2');
});

test('pemetaan tulang eksplisit: peran inti lengkap, hierarki konsisten', () => {
  const source = buildSource();
  const target = buildTarget();
  const sourceAnalysis = analyzeSkeleton(source.root);
  const targetAnalysis = analyzeSkeleton(target.root);
  const mapping = buildBoneMapping(sourceAnalysis, targetAnalysis);
  assert.equal(mapping.ok, true);
  assert.deepEqual(mapping.coreMissing, []);
  assert.equal(mapping.hierarchyIssues, 0);
  assert.ok(mapping.mapped >= 40, `pasangan ${mapping.mapped}`);
  assert.ok(mapping.coverage > 0.6);
});

test('konflik label sisi dicatat, tetapi sisi dunia tetap sama', () => {
  const source = buildSource();
  const target = buildTarget();
  const mapping = buildBoneMapping(analyzeSkeleton(source.root), analyzeSkeleton(target.root));
  assert.ok(mapping.conflicts.length > 0, 'harus ada konflik label Mixamo vs UCF');
  assert.equal(mapping.conflictsWorldSide, 0);
  assert.ok(mapping.conflicts.every((item) => item.worldSideAgrees === true));
  assert.equal(mapping.sideConvention.sourceMirrored, true);
  assert.equal(mapping.sideConvention.targetMirrored, false);
  const checks = validateMapping(mapping);
  const byId = Object.fromEntries(checks.map((check) => [check.id, check.status]));
  assert.equal(byId['konflik-nama'], 'PASS');
  assert.equal(byId['cakupan'], 'PASS');
  assert.equal(byId['hierarki'], 'PASS');
  assert.equal(byId['rest'], 'PASS');
});

test('pencocokan nama-saja jauh lebih sedikit daripada pencocokan struktur', () => {
  const source = buildSource();
  const target = buildTarget();
  const sourceAnalysis = analyzeSkeleton(source.root);
  const targetAnalysis = analyzeSkeleton(target.root);
  const byName = nameOnlyMapping(sourceAnalysis, targetAnalysis);
  const structural = buildBoneMapping(sourceAnalysis, targetAnalysis);
  assert.ok(byName.length <= 4, `nama-saja ${byName.length}`);
  assert.ok(structural.mapped > byName.length * 5);
});

test('retarget klip: track terbentuk untuk setiap pasangan dan panggul', () => {
  const source = buildSource();
  const target = buildTarget();
  const rig = makeRig(target);
  const sourceAnalysis = analyzeSkeleton(source.root);
  const targetAnalysis = analyzeSkeleton(target.root);
  const mapping = buildBoneMapping(sourceAnalysis, targetAnalysis);
  const arm = source.root.getObjectByName('mixamorigLeftArm');
  const times = [0, 0.5, 1];
  const quats = [0, 1, 2].map((i) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 * i, 0, 0)));
  const clip = clipFromQuatTrack(arm.name, times, quats, 1);
  const { clip: out, report } = retargetClip({
    clip, sourceRoot: source.root, sourceAnalysis, targetRig: rig, targetAnalysis, mapping, options: { fps: 10 }
  });
  assert.ok(out.tracks.length >= mapping.pairs.length);
  assert.equal(report.mapped, mapping.mapped);
  assert.ok(out.tracks.some((track) => track.name === 'Hips.position'));
  assert.ok(report.hipScale > 0.5 && report.hipScale < 2);
  // tulang yang tidak terpetakan tidak memiliki track
  const trackNames = new Set(out.tracks.map((track) => track.name.split('.')[0]));
  assert.ok(trackNames.has('UpperArm_R'));
  assert.ok(!trackNames.has('mixamorigLeftArm'));
});

test('verifikasi retarget: deviasi ~0 terhadap pose yang diharapkan', () => {
  const source = buildSource();
  const target = buildTarget();
  const rig = makeRig(target);
  const sourceAnalysis = analyzeSkeleton(source.root);
  const targetAnalysis = analyzeSkeleton(target.root);
  const mapping = buildBoneMapping(sourceAnalysis, targetAnalysis);
  const upper = source.root.getObjectByName('mixamorigLeftArm');
  const lower = source.root.getObjectByName('mixamorigLeftForeArm');
  const times = [0, 0.25, 0.5, 0.75, 1];
  const q = (angle) => new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0));
  const clip = new THREE.AnimationClip('ayun', 1, [
    new THREE.QuaternionKeyframeTrack(`${upper.name}.quaternion`, times, times.flatMap((t) => (q(t * 1.2).toArray()))),
    new THREE.QuaternionKeyframeTrack(`${lower.name}.quaternion`, times, times.flatMap((t) => (q(t * 0.8).toArray())))
  ]);
  const { clip: out } = retargetClip({
    clip, sourceRoot: source.root, sourceAnalysis, targetRig: rig, targetAnalysis, mapping, options: { fps: 20 }
  });
  const verify = verifyRetarget({
    clip: out, sourceClip: clip, sourceRoot: source.root, sourceAnalysis,
    targetRoot: rig.root, targetAnalysis, mapping, samples: 6
  });
  assert.ok(verify.worstDeg < 1, `deviasi terburuk ${verify.worstDeg}°`);
  assert.ok(verify.meanDeg < 0.5);
  assert.ok(verify.rows.length > 20);
});

test('grounding klip: kaki yang menembus lantai dinaikkan tepat ke 0', () => {
  const target = buildTarget();
  const rig = makeRig(target);
  const footBone = rig.bones.get('Foot_R');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.26), new THREE.MeshBasicMaterial());
  mesh.name = 'Foot_Mesh_R';
  mesh.position.set(0, -0.03, 0.05);
  footBone.add(mesh);
  rig.root.updateMatrixWorld(true);
  const hips = rig.bones.get('Hips');
  const times = [0, 0.5, 1];
  const clip = new THREE.AnimationClip('turun', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', times, [0, 1.0, 0, 0, 0.7, 0, 0, 1.0, 0])
  ]);
  const contact = groundClip({ rig, clip, mode: 'contact' });
  assert.equal(contact.report.applied, true);
  assert.ok(contact.report.minFootBeforeM < -0.03, `sebelum ${contact.report.minFootBeforeM}`);
  assert.ok(Math.abs(contact.report.minFootAfterM) < 0.002, `sesudah ${contact.report.minFootAfterM}`);
  assert.ok(Math.abs(contact.report.maxFootAfterM) < 0.002, 'mode contact menapak tiap frame');
  assert.equal(contact.clip.userData.grounded, 'contact');
  assert.ok(contact.report.correctionMaxM > 0.03);
  const clamp = groundClip({ rig, clip, mode: 'clamp' });
  assert.ok(Math.abs(clamp.report.minFootAfterM) < 0.002, 'clamp tidak membiarkan kaki menembus');
  assert.ok(clamp.report.maxFootAfterM > 0.03, 'clamp tidak memaksa kaki menapak saat melayang');
  assert.equal(clamp.report.correctionMinM, 0, 'clamp tidak pernah menurunkan badan');
  assert.equal(clamp.clip.userData.grounded, 'clamp');
  rig.root.updateMatrixWorld(true);
  assert.ok(hips.position.y >= 0);
});

test('metrik modul: modul yang salah induk terdeteksi, yang benar lolos', () => {
  const target = buildTarget();
  const rig = makeRig(target);
  const thighR = rig.bones.get('UpperLeg_R');
  const thighL = rig.bones.get('UpperLeg_L');
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), new THREE.MeshBasicMaterial());
  body.name = 'Body_Thigh_R';
  body.position.set(0, -0.2, 0);
  thighR.add(body);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), new THREE.MeshBasicMaterial());
  right.name = 'ML_pants_right';
  right.position.set(0, -0.2, 0.09);
  thighR.add(right);
  const wrong = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), new THREE.MeshBasicMaterial());
  wrong.name = 'ML_pants_wrong';
  wrong.position.set(0.18, -0.2, 0.09);
  thighL.add(wrong);
  rig.root.updateMatrixWorld(true);
  const times = [0, 0.5, 1];
  const swing = [0, 0.9, 0].map((angle) => {
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0));
    return [quat.x, quat.y, quat.z, quat.w];
  }).flat();
  const clip = new THREE.AnimationClip('ayun-kaki', 1, [
    new THREE.QuaternionKeyframeTrack('UpperLeg_R.quaternion', times, swing)
  ]);
  const result = measureModuleFollow(rig, clip, { samples: 40, frames: 6 });
  assert.equal(result.ok, true);
  const worst = result.worst.module;
  assert.equal(worst, 'ML_pants_wrong');
  assert.ok(result.maxGapChangeM > 0.15, `perubahan maksimum ${result.maxGapChangeM}`);
});
