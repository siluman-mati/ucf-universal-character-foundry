# DEPLOY UCF TERPISAH DARI RIGPRO A.0 — LAPORAN FINAL

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Eksekutor:** siluman-mati (Agent Mode)  
**Repository:** `siluman-mati/ucf-universal-character-foundry` · **Branch:** `ucf-image-to-3d-fix` · **Commit:** `7a9a5ed097f646a4f65228e68ca977ba6cfb8406` (pesan: `fix(image-to-3d): iterasi-3 18/18 PASS — circular WeakMap, clone save/clear, root+stats deformasi`)  
**PR:** https://github.com/siluman-mati/ucf-universal-character-foundry/pull/new/ucf-image-to-3d-fix  

---

## A. Repository

- **URL:** https://github.com/siluman-mati/ucf-universal-character-foundry
- **Branch yang di-checkout:** `ucf-image-to-3d-fix` (HEAD = 7a9a5ed, verified via `git cat-file -p 7a9a5ed` dan `git rev-parse HEAD`)
- **Branch `master` tetap di:** `4a4b0e0` (tidak diubah)
- **Working tree sebelum build:** bersih kecuali `.vercel/` (untracked, tidak di-commit) — tidak ada perubahan belum di-commit yang ditimpa, tidak ada `reset --hard`
- **Dokumen dibaca:** `docs/AUDIT-IMAGE-TO-3D.md` dan `docs/PERBAIKAN-IMAGE-TO-3D.md` (isi sesuai commit 7a9a5ed)
- **Framework:** Vite 8.3.3 + Three 0.180.0 (package.json `type: module`, `version: 1.1.0-stage8`)
- **Package manager:** npm (karena `package-lock.json` ada, lockfileVersion 3)
- **Build command:** `npm run build` → `vite build` (vercel.json: `buildCommand: npm run build`, `outputDirectory: dist`, `installCommand: npm install --legacy-peer-deps`, `framework: vite`)
- **Tidak menebak output:** `dist/` memang berisi `index.html` + `assets/` setelah build

---

## B. Build & Pengujian (hasil aktual, bukan klaim)

### Instalasi
```
npm install --legacy-peer-deps
→ added 200 packages, audited 201 packages in 4s, 3 high severity (tidak blocking)
```

### Unit test
```
npm test (node --test)
→ 63/63 PASS, 0 FAIL, duration 9.7s
```

### Production build
```
npm run build
→ transforming 50 modules, built in 545ms
  dist/index.html               18.81 kB │ gzip 4.81 kB
  dist/assets/index-wTFK4b-D.css 18.54 kB │ gzip 4.86 kB
  dist/assets/GLTFExporter-DGT2mfaQ.js 34.59 kB │ gzip 10.17 kB
  dist/assets/FBXLoader-Ct-IdGPG.js    47.38 kB │ gzip 15.74 kB
  dist/assets/index-CtD-piZC.js       1,044.14 kB │ gzip 281.18 kB
  (sebelumnya di serve lokal: index-C5aD1NH4.js 1042.94 kB gzip280.75 kB — selisih hash normal)
```

### Regresi S1–S7 (+S8)
```
node tests/e2e-stage1.mjs → 42/42 PASS · 0 error
node tests/e2e-stage2.mjs → 18/18 PASS · 0 error
node tests/e2e-stage3.mjs → 15/15 PASS · 0 error
node tests/e2e-stage4.mjs → 21/21 PASS · 0 error
node tests/e2e-stage5.mjs → 20 PASS 0 FAIL
node tests/e2e-stage6.mjs → 26/26 PASS · 0 error
node tests/e2e-stage7.mjs → 13/13 PASS · 0 error
node tests/e2e-stage8.mjs → 16/17 PASS · 0 error (1 NOT TESTED = Android fisik, sesuai aturan tidak diklaim)
```

### Image-to-3D E2E (lokal & production)
```
node tests/e2e-image-to-3d.mjs @ http://127.0.0.1:4173/ (serve lokal scripts/serve.mjs 4173)
→ 18/18 PASS · page error 0 · console error 0

UCF_URL=https://ucf-universal-character-foundry.vercel.app/ node tests/e2e-image-to-3d.mjs (production)
→ 18/18 PASS · page error 0 · console error 0
```
Tidak ada tes yang dimatikan, tidak ada hasil palsu. Production tidak di-deploy sebelum semua kritis PASS.

---

## C. Deployment Terpisah

- **Platform:** Vercel
- **Project baru khusus UCF (sudah ada, tidak dibuat ulang):**
  - ID: `prj_kR9OTsmBN1l4wPhmp0RmYGVYHojA`
  - Nama: `ucf-universal-character-foundry`
  - Team: `team_4Crq4DFnsMj6qWX04cAZUrdg` (JHK)
  - Framework: `vite`, Build: `npm run build`, Output: `dist`, Install: `npm install --legacy-peer-deps`, Node 24.x
  - Git provider: `createDeployments: disabled` (deploy manual via API, bukan auto-commit)
  - Tidak terhubung ke `rigpro-a0`, tidak mengubah project lain
- **Deployment production yang baru dibuat:**
  - ID: `dpl_CB7fxRu9kkWc8HjXFSGAv3cBUP7s`
  - Git source: `type: github, ref: ucf-image-to-3d-fix, repoId: 1426615554, sha: 7a9a5ed097f646a4f65228e68ca977ba6cfb8406`
  - Target: `production`, Status: `READY` → `PROMOTED`
  - Build start: `1792483788933`, Ready: `1792483796099`, Duration: `7166 ms`
  - Inspector: https://vercel.com/jhk14/ucf-universal-character-foundry/CB7fxRu9kkWc8HjXFSGAv3cBUP7s
- **URL production aktual (bukan karangan):**
  - https://ucf-universal-character-foundry.vercel.app (alias utama)
  - https://ucf-universal-character-foundry-jhk14.vercel.app
  - https://ucf-universal-character-foundry-dz8avzugs-jhk14.vercel.app (deployment spesifik)
  - Branch alias: https://ucf-universal-character-foundry-git-ucf-image-to-3d-fix-jhk14.vercel.app
- **Waktu deploy:** 20 Okt 2026 08:10:07 GMT (header `last-modified` dan `readyAt`)
- **Verifikasi setelah deploy:**
  - `curl -I https://ucf-universal-character-foundry.vercel.app/` → 200, `content-type: text/html`, `etag` valid
  - HTML memuat `src="./assets/index-CtD-piZC.js"` (bukan localhost), `dist` benar
  - Playwright prod E2E 18/18 PASS, no page/console error, no failed requests
  - Mobile 390×844: `innerWidth 390 scrollWidth 390` (tidak overflow), canvas 390×758, tombol visible, viewer controls ready, refresh stage tetap 8, tidak ada `localhost`/`127.0.0.1` di HTML

---

## D. Fitur — yang diverifikasi, belum diuji, butuh backend/GPU

### Diperiksa terpisah (sesuai batasan 6A–6F)

**A. Image upload — ✅ VERIFIED**
- `input #imageFile accept .png,.jpg,.jpeg` terpisah dari `modelFile` GLB, `dropzoneImage` ada, preview `imagePreview` visible setelah pilih `referensi-cewek-realistic.png` (110×280), log `PASS`, tidak ditolak sebagai GLB.

**B. Rekonstruksi image-to-3D — ⚠️ Jujur: lokal extrude, bukan neural**
- Engine lokal: **Silhouette Extrude** (CPU-only, 0 VRAM, <100 ms) — baca PNG/JPG → mask color-distance (area 24.6%, 7587 px) → kontur 218 points → `THREE.ExtrudeGeometry` depth 0.374 → mesh bervolume. **Bukan** TripoSR/TRELLIS/Hunyuan3D neural 360°.
- Engine neural: `tripoRemote`/`trellisRemote`/`hunyuanRemote` status `NOT_AVAILABLE` dengan note: `Butuh server dengan TripoSR 6GB VRAM… belum terpasang`. Tidak ada simulasi palsu, tidak ada klaim rekonstruksi neural berhasil.
- Deployment frontend **tidak** otomatis menyediakan GPU/model inference/backend image-to-3D. Jika kualitas produksi (punggung detail, 360°) dibutuhkan, perlu backend terpisah (lihat Kendala).

**C. Mesh generation — ✅ VERIFIED**
- `meshInfo: vertices 7830, triangles 2610, size [0.57,1.80,0.50], is3D true, depth 0.374, worldW 0.493, worldH 1.7`, bukan plane bertekstur (hasDepth true, hasMap true), timings 74–106 ms.

**D. Viewer & rotasi 3D — ✅ VERIFIED**
- Viewport aktif 5 helpers, orbit manual: `before [1.58,1.87,1.93]` → `kiri [-2.76,0.90,0.00]` → `kanan [2.76,0.90,0.00]` (bukan billboard), `corners 8`, `controls` ada, zoom/rotate via OrbitControls berfungsi di mobile.

**E. Ekspor & impor ulang GLB — ✅ VERIFIED**
- Ekspor mesh gambar: `1066488 bytes` (`ImageTo3D_referensi-cewek-realistic.glb`), reimport: `54 meshes, 12482 vertices` (round-trip OK). Humanoid ekspor: `958080 bytes`.

**F. Rigging & animasi yang sudah ada — ✅ VERIFIED (terbatas pada yang sudah tersedia)**
- Rigging: `51 tulang, 28 tulang jari, skinned true`, skin weights jarak (nearest bone) kasar → deformasi terukur `UpperArm_L 22° → 0.1108 m, 626 verteks bergerak` (captureWorldPositions, bukan Box3). Internal rigging test 0.1502 m.
- Animasi: humanoid 35 param masih berfungsi, modular attach OK, anim native walk `9/9 PASS`, `anim` controller tersedia.
- Tidak diklaim: auto-rig universal sempurna, topology produksi, simulasi kain. Finger detail terbatas karena siluet tidak punya celah jari terpisah.

### Belum diuji di perangkat fisik
- Android fisik (WebGL/interaksi di HP) → `NOT TESTED` di e2e-stage8, sesuai aturan tidak diklaim berhasil. Emulasi 390×844 Chromium desktop PASS.
- Sentuh multi-finger pinch-zoom di device nyata belum diuji (hanya kontrol OrbitControls via mouse/touch emulasi).

### Butuh backend/GPU untuk Neural
- TripoSR (1 GB, 6 GB VRAM), TRELLIS.2 (16 GB, 24 GB VRAM, Linux+CUDA), Hunyuan3D (6–29 GB, Community License EU/UK dikecualikan) — tidak ada di sandbox 1.9 GiB RAM, tidak ada CUDA. Frontend sudah siapkan stub `remoteEngine` untuk memanggil HF Space/Replicate bila user sediakan URL&token, tanpa memaksa API berbayar.

---

## E. Integritas — UCF terpisah dari rigPro

- **UCF:** `prj_kR9OTsmBN1l4wPhmp0RmYGVYHojA` → `siluman-mati/ucf-universal-character-foundry`, branch `ucf-image-to-3d-fix`, `https://ucf-universal-character-foundry.vercel.app`
- **RigPro A.0:** `prj_dIMAc2Ef0z8ksJgjXqf8Nw8ix4me` → `siluman-mati/rigpro-a0`, branch `main`, `https://rig52-studio.vercel.app`
- **Tidak ada penggabungan repo:** perubahan UCF tidak disalin ke `rigpro-a0`, tidak ada commit di `rigpro-a0` sejak `1072f82e docs(r82)` (readyAt 1792398369753). Deployment rigPro tetap `dpl_EJqqs6qNF4ZD7tZqqb9PKoq6Ncgw`, status READY, tidak berubah.
- **Tidak mengubah domain/env/build rigPro:** project UCF hanya memakai `buildCommand npm run build` + `outputDirectory dist` miliknya sendiri; rigPro env `VERCEL_PREVIEW_FEEDBACK_ENABLED` tidak tersentuh.
- **Tidak membangun ulang UCF dari awal:** basis `3efa5d6` (tag ucf-tahap-7) intact, hanya tambah `src/imageTo3D/` + fix 3 iterasi (total 16 files changed, 1616 insertions).
- **Daftar perubahan di UCF (commit 7a9a5ed):**
  - Baru: `src/imageTo3D/engine.js`, `imageLoader.js`, `silhouetteMesh.js`, `rigAdapter.js` (WeakMap+clone fix+measureDeformation)
  - Ubah: `src/main.js` (handleAutoRig/handleTestImageDeform async), `src/export/exportPanel.js` (generic fallback), `index.html`+`styles.css` (UI Image-to-3D), `scripts/prepare-test-assets.sh`, `package-lock.json`
  - Test: `tests/e2e-image-to-3d.mjs` (18 assert), `test-assets/referensi-cewek-*`
  - Docs: `docs/AUDIT-IMAGE-TO-3D.md`, `docs/PERBAIKAN-IMAGE-TO-3D.md`, dokumen ini
  - Tidak diubah: `src/humanoid/builder.js`, `controller.js`, `modular/*`, `anim/*`, `rigPro A.0`

---

## F. Kendala & Langkah Manual

- **Error tersisa:** Tidak ada error kritis. Build & semua tes PASS; production no page/console error, no failed requests.
- **Batasan produksi:**
  - Silhouette extrude → punggung datar, tidak ada detail belakang 360°, kaki bisa menyatu bila siluet tanpa celah. Untuk kualitas produksi, butuh backend GPU.
  - Skin weights jarak kasar, jari siluet terbatas.
  - HTML `<title>` masih `Tahap 7` (kosmetik), stage JS sudah `8` — tidak mengganggu fungsi.
- **Izin/credential:**
  - Push GitHub memakai PAT yang sempat terekspos di chat (admin-scoped). **Harus dirotasi segera** di GitHub Settings → Developer settings → Tokens — ganti dengan token baru, revoke yang lama. Laporan ini tidak menampilkan token.
  - Vercel deploy memakai kredensial terhubung via connector (team jhk14) — tidak ada secret yang ditampilkan di log.
  - Project UCF `createDeployments: disabled` → deploy manual via API (yang sudah dilakukan) diperlukan tiap push branch baru, bukan auto-deploy.
- **Langkah manual (jika tanpa izin deploy):**
  1. Verifikasi `git fetch && git rev-parse 7a9a5ed` ada.
  2. `npm install --legacy-peer-deps && npm run build` (harus 1044 kB).
  3. Jalankan `node tests/e2e-image-to-3d.mjs` dan `npm test` (harus PASS).
  4. Di Vercel Dashboard → project `ucf-universal-character-foundry` → Deployments → Redeploy dengan source `ucf-image-to-3d-fix` → target Production.
  5. Verifikasi URL `https://ucf-universal-character-foundry.vercel.app` (cek `curl -I`, Playwright E2E).
- **Jangan membuat layanan berbayar tanpa izin:** jika ingin neural backend, siapkan server GPU sendiri (TripoSR/TRELLIS di Hugging Face Space atau Replicate) lalu isi `remoteEngine` di `src/imageTo3D/engine.js` — tidak ada biaya otomatis.

---

**Bukti URL (bukan karangan, dapat dibuka sekarang):**
- UCF Production: https://ucf-universal-character-foundry.vercel.app
- Deployment: https://ucf-universal-character-foundry-dz8avzugs-jhk14.vercel.app (dpl_CB7fxRu9kkWc8HjXFSGAv3cBUP7s)
- Inspector: https://vercel.com/jhk14/ucf-universal-character-foundry/CB7fxRu9kkWc8HjXFSGAv3cBUP7s
- RigPro (tidak berubah): https://rig52-studio.vercel.app
- Repo UCF: https://github.com/siluman-mati/ucf-universal-character-foundry/tree/ucf-image-to-3d-fix (commit 7a9a5ed)
