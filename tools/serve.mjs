// Tiny static file server (no dependencies).  Usage: npm start  →  http://localhost:5173
import { createServer } from 'node:http';
import { createReadStream, statSync, mkdirSync, createWriteStream } from 'node:fs';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream',
};

createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'POST' && p.startsWith('/__capture/')) {      // dev helper: the page posts frames here (see G.capture)
    const name = p.slice(11).replace(/[^\w.-]/g, '_');
    mkdirSync(join(ROOT, 'captures'), { recursive: true });
    req.pipe(createWriteStream(join(ROOT, 'captures', name))).on('finish', () => res.writeHead(200).end('ok'));
    return;
  }
  if (req.method === 'POST' && p === '/__save/gi.bin') {             // the in-browser light bake caches its result here
    req.pipe(createWriteStream(join(ROOT, 'assets', 'gi.bin'))).on('finish', () => res.writeHead(200).end('ok'));
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT + sep) || file.toLowerCase().split(sep).includes('.git')) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
  const heavy = p.startsWith('/assets/') || p.startsWith('/node_modules/');
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': heavy ? 'public, max-age=86400' : 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Market District → http://localhost:${PORT}`));
