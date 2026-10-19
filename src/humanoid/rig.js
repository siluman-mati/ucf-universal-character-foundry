/**
 * UCF Tahap 3 — kerangka (skeleton), skin weights, dan pengukuran deformasi.
 * Semua posisi tulang diturunkan dari geometri yang benar-benar dibangun,
 * sehingga skeleton selalu mengikuti parameter karakter.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;

export const POSE_ANGLES = Object.freeze({
  T: { shoulder: 90, elbow: 0, foot: 0 },
  A: { shoulder: 45, elbow: 5, foot: 4 },
  netral: { shoulder: 12, elbow: 9, foot: 7 }
});

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const SIDES = ['R', 'L'];

function worldPosition(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lengthSq > 1e-12) {
    t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lengthSq, 0, 1);
  }
  const px = start.x + dx * t;
  const py = start.y + dy * t;
  const pz = start.z + dz * t;
  return Math.hypot(point.x - px, point.y - py, point.z - pz);
}

/** Daftar tulang yang relevan untuk sebuah mesh (mencegah bobot bocor antar anggota badan). */
export function candidateBonesForMesh(name) {
  const sideMatch = name.match(/_([RL])(?:_|$)/);
  const side = sideMatch ? sideMatch[1] : null;

  if (name === 'Body_Torso') return ['Hips', 'Spine', 'Chest', 'Neck'];
  if (name === 'Body_Neck') return ['Chest', 'Neck', 'Head'];
  if (name === 'Body_Head') return ['Head'];
  if (!side) return ['Hips'];

  if (/^Arm_Upper_/.test(name)) return [`UpperArm_${side}`, `LowerArm_${side}`];
  if (/^Arm_Lower_/.test(name)) return [`LowerArm_${side}`, `Hand_${side}`];
  if (/^Joint_Shoulder_/.test(name)) return ['Chest', `UpperArm_${side}`];
  if (/^Joint_Elbow_/.test(name)) return [`UpperArm_${side}`, `LowerArm_${side}`];
  if (/^Joint_Wrist_/.test(name)) return [`LowerArm_${side}`, `Hand_${side}`];
  if (/^Palm_/.test(name)) return [`Hand_${side}`];

  const finger = name.match(/^Finger_(Index|Middle|Ring|Pinky)_([RL])_(\d)$/);
  if (finger) {
    const [, fingerName, fingerSide] = finger;
    return [1, 2, 3].map((segment) => `Finger_${fingerName}_${fingerSide}_${segment}`);
  }
  if (/^Thumb_/.test(name)) return [`Thumb_${side}_1`, `Thumb_${side}_2`];

  if (/^Leg_Thigh_/.test(name)) return [`UpperLeg_${side}`, `LowerLeg_${side}`];
  if (/^Leg_Calf_/.test(name)) return [`LowerLeg_${side}`, `Foot_${side}`];
  if (/^Joint_Knee_/.test(name)) return [`UpperLeg_${side}`, `LowerLeg_${side}`];
  if (/^Joint_Ankle_/.test(name)) return [`LowerLeg_${side}`, `Foot_${side}`];
  if (/^Foot_Mesh_/.test(name)) return [`Foot_${side}`, `Toe_${side}`];

  return ['Hips'];
}

function buildBoneDefinitions(content, { params, s }) {
  const find = (name) => content.getObjectByName(name);
  const body = find('Body');
  const bodyY = body ? body.position.y : 0;
  const torsoLength = params.torsoLength * s;
  const neckLength = params.neckLength * s;
  const headHeight = params.headHeight * s * params.headScale;

  const hips = new THREE.Vector3(0, bodyY, 0);
  const spine = new THREE.Vector3(0, bodyY + torsoLength * 0.34, 0);
  const chest = new THREE.Vector3(0, bodyY + torsoLength * 0.72, 0);
  const neck = new THREE.Vector3(0, bodyY + torsoLength, 0);
  const head = new THREE.Vector3(0, bodyY + torsoLength + neckLength, 0);
  const headTop = new THREE.Vector3(0, head.y + headHeight, 0);

  const defs = [
    { name: 'Root', parent: null, position: new THREE.Vector3(0, 0, 0) },
    { name: 'Hips', parent: 'Root', position: hips },
    { name: 'Spine', parent: 'Hips', position: spine },
    { name: 'Chest', parent: 'Spine', position: chest },
    { name: 'Neck', parent: 'Chest', position: neck },
    { name: 'Head', parent: 'Neck', position: head },
    { name: 'HeadTop', parent: 'Head', position: headTop }
  ];

  const add = (name, parent, position) => defs.push({ name, parent, position });

  for (const side of SIDES) {
    const arm = find(`Arm_${side}`);
    const elbow = find(`Elbow_${side}`);
    const wrist = find(`Wrist_${side}`);
    if (arm && elbow && wrist) {
      const shoulder = worldPosition(arm);
      add(`Clavicle_${side}`, 'Chest', chest.clone());
      add(`UpperArm_${side}`, `Clavicle_${side}`, shoulder);
      add(`LowerArm_${side}`, `UpperArm_${side}`, worldPosition(elbow));
      add(`Hand_${side}`, `LowerArm_${side}`, worldPosition(wrist));

      for (const finger of FINGERS) {
        const root = find(`Finger_${finger}_${side}`);
        const joint1 = find(`Finger_${finger}_${side}_J2`);
        const joint2 = find(`Finger_${finger}_${side}_J3`);
        if (!root || !joint1 || !joint2) continue;
        add(`Finger_${finger}_${side}_1`, `Hand_${side}`, worldPosition(root));
        add(`Finger_${finger}_${side}_2`, `Finger_${finger}_${side}_1`, worldPosition(joint1));
        add(`Finger_${finger}_${side}_3`, `Finger_${finger}_${side}_2`, worldPosition(joint2));
      }

      const thumb = find(`Thumb_${side}`);
      const thumbJoint = find(`Thumb_${side}_J2`);
      if (thumb && thumbJoint) {
        add(`Thumb_${side}_1`, `Hand_${side}`, worldPosition(thumb));
        add(`Thumb_${side}_2`, `Thumb_${side}_1`, worldPosition(thumbJoint));
      }
    }

    const leg = find(`Leg_${side}`);
    const knee = find(`Knee_${side}`);
    const ankle = find(`Ankle_${side}`);
    if (leg && knee && ankle) {
      add(`UpperLeg_${side}`, 'Hips', worldPosition(leg));
      add(`LowerLeg_${side}`, `UpperLeg_${side}`, worldPosition(knee));
      add(`Foot_${side}`, `LowerLeg_${side}`, worldPosition(ankle));

      const footMesh = find(`Foot_Mesh_${side}`);
      if (footMesh) {
        const box = new THREE.Box3().setFromObject(footMesh);
        const toe = new THREE.Vector3(
          (box.min.x + box.max.x) / 2,
          box.min.y + (box.max.y - box.min.y) * 0.25,
          box.max.z - (box.max.z - box.min.z) * 0.06
        );
        add(`Toe_${side}`, `Foot_${side}`, toe);
      }
    }
  }

  return defs;
}

function createBoneHierarchy(defs) {
  const positions = new Map(defs.map((def) => [def.name, def.position]));
  const bones = new Map();
  const list = [];

  for (const def of defs) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    const parentPosition = def.parent ? positions.get(def.parent) : null;
    bone.position.copy(def.position);
    if (parentPosition) bone.position.sub(parentPosition);
    if (def.parent) bones.get(def.parent).add(bone);
    bones.set(def.name, bone);
    list.push(bone);
  }

  return { bones, list, root: bones.get('Root') };
}

function boneSegments(list) {
  const indexByName = new Map(list.map((bone, index) => [bone.name, index]));
  const segments = list.map((bone) => {
    const start = bone.getWorldPosition(new THREE.Vector3());
    let end;
    if (bone.children.length) {
      end = bone.children[0].getWorldPosition(new THREE.Vector3());
    } else {
      const parent = bone.parent;
      const direction = parent
        ? start.clone().sub(parent.getWorldPosition(new THREE.Vector3()))
        : new THREE.Vector3(0, 1, 0);
      if (direction.lengthSq() < 1e-10) direction.set(0, 1, 0);
      end = start.clone().addScaledVector(direction.normalize(), 0.035);
    }
    return { index: indexByName.get(bone.name), name: bone.name, start, end };
  });
  return { segments, indexByName };
}

function computeSkin(geometry, candidateNames, segments, indexByName) {
  const position = geometry.getAttribute('position');
  const count = position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);

  const entries = candidateNames
    .map((name) => segments.find((segment) => segment.name === name))
    .filter(Boolean);
  const fallback = segments[0];

  const point = new THREE.Vector3();
  let unweighted = 0;
  let maxInfluences = 0;
  let maxSumError = 0;

  for (let i = 0; i < count; i += 1) {
    point.fromBufferAttribute(position, i);
    const distances = (entries.length ? entries : [fallback]).map((segment) => ({
      index: segment.index,
      distance: pointSegmentDistance(point, segment.start, segment.end)
    }));
    distances.sort((a, b) => a.distance - b.distance);

    let influences;
    if (distances.length === 1 || distances[0].distance < 0.004 || distances[0].distance < distances[1].distance * 0.35) {
      influences = [{ index: distances[0].index, weight: 1 }];
    } else {
      const nearest = distances[0];
      const second = distances[1];
      const w1 = 1 / Math.pow(nearest.distance + 1e-4, 2);
      const w2 = 1 / Math.pow(second.distance + 1e-4, 2);
      const total = w1 + w2;
      influences = [
        { index: nearest.index, weight: w1 / total },
        { index: second.index, weight: w2 / total }
      ];
    }

    if (influences.length > maxInfluences) maxInfluences = influences.length;
    let sum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const influence = influences[slot];
      if (influence) {
        skinIndex[i * 4 + slot] = influence.index;
        skinWeight[i * 4 + slot] = influence.weight;
        sum += influence.weight;
      } else {
        skinIndex[i * 4 + slot] = 0;
        skinWeight[i * 4 + slot] = 0;
      }
    }
    if (sum <= 0) unweighted += 1;
    maxSumError = Math.max(maxSumError, Math.abs(1 - sum));
  }

  return { skinIndex, skinWeight, stats: { vertices: count, unweighted, maxInfluences, maxSumError } };
}

/**
 * Ubah hierarki mesh biasa menjadi SkinnedMesh + skeleton.
 * Geometri dibakar ke ruang bind, bobot dihitung dari jarak ke ruas tulang.
 */
export function rigify(content, { params, s, pose = 'T' } = {}) {
  content.updateMatrixWorld(true);

  const defs = buildBoneDefinitions(content, { params, s });
  const { bones, list, root: rootBone } = createBoneHierarchy(defs);

  const rigRoot = new THREE.Group();
  rigRoot.name = 'UCF_Content';
  rigRoot.add(rootBone);
  rigRoot.updateMatrixWorld(true);

  const { segments, indexByName } = boneSegments(list);
  const skeleton = new THREE.Skeleton(list);

  const meshes = [];
  content.traverse((object) => {
    if (object.isMesh && !object.userData?.ucfHelper) meshes.push(object);
  });

  let totalVertices = 0;
  let unweighted = 0;
  let maxInfluences = 0;
  let maxSumError = 0;
  let skinnedMeshes = 0;

  for (const source of meshes) {
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

    const candidates = candidateBonesForMesh(source.name);
    const skin = computeSkin(geometry, candidates, segments, indexByName);
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin.skinWeight, 4));

    const mesh = new THREE.SkinnedMesh(geometry, source.material);
    mesh.name = source.name;
    mesh.userData = { ...source.userData };
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.bind(skeleton, new THREE.Matrix4());
    rigRoot.add(mesh);

    skinnedMeshes += 1;
    totalVertices += skin.stats.vertices;
    unweighted += skin.stats.unweighted;
    maxInfluences = Math.max(maxInfluences, skin.stats.maxInfluences);
    maxSumError = Math.max(maxSumError, skin.stats.maxSumError);
  }

  const rig = {
    root: rigRoot,
    bones,
    list,
    skeleton,
    pose,
    stats: { bones: list.length, skinnedMeshes, vertices: totalVertices, unweighted, maxInfluences, maxSumError }
  };

  applyPose(rig, pose);
  rigRoot.updateMatrixWorld(true);
  return rig;
}

/**
 * Beri skin weights pada geometri modul memakai tulang rig yang sudah ada.
 * Geometri harus berada di ruang lokal `rig.root` (ruang bind).
 * Tidak menambah tulang dan tidak mengubah bobot mesh badan.
 */
export function skinGeometryForRig(geometry, candidateNames, rig) {
  rig.root.updateMatrixWorld(true);
  const inverse = rig.root.matrixWorld.clone().invert();
  const indexByName = new Map(rig.list.map((bone, index) => [bone.name, index]));
  const segments = rig.list.map((bone) => {
    const start = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
    let end;
    const boneChild = bone.children.find((child) => child.isBone);
    if (boneChild) {
      end = boneChild.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
    } else {
      const parent = bone.parent;
      const direction = parent?.isBone
        ? start.clone().sub(parent.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse))
        : new THREE.Vector3(0, 1, 0);
      if (direction.lengthSq() < 1e-10) direction.set(0, 1, 0);
      end = start.clone().addScaledVector(direction.normalize(), 0.035);
    }
    return { index: indexByName.get(bone.name), name: bone.name, start, end };
  });

  const skin = computeSkin(geometry, candidateNames, segments, indexByName);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin.skinWeight, 4));
  return skin.stats;
}

/** Posisi tulang dalam ruang lokal rig.root (ruang bind), untuk menyusun modul. */
export function boneLocalPosition(rig, name) {
  rig.root.updateMatrixWorld(true);
  const bone = rig.bones.get(name);
  if (!bone) return null;
  return rig.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
}

/** Kembalikan rotasi semua tulang ke nol. */
export function resetBones(rig) {
  for (const bone of rig.list) bone.rotation.set(0, 0, 0);
}

/** Terapkan pose T/A/netral lewat rotasi tulang (mesh terdeformasi karena skinning). */
export function applyPose(rig, pose) {
  const angles = POSE_ANGLES[pose] || POSE_ANGLES.T;
  resetBones(rig);
  for (const side of SIDES) {
    const sign = side === 'R' ? 1 : -1;
    const upper = rig.bones.get(`UpperArm_${side}`);
    const lower = rig.bones.get(`LowerArm_${side}`);
    const hand = rig.bones.get(`Hand_${side}`);
    const foot = rig.bones.get(`Foot_${side}`);
    if (upper) upper.rotation.z = -sign * (90 - angles.shoulder) * DEG;
    if (lower) lower.rotation.z = -sign * angles.elbow * DEG;
    if (hand) hand.rotation.z = 0;
    if (foot) foot.rotation.y = sign * angles.foot * DEG;
  }
  rig.pose = POSE_ANGLES[pose] ? pose : 'T';
  rig.root.updateMatrixWorld(true);
}

function forEachMesh(root) {
  const meshes = [];
  root.traverse((object) => {
    if (object.isMesh && !object.userData?.ucfHelper) meshes.push(object);
  });
  return meshes;
}

/** Posisi verteks dunia setelah skinning (CPU). */
export function forEachWorldVertex(root, callback) {
  root.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  for (const mesh of forEachMesh(root)) {
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      callback(mesh, i, vertex);
    }
  }
}

/** Bounding box dunia yang memperhitungkan deformasi skinning. */
export function computeDeformedBounds(root) {
  const box = new THREE.Box3();
  forEachWorldVertex(root, (mesh, index, vertex) => box.expandByPoint(vertex));
  if (box.isEmpty()) box.setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray(), center: center.toArray(), box };
}

function captureWorldPositions(root) {
  const map = new Map();
  for (const mesh of forEachMesh(root)) {
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    map.set(mesh.uuid, { mesh, positions: new Float32Array(position.count * 3) });
  }
  root.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  for (const mesh of forEachMesh(root)) {
    const entry = map.get(mesh.uuid);
    if (!entry) continue;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      entry.positions[i * 3] = vertex.x;
      entry.positions[i * 3 + 1] = vertex.y;
      entry.positions[i * 3 + 2] = vertex.z;
    }
  }
  return map;
}

function maxDelta(before, after, meshFilter) {
  let max = 0;
  let moved = 0;
  for (const [uuid, entry] of before) {
    const other = after.get(uuid);
    if (!other) continue;
    if (meshFilter && !meshFilter(entry.mesh)) continue;
    const a = entry.positions;
    const b = other.positions;
    for (let i = 0; i < a.length; i += 3) {
      const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
      if (d > max) max = d;
    }
    for (let i = 0; i < a.length; i += 3) {
      if (Math.abs(a[i] - b[i]) > 1e-4 || Math.abs(a[i + 1] - b[i + 1]) > 1e-4 || Math.abs(a[i + 2] - b[i + 2]) > 1e-4) {
        moved += 1;
      }
    }
  }
  return { maxDisplacement: max, movedVertices: moved };
}

/**
 * Uji deformasi nyata: putar satu tulang, ukur perpindahan verteks,
 * lalu kembalikan pose dan pastikan kembali ke bentuk semula.
 */
export function measureDeformation(rig, { boneName = 'LowerArm_R', axis = 'z', angleDeg = 45 } = {}) {
  const bone = rig.bones.get(boneName);
  if (!bone) return { ok: false, error: `Tulang "${boneName}" tidak ada.` };

  rig.root.updateMatrixWorld(true);
  const before = captureWorldPositions(rig.root);

  const previous = bone.rotation[axis];
  bone.rotation[axis] = previous + angleDeg * DEG;
  rig.root.updateMatrixWorld(true);
  const after = captureWorldPositions(rig.root);

  const headWeighted = (mesh) => /^(Body_Head|Body_Neck)$/.test(mesh.name);
  const overall = maxDelta(before, after);
  const head = maxDelta(before, after, headWeighted);

  bone.rotation[axis] = previous;
  rig.root.updateMatrixWorld(true);
  const reset = captureWorldPositions(rig.root);
  const resetError = maxDelta(before, reset).maxDisplacement;

  return {
    ok: true,
    bone: boneName,
    axis,
    angleDeg,
    maxDisplacement: overall.maxDisplacement,
    movedVertices: overall.movedVertices,
    headDisplacement: head.maxDisplacement,
    resetError,
    vertices: rig.stats.vertices
  };
}

/** Ringkasan skeleton untuk panel/laporan. */
export function describeRig(rig) {
  if (!rig) return null;
  const bones = rig.list.map((bone) => ({
    name: bone.name,
    parent: bone.parent?.isBone ? bone.parent.name : null,
    children: bone.children.filter((child) => child.isBone).length,
    position: bone.getWorldPosition(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(4)))
  }));
  return { ...rig.stats, pose: rig.pose, bonesList: bones };
}
