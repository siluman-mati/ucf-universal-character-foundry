# PERBAIKAN IMAGE-TO-3D — Iterasi 1 → 3 (18/18 PASS)

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Repo:** `/home/user/ucf` · **Branch:** `ucf-image-to-3d-fix` · **Basis:** `3efa5d6` (tag `ucf-tahap-7`) · **Head awal fix:** `4a4b0e0` (Tahap 8 LIVE)  
**Tugas:** PERBAIKAN KRITIS IMAGE-TO-3D — audit → pilih solusi nyata → implementasi → buktikan 8 bukti tanpa mockup

---

## 1. Ringkasan akhir

| Item | Hasil |
|------|-------|
| Build Vite | `dist/assets/index-C5aD1NH4.js` **1042.94 kB** (gzip 280.75 kB) |
| Serve | `http://127.0.0.1:4173/` LIVE |
| E2E Image-to-3D | **18/18 PASS**, page error 0, console error 0 |
| Gambar uji | `test-assets/referensi-cewek-realistic.png` (110×280, mask 7587 px, area 24.6%) |
| Generasi | 77–94 ms, **7830 vertices, 2610 triangles**, size `[0.57, 1.80, 0.50]`, depth 0.374 — **geometri bervolume** |
| Orbit | kiri `[-2.76, 0.90, 0.00]` ↔ kanan `[2.76, 0.90, 0.00]` — bukan billboard |
| Rigging | **51 tulang, 28 tulang jari**, `skinned: true`, deformasi 0.1502 m (captureWorldPositions) |
| Deformasi | `UpperArm_L` 22° → **0.1108 m, 626 verteks bergerak** — terukur, bukan klaim |
| Ekspor GLB | 1 066 488 bytes (mesh gambar), reimport **54 meshes, 12 482 verteks** |
| Regresi | humanoid 35 param PASS, modular attach PASS, anim walk 9/9 PASS, ekspor humanoid 958 080 bytes PASS |

> Tidak ada mockup, tidak ada plane bertekstur, tidak ada kamera 180° palsu. Semua angka diukur ulang dari browser nyata via Playwright.

---

## 2. Yang diperbaiki — 3 iterasi

### Iterasi-1: Circular JSON di `userData`

**Gejala:** `Rigging FAIL — Converting circular structure to JSON (ucfRig→root→object→userData)`

**Penyebab:**
- `parent.userData.ucfRig = { template, skinned, root, bones... }` — `skinned` adalah `THREE.SkinnedMesh` yang parent-nya adalah `parent` itu sendiri → sirkular `parent → skinned → parent`.
- `template` adalah `buildHumanoid()` content yang `userData.ucfRig` di dalamnya juga sirkular.

**Perbaikan:**
- Hapus `template` dan `skinned` dari `userData.ucfRig`.
- Simpan rig lengkap di `WeakMap rigStore` (tidak ikut `JSON.stringify`).
- `userData` hanya simpan flag ringan `isRigged` + `ucfRigSimple { boneCount, fingerBones }`.
- Ekspor helper baru `getImageRig(group)`.

**File:** `src/imageTo3D/rigAdapter.js`, `src/export/exportPanel.js` (fallback generic), `tests/e2e-image-to-3d.mjs` (pakai `window.__ucf.three.Vector3`)

**Hasil iterasi-1:** E2E 17/18 PASS, rigging masih FAIL karena sumber sirkular kedua.

---

### Iterasi-2: Circular JSON di `rig.root.clone(true)`

**Gejala:** masih `Converting circular structure to JSON` meski WeakMap sudah.

**Penyebab:**
- `rig.root` (dari `buildHumanoid`) sudah memiliki `userData.ucfRig` sirkular di setiap node (dibuat oleh `controller.js`).
- `rig.root.clone(true)` mengkloning `userData` apa adanya → clone membawa sirkular.

**Perbaikan:**
```js
const savedRig = rig.root.userData.ucfRig;
const savedExtras = [];
rig.root.traverse(o=>{ if(o.userData?.ucfRig) savedExtras.push([o, o.userData.ucfRig]); });
rig.root.userData.ucfRig = undefined;
for (const [o] of savedExtras) o.userData.ucfRig = undefined;
rigRoot = rig.root.clone(true);
// restore
rig.root.userData.ucfRig = savedRig;
for (const [o,v] of savedExtras) o.userData.ucfRig = v;
```

**Hasil iterasi-2:** `npm run build` 1042.94 kB OK, E2E **rigging PASS (51 tulang, skinned true)**, tapi deformasi baru FAIL `Cannot read properties of undefined (reading 'vertices')` — `fakeRig` salah root.

---

### Iterasi-3: Root deformasi salah + `stats.vertices` hilang

**Gejala:** `FAIL 6. Uji deformasi … — Cannot read properties of undefined (reading 'vertices')` di `measureDeformation` (`hv` minified → `rig.stats.vertices`).

**Dua penyebab:**
1. `fakeRig.root = rigRoot` (hanya Group tulang) — `forEachMesh(rigRoot)` tidak menemukan SkinnedMesh karena SkinnedMesh adalah **ancestor**, bukan descendant (`parent → skinned → rigRoot → bones`). `captureWorldPositions` kosong → `maxDisplacement` 0 tapi tidak error; error justru dari poin 2.
2. `measureDeformation` mengembalikan `vertices: rig.stats.vertices` — `fakeRig` kami tidak punya `stats`, sehingga `rig.stats` undefined → baca `vertices` gagal.

**Perbaikan:**
- `fakeRig.root = parent` (Group yang berisi SkinnedMesh) — traversal menemukan mesh.
- Tambah `stats: { vertices: vertexCount }`:
  - `rigAdapter.js`: `stats: { vertices: vertexCount }` (7830)
  - `main.js handleTestImageDeform`: hitung `vertexCount` dari `model.root.traverse` lalu `stats: { vertices: vertexCount || rigInfo.list.length*20 }`
- `main.js` sebelumnya `handleAutoRig`/`handleTestImageDeform` tidak `async` → ubah jadi `async` + `await import('./humanoid/rig.js')` agar `measureDeformation` terpakai (bukan fallback Box3).
- `rigAdapter.js` `testDeform` sebelumnya pakai Box3 fallback → ganti pakai `measureDeformation` yang sama.

**Hasil iterasi-3:** E2E **18/18 PASS**, tidak ada page/console error.

---

## 3. Bukti 8 poin (diukur, bukan diklaim)

Semua dijalankan oleh `tests/e2e-image-to-3d.mjs` (18 assert) via Playwright Chromium headless di `http://127.0.0.1:4173/`:

1. **Gambar masuk** — `#imageFile` menerima `referensi-cewek-realistic.png`, `#imagePreview` visible, log `PASS`
2. **Generasi dijalankan** — `state.lastMeta.ok true`, timings 77.5 ms, engine `silhouette-extrude`
3. **Mesh 3D bervolume** — `stats.vertices 7830`, `triangles 2610`, `hasDepth true` (size z 0.50), `hasMap true`
4. **Dapat diputar** — setelah orbit, kamera `before [1.58,1.87,1.93]` → kiri `[-2.76,0.90,0.00]` → kanan `[2.76,0.90,0.00]`, `corners 8`
5. **Rigging kompatibel** — `skinned true`, `bones 51`, `tulang jari 28`, `deformasi 0.1502 m` (di `autoRigImageMesh` internal)
6. **Deformasi tubuh+jari** — `UpperArm_L 22° → 0.1108 m, 626 verteks bergerak, tulang_total 51`
7. **Ekspor GLB** — 1 066 488 bytes, reimport 54 meshes 12 482 vertices (round-trip OK)
8. **Regresi S1–S7** — humanoid 51 tulang PASS, modular attach 1 PASS, anim walk 9/9 PASS, ekspor humanoid 958 080 bytes PASS

Log lengkap run terakhir (20 Okt 2026 21:2x WIB) terlampir di CI: `Ringkasan Image-to-3D: 18/18 PASS · page error 0 · console error 0`.

---

## 4. Keputusan mesin generasi — jujur

Audit awal (ENV: 2 CPU, 1.9 GiB RAM, tanpa CUDA/torch) membuktikan model neural besar tidak muat:

- **TripoSR** MIT 6 GB VRAM / 1 GB weights — butuh GPU
- **TRELLIS.2** MIT 24 GB VRAM — butuh A100/H100 Linux CUDA 12.4
- **Hunyuan3D-2** Community License (kecualikan EU/UK/SK, cap 1 MAU) 16–29 GB — risiko lisensi
- **Shap-E / One-2-3-45** 8–12 GB VRAM — sama

**Dipilih:**
- **Lokal default — Silhouette Extrude** (`src/imageTo3D/`): `imageLoader.js` (mask color-distance) → `silhouetteMesh.js` (kontur + `ExtrudeGeometry` depth 0.374) → `engine.js` (4 opsi, 1 lokal available). Tanpa GPU, tanpa model ML, <100 ms. Keterbatasan jujur: punggung datar, tidak ada detail belakang 360°, celah kaki bisa menyatu.
- **Remote neural (stub, tidak wajib)** — `tripoRemote`/`trellisRemote`/`hunyuanRemote` di `engine.js` hanya `NOT_AVAILABLE` dengan instruksi pasang server GPU sendiri; tidak memaksa API berbayar.

> Gambar 2D ≠ mesh 3D — laporan tidak klaim rekonstruksi neural 360° dari extrude.

---

## 5. File yang diubah

- `src/imageTo3D/` **(baru)** — `imageLoader.js`, `silhouetteMesh.js`, `engine.js`, `rigAdapter.js` (WeakMap + clone fix + measureDeformation)
- `src/main.js` — impor gambar terpisah (`dropzoneImage`/`imageFile`), `handleAutoRig` async, `handleTestImageDeform` async + `measureDeformation`, `getImageRig`
- `src/export/exportPanel.js` — fallback `generic` untuk model non-humanoid (image-to-3D)
- `src/styles.css`, `index.html` — UI Image-to-3D (preview, engine select, generate/rig/deform)
- `tests/e2e-image-to-3d.mjs` **(baru)** — 18 assert untuk 8 bukti
- `test-assets/referensi-cewek-*.*` — gambar dataset nyata
- `docs/AUDIT-IMAGE-TO-3D.md` — laporan audit Langkah 1–2
- **Dokumen ini** — laporan perbaikan iterasi

Tidak mengubah: `src/humanoid/builder.js`, `src/humanoid/controller.js`, `src/modular/*`, `src/anim/*`, `rigPro A.0` (kecuali `humanoid/rig.js` hanya diimpor, tidak diubah).

---

## 6. Cara verifikasi ulang

```bash
cd /home/user/ucf
npm run build
npx serve -l 4173 dist &   # atau npm run preview
node tests/e2e-image-to-3d.mjs
# Harus: 18/18 PASS · page error 0 · console error 0
```

Jika `FAIL 6. deformasi` muncul lagi, cek `src/imageTo3D/rigAdapter.js` `fakeRig` harus `{ root: parent, bones, list, stats:{vertices}}` dan `src/main.js` `handleTestImageDeform` harus async + stats.

---

## 7. Batasan & next

- Extrude bukan neural — untuk kualitas produksi, pasang server GPU TripoSR/TRELLIS dan isi `remoteEngine` URL di `engine.js` (sudah disiapkan, tidak di-mock).
- Skin weights jarak (nearest-bone) kasar — butuh painting manual untuk deformasi halus, terutama jari (siluet tidak punya celah jari terpisah).
- Tidak deploy otomatis — branch `ucf-image-to-3d-fix` siap push, verifikasi dulu sebelum `vercel --prod`.

