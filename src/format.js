/**
 * UCF — util format berkas & inspeksi glTF.
 * Fungsi murni (tanpa DOM / WebGL) agar dapat diuji dengan node:test.
 */

export const SUPPORTED_FORMATS = Object.freeze(['glb', 'gltf']);

/** Ekstensi yang diketahui didukung three.js 0.180 (tanpa dekoder tambahan). */
export const KNOWN_SUPPORTED_EXTENSIONS = Object.freeze([
  'KHR_materials_unlit',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_clearcoat',
  'KHR_materials_sheen',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_specular',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
  'KHR_lights_punctual',
  'EXT_texture_webp',
  'EXT_meshopt_compression'
]);

/** Ekstensi yang diketahui TIDAK didukung pada Tahap 1, beserta alasannya. */
export const KNOWN_UNSUPPORTED_EXTENSIONS = Object.freeze({
  KHR_draco_mesh_compression:
    'Dekoder Draco tidak disertakan pada Tahap 1; geometri terkompresi tidak dapat dimuat.',
  KHR_texture_basisu:
    'Tekstur KTX2 / Basis Universal belum didukung pada Tahap 1.',
  KHR_materials_pbrSpecularGlossiness:
    'three.js tidak lagi mendukung material specular-glossiness; material tidak akan sama dengan aslinya.',
  MSFT_lod:
    'Level-of-detail Microsoft tidak didukung.',
  KHR_animation_pointer:
    'Animasi berbasis pointer tidak didukung three.js 0.180.'
});

/** Ambil ekstensi dari nama berkas; null bila bukan format yang didukung. */
export function detectFormat(fileName) {
  if (typeof fileName !== 'string') return null;
  const clean = fileName.split(/[?#]/)[0].trim();
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  return SUPPORTED_FORMATS.includes(ext) ? ext : null;
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const numberFormat = new Intl.NumberFormat('id-ID');

export function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  return numberFormat.format(value);
}

export function formatMeters(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} m`;
}

/**
 * Baca JSON glTF dari ArrayBuffer GLB (chunk JSON) atau dari berkas .gltf (teks).
 * Mengembalikan object, atau null bila tidak terbaca.
 */
export function readGltfJson(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 4) return null;
  const view = new DataView(arrayBuffer);
  const MAGIC = 0x46546c67; // 'glTF'
  const JSON_CHUNK = 0x4e4f534a; // 'JSON'

  if (view.getUint32(0, true) === MAGIC) {
    if (arrayBuffer.byteLength < 20) return null;
    const version = view.getUint32(4, true);
    if (version !== 2) return null;
    let offset = 12;
    while (offset + 8 <= arrayBuffer.byteLength) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length;
      if (end > arrayBuffer.byteLength) return null;
      if (type === JSON_CHUNK) {
        try {
          return JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
        } catch {
          return null;
        }
      }
      offset = end;
    }
    return null;
  }

  try {
    const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Klasifikasi ekstensi glTF dan deteksi resource eksternal.
 */
export function classifyExtensions(json) {
  const used = Array.isArray(json?.extensionsUsed)
    ? json.extensionsUsed.filter((n) => typeof n === 'string')
    : [];
  const required = Array.isArray(json?.extensionsRequired)
    ? json.extensionsRequired.filter((n) => typeof n === 'string')
    : [];

  const unsupported = used
    .filter((name) => Object.prototype.hasOwnProperty.call(KNOWN_UNSUPPORTED_EXTENSIONS, name))
    .map((name) => ({ name, reason: KNOWN_UNSUPPORTED_EXTENSIONS[name] }));
  const unverified = used.filter(
    (name) =>
      !Object.prototype.hasOwnProperty.call(KNOWN_UNSUPPORTED_EXTENSIONS, name) &&
      !KNOWN_SUPPORTED_EXTENSIONS.includes(name)
  );
  const supported = used.filter((name) => KNOWN_SUPPORTED_EXTENSIONS.includes(name));

  const requiredUnsupported = required.filter((name) =>
    Object.prototype.hasOwnProperty.call(KNOWN_UNSUPPORTED_EXTENSIONS, name)
  );

  const externalResources = [];
  const checkUri = (uri, kind, index) => {
    if (typeof uri === 'string' && uri.length > 0 && !uri.startsWith('data:')) {
      externalResources.push({ kind, index, uri });
    }
  };
  (json?.buffers || []).forEach((buffer, i) => checkUri(buffer?.uri, 'buffer', i));
  (json?.images || []).forEach((image, i) => checkUri(image?.uri, 'image', i));

  return { used, required, supported, unsupported, unverified, requiredUnsupported, externalResources };
}

/** Ringkasan kecil untuk ditampilkan di laporan impor. */
export function describeExtensions(extensions) {
  if (!extensions) return '—';
  const names = (list) => list.map((item) => (typeof item === 'string' ? item : item.name));
  const parts = [];
  if (extensions.unsupported.length) parts.push(`tidak didukung: ${names(extensions.unsupported).join(', ')}`);
  if (extensions.unverified.length) parts.push(`belum diverifikasi: ${extensions.unverified.join(', ')}`);
  if (!parts.length) return extensions.used.length ? `didukung: ${extensions.used.join(', ')}` : 'tidak ada';
  return parts.join(' · ');
}
