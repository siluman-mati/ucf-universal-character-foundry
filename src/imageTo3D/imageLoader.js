/**
 * UCF Image-to-3D — loader gambar referensi (Langkah 3)
 * Memisahkan impor gambar dari impor model 3D.
 * Tidak mengklaim humanoid prosedural sebagai rekonstruksi.
 */

/**
 * Buat ImageBitmap/Canvas dari File gambar.
 * @param {File} file
 * @returns {Promise<{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width:number, height:number, fileName:string}>}
 */
export async function loadImageToCanvas(file) {
  if (!file || !/^image\//.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error(`Bukan berkas gambar: ${file?.name || 'tanpa nama'}`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error('Gambar tidak terbaca (0×0)');
    // Batasi sisi panjang 1024 untuk hemat RAM (dataset 1536×1024 masih oke)
    const maxSide = 1024;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D tidak didukung');
    // Putih sebagai latar untuk JPG transparan handling
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, width: w, height: h, fileName: file.name, originalWidth: width, originalHeight: height, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    // tidak set crossOrigin untuk objectURL
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar — berkas rusak atau format tidak didukung'));
    img.src = src;
  });
}

/**
 * Estimasi warna latar (putih dataset = 255,255,255).
 * Sampel 4 pojok 5×5.
 */
export function estimateBackgroundColor(ctx, w, h) {
  const sample = (x, y, size = 5) => {
    const sx = Math.max(0, Math.min(w - size, x));
    const sy = Math.max(0, Math.min(h - size, y));
    const d = ctx.getImageData(sx, sy, size, size).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
    return [r/n, g/n, b/n];
  };
  const corners = [
    sample(0,0), sample(w-5,0), sample(0,h-5), sample(w-5,h-5)
  ];
  // rata-rata, tapi untuk dataset putih semua ~255
  let r=0,g=0,b=0;
  for (const c of corners) { r+=c[0]; g+=c[1]; b+=c[2]; }
  return [r/4, g/4, b/4];
}

/**
 * Buat mask biner 1=foreground 0=background
 * - Jika gambar punya alpha bervariasi → pakai alpha threshold
 * - Jika opaque (semua alpha 255) → pakai jarak warna ke backgroundColor
 */
export function createMaskFromCanvas(canvas, ctx, options = {}) {
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const mask = new Uint8Array(w * h);
  let alphaVar = 0;
  let alphaMin = 255, alphaMax = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a < alphaMin) alphaMin = a;
    if (a > alphaMax) alphaMax = a;
  }
  alphaVar = alphaMax - alphaMin;
  const hasAlpha = alphaVar > 30; // transparan beneran
  const bg = options.backgroundColor || estimateBackgroundColor(ctx, w, h);
  const bgR = bg[0], bgG = bg[1], bgB = bg[2];
  const whiteDistThr = options.whiteThreshold ?? 38; // toleransi putih dataset
  const alphaThr = options.alphaThreshold ?? 20;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y*w + x)*4;
      const r = d[idx], g = d[idx+1], b = d[idx+2], a = d[idx+3];
      let isBg;
      if (hasAlpha) {
        isBg = a < alphaThr;
      } else {
        const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
        // putih murni = bg ~255,255,255, dist kecil → bg
        isBg = dist < whiteDistThr;
        // tambahan: untuk dataset dengan bayangan tipis, pertahankan
      }
      mask[y*w + x] = isBg ? 0 : 1;
    }
  }
  // Bersihkan noise kecil: erosi+dilasi sederhana 3x3 (opsional)
  // Untuk siluet karakter, biarkan detail halus
  return { mask, w, h, hasAlpha, backgroundColor: bg, method: hasAlpha ? 'alpha' : 'color-distance' };
}

/**
 * Hitung bbox ketat foreground
 */
export function getMaskBBox(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y*w + x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, count, areaRatio: count/(w*h) };
}

/**
 * Crop canvas ke bbox + padding, return canvas baru
 */
export function cropToBBox(canvas, ctx, bbox, padding = 8) {
  const { minX, minY, maxX, maxY } = bbox;
  const pad = padding;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(canvas.width - 1, maxX + pad);
  const y1 = Math.min(canvas.height - 1, maxY + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = '#ffffff';
  octx.fillRect(0,0,cw,ch);
  octx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return { canvas: out, ctx: octx, x0, y0, cw, ch };
}
