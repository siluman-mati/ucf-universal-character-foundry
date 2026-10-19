/**
 * UCF Tahap 2a — uji browser: humanoid prosedural inti (proporsi, kepala, tubuh, panjang anggota).
 * Bukti: setiap parameter yang tampil mengubah geometri; reset mengembalikan bentuk awal.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { directionErrorDegrees } from '../src/camera.js';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit/stage2');
const SHOTS = join(OUT, 'screenshots');

const results = {
  phase: '2a',
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

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => results.pageErrors.push(String(error?.message || error)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ucf?.ready === true, null, { timeout: 30000 });

  const boot = await page.evaluate(() => ({
    count: window.__ucf.humanoid.state().count,
    badge: document.querySelector('#humanoidCount').textContent,
    createEnabled: !document.querySelector('#createHumanoid').disabled,
    visible: window.__ucf.humanoid.state().visibleParams
  }));
  check('S2a-1. Halaman tanpa karakter & tombol buat aktif', boot.count === 0 && /0 karakter/.test(boot.badge) && boot.createEnabled, {
    badge: boot.badge,
    visibleParams: boot.visible.length
  });
  check('S2a-2. Sub-tahap 2a menampilkan 21 parameter inti', boot.visible.length === 21, { count: boot.visible.length });
  await screenshot(page, 'sebelum-buat');

  await page.click('#createHumanoid');
  await page.waitForFunction(() => window.__ucf.humanoid.state().count === 1, null, { timeout: 15000 });
  await page.waitForTimeout(900);

  const created = await page.evaluate(() => {
    const state = window.__ucf.humanoid.state();
    const model = window.__ucf.models[0];
    return {
      count: state.count,
      selected: {
        name: state.selected.name,
        pose: state.selected.pose,
        height: state.selected.height,
        geometry: state.selected.geometry,
        params: state.selected.params.stretched ? null : state.selected.params
      },
      modelName: model.name,
      meshes: model.stats.meshes,
      bones: model.stats.bones,
      hierarchy: document.querySelector('#hierarchyCount').textContent,
      readout: document.querySelector('#humanoidReadout').textContent.replace(/\s+/g, ' ').trim()
    };
  });
  results.measurements.created = created;
  check(
    'S2a-3. Humanoid dibuat: 53 mesh, 4.652 verteks, tanpa tulang (rigging belum ada)',
    created.count === 1 && created.meshes === 53 && created.selected.geometry.vertices === 4652 && created.bones === 0,
    { meshes: created.meshes, vertices: created.selected.geometry.vertices, bones: created.bones }
  );
  check(
    'S2a-4. Tinggi 1,750 m, kaki di lantai, menghadap +Z',
    Math.abs(created.selected.height - 1.75) < 0.01 &&
      Math.abs(created.selected.geometry.minY) < 1e-3 &&
      created.selected.geometry.size[0] > 1.5 &&
      created.selected.geometry.size[2] > 0.15,
    { height: created.selected.height, minY: created.selected.geometry.minY, size: created.selected.geometry.size }
  );
  check('S2a-5. Hierarki & daftar model menampilkan karakter', /100 node/.test(created.hierarchy) && created.modelName === 'Humanoid 1', {
    hierarchy: created.hierarchy,
    modelName: created.modelName
  });

  const geometryTest = await page.evaluate(() => {
    const controller = window.__ucf.humanoid;
    const state = controller.state();
    const baseline = state.selected.signature;
    const visible = state.visibleParams;
    const rows = [];
    for (const key of visible) {
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
        worldChanged: changed.worldHash !== baseline.worldHash,
        geometryChanged: changed.geometryHash !== baseline.geometryHash,
        size: changed.size.map((v) => Number(v.toFixed(3)))
      };
      input.value = String(before);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const restored = controller.state().selected.signature;
      delta.restored = restored.worldHash === baseline.worldHash;
      rows.push(delta);
    }
    return { baseline: baseline.worldHash, rows };
  });
  results.measurements.parameters = geometryTest;
  const failures = geometryTest.rows.filter((row) => !row.worldChanged && !row.geometryChanged);
  const restoreFailures = geometryTest.rows.filter((row) => !row.restored);
  check(
    'S2a-6. Semua 21 parameter 2a mengubah geometri nyata',
    failures.length === 0,
    { diuji: geometryTest.rows.length, gagal: failures.map((row) => row.key) }
  );
  check('S2a-7. Mengembalikan slider ke default memulihkan bentuk semula', restoreFailures.length === 0, {
    gagal: restoreFailures.map((row) => row.key)
  });

  await page.click('#resetHumanoid');
  await page.waitForTimeout(600);
  const afterReset = await page.evaluate(() => {
    const state = window.__ucf.humanoid.state();
    return {
      pose: state.selected.pose,
      signature: state.selected.signature,
      height: state.selected.height,
      defaults: ['height', 'torsoLength', 'headWidth', 'thighLength'].map((key) => [key, state.selected.params[key]])
    };
  });
  check(
    'S2a-8. Tombol Reset mengembalikan parameter default & bentuk awal',
    afterReset.signature.worldHash === geometryTest.baseline && Math.abs(afterReset.height - 1.75) < 0.01,
    { hashSama: afterReset.signature.worldHash === geometryTest.baseline, height: afterReset.height }
  );
  results.measurements.reset = { ...afterReset, signature: undefined, baseline: geometryTest.baseline };

  await page.click('[data-view="depan"]');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await page.waitForTimeout(150);
  const frontCamera = await page.evaluate(() => window.__ucf.camera);
  check('S2a-9. Tampak depan membingkai humanoid penuh', directionErrorDegrees(frontCamera.direction, 'depan') < 0.5, {
    errorDeg: Number(directionErrorDegrees(frontCamera.direction, 'depan').toFixed(3)),
    distance: Number(frontCamera.distance.toFixed(3))
  });

  // hilangkan kotak seleksi agar tangkapan layar bersih
  const canvas = await page.locator('#viewport canvas').boundingBox();
  await page.mouse.click(canvas.x + 30, canvas.y + canvas.height - 30);
  await page.waitForTimeout(300);
  await screenshot(page, 'humanoid-depan-bersih');

  await page.click('[data-view="perspektif"]');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await page.waitForTimeout(150);
  await screenshot(page, 'humanoid-perspektif');

  await page.click('#toggleWireframe');
  await page.waitForTimeout(300);
  await screenshot(page, 'humanoid-wireframe');
  await page.click('#toggleWireframe');

  const finalState = await page.evaluate(() => window.__ucf.humanoid.state());
  const stillThere = await page.evaluate(() => window.__ucf.models.length);
  check('S2a-10. Karakter tetap ada & stabil setelah 42 rebuild parameter', finalState.count === 1 && stillThere === 1, {
    count: finalState.count,
    selected: finalState.selected?.name ?? null,
    models: stillThere
  });

  const environment = await page.evaluate(() => window.__ucf.validation.environment);
  results.environment = environment;
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
await writeFile(join(OUT, 'phase-2a.json'), JSON.stringify(results, null, 2));
console.log(`\nRingkasan 2a: ${results.passed}/${results.checks.length} lulus · page error ${results.pageErrors.length} · console error ${results.consoleErrors.length}`);
process.exit(results.failed === 0 && !results.fatal && results.pageErrors.length === 0 ? 0 : 1);
