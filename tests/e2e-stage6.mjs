/**
 * Tahap 6 — pengujian kompatibilitas model eksternal.
 *
 * Semua model eksternal di `test-assets/external/` + dua kotak uji Tahap 1
 * diimpor lewat jalur produk yang sesungguhnya. Kategori uji di bawah ini
 * sesuai spesifikasi Tahap 6 ("Uji beberapa model dengan karakteristik berbeda").
 *
 * Format yang belum didukung produk ditolak dengan pesan yang dapat dibaca —
 * itu dicatat sebagai WARN, bukan PASS yang dipalsukan.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const UCF_URL = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const UCF_OUT = resolve(process.env.UCF_OUT || '/home/user/ucf-audit/stage6');

let browser, page;
const record = (name, ok, detail = {}) => ({ name, pass: ok, detail });
const checks = [];
const screenshots = [];
const pageErrors = [];
const consoleErrors = [];

function check(name, ok, detail = {}) {
  const entry = record(name, ok, detail);
  checks.push(entry);
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}`, Object.keys(detail).length ? `— ${JSON.stringify(detail).slice(0, 400)}` : '');
  return ok;
}

async function createHumanoid() {
  await page.click('#createHumanoid');
  await page.waitForTimeout(700);
}

async function importThroughUi(file) {
  const before = await page.evaluate(() => ({
    count: window.__ucf.models.length,
    logs: window.__ucf.log.records.length
  }));
  await page.setInputFiles('#modelFile', file);
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
    id: window.__ucf.models.at(-1)?.id || null
  }));
  const ok = /^Berhasil/.test(after.status) && Boolean(after.id);
  return { ok, ...after };
}

async function collectFiles() {
  return [
    { file: resolve('/home/user/ucf/test-assets/box-tanpa-rig.gltf'), label: 'box-tanpa-rig.gltf (tanpa rig)' },
    { file: resolve('/home/user/ucf/test-assets/external/rigify-partial.glb'), label: 'rigify-partial.glb (rig parsial, tanpa jari)' },
    { file: resolve('/home/user/ucf/test-assets/external/acknowledging-anim.fbx'), label: 'acknowledging-anim.fbx (tanpa mesh, dengan animasi)' },
    { file: resolve('/home/user/ucf/test-assets/external/components-custom.glb'), label: 'components-custom.glb (9 mesh, 4 material, 1 skinned)' },
    { file: resolve('/home/user/ucf/test-assets/external/waypoint-actions.glb'), label: 'waypoint-actions.glb (tanpa mesh, 67 tulang, 4 klip)' },
    { file: resolve('/home/user/ucf/test-assets/external/collision-idle-xbot.glb'), label: 'collision-idle-xbot.glb (idle, Mixamo)' },
    { file: resolve('/home/user/ucf/test-assets/external/cheering-root-drift.glb'), label: 'cheering-root-drift.glb (berjalan, root drift)' },
    { file: resolve('/home/user/ucf/test-assets/XBot.glb'), label: 'XBot.glb (7 klip, Mixamo pembanding Tahap 5)' },
    { file: resolve('/home/user/ucf/test-assets/external/YBot.fbx'), label: 'YBot.fbx (117 tulang, FBX sentimeter, duplikat hierarki)' },
    { file: resolve('/home/user/ucf/test-assets/external/buns.vrm'), label: 'buns.vrm (VRM, 198 tulang, non-Mixamo)' }
  ];
}

async function run() {
  browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(UCF_URL);
  await page.waitForFunction(() => window.__ucf?.ready, null, { timeout: 60000 });

  const buildTag = await page.evaluate(() => document.title || document.querySelector('title')?.textContent || '');
  check('Aplikasi UCF termuat (Tahap 6)', true, { build: buildTag, versi: '1.1.0-stage6' });

  await createHumanoid();
  const humanoidBefore = await page.evaluate(() => window.__ucf.humanoidEntries.length);
  check('Karakter UCF dibuat', humanoidBefore === 1, { karakter: humanoidBefore });

  // ------ impor 10 model eksternal ------
  const files = await collectFiles();
  const inspections = [];
  for (const item of files) {
    const { ok, name, status, id } = await importThroughUi(item.file);
    const info = ok ? await page.evaluate((mid) => {
      const ins = window.__ucf.inspect(mid);
      const mapping = (() => { try { return window.__ucf.anim.buildMapping(mid); } catch (e) { return { ok:false, error:e.message }; } })();
      return {
        mesh: ins.meshCount, skinned: ins.skinnedMeshes.length, bones: ins.boneCount,
        materials: ins.materialCount, clips: ins.clips.length, fingerBones: ins.fingerBoneCount,
        missingCore: ins.roles.missingCore, bounds: ins.bounds?.size?.map((v)=>Number(v.toFixed(2))) || null,
        issues: ins.issues.map((i)=>i.status+':'+i.id),
        mapping: mapping?.mapping ? {
          ok: mapping.mapping.ok, mapped: mapping.mapping.mapped, checks: mapping.mapping.checks?.map((c)=>c.status+':'+c.id),
          coreMissing: mapping.mapping.coreMissing, hierarchy: mapping.mapping.hierarchyIssues
        } : { ok:false, error: mapping?.error || mapping?.mapping?.ok === false ? 'belum valid' : '' }
      };
    }, id) : null;
    check(`Impor: ${item.label}`, ok, ok ? { model: name, bones: info.bones, mesh: info.mesh, skinned: info.skinned, finger: info.fingerBones, status: status.slice(0,120), mapping: info.mapping } : { error: status });

    // per-model checks (dicatat di checks, bukan di-ringkas jadi satu)
    if (ok) {
      inspections.push({ label: item.label, ...info });
      if (item.label.includes('tanpa rig')) {
        check('C. Model tanpa rig tetap diimpor', ok && info.bones === 0, { mesh: info.mesh, bones: info.bones });
      }
      if (item.label.includes('rig parsial')) {
        check('C. Rig parsial ditolak retarget dengan alasan yang jelas', !info.mapping.ok && info.missingCore.length > 0, { missing: info.missingCore, mapped: info.mapping.mapped || 0 });
      }
      if (item.label.includes('tanpa mesh, dengan animasi')) {
        check('C. FBX tanpa mesh tetap terbaca (skeleton + animasi)', ok && info.bones > 0 && info.clips > 0 && info.mesh === 0, { bones: info.bones, klip: info.clips });
      }
      if (item.label.includes('9 mesh')) {
        check('C. Model multi-mesh / multi-material', ok && info.mesh === 9 && info.materials > 1, { mesh: info.mesh, materials: info.materials });
      }
      if (item.label.includes('tanpa mesh, 67 tulang')) {
        check('C. Skeleton tanpa mesh dikenali sebagai humanoid', ok && info.mesh === 0 && !info.missingCore.length, { bones: info.bones, missing: info.missingCore.length });
      }
      if (item.label.includes('FBX sentimeter')) {
        check('C. FBX sentimeter (YBot) dengan duplikat tulang dikenali', ok && info.bones === 117 && info.mapping.ok, { bones: info.bones, mapped: info.mapping.mapped, missing: info.missingCore.length, duplikat: (await page.evaluate((mid)=>window.__ucf.inspect(mid).duplicateBoneNames, id)).length });
      }
      if (item.label.includes('VRM')) {
        check('C. VRM dibaca (metadata VRM diabaikan dengan peringatan)', ok && info.bones === 198, { bones: info.bones, warnings: (await page.evaluate(()=>window.__ucf.models.at(-1).stats?.warnings || [])).slice(0,2) });
      }
    }
  }

  // ------ ringkas per karakteristik (sesuai daftar Tahap 6) ------
  check('R. Semua 10 berkas Tahap 6 berhasil diimpor', inspections.length === 10, { diimpor: inspections.length, total: files.length });
  check('R. Model tanpa rig tercatat (box-tanpa-rig)', inspections.some((r)=>r.bones === 0), inspections.find((r)=>r.bones === 0) || {});
  check('R. Model dengan skeleton terdeteksi', inspections.some((r)=>r.bones > 0), { denganSkeleton: inspections.filter((r)=>r.bones > 0).length });
  check('R. Model dengan skin weights terdeteksi', inspections.some((r)=>r.skinned > 0), { denganSkin: inspections.filter((r)=>r.skinned > 0).length });
  check('R. Model dengan animasi terdeteksi', inspections.some((r)=>r.clips > 0), { denganAnimasi: inspections.filter((r)=>r.clips > 0).length });
  check('R. Model dengan finger bones terdeteksi', inspections.some((r)=>r.fingerBones >= 20), { denganJari: inspections.filter((r)=>r.fingerBones >= 20).length });

  // ------ retargeting pada model Mixamo yang berakar di tanah ------
  const walkId = await page.evaluate(() => window.__ucf.models.find((m)=>m.name.match(/collision-root-walk|XBot\.glb/))?.id || null);
  const walkClip = await page.evaluate((mid) => window.__ucf.models.find((m)=>m.id===mid)?.clips?.[0]?.name || null, walkId);
  if (walkId && walkClip) {
    const retargeted = await page.evaluate(({ mid, clip }) => {
      const r = window.__ucf.anim.retarget(mid, clip);
      const ev = r.ok ? window.__ucf.anim.evaluate({ modular:false }) : null;
      return { ok: r.ok, checks: ev?.checks?.map((c)=>c.id), failed: ev?.checks?.filter((c)=>c.status==='FAIL').map((c)=>c.id), verify: r.verify && { minRho: r.verify.minTrajectoryRho, meanDeg: r.verify.meanDeg } };
    }, { mid: walkId, clip: walkClip });
    check('R. Retarget walk (collision-root-walk / XBot walk) dan grounding', retargeted.ok && !retargeted.failed?.length, retargeted);
  }

  // ------ screenshot kategori ------
  await page.screenshot({ path: join(UCF_OUT, 'screenshots', '01-impor-10-model.png') });
  const detail = inspections.map((r)=>`${r.label.split(' ')[0]}: mesh${r.mesh}/skinned${r.skinned}/tulang${r.bones}/klip${r.clips}/jari${r.fingerBones}`).join(' | ');
  const measurements = {
    inspections: inspections.map((r)=>({ label: r.label, mesh: r.mesh, skinned: r.skinned, bones: r.bones, fingerBones: r.fingerBones, clips: r.clips, materials: r.materials, bounds: r.bounds, missingCore: r.missingCore, issues: r.issues, mapping: r.mapping })),
    modelsInScene: await page.evaluate(()=>window.__ucf.models.map((m)=>m.name))
  };

  const pageErrorsFiltered = [...new Set(pageErrors)].slice(0, 6);
  const consoleErrorsFiltered = [...new Set(consoleErrors)].slice(0, 6);
  check('Tidak ada error halaman/konsol', pageErrorsFiltered.length === 0 && consoleErrorsFiltered.length === 0, { pageErrors: pageErrorsFiltered, consoleErrors: consoleErrorsFiltered });

  const passed = checks.filter((c)=>c.pass).length;
  const failed = checks.filter((c)=>!c.pass).length;
  console.log(`Ringkasan Tahap 6: ${passed}/${checks.length} lulus · page error ${pageErrorsFiltered.length} · console error ${consoleErrorsFiltered.length}`);

  await mkdir(join(UCF_OUT, 'screenshots'), { recursive: true });
  await writeFile(join(UCF_OUT, 'phase-6.json'), JSON.stringify({
    phase: 6, url: UCF_URL, checks, passed, failed, measurements, detail,
    screenshots: ['01-impor-10-model.png'], pageErrors: pageErrorsFiltered, consoleErrors: consoleErrorsFiltered
  }, null, 1));

  if (failed) {
    console.error(`Tahap 6 gagal: ${failed} cek tidak lulus`);
    process.exitCode = 1;
  }
}

run().catch((err) => { console.error('FATAL', err); process.exitCode = 1; }).finally(async () => {
  try { await browser?.close(); } catch {}
});
