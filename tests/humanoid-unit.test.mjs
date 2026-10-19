/**
 * UCF Tahap 2 — tes unit humanoid prosedural (tanpa browser).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  PARAM_DEFS,
  PARAM_GROUPS,
  defaultParams,
  clampParam,
  sanitizeParams,
  NOMINAL_HEIGHT,
  POSE_IDS,
  activeParamDefs
} from '../src/humanoid/params.js';
import { buildHumanoid, measureHumanoid, POSE_ANGLES } from '../src/humanoid/builder.js';
import { objectSignature, fnv1aFromBytes } from '../src/humanoid/signature.js';
import { exportConfig, parseConfig, characterToConfig, CONFIG_FORMAT } from '../src/humanoid/config.js';

const DEFAULTS = defaultParams();

function build(params = {}, pose = 'T') {
  return buildHumanoid(params, pose);
}

test('parameter: 35 parameter dalam 6 grup, semua default berada di rentang', () => {
  assert.equal(PARAM_GROUPS.length, 6);
  assert.equal(PARAM_DEFS.length, 35);
  for (const def of PARAM_DEFS) {
    assert.ok(def.default >= def.min && def.default <= def.max, `${def.key} default di luar rentang`);
    assert.ok(def.max > def.min, `${def.key} rentang tidak valid`);
    assert.equal(typeof def.label, 'string');
  }
  assert.equal(activeParamDefs(1).length, 21);
  assert.equal(activeParamDefs(2).length, 35);
  assert.equal(POSE_IDS.length, 3);
});

test('builder default: geometri nyata, kaki di lantai, tinggi ±1,75 m', () => {
  const { content, params, pose, metrics } = build();
  const measured = measureHumanoid(content);
  const signature = objectSignature(content);

  assert.equal(pose, 'T');
  assert.equal(Object.keys(params).length, 35);
  assert.ok(signature.parts >= 50, `mesh hanya ${signature.parts}`);
  assert.ok(signature.vertices > 1500, `verteks hanya ${signature.vertices}`);
  assert.ok(signature.triangles > 2000, `segitiga hanya ${signature.triangles}`);
  assert.equal(signature.materials, 4);
  assert.ok(Math.abs(measured.size[1] - 1.75) < 0.01, `tinggi ${measured.size[1]}`);
  assert.ok(Math.abs(measured.min[1]) < 1e-4, `minY ${measured.min[1]}`);
  assert.ok(Math.abs(measured.size[1] - metrics.actualHeight) < 1e-4);
  assert.ok(measured.max[2] > 0.1, 'telapak kaki harus menjulur ke +Z');
  assert.ok(measured.max[2] > Math.abs(measured.min[2]), 'arah hadap +Z');
  assert.ok(measured.size[0] > 1.5, `bentang lengan T-pose ${measured.size[0]}`);
});

test('builder deterministik: parameter sama → geometri & transform identik', () => {
  const a = build();
  const b = build();
  const sa = objectSignature(a.content);
  const sb = objectSignature(b.content);
  assert.equal(sa.geometryHash, sb.geometryHash);
  assert.equal(sa.worldHash, sb.worldHash);
  assert.deepEqual(sa.size, sb.size);
});

test('setiap parameter mengubah geometri 3D nyata', () => {
  const baseline = build();
  const baselineSignature = objectSignature(baseline.content);
  const failures = [];

  for (const def of PARAM_DEFS) {
    const target = def.default < def.max - def.step
      ? def.default + (def.max - def.default) * 0.5
      : def.default - (def.default - def.min) * 0.5;
    const changed = build({ [def.key]: target });
    const signature = objectSignature(changed.content);
    const geoDiff = signature.geometryHash !== baselineSignature.geometryHash;
    const worldDiff = signature.worldHash !== baselineSignature.worldHash;
    if (!geoDiff && !worldDiff) failures.push(`${def.key} (${def.default} → ${target})`);
  }

  assert.deepEqual(failures, [], `parameter tidak mengubah geometri: ${failures.join(', ')}`);
});

test('parameter ekstrem tetap menghasilkan geometri valid', () => {
  for (const def of PARAM_DEFS) {
    for (const value of [def.min, def.max]) {
      const { content } = build({ [def.key]: value });
      const measured = measureHumanoid(content);
      for (const size of measured.size) assert.ok(Number.isFinite(size) && size > 0, `${def.key}=${value} menghasilkan ukuran ${size}`);
      assert.ok(Math.abs(measured.min[1]) < 1e-3, `${def.key}=${value} kaki tidak di lantai (${measured.min[1]})`);
    }
  }
});

test('pose T/A/netral mengubah posisi dunia dan tinggi tangan', () => {
  const results = {};
  for (const pose of POSE_IDS) {
    const { content } = build({}, pose);
    const hand = content.getObjectByName('Hand_R');
    const world = hand.getWorldPosition(new THREE.Vector3());
    results[pose] = {
      signature: objectSignature(content),
      handY: world.y,
      width: measureHumanoid(content).size[0]
    };
  }
  assert.notEqual(results.T.signature.worldHash, results.A.signature.worldHash);
  assert.notEqual(results.A.signature.worldHash, results.netral.signature.worldHash);
  assert.ok(results.T.width > results.A.width, 'bentang T > A');
  assert.ok(results.A.width > results.netral.width, 'bentang A > netral');
  assert.ok(results.T.handY > results.netral.handY + 0.3, `tangan T ${results.T.handY} vs netral ${results.netral.handY}`);
  assert.ok(POSE_ANGLES.T.shoulder === 90 && POSE_ANGLES.netral.shoulder < 20);
});

test('tangan punya lima jari; parameter jari mengubah mesh', () => {
  const { content } = build();
  const names = [];
  content.traverse((object) => { if (object.name) names.push(object.name); });
  for (const side of ['R', 'L']) {
    assert.ok(names.includes(`Thumb_${side}_1`), `tulang ibu jari ${side} tidak ada`);
    assert.ok(names.includes(`Thumb_${side}_2`), `ruas ke-2 ibu jari ${side} tidak ada`);
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      assert.ok(names.includes(`Finger_${finger}_${side}_1`), `jari ${finger} ${side} tidak ada`);
      assert.ok(names.includes(`Finger_${finger}_${side}_2`), `ruas ke-2 ${finger} ${side} tidak ada`);
      assert.ok(names.includes(`Finger_${finger}_${side}_3`), `ruas ke-3 ${finger} ${side} tidak ada`);
    }
  }
  const before = objectSignature(content).geometryHash;
  const after = objectSignature(build({ fingerMiddle: 0.13 }).content).geometryHash;
  assert.notEqual(before, after);
});

test('sidik jari: posisi root mengubah worldHash tetapi bukan geometryHash', () => {
  const a = build();
  const b = build();
  b.content.position.x = 2.5;
  b.content.updateMatrixWorld(true);
  const sa = objectSignature(a.content);
  const sb = objectSignature(b.content);
  assert.equal(sa.geometryHash, sb.geometryHash);
  assert.notEqual(sa.worldHash, sb.worldHash);
});

test('sanitizeParams: clamp, buang kunci asing, catat peringatan', () => {
  const { params, warnings } = sanitizeParams({ height: 99, headWidth: -1, tidakAda: 5 });
  assert.equal(params.height, 2.1);
  assert.equal(params.headWidth, 0.11);
  assert.equal(params.tidakAda, undefined);
  assert.ok(warnings.length >= 3);
  assert.equal(clampParam('torsoLength', '0.4'), 0.4);
  assert.equal(clampParam('torsoLength', 'bukan angka'), DEFAULTS.torsoLength);
  assert.equal(clampParam('tidakAda', 1), null);
});

test('config: ekspor → parse mengembalikan parameter, pose, transform sama', () => {
  const { content, params } = build({ height: 1.9, headWidth: 0.17 }, 'A');
  const model = { root: new THREE.Group() };
  model.root.position.set(1.5, 0, -2);
  model.root.rotation.y = 0.4;
  const entry = { id: 'char-7', name: 'Uji Karakter', pose: 'A', params };
  const config = exportConfig([characterToConfig(entry, model)]);
  assert.equal(config.format, CONFIG_FORMAT);
  assert.equal(config.stage, 2);

  const parsed = parseConfig(JSON.stringify(config));
  assert.equal(parsed.characters.length, 1);
  const character = parsed.characters[0];
  assert.equal(character.name, 'Uji Karakter');
  assert.equal(character.pose, 'A');
  assert.equal(character.params.height, 1.9);
  assert.equal(character.params.headWidth, 0.17);
  assert.deepEqual(character.transform.position, [1.5, 0, -2]);
  assert.ok(Math.abs(character.transform.rotationY - 0.4) < 1e-9);

  const rebuilt = build(character.params, character.pose);
  assert.equal(objectSignature(rebuilt.content).geometryHash, objectSignature(content).geometryHash);
});

test('config: menolak format salah dan memperingatkan nilai aneh', () => {
  assert.throws(() => parseConfig('{"format":"lain"}'), /tidak dikenal/);
  assert.throws(() => parseConfig('{bukan json'), /JSON tidak valid/);
  assert.throws(() => parseConfig('{"format":"ucf-character-config"}'), /characters/);

  const parsed = parseConfig(JSON.stringify({
    format: CONFIG_FORMAT,
    version: '0.9',
    characters: [{ name: '  ', pose: 'X', params: { height: 99, foo: 1 }, transform: { position: [0, 0] } }]
  }));
  assert.equal(parsed.characters[0].name, 'Humanoid 1');
  assert.equal(parsed.characters[0].pose, 'T');
  assert.equal(parsed.characters[0].params.height, 2.1);
  assert.deepEqual(parsed.characters[0].transform.position, [0, 0, 0]);
  assert.ok(parsed.warnings.length >= 4, JSON.stringify(parsed.warnings));
});

test('fnv1a konsisten', () => {
  const bytes = new TextEncoder().encode('ucf');
  assert.equal(fnv1aFromBytes(bytes), fnv1aFromBytes(bytes));
  assert.notEqual(fnv1aFromBytes(bytes), fnv1aFromBytes(new TextEncoder().encode('ucg')));
  assert.equal(NOMINAL_HEIGHT, 1.725);
});
