// Checks for the Blender detail pass (docs/superpowers/plans/2026-11-16-blender-detail-pass.md). In the page:
//   const dc = await import('/tools/detail-check.js?v=' + Date.now()); dc.report()
// builder(): the Builder's near/far plumbing on synthetic input. pieces(): every props.glb piece listed in PIECES is
// loaded, within its triangle cap, inside its envelope (the space the old geometry took), and carries the wind and
// texture coordinates its slots need. totals(): the caps of pieces drawn together (a palm, the kiosk, the chapel).
// Each returns a list of problems; empty means it passed.
import * as THREE from 'three';
import { Builder } from '/src/builder.js';
import { assets } from '/src/assets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

// name -> { cap, box: [[x0, y0, z0], [x1, y1, z1]] in the piece's own frame (three.js axes, metres at scale 1),
//           wind: [slots whose vertex alpha is wind freedom], ownUV: [slots mapped by their own UVs],
//           check(parts) -> a problem or null }
export const PIECES = {};
const add = (names, spec) => { for (const n of names) PIECES[n] = spec; };
// pebbles (dressing.js scatter): unit stones placed by the old box's matrix
add(['pebble_a', 'pebble_b', 'pebble_c', 'pebble_d'], { cap: 80, min: 40, box: [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], slots: ['stone'] });
// spice sacks (dressing.js sack()): on the ground at the origin, the old lathe's 0.275 m radius and 0.5 m height
add(['sack_a', 'sack_b'], { cap: 2500, box: [[-0.28, 0, -0.28], [0.28, 0.52, 0.28]], slots: ['burlap', 'spice'] });
// rubble heaps (dressing.js rubble()): a unit heap, stretched by the game to each heap's radius and height; inside the
// old keep-out (1.25 r) and under 1.15 h
add(['rubble_a', 'rubble_b', 'rubble_c'], { cap: 12000, box: [[-1.25, 0, -1.25], [1.25, 1.15, 1.25]], slots: ['concrete', 'brick', 'gravel'] });
// street carts (quarter.js cart()): X along the cart, Z towards the painted sign, which the game draws at z 0.417 over
// x -0.6...0.6, y 0.48...1.08: the body's front must stay flat behind it (a wheel may stand in front, as the old one did)
const flatFront = parts => {
  let bad = 0;
  for (const p of parts) { if (p.slot !== 'body') continue; const a = p.geometry.attributes.position; for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i)) < 0.62 && a.getY(i) > 0.45 && a.getY(i) < 1.1 && a.getZ(i) > 0.41) bad++; }
  return bad ? `${bad} body vertices in front of the sign's panel` : null;
};
add(['cart'], { cap: 15000, box: [[-0.92, 0, -0.53], [0.92, 2.1, 0.53]], slots: ['body', 'steel', 'tin', 'iron', 'rubber'], check: flatFront });
// name -> () => [triangles, cap], for things drawn as several pieces
export const TOTALS = {};

export function builder() {
  const out = [], fail = m => out.push(m);
  const quad = (B, o) => B.quad('concrete', V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0), o);
  if (typeof new Builder().swap !== 'function') return ['Builder.swap is not a function'];
  { // a missing piece: the old geometry is drawn untagged, as before, and the near version is never asked for
    const B = new Builder(); let asked = false;
    B.swap('__missing__', () => quad(B), () => { asked = true; });
    const ids = [...B.buckets.keys()];
    if (ids.length !== 1 || /\|(far|near)$/.test(ids[0])) fail('swap(missing): the far version is not drawn untagged: ' + ids);
    if (asked) fail('swap(missing): near() was called');
  }
  { // a piece that is there: far tagged far, the piece tagged near with its own UVs (v flipped back) and wind from alpha
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0.2, 1, 1, 1, 0.6, 1, 1, 1, 1], 4));
    const keep = assets.kit;
    assets.kit = { ...(keep || {}), __t: [{ geometry: g, slot: 'a' }] };
    try {
      const B = new Builder();
      const ret = B.swap('__t', () => { quad(B); return 7; }, () => B.kit('__t', new THREE.Matrix4(), { a: 'leaf' }, { lod: 'near', slot: { a: { uv: 'own', tile: 1, wind: 2 } } }));
      if (ret !== 7) fail('swap: does not return what far() returned');
      if (B.lodDefault !== null) fail('swap: lodDefault not restored: ' + B.lodDefault);
      const ids = [...B.buckets.keys()], far = ids.find(i => i.startsWith('concrete|')), near = ids.find(i => i.startsWith('leaf|'));
      if (!far?.endsWith('|far')) fail('swap: the far version is not tagged far: ' + ids);
      if (!near?.endsWith('|near')) fail('swap: the piece is not tagged near: ' + ids);
      const k = near && B.buckets.get(near);
      if (k && !close(k.u, [0, 1, 1, 1, 0, 0])) fail('kit uv:own: ' + k.u);
      if (k && !close(k.x, [0.2, 2, 0, 0.6, 2, 0, 1, 2, 0])) fail('kit wind: ' + k.x);
      const B2 = new Builder();                                           // a throw in far() still restores the default
      try { B2.swap('__t', () => { throw new Error('x'); }, () => {}); } catch { /* expected */ }
      if (B2.lodDefault !== null) fail('swap: lodDefault left set after far() threw');
    } finally { assets.kit = keep; }
  }
  { // geom passes its lod; under lodDefault an untagged draw takes it, an explicit null stays untagged
    const B = new Builder();
    B.geom('iron', new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4(), { lod: 'near' });
    if (![...B.buckets.keys()][0]?.endsWith('|near')) fail('geom: o.lod not passed: ' + [...B.buckets.keys()]);
    const C = new Builder(); C.lodDefault = 'far';
    C.geom('iron', new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4());
    quad(C, { lod: null });
    const ids = [...C.buckets.keys()];
    if (!ids.find(i => i.startsWith('iron|'))?.endsWith('|far')) fail('lodDefault: geom not tagged far: ' + ids);
    if (/\|(far|near)$/.test(ids.find(i => i.startsWith('concrete|')) || '|far')) fail('lodDefault: explicit lod null got tagged: ' + ids);
  }
  return out;
}

const trisOf = parts => parts.reduce((t, p) => t + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0);
export const tris = name => (assets.kit?.[name] ? trisOf(assets.kit[name]) : NaN);

export function pieces(names = Object.keys(PIECES)) {
  const out = [];
  for (const name of names) {
    const spec = PIECES[name], parts = assets.kit?.[name];
    if (!parts) { out.push(`${name} missing`); continue; }
    const t = trisOf(parts);
    if (t > spec.cap) out.push(`${name}: ${t} triangles, cap ${spec.cap}`);
    if (spec.min && t < spec.min) out.push(`${name}: ${t} triangles, under ${spec.min}`);
    const [lo, hi] = spec.box; let outside = 0, worst = 0, aLo = Infinity, aHi = -Infinity;
    for (const p of parts) {
      const g = p.geometry, pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) for (let a = 0; a < 3; a++) {
        const v = pos.getComponent(i, a), d = Math.max(lo[a] - 0.01 - v, v - hi[a] - 0.01, 0);
        if (d > 0) { outside++; worst = Math.max(worst, d); }
      }
      if (spec.ownUV?.includes(p.slot) && !g.attributes.uv) out.push(`${name}: slot ${p.slot} has no texture coordinates`);
      if (spec.wind?.includes(p.slot)) {
        const c = g.attributes.color;
        if (!c || c.itemSize < 4) out.push(`${name}: slot ${p.slot} has no vertex alpha (wind)`);
        else for (let i = 0; i < c.count; i++) { const w = c.getW(i); aLo = Math.min(aLo, w); aHi = Math.max(aHi, w); }
      }
    }
    if (outside) out.push(`${name}: ${outside} vertex coordinates outside its envelope (worst ${worst.toFixed(3)} m)`);
    if (spec.wind && aHi - aLo < 0.5) out.push(`${name}: wind alpha spans only ${(aHi - aLo).toFixed(2)}`);
    for (const s of spec.slots || []) if (!parts.some(p => p.slot === s)) out.push(`${name}: no slot ${s}`);
    const c = spec.check?.(parts); if (c) out.push(`${name}: ${c}`);
  }
  return out;
}

export function totals() {
  const out = [];
  for (const [name, f] of Object.entries(TOTALS)) { const [t, cap] = f(); if (!(t <= cap)) out.push(`${name}: ${t} triangles together, cap ${cap}`); }
  return out;
}

// Is this kit mesh the version on screen from p (the renderer's own test, render.js cull, without the distance cut)?
function shownFrom(G, o, p) {
  const u = o.userData; if (!u.kitLod) return true;
  const b = u.lodBox, kn = G.R.kitNear * G.R.lodScale, dx = Math.max(b[0] - p.x, 0, p.x - b[2]), dz = Math.max(b[1] - p.z, 0, p.z - b[3]);
  return (dx * dx + dz * dz < kn * kn) === (u.kitLod === 'near');
}
// Rounds fired by the player's own code (player.fire) from eye at points scattered round `at`: how many impacts land in
// front of what is drawn there, on a version of a piece that is not on screen. { shots, impacts, floating, worst (m) }.
export function impacts(G, eye, at, n = 60, spread = 1.2) {
  const THREE = G.THREE, cam = G.R.camera, rec = [], keep = G.fx.impact, ray = new THREE.Raycaster();
  G.fx.impact = (surf, end) => { rec.push(end.clone()); };
  try {
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, d = spread * Math.sqrt((i + 0.5) / n);
      cam.position.set(eye.x, eye.y, eye.z); cam.lookAt(at.x + Math.cos(a) * d, at.y, at.z + Math.sin(a) * d); cam.updateMatrixWorld();
      G.player.fire(0, 0, 0);
    }
  } finally { G.fx.impact = keep; }
  let floating = 0, worst = 0;
  for (const end of rec) {                                                  // the first surface on screen along the same line
    const dir = end.clone().sub(eye), len = dir.length(); ray.set(eye, dir.normalize()); ray.far = len + 2;
    const hit = ray.intersectObjects(G.world.rayMeshes, false).filter(h => shownFrom(G, h.object, eye)).sort((p, q) => p.distance - q.distance)[0];
    const gap = hit ? hit.distance - len : 2;
    if (gap > 0.03) { floating++; worst = Math.max(worst, gap); }
  }
  return { shots: n, impacts: rec.length, floating, worst: +worst.toFixed(3) };
}

export const report = () => ({ builder: builder(), pieces: pieces(), totals: totals() });
