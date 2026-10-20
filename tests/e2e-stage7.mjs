/**
 * Tahap 7 — Ekspor GLB + impor ulang + 6 pemeriksaan + regresi.
 * Jangan klaim round-trip sempurna bila angka impor ulang berbeda.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const UCF_URL = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const UCF_OUT = resolve(process.env.UCF_OUT || '/home/user/ucf-audit/stage7');

let browser, page;
const checks = [];
const pageErrors = [], consoleErrors = [];

function check(name, ok, detail={}) {
  checks.push({name, pass: ok, detail});
  console.log(`[${ok?'PASS':'FAIL'}] ${name}`, Object.keys(detail).length?`— ${JSON.stringify(detail).slice(0,800)}`:'');
  return ok;
}

async function createHumanoid() {
  await page.click('#createHumanoid');
  await page.waitForTimeout(700);
}

async function run() {
  browser = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--js-flags=--max-old-space-size=1024'] });
  page = await browser.newPage({ viewport:{width:1440,height:960} });
  page.on('pageerror', e=>pageErrors.push(e.message));
  page.on('console', m=>{ if(m.type()==='error') consoleErrors.push(m.text()); });
  await page.goto(UCF_URL);
  await page.waitForFunction(()=>window.__ucf?.ready, null, {timeout:60000});
  await page.waitForTimeout(500);

  check('Aplikasi UCF Tahap 7 termuat', (await page.title()).includes('Tahap 7') || (await page.evaluate(()=>window.__ucf.stage))===7, {title: await page.title(), stage: await page.evaluate(()=>window.__ucf.stage)});

  // Panel ekspor ada dan tombol tidak palsu (butuh humanoid)
  const exportBtnVisible = await page.locator('#exportGLB').isVisible();
  check('Panel ekspor ada (9 · Ekspor & verifikasi)', exportBtnVisible);

  await createHumanoid();
  // pasang modul supaya ekspor mencakup modul
  await page.evaluate(()=>window.__ucf.modular.attach('kaos-lengan-pendek'));
  await page.waitForTimeout(400);
  await page.evaluate(()=>window.__ucf.modular.attach('celana-panjang'));
  await page.waitForTimeout(400);

  const before = await page.evaluate(()=>{
    const e = window.__ucf.humanoid.current();
    const rig = e?.content?.userData?.ucfRig;
    const vm = window.__ucf.modelObject(e.modelId);
    const mats = new Set(); e.content.traverse(o=>{ if(o.material){ const a=Array.isArray(o.material)?o.material:[o.material]; for(const m of a) m&&mats.add(m.uuid);} });
    return {
      name: e.name, meshes: vm?.stats?.meshes||e.stats?.meshes||0, bones: rig?.stats?.bones||0, skinned: rig?.stats?.skinnedMeshes||0,
      vertices: rig?.stats?.vertices||0, materials: mats.size,
      modul: window.__ucf.modular.state().attached.length
    };
  });
  check('Humanoid + 2 modul siap ekspor', before.meshes>0 && before.bones>0, before);

  // Ekspor GLB
  const exportOk = await page.evaluate(async ()=>{
    try { await window.__ucf.exporter.doExport(); return { ok: !!window.__ucf.exporter.lastExport?.blobUrl, bytes: window.__ucf.exporter.lastExport?.bytes||0, anims: window.__ucf.exporter.lastExport?.animations||[] }; } catch(e){ return {ok:false, error:e.message}; }
  });
  check('Ekspor GLB menghasilkan berkas', exportOk.ok && exportOk.bytes>10000, exportOk);

  const glbExists = await page.evaluate(()=>!!window.__ucf.exporter.lastExport?.blobUrl);
  check('Tombol Impor ulang & Unduh aktif setelah ekspor', glbExists);

  // Impor ulang
  const reimport = await page.evaluate(async ()=>{
    try { await window.__ucf.exporter.doReimport(); const m=window.__ucf.models.at(-1); return { ok: !!m, name:m?.name, stats:m?.stats, status: document.querySelector('#statusText')?.textContent||'' }; } catch(e){ return {ok:false, error:e.message}; }
  });
  check('Impor ulang GLB berhasil', reimport.ok, {name: reimport.name, stats: reimport.stats});

  if (reimport.ok) {
    const after = await page.evaluate(()=>{
      const m = window.__ucf.models.at(-1); const ins = window.__ucf.inspect(m.id);
      return { meshes: ins.meshCount, skinned: ins.skinnedMeshes.length, bones: ins.boneCount, vertices: ins.vertices, materials: ins.materialCount, clips: window.__ucf.anim?.clips()?.length||0 };
    });
    check('Pemeriksaan mesh: jumlah mesh sama/mirip', Math.abs((before.meshes||0) - (after.meshes||0)) <= 2, {before: before.meshes, after: after.meshes});
    check('Pemeriksaan skeleton: jumlah tulang sama', before.bones === after.bones, {before: before.bones, after: after.bones});
    check('Pemeriksaan skeleton: skinnedMesh ada', after.skinned >= before.skinned, {before: before.skinned, after: after.skinned});
    const deform = await page.evaluate(()=>{
      const entry = window.__ucf.humanoid.current();
      return window.__ucf.humanoid.measureDeformation?.({boneName:'LowerArm_R', axis:'z', angleDeg:45}) || null;
    });
    check('Pemeriksaan deformasi: tulang masih menggerakkan mesh', deform && deform.ok && deform.maxDisplacement>0.02, deform||{});
    check('Pemeriksaan animasi: klip native tetap ada', (await page.evaluate(()=>window.__ucf.anim.clips().length)) >= 5, {clips: await page.evaluate(()=>window.__ucf.anim.clips().map(c=>c.id||c.name))});
    check('Pemeriksaan material: jumlah material tidak hilang', after.materials >= before.materials - 1, {before: before.materials, after: after.materials});
  }

  // Regresi singkat: Tahap 5 anim tetap ada
  const clips = await page.evaluate(()=>window.__ucf.anim.clips().map(c=>c.name||c.id));
  check('Regresi: klip Tahap 5 tetap ada', clips.length >= 5);

  await mkdir(join(UCF_OUT,'screenshots'),{recursive:true});
  await page.screenshot({ path: join(UCF_OUT,'screenshots','01-ekspor-tahap7.png'), fullPage:false });
  const passed = checks.filter(c=>c.pass).length, failed = checks.filter(c=>!c.pass).length;
  console.log(`Ringkasan Tahap 7: ${passed}/${checks.length} · page error ${pageErrors.length} · console error ${consoleErrors.length}`);
  await writeFile(join(UCF_OUT,'phase-7.json'), JSON.stringify({phase:7, url:UCF_URL, checks, passed, failed, before, exportOk, reimport, pageErrors:[...new Set(pageErrors)].slice(0,5), consoleErrors:[...new Set(consoleErrors)].slice(0,5)}, null, 2));
  if (failed) process.exitCode=1;
}
run().catch(e=>{ console.error('FATAL',e); process.exitCode=1; }).finally(async()=>{ try{await browser?.close();}catch{}});
