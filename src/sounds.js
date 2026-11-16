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
  const env = (x, decay, attack = 0) => { const a = Math.max(1, attack * SR), r = Math.exp(-1 / (decay * SR)); let e = 1; for (let i = 0; i < x.length; i++) { x[i] *= e * Math.min(1, i / a); e *= r; } return x; };      // (the decay by recurrence: e = exp(-i / (decay * SR)))
  const burst = (secs, type, f, q, decay, attack = 0) => env(biq(white(N(secs)), type, f, q), decay, attack);    // shaped noise
  const add = (dst, src, g = 1, at = 0) => { const o = Math.round(at * SR); for (let i = 0; i < src.length && i + o < dst.length; i++) dst[i + o] += src[i] * g; return dst; };
  // modal bank: [frequency, decay seconds, amplitude] — what makes a struck object sound like its material
  const modes = (dst, list, g = 1, at = 0) => {
    const o = Math.round(at * SR);
    for (const [f, d, a] of list) {
      if (f > SR * 0.45) continue; const w = TAU * f / SR, ph = R() * TAU, n = Math.min(dst.length - o, N(d * 7)), r = Math.exp(-1 / (d * SR)), c = 2 * r * Math.cos(w), r2 = r * r, k = a * g;
      let s0 = Math.sin(ph), s1 = r * Math.sin(w + ph);                         // sin(w i + ph) * exp(-i / (d * SR)), by recurrence
      if (n > 1) dst[o + 1] += s1 * k * 0.1;
      for (let i = 2; i < n; i++) { const y = c * s1 - r2 * s0; s0 = s1; s1 = y; dst[i + o] += y * k * Math.min(1, i / 10); }
    }
    return dst;
  };
  const sweep = (dst, f0, f1, decay, g = 1, at = 0, tau = 0.03) => {      // tone gliding from f0 to f1
    const o = Math.round(at * SR), n = Math.min(dst.length - o, N(decay * 7)), rt = Math.exp(-1 / (tau * SR)), rd = Math.exp(-1 / (decay * SR)); let ph = 0, et = 1, ed = 1;
    for (let i = 0; i < n; i++) { ph += TAU * (f1 + (f0 - f1) * et) / SR; dst[i + o] += Math.sin(ph) * ed * g * Math.min(1, i / 30); et *= rt; ed *= rd; }      // (et, ed: the two exponentials, by recurrence)
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
  // ---- the plaza fountain: water falling into water, and wading through it -----------------------------------------------------
  S.fountain = one(() => {
    const n = N(3.6), x = biq(white(n), 'bp', 1250, 0.55), hi = biq(white(n), 'bp', 3800, 0.9);
    for (let i = 0; i < n; i++) { const t = i / SR; x[i] = x[i] * (0.75 + 0.25 * Math.sin(TAU * 0.83 * t) * Math.sin(TAU * 0.31 * t + 1)) + hi[i] * 0.3; }
    for (let k = 0; k < 230; k++) sweep(x, rr(380, 900), rr(900, 2600), rr(0.006, 0.02), rr(0.04, 0.16), rr(0, 3.5), 0.008);    // drops: little rising plinks
    return norm(loopable(x, N(0.5)), 0.5);
  });
  S.step_water = many(4, () => {
    const x = new Float32Array(N(0.5)), v = rr(0.85, 1.15);
    add(x, burst(0.22, 'bp', 900 * v, 0.6, 0.06, 0.006), 1); add(x, burst(0.16, 'hp', 2400 * v, 0.7, 0.045, 0.01), 0.45, 0.02);
    for (let k = 0; k < 7; k++) sweep(x, rr(420, 800), rr(1100, 2300), rr(0.008, 0.02), rr(0.1, 0.25), rr(0.01, 0.2), 0.008);
    fade(x); return norm(x, 0.8);
  });

  // ---- a soldier going down -------------------------------------------------------------------------------------------------
  // (Baked after everything above, so the takes before this point come out of the seed exactly as they always have.)
  // His voice, from the larynx up: glottal pulses (the Rosenberg flow shape, differentiated, which is what the lips
  // radiate) with the cycle-to-cycle wobble of a real throat (jitter, shimmer) and, under strain, every other cycle weaker
  // and longer (the broken, rough edge of a cry); breath noise leaking through the open glottis in time with each cycle;
  // and the vocal tract as five resonances that glide as the mouth opens and closes. Contours are [[seconds, value], ...].
  const gs = () => (R() + R() + R() + R() - 2) * 1.73;                       // about unit gaussian
  const tween = pts => t => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, u] = pts[i - 1], [b, w] = pts[i]; return u + (w - u) * (t - a) / Math.max(1e-6, b - a); }
    return pts[pts.length - 1][1];
  };
  // formants of a man's vowels, Hz: ah, uh, the neutral er, oh, oo, eh, and the closed-mouth hum of "mm"
  const VOW = { a: [760, 1150, 2450, 3350, 4250], uh: [640, 1190, 2390, 3350, 4200], er: [520, 1420, 2450, 3350, 4250], o: [520, 870, 2420, 3300, 4150],
    u: [350, 860, 2250, 3250, 4100], e: [560, 1760, 2500, 3400, 4300], m: [270, 1080, 2250, 3250, 4100] };
  const BW = [75, 95, 135, 210, 270];
  const vox = (len, p) => {
    const n = N(len), x = new Float32Array(n), f0 = tween(p.f0), amp = tween(p.amp), br = tween(p.breath || [[0, 0.04]]), oq = tween(p.oq || [[0, 0.55]]), sub = tween(p.sub || [[0, 0]]);
    const jit = tween(p.jit || [[0, 0.015]]), shut = tween(p.shut || [[0, 0]]), shim = p.shim ?? 0.08, trem = p.trem || 0, tf = p.tremF || 5.5, k = p.tract || 1, bwk = p.bw || 1;
    const vw = p.vowel.map(([t, v]) => [t, typeof v === 'string' ? VOW[v] : v]), F = [0, 0, 0, 0, 0], hi = p.hi ?? 0.1;
    const cA = new Float64Array(5), cB = new Float64Array(5), cC = new Float64Array(5), y1 = new Float64Array(5), y2 = new Float64Array(5);
    let ph = 0, T = 0, A = 0, odd = false, tp = 1, tn = 1, lp = 0, la = 1, ep = 0, hn = 0, np = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (ph >= T) {                                                           // the next glottal cycle
        ph -= T; odd = !odd;
        const s = sub(t), f = Math.max(28, f0(t) * (1 + trem * Math.sin(TAU * tf * t)) * (1 + jit(t) * gs()));
        T = SR / f * (odd ? 1 + s * 0.14 : 1); A = amp(t) * Math.max(0, 1 + shim * gs()) * (odd ? 1 - s * 0.55 : 1);
        const q = oq(t); tp = Math.max(2, T * q * 0.62); tn = Math.max(1.5, T * q * 0.38);
      }
      let d = 0, u = 0;                                                        // flow derivative (scaled to the closing slope) and the flow itself
      if (ph < tp) { d = 0.5 * Math.PI * Math.sin(Math.PI * ph / tp) * tn / tp; u = 0.5 * (1 - Math.cos(Math.PI * ph / tp)); }
      else if (ph < tp + tn) { const q = (ph - tp) / tn; d = -0.5 * Math.PI * Math.sin(0.5 * Math.PI * q); u = Math.cos(0.5 * Math.PI * q); }
      ph++;
      const v = Math.min(1, A * 4), b = br(t) * (1 - v + v * (0.25 + 0.75 * u)), w = R() * 2 - 1;     // breath, pulsing with the glottis while it vibrates
      const ex = d * A + w * b * 0.6; let e = ex;                            // the excitation: glottal pulses and breath
      if ((i & 15) === 0) {                                                    // the mouth moves slowly: retune the tract every 16 samples
        let j = 1; while (j < vw.length - 1 && vw[j][0] < t) j++; j = Math.min(j, vw.length - 1);
        const [ta, va] = vw[Math.max(0, j - 1)], [tb, vb] = vw[j], w = j === 0 ? 0 : Math.min(1, Math.max(0, (t - ta) / Math.max(1e-6, tb - ta)));
        for (let m = 0; m < 5; m++) {
          F[m] = (va[m] + (vb[m] - va[m]) * w) * k;
          const r = Math.exp(-Math.PI * BW[m] * bwk / SR); cC[m] = -r * r; cB[m] = 2 * r * Math.cos(TAU * Math.min(F[m], SR * 0.45) / SR); cA[m] = 1 - cB[m] - cC[m];
        }
        la = 1 - Math.exp(-TAU * (9500 - 9000 * shut(t)) / SR);                 // lips closing: the sound is let out through the nose and cheeks
      }
      for (let m = 0; m < 5; m++) { const o = cA[m] * e + cB[m] * y1[m] + cC[m] * y2[m]; y2[m] = y1[m]; y1[m] = o; e = o; }
      const pe = e - 0.94 * ep; ep = e;                                        // the resonances above the fifth, left out of the five: about +6 dB an octave above 500 Hz,
      hn = 0.6 * (hn + ex - np); np = ex;                                      // and what they pass of pulse and breath above 3 kHz
      lp += (pe + hn * hi - lp) * la; x[i] = lp;
    }
    biq(x, 'hp', 75, 0.7); fade(x, 0.02); return norm(x, 0.9);
  };
  const who = () => ({ k: rr(0.91, 1.07), fb: rr(0.86, 1.16) });              // a different man each take: length of throat, pitch of voice
  const pick = (...v) => v[(R() * v.length) | 0];
  // "Ugh": the round lands and the throat closes on a short pressed grunt, falling away into a breath.
  S.die_grunt = many(5, () => {
    const { k, fb } = who(), d = rr(0.2, 0.36), f = 135 * fb, at = rr(0.005, 0.012), v0 = pick('uh', 'a', 'er', 'm'), tail = rr(0.1, 0.18);
    return vox(d + tail, { tract: k, f0: [[0, f * 0.9], [at + 0.03, f * rr(1.08, 1.25)], [d * 0.55, f * 0.98], [d * 0.85, f * 0.72], [d, f * 0.5]],
      amp: [[0, 0], [at, 1], [d * 0.45, 0.85], [d * 0.8, 0.3], [d, 0]], breath: [[0, 0.03], [d * 0.6, 0.05], [d * 0.9, 0.22], [d + tail * 0.3, 0.12], [d + tail, 0]],
      vowel: [[0, v0], [d, 'er']], oq: [[0, 0.4], [d, 0.62]], jit: [[0, 0.02], [d * 0.7, 0.03], [d, 0.12]], sub: [[0, 0.12], [d * 0.35, 0.3], [d * 0.8, 0.05]], shim: 0.1,
      shut: v0 === 'm' ? [[0, 0.75], [d, 0.6]] : [[0, 0], [d, 0.2]] });
  });
  // The wind knocked out of him: a forced "hhuh" with little voice in it.
  S.die_oof = many(4, () => {
    const { k, fb } = who(), h = rr(0.045, 0.085), d = h + rr(0.11, 0.2), f = 118 * fb;
    return vox(d + 0.16, { tract: k, f0: [[0, f], [h + 0.02, f * 1.06], [d, f * 0.7]], amp: [[0, 0], [h * 0.8, 0], [h + 0.025, 0.7], [d * 0.85, 0.35], [d, 0]],
      breath: [[0, 0], [0.006, 0.9], [h, 0.55], [h + 0.05, 0.25], [d, 0.22], [d + 0.16, 0]], vowel: [[0, pick('uh', 'o')], [d, pick('er', 'u')]], oq: [[0, 0.6], [d, 0.7]], jit: [[0, 0.03], [d, 0.08]], shim: 0.12 });
  });
  // A cry: the pitch thrown up by the pain and held, rough with strain, then let go.
  S.die_cry = many(4, () => {
    const { k, fb } = who(), d = rr(0.42, 0.7), f = 150 * fb, pk = rr(1.6, 2.2), at = rr(0.015, 0.03);
    const x = vox(d + 0.16, { tract: k, f0: [[0, f], [0.08, f * pk], [d * 0.45, f * pk * rr(0.86, 0.96)], [d * 0.8, f * pk * 0.7], [d, f * 0.85]],
      amp: [[0, 0], [at, 0.8], [0.08, 1], [d * 0.6, 0.8], [d * 0.85, 0.35], [d, 0]], breath: [[0, 0.05], [d * 0.7, 0.08], [d, 0.25], [d + 0.16, 0]],
      vowel: [[0, 'a'], [d * 0.6, 'uh'], [d, 'er']], oq: [[0, 0.36], [d, 0.5]], jit: [[0, 0.02], [d, 0.05]], sub: [[0, 0.05], [0.09, rr(0.3, 0.5)], [d * 0.6, 0.25], [d, 0.05]],
      trem: 0.025, tremF: rr(5.5, 7.5), shim: 0.09, bw: 0.9 });
    add(x, biq(x.slice(), 'hp', 1300, 0.7), 2.8);                              // the effort of it: a shouting throat closes harder, and brighter
    return norm(sat(norm(x, 0.9), 1.5), 0.9);
  });
  // A groan: low, slack and breathy, the mouth closing on it, sinking into the creak of a throat with no air behind it.
  S.die_groan = many(3, () => {
    const { k, fb } = who(), d = rr(0.65, 1.0), f = 110 * fb;
    return vox(d + 0.12, { tract: k, f0: [[0, f * 0.92], [0.12, f], [d * 0.6, f * 0.86], [d * 0.85, f * 0.62], [d, 44]], amp: [[0, 0], [0.09, 0.7], [d * 0.5, 0.6], [d * 0.85, 0.32], [d, 0]],
      breath: [[0, 0.12], [d * 0.5, 0.2], [d, 0.3], [d + 0.12, 0]], vowel: [[0, 'o'], [d * 0.45, 'er'], [d, pick('u', 'm')]], oq: [[0, 0.68], [d * 0.75, 0.55], [d, 0.3]],
      jit: [[0, 0.02], [d * 0.75, 0.035], [d, 0.18]], shim: 0.12, trem: 0.02, tremF: rr(4, 5.5), shut: [[0, 0], [d * 0.6, 0.15], [d, 0.6]], bw: 1.15 });
  });
  // A gasp: air dragged in through a tightening throat and cut off short, then what is left of it let out.
  S.die_gasp = many(3, () => {
    const { k } = who(), d = rr(0.15, 0.24), gap = rr(0.12, 0.24), e = rr(0.14, 0.22), f = rr(300, 420);
    return vox(d + gap + e + 0.05, { tract: k, f0: [[0, f], [d, f * 1.15], [d + gap, 120], [d + gap + e, 90]],
      amp: [[0, 0], [0.02, 0.16], [d * 0.85, 0.14], [d, 0], [d + gap, 0], [d + gap + 0.02, 0.32], [d + gap + e, 0]],
      breath: [[0, 0], [0.01, 1], [d * 0.75, 0.75], [d, 0], [d + gap, 0], [d + gap + 0.008, 0.5], [d + gap + e, 0.08], [d + gap + e + 0.05, 0]],
      vowel: [[0, 'a'], [d, 'e'], [d + gap, 'uh'], [d + gap + e, 'er']], oq: [[0, 0.7]], jit: [[0, 0.08], [d, 0.1], [d + gap, 0.04]], shim: 0.2, hi: 0.12 });
  });
  // Choking: a weak voice broken up by what is in the airway.
  S.die_choke = many(2, () => {
    const { k, fb } = who(), d = rr(0.4, 0.6), f = 100 * fb, n = N(d + 0.1), fl = biq(white(n), 'lp', rr(18, 30), 0.7); let m = 1e-9; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(fl[i]));
    const x = vox(d + 0.1, { tract: k, f0: [[0, f], [d, f * 0.75]], amp: [[0, 0], [0.03, 0.5], [d * 0.7, 0.4], [d, 0]], breath: [[0, 0.15], [d, 0.2], [d + 0.1, 0]], vowel: [[0, 'er'], [d, 'u']], oq: [[0, 0.55]], jit: [[0, 0.05]], shim: 0.25, bw: 1.3 });
    for (let i = 0; i < n; i++) x[i] *= 0.35 + 0.65 * Math.abs(fl[i]) / m;
    for (let j = 0; j < 9; j++) sweep(x, rr(350, 650), rr(900, 1700), rr(0.006, 0.014), rr(0.04, 0.09), rr(0.03, d), 0.006);        // bubbling
    return norm(x, 0.9);
  });
  // A scream: the pain throws the voice up hard and holds it there, raw and breaking (every other cycle out of step, the
  // pitch shaking), the jaw wide open, until it cracks and falls away into what breath is left.
  S.die_scream = many(5, () => {
    const { k, fb } = who(), d = rr(0.6, 1), f = 140 * fb, pk = rr(2.5, 3.3), brk = d * rr(0.66, 0.8);
    const x = vox(d + 0.18, { tract: k, f0: [[0, f * 1.3], [0.05, f * pk], [d * 0.3, f * pk * rr(0.95, 1.05)], [brk, f * pk * rr(0.82, 0.9)], [brk + 0.03, f * pk * 0.5], [d, f * 1.05]],
      amp: [[0, 0], [0.012, 0.9], [0.05, 1], [brk, 0.85], [brk + 0.05, 0.6], [d * 0.95, 0.25], [d, 0]], breath: [[0, 0.08], [brk, 0.12], [d, 0.3], [d + 0.18, 0]],
      vowel: [[0, [900, 1650, 2650, 3600, 4400]], [brk * 0.92, [900, 1650, 2650, 3600, 4400]], [brk + 0.04, 'a'], [d, 'uh']], oq: [[0, 0.32], [brk, 0.4], [d, 0.55]], jit: [[0, 0.03], [0.06, 0.05], [brk, 0.06], [d, 0.08]],
      sub: [[0, 0.2], [0.06, rr(0.4, 0.6)], [brk, 0.35], [d, 0.15]], trem: 0.035, tremF: rr(6, 9), shim: 0.14, bw: 1.8 });       // (wide: at this pitch the harmonics are far apart)
    add(x, biq(x.slice(), 'hp', 1500, 0.7), 5);                                // a screaming throat slams shut on every cycle: bright and hard
    return norm(sat(norm(x, 0.9), 1.8), 0.9);
  });
  // A yell cut short: "ah!", high and pressed.
  S.die_yell = many(4, () => {
    const { k, fb } = who(), d = rr(0.22, 0.36), f = 150 * fb, pk = rr(1.8, 2.3);
    const x = vox(d + 0.12, { tract: k, f0: [[0, f * 1.2], [0.035, f * pk], [d * 0.6, f * pk * 0.92], [d, f * pk * 0.6]], amp: [[0, 0], [0.008, 1], [d * 0.6, 0.85], [d * 0.9, 0.3], [d, 0]],
      breath: [[0, 0.06], [d * 0.8, 0.1], [d, 0.25], [d + 0.12, 0]], vowel: [[0, pick('a', 'uh', 'e')], [d, 'er']], oq: [[0, 0.34], [d, 0.5]], jit: [[0, 0.03], [d, 0.06]],
      sub: [[0, 0.15], [0.04, 0.35], [d, 0.1]], shim: 0.1, bw: 0.9 });
    add(x, biq(x.slice(), 'hp', 1300, 0.7), 2.6);
    return norm(sat(norm(x, 0.9), 1.6), 0.9);
  });
  // Shot through the head: a sound started and cut off as everything stops, "uh—", and the air going out.
  S.die_head = many(3, () => {
    const { k, fb } = who(), d = rr(0.07, 0.13), f = 130 * fb;
    return vox(d + 0.14, { tract: k, f0: [[0, f * 1.4], [d, f]], amp: [[0, 0], [0.006, 1], [d * 0.8, 0.8], [d, 0]], breath: [[0, 0.05], [d, 0.3], [d + 0.14, 0]],
      vowel: [[0, pick('uh', 'a')], [d + 0.1, 'er']], oq: [[0, 0.4]], jit: [[0, 0.04]], sub: [[0, 0.2]], shim: 0.12 });
  });
  // And on the ground, a last breath going out of him.
  S.die_breath = many(2, () => { const { k, fb } = who(), d = rr(0.5, 0.8), f = 95 * fb; return vox(d, { tract: k, f0: [[0, f], [d, 50]], amp: [[0, 0], [0.12, 0.14], [d * 0.6, 0.1], [d, 0]], breath: [[0, 0], [0.08, 0.35], [d * 0.6, 0.25], [d, 0]], vowel: [[0, 'er'], [d, 'u']], oq: [[0, 0.7]], jit: [[0, 0.05], [d, 0.2]], shim: 0.2, shut: [[0, 0.1], [d, 0.5]], hi: 0.035 }); });

  // A round going into a man in kit: the cloth snapping, the thump of the body taking it, the wet slap with it.
  S.hit_body = many(4, () => {
    const v = rr(0.9, 1.12), x = new Float32Array(N(0.3));
    add(x, burst(0.012, 'hp', 2800, 0.7, 0.0016), 1.2);                                                          // the cloth snapping
    sweep(x, rr(170, 210) * v, rr(95, 115), 0.03, 0.22, 0, 0.015); add(x, burst(0.1, 'lp', 520, 0.8, 0.026), 1.6); add(x, burst(0.06, 'bp', rr(180, 240) * v, 0.9, 0.03), 1.4);    // the body taking it
    add(x, burst(0.05, 'bp', rr(900, 1300) * v, 0.9, 0.012), 1); add(x, burst(0.06, 'bp', rr(1900, 2700), 1.1, 0.014, 0.002), 0.5, 0.003);     // the wet slap
    fade(x); return norm(x);
  });
  // Into the plate in the vest: a hard knock, the carrier's thump behind it and a spit of fragments.
  S.hit_armor = many(3, () => {
    const v = rr(0.9, 1.12), x = new Float32Array(N(0.3));
    add(x, burst(0.01, 'hp', 2400, 0.7, 0.002), 1.3); modes(x, [[rr(700, 900) * v, 0.014, 1], [rr(1500, 1800) * v, 0.011, 0.75], [rr(2600, 3100) * v, 0.008, 0.5]], 0.35);
    add(x, burst(0.08, 'lp', 520, 0.8, 0.022), 1.3); add(x, burst(0.05, 'bp', rr(200, 260), 0.9, 0.025), 1); ticks(x, 5, 0.005, 0.05, 2500, 6000, 0.2);
    fade(x); return norm(x);
  });
  // Through the helmet: the shell cracking and the dead thud of the head.
  S.hit_head = many(3, () => {
    const v = rr(0.9, 1.12), x = new Float32Array(N(0.28));
    add(x, burst(0.008, 'hp', 3000, 0.7, 0.0012), 1.3); modes(x, [[rr(900, 1200) * v, 0.011, 1], [rr(2000, 2400) * v, 0.008, 0.6]], 0.3);
    add(x, burst(0.07, 'lp', 600, 0.8, 0.018), 1.3); add(x, burst(0.05, 'bp', rr(250, 330), 0.9, 0.02), 0.9); add(x, burst(0.04, 'bp', 1300, 1, 0.01), 0.6, 0.002);
    fade(x); return norm(x);
  });

  // A body landing, by what it lands on. The chest and the kit on it make the thump; the ground gives it its edge:
  // a slap and grit on concrete, a harder crack on tile, a dull crunch on dirt, boards booming, sheet metal ringing.
  const fallOn = surf => () => {
    const v = rr(0.9, 1.1), x = new Float32Array(N(surf === 'metal' ? 0.9 : 0.6)), hard = surf !== 'dirt' && surf !== 'soft';
    sweep(x, rr(115, 135) * v, rr(75, 88), rr(0.05, 0.07), 0.09, 0, 0.03);                                     // the chest
    add(x, burst(0.25, 'lp', surf === 'soft' ? 260 : 360, 0.8, 0.055), 1.3); add(x, burst(0.2, 'bp', rr(250, 320) * v, 0.9, 0.045), 1.3);    // the weight going down
    add(x, burst(0.12, 'bp', rr(520, 650) * v, 0.8, 0.03), hard ? 0.9 : 0.6);
    add(x, burst(0.05, 'bp', rr(1300, 2000), 0.8, 0.014), hard ? 1 : 0.25);                                     // clothes slapping down
    if (surf === 'concrete') { add(x, burst(0.012, 'hp', 2000, 0.7, 0.002), 0.6); ticks(x, 12, 0.01, 0.25, 1500, 5000, 0.25, 1.5); }
    if (surf === 'tile') { add(x, burst(0.012, 'hp', 2600, 0.7, 0.0018), 0.9); add(x, burst(0.04, 'bp', 2600, 1, 0.01), 0.6); modes(x, [[rr(1700, 2000), 0.03, 1], [rr(3000, 3400), 0.02, 0.6]], 0.05); }
    if (surf === 'dirt') { add(x, burst(0.15, 'bp', 800, 0.6, 0.04), 0.7); ticks(x, 24, 0.005, 0.3, 1200, 4500, 0.3, 1.2); }
    if (surf === 'wood') modes(x, [[rr(95, 120), 0.09, 1], [rr(170, 210), 0.07, 0.8], [rr(290, 340), 0.05, 0.6], [rr(520, 600), 0.03, 0.4]], 0.25);
    if (surf === 'metal') { add(x, burst(0.01, 'hp', 1800, 0.7, 0.002), 0.7); modes(x, [[rr(140, 180), 0.25, 1], [rr(330, 380), 0.22, 0.7], [rr(560, 640), 0.18, 0.6], [rr(910, 1020), 0.12, 0.4], [rr(1500, 1700), 0.08, 0.3]], 0.12); }
    if (surf === 'soft') { add(x, burst(0.2, 'bp', 1100, 0.6, 0.06, 0.01), 0.1); biq(x, 'lp', 1800, 0.7); }
    fade(x, 0.05); return norm(x, 0.9);
  };
  for (const s of ['concrete', 'tile', 'dirt', 'wood', 'metal', 'soft']) S['fall_' + s] = many(s === 'concrete' ? 4 : 3, fallOn(s));
  // The helmet striking the ground: the shell's hollow knock with the weight of the head behind it, the visor ticking.
  const helmetOn = surf => () => {
    const v = rr(0.9, 1.12), x = new Float32Array(N(0.4)), soft = surf === 'soft';
    add(x, burst(0.006, 'hp', 2500, 0.7, 0.001), soft ? 0.15 : 0.8);
    modes(x, [[rr(420, 520) * v, 0.03, 1], [rr(780, 900) * v, 0.025, 0.8], [rr(1300, 1500) * v, 0.018, 0.6], [rr(2100, 2500) * v, 0.012, 0.4]], soft ? 0.18 : 0.5);
    add(x, burst(0.08, 'lp', 380, 0.8, 0.02), 1.1); modes(x, [[rr(2800, 3400), 0.008, 1]], soft ? 0.03 : 0.12, rr(0.02, 0.05));
    if (surf === 'hard') ticks(x, 6, 0.005, 0.12, 1800, 5000, 0.12, 1.4);
    if (surf === 'wood') modes(x, [[rr(170, 210), 0.05, 1], [rr(320, 380), 0.04, 0.7]], 0.35);
    if (surf === 'metal') modes(x, [[rr(330, 380), 0.2, 1], [rr(900, 1000), 0.14, 0.6], [rr(1600, 1750), 0.1, 0.4]], 0.18);
    fade(x); return norm(x, 0.85);
  };
  for (const s of ['hard', 'soft', 'wood', 'metal']) S['helmet_' + s] = many(s === 'hard' ? 3 : 2, helmetOn(s));
  // A knee going down in its hard pad; an arm flopping down; the kit on the vest jumping as the body lands.
  S.knee = many(3, () => { const v = rr(0.9, 1.12), x = new Float32Array(N(0.3)); add(x, burst(0.008, 'hp', 2200, 0.7, 0.0015), 0.6); modes(x, [[rr(600, 750) * v, 0.015, 1], [rr(1200, 1450) * v, 0.012, 0.6], [rr(2100, 2500) * v, 0.008, 0.35]], 0.45); add(x, burst(0.08, 'lp', 320, 0.8, 0.02), 0.8); ticks(x, 5, 0.005, 0.1, 1800, 4500, 0.12, 1.4); fade(x); return norm(x, 0.85); });
  S.limb = many(4, () => { const x = new Float32Array(N(0.25)); add(x, burst(0.05, 'bp', rr(1100, 1700), 0.8, 0.012), 0.7); add(x, burst(0.08, 'lp', 300, 0.8, 0.02), 0.9); add(x, burst(0.01, 'hp', 2000, 0.7, 0.002), 0.25); fade(x); return norm(x, 0.8); });
  S.gear = many(4, () => {
    const x = new Float32Array(N(0.4)); add(x, burst(0.06, 'lp', 420, 0.8, 0.015), 0.5);
    for (let k = 0, m = 3 + (R() * 4 | 0); k < m; k++) modes(x, [[rr(1100, 1600), rr(0.006, 0.012), 1], [rr(2200, 2900), 0.006, 0.6]], rr(0.2, 0.5), rr(0, 0.12) * rr(0.3, 1));      // magazines knocking in their pouches
    for (let k = 0, m = 2 + (R() * 3 | 0); k < m; k++) modes(x, [[rr(3500, 5200), rr(0.02, 0.04), 1], [rr(6000, 8000), 0.015, 0.5]], rr(0.05, 0.14), rr(0.005, 0.2));          // buckles, a carabiner, sling hardware
    ticks(x, 8, 0, 0.2, 2500, 6500, 0.3, 1.2); fade(x, 0.04); return norm(x, 0.8);
  });
  // The fall itself, before the ground: clothes dragging over each other as the limbs fold, kit shifting on the body.
  S.collapse = many(3, () => {
    const n = N(rr(0.6, 0.8)), x = biq(white(n), 'bp', rr(1500, 2300), 0.6), lo = biq(white(n), 'lp', 500, 0.7), cr = biq(white(n), 'lp', rr(60, 110), 0.7), pk = rr(0.18, 0.3);
    let m = 1e-9; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(cr[i]));
    for (let i = 0; i < n; i++) { const t = i / SR, e = t < pk ? (t / pk) ** 1.5 : Math.exp(-(t - pk) / 0.12); x[i] = (x[i] * (0.35 + 0.65 * Math.abs(cr[i]) / m) + lo[i] * 0.35) * e; }
    for (let k = 0, c = 4 + (R() * 4 | 0); k < c; k++) modes(x, [[rr(1200, 3000), rr(0.006, 0.012), 1], [rr(3500, 6500), 0.012, 0.4]], rr(0.03, 0.1), rr(0.05, pk + 0.2));
    fade(x, 0.05); return norm(x, 0.7);
  });
  // A rifle let go of: it lands on one end and slaps down on the other a moment later; steel receiver, polymer furniture,
  // the magazine knocking in its well, the sling's swivels. What it lands on colours it, as for a body.
  const gunOn = surf => () => {
    const v = rr(0.92, 1.1), x = new Float32Array(N(surf === 'metal' ? 0.8 : 0.5)), soft = surf === 'dirt' || surf === 'soft';
    for (const [at, g] of [[0, 1], [rr(0.008, 0.035), rr(0.5, 0.9)]]) {
      add(x, burst(0.01, 'hp', 2200, 0.7, 0.002), g * (soft ? 0.2 : 0.8), at);
      modes(x, [[1250 * v, 0.02, 1], [2350 * v, 0.018, 0.8], [3700 * v, 0.012, 0.6], [5600 * v, 0.008, 0.4]], g * (soft ? 0.12 : 0.35), at);
      add(x, burst(0.04, 'bp', 900 * v, 1.1, 0.01), g * 1.1, at); add(x, burst(0.06, 'lp', 320, 0.8, 0.016), g * (soft ? 1.8 : 1.3), at);
    }
    modes(x, [[rr(1700, 2300), 0.01, 1]], soft ? 0.08 : 0.2, rr(0.03, 0.06)); ticks(x, 4, 0.02, 0.12, 2000, 5000, soft ? 0.1 : 0.25);
    for (let k = 0; k < 2; k++) modes(x, [[rr(5200, 6800), 0.025, 1], [rr(8200, 9800), 0.015, 0.5]], soft ? 0.01 : 0.025, rr(0.01, 0.06));
    if (surf === 'concrete') { add(x, burst(0.06, 'bp', 3500, 0.7, 0.02), 0.25); ticks(x, 8, 0, 0.15, 1500, 5000, 0.15, 1.3); }
    if (surf === 'tile') { add(x, burst(0.008, 'hp', 3000, 0.7, 0.0015), 0.5); modes(x, [[rr(2000, 2300), 0.02, 1], [rr(3500, 3800), 0.015, 0.6]], 0.1); }
    if (surf === 'dirt') { add(x, burst(0.12, 'lp', 250, 0.8, 0.03), 1.2); ticks(x, 12, 0, 0.18, 1200, 4000, 0.12, 1.3); }
    if (surf === 'wood') modes(x, [[rr(180, 230), 0.05, 1], [rr(330, 400), 0.04, 0.8], [rr(600, 700), 0.03, 0.5]], 0.3);
    if (surf === 'metal') modes(x, [[rr(380, 460), 0.25, 1], [rr(870, 980), 0.2, 0.7], [rr(1500, 1700), 0.15, 0.5], [rr(2500, 2800), 0.1, 0.35]], 0.2);
    if (soft) biq(x, 'lp', surf === 'soft' ? 1500 : 2600, 0.7);
    fade(x, 0.04); return norm(x, 0.9);
  };
  for (const s of ['concrete', 'tile', 'dirt', 'wood', 'metal', 'soft']) S['gun_' + s] = many(s === 'concrete' ? 3 : 2, gunOn(s));
  return S;
}
