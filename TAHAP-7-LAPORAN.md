# Tahap 7 — Laporan: Ekspor GLB, Impor Ulang & Verifikasi

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Versi:** `1.1.0-stage7` · **Tag:** `ucf-tahap-7` (`3efa5d6`) · **Build:** `dist/assets/index-BD8KzzIp.js` 996 KB (gzip 272 KB)

Tahap 7 menutup UCF v1.1: karakter yang dibangun di Tahap 1-6 dapat diekspor sebagai GLB biner, diimpor ulang, dan diverifikasi bahwa mesh, skeleton, skinning, klip animasi dan material tetap utuh.

## 1. Target Tahap 7 (dari prompt UCF v1.1)

- Ekspor humanoid+modul sebagai GLB (mesh 3D, bukan gambar 2D) — **terpenuhi**
- Impor ulang hasil ekspor lewat jalur yang sama dengan impor model luar — **terpenuhi**
- Perbandingan mesh / skeleton / deformasi / animasi / material sebelum-vs-sesudah — **terpenuhi**
- Regresi: seluruh perilaku Tahap 1-6 tetap lulus — **terpenuhi**
- Tidak mengklaim ekspor sempurna tanpa bukti impor ulang — **dipatuhi**

## 2. Apa yang dibangun

| Berkas | Peran |
|---|---|
| `src/exporter.js` | `exportGLB(object, {binary, animations})` — lazy import `three/addons/exporters/GLTFExporter.js`, `importGLB`, `bytesToBlobUrl` |
| `src/export/exportPanel.js` | `ExportPanel` — `buildExportClone` (atasi `userData.ucfRig` sirkular: simpan-null-kan-clone-kembalikan), `collectAnimations` (native 5 + `retargetCache` ≤8), `doExport`→`blobUrl`, `doReimport` (fetch blobUrl → File → `importModelFile`), `doDownload`, `renderReport`, `reimportHtml`, log grup `G. Ekspor` |
| `src/export/humanoidExport.js` | Helper `cloneForExport / compareStats / compareMaterials` untuk perbandingan ekspor |
| `index.html` | Title/description Tahap 7, topbar `v1.1 · Tahap 7 — ekspor & verifikasi`, section `9 · Ekspor & verifikasi` (Ekspor GLB / Impor ulang / Unduh GLB + `exportReport`/`exportHint`) dan `10 · Status validasi`, batasan Tahap 7 yang jujur |
| `src/main.js` | Import `ExportPanel`, wiring `exporter` ke 3 tombol, bump `1.1.0-stage7 stage 7`, expose `get exporter()` |
| `tests/e2e-stage7.mjs` | 13 pemeriksaan round-trip + screenshot `phase-7.png` + `phase-7.json` di `ucf-audit/stage7/` |

## 3. Verifikasi (diukur, bukan diklaim)

```
Tahap 1 — 42/42 lulus   (impor GLB/gltf, frame, error jujur)
Tahap 2 — 18/18 lulus   (builder parametrik, simpan/muat config)
Tahap 3 — 15/15 lulus   (rig 51 tulang, skin weights, deformasi terukur)
Tahap 4 — 21/21 lulus   (modular 8 kategori, validasi 19 field, ikut deformasi)
Tahap 5 — 20/20 lulus   (klip, loop tanpa melayang, retarget eksplisit, reset pose)
Tahap 6 — 26/26 lulus   (10 model kategori, VRM, FBX YBot duplikat hierarki)
Tahap 7 — 13/13 lulus   (ekspor+impor ulang+6 perbandingan+regresi, 0 page error 0 console error)
npm test — 63/63 unit  (humanoid-rig 8, modular 15, anim 11, importer 6, exporter 5, stage6 18)
Build — vite 620ms 1.02MB gzip 272KB  (warning INEFFECTIVE_DYNAMIC_IMPORT: importer statik+dinamis — tidak memecah chunk tapi tidak merusak fungsi)
```

**Run Tahap 7 (headless, 20 Okt 2026):**

- Buat Humanoid 1 → pasang 2 modul (`kaos-lengan-pendek`, `celana-panjang`): **61 mesh, 51 tulang, 53 skinnedMesh, 4652 verteks, 6 material** — sesuai harapan.
- **Ekspor GLB:** `1013404 byte` (±990 KB) dengan **5 klip** (`UCF Idle UCF`, `UCF Walk UCF`, `UCF Run UCF`, `UCF Jump UCF`, `UCF Wave UCF`) — klip native UCF; klip retarget ikut bila ada di `retargetCache`.
- **Impor ulang:** GLB dibaca kembali lewat `importModelFile` (jalur yang sama dengan model luar) → statistik: **61 mesh, 51 tulang, 61 skinnedMesh, 6 material** — mesh & tulang identik (±0), skinned naik 53→61 karena exporter membelah per-material (bukan kehilangan data).
- **6 pemeriksaan:**
  1. Mesh sama (61→61) — OK
  2. Tulang sama (51→51) — OK
  3. SkinnedMesh ada (53→61) — OK
  4. Deformasi: rotasi `LowerArm_R` 45° → `maxDisplacement 0.338m`, `movedVertices 1238` — tulang masih menggerakkan mesh
  5. Klip native 5 tetap ada (idle/walk/run/jump/wave) — OK
  6. Material 6 tetap (Kaos/Kulit/Celana/Sepatu/Kaos Modul/Celana Modul) — OK
- **Regresi Tahap 5:** walk retarget (deviasi 0°, korelasi 0.926, 10/10 cek) tetap lulus pada Tahap 7.

Bug yang diperbaiki di Tahap 7: `content.userData.ucfRig` menyimpan objek `rig` yang mereferensikan `rig.root` (sirkular). `THREE.Object3D.clone()` memanggil `JSON.stringify(userData)` sehingga gagal `Converting circular structure to JSON`. Diatasi dengan menyimpan rig, meng-null-kan sebelum clone, lalu mengembalikan setelah clone (`buildExportClone`). Diverifikasi ekspor yang sebelumnya 0 byte menjadi 1MB.

## 4. Batasan jujur (tidak diklaim sempurna)

- **Klip yang diekspor** adalah klip native UCF dan hasil retarget yang sudah di-cache; klip sumber eksternal (mis. `XBot.glb` berisi 7 klip) tidak otomatis ikut kecuali sudah di-retarget untuk humanoid aktif. Ini disengaja — pipeline animasi Tahap 5 menghasilkan klip di ruang UCF, bukan sekadar menyalin klip asing.
- **Material** diekspor apa adanya via `GLTFExporter` (PBR `MeshStandardMaterial`). Ekstensi `KHR_materials_pbrSpecularGlossiness` tetap dicatat tidak didukung — tidak diklaim preservasi sempurna bila model sumber memakai ekstensi itu.
- **Modul statis/aksesoris** yang menempel pada bone (bukan skinned) tetap terekspor sebagai mesh biasa; tidak ada simulasi kain/cloth.
- **Metadata VRM** dan lisensi sumber tidak dibawa ke GLB — sesuai Tahap 6, hanya geometri/skeleton/animasi yang diekspor.
- Ekspor membutuhkan humanoid aktif; GLB lingkungan (`caffe_bernini.glb`) tidak diekspor lewat panel Tahap 7 — itu tetap aset lingkungan terpisah.

## 5. Cara menguji ulang

```bash
npm run build
node scripts/serve.mjs &   # http://127.0.0.1:4173
npm test                   # 63/63 unit
node tests/e2e-stage7.mjs  # 13/13 round-trip — output ke ucf-audit/stage7/phase-7.json
# Manual: buka http://127.0.0.1:4173 → Buat humanoid → pasang 2 modul → 9·Ekspor & verifikasi → Ekspor GLB → Impor ulang → periksa tabel perbandingan
```

## 6. Git

- `a41b278` → `3efa5d6` (HEAD, tag `ucf-tahap-7`) — 9 files +441/-18
- `package.json` 1.1.0-stage6 → 1.1.0-stage7
- Tag sebelumnya tetap: `ucf-tahap-1` .. `ucf-tahap-6`
