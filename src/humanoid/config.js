/**
 * UCF Tahap 2 — simpan/muat konfigurasi karakter.
 * Format: ucf-character-config v1.0 (JSON, tanpa backend).
 */
import { sanitizeParams, POSE_IDS } from './params.js';

export const CONFIG_FORMAT = 'ucf-character-config';
export const CONFIG_VERSION = '1.0';

export function sanitizeCharacterName(value, fallback = 'Humanoid') {
  const raw = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const name = raw.slice(0, 48);
  return name || fallback;
}

export function characterToConfig(entry, model, modular = null) {
  const config = {
    id: entry.id,
    name: entry.name,
    pose: entry.pose,
    params: { ...entry.params },
    transform: {
      position: model ? model.root.position.toArray().map(Number) : [0, 0, 0],
      rotationY: model ? model.root.rotation.y : 0,
      scale: model ? model.root.scale.x : 1
    }
  };
  if (modular && Array.isArray(modular.modules)) {
    config.modules = modular.modules.map((module) => ({
      instanceId: typeof module.instanceId === 'string' ? module.instanceId : 'ml-?',
      moduleId: String(module.moduleId || ''),
      name: typeof module.name === 'string' ? module.name.slice(0, 48) : module.moduleId,
      category: module.category,
      attachmentType: module.attachmentType,
      visible: module.visible !== false,
      material: module.material && typeof module.material === 'object' ? { ...module.material } : {},
      transform: module.transform || { scale: 1, offset: [0, 0, 0] },
      validationStatus: module.validationStatus || 'UNKNOWN',
      metadata: module.metadata || {},
      manifest: module.manifest || null
    }));
  }
  return config;
}

function sanitizeModules(raw, name, warnings) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${name}: field modules bukan array; diabaikan.`);
    return [];
  }
  const modules = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object' || typeof item.moduleId !== 'string' || !item.moduleId) {
      warnings.push(`${name}: entri modul #${index + 1} tidak valid dan dilewati.`);
      return;
    }
    modules.push({
      instanceId: typeof item.instanceId === 'string' ? item.instanceId : `ml-restore-${index + 1}`,
      moduleId: item.moduleId,
      name: typeof item.name === 'string' ? item.name.slice(0, 48) : item.moduleId,
      category: item.category || null,
      attachmentType: item.attachmentType || null,
      visible: item.visible !== false,
      material: item.material && typeof item.material === 'object' ? { ...item.material } : {},
      transform: item.transform && typeof item.transform === 'object'
        ? {
          scale: Number.isFinite(Number(item.transform.scale)) ? Number(item.transform.scale) : 1,
          offset: Array.isArray(item.transform.offset) ? item.transform.offset.slice(0, 3).map(Number) : [0, 0, 0]
        }
        : { scale: 1, offset: [0, 0, 0] },
      validationStatus: item.validationStatus || 'UNKNOWN',
      metadata: item.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : {},
      manifest: item.manifest && typeof item.manifest === 'object' ? { ...item.manifest } : null
    });
  });
  return modules;
}

export function exportConfig(characters, { savedAt = new Date().toISOString() } = {}) {
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    stage: 2,
    savedAt,
    characters
  };
}

/**
 * @param {string|object} input
 * @returns {{characters: object[], warnings: string[], version: string}}
 */
export function parseConfig(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      throw new Error(`JSON tidak valid: ${error.message}`);
    }
  }
  if (!data || typeof data !== 'object') throw new Error('Konfigurasi kosong atau bukan objek.');
  if (data.format !== CONFIG_FORMAT) {
    throw new Error('Format konfigurasi tidak dikenal (perlu "ucf-character-config").');
  }
  if (!Array.isArray(data.characters)) throw new Error('Konfigurasi tidak memiliki array "characters".');
  if (data.characters.length > 24) throw new Error('Terlalu banyak karakter dalam satu konfigurasi (maksimum 24).');

  const warnings = [];
  if (data.version && data.version !== CONFIG_VERSION) {
    warnings.push(`Versi konfigurasi ${data.version} dibaca dengan pembaca ${CONFIG_VERSION}.`);
  }

  const characters = data.characters.map((raw, index) => {
    const name = sanitizeCharacterName(raw?.name, `Humanoid ${index + 1}`);
    const { params, warnings: paramWarnings } = sanitizeParams(raw?.params || {});
    for (const warning of paramWarnings) warnings.push(`${name}: ${warning}`);

    let pose = 'T';
    if (POSE_IDS.includes(raw?.pose)) {
      pose = raw.pose;
    } else if (raw?.pose) {
      warnings.push(`${name}: pose "${raw.pose}" tidak dikenal; memakai T.`);
    }

    const rawPosition = raw?.transform?.position;
    const position = Array.isArray(rawPosition) && rawPosition.length === 3 && rawPosition.every((value) => Number.isFinite(Number(value)))
      ? rawPosition.map(Number)
      : [0, 0, 0];
    if (rawPosition && (position[0] !== Number(rawPosition[0]) || position[1] !== Number(rawPosition[1]) || position[2] !== Number(rawPosition[2]))) {
      warnings.push(`${name}: transform.position tidak valid; memakai [0,0,0].`);
    }

    const rotationY = Number.isFinite(Number(raw?.transform?.rotationY)) ? Number(raw.transform.rotationY) : 0;
    const scaleValue = Number(raw?.transform?.scale);
    const scale = Number.isFinite(scaleValue) ? Math.min(5, Math.max(0.2, scaleValue)) : 1;

    return {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : `karakter-${index + 1}`,
      name,
      pose,
      params,
      transform: { position, rotationY, scale },
      modules: sanitizeModules(raw?.modules, name, warnings)
    };
  });

  return { characters, warnings, version: data.version || 'tidak dicatat' };
}
