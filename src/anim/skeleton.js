/**
 * UCF Tahap 5 — analisis skeleton untuk animasi & retargeting.
 *
 * Peran tulang (role) ditentukan dari STRUKTUR: hierarki, arah tulang pada rest pose,
 * sisi dunia, kedalaman rantai, dan panjang tulang. Nama tulang tidak dipakai untuk
 * menentukan peran — nama hanya dipakai untuk (a) memberi keyakinan tambahan dan
 * (b) mendeteksi konflik, misalnya model yang menamai sisi +X sebagai "Left" dan
 * model lain menamainya "Right".
 */
import * as THREE from 'three';

const EPS = 1e-9;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function boneChildren(bone, allowed) {
  return bone.children.filter((child) => child.isBone && (!allowed || allowed.has(child)));
}

function subtreeHeight(bone) {
  let highest = -Infinity;
  let lowest = Infinity;
  bone.traverse((object) => {
    if (!object.isBone) return;
    const y = object.getWorldPosition(new THREE.Vector3()).y;
    if (y > highest) highest = y;
    if (y < lowest) lowest = y;
  });
  return { highest, lowest };
}

function normalizeName(name) {
  return String(name || '')
    .replace(/^.*:/, '')
    .replace(/mixamorig/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/** Sinyal nama (hanya untuk pemeriksaan silang, bukan penentu peran). */
export function nameSignals(name) {
  const raw = String(name || '');
  const sideMatch = /(left|right|(^|[^a-z])l($|[^a-z])|(^|[^a-z])r($|[^a-z]))/i.exec(raw.replace(/^.*:/, ''));
  let side = null;
  if (sideMatch) side = /left/i.test(sideMatch[0]) ? 'L' : /right/i.test(sideMatch[0]) ? 'R' : sideMatch[0].replace(/[^a-z]/gi, '').toUpperCase();
  const key = normalizeName(raw);
  let finger = null;
  if (/thumb/.test(key)) finger = 'thumb';
  else if (/index/.test(key)) finger = 'index';
  else if (/middle/.test(key)) finger = 'middle';
  else if (/ring|third/.test(key)) finger = 'ring';
  else if (/pinky|little/.test(key)) finger = 'pinky';
  let part = null;
  if (/thumb/.test(key)) part = 'finger';
  else if (/index|middle|ring|pinky/.test(key)) part = 'finger';
  else if (/forearm|lowerarm/.test(key)) part = 'arm.lower';
  else if (/upperarm|arm$|arm1|arm2/.test(key)) part = 'arm.upper';
  else if (/shoulder|clavicle/.test(key)) part = 'clavicle';
  else if (/hand/.test(key)) part = 'hand';
  else if (/upleg|thigh|upperleg/.test(key)) part = 'leg.upper';
  else if (/leg|calf|shin|lowerleg/.test(key)) part = 'leg.lower';
  else if (/foot|ankle/.test(key)) part = 'foot';
  else if (/toe/.test(key)) part = 'toe';
  else if (/hip|pelvis/.test(key)) part = 'hips';
  else if (/spine|chest|torso/.test(key)) part = 'spine';
  else if (/neck/.test(key)) part = 'neck';
  else if (/head/.test(key)) part = 'head';
  return { side, part, finger, key };
}

function boneDirection(entry) {
  if (entry.children.length > 1 && entry.role === 'hand') {
    // Tulang tangan punya 5 anak (pangkal jari) yang mengipasi; rata-rata arahnya
    // mewakili sumbu tangan jauh lebih baik daripada anak pertama saja.
    const sum = new THREE.Vector3();
    for (const child of entry.children) {
      sum.add(child.getWorldPosition(new THREE.Vector3()).sub(entry.worldPos).normalize());
    }
    if (sum.lengthSq() > 1e-8) return sum.normalize().toArray();
  }
  if (entry.children.length) {
    return entry.children[0].getWorldPosition(new THREE.Vector3()).sub(entry.worldPos).normalize().toArray();
  }
  // tulang daun (ujung jari, ujung kaki): arah diteruskan dari induk, bukan default +Y
  if (entry.parent) {
    const dir = entry.worldPos.clone().sub(entry.parent.getWorldPosition(new THREE.Vector3()));
    if (dir.lengthSq() > 1e-10) return dir.normalize().toArray();
  }
  return [0, 1, 0];
}

function lowestLeaf(bones) {
  let best = null;
  for (const bone of bones) {
    if (bone.children.some((child) => child.isBone)) continue;
    const y = bone.getWorldPosition(new THREE.Vector3()).y;
    if (!best || y < best.y) best = { bone, y };
  }
  return best;
}

function lowestCommonAncestor(a, b) {
  const seen = new Set();
  let node = a;
  while (node) {
    seen.add(node);
    node = node.parent?.isBone ? node.parent : null;
  }
  node = b;
  while (node) {
    if (seen.has(node)) return node;
    node = node.parent?.isBone ? node.parent : null;
  }
  return null;
}

function chainFrom(start, allowed) {
  const chain = [start];
  let current = start;
  for (let guard = 0; guard < 12; guard += 1) {
    const kids = boneChildren(current, allowed);
    if (kids.length !== 1) break;
    current = kids[0];
    chain.push(current);
  }
  return chain;
}

/**
 * @param {THREE.Object3D} root objek yang memuat tulang
 * @param {{skeleton?: THREE.Skeleton}} options
 * @returns {object} deskripsi skeleton
 */
export function analyzeSkeleton(root, { skeleton = null } = {}) {
  if (!root) return null;
  root.updateMatrixWorld(true);

  const bones = skeleton ? [...skeleton.bones] : [];
  if (!bones.length) root.traverse((object) => { if (object.isBone) bones.push(object); });
  if (!bones.length) return null;
  const allowed = new Set(bones);

  const entries = new Map();
  for (const bone of bones) {
    entries.set(bone, {
      bone,
      name: bone.name || '(tanpa nama)',
      parent: bone.parent?.isBone && allowed.has(bone.parent) ? bone.parent : null,
      children: boneChildren(bone, allowed),
      worldPos: bone.getWorldPosition(new THREE.Vector3()),
      worldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
      localQuat: bone.quaternion.clone(),
      localPos: bone.position.clone(),
      role: null,
      side: null,
      index: null,
      depth: 0
    });
  }
  for (const entry of entries.values()) {
    let depth = 0;
    let node = entry.parent;
    while (node) { depth += 1; node = entries.get(node)?.parent || null; }
    entry.depth = depth;
  }

  const ys = [...entries.values()].map((entry) => entry.worldPos.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const height = Math.max(1e-6, maxY - minY);

  // ---- panggul: leluhur bersama dua tulang terendah (kaki kiri & kanan) ----
  const sortedLeaves = [...entries.values()]
    .filter((entry) => entry.children.length === 0)
    .sort((a, b) => a.worldPos.y - b.worldPos.y);
  let hipsBone = null;
  for (let i = 0; i < Math.min(sortedLeaves.length, 4) && !hipsBone; i += 1) {
    for (let j = i + 1; j < Math.min(sortedLeaves.length, 5); j += 1) {
      const a = sortedLeaves[i].bone;
      const b = sortedLeaves[j].bone;
      const lca = lowestCommonAncestor(a, b);
      if (lca && (entries.get(a).worldPos.y < minY + height * 0.2) && (entries.get(b).worldPos.y < minY + height * 0.2)) {
        hipsBone = lca;
        break;
      }
    }
  }
  if (!hipsBone) {
    // fallback: tulang dengan subtree terbesar
    let best = null;
    for (const entry of entries.values()) {
      let size = 0;
      entry.bone.traverse((object) => { if (object.isBone) size += 1; });
      if (!best || size > best.size) best = { bone: entry.bone, size };
    }
    hipsBone = best?.bone || bones[0];
  }
  const hipsEntry = entries.get(hipsBone);
  const hipsPos = hipsEntry.worldPos;
  hipsEntry.role = 'hips';

  const sideOf = (entry) => {
    const dx = entry.worldPos.x - hipsPos.x;
    if (Math.abs(dx) < height * 0.02) return 'C';
    // Konvensi dunia: +X = sisi "R" UCF. Berlaku sama untuk sumber dan target,
    // sehingga animasi tidak tertukar walau nama tulang kedua rig berbeda.
    return dx > 0 ? 'R' : 'L';
  };

  // ---- kaki ----
  const legs = [];
  for (const child of hipsEntry.children) {
    const stats = subtreeHeight(child);
    if (hipsPos.y - stats.lowest < height * 0.3) continue;
    const chain = chainFrom(child, allowed);
    legs.push({ root: child, chain, side: sideOf(entries.get(child)) });
  }
  legs.sort((a, b) => (a.side === 'R' ? -1 : 1) - (b.side === 'R' ? -1 : 1));
  const legRoles = ['leg.upper', 'leg.lower', 'foot', 'toe', 'toe.end'];
  for (const leg of legs) {
    leg.chain.forEach((bone, index) => {
      const entry = entries.get(bone);
      entry.role = legRoles[index] || `leg.extra.${index}`;
      entry.side = leg.side;
      entry.index = index;
    });
  }

  // ---- arah hadap (dari telapak kaki ke ujung kaki) ----
  let facing = 1;
  const toeEntry = [...entries.values()].find((entry) => entry.role === 'toe.end') ||
    [...entries.values()].find((entry) => entry.role === 'toe');
  const footEntry = [...entries.values()].find((entry) => entry.role === 'foot');
  if (toeEntry && footEntry) {
    const dz = toeEntry.worldPos.z - footEntry.worldPos.z;
    if (Math.abs(dz) > height * 0.01) facing = Math.sign(dz);
  }

  // ---- batang tubuh: jalur dari panggul ke titik tertinggi ----
  const trunk = [hipsEntry];
  let cursor = hipsEntry;
  for (let guard = 0; guard < 12; guard += 1) {
    const candidates = cursor.children
      .map((bone) => entries.get(bone))
      .filter((entry) => !entry.role);
    if (!candidates.length) break;
    candidates.sort((a, b) => subtreeHeight(b.bone).highest - subtreeHeight(a.bone).highest);
    cursor = candidates[0];
    trunk.push(cursor);
  }

  const trunkBones = trunk.slice(1);
  let headEntry = null;
  let neckEntry = null;
  if (trunkBones.length) {
    const last = trunkBones[trunkBones.length - 1];
    const isTerminalLeaf = last.children.length === 0;
    // Rantai batang minimal 4 tulang di atas panggul -> tulang terakhir yang berupa
    // daun adalah penanda ujung (HeadTop / HeadTop_End), bukan kepala sebenarnya.
    if (isTerminalLeaf && trunkBones.length >= 4) {
      last.role = 'head.end';
      headEntry = trunkBones[trunkBones.length - 2];
      neckEntry = trunkBones[trunkBones.length - 3] || null;
    } else {
      headEntry = last;
      neckEntry = trunkBones[trunkBones.length - 2] || null;
    }
    if (headEntry) headEntry.role = 'head';
    if (neckEntry && neckEntry !== headEntry) neckEntry.role = 'neck';
  }

  // tulang antara panggul dan leher = rantai tulang belakang, dari bawah ke atas
  const spineEntries = trunkBones.filter((entry) => !entry.role);
  let chestEntry = spineEntries[spineEntries.length - 1] || null;
  if (chestEntry) chestEntry.role = 'chest';
  spineEntries.filter((entry) => entry !== chestEntry).forEach((entry, index) => {
    entry.role = `spine.${index}`;
  });

  // ---- lengan ----
  const armAnchor = chestEntry || neckEntry || hipsEntry;
  const arms = [];
  const probe = new THREE.Vector3();
  for (const child of armAnchor.children) {
    const entry = entries.get(child);
    if (entry.role) continue; // leher/batang
    // Lengan dikenali dari jangkauan horizontal subtree-nya (tulang klavikula bisa
    // berada tepat di poros tubuh, jadi posisi tulang pertama tidak cukup).
    let extremeX = 0;
    child.traverse((object) => {
      if (!object.isBone) return;
      const dx = object.getWorldPosition(probe).x - hipsPos.x;
      if (Math.abs(dx) > Math.abs(extremeX)) extremeX = dx;
    });
    if (Math.abs(extremeX) < height * 0.12) continue;
    const chain = chainFrom(child, allowed);
    arms.push({ root: child, chain, side: extremeX > 0 ? 'R' : 'L', reach: Math.abs(extremeX) });
  }
  arms.sort((a, b) => (a.side === 'R' ? -1 : 1) - (b.side === 'R' ? -1 : 1));

  const fingerChainsOf = (handBone) => {
    const kids = boneChildren(handBone, allowed);
    return kids
      .map((kid) => ({ root: kid, chain: chainFrom(kid, allowed) }))
      .filter((item) => item.chain.length >= 2);
  };

  for (const arm of arms) {
    // tangan = tulang pertama yang punya >=2 rantai anak berkedalaman >=2 (jari),
    // kalau tidak ada jari: tulang ke-4 rantai lengan.
    let handBone = null;
    let handIndex = -1;
    for (let i = 0; i < arm.chain.length; i += 1) {
      if (fingerChainsOf(arm.chain[i]).length >= 2) { handBone = arm.chain[i]; handIndex = i; break; }
    }
    if (!handBone) {
      handIndex = Math.min(3, arm.chain.length - 1);
      handBone = arm.chain[handIndex];
    }
    const armPart = arm.chain.slice(0, handIndex);
    const roles = ['clavicle', 'arm.upper', 'arm.lower'];
    armPart.forEach((bone, index) => {
      const entry = entries.get(bone);
      entry.role = roles[index] || `arm.extra.${index}`;
      entry.side = arm.side;
      entry.index = index;
    });
    const handEntry2 = entries.get(handBone);
    handEntry2.role = 'hand';
    handEntry2.side = arm.side;

    // ---- jari ----
    const chains = fingerChainsOf(handBone);
    if (chains.length >= 2) {
      const handPos = handEntry2.worldPos;
      const dirs = chains.map(({ chain }) => {
        const a = chain[0].getWorldPosition(new THREE.Vector3());
        const b = (chain[1] || chain[0]).getWorldPosition(new THREE.Vector3());
        return b.clone().sub(a).normalize();
      });
      // sumbu sebar: axis dengan varian terbesar antar posisi akar rantai
      const roots = chains.map(({ chain }) => chain[0].getWorldPosition(new THREE.Vector3()).sub(handPos));
      const variance = ['x', 'y', 'z'].map((axis) => {
        const values = roots.map((v) => v[axis]);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return { axis, value: values.reduce((a, b) => a + (b - mean) ** 2, 0) };
      }).sort((a, b) => b.value - a.value)[0].axis;
      // ibu jari = arah akar yang paling menyimpang dari median arah rantai lain
      const avg = dirs.reduce((acc, dir) => acc.add(dir), new THREE.Vector3()).normalize();
      const outliers = chains.map((item, index) => ({ index, angle: dirs[index].angleTo(avg) }));
      outliers.sort((a, b) => b.angle - a.angle);
      const thumbIndex = chains.length >= 5 ? outliers[0].index : -1;
      const others = chains
        .map((item, index) => ({ item, index, along: roots[index][variance] }))
        .filter((item) => item.index !== thumbIndex)
        .sort((a, b) => a.along - b.along);
      // urutan anatomis: jari terdekat ibu jari = telunjuk
      const thumbAlong = thumbIndex >= 0 ? roots[thumbIndex][variance] : others[0].along;
      const ascending = Math.abs(others[0].along - thumbAlong) < Math.abs(others[others.length - 1].along - thumbAlong);
      if (!ascending) others.reverse();
      const fingerNames = ['index', 'middle', 'ring', 'pinky'];
      others.forEach((item, index) => {
        item.item.chain.forEach((bone, joint) => {
          const entry = entries.get(bone);
          entry.role = `finger.${fingerNames[index] || `extra${index}`}.${joint + 1}`;
          entry.side = arm.side;
          entry.index = joint + 1;
        });
      });
      if (thumbIndex >= 0) {
        chains[thumbIndex].chain.forEach((bone, joint) => {
          const entry = entries.get(bone);
          entry.role = `finger.thumb.${joint + 1}`;
          entry.side = arm.side;
          entry.index = joint + 1;
        });
      }
      // Kalau nama tulang menyebut jari secara eksplisit (Index/Middle/Ring/Pinky/Thumb),
      // nama itu dipakai sebagai bukti tambahan untuk membetulkan urutan hasil geometri.
      for (const { chain } of chains) {
        const token = chain.map((bone) => nameSignals(entries.get(bone).name).finger).find(Boolean);
        if (!token) continue;
        chain.forEach((bone, joint) => {
          const entry = entries.get(bone);
          if (!String(entry.role || '').startsWith('finger.')) return;
          entry.role = `finger.${token}.${joint + 1}`;
        });
      }
    }
  }

  // ---- sisi dunia untuk tulang pusat & konvensi arah hadap ----
  for (const entry of entries.values()) {
    if (!entry.side) entry.side = sideOf(entry);
    entry.facing = facing;
  }

  const list = [...entries.values()].map((entry) => ({
    name: entry.name,
    role: entry.role,
    side: entry.side,
    index: entry.index,
    depth: entry.depth,
    parent: entry.parent?.name || null,
    children: entry.children.length,
    worldPos: entry.worldPos.toArray(),
    worldQuat: entry.worldQuat.toArray(),
    direction: boneDirection(entry),
    length: entry.children.length
      ? entry.worldPos.distanceTo(entry.children[0].getWorldPosition(new THREE.Vector3()))
      : 0
  }));

  const byName = new Map(list.map((entry) => [entry.name, entry]));
  const roleCount = list.filter((entry) => entry.role).length;

  return {
    root,
    bones: list,
    entries,
    byName,
    hips: hipsBone.name,
    hipsPosition: hipsPos.toArray(),
    height,
    facing,
    roleCount,
    coverage: roleCount / Math.max(1, list.length),
    unmapped: list.filter((entry) => !entry.role).map((entry) => entry.name),
    // untuk retargeting: objek THREE asli
    objects: new Map([...entries.entries()].map(([bone, entry]) => [entry.name, { bone, entry }]))
  };
}

export { normalizeName };
