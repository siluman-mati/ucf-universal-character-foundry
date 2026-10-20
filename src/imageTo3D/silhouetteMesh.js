/**
 * UCF Image-to-3D — Silhouette Extrude (lokal, tanpa ML)
 * Menghasilkan mesh 3D bervolume dari mask siluet gambar.
 * Bukan plane bertekstur: front + back + sisi (watertight).
 * Jujur: bukan rekonstruksi neural; punggung datar, detail 360° terbatas.
 */
import * as THREE from 'three';

/**
 * Downsample mask ke maxDim (mis 256) agar jumlah verteks terkendali.
 * Nearest-neighbor mayoritas vote di blok.
 */
export function downsampleMask(mask, W, H, maxDim = 256) {
  const scale = Math.min(1, maxDim / Math.max(W, H));
  if (scale >= 1) return { mask, W, H, scale: 1 };
  const W2 = Math.max(8, Math.round(W * scale));
  const H2 = Math.max(8, Math.round(H * scale));
  const out = new Uint8Array(W2 * H2);
  const invScale = 1/scale;
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      // sampling blok
      const x0 = Math.floor(x * invScale), x1 = Math.min(W, Math.floor((x+1)*invScale));
      const y0 = Math.floor(y * invScale), y1 = Math.min(H, Math.floor((y+1)*invScale));
      let sum = 0, total = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += mask[yy*W + xx]; total++; }
      out[y*W2 + x] = sum / Math.max(1,total) > 0.35 ? 1 : 0; // threshold 0.35 agar tipis (kaki) tidak hilang
    }
  }
  return { mask: out, W: W2, H: H2, scale };
}

/**
 * Marching Squares — hasilkan segmen garis tepi siluet.
 * @param {Uint8Array} mask W*H biner
 */
function collectSegments(mask, W, H) {
  const segs = [];
  // edge midpoints: 0 top,1 right,2 bottom,3 left
  const edgePoint = (x, y, edge) => {
    if (edge === 0) return { x: x + 0.5, y: y };
    if (edge === 1) return { x: x + 1, y: y + 0.5 };
    if (edge === 2) return { x: x + 0.5, y: y + 1 };
    return { x: x, y: y + 0.5 };
  };
  // Lookup: case (0-15) -> list of [eA,eB]
  // bit0 TL, bit1 TR, bit2 BR, bit3 BL (clockwise)
  const table = {
    0: [],
    1: [[3,0]],
    2: [[0,1]],
    3: [[3,1]],
    4: [[1,2]],
    5: [[3,0],[1,2]], // saddle: dua segmen
    6: [[0,2]],
    7: [[3,2]],
    8: [[2,3]],
    9: [[0,2]],
    10: [[0,3],[1,2]],
    11: [[1,2]],
    12: [[1,3]],
    13: [[0,1]],
    14: [[0,3]],
    15: []
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = mask[y*W + x] ? 1 : 0;
      const tr = mask[y*W + (x+1)] ? 1 : 0;
      const br = mask[(y+1)*W + (x+1)] ? 1 : 0;
      const bl = mask[(y+1)*W + x] ? 1 : 0;
      const c = (tl<<0) | (tr<<1) | (br<<2) | (bl<<3);
      const pairs = table[c];
      if (!pairs || !pairs.length) continue;
      for (const [ea, eb] of pairs) {
        const a = edgePoint(x, y, ea);
        const b = edgePoint(x, y, eb);
        segs.push({ a, b, keyA: `${a.x.toFixed(1)},${a.y.toFixed(1)}`, keyB: `${b.x.toFixed(1)},${b.y.toFixed(1)}` });
      }
    }
  }
  return segs;
}

/**
 * Sambungkan segmen menjadi loop tertutup.
 * Kembalikan array loops, tiap loop = array points {x,y}
 */
function linkSegments(segs) {
  // map pointKey -> list of seg indices
  const map = new Map();
  const add = (key, idx) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(idx);
  };
  segs.forEach((s, i) => { add(s.keyA, i); add(s.keyB, i); });
  const used = new Set();
  const loops = [];
  const pointEqual = (p,q) => p.x===q.x && p.y===q.y;

  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    // mulai loop baru
    const loop = [];
    let curIdx = i;
    let curPt = segs[curIdx].a; // mulai dari a
    let curKey = segs[curIdx].keyA;
    // arah: kita akan jalan a->b dulu
    let nextPt = segs[curIdx].b;
    let nextKey = segs[curIdx].keyB;
    loop.push({ ...curPt });
    used.add(curIdx);
    let guard = 0;
    while (guard++ < 10000) {
      loop.push({ ...nextPt });
      // cari segmen lain yang berbagi nextKey
      const candidates = map.get(nextKey) || [];
      let found = -1;
      for (const ci of candidates) {
        if (used.has(ci)) continue;
        // segmen ini share endpoint
        found = ci; break;
      }
      if (found === -1) {
        // coba cari yang sudah used tapi tutup loop? cek apakah nextKey == startKey
        // Jika loop sudah tertutup (kembali ke awal), berhenti
        if (nextKey === `${loop[0].x.toFixed(1)},${loop[0].y.toFixed(1)}`) break;
        // dead end — loop terbuka, hentikan
        break;
      }
      // lanjutkan
      const seg = segs[found];
      used.add(found);
      // tentukan arah: cur segment endpoint yang sama dengan nextKey adalah entry, keluar lewat ujung lain
      if (seg.keyA === nextKey) {
        curPt = seg.a; nextPt = seg.b; nextKey = seg.keyB;
      } else {
        curPt = seg.b; nextPt = seg.a; nextKey = seg.keyA;
      }
      // deteksi closure
      if (nextKey === `${loop[0].x.toFixed(1)},${loop[0].y.toFixed(1)}`) {
        // sudah kembali
        break;
      }
      if (guard > segs.length + 10) break;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

function loopArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p1 = loop[i], p2 = loop[(i+1)%loop.length];
    a += (p1.x * p2.y - p2.x * p1.y);
  }
  return Math.abs(a)/2;
}
function loopBounds(loop) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const p of loop) { if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
  return { minX,minY,maxX,maxY, w:maxX-minX, h:maxY-minY };
}

/**
 * Sederhanakan polyline: hapus titik kolinear
 */
function simplifyLoop(loop, eps = 0.12) {
  if (loop.length < 4) return loop;
  const out = [loop[0]];
  for (let i = 1; i < loop.length -1; i++) {
    const a = out[out.length-1], b = loop[i], c = loop[i+1];
    // cross product untuk kolinear
    const cross = Math.abs((b.x - a.x)*(c.y - a.y) - (b.y - a.y)*(c.x - a.x));
    const lenAB = Math.hypot(b.x-a.x, b.y-a.y), lenBC = Math.hypot(c.x-b.x, c.y-b.y);
    // jika hampir lurus dan jarak kecil, skip b
    if (cross < eps * Math.max(0.2, Math.min(lenAB,lenBC))) continue;
    out.push(b);
  }
  out.push(loop[loop.length-1]);
  // tutup
  if (out.length > 2 && Math.hypot(out[0].x - out[out.length-1].x, out[0].y - out[out.length-1].y) < 0.6) out.pop();
  return out;
}

/**
 * Buat mesh 3D extruded dari loop siluet
 * @param {Array} loop - outer contour points in grid coords (x,y) where y down
 * @param {object} opts { W,H, textureCanvas?, targetHeight, depthRatio }
 */
export function createExtrudedMeshFromLoop(loop, opts = {}) {
  const W = opts.W, H = opts.H;
  const targetHeight = opts.targetHeight ?? 1.70; // tinggi karakter meter
  const depthRatio = opts.depthRatio ?? 0.22; // tebal relatif tinggi
  const bevel = opts.bevel ?? true;

  // Normalisasi loop ke world X,Z (Y up)
  // Gambar Y down → world -Y, tapi untuk extrude shape kita di bidang XY lalu extrude Z
  // Kita akan map: image X → world X, image Y → world Y (negatif agar upright)
  // Setelah itu, extrude sepanjang Z
  const b = loopBounds(loop);
  const lw = b.w, lh = b.h;
  if (lw < 1 || lh < 1) throw new Error('Loop terlalu kecil');
  const worldH = targetHeight;
  const scale = worldH / lh; // skala grid→meter
  const worldW = lw * scale;
  const depth = Math.max(0.08, Math.min(0.45, worldH * depthRatio));

  // Pusatkan: grid center → world 0,0
  const cx = (b.minX + b.maxX)/2, cy = (b.minY + b.maxY)/2;
  const pts = loop.map(p => new THREE.Vector2((p.x - cx)*scale, -(p.y - cy)*scale));

  const shape = new THREE.Shape(pts);
  // Hole: untuk loop ini kita anggap no hole (karakter solid). Jika ada loop dalam kecil, bisa tambah sebagai hole.

  const extrudeSettings = {
    depth,
    bevelEnabled: bevel,
    bevelThickness: depth * 0.18,
    bevelSize: depth * 0.12,
    bevelSegments: 2,
    steps: 1
  };
  let geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geom.computeBoundingBox();
  // Center depth: extrude dari 0→depth, kita geser agar pusat di 0 agar kaki di y=0 nanti diatur viewport
  // Saat ini shape Y sudah center vertical, tapi depth Z di 0..depth. Pusatkan Z ke 0
  geom.translate(0, 0, -depth/2);

  // Buat material dengan texture dari gambar crop jika ada
  let material;
  if (opts.textureCanvas) {
    const tex = new THREE.CanvasTexture(opts.textureCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    // Atur wrapping: ExtrudeGeometry UV front/back sudah 0-1 berdasarkan bbox shape — cukup pakai map
    // Untuk sisi, texture akan stretch tapi tidak kritis
    material = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide
    });
    // Simpan texture size info
    geom.userData.textureCanvas = opts.textureCanvas;
  } else {
    material = new THREE.MeshStandardMaterial({ color: 0xbd9b7a, roughness:0.8, metalness:0.05, side: THREE.DoubleSide });
  }

  const mesh = new THREE.Mesh(geom, material);
  mesh.name = opts.name || 'ImageTo3D_Silhouette';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Bbox helper
  geom.computeBoundingBox();
  const bbox = geom.boundingBox.clone();
  // Normal helper info
  mesh.userData.isImageTo3D = true;
  mesh.userData.generation = {
    method: 'silhouette-extrude',
    loopPoints: pts.length,
    depth, worldW, worldH, scale, W, H,
    bboxSize: bbox.getSize(new THREE.Vector3()).toArray(),
    note: 'Geometri diekstrusi dari mask — punggung datar, bukan neural. Jujur didokumentasikan.'
  };
  return { mesh, geom, material, depth, worldW, worldH, scale, bbox, loopPoints: pts.length };
}

/**
 * Pipeline utama: mask → mesh
 */
export function generateSilhouetteMesh(mask, W, H, opts = {}) {
  // Downsample
  const ds = downsampleMask(mask, W, H, opts.maxDim ?? 256);
  const segs = collectSegments(ds.mask, ds.W, ds.H);
  if (!segs.length) throw new Error('Tidak ada tepi siluet terdeteksi — gambar mungkin kosong atau latar tidak terpisah');
  const loops = linkSegments(segs);
  if (!loops.length) throw new Error('Kontur gagal disambung — coba gambar dengan latar kontras (putih)');
  // pilih loop terbesar area sebagai outer
  let best = loops[0], bestArea = loopArea(loops[0]);
  for (let i=1;i<loops.length;i++) {
    const a = loopArea(loops[i]);
    if (a > bestArea) { bestArea=a; best=loops[i]; }
  }
  // Filter loop kecil (noise)
  if (bestArea < 80) throw new Error(`Siluet terlalu kecil (area ${bestArea.toFixed(0)} px²) — perbesar objek atau gunakan gambar terpusat`);
  const simplified = simplifyLoop(best, 0.15);
  return createExtrudedMeshFromLoop(simplified, { W: ds.W, H: ds.H, textureCanvas: opts.textureCanvas, targetHeight: opts.targetHeight, depthRatio: opts.depthRatio, bevel: opts.bevel, name: opts.name });
}

/**
 * Uji volumetrik: mesh harus punya ketebalan (bukan plane)
 */
export function verifyMeshIs3D(mesh) {
  mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  const is3D = s.x > 0.01 && s.y > 0.01 && s.z > 0.01;
  const verts = mesh.geometry.attributes.position.count;
  const tris = mesh.geometry.index ? mesh.geometry.index.count/3 : verts/3;
  return { is3D, size: [s.x,s.y,s.z], vertices: verts, triangles: tris, depth: s.z };
}
