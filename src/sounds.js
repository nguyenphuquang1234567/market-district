// Sound library, modelled rather than recorded: every sample is computed once at boot from physical ingredients
// (pressure pulses, filtered turbulence, modal ringing, grain scatter) with several variations each. Pure JS, no WebAudio,
// so the same code can be run and measured outside the browser.
import { rng } from './util.js';

export function bakeSounds(SR = 48000, seed = 9001) {
  const R = rng(seed), rr = (a, b) => a + (b - a) * R(), TAU = Math.PI * 2, N = s => Math.ceil(s * SR);
  const white = n => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = R() * 2 - 1; return x; };
  const biq = (x, type, f, q = 0.707) => {                 // RBJ biquad, in place
    const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
    return x;
  };
  const env = (x, decay, attack = 0) => { const a = Math.max(1, attack * SR); for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / (decay * SR)) * Math.min(1, i / a); return x; };
  const burst = (secs, type, f, q, decay, attack = 0) => env(biq(white(N(secs)), type, f, q), decay, attack);    // shaped noise
  const add = (dst, src, g = 1, at = 0) => { const o = Math.round(at * SR); for (let i = 0; i < src.length && i + o < dst.length; i++) dst[i + o] += src[i] * g; return dst; };
  // modal bank: [frequency, decay seconds, amplitude] — what makes a struck object sound like its material
  const modes = (dst, list, g = 1, at = 0) => {
    const o = Math.round(at * SR);
    for (const [f, d, a] of list) { if (f > SR * 0.45) continue; const w = TAU * f / SR, ph = R() * TAU, n = Math.min(dst.length - o, N(d * 7)); for (let i = 0; i < n; i++) dst[i + o] += Math.sin(w * i + ph) * Math.exp(-i / (d * SR)) * a * g * Math.min(1, i / 10); }
    return dst;
  };
  const sweep = (dst, f0, f1, decay, g = 1, at = 0, tau = 0.03) => {      // tone gliding from f0 to f1
    const o = Math.round(at * SR), n = Math.min(dst.length - o, N(decay * 7)); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / tau)) / SR; dst[i + o] += Math.sin(ph) * Math.exp(-t / decay) * g * Math.min(1, i / 30); }
    return dst;
  };
  const ticks = (dst, count, t0, t1, fLo, fHi, g, fall = 1) => {            // scatter of tiny grains: debris, grit, splinters
    for (let k = 0; k < count; k++) { const u = R(), at = t0 + (t1 - t0) * u * u, x = env(biq(white(N(rr(0.004, 0.012))), 'bp', rr(fLo, fHi), 2.5), rr(0.0006, 0.0026)); add(dst, x, g * rr(0.3, 1) * Math.pow(1 - u * 0.9, fall), at); }
    return dst;
  };
  const sat = (x, drive) => { for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive); return x; };
  const chans = x => (Array.isArray(x) ? x : [x]);
  const norm = (x, peak = 0.9) => { let m = 1e-9; for (const ch of chans(x)) for (let i = 0; i < ch.length; i++) m = Math.max(m, Math.abs(ch[i])); for (const ch of chans(x)) for (let i = 0; i < ch.length; i++) ch[i] *= peak / m; return x; };
  const fade = (x, secs = 0.01) => { const n = Math.min(x.length, N(secs)); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; };
  const pulse = (dst, T, g) => { const n = T * SR; for (let i = 0; i < n * 7; i++) { const t = i / n; dst[i] += (1 - t) * Math.exp(-t) * g; } return dst; };     // Friedlander blast wave
  const many = (n, f) => Array.from({ length: n }, f);
  const loopable = (x, xf) => { const n = x.length - xf, y = x.slice(0, n); for (let i = 0; i < xf; i++) { const k = i / xf; y[i] = y[i] * k + x[n + i] * (1 - k); } return y; };
  const S = {};

  // ---- rifle, from behind the sights: blast pulse, crack, bark, chest thump, action cycling, ground bounce ---------------------
  S.shot = many(6, () => {
    const v = rr(0.94, 1.06), n = N(0.85), core = new Float32Array(n);
    pulse(core, 0.00042, 0.9);
    sweep(core, 175 * v, 72, 0.042, 0.3, 0, 0.02);
    add(core, burst(0.06, 'hp', 1500, 0.7, 0.007), 1.0);
    for (const [at, g] of [[0.031, 0.2], [0.066, 0.26]]) {           // bolt carrier to the rear, then home into battery
      add(core, burst(0.02, 'hp', 2600, 0.7, 0.0028), g, at);
      modes(core, [[2150 * v, 0.012, 1], [3420 * v, 0.016, 0.7], [5300 * v, 0.009, 0.5]], g * 0.32, at);
    }
    sweep(core, 430 * v, 390, 0.05, 0.035, 0.07, 0.2);              // buffer spring
    const side = () => { const x = new Float32Array(n); add(x, burst(0.22, 'bp', 640 * v, 0.6, 0.036), 0.9); add(x, burst(0.2, 'bp', 1500 * v, 0.6, 0.026), 1.0); add(x, burst(0.15, 'bp', 3300 * v, 0.7, 0.014), 0.9); add(x, burst(0.8, 'bp', 1800, 0.5, 0.13), 0.22); return x; };
    const L = side(), Rt = side();
    for (const ch of [L, Rt]) { add(ch, core); const g = biq(ch.slice(), 'lp', 3500, 0.6); add(ch, g, -0.3, 0.0031); sat(ch, 1.25); biq(ch, 'lp', 13000, 0.6); fade(ch, 0.05); }
    return norm([L, Rt], 0.95);
  });
  // the same rifle 15-60 m away: no mechanism, softer edge, the street already rolling it off
  S.shotMid = many(5, () => {
    const v = rr(0.92, 1.08), x = new Float32Array(N(1.1));
    pulse(x, 0.0006, 0.8); sweep(x, 150 * v, 62, 0.06, 0.32, 0, 0.03);
    add(x, burst(0.06, 'hp', 1000, 0.7, 0.008), 0.7); add(x, burst(0.3, 'bp', 540 * v, 0.6, 0.05), 1.1); add(x, burst(0.3, 'bp', 1150 * v, 0.6, 0.03), 0.9); add(x, burst(0.2, 'bp', 2300 * v, 0.7, 0.018), 0.5);
    add(x, env(biq(white(N(1.0)), 'lp', 1400, 0.6), 0.22, 0.01), 0.22);
    sat(x, 1.2); biq(x, 'lp', 6000, 0.6); fade(x, 0.06); return norm(x, 0.95);
  });
  // and far off: a pop followed by its echoes coming back off distant blocks
  S.shotFar = many(4, () => {
    const v = rr(0.9, 1.1), x = new Float32Array(N(1.9));
    sweep(x, 125 * v, 58, 0.09, 0.4, 0, 0.04); add(x, burst(0.4, 'bp', 400 * v, 0.6, 0.07), 1.2); add(x, burst(0.2, 'bp', 900 * v, 0.6, 0.04), 0.7);
    const e = biq(x.slice(0, N(0.5)), 'lp', 900, 0.6); let g = 0.5;
    for (let k = 0, at = rr(0.09, 0.16); k < 5; k++) { add(x, e, g * rr(0.6, 1), at); at += rr(0.08, 0.26); g *= 0.62; }
    add(x, env(biq(white(N(1.8)), 'lp', 700, 0.6), 0.45, 0.03), 0.16);
    biq(x, 'lp', 3200, 0.6); fade(x, 0.1); return norm(x, 0.95);
  });
  // outdoor tail for the player's own shots: the report rolling away down the streets
  S.tail = many(3, () => {
    const x = new Float32Array(N(1.7)), e = env(biq(white(N(0.25)), 'bp', rr(420, 620), 0.5), 0.05); let g = 1;
    for (let k = 0, at = rr(0.07, 0.11); k < 7; k++) { add(x, e, g * rr(0.5, 1), at); at += rr(0.06, 0.2); g *= 0.66; }
    add(x, env(biq(white(N(1.6)), 'lp', 900, 0.6), 0.4, 0.05), 0.35);
    biq(x, 'lp', 2800, 0.6); fade(x, 0.15); return norm(x, 0.9);
  });
  // a supersonic round going past: the N-wave snap, then the air closing behind it
  S.crack = many(4, () => {
    const x = new Float32Array(N(0.4)), T = Math.round(rr(0.00022, 0.00032) * SR);
    for (let i = 0; i < T; i++) x[i] += (1 - 2 * i / T) * 1.4;
    add(x, burst(0.02, 'hp', 3000, 0.7, 0.0016), 0.8);
    add(x, burst(0.2, 'bp', rr(3600, 4600), 3, 0.045, 0.002), 0.22, 0.004); add(x, burst(0.3, 'bp', rr(1700, 2300), 2.5, 0.09, 0.01), 0.13, 0.015);
    sweep(x, rr(5200, 6400), 1500, 0.06, 0.05, 0.003, 0.045);
    fade(x, 0.05); return norm(x, 0.95);
  });

  // ---- bullet strikes ---------------------------------------------------------------------------------------------------------
  S.imp_concrete = many(4, () => { const x = new Float32Array(N(0.5)); add(x, burst(0.05, 'bp', 2300, 0.8, 0.009), 1.2); add(x, burst(0.2, 'lp', 450, 0.7, 0.04), 1.1); add(x, burst(0.3, 'bp', 1100, 0.8, 0.08, 0.01), 0.3); ticks(x, 14, 0.04, 0.4, 1500, 4200, 0.16, 1.6); fade(x); return norm(x); });
  S.imp_metal = many(4, () => { const f = rr(650, 1700), x = new Float32Array(N(0.7)); add(x, burst(0.02, 'hp', 3200, 0.7, 0.003), 1); modes(x, [[f, rr(0.2, 0.4), 1], [f * 1.59, 0.22, 0.7], [f * 2.14, 0.16, 0.55], [f * 2.83, 0.12, 0.4], [f * 3.72, 0.08, 0.3], [f * 4.9, 0.05, 0.22]], 0.3); add(x, burst(0.08, 'bp', f * 1.2, 1.5, 0.02), 0.5); fade(x, 0.05); return norm(x); });
  S.imp_wood = many(3, () => { const v = rr(0.85, 1.2), x = new Float32Array(N(0.35)); modes(x, [[180 * v, 0.04, 1], [310 * v, 0.03, 0.8], [520 * v, 0.024, 0.6], [890 * v, 0.018, 0.4]], 0.6); add(x, burst(0.05, 'bp', 1800 * v, 1, 0.012), 0.9); ticks(x, 8, 0.02, 0.25, 1500, 4500, 0.22, 1.5); fade(x); return norm(x); });
  S.imp_glass = many(3, () => { const x = new Float32Array(N(0.7)); add(x, burst(0.03, 'hp', 2500, 0.7, 0.004), 1); for (let k = 0; k < 26; k++) modes(x, [[rr(3000, 9500), rr(0.008, 0.04), rr(0.2, 0.6)]], 0.5, rr(0, 0.5) * rr(0, 1)); fade(x); return norm(x); });
  S.imp_dirt = many(3, () => { const x = new Float32Array(N(0.4)); add(x, burst(0.25, 'lp', 300, 0.7, 0.06), 1); add(x, burst(0.3, 'bp', 2500, 0.7, 0.1, 0.008), 0.2); ticks(x, 10, 0.03, 0.3, 1500, 5000, 0.12, 1.4); fade(x); return norm(x); });
  S.imp_fabric = many(2, () => { const x = new Float32Array(N(0.2)); add(x, burst(0.12, 'lp', 700, 0.7, 0.03), 1); add(x, burst(0.06, 'bp', 2200, 0.8, 0.012), 0.2); fade(x); return norm(x, 0.8); });
  S.imp_flesh = many(3, () => { const x = new Float32Array(N(0.25)); add(x, burst(0.1, 'lp', 900, 0.7, 0.025), 1); add(x, burst(0.08, 'bp', 700, 0.9, 0.02), 0.8); sweep(x, 170, 90, 0.04, 0.5, 0, 0.03); add(x, burst(0.01, 'hp', 2500, 0.7, 0.002), 0.25); add(x, burst(0.1, 'bp', 1600, 1.2, 0.03, 0.004), 0.25, 0.01); fade(x); return norm(x); });
  S.imp_plastic = many(2, () => { const v = rr(0.85, 1.2), x = new Float32Array(N(0.25)); modes(x, [[320 * v, 0.035, 1], [540 * v, 0.03, 0.7], [910 * v, 0.02, 0.5]], 0.6); add(x, burst(0.02, 'hp', 2000, 0.7, 0.003), 0.7); fade(x); return norm(x); });
  S.ricochet = many(4, () => {      // a deformed round tumbling away: falling whine with a fast warble
    const x = new Float32Array(N(0.9)), f0 = rr(3200, 5200), f1 = rr(900, 1500), tau = rr(0.14, 0.3), wob = rr(28, 44); let ph = 0;
    for (let i = 0; i < x.length; i++) { const t = i / SR, f = (f1 + (f0 - f1) * Math.exp(-t / tau)) * (1 + 0.035 * Math.sin(TAU * wob * t)); ph += TAU * f / SR; x[i] = (Math.sin(ph) + 0.35 * Math.sin(ph * 1.5)) * Math.exp(-t / 0.22) * Math.min(1, i / 60); }
    add(x, burst(0.05, 'hp', 3000, 0.7, 0.004), 0.5); fade(x, 0.1); return norm(x, 0.8);
  });

  // ---- boots: heel, then the ball of the foot and whatever is underfoot ------------------------------------------------------
  const step = (thud, click, clickF, grit, extra) => () => {
    const v = rr(0.88, 1.14), x = new Float32Array(N(0.34)), toe = rr(0.07, 0.105);
    add(x, burst(0.12, 'lp', thud * v, 0.8, 0.028), 1); if (click) add(x, burst(0.02, 'bp', clickF * v, 1.4, 0.004), click);
    add(x, burst(0.1, 'lp', thud * 1.3 * v, 0.8, 0.02), 0.5, toe); if (grit) add(x, burst(0.12, 'bp', rr(1800, 3600), 0.8, 0.03, 0.006), grit, toe - 0.01);
    if (extra) extra(x, v, toe); fade(x); return norm(x);
  };
  S.step_concrete = many(5, step(165, 0.55, 1400, 0.16));
  S.step_dirt = many(5, step(125, 0.1, 900, 0.3, (x, v, toe) => { ticks(x, 22, 0, 0.14, 1500, 6000, 0.22, 0.8); ticks(x, 12, toe, toe + 0.1, 1500, 6000, 0.16, 0.8); }));
  S.step_wood = many(4, step(150, 0.6, 1100, 0.05, (x, v) => { modes(x, [[110 * v, 0.06, 0.7], [185 * v, 0.055, 0.7], [310 * v, 0.045, 0.6], [620 * v, 0.02, 0.4]], 0.5); add(x, burst(0.05, 'bp', 650 * v, 0.9, 0.018), 0.5); }));
  S.step_metal = many(4, step(170, 0.5, 2100, 0.04, (x, v) => modes(x, [[240 * v, 0.16, 1], [510 * v, 0.13, 0.6], [780 * v, 0.1, 0.45], [1320 * v, 0.07, 0.3]], 0.3)));
  S.step_tile = many(4, step(185, 0.9, 2300, 0.08));
  S.step_fabric = many(3, step(120, 0, 0, 0.1));
  S.rattle = many(4, () => { const x = new Float32Array(N(0.3)); ticks(x, 5, 0, 0.16, 2600, 5200, 0.9, 0.5); add(x, burst(0.2, 'bp', 1500, 0.7, 0.07, 0.03), 0.22); modes(x, [[rr(2300, 3100), 0.012, 1]], 0.25, rr(0.01, 0.1)); fade(x); return norm(x, 0.7); });
  S.cloth = many(4, () => { const x = burst(rr(0.2, 0.3), 'bp', rr(1100, 2300), 0.6, 0.07, 0.05); add(x, burst(0.15, 'lp', 500, 0.7, 0.05, 0.03), 0.4); fade(x, 0.04); return norm(x, 0.7); });

  // ---- rifle handling -----------------------------------------------------------------------------------------------------------
  const one = f => [f()];
  S.dry = one(() => { const x = new Float32Array(N(0.08)); add(x, burst(0.01, 'hp', 3000, 0.7, 0.0016), 1); modes(x, [[1850, 0.006, 1], [3900, 0.004, 0.5]], 0.6); return norm(x, 0.8); });
  S.select = one(() => { const x = new Float32Array(N(0.12)); for (const at of [0, 0.034]) { add(x, burst(0.008, 'hp', 3500, 0.7, 0.0012), 0.8, at); modes(x, [[2900, 0.005, 1], [4700, 0.004, 0.5]], 0.5, at); } return norm(x, 0.7); });
  S.magout = one(() => { const x = new Float32Array(N(0.3)); add(x, burst(0.008, 'hp', 3200, 0.7, 0.0015), 0.9); modes(x, [[2200, 0.008, 1]], 0.5); add(x, burst(0.09, 'bp', 2100, 1.2, 0.06, 0.04), 0.35, 0.02); modes(x, [[300, 0.02, 1], [520, 0.018, 0.7], [1700, 0.01, 0.4]], 0.6, 0.1); fade(x); return norm(x, 0.8); });
  S.magin = one(() => { const x = new Float32Array(N(0.3)); add(x, burst(0.07, 'bp', 1900, 1.2, 0.05, 0.03), 0.35); add(x, burst(0.012, 'hp', 2400, 0.7, 0.002), 1, 0.07); modes(x, [[260, 0.03, 1], [430, 0.024, 0.8], [1900, 0.012, 0.5], [3300, 0.008, 0.3]], 0.7, 0.07); fade(x); return norm(x, 0.85); });
  S.magtap = one(() => { const x = new Float32Array(N(0.2)); add(x, burst(0.1, 'lp', 260, 0.8, 0.03), 1); modes(x, [[380, 0.025, 1], [1500, 0.008, 0.3]], 0.5); fade(x); return norm(x, 0.8); });
  S.bolt = one(() => { const x = new Float32Array(N(0.35)); add(x, burst(0.012, 'hp', 2000, 0.7, 0.0028), 1); modes(x, [[520, 0.03, 1], [1300, 0.03, 0.8], [2700, 0.02, 0.6], [4100, 0.014, 0.4]], 0.6); sweep(x, 640, 590, 0.07, 0.12, 0.004, 0.2); add(x, burst(0.05, 'bp', 1700, 1.5, 0.014), 0.3, 0.018); fade(x); return norm(x, 0.9); });
  S.casing = many(4, () => { const v = rr(0.88, 1.14), x = new Float32Array(N(0.3)); modes(x, [[4100 * v, 0.05, 1], [6350 * v, 0.04, 0.8], [9200 * v, 0.025, 0.5], [11800 * v, 0.014, 0.3]], 0.5); add(x, burst(0.004, 'hp', 4000, 0.7, 0.0008), 0.6); fade(x); return norm(x, 0.7); });

  // ---- loose objects knocked about, by material -----------------------------------------------------------------------------------
  const knock = (list, tick, body, len = 0.5) => () => { const v = rr(0.82, 1.2), x = new Float32Array(N(len)); modes(x, list.map(([f, d, a]) => [f * v * rr(0.97, 1.03), d * rr(0.8, 1.2), a]), 0.5); add(x, burst(0.02, 'hp', 2200, 0.7, 0.003), tick); if (body) add(x, burst(0.15, 'lp', body, 0.8, 0.035), 0.8); fade(x, 0.03); return norm(x); };
  S.prop_plastic = many(3, knock([[140, 0.05, 1], [230, 0.045, 0.8], [410, 0.035, 0.6], [700, 0.025, 0.4], [1500, 0.012, 0.2]], 0.5, 200, 0.35));
  S.prop_wood = many(3, knock([[220, 0.04, 1], [390, 0.035, 0.8], [640, 0.03, 0.6], [1150, 0.018, 0.3]], 0.6, 260, 0.3));
  S.prop_bin = many(3, knock([[180, 0.3, 1], [320, 0.28, 0.8], [470, 0.22, 0.7], [760, 0.18, 0.55], [1250, 0.13, 0.4], [2100, 0.09, 0.3], [3400, 0.05, 0.2]], 0.7, 0, 0.9));
  S.prop_can = many(3, knock([[310, 0.12, 1], [560, 0.1, 0.8], [940, 0.08, 0.6], [1700, 0.06, 0.4], [2900, 0.04, 0.3]], 0.7, 0, 0.5));
  S.prop_tank = many(3, knock([[520, 0.5, 1], [1340, 0.4, 0.7], [2480, 0.3, 0.5], [3900, 0.2, 0.3]], 0.6, 0, 1.2));
  S.prop_clay = many(2, knock([[900, 0.05, 1], [1700, 0.04, 0.7], [2900, 0.03, 0.5]], 0.5, 220, 0.3));
  S.prop_cardboard = many(2, () => { const x = new Float32Array(N(0.25)); add(x, burst(0.15, 'lp', 480, 0.8, 0.04), 1); add(x, burst(0.12, 'bp', 1400, 0.7, 0.04, 0.008), 0.3); fade(x); return norm(x, 0.8); });
  S.prop_rubber = many(2, () => { const x = new Float32Array(N(0.35)); sweep(x, 130, 95, 0.06, 0.6, 0, 0.05); add(x, burst(0.15, 'lp', 400, 0.8, 0.04), 0.8); add(x, burst(0.1, 'bp', 380, 0.9, 0.03), 0.8); fade(x); return norm(x, 0.85); });
  S.prop_bag = many(2, () => { const x = new Float32Array(N(0.35)); add(x, burst(0.2, 'lp', 300, 0.8, 0.05), 1); add(x, burst(0.25, 'bp', 3200, 0.7, 0.08, 0.02), 0.3); ticks(x, 8, 0, 0.2, 2500, 6000, 0.15); fade(x); return norm(x, 0.75); });
  S.prop_wicker = many(2, () => { const x = new Float32Array(N(0.3)); add(x, burst(0.1, 'lp', 350, 0.8, 0.03), 0.8); ticks(x, 14, 0, 0.18, 1200, 3800, 0.4, 0.8); fade(x); return norm(x, 0.75); });
  S.prop_gun = many(3, () => { const v = rr(0.9, 1.15), x = new Float32Array(N(0.45)); for (const [at, g] of [[0, 1], [rr(0.04, 0.07), 0.6], [rr(0.11, 0.17), 0.4]]) { add(x, burst(0.012, 'hp', 2000, 0.7, 0.0025), g, at); modes(x, [[800 * v, 0.022, 1], [1900 * v, 0.02, 0.7], [3300 * v, 0.014, 0.5]], g * 0.5, at); add(x, burst(0.06, 'lp', 300, 0.8, 0.02), g * 0.5, at); } fade(x); return norm(x, 0.85); });
  S.bodyfall = many(3, () => { const x = new Float32Array(N(0.6)); sweep(x, 100, 60, 0.08, 0.6, 0, 0.05); add(x, burst(0.3, 'lp', 280, 0.8, 0.07), 0.9); add(x, burst(0.2, 'bp', 430, 0.8, 0.055), 1.0); add(x, burst(0.15, 'bp', 950, 0.8, 0.035), 0.5); add(x, burst(0.25, 'bp', 1700, 0.7, 0.07, 0.02), 0.3); ticks(x, 6, 0.02, 0.2, 2400, 5000, 0.25, 0.5); fade(x, 0.05); return norm(x); });
  S.heart = one(() => { const x = new Float32Array(N(0.5)); for (const [at, f, g] of [[0, 58, 1], [0.17, 47, 0.75]]) { sweep(x, f * 1.35, f, 0.05, g, at, 0.03); add(x, burst(0.08, 'bp', 170, 0.9, 0.03), g * 0.8, at); } sat(x, 2.2); fade(x, 0.05); return norm(x, 0.9); });

  // ---- thrown ordnance ------------------------------------------------------------------------------------------------------------
  // Handling: the pin dragged out through its hole, the lever thrown off by the striker spring with the primer's snap
  // under it, the arm going through the air, small steel parts landing.
  S.pinpull = many(2, () => { const v = rr(0.94, 1.06), x = new Float32Array(N(0.28)); add(x, burst(0.07, 'bp', 3400 * v, 2.5, 0.022, 0.012), 0.6); ticks(x, 7, 0, 0.06, 2800, 5200, 0.5, 0.4); add(x, burst(0.006, 'hp', 3600, 0.7, 0.001), 0.9, 0.062); modes(x, [[4700 * v, 0.045, 1], [7350 * v, 0.03, 0.6], [10900 * v, 0.016, 0.3]], 0.42, 0.064); fade(x); return norm(x, 0.7); });
  S.spoon = many(3, () => {
    const v = rr(0.92, 1.08), x = new Float32Array(N(0.42));
    add(x, burst(0.008, 'hp', 2800, 0.7, 0.0014), 1); modes(x, [[1750 * v, 0.03, 1], [2960 * v, 0.05, 0.9], [4480 * v, 0.04, 0.6], [6900 * v, 0.022, 0.4]], 0.5);      // lever springs away
    add(x, burst(0.012, 'hp', 1800, 0.7, 0.0022), 0.9, 0.011); pulse(x.subarray(N(0.012)), 0.00016, 0.5); add(x, burst(0.05, 'bp', 1300, 0.8, 0.012), 0.5, 0.012);     // striker onto the primer
    add(x, env(biq(white(N(0.3)), 'bp', 5200, 0.8), 0.09, 0.02), 0.07, 0.03);                                                                                           // delay element taking
    fade(x, 0.04); return norm(x, 0.8);
  });
  S.tink = many(4, () => { const v = rr(0.85, 1.2), x = new Float32Array(N(0.3)); for (const [at, g] of [[0, 1], [rr(0.05, 0.09), 0.5], [rr(0.12, 0.17), 0.28]]) { add(x, burst(0.004, 'hp', 3500, 0.7, 0.0008), 0.6 * g, at); modes(x, [[2650 * v, 0.03, 1], [4300 * v, 0.026, 0.8], [7150 * v, 0.016, 0.5], [9800 * v, 0.01, 0.3]], 0.4 * g, at); } fade(x); return norm(x, 0.6); });
  S.whoosh = many(3, () => { const n = N(0.34), x = white(n); let lp = 0; for (let i = 0; i < n; i++) { const u = i / n, f = 500 + 2600 * Math.sin(Math.PI * Math.min(1, u * 1.5)) ** 2, a = 1 - Math.exp(-TAU * f / SR); lp += (x[i] - lp) * a; x[i] = lp * Math.sin(Math.PI * u) ** 2.2; } add(x, burst(0.2, 'bp', 1500, 0.6, 0.06, 0.05), 0.25, 0.04); fade(x, 0.05); return norm(x, 0.7); });
  // A pound of steel and filler meeting the ground, and a thin steel can doing the same.
  S.prop_frag = many(4, () => { const v = rr(0.9, 1.12), x = new Float32Array(N(0.34)); add(x, burst(0.012, 'hp', 1700, 0.7, 0.0026), 1); modes(x, [[1040 * v, 0.014, 1], [2180 * v, 0.02, 0.8], [3650 * v, 0.016, 0.55], [5700 * v, 0.01, 0.3]], 0.42); add(x, burst(0.12, 'lp', 340, 0.8, 0.03), 2.4); add(x, burst(0.07, 'bp', 760 * v, 1.2, 0.02), 1.6); modes(x, [[3900 * v, 0.03, 1], [6100 * v, 0.02, 0.5]], 0.05, rr(0.02, 0.04)); fade(x); return norm(x, 0.9); });
  S.prop_canister = many(4, () => { const v = rr(0.88, 1.14), x = new Float32Array(N(0.6)); add(x, burst(0.014, 'hp', 1900, 0.7, 0.003), 0.9); modes(x, [[640 * v, 0.07, 1], [1210 * v, 0.085, 0.9], [1990 * v, 0.07, 0.7], [3150 * v, 0.05, 0.5], [4800 * v, 0.03, 0.35], [7100 * v, 0.018, 0.2]], 0.36); add(x, burst(0.09, 'lp', 300, 0.8, 0.02), 0.7); add(x, burst(0.06, 'bp', 1500 * v, 1.4, 0.02), 0.35, 0.004); fade(x, 0.05); return norm(x, 0.9); });
  S.nade_soft = many(3, () => { const x = new Float32Array(N(0.3)); add(x, burst(0.2, 'lp', 240, 0.8, 0.045), 1); add(x, burst(0.1, 'bp', 520, 0.8, 0.03), 0.5); ticks(x, 9, 0.01, 0.2, 1800, 5200, 0.1, 1.2); fade(x); return norm(x, 0.85); });
  // High explosive from close by: the pressure front, a hard crack, the body of the blast, earth and grit coming back down.
  S.boom = many(3, () => {
    const v = rr(0.93, 1.07), n = N(3.0), core = new Float32Array(n);
    pulse(core, 0.0012, 1.1); sweep(core, 105 * v, 31, 0.2, 0.42, 0, 0.055); sweep(core, 58 * v, 26, 0.34, 0.16, 0.01, 0.12);
    add(core, burst(0.07, 'hp', 1900, 0.7, 0.013), 2.6); add(core, burst(0.03, 'hp', 5200, 0.7, 0.006), 1.5);
    const side = () => {
      const x = new Float32Array(n);
      add(x, burst(0.6, 'bp', 150 * v, 0.6, 0.13), 0.7); add(x, burst(0.5, 'bp', 400 * v, 0.6, 0.085), 1.5); add(x, burst(0.35, 'bp', 1050 * v, 0.6, 0.06), 1.9); add(x, burst(0.2, 'bp', 2700 * v, 0.7, 0.034), 1.7); add(x, burst(0.12, 'bp', 5600 * v, 0.7, 0.02), 1.0);
      add(x, env(biq(white(N(1.8)), 'lp', 260, 0.7), 0.42, 0.03), 0.3); add(x, env(biq(white(N(1.6)), 'bp', 900, 0.5), 0.3, 0.05), 0.34, 0.05);
      ticks(x, 70, 0.3, 2.6, 1300, 6400, 0.07, 1.1); add(x, env(biq(white(N(1.9)), 'bp', 3300, 0.6), 0.5, 0.35), 0.035, 0.35);                    // debris and grit raining back
      for (let k = 0; k < 5; k++) add(x, burst(0.1, 'lp', rr(180, 420), 0.8, 0.03), rr(0.08, 0.2), rr(0.45, 1.6));                                   // heavier clods
      return x;
    };
    const L = side(), Rt = side();
    for (const ch of [L, Rt]) { add(ch, core); const g = biq(ch.slice(), 'lp', 2400, 0.6); add(ch, g, -0.32, 0.0058); sat(ch, 1.35); biq(ch, 'lp', 12000, 0.6); fade(ch, 0.2); }      // ground bounce a few ms behind
    return norm([L, Rt], 0.97);
  });
  // The same charge down the street: no crack left, a heavy slam and its slap off the house fronts.
  S.boomMid = many(3, () => {
    const v = rr(0.92, 1.08), x = new Float32Array(N(2.6));
    pulse(x, 0.0017, 0.8); sweep(x, 88 * v, 30, 0.22, 0.34, 0, 0.07); add(x, burst(0.08, 'hp', 900, 0.7, 0.014), 1.3);
    add(x, burst(0.6, 'bp', 135 * v, 0.6, 0.14), 0.7); add(x, burst(0.5, 'bp', 340 * v, 0.6, 0.09), 1.5); add(x, burst(0.3, 'bp', 820 * v, 0.6, 0.06), 1.5); add(x, burst(0.2, 'bp', 1900 * v, 0.7, 0.035), 0.9);
    const e = biq(x.slice(0, N(0.5)), 'lp', 1100, 0.6); let g = 0.42;
    for (let k = 0, at = rr(0.07, 0.12); k < 5; k++) { add(x, e, g * rr(0.6, 1), at); at += rr(0.07, 0.2); g *= 0.6; }
    add(x, env(biq(white(N(2.4)), 'lp', 500, 0.6), 0.5, 0.03), 0.16); add(x, env(biq(white(N(2.0)), 'bp', 700, 0.5), 0.35, 0.04), 0.3);
    sat(x, 1.25); biq(x, 'lp', 5200, 0.6); fade(x, 0.2); return norm(x, 0.97);
  });
  // And blocks away: a dull thud that the city passes around for a second or two.
  S.boomFar = many(3, () => {
    const v = rr(0.9, 1.1), x = new Float32Array(N(3.4));
    sweep(x, 72 * v, 28, 0.3, 0.3, 0, 0.1); add(x, burst(0.7, 'bp', 110 * v, 0.6, 0.17), 0.7); add(x, burst(0.5, 'bp', 270 * v, 0.6, 0.11), 1.6); add(x, burst(0.3, 'bp', 600 * v, 0.6, 0.07), 1.2); add(x, burst(0.2, 'bp', 1200 * v, 0.7, 0.04), 0.5);
    const e = biq(x.slice(0, N(0.7)), 'lp', 600, 0.6); let g = 0.55;
    for (let k = 0, at = rr(0.12, 0.2); k < 6; k++) { add(x, e, g * rr(0.6, 1), at); at += rr(0.1, 0.32); g *= 0.64; }
    add(x, env(biq(white(N(3.2)), 'lp', 380, 0.6), 0.8, 0.05), 0.12); add(x, env(biq(white(N(3.0)), 'bp', 420, 0.5), 0.6, 0.06), 0.3);
    biq(x, 'lp', 2200, 0.6); fade(x, 0.3); return norm(x, 0.97);
  });
  S.debris = many(3, () => { const x = new Float32Array(N(1.9)); ticks(x, 90, 0, 1.7, 1200, 6800, 0.5, 1.3); for (let k = 0; k < 9; k++) add(x, burst(0.09, 'lp', rr(200, 520), 0.8, 0.025), rr(0.2, 0.7), rr(0, 1.2) * rr(0.3, 1)); add(x, env(biq(white(N(1.8)), 'bp', 2800, 0.5), 0.45, 0.1), 0.16); fade(x, 0.2); return norm(x, 0.7); });
  // Smoke: the fuze fires and the filling catches, then burns with a steady rushing hiss until it is spent.
  S.smokepop = many(2, () => { const v = rr(0.92, 1.08), x = new Float32Array(N(0.7)); pulse(x, 0.00028, 0.8); add(x, burst(0.03, 'hp', 2200, 0.7, 0.004), 1); add(x, burst(0.12, 'bp', 1300 * v, 0.9, 0.03), 0.9); sweep(x, 260 * v, 120, 0.04, 0.5, 0, 0.03); modes(x, [[1210 * v, 0.06, 1], [3150 * v, 0.03, 0.5]], 0.12, 0.004); add(x, env(biq(white(N(0.6)), 'bp', 4800, 0.6), 0.5, 0.08), 0.3, 0.03); fade(x, 0.1); return norm(x, 0.9); });
  S.hiss = one(() => {
    const n = N(3.2), x = biq(biq(white(n), 'hp', 1700, 0.7), 'lp', 9500, 0.6), y = biq(white(n), 'bp', 3900, 1.3), z = biq(white(n), 'lp', 420, 0.7), w = biq(white(n), 'lp', 14, 0.7);
    let m = 1e-9; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(w[i]));
    for (let i = 0; i < n; i++) { const t = i / SR, fl = 0.78 + 0.22 * (w[i] / m) + 0.06 * Math.sin(TAU * 37 * t) * Math.sin(TAU * 0.9 * t); x[i] = (x[i] * 0.9 + y[i] * 1.5 + z[i] * 0.5) * fl; }
    return norm(loopable(x, N(0.5)), 0.6);
  });

  // ---- the district itself ------------------------------------------------------------------------------------------------------
  S.bird = many(4, i => {         // sparrow-like phrases: a run of short chirps, each a quick upward or downward sweep
    const x = new Float32Array(N(1.1)), count = 3 + (R() * 5 | 0); let at = 0;
    for (let k = 0; k < count; k++) { const f0 = rr(3200, 5200), f1 = f0 * rr(0.7, 1.45), d = rr(0.03, 0.07), n = N(d); let ph = 0; for (let j = 0; j < n; j++) { const u = j / n; ph += TAU * (f0 + (f1 - f0) * u) / SR; x[Math.round(at * SR) + j] += Math.sin(ph) * Math.sin(Math.PI * u) ** 1.5; } at += d + rr(0.03, i % 2 ? 0.16 : 0.08); }
    return norm(x, 0.6);
  });
  S.flap = many(3, () => { const x = new Float32Array(N(0.6)); for (let k = 0, at = 0; k < 2 + (R() * 3 | 0); k++) { add(x, burst(0.14, 'lp', rr(350, 700), 0.8, 0.035, 0.012), rr(0.5, 1), at); add(x, burst(0.1, 'bp', 1800, 0.7, 0.03, 0.01), 0.15, at); at += rr(0.09, 0.2); } fade(x, 0.05); return norm(x, 0.7); });
  S.cicada = one(() => { const n = N(4.4), x = biq(biq(white(n), 'bp', 5600, 4), 'hp', 3500, 0.7); for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= (0.5 + 0.5 * Math.sin(TAU * 47 * t)) ** 2 * (0.65 + 0.35 * Math.sin(TAU * 0.23 * t + 1)); } return norm(loopable(x, N(0.4)), 0.5); });
  S.hum = one(() => { const n = N(2.4), x = biq(white(n), 'bp', 780, 0.9); for (let i = 0; i < n; i++) { const t = i / SR; x[i] = x[i] * 0.5 + 0.5 * Math.sin(TAU * 100 * t) + 0.3 * Math.sin(TAU * 200 * t + 1) + 0.16 * Math.sin(TAU * 300 * t + 2) + 0.2 * Math.sin(TAU * 49.5 * t) * (1 + 0.2 * Math.sin(TAU * 11 * t)); } return norm(loopable(x, N(0.4)), 0.5); });
  return S;
}
