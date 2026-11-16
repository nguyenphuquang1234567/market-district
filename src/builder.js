// Accumulates static geometry per material (world-space, world-scaled UVs), prop instances, and collision boxes.
import { DYNAMIC } from './rigid.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from './assets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const e1 = V(), e2 = V(), nrm = V(), tmp = V();
const WHITE = [1, 1, 1];
// Drawn boxes whose bottom is below this become solid for loose props, bodies and dropped rifles (see details()).
const DETAIL_TOP = 2.8;
// What a loose prop sounds like when it knocks into a drawn detail, by material key.
const DETAIL_SURF = { planks: 'wood', shutter_wood: 'wood', door: 'wood', iron: 'metal', metal_white: 'metal', metal_green: 'metal', metal_plate: 'metal', shutter_metal: 'metal', corrugated: 'metal', w_brick: 'brick', burlap: 'fabric', tiles: 'concrete' };

// Do two yawed boxes overlap in plan? Boxes use the colliders' convention ({ x, z, hx, hz, c, s }: local x is world
// (c, -s), local z is world (s, c)). Returns the shortest shove { x, z, d } that moves `a` clear of `b`, else null.
export function overlap2(a, b, margin = 0) {
  const dx = a.x - b.x, dz = a.z - b.z; let best = Infinity, bx = 0, bz = 0;
  for (const [ux, uz] of [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]]) {
    const ra = a.hx * Math.abs(a.c * ux - a.s * uz) + a.hz * Math.abs(a.s * ux + a.c * uz);
    const rb = b.hx * Math.abs(b.c * ux - b.s * uz) + b.hz * Math.abs(b.s * ux + b.c * uz);
    const d = dx * ux + dz * uz, o = ra + rb + margin - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d < 0 ? -1 : 1; bx = ux * o * sg; bz = uz * o * sg; }
  }
  return { x: bx, z: bz, d: best };
}

// Coarse spatial hash of yawed boxes, so placement and containment tests only look at what is nearby.
class BoxHash {
  constructor(boxes, cell = 4) {
    this.cell = cell; this.map = new Map();
    for (const b of boxes) {
      const r = b.hx + b.hz;
      for (let i = Math.floor((b.x - r) / cell); i <= Math.floor((b.x + r) / cell); i++) for (let j = Math.floor((b.z - r) / cell); j <= Math.floor((b.z + r) / cell); j++) {
        const k = i * 4096 + j; let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(b);
      }
    }
  }
  near(x, z, r) {
    const out = new Set(), c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) { const l = this.map.get(i * 4096 + j); if (l) for (const b of l) out.add(b); }
    return out;
  }
}

export class Builder {
  constructor() {
    this.buckets = new Map();   // material key -> arrays
    this.props = new Map(); this.dynCand = []; this.dynamic = []; this.emitters = [];     // material -> { geoms: [], surf }
    this.lamps = [];            // lit bulbs: point lights for the light bake (gi.js), { x, y, z, c: [r, g, b] relative strength }
    this.colliders = [];
    this.drawnBoxes = [];       // every drawn box low enough for loose clutter to reach (sorted out in details())
    this.details = [];          // solids only the rigid world knows: drawn things the movement boxes do not cover
    this.dropped = [];          // loose props that could not be dressed clear of anything solid
    this.mute = false;          // while set, everything is generated as usual (same random draws) but nothing is kept
    this.lodDefault = null;     // the lod of anything drawn without one (see swap())
    this.muteDraw = false;      // while set, nothing is drawn but solids are still recorded (see replace())
  }

  // Merged geometry is split into 24 m cells so the camera frustum and each shadow cascade only draw what they cover.
  // The columns break at x = 22 and 46, so no cell straddles the east ring: the renderer can then leave out whichever
  // side of the ring the camera cannot see (see render.js, zone culling).
  cell(x, z) { return Math.min(6, Math.max(0, Math.floor((x + 50) / 24))) + 7 * Math.min(6, Math.max(0, Math.floor((z + 84) / 24))); }
  // lod: 'near' for the detailed architectural kit, 'far' for the plain stand-in it replaces; the renderer shows one or
  // the other per cell by distance (render.js, cull). Untagged geometry is always drawn. Without a lod (undefined) a draw
  // takes lodDefault; null means untagged even then.
  _b(key, x, z, far, lod) {
    if (lod === undefined && !far) lod = this.lodDefault;
    const cell = far ? -1 : this.cell(x, z), id = key + '|' + (far ? 'far' : cell) + (lod ? '|' + lod : '');
    let b = this.buckets.get(id);
    if (!b) this.buckets.set(id, b = { key, lod, cell, p: [], n: [], u: [], c: [], i: [], x: [] });
    return b;
  }

  // Quad a,b,c,d counter-clockwise seen from the front. UVs are projected in world space (o.tile metres per repeat)
  // unless o.uv = [u0,v0,u1,v1] is given. o.color tints, o.colors gives per-corner tints, o.x = extra vec3 attribute.
  quad(key, a, b, c, d, o = {}) {
    if (this.mute || this.muteDraw) return;
    const k = this._b(key, (a.x + c.x) / 2, (a.z + c.z) / 2, o.far, o.lod), base = k.p.length / 3, tile = o.tile || 2.6;
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
    if (this.mute) return;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, r = o.rot || 0, c = Math.cos(r), s = Math.sin(r), skip = o.skip || '';
    const P = (x, y, z) => V(cx + x * c + z * s, cy + y, cz - x * s + z * c);
    const p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    if (!skip.includes('Z')) this.quad(key, p[4], p[5], p[6], p[7], o);
    if (!skip.includes('z')) this.quad(key, p[1], p[0], p[3], p[2], o);
    if (!skip.includes('X')) this.quad(key, p[5], p[1], p[2], p[6], o);
    if (!skip.includes('x')) this.quad(key, p[0], p[4], p[7], p[3], o);
    if (!skip.includes('Y')) this.quad(key, p[7], p[6], p[2], p[3], o);
    if (!skip.includes('y')) this.quad(key, p[0], p[1], p[5], p[4], o);
    if (o.solid !== false && cy - hy < DETAIL_TOP && cy + hy > 0.03 && Math.min(sx, sy, sz) >= 0.012) this.drawnBoxes.push({ key, x: cx, z: cz, hx, hz, y0: cy - hy, y1: cy + hy, c, s });
  }

  // A solid only the rigid world collides with (loose props, bodies, dropped rifles, thrown objects); soldiers' movement,
  // sight and the navigation grid ignore it. For drawn things that are not boxes: pipes, sacks, mounds of rubble.
  // place: false for a solid that things are dressed onto or into (shelving), so it does not push its own goods away.
  detail(cx, cy, cz, sx, sy, sz, rot = 0, surf = 'concrete', place = true) {
    if (this.mute) return;
    this.details.push({ x: cx, z: cz, hx: sx / 2, hz: sz / 2, y0: cy - sy / 2, y1: cy + sy / 2, c: Math.cos(rot), s: Math.sin(rot), surf, place });
  }
  // Ground that loose clutter must not be dressed onto (the skirt of a mound of rubble). Nothing collides with it.
  keepOut(cx, cy, cz, sx, sy, sz, rot = 0) {
    if (this.mute) return;
    (this.keepOuts ||= []).push({ x: cx, z: cz, hx: sx / 2, hz: sz / 2, y0: cy - sy / 2, y1: cy + sy / 2, c: Math.cos(rot), s: Math.sin(rot) });
  }

  // Arbitrary geometry with its own UVs (cylinders, lathes, extrusions…). o.far, o.lod as in quad().
  geom(key, g, m, o = {}) {
    if (this.mute || this.muteDraw) return;
    tmp.fromBufferAttribute(g.attributes.position, 0).applyMatrix4(m);            // any vertex will do to pick the cell
    const k = this._b(key, tmp.x, tmp.z, o.far, o.lod), base = k.p.length / 3, us = o.uvScale || 1;
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

  // A piece of the architectural kit (assets/kit/kit.glb, modelled in Blender by tools/blender/kit.py): local X along
  // the wall, Y up, Z out of it. m places it (scaling is fine: texture coordinates are projected in world space here,
  // exactly as quad() does, so a moulding's plaster runs on from the wall it sits on). slots maps the piece's material
  // slots (trim, wall, brick, tile, mortar, wood, iron) to material keys; o.slot[name] or o itself gives tile, uo, vo and
  // color per slot. The piece's own vertex colours (each roof tile's shade) multiply the tint. o.lod as in _b() (a slot's own
  // lod, null for none, overrides it). A slot's uv: 'own' maps it by the piece's own texture coordinates (u / tile + uo,
  // v / tile + vo, v counted up as Blender does: glTF's flip is undone) instead of the world projection: leaves, fronds,
  // bark, paper. A slot's wind: phase fills the wind attribute (wind materials) from the piece's vertex alpha, how freely
  // each vertex moves (times windAmp, default 1).
  kit(name, m, slots, o = {}) {
    if (this.mute || this.muteDraw) return;
    const piece = assets.kit?.[name]; if (!piece) return;
    const nm = new THREE.Matrix3().getNormalMatrix(m), e = m.elements;
    for (const part of piece) {
      const key = slots[part.slot]; if (!key) continue;
      const so = o.slot?.[part.slot] || o, tile = so.tile || 1.4, uo = so.uo || 0, vo = so.vo || 0, tint = so.color || WHITE, xx = so.x || WHITE;
      const k = this._b(key, e[12], e[14], false, so.lod !== undefined ? so.lod : o.lod), base = k.p.length / 3, g = part.geometry;
      const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color, uv = so.uv === 'own' ? g.attributes.uv : null;
      const wind = so.wind, amp = so.windAmp ?? 1, alpha = col && col.itemSize === 4;
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(m); const px = tmp.x, py = tmp.y, pz = tmp.z;
        k.p.push(px, py, pz);
        nrm.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); k.n.push(nrm.x, nrm.y, nrm.z);
        const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z);
        if (uv) k.u.push(uv.getX(i) / tile + uo, (1 - uv.getY(i)) / tile + vo);
        else if (ay >= ax && ay >= az) k.u.push(px / tile + uo, (-pz * Math.sign(nrm.y)) / tile + vo);
        else { const sx = ax > az ? Math.sign(nrm.x) : 0, sz = ax > az ? 0 : Math.sign(nrm.z); k.u.push((px * sz - pz * sx) / tile + uo, py / tile + vo); }
        if (col) k.c.push(col.getX(i) * tint[0], col.getY(i) * tint[1], col.getZ(i) * tint[2]); else k.c.push(tint[0], tint[1], tint[2]);
        if (wind !== undefined) k.x.push((alpha ? col.getW(i) : 1) * amp, wind, 0); else k.x.push(xx[0], xx[1], xx[2]);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) k.i.push(base + g.index.getX(i));
      else for (let i = 0; i < pos.count; i++) k.i.push(base + i);
    }
  }

  // The detail pass (tools/blender/props.py): far() draws the old, plain version of something and near() places the
  // modelled kit piece(s) `names` (a name or a list) with lod: 'near'. When every piece is loaded, what far() draws is
  // tagged 'far'; when one is missing, far() is drawn untagged, exactly as before, and near() is not called, so a missing
  // props.glb never leaves a hole. Either way far() makes all its random draws. Returns what far() returns.
  swap(names, far, near) {
    if (![].concat(names).every(n => assets.kit?.[n])) return far();
    const prev = this.lodDefault; this.lodDefault = 'far';
    let ret;
    try { ret = far(); } finally { this.lodDefault = prev; }
    near();
    return ret;
  }

  // The same without a far version (pebbles, sacks, chiles, piñatas, poles, carts, rubble, the chapel's dome, the kiosk):
  // old() runs for its random draws and for the solids it records (colliders, detail solids, keep-outs, low drawn boxes)
  // but draws nothing, and detailed() draws the modelled piece untagged, out to the distance its material is drawn to
  // anyway. A near/far pair would add two meshes, and their draw calls, to every cell the thing is in. With a piece
  // missing old() is drawn as before.
  replace(names, old, detailed) {
    if (![].concat(names).every(n => assets.kit?.[n])) return old();
    const muteDraw = this.muteDraw; this.muteDraw = true;
    let ret;
    try { ret = old(); } finally { this.muteDraw = muteDraw; }
    detailed();
    return ret;
  }

  // Place a scanned prop. Returns its footprint size (after scale) so callers can add a collider.
  // fixed: draw it as scenery even if its kind is loose clutter (a box that belongs to an obstacle's collision box).
  prop(name, x, y, z, rot = 0, scale = 1, tilt = null, solid = null, fixed = false) {
    const pr = assets.proto[name];
    if (this.mute) return pr.size;
    if (name === 'ac' || name === 'ac_rust') this.emitters.push({ kind: 'hum', x, y: y + 0.3, z });      // these hum (audio)
    if (DYNAMIC[name] && !this._sorted && !fixed) {
      if (name === 'chair') solid ??= { surf: 'plastic', shrink: 0.92 };
      this.dynCand.push({ name, x, y, z, rot, scale, tilt, solid });
      return pr.size;
    }
    const m = new THREE.Matrix4().compose(V(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt ? tilt[0] : 0, rot, tilt ? tilt[1] : 0, 'YXZ')), V(scale, scale, scale));
    const chunk = this.cell(x, z) * 2 + ((pr.small && scale < 1.6) || /^(weed|bush|shelves|basket)/.test(name) ? 1 : 0);   // odd = too small to cast shadows
    for (const part of pr.near || pr.parts) {                                      // (the finer cut for drawing, when there is one)
      let per = this.props.get(part.material);
      if (!per) this.props.set(part.material, per = new Map());
      if (!per.has(chunk)) per.set(chunk, []);
      per.get(chunk).push(part.geometry.clone().applyMatrix4(m));
    }
    return pr.size;
  }

  // A prop laid down as it is turned (a tyre on its side): its bounds are centred on (x, z) and rest on y, instead of
  // pivoting about the base of the scan. Returns how tall it stands, for stacking.
  propOn(name, x, y, z, rot = 0, scale = 1, tilt = null) {
    const s = assets.proto[name].size, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt ? tilt[0] : 0, rot, tilt ? tilt[1] : 0, 'YXZ'));
    const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
    for (const cx of [-s.x / 2, s.x / 2]) for (const cy of [0, s.y]) for (const cz of [-s.z / 2, s.z / 2]) { tmp.set(cx * scale, cy * scale, cz * scale).applyQuaternion(q); lo.min(tmp); hi.max(tmp); }
    this.prop(name, x - (lo.x + hi.x) / 2, y - lo.y, z - (lo.z + hi.z) / 2, rot, scale, tilt);
    return hi.y - lo.y;
  }

  // A barrier only a soldier's movement collides with (a see-through railing): it is not cover, does not block sight,
  // bullets or sound, and is not in the navigation grid. Same box convention as collide().
  rail(cx, cy, cz, sx, sy, sz, rot = 0) {
    if (this.mute) return;
    (this.rails ||= []).push({ x: cx, z: cz, hx: sx / 2, hz: sz / 2, y0: cy - sy / 2, y1: cy + sy / 2, c: Math.cos(rot), s: Math.sin(rot), surf: 'metal', flags: 0 });
  }

  // A lit bulb, for the light bake: warm (2700 K-ish) unless c says otherwise, strength 1 = the standard market bulb.
  lamp(x, y, z, c = [1, 0.72, 0.43]) { if (!this.mute) this.lamps.push({ x, y, z, c }); }

  // Yawed box collider. surf is what bots' bullets and footsteps report.
  // The same, joining the others only after the loose clutter has been sorted (build()): balconies, so that the pots
  // standing on them stay set dressing and nothing dressed before is shoved about or left out.
  collideLater(cx, cy, cz, sx, sy, sz, rot = 0, surf = 'concrete', flags = 0) {
    if (this.mute) return;
    (this.later ||= []).push({ x: cx, z: cz, hx: sx / 2, hz: sz / 2, y0: cy - sy / 2, y1: cy + sy / 2, c: Math.cos(rot), s: Math.sin(rot), surf, flags });
  }

  collide(cx, cy, cz, sx, sy, sz, rot = 0, surf = 'concrete', flags = 0) {
    if (this.mute) return;
    this.colliders.push({ x: cx, z: cz, hx: sx / 2, hz: sz / 2, y0: cy - sy / 2, y1: cy + sy / 2, c: Math.cos(rot), s: Math.sin(rot), surf, flags });
  }

  propSolid(name, x, y, z, rot = 0, scale = 1, surf = 'wood', shrink = 0.92) {
    if (DYNAMIC[name]) return this.prop(name, x, y, z, rot, scale, null, { surf, shrink });
    const s = this.prop(name, x, y, z, rot, scale);
    this.collide(x, y + (s.y * scale) / 2, z, s.x * scale * shrink, s.y * scale, s.z * scale * shrink, rot, surf);
    return s;
  }

  // Every drawn box the movement boxes do not already contain becomes a detail solid for the rigid world: plinths,
  // sills, door and shutter frames, stall posts and counters, steps, kerbs. Without them a chair came to rest against
  // the wall's collision box with its legs inside the plinth drawn in front of it.
  _details() {
    const hash = new BoxHash(this.colliders), inside = (b, c) => {
      if (b.y0 < c.y0 - 0.01 || b.y1 > c.y1 + 0.01) return false;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = b.x + u * b.hx * b.c + v * b.hz * b.s, pz = b.z - u * b.hx * b.s + v * b.hz * b.c;       // corner in world space
        const dx = px - c.x, dz = pz - c.z;
        if (Math.abs(dx * c.c - dz * c.s) > c.hx + 0.01 || Math.abs(dx * c.s + dz * c.c) > c.hz + 0.01) return false;
      }
      return true;
    };
    for (const b of this.drawnBoxes) {
      let covered = false;
      for (const c of hash.near(b.x, b.z, b.hx + b.hz)) if (inside(b, c)) { covered = true; break; }
      if (!covered) this.details.push({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, y0: b.y0, y1: b.y1, c: b.c, s: b.s, surf: DETAIL_SURF[b.key] || (b.key.startsWith('w_') ? 'plaster' : 'concrete') });
    }
    this.drawnBoxes = [];
  }

  // Where a loose prop would sit, as a yawed box in plan plus its height range (from its scan's bounds, tilted as placed).
  _footprint(c) {
    const s = assets.proto[c.name].size, k = c.scale, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.tilt ? c.tilt[0] : 0, c.rot, c.tilt ? c.tilt[1] : 0, 'YXZ'));
    const cs = Math.cos(c.rot), sn = Math.sin(c.rot); let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [-s.x / 2, s.x / 2]) for (const y of [0, s.y]) for (const z of [-s.z / 2, s.z / 2]) {
      tmp.set(x * k, y * k, z * k).applyQuaternion(q);
      const u = tmp.x * cs - tmp.z * sn, w = tmp.x * sn + tmp.z * cs;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y);
    }
    const um = (u0 + u1) / 2, wm = (w0 + w1) / 2;
    return { x: c.x + um * cs + wm * sn, z: c.z - um * sn + wm * cs, hx: (u1 - u0) / 2, hz: (w1 - w0) / 2, c: cs, s: sn, y0: c.y + y0, y1: c.y + y1 };
  }

  // Dressing places clutter by rule (beside a door, against a wall, by a stall), so now and then a prop lands partly inside
  // something solid: a chair half into a sandbag wall, a tyre stack overlapping a pallet, a stool on top of a chair's legs.
  // The physics then shot it out at the first step, or it stood in the wall. This shoves a prop the shortest way clear of
  // solid boxes, detail solids and the loose props already placed. False when it cannot be cleared within 0.6 m.
  _clear(c, solids, placed) {
    const blocking = (a, b) => b.y1 > a.y0 + 0.025 && b.y0 < a.y1 - 0.02, x0 = c.x, z0 = c.z;
    let first = null;
    const attempt = () => {
      const f = this._footprint(c); let moved = 0;
      for (let it = 0; it < 10; it++) {
        let worst = null, by = null;
        for (const b of solids.near(f.x, f.z, f.hx + f.hz + 0.2)) if (blocking(f, b)) { const o = overlap2(f, b, 0.012); if (o && o.d > 1e-3 && (!worst || o.d > worst.d)) { worst = o; by = b; } }
        for (const p of placed) if (Math.abs(p.x - f.x) < 1.5 && Math.abs(p.z - f.z) < 1.5 && blocking(f, p)) { const o = overlap2(f, p, 0.01); if (o && o.d > 1e-3 && (!worst || o.d > worst.d)) { worst = o; by = p; } }
        if (!worst) return true;
        first = first || by;
        const k = (worst.d + 0.003) / worst.d;                                 // a hair past contact, so it does not stop on the boundary
        c.x += worst.x * k; c.z += worst.z * k; f.x += worst.x * k; f.z += worst.z * k; moved += worst.d;
        if (moved > 0.6) return false;
      }
      return false;
    };
    if (attempt()) return true;
    // a tight spot (between a counter and a wall, in a corner): square it up with what it first ran into and try again
    const yaw = Math.atan2(first.s, first.c), quarter = Math.PI / 2;
    c.x = x0; c.z = z0; c.rot = yaw + Math.round((c.rot - yaw) / quarter) * quarter;
    return attempt();
  }

  // Loose clutter becomes a rigid body when something solid is directly under it (ground, a collider, or another loose
  // prop); anything resting on set dressing without a collider stays part of the static scenery. One headed for the
  // physics, or buried in a collision box, is first shoved clear of everything solid, and left out if it cannot be.
  _classify() {
    this._details();
    const cands = this.dynCand.sort((a, b) => a.y - b.y), cols = this.colliders, dyn = this.dynamic = [], feet = [];
    const solids = new BoxHash([...cols, ...this.details.filter(d => d.place !== false), ...(this.keepOuts || [])]);
    const support = c => {
      let sup = 0, inside = false;
      const f = this._footprint(c), x = f.x, z = f.z, y = f.y0;                  // (the middle of what is drawn: a tyre on its side is not centred on its origin)
      for (const b of cols) {
        const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
        if (Math.abs(lx) > b.hx || Math.abs(lz) > b.hz) continue;
        if (b.y0 < y + 0.1 && b.y1 > y + 0.12) inside = true; else if (b.y1 <= y + 0.1 && b.y1 > sup) sup = b.y1;
      }
      for (const d of feet) if (Math.abs(d.x - x) < Math.max(d.hx, d.hz) + 0.05 && Math.abs(d.z - z) < Math.max(d.hx, d.hz) + 0.05 && d.y1 <= y + 0.1 && d.y1 > sup) sup = d.y1;
      return { sup, inside, y };
    };
    this._sorted = true;
    for (const c of cands) {
      const s = assets.proto[c.name].size; c.top = c.tilt ? Math.min(s.x, s.z) * c.scale : s.y * c.scale; c.foot = Math.max(s.x, s.z) * c.scale * 0.5;
      let { sup, inside, y } = support(c);
      if (inside || y - sup < 0.1) {
        if (!this._clear(c, solids, feet)) { this.dropped.push(c); continue; }
        ({ sup, inside, y } = support(c));
      }
      if (!inside && y - sup < 0.1) { dyn.push(c); feet.push(this._footprint(c)); }
      else { this.prop(c.name, c.x, c.y, c.z, c.rot, c.scale, c.tilt); if (c.solid) this.collide(c.x, c.y + (s.y * c.scale) / 2, c.z, s.x * c.scale * c.solid.shrink, s.y * c.scale, s.z * c.scale * c.solid.shrink, c.rot, c.solid.surf); }
    }
    this.dynCand = [];
  }

  build(M) {
    this._classify();
    if (this.later) { this.colliders.push(...this.later); this.later = null; }
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
      if (M[key].userData.extra) g.setAttribute(M[key].userData.extra, new THREE.Float32BufferAttribute(k.x, 3));
      if (M[key].userData.patchKey?.startsWith('wind')) g.setAttribute('aWind', new THREE.Float32BufferAttribute(k.x.filter((_, i) => i % 3 < 2), 2));
      g.setIndex(k.i);
      const mesh = new THREE.Mesh(g, M[key]);
      mesh.name = key; mesh.userData.surf = M[key].userData.surf;
      if (k.lod) {                                       // the cell's plan box: near and far versions switch at the same distance
        const cx = k.cell % 7, cz = Math.floor(k.cell / 7);
        mesh.userData.kitLod = k.lod; mesh.userData.lodBox = [-50 + 24 * cx, -84 + 24 * cz, -26 + 24 * cx, -60 + 24 * cz];
      }
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
