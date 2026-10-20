/**
 * UCF Tahap 6 — audit model eksternal.
 *
 * Menguji model dengan karakteristik berbeda lewat jalur impor produk yang sebenarnya,
 * lalu menyidik isi berkas (mesh, skin, tulang, jari, animasi, material) dan mencatat
 * masalah khusus tiap model. Tidak ada klaim sebelum diukur.
 *
 * Format yang belum didukung produk (FBX/VRM) tetap dicatat: pesan penolakannya diuji,
 * dan statusnya BLOCKED/NOT TESTED — bukan dianggap lulus.
 */
import { chromium } from 'playwright';
import { mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit/stage6');
const ASSETS = process.env.UCF_ASSETS || resolve('/home/user/ucf/test-assets/external');
const EXTRA = [
  { file: resolve('/home/user/ucf/test-assets/box-tanpa-rig.gltf'), label: 'kotak tanpa rig (Tahap 1)' },
  { file: resolve('/home/user/ucf/test-assets/XBot.glb'), label: 'XBot Mixamo (pembanding Tahap 5)' }
];

const results = {
  phase: '6',
  startedAt: new Date().toISOString(),
  url: BASE,
  models: [],
  summary: {},
  consoleErrors: [],
  pageErrors: []
};

const fmt = (value, digits = 3) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : value);

async function collectFiles() {
  const list = [];
  for (const entry of await readdir(ASSETS)) {
    if (!/\.(glb|gltf|vrm|fbx)$/i.test(entry)) continue;
    list.push({ file: join(ASSETS, entry), label: entry });
  }
  for (const extra of EXTRA) {
    try { await stat(extra.file); list.push(extra); } catch { /* tidak ada */ }
  }
  return list.sort((a, b) => a.label.localeCompare(b.label));
}

async function importThroughUi(page, file) {
  const before = await page.evaluate(() => ({
    count: window.__ucf.models.length,
    logs: window.__ucf.log.records.length
  }));
  await page.setInputFiles('#modelFile', file);
  // impor selesai bila model bertambah atau log validasi bertambah (catatan impor/gagal)
  await page.waitForFunction(
    (state) => window.__ucf.models.length > state.count || window.__ucf.log.records.length > state.logs,
    before,
    { timeout: 120000 }
  ).catch(() => null);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    count: window.__ucf.models.length,
    status: document.querySelector('#statusText')?.textContent?.trim() || '',
    report: window.__ucf.models.at(-1)?.stats || null,
    name: window.__ucf.models.at(-1)?.name || null,
    id: window.__ucf.models.at(-1)?.id || null,
    logTail: window.__ucf.log.records.slice(-3).map((record) => ({ test: record.test, result: record.result, details: record.details, errors: record.errors }))
  }));
  const ok = /^Berhasil/.test(after.status) && Boolean(after.id);
  return { ok, ...after };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  const files = await collectFiles();
  console.log(`Audit ${files.length} berkas`);

  for (const item of files) {
    // Halaman baru per model: memori Chromium terbatas (sandbox ~2 GB) dan model
    // bertekstur besar tidak boleh menumpuk, kalau tidak halaman bisa kehabisan memori.
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', (error) => results.pageErrors.push(`${item.label}: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push(`${item.label}: ${message.text()}`); });
    await page.goto(BASE);
    await page.waitForFunction(() => window.__ucf?.ready);
    // Karakter UCF wajib ada supaya pemetaan & retarget tiap model dapat diukur.
    await page.click('#createHumanoid');
    await page.waitForTimeout(600);
    // model dibiarkan menumpuk; inspect memakai id model yang baru diimpor
    const imported = await importThroughUi(page, item.file);
    const entry = { label: item.label, file: item.file.split('/').slice(-2).join('/'), imported: imported.ok };
    if (imported.ok) {
      const inspection = await page.evaluate((id) => window.__ucf.inspect(id), imported.id);
      const mapping = await page.evaluate((id) => {
        const result = window.__ucf.anim.buildMapping(id);
        if (!result?.mapping) return { ok: false, error: result?.error || 'tidak dapat dipetakan' };
        const map = result.mapping;
        return {
          ok: map.ok,
          mapped: map.mapped,
          sourceBones: map.sourceBones,
          coreMissing: map.coreMissing,
          hierarchy: map.hierarchyIssues,
          conflictsWorld: map.conflictsWorldSide,
          maxRelativeRest: map.maxRelativeRestDeviationDeg,
          nameOnly: map.nameOnlyPairs,
          checks: (map.checks || []).map((check) => `${check.status}:${check.id}`)
        };
      }, imported.id);
      entry.inspection = inspection;
      entry.mapping = mapping;
      entry.stats = imported.report;
      entry.statusText = imported.status;
      entry.warnings = imported.report?.warnings || [];

      // Animasi milik model sendiri: putar klip pertama, ukur perpindahan verteks.
      if (inspection.clips.length) {
        entry.ownAnimation = await page.evaluate(async ({ id, clipName }) => {
          const THREE = window.__ucf.three;
          const model = window.__ucf.modelObject(id);
          const clipId = clipName;
          const loaded = window.__ucf.anim.load('model', clipId, id);
          if (!loaded?.ok) return { ok: false, error: loaded?.error };
          const capture = () => {
            const points = [];
            const vector = new THREE.Vector3();
            model.root.updateMatrixWorld(true);
            model.root.traverse((mesh) => {
              if (!mesh.isMesh) return;
              const position = mesh.geometry?.getAttribute('position');
              if (!position) return;
              const step = Math.max(1, Math.floor(position.count / 80));
              for (let i = 0; i < position.count; i += step) {
                mesh.getVertexPosition(i, vector);
                vector.applyMatrix4(mesh.matrixWorld);
                points.push(vector.x, vector.y, vector.z);
              }
            });
            return points;
          };
          window.__ucf.anim.seek(0);
          await new Promise((resolve) => setTimeout(resolve, 120));
          const first = capture();
          window.__ucf.anim.seek((window.__ucf.anim.state().duration || 1) * 0.5);
          await new Promise((resolve) => setTimeout(resolve, 250));
          const later = capture();
          let max = 0;
          let moved = 0;
          for (let i = 0; i < Math.min(first.length, later.length); i += 3) {
            const d = Math.hypot(first[i] - later[i], first[i + 1] - later[i + 1], first[i + 2] - later[i + 2]);
            if (d > 0.002) moved += 1;
            if (d > max) max = d;
          }
          window.__ucf.anim.reset();
          return { ok: true, samples: Math.floor(first.length / 3), moved, maxMove: Number(max.toFixed(4)) };
        }, { id: imported.id, clipName: inspection.clips[0].name });
      }

      // Retarget klip pertama ke karakter UCF bila pemetaan valid.
      if (inspection.clips.length && mapping.ok) {
        entry.retarget = await page.evaluate(async ({ id, clipName }) => {
          const result = window.__ucf.anim.retarget(id, clipName);
          if (!result?.ok) return { ok: false, error: result?.error };
          const evaluation = window.__ucf.anim.evaluate({ modular: false });
          return {
            ok: true,
            ground: result.report?.ground,
            verify: result.verify && {
              meanDeg: result.verify.meanDeg,
              worstDeg: result.verify.worstDeg,
              minTrajectoryRho: result.verify.minTrajectoryRho
            },
            evaluation: evaluation && {
              passed: evaluation.passed,
              failed: evaluation.failed,
              fails: (evaluation.checks || []).filter((check) => check.status === 'FAIL').map((check) => check.id)
            }
          };
        }, { id: imported.id, clipName: inspection.clips[0].name });
      }
      // ringkas untuk tabel
      entry.ringkas = {
        mesh: inspection.meshCount,
        verteks: inspection.vertices,
        tulang: inspection.boneCount,
        skinned: inspection.skinnedMeshes.length,
        jari: inspection.fingerBoneCount,
        material: inspection.materialCount,
        tekstur: inspection.textureCount,
        klip: inspection.clips.length,
        peranIntiHilang: inspection.roles.missingCore.length,
        issues: inspection.issues.map((issue) => `${issue.status}:${issue.id}`)
      };
    } else {
      entry.statusText = imported.status;
      entry.error = imported.logTail?.find((record) => record.result !== 'PASS')?.errors?.[0] || imported.status;
      entry.ringkas = { issues: ['BLOCKED:format'] };
    }
    results.models.push(entry);
    console.log(`- ${item.label}: ${imported.ok ? `mesh ${entry.ringkas.mesh}, tulang ${entry.ringkas.tulang}, klip ${entry.ringkas.klip}` : `DITOLAK — ${entry.error}`}`);
    await page.close();
  }

  await browser.close();

  // ringkasan kategori yang diminta Tahap 6
  const models = results.models;
  const by = (predicate) => models.filter(predicate).map((model) => model.label);
  results.summary = {
    totalBerkas: models.length,
    berhasilDiimpor: models.filter((model) => model.imported).length,
    tanpaRig: by((model) => model.imported && model.inspection.boneCount === 0),
    denganSkeleton: by((model) => model.imported && model.inspection.boneCount > 0),
    denganSkinWeights: by((model) => model.imported && model.inspection.skinnedMeshes.length > 0),
    denganAnimasi: by((model) => model.imported && model.inspection.clips.length > 0),
    denganFingerBones: by((model) => model.imported && model.inspection.fingerBoneCount >= 20),
    multiMesh: by((model) => model.imported && model.inspection.meshCount > 1),
    multiMaterial: by((model) => model.imported && model.inspection.materialCount > 1),
    humanoidDikenali: by((model) => model.imported && model.inspection.roles.missingCore.length === 0),
    ditolak: models.filter((model) => !model.imported).map((model) => ({ label: model.label, pesan: model.error }))
  };

  results.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'audit.json'), JSON.stringify(results, null, 2));
  console.log('\n=== RINGKASAN ===');
  console.log(JSON.stringify(results.summary, null, 1));
  console.log(`\nDitulis: ${join(OUT, 'audit.json')}`);
  if (results.pageErrors.length) console.log('pageErrors:', results.pageErrors.slice(0, 3));
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exitCode = 1;
});
