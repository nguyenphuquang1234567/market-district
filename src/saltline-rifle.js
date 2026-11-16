// The rifle from Saltline (an earlier procedural FPS made for this user, saltline_1.html), brought over at the user's
// request: the same recipe, step for step, and the same seeds, so the takes come out as Saltline makes them (run side
// by side with Saltline's own code at the same rate, all 800 640 samples of the eight takes came out identical). Pure JS, no WebAudio.
//
// The shot, from behind the sights: a sharp pressure crack and the high hiss of the muzzle blast, a thump gliding down
// from 160 to 45 Hz, the broadband body of the report, a resonant 760 Hz bark; then the action: the bolt carrier slamming
// back (35 ms) and home (62 ms), each a few metal modes over a short click, with the buffer spring ringing after.
// The outdoor tail: five echoes coming back off nearby fronts, each duller than the last, a long diffuse roll and a low
// rumble, as separate left and right takes. The indoor tail: a room's bloom with its low modes, and a flutter of
// reflections between close walls.
import { rng } from './util.js';

const TAU = Math.PI * 2;
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };   // FNV-1a
const buf = (sr, secs) => new Float32Array(Math.max(1, Math.round(sr * secs)));
const range = (R, a, b) => a + (b - a) * R();
const noise = (sr, secs, R) => { const x = buf(sr, secs); for (let i = 0; i < x.length; i++) x[i] = R() * 2 - 1; return x; };
function coefs(type, f, q, sr) {                                              // RBJ biquad, normalised: [b0, b1, b2, a1, a2]
  const w = TAU * Math.max(10, Math.min(f, sr * 0.47)) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filter(x, type, f, q, sr) {                                          // transposed direct form II, in place
  const [b0, b1, b2, a1, a2] = coefs(type, f, q, sr); let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + z1; z1 = b1 * v - a1 * y + z2; z2 = b2 * v - a2 * y; x[i] = y; }
  return x;
}
function sweepFilter(x, type, fAt, q, sr) {                                   // the same with the cutoff moving (retuned every 32 samples)
  const n = x.length; let z1 = 0, z2 = 0, k = null;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) k = coefs(type, fAt(i / n), typeof q === 'function' ? q(i / n) : q, sr);
    const v = x[i], y = k[0] * v + z1; z1 = k[1] * v - k[3] * y + z2; z2 = k[2] * v - k[4] * y; x[i] = y;
  }
  return x;
}
const glide = (a, b, p = 1) => u => a * Math.pow(b / a, Math.pow(u, p));
const shape = (x, sr, env) => { for (let i = 0; i < x.length; i++) x[i] *= env(i / sr); return x; };
const decay = (d, att = 0) => (att > 0 ? t => (1 - Math.exp(-t / att)) * Math.exp(-t / d) : t => Math.exp(-t / d));
function mix(dst, src, at, g, sr) {
  const o = Math.round(at * sr), n = Math.min(src.length, dst.length - o);
  for (let i = Math.max(0, -o); i < n; i++) dst[o + i] += src[i] * g;
  return dst;
}
const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const scale = (x, k) => { for (let i = 0; i < x.length; i++) x[i] *= k; return x; };
const soft = (x, drive) => { const k = 1 / Math.tanh(drive); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) * k; return x; };
function fades(x, sr, fin, fout) {
  const a = Math.min(x.length >> 1, Math.round(fin * sr)), b = Math.min(x.length >> 1, Math.round(fout * sr));
  for (let i = 0; i < a; i++) x[i] *= i / a;
  for (let i = 0; i < b; i++) { const u = i / b; x[x.length - 1 - i] *= u * u; }
  return x;
}
function burst(sr, R, secs, d, o = {}) {                                      // filtered noise with an envelope, at unit peak
  const x = noise(sr, secs, R);
  if (o.hp) filter(x, 'hp', o.hp, 0.707, sr);
  if (o.lp) filter(x, 'lp', o.lp, 0.707, sr);
  if (o.bp) filter(x, 'bp', o.bp, o.q || 1, sr);
  shape(x, sr, decay(d, o.att || 0));
  const m = peak(x); return m > 0 ? scale(x, 1 / m) : x;
}
function thump(sr, secs, f0, f1, tau, d, att = 6e-4) {                        // a tone gliding from f0 down to f1
  const x = buf(sr, secs); let ph = 0;
  for (let i = 0; i < x.length; i++) { const t = i / sr; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / tau)) / sr; x[i] = Math.sin(ph) * Math.exp(-t / d) * (1 - Math.exp(-t / att)); }
  return x;
}
function modes(sr, secs, list, R) {                                           // struck metal: [frequency, decay s, amplitude]
  const x = buf(sr, secs);
  for (const [f, d, a] of list) {
    if (f > sr * 0.46) continue;
    const w = TAU * f / sr, ph = R ? R() * TAU : 0, k = Math.exp(-1 / (d * sr)); let g = a;
    for (let i = 0; i < x.length; i++) { x[i] += Math.sin(w * i + ph) * g; g *= k; if (g < 1e-5) break; }
  }
  const n = Math.min(x.length, Math.round(4e-4 * sr)); for (let i = 0; i < n; i++) x[i] *= i / n;
  return x;
}

// One round. `action` false leaves out the bolt and spring (another man's rifle, heard from where he is).
function shot(sr, R, v, action = true) {
  const p = [1, 0.955, 1.045, 0.985][v & 3], b = [1, 1.12, 0.9, 1.05][v & 3], x = buf(sr, 0.32);
  mix(x, burst(sr, R, 0.012, 0.0011, { hp: 2600 * b }), 0, 2.6, sr);                                   // the crack
  mix(x, burst(sr, R, 0.02, 0.003, { hp: 1200, lp: 8000 }), 2e-4, 1.2, sr);
  mix(x, thump(sr, 0.11, 160 * p, 45 * p, 0.024, 0.03, 0.003), 0, 0.62, sr);                            // the thump
  mix(x, burst(sr, R, 0.22, 0.03, { hp: 300 * p, lp: 2500 * p * b, att: 0.0012 }), 0, 1.5, sr);        // the body of the report
  mix(x, burst(sr, R, 0.09, 0.016, { bp: 760 * p, q: 2.2, att: 0.001 }), 0, 0.9, sr);                  // its bark
  mix(x, burst(sr, R, 0.16, 0.04, { hp: 4800 }), 0.001, 0.34, sr);                                     // muzzle hiss
  if (action) {
    const r = 0.035 + (v - 1.5) * 0.0015;
    mix(x, modes(sr, 0.05, [[2150 * p, 0.007, 1], [3420 * p, 0.006, 0.7], [5230, 0.004, 0.5], [880 * p, 0.012, 0.5]], R), r, 0.26, sr);   // carrier back
    mix(x, burst(sr, R, 0.012, 0.002, { bp: 3100, q: 1.2 }), r, 0.3, sr);
    mix(x, modes(sr, 0.05, [[1780 * p, 0.008, 1], [2890 * p, 0.006, 0.6], [640 * p, 0.02, 0.5]], R), r + 0.027, 0.17, sr);                 // and home
    mix(x, burst(sr, R, 0.01, 0.002, { bp: 2400, q: 1.2 }), r + 0.027, 0.16, sr);
    mix(x, modes(sr, 0.2, [[712 * p, 0.05, 1], [1466 * p, 0.03, 0.4]], R), r + 0.03, 0.035, sr);                                         // buffer spring
  }
  return soft(scale(x, 0.46), 1.5);
}
// The report rolling away outdoors: a left and a right take.
function tailOut(sr, R, v) {
  const side = seed => {
    const r = rng(seed), x = buf(sr, 1.55), echoes = v
      ? [[0.058, 0.5, 4200], [0.097, 0.4, 3300], [0.139, 0.28, 2500], [0.176, 0.2, 1900], [0.262, 0.1, 1300]]
      : [[0.066, 0.52, 4600], [0.088, 0.34, 3600], [0.124, 0.3, 2700], [0.169, 0.22, 2000], [0.231, 0.12, 1400]];
    for (const [at, g, lp] of echoes) { const e = burst(sr, r, 0.09, 0.016, { hp: 420, lp }); const t = at + range(r, -0.004, 0.004); mix(x, e, t, g * range(r, 0.8, 1.1), sr); }
    const roll = noise(sr, 1.5, r); sweepFilter(roll, 'lp', glide(3400, 380, 0.6), 0.6, sr); filter(roll, 'hp', 130, 0.7, sr); mix(x, shape(roll, sr, decay(0.3, 0.05)), 0.03, 0.55, sr);
    const low = noise(sr, 1.2, r); filter(low, 'lp', 150, 0.7, sr); mix(x, shape(low, sr, decay(0.26, 0.03)), 0.02, 0.9, sr);
    return x;
  };
  const s = Math.floor(R() * 1e9);
  return [side(s), side(s + 77)];
}
// Indoors: the room blooming with its low modes, and the flutter between near walls.
function tailIn(sr, R, v) {
  const side = seed => {
    const r = rng(seed), x = buf(sr, 2.3), bloom = noise(sr, 2.25, r);
    sweepFilter(bloom, 'lp', glide(2400, 260, 0.5), 0.7, sr); mix(x, shape(bloom, sr, decay(0.42, 0.012)), 0.008, 0.6, sr);
    for (const [f, g] of [[54, 1], [81, 0.8], [117, 0.6], [163, 0.45], [228, 0.3]]) { const m = noise(sr, 2.2, r); filter(m, 'bp', f * (v ? 1.06 : 1), 9, sr); mix(x, shape(m, sr, decay(0.5, 0.02)), 0.01, g * 2.4, sr); }
    const gap = v ? 0.051 : 0.044;
    for (let k = 1; k < 9; k++) { const e = burst(sr, r, 0.05, 0.009, { hp: 500, lp: 3800 / (1 + k * 0.35) }); mix(x, e, gap * k + range(r, -0.003, 0.003), 0.42 * Math.pow(0.74, k), sr); }
    return x;
  };
  const s = Math.floor(R() * 1e9);
  return [side(s), side(s + 131)];
}
// Saltline's finishing step for every take: a 0.3 ms fade in, a 12 ms fade out, and the loudest channel to `top`.
function finish(chs, sr, top) {
  for (const c of chs) fades(c, sr, 3e-4, 0.012);
  let m = 0; for (const c of chs) m = Math.max(m, peak(c));
  if (m > 0) for (const c of chs) scale(c, top / m);
  return chs;
}

// The takes Saltline plays: four rounds, two outdoor tails, two indoor tails (stereo pairs), plus four rounds without
// the action for other soldiers. `sr` is the rate the takes are made at.
export function saltlineRifle(sr = 48000) {
  const take = (name, v) => rng(hash(name) + v * 7919);
  return {
    shot: [0, 1, 2, 3].map(v => finish([shot(sr, take('rifle_shot', v), v)], sr, 0.97)[0]),
    tailOut: [0, 1].map(v => finish(tailOut(sr, take('rifle_tail_out', v), v), sr, 0.5)),
    tailIn: [0, 1].map(v => finish(tailIn(sr, take('rifle_tail_in', v), v), sr, 0.62)),
    shotOther: [0, 1, 2, 3].map(v => finish([shot(sr, take('rifle_shot_other', v), v, false)], sr, 0.97)[0]),
  };
}
