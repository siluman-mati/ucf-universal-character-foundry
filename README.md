# Universal Character Foundry (UCF) v1.1 — Tahap 8

Aplikasi web mandiri untuk pembuatan karakter 3D. Tahap 0-8 selesai: **Tahap 1** viewport & impor GLB, **Tahap 2** humanoid prosedural 35 parameter, **Tahap 3** skeleton 51 tulang + skin weights, **Tahap 4** modular 18 modul + validasi 13 cek, **Tahap 5** animasi 5 klip native + retarget eksplisit, **Tahap 6** 10 kategori model eksternal (FBX/VRM/YBot duplikat), **Tahap 7** ekspor GLB round-trip 61 mesh/51 tulang terverifikasi, **Tahap 8** laporan persiapan integrasi rigPro A.0 (dokumen, tanpa merge). Proyek terpisah dari rigPro A.0 dan tidak mengubahnya.

## Yang sudah berfungsi

- Viewport three.js r180 (WebGL2) orbit/pan/zoom, 6 preset kamera, wireframe/grid/skeleton/bounding box (OFF default), helper di `UCF_Helpers` — tidak ikut ekspor.
- Impor .glb/.gltf self-contained + FBX/VRM lazy, laporan 18 field, hierarki 67 tulang, log PASS/FAIL/NOT TESTED/BLOCKED.
- Builder prosedural 35 parameter → geometri nyata, T/A/netral, reset/simpan/muat/duplikasi.
- Rig 51 tulang sampai ruas jari, deformasi terukur 8 sendi, finger bones diuji.
- Modular 8 kategori (18 modul nyata): skinned/bone/static attachment, metadata 17 field, validasi clipping, simpan/muat JSON.
- Animasi: 5 klip native (idle 2.4s walk 1.0s run 0.72s jump 1.2s wave 2.0s), play/pause/stop/reset/loop/speed/timeline, uji 10 cek deformasi, retarget eksplisit (peran+hierarki+sisi).
- Ekspor GLB 1.01MB 5 klip → impor ulang 61/51/6 + deformasi 0.338m, 6 pemeriksaan round-trip.
- Tahap 8: dokumen `TAHAP-8-INTEGRASI.md` — modul siap, API, format GLB+JSON, batasan, risiko, langkah integrasi via file (tanpa merge).

## Menjalankan

```bash
cd ucf
npm install --legacy-peer-deps
npm run dev                        # http://localhost:5173
npm run build
node scripts/serve.mjs 4173        # http://localhost:4173
```

`node_modules`/`dist` tidak di snapshot; `npx playwright install chromium` tiap sesi.

## Tes

```bash
npm test                              # 63 unit
node tests/e2e-stage1.mjs             # 42 cek
node tests/e2e-stage2.mjs             # 18
node tests/e2e-stage3.mjs             # 15
node tests/e2e-stage4.mjs             # 21
node tests/e2e-stage5.mjs             # 20
node tests/e2e-stage6.mjs             # 26
node tests/e2e-stage7.mjs             # 13 round-trip
```

Build: vite ~500ms 996KB gzip 272KB. Laporan: `TAHAP-7-LAPORAN.md`, `TAHAP-8-INTEGRASI.md`.

## Laporan Tahap

- Tahap 0 audit & checkpoint
- Tahap 1-7 lulus 0 page error 0 console error, tag `ucf-tahap-1`..`ucf-tahap-8`
- Tahap 8 = dokumen persiapan integrasi — tidak ada merge ke rigPro A.0 tanpa persetujuan + checkpoint di kedua repo.

## Batasan jujur

Gambar 2D ≠ mesh 3D; topology bukan produksi; FBX cm/VRM metadata terbatas; tanpa simulasi kain; KHR_materials_pbrSpecularGlossiness tidak didukung; klip eksternal ikut ekspor hanya bila sudah di-retarget.
