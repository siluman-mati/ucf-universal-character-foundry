# Universal Character Foundry (UCF) v1.1 — Tahap 5

Aplikasi web mandiri untuk pembuatan karakter 3D. **Tahap 1** mencakup viewport 3D,
kontrol kamera, helper tampilan, hierarki objek, dan impor GLB/glTF; **Tahap 2** menambah
humanoid prosedural 35 parameter; **Tahap 3** menambah skeleton 51 tulang sampai ruas jari,
skin weights, dan pengujian deformasi; **Tahap 4** menambah sistem modular karakter
(library 18 modul, validasi kompatibilitas 13 pemeriksaan, pasang/lepas/ganti, material,
visibilitas, dan simpan/muat config); **Tahap 5** menambah animasi: 5 klip native yang
di-bake dengan foot grounding, pemutaran klip model impor, retargeting dengan pemetaan
tulang eksplisit (peran + hierarki + sisi dunia, bukan nama), dan pengukuran deformasi
dari verteks hasil skinning. Proyek terpisah dari rigPro A.0 dan tidak mengubahnya.

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
- **Animasi (Tahap 5):** panel "8 · Animasi" berisi 5 klip native (idle 2,4 s, walk 1,0 s,
  run 0,72 s, jump 1,2 s, wave 2,0 s), kontrol putar/jeda/stop/reset pose, loop, kecepatan,
  timeline, dan tombol **Uji animasi** yang mengukur 10 hal dari geometri: lantai, kaki
  bergantian, drift panggul, loop, lutut, tangan, kepala, regangan mesh, lengan tidak kaku
  T-pose, serta pakaian modular mengikuti deformasi.
- **Retargeting (Tahap 5):** pilih model impor beranimasi → **Buat peta tulang** → tabel
  pasangan eksplisit + 6 pemeriksaan kualitas → **Retarget & muat**. Hasil retarget
  di-grounding (contact/clamp) dan diverifikasi dua cara: deviasi arah tulang terhadap pose
  yang diharapkan, dan korelasi lintasan tangan/kaki terhadap klip sumber.
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
npm test                              # 63 tes unit (17 viewport/impor + 12 humanoid + 8 rig + 15 modular + 11 animasi)
node scripts/serve.mjs 4173 &         # setelah npm run build
node tests/e2e-stage1.mjs             # 42 cek browser Tahap 1
node tests/e2e-stage2.mjs             # 18 cek browser humanoid (2a+2b+2c)
node tests/e2e-stage3.mjs             # 15 cek browser rigging & deformasi
node tests/e2e-stage4.mjs             # 21 cek browser sistem modular
node tests/e2e-stage5.mjs             # 20 cek browser animasi & retargeting
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

## Tahap 2 — humanoid prosedural

Seksi 5 di panel kanan membuat humanoid manekin dari geometri nyata (loft torso/kepala,
silinder anggota badan, telapak hasil loft, jari 3 ruas + ibu jari 2 ruas). **35 parameter**
aktif dalam 6 grup:

- **A Proporsi** (5): tinggi, lebar tubuh, skala kepala, panjang torso, pusat massa.
- **B Kepala** (6): tinggi/lebar/kedalaman kepala, rahang, panjang & lebar leher.
- **C Tubuh** (5): bahu, dada, ketebalan, pinggang, pinggul.
- **D Lengan** (5): lengan atas, lengan bawah, radius siku, radius pergelangan, panjang telapak.
- **E Tangan** (8): lebar telapak, ketebalan jari, panjang telunjuk/tengah/manis/kelingking,
  panjang & posisi ibu jari.
- **F Kaki** (6): paha, betis, radius lutut, radius pergelangan, panjang & lebar telapak kaki.

Setiap slider memicu rebuild mesh; nilai dibaca ulang dari `params.js` (bukan sekadar skala
visual). **Reset**, **Duplikat**, **Hapus**, ganti nama, pose T/A/netral, **Undo/Redo**
(Ctrl+Z / Ctrl+Shift+Z), serta **Simpan/Muat config** (JSON `ucf-character-config` v1.0)
berfungsi. Readout menampilkan tinggi aktual, jumlah mesh/verteks/segitiga, material, dan
hash geometri (FNV-1a).

## Tahap 3 — rigging & skinning

Seksi 6 di panel kanan menampilkan dan menguji rig karakter terpilih.

- **Skeleton 51 tulang**: `Root → Hips → Spine → Chest → Neck → Head → HeadTop`,
  `Chest → Clavicle → UpperArm → LowerArm → Hand`, `Hand → Finger_{Index,Middle,Ring,Pinky}_{1,2,3}`
  dan `Thumb_{1,2}` (28 tulang jari), `Hips → UpperLeg → LowerLeg → Foot → Toe`.
- **Skin weights nyata**: setiap verteks (4.652) punya 1–2 pengaruh, jumlah bobot dinormalkan
  (galat maksimum 2,2 × 10⁻¹⁶), tanpa verteks tanpa bobot. Bobot dibatasi ke rantai tulang
  mesh yang bersangkutan (`candidateBonesForMesh`) supaya lengan tidak menarik torso.
- **Pilih tulang**, lihat induk/jumlah anak, putar sumbu X/Y/Z lewat slider, **reset pose**,
  **uji deformasi** (mengukur perpindahan verteks + memastikan kepala tidak ikut), dan
  **cek weights**; hasil masuk log validasi grup B.
- Toggle **skeleton** (`THREE.SkeletonHelper`) dan **nama tulang** (label sprite).
  Helper berada di grup `UCF_Helpers`, `userData.ucfHelper = true`, **tidak berada di dalam
  model** sehingga tidak ikut terhitung sebagai bagian karakter.
- Pose T/A/netral diterapkan lewat rotasi tulang, bukan membangun ulang geometri;
  bind pose selalu T. Simpan/muat config mempertahankan rig, pose, dan bentuk.

## Tahap 4 — sistem modular karakter

Seksi 7 di panel kanan menyimpan library modul dan daftar modul terpasang.

- **18 modul bawaan** (1 base body + 17 dapat dipasang) pada 8 kategori: `body`, `skin`,
  `face`, `hair`, `tops`, `bottoms`, `shoes`, `accessories`. Tipe attachment: `base`,
  `skinned` (kaos, jaket, celana, rok, sarung tangan), `bone` (rambut, topi, kacamata,
  sabuk, sepatu, sandal, wajah), `static` (tas punggung), dan `material` (skin).
- **Metadata 19 field** per modul (18 field prompt + `moduleVersion`) divalidasi sebelum
  dipasang; manifest yang kurang field ditolak dengan daftar field yang hilang.
- **13 pemeriksaan kompatibilitas**: metadata, profil body (`ucf-procedural-35`), skeleton
  (`ucf-humanoid-51`), tulang wajib, titik pasang, area tubuh, skala, proporsi, posisi,
  orientasi (determinan matriks), skin weights, material, dan clipping. Nama tulang yang
  sama saja tidak cukup — skeleton ID, tulang wajib, area, dan geometri ikut diukur.
- Modul **skinned** memakai `skinGeometryForRig()` sehingga menumpang `Skeleton` body
  (tidak menambah tulang); modul **bone** digantung pada tulang target; modul **static**
  ditempatkan pada ruang root. Hasil uji: body tetap 53 mesh / 51 tulang, beratap 4 pengaruh.
- **Operasi UI**: cari/filter kategori, **Pasang**, **Pratinjau** (render thumbnail 96 px),
  **Lepas**, **Hapus**, ganti modul dalam kategori yang sama, rename, ubah warna material,
  checkbox visibilitas, dan impor manifest JSON. Setiap aksi masuk log validasi grup D.
- **Status jujur**: `VALID` hanya bila seluruh pemeriksaan PASS; `NEEDS VALIDATION` untuk
  modul yang tidak dapat memverifikasi clipping (mis. `wajah-dasar`) atau modul hasil impor.
- **Config** menyimpan `modules[]`: instanceId, moduleId, nama, kategori, tipe attachment,
  visibilitas, material, transform, status validasi, metadata sumber, dan manifest impor.
  Muat config memasang ulang modul melalui `reattachAll()`.

## Tahap 5 — animasi, retargeting, dan pengujian deformasi

Seksi 8 di panel kanan berisi pemutar animasi dan panel retargeting.

- **5 klip native** yang di-bake 30 fps dari pose parametrik: `idle` 2,4 s (contact),
  `walk` 1,0 s (contact), `run` 0,72 s (align), `jump` 1,2 s (clamp), `wave` 2,0 s (contact).
  Setiap klip menulis track kuaternion untuk **seluruh 51 tulang** + track posisi panggul,
  dengan koreksi ketinggian panggul per frame sehingga telapak menapak lantai tanpa membuat
  badan mengambang. `walk`: telapak −0,0024 … +0,0023 m, drift panggul 0 m.
- **Pemutaran klip model impor** (XBot 7 klip) dan **klip hasil retarget**, satu mixer dengan
  kontrol putar/jeda/stop, seek, loop, dan kecepatan 0,25–2,0×.
- **Pemetaan tulang eksplisit**, bukan berbasis nama: peran tulang dideteksi dari geometri
  (panggul = leluhur bersama dua daun terendah, rantai batang, klavikula→tangan, lima rantai
  jari, sisi dari posisi dunia). Hasil pada XBot: **50 pasangan** dari 67 tulang sumber,
  sementara pencocokan nama mentah hanya menemukan **4**. Enam pemeriksaan kualitas:
  cakupan peran inti, konsistensi hierarki, konsistensi sisi, kecocokan rest relatif,
  konflik label sisi, dan pembanding nama-saja.
- Konvensi sisi dicatat jujur: Mixamo menamai tulang `Left*` pada sumbu **+X**, UCF menamai
  `_R` pada +X. Pasangan tetap memakai **sisi dunia**, dan 44 konflik label dilaporkan
  sebagai "konvensi-label", bukan dianggap kesalahan struktur.
- **Retarget**: rotasi dunia sumber dipindahkan setelah disejajarkan dengan bind pose target
  (`alignment: 'rest'`), translasi panggul diskalakan (`hipScale` 0,871) dan root motion
  dibuang (in-place). Hasil di-grounding otomatis (`contact` bila rentang titik terendah
  < 60 mm) — telapak yang semula −0,0535 m menjadi 0,0000 m.
- **Verifikasi retarget dua cara**: (1) deviasi arah tulang pose aktual hasil mixer terhadap
  pose yang diharapkan → 0,00° rata-rata/terburuk; (2) korelasi lintasan ujung tangan/kaki
  relatif panggul terhadap klip sumber → minimum 0,926.
- **Uji animasi** mengukur dari **verteks setelah skinning**, 10 pemeriksaan: `lantai`,
  `bergantian`, `panggul`, `loop`, `lutut`, `tangan`, `kepala`, `regangan`, `lengan`,
  `modul`. Cek `lengan` menangkap pose yang kaku di T-pose (sudut lengan minimum terhadap
  arah bawah; T-pose = 90°, ambang 65°).
- **Modul ikut deformasi**: verteks modul dipasangkan dengan verteks tubuh bertulang dominan
  yang sama (bukan "tetangga terdekat" yang bisa berpindah kaki). Perubahan jarak maksimum
  15,1 mm (retarget walk) / 21,1 mm (native walk) dari ambang 30 mm.
- **Reset pose** selalu kembali ke bind pose karakter yang disimpan di `rig.restPose`
  (delta kuaternion 0, delta verteks 0 m), bukan ke pose yang kebetulan aktif saat klip dimuat.
- `skinGeometryForRig()` dan generator modul selalu dihitung di bind pose, sehingga memasang
  modul saat karakter sedang beranimasi tidak menghasilkan bobot atau posisi yang salah.

## Batasan saat ini (jangan diklaim lebih)

- Bentuk manekin masih kasar (tanpa tekstur/wajah, tanpa rig wajah); kualitas visual belum final
  dan **bukan topology siap produksi**.
- Belum ada IK, kontrol rig, atau auto-rig untuk model eksternal; rig hanya untuk humanoid
  prosedural UCF.
- Animasi diuji secara numerik (deformasi verteks) **dan** lewat screenshot. **Belum ada
  simulasi kain** — pakaian hanya mengikuti skinning.
- **Retarget hanya dibuktikan pada satu sumber uji (XBot/Mixamo).** Model tanpa rig, rig
  non-humanoid, VRM, dan skeleton dengan konvensi lain belum diuji; kompatibilitas model luar
  menyeluruh adalah lingkup Tahap 6.
- Root motion dibuang (in-place); opsi mempertahankannya ada di kode tetapi belum diuji e2e.
- Klip native adalah hasil bake pose parametrik, bukan animasi hasil capture; kualitas
  gerak masih sederhana (tanpa IK kaki, tanpa offset per-tulang klavikula).
- Nilai parameter 3 desimal; slider memakai langkah 0,001 m agar nilai default dapat
  dikembalikan persis.
- Modul pakaian/aksesori masih prosedural tanpa tekstur; belum ada simulasi kain,
  rig wajah, atau morph target. Modul impor hanya boleh menunjuk generator prosedural UCF —
  berkas GLB/VRM pakaian eksternal belum didukung.
- Clipping diperiksa dengan sampling verteks terhadap mesh body (ambang 2% PASS / 20% WARN);
  ini heuristik, bukan jaminan bebas penetrasi di semua pose.
- Satu slot untuk `skin/face/hair/tops/bottoms/shoes`; aksesori boleh lebih dari satu.
  Transform modul hanya untuk tipe `bone`/`static`, bukan `skinned`.
- Belum ada ekspor GLB/FBX/VRM (Tahap 7) — tidak ada tombol ekspor di UI karena fiturnya
  belum ada.
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
