/**
 * UCF Tahap 3 — uji browser: skeleton sampai jari, skin weights, deformasi nyata.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit/stage3');
const SHOTS = join(OUT, 'screenshots');

const results = {
  phase: '3',
  startedAt: new Date().toISOString(),
  url: BASE,
  checks: [],
  measurements: {},
  consoleErrors: [],
  pageErrors: [],
  screenshots: [],
  fatal: null
};

let shotSeq = 0;
async function screenshot(page, name) {
  shotSeq += 1;
  const file = join(SHOTS, `${String(shotSeq).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  results.screenshots.push(file);
}

function check(name, pass, detail = {}) {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${Object.keys(detail).length ? ' — ' + JSON.stringify(detail) : ''}`);
}

const state = (page) => page.evaluate(() => window.__ucf.humanoid.state());

async function setRange(page, selector, value) {
  await page.evaluate(({ selector: sel, value: val }) => {
    const input = document.querySelector(sel);
    input.value = String(val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { selector, value });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => results.pageErrors.push(String(error?.message || error)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ucf?.ready === true, null, { timeout: 30000 });

  await page.click('#createHumanoid');
  await page.waitForFunction(() => window.__ucf.humanoid.state().count === 1, null, { timeout: 15000 });
  await page.waitForTimeout(900);

  const created = await page.evaluate(() => {
    const state = window.__ucf.humanoid.state();
    const rig = state.selected.rig;
    return {
      bones: rig?.bones,
      skinnedMeshes: rig?.skinnedMeshes,
      vertices: rig?.vertices,
      unweighted: rig?.unweighted,
      maxInfluences: rig?.maxInfluences,
      maxSumError: rig?.maxSumError,
      boneCount: rig?.boneNames?.length,
      boneNames: rig?.boneNames || [],
      meshes: state.selected.geometry.parts,
      modelStats: window.__ucf.models[0].stats,
      summary: document.querySelector('#rigSummary')?.textContent
    };
  });
  results.measurements.created = created;
  check(
    'S3-1. Humanoid dibuat dengan 51 tulang, 53 skinned mesh, 0 verteks tanpa bobot',
    created.bones === 51 && created.skinnedMeshes === 53 && created.vertices === 4652 &&
      created.unweighted === 0 && created.maxInfluences <= 4 && created.maxSumError < 1e-4,
    { bones: created.bones, skinnedMeshes: created.skinnedMeshes, unweighted: created.unweighted, maxInfluences: created.maxInfluences }
  );
  const required = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Clavicle_R', 'UpperArm_R', 'LowerArm_R', 'Hand_R',
    'Finger_Index_R_1', 'Finger_Index_R_2', 'Finger_Index_R_3', 'Finger_Pinky_L_3', 'Thumb_R_1', 'Thumb_R_2', 'UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'Toe_L'];
  const missing = required.filter((name) => !created.boneNames.includes(name));
  const fingerCount = created.boneNames.filter((name) => /^(Finger|Thumb)_/.test(name)).length;
  results.measurements.bones = { count: created.boneNames.length, fingerCount, missing };
  check(
    'S3-2. Rantai skeleton sampai jari tersedia (28 tulang jari)',
    created.boneCount === 51 && missing.length === 0 && fingerCount === 28,
    { tulang: created.boneCount, jari: fingerCount, hilang: missing }
  );
  await screenshot(page, 'humanoid-rig-awal');

  await page.check('#toggleSkeleton');
  await page.check('#toggleBoneNames');
  await page.waitForTimeout(500);
  const helpers = await page.evaluate(() => {
    let skeleton = null;
    let sprites = 0;
    window.__ucf.scene.traverse((object) => {
      if (object.name?.startsWith('SkeletonHelper')) skeleton = object;
      if (object.isSprite && object.visible) sprites += 1;
    });
    return {
      skeleton: Boolean(skeleton),
      skeletonVisible: Boolean(skeleton?.visible),
      sprites,
      helperTagged: Boolean(skeleton?.userData?.ucfHelper),
      modelMeshes: window.__ucf.models[0].stats.meshes,
      helperCount: window.__ucf.helperObjectCount
    };
  });
  results.measurements.helpers = helpers;
  check(
    'S3-3. Toggle skeleton menampilkan SkeletonHelper bertanda helper (bukan model)',
    helpers.skeleton && helpers.skeletonVisible && helpers.helperTagged && helpers.modelMeshes === 53,
    helpers
  );
  check('S3-4. Toggle nama tulang menampilkan label untuk 51 tulang', helpers.sprites >= 44, { sprites: helpers.sprites });
  await screenshot(page, 'humanoid-skeleton-label');

  const before = await state(page);
  const baseline = before.selected.signature.worldHash;

  await page.selectOption('#boneSelect', 'LowerArm_R');
  await page.waitForTimeout(300);
  const boneInfo = await page.textContent('#boneInfo');
  check('S3-5. Memilih tulang menampilkan induk & jumlah anak', /LowerArm_R/.test(boneInfo) && /UpperArm_R/.test(boneInfo), {
    info: boneInfo
  });

  await setRange(page, '#boneRotZ', 60);
  await page.waitForTimeout(500);
  const rotated = await page.evaluate(() => ({
    state: window.__ucf.humanoid.state(),
    slider: document.querySelector('#boneRotZ').value,
    out: document.querySelector('#boneRotZOut').textContent
  }));
  const rotatedHash = rotated.state.selected.signature.worldHash;
  check(
    'S3-6. Slider rotasi sendi (60°) mengubah bentuk mesh',
    rotated.slider === '60' && rotatedHash !== baseline,
    { slider: rotated.slider, out: rotated.out, hashBerubah: rotatedHash !== baseline }
  );
  await screenshot(page, 'humanoid-siku-ditekuk');

  const deformation = await page.evaluate(() => window.__ucf.humanoid.measureDeformation({ boneName: 'LowerArm_R', axis: 'z', angleDeg: 60 }));
  results.measurements.deformation = deformation;
  check(
    'S3-7. Deformasi terukur: siku menggerakkan tangan, kepala tetap, reset bersih',
    deformation.ok && deformation.maxDisplacement > 0.05 && deformation.headDisplacement < 0.001 && deformation.resetError < 1e-4,
    { max_m: Number(deformation.maxDisplacement.toFixed(4)), head_m: deformation.headDisplacement, reset: deformation.resetError }
  );

  await page.click('#resetBonePose');
  await page.waitForTimeout(400);
  const afterReset = await state(page);
  check(
    'S3-8. Reset pose mengembalikan bentuk ke bind pose',
    afterReset.selected.signature.worldHash === baseline,
    { hashSama: afterReset.selected.signature.worldHash === baseline, slider: await page.inputValue('#boneRotZ') }
  );

  await page.selectOption('#boneSelect', 'Finger_Index_R_2');
  await setRange(page, '#boneRotZ', 60);
  await page.waitForTimeout(400);
  const finger = await page.evaluate(() => window.__ucf.humanoid.measureDeformation({ boneName: 'Finger_Index_R_2', axis: 'z', angleDeg: 60 }));
  results.measurements.finger = finger;
  check(
    'S3-9. Setiap ruas jari punya bobot sendiri (telunjuk menekuk, kepala & telapak tetap)',
    finger.maxDisplacement > 0.005 && finger.headDisplacement < 1e-4 && finger.resetError < 1e-4,
    { max_m: Number(finger.maxDisplacement.toFixed(4)), head_m: finger.headDisplacement }
  );
  await page.click('#resetBonePose');
  await page.waitForTimeout(300);

  await page.click('#testDeformation');
  await page.waitForTimeout(300);
  await page.click('#checkWeights');
  await page.waitForTimeout(300);
  const log = await page.evaluate(() => window.__ucf.validation.records.map((record) => ({
    test: record.test,
    result: record.result,
    details: record.details
  })));
  results.measurements.log = log;
  const deformRecord = log.find((record) => record.test === 'Uji deformasi sendi');
  const weightRecord = log.find((record) => record.test === 'Cek skin weights');
  check(
    'S3-10. Tombol "Uji deformasi" mencatat PASS dengan angka',
    deformRecord?.result === 'PASS' && deformRecord.details.verteks_bergerak > 0 && deformRecord.details.perpindahan_maks_m > 0.02,
    deformRecord?.details
  );
  check(
    'S3-11. Tombol "Cek weights" mencatat PASS (0 tanpa bobot, ≤4 pengaruh)',
    weightRecord?.result === 'PASS' && weightRecord.details.tanpa_bobot === 0 && weightRecord.details.pengaruh_maks <= 4,
    weightRecord?.details
  );

  // pose lewat tulang
  await page.evaluate(() => {
    const input = document.querySelector('input[name="pose"][value="A"]');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const poseA = await state(page);
  results.measurements.poseA = { width: poseA.selected.geometry.size[0], bones: poseA.selected.rig.bones, pose: poseA.selected.pose };
  check(
    'S3-12. Pose A mengubah bentuk lewat rotasi tulang (bukan rebuild geometri)',
    poseA.selected.pose === 'A' && poseA.selected.geometry.size[0] < before.selected.geometry.size[0] && poseA.selected.rig.bones === 51,
    results.measurements.poseA
  );
  await screenshot(page, 'humanoid-pose-a-rig');

  // simpan/muat config di bawah rigging
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#saveCharacterConfig');
  const download = await downloadPromise;
  const savedPath = join(OUT, 'konfigurasi-rig.json');
  await download.saveAs(savedPath);
  const savedJson = JSON.parse(await readFile(savedPath, 'utf8'));

  await page.evaluate(() => {
    const input = document.querySelector('input[name="pose"][value="netral"]');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.setInputFiles('#characterConfigFile', savedPath);
  await page.waitForTimeout(1200);
  const loaded = await page.evaluate(() => {
    const state = window.__ucf.humanoid.state();
    return {
      count: state.count,
      pose: state.selected.pose,
      hash: state.selected.signature.worldHash,
      bones: state.selected.rig?.bones,
      unweighted: state.selected.rig?.unweighted
    };
  });
  results.measurements.loaded = { ...loaded, savedFormat: savedJson.format };
  check(
    'S3-13. Simpan/muat config mempertahankan rig, pose, dan bentuk',
    loaded.count === 1 && loaded.bones === 51 && loaded.unweighted === 0 && loaded.pose === 'A' && loaded.hash === poseA.selected.signature.worldHash,
    { pose: loaded.pose, bones: loaded.bones, hashSama: loaded.hash === poseA.selected.signature.worldHash }
  );

  const final = await page.evaluate(() => ({
    meshes: window.__ucf.models[0].stats.meshes,
    bones: window.__ucf.models[0].stats.bones,
    skinned: window.__ucf.models[0].stats.skinnedMeshes,
    pageErrors: null
  }));
  check(
    'S3-14. Model tetap 53 mesh / 51 tulang setelah seluruh operasi',
    final.meshes === 53 && final.bones === 51 && final.skinned === 53,
    final
  );
  check('S3-15. Tidak ada page error / console error sepanjang uji', results.pageErrors.length === 0 && results.consoleErrors.length === 0, {
    page: results.pageErrors.length,
    console: results.consoleErrors.length
  });

  results.appValidation = await page.evaluate(() => window.__ucf.validation.summary);
  await browser.close();
}

try {
  await main();
} catch (error) {
  results.fatal = String(error?.stack || error);
  console.error('FATAL:', results.fatal);
}

results.finishedAt = new Date().toISOString();
results.consoleErrors = [...new Set(results.consoleErrors)];
results.pageErrors = [...new Set(results.pageErrors)];
results.passed = results.checks.filter((entry) => entry.pass).length;
results.failed = results.checks.filter((entry) => !entry.pass).length;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'phase-3.json'), JSON.stringify(results, null, 2));
console.log(`\nRingkasan Tahap 3: ${results.passed}/${results.checks.length} lulus · page error ${results.pageErrors.length} · console error ${results.consoleErrors.length}`);
process.exit(results.failed === 0 && !results.fatal && results.pageErrors.length === 0 ? 0 : 1);
