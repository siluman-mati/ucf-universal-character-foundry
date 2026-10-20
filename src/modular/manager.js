/**
 * UCF Tahap 4 — pengelola modul karakter.
 *
 * Menyimpan library modul (bawaan + hasil impor), status pemasangan per
 * karakter, serta operasi pasang/lepas/sembunyikan/ganti/hapus/rename/
 * ubah material. Semua perubahan menyentuh scene graph yang sebenarnya.
 */
import * as THREE from 'three';
import { createCatalog } from './library.js';
import { generatorIds, runGenerator } from './generators.js';
import {
  BODY_PROFILE_ID,
  COMPAT_STATUS,
  MODULE_CATEGORIES,
  SKELETON_ID,
  VALIDATION_STATUS,
  categoryLabel,
  targetProfileForRig,
  validateModuleManifest
} from './metadata.js';
import { checkModuleCompatibility } from './compat.js';
import { skinGeometryForRig } from '../humanoid/rig.js';
import { NOMINAL_HEIGHT } from '../humanoid/params.js';
import { summarize } from '../stats.js';

export const BASE_MODULE_ID = 'base-body-ucf';
const SINGLE_SLOT = new Set(['skin', 'face', 'hair', 'tops', 'bottoms', 'shoes']);
const PREFIX = 'ML_';

function newId(prefix, seq) {
  return `${prefix}-${seq}`;
}

export class ModularManager {
  constructor({ log = null, status = null, onChange = null } = {}) {
    this.log = log;
    this.status = status;
    this.onChange = onChange;
    this.library = new Map();
    this.states = new Map();
    this.thumbnailCache = new Map();
    this.thumbnailRenderer = null;

    const { modules, rejected } = createCatalog();
    for (const module of modules) this.library.set(module.moduleId, module);
    this.rejectedBuiltins = rejected;
  }

  /* ---------------- library ---------------- */

  listLibrary(entry = null, { search = '', category = 'all' } = {}) {
    const query = String(search || '').trim().toLowerCase();
    const attachedIds = new Set((entry ? this.attached(entry) : []).map((instance) => instance.moduleId));
    return [...this.library.values()]
      .filter((module) => category === 'all' || module.category === category)
      .filter((module) => !query || `${module.moduleName} ${module.moduleId} ${categoryLabel(module.category)}`.toLowerCase().includes(query))
      .map((module) => ({
        module,
        attached: attachedIds.has(module.moduleId),
        thumb: this.thumbnail(module, entry)
      }));
  }

  getModule(moduleId) {
    return this.library.get(moduleId) || null;
  }

  /* ---------------- state ---------------- */

  stateOf(entry) {
    let state = this.states.get(entry.modelId);
    if (!state) {
      state = { modules: [], seq: 0 };
      this.states.set(entry.modelId, state);
    }
    return state;
  }

  attached(entry) {
    return this.stateOf(entry).modules;
  }

  bodyMeshesOf(entry) {
    const rig = entry?.content?.userData?.ucfRig;
    const meshes = [];
    rig?.root?.traverse((object) => {
      if (object.isMesh && !object.name.startsWith(PREFIX)) meshes.push(object);
    });
    return meshes;
  }

  summary(entry) {
    const rig = entry?.content?.userData?.ucfRig;
    const modules = entry ? this.attached(entry) : [];
    return {
      attached: modules.filter((instance) => instance.moduleId !== BASE_MODULE_ID).length,
      total: modules.length,
      meshes: rig?.root ? summarize(rig.root).meshes : 0,
      bones: rig?.stats?.bones || 0,
      categories: MODULE_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        attached: modules.filter((instance) => instance.category === category.id).length
      }))
    };
  }

  /* ---------------- generate & attach ---------------- */

  buildMeshes(entry, module, instance) {
    const rig = entry.content?.userData?.ucfRig;
    if (!rig) return { error: 'Karakter belum memiliki rig.' };
    if (module.attachmentType === 'base') {
      return { meshes: { all: [], skinned: [], root: null, materialTargets: [], materialNames: new Set() }, materialSwap: null };
    }

    const s = entry.params.height / NOMINAL_HEIGHT;
    // Geometri modul disusun dari posisi tulang pada BIND POSE. Kalau karakter sedang
    // berpose/beranimasi, pose dipulihkan dulu supaya modul tidak tergambar di posisi salah.
    const poseStore = rig.list.map((item) => ({ bone: item, quat: item.quaternion.clone(), pos: item.position.clone() }));
    const restorePose = () => {
      for (const item of poseStore) {
        item.bone.quaternion.copy(item.quat);
        item.bone.position.copy(item.pos);
      }
      rig.root.updateMatrixWorld(true);
    };
    const resetToBind = () => {
      for (const item of rig.list) item.quaternion.identity();
      rig.root.updateMatrixWorld(true);
    };
    resetToBind();
    let built = null;
    try {
      built = runGenerator(module.generator, {
        params: entry.params,
        s,
        rig,
        options: { ...module.options, ...(instance?.options || {}) }
      });
    } finally {
      restorePose();
    }
    if (!built) return { error: `Generator "${module.generator}" tidak tersedia.` };

    const materials = [];
    for (const part of built.parts) {
      const list = part.material ? (Array.isArray(part.material) ? part.material : [part.material]) : [];
      for (const material of list) if (!materials.includes(material)) materials.push(material);
    }

    const all = [];
    const skinned = [];
    const roots = [];
    const bodyMeshes = this.bodyMeshesOf(entry);
    const boneCount = rig.list.length;

    for (const part of built.parts) {
      const material = Array.isArray(part.material) ? part.material : part.material;
      let mesh;
      if (part.bone) {
        const bone = rig.bones.get(part.bone);
        if (!bone) return { error: `Tulang "${part.bone}" tidak ditemukan.` };
        mesh = new THREE.Mesh(part.geometry, material);
        mesh.name = `${PREFIX}${instance.instanceId}_${part.name}`;
        mesh.userData.ucfModule = { instanceId: instance.instanceId, moduleId: module.moduleId, part: part.name };
        const holder = new THREE.Group();
        holder.name = `${PREFIX}holder_${instance.instanceId}_${part.name}`;
        holder.userData.ucfModule = mesh.userData.ucfModule;
        bone.add(holder);
        holder.add(mesh);
        roots.push(holder);
      } else if (part.static) {
        mesh = new THREE.Mesh(part.geometry, material);
        mesh.name = `${PREFIX}${instance.instanceId}_${part.name}`;
        mesh.userData.ucfModule = { instanceId: instance.instanceId, moduleId: module.moduleId, part: part.name };
        rig.root.add(mesh);
        roots.push(mesh);
      } else {
        const candidates = part.candidates || ['Hips'];
        const stats = skinGeometryForRig(part.geometry, candidates, rig);
        mesh = new THREE.SkinnedMesh(part.geometry, material);
        mesh.name = `${PREFIX}${instance.instanceId}_${part.name}`;
        mesh.userData.ucfModule = {
          instanceId: instance.instanceId,
          moduleId: module.moduleId,
          part: part.name,
          skin: stats
        };
        mesh.frustumCulled = false;
        mesh.bind(rig.skeleton, new THREE.Matrix4());
        rig.root.add(mesh);
        skinned.push(mesh);
        roots.push(mesh);
      }
      all.push(mesh);
    }

    rig.root.updateMatrixWorld(true);

    const materialTargets = [];
    if (built.materialSwap) {
      rig.root.traverse((object) => {
        if (!object.isMesh || object.name.startsWith(PREFIX)) return;
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (material?.name === built.materialSwap.target) materialTargets.push(material);
        }
      });
    }

    return {
      meshes: {
        all,
        skinned,
        roots,
        root: roots[0] || null,
        materialTargets: [...new Set(materialTargets)],
        materialNames: new Set(materials.map((material) => material.name)),
        clipCheck: built.clipCheck !== false
      },
      materialSwap: built.materialSwap || null,
      materialList: built.materialList || [],
      textureList: built.textureList || [],
      boneCount
    };
  }

  disposeInstance(entry, instance) {
    for (const mesh of instance.meshes || []) {
      const parent = mesh.parent;
      if (parent) parent.remove(mesh);
      mesh.geometry?.dispose?.();
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) material?.dispose?.();
    }
    for (const holder of instance.holders || []) {
      holder.parent?.remove(holder);
    }
    // pulihkan material badan yang sempat ditimpa
    if (instance.materialRestore) {
      for (const { material, color, roughness, metalness } of instance.materialRestore) {
        material.color.setHex(color);
        material.roughness = roughness;
        material.metalness = metalness;
      }
    }
    instance.meshes = [];
    instance.holders = [];
    instance.materialRestore = null;
    const rig = entry.content?.userData?.ucfRig;
    rig?.root?.updateMatrixWorld(true);
  }

  applyMaterialOverrides(entry, instance) {
    const overrides = instance.overrides || {};
    for (const mesh of instance.meshes || []) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material) continue;
        if (overrides.color) material.color.set(overrides.color);
        if (Number.isFinite(overrides.roughness)) material.roughness = overrides.roughness;
        if (Number.isFinite(overrides.metalness)) material.metalness = overrides.metalness;
      }
    }
    if (instance.materialSwap) {
      for (const material of instance.materialSwap.targets || []) {
        if (overrides.color) material.color.set(overrides.color);
        if (Number.isFinite(overrides.roughness)) material.roughness = overrides.roughness;
        if (Number.isFinite(overrides.metalness)) material.metalness = overrides.metalness;
      }
    }
  }

  applyTransform(instance) {
    const transform = instance.transform || { scale: 1, offset: [0, 0, 0] };
    for (const holder of instance.holders || []) {
      holder.scale.setScalar(Number(transform.scale) || 1);
      holder.position.set(
        Number(transform.offset?.[0]) || 0,
        Number(transform.offset?.[1]) || 0,
        Number(transform.offset?.[2]) || 0
      );
    }
  }

  /**
   * Pasang modul ke karakter.
   * @returns {{ok: boolean, instance: object|null, compat: object|null, error?: string}}
   */
  attach(entry, moduleId, payload = {}) {
    const module = this.library.get(moduleId);
    if (!module) return { ok: false, instance: null, compat: null, error: `Modul "${moduleId}" tidak ada di library.` };
    const state = this.stateOf(entry);

    if (module.attachmentType === 'base') {
      const existing = state.modules.find((instance) => instance.moduleId === BASE_MODULE_ID);
      return { ok: false, instance: existing || null, compat: existing?.compat || null, error: 'Base body selalu terpasang dan tidak dapat dipasang ulang.' };
    }

    // satu slot per kategori (kecuali aksesori)
    const replaced = [];
    if (SINGLE_SLOT.has(module.category)) {
      for (const instance of [...state.modules]) {
        if (instance.category === module.category && instance.moduleId !== moduleId) {
          this.detach(entry, instance.instanceId, { silent: true });
          replaced.push(instance.moduleId);
        } else if (instance.category === module.category && instance.moduleId === moduleId) {
          return { ok: false, instance, compat: instance.compat, error: `Modul "${module.moduleName}" sudah terpasang.` };
        }
      }
    } else if (module.category === 'accessories') {
      const duplicate = state.modules.find((instance) => instance.moduleId === moduleId);
      if (duplicate) return { ok: false, instance: duplicate, compat: duplicate.compat, error: `Aksesori "${module.moduleName}" sudah terpasang.` };
    }

    const instance = {
      instanceId: payload.instanceId || newId('ml', ++state.seq),
      moduleId,
      category: module.category,
      attachmentType: module.attachmentType,
      name: payload.name || module.moduleName,
      visible: payload.visible !== undefined ? Boolean(payload.visible) : true,
      overrides: {
        color: payload.overrides?.color || null,
        roughness: Number.isFinite(payload.overrides?.roughness) ? payload.overrides.roughness : null,
        metalness: Number.isFinite(payload.overrides?.metalness) ? payload.overrides.metalness : null
      },
      transform: {
        scale: Number(payload.transform?.scale) || 1,
        offset: Array.isArray(payload.transform?.offset) ? payload.transform.offset.map(Number) : [0, 0, 0]
      },
      module,
      meshes: [],
      holders: [],
      compat: null,
      materialSwap: null,
      materialRestore: null,
      permanent: false
    };

    const built = this.buildMeshes(entry, module, instance);
    if (built.error) return { ok: false, instance: null, compat: null, error: built.error };

    instance.meshes = built.meshes.all;
    instance.holders = built.meshes.roots;
    instance.clipCheck = built.meshes.clipCheck;

    if (built.materialSwap) {
      const restore = [];
      for (const material of built.meshes.materialTargets) {
        restore.push({ material, color: material.color.getHex(), roughness: material.roughness, metalness: material.metalness });
        material.color.set(built.materialSwap.color);
        material.roughness = built.materialSwap.roughness;
        material.metalness = built.materialSwap.metalness;
      }
      instance.materialSwap = { ...built.materialSwap, targets: built.meshes.materialTargets };
      instance.materialRestore = restore;
    }

    const compat = this.evaluate(entry, module, built);
    instance.compat = compat;

    if (compat.status === COMPAT_STATUS.INCOMPATIBLE) {
      this.disposeInstance(entry, instance);
      return {
        ok: false,
        instance: null,
        compat,
        error: `Modul ditolak: ${compat.errors.join(' ') || 'kompatibilitas gagal.'}`
      };
    }

    if (payload.overrides) instance.overrides = { ...instance.overrides, ...payload.overrides };
    if (payload.transform) instance.transform = { ...instance.transform, ...payload.transform };

    this.applyMaterialOverrides(entry, instance);
    this.applyTransform(instance);
    for (const mesh of instance.meshes) mesh.visible = instance.visible;

    state.modules.push(instance);
    this.refresh(entry);
    this.log?.({
      test: replaced.length ? 'Modul diganti' : 'Modul dipasang',
      module,
      instance,
      replaced
    });
    return { ok: true, instance, compat, replaced };
  }

  evaluate(entry, module, built) {
    const rig = entry.content.userData.ucfRig;
    const bodyMeshes = this.bodyMeshesOf(entry);
    if (module.attachmentType === 'base') {
      return {
        status: COMPAT_STATUS.VALID,
        checks: [
          { id: 'metadata', label: 'Metadata 19 field', status: 'PASS', detail: 'Modul dasar dibuat builder UCF.', measured: {} },
          { id: 'skeleton', label: 'Skeleton target', status: 'PASS', detail: `Base body adalah sumber rig ${SKELETON_ID}.`, measured: {} },
          { id: 'base', label: 'Base body', status: 'PASS', detail: 'Selalu terpasang; tidak dapat dilepas.', measured: {} }
        ],
        warnings: [],
        errors: [],
        measured: { bones: rig.list.length }
      };
    }
    return checkModuleCompatibility({
      module,
      rig,
      meshes: built.meshes,
      bodyMeshes,
      options: { staticAnchor: true }
    });
  }

  detach(entry, instanceId, { silent = false } = {}) {
    const state = this.stateOf(entry);
    const index = state.modules.findIndex((instance) => instance.instanceId === instanceId);
    if (index < 0) return { ok: false, error: 'Modul tidak terpasang.' };
    const instance = state.modules[index];
    if (instance.permanent || instance.moduleId === BASE_MODULE_ID) {
      return { ok: false, error: 'Base body selalu terpasang dan tidak dapat dilepas.' };
    }
    this.disposeInstance(entry, instance);
    state.modules.splice(index, 1);
    this.refresh(entry);
    if (!silent) this.log?.({ test: 'Modul dilepas', instance });
    return { ok: true, instance };
  }

  setVisible(entry, instanceId, visible) {
    const instance = this.attached(entry).find((item) => item.instanceId === instanceId);
    if (!instance) return false;
    instance.visible = Boolean(visible);
    for (const mesh of instance.meshes) mesh.visible = instance.visible;
    this.refresh(entry);
    return true;
  }

  rename(entry, instanceId, name) {
    const instance = this.attached(entry).find((item) => item.instanceId === instanceId);
    if (!instance) return false;
    const clean = String(name || '').trim().slice(0, 48);
    if (!clean) return false;
    instance.name = clean;
    this.refresh(entry);
    return true;
  }

  setMaterial(entry, instanceId, { color = null, roughness = null, metalness = null } = {}) {
    const instance = this.attached(entry).find((item) => item.instanceId === instanceId);
    if (!instance) return false;
    if (color) instance.overrides.color = color;
    if (Number.isFinite(roughness)) instance.overrides.roughness = roughness;
    if (Number.isFinite(metalness)) instance.overrides.metalness = metalness;
    this.applyMaterialOverrides(entry, instance);
    this.refresh(entry);
    return true;
  }

  setTransform(entry, instanceId, { scale = null, offset = null } = {}) {
    const instance = this.attached(entry).find((item) => item.instanceId === instanceId);
    if (!instance) return false;
    if (!['bone', 'static'].includes(instance.attachmentType)) {
      return false;
    }
    if (Number.isFinite(scale)) instance.transform.scale = Math.min(1.5, Math.max(0.6, scale));
    if (Array.isArray(offset)) instance.transform.offset = offset.map((value) => Math.min(0.3, Math.max(-0.3, Number(value) || 0)));
    this.applyTransform(instance);
    this.refresh(entry);
    return true;
  }

  replace(entry, instanceId, nextModuleId = null) {
    const instance = this.attached(entry).find((item) => item.instanceId === instanceId);
    if (!instance) return { ok: false, error: 'Modul tidak terpasang.' };
    if (instance.permanent) return { ok: false, error: 'Base body tidak dapat diganti.' };
    let next = nextModuleId ? this.library.get(nextModuleId) : null;
    if (!next) {
      const candidates = [...this.library.values()].filter((module) => module.category === instance.category && module.moduleId !== instance.moduleId);
      next = candidates[0] || null;
    }
    if (!next) return { ok: false, error: `Tidak ada modul lain di kategori ${instance.category}.` };

    const result = this.attach(entry, next.moduleId, {
      name: next.moduleName,
      visible: instance.visible,
      overrides: instance.overrides,
      transform: instance.transform
    });
    if (!result.ok) return result;
    this.detach(entry, instanceId, { silent: true });
    return result;
  }

  removeFromLibrary(moduleId) {
    const module = this.library.get(moduleId);
    if (!module) return { ok: false, error: 'Modul tidak ada.' };
    if (!module.imported) return { ok: false, error: 'Modul bawaan tidak dapat dihapus dari library.' };
    for (const [modelId, state] of this.states) {
      for (const instance of [...state.modules]) {
        if (instance.moduleId === moduleId) {
          const entry = { modelId, content: null };
          // pemanggil bertanggung jawab melepas; di sini hanya cegah modul hilang diam-diam
          return { ok: false, error: `Modul masih terpasang pada karakter ${modelId}; lepaskan dulu.` };
        }
      }
    }
    this.library.delete(moduleId);
    return { ok: true };
  }

  /* ---------------- impor manifest ---------------- */

  importManifest(entry, text) {
    let raw;
    try {
      raw = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (error) {
      return { ok: false, errors: [`JSON tidak valid: ${error.message}`], warnings: [] };
    }

    const result = validateModuleManifest({ ...raw, imported: true });
    if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };

    const module = { ...result.module, validationStatus: VALIDATION_STATUS.NEEDS, imported: true };
    if (module.attachmentType !== 'base' && !generatorIds().includes(module.generator)) {
      return {
        ok: false,
        errors: [`Generator "${module.generator}" tidak didukung. Hanya manifest yang menunjuk generator prosedural UCF dapat dipasang.`],
        warnings: result.warnings
      };
    }
    if (this.library.has(module.moduleId) && !this.library.get(module.moduleId).imported) {
      return { ok: false, errors: [`moduleId "${module.moduleId}" bentrok dengan modul bawaan.`], warnings: result.warnings };
    }

    this.library.set(module.moduleId, module);
    const attachResult = entry ? this.attach(entry, module.moduleId, {}) : null;
    return { ok: true, module, warnings: result.warnings, attach: attachResult };
  }

  /* ---------------- rebuild & konfigurasi ---------------- */

  reattachAll(entry) {
    const state = this.states.get(entry.modelId);
    if (!state || !state.modules.length) return { restored: 0, failed: 0 };
    const wanted = state.modules
      .filter((instance) => instance.moduleId !== BASE_MODULE_ID)
      .map((instance) => ({
        moduleId: instance.moduleId,
        instanceId: instance.instanceId,
        name: instance.name,
        visible: instance.visible,
        overrides: { ...instance.overrides },
        transform: { scale: instance.transform.scale, offset: [...instance.transform.offset] }
      }));
    state.modules = [];
    let restored = 0;
    let failed = 0;
    for (const item of wanted) {
      const result = this.attach(entry, item.moduleId, { ...item, silent: true });
      if (result.ok) restored += 1;
      else failed += 1;
    }
    this.refresh(entry);
    return { restored, failed };
  }

  serialize(entry) {
    const state = this.states.get(entry.modelId);
    if (!state) return { modules: [] };
    return {
      modules: state.modules
        .filter((instance) => instance.moduleId !== BASE_MODULE_ID)
        .map((instance) => ({
          instanceId: instance.instanceId,
          moduleId: instance.moduleId,
          name: instance.name,
          category: instance.category,
          attachmentType: instance.attachmentType,
          visible: instance.visible,
          material: { ...instance.overrides },
          transform: { scale: instance.transform.scale, offset: [...instance.transform.offset] },
          validationStatus: instance.compat?.status || VALIDATION_STATUS.UNKNOWN,
          metadata: {
            sourceFile: instance.module.sourceFile,
            sourceFormat: instance.module.sourceFormat,
            sourceLicense: instance.module.sourceLicense,
            attachmentPoint: instance.module.attachmentPoint,
            bodyRegion: instance.module.bodyRegion,
            supportedSkeleton: instance.module.supportedSkeleton
          },
          manifest: instance.module.imported ? { ...instance.module } : null
        }))
    };
  }

  restore(entry, items = []) {
    const warnings = [];
    let restored = 0;
    if (!Array.isArray(items)) return { restored, warnings };
    for (const item of items) {
      if (!item || typeof item.moduleId !== 'string') {
        warnings.push('Entri modul tanpa moduleId dilewati.');
        continue;
      }
      if (!this.library.has(item.moduleId) && item.manifest) {
        const result = this.importManifest(null, item.manifest);
        if (!result.ok) {
          warnings.push(`Modul "${item.moduleId}" gagal dipulihkan: ${result.errors.join(' ')}`);
          continue;
        }
      }
      if (!this.library.has(item.moduleId)) {
        warnings.push(`Modul "${item.moduleId}" tidak ada di library dan tidak membawa manifest.`);
        continue;
      }
      const result = this.attach(entry, item.moduleId, {
        instanceId: item.instanceId,
        name: item.name,
        visible: item.visible,
        overrides: item.material || {},
        transform: item.transform || {},
        silent: true
      });
      if (result.ok) restored += 1;
      else warnings.push(`Modul "${item.moduleId}" gagal dipasang: ${result.error}`);
    }
    return { restored, warnings };
  }

  clear(entry) {
    const state = this.states.get(entry.modelId);
    if (!state) return;
    this.states.delete(entry.modelId);
  }

  refresh(entry) {
    if (!entry?.content) return;
    entry.content.updateMatrixWorld(true);
    this.onChange?.(entry);
  }

  /* ---------------- thumbnail ---------------- */

  /** Thumbnail hanya dari cache; render dilakukan saat pengguna menekan "Pratinjau". */
  thumbnail(module) {
    return this.thumbnailCache.get(module.moduleId) || null;
  }

  renderThumbnail(module, entry, size = 96) {
    const rig = entry.content?.userData?.ucfRig;
    if (!rig) return null;
    const s = entry.params.height / NOMINAL_HEIGHT;
    const built = runGenerator(module.generator, { params: entry.params, s, rig, options: module.options });
    if (!built || !built.parts.length) return null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1220');
    const group = new THREE.Group();
    for (const part of built.parts) {
      const geometry = part.geometry.clone();
      if (part.bone) {
        const bone = rig.bones.get(part.bone);
        const world = bone ? rig.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3();
        geometry.translate(world.x, world.y, world.z);
      }
      const mesh = new THREE.Mesh(geometry, part.material);
      group.add(mesh);
    }
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(1.5, 2, 2);
    scene.add(light);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size3 = box.getSize(new THREE.Vector3());
    const radius = Math.max(size3.x, size3.y, size3.z) || 0.5;

    if (!this.thumbnailRenderer) {
      this.thumbnailRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      this.thumbnailRenderer.setSize(size, size);
    }
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(center.x + radius * 1.2, center.y + radius * 0.8, center.z + radius * 1.8);
    camera.lookAt(center);
    this.thumbnailRenderer.render(scene, camera);
    const url = this.thumbnailRenderer.domElement.toDataURL('image/png');

    for (const part of built.parts) part.geometry.dispose();
    for (const part of built.parts) {
      const list = Array.isArray(part.material) ? part.material : [part.material];
      for (const material of list) material?.dispose?.();
    }
    return url;
  }
}

export { MODULE_CATEGORIES, BODY_PROFILE_ID, SKELETON_ID };
