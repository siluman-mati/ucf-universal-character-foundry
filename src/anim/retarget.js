/**
 * UCF Tahap 5 — retargeting rotasi berbasis delta dunia.
 *
 * Untuk setiap frame:
 *   1. Ambil rotasi dunia tulang sumber, hitung delta terhadap rest pose sumber.
 *   2. Terapkan delta yang sama pada orientasi rest tulang target (delta dunia).
 *   3. Ubah ke rotasi lokal target memakai rotasi dunia induk hasil retarget frame itu.
 * Translasi panggul diskalakan menurut rasio tinggi panggul kedua rig; root motion
 * horizontal dapat dibuang (in-place) atau dipertahankan.
 */
import * as THREE from 'three';
import { lowestMeshPoint } from './measure.js';

const DEG = Math.PI / 180;

function hierarchyOrder(analysis) {
  return [...analysis.bones].sort((a, b) => a.depth - b.depth);
}

/** Simpan pose rest dan kembalikan fungsi pemulih. */
export function captureRest(analysis) {
  const store = [];
  for (const { bone, entry } of analysis.objects.values()) {
    store.push({ bone, quat: entry.localQuat.clone(), pos: entry.localPos.clone() });
  }
  return {
    restore() {
      for (const item of store) {
        item.bone.quaternion.copy(item.quat);
        item.bone.position.copy(item.pos);
      }
      analysis.root.updateMatrixWorld(true);
    }
  };
}

/**
 * Sampel klip pada root tertentu memakai AnimationMixer sementara.
 * @returns {{times: number[], poseAt: (time: number) => void, restore: () => void, stop: () => void}}
 */
export function createClipSampler(clip, root, analysis) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  // LoopOnce + clamp: tanpa ini, menyampel tepat di t = durasi akan membungkus ke
  // frame 0 (LoopRepeat), sehingga frame terakhir klip berubah menjadi pose awal.
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const rest = captureRest(analysis);
  return {
    poseAt(time) {
      mixer.setTime(Math.max(0, time));
      root.updateMatrixWorld(true);
    },
    restore: () => rest.restore(),
    stop() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      rest.restore();
    }
  };
}

/** Arah dunia sebuah tulang target dari quaternion dunia lokal frame. */
function worldDirection(analysis, name, worldQuat) {
  const entry = analysis.byName.get(name);
  if (!entry) return null;
  const restQ = new THREE.Quaternion().fromArray(entry.worldQuat);
  const dir = new THREE.Vector3().fromArray(entry.direction);
  const local = dir.clone().applyQuaternion(restQ.clone().invert());
  return local.applyQuaternion(worldQuat).normalize();
}

/**
 * Retarget satu klip.
 * @returns {{clip: THREE.AnimationClip, report: object}}
 */
export function retargetClip({ clip, sourceRoot, sourceAnalysis, targetRig, targetAnalysis, mapping, options = {} }) {
  if (!clip) throw new Error('Klip sumber tidak ada.');
  if (!mapping?.pairs?.length) throw new Error('Peta tulang kosong.');
  const fps = Number(options.fps) || 30;
  const rootMotion = options.rootMotion === 'keep' ? 'keep' : 'in-place';
  // 'rest'  : orientasi dunia sumber dipindahkan utuh setelah disejajarkan dengan bind pose
  //           target (Q = restTarget × restSource⁻¹). Ini yang membuat pose A-pose sumber
  //           (lengan turun) tetap turun di target T-pose.
  // 'delta' : hanya selisih terhadap rest sumber yang dipindahkan; bind pose target
  //           dipertahankan (cocok bila kedua rig punya bind pose sama).
  const alignment = options.alignment === 'delta' ? 'delta' : 'rest';
  const duration = Number(clip.duration) || 0;
  const frames = Math.max(2, Math.round(duration * fps) + 1);
  const times = [];
  for (let i = 0; i < frames; i += 1) times.push(Number(((i / (frames - 1)) * duration).toFixed(6)));

  const targetOrder = hierarchyOrder(targetAnalysis);
  const sourceSampler = createClipSampler(clip, sourceRoot, sourceAnalysis);

  const pairBySource = new Map(mapping.pairs.map((pair) => [pair.source, pair]));
  const targetRest = new Map();
  for (const entry of targetAnalysis.bones) {
    targetRest.set(entry.name, {
      worldQuat: new THREE.Quaternion().fromArray(entry.worldQuat),
      worldPos: new THREE.Vector3().fromArray(entry.worldPos),
      localQuat: new THREE.Quaternion().fromArray([0, 0, 0, 1]),
      localPos: new THREE.Vector3()
    });
  }
  const localRest = new Map();
  for (const { bone, entry } of targetAnalysis.objects.values()) {
    localRest.set(entry.name, { quat: entry.localQuat.clone(), pos: entry.localPos.clone() });
  }

  const sourceEntries = new Map(sourceAnalysis.bones.map((entry) => [entry.name, entry]));
  const sourceRestWorldQuat = new Map(sourceAnalysis.bones.map((entry) => [entry.name, new THREE.Quaternion().fromArray(entry.worldQuat)]));
  const sourceRestWorldPos = new Map(sourceAnalysis.bones.map((entry) => [entry.name, new THREE.Vector3().fromArray(entry.worldPos)]));

  const hipsPair = mapping.pairs.find((pair) => pair.role === 'hips');
  const sourceHipsEntry = hipsPair ? sourceEntries.get(hipsPair.source) : null;
  const targetHipsEntry = hipsPair ? targetAnalysis.byName.get(hipsPair.target) : null;
  const sourceHipsHeight = sourceHipsEntry ? sourceHipsEntry.worldPos[1] - Math.min(...sourceAnalysis.bones.map((entry) => entry.worldPos[1])) : 1;
  const targetHipsHeight = targetHipsEntry ? targetHipsEntry.worldPos[1] - Math.min(...targetAnalysis.bones.map((entry) => entry.worldPos[1])) : 1;
  const hipScale = targetHipsHeight / Math.max(1e-6, sourceHipsHeight);

  // rest world quat induk (non-bone) untuk akar rantai
  const parentRestQuat = new Map();
  for (const { bone, entry } of targetAnalysis.objects.values()) {
    const parent = bone.parent;
    const quat = new THREE.Quaternion();
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(quat);
    }
    parentRestQuat.set(entry.name, quat);
  }

  const trackQuats = new Map();
  const trackPos = new Map();
  for (const pair of mapping.pairs) {
    trackQuats.set(pair.target, { times: [], values: [], last: null });
  }
  if (hipsPair) trackPos.set(hipsPair.target, { times: [], values: [], last: null });

  const sourceRootInverse = new THREE.Matrix4();
  const targetRootInverse = new THREE.Matrix4();
  sourceAnalysis.root.updateMatrixWorld(true);
  targetRig.root.updateMatrixWorld(true);
  sourceRootInverse.copy(sourceAnalysis.root.matrixWorld).invert();
  targetRootInverse.copy(targetRig.root.matrixWorld).invert();

  const tmpWorldQ = new Map();
  let droppedTranslation = 0;
  let maxTranslation = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const time = times[frame];
    sourceSampler.poseAt(time);

    const worldQ = new Map();
    const hipsTargetWorldPos = new THREE.Vector3();

    // panggul dulu (paling atas), lalu anak-anaknya dalam urutan kedalaman
    for (const entry of targetOrder) {
      const pair = [...mapping.pairs].find((item) => item.target === entry.name);
      const parentName = entry.parent;
      const parentWorld = parentName && worldQ.has(parentName)
        ? worldQ.get(parentName)
        : (parentRestQuat.get(entry.name) || new THREE.Quaternion());

      let localQuat = localRest.get(entry.name).quat.clone();
      let localPos = null;

      if (pair) {
        const srcBone = sourceAnalysis.objects.get(pair.source)?.bone;
        const srcWorldQ = srcBone.getWorldQuaternion(new THREE.Quaternion());
        const srcRestQ = sourceRestWorldQuat.get(pair.source);
        const tgtRestQ = targetRest.get(entry.name).worldQuat;
        const desiredWorld = alignment === 'rest'
          ? tgtRestQ.clone().multiply(srcRestQ.clone().invert()).multiply(srcWorldQ)
          : srcWorldQ.clone().multiply(srcRestQ.clone().invert()).multiply(tgtRestQ.clone());
        localQuat = parentWorld.clone().invert().multiply(desiredWorld);
        tmpWorldQ.set(entry.name, desiredWorld.clone());

        if (hipsPair && pair === hipsPair) {
          const sourceHipsBone = sourceAnalysis.objects.get(hipsPair.source).bone;
          const worldPos = sourceHipsBone.getWorldPosition(new THREE.Vector3());
          const localPosSource = worldPos.clone().applyMatrix4(sourceRootInverse);
          const restLocal = sourceRestWorldPos.get(hipsPair.source).clone().applyMatrix4(sourceRootInverse);
          const deltaPos = localPosSource.sub(restLocal).multiplyScalar(hipScale);
          const horizontal = Math.hypot(deltaPos.x, deltaPos.z);
          maxTranslation = Math.max(maxTranslation, horizontal);
          if (rootMotion === 'in-place') {
            droppedTranslation = Math.max(droppedTranslation, horizontal);
            deltaPos.x = 0;
            deltaPos.z = 0;
          }
          const restHipsLocal = localRest.get(entry.name).pos.clone();
          const deltaLocal = deltaPos.clone().applyQuaternion(parentWorld.clone().invert());
          localPos = restHipsLocal.add(deltaLocal);
          hipsTargetWorldPos.copy(localPos);
        }
      } else {
        tmpWorldQ.delete(entry.name);
      }

      const thisWorld = parentWorld.clone().multiply(localQuat);
      worldQ.set(entry.name, thisWorld);

      const quatTrack = trackQuats.get(entry.name);
      if (quatTrack) {
        const quat = localQuat.clone();
        if (quatTrack.last && quat.dot(quatTrack.last) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
        quatTrack.times.push(time);
        quatTrack.values.push(quat.x, quat.y, quat.z, quat.w);
        quatTrack.last = quat;
      }
      const posTrack = trackPos.get(entry.name);
      if (posTrack && localPos) {
        posTrack.times.push(time);
        posTrack.values.push(localPos.x, localPos.y, localPos.z);
      }
    }
  }

  const tracks = [];
  for (const [name, track] of trackQuats.entries()) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, track.times, track.values));
  }
  for (const [name, track] of trackPos.entries()) {
    if (track.values.length) tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, track.times, track.values));
  }

  sourceSampler.stop();
  targetRig.root.updateMatrixWorld(true);

  const result = new THREE.AnimationClip(`${clip.name || 'klip'} → ${targetRig.root.name || 'UCF'}`, duration, tracks);
  result.userData = {
    retargeted: true,
    sourceClip: clip.name,
    fps,
    frames,
    hipScale: Number(hipScale.toFixed(3)),
    rootMotion,
    alignment,
    droppedTranslationM: Number(droppedTranslation.toFixed(4)),
    maxSourceTranslationM: Number(maxTranslation.toFixed(4)),
    mapped: mapping.pairs.length,
    unmappedTarget: mapping.unmappedTarget.length
  };

  return { clip: result, report: result.userData };
}

/**
 * Verifikasi hasil retarget lewat evaluasi klip yang benar-benar sudah dibakar (baked):
 *   - pose target dibaca dari AnimationMixer (bukan dari perhitungan ulang).
 *   - arah tulang target dibandingkan dengan arah yang DIHARAPKAN, yaitu arah rest target
 *     diputar oleh delta dunia tulang sumber pada frame itu.
 * Cara ini bebas dari perbedaan bind pose (A-pose vs T-pose) dan tetap menangkap kesalahan
 * nyata: nama kanal salah, urutan induk salah, tanda kuaternion terbalik, sumbu salah.
 * Kolom `sourceDeg` hanya informasi (arah mentah sumber vs target).
 */
export function verifyRetarget({ clip, sourceClip, sourceRoot, sourceAnalysis, targetRoot, targetAnalysis, mapping, samples = 8 }) {
  const sourceSampler = createClipSampler(sourceClip, sourceRoot, sourceAnalysis);
  const targetMixer = new THREE.AnimationMixer(targetRoot);
  const action = targetMixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const duration = Number(sourceClip.duration) || 0;
  const expected = new Map();
  const raw = new Map();
  const times = [];
  // lintasan (trajectory) untuk bukti independen: posisi ujung tangan/kaki relatif panggul,
  // dinormalkan tinggi panggul supaya tidak terpengaruh perbedaan skala tubuh.
  const trackRoles = ['hand_R', 'hand_L', 'foot_R', 'foot_L'];
  const trail = new Map();
  const hipsPair = mapping.pairs.find((pair) => pair.role === 'hips');
  const srcHipsBone = hipsPair ? sourceAnalysis.objects.get(hipsPair.source)?.bone : null;
  const tgtHipsBone = hipsPair ? targetAnalysis.objects.get(hipsPair.target)?.bone : null;
  const hipHeightOf = (analysis, bone) => {
    const ys = analysis.bones.map((entry) => entry.worldPos[1]);
    return Math.max(1e-6, bone.getWorldPosition(new THREE.Vector3()).y - Math.min(...ys));
  };
  for (let i = 0; i < samples; i += 1) times.push((i / Math.max(1, samples - 1)) * duration * 0.999);

  for (const time of times) {
    sourceSampler.poseAt(time);
    targetMixer.setTime(time);
    targetRoot.updateMatrixWorld(true);
    for (const pair of mapping.pairs) {
      const srcBone = sourceAnalysis.objects.get(pair.source)?.bone;
      const tgtBone = targetAnalysis.objects.get(pair.target)?.bone;
      if (!srcBone || !tgtBone) continue;
      const srcWorld = srcBone.getWorldQuaternion(new THREE.Quaternion());
      const tgtWorld = tgtBone.getWorldQuaternion(new THREE.Quaternion());
      const srcRest = new THREE.Quaternion().fromArray(sourceAnalysis.byName.get(pair.source).worldQuat);
      const tgtRest = new THREE.Quaternion().fromArray(targetAnalysis.byName.get(pair.target).worldQuat);
      const alignment = clip.userData?.alignment === 'delta' ? 'delta' : 'rest';
      const expectedWorld = alignment === 'rest'
        ? tgtRest.clone().multiply(srcRest.clone().invert()).multiply(srcWorld)
        : srcWorld.clone().multiply(srcRest.clone().invert()).multiply(tgtRest.clone());
      const srcDir = worldDirection(sourceAnalysis, pair.source, srcWorld);
      const tgtDir = worldDirection(targetAnalysis, pair.target, tgtWorld);
      const expDir = worldDirection(targetAnalysis, pair.target, expectedWorld);
      if (!srcDir || !tgtDir || !expDir) continue;
      const push = (map, value) => {
        const list = map.get(pair) || [];
        list.push(value);
        map.set(pair, list);
      };
      push(expected, (tgtDir.angleTo(expDir) * 180) / Math.PI);
      push(raw, (srcDir.angleTo(tgtDir) * 180) / Math.PI);
    }

    if (srcHipsBone && tgtHipsBone) {
      const srcHipsPos = srcHipsBone.getWorldPosition(new THREE.Vector3());
      const tgtHipsPos = tgtHipsBone.getWorldPosition(new THREE.Vector3());
      const srcScale = 1 / hipHeightOf(sourceAnalysis, srcHipsBone);
      const tgtScale = 1 / hipHeightOf(targetAnalysis, tgtHipsBone);
      for (const role of trackRoles) {
        const pair = mapping.pairs.find((item) => item.role === role);
        if (!pair) continue;
        const srcBone = sourceAnalysis.objects.get(pair.source)?.bone;
        const tgtBone = targetAnalysis.objects.get(pair.target)?.bone;
        if (!srcBone || !tgtBone) continue;
        const srcLocal = srcBone.getWorldPosition(new THREE.Vector3()).sub(srcHipsPos).multiplyScalar(srcScale);
        const tgtLocal = tgtBone.getWorldPosition(new THREE.Vector3()).sub(tgtHipsPos).multiplyScalar(tgtScale);
        const list = trail.get(role) || [];
        list.push({ src: srcLocal, tgt: tgtLocal });
        trail.set(role, list);
      }
    }
  }

  const correlation = (pairsList, axis) => {
    const xs = pairsList.map((item) => item.src[axis]);
    const ys = pairsList.map((item) => item.tgt[axis]);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i += 1) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    if (dx < 1e-12 || dy < 1e-12) return 1;
    return num / Math.sqrt(dx * dy);
  };
  const trajectories = [...trail.entries()].map(([role, list]) => {
    const rhos = ['x', 'y', 'z'].map((axis) => Number(correlation(list, axis).toFixed(3)));
    const sideAgree = list.filter((item) => Math.sign(item.src.x) === Math.sign(item.tgt.x)).length / list.length;
    return {
      role,
      rhoX: rhos[0],
      rhoY: rhos[1],
      rhoZ: rhos[2],
      rhoMean: Number((rhos.reduce((a, b) => a + b, 0) / 3).toFixed(3)),
      sideAgree: Number(sideAgree.toFixed(2)),
      samples: list.length
    };
  });

  sourceSampler.stop();
  targetMixer.stopAllAction();
  targetMixer.uncacheRoot(targetRoot);

  const rows = [...expected.entries()].map(([pair, list]) => {
    const rawList = raw.get(pair) || [0];
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return {
      source: pair.source,
      target: pair.target,
      role: pair.role,
      meanDeg: Number(mean.toFixed(2)),
      maxDeg: Number(Math.max(...list).toFixed(2)),
      sourceDeg: Number((rawList.reduce((a, b) => a + b, 0) / rawList.length).toFixed(1))
    };
  });
  const worst = rows.reduce((max, row) => Math.max(max, row.maxDeg), 0);
  const mean = rows.length ? rows.reduce((sum, row) => sum + row.meanDeg, 0) / rows.length : 0;
  return {
    rows,
    meanDeg: Number(mean.toFixed(2)),
    worstDeg: Number(worst.toFixed(1)),
    worstPair: rows.reduce((worstRow, row) => (!worstRow || row.maxDeg > worstRow.maxDeg ? row : worstRow), null),
    trajectories,
    minTrajectoryRho: trajectories.length ? Math.min(...trajectories.map((item) => item.rhoMean)) : 0,
    minSideAgreement: trajectories.length ? Math.min(...trajectories.map((item) => item.sideAgree)) : 0,
    samples: times.map((time) => Number(time.toFixed(3)))
  };
}

/**
 * Pengangkatan (grounding) klip hasil retarget.
 *
 * Klip sumber punya tinggi panggul sendiri dan kerap membuat kaki menembus lantai
 * setelah diskalakan ke karakter UCF. Dua mode:
 *   - contact : titik terendah telapak dibuat tepat 0 setiap frame (dipakai bila rentang
 *               titik terendah klip < 60 mm, artinya selalu ada kaki menapak).
 *   - clamp   : badan hanya dinaikkan saat menembus lantai; fase melayang dibiarkan.
 * Koreksi diterapkan pada track posisi panggul, lalu diukur ulang supaya angka yang
 * dilaporkan benar-benar berasal dari klip akhir.
 */
function footMeshesOf(root) {
  const list = [];
  root.traverse((object) => {
    if (object.isMesh && !object.userData?.ucfHelper && /^(Foot_Mesh_|Foot_)/.test(object.name)) list.push(object);
  });
  return list;
}

export function groundClip({ rig, clip, mode = 'auto', maxCorrection = 0.35 }) {
  const root = rig.root;
  const feet = footMeshesOf(root);
  if (!feet.length) return { clip, report: { applied: false, reason: 'Mesh telapak tidak ditemukan.' } };
  const hipsTrackIndex = clip.tracks.findIndex((track) => /\.position$/.test(track.name) && /Hips/.test(track.name));
  if (hipsTrackIndex < 0) return { clip, report: { applied: false, reason: 'Track posisi panggul tidak ada.' } };

  const measure = (testClip) => {
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(testClip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const times = testClip.tracks[hipsTrackIndex].times;
    const lows = [];
    for (let i = 0; i < times.length; i += 1) {
      mixer.setTime(times[i]);
      root.updateMatrixWorld(true);
      lows.push(lowestMeshPoint(root, feet));
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    return { times, lows };
  };

  const before = measure(clip);
  const minLow = Math.min(...before.lows);
  const maxLow = Math.max(...before.lows);
  const chosen = mode === 'auto' ? (maxLow - minLow < 0.06 ? 'contact' : 'clamp') : mode;
  const corrections = before.lows.map((low) => {
    const wanted = chosen === 'contact' ? -low : Math.max(0, -low);
    return Math.max(-maxCorrection, Math.min(maxCorrection, wanted));
  });

  const tracks = clip.tracks.map((track, index) => {
    if (index !== hipsTrackIndex) return track;
    const values = Float32Array.from(track.values);
    for (let i = 0; i < corrections.length; i += 1) values[i * 3 + 1] += corrections[i];
    return new THREE.VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
  });
  const adjusted = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  adjusted.userData = {
    ...clip.userData,
    grounded: chosen,
    groundCorrectionMinM: Number(Math.min(...corrections).toFixed(4)),
    groundCorrectionMaxM: Number(Math.max(...corrections).toFixed(4)),
    minFootBeforeGroundM: Number(minLow.toFixed(4))
  };

  const after = measure(adjusted);
  adjusted.userData.minFootAfterGroundM = Number(Math.min(...after.lows).toFixed(4));
  adjusted.userData.maxFootAfterGroundM = Number(Math.max(...after.lows).toFixed(4));
  return {
    clip: adjusted,
    report: {
      applied: true,
      mode: chosen,
      frames: corrections.length,
      minFootBeforeM: Number(minLow.toFixed(4)),
      minFootAfterM: adjusted.userData.minFootAfterGroundM,
      maxFootAfterM: adjusted.userData.maxFootAfterGroundM,
      correctionMinM: adjusted.userData.groundCorrectionMinM,
      correctionMaxM: adjusted.userData.groundCorrectionMaxM
    }
  };
}

export { DEG };
