// Dev probe for the civilians: stages people in front of a free camera and saves captures (captures/), for judging
// faces, clothes, clips and expressions, and reads the live simulation. Load it in the page:
//   const P = await import('/tools/civ-probe.js?v=' + Date.now())
//   await P.stage(G, ['f01', 'm01'], { x: 0, z: -40, clip: 'talk' }); await P.shot(G, 'pair', { dist: 2.6, height: 1.2 })
//   await P.faces(G, 'f01')        every expression of one face, as a contact sheet's frames
// Staged people are outside the simulation (no brain); P.clear() removes them.
import * as THREE from 'three';
import { civ } from '/src/civ-assets.js';
import { assets } from '/src/assets.js';
import { Animator, LOCO } from '/src/civ-anim.js';
import { Face, EXPRESSIONS } from '/src/civ-face.js';
import { RAG_JOINTS } from '/src/rigid.js';

const staged = [];
export const list = staged;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- clipping, measured -----------------------------------------------------------------------------------------------------
// Things going through things, counted rather than looked for. Each part returns numbers that should be zero (or a
// clearance that should be positive); `audit` runs them all.
const wp = (c, name, out = new THREE.Vector3()) => c.inst.bones[c.person.bone[name]].getWorldPosition(out);
const inBox = (b, p, m = 0.03) => { if (p.y <= b.y0 + m || p.y >= b.y1 - m) return false; const dx = p.x - b.x, dz = p.z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c; return Math.abs(lx) < b.hx - m && Math.abs(lz) < b.hz - m; };
const segPoint = (a, b, p) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1))); return a.clone().addScaledVector(ab, t).distanceTo(p); };
const PARTS = ['Head', 'Hips', 'Spine2', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftLeg', 'RightLeg', 'LeftForeArm', 'RightForeArm'];
// One frame of the live game: who is inside whom or what.
export function overlaps(G) {
  const L = G.civs.list.filter(c => c.alive && c.visible !== undefined), out = { people: [], solids: [], props: [], soldiers: [], camera: [] }, cols = G.world.colliders, p = new THREE.Vector3(), q = new THREE.Vector3();
  for (const c of L) c.root.updateMatrixWorld(true);
  const body = c => { const h = wp(c, 'Hips'), s = wp(c, 'Spine2'); return [h, s]; };
  for (let i = 0; i < L.length; i++) {
    const a = L[i], [ah, as] = body(a);
    for (let j = i + 1; j < L.length; j++) { const b = L[j]; if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 2) continue; const [bh, bs] = body(b), d = Math.min(Math.hypot(ah.x - bh.x, ah.z - bh.z), Math.hypot(as.x - bs.x, as.z - bs.z)); if (d < 0.36 && Math.abs(ah.y - bh.y) < 0.8) out.people.push(`${a.id}(${a.state})+${b.id}(${b.state}) ${d.toFixed(2)}`); }
    for (const s of G.bots.list) { if (!s.alive) continue; const d = Math.hypot(ah.x - s.pos.x, ah.z - s.pos.z); if (d < 0.42) out.soldiers.push(`${a.id}(${a.state})+${s.name} ${d.toFixed(2)}`); }
    for (const name of PARTS) { wp(a, name, p); if (cols.some(b => inBox(b, p))) out.solids.push(`${a.id}(${a.state}) ${name}`); }
    for (const it of G.rigid.props) {
      const t = it.body.translation(); if (Math.hypot(t.x - a.pos.x, t.z - a.pos.z) > 1.6) continue;
      const r = it.body.rotation(), inv = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert(), sz = assets.proto[it.name]?.size;
      if (!sz) continue;
      if (a.state === 'sit' && a.seat?.item === it) {                             // their own seat: how they sit on it (hip joint in the chair's frame: across, up, front)
        if (a.phase === 2) { wp(a, 'Hips', p); q.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(inv); (out.seats ||= []).push(`${a.id} ${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}`); if (Math.abs(q.x) > 0.07 || q.y < 0.5 || q.y > 0.58 || q.z > 0.02 || q.z < -0.16) out.props.push(`${a.id}(sit) off the seat [${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}]`); }
        continue;
      }
      for (const name of PARTS) { wp(a, name, p); q.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(inv).divideScalar(it.scale); if (Math.abs(q.x) < sz.x / 2 - 0.04 && Math.abs(q.z) < sz.z / 2 - 0.04 && q.y > 0.04 && q.y < sz.y - 0.04) out.props.push(`${a.id}(${a.state}${a.phase ? '/' + a.phase : ''}) ${name} in ${it.name} [${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}]`); }
    }
    const cam = G.R.camera.position, hd = wp(a, 'Head'); const dc = segPoint(ah, hd, cam); if (dc < 0.22) out.camera.push(`${a.id}(${a.state}) ${dc.toFixed(2)}`);
  }
  return out;
}
// The arm poses on every body: how close a hand or forearm comes to the head and the trunk (centimetres of clearance;
// negative is inside), with the pose fully on over an idle stance (and over the crouch for the head cover).
export async function poses(G, ids = null) {
  const { ARM_POSES } = await import('/src/civ-anim.js'), people = (ids || civ.people.map(p => p.id)), out = {};
  for (const name of Object.keys(ARM_POSES)) out[name] = { head: 99, trunk: 99, hands: 99, worst: '' };
  for (const id of people) {
    await stage(G, [id], { x: 0, z: -40, yaw: 0, near: false, lod: 0 }); const s = staged[0], c = { inst: s.inst, person: s.p };
    for (const name of Object.keys(ARM_POSES)) {
      for (const k in s.anim.pose) s.anim.pose[k].L = s.anim.pose[k].R = 0;
      s.anim.pose[name].L = s.anim.pose[name].R = 1; s.anim.play(name === 'cover' ? 'crouch' : LOCO, { fade: 0 }); s.anim.duck = name === 'cover' ? 0.7 : 0; tick(1 / 60, 30); s.inst.root.updateMatrixWorld(true);
      const head = wp(c, 'Head').add(new THREE.Vector3(0, 0.09, 0.01).applyQuaternion(s.inst.bones[s.p.bone.Head].getWorldQuaternion(new THREE.Quaternion()))), hips = wp(c, 'Hips'), chest = wp(c, 'Spine2'), neck = wp(c, 'Neck');
      const R = out[name];
      for (const side of ['Left', 'Right']) {
        const hand = wp(c, side + 'Hand'), tip = wp(c, side + 'HandMiddle1'), el = wp(c, side + 'ForeArm'), sh = wp(c, side + 'Arm');
        const dh = Math.min(segPoint(el, tip, head), segPoint(sh, el, head)) - 0.105;                 // against the skull (a 10.5 cm ball)
        const dt = Math.min(segPoint(hips, chest, hand), segPoint(chest, neck, hand), segPoint(hips, chest, tip), segPoint(hips, chest, el) - 0.02) - 0.125;       // against the trunk (a 12.5 cm capsule)
        if (dh < R.head) { R.head = dh; if (dh < 0) R.worst = id; } if (dt < R.trunk) { R.trunk = dt; if (dt < 0 && dh >= 0) R.worst = id; }
      }
      R.hands = Math.min(R.hands, wp(c, 'LeftHand').distanceTo(wp(c, 'RightHand')) - 0.07);
    }
  }
  clear(G);
  for (const k in out) for (const f of ['head', 'trunk', 'hands']) out[k][f] = +(out[k][f] * 100).toFixed(1);
  return out;
}
// The live game watched for `secs` (quiet, or after a fright), counting overlap events by kind and keeping examples.
export function audit(G, secs = 30, each = 6, near = true) {
  G.civs.forceNear = near;                                                    // everyone posed as if close by (held feet, ground under them): what would be seen
  const total = { people: 0, solids: 0, props: 0, soldiers: 0, camera: 0 }, ex = { people: new Set(), solids: new Set(), props: new Set(), soldiers: new Set(), camera: new Set(), seats: new Set() }; let n = 0;
  const r = G.R.render; G.R.render = () => {}; G.manual = true;
  try { for (let i = 0; i < secs * 60; i += each) { G.step(each, 1 / 60); const o = overlaps(G); n++; for (const k in o) { if (k !== 'seats') total[k] += o[k].length; for (const s of o[k]) if (ex[k].size < 6) ex[k].add(s.replace(/ -?\d\.\d\d$/, '')); } } } finally { G.R.render = r; G.civs.forceNear = false; }
  return { samples: n, perSample: Object.fromEntries(Object.entries(total).map(([k, v]) => [k, +(v / n).toFixed(2)])), examples: Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, [...v]])) };      // (examples.seats: hip joint in the chair's frame, for the sitters seen)
}

export async function stage(G, ids, { x = 0, z = -40, yaw = 0, clip = LOCO, spacing = 0.9, near = true, lod = -1 } = {}) {
  clear(G);
  const people = ids.map(id => civ.people.find(p => p.id === id)).filter(Boolean);
  for (let i = 0; i < people.length; i++) {
    const p = people[i], inst = p.build(), anim = new Animator(p, inst);
    if (near) { const mats = await p.loadNear(G.R); inst.near.forEach((m, k) => { m.material = mats[k]; }); }
    const s = { p, inst, anim, env: { x: x + (i - (people.length - 1) / 2) * spacing, y: 0, z, yaw, ground: null, moving: false }, speed: 0, face: new Face(inst, anim, Math.random, 1) };
    inst.root.position.set(s.env.x, 0, s.env.z); inst.root.rotation.y = yaw;
    setLod(s, lod >= 0 ? lod : near ? -1 : 0);
    G.R.scene.add(inst.root); if (clip !== LOCO) anim.play(clip, { fade: 0 });
    staged.push(s);
  }
  tick(0.001);
  return staged.length;
}
export function setLod(s, lod) { s.inst.near.forEach(m => { m.visible = lod < 0; }); s.inst.far.forEach((m, i) => { m.visible = i === lod; }); }
export function clear(G) { for (const s of staged) G.R.scene.remove(s.inst.root); staged.length = 0; }
export function tick(dt = 1 / 60, n = 1) {
  for (let k = 0; k < n; k++) for (const s of staged) {
    s.env.x += Math.sin(s.env.yaw) * s.speed * dt; s.env.z += Math.cos(s.env.yaw) * s.speed * dt; s.env.moving = s.speed > 0.1;
    s.inst.root.position.set(s.env.x, s.env.y, s.env.z); s.inst.root.rotation.y = s.env.yaw;
    s.anim.setGait(s.speed, dt); s.anim.update(dt); s.anim.apply(s.env, dt, s.detail || 0);
    if (s.face) s.face.update(dt, s.gaze || {});
  }
}
export function settle(G, frames = 24) { const R = G.R; R.meter.sync = true; for (let i = 0; i < frames; i++) R.render(1 / 30, 10 + i / 30); R.meter.sync = false; }
// Camera `dist` metres in front of person i (or of the group's middle), at `height`, looking at `at` (a height on the body).
export async function shot(G, name, { i = -1, dist = 2.4, height = 1.3, at = null, side = 0, fov = 40, w = 1280, h = 720, exposure = 0 } = {}) {
  G.manual = true; G.frozen = true;
  const s = i >= 0 ? staged[i] : null, cx = s ? s.env.x : staged.reduce((a, b) => a + b.env.x, 0) / staged.length, cz = staged[0].env.z, yaw = staged[0].env.yaw + side;
  const cam = G.R.camera; cam.fov = fov; cam.updateProjectionMatrix();
  cam.position.set(cx + Math.sin(yaw) * dist, height, cz + Math.cos(yaw) * dist); cam.lookAt(cx, at ?? height, cz);
  const canvas = G.R.renderer.domElement; canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; G.R.renderScale = 1; G.R.adaptive = false; G.R.resize();
  if (exposure) { G.R.autoExposure = false; G.R.exposureTarget = exposure; }
  settle(G);
  return G.capture(name, w, h);
}
export function info() {
  return civ.people.map(p => ({ id: p.id, height: p.height, groups: p.groups.map(g => `${g.kind}:${g.tris}`).join(' '), far: p.lods.map(g => g.index.count / 3).join('/') }));
}

// Every expression on person i's face, one capture each (civ_face_<id>_<name>.jpg), from a neutral start so the blend-in is exercised.
export async function faces(G, i = 0, names = ['neutral', ...Object.keys(EXPRESSIONS)], opts = {}) {
  const s = staged[i], out = [];
  for (const name of names) {
    for (const k of Object.keys(s.face.mood)) s.face.mood[k] = 0;
    if (name !== 'neutral') s.face.mood[name] = 1;
    s.face.blinkT = 9; tick(1 / 60, 45);
    out.push(await shot(G, `civ_face_${s.p.id}_${name}`, { i, dist: 0.62, height: s.p.eye[1] + 0.01, at: s.p.eye[1] - 0.03, fov: 30, w: 640, h: 480, side: 0.35, ...opts }));
  }
  return out;
}

// ---- the live simulation ---------------------------------------------------------------------------------------------------
// No soldiers: the district on a quiet morning (they stay unspawned until the match is reset).
export function peace(G) { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } }
// Run the game for `secs` without drawing it (fast), in slices so a watchdog never sees a stall.
export function run(G, secs, dt = 1 / 60) { const r = G.R.render; G.R.render = () => {}; G.manual = true; try { G.step(Math.round(secs / dt), dt); } finally { G.R.render = r; } }
export function states(G) { return G.civs.list.map(c => `${c.id}:${c.state}${c.phase ? '/' + c.phase : ''} ${c.anim.clip}${c.anim.over ? '+' + c.anim.over.id : ''} f${c.fear.toFixed(2)} s${c.stress.toFixed(2)} v${c.speed.toFixed(1)} @${c.pos.x.toFixed(0)},${c.pos.z.toFixed(0)}`); }
// The camera `dist` metres from a living civilian (by id or index), looking at them; the game's own draw (their tier follows the camera).
export async function watch(G, who, name, { dist = 3, height = 1.4, at = 1.1, side = 0.4, fov = 45, w = 960, h = 540, steps = 2, armed = false } = {}) {
  const c = typeof who === 'number' ? G.civs.list[who] : G.civs.list.find(x => x.id === who), cam = G.R.camera; G.manual = true; G.frozen = true;
  const yaw = c.yaw + side; cam.fov = fov; cam.updateProjectionMatrix();
  cam.position.set(c.pos.x + Math.sin(yaw) * dist, c.pos.y + height, c.pos.z + Math.cos(yaw) * dist); cam.lookAt(c.pos.x, c.pos.y + at, c.pos.z); cam.updateMatrixWorld(true);
  const P = G.player; P.pos.set(cam.position.x, 0, cam.position.z);                // (the player stands where the camera is, so distances and looks are right)
  const hold = P.update, alive = P.alive; P.update = () => {}; P.alive = true; G.civs.unarmed = !armed;      // (unarmed: a camera, not a rifle pointed at them)
  G.weapon.root.visible = armed; const cv = G.R.renderer.domElement; cv.style.width = w + 'px'; cv.style.height = h + 'px'; G.R.renderScale = 1; G.R.adaptive = false; G.R.resize();
  for (let i = 0; i < steps; i++) G.step(8, 1 / 60);
  settle(G, 10); const r = await G.capture(name, w, h); P.update = hold; P.alive = alive; G.civs.unarmed = false;
  return r;
}

// ---- staged trouble ------------------------------------------------------------------------------------------------------------
// Stand the player `dist` metres from a civilian, facing them (yawOff turns the aim away), without moving a frame.
export function face(G, who, dist = 6, yawOff = 0, side = 0) {
  const c = typeof who === 'number' ? G.civs.list[who] : G.civs.list.find(x => x.id === who), P = G.player, a = c.yaw + side;
  let x = 0, z = 0;
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.2, -2.2, 3.1]) {             // the first side from which they can be seen and stood on
    x = c.pos.x + Math.sin(a + off) * dist; z = c.pos.z + Math.cos(a + off) * dist;
    if (G.world.nav.free(x, z) && G.los(new THREE.Vector3(x, c.pos.y + 1.6, z), new THREE.Vector3(c.pos.x, c.pos.y + 1.2, c.pos.z))) break;
  }
  const yaw = Math.atan2(c.pos.x - x, c.pos.z - z) + yawOff;
  P.alive = true; P.pos.set(x, c.pos.y, z); P.vel.set(0, 0, 0); P.yaw = yaw; P.pitch = Math.atan2(c.pos.y + 1.2 - (c.pos.y + 1.62), dist); P.sim = { f: 0, s: 0, yaw, pitch: P.pitch }; P.camY = c.pos.y + 1.62;
  G.step(1, 1 / 60);
  return c;
}
// ---- film -----------------------------------------------------------------------------------------------------------------------
// Frames of the running game (captures/<name>_NNN.jpg, 15 a second of game time), the camera placed each frame by
// cam(t) -> { eye: [x, y, z], at: [x, y, z], fov }, with script(t) called every step for staging. Join them with
//   ffmpeg -framerate 15 -i captures/<name>_%03d.jpg -pix_fmt yuv420p captures/<name>.mp4
export async function film(G, name, secs, cam, script = () => {}, { w = 960, h = 540, armed = false } = {}) {
  G.manual = true; G.frozen = true; const P = G.player, hold = P.update, alive = P.alive, C = G.R.camera, cv = G.R.renderer.domElement, jobs = [];
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; G.R.renderScale = 1; G.R.adaptive = false; G.R.resize();
  P.update = () => {}; P.alive = true; G.civs.unarmed = !armed; G.weapon.root.visible = false;
  const place = t => { const c = cam(t); C.fov = c.fov || 40; C.updateProjectionMatrix(); C.position.set(...c.eye); C.lookAt(...c.at); C.updateMatrixWorld(true); P.pos.set(c.eye[0], 0, c.eye[2]); };
  place(0); settle(G, 12);
  const n = Math.round(secs * 15);
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 4; k++) { const t = f / 15 + k / 60; script(t); place(t); const r = G.R.render; G.R.render = () => {}; G.step(1, 1 / 60); G.R.render = r; }
    place((f + 1) / 15); G.R.render(1 / 15, 20 + f / 15);
    const url = cv.toDataURL('image/jpeg', 0.86);
    jobs.push(fetch(url).then(r => r.blob()).then(b => fetch(`/__capture/${name}_${String(f).padStart(3, '0')}.jpg`, { method: 'POST', body: b })));
  }
  await Promise.all(jobs); P.update = hold; P.alive = alive; G.civs.unarmed = false;
  return `${n} frames ${cv.width}x${cv.height}`;
}
// How far a foot travels over the ground while it is on it: a civilian is walked `secs` along their route at `speed`
// and the ball of each foot is followed whenever it is at its lowest (within 2.5 cm). Returns centimetres slid per stance
// (median and worst) for the near pose (feet held) and the far one (clips alone), plus jolts: the largest one-frame
// change in a knee's bend, in degrees.
export function gait(G, who, speed = 1.4, secs = 6) {
  const c = typeof who === 'number' ? G.civs.list[who] : G.civs.list.find(x => x.id === who), out = {}, L = c.person.bone, v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const P = G.civs.places, pts = P.stroll.filter(p => Math.hypot(p.x - c.pos.x, p.z - c.pos.z) > 20 && P.nav.walkableWide(c.pos.x, c.pos.z, p.x, p.z)), far = pts[0] || P.stroll[0];
  for (const [label, tier] of [['held', 0], ['clips', 2]]) {
    c.spawn(c.pos.x, c.pos.z, Math.atan2(far.x - c.pos.x, far.z - c.pos.z)); c.setState('walk'); c.go(far.x, far.z, speed, 'idle'); c.timer = 99;
    const feet = ['LeftFoot', 'RightFoot'].map(n => ({ bone: c.inst.bones[L[n.replace('Foot', 'ToeBase')]], ankle: c.inst.bones[L[n]], knee: c.inst.bones[L[n.replace('Foot', 'Leg')]], hip: c.inst.bones[L[n.replace('Foot', 'UpLeg')]], ys: [], ps: [], bends: [] }));
    const r = G.R.render; G.R.render = () => {}; G.manual = true;
    const cam = G.R.camera; let speedSum = 0, frames = 0;
    for (let i = 0; i < secs * 60; i++) {
      cam.position.set(c.pos.x + (tier === 0 ? 3 : 40), 1.6, c.pos.z); cam.lookAt(c.pos.x, 1, c.pos.z); cam.updateMatrixWorld(true);
      G.step(1, 1 / 60); c.root.updateMatrixWorld(true);
      if (i < 90) continue;                                                     // (up to pace first)
      speedSum += c.speed; frames++;
      for (const f of feet) { f.bone.getWorldPosition(v); f.ys.push(v.y - c.pos.y); f.ps.push([v.x, v.z]); f.ankle.getWorldPosition(v); f.knee.getWorldPosition(a); f.hip.getWorldPosition(b); f.bends.push(a.clone().sub(b).angleTo(v.clone().sub(a)) * 57.3); }
    }
    G.R.render = r;
    const slides = []; let jolt = 0;
    for (const f of feet) {
      const lo = Math.min(...f.ys); let run = null;
      for (let i = 0; i < f.ys.length; i++) {
        if (f.ys[i] < lo + 0.025) { if (!run) run = { d: 0, n: 0 }; else run.d += Math.hypot(f.ps[i][0] - f.ps[i - 1][0], f.ps[i][1] - f.ps[i - 1][1]); run.n++; }
        else if (run) { if (run.n > 6) slides.push(run.d * 100); run = null; }
        if (i > 1) jolt = Math.max(jolt, Math.abs(f.bends[i] - 2 * f.bends[i - 1] + f.bends[i - 2]));
      }
    }
    slides.sort((x, y) => x - y);
    out[label] = { tier: c.tier, pace: +(speedSum / Math.max(1, frames)).toFixed(2), stances: slides.length, medianCm: +(slides[slides.length >> 1] ?? 0).toFixed(1), worstCm: +(slides[slides.length - 1] ?? 0).toFixed(1), kneeJoltDeg: +jolt.toFixed(1) };
  }
  return out;
}
// The middle of a civilian's head in the world, for cameras that hold a face.
export function head(c) { const v = new THREE.Vector3(); c.inst.bones[c.person.bone.Head].getWorldPosition(v); return [v.x, v.y + 0.06, v.z]; }
// The player's rifle fires n rounds (the game's own fire path: rays, damage, the events the civilians hear).
export function fire(G, n = 1, gap = 5) { for (let i = 0; i < n; i++) { G.player.fire(0.002, 0, 0); G.step(gap, 1 / 60); } }
// The view as it is (the player's own eyes), saved.
export async function view(G, name, { w = 960, h = 540, fov = 60 } = {}) {
  G.manual = true; const cam = G.R.camera; cam.fov = fov; cam.updateProjectionMatrix();
  const cv = G.R.renderer.domElement; cv.style.width = w + 'px'; cv.style.height = h + 'px'; G.R.renderScale = 1; G.R.adaptive = false; G.R.resize();
  G.step(1, 1 / 60); settle(G, 8); return G.capture(name, w, h);
}
export function near(G, x, z, r = 25) { return G.civs.list.filter(c => c.alive && Math.hypot(c.pos.x - x, c.pos.z - z) < r).map(c => `${c.id}:${c.state}${c.phase ? '/' + c.phase : ''} f${c.fear.toFixed(2)} d${Math.hypot(c.pos.x - x, c.pos.z - z).toFixed(0)}`); }

// ---- the fallen, measured ---------------------------------------------------------------------------------------------------------
// How a body's joints lie, in degrees, against what a body can do (RAG_JOINTS, rigid.js). Shoulders, hips, waist and neck:
// [about its left, about its length, about its front]; elbows and knees: [how far folded, how far off the fold's own plane].
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), DEG = 57.2958;
const frameOf = (c, k, out) => { const r = c.ragRef[k]; return r.bone.getWorldQuaternion(out).multiply(_qc.copy(r.q).invert()); };
export function joints(c) {
  c.root.updateMatrixWorld(true); const out = {};
  for (const [name, [pa, ch, lim]] of Object.entries(RAG_JOINTS)) {
    const r = frameOf(c, pa, _qa).invert().multiply(frameOf(c, ch, _qb)), s = r.w < 0 ? -1 : 1, x = r.x * s, y = r.y * s, z = r.z * s, w = r.w * s;
    out[name] = Array.isArray(lim) ? [x, y, z].map(v => 2 * Math.asin(Math.max(-1, Math.min(1, v))) * DEG) : [2 * Math.atan2(x, w) * lim * DEG, 2 * Math.asin(Math.min(1, Math.hypot(y, z))) * DEG];
  }
  return out;
}
// How far past what a body can do (degrees, 0 = within): `at0` is the same body's joints when it died (an elbow or a knee is
// judged by how far it has left the plane it folds in since then).
export function strain(j, at0) {
  const out = {};
  for (const [name, [, , lim, max]] of Object.entries(RAG_JOINTS)) {
    const v = j[name]; let worst = 0;
    if (Array.isArray(lim)) for (let i = 0; i < 3; i++) worst = Math.max(worst, lim[i * 2] * DEG - v[i], v[i] - lim[i * 2 + 1] * DEG);
    else { const f = v[0] > 180 ? v[0] - 360 : v[0] < -180 ? v[0] + 360 : v[0]; worst = Math.max(-f, f - max * DEG, Math.abs(v[1] - (at0 ? at0[name][1] : v[1]))); }
    if (worst > 0.5) out[name] = Math.round(worst);
  }
  return out;
}
// `n` people shot dead where they are (in the chest, the head, a leg, from the front, the back and the sides), and their
// fall followed for `secs`: per body, the joints forced furthest past what a body can do during the fall and as it lies
// (degrees), what is left standing up off the ground at the end (metres: hands, feet, elbows, knees, head), and whether
// it is still moving. The camera is taken to each so that each is thrown down by physics.
export function ragAudit(G, n = 12, secs = 5, pick = c => c.alive) {
  const C = G.civs, cam = G.R.camera, r = G.R.render, rows = [], P = G.player, hold = P.update; G.R.render = () => {}; G.manual = true; P.update = () => {}; C.unarmed = true;
  const ZONES = ['body', 'head', 'body', 'limb'], who = C.list.filter(pick).slice(0, n);
  try {
    who.forEach((c, i) => {
      const rel = [0, 3.14, 1.57, -1.57, 0.6, -2.4][i % 6], f = c.yaw + rel, row = { id: c.id, was: c.state + (c.speed > 1.8 ? '/run' : ''), zone: ZONES[i % 4], from: rel, c, worst: {}, at0: null };
      cam.position.set(c.pos.x + 4, c.pos.y + 1.6, c.pos.z); cam.updateMatrixWorld(true); P.pos.set(cam.position.x, 0, cam.position.z);
      c.root.visible = true; row.at0 = joints(c);
      c.damage(500, { x: c.pos.x + Math.sin(f) * 8, y: c.pos.y + 1.4, z: c.pos.z + Math.cos(f) * 8 }, null, row.zone);
      G.step(1, 1 / 60); row.rag = !!c.rag; rows.push(row);
    });
    for (let t = 0; t < secs; t += 0.1) {
      G.step(6, 1 / 60);
      for (const row of rows) if (row.c.rag) { const s = strain(joints(row.c), row.at0); for (const k in s) row.worst[k] = Math.max(row.worst[k] || 0, s[k]); }
    }
  } finally { G.R.render = r; P.update = hold; C.unarmed = false; }
  const up = (c, name) => { const p = wp(c, name); return +(p.y - C.places.ground(p.x, p.z, p.y + 0.3)).toFixed(2); };
  let fall = 0, lie = 0, bodies = 0;
  const out = rows.map(row => {
    const c = row.c, lies = row.rag || c.rag ? strain(joints(c), row.at0) : {};
    for (const k in row.worst) fall += row.worst[k] > 8 ? 1 : 0; for (const k in lies) lie += lies[k] > 8 ? 1 : 0; bodies++;
    return { id: row.id, was: row.was, zone: row.zone, rag: row.rag, fall: row.worst, lies, up: { hands: [up(c, 'LeftHand'), up(c, 'RightHand')], feet: [up(c, 'LeftFoot'), up(c, 'RightFoot')], elbows: [up(c, 'LeftForeArm'), up(c, 'RightForeArm')], knees: [up(c, 'LeftLeg'), up(c, 'RightLeg')], head: up(c, 'Head'), hips: up(c, 'Hips') }, moving: c.rag ? +c.rag.speed().toFixed(2) : 0 };
  });
  return { bodies, jointsForcedInFall: fall, jointsForcedAtRest: lie, rows: out };
}

// One person shot dead on film (captures/<name>_NNN.jpg, 15 a second): `pick` is a civilian or a test for one, `rel` where
// the round comes from relative to the way they face (0 = from the front). The camera stands where it can see them and the
// ground they will fall on, and follows the body.
export async function deathFilm(G, name, pick, zone = 'body', rel = 0, secs = 3.2, dist = 4, dmg = 500) {
  const c = typeof pick === 'function' ? G.civs.list.find(pick) : pick; if (!c) return 'nobody';
  const x0 = c.pos.x, z0 = c.pos.z, y0 = c.pos.y, e = V(), ce = V(); let a = null;
  for (const off of [0.9, -0.9, 0.3, -0.3, 1.6, -1.6, 2.4, -2.4, 3.1]) {
    e.set(x0 + Math.sin(c.yaw + off) * dist, y0 + 1.7, z0 + Math.cos(c.yaw + off) * dist);
    if (G.world.nav.free(e.x, e.z) && G.los(e, V(x0, y0 + 1.2, z0)) && G.los(e, V(x0, y0 + 0.2, z0)) && G.los(e, V(x0 - Math.sin(c.yaw) * 1.2, y0 + 0.2, z0 - Math.cos(c.yaw) * 1.2))) { a = c.yaw + off; break; }
  }
  if (a == null) return 'no view of ' + c.id;
  let done = false; const was = c.state;
  const r = await film(G, name, secs, () => { const at = c.rag ? c.rag.centre(ce) : ce.set(c.pos.x, 0, c.pos.z); return { eye: [x0 + Math.sin(a) * dist, y0 + 1.7, z0 + Math.cos(a) * dist], at: [at.x, y0 + 0.6, at.z], fov: 42 }; },
    t => { if (!done && t > 0.4) { done = true; const f = c.yaw + rel; c.damage(dmg, { x: c.pos.x + Math.sin(f) * 8, y: c.pos.y + 1.4, z: c.pos.z + Math.cos(f) * 8 }, null, zone); } });
  return `${c.id} ${was} ${zone} ${r} strain ${JSON.stringify(c.rag ? strain(joints(c)) : {})}`;
}
// The same without a camera: the fall as numbers, ten times a second (hips and head above the ground, knees, hips, waist).
export function fallTrace(G, pick, zone = 'body', rel = 0, secs = 5) {
  const r = G.R.render, cam = G.R.camera, pl = G.player, hold = pl.update, v = V(); G.R.render = () => {}; pl.update = () => {}; G.civs.unarmed = true;
  try {
    const c = typeof pick === 'function' ? G.civs.list.find(pick) : pick; if (!c) return 'nobody';
    cam.position.set(c.pos.x + 4, c.pos.y + 1.6, c.pos.z); cam.updateMatrixWorld(true); pl.pos.set(cam.position.x, 0, cam.position.z); G.step(2, 1 / 60);
    const f = c.yaw + rel, y0 = c.pos.y, was = c.state, tr = []; let down = null;
    c.damage(500, { x: c.pos.x + Math.sin(f) * 8, y: c.pos.y + 1.4, z: c.pos.z + Math.cos(f) * 8 }, null, zone);
    for (let i = 0; i < secs * 10; i++) {
      G.step(6, 1 / 60); const j = joints(c), hy = c.b.hips.getWorldPosition(v).y - y0, hd = c.b.head.getWorldPosition(v).y - y0, R = Math.round;
      if (down == null && hd < 0.45) down = (i + 1) / 10;
      if ((i < 16 && i % 2 === 1) || i === 29 || i === secs * 10 - 1) tr.push(`${((i + 1) / 10).toFixed(1)} hips ${hy.toFixed(2)} head ${hd.toFixed(2)} knees ${R(j.kneeL[0])},${R(j.kneeR[0])} hips ${R(j.legL[0])},${R(j.legR[0])} waist ${j.spine.map(R)} elbows ${R(j.elbowL[0])},${R(j.elbowR[0])}`);
    }
    return `${c.id} ${was} ${zone} from ${rel}: head down at ${down} s\n${tr.join('\n')}\nstrain at rest ${JSON.stringify(strain(joints(c)))}`;
  } finally { G.R.render = r; pl.update = hold; G.civs.unarmed = false; }
}

// One person shot in a named bone on film ('LeftForeArm', 'RightUpLeg', 'Spine2', 'Hips'...), not fatally unless `dmg` says
// so: the round is fired from the camera's side at where that bone is, through the game's own hit path (the stain, the
// wound, the reaction). The camera stays in front of them and follows. Returns what the game made of it.
export async function woundFilm(G, name, pick, bone, secs = 5, dmg = 30, { dist = 3.4, side = 0.5, zone = null, from = 0 } = {}) {
  const c = typeof pick === 'function' ? G.civs.list.find(pick) : pick; if (!c) return 'nobody';
  let done = false, made = ''; const eye = V(), at = V();
  const r = await film(G, name, secs, () => { const a = c.yaw + side; eye.set(c.pos.x + Math.sin(a) * dist, c.pos.y + 1.45, c.pos.z + Math.cos(a) * dist); at.set(c.pos.x, c.pos.y + 0.95, c.pos.z); return { eye: eye.toArray(), at: at.toArray(), fov: 40 }; },
    t => {
      if (done || t < 0.4) return; done = true;
      const p = wp(c, bone), f = c.yaw + from, o = V(c.pos.x + Math.sin(f) * 8, c.pos.y + 1.4, c.pos.z + Math.cos(f) * 8), d = p.clone().sub(o).normalize();
      const z = zone || (/Arm|Leg|Hand|Foot/.test(bone) ? 'limb' : bone === 'Head' ? 'head' : 'body');
      const h = c.stain(o, d, z); c.damage(dmg, o, null, z); G.blood?.hit(c, p, d, z, 1);
      made = `struck ${h ? h.part + ' ' + (h.side || '-') + (h.low ? ' low' : '') : 'nothing'} -> wound ${c.wound ? JSON.stringify({ part: c.wound.part, side: c.wound.side, hand: c.wound.hand, low: c.wound.low }) : c.alive ? 'none' : 'dead'} clip ${c.anim.clip}${c.anim.main?.mirror ? ' (mirrored)' : ''} state ${c.state}`;
    });
  return `${c.id} ${bone}: ${made}; then ${c.state} ${r}`;
}

// A close look at one bone of a living or fallen civilian (a hand on a wound, a stain): the camera `dist` from it, round
// to the body's left by `side` radians from straight ahead, `up` above it. The game's own draw at the nearest tier.
export async function closeUp(G, name, who, bone, { dist = 0.9, side = 0.5, up = 0.2, fov = 30, w = 960, h = 540 } = {}) {
  const c = typeof who === 'string' ? G.civs.list.find(x => x.id === who) : who, P = G.player, hold = P.update, alive = P.alive, cam = G.R.camera, cv = G.R.renderer.domElement;
  P.update = () => {}; P.alive = true; G.civs.unarmed = true; G.weapon.root.visible = false; G.manual = true; G.frozen = true;
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; G.R.renderScale = 1; G.R.adaptive = false; G.R.resize();
  const place = () => { const p = wp(c, bone), a = c.yaw + side; cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(p.x + Math.sin(a) * dist, p.y + up, p.z + Math.cos(a) * dist); cam.lookAt(p.x, p.y, p.z); cam.updateMatrixWorld(true); P.pos.set(cam.position.x, 0, cam.position.z); };
  place(); const r = G.R.render; G.R.render = () => {};
  try { G.step(4, 1 / 60); if (c.person.nearLoading) await c.person.nearLoading; G.step(6, 1 / 60); } finally { G.R.render = r; }      // (their close-up materials are fetched when they first come close)
  place(); settle(G, 10); const out = await G.capture(name, w, h); P.update = hold; P.alive = alive; G.civs.unarmed = false;
  return out;
}
// Shoot a civilian in a named bone without filming it (as woundFilm does), and let `secs` pass; `hold` then stands them
// still where they are, so that what the wound does to a quiet body can be looked at.
export function wound(G, who, bone, { dmg = 25, secs = 2.6, from = 0, zone = null, hold = true } = {}) {
  const c = typeof who === 'string' ? G.civs.list.find(x => x.id === who) : who, r = G.R.render, P = G.player, upd = P.update; G.R.render = () => {}; P.update = () => {}; G.civs.unarmed = true; G.civs.forceNear = true;
  try {
    G.R.camera.position.set(c.pos.x + 3, c.pos.y + 1.5, c.pos.z); G.R.camera.updateMatrixWorld(true); P.pos.set(c.pos.x + 3, 0, c.pos.z); G.step(2, 1 / 60);
    const p = wp(c, bone), f = c.yaw + from, o = V(c.pos.x + Math.sin(f) * 8, c.pos.y + 1.4, c.pos.z + Math.cos(f) * 8), d = p.clone().sub(o).normalize(), z = zone || (/Arm|Leg|Hand|Foot/.test(bone) ? 'limb' : bone === 'Head' ? 'head' : 'body');
    const h = c.stain(o, d, z); c.damage(dmg, o, null, z); G.step(Math.round(secs * 60), 1 / 60);
    if (hold && c.alive) { c.stop(); c.anim.play(LOCO, { fade: 0.3 }); c.setState('stand', 60); c.fear = 0.2; c.crouching = false; G.step(90, 1 / 60); }
    return `${c.id} ${bone}: struck ${h ? h.part + ' ' + (h.side || '-') : 'nothing'}, wound ${c.wound ? c.wound.part + ' ' + c.wound.side + ' hand ' + c.wound.hand : '-'}, ${c.state}, reach L${c.anim.reach.L.w.toFixed(2)} R${c.anim.reach.R.w.toFixed(2)}`;
  } finally { G.R.render = r; P.update = upd; G.civs.forceNear = false; }
}
