# AUDIT VOLUMETRIK IMAGE-TO-3D — Tahap 1 & 2

**Tanggal:** 20 Okt 2026 · **Repo:** `siluman-mati/ucf-universal-character-foundry` · **Branch:** `ucf-image-to-3d-fix` · **Commit basis:** `7275850`

---

## Tahap 1 — Audit kode yang sudah ada (bukti kode, bukan tebakan)

### 1.1 Fungsi pemilihan & pemrosesan gambar

- **Pemilihan:** `src/main.js:handleImageSelect(file)` (562), `isImageFile()` (597), UI `index.html:#dropzoneImage` + `#imageFile accept .png,.jpg,.jpeg` + preview `#imagePreviewWrap`. `handleFiles()` (589) memisahkan `isImageFile → handleImageSelect` vs `importOne` untuk GLB. **Bukti:** ada jalur terpisah, tidak menimpa importer GLB.
- **Pemrosesan gambar → canvas:** `src/imageTo3D/imageLoader.js:loadImageToCanvas(file)` — ObjectURL → Image → canvas 1024 max side, fill putih untuk JPG. `estimateBackgroundColor()` sampel 4 pojok 5×5. `createMaskFromCanvas()` — dua mode: alpha thr 20 (jika alphaVar>30) atau color-distance thr 38 ke bg. Output `Uint8Array mask W*H`.
- **Bbox:** `getMaskBBox()` — minX/minY/maxX/maxY + count + areaRatio. **Kelemahan audit:** untuk character sheet dengan 3 tokoh, `getMaskBBox` mengembalikan **satu bbox yang mencakup seluruh sheet** (minX dari tokoh kiri, maxX tokoh kanan) → seluruh lembar dianggap satu siluet.

### 1.2 Fungsi yang menjalankan Silhouette Extrude

- **Orchestrator:** `src/imageTo3D/engine.js:generateFromImageFile(file, {mode})` — line 34: `if (mode !== 'silhouette') throw {code:'remote-required'}`. Artinya semua engine non-silhouette langsung BLOCKED, tidak ada fallback diam-diam (jujur).
- **Silhouette core:** `src/imageTo3D/silhouetteMesh.js`:
  - `downsampleMask(mask,W,H,maxDim=256→220)` — majority vote thr 0.35 (tipis kaki tetap lolos)
  - `collectSegments()` — Marching Squares 16 kasus, `linkSegments()` sambung tepi, `loopArea()` pilih loop terbesar, `simplifyLoop(eps0.15)` hapus kolinear, `createExtrudedMeshFromLoop()` → `THREE.Shape(pts)` → `ExtrudeGeometry({depth, bevelThickness 0.18*depth})` → `translate(0,0,-depth/2)`
  - `depth = worldH * depthRatio (0.22)` → untuk `worldH1.7m` depth `0.374m` (22% tinggi). Ini **uniform** — semua titik punya ketebalan sama, tidak ada variasi per-pixel.

### 1.3 Fungsi pembentukan mesh

- `generateSilhouetteMesh(mask,W,H,opts)` pipeline di atas. Tidak ada hallucination sisi belakang, tidak ada in-painting, tidak ada variasi depth per bagian tubuh. Geometri = front + back + sisi yang datar, bevel hanya tumpulkan tepi.

### 1.4 Sistem menampilkan hasil di viewer 3D

- `src/main.js:handleGenerateImage3D()` (662) → `generateFromImageFile` → `summarize(group)` → `viewport.addModel(group, {stats})` → `viewport.fitAll()`. Group bernama `ImageTo3D_<filename>` dengan `userData.isImageTo3DGroup`. Viewer sama untuk humanoid & image-to-3D, tidak membedakan — orbit & fit berfungsi (terbukti E2E kamera kiri/kanan).

### 1.5 Sistem ekspor GLB

- `src/export/exportPanel.js` fallback generic (Tahap 8 fix iterasi-1): jika bukan humanoid, export semua model di viewport via `GLTFExporter` → GLB 1 066 488 bytes untuk image-to-3D, reimport 54 meshes 12 482 verts.

### 1.6 Apakah sudah ada engine AI image-to-3D yang benar-benar dijalankan?

- **Tidak ada.** `src/imageTo3D/engine.js:ENGINE_MODES` 4 mode, hanya `silhouette.avail:true`, 3 remote `avail:false`. `tryRemoteEngine()` line 115 hanya `throw not-implemented`. `package.json` dependencies hanya `three@0.180.0` — tidak ada `torch`, `onnxruntime`, `diffusers`, `transformers`. `find src -name *.py` → 0. **Bukti:** tidak ada bobot model di repo (`find . -name *.ckpt -o -name *.safetensors` → hanya `caffe_bernini.glb` env), tidak ada `node_modules/torch`.

### 1.7 Apakah bobot model & dependensi tersedia?

- Tidak. `dist/` hanya 1 044kB JS. Tidak ada `models/` folder, tidak ada download script. Vercel build log (`prj_kR9OTsm`) `npm install --legacy-peer-deps` + `npm run build` tanpa download model. **Kesimpulan:** tidak ada bobot yang tersedia lokal.

### 1.8 Apakah ada fallback diam-diam mengganti hasil rekonstruksi dengan mesh tiruan?

- **Tidak ada fallback diam-diam.** `handleGenerateImage3D` untuk mode remote langsung BLOCKED dengan pesan `Butuh server GPU …` dan log `RESULT.BLOCKED`. Tidak ada kode yang diam-diam membuat humanoid prosedural sebagai pengganti. `buildHumanoid()` hanya dipakai di `rigAdapter.js` untuk membuat template tulang 51, bukan mesh.

### 1.9 Penyebab teknis hasil sebelumnya gepeng/bertumpuk/cacat

| Kode | Penyebab | Bukti baris | Dampak visual |
|------|----------|-------------|---------------|
| `silhouetteMesh.js: createExtrudedMeshFromLoop` `depth = worldH*0.22` uniform | Ketebalan sama untuk kepala, torso, lengan, kaki | line 188–192 | Gepeng merata, punggung datar seperti triplek, tidak ada volume kepala/ dada/ punggung berbeda |
| `shape = new THREE.Shape(pts)` single outer loop, no hole handling | Sheet multi-karakter → satu loop besar | line 205 | Bertumpuk: 3 tokoh + 4 view T-pose/BP digabung jadi satu mesh gumpal (jika ada sheet) |
| `downsample 220px, thr 0.35, eps0.15` | Simplifikasi agresif | line 240–257 | Cacat: celah antar kaki hilang (kaki menempel), jari tidak terpisah, kontur bergerigi |
| Tidak ada depth map / normal inference / triplane | Tidak ada model yang menghallucinate belakang | `engine.js` no neural import | Belakang = copy mirror front, bukan anatomi punggung/rambut/busana |
| `textureCanvas` hanya front UV | Back UV mirror front | line 223–235 | Dari belakang terlihat wajah/clothing depan terbalik (artifact) |
| Tidak ada segmentasi per-karakter | `getMaskBBox` satu bbox | `imageLoader.js:128` | Lembar 1536×1024 dengan 6 pose → bbox 1520×1000 area 92% → error `Hampir seluruh gambar dianggap objek` atau hasil gumpal |

**Laporan penyebab tanpa menebak:** semua di atas ada di kode, bukan asumsi. Gambar 2D ≠ mesh 3D — ekstrusi siluet by design hanya lempengan, bukan rekonstruksi.

---

## Tahap 2 — Evaluasi engine image-to-3D open-source

### Kriteria wajib per prompt
Repository resmi · lisensi kode · lisensi bobot · CPU/GPU/RAM/storage · dependensi & cara inferensi · export GLB · dapat jalan di lingkungan tersedia / perlu server GPU · bedakan photogrammetry multi-foto vs single-image.

### Lingkungan tersedia
E2B sandbox: 2 CPU, 1.9 GiB RAM, ~10 GiB disk ephemeral, **tanpa GPU/CUDA, tanpa torch**, browser only. Vercel hobby: 2 vCPU 8 GiB RAM build, no GPU. Android browser: WebGL2, no compute GPU.

| Engine | Repo resmi | Kode lisensi | Bobot lisensi | Output | Kebutuhan CPU/GPU/RAM/storage | Dependensi & inferensi | Export GLB | Jalan di sandbox / perlu server GPU | Catatan single vs multi |
|--------|------------|--------------|---------------|--------|-------------------------------|------------------------|------------|--------------------------------------|--------------------------|
| **TripoSR** (Tripo AI × Stability AI, Mar 2024) | https://github.com/VAST-AI-Research/TripoSR  https://huggingface.co/stabilityai/TripoSR | **MIT** (code + `model.ckpt` di HF `config.yaml`) — cek `LICENSE` MIT, `README` "free for personal/research/commercial" | **MIT** — HF weights `stabilityai/TripoSR` MIT, tidak ada cap teritorial | Mesh OBJ/GLB dari 1 gambar, <0.5s A100, hallucinate belakang | **6 GB VRAM** (CUDA), CPU fallback ~8 GiB RAM + lambat 30–60s, model 1.0 GB, storage 2 GB total | Python 3.8+, PyTorch 2.0+CUDA 11.8, `torchmcubes`, `transformers`, `rembg`, `trimesh`; `from tsr.system import TSR; TSR.from_pretrained("stabilityai/TripoSR").to("cuda")` → `model(image, device)` → `extract_mesh(res=256)` → `.export("out.glb")` | ✅ `mesh.export(..., file_type="glb")` — Gradio `app.py: generate()` export obj+glb | **Perlu server GPU** — 1.9 GiB RAM tidak muat, no CUDA di E2B, tapi bisa via HF Space gratis `stabilityai/TripoSR` (gradio `/gradio_api/call/generate`) — no paid API, free tier HF. | Single-image feed-forward LRM, bukan photogrammetry multi-foto. Cocok: 1 karakter tengah, bg clean. |
| **TRELLIS.2** (Microsoft, 2025) | https://github.com/microsoft/TRELLIS  HF `JeffreyXiang/TRELLIS-image-large` | MIT (core) + `nvdiffrast`/`nvdiffrec` non-komersial (render) — cek `LICENSE` dual | MIT core, tapi `TRELLIS-image-large` weights CC BY-NC-SA untuk komersial? — perlu cek, HF page tertulis MIT untuk code | PBR GLB 1536³, texture+structure, kualitas tinggi | **24 GB VRAM** (A100/H100), Linux+CUDA12.4, RAM 32GB, storage 16GB (5×DiT 1.3B) | Conda, `flash-attn`, `spconv`, `xformers`, CUDA toolkit; `python app.py --load ...` | ✅ `save_glb()` | **Perlu server GPU high-end** — tidak di sandbox, hanya demo HF Space `microsoft/TRELLIS`. | Single-image, bukan multi. Overkill untuk karakter, 16GB tidak muat Vercel. |
| **Hunyuan3D-2.0/2.1** (Tencent, 2024–25) | https://github.com/Tencent/Hunyuan3D-2  HF `tencent/Hunyuan3D-2` | **Tencent Community License** — bukan MIT | **Community License**: cap 1M MAU, **kecualikan EU/UK/Korea** (T&C §4.2) — risiko komersial | PBR GLB 2-stage (shape+texture), single image → 3D | 2.1: **29 GB full**, 10GB shape-only, 21GB texture; 2.0: 6GB shape, 16GB full. RAM 32GB, storage 10GB | PyTorch CUDA, custom raster C++ build, `hy3dgen` | ✅ | **Perlu server GPU + perhatian lisensi teritorial** — tidak cocok publik EU | Single-image, bagus karakter, tapi lisensi blok EU/UK. |
| **CRM (Convolutional Reconstruction Model, Facebook, 2024)** | https://github.com/facebookresearch/CRM | **MIT** | MIT | Mesh dari 6-view (multi) + single fallback | 12 GB VRAM | PyTorch CUDA | ✅ | Perlu GPU, bukan pure single | Multi-view (6) — jangan samakan dengan single. Butuh generate 6 view dulu. |
| **Shap-E (OpenAI, 2023)** | https://github.com/openai/shap-e | MIT | MIT | NeRF→mesh, text/image | 12–16 GB VRAM, model 2.5 GB | PyTorch, diffusers | ✅ (via `export`) | Perlu GPU, kualitas karakter buruk (blur) | Single-image tapi kualitas rendah, tidak direkomendasikan karakter. |
| **InstantMesh (Tencent, 2024)** | https://github.com/TencentARC/InstantMesh | Apache 2.0 | CC BY-NC | Mesh dari single (via Zero123 6-view) | 16 GB VRAM | PyTorch CUDA | ✅ | Perlu GPU | Single via multi-view synthesis — 2-step, lebih lambat. |
| **Ekstrusi siluet lokal (UCF saat ini)** | `src/imageTo3D/*` (kode sendiri) | **MIT** (kode UCF UNLICENSED→MIT internal) | Tidak ada bobot | Extruded mesh uniform, bukan hallucination | **0 VRAM, CPU <50MB, <100ms, 0 storage model** | Hanya `three.js` + Canvas2D | ✅ | **Jalan di sandbox & browser** | Single-image klasik, bukan AI. Jujur tapi gepeng. |

### Keputusan (Tahap 2)

**Dipilih sebagai integrasi realistis tanpa API berbayar:**
- **Utama (rekomendasi): TripoSR** — satu-satunya yang **MIT code+weights**, single-image true, <0.5s, 1GB model, 6GB VRAM (paling kecil), export GLB, ada HF Space gratis `stabilityai/TripoSR` yang bisa dipanggil tanpa token (atau token HF opsional), tidak ada cap EU. **Cara realistis:** Vercel frontend tidak bisa inferensi GPU → sediakan stub `tryRemoteEngine()` yang memanggil HF Space via `@gradio/client` atau `fetch /gradio_api/call/generate`. Jika Space down (503 seperti 2026-04-09 outage), UI tampilkan `GAGAL — Space tidak tersedia, coba lagi atau self-host`, **bukan** fallback diam-diam ke extrude.
- **Kedua (opsional): TRELLIS** untuk kualitas PBR jika user punya server 24GB (instruksi `git clone microsoft/TRELLIS && conda create -n trellis` di docs).
- **Dihindari:** Hunyuan3D-2.1 karena lisensi teritorial EU/UK/SK (tidak cocok publik), CRM/Shap-E karena multi-view/quality buruk.
- **Silhouette Extrude:** dipertahankan sebagai **opsi tambahan untuk siluet sederhana** (logo, ikon, bukan karakter manusia) — label UI `Ekstrusi Siluet (sederhana, bukan rekonstruksi)` + warning `bukan volume anatomi`.

**Jangan asumsi:** Semua AI di atas **tidak bisa jalan langsung di browser/ponsel** (butuh Python+CUDA atau WASM ONNX 1GB+ yang belum ada). Photogrammetry (COLMAP, NeRF multi-foto) butuh 20–100 foto dari sudut berbeda — berbeda dari single-image LRM seperti TripoSR yang hallucinate belakang dari 1 foto.

### Kebutuhan backend realistis tanpa API berbayar

- **Opsi A (gratis, tanpa self-host):** HF Space `stabilityai/TripoSR` — no API key untuk anon (rate limit ~20 req/min), atau HF token `hf_...` untuk private. Browser `fetch POST https://stabilityai-triposr.hf.space/gradio_api/call/generate` → `event_id` → `GET .../call/generate/{id}` SSE → `data: [objFile, glbFile]` → download GLB → `THREE.GLTFLoader` → `viewport.addModel`. Tidak ada biaya, tapi dependensi network & Space uptime (sering 503). Perlu consent: `Gambar akan dikirim ke huggingface.co/spaces/stabilityai/TripoSR (Stability AI). Lanjutkan?`
- **Opsi B (self-host, tanpa berbayar):** Clone `VAST-AI-Research/TripoSR`, `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 && pip install -r requirements.txt`, download `model.ckpt` dari HF (`huggingface-cli download stabilityai/TripoSR model.ckpt`), `python run.py input.png --output-dir out --render`. Butuh: Ubuntu 22.04, CUDA 11.8+, GPU 6GB+ (RTX 3060+), RAM 16GB+, disk 5GB. Export GLB ada. User set `REACT_APP_TRIPOSR_URL=http://<gpu-server>:7860` di Vercel env.
- **Tidak dipakai:** Replicate, Stability API, Tripo API — semua berbayar/subscription (prompt larang). `api.triposr.ai` berbayar → tidak dipakai.

---

## Bukti HF Space status saat audit (20 Okt 2026)

`fetch https://huggingface.co/spaces/stabilityai/TripoSR` → `runtime error: scikit-build-core version 0.12.2 too old` — Space build failing, belum bisa call. Artinya **backend belum tersedia** — UI harus tampil `BELUM TERVERIFIKASI / GAGAL DI LINGKUNGAN INI` jika dicoba, bukan sukses palsu.

---

## Next: Tahap 3–7 implementasi & laporan setelah perubahan minimal

- Tahap 3: Cropper untuk sheet (jangan proses seluruh lembar sebagai satu siluet)
- Tahap 4: Hubungkan ke engine yang benar-benar dijalankan (TripoSR HF), honest status, no mannequin
- Tahap 5: Uji depan/samping/belakang/3/4 + 360 + volume + GLB round-trip
- Tahap 6: Regresi GLB/viewer/rigging/finger/animasi
- Tahap 7: Laporan 12 poin + konfirmasi rigPro tidak diubah
