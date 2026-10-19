# Universal Character Foundry (UCF) v1.1 — Tahap 1

Aplikasi web mandiri untuk pembuatan karakter 3D. **Tahap 1** mencakup viewport 3D,
kontrol kamera lengkap, helper tampilan, hierarki objek, dan impor GLB/glTF.
Proyek terpisah dari rigPro A.0 dan tidak mengubahnya.

## Yang sudah berfungsi pada tahap ini

- Viewport three.js r180 (WebGL2) dengan orbit, pan, zoom.
- Enam tampilan kamera: **Depan, Belakang, Kiri, Kanan, Atas, Perspektif** + **Muat semua** + **Reset kamera**.
  Jarak kamera dihitung dari kotak pembatas model (bukan konstanta).
- Toggle **wireframe, grid lantai, sumbu X/Y/Z, bounding box** (bounding box default OFF).
  Helper berada di grup `UCF_Helpers` dan ditandai `userData.ucfHelper` — terpisah dari model.
- Impor **.glb / .gltf self-contained** (data URI) via pemilih berkas dan drag & drop.
  Laporan impor: format, ukuran, waktu muat, node, mesh, skinned mesh, skeleton, tulang,
  material, tekstur, verteks, segitiga, morph target, klip, dimensi, ekstensi, peringatan.
- Hierarki objek lengkap (termasuk 67 tulang XBot), pencarian nama, detail node,
  pemilihan via klik hierarki atau raycast di viewport.
- Log validasi **PASS / FAIL / NOT TESTED / BLOCKED** dengan nama tes, model, error,
  peringatan, waktu, dan detail teknis; dapat diunduh sebagai JSON.
- Tata letak responsif: panel menjadi drawer pada lebar ≤ 980 px, diuji pada 390×844.

## Menjalankan

```bash
cd ucf
npm install --legacy-peer-deps     # npm 10.8.2 di sandbox perlu flag peer-deps
npm run dev                        # http://localhost:5173
# atau build produksi:
npm run build
node scripts/serve.mjs 4173        # http://localhost:4173
```

`node_modules` dan `dist` tidak disertakan dalam snapshot; jalankan instalasi/build lagi
di sesi baru. Browser untuk Playwright juga perlu dipasang ulang:
`npx playwright install chromium`.

## Tes

```bash
npm test                              # 17 tes unit Tahap 1
node --test tests/humanoid-unit.test.mjs  # 12 tes unit humanoid
node scripts/serve.mjs 4173 &         # setelah npm run build
node tests/e2e-stage1.mjs             # 42 cek browser Tahap 1
node tests/e2e-stage2a.mjs            # 10 cek browser humanoid 2a
```

E2E menulis `../ucf-audit/stage1-e2e.json` dan `../ucf-audit/screenshots/*.png`
(dapat diubah dengan `UCF_OUT` dan `UCF_URL`).

### Fixture

- `test-assets/box-tanpa-rig.gltf` — 12 segitiga, 0,40 × 0,90 × 0,30 m, dibuat oleh
  `scripts/make-fixtures.py` (milik proyek).
- `test-assets/ekstensi-tak-didukung.gltf` — kotak dengan ekstensi yang tidak didukung.
- `test-assets/XBot.glb` — **tidak** disertakan dalam repo (lisensi Mixamo; hanya untuk
  pengujian lokal). Siapkan dengan:

```bash
cp ../humanoid-studio/public/models/XBot.glb test-assets/XBot.glb
```

## Tahap 2a — humanoid prosedural

Seksi 5 di panel kanan membuat humanoid manekin dari geometri nyata (loft torso/kepala,
silinder anggota badan, telapak hasil loft, jari 3 ruas + ibu jari 2 ruas). 21 parameter
aktif pada sub-tahap ini: tinggi, lebar tubuh, skala kepala, panjang torso, pusat massa,
enam ukuran kepala/leher, lima ukuran tubuh, dan lima ukuran lengan/kaki panjang.

- Setiap slider memicu rebuild mesh; nilai dibaca ulang dari `params.js` (bukan sekadar
  skala visual).
- **Reset**, **Duplikat**, **Hapus**, ganti nama, T/A/netral, **Undo/Redo** (Ctrl+Z /
  Ctrl+Shift+Z), serta **Simpan/Muat config** (JSON `ucf-character-config` v1.0) berfungsi.
- Readout menampilkan tinggi aktual, jumlah mesh/verteks/segitiga, material, dan hash
  geometri (FNV-1a) untuk membandingkan bentuk.
- 14 parameter tangan/jari/lebar telapak-kaki menyusul di sub-tahap 2b.

## Batasan saat ini (jangan diklaim lebih)

- Humanoid belum punya **skeleton, weights, atau rigging**; Tahap 3 belum dikerjakan.
- Belum ada modul pakaian, animasi/retargeting, maupun ekspor. Klip animasi hanya
  **dihitung**, belum diputar.
- Hanya GLB/glTF. FBX/VRM ditolak dengan pesan eksplisit.
- Draco dan KTX2/Basis Universal belum didukung → impor **BLOCKED** dengan alasan.
  Material `KHR_materials_pbrSpecularGlossiness` dilaporkan sebagai peringatan.
- Tidak ada backend/penyimpanan permanen; sesi hilang saat halaman dimuat ulang.
- Uji perangkat Android fisik tidak dilakukan (tidak tersedia); hanya emulasi ukuran layar.
- "Depan" didefinisikan sebagai kamera pada sumbu **+Z**. Untuk XBot arah ini sesuai arah
  hadap model (tulang `Toe_End` di +Z 0,161 m vs `Foot` di −0,039 m).

## Lisensi

Kode UCF: belum ditentukan pemilik (UNLICENSED). three.js (MIT), Vite (MIT),
Playwright (Apache-2.0). Aset uji pihak ketiga tidak didistribusikan.
