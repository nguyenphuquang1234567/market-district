import * as THREE from 'three';

// Seeded PRNG (mulberry32) so the map and effects are reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  f.sign = () => (f() < 0.5 ? -1 : 1);
  return f;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smooth = t => t * t * (3 - 2 * t);
export const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Tileable fbm value-noise, 3 decorrelated channels. Used for weathering, blending and grunge.
export function noiseTexture(size = 256, seed = 1) {
  const R = rng(seed);
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 3; ch++) {
    const acc = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let cells = 4; cells <= 64; cells *= 2) {
      const g = new Float32Array(cells * cells);
      for (let i = 0; i < g.length; i++) g[i] = R();
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * cells, y0 = Math.floor(fy), ty = smooth(fy - y0);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cells, x0 = Math.floor(fx), tx = smooth(fx - x0);
          const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
          const v = lerp(lerp(g[y0 * cells + x0], g[y0 * cells + x1], tx), lerp(g[y1 * cells + x0], g[y1 * cells + x1], tx), ty);
          acc[y * size + x] += v * amp;
        }
      }
      total += amp; amp *= 0.55;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = clamp((acc[i] / total - 0.5) * 1.9 + 0.5, 0, 1) * 255;
  }
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
