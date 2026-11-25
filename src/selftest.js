// Scripted acceptance run through the real game systems. In the browser console: await G.selfTest()
// Uses fixed time steps and the seeded RNGs, so results are repeatable.
import { BOT_RELOAD_DURATION } from './weapon.js';
import { scan as clipScan, shove as clipShove } from './clipcheck.js';
import { rayBoxes } from './physics.js';

export function selfTest(G) {
  const P = G.player, W = G.weapon, out = [], $ = id => document.getElementById(id), clamp1 = v => Math.max(-1, Math.min(1, v));
  const t00 = performance.now(), check = (name, pass, detail = '') => out.push({ name, pass: !!pass, detail: String(detail), at: +((performance.now() - t00) / 1000).toFixed(2) });
  const run = (secs, dt = 1 / 60) => G.step(Math.round(secs / dt), dt);
  const park = () => { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };
  const dummy = (i, x, z, yaw = Math.PI) => { const b = G.bots.list[i]; b.spawn({ x, z, yaw }); b.think = 1e9; b.wishDir = null; b.wishSpeed = 0; return b; };
  G.manual = true; G.auto = true; G.frozen = true;
  G.civs?.park(true);                                  // (the checks below stage soldiers on empty streets; the civilians have their own at the end)
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
  // --- the market quarter: one navigation grid over both districts, and a soldier who actually walks there and back
  {
    park(); const nav = G.world.nav, Q = G.world.quarterHotspots || [];
    const from = [[0, -60.5], [0, 60.5], [-29, 0], [28.4, -40], [-11, 5]];
    let routes = 0, missing = []; for (const h of Q) for (const f of from) { if (nav.path(f[0], f[1], h[0], h[1])) routes++; else missing.push(`${f}→${h}`); }
    for (const a of G.world.spawns[0]) for (const b of G.world.spawns[1]) { if (nav.path(a.x, a.z, b.x, b.z)) routes++; else missing.push(`spawn ${a.x},${a.z}→${b.x},${b.z}`); }
    check('every spot in the market quarter can be routed to from the old district, and every spawn to every enemy spawn', Q.length > 20 && !missing.length, missing.length ? missing.slice(0, 4).join('; ') : `${routes} routes`);
    const walker = dummy(2, 28.4, -21, Math.PI / 2);
    const trip = (gx, gz, secs) => {                                            // under direct orders: route, then jog it (no decisions of his own on the way)
      walker.setGoal(gx, gz, false); walker.think = 1e9; walker.state = 'advance'; walker.onPath = true; walker.wishDir = null; walker.wishSpeed = walker.pace.jog;
      let t = 0, stuck = 0, k = 0, last = { x: walker.pos.x, z: walker.pos.z };
      while (t < secs && Math.hypot(walker.pos.x - gx, walker.pos.z - gz) > 1.2) {
        G.step(2, 1 / 60); t += 1 / 30;
        if (++k % 60 === 0) { if (Math.hypot(walker.pos.x - last.x, walker.pos.z - last.z) < 0.3) stuck++; last = { x: walker.pos.x, z: walker.pos.z }; }
      }
      return { t, d: Math.hypot(walker.pos.x - gx, walker.pos.z - gz), stuck };
    };
    const into = trip(69, -5, 40), back = trip(0, -30, 50);
    check('a soldier walks from the market lane through a passage into the market hall, and back to the main street', into.d < 1.5 && back.d < 1.5 && into.stuck + back.stuck < 2,
      `in: ${into.t.toFixed(1)} s, ${into.d.toFixed(1)} m short; back: ${back.t.toFixed(1)} s, ${back.d.toFixed(1)} m short; stalls ${into.stuck + back.stuck}`);
    park();
  }
  const fought = clipScan(G, { min: 0.03 });
  check('clutter knocked about in the fighting is not left inside walls (90 s)', !fought.length, fought.length ? fought.slice(0, 3).map(r => `${r.name} at ${r.now} ${Math.max(r.boxPen, r.drawnPen) * 100 | 0} cm into ${r.what || r.surf}`).join('; ') : 'all clear');

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
    // open ground to walk in from, and room beyond for it to go (one against a wall is held there by the wall)
    for (const [dx, dz] of [[0, -2.2], [0, 2.2], [2.2, 0], [-2.2, 0]]) { const x = it.home.x + dx, z = it.home.z + dz, bx = it.home.x - dx * 0.75, bz = it.home.z - dz * 0.75; if (nav.free(x, z) && nav.free(bx, bz) && nav.walkable(x, z, bx, bz)) { prop = it; from = { x, z, yaw: Math.atan2(-dx, -dz) }; break; } }
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

  // --- loose props never sit in walls: none is dressed into anything solid, and a chair shoved against a wall stays out of it
  Rg.reset(); run(0.5);
  const atRest = clipScan(G, { min: 0.015 });                                 // (a stacked crate settles a centimetre into the pavement under the load: contact tolerance, not visible)
  check('no loose prop starts inside anything solid', !atRest.length, atRest.length ? atRest.slice(0, 3).map(r => `${r.name} at ${r.now} ${Math.max(r.boxPen, r.drawnPen) * 100 | 0} cm into ${r.what || r.surf}`).join('; ') : `${Rg.props.length} props clear`);
  const shoves = [-50.5, -40, -33.5, 49].map(z => clipShove(G, { z }));
  const worstShove = shoves.reduce((a, b) => (Math.max(b.boxPen, b.drawnPen) > Math.max(a.boxPen, a.drawnPen) ? b : a));
  check('a chair shoved against a wall is not pushed into it', shoves.every(s => s.boxPen < 0.02 && s.drawnPen < 0.03),
    `worst ${(worstShove.boxPen * 100).toFixed(1)} cm into the wall box, ${(worstShove.drawnPen * 100).toFixed(1)} cm behind the drawn ${worstShove.what || 'surface'} (z ${worstShove.z})`);
  Rg.reset(); P.sim = { f: 0, s: 0 };

  // --- ragdoll: the body falls under physics, the rifle drops, and a corpse is left when the soldier respawns
  park(); G.goto(0, -50, 0); let dead = dummy(5, 0, -44); run(0.3);
  dead.damage(500, P.pos, P, 'body'); dead.respawnT = 3.4; run(0.05);
  const rag = dead.rag, h0 = rag ? rag.height() : 0, dropped = !!dead.dropped; run(2.8);
  const h1 = rag ? rag.height() : 9, rsp = rag ? rag.speed() : 9;
  check('a kill hands the body to a ragdoll that falls and comes to rest', !!rag && dropped && h0 > 0.9 && h1 < 0.45 && rsp < 0.6, `chest ${h0.toFixed(2)} m -> ${h1.toFixed(2)} m, still moving ${rsp.toFixed(2)} m/s, rifle dropped ${dropped}`);
  run(1.2);
  check('the body stays behind when the soldier respawns', dead.alive && !dead.rag && Rg.corpses.length === 1 && Rg.rags.length === 0, `corpses ${Rg.corpses.length}, live ragdolls ${Rg.rags.length}`);

  // --- throwables: issue, the throw by hand, flight and bounce, fuze, blast by distance and cover, scoring, clutter,
  //     soldiers getting out of the way, smoke and sight, a primed grenade dropped at death, restart
  G.resetMatch(); G.playing = true; G.hud.show(null); park();
  const T = G.throw, V3 = G.THREE.Vector3, Q4 = G.THREE.Quaternion, still = new V3(), away = (a, x, z) => Math.hypot(a.pos.x - x, a.pos.z - z);
  check('both throwables are issued and shown on the HUD', T.count.frag === 2 && T.count.smoke === 2 && $('nFragN').textContent === '2' && $('nSmokeN').textContent === '2', `frag ${T.count.frag}, smoke ${T.count.smoke}`);
  G.goto(0.6, -56, 0, 0); run(0.3);
  T.select('frag'); run(0.5); const slung = W.stow > 0.9 && T.st === 'ready' && $('nFrag').classList.contains('sel'), shots0 = G.stats.shots;
  P.sim.fire = true; run(0.7); const primed = T.st === 'hold'; P.sim.fire = false; run(0.2);
  const nd = T.live[0];
  check('the frag is drawn, primed and thrown by hand with the rifle slung, and one is used up', slung && primed && !!nd && T.count.frag === 1 && $('nFragN').textContent === '1' && G.stats.shots === shots0 && T.bits.length === 2,
    `ready ${slung}, pin out and arm back ${primed}, left ${T.count.frag}, pin and lever on the ground ${T.bits.length}`);
  let apex = 0, tFly = 0; while (nd && T.live.includes(nd) && tFly < 7) { apex = Math.max(apex, nd.item.body.translation().y); G.step(1); tFly += 1 / 60; }
  const seat = T.lastBlast ? T.lastBlast.at : still, reach = seat.z + 56;
  check('it flies an arc, bounces, rolls to rest and bursts when the fuze runs out, leaving a scorch', !!nd && apex > 1.7 && nd.bounces >= 2 && reach > 14 && reach < 32 && Math.abs(nd.t - nd.fuse) < 0.05 && nd.fuse > 3.7 && nd.fuse < 4.4 && seat.y < 0.5 && G.fx.decals.scorch.im.count >= 1,
    `apex ${apex.toFixed(2)} m, ${nd ? nd.bounces : 0} knocks, burst ${reach.toFixed(1)} m out after ${nd ? nd.t.toFixed(2) : '-'} s`);
  run(0.7); check('the rifle is back in the hands after the throw', W.stow < 0.1 && !T.busy && W.gun.visible, `stow ${W.stow.toFixed(2)}`);
  G.goto(2.5, -40, -90, 0); run(0.2); T.select('frag'); run(0.5); P.sim.fire = true; run(0.7); P.sim.fire = false; run(0.2);
  const nw = T.live[0]; let minX = 9; for (let i = 0; i < 80 && nw; i++) { G.step(1); minX = Math.min(minX, nw.item.body.translation().x); }
  const backX = nw ? nw.item.body.translation().x : 0;
  check('thrown hard at a wall it comes back off it, not through it', !!nw && minX > -6.3 && nw.bounces >= 1 && backX > minX + 0.5, `nearest the wall x ${minX.toFixed(2)}, came back to x ${backX.toFixed(2)}`);
  if (nw) T.remove(nw);
  // a balcony's parapet or balustrade is a box the solver knows; what hangs over it (a rug, laundry, bougainvillea) is
  // soft and takes the throw out of a grenade, so the test throws at a bare one
  const bare = G.world.anchors.filter(q => q.kind === 'balcony' && q.solid && !q.draped), plain = q => (q.front ?? 0.11) < 0.2;
  const balc = bare.find(q => q.street === 'main' && plain(q)) || bare.find(q => q.street === 'main') || bare.find(plain) || bare[0];   // (a plastered parapet on the main street, as the test was written for, else a balustrade, else one elsewhere)
  if (balc) {
    const B0 = balc.p, N0 = balc.N, into = q => (B0.x - q.x) * N0.x + (B0.z - q.z) * N0.z;      // how far past the balcony's outer face (metres)
    const gb = T.spawn('frag', new V3(B0.x + N0.x * 4, B0.y + 0.2, B0.z + N0.z * 4), new V3(-N0.x * 10, 2.4, -N0.z * 10), still, new Q4(), null); gb.fuse = 99;
    let deepest = -9; for (let i = 0; i < 70; i++) { G.step(1); deepest = Math.max(deepest, into(gb.item.body.translation())); }
    const backOff = into(gb.item.body.translation()), knocked = gb.bounces; T.remove(gb);
    const gd = T.spawn('frag', new V3(B0.x - N0.x * 0.5, B0.y + 1.3, B0.z - N0.z * 0.5), still, still, new Q4(), null); gd.fuse = 99; run(3.2);
    const lying = gd.item.body.translation().y - B0.y, asleep = gd.item.body.isSleeping(); T.remove(gd);
    check('a grenade thrown at a balcony comes back off it, and one dropped onto it stays lying there', deepest < 0.06 && knocked >= 1 && backOff < -0.3 && lying > 0.01 && lying < 0.06 && asleep,
      `got ${(deepest * 100).toFixed(0)} cm past its face at most, came back ${(-backOff).toFixed(1)} m; dropped one lies ${(lying * 100).toFixed(1)} cm above the floor, at rest ${asleep}`);
  }
  // a balcony is a floor to stand on, its railing or parapet stops a soldier, and only the floor and the parapet hide one
  park(); P.health = 100;
  // (balconies a soldier fits on: their depth inside the railing or parapet more than a body's width)
  const room = q => (q.dep ?? 1.05) - (q.front ?? (q.solid ? 0.11 : 0.04)) > 0.72;
  const bIron = G.world.anchors.find(q => q.kind === 'balcony' && !q.solid && q.street === 'main' && room(q)), bSolid = G.world.anchors.find(q => q.kind === 'balcony' && q.solid && room(q));
  for (const [q, name] of [[bIron, 'railing'], [bSolid, 'parapet']]) {
    if (!q) continue;
    const wall = q.front ?? (q.solid ? 0.11 : 0.04), mid = wall + ((q.dep ?? 1.05) - wall) / 2;
    const s0 = { x: q.p.x - q.N.x * mid, z: q.p.z - q.N.z * mid }, edge = () => (P.pos.x - q.p.x) * q.N.x + (P.pos.z - q.p.z) * q.N.z, side = () => Math.abs((P.pos.x - q.p.x) * q.T.x + (P.pos.z - q.p.z) * q.T.z);
    G.goto(s0.x, s0.z, Math.atan2(q.N.x, q.N.z) * 180 / Math.PI); P.pos.y = q.p.y + 0.6; run(0.6);
    const landed = P.grounded && Math.abs(P.pos.y - q.p.y) < 0.02;
    P.sim.f = 1; run(1.2); P.sim.f = 0; const front = edge(), y1 = P.pos.y - q.p.y;
    P.sim.s = 1; run(1.5); P.sim.s = 0; const across = side(), y2 = P.pos.y - q.p.y;
    check(`a soldier dropped onto a balcony stands on it and its ${name} stops him`, landed && Math.abs(y1) < 0.02 && Math.abs(y2) < 0.02 && front < -(wall + 0.32) && across < q.w / 2 - wall - 0.32,
      `landed ${landed}, ${(-front).toFixed(2)} m in from the front, ${(q.w / 2 - across).toFixed(2)} m in from the side, ${y2.toFixed(2)} m off the floor`);
  }
  if (bIron && bSolid) {
    const at = (q, n, dy) => new V3(q.p.x - q.N.x * n, q.p.y + dy, q.p.z - q.N.z * n);
    const floor = !G.los(at(bIron, 0.5, -0.6), at(bIron, 0.5, 0.6)), rail = G.los(at(bIron, 0.5, 0.5), at(bIron, -1.5, 0.5)), parapet = !G.los(at(bSolid, 0.5, 0.5), at(bSolid, -1.5, 0.5));
    check('a balcony floor and parapet stop sight and fire, its open railing does not', floor && rail && parapet, `floor ${floor ? 'blocks' : 'open'}, railing ${rail ? 'see-through' : 'blocks'}, parapet ${parapet ? 'blocks' : 'open'}`);
  }
  park(); G.goto(0.6, -58, 0, 0); P.health = 100;
  const close = dummy(3, 0.5, -37), far8 = dummy(4, 0.5, -32), behind = dummy(5, -29, -40), sc0 = G.score[0], k0 = P.kills;
  const g1 = T.spawn('frag', new V3(0.5, 0.2, -40), still, still, new Q4(), P); g1.fuse = 0.3; run(0.6);
  check('the burst kills at 3 m, wounds at 8 m, spares a soldier a street away, and scores for the thrower', !close.alive && far8.alive && far8.health < 85 && far8.health > 45 && behind.health === 100 && G.score[0] === sc0 + 1 && P.kills === k0 + 1 && !!document.querySelector('#feed .nadei') && P.health === 100,
    `3 m: ${close.alive ? 'alive' : 'killed'}, 8 m: ${Math.round(100 - far8.health)} damage, behind buildings: ${Math.round(100 - behind.health)}, score ${G.score}`);
  run(1.6); check('a soldier killed by the burst goes down as a ragdoll', !!close.rag && close.rag.height() < 0.5, `chest ${close.rag ? close.rag.height().toFixed(2) : '-'} m`);
  park();
  if (prop) {
    const c0 = prop.body.translation(), px = c0.x, py = c0.y, pz = c0.z; G.goto(px > 0 ? -29 : 28.5, pz > 0 ? -61 : 61, 0);
    const g2 = T.spawn('frag', new V3(px + 1.3, py + 0.2, pz), still, still, new Q4(), null); g2.fuse = 0.2; run(1.4);
    const c1 = prop.body.translation(), thrown = Math.hypot(c1.x - px, c1.y - py, c1.z - pz);
    check('the blast throws loose clutter about', thrown > 0.4, `${prop.name} moved ${thrown.toFixed(2)} m`);
  }
  const diff0 = G.settings.difficulty; G.settings.difficulty = 'hard'; G.goto(-29, -61, 0); P.health = 100;
  const runner = G.bots.list[4]; runner.spawn({ x: 0.5, z: -36, yaw: Math.PI });
  const g3 = T.spawn('frag', new V3(0.5, 0.5, -38), new V3(0, -1, 0), still, new Q4(), P); g3.fuse = 3.4; let fled = 0, ran = false;
  for (let i = 0; i < 215; i++) { G.step(1); if (T.live.includes(g3)) { fled = away(runner, 0.5, -38); ran = ran || runner.state === 'evade'; } }
  check('a soldier who sees a grenade land at his feet runs from it', ran && fled > 3.6 && runner.alive, `${fled.toFixed(1)} m away when it burst (from 2.0), health ${Math.round(runner.health)}`);
  G.settings.difficulty = diff0; park();
  G.goto(0.6, -56, 0, 0); P.health = 100; run(0.2); const eyeA = { x: 0.6, y: 1.5, z: -56 }, eyeB = { x: 0.6, y: 1.5, z: -30 };
  const watcher = dummy(4, 0.6, -30, Math.PI); watcher.yaw = Math.PI; let tSee = 0; while (tSee < 2 && !(watcher.seen.get(P)?.vis)) { watcher.perceive(0.05, [P], G.world.colliders); tSee += 0.05; }
  T.select('smoke'); run(0.5); P.sim.ads = true; run(0.7); P.sim.ads = false; run(0.3);
  const sm = T.live[0], unlit = !!sm && !sm.lit; run(2.2);
  const lob = sm ? sm.item.body.translation().z + 56 : 0, popped = !!sm && sm.lit; run(7.5);
  watcher.seen.clear(); for (let i = 0; i < 60; i++) watcher.perceive(0.05, [P], G.world.colliders);
  const blind = watcher.seen.get(P)?.t || 0, billows = T.puffs.list.filter(q => q.body).length, thick = T.puffs.depth(eyeA, eyeB);
  check('the smoke canister is lobbed underhand, pops after its delay and builds a screen an enemy cannot see through', tSee < 1.2 && T.count.smoke === 1 && unlit && popped && lob > 4 && lob < 16 && billows >= 20 && T.smoked(eyeA, eyeB) && blind < 0.01,
    `seen in ${tSee.toFixed(2)} s before; lobbed ${lob.toFixed(1)} m; ${billows} billows 8 s after the pop, optical depth ${thick.toFixed(1)}; awareness through it ${blind.toFixed(2)}`);
  for (let i = 0; i < 75 * 20; i++) T.update(1 / 20);                               // the canister burns out and the cloud drifts apart (the rest of the world held still)
  watcher.seen.clear(); let tAgain = 0; while (tAgain < 2 && !(watcher.seen.get(P)?.vis)) { watcher.perceive(0.05, [P], G.world.colliders); tAgain += 0.05; }
  check('the screen thins out and clears, and the enemy can see again', T.puffs.list.filter(q => q.body).length === 0 && !T.smoked(eyeA, eyeB) && tAgain < 1.2, `seen again in ${tAgain.toFixed(2)} s`);
  park(); T.restock(); G.goto(0, -45, 0); run(0.2); T.select('frag'); run(0.5); P.sim.fire = true; run(0.7); P.damage(500, { x: 5, z: -45 }, null, 'body'); P.sim.fire = false; run(0.1);
  const fell = T.live.length === 1 && !T.busy && T.live[0].kind === 'frag'; P.respawnT = 9; run(4.6);
  check('killed with the pin out, the grenade drops where the player stood and still goes off', fell && T.live.length === 0 && !!T.lastBlast && Math.hypot(T.lastBlast.at.x, T.lastBlast.at.z + 45) < 4, `dropped ${fell}, burst ${T.lastBlast ? Math.hypot(T.lastBlast.at.x, T.lastBlast.at.z + 45).toFixed(1) : '-'} m from the spot`);
  T.select('smoke'); G.resetMatch(); G.playing = true; G.hud.show(null);
  check('restart clears live grenades and smoke and restocks both', T.count.frag === 2 && T.count.smoke === 2 && T.live.length === 0 && T.puffs.list.length === 0 && Rg.nades.length === 0 && !T.busy && G.fx.decals.scorch.im.count === 0, `frag ${T.count.frag}, smoke ${T.count.smoke}, live ${T.live.length}, puffs ${T.puffs.list.length}`);
  P.sim = { f: 0, s: 0 };

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
  // --- the civilians (civilians.js): a quiet morning, a fright, a rifle held on them, a death that is nobody's score, calm again
  if (G.civs) {
    const C = G.civs, L = C.list, quick = secs => { const r = G.R.render; G.R.render = () => {}; try { run(secs); } finally { G.R.render = r; } }, far = (c, x, z) => Math.hypot(c.pos.x - x, c.pos.z - z);
    const away = () => { P.alive = false; P.respawnT = 1e9; }, probe = new G.THREE.Vector3();      // (the player out of the way: nobody armed in the streets)
    C.park(false); G.resetMatch(); G.playing = true; park(); away(); quick(30);
    const states = new Set(L.map(c => c.state)), moving = L.filter(c => c.speed > 0.5).length, inWall = L.filter(c => rayBoxes(c.pos.x, c.pos.y + 1, c.pos.z, 0, 1, 0, 0.3, G.world.colliders, null) < 0.01).length;      // (a point at chest height inside a solid)
    check('civilians fill the district and go about their morning', L.length >= 8 && L.every(c => c.alive && c.calm) && states.size >= 3 && moving >= 3 && inWall === 0, `${L.length} people, ${[...states].join(' ')}, ${moving} walking, ${inWall} in a wall`);
    const seatedNow = () => L.find(c => c.state === 'sit' && c.phase === 2)?.name, talkingNow = () => { const c = L.find(c => c.state === 'chat' && c.conv && c.conv.phase === 1); return c ? `${c.name} talking with ${(c.conv.a === c ? c.conv.b : c.conv.a).name}` : null; };
    let sat = seatedNow(), talked = talkingNow();
    for (let k = 0; k < 5 && !(sat && talked); k++) { quick(8); sat ||= seatedNow(); talked ||= talkingNow(); }
    check('they sit where there is a seat and stop to talk in pairs', !!sat || !!talked, `${sat ? sat + ' seated' : 'nobody seated'}, ${talked || 'nobody talking'}`);
    // a burst fired into the ground a few metres from someone
    const A = L.filter(c => c.calm && c.state !== 'sit').sort((a, b) => L.filter(o => far(o, a.pos.x, a.pos.z) < 20).length - L.filter(o => far(o, b.pos.x, b.pos.z) < 20).length).pop();
    const ax = A.pos.x, az = A.pos.z, o = new G.THREE.Vector3(ax + 6, 1.5, az), d = new G.THREE.Vector3(0.2, -0.3, 1).normalize(), e = o.clone().addScaledVector(d, 4);
    const nearby = L.filter(c => far(c, ax, az) < 16), distant = L.filter(c => far(c, ax, az) > 75);
    for (let i = 0; i < 4; i++) { C.shot(o, d, e, P); quick(0.1); }
    quick(0.6);
    const ran = nearby.filter(c => ['flee', 'freeze', 'cower', 'surrender'].includes(c.state)).length, farCalm = distant.filter(c => c.state !== 'flee' && c.state !== 'freeze' && c.fear < 0.5).length;
    check('gunfire close by sends them running, hiding or frozen; far-off fire does not', ran === nearby.length && nearby.length > 0 && farCalm === distant.length, `${ran}/${nearby.length} within 16 m reacting (${nearby.map(c => c.state).join(' ')}), ${farCalm}/${distant.length} beyond 75 m not in flight`);
    // a face, close to: someone whose own textures are in since boot (the warm-up's people), given a fright with the camera on them
    const scared = C.warmSet.find(c => c.alive) || L[0]; let blink = 0, wide0 = Math.max(scared.inst.face[2], scared.inst.face[3]);
    const onFace = () => { P.pos.set(scared.pos.x + Math.sin(scared.yaw) * 1.2, scared.pos.y, scared.pos.z + Math.cos(scared.yaw) * 1.2); };      // (the fallen player's eyes are the camera: a pace in front of them)
    scared.scare(0.95, scared.pos.x + 4, scared.pos.z, 'near', true);
    for (let i = 0; i < 40; i++) { onFace(); quick(1 / 60); blink = Math.max(blink, scared.face.blink); }
    const fw = scared.inst.face, wide = Math.max(fw[2], fw[3]), brow = fw[8];
    check('fear shows on the face as it happens (a blink at the fright, then eyes wide and inner brows up)', scared.tier === 0 && blink > 0.9 && wide > 0.35 && wide > wide0 + 0.3 && brow > 0.35, `${scared.name}: tier ${scared.tier}, blink ${blink.toFixed(2)}, eyeWide ${wide0.toFixed(2)} -> ${wide.toFixed(2)}, browInnerUp ${brow.toFixed(2)}, fear ${scared.fear.toFixed(2)}`);
    const line = { dur: 1.2, kind: 'talk' }; scared.face.speak(line); let mouth = 0; for (let i = 0; i < 50; i++) { onFace(); quick(1 / 60); for (let k = 20; k < 34; k++) mouth = Math.max(mouth, fw[k]); mouth = Math.max(mouth, fw[11]); }
    check('a voice moves the mouth (jaw and visemes)', mouth > 0.25, `largest mouth shape while speaking ${mouth.toFixed(2)}`);
    // a rifle held on a timid one
    // a rifle held on the timid (most give up; a few run instead, so up to four are tried)
    away(); quick(40); let T = null, up = false; const ranOff = [];
    for (const c of L.filter(c => c.alive && c !== scared && c.fear < 0.1 && c.state !== 'sit').sort((a, b) => a.temper.brave - b.temper.brave).slice(0, 4)) {
      T = c; P.alive = true; G.goto(c.pos.x + Math.sin(c.yaw) * 4, c.pos.z + Math.cos(c.yaw) * 4, 0, -4);
      for (let i = 0; i < 10 && !up && c.state !== 'flee'; i++) { P.yaw = P.sim.yaw = Math.atan2(c.pos.x - P.pos.x, c.pos.z - P.pos.z); quick(0.25); up = c.state === 'surrender'; }
      if (up) break; ranOff.push(c.name); away(); quick(20);
    }
    if (up) for (let i = 0; i < 4; i++) { P.yaw = P.sim.yaw = Math.atan2(T.pos.x - P.pos.x, T.pos.z - P.pos.z); quick(0.2); }
    check('a rifle held on a civilian brings their hands up', up && T.anim.pose.handsUp.L > 0.6, `${T.name}: ${T.state}, hands ${T.anim.pose.handsUp.L.toFixed(2)}, fear ${T.fear.toFixed(2)}${ranOff.length ? '; ran instead: ' + ranOff.join(', ') : ''}`);
    // a death
    const score = G.score.join(), kills = P.kills, before = C.stats.killed, victim = T;
    victim.damage(200, P.pos, P, 'body'); quick(1.2);
    check('a civilian killed is nobody\'s score, falls as a body, and is counted apart', !victim.alive && G.score.join() === score && P.kills === kills && C.stats.killed === before + 1 && (!!victim.rag || victim.dying > 0), `score ${G.score.join('-')}, player kills ${P.kills}, casualties ${C.stats.killed}, ragdoll ${!!victim.rag}`);
    // and afterwards
    away(); quick(110);
    const calmAgain = L.filter(c => c.alive && c.calm).length, alive = L.filter(c => c.alive).length, worst = Math.max(...L.filter(c => c.alive).map(c => c.fear));
    check('with the danger gone they come out and go back to their morning', calmAgain >= alive * 0.8 && worst < 0.2, `${calmAgain}/${alive} calm again, highest fear ${worst.toFixed(2)}`);
    P.alive = true; P.respawnT = 0;
  }
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

// Capture set for the two throwables (posted to ./captures). In the console: await G.proofThrow()
// Each item is shown in the hand, leaving it, in the air, at the moment of its effect and afterwards.
export async function proofThrow(G, w = 1536, h = 864) {
  const P = G.player, T = G.throw, out = [], V3 = G.THREE.Vector3;
  const run = (secs, dt = 1 / 60) => G.step(Math.round(secs / dt), dt);
  const park = () => { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };
  const stand = (i, x, z, yaw) => { const b = G.bots.list[i]; b.spawn({ x, z, yaw }); b.think = 1e9; b.wishDir = null; b.wishSpeed = 0; b.state = 'combat'; b.aim = 1; b.wantYaw = yaw; return b; };
  const snap = async name => out.push(await G.capture(name, w, h));
  const wait = secs => { const r = G.R.render; G.R.render = () => {}; try { run(secs - 0.6); } finally { G.R.render = r; } run(0.6); };      // long waits are stepped without drawing; the last moments are drawn so exposure has settled
  const at = n => { const t = n.item.body.translation(); return new V3(t.x, t.y, t.z); };
  G.manual = true; G.auto = true; G.frozen = true; G.resetMatch(); G.playing = true; G.hud.show(null); park();
  // ---- fragmentation grenade, thrown overhand down the main street
  G.goto(0.6, -56, 0, -15); run(0.8);
  T.select('frag'); run(0.7); await snap('throw_frag_1_in_hand');
  P.sim.fire = true; run(0.21); await snap('throw_frag_2_pin_out');
  run(0.6); P.sim.fire = false; run(0.135); await snap('throw_frag_3_release');
  const fr = T.live[0]; run(0.3); await snap('throw_frag_4_in_flight');
  while (T.live.includes(fr) && fr.t < fr.fuse - 0.45) G.step(1);
  const seat = at(fr), yaw = Math.atan2(P.pos.x - seat.x, P.pos.z - seat.z);
  stand(4, seat.x - 1.8, seat.z + 2.2, yaw); stand(5, seat.x + 2.6, seat.z + 6.5, yaw);          // two of the other side caught near it
  run(0.3); await snap('throw_frag_5_about_to_burst');
  while (T.live.includes(fr)) G.step(1);
  G.step(1); await snap('throw_frag_6_burst');
  G.step(5); await snap('throw_frag_7_fireball');
  run(0.55); await snap('throw_frag_8_smoke_and_dust');
  wait(5.5); await snap('throw_frag_9_aftermath');
  // ---- smoke canister, lobbed underhand to screen the street
  park(); G.resetMatch(); G.playing = true; G.hud.show(null); park();
  G.goto(0.6, -56, 0, -2); run(0.8);
  stand(4, -1.6, -31, Math.PI); stand(5, 2.4, -28, Math.PI); stand(6, 0.4, -35, Math.PI);          // three of them up the street, in plain view
  T.select('smoke'); run(0.7); await snap('throw_smoke_1_in_hand');
  P.sim.ads = true; run(0.8); P.sim.ads = false; run(0.15); await snap('throw_smoke_2_lob');
  const sm = T.live[0]; run(0.35); await snap('throw_smoke_3_in_flight');
  while (!sm.lit && sm.t < 5) G.step(1);
  run(0.35); await snap('throw_smoke_4_pop');
  run(2.6); await snap('throw_smoke_5_building');
  G.goto(0.6, -63, 0, 1); wait(8); await snap('throw_smoke_6_screen');
  G.goto(-4.4, -45, 62, 2); run(0.6); await snap('throw_smoke_7_from_the_side');
  G.goto(0.6, -63, 0, 1); wait(24); await snap('throw_smoke_8_thinning');
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
