/**
 * UCF — Universal Character Foundry v1.1, Tahap 1.
 * Viewport 3D, kamera preset, helper, hierarki, impor GLB/glTF, log validasi.
 */
import * as THREE from 'three';
import { Viewport } from './viewport.js';
import { importModelFile, ImportError } from './importer.js';
import { renderHierarchy, filterHierarchy, markSelected, objectDetails } from './hierarchy.js';
import { ValidationLog, RESULT } from './validation.js';
import { HumanoidController } from './humanoid/controller.js';
import { VIEW_ORDER, directionErrorDegrees } from './camera.js';
import { formatNumber } from './format.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  viewport: $('#viewport'),
  dropzone: $('#dropzone'),
  dropOverlay: $('#dropOverlay'),
  modelFile: $('#modelFile'),
  importReport: $('#importReport'),
  hierarchyTree: $('#hierarchyTree'),
  hierarchySearch: $('#hierarchySearch'),
  hierarchyCount: $('#hierarchyCount'),
  nodeInfo: $('#nodeInfo'),
  toggleWireframe: $('#toggleWireframe'),
  toggleGrid: $('#toggleGrid'),
  toggleAxes: $('#toggleAxes'),
  toggleBBox: $('#toggleBBox'),
  cameraFit: $('#cameraFit'),
  cameraReset: $('#cameraReset'),
  modelList: $('#modelList'),
  modelCount: $('#modelCount'),
  deleteSelected: $('#deleteSelected'),
  clearAll: $('#clearAll'),
  validationList: $('#validationList'),
  validationSummary: $('#validationSummary'),
  downloadValidation: $('#downloadValidation'),
  statusText: $('#statusText'),
  renderInfo: $('#renderInfo'),
  busy: $('#busy'),
  busyText: $('#busyText'),
  engineBadge: $('#engineBadge'),
  panelLeft: $('#panelLeft'),
  panelRight: $('#panelRight'),
  toggleLeft: $('#toggleLeft'),
  toggleRight: $('#toggleRight'),
  backdrop: $('#drawerBackdrop')
};

const log = new ValidationLog();
const state = {
  models: [],
  selectedObject: null,
  selectedModelId: null,
  lastImport: null,
  appliedViews: new Set(),
  toggledKeys: new Set()
};
let booted = false;
let pendingViewsRecord = false;
let humanoid = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setStatus(text, kind = '') {
  ui.statusText.textContent = text;
  ui.statusText.className = kind;
}

function setBusy(on, text = 'Memuat…') {
  ui.busy.classList.toggle('hidden', !on);
  ui.busyText.textContent = text;
}

const viewport = new Viewport(ui.viewport, {
  onSelect: (object) => handleViewportSelect(object),
  onModelsChanged: (models) => handleModelsChanged(models),
  onCameraSettled: (camera) => handleCameraSettled(camera)
});

humanoid = new HumanoidController({
  viewport,
  log,
  onSelect: (modelId) => selectModelById(modelId),
  onChanged: () => {
    renderModelList();
    updateRenderInfo();
  },
  status: setStatus
});

/* ------------------------------------------------------------------ */
/* Lingkungan & log                                                  */
/* ------------------------------------------------------------------ */

function environmentInfo() {
  const gl = viewport.renderer.getContext();
  let rendererName = 'tidak terdeteksi';
  try {
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    if (extension) rendererName = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || rendererName;
  } catch {
    /* privasi browser dapat menyembunyikan nama GPU */
  }
  const canvas = viewport.renderer.domElement;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || '',
    language: navigator.language,
    screen: `${window.screen.width}×${window.screen.height}`,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
    three: THREE.REVISION,
    webgl: viewport.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
    renderer: rendererName,
    url: location.href
  };
}

function summaryCounts() {
  return log.summary();
}

function renderValidation() {
  const list = log.records;
  ui.validationList.innerHTML = '';
  if (!list.length) {
    ui.validationList.innerHTML = '<p class="muted" style="padding:6px">Belum ada catatan.</p>';
  }
  for (const record of list) {
    const details = document.createElement('details');
    details.className = 'vitem';
    const summary = document.createElement('summary');
    const pill = document.createElement('span');
    pill.className = `pill ${record.result.replaceAll(' ', '_')}`;
    pill.textContent = record.result;
    const title = document.createElement('span');
    title.className = 'vt';
    title.textContent = record.test;
    summary.append(pill, title);
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'vbody';
    const dl = document.createElement('dl');
    const rows = [
      ['Grup', record.group],
      ['Model', record.model],
      ['Waktu', new Date(record.at).toLocaleTimeString('id-ID')]
    ];
    const detailEntries = Object.entries(record.details || {}).slice(0, 12);
    for (const [key, value] of detailEntries) {
      rows.push([key, typeof value === 'string' ? value : JSON.stringify(value)]);
    }
    for (const [key, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      dl.append(dt, dd);
    }
    body.appendChild(dl);

    if (record.warnings.length) {
      const title2 = document.createElement('p');
      title2.className = 'warn-title';
      title2.textContent = 'Peringatan';
      const ul = document.createElement('ul');
      ul.className = 'warn-list';
      for (const warning of record.warnings) {
        const li = document.createElement('li');
        li.textContent = warning;
        ul.appendChild(li);
      }
      body.append(title2, ul);
    }
    if (record.errors.length) {
      const ul = document.createElement('ul');
      ul.className = 'warn-list';
      for (const error of record.errors) {
        const li = document.createElement('li');
        li.textContent = error;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    details.appendChild(body);
    ui.validationList.appendChild(details);
  }

  const counts = summaryCounts();
  ui.validationSummary.textContent =
    `PASS ${counts.PASS} · FAIL ${counts.FAIL} · NT ${counts['NOT TESTED']}` +
    (counts.BLOCKED ? ` · BLOCKED ${counts.BLOCKED}` : '');
}

/* ------------------------------------------------------------------ */
/* Kamera                                                            */
/* ------------------------------------------------------------------ */

function updateChips(view) {
  for (const chip of document.querySelectorAll('[data-view]')) {
    chip.classList.toggle('active', chip.dataset.view === view);
  }
}

function applyView(view, { animate = true, record = true } = {}) {
  viewport.setView(view, { animate });
  updateChips(view);
  if (!record) return;
  state.appliedViews.add(view);
  if (state.appliedViews.size === VIEW_ORDER.length && !log.has('Enam tampilan kamera diterapkan')) {
    pendingViewsRecord = true;
  }
}

function handleCameraSettled(camera) {
  if (!booted) return;
  if (pendingViewsRecord) {
    pendingViewsRecord = false;
    log.add({
      group: 'B. Viewport',
      test: 'Enam tampilan kamera diterapkan',
      model: viewport.models.map((model) => model.name).join(', ') || '—',
      result: RESULT.PASS,
      details: {
        tampilan: camera.view,
        'sudut galat (derajat)': Number(directionErrorDegrees(camera.direction, camera.view).toFixed(2)),
        'jarak kamera (m)': Number(camera.distance.toFixed(3)),
        'rasio aspek': Number(camera.aspect.toFixed(3)),
        urutan: [...state.appliedViews].join(' → ')
      }
    });
    renderValidation();
  }
}

/* ------------------------------------------------------------------ */
/* Model & seleksi                                                   */
/* ------------------------------------------------------------------ */

function modelIdForObject(object) {
  let node = object;
  while (node) {
    if (node.userData?.ucfModelId) return node.userData.ucfModelId;
    node = node.parent;
  }
  return null;
}

function isObjectAttached(object) {
  let node = object;
  while (node) {
    if (node === viewport.modelRoot) return true;
    node = node.parent;
  }
  return false;
}

function selectModelById(modelId) {
  if (!modelId) {
    handleViewportSelect(null);
    return;
  }
  const model = viewport.modelById(modelId);
  if (model) handleViewportSelect(model.root);
}

function handleModelsChanged(models) {
  state.models = [...models];
  humanoid?.syncModels(models);
  if (state.selectedObject && !isObjectAttached(state.selectedObject)) {
    state.selectedObject = null;
    state.selectedModelId = null;
    viewport.selectObject(null);
    ui.nodeInfo.innerHTML = '<p class="muted">Tidak ada node terpilih.</p>';
  }
  if (state.selectedModelId && !models.some((model) => model.id === state.selectedModelId)) {
    state.selectedObject = null;
    state.selectedModelId = null;
    ui.nodeInfo.innerHTML = '<p class="muted">Tidak ada node terpilih.</p>';
  }
  renderHierarchyPanel();
  renderModelList();
  updateRenderInfo();
}

function renderHierarchyPanel() {
  const selectedUuid = state.selectedObject?.uuid || null;
  const count = renderHierarchy(ui.hierarchyTree, state.models, {
    onSelect: (object) => handleViewportSelect(object),
    selectedUuid,
    expandedDepth: 2
  });
  ui.hierarchyCount.textContent = `${formatNumber(count)} node`;
  filterHierarchy(ui.hierarchyTree, ui.hierarchySearch.value);
}

function renderModelList() {
  ui.modelList.innerHTML = '';
  ui.modelCount.textContent = `${state.models.length} model`;
  const hasModels = state.models.length > 0;
  if (ui.deleteSelected) ui.deleteSelected.disabled = !hasModels;
  if (ui.clearAll) ui.clearAll.disabled = !hasModels;
  if (!state.models.length) {
    ui.modelList.innerHTML = '<p class="muted" style="padding:4px 2px;font-size:11.5px">Belum ada model.</p>';
    return;
  }
  for (const model of state.models) {
    const stats = model.stats || {};
    const item = document.createElement('div');
    item.className = 'model-item';
    item.dataset.modelId = model.id;
    if (state.selectedModelId === model.id) item.classList.add('selected');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = model.name;
    name.title = model.name;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `${stats.meshes || 0}M · ${formatNumber(stats.triangles || 0)}△ · ${stats.bones || 0}B`;
    item.append(name, sub);

    item.addEventListener('click', () => handleViewportSelect(model.root));
    ui.modelList.appendChild(item);
  }
}

function updateRenderInfo() {
  const totals = viewport.aggregateStats();
  if (!totals.models) {
    ui.renderInfo.textContent = 'Belum ada model';
    return;
  }
  ui.renderInfo.textContent =
    `${totals.models} model · ${formatNumber(totals.meshes)} mesh · ` +
    `${formatNumber(totals.triangles)} segitiga · ${totals.bones} tulang`;
}

function handleViewportSelect(object) {
  state.selectedObject = object;
  state.selectedModelId = object ? modelIdForObject(object) : null;
  viewport.selectObject(object);
  renderModelList();
  if (object) {
    markSelected(ui.hierarchyTree, object.uuid);
    renderNodeInfo(object);
  } else {
    for (const row of ui.hierarchyTree.querySelectorAll('.tree-row.selected')) row.classList.remove('selected');
    ui.nodeInfo.innerHTML = '<p class="muted">Tidak ada node terpilih.</p>';
  }
  humanoid?.setSelection(object ? modelIdForObject(object) : null);
}

function renderNodeInfo(object) {
  const details = objectDetails(object);
  if (!details) {
    ui.nodeInfo.innerHTML = '<p class="muted">Tidak ada node terpilih.</p>';
    return;
  }
  const rows = [
    ['Jenis', details.typeLabel],
    ['Induk', details.parentName],
    ['Anak', String(details.childCount)],
    ['Posisi dunia', details.worldPosition.map((value) => value.toFixed(2)).join(', ')],
    ['Posisi lokal', details.localPosition.map((value) => value.toFixed(2)).join(', ')]
  ];
  if (details.hasGeometry) {
    rows.push(['Verteks', formatNumber(details.vertices)]);
    rows.push(['Segitiga', formatNumber(details.triangles)]);
    rows.push(['Material', details.materials.join(', ') || '—']);
    if (details.skinned) rows.push(['Skinned', `ya · ${details.skeletonBones ?? 0} tulang`]);
    if (details.morphTargets) rows.push(['Morph target', String(details.morphTargets)]);
  }
  if (!details.hasGeometry && details.boneCount) rows.push(['Tulang di subtree', String(details.boneCount)]);
  if (details.bounds) rows.push(['Ukuran (m)', details.bounds.size.map((value) => value.toFixed(2)).join(' × ')]);
  rows.push(['UUID', details.uuid.slice(0, 12) + '…']);

  ui.nodeInfo.innerHTML = `<h3>${escapeHtml(details.name)}</h3><dl>${rows
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('')}</dl>`;
}

/* ------------------------------------------------------------------ */
/* Impor                                                             */
/* ------------------------------------------------------------------ */

function reportTableRows(report) {
  const stats = report.stats;
  const size = stats.size.map((value) => value.toFixed(2)).join(' × ');
  return [
    ['Format', report.format.toUpperCase()],
    ['Ukuran berkas', `${(report.bytes / 1024).toFixed(1)} KB`],
    ['Waktu muat', `${report.loadMs.toFixed(0)} ms`],
    ['Node', formatNumber(stats.nodes)],
    ['Mesh', formatNumber(stats.meshes)],
    ['Skinned mesh', formatNumber(stats.skinnedMeshes)],
    ['Skeleton', formatNumber(stats.skeletons)],
    ['Tulang', formatNumber(stats.bones)],
    ['Material', formatNumber(stats.materials)],
    ['Tekstur', formatNumber(stats.textures)],
    ['Verteks', formatNumber(stats.vertices)],
    ['Segitiga', formatNumber(stats.triangles)],
    ['Morph target', formatNumber(stats.morphTargets)],
    ['Klip animasi', formatNumber(stats.clips)],
    ['Dimensi (m)', size],
    [
      'Ekstensi',
      report.extensions.used.length
        ? report.extensions.used.join(', ')
        : 'tidak ada'
    ]
  ];
}

function renderImportReport(report) {
  ui.importReport.classList.remove('hidden');
  const warnings = report.warnings || [];
  ui.importReport.innerHTML = `
    <div class="report-head"><span class="dot"></span><strong>Impor berhasil</strong>
      <span class="muted" style="margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${escapeHtml(report.fileName)}</span>
    </div>
    <div class="report-body">
      <table class="kv">${reportTableRows(report)
        .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
        .join('')}</table>
      ${
        warnings.length
          ? `<p class="warn-title">Peringatan (${warnings.length})</p><ul class="warn-list">${warnings
              .map((warning) => `<li>${escapeHtml(warning)}</li>`)
              .join('')}</ul>`
          : '<p class="hint" style="color:#86efac">Tidak ada peringatan.</p>'
      }
      ${
        report.animationCount
          ? `<p class="hint">Klip: ${escapeHtml(report.clipNames.join(', '))}</p>`
          : ''
      }
    </div>`;
}

function renderImportError(file, error) {
  const blocked = error instanceof ImportError && ['required-extension', 'external-resource'].includes(error.code);
  ui.importReport.classList.remove('hidden');
  ui.importReport.innerHTML = `
    <div class="report-head ${blocked ? 'blocked' : 'fail'}"><span class="dot"></span>
      <strong>${blocked ? 'Impor diblokir' : 'Impor gagal'}</strong>
      <span class="muted" style="margin-left:auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(file?.name || '—')}</span>
    </div>
    <div class="report-body"><p class="error-msg">${escapeHtml(error?.message || String(error))}</p></div>`;
}

function checkDerivedRecords(report) {
  const stats = report.stats;
  if (stats.skinnedMeshes > 0 && stats.bones > 0 && !log.has('Model ber-skeleton terdeteksi')) {
    log.add({
      group: 'A. Impor',
      test: 'Model ber-skeleton terdeteksi',
      model: report.fileName,
      result: RESULT.PASS,
      details: {
        'skinned mesh': stats.skinnedMeshes,
        skeleton: stats.skeletons,
        tulang: stats.bones,
        material: stats.materials,
        tekstur: stats.textures,
        klip: stats.clips
      }
    });
  }
  if (stats.meshes > 0 && stats.bones === 0 && !log.has('Model tanpa rig terdeteksi')) {
    log.add({
      group: 'A. Impor',
      test: 'Model tanpa rig terdeteksi',
      model: report.fileName,
      result: RESULT.PASS,
      details: {
        mesh: stats.meshes,
        tulang: 0,
        skeleton: 0,
        material: stats.materials,
        tekstur: stats.textures
      }
    });
  }
}

async function importOne(file) {
  setBusy(true, `Mengimpor ${file.name}…`);
  setStatus(`Mengimpor ${file.name}…`);
  try {
    const { report, root } = await importModelFile(file);
    viewport.addModel(root, {
      name: file.name,
      fileName: file.name,
      stats: report.stats,
      clips: report.animationCount,
      report
    });
    viewport.setWireframe(ui.toggleWireframe.checked);
    viewport.fitAll({ animate: true });
    state.lastImport = report;
    renderImportReport(report);

    log.add({
      group: 'A. Impor',
      test: `Impor ${report.format.toUpperCase()}`,
      model: file.name,
      result: RESULT.PASS,
      warnings: report.warnings,
      details: {
        'waktu muat (ms)': Number(report.loadMs.toFixed(1)),
        node: report.stats.nodes,
        mesh: report.stats.meshes,
        'skinned mesh': report.stats.skinnedMeshes,
        skeleton: report.stats.skeletons,
        tulang: report.stats.bones,
        material: report.stats.materials,
        tekstur: report.stats.textures,
        segitiga: report.stats.triangles,
        klip: report.stats.clips,
        ekstensi: report.extensions.used.join(', ') || 'tidak ada'
      }
    });
    checkDerivedRecords(report);
    renderValidation();

    const { meshes, bones, skinnedMeshes } = report.stats;
    setStatus(
      `Berhasil: ${file.name} — ${meshes} mesh, ${skinnedMeshes} skinned, ${bones} tulang, ${report.loadMs.toFixed(0)} ms.`,
      'ok'
    );
  } catch (error) {
    const blocked = error instanceof ImportError && ['required-extension', 'external-resource'].includes(error.code);
    renderImportError(file, error);
    log.add({
      group: 'A. Impor',
      test: 'Impor berkas',
      model: file?.name || '—',
      result: blocked ? RESULT.BLOCKED : RESULT.FAIL,
      errors: [error?.message || String(error)],
      details: { kode: error?.code || 'unknown' }
    });
    renderValidation();
    setStatus(error?.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  for (const file of files) await importOne(file);
}

/* ------------------------------------------------------------------ */
/* Panel kanan: toggle, hapus, validasi                              */
/* ------------------------------------------------------------------ */

function syncToggles() {
  viewport.setHelper('grid', ui.toggleGrid.checked);
  viewport.setHelper('axes', ui.toggleAxes.checked);
  viewport.setHelper('bbox', ui.toggleBBox.checked);
  viewport.setWireframe(ui.toggleWireframe.checked);
}

function maybeRecordToggles() {
  if (state.toggledKeys.size < 4 || log.has('Empat toggle tampilan diuji')) return;
  log.add({
    group: 'B. Viewport',
    test: 'Empat toggle tampilan diuji',
    model: viewport.models.map((model) => model.name).join(', ') || '—',
    result: RESULT.PASS,
    details: {
      wireframe: viewport.toggles.wireframe,
      grid: viewport.toggles.grid,
      sumbu: viewport.toggles.axes,
      'bounding box': viewport.toggles.bbox
    }
  });
  renderValidation();
}

function bindToggle(input, key) {
  input.addEventListener('change', () => {
    state.toggledKeys.add(key);
    syncToggles();
    maybeRecordToggles();
  });
}

bindToggle(ui.toggleWireframe, 'wireframe');
bindToggle(ui.toggleGrid, 'grid');
bindToggle(ui.toggleAxes, 'axes');
bindToggle(ui.toggleBBox, 'bbox');

ui.deleteSelected.addEventListener('click', () => {
  const id = state.selectedModelId || state.models.at(-1)?.id;
  if (!id) {
    setStatus('Tidak ada model untuk dihapus.', 'error');
    return;
  }
  viewport.removeModel(id);
  state.selectedObject = null;
  state.selectedModelId = null;
  viewport.selectObject(null);
  ui.nodeInfo.innerHTML = '<p class="muted">Tidak ada node terpilih.</p>';
  setStatus('Model dihapus dari sesi.');
});

ui.clearAll.addEventListener('click', () => {
  const before = viewport.models.length;
  humanoid?.clearAll();
  viewport.clearModels();
  state.selectedObject = null;
  state.selectedModelId = null;
  ui.nodeInfo.innerHTML = '<p class="muted">Tidak ada node terpilih.</p>';
  ui.importReport.classList.add('hidden');
  state.lastImport = null;
  updateChips('perspektif');
  const ok = viewport.models.length === 0;
  log.add({
    group: 'F. Regresi',
    test: 'Bersihkan viewport',
    model: '—',
    result: ok ? RESULT.PASS : RESULT.FAIL,
    errors: ok ? [] : ['Model masih tersisa setelah pembersihan.'],
    details: { 'model sebelum': before, 'model sesudah': viewport.models.length }
  });
  renderValidation();
  setStatus(ok ? `Viewport dibersihkan (${before} model).` : 'Gagal membersihkan viewport.', ok ? 'ok' : 'error');
});

ui.downloadValidation.addEventListener('click', () => {
  const payload = log.toJSON(environmentInfo());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ucf-validasi-tahap-1.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus('Laporan validasi JSON diunduh.', 'ok');
});

/* ------------------------------------------------------------------ */
/* Kamera: tombol & reset                                            */
/* ------------------------------------------------------------------ */

for (const chip of document.querySelectorAll('[data-view]')) {
  chip.addEventListener('click', () => applyView(chip.dataset.view));
}

ui.cameraFit.addEventListener('click', () => {
  viewport.fitAll({ animate: true });
  setStatus('Kamera dipaskan ke seluruh model.');
});

ui.cameraReset.addEventListener('click', () => {
  viewport.resetCamera();
  updateChips('perspektif');
  setStatus('Kamera dikembalikan ke tampilan perspektif awal.');
});

/* ------------------------------------------------------------------ */
/* Impor: pemilih berkas & drag-drop                                 */
/* ------------------------------------------------------------------ */

ui.modelFile.addEventListener('change', () => {
  if (ui.modelFile.files?.length) {
    const files = [...ui.modelFile.files];
    ui.modelFile.value = '';
    handleFiles(files);
  }
});

ui.dropzone.addEventListener('click', (event) => {
  if (event.target === ui.modelFile) return;
  ui.modelFile.click();
});
ui.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    ui.modelFile.click();
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  ui.dropOverlay.classList.remove('hidden');
});
window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropOverlay.classList.add('hidden');
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.classList.add('hidden');
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) handleFiles(files);
});

/* ------------------------------------------------------------------ */
/* Pencarian hierarki                                                */
/* ------------------------------------------------------------------ */

ui.hierarchySearch.addEventListener('input', () => {
  filterHierarchy(ui.hierarchyTree, ui.hierarchySearch.value);
});

/* ------------------------------------------------------------------ */
/* Drawer mobile                                                     */
/* ------------------------------------------------------------------ */

function closeDrawers() {
  ui.panelLeft.classList.remove('open');
  ui.panelRight.classList.remove('open');
  ui.toggleLeft.setAttribute('aria-expanded', 'false');
  ui.toggleRight.setAttribute('aria-expanded', 'false');
  ui.backdrop.hidden = true;
}

function openDrawer(panel, button) {
  const isOpen = panel.classList.contains('open');
  closeDrawers();
  if (isOpen) return;
  panel.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
  ui.backdrop.hidden = false;
}

ui.toggleLeft.addEventListener('click', () => openDrawer(ui.panelLeft, ui.toggleLeft));
ui.toggleRight.addEventListener('click', () => openDrawer(ui.panelRight, ui.toggleRight));
ui.backdrop.addEventListener('click', closeDrawers);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawers();
});

/* ------------------------------------------------------------------ */
/* Pintasan papan ketik                                              */
/* ------------------------------------------------------------------ */

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    const tag = event.target?.tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && event.target.type === 'text')) return;
    event.preventDefault();
    if (event.shiftKey) humanoid?.redo();
    else humanoid?.undo();
    return;
  }
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const views = { 1: 'depan', 2: 'belakang', 3: 'kiri', 4: 'kanan', 5: 'atas', 6: 'perspektif' };
  if (views[event.key]) {
    event.preventDefault();
    applyView(views[event.key]);
  } else if (event.key === 'f' || event.key === 'F') {
    viewport.fitAll({ animate: true });
  } else if (event.key === 'r' || event.key === 'R') {
    viewport.resetCamera();
    updateChips('perspektif');
  } else if (event.key === 'g' || event.key === 'G') {
    ui.toggleGrid.click();
  } else if (event.key === 'b' || event.key === 'B') {
    ui.toggleBBox.click();
  } else if (event.key === 'w' || event.key === 'W') {
    ui.toggleWireframe.click();
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                              */
/* ------------------------------------------------------------------ */

ui.engineBadge.textContent = `three r${THREE.REVISION} · ${viewport.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'}`;
syncToggles();
updateChips('perspektif');
updateRenderInfo();
renderModelList();
renderHierarchyPanel();

log.add({
  group: 'F. Regresi',
  test: 'Aplikasi dimuat & viewport aktif',
  model: '—',
  result: RESULT.PASS,
  details: {
    three: THREE.REVISION,
    webgl: viewport.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
    'ukuran viewport': `${viewport.renderer.domElement.clientWidth}×${viewport.renderer.domElement.clientHeight}`,
    helper: viewport.helperObjectCount
  }
});
log.add({
  group: 'F. Regresi',
  test: 'Uji perangkat Android fisik',
  model: '—',
  result: RESULT.NOT_TESTED,
  details: { alasan: 'Tidak ada perangkat Android fisik pada lingkungan ini; hanya emulasi ukuran layar.' }
});
renderValidation();

booted = true;

window.__ucf = {
  version: '1.1.0-stage4',
  stage: 4,
  ready: true,
  get cameraSettled() {
    return viewport.cameraSettled;
  },
  get camera() {
    return viewport.cameraState();
  },
  get cameraObject() {
    return viewport.camera;
  },
  get controls() {
    return viewport.controls;
  },
  get toggles() {
    return { ...viewport.toggles };
  },
  get helpers() {
    return {
      grid: viewport.grid.visible,
      axes: viewport.axes.visible,
      bbox: viewport.models.some((model) => model.bboxHelper.visible),
      count: viewport.helperObjectCount,
      names: viewport.helperNames,
      insideModels: (() => {
        let found = 0;
        viewport.modelRoot.traverse((object) => {
          if (object.userData?.ucfHelper) found += 1;
        });
        return found;
      })()
    };
  },
  get models() {
    return viewport.models.map((model) => ({
      id: model.id,
      name: model.name,
      stats: model.stats,
      bounds: { min: model.bbox.min.toArray(), max: model.bbox.max.toArray() }
    }));
  },
  get lastImport() {
    return state.lastImport;
  },
  get validation() {
    return log.toJSON(environmentInfo());
  },
  get selection() {
    if (!state.selectedObject) return null;
    return {
      uuid: state.selectedObject.uuid,
      name: state.selectedObject.name || '(tanpa nama)',
      type: state.selectedObject.type,
      isMesh: Boolean(state.selectedObject.isMesh),
      isBone: Boolean(state.selectedObject.isBone)
    };
  },
  get activeView() {
    return viewport.currentView;
  },
  setView(view, animate = false) {
    applyView(view, { animate, record: false });
  },
  fit(animate = false) {
    viewport.fitAll({ animate });
  },
  reset() {
    viewport.resetCamera();
    updateChips('perspektif');
  },
  bboxCorners() {
    return viewport.bboxCorners();
  },
  projectCorners() {
    return viewport.projectCorners();
  },
  helperObjectCount() {
    return viewport.helperObjectCount;
  },
  materials() {
    let total = 0;
    let wireframe = 0;
    viewport.modelRoot.traverse((object) => {
      if (!object.material) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        total += 1;
        if (material.wireframe) wireframe += 1;
      }
    });
    return { total, wireframe };
  },
  projectPoint(point) {
    const vector = new THREE.Vector3(point[0], point[1], point[2]).project(viewport.camera);
    return [vector.x, vector.y, vector.z];
  },
  pickAt(clientX, clientY) {
    return viewport.pickAt(clientX, clientY);
  },
  environment() {
    return environmentInfo();
  },
  get humanoid() {
    return humanoid;
  },
  get modular() {
    const controller = humanoid;
    return {
      state: () => controller?.moduleState() || { attached: [], library: [], summary: null },
      library: () => controller?.moduleState().library || [],
      attached: () => controller?.moduleState().attached || [],
      attach: (moduleId) => controller?.attachModule(moduleId) || null,
      detach: (instanceId) => controller?.detachModule(instanceId) || false,
      replace: (instanceId) => controller?.replaceModule(instanceId) || false,
      remove: (instanceId) => controller?.deleteModule(instanceId) || false,
      rename: (instanceId, name) => controller?.renameModule(instanceId, name) || false,
      setMaterial: (instanceId, values) => controller?.setModuleMaterial(instanceId, values) || false,
      setVisible: (instanceId, visible) => controller?.setModuleVisible(instanceId, visible) || false,
      importManifest: (text) => controller?.importModuleManifest(text) || null,
      preview: (moduleId) => controller?.previewModule(moduleId) || null,
      select: (moduleId) => controller?.modulePanel?.selectModule(moduleId),
      panel: () => controller?.modulePanel || null
    };
  },
  // Untuk pengukuran/pengujian lanjutan; bukan API publik aplikasi.
  get scene() {
    return viewport.scene;
  }
};

setStatus('Siap. Impor berkas .glb atau .gltf untuk mulai.');
