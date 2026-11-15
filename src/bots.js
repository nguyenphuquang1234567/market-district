// AI combatants: rigged soldier with an IK rifle hold, grid navigation, sight/hearing-limited perception, cover use.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assets } from './assets.js';
import { BOT_MAG_IN, BOT_MAG_OUT, BOT_RELOAD_DURATION, MUZZLE, gunMaterials, worldGunMesh } from './weapon.js';
import { poseBotRifle, setUpBotRifle } from './bot-rifle.js';
import { STEP, STRIDE_STEP, resolveXZ, groundAt, rayBoxes, losClear } from './physics.js';
import { rng, clamp, lerp, damp, smooth, angDiff } from './util.js';
import { CONTACT, STRAFE_STRIDE, BACK_STRIDE, bakeDirectionalGaits, applyDirectionalGait, directionBlend } from './soldier-gait.js';
import { QUARTER_HOTSPOTS } from './quarter.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BODY_RADIUS = 0.39;
const BODY_SPACING = 0.78;
const UP = V(0, 1, 0);
// What a person carrying a rifle and kit can do. Speeds in m/s, accelerations in m/s², turn rates in rad/s.
const START = 3.3, START_FAST = 1.5;        // pushing off from rest, tapering as the pace approaches a run
const BRAKE = 2.8, BRAKE_MAX = 4.6;         // planned slowing into a corner or a halt; the hardest stop when surprised
const GRIP = 3.8;                           // sideways acceleration held through a bend
const PIVOT = 3.1;                          // turning on the spot
const SIDE_MAX = 1.9, BACK_MAX = 1.75;      // sidestep and back-pedal pace with the rifle up
const SHUFFLE = 5.2, SHUFFLE_STOP = 6.4;    // quick changes of direction over a pace or two while fighting
const WALK_TO_RUN = 2.3, RUN_TO_WALK = 1.9;
// Sole points measured on the Vanguard rig, in the foot bone's local centimetres: under the heel, under the ball of
// the foot (the toe joint), and the toe cap. The cap bends with the toe joint, so its height comes from that bone.
const HEEL = V(0, -2, 13.3), BALL = V(0, 15.8, 12.7), TOE = V(0, 24, 12.4), TOE_END = V(1.22, 7.97, -0.04), CAP_SOLE = 0.019;
const TIP_UP = 4, TIP_DOWN = 5;             // rad/s: how fast a planted boot's heel may be raised over its toe, and set down again
const footPos = V(), kneePos = V(), legBase = V(), legAxis = V(), heelPos = V(), toePos = V(), ballPos = V(), capPos = V(), soleProbe = V();
const footQuat = new THREE.Quaternion(), footParent = new THREE.Quaternion(), hingeWant = V();
const KNEE_FOLLOWS_BOOT = 0.7;
// rad: how far a shin may lean over the toes of its boot, and over to either side, before the boot gives; and how far
// a boot may be turned out of line with its knee
const DORSI_MAX = 0.8, ROLL_MAX = 0.52, ANKLE_TURN_MAX = 0.4, FOOT_LENGTH = V(0, 1, 0), FOOT_DOWN = V(0, 0, 1), shinUp = V(), ballSole = V();
// Compass heading of a boot's side-to-side axis: where it is turned to, whatever its pitch.
function lateralYaw(q) { soleProbe.copy(HINGE).applyQuaternion(q); return Math.atan2(soleProbe.x, soleProbe.z); }
const NAMES = [['Idris', 'Tarek', 'Sami', 'Nour'], ['Kader', 'Viper', 'Rook', 'Anvil', 'Dagger']];
const DIFF = { easy: { react: 0.6, err: 1.7, dmg: 0.8 }, normal: { react: 0.36, err: 1.0, dmg: 1 }, hard: { react: 0.22, err: 0.68, dmg: 1.15 } };
const HOTSPOTS = [[0, -40], [0, -22], [0, -4], [0, 8], [0, 22], [0, 40], [-12, -2], [-11, 9], [-12, -12], [28.5, -40], [28.5, -20], [28.5, 0], [28.5, 20], [28.5, 40], [-29, -40], [-29, -20], [-29, 0], [-29, 20], [-29, 40], [-16, -20], [16, -20], [-16, 20], [16, 20], [-22, -1]];
export { CARRY } from './bot-rifle.js';
const t1 = V(), t2 = V(), t3 = V(), t4 = V(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();

const pa = V(), pb = V(), pc = V(), elbow = V(), dirv = V(), perp = V();
// A knee is a hinge: on this rig it turns about the local X axis of thigh and shin alike (and the boot's X lies along
// the same line). Turn `bone` (about its own origin) so that its length points along `along` and that axis along
// `hinge`: both in world space, unit length, at right angles.
const HINGE = V(1, 0, 0), boneLength = V(), boneSide = V(), boneFront = V(), hingeAxis = V(), thighDir = V(), shinDir = V();
const ownBasis = new THREE.Matrix4(), worldBasis = new THREE.Matrix4();
function setHinged(bone, child, along, hinge) {
  boneLength.copy(child.position).normalize();                                         // where the bone's length lies in its own frame
  boneSide.copy(HINGE).addScaledVector(boneLength, -boneLength.x).normalize();
  ownBasis.makeBasis(boneSide, boneLength, boneFront.crossVectors(boneSide, boneLength));
  worldBasis.makeBasis(hinge, along, boneFront.crossVectors(hinge, along));
  bone.parent.getWorldQuaternion(q3);
  bone.quaternion.copy(q3.invert()).multiply(q1.setFromRotationMatrix(worldBasis)).multiply(q2.setFromRotationMatrix(ownBasis).invert());
  bone.updateWorldMatrix(false, true);
}
// Two-bone leg. `pole` is the way the knee points. Thigh and shin are both set outright, each with its hinge axis
// square to the plane the leg bends in, so the knee only ever folds the way a knee does: turning the bones by the
// shortest way round instead leaves the thigh facing wherever the clip had it, and a knee asked to point anywhere
// else folds sideways or backwards across its own joint.
// `soft` is the last fraction of the limb's reach over which it eases to straight instead of locking: without it a
// knee near full extension snaps through many degrees for a centimetre of extra reach.
function ik2(a, b, c, target, pole, soft = 0) {
  a.getWorldPosition(pa); b.getWorldPosition(pb); c.getWorldPosition(pc);
  const lab = pa.distanceTo(pb), lcb = pb.distanceTo(pc), full = lab + lcb;
  let reach = pa.distanceTo(target);
  if (soft > 0 && reach > full * (1 - soft)) { const start = full * (1 - soft), room = full - start; reach = start + room * (1 - Math.exp(-(reach - start) / room)); }
  const lat = clamp(reach, 0.02, full - 0.004);
  dirv.subVectors(target, pa).normalize();
  const cosA = clamp((lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  perp.copy(pole).addScaledVector(dirv, -pole.dot(dirv)).normalize();
  hingeAxis.crossVectors(perp, dirv);
  thighDir.copy(dirv).multiplyScalar(cosA).addScaledVector(perp, sinA);
  setHinged(a, b, thighDir, hingeAxis);
  elbow.copy(pa).addScaledVector(thighDir, lab);
  shinDir.copy(pa).addScaledVector(dirv, lat).sub(elbow).normalize();
  setHinged(b, c, shinDir, hingeAxis);
}

// t for which smooth(t) = y
function inverseSmooth(y) { return 0.5 - Math.sin(Math.asin(1 - 2 * clamp(y, 0, 1)) / 3); }

function segmentDistance(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 1e-8 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
}

// Find the heel strike and the flat-foot part of the stride. The ankle slows during toe-off.
function calibrate(bot) {
  const out = {}, foot = bot.b.lft, p = V(), N = 80;
  bot.root.position.set(0, 0, 0); bot.root.rotation.set(0, 0, 0);
  bot.mixer.update(0); bot.root.updateMatrixWorld(true);
  out.flatFoot = [bot.b.lft, bot.b.rft].map((bone, i) => {
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    p.set(0, 1, 0).applyQuaternion(q);
    const toeOut = i === 0 ? 0.16 : -0.16;
    return q.premultiply(q1.setFromAxisAngle(UP, angDiff(Math.atan2(p.x, p.z), Math.PI + toeOut)));
  });
  for (const name of ['walk', 'run']) {
    const act = bot.act[name], dur = act.getClip().duration, ankle = [], heel = [], toe = [];
    for (const a of Object.values(bot.act)) a.setEffectiveWeight(a === act ? 1 : 0);
    for (let k = 0; k < N; k++) {
      act.time = k / N * dur;
      bot.mixer.update(0); bot.root.updateMatrixWorld(true);
      ankle.push(foot.getWorldPosition(p).z);
      heel.push(foot.localToWorld(p.copy(HEEL)).y);
      toe.push(foot.localToWorld(p.copy(TOE)).y);
    }
    const floor = Math.min(...heel);
    const planted = (k, y) => y <= floor + 0.03 && ankle[(k + 1) % N] > ankle[k];
    const contact = heel.map((y, k) => planted(k, y));
    let start = 0, length = 0;
    for (let k = 0; k < N; k++) {
      if (!contact[k] || contact[(k + N - 1) % N]) continue;
      let count = 1;
      while (count < N && contact[(k + count) % N]) count++;
      if (count > length) { start = k; length = count; }
    }
    const speeds = [];
    for (let i = 0; i < length; i++) {
      const k = (start + i) % N;
      if (Math.abs(heel[k] - toe[k]) < 0.03) speeds.push((ankle[(k + 1) % N] - ankle[k]) * N / dur);
    }
    speeds.sort((a, b) => a - b);
    const v = speeds[Math.floor(speeds.length / 2)] ?? (name === 'walk' ? 1.6 : 4.2);
    while (length < N && planted((start + length) % N, toe[(start + length) % N])) length++;
    // The pose the stride swings about: where the pelvis sits and how pelvis and chest are turned, averaged over a cycle.
    const b = bot.b, hipPos = V(), hipQ = new THREE.Quaternion(0, 0, 0, 0), chestQ = new THREE.Quaternion(0, 0, 0, 0), q = new THREE.Quaternion();
    let hipLow = Infinity;
    const gather = (sum, add) => { const sign = sum.x * add.x + sum.y * add.y + sum.z * add.z + sum.w * add.w < 0 ? -1 : 1; sum.x += add.x * sign; sum.y += add.y * sign; sum.z += add.z * sign; sum.w += add.w * sign; };
    for (let k = 0; k < N; k++) {
      act.time = k / N * dur; bot.mixer.update(0);
      hipPos.addScaledVector(b.hips.position, 1 / N); gather(hipQ, b.hips.quaternion); hipLow = Math.min(hipLow, b.hips.position.z);
      gather(chestQ, q.copy(b.hips.quaternion).multiply(b.spine.quaternion).multiply(b.spine1.quaternion).multiply(b.spine2.quaternion));
    }
    out[name] = { dur, off: start / N, contact: clamp(length / N, 0.25, 0.60), v, hipPos, hipLow, hipQ: hipQ.normalize(), chestQ: chestQ.normalize() };
  }
  for (const a of Object.values(bot.act)) a.setEffectiveWeight(a === bot.act.idle ? 1 : 0);
  console.info(`gait: walk ${out.walk.v.toFixed(2)} m/s over ${out.walk.dur.toFixed(2)} s, run ${out.run.v.toFixed(2)} m/s over ${out.run.dur.toFixed(2)} s`);
  return out;
}

class Bot {
  constructor(G, team, idx, shared) {
    this.G = G; this.team = team; this.idx = idx; this.name = NAMES[team][idx % NAMES[team].length]; this.isPlayer = false;
    this.rnd = rng(1000 + team * 100 + idx * 7); this.qrnd = rng(5000 + team * 100 + idx * 7);
    // No two people move alike: each soldier has a preferred pace and a taste in routes.
    const temper = rng(77 + team * 31 + idx * 13);
    this.pace = { walk: 1.5 + temper() * 0.32, jog: 3.25 + temper() * 0.45, run: 4.55 + temper() * 0.5, sway: temper() * 6.28, caution: temper() };
    this.lanes = G.world.nav.bias(900 + team * 50 + idx * 11);
    this.pos = V(0, 0, 0); this.vel = V(); this.wishVec = V(); this.hipSway = V();
    this.footAnim = [{ p: V(), q: new THREE.Quaternion() }, { p: V(), q: new THREE.Quaternion() }];
    this.footGoal = [{ p: V(), q: new THREE.Quaternion(), bend: 0 }, { p: V(), q: new THREE.Quaternion(), bend: 0 }];
    this.footEase = [{ p: V(), q: new THREE.Quaternion(), live: false }, { p: V(), q: new THREE.Quaternion(), live: false }];
    this.ankle = [{ heel: 0, roll: 0, toe: null, toeWas: new THREE.Quaternion() }, { heel: 0, roll: 0, toe: null, toeWas: new THREE.Quaternion() }];
    this.yaw = 0; this.pitch = 0; this.health = 100; this.alive = false; this.crouch = 0; this.crouching = false;
    this.root = new THREE.Group(); G.R.scene.add(this.root);
    const model = this.model = cloneSkinned(assets.soldier.scene); this.root.add(model);
    const tint = team === 0 ? new THREE.Color(0.22, 0.48, 0.79) : new THREE.Color(0.92, 0.56, 0.41);
    tint.offsetHSL(0, 0, (this.rnd() - 0.5) * 0.08);
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      o.material = o.material.clone();
      if (!/visor/i.test(o.name)) {
        o.material.color.copy(tint);
        if (team === 0) o.material.map = assets.soldier.allyMap;
      }
      o.material.roughness = 0.85; o.material.metalness = 0;
    });
    const bone = n => model.getObjectByName('mixamorig' + n);
    this.b = { hips: bone('Hips'), spine: bone('Spine'), spine1: bone('Spine1'), spine2: bone('Spine2'), head: bone('Head'), neck: bone('Neck'),
      ra: bone('RightArm'), rf: bone('RightForeArm'), rh: bone('RightHand'), la: bone('LeftArm'), lf: bone('LeftForeArm'), lh: bone('LeftHand'),
      rul: bone('RightUpLeg'), rl: bone('RightLeg'), rft: bone('RightFoot'), lul: bone('LeftUpLeg'), ll: bone('LeftLeg'), lft: bone('LeftFoot'),
      ltoe: bone('LeftToeBase'), rtoe: bone('RightToeBase') };
    this.legLength = (this.b.ll.position.length() + this.b.lft.position.length()) * 0.01;      // hip joint to ankle, straight
    this.gun = worldGunMesh(shared.gunMats); G.R.scene.add(this.gun);
    setUpBotRifle(this);
    this.mixer = new THREE.AnimationMixer(model);
    const clip = n => THREE.AnimationClip.findByName(assets.soldier.animations, n);
    this.act = { idle: this.mixer.clipAction(clip('Idle')), walk: this.mixer.clipAction(clip('Walk')), run: this.mixer.clipAction(clip('Run')) };
    for (const a of Object.values(this.act)) { a.play(); a.setEffectiveWeight(0); }
    this.act.idle.setEffectiveWeight(1); this.mixer.update(this.rnd() * 2);
    G.R.setupTree(this.root); G.R.setupTree(this.gun);
    for (const a of [this.act.walk, this.act.run]) a.setEffectiveTimeScale(0);       // their time is set from the stride phase
    this.aim = 0; this.speedAnim = 0; this.root.visible = false; this.gun.visible = false;
    this.deadT = 0; this.respawnT = 0.5 + idx * 0.35; this.kills = 0; this.deaths = 0; this.rag = null; this.dropped = null; this.fall = null;
    this.resetBody();
    this.resetBrain();
  }

  resetBody() {
    this.bodyYaw = this.yaw; this.yawVel = 0; this.back = false; this.turning = 0; this.phase = this.rnd(); this.leanF = 0; this.leanS = 0; this.pvx = 0; this.pvz = 0;
    this.headYaw = 0; this.lookGoal = 0; this.lookT = 0; this.pathCap = 9; this.holdT = 0;
    this.wantYaw = this.yaw; this.wantPitch = 0; this.wishDir = null; this.wishSpeed = 0;
    this.heading = this.yaw; this.headingRate = 0; this.speed = 0; this.push = 0; this.dash = false; this.pathLeft = 0; this.leadYaw = this.yaw; this.farYaw = this.yaw; this.steerErr = 0;
    this.speedAnim = 0; this.travelYaw = this.yaw; this.turnRate = 0; this.gunRaise = 0; this.gunBlocked = false; this.rifleKick = 0;
    this.runGait = 0; this.running = false; this.gaitT = 0; this.restT = 0; this.bumps = 0; this.grindT = 0; this.settleT = 0; this.squeezeT = 0; this.dodgeT = 0; this.dodgeSide = 1; this.sideOpen = [0, 0]; this.probeT = this.rnd() * 0.4;
    this.plants = [null, null]; this.releasedPlants = [null, null];
    for (const a of this.ankle) { a.heel = a.roll = 0; a.toe = null; }
    this.footGround = [this.pos.y, this.pos.y]; this.footAim = [this.pos.y, this.pos.y]; this.floorY = this.pos.y; this.rise = this.pos.y; this.stockY = null; this.hipDrop = 0; this.hipGive = 0; this.low = false; this.upT = 0; this.crouchRate = 0; this.crouchT = 0; this.bodyRate = 0; this.stepRound = false; this.moveW = 0; this.pivotW = 0; this.footEase[0].live = this.footEase[1].live = false; this.cadence = 0; this.drift = 0; this.warp = 0; this.motionAngle = 0; this.wishYaw = null; this.atRest = false; this.leadFoot = this.rnd() < 0.5 ? 0 : 1;
    this.gaitBlend = { left: 0, right: 0, back: 0 };
    this.nearby = [];
  }
  resetBrain() {
    this.state = 'advance'; this.target = null; this.seen = new Map(); this.lastKnown = null; this.lostT = 0; this.path = null; this.pathI = 0; this.goal = null;
    this.think = this.rnd() * 0.2; this.ammo = 30; this.reloadT = 0; this.burst = 0; this.burstCool = 0.4; this.fireCool = 0; this.engageT = 0; this.cover = null; this.peek = null; this.coverT = 0; this.atPeek = false;
    this.strafeT = 0; this.lookYaw = null; this.stuckT = 0; this.flinch = 0; this.hurtT = 9; this.reported = 0; this.searchT = 0;
    this.onPath = false; this.haltT = 0; this.halting = false; this.scanT = 0; this.scanSide = this.rnd() < 0.5 ? -1 : 1; this.scanBase = null; this.offPathT = 0;
    this.evade = null; this.dazed = 0;
  }

  spawn(sp) {
    this.pos.set(sp.x, groundAt(sp.x, sp.z, 0, BODY_RADIUS, this.G.world.colliders, STRIDE_STEP).y, sp.z);
    this.yaw = sp.yaw; this.pitch = 0; this.health = 100; this.alive = true; this.vel.set(0, 0, 0); this.crouch = 0; this.aim = 0; this.crouching = false;
    this.root.visible = true; this.gun.visible = true; this.model.quaternion.identity(); this.model.position.set(0, 0, 0);
    this.resetBrain(); this.resetBody(); this.mixer.timeScale = 1;
    // The mixer writes a bone only when the clips' answer for it differs from the frame before. On a frame in which
    // no time passes (this one) it would write nothing, and the soldier would stand at the spawn point for a frame
    // with his trunk as the last life left it. Restarting the actions makes it lay the whole pose down afresh.
    const idleAt = this.act.idle.time;
    for (const a of Object.values(this.act)) a.stop();                              // (all of them first: the bones are let go only when no action holds them)
    for (const a of Object.values(this.act)) a.play();
    this.act.idle.time = idleAt;
    this.place(this.pos.x, this.pos.z, this.G.world.colliders);                       // clear of anything beside the spawn point before the first visible frame
    this.prevX = this.pos.x; this.prevZ = this.pos.z; this.moveIntent = 0;
    this.animate(0, 0, this.G.world.colliders);
  }

  get eyeY() { return this.pos.y + lerp(1.6, 1.05, this.crouch); }
  get height() { return lerp(1.78, 1.2, this.crouch); }
  eye(out) { return out.set(this.pos.x, this.eyeY, this.pos.z); }

  damage(amount, from, attacker, zone) {
    if (!this.alive) return false;
    this.health -= amount; this.flinch = 1; this.hurtT = 0;
    if (attacker && attacker.alive && attacker.team !== this.team) { this.noticed(attacker, 1); if (this.state !== 'combat') this.lookYaw = Math.atan2(from.x - this.pos.x, from.z - this.pos.z); }
    if (this.health <= 0) {
      this.alive = false; this.deadT = 0; this.respawnT = 4.5 + this.rnd() * 1.5; this.deaths++;
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z, l = Math.hypot(dx, dz) || 1;
      if (zone === 'blast') {                                                        // thrown off the feet, away from the burst and a little up
        const dy = this.pos.y + 1.0 - (from.y ?? 0), l3 = Math.hypot(dx, dy, dz) || 1;
        this.fall = { dir: V(dx / l3, dy / l3 + 0.45, dz / l3).normalize(), zone: 'body', launch: clamp(amount / 100, 0.35, 1.5) * 2.4 };
      } else this.fall = { dir: V(dx / l, -0.08, dz / l), zone };                    // the ragdoll takes over on the next update
      this.G.onKill(attacker, this, zone === 'head', zone);
      return true;
    }
    return false;
  }

  noticed(e, amount) { const s = this.seen.get(e) || { t: 0, vis: false }; s.t = Math.max(s.t, amount); this.seen.set(e, s); }

  // ---- perception: field of view, range, occlusion and a detection delay ------------------------------------------------
  perceive(dt, actors, cols) {
    const D = DIFF[this.G.settings.difficulty] || DIFF.normal, eye = this.eye(t1).clone();
    let best = null, bestD = 1e9;
    for (const e of actors) {
      if (e.team === this.team || !e.alive) { this.seen.delete(e); continue; }
      const s = this.seen.get(e) || { t: 0, vis: false };
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      let vis = false;
      if (d < 95) {
        const ang = Math.abs(angDiff(this.yaw + this.headYaw, Math.atan2(dx, dz)));      // they see where the head is turned
        if (ang < 1.05 || d < 2.2 || s.t >= 1) {
          const ey = e.eyeY - 0.12;
          vis = losClear(eye, t2.set(e.pos.x, ey, e.pos.z), cols) || losClear(eye, t2.set(e.pos.x, e.pos.y + (ey - e.pos.y) * 0.55, e.pos.z), cols);
          if (vis && d > 2.5 && this.G.throw.smoked(eye, t2.set(e.pos.x, e.pos.y + (ey - e.pos.y) * 0.75, e.pos.z))) { vis = false; s.smoke = this.G.time; }      // smoke between them
        }
      }
      if (vis) {
        const rate = (1 / D.react) * clamp(1.6 - d / 60, 0.45, 1.6) * (e.crouching ? 0.75 : 1) * (e.vel.lengthSq() > 4 ? 1.3 : 1) * (1 - 0.55 * Math.min(1, this.dazed));
        s.t = Math.min(1.5, s.t + dt * rate);
        if (s.t >= 1) { s.pos = e.pos.clone(); s.when = this.G.time; }
      } else s.t = Math.max(s.pos ? 1 : 0, s.t - dt * 0.25);
      s.vis = vis && s.t >= 1; this.seen.set(e, s);
      if (s.vis && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  setGoal(x, z, run = false) {
    const nav = this.G.world.nav;
    if (!nav.free(x, z)) ({ x, z } = nav.center(nav.nearestFree(x, z), t3));
    t4.set(x, 0, z);
    if (resolveXZ(t4, BODY_RADIUS + 0.14, 1.78, this.G.world.colliders, STRIDE_STEP)) { x = t4.x; z = t4.z; }      // a spot to stand on, not one with a shoulder in the wall
    this.goal = { x, z }; this.runTo = run; this.pathI = 0; this.offPathT = 0;
    const path = this.path = nav.path(this.pos.x, this.pos.z, x, z, this.lanes);
    this.pathFrom = { x: this.pos.x, z: this.pos.z };
    if (!path) return;
    for (let i = 0; i < path.length - 1; i++) {                                         // where the route squeezes past something, walk the middle of the gap, not its edge
      t4.set(path[i].x, 0, path[i].z);
      if (resolveXZ(t4, BODY_RADIUS + 0.27, 1.78, this.G.world.colliders, STRIDE_STEP)) { path[i].x = t4.x; path[i].z = t4.z; }
    }
    for (let i = path.length - 1, left = 0; i >= 0; i--) {                              // distance still to go from each point, for braking
      path[i].left = left;
      if (i > 0) left += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    }
  }
  pickAdvanceGoal() {
    const B = this.G.bots, R = this.rnd, rep = B.reports[this.team].filter(r => this.G.time - r.when < 9);
    this.haltT = 0;
    if (rep.length && R() < 0.7) { const r = rep[rep.length - 1]; this.setGoal(r.pos.x + (R() - 0.5) * 6, r.pos.z + (R() - 0.5) * 6, true); return; }
    const dirZ = this.team === 0 ? 1 : -1, hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    let best = null, bs = -1e9;
    // (the market quarter's spots draw their dice from a stream of their own, so each soldier's own stream, and with it
    // everything he does in the old district, runs as it did before the quarter was built)
    for (const [list, roll] of [[HOTSPOTS, R], [QUARTER_HOTSPOTS, this.qrnd]]) for (const h of list) {
      const dx = h[0] - this.pos.x, dz = h[1] - this.pos.z, d = Math.hypot(dx, dz);
      // towards the other side of the district, not the spot just left, and rarely straight back the way they came
      const sc = dz * dirZ * 0.04 + roll() * 2.2 - Math.abs(dx) * 0.012 - (d < 8 ? 3 : 0) + (d > 1 ? (dx * hx + dz * hz) / d * 0.45 : 0);
      if (sc > bs) { bs = sc; best = h; }
    }
    if (R() < 0.4) this.haltT = 1.3 + R() * 2.6;                                        // some places are worth a look round; most are walked through
    this.setGoal(best[0] + (R() - 0.5) * 3, best[1] + (R() - 0.5) * 3, false);
  }
  // Stopped with nothing in sight: check one way, then the other, holding each look for a moment.
  lookAround(dt, reach) {
    if (this.scanBase == null) { this.scanBase = this.yaw; this.scanT = 0.25 + this.rnd() * 0.45; }
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.9 + this.rnd() * 1.2; this.scanSide = -this.scanSide;
    this.lookYaw = this.scanBase + this.scanSide * reach * (0.45 + this.rnd() * 0.55);
  }
  // Own end of the district, with the fighting still some way off.
  inRear() { return this.pos.z * (this.team === 0 ? 1 : -1) < -22 - this.pace.caution * 10; }

  findCover(threat, cols) {
    const nav = this.G.world.nav; let best = null, bs = 1e9;
    for (let i = 0; i < 46; i++) {
      const x = this.pos.x + (this.rnd() - 0.5) * 22, z = this.pos.z + (this.rnd() - 0.5) * 22, ci = nav.idx(x, z);
      if (nav.blocked[ci] || !nav.cover[ci]) continue;
      nav.center(ci, t3);
      if (losClear(t1.set(threat.x, threat.y + 1.5, threat.z), t2.set(t3.x, 1.0, t3.z), cols)) continue;
      const sc = Math.hypot(t3.x - this.pos.x, t3.z - this.pos.z) + (Math.hypot(t3.x - threat.x, t3.z - threat.z) < 7 ? 20 : 0) + (this.G.bots.coverTaken(ci, this) ? 30 : 0);
      if (sc < bs) { bs = sc; best = { x: t3.x, z: t3.z, ci }; }
    }
    if (!best) return null;
    // a spot next to the cover from which the threat is visible (stand up or lean out)
    best.peek = null;
    if (losClear(t1.set(threat.x, threat.y + 1.5, threat.z), t2.set(best.x, 1.6, best.z), cols)) best.peek = { x: best.x, z: best.z, stand: true };
    else for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const px = best.x + dx, pz = best.z + dz;
      if (!nav.free(px, pz)) continue;
      if (losClear(t1.set(threat.x, threat.y + 1.5, threat.z), t2.set(px, 1.5, pz), cols)) { best.peek = { x: px, z: pz, stand: false }; break; }
    }
    return best;
  }

  // A live grenade: behind the nearest thing that will stop fragments if that is not past the grenade itself, else
  // straight away from it as far as the fuze allows.
  runFrom(ev, cols) {
    const nav = this.G.world.nav, mine = Math.hypot(this.pos.x - ev.x, this.pos.z - ev.z);
    let c = this.findCover({ x: ev.x, y: ev.y - 1.3, z: ev.z }, cols);
    if (c && Math.hypot(c.x - ev.x, c.z - ev.z) < Math.max(3.5, mine + 0.5)) c = null;                      // not if it means running past the thing
    if (c && (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > 2 + ev.t * 3.2 || losClear(t1.set(ev.x, ev.y + 0.2, ev.z), t2.set(c.x, 0.4, c.z), cols))) c = null;      // nor if it cannot be reached in time, or would not hide a crouching man
    if (!c) {
      const base = Math.atan2(this.pos.x - ev.x, this.pos.z - ev.z);
      find: for (const dist of [11, 8, 5]) for (const da of [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5]) {
        const gx = this.pos.x + Math.sin(base + da) * dist, gz = this.pos.z + Math.cos(base + da) * dist;
        if (nav.free(gx, gz) && nav.walkable(this.pos.x, this.pos.z, gx, gz)) { c = { x: gx, z: gz }; break find; }
      }
    }
    this.cover = null; this.halting = false; this.lookYaw = null; this.strafeGoal = null; this.burst = 0;
    if (c) this.setGoal(c.x, c.z, true);
  }

  // ---- decisions --------------------------------------------------------------------------------------------------------
  brain(dt, actors, cols) {
    const G = this.G, D = DIFF[G.settings.difficulty] || DIFF.normal, R = this.rnd;
    const vis = this.perceive(dt, actors, cols);
    this.hurtT += dt; this.dazed = Math.max(0, this.dazed - dt);
    const ev = this.evade;
    if (ev) {
      ev.t -= dt;
      if (ev.wait > 0) { ev.wait -= dt; if (ev.wait <= 0) this.runFrom(ev, cols); }      // the moment it takes to understand what just landed
      if (ev.wait <= 0) {
        if (ev.t > 0) {
          const there = !this.path || this.pathI >= this.path.length;                  // out of reach or behind something: get down and face away
          this.state = 'evade'; this.crouching = there; this.onPath = !there; this.wishDir = null; this.wishSpeed = there ? 0 : this.pace.run + 0.9; this.wantPitch = 0;
          this.wantYaw = there ? Math.atan2(this.pos.x - ev.x, this.pos.z - ev.z) : null;
          return;
        }
        this.evade = null; this.crouching = false; this.cover = null; this.lookYaw = Math.atan2(ev.fx - this.pos.x, ev.fz - this.pos.z);
        this.state = 'search'; this.searchT = 4 + R() * 3; this.setGoal(ev.fx + (R() - 0.5) * 9, ev.fz + (R() - 0.5) * 9, false);      // then: where did that come from
      }
    }
    const smoked = this.target && (this.seen.get(this.target)?.smoke ?? -9) > G.time - 0.35;      // lost him behind smoke, not behind a wall
    if (vis) {
      if (this.target !== vis) { this.target = vis; this.engageT = 0; }
      if (this.state !== 'combat') { this.state = 'combat'; this.cover = null; this.strafeT = 0; this.burstCool = 0.15 + R() * 0.3; }
      this.lastKnown = vis.pos.clone(); this.lostT = 0;
      this.reported += dt; if (this.reported > 1.2) { this.reported = 0; G.bots.report(this.team, vis.pos, this, vis); }
    } else if (this.state === 'combat') {
      this.lostT += dt;
      if (this.lostT > (smoked ? 2.6 : 1.3) && this.reloadT <= 0) {
        this.state = 'search'; this.searchT = 6 + R() * 3; this.cover = null; this.crouching = false;
        if (this.lastKnown && smoked) {                                                // nobody walks into a smoke screen: work round one side of it
          const lx = this.lastKnown.x - this.pos.x, lz = this.lastKnown.z - this.pos.z, ll = Math.hypot(lx, lz) || 1, side = R() < 0.5 ? -1 : 1;
          this.setGoal(this.lastKnown.x - lz / ll * side * 7, this.lastKnown.z + lx / ll * side * 7, true);
        } else if (this.lastKnown) this.setGoal(this.lastKnown.x + (R() - 0.5) * 3, this.lastKnown.z + (R() - 0.5) * 3, R() < 0.5);
      }
    }

    let wish = null, speed = 0, onPath = false;
    if (this.state === 'combat') {
      const tg = this.target, aimAt = vis ? tg.pos : this.lastKnown;
      this.engageT += dt;
      if (aimAt) { this.wantYaw = Math.atan2(aimAt.x - this.pos.x, aimAt.z - this.pos.z); const d = Math.hypot(aimAt.x - this.pos.x, aimAt.z - this.pos.z); this.wantPitch = Math.atan2((vis ? tg.eyeY - 0.3 : 1.2) - this.eyeY, d); this.tDist = d; }
      // choose whether to fight from cover
      const needCover = this.health < 55 || this.reloadT > 0 || this.hurtT < 1.2 || this.tDist > 14;
      if (!this.cover && needCover && this.coverT <= 0 && aimAt) { this.cover = this.findCover(aimAt, cols); this.coverT = 2.5; this.atPeek = false; this.peekT = 0.6 + R(); if (this.cover) this.setGoal(this.cover.x, this.cover.z, true); }
      this.coverT -= dt;
      if (this.cover) {
        const c = this.cover, atCover = Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 0.7;
        this.peekT -= dt;
        if (!this.atPeek) {
          if (atCover) { this.crouching = true; if (this.peekT <= 0 && this.reloadT <= 0 && c.peek) { this.atPeek = true; this.peekT = 1.2 + R() * 1.3; } }
          else { onPath = true; speed = this.pace.run + 0.45; }
        } else {
          if (c.peek.stand) this.crouching = false; else { this.crouching = false; t1.set(c.peek.x - this.pos.x, 0, c.peek.z - this.pos.z); if (t1.length() > 0.25) { wish = t1.normalize().clone(); speed = 1.7; } }
          if (this.peekT <= 0 || this.reloadT > 0) { this.atPeek = false; this.peekT = 1.2 + R() * 1.8; this.setGoal(c.x, c.z, true); }
        }
        if (aimAt && Math.hypot(c.x - aimAt.x, c.z - aimAt.z) < 5) this.cover = null;                 // flanked: leave
        if (this.engageT > 14 && R() < dt * 0.25) { this.cover = null; this.engageT = 4; }              // reposition
      } else {
        // caught in the open: at range take a knee and shoot, shifting a few metres between bursts; up close keep moving
        this.strafeT -= dt; this.holdT -= dt;
        const far = this.tDist > 15;
        if (this.strafeT <= 0) {
          this.strafeT = far ? 2.6 + R() * 2.4 : 1.0 + R() * 1.6; this.holdT = far ? this.strafeT - (0.9 + R() * 0.5) : 0;
          const push = tg && tg.health < 45 && this.tDist > 6 ? 1 : this.tDist > 32 ? 0.8 : this.tDist < 7 ? -0.7 : 0, side = R() < 0.5 ? -1 : 1;
          const fx = Math.sin(this.wantYaw || 0), fz = Math.cos(this.wantYaw || 0), gx = this.pos.x + (fz * side) * (2 + R() * 2.5) + fx * push * 4, gz = this.pos.z + (-fx * side) * (2 + R() * 2.5) + fz * push * 4;
          this.strafeGoal = G.world.nav.free(gx, gz) && G.world.nav.walkable(this.pos.x, this.pos.z, gx, gz) ? { x: gx, z: gz } : null;
        }
        const holding = far && this.holdT > 0;
        this.crouching = holding && this.hurtT > 0.8;
        if (this.strafeGoal && !holding) { t1.set(this.strafeGoal.x - this.pos.x, 0, this.strafeGoal.z - this.pos.z); if (t1.length() > 0.4) { wish = t1.normalize().clone(); speed = far ? 2.5 : 2.1; } }
      }
      // fire control: short controlled bursts, longer suppressive ones when the target ducks out of sight
      this.burstCool -= dt; this.fireCool -= dt;
      const aimErr = Math.abs(angDiff(this.yaw, this.wantYaw || 0));
      const canShoot = this.ammo > 0 && this.reloadT <= 0 && !this.gunBlocked && aimErr < 0.14 && (vis || (this.lostT < (smoked ? 2.3 : 1.1) && this.lastKnown && !this.crouching));      // into the smoke where he was, for a little longer
      if (this.ammo <= 0 && this.reloadT <= 0) { this.reloadT = BOT_RELOAD_DURATION; this.burst = 0; }
      if (canShoot && this.burst <= 0 && this.burstCool <= 0 && this.engageT > D.react * 0.6) { this.burst = vis ? 2 + (R() * (this.tDist < 15 ? 6 : 3) | 0) : 3 + (R() * 4 | 0); }
      if (this.burst > 0 && this.fireCool <= 0 && canShoot) {
        this.fireCool = 0.088; this.burst--; this.ammo--;
        if (this.burst <= 0) this.burstCool = (vis ? 0.3 : 0.6) + R() * (this.tDist > 30 ? 0.9 : 0.5);
        G.bots.fire(this, vis ? tg : null, D);
      }
    } else {
      this.crouching = false;
      const arrived = () => !this.path || this.pathI >= this.path.length;
      if (this.state === 'search') {
        this.searchT -= dt;
        if (this.searchT <= 0 || !this.path) { this.state = 'advance'; this.goal = null; this.scanBase = null; this.lookYaw = null; }
        else if (arrived()) this.lookAround(dt, 1.35);
      }
      if (this.state === 'advance') {
        if (this.halting) {
          this.haltT -= dt; this.lookAround(dt, 1.05);
          if (this.haltT <= 0) { this.halting = false; this.scanBase = null; this.lookYaw = null; this.pickAdvanceGoal(); }
        } else if (arrived()) {
          if (this.goal && this.haltT > 0) this.halting = true; else this.pickAdvanceGoal();
        } else if (this.haltT <= 0 && this.pathLeft > 0 && this.pathLeft < 2.8) this.pickAdvanceGoal();       // nothing to stop for: carry on to the next place without breaking stride
      }
      if (!arrived() && this.pathLeft > 0 && this.pathLeft < 1.5 && this.goal && G.bots.occupied(this.goal, this)) this.pathI = this.path.length;       // someone is already standing there: stop short
      onPath = !arrived() && !this.halting;
      // Pace: move up briskly while the fighting is far off, hurry towards a reported contact and close the last stretch
      // with care, walk when anything could be round the next corner.
      const left = this.pathLeft || 99, pace = this.pace;
      if (this.state === 'search') speed = this.runTo && left > 16 ? pace.jog : pace.walk * 0.88;
      else if (this.runTo) speed = left > 17 ? pace.run : left > 8 ? pace.jog : pace.walk;
      else speed = this.inRear() && left > 8 ? pace.jog : pace.walk;
      this.wantPitch = 0;
      const looking = this.lookYaw != null && (!onPath || this.state === 'search');
      this.wantYaw = looking ? this.lookYaw : null;                                    // null: nothing in particular to face, so look where the feet are going
      if (onPath && this.state !== 'search') this.lookYaw = null;
      if (this.ammo < 12 && this.reloadT <= 0) this.reloadT = BOT_RELOAD_DURATION;
    }
    this.onPath = onPath; this.wishDir = onPath ? null : wish; this.wishSpeed = wish || onPath ? speed : 0;
  }

  // The point `dist` metres further along the route from where the soldier stands.
  ahead(dist, out) {
    const path = this.path; let x = this.pos.x, z = this.pos.z;
    for (let i = this.pathI; i < path.length; i++) {
      const p = path[i], d = Math.hypot(p.x - x, p.z - z);
      if (d >= dist && d > 1e-4) return out.set(x + (p.x - x) * dist / d, 0, z + (p.z - z) * dist / d);
      dist -= d; x = p.x; z = p.z;
    }
    return out.set(x, 0, z);
  }

  // Steers for a point a little way ahead along the route, so a corner is walked as an arc and not as a pivot on the
  // waypoint, and plans the pace: slow enough for the bends coming up and to halt at the end without stamping on the brakes.
  follow() {
    const path = this.path;
    if (!path || this.pathI >= path.length) { this.pathLeft = 0; return null; }
    const nav = this.G.world.nav, px = this.pos.x, pz = this.pos.z;
    for (;;) {                                                                         // let go of points already reached or passed
      const p = path[this.pathI], n = path[this.pathI + 1], d = Math.hypot(p.x - px, p.z - pz);
      if (!n) { if (d < 0.26) { this.pathI++; this.pathLeft = 0; return null; } break; }
      if (d >= 0.4 && !(d < 3 && segmentDistance(px, pz, p, n) < segmentDistance(px, pz, this.pathFrom, p))) break;
      this.pathFrom = p; this.pathI++;
    }
    const p = path[this.pathI], d1 = Math.hypot(p.x - px, p.z - pz);
    this.pathLeft = d1 + p.left;
    this.pathBlocked = d1 > 0.6 && !nav.walkable(px, pz, p.x, p.z);
    // Look further round the bend when there is room to: in the open a turn is a long easy curve, and only where
    // the wide line to that far point would brush something does the soldier steer close to the corner itself.
    let look = clamp(0.75 + 0.42 * this.speed, 0.9, 2.7);
    this.ahead(look * 2, t1);
    if (nav.walkableWide(px, pz, t1.x, t1.z, 0.5)) look *= 2;
    else {
      this.ahead(look, t1);
      if (d1 < look && !nav.walkableWide(px, pz, t1.x, t1.z, 0.42)) t1.set(p.x, 0, p.z);  // cutting this corner would brush it: go to the point itself
    }
    this.ahead(look * 2.2 + 1.5, t2); this.leadYaw = Math.atan2(t2.x - px, t2.z - pz);
    this.ahead(8, t2); this.farYaw = Math.atan2(t2.x - px, t2.z - pz);
    // pace plan: v² = v_corner² + 2·a·d for each bend ahead, and for the halt at the end
    let cap = Math.sqrt(2 * BRAKE * Math.max(0.015, this.pathLeft - 0.18)), dist = d1, ax = px, az = pz;
    for (let k = this.pathI; k < path.length - 1 && k < this.pathI + 4 && dist < 14; k++) {
      const b = path[k], c = path[k + 1], leg = Math.hypot(c.x - b.x, c.z - b.z);
      let turn = Math.abs(angDiff(Math.atan2(b.x - ax, b.z - az), Math.atan2(c.x - b.x, c.z - b.z)));
      turn *= clamp(leg / 2.2, 0.4, 1);                                                // a kink shorter than a stride or two is smoothed out by the look-ahead
      // The bend can be rounded by as much as there is room inside it: a curve of radius room / (sec(turn / 2) − 1),
      // taken at the pace that sideways grip allows. A street corner is tight; a change of direction in a square is not.
      const open = nav.clear[nav.idx(b.x, b.z)], room = open <= 1 ? 0.35 : open - 0.6;
      const corner = turn < 0.2 ? 9 : clamp(Math.sqrt(GRIP * room / (1 / Math.cos(Math.min(turn, 2.6) / 2) - 1)), 1.45, 9);
      cap = Math.min(cap, Math.sqrt(corner * corner + 2 * BRAKE * Math.max(0, dist - 0.7)));
      dist += leg; ax = b.x; az = b.z;
    }
    // Nobody runs through a gap or along a wall at arm's length: within a step of something solid, a walk.
    for (let d = 0; d <= 3; d++) {
      this.ahead(d, t2);
      if (nav.clear[nav.idx(t2.x, t2.z)] <= 1) { cap = Math.min(cap, Math.sqrt(1.75 * 1.75 + 2 * BRAKE * Math.max(0, d - 0.4))); break; }
    }
    this.pathCap = cap;
    t1.x -= px; t1.z -= pz; t1.y = 0;
    const len = t1.length();
    return len > 1e-4 ? this.wishVec.copy(t1).multiplyScalar(1 / len) : null;
  }

  // ---- movement + animation ------------------------------------------------------------------------------------------------
  leaveBody() {
    const Rg = this.G.rigid;
    if (this.rag) { Rg.bakeCorpse(this); Rg.endRagdoll(this.rag); this.rag = null; }
    if (this.dropped) { Rg.endGun(this.dropped); this.dropped = null; }
  }

  update(dt, actors, cols) {
    const G = this.G;
    if (!this.alive) {
      this.deadT += dt; this.respawnT -= dt;
      if (this.fall && this.root.visible) { this.rag = G.rigid.ragdoll(this, this.fall.dir, this.fall.zone, this.fall.launch || 0); this.dropped = G.rigid.dropGun(this); this.fall = null; }
      if (this.respawnT <= 0 && G.matchLive) { const sp = G.bots.pickSpawn(this.team); if (sp) { this.leaveBody(); this.spawn(sp); } }
      return;
    }
    if (this.reloadT > 0) {
      const before = BOT_RELOAD_DURATION - this.reloadT;
      this.reloadT = Math.max(0, this.reloadT - dt);
      const elapsed = BOT_RELOAD_DURATION - this.reloadT;
      if (before < BOT_MAG_OUT && elapsed >= BOT_MAG_OUT) G.bots.sound(this, 'magout');
      if (before < BOT_MAG_IN && elapsed >= BOT_MAG_IN) G.bots.sound(this, 'magin');
      if (this.reloadT === 0) this.ammo = 30;
    }
    this.think -= dt;
    if (this.think <= 0) { const step = 0.1; this.think += step; this.brain(step, actors, cols); }
    // ---- where the soldier means to go this instant, and how fast
    const combat = this.state === 'combat';
    let want = this.wishDir, cruise = this.wishSpeed;
    if (this.onPath) {
      want = this.follow();
      cruise = want ? Math.min(cruise, this.pathCap) : 0;
      this.offPathT = want && this.pathBlocked ? this.offPathT + dt : 0;
      // close enough: nobody shuffles about to stand on an exact spot
      this.settleT = want && this.pathLeft < 0.9 && this.speed < 0.3 ? this.settleT + dt : 0;
      if (this.settleT > 0.8) { this.pathI = this.path.length; this.settleT = 0; want = null; cruise = 0; }
      if (this.offPathT > 0.45 && this.goal) this.setGoal(this.goal.x, this.goal.z, this.runTo);      // shoved off the route: plan again from here
    } else { this.pathLeft = 0; this.leadYaw = this.farYaw = this.heading; }
    // Running for cover, a soldier turns and runs. With the rifle up, he side-steps and backs away instead.
    this.dash = combat && this.onPath && this.wishSpeed > 3 && this.pathLeft > (this.dash ? 1.0 : 2.4);
    const travel = !combat || this.dash;
    cruise *= (this.crouching ? 0.5 : 1) * (1 - this.flinch * 0.6);                    // a hit checks the stride
    this.squeezeT -= dt;
    if (travel && this.squeezeT > 0) cruise = Math.min(cruise, 1.75);                   // something close ahead: nobody threads a gap or rounds a post at a run
    if (travel) cruise *= 1 + 0.035 * Math.sin(G.time * 0.63 + this.pace.sway);        // nobody holds a perfectly even pace
    this.moveIntent = cruise;
    let wx = want ? want.x * cruise : 0, wz = want ? want.z * cruise : 0;
    // Anticipate nearby bodies before interpenetration: ease off and steer round them.
    for (const a of actors) {
      if (a === this || !a.alive || Math.abs(a.pos.y - this.pos.y) > 0.9) continue;
      const ax = a.pos.x - this.pos.x, az = a.pos.z - this.pos.z;
      const d = Math.hypot(ax, az);
      if (d < 0.001 || d > 7) continue;
      const nx = ax / d, nz = az / d;
      if (travel && d > 1.1) {
        // Seen coming: if the two will pass within a shoulder's width in the next second or so, drift to one side
        // early (each to the same hand, so two walkers meeting head-on part) and ease off behind a slower one.
        const rvx = this.vel.x - a.vel.x, rvz = this.vel.z - a.vel.z, rv2 = rvx * rvx + rvz * rvz;
        const when = rv2 > 0.05 ? (ax * rvx + az * rvz) / rv2 : -1;
        if (when > 0 && when < 1.7) {
          const mx = ax - rvx * when, mz = az - rvz * when, miss = Math.hypot(mx, mz);
          if (miss < 1.05) {
            const hx = Math.sin(this.heading), hz = Math.cos(this.heading), across = mx * hz - mz * hx;
            const k = (1 - miss / 1.05) * (1 - when / 1.7) * cruise * 0.85, hand = across > 0.08 ? -1 : 1;
            wx += hz * hand * k; wz += -hx * hand * k;
            if (ax * hx + az * hz > 0) { wx -= hx * k * 0.45; wz -= hz * k * 0.45; }
          }
        }
        if (d > 2.6) continue;
      } else if (d > 2.6) continue;
      const closing = (wx - a.vel.x) * nx + (wz - a.vel.z) * nz;
      const urgency = clamp((1.4 + clamp(closing * 0.23, 0, 1.1) - d) / 1.4, 0, 1);
      const forward = Math.max(0, wx * nx + wz * nz);
      const dodge = Math.min(1.7, forward * 0.66) * urgency;
      const side = want && want.x * nz - want.z * nx < -0.14 ? -1 : 1;
      const away = Math.max(0, BODY_SPACING + 0.22 - d) * 2.6 + forward * urgency;
      wx += -nx * away + nz * dodge * side;
      wz += -nz * away - nx * dodge * side;
    }
    if (travel && want) {
      // Someone in the way is walked round, not backed away from: keep the sideways part of the correction only.
      const along = wx * want.x + wz * want.z;
      if (along < 0) { wx -= want.x * along; wz -= want.z * along; }
    }
    let wishSpeed = Math.hypot(wx, wz);
    this.wishYaw = wishSpeed > 0.15 ? Math.atan2(wx, wz) : null;
    const limit = Math.max(cruise, 1.2);
    if (wishSpeed > limit) { wx *= limit / wishSpeed; wz *= limit / wishSpeed; wishSpeed = limit; }
    this.dodgeT -= dt;
    if (travel && wishSpeed > 0.3) {
      // People neither brush along walls nor walk into posts. Feel along the intended course with a slightly wider
      // body, a step ahead and again two steps ahead, and bend the course round whatever it touches. (Along the
      // intended course, not the way the body faces: a soldier turning on the spot beside a wall must not chase his
      // own correction round in circles.)
      const hx = wx / wishSpeed, hz = wz / wishSpeed, step = 0.4 + this.speed * 0.3;
      let bend = 0;
      for (let k = 1; k <= 2 && step * k < (this.onPath ? this.pathLeft + 0.15 : 99); k++) {      // no further than the place being walked to, which may be right beside a wall
        const fx = this.pos.x + hx * step * k, fz = this.pos.z + hz * step * k;
        t4.set(fx, this.floorY, fz);
        if (!resolveXZ(t4, BODY_RADIUS + 0.22, this.height, this.nearby, STRIDE_STEP)) continue;
        this.squeezeT = 0.45;
        const px = t4.x - fx, pz = t4.z - fz, back = -(px * hx + pz * hz);
        let across = px * hz - pz * hx;
        if (Math.abs(across) < back * 0.6) {
          // dead ahead: pick a side and stay with it until past
          if (this.dodgeT <= 0) this.dodgeSide = Math.abs(across) > 0.01 ? Math.sign(across) : Math.sin(this.heading) * hz - Math.cos(this.heading) * hx >= 0 ? 1 : -1;
          this.dodgeT = 0.7;
          across = this.dodgeSide * (Math.abs(across) + back * 0.9);
        }
        bend += across / k;
      }
      if (bend !== 0) {
        const k = wishSpeed * 3.2;
        wx += hz * bend * k; wz += -hx * bend * k;
        const l = Math.hypot(wx, wz); if (l > 1e-4) { wx *= wishSpeed / l; wz *= wishSpeed / l; }
      }
    }
    if (travel) {
      // Walking somewhere: the body faces the way it is going. It turns at a rate a person can hold at that speed,
      // slows for bends it cannot take, and turns before stepping off if the way lies behind it.
      let target = wishSpeed, err = 0;
      if (wishSpeed > 0.08) {
        err = angDiff(this.heading, Math.atan2(wx, wz));
        if (Math.abs(err) > 2.5 && err * this.headingRate < 0 && Math.abs(this.headingRate) > 0.25) err = -err;       // about-face: finish turning the way already begun
        const off = Math.abs(err), look = 0.75 + 0.42 * this.speed;
        target = Math.min(target, Math.sqrt(GRIP * look / (2 * Math.max(0.12, Math.sin(Math.min(off, Math.PI / 2))))));
        if (off > 1.05) target = Math.min(target, lerp(1.3, 0, clamp((off - 1.05) / 0.85, 0, 1)));
      } else if (!combat && this.speed < 0.3 && this.wantYaw != null) {
        // standing: once the shoulders have turned as far as is comfortable, the feet shuffle round after them
        const off = angDiff(this.heading, this.wantYaw);
        if (Math.abs(off) > (this.turning > 0 ? 0.1 : 0.62)) { err = off; this.turning = 0.3; }
      }
      this.steerErr = err;
      let turn = Math.min(PIVOT, GRIP / Math.max(this.speed, 0.3));
      // Going back the way they came, people stop and turn round where they stand. Swinging round in an arc at a walk
      // would carry them into whatever is beside the path.
      if (Math.abs(err) > 1.25) turn *= clamp(1.2 - this.speed / 1.1, 0.12, 1);
      const rate = clamp(err * 5.5, -1, 1) * turn;
      this.headingRate = damp(this.headingRate, rate, 10, dt);
      this.heading += this.headingRate * dt;
      const sp = this.speed;
      const effort = target > sp ? Math.min(lerp(START, START_FAST, clamp(sp / 5.2, 0, 1)), (target - sp) * 4.5) : -Math.min(BRAKE_MAX + this.flinch * 3, (sp - target) * 5);
      this.push = damp(this.push, effort, 14, dt);                                     // effort builds over a step; it does not switch on
      this.speed = Math.max(0, sp + this.push * dt);
      if (this.speed < 0.03 && target < 0.03) { this.speed = 0; this.push = 0; }
      this.vel.x = Math.sin(this.heading) * this.speed; this.vel.z = Math.cos(this.heading) * this.speed;
    } else {
      // Rifle up: steps in any direction, but only as fast as a person can side-step or back away.
      const currentSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (wishSpeed > 0.05) {
        const rel = Math.abs(angDiff(this.yaw, Math.atan2(wx, wz)));
        const ahead = this.wishSpeed > 3 ? 9 : 1.8;                                    // advancing with the rifle up is done at a walk
        const cap = lerp(lerp(ahead, SIDE_MAX, smooth(clamp((rel - 0.45) / 0.8, 0, 1))), BACK_MAX, smooth(clamp((rel - 1.7) / 0.9, 0, 1)));
        if (wishSpeed > cap) { wx *= cap / wishSpeed; wz *= cap / wishSpeed; wishSpeed = cap; }
      }
      const dvx = wx - this.vel.x, dvz = wz - this.vel.z, dl = Math.hypot(dvx, dvz);
      const st = (wx * this.vel.x + wz * this.vel.z < currentSpeed * currentSpeed * 0.85 ? SHUFFLE_STOP + this.flinch * 3 : SHUFFLE) * dt;
      if (dl <= st) { this.vel.x = wx; this.vel.z = wz; } else { this.vel.x += dvx / dl * st; this.vel.z += dvz / dl * st; }
      this.speed = Math.hypot(this.vel.x, this.vel.z); this.push = 0; this.headingRate = 0; this.steerErr = 0;
      this.heading = this.speed > 0.3 ? Math.atan2(this.vel.x, this.vel.z) : this.bodyYaw;
    }
    this.prevX = this.pos.x; this.prevZ = this.pos.z;
    const x = this.pos.x + this.vel.x * dt, z = this.pos.z + this.vel.z * dt;
    const touched = this.place(x, z, cols);
    this.grindT = touched ? this.grindT + dt : Math.max(0, this.grindT - dt * 2);
    if (this.grindT > 0.3 && this.onPath && this.goal) { this.grindT = 0; this.setGoal(this.goal.x, this.goal.z, this.runTo); }      // pressed against something: find the way round from here
    if (touched) {
      this.bumps++;
      const mx = (this.pos.x - this.prevX) / dt, mz = (this.pos.z - this.prevZ) / dt;
      if (Math.hypot(mx, mz) < Math.min(wishSpeed + 0.1, Math.hypot(this.vel.x, this.vel.z))) {
        this.vel.x = lerp(this.vel.x, mx, 0.6); this.vel.z = lerp(this.vel.z, mz, 0.6);
        this.speed = Math.hypot(this.vel.x, this.vel.z);
        // up against something: turn to walk along it instead of leaning into it; a side-step simply ends there
        if (travel && this.speed > 0.05) this.heading += angDiff(this.heading, Math.atan2(this.vel.x, this.vel.z)) * 0.5;
        else if (!travel && !this.onPath) this.strafeGoal = null;
      }
    }
    return true;
  }

  place(x, z, cols) {
    // Use the physical floor for collision and smooth the visible body height independently.
    t4.set(x, this.floorY, z);
    const hit = resolveXZ(t4, BODY_RADIUS, this.height, cols, STRIDE_STEP);
    this.pos.x = t4.x; this.pos.z = t4.z;
    return hit;
  }

  finishMove(dt, cols) {
    const g = groundAt(this.pos.x, this.pos.z, this.floorY, BODY_RADIUS, cols, STRIDE_STEP);
    this.floorY = g.y; this.surf = g.surf;
    // The body goes up a kerb the way a person does: on its legs. It sits a little above the lower boot's footing and
    // rises as the trailing boot comes up, eased at both ends (no lurch when the centre of the body crosses the edge).
    // (Stepping down it sinks a little sooner than it rises stepping up: the standing knee has to give before the
    // other boot can reach the lower ground.)
    const low = Math.min(this.footAim[0], this.footAim[1]), high = Math.max(this.footAim[0], this.footAim[1]), level = low + (high - low) * 0.35;
    const rate = level < this.rise ? 24 : 16;
    this.rise = damp(this.rise, level, rate, dt);
    this.pos.y = damp(this.pos.y, this.rise, rate, dt);
    const mx = this.pos.x - this.prevX, mz = this.pos.z - this.prevZ;
    const moved = Math.min(Math.hypot(mx, mz) / dt, Math.hypot(this.vel.x, this.vel.z) + 0.45);
    // held up while facing the way and trying to go (turning round on the spot does not count)
    if (this.moveIntent > 1 && moved < 0.4 && Math.abs(this.steerErr) < 0.9) { this.stuckT += dt; if (this.stuckT > 0.9) { this.stuckT = 0; this.path = null; this.cover = null; this.strafeGoal = null; if (this.goal) this.setGoal(this.goal.x, this.goal.z, this.runTo); } } else this.stuckT = 0;
    const combat = this.state === 'combat', travel = !combat || this.dash, priorYaw = this.bodyYaw;
    this.turning = Math.max(0, this.turning - dt);
    if (moved > 0.25) {
      // the way the body is going; a reversal (left to right, forward to back) is taken as such, not swung round
      // through the directions in between
      const going = Math.atan2(mx, mz), swing = angDiff(this.travelYaw, going);
      if (Math.abs(swing) > 1.9) this.travelYaw = going; else this.travelYaw += swing * (1 - Math.exp(-13 * dt));
    }
    if (travel) {
      // Hips follow the feet. Shoulders and rifle turn a little further: into the bend ahead, or towards whatever has
      // the soldier's attention, as far as the spine allows at that pace.
      let watch = this.heading;
      if (this.wantYaw != null && (combat || moved < 0.3 || this.state === 'search')) watch = this.wantYaw;
      else if (moved > 0.3) watch = this.heading + clamp(angDiff(this.heading, this.leadYaw) * 0.6, -0.42, 0.42);
      const reach = lerp(1.0, 0.8, clamp(moved / 4.5, 0, 1));
      const chest = this.heading + clamp(angDiff(this.heading, watch), -reach, reach);
      const maxRate = combat ? 6.5 : 3.4;
      this.yawVel = damp(this.yawVel, clamp(angDiff(this.yaw, chest) * 8, -maxRate, maxRate), 12, dt); this.yaw += this.yawVel * dt;
      this.back = false;
      // (eased, so that coming out of a fight with the hips turned away from the route does not whip them round)
      this.bodyRate = damp(this.bodyRate, clamp(angDiff(this.bodyYaw, this.heading) * 14, -4.6, 4.6), 14, dt);
      this.bodyYaw += this.bodyRate * dt;
    } else {
      // Rifle up: the aim swings to the target on the spine; the feet come round after it at the pace a person can
      // shuffle, eased in and out, and once the spine is wound up the aim waits for them.
      if (this.wantYaw != null) { this.yawVel = damp(this.yawVel, clamp(angDiff(this.yaw, this.wantYaw) * 10, -7.5, 7.5), 16, dt); this.yaw += this.yawVel * dt; }
      let tgt = this.bodyYaw;
      if (moved > 0.55) {
        const mv = this.travelYaw, rel = Math.abs(angDiff(this.yaw, mv));
        this.back = rel > (this.back ? 1.75 : 2.05);                                   // moving away from where the rifle points: back-pedal
        tgt = this.yaw + clamp(angDiff(this.yaw, this.back ? mv + Math.PI : mv), -0.24, 0.24);
        this.stepRound = false;
      } else {
        const twist = Math.abs(angDiff(this.bodyYaw, this.yaw));
        if (twist > 0.6) this.stepRound = true; else if (twist < 0.05) this.stepRound = false;
        if (this.stepRound) tgt = this.yaw;
      }
      this.bodyRate = damp(this.bodyRate, clamp(angDiff(this.bodyYaw, tgt) * 7, -PIVOT - 0.4, PIVOT + 0.4), 11, dt);
      this.bodyYaw += this.bodyRate * dt;
    }
    const tw = angDiff(this.bodyYaw, this.yaw);
    if (Math.abs(tw) > 1.2) { this.yaw = this.bodyYaw + Math.sign(tw) * 1.2; this.yawVel *= 0.6; }      // the spine turns only so far
    this.turnRate = damp(this.turnRate, angDiff(priorYaw, this.bodyYaw) / Math.max(dt, 1e-3), 12, dt);
    this.pitch = damp(this.pitch, this.state === 'combat' ? (this.wantPitch || 0) : 0, 8, dt);
    // Going down and coming up take a moment and start and end gently, as bending the knees does.
    // A soldier who has taken a knee does not bob up the instant the target ducks out of sight and down again when
    // it reappears: he stays down until standing has been wanted for a moment, or there is somewhere to go.
    if (this.crouching) { this.low = true; this.upT = 0; }
    else if (this.low && ((this.upT += dt) > 0.7 || this.moveIntent > 1.2)) this.low = false;
    this.crouchRate = damp(this.crouchRate, (this.low ? 1 : -1) / 0.45, 11, dt);          // a change of mind half-way is eased as well
    this.crouchT = clamp(this.crouchT + this.crouchRate * dt, 0, 1);
    if ((this.crouchT === 0 && this.crouchRate < 0) || (this.crouchT === 1 && this.crouchRate > 0)) this.crouchRate = 0;
    this.crouch = smooth(this.crouchT);
    this.aim = damp(this.aim, this.state === 'combat' && this.reloadT <= 0 ? 1 : 0, 9, dt);
    this.flinch = damp(this.flinch, 0, 5, dt);
    this.animate(dt, moved, cols);
  }

  animate(dt, moved, cols) {
    const G = this.G, b = this.b, gait = G.bots.gait;
    // Lean into acceleration and into bends as a runner does; the whole figure pivots at the feet.
    const ax = (this.vel.x - this.pvx) / Math.max(dt, 1e-3), az = (this.vel.z - this.pvz) / Math.max(dt, 1e-3); this.pvx = this.vel.x; this.pvz = this.vel.z;
    const by = this.bodyYaw, bfx = Math.sin(by), bfz = Math.cos(by);
    this.leanF = damp(this.leanF, clamp((ax * bfx + az * bfz) * 0.021 + (this.vel.x * bfx + this.vel.z * bfz) * 0.011, -0.13, 0.2), 5, dt);
    // Banking into a bend belongs to running. At a walk the feet do the turning and the body stays upright.
    this.leanS = damp(this.leanS, clamp((ax * -bfz + az * bfx) * 0.03 * smooth(clamp((this.speed - 1.8) / 2.2, 0, 1)), -0.19, 0.19), 5, dt);
    this.root.position.copy(this.pos); this.root.rotation.y = by + Math.PI;            // the rig's rest pose faces -Z
    this.model.rotation.set(-this.leanF, 0, -this.leanS);
    // Keep both clips on the same stride. Turning on the spot advances it with shorter steps.
    this.speedAnim = damp(this.speedAnim, moved, 14, dt);
    const s = this.speedAnim, Wk = gait.walk, Rn = gait.run;
    // How much of the pose is stepping (as against standing) and how much of that is turning on the spot. Both ease
    // in and out over a fraction of a second: legs cannot change what they are doing between one frame and the next.
    this.pivotW += clamp(smooth(clamp((0.8 - s) / 0.8, 0, 1)) * clamp(Math.abs(this.turnRate) / 2.6, 0, 1) - this.pivotW, -4 * dt, 5 * dt);
    const pivot = this.pivotW, moveAim = clamp(Math.max(s / 0.67, pivot * 0.82), 0, 1), settling = moveAim < this.moveW - 0.01 && pivot < 0.1;
    this.moveW += clamp(moveAim - this.moveW, -3.6 * dt, 6 * dt);
    const wMove = smooth(this.moveW);
    this.moveBlend = wMove; this.pivotBlend = pivot;                                // (read by the locomotion probe)
    this.restT = wMove < 0.05 ? this.restT + dt : 0;
    // A person either walks or runs and changes from one to the other within a step or two; nobody cruises half-way.
    // (Someone setting off to run runs from the first strides; he does not walk faster and faster first.)
    const wantRun = this.crouch < 0.5 && (s > (this.running ? RUN_TO_WALK : WALK_TO_RUN) || (this.moveIntent > 2.7 && s > 1.15 && this.gaitBlend.left + this.gaitBlend.right + this.gaitBlend.back < 0.3));
    this.gaitT -= dt;
    if (wantRun !== this.running && (this.gaitT <= 0 || s < 0.6)) { this.running = wantRun; this.gaitT = 0.7; }       // not back and forth between the two every other stride
    this.runGait = damp(this.runGait, this.running ? 1 : 0, 7.5, dt);
    const wRun = smooth(this.runGait) * (1 - this.crouch);
    // Which way the feet are going relative to the hips: the way the body is actually moving once it is moving, the
    // way it means to go while it is still getting under way, straight ahead when it is only turning on the spot.
    if (s > 0.2) this.motionAngle = angDiff(by, this.travelYaw);
    else if (this.moveW < 0.06) this.motionAngle = this.wishYaw != null && this.state === 'combat' && !this.dash ? angDiff(by, this.wishYaw) : 0;
    const motionAngle = this.motionAngle;
    directionBlend(this.gaitBlend, motionAngle, Math.max(s, this.wishYaw != null ? 0.2 : 0), dt, this.moveW < 0.06);
    const { left, right, back } = this.gaitBlend;
    const directional = left + right + back;
    // The forward gait follows a course a little off the way the hips face. It is never turned far: past a quarter
    // turn the sideways and backward gaits are taking over, and straight back it is not turned at all (turning it
    // right round would swap the boots front to back for the frame or two before they do).
    const drift = this.drift = damp(this.drift, Math.sin(motionAngle) * 0.75 * (1 - pivot) * (1 - directional), 10, dt);     // (eased: the course can change in a frame, the legs cannot)
    // Each of those gaits can be turned a little off its own line. The correction fades out again as the direction
    // nears a quarter turn off (and is nil for a full reversal, left to right): by then another gait is taking over,
    // and this one must not be swung right round on its way out.
    const off = axis => Math.sin(2 * angDiff(axis, motionAngle)) / 2;
    const warp = this.warp = damp(this.warp, clamp(left * off(Math.PI / 2) + right * off(-Math.PI / 2) + back * off(Math.PI), -0.38, 0.38), 9, dt);
    // The walk and run clips carry only the forward share of the stepping. The sideways and backward gaits replace
    // the legs outright, over the standing clip, so starting or stopping a side-step never passes through a
    // half-blended forward stride (and the trunk above an aimed side-step is the quiet standing one).
    const ahead = wMove * (1 - directional);
    this.act.idle.setEffectiveWeight(1 - ahead); this.act.walk.setEffectiveWeight(ahead * (1 - wRun)); this.act.run.setEffectiveWeight(ahead * wRun);
    // Walking faster means longer and quicker steps in equal measure (both grow with the root of the speed).
    // Running holds nearly the same cadence from a jog to a sprint and covers the difference in stride.
    const walkStride = Wk.v * Wk.dur * clamp(Math.sqrt(s / Wk.v), 0.30, 1.06) * (1 - this.crouch * 0.32) * (1 - Math.abs(Math.sin(drift)) * 0.18);       // the legs are only so long: past the clip's own stride a walk quickens instead
    const runStride = Math.max(s, 1.6) * lerp(0.78, 0.655, clamp((s - 2.4) / 3, 0, 1));
    const stride = lerp(walkStride, runStride, wRun);
    const clipStride = lerp(Wk.v * Wk.dur, Rn.v * Rn.dur, wRun);
    const reach = stride / clipStride;
    const contact = lerp(lerp(Wk.contact, Rn.contact, wRun), CONTACT, directional);
    const cycleLength = stride * (1 - directional) + (left + right) * STRAFE_STRIDE + back * BACK_STRIDE;
    // Standing, the stride waits at the instant one boot is about to leave the ground (a different boot each time),
    // so the first step off is a step: lift, swing, plant, and not a jump into the middle of a stride.
    if (wMove < 0.03) {
      if (!this.atRest) { this.atRest = true; this.leadFoot = 1 - this.leadFoot; }
      // ...and the boot that goes first is the one a person would move first: setting off forwards or backwards, the
      // one left behind; stepping sideways, the one on the side being stepped to. (The stride begins at toe-off.
      // Asked of a boot standing out in front, that is a prancing step: heel up, knee hauled high, boot drawn back
      // under the body before it can go anywhere.)
      const way = by + this.motionAngle, feet = this.footGoal;
      const lead = (feet[0].p.x - feet[1].p.x) * Math.sin(way) + (feet[0].p.z - feet[1].p.z) * Math.cos(way);      // how far the left boot stands ahead of the right, that way
      if (Math.abs(lead) > 0.04) this.leadFoot = (lead > 0) === (Math.abs(Math.sin(this.motionAngle)) > 0.7) ? 0 : 1;
      this.phase = (Wk.contact + 0.02 + this.leadFoot * 0.5) % 1;
    } else this.atRest = false;
    const phaseBefore = this.phase;
    // Coming to a halt, the stride runs on to the moment the swinging boot is passing the standing one, so the last
    // step closes the feet together instead of both boots sliding home from wherever the stride stopped.
    let closing = 0;
    if (settling && wMove > 0.03) {
      const passing = contact + (1 - contact) / 2, togo = Math.min((passing - this.phase + 1) % 1, (passing + 0.5 - this.phase + 1) % 1);
      if (togo > 0.015 && togo < 0.6) closing = clamp(togo / 0.2, 0.4, 1.5);
    }
    // cadence changes over a few frames, never in one
    this.cadence = damp(this.cadence, Math.max(s / Math.max(0.35, cycleLength), pivot * (0.9 + 0.3 * Math.abs(this.turnRate)), closing), 18, dt);
    this.phase += this.cadence * dt;
    this.phase -= Math.floor(this.phase);
    this.act.walk.time = ((this.phase + Wk.off) % 1) * Wk.dur; this.act.run.time = ((this.phase + Rn.off) % 1) * Rn.dur;
    for (const a of this.ankle) if (a.toe) { a.toe.quaternion.copy(a.toeWas); a.toe = null; }      // toes bent by hand last frame, as the clips had them (the mixer may not write them again)
    this.mixer.update(dt);
    applyDirectionalGait(b, gait.directional, this.gaitBlend, this.phase, wMove);
    if (wMove > 0.60 && Math.floor(phaseBefore * 2) !== Math.floor(this.phase * 2)) G.bots.sound(this, 'step', s);

    this.nearby.length = 0;
    for (const c of cols) {
      const reach = c.hx + c.hz + 1.35;
      if (Math.abs(this.pos.x - c.x) <= reach && Math.abs(this.pos.z - c.z) <= reach &&
          c.y1 > this.floorY - STEP && c.y0 < this.pos.y + 2) this.nearby.push(c);
    }
    // Where the clips put the boots, before anything below moves the pelvis: the legs are solved back to these.
    this.root.updateMatrixWorld(true);
    b.lft.getWorldPosition(this.footAnim[0].p); b.lft.getWorldQuaternion(this.footAnim[0].q);
    b.rft.getWorldPosition(this.footAnim[1].p); b.rft.getWorldQuaternion(this.footAnim[1].q);
    // The clips themselves have a few hard frames (the run slaps its left boot down within one of them). Each boot's
    // authored place and attitude are followed through a very short lag, taken in the body's own frame so that the
    // body's travel adds none: enough to round a one-frame snap, too short to see as delay.
    q3.setFromAxisAngle(UP, -by);
    for (let i = 0; i < 2; i++) {
      const anim = this.footAnim[i], ease = this.footEase[i];
      t1.copy(anim.p).sub(this.pos).applyQuaternion(q3); q1.copy(q3).multiply(anim.q);
      if (!ease.live || dt <= 0) { ease.p.copy(t1); ease.q.copy(q1); ease.live = true; }
      else { const k = 1 - Math.exp(-58 * dt); ease.p.lerp(t1, k); ease.q.slerp(q1, k); }
      q2.copy(q3).invert();
      anim.p.copy(ease.p).applyQuaternion(q2).add(this.pos); anim.q.copy(q2).multiply(ease.q);
    }
    // Steady the trunk. The clips were made for swinging arms: the pelvis bounces and sways and the shoulders rock
    // with every stride. Someone carrying a rifle in both hands keeps the weapon and the head quiet, so the pelvis
    // keeps part of its bounce and the chest is held near its average attitude while the legs do the work.
    const steady = wMove * (1 - directional);
    if (steady > 0.001) {
      const k = steady, sway = this.hipSway;
      sway.copy(b.hips.position).sub(t1.copy(Wk.hipPos).lerp(Rn.hipPos, wRun));
      // armature space: x across, z up, in centimetres. The bounce is squeezed down towards its low point (both
      // boots on the ground, legs at full reach), so the high of each stride is lower and no leg has to reach further.
      b.hips.position.x -= sway.x * 0.4 * k;
      b.hips.position.z -= Math.max(0, b.hips.position.z - lerp(Wk.hipLow, Rn.hipLow, wRun)) * lerp(0.42, 0.3, wRun) * k;
      b.hips.quaternion.slerp(q1.copy(Wk.hipQ).slerp(Rn.hipQ, wRun), lerp(0.2, 0.5, wRun) * k);
      // chest attitude relative to the armature = pelvis × spine × spine1 × spine2; correct it at the lowest spine joint
      q2.copy(b.spine1.quaternion).multiply(b.spine2.quaternion);
      q1.copy(b.hips.quaternion).multiply(b.spine.quaternion).multiply(q2);
      q1.slerp(q3.copy(Wk.chestQ).slerp(Rn.chestQ, wRun), lerp(0.65, 0.8, wRun) * k);
      b.spine.quaternion.copy(q3.copy(b.hips.quaternion).invert()).multiply(q1).multiply(q2.invert());
    }
    // The Character armature is rotated -90° around X, so hips Z is height in centimetres.
    const crouchDrop = this.crouch * lerp(0.35, 0.26, directional * wMove);
    b.hips.position.z -= crouchDrop * 100;
    // The walk clip carries the chest behind the hips. With a rifle held out in front, a walking soldier settles the
    // other way: shoulders a little forward over the weapon.
    const hunch = wMove * (1 - wRun) * (1 - directional) * 0.11;
    b.spine.rotation.x += this.crouch * 0.34 + hunch * 0.45;
    b.spine1.rotation.x += hunch * 0.35; b.spine2.rotation.x += hunch * 0.2;
    this.root.updateMatrixWorld(true);
    const legPose = { bfx, bfz, drift, warp, walk: wMove, stride: lerp(reach, 1, directional), pivot, contact, directional, cycle: cycleLength };
    this.poseFoot(0, b.lul, b.ltoe, legPose, dt);
    this.poseFoot(1, b.rul, b.rtoe, legPose, dt);
    // If a boot's place is beyond the leg's reach (the far side of a step down, a long stride), the pelvis gives a
    // little, as a person's does, instead of the knee locking straight and snapping free a moment later.
    let give = 0;
    for (let i = 0; i < 2; i++) {
      (i ? b.rul : b.lul).getWorldPosition(legBase);
      // a straight leg is fine, an impossible one is not; and a boot reaching down to lower ground is met part-way
      const goal = this.footGoal[i].p, d = legBase.distanceTo(goal), over = d - this.legLength * (this.footGround[i] < this.pos.y - 0.025 ? 0.97 : 0.998);
      if (over > 0) give = Math.max(give, over * d / Math.max(0.3, legBase.y - goal.y) * (this.plants[i] ? 1 : 0.6));
    }
    give = Math.min(give, 0.07);
    this.hipGive = damp(this.hipGive, give, give > this.hipGive ? 24 : 8, dt);
    this.hipDrop = damp(this.hipDrop, this.hipGive, 24, dt);
    if (this.hipDrop > 0.0005) { b.hips.position.z -= this.hipDrop * 100; b.hips.updateWorldMatrix(false, true); }
    this.solveLeg(0, b.lul, b.ll, b.lft, b.ltoe, dt);
    this.solveLeg(1, b.rul, b.rl, b.rft, b.rtoe, dt);
    // Head: on the target in a fight. Otherwise the eyes go first: into the bend the route is about to take, down a
    // side street as it opens up, and now and then to either side.
    const calm = this.state !== 'combat';
    this.lookT -= dt; this.probeT -= dt;
    if (calm && this.probeT <= 0) {
      this.probeT = 0.3;
      for (let k = 0; k < 2; k++) {
        const a = this.heading + (k ? -1.25 : 1.25), open = rayBoxes(this.pos.x, this.pos.y + 1.5, this.pos.z, Math.sin(a), 0, Math.cos(a), 14, cols, null) > 9;
        if (open && !this.sideOpen[k] && moved > 0.8 && this.lookT < 2.2) { this.lookGoal = (k ? -1 : 1) * (0.85 + this.rnd() * 0.3); this.lookT = 0.75 + this.rnd() * 0.7; }
        this.sideOpen[k] = open;
      }
    }
    if (this.lookT <= 0) {
      this.lookT = 0.9 + this.rnd() * 2.1;
      this.lookGoal = !calm ? 0 : this.rnd() < 0.3 ? 0 : (this.rnd() - 0.5) * (moved > 1 ? 0.95 : 1.6);
    }
    const lead = calm && moved > 0.5 ? clamp(angDiff(this.yaw, this.farYaw) * 0.75, -0.7, 0.7) : 0;
    this.headYaw = damp(this.headYaw, calm ? clamp(this.lookGoal + lead, -1.2, 1.2) : 0, 5.5, dt);
    b.neck.rotation.y += this.headYaw * 0.35; b.head.rotation.y += this.headYaw * 0.65; b.head.rotation.x -= this.pitch * this.aim * 0.3;
    poseBotRifle(this, dt);
  }

  // Where boot `i` belongs this frame (ankle position and boot attitude, into footGoal). The legs are solved after
  // both are known.
  poseFoot(i, thigh, toe, pose, dt) {
    const { bfx: fx, bfz: fz, drift, warp, walk, stride, pivot, contact, directional, cycle } = pose;
    footPos.copy(this.footAnim[i].p); footQuat.copy(this.footAnim[i].q);
    const dx = footPos.x - this.pos.x, dz = footPos.z - this.pos.z;
    const side = (dx * -fz + dz * fx) * (1 - pivot) + (i === 0 ? -0.13 : 0.13) * pivot;
    const along = (dx * fx + dz * fz) * lerp(1, stride, walk) * (1 - pivot * 0.8);
    const swingSide = side + Math.sin(drift) * along;
    const stanceSide = lerp(i === 0 ? Math.min(-0.078, swingSide) : Math.max(0.078, swingSide), swingSide, directional);
    const reach = Math.cos(drift) * along;
    const sin = Math.sin(warp), cos = Math.cos(warp);
    footPos.x = this.pos.x + (reach * fx - stanceSide * fz) * cos + (reach * fz + stanceSide * fx) * sin;
    footPos.z = this.pos.z + (reach * fz + stanceSide * fx) * cos - (reach * fx - stanceSide * fz) * sin;
    footPos.y -= Math.max(0, footPos.y - this.pos.y - 0.15) * 0.6 * pivot;              // turning on the spot the boots are shuffled round, not marched

    const elapsed = (this.phase + i * 0.5) % 1;
    const flat = clamp(Math.abs(Math.sin(drift)) * walk + pivot * 0.55 + this.crouch * 0.4, 0, 1);
    q1.setFromAxisAngle(UP, this.bodyYaw + Math.PI).multiply(this.G.bots.gait.flatFoot[i]);
    footQuat.slerp(q1, flat);
    const sole = () => {
      heelPos.copy(HEEL).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
      ballPos.copy(BALL).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
      capPos.copy(TOE_END).applyQuaternion(toe.quaternion).add(toe.position).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
    };
    sole();
    const cols = this.nearby;
    let plant = this.plants[i];
    // What this boot stands on. A planted boot keeps the footing it landed on. A swinging boot takes the ground under
    // it and the ground where the stride will set it down, so it starts to rise at toe-off when the next step is up a
    // kerb, and holds its height until it is clear of the edge when the next step is down. The footing height is
    // eased either way: a boot is lifted, never switched, onto a step.
    const under = (x, z) => groundAt(x, z, Math.max(this.floorY, this.footGround[i]), 0.055, cols, STRIDE_STEP).y;
    const standing = Math.max(under(heelPos.x, heelPos.z), under(ballPos.x, ballPos.z), under(capPos.x, capPos.z));
    let footing = plant ? plant.ground : standing;
    const pace = Math.hypot(this.vel.x, this.vel.z);
    if (!plant && elapsed >= contact && walk > 0.5 && pace > 0.4) {
      const tx = this.vel.x / pace, tz = this.vel.z / pace, ox = footPos.x - this.pos.x, oz = footPos.z - this.pos.z;
      const ahead = (1 - elapsed + contact * 0.5) * cycle - (ox * tx + oz * tz);        // from the boot to where it comes down
      footing = Math.max(footing, under(footPos.x + tx * ahead, footPos.z + tz * ahead));
    }
    this.footAim[i] = damp(this.footAim[i], footing, 26, dt);
    this.footGround[i] = damp(this.footGround[i], this.footAim[i], 26, dt);
    const ground = this.footGround[i];
    footPos.y += ground - this.pos.y;
    // Pushing off, the heel rises over the ball of the foot while the toes stay flat, so the sole's low point is the
    // heel, the ball or the bent toe cap, never the toe of a rigid boot. A swinging boot clears the ground by a
    // finger's width at its lowest; it does not brush it.
    const swing = clamp((elapsed - contact) / (1 - contact), 0, 1), clearance = 0.009 + 0.016 * Math.sin(Math.PI * swing) ** 2 * walk * (1 - directional);
    const lowest = Math.min(heelPos.y, ballPos.y, capPos.y - CAP_SOLE) + ground - this.pos.y;
    if (lowest < ground + clearance) footPos.y += ground + clearance - lowest;
    // The stride's contact phase says when a boot should be bearing weight; it stays down a little longer if the
    // forefoot has not yet left the ground.
    sole();
    thigh.getWorldPosition(legBase);
    const span = plant ? Math.hypot(footPos.x + plant.dx - legBase.x, footPos.y - legBase.y, footPos.z + plant.dz - legBase.z) / this.legLength : 0;
    // ...and leaves it when the trailing leg is used up: by then the knee has begun to bend for the swing.
    // Standing (or only just getting under way) there is no stride to say: a boot on the ground simply stays put,
    // wherever the last step left it, while the body settles, sways, crouches or shifts above it.
    const down = Math.min(heelPos.y, ballPos.y, capPos.y - CAP_SOLE) - ground < 0.022;
    // Left standing with a boot well out of place (a halt in mid-stride), a person shifts it: one small step, the
    // other boot planted, to stand comfortably.
    const easing = this.releasedPlants[i], other = 1 - i;
    const shuffle = walk < 0.05 && this.restT > 0.35 && !!plant && Math.hypot(plant.dx, plant.dz) > 0.2 && !!this.plants[other] && !this.releasedPlants[other];
    // (Only a boot left behind the hip is pushing off. One still under the body when its turn to swing comes, as on
    // the first step from a standstill, is simply picked up: held down by its toe there, the heel climbs straight up
    // and the knee is driven out in front.)
    const tx = pace > 0.2 ? this.vel.x / pace : fx, tz = pace > 0.2 ? this.vel.z / pace : fz;
    const trailing = !!plant && (footPos.x + plant.dx - legBase.x) * tx + (footPos.z + plant.dz - legBase.z) * tz < -0.08;
    const stance = walk >= 0.25 ? elapsed < contact || (trailing && directional < 0.5 && elapsed < contact + 0.11 && span < 0.962 && Math.min(ballPos.y, capPos.y - CAP_SOLE) - ground < 0.024)
      : plant ? !shuffle : down && !(easing && easing.hop > 0 && easing.k > 0.04);

    if (!stance && plant) {
      plant.t = 0; plant.over = shuffle ? 0.36 : clamp(Math.hypot(plant.dx, plant.dz) / 1.3, 0.14, 0.3);      // a boot far from where the stride wants it is brought across, not snapped across
      plant.hop = shuffle ? 0.05 : 0; plant.k = 1;
      this.releasedPlants[i] = plant; this.plants[i] = plant = null;
    }
    // A boot recently lifted is still being handed back from where it was held to where the stride has it. This comes
    // first, so that a boot set down again in the middle of that (a halt, a change of mind) is planted where it
    // actually is.
    const released = this.releasedPlants[i];
    if (released) {
      released.t += dt;
      let k = 1 - smooth(clamp(released.t / released.over, 0, 1));
      // ...and no slower than the leg can spare: a boot left behind by a body already on the move is not held back
      // until the knee locks.
      thigh.getWorldPosition(legBase);
      const spare = c => Math.hypot(footPos.x + released.dx * c - legBase.x, footPos.y - legBase.y, footPos.z + released.dz * c - legBase.z) / this.legLength;
      if (spare(k) > 0.95) {
        let lo = 0, hi = k;
        if (spare(0) < 0.95) for (let n = 0; n < 5; n++) { const mid = (lo + hi) / 2; if (spare(mid) > 0.95) hi = mid; else lo = mid; }
        k = Math.max(lo, k - 5 * dt);
        released.t = Math.max(released.t, released.over * inverseSmooth(1 - k));          // and carries on from there
      }
      released.k = k;
      if (released.hop > 0) footPos.y += released.hop * Math.sin(Math.PI * clamp(released.t / released.over, 0, 1));
      if (k <= 0) this.releasedPlants[i] = null;
      else {
        footPos.x += released.dx * k; footPos.z += released.dz * k;
        footQuat.premultiply(q1.setFromAxisAngle(UP, clamp(angDiff(this.bodyYaw, released.yaw), -0.75, 0.75) * k));
        if (released.tip > 0) {                                                         // the raised heel comes back to the authored swing with the rest
          footPos.x += released.tipX * k; footPos.y += released.tipY * k; footPos.z += released.tipZ * k;
          footQuat.premultiply(q1.setFromAxisAngle(soleProbe.set(Math.cos(released.tipYaw), 0, -Math.sin(released.tipYaw)), released.tip * k));
        }
        sole();
      }
    }

    // Stance: the part of the sole carrying the weight stays where it landed. That is the heel first, then the ball
    // of the foot as the heel peels up, then the toe as the boot rolls off, so it turns over the spot instead of
    // skating across it. A boot that has landed also keeps its direction while the body turns above it.
    if (stance) {
      if (plant) { footQuat.premultiply(q1.setFromAxisAngle(UP, clamp(angDiff(this.bodyYaw, plant.yaw), -0.75, 0.75))); sole(); }
      let part = plant ? plant.part : 0, lowPoint = plant ? (part === 0 ? heelPos.y : part === 1 ? ballPos.y : capPos.y - CAP_SOLE) - 0.012 : 9;      // the current pivot keeps the job until another point is clearly lower
      if (heelPos.y < lowPoint) { lowPoint = heelPos.y; part = 0; }
      if (ballPos.y < lowPoint) { lowPoint = ballPos.y; part = 1; }
      if (capPos.y - CAP_SOLE < lowPoint) part = 2;
      const point = part === 0 ? heelPos : part === 1 ? ballPos : capPos;
      if (!plant) {
        const carry = this.releasedPlants[i];                                           // set down again while still being handed back: it keeps the turn it had
        plant = this.plants[i] = { part, x: point.x, z: point.z, yaw: this.bodyYaw + (carry ? clamp(angDiff(this.bodyYaw, carry.yaw), -0.75, 0.75) * carry.k : 0), dx: 0, dz: 0, t: 0, ground: standing, tip: 0, over: 0.14 };
        this.releasedPlants[i] = null;
      } else if (plant.part !== part) { plant.part = part; plant.x = point.x + plant.dx; plant.z = point.z + plant.dz; }      // weight rolls on: the new pivot is wherever the held boot has it
      let dx = plant.x - point.x, dz = plant.z - point.z;
      const tipWas = plant.tip || 0;
      plant.tip = 0;
      const far = Math.hypot(dx, dz), limit = walk < 0.25 ? 0.46 : lerp(0.24, 0.46, directional);
      if (far > limit) {                                                                // the body has outrun the leg: the boot is drawn after it (drawn, not snapped)
        const keep = Math.max(limit, far - 1.6 * dt) / far;
        dx *= keep; dz *= keep; plant.x = point.x + dx; plant.z = point.z + dz;
      }
      // Holding the boot still must not straighten the knee much beyond what the stride itself asks for: before the
      // toe leaves the ground the knee is already bending for the swing. A person gets that bend by letting the heel
      // rise over the planted toe, so the boot is tipped up about its toe first; only what that cannot give is made
      // up by letting the toe creep.
      const reachOf = k => Math.hypot(footPos.x + dx * k - legBase.x, footPos.y - legBase.y, footPos.z + dz * k - legBase.z) / this.legLength;
      // (Standing, a boot may be anywhere the leg reaches: the rule fades in as the stride takes over.)
      const bend = 2 * Math.acos(Math.min(1, reachOf(0)));                               // the stride's own knee angle (thigh and shin are near enough equal)
      const allowed = lerp(0.985, Math.max(Math.cos(Math.max(0, bend - 0.07) / 2), 0.9), smooth(clamp((walk - 0.25) / 0.5, 0, 1)));
      // The stop is soft: giving way begins part-way between the stride's own reach and the limit and tightens
      // towards the limit, so the knee slows into it. It never begins inside the stride's own reach, or a boot that is
      // exactly where the stride has it would be made to creep.
      const own = reachOf(0), begin = own + Math.max(0, allowed - own) * 0.4;
      const stretched = reachOf(1) > begin, lift = stretched && part > 0 && directional < 0.5 && pivot < 0.3 && walk >= 0.25 && elapsed > contact - 0.2;
      if (lift || tipWas > 0) {
        // the ankle swung up and forward about the pivot, in the plane of travel
        const px = point.x + dx, pz = point.z + dz, ax = footPos.x - point.x, ay = footPos.y - point.y, az = footPos.z - point.z;
        const back = -(ax * fx + az * fz), across = ax * fz - az * fx;
        const ankle = (a, out) => { const c = Math.cos(a), sn = Math.sin(a), b2 = back * c - ay * sn; return out.set(px - fx * b2 + fz * across, point.y + ay * c + back * sn, pz - fz * b2 - fx * across); };
        const spanAt = a => ankle(a, soleProbe).distanceTo(legBase) / this.legLength;
        let lo = 0, hi = lift && spanAt(0) > allowed ? 0.5 : 0;
        if (hi > 0) { if (spanAt(hi) > allowed) lo = hi; else for (let n = 0; n < 6; n++) { const mid = (lo + hi) / 2; if (spanAt(mid) > allowed) lo = mid; else hi = mid; } }
        hi = clamp(hi, tipWas - TIP_DOWN * dt, tipWas + TIP_UP * dt);                     // a heel is raised and set down; it is never flicked
        if (hi > 0.002) {
          ankle(hi, soleProbe);
          plant.tip = hi; plant.tipX = soleProbe.x - (footPos.x + dx); plant.tipY = soleProbe.y - footPos.y; plant.tipZ = soleProbe.z - (footPos.z + dz); plant.tipYaw = this.bodyYaw;
          footPos.x = soleProbe.x - dx; footPos.y = soleProbe.y; footPos.z = soleProbe.z - dz;
          footQuat.premultiply(q1.setFromAxisAngle(soleProbe.set(fz, 0, -fx), hi));
        }
      }
      if (stretched) {
        const asked = reachOf(1), room = Math.max(allowed - begin, 0.002);
        if (far > 0.004 && asked > begin) {
          const granted = begin + room * (1 - Math.exp(-(asked - begin) / room));
          let lo = 0, hi = 1;
          for (let n = 0; n < 6; n++) { const mid = (lo + hi) / 2; if (reachOf(mid) > granted) hi = mid; else lo = mid; }
          lo = Math.max(lo, 1 - 2.2 * dt / far);                                          // crept, not jumped
          dx *= lo; dz *= lo; plant.x = point.x + dx; plant.z = point.z + dz;
        }
      }
      plant.dx = dx; plant.dz = dz;
      footPos.x += dx; footPos.z += dz;
    }
    // Keep the boot out of walls and furniture: anything the body itself could not walk up. A kerb or a stair is
    // footing, handled above, and never shoves a boot sideways.
    sole();
    for (const sample of [heelPos, capPos]) {
      soleProbe.set(sample.x, this.floorY, sample.z);
      if (!resolveXZ(soleProbe, 0.066, 0.6, cols, STRIDE_STEP)) continue;
      let x = soleProbe.x - sample.x, z = soleProbe.z - sample.z;
      const deep = Math.hypot(x, z);
      if (deep > 0.2) { x *= 0.2 / deep; z *= 0.2 / deep; }                              // never more than a boot's length, and never all or nothing
      footPos.x += x; footPos.z += z; capPos.x += x; capPos.z += z;
    }
    const goal = this.footGoal[i];
    goal.p.copy(footPos); goal.q.copy(footQuat); goal.bend = Math.max(flat, this.crouch) * 0.7;
  }

  solveLeg(i, thigh, knee, foot, toe, dt) {
    const goal = this.footGoal[i], by = this.bodyYaw, relief = this.ankle[i];
    const bootYaw = lateralYaw(goal.q);                                                // (before the boot is rolled: what the knee follows must not depend on what the knee does)
    // What the ankle could not take last frame, the boot gives (see below): the heel raised over the ball of the foot,
    // which stays where it is, and the boot rolled over with the shin.
    if (relief.heel > 1e-4) {
      t1.copy(ballSole.copy(BALL).multiplyScalar(0.01)).applyQuaternion(goal.q).add(goal.p);
      goal.q.multiply(q1.setFromAxisAngle(HINGE, relief.heel));
      goal.p.copy(t1).sub(ballSole.applyQuaternion(goal.q));
    }
    if (Math.abs(relief.roll) > 1e-4) goal.q.multiply(q1.setFromAxisAngle(FOOT_LENGTH, -relief.roll));
    thigh.getWorldPosition(legBase);
    legAxis.subVectors(goal.p, legBase).normalize();
    // Which way the knee points is said by its hinge axis, not by where the clip happens to have the knee: that
    // point lies almost on the line from hip to boot whenever the leg is near straight, or the boot is held somewhere
    // the clip does not have it, and a direction taken from it swings round to the side or the back. The axis is the
    // clip's own (thigh and shin agree on it but for a little authored twist)...
    hingeWant.copy(HINGE).applyQuaternion(thigh.getWorldQuaternion(q1)).add(soleProbe.copy(HINGE).applyQuaternion(knee.getWorldQuaternion(q2)));
    // ...turned with the boot, by most of what the boot is turned from where the clip has it. A planted boot keeps
    // its direction while the body turns above it, and a leg takes that up in the hip, where it can turn: an ankle
    // cannot be wrung round, nor a shin twisted against its thigh.
    const turned = angDiff(lateralYaw(this.footAnim[i].q), bootYaw) * KNEE_FOLLOWS_BOOT;
    hingeWant.applyAxisAngle(UP, turned).normalize();
    hingeWant.lerp(soleProbe.set(Math.cos(by), 0, -Math.sin(by)), goal.bend);          // crouched or shuffling round, the knees go straight ahead
    // ...but never further from the way the boot points than an ankle turns: past that the knee goes with the boot.
    const wrung = angDiff(Math.atan2(hingeWant.x, hingeWant.z), bootYaw);
    if (Math.abs(wrung) > ANKLE_TURN_MAX) hingeWant.applyAxisAngle(UP, wrung - Math.sign(wrung) * ANKLE_TURN_MAX);
    kneePos.crossVectors(legAxis, hingeWant);
    ik2(thigh, knee, foot, goal.p, kneePos, 0.025);
    foot.parent.getWorldQuaternion(footParent);
    foot.quaternion.copy(footParent.invert().multiply(goal.q));
    if (relief.heel > 1e-4) { relief.toe = toe; relief.toeWas.copy(toe.quaternion); toe.quaternion.premultiply(q1.setFromAxisAngle(HINGE, -relief.heel)); }      // the toes stay flat on the ground
    // An ankle bends only so far. Where the shin leans further over the toes than that (the rear leg of a soldier
    // down on one knee, the trailing leg of a long side-step), a person's heel comes up; where it leans further to
    // one side, the boot rolls onto its edge. How far the shin leans is only known once the leg is solved, so the
    // boot follows a frame behind, at the pace a heel is raised and set down.
    knee.getWorldPosition(kneePos); foot.getWorldPosition(footPos);
    shinUp.subVectors(kneePos, footPos).normalize();
    const lean = Math.atan2(shinUp.dot(soleProbe.copy(FOOT_LENGTH).applyQuaternion(goal.q)), -shinUp.dot(soleProbe.copy(FOOT_DOWN).applyQuaternion(goal.q)));
    const over = Math.asin(clamp(shinUp.dot(soleProbe.copy(HINGE).applyQuaternion(goal.q)), -1, 1)) + relief.roll;
    relief.heel += clamp((Math.max(0, relief.heel + lean - DORSI_MAX) - relief.heel) * 0.6, -TIP_DOWN * dt, TIP_UP * dt);
    relief.roll += clamp((clamp(over - clamp(over, -ROLL_MAX, ROLL_MAX), -0.5, 0.5) - relief.roll) * 0.6, -3 * dt, 3 * dt);
  }

  muzzle(out) { return this.gun.localToWorld(out.copy(MUZZLE)); }
}

export class Bots {
  constructor(G, perTeam = 4) {
    this.G = G; this.rnd = rng(555);
    const shared = { gunMats: gunMaterials() };
    this.list = [];
    for (let i = 0; i < perTeam - 1; i++) this.list.push(new Bot(G, 0, i, shared));
    for (let i = 0; i < perTeam; i++) this.list.push(new Bot(G, 1, i, shared));
    this.reports = [[], []];
    this.gait = calibrate(this.list[0]);
    this.gait.directional = bakeDirectionalGaits(assets.soldier, this.list[0].b, ik2);
  }
  reset() { this.reports = [[], []]; for (const b of this.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 0.2 + b.idx * 0.3; b.kills = 0; b.deaths = 0; b.mixer.timeScale = 1; b.rag = null; b.dropped = null; b.fall = null; } }
  coverTaken(ci, who) { return this.list.some(b => b !== who && b.alive && b.cover && b.cover.ci === ci); }
  occupied(spot, who) { return this.actors().some(a => a !== who && a.alive && Math.hypot(a.pos.x - spot.x, a.pos.z - spot.z) < 0.95); }
  report(team, pos, by, enemy) { const r = this.reports[team]; r.push({ pos: pos.clone(), when: this.G.time, by }); if (r.length > 8) r.shift(); if (enemy && team === this.G.player.team) this.G.hud.ping(enemy, 3); }

  // Spawn away from hostile eyes: no line of sight to an enemy, as far from them as possible.
  pickSpawn(team) {
    const G = this.G, cols = G.world.colliders, foes = this.actors().filter(a => a.alive && a.team !== team);
    let best = null, bs = -1e9;
    for (const sp of G.world.spawns[team]) {
      let near = 1e9, seen = false;
      for (const f of foes) { const d = Math.hypot(f.pos.x - sp.x, f.pos.z - sp.z); near = Math.min(near, d); if (d < 70 && losClear(t1.set(sp.x, 1.6, sp.z), t2.set(f.pos.x, f.eyeY, f.pos.z), cols)) seen = true; }
      const crowd = this.actors().some(a => a.alive && Math.hypot(a.pos.x - sp.x, a.pos.z - sp.z) < 1.5);
      const sc = Math.min(near, 60) - (seen ? 80 : 0) - (crowd ? 200 : 0) + this.rnd() * 6;
      if (sc > bs) { bs = sc; best = sp; }
    }
    return best;
  }
  actors() { return this._actors || (this._actors = [this.G.player, ...this.list]); }

  // Sound events with an uncertain position; only idle bots react.
  hear(pos, radius, sourceTeam) {
    for (const b of this.list) {
      if (!b.alive || b.team === sourceTeam || b.state === 'combat' || b.evade) continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d > radius || b.rnd() > 0.75) continue;
      const err = 1.5 + d * 0.16;
      b.state = 'search'; b.searchT = 5 + b.rnd() * 3; b.lookYaw = Math.atan2(pos.x - b.pos.x, pos.z - b.pos.z);
      b.setGoal(pos.x + (b.rnd() - 0.5) * err * 2, pos.z + (b.rnd() - 0.5) * err * 2, d > 25);
    }
  }

  // A grenade has struck the ground at p with `left` seconds on its fuze. Soldiers who see it land or hear it strike
  // close by get out of its way, after the moment it takes to register; some never notice.
  grenade(n, p, left) {
    const G = this.G, name = G.settings.difficulty, D = DIFF[name] || DIFF.normal, cols = G.world.colliders;
    for (const b of this.list) {
      if (!b.alive || n.warned.has(b)) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z); if (d > 12) continue;
      const see = losClear(b.eye(t1), t2.set(p.x, p.y + 0.1, p.z), cols), ang = Math.abs(angDiff(b.yaw + b.headYaw, Math.atan2(p.x - b.pos.x, p.z - b.pos.z)));
      if (!((see && ang < 1.2) || d < 6.5)) continue;
      n.warned.add(b);
      if ((!see && d > 4) || d > 10) continue;                                         // behind a wall from it, or far enough already
      if (b.rnd() > (name === 'easy' ? 0.6 : name === 'hard' ? 1 : 0.88)) continue;
      b.evade = { x: p.x, y: p.y, z: p.z, t: left + 0.7, wait: D.react * (0.4 + b.rnd() * 0.6) * (1 + b.dazed), fx: n.from.x, fz: n.from.z };
    }
  }
  // After a burst: those who felt it keep their heads down for a moment.
  blasted(o) {
    const cols = this.G.world.colliders;
    for (const b of this.list) { if (!b.alive) continue; const d = Math.hypot(b.pos.x - o.x, b.pos.z - o.z); if (d < 18 && losClear(b.eye(t1), o, cols)) { b.hurtT = 0; b.flinch = 1; } }
  }

  sound(b, kind, speed = 3) {
    const G = this.G, cam = G.R.camera.position, d = cam.distanceTo(b.pos);
    if (kind === 'step') { if (d < 32) G.audio.step(b.surf || 'concrete', clamp(0.35 + speed * 0.14, 0.3, 1.1) * (b.crouching ? 0.5 : 1), { x: b.pos.x, y: b.pos.y + 0.1, z: b.pos.z }); }
    else if (d < 22) G.audio.foleyAt(kind, { x: b.pos.x, y: b.pos.y + 1.2, z: b.pos.z });
  }

  // Hitscan shot with aim error. Uses the same collision boxes as movement and sight, so nothing is shot through walls.
  fire(b, tg, D) {
    const G = this.G, R = b.rnd, cols = G.world.colliders, m = b.muzzle(V()), eye = b.eye(V());
    b.rifleKick = 1;
    let aim;
    if (tg) { aim = V(tg.pos.x, tg.pos.y + (tg.eyeY - tg.pos.y) * (0.55 + R() * 0.3), tg.pos.z); const lead = eye.distanceTo(aim) / 420; aim.addScaledVector(tg.vel, lead * (0.6 + R() * 0.5)); }
    else aim = V(b.lastKnown.x + (R() - 0.5) * 1.6, 1.0 + R() * 0.7, b.lastKnown.z + (R() - 0.5) * 1.6);
    const dir = aim.sub(eye).normalize();
    const err = 0.016 * D.err * (1 + Math.max(0, 0.6 - b.engageT) * 3.5) * (tg && tg.vel.lengthSq() > 9 ? 1.5 : 1) * (b.vel.lengthSq() > 2 ? 1.6 : 1) * (1 + b.flinch) * (1 + b.dazed * 0.6) * (b.crouching ? 0.85 : 1);
    const g = () => (R() + R() + R() - 1.5) * 1.15;
    dir.x += g() * err; dir.y += g() * err * 0.8; dir.z += g() * err; dir.normalize();
    const hitInfo = {}; let tMax = rayBoxes(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 220, cols, hitInfo), victim = null, zone = 'body';
    for (const a of this.actors()) {
      if (a === b || !a.alive || a.team === b.team) continue;
      const h = rayActor(eye, dir, a, tMax); if (h) { tMax = h.t; victim = a; zone = h.zone; }
    }
    const ph = G.rigid.ray(eye, dir, tMax);                                 // loose clutter and the fallen in the line of fire
    if (ph && G.rigid.bulletHit(ph, eye, dir, false)) { tMax = ph.t; victim = null; hitInfo.b = null; }
    const end = eye.clone().addScaledVector(dir, tMax), cam = G.R.camera.position, dCam = cam.distanceTo(m);
    G.fx.glow.add(m, V(0, 0, 0), [7, 5, 2.6], 1, 0.34, 0.05); G.fx.muzzleSmoke(m, dir, 0.3);
    if (R() < 0.6) G.fx.tracer(m, end, 300);
    G.audio.shotAt({ x: m.x, y: m.y, z: m.z });
    this.hear(b.pos, 55, b.team); if (b.team !== G.player.team) G.hud.ping(b, 2.2);
    if (victim) {
      const dmg = (zone === 'head' ? 42 : zone === 'limb' ? 13 : 18) * D.dmg * (victim.isPlayer ? 1 : 1.25);
      victim.damage(dmg, b.pos, b, zone);
      G.fx.impact('fabric', end, dir.clone().negate(), 0.8, 0.6);
    } else if (hitInfo.b) {
      const n = V(hitInfo.nx, hitInfo.ny, hitInfo.nz), s = hitInfo.b.surf;
      G.fx.impact(s, end, n, 0.8);
      if (cam.distanceTo(end) < 28) G.audio.impact(s, { x: end.x, y: end.y, z: end.z }, false);
    }
    // near miss on the player
    const P = G.player;
    if (P.alive && victim !== P && b.team !== P.team) {
      t1.copy(cam).sub(eye); const along = t1.dot(dir);
      if (along > 2 && along < tMax) { const miss = t1.addScaledVector(dir, -along).length(); if (miss < 1.3) { const q = eye.clone().addScaledVector(dir, along); G.audio.whiz({ x: q.x, y: q.y, z: q.z }); G.player.suppress(miss); } }
    }
  }

  update(dt) {
    const cols = this.G.world.colliders, actors = this.actors();
    const moved = this.list.filter(b => b.update(dt, actors, cols) && b.alive);
    const player = this.G.player;
    // Resolve overlaps before posing either bot and run every correction through wall collision.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < moved.length; i++) {
        const b = moved[i];
        if (player.alive) this.separate(b, player, cols);
        for (let j = i + 1; j < moved.length; j++) this.separate(b, moved[j], cols);
      }
    }
    for (const b of moved) b.finishMove(dt, cols);
  }

  separate(a, b, cols) {
    if (Math.abs(a.pos.y - b.pos.y) > 0.95) return;
    const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.hypot(dx, dz);
    if (d >= BODY_SPACING) return;
    const nx = d > 0.001 ? dx / d : Math.cos(a.yaw);
    const nz = d > 0.001 ? dz / d : -Math.sin(a.yaw);
    const push = b.isPlayer ? Math.min(BODY_SPACING - d, 0.18) : Math.min((BODY_SPACING - d) * 0.2, 0.006);     // soldiers ease apart; only the player's momentum shoves at once
    a.place(a.pos.x + nx * push, a.pos.z + nz * push, cols);
    if (!b.isPlayer) b.place(b.pos.x - nx * push, b.pos.z - nz * push, cols);
  }
}

// Ray vs a standing/crouching figure: head sphere, torso and leg cylinders.
const _o = V();
export function rayActor(o, d, a, tMax) {
  const h = a.height, r = 0.27, px = o.x - a.pos.x, pz = o.z - a.pos.z;
  const A = d.x * d.x + d.z * d.z; let best = null;
  if (A > 1e-8) {
    const B = px * d.x + pz * d.z, C = px * px + pz * pz - r * r, disc = B * B - A * C;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / A;
      if (t > 0 && t < tMax) { const y = o.y + d.y * t - a.pos.y; if (y >= 0 && y <= h - 0.2) best = { t, zone: y < h * 0.47 ? 'limb' : 'body' }; }
    }
  }
  _o.set(a.pos.x, a.pos.y + h - 0.13, a.pos.z).sub(o);
  const tc = _o.dot(d), d2 = _o.lengthSq() - tc * tc, rr = 0.135 * 0.135;
  if (tc > 0 && d2 < rr) { const t = tc - Math.sqrt(rr - d2); if (t > 0 && t < tMax && (!best || t < best.t + 0.05)) best = { t, zone: 'head' }; }
  return best;
}
