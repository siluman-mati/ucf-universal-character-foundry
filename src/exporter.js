/**
 * Tahap 7 — Ekspor GLB + verifikasi round-trip.
 * GLTFExporter dimuat malas (lazy) supaya bundel utama tidak membengkak.
 * Jangan klaim round-trip sempurna bila angka impor ulang berbeda.
 */
export async function exportGLB(object, { binary = true, animations = [] } = {}) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();
  // onlyVisible:false — kita sudah filter invisible modul di buildExportClone, jadi tidak menggandakan filter GLTFExporter
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else if (result instanceof Uint8Array) resolve(result.buffer);
        else reject(new Error('Exporter tidak menghasilkan ArrayBuffer'));
      },
      (err) => reject(err),
      { binary, animations, trs: false, onlyVisible: false, binarySpeed: 0 }
    );
  });
  return glb;
}

export async function importGLB(buffer, fileName = 'reimport.glb') {
  const { importModelFile } = await import('./importer.js');
  const file = new File([buffer], fileName, { type: 'model/gltf-binary' });
  return importModelFile(file);
}

export function bytesToBlobUrl(buffer, mime = 'model/gltf-binary') {
  const blob = new Blob([buffer], { type: mime });
  return URL.createObjectURL(blob);
}
