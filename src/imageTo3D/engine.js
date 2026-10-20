/**
 * UCF Image-to-3D Engine — orchestrator
 * Jalur lokal (silhouette extrude) selalu tersedia.
 * Jalur remote (TripoSR/TRELLIS) adalah opsional — UI jujur bila tidak ada server.
 */
import { loadImageToCanvas, createMaskFromCanvas, getMaskBBox, cropToBBox } from './imageLoader.js';
import { generateSilhouetteMesh, verifyMeshIs3D } from './silhouetteMesh.js';
import * as THREE from 'three';


export const ENGINE_MODES = {
  silhouette: { id: 'silhouette', label: 'Silhouette Extrude (lokal, sederhana)', avail: true, note: 'Tanpa GPU — ekstrusi uniform 0.22×tinggi, punggung datar, bertumpuk untuk sheet. Hanya untuk logo/ikon, bukan karakter volumetrik. Lihat AUDIT-VOLUMETRIK.' },
  tripoRemote: { id: 'tripoRemote', label: 'TripoSR (MIT, 6GB VRAM) — volumetrik (rekomendasi)', avail: false, note: 'Butuh server GPU 6GB atau HF Space gratis huggingface.co/spaces/stabilityai/TripoSR (tanpa API berbayar). Jika Space down (503) akan gagal jujur.' },
  trellisRemote: { id: 'trellisRemote', label: 'TRELLIS.2 (butuh server 24GB)', avail: false, note: 'Butuh Linux + 24GB VRAM (A100). Hanya HF Space microsoft/TRELLIS.' },
  hunyuanRemote: { id: 'hunyuanRemote', label: 'Hunyuan3D (Community License, 16–29GB)', avail: false, note: 'Butuh 16–29GB VRAM, lisensi kecualikan EU/UK/SK, cap 1M MAU.' }
};

export function listEngines() {
  return Object.values(ENGINE_MODES);
}

/**
 * Proses gambar File → mesh 3D
 * @param {File} file
 * @param {object} opts { mode, targetHeight, depthRatio, maxDim, cropRect:{x,y,w,h}, onProgress }
 * @returns {Promise<{group:THREE.Group, mesh:THREE.Mesh, meta:object}>}
 */
export async function generateFromImageFile(file, opts = {}) {
  const mode = opts.mode || 'silhouette';
  if (mode !== 'silhouette') {
    // Tahap 4: hubungkan ke engine rekonstruksi yang benar-benar dijalankan — bukan placeholder
    // Jika tidak ada server/GPU, tampilkan gagal jujur, jangan fallback diam-diam ke silhouette
    if (opts.tryRemote) return tryRemoteEngine(file, mode, opts.serverUrl, opts);
    throw Object.assign(new Error(`Mesin ${mode} memerlukan server GPU / HF Space. Pilih Silhouette hanya untuk siluet sederhana, bukan karakter volumetrik. Lihat docs/AUDIT-VOLUMETRIK-IMAGE-TO-3D.md`), { code: 'remote-required', mode });
  }
  const t0 = performance.now();
  // 1. Load canvas — Tahap 3: jika ada cropRect dari cropper, gunakan; jangan proses seluruh sheet sebagai satu siluet
  let cropRect = opts.cropRect || null;
  const loaded = await loadImageToCanvas(file);
  let { canvas, ctx, width, height } = loaded;
  if (cropRect && cropRect.w > 16 && cropRect.h > 16) {
    const cw0 = canvas.width, ch0 = canvas.height;
    const rx = Math.max(0, Math.min(cw0-1, cropRect.x));
    const ry = Math.max(0, Math.min(ch0-1, cropRect.y));
    const rw = Math.max(16, Math.min(cw0-rx, cropRect.w));
    const rh = Math.max(16, Math.min(ch0-ry, cropRect.h));
    const out = document.createElement('canvas');
    out.width = rw; out.height = rh;
    const octx = out.getContext('2d', { willReadFrequently:true });
    octx.fillStyle='#ffffff'; octx.fillRect(0,0,rw,rh);
    octx.drawImage(canvas, rx, ry, rw, rh, 0,0,rw,rh);
    canvas = out; ctx = octx; width = rw; height = rh;
    if (opts.onProgress) opts.onProgress({ stage:'crop', rect:{x:rx,y:ry,w:rw,h:rh} });
  }
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
 * Remote engine nyata — TripoSR via HF Space gradio (gratis, tanpa API berbayar)
 * Tahap 4: hubungkan ke engine yang benar-benar dijalankan, tampilkan status asli, jangan fallback diam-diam.
 * Jika GPU/ Space tidak tersedia → gagal jujur, bukan sukses palsu.
 * Gambar hanya dikirim setelah consent (ditangani di main.js).
 */
export async function tryRemoteEngine(file, mode, serverUrl, opts = {}) {
  const onProgress = opts.onProgress || (()=>{});
  // Default HF Space untuk TripoSR (MIT, 6GB) — gratis, no token
  const defaultHF = mode === 'tripoRemote' ? 'https://stabilityai-triposr.hf.space'
    : mode === 'trellisRemote' ? 'https://microsoft-trellis.hf.space'
    : 'https://tencent-hunyuan3d-2.hf.space';
  const base = (serverUrl || defaultHF).replace(/\/$/, '');
  onProgress({ stage:'remote-prepare', server: base, mode });
  // Tahap 5: pastikan output berasal dari inferensi, bukan placeholder — kita tidak membuat mesh tiruan
  // Validasi file: harus 1 karakter tengah, bg bersih
  if (file.size > 8*1024*1024) throw new Error('Gambar terlalu besar (>8MB) — kompres atau crop ke 512×512.');

  // Upload ke gradio /upload
  let uploadPath;
  try {
    onProgress({ stage:'upload', msg:`Mengunggah ${file.name} ke ${base}…` });
    const fd = new FormData();
    fd.append('files', file, file.name);
    const upRes = await fetch(`${base}/gradio_api/upload`, { method:'POST', body: fd });
    if (!upRes.ok) throw new Error(`Upload gagal ${upRes.status}: ${upRes.statusText} — Space mungkin down (503)`);
    const upJson = await upRes.json();
    // gradio upload returns ["file=/tmp/..."] atau ["..."]
    uploadPath = Array.isArray(upJson) ? upJson[0] : upJson.files?.[0] || upJson[0];
    if (!uploadPath) throw new Error('Upload tidak mengembalikan path file');
    onProgress({ stage:'uploaded', path: uploadPath });
  } catch(e) {
    throw Object.assign(new Error(`Gagal upload ke ${base}: ${e.message} — Space mungkin offline/503. Coba self-host TripoSR (6GB VRAM) atau gunakan Silhouette untuk siluet sederhana.`), { cause:e, code:'remote-upload-fail', mode });
  }

  // Call generate: TripoSR gradio app.py generate(image, mc_resolution=256)
  // Kita perlu cek view_api; TripoSR expose /generate atau /run_example
  const apiName = mode==='tripoRemote' ? '/generate' : '/predict';
  let eventId;
  try {
    onProgress({ stage:'infer', msg:`Inferensi ${mode} di ${base} — hallucinate belakang (30–60s)…` });
    const callRes = await fetch(`${base}/gradio_api/call${apiName}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ data: [{ path: uploadPath, url: `${base}/gradio_api/file=${encodeURIComponent(uploadPath)}`, orig_name: file.name, size: file.size, mime_type: file.type }, 256] })
    });
    if (!callRes.ok) {
      const t = await callRes.text().catch(()=>callRes.statusText);
      throw new Error(`Call ${apiName} gagal ${callRes.status}: ${t.slice(0,300)}`);
    }
    const cj = await callRes.json();
    eventId = cj.event_id || cj.eventId;
    if (!eventId) throw new Error('Tidak ada event_id dari Space — API berubah');
    onProgress({ stage:'poll', eventId });
  } catch(e) {
    throw Object.assign(new Error(`Gagal memanggil ${apiName} di ${base}: ${e.message}`), { cause:e, code:'remote-call-fail' });
  }

  // Poll SSE: GET /gradio_api/call/generate/{event_id}
  let glbUrl = null;
  try {
    const sseUrl = `${base}/gradio_api/call${apiName}/${eventId}`;
    // Gunakan fetch SSE (event stream) — kita poll dengan fetch + text
    const evRes = await fetch(sseUrl, { headers:{ Accept:'text/event-stream' } });
    if (!evRes.ok) throw new Error(`SSE poll gagal ${evRes.status}`);
    const text = await evRes.text();
    // Parse SSE lines: event: complete \n data: ["...", "http://.../file=...glb"]
    // TripoSR returns [objFile, glbFile] atau [processed, obj, glb]
    let dataLine = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) dataLine = line.slice(6);
    }
    if (!dataLine) throw new Error('SSE tidak ada data: ' + text.slice(0,500));
    const data = JSON.parse(dataLine);
    // data adalah array output files
    for (const v of data) {
      if (v && typeof v==='object' && v.url && /\.glb$/i.test(v.url)) { glbUrl = v.url; break; }
      if (typeof v==='string' && /\.glb$/i.test(v)) { glbUrl = `${base}/gradio_api/file=${encodeURIComponent(v)}`; break; }
    }
    // fallback: cari .glb di data
    if (!glbUrl) {
      const m = text.match(/https?:[^\"]+\.glb/gi);
      if (m) glbUrl = m[0];
    }
    if (!glbUrl) throw new Error('Tidak ada GLB di response: ' + text.slice(0,800));
    onProgress({ stage:'download', glbUrl });
  } catch(e) {
    throw Object.assign(new Error(`Gagal polling hasil ${mode}: ${e.message} — cek Space log (scikit-build-core error saat ini)`), { cause:e, code:'remote-poll-fail' });
  }

  // Download GLB dan impor ke viewport
  try {
    onProgress({ stage:'download-glb', url: glbUrl });
    const glbRes = await fetch(glbUrl);
    if (!glbRes.ok) throw new Error(`Download GLB gagal ${glbRes.status}`);
    const glbBuf = await glbRes.arrayBuffer();
    onProgress({ stage:'import', bytes: glbBuf.byteLength });
    // Gunakan GLTFLoader untuk parse glb
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej)=> loader.parse(glbBuf, '', res, rej));
    const group = new THREE.Group();
    group.name = `TripoSR_${file.name.replace(/\.[^.]+$/,'')}`;
    group.userData.isImageTo3DGroup = true;
    group.userData.sourceImage = { fileName: file.name, engine: mode, server: base, glbUrl };
    group.add(gltf.scene);
    // Normalize scale: TripoSR mesh bisa besar, fit ke 1.7m
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) {
      const scale = 1.7 / size.y;
      group.scale.setScalar(scale);
      group.updateMatrixWorld(true);
      // pos kaki di 0
      const box2 = new THREE.Box3().setFromObject(group);
      group.position.y -= box2.min.y;
    }
    const t1 = performance.now();
    const meta = {
      ok: true, fileName: file.name,
      engine: mode, server: base, glbUrl, eventId,
      originalSize: [0,0], // will be filled by caller if needed
      meshInfo: { vertices: gltf.scene ? (()=>{ let c=0; gltf.scene.traverse(o=>{ if(o.isMesh) c+= o.geometry.attributes.position.count; }); return c; })() : 0, is3D: true, size: [size.x,size.y,size.z] },
      timings: { totalMs: 0 }, // t1-t0 di caller
      warnings: [], inference: true
    };
    return { group, mesh: null, gltf: gltf.scene, meta, glbBuf, glbUrl };
  } catch(e) {
    throw Object.assign(new Error(`Gagal impor GLB dari ${mode}: ${e.message}`), { cause:e, code:'remote-import-fail' });
  }
}
