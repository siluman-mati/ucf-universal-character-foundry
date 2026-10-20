/**
 * UCF Tahap 5 — pemutar animasi (native, model impor, hasil retarget).
 *
 * Menyimpan satu mixer aktif, mendukung play/pause/stop/reset/loop/kecepatan/seek,
 * serta evaluasi deterministik (`evaluateAt`) supaya pengujian tidak bergantung pada
 * kecepatan render. Reset mengembalikan pose yang tersimpan sebelum klip dimuat.
 */
import * as THREE from 'three';
import { buildNativeClip, buildNativeClips, NATIVE_CLIPS } from './clips.js';
import { analyzeSkeleton } from './skeleton.js';
import { buildBoneMapping, validateMapping } from './mapping.js';
import { retargetClip, verifyRetarget, captureRest, groundClip } from './retarget.js';
import { evaluateAnimation } from './measure.js';

export class AnimationPlayer {
  constructor({ viewport = null, getEntry = () => null, status = null, onChange = null } = {}) {
    this.viewport = viewport;
    this.getEntry = getEntry;
    this.status = status;
    this.onChange = onChange;

    this.mixer = null;
    this.action = null;
    this.target = null;          // { kind: 'rig'|'model', root, entry?, model? }
    this.clip = null;
    this.state = {
      kind: null,
      id: null,
      name: '—',
      duration: 0,
      time: 0,
      playing: false,
      loop: true,
      speed: 1,
      source: '—',
      retargeted: false
    };
    this.nativeCache = new Map();   // entry.id -> { rig, clips, byId }
    this.retargetCache = new Map(); // `${modelId}:${clip}` -> { clip, mapping, report, analysis }
    this.prePose = null;
    this.lastMapping = null;
    this.lastVerify = null;
    this.lastEvaluation = null;

    this.unsubscribe = viewport?.addFrameListener?.((delta) => this.update(delta)) || null;
  }

  /* ---------------- daftar klip ---------------- */

  nativeClips(entry = this.getEntry()) {
    if (!entry?.content) return [];
    const rig = entry.content.userData?.ucfRig;
    if (!rig) return [];
    const cached = this.nativeCache.get(entry.id);
    if (cached && cached.rig === rig) return cached.list;
    const built = buildNativeClips(rig);
    const list = built.map((item) => ({
      kind: 'native',
      id: item.id,
      name: item.name,
      duration: item.clip.duration,
      loop: item.loop,
      grounded: item.ground,
      description: item.description,
      clip: item.clip,
      meta: item.meta
    }));
    this.nativeCache.set(entry.id, { rig, list, byId: new Map(list.map((item) => [item.id, item])) });
    return list;
  }

  importedModels() {
    if (!this.viewport) return [];
    return this.viewport.models
      .filter((model) => Array.isArray(model.clips) && model.clips.length > 0)
      .map((model) => ({
        modelId: model.id,
        name: model.name,
        clips: model.clips.map((clip) => ({
          kind: 'model',
          id: clip.name,
          name: clip.name,
          duration: clip.duration,
          loop: true,
          clip
        }))
      }));
  }

  listClips(entry = this.getEntry()) {
    return [...this.nativeClips(entry), ...this.importedModels().flatMap((model) => model.clips.map((clip) => ({ ...clip, modelId: model.modelId, modelName: model.name })))];
  }

  /* ---------------- kontrol ---------------- */

  ensureMixer(root) {
    if (!root) return null;
    if (this.mixer && this.target?.root === root) return this.mixer;
    this.disposeMixer();
    this.mixer = new THREE.AnimationMixer(root);
    this.target = { root };
    return this.mixer;
  }

  disposeMixer() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.target?.root) this.mixer.uncacheRoot(this.target.root);
    }
    this.mixer = null;
    this.action = null;
    this.target = null;
  }

  load({ kind = 'native', id, modelId = null } = {}) {
    const entry = this.getEntry();
    if (kind === 'native' || kind === 'retarget') {
      const rig = entry?.content?.userData?.ucfRig;
      if (!rig) return { ok: false, error: 'Belum ada karakter UCF yang dipilih.' };
      let clip = null;
      let meta = null;
      if (kind === 'native') {
        const cached = this.nativeClips(entry).find((item) => item.id === id);
        if (!cached) return { ok: false, error: `Klip native "${id}" tidak ada.` };
        clip = cached.clip;
        meta = cached.meta;
      } else {
        const cached = this.retargetCache.get(`${modelId}:${id}`);
        if (!cached) return { ok: false, error: 'Klip hasil retarget belum dibuat.' };
        clip = cached.clip;
        meta = { retargeted: true, ...cached.report };
      }
      if (rig.restPose) {
        // selalu kembali ke bind pose karakter, walau klip dimuat saat tubuh sedang berpose
        this.prePose = { kind: 'rig', rig, bones: rig.restPose, canonical: true };
      } else if (this.target?.kind === 'rig' && this.target.entry?.id === entry.id && this.prePose) {
        // pose sebelumnya dipertahankan sebagai target reset
      } else {
        this.prePose = this.captureRigPose(rig);
      }
      this.ensureMixer(rig.root);
      this.target = { kind: 'rig', root: rig.root, entry, rig };
      this.applyClip(clip, {
        name: kind === 'retarget' ? `${id} (retarget → UCF)` : clip.name,
        source: kind === 'retarget' ? `retarget ${modelId}` : 'UCF native',
        loop: clip.userData?.loop ?? true,
        meta
      });
      return { ok: true, clip, meta };
    }

    // klip milik model impor (native playback pada model itu sendiri)
    const model = this.viewport?.modelById(modelId);
    if (!model) return { ok: false, error: 'Model tidak ditemukan.' };
    const clip = (model.clips || []).find((item) => item.name === id);
    if (!clip) return { ok: false, error: `Klip "${id}" tidak ada pada model.` };
    this.ensureMixer(model.root);
    this.target = { kind: 'model', root: model.root, model };
    this.prePose = this.captureModelPose(model);
    this.applyClip(clip, { name: `${clip.name} · ${model.name}`, source: model.name, loop: true, meta: { native: true, modelNative: true } });
    return { ok: true, clip, meta: null };
  }

  applyClip(clip, { name, source, loop, meta = null } = {}) {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.clip = clip;
    this.action = this.mixer.clipAction(clip);
    this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    this.action.clampWhenFinished = !loop;
    this.action.reset();
    this.action.play();
    this.state = {
      kind: this.target?.kind || null,
      id: clip.name,
      name: name || clip.name,
      duration: Number(clip.duration.toFixed(3)),
      time: 0,
      playing: false,
      loop: Boolean(loop),
      speed: this.state.speed || 1,
      source,
      retargeted: Boolean(meta?.retargeted),
      meta
    };
    this.mixer.setTime(0);
    this.target?.root.updateMatrixWorld(true);
    this.onChange?.(this.state);
  }

  play() {
    if (!this.action) return false;
    if (!this.state.loop && this.state.time >= this.state.duration - 1e-4) this.seek(0);
    this.action.paused = false;
    this.state.playing = true;
    this.onChange?.(this.state);
    return true;
  }

  pause() {
    if (!this.action) return false;
    this.action.paused = true;
    this.state.playing = false;
    this.onChange?.(this.state);
    return true;
  }

  stop() {
    if (!this.action) return false;
    this.seek(0);
    this.pause();
    return true;
  }

  setSpeed(speed) {
    const value = Math.min(4, Math.max(0.1, Number(speed) || 1));
    this.state.speed = value;
    if (this.action) this.action.timeScale = 1; // kecepatan diterapkan lewat update()
    this.onChange?.(this.state);
    return value;
  }

  setLoop(loop) {
    this.state.loop = Boolean(loop);
    if (this.action) {
      this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      this.action.clampWhenFinished = !loop;
    }
    this.onChange?.(this.state);
    return this.state.loop;
  }

  seek(time) {
    if (!this.mixer || !this.clip) return false;
    const value = Math.min(this.state.duration, Math.max(0, Number(time) || 0));
    this.state.time = value;
    this.mixer.setTime(value);
    this.target?.root.updateMatrixWorld(true);
    this.onChange?.(this.state);
    return true;
  }

  /** Evaluasi deterministik tanpa menunggu render. */
  evaluateAt(time) {
    return this.seek(time);
  }

  update(delta) {
    if (!this.state.playing || !this.mixer || !this.clip) return;
    const dt = Math.max(0, Math.min(0.1, delta || 0)) * (this.state.speed || 1);
    let next = this.state.time + dt;
    if (this.state.loop) {
      if (next >= this.state.duration) next %= this.state.duration;
    } else if (next >= this.state.duration) {
      next = this.state.duration;
      this.state.playing = false;
      this.action.paused = true;
    }
    this.state.time = next;
    this.mixer.setTime(next);
    this.target?.root.updateMatrixWorld(true);
    this.onChange?.(this.state);
  }

  /* ---------------- pose ---------------- */

  captureRigPose(rig) {
    return {
      kind: 'rig',
      rig,
      bones: rig.list.map((bone) => ({ bone, quat: bone.quaternion.clone(), pos: bone.position.clone() })),
      canonical: Boolean(rig.restPose)
    };
  }

  captureModelPose(model) {
    const nodes = [];
    model.root.traverse((object) => {
      if (object.isBone || object.isMesh || object.isObject3D) nodes.push({ object, quat: object.quaternion.clone(), pos: object.position.clone() });
    });
    return { kind: 'model', model, nodes };
  }

  restorePose(pose = this.prePose) {
    if (!pose) return false;
    if (pose.kind === 'rig') {
      for (const item of pose.bones) {
        item.bone.quaternion.copy(item.quat);
        item.bone.position.copy(item.pos);
      }
      pose.rig.root.updateMatrixWorld(true);
    } else {
      for (const item of pose.nodes) {
        item.object.quaternion.copy(item.quat);
        item.object.position.copy(item.pos);
      }
      pose.model.root.updateMatrixWorld(true);
    }
    return true;
  }

  reset() {
    this.disposeMixer();
    this.restorePose();
    this.clip = null;
    this.state = {
      ...this.state,
      kind: null,
      id: null,
      name: '—',
      duration: 0,
      time: 0,
      playing: false,
      retargeted: false
    };
    this.onChange?.(this.state);
    return true;
  }

  /* ---------------- retargeting ---------------- */

  analyzeModel(model) {
    if (!model) return null;
    const skeleton = (() => {
      let found = null;
      model.root.traverse((object) => { if (!found && object.isSkinnedMesh && object.skeleton) found = object.skeleton; });
      return found;
    })();
    const rest = model.userData?.ucfRestPose || null;
    if (rest) {
      for (const item of rest) {
        item.object.quaternion.copy(item.quat);
        item.object.position.copy(item.pos);
      }
      model.root.updateMatrixWorld(true);
    }
    return { skeleton, analysis: analyzeSkeleton(model.root, { skeleton }) };
  }

  /** Analisis skeleton target pada BIND POSE, lalu kembalikan pose yang tadi tampil. */
  analyzeRig(rig) {
    if (!rig) return null;
    const saved = rig.list.map((item) => ({ bone: item, quat: item.quaternion.clone(), pos: item.position.clone() }));
    if (rig.restPose) {
      for (const item of rig.restPose) {
        item.bone.quaternion.copy(item.quat);
        item.bone.position.copy(item.pos);
      }
    }
    rig.root.updateMatrixWorld(true);
    const analysis = analyzeSkeleton(rig.root, { skeleton: rig.skeleton });
    for (const item of saved) {
      item.bone.quaternion.copy(item.quat);
      item.bone.position.copy(item.pos);
    }
    rig.root.updateMatrixWorld(true);
    return analysis;
  }

  buildMapping(modelId, entry = this.getEntry()) {
    const model = this.viewport?.modelById(modelId);
    const rig = entry?.content?.userData?.ucfRig;
    if (!model || !rig) return { ok: false, error: 'Model sumber atau karakter UCF tidak tersedia.' };
    const source = this.analyzeModel(model);
    const target = { analysis: this.analyzeRig(rig) };
    if (!source?.analysis || !target.analysis) return { ok: false, error: 'Skeleton tidak terbaca.' };
    const mapping = buildBoneMapping(source.analysis, target.analysis, {
      sourceLabel: model.name,
      targetLabel: entry.name
    });
    mapping.checks = validateMapping(mapping);
    this.lastMapping = { modelId, model, source, target, mapping };
    this.onChange?.(this.state);
    return { ok: mapping.ok, mapping, source, target };
  }

  retarget(modelId, clipName, entry = this.getEntry()) {
    const model = this.viewport?.modelById(modelId);
    const rig = entry?.content?.userData?.ucfRig;
    if (!model || !rig) return { ok: false, error: 'Model sumber atau karakter UCF tidak tersedia.' };
    const built = this.buildMapping(modelId, entry);
    if (!built.ok) return { ok: false, error: 'Peta tulang belum valid.', mapping: built.mapping };
    const clip = (model.clips || []).find((item) => item.name === clipName);
    if (!clip) return { ok: false, error: `Klip "${clipName}" tidak ada pada ${model.name}.` };
    const { clip: retargeted, report } = retargetClip({
      clip,
      sourceRoot: model.root,
      sourceAnalysis: built.source.analysis,
      targetRig: rig,
      targetAnalysis: built.target.analysis,
      mapping: built.mapping,
      options: { fps: 30, rootMotion: 'in-place' }
    });
    const grounded = groundClip({ rig, clip: retargeted, mode: 'auto' });
    const finalClip = grounded.clip;
    const verify = verifyRetarget({
      clip: finalClip,
      sourceClip: clip,
      sourceRoot: model.root,
      sourceAnalysis: built.source.analysis,
      targetRoot: rig.root,
      targetAnalysis: built.target.analysis,
      mapping: built.mapping,
      samples: 16
    });
    this.retargetCache.set(`${modelId}:${clipName}`, {
      clip: finalClip,
      mapping: built.mapping,
      report: { ...report, ground: grounded.report },
      verify,
      analysis: built.source.analysis
    });
    this.lastVerify = { modelId, clipName, ...verify };
    this.onChange?.(this.state);
    return { ok: true, clip: finalClip, mapping: built.mapping, report: { ...report, ground: grounded.report }, verify };
  }

  retargetedClips() {
    return [...this.retargetCache.entries()].map(([key, value]) => {
      const [modelId, clipName] = key.split(':');
      return { modelId, clipName, duration: value.clip.duration, mapping: value.mapping, report: value.report, verify: value.verify };
    });
  }

  /* ---------------- evaluasi ---------------- */

  evaluate({ modular = false } = {}) {
    const entry = this.getEntry();
    const rig = entry?.content?.userData?.ucfRig;
    if (!rig || !this.clip || this.target?.kind !== 'rig') return { ok: false, error: 'Muat klip pada karakter UCF terlebih dahulu.' };
    const result = evaluateAnimation(rig, this.clip, { modular });
    this.lastEvaluation = result;
    return { ok: true, ...result };
  }

  dispose() {
    this.disposeMixer();
    this.unsubscribe?.();
  }

  destroyEntry(entryId) {
    this.nativeCache.delete(entryId);
    // retarget cache tidak terikat entry; biarkan (klip netral terhadap rig)
  }
}

export { NATIVE_CLIPS, buildNativeClip, captureRest };
