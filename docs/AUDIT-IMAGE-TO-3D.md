# AUDIT UCF — Image-to-3D (Langkah 1)

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Repo:** `/home/user/ucf` · **Basis:** `3efa5d6` tag `ucf-tahap-7` (checkpoint `ucf-tahap-7` intact) · **Head saat audit:** `4a4b0e0` (`ucf-tahap-8` LIVE) — branch baru `ucf-image-to-3d-fix`

---

## 1. Penyebab PNG/JPG ditolak tombol Impor

- `src/importer.js:94` — `detectFormat()` hanya menerima `['glb','gltf','vrm','fbx']` (lihat `src/format.js:8`). Ekstensi `.png/.jpg/.jpeg` → `detectFormat()` return `null` → `importModelFile()` throw `ImportError` `Format berkas tidak didukung: ... .glb, .gltf, .vrm, .fbx`.
- `index.html:39` — `<input id=\"modelFile\" accept=\".glb,.gltf,model/gltf-binary,model/gltf+json\" multiple>` — browser memfilter file picker, tidak menampilkan gambar.
- `src/main.js:571-696` — `handleFiles()` → `importOne()` → hanya `importModelFile()`, tidak ada cabang untuk gambar. Drag-drop `dropzone` juga hanya memanggil `handleFiles()`.
- **Kesimpulan:** bukan bug, melainkan desain Tahap 1-7 memang hanya model 3D. Tidak ada pipeline gambar-to-3D.

## 2. Apakah mesin generasi gambar-ke-3D sudah tersedia?

Pencarian di repo:

```
find src -type f | xargs grep -l \"image.*3D\\|Tripo\\|TRELLIS\\|Hunyuan\\|Shap\" → 0 hasil
src/importer.js, src/format.js, src/main.js, src/humanoid/*, src/anim/*, src/modular/* → tidak ada referensi image-to-3D
package.json dependencies: hanya `three@0.180.0` — tidak ada `torch`, `onnxruntime`, `transformers`, `diffusers`
```

- **Humanoid prosedural (`src/humanoid/builder.js` + `rig.js`)** bukan rekonstruksi gambar: ia membangun mesh dari 35 parameter slider (tinggi, kepala, torso, lengan, dll) — geometri dihasilkan secara prosedural, tidak membaca pixel. Meski mirip target T-pose di dataset, ia **mengabaikan gambar input**.
- **Impor GLB (`src/importer.js`)** bukan image-to-3D: ia hanya mem-parse berkas biner glTF yang sudah jadi.
- **Jawaban:** ❌ Tidak ada mesin image-to-3D. Klaim bahwa UCF sudah bisa dari gambar adalah salah.

## 3. Evaluasi mesin open-source (Langkah 2 ringkas — detail di laporan akhir)

| Mesin | Lisensi | Output | VRAM butuh | Ukuran model | Dependensi | Cocok untuk E2B sandbox (2 CPU, 1.9GB RAM, tanpa GPU/CUDA) |
|---|---|---|---|---|---|---|
| **TripoSR** (VAST/Stability, 2024) | **MIT** (code+weights) — komersial bebas | Mesh GLB/OBJ (<0.5s A100) | **~6 GB** VRAM, CPU fallback lambat | ~1 GB (HuggingFace `stabilityai/TripoSR`) | Python 3.8+, PyTorch + CUDA, `torchmcubes`, `xatlas` | ❌ Tidak: butuh 6GB VRAM + CUDA, PyTorch tidak ada, RAM 1.9GB tidak cukup, model 1GB > disk cache |
| **TRELLIS.2** (Microsoft, 2025) | **MIT** (core) — note `nvdiffrast/nvdiffrec` non-komersial | PBR GLB 1536³ | **≥24 GB** VRAM (A100/H100, Linux+CUDA 12.4) | ~16 GB weights (5×DiT 1.3B) | Conda, flash-attn, spconv, CUDA toolkit | ❌ Tidak: butuh 24GB VRAM, Linux-only, build CUDA gagal |
| **Hunyuan3D-2.0/2.1** (Tencent) | **Community License** — bukan MIT: cap 1M MAU, **kecualikan EU/UK/Korea** [web_search:13] | PBR GLB (2 stage: shape+texture) | 6GB shape-only, **16GB full**, 29GB v2.1 full | ~10 GB (shape) + texture | PyTorch CUDA, custom rasterizer (C++ build) | ❌ Tidak: VRAM + lisensi teritorial tidak cocok untuk publik EU |
| **Shap-E / Zero123 / One-2-3-45** | MIT/Apache | NeRF→mesh | 8-12 GB VRAM | 2-5 GB | PyTorch, diffusers | ❌ Tidak: sama, butuh GPU |
| **Ekstrusi siluet lokal (klasik)** | MIT (kode UCF sendiri) | **Extruded mesh 3D asli** (bukan plane teksur) dari mask alpha/luminance | **0 VRAM**, CPU saja, <50MB RAM, <100ms | 0 (tanpa model ML) | Hanya `three.js` + Canvas 2D | ✅ **Ya — jalan di browser sandbox**; bukan neural, tapi geometri 3D nyata yang dapat diputar, diekspor GLB, dan dirigging |

**Keputusan (Langkah 2):** Tidak memasang model besar di lingkungan ini (akan OOM dan gagal build). Dipilih **dua jalur** yang jujur:

1. **Lokal cepat — Silhouette Extrude (default):** baca PNG/JPG → mask → kontur → `THREE.ExtrudeGeometry` → mesh solid setebal 20-30% tinggi, bertekstur dari gambar asli. Hasil adalah **geometri 3D bervolume** (front + back + sisi), dapat di-orbit, di-raycast, diekspor GLB, dan (terbatas) di-rigging. Keterbatasan didokumentasikan: bukan rekonstruksi neural, punggung datar, tidak ada detail 360°.
2. **Neural asli — Remote GPU (opsional, tidak wajib):** stub `remoteEngine` yang memanggil HF Space / Replicate untuk TripoSR/TRELLIS bila user sediakan URL & token. Tanpa server, UI menampilkan status `NOT_AVAILABLE` dengan instruksi, bukan klaim palsu. Menghindari API berbayar sebagai ketergantungan wajib.

Alasan: memenuhi “tanpa API berbayar wajib” dan “jangan pasang model besar sebelum periksa kapasitas”.

## 4. Yang dipertahankan

- `ucf-tahap-7` (`3efa5d6`) tidak dihapus; tag `ucf-tahap-1`..`ucf-tahap-8` tetap.
- `humanoid`, `modular`, `anim`, `export`, `rigPro A.0` tidak diubah tanpa alasan.
- Tes regresi S1-S7 tetap harus lulus.

## 5. Rencana implementasi (Langkah 3)

- Pisahkan impor: `dropzone` (model 3D) tetap `.glb/.gltf/.fbx/.vrm` — tambah `dropzoneImage` (`accept .png,.jpg,.jpeg`) + `imageFile` input terpisah.
- Modul baru `src/imageTo3D/` (`imageLoader.js`, `silhouetteMesh.js`, `engine.js`, `rigAdapter.js`) — semua ES module, tanpa dependensi baru selain `three`.
- Hasil mesh masuk `viewport.addModel()` sebagai model biasa → bisa di-pick, di-fit, di-espor GLB, di-rigging.
- Uji 8 poin Langkah 4 dengan gambar dataset nyata (crop “STYLIZED FEMALE ADVENTURER” front).

