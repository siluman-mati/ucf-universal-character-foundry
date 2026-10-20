/**
 * UCF Tahap 5 — uji browser animasi, retargeting, dan pose reset.
 *
 * Tujuh target pengujian Tahap 5:
 *   1. pemutaran klip animasi pada karakter UCF;
 *   2. loop berjalan yang tidak membuat karakter melayang/tenggelam;
 *   3. retargeting dengan pemetaan tulang eksplisit (bukan hanya nama);
 *   4. gerakan lengan, kaki, dan jari yang masuk akal;
 *   5. pakaian modular mengikuti deformasi selama animasi;
 *   6. pose dapat di-reset setelah klip selesai;
 *   7. perilaku Tahap 1–4 tidak rusak (impor GLB, modular, rig).
 *
 * Semua angka diukur dari geometri hasil skinning di browser, bukan dari timeline.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit/stage5');
const SHOTS = join(OUT, 'screenshots');

const results = {
  phase: '5',
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
  await page.screenshot({ path: file, fullPage: false });
  results.screenshots.push(file);
}

function check(name, pass, detail = {}) {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${Object.keys(detail).length ? ' — ' + JSON.stringify(detail) : ''}`);
}

const animState = (page) => page.evaluate(() => window.__ucf.anim.state());

/** Snapshot pose tulang + verteks dunia untuk membandingkan sebelum/sesudah. */
const snapshot = (page) =>
  page.evaluate(() => {
    const THREE = window.__ucf.three;
    const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
    rig.root.updateMatrixWorld(true);
    const bones = rig.list.map((item) => ({
      name: item.name,
      quat: item.quaternion.toArray(),
      pos: item.position.toArray(),
      world: item.getWorldPosition(new THREE.Vector3()).toArray()
    }));
    const vertices = [];
    const v = new THREE.Vector3();
    rig.root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.userData?.ucfHelper) return;
      const position = mesh.geometry.getAttribute('position');
      if (!position) return;
      const step = Math.max(1, Math.floor(position.count / 60));
      for (let i = 0; i < position.count; i += step) {
        mesh.getVertexPosition(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        vertices.push([Number(v.x.toFixed(6)), Number(v.y.toFixed(6)), Number(v.z.toFixed(6))]);
      }
    });
    return { bones, vertices };
  });

function maxVertexDelta(a, b) {
  let max = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
    if (d > max) max = d;
  }
  return max;
}

function maxBoneDelta(a, b) {
  let maxQuat = 0;
  let maxPos = 0;
  const byName = new Map(b.map((item) => [item.name, item]));
  for (const item of a) {
    const other = byName.get(item.name);
    if (!other) continue;
    for (let i = 0; i < 4; i += 1) maxQuat = Math.max(maxQuat, Math.abs(item.quat[i] - other.quat[i]));
    for (let i = 0; i < 3; i += 1) maxPos = Math.max(maxPos, Math.abs(item.pos[i] - other.pos[i]));
  }
  return { maxQuat, maxPos };
}

/** Titik terendah mesh telapak pada pose yang sedang tampil. */
const lowestFootNow = (page) =>
  page.evaluate(() => {
    const THREE = window.__ucf.three;
    const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
    rig.root.updateMatrixWorld(true);
    const inverse = rig.root.matrixWorld.clone().invert();
    let lowest = Infinity;
    const v = new THREE.Vector3();
    rig.root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.userData?.ucfHelper) return;
      if (!/^(Foot_Mesh_|Foot_)/.test(mesh.name)) return;
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        mesh.getVertexPosition(i, v);
        v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        if (v.y < lowest) lowest = v.y;
      }
    });
    return Number.isFinite(lowest) ? lowest : null;
  });

let browserRef = null;

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  browserRef = browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', (error) => results.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') results.consoleErrors.push(message.text());
  });

  await page.goto(BASE);
  await page.waitForFunction(() => window.__ucf?.ready);
  check('Aplikasi UCF termuat (stage 5)', (await page.evaluate(() => window.__ucf.stage)) >= 5, {
    versi: await page.evaluate(() => window.__ucf.version)
  });

  /* ---------------- Karakter + modul ---------------- */
  await page.click('#createHumanoid');
  await page.waitForTimeout(700);
  const attached = await page.evaluate(() =>
    ['kaos-lengan-pendek', 'celana-panjang', 'sepatu-boot'].map((id) => Boolean(window.__ucf.modular.attach(id)))
  );
  check('Karakter UCF + 3 modul terpasang', attached.every(Boolean), {
    modul: await page.evaluate(() => window.__ucf.modular.attached().length)
  });

  const rest = await snapshot(page);
  const rigSize = await page.evaluate(() => {
    const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
    return { bones: rig.list.length, meshes: rig.stats.skinnedMeshes, vertices: rig.stats.vertices };
  });
  results.measurements.rig = rigSize;
  await screenshot(page, 'panel-animasi');

  /* ---------------- 1. Pemutaran klip native ---------------- */
  const clipOptions = await page.evaluate(() =>
    [...document.querySelectorAll('#animClip option')].map((option) => option.value)
  );
  const nativeOptions = clipOptions.filter((value) => value.startsWith('native:'));
  check('Lima klip native tersedia di panel', nativeOptions.length === 5, { klip: nativeOptions });

  await page.selectOption('#animClip', 'native:walk');
  await page.click('#animLoad');
  await page.waitForTimeout(150);
  const walkState = await animState(page);
  check('Klip walk dimuat lewat UI', /Walk/i.test(walkState.name) && walkState.duration > 0.9, {
    klip: walkState.name,
    durasi: walkState.duration
  });

  await page.click('#animPlay');
  await page.waitForTimeout(700);
  const playingState = await animState(page);
  const moving = await snapshot(page);
  const boneDelta = maxBoneDelta(rest.bones, moving.bones);
  const vertexDelta = maxVertexDelta(rest.vertices, moving.vertices);
  await screenshot(page, 'walk-berjalan');
  check('Pemutaran menggerakkan tulang dan mesh', playingState.playing && playingState.time > 0.2 && boneDelta.maxQuat > 0.02 && vertexDelta > 0.005, {
    waktu: playingState.time,
    deltaKuaternion: Number(boneDelta.maxQuat.toFixed(4)),
    deltaVerteksM: Number(vertexDelta.toFixed(4))
  });
  /* ---------------- 2. Loop berjalan tidak melayang/tenggelam ---------------- */
  const loopEnabled = await page.evaluate(() => document.querySelector('#animLoop').checked);
  await page.click('#animPlay');
  await page.waitForTimeout(120);
  const loopTrace = await page.evaluate(async () => {
    const lows = [];
    const xs = [];
    const start = performance.now();
    return await new Promise((resolvePromise) => {
      const tick = () => {
        const state = window.__ucf.anim.state();
        xs.push(state.time);
        lows.push(lowestFootValue());
        if (performance.now() - start > 2600) {
          resolvePromise({ lows, xs, state: window.__ucf.anim.state() });
        } else {
          requestAnimationFrame(tick);
        }
      };
      function lowestFootValue() {
        const THREE = window.__ucf.three;
        const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
        rig.root.updateMatrixWorld(true);
        const inverse = rig.root.matrixWorld.clone().invert();
        let lowest = Infinity;
        const v = new THREE.Vector3();
        rig.root.traverse((mesh) => {
          if (!mesh.isMesh || mesh.userData?.ucfHelper) return;
          if (!/^(Foot_Mesh_|Foot_)/.test(mesh.name)) return;
          const position = mesh.geometry.getAttribute('position');
          const step = Math.max(1, Math.floor(position.count / 120));
          for (let i = 0; i < position.count; i += step) {
            mesh.getVertexPosition(i, v);
            v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
            if (v.y < lowest) lowest = v.y;
          }
        });
        return lowest;
      }
      tick();
    });
  });
  const lows = loopTrace.lows.filter((value) => Number.isFinite(value));
  const wraps = loopTrace.xs.filter((value, index) => index > 0 && value < loopTrace.xs[index - 1] - 0.05).length;
  const lowest = Math.min(...lows);
  const highest = Math.max(...lows);
  results.measurements.walkLoop = { samples: lows.length, lowest, highest, wraps };
  check('Loop walk menapak lantai tanpa melayang/tenggelam', loopEnabled && wraps >= 1 && lowest > -0.02 && highest < 0.06, {
    loop: loopEnabled,
    sampel: lows.length,
    terendahM: Number(lowest.toFixed(4)),
    tertinggiM: Number(highest.toFixed(4)),
    putaranLoop: wraps
  });

  /* ---------------- Evaluasi 5 klip native lewat tombol UI ---------------- */
  const nativeResults = {};
  for (const value of nativeOptions) {
    await page.selectOption('#animClip', value);
    await page.click('#animLoad');
    await page.waitForTimeout(120);
    await page.click('#animTest');
    await page.waitForTimeout(200);
    const evaluation = await page.evaluate(() => window.__ucf.anim.evaluation());
    nativeResults[value.split(':')[1]] = {
      passed: evaluation?.passed ?? 0,
      failed: evaluation?.failed ?? -1,
      fails: (evaluation?.checks || []).filter((entry) => entry.status === 'FAIL').map((entry) => entry.id)
    };
  }
  results.measurements.native = nativeResults;
  check('Lima klip native lulus seluruh pemeriksaan (10 cek termasuk modul)', Object.values(nativeResults).every((item) => item.failed === 0), nativeResults);

  const walkMetrics = await page.evaluate(async () => {
    window.__ucf.anim.load({ kind: 'native', id: 'walk' });
    const result = window.__ucf.anim.evaluate({ modular: true });
    return result.metrics;
  });
  results.measurements.walkMetrics = walkMetrics;
  check('Metrik walk: panggul, kontak kaki, regangan, loop', walkMetrics.foot.hipsDriftXZ < 0.005 && walkMetrics.stretch.maxLengthRatio < 1.35 && walkMetrics.loop.maxAngleDeg < 0.5, {
    driftPanggulM: walkMetrics.foot.hipsDriftXZ,
    reganganMaks: walkMetrics.stretch.maxLengthRatio,
    loopDeg: walkMetrics.loop.maxAngleDeg,
    kontak: `${walkMetrics.foot.lowestFootM} .. ${walkMetrics.foot.highestContactM}`,
    modulMm: Number(((walkMetrics.modules?.maxGapChangeM ?? 0) * 1000).toFixed(1))
  });

  /* ---------------- 3. Retargeting dengan pemetaan eksplisit ---------------- */
  await page.setInputFiles('#modelFile', '/home/user/ucf/test-assets/XBot.glb');
  await page.waitForFunction(() => window.__ucf.anim.sources().length > 0, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  const sources = await page.evaluate(() => [...document.querySelectorAll('#animSource option')].map((option) => ({ value: option.value, label: option.textContent })));
  check('Sumber retarget otomatis muncul setelah impor', sources.length === 1 && /XBot/.test(sources[0].label), sources);

  const sourceId = sources[0].value;
  await page.evaluate(() => document.querySelector('#animSource').dispatchEvent(new Event('change')));
  await page.waitForTimeout(200);
  await page.selectOption('#animSourceClip', 'walk');
  await page.click('#animMap');
  await page.waitForTimeout(300);
  const mapping = await page.evaluate(() => {
    const map = window.__ucf.anim.panel().lastMap;
    return {
      ok: map.ok,
      mapped: map.mapped,
      sourceBones: map.sourceBones,
      targetBones: map.targetBones,
      nameOnly: map.nameOnlyPairs,
      coreMissing: map.coreMissing,
      hierarchy: map.hierarchyIssues,
      conflictsWorld: map.conflictsWorldSide,
      conflictsName: map.conflictsByName,
      maxRelativeRest: map.maxRelativeRestDeviationDeg,
      checks: (map.checks || []).map((entry) => `${entry.status}:${entry.id}`),
      tableRows: document.querySelectorAll('#animMapReport .map-table tbody tr').length
    };
  });
  results.measurements.mapping = mapping;
  await screenshot(page, 'peta-tulang');
  check('Pemetaan tulang eksplisit lengkap & sehat', mapping.ok && mapping.mapped >= 45 && mapping.coreMissing.length === 0 && mapping.hierarchy === 0 && mapping.conflictsWorld === 0 && mapping.maxRelativeRest <= 45, {
    pasangan: `${mapping.mapped}/${mapping.sourceBones} sumber → ${mapping.targetBones} target`,
    'hanya-nama': mapping.nameOnly,
    'konflik-label': mapping.conflictsName,
    'konflik-sisi-dunia': mapping.conflictsWorld,
    'rest-relatif-maks': mapping.maxRelativeRest,
    cek: mapping.checks.join(', '),
    barisTabel: mapping.tableRows
  });

  await page.click('#animRetarget');
  await page.waitForTimeout(2000);
  const retarget = await page.evaluate(() => {
    const verify = window.__ucf.anim.verify();
    const state = window.__ucf.anim.state();
    return {
      state,
      verify: verify && {
        meanDeg: verify.meanDeg,
        worstDeg: verify.worstDeg,
        minTrajectoryRho: verify.minTrajectoryRho,
        trajectories: verify.trajectories,
        worstPair: verify.worstPair
      },
      rows: document.querySelectorAll('#animMapReport .compat-row').length
    };
  });
  results.measurements.retarget = retarget;
  check('Retarget menghasilkan klip UCF yang dimuat', retarget.state.retargeted === true && /retarget/i.test(retarget.state.name), {
    klip: retarget.state.name,
    durasi: retarget.state.duration,
    meta: retarget.state.meta
  });
  check('Verifikasi retarget: pose sesuai harapan & lintasan mengikuti sumber', retarget.verify.worstDeg <= 2 && retarget.verify.minTrajectoryRho >= 0.85, {
    'deviasi-terburuk-deg': retarget.verify.worstDeg,
    'deviasi-rata-deg': retarget.verify.meanDeg,
    'korelasi-lintasan-min': retarget.verify.minTrajectoryRho,
    'pasangan-terburuk': retarget.verify.worstPair
  });

  await page.click('#animPlay');
  await page.waitForTimeout(900);
  const retargetPlay = await page.evaluate(() => {
    const result = window.__ucf.anim.evaluate({ modular: true });
    return { evaluation: result, state: window.__ucf.anim.state() };
  });
  await screenshot(page, 'retarget-walk');
  results.measurements.retargetEvaluation = {
    passed: retargetPlay.evaluation.passed,
    failed: retargetPlay.evaluation.failed,
    metrics: retargetPlay.evaluation.metrics
  };
  check('Klip retarget lulus 10 cek termasuk modul, lantai & lengan', retargetPlay.evaluation.failed === 0, {
    lulus: retargetPlay.evaluation.passed,
    gagal: retargetPlay.evaluation.failed,
    detail: retargetPlay.evaluation.checks.filter((entry) => entry.status !== 'PASS').map((entry) => `${entry.id}: ${entry.detail}`),
    kaki: `${retargetPlay.evaluation.metrics.foot.lowestFootM} .. ${retargetPlay.evaluation.metrics.foot.highestContactM}`,
    modulMm: Number(((retargetPlay.evaluation.metrics.modules?.maxGapChangeM ?? -1) * 1000).toFixed(1))
  });

  /* ---------------- 4. Gerakan lengan, kaki, jari masuk akal ---------------- */
  const limbs = await page.evaluate(async () => {
    const THREE = window.__ucf.three;
    const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
    const clip = window.__ucf.anim.state();
    const mixer = new THREE.AnimationMixer(rig.root);
    const action = mixer.clipAction(window.__ucf.anim.panel().player.clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const samples = [];
    const duration = clip.duration;
    for (let i = 0; i <= 8; i += 1) {
      mixer.setTime((i / 8) * duration * 0.999);
      rig.root.updateMatrixWorld(true);
      const hips = rig.bones.get('Hips').getWorldPosition(new THREE.Vector3());
      const footL = rig.bones.get('Foot_L').getWorldPosition(new THREE.Vector3()).sub(hips);
      const footR = rig.bones.get('Foot_R').getWorldPosition(new THREE.Vector3()).sub(hips);
      const handL = rig.bones.get('Hand_L').getWorldPosition(new THREE.Vector3()).sub(hips);
      const handR = rig.bones.get('Hand_R').getWorldPosition(new THREE.Vector3()).sub(hips);
      samples.push({ footLx: footL.x, footRx: footR.x, footLz: footL.z, footRz: footR.z, handLx: handL.x, handRx: handR.x, handLy: handL.y, handRy: handR.y });
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(rig.root);
    const stride = Math.max(...samples.map((item) => Math.abs(item.footLz))) + Math.max(...samples.map((item) => Math.abs(item.footRz)));
    const alternates = samples.filter((item) => Math.sign(item.footLz) !== Math.sign(item.footRz)).length;
    const sideOk = samples.every((item) => item.footLx < 0 === item.footRx < 0 || Math.abs(item.footLx - item.footRx) > 0.02);
    return { samples, stride, alternates, sideOk };
  });
  const joints = retargetPlay.evaluation.metrics.joints;
  results.measurements.limbs = { joints, stride: limbs.stride, alternates: limbs.alternates };
  check('Lengan, kaki, dan jari bergerak wajar', joints.kneeFlexionMaxDeg > 25 && joints.kneeFlexionMaxDeg < 130 && joints.fingerTipTravelM > 0.01 && joints.handWristVariationM < 0.002 && joints.armElevationMaxDeg > 5 && limbs.alternates >= 5, {
    'fleksi-lutut-maks-deg': joints.kneeFlexionMaxDeg,
    'ujung-jari-mm': Number((joints.fingerTipTravelM * 1000).toFixed(1)),
    'variasi-pergelangan-mm': Number((joints.handWristVariationM * 1000).toFixed(2)),
    'elevasi-lengan-maks-deg': joints.armElevationMaxDeg,
    'langkah-kaki-bergantian': `${limbs.alternates}/9 sampel`,
    'rentang-langkah-m': Number(limbs.stride.toFixed(3)),
    'sisi-kaki-konsisten': limbs.sideOk
  });

  /* ---------------- 5. Modul mengikuti deformasi saat animasi ---------------- */
  const moduleFollow = await page.evaluate(async () => {
    const THREE = window.__ucf.three;
    const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
    const clip = window.__ucf.anim.panel().player.clip;
    const invert = rig.root.matrixWorld.clone().invert();
    const capture = () => {
      const points = [];
      const v = new THREE.Vector3();
      rig.root.traverse((mesh) => {
        if (!mesh.isMesh || mesh.userData?.ucfHelper || !mesh.name.startsWith('ML_')) return;
        const position = mesh.geometry.getAttribute('position');
        const step = Math.max(1, Math.floor(position.count / 12));
        for (let i = 0; i < position.count; i += step) {
          mesh.getVertexPosition(i, v);
          v.applyMatrix4(mesh.matrixWorld).applyMatrix4(invert);
          points.push([v.x, v.y, v.z]);
        }
      });
      return points;
    };
    const mixer = new THREE.AnimationMixer(rig.root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(0);
    rig.root.updateMatrixWorld(true);
    const first = capture();
    mixer.setTime(clip.duration * 0.4);
    rig.root.updateMatrixWorld(true);
    const later = capture();
    mixer.stopAllAction();
    mixer.uncacheRoot(rig.root);
    let moved = 0;
    let max = 0;
    let movedCount = 0;
    for (let i = 0; i < first.length; i += 1) {
      const d = Math.hypot(first[i][0] - later[i][0], first[i][1] - later[i][1], first[i][2] - later[i][2]);
      if (d > 0.005) movedCount += 1;
      max = Math.max(max, d);
      moved += d;
    }
    return { samples: first.length, movedCount, maxMove: max, meanMove: moved / first.length };
  });
  results.measurements.moduleFollow = { evaluation: retargetPlay.evaluation.metrics.modules, geometry: moduleFollow };
  const moduleMetrics = retargetPlay.evaluation.metrics.modules || {};
  check('Modul ikut terdeformasi & jaraknya ke tubuh stabil', (moduleMetrics.maxGapChangeM ?? 1) < 0.03 && moduleFollow.movedCount / moduleFollow.samples > 0.5, {
    'perubahan-jarak-maks-mm': Number(((moduleMetrics.maxGapChangeM ?? -1) * 1000).toFixed(1)),
    'rata-rata-mm': Number(((moduleMetrics.meanGapChangeM ?? -1) * 1000).toFixed(1)),
    'verteks-modul-bergerak': `${moduleFollow.movedCount}/${moduleFollow.samples}`,
    'geser-maks-m': Number(moduleFollow.maxMove.toFixed(3))
  });

  /* ---------------- 6. Reset pose ---------------- */
  await page.click('#animStop');
  await page.waitForTimeout(150);
  await page.click('#animReset');
  await page.waitForTimeout(400);
  const afterReset = await snapshot(page);
  const resetState = await animState(page);
  const resetBone = maxBoneDelta(rest.bones, afterReset.bones);
  const resetVertex = maxVertexDelta(rest.vertices, afterReset.vertices);
  await screenshot(page, 'setelah-reset-pose');
  check('Reset pose memulihkan bind pose karakter', resetState.id === null && resetBone.maxQuat < 1e-6 && resetBone.maxPos < 1e-6 && resetVertex < 1e-4, {
    klip: resetState.id,
    'delta-kuaternion': resetBone.maxQuat,
    'delta-posisi-tulang': resetBone.maxPos,
    'delta-verteks-m': resetVertex
  });

  /* ---------------- 7. Regresi Tahap 1–4 di sesi yang sama ---------------- */
  const regression = await page.evaluate(() => {
    const models = window.__ucf.models.map((model) => ({ name: model.name, meshes: model.stats.meshes, bones: model.stats.bones, clips: model.stats.clips }));
    const modular = window.__ucf.modular.state();
    const rig = window.__ucf.humanoid.current().content.userData.ucfRig;
    return {
      models,
      modularAttached: modular.attached.length,
      modularValid: modular.attached.every((item) => item.status === 'VALID'),
      bones: rig.list.length,
      vertices: rig.stats.vertices
    };
  });
  results.measurements.regression = regression;
  check('Tahap 1–4 tetap berfungsi (impor, rig, modular)', regression.models.length === 2 && regression.models[1].bones === 67 && regression.modularAttached === 3 && regression.modularValid && regression.bones === 51, regression);

  const logRecords = await page.evaluate(() => window.__ucf.log.records.filter((record) => record.group === 'E. Animasi'));
  const logFails = logRecords.filter((record) => record.result !== 'PASS');
  results.measurements.log = { total: logRecords.length, fails: logFails.map((record) => `${record.test}: ${record.details?.alasan || record.details?.gagal || ''}`) };
  check('Log validasi "E. Animasi" tanpa catatan gagal', logRecords.length >= 10 && logFails.length === 0, {
    catatan: logRecords.length,
    gagal: logFails.length
  });

  await screenshot(page, 'status-validasi');

  /* ---------------- Tampilan Android ---------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.querySelector('#toggleRight')?.click();
  });
  await page.waitForTimeout(500);
  const mobile = await page.evaluate(() => {
    const section = document.querySelector('#animationSection');
    const box = section.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      sectionWidth: Math.round(box.width),
      visible: box.height > 40,
      clipDisabled: document.querySelector('#animClip').disabled,
      playVisible: Boolean(document.querySelector('#animPlay').offsetParent)
    };
  });
  await page.evaluate(() => document.querySelector('#animationSection')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await screenshot(page, 'android-390');
  check('Panel animasi tetap terpakai di layar 390×844', mobile.visible && mobile.playVisible && mobile.scrollWidth <= mobile.innerWidth + 2, mobile);

  check('Tidak ada error halaman/konsol', results.pageErrors.length === 0 && results.consoleErrors.length === 0, {
    pageErrors: results.pageErrors.slice(0, 3),
    consoleErrors: results.consoleErrors.slice(0, 3)
  });

  await browser.close();
}

try {
  await main();
} catch (error) {
  results.fatal = error.message;
  console.error('FATAL', error);
} finally {
  try { await browserRef?.close(); } catch { /* sudah tertutup */ }
  results.finishedAt = new Date().toISOString();
  results.passed = results.checks.filter((entry) => entry.pass).length;
  results.failed = results.checks.filter((entry) => !entry.pass).length;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'phase-5.json'), JSON.stringify(results, null, 2));
  console.log(`\nRingkasan: ${results.passed} PASS, ${results.failed} FAIL${results.fatal ? ' (fatal: ' + results.fatal + ')' : ''}`);
  if (results.failed > 0 || results.fatal) process.exitCode = 1;
}
