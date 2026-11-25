// A civilian's face. Ara exports 34 shapes with every person (blink, wide, squint, brows, jaw, smile, frown, pucker,
// press, stretch, sneer, upper lip, and 14 visemes) and bones for the jaw and both eyes. Nothing here is a fixed pose:
// the face is always a blend of expressions weighted by what the person feels, with the living things on top:
//   - blinking (every few seconds, more often when anxious, held off when the eyes are wide with fear, and at once at a
//     bang or a large shift of the gaze), the lids following the eyes down and up;
//   - the eyes themselves: they go to what is looked at before the head does, rest in small jumps round it, and dart
//     when the person panics;
//   - speech: the mouth follows the voice that is playing (a timeline of visemes and loudness made from the recording,
//     tools/build-civ-voices.py; without one, the syllables are made up at a talking rhythm), the brows lift on
//     stressed syllables, the head nods;
//   - a jaw that trembles with fear and lips that tremble before tears, sobs that come in bursts.
// A clip that acts with the face (Ara's laugh, cry, talk) is used for the mouth when no voice is driving it.
import { clamp, damp, lerp } from './util.js';

export const SHAPES = ['eyeBlinkLeft', 'eyeBlinkRight', 'eyeWideLeft', 'eyeWideRight', 'eyeSquintLeft', 'eyeSquintRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft',
  'browOuterUpRight', 'jawOpen', 'mouthSmile', 'mouthFrown', 'mouthPucker', 'mouthPress', 'mouthStretch', 'noseSneerLeft', 'noseSneerRight', 'mouthUpperUp',
  'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD', 'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'];
const S = Object.fromEntries(SHAPES.map((n, i) => [n, i])), N = SHAPES.length, VIS0 = S.viseme_PP;
const both = (o, name, v) => { o[S[name + 'Left']] = v; o[S[name + 'Right']] = v; };
const preset = def => { const a = new Float32Array(N); for (const [k, v] of Object.entries(def)) { if (S[k] != null) a[S[k]] = v; else both(a, k, v); } return a; };
// What each feeling does to the face at full strength.
export const EXPRESSIONS = {
  happy: preset({ mouthSmile: 0.78, eyeSquint: 0.42, browOuterUp: 0.12, mouthUpperUp: 0.12 }),
  amused: preset({ mouthSmile: 0.4, eyeSquint: 0.2 }),
  talk: preset({ browInnerUp: 0.06, mouthSmile: 0.1 }),
  surprised: preset({ eyeWide: 0.56, browInnerUp: 0.62, browOuterUp: 0.36, jawOpen: 0.22 }),
  wary: preset({ browDown: 0.35, browInnerUp: 0.35, eyeSquint: 0.2, mouthPress: 0.45 }),
  fear: preset({ eyeWide: 0.28, browInnerUp: 0.58, browDown: 0.12, mouthStretch: 0.22, jawOpen: 0.09, mouthPress: 0.12 }),
  panic: preset({ eyeWide: 0.46, browInnerUp: 0.67, browOuterUp: 0.19, jawOpen: 0.34, mouthStretch: 0.31, mouthUpperUp: 0.13 }),
  pain: preset({ eyeSquint: 0.64, eyeBlink: 0.25, browDown: 0.52, browInnerUp: 0.22, noseSneer: 0.29, mouthStretch: 0.23, mouthUpperUp: 0.19, jawOpen: 0.07 }),
  cry: preset({ browInnerUp: 0.6, browDown: 0.18, eyeSquint: 0.38, eyeBlink: 0.16, mouthFrown: 0.5, mouthStretch: 0.15, jawOpen: 0.09, noseSneer: 0.12 }),
  relief: preset({ eyeBlink: 0.3, browInnerUp: 0.35, mouthSmile: 0.22, jawOpen: 0.1 }),
  effort: preset({ jawOpen: 0.22, browDown: 0.2, noseSneer: 0.2 }),          // running hard, mouth open for air
};
const FEELINGS = Object.keys(EXPRESSIONS);
// how fast a shape may come on and go off, per second (the eyes and brows jump with fright; a face lets go slowly)
const RISE = new Float32Array(N).fill(9), FALL = new Float32Array(N).fill(3.6);
for (const n of ['eyeWideLeft', 'eyeWideRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'jawOpen']) RISE[S[n]] = 20;
for (let i = VIS0; i < N; i++) { RISE[i] = 26; FALL[i] = 19; }
RISE[S.jawOpen] = 24; FALL[S.jawOpen] = 12;
const SYLLABLES = [[29, 23], [30, 26], [32, 27], [31, 20], [29, 28], [33, 24], [30, 22], [32, 21], [29, 27], [31, 25]].map(([v, c]) => [v - 20, c - 20]);   // a vowel and the consonant before it, as viseme numbers

export class Face {
  constructor(inst, anim, rnd, expressive = 1) {
    this.w = inst.face; this.anim = anim; this.rnd = rnd; this.k = expressive;
    this.mood = Object.fromEntries(FEELINGS.map(f => [f, 0])); this.target = new Float32Array(N); this.cur = new Float32Array(N);
    this.blinkT = 1 + rnd() * 3; this.blink = 0; this.blinkPhase = 0; this.again = false;
    this.gazeYaw = 0; this.gazePitch = 0; this.sacT = rnd(); this.sacX = 0; this.sacY = 0; this.eyeYaw = 0; this.eyePitch = 0;
    this.line = null; this.speech = 0; this.vis = new Float32Array(14); this.syl = 0; this.sylT = 0; this.sylV = 0; this.sylC = 0; this.brow = 0; this.nod = 0;
    this.sob = 0; this.sobT = 2; this.jolt = 0; this.t = rnd() * 10; this.loud = 0;
  }
  // A fright: the eyes shut for an instant and come open wide.
  startle(k = 1) { this.blinkPhase = 1; this.blink = 1; this.jolt = Math.max(this.jolt, k); }
  // The voice that is now playing: { dur, step, env: Uint8Array, vis: Uint8Array } (from the recording), or { dur, kind } alone.
  speak(line) { this.line = line ? { ...line, t: 0 } : null; this.sylT = 0; }
  get speaking() { return !!this.line; }

  update(dt, { stress = 0, eyeYaw = 0, eyePitch = 0 } = {}) {
    const m = this.mood, T = this.target, R = this.rnd; this.t += dt;
    T.fill(0);
    // Several feelings can be active together. Treat their weights as a shared blend.
    let total = 0;
    for (const f of FEELINGS) total += m[f];
    const scale = Math.min(this.k, 1 / Math.max(total, 0.01));
    for (const f of FEELINGS) {
      const weight = m[f] * scale;
      if (weight <= 0.004) continue;
      const pose = EXPRESSIONS[f];
      for (let i = 0; i < N; i++) T[i] += pose[i] * weight;
    }
    this.jolt = Math.max(0, this.jolt - dt * 2.2);
    if (this.jolt > 0.01) { const e = EXPRESSIONS.surprised; for (let i = 0; i < N; i++) if (e[i]) T[i] = Math.max(T[i], e[i] * this.jolt); }
    // ---- the voice ------------------------------------------------------------------------------------------------------
    const L = this.line, vis = this.vis; let open = 0, speak = 0;
    for (let i = 0; i < 14; i++) vis[i] = 0;
    if (L) {
      L.t += dt;
      if (L.t >= L.dur) this.line = null;
      else if (L.env) {                                                         // from the recording
        const f = L.t / L.step, i = Math.min(L.env.length - 1, Math.floor(f)), j = Math.min(L.env.length - 1, i + 1), a = f - i;
        const e = lerp(L.env[i], L.env[j], a) / 255; open = e; speak = e > 0.06 ? 1 : 0.3;
        const v0 = L.vis[i], v1 = L.vis[j]; if (v0) vis[v0 - 1] += (1 - a) * Math.min(1, 0.35 + e); if (v1) vis[v1 - 1] += a * Math.min(1, 0.35 + e);
      } else if (L.kind === 'scream') { open = 0.85 + Math.sin(this.t * 9) * 0.08; vis[9] = 0.9; speak = 1; }
      else if (L.kind === 'gasp') { const k = Math.sin(Math.min(1, L.t / L.dur) * Math.PI); open = 0.5 * k; vis[12] = 0.6 * k; speak = 0.6; }
      else {                                                                    // made-up syllables at a talking rhythm
        this.sylT -= dt;
        if (this.sylT <= 0) { const s = SYLLABLES[(R() * SYLLABLES.length) | 0]; this.sylV = s[0]; this.sylC = s[1]; this.syl = 0; this.sylDur = 0.15 + R() * 0.13; this.sylT = this.sylDur + (R() < 0.16 ? 0.12 + R() * 0.3 : 0); this.stress = R() < 0.3; if (this.stress) { this.brow = 1; this.nod = 1; } }
        this.syl += dt;
        const p = this.syl / this.sylDur;
        if (p < 1) { const c = Math.max(0, 1 - p * 3.4), v = Math.sin(clamp((p - 0.18) / 0.82, 0, 1) * Math.PI); vis[this.sylC] = c * 0.9; vis[this.sylV] = v * (this.stress ? 1 : 0.75); open = v * (this.stress ? 0.5 : 0.32); }
        speak = 1;
      }
      this.loud = open;
    } else if (this.anim.faceClip) {                                            // the clip's own acting (Ara's laugh, cry, talk)
      const c = this.anim.faceClip, f = clamp(this.anim.faceT / c.dur, 0, 1) * (c.keys - 1), i = Math.min(c.keys - 1, Math.round(f)), o = i * N;
      for (let k = 2; k < N; k++) { const v = c.face[o + k] / 255; if (v > 0.02) T[k] = Math.max(T[k] * 0.5, v); }
      speak = 0.4;
    }
    this.speech = damp(this.speech, speak, 10, dt);
    if (this.speech > 0.02) {                                                   // a mouth that is saying something holds less of an expression
      const keep = 1 - 0.55 * this.speech;
      for (const n of [S.mouthSmile, S.mouthFrown, S.mouthStretch, S.mouthPress, S.mouthPucker]) T[n] *= keep;
      if (L) { T[S.jawOpen] = Math.max(T[S.jawOpen] * 0.4, open * 0.62); for (let i = 0; i < 14; i++) T[VIS0 + i] = Math.min(0.7, vis[i] * (1 - open * 0.32)); }
      this.brow = Math.max(0, this.brow - dt * 5); this.nod = Math.max(0, this.nod - dt * 6);
      T[S.browInnerUp] += this.brow * 0.22; T[S.browOuterUpLeft] += this.brow * 0.16; T[S.browOuterUpRight] += this.brow * 0.16;
    }
    // ---- trembling, sobbing -------------------------------------------------------------------------------------------------
    const afraid = Math.max(m.fear, m.panic * 0.8), tears = m.cry;
    if (afraid > 0.15 && !L) { const tr = (Math.sin(this.t * 19) * 0.5 + Math.sin(this.t * 13.3) * 0.5) * afraid; T[S.jawOpen] += 0.05 * afraid + tr * 0.025; T[S.mouthStretch] += tr * 0.035; }
    if (tears > 0.15) {
      const tr = Math.sin(this.t * 38) * 0.5 + Math.sin(this.t * 23.7 + 1) * 0.5;
      T[S.mouthPress] += Math.max(0, tr) * 0.3 * tears; T[S.mouthPucker] += Math.max(0, -tr) * 0.18 * tears;
      this.sobT -= dt; if (this.sobT <= 0) { this.sobT = 0.5 + R() * (R() < 0.3 ? 2.6 : 0.5); this.sob = 1; }
      this.sob = Math.max(0, this.sob - dt * 4.5);
      T[S.jawOpen] += this.sob * 0.3 * tears; T[S.eyeSquintLeft] += this.sob * 0.3; T[S.eyeSquintRight] += this.sob * 0.3; T[S.mouthUpperUp] += this.sob * 0.2 * tears;
    } else this.sob = 0;
    this.anim.tremble = damp(this.anim.tremble, clamp(afraid * 0.9 + tears * 0.4 + m.pain * 0.5, 0, 1), 4, dt);
    // ---- the eyes ---------------------------------------------------------------------------------------------------------
    this.sacT -= dt;
    if (this.sacT <= 0) {
      const dart = m.panic > 0.4 || (m.fear > 0.6 && stress > 0.5);
      this.sacT = dart ? 0.14 + R() * 0.4 : 0.5 + R() * 2.2;
      const amp = dart ? 0.12 : R() < 0.2 ? 0.065 : 0.025;
      const ox = (R() - 0.5) * 2 * amp, oy = (R() - 0.5) * amp;
      if (Math.abs(ox - this.sacX) > 0.18 && this.blinkPhase === 0) this.blinkT = 0;       // a large shift of the gaze comes with a blink
      this.sacX = ox; this.sacY = oy;
    }
    const wantYaw = clamp(eyeYaw + this.sacX, -0.33, 0.33), wantPitch = clamp(eyePitch + this.sacY, -0.26, 0.24);
    this.eyeYaw += clamp(wantYaw - this.eyeYaw, -dt * 9, dt * 9); this.eyePitch += clamp(wantPitch - this.eyePitch, -dt * 7, dt * 7);   // (a saccade: fast, but not a teleport)
    const look = this.anim.look; look.eyeYaw = this.eyeYaw; look.eyePitch = this.eyePitch;
    // ---- blinking -----------------------------------------------------------------------------------------------------------
    this.blinkT -= dt * (1 + stress * 1.3) * (T[S.eyeWideLeft] > 0.7 ? 0.35 : 1);
    if (this.blinkT <= 0 && this.blinkPhase === 0) { this.blinkPhase = 1; this.blinkT = 2 + R() * 4.4; this.again = R() < 0.14; }
    if (this.blinkPhase === 1) { this.blink += dt / 0.065; if (this.blink >= 1) { this.blink = 1; this.blinkPhase = 2; } }
    else if (this.blinkPhase === 2) { this.blink -= dt / 0.13; if (this.blink <= 0) { this.blink = 0; this.blinkPhase = 0; if (this.again) { this.again = false; this.blinkT = 0.12; } } }
    const lid = Math.max(0, -this.eyePitch) * 0.9;                                // the lids come down with the eyes
    const base = 0.04 + lid;
    for (const side of ['Left', 'Right']) {
      const wide = S['eyeWide' + side], squint = S['eyeSquint' + side];
      const overlap = Math.min(T[wide], T[squint]);
      T[wide] -= overlap;
      T[squint] -= overlap;
    }
    // ---- to the mesh ----------------------------------------------------------------------------------------------------------
    const cur = this.cur, w = this.w;
    for (let i = 0; i < N; i++) {
      const t = clamp(T[i], 0, 1), c = cur[i];
      cur[i] = c + (t - c) * (1 - Math.exp(-(t > c ? RISE[i] : FALL[i]) * dt));
      w[i] = cur[i];
    }
    const wide = Math.max(cur[S.eyeWideLeft], cur[S.eyeWideRight]);
    w[S.eyeBlinkLeft] = Math.max(this.blink, Math.min(1, cur[S.eyeBlinkLeft] + base * (1 - wide)));
    w[S.eyeBlinkRight] = Math.max(this.blink, Math.min(1, cur[S.eyeBlinkRight] + base * (1 - wide)));
    if (this.blink > 0.3) { w[S.eyeWideLeft] *= 1 - this.blink; w[S.eyeWideRight] *= 1 - this.blink; }
    if (this.eyePitch > 0.12) { w[S.eyeWideLeft] = Math.max(w[S.eyeWideLeft], (this.eyePitch - 0.12) * 1.5); w[S.eyeWideRight] = w[S.eyeWideLeft]; }
  }
}
