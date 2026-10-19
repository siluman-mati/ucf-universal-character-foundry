/**
 * UCF Tahap 2 — pembangun humanoid prosedural.
 * Geometri nyata (loft torso/kepala, silinder anggota badan, kotak telapak, jari bersegmen).
 * Semua parameter dimensi memengaruhi vertex atau transform bagian tubuh.
 */
import * as THREE from 'three';
import { defaultParams, clampParam, NOMINAL_HEIGHT } from './params.js';

const DEG = Math.PI / 180;
const TORSO_SEGMENTS = 24;
const HEAD_SEGMENTS = 22;

export const POSE_ANGLES = Object.freeze({
  T: { shoulder: 90, elbow: 0, foot: 0 },
  A: { shoulder: 45, elbow: 5, foot: 4 },
  netral: { shoulder: 12, elbow: 9, foot: 7 }
});

function createMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({ name: 'Kulit', color: 0xd9a17d, roughness: 0.86, metalness: 0 }),
    shirt: new THREE.MeshStandardMaterial({ name: 'Kaos', color: 0x2f6f9f, roughness: 0.98 }),
    pants: new THREE.MeshStandardMaterial({ name: 'Celana', color: 0x27313f, roughness: 0.97 }),
    shoes: new THREE.MeshStandardMaterial({ name: 'Sepatu', color: 0x151a22, roughness: 0.78 })
  };
}

/** Silinder berarah -Y dari titik sambungan (ujung atas di y=0). */
function limbGeometry(radiusTop, radiusBottom, length, radial = 14) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radial, 1, false);
  geometry.translate(0, -length / 2, 0);
  return geometry;
}

/** Silinder berarah +Y (pangkal di y=0, tumbuh ke atas) — dipakai leher. */
function limbUpGeometry(radiusBottom, radiusTop, length, radial = 16) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radial, 1, false);
  geometry.translate(0, length / 2, 0);
  return geometry;
}

function sphereGeometry(radius, widthSegments = 14, heightSegments = 10) {
  return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
}

/**
 * Loft elips bertumpuk (torso, kepala).
 * @param {{y:number, rx:number, rz:number}[]} rings
 */
function loftGeometry(rings, segments = TORSO_SEGMENTS) {
  const positions = [];
  const indices = [];

  for (const ring of rings) {
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * ring.rx, ring.y, Math.sin(angle) * ring.rz);
    }
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = r * segments + i;
      const b = r * segments + next;
      const c = (r + 1) * segments + next;
      const d = (r + 1) * segments + i;
      indices.push(a, d, b, b, d, c);
    }
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, rings[0].y, 0);
  const topCenter = positions.length / 3;
  positions.push(0, rings[rings.length - 1].y, 0);
  const lastBase = (rings.length - 1) * segments;
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(bottomCenter, i, next);
    indices.push(topCenter, lastBase + next, lastBase + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeMesh(name, geometry, material, role) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData.ucfRole = role;
  return mesh;
}

function buildFoot(side, params, s, ankleHeight, material) {
  const group = new THREE.Group();
  group.name = `Foot_${side}`;

  const width = params.footWidth * s;
  const length = params.footLength * s;
  const height = ankleHeight;
  const geometry = new THREE.BoxGeometry(width, height, length, 2, 3, 4);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const t = (y + height / 2) / height; // 0 = sol, 1 = atas
    const x = position.getX(i);
    const z = position.getZ(i);
    // sol menjorok sedikit, bagian atas menyempit mengikuti pergelangan
    const flare = t < 0.02 ? 1.06 : 1;
    position.setX(i, x * (1 - 0.26 * t) * flare * (z > 0 ? 0.88 : 1));
    position.setZ(i, z * (1 - 0.1 * t) * flare);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.translate(0, -height / 2, length * 0.22);

  const mesh = makeMesh(`Foot_Mesh_${side}`, geometry, material, 'foot');
  group.add(mesh);
  return group;
}

function buildHand(side, params, s, material) {
  const sign = side === 'R' ? 1 : -1;
  const hand = new THREE.Group();
  hand.name = `Hand_${side}`;
  // putar pada sumbu panjang lengan: telapak menghadap bawah, jari menyebar mendatar
  hand.rotation.y = -Math.PI / 2;

  const palmLength = params.palmLength * s;
  const palmWidth = params.palmWidth * s;
  const palmThickness = 0.038 * s;

  const palmRings = [
    { y: -palmLength, rx: palmWidth * 0.46, rz: palmThickness * 0.34 },
    { y: -palmLength * 0.74, rx: palmWidth * 0.5, rz: palmThickness * 0.5 },
    { y: -palmLength * 0.32, rx: palmWidth * 0.48, rz: palmThickness * 0.5 },
    { y: -palmLength * 0.06, rx: palmWidth * 0.35, rz: palmThickness * 0.46 },
    { y: 0, rx: palmWidth * 0.42, rz: palmThickness * 0.5 }
  ];
  const palmGeometry = loftGeometry(palmRings, 18);
  hand.add(makeMesh(`Palm_${side}`, palmGeometry, material, 'hand'));

  const fingerRadius = Math.max(0.004 * s, (params.fingerThickness * s) / 2);
  const fingers = [
    { name: 'Index', length: params.fingerIndex * s, x: -0.36 },
    { name: 'Middle', length: params.fingerMiddle * s, x: -0.12 },
    { name: 'Ring', length: params.fingerRing * s, x: 0.12 },
    { name: 'Pinky', length: params.fingerPinky * s, x: 0.36 }
  ];

  for (const finger of fingers) {
    const fingerGroup = new THREE.Group();
    fingerGroup.name = `Finger_${finger.name}_${side}`;
    fingerGroup.position.set(finger.x * palmWidth, -palmLength, 0);
    let parent = fingerGroup;
    const segmentLength = finger.length / 3;
    for (let segment = 0; segment < 3; segment += 1) {
      const r0 = fingerRadius * (1 - segment * 0.08);
      const r1 = Math.max(fingerRadius * 0.55, fingerRadius * (1 - (segment + 1) * 0.12));
      const bone = makeMesh(
        `Finger_${finger.name}_${side}_${segment + 1}`,
        limbGeometry(r0, r1, segmentLength, 8),
        material,
        'finger'
      );
      parent.add(bone);
      if (segment < 2) {
        const joint = new THREE.Group();
        joint.position.y = -segmentLength;
        joint.rotation.x = -9 * DEG * (segment + 1);
        parent.add(joint);
        parent = joint;
      }
    }
    hand.add(fingerGroup);
  }

  const thumb = new THREE.Group();
  thumb.name = `Thumb_${side}`;
  thumb.position.set(-palmWidth * 0.5, -palmLength * 0.34, 0);
  thumb.rotation.z = -params.thumbAngle * DEG;
  thumb.rotation.x = -10 * DEG;
  const thumbSegment = (params.thumbLength * s) / 2;
  let thumbParent = thumb;
  for (let segment = 0; segment < 2; segment += 1) {
    const bone = makeMesh(
      `Thumb_${side}_${segment + 1}`,
      limbGeometry(fingerRadius * (1.15 - segment * 0.2), fingerRadius * 0.85, thumbSegment, 8),
      material,
      'finger'
    );
    thumbParent.add(bone);
    if (segment === 0) {
      const joint = new THREE.Group();
      joint.position.y = -thumbSegment;
      joint.rotation.x = -14 * DEG;
      thumbParent.add(joint);
      thumbParent = joint;
    }
  }
  hand.add(thumb);

  return hand;
}

/**
 * Bangun humanoid lengkap. Feet pada y=0, menghadap +Z.
 * @returns {{content: THREE.Group, params: object, pose: string, metrics: object}}
 */
export function buildHumanoid(inputParams = {}, pose = 'T') {
  const params = defaultParams();
  if (inputParams && typeof inputParams === 'object') {
    for (const [key, value] of Object.entries(inputParams)) {
      const clamped = clampParam(key, value);
      if (clamped !== null) params[key] = clamped;
    }
  }
  const poseKey = POSE_ANGLES[pose] ? pose : 'T';
  const poseAngles = POSE_ANGLES[poseKey];

  const s = params.height / NOMINAL_HEIGHT;
  const widthScale = params.bodyWidth;
  const materials = createMaterials();

  const content = new THREE.Group();
  content.name = 'UCF_Content';

  const ankleHeight = 0.075 * s;
  const calfLength = params.calfLength * s;
  const thighLength = params.thighLength * s;
  const hipY = ankleHeight + calfLength + thighLength;
  const torsoLength = params.torsoLength * s;
  const neckLength = params.neckLength * s;
  const headHeight = params.headHeight * s * params.headScale;
  const headWidth = params.headWidth * s * params.headScale;
  const headDepth = params.headDepth * s * params.headScale;
  const bodyY = hipY + params.comShift * s;

  const halfWidth = (value) => (value * 0.5) * s * widthScale;
  const halfDepth = (value) => (value * 0.5) * s;

  const body = new THREE.Group();
  body.name = 'Body';
  body.position.y = bodyY;
  content.add(body);

  /* ---------------- torso ---------------- */
  const torsoRings = [
    { y: 0, rx: halfWidth(params.hipWidth), rz: halfDepth(params.bodyThickness) * 0.92 },
    { y: torsoLength * 0.16, rx: halfWidth(params.hipWidth * 0.94), rz: halfDepth(params.bodyThickness) * 0.9 },
    { y: torsoLength * 0.45, rx: halfWidth(params.waistWidth), rz: halfDepth(params.bodyThickness) * 0.8 },
    { y: torsoLength * 0.72, rx: halfWidth(params.chestWidth), rz: halfDepth(params.bodyThickness) * 1.0 },
    { y: torsoLength * 0.92, rx: halfWidth(params.shoulderWidth), rz: halfDepth(params.bodyThickness) * 0.92 },
    { y: torsoLength * 0.985, rx: halfWidth(params.shoulderWidth * 0.8), rz: halfDepth(params.bodyThickness) * 0.8 },
    { y: torsoLength, rx: halfWidth(params.shoulderWidth * 0.52), rz: halfDepth(params.bodyThickness) * 0.72 }
  ];
  const torso = makeMesh('Body_Torso', loftGeometry(torsoRings), materials.shirt, 'torso');
  body.add(torso);

  /* ---------------- leher & kepala ---------------- */
  const neck = makeMesh(
    'Body_Neck',
    limbUpGeometry(params.neckWidth * s * 0.48, params.neckWidth * s * 0.44, neckLength + 0.02 * s),
    materials.skin,
    'neck'
  );
  neck.position.y = torsoLength - 0.02 * s;
  body.add(neck);

  const jaw = params.jawWidth;
  const headProfile = [
    { f: 0.0, w: 0.56 * jaw, d: 0.64 },
    { f: 0.06, w: 0.72 * jaw, d: 0.8 },
    { f: 0.16, w: 0.86 * jaw, d: 0.9 },
    { f: 0.3, w: 0.95 * jaw, d: 0.96 },
    { f: 0.48, w: 1.0, d: 1.0 },
    { f: 0.66, w: 1.0, d: 1.0 },
    { f: 0.84, w: 0.9, d: 0.93 },
    { f: 0.94, w: 0.68, d: 0.72 },
    { f: 1.0, w: 0.28, d: 0.32 }
  ];
  const head = makeMesh(
    'Body_Head',
    loftGeometry(
      headProfile.map((ring) => ({ y: ring.f * headHeight, rx: (headWidth * 0.5) * ring.w, rz: (headDepth * 0.5) * ring.d })),
      HEAD_SEGMENTS
    ),
    materials.skin,
    'head'
  );
  head.position.y = torsoLength + neckLength;
  body.add(head);

  /* ---------------- lengan ---------------- */
  const shoulderX = halfWidth(params.shoulderWidth) * 1.02;
  const shoulderY = torsoLength * 0.88;
  const upperArmLength = params.upperArmLength * s;
  const forearmLength = params.forearmLength * s;
  const elbowRadius = params.elbowRadius * s;
  const wristRadius = params.wristRadius * s;
  const shoulderRadius = 0.056 * s;

  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    const arm = new THREE.Group();
    arm.name = `Arm_${side}`;
    arm.position.set(sign * shoulderX, shoulderY, 0);

    arm.add(makeMesh(`Joint_Shoulder_${side}`, sphereGeometry(shoulderRadius), materials.skin, 'joint'));
    arm.add(makeMesh(`Arm_Upper_${side}`, limbGeometry(shoulderRadius, elbowRadius, upperArmLength), materials.skin, 'arm'));

    const elbow = new THREE.Group();
    elbow.name = `Elbow_${side}`;
    elbow.position.y = -upperArmLength;
    elbow.add(makeMesh(`Joint_Elbow_${side}`, sphereGeometry(elbowRadius), materials.skin, 'joint'));
    elbow.add(makeMesh(`Arm_Lower_${side}`, limbGeometry(elbowRadius * 0.98, wristRadius, forearmLength), materials.skin, 'arm'));
    arm.add(elbow);

    const wrist = new THREE.Group();
    wrist.name = `Wrist_${side}`;
    wrist.position.y = -forearmLength;
    wrist.add(makeMesh(`Joint_Wrist_${side}`, sphereGeometry(wristRadius), materials.skin, 'joint'));
    wrist.add(buildHand(side, params, s, materials.skin));
    elbow.add(wrist);

    arm.rotation.z = sign * poseAngles.shoulder * DEG;
    elbow.rotation.z = -sign * poseAngles.elbow * DEG;
    body.add(arm);
  }

  /* ---------------- kaki ---------------- */
  const hipX = halfWidth(params.hipWidth) * 0.48;
  const kneeRadius = params.kneeRadius * s;
  const ankleRadius = params.ankleRadius * s;
  const thighRadius = 0.078 * s;

  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    const leg = new THREE.Group();
    leg.name = `Leg_${side}`;
    leg.position.set(sign * hipX, hipY, 0);

    leg.add(makeMesh(`Leg_Thigh_${side}`, limbGeometry(thighRadius, kneeRadius, thighLength), materials.pants, 'leg'));

    const knee = new THREE.Group();
    knee.name = `Knee_${side}`;
    knee.position.y = -thighLength;
    knee.add(makeMesh(`Joint_Knee_${side}`, sphereGeometry(kneeRadius), materials.pants, 'joint'));
    knee.add(makeMesh(`Leg_Calf_${side}`, limbGeometry(kneeRadius * 0.98, ankleRadius, calfLength), materials.pants, 'leg'));
    leg.add(knee);

    const ankle = new THREE.Group();
    ankle.name = `Ankle_${side}`;
    ankle.position.y = -calfLength;
    const ankleJointRadius = Math.min(ankleRadius * 0.92, ankleHeight * 0.48);
    const ankleJoint = makeMesh(`Joint_Ankle_${side}`, sphereGeometry(ankleJointRadius), materials.shoes, 'joint');
    ankleJoint.position.y = -ankleHeight * 0.45;
    ankle.add(ankleJoint);

    const foot = buildFoot(side, params, s, ankleHeight, materials.shoes);
    foot.rotation.y = sign * poseAngles.foot * DEG;
    ankle.add(foot);
    knee.add(ankle);

    content.add(leg);
  }

  content.updateMatrixWorld(true);

  const metrics = {
    actualHeight: bodyY + torsoLength + neckLength + headHeight,
    hipY,
    bodyY,
    torsoTopY: bodyY + torsoLength,
    headTopY: bodyY + torsoLength + neckLength + headHeight,
    scale: s,
    armSpanT: shoulderX * 2 + (upperArmLength + forearmLength + params.palmLength * s) * 2
  };

  return { content, params, pose: poseKey, metrics };
}

/** Buang geometri & material milik satu content humanoid. */
export function disposeHumanoidContent(content) {
  if (!content) return;
  const geometries = new Set();
  const materials = new Set();
  content.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

/** Ukuran bounding box content (tanpa mengubah apa pun). */
export function measureHumanoid(content) {
  const box = new THREE.Box3().setFromObject(content);
  const size = box.getSize(new THREE.Vector3());
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: size.toArray(),
    center: box.getCenter(new THREE.Vector3()).toArray()
  };
}
