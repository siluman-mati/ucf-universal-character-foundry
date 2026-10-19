/**
 * UCF Tahap 2 — uji browser humanoid prosedural penuh (2a + 2b + 2c).
 * Membuktikan: 35 parameter mengubah geometri, pose, duplikat/rename/hapus,
 * undo/redo, dan simpan/muat config menghasilkan bentuk identik.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { directionErrorDegrees } from '../src/camera.js';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit/stage2');
const SHOTS = join(OUT, 'screenshots');

const results = {
  phase: '2',
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

async function setPose(page, pose) {
  await page.evaluate((value) => {
    const input = document.querySelector(`input[name="pose"][value="${value}"]`);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, pose);
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

  const boot = await page.evaluate(() => ({
    count: window.__ucf.humanoid.state().count,
    badge: document.querySelector('#humanoidCount').textContent,
    createEnabled: !document.querySelector('#createHumanoid').disabled,
    visible: window.__ucf.humanoid.state().visibleParams,
    groups: document.querySelectorAll('#humanoidParams .param-group').length
  }));
  results.measurements.boot = { visible: boot.visible.length, groups: boot.groups };
  check('S2-1. Halaman tanpa karakter & tombol buat aktif', boot.count === 0 && /0 karakter/.test(boot.badge) && boot.createEnabled, {
    badge: boot.badge
  });
  check('S2-2. Seluruh 35 parameter tampil dalam 6 grup', boot.visible.length === 35 && boot.groups === 6, {
    parameter: boot.visible.length,
    grup: boot.groups
  });
  await screenshot(page, 'sebelum-buat');

  await page.click('#createHumanoid');
  await page.waitForFunction(() => window.__ucf.humanoid.state().count === 1, null, { timeout: 15000 });
  await page.waitForTimeout(900);

  const created = await page.evaluate(() => {
    const state = window.__ucf.humanoid.state();
    const model = window.__ucf.models[0];
    return {
      count: state.count,
      selected: { name: state.selected.name, pose: state.selected.pose, height: state.selected.height, geometry: state.selected.geometry },
      modelName: model.name,
      meshes: model.stats.meshes,
      bones: model.stats.bones,
      hierarchy: document.querySelector('#hierarchyCount').textContent,
      readout: document.querySelector('#humanoidReadout').textContent.replace(/\s+/g, ' ').trim()
    };
  });
  results.measurements.created = created;
  check(
    'S2-3. Humanoid dibuat: 53 mesh, 4.652 verteks, 51 tulang (Tahap 3)',
    created.count === 1 && created.meshes === 53 && created.selected.geometry.vertices === 4652 && created.bones === 51,
    { meshes: created.meshes, vertices: created.selected.geometry.vertices, bones: created.bones }
  );
  check(
    'S2-4. Tinggi 1,750 m, kaki di lantai, menghadap +Z',
    Math.abs(created.selected.height - 1.75) < 0.01 &&
      Math.abs(created.selected.geometry.minY) < 1e-3 &&
      created.selected.geometry.size[0] > 1.5 &&
      created.selected.geometry.size[2] > 0.15,
    { height: created.selected.height, minY: created.selected.geometry.minY, size: created.selected.geometry.size }
  );
  check('S2-5. Hierarki & daftar model menampilkan karakter', /106 node/.test(created.hierarchy) && created.modelName === 'Humanoid 1', {
    hierarchy: created.hierarchy,
    modelName: created.modelName
  });

  const geometryTest = await page.evaluate(() => {
    const controller = window.__ucf.humanoid;
    const baseline = controller.state().selected.signature;
    const rows = [];
    for (const key of controller.state().visibleParams) {
      const input = document.querySelector(`#param-${key}`);
      const before = controller.state().selected.params[key];
      const min = Number(input.min);
      const max = Number(input.max);
      const value = before < max - (max - min) * 0.01 ? before + (max - before) * 0.5 : before - (before - min) * 0.5;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const changed = controller.state().selected.signature;
      const delta = {
        key,
        from: before,
        to: value,
        changed: changed.worldHash !== baseline.worldHash,
        size: changed.size.map((v) => Number(v.toFixed(3)))
      };
      input.value = String(before);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      delta.restored = controller.state().selected.signature.worldHash === baseline.worldHash;
      rows.push(delta);
    }
    return { baseline: baseline.worldHash, rows };
  });
  results.measurements.parameters = geometryTest;
  const failures = geometryTest.rows.filter((row) => !row.changed);
  const restoreFailures = geometryTest.rows.filter((row) => !row.restored);
  check('S2-6. Semua 35 parameter mengubah geometri 3D nyata', failures.length === 0, {
    diuji: geometryTest.rows.length,
    gagal: failures.map((row) => row.key)
  });
  check('S2-7. Mengembalikan slider ke default memulihkan bentuk semula', restoreFailures.length === 0, {
    gagal: restoreFailures.map((row) => row.key)
  });

  await page.click('#resetHumanoid');
  await page.waitForTimeout(500);
  const afterReset = await page.evaluate(() => window.__ucf.humanoid.state());
  check(
    'S2-8. Reset mengembalikan parameter default & bentuk awal',
    afterReset.selected.signature.worldHash === geometryTest.baseline && Math.abs(afterReset.selected.height - 1.75) < 0.01,
    { hashSama: afterReset.selected.signature.worldHash === geometryTest.baseline, height: afterReset.selected.height }
  );

  await page.click('[data-view="depan"]');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await page.waitForTimeout(150);
  const frontCamera = await page.evaluate(() => window.__ucf.camera);
  check('S2-9. Tampak depan membingkai humanoid penuh', directionErrorDegrees(frontCamera.direction, 'depan') < 0.5, {
    errorDeg: Number(directionErrorDegrees(frontCamera.direction, 'depan').toFixed(3)),
    distance: Number(frontCamera.distance.toFixed(3))
  });

  // ------- pose -------
  const tSign = await state(page);
  await setPose(page, 'A');
  await page.waitForTimeout(450);
  const aPose = await state(page);
  await setPose(page, 'netral');
  await page.waitForTimeout(450);
  const neutral = await state(page);
  await setPose(page, 'T');
  await page.waitForTimeout(450);
  results.measurements.poses = {
    T: { width: tSign.selected.geometry.size[0], hash: tSign.selected.signature.worldHash },
    A: { width: aPose.selected.geometry.size[0], hash: aPose.selected.signature.worldHash },
    netral: { width: neutral.selected.geometry.size[0], hash: neutral.selected.signature.worldHash }
  };
  check(
    'S2-10. Pose T/A/netral mengubah bentuk & bentang lengan',
    tSign.selected.signature.worldHash !== aPose.selected.signature.worldHash &&
      aPose.selected.signature.worldHash !== neutral.selected.signature.worldHash &&
      tSign.selected.geometry.size[0] > aPose.selected.geometry.size[0] &&
      aPose.selected.geometry.size[0] > neutral.selected.geometry.size[0],
    results.measurements.poses
  );

  // ------- config: simpan → ubah → muat -------
  await page.fill('#humanoidName', 'Manekin Uji');
  await page.press('#humanoidName', 'Enter');
  await setPose(page, 'A');
  await page.evaluate(() => {
    for (const [key, value] of [['height', 1.92], ['headWidth', 0.17], ['fingerMiddle', 0.095]]) {
      const input = document.querySelector(`#param-${key}`);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(500);
  const beforeSave = await state(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#saveCharacterConfig');
  const download = await downloadPromise;
  const savedPath = join(OUT, 'konfigurasi-tersimpan.json');
  await download.saveAs(savedPath);
  const savedJson = JSON.parse(await readFile(savedPath, 'utf8'));
  results.measurements.config = {
    file: download.suggestedFilename(),
    format: savedJson.format,
    version: savedJson.version,
    characters: savedJson.characters.length,
    height: savedJson.characters[0]?.params?.height,
    pose: savedJson.characters[0]?.pose,
    name: savedJson.characters[0]?.name
  };
  check(
    'S2-11. Simpan config mengunduh JSON format ucf-character-config v1.0',
    savedJson.format === 'ucf-character-config' && savedJson.version === '1.0' && savedJson.characters.length === 1 &&
      savedJson.characters[0].params.height === 1.92 && savedJson.characters[0].pose === 'A' && savedJson.characters[0].name === 'Manekin Uji',
    results.measurements.config
  );

  // ubah bentuk lalu muat kembali
  await page.evaluate(() => {
    const input = document.querySelector('#param-height');
    input.value = '1.55';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await setPose(page, 'netral');
  await page.waitForTimeout(400);
  const changedState = await state(page);
  await page.setInputFiles('#characterConfigFile', savedPath);
  await page.waitForTimeout(900);
  const loaded = await page.evaluate(() => {
    const controller = window.__ucf.humanoid;
    return {
      count: controller.state().count,
      list: controller.list().map((c) => ({ id: c.id, name: c.name, pose: c.pose, hash: controller.signature(c.modelId)?.worldHash }))
    };
  });
  results.measurements.loaded = loaded;
  check(
    'S2-12. Muat config memulihkan bentuk, pose, dan nama yang sama',
    loaded.count === 1 && loaded.list[0].name === 'Manekin Uji' && loaded.list[0].pose === 'A' && loaded.list[0].hash === beforeSave.selected.signature.worldHash,
    { hashSama: loaded.list[0]?.hash === beforeSave.selected.signature.worldHash, pose: loaded.list[0]?.pose, name: loaded.list[0]?.name }
  );

  // ------- undo / redo -------
  await page.evaluate(() => {
    const input = document.querySelector('#param-height');
    input.value = '1.65';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const afterEdit = await state(page);
  await page.click('#undoHumanoid');
  await page.waitForTimeout(300);
  const afterUndo = await state(page);
  await page.click('#redoHumanoid');
  await page.waitForTimeout(300);
  const afterRedo = await state(page);
  check(
    'S2-13. Undo/Redo memulihkan dan menerapkan ulang perubahan parameter',
    afterEdit.selected.signature.worldHash !== beforeSave.selected.signature.worldHash &&
      afterUndo.selected.signature.worldHash === beforeSave.selected.signature.worldHash &&
      afterRedo.selected.signature.worldHash === afterEdit.selected.signature.worldHash,
    { undo: afterUndo.selected.signature.worldHash === beforeSave.selected.signature.worldHash, redo: afterRedo.selected.signature.worldHash === afterEdit.selected.signature.worldHash }
  );

  // ------- duplikat & rename -------
  await page.click('#duplicateHumanoid');
  await page.waitForTimeout(700);
  const duplicated = await page.evaluate(() => {
    const controller = window.__ucf.humanoid;
    return {
      count: controller.state().count,
      list: controller.list().map((c) => ({ name: c.name, geom: controller.signature(c.modelId)?.geometryHash }))
    };
  });
  check(
    'S2-14. Duplikat menambah karakter dengan bentuk identik',
    duplicated.count === 2 && duplicated.list.length === 2 && duplicated.list[0].geom === duplicated.list[1].geom,
    duplicated
  );

  await page.fill('#humanoidName', 'Salinan Baru');
  await page.press('#humanoidName', 'Enter');
  await page.waitForTimeout(400);
  const renamed = await page.evaluate(() => ({
    list: window.__ucf.humanoid.list().map((c) => c.name),
    models: window.__ucf.models.map((m) => m.name)
  }));
  check('S2-15. Ganti nama tersinkron ke daftar model', renamed.list.includes('Salinan Baru') && renamed.models.includes('Salinan Baru'), renamed);

  await screenshot(page, 'dua-karakter');

  await page.click('#deleteHumanoid');
  await page.waitForTimeout(600);
  const afterDelete = await page.evaluate(() => ({ count: window.__ucf.humanoid.state().count, models: window.__ucf.models.length }));
  check('S2-16. Hapus karakter terpilih menyisakan satu karakter', afterDelete.count === 1 && afterDelete.models === 1, afterDelete);

  // pilih kembali karakter yang tersisa lewat daftar model
  await page.click('#modelList .model-item');
  await page.waitForTimeout(400);

  // kategori tangan & kaki terlihat mengubah bentuk secara spesifik
  const handFoot = await page.evaluate(() => {
    const controller = window.__ucf.humanoid;
    const base = controller.state().selected.signature;
    const out = {};
    for (const key of ['fingerIndex', 'thumbAngle', 'footLength', 'footWidth', 'palmWidth', 'ankleRadius']) {
      const input = document.querySelector(`#param-${key}`);
      const before = controller.state().selected.params[key];
      input.value = String(before * 1.25 > Number(input.max) ? before * 0.8 : before * 1.25);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      out[key] = controller.state().selected.signature.worldHash !== base.worldHash;
      input.value = String(before);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return out;
  });
  results.measurements.handFoot = handFoot;
  check('S2-17. Parameter tangan & kaki spesifik mengubah mesh', Object.values(handFoot).every(Boolean), handFoot);

  // tangkapan layar akhir
  await page.click('[data-view="depan"]');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  const canvas = await page.locator('#viewport canvas').boundingBox();
  await page.mouse.click(canvas.x + 30, canvas.y + canvas.height - 30);
  await page.waitForTimeout(300);
  await screenshot(page, 'humanoid-lengkap-depan');
  await page.click('[data-view="perspektif"]');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await screenshot(page, 'humanoid-lengkap-perspektif');
  await page.click('#toggleWireframe');
  await page.waitForTimeout(300);
  await screenshot(page, 'humanoid-lengkap-wireframe');
  await page.click('#toggleWireframe');

  const finalState = await state(page);
  check('S2-18. Aplikasi tetap stabil setelah 70 rebuild parameter + operasi karakter', finalState.count === 1 && results.pageErrors.length === 0, {
    count: finalState.count
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
await writeFile(join(OUT, 'phase-2.json'), JSON.stringify(results, null, 2));
console.log(`\nRingkasan Tahap 2: ${results.passed}/${results.checks.length} lulus · page error ${results.pageErrors.length} · console error ${results.consoleErrors.length}`);
process.exit(results.failed === 0 && !results.fatal && results.pageErrors.length === 0 ? 0 : 1);
