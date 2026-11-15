// Audio engine. Sounds come from the modelled library in sounds.js; this file places them in the district:
// speed-of-sound delay, air absorption, occlusion by walls, early reflections traced from the listener's actual
// surroundings, three reverberant spaces (street, narrow passage, room), and an "ear" that closes down after each shot.
import { rng, clamp } from './util.js';
import { bakeSounds } from './sounds.js';

const IMP = { concrete: 'concrete', plaster: 'concrete', brick: 'concrete', tile: 'concrete', dirt: 'dirt', wood: 'wood', metal: 'metal', fabric: 'fabric', glass: 'glass', flesh: 'flesh', plastic: 'plastic' };
const STEP = { concrete: 'step_concrete', plaster: 'step_concrete', brick: 'step_concrete', dirt: 'step_dirt', wood: 'step_wood', metal: 'step_metal', tile: 'step_tile', fabric: 'step_fabric', water: 'step_water' };
const PROP = { plastic: 'prop_plastic', wood: 'prop_wood', bin: 'prop_bin', can: 'prop_can', tank: 'prop_tank', clay: 'prop_clay', cardboard: 'prop_cardboard', rubber: 'prop_rubber', bag: 'prop_bag', wicker: 'prop_wicker', gun: 'prop_gun', frag: 'prop_frag', canister: 'prop_canister' };
const C = 343;      // speed of sound, m/s

export class Audio {
  constructor() {
    this.ctx = null; this.rnd = rng(31337); this.voices = 0; this.muffle = 0; this.raw = bakeSounds(48000);
    this.cast = null; this.blocked = null; this.emitters = []; this.active = []; this.env = { room: 0, narrow: 0, open: 1 }; this.lpos = { x: 0, y: 1.6, z: 0 }; this.envT = 0; this.emitT = 0; this.last = {}; this.foot = false; this.concuss = 0; this.hisses = [];
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }), R = this.rnd, sr = ctx.sampleRate;
    this.S = {};
    for (const [name, vars] of Object.entries(this.raw)) this.S[name] = vars.map(v => { const chs = Array.isArray(v) ? v : [v], b = ctx.createBuffer(chs.length, chs[0].length, 48000); chs.forEach((c, i) => b.copyToChannel(c, i)); return b; });
    const len = sr * 2; this.white = ctx.createBuffer(1, len, sr); this.brown = ctx.createBuffer(1, len, sr);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0); let acc = 0;
    for (let i = 0; i < len; i++) { w[i] = R() * 2 - 1; acc = (acc + 0.02 * w[i]) / 1.02; b[i] = acc * 3.5; }
    // master: mix -> damage muffle -> glue compressor -> soft clip -> out
    this.master = ctx.createGain(); this.master.gain.value = 0.78;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -15; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    const clip = ctx.createWaveShaper(), curve = new Float32Array(1025); for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); } clip.curve = curve; clip.oversample = '2x';
    this.lp.connect(comp); comp.connect(clip); clip.connect(this.master); this.master.connect(ctx.destination);
    this.an = ctx.createAnalyser(); this.an.fftSize = 2048; this.master.connect(this.an); this.buf = new Float32Array(2048); this.lv = { peak: 0, sq: 0, n: 0, clipped: 0 };
    // the ear: everything but the player's own rifle dips for a moment after each of its shots
    this.duck = ctx.createGain(); this.duck.connect(this.lp);
    const bus = (g, ducked) => { const n = ctx.createGain(); n.gain.value = g; n.connect(ducked ? this.duck : this.lp); return n; };
    this.bus = { weapon: bus(1.0, false), world: bus(0.95, true), impact: bus(0.8, true), foley: bus(0.62, true), amb: bus(0.5, true), ui: bus(0.5, false) };
    // early reflections: six delay lines, one per 60 degree sector, retuned from rays cast around the listener
    this.erIn = ctx.createGain(); this.taps = [];
    for (let i = 0; i < 6; i++) {
      const delay = ctx.createDelay(0.8), lp = ctx.createBiquadFilter(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.5; gain.gain.value = 0; delay.delayTime.value = 0.05;
      this.erIn.connect(delay); delay.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(this.lp);
      this.taps.push({ delay, lp, gain, pan, dx: Math.sin(i * 1.047), dz: Math.cos(i * 1.047), d: 99 });
    }
    // late reverberation: three generated spaces with band-dependent decay (highs die first), crossfaded by surroundings
    const ir = (secs, t60, pre, bright, echoes) => {
      const n = Math.floor(sr * secs), buf = ctx.createBuffer(2, n, sr), aL = 1 - Math.exp(-6.2832 * 400 / sr), aM = 1 - Math.exp(-6.2832 * 3000 / sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch); let l1 = 0, l2 = 0;
        for (let i = 0; i < n; i++) {
          const x = R() * 2 - 1; l1 += (x - l1) * aL; l2 += (x - l2) * aM; const t = i / sr - pre; if (t < 0) continue;
          d[i] = (l1 * 2.4 * Math.exp(-6.9 * t / t60) + (l2 - l1) * Math.exp(-6.9 * t / (t60 * 0.8)) + (x - l2) * 0.55 * bright * Math.exp(-6.9 * t / (t60 * 0.42))) * (1 - Math.exp(-t / 0.004));
        }
        for (const [at, g] of echoes) { const k = Math.floor((at * (ch ? 1.06 : 1) + pre) * sr); if (k < n) d[k] += g * (R() < 0.5 ? -1 : 1); }
      }
      return buf;
    };
    const conv = buf => { const c = ctx.createConvolver(); c.buffer = buf; const out = ctx.createGain(); out.gain.value = 0; c.connect(out); out.connect(this.lp); return { c, out }; };
    this.rev = {
      street: conv(ir(2.2, 1.7, 0.022, 0.8, [[0.03, 0.5], [0.061, 0.4], [0.097, 0.32], [0.15, 0.26], [0.23, 0.2], [0.34, 0.14]])),
      narrow: conv(ir(1.3, 0.95, 0.008, 1, [[0.017, 0.7], [0.034, 0.55], [0.051, 0.42], [0.068, 0.32], [0.085, 0.24], [0.102, 0.18], [0.119, 0.13]])),     // flutter between facing walls
      room: conv(ir(0.7, 0.5, 0.003, 1.2, [[0.006, 0.6], [0.011, 0.5], [0.019, 0.4], [0.027, 0.3]])),
    };
    this.revSend = ctx.createGain(); for (const r of Object.values(this.rev)) this.revSend.connect(r.c);
    this.listener = ctx.listener;
    this._ambience();
  }

  get now() { return this.ctx.currentTime; }
  // Samples the output signal; called every frame so a session yields peak and RMS levels (0 dBFS = 1.0).
  measure() {
    if (!this.an) return;
    this.an.getFloatTimeDomainData(this.buf); const lv = this.lv;
    for (let i = 0; i < this.buf.length; i += 2) { const v = Math.abs(this.buf[i]); if (v > lv.peak) lv.peak = v; if (v >= 0.999) lv.clipped++; lv.sq += v * v; lv.n++; }
  }
  stats(reset = false) {
    if (!this.ctx) return { state: 'not started', sounds: Object.keys(this.raw).length };
    const lv = this.lv, db = v => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -120), E = this.env;
    const out = { state: this.ctx.state, sampleRate: this.ctx.sampleRate, peakDb: db(lv.peak), rmsDb: db(Math.sqrt(lv.sq / Math.max(1, lv.n))), clippedSamples: lv.clipped, voices: this.voices, latencyMs: +((this.ctx.baseLatency || 0) * 1000).toFixed(1),
      space: { room: +E.room.toFixed(2), narrow: +E.narrow.toFixed(2), open: +E.open.toFixed(2) }, echoesMs: this.taps.map(t => (t.d < 68 ? Math.round(2 * t.d / C * 1000) : null)), hums: this.active.length };
    if (reset) this.lv = { peak: 0, sq: 0, n: 0, clipped: 0 };
    return out;
  }
  suspend() { this.ctx?.suspend(); } resume() { this.ctx?.resume(); }

  // ---- voices -------------------------------------------------------------------------------------------------------------
  // o: { bus, gain, rate, jitter, pos, ref, pan, lp, delay, rev, er }
  _play(name, o = {}) {
    const ctx = this.ctx, vars = ctx && this.S[name]; if (!vars) return null;
    const gain = o.gain ?? 1; if (gain < 0.004 || (this.voices > 60 && gain < 0.5)) return null;
    let i = (this.rnd() * vars.length) | 0; if (vars.length > 1 && i === this.last[name]) i = (i + 1) % vars.length; this.last[name] = i;      // never the same take twice running
    const src = ctx.createBufferSource(); src.buffer = vars[i]; src.playbackRate.value = (o.rate || 1) * (1 + (this.rnd() - 0.5) * (o.jitter ?? 0.08));
    const g = ctx.createGain(); g.gain.value = gain * (1 + (this.rnd() - 0.5) * 0.16);
    if (o.lp && o.lp < 18000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(250, o.lp); f.Q.value = 0.5; src.connect(f); f.connect(g); } else src.connect(g);
    let out = g;
    if (o.pos) {
      const pn = ctx.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = o.ref || 3; pn.rolloffFactor = 1; pn.maxDistance = 500;
      pn.positionX.value = o.pos.x; pn.positionY.value = o.pos.y; pn.positionZ.value = o.pos.z; g.connect(pn); out = pn;
    } else if (o.pan) { const sp = ctx.createStereoPanner(); sp.pan.value = o.pan; g.connect(sp); out = sp; }
    out.connect(o.bus || this.bus.foley);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; out.connect(s); s.connect(this.revSend); }
    if (o.er) { const s = ctx.createGain(); s.gain.value = o.er; out.connect(s); s.connect(this.erIn); }
    this.voices++; src.onended = () => { this.voices--; };
    src.start(this.now + (o.delay || 0));
    return src;
  }
  // How the path from a source to the listener changes it: arrival delay, air absorption, walls in the way.
  _carry(pos, o) {
    const l = this.lpos, d = Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
    let occ = 0;
    if (this.blocked && d > 2.5) occ = (this.blocked(l, pos) ? 0.5 : 0) + (this.blocked(l, { x: pos.x, y: pos.y + 1.6, z: pos.z }) ? 0.3 : 0) + (this.blocked({ x: l.x, y: l.y + 1.3, z: l.z }, pos) ? 0.2 : 0);   // partly hidden sources still diffract over and around
    o.pos = pos; o.delay = (o.delay || 0) + d / C;
    o.lp = Math.min(o.lp || 20000, 20000 * Math.exp(-d / 110), 20000 * Math.pow(0.045, occ));
    o.gain = (o.gain ?? 1) * (1 - occ * 0.6);
    o.rev = (o.rev ?? 0.2) * (1 + Math.min(2, d / 30)) * (1 + occ);            // distant and hidden sources arrive mostly as reflected sound
    return d;
  }
  _tone(f0, f1, dur, gain, t, type = 'sine') {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.bus.ui); o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- weapons ----------------------------------------------------------------------------------------------------------------
  shot() {
    if (!this.ctx) return; const E = this.env, t = this.now;
    this._play('shot', { bus: this.bus.weapon, gain: 1, jitter: 0.05, er: 0.9, rev: 0.2 + E.room * 0.3 });
    if (E.room < 0.6) this._play('tail', { bus: this.bus.weapon, gain: 0.32 * (1 - E.room) * (0.55 + 0.45 * E.open), delay: 0.03, jitter: 0.1, pan: (this.rnd() - 0.5) * 0.7 });     // the report rolling off down the streets
    const d = this.duck.gain; d.cancelScheduledValues(t); d.setTargetAtTime(0.42, t, 0.008); d.setTargetAtTime(1, t + 0.09, 0.45);
  }
  // Someone else's rifle: heard late by its distance, duller the further off, muffled when walls stand between.
  shotAt(pos) {
    if (!this.ctx) return;
    const o = { bus: this.bus.world, ref: 9, er: 0.25, rev: 0.25, jitter: 0.1 }, d = this._carry(pos, o), far = clamp((d - 35) / 60, 0, 1);
    if (far < 1) this._play('shotMid', { ...o, gain: o.gain * 2.4 * (1 - far) });
    if (far > 0) this._play('shotFar', { ...o, gain: o.gain * 2.8 * far, ref: 14 });
  }
  whiz(pos) { if (this.ctx) this._play('crack', { pos, bus: this.bus.world, ref: 1.5, gain: 1.3, rev: 0.15, er: 0.3, jitter: 0.15 }); }

  impact(surf, pos, near = true) {
    if (!this.ctx || surf === 'none') return;
    const o = { bus: this.bus.impact, ref: 2.2, gain: near ? 1.2 : 0.9, er: 0.25, rev: 0.2, jitter: 0.14 }; this._carry(pos, o);
    this._play('imp_' + (IMP[surf] || 'concrete'), o);
    if ((surf === 'metal' || surf === 'concrete' || surf === 'brick' || surf === 'plaster') && this.rnd() < (surf === 'metal' ? 0.3 : 0.1)) this._play('ricochet', { ...o, gain: o.gain * 0.45, delay: o.delay + 0.012, jitter: 0.25 });
  }
  casing(pos, vel) { if (this.ctx) this._play('casing', { pos, ref: 0.8, gain: 0.45 * clamp(vel, 0.15, 1.4), jitter: 0.2, rev: 0.1 }); }
  // Loose objects and dropped rifles hitting things; louder with speed, deeper with mass.
  clatter(mat, pos, speed, mass = 2) {
    if (!this.ctx) return;
    const o = { bus: this.bus.impact, ref: 2, gain: clamp(speed / 5, 0.12, 1.2) * clamp(0.5 + mass / 8, 0.5, 1.4), rate: 1.14 - clamp(mass / 28, 0, 0.3), jitter: 0.16, er: 0.2, rev: 0.2 };
    if (this._carry(pos, o) < 45) this._play(PROP[mat] || 'prop_wood', o);
  }
  bodyfall(pos, speed, part = 'torso') {
    if (!this.ctx) return;
    const heavy = part === 'torso' || part === 'pelvis', mid = part === 'head' || part === 'thl' || part === 'thr';
    const o = { bus: this.bus.impact, ref: 2, gain: clamp(speed / 4, 0.15, 1.1) * (heavy ? 1 : mid ? 0.55 : 0.3), jitter: 0.14, er: 0.15, rev: 0.18 };
    if (this._carry(pos, o) > 40) return;
    this._play(heavy || mid ? 'bodyfall' : 'imp_fabric', o);
    if (heavy) this._play('rattle', { ...o, gain: o.gain * 0.5, delay: o.delay + 0.03 });
  }

  // ---- thrown ordnance -------------------------------------------------------------------------------------------------------------
  // In the hand: pin, lever, the arm going through. At the ear, so no path to trace.
  nade(name, gain = 0.6, delay = 0) { if (this.ctx) this._play(name, { bus: this.bus.weapon, gain, delay, jitter: 0.05, rev: 0.08, er: 0.05 }); }
  // Small steel parts (pin, lever) landing near the feet.
  tink(pos, vel = 1) { if (this.ctx) this._play('tink', { pos, ref: 0.9, gain: 0.5 * clamp(vel, 0.2, 1.3), jitter: 0.2, rev: 0.1 }); }
  // A grenade or canister striking something: its own ring, plus what it landed on.
  nadeBounce(kind, surf, pos, speed) {
    if (!this.ctx) return;
    const soft = surf === 'dirt' || surf === 'fabric', v = clamp(speed / 6, 0.14, 1.25);
    const o = { bus: this.bus.impact, ref: 2.4, gain: v * (soft ? 0.55 : 1.15), rate: 1 + (1 - v) * 0.06, jitter: 0.1, er: 0.2, rev: 0.2 };
    if (this._carry(pos, o) > 55) return;
    this._play(kind === 'frag' ? 'prop_frag' : 'prop_canister', o);
    if (soft) this._play('nade_soft', { ...o, gain: v * 1.1 });
    else if (surf === 'wood') this._play('prop_wood', { ...o, gain: v * 0.7 });
    else if (surf === 'metal') this._play('prop_bin', { ...o, gain: v * 0.55 });
    else if (surf === 'tile' && this.rnd() < 0.6) this._play('imp_glass', { ...o, gain: v * 0.12 });
  }
  // High explosive. Close by it is a blow to the ears: everything else drops away, then a ringing. Further off the crack
  // is gone and the street carries the slam; blocks away only the thud arrives, late.
  explosion(pos) {
    if (!this.ctx) return 0;
    const o = { bus: this.bus.world, ref: 9, er: 0.7, rev: 0.35, jitter: 0.06 }, d = this._carry(pos, o), t = this.now + o.delay;
    const near = clamp(1 - (d - 6) / 22, 0, 1), far = clamp((d - 45) / 70, 0, 1), mid = 1 - Math.max(near * 0.75, far);
    const occ = (1 - o.gain) / 0.6;                                            // 0 in the open .. 1 behind walls
    if (near > 0) this._play('boom', { ...o, gain: o.gain * 3.4 * near, ref: 7 });
    if (mid > 0.05) this._play('boomMid', { ...o, gain: o.gain * 3.6 * mid, ref: 11 });
    if (far > 0) this._play('boomFar', { ...o, gain: o.gain * 4.2 * far, ref: 16 });
    if (d < 30) this._play('debris', { ...o, gain: o.gain * 1.3, ref: 5, delay: o.delay + 0.35, er: 0.1 });
    const hit = clamp(1.25 - d / 13, 0, 1) * (1 - occ * 0.8);                  // how hard the ears take it
    if (hit > 0.02) {
      const dk = this.duck.gain; dk.cancelScheduledValues(t); dk.setTargetAtTime(1 - 0.85 * hit, t, 0.004); dk.setTargetAtTime(1, t + 0.25 + hit * 0.9, 0.5 + hit * 1.2);
      this.concuss = Math.max(this.concuss, hit);
      if (hit > 0.3) {                                                         // tinnitus, straight to the output: the ears make it, the muffling does not touch it
        const ctx = this.ctx, osc = ctx.createOscillator(), osc2 = ctx.createOscillator(), g = ctx.createGain(), dur = 1.6 + hit * 3.4;
        osc.frequency.value = 4150 + this.rnd() * 300; osc2.frequency.value = osc.frequency.value * 1.493;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * hit, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const g2 = ctx.createGain(); g2.gain.value = 0.35; osc.connect(g); osc2.connect(g2); g2.connect(g); g.connect(this.master);
        osc.start(t); osc2.start(t); osc.stop(t + dur + 0.05); osc2.stop(t + dur + 0.05);
      }
    }
    return hit;
  }
  smokePop(pos) { if (!this.ctx) return; const o = { bus: this.bus.world, ref: 4, gain: 1.5, er: 0.4, rev: 0.25, jitter: 0.08 }; this._carry(pos, o); this._play('smokepop', o); }
  // The burning canister: a looped hiss that stays where the canister lies. Returns a handle: set(pos, level) / stop().
  smokeHiss(pos) {
    if (!this.ctx) return { set() {}, stop() {} };
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.S.hiss[0]; src.loop = true; src.playbackRate.value = 0.96 + this.rnd() * 0.1;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    const pn = ctx.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 2.2; pn.rolloffFactor = 1.3; pn.maxDistance = 200;
    pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z;
    src.connect(lp); lp.connect(g); g.connect(pn); pn.connect(this.bus.world);
    const s = ctx.createGain(); s.gain.value = 0.18; pn.connect(s); s.connect(this.revSend);
    src.start(this.now, this.rnd() * 2); this.voices++;
    const h = { src, t: 0,
      set: (p, level) => {                                                     // called a few times a second: follow the canister, and the walls between
        const t = this.now, o = {}; this._carry(p, o);
        pn.positionX.setTargetAtTime(p.x, t, 0.05); pn.positionY.setTargetAtTime(p.y, t, 0.05); pn.positionZ.setTargetAtTime(p.z, t, 0.05);
        g.gain.setTargetAtTime(1.1 * level * o.gain, t, 0.12); lp.frequency.setTargetAtTime(Math.max(500, o.lp), t, 0.15);
      },
      stop: () => { if (h.done) return; h.done = true; const t = this.now; g.gain.setTargetAtTime(0, t, 0.25); src.stop(t + 1.5); this.voices--; this.hisses.splice(this.hisses.indexOf(h), 1); } };
    this.hisses.push(h);
    return h;
  }
  stopHisses() { for (const h of [...this.hisses]) h.stop(); }

  // ---- foley ------------------------------------------------------------------------------------------------------------------
  step(surf, vol = 1, pos = null) {
    if (!this.ctx) return; const name = STEP[surf] || 'step_concrete';
    if (pos) {
      const o = { bus: this.bus.world, ref: 1.6, gain: vol * 1.5, rev: 0.12, er: 0.05 };
      if (this._carry(pos, o) > 38) return;
      this._play(name, o); if (this.rnd() < 0.35) this._play('rattle', { ...o, gain: o.gain * 0.4, delay: o.delay + 0.04 });
    } else {
      this.foot = !this.foot;
      this._play(name, { gain: vol * 0.85, pan: this.foot ? 0.1 : -0.1, rev: 0.1 + this.env.room * 0.12, er: 0.07 });
      if (vol > 0.5 && this.rnd() < 0.55) this._play('rattle', { gain: vol * 0.3, delay: 0.03 + this.rnd() * 0.05, pan: (this.rnd() - 0.5) * 0.3 });
      if (vol > 0.9) this._play('cloth', { gain: 0.14, delay: 0.02 });
    }
  }
  jump() { if (!this.ctx) return; this._play('cloth', { gain: 0.3 }); this._play('rattle', { gain: 0.3, delay: 0.02 }); }
  land(v, surf) { if (!this.ctx) return; this.step(surf, 1.5 * v); this._play('bodyfall', { gain: 0.3 * v, rate: 1.5 }); this._play('rattle', { gain: 0.5 * v, delay: 0.03 }); }
  cloth(v = 1) { if (this.ctx) this._play('cloth', { gain: 0.26 * v }); }
  weapon(name) {
    if (!this.ctx) return;
    if (name === 'cloth') return this.cloth(1.2);
    this._play(name, { bus: this.bus.weapon, gain: { dry: 0.5, select: 0.4, magout: 0.55, magin: 0.6, magtap: 0.5, bolt: 0.7 }[name] ?? 0.5, jitter: 0.03, rev: 0.08, er: 0.05 });
  }
  // Another soldier's rifle handling, heard from where they are.
  foleyAt(name, pos, gain = 0.7) { if (!this.ctx) return; const o = { bus: this.bus.world, ref: 1.6, gain, rev: 0.1 }; if (this._carry(pos, o) < 25) this._play(name, o); }

  // ---- ui / state ---------------------------------------------------------------------------------------------------------------
  ui(name) {
    if (!this.ctx) return; const t = this.now, tone = (f0, f1, d, g, at = 0, ty = 'sine') => this._tone(f0, f1, d, g, t + at, ty);
    if (name === 'hit') { tone(1800, 1500, 0.035, 0.22); tone(5200, 4200, 0.012, 0.1); }
    else if (name === 'head') { tone(2500, 2100, 0.06, 0.26); tone(3700, 3300, 0.05, 0.14, 0.012); }
    else if (name === 'kill') { tone(880, 880, 0.09, 0.2, 0, 'triangle'); tone(1320, 1320, 0.16, 0.2, 0.07, 'triangle'); }
    else if (name === 'hover') tone(1250, 1250, 0.02, 0.05);
    else if (name === 'click') tone(760, 520, 0.04, 0.14, 0, 'triangle');
    else if (name === 'score') tone(660, 660, 0.08, 0.1, 0, 'triangle');
    else if (name === 'start') { tone(440, 440, 0.12, 0.16, 0, 'triangle'); tone(660, 660, 0.12, 0.16, 0.13, 'triangle'); tone(880, 880, 0.3, 0.16, 0.26, 'triangle'); }
    else if (name === 'end') { tone(660, 660, 0.2, 0.16, 0, 'triangle'); tone(495, 495, 0.2, 0.16, 0.2, 'triangle'); tone(330, 330, 0.5, 0.18, 0.4, 'triangle'); }
  }
  hurt(amount) {
    if (!this.ctx) return;
    this.muffle = Math.min(1, this.muffle + 0.25 + amount / 110);
    this._play('imp_flesh', { bus: this.bus.ui, gain: 0.9, jitter: 0.1 });
    if (amount > 28) this._tone(3650, 3600, 1.3, 0.012 + amount * 0.0002, this.now);          // a faint ringing after a hard hit
  }

  // ---- listener, surroundings ----------------------------------------------------------------------------------------------------
  setListener(cam, dt, health, interior) {
    if (!this.ctx) return;
    this.measure();
    const l = this.listener, p = cam.position, e = cam.matrixWorld.elements, t = this.now, fx = -e[8], fz = -e[10];
    if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = fx; l.forwardY.value = -e[9]; l.forwardZ.value = fz; l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6]; }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fx, -e[9], fz, e[4], e[5], e[6]); }
    this.lpos.x = p.x; this.lpos.y = p.y; this.lpos.z = p.z;
    this.muffle = Math.max(0, this.muffle - dt * 0.7); this.concuss = Math.max(0, this.concuss - dt * (0.16 + this.concuss * 0.22));      // a blast leaves the ears dull for seconds, clearing slowly
    const low = health < 35 ? (35 - health) / 35 : 0;
    this.lp.frequency.setTargetAtTime(20000 * Math.pow(0.06, clamp(this.muffle + low * 0.55 + this.concuss * 0.95, 0, 1)), t, 0.05);
    this.envT -= dt; if (this.envT <= 0) { this.envT = 0.2; this._surroundings(p, interior, t); }
    for (const tap of this.taps) tap.pan.pan.setTargetAtTime(clamp((tap.dx * -fz + tap.dz * fx) * 0.85, -1, 1), t, 0.05);       // echoes stay put as the head turns
    const E = this.env, R = this.rev;
    R.room.out.gain.setTargetAtTime(0.85 * E.room, t, 0.15);
    R.narrow.out.gain.setTargetAtTime(0.6 * E.narrow * (1 - E.room), t, 0.15);
    R.street.out.gain.setTargetAtTime(0.5 * (1 - E.room) * (1 - E.narrow * 0.6) * (1 - E.open * 0.45), t, 0.15);
    this.windG?.gain.setTargetAtTime(0.2 * (1 - E.room * 0.65) * (0.7 + 0.3 * E.open), t, 0.3);
    this.cicG?.gain.setTargetAtTime(0.085 * (1 - E.room * 0.8), t, 0.3);
    this.emitT -= dt; if (this.emitT <= 0) { this.emitT = 1; this._hums(t); }
    // critical health: heartbeat
    this.hb = (this.hb || 0) - dt;
    if (low > 0 && this.hb <= 0) { this.hb = 0.95 - low * 0.3; this._play('heart', { bus: this.bus.ui, gain: 0.55 * low + 0.2, jitter: 0.02 }); }
  }
  // Rays around the listener measure the space: how enclosed, how narrow, how open, and where the nearest walls are.
  _surroundings(p, interior, t) {
    const E = this.env; if (!this.cast) { E.room += ((interior ? 1 : 0) - E.room) * 0.4; return; }
    const N = 12, d = this.rays || (this.rays = new Float32Array(N)); let near = 0, open = 0;
    for (let i = 0; i < N; i++) { const a = i / N * 6.2832; d[i] = this.cast(p.x, p.y, p.z, Math.sin(a), 0, Math.cos(a), 70); if (d[i] < 7) near++; if (d[i] >= 45) open++; }
    const up = this.cast(p.x, p.y, p.z, 0, 1, 0, 30); let width = 1e9; for (let i = 0; i < 6; i++) width = Math.min(width, d[i] + d[i + 6]);
    E.room += ((interior || (up < 4.5 && near >= 7) ? 1 : 0) - E.room) * 0.4;
    E.narrow += (clamp((14 - width) / 8, 0, 1) - E.narrow) * 0.4; E.open += (open / N - E.open) * 0.4;
    for (let k = 0; k < 6; k++) {
      const tap = this.taps[k], i = d[k * 2] <= d[k * 2 + 1] ? k * 2 : k * 2 + 1, a = i / N * 6.2832; let dist = d[i];
      tap.dx = Math.sin(a); tap.dz = Math.cos(a);
      if (k === 5 && up < dist) { dist = up; tap.dx = 0; tap.dz = 0; }                               // a ceiling or awning overhead answers before the far wall
      tap.d = dist;
      tap.delay.delayTime.setTargetAtTime(clamp(2 * dist / C, 0.004, 0.75), t, 0.12);
      tap.gain.gain.setTargetAtTime(dist < 68 ? 0.9 * 2.4 / (2.4 + 2 * dist) : 0, t, 0.1);          // spreading over the round trip; the wall keeps a little
      tap.lp.frequency.setTargetAtTime(7500 * Math.exp(-dist / 45) + 900, t, 0.1);
    }
  }
  // Things that sound where they stand (air-conditioning units humming, the plaza fountain): the nearest few are switched on as the listener approaches.
  _hums(t) {
    const l = this.lpos, want = this.emitters.map(e => ({ e, d: Math.hypot(e.x - l.x, e.y - l.y, e.z - l.z) })).filter(o => o.d < 28).sort((a, b) => a.d - b.d).slice(0, 3).map(o => o.e);
    for (const a of [...this.active]) if (!want.includes(a.e)) { a.g.gain.setTargetAtTime(0, t, 0.3); a.src.stop(t + 2); this.active.splice(this.active.indexOf(a), 1); }
    for (const e of want) {
      if (this.active.some(a => a.e === e)) continue;
      const ctx = this.ctx, src = ctx.createBufferSource(), wet = e.kind === 'water'; src.buffer = (wet ? this.S.fountain : this.S.hum)[0]; src.loop = true; src.playbackRate.value = 0.94 + (Math.abs(e.x * 7 + e.z * 3) % 1) * 0.12;
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(wet ? 0.7 : 0.5, t, 0.5);
      const pn = ctx.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = wet ? 2.4 : 1.4; pn.rolloffFactor = 1.5; pn.positionX.value = e.x; pn.positionY.value = e.y; pn.positionZ.value = e.z;
      src.connect(g); g.connect(pn); pn.connect(this.bus.amb); src.start(t, this.rnd() * 1.5);
      this.active.push({ e, src, g });
    }
  }

  _ambience() {
    const ctx = this.ctx, loop = (buf, type, freq, q, gain) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(this.bus.amb); s.start(); return { f, g };
    };
    const wind = loop(this.white, 'bandpass', 420, 0.5, 0.2); this.windG = wind.g;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 190; lfo.connect(lg); lg.connect(wind.f.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13; const lg2 = ctx.createGain(); lg2.gain.value = 0.09; lfo2.connect(lg2); lg2.connect(wind.g.gain); lfo2.start();
    loop(this.brown, 'lowpass', 110, 0.7, 0.5);                                  // distant city rumble
    const cs = ctx.createBufferSource(); cs.buffer = this.S.cicada[0]; cs.loop = true; this.cicG = ctx.createGain(); this.cicG.gain.value = 0.085; cs.connect(this.cicG); this.cicG.connect(this.bus.amb); cs.start();
    this._ambTimer = setInterval(() => {                                         // birds on the roofs, awnings snapping in the wind, fighting elsewhere in the city
      if (ctx.state !== 'running') return; const R = this.rnd, r = R(), l = this.lpos;
      if (r < 0.34) this._play('bird', { pos: { x: l.x + (R() - 0.5) * 60, y: 7 + R() * 6, z: l.z + (R() - 0.5) * 60 }, bus: this.bus.amb, ref: 6, gain: 0.8, jitter: 0.2, rev: 0.25 });
      else if (r < 0.56) { const o = { bus: this.bus.amb, ref: 4, gain: 0.8, jitter: 0.25 }; this._carry({ x: (R() < 0.5 ? 28.5 : -29) + (R() - 0.5) * 3, y: 3.6, z: clamp(l.z + (R() - 0.5) * 50, -60, 60) }, o); this._play('flap', o); }
      else if (r < 0.7) { const a = R() * 6.2832, far = 240 + R() * 260, pos = { x: l.x + Math.sin(a) * far, y: 6, z: l.z + Math.cos(a) * far }, n = 1 + (R() * 5 | 0); for (let i = 0; i < n; i++) this._play('shotFar', { pos, bus: this.bus.amb, ref: 14, gain: 5, lp: 1500, delay: i * (0.09 + R() * 0.05), rev: 0.6, jitter: 0.12 }); }
    }, 2300);
  }
}
