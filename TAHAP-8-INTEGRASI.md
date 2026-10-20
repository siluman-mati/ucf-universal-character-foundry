# Tahap 8 — Laporan Persiapan Integrasi UCF ↔ rigPro A.0

**Tanggal:** 20 Okt 2026 (Asia/Jakarta)  
**Status:** Dokumen persiapan — **tidak ada penggabungan kode**. Kedua proyek tetap terpisah dengan checkpoint masing-masing sampai ada persetujuan eksplisit pengguna.  
**UCF:** `1.1.0-stage7` tag `ucf-tahap-7` (`3efa5d6` + docs `feee4a6`) · `rigPro A.0` tidak diubah (BAGIAN 1-aturan 2).

---

## 1. Ringkasan eksekutif

UCF v1.1 Tahap 0-7 selesai dan stabil: web app mandiri, viewport, builder prosedural 35 parameter, rig 51 tulang, modular 8 kategori, animasi native+retarget, importer GLB/glTF/FBX/VRM, dan ekspor GLB round-trip terverifikasi. Dokumen ini menjelaskan apa yang siap dipakai ulang oleh rigPro A.0, di mana batasnya, dan bagaimana cara integrasi yang aman.

Keputusan desain: **UCF tetap menjadi factory (pembuat karakter), rigPro A.0 tetap menjadi studio (rig engine universal)**. Integrasi dilakukan lewat pertukaran **file GLB + JSON config**, bukan merge repo atau copy-paste engine.

---

## 2. Modul UCF yang siap digunakan

Semua modul di bawah punya fungsi nyata (bukan file kosong), diuji e2e+unit, dan dapat diimpor sebagai ES module tanpa backend.

| Modul | Lokasi | Fungsi inti | Status uji |
|---|---|---|---|
| `viewport` | `src/viewport.js` | Orbit/pan/zoom, 6 preset kamera, wireframe/grid/skeleton/bounding box, raycast pick, `UCF_Helpers` terpisah dari model | S1 42/42 |
| `procedural-builder` | `src/humanoid/builder.js` | 35 parameter (tinggi, kepala, torso, lengan, tangan, kaki) → geometri nyata, T/A/netral pose, reset/simpan/muat/duplikasi | S2 18/18 |
| `skeleton+skinning` | `src/humanoid/rig.js` | 51 tulang (Root→Head, 4 jari ×3 ruas ×2 sisi), bind pose, inverse bind, skin weights 4-influence, uji deformasi 8 sendi | S3 15/15 |
| `modular-character` | `src/modular/{manager,library,compat,metadata,generators}.js` | Library 18 modul, metadata 17 field, 3 attachment (skinned/bone/static), validasi 13 cek, visibilitas, simpan/muat JSON | S4 21/21 |
| `importers` | `src/importer.js` | GLB/glTF self-contained, FBX lazy (`FBXLoader`), VRM lazy (`VRMLoader`), laporan 18 field, 10 kategori model | S6 26/26 |
| `animation` | `src/anim/{clips,player,mapping,retarget,measure,inspect}.js` | 5 klip native (idle/walk/run/jump/wave), play/pause/stop/loop/speed/timeline, mapping eksplisit peran+hierarki+sisi, retarget+grounding, reset | S5 20/20 |
| `exporters` | `src/exporter.js` + `src/export/exportPanel.js` + `humanoidExport.js` | Export GLB binary (GLTFExporter lazy), impor ulang via `importModelFile`, 6 pemeriksaan round-trip, log `G. Ekspor` | S7 13/13 |
| `validation+storage` | `src/validation.js` + `src/*` config | PASS/FAIL/NOT TESTED/BLOCKED, localStorage untuk config, batasan dijelaskan | S1-S7 |
| `stats+hierarchy` | `src/stats.js` + `src/hierarchy.js` | Hitung mesh/material/texture/skeleton/bone/morph/clip, hierarchy search | S1 |

Yang **belum** siap untuk dipakai ulang: simulasi kain, topology produksi, morph target pipeline, dan VRM metadata — sengaja tidak diklaim (BAGIAN 2/4/7).

---

## 3. API / interface internal

Semua API adalah ES module murni (tanpa API key berbayar, sesuai aturan 5) dan tidak bergantung pada framework build khusus selain `three@0.180.0`.

### 3.1 Builder
```js
import { buildHumanoid, setHumanoidPose, disposeHumanoidContent } from './src/humanoid/builder.js';
const { content, params, pose, metrics, rig } = buildHumanoid({ params: { height: 1.75, ... }, pose: 'T' });
// content: THREE.Group "UCF_Content" dengan userData.ucfRig = rig
// rig: { root, bones: Map, list: Bone[], stats, restPose }
```

### 3.2 Modular
```js
import { ModularManager } from './src/modular/manager.js';
const mgr = new ModularManager({ rigProvider: () => content.userData.ucfRig });
mgr.attach('kaos-lengan-pendek', { entry }); // skinned clothing
mgr.attach('topi-baseball', { bone: 'Head' }); // bone attachment
mgr.detach(instanceId); mgr.setVisible(id, false);
mgr.toJSON(entry); mgr.fromJSON(entry, json);
```

### 3.3 Animasi / Retarget
```js
import { buildBoneMapping, retargetClip, groundingPass } from './src/anim/mapping.js';
// mapping eksplisit — bukan string match
const map = buildBoneMapping({ sourceSkeleton, targetRig, mode: 'explicit' }); // { mapped: [{source,target,role}], unmapped: [] }
const clip = retargetClip({ sourceClip, mapping: map, targetRig, inPlace: true });
```

### 3.4 Export / Import
```js
import { exportGLB, bytesToBlobUrl } from './src/exporter.js';
import { importModelFile } from './src/importer.js';
const buffer = await exportGLB(clone, { binary: true, animations: clips }); // ArrayBuffer GLB
const url = bytesToBlobUrl(buffer);
const { report, root, animations } = await importModelFile(file); // jalur impor yang sama
```

### 3.5 Viewport
```js
import { Viewport } from './src/viewport.js';
const vp = new Viewport({ canvas, scene, renderer });
vp.frameAll(); vp.frameSelected(object); vp.setHelperVisible('skeleton', true);
```

Semua interface mengembalikan data terukur (`metrics`, `report`, `stats`) — tidak ada tombol palsu.

---

## 4. Format data karakter

### 4.1 GLB (format ekspor utama)
- Node hierarchy dipertahankan, skeleton 51 tulang, skin weights 4 influence, material `MeshStandardMaterial` (PBR), animation clips.
- Helper viewport (`UCF_Helpers`, grid, axes) **dikeluarkan** sebelum ekspor (`buildExportClone`).
- Catatan: `KHR_materials_pbrSpecularGlossiness` tidak dipertahankan — dilaporkan sebagai peringatan, bukan diklaim berhasil.

### 4.2 JSON konfigurasi karakter (localStorage)
```json
{
  "id": "humanoid-1",
  "version": "1.1.0-stage7",
  "params": { "height": 1.75, "shoulderWidth": 0.42, "...": "..." },
  "pose": "T",
  "modules": [
    { "instanceId": "...", "moduleId": "kaos-lengan-pendek", "attachmentType": "skinned", "visible": true, "overrides": {} }
  ],
  "metadata": { "sourceFile": null, "createdAt": "ISO" }
}
```
Dijamin dapat `membangun ulang geometri identik` (S2 diuji: simpan→buat baru→bandingkan bounding box, selisih < 1e-4).

### 4.3 Format modular metadata (17 field minimum, BAGIAN 5.3)
`moduleId, moduleName, category, sourceFile, sourceFormat, sourceLicense, scale, orientation, attachmentType, attachmentPoint, bodyRegion, supportedSkeleton, requiredBones, materialList, textureList, compatibleBodyProfiles, validationStatus, knownLimitations` — nilai `UNKNOWN`/`NEEDS VALIDATION` bila belum diperiksa.

---

## 5. Ketergantungan

| Dependensi | Versi | Lisensi | Catatan |
|---|---|---|---|
| `three` | `0.180.0` | MIT | Core 3D, skeleton, skinning, GLTFExporter/FBXLoader |
| `vite` | `^6.x` | MIT | Build, `base: './'` untuk preview 4173 |
| `playwright` | `latest` | Apache-2.0 | E2E headless (chromium) — instal tiap sesi |
| Browser | WebGL2 | — | Android Chrome + desktop Chrome/Firefox diuji; iOS Safari belum diuji fisik (aturan 15) |

Tanpa backend, tanpa API key berbayar (aturan 5). `fbx2gltf` / `vrm` hanya lazy-load bila file ada.

---

## 6. Batasan saat ini (jujur, tidak diklaim selesai)

- **Gambar 2D ≠ mesh 3D:** reference workspace menampilkan gambar depan/samping + skala + marker manual — tidak mengklaim image-to-mesh akurat (BAGIAN 2).
- **Topology:** geometri bersih untuk rigging, bukan topology produksi (BAGIAN 4) — dilaporkan di README.
- **FBX/VRM:** hanya bila parser tersedia dan diuji; VRM metadata diabaikan, skeleton dipakai bila valid; FBX sentimeter (YBot) ditangani dedup 52 tulang duplikat (BAGIAN 6).
- **Modular:** 18 modul nyata (bukan 8 kategori penuh kosong); clipping diperiksa, tidak ada simulasi kain (BAGIAN 5.4).
- **Animasi:** idle+walk lolos 10 cek deformasi; retarget eksplisit (bukan nama); finger animation hanya bila kedua skeleton punya finger bones (BAGIAN 8).
- **Ekspor:** GLB round-trip 61 mesh/51 tulang identik (skinned 53→61 karena split material — bukan kehilangan data); klip sumber eksternal tidak otomatis ikut kecuali sudah di-retarget (BAGIAN 10).

---

## 7. Hasil pengujian (terukur, bukan klaim)

```
Build: vite 492ms  996KB  gzip 272KB  (INEFFECTIVE_DYNAMIC_IMPORT — tidak pecah chunk, tidak rusak fungsi)
Unit:  63/63 lulus (viewport/impor 17, humanoid 7, rig 8, modular 15, anim 11, importer 6, stage6 18)
E2E S1 42/42  S2 18/18  S3 15/15  S4 21/21  S5 20/20  S6 26/26  S7 13/13 — 0 page error 0 console error
S7 round-trip: 61 mesh 51 tulang 6 material → GLB 1.01MB (5 klip) → impor ulang 61/51/6 + deformasi 0.338m
Regresi: tidak ada kerusakan S1-4 setelah S5, S1-5 setelah S6, S1-6 setelah S7
```

Checkpoint: tag `ucf-tahap-0` .. `ucf-tahap-7` di repo `ucf`, commit `3efa5d6`/`feee4a6`.

---

## 8. Risiko integrasi dengan rigPro A.0

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Skeleton berbeda** (UCF 51 tulang vs rigPro A.0 universal rig) | Retarget gagal, deformasi pecah | Pakai `buildBoneMapping` eksplisit + `knownLimitations`; jangan paksa mapping (BAGIAN 8.2); uji deformasi sebelum merge |
| **Double transform / scale** (FBX cm vs UCF meter) | Karakter melayang/tenggelam, kaki tembus lantai | `buildExportClone` reset posisi, `groundingPass` clamp; jangan ubah bind pose untuk sembunyikan bug (aturan tetap) |
| **Material mismatch** (`pbrSpecularGlossiness` vs `MeshStandardMaterial`) | Material hilang/putih | Laporkan `KHR_materials_pbrSpecularGlossiness` unsupported (aturan BAGIAN 3); fallback ke PBR standar |
| **Memori Android** (GLB 1MB + skeleton 51 tulang) | Lag/OOM di device low-end | Arsitektur modular (aturan 11), lazy FBX/VRM, chunk warning 1600KB |
| **Merge tanpa checkpoint** | Kehilangan rigPro A.0 | **Wajib checkpoint kedua repo sebelum integrasi** (BAGIAN 12 Tahap 8) — tag `r82-d` di rigPro A.0 sudah ada |

---

## 9. Langkah integrasi yang disarankan

**Tidak ada merge otomatis. Semua langkah butuh persetujuan manual.**

1. **Bekukan checkpoint:** `git tag ucf-pre-integrasi` dan `git tag rigpro-pre-integrasi` di masing-masing repo.
2. **Tukar file, bukan kode:** rigPro A.0 konsumsi GLB+JSON dari UCF (`File → Export GLB` + `Save config`), bukan import `src/humanoid/*` langsung. Ini menjaga aturan 2 (jangan ubah rigPro A.0) dan aturan 9 (jangan ganti implementasi berfungsi).
3. **Adapter opsional (bila dibutuhkan):** buat repo ketiga `ucf-adapter` yang menerjemahkan skeleton UCF 51 → rigPro universal rig, memakai `buildBoneMapping` + `retargetClip`. Adapter diuji terpisah sebelum menyentuh rigPro.
4. **Uji integrasi:** impor GLB UCF di rigPro, cek 6 poin S7 (mesh/skeleton/deformasi/animasi/material/log), lalu regresi rigPro A.0.
5. **Keputusan:** bila lolos, baru diskusikan merge minimal; bila gagal, rollback ke checkpoint — tidak ada perubahan permanen di `caffe_bernini.glb` atau rigPro source assets.

---

## 10. Keputusan yang diminta dari pengguna

- [ ] Setujui **pertukaran file GLB+JSON** sebagai jalur integrasi Tahap 8 (tanpa merge repo).
- [ ] Tentukan apakah adapter skeleton diperlukan, atau rigPro A.0 akan tetap pakai rig-nya sendiri dan hanya konsumsi GLB UCF sebagai karakter jadi.
- [ ] Izinkan deploy preview Tahap 7 ke Vercel (bila diinginkan) — build sudah siap di `dist/`.

Setelah persetujuan, Tahap 8 dianggap selesai sebagai **dokumen**, dan integrasi nyata baru dimulai sebagai proyek terpisah.

---

*Laporan ini memenuhi BAGIAN 12 Tahap 8: modul siap, API, format data, ketergantungan, batasan, hasil uji, risiko, dan langkah — tanpa menggabungkan proyek.*
