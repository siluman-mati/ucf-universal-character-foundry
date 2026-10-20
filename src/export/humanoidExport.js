/**
 * Tahap 7 — rakit GLB untuk diekspor + perbandingan impor ulang.
 * Tidak mengubah scene langsung; hasil ekspor diklon supaya posisi slot X
 * (viewport.addModel menggeser root ke X(slot)) tidak ikut tersimpan.
 */
import * as THREE from 'three';

export function collectExportClips(entry) {
  const clips = [];
  const seen = new Set();
  const add = (clip) => {
    if (!clip || !clip.name || seen.has(clip.name)) return;
    seen.add(clip.name);
    clips.push(clip);
  };
  // klip native untuk karakter ini
  if (entry?.animations) for (const c of entry.animations) add(c);
  if (entry?.content?.userData?.ucfRig) {
    // klip retarget yang pernah dibuat untuk entry ini disimpan di player.retargetCache
    // dipanggil dari main.js dengan daftar eksplisit
  }
  return clips;
}

export function cloneForExport(model) {
  const clone = model.root.clone(true);
  // kembalikan posisi slot viewport ke origin supaya berkas mandiri (bukan tergantung layout sesi)
  clone.position.set(0, 0, 0);
  clone.updateMatrixWorld(true);
  // pastikan skeleton clone konsisten
  clone.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      // GLTFExporter membaca skeleton dari skinnedMesh.skeleton
      // clone(true) sudah menyalin skeleton; biarkan apa adanya
    }
  });
  return clone;
}

export function compareStats(before, after) {
  const keys = ['meshes', 'skinnedMeshes', 'bones', 'triangles', 'vertices', 'materials'];
  const rows = [];
  for (const k of keys) {
    const a = before?.[k] ?? 0;
    const b = after?.[k] ?? 0;
    rows.push({ key: k, before: a, after: b, same: a === b });
  }
  return rows;
}

export function compareMaterials(beforeRoot, afterRoot) {
  const mats = (root) => {
    const m = new Map();
    root.traverse((o) => {
      if (!o.material) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of arr) if (mat) {
        m.set(mat.name || mat.uuid, { name: mat.name || '(tanpa nama)', type: mat.type, color: mat.color?.getHexString?.() || null });
      }
    });
    return m;
  };
  const a = mats(beforeRoot);
  const b = mats(afterRoot);
  const allNames = new Set([...a.keys(), ...b.keys()]);
  const rows = [];
  for (const n of allNames) rows.push({ name: n, before: a.get(n) || null, after: b.get(n) || null, same: Boolean(a.has(n) && b.has(n) && a.get(n).type === b.get(n).type) });
  return { countBefore: a.size, countAfter: b.size, rows };
}
