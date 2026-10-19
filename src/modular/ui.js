/**
 * UCF Tahap 4 — panel UI sistem modular (seksi 7).
 * Semua tombol di sini memanggil operasi nyata pada ModularManager.
 */
import { MODULE_CATEGORIES, VALIDATION_STATUS, categoryLabel, attachmentLabel } from './metadata.js';
import { BASE_MODULE_ID } from './manager.js';

const STATUS_CLASS = {
  VALID: 'ok',
  'NEEDS VALIDATION': 'warn',
  UNKNOWN: 'warn',
  INCOMPATIBLE: 'error',
  PASS: 'ok',
  WARN: 'warn',
  FAIL: 'error'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

export class ModularPanel {
  constructor({ controller, manager, status = null }) {
    this.controller = controller;
    this.manager = manager;
    this.status = status;
    this.selectedInstanceId = null;
    this.search = '';
    this.category = 'all';

    this.dom = {
      section: document.querySelector('#modularSection'),
      count: document.querySelector('#moduleCount'),
      search: document.querySelector('#moduleSearch'),
      category: document.querySelector('#moduleCategory'),
      library: document.querySelector('#moduleLibrary'),
      attached: document.querySelector('#moduleAttached'),
      compat: document.querySelector('#moduleCompat'),
      report: document.querySelector('#moduleReport'),
      importButton: document.querySelector('#importModule'),
      file: document.querySelector('#moduleFile')
    };

    this.renderCategoryOptions();
    this.bind();
  }

  renderCategoryOptions() {
    if (!this.dom.category) return;
    this.dom.category.innerHTML = [
      '<option value="all">Semua kategori</option>',
      ...MODULE_CATEGORIES.map((category) => `<option value="${category.id}">${category.label}</option>`)
    ].join('');
  }

  bind() {
    this.dom.search?.addEventListener('input', () => {
      this.search = this.dom.search.value;
      this.render();
    });
    this.dom.category?.addEventListener('change', () => {
      this.category = this.dom.category.value;
      this.render();
    });

    this.dom.library?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      const card = event.target.closest('[data-module-id]');
      if (!card) return;
      const moduleId = card.dataset.moduleId;
      if (!button) {
        this.selectModule(moduleId);
        return;
      }
      const act = button.dataset.act;
      if (act === 'attach') this.attach(moduleId);
      else if (act === 'detach') this.detachModule(moduleId);
      else if (act === 'preview') this.preview(moduleId);
      else if (act === 'delete') this.deleteFromLibrary(moduleId);
    });

    this.dom.attached?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-instance-id]');
      if (!item) return;
      // Kontrol (checkbox/input/select) ditangani oleh listener 'change'; jangan render ulang
      // saat klik, karena render akan mengganti elemen sebelum event change sempat menyala.
      if (event.target.closest('input, select, textarea')) return;
      const instanceId = item.dataset.instanceId;
      const button = event.target.closest('button[data-act]');
      if (!button) {
        this.selectedInstanceId = instanceId;
        this.render();
        return;
      }
      const act = button.dataset.act;
      if (act === 'detach') this.detachInstance(instanceId);
      else if (act === 'delete') this.deleteInstance(instanceId);
      else if (act === 'replace') this.replaceInstance(instanceId);
    });

    this.dom.attached?.addEventListener('change', (event) => {
      const item = event.target.closest('[data-instance-id]');
      if (!item) return;
      const instanceId = item.dataset.instanceId;
      if (event.target.classList.contains('module-visible')) {
        this.manager.setVisible(this.controller.current(), instanceId, event.target.checked);
        this.render();
      } else if (event.target.classList.contains('module-name')) {
        const ok = this.manager.rename(this.controller.current(), instanceId, event.target.value);
        this.status?.(ok ? 'Nama modul diperbarui.' : 'Nama modul tidak valid.', ok ? 'ok' : 'error');
        this.render();
      } else if (event.target.classList.contains('module-color')) {
        this.manager.setMaterial(this.controller.current(), instanceId, { color: event.target.value });
        this.render();
      }
    });

    this.dom.importButton?.addEventListener('click', () => this.dom.file?.click());
    this.dom.file?.addEventListener('change', async () => {
      const file = this.dom.file.files?.[0];
      if (!file) return;
      this.dom.file.value = '';
      try {
        const text = await file.text();
        this.importManifest(text, file.name);
      } catch (error) {
        this.report(`Gagal membaca berkas: ${error.message}`, 'error');
      }
    });
  }

  /* ---------------- operasi ---------------- */

  attach(moduleId) {
    const entry = this.controller.current();
    if (!entry) {
      this.status?.('Buat humanoid terlebih dahulu.', 'error');
      return null;
    }
    const result = this.manager.attach(entry, moduleId);
    const module = this.manager.getModule(moduleId);
    if (!result.ok) {
      this.report(`"${module?.moduleName || moduleId}" ditolak: ${result.error}`, 'error');
      this.status?.(`Modul ditolak: ${result.error}`, 'error');
      this.controller.recordModule('Pemasangan modul ditolak', 'FAIL', {
        modul: module?.moduleName || moduleId,
        alasan: result.error
      }, result.compat?.errors);
    } else {
      const compat = result.compat;
      const warningText = compat?.warnings?.length ? ` Peringatan: ${compat.warnings.join(' ')}` : '';
      this.report(
        `"${module?.moduleName}" terpasang — status ${compat?.status}.${warningText}`,
        compat?.status === 'VALID' ? 'ok' : 'warn'
      );
      this.status?.(`Modul "${module?.moduleName}" terpasang (${compat?.status}).`, compat?.status === 'VALID' ? 'ok' : 'warn');
      this.selectedInstanceId = result.instance.instanceId;
      this.controller.recordModule('Modul dipasang', compat?.status === 'VALID' ? 'PASS' : 'PASS', {
        modul: module?.moduleName,
        kategori: module?.category,
        tipe: module?.attachmentType,
        status: compat?.status,
        mesh: result.instance.meshes.length
      }, compat?.warnings);
    }
    this.render();
    return result;
  }

  detachModule(moduleId) {
    const entry = this.controller.current();
    if (!entry) return false;
    const instance = this.manager.attached(entry).find((item) => item.moduleId === moduleId);
    if (!instance) return false;
    return this.detachInstance(instance.instanceId);
  }

  detachInstance(instanceId) {
    const entry = this.controller.current();
    const result = this.manager.detach(entry, instanceId);
    if (result.ok) {
      this.selectedInstanceId = null;
      this.status?.(`Modul "${result.instance.name}" dilepas.`, 'ok');
      this.controller.recordModule('Modul dilepas', 'PASS', { modul: result.instance.name });
      this.report(`"${result.instance.name}" dilepas dari karakter.`, 'ok');
    } else {
      this.status?.(result.error, 'error');
      this.report(result.error, 'error');
    }
    this.render();
    return result.ok;
  }

  replaceInstance(instanceId) {
    const entry = this.controller.current();
    const result = this.manager.replace(entry, instanceId);
    if (!result.ok) {
      this.status?.(result.error, 'error');
      this.report(result.error, 'error');
    } else {
      this.status?.(`Modul diganti menjadi "${result.instance.name}".`, 'ok');
      this.controller.recordModule('Modul diganti', 'PASS', { modul: result.instance.name, status: result.compat?.status });
      this.selectedInstanceId = result.instance.instanceId;
      this.report(`Modul diganti menjadi "${result.instance.name}" (${result.compat?.status}).`, 'ok');
    }
    this.render();
    return result.ok;
  }

  deleteInstance(instanceId) {
    const entry = this.controller.current();
    const instance = this.manager.attached(entry).find((item) => item.instanceId === instanceId);
    if (!instance) return false;
    const result = this.manager.detach(entry, instanceId);
    let libraryNote = '';
    if (result.ok && instance.module.imported) {
      const removed = this.manager.removeFromLibrary(instance.moduleId);
      libraryNote = removed.ok ? ' Manifest juga dihapus dari library.' : '';
    }
    if (result.ok) {
      this.selectedInstanceId = null;
      this.status?.(`Modul "${instance.name}" dihapus.${libraryNote}`, 'ok');
      this.controller.recordModule('Modul dihapus', 'PASS', { modul: instance.name, library: libraryNote || 'tetap di library' });
      this.report(`"${instance.name}" dihapus.${libraryNote}`, 'ok');
    }
    this.render();
    return result.ok;
  }

  deleteFromLibrary(moduleId) {
    const result = this.manager.removeFromLibrary(moduleId);
    if (!result.ok) {
      this.status?.(result.error, 'error');
      this.report(result.error, 'error');
      return false;
    }
    this.status?.('Manifest modul dihapus dari library.', 'ok');
    this.render();
    return true;
  }

  selectModule(moduleId) {
    const entry = this.controller.current();
    const instance = entry ? this.manager.attached(entry).find((item) => item.moduleId === moduleId) : null;
    this.selectedInstanceId = instance?.instanceId || null;
    this.render();
  }

  preview(moduleId) {
    const entry = this.controller.current();
    const module = this.manager.getModule(moduleId);
    if (!entry || !module) return null;
    try {
      const url = this.manager.renderThumbnail(module, entry, 96);
      if (!url) return null;
      this.manager.thumbnailCache.set(moduleId, url);
      this.render();
      return url;
    } catch (error) {
      this.report(`Pratinjau gagal: ${error.message}`, 'error');
      return null;
    }
  }

  importManifest(text, fileName = 'manifest') {
    const entry = this.controller.current();
    const result = this.manager.importManifest(entry, text);
    if (!result.ok) {
      this.report(`Impor ${fileName} ditolak: ${result.errors.join(' ')}`, 'error');
      this.status?.('Manifest modul ditolak.', 'error');
      this.controller.recordModule('Impor manifest modul', 'FAIL', { berkas: fileName, galat: result.errors });
      this.render();
      return result;
    }
    const attach = result.attach;
    if (attach?.ok) {
      this.selectedInstanceId = attach.instance.instanceId;
      this.report(
        `${fileName}: modul "${result.module.moduleName}" diimpor dan dipasang (${attach.compat?.status}).${attach.compat?.warnings?.length ? ' ' + attach.compat.warnings.join(' ') : ''}`,
        attach.compat?.status === 'VALID' ? 'ok' : 'warn'
      );
      this.controller.recordModule('Impor manifest modul', 'PASS', {
        berkas: fileName,
        modul: result.module.moduleName,
        status: attach.compat?.status
      }, attach.compat?.warnings);
    } else {
      this.report(
        `${fileName}: modul "${result.module.moduleName}" ditambahkan ke library tetapi gagal dipasang: ${attach?.error || 'tidak dipasang'}`,
        'warn'
      );
      this.controller.recordModule('Impor manifest modul', 'PASS', { berkas: fileName, modul: result.module.moduleName, dipasang: false });
    }
    this.render();
    return result;
  }

  report(message, level = 'ok') {
    if (!this.dom.report) return;
    this.dom.report.textContent = message;
    this.dom.report.dataset.level = level;
  }

  /* ---------------- render ---------------- */

  render() {
    const entry = this.controller.current();
    const has = Boolean(entry);
    if (this.dom.search) this.dom.search.disabled = !has;
    if (this.dom.category) this.dom.category.disabled = !has;
    if (this.dom.importButton) this.dom.importButton.disabled = !has;

    if (!has) {
      if (this.dom.library) this.dom.library.innerHTML = '<p class="hint">Buat humanoid untuk memasang modul.</p>';
      if (this.dom.attached) this.dom.attached.innerHTML = '';
      if (this.dom.compat) this.dom.compat.innerHTML = '';
      if (this.dom.count) this.dom.count.textContent = '0 modul';
      return;
    }

    const summary = this.manager.summary(entry);
    if (this.dom.count) this.dom.count.textContent = `${summary.attached} modul · ${summary.meshes} mesh`;

    if (this.dom.library) {
      const cards = this.manager.listLibrary(entry, { search: this.search, category: this.category });
      this.dom.library.innerHTML = cards.map(({ module, attached, thumb }) => {
        const isBase = module.moduleId === BASE_MODULE_ID;
        const actions = isBase
          ? '<span class="badge">dasar</span>'
          : attached
            ? '<button class="btn tiny" data-act="detach" type="button">Lepas</button>'
            : '<button class="btn tiny primary" data-act="attach" type="button">Pasang</button>';
        return `
          <div class="module-card${attached ? ' attached' : ''}" data-module-id="${escapeHtml(module.moduleId)}">
            <div class="module-thumb">${thumb ? `<img alt="" src="${thumb}" />` : `<span>${escapeHtml(module.category.slice(0, 3).toUpperCase())}</span>`}</div>
            <div class="module-meta">
              <div class="module-title"><strong>${escapeHtml(module.moduleName)}</strong></div>
              <div class="module-sub">${escapeHtml(categoryLabel(module.category))} · ${escapeHtml(module.sourceFormat)} · ${escapeHtml(module.validationStatus)}</div>
            </div>
            <div class="module-actions">
              ${isBase ? actions : `<button class="btn tiny" data-act="preview" type="button" title="Render pratinjau">Pratinjau</button>`}
              ${actions}
            </div>
          </div>
        `;
      }).join('') || '<p class="hint">Tidak ada modul yang cocok dengan pencarian.</p>';
    }

    if (this.dom.attached) {
      const instances = this.manager.attached(entry);
      this.dom.attached.innerHTML = instances.map((instance) => {
        const status = instance.compat?.status || VALIDATION_STATUS.UNKNOWN;
        const color = instance.overrides?.color || instance.module.options?.color || '#cccccc';
        return `
          <div class="module-item${instance.instanceId === this.selectedInstanceId ? ' selected' : ''}" data-instance-id="${escapeHtml(instance.instanceId)}">
            <div class="module-item-head">
              <input class="module-visible" type="checkbox" ${instance.visible ? 'checked' : ''} title="Tampilkan" />
              <input class="module-name" type="text" maxlength="48" value="${escapeHtml(instance.name)}" />
              <span class="badge ${STATUS_CLASS[status] || ''}">${escapeHtml(status)}</span>
            </div>
            <div class="module-item-sub">${escapeHtml(categoryLabel(instance.category))} · ${escapeHtml(attachmentLabel(instance.attachmentType))}</div>
            <div class="module-item-actions">
              <input class="module-color" type="color" value="${escapeHtml(color)}" title="Ubah warna material" />
              <button class="btn tiny" data-act="replace" type="button">Ganti</button>
              <button class="btn tiny" data-act="detach" type="button">Lepas</button>
              <button class="btn tiny danger" data-act="delete" type="button">Hapus</button>
            </div>
          </div>
        `;
      }).join('') || '<p class="hint">Belum ada modul terpasang.</p>';
    }

    this.renderCompat(entry);
  }

  renderCompat(entry) {
    if (!this.dom.compat) return;
    const instance = this.manager.attached(entry).find((item) => item.instanceId === this.selectedInstanceId);
    if (!instance) {
      this.dom.compat.innerHTML = '<p class="hint">Pilih modul terpasang untuk melihat hasil pemeriksaan kompatibilitas.</p>';
      return;
    }
    const compat = instance.compat;
    const module = instance.module;
    const rows = (compat?.checks || []).map((check) => `
      <li class="compat-row ${STATUS_CLASS[check.status] || ''}">
        <span class="compat-status">${escapeHtml(check.status)}</span>
        <span class="compat-label">${escapeHtml(check.label)}</span>
        <span class="compat-detail">${escapeHtml(check.detail)}</span>
      </li>
    `).join('');

    this.dom.compat.innerHTML = `
      <div class="compat-head">
        <strong>${escapeHtml(instance.name)}</strong>
        <span class="badge ${STATUS_CLASS[compat?.status] || ''}">${escapeHtml(compat?.status || 'UNKNOWN')}</span>
      </div>
      <p class="hint">${(compat?.warnings || []).length ? escapeHtml(compat.warnings.join(' ')) : 'Tidak ada peringatan.'}</p>
      <ul class="compat-list">${rows}</ul>
      <details class="compat-meta">
        <summary>Metadata modul (19 field)</summary>
        <dl>
          <dt>moduleId</dt><dd>${escapeHtml(module.moduleId)}</dd>
          <dt>moduleName</dt><dd>${escapeHtml(module.moduleName)}</dd>
          <dt>moduleVersion</dt><dd>${escapeHtml(module.moduleVersion)}</dd>
          <dt>category</dt><dd>${escapeHtml(module.category)}</dd>
          <dt>sourceFile</dt><dd>${escapeHtml(module.sourceFile)}</dd>
          <dt>sourceFormat</dt><dd>${escapeHtml(module.sourceFormat)}</dd>
          <dt>sourceLicense</dt><dd>${escapeHtml(module.sourceLicense)}</dd>
          <dt>scale</dt><dd>${escapeHtml(module.scale)}</dd>
          <dt>orientation</dt><dd>${escapeHtml(module.orientation)}</dd>
          <dt>attachmentType</dt><dd>${escapeHtml(module.attachmentType)}</dd>
          <dt>attachmentPoint</dt><dd>${escapeHtml(module.attachmentPoint)}</dd>
          <dt>bodyRegion</dt><dd>${escapeHtml(module.bodyRegion)}</dd>
          <dt>supportedSkeleton</dt><dd>${escapeHtml(module.supportedSkeleton)}</dd>
          <dt>requiredBones</dt><dd>${escapeHtml(module.requiredBones.join(', '))}</dd>
          <dt>materialList</dt><dd>${escapeHtml(module.materialList.join(', '))}</dd>
          <dt>textureList</dt><dd>${escapeHtml(module.textureList.join(', ') || '(kosong)')}</dd>
          <dt>compatibleBodyProfiles</dt><dd>${escapeHtml(module.compatibleBodyProfiles.join(', '))}</dd>
          <dt>validationStatus</dt><dd>${escapeHtml(module.validationStatus)}</dd>
          <dt>knownLimitations</dt><dd>${escapeHtml(module.knownLimitations.join(' | ') || '(tidak ada)')}</dd>
        </dl>
      </details>
    `;
  }
}
