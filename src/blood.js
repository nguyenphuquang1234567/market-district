// Blood: what a round does to a body, which a puff of cloth dust did not show.
//   - at the wound a short red mist, back towards the shooter and (more of it) out of the far side, and drops thrown
//     along the round's flight that fall under gravity;
//   - what the drops reach is stained: rays from the exit wound against the drawn geometry (the district's ray meshes,
//     the version on screen) find the wall or ground behind, and after the time the drops take to get there a spray
//     drawn out along the surface, a splat, or a patch with runs down a wall is laid on it; nearer drops spot the ground;
//   - the wounded leave a trail of single drops for some seconds; the fallen bleed out into a pool that spreads where
//     the body comes to rest;
//   - the player, hit, gets it on the lens: a few splats towards the side the round came from, off the middle of the
//     screen, fading in three or four seconds.
// All of it is decoration: its own random stream, nothing that collides, nothing the bots know about. Stains are
// instanced quads like the bullet marks (fx.js), a ring of each kind, wet (a low roughness) so the sky shows in them.
// settings.blood (the options panel) or ?blood=0 turns it off: a hit then puffs cloth dust as before.
import * as THREE from 'three';
import { rng } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const SEEN = 48, FELT = 75;            // metres from the camera within which a hit stains surfaces / throws mist and drops
const KINDS = [['splat', 11, 90], ['splat2', 23, 90], ['spray', 31, 70], ['drip', 43, 60], ['drops', 57, 110], ['dot', 61, 170], ['pool', 77, 28]];
const _x = V(), _y = V(), _t = V(), _a = V(), _b = V(), _d = V(), _p = V(), _u = V(), _e = V(), _c = V(), _f = V(), _g = V(), _q = V();

// ---- the stains, drawn once each: red on clear, darker where it lies thick ---------------------------------------------
function paint(kind, seed) {
  const R = rng(seed), c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const ink = (a = 1, k = 0) => `rgba(${94 - k * 48 | 0},${6 - k * 4 | 0},${9 - k * 5 | 0},${a})`;      // (dark: it is lit by the sun like everything else, and a mid red came out as paint)
  const disc = (x, y, r, a = 1, k = 0) => { g.fillStyle = ink(a, k); g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };
  const blob = (x, y, r0, r1, a = 1, k = 0, n = 14) => {                    // a round shape with an uneven edge, smooth through n radii
    const q = []; for (let i = 0; i < n; i++) { const t = i / n * 6.2832, r = r0 + R() * (r1 - r0); q.push([x + Math.cos(t) * r, y + Math.sin(t) * r]); }
    const mid = (i, j) => [(q[i][0] + q[j][0]) / 2, (q[i][1] + q[j][1]) / 2];
    g.fillStyle = ink(a, k); g.beginPath(); g.moveTo(...mid(n - 1, 0));
    for (let i = 0; i < n; i++) g.quadraticCurveTo(q[i][0], q[i][1], ...mid(i, (i + 1) % n));
    g.fill();
  };
  const tear = (x, y, ang, len, w, a = 1) => {                              // a drop drawn out along its flight: thin where it struck, a bead at the far end
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = ink(a); g.beginPath();
    g.moveTo(0, -w * 0.22); g.quadraticCurveTo(len * 0.6, -w * 0.5, len, -w * 0.5); g.arc(len, 0, w * 0.5, -Math.PI / 2, Math.PI / 2); g.quadraticCurveTo(len * 0.6, w * 0.5, 0, w * 0.22);
    g.closePath(); g.fill(); g.restore();
  };
  const soft = (x, y, r, a = 1, k = 1) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, ink(a, k)); gr.addColorStop(0.55, ink(a * 0.8, k)); gr.addColorStop(1, ink(0, k)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };   // (a canvas filter would do it, where there is one: WebKit has none)
  const run = (x, y0, len, w) => { g.fillStyle = ink(0.93); g.beginPath(); g.moveTo(x - w * 0.6, y0); g.lineTo(x - w * 0.45, y0 + len); g.arc(x, y0 + len, w * 0.62, Math.PI, 0, true); g.lineTo(x + w * 0.6, y0); g.fill(); };
  if (kind === 'splat') {                                 // struck square on: a fine mist of specks thickening to an uneven patch, drops drawn out from it
    const big = 1;
    for (let i = 0; i < 520; i++) { const t = R() * 6.2832, r = 6 + (R() + R() + R()) / 3 * 150 * R(); disc(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, 0.4 + R() * R() * 1.5, 0.5 + R() * 0.45); }
    for (let i = 0; i < 80; i++) { const t = R() * 6.2832, r = 16 + R() * 96, f = r / 112; tear(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, t, (2 + R() * 11 * (0.4 + f)) * big, (1.1 + R() * 2.2) * big); }
    for (let i = 0, n = 5 + (R() * 4 | 0); i < n; i++) { const t = R() * 6.2832, r0 = 8 + R() * 12; tear(128 + Math.cos(t) * r0, 128 + Math.sin(t) * r0, t, 28 + R() * R() * 62, (1.3 + R() * 1.6) * big); }
    for (let i = 0; i < 7; i++) { const t = R() * 6.2832, r = 26 + R() * 66; disc(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, (2.4 + R() * 3.4) * big); }
    for (let i = 0; i < 3; i++) blob(128 + (R() - 0.5) * 22, 128 + (R() - 0.5) * 22, 9 * big, 22 * big, 0.96, 0, 11);
    blob(128 + (R() - 0.5) * 8, 128 + (R() - 0.5) * 8, 6 * big, 15 * big, 0.9, 1, 9);
  } else if (kind === 'spray') {                                             // flung along a surface: from the bottom of the square upwards
    const ox = 128, oy = 238;
    for (let i = 0; i < 260; i++) { const t = (R() - 0.5) * 1.15, r = 20 + R() * 205; disc(ox + Math.sin(t) * r, oy - Math.cos(t) * r, 0.5 + R() * 1.2, 0.5 + R() * 0.45); }
    for (let i = 0; i < 420; i++) { const t = (R() + R() - 1) * 0.62, r = 10 + R() * 215; disc(ox + Math.sin(t) * r, oy - Math.cos(t) * r, 0.4 + R() * R() * 1.6, 0.5 + R() * 0.45); }
    for (let i = 0; i < 96; i++) { const t = (R() + R() - 1) * 0.5, r = 12 + R() * 196, k = 1 - r / 230; tear(ox + Math.sin(t) * r, oy - Math.cos(t) * r, t - Math.PI / 2, 5 + R() * 20 * (0.4 + k), 1.1 + R() * 3.2 * (0.3 + k)); }
    for (let i = 0; i < 3; i++) blob(ox + (R() - 0.5) * 16, oy - 22 - R() * 14, 6, 15, 0.95, 0, 10);
  } else if (kind === 'drip') {                                              // on a wall: a patch near the top of the square and what ran down from it
    const cx = 128, cy = 66, runs = 3 + (R() * 3 | 0);
    for (let i = 0; i < runs; i++) run(cx + (R() - 0.5) * 50, cy + 8, 60 + R() * 110, 3.5 + R() * 5);
    for (let i = 0; i < 16; i++) { const t = R() * 6.2832, r = 30 + R() * 34; disc(cx + Math.cos(t) * r, cy + Math.sin(t) * r * 0.8, 1.2 + R() * 3.2); }
    blob(cx, cy, 22, 36, 0.97); blob(cx, cy, 10, 20, 0.9, 1);
  } else if (kind === 'drops') {                                             // a scatter of round drops fallen short
    for (let i = 0; i < 34; i++) {
      const t = R() * 6.2832, r = R() * R() * 112, x = 128 + Math.cos(t) * r, y = 128 + Math.sin(t) * r, s = 2 + R() * R() * 9; disc(x, y, s);
      if (s > 5) for (let j = 0; j < 4; j++) { const u = R() * 6.2832; disc(x + Math.cos(u) * s * 1.7, y + Math.sin(u) * s * 1.7, 0.8 + R() * 1.2); }
    }
  } else if (kind === 'dot') {                                               // one drop fallen straight down: a round spot, its edge scalloped, a few beads thrown off
    for (let i = 0; i < 16; i++) { const t = i / 16 * 6.2832 + R() * 0.3; tear(128 + Math.cos(t) * 58, 128 + Math.sin(t) * 58, t, 8 + R() * 16, 4 + R() * 5); }
    for (let i = 0; i < 7; i++) { const t = R() * 6.2832, r = 88 + R() * 30; disc(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, 2 + R() * 4); }
    blob(128, 128, 58, 66, 0.97, 0, 18); blob(128, 128, 26, 40, 0.85, 1);
  } else if (kind === 'pool') {                                              // a pool: lobes run together, an uneven edge, thick and nearly black in the middle
    g.filter = 'blur(1.2px)';
    const lobes = [[128, 128, 62, 84]]; for (let i = 0; i < 6; i++) { const t = R() * 6.2832, r = 38 + R() * 34; lobes.push([128 + Math.cos(t) * r, 128 + Math.sin(t) * r, 22 + R() * 10, 34 + R() * 16]); }
    for (const [x, y, r0, r1] of lobes) blob(x, y, r0 + 3, r1 + 3, 0.96, 0.75, 10);                              // the rim, drying darker
    for (const [x, y, r0, r1] of lobes) blob(x, y, r0 - 1, r1 - 3, 0.97, 0.5, 10);
    g.filter = 'none'; soft(128, 128, 74, 0.95); for (let i = 1; i < 5; i++) soft(lobes[i][0], lobes[i][1], 30, 0.8);
    for (let i = 0; i < 14; i++) { const t = R() * 6.2832, r = 104 + R() * 20; disc(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, 1 + R() * 2.6, 0.9, 0.5); }
  } else if (kind === 'lens') {                                              // on the glass in front of the eye: soft, out of focus, a few fat drops that have started to run
    g.filter = 'blur(2.2px)';
    for (let i = 0; i < 120; i++) { const t = R() * 6.2832, r = 20 + R() * R() * 100; disc(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, 0.8 + R() * R() * 3, 0.45 + R() * 0.4); }
    for (let i = 0; i < 9; i++) { const t = R() * 6.2832, r = 30 + R() * 62; disc(128 + Math.cos(t) * r, 128 + Math.sin(t) * r, 3 + R() * 6, 0.8); }
    for (let i = 0; i < 3; i++) run(128 + (R() - 0.5) * 56, 124, 36 + R() * 72, 4 + R() * 5);
    for (let i = 0; i < 4; i++) blob(128 + (R() - 0.5) * 44, 122 + (R() - 0.5) * 36, 14, 32, 0.9, 0.2, 10);
    blob(128 + (R() - 0.5) * 14, 124 + (R() - 0.5) * 12, 10, 22, 0.85, 1, 9);
    g.filter = 'none';
  }
  return c;
}

export class Blood {
  constructor(G, R) {
    this.G = G; this.R = R; this.rnd = rng(4242); this.on = true;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.m4 = new THREE.Matrix4(); this.queue = []; this.grow = []; this.near = []; this.selfDead = -1;      // (-1: the player has not been alive yet, or has had his pool)
    const quad = new THREE.PlaneGeometry(1, 1); this.sets = {};
    for (const [kind, seed, max] of KINDS) {
      const map = new THREE.CanvasTexture(paint(kind.replace(/\d/, ''), seed)); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0, envMapIntensity: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const im = new THREE.InstancedMesh(quad, R.setup(mat), max);
      im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.userData.noAO = true; im.renderOrder = 3; im.name = 'blood:' + kind; R.scene.add(im);
      this.sets[kind] = { im, next: 0, max, gen: new Uint32Array(max) };
    }
    // the lens: a few splats over the picture, under the rest of the HUD
    this.lens = []; this.lensNext = 0;
    const host = typeof document !== 'undefined' && document.getElementById('hud');
    if (host) {
      const box = document.createElement('div'); box.id = 'gore'; box.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
      host.insertBefore(box, host.firstChild);
      const urls = [13, 29, 47].map(s => paint('lens', s).toDataURL());
      for (let i = 0; i < 7; i++) {
        const e = document.createElement('i'); e.style.cssText = `position:absolute;display:block;opacity:0;background:url(${urls[i % 3]}) center/contain no-repeat;filter:blur(1.8px)`;
        box.appendChild(e); this.lens.push({ e, t: 0, T: 1, on: false });
      }
    }
  }

  reset() {
    for (const d of Object.values(this.sets)) { d.im.count = 0; d.next = 0; }
    this.queue.length = 0; this.grow.length = 0; this.selfDead = -1;
    for (const s of this.lens) { s.on = false; s.e.style.opacity = 0; }
    const G = this.G; for (const a of [G.player, ...(G.bots?.list || [])]) if (a) a.bleedT = 0;
  }

  later(t, fn) { this.queue.push({ t, fn }); }
  // Boot: one stain of each kind drawn with the frame that warms every pipeline, so the first hit does not wait on one.
  warm(on) { for (const d of Object.values(this.sets)) d.im.count = on ? 1 : 0; }

  // the drawn meshes that come within r of c (and are the version on screen): what a handful of rays is then cast at
  nearMeshes(c, r) {
    const out = this.near, R = this.R; out.length = 0;
    for (const m of this.G.world.rayMeshes) { const s = m.geometry.boundingSphere; if (!s) continue; const q = r + s.radius; if (s.center.distanceToSquared(c) < q * q && R.kitShown(m)) out.push(m); }
    return out;
  }
  cast(o, d, far, list) {
    const rc = this.ray; rc.set(o, d); rc.near = 0; rc.far = far;
    let best = null; for (const h of rc.intersectObjects(list, false)) if (h.face && (!best || h.distance < best.distance)) best = h;
    if (!best) return null;
    const n = best.face.normal.clone(); if (n.dot(d) > 0) n.negate();
    return { p: best.point.clone(), n, t: best.distance };
  }

  // Is the surface there under the whole of a stain? Eight points round it (radii rx, ry along x and y), each looked for
  // within a few centimetres of the plane: a stain is a flat square, and one laid over a kerb, past a corner or across a
  // window's reveal hangs in the air.
  fits(p, n, x, y, rx, ry, list) {
    const rc = this.ray; _g.copy(n).negate();
    for (let i = 0; i < 8; i++) {
      const a = i * 0.7854 + 0.39, cx = Math.cos(a) * rx, cy = Math.sin(a) * ry;
      rc.set(_f.set(p.x + x.x * cx + y.x * cy + n.x * 0.2, p.y + x.y * cx + y.y * cy + n.y * 0.2, p.z + x.z * cx + y.z * cy + n.z * 0.2), _g); rc.near = 0; rc.far = 0.4;
      let t = 1e9; for (const h of rc.intersectObjects(list, false)) if (h.distance < t) t = h.distance;
      if (Math.abs(t - 0.2) > 0.035) return false;
    }
    return true;
  }
  // One stain on a surface: w by h metres, the square's up along yAxis (projected into the surface) or turned at random.
  // fit: only if the surface carries all of it (-1 if not).
  place(kind, p, n, w, h = w, yAxis = null, fit = false) {
    if (yAxis) _y.copy(yAxis).addScaledVector(n, -yAxis.dot(n));
    if (!yAxis || _y.lengthSq() < 1e-4) {
      _t.set(0, 1, 0); if (Math.abs(n.y) > 0.9) _t.set(1, 0, 0);
      _x.crossVectors(_t, n).normalize(); _y.crossVectors(n, _x);
      const a = this.rnd() * 6.2832, c = Math.cos(a), s = Math.sin(a); _t.copy(_x); _x.multiplyScalar(c).addScaledVector(_y, s); _y.multiplyScalar(c).addScaledVector(_t, -s);
    } else { _y.normalize(); _x.crossVectors(_y, n); }
    if (fit && !this.fits(p, n, _x, _y, w * 0.4, h * 0.4, this.nearMeshes(p, Math.max(w, h) * 0.5 + 0.5))) return -1;
    const d = this.sets[kind], i = d.next; d.next = (i + 1) % d.max; d.im.count = Math.min(d.max, d.im.count + 1); d.gen[i]++;
    this.m4.makeBasis(_a.copy(_x).multiplyScalar(w), _b.copy(_y).multiplyScalar(h), n).setPosition(p.x + n.x * 0.005, p.y + n.y * 0.005, p.z + n.z * 0.005);
    d.im.setMatrixAt(i, this.m4); d.im.instanceMatrix.needsUpdate = true;
    return i;
  }
  // What the drops thrown from a wound leave where they land. dir: their flight; dist: how far they flew; k: how much.
  stain(h, dir, k, dist) {
    const R = this.rnd, n = h.n, wall = Math.abs(n.y) < 0.6;
    _d.copy(dir).addScaledVector(n, -dir.dot(n));
    let done = false;
    if (_d.length() > 0.5 && dist > 0.45) {                                  // struck at a slant: drawn out along the surface
      _d.normalize(); const s0 = (0.55 + dist * 0.2 + R() * 0.25) * k;
      for (const f of [1, 0.6]) { const s = s0 * f; if (this.place('spray', _q.copy(h.p).addScaledVector(_d, s * 0.43), n, s * 0.8, s, _d, true) >= 0) { done = true; break; } }
    }
    if (!done) { const s0 = (0.3 + R() * 0.28) * k; for (const f of [1, 0.6, 0.36]) if (this.place(R() < 0.5 ? 'splat' : 'splat2', h.p, n, s0 * f, s0 * f, null, true) >= 0) { done = true; break; } }
    if (!done) return;                                                       // (a bar, a ledge: nothing flat enough to take one)
    if (wall && R() < 0.55 && dist < 3) {                                    // enough of it on a wall runs
      const s = (0.32 + R() * 0.3) * k; _u.set(0, 1, 0).addScaledVector(n, -n.y).normalize();
      this.place('drip', _q.copy(h.p).addScaledVector(_u, -s * 0.24), n, s * 0.8, s, _u, true);
    }
  }
  // A pool spreading from p: as large as the ground there carries, shifted off an edge if that lets it be larger.
  pool(p, n, size) {
    const R = this.rnd, list = this.nearMeshes(p, size + 0.6), a0 = R() * 6.2832;
    _t.set(0, 1, 0); if (Math.abs(n.y) > 0.9) _t.set(1, 0, 0);
    _x.crossVectors(_t, n).normalize(); _y.crossVectors(n, _x);
    let at = null, s1 = 0;
    for (const f of [1, 0.78, 0.58, 0.4]) {
      const s = size * f;
      for (let j = 0; j < 7 && !at; j++) {
        const q = j ? _q.copy(p).addScaledVector(_x, Math.cos(a0 + j) * s * 0.32).addScaledVector(_y, Math.sin(a0 + j) * s * 0.32) : _q.copy(p);
        if (this.fits(q, n, _x, _y, s * 0.43, s * 0.43, list)) { at = q.clone(); s1 = s; }
      }
      if (at) break;
    }
    if (!at) return;
    const d = this.sets.pool, i = this.place('pool', at, n, 0.1);
    this.grow.push({ i, gen: d.gen[i], p: V(at.x + n.x * 0.005, at.y + n.y * 0.005, at.z + n.z * 0.005), n: n.clone(), x: _x.clone(), y: _y.clone(), s0: 0.12, s1, ax: 1, t: 0, T: 8 + R() * 5 });
  }

  // A round (or a fragment) into a body at p, travelling along dir. zone: 'head' | 'body' | 'limb' | 'blast', or
  // 'corpse' for one already down. victim: the actor (his feet give the ground; null for a body on the ground).
  hit(victim, p, dir, zone = 'body', lit = 0.9) {
    const G = this.G, fx = G.fx, R = this.rnd, self = !!(victim && victim.isPlayer), dc = G.R.camera.position.distanceTo(p), L = 0.5 + 0.7 * lit;
    if (!self) for (let i = 0; i < 3; i++) fx.dust.add(p, V(-dir.x * 0.6 + (R() - 0.5) * 1.1, 0.3 + (R() - 0.5) * 1.1, -dir.z * 0.6 + (R() - 0.5) * 1.1), [0.5 * L, 0.47 * L, 0.4 * L], 0.24, 0.06 + R() * 0.05, 0.4 + R() * 0.4, -0.15, 2.6, 0.5);   // dust and fibre off the clothes
    if (!this.on || dc > FELT) return;
    const k = zone === 'head' ? 1.7 : zone === 'limb' ? 0.7 : zone === 'blast' ? 1.5 : zone === 'corpse' ? 0.55 : 1;
    const exit = _e.copy(p).addScaledVector(dir, zone === 'head' ? 0.2 : zone === 'limb' ? 0.12 : 0.3);       // where it comes out
    if (!self) {
      const red = [0.3 * L, 0.014 * L, 0.016 * L], dark = [0.17 * L, 0.008 * L, 0.01 * L], fy = (victim ? victim.pos.y : p.y - 0.4) + 0.012;
      for (let i = 0; i < 4; i++) fx.dust.add(p, V(-dir.x * (0.6 + R()) + (R() - 0.5) * 0.6, 0.2 + (R() - 0.5) * 0.6, -dir.z * (0.6 + R()) + (R() - 0.5) * 0.6), red, 0.68, 0.09 + R() * 0.05 * k, 0.17 + R() * 0.09, 0.3, 5, 1.9 * k);   // the burst at the wound: brief and dense, so a hit reads from where the shot came
      for (let i = 0; i < 9 * k; i++) fx.dust.add(p, V(-dir.x * (0.5 + R() * 1.6) + (R() - 0.5) * 1.6, (R() - 0.3) * 1.5, -dir.z * (0.5 + R() * 1.6) + (R() - 0.5) * 1.6), red, 0.2 + R() * 0.14, 0.03 + R() * 0.05, 0.2 + R() * 0.25, 0.5, 4, 0.9);
      for (let i = 0; i < 16 * k; i++) fx.dust.add(exit, V(dir.x * (1.5 + R() * 4.5) + (R() - 0.5) * 2.6, dir.y * 2 + (R() - 0.35) * 2.2, dir.z * (1.5 + R() * 4.5) + (R() - 0.5) * 2.6), red, 0.2 + R() * 0.16, 0.03 + R() * 0.07, 0.26 + R() * 0.36, 0.9, 3.4, 1.3);
      for (let i = 0; i < 16 * k; i++) {
        const out = zone === 'blast' ? R() < 0.5 : R() < 0.78, s = out ? 2 + R() * 6 : -(1 + R() * 2.5), w = out ? 2.6 : 1.8;
        fx.dust.add(out ? exit : p, V(dir.x * s + (R() - 0.5) * w, dir.y * s + R() * 1.8 + (out ? 0 : 0.3), dir.z * s + (R() - 0.5) * w), dark, 1, 0.014 + R() * R() * 0.03, 0.55 + R() * 0.6, 9.8, 0.5, 0, fy);
      }
    }
    if (victim && zone !== 'corpse') { victim.bleedT = Math.max(victim.bleedT || 0, 3.5 + k * 4); if (!(victim.bleedN > 0)) victim.bleedN = 0.25; victim.woundAt = zone; }
    if (dc > SEEN) return;
    const near = this.nearMeshes(exit, 4.8), blast = zone === 'blast', rays = zone === 'head' ? 5 : zone === 'limb' ? 2 : zone === 'corpse' ? 1 : blast ? 4 : 3, sp = blast ? 1.5 : 0.6;
    for (let i = 0; i < rays; i++) {
      const d = V(dir.x + (R() - 0.5) * sp, dir.y + (R() - 0.5) * sp * 0.75 - 0.1 - R() * 0.22, dir.z + (R() - 0.5) * sp).normalize(), h = this.cast(exit, d, 4.4, near);
      if (h) { const kk = k * (0.8 + R() * 0.4); this.later(0.03 + h.t / 13, () => this.stain(h, d, kk, h.t)); }
    }
    for (let i = 0, nd = zone === 'corpse' || zone === 'limb' ? 1 : blast ? 4 : 2; i < nd; i++) {     // what falls short spots the ground under the flight
      const f = 0.2 + R() * 1.5, o = V(exit.x + dir.x * f + (R() - 0.5) * 0.7, exit.y, exit.z + dir.z * f + (R() - 0.5) * 0.7), h = this.cast(o, DOWN, 2.8, near);
      if (h && h.n.y > 0.5) { const s = (0.28 + R() * 0.4) * Math.min(1.3, k); this.later(0.28 + R() * 0.25, () => { if (this.place('drops', h.p, h.n, s, s, null, true) < 0) this.place('drops', h.p, h.n, s * 0.5, s * 0.5, null, true); }); }
    }
  }

  // The player, hit: on the lens, towards where it came from (angle as HUD.damageFrom takes it) and off the middle.
  splash(angle, amount) {
    if (!this.on || !this.lens.length) return;
    const R = this.rnd, n = 1 + (amount > 24 ? 1 : 0) + (R() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const s = this.lens[this.lensNext]; this.lensNext = (this.lensNext + 1) % this.lens.length;
      const a = -angle + (R() - 0.5) * 1.9, r = 0.56 + R() * 0.34, size = 22 + R() * 26 + amount * 0.25, st = s.e.style;
      st.left = (50 + Math.sin(a) * r * 62).toFixed(1) + '%'; st.top = (50 - Math.cos(a) * r * 58).toFixed(1) + '%'; st.width = st.height = size.toFixed(1) + 'vh';
      st.transform = `translate(-50%,-50%) rotate(${(R() * 360).toFixed(0)}deg)`;
      s.t = 0; s.T = 2.6 + R() * 1.6 + amount / 30; s.on = true;
    }
  }

  update(dt) {
    const G = this.G, R = this.rnd, cam = G.R.camera.position;
    for (let i = this.queue.length - 1; i >= 0; i--) { const q = this.queue[i]; q.t -= dt; if (q.t <= 0) { this.queue.splice(i, 1); q.fn(); } }
    for (let i = this.grow.length - 1; i >= 0; i--) {                         // pools spreading, fast at first
      const g = this.grow[i], d = this.sets.pool; g.t += dt;
      if (d.gen[g.i] !== g.gen) { this.grow.splice(i, 1); continue; }         // (its place in the ring has gone to a newer one)
      const u = Math.min(1, g.t / g.T), s = g.s0 + (g.s1 - g.s0) * (1 - (1 - u) ** 2.4);
      this.m4.makeBasis(_a.copy(g.x).multiplyScalar(s * g.ax), _b.copy(g.y).multiplyScalar(s), g.n).setPosition(g.p);
      d.im.setMatrixAt(g.i, this.m4); d.im.instanceMatrix.needsUpdate = true;
      if (u >= 1) this.grow.splice(i, 1);
    }
    for (const s of this.lens) {
      if (!s.on) continue;
      s.t += dt; const u = s.t / s.T;
      if (u >= 1) { s.on = false; s.e.style.opacity = 0; continue; }
      const f = u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55; s.e.style.opacity = (Math.min(1, s.t / 0.05) * f * f * 0.88).toFixed(3);
    }
    if (!this.on) return;
    // the fallen bleed out where they come to rest
    for (const rag of G.rigid.rags) {
      if (rag.bled || rag.t < 0.9 || (rag.speed() > 0.5 && rag.t < 3.2)) continue;
      rag.bled = true;
      const c = rag.centre(_c); if (cam.distanceTo(c) > FELT) continue;
      const head = rag.bot?.woundAt === 'head' && rag.parts.find(q => q.key === 'head');     // from the wound: under the head, or out from under the chest (a pool the size of the body it lies under is not seen)
      if (head) { const t = head.body.translation(); c.set(t.x, t.y, t.z); } else { const a = R() * 6.2832; c.x += Math.cos(a) * 0.22; c.z += Math.sin(a) * 0.22; }
      const h = this.cast(_p.set(c.x, c.y + 0.3, c.z), DOWN, 1.9, this.nearMeshes(c, 2.2));
      if (h && h.n.y > 0.5) this.pool(h.p, h.n, 0.95 + R() * 0.5);
    }
    const P = G.player;
    if (P.alive) this.selfDead = 0;
    else if (this.selfDead >= 0) {
      this.selfDead += dt;
      if (this.selfDead > 0.8) { this.selfDead = -1; const h = this.cast(_p.set(P.pos.x, P.pos.y + 0.6, P.pos.z), DOWN, 2.2, this.nearMeshes(P.pos, 2.5)); if (h && h.n.y > 0.5) this.pool(h.p, h.n, 0.9 + R() * 0.4); }
    }
    // the wounded leave a trail: a drop every half second or so, from the height of the wound
    for (const a of this.actors()) {
      if (!a.alive) { a.bleedT = 0; continue; }
      if (!(a.bleedT > 0)) continue;
      a.bleedT -= dt; a.bleedN -= dt;
      if (a.bleedN > 0) continue;
      a.bleedN = 0.3 + R() * 0.6;
      if (cam.distanceToSquared(a.pos) > SEEN * SEEN) continue;
      const x = a.pos.x + (R() - 0.5) * 0.3, z = a.pos.z + (R() - 0.5) * 0.3, y = a.pos.y, s = 0.05 + R() * 0.07;
      if (!a.isPlayer) G.fx.dust.add(V(x, y + 0.95 + R() * 0.3, z), V(0, -0.5, 0), [0.26, 0.012, 0.014], 1, 0.022, 0.45, 9.8, 0, 0, y + 0.012);
      this.later(0.42, () => { const h = this.cast(_p.set(x, y + 0.5, z), DOWN, 1.4, this.nearMeshes(_p, 1.2)); if (h && h.n.y > 0.5) this.place('dot', h.p, h.n, s); });
    }
  }
  actors() { const G = this.G; return this._all && this._all.length === G.bots.list.length + 1 ? this._all : (this._all = [G.player, ...G.bots.list]); }
}
