// Baked indirect light. A grid of probes ray-traces the static district once: rays that reach the sky pick up the HDRI's
// colour, rays that hit a surface pick up sunlight bounced off it (two further bounces are solved from the probes
// themselves), and awnings tint what passes through them. Each probe stores first-order SH irradiance; every lit
// material samples the volume instead of an unoccluded sky. The result is cached in assets/gi.bin.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { giUniforms } from './render.js';

const GRID = { x0: -46, y0: 0.35, z0: -80, sx: 1, sy: 1.1, sz: 1, nx: 93, ny: 8, nz: 161 };
const NR = 40, VERSION = 7, MAGIC = 0x4749;
const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });   // yields without timer throttling
const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function textureAverages() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 8;
  const cx = cv.getContext('2d', { willReadFrequently: true }), cache = new Map();
  return tex => {
    if (!tex || !tex.image) return [1, 1, 1];
    if (cache.has(tex)) return cache.get(tex);
    let out = [0.5, 0.5, 0.5];
    try {
      cx.drawImage(tex.image, 0, 0, 8, 8);
      const d = cx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += lin(d[i] / 255); g += lin(d[i + 1] / 255); b += lin(d[i + 2] / 255); }
      out = [r / 64, g / 64, b / 64];
    } catch { /* data textures etc. */ }
    cache.set(tex, out); return out;
  };
}

// One merged triangle soup of everything that blocks or bounces light, with a per-vertex albedo.
function occluders(world, M) {
  const avg = textureAverages();
  const use = world.group.children.filter(m => {
    const n = m.name;
    if (n.startsWith('d_') || n === 'frond' || n === 'cable' || n === 'iron') return false;
    return /^(cloth_|rug)/.test(n) || n === 'ground' || m.castShadow;
  });
  let nv = 0, ni = 0;
  for (const m of use) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
  const pos = new Float32Array(nv * 3), alb = new Float32Array(nv * 3), cloth = new Uint8Array(nv), idx = new Uint32Array(ni);
  const gt = [avg(M.ground.map), avg(giUniformsGround(M, 'tC2')), avg(giUniformsGround(M, 'tC3'))];
  let v0 = 0, i0 = 0;
  for (const m of use) {
    const g = m.geometry, p = g.attributes.position, c = g.attributes.color, bl = g.attributes.aBlend, mat = m.material;
    const base = avg(mat.map), col = mat.color, isCloth = /^(cloth_|rug)/.test(m.name), vc = mat.vertexColors && c;
    pos.set(p.array, v0 * 3);
    for (let i = 0; i < p.count; i++) {
      const o = (v0 + i) * 3;
      if (m.name === 'ground' && bl) {
        const bx = Math.min(1, bl.getX(i)), by = Math.min(1, bl.getY(i));
        for (let k = 0; k < 3; k++) { const a = gt[0][k] * 0.9 * (1 - bx) + gt[1][k] * bx; alb[o + k] = a * (1 - by) + gt[2][k] * [0.78, 0.68, 0.54][k] * by; }
      } else {
        alb[o] = base[0] * col.r * (vc ? c.getX(i) : 1); alb[o + 1] = base[1] * col.g * (vc ? c.getY(i) : 1); alb[o + 2] = base[2] * col.b * (vc ? c.getZ(i) : 1);
      }
      cloth[v0 + i] = isCloth ? 1 : 0;
    }
    const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[i0 + i] = ia[i] + v0;
    v0 += p.count; i0 += ia.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return { bvh: new MeshBVH(geo, { maxLeafTris: 6 }), alb, cloth, tris: ni / 3 };
}
const giUniformsGround = (M, key) => M.ground.userData.layers?.[key] || M.ground.map;

function skySampler(sky) {
  // box-filtered 64x32 copy of the (sun-clamped) HDRI so a handful of rays still sees the right sky energy
  const W = 64, H = 32, out = new Float32Array(W * H * 3), hf = THREE.DataUtils.fromHalfFloat, bw = sky.width / W, bh = sky.height / H, st = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = 0; yy < bh; yy += st) for (let xx = 0; xx < bw; xx += st) { const i = ((y * bh + yy | 0) * sky.width + (x * bw + xx | 0)) * 4; r += hf(sky.data[i]); g += hf(sky.data[i + 1]); b += hf(sky.data[i + 2]); n++; }
    const o = (y * W + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return (d, res) => {
    const u = Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5, v = Math.asin(Math.max(-1, Math.min(1, d.y))) / Math.PI + 0.5;
    const x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(H - 1, Math.max(0, Math.floor((1 - v) * H))), o = (y * W + x) * 3;
    res[0] = out[o]; res[1] = out[o + 1]; res[2] = out[o + 2];
  };
}

async function bake(R, world, M, onProgress) {
  const t0 = performance.now(), { nx, ny, nz, x0, y0, z0, sx, sy, sz } = GRID, N = nx * ny * nz;
  const occ = occluders(world, M), bvh = occ.bvh, alb = occ.alb, cloth = occ.cloth;
  const sky = skySampler(R.sky), sun = R.sunDir, Es = [R.sunIntensity * R.sunColor.r, R.sunIntensity * R.sunColor.g, R.sunIntensity * R.sunColor.b];
  // probes inside solid volumes are not traced; they are filled from their neighbours afterwards
  const valid = new Uint8Array(N), cols = world.colliders;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = x0 + ix * sx, z = z0 + iz * sz, hit = [];
    for (const b of cols) { const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c; if (Math.abs(lx) <= b.hx + 0.06 && Math.abs(lz) <= b.hz + 0.06) hit.push(b); }
    for (let iy = 0; iy < ny; iy++) { const y = y0 + iy * sy; let inside = false; for (const b of hit) if (y > b.y0 - 0.05 && y < b.y1 + 0.05) { inside = true; break; } valid[(iz * ny + iy) * nx + ix] = inside ? 0 : 1; }
  }
  const dirs = [];
  for (let i = 0; i < NR; i++) { const y = 1 - (2 * (i + 0.5)) / NR, r = Math.sqrt(1 - y * y), a = i * 2.399963; dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  const sh = new Float32Array(N * 12);                       // per probe: [c0 c1x c1y c1z] x rgb, direct + sky part
  const nValid = valid.reduce((a, b) => a + b, 0), slot = new Int32Array(N).fill(-1);
  const linkTo = new Int32Array(nValid * NR).fill(-1), linkW = new Float32Array(nValid * NR * 3), linkN = new Int8Array(nValid * NR * 3);
  const ray = new THREE.Ray(), sray = new THREE.Ray(), L = [0, 0, 0], T = [0, 0, 0], sk = [0, 0, 0], q = new THREE.Vector3();
  sray.direction.copy(sun);
  // fraction of direct sun reaching a point (awnings let some through, tinted)
  const sunAt = (p, out) => {
    out[0] = out[1] = out[2] = 1; sray.origin.copy(p);
    for (let k = 0; k < 3; k++) {
      const h = bvh.raycastFirst(sray, THREE.DoubleSide, 0.01, 300);
      if (!h) return true;
      const a = h.face.a;
      if (!cloth[a]) { out[0] = out[1] = out[2] = 0; return false; }
      out[0] *= alb[a * 3] * 0.5; out[1] *= alb[a * 3 + 1] * 0.5; out[2] *= alb[a * 3 + 2] * 0.5;
      sray.origin.copy(h.point).addScaledVector(sun, 0.03);
    }
    return true;
  };
  const probeAt = p => {
    const ix = Math.round((p.x - x0) / sx), iy = Math.round((p.y - y0) / sy), iz = Math.round((p.z - z0) / sz);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return -1;
    const i = (iz * ny + iy) * nx + ix; return valid[i] ? i : -1;
  };
  let s = 0, done = 0; const sv = [0, 0, 0];
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const pi = (iz * ny + iy) * nx + ix; if (!valid[pi]) continue;
      const me = s++; slot[pi] = me; let back = 0; const o = pi * 12;
      for (let r = 0; r < NR; r++) {
        const d = dirs[r]; ray.origin.set(x0 + ix * sx, y0 + iy * sy, z0 + iz * sz); ray.direction.copy(d);
        L[0] = L[1] = L[2] = 0; T[0] = T[1] = T[2] = 1;
        for (let depth = 0; depth < 4; depth++) {
          const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0.01, 90);
          if (!h) { if (d.y > -0.05) { sky(d, sk); L[0] += T[0] * sk[0]; L[1] += T[1] * sk[1]; L[2] += T[2] * sk[2]; } break; }
          const a = h.face.a, n = h.face.normal, front = n.dot(d) < 0;
          if (cloth[a]) {             // sunlit cloth glows from below; some light carries on through
            if (!front) n.negate();
            if (sunAt(q.copy(h.point).addScaledVector(sun, 0.03), sv)) { const k = Math.abs(n.dot(sun)) * 0.3 / Math.PI; for (let c = 0; c < 3; c++) L[c] += T[c] * alb[a * 3 + c] * Es[c] * sv[c] * k; }
            for (let c = 0; c < 3; c++) T[c] *= alb[a * 3 + c] * 0.5;
            ray.origin.copy(h.point).addScaledVector(d, 0.03); continue;
          }
          if (!front) { back++; break; }
          q.copy(h.point).addScaledVector(n, 0.04);
          const nl = n.dot(sun);
          if (nl > 0 && sunAt(q, sv)) for (let c = 0; c < 3; c++) L[c] += T[c] * alb[a * 3 + c] * Es[c] * sv[c] * nl / Math.PI;
          const tp = probeAt(q.addScaledVector(n, 0.3)), lo = (me * NR + r) * 3;
          if (tp >= 0) { linkTo[me * NR + r] = tp; for (let c = 0; c < 3; c++) linkW[lo + c] = T[c] * alb[a * 3 + c] / Math.PI; linkN[lo] = n.x * 127; linkN[lo + 1] = n.y * 127; linkN[lo + 2] = n.z * 127; }
          break;
        }
        for (let c = 0; c < 3; c++) { const b = o + c * 4; sh[b] += L[c]; sh[b + 1] += L[c] * d.x; sh[b + 2] += L[c] * d.y; sh[b + 3] += L[c] * d.z; }
      }
      if (back > NR * 0.3) { valid[pi] = 0; }                 // mostly sees the inside of geometry: treat as buried
    }
    if (iz % 4 === 0) { onProgress(iz / nz); await tick(); }
    done++;
  }
  const k0 = Math.PI / NR, k1 = (2 * Math.PI) / NR;
  for (let i = 0; i < N; i++) if (slot[i] >= 0) for (let c = 0; c < 3; c++) { const b = i * 12 + c * 4; sh[b] *= k0; sh[b + 1] *= k1; sh[b + 2] *= k1; sh[b + 3] *= k1; }
  // further bounces: light arriving at each hit surface is looked up in the probes from the previous pass
  const base = sh.slice(); let cur = sh;
  for (let pass = 0; pass < 2; pass++) {
    const next = base.slice();
    for (let i = 0; i < N; i++) {
      const me = slot[i]; if (me < 0) continue;
      for (let r = 0; r < NR; r++) {
        const tp = linkTo[me * NR + r]; if (tp < 0) continue;
        const lo = (me * NR + r) * 3, nxn = linkN[lo] / 127, nyn = linkN[lo + 1] / 127, nzn = linkN[lo + 2] / 127, d = dirs[r];
        for (let c = 0; c < 3; c++) {
          const tb = tp * 12 + c * 4, E = Math.max(cur[tb] * 0.25, cur[tb] + cur[tb + 1] * nxn + cur[tb + 2] * nyn + cur[tb + 3] * nzn), Lc = E * linkW[lo + c], b = i * 12 + c * 4;
          next[b] += Lc * k0; next[b + 1] += Lc * d.x * k1; next[b + 2] += Lc * d.y * k1; next[b + 3] += Lc * d.z * k1;
        }
      }
    }
    cur = next;
  }
  // buried probes take the average of their lit neighbours so surfaces next to walls interpolate sensibly
  const ok = new Uint8Array(N); for (let i = 0; i < N; i++) ok[i] = slot[i] >= 0 && valid[i] ? 1 : 0;
  const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let pass = 0; pass < 10; pass++) {
    const add = [];
    for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const i = (iz * ny + iy) * nx + ix; if (ok[i]) continue;
      let n = 0; const acc = new Float32Array(12);
      for (const [ax, ay, az] of nb) { const jx = ix + ax, jy = iy + ay, jz = iz + az; if (jx < 0 || jy < 0 || jz < 0 || jx >= nx || jy >= ny || jz >= nz) continue; const j = (jz * ny + jy) * nx + jx; if (!ok[j]) continue; for (let k = 0; k < 12; k++) acc[k] += cur[j * 12 + k]; n++; }
      if (n) { for (let k = 0; k < 12; k++) cur[i * 12 + k] = acc[k] / n; add.push(i); }
    }
    if (!add.length) break; for (const i of add) ok[i] = 1;
  }
  // reference level for reflections: ambient of probes with an open view of the sky (top layer)
  let ref = 0, rn = 0;
  for (let iz = 0; iz < nz; iz += 3) for (let ix = 0; ix < nx; ix += 3) { const i = (iz * ny + ny - 1) * nx + ix; if (slot[i] >= 0) { ref += (cur[i * 12] + cur[i * 12 + 4] + cur[i * 12 + 8]) / 3; rn++; } }
  console.info(`gi: ${nValid} probes, ${Math.round(occ.tris / 1000)}k tris, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return { sh: cur, sky: ref / Math.max(1, rn) };
}

function upload(sh, skyRef) {
  const { nx, ny, nz, x0, y0, z0, sx, sy, sz } = GRID, N = nx * ny * nz, th = THREE.DataUtils.toHalfFloat;
  for (let c = 0; c < 3; c++) {
    const data = new Uint16Array(N * 4);
    for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) data[i * 4 + k] = th(Math.max(-60, Math.min(60, sh[i * 12 + c * 4 + k])));
    const t = new THREE.Data3DTexture(data, nx, ny, nz);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    const u = giUniforms[['tGiR', 'tGiG', 'tGiB'][c]]; u.value?.dispose?.(); u.value = t;
  }
  giUniforms.uGiMin.value.set(x0 - sx / 2, y0 - sy / 2, z0 - sz / 2);
  giUniforms.uGiInv.value.set(1 / (nx * sx), 1 / (ny * sy), 1 / (nz * sz));
  giUniforms.uGiSky.value = skyRef; giUniforms.uGiOn.value = 1;
}

// Loads the cached bake if it matches this build of the map, otherwise bakes (and offers the result to the dev server).
export async function setupGI(R, world, M, onProgress, force = false) {
  const N = GRID.nx * GRID.ny * GRID.nz;
  const sig = Math.fround(world.colliders.reduce((a, b) => a + b.x * 0.37 + b.z * 0.11 + b.y1, 0) + R.sunDir.x * 100 + R.sunIntensity);
  if (!force) try {
    const res = await fetch('assets/gi.bin', { cache: 'no-store' });
    if (res.ok) {
      const buf = await res.arrayBuffer(), head = new Float32Array(buf, 0, 8);
      if (head[0] === MAGIC && head[1] === VERSION && head[2] === N && Math.abs(head[3] - sig) < 1e-3 * Math.max(1, Math.abs(sig))) {
        upload(new Float32Array(buf, 32, N * 12), head[4]); return 'cached';
      }
    }
  } catch { /* fall through to a fresh bake */ }
  const { sh, sky } = await bake(R, world, M, onProgress);
  upload(sh, sky);
  const out = new ArrayBuffer(32 + N * 12 * 4); new Float32Array(out, 0, 8).set([MAGIC, VERSION, N, sig, sky, 0, 0, 0]); new Float32Array(out, 32).set(sh);
  fetch('/__save/gi.bin', { method: 'POST', body: out }).catch(() => {});
  return 'baked';
}
