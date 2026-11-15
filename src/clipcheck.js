// How far loose props sink into solid things, measured two ways (used by the self-test and tools/clip-probe.js).
//   boxPen   - deepest hull point inside a collision box of the static world (what the movement and the solver know)
//   drawnPen - deepest hull point behind a drawn surface (rays from the prop's centre to each hull point; what the eye sees)
// In the page: const clip = await import('/src/clipcheck.js'); clip.scan(G)
import * as THREE from 'three';
import { assets } from './assets.js';

const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
const q = new THREE.Quaternion(), o = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();

// the drawn static meshes (not set-dressing props, not the ground) whose bounds come within r of p
let boxes = null, boxesFor = null;
function nearMeshes(G, p, r) {
  if (boxesFor !== G.world) {
    boxesFor = G.world;
    boxes = G.world.rayMeshes.filter(m => !m.name.startsWith('prop:') && m.name !== 'ground').map(m => { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return { m, b: m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld) }; });
  }
  const out = [];
  for (const e of boxes) { const b = e.b; if (p.x > b.min.x - r && p.x < b.max.x + r && p.y > b.min.y - r && p.y < b.max.y + r && p.z > b.min.z - r && p.z < b.max.z + r) out.push(e.m); }
  return out;
}

// penetration of one loose prop at its current pose
export function prop(G, it, boxes = [...G.world.colliders, ...(G.world.details || [])]) {
  const hull = assets.proto[it.name].hull;
  const t = it.body.translation(), r = it.body.rotation(); q.set(r.x, r.y, r.z, r.w); o.set(t.x, t.y, t.z);
  const wp = [];
  for (let i = 0; i < hull.length; i += 3) wp.push(new THREE.Vector3(hull[i] * it.scale, hull[i + 1] * it.scale, hull[i + 2] * it.scale).applyQuaternion(q).add(o));
  let boxPen = 0, surf = null, box = null;
  for (const b of boxes) for (const p of wp) {
    if (p.y < b.y0 + 0.01 || p.y > b.y1 - 0.01) continue;
    const dx = p.x - b.x, dz = p.z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c, ox = b.hx - Math.abs(lx), oz = b.hz - Math.abs(lz);
    const pen = Math.min(ox, oz, p.y - b.y0, b.y1 - p.y);
    if (ox > 0 && oz > 0 && pen > boxPen) { boxPen = pen; surf = b.surf; box = `${b.x.toFixed(2)},${b.z.toFixed(2)} ${(b.hx * 2).toFixed(2)}x${(b.hz * 2).toFixed(2)} y${b.y0.toFixed(2)}-${b.y1.toFixed(2)}`; }
  }
  const ys = wp.map(p => p.y), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  c.set(o.x, mid, o.z);
  let drawnPen = 0, what = null;
  const near = nearMeshes(G, c, 1.2);
  for (const p of wp) {
    d.subVectors(p, c); const L = d.length(); if (L < 0.05) continue; d.divideScalar(L);
    ray.set(c, d); ray.far = L;
    const h = ray.intersectObjects(near, false)[0];
    if (h && L - h.distance > drawnPen) { drawnPen = L - h.distance; what = h.object.name; }
  }
  return { name: it.name, i: it.index, now: [+t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2)], home: [+it.home.x.toFixed(2), +it.home.z.toFixed(2)], boxPen: +boxPen.toFixed(3), surf, box, drawnPen: +drawnPen.toFixed(3), what };
}

// every loose prop (or those passing `filter`), worst first
export function scan(G, { filter = () => true, min = 0.005 } = {}) {
  return G.rigid.props.filter(filter).map(it => prop(G, it)).filter(r => r.boxPen > min || r.drawnPen > min).sort((a, b) => Math.max(b.boxPen, b.drawnPen) - Math.max(a.boxPen, a.drawnPen));
}

// The player walks straight into a chair set `gap` metres out from a wall face at x = wallX (the wall's normal is +x).
// Returns the worst penetration seen over `secs` of shoving.
export function shove(G, { z, wallX = -6, y = 0.15, gap = 0.42, from = 3.0, secs = 2.5, name = 'chair', yaw = Math.PI / 2 + 0.3 } = {}) {
  const Rg = G.rigid, P = G.player, it = Rg.props.find(p => p.name === name);
  Rg.reset();
  q.setFromEuler(new THREE.Euler(0, yaw, 0));
  it.body.setTranslation({ x: wallX + gap, y, z }, true); it.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  G.goto(wallX + from, z, -90, 0); P.sim.f = 1;
  const real = G.R.render; G.R.render = () => {};
  const worst = { boxPen: 0, drawnPen: 0, what: null };
  try {
    for (let k = 0; k < Math.round(secs * 60); k++) {
      G.step(1, 1 / 60);
      if (k % 3) continue;
      const r = prop(G, it);
      if (r.boxPen > worst.boxPen) { worst.boxPen = r.boxPen; worst.surf = r.surf; }
      if (r.drawnPen > worst.drawnPen) { worst.drawnPen = r.drawnPen; worst.what = r.what; }
      worst.now = r.now;
    }
  } finally { G.R.render = real; P.sim.f = 0; }
  return { z, playerX: +P.pos.x.toFixed(2), ...worst };
}
