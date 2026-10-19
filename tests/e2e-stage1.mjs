/**
 * UCF Tahap 1 — uji end-to-end dengan Chromium (Playwright).
 *
 * Menguji aplikasi hasil build nyata (dist) lewat server statis:
 *  - boot, WebGL, helper default
 *  - impor GLB ber-skeleton & glTF tanpa rig (angka dari berkas nyata)
 *  - enam tampilan kamera (diukur dengan sudut galat)
 *  - orbit / zoom / pan / fit / reset (diukur, bukan diklaim)
 *  - wireframe, bounding box, grid, sumbu
 *  - hierarki, pencarian, pemilihan tulang, pemilihan mesh via raycast
 *  - ekstensi tak didukung, ekstensi wajib (BLOCKED), berkas rusak (FAIL), drag & drop
 *  - tata letak ponsel 390×844
 *
 * Keluaran: ucf-audit/stage1-e2e.json + tangkapan layar di ucf-audit/screenshots/
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { directionErrorDegrees } from '../src/camera.js';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit');
const SHOTS = join(OUT, 'screenshots');
const ROOT = resolve(process.cwd());

const results = {
  startedAt: new Date().toISOString(),
  url: BASE,
  browser: 'chromium (Playwright 1.64.1, headless)',
  checks: [],
  measurements: { cameras: {}, imports: {}, interactions: {} },
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
  return file;
}

function check(name, pass, detail = {}) {
  results.checks.push({ name, pass: Boolean(pass), detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail && Object.keys(detail).length ? ' — ' + JSON.stringify(detail) : ''}`);
}

function near(a, b, tolerance) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
function angleBetween(a, b) {
  const la = length(a);
  const lb = length(b);
  if (!la || !lb) return 0;
  const cos = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const camera = (page) => page.evaluate(() => window.__ucf.camera);

async function clickView(page, view) {
  await page.click(`[data-view="${view}"]`);
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await page.waitForTimeout(120);
}

async function importPath(page, relativePath, expectedName = basename(relativePath)) {
  await page.setInputFiles('#modelFile', resolve(ROOT, relativePath));
  await page.waitForFunction(
    (name) =>
      window.__ucf.lastImport?.fileName === name ||
      window.__ucf.validation.records.some((record) => record.model === name && record.result !== 'PASS'),
    expectedName,
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') results.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => results.pageErrors.push(String(error?.message || error)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ucf?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(700);

  /* ---------------- A. Boot ---------------- */
  const title = await page.title();
  check('A1. Judul aplikasi UCF tampil', title.includes('Universal Character Foundry'), { title });

  const engine = await page.textContent('#engineBadge');
  check('A2. three r180 + WebGL2 aktif', /three r180/.test(engine) && /WebGL2/.test(engine), { engine });

  const canvasSize = await page.evaluate(() => {
    const canvas = document.querySelector('#viewport canvas');
    return canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null;
  });
  check('A3. Kanvas viewport punya ukuran nyata', canvasSize && canvasSize.width > 700 && canvasSize.height > 600, canvasSize);

  const defaults = await page.evaluate(() => ({
    toggles: window.__ucf.toggles,
    helpers: window.__ucf.helpers,
    ui: {
      wireframe: document.querySelector('#toggleWireframe').checked,
      grid: document.querySelector('#toggleGrid').checked,
      axes: document.querySelector('#toggleAxes').checked,
      bbox: document.querySelector('#toggleBBox').checked
    }
  }));
  check(
    'A4. Default: wireframe OFF, grid ON, sumbu ON, bounding box OFF',
    defaults.ui.wireframe === false && defaults.ui.grid === true && defaults.ui.axes === true && defaults.ui.bbox === false &&
      defaults.toggles.wireframe === false && defaults.toggles.bbox === false,
    defaults.ui
  );
  check(
    'A5. Helper terpisah dari model (ucfHelper, tidak ada di dalam model)',
    defaults.helpers.insideModels === 0 && defaults.helpers.count >= 5 && defaults.helpers.names.includes('Helper_Grid'),
    { insideModels: defaults.helpers.insideModels, count: defaults.helpers.count, names: defaults.helpers.names }
  );

  const initialCamera = await camera(page);
  const initialError = directionErrorDegrees(initialCamera.direction, 'perspektif');
  check('A6. Kamera awal = perspektif & menatap pusat default', initialError < 0.5 && near(initialCamera.target[1], 0.9, 0.05), {
    errorDeg: Number(initialError.toFixed(3)),
    target: initialCamera.target
  });
  await screenshot(page, 'boot');

  /* ---------------- B. Impor tanpa rig ---------------- */
  await importPath(page, 'test-assets/box-tanpa-rig.gltf');
  const box = await page.evaluate(() => ({
    report: window.__ucf.lastImport,
    models: window.__ucf.models,
    hierarchy: document.querySelector('#hierarchyCount').textContent
  }));
  results.measurements.imports.box = box.report;
  check(
    'B1. glTF tanpa rig diimpor (1 mesh, 0 tulang, 12 segitiga)',
    box.report?.ok === true &&
      box.report.stats.meshes === 1 &&
      box.report.stats.skinnedMeshes === 0 &&
      box.report.stats.bones === 0 &&
      box.report.stats.triangles === 12,
    { stats: box.report?.stats && { meshes: box.report.stats.meshes, bones: box.report.stats.bones, triangles: box.report.stats.triangles } }
  );
  check(
    'B2. Dimensi & penempatan: 0,40 × 0,90 × 0,30 m, kaki di lantai (y=0)',
    near(box.report?.stats.size[0], 0.4, 1e-3) && near(box.report?.stats.size[1], 0.9, 1e-3) && near(box.report?.stats.size[2], 0.3, 1e-3) &&
      near(box.models[0]?.bounds.min[1], 0, 0.005),
    { size: box.report?.stats.size, bounds: box.models[0]?.bounds }
  );
  check('B3. Hierarki menampilkan node nyata (2 node)', /2 node/.test(box.hierarchy), { hierarchy: box.hierarchy });
  await screenshot(page, 'import-tanpa-rig');

  /* ---------------- C. Impor ber-skeleton ---------------- */
  await importPath(page, 'test-assets/XBot.glb');
  const xbot = await page.evaluate(() => ({
    report: window.__ucf.lastImport,
    models: window.__ucf.models,
    hierarchy: document.querySelector('#hierarchyCount').textContent,
    renderInfo: document.querySelector('#renderInfo').textContent
  }));
  results.measurements.imports.xbot = xbot.report;
  check(
    'C1. GLB ber-skeleton diimpor: 2 skinned mesh, 67 tulang, 2 skeleton',
    xbot.report?.stats.skinnedMeshes === 2 && xbot.report?.stats.bones === 67 && xbot.report?.stats.skeletons === 2,
    { skinned: xbot.report?.stats.skinnedMeshes, bones: xbot.report?.stats.bones, skeletons: xbot.report?.stats.skeletons }
  );
  check(
    'C2. Klip animasi terbaca (7 klip, termasuk idle/walk/run)',
    xbot.report?.stats.clips === 7 && ['idle', 'walk', 'run'].every((name) => xbot.report.stats.clipNames.includes(name)),
    { clips: xbot.report?.stats.clipNames }
  );
  check(
    'C3. Dua model berdampingan tanpa tumpang tindih & kaki di lantai',
    xbot.models.length === 2 &&
      xbot.models[1].bounds.min[0] > xbot.models[0].bounds.max[0] + 0.1 &&
      near(xbot.models[1].bounds.min[1], 0, 0.01),
    { boxMaxX: xbot.models[0]?.bounds.max[0], xbotMinX: xbot.models[1]?.bounds.min[0], xbotMinY: xbot.models[1]?.bounds.min[1] }
  );
  check('C4. Hierarki gabungan 73 node & ringkasan segitiga tampil', /73 node/.test(xbot.hierarchy) && /segiti?ga/.test(xbot.renderInfo), {
    hierarchy: xbot.hierarchy,
    renderInfo: xbot.renderInfo
  });
  await screenshot(page, 'import-xbot');

  /* ---------------- D. Enam tampilan kamera ---------------- */
  const viewReport = {};
  let worstViewError = 0;
  let allCornersInside = true;
  for (const view of ['depan', 'belakang', 'kiri', 'kanan', 'atas', 'perspektif']) {
    await clickView(page, view);
    const state = await camera(page);
    const corners = await page.evaluate(() => window.__ucf.projectCorners());
    const inside = corners.every(([x, y, z]) => Math.abs(x) <= 1.01 && Math.abs(y) <= 1.01 && z <= 1.01);
    const error = directionErrorDegrees(state.direction, view);
    worstViewError = Math.max(worstViewError, error);
    allCornersInside = allCornersInside && inside;
    viewReport[view] = {
      errorDeg: Number(error.toFixed(4)),
      distance: Number(state.distance.toFixed(4)),
      cornersInside: inside,
      target: state.target.map((value) => Number(value.toFixed(4)))
    };
    if (view === 'depan') await screenshot(page, 'tampak-depan');
    if (view === 'atas') await screenshot(page, 'tampak-atas');
  }
  results.measurements.cameras.views = viewReport;
  check('D1. Enam preset kamera tepat arah (galat < 0,1°)', worstViewError < 0.1, {
    worstErrorDeg: Number(worstViewError.toFixed(4))
  });
  check('D2. Seluruh sudut bounding box masuk frustum pada setiap tampilan', allCornersInside, { views: viewReport });

  const targetBefore = (await camera(page)).target;
  const chipActive = await page.textContent('.chip.active');
  check('D3. Tombol tampilan aktif ditandai di UI', chipActive.trim() === 'Perspektif', { chipActive });

  /* ---------------- E. Zoom / orbit / pan ---------------- */
  const canvasBox = await page.locator('#viewport canvas').boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;

  const beforeZoom = await camera(page);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(600);
  const afterZoom = await camera(page);
  results.measurements.interactions.zoom = { before: beforeZoom.distance, after: afterZoom.distance };
  check('E1. Zoom roda memperdekat kamera (jarak turun >5%)', afterZoom.distance < beforeZoom.distance * 0.95, results.measurements.interactions.zoom);

  const beforeOrbit = await camera(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 12, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterOrbit = await camera(page);
  const orbitAngle = angleBetween(beforeOrbit.direction, afterOrbit.direction);
  results.measurements.interactions.orbit = { angleDeg: Number(orbitAngle.toFixed(3)) };
  check('E2. Orbit mengubah arah kamera (>3°)', orbitAngle > 3, results.measurements.interactions.orbit);

  const beforePan = await camera(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx, cy + 90, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(600);
  const afterPan = await camera(page);
  const panShift = Math.hypot(
    afterPan.target[0] - beforePan.target[0],
    afterPan.target[1] - beforePan.target[1],
    afterPan.target[2] - beforePan.target[2]
  );
  results.measurements.interactions.pan = { shiftMeters: Number(panShift.toFixed(3)) };
  check('E3. Pan menggeser target kamera (>0,05 m)', panShift > 0.05, results.measurements.interactions.pan);

  /* ---------------- F. Fit & reset ---------------- */
  await page.click('#cameraFit');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await page.waitForTimeout(120);
  const fitted = await camera(page);
  const fittedCorners = await page.evaluate(() => window.__ucf.projectCorners());
  check(
    'F1. "Muat semua" membingkai seluruh model (tidak terpotong)',
    fittedCorners.every(([x, y]) => Math.abs(x) <= 1.01 && Math.abs(y) <= 1.01),
    { distance: Number(fitted.distance.toFixed(3)) }
  );

  const targetAfterFit = (await camera(page)).target;
  const refit = await page.evaluate(() => {
    const model = window.__ucf.models[0];
    const box2 = window.__ucf.models[1];
    return { x: (Math.min(model.bounds.min[0], box2.bounds.min[0]) + Math.max(model.bounds.max[0], box2.bounds.max[0])) / 2 };
  });
  check('F2. Fit memusatkan kamera pada gabungan model', near(targetAfterFit[0], refit.x, 0.05), {
    targetX: Number(targetAfterFit[0].toFixed(3)),
    expectedX: Number(refit.x.toFixed(3))
  });

  await page.click('#cameraReset');
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__ucf.cameraSettled === true, null, { timeout: 8000 });
  await page.waitForTimeout(120);
  const reset = await camera(page);
  check(
    'F3. Reset kamera kembali ke perspektif & target semula',
    directionErrorDegrees(reset.direction, 'perspektif') < 0.5 &&
      Math.hypot(reset.target[0] - targetBefore[0], reset.target[1] - targetBefore[1], reset.target[2] - targetBefore[2]) < 1.5,
    { errorDeg: Number(directionErrorDegrees(reset.direction, 'perspektif').toFixed(3)), target: reset.target }
  );

  /* ---------------- G. Wireframe / bounding box / grid ---------------- */
  await page.click('#toggleWireframe');
  await page.waitForTimeout(250);
  const wire = await page.evaluate(() => ({ materials: window.__ucf.materials(), toggles: window.__ucf.toggles }));
  results.measurements.wireframe = wire;
  check('G1. Wireframe ON diterapkan ke semua material model', wire.materials.total > 0 && wire.materials.wireframe === wire.materials.total, wire.materials);
  await screenshot(page, 'wireframe');
  await page.click('#toggleWireframe');
  await page.waitForTimeout(250);
  const wireOff = await page.evaluate(() => window.__ucf.materials());
  check('G2. Wireframe OFF mengembalikan material semula', wireOff.wireframe === 0, wireOff);

  await page.click('#toggleBBox');
  await page.waitForTimeout(300);
  const bboxOn = await page.evaluate(() => window.__ucf.helpers);
  check('G3. Bounding box ON menampilkan helper tanpa masuk ke model', bboxOn.bbox === true && bboxOn.insideModels === 0, bboxOn);
  await screenshot(page, 'bounding-box');
  await page.click('#toggleBBox');
  await page.waitForTimeout(200);

  await page.click('#toggleGrid');
  await page.click('#toggleAxes');
  await page.waitForTimeout(250);
  const helperOff = await page.evaluate(() => window.__ucf.helpers);
  check('G4. Grid & sumbu bisa dimatikan', helperOff.grid === false && helperOff.axes === false, helperOff);
  await screenshot(page, 'helper-off');
  await page.click('#toggleGrid');
  await page.click('#toggleAxes');
  await page.waitForTimeout(200);

  const toggleRecord = await page.evaluate(() =>
    window.__ucf.validation.records.find((record) => record.test === 'Empat toggle tampilan diuji') || null
  );
  check('G5. Log validasi mencatat empat toggle diuji', toggleRecord?.result === 'PASS', toggleRecord?.details || null);

  /* ---------------- H. Hierarki & pemilihan ---------------- */
  const nodeCount = await page.evaluate(() => document.querySelectorAll('#hierarchyTree .tree-row').length);
  check('H1. Hierarki merender seluruh node (73 baris)', nodeCount === 73, { nodeCount });

  await page.fill('#hierarchySearch', 'Hand');
  await page.waitForTimeout(300);
  const filterStats = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#hierarchyTree .tree-row')];
    const visible = rows.filter((row) => row.offsetParent !== null);
    const matched = visible.filter((row) => /hand/i.test(row.querySelector('.tree-name')?.textContent || ''));
    return {
      visible: visible.length,
      matched: matched.length,
      names: matched.map((row) => row.querySelector('.tree-name')?.textContent).slice(0, 6)
    };
  });
  check(
    'H2. Pencarian hierarki menyaring node (Hand + leluhurnya)',
    filterStats.matched > 0 && filterStats.visible < nodeCount && filterStats.visible > filterStats.matched,
    filterStats
  );

  await page.fill('#hierarchySearch', 'Hips');
  await page.waitForTimeout(300);
  await page.locator('#hierarchyTree .tree-row', { hasText: 'Hips' }).first().click();
  await page.waitForTimeout(250);
  const boneSelection = await page.evaluate(() => ({
    selection: window.__ucf.selection,
    info: document.querySelector('#nodeInfo').textContent
  }));
  check('H3. Klik tulang memilih node bertipe Tulang', boneSelection.selection?.isBone === true && /Tulang/.test(boneSelection.info), boneSelection.selection);
  await screenshot(page, 'hierarki-tulang');
  await page.fill('#hierarchySearch', '');
  await page.waitForTimeout(200);

  const pick = await page.evaluate(() => {
    const model = window.__ucf.models[1];
    const center = [
      (model.bounds.min[0] + model.bounds.max[0]) / 2,
      (model.bounds.min[1] + model.bounds.max[1]) / 2,
      (model.bounds.min[2] + model.bounds.max[2]) / 2
    ];
    const ndc = window.__ucf.projectPoint(center);
    const canvas = document.querySelector('#viewport canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (ndc[0] * 0.5 + 0.5) * rect.width,
      y: rect.top + (-ndc[1] * 0.5 + 0.5) * rect.height,
      ndc
    };
  });
  await page.mouse.click(pick.x, pick.y);
  await page.waitForTimeout(300);
  const meshSelection = await page.evaluate(() => window.__ucf.selection);
  check('H4. Klik mesh di viewport memilih mesh (raycast)', meshSelection?.isMesh === true, { selection: meshSelection, pick });

  /* ---------------- I. Ekstensi tak didukung ---------------- */
  await importPath(page, 'test-assets/ekstensi-tak-didukung.gltf');
  const ext = await page.evaluate(() => ({
    report: window.__ucf.lastImport,
    models: window.__ucf.models.length,
    reportText: document.querySelector('#importReport').textContent
  }));
  check(
    'I1. Ekstensi tak didukung dilaporkan sebagai peringatan (impor tetap sukses)',
    ext.report?.ok === true &&
      ext.report.warnings.some((warning) => /pbrSpecularGlossiness/.test(warning)) &&
      ext.report.warnings.some((warning) => /KHR_texture_basisu/.test(warning)) &&
      /pbrSpecularGlossiness/.test(ext.reportText),
    { warnings: ext.report?.warnings }
  );
  check('I2. Model ketiga ditambahkan tanpa menimpa model lain', ext.models === 3, { models: ext.models });
  await screenshot(page, 'peringatan-ekstensi');

  /* ---------------- J. Negatif: BLOCKED & FAIL ---------------- */
  const dracoJson = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression']
  };
  await page.setInputFiles('#modelFile', {
    name: 'draco-wajib.gltf',
    mimeType: 'model/gltf+json',
    buffer: Buffer.from(JSON.stringify(dracoJson))
  });
  await page.waitForFunction(
    () => window.__ucf.validation.records.some((record) => record.model === 'draco-wajib.gltf' && record.result === 'BLOCKED'),
    null,
    { timeout: 15000 }
  );
  const blockedRecord = await page.evaluate(() =>
    window.__ucf.validation.records.find((record) => record.model === 'draco-wajib.gltf')
  );
  const blockedText = await page.textContent('#importReport');
  check('J1. Ekstensi wajib tak didukung → BLOCKED (bukan PASS)', blockedRecord?.result === 'BLOCKED' && /diblokir/i.test(blockedText), {
    result: blockedRecord?.result,
    errors: blockedRecord?.errors
  });

  await page.setInputFiles('#modelFile', {
    name: 'rusak.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from('ini bukan berkas glb')
  });
  await page.waitForFunction(
    () => window.__ucf.validation.records.some((record) => record.model === 'rusak.glb' && record.result === 'FAIL'),
    null,
    { timeout: 15000 }
  );
  const brokenRecord = await page.evaluate(() => window.__ucf.validation.records.find((record) => record.model === 'rusak.glb'));
  check('J2. Berkas rusak → FAIL dengan pesan jelas', brokenRecord?.result === 'FAIL' && /tidak terbaca|JSON/i.test(brokenRecord.errors[0]), {
    errors: brokenRecord?.errors
  });

  await page.setInputFiles('#modelFile', {
    name: 'model.fbx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('FBX palsu')
  });
  await page.waitForFunction(
    () => window.__ucf.validation.records.some((record) => record.model === 'model.fbx' && record.result === 'FAIL'),
    null,
    { timeout: 15000 }
  );
  const fbxRecord = await page.evaluate(() => window.__ucf.validation.records.find((record) => record.model === 'model.fbx'));
  check('J3. Format .fbx ditolak eksplisit (Tahap 1 belum mendukung FBX)', /tidak didukung/i.test(fbxRecord?.errors[0] || ''), {
    errors: fbxRecord?.errors
  });

  const modelsAfterFailures = await page.evaluate(() => window.__ucf.models.length);
  check('J4. Impor gagal tidak menambah/menghapus model', modelsAfterFailures === 3, { models: modelsAfterFailures });
  await screenshot(page, 'validasi-negatif');

  /* ---------------- K. Drag & drop ---------------- */
  const dropBase64 = readFileSync(resolve(ROOT, 'test-assets/box-tanpa-rig.gltf')).toString('base64');
  await page.evaluate(({ base64, name }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], name, { type: 'model/gltf+json' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const target = document.querySelector('#viewport canvas');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }
  }, { base64: dropBase64, name: 'drop-box.gltf' });
  await page.waitForFunction(() => window.__ucf.lastImport?.fileName === 'drop-box.gltf', null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const dropModels = await page.evaluate(() => window.__ucf.models.length);
  check('K1. Drag & drop menambah model (4 model)', dropModels === 4, { models: dropModels });

  /* ---------------- L. Bersihkan ---------------- */
  await page.click('#clearAll');
  await page.waitForTimeout(600);
  const cleared = await page.evaluate(() => ({
    models: window.__ucf.models.length,
    hierarchy: document.querySelector('#hierarchyCount').textContent,
    last: window.__ucf.validation.records.at(-1)
  }));
  check('L1. "Bersihkan" menghapus semua model & hierarki kosong', cleared.models === 0 && /0 node/.test(cleared.hierarchy) && cleared.last?.result === 'PASS', cleared);
  await screenshot(page, 'viewport-kosong');

  const appValidation = await page.evaluate(() => window.__ucf.validation);
  results.measurements.appValidation = {
    summary: appValidation.summary,
    records: appValidation.records.map((record) => ({
      test: record.test,
      model: record.model,
      result: record.result,
      warnings: record.warnings.length,
      errors: record.errors.length
    }))
  };

  /* ---------------- M. Ponsel 390×844 ---------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__ucf?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(600);

  const mobileLayout = await page.evaluate(() => {
    const canvas = document.querySelector('#viewport canvas');
    const left = document.querySelector('#panelLeft');
    const right = document.querySelector('#panelRight');
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
      leftOpen: left.classList.contains('open'),
      rightOpen: right.classList.contains('open'),
      toggleVisible: getComputedStyle(document.querySelector('#toggleLeft')).display !== 'none'
    };
  });
  check(
    'M1. Tata letak ponsel: kanvas penuh, tanpa scroll horizontal, panel tertutup',
    mobileLayout.canvas.width >= 388 &&
      mobileLayout.canvas.height > 500 &&
      mobileLayout.scrollWidth <= mobileLayout.innerWidth + 1 &&
      !mobileLayout.leftOpen && !mobileLayout.rightOpen && mobileLayout.toggleVisible,
    mobileLayout
  );

  await page.click('#toggleLeft');
  await page.waitForTimeout(300);
  const drawerOpen = await page.evaluate(() => ({
    open: document.querySelector('#panelLeft').classList.contains('open'),
    backdrop: !document.querySelector('#drawerBackdrop').hidden
  }));
  await screenshot(page, 'ponsel-drawer');
  // klik area backdrop di luar panel (panel 340 px di layar 390 px)
  await page.click('#drawerBackdrop', { position: { x: 378, y: 240 } });
  await page.waitForTimeout(300);
  const drawerClosed = await page.evaluate(() => document.querySelector('#panelLeft').classList.contains('open'));
  check('M2. Drawer panel terbuka & tertutup di ponsel', drawerOpen.open && drawerOpen.backdrop && drawerClosed === false, {
    drawerOpen,
    drawerClosed
  });

  await page.setInputFiles('#modelFile', resolve(ROOT, 'test-assets/XBot.glb'));
  await page.waitForFunction(() => window.__ucf.lastImport?.fileName === 'XBot.glb', null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await clickView(page, 'depan');
  const mobileCamera = await camera(page);
  const mobileCorners = await page.evaluate(() => window.__ucf.projectCorners());
  check(
    'M3. Tampilan "Depan" & framing bekerja di layar 390×844',
    directionErrorDegrees(mobileCamera.direction, 'depan') < 0.5 &&
      mobileCorners.every(([x, y]) => Math.abs(x) <= 1.01 && Math.abs(y) <= 1.01),
    {
      errorDeg: Number(directionErrorDegrees(mobileCamera.direction, 'depan').toFixed(3)),
      distance: Number(mobileCamera.distance.toFixed(3)),
      aspect: Number(mobileCamera.aspect.toFixed(3))
    }
  );
  await screenshot(page, 'ponsel-tampak-depan');

  const finalEnvironment = await page.evaluate(() => window.__ucf.validation.environment);
  results.environment = finalEnvironment;
  results.finishedAt = new Date().toISOString();
  await browser.close();
}

try {
  await main();
} catch (error) {
  results.fatal = String(error?.stack || error);
  console.error('FATAL:', results.fatal);
}

results.finishedAt = results.finishedAt || new Date().toISOString();
results.consoleErrors = [...new Set(results.consoleErrors)];
results.pageErrors = [...new Set(results.pageErrors)];
results.passed = results.checks.filter((entry) => entry.pass).length;
results.failed = results.checks.filter((entry) => !entry.pass).length;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'stage1-e2e.json'), JSON.stringify(results, null, 2));
console.log(`\nRingkasan: ${results.passed}/${results.checks.length} cek lulus · page error ${results.pageErrors.length} · console error ${results.consoleErrors.length}`);
if (results.pageErrors.length) console.log('Page errors:', results.pageErrors);

const ok = results.failed === 0 && !results.fatal && results.pageErrors.length === 0;
process.exit(ok ? 0 : 1);
