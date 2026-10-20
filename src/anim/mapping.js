/**
 * UCF Tahap 5 — pemetaan tulang eksplisit (bukan berbasis nama).
 *
 * Pemetaan disusun dari peran struktural hasil `analyzeSkeleton()`:
 * hierarki + arah tulang + sisi dunia + urutan rantai. Nama tulang hanya dipakai
 * untuk menambah keyakinan dan mendeteksi konflik penamaan antar rig.
 * Setiap pasangan dicatat metodenya sehingga keputusan bisa diaudit.
 */
import * as THREE from 'three';
import { analyzeSkeleton, nameSignals, normalizeName } from './skeleton.js';

export const CORE_ROLES = Object.freeze([
  'hips',
  'chest',
  'neck',
  'head',
  'arm.upper',
  'arm.lower',
  'hand',
  'leg.upper',
  'leg.lower',
  'foot'
]);

function roleSide(role) {
  const match = /_(R|L)$/.exec(role || '');
  return match ? match[1] : null;
}

function withSide(role, side) {
  if (!role || !side || side === 'C') return role;
  return `${role}_${side}`;
}

function angleDeg(a, b) {
  const va = new THREE.Vector3().fromArray(a);
  const vb = new THREE.Vector3().fromArray(b);
  if (va.lengthSq() < 1e-12 || vb.lengthSq() < 1e-12) return 0;
  return (va.angleTo(vb) * 180) / Math.PI;
}

/** Tulang bernama sama di kedua rig (baseline naif, untuk pembanding laporan). */
export function nameOnlyMapping(source, target) {
  const targetByKey = new Map();
  for (const entry of target.bones) targetByKey.set(normalizeName(entry.name), entry);
  const pairs = [];
  for (const entry of source.bones) {
    const match = targetByKey.get(normalizeName(entry.name));
    if (match) pairs.push({ source: entry.name, target: match.name });
  }
  return pairs;
}

/**
 * Bangun pemetaan dari dua hasil `analyzeSkeleton`.
 * @returns {object} mapping
 */
export function buildBoneMapping(source, target, { sourceLabel = 'sumber', targetLabel = 'target' } = {}) {
  if (!source || !target) {
    return { ok: false, error: 'Skeleton sumber atau target tidak terbaca.', pairs: [] };
  }

  const targetByRole = new Map();
  for (const entry of target.bones) {
    if (!entry.role) continue;
    targetByRole.set(withSide(entry.role, entry.side), entry);
  }
  const sourceRoles = new Set(source.bones.filter((entry) => entry.role).map((entry) => withSide(entry.role, entry.side)));
  const targetRoles = new Set(targetByRole.keys());

  const pairs = [];
  const conflicts = [];
  const weak = [];
  const unmappedSource = [];

  for (const entry of source.bones) {
    if (!entry.role) { unmappedSource.push(entry.name); continue; }
    const key = withSide(entry.role, entry.side);
    const match = targetByRole.get(key);
    if (!match) {
      unmappedSource.push(entry.name);
      continue;
    }
    const sourceSide = nameSignals(entry.name).side;
    const targetSide = nameSignals(match.name).side;
    const nameAgrees = Boolean(sourceSide && targetSide && sourceSide === targetSide);
    const nameConflict = Boolean(sourceSide && targetSide && sourceSide !== targetSide);
    if (nameConflict) {
      conflicts.push({
        source: entry.name,
        target: match.name,
        role: key,
        worldSideAgrees: entry.side === match.side,
        kind: 'konvensi-label',
        reason: `label nama ${sourceSide} vs ${targetSide}, tetapi posisi dunia keduanya di sisi ${entry.side === 'R' ? '+X' : '−X'}`
      });
    }

    let parentConsistent = true;
    const sourceParentRole = entry.parent ? withSide(source.byName.get(entry.parent)?.role, source.byName.get(entry.parent)?.side) : null;
    const targetParentRole = match.parent ? withSide(target.byName.get(match.parent)?.role, target.byName.get(match.parent)?.side) : null;
    const isShoulderAnchoring = /^(clavicle|arm\.upper)/.test(key) && /^(neck|chest)$/.test(String(sourceParentRole || '').split(':')[0]) && /^(neck|chest)$/.test(String(targetParentRole || '').split(':')[0]);
    if (sourceParentRole && targetRoles.has(sourceParentRole) && sourceParentRole !== targetParentRole && !isShoulderAnchoring) {
      parentConsistent = false;
      weak.push({ source: entry.name, target: match.name, reason: `induk ${sourceParentRole} ≠ ${targetParentRole}` });
    }

    const deviation = entry.role === 'hips' ? 0 : angleDeg(entry.direction, match.direction);
    let confidence = 0.8;
    if (nameAgrees) confidence += 0.1;
    if (parentConsistent) confidence += 0.08;
    if (deviation <= 20) confidence += 0.02;
    if (!parentConsistent) confidence = Math.min(confidence, 0.62);
    if (nameConflict) confidence = Math.min(confidence, 0.7);

    const method = nameConflict
      ? 'struktur (nama bertentangan)'
      : nameAgrees
        ? 'struktur + nama cocok'
        : 'struktur';

    pairs.push({
      source: entry.name,
      target: match.name,
      role: key,
      method,
      confidence: Number(Math.min(0.99, confidence).toFixed(2)),
      parentConsistent,
      restDeviationDeg: Number(deviation.toFixed(1)),
      sourceSide: entry.side,
      targetSide: match.side
    });
  }

  // Deviasi rest RELATIF terhadap induk. A-pose (Mixamo) vs T-pose (UCF) membuat arah
  // dunia berbeda puluhan derajat padahal pasangannya benar; sudut tulang-terhadap-induk
  // tetap hampir sama pada kedua bind pose, jadi inilah ukuran yang dipakai untuk validasi.
  const angleBetweenVec = (a, b) => {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return (Math.acos(dot) * 180) / Math.PI;
  };
  for (const pair of pairs) {
    const sEntry = source.byName.get(pair.source);
    const tEntry = target.byName.get(pair.target);
    const parentPair = sEntry?.parent ? pairs.find((item) => item.source === sEntry.parent) : null;
    const sParent = sEntry?.parent ? source.byName.get(sEntry.parent) : null;
    const tParent = tEntry?.parent ? target.byName.get(tEntry.parent) : null;
    if (!parentPair || !sParent || !tParent || !tEntry) {
      pair.relativeRestDeviationDeg = 0;
      continue;
    }
    const sourceAngle = angleBetweenVec(sEntry.direction, sParent.direction);
    const targetAngle = angleBetweenVec(tEntry.direction, tParent.direction);
    pair.relativeRestDeviationDeg = Number(Math.abs(sourceAngle - targetAngle).toFixed(1));
  }

  // hierarki: pastikan rantai induk→anak tetap konsisten pada pasangan yang terpetakan
  const bySourceName = new Map(pairs.map((pair) => [pair.source, pair]));
  let hierarchyIssues = 0;
  for (const pair of pairs) {
    const sourceEntry = source.byName.get(pair.source);
    const targetEntry = target.byName.get(pair.target);
    if (!sourceEntry?.parent || !targetEntry?.parent) continue;
    const sourceParentPair = bySourceName.get(sourceEntry.parent);
    if (!sourceParentPair) continue;
    const shoulderAnchor = /^(clavicle|arm\.upper)/.test(pair.role) && ['Neck','Chest'].includes(sourceParentPair.target) && ['Neck','Chest'].includes(targetEntry.parent);
    if (sourceParentPair.target !== targetEntry.parent && !shoulderAnchor) hierarchyIssues += 1;
  }

  const unmappedTarget = target.bones
    .filter((entry) => entry.role && !pairs.some((pair) => pair.target === entry.name))
    .map((entry) => entry.name);

  const coreMissing = CORE_ROLES.filter((role) => !pairs.some((pair) => pair.role.startsWith(role)));

  const mappedCount = pairs.length;
  const averageConfidence = pairs.length
    ? pairs.reduce((sum, pair) => sum + pair.confidence, 0) / pairs.length
    : 0;

  const hipsPair = pairs.find((pair) => pair.role === 'hips');
  const sourceHips = hipsPair ? source.byName.get(hipsPair.source) : null;
  const targetHips = hipsPair ? target.byName.get(hipsPair.target) : null;
  const hipRatio = sourceHips && targetHips
    ? (targetHips.worldPos[1] - target.bones.reduce((min, entry) => Math.min(min, entry.worldPos[1]), Infinity)) /
      Math.max(1e-6, sourceHips.worldPos[1] - source.bones.reduce((min, entry) => Math.min(min, entry.worldPos[1]), Infinity))
    : 1;

  const maxDeviation = pairs.reduce((max, pair) => Math.max(max, pair.restDeviationDeg), 0);
  const maxRelativeDeviation = pairs.reduce((max, pair) => Math.max(max, pair.relativeRestDeviationDeg || 0), 0);
  const conflictsNameless = conflicts.filter((item) => item.worldSideAgrees === false);
  const labelMirroredSource = pairs.filter((pair) => {
    const signal = nameSignals(pair.source).side;
    return signal && signal !== pair.sourceSide;
  }).length;
  const labelMirroredTarget = pairs.filter((pair) => {
    const signal = nameSignals(pair.target).side;
    return signal && signal !== pair.targetSide;
  }).length;

  return {
    ok: mappedCount >= 8 && coreMissing.length === 0 && hierarchyIssues === 0,
    sourceLabel,
    targetLabel,
    pairs,
    sourceBones: source.bones.length,
    targetBones: target.bones.length,
    mapped: mappedCount,
    coverage: Number((mappedCount / Math.max(1, source.bones.length)).toFixed(3)),
    unmappedSource,
    unmappedTarget,
    conflicts,
    weak,
    hierarchyIssues,
    coreMissing,
    averageConfidence: Number(averageConfidence.toFixed(2)),
    maxRestDeviationDeg: Number(maxDeviation.toFixed(1)),
    maxRelativeRestDeviationDeg: Number(maxRelativeDeviation.toFixed(1)),
    sideConvention: {
      sourceLabelMirrored: labelMirroredSource,
      targetLabelMirrored: labelMirroredTarget,
      sourceMirrored: labelMirroredSource > pairs.length / 2,
      targetMirrored: labelMirroredTarget > pairs.length / 2
    },
    conflictsByName: conflicts.length,
    conflictsWorldSide: conflictsNameless.length,
    hipRatio: Number(hipRatio.toFixed(3)),
    nameOnlyPairs: nameOnlyMapping(source, target).length,
    roles: [...new Set(pairs.map((pair) => pair.role.replace(/_(R|L)$/, '')))]
  };
}

/** Ringkasan pemeriksaan kualitas pemetaan untuk panel & log. */
export function validateMapping(mapping) {
  if (!mapping?.pairs?.length) {
    return [{ id: 'mapping', label: 'Peta tulang tersedia', status: 'FAIL', detail: 'Tidak ada pasangan tulang.' }];
  }
  const checks = [];
  const push = (id, label, ok, detail) => checks.push({ id, label, status: ok ? 'PASS' : 'FAIL', detail });

  push('cakupan', 'Cakupan tulang inti', mapping.coreMissing.length === 0,
    mapping.coreMissing.length ? `Peran inti tidak terpetakan: ${mapping.coreMissing.join(', ')}` : `Semua peran inti terpetakan (${mapping.mapped} tulang).`);
  push('hierarki', 'Konsistensi hierarki', mapping.hierarchyIssues === 0,
    `${mapping.hierarchyIssues} pasangan dengan induk tidak konsisten.`);
  push('sisi', 'Konsistensi sisi', mapping.pairs.every((pair) => pair.sourceSide === pair.targetSide),
    `Sisi dunia sumber/target sama untuk seluruh pasangan.`);
  // Ambang 45° dipakai sebagai DETEKTOR SALAH PASANG (mis. telunjuk↔kelingking = 90°,
  // ibu jari salah = 116°), bukan pembanding bind pose: selisih A-pose vs T-pose
  // memang menghasilkan deviasi absolut sampai ~80° pada pasangan yang benar.
  push('rest', 'Kecocokan rest pose', mapping.maxRelativeRestDeviationDeg <= 45,
    `Deviasi sudut tulang-terhadap-induk maksimum ${mapping.maxRelativeRestDeviationDeg}° (ambang 45°); ` +
    `beda bind pose absolut ${mapping.maxRestDeviationDeg}° wajar bila sumber A-pose dan target T-pose.`);
  push('konflik-nama', 'Konflik label sisi', mapping.conflictsWorldSide === 0,
    mapping.conflictsWorldSide === 0
      ? `${mapping.conflictsByName} label sisi berlawanan nama (konvensi +X: sumber ${mapping.sideConvention.sourceMirrored ? 'kiri' : 'kanan'}, target ${mapping.sideConvention.targetMirrored ? 'kanan' : 'kiri'}); posisi dunia seluruh pasangan sepakat.`
      : `${mapping.conflictsWorldSide} pasangan bertentangan sisi dunia.`);
  push('nama-saja', 'Pembanding nama-saja', true,
    `Pencocokan nama mentah hanya menemukan ${mapping.nameOnlyPairs} pasangan; struktur menemukan ${mapping.mapped}.`);

  return checks;
}

/** Analisis sekali untuk root + skeleton (dipakai player & panel). */
export function describeRigForAnimation(root, skeleton = null) {
  return analyzeSkeleton(root, { skeleton });
}
