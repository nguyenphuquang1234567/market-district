// The people of the district: who they are, what they do with a quiet morning, and what a firefight does to them.
//
// Each civilian is one of the Ara 3D Gen cast (civ-assets.js) with a temperament of their own (how brave, how curious,
// how sociable, how composed, how brisk) and three running feelings: fear (seconds), stress (minutes) and how alert
// they are. Left alone they stroll, sit where there is a seat, stop to talk in pairs, text, phone, photograph, lean on
// a wall, look over a shop front. The fight reaches them as events, each weighed by distance, by whether they can see
// it, and by who they are:
//   gunfire far off        stop and look; the curious edge closer to see, most walk away from it
//   gunfire near, a fight in sight, a round going past, a blast
//                          a start, then (by temperament and by what is around) run for somewhere out of sight, get
//                          down behind cover with the hands over the head, or freeze where they stand
//   a rifle pointed at them from close by
//                          hands up, held as long as the muzzle stays on them
//   someone near them screaming, hit or down
//                          fear spreads; the dead and the hurt are seen
//   being hit              a hit reaction, pain, then limping for cover and staying down, crying
//   nothing for a while    they come out, look round, breathe out, and go back to their morning, wary for a time
// They take no side: nobody targets them, their deaths are counted apart (casualties) and never touch the score.
//
// Cost: the nearest few are drawn in full (own textures, face shapes, held feet), the rest as one draw each at 9,000,
// 4,500 or 1,800 triangles; poses are made every frame near the camera, every second or fourth further off, and not at
// all out of view; each person thinks five times a second in turn, and paths are found one or two a frame.
import * as THREE from 'three';
import { civ } from './civ-assets.js';
import { Animator, LOCO } from './civ-anim.js';
import { Face } from './civ-face.js';
import { CivVoice } from './civ-voice.js';
import { STRIDE_STEP, resolveXZ, groundAt, losClear, rayBoxes } from './physics.js';
import { rng, clamp, lerp, damp, angDiff } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// The bones a fallen body is jointed at, as they lie in a neutral stand (upright, the arms hanging; the rest pose has them
// straight out to the sides), in the body's own axes: what its joints are measured from (rigid.js).
const HANG = { L: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.16, -0.985, 0.03).normalize()), R: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-0.16, -0.985, 0.03).normalize()) };
function ragRef(person, bn) {
  const k = (n, hang) => ({ bone: bn(n), q: hang ? hang.clone().multiply(person.restW[person.bone[n]]) : person.restW[person.bone[n]].clone() });
  return { pelvis: k('Hips'), torso: k('Spine2'), head: k('Head'), ual: k('LeftArm', HANG.L), fal: k('LeftForeArm', HANG.L), uar: k('RightArm', HANG.R), far: k('RightForeArm', HANG.R), thl: k('LeftUpLeg'), shl: k('LeftLeg'), thr: k('RightUpLeg'), shr: k('RightLeg') };
}
const BAG_LEN = 0.42;                                                           // a bag, from the hand that holds it to its foot
const WORSE = { arm: 1, body: 1, leg: 2, chest: 3, stomach: 3 };
const RADIUS = 0.36, SPACING = 0.62, t1 = V(), t2 = V(), t3 = V(), s1 = V(), s2 = V(), s3 = V(), s4 = new THREE.Matrix4(), sq = new THREE.Quaternion();      // (wide enough that a swinging hand does not go through the wall they walk along)
const SEAT_TOP = 0.44, HIP_OVER_SEAT = 0.095, SIT_BACK = 0.497, SIT_HIP = 0.51;      // the chairs' and stools' seat height; a seated hip joint over it; how far back and how high Ara's sit clip puts the hips (reference body)
const HEALTH = 70;
const TIER_NEAR = 7.5, TIER_MID = 22, TIER_FAR = 52, NEAR_MAX = 4, MID_MAX = 9;      // (in a crowd only the nearest few get the heavier versions)
const CALM = new Set(['idle', 'walk', 'stand', 'sit', 'chat', 'browse', 'lean']);
const hyp = Math.hypot;

// ---- the district as a civilian knows it -------------------------------------------------------------------------------------
class Places {
  constructor(G) {
    const W = G.world, nav = this.nav = W.nav, cols = this.cols = W.colliders, R = rng(4242);
    // colliders by 6 m cell, for a person's own collision and footing
    this.cell = 6; this.grid = new Map(); this.rails = new Set(W.rails || []);
    for (const b of [...cols, ...(W.rails || [])]) {
      const r = b.hx + b.hz + 0.7;
      for (let gx = Math.floor((b.x - r) / 6); gx <= Math.floor((b.x + r) / 6); gx++) for (let gz = Math.floor((b.z - r) / 6); gz <= Math.floor((b.z + r) / 6); gz++) {
        const k = gx * 1000 + gz; let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(b);
      }
    }
    this.none = [];
    // somewhere to walk to: open ground on a loose lattice, clear of the ends of the map where the squads come in
    this.stroll = [];
    for (let z = -70; z <= 70; z += 5) for (let x = -44; x <= 108; x += 5) {
      const px = x + R.range(-1.6, 1.6), pz = z + R.range(-1.6, 1.6), i = nav.idx(px, pz);
      if (nav.blocked[i] || nav.clear[i] < 2 || Math.abs(pz) > 56) continue;
      this.stroll.push({ x: px, z: pz, open: nav.clear[i] });
    }
    // a wall to lean on: a free cell hard against something tall, the wall a pace behind
    this.walls = [];
    for (let k = 0; k < 900 && this.walls.length < 70; k++) {
      const x = R.range(-44, 108), z = R.range(-55, 55), i = nav.idx(x, z); if (nav.blocked[i] || !nav.cover[i]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const d = rayBoxes(x, 1.2, z, dx, 0, dz, 1.6, cols, null); if (d >= 1.6) continue;
        if (rayBoxes(x, 1.2, z, -dx, 0, -dz, 2.5, cols, null) < 2.5) continue;       // (room in front)
        this.walls.push({ x: x + dx * (d - 0.3), z: z + dz * (d - 0.3), yaw: Math.atan2(-dx, -dz) }); break;
      }
    }
    // seats: the loose chairs and stools, while they stand where they were put
    this.seats = [];
    for (const it of G.rigid.props) {
      if (it.name !== 'chair' && it.name !== 'stool') continue;
      const q = it.home.q, rot = 2 * Math.atan2(q.y, q.w), fx = Math.sin(rot), fz = Math.cos(rot);
      const sx = it.home.x + fx * 0.52, sz = it.home.z + fz * 0.52;
      if (!nav.free(sx, sz) || Math.abs(it.home.z) > 58) continue;
      this.seats.push({ x: sx, z: sz, yaw: rot, h: it.name === 'chair' ? 0.44 : 0.43, item: it, by: null });
    }
    // shop fronts to look over
    this.shops = [];
    for (const a of W.anchors) {
      if (a.kind !== 'shop' && a.kind !== 'shutter') continue;
      const x = a.p.x + a.N.x * 1.35, z = a.p.z + a.N.z * 1.35; if (!nav.free(x, z) || Math.abs(z) > 58) continue;
      if (a.kind === 'shutter' && R() > 0.25) continue;
      this.shops.push({ x, z, yaw: Math.atan2(-a.N.x, -a.N.z), by: null });
    }
    this.lanes = [0, 1, 2, 3].map(k => nav.bias(7000 + k * 13, 0.2));
  }
  near(x, z) { return this.grid.get(Math.floor(x / 6) * 1000 + Math.floor(z / 6)) || this.none; }
  ground(x, z, y) { return groundAt(x, z, y, RADIUS, this.near(x, z).filter(b => !this.rails.has(b)), STRIDE_STEP).y; }
  seatFree(s) { const it = s.item, t = it.body.translation(); return !s.by && hyp(t.x - it.home.x, t.z - it.home.z) < 0.12 && Math.abs(t.y - it.home.y) < 0.08; }
}

const TEMPER = { brave: 0.5, curious: 0.5, social: 0.5, calm: 0.5, pace: 1 };

class Civilian {
  constructor(M, person, idx) {
    const G = this.G = M.G; this.M = M; this.person = person; this.idx = idx; this.id = person.id; this.name = person.info.name || person.id;
    this.isPlayer = false; this.isCivilian = true; this.team = -1;
    this.rnd = rng(31000 + idx * 97); const R = this.rnd;
    this.temper = { ...TEMPER, ...(person.info.temper || {}) };
    const inst = this.inst = person.build(); this.root = inst.root; this.model = inst.root; G.R.scene.add(inst.root);
    this.anim = new Animator(person, inst); this.face = new Face(inst, this.anim, rng(52000 + idx * 31), 0.8 + (1 - this.temper.calm) * 0.4);
    const bn = n => inst.bones[person.bone[n]];
    this.b = { hips: bn('Hips'), spine: bn('Spine'), neck: bn('Neck'), head: bn('Head'), la: bn('LeftArm'), lf: bn('LeftForeArm'), lh: bn('LeftHand'), ra: bn('RightArm'), rf: bn('RightForeArm'), rh: bn('RightHand'),
      lul: bn('LeftUpLeg'), ll: bn('LeftLeg'), lft: bn('LeftFoot'), rul: bn('RightUpLeg'), rl: bn('RightLeg'), rft: bn('RightFoot') };
    this.b.chest = bn('Spine2'); this.ragRef = ragRef(person, bn);
    { const b = this.b; this.ragPart = new Map([[b.hips, 'pelvis'], [b.chest, 'torso'], [b.head, 'head'], [b.la, 'ual'], [b.lf, 'fal'], [b.ra, 'uar'], [b.rf, 'far'], [b.lul, 'thl'], [b.ll, 'shl'], [b.rul, 'thr'], [b.rl, 'shr']]); }
    this.pos = V(); this.vel = V(); this.yaw = 0; this.bodyYaw = 0; this.speed = 0; this.alive = false; this.health = HEALTH; this.crouch = 0; this.crouching = false;
    this.env = { x: 0, y: 0, z: 0, yaw: 0, moving: false, noLock: false, ground: (x, z) => M.places.ground(x, z, this.pos.y) };
    this.walkV = (1.18 + R() * 0.3) * this.temper.pace; this.runV = 3.5 + R() * 0.9 + this.temper.pace * 0.4; this.style = R() < 0.14 ? 'walk_slouch' : person.female && R() < 0.2 ? 'model_walk' : 'walk';
    this.lane = M.places.lanes[idx % 4]; this.hasPhone = person.bone.Phone != null; this.hasBag = person.bone.BagL != null;
    this.bx = 0; this.bz = 0;                                                      // where the body really is (a sitter's is on the chair, half a metre behind where they stood)
    this.voiceWho = person.info.voice; this.voiceRate = 0.95 + R() * 0.11;                 // their own takes where the pack has them, and a pitch of their own
    this.tier = 3; this.shown = -2; this.visible = false; this.animSkip = idx % 4; this.accDt = 0; this.thinkT = R() * 0.3; this.dist = 99;
    this.rag = null; this.fall = null; this.downT = 0; this.stepWas = [false, false]; this.stains = []; this.stainN = 0;
    this.resetMind();
  }
  resetMind() {
    this.state = 'idle'; this.stateT = 0; this.phase = 0; this.timer = 0; this.path = null; this.pathI = 0; this.goal = null; this.wishSpeed = 0; this.arrived = true; this.stuckT = 0; this.stuckAt = V();
    this.fear = 0; this.stress = 0; this.alert = 0; this.pain = 0; this.crying = 0; this.joy = 0.15 + this.rnd() * 0.2; this.relief = 0; this.exert = 0; this.wound = null;
    this.threat = null; this.quietT = 99; this.aimedT = 0; this.aimer = null; this.seat = null; this.shop = null; this.conv = null; this.lookAt = null; this.lookT = 0; this.faceYaw = null; this.sayT = 2 + this.rnd() * 6; this.breathT = 0;
    this.wantStand = false; this.rising = false; this.screamT = 0; this.glanceT = this.rnd() * 3;
  }
  get height() { return lerp(this.person.height, this.state === 'dead' ? 0.4 : 1.02, this.crouch); }
  get eyeY() { return this.pos.y + this.height - 0.11; }
  eye(out) { return out.set(this.pos.x, this.eyeY, this.pos.z); }
  get calm() { return CALM.has(this.state); }
  get busy() { return this.state === 'chat' || this.state === 'sit' || this.state === 'browse'; }

  spawn(x, z, yaw) {
    const M = this.M;
    if (this.rag) { this.G.rigid.endRagdoll(this.rag, true); this.rag = null; }
    this.inst.bones.forEach((b, i) => { b.position.copy(this.person.restT[i]); b.quaternion.copy(this.person.restQ[i]); b.scale.setScalar(1); });
    this.pos.set(x, M.places.ground(x, z, 0.3), z); this.vel.set(0, 0, 0); this.yaw = this.bodyYaw = yaw; this.speed = 0; this.alive = true; this.health = HEALTH; this.crouch = 0; this.crouching = false; this.fall = null;
    this.stains.length = 0; this.stainN = 0; for (const u of this.person.woundU.value) u.w = 0;
    this.dying = 0; this.limp = null; this.hitAt = null; this.ragHit = null; this.anim.limp.k = 0; this.anim.reach.L.on = this.anim.reach.R.on = 0; this.anim.reach.L.w = this.anim.reach.R.w = 0; this.release(); this.resetMind(); this.anim.play(LOCO, { fade: 0 }); this.anim.playUpper(null); this.anim.resetFeet(); this.anim.hipsY = 0; this.env.noLock = false;
    for (const k in this.anim.pose) this.anim.pose[k].L = this.anim.pose[k].R = 0;
    for (const k in this.face.mood) this.face.mood[k] = 0;
    this.timer = this.rnd() * 2.5;
  }
  release() { this.settle = null; if (this.seat) { this.seat.by = null; this.seat = null; } if (this.shop) { this.shop.by = null; this.shop = null; } if (this.conv) this.M.endTalk(this.conv); }

  // ---- getting about -----------------------------------------------------------------------------------------------------------
  go(x, z, speed, then = 'idle') {
    const nav = this.M.places.nav;
    if (!nav.free(x, z)) { const c = nav.center(nav.nearestFree(x, z), t1); x = c.x; z = c.z; }
    this.goal = { x, z }; this.wishSpeed = speed; this.then = then; this.arrived = false; this.path = null; this.pathI = 0; this.stuckT = 0; this.stuckAt.copy(this.pos);
    this.M.askPath(this);
  }
  // Out of whatever they were doing and onto their feet: up from a seat, off the wall, the phone down.
  toFeet(fast) {
    const A = this.anim; A.playUpper(null, { fade: 0.2 });
    if (A.clip === 'sit_idle' || A.clip === 'sit_down') { A.play('stand_up', { fade: 0.15, speed: fast ? 1.8 : 1.2 }); this.rising = true; this.env.noLock = true; }
    else if (!this.rising) { if (A.clip !== LOCO) A.play(LOCO, { fade: fast ? 0.22 : 0.45 }); this.env.noLock = false; }
  }
  stop() { this.goal = null; this.path = null; this.arrived = true; this.wishSpeed = 0; }
  setState(s, timer = 0) { this.state = s; this.stateT = 0; this.phase = 0; this.timer = timer; }

  // What reaches this person from the fight: `k` 0..1 is how much it is (already weighed by distance), at (x, z).
  scare(k, x, z, kind, seen = false) {
    if (!this.alive || this.state === 'dead') return;
    const T = this.temper, gain = lerp(1.35, 0.7, T.brave) * (1 + this.stress * 0.5);
    const f = clamp(k * gain, 0, 1.2); if (f < 0.03) return;
    // (the same thing again and again frightens up to a point, a little past what one of it does: far-off fire does not add up to panic)
    const was = this.fear, top = Math.min(1, f * 1.3); if (this.fear < top) this.fear = Math.min(top, Math.max(this.fear, f * 0.85) + f * 0.06); this.quietT = 0;
    if (!this.threat || f > 0.25 || this.G.time - this.threat.t > 4) this.threat = { x, z, t: this.G.time, kind, seen };
    else { this.threat.t = this.G.time; if (seen) { this.threat.x = x; this.threat.z = z; this.threat.seen = true; } }
    if (f > 0.3 && was < 0.5) { this.face.startle(clamp(f * 1.3, 0.3, 1)); this.anim.duck = Math.max(this.anim.duck, clamp(f, 0, 1) * (kind === 'blast' || kind === 'near' ? 1 : 0.5)); }
    this.react(f, kind);
  }
  // Decide what to do about it. Called at the moment of a fright, and again as the fear changes.
  react(f, kind) {
    const s = this.state, T = this.temper, R = this.rnd, G = this.G;
    if (s === 'dead' || s === 'hurt' || s === 'down') return;
    if (s === 'surrender' && this.aimedT > 0) return;
    const th = this.threat, d = th ? hyp(th.x - this.pos.x, th.z - this.pos.z) : 99;
    if (this.fear < 0.3 && this.calm) {                                              // something far off
      this.release(); this.stop(); this.toFeet(false); this.setState('alert', 1.2 + R() * 2.2); this.wantStand = true;
      if (th) this.faceYaw = Math.atan2(th.x - this.pos.x, th.z - this.pos.z);
      return;
    }
    if (this.fear >= 0.3 && (this.calm || s === 'alert' || s === 'investigate' || s === 'peek' || s === 'leave' || s === 'recover')) {
      this.release(); this.stop(); this.toFeet(true);
      const sudden = kind === 'blast' || kind === 'near' || d < 14;
      if (this.fear > 0.55 && sudden && R() < lerp(0.5, 0.12, T.brave) * (1.2 - T.calm)) { this.setState('freeze', 0.7 + R() * 2.4 * (1 - T.brave)); if (R() < 0.6) this.cry('scream'); return; }
      if (this.fear > 0.5 && R() < 0.55 * (1.1 - T.calm)) this.cry(R() < 0.7 ? 'scream' : 'gasp'); else if (R() < 0.5) this.cry('gasp');
      this.fleeNow();
      return;
    }
    if ((s === 'cower' || s === 'flee') && f > 0.5 && kind !== 'voice') {            // it has come closer
      if (s === 'cower' && d < 9 && R() < 0.5) { this.cry('scream'); this.fleeNow(); }
      else if (s === 'flee' && this.screamT <= 0 && R() < 0.3) this.cry('scream');
    }
  }
  // Where to run: cover close by for those who would rather get down, else somewhere far from it and out of its sight.
  fleeNow() {
    const P = this.M.places, th = this.threat, R = this.rnd, T = this.temper;
    this.toFeet(true); this.crouching = false; this.faceYaw = null;
    if (!th) { this.setState('cower', 4); return; }
    const d = hyp(th.x - this.pos.x, th.z - this.pos.z);
    // cover close by, for those who would rather get down than run (or have nowhere to run to)
    if (d > 6 && R() < lerp(0.42, 0.14, T.brave) + (this.wound ? 0.3 : 0)) { const c = this.findCover(th); if (c) { this.setState('flee'); this.hideAt = true; this.go(c.x, c.z, this.pace('run'), 'cower'); return; } }
    let best = null, bs = -1e9; const ax = this.pos.x - th.x, az = this.pos.z - th.z, al = hyp(ax, az) || 1;
    for (let k = 0; k < 14; k++) {
      const p = P.stroll[(R() * P.stroll.length) | 0], dx = p.x - this.pos.x, dz = p.z - this.pos.z, ds = hyp(dx, dz); if (ds < 14 || ds > 75) continue;
      const dt = hyp(p.x - th.x, p.z - th.z), away = (dx * ax + dz * az) / (ds * al);
      const sc = dt * 1.0 - ds * 0.3 + away * 22 + R() * 6;
      if (sc > bs) { bs = sc; best = p; }
    }
    if (!best) { this.setState('cower', 6); return; }
    this.setState('flee'); this.hideAt = false; this.go(best.x, best.z, this.pace('run'), 'cower');
  }
  findCover(th) {
    const P = this.M.places, nav = P.nav, R = this.rnd; let best = null, bs = 1e9;
    for (let i = 0; i < 26; i++) {
      const x = this.pos.x + (R() - 0.5) * 20, z = this.pos.z + (R() - 0.5) * 20, ci = nav.idx(x, z);
      if (nav.blocked[ci] || !nav.cover[ci]) continue;
      nav.center(ci, t3);
      if (hyp(t3.x - th.x, t3.z - th.z) < 6) continue;
      if (losClear(t1.set(th.x, 1.5, th.z), t2.set(t3.x, 0.7, t3.z), P.cols)) continue;
      const sc = hyp(t3.x - this.pos.x, t3.z - this.pos.z) + (this.M.list.some(c => c !== this && c.alive && hyp(c.pos.x - t3.x, c.pos.z - t3.z) < 0.9) ? 20 : 0);
      if (sc < bs) { bs = sc; best = { x: t3.x, z: t3.z }; }
    }
    return best;
  }
  pace(kind) {
    const w = this.wound ? ({ leg: 0.42, stomach: 0.5, arm: 0.85 })[this.wound.part] || 0.6 : 1;
    if (kind === 'run') return (this.runV + this.fear * 0.7) * w;
    if (kind === 'brisk') return Math.min(this.walkV * 1.45, 2.1) * w;
    if (kind === 'careful') return this.walkV * 0.62 * w;
    return this.walkV * w;
  }
  cry(kind) {
    const v = this.M.voice.say(this, kind); if (!v) return false;
    this.face.speak(v); if (kind === 'scream') this.screamT = 2.5 + this.rnd() * 3;
    if (kind === 'scream' || kind === 'pain') this.M.heard(this, kind === 'scream' ? 0.34 : 0.28, 22);
    return true;
  }

  // ---- being hit --------------------------------------------------------------------------------------------------------------
  // Where a round struck: which bone (each taken as a capsule), what part of the body that is and on which side, and the
  // point where it went in, kept in that bone's own space so that it stays with the body (a hand can go to it, see pose).
  struck(o, d, zone) {
    const b = this.b; this.root.updateMatrixWorld(true);
    let best = null, bs = 1e9;
    for (const [bone, end, r, part, side] of [[b.hips, b.neck, 0.135, 'trunk', ''], [b.head, null, 0.1, 'head', ''], [b.la, b.lf, 0.048, 'arm', 'L'], [b.lf, b.lh, 0.04, 'arm', 'L'], [b.ra, b.rf, 0.048, 'arm', 'R'], [b.rf, b.rh, 0.04, 'arm', 'R'],
      [b.lul, b.ll, 0.082, 'leg', 'L'], [b.ll, b.lft, 0.056, 'leg', 'L'], [b.rul, b.rl, 0.082, 'leg', 'R'], [b.rl, b.rft, 0.056, 'leg', 'R']]) {
      const a = bone.getWorldPosition(t1); if (end) end.getWorldPosition(t2); else t2.copy(a).y += 0.16;
      // closest approach of the round's line to this bone
      const ab = t3.subVectors(t2, a), w = s1.subVectors(o, a), A = d.dot(d), B = d.dot(ab), C = ab.dot(ab), D = d.dot(w), E = ab.dot(w), den = A * C - B * B;
      let u = den > 1e-9 ? clamp((A * E - B * D) / den, 0, 1) : 0; const t = (B * u - D) / A; if (t < 0) continue;
      const pr = s2.copy(o).addScaledVector(d, t), pa = s3.copy(a).addScaledVector(ab, u), dist = pr.distanceTo(pa), sc = dist - r + (zone === 'head' && !end ? -0.2 : 0) + (zone === 'limb' && bone === b.hips ? 0.1 : 0);
      if (sc < bs) { bs = sc; best = { bone, r, t, dist, axis: pa.clone(), part, side, u, low: bone === b.lf || bone === b.rf || bone === b.ll || bone === b.rl }; }
    }
    if (!best || bs > 0.12) return (this.hitAt = null);
    best.half = Math.sqrt(Math.max(0, best.r * best.r - Math.min(best.dist, best.r) ** 2));
    const girth = this.person.girth(), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // how far out of the bone this person's surface is, the way `n` points (their own thickness, clothes and all)
    best.out = n => { const g = girth[best.part] || girth[best.bone.name]; if (typeof g === 'number') return g; if (!g) return best.r; const x = n.x * cy - n.z * sy, z = n.x * sy + n.z * cy, dp = z > 0 ? g.front : g.back; return 1 / Math.sqrt((x / g.side) ** 2 + (z / dp) ** 2 + (n.y / 0.3) ** 2 + 1e-9); };
    const pin = s2.copy(o).addScaledVector(d, best.t - best.half), n = s3.subVectors(pin, best.axis); if (n.lengthSq() < 1e-6) n.copy(d).negate(); n.normalize();
    if (best.part === 'trunk') {                                                    // the chest or the stomach, and which side of it
      best.part = best.u > 0.42 ? 'chest' : 'stomach'; if (best.u > 0.42) best.bone = b.chest;
      best.side = n.x * Math.cos(this.yaw) - n.z * Math.sin(this.yaw) > 0 ? 'L' : 'R';
    }
    best.normal = n.clone().transformDirection(s4.copy(best.bone.matrixWorld).invert());
    best.local = best.bone.worldToLocal(best.axis.clone().addScaledVector(n, best.out(n) + 0.012)); best.time = this.G.time;      // on the surface there (a hand's half thickness off it)
    return (this.hitAt = best);
  }
  // Blood on the clothes and the skin where a round went in and where it came out (larger): soaked into the body's own
  // surface there (civ-assets.js, woundPatch), spreading for some seconds, staying with the body as it runs on or falls.
  stain(o, d, zone) {
    const G = this.G, best = this.struck(o, d, zone); if (!best || !G.blood?.on) return best;
    const P = this.person, ix = this.inst.bones.indexOf(best.bone), U = P.woundU.value;
    for (const [side, r0, r1] of [[-1, 0.02, 0.065 + this.rnd() * 0.04], [1, 0.032, 0.1 + this.rnd() * 0.05]]) {
      const p = s2.copy(o).addScaledVector(d, best.t + side * best.half), n = s3.subVectors(p, best.axis); if (n.lengthSq() < 1e-6) n.copy(d).multiplyScalar(side); n.normalize();
      best.bone.worldToLocal(p.copy(best.axis).addScaledVector(n, best.out(n)));                  // on the surface, in the bone's own space...
      p.applyQuaternion(P.restW[ix]).add(P.restP[ix]);                                             // ...and so on the body as it was made
      const slot = this.stains.length < 6 ? this.stains.length : this.stainN++ % 6, st = { slot, r0, r1, t: 0 };      // (six a person; then the oldest is the one replaced)
      this.stains[slot] = st; U[slot].set(p.x, p.y, p.z, r0);
    }
    return best;
  }
  damage(amount, from, attacker, zone) {
    if (!this.alive) return false;
    const G = this.G, h = this.hitAt && this.hitAt.time === G.time && zone !== 'blast' ? this.hitAt : null; this.health -= amount; this.M.stats.hit++;
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, l = hyp(dx, dz) || 1;
    if (this.health <= 0 || zone === 'head') {
      this.alive = false; this.health = 0; this.release(); this.stop(); this.state = 'dead'; this.stateT = 0; this.M.stats.killed++; if (attacker === G.player) this.M.stats.byPlayer++;
      if (zone === 'blast') { const dy = this.pos.y + 1 - (from.y ?? 0), l3 = hyp(dx, dy, dz) || 1; this.fall = { dir: V(dx / l3, dy / l3 + 0.45, dz / l3).normalize(), zone: 'body', launch: clamp(amount / 100, 0.35, 1.5) * 2.2 }; }
      else this.fall = { dir: V(dx / l, -0.08, dz / l), zone };
      this.ragHit = h ? this.ragPart.get(h.bone) : null;                              // (the part of the body the round that killed went into: the leg that gives first)
      // the cry of someone shot dead (a recording: civ-voices); shot in the head, mostly nothing, or a cry cut short
      this.M.voice.stop(this);
      if (zone !== 'head') { if (!this.M.voice.say(this, 'die')) this.M.voice.say(this, 'pain'); } else if (this.rnd() < 0.3) this.M.voice.say(this, 'die', { cut: 0.3 });
      this.M.witness(this, 0.75, 26, 'down');
      G.onCivilian?.(this, attacker, zone);
      return true;
    }
    this.release(); this.stop(); this.pain = 1; this.fear = Math.max(this.fear, 0.85); this.quietT = 0;
    this.threat = { x: from.x, z: from.z, t: G.time, kind: 'near', seen: true }; this.wantStand = false; this.crouching = false;
    this.env.noLock = false; this.rising = false;
    // The wound is where the round went in, and everything after shows it there: the reaction to the shot, the hand that
    // goes to it, the leg that will not take weight, the arm held still. (Hit again, the worse wound is the one that shows.)
    const part = zone === 'blast' ? 'body' : h ? (h.part === 'head' ? 'chest' : h.part) : zone === 'limb' ? (this.rnd() < 0.5 ? 'leg' : 'arm') : 'chest', side = h && h.side ? h.side : this.rnd() < 0.5 ? 'L' : 'R';
    if (!this.wound || WORSE[part] >= WORSE[this.wound.part]) {
      const other = side === 'L' ? 'R' : 'L', free = sd => !(sd === 'L' && this.hasBag);      // (a hand with a bag in it stays where it is)
      const hand = !h ? null : part === 'arm' ? (free(other) ? other : null) : free(side) ? side : free(other) && part !== 'leg' ? other : null;
      this.wound = { part, side, low: !!h && h.low, hand, bone: h ? this.inst.bones.indexOf(h.bone) : -1, local: h ? h.local.clone() : null, normal: h ? h.normal.clone() : null };
    }
    const rel = angDiff(this.yaw, Math.atan2(-dx, -dz)), heavy = this.health < HEALTH * 0.45;      // (where it came from, relative to the way they face)
    let clip, mirror = false, next = 'hurt'; this.downFace = 'up';
    if (zone === 'blast') { clip = 'knockdown'; next = 'down'; }
    else if (part === 'leg') { clip = 'shot_leg'; mirror = side === 'R'; }            // (Ara's are shot in the left leg and the left arm: turned over for the right)
    else if (part === 'arm') { clip = 'shot_arm'; mirror = side === 'R'; }
    else if (heavy) { clip = part === 'stomach' ? 'shot_stomach' : 'shot_chest'; next = 'down'; if (part === 'stomach') this.downFace = 'down'; }      // badly hit in the body: down, doubled over it or thrown back
    else clip = Math.abs(rel) < 0.8 ? 'hit_front' : Math.abs(rel) > 2.3 ? 'hit_back' : rel > 0 ? 'hit_left' : 'hit_right';
    this.anim.playUpper(null); this.anim.play(clip, { fade: 0.08, mirror }); this.setState(next);
    this.face.startle(1); this.cry(this.rnd() < 0.7 ? 'scream' : 'pain');
    this.M.witness(this, 0.5, 20, 'hurt');
    return false;
  }

  // ---- thinking: five times a second ------------------------------------------------------------------------------------------
  think(dt) {
    const G = this.G, M = this.M, R = this.rnd, T = this.temper, P = M.places, s = this.state;
    if (s === 'dead') return;
    this.quietT += dt; this.screamT -= dt;
    // feelings
    const quiet = this.quietT > 1.5;
    if (quiet) this.fear = Math.max(0, this.fear - dt * lerp(0.05, 0.11, T.calm) * (this.state === 'cower' ? 0.8 : 1));
    this.stress = clamp(this.stress + dt * (this.fear > 0.3 ? this.fear * 0.09 : -lerp(0.012, 0.022, T.calm)), 0, 1);
    this.alert = damp(this.alert, this.fear > 0.05 || this.stress > 0.25 ? 1 : 0, 0.8, dt);
    this.pain = Math.max(this.wound ? 0.35 : 0, this.pain - dt * 0.07);
    const wantCry = (this.wound ? 0.7 : 0) + (this.state === 'cower' && this.stress > 0.45 ? (1 - T.calm) * 0.9 : 0);
    this.crying = damp(this.crying, clamp(wantCry, 0, 1), 0.5, dt);
    this.relief = Math.max(0, this.relief - dt * 0.12);
    // the armed: someone close with a rifle, and whether it points here
    this.aimedT = Math.max(0, this.aimedT - dt); this.defied = Math.max(0, (this.defied || 0) - dt);
    if (this.dist < 60 || this.fear > 0) for (const a of M.armed) {
      if (!a.alive) continue;
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d = hyp(dx, dz); if (d > 22) continue;
      const aim = M.aimOf(a), to = Math.atan2(dx, dz), off = Math.abs(angDiff(aim.yaw, to));
      if (off > 0.9 && d > 5) continue;
      if (!losClear(a.eye ? a.eye(t1) : t1.set(a.pos.x, a.eyeY ?? a.pos.y + 1.6, a.pos.z), this.eye(t2), P.cols)) continue;
      const pitchTo = Math.atan2(this.pos.y + this.height * 0.6 - (a.eyeY ?? a.pos.y + 1.6), d);
      const pointed = aim.up && off < 0.1 + 0.9 / Math.max(d, 1) && Math.abs(aim.pitch - pitchTo) < 0.22;
      if (pointed && d < 15) { this.aimedT = 1.4; this.aimer = a; this.scare(clamp(1.05 - d / 22, 0.35, 0.9), a.pos.x, a.pos.z, 'aim', true); }
      else if (d < 7 && a.vel && (a.vel.x * dx + a.vel.z * dz) / d > 1.2) this.scare(clamp(0.5 - d / 16, 0.12, 0.4) * (aim.up ? 1 : 0.6), a.pos.x, a.pos.z, 'approach', true);   // coming this way, armed
      else if (d < 4.5 && this.calm && !this.lookAt) { this.lookAt = a; this.lookT = 1.5 + R() * 2; this.alert = Math.max(this.alert, 0.6); }
    }
    const now = this.state;                                                         // (a fright in this tick may already have set them running)
    if (this.aimedT > 0 && now !== 'surrender' && now !== 'hurt' && now !== 'down' && (now !== 'flee' || this.stateT < 0.45) && this.fear > 0.3 && !this.defied) {
      const d = hyp(this.aimer.pos.x - this.pos.x, this.aimer.pos.z - this.pos.z);
      if (d >= 12 || R() >= lerp(0.97, 0.6, T.brave)) this.defied = 4;               // this one runs instead (and does not think again for a while)
      else { this.release(); this.stop(); this.toFeet(true); this.crouching = false; this.setState('surrender'); if (R() < 0.7) this.cry(R() < 0.5 ? 'plead' : 'gasp'); }
    }
    this['st_' + this.state]?.(dt);                                               // (the state as it is now: a fright in this very tick may have changed it)
    // a path that is not being walked
    if (this.goal && !this.arrived) {
      this.stuckT += dt;
      if (this.stuckT > 2.2) { if (this.pos.distanceTo(this.stuckAt) < 0.5 && this.path) { this.bumps = (this.bumps || 0) + 1; if (this.bumps > 2 && this.calm) { this.bumps = 0; this.stop(); this.setState('idle'); } else M.askPath(this); } else this.bumps = 0; this.stuckT = 0; this.stuckAt.copy(this.pos); }
    }
  }

  // -- a quiet morning
  st_idle(dt) {
    this.timer -= dt; if (this.timer > 0) return;
    const M = this.M, P = M.places, R = this.rnd, T = this.temper, r = R(), wary = this.stress > 0.3;
    this.anim.playUpper(null);
    if (!wary && r < 0.2 * (0.4 + T.social * 1.2)) { const o = M.partner(this); if (o) { M.talk(this, o); return; } }
    if (!wary && r < 0.36) { const s = this.pick(P.seats, 38, s => P.seatFree(s)); if (s) { this.seat = s; s.by = this; this.setState('sit'); this.go(s.x, s.z, this.pace('walk'), 'sit'); return; } }
    if (!wary && r < 0.5) { const s = this.pick(P.shops, 45, s => !s.by); if (s) { this.shop = s; s.by = this; this.setState('browse'); this.go(s.x, s.z, this.pace('walk'), 'browse'); return; } }
    if (r < 0.66) {                                                                    // stand a while: the phone, a look round, a photograph, a wall to lean on
      const q = R(); let clip = 'look_around', t = 5 + R() * 7;
      if (this.hasPhone && q < 0.4) { clip = 'texting'; t = 8 + R() * 14; } else if (this.hasPhone && q < 0.58) { clip = 'phone_call'; t = 9 + R() * 14; }
      else if (q < 0.68 && !wary) { clip = 'take_picture'; t = 4.4; }
      else if (q < 0.82 && !wary) { const w = this.pick(P.walls, 30, () => true); if (w) { this.wall = w; this.setState('walk'); this.go(w.x, w.z, this.pace('walk'), 'lean'); return; } }
      this.standClip = clip; this.setState('stand', t); this.anim.play(clip, { fade: 0.45 });
      if (clip === 'phone_call') this.sayT = 1 + R() * 2;
      return;
    }
    let p = null; for (let k = 0; k < 6 && !p; k++) { const c = P.stroll[(R() * P.stroll.length) | 0], d = hyp(c.x - this.pos.x, c.z - this.pos.z); if (d > 10 && d < 70) p = c; }
    if (!p) { this.timer = 1; return; }
    this.setState('walk'); this.go(p.x + R.range(-1, 1), p.z + R.range(-1, 1), this.pace(wary ? 'brisk' : 'walk'), 'idle');
    if (this.hasPhone && !wary && R() < 0.22) this.anim.playUpper(R() < 0.7 ? 'texting' : 'phone_call', { mask: 'arms' });
  }
  pick(list, range, ok) {
    let best = null, bd = range; const R = this.rnd;
    for (let k = 0; k < 10; k++) { const s = list[(R() * list.length) | 0]; if (!s || !ok(s)) continue; const d = hyp(s.x - this.pos.x, s.z - this.pos.z) * (0.6 + R() * 0.8); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  st_stand(dt) {
    this.timer -= dt;
    if (this.standClip === 'phone_call') { this.sayT -= dt; if (this.sayT <= 0 && !this.face.speaking) { const v = this.M.voice.say(this, 'chat', { gain: 0.8 }); if (v) this.face.speak(v); this.sayT = (v ? v.dur : 1) + 0.8 + this.rnd() * 3.5; } }
    if (this.timer <= 0) { this.anim.play(LOCO, { fade: 0.5 }); this.setState('idle', 0.6 + this.rnd()); }
  }
  st_lean(dt) {
    if (this.phase === 0) { this.faceYaw = this.wall.yaw; if (Math.abs(angDiff(this.yaw, this.wall.yaw)) < 0.25) { this.phase = 1; this.timer = 12 + this.rnd() * 20; this.anim.play('lean_wall', { fade: 0.6 }); this.env.noLock = true; } else if (this.stateT > 4) this.setState('idle'); }
    else { this.timer -= dt; if (this.timer <= 0) { this.anim.play(LOCO, { fade: 0.6 }); this.env.noLock = false; this.faceYaw = null; this.setState('idle', 0.8); } }
  }
  st_sit(dt) {
    const s = this.seat, P = this.M.places;
    if (!s) { this.setState('idle'); return; }
    if (this.phase === 0) {                                                            // on the way; then square up to it
      if (!this.arrived) { if (s.by !== this || (this.stateT > 3 && !P.seatFree({ ...s, by: null }))) { this.release(); this.stop(); this.setState('idle'); } return; }
      // the last half pace, exactly: square to the seat and just as far in front of it as the sit carries this body back
      // (to the chair as it stands now: someone brushing past may have turned it a little since it was put there)
      const it = s.item.body.translation(), rq = s.item.body.rotation(), yaw = 2 * Math.atan2(rq.y, rq.w), back = SIT_BACK * this.anim.scale - 0.07, tx = it.x + Math.sin(yaw) * back, tz = it.z + Math.cos(yaw) * back;
      this.faceYaw = yaw; this.settle = { x: tx, z: tz };
      if (hyp(this.pos.x - tx, this.pos.z - tz) < 0.02 && Math.abs(angDiff(this.yaw, yaw)) < 0.05) { this.settle = null; this.pos.x = tx; this.pos.z = tz; this.yaw = yaw; this.seatAt = { x: it.x, z: it.z }; this.phase = 1; this.anim.play('sit_down', { fade: 0.3 }); this.env.noLock = true; }
      else if (this.stateT > 30) { this.release(); this.setState('idle'); }
    } else if (this.phase === 1) { if (this.anim.done) { this.phase = 2; this.anim.play('sit_idle', { fade: 0.4 }); this.timer = 18 + this.rnd() * 45; if (this.hasPhone && this.rnd() < 0.45) this.anim.playUpper('texting', { mask: 'arms', fade: 0.8 }); } }
    else if (this.phase === 2) {
      this.timer -= dt;
      const it = s.item.body.translation();
      if (hyp(it.x - s.item.home.x, it.z - s.item.home.z) > 0.25) { this.timer = 0; this.face.startle(0.6); }      // the chair has gone from under them
      if (this.timer <= 0 || this.wantStand) { this.phase = 3; this.anim.playUpper(null, { fade: 0.3 }); this.anim.play('stand_up', { fade: 0.25, speed: this.wantStand ? 1.6 : 1 }); }
    } else if (this.anim.done) { this.anim.play(LOCO, { fade: 0.3 }); this.env.noLock = false; this.faceYaw = null; this.release(); this.setState('idle', 0.4); }
  }
  st_browse(dt) {
    const s = this.shop; if (!s) { this.setState('idle'); return; }
    if (this.phase === 0) { if (!this.arrived) return; this.faceYaw = s.yaw; this.phase = 1; this.timer = 7 + this.rnd() * 14; this.actT = 1.5 + this.rnd() * 3; }
    else {
      this.timer -= dt; this.actT -= dt;
      if (this.actT <= 0 && this.anim.clip === LOCO) { const r = this.rnd(); this.anim.play(r < 0.4 ? 'point' : r < 0.75 ? 'use_press' : 'look_around', { fade: 0.35 }); this.actT = 4 + this.rnd() * 5; }
      else if (this.anim.clip !== LOCO && (this.anim.done || this.actT < 1)) this.anim.play(LOCO, { fade: 0.45 });
      if (this.timer <= 0) { this.anim.play(LOCO, { fade: 0.4 }); this.faceYaw = null; this.release(); this.setState('idle', 0.5); }
    }
  }
  st_chat(dt) {
    const c = this.conv; if (!c) { this.setState('idle'); return; }
    const o = c.a === this ? c.b : c.a, M = this.M, R = this.rnd;
    if (!o.alive || o.conv !== c) { M.endTalk(c); return; }
    if (c.phase === 0) {                                                               // walking up to each other
      if (this.arrived) { this.faceYaw = Math.atan2(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }
      if (c.a === this && c.a.arrived && c.b.arrived) { c.phase = 1; c.left = 14 + R() * 30; c.gap = 0.3; c.speaker = R() < 0.5 ? c.a : c.b; if (R() < 0.5) { c.a.anim.playUpper('wave', { mask: 'arms' }); c.a.joy = 0.7; } }
      else if (this.stateT > 35) M.endTalk(c);
      return;
    }
    this.lookAt = o; this.lookT = 1; this.faceYaw = Math.atan2(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
    if (c.a !== this) return;                                                         // one of the two keeps the conversation
    c.left -= dt;
    if (c.line > 0) { c.line -= dt; return; }
    c.gap -= dt; if (c.gap > 0) return;
    if (c.left <= 0) { if (R() < 0.6) c.b.anim.playUpper('wave', { mask: 'arms' }); M.endTalk(c); return; }
    const sp = c.speaker = c.speaker === c.a ? c.b : c.a, li = sp === c.a ? c.b : c.a, laugh = R() < 0.16;
    const v = M.voice.say(sp, laugh ? 'laugh' : 'chat');
    c.line = v ? v.dur : 1.6 + R() * 1.6; c.gap = 0.25 + R() * 0.8;
    sp.face.speak(v || { dur: c.line, kind: 'talk' });
    sp.anim.play(laugh ? 'laugh' : R() < 0.55 ? 'talk_gestures' : 'talk', { fade: 0.4, time: R() * 2 }); li.anim.play(LOCO, { fade: 0.5 });
    sp.joy = laugh ? 1 : 0.45; li.joy = laugh ? 0.9 : 0.3 + R() * 0.3;
    if (laugh && R() < 0.6) { const v2 = M.voice.say(li, 'laugh', { delay: 0.25 }); if (v2) li.face.speak(v2); li.anim.play('laugh', { fade: 0.4 }); }
  }

  // -- when it is not quiet
  st_alert(dt) {
    this.timer -= dt; const th = this.threat, R = this.rnd, T = this.temper;
    if (th) this.faceYaw = Math.atan2(th.x - this.pos.x, th.z - this.pos.z);
    if (this.timer > 0) return;
    if (!th || this.quietT > 9) { this.faceYaw = null; this.setState('recover', 2); return; }
    const d = hyp(th.x - this.pos.x, th.z - this.pos.z);
    if (T.curious * 0.7 + T.brave * 0.5 > 0.62 + R() * 0.25 && d > 30) {               // go and see, carefully
      const k = clamp((d - 26) / d, 0, 0.45); this.setState('investigate'); this.go(this.pos.x + (th.x - this.pos.x) * k + R.range(-3, 3), this.pos.z + (th.z - this.pos.z) * k + R.range(-3, 3), this.pace('careful'), 'peek');
    } else {                                                                           // walk away from it
      const ax = this.pos.x - th.x, az = this.pos.z - th.z, al = hyp(ax, az) || 1; let best = null, bs = -1e9;
      for (let k = 0; k < 10; k++) { const p = this.M.places.stroll[(R() * this.M.places.stroll.length) | 0], dx = p.x - this.pos.x, dz = p.z - this.pos.z, ds = hyp(dx, dz); if (ds < 12 || ds > 60) continue; const sc = (dx * ax + dz * az) / (ds * al) * 30 - ds * 0.2 + R() * 8; if (sc > bs) { bs = sc; best = p; } }
      if (best) { this.faceYaw = null; this.setState('leave'); this.go(best.x, best.z, this.pace('brisk'), 'recover'); } else this.setState('recover', 3);
    }
  }
  st_investigate(dt) { if (this.arrived) this.setState('peek', 3 + this.rnd() * 5); }
  st_peek(dt) {
    const th = this.threat; if (th) this.faceYaw = Math.atan2(th.x - this.pos.x, th.z - this.pos.z);
    if (this.phase === 0) { this.phase = 1; this.anim.play('look_around', { fade: 0.5 }); }
    this.timer -= dt; if (this.timer <= 0) { this.anim.play(LOCO, { fade: 0.4 }); this.faceYaw = null; this.setState(this.quietT > 8 ? 'recover' : 'alert', 2); }
  }
  st_leave(dt) { if (this.arrived) this.setState('recover', 2 + this.rnd() * 3); }
  st_freeze(dt) { this.timer -= dt; if (this.threat) this.faceYaw = Math.atan2(this.threat.x - this.pos.x, this.threat.z - this.pos.z); if (this.timer <= 0) { this.faceYaw = null; this.fleeNow(); } }
  st_flee(dt) {
    if (this.arrived) { this.setState('cower', 0); return; }
    this.exert = Math.min(1, this.exert + dt * 0.12);
    const th = this.threat;
    if (th && this.G.time - th.t < 0.6 && this.goal && this.rnd() < 0.25) {            // it is ahead of them now: turn round
      const gx = this.goal.x - this.pos.x, gz = this.goal.z - this.pos.z, tx = th.x - this.pos.x, tz = th.z - this.pos.z, dg = hyp(gx, gz), d = hyp(tx, tz);
      if (d < dg && d < 25 && (gx * tx + gz * tz) / (dg * d || 1) > 0.75) this.fleeNow();
    }
  }
  st_cower(dt) {
    const R = this.rnd, T = this.temper, th = this.threat;
    if (this.phase === 0) { this.phase = 1; this.crouching = true; this.anim.play('crouch', { fade: 0.35 }); this.timer = 5 + R() * 6; this.peekT = 4 + R() * 8; if (th) this.faceYaw = Math.atan2(this.pos.x - th.x, this.pos.z - th.z); }
    this.sayT -= dt;
    if (this.sayT <= 0 && !this.face.speaking) { this.sayT = 2.5 + R() * 5; if (this.crying > 0.35 || this.fear > 0.5) this.cry(this.crying > 0.4 ? 'sob' : 'whimper'); }
    if (this.fear < 0.2 && this.quietT > lerp(26, 11, (T.brave + T.calm) / 2) + this.stress * 14 && !this.wound) { this.crouching = false; this.faceYaw = null; this.setState('recover', 0); }
    else if (this.wound && this.quietT > 60) { /* stays down, hurt */ }
  }
  st_surrender(dt) {
    const a = this.aimer; if (a) this.faceYaw = Math.atan2(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
    this.sayT -= dt; if (this.sayT <= 0 && !this.face.speaking && this.aimedT > 0) { this.sayT = 2 + this.rnd() * 3; this.cry(this.rnd() < 0.6 ? 'plead' : 'whimper'); }
    if (this.aimedT <= 0 && this.stateT > 1.2) { this.faceYaw = null; if (this.fear > 0.25) this.fleeNow(); else this.setState('recover', 1); }
  }
  st_hurt(dt) {
    if (!this.anim.done) return;
    this.anim.play(LOCO, { fade: 0.35 });
    if (this.rnd() < 0.5) { const c = this.findCover(this.threat); if (c) { this.setState('flee'); this.go(c.x, c.z, this.pace('run'), 'cower'); return; } }
    this.fleeNow();
  }
  st_down(dt) {
    if (this.phase === 0) { if (this.anim.done) { this.phase = 1; this.timer = (this.wound && WORSE[this.wound.part] > 2 ? 2.5 : 0.8) + this.rnd() * 2.5; this.crouch = 1; } }
    else if (this.phase === 1) { this.timer -= dt; if (this.timer <= 0) { this.phase = 2; this.anim.play(this.downFace === 'down' ? 'get_up_face_down' : 'get_up_face_up', { fade: 0.25 }); } }
    else if (this.anim.done) { this.crouch = 0; this.anim.play(LOCO, { fade: 0.3 }); this.fleeNow(); }
  }
  st_recover(dt) {
    if (this.phase === 0) { this.phase = 1; this.anim.play('look_around', { fade: 0.6 }); this.timer += 3 + this.rnd() * 4; this.relief = 1; if (this.stress > 0.3 && this.rnd() < 0.5) this.M.voice.say(this, 'sigh'); }
    this.timer -= dt; if (this.timer <= 0) { this.anim.play(LOCO, { fade: 0.5 }); this.threat = null; this.setState('idle', 0.5); }
  }

  // ---- every frame (or every few, far off): moving, and the pose ---------------------------------------------------------------
  move(dt) {
    const M = this.M, P = M.places, G = this.G;
    let wx = 0, wz = 0, want = 0;
    if (this.rising && this.anim.done) { this.rising = false; this.anim.play(LOCO, { fade: 0.25 }); this.env.noLock = false; }
    if (this.goal && !this.arrived && this.path) {
      const path = this.path;
      while (this.pathI < path.length - 1 && hyp(path[this.pathI].x - this.pos.x, path[this.pathI].z - this.pos.z) < 0.7 &&
        P.nav.walkableWide(this.pos.x, this.pos.z, path[this.pathI + 1].x, path[this.pathI + 1].z, RADIUS)) this.pathI++;
      const p = path[this.pathI], dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = hyp(dx, dz), last = this.pathI === path.length - 1;
      if (last && d < 0.22) { this.arrived = true; this.path = null; if (this.then && this.then !== this.state && this['st_' + this.then]) this.setState(this.then, this.then === 'idle' ? 0.5 + this.rnd() * 2 : 0); }
      else { let left = d; for (let i = this.pathI; i < path.length - 1 && left < 4; i++) left += hyp(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z); wx = dx / d; wz = dz / d; want = this.rising ? 0 : Math.min(this.wishSpeed, Math.sqrt(2 * 2.4 * Math.max(0.02, left - 0.1))); }
    }
    // people in the way: ease round them (and make room for anyone with a rifle)
    let px = 0, pz = 0;
    for (const o of M.bodies) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - (o.bx ?? o.pos.x), dz = this.pos.z - (o.bz ?? o.pos.z), d2 = dx * dx + dz * dz; if (d2 > 2.6 || Math.abs(o.pos.y - this.pos.y) > 1) continue;
      const d = Math.sqrt(d2) || 0.01, reach = o.isCivilian ? SPACING : 0.78;
      if (d < reach) { const k = (reach - d) * (o.isCivilian ? 0.5 : 1); px += dx / d * k; pz += dz / d * k; }
      else if (want > 0.3 && d < 1.5) { const ahead = -(dx * wx + dz * wz) / d; if (ahead > 0.5) { const side = -wx * dz + wz * dx >= 0 ? 1 : -1, k = 0.6 * (1.5 - d); wx += wz * side * k; wz += -wx * side * k; } }      // someone ahead: a step to the side away from them
    }
    const wl = hyp(wx, wz); if (wl > 1e-3) { wx /= wl; wz /= wl; }
    // pace: push off and pull up like a person
    const accel = this.fear > 0.5 ? 5.5 : 2.6, tvx = wx * want, tvz = wz * want, ex = tvx - this.vel.x, ez = tvz - this.vel.z, el = hyp(ex, ez), cap = (want < this.speed ? 4.2 : accel) * dt;
    if (el > cap) { this.vel.x += ex / el * cap; this.vel.z += ez / el * cap; } else { this.vel.x = tvx; this.vel.z = tvz; }
    this.speed = hyp(this.vel.x, this.vel.z);
    const ox = this.pos.x, oz = this.pos.z;
    const settle = this.settle, k = settle ? 1 - Math.exp(-7 * dt) : 0;
    const dx = this.vel.x * dt + clamp(px, -0.3, 0.3) + (settle ? (settle.x - ox) * k : 0);
    const dz = this.vel.z * dt + clamp(pz, -0.3, 0.3) + (settle ? (settle.z - oz) * k : 0);
    const steps = Math.max(1, Math.ceil(hyp(dx, dz) / 0.08));
    for (let i = 0; i < steps; i++) {
      this.pos.x += dx / steps; this.pos.z += dz / steps;
      const near = P.near(this.pos.x, this.pos.z);
      resolveXZ(this.pos, RADIUS, this.height, near.filter(b => P.rails.has(b)), 0);
      resolveXZ(this.pos, RADIUS, this.height, near.filter(b => !P.rails.has(b)), STRIDE_STEP);
      this.pos.y = P.ground(this.pos.x, this.pos.z, this.pos.y);
    }
    this.moved = hyp(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
    // facing: the way they go, or what they have turned to
    let turn = 0;
    if (this.speed > 0.25) { const want_ = Math.atan2(this.vel.x, this.vel.z), e = angDiff(this.yaw, want_), rate = lerp(4.2, 7, clamp(this.speed / 4, 0, 1)); turn = clamp(e, -rate * dt, rate * dt); }
    else if (this.faceYaw != null) { const e = angDiff(this.yaw, this.faceYaw); turn = clamp(e, -2.6 * dt, 2.6 * dt); if (Math.abs(e) < 0.02) turn = e; }
    this.yaw += turn; this.bodyYaw = this.yaw; this.turnRate = damp(this.turnRate || 0, turn / Math.max(dt, 1e-4), 8, dt);
    this.crouch = damp(this.crouch, this.crouching || this.state === 'down' ? 1 : this.state === 'sit' && this.phase > 0 ? 0.45 : 0, 6, dt);
    const sitting = this.state === 'sit' && this.phase > 0 && this.seat;
    this.bx = sitting && this.seatAt ? this.seatAt.x : this.pos.x; this.bz = sitting && this.seatAt ? this.seatAt.z : this.pos.z;
  }

  pose(dt, detail) {
    const A = this.anim, E = this.env, G = this.G, M = this.M, s = this.state, T = this.temper;
    E.x = this.pos.x; E.y = this.pos.y; E.z = this.pos.z; E.yaw = this.yaw; E.moving = this.speed > 0.3; E.plantFeet = s === 'surrender' && !E.moving;
    const Wd = this.wound, wp = Wd ? Wd.part : '';
    A.setGait(this.moved ?? this.speed, dt, wp === 'leg' || wp === 'stomach' || wp === 'body' ? 'walk_slouch' : this.style);
    A.limp.side = wp === 'leg' ? Wd.side : A.limp.side; A.limp.k = damp(A.limp.k, wp === 'leg' ? 1 : 0, 3, dt);
    // the seat's own height, as they settle onto it
    let seated = 0;
    if (s === 'sit' && this.seat && this.phase > 0) { seated = this.phase === 1 ? clamp(A.main.t / A.main.clip.dur, 0, 1) : this.phase === 3 ? 1 - clamp(A.main.t / A.main.clip.dur, 0, 1) : 1; A.hipsY = (SEAT_TOP + HIP_OVER_SEAT - SIT_HIP * A.scale) * seated; } else A.hipsY = damp(A.hipsY, 0, 8, dt);
    A.bagLap = seated > 0.6 ? 1 : 0;
    // the body's own acting on top of the clips
    const panic = clamp((this.fear - 0.62) / 0.3, 0, 1), afraid = clamp(this.fear / 0.6, 0, 1);
    const ease = (p, l, r, k = 5) => { p.L = damp(p.L, l, k, dt); p.R = damp(p.R, r, k, dt); };
    const up = s === 'surrender' ? 1 : 0, cov = s === 'cower' && this.phase > 0 ? clamp(this.fear * 1.6 + this.crying, 0, 1) : 0, guard = s === 'freeze' ? 0.8 : A.duck > 0.5 && !up && !cov ? A.duck * 0.9 : 0;
    // (a bag in the left hand: that hand comes up only to the chest, palm out, with the bag hanging clear below it)
    const bag = this.hasBag ? 1 : 0, low = Math.max(up, guard) * bag;
    // The standing capsule fits closer to a wall than the wide surrender pose.
    const tight = up && resolveXZ(t1.copy(this.pos), 0.76, this.height + 0.2, M.places.near(this.pos.x, this.pos.z), STRIDE_STEP);
    ease(A.pose.handsUp, up * (1 - bag) * !tight, up * !tight, 8);
    ease(A.pose.handsTucked, up * (1 - bag) * !!tight, up * !!tight, 12); ease(A.pose.cover, cov * (1 - bag), cov, 4); ease(A.pose.guard, guard * (1 - bag), guard, 9); ease(A.pose.plead, low, 0, 6);
    ease(A.pose.carry, bag && !low && seated < 0.3 ? (cov ? 0.3 : 0.72) : 0, 0, 5);
    // the wound: a hand goes to the place and stays there (the other hand, for an arm; not down to a shin unless they are
    // crouched over it), a wounded arm is held in against the body, a belly is held with the other arm as well
    const tend = Wd && !up && !cov && s !== 'hurt' && s !== 'down' ? 1 : 0, reach = tend && Wd.hand && Wd.bone >= 0 && !(Wd.part === 'leg' && Wd.low && A.duck < 0.4) ? 1 : 0;
    for (const sd of ['L', 'R']) { const rc = A.reach[sd]; if (reach && Wd.hand === sd) { rc.bone = Wd.bone; rc.local.copy(Wd.local); rc.normal.copy(Wd.normal); rc.on = 1; } else rc.on = 0; }
    const held = sd => tend && ((wp === 'arm' && Wd.side === sd) || (wp === 'body' && Wd.side === sd) || ((wp === 'stomach' || wp === 'chest') && Wd.hand !== sd && !(sd === 'L' && bag) && (wp === 'stomach' || !Wd.hand))) ? 1 : 0;
    ease(A.pose.clutch, held('L'), held('R'), 5);
    A.duck = Math.max(s === 'cower' && this.phase > 0 ? 0.55 + this.fear * 0.3 : s === 'flee' ? 0.25 * afraid : 0, A.duck - dt * 1.6);
    A.lean.fwd = damp(A.lean.fwd, clamp(this.speed - 2.2, 0, 2.5) * 0.09 + (wp === 'stomach' ? 0.34 : wp === 'body' ? 0.22 : wp === 'chest' ? 0.16 : wp === 'leg' ? 0.08 : 0) * (s === 'hurt' || s === 'down' ? 0 : 1), 5, dt);
    A.lean.side = damp(A.lean.side, clamp((this.turnRate || 0) * this.speed * 0.035, -0.22, 0.22), 6, dt);
    this.exert = Math.max(0, this.exert - dt * 0.035);
    const air = Math.max(this.exert, panic * 0.8, afraid * 0.5, this.crying * 0.6);
    A.breath.rate = damp(A.breath.rate, lerp(0.24, 1.05, air), 2, dt); A.breath.depth = damp(A.breath.depth, lerp(1, 3.4, air), 2, dt);
    // where they look: at whoever has their attention, else the way they are going, with a glance round now and then
    const L = A.look; let ly = 0, lp = 0, ey = 0, ep = 0;
    this.lookT -= dt; if (this.lookT <= 0) this.lookAt = null;
    let tgt = this.lookAt;
    if (!tgt && (s === 'surrender' || s === 'freeze') && this.aimer?.alive) tgt = this.aimer;
    if (!tgt && this.threat && (s === 'alert' || s === 'peek' || s === 'freeze')) { t3.set(this.threat.x, this.pos.y + 1.5, this.threat.z); tgt = t3; }
    if (tgt) {
      const p = tgt.isVector3 ? tgt : t3.set(tgt.pos.x, tgt === G.player ? G.R.camera.position.y : tgt.eyeY ?? tgt.pos.y + 1.6, tgt.pos.z);
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = hyp(dx, dz);
      const rel = angDiff(this.yaw, Math.atan2(dx, dz)), pit = Math.atan2(p.y - this.eyeY, Math.max(d, 0.3));
      ly = clamp(rel, -1.25, 1.25); lp = clamp(pit, -0.5, 0.5); ey = clamp(rel - L.yaw, -0.5, 0.5); ep = clamp(pit - L.pitch, -0.3, 0.3);
    } else if (s === 'browse' && this.phase > 0) lp = -0.32;
    else if (A.clip === 'texting' || A.over?.id === 'texting') { lp = -0.42; ep = -0.2; }
    else if (this.calm || s === 'leave' || s === 'flee') {
      this.glanceT -= dt;
      if (this.glanceT <= 0) { const wary = this.alert > 0.4; this.glanceT = wary ? 0.7 + this.rnd() * 1.6 : 2 + this.rnd() * 5; this.glance = this.rnd() < (wary ? 0.8 : 0.45) ? (this.rnd() - 0.5) * (wary ? 2.2 : 1.3) : 0; if (s === 'flee' && this.rnd() < 0.5 && this.threat) this.glance = clamp(angDiff(this.yaw, Math.atan2(this.threat.x - this.pos.x, this.threat.z - this.pos.z)), -1.3, 1.3); }
      ly = this.glance || 0; ey = clamp(ly - L.yaw, -0.45, 0.45);
    }
    const lk = tgt ? 5 : 3; L.yaw = damp(L.yaw, ly, lk, dt); L.pitch = damp(L.pitch, lp, lk, dt);
    L.w = damp(L.w, A.clip === 'look_around' || A.clip === 'knockdown' || A.clip === 'get_up_face_up' ? 0.25 : 1, 5, dt);
    A.update(dt); A.apply(E, dt, detail);
    if (detail === 0) {
      const m = this.face.mood, f = this.face, k = 5;
      const set = (n, v) => { m[n] = damp(m[n], v, k, dt); };
      const hurt = this.pain;
      set('panic', panic * (1 - hurt * 0.6) * (s === 'cower' ? 0.55 : 1)); set('fear', afraid * (1 - panic * 0.7) * (1 - hurt * 0.5)); set('pain', hurt);
      set('cry', this.crying * (1 - panic * 0.5)); set('relief', this.relief * (1 - afraid)); set('wary', this.alert * (1 - afraid) * 0.8);
      set('happy', this.calm ? this.joy * (1 - this.stress) : 0); set('effort', this.exert * (1 - panic) * 0.8);
      this.joy = Math.max(0.08, this.joy - dt * 0.05);
      f.update(dt, { stress: Math.max(this.stress, afraid), eyeYaw: ey, eyePitch: ep });
    }
    // footfalls
    const fL = A.feet.L.lock || (detail > 0 && A.cadence > 0 && A.phase < 0.5), fR = A.feet.R.lock || (detail > 0 && A.cadence > 0 && A.phase >= 0.5);
    if (this.speed > 0.5 && this.dist < 32) { if (fL && !this.stepWas[0]) M.voice.step(this); if (fR && !this.stepWas[1]) M.voice.step(this); }
    this.stepWas[0] = fL; this.stepWas[1] = fR;
    // breath that can be heard: out of puff, or frightened
    if (air > 0.45 && this.dist < 14 && !this.face.speaking) { this.breathT -= dt; if (this.breathT <= 0) { this.breathT = 1 / Math.max(0.4, A.breath.rate) * (0.9 + this.rnd() * 0.2); M.voice.breath(this, air); } }
  }
}

// ---- the population ------------------------------------------------------------------------------------------------------------
export class Civilians {
  constructor(G, pack) {
    this.G = G; this.places = new Places(G); this.voice = new CivVoice(G); this.rnd = rng(8080);
    this.stats = { hit: 0, killed: 0, byPlayer: 0 };
    this.list = pack.people.map((p, i) => new Civilian(this, p, i));              // (how many were loaded is the preset's choice: main.js)
    for (const c of this.list) G.rigid.addPusher(c);
    this.queue = []; this.frame = 0; this.frustum = new THREE.Frustum(); this.pm = new THREE.Matrix4(); this.sphere = new THREE.Sphere(V(), 1.25);
    this.armed = []; this.bodies = []; this.aims = new Map(); this.order = [...this.list]; this.on = true;
    this.unarmed = false;                                                          // (captures: the player is a camera, not a man with a rifle)
  }
  get casualties() { return this.stats.killed; }
  // The textures of a few people who between them have every kind of material, so the boot's shader warm-up meets them all.
  async prewarm() {
    const seen = new Set(), pick = [];
    for (const c of this.list) { const kinds = c.person.groups.map(g => g.kind); if (pick.length < 2 || kinds.some(k => !seen.has(k))) { pick.push(c); kinds.forEach(k => seen.add(k)); } if (pick.length >= 5) break; }
    await Promise.all(pick.map(c => c.person.loadNear(this.G.R)));
    this.warmSet = pick;
  }
  warm(on) {
    for (const c of this.list) {
      const I = c.inst; c.root.visible = on; c.shown = -2;
      if (on) { const mats = c.person.nearMats; I.near.forEach((m, k) => { m.visible = !!mats; if (mats) m.material = mats[k]; }); I.far.forEach(m => { m.visible = true; }); c.root.position.set(c.idx * 0.4, -30, 0); }
      else { I.near.forEach(m => { m.visible = false; }); I.far.forEach(m => { m.visible = false; }); }
    }
  }
  // Off the streets (the self-test's staged checks want them empty), or back.
  park(off) { this.on = !off; if (off) for (const c of this.list) { c.alive = false; c.root.visible = false; c.shown = -2; if (c.state !== 'dead') c.state = 'idle'; } }
  reset() {
    if (!this.on) return;
    const P = this.places, R = this.rnd, used = [];
    this.stats = { hit: 0, killed: 0, byPlayer: 0 }; this.queue.length = 0;
    for (const s of P.seats) s.by = null; for (const s of P.shops) s.by = null;
    for (const c of this.list) {
      let p = null;
      for (let k = 0; k < 40 && !p; k++) { const q = P.stroll[(R() * P.stroll.length) | 0]; if (Math.abs(q.z) < 50 && !used.some(u => hyp(u.x - q.x, u.z - q.z) < 3)) p = q; }
      p ||= P.stroll[(R() * P.stroll.length) | 0]; used.push(p);
      c.spawn(p.x, p.z, R() * 6.283);
    }
    this.voice.reset();
  }
  askPath(c) { if (!this.queue.includes(c)) this.queue.push(c); }
  aimOf(a) {
    let o = this.aims.get(a); if (!o) this.aims.set(a, o = { yaw: 0, pitch: 0, up: false });
    return o;
  }
  // Two people with nothing better to do, near enough to walk over to each other.
  partner(c) {
    let best = null, bd = 30;
    for (const o of this.list) { if (o === c || !o.alive || o.conv || !(o.state === 'idle' || o.state === 'walk' || o.state === 'stand') || o.stress > 0.3) continue; const d = hyp(o.pos.x - c.pos.x, o.pos.z - c.pos.z); if (d < bd && this.places.nav.walkable(c.pos.x, c.pos.z, o.pos.x, o.pos.z)) { bd = d; best = o; } }
    return best && c.rnd() < 0.35 + best.temper.social * 0.6 ? best : null;
  }
  talk(a, b) {
    const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2, dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = hyp(dx, dz) || 1, gap = 0.64;      // (1.3 m apart: hands that talk do not reach the other)
    const conv = { a, b, phase: 0, line: 0, gap: 0, left: 0, speaker: null };
    for (const [c, s] of [[a, -1], [b, 1]]) { c.release(); c.anim.play(LOCO, { fade: 0.4 }); c.anim.playUpper(null); c.conv = conv; c.setState('chat'); c.go(mx + dx / d * gap * s, mz + dz / d * gap * s, c.pace('walk'), 'chat'); }
  }
  endTalk(conv) {
    for (const c of [conv.a, conv.b]) { if (c.conv !== conv) continue; c.conv = null; c.faceYaw = null; c.lookAt = null; if (c.state === 'chat') { c.stop(); c.anim.play(LOCO, { fade: 0.5 }); c.setState('idle', 0.5 + c.rnd() * 1.5); } }
  }

  // ---- what the fight sends them -------------------------------------------------------------------------------------------------
  // A round fired from `o` along `d`, stopping at `end`.
  shot(o, d, end, shooter) {
    if (!this.on) return;
    const cols = this.places.cols;
    for (const c of this.list) {
      if (!c.alive) continue;
      const dx = c.pos.x - o.x, dz = c.pos.z - o.z, dist = hyp(dx, dz); if (dist > 120) continue;
      // how near the round passes the head
      t1.set(c.pos.x - o.x, c.eyeY - o.y, c.pos.z - o.z); const along = clamp(t1.dot(d), 0, o.distanceTo(end)), miss = t1.addScaledVector(d, -along).length();
      const hitD = hyp(c.pos.x - end.x, c.pos.z - end.z);
      let k = clamp(1 - dist / 95, 0, 1) ** 1.5 * 0.62, kind = 'shot', seen = false;
      if (dist < 45 && (c.idx + this.frame) % 3 === 0) { seen = losClear(c.eye(t2), t3.set(o.x, o.y, o.z), cols); if (seen) k = Math.max(k, clamp(1 - dist / 60, 0.2, 0.8)); else k *= 0.75; }
      if (miss < 2.2 && along > 1) { k = Math.max(k, clamp(1.15 - miss / 2.4, 0.5, 1)); kind = 'near'; }      // a round going past their head
      else if (hitD < 4.5) { k = Math.max(k, clamp(0.95 - hitD / 6, 0.35, 0.85)); kind = 'near'; }
      c.scare(k, kind === 'near' && hitD < 4.5 && miss > 2.2 ? end.x : o.x, kind === 'near' && hitD < 4.5 && miss > 2.2 ? end.z : o.z, kind, seen);
    }
  }
  blast(p) {
    if (!this.on) return;
    for (const c of this.list) {
      if (!c.alive) continue;
      const d = hyp(c.pos.x - p.x, c.pos.z - p.z); if (d > 110) continue;
      c.scare(clamp(1.15 - d / 70, 0.25, 1), p.x, p.z, d < 30 ? 'blast' : 'shot', d < 25);
      if (d < 9 && c.alive && c.state !== 'hurt' && c.state !== 'down' && losClear(t1.set(p.x, p.y + 0.4, p.z), c.eye(t2), this.places.cols)) {      // near enough to be thrown down by it
        if (d < 5.5 || c.rnd() < 0.5) { c.release(); c.stop(); c.env.noLock = false; c.anim.playUpper(null); c.anim.play(c.rnd() < 0.5 ? 'knockdown' : 'stumble_recover', { fade: 0.08 }); c.setState(c.anim.clip === 'knockdown' ? 'down' : 'hurt'); }
      }
    }
  }
  // A grenade has landed and can be seen: those close by do not wait for it.
  grenade(p) { for (const c of this.list) { if (!c.alive) continue; const d = hyp(c.pos.x - p.x, c.pos.z - p.z); if (d < 9 && losClear(c.eye(t1), t2.set(p.x, p.y + 0.15, p.z), this.places.cols)) c.scare(clamp(1 - d / 12, 0.4, 0.9), p.x, p.z, 'near', true); } }
  // Someone cried out: those who hear it catch some of the fear.
  heard(who, k, range) { for (const c of this.list) { if (c === who || !c.alive) continue; const d = hyp(c.pos.x - who.pos.x, c.pos.z - who.pos.z); if (d < range) c.scare(k * (1 - d / range), who.threat?.x ?? who.pos.x, who.threat?.z ?? who.pos.z, 'voice'); } }
  // Someone was hit or went down: those who see it.
  witness(who, k, range, what) {
    for (const c of this.list) {
      if (c === who || !c.alive) continue; const d = hyp(c.pos.x - who.pos.x, c.pos.z - who.pos.z); if (d > range) continue;
      if (!losClear(c.eye(t1), t2.set(who.pos.x, who.pos.y + 1, who.pos.z), this.places.cols)) continue;
      c.scare(k * (1.1 - d / range), who.threat?.x ?? who.pos.x, who.threat?.z ?? who.pos.z, 'near', true);
      if (what === 'down' && c.rnd() < 0.5 * (1.2 - c.temper.calm) && c.screamT <= 0) c.cry('scream');
    }
  }

  update(dt) {
    if (!this.on) return;
    const G = this.G, R = G.R, cam = R.camera, list = this.list; this.frame++;
    // who is armed, and where each rifle points
    const armed = this.armed; armed.length = 0; if (!this.unarmed) armed.push(G.player); for (const b of G.bots.list) armed.push(b);
    const pa = this.aimOf(G.player); cam.getWorldDirection(t1); pa.yaw = Math.atan2(t1.x, t1.z); pa.pitch = Math.asin(clamp(t1.y, -1, 1)); pa.up = G.player.alive && !G.throw?.sel;
    for (const b of G.bots.list) { const o = this.aimOf(b); o.yaw = b.yaw; o.pitch = b.pitch; o.up = b.alive && (b.state === 'combat' || b.aim > 0.4); }
    const bodies = this.bodies; bodies.length = 0; bodies.push(G.player); for (const b of G.bots.list) bodies.push(b); for (const c of list) bodies.push(c);
    // paths: one or two a frame
    for (let k = 0; k < 2 && this.queue.length; k++) {
      const c = this.queue.shift(); if (!c.goal || !c.alive) continue;
      const path = this.places.nav.path(c.pos.x, c.pos.z, c.goal.x, c.goal.z, c.lane);
      if (path && c.state === 'flee' && c.threat) {                                // nobody runs past the muzzle to get away from it: another way, or down where they are
        const th = c.threat, d0 = hyp(th.x - c.pos.x, th.z - c.pos.z); let x = c.pos.x, z = c.pos.z, left = 7, worst = d0;
        for (const p of path) { const l = hyp(p.x - x, p.z - z), k = l > left ? left / l : 1; x += (p.x - x) * k; z += (p.z - z) * k; worst = Math.min(worst, hyp(th.x - x, th.z - z)); left -= l * k; if (left <= 0) break; }
        if (d0 < 22 && worst < d0 - 1.2 && worst < 9) { c.tries = (c.tries || 0) + 1; if (c.tries < 4) c.fleeNow(); else { c.tries = 0; c.stop(); c.setState('cower'); } continue; }
        c.tries = 0;
      }
      if (path) { c.path = path; c.pathI = 0; } else { c.stop(); if (c.calm) c.setState('idle', 1); else if (c.state === 'flee') c.setState('cower'); }
    }
    // how each is drawn: by distance, the nearest few in full
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm);
    const cp = cam.position, order = this.order;
    for (const c of list) c.dist = hyp(c.pos.x - cp.x, c.pos.y + 1 - cp.y, c.pos.z - cp.z);
    order.sort((a, b) => a.dist - b.dist);
    let near = 0, mid = 0;
    for (const c of order) {
      this.sphere.center.set(c.pos.x, c.pos.y + 0.9, c.pos.z); this.sphere.radius = c.dist < 30 ? 4 : 1.4;      // (near the camera a person out of view still casts a shadow into it)
      const vis = c.dist < 6 || this.frustum.intersectsSphere(this.sphere);
      let tier = c.dist < TIER_NEAR * (c.tier === 0 ? 1.15 : 1) && near < NEAR_MAX && vis ? 0 : c.dist < TIER_MID * (c.tier <= 1 ? 1.1 : 1) ? 1 : c.dist < TIER_FAR * (c.tier <= 2 ? 1.1 : 1) ? 2 : 3;
      if (c.dist < 15 && !c.person.nearLoading) c.person.loadNear(R);
      if (tier === 0 && !c.person.nearMats) tier = 1;
      if (tier === 0) near++;
      c.tier = tier; c.visible = vis;
      const crowded = tier === 1 && vis && ++mid > MID_MAX;                          // (still posed every frame; drawn a level lighter)
      const show = !vis ? -2 : tier === 0 ? -1 : crowded ? 1 : tier - 1;
      if (show !== c.shown) {
        const I = c.inst; c.shown = show; c.root.visible = vis;
        if (show === -1) { const mats = c.person.nearMats; I.near.forEach((m, k) => { m.material = mats[k]; m.visible = true; }); } else I.near.forEach(m => { m.visible = false; });
        I.far.forEach((m, k) => { m.visible = k === show; m.castShadow = k < 2; });
      }
    }
    // each in turn
    for (const c of list) {
      for (const st of c.stains) if (st.t < 12) { st.t += dt; c.person.woundU.value[st.slot].w = lerp(st.r0, st.r1, 1 - (1 - Math.min(1, st.t / 12)) ** 2.2); }      // blood soaking outwards through the cloth
      if (c.state === 'dead') { this.dead(c, dt); continue; }
      c.stateT += dt; c.thinkT -= dt;
      if (c.thinkT <= 0) { const step = c.calm && c.dist > 40 ? 0.4 : 0.2; c.think(step); c.thinkT += step; if (c.thinkT < -1) c.thinkT = 0; }
      // far off, a pose every second or fourth frame (time adds up in between); out of view, none
      c.accDt += dt;
      const every = c.tier <= 1 ? 1 : c.tier === 2 ? 2 : 4;
      if ((this.frame + c.animSkip) % every !== 0) continue;
      const step = Math.min(c.accDt, 0.12); c.accDt = 0;
      c.move(step);
      c.root.position.copy(c.pos); c.root.rotation.y = c.yaw;
      if (c.visible || this.forceNear) c.pose(step, this.forceNear ? 1 : c.tier === 0 ? 0 : c.tier === 1 ? 1 : 2); else { c.anim.setGait(c.speed, step, c.style); c.anim.update(step); }      // (forceNear: the clipping audit poses everyone as within 22 m)
    }
    // Someone with nowhere to go (against a wall, in a corner, on a chair) cannot be walked into: the player is held
    // off them, so the camera never ends up inside a body.
    const Pl = G.player;
    if (Pl.alive && !this.unarmed) for (const c of list) {
      if (!c.alive || Math.abs(c.pos.y - Pl.pos.y) > 1.1) continue;
      const dx = Pl.pos.x - c.bx, dz = Pl.pos.z - c.bz, d = hyp(dx, dz); if (d >= 0.55 || d < 1e-3) continue;
      Pl.pos.x += dx / d * (0.55 - d); Pl.pos.z += dz / d * (0.55 - d); resolveXZ(Pl.pos, 0.3, 1.7, this.places.near(Pl.pos.x, Pl.pos.z));
    }
  }
  // The parts of a fallen body that the ragdoll does not carry (hands, fingers, feet; what was in the hands). Left alone they
  // would keep doing whatever they were doing at the instant of death: a hand still raised at the wrist, fingers spread,
  // a bag standing out from the hand. They go slack instead: hands and feet to how they hang in a quiet stand, the phone
  // dropped, the bag hanging from the hand by its own weight and lying over once it meets the ground.
  limpOf(c) {
    const loc = c.anim.localsOf('idle', 0), P = c.person, list = [];
    P.boneNames.forEach((n, i) => { if (/Hand|Foot|ToeBase/.test(n)) list.push([c.inst.bones[i], loc[i]]); });
    const phone = P.bone.Phone != null ? c.inst.bones[P.bone.Phone] : null; if (phone) phone.scale.setScalar(1e-3);
    return { list, t: 0, bag: P.bone.BagL != null ? c.inst.bones[P.bone.BagL] : null, lie: 0, hx: Math.sin(c.yaw + 1.57), hz: Math.cos(c.yaw + 1.57) };
  }
  limpen(c, dt) {
    const L = c.limp; L.t += dt;
    if (L.t < 1.6) { const k = 1 - Math.exp(-7 * dt); for (const [bone, q] of L.list) bone.quaternion.slerp(q, k); }
    if (L.bag && c.visible) {
      const hand = L.bag.parent; hand.updateWorldMatrix(true, false);
      const hp = t1.setFromMatrixPosition(hand.matrixWorld), cx = c.rag ? c.rag.centre(t2) : t2.copy(c.pos), dx = hp.x - cx.x, dz = hp.z - cx.z, d = hyp(dx, dz) || 1;
      const h = hp.y - this.places.ground(hp.x, hp.z, hp.y + 0.3) - 0.03, k = 1 - Math.exp(-6 * dt);
      L.hx += (dx / d - L.hx) * k * 0.5; L.hz += (dz / d - L.hz) * k * 0.5; const hl = hyp(L.hx, L.hz) || 1, hx = L.hx / hl, hz = L.hz / hl;
      L.lie += (Math.acos(clamp(h / BAG_LEN, 0, 1)) - L.lie) * k;                           // how far over it has to lie for its foot to be on the ground
      const cs = Math.cos(L.lie), sn = Math.sin(L.lie);
      // its length from the hand downwards and outwards, its flat side to the ground as it comes to lie
      s4.makeBasis(t3.set(hx * cs, sn, hz * cs), s1.set(hx * sn, -cs, hz * sn), s2.set(hx * cs, sn, hz * cs).cross(s1));
      L.bag.quaternion.setFromRotationMatrix(s4).premultiply(sq.setFromRotationMatrix(hand.matrixWorld).invert());
    }
  }
  // The fallen: thrown down as a ragdoll (the soldiers' own, rigid.js), left where they come to rest, and after a while,
  // once nobody is looking, someone new walks in from the edge of the district.
  dead(c, dt) {
    const G = this.G; c.stateT += dt;
    if (c.fall) {                                                                 // near enough to matter, the body is thrown down by physics; far off, Ara's own fall plays
      if (c.dist < 90) {
        c.root.visible = true; c.root.updateMatrixWorld(true);
        c.ragTone = c.fall.zone === 'head' ? 0.25 : 0.8 + c.rnd() * 0.3; c.ragPush = 0.45;           // (shot in the head, nothing holds the body up for an instant; a round moves a body very little)
        c.rag = G.rigid.ragdoll(c, c.fall.dir, c.fall.zone, c.fall.launch || 0); c.limp = this.limpOf(c);
      }
      else { c.anim.playUpper(null); c.anim.play(c.rnd() < 0.5 ? 'death_forward' : 'death_backward', { fade: 0.12 }); c.dying = 2.4; c.env.noLock = true; }
      c.fall = null; c.crouch = 1;
    }
    if (c.dying > 0) { c.dying -= dt; c.anim.setGait(0, dt); c.anim.update(dt); if (c.visible) c.anim.apply(c.env, dt, 2); }
    if (c.limp) this.limpen(c, dt);
    if (c.rag && c.rag.t > 7 && c.rag.speed() < 0.08) { G.rigid.endRagdoll(c.rag, false); c.rag = null; c.limp = null; }
    if (c.visible && c.tier === 0) { const m = c.face.mood; for (const k in m) m[k] = damp(m[k], 0, 3, dt); c.face.update(dt, {}); c.inst.face[0] = c.inst.face[1] = Math.min(0.8, c.stateT * 0.5); c.inst.face[11] = 0.18; }
    if (c.stateT > 75 && (!c.visible || c.dist > 70)) {
      const P = this.places; let best = null, bd = 0;
      for (let k = 0; k < 20; k++) { const q = P.stroll[(this.rnd() * P.stroll.length) | 0], d = hyp(q.x - G.R.camera.position.x, q.z - G.R.camera.position.z); if (d > bd) { bd = d; best = q; } }
      if (best && bd > 45) c.spawn(best.x, best.z, this.rnd() * 6.283);
    }
  }
}
