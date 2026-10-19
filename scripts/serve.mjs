/**
 * Server statis untuk dist UCF (tanpa allowlist host, cocok untuk preview sandbox).
 * Jalankan: node scripts/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  return join(root, normalized === '/' ? '/index.html' : normalized);
}

const server = createServer(async (request, response) => {
  try {
    let target = safePath(request.url || '/');
    let info = await stat(target).catch(() => null);
    if (info && info.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info) {
      target = join(root, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('404 — jalankan `npm run build` terlebih dahulu.');
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`500 — ${error.message}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`UCF static server: http://0.0.0.0:${port} (root ${root})`);
});
