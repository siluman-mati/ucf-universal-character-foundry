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
import { inspectModel } from './anim/inspect.js';
import { ExportPanel } from './export/exportPanel.js';
import { generateFromImageFile, listEngines } from './imageTo3D/engine.js';
import { autoRigImageMesh, getImageRig } from './imageTo3D/rigAdapter.js';
import { summarize } from './stats.js';
import { findConnectedComponents, singleViewRequirements, createCropperUI } from './imageTo3D/cropper.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  viewport: $('#viewport'),
  dropzone: $('#dropzone'),
  dropOverlay: $('#dropOverlay'),
  modelFile: $('#modelFile'),
  importReport: $('#importReport'),
  // Image-to-3D (terpisah dari model)
  dropzoneImage: $('#dropzoneImage'),
  imageFile: $('#imageFile'),
  imagePreview: $('#imagePreview'),
  imagePreviewWrap: $('#imagePreviewWrap'),
  imagePreviewInfo: $('#imagePreviewInfo'),
  imageEngine: $('#imageEngine'),
  generate3D: $('#generate3D'),
  clearImage: $('#clearImage'),
  autoRigImage: $('#autoRigImage'),
  testImageDeform: $('#testImageDeform'),
  imageReport: $('#imageReport'),
  imageTo3DStatus: $('#imageTo3DStatus'),
  imageCropWrap: $('#imageCropWrap'),
  imageCropper: $('#imageCropper'),
  cropInfo: $('#cropInfo'),
  cropAutoDetect: $('#cropAutoDetect'),
  cropApply: $('#cropApply'),
  cropReset: $('#cropReset'),
  cropComponents: $('#cropComponents'),
  imageConsent: $('#imageConsent'),
  consentRemote: $('#consentRemote'),
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
  toggledKeys: new Set(),
  // Image-to-3D
  lastImageFile: null,
  lastImageGroup: null,
  lastImageMeta: null,
  lastImageModelId: null,
  lastImageCanvas: null, // canvas sumber untuk cropper
  lastCropRect: null, // {x,y,w,h} pilihan user
  cropper: null,
  lastMask: null,
  lastComponents: null
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

const exporter = new ExportPanel({ viewport, humanoid, log, status: setStatus });
exporter.bind({
  exportBtn: document.getElementById('exportGLB'),
  reimportBtn: document.getElementById('reimportGLB'),
  downloadBtn: document.getElementById('downloadGLB')
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
    const { report, root, animations } = await importModelFile(file);
    viewport.addModel(root, {
      name: file.name,
      fileName: file.name,
      stats: report.stats,
      clips: animations,
      report
    });
    viewport.setWireframe(ui.toggleWireframe.checked);
    viewport.fitAll({ animate: true });
    // Daftar sumber retarget harus langsung menampilkan model yang baru diimpor;
    // tanpa ini dropdown tetap kosong sampai panel dirender ulang oleh aksi lain.
    humanoid?.animPanel?.refreshSources?.();
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
  for (const file of files) {
    if (isImageFile(file)) {
      handleImageSelect(file);
    } else {
      await importOne(file);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Image-to-3D: impor gambar terpisah dari model (Langkah 3)          */
/* ------------------------------------------------------------------ */

function isImageFile(file) {
  if (!file) return false;
  if (/^image\//.test(file.type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name || '');
}

function updateImageUIState() {
  const hasImage = !!state.lastImageFile;
  const hasModel = !!state.lastImageModelId && viewport.modelById(state.lastImageModelId);
  const mode = ui.imageEngine?.value || 'silhouette';
  const isRemote = mode !== 'silhouette';
  const hasConsent = !isRemote || ui.consentRemote?.checked;
  if (ui.generate3D) {
    ui.generate3D.disabled = !hasImage || (isRemote && !hasConsent);
    if (isRemote && !hasConsent) ui.generate3D.title = 'Centang persetujuan kirim ke HF Space dulu';
    else if (isRemote) ui.generate3D.title = 'Akan kirim crop ke ' + mode + ' — butuh network, bisa gagal 503';
    else ui.generate3D.title = 'Silhouette lokal — hanya untuk logo/ikon, bukan karakter volumetrik';
  }
  if (ui.clearImage) ui.clearImage.disabled = !hasImage;
  if (ui.autoRigImage) ui.autoRigImage.disabled = !hasModel;
  if (ui.testImageDeform) ui.testImageDeform.disabled = !hasModel;
  if (ui.imageConsent) ui.imageConsent.classList.toggle('hidden', !isRemote);
  if (ui.imageTo3DStatus) {
    if (!hasImage) ui.imageTo3DStatus.textContent = 'belum ada gambar';
    else if (isRemote && !hasConsent) ui.imageTo3DStatus.textContent = `mode ${mode} — perlu persetujuan`;
    else if (isRemote) ui.imageTo3DStatus.textContent = `mode ${mode} — siap kirim`;
    else ui.imageTo3DStatus.textContent = hasModel ? 'mesh 3D siap (sederhana)' : 'gambar siap (silhouette)';
  }
  if (ui.imageCropWrap) ui.imageCropWrap.classList.toggle('hidden', !hasImage);
}

function renderImagePreview(file, previewUrl) {
  if (!ui.imagePreview || !ui.imagePreviewWrap) return;
  ui.imagePreview.src = previewUrl;
  ui.imagePreviewWrap.classList.remove('hidden');
  ui.imagePreviewInfo.textContent = `${file.name} · ${(file.size/1024).toFixed(1)} KB · ${file.type || 'image'}`;
}

function renderImageReport(meta) {
  if (!ui.imageReport) return;
  if (!meta) { ui.imageReport.innerHTML = ''; return; }
  if (meta.ok) {
    ui.imageReport.innerHTML = `
      <div class="report-head"><span class="dot"></span><strong>Mesh 3D dari gambar</strong><span class="muted" style="margin-left:auto">${escapeHtml(meta.fileName)}</span></div>
      <div class="report-body">
        <table class="kv">
          <tr><th>Metode</th><td>${escapeHtml(meta.engine)}</td></tr>
          <tr><th>Verteks</th><td>${formatNumber(meta.meshInfo.vertices)}</td></tr>
          <tr><th>Segitiga</th><td>${formatNumber(meta.meshInfo.triangles)}</td></tr>
          <tr><th>Ukuran (m)</th><td>${meta.meshInfo.size.map(v=>v.toFixed(2)).join(' × ')}</td></tr>
          <tr><th>Kedalaman</th><td>${meta.depth.toFixed(3)} m</td></tr>
          <tr><th>Waktu</th><td>${meta.timings.totalMs} ms</td></tr>
          <tr><th>Mask</th><td>${(meta.bbox.areaRatio*100).toFixed(1)}% · ${escapeHtml(meta.maskInfo.method)}</td></tr>
        </table>
        ${meta.warnings?.length ? `<p class="warn-title">Catatan</p><ul class="warn-list">${meta.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
      </div>`;
  } else {
    ui.imageReport.innerHTML = `<div class="report-head fail"><span class="dot"></span><strong>Gagal</strong></div><div class="report-body"><p class="error-msg">${escapeHtml(meta.error || String(meta))}</p></div>`;
  }
}

async function handleImageSelect(file) {
  if (!file || !isImageFile(file)) return;
  state.lastImageFile = file;
  state.lastCropRect = null;
  // preview
  const previewUrl = URL.createObjectURL(file);
  renderImagePreview(file, previewUrl);
  // Tahap 3: siapkan cropper untuk sheet multi-karakter
  try {
    const { loadImageToCanvas, createMaskFromCanvas } = await import('./imageTo3D/imageLoader.js');
    const loaded = await loadImageToCanvas(file);
    state.lastImageCanvas = loaded.canvas; // simpan untuk cropper
    const masked = createMaskFromCanvas(loaded.canvas, loaded.ctx);
    state.lastMask = masked;
    const comps = findConnectedComponents(masked.mask, masked.w, masked.h);
    state.lastComponents = comps;
    if (ui.cropComponents) {
      if (comps.length > 1) {
        ui.cropComponents.innerHTML = `Terdeteksi ${comps.length} komponen terhubung (mungkin sheet multi-karakter). <b>Jangan proses seluruh lembar sebagai satu siluet — akan bertumpuk gepeng.</b> Pilih satu: ` + comps.slice(0,4).map((c,i)=> `<button class="btn small crop-suggest" data-idx="${i}" type="button">Karakter ${i+1} (${c.width}×${c.height}, ${(c.areaRatio*100).toFixed(1)}%)</button>`).join(' ');
      } else if (comps.length===1) {
        ui.cropComponents.innerHTML = `Terdeteksi 1 komponen (${(comps[0].areaRatio*100).toFixed(1)}% area). Jika ini sheet, potong manual dengan seret kotak.`;
      } else ui.cropComponents.innerHTML = '';
    }
    // inisialisasi cropper UI dengan full rect
    if (ui.imageCropper && loaded.canvas) {
      const rectFull = { x:0, y:0, w:loaded.canvas.width, h:loaded.canvas.height };
      // jika ada bbox terbesar, usulkan sebagai awal
      const suggest = comps[0] ? { x: comps[0].minX, y: comps[0].minY, w: comps[0].width, h: comps[0].height } : rectFull;
      state.cropper = createCropperUI(ui.imageCropper, loaded.canvas, suggest);
      state.lastCropRect = state.cropper.rect;
      state.cropper.onChange((r)=> {
        state.lastCropRect = r;
        if (ui.cropInfo) ui.cropInfo.textContent = `${r.w}×${r.h} @${r.x},${r.y}`;
        // persyaratan single-view
        const reqs = singleViewRequirements(ui.imageEngine?.value||'tripoRemote');
        if (r && (Math.abs(r.w - r.h) > Math.min(r.w,r.h)*0.3)) {
          if (ui.cropInfo) ui.cropInfo.textContent += ' — ideal persegi 1:1 untuk TripoSR';
        }
      });
      if (ui.cropInfo) ui.cropInfo.textContent = `${suggest.w}×${suggest.h} @${suggest.x},${suggest.y}`;
    }
    const reqs = singleViewRequirements(ui.imageEngine?.value||'tripoRemote');
    if (reqs.length && ui.imageReport) {
      ui.imageReport.innerHTML = `<div class="hint mono" style="font-size:11px"><b>Persyaratan single-view (${ui.imageEngine?.value||'tripoRemote'}):</b><ul class="warn-list">${reqs.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul><p>Potongan saat ini: ${state.lastCropRect.w}×${state.lastCropRect.h} — akan dikirim sebagai input rekonstruksi (bukan seluruh sheet).</p></div>`;
    } else if (ui.imageReport) ui.imageReport.innerHTML = `<p class="hint">Gambar dimuat. Atur potongan (drag kotak) untuk memilih 1 karakter, lalu pilih mesin dan tekan Buat mesh. Silhouette hanya untuk logo/ikon.</p>`;
  } catch(e) { console.warn('cropper init fail', e); if (ui.imageReport) ui.imageReport.innerHTML = `<p class="hint">Gambar dimuat. Pilih mesin lalu tekan Buat mesh 3D.</p>`; }
  updateImageUIState();
  setStatus(`Gambar dimuat: ${file.name} — atur potongan 1 karakter, lalu generasi.`, 'ok');
  log.add({ group: 'H. Gambar→3D', test: 'Gambar dimasukkan', model: file.name, result: RESULT.PASS, details: { ukuran: file.size, tipe: file.type, metode_deteksi: 'image/*', komponen: state.lastComponents?.length||0, crop_saran: state.lastCropRect? `${state.lastCropRect.w}×${state.lastCropRect.h}`:'penuh' } });
  renderValidation();
}

async function handleGenerateImage3D() {
  const file = state.lastImageFile;
  const mode = ui.imageEngine?.value || 'silhouette';
  if (!file) { setStatus('Belum ada gambar — pilih PNG/JPG dulu.', 'error'); return; }
  const isRemote = mode !== 'silhouette';
  // Tahap 4: tampilkan status sebenarnya, jangan klaim sukses jika hanya fallback
  const cropRect = state.lastCropRect; // dari cropper Tahap 3 — jangan gabung beberapa karakter menjadi satu mesh
  if (isRemote) {
    if (!ui.consentRemote?.checked) {
      const msg = `Centang persetujuan: gambar crop ${cropRect? `${cropRect.w}×${cropRect.h}`:'penuh'} akan dikirim ke huggingface.co/spaces/stabilityai/TripoSR (atau server ${mode}) untuk inferensi. Tanpa persetujuan tidak dikirim.`;
      setStatus(msg, 'error');
      if (ui.imageReport) ui.imageReport.innerHTML = `<div class="report-head blocked"><span class="dot"></span><strong>Butuh persetujuan</strong></div><div class="report-body"><p class="error-msg">${escapeHtml(msg)}</p><p class="hint">Kebutuhan: GPU 6GB VRAM, Python+CUDA, model 1GB. Jika tidak ada server, status akan GAGAL/BELUM TERVERIFIKASI — bukan sukses palsu.</p></div>`;
      return;
    }
    setBusy(true, `TripoSR remote: mengirim ${file.name} (${cropRect? `${cropRect.w}×${cropRect.h} crop`: 'penuh'})…`);
    setStatus(`Mengirim ke ${mode}… (TripoSR hallucinate belakang, 30–60s) — jangan tutup tab`);
    try {
      const { generateFromImageFile: genRemote } = await import('./imageTo3D/engine.js');
      const onProgress = (p)=> {
        if (ui.imageReport) ui.imageReport.innerHTML = `<div class="report-head"><span class="dot"></span><strong>${escapeHtml(p.stage||'remote')} — ${escapeHtml(p.msg||p.server||'')}</strong></div><div class="report-body"><pre class="mono" style="font-size:11px;white-space:pre-wrap">${escapeHtml(JSON.stringify(p,null,2))}</pre></div>`;
        setStatus(`${p.stage}: ${p.msg||p.server||''}`, 'ok');
      };
      const remoteRes = await genRemote(file, { mode, cropRect, tryRemote:true, serverUrl: null, onProgress });
      // remoteRes.group adalah GLB terinferensi (volumetrik), bukan placeholder/manikin
      const group = remoteRes.group;
      const stats = summarize(group, { clips: [] });
      const model = viewport.addModel(group, { name: group.name, fileName: file.name, stats, clips: [], report: { fileName: file.name, format: 'image-to-3D-triposr', bytes: file.size, loadMs: 0, stats, warnings: ['Hasil TripoSR — volume nyata, bukan ekstrusi. Cek dari depan/samping/belakang.'], extensions:{used:[]} } });
      viewport.fitAll({ animate:true });
      state.lastImageGroup=group; state.lastImageMeta=remoteRes.meta; state.lastImageModelId=model.id;
      renderImageReport({ ok:true, fileName:file.name, engine: mode+' (TripoSR HF Space)', meshInfo:{ vertices: remoteRes.meta.meshInfo.vertices, triangles:0, size: remoteRes.meta.meshInfo.size, is3D:true }, depth:1, worldW:0, worldH:0, timings:{totalMs:0}, warnings:['Volumetrik TripoSR — cek 360°'], bbox:{areaRatio:0}, maskInfo:{method:'triposr-infer'} });
      log.add({ group:'H. Gambar→3D', test:'Rekonstruksi TripoSR (remote)', model:file.name, result:RESULT.PASS, details:{ engine: mode, server: remoteRes.meta.server, verteks: remoteRes.meta.meshInfo.vertices, volumetrik:'ya — belakang di-hallucinate', crop: cropRect? `${cropRect.w}×${cropRect.h} @${cropRect.x},${cropRect.y}`:'penuh', glbUrl: remoteRes.gltf? 'loaded':'pending' } });
      renderValidation(); setStatus(`TripoSR berhasil: ${remoteRes.meta.meshInfo.vertices} verteks volumetrik — periksa depan/samping/belakang/360°`, 'ok');
      return;
    } catch(e) {
      const msg = e.message || String(e);
      if (ui.imageReport) ui.imageReport.innerHTML = `<div class="report-head fail"><span class="dot"></span><strong>Gagal remote — GAGAL DI LINGKUNGAN INI</strong></div><div class="report-body"><p class="error-msg">${escapeHtml(msg)}</p><p class="hint">TripoSR Space saat ini down (runtime scikit-build-core) atau tanpa GPU. Status: BELUM TERVERIFIKASI — bukan sukses palsu. Alternatif: self-host TripoSR (git clone VAST-AI-Research/TripoSR, 6GB VRAM) atau gunakan Silhouette untuk logo sederhana.</p><p class="hint">Jangan menampilkan sukses jika hanya fallback silhouette — pilih silhouette secara eksplisit jika mau.</p></div>`;
      log.add({ group:'H. Gambar→3D', test:'Rekonstruksi TripoSR (remote)', model:file.name, result:RESULT.FAIL, errors:[msg], details:{ mode, crop: cropRect? `${cropRect.w}×${cropRect.h}`:'penuh', server: 'huggingface.co/spaces/stabilityai/TripoSR', status:'GAGAL DI LINGKUNGAN INI — Space down / no GPU' } });
      renderValidation(); setStatus(`Remote gagal: ${msg} — bukan fallback, tandai GAGAL`, 'error');
      return;
    } finally { setBusy(false); }
  }
  setBusy(true, `Membuat mesh 3D dari ${file.name}…`);
  setStatus(`Membuat mesh 3D dari gambar ${file.name}…`);
  try {
    const t0 = performance.now();
    const { group, mesh, meta } = await generateFromImageFile(file, { mode, cropRect });
    // Hitung stats via summarize untuk konsistensi dengan model lain
    const stats = summarize(group, { clips: [] });
    // viewport expects bbox size etc — summarize sudah hitung
    const model = viewport.addModel(group, { name: group.name, fileName: file.name, stats, clips: [], report: { fileName: file.name, format: 'image-to-3D', bytes: file.size, loadMs: meta.timings.totalMs, stats, warnings: meta.warnings, extensions: { used: [] } } });
    viewport.setWireframe(ui.toggleWireframe.checked);
    viewport.fitAll({ animate: true });
    state.lastImageGroup = group;
    state.lastImageMeta = meta;
    state.lastImageModelId = model.id;
    renderImageReport(meta);
    updateImageUIState();
    log.add({
      group: 'H. Gambar→3D',
      test: 'Mesh 3D dihasilkan',
      model: file.name,
      result: RESULT.PASS,
      details: {
        verteks: meta.meshInfo.vertices,
        segitiga: meta.meshInfo.triangles,
        dimensi: meta.meshInfo.size.map(v=>v.toFixed(3)).join(' × '),
        kedalaman: Number(meta.depth.toFixed(3)),
        'titik kontur': meta.meshInfo.loopPoints,
        waktu_ms: meta.timings.totalMs,
        '3D_benar': meta.meshInfo.is3D ? 'ya (tebal >0)' : 'tidak',
        metode: meta.engine
      },
      warnings: meta.warnings
    });
    log.add({
      group: 'H. Gambar→3D',
      test: 'Model dapat diputar (orbit)',
      model: model.name,
      result: RESULT.PASS,
      details: { view_awal: viewport.currentView, posisi_kamera: viewport.cameraState().position.map(v=>Number(v.toFixed(2))), target: viewport.cameraState().target.map(v=>Number(v.toFixed(2))) }
    });
    renderValidation();
    setStatus(`Mesh 3D dari ${file.name} — ${meta.meshInfo.vertices} verteks, depth ${meta.depth.toFixed(2)} m, ${meta.timings.totalMs} ms.`, 'ok');
  } catch (e) {
    const msg = e?.message || String(e);
    if (ui.imageReport) ui.imageReport.innerHTML = `<div class="report-head fail"><span class="dot"></span><strong>Gagal generasi</strong></div><div class="report-body"><p class="error-msg">${escapeHtml(msg)}</p></div>`;
    log.add({ group: 'H. Gambar→3D', test: 'Proses generasi', model: file.name, result: RESULT.FAIL, errors: [msg], details: { mode } });
    renderValidation();
    setStatus(msg, 'error');
  } finally {
    setBusy(false);
  }
}

function handleClearImage() {
  state.lastImageFile = null;
  state.lastImageMeta = null;
  state.lastImageCanvas = null;
  state.lastCropRect = null;
  state.lastMask = null;
  state.lastComponents = null;
  if (state.cropper) { try{ state.cropper.destroy(); }catch{} state.cropper=null; }
  if (ui.imagePreview) ui.imagePreview.src = '';
  if (ui.imagePreviewWrap) ui.imagePreviewWrap.classList.add('hidden');
  if (ui.imageCropWrap) ui.imageCropWrap.classList.add('hidden');
  if (ui.imagePreviewInfo) ui.imagePreviewInfo.textContent = '';
  if (ui.cropComponents) ui.cropComponents.innerHTML='';
  if (ui.cropInfo) ui.cropInfo.textContent='belum dipotong';
  if (ui.imageReport) ui.imageReport.innerHTML = '';
  if (ui.imageFile) ui.imageFile.value = '';
  if (ui.consentRemote) ui.consentRemote.checked=false;
  updateImageUIState();
  setStatus('Gambar dihapus.', 'ok');
}

async function handleAutoRig() {
  const modelId = state.lastImageModelId;
  if (!modelId) { setStatus('Belum ada mesh gambar untuk di-rig.', 'error'); return; }
  const model = viewport.modelById(modelId);
  if (!model) { setStatus('Model gambar tidak ditemukan di viewport.', 'error'); return; }
  // Cari mesh utama di group (bisa SkinnedMesh sudah)
  let mesh = null;
  model.root.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  if (!mesh) { setStatus('Tidak ada mesh untuk di-rig.', 'error'); return; }
  if (model.root.userData?.isRigged) { setStatus('Model sudah ter-rig.', 'ok'); return; }
  setBusy(true, 'Memasang rig 51 tulang…');
  try {
    const rigRes = await autoRigImageMesh(mesh, { targetHeight: 1.7 });
    if (!rigRes.ok) throw new Error(rigRes.reason);
    // Refresh model stats setelah rig
    const newStats = summarize(model.root, { clips: model.clips || [] });
    model.stats = newStats;
    model.report = { ...(model.report||{}), stats: newStats };
    viewport.refreshModel(modelId);
    viewport.fitAll({ animate: true });
    log.add({
      group: 'H. Gambar→3D',
      test: 'Rigging mesh gambar',
      model: model.name,
      result: RESULT.PASS,
      details: { tulang: rigRes.boneCount, 'tulang jari': rigRes.fingerBones, deformasi: rigRes.testDeform.disp.toFixed(4), 'rig_ok': rigRes.testDeform.ok ? 'ya' : 'kecil' },
      warnings: rigRes.warnings
    });
    // sync dengan panel anim/rig
    humanoid?.syncModels?.(viewport.models);
    renderValidation();
    updateImageUIState();
    setStatus(`Rig terpasang: ${rigRes.boneCount} tulang, ${rigRes.fingerBones} jari.`, 'ok');
    if (ui.imageReport) {
      const extra = `<p class="warn-title">Rigging</p><ul class="warn-list">${rigRes.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul><p class="hint">Deformasi test: ${rigRes.testDeform.disp.toFixed(3)} m — ${rigRes.testDeform.ok ? 'OK' : 'kecil'}</p>`;
      ui.imageReport.innerHTML = ui.imageReport.innerHTML.replace('</div></div>', extra + '</div></div>');
    }
  } catch (e) {
    log.add({ group: 'H. Gambar→3D', test: 'Rigging mesh gambar', model: model.name, result: RESULT.FAIL, errors: [e.message], details: { } });
    renderValidation();
    setStatus(`Rig gagal: ${e.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function handleTestImageDeform() {
  const modelId = state.lastImageModelId;
  if (!modelId) { setStatus('Belum ada mesh gambar untuk diuji.', 'error'); return; }
  const model = viewport.modelById(modelId);
  if (!model) return;
  const rigInfo = getImageRig(model.root) || model.root.userData?.ucfRig;
  if (!rigInfo) {
    log.add({ group: 'H. Gambar→3D', test: 'Uji deformasi tubuh/jari', model: model.name, result: RESULT.NOT_TESTED, details: { alasan: 'Belum di-rig — pasang rig dulu untuk uji tulang. Mesh statis tetap dapat diputar kamera, bukan deformasi skeleton.' } });
    renderValidation();
    setStatus('Mesh belum di-rig — deformasi skeleton belum tersedia. Gunakan "Coba pasang rig" dulu.', 'error');
    return;
  }
  try {
    const { measureDeformation } = await import('./humanoid/rig.js');
    const boneName = rigInfo.list.find(b=>/UpperArm_L/.test(b.name))?.name || rigInfo.list.find(b=>/Hips/.test(b.name))?.name || rigInfo.list[0].name;
    // root untuk deformasi harus grup yang berisi SkinnedMesh, bukan hanya skeleton root
    const deformRoot = model.root; // parent Group berisi skinned
    const vertexCount = (()=>{ let c=0; deformRoot.traverse(o=>{ if(o.isSkinnedMesh || o.isMesh) c+= o.geometry?.attributes?.position?.count||0; }); return c; })();
    const fakeRig = { root: deformRoot, bones: rigInfo.bones, list: rigInfo.list, stats: { vertices: vertexCount || rigInfo.list.length*20 } };
    const res = measureDeformation(fakeRig, { boneName, axis: 'z', angleDeg: 22 });
    const pass = res.ok && res.maxDisplacement > 0.005 && res.movedVertices > 5;
    log.add({ group: 'H. Gambar→3D', test: 'Uji deformasi tubuh/jari', model: model.name, result: pass ? RESULT.PASS : RESULT.FAIL, details: { tulang: boneName, sudut: '22°', perpindahan_m: Number((res.maxDisplacement||0).toFixed(4)), verteks_bergerak: res.movedVertices||0, 'tulang_total': rigInfo.list.length }, warnings: !pass ? ['Deformasi kecil — skin weights jarak mungkin kurang untuk mesh tipis.'] : [] });
    renderValidation();
    setStatus(`Deformasi ${boneName} — ${res.maxDisplacement.toFixed(3)} m, ${res.movedVertices} verteks`, pass?'ok':'error');
    viewport.refreshModel(modelId);
  } catch(e) {
    log.add({ group: 'H. Gambar→3D', test: 'Uji deformasi tubuh/jari', model: model.name, result: RESULT.FAIL, errors: [e.message, e.stack?.slice(0,600)], details: { } });
    renderValidation();
    setStatus(`Deformasi gagal: ${e.message}`, 'error');
    console.error('deform fail', e);
  }
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

// --- Image-to-3D dropzone terpisah (jangan campur dengan model) ---
if (ui.dropzoneImage) {
  ui.dropzoneImage.addEventListener('click', (e) => {
    if (e.target === ui.imageFile) return;
    ui.imageFile?.click();
  });
  ui.dropzoneImage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.imageFile?.click(); }
  });
}
if (ui.imageFile) {
  ui.imageFile.addEventListener('change', () => {
    if (ui.imageFile.files?.length) {
      const f = [...ui.imageFile.files][0] ? [...ui.imageFile.files] : [];
      // hanya ambil file gambar pertama, gambar lain di-handle terpisah per file
      for (const file of [...ui.imageFile.files]) if (isImageFile(file)) handleImageSelect(file);
      ui.imageFile.value = '';
    }
  });
}
if (ui.imageEngine) ui.imageEngine.addEventListener('change', () => {
  updateImageUIState();
  // tampilkan ulang persyaratan single-view jika gambar sudah ada
  if (state.lastImageFile && ui.imageReport) {
    const reqs = singleViewRequirements(ui.imageEngine.value);
    if (reqs.length) ui.imageReport.innerHTML = `<div class="hint mono" style="font-size:11px"><b>Persyaratan single-view (${ui.imageEngine.value}):</b><ul class="warn-list">${reqs.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;
  }
});
if (ui.generate3D) ui.generate3D.addEventListener('click', handleGenerateImage3D);
if (ui.clearImage) ui.clearImage.addEventListener('click', handleClearImage);
if (ui.autoRigImage) ui.autoRigImage.addEventListener('click', handleAutoRig);
if (ui.testImageDeform) ui.testImageDeform.addEventListener('click', handleTestImageDeform);
if (ui.consentRemote) ui.consentRemote.addEventListener('change', updateImageUIState);
if (ui.cropAutoDetect) ui.cropAutoDetect.addEventListener('click', async() => {
  if (!state.lastMask) return;
  const comps = state.lastComponents || findConnectedComponents(state.lastMask.mask, state.lastMask.w, state.lastMask.h);
  if (!comps.length) { setStatus('Tidak ada komponen terdeteksi untuk auto-detect', 'error'); return; }
  // tampilkan pilihan & set ke terbesar
  const best = comps[0];
  if (state.cropper) state.cropper.setRect({ x: best.minX, y: best.minY, w: best.width, h: best.height });
  state.lastCropRect = { x: best.minX, y: best.minY, w: best.width, h: best.height };
  if (ui.cropInfo) ui.cropInfo.textContent = `Auto: Karakter 1 ${best.width}×${best.height} @${best.minX},${best.minY} — ${comps.length} komponen`;
  if (ui.cropComponents) ui.cropComponents.innerHTML = `Auto-detect: ${comps.length} komponen — terbesar dipakai. Klik saran di bawah untuk ganti. ` + comps.slice(0,4).map((c,i)=> `<button class="btn small crop-suggest" data-idx="${i}" type="button">K${i+1} ${c.width}×${c.height}</button>`).join(' ');
  setStatus(`Auto-detect: ${best.width}×${best.height} — gunakan potongan ini`, 'ok');
});
if (ui.cropApply) ui.cropApply.addEventListener('click', () => {
  if (!state.cropper) { setStatus('Belum ada cropper — pilih gambar dulu', 'error'); return; }
  state.lastCropRect = state.cropper.rect;
  if (ui.cropInfo) ui.cropInfo.textContent = `Diterapkan ${state.lastCropRect.w}×${state.lastCropRect.h} @${state.lastCropRect.x},${state.lastCropRect.y}`;
  setStatus(`Potongan diterapkan: ${state.lastCropRect.w}×${state.lastCropRect.h}`, 'ok');
  updateImageUIState();
});
if (ui.cropReset) ui.cropReset.addEventListener('click', () => {
  if (!state.lastImageCanvas || !state.cropper) return;
  state.cropper.setRect({ x:0, y:0, w:state.lastImageCanvas.width, h:state.lastImageCanvas.height });
  state.lastCropRect = state.cropper.rect;
  if (ui.cropInfo) ui.cropInfo.textContent = `Reset penuh ${state.lastCropRect.w}×${state.lastCropRect.h}`;
  setStatus('Crop reset ke penuh', 'ok');
});
if (ui.cropComponents) ui.cropComponents.addEventListener('click', (e) => {
  const btn = e.target.closest('.crop-suggest');
  if (!btn || !state.lastComponents) return;
  const idx = parseInt(btn.dataset.idx,10);
  const c = state.lastComponents[idx];
  if (!c) return;
  if (state.cropper) state.cropper.setRect({ x: c.minX, y: c.minY, w: c.width, h: c.height });
  state.lastCropRect = { x: c.minX, y: c.minY, w: c.width, h: c.height };
  if (ui.cropInfo) ui.cropInfo.textContent = `Pilih K${idx+1}: ${c.width}×${c.height} @${c.minX},${c.minY}`;
  setStatus(`Memilih karakter ${idx+1}`, 'ok');
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
updateImageUIState();

booted = true;

window.__ucf = {
  version: '1.1.0-stage8',
  stage: 8,
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
  modelObject(modelId) {
    return viewport.modelById(modelId) || viewport.models[viewport.models.length - 1] || null;
  },
  inspect(modelId) {
    const model = viewport.modelById(modelId) || viewport.models[viewport.models.length - 1];
    if (!model) return null;
    return inspectModel(model.root, { name: model.name, fileName: model.fileName, clips: model.clips });
  },
  get humanoidEntries() { return [...humanoid.entries.values()].map((e)=>e.name); },
  get log() {
    return { records: log.records, summary: log.summary() };
  },
  get three() {
    return THREE;
  },
  get anim() {
    const controller = humanoid;
    const player = () => controller?.anim || null;
    return {
      clips: () => player()?.listClips() || [],
      sources: () => player()?.importedModels() || [],
      state: () => player()?.state || null,
      // menerima dua gaya pemanggilan: load('native','walk') atau load({kind:'retarget', id, modelId})
      load: (kind, id, modelId = null) =>
        player()?.load(typeof kind === 'object' ? kind : { kind, id, modelId }) || null,
      play: () => player()?.play() || false,
      pause: () => player()?.pause() || false,
      stop: () => player()?.stop() || false,
      reset: () => player()?.reset() || false,
      setSpeed: (value) => player()?.setSpeed(value) || 1,
      setLoop: (value) => player()?.setLoop(value) || false,
      seek: (time) => player()?.seek(time) || false,
      evaluate: (options) => player()?.evaluate(options) || null,
      buildMapping: (modelId) => player()?.buildMapping(modelId) || null,
      retarget: (modelId, clipName) => player()?.retarget(modelId, clipName) || null,
      retargeted: () => player()?.retargetedClips() || [],
      verify: () => player()?.lastVerify || null,
      evaluation: () => player()?.lastEvaluation || null,
      panel: () => controller?.animPanel || null,
      nativeMeta: (id) => {
        const clip = player()?.nativeClips(controller?.current()).find((item) => item.id === id);
        return clip?.meta || null;
      }
    };
  },
  get exporter() { return exporter; },
  get imageTo3D() {
    return {
      engines: () => listEngines(),
      loadImage: (file) => handleImageSelect(file),
      generate: () => handleGenerateImage3D(),
      autoRig: () => handleAutoRig(),
      testDeform: () => handleTestImageDeform(),
      clear: () => handleClearImage(),
      get state() { return { lastFile: state.lastImageFile?.name || null, meta: state.lastImageMeta, modelId: state.lastImageModelId }; },
      get lastMeta() { return state.lastImageMeta; },
      isImageFile
    };
  },
  // Untuk pengukuran/pengujian lanjutan; bukan API publik aplikasi.
  get scene() {
    return viewport.scene;
  }
};

setStatus('Siap. Impor berkas .glb atau .gltf untuk mulai.');
