/**
 * UCF Tahap 4 — uji browser sistem modular karakter.
 * Menguji pemasangan/pelepasan lewat UI nyata, kestabilan mesh & tulang,
 * deformasi sendi/jari setelah modul terpasang, operasi instance,
 * impor manifest, dan simpan/muat config.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = process.env.UCF_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.UCF_OUT || resolve('/home/user/ucf-audit/stage4');
const SHOTS = join(OUT, 'screenshots');

const results = {
  phase: '4',
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

const modularState = (page) => page.evaluate(() => window.__ucf.modular.state());
const modelStats = (page) => page.evaluate(() => window.__ucf.models[0].stats);

async function attachViaUI(page, moduleId) {
  await page.locator(`.module-card[data-module-id="${moduleId}"] button[data-act="attach"]`).click();
  await page.waitForTimeout(650);
}

async function detachViaUI(page, instanceId) {
  await page.locator(`.module-item[data-instance-id="${instanceId}"] button[data-act="detach"]`).first().click();
  await page.waitForTimeout(500);
}

async function attachViaApi(page, moduleId) {
  const result = await page.evaluate((id) => {
    const res = window.__ucf.modular.attach(id);
    return { ok: Boolean(res?.ok), error: res?.error || null, instanceId: res?.instance?.instanceId || null };
  }, moduleId);
  await page.waitForTimeout(450);
  return result;
}

const bodyColorsHash = (page) => page.evaluate(() => {
  const colors = [];
  window.__ucf.scene.traverse((object) => {
    if (!object.isMesh || object.name.startsWith('ML_')) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material?.color) colors.push(material.color.getHex());
  });
  return colors.sort((a, b) => a - b).join(',');
});

const bodyVertexHash = (page) => page.evaluate(() => {
  let hash = 0;
  let count = 0;
  window.__ucf.scene.traverse((object) => {
    if (!object.isMesh || object.name.startsWith('ML_')) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.array.length; i += 1) {
      hash = (hash * 31 + Math.round(position.array[i] * 1e6)) % 1000000007;
      count += 1;
    }
  });
  return `${hash}:${count}`;
});

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=1024']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => results.pageErrors.push(String(error?.message || error)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ucf?.ready === true, null, { timeout: 30000 });
  await page.click('#createHumanoid');
  await page.waitForFunction(() => window.__ucf.humanoid.state().count === 1, null, { timeout: 15000 });
  await page.waitForTimeout(900);

  /* ---------------- S4-1 library ---------------- */
  const library = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.module-card')].map((card) => ({
      moduleId: card.dataset.moduleId,
      actions: [...card.querySelectorAll('button[data-act]')].map((button) => button.dataset.act),
      badge: card.querySelector('.module-sub')?.textContent?.trim() || ''
    }));
    const categories = [...document.querySelectorAll('#moduleCategory option')].map((option) => option.value);
    return { cards, categories, countLabel: document.querySelector('#moduleCount')?.textContent };
  });
  const nonBase = library.cards.filter((card) => card.moduleId !== 'base-body-ucf');
  const attachable = nonBase.filter((card) => card.actions.includes('attach'));
  const needsBadge = library.cards.filter((card) => /NEEDS/.test(card.badge));
  results.measurements.library = {
    cards: library.cards.length,
    categories: library.categories,
    attachable: attachable.length,
    needs: needsBadge.map((card) => card.moduleId),
    countLabel: library.countLabel
  };
  check(
    'S4-1. Library menampilkan 18 modul (17 dapat dipasang), 8 kategori, status validasi terbaca',
    library.cards.length === 18 && attachable.length === 17 && library.categories.slice(1).length === 8 &&
      needsBadge.length === 1 && needsBadge[0].moduleId === 'wajah-dasar',
    results.measurements.library
  );
  await screenshot(page, 'library-modul');

  /* ---------------- S4-2 pasang lewat UI ---------------- */
  const baseline = {
    meshes: (await modelStats(page)).meshes,
    bones: (await modelStats(page)).bones,
    colors: await bodyColorsHash(page),
    vertices: await bodyVertexHash(page)
  };
  results.measurements.baseline = baseline;

  await attachViaUI(page, 'kaos-lengan-pendek');
  let state = await modularState(page);
  let stats = await modelStats(page);
  const tee = state.attached.find((item) => item.moduleId === 'kaos-lengan-pendek');
  const teeChecks = tee?.checks || [];
  const compatRows = await page.evaluate(() => document.querySelectorAll('#moduleCompat .compat-row').length);
  results.measurements.tee = {
    meshes: stats.meshes,
    bones: stats.bones,
    attached: state.attached.map((item) => ({ id: item.moduleId, status: item.status, meshes: item.meshCount })),
    checks: teeChecks.map((entry) => `${entry.id}:${entry.status}`),
    compatRows
  };
  check(
    'S4-2. Klik "Pasang" menambah mesh modul, tulang tetap 51, laporan 13 cek tampil',
    stats.meshes === 56 && stats.bones === 51 && tee && tee.status === 'VALID' &&
      teeChecks.length === 13 && teeChecks.every((entry) => entry.status === 'PASS') && compatRows >= 13,
    { meshes: stats.meshes, bones: stats.bones, status: tee?.status, cek: teeChecks.length, rows: compatRows }
  );
  await screenshot(page, 'kaos-terpasang');

  /* ---------------- S4-3 lepas lewat UI ---------------- */
  await detachViaUI(page, tee.instanceId);
  stats = await modelStats(page);
  state = await modularState(page);
  check(
    'S4-3. Klik "Lepas" mengembalikan mesh ke 53 dan menghapus instance dari daftar',
    stats.meshes === 53 && stats.bones === 51 && state.attached.length === 0,
    { meshes: stats.meshes, attached: state.attached.length }
  );

  /* ---------------- S4-4 lima modul ---------------- */
  const combo = ['kaos-lengan-pendek', 'celana-panjang', 'sepatu-boot', 'rambut-pendek', 'topi-fedora'];
  for (const moduleId of combo) await attachViaApi(page, moduleId);
  stats = await modelStats(page);
  state = await modularState(page);
  results.measurements.combo = {
    meshes: stats.meshes,
    bones: stats.bones,
    attached: state.attached.map((item) => `${item.moduleId}:${item.status}`),
    summary: state.summary
  };
  check(
    'S4-4. Lima modul terpasang serentak: 71 mesh, 51 tulang, semua VALID',
    stats.meshes === 71 && stats.bones === 51 && state.attached.length === 5 &&
      state.attached.every((item) => item.status === 'VALID'),
    { meshes: stats.meshes, bones: stats.bones, status: state.attached.map((item) => item.status) }
  );
  await screenshot(page, 'lima-modul');

  /* ---------------- S4-5 pasang-lepas berulang ---------------- */
  const first = await attachViaApi(page, 'jaket-lengan-panjang');
  let currentId = first.instanceId;
  const withJacket = (await modelStats(page)).meshes;
  const jacketMeshes = (await modularState(page)).attached.find((item) => item.moduleId === 'jaket-lengan-panjang').meshCount;
  const withoutJacket = withJacket - jacketMeshes;
  const cycle = [{ attach: withJacket }];
  for (let i = 0; i < 2; i += 1) {
    const detach = await page.evaluate((id) => window.__ucf.modular.detach(id), currentId);
    await page.waitForTimeout(400);
    cycle.push({ detach: Boolean(detach), meshes: (await modelStats(page)).meshes });
    const again = await attachViaApi(page, 'jaket-lengan-panjang');
    currentId = again.instanceId;
    cycle.push({ attach: again.ok, meshes: (await modelStats(page)).meshes, instanceId: currentId });
  }
  const detachFinal = await page.evaluate((id) => window.__ucf.modular.detach(id), currentId);
  await page.waitForTimeout(400);
  const afterCycles = await modelStats(page);
  results.measurements.cycles = { withJacket, cycle, detachFinal, after: afterCycles };
  check(
    'S4-5. Pasang-lepas jaket 3×: jumlah mesh selalu sama (tidak bertambah liar), tulang 51',
    cycle[1].meshes === withoutJacket && cycle[2].meshes === withJacket && cycle[3].meshes === withoutJacket &&
      cycle[4].meshes === withJacket && detachFinal === true && afterCycles.meshes === withoutJacket && afterCycles.bones === 51,
    { denganJaket: withJacket, tanpaJaket: withoutJacket, siklus: cycle, akhir: afterCycles.meshes }
  );
  const reattached = await attachViaApi(page, 'jaket-lengan-panjang');
  check('S4-5b. Modul jaket bisa dipasang lagi setelah dilepas', reattached.ok, reattached);

  /* ---------------- S4-6 deformasi siku ---------------- */
  const deform = await page.evaluate(() => window.__ucf.humanoid.measureDeformation({ boneName: 'LowerArm_R', axis: 'z', angleDeg: 60 }));
  const baselineDeform = results.measurements.baselineDeform = 1212;
  results.measurements.deformation = deform;
  check(
    'S4-6. Siku 60° dengan modul terpasang: lengan+jaket bergerak >0,4 m, reset bersih',
    deform.ok && deform.maxDisplacement > 0.4 && deform.movedVertices > baselineDeform &&
      deform.headDisplacement < 0.001 && deform.resetError < 1e-5,
    { max_m: Number(deform.maxDisplacement.toFixed(4)), verteks: deform.movedVertices, reset: deform.resetError }
  );

  /* ---------------- S4-7 deformasi jari ---------------- */
  const finger = await page.evaluate(() => window.__ucf.humanoid.measureDeformation({ boneName: 'Finger_Index_R_2', axis: 'z', angleDeg: 60 }));
  results.measurements.finger = finger;
  check(
    'S4-7. Jari telunjuk tetap berdeformasi setelah modul terpasang',
    finger.ok && finger.maxDisplacement > 0.02 && finger.resetError < 1e-5,
    { max_m: Number(finger.maxDisplacement.toFixed(4)), verteks: finger.movedVertices }
  );

  /* ---------------- S4-8 karakter diputar ---------------- */
  const rotation = await page.evaluate(() => {
    const name = window.__ucf.humanoid.state().selected.name;
    const root = window.__ucf.scene.getObjectByName(name);
    if (!root) return { ok: false, error: 'root karakter tidak ditemukan' };
    const V = root.position.constructor;
    const meshes = [];
    root.traverse((object) => { if (object.isMesh) meshes.push(object); });
    const origin = root.getWorldPosition(new V());
    const sample = (mesh) => {
      const count = mesh.geometry.getAttribute('position').count;
      const vector = new V();
      mesh.getVertexPosition(Math.floor(count / 2), vector);
      vector.applyMatrix4(mesh.matrixWorld).sub(origin);
      return vector.toArray();
    };
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    const before = meshes.map(sample);
    root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld(true);
    const after = meshes.map(sample);
    const radius = (p) => Math.hypot(p[0], p[2]);
    const angle = (p) => Math.atan2(p[0], p[2]);
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let moduleCount = 0;
    let minModuleMove = Infinity;
    let maxRadiusError = 0;
    let minDelta = Infinity;
    let maxDelta = -Infinity;
    meshes.forEach((mesh, index) => {
      const a = before[index];
      const b = after[index];
      maxRadiusError = Math.max(maxRadiusError, Math.abs(radius(a) - radius(b)), Math.abs(a[1] - b[1]));
      if (/^ML_/.test(mesh.name)) {
        moduleCount += 1;
        const move = distance(a, b);
        if (radius(a) > 0.12) minModuleMove = Math.min(minModuleMove, move);
      }
      if (radius(a) > 0.12) {
        let delta = angle(b) - angle(a);
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        minDelta = Math.min(minDelta, delta);
        maxDelta = Math.max(maxDelta, delta);
      }
    });
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    return {
      ok: true,
      meshes: meshes.length,
      modules: moduleCount,
      minModuleMove: Number(minModuleMove.toFixed(4)),
      maxRadiusError,
      minDelta: Number(minDelta.toFixed(4)),
      maxDelta: Number(maxDelta.toFixed(4))
    };
  });
  results.measurements.rotation = rotation;
  check(
    'S4-8. Karakter diputar 90°: verteks modul ikut berputar, radius & tinggi tetap',
    rotation.ok && rotation.modules > 0 && rotation.minModuleMove > 0.1 &&
      rotation.maxRadiusError < 1e-4 && rotation.minDelta > Math.PI / 2 - 0.01 && rotation.maxDelta < Math.PI / 2 + 0.01,
    rotation
  );

  const rotatedDeform = await page.evaluate(() => window.__ucf.humanoid.measureDeformation({ boneName: 'LowerArm_R', axis: 'z', angleDeg: 60 }));
  check(
    'S4-8b. Deformasi sendi tetap bekerja pada karakter yang sudah diputar',
    rotatedDeform.ok && rotatedDeform.maxDisplacement > 0.4 && rotatedDeform.resetError < 1e-5,
    { max_m: Number(rotatedDeform.maxDisplacement.toFixed(4)), reset: rotatedDeform.resetError }
  );
  await page.evaluate(() => {
    const name = window.__ucf.humanoid.state().selected.name;
    const root = window.__ucf.scene.getObjectByName(name);
    if (root) { root.rotation.y = 0; root.updateMatrixWorld(true); }
  });
  await screenshot(page, 'deformasi-dengan-modul');

  /* ---------------- S4-9 rename lewat UI ---------------- */
  state = await modularState(page);
  const hat = state.attached.find((item) => item.moduleId === 'topi-fedora');
  await page.fill(`.module-item[data-instance-id="${hat.instanceId}"] .module-name`, 'Fedora Uji UI');
  await page.locator(`.module-item[data-instance-id="${hat.instanceId}"] .module-name`).press('Tab');
  await page.waitForTimeout(500);
  state = await modularState(page);
  const renamed = state.attached.find((item) => item.instanceId === hat.instanceId);
  const nameVisible = await page.locator(`.module-item[data-instance-id="${hat.instanceId}"] .module-name`).inputValue();
  check(
    'S4-9. Rename modul lewat input daftar terpasang tersimpan di state & UI',
    renamed?.name === 'Fedora Uji UI' && nameVisible === 'Fedora Uji UI',
    { nama: renamed?.name }
  );

  /* ---------------- S4-10 visibilitas ---------------- */
  const beforeHide = await modelStats(page);
  await page.uncheck(`.module-item[data-instance-id="${hat.instanceId}"] .module-visible`);
  await page.waitForTimeout(450);
  const hidden = await page.evaluate(() => {
    let hiddenMeshes = 0;
    let moduleMeshes = 0;
    window.__ucf.scene.traverse((object) => {
      if (object.isMesh && object.name.startsWith('ML_')) {
        moduleMeshes += 1;
        if (!object.visible) hiddenMeshes += 1;
      }
    });
    return { hiddenMeshes, moduleMeshes };
  });
  state = await modularState(page);
  await page.check(`.module-item[data-instance-id="${hat.instanceId}"] .module-visible`);
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => {
    let visible = 0;
    window.__ucf.scene.traverse((object) => {
      if (object.isMesh && object.name.startsWith('ML_')) visible += object.visible ? 1 : 0;
    });
    return visible;
  });
  stats = await modelStats(page);
  check(
    'S4-10. Checkbox visibilitas menyembunyikan/menampilkan mesh modul tanpa mengubah jumlah mesh',
    hidden.hiddenMeshes > 0 && state.attached.find((item) => item.instanceId === hat.instanceId)?.visible === false &&
      stats.meshes === beforeHide.meshes && shown === hidden.moduleMeshes,
    { hidden, sebelum: beforeHide.meshes, sesudah: stats.meshes, tampil: shown }
  );

  /* ---------------- S4-11 material ---------------- */
  const colorsBefore = await bodyColorsHash(page);
  await page.evaluate((instanceId) => {
    const input = document.querySelector(`.module-item[data-instance-id="${instanceId}"] .module-color`);
    input.value = '#7a1122';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hat.instanceId);
  await page.waitForTimeout(500);
  const material = await page.evaluate((id) => {
    const sceneColor = [];
    window.__ucf.scene.traverse((object) => {
      if (object.isMesh && object.name.startsWith('ML_') && object.material?.color) sceneColor.push(object.material.color.getHex());
    });
    return { colors: sceneColor, hex: sceneColor[0]?.toString(16) };
  }, hat.instanceId);
  const colorsAfter = await bodyColorsHash(page);
  check(
    'S4-11. Ubah warna modul hanya menyentuh material modul, material body tidak berubah',
    material.colors.includes(0x7a1122) && colorsAfter === colorsBefore,
    { hexModul: material.hex, bodySama: colorsAfter === colorsBefore }
  );
  await screenshot(page, 'warna-modul');

  /* ---------------- S4-12 ganti modul ---------------- */
  const topsBefore = (await modularState(page)).attached.find((item) => item.category === 'tops');
  const meshesBeforeSwap = (await modelStats(page)).meshes;
  await page.locator(`.module-item[data-instance-id="${topsBefore.instanceId}"] button[data-act="replace"]`).click();
  await page.waitForTimeout(900);
  let swapped = (await modularState(page)).attached.filter((item) => item.category === 'tops');
  const meshesAfterSwap = (await modelStats(page)).meshes;
  await page.locator(`.module-item[data-instance-id="${swapped[0].instanceId}"] button[data-act="replace"]`).click();
  await page.waitForTimeout(900);
  const swappedBack = (await modularState(page)).attached.filter((item) => item.category === 'tops');
  results.measurements.swap = {
    awal: topsBefore.moduleId,
    setelah: swapped.map((item) => item.moduleId),
    kembali: swappedBack.map((item) => item.moduleId),
    meshAwal: meshesBeforeSwap,
    meshSetelah: meshesAfterSwap
  };
  check(
    'S4-12. Tombol "Ganti" menukar modul dalam kategori yang sama tanpa menambah slot',
    swapped.length === 1 && swapped[0].moduleId !== topsBefore.moduleId && swappedBack.length === 1 &&
      swappedBack[0].moduleId === topsBefore.moduleId,
    results.measurements.swap
  );

  /* ---------------- S4-13 impor manifest ---------------- */
  results.measurements.meshesBeforeInvalid = (await modelStats(page)).meshes;
  const invalidManifest = { moduleId: 'impor-rusak', moduleName: 'Rusak' };
  await page.setInputFiles('#moduleFile', {
    name: 'impor-rusak.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalidManifest), 'utf-8')
  });
  await page.waitForTimeout(700);
  const reportText = await page.textContent('#moduleReport');
  const afterInvalid = await modelStats(page);
  const meshesBeforeInvalid = results.measurements.meshesBeforeInvalid;
  check(
    'S4-13. Manifest tidak valid ditolak dengan alasan jelas dan tidak menambah mesh',
    /Field wajib tidak ada/.test(reportText || '') && afterInvalid.meshes === meshesBeforeInvalid,
    { pesan: (reportText || '').slice(0, 160), meshes: afterInvalid.meshes }
  );

  const validManifest = {
    moduleId: 'impor-uji-e2e',
    moduleName: 'Sabuk Impor Uji',
    moduleVersion: '1.0',
    category: 'accessories',
    sourceFile: 'uji-e2e.json',
    sourceFormat: 'procedural',
    sourceLicense: 'UCF internal test',
    scale: 1,
    orientation: '+Y up, +Z forward',
    attachmentType: 'bone',
    attachmentPoint: 'Hips',
    bodyRegion: 'pinggang',
    supportedSkeleton: 'ucf-humanoid-51',
    requiredBones: ['Hips'],
    materialList: ['Sabuk Kulit', 'Sabuk Gesper'],
    textureList: [],
    compatibleBodyProfiles: ['ucf-procedural-35'],
    validationStatus: 'VALID',
    knownLimitations: ['modul uji impor'],
    generator: 'belt'
  };
  const beforeImport = await modelStats(page);
  await page.setInputFiles('#moduleFile', {
    name: 'impor-uji.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(validManifest), 'utf-8')
  });
  await page.waitForTimeout(900);
  const afterImport = await modelStats(page);
  state = await modularState(page);
  const imported = state.attached.find((item) => item.moduleId === 'impor-uji-e2e');
  check(
    'S4-14. Manifest valid dipasang dengan status NEEDS VALIDATION, mesh bertambah sesuai modul',
    Boolean(imported) && imported.status === 'NEEDS VALIDATION' && afterImport.meshes > beforeImport.meshes && afterImport.bones === 51,
    { status: imported?.status, sebelum: beforeImport.meshes, sesudah: afterImport.meshes }
  );
  await screenshot(page, 'impor-manifest');

  /* ---------------- S4-15 simpan/muat config ---------------- */
  const stateBeforeSave = await modularState(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#saveCharacterConfig')
  ]);
  const savedPath = await download.path();
  const savedRaw = await readFile(savedPath, 'utf-8');
  const savedJson = JSON.parse(savedRaw);
  const savedModules = savedJson.characters?.[0]?.modules || [];
  results.measurements.config = {
    modules: savedModules.map((item) => ({ moduleId: item.moduleId, name: item.name, color: item.material?.color, status: item.validationStatus })),
    bytes: savedRaw.length
  };
  check(
    'S4-15. Config menyimpan daftar modul, nama, material, dan status validasi',
    savedModules.length === stateBeforeSave.attached.length &&
      savedModules.some((item) => item.name === 'Fedora Uji UI' && item.material?.color === '#7a1122') &&
      savedModules.every((item) => item.metadata?.supportedSkeleton && item.validationStatus),
    { jumlah: savedModules.length, terpasang: stateBeforeSave.attached.length, byte: savedRaw.length }
  );

  await page.setInputFiles('#characterConfigFile', {
    name: 'ucf-konfigurasi-uji.json',
    mimeType: 'application/json',
    buffer: Buffer.from(savedRaw, 'utf-8')
  });
  await page.waitForTimeout(1500);
  const loadedState = await modularState(page);
  const loadedStats = await modelStats(page);
  check(
    'S4-16. Muat config memulihkan modul, nama, warna, dan jumlah mesh yang sama',
    loadedState.attached.length === stateBeforeSave.attached.length && loadedStats.meshes === afterImport.meshes &&
      loadedStats.bones === 51 && loadedState.attached.some((item) => item.name === 'Fedora Uji UI'),
    { modul: loadedState.attached.length, mesh: loadedStats.meshes, tulang: loadedStats.bones }
  );
  await screenshot(page, 'config-dimuat');

  /* ---------------- S4-17 body utuh ---------------- */
  const finalColors = await bodyColorsHash(page);
  const finalHash = await bodyVertexHash(page);
  stats = await modelStats(page);
  check(
    'S4-17. Bind pose & material body tidak berubah setelah seluruh operasi modular',
    finalHash === baseline.vertices && finalColors === baseline.colors && stats.bones === 51,
    { verteksSama: finalHash === baseline.vertices, warnaSama: finalColors === baseline.colors, tulang: stats.bones }
  );

  /* ---------------- S4-18 thumbnail ---------------- */
  const preview = await page.evaluate(() => window.__ucf.modular.preview('rambut-panjang'));
  check(
    'S4-18. Tombol pratinjau menghasilkan thumbnail (data URL) untuk modul',
    typeof preview === 'string' && preview.startsWith('data:image/') && preview.length > 2000,
    { panjang: typeof preview === 'string' ? preview.length : 0 }
  );

  /* ---------------- S4-19 error ---------------- */
  check(
    'S4-19. Tidak ada page error / console error sepanjang uji modular',
    results.pageErrors.length === 0 && results.consoleErrors.length === 0,
    { page: results.pageErrors.length, console: results.consoleErrors.length }
  );

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
await writeFile(join(OUT, 'phase-4.json'), JSON.stringify(results, null, 2));
console.log(`\nRingkasan Tahap 4: ${results.passed}/${results.checks.length} lulus · page error ${results.pageErrors.length} · console error ${results.consoleErrors.length}`);
if (results.pageErrors.length) console.log('Page errors:', results.pageErrors);
if (results.consoleErrors.length) console.log('Console errors:', results.consoleErrors.slice(0, 5));
process.exit(results.failed === 0 && !results.fatal && results.pageErrors.length === 0 ? 0 : 1);
