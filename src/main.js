// Boot, settings, match rules and the frame loop.
import * as THREE from 'three';
import { loadAssets } from './assets.js';
import { createRenderer, PRESETS } from './render.js';
import { createMaterials, windUniforms } from './materials.js';
import { buildWorld } from './world.js';
import { Weapon } from './weapon.js';
import { FX } from './fx.js';
import { Blood } from './blood.js';
import { FlashPool } from './muzzleflash.js';
import { Audio } from './audio.js';
import { Player } from './player.js';
import { Bots, CARRY } from './bots.js';
import { Rigid } from './rigid.js';
import { HUD } from './hud.js';
import { Throwables } from './throwables.js';
import { clamp, damp } from './util.js';
import { selfTest, proof, proofThrow, demoDriver } from './selftest.js';
import { losClear, rayBoxes, ceilingAt, OVERHANG } from './physics.js';
import { setupGI } from './gi.js';
import { addStreetLife } from './streetlife.js';
import { addArchDetail } from './archdetail.js';
import { Touch, PHONE } from './touch.js';

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const canvas = $('view');
const DEFAULTS = {
  sensitivity: 1, fov: 60, adsSens: 1, invertY: false, quality: 'high', difficulty: 'normal', blur: 'low', shake: true, vignette: true, grain: true, chroma: true, bob: true, blood: true, fullscreen: true,
  binds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', crouch: 'KeyC', jump: 'Space', reload: 'KeyR', mode: 'KeyB', inspect: 'KeyF', frag: 'KeyG', smoke: 'KeyQ' },
};
const MATCH = { time: 600, score: 30 };

function loadSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('market.settings') || '{}'); } catch { /* fresh */ }
  const out = { ...DEFAULTS, ...s, binds: { ...DEFAULTS.binds, ...(s.binds || {}) } };
  if (PHONE && !s.qualityPicked) out.quality = 'phone';           // a phone starts on the phone preset until one is picked in the menu
  if (PHONE && s.blur === undefined) out.blur = 'off';             // and without motion blur: a thumb's flick turns fast enough to smear every turn
  if (params.get('q') && PRESETS[params.get('q')]) out.quality = params.get('q');
  return out;
}

async function start() {
  const settings = loadSettings();
  const probe = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  const assets = await loadAssets(probe, p => { $('bootBar').style.width = (p * 82).toFixed(0) + '%'; }, { drop: PRESETS[settings.quality]?.texDrop || 0 });
  probe.dispose(); performance.mark('boot:assets');
  $('bootText').textContent = 'Building district'; $('bootBar').style.width = '88%';
  await new Promise(r => setTimeout(r, 30));

  const R = createRenderer(canvas, assets.sky, settings.quality);
  const M = createMaterials();
  const world = buildWorld(R, M);
  world.arch = addArchDetail(R, M, world);                                                                 // modelled shutters, grilles, base courses, shop interiors (?arch=0: none)
  if (!params.get('life') || params.get('life') !== '0') world.life = addStreetLife(R, M, world);          // decals, wall paper, meters, roof tanks (?life=0: none, for A/B)
  performance.mark('boot:world');
  $('bootText').textContent = 'Lighting'; $('bootBar').style.width = '90%';
  await new Promise(r => setTimeout(r, 30));
  const gi = params.get('nogi') ? 'off' : await setupGI(R, world, M, p => { $('bootText').textContent = `Baking light ${Math.round(p * 100)}%`; }, !!params.get('bake'), !!params.get('stalegi'));   // (?nogi=1: no indirect light, for a quick look while the geometry changes; ?stalegi=1: the last bake, even if out of date)
  performance.mark('boot:gi');
  const G = window.G = { R, M, world, settings, THREE, gi, time: 0, playing: false, matchLive: false, score: [0, 0], timeLeft: MATCH.time, stats: { shots: 0, hits: 0 } };
  G.audio = new Audio();
  G.audio.cast = (ox, oy, oz, dx, dy, dz, max) => rayBoxes(ox, oy, oz, dx, dy, dz, max, world.colliders, null, dy > 0.5 ? OVERHANG : 0);       // echoes and occlusion use the real walls (looking up, balconies are not a ceiling)
  G.audio.blocked = (a, b) => !losClear(a, b, world.colliders);
  G.audio.emitters = world.emitters;
  G.fx = new FX(R);
  G.flashes = new FlashPool(R.scene, R.camera);                                         // muzzle flashes for the bots' rifles (the player's hangs on his own)
  G.blood = new Blood(G, R);                                                // what a hit on a body leaves: mist, drops, stains, pools (?blood=0 or the options panel: none)
  G.hud = new HUD(G);
  G.player = new Player(G);
  G.weapon = new Weapon(R, R.camera, { fire: (spread, kickYaw, kickPitch) => G.player.fire(spread, kickYaw, kickPitch), sound: n => G.audio.weapon(n) });
  G.weapon.root.visible = false;
  G.rigid = await Rigid.create(G, world.dynamic);
  G.bots = new Bots(G, 4); G.carry = CARRY;
  for (const a of [G.player, ...G.bots.list]) G.rigid.addPusher(a);
  G.throw = new Throwables(G);
  G.touch = new Touch(G);                                                   // on-screen controls on a touch screen (touch.js)
  G.rigid.onImpact = (it, speed, p, other, surf) => {
    const pos = { x: p.x, y: p.y, z: p.z };
    if (it.kind === 'nade') { G.throw.bounce(it, speed, p, other ? (other.kind === 'rag' ? 'fabric' : other.mat === 'wood' || other.mat === 'wicker' || other.mat === 'cardboard' ? 'wood' : other.mat === 'bag' || other.mat === 'rubber' ? 'fabric' : 'metal') : surf); return; }
    // what a body or a dropped rifle came down on: the ground's or wall's own surface, or the thing it struck
    const under = other ? (other.kind === 'rag' ? 'fabric' : other.mat === 'wood' || other.mat === 'wicker' || other.mat === 'plastic' ? 'wood' : other.mat === 'cardboard' || other.mat === 'bag' || other.mat === 'rubber' ? 'fabric' : other.mat === 'clay' ? 'concrete' : 'metal') : surf || 'concrete';
    if (it.kind === 'rag') G.audio.bodyfall(pos, speed, it.key, under, it.rag, G.rigid.time);
    else if (it.kind === 'gun') G.audio.gunDrop(under, pos, speed);
    else G.audio.clatter(it.mat, pos, speed, it.mass);
    if (it.kind !== 'rag' && speed > 2.5) G.bots.hear(p, 9, -1);
  };
  G.rigid.onRagdoll = (rag, launch) => { const c = rag.centre(new THREE.Vector3()); G.audio.collapse({ x: c.x, y: c.y, z: c.z }, launch); };

  const applySettings = () => {
    const f = R.final, s = G.settings;
    f.uVignette.value = s.vignette ? 0.24 : 0; f.uGrain.value = s.grain ? 0.02 : 0; f.uCA.value = s.chroma ? 0.32 : 0;
    G.blurK = { off: 0, low: 0.55, high: 1.1 }[s.blur] ?? 0.55;
    G.blood.on = s.blood !== false && params.get('blood') !== '0';
    s.shake = s.shake === true ? 1 : s.shake === false ? 0 : s.shake; s.bob = s.bob === true ? 1 : s.bob === false ? 0 : s.bob;
  };
  const save = () => localStorage.setItem('market.settings', JSON.stringify({ ...G.settings, shake: !!G.settings.shake, bob: !!G.settings.bob }));
  applySettings();

  // ---- match flow ------------------------------------------------------------------------------------------------------
  G.onKill = (killer, victim, head, how) => {
    if (victim === G.player) {                                                 // heard from inside; the rifle lands just in front
      const P = G.player; G.audio.selfDeath(P.surf, how, { x: P.pos.x + Math.sin(P.yaw) * 0.55, y: P.pos.y + 0.05, z: P.pos.z + Math.cos(P.yaw) * 0.55 });
    } else { const e = victim.eye(new THREE.Vector3()); G.audio.death({ x: e.x, y: e.y, z: e.z }, how); }
    if (!G.matchLive) return;
    const own = killer && killer !== victim && killer.team === victim.team;      // a blast can catch one's own side: no point to anyone, no credit
    if (killer && killer !== victim) { if (!own) { G.score[killer.team]++; killer.kills++; } } else G.score[1 - victim.team]++;
    G.hud.kill(killer, victim, head, how);
    if (killer === G.player && !own && victim !== G.player) { G.hud.banner(head); G.audio.ui('kill'); } else G.audio.ui('score');
    if (Math.max(...G.score) >= MATCH.score) endMatch('Score limit reached');
  };
  function resetMatch() {
    G.score = [0, 0]; G.timeLeft = MATCH.time; G.time = 0; G.stats = { shots: 0, hits: 0 };
    G.fx.reset(); G.flashes.reset(); G.blood.reset(); G.bots.reset(); G.throw.reset(); G.rigid.reset(); G.player.kills = G.player.deaths = 0;
    $('feed').innerHTML = ''; G.hud.feed = []; G.hud.pings.clear();
    G.player.spawn(world.spawns[0][1]);
    G.matchLive = true;
  }
  function endMatch(reason) {
    G.matchLive = false;
    stopPlaying();
    releaseMouse();
    const d = G.score[0] - G.score[1];
    G.hud.show('results', { win: d === 0 ? null : d > 0, reason }); G.audio.ui('end');
  }
  G.resetMatch = resetMatch;
  // Each Deploy or Resume click can grant a fresh pointer lock, even after a previous refusal.
  let capture = null;
  const clearCapture = () => {
    clearTimeout(capture?.timeout);
    capture = null;
  };
  const setUnlockedLook = unlocked => {
    G.noLock = unlocked;
    canvas.classList.toggle('unlocked-look', unlocked);
    $('hint').classList.toggle('on', unlocked);
  };
  const startPlaying = unlocked => {
    clearCapture();
    G.player.clearInput();
    setUnlockedLook(unlocked);
    G.playing = true;
    G.hud.show(null); G.touch.show(true);
    G.audio.resume();
    last = performance.now();
  };
  const stopPlaying = () => {
    clearCapture();
    G.player.clearInput();
    setUnlockedLook(false);
    G.playing = false;
    G.touch.show(false);
  };
  const releaseMouse = () => {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  const fallback = attempt => {
    if (capture === attempt && G.matchLive) startPlaying(true);
  };
  const lock = async () => {
    if (capture) return;
    const attempt = capture = { legacy: false, timeout: 0 };
    const request = options => {
      const result = options ? canvas.requestPointerLock(options) : canvas.requestPointerLock();
      // Older browsers report success or failure solely through the document events.
      attempt.legacy = result === undefined;
      if (attempt.legacy) attempt.timeout = setTimeout(() => fallback(attempt), 1000);
      return result;
    };
    try {
      await request({ unadjustedMovement: true });
    } catch (error) {
      if (capture !== attempt) return;
      if (error.name === 'NotSupportedError') {
        try { await request(); return; } catch { /* pointer lock itself was refused */ }
      }
      fallback(attempt);
    }
  };
  const pause = () => {
    const wasPlaying = G.playing;
    stopPlaying();
    if (wasPlaying && G.matchLive) { G.hud.show('pause'); G.audio.suspend(); }
  };
  document.addEventListener('pointerlockerror', () => {
    if (capture?.legacy) fallback(capture);
  });
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && !G.auto && (G.playing || capture)) {
      pause();
      releaseMouse();
    }
  });
  // On a touch screen there is no mouse to capture: play starts at once, full screen where the browser allows it.
  const play = () => { if (G.touch.on) { G.touch.fullscreen(); startPlaying(false); } else lock(); };
  const begin = () => { G.audio.start(); G.audio.ui('click'); if (!G.matchLive) { resetMatch(); G.audio.ui('start'); } play(); };
  $('deploy').onclick = begin; $('resume').onclick = begin;
  $('restart').onclick = $('again').onclick = () => { G.audio.start(); resetMatch(); G.audio.ui('start'); play(); };
  G.pause = () => { pause(); releaseMouse(); };                            // (the touch controls' pause button)
  for (const b of document.querySelectorAll('button')) b.addEventListener('mouseenter', () => G.audio.ui('hover'));
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) {
      if (!G.matchLive || (!capture && !G.playing)) releaseMouse();
      else if (capture || G.noLock) startPlaying(false);
    } else if (!G.auto && G.playing && !G.noLock) pause();
  });
  const loseFocus = () => {
    if (!G.auto && (G.playing || capture)) pause();
    releaseMouse();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) loseFocus(); });
  addEventListener('blur', loseFocus);
  addEventListener('resize', () => R.resize());
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener?.('change', () => R.resize());

  // ---- settings panel ----------------------------------------------------------------------------------------------------
  for (const el of document.querySelectorAll('#settings [id^=o_]')) {
    const k = el.id.slice(2), isBox = el.type === 'checkbox', show = () => { const v = el.parentElement.querySelector('.v'); if (v) v.textContent = (+el.value).toFixed(el.step < 1 ? 2 : 0); };
    if (isBox) el.checked = !!G.settings[k]; else el.value = G.settings[k];
    show();
    el.addEventListener('input', () => {
      G.settings[k] = isBox ? el.checked : el.type === 'range' ? +el.value : el.value; if (k === 'quality') G.settings.qualityPicked = true; show(); applySettings(); save();
      if (k === 'quality') location.reload();
    });
  }

  // ---- simulation --------------------------------------------------------------------------------------------------------
  let prevYaw = 0, prevPitch = 0;
  function simulate(dt) {
    G.time += dt; G.timeLeft -= dt;
    if (G.demo) G.demo(dt);
    G.touch.update();
    G.player.update(dt);
    G.bots.update(dt);
    G.throw.update(dt);
    G.rigid.step(dt);
    G.fx.update(dt, R.camera, (p, v) => G.audio.casing({ x: p.x, y: p.y, z: p.z }, v));
    G.blood.update(dt); G.flashes.update(dt);
    G.hud.update(dt);
    const P = G.player, low = P.health < 35 ? (35 - P.health) / 35 : 0;
    G.audio.setListener(R.camera, dt, P.alive ? P.health : 100, P.interior && ceilingAt(P.pos.x, P.pos.z, P.eyeY, 0.2, world.colliders, OVERHANG) < P.eyeY + 3.2 ? 1 : 0);   // (a balcony overhead is no room)
    const f = R.final;
    f.uDamage.value = clamp((P.flash || 0) * 0.8 + low * 0.6 + (P.alive ? 0 : 0.5), 0, 1); f.uDesat.value = damp(f.uDesat.value, low * 0.55 + (P.alive ? 0 : 0.7), 6, dt);
    // restrained motion blur: only fast turns, along the turn direction
    const dy = (P.yaw - prevYaw) / Math.max(dt, 1e-3), dp = (P.pitch - prevPitch) / Math.max(dt, 1e-3); prevYaw = P.yaw; prevPitch = P.pitch;
    const k = G.blurK * clamp((Math.hypot(dy, dp) - 1.6) / 6, 0, 1) * 0.02;
    f.uBlur.value.set(clamp(dy, -9, 9) * k / 3, clamp(-dp, -9, 9) * k / 3);
    if (G.matchLive && G.timeLeft <= 0) endMatch('Time limit reached');
  }

  let last = performance.now(), wall = 0;
  const pace = new Float32Array(7200); let paceN = 0, paceI = 0, perfT = 0, menuSkip = 0;
  let wasPlaying = false;
  const frame = now => {
    const raw = now - last;
    const dt = clamp(raw / 1000, 0, 0.05); last = now; wall += dt;     // (a frame stamped before the last resume would otherwise run time backwards)
    if (G.playing && wasPlaying && !G.manual && document.hasFocus()) { pace[paceI] = raw; paceI = (paceI + 1) % pace.length; paceN = Math.min(pace.length, paceN + 1); }   // pause and focus gaps are not frames
    wasPlaying = G.playing && document.hasFocus();
    if (G.perfOn && (perfT -= dt) <= 0) { perfT = 0.5; const p = G.pacing(), i = R.renderer.info.render, c = R.renderer.domElement; $('perf').textContent = `${p.fps.toFixed(0)} fps  ${p.mean.toFixed(1)} ms  p95 ${p.p95.toFixed(1)}  worst ${p.worst.toFixed(1)}\n${i.calls} draws  ${(i.triangles / 1e6).toFixed(2)}M tris  ${c.width}x${c.height}  scale ${R.renderScale.toFixed(2)}`; }
    if (G.playing && !G.manual && dt > 0) simulate(dt); else if (!G.manual) R.final.uBlur.value.set(0, 0);
    if (G.manual) { requestAnimationFrame(frame); return; }      // tests drive the clock through G.step()
    if (!G.matchLive && !G.frozen) {            // slow establishing shot behind the menus
      const a = wall * 0.03; R.camera.position.set(1.5 + Math.sin(a) * 1.2, 1.9, -47 + Math.cos(a * 0.7) * 3); R.camera.rotation.set(0.05, Math.PI + Math.sin(a) * 0.12, 0, 'YXZ'); R.camera.fov = 58;
    }
    windUniforms.uTime.value = wall;
    if (G.playing) R.adapt(raw, dt);
    else if ((menuSkip = (menuSkip + 1) % 3) !== 0) { requestAnimationFrame(frame); return; }   // menus and pause: a third of the frame rate is plenty
    R.render(dt, wall);
    requestAnimationFrame(frame);
  };

  // ---- test / capture hooks (same systems as normal play) -------------------------------------------------------------------
  // Manual stepping renders every 4th step so metering and exposure settle the way they do on screen.
  G.setClock = t => { wall = t; };          // captures: the same drifting clouds and cloud shadows in every run
  G.step = (n = 1, dt = 1 / 60) => { R.meter.sync = true; for (let i = 0; i < n; i++) { simulate(dt); wall += dt; windUniforms.uTime.value = wall; if (i % 4 === 3 && i < n - 1) R.render(dt * 4, wall); } R.render(dt, wall); R.meter.sync = false; };
  G.capture = async (name, w, h) => {
    if (w) { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
    if (w || R.renderScale !== 1) { R.renderScale = 1; R.adaptive = false; R.resize(); }      // captures are always full resolution
    R.render(1 / 60, wall);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.93));
    await fetch('/__capture/' + name + '.jpg', { method: 'POST', body: blob });
    return `${name}.jpg ${canvas.width}x${canvas.height}`;
  };
  // On-screen frame pacing over the last `secs` of play (real requestAnimationFrame intervals).
  G.pacing = (secs = 0) => {
    let n = paceN; const a = [];
    for (let k = 0, t = 0; k < n; k++) { const v = pace[(paceI - 1 - k + pace.length) % pace.length]; a.push(v); t += v; if (secs && t > secs * 1000) break; }
    if (!a.length) return { n: 0, mean: 0, p95: 0, p99: 0, worst: 0, fps: 0, over20: 0, over33: 0 };
    const s = a.slice().sort((x, y) => x - y), mean = a.reduce((x, y) => x + y, 0) / a.length;
    return { n: a.length, mean, p95: s[Math.floor(s.length * 0.95)], p99: s[Math.floor(s.length * 0.99)], worst: s[s.length - 1], fps: 1000 / mean, over20: a.filter(v => v > 20).length, over33: a.filter(v => v > 33.4).length };
  };
  G.pacingReset = () => { paceN = 0; paceI = 0; };
  // Posts a JSON snapshot of the live session (pacing, audio levels, input counts, match state) to ./captures via the dev server.
  G.report = async (name = 'live') => {
    const P = G.player, c = R.renderer.domElement;
    const data = { when: new Date().toISOString(), ua: navigator.userAgent, quality: G.settings.quality, canvas: [c.width, c.height], dpr: devicePixelRatio, renderScale: R.renderScale,
      locked: document.pointerLockElement === canvas, noLock: !!G.noLock, playing: G.playing, matchLive: G.matchLive, time: +G.time.toFixed(1), score: G.score,
      pacing: G.pacing(), pacing10s: G.pacing(10), audio: G.audio.stats(), input: P.inputCount,
      player: { pos: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)], yaw: +(P.yaw * 180 / Math.PI).toFixed(1), pitch: +(P.pitch * 180 / Math.PI).toFixed(1), health: Math.round(P.health), alive: P.alive, kills: P.kills, deaths: P.deaths },
      weapon: { ammo: G.weapon.ammo, reserve: G.weapon.reserve, mode: G.weapon.mode, ads: +G.weapon.ads.toFixed(2), reloading: G.weapon.reloading }, throwables: { ...G.throw.count, selected: G.throw.sel, thrown: G.throw.thrown }, stats: G.stats,
      draws: R.renderer.info.render.calls, tris: R.renderer.info.render.triangles };
    await fetch('/__capture/' + name + '.json', { method: 'POST', body: JSON.stringify(data, null, 1) });
    return data;
  };
  addEventListener('keydown', e => {
    if (e.code === 'F3') { G.perfOn = !G.perfOn; $('perf').classList.toggle('on', G.perfOn); e.preventDefault(); }
    if (e.code === 'F4') { G.report('live'); e.preventDefault(); }
  });
  if (params.get('live')) setInterval(() => G.report('live'), 3000);
  G.selfTest = () => { const r = selfTest(G); console.table(r); return r; };
  G.proof = (w, h) => proof(G, w, h);
  G.proofThrow = (w, h) => proofThrow(G, w, h);
  G.autoStart = () => { G.auto = true; G.frozen = true; resetMatch(); G.playing = true; G.hud.show(null); };
  G.goto = (x, z, yawDeg = 0, pitchDeg = 0) => { const P = G.player; P.pos.set(x, 0, z); P.vel.set(0, 0, 0); P.yaw = yawDeg * Math.PI / 180; P.pitch = pitchDeg * Math.PI / 180; P.camY = 1.62; P.sim = { f: 0, s: 0, yaw: P.yaw, pitch: P.pitch }; };
  // Synchronous benchmark: simulate + render n frames, waiting on the GPU each time (independent of display vsync / tab throttling).
  G.bench = (n = 240, dt = 1 / 60) => {
    const gl = R.renderer.getContext(), ts = [], px = new Uint8Array(4); G.manual = true;
    for (let i = 0; i < n; i++) { const t0 = performance.now(); G.step(1, dt); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }   // readPixels forces the GPU to finish (it fails, and does not wait, while the exposure meter's async read holds a pack buffer)
    G.manual = false; last = performance.now();
    ts.splice(0, Math.min(20, ts.length - 1)); ts.sort((a, b) => a - b);
    const avg = ts.reduce((a, b) => a + b, 0) / ts.length, i = R.renderer.info.render, c = R.renderer.domElement;
    return `frames ${ts.length} | mean ${avg.toFixed(2)} ms (${(1000 / avg).toFixed(0)} fps) | p95 ${ts[Math.floor(ts.length * 0.95)].toFixed(2)} | worst ${ts[ts.length - 1].toFixed(2)} | calls ${i.calls} | tris ${Math.round(i.triangles / 1000)}k | ${c.width}x${c.height} | particles ${G.fx.dust.n + G.fx.glow.n} | puffs ${G.throw.puffs.list.length}`;
  };
  G.perf = async (n = 90) => {
    const t0 = performance.now(); let k = 0;
    await new Promise(r => { const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); setTimeout(r, 6000); });
    const ms = (performance.now() - t0) / Math.max(1, k), i = R.renderer.info.render, c = R.renderer.domElement;
    return `${ms.toFixed(1)} ms (${(1000 / ms).toFixed(0)} fps) | calls ${i.calls} | tris/frame ${Math.round(i.triangles / 1000)}k | ${c.width}x${c.height} | particles ${G.fx.dust.n + G.fx.glow.n} | voices ${G.audio.voices}`;
  };

  $('bootText').textContent = 'Compiling shaders'; $('bootBar').style.width = '94%';
  await new Promise(r => setTimeout(r, 30));
  R.farShadowLayer();                                  // (once everything that casts is in the scene)
  R.zones = world.zones;
  R.onCull = (p, k) => G.rigid.cullProps(p, 70 * k);  // loose clutter out of reach is not drawn
  G.weapon.root.visible = true; for (const b of G.bots.list) { b.root.visible = true; b.gun.visible = true; }
  G.throw.warm(true); G.flashes.warm(true, [G.weapon.flashFx]); G.blood.warm(true);
  // Compile for the target the scene is really drawn into (linear half-float, tone mapped later): compiled for the
  // screen, a material gets a tone-mapped sRGB program nothing uses and still compiles on first sight in play. Twice:
  // with the first-person weapon shown, and hidden as while the player is dead, which also hides its muzzle light,
  // and a different light count is a different program for every lit material (first death froze for 0.3-0.5 s).
  const precompile = async () => {
    R.renderer.setRenderTarget(R.sceneRT);
    const ready = R.renderer.compileAsync(R.scene, R.camera);   // (programs are chosen synchronously, for the bound target)
    R.renderer.setRenderTarget(null);
    try { await ready; } catch (e) { console.warn(e); }
  };
  await precompile();
  G.weapon.root.visible = false; await precompile(); G.weapon.root.visible = true;
  // Upload every texture now as well: three.js sends a texture to the GPU the first time something drawn uses it, and
  // the market quarter's twenty-odd maps arriving in one frame stalled the first look at it for over 100 ms.
  const sent = new Set(), send = t => { if (t && t.isTexture && !t.isRenderTargetTexture && !sent.has(t)) { sent.add(t); R.renderer.initTexture(t); } };
  R.scene.traverse(o => {
    for (const m of [o.material].flat()) {
      if (!m) continue;
      for (const v of Object.values(m)) send(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) send(u && u.value);
      if (m.userData.layers) for (const v of Object.values(m.userData.layers)) send(v);
    }
  });
  R.render(0.016, 0);                                  // warm every pipeline before the first interactive frame
  G.weapon.root.visible = false; for (const b of G.bots.list) { b.root.visible = false; b.gun.visible = false; }
  G.throw.warm(false); G.throw.puffs.reset(); G.flashes.warm(false, [G.weapon.flashFx]); G.blood.warm(false);
  if (R.Q.lean) G.leanMB = lean(R, assets.sky);
  $('boot').remove(); performance.mark('boot:ready');
  // Load-time phases in ms since navigation: assets fetched and decoded, district built, light loaded or baked, shaders and textures warmed.
  G.bootTimes = () => Object.fromEntries(['assets', 'world', 'gi', 'ready'].map(k => [k, Math.round(performance.getEntriesByName('boot:' + k)[0]?.startTime ?? -1)]));
  G.hud.show('start');
  G.los = (a, b) => losClear(a, b, world.colliders) && !G.throw.smoked(a, b);
  if (params.get('bench')) runBench(G, params.get('bench'));        // dev: timings and captures with no console at hand (the native window)
  if (params.get('ab')) setTimeout(async () => { const perf = await import('/tools/perf-probe.js'); const r = await perf.ab(G, perf.ARCH_CASES); await fetch(`/__capture/ab_${params.get('ab')}.json`, { method: 'POST', body: JSON.stringify(r, null, 1) }); }, 1500);   // dev: settings timed in turn (tools/perf-probe.js ab)
  if (params.get('prof')) setTimeout(async () => { const perf = await import('/tools/perf-probe.js'); const r = await perf.profile(G); await fetch(`/__capture/prof_${params.get('prof')}.json`, { method: 'POST', body: JSON.stringify(r, null, 1) }); }, 1500);   // dev: where the frame time goes
  if (params.get('selftest')) setTimeout(() => fetch('/__capture/selftest.json', { method: 'POST', body: JSON.stringify(G.selfTest(), null, 1) }), 300);   // dev: the acceptance run, saved to captures/
  if (params.get('auto') || params.get('demo')) G.autoStart();
  if (params.get('demo')) { G.demo = demoDriver(G); G.frozen = false; G.audio.start(); }
  requestAnimationFrame(frame);
}
start().catch(e => { $('bootText').textContent = 'Error: ' + e.message; console.error(e); });

// The phone preset, once everything is on the GPU and the renderer has listed its cells: the district's cells are data now
// (batch.js), and rounds, thrown things, sight checks and the props' bounds read their positions alone, so their normals,
// colours, uvs and the rest go (a cell drawn through a twin of its own, or whose geometry anything drawn shares, keeps them).
// About 300 MB of the page's memory; with them goes the sky's own copy of its pixels (64 MB: it is on the GPU, and the
// light bake that reads them, if one was needed, is done). Returns the megabytes let go.
function lean(R, skyTex) {
  const drawn = new Set(); R.scene.traverse(o => { if (o.geometry) drawn.add(o.geometry); });
  let bytes = 0;
  for (const a of new Set([R.sky.data, skyTex.image.data])) if (a) bytes += a.byteLength;
  R.sky.data = null; skyTex.image.data = null;
  for (const m of R.detached || []) {
    const g = m.geometry; if (m.userData.twin || drawn.has(g)) continue;
    for (const k of Object.keys(g.attributes)) if (k !== 'position') { bytes += g.attributes[k].array.byteLength; g.deleteAttribute(k); }
  }
  return Math.round(bytes / 1048576);
}

// ?bench=<tag>: once loaded, time the fixed views (tools/perf-probe.js, median of three), estimate GPU memory, note the
// load-time phases, save the comparison captures (tools/compare-shots.js), and post it all to captures/ as bench_<tag>.
async function runBench(G, tag) {
  const post = (name, body) => fetch('/__capture/' + name, { method: 'POST', body });
  await new Promise(r => setTimeout(r, 1500));
  const perf = await import('/tools/perf-probe.js'), cmp = await import('/tools/compare-shots.js');
  const res = { tag, when: new Date().toISOString(), ua: navigator.userAgent, boot: G.bootTimes() };
  const p = await perf.median(G); res.size = p.size; res.views = p.views; res.memory = p.memory;
  await post(`bench_${tag}.json`, JSON.stringify(res, null, 1));
  if (!/noshots/.test(location.search)) await cmp.shots(G, tag);
  await post(`bench_${tag}_done.json`, '{}');
}
