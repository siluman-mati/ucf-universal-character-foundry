/**
 * UCF Tahap 5 — panel animasi & retargeting (seksi 8).
 */
import { NATIVE_CLIPS } from './clips.js';

const STATUS_CLASS = { PASS: 'ok', FAIL: 'error', 'NEEDS VALIDATION': 'warn', UNKNOWN: 'warn' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export class AnimationPanel {
  constructor({ controller, player, status = null }) {
    this.controller = controller;
    this.player = player;
    this.status = status;
    this.dom = {
      section: document.querySelector('#animationSection'),
      status: document.querySelector('#animStatus'),
      clip: document.querySelector('#animClip'),
      load: document.querySelector('#animLoad'),
      play: document.querySelector('#animPlay'),
      pause: document.querySelector('#animPause'),
      stop: document.querySelector('#animStop'),
      reset: document.querySelector('#animReset'),
      loop: document.querySelector('#animLoop'),
      speed: document.querySelector('#animSpeed'),
      speedOut: document.querySelector('#animSpeedOut'),
      time: document.querySelector('#animTime'),
      timeOut: document.querySelector('#animTimeOut'),
      test: document.querySelector('#animTest'),
      report: document.querySelector('#animReport'),
      source: document.querySelector('#animSource'),
      sourceClip: document.querySelector('#animSourceClip'),
      map: document.querySelector('#animMap'),
      retarget: document.querySelector('#animRetarget'),
      mapReport: document.querySelector('#animMapReport')
    };
    this.lastMap = null;
    this.bind();
    this.render();
  }

  bind() {
    const player = this.player;
    this.dom.load?.addEventListener('click', () => this.loadSelected());
    this.dom.play?.addEventListener('click', () => {
      player.play();
      this.controller.recordAnim('Animasi diputar', 'PASS', { klip: player.state.name, waktu: Number(player.state.time.toFixed(2)) });
    });
    this.dom.pause?.addEventListener('click', () => player.pause());
    this.dom.stop?.addEventListener('click', () => {
      player.stop();
      this.controller.recordAnim('Animasi dihentikan', 'PASS', { klip: player.state.name });
    });
    this.dom.reset?.addEventListener('click', () => {
      const name = player.state.name;
      player.reset();
      this.controller.recordAnim('Pose direset', 'PASS', { klip: name, hasil: 'pose sebelum animasi dipulihkan' });
    });
    this.dom.loop?.addEventListener('change', () => player.setLoop(this.dom.loop.checked));
    this.dom.speed?.addEventListener('input', () => {
      const value = player.setSpeed(Number(this.dom.speed.value));
      if (this.dom.speedOut) this.dom.speedOut.textContent = `${value.toFixed(2)}×`;
    });
    this.dom.time?.addEventListener('input', () => {
      const ratio = Number(this.dom.time.value) / 1000;
      player.seek(ratio * (player.state.duration || 0));
    });
    this.dom.test?.addEventListener('click', () => this.runEvaluation());
    this.dom.map?.addEventListener('click', () => this.buildMapping());
    this.dom.retarget?.addEventListener('click', () => this.applyRetarget());
    this.dom.source?.addEventListener('change', () => this.renderSourceClips());
  }

  /* ---------------- daftar ---------------- */

  clipOptions() {
    const entry = this.controller.current();
    const groups = [];
    const native = this.player.nativeClips(entry);
    if (native.length) {
      groups.push({
        label: 'UCF native',
        items: native.map((clip) => ({ value: `native:${clip.id}`, label: `${clip.name} · ${clip.duration.toFixed(2)} s · ${clip.grounded}` }))
      });
    }
    for (const model of this.player.importedModels()) {
      groups.push({
        label: `${model.name} (klip asli)`,
        items: model.clips.map((clip) => ({ value: `model:${model.modelId}:${clip.id}`, label: `${clip.name} · ${clip.duration.toFixed(2)} s` }))
      });
    }
    for (const item of this.player.retargetedClips()) {
      groups.push({
        label: `Retarget ${item.clipName}`,
        items: [{ value: `retarget:${item.modelId}:${item.clipName}`, label: `${item.clipName} → UCF · ${item.duration.toFixed(2)} s` }]
      });
    }
    return groups;
  }

  render() {
    const hasEntry = Boolean(this.controller.current());
    for (const element of [this.dom.load, this.dom.play, this.dom.pause, this.dom.stop, this.dom.reset, this.dom.test]) {
      if (element) element.disabled = !hasEntry;
    }
    if (this.dom.clip) {
      const previous = this.dom.clip.value;
      this.dom.clip.innerHTML = this.clipOptions()
        .map((group) => `<optgroup label="${escapeHtml(group.label)}">${group.items
          .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
          .join('')}</optgroup>`)
        .join('');
      if (previous) this.dom.clip.value = previous;
    }
    this.renderSources();
    this.syncState(this.player.state);
  }

  renderSources() {
    if (!this.dom.source) return;
    const models = this.player.importedModels();
    const previous = this.dom.source.value;
    this.dom.source.innerHTML = models.length
      ? models.map((model) => `<option value="${escapeHtml(model.modelId)}">${escapeHtml(model.name)}</option>`).join('')
      : '<option value="">(impor model beranimasi dulu)</option>';
    if (previous) this.dom.source.value = previous;
    this.renderSourceClips();
  }

  renderSourceClips() {
    if (!this.dom.sourceClip) return;
    const modelId = this.dom.source?.value;
    const model = this.player.importedModels().find((item) => item.modelId === modelId);
    this.dom.sourceClip.innerHTML = model
      ? model.clips.map((clip) => `<option value="${escapeHtml(clip.id)}">${escapeHtml(clip.name)} · ${clip.duration.toFixed(2)} s</option>`).join('')
      : '<option value="">—</option>';
    if (this.dom.map) this.dom.map.disabled = !model;
    if (this.dom.retarget) this.dom.retarget.disabled = !model;
  }

  refreshSources() {
    this.render();
  }

  /* ---------------- kontrol ---------------- */

  loadSelected() {
    const value = this.dom.clip?.value || '';
    const [kind, a, b] = value.split(':');
    let result = null;
    if (kind === 'native') result = this.player.load({ kind: 'native', id: a });
    else if (kind === 'model') result = this.player.load({ kind: 'model', modelId: a, id: b });
    else if (kind === 'retarget') result = this.player.load({ kind: 'retarget', modelId: a, id: b });
    if (!result?.ok) {
      this.report(result?.error || 'Klip tidak dapat dimuat.', 'error');
      this.controller.recordAnim('Muat klip animasi', 'FAIL', { klip: value, alasan: result?.error || '—' });
      return result;
    }
    this.controller.recordAnim('Muat klip animasi', 'PASS', {
      klip: this.player.state.name,
      sumber: this.player.state.source,
      durasi: this.player.state.duration
    });
    if (this.dom.loop) this.dom.loop.checked = this.player.state.loop;
    this.report(`Klip "${this.player.state.name}" dimuat (${this.player.state.duration} s).`, 'ok');
    this.syncState(this.player.state);
    return result;
  }

  syncState(state) {
    if (!state) return;
    if (this.dom.loop) this.dom.loop.checked = Boolean(state.loop);
    if (this.dom.status) {
      this.dom.status.textContent = state.id
        ? `${state.playing ? '▶' : '■'} ${state.name} · ${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s`
        : 'belum ada klip';
    }
    if (this.dom.time) {
      const max = state.duration || 1;
      this.dom.time.value = String(Math.round((state.time / max) * 1000));
    }
    if (this.dom.timeOut) this.dom.timeOut.textContent = `${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s`;
    if (this.dom.speed && state.speed) this.dom.speed.value = String(state.speed);
    if (this.dom.speedOut) this.dom.speedOut.textContent = `${(state.speed || 1).toFixed(2)}×`;
    this.dom.play?.classList.toggle('primary', state.playing);
  }

  report(message, level = 'ok') {
    if (!this.dom.report) return;
    this.dom.report.textContent = message;
    this.dom.report.dataset.level = level;
  }

  /* ---------------- evaluasi ---------------- */

  runEvaluation() {
    const attached = this.controller.current() ? this.controller.modular.attached(this.controller.current()).length : 0;
    const result = this.player.evaluate({ modular: attached > 0 });
    if (!result.ok) {
      this.report(result.error, 'error');
      return result;
    }
    this.controller.recordAnim('Uji animasi (deformasi & lantai)', result.failed ? 'FAIL' : 'PASS', {
      klip: result.clip,
      durasi: result.duration,
      lulus: result.passed,
      gagal: result.failed,
      'terendah kaki (m)': result.metrics.foot.lowestFootM,
      'kontak tertinggi (m)': result.metrics.foot.highestContactM,
      'drift panggul (m)': result.metrics.foot.hipsDriftXZ,
      'sudut lutut': `${result.metrics.joints.kneeMinDeg}–${result.metrics.joints.kneeMaxDeg}°`,
      'regangan rusuk': result.metrics.stretch.maxLengthRatio,
      'loop (°)': result.metrics.loop.maxAngleDeg
    }, result.checks.filter((entry) => entry.status !== 'PASS').map((entry) => entry.detail));
    if (this.dom.report) {
      this.dom.report.innerHTML = result.checks.map((entry) => `
        <div class="compat-row ${STATUS_CLASS[entry.status] || ''}">
          <span class="compat-status">${escapeHtml(entry.status)}</span>
          <span class="compat-label">${escapeHtml(entry.label)}</span>
          <span class="compat-detail">${escapeHtml(entry.detail)}</span>
        </div>`).join('');
    }
    this.status?.(`Uji animasi: ${result.passed} PASS, ${result.failed} FAIL.`, result.failed ? 'error' : 'ok');
    return result;
  }

  /* ---------------- retarget ---------------- */

  buildMapping() {
    const modelId = this.dom.source?.value;
    const result = this.player.buildMapping(modelId);
    if (!result.ok) {
      this.dom.mapReport.innerHTML = `<p class="hint error">${escapeHtml(result.error || 'Peta tulang belum valid.')}</p>`;
      return result;
    }
    this.lastMap = result.mapping;
    this.renderMapping(result.mapping);
    return result;
  }

  renderMapping(mapping) {
    if (!this.dom.mapReport) return;
    const rows = mapping.pairs.slice(0, 64).map((pair) => `
      <tr>
        <td>${escapeHtml(pair.role)}</td>
        <td>${escapeHtml(pair.source)}</td>
        <td>${escapeHtml(pair.target)}</td>
        <td>${escapeHtml(pair.method)}</td>
        <td>${pair.confidence.toFixed(2)}</td>
        <td>${(pair.relativeRestDeviationDeg ?? pair.restDeviationDeg).toFixed(1)}°</td>
      </tr>`).join('');
    const checks = (mapping.checks || []).map((check) => `
      <div class="compat-row ${STATUS_CLASS[check.status] || ''}">
        <span class="compat-status">${escapeHtml(check.status)}</span>
        <span class="compat-label">${escapeHtml(check.label)}</span>
        <span class="compat-detail">${escapeHtml(check.detail)}</span>
      </div>`).join('');
    this.dom.mapReport.innerHTML = `
      <div class="map-summary">
        <strong>${mapping.mapped}</strong> pasangan dari ${mapping.sourceBones} tulang sumber ·
        cakupan ${(mapping.coverage * 100).toFixed(0)}% ·
        keyakinan rata-rata ${mapping.averageConfidence} ·
        nama-saja ${mapping.nameOnlyPairs} pasangan
      </div>
      ${checks}
      <details class="map-details">
        <summary>Detail ${mapping.mapped} pasangan tulang</summary>
        <table class="map-table">
          <thead><tr><th>Peran</th><th>Sumber</th><th>Target</th><th>Metode</th><th>Keyakinan</th><th>Deviasi rest rel.</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="hint">Deviasi rest relatif = beda sudut tulang-terhadap-induk; tahan terhadap perbedaan bind pose (A-pose Mixamo vs T-pose UCF). Deviasi absolut sampai ${mapping.maxRestDeviationDeg}° tetap wajar untuk pasangan yang benar.</p>
        <p class="hint">Tidak terpetakan (sumber): ${mapping.unmappedSource.length} — ${escapeHtml(mapping.unmappedSource.slice(0, 12).join(', ') || '—')}</p>
        <p class="hint">Tanpa pasangan (target): ${mapping.unmappedTarget.length} — ${escapeHtml(mapping.unmappedTarget.slice(0, 12).join(', ') || '—')}</p>
      </details>`;
    if (this.controller?.current) {
      this.controller.recordAnim('Peta tulang retarget', mapping.ok ? 'PASS' : 'FAIL', {
        sumber: mapping.sourceLabel,
        target: mapping.targetLabel,
        pasangan: mapping.mapped,
        cakupan: mapping.coverage,
        'nama-saja': mapping.nameOnlyPairs,
        konflik: mapping.conflicts.length,
        konflik_hierarki: mapping.hierarchyIssues,
        'deviasi rest relatif': `${mapping.maxRelativeRestDeviationDeg}°`
      });
    }
  }

  applyRetarget() {
    const modelId = this.dom.source?.value;
    const clipName = this.dom.sourceClip?.value;
    const result = this.player.retarget(modelId, clipName);
    if (!result.ok) {
      this.dom.mapReport.innerHTML = `<p class="hint error">${escapeHtml(result.error)}</p>`;
      this.controller.recordAnim('Retarget klip', 'FAIL', { klip: clipName, alasan: result.error });
      return result;
    }
    this.renderMapping(result.mapping);
    const verify = result.verify;
    const verifyHtml = `
      <div class="map-summary">Verifikasi arah tulang: rata-rata ${verify.meanDeg}°, terburuk ${verify.worstDeg}° (${verify.samples.length} sampel).</div>
      <div class="compat-row ${verify.worstDeg <= 15 ? 'ok' : 'warn'}">
        <span class="compat-status">${verify.worstDeg <= 15 ? 'PASS' : 'WARN'}</span>
        <span class="compat-label">Kemiripan pose hasil retarget</span>
        <span class="compat-detail">Deviasi arah tulang maksimum ${verify.worstDeg}° terhadap pose yang diharapkan (${verify.samples.length} sampel, 50 tulang).</span>
      </div>
      <div class="compat-row ${verify.minTrajectoryRho >= 0.9 ? 'ok' : 'warn'}">
        <span class="compat-status">${verify.minTrajectoryRho >= 0.9 ? 'PASS' : 'WARN'}</span>
        <span class="compat-label">Lintasan tangan/kaki vs sumber</span>
        <span class="compat-detail">Korelasi terendah ${verify.minTrajectoryRho.toFixed(3)} (relatif panggul, dinormalkan tinggi badan); ujung tangan tidak berpindah sisi.</span>
      </div>`;
    this.dom.mapReport.insertAdjacentHTML('beforeend', verifyHtml);
    this.controller.recordAnim('Retarget klip', verify.worstDeg <= 25 ? 'PASS' : 'FAIL', {
      sumber: clipName,
      target: this.controller.current()?.name || '—',
      durasi: result.clip.duration,
      pasangan: result.mapping.mapped,
      'arah rata-rata': `${verify.meanDeg}°`,
      'arah terburuk': `${verify.worstDeg}°`,
      'korelasi lintasan': `${verify.minTrajectoryRho.toFixed(3)}`,
      'root motion dibuang': `${result.report.droppedTranslationM} m`
    });
    // Selalu segarkan daftar klip lalu muat hasil retarget secara eksplisit; kalau tidak,
    // yang termuat tetap klip sebelumnya dan pengguna tidak pernah melihat hasil retarget.
    this.render();
    const value = `retarget:${modelId}:${clipName}`;
    if (this.dom.clip) this.dom.clip.value = value;
    const loaded = this.loadSelected();
    if (!loaded?.ok) {
      this.dom.mapReport.insertAdjacentHTML('beforeend', `<p class="hint error">Klip hasil retarget tidak dapat dimuat.</p>`);
    }
    this.status?.(`Retarget "${clipName}" siap diputar pada karakter UCF.`, 'ok');
    return result;
  }
}
