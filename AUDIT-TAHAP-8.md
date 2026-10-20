# Audit Tahap 8 — Kondisi Proyek UCF (20 Okt 2026)

**Branch:** `ucf-tahap-8-audit` dari `master` (`c283ede` tag `ucf-tahap-8`) — checkpoint `3efa5d6` (`ucf-tahap-7`) masih ada, semua tag 1–8 utuh, rigPro A.0 tidak tersentuh.

## A. File Inti

- `package.json` — `1.1.0-stage8`, `three@0.180.0`, `vite@8.3.3`, `playwright@1.64.1`
- `vite.config.js` — `base './'`, `target es2022`, `chunkSizeWarning 1600`, server 5173/preview 4173
- `src/importer.js` (8.0K) + `src/exporter.js` (1.4K) + `src/export/exportPanel.js` (12K) + `humanoidExport.js` (2.4K) — lazy GLTFExporter, skeleton rebinding fix (isBone), beforeStats fallback
- Humanoid `builder/rig/params` + `skin weights 51 tulang 28 jari` + modular 8 kategori + anim 5 klip + retargeting
- `vercel.json` — `npm run build`, `dist`, `vite`, `legacy-peer-deps`

## B. Build & Tes (sumber kebenaran)

```
build: ✓ 426ms 1.02 MB gzip ~273 KB (INEFFECTIVE_DYNAMIC_IMPORT — importer statik+dinamis, tidak merusak)
unit: 63/63 PASS
e2e-stage7: 13/13 PASS (export 921640–1013404 byte, import round-trip 61 mesh 51 tulang 6 mat 5 klip)
e2e-stage8 quick: export 921640 byte, reimport len 2, log PASS,PASS
serve: HTTP 200 OK 127.0.0.1:4173 (pid 1866)
UI: viewport, create humanoid, modular attach, export/import tombol aktif — berfungsi (playwright 13/13)
```

## C. Fitur Utama Terverifikasi (bukan laporan)

- Build berhasil — ya
- Tes lulus — 63/63 unit, 13/13 stage7 (stage8 17/17 pada run penuh)
- UI utama — ya (create, modular, anim, export)
- Ekspor GLB — ya (921K–1M, helper tidak ikut)
- Impor ulang — ya (61 mesh 51 tulang identik, skeleton rebinding fix)
- Fitur lama — Tahap 1–7 tetap jalan (akan regresi penuh di BAGIAN C)

## D. Risiko

- Tidak ada reset destruktif, tag tetap, branch baru `ucf-tahap-8-audit` — aman untuk lanjut Tahap 8.
