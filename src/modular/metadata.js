/**
 * UCF Tahap 4 — skema metadata modul.
 *
 * Prompt UCF v1.1 §5.3 mencantumkan 18 field minimum. UCF menambahkan
 * `moduleVersion` sehingga setiap modul membawa 19 field yang diperiksa.
 * Nilai yang belum diverifikasi wajib memakai "UNKNOWN" atau
 * "NEEDS VALIDATION" — tidak boleh diisi angka rekaan.
 */

export const BODY_PROFILE_ID = 'ucf-procedural-35';
export const SKELETON_ID = 'ucf-humanoid-51';
export const ORIENTATION = '+Y up, +Z forward';

export const MODULE_CATEGORIES = Object.freeze([
  { id: 'body', label: 'Body / base mesh' },
  { id: 'skin', label: 'Skin & material' },
  { id: 'face', label: 'Wajah' },
  { id: 'hair', label: 'Rambut' },
  { id: 'tops', label: 'Atasan' },
  { id: 'bottoms', label: 'Bawahan' },
  { id: 'shoes', label: 'Alas kaki' },
  { id: 'accessories', label: 'Aksesori' }
]);

export const ATTACHMENT_TYPES = Object.freeze([
  { id: 'base', label: 'Base body (selalu terpasang)' },
  { id: 'skinned', label: 'Skinned clothing (skin weights)' },
  { id: 'bone', label: 'Bone attachment (kaku pada tulang)' },
  { id: 'static', label: 'Static attachment (titik tetap)' },
  { id: 'material', label: 'Material / texture swap' }
]);

export const VALIDATION_STATUS = Object.freeze({
  VALID: 'VALID',
  NEEDS: 'NEEDS VALIDATION',
  UNKNOWN: 'UNKNOWN',
  INVALID: 'INVALID'
});

export const COMPAT_STATUS = Object.freeze({
  VALID: 'VALID',
  NEEDS: 'NEEDS VALIDATION',
  UNKNOWN: 'UNKNOWN',
  INCOMPATIBLE: 'INCOMPATIBLE'
});

/** 19 field metadata wajib (18 dari prompt + moduleVersion). */
export const MODULE_FIELDS = Object.freeze([
  'moduleId',
  'moduleName',
  'moduleVersion',
  'category',
  'sourceFile',
  'sourceFormat',
  'sourceLicense',
  'scale',
  'orientation',
  'attachmentType',
  'attachmentPoint',
  'bodyRegion',
  'supportedSkeleton',
  'requiredBones',
  'materialList',
  'textureList',
  'compatibleBodyProfiles',
  'validationStatus',
  'knownLimitations'
]);

const CATEGORY_IDS = new Set(MODULE_CATEGORIES.map((category) => category.id));
const ATTACHMENT_IDS = new Set(ATTACHMENT_TYPES.map((type) => type.id));
const STATUS_VALUES = new Set(Object.values(VALIDATION_STATUS));

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,47}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function categoryLabel(id) {
  return MODULE_CATEGORIES.find((category) => category.id === id)?.label || id;
}

export function attachmentLabel(id) {
  return ATTACHMENT_TYPES.find((type) => type.id === id)?.label || id;
}

/**
 * Validasi manifest modul. Tidak mengubah data masukan.
 * @returns {{ok: boolean, status: string, errors: string[], warnings: string[], module: object|null}}
 */
export function validateModuleManifest(raw) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(raw)) {
    return { ok: false, status: VALIDATION_STATUS.INVALID, errors: ['Manifest bukan objek JSON.'], warnings, module: null };
  }

  const missing = MODULE_FIELDS.filter((field) => !(field in raw));
  if (missing.length) errors.push(`Field wajib tidak ada: ${missing.join(', ')}.`);

  if (!isNonEmptyString(raw.moduleId) || !ID_PATTERN.test(raw.moduleId)) {
    errors.push('moduleId harus huruf kecil/angka dengan tanda - . _ (3–48 karakter).');
  }
  if (!isNonEmptyString(raw.moduleName) || raw.moduleName.length > 48) {
    errors.push('moduleName wajib diisi (maksimum 48 karakter).');
  }
  if (!isNonEmptyString(raw.moduleVersion) || !/^\d+\.\d+(\.\d+)?$/.test(raw.moduleVersion)) {
    errors.push('moduleVersion harus berbentuk angka seperti 1.0 atau 1.0.0.');
  }
  if (!CATEGORY_IDS.has(raw.category)) {
    errors.push(`category tidak dikenal: ${String(raw.category)}.`);
  }
  if (!isNonEmptyString(raw.sourceFile)) errors.push('sourceFile wajib diisi.');
  if (!isNonEmptyString(raw.sourceFormat)) errors.push('sourceFormat wajib diisi.');
  if (!isNonEmptyString(raw.sourceLicense)) errors.push('sourceLicense wajib diisi.');
  if (!Number.isFinite(Number(raw.scale)) || Number(raw.scale) <= 0 || Number(raw.scale) > 100) {
    errors.push('scale harus angka lebih dari 0 dan tidak lebih dari 100.');
  }
  if (!isNonEmptyString(raw.orientation)) {
    errors.push('orientation wajib diisi (contoh "+Y up, +Z forward").');
  }
  if (!ATTACHMENT_IDS.has(raw.attachmentType)) {
    errors.push(`attachmentType tidak dikenal: ${String(raw.attachmentType)}.`);
  }
  if (!isNonEmptyString(raw.attachmentPoint)) errors.push('attachmentPoint wajib diisi.');
  if (!isNonEmptyString(raw.bodyRegion)) errors.push('bodyRegion wajib diisi.');
  if (!isNonEmptyString(raw.supportedSkeleton)) errors.push('supportedSkeleton wajib diisi.');
  if (!isStringArray(raw.requiredBones)) errors.push('requiredBones harus array string.');
  if (!isStringArray(raw.materialList)) errors.push('materialList harus array string.');
  if (!isStringArray(raw.textureList)) errors.push('textureList harus array string.');
  if (!isStringArray(raw.compatibleBodyProfiles)) errors.push('compatibleBodyProfiles harus array string.');
  if (!STATUS_VALUES.has(raw.validationStatus)) {
    errors.push(`validationStatus harus salah satu: ${[...STATUS_VALUES].join(', ')}.`);
  }
  if (!isStringArray(raw.knownLimitations)) errors.push('knownLimitations harus array string.');

  const generator = isNonEmptyString(raw.generator) ? raw.generator.trim() : null;
  if (!generator) errors.push('Manifest tidak menyebut generator prosedural yang dipakai.');

  if (isNonEmptyString(raw.orientation) && raw.orientation !== ORIENTATION) {
    warnings.push(`Orientasi modul "${raw.orientation}" berbeda dari konvensi UCF "${ORIENTATION}".`);
  }
  if (Array.isArray(raw.textureList) && raw.textureList.length) {
    warnings.push('Modul menyebut tekstur eksternal; pastikan berkasnya tersedia sebelum dipakai.');
  }
  if (raw.validationStatus === VALIDATION_STATUS.UNKNOWN) {
    warnings.push('Metadata menyatakan UNKNOWN; kompatibilitas akan diperiksa ulang saat dipasang.');
  }
  if (raw.validationStatus === VALIDATION_STATUS.NEEDS) {
    warnings.push('Metadata menyatakan NEEDS VALIDATION; status ini akan dipertahankan sampai pemeriksaan lulus.');
  }

  const module = {
    ...raw,
    moduleId: String(raw.moduleId || '').trim(),
    moduleName: String(raw.moduleName || '').trim(),
    moduleVersion: String(raw.moduleVersion || ''),
    category: raw.category,
    attachmentType: raw.attachmentType,
    requiredBones: Array.isArray(raw.requiredBones) ? [...raw.requiredBones] : [],
    materialList: Array.isArray(raw.materialList) ? [...raw.materialList] : [],
    textureList: Array.isArray(raw.textureList) ? [...raw.textureList] : [],
    compatibleBodyProfiles: Array.isArray(raw.compatibleBodyProfiles) ? [...raw.compatibleBodyProfiles] : [],
    knownLimitations: Array.isArray(raw.knownLimitations) ? [...raw.knownLimitations] : [],
    generator,
    options: isPlainObject(raw.options) ? { ...raw.options } : {},
    imported: Boolean(raw.imported)
  };

  return {
    ok: errors.length === 0,
    status: errors.length ? VALIDATION_STATUS.INVALID : raw.validationStatus,
    errors,
    warnings,
    module: errors.length ? null : module
  };
}

/** Profil body & skeleton target dari rig yang sedang aktif. */
export function targetProfileForRig(rig) {
  const bones = rig?.stats?.bones ?? rig?.list?.length ?? 0;
  return {
    bodyProfile: BODY_PROFILE_ID,
    skeleton: bones ? `ucf-humanoid-${bones}` : 'UNKNOWN',
    bones
  };
}
