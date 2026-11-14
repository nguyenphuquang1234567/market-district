// Collision against yawed boxes (movement, line of sight, bot fire) and a 1 m navigation grid with A*.
import { clamp } from './util.js';

export const STEP = 0.42;

// Push a vertical cylinder (feet at p.y, given radius/height) out of every box it overlaps. Mutates p.
export function resolveXZ(p, r, height, cols, step = STEP) {
  const y0 = p.y + step, y1 = p.y + height;
  let hit = false;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (let i = 0; i < cols.length; i++) {
      const b = cols[i];
      if (y1 <= b.y0 || y0 >= b.y1) continue;
      const dx = p.x - b.x, dz = p.z - b.z;
      if (Math.abs(dx) > b.hx + b.hz + r || Math.abs(dz) > b.hx + b.hz + r) continue;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
      let ox = lx - qx, oz = lz - qz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; ox *= k; oz *= k; }
      else {
        const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
        if (px < pz) { ox = (lx < 0 ? -1 : 1) * (px + r); oz = 0; } else { ox = 0; oz = (lz < 0 ? -1 : 1) * (pz + r); }
      }
      p.x += ox * b.c + oz * b.s; p.z += -ox * b.s + oz * b.c;
      moved = hit = true;
    }
    if (!moved) break;
  }
  return hit;
}

// Highest walkable surface under the cylinder that is no more than one step above the feet.
export function groundAt(x, z, feetY, r, cols) {
  let g = 0, surf = null;
  const rr = r * 0.6;
  for (let i = 0; i < cols.length; i++) {
    const b = cols[i];
    if (b.y1 > feetY + STEP || b.y1 <= g) continue;
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) <= b.hx + rr && Math.abs(lz) <= b.hz + rr) { g = b.y1; surf = b.surf; }
  }
  return { y: g, surf };
}

export function ceilingAt(x, z, headY, r, cols) {
  let c = Infinity;
  for (let i = 0; i < cols.length; i++) {
    const b = cols[i];
    if (b.y0 < headY - 0.3 || b.y0 >= c) continue;
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) <= b.hx + r * 0.5 && Math.abs(lz) <= b.hz + r * 0.5) c = b.y0;
  }
  return c;
}

// Ray vs all boxes. Returns distance (or maxT) and fills `out` {b, nx, ny, nz} when given.
export function rayBoxes(ox, oy, oz, dx, dy, dz, maxT, cols, out) {
  let best = maxT, hitB = null, bn = 0;
  for (let i = 0; i < cols.length; i++) {
    const b = cols[i];
    const px = ox - b.x, pz = oz - b.z;
    const lx = px * b.c - pz * b.s, lz = px * b.s + pz * b.c;
    const ldx = dx * b.c - dz * b.s, ldz = dx * b.s + dz * b.c;
    let t0 = 0, t1 = best, n = 0;
    // x slab
    if (Math.abs(ldx) < 1e-9) { if (Math.abs(lx) > b.hx) continue; }
    else { let a = (-b.hx - lx) / ldx, c = (b.hx - lx) / ldx, s = 1; if (a > c) { const t = a; a = c; c = t; s = -1; } if (a > t0) { t0 = a; n = -s; } if (c < t1) t1 = c; if (t0 > t1) continue; }
    // y slab
    if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y1) continue; }
    else { let a = (b.y0 - oy) / dy, c = (b.y1 - oy) / dy, s = 1; if (a > c) { const t = a; a = c; c = t; s = -1; } if (a > t0) { t0 = a; n = -2 * s; } if (c < t1) t1 = c; if (t0 > t1) continue; }
    // z slab
    if (Math.abs(ldz) < 1e-9) { if (Math.abs(lz) > b.hz) continue; }
    else { let a = (-b.hz - lz) / ldz, c = (b.hz - lz) / ldz, s = 1; if (a > c) { const t = a; a = c; c = t; s = -1; } if (a > t0) { t0 = a; n = -3 * s; } if (c < t1) t1 = c; if (t0 > t1) continue; }
    if (t0 < best) { best = t0; hitB = b; bn = n; }
  }
  if (out) {
    out.b = hitB;
    if (hitB) {
      const a = Math.abs(bn), s = Math.sign(bn);
      const lx = a === 1 ? s : 0, lz = a === 3 ? s : 0;
      out.nx = lx * hitB.c + lz * hitB.s; out.ny = a === 2 ? s : 0; out.nz = -lx * hitB.s + lz * hitB.c;
    }
  }
  return best;
}

export const losClear = (a, b, cols) => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return true;
  return rayBoxes(a.x, a.y, a.z, dx / d, dy / d, dz / d, d, cols, null) >= d - 0.02;
};

// ---- navigation grid ------------------------------------------------------------------------------------------------
export class NavGrid {
  constructor(cols, x0, z0, x1, z1) {
    this.x0 = x0; this.z0 = z0; this.w = Math.ceil(x1 - x0); this.h = Math.ceil(z1 - z0);
    this.blocked = new Uint8Array(this.w * this.h);
    this.cover = new Uint8Array(this.w * this.h);        // 1 = free cell touching chest-high cover
    const pad = 0.42;
    for (const b of cols) {
      if (b.y1 < 0.5 || b.y0 > 1.6) continue;
      const ext = b.hx + b.hz + pad + 1;
      for (let gz = Math.max(0, Math.floor(b.z - ext - z0)); gz <= Math.min(this.h - 1, Math.ceil(b.z + ext - z0)); gz++)
        for (let gx = Math.max(0, Math.floor(b.x - ext - x0)); gx <= Math.min(this.w - 1, Math.ceil(b.x + ext - x0)); gx++) {
          const dx = x0 + gx + 0.5 - b.x, dz = z0 + gz + 0.5 - b.z;
          const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
          if (Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad) this.blocked[gz * this.w + gx] = b.y1 >= 1.0 ? 2 : 1;
        }
    }
    for (let z = 1; z < this.h - 1; z++) for (let x = 1; x < this.w - 1; x++) {
      const i = z * this.w + x;
      if (this.blocked[i]) continue;
      if (this.blocked[i - 1] === 2 || this.blocked[i + 1] === 2 || this.blocked[i - this.w] === 2 || this.blocked[i + this.w] === 2) this.cover[i] = 1;
    }
    this.g = new Float32Array(this.w * this.h); this.from = new Int32Array(this.w * this.h); this.stamp = new Uint32Array(this.w * this.h); this.gen = 0;
  }
  idx(x, z) { return clamp(Math.floor(z - this.z0), 0, this.h - 1) * this.w + clamp(Math.floor(x - this.x0), 0, this.w - 1); }
  free(x, z) { return !this.blocked[this.idx(x, z)]; }
  center(i, out) { out.x = this.x0 + (i % this.w) + 0.5; out.z = this.z0 + Math.floor(i / this.w) + 0.5; return out; }
  nearestFree(x, z) {
    let i = this.idx(x, z);
    if (!this.blocked[i]) return i;
    const cx = i % this.w, cz = Math.floor(i / this.w);
    for (let r = 1; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x2 = cx + dx, z2 = cz + dz;
      if (x2 < 0 || z2 < 0 || x2 >= this.w || z2 >= this.h) continue;
      if (!this.blocked[z2 * this.w + x2]) return z2 * this.w + x2;
    }
    return i;
  }
  // straight-line walkability on the grid
  walkable(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.4);
    for (let i = 1; i <= n; i++) { const t = i / n; if (this.blocked[this.idx(ax + (bx - ax) * t, az + (bz - az) * t)]) return false; }
    return true;
  }
  // A* with a binary heap; returns smoothed waypoints [{x,z}, …] or null.
  path(ax, az, bx, bz) {
    const w = this.w, s = this.nearestFree(ax, az), e = this.nearestFree(bx, bz);
    if (s === e) return [{ x: bx, z: bz }];
    const gen = ++this.gen, g = this.g, from = this.from, stamp = this.stamp, bl = this.blocked;
    const ex = e % w, ez = Math.floor(e / w);
    const heap = [], hf = [];
    const push = (i, f) => { let k = heap.length; heap.push(i); hf.push(f); while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; heap[k] = heap[p]; hf[k] = hf[p]; k = p; } heap[k] = i; hf[k] = f; };
    const pop = () => {
      const top = heap[0], li = heap.pop(), lf = hf.pop(), n = heap.length;
      if (n) { let k = 0; for (;;) { let c = k * 2 + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; heap[k] = heap[c]; hf[k] = hf[c]; k = c; } heap[k] = li; hf[k] = lf; }
      return top;
    };
    const H = i => { const dx = Math.abs((i % w) - ex), dz = Math.abs(Math.floor(i / w) - ez); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[s] = 0; stamp[s] = gen; from[s] = -1; push(s, H(s));
    let found = false, guard = 0;
    while (heap.length && guard++ < 20000) {
      const c = pop();
      if (c === e) { found = true; break; }
      const cx = c % w, cz = Math.floor(c / w);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= this.h) continue;
        const n = nz * w + nx;
        if (bl[n]) continue;
        if (dx && dz && (bl[cz * w + nx] || bl[nz * w + cx])) continue;
        const ng = g[c] + (dx && dz ? 1.414 : 1) + (this.cover[n] ? -0.15 : 0);
        if (stamp[n] === gen && ng >= g[n]) continue;
        g[n] = ng; stamp[n] = gen; from[n] = c; push(n, ng + H(n));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = e; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map(c => ({ x: this.x0 + (c % w) + 0.5, z: this.z0 + Math.floor(c / w) + 0.5 }));
    pts[pts.length - 1] = { x: bx, z: bz };
    const out = []; let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.walkable(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
}
