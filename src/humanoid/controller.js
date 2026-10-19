/**
 * UCF Tahap 2 — panel & pengelola karakter humanoid prosedural.
 * Menghubungkan slider parameter ke builder, menyimpan riwayat, dan simpan/muat konfigurasi.
 */
import * as THREE from 'three';
import { buildHumanoid, measureHumanoid } from './builder.js';
import {
  activeParamDefs,
  defaultParams,
  clampParam,
  paramDef,
  POSE_IDS,
  PARAM_DEFS,
  ACTIVE_PARAM_PHASE,
  formatParamValue
} from './params.js';
import { objectSignature } from './signature.js';
import { exportConfig, parseConfig, sanitizeCharacterName, characterToConfig } from './config.js';
import { summarize } from '../stats.js';
import { RESULT } from '../validation.js';
import { formatNumber } from '../format.js';

const GROUP = 'G. Humanoid prosedural';

export class HumanoidController {
  constructor({ viewport, log = null, onSelect = null, onChanged = null, status = null, phase = ACTIVE_PARAM_PHASE } = {}) {
    this.viewport = viewport;
    this.log = log;
    this.onSelect = onSelect;
    this.onChanged = onChanged;
    this.status = status;
    this.phase = phase;

    this.entries = new Map();
    this.selectedModelId = null;
    this.history = [];
    this.redoStack = [];
    this.pendingSnapshot = new Map();
    this.nameSeq = 0;
    this.charSeq = 0;

    this.dom = {
      create: document.querySelector('#createHumanoid'),
      duplicate: document.querySelector('#duplicateHumanoid'),
      delete: document.querySelector('#deleteHumanoid'),
      reset: document.querySelector('#resetHumanoid'),
      undo: document.querySelector('#undoHumanoid'),
      redo: document.querySelector('#redoHumanoid'),
      name: document.querySelector('#humanoidName'),
      poseRadios: [...document.querySelectorAll('input[name="pose"]')],
      save: document.querySelector('#saveCharacterConfig'),
      load: document.querySelector('#loadCharacterConfig'),
      file: document.querySelector('#characterConfigFile'),
      params: document.querySelector('#humanoidParams'),
      readout: document.querySelector('#humanoidReadout'),
      hint: document.querySelector('#humanoidHint'),
      count: document.querySelector('#humanoidCount')
    };

    this.renderParamControls();
    this.bind();
    this.render();
  }

  /* ---------------------------------------------------------------- */
  /* util                                                              */
  /* ---------------------------------------------------------------- */

  current() {
    return this.selectedModelId ? this.entries.get(this.selectedModelId) || null : null;
  }

  snapshot(entry) {
    return { params: { ...entry.params }, pose: entry.pose };
  }

  record(test, result, details = {}, extra = {}) {
    this.log?.add({
      group: GROUP,
      test,
      model: extra.model || this.current()?.name || '—',
      result,
      warnings: extra.warnings || [],
      errors: extra.errors || [],
      details
    });
  }

  /* ---------------------------------------------------------------- */
  /* DOM                                                               */
  /* ---------------------------------------------------------------- */

  renderParamControls() {
    if (!this.dom.params) return;
    this.dom.params.innerHTML = '';
    const definitions = activeParamDefs(this.phase);
    const byGroup = new Map();
    for (const def of definitions) {
      if (!byGroup.has(def.group)) byGroup.set(def.group, []);
      byGroup.get(def.group).push(def);
    }

    const titles = new Map(PARAM_DEFS.map((def) => [def.group, null]));
    for (const group of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const list = byGroup.get(group);
      if (!list || !list.length) continue;
      const details = document.createElement('details');
      details.className = 'param-group';
      details.dataset.group = group;
      if (group === 'A') details.open = true;

      const summary = document.createElement('summary');
      const titleMap = { A: 'A · Proporsi', B: 'B · Kepala', C: 'C · Tubuh', D: 'D · Lengan', E: 'E · Tangan', F: 'F · Kaki' };
      summary.textContent = titleMap[group] || group;
      details.appendChild(summary);

      for (const def of list) {
        const row = document.createElement('div');
        row.className = 'param-row';
        row.dataset.key = def.key;

        const label = document.createElement('label');
        label.textContent = def.label;
        label.htmlFor = `param-${def.key}`;

        const output = document.createElement('output');
        output.id = `param-out-${def.key}`;
        output.textContent = formatParamValue(def, def.default);

        const input = document.createElement('input');
        input.type = 'range';
        input.id = `param-${def.key}`;
        input.dataset.param = def.key;
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        input.value = String(def.default);
        input.addEventListener('input', () => this.setParam(def.key, input.value));
        input.addEventListener('change', () => this.commitChange());

        row.append(label, output, input);
        details.appendChild(row);
      }
      this.dom.params.appendChild(details);
    }
  }

  bind() {
    this.dom.create?.addEventListener('click', () => {
      this.create();
      this.viewport.fitAll({ animate: true });
    });
    this.dom.duplicate?.addEventListener('click', () => this.duplicateSelected());
    this.dom.delete?.addEventListener('click', () => this.deleteSelected());
    this.dom.reset?.addEventListener('click', () => this.resetSelected());
    this.dom.undo?.addEventListener('click', () => this.undo());
    this.dom.redo?.addEventListener('click', () => this.redo());

    this.dom.name?.addEventListener('change', () => this.renameSelected(this.dom.name.value));
    this.dom.name?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.dom.name.blur();
      }
    });

    for (const radio of this.dom.poseRadios) {
      radio.addEventListener('change', () => {
        if (radio.checked) this.setPose(radio.value);
      });
    }

    this.dom.save?.addEventListener('click', () => this.downloadConfig());
    this.dom.load?.addEventListener('click', () => this.dom.file?.click());
    this.dom.file?.addEventListener('change', async () => {
      const file = this.dom.file.files?.[0];
      if (!file) return;
      this.dom.file.value = '';
      try {
        const text = await file.text();
        const result = this.loadConfig(text);
        this.status?.(`Konfigurasi dimuat: ${result.count} karakter.`, 'ok');
      } catch (error) {
        this.record('Muat konfigurasi karakter', RESULT.FAIL, { berkas: file.name }, { errors: [error.message] });
        this.status?.(`Gagal memuat konfigurasi: ${error.message}`, 'error');
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* rendering panel                                                   */
  /* ---------------------------------------------------------------- */

  render() {
    const entry = this.current();
    const has = Boolean(entry);
    const count = this.entries.size;
    if (this.dom.count) this.dom.count.textContent = `${count} karakter`;
    this.dom.hint?.classList.toggle('hidden', has || count > 0);
    if (!has && count > 0 && this.dom.hint) {
      this.dom.hint.textContent = 'Pilih humanoid di hierarki atau daftar model untuk mengedit parameter.';
      this.dom.hint.classList.remove('hidden');
    }
    this.dom.params?.classList.toggle('hidden', !has);
    this.dom.readout?.classList.toggle('hidden', !has);

    for (const element of [this.dom.duplicate, this.dom.delete, this.dom.reset, this.dom.name]) {
      if (element) element.disabled = !has;
    }
    for (const radio of this.dom.poseRadios) radio.disabled = !has;
    if (this.dom.save) this.dom.save.disabled = count === 0;
    if (this.dom.load) this.dom.load.disabled = false;
    if (this.dom.undo) this.dom.undo.disabled = this.history.length === 0;
    if (this.dom.redo) this.dom.redo.disabled = this.redoStack.length === 0;

    if (!has) return;

    if (this.dom.name && document.activeElement !== this.dom.name) this.dom.name.value = entry.name;
    for (const radio of this.dom.poseRadios) radio.checked = radio.value === entry.pose;

    for (const def of activeParamDefs(this.phase)) {
      const input = this.dom.params?.querySelector(`input[data-param="${def.key}"]`);
      if (input) input.value = String(entry.params[def.key]);
      const output = document.getElementById(`param-out-${def.key}`);
      if (output) output.textContent = formatParamValue(def, entry.params[def.key]);
    }

    this.updateReadout(entry);
  }

  updateReadout(entry) {
    if (!this.dom.readout) return;
    const signature = objectSignature(entry.content, { world: false });
    const model = this.viewport.modelById(entry.modelId);
    const height = model ? model.bbox.getSize(new THREE.Vector3()).y : signature?.size[1] || 0;
    this.dom.readout.innerHTML = `
      <div class="readout-grid">
        <span>Tinggi aktual</span><b>${height.toFixed(3)} m</b>
        <span>Mesh / verteks</span><b>${signature.parts} / ${formatNumber(signature.vertices)}</b>
        <span>Segitiga</span><b>${formatNumber(signature.triangles)}</b>
        <span>Material</span><b>${signature.materials}</b>
        <span>Hash geometri</span><b title="${signature.geometryHash}">${signature.geometryHash.slice(0, 8)}</b>
      </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* operasi karakter                                                  */
  /* ---------------------------------------------------------------- */

  create({ name, params, pose, position, rotationY, select = true, silent = false } = {}) {
    const built = buildHumanoid(params || {}, pose || 'T');
    const id = `char-${++this.charSeq}`;
    const finalName = sanitizeCharacterName(name, `Humanoid ${++this.nameSeq}`);

    const root = new THREE.Group();
    root.name = finalName;
    root.add(built.content);

    const stats = summarize(built.content);
    const model = this.viewport.addModel(root, { name: finalName, stats, kind: 'procedural' });
    root.userData.ucfProcedural = true;
    root.userData.ucfCharacterId = id;

    if (Array.isArray(position) && position.length === 3) root.position.fromArray(position);
    if (Number.isFinite(rotationY)) root.rotation.y = rotationY;
    this.viewport.refreshModel(model.id);

    const entry = {
      id,
      modelId: model.id,
      name: finalName,
      params: { ...built.params },
      pose: built.pose,
      content: built.content
    };
    this.entries.set(model.id, entry);
    this.pendingSnapshot.set(model.id, this.snapshot(entry));
    this.history = [];
    this.redoStack = [];
    if (select) this.selectedModelId = model.id;

    if (!silent) {
      const measured = measureHumanoid(built.content);
      this.record('Humanoid prosedural dibuat', RESULT.PASS, {
        karakter: finalName,
        parameter: Object.keys(entry.params).length,
        mesh: stats.meshes,
        verteks: stats.vertices,
        tinggi: Number(measured.size[1].toFixed(3))
      }, { model: finalName });
      this.status?.(`Humanoid "${finalName}" dibuat (${stats.meshes} mesh, ${formatNumber(stats.vertices)} verteks).`, 'ok');
    }

    this.render();
    if (select) this.onSelect?.(model.id);
    this.onChanged?.();
    return entry;
  }

  rebuild(entry) {
    const built = buildHumanoid(entry.params, entry.pose);
    entry.params = { ...built.params };
    entry.pose = built.pose;
    entry.content = built.content;
    const stats = summarize(built.content);
    this.viewport.replaceContent(entry.modelId, built.content, stats);
    if (this.selectedModelId === entry.modelId) this.onSelect?.(entry.modelId);
    this.render();
    this.onChanged?.();
    return built;
  }

  setParam(key, rawValue) {
    const entry = this.current();
    const def = paramDef(key);
    if (!entry || !def) return false;
    const value = clampParam(key, rawValue);
    if (value === null) return false;
    if (entry.params[key] === value) {
      const output = document.getElementById(`param-out-${key}`);
      if (output) output.textContent = formatParamValue(def, value);
      return false;
    }
    entry.params[key] = value;
    this.rebuild(entry);
    return true;
  }

  commitChange() {
    const entry = this.current();
    if (!entry) return false;
    const before = this.pendingSnapshot.get(entry.modelId);
    const after = this.snapshot(entry);
    if (!before || JSON.stringify(before) === JSON.stringify(after)) {
      this.render();
      return false;
    }
    this.history.push({ modelId: entry.modelId, before, after });
    if (this.history.length > 60) this.history.shift();
    this.redoStack = [];
    this.pendingSnapshot.set(entry.modelId, after);
    this.render();
    return true;
  }

  setPose(pose) {
    const entry = this.current();
    if (!entry || !POSE_IDS.includes(pose) || entry.pose === pose) return false;
    entry.pose = pose;
    this.rebuild(entry);
    this.commitChange();
    this.record('Pose karakter diubah', RESULT.PASS, { pose }, { model: entry.name });
    return true;
  }

  resetSelected() {
    const entry = this.current();
    if (!entry) return false;
    entry.params = defaultParams();
    entry.pose = 'T';
    this.rebuild(entry);
    this.commitChange();
    this.record('Parameter humanoid direset', RESULT.PASS, { parameter: Object.keys(entry.params).length, pose: 'T' }, { model: entry.name });
    this.status?.('Parameter humanoid direset ke default.', 'ok');
    return true;
  }

  renameSelected(value) {
    const entry = this.current();
    if (!entry) return null;
    const clean = sanitizeCharacterName(value, entry.name);
    if (clean === entry.name) {
      this.render();
      return clean;
    }
    entry.name = clean;
    this.viewport.renameModel(entry.modelId, clean);
    this.record('Ganti nama karakter', RESULT.PASS, { nama: clean }, { model: clean });
    this.render();
    this.onChanged?.();
    this.status?.(`Nama karakter diubah menjadi "${clean}".`, 'ok');
    return clean;
  }

  duplicateSelected() {
    const entry = this.current();
    if (!entry) return null;
    const original = objectSignature(entry.content, { world: false });
    const copy = this.create({
      name: `${entry.name} (salinan)`,
      params: { ...entry.params },
      pose: entry.pose
    });
    const copySignature = objectSignature(copy.content, { world: false });
    const same = original?.geometryHash === copySignature?.geometryHash;
    this.record('Duplikasi karakter', same ? RESULT.PASS : RESULT.FAIL, {
      asal: entry.name,
      salinan: copy.name,
      'hash geometri sama': same
    }, { model: copy.name });
    this.status?.(same ? `Karakter diduplikasi: "${copy.name}".` : 'Duplikasi menghasilkan geometri berbeda.', same ? 'ok' : 'error');
    return copy;
  }

  deleteSelected() {
    const entry = this.current();
    if (!entry) return false;
    const name = entry.name;
    this.viewport.removeModel(entry.modelId);
    this.entries.delete(entry.modelId);
    this.pendingSnapshot.delete(entry.modelId);
    if (this.selectedModelId === entry.modelId) this.selectedModelId = null;
    this.history = [];
    this.redoStack = [];
    this.record('Humanoid dihapus', RESULT.PASS, { karakter: name }, { model: name });
    this.render();
    this.onChanged?.();
    this.onSelect?.(null);
    this.status?.(`Humanoid "${name}" dihapus.`, 'ok');
    return true;
  }

  undo() {
    const item = this.history.pop();
    if (!item) return false;
    const entry = this.entries.get(item.modelId);
    if (!entry) return this.undo();
    const current = this.snapshot(entry);
    entry.params = { ...item.before.params };
    entry.pose = item.before.pose;
    this.rebuild(entry);
    this.pendingSnapshot.set(entry.modelId, this.snapshot(entry));
    this.redoStack.push({ modelId: item.modelId, before: current, after: this.snapshot(entry) });
    this.selectedModelId = item.modelId;
    this.render();
    this.onSelect?.(item.modelId);
    this.status?.('Perubahan dibatalkan (undo).', 'ok');
    return true;
  }

  redo() {
    const item = this.redoStack.pop();
    if (!item) return false;
    const entry = this.entries.get(item.modelId);
    if (!entry) return this.redo();
    entry.params = { ...item.after.params };
    entry.pose = item.after.pose;
    this.rebuild(entry);
    this.pendingSnapshot.set(item.modelId, this.snapshot(entry));
    this.history.push({ modelId: item.modelId, before: item.before, after: item.after });
    this.selectedModelId = item.modelId;
    this.render();
    this.onSelect?.(item.modelId);
    this.status?.('Perubahan diulang (redo).', 'ok');
    return true;
  }

  setSelection(modelId) {
    const next = modelId && this.entries.has(modelId) ? modelId : null;
    this.selectedModelId = next;
    this.render();
  }

  syncModels(models) {
    const ids = new Set((models || []).map((model) => model.id));
    let changed = false;
    for (const modelId of [...this.entries.keys()]) {
      if (!ids.has(modelId)) {
        this.entries.delete(modelId);
        this.pendingSnapshot.delete(modelId);
        changed = true;
        if (this.selectedModelId === modelId) this.selectedModelId = null;
      }
    }
    if (changed) {
      this.history = [];
      this.redoStack = [];
      this.render();
    }
  }

  clearAll() {
    this.entries.clear();
    this.pendingSnapshot.clear();
    this.selectedModelId = null;
    this.history = [];
    this.redoStack = [];
    this.render();
  }

  /* ---------------------------------------------------------------- */
  /* konfigurasi                                                       */
  /* ---------------------------------------------------------------- */

  saveConfig() {
    const characters = [...this.entries.values()].map((entry) =>
      characterToConfig(entry, this.viewport.modelById(entry.modelId))
    );
    return exportConfig(characters);
  }

  downloadConfig() {
    const config = this.saveConfig();
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ucf-konfigurasi-karakter.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.record('Simpan konfigurasi karakter', RESULT.PASS, {
      karakter: config.characters.length,
      byte: blob.size
    });
    this.status?.(`Konfigurasi ${config.characters.length} karakter diunduh (${blob.size} byte).`, 'ok');
    return config;
  }

  loadConfig(text) {
    const parsed = parseConfig(text);
    for (const modelId of [...this.entries.keys()]) this.viewport.removeModel(modelId);
    this.entries.clear();
    this.pendingSnapshot.clear();
    this.selectedModelId = null;
    this.history = [];
    this.redoStack = [];

    for (const character of parsed.characters) {
      this.create({
        name: character.name,
        params: character.params,
        pose: character.pose,
        position: character.transform.position,
        rotationY: character.transform.rotationY,
        select: false,
        silent: true
      });
    }

    const modelIds = [...this.entries.keys()];
    const last = modelIds.at(-1) || null;
    this.selectedModelId = last;
    this.render();
    if (last) this.onSelect?.(last);
    this.onChanged?.();

    this.record('Muat konfigurasi karakter', RESULT.PASS, {
      karakter: parsed.characters.length,
      peringatan: parsed.warnings.length
    }, { warnings: parsed.warnings });
    return { count: parsed.characters.length, warnings: parsed.warnings, selectedModelId: last };
  }

  /* ---------------------------------------------------------------- */
  /* debug untuk pengujian                                             */
  /* ---------------------------------------------------------------- */

  state() {
    const entry = this.current();
    const model = entry ? this.viewport.modelById(entry.modelId) : null;
    return {
      count: this.entries.size,
      selected: entry
        ? {
            id: entry.id,
            modelId: entry.modelId,
            name: entry.name,
            pose: entry.pose,
            params: { ...entry.params },
            signature: objectSignature(entry.content, { world: true }),
            geometry: objectSignature(entry.content, { world: false }),
            height: model ? model.bbox.getSize(new THREE.Vector3()).y : null
          }
        : null,
      visibleParams: activeParamDefs(this.phase).map((def) => def.key),
      canUndo: this.history.length > 0,
      canRedo: this.redoStack.length > 0
    };
  }

  list() {
    return [...this.entries.values()].map((entry) => ({
      id: entry.id,
      modelId: entry.modelId,
      name: entry.name,
      pose: entry.pose,
      params: { ...entry.params }
    }));
  }

  signature(modelId) {
    const entry = modelId ? this.entries.get(modelId) : this.current();
    return entry ? objectSignature(entry.content, { world: true }) : null;
  }
}
