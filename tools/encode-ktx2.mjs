// Encodes the texture library to KTX2 (Basis Universal UASTC LDR 4x4, Zstandard-supercompressed, full mip chain), so the
// GPU keeps them block-compressed (ASTC 4x4 or BC7: 1 byte per texel instead of 4, mipmaps included) and nothing is
// decoded or mipmapped in the browser. Needs the `basisu` encoder (Homebrew: basis_universal).
//   node tools/encode-ktx2.mjs            encode what is missing or older than its source
//   node tools/encode-ktx2.mjs --force    re-encode everything
// Per texture role:
//   colour (albedo, base colour)  sRGB, sRGB mip filtering, light RDO (lambda 1.25)
//   normal maps                   -normal_map (linear metrics, linear filtering), mips renormalised, no RDO
//   data (AO/rough/metal packs)   linear, light RDO (lambda 0.75)
// The district's texture sets are loaded through TextureLoader, which flips images on upload (flipY); compressed
// textures cannot be flipped on upload, so those are flipped at encode time (-y_flip) and land exactly as before.
// glTF textures are never flipped. Each model gets a <id>.basis.gltf next to its .gltf that adds KHR_texture_basisu
// (the original JPEG/PNG stays as the extension's fallback source).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, writeFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const force = process.argv.includes('--force');
const ARGS = {
  color: ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.25', '-srgb', '-mipmap'],
  normal: ['-uastc', '-uastc_level', '2', '-normal_map', '-mipmap', '-mip_renorm'],
  data: ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '0.75', '-linear', '-mipmap'],
};

async function newer(a, b) { try { return (await stat(a)).mtimeMs > (await stat(b)).mtimeMs; } catch { return true; } }

// Image size from the file header (JPEG SOF or PNG IHDR).
async function size(file) {
  const d = await readFile(file);
  if (d.readUInt32BE(0) === 0x89504e47) return [d.readUInt32BE(16), d.readUInt32BE(20)];
  for (let i = 2; i < d.length;) {
    if (d[i] !== 0xff) { i++; continue; }
    const m = d[i + 1];
    if (m >= 0xc0 && m <= 0xc2) return [d.readUInt16BE(i + 7), d.readUInt16BE(i + 5)];
    i += 2 + d.readUInt16BE(i + 2);
  }
  throw new Error('no size: ' + file);
}

let tmp = null;
async function encode(src, out, role, flip) {
  if (!force && !(await newer(src, out))) return 'skip';
  let input = src;
  const [w, h] = await size(src), pot = v => 2 ** Math.round(Math.log2(v));
  if (w % 4 || h % 4) {                                          // block formats need multiples of 4: snap to the nearest power of two
    tmp ||= await mkdtemp(join(tmpdir(), 'ktx2-'));
    input = join(tmp, basename(src, extname(src)) + `_${Math.random().toString(36).slice(2, 8)}.png`);
    await run('sips', ['-s', 'format', 'png', '-z', String(pot(h)), String(pot(w)), src, '--out', input]);
  }
  const args = [...ARGS[role], ...(flip ? ['-y_flip'] : []), '-ktx2', '-ktx2_zstandard_level', '15', '-quiet', '-output_file', out, input];
  await run('basisu', args, { maxBuffer: 1 << 26 });
  return 'done';
}

// a small pool: each basisu already uses several threads
async function pool(jobs, n) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const j = jobs[i++]; res.push(await j()); } }));
  return res;
}

const jobs = [], log = [];
// ---- the district's texture sets (assets/tex/<id>/{diff,nor,arm}.jpg)
for (const id of await readdir(join(root, 'assets/tex'))) {
  const dir = join(root, 'assets/tex', id);
  if (!(await stat(dir)).isDirectory()) continue;
  for (const [file, role] of [['diff', 'color'], ['nor', 'normal'], ['arm', 'data']]) {
    const src = join(dir, file + '.jpg');
    try { await stat(src); } catch { continue; }
    jobs.push(async () => { const r = await encode(src, join(dir, file + '.ktx2'), role, true); log.push(`${r} tex/${id}/${file}`); return r; });
  }
}
// ---- the models (assets/models/<id>/<id>.gltf)
const gltfs = [];
for (const id of await readdir(join(root, 'assets/models'))) {
  const file = join(root, 'assets/models', id, id + '.gltf');
  try { await stat(file); } catch { continue; }
  const json = JSON.parse(await readFile(file, 'utf8')), dir = dirname(file);
  const roles = new Map();                                       // image index -> role
  const use = (texInfo, role) => {
    if (!texInfo) return; const src = json.textures[texInfo.index].source;
    const prev = roles.get(src); roles.set(src, prev && prev !== role ? 'data' : role);   // shared by colour and data: treat as data
  };
  for (const m of json.materials || []) {
    const p = m.pbrMetallicRoughness || {};
    use(p.baseColorTexture, 'color'); use(m.emissiveTexture, 'color'); use(m.normalTexture, 'normal');
    use(p.metallicRoughnessTexture, 'data'); use(m.occlusionTexture, 'data');
  }
  json.images.forEach((im, k) => {
    if (!im.uri || !/\.(jpe?g|png)$/i.test(im.uri)) return;
    const src = join(dir, im.uri), out = src.replace(/\.(jpe?g|png)$/i, '.ktx2');
    jobs.push(async () => { const r = await encode(src, out, roles.get(k) || 'color', false); log.push(`${r} models/${id}/${im.uri}`); return r; });
  });
  gltfs.push({ id, file, json });
}

const t0 = Date.now();
const res = await pool(jobs, Math.max(2, Math.min(6, cpus().length >> 1)));
// ---- glTF copies that point at the KTX2 images (KHR_texture_basisu), the originals kept as the fallback source
for (const { id, file, json } of gltfs) {
  const out = JSON.parse(JSON.stringify(json)), base = out.images.length;
  const ktx = out.images.map(im => ({ ...im, uri: im.uri.replace(/\.(jpe?g|png)$/i, '.ktx2'), mimeType: 'image/ktx2' }));
  out.images.push(...ktx);
  for (const t of out.textures) t.extensions = { ...(t.extensions || {}), KHR_texture_basisu: { source: base + t.source } };
  out.extensionsUsed = [...new Set([...(out.extensionsUsed || []), 'KHR_texture_basisu'])];
  await writeFile(file.replace(/\.gltf$/, '.basis.gltf'), JSON.stringify(out));
}
if (tmp) await rm(tmp, { recursive: true, force: true });
const done = res.filter(r => r === 'done').length;
console.log(`${done} encoded, ${res.length - done} up to date, ${gltfs.length} glTF copies written, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
