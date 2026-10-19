/**
 * UCF Tahap 4 — katalog modul bawaan (prosedural, dibuat kode UCF sendiri).
 *
 * Semua modul lolos validateModuleManifest() dan diperiksa ulang oleh
 * compat.js setiap kali dipasang. Tidak ada aset pihak ketiga yang
 * didistribusikan di sini.
 */
import { ORIENTATION, SKELETON_ID, BODY_PROFILE_ID, VALIDATION_STATUS, validateModuleManifest } from './metadata.js';

const LICENSE = 'Milik proyek UCF (UNLICENSED) — geometri dihasilkan kode sendiri';

const BODY_BONES = ['Hips', 'Spine', 'Chest', 'Neck'];
const ARM_R = ['Chest', 'UpperArm_R', 'LowerArm_R'];
const ARM_L = ['Chest', 'UpperArm_L', 'LowerArm_L'];
const LEG_R = ['Hips', 'UpperLeg_R', 'LowerLeg_R', 'Foot_R'];
const LEG_L = ['Hips', 'UpperLeg_L', 'LowerLeg_L', 'Foot_L'];

function definition(entry) {
  return {
    moduleVersion: '1.0.0',
    sourceFile: `procedural://ucf/${entry.generator}`,
    sourceFormat: 'procedural',
    sourceLicense: LICENSE,
    scale: 1,
    orientation: ORIENTATION,
    supportedSkeleton: SKELETON_ID,
    textureList: [],
    compatibleBodyProfiles: [BODY_PROFILE_ID],
    validationStatus: VALIDATION_STATUS.VALID,
    imported: false,
    ...entry
  };
}

export const BUILTIN_MODULES = [
  /* ---------------- A. BODY ---------------- */
  definition({
    moduleId: 'base-body-ucf',
    moduleName: 'Base Body UCF',
    category: 'body',
    attachmentType: 'base',
    attachmentPoint: 'Root (seluruh karakter)',
    bodyRegion: 'full body',
    requiredBones: ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head'],
    materialList: ['Kulit', 'Kaos', 'Celana', 'Sepatu'],
    generator: 'base_body',
    knownLimitations: [
      'Base body dibangun oleh builder humanoid dan selalu terpasang; tidak dapat dilepas.',
      'Topology hasil prosedur, bukan topology siap produksi.'
    ]
  }),

  /* ---------------- B. SKIN / MATERIAL ---------------- */
  definition({
    moduleId: 'skin-cerah',
    moduleName: 'Kulit Cerah',
    category: 'skin',
    attachmentType: 'material',
    attachmentPoint: 'Material Kulit',
    bodyRegion: 'seluruh kulit',
    requiredBones: ['Hips'],
    materialList: ['Kulit'],
    generator: 'material_skin',
    options: { color: '#f0c6a4', baseColor: '#d9a17d', roughness: 0.8, metalness: 0 },
    knownLimitations: ['Hanya mengganti warna/roughness material Kulit; tidak mengubah geometri.']
  }),
  definition({
    moduleId: 'skin-gelap',
    moduleName: 'Kulit Gelap',
    category: 'skin',
    attachmentType: 'material',
    attachmentPoint: 'Material Kulit',
    bodyRegion: 'seluruh kulit',
    requiredBones: ['Hips'],
    materialList: ['Kulit'],
    generator: 'material_skin',
    options: { color: '#8a5a3c', baseColor: '#d9a17d', roughness: 0.84, metalness: 0 },
    knownLimitations: ['Hanya mengganti warna/roughness material Kulit; tidak mengubah geometri.']
  }),
  definition({
    moduleId: 'skin-matte',
    moduleName: 'Kulit Matte',
    category: 'skin',
    attachmentType: 'material',
    attachmentPoint: 'Material Kulit',
    bodyRegion: 'seluruh kulit',
    requiredBones: ['Hips'],
    materialList: ['Kulit'],
    generator: 'material_skin',
    options: { color: '#d9a17d', baseColor: '#d9a17d', roughness: 1, metalness: 0 },
    knownLimitations: ['Hanya mengubah nilai roughness material Kulit.']
  }),

  /* ---------------- C. FACE ---------------- */
  definition({
    moduleId: 'wajah-dasar',
    moduleName: 'Wajah Dasar (mata, alis, hidung, mulut)',
    category: 'face',
    attachmentType: 'bone',
    attachmentPoint: 'Head',
    bodyRegion: 'kepala',
    requiredBones: ['Head'],
    materialList: ['Wajah Kulit', 'Mata Putih', 'Mata Gelap', 'Alis'],
    generator: 'face_basic',
    validationStatus: 'NEEDS VALIDATION',
    knownLimitations: [
      'Clipping tidak dapat diverifikasi: modul wajah hanya mengganti material/menambah geometri tipis tanpa uji penetrasi penuh.',
      'Mata, hidung, dan mulut adalah primitif sederhana yang sengaja tertanam di kepala.',
      'Bukan rig wajah: tidak ada morph target, kelopak mata, atau ekspresi.'
    ]
  }),

  /* ---------------- D. HAIR ---------------- */
  definition({
    moduleId: 'rambut-pendek',
    moduleName: 'Rambut Pendek',
    category: 'hair',
    attachmentType: 'bone',
    attachmentPoint: 'Head',
    bodyRegion: 'kepala',
    requiredBones: ['Head'],
    materialList: ['Rambut Pendek'],
    generator: 'hair_short',
    options: { color: '#2a211b' },
    knownLimitations: ['Rambut kaku mengikuti tulang Head; tidak ada simulasi rambut.']
  }),
  definition({
    moduleId: 'rambut-panjang',
    moduleName: 'Rambut Panjang',
    category: 'hair',
    attachmentType: 'bone',
    attachmentPoint: 'Head',
    bodyRegion: 'kepala & leher',
    requiredBones: ['Head'],
    materialList: ['Rambut Panjang'],
    generator: 'hair_long',
    options: { color: '#3a2a20' },
    knownLimitations: [
      'Rambut kaku mengikuti tulang Head; tidak ada simulasi atau tabrakan dengan badan.',
      'Bagian belakang bisa menembus atasan saat kepala berputar jauh.'
    ]
  }),

  /* ---------------- E. TOPS ---------------- */
  definition({
    moduleId: 'kaos-lengan-pendek',
    moduleName: 'Kaos Lengan Pendek',
    category: 'tops',
    attachmentType: 'skinned',
    attachmentPoint: 'Hips→Neck + UpperArm (lengan)',
    bodyRegion: 'torso & lengan atas',
    requiredBones: [...BODY_BONES, ...ARM_R, ...ARM_L],
    materialList: ['Kaos Modul'],
    generator: 'top_tee',
    options: { fit: 1.07, sleeve: 0.42, color: '#2f6f9f', roughness: 0.95 },
    knownLimitations: [
      'Bukan simulasi kain: tidak ada lipatan dinamis atau tabrakan kain.',
      'Dibangun dari parameter tubuh saat ini; tidak menyimpan bentuk badan lain.'
    ]
  }),
  definition({
    moduleId: 'jaket-lengan-panjang',
    moduleName: 'Jaket Lengan Panjang',
    category: 'tops',
    attachmentType: 'skinned',
    attachmentPoint: 'Hips→Neck + lengan sampai pergelangan',
    bodyRegion: 'torso & lengan',
    requiredBones: [...BODY_BONES, ...ARM_R, ...ARM_L, 'Hand_R', 'Hand_L'],
    materialList: ['Jaket Modul', 'Jaket Trim'],
    generator: 'top_jacket',
    options: { fit: 1.1, color: '#3b4450', roughness: 0.85 },
    knownLimitations: ['Bukan simulasi kain; lengan jaket kaku mengikuti dua ruas tulang lengan.']
  }),

  /* ---------------- F. BOTTOMS ---------------- */
  definition({
    moduleId: 'celana-panjang',
    moduleName: 'Celana Panjang',
    category: 'bottoms',
    attachmentType: 'skinned',
    attachmentPoint: 'Hips + UpperLeg→Foot',
    bodyRegion: 'kaki',
    requiredBones: ['Hips', ...LEG_R, ...LEG_L],
    materialList: ['Celana Modul'],
    generator: 'bottom_pants',
    options: { fit: 1.12, color: '#27313f', roughness: 0.95 },
    knownLimitations: ['Bukan simulasi kain; celana mengikuti tulang kaki tanpa lipatan.']
  }),
  definition({
    moduleId: 'rok-sebatas-lutut',
    moduleName: 'Rok Sebatas Lutut',
    category: 'bottoms',
    attachmentType: 'skinned',
    attachmentPoint: 'Hips + Spine',
    bodyRegion: 'pinggul',
    requiredBones: ['Hips', 'Spine'],
    materialList: ['Rok Modul'],
    generator: 'bottom_skirt',
    options: { fit: 1.1, length: 0.42, color: '#5a3f57', roughness: 0.94 },
    knownLimitations: [
      'Rok terikat pada Hips/Spine sehingga tidak mengikuti gerak kaki.',
      'Tidak ada simulasi kain: kaki bisa menembus rok saat berpose ekstrem.'
    ]
  }),

  /* ---------------- G. SHOES ---------------- */
  definition({
    moduleId: 'sepatu-boot',
    moduleName: 'Sepatu Boot',
    category: 'shoes',
    attachmentType: 'bone',
    attachmentPoint: 'Foot_R / Foot_L',
    bodyRegion: 'telapak kaki',
    requiredBones: ['Foot_R', 'Foot_L'],
    materialList: ['Boot Kulit', 'Boot Sol'],
    generator: 'shoes_boot',
    options: { shaft: 0.17, color: '#2b3442', roughness: 0.7 },
    knownLimitations: ['Kaku mengikuti tulang Foot; tidak ada deformasi sol.']
  }),
  definition({
    moduleId: 'sandal-jepit',
    moduleName: 'Sandal Jepit',
    category: 'shoes',
    attachmentType: 'bone',
    attachmentPoint: 'Foot_R / Foot_L',
    bodyRegion: 'telapak kaki',
    requiredBones: ['Foot_R', 'Foot_L'],
    materialList: ['Sandal Sol', 'Sandal Strap'],
    generator: 'shoes_sandal',
    options: { color: '#6b4a33' },
    knownLimitations: ['Kaku mengikuti tulang Foot; bentuk sederhana tanpa tali detail.']
  }),

  /* ---------------- H. ACCESSORIES ---------------- */
  definition({
    moduleId: 'topi-fedora',
    moduleName: 'Topi Fedora',
    category: 'accessories',
    attachmentType: 'bone',
    attachmentPoint: 'Head',
    bodyRegion: 'kepala',
    requiredBones: ['Head'],
    materialList: ['Topi Bahan', 'Topi Pita'],
    generator: 'hat',
    options: { color: '#5b4a3a' },
    knownLimitations: ['Kaku mengikuti tulang Head; tidak menyesuaikan bentuk rambut di bawahnya.']
  }),
  definition({
    moduleId: 'kacamata-bulat',
    moduleName: 'Kacamata Bulat',
    category: 'accessories',
    attachmentType: 'bone',
    attachmentPoint: 'Head',
    bodyRegion: 'kepala',
    requiredBones: ['Head'],
    materialList: ['Kacamata Rangka', 'Kacamata Lensa'],
    generator: 'glasses',
    options: { color: '#1b1f26' },
    knownLimitations: ['Lensa transparan tanpa pembiasan; posisi mengikuti tulang Head.']
  }),
  definition({
    moduleId: 'sabuk-kulit',
    moduleName: 'Sabuk Kulit',
    category: 'accessories',
    attachmentType: 'bone',
    attachmentPoint: 'Hips',
    bodyRegion: 'pinggang',
    requiredBones: ['Hips'],
    materialList: ['Sabuk Kulit', 'Sabuk Gesper'],
    generator: 'belt',
    options: { color: '#38291f' },
    knownLimitations: ['Mengikuti tulang Hips; tidak menyesuaikan pakaian di bawahnya.']
  }),
  definition({
    moduleId: 'sarung-tangan',
    moduleName: 'Sarung Tangan',
    category: 'accessories',
    attachmentType: 'bone',
    attachmentPoint: 'Hand_R / Hand_L',
    bodyRegion: 'tangan',
    requiredBones: ['Hand_R', 'Hand_L'],
    materialList: ['Sarung Tangan', 'Sarung Tangan Manset'],
    generator: 'gloves',
    options: { color: '#20252c' },
    knownLimitations: ['Menutup telapak saja; jari tetap memakai material kulit badan.']
  }),
  definition({
    moduleId: 'tas-punggung',
    moduleName: 'Tas Punggung',
    category: 'accessories',
    attachmentType: 'static',
    attachmentPoint: 'Titik tetap di punggung (ruang karakter)',
    bodyRegion: 'punggung',
    requiredBones: ['Root'],
    materialList: ['Tas Bahan', 'Tas Tali'],
    generator: 'backpack',
    options: { color: '#4a3b2d' },
    knownLimitations: [
      'Static attachment: mengikuti transform karakter, bukan gerak tulang punggung.',
      'Tidak ada simulasi kain atau tali.'
    ]
  })
];

/** Validasi seluruh katalog; mengembalikan {modules, rejected}. */
export function createCatalog() {
  const modules = [];
  const rejected = [];
  for (const raw of BUILTIN_MODULES) {
    const result = validateModuleManifest(raw);
    if (result.ok) modules.push(result.module);
    else rejected.push({ moduleId: raw?.moduleId || '(tanpa id)', errors: result.errors });
  }
  return { modules, rejected };
}
