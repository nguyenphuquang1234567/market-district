// Renders the modelled reload (src/reload-foley.js) outside the browser: a reload with rounds left and an empty one, laid
// out at the moments weapon.js plays them, and every take of every sound back to back, as WAVs in captures/audio/ with a
// spectrogram of each sequence (ffmpeg); prints the bake time and, per sound, its level, where its strongest click
// falls against the moment it is timed by, and how its energy spreads over the bands.
// Usage: node tools/reload-probe.mjs [seed]
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { reloadFoley, RELOAD_CUES, RELOAD_LEAD } from '../src/reload-foley.js';

const SR = 48000, seed = +(process.argv[2] || 1963), t0 = performance.now(), S = reloadFoley(SR, seed), bakeMs = performance.now() - t0;
const out = new URL('../captures/audio/', import.meta.url); mkdirSync(out, { recursive: true });
function wav(chs) {
  const n = chs[0].length, c = chs.length, b = Buffer.alloc(44 + n * c * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * c * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(c, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * c * 2, 28); b.writeUInt16LE(c * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chs[k][i])) * 32767), 44 + (i * c + k) * 2);
  return b;
}
const db = v => (v > 0 ? 20 * Math.log10(v) : -120);
// the sound as the engine plays it: one gain for all of them (audio.js, Audio.weapon)
const GAIN = 1;
function sequence(empty, pick) {
  const L = new Float32Array(Math.round(2.4 * SR)), R = new Float32Array(L.length), marks = [];
  for (const [at, part, dry] of RELOAD_CUES) {
    const name = empty ? dry : part; if (!name) continue;
    const start = at - (RELOAD_LEAD[name] ?? 0), [l, r] = S[name][pick(S[name].length)], o = Math.round(start * SR);
    for (let i = 0; i < l.length && o + i < L.length; i++) { L[o + i] += l[i] * GAIN; R[o + i] += r[i] * GAIN; }
    marks.push(`${start.toFixed(3)} ${name}`);
  }
  return { chs: [L, R], marks };
}
let state = 7; const pick = n => { state = (state * 1103515245 + 12345) >>> 0; return state % n; };
const seqs = { reload_partial: sequence(false, pick), reload_empty: sequence(true, pick) };
for (const [name, { chs, marks }] of Object.entries(seqs)) {
  writeFileSync(new URL(name + '.wav', out), wav(chs));
  let pk = 0; for (const c of chs) for (const v of c) pk = Math.max(pk, Math.abs(v));
  console.log(`${name}: peak ${db(pk).toFixed(1)} dBFS; ${marks.join(', ')}`);
}
// every take of every sound, a quarter of a second apart
{
  const parts = []; let len = 0;
  for (const [name, takes] of Object.entries(S)) { if (name.endsWith('_mono')) continue; for (const [l, r] of takes) { parts.push([l, r]); len += l.length + SR / 4; } }
  const L = new Float32Array(len), R = new Float32Array(len); let o = 0;
  for (const [l, r] of parts) { L.set(l, o); R.set(r, o); o += l.length + SR / 4; }
  writeFileSync(new URL('reload_takes.wav', out), wav([L, R]));
}
// per sound: peak, the strongest click (above 1 kHz) against its lead, loudest 20 ms (RMS), share of energy by band
function hp(x, f) { const a = Math.exp(-2 * Math.PI * f / SR), y = new Float32Array(x.length); let p = 0, q = 0; for (let i = 0; i < x.length; i++) { q = a * (q + x[i] - p); p = x[i]; y[i] = q; } return y; }
function bands(x) {
  const n = 1 << Math.ceil(Math.log2(x.length)), re = new Float64Array(n), im = new Float64Array(n); re.set(x);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(ang * k), s = Math.sin(ang * k), a = i + k, b = a + len / 2, vr = re[b] * c - im[b] * s, vi = re[b] * s + im[b] * c; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; } }
  const edges = [0, 250, 1000, 4000, 8000, 24000], e = new Array(edges.length - 1).fill(0); let tot = 0, cen = 0;
  for (let k = 1; k < n / 2; k++) { const p = re[k] * re[k] + im[k] * im[k], f = k * SR / n; tot += p; cen += p * f; for (let b = 0; b < e.length; b++) if (f >= edges[b] && f < edges[b + 1]) e[b] += p; }
  return { pct: e.map(v => Math.round(100 * v / tot)), centroid: Math.round(cen / tot) };
}
const rows = [];
for (const [name, takes] of Object.entries(S)) {
  if (name.endsWith('_mono')) continue;
  let pk = 0, loud = 0, clickErr = 0; const lead = RELOAD_LEAD[name];
  for (const [l, r] of takes) {
    const m = new Float32Array(l.length); for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) / 2;
    for (const v of m) pk = Math.max(pk, Math.abs(v));
    const w = Math.round(0.02 * SR); for (let i = 0; i + w < m.length; i += w / 4) { let s = 0; for (let k = 0; k < w; k++) s += m[i + k] * m[i + k]; loud = Math.max(loud, Math.sqrt(s / w)); }
    if (lead != null) { const h = hp(m, 1000); let bi = 0; for (let i = 0; i < h.length; i++) if (Math.abs(h[i]) > Math.abs(h[bi])) bi = i; clickErr = Math.max(clickErr, Math.abs(bi / SR - lead)); }
  }
  const b = bands(Float32Array.from(takes[0][0], (v, i) => (v + takes[0][1][i]) / 2));
  rows.push(`${name.padEnd(16)} x${takes.length} ${(takes[0][0].length / SR).toFixed(2)} s  peak ${db(pk).toFixed(1).padStart(6)} dB  loudest 20 ms ${db(loud).toFixed(1).padStart(6)} dB  ` +
    `centroid ${String(b.centroid).padStart(5)} Hz  <250 ${String(b.pct[0]).padStart(2)}%  -1k ${String(b.pct[1]).padStart(2)}%  -4k ${String(b.pct[2]).padStart(2)}%  -8k ${String(b.pct[3]).padStart(2)}%  >8k ${String(b.pct[4]).padStart(2)}%` +
    (lead != null ? `  click ${(clickErr * 1000).toFixed(1)} ms off its lead` : ''));
}
console.log(rows.join('\n'));
console.log(`\nbaked ${Object.keys(S).length} sounds in ${bakeMs.toFixed(0)} ms`);
// spectrograms of the two sequences
for (const name of Object.keys(seqs)) {
  try {
    execFileSync(process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-y', '-i', new URL(name + '.wav', out).pathname, '-lavfi', 'showspectrumpic=s=1800x700:mode=combined:color=intensity:scale=log:fscale=log:legend=1:drange=90', new URL(name + '.png', out).pathname]);
  } catch (e) { console.warn('spectrogram skipped:', e.message.split('\n')[0]); }
}
console.log('WAVs and spectrograms written to captures/audio/ (reload_partial, reload_empty, reload_takes)');
