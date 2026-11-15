// Rigid-body world (Rapier): the district's static boxes, loose clutter that can be shoved and shot, ragdolls, dropped rifles.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { assets } from './assets.js';
import { losClear } from './physics.js';

const H = 1 / 60, G_STATIC = 1, G_PROP = 2, G_RAG = 4, G_CHAR = 8;
// The capsule that shoves clutter aside is a dynamic body chased towards its soldier: it wants to be on him next step
// (at up to PUSH_SPEED) but may change speed by only PUSH_ACCEL, so the most it can lean on anything is
// PUSHER_MASS * PUSH_ACCEL (200 N, a firm shove). Walking into a chair in the open still sends it 2-3 m, and a wall
// behind the chair stops both: measured 1.5 cm at most into the wall with the soldier leaning on it, against 26-33 cm
// before. (A heavy capsule whose speed is reset every step, like a kinematic one, carries more momentum into the chair
// than the solver can hand on to the wall in its few iterations, so the chair was pressed into the wall instead.)
const PUSHER_MASS = 8, PUSH_SPEED = 9, PUSH_ACCEL = 25, ZERO = { x: 0, y: 0, z: 0 };
const grp = (member, filter) => ((member << 16) | filter) >>> 0;
const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
const FEEL = [[0.33, 0], [-0.33, 0], [0.66, 0], [-0.66, 0], [0.95, 0], [-0.95, 0], [0, 0.8], [0, -0.8]];      // where a thrown object feels ahead, across and above/below its centre, in radii

// Props that are simulated when they sit on something solid. m = mass in kg at scale 1.
export const DYNAMIC = {
  chair: { m: 2.6, mat: 'plastic' }, stool: { m: 3, mat: 'wood' }, plastic_crate: { m: 1.8, mat: 'plastic' }, cardboard: { m: 1.6, mat: 'cardboard' },
  basket: { m: 0.9, mat: 'wicker' }, basket_tall: { m: 1.3, mat: 'wicker' }, pot: { m: 4.5, mat: 'clay' }, jerrycan: { m: 2.8, mat: 'can' },
  tyre: { m: 8.5, mat: 'rubber' }, trashbag: { m: 3.5, mat: 'bag' }, lpg: { m: 11, mat: 'tank' }, hand_truck: { m: 9, mat: 'tank' },
  trashcan: { m: 6.5, mat: 'bin' }, trashcan_rust: { m: 6.5, mat: 'bin' }, drum_plastic: { m: 8, mat: 'plastic' },
};
// material → [friction, restitution, effect surface for bullet hits, does a rifle round stop in it]
const MATS = {
  plastic: [0.45, 0.3, 'wood', false], wood: [0.6, 0.2, 'wood', true], cardboard: [0.75, 0.05, 'fabric', false], wicker: [0.65, 0.1, 'wood', false],
  clay: [0.6, 0.12, 'plaster', true], can: [0.5, 0.22, 'metal', false], tank: [0.5, 0.2, 'metal', true], bin: [0.5, 0.25, 'metal', false],
  rubber: [0.95, 0.5, 'fabric', true], bag: [0.95, 0, 'fabric', false], body: [0.85, 0, 'fabric', true], gun: [0.55, 0.15, 'metal', true],
  frag: [0.62, 0.34, 'metal', true], canister: [0.55, 0.28, 'metal', true],
};

// Convex hull input: the extreme vertex of the scan along a spread of directions (a few dozen points per prop type).
function hullPoints(proto) {
  if (proto.hull) return proto.hull;
  const dirs = []; for (let i = 0; i < 56; i++) { const y = 1 - (i + 0.5) / 28, r = Math.sqrt(1 - y * y), a = i * 2.399963; dirs.push([Math.cos(a) * r, y, Math.sin(a) * r, 0]); }
  // plus a ring of points around the very bottom and top, so things stand on a proper base instead of rocking on two vertices
  let y0 = 1e9, y1 = -1e9; const v = V();
  for (const part of proto.parts) { const pos = part.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const band = Math.max(0.006, (y1 - y0) * 0.035);
  for (let i = 0; i < 14; i++) { const a = i / 14 * 6.2832; dirs.push([Math.cos(a), 0, Math.sin(a), 1], [Math.cos(a), 0, Math.sin(a), 2]); }
  const best = dirs.map(() => ({ d: -1e9, p: null }));
  for (const part of proto.parts) {
    const pos = part.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); const zone = v.y < y0 + band ? 1 : v.y > y1 - band ? 2 : 0;
      for (let k = 0; k < dirs.length; k++) { const D = dirs[k]; if (D[3] && D[3] !== zone) continue; const d = v.x * D[0] + v.y * D[1] + v.z * D[2]; if (d > best[k].d) { best[k].d = d; best[k].p = [v.x, D[3] === 1 ? y0 : D[3] === 2 ? y1 : v.y, v.z]; } }
    }
  }
  const seen = new Set(), out = [];
  for (const b of best) { if (!b.p) continue; const key = b.p.map(c => c.toFixed(3)).join(); if (!seen.has(key)) { seen.add(key); out.push(...b.p); } }
  return proto.hull = out;
}

export class Rigid {
  static async create(G, dynamic) { await RAPIER.init(); return new Rigid(G, dynamic); }

  constructor(G, dynamic) {
    this.G = G; this.acc = 0; this.time = 0; this.items = new Map(); this.props = []; this.rags = []; this.guns = []; this.corpses = []; this.pushers = [];
    this.m4 = new THREE.Matrix4(); this.inv = new THREE.Matrix4(); this.tp = V(); this.tq = new THREE.Quaternion(); this.ts = V(); this.onImpact = null;
    this.nades = []; this.surfOf = new Map(); this.pushAccel = PUSH_ACCEL;                                 // static collider handle -> surface
    this.meshRay = new THREE.Raycaster(); this.meshRay.firstHitOnly = true; this.meshBoxes = null; this.meshHits = []; this.nv = V(); this.nd = V(); this.nn = V(); this.na = V(); this.nc = V(); this.no = V();
    const w = this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = H;
    this.events = new RAPIER.EventQueue(true);
    const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed()), sg = grp(G_STATIC, G_PROP | G_RAG);
    this.ground = w.createCollider(RAPIER.ColliderDesc.cuboid(100, 2, 100).setTranslation(30, -2, 0).setCollisionGroups(sg).setFriction(0.9), fixed).handle;
    // the movement boxes, plus the drawn details only clutter, bodies and thrown things meet (plinths, sills, stall posts…) and railings
    for (const b of [...G.world.colliders, ...(G.world.details || []), ...(G.world.rails || [])]) {
      const hy = (b.y1 - b.y0) / 2; if (hy < 0.005 || b.hx < 0.005 || b.hz < 0.005) continue;
      const a = Math.atan2(b.s, b.c) / 2;
      const col = w.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, hy, b.hz).setTranslation(b.x, b.y0 + hy, b.z).setRotation({ x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }).setCollisionGroups(sg).setFriction(0.85), fixed);
      this.surfOf.set(col.handle, b.surf || 'concrete');
    }
    this._props(dynamic || []);
    w.step(this.events); this.events.drainCollisionEvents(() => {});
  }

  // ---- clutter ----------------------------------------------------------------------------------------------------------
  _props(dyn) {
    const G = this.G, byName = new Map(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const d of dyn) { if (!byName.has(d.name)) byName.set(d.name, []); byName.get(d.name).push(d); }
    this.group = new THREE.Group(); this.group.name = 'dynamic';
    this.kinds = [];                                                          // per prop kind: its instanced meshes and items, for distance culling
    for (const [name, list] of byName) {
      const proto = assets.proto[name], def = DYNAMIC[name], pts = hullPoints(proto), fr = MATS[def.mat];
      const meshes = proto.parts.map(part => { const m = new THREE.InstancedMesh(part.geometry, part.material, list.length); m.castShadow = !proto.small; m.receiveShadow = true; m.frustumCulled = false; m.name = 'dyn:' + name; m.userData.lod = Infinity; this.group.add(m); return m; });
      const kind = { meshes, items: [], shown: -1 }; this.kinds.push(kind);
      list.forEach((d, i) => {
        q.setFromEuler(e.set(d.tilt ? d.tilt[0] : 0, d.rot, d.tilt ? d.tilt[1] : 0, 'YXZ'));
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(d.x, d.y, d.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.2).setAngularDamping(1.1)
          .setCcdEnabled(true));                                                // a blast throws a chair at 10 m/s: without it, it could pass through a thin wall
        const sp = new Float32Array(pts.length); for (let k = 0; k < pts.length; k++) sp[k] = pts[k] * d.scale;
        let cd = RAPIER.ColliderDesc.convexHull(sp);
        if (!cd) { const s = proto.size; cd = RAPIER.ColliderDesc.cuboid(s.x * d.scale / 2, s.y * d.scale / 2, s.z * d.scale / 2).setTranslation(0, s.y * d.scale / 2, 0); }
        const col = this.world.createCollider(cd.setMass(def.m * d.scale ** 3).setFriction(fr[0]).setRestitution(fr[1]).setCollisionGroups(grp(G_PROP, G_STATIC | G_PROP | G_RAG | G_CHAR)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
        const item = { kind: 'prop', name, mat: def.mat, mass: def.m * d.scale ** 3, body, meshes, index: i, slot: i, scale: d.scale, home: { x: d.x, y: d.y, z: d.z, q: { x: q.x, y: q.y, z: q.z, w: q.w } }, pvx: 0, pvy: 0, pvz: 0, snd: -1, moved: true, px: d.x, pz: d.z, m: new THREE.Matrix4() };
        this.items.set(col.handle, item); this.props.push(item); kind.items.push(item);
      });
    }
    G.R.scene.add(this.group); G.R.setupTree(this.group);
    this._syncProps(true);
  }
  _syncProps(all) {
    const dirty = new Set();
    for (const it of this.props) {
      const awake = !it.body.isSleeping();
      if (!all && !awake && !it.moved) continue;
      it.moved = awake;
      const t = it.body.translation(), r = it.body.rotation();
      if (t.y < -15) { this._home(it); continue; }
      it.m.compose(this.tp.set(t.x, t.y, t.z), this.tq.set(r.x, r.y, r.z, r.w), this.ts.setScalar(it.scale)); it.px = t.x; it.pz = t.z;
      if (it.slot >= 0) for (const m of it.meshes) { m.setMatrixAt(it.slot, it.m); dirty.add(m); }
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
  }
  // Only clutter within `range` of the camera is drawn (main view and shadows): the instances in reach are packed to the
  // front of each kind's buffer. Out there it is a few pixels, and all of it was drawn in every pass before.
  cullProps(cam, range) {
    for (const k of this.kinds) {
      let n = 0;
      for (const it of k.items) { const d = Math.hypot(it.px - cam.x, it.pz - cam.z), keep = d < (it.slot >= 0 ? range + 4 : range); it.want = keep; if (keep) n++; }
      let same = n === k.shown; if (same) for (const it of k.items) if (it.want !== it.slot >= 0) { same = false; break; }
      if (same) continue;
      let slot = 0;
      for (const it of k.items) { if (it.want) { it.slot = slot; for (const m of k.meshes) m.setMatrixAt(slot, it.m); slot++; } else it.slot = -1; }
      for (const m of k.meshes) { m.count = slot; m.instanceMatrix.needsUpdate = true; }
      k.shown = n;
    }
  }
  _home(it) { const b = it.body, z = { x: 0, y: 0, z: 0 }; b.setTranslation(it.home, false); b.setRotation(it.home.q, false); b.setLinvel(z, false); b.setAngvel(z, false); b.sleep(); it.moved = true; }

  // A capsule that follows a living character and shoves clutter out of the way. Low objects are stepped over.
  // It is a dynamic body chased towards the character, not a kinematic one: a kinematic body is infinitely strong, so a
  // chair caught between it and a wall was crushed 20-30 cm into the wall (and down into the pavement). With a finite
  // mass the wall wins, the chair stays out of it and the capsule is held back at the chair until the soldier moves off.
  addPusher(actor) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -50, 0).setGravityScale(0).lockRotations().setCanSleep(false).setLinearDamping(0));
    const col = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.4, 0.31).setMass(PUSHER_MASS).setCollisionGroups(grp(G_CHAR, G_PROP)).setFriction(0.3), body);
    this.pushers.push({ actor, body, col, on: false, ghost: false });
    if (!this.capsule) this.capsule = new RAPIER.Capsule(0.4, 0.31);
  }
  // Moved straight onto its soldier (spawn, or left far behind), it may land inside a prop: it then passes through
  // clutter until it is clear of all of it, instead of blasting what it landed in out of the way.
  _jump(p, x, y, z) {
    p.body.setTranslation({ x, y, z }, true); p.body.setLinvel(ZERO, true);
    if (!p.ghost) { p.ghost = true; p.col.setEnabled(false); }
  }
  _settle(p) {
    const t = p.body.translation(); let hit = false;
    this.world.intersectionsWithShape(t, { x: 0, y: 0, z: 0, w: 1 }, this.capsule, () => { hit = true; return false; }, undefined, grp(G_CHAR, G_PROP));
    if (!hit) { p.ghost = false; p.col.setEnabled(true); }
  }

  // ---- stepping ------------------------------------------------------------------------------------------------------------
  step(dt) {
    this.acc = Math.min(this.acc + dt, 3 * H + 1e-6); let n = 0;
    while (this.acc >= H - 1e-6) {
      this.acc -= H; this.time += H; n++;
      for (const p of this.pushers) {
        const a = p.actor, y = a.pos.y + 0.95;
        if (a.alive) {
          const t = p.body.translation(), dx = a.pos.x - t.x, dy = y - t.y, dz = a.pos.z - t.z, d = Math.hypot(dx, dy, dz);
          if (!p.on || d > 1.5) this._jump(p, a.pos.x, y, a.pos.z);
          else {
            const k = Math.min(1 / H, PUSH_SPEED / Math.max(d, 1e-6)), v = p.body.linvel(), cap = this.pushAccel * H;
            let ex = dx * k - v.x, ey = dy * k - v.y, ez = dz * k - v.z; const e = Math.hypot(ex, ey, ez);
            if (e > cap) { ex *= cap / e; ey *= cap / e; ez *= cap / e; }
            p.body.setLinvel({ x: v.x + ex, y: v.y + ey, z: v.z + ez }, true);
          }
          if (p.ghost) this._settle(p);
          p.on = true;
        } else if (p.on) { p.body.setTranslation({ x: 0, y: -50, z: 0 }, false); p.body.setLinvel(ZERO, false); p.on = false; }
      }
      for (const it of this.items.values()) { if (it.body.isSleeping()) { it.pvx = it.pvy = it.pvz = 0; } else { const v = it.body.linvel(); it.pvx = v.x; it.pvy = v.y; it.pvz = v.z; } }
      for (const it of this.nades) this._nadeMesh(it);
      this.world.step(this.events);
      this.events.drainCollisionEvents((a, b, started) => { if (started) this._contact(a, b); });
      for (const r of this.rags) r.t += H;
    }
    if (n) { this._syncProps(false); for (const r of this.rags) r.sync(); for (const g of this.guns) g.sync(); }
    for (const it of this.nades) it.sync(this.acc);
  }
  _contact(h1, h2) {
    const a = this.items.get(h1), b = this.items.get(h2); if (!a && !b) return;
    const it = a && b && b.kind === 'nade' ? b : a || b, o = a && b ? (it === a ? b : a) : null;      // a thrown object reports its own knocks
    if (o && it.rag && it.rag === o.rag) return;                               // a body folding onto itself is silent
    const speed = Math.hypot(it.pvx - (o ? o.pvx : 0), it.pvy - (o ? o.pvy : 0), it.pvz - (o ? o.pvz : 0));
    if (speed < (it.kind === 'nade' ? 0.35 : 0.7) || this.time - it.snd < 0.11) return;
    it.snd = this.time; if (o) o.snd = this.time;
    const sh = a ? h2 : h1, surf = o ? null : sh === this.ground ? this.G.world.surfaceAt(it.body.translation().x, it.body.translation().z) : this.surfOf.get(sh) || null;
    if (this.onImpact) this.onImpact(it, speed, it.body.translation(), o, surf);
  }

  // ---- thrown objects --------------------------------------------------------------------------------------------------
  // A grenade or canister as a body of its own: a dense ball or a can with the fuze standing proud of it, so it bounces
  // off line, wobbles as it rolls and comes to rest on its side. Continuous collision keeps it out of walls.
  addNade(kind, obj, pos, vel, spin, quat) {
    const frag = kind === 'frag', w = this.world, CD = RAPIER.ColliderDesc, M = MATS[frag ? 'frag' : 'canister'];
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: spin.x, y: spin.y, z: spin.z }).setLinearDamping(0.03).setAngularDamping(frag ? 0.5 : 0.3).setCcdEnabled(true));
    const open = grp(G_PROP, G_STATIC | G_PROP | G_RAG), full = grp(G_PROP, G_STATIC | G_PROP | G_RAG | G_CHAR);
    const shapes = frag
      ? [CD.ball(0.031).setMass(0.35), CD.cylinder(0.013, 0.0125).setTranslation(0, 0.041, 0).setMass(0.045)]
      : [CD.cylinder(0.056, 0.0295).setMass(0.5), CD.cylinder(0.012, 0.0135).setTranslation(0, 0.068, 0).setMass(0.04)];
    const mass = frag ? 0.395 : 0.54;
    const item = { kind: 'nade', nade: kind, mat: frag ? 'frag' : 'canister', mass, body, obj, cols: [], pvx: 0, pvy: 0, pvz: 0, snd: -1, age: 0, guarded: true, full, rad: frag ? 0.031 : 0.032, bounce: M[1], near: null,
      sync(lead) { const t = body.translation(), r = body.rotation(), v = body.isSleeping() ? null : body.linvel(); obj.position.set(t.x + (v ? v.x * lead : 0), t.y + (v ? v.y * lead : 0), t.z + (v ? v.z * lead : 0)); obj.quaternion.set(r.x, r.y, r.z, r.w); } };
    for (const cd of shapes) { const col = w.createCollider(cd.setFriction(M[0]).setRestitution(M[1]).setCollisionGroups(open).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body); item.cols.push(col); this.items.set(col.handle, item); }
    this.nades.push(item); item.sync(0);
    return item;
  }
  // ---- thrown objects against what is actually drawn ---------------------------------------------------------------------
  // The solver knows the district as boxes: house blocks, kerbs, steps, cover. Balconies, railings, awnings, shutters,
  // lamp posts, pipes and cables exist only as the geometry that is drawn. So before each step a thrown object feels
  // ahead along its path (five rays, as wide as itself) and beneath itself through the same triangle trees the bullets
  // use, and whatever is there that no box accounts for stops it, turns it back or carries it.
  _near(it, p) {                                                               // the drawn meshes within reach, refreshed as it travels
    const c = it.near;
    if (!c || (p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2 > 1) {
      if (!this.meshBoxes) this.meshBoxes = [...this.G.world.rayMeshes, ...this.G.world.clothMeshes].map(m => { m.updateMatrixWorld(); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return { m, b: m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld) }; });
      const list = [];
      for (const e of this.meshBoxes) { const b = e.b; if (p.x > b.min.x - 2 && p.x < b.max.x + 2 && p.y > b.min.y - 2 && p.y < b.max.y + 2 && p.z > b.min.z - 2 && p.z < b.max.z + 2) list.push(e.m); }
      it.near = { x: p.x, y: p.y, z: p.z, list };
    }
    return it.near.list;
  }
  // Nearest drawn surface along a ray that the solver has no box for (a box there means the solver deals with it).
  _meshHit(list, o, d, far) {
    const rc = this.meshRay, hits = this.meshHits; rc.set(o, d); rc.far = far; hits.length = 0; rc.intersectObjects(list, false, hits);
    let best = null; for (const h of hits) if (h.distance <= far && (!best || h.distance < best.distance)) best = h;
    if (!best) return null;
    const box = this.world.castRay(new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }), best.distance + 0.05, true, undefined, grp(0xffff, G_STATIC));
    return box ? null : best;
  }
  meshBelow(p, reach = 0.2) {                                                  // height of a drawn surface just under a point, or null
    const o = this.no.set(p.x, p.y + 0.05, p.z); this.meshRay.set(o, this.nc.set(0, -1, 0)); this.meshRay.far = reach + 0.05; this.meshHits.length = 0;
    if (!this.meshBoxes) this._near({}, o);
    const list = []; for (const e of this.meshBoxes) { const b = e.b; if (o.x > b.min.x - 0.1 && o.x < b.max.x + 0.1 && o.y > b.min.y - 0.4 && o.y < b.max.y + 0.4 && o.z > b.min.z - 0.1 && o.z < b.max.z + 0.1) list.push(e.m); }
    this.meshRay.intersectObjects(list, false, this.meshHits); let y = null; for (const h of this.meshHits) if (y === null || h.point.y > y) y = h.point.y;
    return y;
  }
  _nadeMesh(it) {
    const b = it.body; if (b.isSleeping()) return;
    const t = b.translation(), v = b.linvel(), r = it.rad, sp = Math.hypot(v.x, v.y, v.z);
    const o = this.nv.set(t.x, t.y, t.z), list = this._near(it, o); if (!list.length) return;
    const d = this.nd, n = this.nn; let hit = null, back = 0;
    if (sp > 0.3) {                                                            // along this step's travel
      d.set(v.x / sp, v.y / sp, v.z / sp);
      const a = this.na.set(d.z, 0, -d.x); if (a.lengthSq() < 1e-4) a.set(1, 0, 0); a.normalize(); const c = this.nc.crossVectors(d, a);
      hit = this._meshHit(list, o, d, sp * H + r); back = r;
      for (const [u, w] of FEEL) {                                             // rays closer together than a railing bar is wide, across its own width
        const depth = Math.sqrt(1 - u * u - w * w) * r, q = this.no.copy(o).addScaledVector(a, u * r).addScaledVector(c, w * r), h = this._meshHit(list, q, d, sp * H + depth);
        if (h && (!hit || h.distance - depth < hit.distance - back)) { hit = h; back = depth; }
      }
    }
    if (hit) {
      n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld); if (n.dot(d) > 0) n.negate();
      const vn = v.x * n.x + v.y * n.y + v.z * n.z; if (vn >= 0) return;
      const cloth = !!hit.object.userData.cloth, surf = cloth ? 'fabric' : hit.object.userData.surf || 'concrete', soft = surf === 'fabric', e = it.bounce * (soft ? 0.2 : 1);      // cloth gives: it takes the bounce out and most of the travel
      const go = Math.max(0, hit.distance - back);                             // as far as it gets before touching
      let nx = v.x - vn * n.x, ny = v.y - vn * n.y, nz = v.z - vn * n.z; const tl = Math.hypot(nx, ny, nz), grip = Math.min(tl, (soft ? 0.8 : 0.45) * (1 + e) * -vn);
      if (tl > 1e-5) { const k = (tl - grip) / tl; nx *= k; ny *= k; nz *= k; }                           // the surface drags at it as it glances off
      const out = -vn > 0.7 ? -e * vn : 0;
      b.setTranslation({ x: o.x + d.x * go + n.x * 0.002, y: o.y + d.y * go + n.y * 0.002, z: o.z + d.z * go + n.z * 0.002 }, true);
      b.setLinvel({ x: nx + n.x * out, y: ny + n.y * out, z: nz + n.z * out }, true);
      const w = b.angvel(); b.setAngvel({ x: w.x * 0.6, y: w.y * 0.6, z: w.z * 0.6 }, true);
      if (-vn > 0.35 && this.time - it.snd >= 0.11) { it.snd = this.time; if (this.onImpact) this.onImpact(it, -vn, b.translation(), null, surf); }
      else if (it.snd < 0) it.snd = this.time;
      return;
    }
    // resting or rolling on something only drawn: it is held up, and goes to sleep there like on any floor
    const h = this._meshHit(list, o, d.set(0, -1, 0), r + 0.006); if (!h) return;
    n.copy(h.face.normal).transformDirection(h.object.matrixWorld); if (n.y < 0) n.negate(); if (n.y < 0.35) return;
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    b.setTranslation({ x: o.x, y: h.point.y + r, z: o.z }, false);              // (without waking it: held like this it can settle and sleep)
    if (vn < 0) b.setLinvel({ x: v.x - vn * n.x, y: v.y - vn * n.y, z: v.z - vn * n.z }, false);
    if (it.snd < 0) it.snd = this.time;
  }

  // (It leaves the hand inside the thrower's own body capsule, so it only starts to meet the living a moment later.)
  // Rolling over road grit takes the way off it quickly: once it is down and no longer hopping, it is braked.
  nadeTick(item, dt) {
    item.age += dt; if (item.guarded && item.age > 0.16) { item.guarded = false; for (const c of item.cols) c.setCollisionGroups(item.full); }
    const b = item.body; if (b.isSleeping()) return;
    const v = b.linvel(), down = item.snd >= 0 && Math.abs(v.y) < 0.9;
    if (down !== item.down) { item.down = down; b.setLinearDamping(down ? (item.nade === 'frag' ? 1.5 : 1.9) : 0.03); b.setAngularDamping(down ? 3.2 : item.nade === 'frag' ? 0.5 : 0.3); }
  }
  endNade(item) { const i = this.nades.indexOf(item); if (i < 0) return; this.nades.splice(i, 1); for (const c of item.cols) this.items.delete(c.handle); this.world.removeRigidBody(item.body); }

  // A blast wave: everything loose within reach and in sight of it is thrown outwards, light things furthest.
  blast(c, radius, power) {
    const G = this.G, cols = G.world.colliders, seen = new Set(), o = V(c.x, c.y + 0.25, c.z), p = V(); let n = 0;
    for (const it of this.items.values()) {
      if (seen.has(it)) continue; seen.add(it);
      const t = it.body.translation(), dx = t.x - c.x, dy = t.y + 0.15 - c.y, dz = t.z - c.z, d = Math.hypot(dx, dy, dz);
      if (d > radius || !losClear(o, p.set(t.x, t.y + 0.2, t.z), cols)) continue;
      const k = (1 - d / radius) ** 2, l = Math.max(d, 0.25);
      const J = Math.min(power * k * Math.cbrt(it.mass) ** 2, it.mass * 8.5), up = 0.35 + 0.3 * k;      // the ground reflects the wave upwards
      it.body.applyImpulse({ x: dx / l * J, y: (dy / l + up) * J, z: dz / l * J }, true);
      const tq = J * 0.04; it.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * tq, y: (Math.random() - 0.5) * tq, z: (Math.random() - 0.5) * tq }, true);
      n++;
    }
    return n;
  }

  // ---- bullets -------------------------------------------------------------------------------------------------------------
  ray(o, d, maxT) {
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }), maxT, true, undefined, grp(0xffff, G_PROP | G_RAG));
    if (!hit) return null;
    const item = this.items.get(hit.collider.handle);
    return item ? { t: hit.timeOfImpact, n: hit.normal, item } : null;
  }
  // Applies the round's shove, effects and sound. Returns true when the object stops the round.
  bulletHit(h, o, d, near = true) {
    const it = h.item, G = this.G, p = V(o.x + d.x * h.t, o.y + d.y * h.t, o.z + d.z * h.t), M = MATS[it.mat];
    const J = it.kind === 'rag' ? Math.min(22, 4 + it.mass * 0.7) : Math.min(3.4, 1.2 + it.mass * 0.6);    // bodies get a helped shove so hits read
    it.body.applyImpulseAtPoint({ x: d.x * J, y: d.y * J + (it.kind === 'prop' ? 0.25 : 0), z: d.z * J }, p, true);
    const n = V(h.n.x, h.n.y, h.n.z);
    G.fx.impact(M[2], p, n, 1, it.kind === 'rag' ? 0.7 : 0.8);
    G.audio.impact(it.kind === 'rag' ? 'flesh' : it.mat === 'bin' || it.mat === 'can' || it.mat === 'tank' ? 'metal' : it.mat === 'clay' ? 'plaster' : it.mat === 'plastic' ? 'plastic' : M[2], { x: p.x, y: p.y, z: p.z }, near);
    return M[3];
  }

  // ---- ragdolls ------------------------------------------------------------------------------------------------------------
  // Builds one body per major bone from the soldier's current pose, joined at the real joint positions. All bodies start
  // axis-aligned, so joint frames coincide and hinge limits can be written relative to the pose at death.
  ragdoll(bot, dir, zone, launch = 0) {
    const b = bot.b, w = this.world, RB = RAPIER.RigidBodyDesc, CD = RAPIER.ColliderDesc, P = o => o.getWorldPosition(V());
    bot.root.updateMatrixWorld(true);
    const p = {}; for (const k of ['hips', 'spine', 'neck', 'head', 'la', 'lf', 'lh', 'ra', 'rf', 'rh', 'lul', 'll', 'lft', 'rul', 'rl', 'rft']) p[k] = P(b[k]);
    const side = p.rul.clone().sub(p.lul).normalize(), neckUp = p.head.clone().sub(p.neck).normalize();
    const rag = { bot, parts: [], t: 0 }, vel = bot.vel, groups = grp(G_RAG, G_STATIC | G_PROP | G_RAG);
    const mk = (key, bone, A, B, r, m) => {
      const mid = A.clone().add(B).multiplyScalar(0.5), len = A.distanceTo(B);
      const body = w.createRigidBody(RB.dynamic().setTranslation(mid.x, mid.y, mid.z).setLinvel(vel.x, 0, vel.z).setLinearDamping(0.15).setAngularDamping(1.4).setCcdEnabled(key === 'torso' || key === 'pelvis'));
      const q = new THREE.Quaternion().setFromUnitVectors(UP, len > 1e-3 ? B.clone().sub(A).normalize() : UP);
      const cd = (len < 0.02 ? CD.ball(r) : CD.capsule(Math.max(0.005, len / 2 - r * 0.45), r).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })).setMass(m).setFriction(0.85).setRestitution(0).setCollisionGroups(groups).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const col = w.createCollider(cd, body);
      const part = { kind: 'rag', key, mat: 'body', mass: m, bone, body, mid, rag, off: new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, -mid.z).multiply(bone.matrixWorld), rest: { p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }, pvx: 0, pvy: 0, pvz: 0, snd: -1, col };
      this.items.set(col.handle, part); rag.parts.push(part); return part;
    };
    const hand = (w0, e0) => w0.clone().add(w0.clone().sub(e0).normalize().multiplyScalar(0.09));
    const pelvis = mk('pelvis', b.hips, p.hips.clone().addScaledVector(side, -0.085), p.hips.clone().addScaledVector(side, 0.085), 0.115, 12);
    const torso = mk('torso', b.spine, p.spine.clone().lerp(p.neck, 0.12), p.neck.clone().addScaledVector(neckUp, -0.03), 0.135, 28);
    const hc = p.head.clone().addScaledVector(neckUp, 0.1), head = mk('head', b.head, hc, hc, 0.108, 5.5);
    const ual = mk('ual', b.la, p.la, p.lf, 0.05, 2.4), fal = mk('fal', b.lf, p.lf, hand(p.lh, p.lf), 0.043, 1.8);
    const uar = mk('uar', b.ra, p.ra, p.rf, 0.05, 2.4), far = mk('far', b.rf, p.rf, hand(p.rh, p.rf), 0.043, 1.8);
    const thl = mk('thl', b.lul, p.lul, p.ll, 0.075, 9), shl = mk('shl', b.ll, p.ll, p.lft, 0.056, 4.5);
    const thr = mk('thr', b.rul, p.rul, p.rl, 0.075, 9), shr = mk('shr', b.rl, p.rl, p.rft, 0.056, 4.5);
    for (const [part, foot] of [[shl, p.lft], [shr, p.rft]]) {         // boots, so the feet rest on the ground instead of sinking to the ankle
      const f = V(Math.sin(bot.bodyYaw ?? bot.yaw), 0, Math.cos(bot.bodyYaw ?? bot.yaw)), c = foot.clone().addScaledVector(f, 0.07).sub(part.mid); c.y -= 0.045;
      const a = (bot.bodyYaw ?? bot.yaw) / 2;
      const col = w.createCollider(CD.cuboid(0.05, 0.04, 0.13).setTranslation(c.x, c.y, c.z).setRotation({ x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }).setMass(0.8).setFriction(0.9).setCollisionGroups(groups), part.body);
      this.items.set(col.handle, part);
    }
    const rel = (J, part) => ({ x: J.x - part.mid.x, y: J.y - part.mid.y, z: J.z - part.mid.z });
    // The JS wrapper only exposes motors and limits on hinges; the raw joint set has them for every axis.
    const raw = w.impulseJoints.raw, AX = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ], ACC = RAPIER.MotorModel.AccelerationBased;
    // ball joints: free within `range` radians of the pose at death about each axis, with a soft spring ("muscle tone") and damping
    const ball = (a, c, J, k, d, range) => {
      const j = w.createImpulseJoint(RAPIER.JointData.spherical(rel(J, a), rel(J, c)), a.body, c.body, true); j.setContactsEnabled(false);
      for (const ax of AX) { raw.jointConfigureMotorModel(j.handle, ax, ACC); raw.jointConfigureMotorPosition(j.handle, ax, 0, k, d); if (range) raw.jointSetLimits(j.handle, ax, -range, range); }
    };
    // elbows and knees: hinges about the axis the limb is already bending around, limited to the anatomical range
    const hinge = (a, c, J, far_, fallback, maxFlex) => {
      const u = J.clone().sub(a.mid).normalize(), f = far_.clone().sub(J).normalize();
      let axis = u.clone().cross(f); const sn = axis.length();
      if (sn < 0.12) axis = fallback.clone(); else axis.multiplyScalar(1 / sn);
      const flex = Math.acos(Math.max(-1, Math.min(1, u.dot(f))));
      const j = w.createImpulseJoint(RAPIER.JointData.revolute(rel(J, a), rel(J, c), { x: axis.x, y: axis.y, z: axis.z }), a.body, c.body, true); j.setContactsEnabled(false);
      j.setLimits(-flex + 0.04, Math.max(0.1, maxFlex - flex)); j.configureMotorModel(ACC); j.configureMotorVelocity(0, 2.2);
    };
    ball(pelvis, torso, p.spine, 60, 10, 0.55); ball(torso, head, p.neck, 50, 8, 0.7);
    ball(torso, ual, p.la, 4, 3, 1.7); ball(torso, uar, p.ra, 4, 3, 1.7); ball(pelvis, thl, p.lul, 7, 4, 1.25); ball(pelvis, thr, p.rul, 7, 4, 1.25);
    hinge(ual, fal, p.lf, p.lh, side, 2.5); hinge(uar, far, p.rf, p.rh, side, 2.5);
    hinge(thl, shl, p.ll, p.lft, side.clone().negate(), 2.4); hinge(thr, shr, p.rl, p.rft, side.clone().negate(), 2.4);
    // the round that killed: a shove on the part it struck, plus the knees giving way
    const hitPart = zone === 'head' ? head : zone === 'limb' ? (bot.rnd() < 0.5 ? thl : thr) : torso, J = zone === 'head' ? 10 : zone === 'limb' ? 16 : 36;
    if (launch > 0 && dir) {                                                   // thrown by a blast: the whole figure goes, limbs trailing
      for (const pt of rag.parts) { const k = pt.mass * launch * (0.8 + bot.rnd() * 0.4); pt.body.applyImpulse({ x: dir.x * k, y: dir.y * k, z: dir.z * k }, true); }
      torso.body.applyTorqueImpulse({ x: (bot.rnd() - 0.5) * 9 * launch, y: (bot.rnd() - 0.5) * 4 * launch, z: (bot.rnd() - 0.5) * 9 * launch }, true);
    } else {
      if (dir) hitPart.body.applyImpulse({ x: dir.x * J, y: dir.y * J + 2, z: dir.z * J }, true);
      pelvis.body.applyImpulse({ x: 0, y: -14, z: 0 }, true);
    }
    const order = [pelvis, torso, head, ual, fal, uar, far, thl, shl, thr, shr], m4 = this.m4, inv = this.inv, tp = this.tp, tq = this.tq, one = V(1, 1, 1);
    rag.sync = () => {
      for (const pt of order) {
        const t = pt.body.translation(), r = pt.body.rotation(), par = pt.bone.parent;
        m4.compose(tp.set(t.x, t.y, t.z), tq.set(r.x, r.y, r.z, r.w), one).multiply(pt.off);
        par.updateWorldMatrix(true, false);
        m4.premultiply(inv.copy(par.matrixWorld).invert()).decompose(pt.bone.position, pt.bone.quaternion, pt.bone.scale);
      }
    };
    rag.centre = out => { const t = torso.body.translation(); return out.set(t.x, t.y, t.z); };
    rag.speed = () => { const v = torso.body.linvel(); return Math.hypot(v.x, v.y, v.z); };
    rag.height = () => torso.body.translation().y;
    this.rags.push(rag);
    return rag;
  }
  endRagdoll(rag, restore = true) {
    const i = this.rags.indexOf(rag); if (i < 0) return; this.rags.splice(i, 1);
    for (const pt of rag.parts) {
      for (const [h, it] of this.items) if (it === pt) this.items.delete(h);
      this.world.removeRigidBody(pt.body);
      if (restore) { pt.bone.position.copy(pt.rest.p); pt.bone.quaternion.copy(pt.rest.q); pt.bone.scale.copy(pt.rest.s); }
    }
  }

  // The rifle leaves the hands and becomes a body of its own.
  dropGun(bot) {
    const g = bot.gun, q = g.quaternion, R = bot.rnd;
    const magazine = g.getObjectByName('botMagazine');
    if (magazine && magazine.position.y < -0.10) magazine.visible = false;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(g.position.x, g.position.y, g.position.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinvel(bot.vel.x + (R() - 0.5), 0.6, bot.vel.z + (R() - 0.5)).setLinearDamping(0.1).setAngularDamping(0.5).setCcdEnabled(true));
    body.setAngvel({ x: (R() - 0.5) * 3, y: (R() - 0.5) * 2, z: (R() - 0.5) * 3 }, true);
    const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.026, 0.1, 0.37).setTranslation(0, -0.135, -0.17).setMass(3.3).setFriction(0.55).setRestitution(0.15).setCollisionGroups(grp(G_PROP, G_STATIC | G_PROP)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const item = { kind: 'gun', mat: 'gun', mass: 3.3, body, obj: g, pvx: 0, pvy: 0, pvz: 0, snd: -1, sync() { const t = body.translation(), r = body.rotation(); g.position.set(t.x, t.y, t.z); g.quaternion.set(r.x, r.y, r.z, r.w); } };
    this.items.set(col.handle, item); this.guns.push(item);
    return item;
  }
  endGun(item) { const i = this.guns.indexOf(item); if (i < 0) return; this.guns.splice(i, 1); for (const [h, it] of this.items) if (it === item) this.items.delete(h); this.world.removeRigidBody(item.body); }

  // Leaves the fallen soldier and rifle behind as plain static meshes (skinning baked on the CPU) so the rig can respawn.
  bakeCorpse(bot) {
    const grp_ = new THREE.Group(); grp_.name = 'corpse'; const v = V();
    bot.root.updateMatrixWorld(true);
    bot.model.traverse(o => {
      if (o.isSkinnedMesh) {
        const src = o.geometry, n = src.attributes.position.count, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv); if (src.index) g.setIndex(src.index);
        g.computeVertexNormals(); g.userData.baked = true;
        const m = new THREE.Mesh(g, o.material); m.castShadow = true; m.receiveShadow = true; grp_.add(m);
      } else if (o.isMesh) { const m = new THREE.Mesh(o.geometry, o.material); m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrixWorld.copy(o.matrixWorld); m.castShadow = false; grp_.add(m); }
    });
    const gun = bot.gun.clone(true); gun.position.copy(bot.gun.position); gun.quaternion.copy(bot.gun.quaternion); grp_.add(gun);
    this.G.R.scene.add(grp_); this.G.R.setupTree(grp_);
    this.corpses.push({ group: grp_, t: this.time });
    while (this.corpses.length > 6) this._dropCorpse(this.corpses.shift());
  }
  _dropCorpse(c) { this.G.R.scene.remove(c.group); c.group.traverse(o => { if (o.isMesh && o.geometry.userData.baked) o.geometry.dispose(); }); }

  // Match restart: clutter back where it was dressed, no bodies on the ground.
  reset() {
    for (const r of [...this.rags]) this.endRagdoll(r);
    for (const g of [...this.guns]) this.endGun(g);
    for (const n of [...this.nades]) this.endNade(n);
    for (const c of this.corpses) this._dropCorpse(c); this.corpses = [];
    for (const it of this.props) this._home(it);
    this._syncProps(true); this.acc = 0;
  }
  stats() { let awake = 0; for (const it of this.props) if (!it.body.isSleeping()) awake++; return { props: this.props.length, awake, ragdolls: this.rags.length, corpses: this.corpses.length, guns: this.guns.length }; }
}
