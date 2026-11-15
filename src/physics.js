// Collision against yawed boxes (movement, line of sight, bot fire) and a 1 m navigation grid with A*.
import { clamp, rng } from './util.js';

export const STEP = 0.42;
// Collider flag: something hanging off a facade (a balcony). A floor for whoever is on it and a roof for whoever is
// under it, but not the ceiling of a room (the listener's surroundings skip it: see main.js).
export const OVERHANG = 1;
// What a soldier walks up without breaking stride: a kerb or a stair. Anything taller (a crate, a tyre, a stack of
// bricks) is walked round. The player keeps the full step height.
export const STRIDE_STEP = 0.24;
// Surcharge per metre by distance from the nearest obstacle, in cells: brushing a wall is uncomfortable, a stride or
// two out is where people walk, and the open middle of a street is exposed.
const LANE = [0, 0.9, 0.12, 0, 0.1, 0.22];

// Push a vertical cylinder (feet at p.y, given radius/height) out of every box it overlaps. Mutates p.
export function resolveXZ(p, r, height, cols, step = STEP) {
  const y0 = p.y + step, y1 = p.y + height, mid = p.y + height / 2;
  let hit = false;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (let i = 0; i < cols.length; i++) {
      const b = cols[i];
      if (y1 <= b.y0 || y0 >= b.y1) continue;
      if ((b.flags & OVERHANG) && b.y0 > mid) continue;      // a balcony over the head is a ceiling (ceilingAt stops the rise), not a wall to be shoved off
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
export function groundAt(x, z, feetY, r, cols, step = STEP) {
  let g = 0, surf = null;
  const rr = r * 0.6;
  for (let i = 0; i < cols.length; i++) {
    const b = cols[i];
    if (b.y1 > feetY + step || b.y1 <= g) continue;
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) <= b.hx + rr && Math.abs(lz) <= b.hz + rr) { g = b.y1; surf = b.surf; }
  }
  return { y: g, surf };
}

export function ceilingAt(x, z, headY, r, cols, skip = 0) {
  let c = Infinity;
  for (let i = 0; i < cols.length; i++) {
    const b = cols[i];
    if (b.y0 < headY - 0.3 || b.y0 >= c || (b.flags & skip)) continue;
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    if (Math.abs(lx) <= b.hx + r * 0.5 && Math.abs(lz) <= b.hz + r * 0.5) c = b.y0;
  }
  return c;
}

// Ray vs all boxes. Returns distance (or maxT) and fills `out` {b, nx, ny, nz} when given. Boxes with a `skip` flag are passed by.
export function rayBoxes(ox, oy, oz, dx, dy, dz, maxT, cols, out, skip = 0) {
  let best = maxT, hitB = null, bn = 0;
  for (let i = 0; i < cols.length; i++) {
    const b = cols[i];
    if (skip && (b.flags & skip)) continue;
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
  constructor(cols, x0, z0, x1, z1, step = STRIDE_STEP) {
    this.x0 = x0; this.z0 = z0; this.w = Math.ceil(x1 - x0); this.h = Math.ceil(z1 - z0);
    this.blocked = new Uint8Array(this.w * this.h);
    this.cover = new Uint8Array(this.w * this.h);        // 1 = free cell touching chest-high cover
    // Two free cells can still have a gap between them that is narrower than a body (a wall on one side of the
    // boundary, a crate on the other). edgeX[i] / edgeZ[i]: the way from cell i to its +x / +z neighbour is too tight.
    this.edgeX = new Uint8Array(this.w * this.h); this.edgeZ = new Uint8Array(this.w * this.h);
    const pad = 0.42;
    for (const b of cols) {
      if (b.y1 <= step + 0.005 || b.y0 > 1.6) continue;      // anything taller than a soldier's step is in the way: the same rule their collision uses
      const ext = b.hx + b.hz + pad + 1;
      for (let gz = Math.max(0, Math.floor(b.z - ext - z0)); gz <= Math.min(this.h - 1, Math.ceil(b.z + ext - z0)); gz++)
        for (let gx = Math.max(0, Math.floor(b.x - ext - x0)); gx <= Math.min(this.w - 1, Math.ceil(b.x + ext - x0)); gx++) {
          const dx = x0 + gx + 0.5 - b.x, dz = z0 + gz + 0.5 - b.z;
          const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
          if (Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad) this.blocked[gz * this.w + gx] = b.y1 >= 1.0 ? 2 : 1;
          // the same test half a cell on, where a walker crosses into the next cell
          if (Math.abs(lx + 0.5 * b.c) <= b.hx + pad && Math.abs(lz + 0.5 * b.s) <= b.hz + pad) this.edgeX[gz * this.w + gx] = 1;
          if (Math.abs(lx - 0.5 * b.s) <= b.hx + pad && Math.abs(lz + 0.5 * b.c) <= b.hz + pad) this.edgeZ[gz * this.w + gx] = 1;
        }
    }
    for (let z = 1; z < this.h - 1; z++) for (let x = 1; x < this.w - 1; x++) {
      const i = z * this.w + x;
      if (this.blocked[i]) continue;
      if (this.blocked[i - 1] === 2 || this.blocked[i + 1] === 2 || this.blocked[i - this.w] === 2 || this.blocked[i + this.w] === 2) this.cover[i] = 1;
    }
    // Cells to the nearest obstacle (1 = touching one, capped at 5). Routes use it to keep a shoulder's width off walls
    // and to favour the edge of a street over its exposed middle.
    const clear = this.clear = new Uint8Array(this.w * this.h), queue = [];
    for (let i = 0; i < clear.length; i++) if (this.blocked[i]) queue.push(i);
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head], cx = c % this.w, cz = Math.floor(c / this.w), d = clear[c] + 1;
      if (d > 5) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, nz = cz + dz, n = nz * this.w + nx;
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h || this.blocked[n] || clear[n]) continue;
        clear[n] = d; queue.push(n);
      }
    }
    for (let i = 0; i < clear.length; i++) if (!this.blocked[i] && !clear[i]) clear[i] = 5;
    this.lane = Float32Array.from(clear, d => LANE[d]);
    this.g = new Float32Array(this.w * this.h); this.from = new Int32Array(this.w * this.h); this.stamp = new Uint32Array(this.w * this.h); this.gen = 0;
  }
  // One walker's taste in routes: the shared lane cost plus a slow-varying personal preference, so a squad does not
  // file down the same line.
  bias(seed, spread = 0.12) {
    const out = new Float32Array(this.lane.length), R = rng(seed), cells = 9;
    const gw = Math.ceil(this.w / cells) + 2, gh = Math.ceil(this.h / cells) + 2, grid = Float32Array.from({ length: gw * gh }, () => R());
    const side = 0.75 + R() * 0.6;                       // how strongly this one avoids open ground
    for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) {
      const fx = x / cells, fz = z / cells, x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
      const n = (grid[z0 * gw + x0] * (1 - tx) + grid[z0 * gw + x0 + 1] * tx) * (1 - tz) + (grid[(z0 + 1) * gw + x0] * (1 - tx) + grid[(z0 + 1) * gw + x0 + 1] * tx) * tz;
      const i = z * this.w + x, d = this.clear[i];
      out[i] = (d <= 1 ? LANE[d] : LANE[d] * side) + n * spread;
    }
    return out;
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
  // Visits every cell the line crosses (not samples along it), so a corner cannot be clipped between two samples.
  walkable(ax, az, bx, bz) {
    const w = this.w, h = this.h, bl = this.blocked;
    const x = ax - this.x0, z = az - this.z0, dx = bx - ax, dz = bz - az;
    let cx = clamp(Math.floor(x), 0, w - 1), cz = clamp(Math.floor(z), 0, h - 1);
    const tx = clamp(Math.floor(bx - this.x0), 0, w - 1), tz = clamp(Math.floor(bz - this.z0), 0, h - 1);
    if (bl[tz * w + tx]) return false;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ix = dx !== 0 ? Math.abs(1 / dx) : Infinity, iz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let mx = dx !== 0 ? (dx > 0 ? cx + 1 - x : x - cx) * ix : Infinity, mz = dz !== 0 ? (dz > 0 ? cz + 1 - z : z - cz) * iz : Infinity;
    for (let guard = 0; guard < 600; guard++) {
      if ((cx === tx && cz === tz) || Math.min(mx, mz) > 1) return true;
      const corner = Math.abs(mx - mz) < 1e-7, stepX = corner || mx < mz, stepZ = corner || mz <= mx;
      const nx = stepX ? cx + sx : cx, nz = stepZ ? cz + sz : cz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) return false;
      if (!this.open(cx, cz, nx, nz)) return false;
      cx = nx; cz = nz;
      if (stepX) mx += ix;
      if (stepZ) mz += iz;
    }
    return true;
  }
  // Can a body pass from cell (cx, cz) to the neighbouring cell (nx, nz)? Diagonal steps must be open both ways round the corner.
  open(cx, cz, nx, nz) {
    const w = this.w, bl = this.blocked, ex = this.edgeX, ez = this.edgeZ, c = cz * w + cx, n = nz * w + nx;
    if (bl[n]) return false;
    if (nz === cz) return !ex[nx > cx ? c : n];
    if (nx === cx) return !ez[nz > cz ? c : n];
    const side = cz * w + nx, up = nz * w + cx;
    return !(bl[side] || bl[up] || ex[nx > cx ? c : side] || ez[nz > cz ? side : n] || ez[nz > cz ? c : up] || ex[nx > cx ? up : n]);
  }
  // The same test for a body with shoulders: the line and a parallel one on each side must be clear.
  walkableWide(ax, az, bx, bz, half = 0.45) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const ox = -dz / d * half, oz = dx / d * half;
    return this.walkable(ax, az, bx, bz) && this.walkable(ax + ox, az + oz, bx + ox, bz + oz) && this.walkable(ax - ox, az - oz, bx - ox, bz - oz);
  }
  // Lane cost of walking the straight line a→b.
  lineCost(ax, az, bx, bz, cost) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 0.5));
    let sum = 0;
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; sum += cost[this.idx(ax + (bx - ax) * t, az + (bz - az) * t)]; }
    return d * (1 + sum / n);
  }
  // A* with a binary heap; returns smoothed waypoints [{x,z}, …] or null. `cost` is a per-cell surcharge (see bias()).
  path(ax, az, bx, bz, cost = this.lane) {
    const w = this.w, s = this.nearestFree(ax, az), e = this.nearestFree(bx, bz);
    if (s === e) return [{ x: bx, z: bz }];
    const gen = ++this.gen, g = this.g, from = this.from, stamp = this.stamp, bl = this.blocked;
    const ex = e % w, ez = Math.floor(e / w);
    const heap = [], hf = [];
    const push = (i, f) => { let k = heap.length; heap.push(i); hf.push(f); while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; heap[k] = heap[p]; hf[k] = hf[p]; k = p; } heap[k] = i; hf[k] = f; };
    let popF = 0;
    const pop = () => {
      popF = hf[0];
      const top = heap[0], li = heap.pop(), lf = hf.pop(), n = heap.length;
      if (n) { let k = 0; for (;;) { let c = k * 2 + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; heap[k] = heap[c]; hf[k] = hf[c]; k = c; } heap[k] = li; hf[k] = lf; }
      return top;
    };
    const H = i => { const dx = Math.abs((i % w) - ex), dz = Math.abs(Math.floor(i / w) - ez); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[s] = 0; stamp[s] = gen; from[s] = -1; push(s, H(s));
    let found = false, guard = 0;
    while (heap.length && guard < bl.length) {                            // (as many expansions as there are cells: a route across the whole map is never cut short)
      const c = pop();
      if (popF > g[c] + H(c) + 1e-3) continue;                            // a stale entry: this cell was reached more cheaply since, and has been expanded from there (g is float32: compare loosely)
      guard++;
      if (c === e) { found = true; break; }
      const cx = c % w, cz = Math.floor(c / w);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= this.h) continue;
        const n = nz * w + nx;
        if (!this.open(cx, cz, nx, nz)) continue;
        const ng = g[c] + (dx && dz ? 1.414 : 1) * (1 + cost[n]);
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
    // Straighten the cell-by-cell route, but only where the shortcut is as comfortable as the route it replaces:
    // room for the shoulders, and no dearer in lane cost (so a chosen street edge is not traded for the middle).
    pts[0] = { x: ax, z: az };
    const along = [0];
    for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + this.lineCost(pts[k - 1].x, pts[k - 1].z, pts[k].x, pts[k].z, cost));
    const out = []; let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 40);
      while (j > i + 1 && !(this.walkableWide(pts[i].x, pts[i].z, pts[j].x, pts[j].z)
        && this.lineCost(pts[i].x, pts[i].z, pts[j].x, pts[j].z, cost) <= (along[j] - along[i]) * 1.03 + 0.15)) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
}
