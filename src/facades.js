// Facade archetypes: what kind of building a block is (a colonial casona, a tenement, a 1950s commercial block, a
// house whose upper floor was never finished, a small barrio house), chosen per building from the streets it faces,
// and everything that kind decides about its upper floors, ornament, roofline, colours and wear.
//
// Every choice here is drawn from a stream of the building's own (seeded by its footprint), never from the district's
// shared random streams: the layout, the props on the streets, the cover and the soldiers' routes do not move when
// the architecture changes. world.js draws what these describe.
import { rng } from './util.js';

// ---- colour --------------------------------------------------------------------------------------------------------------
// How Mexican market streets are painted (README, "Facade colour"). In 59 photographs of streets in seven towns
// (Guanajuato, Dolores Hidalgo, Puebla, Mexico City, Oaxaca, Queretaro, San Cristobal de las Casas) half of what is wall
// is below 0.18 saturation and one pixel in twenty is above 0.6: the walls are natural limewash and plaster colours, and
// a strong colour is a house here and there, red-orange and ochre far more often than blue or pink. So a street is
// painted from a family of plaster tones whose warmth drifts slowly along it (a few houses share it, the next few move
// on), and a few houses, never two together, take one of that street's muted accents.
// The heritage rules of the towns hold as before: two matte colours to a facade, one (A) on the wall and one (B) on the
// base band (guardapolvo, 0.6 to 0.9 m) and what is picked out; white with any of them; cantera keeps the stone's
// colour; ironwork black, gates and doors dark wood or painted; no bright or fluorescent colours.
// Hex values are the colour as a wall reads in daylight, not a paint chip.
const TONES = {                 // natural plasters and limewashes, coolest to warmest (the order a street's warmth drifts along)
  limestone: '#d3cdbf', offwhite: '#e6e0d2', cream: '#e3d5b8', straw: '#dcc797', beige: '#d2bc9c',
  sand: '#cdb187', clay: '#c9ad8a', ochre: '#ccc4b5', terracotta: '#c3b39d',
};
const ORDER = Object.keys(TONES);
// (no blue and no pink: even faded, a blue wall reads as sea blue in the sun and a pink one as pink, and the district
// is not to have either)
// The former terracotta and red slots use muted warm neutrals, keeping the seeded placement of each building's palette.
const ACCENTS = { red: '#b9ac98', green: '#a9b094' };
// a base band that is not simply the wall a step darker: deep earths and greys
const DEEP = { oxide: '#7a3a2a', umber: '#5a4332', slate: '#5b6168', moss: '#4b5a46', wine: '#5d2c2c', charcoal: '#4a4845' };
const COOL = new Set(['limestone', 'offwhite', 'cream', 'green']);
// each kind of street: how much of each tone, its accents, and how often a house takes one
const STREET_PAL = {
  plaza:  { tones: { limestone: 3, offwhite: 3, cream: 2, straw: 1, beige: 1, sand: 1, ochre: 3, terracotta: 2 }, accents: { red: 3 }, rate: 0.16 },
  main:   { tones: { limestone: 2, offwhite: 3, cream: 2, straw: 1, beige: 2, sand: 1, clay: 2, ochre: 3, terracotta: 3 }, accents: { red: 3, green: 2 }, rate: 0.24 },
  market: { tones: { offwhite: 1, cream: 2, straw: 2, beige: 2, sand: 2, clay: 2, ochre: 3, terracotta: 3 }, accents: { red: 2, green: 3 }, rate: 0.3 },
  calle:  { tones: { offwhite: 2, cream: 2, straw: 2, beige: 1, sand: 1, clay: 2, ochre: 3, terracotta: 3 }, accents: { red: 3, green: 3 }, rate: 0.27 },
  cross:  { tones: { limestone: 1, offwhite: 3, cream: 2, straw: 1, beige: 1, sand: 1, clay: 3, ochre: 2, terracotta: 2 }, accents: { red: 2, green: 3 }, rate: 0.27 },
  lane:   { tones: { limestone: 3, offwhite: 3, cream: 2, beige: 1, sand: 1, clay: 1, ochre: 2, terracotta: 1 }, accents: { green: 2, red: 1 }, rate: 0.18 },
  alley:  { tones: { limestone: 2, offwhite: 3, cream: 2, beige: 1, sand: 1, clay: 2, ochre: 1, terracotta: 1 }, accents: { green: 2, red: 1 }, rate: 0.2 },
};
// and each kind of building leans its own way within it (only: the accents it may take)
const KIND_PAL = {
  casona:    { tones: { limestone: 1.4, offwhite: 0.9, cream: 1.2, straw: 0.9, sand: 0.8, clay: 0.6, ochre: 1.4, terracotta: 1.3 }, accent: 0.8, only: ['red'] },
  comercial: { tones: { limestone: 1.6, offwhite: 1.6, cream: 1.1, straw: 0.8, sand: 0.8, clay: 0.6, ochre: 0.6, terracotta: 0.4 }, accent: 0.6, only: ['green'] },
  vecindad:  { tones: {}, accent: 1 },
  barrio:    { tones: { limestone: 0.6, straw: 1.2, sand: 1.1, clay: 1.3, ochre: 1.3, terracotta: 1.3 }, accent: 1.5 },
  obra:      { tones: { limestone: 1.5, beige: 1.2, sand: 1.2, clay: 0.6, ochre: 0.6, terracotta: 0.5 }, accent: 0.5 },
};
const WHITE = '#ede6d6', CANTERA = '#d8c8b0';
// doors and shutters: stained wood, or painted (a cool colour on a warm wall, a warm one on a cool wall)
const WOOD = { natural: '#5b3a26', dark: '#3f2a1e', green: '#4f6650', oxblood: '#62302a', grey: '#5a5f63' };
const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = h => [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255));
const enc = v => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
const hex = c => '#' + c.map(v => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join('');
// the same colour a good step darker and a little stronger (a base band, a frame in the wall's own colour)
const deepen = h => { const c = rgb(h), L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return hex(c.map(v => (L + (v - L) * 1.18) * 0.36)); };
// no two houses quite the same paint: a few percent of lightness and the faintest shift of hue
const jitter = (h, r) => { const k = 0.955 + 0.09 * r(), w = (r() - 0.5) * 0.04; return hex(rgb(h).map((v, i) => v * k * (i === 0 ? 1 + w : i === 2 ? 1 - w : 1))); };
// smooth value noise over the map (a lattice step is 1): what drifts slowly along a street
const vnoise = (x, z, s) => {
  const xi = Math.floor(x), zi = Math.floor(z), u = (x - xi) ** 2 * (3 - 2 * (x - xi)), v = (z - zi) ** 2 * (3 - 2 * (z - zi)), h = (i, j) => hash(xi + i, zi + j, s);
  return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
};
// each material's texture, its average linear albedo (measured from the diffuse map): a tint is the colour meant over it.
// (w_white is peeling paint over grey plaster: only its paint takes the tint, see the mask in materials.js, so its mean
// is the painted part's.)
const MEAN = { w_plaster: [0.407, 0.366, 0.35], w_plaster2: [0.266, 0.255, 0.244], w_white: [0.567, 0.564, 0.529], paint: [0.624, 0.624, 0.624],
  concrete: [0.266, 0.237, 0.161], planks: [0.08, 0.057, 0.043], door: [0.075, 0.019, 0.005] };
// A swatch as the vertex tint that gives it over a material's texture: its chroma scaled, its linear lightness scaled
// by k and held between lo and hi; colours near white may go up to `lift` higher (they have no colour to lose).
export function tint(hex, mat, chroma = 0.8, lo = 0.035, hi = 0.6, k = 1, lift = 0) {
  const c = rgb(hex), L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], m = MEAN[mat] || [0.5, 0.5, 0.5];
  const sat = (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-4), top = hi + lift * Math.max(0, 1 - sat / 0.25);
  const L2 = Math.min(top, Math.max(lo, L * k));
  return c.map((v, i) => Math.min(3.2, Math.max(0.02, (L + (v - L) * chroma) * (L2 / Math.max(L, 1e-4)) / m[i])));
}
// A colour as the vertex tint over a texture, for a whole wall: a large sunlit area reads lighter and stronger than a
// chip (the area effect), so the stronger a colour the more of its chroma goes, and the light ones are eased down towards
// 0.46 albedo (whites up to 0.58), dark ones left as they are.
function paint(hex, mat, ch0, chS, knee, hi, lift) {
  const c = rgb(hex), L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], m = MEAN[mat] || [0.5, 0.5, 0.5];
  const sat = (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-4), top = hi + lift * Math.max(0, 1 - sat / 0.25), chroma = ch0 - chS * sat;
  const L2 = L < knee ? L : knee + (top - knee) * (1 - Math.exp(-(L - knee) / (top - knee + 1e-4)));
  return c.map((v, i) => Math.min(3.2, Math.max(0.02, (L + (v - L) * chroma) * (L2 / Math.max(L, 1e-4)) / m[i])));
}
export const wallTint = (h, mat) => paint(h, mat, 0.95, 0.1, 0.2, 0.46, 0.12);
// The B colour on bands, surrounds and cornices: deeper than the chip (held under `hi`), a little less strong.
export const accentTint = (h, mat, hi = 0.2) => paint(h, mat, 0.84, 0.16, hi * 0.6, hi, 0.4);
export const ARCHETYPES = {
  // Colonial casona: tall openings with stone surrounds, hoods or pediments or round arches over them, an iron balcony
  // to each upper opening, quoins, string courses, a heavy cornice and sometimes a balustrade along the roof.
  casona: { depth: 0.34, stone: true, quoins: 0.8, pilasters: 0.45, cornice: 1, balustrade: 0.45, ledge: 1, base: 'stone', wear: 0.35 },
  // Tenement (vecindad): small windows with grilles, set where the rooms needed them, an odd balcony, bricked-up and
  // repaired openings, a painted base band, a low parapet with rebar and tanks behind it.
  vecindad: { depth: 0.2, stone: false, quoins: 0, pilasters: 0, cornice: 0, balustrade: 0, ledge: 0.25, base: 'band', wear: 0.85 },
  // 1950s commercial block: horizontal bands of wide steel windows between concrete floor slabs, fins, a cantilevered
  // canopy over the shops, a sign frame or a stepped parapet on the roof, glass-block stair windows.
  comercial: { depth: 0.14, stone: false, quoins: 0, pilasters: 0, cornice: 0, balustrade: 0, ledge: 0, base: 'tile', wear: 0.45 },
  // Obra negra: a plastered shop floor and the floors above left in brick between bare concrete columns and beams,
  // raw openings, rebar standing out of the column tops.
  obra: { depth: 0.2, stone: false, quoins: 0, pilasters: 0, cornice: 0, balustrade: 0, ledge: 0, base: 'band', wear: 0.6 },
  // Barrio house: small windows with wooden shutters and stone sills, a niche with a saint, a tiled eave or a curved
  // parapet, strong colours with a contrasting trim.
  barrio: { depth: 0.26, stone: false, quoins: 0, pilasters: 0, cornice: 0, balustrade: 0, ledge: 0.4, base: 'band', wear: 0.5 },
};

// Each street has a character: weights of the archetypes along it.
const STREETS = {
  main: { casona: 0.42, comercial: 0.34, barrio: 0.12, vecindad: 0.12 },
  market: { comercial: 0.45, vecindad: 0.35, obra: 0.2 },
  plaza: { casona: 0.6, barrio: 0.25, comercial: 0.15 },
  calle: { casona: 0.34, barrio: 0.3, comercial: 0.18, vecindad: 0.18 },
  cross: { barrio: 0.36, vecindad: 0.36, casona: 0.14, obra: 0.14 },
  lane: { vecindad: 0.4, comercial: 0.3, obra: 0.3 },
  alley: { vecindad: 0.45, obra: 0.4, barrio: 0.15 },
};
const RANK = ['plaza', 'main', 'market', 'calle', 'lane', 'cross', 'alley'];

export const hash = (...a) => { let h = 2166136261; for (const v of a) { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

// The building's own random stream and its archetype, from its footprint and the most important street it faces.
export function facadeStyle(bd, prev = null) {
  const vr = rng(Math.floor(hash(bd.x0, bd.z0, bd.x1, bd.z1, 77) * 1e9) + 7);
  const streets = Object.values(bd.street || {}).filter(s => s && s !== 'none');
  const main = RANK.find(s => streets.includes(s)) || 'cross';
  const w = STREETS[main] || STREETS.cross;
  let r = vr(), kind = 'vecindad';
  for (const [k, p] of Object.entries(w)) { if (r < p) { kind = k; break; } r -= p; }
  if (kind === 'obra' && bd.floors < 2) kind = 'vecindad';
  if (kind === 'comercial' && bd.floors < 2) kind = 'barrio';
  const A = ARCHETYPES[kind], pick = a => a[Math.floor(vr() * a.length) % a.length];
  const st = {
    kind, A, vr, street: main,
    // casona: how each upper opening is headed, and its balcony
    head: pick(['hood', 'hood', 'pediment', 'arch', 'plain']), headAlt: vr() < 0.5,
    balcony: kind === 'casona' ? pick(['each', 'each', 'alternate', 'piano']) : kind === 'vecindad' ? (vr() < 0.45 ? 'one' : 'none') : kind === 'barrio' ? (vr() < 0.3 ? 'one' : 'none') : 'none',
    // vecindad: windows shifted off the bay centre by where the rooms are; a bathroom slit beside some
    jitter: kind === 'vecindad' ? 0.45 : kind === 'barrio' ? 0.15 : 0, slit: kind === 'vecindad' ? 0.35 : 0,
    win: kind === 'casona' ? { w: 1.1 + vr() * 0.15, h: 2.1 + vr() * 0.2, sill: 0.42 } :
         kind === 'vecindad' ? { w: 0.9 + vr() * 0.35, h: 1.05 + vr() * 0.25, sill: 1.0 } :
         kind === 'comercial' ? { w: 0, h: 1.35 + vr() * 0.2, sill: 0.95 } :
         kind === 'obra' ? { w: 1.1 + vr() * 0.3, h: 1.15 + vr() * 0.15, sill: 1.0 } :
         { w: 0.95 + vr() * 0.15, h: 1.25 + vr() * 0.15, sill: 0.95 },
    frame: kind === 'casona' || kind === 'barrio' ? 'wood' : kind === 'comercial' ? 'steel' : kind === 'obra' ? pick(['raw', 'raw', 'alu']) : pick(['alu', 'alu', 'wood']),
    shutters: kind === 'barrio' ? 0.75 : kind === 'casona' ? 0.35 : kind === 'vecindad' ? 0.2 : 0,
    grille: kind === 'vecindad' ? 0.8 : kind === 'barrio' ? 0.35 : kind === 'obra' ? 0.3 : 0,
    // roofline
    roof: kind === 'casona' ? (vr() < A.balustrade ? 'balustrade' : 'cornice') : kind === 'comercial' ? pick(['stepped', 'sign', 'band']) : kind === 'obra' ? 'stubs' : kind === 'barrio' ? pick(['crest', 'eave', 'crest']) : pick(['plain', 'plain', 'stubs']),
    pilasters: vr() < A.pilasters, quoins: vr() < A.quoins,
    // wear: repairs, bricked openings, renovated shop fronts
    bricked: kind === 'vecindad' ? 0.18 : kind === 'obra' ? 0.12 : kind === 'barrio' ? 0.06 : kind === 'casona' ? 0.05 : 0.03,
    patches: Math.round(A.wear * (2 + vr() * 4)), brickPatches: kind === 'vecindad' || kind === 'obra' ? 1 + Math.floor(vr() * 3) : vr() < A.wear * 0.5 ? 1 : 0,
    niche: kind === 'barrio' && vr() < 0.55, canopy: kind === 'comercial',
    tinAwning: kind === 'vecindad' || kind === 'obra' ? 0.5 : 0.15,
  };
  // ---- colour, from a stream of its own (repainting the district never moves a balcony) --------------------------------
  const cr = rng(Math.floor(hash(bd.x0, bd.z0, bd.x1, bd.z1, 91) * 1e9) + 3), cpick = a => a[Math.floor(cr() * a.length) % a.length];
  const wpick = w => { const e = Object.entries(w).filter(([, v]) => v > 0), sum = e.reduce((t, [, v]) => t + v, 0); let r = cr() * sum; for (const [k, v] of e) if ((r -= v) < 0) return k; return e[e.length - 1][0]; };
  const pal = STREET_PAL[main] || STREET_PAL.cross, K = KIND_PAL[kind], cx = (bd.x0 + bd.x1) / 2, cz = (bd.z0 + bd.z1) / 2;
  // the street's warmth drifts slowly along it: neighbours share a family of tones, the next few houses move on
  const warm = Math.min(1, Math.max(0, (vnoise(cx / 36, cz / 36, 5) - 0.5) * 1.9 + 0.5)) * (ORDER.length - 1);   // (stretched: value noise sits mid-way)
  // Value steps along a row stay gentle, so nothing looks dropped in from another street. The dark colours (terracotta and
  // the earthy red) go only on a small house (two floors) and only next to a mid-toned neighbour, and the house after one
  // takes a mid tone as well; a whole block of three or four floors in a dark colour stands out of its street instead of
  // into it. The pale accents (sage, jade) are as light as the plaster round them and may stand anywhere but next to
  // another accent.
  const LIGHT = new Set(['limestone', 'offwhite', 'cream']), MID = new Set(['straw', 'beige', 'sand', 'clay', 'ochre']);
  const prevTone = prev?.colors?.tone, prevAccent = prev?.colors?.accent, prevDark = prevTone === 'terracotta' || prevAccent === 'red';
  const small = bd.floors <= 2, darkOK = small && !!prevTone && MID.has(prevTone);
  const toneW = Object.fromEntries(ORDER.map((t, i) => {
    let w = (pal.tones[t] || 0) * (K.tones[t] ?? 1) * Math.exp(-((i - warm) ** 2) / 10.5);
    if (t === 'terracotta' && !darkOK) w = 0;
    if (prevDark && !MID.has(t)) w = 0;
    return [t, w];
  }));
  if (!Object.values(toneW).some(v => v > 0)) for (const t of MID) toneW[t] = 1;
  const pool = Object.fromEntries(Object.entries(pal.accents).filter(([k]) => (!K.only || K.only.includes(k)) && (k !== 'red' || darkOK)));
  const accentP = Object.keys(pool).length && !prevAccent && !prevDark && small ? pal.rate * K.accent * (0.5 + vnoise(cx / 22, cz / 22, 9)) * 1.6 : 0;
  let tone = null, accent = null;
  if (cr() < accentP) accent = wpick(pool);
  else { tone = wpick(toneW); for (let k = 0; k < 4 && tone === prevTone; k++) tone = wpick(toneW); }
  let a = jitter(accent ? ACCENTS[accent] : TONES[tone], cr), cool = COOL.has(accent || tone);
  // B, on the base band and what is picked out: the wall's own colour a good step darker, or a deep earth that goes with it
  const ownB = cr() < 0.45, deepK = ownB ? null : cpick(cool ? ['oxide', 'slate', 'moss', 'charcoal', 'umber'] : ['umber', 'oxide', 'charcoal', 'slate', 'wine']);
  const frames = kind === 'casona' ? (cr() < 0.7 ? 'stone' : 'white') : accent ? (cr() < 0.75 ? 'white' : 'b') : cr() < { comercial: 0.75, barrio: 0.6, vecindad: 0.45, obra: 0.3 }[kind] ? 'white' : 'b';
  const woodK = kind === 'casona' ? cpick(['natural', 'dark', 'natural', 'oxblood']) : kind === 'barrio' ? cpick(cool ? ['natural', 'oxblood', 'natural', 'dark'] : ['green', 'grey', 'natural', 'dark'])
    : kind === 'comercial' ? cpick(['dark', 'grey']) : cpick(['natural', 'dark', 'grey', cool ? 'oxblood' : 'green']);
  // age, for the wall shader (attribute aAge): how far the sun has bleached the paint, how much road dust and damp it has
  // taken, and up to what height the street floor was repainted (a shop front, often: fresher than the coat above it)
  const wearK = { casona: 0.7, comercial: 0.85, vecindad: 1.25, barrio: 0.95, obra: 1.3 }[kind], fresh = cr() < 0.12;
  const repaint = !fresh && cr() < (bd.shops?.length ? 0.5 : 0.25) ? (cr() < 0.35 ? 3.42 : 2.3 + cr() * 0.6) : 0;
  st.age = [fresh ? 0.12 : wearK * (0.65 + 0.7 * cr()), fresh ? 0.3 : wearK * (0.55 + 0.9 * cr()), 1 + repaint];
  // the wall: smooth painted plaster; a worn tenement, an unfinished house or an odd barrio house has its paint peeling
  // off to the grey plaster (w_white: the tint takes only on the paint); the 1950s blocks have a smooth cement render
  const peel = !fresh && cr() < (kind === 'vecindad' ? 0.35 : kind === 'obra' ? 0.4 : kind === 'barrio' ? 0.15 : 0);
  // a dark colour flaking off grey plaster reads as salmon pink: a peeling wall keeps to the mid tones
  if (peel && (tone === 'terracotta' || accent)) {
    const hr = rng(Math.floor(hash(bd.x0, bd.z1, 23) * 1e9) + 5);
    tone = ['sand', 'ochre', 'straw', 'beige'][Math.floor(hr() * 4)]; accent = null;
    a = jitter(TONES[tone], hr); cool = COOL.has(tone);
  }
  const b = ownB ? deepen(a) : DEEP[deepK];
  const F = frames === 'white' ? WHITE : frames === 'stone' ? CANTERA : b;
  st.colors = { a, b, frames, f: F, wood: WOOD[woodK], tone, accent };
  st.wallKey = kind === 'comercial' ? 'w_plaster2' : peel ? 'w_white' : 'w_plaster';
  st.wallTile = st.wallKey === 'w_white' ? 5.2 : st.wallKey === 'w_plaster2' ? 3.2 : 2.9;
  st.tint = wallTint(a, st.wallKey);
  st.bandP = accentTint(b, 'paint');                                // the guardapolvo and its pin-line
  st.lineP = st.bandP.map(v => v * 0.72);
  // surrounds: white, cantera (the painted stand-in drawn far off is the stone's colour) or B
  const frame = mat => frames === 'b' ? accentTint(F, mat, 0.24) : tint(F, mat, 0.9, 0.025, frames === 'white' ? 0.62 : 0.5);
  st.frameP = frame('paint'); st.frameW = frame('w_plaster');
  st.trimC = frames === 'b' ? accentTint(b, 'concrete', 0.24) : tint(F, 'concrete', 0.9, 0.03, frames === 'white' ? 0.55 : 0.5);   // cornices, sills, slabs, balconies
  st.woodP = tint(st.colors.wood, 'planks', 0.75, 0.012, 0.22, 0.85);   // painted shutters and window frames (the plank texture takes paint)
  st.door = woodK === 'oxblood' ? [1.15, 0.9, 1.2] : woodK === 'dark' || woodK === 'grey' ? [0.62, 0.62, 0.62] : [1, 1, 1];   // over the door's own dark pine
  st.fascia = accentTint(b, 'paint', 0.3);
  st.stone = frames === 'stone';
  return st;
}

// A window's interior (the parallax room drawn behind its glass): a seed and the opening's size for the shader,
// and where the room's floor is below the glass. See the 'room' material.
export const roomData = (x, z, y, w, h, sill) => ({ x: [hash(x, z, y, 3), w, h], color: [Math.min(1, sill / 2), 0, 0] });
