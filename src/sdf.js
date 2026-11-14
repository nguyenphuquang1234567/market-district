// Small signed-distance toolkit: smooth unions of tapered capsules, meshed with marching cubes. Used for the gloves,
// which need to read as one continuous soft surface rather than a kit of primitives.
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// capsule from a to b whose radius tapers from ra to rb
export function cap(a, b, ra, rb = ra) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], bb = bx * bx + by * by + bz * bz || 1e-9;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    let t = (px * bx + py * by + pz * bz) / bb; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
  };
}

// groups: [{ parts: [fn…], k: blend radius, color: [r,g,b] }] — parts blend smoothly inside a group and between groups.
export function field(groups, kBetween = 0.004) {
  const dist = (x, y, z) => {
    let d = 1e9;
    for (const g of groups) { let dg = 1e9; for (const f of g.parts) dg = smin(dg, f(x, y, z), g.k); d = smin(d, dg, kBetween); }
    return d;
  };
  const color = (x, y, z) => {
    let best = groups[0], bd = 1e9;
    for (const g of groups) { let dg = 1e9; for (const f of g.parts) dg = Math.min(dg, f(x, y, z)); dg -= g.bias || 0; if (dg < bd) { bd = dg; best = g; } }
    return best.color;
  };
  return { dist, color };
}

const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const BIT = [1, 2, 8, 4, 16, 32, 128, 64];
const EDGE = [[0, 1], [1, 3], [2, 3], [0, 2], [4, 5], [5, 7], [6, 7], [4, 6], [0, 4], [1, 5], [3, 7], [2, 6]];

// Marching cubes over [min, max] with the given cell size. Normals come from the field gradient; colours from f.color.
export function polygonise(f, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell), ny = Math.ceil((max[1] - min[1]) / cell), nz = Math.ceil((max[2] - min[2]) / cell);
  const sx = nx + 1, sy = ny + 1, grid = new Float32Array(sx * sy * (nz + 1));
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) grid[(k * sy + j) * sx + i] = f.dist(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  const pos = [], v = new Float32Array(8), ev = new Float32Array(36);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let ci = 0;
    for (let c = 0; c < 8; c++) { v[c] = grid[((k + CORNER[c][2]) * sy + j + CORNER[c][1]) * sx + i + CORNER[c][0]]; if (v[c] < 0) ci |= BIT[c]; }
    const bits = edgeTable[ci]; if (!bits) continue;
    for (let e = 0; e < 12; e++) {
      if (!(bits & (1 << e))) continue;
      const a = EDGE[e][0], b = EDGE[e][1], t = v[a] / (v[a] - v[b]);
      ev[e * 3] = min[0] + (i + CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t) * cell;
      ev[e * 3 + 1] = min[1] + (j + CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t) * cell;
      ev[e * 3 + 2] = min[2] + (k + CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t) * cell;
    }
    for (let t = ci << 4; triTable[t] !== -1; t += 3) for (let q = 0; q < 3; q++) { const e = triTable[t + q] * 3; pos.push(ev[e], ev[e + 1], ev[e + 2]); }
  }
  const n = pos.length / 3, P = new Float32Array(pos), N = new Float32Array(n * 3), C = new Float32Array(n * 3), h = cell * 0.5;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let gx = f.dist(x + h, y, z) - f.dist(x - h, y, z), gy = f.dist(x, y + h, z) - f.dist(x, y - h, z), gz = f.dist(x, y, z + h) - f.dist(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1; N[i * 3] = gx / l; N[i * 3 + 1] = gy / l; N[i * 3 + 2] = gz / l;
    const c = f.color(x, y, z); C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
  }
  // make every triangle wind the way its normal points
  for (let i = 0; i < n; i += 3) {
    const ax = P[i * 3 + 3] - P[i * 3], ay = P[i * 3 + 4] - P[i * 3 + 1], az = P[i * 3 + 5] - P[i * 3 + 2], bx = P[i * 3 + 6] - P[i * 3], by = P[i * 3 + 7] - P[i * 3 + 1], bz = P[i * 3 + 8] - P[i * 3 + 2];
    const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    if (fx * N[i * 3] + fy * N[i * 3 + 1] + fz * N[i * 3 + 2] < 0) for (const A of [P, N, C]) for (let q = 0; q < 3; q++) { const t = A[i * 3 + 3 + q]; A[i * 3 + 3 + q] = A[i * 3 + 6 + q]; A[i * 3 + 6 + q] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}
