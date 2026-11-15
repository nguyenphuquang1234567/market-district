// The two things carried besides the rifle: a K-22 fragmentation grenade and a V-8 smoke canister (both fictional).
// Everything about them lives here: the modelled objects, the hands that prime and throw them, their flight as rigid
// bodies, fuzes, the detonation and the burn, what they do to soldiers, clutter and bodies, and who is warned.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHand, sleeveGeom, basis } from './weapon.js';
import { Puffs, SmokeCloud, detonation, SMOKE } from './smoke.js';
import { DUST } from './fx.js';
import { rayBoxes, losClear, groundAt } from './physics.js';
import { canvasTexture, rng, clamp, lerp, damp, smooth } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const KIT = { frag: 2, smoke: 2 };
export const FUSE = { frag: 4.0, smoke: 1.6 };
const THROW = { over: { speed: 17.5, lift: 0.15 }, under: { speed: 8.2, lift: 0.26 } };
const BLAST = { reach: 11.5, peak: 175, shove: 8, power: 13 };      // fictional damage: lethal inside about 4 m in the open, nothing past 11.5 m or behind a wall

// ---- the objects ---------------------------------------------------------------------------------------------------------
function paint(base, band, lines, top) {
  const R = rng(base.length * 17 + lines.length);
  const t = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const v = R() < 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${0.012 + R() * 0.03})`; g.fillRect(R() * w, R() * h, 2 + R() * 14, 2 + R() * 9); }      // uneven coat
    if (top) { g.fillStyle = top; g.fillRect(0, 0, w, 20); }
    g.fillStyle = band; g.fillRect(0, 64, w, 9);
    g.font = '700 21px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle';
    for (const x0 of [14, 270]) lines.forEach((s, i) => { g.fillStyle = band; g.fillText(s, x0, 104 + i * 26); });
    for (let i = 0; i < 90; i++) {                           // chips and rub marks down to primer and bare steel
      const x = R() * w, y = R() * h, a = R() * 6.3, l = 3 + R() * 22; g.strokeStyle = R() < 0.55 ? `rgba(168,170,166,${0.25 + R() * 0.5})` : `rgba(96,60,42,${0.2 + R() * 0.4})`; g.lineWidth = 0.6 + R() * 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(205,190,160,${0.05 + R() * 0.1})`; g.beginPath(); g.arc(R() * w, R() * h, 3 + R() * 16, 0, 6.3); g.fill(); }      // dust
  });
  t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const strip = g => { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (a !== 'position' && a !== 'normal') q.deleteAttribute(a); return q; };
const join = list => mergeGeometries(list.map(strip));
const cyl = (r, h, y, seg = 20, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, h, seg); g.translate(0, y + h / 2, 0); return g; };
// A strip of sheet steel bent along a path in the y/z plane (the safety lever).
function lever(path, width, thick = 0.0013) {
  const s = new THREE.Shape(); const up = [], dn = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    up.push([path[i][0] - dy / l * thick / 2, path[i][1] + dx / l * thick / 2]); dn.push([path[i][0] + dy / l * thick / 2, path[i][1] - dx / l * thick / 2]);
  }
  s.moveTo(up[0][0], up[0][1]); for (const p of up.slice(1)) s.lineTo(p[0], p[1]); for (const p of dn.reverse()) s.lineTo(p[0], p[1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false }); g.translate(0, 0, -width / 2); g.rotateY(-Math.PI / 2);      // shape x -> +z, extrusion along x
  return g;
}
// Fuze assembly standing on y = y0: threaded collar, body, striker housing; the pin crosses it along x.
function fuze(y0) {
  const body = join([cyl(0.0128, 0.0045, y0, 24), cyl(0.0108, 0.017, y0 + 0.0045, 20), cyl(0.0122, 0.0034, y0 + 0.0215, 24, 0.0114),
    (() => { const g = new THREE.BoxGeometry(0.0074, 0.0062, 0.021); g.translate(0, y0 + 0.028, -0.001); return g; })(),
    (() => { const g = new THREE.CylinderGeometry(0.0031, 0.0031, 0.0086, 10); g.rotateZ(Math.PI / 2); g.translate(0, y0 + 0.0268, -0.0085); return g; })()]);
  return { body, pinY: y0 + 0.0268, pinZ: 0.0052 };
}
function pinGeoms(f) {
  const pin = new THREE.CylinderGeometry(0.00085, 0.00085, 0.027, 6); pin.rotateZ(Math.PI / 2); pin.translate(-0.0035, f.pinY, f.pinZ);          // head at +x
  const eye = new THREE.TorusGeometry(0.0021, 0.0008, 6, 12); eye.rotateX(Math.PI / 2); eye.translate(0.0118, f.pinY, f.pinZ);
  return join([pin, eye]);
}
const RING_R = 0.0118;

function buildModels(M) {
  const std = o => new THREE.MeshStandardMaterial(o);
  const mats = {
    fragBody: std({ map: paint('#4a5136', '#d2b23a', ['FRAG  K-22', 'LOT MD-0426'], null), metalness: 0.3, roughness: 0.6 }),
    canBody: std({ map: paint('#75806a', '#e9e7dc', ['SMOKE  V-8', 'HC WHT  MD-26'], null), metalness: 0.35, roughness: 0.52 }),
    canTop: std({ color: 0xdedcd2, metalness: 0.3, roughness: 0.55 }), canBase: std({ color: 0x5d6654, metalness: 0.4, roughness: 0.5 }),
    zinc: std({ color: 0x8f918c, metalness: 0.85, roughness: 0.46 }), lever: std({ color: 0x424a31, metalness: 0.45, roughness: 0.5 }),
    wire: std({ color: 0xb9bbbd, metalness: 1, roughness: 0.3 }), hole: new THREE.MeshBasicMaterial({ color: 0x050505 }),
  };
  const mk = (g, m, parent) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; parent.add(mesh); return mesh; };
  // fragmentation grenade: a 62 mm steel ball in two pressed halves, fuze on top, lever down one side
  const fF = fuze(0.0295), frag = { body: [], pin: pinGeoms(fF), f: fF };
  { const s = new THREE.SphereGeometry(0.031, 40, 26); frag.sphere = s;
    const seam = new THREE.TorusGeometry(0.0311, 0.0008, 6, 48); seam.rotateX(Math.PI / 2); const foot = cyl(0.011, 0.0016, -0.0318, 20); frag.trim = join([seam, foot]);
    const path = [[-0.0125, fF.pinY + 0.0048], [0.004, fF.pinY + 0.0048], [0.0125, fF.pinY + 0.0032]]; for (let a = 1.15; a >= -0.42; a -= 0.13) path.push([Math.cos(a) * 0.0331, Math.sin(a) * 0.0331]);
    path.push([Math.cos(-0.5) * 0.0345, Math.sin(-0.5) * 0.0345]); frag.lever = lever(path, 0.0125); }
  // smoke canister: a 59 mm rolled-seam can, vents in the top round the fuze and one in the base
  const fS = fuze(0.056), can = { pin: pinGeoms(fS), f: fS };
  { can.tube = new THREE.CylinderGeometry(0.0295, 0.0295, 0.112, 40, 1, true);
    const rims = []; for (const y of [0.056, -0.056]) { const t = new THREE.TorusGeometry(0.0289, 0.0016, 8, 40); t.rotateX(Math.PI / 2); t.translate(0, y, 0); rims.push(t); }
    const seam = new THREE.BoxGeometry(0.0022, 0.108, 0.0012); seam.translate(0, 0, -0.0297); can.rims = join([...rims, seam]);
    const top = new THREE.CircleGeometry(0.0284, 32); top.rotateX(-Math.PI / 2); top.translate(0, 0.0548, 0); can.top = top;
    const base = new THREE.CircleGeometry(0.0284, 32); base.rotateX(Math.PI / 2); base.translate(0, -0.0548, 0); can.base = base;
    const holes = []; for (let i = 0; i < 4; i++) { const h = new THREE.CircleGeometry(0.0042, 12); h.rotateX(-Math.PI / 2); const a = i * Math.PI / 2 + 0.785; h.translate(Math.cos(a) * 0.0195, 0.0551, Math.sin(a) * 0.0195); holes.push(h); }
    { const h = new THREE.CircleGeometry(0.005, 12); h.rotateX(Math.PI / 2); h.translate(0, -0.0551, 0); holes.push(h); } can.holes = join(holes);
    const path = [[-0.0125, fS.pinY + 0.0048], [0.004, fS.pinY + 0.0048], [0.014, fS.pinY + 0.0035], [0.0255, 0.0605], [0.0312, 0.054], [0.0318, 0.0], [0.0318, -0.018], [0.0335, -0.024]];
    can.lever = lever(path, 0.0125); }
  const ring = new THREE.TorusGeometry(RING_R, 0.0011, 8, 28);
  // kind -> a group; opts: lever / pin present (in the hand) or gone (in flight)
  const make = (kind, inHand) => {
    const g = new THREE.Group(), out = { group: g };
    if (kind === 'frag') { mk(frag.sphere, mats.fragBody, g); mk(frag.trim, mats.lever, g); mk(frag.f.body, mats.zinc, g); if (inHand) { out.lever = mk(frag.lever, mats.lever, g); out.pin = mk(frag.pin, mats.wire, g); } }
    else { mk(can.tube, mats.canBody, g); mk(can.rims, mats.canBase, g); mk(can.top, mats.canTop, g); mk(can.base, mats.canBase, g); mk(can.holes, mats.hole, g).castShadow = false; mk(can.f.body, mats.zinc, g); if (inHand) { out.lever = mk(can.lever, mats.lever, g); out.pin = mk(can.pin, mats.wire, g); } }
    return out;
  };
  const bit = what => { const g = new THREE.Group(); if (what === 'ring') { mk(ring, mats.wire, g); } else mk(what === 'fragLever' ? frag.lever : can.lever, mats.lever, g); return g; };
  return { make, bit, mats, ring, eye: { frag: V(0.0118, frag.f.pinY, frag.f.pinZ), smoke: V(0.0118, can.f.pinY, can.f.pinZ) }, vent: { frag: V(0, 0.06, 0), smoke: V(0, 0.058, 0) },
    pinGeo: { frag: frag.pin, smoke: can.pin }, mk };
}

// ---- hands -------------------------------------------------------------------------------------------------------------
// A pose in camera space: where the wrist is, which way the fingers and the palm face, where the elbow is.
function pose(wrist, fingers, palm, elbow) {
  const Y = V(...fingers).normalize(), Z = V(...palm); Z.addScaledVector(Y, -Z.dot(Y)).normalize(); const X = Y.clone().cross(Z);
  return { p: V(...wrist), q: new THREE.Quaternion().setFromRotationMatrix(basis(X, Y, Z, V(0, 0, 0))), e: V(...elbow) };
}
const blend = (a, b, k, out) => { out.p.lerpVectors(a.p, b.p, k); out.q.slerpQuaternions(a.q, b.q, k); out.e.lerpVectors(a.e, b.e, k); return out; };
// Where the object sits in the right hand (hand frame: +y to the fingertips, +z out of the palm, thumb on +x).
const GRIP = {
  frag: { c: V(0.004, 0.084, 0.0465), up: V(0.94, 0, 0.34), turn: 1.5, drop: V(0, 0, 0) },
  smoke: { c: V(-0.012, 0.087, 0.0445), up: V(1, 0, 0.0), turn: 1.5, drop: V(0, -0.022, -0.01) },      // drop: the longer can is held a little lower while it is primed
};

export class Throwables {
  constructor(G) {
    this.G = G; const R = G.R, cam = R.camera, W = G.weapon; this.rnd = rng(60606);
    this.count = { ...KIT }; this.sel = null; this.st = null; this.t = 0; this.under = false; this.press = false; this.was = false; this.live = []; this.clouds = []; this.bits = []; this.frags = []; this.flash = 0; this.lampT = 0; this.thrown = 0;
    this.puffs = new Puffs(G);
    const Md = this.models = buildModels();
    // one light for blasts, always in the scene so switching it on never recompiles a shader
    this.lamp = new THREE.PointLight(new THREE.Color(1, 0.6, 0.3), 0, 24, 2); this.lamp.position.set(0, -40, 0); R.scene.add(this.lamp);
    // ---- first-person rig
    const rig = this.rig = new THREE.Group(); cam.add(rig); rig.visible = false;
    const mk = (g, m, parent) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; parent.add(mesh); return mesh; };
    const rh = this.rh = new THREE.Group(), lh = this.lh = new THREE.Group(); rig.add(rh, lh);
    const curlBall = [[0.92, 1.0, 0.72], [0.64, 0.62, 0.46], [0.66, 0.64, 0.48], [1.05, 1.0, 0.7]], curlCan = [[0.67, 0.7, 0.53], [0.67, 0.7, 0.53], [0.69, 0.72, 0.54], [0.76, 0.76, 0.56]];
    this.hand = {
      frag: mk(buildHand(1, curlBall, [[0.044, 0.045, 0.02], [0.043, 0.07, 0.05], [0.031, 0.09, 0.0745]], -0.3), W.M.glove, rh),
      smoke: mk(buildHand(1, curlCan, [[0.044, 0.04, 0.03], [0.04, 0.062, 0.076], [0.03, 0.085, 0.0848]], 0), W.M.glove, rh),
      open: mk(buildHand(1, [[0.22, 0.3, 0.2], [0.3, 0.36, 0.25], [0.36, 0.42, 0.3], [0.44, 0.48, 0.32]], [[0.05, 0.04, 0.012], [0.066, 0.066, 0.022], [0.074, 0.09, 0.03]], 0.1), W.M.glove, rh),
    };
    mk(buildHand(-1, [[0.35, 1.25, 0.95], [1.3, 1.4, 0.95], [1.35, 1.45, 1.0], [1.4, 1.5, 1.0]], [[0.047, 0.05, 0.012], [0.05, 0.076, 0.036], [0.044, 0.098, 0.052]], 0.1), W.M.glove, lh);
    this.sleeveR = mk(sleeveGeom(), W.M.sleeve, rig); this.sleeveL = mk(sleeveGeom(), W.M.sleeve, rig);
    // the object in the right hand, one per kind
    this.held = {}; this.grip = GRIP; this.hook = { palm: [0.1, -0.8, -0.5], elbow: V(-0.32, -0.42, -0.03) };
    for (const kind of ['frag', 'smoke']) { const m = Md.make(kind, true); rh.add(m.group); m.group.visible = false; this.held[kind] = m; }
    // the ring rides the left index finger; the pin goes with it once pulled
    this.ringAt = V(-0.034, 0.1275, 0.022);
    this.ringG = new THREE.Group(); this.ringG.position.copy(this.ringAt); lh.add(this.ringG); mk(Md.ring, Md.mats.wire, this.ringG);
    this.pinMesh = { frag: mk(Md.pinGeo.frag, Md.mats.wire, this.ringG), smoke: mk(Md.pinGeo.smoke, Md.mats.wire, this.ringG) };
    // poses (camera space: x right, y up, -z ahead)
    const P = this.P = {
      hidden: pose([0.30, -0.56, -0.12], [-0.45, 0.55, -0.70], [-0.83, 0.03, 0.56], [0.46, -0.9, 0.2]),
      ready: pose([0.19, -0.172, -0.35], [-0.45, 0.55, -0.70], [-0.83, 0.03, 0.56], [0.38, -0.5, 0.0]),
      brace: pose([0.2, -0.18, -0.34], [-0.40, 0.56, -0.72], [-0.86, 0.0, 0.5], [0.39, -0.5, 0.02]),
      cock: pose([0.335, 0.13, -0.11], [-0.1, 0.9, 0.42], [-0.6, -0.3, -0.74], [0.43, -0.2, 0.12]),
      release: pose([0.19, 0.045, -0.47], [-0.15, 0.55, -0.82], [-0.3, -0.78, -0.55], [0.37, -0.22, -0.05]),
      follow: pose([0.045, -0.23, -0.45], [-0.3, -0.35, -0.89], [-0.2, -0.9, 0.38], [0.33, -0.42, -0.05]),
      exit: pose([0.12, -0.6, -0.25], [-0.3, -0.35, -0.89], [-0.2, -0.9, 0.38], [0.42, -0.9, 0.1]),
      lowCock: pose([0.265, -0.35, -0.10], [0.05, -0.75, -0.66], [-0.2, 0.55, -0.8], [0.37, -0.2, 0.27]),
      lowRelease: pose([0.17, -0.165, -0.49], [-0.05, 0.25, -0.97], [-0.15, 0.95, 0.25], [0.34, -0.43, -0.1]),
      lowFollow: pose([0.14, -0.01, -0.53], [-0.05, 0.7, -0.71], [-0.1, 0.7, 0.7], [0.33, -0.36, -0.14]),
      lhExit: pose([-0.26, -0.55, -0.16], [0.95, -0.21, 0.23], [0.1, -0.8, -0.5], [-0.5, -0.85, 0.15]),
    };
    this.rel = {}; this.fit();
    this.cur = { r: pose([0, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]), l: pose([0, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]) };
    this.m4 = new THREE.Matrix4(); this.one = V(1, 1, 1); this.tq = new THREE.Quaternion(); this.tv = V(); this.tv2 = V();
    R.setupTree(rig);
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    // one world model of each kind is kept in the scene (hidden) so the first throw compiles nothing
    this.spare = { frag: [], smoke: [] };
    for (const kind of ['frag', 'smoke']) for (let i = 0; i < 2; i++) this.spare[kind].push(this.worldModel(kind));
    this.spareBits = ['ring', 'fragLever', 'smokeLever'].map(w => { const b = Md.bit(w); b.visible = false; R.scene.add(b); R.setupTree(b); return b; });
  }

  // Seats each object in the right hand and works out where the left hand must be to have its index finger through the
  // ring: fingers reaching across along the pin, palm down, the back of the glove to the eye.
  fit() {
    const P = this.P, Md = this.models;
    for (const kind of ['frag', 'smoke']) {
      const g = this.grip[kind], grp = this.held[kind].group, Yg = g.up.clone().normalize(), Zp = V(0, 0, -1); Zp.addScaledVector(Yg, -Zp.dot(Yg)).normalize(); const Xg = Yg.clone().cross(Zp);
      basis(Xg, Yg, Zp, g.c).multiply(new THREE.Matrix4().makeRotationY(g.turn)).decompose(grp.position, grp.quaternion, grp.scale); grp.updateMatrix();
      const Rm = new THREE.Matrix4().compose(P.ready.p, P.ready.q, V(1, 1, 1)), eye = Md.eye[kind].clone().applyMatrix4(grp.matrix).applyMatrix4(Rm);
      const pull = V(1, 0, 0).transformDirection(grp.matrix).transformDirection(Rm);                                    // the pin comes out along its own length
      const hook = pose([0, 0, 0], [-pull.x, -pull.y, -pull.z], this.hook.palm, [0, 0, 0]);                             // so the hooked finger draws straight back along it
      const ringC = eye.clone().addScaledVector(pull, RING_R - 0.002);
      hook.p.copy(ringC).sub(this.ringAt.clone().applyQuaternion(hook.q));
      const Lm = new THREE.Matrix4().compose(hook.p, hook.q, V(1, 1, 1));
      this.rel[kind] = { m: Rm.clone().invert().multiply(Lm), pull, elbow: this.hook.elbow.clone(),
        pin: new THREE.Matrix4().makeTranslation(-this.ringAt.x, -this.ringAt.y, -this.ringAt.z).multiply(Lm.clone().invert()).multiply(Rm).multiply(grp.matrix) };
    }
  }
  setPose(name, wrist, fingers, palm, elbow) { this.P[name] = pose(wrist, fingers, palm, elbow); this.fit(); if (this.sel) this.show(); }

  worldModel(kind) { const m = this.models.make(kind, false).group; m.visible = false; this.G.R.scene.add(m); this.G.R.setupTree(m); return m; }
  // shader warm-up at boot: everything this file draws is shown for the compile pass
  warm(on) { this.rig.visible = on; for (const k of ['frag', 'smoke']) { this.held[k].group.visible = on; for (const m of this.spare[k]) m.visible = on; } for (const b of this.spareBits) b.visible = on; if (on) this.puffs.add({ x: 0, y: -30, z: 0, size: 0.1, life: 0.05 }); }

  get busy() { return this.st !== null; }
  get primed() { return this.st === 'cock' || this.st === 'hold' || (this.st === 'pull' && this.t > 0.2) || (this.st === 'swing' && !this.gone); }

  restock() { this.count = { ...KIT }; this.stow(true); }
  stow(now) { this.st = null; this.sel = null; this.rig.visible = false; this.G.weapon.holster(false); if (now) this.press = false; }
  reset() {
    for (const n of [...this.live]) this.remove(n);
    for (const b of this.bits) this.G.R.scene.remove(b.obj); this.bits.length = 0; this.frags.length = 0;
    this.clouds.length = 0; this.puffs.reset(); this.G.audio.stopHisses?.(); this.lamp.intensity = 0; this.lampT = 0; this.flash = 0; this.G.R.final.uFlash.value = 0;
    this.restock();
  }

  // ---- selection ---------------------------------------------------------------------------------------------------------
  select(kind) {
    const G = this.G; if (!G.player.alive) return false;
    if (this.st === 'ready' || this.st === 'draw') {
      if (this.sel === kind) { this.putAway(); return true; }
      if (this.count[kind] <= 0) { G.audio.weapon('dry'); return false; }
      this.sel = kind; this.st = 'draw'; this.t = 0.2; this.show(); G.audio.cloth(1); return true;
    }
    if (this.st) return false;                               // in the middle of a throw
    if (this.count[kind] <= 0) { G.audio.weapon('dry'); G.hud.noNade?.(kind); return false; }
    this.sel = kind; this.st = 'draw'; this.t = 0; this.press = false; this.gone = false; G.weapon.holster(true); this.show();
    G.audio.cloth(1.3); G.audio.nade('rattle', 0.35, 0.08);
    return true;
  }
  putAway() { if (this.st !== 'ready' && this.st !== 'draw') return; this.st = 'away'; this.t = 0; this.G.weapon.holster(false); this.G.audio.cloth(1); }
  show() {
    const k = this.sel; this.rig.visible = true;
    for (const n of ['frag', 'smoke']) { this.hand[n].visible = n === k; this.held[n].group.visible = n === k; this.held[n].lever.visible = true; this.held[n].pin.visible = false; this.pinMesh[n].visible = n === k; this.pinMesh[n].matrixAutoUpdate = false; this.pinMesh[n].matrix.copy(this.rel[n].pin); }
    this.hand.open.visible = false; this.lh.visible = true; this.sleeveL.visible = true; this.ringG.visible = true;
  }

  // ---- the hands: called by the player every frame, after the camera is placed ----------------------------------------------
  // inp: { fire, alt, speed, grounded, wallDist }
  hands(dt, inp) {
    const G = this.G, W = G.weapon, P = this.P, c = this.cur;
    const edge = (inp.fire || inp.alt) && !this.was; this.was = inp.fire || inp.alt;
    if (!this.st) return;
    if (edge && (this.st === 'draw' || this.st === 'ready')) { this.press = true; this.under = !inp.fire && inp.alt; }
    this.t += dt; const t = this.t, kind = this.sel, rel = this.rel[kind];
    let lhOn = true, coupled = true, low = 1;
    const ease = (a, b) => smooth(clamp((t - a) / (b - a), 0, 1));
    if (this.st === 'draw') { blend(P.hidden, P.ready, ease(0, 0.38), c.r); if (t >= 0.38) { this.st = 'ready'; this.t = 0; } }
    else if (this.st === 'away') { blend(P.ready, P.hidden, ease(0, 0.26), c.r); if (t >= 0.26) { this.stow(false); return; } }
    else if (this.st === 'ready') {
      blend(P.ready, P.ready, 0, c.r);
      if (this.press) { this.press = false; this.st = 'pull'; this.t = 0; this.cue = 0; }
    } else if (this.st === 'pull') {
      // the right hand braces; the left draws the pin straight out, then turns away with it
      blend(P.ready, P.brace, ease(0, 0.12), c.r); coupled = false;
      this.m4.compose(c.r.p, c.r.q, this.one).multiply(rel.m).decompose(c.l.p, c.l.q, this.tv);
      const out = ease(0.06, 0.2), turn = ease(0.14, 0.3);
      c.l.p.addScaledVector(rel.pull, out * 0.075); c.l.p.x -= turn * 0.05; c.l.p.y -= turn * 0.03;
      c.l.q.premultiply(this.tq.setFromAxisAngle(this.tv.set(0, 0, 1), turn * 0.5)); c.l.e.copy(rel.elbow);
      if (this.cue === 0 && t >= 0.06) { this.cue = 1; G.audio.nade('pinpull', 0.75); }
      if (t >= 0.3) { this.st = 'cock'; this.t = 0; this.cue = 0; this.lFrom = { p: c.l.p.clone(), q: c.l.q.clone(), e: c.l.e.clone() }; }
    } else if (this.st === 'cock') {
      blend(P.brace, this.under ? P.lowCock : P.cock, ease(0, 0.22), c.r); coupled = false; low = 1 - ease(0, 0.22);
      blend(this.lFrom, P.lhExit, ease(0, 0.3), c.l);
      if (this.cue === 0 && t >= 0.07) { this.cue = 1; this.dropRing(); }
      if (t >= 0.22) { this.st = 'hold'; this.t = 0; }
    } else if (this.st === 'hold') {
      const a = this.under ? P.lowCock : P.cock; blend(a, a, 0, c.r); lhOn = false; low = 0;
      c.r.p.x += Math.sin(G.time * 31) * 0.0006; c.r.p.y += Math.sin(G.time * 23 + 1) * 0.0008;          // the arm held back is not quite still
      if (!(this.under ? inp.alt : inp.fire) && t > 0.03) { this.st = 'swing'; this.t = 0; this.cue = 0; G.audio.nade('whoosh', 0.7); G.audio.cloth(1.4); }
    } else if (this.st === 'swing') {
      lhOn = false; low = 0;
      const A = this.under ? P.lowCock : P.cock, B = this.under ? P.lowRelease : P.release, C = this.under ? P.lowFollow : P.follow, T1 = this.under ? 0.13 : 0.11;
      if (t < T1) blend(A, B, (t / T1) ** 1.7, c.r); else blend(B, C, 1 - (1 - clamp((t - T1) / 0.13, 0, 1)) ** 2, c.r);
      if (this.cue === 0 && t >= T1) { this.cue = 1; this.release(); }
      if (t >= T1 + 0.13) { this.st = 'recover'; this.t = 0; W.holster(false); }
    } else if (this.st === 'recover') {
      lhOn = false; low = 0; blend(this.under ? P.lowFollow : P.follow, P.exit, ease(0, 0.24), c.r);
      if (t >= 0.24) { this.stow(false); return; }
    }
    if (coupled) { this.m4.compose(c.r.p, c.r.q, this.one).multiply(rel.m).decompose(c.l.p, c.l.q, this.tv); c.l.e.copy(rel.elbow).add(c.r.p).sub(P.ready.p); }
    const drop = this.grip[kind].drop;
    this.rh.position.copy(c.r.p).addScaledVector(drop, low); this.rh.quaternion.copy(c.r.q); this.lh.position.copy(c.l.p).addScaledVector(drop, low); this.lh.quaternion.copy(c.l.q);
    this.lh.visible = lhOn; this.sleeveL.visible = lhOn;
    for (const [sl, h] of [[this.sleeveR, c.r], [this.sleeveL, c.l]]) { const d = this.tv.copy(h.e).sub(h.p).normalize(); sl.position.copy(h.p).addScaledVector(drop, low).addScaledVector(d, 0.012); sl.quaternion.setFromUnitVectors(this.tv2.set(0, -1, 0), d); }
    // the rig rides the body like the rifle does: breath, footfall, look inertia, and it draws back from a wall
    const bob = Math.min(1, inp.speed / 4.5) * (inp.grounded ? 1 : 0.2), wall = clamp((0.8 - inp.wallDist) / 0.5, 0, 1), still = this.st === 'ready' || this.st === 'hold' ? 1 : 0.4;
    this.rig.position.set(Math.cos(W.bobT) * 0.004 * bob + W.sway.x * 0.04, Math.sin(W.time * 1.5) * 0.0018 * still - Math.abs(Math.sin(W.bobT)) * 0.006 * bob - W.land * 0.03 - wall * 0.04, wall * 0.13);
    this.rig.rotation.set(W.sway.y * 0.8 + Math.sin(W.time * 1.5 + 0.6) * 0.003 * still, W.sway.x * 0.8, Math.cos(W.bobT) * 0.01 * bob, 'YXZ');
  }

  // the pin and ring leave the finger and fall at the feet
  dropRing() {
    const G = this.G, kind = this.sel; this.ringG.updateWorldMatrix(true, false);
    const b = this.spawnBit('ring', this.ringG.matrixWorld, V(-0.6, 0.3, 0).applyQuaternion(G.R.camera.quaternion).add(G.player.vel), 0.6);
    const pin = new THREE.Mesh(this.pinMesh[kind].geometry, this.models.mats.wire); pin.matrixAutoUpdate = false; pin.matrix.copy(this.pinMesh[kind].matrix); pin.frustumCulled = false; b.obj.add(pin);
    this.ringG.visible = false;
  }
  spawnBit(what, matrixWorld, vel, ring = 1) {
    const G = this.G, obj = this.models.bit(what); obj.applyMatrix4(matrixWorld); G.R.scene.add(obj); G.R.setupTree(obj);
    const R = this.rnd, b = { obj, v: vel, w: V((R() - 0.5) * 30, (R() - 0.5) * 30, (R() - 0.5) * 30), life: 14, rest: false, ring, hits: 0 };
    this.bits.push(b); while (this.bits.length > 8) G.R.scene.remove(this.bits.shift().obj);
    return b;
  }

  // ---- letting go ------------------------------------------------------------------------------------------------------------
  release() {
    const G = this.G, cam = G.R.camera, kind = this.sel, P = G.player, R = this.rnd, th = this.under ? THROW.under : THROW.over, cols = G.world.colliders;
    const q = cam.quaternion, fwd = V(0, 0, -1).applyQuaternion(q), right = V(1, 0, 0).applyQuaternion(q), up = V(0, 1, 0).applyQuaternion(q);
    const dir = fwd.clone().multiplyScalar(Math.cos(th.lift)).addScaledVector(up, Math.sin(th.lift)).normalize();
    const held = this.held[kind]; held.group.updateWorldMatrix(true, false);
    const from = cam.position.clone(), at = V().setFromMatrixPosition(held.group.matrixWorld), quat = new THREE.Quaternion().setFromRotationMatrix(held.group.matrixWorld);
    // never start it inside or beyond a wall the hand has reached through
    const d = at.clone().sub(from), len = d.length(); d.multiplyScalar(1 / len);
    const hit = rayBoxes(from.x, from.y, from.z, d.x, d.y, d.z, len + 0.08, cols, null);
    if (hit < len + 0.08) at.copy(from).addScaledVector(d, Math.max(0.05, hit - 0.09));
    const vel = dir.multiplyScalar(th.speed * (0.97 + R() * 0.06)).add(P.vel);
    const spin = right.clone().multiplyScalar(this.under ? 5 + R() * 4 : -(11 + R() * 7)).add(V((R() - 0.5) * 5, (R() - 0.5) * 5, (R() - 0.5) * 5));
    const n = this.spawn(kind, at, vel, spin, quat, P);
    // the lever springs off as the hand opens; the striker fires the primer under it
    held.lever.updateWorldMatrix(true, false);
    this.spawnBit(kind + 'Lever', held.lever.matrixWorld, vel.clone().multiplyScalar(0.25).addScaledVector(right, 1.6 + R()).addScaledVector(up, 2.2 + R()), 1);
    G.audio.nade('spoon', 0.8);
    held.group.visible = false; this.hand[kind].visible = false; this.hand.open.visible = true; this.gone = true;
    this.count[kind]--; this.thrown++;
    return n;
  }
  // Killed with the pin out: the hand opens and it falls where the soldier stood.
  dropHeld() {
    if (this.primed && this.sel && this.count[this.sel] > 0) {
      const G = this.G, P = G.player, R = this.rnd;
      this.spawn(this.sel, V(P.pos.x, P.pos.y + 1.1, P.pos.z), V(P.vel.x * 0.5 + (R() - 0.5), 0.5, P.vel.z * 0.5 + (R() - 0.5)), V(R() * 6 - 3, R() * 6 - 3, R() * 6 - 3), new THREE.Quaternion(), P);
      this.count[this.sel]--; G.audio.nade('spoon', 0.6);
    }
    this.stow(true);
  }
  // A live one in the world. by: who threw it (credited with what it does).
  spawn(kind, pos, vel, spin, quat, by) {
    const G = this.G, obj = this.spare[kind].pop() || this.worldModel(kind); obj.visible = true;
    const item = G.rigid.addNade(kind, obj, pos, vel, spin, quat);
    const n = { kind, item, obj, by, t: 0, fuse: FUSE[kind] * (0.96 + this.rnd() * 0.09), bounces: 0, lit: false, cloud: null, hiss: null, hissT: 0, warned: new Set(), warnT: 0, trail: 0, from: by ? by.pos.clone() : pos.clone(), rest: 0 };
    item.owner = n; this.live.push(n);
    return n;
  }
  remove(n) {
    const i = this.live.indexOf(n); if (i < 0) return; this.live.splice(i, 1);
    this.G.rigid.endNade(n.item); n.obj.visible = false; this.spare[n.kind].push(n.obj); if (n.hiss) n.hiss.stop(); if (n.cloud) n.cloud.orphan = true;
  }
  pos(n, out) { const t = n.item.body.translation(); return out.set(t.x, t.y, t.z); }

  // A knock reported by the rigid world.
  bounce(item, speed, p, surf) {
    const n = item.owner, G = this.G; if (!n) return;
    n.bounces++;
    G.audio.nadeBounce(n.kind, surf || 'concrete', { x: p.x, y: p.y, z: p.z }, speed);
    if (speed > 1.2) G.bots.hear(p, 11, -1);
    if (speed > 3 && (surf === 'dirt' || surf === 'concrete')) G.fx.kickDust(V(p.x, p.y, p.z), 0.8);
  }

  // ---- per frame -------------------------------------------------------------------------------------------------------------
  update(dt) {
    const G = this.G, R = this.rnd, tv = this.tv;
    for (const n of [...this.live]) {
      G.rigid.nadeTick(n.item, dt); n.t += dt;
      const p = this.pos(n, tv);
      if (p.y < -6) { this.remove(n); continue; }
      if (n.kind === 'frag') {
        // the delay element burning: a thread of smoke from the fuze
        n.trail -= dt; if (n.trail <= 0) { n.trail = 0.045; G.fx.dust.add(V(p.x, p.y + 0.04, p.z), V((R() - 0.5) * 0.2, 0.25, (R() - 0.5) * 0.2), [0.78, 0.78, 0.76], 0.11, 0.035, 0.55, -0.15, 1.5, 0.1); }
        if (n.bounces > 0) { n.warnT -= dt; if (n.warnT <= 0) { n.warnT = 0.15; G.bots.grenade(n, p, n.fuse - n.t); } }
        if (n.t >= n.fuse) this.explode(n);
      } else this.burn(n, p, dt);
    }
    this.clouds = this.clouds.filter(c => !c.done);
    // fragments are traced a batch a frame
    if (this.frags.length) { const f = this.frags[0]; this.fragBatch(f, 11); if (f.left <= 0) this.frags.shift(); }
    // blast light and the flash in the eye
    if (this.lampT > 0) { this.lampT -= dt; const k = Math.max(0, this.lampT / 0.16); this.lamp.intensity = this.lampI * k * k; this.puffs.mat.uniforms.uLampCol.value.set(1, 0.6, 0.3).multiplyScalar(this.lamp.intensity); if (this.lampT <= 0) this.lamp.intensity = 0; }
    else this.puffs.mat.uniforms.uLampCol.value.set(0, 0, 0);
    this.flash = Math.max(0, this.flash - dt * (1.6 + this.flash * 5)); G.R.final.uFlash.value = this.flash;
    this.puffs.update(dt, G.R.camera);
    this.updateBits(dt);
  }

  // ---- smoke canister ----------------------------------------------------------------------------------------------------------
  burn(n, p, dt) {
    const G = this.G, R = this.rnd;
    if (!n.lit) {
      if (n.t < n.fuse) return;
      n.lit = true; n.burnT = 0;
      const fl = groundAt(p.x, p.z, p.y + 0.1, 0.05, G.world.colliders, 0.06).y;
      n.cloud = new SmokeCloud(this.puffs, fl, p.x, p.z, { low: 0.62, medium: 0.8, high: 1, ultra: 1.15 }[G.settings.quality] || 1); this.clouds.push(n.cloud);
      G.audio.smokePop({ x: p.x, y: p.y, z: p.z }); n.hiss = G.audio.smokeHiss({ x: p.x, y: p.y, z: p.z });
      G.bots.hear(p, 24, -1);
      n.item.body.applyImpulse({ x: (R() - 0.5) * 0.5, y: 0.5 + R() * 0.3, z: (R() - 0.5) * 0.5 }, true);            // the fuze firing kicks it
      n.item.body.applyTorqueImpulse({ x: (R() - 0.5) * 0.02, y: (R() - 0.5) * 0.05, z: (R() - 0.5) * 0.02 }, true);
    }
    n.burnT += dt;
    const r = n.item.body.rotation(), ax = this.tv2.set(0, 1, 0).applyQuaternion(this.tq.set(r.x, r.y, r.z, r.w)), vent = V(p.x + ax.x * 0.06, p.y + ax.y * 0.06, p.z + ax.z * 0.06);
    if (n.burnT < SMOKE.burn) {
      // the jet shoves the canister about for the first seconds, and spits sparks while the starter mix burns
      if (n.burnT < 2.2 && R() < dt * 9) { n.item.body.applyImpulse({ x: -ax.x * 0.12 + (R() - 0.5) * 0.1, y: 0.02, z: -ax.z * 0.12 + (R() - 0.5) * 0.1 }, true); n.item.body.applyTorqueImpulse({ x: 0, y: (R() - 0.5) * 0.03, z: 0 }, true); }
      if (n.burnT < 1.1) for (let i = 0; i < 3; i++) if (R() < dt * 60) G.fx.glow.add(vent, V(ax.x * 5 + (R() - 0.5) * 4, ax.y * 5 + 1 + R() * 3, ax.z * 5 + (R() - 0.5) * 4), [7, 4.4, 1.6], 1, 0.016 + R() * 0.014, 0.2 + R() * 0.3, 9.8, 1.5, 0, n.cloud.floor);
    } else if (n.hiss) { n.hiss.stop(); n.hiss = null; }
    n.cloud.update(dt, vent, ax);
    n.hissT -= dt; if (n.hiss && n.hissT <= 0) { n.hissT = 0.12; const u = n.burnT; n.hiss.set({ x: p.x, y: p.y, z: p.z }, Math.min(1, u / 0.25) * (u > SMOKE.burn - 3 ? Math.max(0, (SMOKE.burn - u) / 3) : 1)); }
    if (n.burnT > SMOKE.burn + SMOKE.hang + 20) this.remove(n);
  }
  // Is there too much smoke between two points to see from one to the other?
  smoked(a, b) { return this.puffs.list.length > 0 && this.puffs.depth(a, b) > 1.6; }

  // ---- fragmentation grenade -----------------------------------------------------------------------------------------------------
  explode(n) {
    const G = this.G, R = this.rnd, cols = G.world.colliders, P = G.player, cam = G.R.camera;
    const p = this.pos(n, V()), by = n.by; this.remove(n);
    const fl = groundAt(p.x, p.z, p.y + 0.12, 0.05, cols, 0.06).y, airborne = p.y - fl > 0.7;
    const o = V(p.x, Math.max(p.y, fl + 0.06) + 0.14, p.z);                                           // a hand's breadth clear of the ground, so a kerb or a body does not swallow it
    const out = {}; let surf = G.world.surfaceAt(p.x, p.z);
    if (rayBoxes(p.x, p.y + 0.1, p.z, 0, -1, 0, 1.2, cols, out) < 1.2 && out.b && out.b.surf) surf = out.b.surf;
    const lit = losClear(o, this.tv.copy(o).addScaledVector(G.R.sunDir, 80), cols) ? 1 : 0.25, dust = DUST[surf] || DUST.concrete;
    // what is seen
    G.fx.blast(o, fl, lit, surf); detonation(this.puffs, o, fl, dust, airborne);
    if (!airborne) G.fx.decal('scorch', V(p.x, fl, p.z), V(0, 1, 0), 2.1 + R() * 0.7);
    for (let i = 0; i < 6; i++) {                                                                       // soot on a wall it went off against
      const a = i / 6 * 6.283, dx = Math.cos(a), dz = Math.sin(a), h = rayBoxes(o.x, o.y + 0.25, o.z, dx, 0, dz, 1.0, cols, out);
      if (h < 1.0 && out.b) G.fx.decal('scorch', V(o.x + dx * h, o.y + 0.25, o.z + dz * h), V(out.nx, out.ny, out.nz), 1.5 - h * 0.6);
    }
    this.lamp.position.copy(o).y += 0.5; this.lampI = 620; this.lampT = 0.16; this.lamp.intensity = this.lampI; this.puffs.mat.uniforms.uLampPos.value.copy(this.lamp.position);
    this.frags.push({ o, lit, left: 55, heard: 0 });
    // what it does
    const actors = G.bots.actors(), head = V(), tv = this.tv;
    for (const a of actors) {
      if (!a.alive) continue;
      const cy = a.pos.y + a.height * 0.55, d = Math.hypot(a.pos.x - o.x, cy - o.y, a.pos.z - o.z); if (d > BLAST.reach + 1) continue;
      let open = 0; for (const y of [a.eyeY - 0.05, cy, a.pos.y + 0.28]) if (losClear(o, head.set(a.pos.x, y, a.pos.z), cols)) open++;
      const near = clamp(1 - d / BLAST.reach, 0, 1);
      if (!a.isPlayer) { a.dazed = Math.max(a.dazed || 0, near * 3.2 * (open ? 1 : 0.4)); a.flinch = Math.max(a.flinch, near * 1.5); }
      if (!open) continue;
      let dmg = BLAST.peak * near ** 1.4 * (open / 3) ** 0.7;
      if (by && a !== by && a.team === by.team) dmg *= 0.4;                                             // own side: hurt, rarely killed
      if (dmg < 1) continue;
      const killed = a.damage(dmg, o, by, 'blast');
      if (by === P && a !== P && a.team !== P.team) { G.hud.hitmarker(killed ? 'kill' : 'hit'); G.audio.ui('hit'); G.stats.hits++; }
    }
    const moved = G.rigid.blast(o, BLAST.shove, BLAST.power);
    for (const m of this.live) if (m.kind === 'frag' && m.t > 0.3) { const q = this.pos(m, tv); if (q.distanceTo(o) < 2.2) m.fuse = Math.min(m.fuse, m.t + 0.06 + R() * 0.08); }      // one sets off the next
    // what is heard and felt
    const hit = G.audio.explosion({ x: o.x, y: o.y, z: o.z }) || 0, dP = cam.position.distanceTo(o), seen = losClear(cam.position, o, cols);
    if (P.alive) {
      const k = clamp(1.2 - dP / 16, 0, 1) * (seen ? 1 : 0.45);
      P.shake = Math.min(1.6, P.shake + k * 1.6); P.punchP += 0.07 * k * (R() < 0.5 ? -1 : 1); P.punchR += (R() - 0.5) * 0.12 * k; P.fovKick = Math.max(P.fovKick, 2.4 * k);
      if (seen) { const f = tv.copy(o).sub(cam.position).normalize().dot(V(0, 0, -1).applyQuaternion(cam.quaternion)); this.flash = Math.max(this.flash, clamp(1.15 - dP / 13, 0, 1) * (0.25 + 0.5 * clamp(f, 0, 1))); }
    }
    G.bots.hear(o, 80, -1);
    G.bots.blasted(o, by);
    this.lastBlast = { at: o.clone(), time: G.time, moved, hit };
    return o;
  }
  // Fragments: straight lines out of the burst. Each that finds a wall, the road or a loose thing marks it.
  fragBatch(f, count) {
    const G = this.G, R = this.rnd, cam = G.R.camera.position;
    for (let i = 0; i < count && f.left > 0; i++, f.left--) {
      const a = R() * 6.283, y = R() * 1.15 - 0.2, r = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y))), dir = V(Math.cos(a) * r, Math.min(1, y), Math.sin(a) * r).normalize();
      this.ray.set(f.o, dir); this.ray.far = 26;
      const hits = this.ray.intersectObjects(G.world.rayMeshes, false); let h = null; for (const q of hits) if (!h || q.distance < h.distance) h = q;
      const far = h ? h.distance : 26, ph = G.rigid.ray(f.o, dir, far);
      if (ph) { const it = ph.item, J = Math.min(1.6, 0.4 + it.mass * 0.25), at = V(f.o.x + dir.x * ph.t, f.o.y + dir.y * ph.t, f.o.z + dir.z * ph.t); it.body.applyImpulseAtPoint({ x: dir.x * J, y: dir.y * J, z: dir.z * J }, at, true); G.fx.impact(it.kind === 'rag' ? 'fabric' : 'metal', at, V(ph.n.x, ph.n.y, ph.n.z), f.lit, 0.6); continue; }
      if (!h || h.distance < 0.35) continue;
      const nrm = h.face.normal.clone(); if (nrm.dot(dir) > 0) nrm.negate();
      const surf = h.object.userData.surf || 'concrete';
      G.fx.impact(surf, h.point, nrm, f.lit * 0.7, 0.5 + R() * 0.4);
      if (f.heard < 5 && h.point.distanceTo(cam) < 26 && R() < 0.4) { f.heard++; G.audio.impact(surf, { x: h.point.x, y: h.point.y, z: h.point.z }, false); }
    }
  }

  // small steel parts: pin and ring, lever. They fall, ring on the ground and lie there for a while.
  updateBits(dt) {
    const G = this.G, cols = G.world.colliders;
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i]; b.life -= dt;
      if (b.life <= 0) { G.R.scene.remove(b.obj); this.bits.splice(i--, 1); continue; }
      if (b.rest) continue;
      const o = b.obj, y0 = o.position.y; b.v.y -= 9.8 * dt; o.position.addScaledVector(b.v, dt);
      const a = b.w.length() * dt; if (a > 1e-5) o.quaternion.premultiply(this.tq.setFromAxisAngle(this.tv.copy(b.w).normalize(), a));
      const fl = groundAt(o.position.x, o.position.z, y0, 0.02, cols, 0.02).y + 0.004;
      if (o.position.y < fl) {
        o.position.y = fl;
        if (Math.abs(b.v.y) > 0.5 && b.hits < 4) { b.hits++; G.audio.tink({ x: o.position.x, y: fl, z: o.position.z }, Math.abs(b.v.y) / 3 * b.ring); b.v.y *= -0.32; b.v.x *= 0.55; b.v.z *= 0.55; b.w.multiplyScalar(0.5); }
        else { b.rest = true; o.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, this.rnd() * 6.28)); }
      }
    }
  }
}
