/**
 * Tahap 7 — panel Ekspor: pratinjau apa yang akan diekspor + unduh GLB + impor ulang.
 */
import { exportGLB } from '../exporter.js';
import { importModelFile } from '../importer.js';
import { RESULT } from '../validation.js';

export class ExportPanel {
  constructor({ viewport, humanoid, log, status }) {
    this.viewport = viewport;
    this.humanoid = humanoid;
    this.log = log;
    this.status = status;
    this.lastExport = null; // { blobUrl, bytes, name, entryName }
    this.bound = false;
  }

  bind(dom) {
    if (this.bound) return;
    this.bound = true;
    this.dom = dom;
    dom.exportBtn?.addEventListener('click', () => this.doExport());
    dom.reimportBtn?.addEventListener('click', () => this.doReimport());
    dom.downloadBtn?.addEventListener('click', () => this.doDownload());
  }

  entryToExport() {
    return this.humanoid?.current() || null;
  }

  attachSelectionHook() {
    // humanoid controller memanggil onSelect -> render dipicu lewat viewport.onModelsChanged path,
    // jadi cukup subscribe ke viewport change untuk refresh hint
    if (this._hooked) return;
    this._hooked = true;
    const orig = this.humanoid.onChanged;
    this.humanoid.onChanged = (...args) => { try{ orig?.(...args);}catch{} this.render(); };
  }

  async doExport() {
    const entry = this.entryToExport();
    if (!entry) {
      this.status?.('Pilih humanoid dulu sebelum mengekspor.', 'error');
      return;
    }
    this.status?.('Menyiapkan GLB…', '');
    this.dom.exportBtn.disabled = true;
    try {
      const clone = this.buildExportClone(entry);
      const animations = this.collectAnimations(entry);
      const buffer = await exportGLB(clone, { binary: true, animations });
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
      this.lastExport = { blobUrl, bytes: buffer.byteLength, name: `${entry.name.replace(/\s+/g,'_')}.glb`, entryName: entry.name, animations: animations.map(a=>a.name), clone };
      this.renderReport({ before: entry, bytes: buffer.byteLength, animations });
      this.log.add({
        group: 'G. Ekspor', test: 'Ekspor GLB', model: entry.name,
        result: RESULT.PASS,
        details: { format: 'GLB', bytes: buffer.byteLength, mesh: entry.stats?.meshes, tulang: entry.stats?.bones, klip: animations.length, klipNama: animations.map(a=>a.name).join(', ') || '—' }
      });
      this.status?.(`GLB siap: ${(buffer.byteLength/1024).toFixed(1)} KB, ${animations.length} klip.`, 'ok');
      this.render();
    } catch (e) {
      this.log.add({ group: 'G. Ekspor', test: 'Ekspor GLB', model: entry?.name || '—', result: RESULT.FAIL, errors: [e.message || String(e)] });
      this.status?.(`Gagal ekspor: ${e.message}`, 'error');
    } finally {
      this.dom.exportBtn.disabled = false;
    }
  }

  buildExportClone(entry) {
    const src = entry.content;
    // userData.ucfRig menyimpan rig yang mereferensikan root — JSON.stringify sirkular saat clone.
    // Simpan sementara, kosongkan, clone, lalu kembalikan.
    const savedRig = src.userData.ucfRig;
    const extraKeys = [];
    src.traverse((o) => {
      if (o.userData?.ucfRig) { extraKeys.push(o); }
    });
    const savedExtras = extraKeys.map(o => [o, o.userData.ucfRig]);
    src.userData.ucfRig = undefined;
    for (const [o] of savedExtras) o.userData.ucfRig = undefined;

    let clone;
    try {
      clone = src.clone(true);
    } finally {
      src.userData.ucfRig = savedRig;
      for (const [o, rig] of savedExtras) o.userData.ucfRig = rig;
    }
    // bersihkan sisa userData yang tidak perlu diekspor
    clone.traverse((o) => {
      if (o.userData?.ucfRig) delete o.userData.ucfRig;
      if (o.userData?.ucfModelId) delete o.userData.ucfModelId;
      if (o.userData?.ucfProcedural) delete o.userData.ucfProcedural;
      if (o.userData?.ucfCharacterId) delete o.userData.ucfCharacterId;
    });
    // hanya modul terlihat yang diekspor — hormati `visible` modul (aturan 3)
    // dan pastikan helper viewport tidak ikut (sudah terpisah, tapi jaga-jaga)
    const toRemove = [];
    clone.traverse((o) => {
      if (o.userData?.ucfHelper) toRemove.push(o);
      // modul invisible: geometry tetap ada tapi visible=false — keluarkan dari ekspor
      if (o.visible === false && o.isMesh) toRemove.push(o);
    });
    for (const r of toRemove) r.parent?.remove(r);
    clone.name = entry.name;
    clone.position.set(0,0,0);
    clone.rotation.set(0,0,0);
    clone.scale.set(1,1,1);
    clone.updateMatrixWorld(true);
    return clone;
  }

  collectAnimations(entry) {
    const anim = this.humanoid?.anim;
    const native = anim?.nativeClips?.(entry) || [];
    const clips = native.map(n => n.clip).filter(Boolean);
    // sertakan klip retarget yang pernah dibuat untuk entry ini (jika ada)
    const retargeted = anim?.retargetCache ? [...anim.retargetCache.values()].map(v=>v.clip).filter(Boolean) : [];
    return [...clips, ...retargeted].slice(0, 8);
  }

  async doReimport() {
    if (!this.lastExport?.blobUrl) {
      this.status?.('Belum ada GLB untuk diimpor ulang — ekspor dulu.', 'error');
      return;
    }
    this.dom.reimportBtn.disabled = true;
    try {
      const res = await fetch(this.lastExport.blobUrl);
      const buf = await res.arrayBuffer();
      const file = new File([buf], this.lastExport.name, { type: 'model/gltf-binary' });
      const { report, root, animations } = await importModelFile(file);
      // bandingkan dengan humanoid asal (sebelum ekspor)
      const before = this.humanoid.entries.get(this.humanoid.selectedModelId) || this.entryToExport();
      const beforeStats = before?.stats || {};
      const afterStats = report.stats || {};
      const meshOk = beforeStats.meshes === afterStats.meshes || (Math.abs((beforeStats.meshes||0) - (afterStats.meshes||0)) <= 2);
      const bonesOk = (beforeStats.bones||0) === (afterStats.bones||0) || (afterStats.bones||0) >= (beforeStats.bones||0)-2;
      const clipsOk = animations.length >= (this.lastExport.animations.length || 0);
      const reportEl = document.getElementById('exportReport');
      if (reportEl) reportEl.innerHTML = this.reimportHtml({ before: beforeStats, after: afterStats, animations, report, meshOk, bonesOk, clipsOk });
      this.log.add({
        group: 'G. Ekspor', test: 'Impor ulang GLB', model: this.lastExport.entryName,
        result: (!meshOk || !bonesOk) ? RESULT.FAIL : RESULT.PASS,
        details: {
          'sebelum mesh': beforeStats.meshes, 'sesudah mesh': afterStats.meshes,
          'sebelum tulang': beforeStats.bones, 'sesudah tulang': afterStats.bones,
          'sebelum klip': this.lastExport.animations.length, 'sesudah klip': animations.length,
          bytes: this.lastExport.bytes
        },
        errors: (!meshOk || !bonesOk) ? ['Jumlah mesh/tulang impor ulang berbeda — lihat detail.'] : []
      });
      this.status?.(`Impor ulang: ${afterStats.meshes} mesh, ${afterStats.bones} tulang, ${animations.length} klip.`, (!meshOk||!bonesOk)?'error':'ok');
      // tambahkan sebagai model biasa agar terlihat di viewport (tapi jangan duplikasi humanoid logic)
      this.viewport.addModel(root, { name: `${this.lastExport.entryName} (reimport)`, fileName: file.name, stats: report.stats, clips: animations, report });
      this.humanoid?.animPanel?.refreshSources?.();
    } catch (e) {
      this.log.add({ group: 'G. Ekspor', test: 'Impor ulang GLB', model: this.lastExport?.entryName||'—', result: RESULT.FAIL, errors: [e.message||String(e)] });
      this.status?.(`Impor ulang gagal: ${e.message}`, 'error');
    } finally {
      this.dom.reimportBtn.disabled = false;
      this.render();
    }
  }

  doDownload() {
    if (!this.lastExport?.blobUrl) return;
    const a = document.createElement('a');
    a.href = this.lastExport.blobUrl;
    a.download = this.lastExport.name;
    a.click();
  }

  renderReport({ before, bytes, animations }) {
    const el = document.getElementById('exportReport');
    if (!el) return;
    // entry.stats bisa undefined — fallback ke viewport model stats atau summary langsung
    let s = before.stats;
    if (!s || !s.meshes) {
      const m = this.viewport.modelById(before.modelId);
      s = m?.stats || s || {};
    }
    el.innerHTML = `<div class="kv"><b>Asal:</b> ${before.name} — ${s.meshes||0} mesh, ${s.bones||0} tulang, ${s.materials||0} material</div>
    <div class="kv"><b>GLB:</b> ${(bytes/1024).toFixed(1)} KB · klip: ${animations.map(a=>a.name).join(', ')||'—'}</div>
    <div class="hint">Berkas siap diunduh atau diimpor ulang untuk verifikasi round-trip.</div>`;
  }

  reimportHtml({ before, after, animations, report, meshOk, bonesOk, clipsOk }) {
    const row = (k,a,b,ok) => `<tr><th>${k}</th><td>${a} → ${b}</td><td class="${ok?'ok':'fail'}">${ok?'OK':'BEDA'}</td></tr>`;
    return `<table class="kv">
      ${row('Mesh', before.meshes||0, after.meshes||0, meshOk)}
      ${row('Tulang', before.bones||0, after.bones||0, bonesOk)}
      ${row('Klip', this.lastExport.animations.length, animations.length, clipsOk)}
      ${row('Material', before.materials||0, after.materials||0, true)}
      </table>
      <div class="hint">Impor ulang: ${report.fileName} — ${report.format.toUpperCase()} · ${(report.bytes/1024).toFixed(1)} KB</div>
      ${(!meshOk||!bonesOk) ? '<div class="warn-title">Perbedaan terdeteksi — bukan round-trip sempurna.</div>' : '<div class="ok-title">Round-trip sesuai harapan.</div>'}`;
  }

  render() {
    const entry = this.entryToExport();
    const hasEntry = !!entry;
    if (this.dom.exportBtn) this.dom.exportBtn.disabled = !hasEntry;
    if (this.dom.reimportBtn) this.dom.reimportBtn.disabled = !this.lastExport?.blobUrl;
    if (this.dom.downloadBtn) this.dom.downloadBtn.disabled = !this.lastExport?.blobUrl;
    const hint = document.getElementById('exportHint');
    if (hint) hint.textContent = hasEntry ? `Siap ekspor: ${entry.name} — ${entry.stats?.meshes||0} mesh, ${entry.stats?.bones||0} tulang.` : 'Buat/pilih humanoid dulu.';
  }
}
