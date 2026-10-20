/**
 * UCF Tahap 5 — klip animasi native untuk karakter UCF.
 *
 * Klip disusun dari pose parametrik per fase (idle, walk, run, jump, wave), lalu
 * di-bake menjadi AnimationClip berisi track quaternion untuk SELURUH 51 tulang
 * (supaya klip selalu mendefinisikan pose penuh) ditambah track posisi panggul.
 *
 * Klip berjalan melewati penyesuaian ketinggian panggul per frame ("foot grounding"):
 * titik terendah telapak kaki diukur dari verteks mesh sepatu setelah skinning, lalu
 * panggul digeser sehingga telapak menyentuh lantai tanpa membuat karakter melayang
 * atau tenggelam. Koreksi maksimum dicatat di userData klip.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const NATIVE_CLIPS = Object.freeze([
  { id: 'idle', name: 'Idle UCF', duration: 2.4, loop: true, ground: 'contact', description: 'Napas halus, berat badan bergeser pelan.' },
  { id: 'walk', name: 'Walk UCF', duration: 1.0, loop: true, ground: 'contact', description: 'Siklus jalan dua langkah, kaki menapak lantai.' },
  { id: 'run', name: 'Run UCF', duration: 0.72, loop: true, ground: 'align', description: 'Lari dengan fase melayang; kontak terendah disejajarkan ke lantai.' },
  { id: 'jump', name: 'Jump UCF', duration: 1.2, loop: false, ground: 'clamp', description: 'Jongkok, tolak, melayang, mendarat tanpa menembus lantai.' },
  { id: 'wave', name: 'Wave UCF', duration: 2.0, loop: true, ground: 'contact', description: 'Tangan kanan melambai.' }
]);

const SIDES = ['R', 'L'];

function bone(rig, name) {
  return rig.bones.get(name) || null;
}

function rot(rig, name, x = 0, y = 0, z = 0) {
  const target = bone(rig, name);
  if (target) target.rotation.set(x, y, z);
}

function fingers(rig, side, curl, spread = 0) {
  const sign = side === 'R' ? 1 : -1;
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
    for (let joint = 1; joint <= 3; joint += 1) {
      const factor = joint === 1 ? 1 : joint === 2 ? 1.15 : 0.9;
      rot(rig, `Finger_${finger}_${side}_${joint}`, 0, spread * sign * joint * 0.4, -sign * curl * factor);
    }
  }
  rot(rig, `Thumb_${side}_1`, 0, 0, -sign * curl * 0.5);
  rot(rig, `Thumb_${side}_2`, 0, 0, -sign * curl * 0.6);
}

/** Pose dasar berdiri: lengan turun dari T-pose, siku sedikit menekuk. */
function armsDown(rig, { shoulderDeg = 72, elbowDeg = 14, swingR = 0, swingL = 0, twist = 0 } = {}) {
  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    const swing = side === 'R' ? swingR : swingL;
    // shoulderDeg = sudut turun dari garis bahu horizontal; 72° ≈ lengan di samping badan.
    rot(rig, `UpperArm_${side}`, -swing, 0, -sign * shoulderDeg * DEG);
    rot(rig, `LowerArm_${side}`, 0, 0, -sign * elbowDeg * DEG);
    rot(rig, `Hand_${side}`, 0, twist * sign, 0);
  }
}

/* ------------------------------------------------------------------ */
/* pose parametrik                                                     */
/* ------------------------------------------------------------------ */

function idlePose(rig, phase) {
  const p = phase * TAU;
  const breathe = Math.sin(p) * 1.6 * DEG;
  const sway = Math.sin(p) * 1.2 * DEG;
  rot(rig, 'Hips', 0, sway * 0.5, 0);
  bone(rig, 'Hips').position.y += Math.sin(p) * 0.004;
  rot(rig, 'Spine', breathe * 0.4, sway * 0.4, 0);
  rot(rig, 'Chest', breathe, -sway * 0.3, 0);
  rot(rig, 'Neck', -breathe * 0.4, 0, 0);
  rot(rig, 'Head', -breathe * 0.5, Math.sin(p + 0.6) * 2.2 * DEG, 0);
  armsDown(rig, {
    shoulderDeg: 74 + Math.sin(p) * 1.2,
    elbowDeg: 15 + Math.sin(p + 0.4) * 1.5,
    swingR: Math.sin(p + 0.3) * 1.2 * DEG,
    swingL: Math.sin(p + 0.3) * 1.2 * DEG
  });
  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    rot(rig, `UpperLeg_${side}`, 0, 0, sign * 0.8 * DEG);
    rot(rig, `LowerLeg_${side}`, 1.2 * DEG, 0, 0);
    rot(rig, `Foot_${side}`, -1.0 * DEG, 0, 0);
    fingers(rig, side, 10 * DEG + Math.sin(p) * 1.5 * DEG);
  }
}

function walkPose(rig, phase) {
  const p = phase * TAU;
  const hipA = 0.44;
  const kneeA = 1.0;
  const armA = 0.34;

  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    const phi = p + (side === 'R' ? 0 : Math.PI);
    const hip = -hipA * Math.cos(phi); // p=0: kaki ini di depan
    const swing = Math.max(0, -Math.sin(phi)) ** 1.25; // fase ayun p∈(0.5,1)
    const contact = Math.max(0, Math.cos(phi)) ** 2;
    const knee = kneeA * swing + 0.16 * contact + 0.05;
    const ankle = -(hip + knee) * 0.5 - 0.22 * Math.max(0, Math.sin(phi - 2.2)) ** 2;
    rot(rig, `UpperLeg_${side}`, hip, 0, sign * 1.5 * DEG);
    rot(rig, `LowerLeg_${side}`, knee, 0, 0);
    rot(rig, `Foot_${side}`, ankle, 0, 0);
    rot(rig, `Toe_${side}`, Math.max(0, Math.sin(phi - 2.4)) * 0.5, 0, 0);
    fingers(rig, side, 16 * DEG);
  }

  // lengan berayun berlawanan dengan kaki
  armsDown(rig, {
    shoulderDeg: 74,
    elbowDeg: 20,
    swingR: -armA * Math.cos(p),
    swingL: armA * Math.cos(p)
  });
  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    rot(rig, `Hand_${side}`, 0, 0, -sign * 6 * DEG);
  }

  bone(rig, 'Hips').position.y += 0.012 * Math.cos(2 * p);
  rot(rig, 'Hips', 0, -0.10 * Math.sin(p), 0.03 * Math.sin(p));
  rot(rig, 'Spine', 0, 0.05 * Math.sin(p), 0);
  rot(rig, 'Chest', 0, 0.09 * Math.sin(p), -0.02 * Math.sin(p));
  rot(rig, 'Neck', 0.02, -0.04 * Math.sin(p), 0);
  rot(rig, 'Head', 0.02, -0.05 * Math.sin(p), 0);
}

function runPose(rig, phase) {
  const p = phase * TAU;
  const hipA = 0.72;
  const kneeA = 1.18;

  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    const phi = p + (side === 'R' ? 0 : Math.PI);
    const hip = -hipA * Math.sin(phi);
    const bend = kneeA * Math.max(0, Math.sin(phi - 0.7)) ** 1.2 + 0.16;
    rot(rig, `UpperLeg_${side}`, hip, 0, sign * 1.5 * DEG);
    rot(rig, `LowerLeg_${side}`, bend, 0, 0);
    rot(rig, `Foot_${side}`, -(hip + bend) * 0.5, 0, 0);
    rot(rig, `Toe_${side}`, 0.15, 0, 0);
    fingers(rig, side, 40 * DEG);
  }
  armsDown(rig, { shoulderDeg: 66, elbowDeg: 78, swingR: -0.6 * Math.sin(p), swingL: 0.6 * Math.sin(p) });
  rot(rig, 'Hips', -0.06, -0.14 * Math.sin(p), 0.05 * Math.sin(p));
  bone(rig, 'Hips').position.y += 0.03 * Math.cos(2 * p) + 0.02;
  rot(rig, 'Spine', 0.10, 0.08 * Math.sin(p), 0);
  rot(rig, 'Chest', 0.12, 0.12 * Math.sin(p), 0);
  rot(rig, 'Neck', -0.10, -0.06 * Math.sin(p), 0);
  rot(rig, 'Head', -0.08, 0, 0);
}

function jumpPose(rig, phase) {
  // 0 – 0.25 jongkok, 0.25 – 0.55 tolak & melayang, 0.55 – 0.8 turun, 0.8 – 1 mendarat
  const t = phase;
  let crouch = 0;
  let lift = 0;
  if (t < 0.25) crouch = Math.sin((t / 0.25) * (Math.PI / 2));
  else if (t < 0.55) { crouch = 1 - Math.min(1, (t - 0.25) / 0.15); lift = Math.sin(((t - 0.25) / 0.3) * Math.PI) * 0.55; }
  else if (t < 0.8) lift = Math.max(0, 1 - (t - 0.55) / 0.25) * 0.35;
  else crouch = Math.sin(((t - 0.8) / 0.2) * Math.PI) * 0.6;

  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    rot(rig, `UpperLeg_${side}`, -0.75 * crouch, 0, sign * 1.5 * DEG);
    rot(rig, `LowerLeg_${side}`, 1.30 * crouch, 0, 0);
    rot(rig, `Foot_${side}`, -0.7 * crouch, 0, 0);
    fingers(rig, side, 20 * DEG);
  }
  armsDown(rig, { shoulderDeg: 74 - 40 * crouch, elbowDeg: 18 + 40 * crouch, swingR: -0.5 * crouch, swingL: -0.5 * crouch });
  bone(rig, 'Hips').position.y += -0.28 * crouch + lift;
  rot(rig, 'Spine', 0.30 * crouch, 0, 0);
  rot(rig, 'Chest', 0.18 * crouch, 0, 0);
  rot(rig, 'Head', -0.2 * crouch, 0, 0);
}

function wavePose(rig, phase) {
  const p = phase * TAU;
  idlePose(rig, phase);
  const wave = Math.sin(p * 2) * 0.45;
  // lengan kanan diangkat lurus ke atas lalu melambai
  rot(rig, 'UpperArm_R', -0.35, 0, 80 * DEG);
  rot(rig, 'LowerArm_R', 0, 0, 0.35 + wave * 0.25);
  rot(rig, 'Hand_R', 0, 0, wave * 0.35);
  fingers(rig, 'R', 6 * DEG);
}

export const POSE_FUNCTIONS = Object.freeze({ idle: idlePose, walk: walkPose, run: runPose, jump: jumpPose, wave: wavePose });

/* ------------------------------------------------------------------ */
/* baking                                                              */
/* ------------------------------------------------------------------ */

function footMeshes(rig) {
  const meshes = [];
  rig.root.traverse((object) => {
    if (object.isMesh && /^(Foot_Mesh_|Foot_)/.test(object.name)) meshes.push(object);
  });
  return meshes;
}

/** Titik terendah verteks sepatu/kaki setelah skinning, dalam ruang rig.root. */
export function lowestFootPoint(rig) {
  rig.root.updateMatrixWorld(true);
  const inverse = rig.root.matrixWorld.clone().invert();
  const meshes = footMeshes(rig);
  let lowest = Infinity;
  let point = null;
  const vector = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    for (let i = 0; i < position.count; i += 1) {
      mesh.getVertexPosition(i, vector);
      vector.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      if (vector.y < lowest) { lowest = vector.y; point = vector.clone(); }
    }
  }
  return { y: lowest, point };
}

/** Titik terendah seluruh mesh setelah skinning (untuk cek "tidak tenggelam"). */
export function lowestBodyPoint(rig) {
  rig.root.updateMatrixWorld(true);
  const inverse = rig.root.matrixWorld.clone().invert();
  let lowest = Infinity;
  const vector = new THREE.Vector3();
  rig.root.traverse((object) => {
    if (!object.isMesh || object.userData?.ucfHelper) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      object.getVertexPosition(i, vector);
      vector.applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
      if (vector.y < lowest) lowest = vector.y;
    }
  });
  return lowest;
}

function saveRest(rig) {
  return rig.list.map((item) => ({
    bone: item,
    quat: item.quaternion.clone(),
    pos: item.position.clone(),
    rot: item.rotation.clone()
  }));
}

function restoreRest(store) {
  for (const item of store) {
    item.bone.quaternion.copy(item.quat);
    item.bone.position.copy(item.pos);
  }
}

/**
 * Bake klip native untuk rig tertentu.
 * @returns {{clip: THREE.AnimationClip, meta: object}}
 */
export function buildNativeClip(rig, clipId, { fps = 30 } = {}) {
  const definition = NATIVE_CLIPS.find((item) => item.id === clipId);
  if (!definition) throw new Error(`Klip native "${clipId}" tidak dikenal.`);
  const poseFn = POSE_FUNCTIONS[clipId];
  const frames = Math.max(2, Math.round(definition.duration * fps) + 1);
  const times = [];
  for (let i = 0; i < frames; i += 1) times.push(Number(((i / (frames - 1)) * definition.duration).toFixed(6)));
  const groundMode = typeof definition.ground === 'string' ? definition.ground : definition.ground ? 'contact' : 'none';

  const rest = saveRest(rig);
  const bones = rig.list;
  const hipsName = rig.bones.has('Hips') ? 'Hips' : bones[0].name;

  const applyPhase = (phase) => {
    restoreRest(rest);
    for (const item of rest) item.bone.rotation.set(0, 0, 0);
    poseFn(rig, phase);
    rig.root.updateMatrixWorld(true);
  };

  // ---- lintasan 1: ukur titik terendah kaki per frame ----
  const rawLowest = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const phase = definition.loop ? (times[frame] / definition.duration) % 1 : Math.min(1, times[frame] / definition.duration);
    applyPhase(phase);
    rawLowest.push(lowestFootPoint(rig).y);
  }
  const globalMin = Math.min(...rawLowest);
  const offsets = rawLowest.map((value) => {
    if (groundMode === 'contact') return -value;
    if (groundMode === 'align') return -globalMin;
    if (groundMode === 'clamp') return Math.max(0, -value);
    return 0;
  });
  const maxCorrection = offsets.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

  // ---- lintasan 2: bake dengan koreksi panggul ----
  const quatValues = new Map(bones.map((item) => [item.name, []]));
  const hipsPositions = [];
  let minBodyAfter = Infinity;

  for (let frame = 0; frame < frames; frame += 1) {
    const phase = definition.loop ? (times[frame] / definition.duration) % 1 : Math.min(1, times[frame] / definition.duration);
    applyPhase(phase);
    const hips = bone(rig, hipsName);
    if (hips && offsets[frame]) {
      hips.position.y += offsets[frame];
      rig.root.updateMatrixWorld(true);
    }
    minBodyAfter = Math.min(minBodyAfter, lowestBodyPoint(rig));
    for (const item of bones) quatValues.get(item.name).push(item.quaternion.x, item.quaternion.y, item.quaternion.z, item.quaternion.w);
    if (hips) hipsPositions.push(hips.position.x, hips.position.y, hips.position.z);
  }

  restoreRest(rest);
  rig.root.updateMatrixWorld(true);

  const tracks = bones.map((item) => new THREE.QuaternionKeyframeTrack(`${item.name}.quaternion`, times, quatValues.get(item.name)));
  if (hipsPositions.length) tracks.push(new THREE.VectorKeyframeTrack(`${hipsName}.position`, times, hipsPositions));

  const clip = new THREE.AnimationClip(`UCF ${definition.name}`, definition.duration, tracks);
  clip.userData = {
    native: true,
    clipId,
    frames,
    fps,
    loop: definition.loop,
    grounded: groundMode,
    minFootBeforeM: Number(globalMin.toFixed(4)),
    maxCorrectionM: Number(maxCorrection.toFixed(4)),
    lowestPointDuringClipM: Number(minBodyAfter.toFixed(4))
  };
  return { clip, meta: clip.userData };
}

/** Semua klip native untuk rig (dibuat sekali, di-cache pemanggil). */
export function buildNativeClips(rig, options = {}) {
  return NATIVE_CLIPS.map((definition) => ({
    ...definition,
    ...buildNativeClip(rig, definition.id, options)
  }));
}
