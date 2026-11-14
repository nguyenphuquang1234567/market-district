// AI combatants: rigged soldier with an IK rifle hold, grid navigation, sight/hearing-limited perception, cover use.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assets } from './assets.js';
import { BOT_MAG_IN, BOT_MAG_OUT, BOT_RELOAD_DURATION, MUZZLE, gunMaterials, worldGunMesh } from './weapon.js';
import { poseBotRifle, setUpBotRifle } from './bot-rifle.js';
import { STEP, resolveXZ, groundAt, rayBoxes, losClear } from './physics.js';
import { rng, clamp, lerp, damp, smooth, angDiff } from './util.js';
import { CONTACT, STRAFE_STRIDE, BACK_STRIDE, bakeDirectionalGaits, applyDirectionalGait, directionBlend } from './soldier-gait.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BODY_RADIUS = 0.39;
const BODY_SPACING = 0.78;
const UP = V(0, 1, 0);
// Sole points measured on the Vanguard rig, in the foot bone's local centimetres.
const HEEL = V(0, -2, 13.3), TOE = V(0, 24, 12.4);
const footPos = V(), kneePos = V(), legBase = V(), legAxis = V(), heelPos = V(), toePos = V(), soleProbe = V();
const footQuat = new THREE.Quaternion(), footParent = new THREE.Quaternion();
const NAMES = [['Idris', 'Tarek', 'Sami', 'Nour'], ['Kader', 'Viper', 'Rook', 'Anvil', 'Dagger']];
const DIFF = { easy: { react: 0.6, err: 1.7, dmg: 0.8 }, normal: { react: 0.36, err: 1.0, dmg: 1 }, hard: { react: 0.22, err: 0.68, dmg: 1.15 } };
const HOTSPOTS = [[0, -40], [0, -22], [0, -4], [0, 8], [0, 22], [0, 40], [-12, -2], [-11, 9], [-12, -12], [28.5, -40], [28.5, -20], [28.5, 0], [28.5, 20], [28.5, 40], [-29, -40], [-29, -20], [-29, 0], [-29, 20], [-29, 40], [-16, -20], [16, -20], [-16, 20], [16, 20], [-22, -1]];
export { CARRY } from './bot-rifle.js';
const t1 = V(), t2 = V(), t3 = V(), t4 = V(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();

// Rotate `bone` (about its own origin) so the direction to `child` points at `target` instead. All in world space.
function aimBone(bone, child, target) {
  bone.getWorldPosition(t1);
  t2.subVectors(child, t1).normalize(); t3.subVectors(target, t1).normalize();
  q1.setFromUnitVectors(t2, t3);
  bone.getWorldQuaternion(q2); bone.parent.getWorldQuaternion(q3);
  bone.quaternion.copy(q3.invert()).multiply(q1).multiply(q2);
  bone.updateWorldMatrix(false, true);
}
const pa = V(), pb = V(), pc = V(), elbow = V(), dirv = V(), perp = V();
function ik2(a, b, c, target, pole) {
  a.getWorldPosition(pa); b.getWorldPosition(pb); c.getWorldPosition(pc);
  const lab = pa.distanceTo(pb), lcb = pb.distanceTo(pc), lat = clamp(pa.distanceTo(target), 0.02, lab + lcb - 0.004);
  dirv.subVectors(target, pa).normalize();
  const cosA = clamp((lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  perp.copy(pole).addScaledVector(dirv, -pole.dot(dirv)).normalize();
  elbow.copy(pa).addScaledVector(dirv, lab * cosA).addScaledVector(perp, lab * sinA);
  aimBone(a, pb, elbow);
  c.getWorldPosition(pc);
  t4.copy(pa).addScaledVector(dirv, lat);
  aimBone(b, pc, t4);
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
    out[name] = { dur, off: start / N, contact: clamp(length / N, 0.25, 0.60), v };
  }
  for (const a of Object.values(bot.act)) a.setEffectiveWeight(a === bot.act.idle ? 1 : 0);
  console.info(`gait: walk ${out.walk.v.toFixed(2)} m/s over ${out.walk.dur.toFixed(2)} s, run ${out.run.v.toFixed(2)} m/s over ${out.run.dur.toFixed(2)} s`);
  return out;
}

class Bot {
  constructor(G, team, idx, shared) {
    this.G = G; this.team = team; this.idx = idx; this.name = NAMES[team][idx % NAMES[team].length]; this.isPlayer = false;
    this.rnd = rng(1000 + team * 100 + idx * 7);
    this.pos = V(0, 0, 0); this.vel = V(); this.yaw = 0; this.pitch = 0; this.health = 100; this.alive = false; this.crouch = 0; this.crouching = false;
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
      rul: bone('RightUpLeg'), rl: bone('RightLeg'), rft: bone('RightFoot'), lul: bone('LeftUpLeg'), ll: bone('LeftLeg'), lft: bone('LeftFoot') };
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
    this.speedAnim = 0; this.travelYaw = this.yaw; this.turnRate = 0; this.gunRaise = 0; this.gunBlocked = false; this.rifleKick = 0;
    this.plants = [null, null]; this.releasedPlants = [null, null];
    this.footGround = [this.pos.y, this.pos.y]; this.floorY = this.pos.y;
    this.gaitBlend = { left: 0, right: 0, back: 0 };
    this.nearby = [];
  }
  resetBrain() {
    this.state = 'advance'; this.target = null; this.seen = new Map(); this.lastKnown = null; this.lostT = 0; this.path = null; this.pathI = 0; this.repath = 0; this.goal = null;
    this.think = this.rnd() * 0.2; this.ammo = 30; this.reloadT = 0; this.burst = 0; this.burstCool = 0.4; this.fireCool = 0; this.engageT = 0; this.cover = null; this.peek = null; this.coverT = 0; this.atPeek = false;
    this.strafeT = 0; this.lookYaw = null; this.stuckT = 0; this.flinch = 0; this.hurtT = 9; this.reported = 0; this.searchT = 0;
  }

  spawn(sp) {
    this.pos.set(sp.x, groundAt(sp.x, sp.z, 0, BODY_RADIUS, this.G.world.colliders).y, sp.z);
    this.yaw = sp.yaw; this.pitch = 0; this.health = 100; this.alive = true; this.vel.set(0, 0, 0); this.crouch = 0; this.aim = 0; this.crouching = false;
    this.root.visible = true; this.gun.visible = true; this.model.quaternion.identity(); this.model.position.set(0, 0, 0);
    this.resetBrain(); this.resetBody(); this.mixer.timeScale = 1;
    this.prevX = this.pos.x; this.prevZ = this.pos.z; this.moveIntent = 0;
    this.animate(0, 0, this.G.world.colliders);
  }

  get eyeY() { return this.pos.y + lerp(1.6, 1.05, this.crouch); }
  get height() { return lerp(1.78, 1.2, this.crouch); }
  eye(out) { return out.set(this.pos.x, this.eyeY, this.pos.z); }

  damage(amount, from, attacker, zone) {
    if (!this.alive) return false;
    this.health -= amount; this.flinch = 1; this.hurtT = 0; this.vel.multiplyScalar(0.55);
    if (attacker && attacker.alive && attacker.team !== this.team) { this.noticed(attacker, 1); if (this.state !== 'combat') this.lookYaw = Math.atan2(from.x - this.pos.x, from.z - this.pos.z); }
    if (this.health <= 0) {
      this.alive = false; this.deadT = 0; this.respawnT = 4.5 + this.rnd() * 1.5; this.deaths++;
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z, l = Math.hypot(dx, dz) || 1;
      this.fall = { dir: V(dx / l, -0.08, dz / l), zone };                           // the ragdoll takes over on the next update
      this.G.onKill(attacker, this, zone === 'head');
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
        }
      }
      if (vis) {
        const rate = (1 / D.react) * clamp(1.6 - d / 60, 0.45, 1.6) * (e.crouching ? 0.75 : 1) * (e.vel.lengthSq() > 4 ? 1.3 : 1);
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
    this.goal = { x, z }; this.runTo = run; this.path = nav.path(this.pos.x, this.pos.z, x, z); this.pathI = 0; this.repath = 1.5 + this.rnd();
  }
  pickAdvanceGoal() {
    const B = this.G.bots, rep = B.reports[this.team].filter(r => this.G.time - r.when < 9);
    if (rep.length && this.rnd() < 0.7) { const r = rep[rep.length - 1]; this.setGoal(r.pos.x + (this.rnd() - 0.5) * 6, r.pos.z + (this.rnd() - 0.5) * 6, true); return; }
    const dirZ = this.team === 0 ? 1 : -1;
    let best = null, bs = -1e9;
    for (const h of HOTSPOTS) { const sc = (h[1] - this.pos.z) * dirZ * 0.04 + this.rnd() * 2.2 - Math.abs(h[0] - this.pos.x) * 0.012 - (Math.hypot(h[0] - this.pos.x, h[1] - this.pos.z) < 8 ? 3 : 0); if (sc > bs) { bs = sc; best = h; } }
    this.setGoal(best[0] + (this.rnd() - 0.5) * 3, best[1] + (this.rnd() - 0.5) * 3, this.rnd() < 0.5);
  }

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

  // ---- decisions --------------------------------------------------------------------------------------------------------
  brain(dt, actors, cols) {
    const G = this.G, D = DIFF[G.settings.difficulty] || DIFF.normal, R = this.rnd;
    const vis = this.perceive(dt, actors, cols);
    this.hurtT += dt;
    if (vis) {
      if (this.target !== vis) { this.target = vis; this.engageT = 0; }
      if (this.state !== 'combat') { this.state = 'combat'; this.cover = null; this.strafeT = 0; this.burstCool = 0.15 + R() * 0.3; }
      this.lastKnown = vis.pos.clone(); this.lostT = 0;
      this.reported += dt; if (this.reported > 1.2) { this.reported = 0; G.bots.report(this.team, vis.pos, this, vis); }
    } else if (this.state === 'combat') {
      this.lostT += dt;
      if (this.lostT > 1.3 && this.reloadT <= 0) { this.state = 'search'; this.searchT = 6 + R() * 3; this.cover = null; this.crouching = false; if (this.lastKnown) this.setGoal(this.lastKnown.x + (R() - 0.5) * 3, this.lastKnown.z + (R() - 0.5) * 3, R() < 0.5); }
    }

    let wish = null, speed = 0;
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
          else { wish = this.follow(); speed = Math.min(5.2, this.pathCap); }
        } else {
          if (c.peek.stand) this.crouching = false; else { this.crouching = false; t1.set(c.peek.x - this.pos.x, 0, c.peek.z - this.pos.z); if (t1.length() > 0.25) { wish = t1.normalize().clone(); speed = 1.8; } }
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
        if (this.strafeGoal && !holding) { t1.set(this.strafeGoal.x - this.pos.x, 0, this.strafeGoal.z - this.pos.z); if (t1.length() > 0.4) { wish = t1.normalize().clone(); speed = far ? 3.6 : 2.2; } }
      }
      // fire control: short controlled bursts, longer suppressive ones when the target ducks out of sight
      this.burstCool -= dt; this.fireCool -= dt;
      const aimErr = Math.abs(angDiff(this.yaw, this.wantYaw || 0));
      const canShoot = this.ammo > 0 && this.reloadT <= 0 && !this.gunBlocked && aimErr < 0.14 && (vis || (this.lostT < 1.1 && this.lastKnown && !this.crouching));
      if (this.ammo <= 0 && this.reloadT <= 0) { this.reloadT = BOT_RELOAD_DURATION; this.burst = 0; }
      if (canShoot && this.burst <= 0 && this.burstCool <= 0 && this.engageT > D.react * 0.6) { this.burst = vis ? 2 + (R() * (this.tDist < 15 ? 6 : 3) | 0) : 3 + (R() * 4 | 0); }
      if (this.burst > 0 && this.fireCool <= 0 && canShoot) {
        this.fireCool = 0.088; this.burst--; this.ammo--;
        if (this.burst <= 0) this.burstCool = (vis ? 0.3 : 0.6) + R() * (this.tDist > 30 ? 0.9 : 0.5);
        G.bots.fire(this, vis ? tg : null, D);
      }
    } else {
      this.crouching = false;
      if (this.state === 'search') { this.searchT -= dt; if (this.searchT <= 0 || !this.path) { this.state = 'advance'; this.goal = null; } if (!this.path || this.pathI >= this.path.length) this.lookYaw = (this.lookYaw ?? this.yaw) + dt * 1.6; }
      if (this.state === 'advance' && (!this.path || this.pathI >= this.path.length)) this.pickAdvanceGoal();
      wish = this.follow(); speed = Math.min(this.state === 'search' ? 2.2 : this.runTo ? 5.0 : 3.1, this.pathCap);
      if (wish) { this.wantYaw = Math.atan2(wish.x, wish.z); this.wantPitch = 0; }
      if (this.lookYaw != null && (!wish || this.state === 'search')) this.wantYaw = this.lookYaw;
      if (wish) this.lookYaw = null;
      if (this.ammo < 12 && this.reloadT <= 0) this.reloadT = BOT_RELOAD_DURATION;
    }
    this.wishDir = wish; this.wishSpeed = wish ? speed : 0;
  }

  follow() {
    if (!this.path || this.pathI >= this.path.length) return null;
    const p = this.path[this.pathI]; t1.set(p.x - this.pos.x, 0, p.z - this.pos.z); const d = t1.length();
    const n = this.path[this.pathI + 1];
    if (d < (n ? 0.48 : 0.32)) { this.pathI++; return this.follow(); }
    // ease off for the corner ahead (or the stop at the end) in proportion to how sharp it is
    if (!n) this.pathCap = Math.sqrt(16 * Math.max(0.06, d - 0.22));
    else { const turn = Math.abs(angDiff(Math.atan2(t1.x, t1.z), Math.atan2(n.x - p.x, n.z - p.z))); this.pathCap = lerp(6.5, 1.5, clamp(turn / 1.6, 0, 1)) + d * 1.3; }
    return t1.multiplyScalar(1 / d).clone();
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
      if (this.fall && this.root.visible) { this.rag = G.rigid.ragdoll(this, this.fall.dir, this.fall.zone); this.dropped = G.rigid.dropGun(this); this.fall = null; }
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
    this.repath -= dt;
    if (this.goal && this.repath <= 0 && this.state !== 'combat') { this.setGoal(this.goal.x, this.goal.z, this.runTo); }
    // Anticipate nearby bodies before interpenetration. Brake while changing direction or aiming off the run line.
    const want = this.wishDir, currentSpeed = Math.hypot(this.vel.x, this.vel.z);
    const aimAngle = want ? Math.abs(angDiff(this.yaw, Math.atan2(want.x, want.z))) : 0;
    const pace = this.state === 'combat' && aimAngle > 0.9 ? Math.min(this.wishSpeed, 2.65) : this.wishSpeed;
    const sp = this.moveIntent = pace * (this.crouching ? 0.5 : 1) * (1 - this.flinch * 0.5);
    let wx = want ? want.x * sp : 0, wz = want ? want.z * sp : 0;
    for (const a of actors) {
      if (a === this || !a.alive || Math.abs(a.pos.y - this.pos.y) > 0.9) continue;
      const ax = a.pos.x - this.pos.x, az = a.pos.z - this.pos.z;
      const d = Math.hypot(ax, az);
      if (d < 0.001 || d > 2.6) continue;
      const nx = ax / d, nz = az / d;
      const closing = (wx - a.vel.x) * nx + (wz - a.vel.z) * nz;
      const urgency = clamp((1.4 + clamp(closing * 0.23, 0, 1.1) - d) / 1.4, 0, 1);
      const forward = Math.max(0, wx * nx + wz * nz);
      const dodge = Math.min(1.7, forward * 0.66) * urgency;
      const side = want && want.x * nz - want.z * nx < -0.14 ? -1 : 1;
      const away = Math.max(0, BODY_SPACING + 0.22 - d) * 2.6 + forward * urgency;
      wx += -nx * away + nz * dodge * side;
      wz += -nz * away - nx * dodge * side;
    }
    const wishSpeed = Math.hypot(wx, wz);
    const dvx = wx - this.vel.x, dvz = wz - this.vel.z, dl = Math.hypot(dvx, dvz);
    const st = (wx * this.vel.x + wz * this.vel.z < currentSpeed * currentSpeed * 0.85 ? 12 : 7.2) * dt;
    if (dl <= st) { this.vel.x = wx; this.vel.z = wz; } else { this.vel.x += dvx / dl * st; this.vel.z += dvz / dl * st; }
    this.prevX = this.pos.x; this.prevZ = this.pos.z;
    const x = this.pos.x + this.vel.x * dt, z = this.pos.z + this.vel.z * dt;
    if (this.place(x, z, cols)) {
      const mx = (this.pos.x - this.prevX) / dt, mz = (this.pos.z - this.prevZ) / dt;
      if (Math.hypot(mx, mz) < Math.min(wishSpeed + 0.1, Math.hypot(this.vel.x, this.vel.z))) {
        this.vel.x = lerp(this.vel.x, mx, 0.6); this.vel.z = lerp(this.vel.z, mz, 0.6);
      }
    }
    return true;
  }

  place(x, z, cols) {
    // Use the physical floor for collision and smooth the visible body height independently.
    t4.set(x, this.floorY, z);
    const hit = resolveXZ(t4, BODY_RADIUS, this.height, cols);
    this.pos.x = t4.x; this.pos.z = t4.z;
    return hit;
  }

  finishMove(dt, cols) {
    const g = groundAt(this.pos.x, this.pos.z, this.floorY, BODY_RADIUS, cols);
    this.floorY = g.y; this.surf = g.surf;
    this.pos.y = damp(this.pos.y, this.floorY, 14, dt);
    const mx = this.pos.x - this.prevX, mz = this.pos.z - this.prevZ;
    const moved = Math.min(Math.hypot(mx, mz) / dt, Math.hypot(this.vel.x, this.vel.z) + 0.45);
    if (this.moveIntent > 1 && moved < 0.4) { this.stuckT += dt; if (this.stuckT > 0.9) { this.stuckT = 0; this.path = null; this.cover = null; this.strafeGoal = null; this.repath = 0; if (this.goal) this.setGoal(this.goal.x, this.goal.z, this.runTo); } } else this.stuckT = 0;
    // facing: the aim eases round to where it is wanted; the pelvis follows the feet and the spine makes up the difference
    if (this.wantYaw != null) { const maxRate = this.state === 'combat' ? 7.5 : 5; this.yawVel = damp(this.yawVel, clamp(angDiff(this.yaw, this.wantYaw) * 10, -maxRate, maxRate), 16, dt); this.yaw += this.yawVel * dt; }
    let tgt = this.bodyYaw; this.turning = Math.max(0, this.turning - dt);
    if (moved > 0.25) this.travelYaw += angDiff(this.travelYaw, Math.atan2(mx, mz)) * (1 - Math.exp(-13 * dt));
    if (moved > 0.55) {
      const mv = this.travelYaw, rel = Math.abs(angDiff(this.yaw, mv));
      this.back = rel > (this.back ? 1.75 : 2.05);                                   // moving away from where the rifle points: back-pedal
      const bodyTurn = this.state === 'combat' ? 0.24 : 1.05;
      tgt = this.yaw + clamp(angDiff(this.yaw, this.back ? mv + Math.PI : mv), -bodyTurn, bodyTurn);
    } else if (this.state !== 'combat' || Math.abs(angDiff(this.bodyYaw, this.yaw)) > 0.57 || this.turning > 0) { this.turning = 0.23; tgt = this.yaw; }
    const priorYaw = this.bodyYaw;
    this.bodyYaw += clamp(angDiff(this.bodyYaw, tgt), -dt * 6.5, dt * 6.5);
    const tw = angDiff(this.bodyYaw, this.yaw); if (Math.abs(tw) > 1.25) this.bodyYaw = this.yaw - Math.sign(tw) * 1.25;
    this.turnRate = damp(this.turnRate, angDiff(priorYaw, this.bodyYaw) / dt, 12, dt);
    this.pitch = damp(this.pitch, this.state === 'combat' ? (this.wantPitch || 0) : 0, 8, dt);
    this.crouch = damp(this.crouch, this.crouching ? 1 : 0, 7, dt);
    this.aim = damp(this.aim, this.state === 'combat' && this.reloadT <= 0 ? 1 : 0, 9, dt);
    this.flinch = damp(this.flinch, 0, 5, dt);
    this.animate(dt, moved, cols);
  }

  animate(dt, moved, cols) {
    const G = this.G, b = this.b, gait = G.bots.gait;
    // lean into acceleration and pace like a runner does; the whole figure pivots at the feet
    const ax = (this.vel.x - this.pvx) / Math.max(dt, 1e-3), az = (this.vel.z - this.pvz) / Math.max(dt, 1e-3); this.pvx = this.vel.x; this.pvz = this.vel.z;
    const by = this.bodyYaw, bfx = Math.sin(by), bfz = Math.cos(by);
    this.leanF = damp(this.leanF, clamp((ax * bfx + az * bfz) * 0.014 + (this.vel.x * bfx + this.vel.z * bfz) * 0.013, -0.12, 0.2), 6, dt);
    this.leanS = damp(this.leanS, clamp((ax * -bfz + az * bfx) * 0.018, -0.15, 0.15), 6, dt);
    this.root.position.copy(this.pos); this.root.rotation.y = by + Math.PI;            // the rig's rest pose faces -Z
    this.model.rotation.set(-this.leanF, 0, -this.leanS);
    // Keep both clips on the same stride. Turning on the spot advances it with shorter steps.
    this.speedAnim = damp(this.speedAnim, moved, 14, dt);
    const s = this.speedAnim, Wk = gait.walk, Rn = gait.run;
    const pivot = smooth(clamp((0.8 - s) / 0.8, 0, 1)) * clamp(Math.abs(this.turnRate) / 2.6, 0, 1);
    const wMove = clamp(Math.max(s / 0.67, pivot * 0.82), 0, 1);
    const wRun = smooth(clamp((s - Wk.v * 1.15) / Math.max(0.5, Rn.v * 0.88 - Wk.v * 1.15), 0, 1)) * (1 - this.crouch);
    const motionAngle = angDiff(by, this.travelYaw);
    directionBlend(this.gaitBlend, motionAngle, s, dt);
    const { left, right, back } = this.gaitBlend;
    const directional = left + right + back;
    const drift = motionAngle * (1 - pivot) * (1 - directional);
    const warp = clamp(left * angDiff(Math.PI / 2, motionAngle) + right * angDiff(-Math.PI / 2, motionAngle)
      + back * angDiff(Math.PI, motionAngle), -0.38, 0.38);
    this.act.idle.setEffectiveWeight(1 - wMove); this.act.walk.setEffectiveWeight(wMove * (1 - wRun)); this.act.run.setEffectiveWeight(wMove * wRun);
    const stepScale = clamp(Math.sqrt(s / Wk.v), 0.30, 1) * (1 - this.crouch * 0.32) * (1 - Math.abs(Math.sin(drift)) * 0.18);
    const clipStride = lerp(Wk.v * Wk.dur, Rn.v * Rn.dur, wRun);
    // At jogging pace, build cadence before opening into the full measured run stride.
    const jogLimit = lerp(2.4, clipStride, smooth(clamp((s - 3.1) / 1.65, 0, 1)));
    const stride = Math.min(clipStride, jogLimit) * stepScale;
    const reach = stride / clipStride;
    const contact = lerp(lerp(Wk.contact, Rn.contact, wRun), CONTACT, directional);
    const cycleLength = stride * (1 - directional) + (left + right) * STRAFE_STRIDE + back * BACK_STRIDE;
    const phaseBefore = this.phase;
    this.phase += Math.max(s / Math.max(0.35, cycleLength), pivot * (0.7 + 0.17 * Math.abs(this.turnRate))) * dt;
    this.phase -= Math.floor(this.phase);
    this.act.walk.time = ((this.phase + Wk.off) % 1) * Wk.dur; this.act.run.time = ((this.phase + Rn.off) % 1) * Rn.dur;
    this.mixer.update(dt);
    applyDirectionalGait(b, gait.directional, this.gaitBlend, this.phase);
    if (wMove > 0.60 && Math.floor(phaseBefore * 2) !== Math.floor(this.phase * 2)) G.bots.sound(this, 'step', s);

    this.nearby.length = 0;
    for (const c of cols) {
      const reach = c.hx + c.hz + 1.35;
      if (Math.abs(this.pos.x - c.x) <= reach && Math.abs(this.pos.z - c.z) <= reach &&
          c.y1 > this.floorY - STEP && c.y0 < this.pos.y + 2) this.nearby.push(c);
    }
    // The Character armature is rotated -90° around X, so hips Z is height in centimetres.
    const crouchDrop = this.crouch * lerp(0.35, 0.26, directional);
    b.hips.position.z -= crouchDrop * 100;
    b.spine.rotation.x += this.crouch * 0.34;
    this.root.updateMatrixWorld(true);
    const legPose = { bfx, bfz, drift, warp, walk: wMove, stride: lerp(reach, 1, directional), pivot, contact, directional, crouchDrop };
    this.poseFoot(0, b.lul, b.ll, b.lft, legPose, dt);
    this.poseFoot(1, b.rul, b.rl, b.rft, legPose, dt);
    // head: on the target in a fight, otherwise checking ahead and to the sides
    this.lookT -= dt;
    if (this.lookT <= 0) { this.lookT = 0.8 + this.rnd() * 2.2; this.lookGoal = this.state === 'combat' ? 0 : (this.rnd() - 0.5) * (moved > 1 ? 1.1 : 1.7); }
    this.headYaw = damp(this.headYaw, this.state === 'combat' ? 0 : this.lookGoal, 5, dt);
    b.neck.rotation.y += this.headYaw * 0.35; b.head.rotation.y += this.headYaw * 0.65; b.head.rotation.x -= this.pitch * this.aim * 0.3;
    poseBotRifle(this, dt);
  }

  poseFoot(i, thigh, knee, foot, pose, dt) {
    const { bfx: fx, bfz: fz, drift, warp, walk, stride, pivot, contact, directional, crouchDrop } = pose;
    foot.getWorldPosition(footPos);
    foot.getWorldQuaternion(footQuat);
    const dx = footPos.x - this.pos.x, dz = footPos.z - this.pos.z;
    const side = (dx * -fz + dz * fx) * (1 - pivot) + (i === 0 ? -0.13 : 0.13) * pivot;
    const along = (dx * fx + dz * fz) * lerp(1, stride, walk) * (1 - pivot * 0.35);
    const swingSide = side + Math.sin(drift) * along;
    const stanceSide = lerp(i === 0 ? Math.min(-0.078, swingSide) : Math.max(0.078, swingSide), swingSide, directional);
    const reach = Math.cos(drift) * along;
    const sin = Math.sin(warp), cos = Math.cos(warp);
    footPos.x = this.pos.x + (reach * fx - stanceSide * fz) * cos + (reach * fz + stanceSide * fx) * sin;
    footPos.z = this.pos.z + (reach * fz + stanceSide * fx) * cos - (reach * fx - stanceSide * fz) * sin;
    footPos.y += crouchDrop;

    const elapsed = (this.phase + i * 0.5) % 1;
    const stance = elapsed < contact;
    const flat = clamp(Math.abs(Math.sin(drift)) * walk + pivot * 0.55 + this.crouch * 0.4, 0, 1);
    q1.setFromAxisAngle(UP, this.bodyYaw + Math.PI).multiply(this.G.bots.gait.flatFoot[i]);
    footQuat.slerp(q1, flat);
    heelPos.copy(HEEL).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
    toePos.copy(TOE).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
    const cols = this.nearby;
    const heelGround = groundAt(heelPos.x, heelPos.z, this.floorY, 0.055, cols).y;
    const toeGround = groundAt(toePos.x, toePos.z, this.floorY, 0.055, cols).y;
    const floor = Math.max(heelGround, toeGround);
    this.footGround[i] = damp(this.footGround[i], floor, 18, dt);
    const heightAdjust = Math.max(this.footGround[i] - this.pos.y, floor - Math.min(heelPos.y, toePos.y) + 0.009);
    footPos.y += heightAdjust;

    if (!stance || walk < 0.25) {
      if (this.plants[i]) this.releasedPlants[i] = this.plants[i];
      this.plants[i] = null;
    } else if (!this.plants[i]) {
      this.plants[i] = { position: footPos.clone(), rotation: footQuat.clone() };
      this.releasedPlants[i] = null;
    }
    const plant = this.plants[i];
    const release = clamp((elapsed - contact) / 0.13, 0, 1);
    if (release === 1 || walk < 0.25) this.releasedPlants[i] = null;
    const anchor = plant || this.releasedPlants[i];
    if (anchor) {
      // Hold the directional plant through toe-off. Hand back to the authored swing once the boot lifts.
      const enter = smooth(clamp(elapsed / 0.065, 0, 1));
      const earlyRelease = smooth(clamp((contact - elapsed) / 0.085, 0, 1));
      const load = plant ? enter * lerp(earlyRelease, 1, directional) : directional * (1 - smooth(release));
      const limit = lerp(0.21, 0.46, directional);
      const w = walk * load * Math.min(1, limit / Math.max(0.01, footPos.distanceTo(anchor.position)));
      footPos.x = lerp(footPos.x, anchor.position.x, w);
      footPos.z = lerp(footPos.z, anchor.position.z, w);
      footQuat.slerp(anchor.rotation, w * directional);
    }

    // Both ends of the boot need horizontal clearance below the body capsule.
    heelPos.copy(HEEL).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
    toePos.copy(TOE).multiplyScalar(0.01).applyQuaternion(footQuat).add(footPos);
    for (const sample of [heelPos, toePos]) {
      soleProbe.copy(sample);
      if (resolveXZ(soleProbe, 0.066, 0.13, cols, 0.02)) {
        const x = soleProbe.x - sample.x, z = soleProbe.z - sample.z;
        footPos.x += x; footPos.z += z; toePos.x += x; toePos.z += z;
      }
    }
    thigh.getWorldPosition(legBase); knee.getWorldPosition(kneePos);
    legAxis.subVectors(footPos, legBase).normalize();
    kneePos.sub(legBase).addScaledVector(legAxis, -kneePos.dot(legAxis)).normalize();
    kneePos.lerp(soleProbe.set(fx, 0.10, fz), Math.max(flat, this.crouch) * 0.7);
    ik2(thigh, knee, foot, footPos, kneePos);
    // IK can shorten an overextended step, moving the boot back over a ledge. Check the solved sole too.
    if (cols.length > 0) {
      foot.getWorldPosition(legBase);
      heelPos.copy(HEEL).multiplyScalar(0.01).applyQuaternion(footQuat).add(legBase);
      toePos.copy(TOE).multiplyScalar(0.01).applyQuaternion(footQuat).add(legBase);
      const heelLift = groundAt(heelPos.x, heelPos.z, this.floorY, 0.055, cols).y - heelPos.y;
      const toeLift = groundAt(toePos.x, toePos.z, this.floorY, 0.055, cols).y - toePos.y;
      const lift = Math.max(heelLift, toeLift);
      if (lift > 0.015) {
        footPos.copy(legBase); footPos.y += lift + 0.009;
        ik2(thigh, knee, foot, footPos, kneePos);
      }
    }
    foot.parent.getWorldQuaternion(footParent);
    foot.quaternion.copy(footParent.invert().multiply(footQuat));
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
      if (!b.alive || b.team === sourceTeam || b.state === 'combat') continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d > radius || b.rnd() > 0.75) continue;
      const err = 1.5 + d * 0.16;
      b.state = 'search'; b.searchT = 5 + b.rnd() * 3; b.lookYaw = Math.atan2(pos.x - b.pos.x, pos.z - b.pos.z);
      b.setGoal(pos.x + (b.rnd() - 0.5) * err * 2, pos.z + (b.rnd() - 0.5) * err * 2, d > 25);
    }
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
    const err = 0.016 * D.err * (1 + Math.max(0, 0.6 - b.engageT) * 3.5) * (tg && tg.vel.lengthSq() > 9 ? 1.5 : 1) * (b.vel.lengthSq() > 2 ? 1.6 : 1) * (1 + b.flinch) * (b.crouching ? 0.85 : 1);
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
    const push = Math.min(BODY_SPACING - d, 0.18) * (b.isPlayer ? 1 : 0.5);
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
