# Deploy UCF — Laporan Vercel

**Tanggal:** 20 Okt 2026 (Asia/Jakarta) · **Project:** `ucf-universal-character-foundry` · **Team:** `JHK` (`jhk14`) · **Vercel CLI:** 64.7.0

---

## 1. Ringkasan

- **Project ID:** `prj_kR9OTsmBN1l4wPhmp0RmYGVYHojA` — created `2026-10-20T06:xx` via `vercel__create_project`
- **Framework:** `vite` · **Build cmd:** `npm run build` · **Output:** `dist` · **Install:** `npm install --legacy-peer-deps` · **Node:** `24.x` · **Region:** `iad1`
- **Akun:** `mh5832770@gmail.com` (`3x4MnegTfrJ8EelTNy7PuczY`) — team `team_4Crq4DFnsMj6qWX04cAZUrdg` (OWNER, Hobby)
- **Build lokal:** `479ms` · `dist/index.html` 16 KB + `assets/index-DALRa_dZ.js` 997 KB (gzip 273 KB) + `index-CtlfJy8b.css` 18 KB + `FBXLoader` 47 KB + `GLTFExporter` 34 KB — **HTTP 200 OK** di `serve 4173`
- **Status deploy:** **Project created, deployment pending** — `vercel.json` sudah benar (`buildCommand`, `outputDirectory`, `framework`, `installCommand`), `dist/` siap, tapi upload file 1 MB via `vercel__create_deployment` gagal karena payload melebihi batas tool (≤64 KB per call). Vercel API butuh upload bertahap atau via Git.

---

## 2. Yang sudah diverifikasi

- `vercel__list_projects` → project `rig52-studio` ada, `ucf-universal-character-foundry` belum ada → create berhasil
- `vercel__create_project` → `prj_kR9OTsm...` dengan `autoExposeSystemEnvs`, `gitProviderOptions.createDeployments:"disabled"` (default), `buildCommand/outputDirectory` terpasang
- `vercel__list_teams` / `get_authenticated_user` → team `JHK` / user `mh5832770-8749` valid
- `npm run build` lokal PASS, `vercel.json` PASS, `dist/` siap

---

## 3. Kendala deploy file langsung

`vercel__create_deployment` dengan `files: [{file:"index.html", data:"..."}]` memerlukan seluruh isi file sebagai string JSON dalam satu tool call. Untuk `dist` 1.13 MB (JS 997 KB) → melebihi limit 64 KB → error `files field should be array` / payload too large. Solusi Vercel resmi: upload file satu per satu ke `POST /v2/files` (sha), lalu `POST /v13/deployments` referensi sha — atau deploy via Git.

---

## 4. Langkah deploy yang disarankan (pilih satu)

### Opsi A — GitHub + Vercel Git (paling stabil)
```bash
# di lokal /home/user/ucf (git remote belum ada)
gh repo create siluman-mati/ucf-universal-character-foundry --public --source=. --push
# atau manual:
git remote add origin https://<PAT>@github.com/siluman-mati/ucf-universal-character-foundry.git
git push -u origin master --tags

# lalu Vercel akan auto-deploy via Git, atau trigger manual:
# vercel__create_deployment dengan git_source:
{
  "name": "ucf-universal-character-foundry",
  "project": "prj_kR9OTsmBN1l4wPhmp0RmYGVYHojA",
  "git_source": { "type": "github", "ref": "master", "repoId": "<repoId>" }
}
```

### Opsi B — Vercel CLI dengan token
```bash
# minta Vercel token di vercel.com/account/tokens
export VERCEL_TOKEN=vercel_xxx
npx vercel link --project ucf-universal-character-foundry --yes
npx vercel --prod --yes
# URL: https://ucf-universal-character-foundry.vercel.app (atau alias team)
```

### Opsi C — Upload bertahap via API
```bash
# upload tiap file ke /v2/files, kumpulkan sha, lalu create deployment dengan files:[{file, sha}]
curl -X POST https://api.vercel.com/v2/files -H "Authorization: Bearer $VERCEL_TOKEN" --data-binary @dist/index.html
# ulang untuk assets/*, lalu POST /v13/deployments
```

Setelah deploy, cek:
- `curl -I https://ucf-universal-character-foundry.vercel.app` → 200
- `vercel__list_deployments` → state READY, `vercel__get_deployment` → url
- `vercel__get_deployment_events` → build log OK
- Buka di browser + DonMcCurdy viewer: GLB 1 MB tetap valid

---

## 5. Konfigurasi `vercel.json` (sudah di repo)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "installCommand": "npm install --legacy-peer-deps"
}
```

Tidak perlu `rewrites` — Vite base `./` sudah benar untuk static.

---

## 6. Berikutnya

1. User tempel **PAT GitHub admin** (sudah pernah dipakai untuk `rigpro-a0`, belum di-rotate) → buat repo baru, push `ucf` + tag `ucf-tahap-8` (baru di `76bafeb`)
2. Atau tempel **VERCEL_TOKEN** → `npx vercel --prod`
3. Setelah URL publik hidup, update `TAHAP-8-LAPORAN.md` dengan URL, dan tag `ucf-tahap-8` final
4. Rotate PAT setelah selesai (disarankan 6× sebelumnya, masih pending)

---

## 7. Batasan

- Project `ucf-universal-character-foundry` **belum punya deployment** sampai salah satu opsi di atas dijalankan — jangan klaim URL publik sudah live.
- Build lokal dan audit sudah PASS (63/63, 17/17, 13/13) — deploy hanya soal hosting, bukan kualitas build.
