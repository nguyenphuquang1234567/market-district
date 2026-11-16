// Death-sound probe: plays a scripted kill in the running game and renders what the player hears to a WAV in captures/.
// Load it in the page:   const dp = await import('/tools/death-probe.js?v=' + Date.now());
//   dp.record(G);                                      once: every audio call and listener frame, with simulation time
//   const k = dp.kill(G, { dist: 12, zone: 'body' });  a soldier shot from `dist` metres, then `secs` of physics stepped
//   const s = dp.selfKill(G, { zone: 'body' });        the player shot dead where he stands
//   const h = dp.overheard(G, { dist: 20 });          a soldier killed out of the player's sight, a wall between them
//   await dp.render(G, k, 'death_kill12m.wav', { seed: 7, only: dp.DEATH })
// The render feeds the recorded calls to a second copy of the game's own audio engine running on an OfflineAudioContext,
// so the WAV has everything the engine does (HRTF, distance delay, air absorption, occlusion, early reflections, the
// three reverbs, the duck after one's own shots, compressor and clipper); only the clock is the recording's. `seed` picks
// the engine's random choices (which take, which voice). Stepping runs unrendered, so a 3 s kill takes well under a second.
import { rng } from '../src/util.js';

export const DEATH = ['shot', 'ui', 'bodyHit', 'death', 'selfDeath', 'collapse', 'bodyfall', 'gunDrop'], SELF = [...DEATH, 'hurt'];
const INTERNAL = ['start', 'measure', 'stats', 'suspend', 'resume', 'setListener'];

export function record(G) {
  const A = G.audio, proto = Object.getPrototypeOf(A), rec = G.__deathRec || (G.__deathRec = { ev: [], frames: [] });
  if (A.__recording) return rec;
  const copy = a => (a && typeof a === 'object' && !a.parts && 'x' in a && 'z' in a) ? { x: a.x, y: a.y, z: a.z } : a;      // positions by value; a ragdoll by reference
  for (const k of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, k);
    if (!d || typeof d.value !== 'function' || k === 'constructor' || k.startsWith('_') || INTERNAL.includes(k)) continue;
    A[k] = function (...args) { rec.ev.push({ t: G.time, k, args: args.map(copy) }); return d.value.apply(this, args); };
  }
  A.setListener = function (cam, dt, health, interior) {
    rec.frames.push({ t: G.time, p: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, e: Array.from(cam.matrixWorld.elements), dt, health, interior });
    return proto.setListener.call(this, cam, dt, health, interior);
  };
  A.__recording = true;
  return rec;
}

// A clear spot `dist` metres from a soldier, with his chest in plain sight.
export function spot(G, b, dist) {
  for (let k = 0; k < 36; k++) {
    const a = k / 36 * Math.PI * 2, x = b.pos.x + Math.sin(a) * dist, z = b.pos.z + Math.cos(a) * dist;
    if (!G.world.nav.free(x, z) || G.audio.blocked({ x, y: 1.62, z }, { x: b.pos.x, y: b.pos.y + 1.3, z: b.pos.z })) continue;
    return { x, z };
  }
  return null;
}
const AIM = { head: 1.62, body: 1.25, limb: 0.55 };
function aim(G, b, zone) {
  const P = G.player, dx = b.pos.x - P.pos.x, dz = b.pos.z - P.pos.z, dy = b.pos.y + (AIM[zone] ?? 1.25) * (b.height / 1.78) - (P.pos.y + 1.62);
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  P.sim = { f: 0, s: 0, yaw, pitch }; P.yaw = yaw; P.pitch = pitch;
}
function begin(G) {
  if (!G.matchLive) G.autoStart();
  G.manual = true;
  const P = G.player; if (!P.alive) P.spawn({ x: P.pos.x, z: P.pos.z, yaw: P.yaw });          // (back on his feet after a selfKill)
  const rec = record(G), render = G.R.render; G.R.render = () => {};
  return { rec, restore: () => { G.R.render = render; } };
}

// The player shoots a soldier dead from `dist` metres (aiming at `zone`), then the world runs on for `secs`. With `at`
// ({x, z}) the soldier is first moved there (to put him on a particular floor); with `direct` the round is not fired but
// its damage dealt straight to him (where stalls and awnings would stop a real one); `trail` more rounds follow the kill.
export function kill(G, { dist = 12, zone = 'body', secs = 3, maxShots = 10, foe = null, at = null, direct = false, trail = 0 } = {}) {
  const { rec, restore } = begin(G), P = G.player;
  try {
    for (let i = 0; i < 400 && !G.bots.list.some(b => b.alive && b.team !== P.team); i++) G.step(1);
    if (at) { foe = foe || G.bots.list.find(b => b.alive && b.team !== P.team); foe.pos.x = foe.prevX = at.x; foe.pos.z = foe.prevZ = at.z; foe.setGoal?.(at.x, at.z, false); G.step(2); }
    let b = foe, s = null;
    for (const c of foe ? [foe] : G.bots.list.filter(b => b.alive && b.team !== P.team)) { s = spot(G, c, dist); if (s) { b = c; break; } }
    if (!b || !s) return { error: 'no soldier with a clear spot at ' + dist + ' m' };
    G.goto(s.x, s.z, 0, 0); const keep = P.health; P.health = 1e6;          // (the test is the soldier's death, not the player's)
    rec.ev.length = 0; rec.frames.length = 0; const t0 = G.time;
    let shots = 0;
    if (direct) { aim(G, b, zone); G.step(1); b.damage(1000, P.pos, P, zone); shots = 1; }
    while (b.alive && shots < maxShots) { aim(G, b, zone); G.step(1); P.fire(0, 0, 0); shots++; }
    const killedAt = G.time - t0;
    for (let i = 0; i < trail; i++) { G.step(6); P.fire(0, 0, 0); }             // rounds still going out after he drops (600 a minute), as from a real trigger finger
    G.step(Math.max(0, Math.round(secs * 60) - trail * 6)); P.health = keep;
    return { t0, secs, shots, killed: !b.alive, killedAt, dist: Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z), soldier: b.idx, ev: rec.ev.slice(), frames: rec.frames.slice() };
  } finally { restore(); }
}

// A soldier killed by another while the player listens from `dist` metres with a wall in between (falls back to any
// spot at that distance if no hidden one is found; `hidden` in the result says which).
export function overheard(G, { dist = 20, zone = 'body', secs = 3 } = {}) {
  const { rec, restore } = begin(G), P = G.player;
  try {
    for (let i = 0; i < 400 && G.bots.list.filter(b => b.alive).length < 2; i++) G.step(1);
    let b = null, s = null, hidden = false;
    for (const c of G.bots.list.filter(c => c.alive && c.team !== P.team)) {                  // the nearest hidden spot to `dist`, round any enemy
      for (let k = 0; k < 288 && !s; k++) {
        const a = k / 48 * Math.PI * 2, d = dist * (1 + ((k % 6) - 2.5) * 0.12), x = c.pos.x + Math.sin(a) * d, z = c.pos.z + Math.cos(a) * d;
        if (G.world.nav.free(x, z) && G.audio.blocked({ x, y: 1.62, z }, { x: c.pos.x, y: c.pos.y + 1.3, z: c.pos.z }) && G.audio.blocked({ x, y: 1.62, z }, { x: c.pos.x, y: c.pos.y + 2.9, z: c.pos.z })) { s = { x, z }; hidden = true; b = c; }
      }
      if (s) break;
    }
    b = b || G.bots.list.find(c => c.alive && c.team !== P.team); s = s || spot(G, b, dist);
    const by = G.bots.list.find(c => c.alive && c.team !== b.team) || P;
    G.goto(s.x, s.z, 0, 0); const keep = P.health; P.health = 1e6; G.step(1);
    rec.ev.length = 0; rec.frames.length = 0; const t0 = G.time;
    b.damage(1000, by.pos, by, zone);
    G.step(Math.round(secs * 60)); P.health = keep;
    return { t0, secs, hidden, dist: Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z), soldier: b.idx, ev: rec.ev.slice(), frames: rec.frames.slice() };
  } finally { restore(); }
}

// The player is shot dead (zone 'head', 'body', 'limb' or 'blast') where he stands; the death camera runs for `secs`.
export function selfKill(G, { zone = 'body', secs = 2.5 } = {}) {
  const { rec, restore } = begin(G), P = G.player;
  try {
    G.step(2); rec.ev.length = 0; rec.frames.length = 0; const t0 = G.time;
    const foe = G.bots.list.find(b => b.alive && b.team !== P.team);
    P.health = Math.min(P.health, 30); P.damage(zone === 'head' ? 52 : 34, foe ? foe.pos : { x: P.pos.x + 10, y: 0, z: P.pos.z }, foe || null, zone);      // a real killing round, not an overkill
    G.step(Math.round(secs * 60));
    return { t0, secs, surf: P.surf, ev: rec.ev.slice(), frames: rec.frames.slice() };
  } finally { restore(); }
}

// The recorded calls of a take, readable: [seconds after the start, call, arguments].
export function list(take, only = DEATH) {
  const f = a => (a && typeof a === 'object') ? ('x' in a ? `(${a.x.toFixed(1)}, ${a.y.toFixed(2)}, ${a.z.toFixed(1)})` : a.parts || '__rag' in a ? 'body' : '{…}') : typeof a === 'number' ? +a.toFixed(2) : a;
  return take.ev.filter(e => !only || only.includes(e.k)).map(e => [+(e.t - take.t0).toFixed(3), e.k, ...e.args.map(f)]);
}

// Saving a take as JSON (bodies become ids) and loading it back, so the same kill can be heard through changed code.
export function pack(take) { const ids = new Map(); return JSON.stringify({ ...take, ev: take.ev.map(e => ({ ...e, args: e.args.map(a => (a && typeof a === 'object' && a.parts) ? { __rag: ids.has(a) ? ids.get(a) : (ids.set(a, ids.size), ids.size - 1) } : a) })) }); }
export function unpack(json) { const t = typeof json === 'string' ? JSON.parse(json) : json, bodies = new Map(); t.ev = t.ev.map(e => ({ ...e, args: e.args.map(a => (a && typeof a === 'object' && '__rag' in a) ? (bodies.get(a.__rag) || bodies.set(a.__rag, { parts: [] }).get(a.__rag)) : a) })); return t; }

// Renders a take through the game's audio engine offline and posts it to captures/<name>. Returns levels and, in
// `plays`, every buffer the engine started (name, start time, gain, low-pass, rate).
export async function render(G, take, name, { lead = 0.25, secs = (take.secs || 3) + 0.6, only = null, seed = 31337, amb = false } = {}) {
  const sr = 48000, off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(sr * secs), sampleRate: sr });
  const Real = window.AudioContext, A = fresh(G);
  window.AudioContext = function () { return off; };
  try { A.start(); } finally { window.AudioContext = Real; }
  clearInterval(A._ambTimer); A.rnd = rng(seed); A.cast = G.audio.cast; A.blocked = G.audio.blocked; A.emitters = [];
  if (!amb) A.bus.amb.gain.value = 0;
  let T = 0; Object.defineProperty(A, 'now', { get: () => T });
  const plays = [], play = A._play; A._play = function (n, o = {}) { const s = play.call(this, n, o); plays.push({ name: n, at: +(T + (o.delay || 0)).toFixed(3), gain: +(o.gain ?? 1).toFixed(3), lp: o.lp ? Math.round(o.lp) : null, rate: +(o.rate || 1).toFixed(2), played: !!s }); return s; };
  const f0 = take.frames[0]; for (let k = 0; k < 12; k++) A._surroundings(f0.p, f0.interior, 0);           // the space around the listener, settled first,
  A.setListener({ position: f0.p, matrixWorld: { elements: f0.e } }, 0, f0.health, f0.interior);           // and the listener in place before the first call
  const items = [...take.frames.map(f => ({ t: f.t, f })), ...take.ev.filter(e => !only || only.includes(e.k)).map(e => ({ t: e.t, e }))].sort((a, b) => a.t - b.t);
  for (const it of items) {
    T = it.t - take.t0 + lead; if (T < 0 || T > secs - 0.05) continue;
    if (it.f) A.setListener({ position: it.f.p, matrixWorld: { elements: it.f.e } }, it.f.dt, it.f.health, it.f.interior);
    else A[it.e.k](...it.e.args);
  }
  const buf = await off.startRendering();
  let peak = 0, sq = 0; for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sq += v * v; } }
  await fetch('/__capture/' + name, { method: 'POST', body: wav(buf) });
  return { name, peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(1), rmsDb: +(10 * Math.log10(sq / (2 * buf.length) + 1e-24)).toFixed(1), space: { room: +A.env.room.toFixed(2), narrow: +A.env.narrow.toFixed(2), open: +A.env.open.toFixed(2) }, plays };
}

// A new engine as the constructor leaves it, without baking the library again: one is built per page and copied
// (the sample library shared, every container fresh).
let template = null;
function fresh(G) {
  const Ctor = Object.getPrototypeOf(G.audio).constructor; if (!template || template.Ctor !== Ctor) template = { Ctor, a: new Ctor() };
  const A = Object.create(Ctor.prototype);
  for (const [k, v] of Object.entries(template.a)) A[k] = k === 'raw' ? G.audio.raw : k === 'recorded' ? G.audio.recorded : v instanceof WeakMap ? new WeakMap() : Array.isArray(v) ? [] : (v && typeof v === 'object' && v.constructor === Object) ? structuredClone(v) : v;      // (the live engine's library: it holds the recorded voices once they have loaded)
  return A;
}

function wav(buf) {
  const n = buf.length, c = buf.numberOfChannels, b = new DataView(new ArrayBuffer(44 + n * c * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * c * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, c, true); b.setUint32(24, buf.sampleRate, true);
  b.setUint32(28, buf.sampleRate * c * 2, true); b.setUint16(32, c * 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * c * 2, true);
  const ch = Array.from({ length: c }, (_, k) => buf.getChannelData(k));
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) b.setInt16(44 + (i * c + k) * 2, Math.round(Math.max(-1, Math.min(1, ch[k][i])) * 32767), true);
  return b.buffer;
}
