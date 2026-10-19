/**
 * UCF — impor GLB / glTF (Tahap 1).
 * Reader menghasilkan laporan terukur: jumlah mesh, material, tekstur, skeleton,
 * tulang, skinned mesh, morph target, klip; plus peringatan ekstensi.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { detectFormat, readGltfJson, classifyExtensions } from './format.js';
import { summarize } from './stats.js';

export class ImportError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

function warnExternalResources(externalResources) {
  const names = externalResources.slice(0, 5).map((item) => `${item.kind}[${item.index}] ${item.uri}`);
  const more = externalResources.length > 5 ? ` (+${externalResources.length - 5} lainnya)` : '';
  return `Resource eksternal dirujuk: ${names.join(', ')}${more}.`;
}

/**
 * @param {File} file
 * @returns {Promise<{report: object, root: import('three').Object3D, animations: import('three').AnimationClip[]}>}
 */
export async function importModelFile(file) {
  const format = detectFormat(file?.name);
  if (!format) {
    throw new ImportError(
      `Format berkas tidak didukung: "${file?.name || 'tanpa nama'}". Tahap 1 hanya menerima .glb atau .gltf.`,
      'format'
    );
  }

  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new ImportError('Berkas kosong (0 byte).', 'empty');
  }

  const json = readGltfJson(buffer);
  if (!json || typeof json !== 'object') {
    throw new ImportError('Struktur glTF/GLB tidak terbaca: header atau JSON tidak valid.', 'invalid');
  }

  const extensions = classifyExtensions(json);

  if (extensions.requiredUnsupported.length) {
    throw new ImportError(
      `Ekstensi wajib tidak didukung: ${extensions.requiredUnsupported.join(', ')}. ` +
        'Model tidak dapat dimuat pada Tahap 1; tidak ada data yang diklaim berhasil.',
      'required-extension'
    );
  }

  if (extensions.externalResources.length) {
    throw new ImportError(
      `${warnExternalResources(extensions.externalResources)} ` +
        'Tahap 1 hanya mendukung .gltf self-contained (resource data URI) atau .glb. ' +
        'Kompres menjadi .glb atau sematkan resource terlebih dahulu.',
      'external-resource'
    );
  }

  const version = String(json.asset?.version || '');
  if (version && !version.startsWith('2')) {
    throw new ImportError(`Versi glTF tidak didukung: ${version} (perlu 2.x).`, 'version');
  }

  const loader = new GLTFLoader();
  // Dekoder meshopt resmi three.js (MIT) — dipakai XBot.glb dan banyak aset glTF modern.
  loader.setMeshoptDecoder(MeshoptDecoder);
  const started = performance.now();
  let gltf;
  try {
    gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  } catch (error) {
    throw new ImportError(`Gagal mengurai model: ${error?.message || error}`, 'parse');
  }
  const loadMs = performance.now() - started;

  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) {
    throw new ImportError('Berkas tidak memiliki scene yang dapat dimuat.', 'no-scene');
  }

  const animations = Array.isArray(gltf.animations) ? gltf.animations : [];
  const stats = summarize(root, { clips: animations, json });

  const warnings = [];
  for (const extension of extensions.unsupported) {
    warnings.push(`${extension.name}: ${extension.reason}`);
  }
  if (extensions.unverified.length) {
    warnings.push(
      `Ekstensi belum diverifikasi pada Tahap 1: ${extensions.unverified.join(', ')}. ` +
        'Tampilan bisa berbeda dari aplikasi lain.'
    );
  }
  if (stats.meshes === 0) {
    warnings.push('Berkas tidak berisi mesh yang dapat ditampilkan (hanya node/kamera/cahaya?).');
  }
  if (stats.images > 0 && stats.textures === 0) {
    warnings.push(
      `${stats.images} gambar ditemukan di berkas tetapi tidak terpetakan ke slot material yang dibaca; ` +
        'tekstur mungkin tidak tampil.'
    );
  }
  if (stats.skinnedMeshes > 0 && stats.bones === 0) {
    warnings.push('Skinned mesh ditemukan tanpa node tulang; binding perlu diperiksa di Tahap 3.');
  }
  if (stats.skinnedMeshes === 0 && stats.bones > 0) {
    warnings.push('Tulang ditemukan tetapi tidak ada skinned mesh; skeleton belum menggerakkan mesh.');
  }

  const report = {
    ok: true,
    fileName: file.name,
    format,
    bytes: buffer.byteLength,
    loadMs,
    stats,
    warnings,
    extensions: {
      used: extensions.used,
      supported: extensions.supported,
      unsupported: extensions.unsupported,
      unverified: extensions.unverified,
      required: extensions.required
    },
    animationCount: animations.length,
    clipNames: animations.map((clip) => clip.name || '(tanpa nama)'),
    rootName: root.name || '(tanpa nama)'
  };

  return { report, root, animations };
}
