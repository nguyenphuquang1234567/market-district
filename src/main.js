// Boot, settings, match rules and the frame loop.
import * as THREE from 'three';
import { loadAssets } from './assets.js';
import { createRenderer, PRESETS } from './render.js';
import { createMaterials, windUniforms } from './materials.js';
import { buildWorld } from './world.js';
import { Weapon } from './weapon.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Player } from './player.js';
import { Bots, CARRY } from './bots.js';
import { Rigid } from './rigid.js';
import { HUD } from './hud.js';
import { clamp, damp } from './util.js';
import { selfTest, proof, demoDriver } from './selftest.js';
import { losClear, rayBoxes } from './physics.js';
import { setupGI } from './gi.js';

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const canvas = $('view');
const DEFAULTS = {
  sensitivity: 1, fov: 60, adsSens: 1, invertY: false, quality: 'high', difficulty: 'normal', blur: 'low', shake: true, vignette: true, grain: true, chroma: true, bob: true,
  binds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', crouch: 'KeyC', jump: 'Space', reload: 'KeyR', mode: 'KeyB', inspect: 'KeyF' },
};
const MATCH = { time: 600, score: 30 };

function loadSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('market.settings') || '{}'); } catch { /* fresh */ }
  const out = { ...DEFAULTS, ...s, binds: { ...DEFAULTS.binds, ...(s.binds || {}) } };
  if (params.get('q') && PRESETS[params.get('q')]) out.quality = params.get('q');
  return out;
}

async function start() {
  const settings = loadSettings();
  const probe = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  const assets = await loadAssets(probe, p => { $('bootBar').style.width = (p * 82).toFixed(0) + '%'; });
  probe.dispose();
  $('bootText').textContent = 'Building district'; $('bootBar').style.width = '88%';
  await new Promise(r => setTimeout(r, 30));

  const R = createRenderer(canvas, assets.sky, settings.quality);
  const M = createMaterials();
  const world = buildWorld(R, M);
  $('bootText').textContent = 'Lighting'; $('bootBar').style.width = '90%';
  await new Promise(r => setTimeout(r, 30));
  const gi = await setupGI(R, world, M, p => { $('bootText').textContent = `Baking light ${Math.round(p * 100)}%`; }, !!params.get('bake'));
  const G = window.G = { R, M, world, settings, THREE, gi, time: 0, playing: false, matchLive: false, score: [0, 0], timeLeft: MATCH.time, stats: { shots: 0, hits: 0 } };
  G.audio = new Audio();
  G.audio.cast = (ox, oy, oz, dx, dy, dz, max) => rayBoxes(ox, oy, oz, dx, dy, dz, max, world.colliders, null);       // echoes and occlusion use the real walls
  G.audio.blocked = (a, b) => !losClear(a, b, world.colliders);
  G.audio.emitters = world.emitters;
  G.fx = new FX(R);
  G.hud = new HUD(G);
  G.player = new Player(G);
  G.weapon = new Weapon(R, R.camera, { fire: (spread, kickYaw, kickPitch) => G.player.fire(spread, kickYaw, kickPitch), sound: n => G.audio.weapon(n) });
  G.weapon.root.visible = false;
  G.rigid = await Rigid.create(G, world.dynamic);
  G.bots = new Bots(G, 4); G.carry = CARRY;
  for (const a of [G.player, ...G.bots.list]) G.rigid.addPusher(a);
  G.rigid.onImpact = (it, speed, p, other) => {
    const pos = { x: p.x, y: p.y, z: p.z };
    if (it.kind === 'rag') G.audio.bodyfall(pos, speed, it.key); else G.audio.clatter(it.mat, pos, speed, it.mass);
    if (it.kind !== 'rag' && speed > 2.5) G.bots.hear(p, 9, -1);
  };

  const applySettings = () => {
    const f = R.final, s = G.settings;
    f.uVignette.value = s.vignette ? 0.24 : 0; f.uGrain.value = s.grain ? 0.02 : 0; f.uCA.value = s.chroma ? 0.32 : 0;
    G.blurK = { off: 0, low: 0.55, high: 1.1 }[s.blur] ?? 0.55;
    s.shake = s.shake === true ? 1 : s.shake === false ? 0 : s.shake; s.bob = s.bob === true ? 1 : s.bob === false ? 0 : s.bob;
  };
  const save = () => localStorage.setItem('market.settings', JSON.stringify({ ...G.settings, shake: !!G.settings.shake, bob: !!G.settings.bob }));
  applySettings();

  // ---- match flow ------------------------------------------------------------------------------------------------------
  G.onKill = (killer, victim, head) => {
    if (!G.matchLive) return;
    if (killer && killer !== victim) { if (killer.team !== victim.team) G.score[killer.team]++; killer.kills++; } else G.score[1 - victim.team]++;
    G.hud.kill(killer, victim, head);
    if (killer === G.player) { G.hud.banner(head); G.audio.ui('kill'); } else G.audio.ui('score');
    if (Math.max(...G.score) >= MATCH.score) endMatch('Score limit reached');
  };
  function resetMatch() {
    G.score = [0, 0]; G.timeLeft = MATCH.time; G.time = 0; G.stats = { shots: 0, hits: 0 };
    G.fx.reset(); G.bots.reset(); G.rigid.reset(); G.player.kills = G.player.deaths = 0;
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
    G.hud.show(null);
    G.audio.resume();
    last = performance.now();
  };
  const stopPlaying = () => {
    clearCapture();
    G.player.clearInput();
    setUnlockedLook(false);
    G.playing = false;
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
  const begin = () => { G.audio.start(); G.audio.ui('click'); if (!G.matchLive) { resetMatch(); G.audio.ui('start'); } lock(); };
  $('deploy').onclick = begin; $('resume').onclick = begin;
  $('restart').onclick = $('again').onclick = () => { G.audio.start(); resetMatch(); G.audio.ui('start'); lock(); };
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
      G.settings[k] = isBox ? el.checked : el.type === 'range' ? +el.value : el.value; show(); applySettings(); save();
      if (k === 'quality') location.reload();
    });
  }

  // ---- simulation --------------------------------------------------------------------------------------------------------
  let prevYaw = 0, prevPitch = 0;
  function simulate(dt) {
    G.time += dt; G.timeLeft -= dt;
    if (G.demo) G.demo(dt);
    G.player.update(dt);
    G.bots.update(dt);
    G.rigid.step(dt);
    G.fx.update(dt, R.camera, (p, v) => G.audio.casing({ x: p.x, y: p.y, z: p.z }, v));
    G.hud.update(dt);
    const P = G.player, low = P.health < 35 ? (35 - P.health) / 35 : 0;
    G.audio.setListener(R.camera, dt, P.alive ? P.health : 100, P.interior);
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
      weapon: { ammo: G.weapon.ammo, reserve: G.weapon.reserve, mode: G.weapon.mode, ads: +G.weapon.ads.toFixed(2), reloading: G.weapon.reloading }, stats: G.stats,
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
  G.autoStart = () => { G.auto = true; G.frozen = true; resetMatch(); G.playing = true; G.hud.show(null); };
  G.goto = (x, z, yawDeg = 0, pitchDeg = 0) => { const P = G.player; P.pos.set(x, 0, z); P.vel.set(0, 0, 0); P.yaw = yawDeg * Math.PI / 180; P.pitch = pitchDeg * Math.PI / 180; P.camY = 1.62; P.sim = { f: 0, s: 0, yaw: P.yaw, pitch: P.pitch }; };
  // Synchronous benchmark: simulate + render n frames, waiting on the GPU each time (independent of display vsync / tab throttling).
  G.bench = (n = 240, dt = 1 / 60) => {
    const gl = R.renderer.getContext(), ts = [], px = new Uint8Array(4); G.manual = true;
    for (let i = 0; i < n; i++) { const t0 = performance.now(); G.step(1, dt); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }   // readPixels forces the GPU to finish
    G.manual = false; last = performance.now();
    ts.splice(0, Math.min(20, ts.length - 1)); ts.sort((a, b) => a - b);
    const avg = ts.reduce((a, b) => a + b, 0) / ts.length, i = R.renderer.info.render, c = R.renderer.domElement;
    return `frames ${ts.length} | mean ${avg.toFixed(2)} ms (${(1000 / avg).toFixed(0)} fps) | p95 ${ts[Math.floor(ts.length * 0.95)].toFixed(2)} | worst ${ts[ts.length - 1].toFixed(2)} | calls ${i.calls} | tris ${Math.round(i.triangles / 1000)}k | ${c.width}x${c.height} | particles ${G.fx.dust.n + G.fx.glow.n}`;
  };
  G.perf = async (n = 90) => {
    const t0 = performance.now(); let k = 0;
    await new Promise(r => { const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); setTimeout(r, 6000); });
    const ms = (performance.now() - t0) / Math.max(1, k), i = R.renderer.info.render, c = R.renderer.domElement;
    return `${ms.toFixed(1)} ms (${(1000 / ms).toFixed(0)} fps) | calls ${i.calls} | tris/frame ${Math.round(i.triangles / 1000)}k | ${c.width}x${c.height} | particles ${G.fx.dust.n + G.fx.glow.n} | voices ${G.audio.voices}`;
  };

  $('bootText').textContent = 'Compiling shaders'; $('bootBar').style.width = '94%';
  await new Promise(r => setTimeout(r, 30));
  G.weapon.root.visible = true; for (const b of G.bots.list) { b.root.visible = true; b.gun.visible = true; }
  try { await R.renderer.compileAsync(R.scene, R.camera); } catch (e) { console.warn(e); }
  R.render(0.016, 0);                                  // warm every pipeline before the first interactive frame
  G.weapon.root.visible = false; for (const b of G.bots.list) { b.root.visible = false; b.gun.visible = false; }
  $('boot').remove();
  G.hud.show('start');
  G.los = (a, b) => losClear(a, b, world.colliders);
  if (params.get('auto') || params.get('demo')) G.autoStart();
  if (params.get('demo')) { G.demo = demoDriver(G); G.frozen = false; G.audio.start(); }
  requestAnimationFrame(frame);
}
start().catch(e => { $('bootText').textContent = 'Error: ' + e.message; console.error(e); });
