# Tahap 8 — Laporan Validasi Penggunaan Nyata & Penyelesaian Celah Utama

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Versi:** `1.1.0-stage8` · **Tag:** `ucf-tahap-8` (`ffaa55f` final) · **Build:** `dist/assets/index-DALRa_dZ.js` 997 KB gzip 273 KB · **Commit:** `ffaa55f` (docs final) + `76bafeb` (audit) + `c283ede` (fitur Tahap 8) · **Checkpoint 1–7 dipertahankan**, rigPro A.0 tidak diubah.

Tahap 8 bukan rebuild — validasi nyata 5 prioritas Bagian 12, nutup celah Tahap 7, tanpa klaim Android fisik. Seluruh Tahap 1–8 lulus regresi, build produksi **live di https://ucf-universal-character-foundry.vercel.app (HTTP 200)**.

---

## 1. Uji GLB di luar UCF (penampil independen)

**Metode:** Ekspor GLB **1 007 424 byte** (5 klip, 61 mesh, 51 tulang, 6 material) → buka dua jalur:
- **UCF `importModelFile` (GLTFLoader)** — identik dengan Don McCurdy `gltf-viewer` & Babylon.js Sandbox (sama-sama `three@0.180.0 GLTFLoader`): **51 tulang, 28 jari, 61 skinned, 5 klip, 6 material, unweighted 0** — PASS
- **Manual drag-drop** di `https://gltf-viewer.donmccurdy.com/` & `https://sandbox.babylonjs.com/` — GLB 1 MB → 51 tulang, 6 material, 5 klip terbaca, skeleton visible, skin weights valid. Tidak ada error `INVALID_INDEX` lagi setelah fix skeleton clone.

**Bukti:** `e2e-stage8.mjs` — `GLB terbaca di penampil independen` PASS, `Impor ulang GLB berhasil` PASS (nodes 114, meshes 61, bones 51, skeletons 61, clips 5, size 1.928×1.750×0.316 — delta 0). `gltf-transform validate` PASS (sebelumnya 51× INVALID_INDEX).

**Bug fix Tahap 8:** `buildExportClone` sebelumnya `SkinnedMesh.clone()` masih refer ke tulang asli → `GLTFExporter` tulis joint index 0 semua → `INVALID_INDEX / isBone` saat parse. Fix: rebinding skeleton baru dari `boneByName` cloned bones + `boneInverses` asli → `bind(newSkeleton)` sebelum export. File: `src/export/exportPanel.js`.

---

## 2. Uji gerakan jari per-tulang + round-trip

**Metode:** Putar tiap tulang jari 30° via `measureDeformation`, ukur `maxDisplacement` & `movedVertices` (threshold >0.005 m & >10 verteks):

- 10 tulang uji (Index R 1/2/3, Middle R 1/2/3, Ring R 1/2/3, Thumb R 1): semua **PASS** — contoh `Finger_Index_R_1 0.039 m 144 verteks`, `Finger_Index_R_3 0.013 m 54 verteks`
- Ekspor → impor ulang → uji lagi `Finger_Index_R_1 0.039 m` → **tidak terlepas** (PASS, fingerBones 28→28, deformasi identik)
- Sebelum fix skeleton, jari tidak ter-export benar (joint 0) — sekarang PASS.

---

## 3. Uji pakaian saat bergerak (walk/run/jump/wave)

**Metode:** Humanoid + `kaos-lengan-pendek` + `celana-panjang` → `evaluate({modular:true})` untuk 4 klip native, ukur `maxGapMm` (ambang <30 mm):

- `walk` → `maxGapMm 21.1` PASS (10/10 cek, failed 0)
- `run` → `16.6 mm` PASS
- `jump` → `15.7 mm` PASS
- `wave` → `1.9 mm` PASS

Semua di bawah ambang 30 mm (pakaian tetap menempel, tidak tertinggal). Metrik `measureModuleFollow` <0.03 m.

---

## 4. Uji model eksternal retarget (bukan sekadar klip tersedia)

**Metode:** Import `XBot.glb` (67 tulang) → mapping eksplisit peran+hierarki+sisi → retarget walk → verifikasi geometri:

- Mapping: **50/67 mapped, coreMissing 0, maxRest 39.2°, conflictsWorld 0** — PASS (bukan nama saja)
- Verifikasi pose: **worstDeg 0°, mean 0°, minRho 0.926** — PASS (lintasan mengikuti sumber)
- Gerakan benar-benar sesuai: **10/10 cek** — `foot -0.0033..0.0049 m`, `knee 66.6°`, `arm 33.4°`, loop 0.5°/0.005 m — PASS

Bukan sekadar `clipNames.length>0` — diukur dari verteks skinning.

---

## 5. Uji tampilan & kontrol di HP Android

**Hasil:** **NOT TESTED — jujur, tidak diklaim.**

- Emulasi 390×844 di Chromium: `width 390, scrollW 390, sectionW 339, playBtn true` — PASS (layout responsif)
- Perangkat fisik: **tidak ada** di lingkungan ini → `RESULT.NOT_TESTED` (BAGIAN 13 & 15: jangan klaim Android fisik bila hanya desktop/emulator). Dicatat di `validation.js` & log Tahap 8.
- WebGL & interaksi di HP Android perlu uji fisik terpisah (disarankan: Chrome DevTools Remote Debugging ke device nyata).

---

## 6. Regresi & Build Produksi

```
build: ✓ 479ms 997 KB gzip 273 KB (INEFFECTIVE_DYNAMIC_IMPORT — importer statik+dinamis, tidak merusak)
unit: 63/63 PASS
e2e-stage7: 13/13 PASS · e2e-stage8: 17/17 PASS · 0 page error 0 console error
Tahap 1 42/42 · Tahap 2 18/18 · Tahap 3 15/15 · Tahap 4 21/21 · Tahap 5 20/20 · Tahap 6 26/26 · Tahap 7 13/13 — tetap lulus
serve: HTTP 200 OK (4173)
```

- **Checkpoint:** `ucf-tahap-1` .. `ucf-tahap-8` (tag `ucf-tahap-8` final di `ffaa55f`, semua tag lama utuh) · **Repo:** https://github.com/siluman-mati/ucf-universal-character-foundry (`1426615554`) — `master` pushed + 9 tags
- **File berubah Tahap 8:** `src/export/exportPanel.js` (skeleton rebinding + beforeStats fallback), `package.json` (stage8), `tests/e2e-stage8.mjs` (baru), `tests/audit-tahap7-detail.mjs` (detail), `vercel.json`, `TAHAP-8-LAPORAN.md` + `DEPLOY-UCF-LAPORAN.md`
- **Artefak:** `dist/` siap deploy, `ucf-audit/stage8/phase-8.json`, screenshots

---

## 7. Deploy Vercel — ✅ LIVE

- **Project:** `ucf-universal-character-foundry` (`prj_kR9OTsmBN1l4wPhmp0RmYGVYHojA`) — framework `vite`, `npm run build`, `dist`, `legacy-peer-deps`
- **Team:** `JHK` (`team_4Crq4DFnsMj6qWX04cAZUrdg`) — owner `mh5832770@gmail.com`
- **URL publik:** **https://ucf-universal-character-foundry.vercel.app** — `HTTP 200`, `content-type text/html`, `x-vercel-id pdx1::...` — `ssoProtection:null` (awal protected, sudah di-patch)
- **Repo:** https://github.com/siluman-mati/ucf-universal-character-foundry — push `master ffaa55f` + tags sukses
- **Deployment:** 2× via `npx vercel --prod --token $VERCEL_TOKEN` (4.7 MB upload, build `iad1` 12–14 s, vite 456 ms) — Production alias `https://ucf-universal-character-foundry-79jgr5cql-jhk14.vercel.app` + `https://ucf-universal-character-foundry.vercel.app`
- **Verifikasi:** `curl -I` 200, `fetch_page` `<title>Universal Character Foundry — Tahap 7</title>` + `assets/index-DALRa_dZ.js` — identik dengan `dist/` lokal. Lihat `DEPLOY-UCF-LAPORAN.md`.

---

## 8. Batasan jujur

- Validasi penampil independen via `importModelFile` (GLTFLoader) — identik dengan viewer eksternal; manual dibuka di DonMcCurdy/Babylon (1 MB PASS), bukan CI headless viewer terpisah.
- Android fisik NOT TESTED — perlu device.
- Skeleton fix hanya untuk UCF rig (51 tulang); model eksternal dengan rig lain tetap perlu mapping.
- `KHR_materials_pbrSpecularGlossiness` tidak didukung — lapor, tidak klaim preserve.
- Tanpa simulasi kain, topology produksi, auto-rig universal.
