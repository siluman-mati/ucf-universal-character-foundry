/**
 * UCF Image-to-3D — Rig Adapter
 * Mencoba memasang skeleton UCF (51 tulang) ke mesh hasil generasi.
 * Jujur: ekstrusi siluet = geometri tipis datar → skinning terbatas.
 * Adapter menghitung bobot kulit sederhana berbasis jarak ke tulang.
 */
import * as THREE from 'three';
import { buildHumanoid } from '../humanoid/builder.js'; // untuk dapat template rig, tapi kita tidak pakai mesh-nya

// WeakMap untuk menyimpan rig tanpa sirkular di userData
const rigStore = new WeakMap();
export function getImageRig(group) {
  return rigStore.get(group) || null;
}

/**
 * Buat skeleton standar lalu fit ke bbox mesh
 * @param {THREE.Mesh} mesh - mesh hasil image-to-3D (sudah di group)
 * @param {object} opts
 */
export async function autoRigImageMesh(mesh, opts = {}) {
  // Buat humanoid template tersembunyi untuk dapat rig referensi
  // Kita pakai tinggi yang sama dengan mesh
  const targetHeight = opts.targetHeight ?? 1.7;
  let template = null;
  let rig = null;
  try {
    const res = buildHumanoid({ height: targetHeight }, 'T');
    template = res; // { content, rig, params, metrics }
    rig = res.rig;
  } catch (e) {
    return { ok: false, reason: `Gagal buat rig template: ${e.message} — ${e.stack?.slice(0,500)}`, code: 'rig-template-fail' };
  }
  if (!rig || !rig.list || !rig.list.length) {
    return { ok: false, reason: 'Rig template tidak menghasilkan tulang', code: 'no-bones' };
  }

  // Posisikan rig agar pusatnya di tengah mesh
  mesh.geometry.computeBoundingBox();
  const bbox = mesh.geometry.boundingBox.clone();
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  // Rig root default di 0,0,0 dengan kaki di y=0 — cocok dengan mesh yang sudah kaki di 0
  // Kita tidak perlu pindah banyak, hanya pastikan skala cocok

  // Buat skeleton untuk mesh: clone tulang dan buat Skeleton baru
  // rig.root memiliki userData.ucfRig sirkular (buildHumanoid sengaja) — kosongkan dulu agar clone tidak JSON.stringify sirkular
  const savedRig = rig.root.userData.ucfRig;
  const savedExtras = [];
  rig.root.traverse(o=>{ if(o.userData?.ucfRig) savedExtras.push([o, o.userData.ucfRig]); });
  rig.root.userData.ucfRig = undefined;
  for (const [o] of savedExtras) o.userData.ucfRig = undefined;
  let rigRoot;
  try {
    rigRoot = rig.root.clone(true);
  } finally {
    rig.root.userData.ucfRig = savedRig;
    for (const [o, v] of savedExtras) o.userData.ucfRig = v;
  }
  // Kumpulkan bones clone
  const boneByName = new Map();
  rigRoot.traverse(o => { if (o.isBone) boneByName.set(o.name, o); });
  // Cek bones penting ada
  const essential = ['Hips','Spine','Chest','Head','UpperArm_L','UpperArm_R','UpperLeg_L','UpperLeg_R'];
  const missing = essential.filter(n => !boneByName.has(n));
  if (missing.length) {
    // tetap lanjut tapi warning
  }

  // Buat skeleton
  const bones = [];
  rigRoot.traverse(o => { if (o.isBone) bones.push(o); });
  // Urutan harus sama dengan bind pose inverse — kita pakai template boneInverses scaled
  // Untuk sederhana, hitung boneInverses dari world matrix saat ini
  const boneInverses = bones.map(b => {
    b.updateMatrixWorld(true);
    return b.matrixWorld.clone().invert();
  });
  const skeleton = new THREE.Skeleton(bones, boneInverses);

  // Attach skeleton ke mesh
  // Mesh sebelumnya bukan SkinnedMesh — kita perlu konversi
  // Buat SkinnedMesh baru dengan geometri yang sama
  const geom = mesh.geometry; // BufferGeometry
  // Hitung skinIndex/skinWeight per verteks via nearest bone
  const posAttr = geom.attributes.position;
  const vertexCount = posAttr.count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  // Untuk setiap verteks, cari 4 tulang terdekat (jarak Euclidean ke segmen tulang)
  // Sederhana: jarak ke posisi tulang (joint), bukan segmen — cukup untuk demo
  // Gunakan posisi tulang di world (sebelum bind)
  const bonePositions = bones.map(b => {
    const p = new THREE.Vector3();
    b.getWorldPosition(p);
    return p;
  });
  // Optimasi: mesh.position sudah offset; bone di root (0,0,0) → perlu world mesh
  // Kita hitung vertex world = mesh.matrixWorld * localPos
  mesh.updateMatrixWorld(true);
  const mWorld = mesh.matrixWorld.clone();
  const tmpPos = new THREE.Vector3();

  for (let i = 0; i < vertexCount; i++) {
    tmpPos.fromBufferAttribute(posAttr, i).applyMatrix4(mWorld);
    // cari tulang terdekat
    let best = [];
    for (let bi = 0; bi < bones.length; bi++) {
      const d = tmpPos.distanceTo(bonePositions[bi]);
      best.push({ bi, d });
    }
    best.sort((a,b) => a.d - b.d);
    // ambil 4 terdekat, bobot invers jarak
    const top = best.slice(0,4);
    let sumW = 0;
    for (const t of top) sumW += 1 / (t.d + 0.08); // epsilon agar tidak inf
    for (let k = 0; k < 4; k++) {
      if (k < top.length) {
        skinIndices[i*4+k] = top[k].bi;
        skinWeights[i*4+k] = (1/(top[k].d + 0.08)) / sumW;
      } else {
        skinIndices[i*4+k] = 0;
        skinWeights[i*4+k] = 0;
      }
    }
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const skinned = new THREE.SkinnedMesh(geom, mesh.material.clone());
  skinned.name = mesh.name + '_Rigged';
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.add(rigRoot);
  skinned.bind(skeleton, skinned.matrixWorld); // bind pose

  // Ganti mesh lama dengan skinned di parent group
  const parent = mesh.parent;
  if (parent) {
    parent.remove(mesh);
    parent.add(skinned);
    // Simpan rig di WeakMap (bukan userData) agar tidak sirkular saat JSON.stringify
    const rigData = { root: rigRoot, bones: boneByName, list: bones, skeleton, skinned };
    rigStore.set(parent, rigData);
    // Simpan juga di skinned untuk lookup
    rigStore.set(skinned, rigData);
    // userData hanya flag ringan
    parent.userData.isRigged = true;
    parent.userData.ucfRigSimple = { boneCount: bones.length, fingerBones: bones.filter(b=>/Finger|Thumb/.test(b.name)).length };
    skinned.userData.ucfRigRef = true;
  }

  // Jangan dispose template — biarkan GC
  // dispose template root bukan rigRoot clone, tapi group content
  // (tidak perlu, GC)

  // Uji deformasi via captureWorldPositions (benar untuk SkinnedMesh)
  let deformOk = false, disp = 0, moved = 0;
  try {
    const { measureDeformation } = await import('../humanoid/rig.js');
    // parent adalah Group yang berisi skinned + rigRoot → jadi root untuk capture
    const fakeRig = { root: parent, bones: boneByName, list: bones, stats: { vertices: vertexCount } };
    const testBoneName = boneByName.has('UpperArm_L') ? 'UpperArm_L' : boneByName.has('Hips') ? 'Hips' : bones[0]?.name;
    const res = measureDeformation(fakeRig, { boneName: testBoneName, axis: 'z', angleDeg: 30 });
    if (res?.ok) {
      disp = res.maxDisplacement;
      moved = res.movedVertices;
      deformOk = disp > 0.005 && moved > 5;
    }
  } catch(e) {
    // fallback: Box3 (tidak akurat untuk SkinnedMesh, tapi jangan gagal)
    const testBone = boneByName.get('UpperArm_L') || boneByName.get('Hips');
    if (testBone) {
      const orig = skinned.skeleton.bones.find(b=>b.name===testBone.name);
      if (orig) {
        const saveQ = orig.quaternion.clone();
        orig.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1), THREE.MathUtils.degToRad(30));
        orig.updateMatrixWorld(true);
        const before = new THREE.Box3().setFromObject(skinned);
        skinned.updateMatrixWorld(true);
        const after = new THREE.Box3().setFromObject(skinned);
        disp = before.getCenter(new THREE.Vector3()).distanceTo(after.getCenter(new THREE.Vector3()));
        deformOk = disp > 0.001;
        orig.quaternion.copy(saveQ);
        orig.updateMatrixWorld(true);
      }
    }
  }

  return {
    ok: true,
    skinned,
    skeleton,
    boneCount: bones.length,
    fingerBones: bones.filter(b=>/Finger|Thumb/.test(b.name)).length,
    testDeform: { ok: deformOk, disp },
    rigRoot,
    warnings: [
      'Skin weights berbasis jarak — bukan painting manual. Deformasi akan kasar, terutama di pangkal lengan/kaki.',
      'Mesh ekstrusi tipis — jari tidak terpisah, sehingga tulang jari hanya menggerakkan sebagian kecil siluet.',
      disp < 0.002 ? 'Deformasi terdeteksi kecil — mesh mungkin terlalu kaku/kecil untuk rig ini.' : null
    ].filter(Boolean)
  };
}
