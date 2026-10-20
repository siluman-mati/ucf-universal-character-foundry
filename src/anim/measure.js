/**
 * UCF Tahap 5 — pengukuran animasi pada mesh hasil skinning.
 *
 * Semua angka diukur dari verteks setelah skinning (bukan dari timeline),
 * supaya klaim "animasi berhasil" punya bukti geometri.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;

function meshesOf(root, predicate) {
  const list = [];
  root.traverse((object) => {
    if (object.isMesh && !object.userData?.ucfHelper && predicate(object)) list.push(object);
  });
  return list;
}

function bodyMeshes(root) {
  return meshesOf(root, (mesh) => !mesh.name.startsWith('ML_'));
}

function moduleMeshes(root) {
  return meshesOf(root, (mesh) => mesh.name.startsWith('ML_'));
}

function footMeshes(root, side = null) {
  const pattern = side ? new RegExp(`^Foot_Mesh_${side}|^Foot_${side}`) : /^(Foot_Mesh_|Foot_)/;
  return meshesOf(root, (mesh) => pattern.test(mesh.name));
}

function toLocal(object, vector, inverseRoot) {
  return vector.applyMatrix4(object.matrixWorld).applyMatrix4(inverseRoot);
}

/** Titik terendah sebuah mesh (setelah skinning) dalam ruang rig.root. */
export function lowestMeshPoint(root, meshes) {
  const inverseRoot = root.matrixWorld.clone().invert();
  let lowest = Infinity;
  const vector = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    for (let i = 0; i < position.count; i += 1) {
      mesh.getVertexPosition(i, vector);
      toLocal(mesh, vector, inverseRoot);
      if (vector.y < lowest) lowest = vector.y;
    }
  }
  return lowest;
}

function angleBetween(a, b) {
  if (!a || !b) return 180;
  return (a.angleTo(b) * 180) / Math.PI;
}

function boneDirection(a, b) {
  return new THREE.Vector3().subVectors(b, a).normalize();
}

/**
 * Ukur kontak kaki, gerak panggul, dan loop selama satu siklus klip.
 * @returns {object} metrik
 */
export function measureFootContact(rig, clip, { frames = 48 } = {}) {
  const mixer = new THREE.AnimationMixer(rig.root);
  const action = mixer.clipAction(clip);
  action.play();
  const root = rig.root;
  const duration = clip.duration;

  const body = bodyMeshes(root);
  const feet = footMeshes(root);
  const left = footMeshes(root, 'L');
  const right = footMeshes(root, 'R');

  const samples = [];
  for (let i = 0; i < frames; i += 1) {
    const time = (i / frames) * duration * 0.9999;
    mixer.setTime(time);
    root.updateMatrixWorld(true);
    const hips = rig.bones.get('Hips')?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3();
    samples.push({
      time,
      lowestFoot: lowestMeshPoint(root, feet),
      lowestBody: lowestMeshPoint(root, body),
      footL: lowestMeshPoint(root, left),
      footR: lowestMeshPoint(root, right),
      hips: hips.toArray()
    });
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  const values = (key) => samples.map((sample) => sample[key]);
  const lowest = Math.min(...values('lowestFoot'));
  const highestContact = Math.max(...values('lowestFoot'));
  const bodyMin = Math.min(...values('lowestBody'));
  const leftMin = Math.min(...values('footL'));
  const rightMin = Math.min(...values('footR'));
  const hipsX = values('hips').map((h) => h[0]);
  const hipsZ = values('hips').map((h) => h[2]);
  const hipsY = values('hips').map((h) => h[1]);

  // kaki bergantian: waktu saat tiap kaki paling dekat lantai
  const leftContact = (leftMin - lowest) < 0.03;
  const rightContact = (rightMin - lowest) < 0.03;
  const last = samples[samples.length - 1];
  const first = samples[0];

  return {
    frames,
    duration: Number(duration.toFixed(3)),
    lowestFootM: Number(lowest.toFixed(4)),
    highestContactM: Number(highestContact.toFixed(4)),
    bodyLowestM: Number(bodyMin.toFixed(4)),
    footLeftLowestM: Number(leftMin.toFixed(4)),
    footRightLowestM: Number(rightMin.toFixed(4)),
    bothFeetReachGround: leftContact && rightContact,
    hipsRangeY: Number((Math.max(...hipsY) - Math.min(...hipsY)).toFixed(4)),
    hipsDriftXZ: Number(Math.max(
      Math.abs(hipsX[0] - last.hips[0]),
      Math.abs(hipsZ[0] - last.hips[2])
    ).toFixed(5)),
    loopDeltaM: Number(last.lowestFoot - first.lowestFoot).toFixed(5)
  };
}

/**
 * Rentang sendi: lutut, pergelangan tangan, kepala, dan jari.
 */
export function measureJoints(rig, clip, { frames = 36 } = {}) {
  const mixer = new THREE.AnimationMixer(rig.root);
  mixer.clipAction(clip).play();
  const root = rig.root;
  const bones = rig.bones;
  const V = THREE.Vector3;

  const kneeRange = { min: 180, max: 0 };
  const flexionRange = { min: 0, max: 0 };
  const handDistance = { min: Infinity, max: 0 };
  const headRange = { min: Infinity, max: -Infinity };
  const fingerTip = { min: Infinity, max: -Infinity };
  const shoulderRange = { min: 0, max: 0 };
  // Sudut minimum lengan terhadap arah bawah (0,−1,0): 0° = lengan lurus ke bawah,
  // 90° = lengan horizontal (T-pose). Dipakai untuk mendeteksi pose lengan yang "kaku
  // di T-pose" — metrik jarak/tinggi saja bisa lolos pada tubuh berproporsi lain.
  const armDown = { R: 180, L: 180 };
  const handHeight = { R: { min: Infinity, max: -Infinity }, L: { min: Infinity, max: -Infinity } };
  const handLateral = { R: { min: Infinity, max: -Infinity }, L: { min: Infinity, max: -Infinity } };
  const restHead = null;

  for (let i = 0; i < frames; i += 1) {
    mixer.setTime((i / frames) * clip.duration * 0.9999);
    root.updateMatrixWorld(true);

    for (const side of ['R', 'L']) {
      const upper = bones.get(`UpperLeg_${side}`)?.getWorldPosition(new V());
      const lower = bones.get(`LowerLeg_${side}`)?.getWorldPosition(new V());
      const foot = bones.get(`Foot_${side}`)?.getWorldPosition(new V());
      if (upper && lower && foot) {
        const knee = angleBetween(boneDirection(upper, lower), boneDirection(lower, foot));
        kneeRange.min = Math.min(kneeRange.min, knee);
        kneeRange.max = Math.max(kneeRange.max, knee);
      }
      const kneeBone = bones.get(`LowerLeg_${side}`);
      if (kneeBone) {
        // rotasi lokal terhadap sumbu X = engsel lutut (rig UCF memakai sumbu dunia saat rest)
        let flex = (2 * Math.atan2(kneeBone.quaternion.x, kneeBone.quaternion.w) * 180) / Math.PI;
        while (flex > 180) flex -= 360;
        while (flex < -180) flex += 360;
        flexionRange.min = Math.min(flexionRange.min, flex);
        flexionRange.max = Math.max(flexionRange.max, flex);
      }

      const forearm = bones.get(`LowerArm_${side}`)?.getWorldPosition(new V());
      const hand = bones.get(`Hand_${side}`)?.getWorldPosition(new V());
      if (forearm && hand) {
        const distance = forearm.distanceTo(hand);
        handDistance.min = Math.min(handDistance.min, distance);
        handDistance.max = Math.max(handDistance.max, distance);
      }

      const shoulder = bones.get(`UpperArm_${side}`)?.getWorldPosition(new V());
      if (shoulder && hand) {
        const angle = angleBetween(boneDirection(shoulder, hand), new V(0, -1, 0));
        shoulderRange.max = Math.max(shoulderRange.max, angle);
        armDown[side] = Math.min(armDown[side], angle);
      }
      // Tinggi & jarak lateral tangan relatif panggul: membuktikan lengan benar-benar turun,
      // bukan kaku di posisi T-pose seperti pada hasil retarget yang salah alignment.
      if (hand && bones.get('Hips')) {
        const hipsPos = bones.get('Hips').getWorldPosition(new V());
        const height = hand.y - hipsPos.y;
        handHeight[side].min = Math.min(handHeight[side].min, height);
        handHeight[side].max = Math.max(handHeight[side].max, height);
        const lateral = Math.abs(hand.x - hipsPos.x);
        handLateral[side].min = Math.min(handLateral[side].min, lateral);
        handLateral[side].max = Math.max(handLateral[side].max, lateral);
      }
    }

    const head = bones.get('Head')?.getWorldPosition(new V());
    const hipsBone = bones.get('Hips')?.getWorldPosition(new V());
    if (head && hipsBone) {
      const relative = head.y - hipsBone.y;
      headRange.min = Math.min(headRange.min, relative);
      headRange.max = Math.max(headRange.max, relative);
    }
    const tip = bones.get('Finger_Index_R_3')?.getWorldPosition(new V()) ||
      bones.get('Finger_Index_R_2')?.getWorldPosition(new V());
    if (tip && head) {
      const distance = tip.distanceTo(head);
      fingerTip.min = Math.min(fingerTip.min, distance);
      fingerTip.max = Math.max(fingerTip.max, distance);
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  return {
    kneeMinDeg: Number(kneeRange.min.toFixed(1)),
    kneeMaxDeg: Number(kneeRange.max.toFixed(1)),
    kneeFlexionMinDeg: Number(flexionRange.min.toFixed(1)),
    kneeFlexionMaxDeg: Number(flexionRange.max.toFixed(1)),
    armDownMinDeg: { R: Number(armDown.R.toFixed(1)), L: Number(armDown.L.toFixed(1)) },
    handHeightRelHipsM: {
      R: [Number(handHeight.R.min.toFixed(3)), Number(handHeight.R.max.toFixed(3))],
      L: [Number(handHeight.L.min.toFixed(3)), Number(handHeight.L.max.toFixed(3))]
    },
    handLateralM: {
      R: [Number(handLateral.R.min.toFixed(3)), Number(handLateral.R.max.toFixed(3))],
      L: [Number(handLateral.L.min.toFixed(3)), Number(handLateral.L.max.toFixed(3))]
    },
    handWristVariationM: Number((handDistance.max - handDistance.min).toFixed(6)),
    handWristMinM: Number(handDistance.min.toFixed(4)),
    headRangeY: Number((headRange.max - headRange.min).toFixed(4)),
    fingerTipTravelM: Number((fingerTip.max - fingerTip.min).toFixed(4)),
    armElevationMaxDeg: Number(shoulderRange.max.toFixed(1)),
    restHead
  };
}

/** Regangan mesh: rasio panjang rusuk terhadap rest (contoh 240 rusuk tubuh). */
export function measureStretch(rig, clip, { frames = 12, edges = 240 } = {}) {
  const root = rig.root;
  const body = bodyMeshes(root);
  const samples = [];
  const vectorA = new THREE.Vector3();
  const vectorB = new THREE.Vector3();
  const inverseRoot = root.matrixWorld.clone().invert();

  const collect = () => {
    const lengths = [];
    for (const mesh of body) {
      const position = mesh.geometry.getAttribute('position');
      if (!position) continue;
      const step = Math.max(1, Math.floor(position.count / Math.max(1, edges / body.length)));
      for (let i = 0; i + step < position.count; i += step) {
        mesh.getVertexPosition(i, vectorA);
        mesh.getVertexPosition(i + step, vectorB);
        toLocal(mesh, vectorA, inverseRoot);
        toLocal(mesh, vectorB, inverseRoot);
        lengths.push(vectorA.distanceTo(vectorB));
      }
    }
    return lengths;
  };

  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  const rest = collect();
  samples.push(rest);

  for (let i = 1; i <= frames; i += 1) {
    mixer.setTime((i / (frames + 1)) * clip.duration);
    root.updateMatrixWorld(true);
    samples.push(collect());
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  let worst = 1;
  for (let s = 1; s < samples.length; s += 1) {
    for (let i = 0; i < samples[s].length; i += 1) {
      const base = rest[i];
      if (!base || base < 1e-6) continue;
      const ratio = samples[s][i] / base;
      worst = Math.max(worst, ratio, 1 / Math.max(1e-6, ratio));
    }
  }
  return { edges: rest.length, maxLengthRatio: Number(worst.toFixed(3)) };
}

/**
 * Pakaian modular mengikuti deformasi tubuh: jarak verteks modul ke verteks tubuh
 * terdekat pada rest vs saat animasi. Perubahan besar = modul lepas/tertinggal.
 */
export function measureModuleFollow(rig, clip, { samples = 60, frames = 8 } = {}) {
  const root = rig.root;
  const modules = moduleMeshes(root);
  if (!modules.length) return { ok: false, reason: 'Tidak ada modul terpasang.', modules: 0 };

  const body = bodyMeshes(root);
  const inverseRoot = root.matrixWorld.clone().invert();
  const vector = new THREE.Vector3();

  // Tulang dominan per verteks tubuh: dipakai agar verteks modul hanya dipasangkan
  // dengan verteks tubuh yang digerakkan tulang sama (mis. sol sepatu kiri dengan
  // punggung kaki kiri, bukan kaki kanan yang kebetulan menempel di garis tengah).
  const dominantBoneOf = (mesh, index) => {
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      const skinIndex = mesh.geometry.getAttribute('skinIndex');
      const skinWeight = mesh.geometry.getAttribute('skinWeight');
      if (skinIndex && skinWeight) {
        let bestWeight = 0;
        let bestBone = null;
        for (let k = 0; k < 4; k += 1) {
          const weight = skinWeight.getComponent(index, k);
          if (weight > bestWeight) {
            bestWeight = weight;
            bestBone = mesh.skeleton.bones[skinIndex.getComponent(index, k)]?.name || null;
          }
        }
        if (bestBone) return bestBone;
      }
    }
    let parent = mesh.parent;
    while (parent && !parent.isBone) parent = parent.parent;
    return parent?.name || null;
  };

  const collectBody = () => {
    const points = [];
    for (const mesh of body) {
      const position = mesh.geometry.getAttribute('position');
      if (!position) continue;
      const step = Math.max(1, Math.floor(position.count / 900));
      for (let i = 0; i < position.count; i += step) {
        mesh.getVertexPosition(i, vector);
        points.push({ p: toLocal(mesh, vector, inverseRoot).clone(), bone: dominantBoneOf(mesh, i) });
      }
    }
    return points;
  };
  let bodyVertices = [];

  const picks = [];
  for (const mesh of modules) {
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    const step = Math.max(1, Math.floor(position.count / Math.max(1, samples / modules.length)));
    for (let i = 0; i < position.count; i += step) {
      picks.push({ mesh, index: i });
    }
  }

  // Pasangan tetap: verteks tubuh terdekat ditentukan SEKALI di pose klip frame 0, lalu
  // diikuti sepanjang klip. Kalau tetangga terdekat dicari ulang tiap frame, jarak bisa
  // meloncat hanya karena titik terdekat berpindah (mis. di antara dua kaki).
  let partners = [];
  const bindBody = () => {
    const list = [];
    for (const pick of picks) {
      pick.mesh.getVertexPosition(pick.index, vector);
      toLocal(pick.mesh, vector, inverseRoot);
      const ownBones = new Set();
      {
        const parent = pick.mesh.isSkinnedMesh ? null : pick.mesh.parent;
        let bone = parent;
        while (bone && !bone.isBone) bone = bone.parent;
        if (bone?.name) ownBones.add(bone.name);
        if (pick.mesh.isSkinnedMesh) {
          const bone2 = dominantBoneOf(pick.mesh, pick.index);
          if (bone2) ownBones.add(bone2);
        }
      }
      const search = (onlyOwn) => {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < bodyVertices.length; i += 1) {
          if (onlyOwn && !ownBones.has(bodyVertices[i].bone)) continue;
          const d = vector.distanceToSquared(bodyVertices[i].p);
          if (d < bestD) { bestD = d; best = i; }
        }
        return { best, bestD };
      };
      let found = search(ownBones.size > 0);
      if (found.best < 0) found = search(false);
      list.push({ index: found.best, rest: Math.sqrt(found.bestD) });
    }
    return list;
  };
  const gapOf = (pick, partner) => {
    pick.mesh.getVertexPosition(pick.index, vector);
    toLocal(pick.mesh, vector, inverseRoot);
    return vector.distanceToSquared(bodyVertices[partner.index].p);
  };

  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  bodyVertices = collectBody();
  partners = bindBody();
  const restDistances = partners.map((item) => item.rest);

  const perFrame = [];
  const worstOf = picks.map((pick, index) => ({ module: pick.mesh.name, vertex: pick.index, rest: restDistances[index], change: 0, frame: 0 }));
  for (let frame = 1; frame <= frames; frame += 1) {
    mixer.setTime((frame / (frames + 1)) * clip.duration);
    root.updateMatrixWorld(true);
    bodyVertices = collectBody();
    const distances = picks.map((pick, index) => Math.sqrt(gapOf(pick, partners[index])));
    let maxChange = 0;
    let meanChange = 0;
    for (let i = 0; i < distances.length; i += 1) {
      const change = Math.abs(distances[i] - restDistances[i]);
      if (change > worstOf[i].change) {
        worstOf[i].change = change;
        worstOf[i].frame = frame;
      }
      maxChange = Math.max(maxChange, change);
      meanChange += change;
    }
    perFrame.push({ maxChange, meanChange: meanChange / Math.max(1, distances.length) });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  const maxChange = Math.max(...perFrame.map((entry) => entry.maxChange));
  const meanChange = perFrame.reduce((sum, entry) => sum + entry.meanChange, 0) / perFrame.length;
  return {
    ok: true,
    modules: modules.length,
    samples: picks.length,
    bodyVertices: bodyVertices.length,
    maxGapChangeM: Number(maxChange.toFixed(4)),
    meanGapChangeM: Number(meanChange.toFixed(4)),
    worst: worstOf.reduce((worstItem, item) => (!worstItem || item.change > worstItem.change ? item : worstItem), null)
  };
}

/** Selisih pose awal/akhir untuk klip loop. */
export function measureLoopClosure(rig, clip) {
  const root = rig.root;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const capture = (time) => {
    mixer.setTime(time);
    root.updateMatrixWorld(true);
    return rig.list.map((bone) => ({ quat: bone.quaternion.clone(), pos: bone.position.clone() }));
  };
  const start = capture(0);
  const end = capture(clip.duration);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  let maxAngle = 0;
  let maxPos = 0;
  for (let i = 0; i < start.length; i += 1) {
    maxAngle = Math.max(maxAngle, start[i].quat.angleTo(end[i].quat));
    maxPos = Math.max(maxPos, start[i].pos.distanceTo(end[i].pos));
  }
  return {
    maxAngleDeg: Number(((maxAngle / DEG) / 1).toFixed(3)),
    maxPositionM: Number(maxPos.toFixed(5))
  };
}

/** Evaluasi lengkap + status PASS/FAIL yang bisa dipakai UI dan tes. */
export function evaluateAnimation(rig, clip, { modular = false } = {}) {
  const foot = measureFootContact(rig, clip);
  const joints = measureJoints(rig, clip);
  const stretch = measureStretch(rig, clip);
  const loop = measureLoopClosure(rig, clip);
  const modules = modular ? measureModuleFollow(rig, clip) : null;

  const checks = [];
  const push = (id, label, ok, detail, measured = {}) => checks.push({ id, label, status: ok ? 'PASS' : 'FAIL', detail, measured });

  const groundMode = clip.userData?.grounded || 'contact';
  const contactClip = groundMode === 'contact';
  const floorOk = foot.lowestFootM > -0.02 && (!contactClip || foot.highestContactM < 0.06);
  push('lantai', contactClip ? 'Kaki menapak lantai sepanjang klip' : 'Kaki tidak menembus lantai (fase melayang wajar)', floorOk,
    contactClip
      ? `Titik terendah telapak ${foot.lowestFootM} m; titik terendah tertinggi ${foot.highestContactM} m (ambang −0,02 … 0,06 m).`
      : `Titik terendah telapak ${foot.lowestFootM} m; tinggi fase melayang ${foot.highestContactM} m (tidak dipaksa menapak).`,
    { lowestFootM: foot.lowestFootM, highestContactM: foot.highestContactM, groundMode });
  push('bergantian', 'Kedua kaki menyentuh lantai bergantian', foot.bothFeetReachGround,
    `Kiri ${foot.footLeftLowestM} m, kanan ${foot.footRightLowestM} m.`);
  push('panggul', 'Panggul tidak bergeser mendatar (in-place)', foot.hipsDriftXZ < 0.005,
    `Drift awal–akhir ${foot.hipsDriftXZ} m.`);
  push('loop', 'Loop klip tertutup rapi', loop.maxAngleDeg < 0.5 && loop.maxPositionM < 0.005,
    `Selisih pose awal–akhir ${loop.maxAngleDeg}°, ${loop.maxPositionM} m.`);
  push('lutut', 'Lutut menekuk wajar, tidak hiperekstensi',
    joints.kneeFlexionMinDeg > -10 && joints.kneeFlexionMaxDeg < 140,
    `Fleksi lutut ${joints.kneeFlexionMinDeg}°…${joints.kneeFlexionMaxDeg}° (rentang aman −10°…140°).`,
    { flexionMin: joints.kneeFlexionMinDeg, flexionMax: joints.kneeFlexionMaxDeg });
  push('tangan', 'Tangan tetap menempel di lengan', joints.handWristVariationM < 0.002,
    `Variasi jarak pergelangan–tangan ${(joints.handWristVariationM * 1000).toFixed(2)} mm.`);
  push('kepala', 'Kepala tidak meloncat', joints.headRangeY < 0.25,
    `Rentang tinggi kepala ${joints.headRangeY} m.`);
  push('regangan', 'Mesh tidak meregang ekstrem', stretch.maxLengthRatio < 1.35,
    `Rasio rusuk maksimum ${stretch.maxLengthRatio}×.`);
  // Minimal satu lengan harus tetap di samping badan: menangkap pose "T-pose kaku"
  // yang dulu lolos semua metrik lain meski lengan tidak pernah turun.
  const lowered = ['R', 'L'].filter((side) => joints.armDownMinDeg[side] < 65);
  push('lengan', 'Lengan tidak kaku di posisi T-pose', lowered.length >= 1,
    lowered.length
      ? `Lengan ${lowered.join('/')} pernah turun ke samping badan (sudut minimum terhadap arah bawah ${Math.min(...lowered.map((side) => joints.armDownMinDeg[side]))}°, ambang 65°; T-pose = 90°).`
      : `Kedua lengan tetap mendatar seperti T-pose sepanjang klip (sudut minimum R ${joints.armDownMinDeg.R}°, L ${joints.armDownMinDeg.L}°; ambang 65°).`,
    { armDownMinDeg: joints.armDownMinDeg, handHeightRelHipsM: joints.handHeightRelHipsM, handLateralM: joints.handLateralM });

  if (modules) {
    push('modul', 'Pakaian modular mengikuti deformasi', modules.ok && modules.maxGapChangeM < 0.03,
      modules.ok ? `Perubahan jarak modul–tubuh maksimum ${(modules.maxGapChangeM * 1000).toFixed(1)} mm dari ${modules.samples} verteks.` : modules.reason,
      modules);
  }

  return {
    clip: clip.name,
    duration: Number(clip.duration.toFixed(3)),
    checks,
    passed: checks.filter((entry) => entry.status === 'PASS').length,
    failed: checks.filter((entry) => entry.status === 'FAIL').length,
    metrics: { foot, joints, stretch, loop, modules }
  };
}
