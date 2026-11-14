// Scripted acceptance run through the real game systems. In the browser console: await G.selfTest()
// Uses fixed time steps and the seeded RNGs, so results are repeatable.
import { BOT_RELOAD_DURATION } from './weapon.js';

export function selfTest(G) {
  const P = G.player, W = G.weapon, out = [], $ = id => document.getElementById(id), clamp1 = v => Math.max(-1, Math.min(1, v));
  const check = (name, pass, detail = '') => out.push({ name, pass: !!pass, detail: String(detail) });
  const run = (secs, dt = 1 / 60) => G.step(Math.round(secs / dt), dt);
  const park = () => { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };
  const dummy = (i, x, z, yaw = Math.PI) => { const b = G.bots.list[i]; b.spawn({ x, z, yaw }); b.think = 1e9; b.wishDir = null; b.wishSpeed = 0; return b; };
  G.manual = true; G.auto = true; G.frozen = true;
  G.resetMatch(); G.playing = true; G.hud.show(null);

  // --- startup
  check('match starts live with full kit', G.matchLive && P.alive && P.health === 100 && W.ammo === 30 && W.reserve === 120, `hp ${P.health} ammo ${W.ammo}/${W.reserve}`);
  park();

  // --- movement and collision
  G.goto(0, -50, 0); P.sim.f = 1; run(2); const walked = P.pos.z + 50;
  check('walk speed ~4.3 m/s', walked > 7.5 && walked < 9, walked.toFixed(2) + ' m in 2 s');
  P.sim.sprint = true; const z0 = P.pos.z; run(1); check('sprint is faster', P.pos.z - z0 > 5.5, (P.pos.z - z0).toFixed(2) + ' m/s'); P.sim.sprint = false;
  P.sim.crouch = true; run(0.5); const zc = P.pos.z; run(1); check('crouch slows and lowers the eye', P.pos.z - zc < 2.6 && P.eyeY < 1.2, `${(P.pos.z - zc).toFixed(2)} m/s, eye ${P.eyeY.toFixed(2)}`); P.sim.crouch = false; P.sim.f = 0; run(0.4);
  G.goto(0.5, -36, 0); run(0.2); P.tryJump(); run(0.25); const air = P.pos.y; run(1); check('jump leaves the ground and lands', air > 0.5 && P.grounded && P.pos.y < 0.01, `apex sample ${air.toFixed(2)} m`);
  G.goto(2.5, -40, -90); P.sim.f = 1; run(3); check('steps up the kerb and is stopped by the wall', Math.abs(P.pos.y - 0.14) < 0.02 && P.pos.x > -5.7 && P.pos.x < -4.9, `x ${P.pos.x.toFixed(2)} y ${P.pos.y.toFixed(2)}`); P.sim.f = 0;
  G.goto(-1.6, -47.95, 0); run(0.2); P.tryJump(); run(0.6); check('mantles a chest-high barrier', P.pos.y > 0.6, `y ${P.pos.y.toFixed(2)}`);

  // --- gunplay
  G.goto(0, -30, 0, -3); run(0.3); const d0 = G.fx.decals.dirt.im.count + G.fx.decals.stone.im.count;
  P.sim.fire = true; run(0.4); P.sim.fire = false; run(0.2);
  const fired = 30 - W.ammo; check('automatic fire consumes rounds and leaves decals', fired >= 4 && fired <= 7 && G.fx.decals.dirt.im.count + G.fx.decals.stone.im.count > d0, `${fired} rounds in 0.4 s`);
  W.toggleMode(); const a0 = W.ammo; P.sim.fire = true; run(0.4); P.sim.fire = false; run(0.1); check('semi-auto fires once per press', a0 - W.ammo === 1, `${a0 - W.ammo} round`); W.toggleMode();
  W.startReload(); run(1.0); const mid = W.ammo; run(1.3); check('tactical reload refills at the insert, not before', mid < 30 && W.ammo === 30 && !W.reloading, `mid ${mid} → ${W.ammo}, reserve ${W.reserve}`);
  W.ammo = 1; P.sim.fire = true; run(0.5); P.sim.fire = false; run(1.65); check('empty magazine reload seats a fresh magazine and closes the bolt', W.ammo === 30 && W.reloadEmpty && !W.reloading && Math.abs(W.bolt.position.z) < 0.001, `ammo ${W.ammo}`);
  P.sim.ads = true; run(0.5); check('aiming narrows the view and centres the optic', W.ads > 0.95 && G.R.camera.fov < 50 && Math.abs(W.root.position.x) < 0.002, `fov ${G.R.camera.fov.toFixed(1)}`); P.sim.ads = false; run(0.4);

  // --- hits, zones, scoring
  let foe = dummy(3, 0, -18); G.goto(0, -30, 0, 0); run(0.3);
  P.sim.pitch = Math.atan2(1.15 - P.eyeY, 12); P.sim.ads = true; run(0.5); W.toggleMode();
  const hp0 = foe.health; P.sim.fire = true; run(0.05); P.sim.fire = false; run(0.15);
  check('body hit registers', hp0 - foe.health > 30 && hp0 - foe.health < 40, `${(hp0 - foe.health).toFixed(0)} damage`);
  P.sim.pitch = Math.atan2(foe.pos.y + foe.height - 0.13 - P.eyeY, 12); run(0.4); const s0 = G.score[0];
  P.sim.fire = true; run(0.05); P.sim.fire = false; run(0.2);
  check('headshot eliminates, scores and reaches the kill feed', !foe.alive && G.score[0] === s0 + 1 && P.kills === 1 && $('feed').children.length > 0, `score ${G.score}`);
  W.toggleMode(); P.sim.ads = false;

  // --- AI perception: field of view, occlusion, detection delay
  park(); foe = dummy(4, 0, -16, 0); G.goto(0, -26, 0); foe.think = 0; foe.wishDir = null; foe.yaw = 0; foe.wantYaw = 0;
  foe.perceive(0.5, [P], G.world.colliders); check('enemy facing away does not notice the player', (foe.seen.get(P)?.t || 0) < 0.01, `awareness ${(foe.seen.get(P)?.t || 0).toFixed(2)}`);
  foe.yaw = Math.PI; let t = 0; while (t < 2 && !(foe.seen.get(P)?.vis)) { foe.perceive(0.05, [P], G.world.colliders); t += 0.05; }
  check('enemy facing the player detects after a short delay', t > 0.1 && t < 1.2, `${t.toFixed(2)} s`);
  foe.seen.clear(); G.goto(-29, -26, 0); P.pos.set(-29, 0, -26); for (let i = 0; i < 40; i++) foe.perceive(0.05, [P], G.world.colliders);
  check('no detection through buildings', (foe.seen.get(P)?.t || 0) === 0, 'player one block over');
  foe.think = 1e9; park();

  // --- damage, critical state, death, respawn, regeneration
  G.goto(0, -45, 0); run(0.2); P.damage(75, { x: 5, z: -45 }, null, 'body'); run(0.1);
  check('damage lowers health and shows a directional indicator', Math.round(P.health) === 25 && +$('dmg').style.opacity > 0.5 && $('health').classList.contains('low'), `hp ${P.health.toFixed(0)}`);
  run(7.5); check('health regenerates after a delay', P.health > 55, `hp ${P.health.toFixed(0)} after 7.5 s`);
  const s1 = G.score[1]; P.damage(200, { x: 5, z: -45 }, null, 'body'); run(0.2);
  check('death disables the player and scores for the other team', !P.alive && G.score[1] === s1 + 1 && $('dead').classList.contains('on'), `score ${G.score}`);
  run(4.2); check('respawn restores health and ammunition', P.alive && P.health === 100 && W.ammo === 30, `hp ${P.health}`);

  // --- match end by score, restart, end by time
  park(); foe = dummy(5, P.pos.x, P.pos.z + 8); G.score[0] = 29; foe.damage(500, P.pos, P, 'body');
  check('score limit ends the match with a results screen', !G.matchLive && $('results').classList.contains('on') && $('resTitle').textContent === 'VICTORY', $('resTitle').textContent);
  G.resetMatch(); G.playing = true; G.hud.show(null);
  check('restart resets score, clock, feed and effects', G.matchLive && G.score[0] === 0 && G.score[1] === 0 && Math.round(G.timeLeft) === 600 && $('feed').children.length === 0 && G.fx.decals.stone.im.count === 0, `score ${G.score} time ${Math.round(G.timeLeft)}`);
  G.timeLeft = 0.05; run(0.2); check('time limit ends the match', !G.matchLive && $('results').classList.contains('on'), $('resStats').querySelector('.sum')?.textContent || '');

  // --- an unscripted bot-only stretch: both teams should find each other and trade
  G.resetMatch(); G.playing = true; G.hud.show(null); P.sim = { f: 0, s: 0 }; G.goto(-29, -61, 0);
  for (let i = 0; i < 90; i++) { run(1, 1 / 30); P.health = 100; }
  const fights = G.bots.list.reduce((s, b) => s + b.kills, 0);
  check('bots navigate, engage and score on their own (90 s)', fights >= 3, `${fights} eliminations, score ${G.score}`);

  // --- firing on the run
  G.resetMatch(); G.playing = true; G.hud.show(null); park();
  const Rg = G.rigid, nav = G.world.nav, wrap = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  G.goto(0, -50, 0); P.sim = { f: 1, s: 0, sprint: true }; run(0.8); const am0 = W.ammo; P.sim.fire = true; run(0.6); const runSp = Math.hypot(P.vel.x, P.vel.z); P.sim.fire = false;
  check('the rifle fires while sprinting, at a cost in pace', am0 - W.ammo >= 4 && Math.abs(runSp - 6.2) < 0.15, `${am0 - W.ammo} rounds at ${runSp.toFixed(1)} m/s`);
  P.sim = { f: 0, s: 0 }; run(0.4);

  // --- loose props: shoved by walking into them, knocked about by bullets
  let prop = null, from = null;
  for (const it of Rg.props) {
    if (it.name !== 'chair' && it.name !== 'plastic_crate' && it.name !== 'stool') continue;
    for (const [dx, dz] of [[0, -2.2], [0, 2.2], [2.2, 0], [-2.2, 0]]) { const x = it.home.x + dx, z = it.home.z + dz; if (nav.free(x, z) && nav.walkable(x, z, it.home.x + dx * 0.35, it.home.z + dz * 0.35)) { prop = it; from = { x, z, yaw: Math.atan2(-dx, -dz) }; break; } }
    if (prop) break;
  }
  if (prop) {
    G.goto(from.x, from.z, from.yaw * 180 / Math.PI, 0); run(1.5);
    const c0 = prop.body.translation(), sx = c0.x, sz = c0.z;
    P.sim = { f: 1, s: 0, yaw: from.yaw, pitch: 0 }; run(0.9); P.sim = { f: 0, s: 0, yaw: from.yaw, pitch: 0 }; run(0.6);
    const c1 = prop.body.translation(), pushed = Math.hypot(c1.x - sx, c1.z - sz), bx = c1.x, by = c1.y, bz = c1.z;
    check('walking into loose clutter shoves it aside', pushed > 0.15, `${prop.name} moved ${pushed.toFixed(2)} m`);
    G.goto(P.pos.x - Math.sin(from.yaw) * 1.1, P.pos.z - Math.cos(from.yaw) * 1.1, from.yaw * 180 / Math.PI, 0); run(0.3);            // step back and shoot its centre of mass
    const cm = prop.body.worldCom(), dist = Math.hypot(cm.x - P.pos.x, cm.z - P.pos.z), hits0 = G.stats.shots;
    P.sim = { f: 0, s: 0, yaw: Math.atan2(cm.x - P.pos.x, cm.z - P.pos.z), pitch: -Math.atan2(P.eyeY - cm.y, dist), fire: true }; run(0.4); P.sim.fire = false; run(0.8);
    const c2 = prop.body.translation(), knocked = Math.hypot(c2.x - bx, c2.y - by, c2.z - bz);
    check('bullets knock loose clutter about', knocked > 0.03, `${G.stats.shots - hits0} rounds moved it ${knocked.toFixed(2)} m`);
  } else check('a loose prop with open ground beside it exists', false, 'none found');
  P.sim = { f: 0, s: 0 };

  // --- ragdoll: the body falls under physics, the rifle drops, and a corpse is left when the soldier respawns
  park(); G.goto(0, -50, 0); let dead = dummy(5, 0, -44); run(0.3);
  dead.damage(500, P.pos, P, 'body'); dead.respawnT = 3.4; run(0.05);
  const rag = dead.rag, h0 = rag ? rag.height() : 0, dropped = !!dead.dropped; run(2.8);
  const h1 = rag ? rag.height() : 9, rsp = rag ? rag.speed() : 9;
  check('a kill hands the body to a ragdoll that falls and comes to rest', !!rag && dropped && h0 > 0.9 && h1 < 0.45 && rsp < 0.6, `chest ${h0.toFixed(2)} m -> ${h1.toFixed(2)} m, still moving ${rsp.toFixed(2)} m/s, rifle dropped ${dropped}`);
  run(1.2);
  check('the body stays behind when the soldier respawns', dead.alive && !dead.rag && Rg.corpses.length === 1 && Rg.rags.length === 0, `corpses ${Rg.corpses.length}, live ragdolls ${Rg.rags.length}`);

  // --- bot locomotion: pace changes within human limits, strides that match ground speed, boots that stay where they land,
  //     corners walked as arcs clear of the walls; then the rifle stays on target while the legs go elsewhere
  park(); const wk = dummy(6, 0, -50, 0); wk.state = 'advance'; wk.wishDir = { x: 0, z: 1 }; wk.wishSpeed = 3.4; wk.wantYaw = 0;
  let halves = 0, lastHalf = Math.floor(wk.phase * 2), maxAcc = 0, pv = 0; const zs = wk.pos.z;
  for (let i = 0; i < 180; i++) { G.step(1, 1 / 60); const h = Math.floor(wk.phase * 2); if (h !== lastHalf) { halves++; lastHalf = h; } const sp = Math.hypot(wk.vel.x, wk.vel.z); maxAcc = Math.max(maxAcc, Math.abs(sp - pv) * 60); pv = sp; }
  const went = wk.pos.z - zs, stepLen = went / Math.max(1, halves);
  check('bot builds up to a jog no faster than a person can, on strides that match its ground speed', halves >= 5 && stepLen > 0.55 && stepLen < 1.4 && maxAcc < 4.2 && went > 6.5 && wk.runGait > 0.9,
    `${went.toFixed(1)} m in ${halves} steps (${stepLen.toFixed(2)} m each), peak ${maxAcc.toFixed(1)} m/s², ${pv.toFixed(1)} m/s at a run after 3 s`);
  // How far the weight-bearing part of each sole wanders between landing and lifting off.
  // The sole's low point is under the heel, under the ball of the foot, or the toe cap (which bends with the toe joint).
  const sole = new G.THREE.Vector3();
  const soleDrift = (bot, frames) => {
    const held = [null, null]; let worst = 0, contacts = 0;
    for (let f = 0; f < frames; f++) {
      G.step(1, 1 / 60);
      [[bot.b.lft, bot.b.ltoe], [bot.b.rft, bot.b.rtoe]].forEach(([foot, toeJoint], side) => {
        const plant = bot.plants[side];
        let low = null, lowY = 9, which = 0;
        [[foot, 0, -2, 13.3, 0], [foot, 0, 15.8, 12.7, 0], [toeJoint, 1.22, 7.97, -0.04, 0.019]].forEach(([bone, x, y, z, drop], k) => {
          bone.localToWorld(sole.set(x, y, z));
          if (sole.y - drop < lowY) { lowY = sole.y - drop; which = k; low = { x: sole.x, z: sole.z }; }
        });
        if (!plant || lowY - bot.floorY > 0.02) { held[side] = null; return; }
        const prior = held[side];
        if (prior && prior.plant === plant && prior.which === which) { worst = Math.max(worst, Math.hypot(low.x - prior.x, low.z - prior.z)); contacts++; }
        else held[side] = { plant, which, x: low.x, z: low.z };
      });
    }
    return { worst, contacts };
  };
  const jogSole = soleDrift(wk, 90);
  dummy(6, 0, -50, 0); wk.state = 'advance'; wk.wishDir = { x: 0, z: 1 }; wk.wishSpeed = 1.7; wk.wantYaw = 0; run(1.6);
  const walkSole = soleDrift(wk, 120), walkGait = wk.runGait;
  check('walking and running boots stay where they land', walkSole.contacts > 40 && jogSole.contacts > 20 && walkSole.worst < 0.03 && jogSole.worst < 0.03 && walkGait < 0.1,
    `sole drift ${(walkSole.worst * 100).toFixed(1)} cm walking (${walkSole.contacts} contact frames), ${(jogSole.worst * 100).toFixed(1)} cm running (${jogSole.contacts})`);
  // a route with a right-angle street corner, taken at a run
  dummy(6, 0.5, -36, 0); wk.state = 'advance'; wk.setGoal(16, -20.5, true); wk.onPath = true; wk.wishSpeed = 4.6; wk.bumps = 0;
  let lapAcc = 0, lapSide = 0, lapTurn = 0, lapSkew = 0, lapSlow = 9, lapTop = 0, lapT = 0, lx = wk.pos.x, lz = wk.pos.z, lvx = 0, lvz = 0, lh = wk.heading;
  while (lapT < 16 && wk.path && wk.pathI < wk.path.length) {
    G.step(1, 1 / 60); lapT += 1 / 60;
    const vx = (wk.pos.x - lx) * 60, vz = (wk.pos.z - lz) * 60, sp = Math.hypot(vx, vz), rate = Math.abs(wrap(lh, wk.heading)) * 60;
    if (lapT > 0.05) lapAcc = Math.max(lapAcc, Math.hypot(vx - lvx, vz - lvz) * 60);
    lapSide = Math.max(lapSide, sp * rate); lapTurn = Math.max(lapTurn, rate); lapTop = Math.max(lapTop, sp);
    if (sp > 1) lapSkew = Math.max(lapSkew, Math.abs(wrap(wk.bodyYaw, Math.atan2(vx, vz))));
    if (lapT > 2 && wk.pathLeft > 4) lapSlow = Math.min(lapSlow, sp);
    lx = wk.pos.x; lz = wk.pos.z; lvx = vx; lvz = vz; lh = wk.heading;
  }
  run(0.6);
  const lapMiss = Math.hypot(wk.pos.x - 16, wk.pos.z + 20.5);
  check('bot takes a street corner as an arc: no wall contact, no stop, sideways load and braking a person could manage', lapMiss < 0.5 && wk.bumps === 0 && lapSide < 4.4 && lapAcc < 6 && lapTurn < 3.2 && lapSlow > 1.2 && lapSlow < lapTop - 0.8 && lapSkew < 0.35 && Math.hypot(wk.vel.x, wk.vel.z) < 0.05,
    `${lapT.toFixed(1)} s, top ${lapTop.toFixed(1)} m/s, ${lapSlow.toFixed(1)} m/s through the corner, ${lapSide.toFixed(1)} m/s² sideways, ${lapAcc.toFixed(1)} m/s² peak, ${wk.bumps} wall contacts, stopped ${(lapMiss * 100).toFixed(0)} cm from the mark`);
  // up a kerb, along the pavement and down again: the legs must not be thrown about, and the body rises on them
  dummy(6, 2.4, -52, 0.52); wk.state = 'advance';
  const hipsAt = new G.THREE.Vector3(), hipJoint = hipsAt.clone(), kneeJoint = hipsAt.clone(), ankleJoint = hipsAt.clone(), legWas = [null, null];
  let ankleFast = 0, kneeFast = 0, bodyFast = 0, climbed = 0, lastBodyY = wk.pos.y;
  for (const [gx, gz] of [[5.0, -47.5], [5.0, -44], [2.4, -39.5]]) {
    for (let guard = 0; guard < 600 && Math.hypot(gx - wk.pos.x, gz - wk.pos.z) > 0.35; guard++) {
      const dx = gx - wk.pos.x, dz = gz - wk.pos.z, d = Math.hypot(dx, dz);
      wk.wishDir = { x: dx / d, z: dz / d }; wk.wishSpeed = 1.6;
      G.step(1, 1 / 60);
      wk.b.hips.getWorldPosition(hipsAt);
      [[wk.b.lul, wk.b.ll, wk.b.lft], [wk.b.rul, wk.b.rl, wk.b.rft]].forEach(([thigh, shin, foot], side) => {
        thigh.getWorldPosition(hipJoint); shin.getWorldPosition(kneeJoint); foot.getWorldPosition(ankleJoint);
        const bend = kneeJoint.clone().sub(hipJoint).angleTo(ankleJoint.clone().sub(kneeJoint)) * 180 / Math.PI, rel = ankleJoint.clone().sub(hipsAt), was = legWas[side];
        if (was) { ankleFast = Math.max(ankleFast, rel.distanceTo(was.rel) * 60); kneeFast = Math.max(kneeFast, Math.abs(bend - was.bend) * 60); }
        legWas[side] = { rel, bend };
      });
      bodyFast = Math.max(bodyFast, Math.abs(wk.pos.y - lastBodyY) * 60); lastBodyY = wk.pos.y; climbed = Math.max(climbed, wk.pos.y);
    }
  }
  check('bot steps up a kerb, walks the pavement and steps down without its legs being thrown about', climbed > 0.12 && wk.pos.y < 0.03 && ankleFast < 7 && kneeFast < 1100 && bodyFast < 0.9,
    `kerb ${climbed.toFixed(2)} m: fastest ankle ${ankleFast.toFixed(1)} m/s relative to the hips, knee ${kneeFast.toFixed(0)}°/s, body ${bodyFast.toFixed(2)} m/s up or down`);
  // the trunk rides the stride quietly: head level and steady, shoulders not rocking
  dummy(6, 28.5, -58, 0); wk.state = 'advance'; wk.wishDir = { x: 0, z: 1 }; wk.wishSpeed = 1.6; wk.wantYaw = 0; run(2.4);
  const headQ = new G.THREE.Quaternion(), headUp = hipsAt.clone(), shoulderL = hipsAt.clone(), shoulderR = hipsAt.clone();
  const span = { tilt: [9, -9], height: [9, -9], shoulders: [9, -9] }, note = (k, v) => { span[k][0] = Math.min(span[k][0], v); span[k][1] = Math.max(span[k][1], v); };
  for (let f = 0; f < 130; f++) {
    G.step(1, 1 / 60);
    wk.b.head.getWorldQuaternion(headQ); headUp.set(0, 1, 0).applyQuaternion(headQ);
    note('tilt', Math.asin(clamp1(headUp.x * Math.cos(wk.heading) - headUp.z * Math.sin(wk.heading))) * 180 / Math.PI);
    note('height', wk.b.head.getWorldPosition(hipJoint).y - wk.pos.y);
    wk.b.la.getWorldPosition(shoulderL); wk.b.ra.getWorldPosition(shoulderR);
    note('shoulders', Math.atan2(shoulderR.y - shoulderL.y, Math.hypot(shoulderR.x - shoulderL.x, shoulderR.z - shoulderL.z)) * 180 / Math.PI);
  }
  const swing = k => span[k][1] - span[k][0];
  check('walking bot carries its head level and its shoulders steady', swing('tilt') < 3 && swing('height') < 0.065 && swing('shoulders') < 3,
    `over two strides the head tilts ${swing('tilt').toFixed(1)}° and bobs ${(swing('height') * 100).toFixed(1)} cm, the shoulder line rocks ${swing('shoulders').toFixed(1)}°`);
  G.goto(-29, -61, 0);
  dummy(6, -1.5, -53, 0);
  wk.state = 'combat'; wk.wishDir = { x: 1, z: 0 }; wk.wishSpeed = 2.2;
  run(0.5);
  const startX = wk.pos.x;
  let slide = 0, contactFrames = 0;
  const feet = [wk.b.lft, wk.b.rft], anchors = [null, null];
  const heel = new G.THREE.Vector3(), toe = heel.clone();
  const wrist = heel.clone();
  const support = heel.clone().fromArray(G.carry.gripL);
  const trigger = heel.clone().fromArray(G.carry.gripR);
  const hands = [[wk.b.lh, support, G.carry.leftHand], [wk.b.rh, trigger, G.carry.rightHand]];
  const gunInverse = new G.THREE.Quaternion(), wristRotation = gunInverse.clone();
  let handError = 0, gripAngleError = 0;
  for (let frame = 0; frame < 60; frame++) {
    G.step();
    wk.gun.getWorldQuaternion(gunInverse).invert();
    for (const [hand, target, rotation] of hands) {
      wk.gun.worldToLocal(hand.getWorldPosition(wrist));
      handError = Math.max(handError, wrist.distanceTo(target));
      hand.getWorldQuaternion(wristRotation).premultiply(gunInverse);
      gripAngleError = Math.max(gripAngleError, wristRotation.angleTo(rotation));
    }
    for (let side = 0; side < feet.length; side++) {
      const plant = wk.plants[side];
      feet[side].localToWorld(heel.set(0, -2, 13.3));
      feet[side].localToWorld(toe.set(0, 24, 12.4));
      const point = heel.y < toe.y ? heel : toe;
      if (!plant || Math.abs(point.y - wk.floorY) > 0.02) { anchors[side] = null; continue; }
      const prior = anchors[side];
      const toeFirst = point === toe;
      if (prior?.plant === plant && prior.toeFirst === toeFirst) {
        slide = Math.max(slide, Math.hypot(point.x - prior.x, point.z - prior.z));
        contactFrames++;
      } else anchors[side] = { plant, toeFirst, x: point.x, z: point.z };
    }
  }
  const sideWeight = wk.gaitBlend.left + wk.gaitBlend.right;
  const lateralTravel = wk.pos.x - startX;
  const aimError = Math.abs(wrap(0, wk.yaw));
  check('bot strafes on an authored gait, holds aim and plants boots on level ground', sideWeight > 0.70 && lateralTravel > 1.6 && lateralTravel < 2.05 && aimError < 0.14 && contactFrames > 15 && slide < 0.05,
    `side gait ${sideWeight.toFixed(2)}, ${lateralTravel.toFixed(2)} m lateral, sole slip ${(slide * 100).toFixed(1)} cm across ${contactFrames} contact frames`);
  check('both bot wrists keep their weapon-relative grip during aimed strafe', handError < 0.025 && gripAngleError < 0.087,
    `wrist error ${(handError * 100).toFixed(2)} cm and ${(gripAngleError * 180 / Math.PI).toFixed(2)}°`);
  dummy(6, 0, -50, 0);
  wk.state = 'combat'; wk.wishDir = { x: 0, z: -1 }; wk.wishSpeed = 2.2;
  run(1.3);
  check('bot retreats with a backward gait and holds aim', wk.pos.z < -51.7 && wk.pos.z > -52.4 && wk.gaitBlend.back > 0.70 && Math.abs(wrap(0, wk.yaw)) < 0.14,
    `backward gait ${wk.gaitBlend.back.toFixed(2)}, ${(-50 - wk.pos.z).toFixed(2)} m backward`);
  wk.wishDir = null;
  wk.wishSpeed = 0;
  wk.ammo = 0;
  wk.reloadT = BOT_RELOAD_DURATION;
  run(0.8);
  const mag = wk.gun.getObjectByName('botMagazine');
  const extracted = -mag.position.y;
  const ammoBeforeInsert = wk.ammo;
  run(BOT_RELOAD_DURATION - 0.7);
  check('bot reload extracts and reseats the magazine', extracted > 0.15 && Math.abs(mag.position.y) < 0.001 && ammoBeforeInsert === 0 && wk.ammo === 30,
    `extracted ${(extracted * 100).toFixed(1)} cm, ammo ${ammoBeforeInsert} → ${wk.ammo}`);
  park();

  // --- sound: modelled library, arrival delay, walls muffle, echoes come from the real surroundings
  const A = G.audio, takes = Object.values(A.raw).reduce((n, v) => n + v.length, 0);
  check('sound library is modelled and complete', Object.keys(A.raw).length >= 40 && A.raw.shot.length >= 4 && A.raw.shot[0].length === 2, `${Object.keys(A.raw).length} sounds, ${takes} takes`);
  A.lpos.x = 0; A.lpos.y = 1.6; A.lpos.z = -50;
  const hid = [[14, -50], [-14, -50], [20, -44], [-20, -44]].map(([x, z]) => ({ x, y: 1.5, z })).find(q => A.blocked(A.lpos, q) && A.blocked(A.lpos, { x: q.x, y: q.y + 1.6, z: q.z }));
  const o1 = {}, o2 = {}, dVis = A._carry({ x: 0, y: 1.5, z: -30 }, o1); if (hid) A._carry(hid, o2);
  check('sound arrives late by distance and is muffled by walls', !!hid && Math.abs(o1.delay - dVis / 343) < 1e-6 && o1.lp > 12000 && o2.lp < 4000 && o2.gain < o1.gain * 0.7, `20 m in the open: ${Math.round(o1.delay * 1000)} ms late, top end ${Math.round(o1.lp)} Hz; behind a wall: ${Math.round(o2.lp || 0)} Hz at ${(o2.gain ?? 0).toFixed(2)} gain`);
  A.start(); A._surroundings({ x: 0, y: 1.6, z: -50 }, 0, A.now);
  const street = A.stats().echoesMs.filter(v => v != null); A._surroundings({ x: -29, y: 1.6, z: -50 }, 0, A.now); const alley = A.stats().echoesMs.filter(v => v != null);
  check('echo delays follow the surrounding walls (tighter in the alley than the street)', street.length >= 2 && alley.length >= 2 && Math.min(...alley) < Math.min(...street) && Math.min(...street) < 150, `street ${street.join('/')} ms, alley ${alley.join('/')} ms`);
  G.resetMatch(); G.playing = false; G.manual = false; G.auto = false; G.frozen = false; G.matchLive = false; G.hud.show('start');
  return out;
}

// Deterministic screenshot set (posted to ./captures by the dev server). In the console: await G.proof()  — or G.proof(1754, 864) for 2192x1080.
export async function proof(G, w = 1536, h = 864) {
  const P = G.player, W = G.weapon, $ = id => document.getElementById(id), out = [], tag = w === 1536 ? '' : '_uw';
  const run = (secs, dt = 1 / 60) => G.step(Math.round(secs / dt), dt);
  const park = () => { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };
  const snap = async name => out.push(await G.capture(name + tag, w, h));
  G.manual = true; G.auto = true; G.frozen = true; G.resetMatch(); G.playing = true; G.hud.show(null); park();
  G.goto(-29, -58.5, 0, 5); run(1); await snap('01_spawn_alley');
  G.goto(0.6, -56, 0, 2); run(1); await snap('02_main_street');
  G.goto(1.5, -9, 14, 6); run(1); await snap('03_arch_plaza');
  G.goto(28.4, -47, 0, 3); run(1); await snap('04_market_lane');
  const rm = G.world.anchors.find(a => a.kind === 'room' && a.bd.street[Object.keys(a.bd.street).find(k => a.bd.street[k] === 'main')]), p = rm.P((rm.ra + rm.rb) / 2 + 0.6, 0, rm.D - 1.0);
  G.goto(p.x, p.z, Math.atan2(rm.N.x, rm.N.z) * 180 / Math.PI, 0); run(2.5); await snap('05_interior_to_sunlight');
  G.goto(-9, -6, 40, 0); run(0.5); W.inspect(); run(0.8); await snap('06_inspect');
  run(2.2); P.sim.ads = true; run(0.6); await snap('07_ads');
  P.sim.ads = false; G.goto(-4.4, -9.5, 96, -4); run(0.6); P.sim.fire = true; run(0.1); await snap('08_muzzle_flash'); run(0.3); P.sim.fire = false; run(0.35); await snap('09_impacts');
  G.goto(-9, -6, 40, 0); run(0.4); W.startReload(); run(1.38); await snap('12_reload'); run(1.0);      // fresh magazine being seated
  const foe = G.bots.list[3]; foe.spawn({ x: 1.5, z: 6, yaw: Math.PI }); foe.think = 1e9; foe.state = 'combat'; foe.aim = 1; foe.wantYaw = Math.PI;
  G.goto(1, -4, 2, 0); run(0.8); await snap('10_enemy_encounter');
  P.damage(82, foe.pos, null, 'body'); run(0.35); await snap('11_critical_health');
  P.health = 100; P.hurtT = 9; P.flash = 0; G.matchLive = true; foe.damage(500, P.pos, P, 'body'); foe.respawnT = 1e9; run(0.32); await snap('13_ragdoll_falling'); run(2.2); await snap('14_ragdoll_at_rest');      // the body under physics, rifle dropped
  park(); G.resetMatch(); G.playing = false; G.manual = false; G.auto = false; G.frozen = false; G.matchLive = false; G.hud.show('start');
  return out;
}

// Auto-play driver (?demo=1): walks the district, turns to visible enemies, aims and fires. Used for on-screen
// frame-pacing runs and gameplay recordings; it feeds the same input object a human does.
export function demoDriver(G) {
  const P = G.player, W = G.world, spots = [[0, -40], [0, -8], [-11, -2], [0, 20], [28.5, 20], [28.5, -20], [0, -22], [-29, -20], [-29, 10], [0, 40]];
  let path = null, pi = 0, goal = 0, yaw = 0, pitch = 0, repath = 0, burst = 0, rest = 0;
  const eye = { x: 0, y: 0, z: 0 }, tp = { x: 0, y: 0, z: 0 };
  return dt => {
    if (!P.sim || P.sim.demo !== true) { P.sim = { f: 0, s: 0, demo: true }; yaw = P.yaw; pitch = P.pitch; path = null; }
    const S = P.sim; if (!P.alive) return;
    P.health = Math.max(P.health, 70);
    eye.x = P.pos.x; eye.y = P.eyeY; eye.z = P.pos.z;
    let foe = null, fd = 70;
    for (const b of G.bots.list) {
      if (!b.alive || b.team === P.team) continue;
      const d = Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z); if (d > fd) continue;
      tp.x = b.pos.x; tp.y = b.eyeY - 0.25; tp.z = b.pos.z;
      if (G.los(eye, tp)) { foe = b; fd = d; }
    }
    let wantYaw = yaw, wantPitch = 0;
    repath -= dt; rest -= dt;
    if (foe) {
      wantYaw = Math.atan2(foe.pos.x - P.pos.x, foe.pos.z - P.pos.z); wantPitch = Math.atan2(foe.eyeY - 0.3 - P.eyeY, fd);
      const err = Math.abs(Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw)));
      S.ads = fd > 12; S.f = fd > 25 ? 0.6 : 0; S.s = 0;
      if (err < 0.035 && rest <= 0) { burst += dt; S.fire = true; if (burst > 0.45) { burst = 0; rest = 0.35; } } else S.fire = false;
    } else {
      S.fire = false; S.ads = false; burst = 0;
      if (!path || pi >= path.length || repath <= 0) { if (!path || pi >= path.length) goal = (goal + 1 + Math.floor(G.time)) % spots.length; path = W.nav.path(P.pos.x, P.pos.z, spots[goal][0], spots[goal][1]) || []; pi = 0; repath = 4; }
      const p = path[pi];
      if (p) { const dx = p.x - P.pos.x, dz = p.z - P.pos.z; if (Math.hypot(dx, dz) < 0.7) pi++; else wantYaw = Math.atan2(dx, dz); }
      S.f = 1; S.s = 0; S.sprint = false;
      if (G.weapon.ammo < 10 && !G.weapon.reloading) G.weapon.startReload();
    }
    const dy = Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw)), turn = (foe ? 5.5 : 2.6) * dt;
    yaw += Math.max(-turn, Math.min(turn, dy)); pitch += (wantPitch - pitch) * Math.min(1, dt * 6);
    S.yaw = yaw; S.pitch = pitch;
  };
}
