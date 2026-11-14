// Renders the modelled sound library outside the browser, writes one WAV per sound to captures/audio/ for listening,
// and prints measurements (length, peak, RMS, spectral centroid, attack and decay) so changes can be compared in numbers.
import { writeFileSync, mkdirSync } from 'node:fs';
import { bakeSounds } from '../src/sounds.js';

const SR = 48000, t0 = performance.now(), S = bakeSounds(SR), bakeMs = performance.now() - t0;
const out = new URL('../captures/audio/', import.meta.url); mkdirSync(out, { recursive: true });
function wav(chs) {
  const n = chs[0].length, c = chs.length, b = Buffer.alloc(44 + n * c * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * c * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(c, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * c * 2, 28); b.writeUInt16LE(c * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chs[k][i])) * 32767), 44 + (i * c + k) * 2);
  return b;
}
function fft(re, im) {
  const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; } }
}
function measure(x) {
  let peak = 0, pi = 0, sq = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) { peak = a; pi = i; } sq += a * a; }
  let end = x.length - 1; while (end > 0 && Math.abs(x[end]) < peak * 0.1) end--;                  // last sample within 20 dB of the peak
  const n = 1 << Math.ceil(Math.log2(Math.min(x.length, 32768))), re = new Float64Array(n), im = new Float64Array(n); for (let i = 0; i < Math.min(n, x.length); i++) re[i] = x[i];
  fft(re, im); let num = 0, den = 0, lo = 0, hi = 0; for (let k = 1; k < n / 2; k++) { const p = re[k] * re[k] + im[k] * im[k], f = k * SR / n; num += f * p; den += p; if (f < 250) lo += p; if (f > 4000) hi += p; }
  return { secs: x.length / SR, peak, rms: 20 * Math.log10(Math.sqrt(sq / x.length) + 1e-9), centroid: num / den, attackMs: pi / SR * 1000, t20: end / SR * 1000, lowPct: 100 * lo / den, highPct: 100 * hi / den };
}
let total = 0, count = 0; const rows = [];
for (const [name, vars] of Object.entries(S)) {
  vars.forEach((v, i) => { const chs = Array.isArray(v) ? v : [v]; total += chs[0].length * chs.length; count++; if (i < 2) writeFileSync(new URL(`${name}_${i + 1}.wav`, out), wav(chs)); });
  const m = measure(Array.isArray(vars[0]) ? vars[0][0] : vars[0]);
  rows.push(`${name.padEnd(15)} x${String(vars.length).padEnd(2)} ${m.secs.toFixed(2)} s  peak ${m.peak.toFixed(2)}  rms ${m.rms.toFixed(1).padStart(6)} dB  centroid ${String(Math.round(m.centroid)).padStart(5)} Hz  <250 Hz ${m.lowPct.toFixed(0).padStart(3)}%  >4 kHz ${m.highPct.toFixed(0).padStart(3)}%  peak at ${m.attackMs.toFixed(1).padStart(5)} ms  -20 dB by ${m.t20.toFixed(0).padStart(4)} ms`);
}
console.log(rows.join('\n'));
console.log(`\n${count} samples in ${Object.keys(S).length} sounds, ${(total / SR).toFixed(1)} s of audio, baked in ${bakeMs.toFixed(0)} ms; WAVs written to captures/audio/`);
