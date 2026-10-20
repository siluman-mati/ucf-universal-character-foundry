# Deploy UCF — Laporan Vercel

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Project:** `ucf-universal-character-foundry` · **Team:** `JHK` (`jhk14`) · **Vercel CLI:** 64.7.0 · **Status:** ✅ LIVE

---

## 1. Ringkasan

- **Project ID:** `prj_kR9OTsmBN1l4wPhmp0RmYGVYHojA` — created `2026-10-20T06:43` via `vercel__create_project`
- **URL produksi:** **https://ucf-universal-character-foundry.vercel.app** (alias `https://ucf-universal-character-foundry-79jgr5cql-jhk14.vercel.app`) — **HTTP 200 OK**, `content-type: text/html; charset=utf-8`, `etag: c98fe5...`, tidak lagi Protected
- **Framework:** `vite` · **Build cmd:** `npm run build` · **Output:** `dist` · **Install:** `npm install --legacy-peer-deps` · **Node:** `24.x` · **Region:** `iad1`
- **Akun:** `mh5832770@gmail.com` (`3x4MnegTfrJ8EelTNy7PuczY`) — team `team_4Crq4DFnsMj6qWX04cAZUrdg` (OWNER, Hobby)
- **Build lokal:** `479 ms` · `dist/index.html` 16 KB + `assets/index-DALRa_dZ.js` 997 KB (gzip 273 KB) + `index-CtlfJy8b.css` 18 KB + `FBXLoader` 47 KB + `GLTFExporter` 34 KB
- **Build Vercel:** `12–14 s` — `npm install --legacy-peer-deps` (197 packages), `vite build 456 ms`, output 4.7 MB upload, aliased ke domain produksi

---

## 2. Yang diverifikasi

- `vercel__list_projects` → project `rig52-studio` ada, `ucf-universal-character-foundry` belum ada → create berhasil (`prj_kR9OTsm...`)
- `vercel__list_teams` / `get_authenticated_user` → team `JHK` / user `mh5832770-8749` valid (OWNER)
- `vercel link --project ucf-universal-character-foundry --yes` → `.vercel/project.json` (`projectId prj_kR9OTsm...`, `orgId team_4Crq...`)
- `npx vercel --prod --yes --token $VERCEL_TOKEN` → **Production https://ucf-universal-character-foundry-7ozy1crla-jhk14.vercel.app** (build 1), alias **https://ucf-universal-character-foundry.vercel.app**
- Awal: `ssoProtection: {deploymentType:"all_except_custom_domains"}` → `curl` tanpa token = `Protected by Vercel Authentication`. Fix: `PATCH /v9/projects/prj_kR9OTsm... {ssoProtection:null}` → `ssoProtection:null` → `curl -I https://ucf-universal-character-foundry.vercel.app → 200` ✅
- `fetch_page` https://ucf-universal-character-foundry.vercel.app → `<title>Universal Character Foundry — Tahap 7</title>`, `assets/index-DALRa_dZ.js`, `assets/index-CtlfJy8b.css` — konten sama dengan `dist/index.html` lokal

---

## 3. GitHub repo (baru dibuat)

- **Repo:** https://github.com/siluman-mati/ucf-universal-character-foundry — `id 1426615554`, public, description `UCF v1.1 Tahap 0-8 — Universal Character Foundry (builder 35 param, 51 bones, 18 modules, retarget, GLB export)`
- **Push:** `git remote add origin https://<PAT>@github.com/siluman-mati/ucf-universal-character-foundry.git` → `git push -u origin master --tags` — **9 tags** (`ucf-tahap-1`..`ucf-tahap-8` + `ucf-tahap-2a`) + `master ffaa55f` sukses
- **Tag `ucf-tahap-8`:** `ffaa55f` — `docs: laporan final Tahap 8 + deploy Vercel (project prj_kR9OTsm, build 997KB gzip273K, tag update)` — mencakup audit `76bafeb` + build `index-DALRa_dZ.js`
- **Deploy via Git:** Vercel Git connect gagal (butuh integrasi GitHub App) — deploy dilakukan via **Vercel CLI + token** (2 deployment: `BE1WbLZ...` dan `79jgr5cql...` produksi). Auto-deploy via Git bisa diaktifkan nanti di dashboard: `Vercel Dashboard → Project → Settings → Git → Connect`.

---

## 4. Kendala & solusi

`vercel__create_deployment` dengan `files: [{file:"index.html", data:"..."}]` melebihi batas payload tool (≤64 KB per call) untuk `dist` 1.13 MB → error `files field should be array`. Solusi yang dipakai: **Vercel CLI prebuilt deploy** dengan `VERCEL_TOKEN` (`vcp_4hAr...`) — upload 4.7 MB, build di `iad1`, alias publik.

---

## 5. Konfigurasi `vercel.json` (di repo)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "installCommand": "npm install --legacy-peer-deps"
}
```

Vite base `./` → assets `assets/index-DALRa_dZ.js` relatif, cocok untuk static hosting tanpa rewrites.

---

## 6. Verifikasi URL publik

```bash
curl -I https://ucf-universal-character-foundry.vercel.app
# HTTP/2 200, content-type text/html, x-vercel-cache MISS, x-vercel-id pdx1::...

curl -s https://ucf-universal-character-foundry.vercel.app | grep -o "<title>.*</title>"
# <title>Universal Character Foundry — Tahap 7</title>

npx vercel curl https://ucf-universal-character-foundry.vercel.app --yes  # bypass not needed after ssoProtection:null
```

Kedua deployment **READY**, log build menampilkan `vite build ✓ 456ms` tanpa error.

---

## 7. Berikutnya & keamanan

- **PAT (ghp_Ejt3...)** dan **VERCEL_TOKEN (vcp_4hAr...)** dipakai untuk buat repo + deploy — **segera rotate** (PAT admin-scoped, sudah 6× disarankan, masih pending). Hapus dari chat history / `.env`.
- Aktifkan Git auto-deploy jika ingin push → deploy otomatis: `https://vercel.com/jhk14/ucf-universal-character-foundry/settings/git`
- Tag `ucf-tahap-8` sudah di `ffaa55f`; tidak perlu update lagi kecuali ada perubahan produksi.

---

## 8. Batasan jujur

- Deployment **bukan** via `git_source` API (Vercel GitHub App belum terpasang) — tapi via CLI dengan token yang sama otorisasinya, hasil build identik.
- Protection awal ON → sekarang OFF (`ssoProtection:null`) — URL publik tanpa login, sesuai harapan Hobby project publik.
