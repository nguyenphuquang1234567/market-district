// Layout fingerprint: hashes of everything that decides how the map plays (colliders, rails, detail solids, loose
// props, spawns, the navigation grid, anchors, sound emitters, lamps, scanned props and their hulls), plus what is drawn
// (reported, not judged). Two builds whose layout keys match play the same.
// In the page (dev server running):
//   const fp = await import('/tools/layout-fingerprint.js?v=' + Date.now());
//   await fp.fingerprint(G, 'base')          -> posts captures/fp_base.json, returns a summary
// Then: node tools/compare-fingerprints.mjs captures/fp_base.json captures/fp_<tag>.json
import { assets } from '/src/assets.js';

const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
const thash = a => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) { const v = Math.round(a[i] * 1e4); h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 8) & 0xffffff; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16) + ':' + a.length; };
const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

function hasher() {
  const seen = new WeakSet();
  const rep = (k, v) => {
    if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
    if (typeof v === 'function') return undefined;
    if (v && typeof v === 'object') {
      if (ArrayBuffer.isView(v)) return 'TA' + thash(v);
      if (v.isObject3D || v.isBufferGeometry || v.isMaterial || v.isTexture) return (v.type || '') + ':' + (v.name || '');
      if (seen.has(v)) return '[ref]';
      seen.add(v);
    }
    return v;
  };
  return x => { const s = JSON.stringify(x, rep); return fnv(s) + ':' + s.length; };
}

export function collect(G, tag) {
  const W = G.world, h = hasher();
  const byName = list => { const o = {}; for (const m of list) { const k = m.name + (m.userData.kitLod ? '|' + m.userData.kitLod : ''); o[k] = (o[k] || 0) + tris(m.geometry); } return o; };
  return {
    tag,
    protos: Object.fromEntries(Object.entries(assets.proto).map(([k, p]) => [k, { tris: p.parts.reduce((t, q) => t + tris(q.geometry), 0), size: [p.size.x, p.size.y, p.size.z].map(v => +v.toFixed(3)), small: p.small }])),
    hulls: Object.fromEntries(Object.entries(assets.proto).filter(([, p]) => p.hull).map(([k, p]) => [k, thash(p.hull)])),
    colliders: [W.colliders.length, h(W.colliders)],
    lowColliders: h(W.colliders.filter(b => b.y0 <= 1.6)),
    rails: [W.rails.length, h(W.rails)],
    details: [W.details.length, h(W.details)],
    dynamic: [W.dynamic.length, h(W.dynamic.map(d => [d.name, d.x, d.y, d.z, d.rot, d.scale, d.tilt]))],
    spawns: h(W.spawns),
    nav: Object.fromEntries(Object.entries(W.nav).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, ArrayBuffer.isView(v) ? thash(v) : h(v)])),
    anchors: [W.anchors.length, h(W.anchors.map(a => [a.kind, a.x, a.z]))],
    emitters: [W.emitters.length, h(W.emitters)],
    lamps: [W.lamps.length, h(W.lamps)],
    nearTris: Object.fromEntries(Object.entries(assets.proto).filter(([, p]) => p.near).map(([k, p]) => [k, p.near.reduce((t, q) => t + tris(q.geometry), 0)])),
    drawn: byName(W.group.children),
    drawnIndexTotal: W.group.children.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : 0), 0),
    rayMeshes: byName(W.rayMeshes),
    clothMeshes: byName(W.clothMeshes),
  };
}

export async function fingerprint(G, tag) {
  const out = collect(G, tag);
  await fetch('/__capture/fp_' + tag + '.json', { method: 'POST', body: JSON.stringify(out, null, 1) });
  return { tag, colliders: out.colliders, dynamic: out.dynamic, emitters: out.emitters, hulls: Object.keys(out.hulls).length, drawnIndexTotal: out.drawnIndexTotal };
}
