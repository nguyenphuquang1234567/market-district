// Accumulates static geometry per material (world-space, world-scaled UVs), prop instances, and collision boxes.
import { DYNAMIC } from './rigid.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from './assets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const e1 = V(), e2 = V(), nrm = V(), tmp = V();
const WHITE = [1, 1, 1];

export class Builder {
  constructor() {
    this.buckets = new Map();   // material key -> arrays
    this.props = new Map(); this.dynCand = []; this.dynamic = []; this.emitters = [];     // material -> { geoms: [], surf }
    this.colliders = [];
  }

  // Merged geometry is split into 24 m cells so the camera frustum and each shadow cascade only draw what they cover.
  cell(x, z) { return Math.min(3, Math.max(0, Math.floor((x + 48) / 24))) + 4 * Math.min(6, Math.max(0, Math.floor((z + 84) / 24))); }
  _b(key, x, z, far) {
    const id = key + '|' + (far ? 'far' : this.cell(x, z));
    let b = this.buckets.get(id);
    if (!b) this.buckets.set(id, b = { key, p: [], n: [], u: [], c: [], i: [], x: [] });
    return b;
  }

  // Quad a,b,c,d counter-clockwise seen from the front. UVs are projected in world space (o.tile metres per repeat)
  // unless o.uv = [u0,v0,u1,v1] is given. o.color tints, o.colors gives per-corner tints, o.x = extra vec3 attribute.
  quad(key, a, b, c, d, o = {}) {
    const k = this._b(key, (a.x + c.x) / 2, (a.z + c.z) / 2, o.far), base = k.p.length / 3, tile = o.tile || 2.6;
    e1.subVectors(b, a); e2.subVectors(d, a); nrm.crossVectors(e1, e2).normalize();
    const floor = Math.abs(nrm.y) > 0.7, uo = o.uo || 0, vo = o.vo || 0;
    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      const v = pts[i];
      k.p.push(v.x, v.y, v.z); k.n.push(nrm.x, nrm.y, nrm.z);
      if (o.uv) {
        const q = o.uv; k.u.push(i === 0 || i === 3 ? q[0] : q[2], i < 2 ? q[1] : q[3]);
      } else if (floor) {
        k.u.push(v.x / tile + uo, (-v.z * Math.sign(nrm.y)) / tile + vo);
      } else {
        k.u.push((v.x * nrm.z - v.z * nrm.x) / tile + uo, v.y / tile + vo);
      }
      const col = o.colors ? o.colors[i] : (o.color || WHITE);
      k.c.push(col[0], col[1], col[2]);
      const x = o.xs ? o.xs[i] : (o.x || WHITE);
      k.x.push(x[0], x[1], x[2]);
    }
    k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Box by centre and size, optional yaw. o.skip: string of faces to omit from 'xXyYzZ' (lower = negative side).
  box(key, cx, cy, cz, sx, sy, sz, o = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, r = o.rot || 0, c = Math.cos(r), s = Math.sin(r), skip = o.skip || '';
    const P = (x, y, z) => V(cx + x * c + z * s, cy + y, cz - x * s + z * c);
    const p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    if (!skip.includes('Z')) this.quad(key, p[4], p[5], p[6], p[7], o);
    if (!skip.includes('z')) this.quad(key, p[1], p[0], p[3], p[2], o);
    if (!skip.includes('X')) this.quad(key, p[5], p[1], p[2], p[6], o);
    if (!skip.includes('x')) this.quad(key, p[0], p[4], p[7], p[3], o);
    if (!skip.includes('Y')) this.quad(key, p[7], p[6], p[2], p[3], o);
    if (!skip.includes('y')) this.quad(key, p[0], p[1], p[5], p[4], o);
  }

  // Arbitrary geometry with its own UVs (cylinders, lathes, extrusions…).
  geom(key, g, m, o = {}) {
    tmp.fromBufferAttribute(g.attributes.position, 0).applyMatrix4(m);            // any vertex will do to pick the cell
    const k = this._b(key, tmp.x, tmp.z), base = k.p.length / 3, us = o.uvScale || 1;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(m); k.p.push(tmp.x, tmp.y, tmp.z);
      tmp.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); k.n.push(tmp.x, tmp.y, tmp.z);
      k.u.push(uv ? uv.getX(i) * us : 0, uv ? uv.getY(i) * (o.uvScaleY || us) : 0);
      const col = o.cf ? o.cf(i) : (o.color || WHITE); k.c.push(col[0], col[1], col[2]);
      const x = o.xf ? o.xf(i, pos) : WHITE; k.x.push(x[0], x[1], x[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) k.i.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) k.i.push(base + i);
  }

  // Place a scanned prop. Returns its footprint size (after scale) so callers can add a collider.
  prop(name, x, y, z, rot = 0, scale = 1, tilt = null, solid = null) {
    const pr = assets.proto[name];
    if (name === 'ac' || name === 'ac_rust') this.emitters.push({ kind: 'hum', x, y: y + 0.3, z });      // these hum (audio)
    if (DYNAMIC[name] && !this._sorted) { this.dynCand.push({ name, x, y, z, rot, scale, tilt, solid }); return pr.size; }      // decided in build()
    const m = new THREE.Matrix4().compose(V(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt ? tilt[0] : 0, rot, tilt ? tilt[1] : 0, 'YXZ')), V(scale, scale, scale));
    const chunk = this.cell(x, z) * 2 + ((pr.small && scale < 1.6) || /^(weed|bush|shelves|basket)/.test(name) ? 1 : 0);   // odd = too small to cast shadows
    for (const part of pr.parts) {
      let per = this.props.get(part.material);
      if (!per) this.props.set(part.material, per = new Map());
      if (!per.has(chunk)) per.set(chunk, []);
      per.get(chunk).push(part.geometry.clone().applyMatrix4(m));
    }
    return pr.size;
  }

  // Yawed box collider. surf is what bots' bullets and footsteps report.
  collide(cx, cy, cz, sx, sy, sz, rot = 0, surf = 'concrete', flags = 0) {
    this.colliders.push({ x: cx, z: cz, hx: sx / 2, hz: sz / 2, y0: cy - sy / 2, y1: cy + sy / 2, c: Math.cos(rot), s: Math.sin(rot), surf, flags });
  }

  propSolid(name, x, y, z, rot = 0, scale = 1, surf = 'wood', shrink = 0.92) {
    if (DYNAMIC[name]) return this.prop(name, x, y, z, rot, scale, null, { surf, shrink });
    const s = this.prop(name, x, y, z, rot, scale);
    this.collide(x, y + (s.y * scale) / 2, z, s.x * scale * shrink, s.y * scale, s.z * scale * shrink, rot, surf);
    return s;
  }

  // Loose clutter becomes a rigid body when something solid is directly under it (ground, a collider, or another loose
  // prop); anything resting on set dressing without a collider, or buried in one, stays part of the static scenery.
  _classify() {
    const cands = this.dynCand.sort((a, b) => a.y - b.y), cols = this.colliders, dyn = this.dynamic = [];
    this._sorted = true;
    for (const c of cands) {
      const s = assets.proto[c.name].size; c.top = c.tilt ? Math.min(s.x, s.z) * c.scale : s.y * c.scale; c.foot = Math.max(s.x, s.z) * c.scale * 0.5;
      let sup = 0, inside = false;
      for (const b of cols) {
        const dx = c.x - b.x, dz = c.z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
        if (Math.abs(lx) > b.hx || Math.abs(lz) > b.hz) continue;
        if (b.y0 < c.y + 0.1 && b.y1 > c.y + 0.12) inside = true; else if (b.y1 <= c.y + 0.1 && b.y1 > sup) sup = b.y1;
      }
      for (const d of dyn) if (Math.abs(d.x - c.x) < d.foot + 0.05 && Math.abs(d.z - c.z) < d.foot + 0.05 && d.y + d.top <= c.y + 0.1 && d.y + d.top > sup) sup = d.y + d.top;
      if (!inside && c.y - sup < 0.1) dyn.push(c);
      else { this.prop(c.name, c.x, c.y, c.z, c.rot, c.scale, c.tilt); if (c.solid) this.collide(c.x, c.y + (s.y * c.scale) / 2, c.z, s.x * c.scale * c.solid.shrink, s.y * c.scale, s.z * c.scale * c.solid.shrink, c.rot, c.solid.surf); }
    }
    this.dynCand = [];
  }

  build(M) {
    this._classify();
    const meshes = [];
    for (const k of this.buckets.values()) {
      const key = k.key;
      if (!k.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(k.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(k.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(k.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(k.c, 3));
      if (key === 'ground') g.setAttribute('aBlend', new THREE.Float32BufferAttribute(k.x, 3));
      if (M[key].userData.patchKey?.startsWith('wind')) g.setAttribute('aWind', new THREE.Float32BufferAttribute(k.x.filter((_, i) => i % 3 < 2), 2));
      g.setIndex(k.i);
      const mesh = new THREE.Mesh(g, M[key]);
      mesh.name = key; mesh.userData.surf = M[key].userData.surf;
      meshes.push(mesh);
    }
    for (const [mat, per] of this.props) for (const [ci, geoms] of per) {
      const g = mergeGeometries(geoms);
      if (!g) { console.warn('prop merge failed', mat.name); continue; }
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'prop:' + mat.name; mesh.userData.surf = mat.userData.surf || 'wood'; mesh.userData.noShadow = ci % 2 === 1;
      if (mat.userData.foliage) { mesh.userData.noAO = true; mesh.userData.noBVH = true; }
      meshes.push(mesh);
    }
    this.buckets.clear(); this.props.clear();
    return meshes;
  }
}
