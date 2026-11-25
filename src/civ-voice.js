// What the civilians sound like: voices, breath, feet. All of it goes through the game's audio engine (audio.js), so it
// arrives late by its distance, dulled by air and by walls in the way, in the street's own echo.
//
// Voices are recordings (assets/audio/civ-voices.wav and .json, built by tools/build-civ-voices.py: talk, laughter,
// gasps, screams, pleading, whimpers, sobs, cries of pain, sighs, by several women and men; credits in ASSETS.md). Each
// clip carries a timeline of loudness and mouth shapes made from the recording, which the speaker's face follows
// (civ-face.js), and each person plays their takes at a pitch of their own. Without the pack the men still have the
// soldiers' recorded screams and cries; nobody is given a synthesized voice.
// Breath (out of puff, or frightened) and footfalls are modelled here: shaped noise, no voice in them.
import { rng, clamp } from './util.js';

// kind -> how loud, how far it carries (reference distance, rolloff), how far off it is still played, which bus
const KIND = {
  chat: { gain: 1.25, ref: 1.7, roll: 1.25, reach: 26 }, greet: { gain: 1.3, ref: 1.8, roll: 1.2, reach: 28 }, laugh: { gain: 1.35, ref: 1.9, roll: 1.1, reach: 34 },
  gasp: { gain: 1.6, ref: 2, roll: 1, reach: 34 }, scream: { gain: 3.3, ref: 4, roll: 0.55, reach: 125, loud: true }, pain: { gain: 3, ref: 3.5, roll: 0.6, reach: 95, loud: true },
  plead: { gain: 1.7, ref: 2, roll: 1, reach: 34 }, whimper: { gain: 1.2, ref: 1.6, roll: 1.1, reach: 22 }, sob: { gain: 1.3, ref: 1.7, roll: 1.1, reach: 26 }, sigh: { gain: 0.9, ref: 1.4, roll: 1.2, reach: 14 },
  die: { gain: 3.2, ref: 3.8, roll: 0.55, reach: 110, loud: true },           // the cry of someone shot dead
  ask: { gain: 1.5, ref: 1.9, roll: 1.1, reach: 30 }, run: { gain: 2.2, ref: 2.6, roll: 0.8, reach: 60 },      // a startled question; a shout to get the others moving
};
const FALLBACK = { scream: 'vo_scream', pain: 'vo_pain' };                    // the soldiers' recordings, for the men, when the pack is absent
const STEPS = { concrete: 'step_concrete', plaster: 'step_concrete', brick: 'step_concrete', dirt: 'step_dirt', wood: 'step_wood', metal: 'step_metal', tile: 'step_tile' };
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export class CivVoice {
  constructor(G) {
    this.G = G; this.rnd = rng(60606); this.clips = {}; this.live = new Map(); this.count = 0; this.played = {};
    const A = G.audio, SR = 48000, R = rng(717);
    // breath: air through an open mouth. In: a narrow hiss rising in pitch. Out: lower and broader, falling.
    const breath = (secs, f0, f1, q, tilt) => {
      const n = Math.ceil(secs * SR), x = new Float32Array(n); let y1 = 0, y2 = 0, x1 = 0, x2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, f = f0 + (f1 - f0) * t, w = 6.2832 * f / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al, v = R() * 2 - 1;
        const y = (al * v - al * x2 + 2 * Math.cos(w) * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y;
        x[i] = y * Math.sin(Math.PI * Math.pow(t, tilt)) ** 1.5 * 2.2;
      }
      return x;
    };
    A.raw.civ_in = [0, 1, 2].map(() => breath(0.34 + R() * 0.1, 1500 + R() * 300, 2500 + R() * 400, 1.6, 1.25));
    A.raw.civ_out = [0, 1, 2].map(() => breath(0.42 + R() * 0.14, 1250 + R() * 200, 620 + R() * 120, 0.9, 0.7));
    if (A.S) { A.S.civ_in = A._buffers(A.raw.civ_in); A.S.civ_out = A._buffers(A.raw.civ_out); }
    this.loaded = this.load();
  }
  // The recorded pack, if it is there: clips by kind and by who speaks them, each with its lip-sync timeline.
  async load(base = 'assets/audio/') {
    try {
      const r = await fetch(base + 'civ-voices.json'); if (!r.ok) return 0;
      const idx = await r.json(), data = await fetch(base + 'civ-voices.wav').then(x => x.arrayBuffer());
      const all = (await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data)).getChannelData(0), A = this.G.audio, add = {};
      for (const c of idx.clips) {
        const name = `cv_${c.kind}_${c.sex}`, a = Math.round(c.start * 48000), take = (add[name] ||= []).length;
        add[name].push(all.slice(a, a + Math.round(c.length * 48000)));
        (this.clips[name] ||= []).push({ take, who: c.who, dur: c.length, step: c.step, env: c.env ? b64(c.env) : null, vis: c.vis ? b64(c.vis) : null });
      }
      Object.assign(A.raw, add);
      if (A.S) for (const [name, vars] of Object.entries(add)) A.S[name] = A._buffers(vars);
      this.speakers = idx.speakers || {};
      return idx.clips.length;
    } catch (e) { console.warn('civilian voices not loaded', e); return 0; }
  }
  reset() { for (const s of this.live.values()) { try { s.stop(); } catch { /* already ended */ } } this.live.clear(); }
  mouth(c) { return { x: c.pos.x, y: c.pos.y + c.height - 0.14, z: c.pos.z }; }

  // Person c makes a sound of this kind. Returns what their face should follow ({ dur, step, env, vis } or { dur, kind }),
  // or null when there is no recording for it (the caller decides whether lips move in silence).
  say(c, kind, { gain = 1, delay = 0, cut = 0 } = {}) {
    const A = this.G.audio, K = KIND[kind] || KIND.chat, sex = c.person.female ? 'f' : 'm', R = this.rnd;
    let name = `cv_${kind}_${sex}`, list = this.clips[name], pick = null, face = null;
    if (list) {
      const mine = list.filter(t => t.who === c.voiceWho), from = mine.length ? mine : list;
      pick = from[(R() * from.length) | 0]; if (from.length > 1 && pick === c.lastTake) pick = from[(from.indexOf(pick) + 1) % from.length]; c.lastTake = pick;
      face = { dur: pick.dur / (c.voiceRate || 1), step: pick.step / (c.voiceRate || 1), env: pick.env, vis: pick.vis, kind: kind === 'scream' || kind === 'pain' || kind === 'die' ? 'scream' : 'talk' };
    } else if (sex === 'm' && FALLBACK[kind] && A.raw[FALLBACK[kind]]) { name = FALLBACK[kind]; face = { dur: kind === 'scream' ? 1.2 : 0.7, kind: 'scream' }; }
    else return null;
    if (!A.ctx) return face;
    const o = { bus: K.loud ? A.bus.voice : A.bus.world, ref: K.ref, roll: K.roll, gain: K.gain * gain, rate: c.voiceRate || 1, jitter: 0.03, er: 0.2, rev: 0.2, delay, cut, take: pick ? pick.take : undefined };
    if (A._carry(this.mouth(c), o) > K.reach) return face;
    this.stop(c);
    const src = A._play(name, o);
    if (src) { this.live.set(c, src); src.addEventListener('ended', () => { if (this.live.get(c) === src) this.live.delete(c); }); this.played[kind] = (this.played[kind] || 0) + 1; }
    return face;
  }
  stop(c) { const s = this.live.get(c); if (s) { try { s.stop(this.G.audio.now + 0.03); } catch { /* already ended */ } this.live.delete(c); } }

  // A footfall: the surface's own sound, lighter and without a soldier's kit; sharper in heels, softer in trainers.
  step(c) {
    const A = this.G.audio; if (!A.ctx || c.dist > 30) return;
    const surf = this.G.world.surfaceAt(c.pos.x, c.pos.z), run = clamp((c.speed - 1.6) / 2.4, 0, 1), shoe = c.person.info.shoes || 'soft';
    const o = { bus: A.bus.world, ref: 1.5, gain: (0.42 + run * 0.6) * (shoe === 'heel' ? 1.25 : shoe === 'soft' ? 0.8 : 1), rate: shoe === 'heel' ? 1.3 : shoe === 'slap' ? 1.12 : 1.04, lp: shoe === 'soft' ? 3200 : shoe === 'heel' ? 9000 : 5200, rev: 0.12, er: 0.05, jitter: 0.1 };
    if (A._carry({ x: c.pos.x, y: c.pos.y + 0.05, z: c.pos.z }, o) > 30) return;
    A._play(STEPS[surf] || 'step_concrete', o);
    if (run > 0.4 && this.rnd() < 0.3) A._play('cloth', { ...o, gain: o.gain * 0.3, lp: 4000 });
  }
  // One breath in and out, heard only close by: `air` 0..1 is how hard they are breathing.
  breath(c, air) {
    const A = this.G.audio; if (!A.ctx) return;
    const o = { bus: A.bus.world, ref: 0.9, roll: 1.4, gain: 0.34 * air, rate: c.person.female ? 1.12 : 0.92, rev: 0.05, jitter: 0.12 };
    if (A._carry(this.mouth(c), o) > 13) return;
    A._play('civ_in', o); A._play('civ_out', { ...o, delay: o.delay + 0.32 + 0.25 * (1 - air), gain: o.gain * 1.2 });
  }
}
