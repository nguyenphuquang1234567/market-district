// First-person controller: input, movement and collision, camera feel, health, and the hitscan side of the carbine.
import * as THREE from 'three';
import { resolveXZ, groundAt, ceilingAt, rayBoxes, losClear } from './physics.js';
import { rayActor } from './bots.js';
import { clamp, damp, lerp, rng } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const tmp = V(), tmp2 = V();

export class Player {
  constructor(G) {
    this.G = G; this.team = 0; this.name = 'You'; this.isPlayer = true; this.rnd = rng(8080);
    this.pos = V(0, 0, -58); this.vel = V(); this.yaw = 0; this.pitch = 0; this.health = 100; this.alive = false;
    this.crouching = false; this.crouch = 0; this.grounded = true; this.eyeY0 = 1.62; this.camY = 1.62;
    this.keys = new Set(); this.mouse = { dx: 0, dy: 0, l: false, r: false, x: null, y: 0 }; this.sim = null;
    this.recoilY = 0; this.hipRecoilPitch = 0; this.punchP = 0; this.punchR = 0; this.fovKick = 0; this.shake = 0; this.bob = 0; this.stepD = 0; this.landDip = 0;
    this.hurtT = 9; this.deadT = 0; this.respawnT = 0; this.kills = 0; this.deaths = 0; this.inSun = true; this.interior = 0; this.probeT = 0; this.mantle = null; this.surf = 'concrete';
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    const el = G.R.renderer.domElement;
    this.inputCount = { keys: 0, moves: 0, clicks: 0 };
    addEventListener('keydown', e => { if (e.repeat) return; this.inputCount.keys++; this.keys.add(e.code); this.onKey(e.code); if (['Space', 'Tab', 'ControlLeft'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.clearInput());
    const captured = () => G.playing && (document.pointerLockElement === el || G.noLock);
    addEventListener('mousemove', e => {
      if (!captured()) return;
      this.inputCount.moves++;
      let dx = e.movementX || 0, dy = e.movementY || 0;
      if (!document.pointerLockElement) {       // unlocked fallback: movement deltas are unreliable here (WebKit), so follow the cursor position instead
        const { x, y } = this.mouse;
        dx = x === null ? 0 : clamp(e.clientX - x, -160, 160); dy = x === null ? 0 : clamp(e.clientY - y, -160, 160);
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      }
      this.mouse.dx += dx; this.mouse.dy += dy;
    });
    addEventListener('mousedown', e => { if (!captured()) return; this.inputCount.clicks++; if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', e => e.preventDefault());
  }

  clearInput() {
    this.keys.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.l = this.mouse.r = false;
    this.mouse.x = null;
  }

  get eyeY() { return this.pos.y + lerp(1.62, 1.08, this.crouch); }
  get height() { return lerp(1.8, 1.25, this.crouch); }
  get active() { return this.alive && this.G.playing; }

  onKey(code) {
    if (!this.active) return;
    const W = this.G.weapon, B = this.G.settings.binds, T = this.G.throw;
    if (code === B.frag) T.select('frag');
    else if (code === B.smoke) T.select('smoke');
    else if (code === B.reload) { if (T.busy) T.putAway(); else W.startReload(); }
    else if (code === B.mode) W.toggleMode();
    else if (code === B.inspect) W.inspect();
    else if (code === B.jump) this.tryJump();
  }

  spawn(sp) {
    this.pos.set(sp.x, 0, sp.z); this.vel.set(0, 0, 0); this.yaw = sp.yaw; this.pitch = 0; this.health = 100; this.alive = true; this.crouch = 0; this.crouching = false;
    this.recoilY = this.hipRecoilPitch = this.punchP = this.punchR = 0; this.camY = this.pos.y + 1.62; this.mantle = null; this.hurtT = 9;
    this.G.weapon.reset(); this.G.weapon.root.visible = true; this.G.throw?.restock();
  }

  damage(amount, from, attacker, zone) {
    if (!this.alive) return false;
    this.health -= amount; this.hurtT = 0;
    const G = this.G; G.audio.hurt(amount);
    const ang = Math.atan2(from.x - this.pos.x, from.z - this.pos.z) - this.yaw;
    G.hud.damageFrom(ang); this.punchP += 0.03 + amount * 0.0012; this.punchR += (this.rnd() - 0.5) * 0.06; this.flash = Math.min(1, (this.flash || 0) + 0.45 + amount / 80);
    if (this.health <= 0) {
      this.health = 0; this.alive = false; this.deadT = 0; this.respawnT = 4; this.deaths++;
      G.throw.dropHeld();
      G.weapon.root.visible = false; G.onKill(attacker, this, zone === 'head', zone);
      return true;
    }
    return false;
  }
  suppress(miss) { this.shake = Math.min(1, this.shake + (1.3 - miss) * 0.35); }

  tryJump() {
    if (!this.grounded || this.mantle) return;
    const G = this.G, cols = G.world.colliders, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // short mantle: a ledge between knee and chest height straight ahead, with room on top
    const rails = G.world.rails || [], out = {};
    const d = rayBoxes(this.pos.x, this.pos.y + 0.5, this.pos.z, fx, 0, fz, 0.95, cols, out);
    if (out.b && d < 0.95) {
      const top = out.b.y1, rise = top - this.pos.y;
      if (rise > 0.55 && rise < 1.45) {
        const tx = this.pos.x + fx * (d + 0.45), tz = this.pos.z + fz * (d + 0.45);
        const railed = rayBoxes(this.pos.x, top + 0.4, this.pos.z, fx, 0, fz, d + 0.8, rails, null) < d + 0.8;
        if (!railed && ceilingAt(tx, tz, top + 0.2, 0.3, cols) > top + 1.3) { this.mantle = { t: 0, from: this.pos.clone(), to: V(tx, top, tz) }; G.audio.cloth(1.6); return; }
      }
    }
    // Give a jump toward a reachable railing enough height to clear it while retaining horizontal momentum.
    const speed = Math.hypot(this.vel.x, this.vel.z), moving = speed > 0.5;
    const dx = moving ? this.vel.x / speed : fx, dz = moving ? this.vel.z / speed : fz;
    const reach = Math.max(1.05, speed * 0.43), railHit = {};
    const { x, y, z } = this.pos;
    const railDist = rayBoxes(x, y + 0.5, z, dx, 0, dz, reach, rails, railHit);
    const rise = railHit.b ? railHit.b.y1 - y : 0;
    const railJump = rise > 0.55 && rise <= 1.08
      && rayBoxes(x, y + 0.5, z, dx, 0, dz, railDist, cols, null) >= railDist;
    this.vel.y = railJump ? 8.1 : 6.3; this.grounded = false; G.audio.jump();
  }

  // One hitscan round. Returns nothing; applies damage, impact effects, tracer, recoil.
  fire(spread, kickYaw, kickPitch) {
    const G = this.G, cam = G.R.camera, R = this.rnd, W = G.weapon;
    const origin = cam.getWorldPosition(V()), dir = cam.getWorldDirection(V());
    const right = tmp.crossVectors(dir, UP).normalize().clone(), up = tmp2.crossVectors(right, dir).clone();
    const a = R() * 6.283, r = Math.sqrt(R()) * spread;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    // world (exact render geometry through the BVH) and characters
    this.ray.set(origin, dir); this.ray.far = 400;
    const hits = this.ray.intersectObjects(G.world.rayMeshes, false);
    let wt = 400, wh = null; for (const h of hits) if (h.distance < wt) { wt = h.distance; wh = h; }
    let victim = null, vt = wt, zone = 'body';
    const foes = G.bots.list;
    for (const b of foes) { if (!b.alive || b.team === this.team) continue; const h = rayActor(origin, dir, b, vt); if (h) { vt = h.t; victim = b; zone = h.zone; } }
    const ph = G.rigid.ray(origin, dir, victim ? vt : wt);                  // loose clutter and the fallen in the line of fire
    if (ph && G.rigid.bulletHit(ph, origin, dir, ph.t < 30)) { victim = null; wh = null; wt = vt = ph.t; }
    const muzzle = W.muzzleWorld(V()), end = origin.clone().addScaledVector(dir, victim ? vt : wt);
    let pen = false;
    if (!victim && wh) {
      const n = wh.face.normal.clone(); if (n.dot(dir) > 0) n.negate();
      const surf = wh.object.userData.surf || 'concrete', lit = losClear(tmp.copy(end).addScaledVector(n, 0.06), tmp2.copy(end).addScaledVector(G.R.sunDir, 80), G.world.colliders) ? 1 : 0.25;
      G.fx.impact(surf, end, n, lit); G.audio.impact(surf, { x: end.x, y: end.y, z: end.z }, wt < 30);
      G.bots.hear(end, 9, this.team);
      // shallow hits on hard surfaces skip off; thin wood / sheet metal / glass lets a weakened round through
      const graze = Math.abs(n.dot(dir));
      if ((surf === 'metal' || surf === 'concrete' || surf === 'plaster') && graze < 0.22 && R() < 0.7) { const rd = dir.clone().addScaledVector(n, -2 * dir.dot(n)).normalize(); G.fx.tracer(end.clone().addScaledVector(n, 0.02), end.clone().addScaledVector(rd, 9 + R() * 14), 220); }
      else if (surf === 'wood' || surf === 'glass' || surf === 'fabric' || (surf === 'metal' && wh.object.name !== 'iron')) {
        let pv = null, pt = wt + 7, pz = 'body';
        for (const b of foes) { if (!b.alive || b.team === this.team) continue; const h = rayActor(origin, dir, b, pt); if (h && h.t > wt) { pt = h.t; pv = b; pz = h.zone; } }
        if (pv) { victim = pv; zone = pz; vt = pt; pen = true; G.fx.impact('fabric', origin.clone().addScaledVector(dir, wt + 0.25), dir.clone(), lit, 0.6); }
      }
    }
    if (victim) {
      const base = zone === 'head' ? 100 : zone === 'limb' ? 27 : 36, dmg = base * (pen ? 0.3 : 1), p = origin.clone().addScaledVector(dir, vt);
      const killed = victim.damage(dmg, this.pos, this, zone);
      G.fx.impact('fabric', p, dir.clone().negate(), 0.9, 0.7);
      G.hud.hitmarker(killed ? 'kill' : zone === 'head' ? 'head' : pen ? 'weak' : 'hit'); G.audio.ui(zone === 'head' ? 'head' : 'hit');
    }
    if (W.ammo % 3 === 0) G.fx.tracer(muzzle, end, 380);
    G.fx.muzzleSmoke(muzzle, dir, W.heat);
    const ej = W.ejectWorld(V()), camRight = V(1, 0, 0).applyQuaternion(cam.quaternion);
    G.fx.casing(ej, V(camRight.x * (1.6 + R()) + this.vel.x, 1.4 + R() * 0.9, camRight.z * (1.6 + R()) + this.vel.z).addScaledVector(dir, -0.6 - R() * 0.5), this.pos.y);
    if (this.pos.y + 1.4 - muzzle.y > 0.9 || this.crouch > 0.5) G.fx.kickDust(V(muzzle.x + dir.x * 0.6, this.pos.y + 0.03, muzzle.z + dir.z * 0.6), this.inSun ? 1 : 0.3);
    G.audio.shot(W.shots); G.bots.hear(this.pos, 60, this.team);
    this.recoilY += kickYaw; this.hipRecoilPitch = Math.min(0.009, this.hipRecoilPitch + kickPitch); this.fovKick = 1;
    G.stats.shots++; if (victim) G.stats.hits++;
  }

  update(dt) {
    const G = this.G, cam = G.R.camera, S = G.settings, cols = G.world.colliders, rails = G.world.rails || [], W = G.weapon, B = S.binds;
    const sim = this.sim, key = c => this.keys.has(c);
    const input = this.active ? (sim || { f: (key(B.forward) ? 1 : 0) - (key(B.back) ? 1 : 0), s: (key(B.right) ? 1 : 0) - (key(B.left) ? 1 : 0), sprint: key(B.sprint), crouch: key(B.crouch) || key('ControlLeft'), fire: this.mouse.l, ads: this.mouse.r }) : { f: 0, s: 0 };
    // ---- death camera / respawn
    if (!this.alive) {
      this.deadT += dt; this.respawnT -= dt;
      this.camY = damp(this.camY, this.pos.y + 0.28, 4, dt); this.punchR = damp(this.punchR, 1.15, 4, dt);
      cam.position.set(this.pos.x, this.camY, this.pos.z); cam.rotation.set(damp(this.pitch, -0.2, 3, dt), this.yaw + Math.PI, this.punchR, 'YXZ');
      if (this.respawnT <= 0 && G.matchLive) { const sp = G.bots.pickSpawn(this.team); if (sp) this.spawn(sp); }
      this.mouse.dx = this.mouse.dy = 0;
      return;
    }
    // ---- look
    const adsK = W.ads, fovBase = S.fov, fovAds = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovBase / 2)) / 1.35));
    const sens = 0.0021 * S.sensitivity * lerp(1, S.adsSens * (fovAds / fovBase), adsK);
    const ldx = this.active ? this.mouse.dx : 0, ldy = this.active ? this.mouse.dy : 0; this.mouse.dx = this.mouse.dy = 0;
    this.yaw -= ldx * sens; this.pitch = clamp(this.pitch - ldy * sens * (S.invertY ? -1 : 1), -1.5, 1.5);
    if (sim && sim.yaw != null) { this.yaw = sim.yaw; this.pitch = sim.pitch || 0; }
    // ---- move (fixed sub-steps so collision is frame-rate independent)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -fz, rz = fx;
    let wx = fx * input.f + rx * input.s, wz = fz * input.f + rz * input.s; const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    this.crouching = !!input.crouch && this.grounded;
    if (!this.crouching && this.crouch > 0.5 && ceilingAt(this.pos.x, this.pos.z, this.pos.y + 1.3, 0.3, cols) < this.pos.y + 1.85) this.crouching = true;   // no room to stand
    const sprinting = !!input.sprint && input.f > 0 && !this.crouching && !input.ads;
    const maxSp = this.crouching ? 2.2 : sprinting ? (input.fire || W.sinceShot < 0.32 ? 6.2 : 7.2) : lerp(4.3, 2.7, adsK);     // firing on the run costs some pace
    this.crouch = damp(this.crouch, this.crouching ? 1 : 0, 11, dt);
    let landed = 0;
    if (this.mantle) {
      const m = this.mantle; m.t += dt / 0.36; const k = Math.min(1, m.t), e = k * k * (3 - 2 * k);
      this.pos.x = lerp(m.from.x, m.to.x, e * e); this.pos.z = lerp(m.from.z, m.to.z, e * e); this.pos.y = lerp(m.from.y, m.to.y, Math.min(1, e * 1.5));
      this.vel.set(0, 0, 0); this.grounded = true; if (k >= 1) this.mantle = null;
    } else {
      const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const acc = this.grounded ? 46 : 9, tx = wx * maxSp, tz = wz * maxSp;
        const dvx = tx - this.vel.x, dvz = tz - this.vel.z, dl = Math.hypot(dvx, dvz), st = (this.grounded || wl > 0 ? acc : 0) * h;
        if (dl <= st) { this.vel.x = tx; this.vel.z = tz; } else { this.vel.x += (dvx / dl) * st; this.vel.z += (dvz / dl) * st; }
        this.vel.y -= 21 * h;
        this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; this.pos.y += this.vel.y * h;
        resolveXZ(this.pos, 0.34, this.height, rails, 0);   // railings stop the body outright (no stepping over the top rail) and are no floor
        resolveXZ(this.pos, 0.34, this.height, cols);
        const g = groundAt(this.pos.x, this.pos.z, this.pos.y, 0.34, cols);
        if (this.pos.y <= g.y) { if (!this.grounded && this.vel.y < -3) landed = Math.max(landed, -this.vel.y); this.pos.y = g.y; this.vel.y = 0; this.grounded = true; this.surf = g.surf || G.world.surfaceAt(this.pos.x, this.pos.z); }
        else if (this.grounded && this.vel.y <= 0 && this.pos.y - g.y < 0.3) { this.pos.y = g.y; this.vel.y = 0; }      // stick to steps / kerbs going down
        else this.grounded = false;
        if (this.vel.y > 0) { const c = ceilingAt(this.pos.x, this.pos.z, this.pos.y + this.height, 0.3, cols); if (this.pos.y + this.height > c) { this.pos.y = c - this.height; this.vel.y = 0; } }
      }
      this.pos.x = clamp(this.pos.x, -47, 112); this.pos.z = clamp(this.pos.z, -81, 81);      // (the old district and the market quarter east of it)
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (landed) { const v = clamp(landed / 9, 0.25, 1); this.landDip = v; W.land = v; G.audio.land(v, this.surf); G.bots.hear(this.pos, 12, this.team); }
    // footsteps
    if (this.grounded && speed > 0.6) {
      this.stepD += speed * dt; this.bob += speed * dt * (sprinting ? 1.55 : 1.75);
      if (this.stepD > (sprinting ? 2.5 : this.crouching ? 1.5 : 2.0)) { this.stepD = 0; G.audio.step(this.surf, this.crouching ? 0.35 : sprinting ? 1 : 0.65); if (sprinting) G.bots.hear(this.pos, 11, this.team); }
    }
    // ---- environment probes: sun / shade / interior drive exposure, reverb and optic brightness
    this.probeT -= dt;
    if (this.probeT <= 0) {
      this.probeT = 0.15; const eye = tmp.set(this.pos.x, this.eyeY, this.pos.z);
      this.inSun = losClear(eye, tmp2.copy(eye).addScaledVector(G.R.sunDir, 90), cols);
      this.interior = ceilingAt(this.pos.x, this.pos.z, this.eyeY, 0.2, cols) < this.eyeY + 3.2 ? 1 : 0;
    }
    // ---- health: delayed regeneration
    this.hurtT += dt; if (this.hurtT > 5 && this.health < 100) this.health = Math.min(100, this.health + 14 * dt);
    this.flash = Math.max(0, (this.flash || 0) - dt * 2.2);
    // ---- camera
    this.recoilY = damp(this.recoilY, 0, W.sinceShot < 0.12 ? 2.5 : 9, dt);
    this.hipRecoilPitch = input.ads ? 0 : damp(this.hipRecoilPitch, 0, 6, dt);
    this.punchP = damp(this.punchP, 0, 9, dt); this.punchR = damp(this.punchR, 0, 9, dt); this.landDip = damp(this.landDip, 0, 8, dt); this.fovKick = damp(this.fovKick, 0, 16, dt); this.shake = damp(this.shake, 0, 6, dt);
    const targetY = this.eyeY - this.landDip * 0.12;
    this.camY = Math.abs(targetY - this.camY) > 1.2 ? targetY : damp(this.camY, targetY, 22, dt);
    const bobA = Math.min(1, speed / 4.3) * (this.grounded ? 1 : 0) * (1 - adsK * 0.7) * S.bob;
    const sh = this.shake * S.shake, t = G.time;
    cam.position.set(this.pos.x + rx * Math.cos(this.bob) * 0.012 * bobA, this.camY + Math.abs(Math.sin(this.bob)) * -0.022 * bobA, this.pos.z + rz * Math.cos(this.bob) * 0.012 * bobA);
    cam.rotation.set(this.pitch + this.hipRecoilPitch + this.punchP + Math.sin(t * 47) * 0.004 * sh, this.yaw + Math.PI + this.recoilY + Math.sin(t * 39 + 1) * 0.004 * sh, this.punchR + Math.cos(this.bob) * 0.004 * bobA + (input.s || 0) * -0.012 * Math.min(1, speed / 4), 'YXZ');
    const fov = lerp(fovBase, fovAds, adsK) + (sprinting ? 4 : 0) * Math.min(1, speed / 6) + this.fovKick * lerp(0.9, 0.5, adsK);
    cam.fov = damp(cam.fov, fov, 14, dt); cam.updateProjectionMatrix();
    // ---- weapon
    const dir = cam.getWorldDirection(tmp), wallDist = rayBoxes(this.pos.x, this.camY, this.pos.z, dir.x, dir.y, dir.z, 1.4, cols, null);
    const T = G.throw, hands = T.busy;                      // with a grenade in the hands the buttons belong to it
    T.hands(dt, { fire: !!input.fire, alt: !!input.ads, speed, grounded: this.grounded, wallDist });
    W.update(dt, { fire: !hands && !!input.fire, ads: !hands && !!input.ads, sprinting, moving: Math.min(1, speed / 4.3), speed, crouch: this.crouching, grounded: this.grounded, lookDX: ldx / Math.max(dt, 1e-3) * 0.016, lookDY: ldy / Math.max(dt, 1e-3) * 0.016, wallDist, inSun: this.inSun });
    if (W.heat > 0.25 && W.sinceShot > 0.1 && W.sinceShot < 2.2 && this.rnd() < dt * 22) G.fx.barrelSmoke(W.muzzleWorld(V()), W.heat);
  }
}
