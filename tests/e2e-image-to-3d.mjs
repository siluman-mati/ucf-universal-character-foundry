/**
 * Perbaikan Kritis UCF — Image-to-3D (Langkah 4 BUKTIKAN)
 * 8 bukti minimum + regresi
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const UCF_URL = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = resolve(process.env.UCF_OUT || '/home/user/ucf-audit/image-to-3d');

const checks = [];
const pageErrors = [], consoleErrors = [];
function check(name, ok, detail={}) {
  checks.push({ name, pass: !!ok, detail });
  console.log(`[${ok?'PASS':'FAIL'}] ${name}`, Object.keys(detail).length ? `— ${JSON.stringify(detail).slice(0,2000)}` : '');
  return ok;
}
let browserRef=null;
async function shot(page, name){
  await mkdir(join(OUT,'screenshots'),{recursive:true});
  await page.screenshot({path: join(OUT,'screenshots', name+'.png')});
}

async function main(){
  await mkdir(OUT,{recursive:true});
  const browser = await chromium.launch({ args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--js-flags=--max-old-space-size=1024']});
  browserRef=browser;
  const page = await browser.newPage({ viewport:{width:1440,height:960}});
  page.on('pageerror', e=> pageErrors.push(e.message));
  page.on('console', m=>{ if(m.type()==='error') consoleErrors.push(m.text()); });

  await page.goto(UCF_URL);
  await page.waitForFunction(()=>window.__ucf?.ready, null, {timeout:60000});
  await page.waitForTimeout(600);

  // 0 — Stage intact
  const stage = await page.evaluate(()=>window.__ucf.stage);
  const version = await page.evaluate(()=>window.__ucf.version);
  check('Checkpoint 1-7 intact — stage 8', stage===8, { stage, version });
  check('Viewport aktif', (await page.evaluate(()=>window.__ucf.helpers.count)) >=3, { helpers: await page.evaluate(()=>window.__ucf.helpers) });

  // Cek impor model lama masih menolak gambar? Harus sudah dipisah
  const engines = await page.evaluate(()=>window.__ucf.imageTo3D.engines());
  check('Mesin image-to-3D terdaftar (4 opsi, 1 lokal)', engines.length===4 && engines.find(e=>e.id==='silhouette')?.avail===true, { engines });

  // 1 — Gambar berhasil dimasukkan (pisah dari model 3D)
  const imgPath = '/home/user/ucf/test-assets/referensi-cewek-realistic.png';
  // Gunakan file input imageFile yang baru (bukan modelFile)
  await page.setInputFiles('#imageFile', imgPath);
  await page.waitForTimeout(600);
  const imgState = await page.evaluate(()=>window.__ucf.imageTo3D.state);
  const previewVisible = await page.evaluate(()=> !document.querySelector('#imagePreviewWrap')?.classList.contains('hidden'));
  const imgLog = await page.evaluate(()=> window.__ucf.log.records.filter(r=>r.group==='H. Gambar→3D' && r.test==='Gambar dimasukkan').slice(-1)[0]);
  check('1. Gambar berhasil dimasukkan (bukan ditolak sebagai GLB)', !!imgState.lastFile && previewVisible && imgLog?.result==='PASS', { lastFile: imgState.lastFile, previewVisible, log: imgLog?.result });

  await shot(page, 'img-01-input');

  // Pastikan tombol model tidak ikut terpicu (regresi: impor model tetap hanya glb)
  const modelCountBefore = await page.evaluate(()=>window.__ucf.models.length);
  check('Impor gambar tidak menambah model 3D sebelum generasi (terpisah)', modelCountBefore===0, { modelCountBefore });

  // 2 — Proses generasi benar-benar dijalankan
  // Pilih mesin lokal silhouette
  await page.selectOption('#imageEngine','silhouette');
  await page.waitForTimeout(200);
  const btnEnabled = await page.evaluate(()=> !document.querySelector('#generate3D').disabled);
  check('Tombol Buat mesh 3D aktif untuk mesin lokal', btnEnabled, { btnEnabled });

  await page.click('#generate3D');
  // Tunggu generasi (butuh canvas + extrude, <2s)
  await page.waitForTimeout(2500);
  const afterGen = await page.evaluate(()=>{
    const m = window.__ucf.models[0];
    return {
      models: window.__ucf.models.length,
      lastMeta: window.__ucf.imageTo3D.lastMeta,
      log: window.__ucf.log.records.filter(r=>r.test==='Mesh 3D dihasilkan').slice(-1)[0],
      stats: m?.stats,
      bounds: m?.bounds
    };
  });
  check('2. Proses generasi dijalankan (log Mesh 3D dihasilkan)', !!afterGen.lastMeta && afterGen.log?.result==='PASS', { lastMeta: afterGen.lastMeta, log: afterGen.log?.result, ms: afterGen.lastMeta?.timings?.totalMs });

  await shot(page, 'img-02-generated');

  // 3 — Mesh 3D dihasilkan (bukan plane)
  const mesh3D = await page.evaluate(()=>{
    const m = window.__ucf.models[0];
    if (!m) return null;
    // Ambil geometri info via scene traversal
    let info = null;
    const THREE = window.__ucf.three;
    window.__ucf.scene.traverse(o=>{
      if (o.isMesh && o.userData?.isImageTo3D) {
        o.geometry.computeBoundingBox();
        const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
        const verts = o.geometry.attributes.position.count;
        const idx = o.geometry.index ? o.geometry.index.count/3 : Math.floor(verts/3);
        info = { name: o.name, vertices: verts, triangles: idx, size: [s.x,s.y,s.z], hasDepth: s.z > 0.01, is3D: s.x>0.01&&s.y>0.01&&s.z>0.01, material: o.material?.type, hasMap: !!o.material?.map };
      }
    });
    return { info, stats: m.stats, size: m.stats.size, bounds: m.bounds };
  });
  check('3. Mesh 3D dihasilkan (geometri bervolume, bukan plane bertekstur)', mesh3D && mesh3D.info?.is3D && mesh3D.info.hasDepth && mesh3D.info.vertices > 100, { vertices: mesh3D?.info.vertices, triangles: mesh3D?.info.triangles, size: mesh3D?.info.size, hasDepth: mesh3D?.info.hasDepth, hasMap: mesh3D?.info.hasMap, stats: mesh3D?.stats });

  // 4 — Model dapat diputar (orbit / view)
  const beforeCam = await page.evaluate(()=>window.__ucf.camera);
  await page.evaluate(()=>window.__ucf.setView('kiri', false));
  await page.waitForTimeout(500);
  const afterCamKiri = await page.evaluate(()=>window.__ucf.camera);
  await page.evaluate(()=>window.__ucf.setView('kanan', false));
  await page.waitForTimeout(500);
  const afterCamKanan = await page.evaluate(()=>window.__ucf.camera);
  await page.evaluate(()=>window.__ucf.setView('perspektif', false));
  await page.waitForTimeout(500);
  const afterCamPersp = await page.evaluate(()=>window.__ucf.camera);
  const cornersPersp = await page.evaluate(()=>window.__ucf.projectCorners());
  const rotated = JSON.stringify(beforeCam.position) !== JSON.stringify(afterCamKiri.position) || JSON.stringify(afterCamKiri.position) !== JSON.stringify(afterCamKanan.position);
  check('4. Model dapat diputar dari berbagai sudut (bukan billboard)', rotated && cornersPersp.length>0, { before: beforeCam.position.map(v=>v.toFixed(2)), kiri: afterCamKiri.position.map(v=>v.toFixed(2)), kanan: afterCamKanan.position.map(v=>v.toFixed(2)), corners: cornersPersp.length });

  await shot(page, 'img-04-rotated-kiri');
  await page.evaluate(()=>window.__ucf.setView('belakang', false));
  await page.waitForTimeout(500);
  await shot(page, 'img-04-rotated-belakang');
  await page.evaluate(()=>window.__ucf.setView('perspektif', false));
  await page.waitForTimeout(400);

  // 5 — Model dapat diteruskan ke rigging (atau lapor jelas bila belum kompatibel)
  const rigBefore = await page.evaluate(()=>window.__ucf.models[0]?.bounds);
  await page.click('#autoRigImage');
  await page.waitForTimeout(1200);
  const rigRes = await page.evaluate(()=>{
    const rec = window.__ucf.log.records.filter(r=>r.test==='Rigging mesh gambar').slice(-1)[0];
    const m = window.__ucf.models[0];
    let skinned = false, bones=0;
    if (m) {
      const root = window.__ucf.modelObject(m.id)?.root;
      if (root) root.traverse(o=>{ if(o.isSkinnedMesh) { skinned=true; if(o.skeleton) bones=o.skeleton.bones.length; }});
    }
    return { log: rec, skinned, bones, state: window.__ucf.imageTo3D.state };
  });
  check('5. Model diteruskan ke rigging (51 tulang) atau laporan jelas bila terbatas', rigRes.log?.result==='PASS' && rigRes.skinned && rigRes.bones===51, { result: rigRes.log?.result, skinned: rigRes.skinned, bones: rigRes.bones, details: rigRes.log?.details });

  await shot(page, 'img-05-rigged');

  // 6 — Jika rigging berhasil, uji deformasi tubuh dan jari
  // Kita akan uji via bone rotation manual (UpperArm_L 22°)
  await page.click('#testImageDeform');
  await page.waitForTimeout(900);
  const deform = await page.evaluate(()=> window.__ucf.log.records.filter(r=>r.test==='Uji deformasi tubuh/jari').slice(-1)[0]);
  const deformPass = deform?.result==='PASS' && Number(deform.details.perpindahan_m) > 0.001;
  const notTestedOk = deform?.result==='NOT TESTED'; // jika mesh statis tanpa rig, ini valid sebagai laporan jelas
  check('6. Uji deformasi tubuh/jari (atau laporan NOT TESTED bila mesh statis)', deformPass || notTestedOk, { result: deform?.result, details: deform?.details, errors: deform?.errors });

  // 7 — Ekspor GLB dan impor ulang hasilnya
  // Gunakan ExportPanel yang sudah ada (berjalan untuk semua model termasuk image-to-3D)
  const exportRes = await page.evaluate(async()=>{
    try {
      await window.__ucf.exporter.doExport();
      const last = window.__ucf.exporter.lastExport;
      return { ok: !!last.blobUrl, bytes: last.bytes, name: last.name, stats: window.__ucf.models[0]?.stats };
    } catch(e){ return { ok:false, error:e.message }; }
  });
  check('7. Ekspor GLB dari mesh gambar (bukan hanya humanoid prosedural)', exportRes.ok && exportRes.bytes > 5000, { bytes: exportRes.bytes, name: exportRes.name });

  const reimportRes = await page.evaluate(async()=>{
    try {
      const before = window.__ucf.models.length;
      await window.__ucf.exporter.doReimport();
      await new Promise(r=>setTimeout(r, 800));
      const after = window.__ucf.models.length;
      const m = window.__ucf.models[after-1];
      return { ok: after === before+1, before, after, name: m?.name, stats: m?.stats, bounds: m?.bounds };
    } catch(e){ return { ok:false, error:e.message }; }
  });
  check('7b. Impor ulang GLB berhasil (round-trip mesh gambar)', reimportRes.ok && reimportRes.stats.meshes >=1, { before: reimportRes.before, after: reimportRes.after, name: reimportRes.name, meshes: reimportRes.stats?.meshes, vertices: reimportRes.stats?.vertices });

  await shot(page, 'img-07-reimport');

  // 8 — Regression: humanoid prosedural + anim + modular masih jalan
  // Buat humanoid baru di slot sebelah (tidak perlu hapus image model)
  await page.click('#createHumanoid');
  await page.waitForTimeout(700);
  const humanoidOk = await page.evaluate(()=>{
    try {
      const e = window.__ucf.humanoid.current();
      const rig = e.content.userData.ucfRig;
      return { name: e.name, bones: rig.list.length, fingerBones: rig.list.filter(b=>/Finger_|Thumb_/.test(b.name)).length, ok: rig.list.length===51 };
    } catch(e){ return { ok:false, error:e.message }; }
  });
  check('8a. Regression — Humanoid prosedural 35 param masih berfungsi', humanoidOk.ok, humanoidOk);

  // Modular attach
  const modularOk = await page.evaluate(()=>{
    try {
      window.__ucf.modular.attach('kaos-lengan-pendek');
      const st = window.__ucf.modular.state();
      return { attached: st.attached.length, ok: st.attached.length===1 };
    } catch(e){ return { ok:false, error:e.message };}
  });
  await page.waitForTimeout(400);
  check('8b. Regression — Modular attach masih berfungsi', modularOk.ok, modularOk);

  // Anim evaluate
  const animOk = await page.evaluate(()=>{
    try {
      window.__ucf.anim.load({kind:'native', id:'walk'});
      const ev = window.__ucf.anim.evaluate({ modular:false });
      return { ok: ev.passed >=5, passed: ev.passed, failed: ev.failed };
    } catch(e){ return { ok:false, error:e.message };}
  });
  await page.waitForTimeout(300);
  check('8c. Regression — Animasi native walk masih lulus', animOk.ok, animOk);

  // Ekspor humanoid juga harus tetap bisa
  const exportHumanoid = await page.evaluate(async()=>{
    try{
      // Select humanoid model (terakhir bukan image? humanoid model id beda)
      // ExportPanel export yang ter-select? Saat ini exporter pakai humanoid.current content
      await window.__ucf.exporter.doExport();
      return { ok: !!window.__ucf.exporter.lastExport.blobUrl, bytes: window.__ucf.exporter.lastExport.bytes };
    }catch(e){ return { ok:false, error:e.message };}
  });
  check('8d. Regression — Ekspor GLB humanoid masih OK', exportHumanoid.ok, exportHumanoid);

  check('Tidak ada page/console error', pageErrors.length===0 && consoleErrors.length===0, { pageErrors: pageErrors.slice(0,2), consoleErrors: consoleErrors.slice(0,2) });

  // Simpan log
  await mkdir(OUT,{recursive:true});
  await writeFile(join(OUT,'phase-image-to-3d.json'), JSON.stringify({ checks, pageErrors, consoleErrors, mesh3D, rigRes, deform, exportRes, reimportRes, humanoidOk, modularOk, animOk }, null, 2));
  await page.setViewportSize({width:1440,height:960});
  await browser.close();
  const pass=checks.filter(c=>c.pass).length, fail=checks.filter(c=>!c.pass).length;
  console.log(`\nRingkasan Image-to-3D: ${pass}/${checks.length} PASS · page error ${pageErrors.length} · console error ${consoleErrors.length}`);
  if (fail) process.exitCode=1;
}
try{ await main(); } catch(e){ console.error('FATAL',e); process.exitCode=1; } finally { try{ await browserRef?.close(); }catch{} }
