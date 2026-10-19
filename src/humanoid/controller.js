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
import { measureDeformation, applyPose } from './rig.js';
import { ModularManager, BASE_MODULE_ID } from '../modular/manager.js';
import { ModularPanel } from '../modular/ui.js';
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
    this.selectedBone = null;
    this.rigToggles = { skeleton: false, names: false };
    this.rigHelpers = new Map();

    this.modular = new ModularManager({
      onChange: (entry) => this.onModularChange(entry)
    });
    this.modulePanel = new ModularPanel({
      controller: this,
      manager: this.modular,
      status: (message, level) => this.status?.(message, level)
    });

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
      count: document.querySelector('#humanoidCount'),
      rig: {
        summary: document.querySelector('#rigSummary'),
        skeleton: document.querySelector('#toggleSkeleton'),
        names: document.querySelector('#toggleBoneNames'),
        select: document.querySelector('#boneSelect'),
        rotX: document.querySelector('#boneRotX'),
        rotY: document.querySelector('#boneRotY'),
        rotZ: document.querySelector('#boneRotZ'),
        outX: document.querySelector('#boneRotXOut'),
        outY: document.querySelector('#boneRotYOut'),
        outZ: document.querySelector('#boneRotZOut'),
        resetPose: document.querySelector('#resetBonePose'),
        test: document.querySelector('#testDeformation'),
        weights: document.querySelector('#checkWeights'),
        info: document.querySelector('#boneInfo')
      }
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

    this.dom.rig.skeleton?.addEventListener('change', () => {
      this.rigToggles.skeleton = this.dom.rig.skeleton.checked;
      for (const helpers of this.rigHelpers.values()) helpers.skeleton.visible = this.rigToggles.skeleton;
    });
    this.dom.rig.names?.addEventListener('change', () => {
      this.rigToggles.names = this.dom.rig.names.checked;
      for (const helpers of this.rigHelpers.values()) {
        for (const { sprite } of helpers.labels) sprite.visible = this.rigToggles.names;
      }
    });
    this.dom.rig.select?.addEventListener('change', () => this.selectBone(this.dom.rig.select.value));
    for (const axis of ['x', 'y', 'z']) {
      const input = this.dom.rig[`rot${axis.toUpperCase()}`];
      input?.addEventListener('input', () => this.setBoneRotation(axis, Number(input.value)));
    }
    this.dom.rig.resetPose?.addEventListener('click', () => this.resetBonePose());
    this.dom.rig.test?.addEventListener('click', () => this.testDeformation());
    this.dom.rig.weights?.addEventListener('click', () => this.checkWeights());

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
    this.renderRig();

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
    this.renderRig();
    this.modulePanel?.render();
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
  /* modular (Tahap 4)                                                 */
  /* ---------------------------------------------------------------- */

  recordModule(test, result, details = {}, warnings = []) {
    this.log?.add({
      group: 'D. Modular',
      test,
      model: this.current()?.name || '—',
      result,
      warnings: Array.isArray(warnings) ? warnings : [],
      errors: result === RESULT.FAIL ? [details.alasan || 'modul ditolak'] : [],
      details
    });
  }

  onModularChange(entry) {
    if (!entry?.content) return;
    const model = this.viewport.modelById(entry.modelId);
    if (model) {
      model.stats = summarize(entry.content);
      this.viewport.refreshModel(entry.modelId);
    }
    this.modulePanel?.render();
    this.renderRig();
    this.onChanged?.();
  }

  moduleState() {
    const entry = this.current();
    if (!entry) return { attached: [], library: [], summary: null, selected: null };
    const attached = this.modular.attached(entry)
      .filter((instance) => instance.moduleId !== BASE_MODULE_ID)
      .map((instance) => ({
        instanceId: instance.instanceId,
        moduleId: instance.moduleId,
        name: instance.name,
        category: instance.category,
        attachmentType: instance.attachmentType,
        visible: instance.visible,
        meshCount: instance.meshes.length,
        overrides: { ...instance.overrides },
        status: instance.compat?.status || 'UNKNOWN',
        checks: instance.compat?.checks || [],
        warnings: instance.compat?.warnings || []
      }));
    return {
      attached,
      summary: this.modular.summary(entry),
      selected: this.modulePanel?.selectedInstanceId || null,
      library: this.modular.listLibrary(entry, { search: '', category: 'all' }).map(({ module, attached: isAttached }) => ({
        moduleId: module.moduleId,
        moduleName: module.moduleName,
        category: module.category,
        attachmentType: module.attachmentType,
        validationStatus: module.validationStatus,
        sourceFormat: module.sourceFormat,
        sourceLicense: module.sourceLicense,
        requiredBones: [...module.requiredBones],
        attached: isAttached,
        imported: Boolean(module.imported)
      }))
    };
  }

  attachModule(moduleId) {
    return this.modulePanel?.attach(moduleId) || null;
  }

  detachModule(instanceId) {
    return this.modulePanel?.detachInstance(instanceId) || false;
  }

  replaceModule(instanceId) {
    return this.modulePanel?.replaceInstance(instanceId) || false;
  }

  deleteModule(instanceId) {
    return this.modulePanel?.deleteInstance(instanceId) || false;
  }

  renameModule(instanceId, name) {
    const entry = this.current();
    if (!entry) return false;
    const ok = this.modular.rename(entry, instanceId, name);
    this.modulePanel?.render();
    return ok;
  }

  setModuleMaterial(instanceId, values) {
    const entry = this.current();
    if (!entry) return false;
    const ok = this.modular.setMaterial(entry, instanceId, values);
    this.modulePanel?.render();
    return ok;
  }

  setModuleVisible(instanceId, visible) {
    const entry = this.current();
    if (!entry) return false;
    const ok = this.modular.setVisible(entry, instanceId, visible);
    this.modulePanel?.render();
    return ok;
  }

  importModuleManifest(text) {
    return this.modulePanel?.importManifest(text, 'manifest') || null;
  }

  previewModule(moduleId) {
    return this.modulePanel?.preview(moduleId) || null;
  }

  /* ---------------------------------------------------------------- */
  /* rigging (Tahap 3)                                                 */
  /* ---------------------------------------------------------------- */

  rigOf(entry) {
    return entry?.content?.userData?.ucfRig || null;
  }

  ensureRigHelpers(entry) {
    this.disposeRigHelpers(entry);
    const rig = this.rigOf(entry);
    if (!rig) return;

    const skeleton = new THREE.SkeletonHelper(entry.content);
    skeleton.name = `SkeletonHelper_${entry.id}`;
    skeleton.userData.ucfHelper = true;
    skeleton.visible = this.rigToggles.skeleton;
    this.viewport.addHelper(skeleton);

    const labels = [];
    for (const bone of rig.list) {
      const sprite = makeBoneLabel(bone.name);
      sprite.visible = this.rigToggles.names;
      this.viewport.addHelper(sprite);
      labels.push({ sprite, bone });
    }

    const marker = new THREE.AxesHelper(0.075);
    marker.name = `BoneMarker_${entry.id}`;
    marker.userData.ucfHelper = true;
    marker.visible = false;
    this.viewport.addHelper(marker);

    this.rigHelpers.set(entry.modelId, { skeleton, labels, marker });
    this.syncRigHelpers(entry);
  }

  /** Posisi label & penanda mengikuti tulang tanpa menjadi anak model (agar tak terekspor). */
  syncRigHelpers(entry = this.current()) {
    const helpers = entry ? this.rigHelpers.get(entry.modelId) : null;
    if (!helpers) return;
    entry.content.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    for (const { sprite, bone } of helpers.labels) {
      bone.getWorldPosition(world);
      sprite.position.copy(world);
    }
    if (helpers.markerBone) {
      helpers.markerBone.getWorldPosition(world);
      helpers.marker.position.copy(world);
    }
  }

  disposeRigHelpers(entry) {
    if (!entry) return;
    const helpers = this.rigHelpers.get(entry.modelId);
    if (!helpers) return;
    this.viewport.removeHelper(helpers.skeleton);
    for (const { sprite } of helpers.labels) {
      this.viewport.removeHelper(sprite);
      sprite.material?.map?.dispose?.();
      sprite.material?.dispose?.();
    }
    this.viewport.removeHelper(helpers.marker);
    helpers.marker.geometry?.dispose?.();
    helpers.marker.material?.dispose?.();
    this.rigHelpers.delete(entry.modelId);
  }

  selectBone(name) {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig || !name || !rig.bones.has(name)) {
      this.selectedBone = null;
      this.renderRig();
      return false;
    }
    this.selectedBone = name;
    const helpers = this.rigHelpers.get(entry.modelId);
    if (helpers) {
      helpers.markerBone = rig.bones.get(name);
      helpers.marker.visible = true;
      this.syncRigHelpers(entry);
    }
    this.renderRig();
    return true;
  }

  setBoneRotation(axis, degrees) {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig || !this.selectedBone) return false;
    const bone = rig.bones.get(this.selectedBone);
    if (!bone) return false;
    const radians = (Number(degrees) || 0) * (Math.PI / 180);
    bone.rotation[axis] = radians;
    entry.content.updateMatrixWorld(true);
    this.syncRigHelpers(entry);
    this.renderRig();
    this.onChanged?.();
    return true;
  }

  resetBonePose() {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig) return false;
    applyPose(rig, entry.pose);
    this.viewport.refreshModel(entry.modelId);
    const helpers = this.rigHelpers.get(entry.modelId);
    if (helpers) {
      helpers.markerBone = null;
      helpers.marker.visible = false;
    }
    this.syncRigHelpers(entry);
    this.renderRig();
    this.onChanged?.();
    this.record('Reset pose rig', RESULT.PASS, { pose: entry.pose, tulang: rig.stats.bones }, { model: entry.name });
    this.status?.('Rotasi tulang direset ke pose karakter.', 'ok');
    return true;
  }

  testDeformation() {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig) return null;
    const boneName = this.selectedBone && this.selectedBone.startsWith('LowerArm') ? this.selectedBone : 'LowerArm_R';
    const result = measureDeformation(rig, { boneName, axis: 'z', angleDeg: 45 });
    const pass = Boolean(result.ok) && result.maxDisplacement > 0.02 && result.headDisplacement < 0.001 && result.resetError < 1e-4;
    this.record('Uji deformasi sendi', pass ? RESULT.PASS : RESULT.FAIL, {
      tulang: result.bone,
      sudut: result.angleDeg,
      perpindahan_maks_m: Number(result.maxDisplacement.toFixed(4)),
      verteks_bergerak: result.movedVertices,
      perpindahan_kepala_m: Number(result.headDisplacement.toFixed(4)),
      galat_reset: result.resetError
    }, { model: entry.name, errors: pass ? [] : ['Deformasi atau reset di luar ambang'] });
    this.status?.(
      pass
        ? `Deformasi OK: ${boneName} memindahkan ${result.movedVertices} verteks (maks ${result.maxDisplacement.toFixed(3)} m), kepala tetap.`
        : 'Uji deformasi GAGAL — lihat status validasi.',
      pass ? 'ok' : 'error'
    );
    this.render();
    return result;
  }

  checkWeights() {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig) return null;
    const stats = rig.stats;
    const pass = stats.unweighted === 0 && stats.maxInfluences <= 4 && stats.maxSumError < 1e-3;
    this.record('Cek skin weights', pass ? RESULT.PASS : RESULT.FAIL, {
      verteks: stats.vertices,
      tanpa_bobot: stats.unweighted,
      pengaruh_maks: stats.maxInfluences,
      galat_jumlah_bobot: stats.maxSumError
    }, { model: entry.name, errors: pass ? [] : ['Ada verteks tanpa bobot atau bobot tidak normal'] });
    this.status?.(
      pass
        ? `Skin weights OK: ${formatNumber(stats.vertices)} verteks, 0 tanpa bobot, maks ${stats.maxInfluences} tulang/verteks.`
        : 'Cek weights GAGAL — lihat status validasi.',
      pass ? 'ok' : 'error'
    );
    this.render();
    return stats;
  }

  rigState() {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig) return null;
    return {
      pose: rig.pose,
      stats: { ...rig.stats },
      selectedBone: this.selectedBone,
      bones: rig.list.map((bone) => ({
        name: bone.name,
        parent: bone.parent?.isBone ? bone.parent.name : null,
        children: bone.children.filter((child) => child.isBone).length
      }))
    };
  }

  measureDeformation(options = {}) {
    const entry = this.current();
    const rig = this.rigOf(entry);
    if (!rig) return null;
    return measureDeformation(rig, options);
  }

  renderRig() {
    const dom = this.dom.rig;
    if (!dom?.select) return;
    const entry = this.current();
    const rig = this.rigOf(entry);
    const has = Boolean(rig);

    for (const element of [dom.select, dom.rotX, dom.rotY, dom.rotZ, dom.resetPose, dom.test, dom.weights]) {
      if (element) element.disabled = !has;
    }
    if (!has) {
      if (dom.summary) dom.summary.textContent = '—';
      if (dom.info) dom.info.textContent = 'Buat humanoid untuk memeriksa skeleton dan skin weights.';
      if (dom.select) dom.select.innerHTML = '<option value="">Belum ada karakter</option>';
      return;
    }

    if (dom.summary) {
      dom.summary.textContent = `${rig.stats.bones} tulang · ${rig.stats.skinnedMeshes} skinned`;
    }

    const names = rig.list.map((bone) => bone.name);
    if (dom.select.dataset.count !== String(names.length) || dom.select.options.length !== names.length) {
      dom.select.innerHTML = names.map((name) => `<option value="${name}">${name}</option>`).join('');
      dom.select.dataset.count = String(names.length);
    }

    const keep = this.selectedBone && names.includes(this.selectedBone) ? this.selectedBone : 'Hips';
    this.selectedBone = names.includes(keep) ? keep : names[0];
    dom.select.value = this.selectedBone;

    const bone = rig.bones.get(this.selectedBone);
    if (bone) {
      const toDeg = (radians) => Math.round((radians * 180) / Math.PI);
      dom.rotX.value = String(toDeg(bone.rotation.x));
      dom.rotY.value = String(toDeg(bone.rotation.y));
      dom.rotZ.value = String(toDeg(bone.rotation.z));
      if (dom.outX) dom.outX.textContent = `${toDeg(bone.rotation.x)}°`;
      if (dom.outY) dom.outY.textContent = `${toDeg(bone.rotation.y)}°`;
      if (dom.outZ) dom.outZ.textContent = `${toDeg(bone.rotation.z)}°`;
    }

    if (dom.info) {
      const parent = bone?.parent?.isBone ? bone.parent.name : '—';
      const children = bone ? bone.children.filter((child) => child.isBone).length : 0;
      dom.info.textContent = `${this.selectedBone} · induk ${parent} · ${children} tulang anak · total ${rig.stats.bones} tulang, ${formatNumber(rig.stats.vertices)} verteks berbobot.`;
    }
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

    this.ensureRigHelpers(entry);
    this.modulePanel?.render();
    this.render();
    if (select) this.onSelect?.(model.id);
    this.onChanged?.();
    return entry;
  }

  rebuild(entry) {
    this.disposeRigHelpers(entry);
    const built = buildHumanoid(entry.params, entry.pose);
    entry.params = { ...built.params };
    entry.pose = built.pose;
    entry.content = built.content;
    const stats = summarize(built.content);
    this.viewport.replaceContent(entry.modelId, built.content, stats);
    const reattached = this.modular.reattachAll(entry);
    if (reattached.failed) {
      this.status?.(`${reattached.failed} modul gagal dipasang ulang setelah perubahan parameter.`, 'error');
    }
    this.ensureRigHelpers(entry);
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
    const rig = this.rigOf(entry);
    if (!entry || !rig || !POSE_IDS.includes(pose) || entry.pose === pose) return false;
    entry.pose = pose;
    applyPose(rig, pose);
    this.viewport.refreshModel(entry.modelId);
    this.selectedBone = null;
    const helpers = this.rigHelpers.get(entry.modelId);
    if (helpers) helpers.marker.visible = false;
    this.syncRigHelpers(entry);
    this.commitChange();
    this.record('Pose karakter diubah (rotasi tulang)', RESULT.PASS, { pose }, { model: entry.name });
    this.render();
    this.onChanged?.();
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
    const modules = this.modular.serialize(entry).modules;
    if (modules.length) {
      const restored = this.modular.restore(copy, modules);
      if (restored.warnings.length) this.status?.(restored.warnings.join(' '), 'warn');
      this.modulePanel?.render();
    }
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
    this.modular.clear(entry);
    this.disposeRigHelpers(entry);
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
    // redo harus mengembalikan keadaan SEBELUM undo (current), bukan keadaan setelah undo
    this.redoStack.push({ modelId: item.modelId, before: this.snapshot(entry), after: current });
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
    for (const entry of [...this.entries.values()]) {
      this.modular.clear(entry);
      this.disposeRigHelpers(entry);
    }
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
      characterToConfig(entry, this.viewport.modelById(entry.modelId), this.modular.serialize(entry))
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
    for (const entry of [...this.entries.values()]) this.disposeRigHelpers(entry);
    for (const modelId of [...this.entries.keys()]) this.viewport.removeModel(modelId);
    this.entries.clear();
    this.pendingSnapshot.clear();
    this.selectedModelId = null;
    this.history = [];
    this.redoStack = [];

    const moduleWarnings = [];
    for (const character of parsed.characters) {
      const created = this.create({
        name: character.name,
        params: character.params,
        pose: character.pose,
        position: character.transform.position,
        rotationY: character.transform.rotationY,
        select: false,
        silent: true
      });
      if (character.modules?.length) {
        const restored = this.modular.restore(created, character.modules);
        for (const warning of restored.warnings) moduleWarnings.push(`${character.name}: ${warning}`);
      }
    }
    for (const warning of moduleWarnings) parsed.warnings.push(warning);

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
    const signature = entry ? objectSignature(entry.content) : null;
    const rig = this.rigOf(entry);
    return {
      count: this.entries.size,
      selected: entry
        ? {
            id: entry.id,
            modelId: entry.modelId,
            name: entry.name,
            pose: entry.pose,
            params: { ...entry.params },
            signature,
            geometry: { ...signature, hash: signature?.geometryHash },
            height: computeRigHeight(entry.content),
            rig: rig
              ? {
                  ...rig.stats,
                  pose: rig.pose,
                  selectedBone: this.selectedBone,
                  boneNames: rig.list.map((bone) => bone.name)
                }
              : null
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

function makeBoneLabel(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(6, 14, 26, 0.82)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '600 30px system-ui, -apple-system, Segoe UI, sans-serif';
  context.fillStyle = '#bae6fd';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.name = `Label_${name}`;
  sprite.userData.ucfHelper = true;
  sprite.scale.set(0.19, 0.048, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function computeRigHeight(content) {
  try {
    const bounds = measureHumanoid(content);
    return bounds.size[1];
  } catch {
    return null;
  }
}
