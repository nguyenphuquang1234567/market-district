// A civilian's body: Ara's clips refitted to this person's skeleton, blended, and finished with the things no clip has.
//
// The clip library (civ-assets.js) holds each bone's turn in the world away from the rest pose, which is how Ara itself
// fits one clip to many bodies. So a pose is made in the model's own space: blend those turns across the playing clips,
// put each on this person's rest attitude, walk the skeleton for joint positions, then
//   - extra turns handed down the chain: breathing, a lean into a turn or away from a blast, the look (spine, neck, head,
//     eyes), a flinch;
//   - arm poses Ara has no clip for (hands raised, hands over the head, a guard against a blast), authored as attitudes
//     of the arm bones and blended in;
//   - legs: a planted foot stays where it was planted (and turned as it was planted) while the body moves over it, feet
//     follow the ground under them, and the pelvis comes down when a leg cannot reach.
// Only then are the bones written, as rotations relative to their parents.
import * as THREE from 'three';
import { civ } from './civ-assets.js';
import { clamp, damp, lerp, smooth, angDiff } from './util.js';

const Q = () => new THREE.Quaternion(), V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const q1 = Q(), q2 = Q(), q3 = Q(), v1 = V(), v2 = V(), v3 = V(), v4 = V(), v5 = V();
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
const LOCO = 'loco';
const UPPER = /^(Spine1|Spine2|Neck|Head|Jaw|LeftEye|RightEye|(Left|Right)(Shoulder|Arm|ForeArm|Hand))/;
const ARMS = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)/;
const FINGERS = /Hand(Thumb|Index|Middle|Ring|Pinky)/;

// ---- arm poses that Ara's library does not have -----------------------------------------------------------------------------
// Each is a direction for the upper arm, the forearm and the hand (left side; x is the person's left, y up, z forward),
// a roll of the hand about its own length, and how far the fingers curl. In the rest pose the left arm lies along +x
// with the palm down, so a bone's attitude is the shortest turn from +x to the direction given.
const ARM_POSES = {
  // hands raised and open, palms forward, elbows a little out: "don't shoot"
  handsUp: { arm: [0.90, 0.26, 0.34], fore: [0.10, 0.97, 0.22], hand: [0.02, 0.99, 0.14], roll: -1.35, curl: 0.12, shoulder: 0.14 },
  // Elbows close to the ribs and palms up in front, for narrow passages.
  handsTucked: { arm: [0.08, -0.64, 0.76], fore: [-0.12, 0.98, 0.16], hand: [0, 0.99, 0.12], roll: -1.35, curl: 0.12, shoulder: 0.03 },
  // crouched with the hands locked over the back of the head, elbows forward
  cover: { arm: [0.38, 0.52, 0.76], fore: [-0.62, 0.62, -0.48], hand: [-0.80, 0.25, -0.54], roll: -0.3, curl: 0.5, shoulder: 0.3 },
  // forearms thrown up in front of the face
  guard: { arm: [0.30, 0.10, 0.95], fore: [-0.22, 0.92, 0.32], hand: [-0.25, 0.95, 0.18], roll: -0.9, curl: 0.35, shoulder: 0.25 },
  // a hand pressed to a wound in the side (one arm; the brain mirrors it to the side that was hit)
  clutch: { arm: [0.35, -0.80, 0.48], fore: [-0.80, 0.25, 0.54], hand: [-0.92, 0.1, 0.36], roll: 0.7, curl: 0.4, shoulder: 0.1 },
  // palms out at chest height, pleading or calming
  plead: { arm: [0.38, -0.55, 0.74], fore: [0.12, 0.42, 0.90], hand: [0.05, 0.85, 0.52], roll: -1.2, curl: 0.1, shoulder: 0.05 },
  // a bag in the hand: the arm a little out from the hip so the bag clears the thigh, fingers closed on the handles
  carry: { arm: [0.27, -0.96, 0.04], fore: [0.21, -0.97, 0.10], hand: [0.13, -0.99, 0.05], roll: 0, curl: 0.8, shoulder: 0 },
};
// A bag is a bone at the hand that holds it. Left to follow the hand it stands out along the fingers whichever way they
// point (straight out behind a runner's fist, down through a sitter's thighs); here it hangs, and lies across the lap.
const HAND_L = new THREE.Quaternion(1, 0, 0, 0), HAND_R = new THREE.Quaternion(0, 0, 1, 0);      // (undoing the rest pose's hand: along +x or -x, palm down)
const BAG_HANG = new THREE.Quaternion(0, 0, 1, 0), BAG_LAP = new THREE.Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2);
const aim = (dir, roll, mirror, out) => {
  v1.set(dir[0] * mirror, dir[1], dir[2]).normalize();
  out.setFromUnitVectors(v2.set(mirror, 0, 0), v1);
  return roll ? out.premultiply(q3.setFromAxisAngle(v1, roll * mirror)) : out;
};

export class Animator {
  constructor(person, inst) {
    this.person = person; this.bones = inst.bones; const A = civ.anims, nb = person.boneNames.length;
    this.nc = A.bones.length; this.scale = person.hipY / A.hipY;
    this.of = A.bones.map(n => person.bone[n] ?? -1);                              // clip bone -> this person's bone
    this.clipOf = new Int16Array(nb).fill(-1); this.of.forEach((b, c) => { if (b >= 0) this.clipOf[b] = c; });
    this.upper = Float32Array.from(A.bones, n => (UPPER.test(n) ? 1 : 0)); this.armMask = Float32Array.from(A.bones, n => (ARMS.test(n) ? 1 : 0));
    this.fingerClip = A.bones.map((n, c) => (FINGERS.test(n) ? c : -1)).filter(c => c >= 0);
    this.D = new Float32Array(this.nc * 4); this.S = new Float32Array(this.nc * 4); this.hip = V();
    this.W = Array.from({ length: nb }, Q); this.P = Array.from({ length: nb }, V); this.A = Array.from({ length: nb }, Q);
    this.extra = new Array(nb).fill(null); this.extraPool = Array.from({ length: 16 }, Q); this.extraN = 0;
    const b = n => person.bone[n];
    this.ix = { hips: b('Hips'), spine: b('Spine'), spine1: b('Spine1'), spine2: b('Spine2'), neck: b('Neck'), head: b('Head'), jaw: b('Jaw'), eyeL: b('LeftEye'), eyeR: b('RightEye'), phone: b('Phone') ?? -1, bag: b('BagL') ?? -1,
      L: { up: b('LeftUpLeg'), leg: b('LeftLeg'), foot: b('LeftFoot'), toe: b('LeftToeBase'), sh: b('LeftShoulder'), arm: b('LeftArm'), fore: b('LeftForeArm'), hand: b('LeftHand') },
      R: { up: b('RightUpLeg'), leg: b('RightLeg'), foot: b('RightFoot'), toe: b('RightToeBase'), sh: b('RightShoulder'), arm: b('RightArm'), fore: b('RightForeArm'), hand: b('RightHand') } };
    this.fingers = { L: [], R: [] }; this.isFinger = Uint8Array.from(person.boneNames, n => (FINGERS.test(n) ? 1 : 0)); this.hq = Q();
    this.legLen = person.restT[b('LeftLeg')].length() + person.restT[b('LeftFoot')].length();
    person.boneNames.forEach((n, i) => { if (FINGERS.test(n) && this.clipOf[i] >= 0) this.fingers[n.startsWith('Left') ? 'L' : 'R'].push(i); });
    // a clip played the other way round (Ara's shot-in-the-leg is the left leg: mirrored, it is the right): each bone takes
    // its opposite's turn, reflected
    this.mirrorOf = A.bones.map((n, i) => { const m = n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n, k = A.bones.indexOf(m); return k < 0 ? i : k; });
    this.reach = { L: { bone: -1, local: V(), normal: V(0, 0, 1), w: 0, on: 0 }, R: { bone: -1, local: V(), normal: V(0, 0, 1), w: 0, on: 0 } };
    this.rcT = V(); this.rcN = V(); this.rcH = V(); this.rcD = V(); this.rcG = V(); this.rcP = V(); this.rcE = V(); this.rcQ = Q(); this.rcM = new THREE.Matrix4();      // a hand held to a point on the body (a wound)
    this.limp = { side: null, k: 0, now: 0 };                                        // a leg that hurts to stand on
    this.tracks = []; this.over = null;                                              // base tracks (crossfaded) and one upper-body track
    this.gait = 0; this.phase = Math.random(); this.idleT = Math.random() * 3; this.walkId = 'walk'; this.cadence = 0;
    this.pose = {}; for (const k of Object.keys(ARM_POSES)) this.pose[k] = { L: 0, R: 0 };   // arm pose weights, eased by the owner
    this.look = { yaw: 0, pitch: 0, eyeYaw: 0, eyePitch: 0, w: 1 };
    this.lean = { fwd: 0, side: 0 }; this.duck = 0; this.breath = { t: Math.random() * 6, rate: 0.26, depth: 1 }; this.tremble = 0; this.jaw = 0;
    this.hipsY = 0;                                                                  // lowers (or raises) the pelvis: a seat that is not the clip's height
    this.feet = { L: { lock: false, x: 0, z: 0, yaw: 0, w: 0, step: 0, fx: 0, fz: 0, gy: 0 }, R: { lock: false, x: 0, z: 0, yaw: 0, w: 0, step: 0, fx: 0, fz: 0, gy: 0 } };
    this.bag = { tx: 0, tz: 0, lap: 0, px: 0, pz: 0, has: false }; this.bagLap = 0;      // the bag's swing (radians fore-aft and sideways), and how far it lies on the lap
    this.pelvisDrop = 0; this.phoneOut = 0; this.phoneClip = null; this.faceClip = null; this.faceT = 0; this.detail = 2; this.t = 0;
    this.play(LOCO, { fade: 0 });
  }

  // ---- what is playing ------------------------------------------------------------------------------------------------------
  // Crossfade the body to a clip (or back to walking about: LOCO). Returns the track.
  play(id, { fade = 0.3, speed = 1, loop, time = 0, hold = true, mirror = false } = {}) {
    const clip = id === LOCO ? null : civ.clips.get(id);
    if (id !== LOCO && !clip) { console.warn('civilian clip missing:', id); return null; }
    let tr = this.tracks.find(t => t.id === id && t.mirror === mirror);
    if (tr && id !== LOCO && !(loop ?? clip.loop) && tr.w < 0.99) tr = null;        // a one-shot asked for again starts again
    if (!tr) { tr = { id, clip, t: time, w: fade > 0 && this.tracks.length ? 0 : 1, mirror }; this.tracks.push(tr); }
    tr.loop = loop ?? (clip ? clip.loop : true); tr.speed = speed; tr.hold = hold; tr.done = false;
    for (const t of this.tracks) { t.target = t === tr ? 1 : 0; t.rate = fade > 0 ? 1 / fade : 1e3; }
    this.main = tr;
    return tr;
  }
  get clip() { return this.main?.id; }
  get done() { return !!this.main?.done; }
  // An upper-body clip over whatever the legs are doing (texting on the move, a wave to someone passing). null lets go.
  playUpper(id, { fade = 0.35, speed = 1, loop, mask = 'upper' } = {}) {
    if (!id) { if (this.over) { this.over.target = 0; this.over.rate = 1 / fade; } return; }
    const clip = civ.clips.get(id); if (!clip) return;
    if (this.over && this.over.id === id) { this.over.target = 1; return; }
    this.over = { id, clip, t: 0, w: 0, target: 1, rate: 1 / fade, speed, loop: loop ?? clip.loop, mask: mask === 'arms' ? this.armMask : this.upper, done: false };
  }

  // One clip's pose at time t, added into D with weight w (the first one sets the hemisphere the others are added in).
  // Where every bone sits on its parent at one moment of a clip (bone-local turns): a pose that parts of a body no longer
  // animated can be let go to (a limp hand).
  localsOf(id, t = 0) {
    const P = this.person, D = this.D, par = P.parents, Wm = [], out = [];
    this.sample(civ.clips.get(id), t, 1, true, null);
    for (let b = 0; b < par.length; b++) {
      const p = par[b], c = this.clipOf[b], w = Q();
      if (c >= 0) { const o = c * 4; w.set(D[o], D[o + 1], D[o + 2], D[o + 3]).normalize().multiply(P.restW[b]); } else if (p >= 0) w.copy(Wm[p]).multiply(P.restQ[b]); else w.copy(P.restQ[b]);
      Wm.push(w); out.push(p >= 0 ? Wm[p].clone().invert().multiply(w) : w.clone());
    }
    return out;
  }
  sample(clip, t, w, first, hipOut, mirror = false) {
    const n = clip.keys, f = clamp(t / clip.dur, 0, 1) * (n - 1), i0 = Math.min(n - 2, Math.floor(f)), a = f - i0, nc = this.nc, q = clip.q, o0 = i0 * nc * 4, o1 = o0 + nc * 4, D = this.D, k = w / 32767, M = this.mirrorOf, sg = mirror ? -1 : 1;
    for (let c = 0; c < nc; c++) {
      const s = c * 4, o = (mirror ? M[c] : c) * 4, x = q[o0 + s] + (q[o1 + s] - q[o0 + s]) * a, y = (q[o0 + s + 1] + (q[o1 + s + 1] - q[o0 + s + 1]) * a) * sg, z = (q[o0 + s + 2] + (q[o1 + s + 2] - q[o0 + s + 2]) * a) * sg, ww = q[o0 + s + 3] + (q[o1 + s + 3] - q[o0 + s + 3]) * a;
      if (first) { D[o] = x * k; D[o + 1] = y * k; D[o + 2] = z * k; D[o + 3] = ww * k; }
      else { const s = D[o] * x + D[o + 1] * y + D[o + 2] * z + D[o + 3] * ww < 0 ? -k : k; D[o] += x * s; D[o + 1] += y * s; D[o + 2] += z * s; D[o + 3] += ww * s; }
    }
    if (hipOut) { const h = clip.hips, h0 = i0 * 3, h1 = h0 + 3; hipOut.x += (h[h0] + (h[h1] - h[h0]) * a) * w * sg; hipOut.y += (h[h0 + 1] + (h[h1 + 1] - h[h0 + 1]) * a) * w; hipOut.z += (h[h0 + 2] + (h[h1 + 2] - h[h0 + 2]) * a) * w; }
  }
  down(clip, t, side) { const d = side === 'L' ? clip.downL : clip.downR; return d[Math.min(clip.keys - 1, Math.round(clamp(t / clip.dur, 0, 1) * (clip.keys - 1)))] === 1; }

  // Walking about: standing, walking and running blended by pace, the stride's phase carried across so the same foot
  // leads in both, and played at the rate that puts the ground under a planted foot at the speed the body really moves.
  setGait(speed, dt, style = 'walk') {
    const C = civ.clips, walk = C.get(style) || C.get('walk'), run = C.get('run'), vw = walk.speed * this.scale, vr = run.speed * this.scale;
    this.walkId = walk.id;
    const g = speed < 0.12 ? 0 : speed <= vw * 1.12 ? clamp(speed / (vw * 0.62), 0, 1) : 1 + clamp((speed - vw * 1.12) / (vr * 0.86 - vw * 1.12), 0, 1);
    this.gait = damp(this.gait, g, speed < 0.12 ? 7 : 9, dt);
    const gw = clamp(this.gait, 0, 1), gr = clamp(this.gait - 1, 0, 1);
    const dur = lerp(walk.dur, run.dur, gr), natural = lerp(vw, vr, gr);
    const want = gw > 0.02 ? clamp(speed / natural, 0.55, 1.4) / dur : 0;         // strides per second
    this.cadence = damp(this.cadence, want, 10, dt);
    // a leg that hurts: it is stood on as briefly as can be (its stance hurried, the other's drawn out), the trunk tipping over it
    let rate = 1; const lp = this.limp, on = lp.k > 0 && lp.side && gw > 0.3 && this.down(walk, this.phase * walk.dur, lp.side);
    if (lp.k > 0 && gw > 0.3) rate = on ? 1 + 0.75 * lp.k : 1 - 0.3 * lp.k;
    lp.now = damp(lp.now, on ? lp.k : 0, 10, dt);
    this.phase = (this.phase + this.cadence * dt * rate) % 1; this.idleT += dt;
    this.speed = speed;
  }

  update(dt) {
    this.t += dt;
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      t.w = t.target > t.w ? Math.min(t.target, t.w + t.rate * dt) : Math.max(t.target, t.w - t.rate * dt);
      if (t.clip) {
        t.t += dt * t.speed;
        if (t.loop) t.t %= t.clip.dur; else if (t.t >= t.clip.dur) { t.t = t.clip.dur; t.done = true; }
      }
      if (t.w <= 0 && t.target === 0) this.tracks.splice(i, 1);
    }
    const o = this.over;
    if (o) {
      o.w = o.target > o.w ? Math.min(1, o.w + o.rate * dt) : Math.max(0, o.w - o.rate * dt); o.t += dt * o.speed;
      if (o.loop) o.t %= o.clip.dur; else if (o.t >= o.clip.dur) { o.t = o.clip.dur; o.done = true; o.target = 0; }
      if (o.w <= 0 && o.target === 0) this.over = null;
    }
    this.breath.t += dt * this.breath.rate;
  }

  // ---- the pose ---------------------------------------------------------------------------------------------------------------
  // env: { yaw, x, y, z, ground(x, z) -> height or null, moving, turnRate }. detail: 0 near (everything), 1 (no fingers,
  // feet follow the ground but are not held), 2 far (clips and the look only).
  apply(env, dt, detail = 0) {
    const P = this.person, D = this.D, nc = this.nc, C = civ.clips, hip = this.hip.set(0, 0, 0); this.detail = detail;
    let total = 0, first = true, phone = null, faceClip = null, faceT = 0, faceW = 0, locoW = 0, downL = 1, downR = 1, mainClip = null, mainT = 0, mainW = 0, mainMirror = false;
    for (const t of this.tracks) total += t.w;
    for (const t of this.tracks) {
      const w = t.w / (total || 1); if (w <= 0.001) continue;
      if (t.id === LOCO) {
        const gw = clamp(this.gait, 0, 1), gr = clamp(this.gait - 1, 0, 1), idle = C.get('idle'), walk = C.get(this.walkId), run = C.get('run');
        if (gw < 0.999) { this.sample(idle, this.idleT % idle.dur, w * (1 - gw), first, hip); first = false; }
        if (gw > 0.001 && gr < 0.999) { this.sample(walk, this.phase * walk.dur, w * gw * (1 - gr), first, hip); first = false; }
        if (gr > 0.001) { this.sample(run, this.phase * run.dur, w * gw * gr, first, hip); first = false; }
        locoW = w;
        if (gw > 0.5) { const c = gr > 0.5 ? run : walk, tt = this.phase * c.dur; downL = this.down(c, tt, 'L') ? 1 : 0; downR = this.down(c, tt, 'R') ? 1 : 0; }
      } else {
        this.sample(t.clip, t.t, w, first, hip, t.mirror); first = false;
        if (t.clip.phone && w > 0.5) phone = t.clip.phone;
        if (t.clip.face && w > faceW) { faceW = w; faceClip = t.clip; faceT = t.t; }
        if (w > mainW) { mainW = w; mainClip = t.clip; mainT = t.t; mainMirror = t.mirror; }
      }
    }
    if (mainClip && mainW > 0.6 && locoW < 0.3) { downL = this.down(mainClip, mainT, mainMirror ? 'R' : 'L') ? 1 : 0; downR = this.down(mainClip, mainT, mainMirror ? 'L' : 'R') ? 1 : 0; }
    for (let o = 0; o < nc * 4; o += 4) { const l = 1 / (Math.hypot(D[o], D[o + 1], D[o + 2], D[o + 3]) || 1); D[o] *= l; D[o + 1] *= l; D[o + 2] *= l; D[o + 3] *= l; }
    // the upper-body clip over the top
    const ov = this.over;
    if (ov && ov.w > 0.001) {
      const keep = this.S; keep.set(D); this.sample(ov.clip, ov.t, 1, true, null);
      const w = smooth(ov.w), m = ov.mask;
      for (let c = 0; c < nc; c++) {
        const o = c * 4, k = w * m[c];
        if (k <= 0) { D[o] = keep[o]; D[o + 1] = keep[o + 1]; D[o + 2] = keep[o + 2]; D[o + 3] = keep[o + 3]; continue; }
        q1.set(keep[o], keep[o + 1], keep[o + 2], keep[o + 3]); q2.set(D[o] , D[o + 1], D[o + 2], D[o + 3]).normalize(); q1.slerp(q2, k);
        D[o] = q1.x; D[o + 1] = q1.y; D[o + 2] = q1.z; D[o + 3] = q1.w;
      }
      if (ov.clip.phone && ov.w > 0.5) phone = ov.clip.phone;
      if (ov.clip.face && ov.w > faceW) { faceClip = ov.clip; faceT = ov.t; }
    }
    this.faceClip = faceClip; this.faceT = faceT;
    // arm poses
    for (const name in this.pose) {
      const pw = this.pose[name], def = ARM_POSES[name];
      for (const side of ['L', 'R']) {
        const w = pw[side]; if (w <= 0.002) continue;
        const m = side === 'L' ? 1 : -1, ix = this.ix[side], k = smooth(clamp(w, 0, 1)), tr = this.tremble * 0.02;
        const set = (b, q) => { const c = this.clipOf[b]; if (c < 0) return; const o = c * 4; q1.set(D[o], D[o + 1], D[o + 2], D[o + 3]).slerp(q, k); D[o] = q1.x; D[o + 1] = q1.y; D[o + 2] = q1.z; D[o + 3] = q1.w; };
        set(ix.sh, q2.setFromAxisAngle(Z, def.shoulder * m));
        set(ix.arm, aim(def.arm, 0, m, q2));
        set(ix.fore, aim([def.fore[0] + Math.sin(this.t * 31 + m) * tr, def.fore[1], def.fore[2] + Math.cos(this.t * 27) * tr], 0, m, q2));
        const hq = aim(def.hand, def.roll, m, this.hq);
        set(ix.hand, hq);
        if (detail === 0) for (const f of this.fingers[side]) {                    // fingers: straight along the hand, curled by the pose
          const nm = P.boneNames[f], thumb = nm.includes('Thumb'), seg = +nm.slice(-1);
          v1.set(def.hand[0] * m, def.hand[1], def.hand[2]).normalize(); v2.set(0, -1, 0).applyQuaternion(hq);          // (the palm faces where the rest pose's "down" went)
          v3.crossVectors(v1, v2).normalize();
          q2.setFromAxisAngle(v3, thumb ? 0.25 : def.curl * (0.5 + seg * 0.45)).multiply(hq);      // (about hand x palm: positive closes the fingers on the palm)
          set(f, q2);
        }
      }
    }
    // onto this body: each bone's attitude in model space, then the joints
    const W = this.W, Pp = this.P, A = this.A, par = P.parents, n = par.length, ix = this.ix, ex = this.extra;
    this.buildExtras(env, dt, detail);
    for (let b = 0; b < n; b++) {
      const p = par[b], c = this.clipOf[b], a = A[b];
      if (p < 0) a.identity(); else a.copy(A[p]);
      if (ex[b]) a.multiply(ex[b]);
      if (c >= 0 && !(detail > 0 && this.isFinger[b])) { const o = c * 4; W[b].set(D[o], D[o + 1], D[o + 2], D[o + 3]).multiply(P.restW[b]).premultiply(a); }
      else if (p >= 0) W[b].copy(W[p]).multiply(P.restQ[b]); else W[b].copy(P.restQ[b]);
      if (b === ix.hips) Pp[b].copy(P.restT[b]).addScaledVector(hip, this.scale).setY(P.restT[b].y + hip.y * this.scale + this.hipsY - this.pelvisDrop - this.limp.now * 0.035);
      else if (p >= 0) Pp[b].copy(P.restT[b]).applyQuaternion(W[p]).add(Pp[p]); else Pp[b].copy(P.restT[b]);
    }
    if (detail < 2 || env.plantFeet) this.legs(env, dt, detail, downL, downR, locoW);
    else this.pelvisDrop = damp(this.pelvisDrop, 0, 12, dt);
    // a hand held to a wound: the arm reaches for the place on the body where it is and follows it as the body moves, the
    // palm laid on it (the wrist a palm short of it along the forearm, found in two goes), turned to the body, fingers closed
    if (detail < 2) for (const side of ['L', 'R']) {
      const rc = this.reach[side]; rc.w = damp(rc.w, rc.bone >= 0 ? rc.on : 0, 6, dt); if (rc.w < 0.01 || rc.bone < 0) continue;
      const arm = ix[side], k = smooth(rc.w), at = this.rcT, nrm = this.rcN, h0 = this.rcH, dir = this.rcD, goal = this.rcG, pn = this.rcP, D2 = this.rcQ;
      at.copy(rc.local).applyQuaternion(W[rc.bone]).add(Pp[rc.bone]); nrm.copy(rc.normal).applyQuaternion(W[rc.bone]);      // the wound, and the way out of the body there
      h0.copy(Pp[arm.hand]); q3.copy(W[arm.hand]); dir.copy(at).sub(Pp[arm.arm]).normalize();
      const elbow = this.rcE.set(side === 'L' ? 0.55 : -0.55, -0.75, 0.2);        // (the elbow out and down: left where a running arm had swung it, it would be behind the back, the arm through the chest)
      for (let pass = 0; pass < 2; pass++) {
        goal.copy(at).addScaledVector(dir, -0.08).addScaledVector(nrm, 0.02).lerp(h0, 1 - k);
        this.ik(arm.arm, arm.fore, arm.hand, goal, elbow); dir.copy(Pp[arm.hand]).sub(Pp[arm.fore]).normalize();
      }
      pn.copy(nrm).addScaledVector(dir, -nrm.dot(dir)).negate(); if (pn.lengthSq() < 1e-6) pn.set(0, -1, 0); pn.normalize();
      goal.crossVectors(dir, pn);                                                    // (what the fingers close about)
      D2.setFromRotationMatrix(this.rcM.makeBasis(dir, pn, goal)).multiply(side === 'L' ? HAND_L : HAND_R);      // from the rest pose's hand (along the arm, palm down) to this one
      W[arm.hand].copy(q3).slerp(q2.copy(D2).multiply(P.restW[arm.hand]), k);
      for (const f of this.fingers[side]) { const nm = P.boneNames[f], c = nm.includes('Thumb') ? 0.25 : 0.5 * (0.5 + (+nm.slice(-1)) * 0.45); W[f].slerp(q2.setFromAxisAngle(goal, c).multiply(D2).multiply(P.restW[f]), k); }
    }
    // the phone rides in the hand that holds it (it is its own bone at the root, a thousandth of its size when put away)
    if (ix.phone >= 0) {
      this.phoneOut = damp(this.phoneOut, phone ? 1 : 0, 9, dt);
      const pb = this.bones[ix.phone];
      if (phone && this.phoneOut > 0.02) {
        const h = P.bone[phone.hand]; this.phoneClip = phone;
        pb.position.set(phone.p[0], phone.p[1], phone.p[2]).multiplyScalar(this.scale).applyQuaternion(W[h]).add(Pp[h]);
        pb.quaternion.copy(W[h]).multiply(q1.set(phone.q[0], phone.q[1], phone.q[2], phone.q[3])); pb.scale.setScalar(1000 * this.phoneOut);
      } else { pb.scale.setScalar(1); pb.position.copy(Pp[ix.hips]); }
    }
    // the bag: hanging from the hand under its own weight, trailing the hand's movement a little; across the lap when seated
    if (ix.bag >= 0) {
      const g = this.bag, h = Pp[ix.L.hand], k = Math.max(dt, 1e-3);
      if (!g.has) { g.px = h.x; g.pz = h.z; g.has = true; }
      g.tx = damp(g.tx, clamp((h.z - g.pz) / k * 0.1, -0.5, 0.5), 5, dt); g.tz = damp(g.tz, clamp(-(h.x - g.px) / k * 0.1, -0.3, 0.3), 5, dt); g.px = h.x; g.pz = h.z;
      g.lap = damp(g.lap, this.bagLap, 5, dt);
      q2.setFromAxisAngle(X, g.tx).multiply(q3.setFromAxisAngle(Z, g.tz)).multiply(BAG_HANG);
      W[ix.bag].copy(q2).slerp(BAG_LAP, smooth(g.lap));
    }
    // write the bones
    const B = this.bones;
    for (let b = 0; b < n; b++) {
      if (b === ix.phone) continue;
      const p = par[b];
      if (p < 0) B[b].quaternion.copy(W[b]); else B[b].quaternion.copy(q1.copy(W[p]).invert().multiply(W[b]));
    }
    B[ix.hips].position.copy(Pp[ix.hips]);
  }

  // Turns handed down the chain from the bone they are set on: breathing, leaning, ducking, the look, the jaw, the eyes.
  buildExtras(env, dt, detail) {
    const ex = this.extra, ix = this.ix; this.extraN = 0;
    for (let i = 0; i < ex.length; i++) ex[i] = null;
    const put = b => (ex[b] = this.extraPool[this.extraN++].identity());
    const br = Math.sin(this.breath.t * 6.2832), depth = this.breath.depth, tr = this.tremble;
    const shake = tr > 0.01 ? Math.sin(this.t * 43.7) * 0.5 + Math.sin(this.t * 61.3 + 1.7) * 0.5 : 0;
    // spine: lean, duck, breathing
    const fwd = this.lean.fwd + this.duck * 0.22, side = this.lean.side + this.limp.now * (this.limp.side === 'L' ? 0.16 : -0.16);
    put(ix.spine).setFromAxisAngle(X, fwd * 0.4 - br * 0.004 * depth).multiply(q1.setFromAxisAngle(Z, -side * 0.5));
    put(ix.spine1).setFromAxisAngle(X, fwd * 0.3 - br * 0.007 * depth + shake * tr * 0.006);
    const L = this.look, lw = L.w;
    put(ix.spine2).setFromAxisAngle(Y, L.yaw * 0.16 * lw).multiply(q1.setFromAxisAngle(X, fwd * 0.3 - br * 0.011 * depth - L.pitch * 0.1 * lw));
    put(ix.neck).setFromAxisAngle(Y, L.yaw * 0.34 * lw).multiply(q1.setFromAxisAngle(X, this.duck * 0.3 - L.pitch * 0.3 * lw + br * 0.004 * depth));
    put(ix.head).setFromAxisAngle(Y, L.yaw * 0.5 * lw).multiply(q1.setFromAxisAngle(X, this.duck * 0.25 - L.pitch * 0.6 * lw + shake * tr * 0.012)).multiply(q2.setFromAxisAngle(Z, shake * tr * 0.008));
    // shoulders rise with a breath in, and hunch with a duck
    const sh = br * 0.012 * depth + this.duck * 0.2;
    if (Math.abs(sh) > 0.002) { put(ix.L.sh).setFromAxisAngle(Z, sh); put(ix.R.sh).setFromAxisAngle(Z, -sh); }
    if (ix.jaw != null && (this.jaw > 0.002 || tr > 0.05)) put(ix.jaw).setFromAxisAngle(X, this.jaw + (tr > 0.05 ? Math.sin(this.t * 52) * tr * 0.035 : 0));
    if (detail === 0 && ix.eyeL != null && (Math.abs(L.eyeYaw) > 0.002 || Math.abs(L.eyePitch) > 0.002)) {
      put(ix.eyeL).setFromAxisAngle(Y, L.eyeYaw).multiply(q1.setFromAxisAngle(X, -L.eyePitch)); put(ix.eyeR).copy(ex[ix.eyeL]);
    }
  }

  // ---- legs -----------------------------------------------------------------------------------------------------------------
  // Model space has the person at the origin facing +z; env turns that into the world and back.
  legs(env, dt, detail, downL, downR, locoW) {
    const P = this.P, W = this.W, ix = this.ix, cy = Math.cos(env.yaw), sy = Math.sin(env.yaw), F = this.feet;
    const moving = env.moving, lock = detail === 0 && !env.noLock;
    let drop = -1;
    for (const side of ['L', 'R']) {
      const leg = ix[side], f = F[side], a = P[leg.foot], ball = P[leg.toe], down = (side === 'L' ? downL : downR) === 1;
      // where the clip puts the ball of this foot, in the world: that is what stays put through a stance (the ankle rolls over it)
      const wx = env.x + ball.x * cy + ball.z * sy, wz = env.z - ball.x * sy + ball.z * cy;
      let tx = wx, tz = wz, yawFix = 0;
      if (lock) {
        if (f.step > 0) {                                                     // a corrective step: the foot swings to where the clip has it
          f.step = Math.max(0, f.step - dt / 0.26); const k = smooth(1 - f.step);
          tx = lerp(f.fx, wx, k); tz = lerp(f.fz, wz, k); f.lift = Math.sin(k * Math.PI) * 0.055; yawFix = angDiff(env.yaw, f.yaw) * (1 - k);
          if (f.step === 0) { f.lock = true; f.x = wx; f.z = wz; f.yaw = env.yaw; f.lift = 0; }
        } else if (down) {
          if (!f.lock) { f.lock = true; f.x = wx; f.z = wz; f.yaw = env.yaw; }
          const off = Math.hypot(f.x - wx, f.z - wz), turn = Math.abs(angDiff(env.yaw, f.yaw)), other = F[side === 'L' ? 'R' : 'L'];
          if ((off > (moving ? 0.3 : 0.11) || turn > 0.6) && other.step === 0) { f.lock = false; f.step = 1; f.fx = f.x; f.fz = f.z; tx = f.x; tz = f.z; yawFix = angDiff(env.yaw, f.yaw); }   // left behind, or twisted: step
          else { tx = f.x; tz = f.z; yawFix = angDiff(env.yaw, f.yaw); }
          f.w = Math.min(1, f.w + dt * 12);
        } else { f.lock = false; f.w = Math.max(0, f.w - dt * 9); tx = lerp(wx, f.x, f.w); tz = lerp(wz, f.z, f.w); f.lift = 0; }
      }
      // the ground under it: the higher of what is under the ball and under the heel, so a foot half over a kerb's
      // edge stays on the kerb (toes over the drop) and does not sink through it
      const hx = tx + (a.x - ball.x) * cy + (a.z - ball.z) * sy, hz = tz - (a.x - ball.x) * sy + (a.z - ball.z) * cy;
      const g1 = env.ground ? env.ground(tx, tz) : null, g2 = g1 == null ? null : env.ground(hx, hz), g = g1 == null ? null : Math.max(g1, g2), gy = g == null ? 0 : clamp(g - env.y, -0.35, 0.35);
      f.gy = damp(f.gy, gy, 14, dt);
      // back to model space: the whole foot is shifted by what the ball has to move (at a run a stance is a few frames:
      // holding it buys nothing that can be seen and snatches at the knee, so the hold fades out between 2.4 and 3.4 m/s)
      const hold = clamp((3.4 - (this.speed || 0)) / 1.0, 0, 1), dx = (tx - wx) * hold, dz = (tz - wz) * hold;
      // Keep the gait's foot lift independent of the previous IK hip correction.
      const clipY = a.y + this.pelvisDrop;
      const sole = this.person.restP[leg.toe].y;
      const footY = env.plantFeet ? Math.max(clipY, a.y + sole - ball.y) : clipY;
      const target = v4.set(a.x + dx * cy - dz * sy, footY + f.gy + (f.lift || 0), a.z + dx * sy + dz * cy);
      drop = Math.max(drop, v5.subVectors(target, P[leg.up]).length() - this.legLen * 0.995);      // how far past its reach (or, negative, how much it has in hand)
      f.target = f.target || V(); f.target.copy(target); f.yawFix = yawFix;
    }
    // the pelvis comes down by what the more stretched leg lacks (it takes effect in the next pose; this one reaches as far as it can)
    this.pelvisDrop = damp(this.pelvisDrop, clamp(this.pelvisDrop + drop, 0, 0.3), 12, dt);
    for (const side of ['L', 'R']) {
      const leg = ix[side], f = F[side];
      if (f.target.distanceToSquared(P[leg.foot]) > 1e-8) this.ik(leg.up, leg.leg, leg.foot, f.target);
      if (f.yawFix) { W[leg.foot].premultiply(q1.setFromAxisAngle(Y, f.yawFix)); W[leg.toe].premultiply(q1); }
      P[leg.toe].copy(this.person.restT[leg.toe]).applyQuaternion(W[leg.foot]).add(P[leg.foot]);
    }
  }

  // Two-bone reach: turn bones a and b (their joints at P[a], P[b], the end at P[c]) so the end lands on the target. The
  // bend stays in the plane the clip had it in (the knee keeps pointing where it pointed).
  ik(a, b, c, target, hint = null) {
    const P = this.P, W = this.W, pa = P[a], l1 = P[b].distanceTo(pa), l2 = P[c].distanceTo(P[b]);
    const to = v1.subVectors(target, pa), d = clamp(to.length(), Math.abs(l1 - l2) + 0.005, l1 + l2 - 0.002); to.normalize();
    const pole = hint ? v2.copy(hint) : v2.subVectors(P[b], pa); pole.addScaledVector(to, -pole.dot(to));      // where the knee is, off the hip-to-foot line (or where an elbow should be: `hint`)
    if (pole.lengthSq() < 1e-6) pole.set(0, 0, 1).addScaledVector(to, -to.z); pole.normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const knee = v3.copy(pa).addScaledVector(to, l1 * cosA).addScaledVector(pole, l1 * sinA);
    q1.setFromUnitVectors(v5.subVectors(P[b], pa).normalize(), v2.subVectors(knee, pa).normalize());
    W[a].premultiply(q1);
    const end = v5.copy(pa).addScaledVector(to, d);
    q2.setFromUnitVectors(v2.subVectors(P[c], P[b]).normalize().applyQuaternion(q1), v1.subVectors(end, knee).normalize());
    W[b].premultiply(q2.multiply(q1));
    P[b].copy(knee); P[c].copy(end);
  }

  // Where a bone is in the world right now (after apply): for sounds from the mouth, the eyes' height, a hand.
  world(b, env, out) { const p = this.P[b], cy = Math.cos(env.yaw), sy = Math.sin(env.yaw); return out.set(env.x + p.x * cy + p.z * sy, env.y + p.y, env.z - p.x * sy + p.z * cy); }
  resetFeet() { for (const s of ['L', 'R']) { const f = this.feet[s]; f.lock = false; f.w = 0; f.step = 0; f.gy = 0; f.lift = 0; } this.pelvisDrop = 0; }
}
export { LOCO, ARM_POSES };
