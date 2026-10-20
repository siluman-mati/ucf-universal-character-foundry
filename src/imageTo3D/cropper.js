/**
 * UCF Image-to-3D — Cropper untuk character sheet
 * Menangani: jangan proses seluruh lembar sebagai satu siluet.
 * Sediakan pemotongan/pemilihan area karakter.
 */

import { createMaskFromCanvas, getMaskBBox } from './imageLoader.js';

/**
 * Temukan komponen terhubung (4-direction) di mask biner.
 * Mengembalikan array bbox per komponen dengan areaRatio.
 */
export function findConnectedComponents(mask, W, H, minAreaRatio = 0.015) {
  const visited = new Uint8Array(W * H);
  const components = [];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const queue = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!mask[idx] || visited[idx]) continue;
      // BFS baru
      let minX = x, minY = y, maxX = x, maxY = y, count = 0;
      queue.length = 0;
      queue.push([x,y]);
      visited[idx]=1;
      let q=0;
      while (q < queue.length) {
        const [cx, cy] = queue[q++];
        count++;
        if (cx < minX) minX=cx; if (cx > maxX) maxX=cx;
        if (cy < minY) minY=cy; if (cy > maxY) maxY=cy;
        for (const [dx,dy] of dirs) {
          const nx=cx+dx, ny=cy+dy;
          if (nx<0||nx>=W||ny<0||ny>=H) continue;
          const nidx=ny*W+nx;
          if (visited[nidx] || !mask[nidx]) continue;
          visited[nidx]=1;
          queue.push([nx,ny]);
        }
        if (queue.length > 50000) break; // safety
      }
      const areaRatio = count/(W*H);
      if (areaRatio < minAreaRatio) continue; // noise kecil
      components.push({
        minX, minY, maxX, maxY,
        width: maxX-minX+1, height: maxY-minY+1,
        count, areaRatio,
        center: [(minX+maxX)/2, (minY+maxY)/2]
      });
    }
  }
  // sort besar → kecil
  components.sort((a,b)=> b.count - a.count);
  return components;
}

/**
 * Persyaratan engine single-view: TripoSR butuh 1 karakter tengah, bg clean, front.
 * Kembalikan pesan persyaratan.
 */
export function singleViewRequirements(engineId) {
  if (engineId === 'tripoRemote' || engineId === 'trellisRemote' || engineId === 'hunyuanRemote') {
    return [
      'Engine memerlukan SATU tampilan utama (single view).',
      'Pilih 1 karakter saja (jangan seluruh character sheet).',
      'Posisi karakter di tengah frame, menghadap depan (T-pose atau A-pose).',
      'Latar bersih (putih/transparan) — kontras tinggi agar tidak menempel.',
      'Crop persegi (1:1) lebih baik — TripoSR training 512×512.',
      'Jika sheet berisi banyak karakter/view (depan/belakang/samping), potong salah satu.'
    ];
  }
  return [];
}

/**
 * UI Cropper — buat overlay di atas preview.
 * Mengembalikan objek {canvas, rect, onChange, getCrop, destroy}
 * Rect: {x,y,w,h} dalam koordinat canvas (0..W,0..H)
 */
export function createCropperUI(container, imageCanvas, initialRect = null) {
  const W = imageCanvas.width, H = imageCanvas.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  canvas.style.cursor = 'crosshair';
  canvas.style.border = '1px solid #3a5a7a';
  canvas.style.borderRadius = '6px';
  canvas.style.touchAction = 'none';
  container.innerHTML = '';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let rect = initialRect || { x: 0, y: 0, w: W, h: H };
  // clamp
  const clampRect = (r)=> ({
    x: Math.max(0, Math.min(W-1, r.x)),
    y: Math.max(0, Math.min(H-1, r.y)),
    w: Math.max(16, Math.min(W - r.x, r.w)),
    h: Math.max(16, Math.min(H - r.y, r.h))
  });
  rect = clampRect(rect);
  let dragging = null; // 'move'|'nw'|'ne'|'sw'|'se'|'draw'
  let start = null;
  let onChange = null;

  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(imageCanvas, 0,0);
    // overlay gelap di luar rect
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0,0,W, rect.y);
    ctx.fillRect(0, rect.y+rect.h, W, H-rect.y-rect.h);
    ctx.fillRect(0, rect.y, rect.x, rect.h);
    ctx.fillRect(rect.x+rect.w, rect.y, W-rect.x-rect.w, rect.h);
    // border
    ctx.strokeStyle = '#4cc2ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    // handles
    const hs=8;
    ctx.fillStyle='#4cc2ff';
    for (const hx of [rect.x, rect.x+rect.w]) for (const hy of [rect.y, rect.y+rect.h]) ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
    // info
    ctx.fillStyle='rgba(0,0,0,0.6)';
    const label = `${rect.w}×${rect.h} @(${rect.x},${rect.y})`;
    const tm = ctx.measureText(label);
    ctx.fillRect(rect.x, rect.y-18, tm.width+8, 16);
    ctx.fillStyle='#fff';
    ctx.font='11px monospace';
    ctx.fillText(label, rect.x+4, rect.y-6);
  }

  function hitHandle(px,py){
    const hs=10;
    const pts = [
      { k:'nw', x:rect.x, y:rect.y },
      { k:'ne', x:rect.x+rect.w, y:rect.y },
      { k:'sw', x:rect.x, y:rect.y+rect.h },
      { k:'se', x:rect.x+rect.w, y:rect.y+rect.h },
    ];
    for (const p of pts) if (Math.abs(px-p.x)<hs && Math.abs(py-p.y)<hs) return p.k;
    if (px>=rect.x && px<=rect.x+rect.w && py>=rect.y && py<=rect.y+rect.h) return 'move';
    return 'draw';
  }
  function canvasPos(e){
    const r = canvas.getBoundingClientRect();
    const sx = W / r.width, sy = H / r.height;
    const clientX = e.touches? e.touches[0].clientX : e.clientX;
    const clientY = e.touches? e.touches[0].clientY : e.clientY;
    return { x: (clientX - r.left)*sx, y: (clientY - r.top)*sy };
  }
  function onDown(e){
    e.preventDefault();
    const p = canvasPos(e);
    const h = hitHandle(p.x,p.y);
    dragging = h;
    start = { x:p.x, y:p.y, rx:rect.x, ry:rect.y, rw:rect.w, rh:rect.h };
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onMove(e){
    if (!dragging) return;
    const p = canvasPos(e);
    const dx = p.x - start.x, dy = p.y - start.y;
    let nr = { ...rect };
    if (dragging==='move') {
      nr.x = start.rx + dx; nr.y = start.ry + dy;
    } else if (dragging==='se') { nr.w = start.rw + dx; nr.h = start.rh + dy; }
    else if (dragging==='nw') { nr.x = start.rx + dx; nr.y = start.ry + dy; nr.w = start.rw - dx; nr.h = start.rh - dy; }
    else if (dragging==='ne') { nr.y = start.ry + dy; nr.w = start.rw + dx; nr.h = start.rh - dy; nr.x = start.rx; }
    else if (dragging==='sw') { nr.x = start.rx + dx; nr.w = start.rw - dx; nr.h = start.rh + dy; nr.y = start.ry; }
    else if (dragging==='draw') { nr.x = Math.min(start.x, p.x); nr.y = Math.min(start.y, p.y); nr.w = Math.abs(p.x-start.x); nr.h = Math.abs(p.y-start.y); }
    rect = clampRect(nr);
    draw();
    if (onChange) onChange(rect);
  }
  function onUp(e){
    dragging=null; start=null;
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  // touch fallback
  canvas.addEventListener('touchstart', onDown, {passive:false});
  canvas.addEventListener('touchmove', onMove, {passive:false});
  canvas.addEventListener('touchend', onUp);
  draw();
  return {
    canvas, ctx,
    get rect(){ return { ...rect }; },
    setRect(r){ rect=clampRect(r); draw(); },
    onChange(cb){ onChange=cb; },
    destroy(){ container.innerHTML=''; }
  };
}

/**
 * Terapkan crop rect ke canvas sumber → canvas baru + mask baru
 */
export function applyCropToCanvas(srcCanvas, rect) {
  const out = document.createElement('canvas');
  out.width = rect.w; out.height = rect.h;
  const octx = out.getContext('2d', { willReadFrequently:true });
  octx.fillStyle='#ffffff';
  octx.fillRect(0,0,rect.w,rect.h);
  octx.drawImage(srcCanvas, rect.x, rect.y, rect.w, rect.h, 0,0,rect.w,rect.h);
  return { canvas: out, ctx: octx, w: rect.w, h: rect.h };
}
