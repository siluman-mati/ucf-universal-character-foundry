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

export function characterToConfig(entry, model) {
  return {
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
      transform: { position, rotationY, scale }
    };
  });

  return { characters, warnings, version: data.version || 'tidak dicatat' };
}
