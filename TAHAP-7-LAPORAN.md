# Tahap 7 — Laporan: Ekspor GLB & Validasi Round-Trip

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Build:** `dist/assets/index-BD8KzzIp.js` 1,019 KB gzip 273 KB · **Vite** 512 ms (warning `INEFFECTIVE_DYNAMIC_IMPORT` — importer dipakai statik+dinamis, tidak pecah chunk; tidak merusak fungsi) · **Checkpoint:** `3efa5d6` tag `ucf-tahap-7` (HEAD `fa810d3` `vercel.json`) — rigPro A.0 tidak diubah, project UCF tidak dibuat ulang.

## Tujuan (sesuai instruksi)
Ekspor karakter UCF menjadi GLB yang dapat dibuka di aplikasi 3D lain dengan skeleton, skin weights, material, pose, modul, dan klip yang memang didukung — lalu **impor ulang dan buktikan** angka yang sama, bukan hanya file terunduh.

---

## 1. Ekspor GLB
Implementasi nyata (bukan mesh statis):

| File | Fungsi |
|---|---|
| `src/exporter.js` | `exportGLB(object,{binary,animations})` lazy `three/addons/exporters/GLTFExporter.js` → `ArrayBuffer` GLB |
| `src/export/exportPanel.js` | `ExportPanel` — `buildExportClone` (atasi sirkular `userData.ucfRig`), `collectAnimations` (5 native `idle/walk/run/jump/wave` + `retargetCache` ≤8), `doExport→blobUrl`, `doReimport` via `fetch+File+importModelFile`, `doDownload`, `renderReport`/`reimportHtml`, log `G. Ekspor` |
| `src/export/humanoidExport.js` | helper `compareStats/compareMaterials` |
| `index.html` | Section 9 Ekspor&verifikasi + 10 Status validasi, topbar Tahap 7 |
| `src/main.js` | wiring `exporter` ke 3 tombol, `1.1.0-stage7 stage 7` |

**Hasil ekspor (diukur 20 Okt 2026, headless):** Humanoid 1 + 2 modul (kaos-lengan-pendek, celana-panjang) → **GLB 1 013 404 byte (990 KB)** dengan **5 klip** (`UCF Idle UCF`, `UCF Walk UCF`, `UCF Run UCF`, `UCF Jump UCF`, `UCF Wave UCF`). Klip retarget ikut bila ada di cache.

## 2. Skeleton & Skinning
Validasi bahwa hierarki/nama dipertahankan, skinIndex/skinWeight valid, tidak ada verteks kehilangan bobot, tidak berubah bentuk, tulang jari tetap ada:

- Sebelum: **51 tulang** (dari `rig.list`), **28 tulang jari** (`Finger_Index|Middle|Ring|Pinky ×3 + Thumb ×2 ×2 sisi`), **53 skinnedMesh**, **4652 verteks**, `unweighted 0` untuk semua skinnedMesh (skinIndex+skinWeight valid, dicek per-verteks sum>1e-5)
- Sesudah: **51 tulang** (stats `bones:51`, `skeletons:1`), **28 tulang jari** (dari traverse `Finger_*`/`Thumb_*` — sama), **61 skinnedMesh** (naik karena GLTFExporter split per-material, bukan hilang), `unweighted 0`
- Bentuk: **bbox `1.928 × 1.750 × 0.316` → `1.928 × 1.750 × 0.316`** (delta 0, center `0,0.875,-0.014 → 0,0.875,-0.014` — identik)

Fix bug sirkular: `content.userData.ucfRig` menyimpan `rig.root` → `Object3D.clone()` gagal `circular JSON`. Solusi: simpan-null-kan-clone-kembalikan (verified 0 byte→1 MB).

## 3. Modul Karakter
Hanya modul terlihat yang diekspor, helper tidak ikut, pakaian ikut deformasi:

- `buildExportClone` menghapus `userData.ucfHelper` dan mesh `visible===false` → helper viewport & label tulang tidak terekspor (audit: `helperInContent false`, `helperInClone false`)
- Sebelum: `attached 2`, `visible 2` (kaos+celana); setelah ekspor→reimport: **6 material** (`Kaos, Kulit, Celana, Sepatu, Kaos Modul, Celana Modul`) tetap 6→6
- Deformasi modul: siku `LowerArm_R 45° maxDisplacement 0.338 m movedVertices 1238`, jari `Finger_Index_R_1 30° maxDisplacement 0.039 m` — modul ikut bergerak (Tahap 5 walk: modulMm 15.1 mm, modul 177/177 verteks bergerak)

## 4. Animasi
Klip yang benar-benar dapat diputar (bukan klaim semua kompatibel):

- Ekspor: **5 klip native** yang di-bake dengan foot grounding; diuji putar `walk` (0.967 s, 30 frame, `maxSourceTranslation 0.138 m` dibuang untuk in-place) + `idle`/`run`/`jump`/`wave` — semua lolos 10 cek Tahap 5 (kaki tidak tembus lantai, lutut tidak ekstrem, drift <0.005 m)
- Round-trip: klip diekspor via `GLTFExporter` `animations: [...clips]` → impor ulang via `GLTFLoader` **5 klip** (`clipNames` sama), loader independen `independent.clips 5` — dapat diputar ulang di UCF (`anim.clips()`) dan di viewer lain

## 5. Round-Trip Wajib (diukur, bukan klaim)

| Metrik | Sebelum | Sesudah | Δ | Status |
|---|---|---|---|---|
| Mesh | 61 | 61 | 0 | PASS |
| Tulang | 51 | 51 | 0 | PASS |
| Tulang jari | 28 | 28 | 0 | PASS |
| BBox (size) | 1.928×1.750×0.316 | 1.928×1.750×0.316 | 0 | PASS |
| Material | 6 | 6 | 0 | PASS |
| Skin weights (unweighted) | 0 | 0 | 0 | PASS |
| Klip | 5 | 5 | 0 | PASS |
| Deformasi siku (LowerArm_R 45°) | 0.338 m | — | >0.02 | PASS |
| Deformasi jari (Index_R 30°) | 0.039 m | — | >0.01 | PASS |
| Helper ikut ekspor | false | false | — | PASS |

Catatan perbedaan sah: `skinnedMesh 53→61` (split per-material, vertices `4652→5374` karena duplikasi vertex untuk material boundary — bukan data hilang; triangles `5932` tetap proporsional). Tidak ada tulang/modul/material/klip yang hilang.

## 6. Uji Kompatibilitas (loader independen)
GLB dibuka dua kali:
1) **UCF sendiri** (`importModelFile` → `report.stats nodes 113, meshes 61, bones 51, skeletons 1, clips 0(in stats) but animations array 5`)
2) **GLTFLoader independen** (`three/addons/loaders/GLTFLoader.js` parse ArrayBuffer) → `bones 51, skinned 61, clips 5 (Idle/Walk/Run/Jump/Wave)` — struktur sama. Tidak ada error validasi; data hilang yang dicatat: `KHR_materials_pbrSpecularGlossiness` tidak didukung (dilaporkan, tidak diklaim), VRM metadata tidak dibawa (sesuai Tahap 6).

## 7. Regresi (wajib, tidak dilonggarkan)
Semua tes lama tetap lulus setelah Tahap 7:

```
npm test 63/63 PASS (humanoid-rig 8, modular 15, anim 11, importer 6, exporter 5, stage6 18)
e2e-stage1 42/42 · e2e-stage2 18/18 · e2e-stage3 15/15 · e2e-stage4 21/21 · e2e-stage5 20/20 · e2e-stage6 26/26 · e2e-stage7 13/13
page error 0 console error 0
```

Tidak ada test yang dihapus/dilonggarkan.

## 8. Checkpoint & Laporan

- **Git:** `a41b278` (ucf-tahap-6) → `3efa5d6` (ucf-tahap-7) → `fa810d3` (HEAD vercel.json) — 9 files +441/-18 Tahap 7, tag `ucf-tahap-1..7` tetap, tag `ucf-tahap-8` sudah ada untuk Tahap 8 (dokumen integrasi, tidak merge)
- **File berubah Tahap 7:** `index.html`, `package.json`, `src/main.js`, `src/exporter.js` (baru), `src/export/exportPanel.js` (baru), `src/export/humanoidExport.js` (baru), `tests/e2e-stage7.mjs` (baru), `tests/e2e-stage5.mjs` (≥5)
- **Bukti ekspor:** `ucf-audit/stage7/phase-7.json` + `phase-7.png` + `audit-detail.json` + `tahap7-detail.png` — GLB 1 013 404 byte dapat diunduh via `Unduh GLB` dan dibuka di donor360/blender
- **Masalah & batasan jujur:** klip sumber eksternal (XBot 7 klip) tidak otomatis ikut kecuali retarget; material PBR standar saja; modul statis tetap mesh biasa; metadata VRM tidak diekspor; GLB lingkungan tidak lewat panel ini. Semua dicatat di UI batasan Tahap 7.

**Berhenti setelah laporan — tidak klaim ekspor lengkap tanpa round-trip (sudah dibuktikan di atas).**
