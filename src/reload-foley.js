// The rifle's reload, modelled from what makes each of its sounds rather than recorded. The parts are bodies of modes,
// each mode a two-pole resonator driven by a force signal: the forged aluminium lower round its magazine well, the
// upper with the barrel ringing in its extension, the free-float handguard, the bolt carrier group and the small steel
// parts, the magazine catch, the bolt catch, the receiver extension and the buffer's weights inside it, a polymer
// magazine and the column of brass in it, the sling's steel loop, a cordura pouch, the rifle's weight in the hands.
// Every contact is a half-sine force pulse as long as Hertz's law makes it for the parts' masses and speeds, which sets
// how high it reaches (a steel catch on its stop 60 us, the carrier group on the barrel extension 150 us, a magazine
// seating most of a millisecond, a gloved palm several); a surface sliding over another is a stream of micro-impacts at
// a rate set by its speed and roughness, each also heard as a grain of grit, over a rub; the buffer spring is a loop of
// dispersive allpasses, so each trip along the coils comes back as a falling chirp; cloth is a scatter of crackles under
// a swish, following how fast the arm moves. The rifle's modes are drawn once, so every sound of a reload comes from the
// same rifle; each take strikes them at its own points, with its own timings and its own magazine, and is written in
// stereo: the rifle in front and a little right, the receiver extension by the right cheek, the pouch and the support
// arm to the left. Pure JS, no WebAudio.
import { rng } from './util.js';

// When each sound of the reload plays, in seconds from the start of the reload, by the motion in weapon.js it belongs to:
// [moment, sound on a reload with rounds left, sound on an empty one] (null: none). The moment is that of the event the
// sound is timed by, and RELOAD_LEAD says how far into the sound that event falls, so the click or the slam lands on
// the frame that shows it.
export const RELOAD_BOLT = 1.56;                  // the support hand slaps the bolt catch on its way back to the handguard
export const RELOAD_CUES = [
  [0.02, 'rl_lift', 'rl_lift'],                   // the rifle comes up into the workspace and rolls
  [0.345, 'rl_release', 'rl_release'],            // a finger on the release: the catch lets go of the magazine
  [0.36, 'rl_magout', 'rl_magout_empty'],         // the support hand strips it down out of the well
  [0.57, 'rl_stow', 'rl_stow_empty'],             // into the dump pouch
  [0.71, 'rl_draw', 'rl_draw'],                   // a full one out of the magazine pouch
  [1.375, 'rl_magin', 'rl_magin'],                // up the well and seated: the catch snaps into its notch
  [1.42, 'rl_tap', null],                         // the palm taps it home and tugs to check it
  [RELOAD_BOLT, null, 'rl_bolt'],                 // the bolt catch slapped: the carrier slams forward, chambering a round
  [1.5, 'rl_settle', 'rl_settle'],                // back onto the shoulder, the support hand onto the handguard
];
// A soldier's reload (bots.js, botReloadPose in weapon.js): the magazine goes down from 0.42 s and is back up by 1.37 s.
export const BOT_RELOAD_CUES = [[0.405, 'rl_release', 'rl_release'], [0.42, 'rl_magout', 'rl_magout_empty'], [1.35, 'rl_magin', 'rl_magin'], [1.45, 'rl_tap', null], [1.62, null, 'rl_bolt']];
export const RELOAD_LEAD = { rl_release: 0.012, rl_magin: 0.115, rl_bolt: 0.032 };     // where the moment falls inside the sound (the rest: at its start)
const MONO = ['rl_release', 'rl_magout', 'rl_magout_empty', 'rl_magin', 'rl_tap', 'rl_bolt'];   // also baked as one channel, heard from other soldiers

// Each sound is levelled to this loudness (its loudest 20 ms, RMS, dBFS): the carrier slamming home loudest, then the
// magazine seating, the tap, the strip; the cloth and the pouch well under them but still there between the clicks.
const LEVEL = { rl_bolt: -14.5, rl_magin: -16, rl_tap: -18, rl_magout: -19, rl_magout_empty: -19.5, rl_release: -24, rl_draw: -28, rl_stow: -28, rl_stow_empty: -28.5, rl_lift: -32, rl_settle: -31 };

// parts: leave out the cloth or the mechanism, or scale the spring (to measure one against another; the sounds then come unlevelled)
export function reloadFoley(SR = 48000, seed = 1963, parts = { cloth: true, mech: true }) {
  const R = rng(seed), rr = (a, b) => a + (b - a) * R(), TAU = Math.PI * 2, idx = t => Math.round(t * SR), j = ms => rr(-ms, ms) / 1000;
  const expo = () => -Math.log(1 - R() * 0.9999);                                     // exponentially distributed, mean 1
  const NOISE = new Float32Array(1 << 17); for (let i = 0; i < NOISE.length; i++) NOISE[i] = R() * 2 - 1;
  const white = n => { if (n > NOISE.length) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = R() * 2 - 1; return x; } const o = (R() * (NOISE.length - n)) | 0; return NOISE.slice(o, o + n); };   // a fresh stretch of one long noise
  const biq = (x, type, f, q = 0.707) => {                                            // RBJ biquad, in place
    const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), a0 = 1 + al, a1 = -2 * c / a0, a2 = (1 - al) / a0;
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    b0 /= a0; b1 /= a0; b2 /= a0; let z1 = 0, z2 = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + z1; z1 = b1 * v - a1 * y + z2; z2 = b2 * v - a2 * y; x[i] = y; }
    return x;
  };
  const bump = (p = 0.5) => { const k = Math.log(0.5) / Math.log(p); return u => Math.sin(Math.PI * Math.min(1, Math.max(0, u)) ** k); };   // 0 -> 1 at u = p -> 0

  // ---- bodies: [frequency, decay (s), strength] per mode -------------------------------------------------------------------
  // Modes spread at even spacing over a band, as a plate's or a shell's are, their decay falling with frequency by the
  // loss in the metal and the joints, their strength tilting up the band (a thin wall radiates better towards its
  // coincidence frequency, about 5 kHz for these, and about evenly above it), and some split in two a few hertz apart,
  // as in any part that is not quite symmetric: the pairs beat as they die.
  const plate = (lo, hi, count, tau1k, tilt, loss = 0.75, split = 0.4) => {
    const m = [];
    for (let k = 0; k < count; k++) {
      const f = lo + (hi - lo) * (k + R()) / count, tau = tau1k * (1000 / f) ** loss * rr(0.65, 1.45), a = (Math.min(f, 5000) / 1000) ** tilt * rr(0.2, 1) ** 1.6;
      m.push([f, tau, a]); if (R() < split) m.push([f * (1 + rr(0.002, 0.008)), tau * rr(0.7, 1.15), a * rr(0.35, 0.9)]);
    }
    return m;
  };
  const set = list => list.map(([lo, hi, tau, a]) => [rr(lo, hi), tau * rr(0.85, 1.15), a]);
  // the barrel, held in its extension: a cantilever's bending modes, 1 : 6.27 : 17.5 : 34.4 : 56.8
  const cantilever = (f1, taus, amps) => [1.875, 4.694, 7.855, 10.996, 14.137].map((b, k) => [f1 * (b / 1.875) ** 2 * rr(0.985, 1.015), taus[k], amps[k]]);
  // the rifle, drawn once
  const RIFLE = {
    lower: [...plate(950, 11000, 18, 0.022, 0.3, 0.8), ...set([[2500, 3100, 0.035, 0.4], [4300, 4900, 0.03, 0.3], [6400, 7300, 0.025, 0.22]])],   // a few panels ring on
    upper: [...plate(1100, 12000, 16, 0.026, 0.25, 0.75), ...cantilever(rr(98, 110), [0.018, 0.032, 0.028, 0.024, 0.02], [0.12, 0.16, 0.16, 0.14, 0.1])],
    guard: [...plate(700, 7000, 9, 0.016, 0.1, 0.7), ...set([[1800, 2300, 0.045, 0.3], [3300, 3900, 0.04, 0.26], [5200, 6100, 0.035, 0.2], [7600, 8800, 0.025, 0.15]])],
    steel: plate(3600, 12500, 11, 0.01, 0.3, 0.6, 0.5),                                                      // carrier, bolt, barrel extension, pins
    catch: set([[2200, 2600, 0.008, 0.7], [3100, 3600, 0.007, 1], [4500, 5200, 0.006, 0.9], [6600, 7600, 0.005, 0.5], [9500, 11000, 0.004, 0.25]]),
    paddle: set([[2700, 3200, 0.009, 0.6], [4600, 5300, 0.007, 1], [6900, 7900, 0.005, 0.7], [9800, 11500, 0.004, 0.45]]),
    tube: set([[1500, 1750, 0.04, 0.4], [2600, 3000, 0.05, 0.6], [4300, 4800, 0.04, 0.5], [6900, 7600, 0.03, 0.35]]),
    buffer: set([[380, 450, 0.01, 1], [900, 1100, 0.008, 0.6], [1900, 2300, 0.006, 0.4]]),
    heft: set([[95, 120, 0.009, 0.3], [170, 210, 0.008, 0.28], [290, 350, 0.007, 0.24], [480, 560, 0.006, 0.18]]),   // the rifle's weight in the hands, the arms
    sling: set([[1900, 2300, 0.025, 0.7], [2900, 3400, 0.025, 1], [4700, 5300, 0.018, 0.5], [7200, 8100, 0.012, 0.25]]),
    pouch: set([[150, 220, 0.007, 0.35], [300, 380, 0.006, 0.3], [550, 700, 0.005, 0.25], [1000, 1300, 0.004, 0.2]]),
  };
  // a magazine: a polymer box, heavily damped; loaded, the column of rounds deadens it further and weighs it down
  const magazine = rounds => { const full = rounds / 30, m = plate(420, 6500, 12, 0.009 * (1 - 0.35 * full), -0.1, 0.5, 0.4); m.push([rr(230, 300) * (1 - 0.15 * full), 0.008, 0.25 + 0.15 * full]); return m; };
  const brass = () => plate(3500, 13000, 10, 0.006, 0.2, 0.5, 0.3);                     // cases knocking in the column, packed tight
  const follower = () => set([[180, 230, 0.03, 0.5], [390, 470, 0.025, 0.45], [640, 760, 0.02, 0.35], [1100, 1300, 0.015, 0.25], [1900, 2300, 0.012, 0.2]]);   // an empty magazine's spring and follower
  // each take strikes the parts at its own points
  const strike = (modes, spread = 0.6) => modes.map(([f, tau, a]) => [f, tau * rr(0.9, 1.1), a * Math.max(0.05, rr(1 - spread, 1 + spread))]);
  const struck = rounds => { const B = {}; for (const k in RIFLE) B[k] = strike(RIFLE[k]); B.mag = strike(magazine(rounds)); B.brass = strike(brass()); B.follower = strike(follower()); return B; };
  const PAN = { lower: 0.12, upper: 0.1, guard: -0.05, steel: 0.1, catch: 0.2, paddle: 0.02, tube: 0.38, buffer: 0.38, heft: 0.05, sling: 0.25, pouch: -0.4, mag: 0.1, brass: 0.1, follower: 0.1 };

  // The response of a body to a force signal: every mode driven by it, run until it has died 48 dB past the last push.
  // Each mode reaches the ear by its own path over the part, up to a quarter of a millisecond apart, so they do not all
  // start in phase as one needle; and as a contact moves over the part (a magazine riding up the well) it couples into
  // each mode more and then less, so each mode's drive wanders at its own few hertz instead of ringing steady as a bell.
  const ring = (modes, f) => {
    const n = f.length, out = new Float32Array(n); let i0 = 0, i1 = n - 1;
    while (i0 < n && f[i0] === 0) i0++; while (i1 > i0 && f[i1] === 0) i1--; if (i0 >= n) return out;
    for (const [fr, tau, a] of modes) {
      if (fr > SR * 0.45) continue;
      const w = TAU * fr / SR, r = Math.exp(-1 / (tau * SR)), c1 = 2 * r * Math.cos(w), c2 = r * r, g = a * Math.sin(w), d = (R() * 0.00025 * SR) | 0, end = Math.min(n - d, i1 + Math.ceil(tau * SR * 5.5));
      const wr = TAU * rr(3, 16) * 64 / SR, ph = R() * TAU;
      let y1 = 0, y2 = 0;
      for (let b = i0; b < end; b += 64) {
        const gb = g * (1 + 0.7 * Math.sin(ph + wr * (b >> 6))), e = Math.min(end, b + 64);
        for (let i = b; i < e; i++) { const y = c1 * y1 - c2 * y2 + gb * f[i]; y2 = y1; y1 = y; out[i + d] += y; }
      }
    }
    return out;
  };
  // a half-sine contact pulse of length tc and area a at time t (over len samples, sin(pi (i + 0.5) / len) sums to 1 / sin(pi / 2 len))
  const pulse = (f, t, a, tc) => {
    const len = Math.max(1, Math.round(tc * SR)), o = idx(t);
    if (len < 2) { if (o >= 0 && o < f.length) f[o] += a; return; }
    const g = a * Math.sin(Math.PI / (2 * len));
    for (let i = 0; i < len; i++) { const p = o + i; if (p >= 0 && p < f.length) f[p] += g * Math.sin(Math.PI * (i + 0.5) / len); }
  };

  // ---- one take: a force signal per body, cloth and air written straight into the two channels ---------------------------
  const scene = secs => {
    const n = idx(secs), F = {}, L = new Float32Array(n), Rt = new Float32Array(n);
    const put = (x, pan, g = 1, at = 0) => { const o = idx(at), gl = g * Math.min(1, 1 - pan), gr = g * Math.min(1, 1 + pan); for (let i = 0; i < x.length && o + i < n; i++) { L[o + i] += x[i] * gl; Rt[o + i] += x[i] * gr; } };
    const S = {
      n, put,
      f: b => (F[b] ||= new Float32Array(n)),
      // a contact at t: area a, tc long, into each listed body by how well it takes it
      hit(t, a, tc, into) { for (const b in into) if (into[b]) pulse(S.f(b), t, a * into[b], tc); },
      // A surface sliding over another for dur s at speed v(u) m/s: micro-impacts at rough per metre, each about tc long,
      // driving the bodies, each also heard straight from the contact as a fraction of a millisecond of grit; over a rub.
      slide(t, dur, v, rough, a, into, tc = 0.00012, rub = 0.25, grit = 1) {
        const pan = PAN[Object.keys(into)[0]] ?? 0;
        for (let s = 0; ;) {
          const sp = Math.max(0.02, v(Math.min(1, s / dur)));
          s += expo() / (rough * sp); if (s >= dur) break;
          const amp = a * sp * expo(), len = tc * rr(0.6, 1.7);
          for (const b in into) if (into[b]) pulse(S.f(b), t + s, amp * into[b], len);
          if (grit > 0 && parts.mech) { const m = idx(rr(0.0002, 0.0006)) + 2, x = biq(white(m), 'bp', rr(2500, 7000), 1.2); for (let i = 0; i < m; i++) x[i] *= Math.sin(Math.PI * i / m); put(x, pan, amp * grit * 1.2, t + s); }
        }
        if (rub > 0) {
          const m = idx(dur), x = biq(biq(white(m), 'lp', 2500), 'hp', 150), o = idx(t);
          for (let i = 0; i < m; i += 64) { const e = v(i / m); for (let k = i; k < Math.min(m, i + 64); k++) x[k] *= e; }
          for (const b in into) { if (!into[b]) continue; const fb = S.f(b), g = a * rub * into[b]; for (let i = 0; i < m && o + i < n; i++) fb[o + i] += x[i] * g; }
        }
      },
      // Cloth moving for dur s at speed v(u) (0..1): a rub of band noise in each channel whose strength follows the arm's
      // speed, broken up into flurries of 5-25 ms as the layers catch and slip, and over it the crackles of the weave, a
      // millisecond or a few of narrower noise each, placed a little apart in the stereo field. Nylon and cordura crackle
      // more (crisp); the envelope is taken every 64 samples.
      cloth(t, dur, v, { rate = 900, gain = 1, lo = 400, hi = 3600, pan = 0, spread = 0.3, swish = 0.35, sf = 1100, crisp = 1 } = {}) {
        if (!parts.cloth) return; gain *= 1.8;
        const m = idx(dur), o = idx(t), env = new Float32Array(m), mod = new Float32Array(m).fill(0.3);
        for (let i = 0; i < m; i += 64) env.fill(Math.max(0, v(i / m)) ** 1.5, i, Math.min(m, i + 64));
        for (let s = 0; ;) { s += expo() / 60; if (s >= dur) break; const a = idx(s), w = idx(rr(0.005, 0.025)), h = rr(0.3, 1.4); for (let i = 0; i < w && a + i < m; i++) mod[a + i] += h * Math.sin(Math.PI * i / w); }
        if (swish > 0) for (const [ch, side] of [[L, -1], [Rt, 1]]) {
          const x = biq(biq(biq(white(m), 'bp', sf * rr(0.85, 1.15), 0.6), 'lp', hi * 1.2, 0.6), 'hp', 200), g = swish * gain * 0.05 * Math.min(1, 1 + side * pan);
          for (let i = 0; i < m && o + i < n; i++) ch[o + i] += x[i] * env[i] * mod[i] * g;
        }
        for (let s = 0; ;) {
          const sp = Math.max(0.01, env[Math.min(m - 1, idx(s))]);
          s += expo() / (rate * crisp * sp + 4); if (s >= dur) break;
          const len = idx(rr(0.0006, 0.0035)), x = biq(white(len), 'bp', Math.exp(rr(Math.log(lo), Math.log(hi))), rr(0.7, 2));
          for (let i = 0; i < len; i++) x[i] *= Math.sin(Math.PI * i / len);
          put(x, pan + rr(-spread, spread), gain * env[Math.min(m - 1, idx(s))] * Math.exp(1.4 * (R() + R() - 1)) * 0.05, t + s);
        }
      },
      // the air squeezed out between a glove and a flat face it slaps
      slap(t, gain, pan) { if (!parts.mech) return; const m = idx(0.006), x = biq(biq(white(m), 'bp', rr(1800, 2800), 0.7), 'hp', 700); for (let i = 0; i < m; i++) x[i] *= Math.exp(-i / (0.0011 * SR)); put(x, pan, gain, t); },
      // the buffer spring rung by the force signal e: the trip along the coils through a chain of first-order allpasses
      // (low frequencies held back longest, so every trip returns as a falling chirp) and back round a damped loop
      spring(e, { stages = 110, a = -0.72, loop = 0.014, fb = 0.62, lp = 6500, lo = 700, hi = 7000, until = n } = {}) {
        const out = new Float32Array(n), D = Math.max(1, idx(loop)), line = new Float32Array(D), z = new Float64Array(stages), al = 1 - Math.exp(-TAU * lp / SR);
        let w = 0, s1 = 0;
        for (let i = 0; i < Math.min(n, until); i++) {
          let x = e[i] + line[w] * fb;
          for (let k = 0; k < stages; k++) { const y = a * x + z[k]; z[k] = x - a * y; x = y; }
          s1 += (x - s1) * al; line[w] = s1; w = w + 1 === D ? 0 : w + 1; out[i] = s1;
        }
        return biq(biq(out, 'hp', lo, 0.6), 'lp', hi, 0.6);
      },
      // ring every body that was touched, place it, and hand back the two channels
      mix(B, pans = PAN) { if (parts.mech) for (const b in F) put(ring(B[b], F[b]), pans[b] ?? 0); return [L, Rt]; },
    };
    return S;
  };

  // ---- the reload, event by event (t = 0 at the start of each sound) ---------------------------------------------------------
  // The rifle comes up into the workspace and rolls the well towards the support hand: both sleeves, the sling's loop
  // knocking on its mount as the rifle turns, the rounds shifting in the column, the rifle stopping.
  const lift = () => {
    const S = scene(0.45), B = struck(rr(5, 25));
    S.cloth(0, 0.34, bump(0.35), { rate: 1400, gain: 0.9, pan: -0.3, spread: 0.35 });
    S.cloth(0.01, 0.3, bump(0.4), { rate: 900, gain: 0.6, pan: 0.35, spread: 0.25 });
    let t = rr(0.15, 0.2); for (let k = 0, m = 2 + (R() * 2 | 0); k < m; k++) { S.hit(t, rr(0.012, 0.03) * (1 - k * 0.25), 0.0001, { sling: 1 }); t += rr(0.02, 0.06); }
    for (let k = 0; k < 2; k++) S.hit(rr(0.18, 0.26), rr(0.01, 0.02), 0.0001, { brass: 1, mag: 0.4 });
    S.hit(rr(0.2, 0.24), 0.05, 0.004, { heft: 0.6, lower: 0.15 });
    return S.mix(B);
  };
  // The release pressed: a fingertip on the button, the catch dragged out of the magazine's notch and clicking off its
  // edge, the magazine dropping a millimetre onto the waiting hand.
  const release = () => {
    const S = scene(0.2), B = struck(rr(0, 25)), click = RELOAD_LEAD.rl_release;
    S.hit(0, 0.03, 0.003, { catch: 0.4, lower: 0.5 });
    S.slide(0.002, click - 0.003, () => 0.05, 20000, 0.0015, { catch: 1, lower: 0.3 });
    S.hit(click, 0.12, 0.0001, { catch: 1, lower: 0.5, mag: 0.2 });
    S.hit(click + rr(0.006, 0.014), 0.07, 0.0004, { mag: 0.7, lower: 0.5, brass: 0.3 });
    return S.mix(B);
  };
  // Stripped out of the well: the hand takes its weight, it scrapes down the well and its feed lips clear the bottom edge,
  // the rounds shift in it (an empty one's follower and spring jump instead), the finger lets the release go and the catch
  // springs back to its stop, the glove on the polymer, the support arm sweeping down and away.
  const magout = rounds => () => {
    const S = scene(0.42), B = struck(rounds), exit = 0.0325 + j(2);
    S.hit(0, 0.07, 0.0004, { mag: 0.8, lower: 0.5 });
    S.slide(0, exit, u => 0.25 + 0.95 * u, 6000, 0.005, { mag: 0.7, lower: 0.55, brass: rounds ? 0.12 : 0 });
    S.hit(exit, 0.16, 0.0002, { mag: 0.9, lower: 0.6, brass: rounds ? 0.25 : 0 });
    if (rounds) for (let k = 0, m = 2 + (R() * 3 | 0); k < m; k++) S.hit(exit + rr(0.002, 0.03), rr(0.015, 0.05), 0.00008, { brass: 1, mag: 0.3 });
    else S.hit(exit + rr(0.001, 0.004), 0.06, 0.001, { follower: 1, mag: 0.3 });
    S.hit(rr(0.06, 0.095), 0.09, 0.00006, { catch: 1, lower: 0.5 });
    S.slide(0, 0.05, () => 0.2, 3000, 0.0012, { mag: 0.5 }, 0.0008, 0.6);
    S.cloth(0.01, 0.38, bump(0.3), { rate: 1200, gain: 0.8, pan: -0.3, spread: 0.3 });
    return S.mix(B);
  };
  // Into the dump pouch: polymer pushed down the cordura, bottoming out, the rounds (or the empty one's spring) jolting.
  const stow = rounds => () => {
    const S = scene(0.34), B = struck(rounds), bottom = 0.07 + j(8);
    S.cloth(0, bottom + 0.01, u => 0.4 + 0.6 * u, { rate: 1500, gain: 0.9, lo: 500, hi: 5000, pan: -0.42, spread: 0.12, swish: 0.6, sf: 1400, crisp: 1.2 });
    S.slide(0, bottom, () => 0.6, 9000, 0.0016, { mag: 0.6, pouch: 0.5 }, 0.0006, 0.08, 0.5);
    S.hit(bottom, 0.25, 0.004, { mag: 0.5, pouch: 1, heft: 0.2 });
    if (rounds) for (let k = 0; k < 3; k++) S.hit(bottom + rr(0.001, 0.012), rr(0.01, 0.03), 0.0001, { brass: 1 });
    else S.hit(bottom + rr(0.001, 0.003), 0.04, 0.001, { follower: 1 });
    S.cloth(0.02, 0.3, bump(0.5), { rate: 700, gain: 0.5, pan: -0.3, spread: 0.3 });
    return S.mix(B, { ...PAN, mag: -0.4, brass: -0.4, follower: -0.4 });
  };
  // A full one out of the magazine pouch: the thumb pushes the bungee off its top and it slaps back on the flap, the
  // magazine dragged up out of the cordura, clear, its rounds ticking, the arm bringing it up to the well.
  const draw = () => {
    const S = scene(0.56), B = struck(30), off = 0.02 + j(5), clear = 0.13 + j(10);
    S.hit(off, 0.12, 0.003, { pouch: 1, mag: 0.3 });
    S.cloth(off - 0.005, 0.03, bump(0.3), { rate: 3000, gain: 0.8, lo: 500, hi: 3500, pan: -0.42, spread: 0.1, swish: 0.7, sf: 1000 });
    S.cloth(off, clear - off, bump(0.45), { rate: 1800, gain: 0.85, lo: 500, hi: 5000, pan: -0.4, spread: 0.12, swish: 0.65, sf: 1400, crisp: 1.2 });
    S.slide(off, clear - off, bump(0.5), 9000, 0.0016, { mag: 0.6, pouch: 0.4 }, 0.0006, 0.08, 0.5);
    S.hit(clear, 0.05, 0.0008, { mag: 0.6, pouch: 0.3 });
    for (let k = 0; k < 2; k++) S.hit(clear + rr(0.001, 0.01), rr(0.01, 0.025), 0.0001, { brass: 1 });
    S.cloth(clear - 0.04, 0.45, bump(0.3), { rate: 800, gain: 0.55, pan: -0.15, spread: 0.3 });
    return S.mix(B, { ...PAN, mag: -0.38, brass: -0.38 });
  };
  // Seated: the feed lips and the top round's nose find the flare, the magazine scrapes up the well, shoving the catch
  // aside with its flank; its shoulders hit the stop, front edge then back, the catch snaps into the notch, the column
  // of rounds jolts and the magazine settles back onto the catch. The palm pushes on the floorplate all the way.
  const magin = () => {
    const S = scene(0.5), B = struck(30), seat = RELOAD_LEAD.rl_magin, ride = seat - rr(0.018, 0.026);
    S.hit(0, 0.08, 0.00015, { lower: 0.6, brass: 0.5, mag: 0.4 });
    S.slide(0, seat - 0.003, u => 0.35 + 0.45 * Math.sin(Math.PI * 0.8 * u), 6000, 0.0045, { mag: 0.7, lower: 0.6, brass: 0.15 });
    S.hit(ride, 0.05, 0.0001, { catch: 1, lower: 0.3 }); S.slide(ride, seat - ride - 0.002, () => 0.5, 4000, 0.002, { catch: 0.6, mag: 0.4 });
    S.hit(seat, 0.6, 0.0006, { mag: 0.9, lower: 1, upper: 0.35, heft: 0.4, guard: 0.15 });
    S.hit(seat + rr(0.0006, 0.0016), 0.4, 0.0007, { mag: 0.7, lower: 0.7 });
    S.hit(seat + rr(0.0028, 0.0055), 0.42, 0.00012, { catch: 1, lower: 0.7, mag: 0.25 });
    for (let k = 0, m = 3 + (R() * 3 | 0); k < m; k++) S.hit(seat + rr(0.0008, 0.009), rr(0.02, 0.06), 0.00008, { brass: 1, mag: 0.3 });
    S.hit(seat + rr(0.012, 0.02), 0.06, 0.0002, { catch: 0.7, lower: 0.4, mag: 0.3 });
    S.slide(0, seat, () => 0.15, 2500, 0.001, { mag: 0.4 }, 0.002, 0.7);
    S.cloth(0, 0.2, bump(0.4), { rate: 700, gain: 0.45, pan: -0.2, spread: 0.3 });
    return S.mix(B);
  };
  // The palm taps it home (the glove slapping the floorplate, the magazine knocked onto its stop, the rounds and the
  // catch rattling) and then tugs it to check: pulled down onto the catch.
  const tap = () => {
    const S = scene(0.4), B = struck(30), tug = rr(0.09, 0.12);
    S.hit(0, 0.55, rr(0.003, 0.005), { mag: 0.9, heft: 0.4, lower: 0.5, upper: 0.25 });
    S.slap(0, 0.05, 0.05);
    S.hit(rr(0.0008, 0.0016), 0.3, 0.0004, { lower: 0.8, mag: 1 });
    for (let k = 0, m = 3 + (R() * 2 | 0); k < m; k++) S.hit(rr(0.001, 0.008), rr(0.015, 0.04), 0.00008, { brass: 1 });
    S.hit(rr(0.003, 0.006), 0.05, 0.0001, { catch: 1, lower: 0.3 });
    S.slide(tug - 0.01, 0.01, () => 0.1, 8000, 0.002, { mag: 0.6, catch: 0.3 }, 0.0002, 0.3);
    S.hit(tug, 0.06, 0.00012, { catch: 1, lower: 0.6, mag: 0.3 });
    S.cloth(0.04, 0.32, bump(0.35), { rate: 900, gain: 0.55, pan: -0.25, spread: 0.3 });
    return S.mix(B);
  };
  // The bolt catch slapped: the heel of the hand on the paddle, its tooth leaving the carrier; the carrier group runs
  // forward under the buffer spring (the buffer sliding in its tube, the coils rubbing), the bolt strips the top round
  // over the feed lips and up the ramp and the next round rises; it slams home in the barrel extension, the bolt turns
  // and locks a few milliseconds later, the buffer's weights catch up, the paddle springs back, and the spring twangs
  // in the tube while the barrel and the upper ring out.
  const bolt = () => {
    const S = scene(0.7), B = struck(30), slam = RELOAD_LEAD.rl_bolt, go = 0.006 + j(1);
    S.hit(0, 0.25, 0.0012, { paddle: 0.6, lower: 0.5, heft: 0.4 });
    S.hit(rr(0.003, 0.005), 0.12, 0.00007, { paddle: 1, lower: 0.4, steel: 0.3 });
    S.slide(go, slam - go, u => 0.6 + 2.4 * u, 1800, 0.006, { steel: 0.4, upper: 0.5, tube: 0.4 }, 0.00008, 0.4);
    S.slide(slam - 0.014, 0.011, () => 2.5, 5000, 0.008, { brass: 1, mag: 0.4, steel: 0.4 }, 0.00006, 0.3);
    S.hit(slam - 0.009, 0.04, 0.0002, { brass: 0.6, mag: 0.5 });
    S.hit(slam, 1, 0.00015, { steel: 1, upper: 1, lower: 0.45, heft: 1, guard: 0.25 });
    S.hit(slam + rr(0.0005, 0.0013), 0.55, 0.00012, { steel: 0.8, upper: 0.7 });
    S.hit(slam + rr(0.0022, 0.0042), 0.45, 0.00009, { steel: 1, upper: 0.5 });
    let tb = slam + rr(0.0015, 0.0025); for (const a of [0.35, 0.18, 0.08]) { S.hit(tb, a, 0.0006, { buffer: 1, tube: 0.6, heft: 0.3 }); tb += rr(0.003, 0.007); }
    S.hit(slam + rr(0.016, 0.024), 0.04, 0.00008, { paddle: 1, lower: 0.2 });
    S.cloth(0.04, 0.3, bump(0.3), { rate: 800, gain: 0.5, pan: -0.25, spread: 0.3 });
    const e = new Float32Array(S.n), o = idx(go), m = idx(slam) - o, x = biq(white(m), 'hp', 1500);
    for (let i = 0; i < m; i++) e[o + i] += x[i] * (i / m) * 0.03;
    e[idx(slam)] += 0.6;
    if (parts.mech) S.put(S.spring(e, { until: idx(slam + 0.32) }), 0.32, 19 * (parts.spring ?? 1));      // (well under the slam, ringing on past the rifle)
    return S.mix(B);
  };
  // Back onto the shoulder: both sleeves, the support hand closing on the handguard, the stock back into the shoulder
  // pocket of the vest, the sling's loop.
  const settle = () => {
    const S = scene(0.65), B = struck(30), grab = 0.44 + j(10), butt = grab + rr(0.02, 0.05);
    S.cloth(0, 0.5, bump(0.45), { rate: 1300, gain: 0.85, pan: -0.25, spread: 0.35 });
    S.cloth(0.05, 0.42, bump(0.5), { rate: 800, gain: 0.55, pan: 0.3, spread: 0.25 });
    S.hit(grab, 0.2, 0.003, { guard: 0.8, heft: 0.6, upper: 0.2 }); S.hit(grab + rr(0.0005, 0.002), 0.03, 0.0001, { guard: 1 });
    S.hit(butt, 0.15, 0.006, { heft: 0.5, pouch: 0.6 });
    S.cloth(butt - 0.005, 0.05, bump(0.25), { rate: 2000, gain: 0.6, lo: 500, hi: 3500, pan: 0.3, spread: 0.1, swish: 0.5, sf: 1000 });
    S.hit(butt + rr(0.01, 0.04), 0.02, 0.00008, { sling: 1 });
    return S.mix(B, { ...PAN, pouch: 0.3 });
  };

  // ---- takes ------------------------------------------------------------------------------------------------------------------
  const EVENTS = { rl_lift: [lift, 4], rl_release: [release, 4], rl_magout: [() => magout(rr(5, 25) | 0)(), 4], rl_magout_empty: [magout(0), 4],
    rl_stow: [() => stow(rr(5, 25) | 0)(), 4], rl_stow_empty: [stow(0), 4], rl_draw: [draw, 4], rl_magin: [magin, 5], rl_tap: [tap, 4], rl_bolt: [bolt, 5], rl_settle: [settle, 4] };
  const lib = {}, loud = x => { const w = idx(0.02); let m = 1e-9; for (let i = 0; i + w <= x.length; i += w >> 2) { let q = 0; for (let k = 0; k < w; k++) q += x[i + k] * x[i + k]; m = Math.max(m, q / w); } return Math.sqrt(m); };
  for (const [name, [make, count]] of Object.entries(EVENTS)) {
    const takes = lib[name] = Array.from({ length: count }, make), mono = takes.map(([l, r]) => l.map((v, i) => (v + r[i]) * 0.5));
    if (!parts.cloth || !parts.mech) continue;
    // levelled as a set (the takes keep their differences), the needle of each click rounded off the way a microphone's
    // preamp would at about 13 dB over the sound's loudest moment, and faded out at the end
    const k = 10 ** (LEVEL[name] / 20) / (mono.reduce((a, m) => a + loud(m), 0) / count), top = 10 ** (13 / 20) * 10 ** (LEVEL[name] / 20);
    for (const chs of takes) for (const ch of chs) { for (let i = 0; i < ch.length; i++) { const v = ch[i] * k; ch[i] = Math.abs(v) < 0.2 * top ? v : top * Math.tanh(v / top); } const f = Math.min(ch.length, idx(0.01)); for (let i = 0; i < f; i++) ch[ch.length - 1 - i] *= i / f; }
  }
  for (const name of MONO) lib[name + '_mono'] = lib[name].map(([l, r]) => l.map((v, i) => (v + r[i]) * 0.5));
  return lib;
}
