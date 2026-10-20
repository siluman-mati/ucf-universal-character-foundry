/**
 * UCF Image-to-3D Engine — orchestrator
 * Jalur lokal (silhouette extrude) selalu tersedia.
 * Jalur remote (TripoSR/TRELLIS) adalah opsional — UI jujur bila tidak ada server.
 */
import { loadImageToCanvas, createMaskFromCanvas, getMaskBBox, cropToBBox } from './imageLoader.js';
import { generateSilhouetteMesh, verifyMeshIs3D } from './silhouetteMesh.js';
import * as THREE from 'three';


export const ENGINE_MODES = {
  silhouette: { id: 'silhouette', label: 'Silhouette Extrude (lokal, cepat)', avail: true, note: 'Tanpa GPU — ekstrusi mask → mesh solid bervolume. Punggung datar, tanpa detail 360°.' },
  tripoRemote: { id: 'tripoRemote', label: 'TripoSR (butuh server GPU)', avail: false, note: 'Butuh server dengan TripoSR 6GB VRAM. Belum terpasang di sandbox ini.' },
  trellisRemote: { id: 'trellisRemote', label: 'TRELLIS.2 (butuh server 24GB)', avail: false, note: 'Butuh Linux + 24GB VRAM. Hanya demo HF Space.' },
  hunyuanRemote: { id: 'hunyuanRemote', label: 'Hunyuan3D (butuh server 16GB)', avail: false, note: 'Butuh 16GB VRAM + Community License (EU/UK dikecualikan).' }
};

export function listEngines() {
  return Object.values(ENGINE_MODES);
}

/**
 * Proses gambar File → mesh 3D
 * @param {File} file
 * @param {object} opts { mode, targetHeight, depthRatio, maxDim }
 * @returns {Promise<{group:THREE.Group, mesh:THREE.Mesh, meta:object}>}
 */
export async function generateFromImageFile(file, opts = {}) {
  const mode = opts.mode || 'silhouette';
  if (mode !== 'silhouette') {
    throw Object.assign(new Error(`Mesin ${mode} tidak tersedia lokal. Jalankan server GPU terpisah (lihat docs/AUDIT-IMAGE-TO-3D.md).`), { code: 'remote-required', mode });
  }
  const t0 = performance.now();
  // 1. Load canvas
  const loaded = await loadImageToCanvas(file);
  const { canvas, ctx, width, height } = loaded;
  // 2. Mask
  const masked = createMaskFromCanvas(canvas, ctx);
  const bbox = getMaskBBox(masked.mask, masked.w, masked.h);
  if (!bbox) throw new Error('Tidak ada objek terdeteksi — latar dan objek tidak terpisah. Coba gambar dengan latar putih/ transparan dan karakter di tengah.');
  if (bbox.areaRatio < 0.002) throw new Error(`Objek terlalu kecil (${(bbox.areaRatio*100).toFixed(2)}% gambar) — crop karakter lebih dekat.`);
  if (bbox.areaRatio > 0.92) throw new Error('Hampir seluruh gambar dianggap objek — latar tidak kontras. Gunakan latar putih/polosan atau crop tunggal karakter.');

  // 3. Crop ke bbox (pertahankan texture asli)
  const cropped = cropToBBox(canvas, ctx, bbox, 10);
  // Buat texture canvas untuk mapping (gunakan cropped canvas)
  const textureCanvas = cropped.canvas; // sudah berisi gambar crop

  // 4. Buat mask cropped untuk geometri (gunakan mask crop yang sama)
  // Kita perlu mask baru untuk cropped canvas: ambil mask region
  const { mask: fullMask, w: fw, h: fh } = masked;
  // Extract mask region corresponding to cropped bbox
  const cw = cropped.cw, ch = cropped.ch;
  // Map cropped pixel ke fullMask via coordinate
  const cropMask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const fx = cropped.x0 + x, fy = cropped.y0 + y;
      if (fx >=0 && fx < fw && fy >=0 && fy < fh) cropMask[y*cw + x] = fullMask[fy*fw + fx];
    }
  }

  // 5. Generate mesh
  const res = generateSilhouetteMesh(cropMask, cw, ch, {
    maxDim: opts.maxDim ?? 220, // 220 agar jumlah vertex terkendali (~5k)
    textureCanvas,
    targetHeight: opts.targetHeight ?? 1.7,
    depthRatio: opts.depthRatio ?? 0.22,
    bevel: opts.bevel ?? true,
    name: `Image3D_${file.name.replace(/\.[^.]+$/,'')}`
  });

  const { mesh, depth, worldW, worldH, bbox: geomBBox } = res;
  const verify = verifyMeshIs3D(mesh);

  // 6. Bungkus dalam Group agar bisa di-rig nanti
  const group = new THREE.Group();
  group.name = `ImageTo3D_${file.name.replace(/\.[^.]+$/,'')}`;
  group.userData.isImageTo3DGroup = true;
  group.userData.sourceImage = { fileName: file.name, width, height, bbox, backgroundColor: masked.backgroundColor, method: masked.method };
  group.add(mesh);

  // Posisi y=0 di kaki (viewport akan fit otomatis, tapi kita set pivot kaki di bawah)
  // Geometris extrude sudah center; kita geser agar minY =0
  const geomBB = mesh.geometry.boundingBox;
  const minY = geomBB.min.y;
  if (Math.abs(minY) > 0.001) {
    mesh.position.y -= minY;
    mesh.updateMatrixWorld(true);
  }

  const t1 = performance.now();
  const meta = {
    ok: true,
    fileName: file.name,
    originalSize: [width, height],
    bbox,
    maskInfo: { count: bbox.count, areaRatio: bbox.areaRatio, method: masked.method, bg: masked.backgroundColor },
    meshInfo: { vertices: verify.vertices, triangles: verify.triangles, size: verify.size, is3D: verify.is3D, depth, worldW, worldH, loopPoints: res.loopPoints },
    timings: { totalMs: Number((t1 - t0).toFixed(1)) },
    engine: 'silhouette-extrude',
    depth, worldW, worldH,
    warnings: [
      'Metode ekstrusi siluet — punggung rata, tidak ada detail belakang. Untuk rekonstruksi neural 360° butuh server GPU (TripoSR/TRELLIS).',
      'Jika karakter memiliki celah (antara kaki) kontur akan menyatu — kaki mungkin menempel.'
    ]
  };
  return { group, mesh, meta, loaded, bbox, masked };
}

/**
 * Coba remote engine (stub jujur)
 */
export async function tryRemoteEngine(file, mode, serverUrl) {
  if (!serverUrl) throw new Error('URL server GPU belum diatur. Jalankan TripoSR/TRELLIS di server terpisah dan isi URL di pengaturan.');
  // Contoh payload — implementasi nyata akan POST FormData image ke server
  throw Object.assign(new Error(`Remote ${mode} belum diimplementasikan di build ini. Server harus mengekspos POST /generate yang mengembalikan GLB.`), { code: 'not-implemented' });
}
