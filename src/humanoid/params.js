/**
 * UCF Tahap 2 — definisi parameter humanoid prosedural.
 * Semua nilai panjang dalam meter pada skala nominal; `height` menskalakan seluruh model.
 */

/** Tinggi nominal saat semua parameter default (jumlah segmen tubuh). */
export const NOMINAL_HEIGHT = 1.725;

export const POSE_OPTIONS = Object.freeze([
  { id: 'T', label: 'T-pose' },
  { id: 'A', label: 'A-pose' },
  { id: 'netral', label: 'Netral' }
]);

export const POSE_IDS = Object.freeze(POSE_OPTIONS.map((pose) => pose.id));

export const PARAM_GROUPS = Object.freeze([
  {
    id: 'A',
    title: 'A · Proporsi',
    params: [
      { key: 'height', label: 'Tinggi total', min: 1.3, max: 2.1, step: 0.01, default: 1.75, unit: 'm' },
      { key: 'bodyWidth', label: 'Lebar tubuh (global)', min: 0.75, max: 1.35, step: 0.01, default: 1.0, unit: '×' },
      { key: 'headScale', label: 'Skala kepala', min: 0.75, max: 1.4, step: 0.01, default: 1.0, unit: '×' },
      { key: 'torsoLength', label: 'Panjang torso', min: 0.38, max: 0.68, step: 0.005, default: 0.52, unit: 'm' },
      { key: 'comShift', label: 'Pusat massa (geser)', min: -0.08, max: 0.08, step: 0.005, default: 0.0, unit: 'm' }
    ]
  },
  {
    id: 'B',
    title: 'B · Kepala',
    params: [
      { key: 'headHeight', label: 'Tinggi kepala', min: 0.17, max: 0.31, step: 0.005, default: 0.235, unit: 'm' },
      { key: 'headWidth', label: 'Lebar kepala', min: 0.11, max: 0.21, step: 0.005, default: 0.155, unit: 'm' },
      { key: 'headDepth', label: 'Kedalaman kepala', min: 0.13, max: 0.25, step: 0.005, default: 0.185, unit: 'm' },
      { key: 'jawWidth', label: 'Rahang', min: 0.45, max: 1.0, step: 0.01, default: 0.78, unit: '×' },
      { key: 'neckLength', label: 'Panjang leher', min: 0.02, max: 0.16, step: 0.005, default: 0.075, unit: 'm' },
      { key: 'neckWidth', label: 'Lebar leher', min: 0.07, max: 0.17, step: 0.005, default: 0.11, unit: 'm' }
    ]
  },
  {
    id: 'C',
    title: 'C · Tubuh',
    params: [
      { key: 'shoulderWidth', label: 'Lebar bahu', min: 0.28, max: 0.6, step: 0.005, default: 0.44, unit: 'm' },
      { key: 'chestWidth', label: 'Lebar dada', min: 0.22, max: 0.5, step: 0.005, default: 0.36, unit: 'm' },
      { key: 'bodyThickness', label: 'Ketebalan tubuh', min: 0.12, max: 0.32, step: 0.005, default: 0.21, unit: 'm' },
      { key: 'waistWidth', label: 'Lebar pinggang', min: 0.17, max: 0.4, step: 0.005, default: 0.26, unit: 'm' },
      { key: 'hipWidth', label: 'Lebar pinggul', min: 0.2, max: 0.48, step: 0.005, default: 0.32, unit: 'm' }
    ]
  },
  {
    id: 'D',
    title: 'D · Lengan',
    params: [
      { key: 'upperArmLength', label: 'Panjang lengan atas', min: 0.18, max: 0.42, step: 0.005, default: 0.29, unit: 'm' },
      { key: 'forearmLength', label: 'Panjang lengan bawah', min: 0.16, max: 0.38, step: 0.005, default: 0.26, unit: 'm' },
      { key: 'elbowRadius', label: 'Radius siku', min: 0.03, max: 0.09, step: 0.002, default: 0.052, unit: 'm' },
      { key: 'wristRadius', label: 'Radius pergelangan', min: 0.02, max: 0.07, step: 0.002, default: 0.036, unit: 'm' },
      { key: 'palmLength', label: 'Panjang telapak', min: 0.06, max: 0.15, step: 0.002, default: 0.095, unit: 'm' }
    ]
  },
  {
    id: 'E',
    title: 'E · Tangan',
    params: [
      { key: 'palmWidth', label: 'Lebar telapak', min: 0.05, max: 0.13, step: 0.002, default: 0.085, unit: 'm' },
      { key: 'fingerThickness', label: 'Ketebalan jari', min: 0.008, max: 0.024, step: 0.001, default: 0.014, unit: 'm' },
      { key: 'fingerIndex', label: 'Panjang telunjuk', min: 0.04, max: 0.12, step: 0.002, default: 0.075, unit: 'm' },
      { key: 'fingerMiddle', label: 'Panjang jari tengah', min: 0.04, max: 0.13, step: 0.002, default: 0.082, unit: 'm' },
      { key: 'fingerRing', label: 'Panjang jari manis', min: 0.04, max: 0.12, step: 0.002, default: 0.075, unit: 'm' },
      { key: 'fingerPinky', label: 'Panjang kelingking', min: 0.03, max: 0.1, step: 0.002, default: 0.058, unit: 'm' },
      { key: 'thumbLength', label: 'Panjang ibu jari', min: 0.03, max: 0.1, step: 0.002, default: 0.062, unit: 'm' },
      { key: 'thumbAngle', label: 'Posisi ibu jari', min: 10, max: 80, step: 1, default: 45, unit: '°' }
    ]
  },
  {
    id: 'F',
    title: 'F · Kaki',
    params: [
      { key: 'thighLength', label: 'Panjang paha', min: 0.28, max: 0.56, step: 0.005, default: 0.42, unit: 'm' },
      { key: 'calfLength', label: 'Panjang betis', min: 0.26, max: 0.54, step: 0.005, default: 0.4, unit: 'm' },
      { key: 'kneeRadius', label: 'Radius lutut', min: 0.04, max: 0.1, step: 0.002, default: 0.062, unit: 'm' },
      { key: 'ankleRadius', label: 'Radius pergelangan kaki', min: 0.02, max: 0.07, step: 0.002, default: 0.04, unit: 'm' },
      { key: 'footLength', label: 'Panjang telapak kaki', min: 0.16, max: 0.34, step: 0.005, default: 0.24, unit: 'm' },
      { key: 'footWidth', label: 'Lebar telapak kaki', min: 0.06, max: 0.16, step: 0.002, default: 0.1, unit: 'm' }
    ]
  }
]);

export const PARAM_DEFS = Object.freeze(
  PARAM_GROUPS.flatMap((group) => group.params.map((param) => ({ ...param, group: group.id })))
);

const PARAM_BY_KEY = new Map(PARAM_DEFS.map((param) => [param.key, param]));

export const PARAM_KEYS = Object.freeze(PARAM_DEFS.map((param) => param.key));

const PHASE_2_KEYS = new Set([
  'elbowRadius', 'wristRadius', 'palmLength',
  'palmWidth', 'fingerThickness', 'fingerIndex', 'fingerMiddle', 'fingerRing',
  'fingerPinky', 'thumbLength', 'thumbAngle',
  'kneeRadius', 'ankleRadius', 'footWidth'
]);

/** Fase pengembangan UI: 1 = sub-tahap 2a, 2 = sub-tahap 2b. */
export const ACTIVE_PARAM_PHASE = 1;

export function paramPhase(key) {
  return PHASE_2_KEYS.has(key) ? 2 : 1;
}

export function activeParamDefs(phase = ACTIVE_PARAM_PHASE) {
  return PARAM_DEFS.filter((param) => paramPhase(param.key) <= phase);
}

export function paramDef(key) {
  return PARAM_BY_KEY.get(key) || null;
}

export function defaultParams() {
  const params = {};
  for (const def of PARAM_DEFS) params[def.key] = def.default;
  return params;
}

export function clampParam(key, raw) {
  const def = PARAM_BY_KEY.get(key);
  if (!def) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return def.default;
  return Math.min(def.max, Math.max(def.min, value));
}

/** Sanitasi objek parameter: clamp nilai, buang kunci tak dikenal, catat peringatan. */
export function sanitizeParams(raw = {}) {
  const params = defaultParams();
  const warnings = [];
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (!PARAM_BY_KEY.has(key)) {
        warnings.push(`Parameter tak dikenal diabaikan: ${key}`);
        continue;
      }
      const clamped = clampParam(key, value);
      if (clamped !== null) params[key] = clamped;
      if (clamped === null || Math.abs(clamped - Number(value)) > 1e-9) {
        warnings.push(`Parameter ${key} disesuaikan ke rentang (${clamped}).`);
      }
    }
  } else {
    warnings.push('Objek parameter tidak valid; memakai nilai default.');
  }
  return { params, warnings };
}

export function formatParamValue(param, value) {
  const digits = param.step >= 0.5 ? 0 : param.step >= 0.05 ? 2 : param.step >= 0.005 ? 3 : 3;
  return `${Number(value).toFixed(digits)} ${param.unit}`;
}
