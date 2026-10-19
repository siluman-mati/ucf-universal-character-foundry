/**
 * UCF — matematika kamera preset & pemasangan (framing) model.
 * Fungsi murni; jarak kamera selalu dihitung dari ukuran model, bukan konstanta.
 */
import * as THREE from 'three';

export const VIEW_PRESETS = Object.freeze({
  depan: { label: 'Depan', direction: [0, 0, 1] },
  belakang: { label: 'Belakang', direction: [0, 0, -1] },
  kiri: { label: 'Kiri', direction: [-1, 0, 0] },
  kanan: { label: 'Kanan', direction: [1, 0, 0] },
  // epsilon pada Z agar OrbitControls tidak berada di kutub yang degenerat
  atas: { label: 'Atas', direction: [0, 1, 0.0008] },
  perspektif: { label: 'Perspektif', direction: [0.82, 0.5, 1.0] }
});

export const VIEW_ORDER = Object.freeze(['depan', 'belakang', 'kiri', 'kanan', 'atas', 'perspektif']);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDirection(vector) {
  const v = new THREE.Vector3(vector[0], vector[1], vector[2]);
  const length = v.length();
  if (!Number.isFinite(length) || length < 1e-9) return new THREE.Vector3(0, 0, 1);
  return v.multiplyScalar(1 / length);
}

/**
 * Jarak kamera agar bola berjari-jari `radius` muat pada FOV vertikal maupun horizontal.
 * @param {number} radius jari-jari bola pembatas model (meter)
 * @param {number} fovDeg FOV vertikal kamera
 * @param {number} aspect lebar/tinggi viewport
 * @param {number} padding faktor ruang kosong (1.0 = pas)
 */
export function fitDistance(radius, fovDeg, aspect, padding = 1.15) {
  const safeRadius = Math.max(1e-4, Number(radius) || 0);
  const vFov = THREE.MathUtils.degToRad(clamp(Number(fovDeg) || 45, 1, 179));
  const safeAspect = Math.max(1e-4, Number(aspect) || 1);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * safeAspect);
  const limitingFov = Math.min(vFov, hFov);
  const distance = safeRadius / Math.sin(limitingFov / 2);
  return distance * Math.max(1, padding);
}

/** 8 sudut kotak [min,max] sebagai array [x,y,z]. */
export function boxCorners(box) {
  const min = box.min ?? box[0];
  const max = box.max ?? box[1];
  const corners = [];
  for (const x of [min.x ?? min[0], max.x ?? max[0]]) {
    for (const y of [min.y ?? min[1], max.y ?? max[1]]) {
      for (const z of [min.z ?? min[2], max.z ?? max[2]]) corners.push([x, y, z]);
    }
  }
  return corners;
}

/**
 * Jarak kamera minimum agar seluruh sudut kotak masuk frustum, dihitung pada
 * basis kamera (bukan bola pembatas) sehingga framing tidak terlalu longgar.
 */
export function frameDistance(corners, center, fovDeg, aspect, view = 'perspektif', padding = 1.12) {
  const preset = VIEW_PRESETS[view] || VIEW_PRESETS.perspektif;
  const direction = normalizeDirection(preset.direction);
  const forward = direction.clone().negate();
  let upRef = new THREE.Vector3(0, 1, 0);
  if (Math.abs(forward.dot(upRef)) > 0.999) upRef = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3().crossVectors(forward, upRef).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const vFov = THREE.MathUtils.degToRad(clamp(Number(fovDeg) || 45, 1, 179));
  const tanV = Math.tan(vFov / 2);
  const tanH = tanV * Math.max(1e-4, Number(aspect) || 1);
  const c = new THREE.Vector3(center[0] ?? center.x ?? 0, center[1] ?? center.y ?? 0, center[2] ?? center.z ?? 0);

  let distance = 0;
  for (const corner of corners) {
    const p = new THREE.Vector3(corner[0], corner[1], corner[2]).sub(c);
    const x = Math.abs(p.dot(right));
    const y = Math.abs(p.dot(up));
    const z = p.dot(forward);
    distance = Math.max(distance, x / tanH - z, y / tanV - z);
  }
  return Math.max(0.01, distance) * Math.max(1, padding);
}

/**
 * Hitung posisi & target kamera untuk sebuah preset.
 * @returns {{position: THREE.Vector3, target: THREE.Vector3, distance: number, direction: THREE.Vector3, view: string}}
 */
export function viewPlacement({ center, radius, corners = null, fovDeg = 45, aspect = 1, view = 'perspektif', padding = 1.12 }) {
  const key = Object.prototype.hasOwnProperty.call(VIEW_PRESETS, view) ? view : 'perspektif';
  const preset = VIEW_PRESETS[key];
  const direction = normalizeDirection(preset.direction);
  const distance = corners && corners.length
    ? frameDistance(corners, center, fovDeg, aspect, key, padding)
    : fitDistance(radius, fovDeg, aspect, padding);
  const target = new THREE.Vector3(center[0] ?? center.x ?? 0, center[1] ?? center.y ?? 0, center[2] ?? center.z ?? 0);
  const position = target.clone().addScaledVector(direction, distance);
  return { position, target, distance, direction, view: key };
}

/** Sudut (derajat) antara arah kamera aktual dan arah preset. 0 = tepat. */
export function directionErrorDegrees(actualDirection, view) {
  const preset = VIEW_PRESETS[view] || VIEW_PRESETS.perspektif;
  const a = normalizeDirection(actualDirection);
  const b = normalizeDirection(preset.direction);
  const dot = clamp(a.dot(b), -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(dot));
}

/** Jarak kamera ke target. */
export function cameraDistance(position, target) {
  return new THREE.Vector3(position[0] ?? position.x, position[1] ?? position.y, position[2] ?? position.z)
    .distanceTo(new THREE.Vector3(target[0] ?? target.x, target[1] ?? target.y, target[2] ?? target.z));
}
