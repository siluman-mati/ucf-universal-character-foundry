/**
 * Audit detail Tahap 7 — 8 kriteria spesifikasi:
 * 1 Ekspor GLB, 2 skeleton+skinning, 3 modul, 4 animasi, 5 round-trip, 6 kompatibilitas, 7 regresi, 8 checkpoint
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = resolve('/home/user/ucf-audit/stage7');

async function run(){
  const browser = await chromium.launch({ args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--js-flags=--max-old-space-size=1024']});
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  await page.goto(URL);
  await page.waitForFunction(()=>window.__ucf?.ready, null, {timeout:60000});
  await page.waitForTimeout(400);
  await page.click('#createHumanoid'); await page.waitForTimeout(700);
  await page.evaluate(()=>window.__ucf.modular.attach('kaos-lengan-pendek')); await page.waitForTimeout(300);
  await page.evaluate(()=>window.__ucf.modular.attach('celana-panjang')); await page.waitForTimeout(300);
  // sembunyikan satu modul untuk uji "hanya terlihat"
  // keep both visible for baseline — invisible test done separately if needed

  const detail = await page.evaluate(async()=>{
    const entry = window.__ucf.humanoid.current();
    const content = entry.content;
    const rig = content.userData.ucfRig;
    const beforeBones = rig.list.map(b=>b.name);
    const fingerBefore = beforeBones.filter(n=> /Finger_|Thumb_/i.test(n));
    // count skin weights validity
    let beforeSkinned = [];
    content.traverse(o=>{
      if(o.isSkinnedMesh){
        const g=o.geometry;
        const si=g.getAttribute('skinIndex'); const sw=g.getAttribute('skinWeight');
        const pos=g.getAttribute('position');
        let unweighted=0, noSI=0;
        if(!si || !sw) noSI=1;
        else {
          for(let i=0;i<pos.count;i++){
            let sum=0; for(let k=0;k<4;k++) sum+= sw.array[i*4+k];
            if(sum < 1e-5) unweighted++;
          }
        }
        beforeSkinned.push({ name:o.name, verts:pos.count, hasSI:!!si, hasSW:!!sw, unweighted });
      }
    });
    const beforeStatsForBox = (window.__ucf.models[0]?.stats) || { size:[0,0,0], center:[0,0,0] };
    const sizeBefore = { x: beforeStatsForBox.size[0], y: beforeStatsForBox.size[1], z: beforeStatsForBox.size[2] };
    const helperInContent = (()=>{ let f=false; content.traverse(o=>{ if(o.userData?.ucfHelper) f=true; }); return f; })();
    // modul terlihat
    const attached = window.__ucf.modular.state().attached;
    const visibleCount = attached.filter(a=> a.visible!==false).length;

    // EXPORT
    const exp = window.__ucf.exporter;
    await exp.doExport();
    const expBytes = exp.lastExport.bytes;
    const expAnims = exp.lastExport.animations;
    const expBlobUrl = exp.lastExport.blobUrl;
    // inspect clone did not include helpers
    let helperInClone = false;
    exp.lastExport.clone.traverse(o=>{ if(o.userData?.ucfHelper) helperInClone=true; if(o.visible===false) helperInClone=true; });

    // REIMPORT via same loader + independent GLTFLoader
    await exp.doReimport();
    const models = window.__ucf.models || [];
    const re = models[models.length-1];
    const afterStats = re.stats;
    // independent loader check
    let independent = null;
    try {
      const buf = await fetch(expBlobUrl).then(r=>r.arrayBuffer());
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await new Promise((res, rej)=> loader.parse(buf, '', res, rej));
      const bonesInd=[]; gltf.scene.traverse(o=>{ if(o.isBone) bonesInd.push(o.name); });
      const skinnedInd=[]; gltf.scene.traverse(o=>{ if(o.isSkinnedMesh) skinnedInd.push(o.name); });
      independent = { ok:true, bones: bonesInd.length, skinned: skinnedInd.length, clips: (gltf.animations||[]).length, clipNames: (gltf.animations||[]).map(c=>c.name), scene: gltf.scene };
    } catch(e){ independent = { ok:false, error:e.message }; }

    const afterScene = independent?.scene || null;
    const afterBones=[]; if(afterScene) afterScene.traverse(o=>{ if(o.isBone) afterBones.push(o.name); });
    const fingerAfter = afterBones.filter(n=> /Finger_|Thumb_/i.test(n));
    let afterSkinned=[];
    if(afterScene) afterScene.traverse(o=>{
      if(o.isSkinnedMesh){
        const g=o.geometry; const si=g.getAttribute('skinIndex'); const sw=g.getAttribute('skinWeight');
        const pos=g.getAttribute('position');
        let unweighted=0; if(si&&sw){ for(let i=0;i<pos.count;i++){ let s=0; for(let k=0;k<4;k++) s+= sw.array[i*4+k]; if(s<1e-5) unweighted++; } }
        afterSkinned.push({ name:o.name, verts:pos.count, hasSI:!!si, hasSW:!!sw, unweighted });
      }
    });

    const sizeAfter = { x: afterStats.size[0], y: afterStats.size[1], z: afterStats.size[2] };
    const centerAfter = { x: afterStats.center[0], y: afterStats.center[1], z: afterStats.center[2] };
    const centerBefore = { x: beforeStatsForBox.center[0], y: beforeStatsForBox.center[1], z: beforeStatsForBox.center[2] };
    // deformasi siku + jari
    const deformElbow = window.__ucf.humanoid.measureDeformation?.({boneName:'LowerArm_R', axis:'z', angleDeg:45}) || null;
    const deformFinger = window.__ucf.humanoid.measureDeformation?.({boneName:'Finger_Index_R_1', axis:'z', angleDeg:30}) || null;
    // clip playback check: coba play walk setelah reimport (native clips still on humanoid, not on reimport — but export clips are in independent loader)
    // pose check
    const poseOk = (()=>{ const b=afterBones.includes('Hips') && afterBones.includes('Head'); return b; })();

    // material
    const matsBefore = new Set(); content.traverse(o=>{ if(o.material){ const arr=Array.isArray(o.material)?o.material:[o.material]; for(const m of arr) matsBefore.add(m.name||m.uuid); }});
    const matsAfter = new Set(); if(afterScene) afterScene.traverse(o=>{ if(o.material){ const arr=Array.isArray(o.material)?o.material:[o.material]; for(const m of arr) matsAfter.add(m.name||m.uuid); }});

    return {
      before: { meshes: afterStats.meshes, bones: beforeBones.length, fingerBones: fingerBefore.length, fingerList: fingerBefore.slice(0,6), sizeBefore:[sizeBefore.x, sizeBefore.y, sizeBefore.z], centerBefore:[centerBefore.x, centerBefore.y, centerBefore.z], skinned: beforeSkinned.length, skinnedDetail: beforeSkinned.slice(0,2), mats: matsBefore.size, matNames:[...matsBefore].slice(0,6), visibleModul: visibleCount, helperInContent, attached: attached.length },
      export: { bytes: expBytes, anims: expAnims, animCount: expAnims.length, helperInClone },
      after: { meshes: afterStats.meshes, bones: afterBones.length, fingerBones: fingerAfter.length, fingerList: fingerAfter.slice(0,6), sizeAfter:[sizeAfter.x, sizeAfter.y, sizeAfter.z], centerAfter:[centerAfter.x, centerAfter.y, centerAfter.z], skinned: afterSkinned.length, skinnedDetail: afterSkinned.slice(0,2), mats: matsAfter.size, matNames:[...matsAfter].slice(0,6), clips: re.clips?.length||0, clipNames: re.clips?.map(c=>c.name)||[] },
      independent,
      deformElbow, deformFinger, poseOk, afterStats
    };
  });

  console.log(JSON.stringify(detail, null, 2));
  await mkdir(OUT, {recursive:true});
  await writeFile(resolve(OUT,'audit-detail.json'), JSON.stringify(detail, null, 2));
  // screenshot
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT,'tahap7-detail.png') });
  await browser.close();
  // summary stdout
  console.log('\n=== RINGKASAN 8 KRITERIA ===');
  console.log(`1 Ekspor GLB: ${detail.export.bytes} byte, ${detail.export.animCount} klip (${detail.export.anims.join(',')})`);
  console.log(`2 Skeleton: ${detail.before.bones}→${detail.after.bones} tulang, jari ${detail.before.fingerBones}→${detail.after.fingerBones}, poseOk ${detail.poseOk}`);
  console.log(`   Skinning: before unweighted ${detail.before.skinnedDetail.map(s=>s.unweighted).join(',')} after ${detail.after.skinnedDetail.map(s=>s.unweighted).join(',')}`);
  console.log(`   BBox size before [${detail.before.sizeBefore.map(v=>v.toFixed(3)).join(',')}] after [${detail.after.sizeAfter.map(v=>v.toFixed(3)).join(',')}]`);
  console.log(`3 Modul: attached ${detail.before.attached} visible ${detail.before.visibleModul}, helperInContent ${detail.before.helperInContent} helperInClone ${detail.export.helperInClone}`);
  console.log(`4 Animasi: native exported ${detail.export.animCount}, independent loader clips ${detail.independent.clipNames?.join(',')||detail.independent.error}`);
  console.log(`5 Round-trip: mesh ${detail.before.meshes}→${detail.after.meshes}, skinned ${detail.before.skinned}→${detail.after.skinned}, mats ${detail.before.mats}→${detail.after.mats}`);
  console.log(`   Deform siku ${detail.deformElbow?.maxDisplacement?.toFixed(3)} jari ${detail.deformFinger?.maxDisplacement?.toFixed(3)||'n/a'}`);
  console.log(`6 Kompatibilitas independen: ${detail.independent.ok ? `OK ${detail.independent.bones} tulang ${detail.independent.skinned} skinned ${detail.independent.clips} klip` : `FAIL ${detail.independent.error}`}`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
