// Second half of tools/build-civilians.py (which runs it): the parts of a person that are simplified.
//   - the teeth come from Ara at 7,000 triangles, more than the rest of the head together; they are cut to 1,400, keeping
//     the face shapes that move them
//   - the far versions: everything that still shows at a distance, merged into one mesh on the person's far atlas
//     (uv2) and cut to 9,000, 3,000 and 1,100 triangles, so a person beyond a few metres is one draw
// Usage: node tools/civ-lods.mjs <id> [<id> …]   (rewrites assets/civilians/<id>.bin in place)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'civilians');
const FAR_TRIS = [9000, 4500, 1800], FAR_ERR = [0.006, 0.015, 0.09], TEETH = 1400;
const BIG = new Set(['skin', 'face', 'hair', 'cloth']);      // what the farthest version is made of (trim, jewellery, eyes and brows are left out: edge collapse cannot merge separate small pieces)
await MeshoptSimplifier.ready;

function read(file) {
  const buf = readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'CIV1') throw new Error('not a civilian file: ' + file);
  const n = buf.readUInt32LE(4), head = JSON.parse(buf.toString('utf8', 8, 8 + n)), bin = buf.subarray(8 + n);
  const arr = (T, off, count) => new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + count * T.BYTES_PER_ELEMENT));
  for (const g of head.groups) {
    const v = g.verts;
    g.a = { pos: arr(Float32Array, g.pos, v * 3), nrm: arr(Int8Array, g.nrm, v * 4), uv: arr(Float32Array, g.uv, v * 2), uv2: arr(Uint16Array, g.uv2, v * 2), joints: arr(Uint8Array, g.joints, v * 4), weights: arr(Uint8Array, g.weights, v * 4),
      index: arr(g.index32 ? Uint32Array : Uint16Array, g.index, g.tris * 3), col: g.col != null ? arr(Uint8Array, g.col, v * 4) : null };
    if (g.morph) g.m = g.morph.map(t => t && { scale: t.scale, idx: arr(Uint16Array, t.idx, t.n), d: arr(Int16Array, t.d, t.n * 3) });
  }
  delete head.lods;
  return head;
}

// Cut an indexed mesh to about `target` triangles and drop the vertices no triangle uses. Returns the new index list and,
// for each old vertex, its new place (or -1).
function cut(index, pos, target, err) {
  const src = index instanceof Uint32Array ? index : new Uint32Array(index);
  let out = src;
  if (src.length / 3 > target * 1.1) {
    out = MeshoptSimplifier.simplify(src, pos, 3, Math.floor(target) * 3, err)[0];
  }
  const remap = new Int32Array(pos.length / 3).fill(-1); let n = 0; const idx = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) { if (remap[out[i]] < 0) remap[out[i]] = n++; idx[i] = remap[out[i]]; }
  return { idx, remap, n };
}
const take = (a, size, remap, n) => { const o = new a.constructor(n * size); for (let v = 0; v < remap.length; v++) if (remap[v] >= 0) for (let k = 0; k < size; k++) o[remap[v] * size + k] = a[v * size + k]; return o; };

function write(file, head) {
  const chunks = []; let len = 0;
  const put = a => { const pad = (4 - len % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); len += pad; } const off = len, b = Buffer.from(a.buffer, a.byteOffset, a.byteLength); chunks.push(b); len += b.length; return off; };
  for (const g of head.groups) {
    const a = g.a; g.verts = a.pos.length / 3; g.tris = a.index.length / 3;
    g.pos = put(a.pos); g.nrm = put(a.nrm); g.uv = put(a.uv); g.uv2 = put(a.uv2); g.joints = put(a.joints); g.weights = put(a.weights);
    const index = g.verts < 65536 ? Uint16Array.from(a.index) : Uint32Array.from(a.index); g.index32 = g.verts >= 65536; g.index = put(index);
    if (a.col) g.col = put(a.col);
    if (g.m) g.morph = g.m.map(t => t && { n: t.idx.length, scale: t.scale, idx: put(t.idx), d: put(t.d) });
  }
  head.lods = head.far.map(L => ({ verts: L.pos.length / 3, tris: L.index.length / 3, pos: put(L.pos), nrm: put(L.nrm), uv: put(L.uv), joints: put(L.joints), weights: put(L.weights), index: put(L.index) }));
  const clean = { ...head, groups: head.groups.map(({ a, m, ...g }) => g), tris: head.groups.reduce((s, g) => s + g.tris, 0) }; delete clean.far;
  let json = Buffer.from(JSON.stringify(clean)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const pre = Buffer.alloc(8); pre.write('CIV1', 0, 'latin1'); pre.writeUInt32LE(json.length, 4);
  writeFileSync(file, Buffer.concat([pre, json, ...chunks]));
}

for (const id of process.argv.slice(2)) {
  const file = join(DIR, id + '.bin'), head = read(file);
  // the teeth
  for (const g of head.groups) {
    if (g.kind !== 'mouth' || g.tris <= TEETH * 1.1) continue;
    const a = g.a, c = cut(a.index, a.pos, TEETH, 0.02);
    for (const [k, size] of [['pos', 3], ['nrm', 4], ['uv', 2], ['uv2', 2], ['joints', 4], ['weights', 4]]) a[k] = take(a[k], size, c.remap, c.n);
    a.index = c.idx;
    if (g.m) g.m = g.m.map(t => {
      if (!t) return null;
      const keep = []; for (let i = 0; i < t.idx.length; i++) if (c.remap[t.idx[i]] >= 0) keep.push(i);
      if (!keep.length) return null;
      return { scale: t.scale, idx: Uint16Array.from(keep, i => c.remap[t.idx[i]]), d: Int16Array.from(keep.flatMap(i => [t.d[i * 3], t.d[i * 3 + 1], t.d[i * 3 + 2]])) };
    });
    g.parts = [{ name: 'Mouth', start: 0, count: c.idx.length }];
  }
  // the far versions
  const merge = big => {
    const parts = [];
    for (const g of head.groups) {
      if (!g.far || (big && !BIG.has(g.kind))) continue;
      if (g.kind === 'overlay') { const p = g.parts.find(p => p.name === 'Eyebrows'); if (p && !big) parts.push({ g, start: p.start, count: p.count }); continue; }
      parts.push({ g, start: 0, count: g.a.index.length });
    }
    let nv = 0, ni = 0; for (const p of parts) { nv += p.g.a.pos.length / 3; ni += p.count; }
    const M = { pos: new Float32Array(nv * 3), nrm: new Int8Array(nv * 4), uv: new Uint16Array(nv * 2), joints: new Uint8Array(nv * 4), weights: new Uint8Array(nv * 4), index: new Uint32Array(ni) };
    let v0 = 0, i0 = 0;
    for (const p of parts) {
      const a = p.g.a;
      M.pos.set(a.pos, v0 * 3); M.nrm.set(a.nrm, v0 * 4); M.uv.set(a.uv2, v0 * 2); M.joints.set(a.joints, v0 * 4); M.weights.set(a.weights, v0 * 4);
      for (let i = 0; i < p.count; i++) M.index[i0 + i] = a.index[p.start + i] + v0;
      v0 += a.pos.length / 3; i0 += p.count;
    }
    return M;
  };
  const all = merge(false), big = merge(true);
  head.far = FAR_TRIS.map((target, k) => {
    const M = k === 2 ? big : all, c = cut(M.index, M.pos, target, FAR_ERR[k]);
    return { pos: take(M.pos, 3, c.remap, c.n), nrm: take(M.nrm, 4, c.remap, c.n), uv: take(M.uv, 2, c.remap, c.n), joints: take(M.joints, 4, c.remap, c.n), weights: take(M.weights, 4, c.remap, c.n), index: c.n < 65536 ? Uint16Array.from(c.idx) : c.idx };
  });
  write(file, head);
  const mouth = head.groups.find(g => g.kind === 'mouth');
  console.log(`${id}: near ${head.groups.reduce((s, g) => s + g.a.index.length / 3, 0)} tris in ${head.groups.length} draws (mouth ${mouth ? mouth.a.index.length / 3 : 0}), far ${head.far.map(L => L.index.length / 3).join(' / ')}`);
}
