// The market quarter (Barrio del Mercado), east of the covered market lane: the passages through the east ring, the
// market hall, the chapel and its atrium, the plazuela with its kiosk, and blocks of shops and houses. Everything here
// draws from its own random streams, so the old district is generated exactly as before.
//
//   x 31-46   the old east ring, cut by four passages (the two spawn streets and the two cross streets carry on east)
//   x 46-52   Calle del Mercado, along the ring's new east faces
//   x 55-83   the market hall (z -12…12); the chapel at x 76-90, z 15-25, at the head of Calle Norte (z 17-23)
//   x 70-90   the plazuela (z -45…-23) with the kiosk; blocks of houses and shops elsewhere
//   x 90-96   the east street; x 96-111 the new outer ring, with rows north and south (z ±63…±80)
import * as THREE from 'three';
import { rng } from './util.js';
import { dressKit } from './dressing.js';
import { signUV, SIGNS } from './mexico.js';
import { hash as fhash } from './facades.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export const QUARTER = { x0: 46, x1: 111 };
// Cobbled streets [x0, x1, z0, z1]. The passages through the old ring are added from the gates.
export const STREETS = [
  [46, 52, -63, 63],      // Calle del Mercado
  [46, 96, -63, -57],     // the south spawn street carried on east
  [46, 96, 57, 63],       // the north spawn street carried on east
  [46, 90, -23, -17],     // Calle Sur
  [46, 70, 17, 23],       // Calle Norte, opening into the chapel's atrium
  [90, 96, -57, 57],      // the east street
  [70, 76, 25, 57],       // the lane north of the atrium
];
export const HALL = { x0: 55, x1: 83, z0: -12, z1: 12 };
export const PLAZUELA = { x0: 70, x1: 90, z0: -45, z1: -23 };
export const ATRIUM = { x0: 70, x1: 76, z0: 15, z1: 25 };
// where a soldier can start in the quarter, and the places worth going to (for the bots' route picking)
export const QUARTER_SPAWNS = { 0: [[49, -60], [70, -60.5], [88, -60]], 1: [[49, 60], [70, 60.5], [88, 60]] };
export const QUARTER_HOTSPOTS = [[38.5, -59], [38.5, -20], [38.5, 20], [37, 58.5], [49, -40], [49, 0], [49, 40], [53.5, 0], [61, 0], [69, -5], [69, 5], [75.4, 0], [86.5, 0],
  [65.5, -14.5], [75.5, 14.5], [74.4, -34], [76, -27], [84, -41], [61, -40], [74.8, 17.6], [73, 40], [93, -30], [93, 30], [70, -60], [70, 60]];

export function buildQuarter({ B, M, buildings, anchors, ghosts, gates, architecture, FLOOR0, PARAPET }) {
  const rnd = rng(20261115), rs = rng(808), qAnchors = [];
  const qa = architecture(B, rnd, buildings, qAnchors, rs, { band: 0.8, surround: 0.6 });
  const K = dressKit({ B, M, rnd, buildings, anchors: qAnchors, rs });
  const { mat4, rod, cable, sheet, stall, palm, planter, crates, drums, barrier, car, sandbags } = K;
  const quad = (key, x0, z0, x1, z1, y, o) => B.quad(key, V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0), o);

  // =========================================== the old ring, rebuilt round the passages ============================
  const snap = z => { for (const g of ghosts) { if (Math.abs(g.z0 - z) < 0.06) return g.z0; if (Math.abs(g.z1 - z) < 0.06) return g.z1; } return z; };
  const passages = gates.map(([a, b]) => [snap(a), snap(b)]);
  for (const g of ghosts) {
    let spans = [[g.z0, g.z1]];
    for (const [a, b] of passages) spans = spans.flatMap(([s0, s1]) => (b <= s0 || a >= s1 ? [[s0, s1]] : [[s0, Math.min(s1, a)], [Math.max(s0, b), s1]]).filter(([p, q]) => q - p > 0.01));
    for (const [s0, s1] of spans) {
      if (s1 - s0 < 2.4) continue;
      const atS = passages.some(([, b]) => Math.abs(b - s0) < 0.06), atN = passages.some(([a]) => Math.abs(a - s1) < 0.06);
      const pieces = s1 - s0 > 14.5 ? [[s0, (s0 + s1) / 2], [(s0 + s1) / 2, s1]] : [[s0, s1]];
      pieces.forEach(([p0, p1], k) => qa.building(31, 46, p0, p1, { floors: g.floors, sides: 'we' + (k === 0 && atS ? 's' : '') + (k === pieces.length - 1 && atN ? 'n' : ''), street: { w: 'market', e: 'calle', n: 'cross', s: 'cross' }, shops: [{ side: 'e', bay: 0 }] }));
    }
  }
  // the ring houses that stay get the east faces they never had, now that they front a street
  for (const bd of buildings) if (bd.late === 'e' && !bd.ghost && bd.x0 === 31) { bd.sides += 'e'; bd.street.e = 'calle'; qa.facade(bd, 'e', true); }

  // =========================================== blocks of houses and shops =========================================
  const shopsAt = (k, side) => (k % 2 === 0 ? [{ side, bay: 1 }] : []);
  qa.row(52, 70, 23, 57, 'z', { sides: 'nsew', street: { w: 'calle', e: 'calle', s: 'cross', n: 'cross' }, min: 9, max: 13, each: k => ({ shops: shopsAt(k, 'w'), floors: rnd.pick([2, 3, 3]) }) });
  qa.row(76, 90, 28, 57, 'z', { sides: 'nsew', street: { w: 'calle', e: 'calle', s: 'lane', n: 'cross' }, min: 9, max: 15, each: k => ({ shops: k === 1 ? [{ side: 'w', bay: 1 }] : [], floors: rnd.pick([2, 3]) }) });
  qa.row(52, 70, -57, -41.5, 'z', { sides: 'nsew', street: { w: 'calle', e: 'calle', s: 'cross', n: 'lane' }, min: 7, max: 9, each: k => ({ shops: k === 0 ? [{ side: 'w', bay: 0 }] : [], floors: rnd.pick([2, 3]) }) });
  qa.row(52, 70, -38.5, -23, 'z', { sides: 'nsew', street: { w: 'calle', e: 'plaza', s: 'lane', n: 'cross' }, min: 7, max: 9, each: k => ({ shops: [{ side: 'e', bay: 0 }], floors: rnd.pick([2, 2, 3]) }) });
  qa.row(70, 90, -57, -45, 'x', { sides: 'nsew', street: { n: 'plaza', s: 'cross', w: 'calle', e: 'calle' }, min: 9, max: 11, each: k => ({ shops: [{ side: 'n', bay: k % 2 }], floors: rnd.pick([2, 3]) }) });
  // the new outer ring and the rows that close the quarter north and south
  qa.row(96, 111, -63, 63, 'z', { sides: 'w', street: { w: 'calle' }, min: 9, max: 15, each: k => ({ floors: rnd.pick([2, 3, 3, 4]), shops: k % 3 === 1 ? [{ side: 'w', bay: 1 }] : [] }) });
  qa.row(46, 111, 63, 80, 'x', { sides: 's', street: { s: 'cross' }, min: 9, max: 14, each: () => ({ floors: rnd.pick([2, 3, 3, 4]) }) });
  qa.row(46, 111, -80, -63, 'x', { sides: 'n', street: { n: 'cross' }, min: 9, max: 14, each: () => ({ floors: rnd.pick([2, 3, 3]) }) });

  // =========================================== paving ==============================================================
  const paved = [...STREETS];
  for (const [a, b] of passages) paved.push([31, 46, Math.ceil(a), Math.floor(b)]);                  // whole metres, so the ground grid meets it
  for (const [x0, x1, z0, z1] of paved) quad('cobble', x0, z0, x1, z1, 0.0, { tile: 2.6 });
  quad('cantera', PLAZUELA.x0, PLAZUELA.z0, PLAZUELA.x1, PLAZUELA.z1, 0.0, { tile: 3.0, color: [0.95, 0.86, 0.82] });       // stone flags
  quad('cantera', ATRIUM.x0, ATRIUM.z0, ATRIUM.x1, ATRIUM.z1, 0.0, { tile: 2.4, color: [0.92, 0.84, 0.80] });

  marketHall(); chapel(); plazuela(); atrium();

  // =========================================== street life ==========================================================
  K.dressAnchors(qAnchors);                                                     // doors, shops, walls, balconies, roofs of the new facades
  K.signs(qAnchors);
  for (const a of qAnchors) if (a.kind === 'wall' && a.bd && rs() < 0.14) K.bougainvillea(V(a.p.x + a.N.x * 0.05, a.bd.H + 0.4, a.p.z + a.N.z * 0.05), a.N, a.T, rs.range(1.6, 3.2), rs.range(2.4, 4.2));     // spilling over the parapet
  papelStreets();
  // cover and clutter along the new streets (cars, carts, crates, barriers), so the long views have places to break
  car(49.3, -32, 0.04); car(93.2, 22, -0.05); car(63, -60.6, Math.PI / 2 + 0.06); car(80.5, 59.4, Math.PI / 2 - 0.03);
  crates(49.8, 12, 0.3, 3); drums(50.4, -50, 2); barrier(58, -20.8, 1.52, true); barrier(64, 19.5, 1.6); crates(80, -21, 0.2, 2);
  sandbags(41, -21.5, 2.6, 4, 0.04); sandbags(41, 18.4, 2.6, 4, -0.05); crates(38, -61, 1.4, 2); barrier(39, 60.6, 0.1, true);
  drums(93.5, -50, 3); crates(93, 44, 0.6, 3); barrier(92.5, -6, 0.04, true);
  for (const [x, z, r] of [[61, -21.2, 0.1], [75, -18.6, Math.PI + 0.2], [57.5, 20.8, 0], [92.8, 9, Math.PI / 2]]) cart(x, z, r);
  poles();
  return { anchors: qAnchors, paved, rs, passages };

  // =========================================== the market hall =====================================================
  // An iron market hall in the manner of the early-1900s Mexican mercados: a raised central nave with an open
  // clerestory and skylights, lean-to side aisles on slim green-painted columns, a brick and stone portal facing Calle
  // del Mercado, low brick walls round the rest so it is open to the street above waist height, a terracotta floor,
  // islands of stalls and a canopy of papel picado.
  function marketHall() {
    const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = HALL, EAVE = 5.0, AISLE = 6.4, NAVE = 8.2, RIDGE = 9.8, NZ = 4;
    const green = { color: [0.55, 0.75, 0.6], tile: 1.2 }, steel = 'metal_green';
    quad('terracotta', X0, Z0, X1, Z1, 0.0, { tile: 1.8 });
    // columns on a 4 m grid along the length, on the nave lines and the outer walls
    for (let x = X0 + 4; x < X1 - 0.1; x += 4) for (const z of [Z0 + 0.2, -NZ, NZ, Z1 - 0.2]) {
      const h = Math.abs(z) < 5 ? NAVE : EAVE;
      B.box(steel, x, h / 2, z, 0.2, h, 0.2, green); B.box(steel, x, 0.35, z, 0.34, 0.7, 0.34, { color: [0.5, 0.7, 0.55], tile: 0.8 });
      B.collide(x, h / 2, z, 0.26, h, 0.26, 0, 'metal');
    }
    // brick corner piers and the low walls between the openings (waist high: cover, and room to shoot over)
    const brick = { tile: 1.6, color: [1.0, 0.93, 0.88] }, stone = { tile: 1.4, color: [1.0, 0.86, 0.82] };
    for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) { B.box('brick', x, (EAVE + 0.6) / 2, z, 1.1, EAVE + 0.6, 1.1, brick); B.box('cantera', x, EAVE + 0.65, z, 1.3, 0.12, 1.3, stone); B.collide(x, (EAVE + 0.6) / 2, z, 1.1, EAVE + 0.6, 1.1, 0, 'brick'); }
    const low = (xa, za, xb, zb) => {
      const cx = (xa + xb) / 2, cz = (za + zb) / 2, sx = Math.max(0.4, Math.abs(xb - xa)), sz = Math.max(0.4, Math.abs(zb - za));
      B.box('brick', cx, 0.5, cz, sx, 1.0, sz, brick); B.box('cantera', cx, 1.04, cz, sx + 0.08, 0.08, sz + 0.08, stone); B.collide(cx, 0.52, cz, sx, 1.04, sz, 0, 'brick');
    };
    const openings = { n: [[63, 67], [73, 77]], s: [[63, 67], [73, 77]], e: [[-3, 3]] };
    const run = (a0, a1, gaps, fn) => { let a = a0; for (const [g0, g1] of gaps) { if (g0 - a > 0.3) fn(a, g0); a = g1; } if (a1 - a > 0.3) fn(a, a1); };
    run(X0 + 0.55, X1 - 0.55, openings.n, (a, b) => low(a, Z1, b, Z1));
    run(X0 + 0.55, X1 - 0.55, openings.s, (a, b) => low(a, Z0, b, Z0));
    run(Z0 + 0.55, Z1 - 0.55, openings.e, (a, b) => low(X1, a, X1, b));
    run(Z0 + 0.55, Z1 - 0.55, [[-6, 6]], (a, b) => low(X0, a, X0, b));                                   // either side of the portal
    // brick fascia under the eaves all round
    for (const [xa, za, xb, zb] of [[X0, Z0, X1, Z0], [X0, Z1, X1, Z1], [X1, Z0, X1, Z1]]) B.box('brick', (xa + xb) / 2, EAVE - 0.4, (za + zb) / 2, Math.max(0.3, xb - xa), 0.8, Math.max(0.3, zb - za), brick);
    // the portal: a brick frontispiece with a round-headed arch in pink stone, a cornice, a clock and a stepped crest
    {
      const W = 6.2, T = 11.6, R0 = 2.6, spring = 4.1, d = 0.9, sh = new THREE.Shape();
      sh.moveTo(-W, 0); sh.lineTo(-R0, 0); sh.lineTo(-R0, spring); sh.absarc(0, spring, R0, Math.PI, 0, true); sh.lineTo(R0, 0); sh.lineTo(W, 0);
      sh.lineTo(W, T - 1.6); sh.lineTo(W - 1.2, T - 1.6); sh.lineTo(W - 1.2, T - 0.8); sh.lineTo(2.2, T - 0.8); sh.lineTo(2.2, T); sh.lineTo(-2.2, T); sh.lineTo(-2.2, T - 0.8); sh.lineTo(-W + 1.2, T - 0.8); sh.lineTo(-W + 1.2, T - 1.6); sh.lineTo(-W, T - 1.6); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 24 });
      B.geom('brick', g, new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(X0 + d / 2, 0, 0)), { uvScale: 1 / 1.6, color: brick.color });
      const ring = new THREE.Shape(); ring.absarc(0, spring, R0 + 0.45, Math.PI, 0, true); ring.lineTo(R0, spring); ring.absarc(0, spring, R0, 0, Math.PI, false); ring.closePath();
      for (const s of [-1, 1]) B.geom('cantera', new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false, curveSegments: 24 }), new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(X0 + s * (d / 2 + 0.04) + (s < 0 ? 0 : 0.08), 0, 0)), { uvScale: 1 / 1.2, color: stone.color });
      for (const z of [-R0 - 0.25, R0 + 0.25]) B.box('cantera', X0, spring / 2, z, d + 0.16, spring, 0.5, stone);                             // jambs
      for (const y of [7.4, T - 1.6 - 0.12]) B.box('cantera', X0, y, 0, d + 0.3, 0.24, W * 2 + 0.3, stone);                                 // cornices
      for (const z of [-W + 0.35, W - 0.35]) B.box('cantera', X0, (T - 1.6) / 2, z, d + 0.2, T - 1.6, 0.7, stone);                         // pilasters
      // the clock in the crest, and the name in painted letters across the frieze
      const cy = 10.8, clock = new THREE.CylinderGeometry(0.62, 0.62, 0.12, 32); clock.rotateZ(Math.PI / 2);
      B.geom('cantera', clock, mat4(V(X0 - d / 2 - 0.02, cy, 0)), { color: stone.color, uvScale: 0.5 });
      const face = new THREE.CircleGeometry(0.5, 32); face.rotateY(-Math.PI / 2);
      B.geom('matte', face, mat4(V(X0 - d / 2 - 0.09, cy, 0)), { color: [0.95, 0.93, 0.86] });
      for (let h = 0; h < 12; h++) { const a = h / 12 * Math.PI * 2; B.box('iron', X0 - d / 2 - 0.1, cy + Math.cos(a) * 0.41, Math.sin(a) * 0.41, 0.01, 0.08, 0.025); }
      rod(V(X0 - d / 2 - 0.11, cy, 0), V(X0 - d / 2 - 0.11, cy + 0.33, 0.12), 0.016); rod(V(X0 - d / 2 - 0.12, cy, 0), V(X0 - d / 2 - 0.12, cy - 0.14, -0.2), 0.014);
      const mi = SIGNS.findIndex(sg => sg.t === 'MERCADO'), sx = X0 - d / 2 - 0.015;                     // the name, painted in the frieze between the cornices
      B.quad('sign', V(sx, 7.62, -2.2), V(sx, 7.62, 2.2), V(sx, 9.72, 2.2), V(sx, 9.72, -2.2), { uv: signUV(mi) });
      B.collide(X0, spring / 2, -(W + R0) / 2, d, spring + 1, W - R0, 0, 'brick'); B.collide(X0, spring / 2, (W + R0) / 2, d, spring + 1, W - R0, 0, 'brick');
      B.collide(X0, (spring + R0 * 0.7 + T) / 2, 0, d, T - spring - R0 * 0.7, R0 * 2, 0, 'brick');
    }
    // the roof: a gabled nave over an open clerestory, lean-to aisles, iron trusses and purlins, skylights in alternate bays
    const L = X1 - X0;
    for (let i = 0; i < 7; i++) {
      const xa = X0 + i * 4, xb = xa + 4, sky = i % 2 === 1;
      for (const s of [-1, 1]) {
        // nave slope: from the eave line (|z| = NZ) up to the ridge; skylit bays leave a strip open by the ridge
        const zr = sky ? s * 1.3 : 0, yr = sky ? RIDGE - (RIDGE - NAVE) * 1.3 / NZ : RIDGE;
        B.quad('roof_tin', V(xa, NAVE, s * (NZ + 0.3)), V(xb, NAVE, s * (NZ + 0.3)), V(xb, yr, zr), V(xa, yr, zr), { tile: 1.2, color: [0.9, 0.9, 0.88] });
        // aisle slope: from under the clerestory down to the outer eave
        B.quad('roof_tin', V(xa, AISLE, s * (NZ - 0.1)), V(xb, AISLE, s * (NZ - 0.1)), V(xb, EAVE + 0.05, s * (Z1 + 0.5)), V(xa, EAVE + 0.05, s * (Z1 + 0.5)), { tile: 1.2, color: [0.86, 0.86, 0.84] });
      }
    }
    for (const s of [-1, 1]) {
      B.box('metal_white', (X0 + X1) / 2, NAVE - 0.05, s * NZ, L, 0.12, 0.16, { color: [0.6, 0.72, 0.62], tile: 1 });                        // nave eave beam
      B.box('metal_white', (X0 + X1) / 2, AISLE - 0.05, s * NZ, L, 0.12, 0.16, { color: [0.6, 0.72, 0.62], tile: 1 });
      for (let k = 1; k <= 3; k++) { const t = k / 4, y = NAVE + (RIDGE - NAVE) * t; B.box(steel, (X0 + X1) / 2, y - 0.12, s * NZ * (1 - t), L, 0.08, 0.08, green); }        // purlins
      for (let k = 1; k <= 3; k++) { const t = k / 4, y = AISLE + (EAVE - AISLE) * t; B.box(steel, (X0 + X1) / 2, y - 0.12, s * (NZ + (Z1 - NZ) * t), L, 0.08, 0.08, green); }
    }
    for (let x = X0 + 4; x < X1 - 0.1; x += 4) {                                // a truss on every column line
      const tr = (a, b) => rod(a, b, 0.035, steel, green.color);
      tr(V(x, NAVE, -NZ), V(x, NAVE, NZ)); tr(V(x, NAVE, -NZ), V(x, RIDGE - 0.15, 0)); tr(V(x, NAVE, NZ), V(x, RIDGE - 0.15, 0)); tr(V(x, NAVE, 0), V(x, RIDGE - 0.15, 0));
      for (const s of [-1, 1]) { tr(V(x, NAVE, s * NZ / 2), V(x, NAVE + (RIDGE - NAVE) / 2 - 0.1, s * NZ / 2)); tr(V(x, NAVE, 0), V(x, NAVE + (RIDGE - NAVE) / 2 - 0.1, s * NZ / 2)); tr(V(x, AISLE, s * NZ), V(x, EAVE - 0.05, s * (Z1 - 0.2))); tr(V(x, EAVE - 0.6, s * (Z1 - 0.2)), V(x, AISLE - 0.9, s * NZ)); }
    }
    // gable ends over the portal and the far wall, glazed in an arched lunette
    for (const x of [X0 + 0.3, X1 - 0.3]) {
      const gs = new THREE.Shape(); gs.moveTo(-NZ, 0); gs.lineTo(NZ, 0); gs.lineTo(0, RIDGE - NAVE); gs.closePath();
      B.geom('brick', new THREE.ExtrudeGeometry(gs, { depth: 0.3, bevelEnabled: false }), new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x + 0.15, NAVE, 0)), { uvScale: 1 / 1.6, color: brick.color });
      B.box('brick', x, (AISLE + NAVE) / 2, -NZ, 0.3, NAVE - AISLE, 0.4, brick); B.box('brick', x, (AISLE + NAVE) / 2, NZ, 0.3, NAVE - AISLE, 0.4, brick);
    }
    // stalls in islands, back to back, with aisles between them; signs hung over each, and bulbs on flex
    const goods = ['fruit', 'fruit', 'spice', 'pots', 'crates', 'fruit'];
    let n = 0;
    for (const zc of [-7.5, 0, 7.5]) for (const [xa, xb] of [[57.6, 63.2], [67.6, 73.2], [77.4, 81.4]]) {
      if (zc === 0 && xa < 60) continue;                                         // keep the portal's way in clear
      const w = (xb - xa) / Math.round((xb - xa) / 2.6);
      for (let x = xa + w / 2; x < xb; x += w) for (const s of [-1, 1]) {
        const z = zc + s * 0.78, rot = s < 0 ? Math.PI : 0;
        stall(x, z, rot, { w: w - 0.12, bare: true, tight: true, goods: rnd.pick(goods) });
        const si = rnd.pick([0, 1, 2, 3, 5, 11, 12, 14, 15, 19, 21, 22, 25]);
        const sx = x, sz = zc + s * 1.62, y0 = 2.35;
        const p = (u, v) => V(sx + u, y0 + v, sz);
        B.quad('sign', s > 0 ? p(-w * 0.4, 0) : p(w * 0.4, 0), s > 0 ? p(w * 0.4, 0) : p(-w * 0.4, 0), s > 0 ? p(w * 0.4, w * 0.4) : p(-w * 0.4, w * 0.4), s > 0 ? p(-w * 0.4, w * 0.4) : p(w * 0.4, w * 0.4), { uv: signUV(si) });
        for (const u of [-w * 0.35, w * 0.35]) rod(V(sx + u, y0 + w * 0.4, sz), V(sx + u, AISLE - 0.4, sz), 0.006, 'cable');
        n++;                                                                   // a bare bulb over every stall (the light bake takes them as lamps: 100 W market bulbs)
        { const b = V(x, 3.1, zc + s * 0.4); rod(b, V(b.x, Math.abs(zc) < 1 ? NAVE - 0.1 : AISLE - 0.5, b.z), 0.005, 'cable'); B.geom('bulb', new THREE.SphereGeometry(0.06, 10, 8), mat4(b)); B.lamp(b.x, b.y - 0.04, b.z, [1.6, 1.15, 0.69]); }
        if (n % 5 === 0) K.pinata(V(x + rnd.range(-0.5, 0.5), 3.7 + rnd.range(-0.2, 0.3), zc + s * 2.3), Math.abs(zc) < 1 ? NAVE - 0.2 : AISLE - 0.6, rnd);   // piñatas over the aisle
      }
    }
    // papel picado: strings across the nave and along the aisles
    for (let x = X0 + 2; x < X1 - 1; x += 2) papelString(V(x, NAVE - 0.18, -NZ + 0.1), V(x, NAVE - 0.18, NZ - 0.1), 1.25);
    const rafter = z => AISLE + (EAVE - AISLE) * (Math.abs(z) - NZ) / (Z1 - 0.2 - NZ);
    for (const z of [-8, 8]) for (let x = X0 + 4; x < X1 - 4.1; x += 4) papelString(V(x, rafter(z) - 0.1, z), V(x + 4, rafter(z) - 0.1, z), 0.45);
  }

  // =========================================== the chapel ===========================================================
  // A small parish chapel at the head of Calle Norte: a lime-washed nave with buttresses, a pink-stone doorway and
  // choir window, a curved bell gable (espadaña) with three bells, and a dome glazed in yellow and blue tiles.
  function chapel() {
    const X0 = 76, X1 = 90, Z0 = 15, Z1 = 25, H = 10.4, wall = { color: [1.18, 0.84, 0.42], tile: 3.4 }, stone = { color: [1.0, 0.86, 0.82], tile: 1.4 };       // ochre lime-wash, pink stone
    B.box('w_plaster', (X0 + X1) / 2, H / 2, (Z0 + Z1) / 2, X1 - X0, H, Z1 - Z0, { ...wall, skip: 'x' });                                    // nave (the west face is the frontispiece)
    B.collide((X0 + X1) / 2, H / 2, (Z0 + Z1) / 2, X1 - X0, H, Z1 - Z0, 0, 'plaster');
    for (let x = X0 + 2.5; x < X1; x += 3.5) for (const z of [Z0 - 0.35, Z1 + 0.35]) { B.box('w_plaster', x, 3.6, z, 0.9, 7.2, 0.7, wall); B.box('cantera', x, 7.25, z, 1.0, 0.14, 0.8, stone); B.collide(x, 3.6, z, 0.9, 7.2, 0.7, 0, 'plaster'); }
    B.box('cantera', (X0 + X1) / 2, H + 0.08, (Z0 + Z1) / 2, X1 - X0 + 0.3, 0.16, Z1 - Z0 + 0.3, stone);
    // frontispiece
    const F = X0 - 0.35, fw = Z1 - Z0 + 0.6;
    B.box('w_plaster', F + 0.175, 5.0, 20, 0.35, 10.0, fw, wall);
    const door = new THREE.Shape(); door.moveTo(-2.0, 0); door.lineTo(-1.35, 0); door.lineTo(-1.35, 3.1); door.absarc(0, 3.1, 1.35, Math.PI, 0, true); door.lineTo(1.35, 0); door.lineTo(2.0, 0); door.lineTo(2.0, 3.3); door.absarc(0, 3.3, 2.0, 0, Math.PI, false); door.closePath();
    B.geom('cantera', new THREE.ExtrudeGeometry(door, { depth: 0.22, bevelEnabled: false, curveSegments: 20 }), new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(F + 0.02, 0, 20)), { uvScale: 1 / 1.2, color: stone.color });
    const leaf = new THREE.Shape(); leaf.moveTo(-1.35, 0); leaf.lineTo(1.35, 0); leaf.lineTo(1.35, 3.1); leaf.absarc(0, 3.1, 1.35, 0, Math.PI, false); leaf.closePath();
    B.geom('door', new THREE.ShapeGeometry(leaf, 16), new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(F - 0.005, 0, 20)), { uvScale: 1 / 2.6, color: [0.55, 0.36, 0.22] });
    for (const z of [19.94, 20.06]) B.box('iron', F - 0.02, 1.6, z, 0.03, 3.0, 0.02);
    const oculus = new THREE.RingGeometry(0.65, 0.95, 28); oculus.rotateY(-Math.PI / 2);
    B.geom('cantera', oculus, mat4(V(F - 0.01, 7.0, 20)), { color: stone.color, uvScale: 1 });
    const glass = new THREE.CircleGeometry(0.66, 28); glass.rotateY(-Math.PI / 2); B.geom('glass', glass, mat4(V(F + 0.03, 7.0, 20)));
    for (const z of [Z0 - 0.1, Z1 + 0.1]) B.box('cantera', F, 5.2, z, 0.5, 10.4, 0.7, stone);                                                // corner pilasters
    B.box('cantera', F - 0.05, 9.9, 20, 0.5, 0.26, fw + 0.3, stone);                                                                         // cornice
    for (let k = 0; k < 7; k++) { const z = 15.2 + k * 1.6; B.box('talavera', F - 0.01, 9.42, z, 0.04, 0.5, 0.5, { uv: [0, 0.75, 0.25, 1] }); }   // a band of tiles under the cornice
    // the bell gable: a curved, stepped crest with three openings and bells
    {
      const g = new THREE.Shape(), b = 10.0;
      g.moveTo(-5.0, b); g.lineTo(5.0, b); g.lineTo(5.0, b + 1.2); g.quadraticCurveTo(4.2, b + 1.4, 3.6, b + 2.3); g.lineTo(3.6, b + 3.2);
      g.quadraticCurveTo(2.0, b + 3.4, 1.4, b + 4.4); g.quadraticCurveTo(0.8, b + 5.4, 0, b + 5.5); g.quadraticCurveTo(-0.8, b + 5.4, -1.4, b + 4.4); g.quadraticCurveTo(-2.0, b + 3.4, -3.6, b + 3.2);
      g.lineTo(-3.6, b + 2.3); g.quadraticCurveTo(-4.2, b + 1.4, -5.0, b + 1.2); g.closePath();
      for (const [z, y, r] of [[-2.4, b + 1.4, 0.55], [2.4, b + 1.4, 0.55], [0, b + 2.7, 0.7]]) { const hp = new THREE.Path(); hp.moveTo(z - r, y - 0.7); hp.lineTo(z + r, y - 0.7); hp.lineTo(z + r, y); hp.absarc(z, y, r, 0, Math.PI, false); hp.closePath(); g.holes.push(hp); }
      B.geom('w_plaster', new THREE.ExtrudeGeometry(g, { depth: 0.5, bevelEnabled: false, curveSegments: 14 }), new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(F + 0.5, 0, 20)), { uvScale: 1 / 4.6, color: wall.color });
      for (const [z, y] of [[-2.4, b + 0.85], [2.4, b + 0.85], [0, b + 2.05]]) {
        const bell = new THREE.LatheGeometry([[0, 0.5], [0.12, 0.48], [0.2, 0.36], [0.25, 0.1], [0.34, 0], [0.33, -0.03], [0, -0.03]].map(([a, c]) => new THREE.Vector2(a, c)), 16);
        B.geom('metal_plate', bell, mat4(V(F + 0.25, y - 0.5, 20 + z)), { color: [0.75, 0.55, 0.3], uvScale: 0.6 });
        rod(V(F + 0.25, y + 0.02, 20 + z - 0.5), V(F + 0.25, y + 0.02, 20 + z + 0.5), 0.03, 'planks', [0.5, 0.4, 0.3]);
      }
      const cross = (x, y, z, s) => { B.box('iron', x, y, z, 0.06 * s, 1.0 * s, 0.06 * s); B.box('iron', x, y + 0.18 * s, z, 0.06 * s, 0.06 * s, 0.6 * s); };
      cross(F + 0.25, b + 6.05, 20, 1);
    }
    // the dome over the east end: an octagonal drum with windows, glazed tiles, a lantern and a cross
    {
      const cx = 86.2, cz = 20, y0 = H, r = 3.2, PIECES = ['chapel_drum', 'chapel_dome', 'chapel_lantern'];
      B.swap(PIECES, () => {                                                   // far off, the plain drum, dome and lantern; near, the modelled ones (tools/blender/props.py)
        const drum = new THREE.CylinderGeometry(r + 0.1, r + 0.2, 1.6, 8, 1, true); B.geom('w_plaster', drum, mat4(V(cx, y0 + 0.8, cz), Math.PI / 8), { color: wall.color, uvScale: 1.5, uvScaleY: 0.4 });
        const lid = new THREE.CircleGeometry(r + 0.2, 8); lid.rotateX(-Math.PI / 2); B.geom('concrete', lid, mat4(V(cx, y0 + 0.02, cz), Math.PI / 8));
        for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4 + Math.PI / 8, p = V(cx + Math.sin(a) * (r + 0.13), y0 + 0.8, cz + Math.cos(a) * (r + 0.13)); B.box('dark', p.x, p.y, p.z, 0.5, 0.9, 0.5, { rot: a }); }
        B.geom('cantera', new THREE.CylinderGeometry(r + 0.45, r + 0.45, 0.16, 8), mat4(V(cx, y0 + 1.66, cz), Math.PI / 8), { color: stone.color, uvScale: 2 });
        const dome = new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        B.geom('talavera', dome, mat4(V(cx, y0 + 1.72, cz), 0, V(1, 1.12, 1)), { uvScale: 24, uvScaleY: 8, cf: i => (Math.floor(i / 25) % 3 === 1 ? [0.5, 0.64, 1.05] : [1.08, 0.84, 0.34]) });     // yellow glaze with a band of cobalt (rows of 25 vertices)
        B.geom('w_plaster', new THREE.CylinderGeometry(0.5, 0.55, 1.1, 8), mat4(V(cx, y0 + 1.72 + r * 1.12 + 0.5, cz)), { color: wall.color, uvScale: 1 });
        B.geom('talavera', new THREE.ConeGeometry(0.62, 0.8, 8), mat4(V(cx, y0 + 1.72 + r * 1.12 + 1.45, cz)), { uvScale: 1.5 });
        B.box('iron', cx, y0 + 1.72 + r * 1.12 + 2.3, cz, 0.06, 1.0, 0.06); B.box('iron', cx, y0 + 1.72 + r * 1.12 + 2.5, cz, 0.06, 0.06, 0.55);
      }, () => {
        const slots = { wall: 'w_plaster', stone: 'cantera', glass: 'glass', iron: 'iron', glaze_y: 'talavera', glaze_b: 'talavera', dark: 'dark' };
        const o = { lod: 'near', slot: { wall: { ...wall }, stone: { ...stone }, glass: {}, iron: {}, dark: {}, glaze_y: { uv: 'own', tile: 1, color: [1.08, 0.84, 0.34] }, glaze_b: { uv: 'own', tile: 1, color: [0.5, 0.64, 1.05] } } };
        for (const n of PIECES) B.kit(n, mat4(V(cx, y0, cz)), slots, o);
      });
    }
  }

  // =========================================== the atrium before the chapel =====================================
  function atrium() {
    const stone = { color: [0.98, 0.86, 0.82], tile: 1.2 };
    // the atrial cross on a stepped base: a landmark, and cover in the middle of the square
    for (const [s, h, y] of [[2.0, 0.3, 0.15], [1.4, 0.3, 0.45], [0.8, 0.9, 1.05]]) { B.box('cantera', 72.6, y, 20, s, h, s, stone); }
    B.collide(72.6, 0.75, 20, 1.4, 1.5, 1.4, 0, 'concrete'); B.collide(72.6, 0.3, 20, 2.0, 0.6, 2.0, 0, 'concrete');
    B.box('cantera', 72.6, 2.4, 20, 0.22, 1.8, 0.22, stone); B.box('cantera', 72.6, 2.85, 20, 0.22, 0.22, 0.9, stone);
    for (const z of [15.6, 24.4]) { laurel(73, z, 1.0); B.box('cantera', 73, 0.25, z, 1.6, 0.5, 1.6, stone); B.collide(73, 0.25, z, 1.6, 0.5, 1.6, 0, 'concrete'); }
    for (const [x, z, r] of [[70.6, 15.8, 0], [70.6, 24.2, 0]]) bench(x, z, r);
  }

  // =========================================== the plazuela and its kiosk ======================================
  function plazuela() {
    const { x0, x1, z0, z1 } = PLAZUELA, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, stone = { color: [0.98, 0.86, 0.82], tile: 1.2 };
    // the kiosk: an octagonal stone platform with two flights of steps, slim iron columns, a railing and a tin roof
    const R0 = 3.6, Hp = 0.76, oct = (r, y, h, key, o) => B.geom(key, new THREE.CylinderGeometry(r, r, h, 8), mat4(V(cx, y, cz), Math.PI / 8), o);
    oct(R0, Hp / 2, Hp, 'cantera', { ...stone, uvScale: 2 }); oct(R0 + 0.12, Hp + 0.03, 0.06, 'cantera', { ...stone, uvScale: 2 });
    B.quad('terracotta', V(cx - 2.4, Hp + 0.065, cz + 2.4), V(cx + 2.4, Hp + 0.065, cz + 2.4), V(cx + 2.4, Hp + 0.065, cz - 2.4), V(cx - 2.4, Hp + 0.065, cz - 2.4), { tile: 1.2 });
    const ri = R0 * Math.cos(Math.PI / 8), side = 2 * ri * Math.tan(Math.PI / 8);  // across the flats; one side
    // four bands, one per pair of opposite sides, are the octagon exactly (two squares would make an eight-pointed star
    // reaching 1.4 m past the drawn edge); the top is the drawn slab's, 0.82 m
    for (let k = 0; k < 4; k++) B.collide(cx, (Hp + 0.06) / 2, cz, ri * 2, Hp + 0.06, side, k * Math.PI / 4, 'concrete');
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {                       // steps, 19 cm each (soldiers walk up them)
      const h = Hp * (i + 1) / 4, x = cx + s * (ri + 0.16 + (3 - i) * 0.32);
      B.box('cantera', x, h / 2, cz, 0.32, h, 1.8, stone); B.collide(x, h / 2, cz, 0.32, h, 1.8, 0, 'concrete');
    }
    const top = Hp + 0.06, Hc = 3.4;
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + k * Math.PI / 4, px = cx + Math.cos(a) * (R0 - 0.3), pz = cz + Math.sin(a) * (R0 - 0.3);
      B.swap('kiosk_column', () => B.geom('metal_green', new THREE.CylinderGeometry(0.07, 0.09, Hc, 10), mat4(V(px, top + Hc / 2, pz)), { color: [0.55, 0.72, 0.6], uvScale: 0.5, uvScaleY: Hc }),
        () => B.kit('kiosk_column', mat4(V(px, top, pz)), { iron: 'metal_green' }, { lod: 'near', slot: { iron: { color: [0.55, 0.72, 0.6], tile: 1 } } }));   // a cast-iron column near (tools/blender/props.py)
      B.rail(px, top + Hc / 2, pz, 0.18, Hc, 0.18, a);                          // (a slim post: no cover either)
      const a2 = a + Math.PI / 4, qx = cx + Math.cos(a2) * (R0 - 0.3), qz = cz + Math.sin(a2) * (R0 - 0.3);
      const stair = Math.abs(Math.cos((a + a2) / 2)) > 0.9;                       // the two sides with steps are left open
      if (!stair) {
        rod(V(px, top + 0.95, pz), V(qx, top + 0.95, qz), 0.025, 'iron'); rod(V(px, top + 0.1, pz), V(qx, top + 0.1, qz), 0.02, 'iron'); for (let t = 0.1; t < 0.95; t += 0.12) { const bx = px + (qx - px) * t, bz = pz + (qz - pz) * t; rod(V(bx, top + 0.1, bz), V(bx, top + 0.95, bz), 0.01, 'iron'); }
        // the railing stops a soldier walking or climbing through it (it was drawn only); still no cover and no wall to sight
        const ux = qx - px, uz = qz - pz, len = Math.hypot(ux, uz);
        B.rail((px + qx) / 2, top + 0.5, (pz + qz) / 2, len + 0.1, 1.0, 0.12, Math.atan2(-uz / len, ux / len));
      }
      rod(V(px, top + Hc - 0.35, pz), V(qx, top + Hc - 0.35, qz), 0.03, 'metal_green', [0.55, 0.72, 0.6]);
    }
    B.swap(['kiosk_roof', 'kiosk_bracket'], () => {                           // far off, a cone and a ball; near, pressed tin, a valance and scrolled brackets (tools/blender/props.py)
      const roof = new THREE.ConeGeometry(R0 + 0.6, 1.9, 8, 1, true), under = roof.clone();                  // painted sheet metal, and its underside
      { const ix = under.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } const nr = under.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i)); }
      for (const g of [roof, under]) B.geom('metal_green', g, mat4(V(cx, top + Hc + 0.95, cz), Math.PI / 8), { uvScale: 8, uvScaleY: 1.6, color: [0.8, 0.95, 0.82] });
      B.geom('metal_green', new THREE.SphereGeometry(0.22, 10, 8), mat4(V(cx, top + Hc + 2.0, cz)), { color: [0.75, 0.62, 0.3] });
    }, () => {
      const tin = [0.8, 0.95, 0.82];
      B.kit('kiosk_roof', mat4(V(cx, top, cz)), { tin: 'metal_green', trim: 'metal_green', finial: 'metal_green' }, { lod: 'near', slot: { tin: { color: tin, tile: 2 }, trim: { color: tin, tile: 1.5 }, finial: { color: [0.75, 0.62, 0.3], tile: 0.5 } } });
      for (let k = 0; k < 8; k++) B.kit('kiosk_bracket', mat4(V(cx, top, cz), -(Math.PI / 8 + k * Math.PI / 4)), { iron: 'metal_green' }, { lod: 'near', slot: { iron: { color: [0.55, 0.72, 0.6], tile: 1 } } });
    });
    // laurels at the corners, benches round the edge, a fountain basin-cum-planter and food under umbrellas
    for (const [x, z] of [[x0 + 3, z0 + 3], [x1 - 3, z0 + 3], [x0 + 3, z1 - 3], [x1 - 3, z1 - 3]]) { laurel(x, z, rnd.range(0.9, 1.15)); B.box('cantera', x, 0.22, z, 1.7, 0.44, 1.7, stone); B.collide(x, 0.22, z, 1.7, 0.44, 1.7, 0, 'concrete'); }
    for (const [x, z, r] of [[cx - 6, z0 + 1.1, 0], [cx + 6, z0 + 1.1, 0], [cx - 6, z1 - 1.1, Math.PI], [cx + 6, z1 - 1.1, Math.PI], [x1 - 1.1, cz, -Math.PI / 2]]) bench(x, z, r);
    for (const [x, z] of [[x0 + 2.6, cz - 3], [x0 + 2.6, cz + 3.4]]) umbrella(x, z);
    stall(x0 + 1.4, cz + 0.2, Math.PI / 2, { w: 2.4, goods: 'fruit' });
    for (const dz of [-0.8, 0.5]) K.pinata(V(x0 + 2.25, 1.95, cz + 0.2 + dz), 2.2, rnd);
    for (const [x, z] of [[x0 + 5.0, cz - 4.2], [x0 + 5.4, cz + 2.4]]) table(x, z);
  }

  // =========================================== pieces ================================================================
  // An Indian laurel fig, the shade tree of Mexican plazas. Far off, a fluted trunk, limb rods and leaf cards; near, the
  // modelled fig (tools/blender/props.py): a buttressed trunk, branching limbs and a clipped dome of single leaves.
  function laurel(x, z, s = 1) {
    const v = fhash(x, z, 60) < 0.5 ? 'laurel_a' : 'laurel_b';
    B.swap(v, () => {
      const h = 2.6 * s, top = V(x, h, z);
      const trunk = new THREE.CylinderGeometry(0.24 * s, 0.4 * s, h, 10, 3); const tp = trunk.attributes.position;
      for (let i = 0; i < tp.count; i++) { const a = Math.atan2(tp.getZ(i), tp.getX(i)); tp.setX(i, tp.getX(i) * (1 + 0.12 * Math.sin(a * 3))); }
      trunk.computeVertexNormals();
      B.geom('bark', trunk, mat4(V(x, h / 2, z)), { color: [0.78, 0.74, 0.68], uvScale: 1.5, uvScaleY: 1 });
      for (let k = 0; k < 4; k++) { const a = k * 1.6 + rnd() * 0.5; rod(V(x, h * 0.85, z), V(x + Math.cos(a) * 1.5 * s, h + 0.9 * s, z + Math.sin(a) * 1.5 * s), 0.11 * s, 'bark', [0.75, 0.72, 0.66]); }
      B.collide(x, h / 2, z, 0.6 * s, h, 0.6 * s, 0, 'wood');
      const R = 3.0 * s, cy = h + 1.6 * s, n = 64;
      for (let i = 0; i < n; i++) {                                               // cards scattered over an ellipsoid shell, facing outward, plus a few inside
        const yv = 1 - (i + 0.5) / n * 1.7, rr = Math.sqrt(Math.max(0, 1 - yv * yv)), a = i * 2.39996 + rnd() * 0.3, depth = i % 5 === 0 ? 0.5 : 0.92;
        const p = V(x + Math.cos(a) * rr * R * depth, cy + yv * R * 0.62 * depth, z + Math.sin(a) * rr * R * depth), sz = rnd.range(1.5, 2.2) * s;
        const g = new THREE.PlaneGeometry(sz, sz, 2, 2); g.lookAt(V(Math.cos(a) * rr, yv * 0.6 + 0.2, Math.sin(a) * rr));
        g.rotateZ(rnd() * 6.28);
        const tint = rnd.range(0.8, 1.05), wind = [];
        for (let k = 0; k < g.attributes.position.count; k++) wind.push(0.5 + rnd() * 0.5);
        B.geom('leaves', g, mat4(p), { color: [tint * 0.95, tint, tint * 0.85], xf: k => [wind[k], i * 0.7, 0] });
      }
    }, () => B.kit(v, mat4(V(x, 0, z), fhash(x, z, 61) * 6.28, s), { bark: 'bark', leaf: 'leaf' },
      { lod: 'near', slot: { bark: { uv: 'own', tile: 1.5, color: [0.78, 0.74, 0.68] }, leaf: { uv: 'own', tile: 1, wind: fhash(x, z, 62) * 6.28 } } }));
  }

  function bench(x, z, rot) {
    const c = Math.cos(rot), s = Math.sin(rot), o = { rot, tile: 1.2, color: [0.98, 0.88, 0.84] };
    B.box('cantera', x, 0.42, z, 1.9, 0.08, 0.5, o);
    for (const u of [-0.75, 0.75]) B.box('cantera', x + u * c, 0.2, z - u * s, 0.14, 0.4, 0.42, o);
    B.box('cantera', x - 0.22 * s, 0.75, z - 0.22 * c, 1.9, 0.5, 0.06, o);
    B.collide(x, 0.24, z, 1.9, 0.48, 0.5, rot, 'concrete');
  }
  function umbrella(x, z) {
    const col = rnd.pick([[0.95, 0.75, 0.15], [0.85, 0.2, 0.15], [0.2, 0.45, 0.8], [0.25, 0.65, 0.3]]), r = 1.35, ph = rnd() * 6.28;
    rod(V(x, 0, z), V(x, 2.3, z), 0.025, 'metal_white', [0.8, 0.8, 0.8]);
    for (let k = 0; k < 8; k++) {
      const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2, g = new THREE.BufferGeometry(), t = 2.45, e = 2.0;
      g.setAttribute('position', new THREE.Float32BufferAttribute([x, t, z, x + Math.cos(a0) * r, e, z + Math.sin(a0) * r, x + Math.cos(a1) * r, e, z + Math.sin(a1) * r], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 1, 0, 0, 1, 0], 2)); g.setIndex([0, 2, 1]); g.computeVertexNormals();
      const c2 = k % 2 ? [0.95, 0.94, 0.9] : col;
      B.geom('cloth_plain', g, new THREE.Matrix4(), { color: c2, xf: i => [i ? 0.2 : 0, ph, 0] });
    }
    B.detail(x, 1.1, z, 0.12, 2.2, 0.12, 0, 'metal');
  }
  function table(x, z) {                                                         // a plastic table (painted) with chairs round it
    const col = rnd.pick([[0.85, 0.15, 0.12], [0.12, 0.35, 0.75], [0.95, 0.95, 0.95]]);
    B.box('plastic', x, 0.72, z, 0.8, 0.04, 0.8, { color: col }); for (const [u, v] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) B.box('plastic', x + u, 0.36, z + v, 0.04, 0.72, 0.04, { color: col });
    B.collide(x, 0.37, z, 0.8, 0.74, 0.8, 0, 'wood');
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + rnd.range(-0.3, 0.3); B.prop('chair', x + Math.sin(a) * 0.85, 0, z + Math.cos(a) * 0.85, a + Math.PI + rnd.range(-0.3, 0.3)); }
  }
  // A street vendor's cart: a painted box on bicycle wheels with a little tin roof (corn, fruit cups, ice).
  function cart(x, z, rot) {
    const c = Math.cos(rot), s = Math.sin(rot), L = (lx, ly, lz) => V(x + lx * c + lz * s, ly, z - lx * s + lz * c), col = rnd.pick([[0.95, 0.75, 0.2], [0.2, 0.55, 0.85], [0.9, 0.3, 0.25], [0.3, 0.7, 0.4]]);
    B.swap('cart', () => {                                                       // far off, a painted box on rings; near, the modelled cart (tools/blender/props.py)
      const bx = L(0, 0.75, 0); B.box('metal_white', bx.x, bx.y, bx.z, 1.5, 0.7, 0.8, { rot, color: col, tile: 1 });
      const tp = L(0, 1.12, 0); B.box('metal_plate', tp.x, tp.y, tp.z, 1.56, 0.04, 0.86, { rot, tile: 1 });
      for (const [lx, lz] of [[-0.55, -0.42], [-0.55, 0.42], [0.6, 0]]) { const w = new THREE.TorusGeometry(0.28, 0.025, 6, 18); const m = mat4(L(lx, 0.3, lz), rot); B.geom('cable', w, m); }
      for (const [lx, lz] of [[-0.7, -0.38], [0.7, -0.38], [-0.7, 0.38], [0.7, 0.38]]) rod(L(lx, 1.12, lz), L(lx, 2.0, lz), 0.015, 'iron');
      const rf = L(0, 2.05, 0); B.box('corrugated', rf.x, rf.y, rf.z, 1.8, 0.03, 1.05, { rot, tile: 1.2, color: [0.9, 0.9, 0.9] });
    }, () => B.kit('cart', mat4(V(x, 0, z), rot), { body: 'metal_white', steel: 'metal_plate', tin: 'roof_tin', iron: 'iron', rubber: 'cable', bottle: 'metal_white', plastic: 'plastic', pot: 'glossy' },
      { lod: 'near', slot: { body: { color: col, tile: 1 }, steel: { tile: 1 }, tin: { tile: 1.2, color: [0.9, 0.9, 0.9] }, iron: {}, rubber: {}, bottle: { color: [0.72, 0.74, 0.72], tile: 0.6 }, plastic: { color: [0.92, 0.94, 0.96] }, pot: { color: [0.78, 0.8, 0.82] } } }));
    B.collide(x, 0.6, z, 1.5, 1.2, 0.8, rot, 'metal');
    const si = rnd.pick([11, 12, 28, 25]), q = (u, v) => L(u, 0.48 + v, 0.405 + 0.012);
    B.quad('sign', q(-0.6, 0), q(0.6, 0), q(0.6, 0.6), q(-0.6, 0.6), { uv: signUV(si) });
  }

  function papelString(a, b, sag) { K.papel(a, b, sag, rnd); }                  // (a declaration: the helpers below run before this line is reached)
  // strings of papel picado across the new streets and the passages, between facing walls
  function papelStreets() {
    const ok = (lo, hi, ranges) => ranges.some(([a, b]) => lo >= a && hi <= b);
    for (let z = -56; z <= 56; z += rnd.range(7, 10)) if (ok(z - 1, z + 1, [[-57, -23], [23, 57]])) papelString(V(46.1, rnd.range(5.2, 6.2), z), V(51.9, rnd.range(5.2, 6.2), z + rnd.range(-0.8, 0.8)), rnd.range(0.4, 0.8));
    for (const s of [-1, 1]) for (let x = 56; x < 70; x += rnd.range(4, 6)) papelString(V(x, 4.95, s * (HALL.z1 + 0.45)), V(x + rnd.range(-0.8, 0.8), 5.7, s * 22.95), rnd.range(0.6, 1.0));     // hall eave to the houses
    for (const zc of [-60, 60]) for (let x = 54; x < 89; x += rnd.range(6, 9)) if (zc < 0 || ok(x - 1, x + 1, [[52, 70], [76, 90]])) papelString(V(x, 5.8, zc - 2.9), V(x + rnd.range(-0.8, 0.8), 5.6, zc + 2.9), rnd.range(0.5, 0.9));
    for (let z = -55; z < 56; z += rnd.range(6, 9)) if (ok(z - 1, z + 1, [[-57, -45], [15, 25], [28, 57]])) papelString(V(90.1, 5.6, z), V(95.9, 5.8, z + rnd.range(-0.8, 0.8)), rnd.range(0.4, 0.8));
    for (const [a, b] of passages) for (const x of [34, 39.5, 44.5]) papelString(V(x, 6.0, a + 0.1), V(x + 0.5, 6.0, b - 0.1), 0.6);
    // criss-crossed over the plazuela, from the top of the kiosk roof to the houses round it
    const { x0, x1, z0, z1 } = PLAZUELA, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const [x, z] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [cx, z0 + 0.1], [x0 + 0.1, cz]]) papelString(V(cx, 5.9, cz), V(x, 6.3, z), 0.8);
  }
  // Wooden utility poles with transformers and a tangle of service cables to the houses.
  function poles() {
    const near = (x, z) => buildings.filter(b => !b.ghost).map(b => { const qx = Math.min(b.x1, Math.max(b.x0, x)), qz = Math.min(b.z1, Math.max(b.z0, z)); return { b, qx, qz, d: Math.hypot(qx - x, qz - z) }; }).filter(o => o.d > 1).sort((p, q) => p.d - q.d);
    for (const [x, z] of [[51.6, -40], [51.6, 3], [51.6, 44], [95.6, -24], [95.6, 26], [66, -57.4], [66, 57.4]]) {
      B.replace('pole_quarter', () => {                                      // the modelled pole (tools/blender/props.py) where the old rod, plank and drum were
        rod(V(x, 0, z), V(x, 8.8, z), 0.12, 'planks', [0.45, 0.4, 0.35]);
        B.box('planks', x, 8.2, z, 1.8, 0.1, 0.1, { tile: 1, color: [0.45, 0.4, 0.35] });
        B.geom('metal_white', new THREE.CylinderGeometry(0.28, 0.28, 0.75, 12), mat4(V(x + 0.35, 6.9, z)), { color: [0.62, 0.64, 0.62] });
      }, () => B.kit('pole_quarter', mat4(V(x, 0, z)), { wood: 'planks', iron: 'iron', tank: 'metal_white', porcelain: 'glossy' },
        { lod: null, slot: { wood: { uv: 'own', tile: 1, color: [0.45, 0.4, 0.35] }, iron: {}, tank: { tile: 1, color: [0.62, 0.64, 0.62] }, porcelain: { color: [0.9, 0.92, 0.95] } } }));
      B.collide(x, 4.4, z, 0.28, 8.8, 0.28, 0, 'wood');
      for (const [i, o] of near(x, z).slice(0, 5).entries()) cable(V(x + (i - 2) * 0.35, 8.25, z), V(o.qx, o.b.H - rnd.range(0.3, 1.0), o.qz), rnd.range(0.3, 0.8));
    }
  }
}
