/**
 * UCF Tahap 4 — generator modul prosedural.
 *
 * Setiap generator menerima konteks { params, s, rig, options } dan
 * mengembalikan { parts, materialList, textureList, clipCheck }.
 *
 * part = {
 *   name, geometry, material,
 *   candidates: string[]   // tulang untuk skin weights (modul skinned)
 *   bone: string           // tulang tempat menempel (modul bone attachment)
 * }
 *
 * Geometri modul skinned dibangun di ruang lokal rig.root (ruang bind T-pose),
 * memakai posisi tulang hasil builder Tahap 3. Geometri modul bone attachment
 * dibangun di ruang lokal tulang yang bersangkutan.
 */
import * as THREE from 'three';
import { boneLocalPosition } from '../humanoid/rig.js';

const UP = new THREE.Vector3(0, 1, 0);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function optionNumber(options, key, fallback, min, max) {
  const value = Number(options?.[key]);
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export function makeMaterial(name, color, { roughness = 0.9, metalness = 0, emissive = null } = {}) {
  const material = new THREE.MeshStandardMaterial({
    name,
    color: new THREE.Color(color),
    roughness,
    metalness
  });
  if (emissive) material.emissive = new THREE.Color(emissive);
  return material;
}

/** Loft elliptical rings; sudut 0 = +X, π/2 = +Z (depan). */
export function loft(rings, segments = 20, { angleStart = 0, angleEnd = Math.PI * 2, closeBottom = true, closeTop = true } = {}) {
  const positions = [];
  const indices = [];
  const full = Math.abs(angleEnd - angleStart - Math.PI * 2) < 1e-6;
  const count = full ? segments : segments + 1;

  for (const ring of rings) {
    for (let i = 0; i < count; i += 1) {
      const angle = full ? (i / segments) * Math.PI * 2 + angleStart : angleStart + (i / segments) * (angleEnd - angleStart);
      positions.push(
        (ring.cx || 0) + Math.cos(angle) * ring.rx,
        ring.y,
        (ring.cz || 0) + Math.sin(angle) * ring.rz
      );
    }
  }

  const quads = full ? count : count - 1;
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < quads; i += 1) {
      const next = (i + 1) % count;
      const a = r * count + i;
      const b = r * count + next;
      const c = (r + 1) * count + next;
      const d = (r + 1) * count + i;
      indices.push(a, d, b, b, d, c);
    }
  }

  if (full && closeBottom) {
    const center = positions.length / 3;
    positions.push(rings[0].cx || 0, rings[0].y, rings[0].cz || 0);
    for (let i = 0; i < count; i += 1) indices.push(center, (i + 1) % count, i);
  }
  if (full && closeTop) {
    const last = (rings.length - 1) * count;
    const center = positions.length / 3;
    const ring = rings[rings.length - 1];
    positions.push(ring.cx || 0, ring.y, ring.cz || 0);
    for (let i = 0; i < count; i += 1) indices.push(center, last + i, last + ((i + 1) % count));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Tabung di antara dua titik (silinder berarah). */
export function tube(start, end, radiusStart, radiusEnd, radial = 14) {
  const direction = end.clone().sub(start);
  const length = Math.max(direction.length(), 1e-5);
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, radial, 1, false);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return geometry;
}

export function box(width, height, depth, center, rotation = null) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  if (rotation) geometry.rotateX(rotation.x || 0).rotateY(rotation.y || 0).rotateZ(rotation.z || 0);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

export function sphere(radius, center, widthSegments = 14, heightSegments = 10) {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function bonePoint(rig, name) {
  return boneLocalPosition(rig, name);
}

function torsoMetrics(ctx) {
  const { params, s, rig } = ctx;
  const hips = bonePoint(rig, 'Hips');
  const torsoLength = params.torsoLength * s;
  const widthScale = params.bodyWidth;
  return {
    hipsY: hips.y,
    torsoLength,
    halfWidth: (value) => (value * 0.5) * s * widthScale,
    halfDepth: (value) => (value * 0.5) * s
  };
}

/* ------------------------------------------------------------------ */
/* B. SKIN / MATERIAL                                                  */
/* ------------------------------------------------------------------ */

function materialSkin(ctx) {
  const { options } = ctx;
  return {
    parts: [],
    materialList: ['Kulit'],
    textureList: [],
    clipCheck: false,
    materialSwap: {
      target: 'Kulit',
      base: { color: options.baseColor || '#d9a17d', roughness: 0.86, metalness: 0 },
      color: options.color || '#d9a17d',
      roughness: optionNumber(options, 'roughness', 0.86, 0, 1),
      metalness: optionNumber(options, 'metalness', 0, 0, 1)
    }
  };
}

/* ------------------------------------------------------------------ */
/* E. TOPS                                                             */
/* ------------------------------------------------------------------ */

function topTee(ctx) {
  const { params, s, rig, options } = ctx;
  const { hipsY, torsoLength: T, halfWidth: hw, halfDepth: hd } = torsoMetrics(ctx);
  const fit = optionNumber(options, 'fit', 1.07, 0.8, 1.4);
  const cloth = makeMaterial('Kaos Modul', options.color || '#2f6f9f', { roughness: optionNumber(options, 'roughness', 0.95, 0, 1) });

  const rings = [
    { y: hipsY + T * 0.02, rx: hw(params.hipWidth) * fit, rz: hd(params.bodyThickness) * 0.94 * fit },
    { y: hipsY + T * 0.22, rx: hw(params.hipWidth * 0.95) * fit, rz: hd(params.bodyThickness) * 0.92 * fit },
    { y: hipsY + T * 0.48, rx: hw(params.waistWidth) * fit, rz: hd(params.bodyThickness) * 0.84 * fit },
    { y: hipsY + T * 0.74, rx: hw(params.chestWidth) * fit, rz: hd(params.bodyThickness) * fit },
    { y: hipsY + T * 0.92, rx: hw(params.shoulderWidth) * fit, rz: hd(params.bodyThickness) * 0.94 * fit },
    { y: hipsY + T, rx: hw(params.shoulderWidth * 0.7) * fit, rz: hd(params.bodyThickness) * 0.78 * fit }
  ];

  const parts = [
    { name: 'Top_Body', geometry: loft(rings, 24), material: cloth, candidates: ['Hips', 'Spine', 'Chest', 'Neck'] }
  ];

  const sleeveFraction = optionNumber(options, 'sleeve', 0.42, 0.1, 1.4);
  for (const side of ['R', 'L']) {
    const shoulder = bonePoint(rig, `UpperArm_${side}`);
    const elbow = bonePoint(rig, `LowerArm_${side}`);
    const direction = elbow.clone().sub(shoulder).normalize();
    const armLength = shoulder.distanceTo(elbow);
    const start = shoulder.clone().addScaledVector(direction, 0.02 * s);
    const end = shoulder.clone().addScaledVector(direction, armLength * sleeveFraction);
    const radius = Math.max(params.elbowRadius * s * 1.28, 0.055 * s);
    parts.push({
      name: `Top_Sleeve_${side}`,
      geometry: tube(start, end, radius * 1.14, radius * 0.96, 12),
      material: cloth,
      candidates: ['Chest', `UpperArm_${side}`, `LowerArm_${side}`]
    });
  }

  return { parts, materialList: ['Kaos Modul'], textureList: [], clipCheck: true };
}

function topJacket(ctx) {
  const { params, s, rig, options } = ctx;
  const { hipsY, torsoLength: T, halfWidth: hw, halfDepth: hd } = torsoMetrics(ctx);
  const fit = optionNumber(options, 'fit', 1.1, 0.85, 1.45);
  const shell = makeMaterial('Jaket Modul', options.color || '#3b4450', { roughness: optionNumber(options, 'roughness', 0.85, 0, 1) });
  const trim = makeMaterial('Jaket Trim', '#1c222b', { roughness: 0.9 });

  const rings = [
    { y: hipsY - T * 0.06, rx: hw(params.hipWidth * 1.02) * fit, rz: hd(params.bodyThickness) * 0.98 * fit },
    { y: hipsY + T * 0.18, rx: hw(params.hipWidth * 0.97) * fit, rz: hd(params.bodyThickness) * 0.94 * fit },
    { y: hipsY + T * 0.48, rx: hw(params.waistWidth) * fit, rz: hd(params.bodyThickness) * 0.86 * fit },
    { y: hipsY + T * 0.74, rx: hw(params.chestWidth) * fit, rz: hd(params.bodyThickness) * fit },
    { y: hipsY + T * 0.92, rx: hw(params.shoulderWidth) * fit, rz: hd(params.bodyThickness) * 0.95 * fit },
    { y: hipsY + T * 1.0, rx: hw(params.shoulderWidth * 0.72) * fit, rz: hd(params.bodyThickness) * 0.8 * fit }
  ];

  const parts = [
    { name: 'Jacket_Body', geometry: loft(rings, 24), material: shell, candidates: ['Hips', 'Spine', 'Chest', 'Neck'] },
    {
      name: 'Jacket_Collar',
      geometry: loft(
        [
          { y: hipsY + T * 1.005, rx: params.neckWidth * s * 0.66, rz: params.neckWidth * s * 0.58 },
          { y: hipsY + T * 1.08, rx: params.neckWidth * s * 0.55, rz: params.neckWidth * s * 0.48 }
        ],
        16,
        { closeBottom: false, closeTop: false }
      ),
      material: trim,
      candidates: ['Chest', 'Neck']
    },
    {
      name: 'Jacket_Zipper',
      geometry: box(0.012 * s, T * 0.82, 0.008 * s, new THREE.Vector3(0, hipsY + T * 0.53, hd(params.bodyThickness) * fit * 0.98)),
      material: trim,
      candidates: ['Hips', 'Spine', 'Chest']
    }
  ];

  for (const side of ['R', 'L']) {
    const shoulder = bonePoint(rig, `UpperArm_${side}`);
    const elbow = bonePoint(rig, `LowerArm_${side}`);
    const wrist = bonePoint(rig, `Hand_${side}`);
    const upperDirection = elbow.clone().sub(shoulder).normalize();
    const foreDirection = wrist.clone().sub(elbow).normalize();
    const radius = Math.max(params.elbowRadius * s * 1.42, 0.06 * s);
    parts.push({
      name: `Jacket_UpperSleeve_${side}`,
      geometry: tube(shoulder.clone().addScaledVector(upperDirection, 0.02 * s), elbow.clone().addScaledVector(foreDirection, -0.01 * s), radius * 1.15, radius, 12),
      material: shell,
      candidates: ['Chest', `UpperArm_${side}`, `LowerArm_${side}`]
    });
    parts.push({
      name: `Jacket_LowerSleeve_${side}`,
      geometry: tube(elbow, wrist, radius, radius * 0.82, 12),
      material: shell,
      candidates: [`UpperArm_${side}`, `LowerArm_${side}`, `Hand_${side}`]
    });
  }

  return { parts, materialList: ['Jaket Modul', 'Jaket Trim'], textureList: [], clipCheck: true };
}

/* ------------------------------------------------------------------ */
/* F. BOTTOMS                                                          */
/* ------------------------------------------------------------------ */

function bottomPants(ctx) {
  const { params, s, rig, options } = ctx;
  const { hipsY, halfWidth: hw, halfDepth: hd } = torsoMetrics(ctx);
  const fit = optionNumber(options, 'fit', 1.12, 0.9, 1.5);
  const cloth = makeMaterial('Celana Modul', options.color || '#27313f', { roughness: optionNumber(options, 'roughness', 0.95, 0, 1) });

  const parts = [
    {
      name: 'Pants_Waist',
      geometry: loft(
        [
          { y: hipsY + 0.07 * s, rx: hw(params.hipWidth * 1.12) * fit, rz: hd(params.bodyThickness) * 1.12 * fit },
          { y: hipsY + 0.01 * s, rx: hw(params.hipWidth * 1.1) * fit, rz: hd(params.bodyThickness) * 1.08 * fit },
          { y: hipsY - 0.07 * s, rx: hw(params.hipWidth * 1.02) * fit, rz: hd(params.bodyThickness) * 1.0 * fit }
        ],
        24,
        { closeBottom: false, closeTop: false }
      ),
      material: cloth,
      candidates: ['Hips', 'Spine']
    }
  ];

  for (const side of ['R', 'L']) {
    const hip = bonePoint(rig, `UpperLeg_${side}`);
    const knee = bonePoint(rig, `LowerLeg_${side}`);
    const ankle = bonePoint(rig, `Foot_${side}`);
    const thighRadius = Math.max(0.078 * s * fit, params.kneeRadius * s * 1.12);
    const kneeRadius = params.kneeRadius * s * fit;
    const ankleRadius = params.ankleRadius * s * (fit + 0.28);

    parts.push({
      name: `Pants_Thigh_${side}`,
      geometry: tube(hip.clone().add(new THREE.Vector3(0, -0.02 * s, 0)), knee, thighRadius, kneeRadius, 14),
      material: cloth,
      candidates: ['Hips', `UpperLeg_${side}`, `LowerLeg_${side}`]
    });
    parts.push({
      name: `Pants_Calf_${side}`,
      geometry: tube(knee, ankle.clone().add(new THREE.Vector3(0, 0.028 * s, 0)), kneeRadius, ankleRadius, 14),
      material: cloth,
      candidates: [`LowerLeg_${side}`, `Foot_${side}`]
    });
  }

  return { parts, materialList: ['Celana Modul'], textureList: [], clipCheck: true };
}

function bottomSkirt(ctx) {
  const { params, s, rig, options } = ctx;
  const { hipsY, torsoLength: T, halfWidth: hw, halfDepth: hd } = torsoMetrics(ctx);
  const fit = optionNumber(options, 'fit', 1.1, 0.9, 1.5);
  const length = optionNumber(options, 'length', 0.42, 0.2, 0.9);
  const cloth = makeMaterial('Rok Modul', options.color || '#5a3f57', { roughness: optionNumber(options, 'roughness', 0.94, 0, 1) });

  const topY = hipsY + T * 0.06;
  const bottomY = hipsY - Math.max(0.16 * s, length * s);
  const rings = [
    { y: topY, rx: hw(params.hipWidth * 1.02) * fit, rz: hd(params.bodyThickness) * 1.02 * fit },
    { y: topY - (topY - bottomY) * 0.35, rx: hw(params.hipWidth * 1.12) * fit, rz: hd(params.bodyThickness) * 1.16 * fit },
    { y: topY - (topY - bottomY) * 0.72, rx: hw(params.hipWidth * 1.3) * fit, rz: hd(params.bodyThickness) * 1.32 * fit },
    { y: bottomY, rx: hw(params.hipWidth * 1.42) * fit, rz: hd(params.bodyThickness) * 1.45 * fit }
  ];

  return {
    parts: [
      {
        name: 'Skirt_Body',
        geometry: loft(rings, 26, { closeBottom: false }),
        material: cloth,
        candidates: ['Hips', 'Spine']
      }
    ],
    materialList: ['Rok Modul'],
    textureList: [],
    clipCheck: true
  };
}

/* ------------------------------------------------------------------ */
/* G. SHOES                                                            */
/* ------------------------------------------------------------------ */

function shoesBoot(ctx) {
  const { params, s, options } = ctx;
  const ankleHeight = 0.075 * s;
  const footLength = params.footLength * s;
  const footWidth = params.footWidth * s;
  const shaftHeight = optionNumber(options, 'shaft', 0.17, 0.05, 0.35) * s;
  const leather = makeMaterial('Boot Kulit', options.color || '#2b3442', { roughness: optionNumber(options, 'roughness', 0.7, 0, 1) });
  const sole = makeMaterial('Boot Sol', '#14181f', { roughness: 0.95 });

  const parts = [];
  for (const side of ['R', 'L']) {
    parts.push({
      name: `Boot_Sole_${side}`,
      geometry: box(footWidth * 1.14, ankleHeight * 0.34, footLength * 1.02, new THREE.Vector3(0, -ankleHeight + ankleHeight * 0.17, footLength * 0.22)),
      material: sole,
      bone: `Foot_${side}`
    });
    parts.push({
      name: `Boot_Upper_${side}`,
      geometry: box(footWidth * 1.06, ankleHeight * 0.8, footLength * 0.72, new THREE.Vector3(0, -ankleHeight * 0.42, footLength * 0.16)),
      material: leather,
      bone: `Foot_${side}`
    });
    parts.push({
      name: `Boot_Shaft_${side}`,
      geometry: new THREE.CylinderGeometry(params.ankleRadius * s * 1.5, params.ankleRadius * s * 1.34, shaftHeight, 12, 1, true).translate(0, shaftHeight * 0.35, 0),
      material: leather,
      bone: `Foot_${side}`
    });
  }

  return { parts, materialList: ['Boot Kulit', 'Boot Sol'], textureList: [], clipCheck: true };
}

function shoesSandal(ctx) {
  const { params, s, options } = ctx;
  const ankleHeight = 0.075 * s;
  const footLength = params.footLength * s;
  const footWidth = params.footWidth * s;
  const sole = makeMaterial('Sandal Sol', options.color || '#6b4a33', { roughness: 0.9 });
  const strap = makeMaterial('Sandal Strap', '#20262e', { roughness: 0.8 });

  const parts = [];
  for (const side of ['R', 'L']) {
    parts.push({
      name: `Sandal_Sole_${side}`,
      geometry: box(footWidth * 1.1, ankleHeight * 0.28, footLength * 1.0, new THREE.Vector3(0, -ankleHeight + ankleHeight * 0.14, footLength * 0.22)),
      material: sole,
      bone: `Foot_${side}`
    });
    parts.push({
      name: `Sandal_Strap_${side}`,
      geometry: box(footWidth * 1.02, ankleHeight * 0.16, footLength * 0.22, new THREE.Vector3(0, -ankleHeight * 0.25, footLength * 0.06)),
      material: strap,
      bone: `Foot_${side}`
    });
    parts.push({
      name: `Sandal_Heel_${side}`,
      geometry: box(footWidth * 0.9, ankleHeight * 0.12, footLength * 0.1, new THREE.Vector3(0, -ankleHeight * 0.32, -footLength * 0.18)),
      material: strap,
      bone: `Foot_${side}`
    });
  }

  return { parts, materialList: ['Sandal Sol', 'Sandal Strap'], textureList: [], clipCheck: true };
}

/* ------------------------------------------------------------------ */
/* C. FACE                                                             */
/* ------------------------------------------------------------------ */

function faceBasic(ctx) {
  const { params, s, options } = ctx;
  const headHeight = params.headHeight * s * params.headScale;
  const headWidth = params.headWidth * s * params.headScale;
  const headDepth = params.headDepth * s * params.headScale;

  const skin = makeMaterial('Wajah Kulit', options.skinColor || '#d9a17d', { roughness: 0.86 });
  const white = makeMaterial('Mata Putih', '#f4f6f8', { roughness: 0.35 });
  const dark = makeMaterial('Mata Gelap', options.eyeColor || '#1d232c', { roughness: 0.4 });
  const browMaterial = makeMaterial('Alis', options.hairColor || '#2a211b', { roughness: 0.9 });

  const eyeY = headHeight * 0.6;
  const eyeX = headWidth * 0.28;
  const eyeZ = headDepth * 0.44;
  const eyeRadius = headWidth * 0.085;

  const parts = [];
  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    parts.push({
      name: `Face_Eye_${side}`,
      geometry: sphere(eyeRadius, new THREE.Vector3(sign * eyeX, eyeY, eyeZ), 12, 10),
      material: white,
      bone: 'Head'
    });
    parts.push({
      name: `Face_Pupil_${side}`,
      geometry: sphere(eyeRadius * 0.46, new THREE.Vector3(sign * eyeX, eyeY, eyeZ + eyeRadius * 0.78), 10, 8),
      material: dark,
      bone: 'Head'
    });
    parts.push({
      name: `Face_Brow_${side}`,
      geometry: box(headWidth * 0.2, headHeight * 0.022, headDepth * 0.028, new THREE.Vector3(sign * headWidth * 0.29, headHeight * 0.71, headDepth * 0.44)),
      material: browMaterial,
      bone: 'Head'
    });
  }

  parts.push({
    name: 'Face_Nose',
    geometry: box(headWidth * 0.1, headHeight * 0.11, headDepth * 0.1, new THREE.Vector3(0, headHeight * 0.51, headDepth * 0.46)),
    material: skin,
    bone: 'Head'
  });
  parts.push({
    name: 'Face_Mouth',
    geometry: box(headWidth * 0.22, headHeight * 0.02, headDepth * 0.03, new THREE.Vector3(0, headHeight * 0.38, headDepth * 0.43)),
    material: dark,
    bone: 'Head'
  });

  return {
    parts,
    materialList: ['Wajah Kulit', 'Mata Putih', 'Mata Gelap', 'Alis'],
    textureList: [],
    // mata, hidung, dan mulut sengaja tertanam di dalam kepala
    clipCheck: false
  };
}

/* ------------------------------------------------------------------ */
/* D. HAIR                                                             */
/* ------------------------------------------------------------------ */

function hairCapGeometry(params, s, { bottomFraction = 0.76 } = {}) {
  const headHeight = params.headHeight * s * params.headScale;
  const headWidth = params.headWidth * s * params.headScale;
  const headDepth = params.headDepth * s * params.headScale;
  const hw = headWidth / 2;
  const hd = headDepth / 2;
  const rings = [
    { y: headHeight * 1.06, rx: hw * 0.3, rz: hd * 0.3 },
    { y: headHeight * 1.0, rx: hw * 0.66, rz: hd * 0.66 },
    { y: headHeight * 0.94, rx: hw * 0.95, rz: hd * 0.95 },
    { y: headHeight * 0.86, rx: hw * 1.05, rz: hd * 1.05 },
    { y: headHeight * bottomFraction, rx: hw * 1.08, rz: hd * 1.08 }
  ];
  return loft(rings, 22, { closeBottom: false });
}

function hairShort(ctx) {
  const { params, s, options } = ctx;
  const material = makeMaterial('Rambut Pendek', options.color || '#2a211b', { roughness: 0.85 });
  return {
    parts: [{ name: 'Hair_Cap', geometry: hairCapGeometry(params, s), material, bone: 'Head' }],
    materialList: ['Rambut Pendek'],
    textureList: [],
    clipCheck: true
  };
}

function hairLong(ctx) {
  const { params, s, options } = ctx;
  const headHeight = params.headHeight * s * params.headScale;
  const headWidth = params.headWidth * s * params.headScale;
  const headDepth = params.headDepth * s * params.headScale;
  const material = makeMaterial('Rambut Panjang', options.color || '#3a2a20', { roughness: 0.8 });

  const back = loft(
    [
      { y: headHeight * 0.82, rx: headWidth * 0.54, rz: headDepth * 0.55 },
      { y: headHeight * 0.62, rx: headWidth * 0.56, rz: headDepth * 0.58 },
      { y: headHeight * 0.4, rx: headWidth * 0.54, rz: headDepth * 0.6 },
      { y: headHeight * 0.2, rx: headWidth * 0.5, rz: headDepth * 0.56 },
      { y: headHeight * 0.06, rx: headWidth * 0.44, rz: headDepth * 0.5 }
    ],
    16,
    { angleStart: Math.PI, angleEnd: Math.PI * 2, closeBottom: false, closeTop: false }
  );

  return {
    parts: [
      { name: 'Hair_Cap', geometry: hairCapGeometry(params, s, { bottomFraction: 0.78 }), material, bone: 'Head' },
      { name: 'Hair_Back', geometry: back, material, bone: 'Head' }
    ],
    materialList: ['Rambut Panjang'],
    textureList: [],
    clipCheck: true
  };
}

/* ------------------------------------------------------------------ */
/* H. ACCESSORIES                                                      */
/* ------------------------------------------------------------------ */

function hat(ctx) {
  const { params, s, options } = ctx;
  const headHeight = params.headHeight * s * params.headScale;
  const headWidth = params.headWidth * s * params.headScale;
  const headDepth = params.headDepth * s * params.headScale;
  const felt = makeMaterial('Topi Bahan', options.color || '#5b4a3a', { roughness: 0.9 });
  const band = makeMaterial('Topi Pita', '#22272f', { roughness: 0.8 });

  const brim = new THREE.CylinderGeometry(headWidth * 0.62, headWidth * 0.62, 0.012 * s, 24).translate(0, headHeight * 0.82, 0);
  const crown = new THREE.CylinderGeometry(headWidth * 0.36, headWidth * 0.42, headHeight * 0.42, 20).translate(0, headHeight * 0.82 + headHeight * 0.21, 0);
  const ribbon = new THREE.CylinderGeometry(headWidth * 0.425, headWidth * 0.425, headHeight * 0.06, 20, 1, true).translate(0, headHeight * 0.84, 0);

  return {
    parts: [
      { name: 'Hat_Brim', geometry: brim, material: felt, bone: 'Head' },
      { name: 'Hat_Crown', geometry: crown, material: felt, bone: 'Head' },
      { name: 'Hat_Band', geometry: ribbon, material: band, bone: 'Head' }
    ],
    materialList: ['Topi Bahan', 'Topi Pita'],
    textureList: [],
    clipCheck: true
  };
}

function glasses(ctx) {
  const { params, s, options } = ctx;
  const headHeight = params.headHeight * s * params.headScale;
  const headWidth = params.headWidth * s * params.headScale;
  const headDepth = params.headDepth * s * params.headScale;
  const frame = makeMaterial('Kacamata Rangka', options.color || '#1b1f26', { roughness: 0.5, metalness: 0.2 });
  const lens = makeMaterial('Kacamata Lensa', '#9fd4e8', { roughness: 0.15, metalness: 0, emissive: '#0b2a33' });
  lens.transparent = true;
  lens.opacity = 0.55;

  const eyeY = headHeight * 0.6;
  const eyeX = headWidth * 0.28;
  const lensRadius = headWidth * 0.17;
  const parts = [];

  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    const ring = new THREE.TorusGeometry(lensRadius, 0.004 * s, 8, 20);
    ring.translate(sign * eyeX, eyeY, headDepth * 0.54);
    parts.push({ name: `Glasses_Frame_${side}`, geometry: ring, material: frame, bone: 'Head' });

    const glass = new THREE.CircleGeometry(lensRadius * 0.94, 20);
    glass.translate(sign * eyeX, eyeY, headDepth * 0.535);
    parts.push({ name: `Glasses_Lens_${side}`, geometry: glass, material: lens, bone: 'Head' });

    const temple = box(0.005 * s, 0.008 * s, headDepth * 0.55, new THREE.Vector3(sign * headWidth * 0.54, eyeY, headDepth * 0.2));
    parts.push({ name: `Glasses_Temple_${side}`, geometry: temple, material: frame, bone: 'Head' });
  }

  parts.push({
    name: 'Glasses_Bridge',
    geometry: box(headWidth * 0.16, 0.006 * s, 0.006 * s, new THREE.Vector3(0, eyeY + lensRadius * 0.18, headDepth * 0.54)),
    material: frame,
    bone: 'Head'
  });

  return { parts, materialList: ['Kacamata Rangka', 'Kacamata Lensa'], textureList: [], clipCheck: true };
}

function belt(ctx) {
  const { params, s, options } = ctx;
  const { halfWidth: hw, halfDepth: hd } = torsoMetrics(ctx);
  const leather = makeMaterial('Sabuk Kulit', options.color || '#38291f', { roughness: 0.75 });
  const buckle = makeMaterial('Sabuk Gesper', '#c8b06a', { roughness: 0.35, metalness: 0.8 });
  const rx = hw(params.hipWidth) * 1.06;
  const rz = hd(params.bodyThickness) * 1.06;
  const band = loft(
    [
      { y: 0.085 * s, rx, rz },
      { y: 0.035 * s, rx, rz }
    ],
    24,
    { closeBottom: false, closeTop: false }
  );

  return {
    parts: [
      { name: 'Belt_Band', geometry: band, material: leather, bone: 'Hips' },
      { name: 'Belt_Buckle', geometry: box(0.05 * s, 0.036 * s, 0.012 * s, new THREE.Vector3(0, 0.06 * s, rz + 0.004 * s)), material: buckle, bone: 'Hips' }
    ],
    materialList: ['Sabuk Kulit', 'Sabuk Gesper'],
    textureList: [],
    clipCheck: true
  };
}

function gloves(ctx) {
  const { params, s, options } = ctx;
  const palmLength = params.palmLength * s;
  const palmWidth = params.palmWidth * s;
  const material = makeMaterial('Sarung Tangan', options.color || '#20252c', { roughness: 0.7 });
  const cuff = makeMaterial('Sarung Tangan Manset', '#11151a', { roughness: 0.8 });
  const parts = [];

  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    parts.push({
      name: `Glove_Palm_${side}`,
      geometry: box(palmLength * 1.02, 0.052 * s, palmWidth * 1.26, new THREE.Vector3(sign * palmLength * 0.52, 0, 0)),
      material,
      bone: `Hand_${side}`
    });
    parts.push({
      name: `Glove_Cuff_${side}`,
      geometry: new THREE.CylinderGeometry(params.wristRadius * s * 1.2, params.wristRadius * s * 1.2, 0.024 * s, 12).rotateZ(Math.PI / 2).translate(-sign * 0.018 * s, 0, 0),
      material: cuff,
      bone: `Hand_${side}`
    });
  }

  return { parts, materialList: ['Sarung Tangan', 'Sarung Tangan Manset'], textureList: [], clipCheck: true };
}

function backpack(ctx) {
  const { params, s, options } = ctx;
  const { hipsY, torsoLength: T, halfWidth: hw, halfDepth: hd } = torsoMetrics(ctx);
  const fabric = makeMaterial('Tas Bahan', options.color || '#4a3b2d', { roughness: 0.92 });
  const strap = makeMaterial('Tas Tali', '#2a2119', { roughness: 0.9 });
  const width = Math.min(hw(params.shoulderWidth) * 1.15, 0.32 * s);
  const height = T * 0.5;
  const depth = 0.15 * s;
  const centerZ = -hd(params.bodyThickness) - depth * 0.45;
  const centerY = hipsY + T * 0.62;

  const parts = [
    {
      name: 'Backpack_Body',
      geometry: box(width, height, depth, new THREE.Vector3(0, centerY, centerZ)),
      material: fabric,
      static: true
    }
  ];

  for (const side of ['R', 'L']) {
    const sign = side === 'R' ? 1 : -1;
    parts.push({
      name: `Backpack_Strap_${side}`,
      geometry: box(0.035 * s, height * 0.9, 0.02 * s, new THREE.Vector3(sign * width * 0.28, centerY + height * 0.12, -(hd(params.bodyThickness) + 0.008 * s))),
      material: strap,
      static: true
    });
  }

  return { parts, materialList: ['Tas Bahan', 'Tas Tali'], textureList: [], clipCheck: true };
}

/* ------------------------------------------------------------------ */

const GENERATORS = {
  material_skin: materialSkin,
  top_tee: topTee,
  top_jacket: topJacket,
  bottom_pants: bottomPants,
  bottom_skirt: bottomSkirt,
  shoes_boot: shoesBoot,
  shoes_sandal: shoesSandal,
  face_basic: faceBasic,
  hair_short: hairShort,
  hair_long: hairLong,
  hat,
  glasses,
  belt,
  gloves,
  backpack
};

export function generatorIds() {
  return Object.keys(GENERATORS);
}

export function runGenerator(name, ctx) {
  const generator = GENERATORS[name];
  if (!generator) return null;
  return generator(ctx);
}
