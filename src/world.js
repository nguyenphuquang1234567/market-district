// The map: ground, buildings (with real window/door depth), the arch and plaza. Dressing lives in dressing.js.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Builder } from './builder.js';
import { NavGrid, OVERHANG } from './physics.js';
import { dress } from './dressing.js';
import { buildQuarter, HALL, PLAZUELA, ATRIUM, QUARTER_SPAWNS, QUARTER_HOTSPOTS } from './quarter.js';
import { rng, clamp } from './util.js';
import { facadeStyle, roomData, tint, hash as fhash } from './facades.js';
import { noise, FOLIAGE } from './materials.js';
import { BATCH, batchWorld } from './batch.js';
import { assets, ARCH } from './assets.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const FLOOR0 = 3.5, FLOORN = 3.05, PARAPET = 0.95, SIDEWALK = 0.14;
// Passages (z ranges) cut through the east ring (x 31-46) into the new quarter: the two spawn streets and the two cross
// streets carry on east. Their edges sit on the ring's own building joints, so no sliver of a house is left standing.
export const GATES = [[-63, -55.57], [-23.27, -17], [17, 23], [57, 63]];

// Lime-washed walls of a Mexican market town: terracotta, mustard, cobalt, white, coral, turquoise, cream on the painted
// plaster; ochre, lavender, rosa, lime and a sun yellow on the grey plaster (its tints run brighter to lift the grey).
const PLASTER_TINTS = [[1.02, 0.50, 0.33], [1.08, 0.80, 0.36], [0.46, 0.62, 1.0], [1.0, 0.98, 0.93], [1.06, 0.60, 0.48], [0.50, 0.92, 0.86], [1.04, 0.94, 0.78]];
const GREY_TINTS = [[1.30, 0.94, 0.48], [1.02, 0.92, 1.25], [1.30, 0.70, 0.80], [0.95, 1.20, 0.62], [1.32, 1.18, 0.62]];
// painted base bands and window surrounds: maroon, bottle green, cobalt, ochre, slate, oxblood, white
const BANDS = [[0.42, 0.12, 0.10], [0.16, 0.34, 0.20], [0.16, 0.24, 0.52], [0.78, 0.50, 0.16], [0.34, 0.36, 0.38], [0.52, 0.16, 0.14], [0.96, 0.95, 0.92]];
const STYLES = [
  { wall: 'w_plaster', tints: PLASTER_TINTS }, { wall: 'w_plaster', tints: PLASTER_TINTS }, { wall: 'w_plaster', tints: PLASTER_TINTS },
  { wall: 'w_plaster2', tints: GREY_TINTS }, { wall: 'w_plaster2', tints: GREY_TINTS },
  { wall: 'w_plaster', tints: PLASTER_TINTS }, { wall: 'w_plaster2', tints: GREY_TINTS }, { wall: 'w_white', tints: [[1, 0.98, 0.93], [0.98, 0.92, 0.80]], tile: 5.2 },
  { wall: 'w_peel', tints: [[1, 1, 1], [1.05, 0.95, 0.86]], tile: 3.6 }, { wall: 'w_blue', tints: [[1, 1, 1], [0.92, 0.97, 1.04]], tile: 3.4 },
  { wall: 'w_red', tints: [[1.05, 0.98, 0.92]], tile: 3.4 },
  { wall: 'w_damaged', tints: [[1, 0.98, 0.94]], tile: 4.6 }, { wall: 'w_broken', tints: [[1, 1, 1]], tile: 4.4 },
];
const SHUTTER_TINTS = [[0.35, 0.55, 0.50], [0.42, 0.52, 0.70], [0.75, 0.62, 0.45], [0.55, 0.36, 0.28], [0.85, 0.85, 0.80], [0.38, 0.46, 0.34]];
// The architectural kit (assets/kit/kit.glb, see builder.kit) chooses by position, never from the random streams, so the
// district's layout, cover, dressing and routes are exactly what they were without it.
const hash = (...a) => { let h = 2166136261; for (const v of a) { h ^= Math.round(v * 997) | 0; h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000003) / 1000003; };
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const NEXT = { n: 'e', e: 's', s: 'w', w: 'n' }, PREV = { n: 'w', e: 'n', s: 'e', w: 's' };
const TEJA = [1.05, 0.66, 0.47];                     // fired clay over the sandstone texture's grain
const METAL_TINTS = [[1, 1, 1], [0.75, 0.85, 0.95], [0.85, 0.95, 0.8], [1, 0.9, 0.75], [0.7, 0.72, 0.75]];

function frame(side, b) {
  switch (side) {
    case 'e': return { O: V(b.x1, 0, b.z1), T: V(0, 0, -1), N: V(1, 0, 0), L: b.z1 - b.z0 };
    case 'w': return { O: V(b.x0, 0, b.z0), T: V(0, 0, 1), N: V(-1, 0, 0), L: b.z1 - b.z0 };
    case 'n': return { O: V(b.x0, 0, b.z1), T: V(1, 0, 0), N: V(0, 0, 1), L: b.x1 - b.x0 };
    default: return { O: V(b.x1, 0, b.z0), T: V(-1, 0, 0), N: V(0, 0, -1), L: b.x1 - b.x0 };
  }
}

// How far away a merged cell of each material is still worth drawing (metres from the camera to the cell's bounds; the
// renderer scales it per quality preset). Walls, roofs, ground and paving are always drawn; small things go first.
// Small props and set dressing that is a few pixels across at that distance are not missed, and cost a draw call per cell.
const LOD = {
  d_stain: 45, d_patch: 45, d_scars: 35, matte: 40, glossy: 60, flowers: 90, cable: 70, bulb: 45, cloth_papel: 75, sign: 70, iron: 70, planks: 75, door: 80, dark: 80, glass: 85,
  shutter_wood: 80, shutter_metal: 85, shutter_paint: 85, metal_white: 80, metal_green: 90, metal_plate: 70, corrugated: 85, tiles: 55, interior: 55, burlap: 55,
  rubble: 70, plastic: 60, cloth_red: 90, cloth_green: 90, cloth_plain: 90, cloth_tarp: 95, rug: 70, paper: 60,
};
export const lodRange = m => {
  if (m.name.startsWith('prop:')) return m.userData.noShadow ? 45 : 100;                   // small props (odd chunks) and the rest
  return LOD[m.name] || 0;
};

// The district's architecture: facades, walk-in shops, buildings and rows of them, drawn into B with one random stream.
// The old district and the new quarter each get their own (see buildWorld), so adding to one never reshuffles the other.
// rs: a separate style stream for the decorative layer (painted base bands, window surrounds); it never touches rnd.
export function architecture(B, rnd, buildings, anchors, rs = null, style = { band: 0, surround: 0 }) {
  // ---------------------------------------------------------------------------------------------- facade --------
  // force: draw a side that was deferred (bd.late), with this architecture's random stream.
  function facade(bd, side, force = false) {
    if (!force && bd.late && bd.late.includes(side)) return;
    const { O, T, N, L } = frame(side, bd);
    const H = bd.H, wall = bd.wall, wo = { color: bd.tint, tile: bd.tile, uo: bd.uo, vo: bd.vo, x: bd.age };   // x: the paint's age (facades.js, the wall shader)
    const P = (u, v, d = 0) => V(O.x + T.x * u - N.x * d, v, O.z + T.z * u - N.z * d);
    const Q = (key, u0, v0, u1, v1, d = 0, o = wo) => B.quad(key, P(u0, v0, d), P(u1, v0, d), P(u1, v1, d), P(u0, v1, d), o);
    const FB = (key, u0, v0, u1, v1, d0, d1, o = {}) => {
      const c = P((u0 + u1) / 2, (v0 + v1) / 2, (d0 + d1) / 2), du = u1 - u0, dd = Math.abs(d1 - d0), ax = Math.abs(T.x) > 0.5;
      B.box(key, c.x, c.y, c.z, ax ? du : dd, v1 - v0, ax ? dd : du, o);
    };
    // The architecture pass (tools/blender/arch.py, src/archdetail.js): where it has a modelled piece for something drawn
    // flat here, the flat version is tagged 'far2' (drawn beyond the pass's near distance, R.kitNear2, exactly as before) and a note
    // says what belongs there near the camera. Nothing else changes: the same draws, the same solids, the same random numbers.
    const FAR = ARCH && assets.kit?.cortina_slats ? 'far2' : undefined;
    const note = (kind, d) => { if (FAR && !B.mute) (B.notes ||= []).push({ kind, T, N, bd, street, ...d }); };
    // fine(u, fn): what fn draws tagged 'far2' goes into the fine cell of the facade point u, the cell archdetail.js puts
    // that thing's modelled pieces in, so both versions of it switch together
    const fine = (u, fn) => { if (!FAR) return fn(); const q = P(u, 0, 0); B.pin2 = B.cell2(q.x, q.z); try { return fn(); } finally { B.pin2 = null; } };
    // collision over the same span as FB: a solid box hanging off the facade, or (rail) a railing only bodies meet
    const FC = (u0, v0, u1, v1, d0, d1, surf, rail = false) => {
      const c = P((u0 + u1) / 2, (v0 + v1) / 2, (d0 + d1) / 2), du = u1 - u0, dd = Math.abs(d1 - d0), ax = Math.abs(T.x) > 0.5;
      if (rail) B.rail(c.x, c.y, c.z, ax ? du : dd, v1 - v0, ax ? dd : du);
      else B.collideLater(c.x, c.y, c.z, ax ? du : dd, v1 - v0, ax ? dd : du, 0, surf, OVERHANG);
    };
    const hole = (u0, v0, u1, v1, d, o = wo) => {
      B.quad(wall, P(u0, v0, 0), P(u0, v0, d), P(u0, v1, d), P(u0, v1, 0), o);
      B.quad(wall, P(u1, v0, d), P(u1, v0, 0), P(u1, v1, 0), P(u1, v1, d), o);
      B.quad(wall, P(u0, v1, d), P(u1, v1, d), P(u1, v1, 0), P(u0, v1, 0), o);
      B.quad(wall, P(u0, v0, 0), P(u1, v0, 0), P(u1, v0, d), P(u0, v0, d), o);
    };
    const free = [];
    const cell = (cu0, cv0, cu1, cv1, op) => {
      if (!op) { Q(wall, cu0, cv0, cu1, cv1); free.push([cu0, cv0, cu1, cv1]); return; }
      Q(wall, cu0, cv0, op.u0, cv1); Q(wall, op.u1, cv0, cu1, cv1); Q(wall, op.u0, op.v1, op.u1, cv1);
      if (op.v0 > cv0 + 0.01) { Q(wall, op.u0, cv0, op.u1, op.v0); if (op.v0 - cv0 > 0.7) free.push([op.u0 - 0.2, cv0, op.u1 + 0.2, op.v0 - 0.1]); }
      hole(op.u0, op.v0, op.u1, op.v1, op.d);
    };
    const rotN = Math.atan2(N.x, N.z);
    const hasFacade = bd.sides.includes(side);
    if (!hasFacade) { Q(wall, 0, 0, L, H); return; }

    // ---- the architectural kit on this facade -------------------------------------------------------------------------
    // KM: a kit piece's placement, its local X, Y, Z along the given axes (scaled) from the facade point (u, v, d).
    const KM = (u, v, d, X, Y, Z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(sx), Y.clone().multiplyScalar(sy), Z.clone().multiplyScalar(sz)).setPosition(P(u, v, d));
    const nT = T.clone().negate();
    const kTrim = { trim: bd.kit.stone ? 'cantera' : 'concrete' }, oTrim = bd.kit.stone ? { color: [1, 1, 1], tile: 3.2 } : { color: bd.trim, tile: 2.0 };
    // Outside corners where this facade meets the next (or the previous) one: a quarter metre of each wall is a worn,
    // rounded corner piece instead (stacked a metre at a time, some of it chipped to the brick).
    // (not on a side added later, force: its neighbours were drawn without knowing about it)
    const cs0 = !force && bd.sides.includes(PREV[side]) ? 0.25 : 0, cs1 = !force && bd.sides.includes(NEXT[side]) ? 0.25 : 0;
    // a sloped run of barrel tiles out from the wall on wooden rafters (a tejaroz along the eaves, a hood over a window)
    const tiles = (ua, ub, v, depth, pitch, rafters) => {
      const n = Math.max(1, Math.round((ub - ua) / 1.1)), w = (ub - ua) / n, c = Math.cos(pitch), s = Math.sin(pitch);
      const Z = N.clone().multiplyScalar(c).addScaledVector(UP, -s), Y = UP.clone().multiplyScalar(c).addScaledVector(N, s);
      const so = { slot: { tile: { color: TEJA, tile: 1.3 }, mortar: { color: [1.3, 1.62, 1.8], tile: 1.0 } } };     // (lime mortar on the same material: no draw call of its own)
      for (let i = 0; i < n; i++) {
        const u = ua + w * (i + 0.5);
        B.kit('tile_patch', KM(u, v, 0, T, Y, Z, w / 1.1, 1, depth / 0.9), { tile: 'teja', mortar: 'teja' }, { ...so, lod: 'near' });
        B.kit('tile_patch_lod1', KM(u, v, 0, T, Y, Z, w / 1.1, 1, depth / 0.9), { tile: 'teja' }, { ...so, lod: 'far' });
      }
      for (const u of rafters) B.kit('rafter', KM(u, v - 0.012, 0, T, Y, Z, 1, 1, depth + 0.08), { wood: 'door' }, { lod: 'near', slot: { wood: { color: [0.72, 0.6, 0.5], tile: 1.2 } } });
    };

    const m = 0.55, nb = Math.max(1, Math.round((L - 2 * m) / 3.3)), bw = (L - 2 * m) / nb;
    Q(wall, cs0, 0, m, H); Q(wall, L - m, 0, L - cs1, H);
    if (cs1) {
      for (let i = 0; i < Math.ceil(H - 1e-3); i++) {
        const h = Math.min(1, H - i), r = hash(O.x + T.x * L, O.z + T.z * L, i);
        const piece = h < 1 ? 'corner_a' : r < (i < 3 ? 0.2 : 0.05) ? 'corner_c' : r < (i < 3 ? 0.5 : 0.16) ? 'corner_b' : 'corner_a';
        B.kit(piece, KM(L, i, 0, T, UP, N, 1, h, 1), { wall, brick: 'brick' }, { slot: { wall: wo, brick: { tile: 1.1 } } });   // (merged with the wall itself: no draw call of its own)
      }
    }
    const street = bd.street?.[side] || 'lane';
    const shops = (bd.shops || []).filter(s => s.side === side).map(s => s.bay);
    const frameKey = bd.frameIron ? 'iron' : 'planks', fo = { color: bd.frameTint, tile: 1.1 };
    const sh = { color: bd.shTint, uv: [0, 0, 1, 1] };
    let doors = 0;
    const doorsU = [];                                                         // (the archetype puts arches or hoods over these)
    const gaps = [];                                                           // ground-floor openings the painted base band stops at

    // window dressing ------------------------------------------------------------
    // The frame round an opening: the flat painted frame, 8 mm proud, and near the camera moulded bars with corner blocks
    // over it (stone, or plaster painted the surround's colour) and a keystone over a door.
    const surround = (u0, v0, u1, v1, top = true, door = false) => {
      const sr = bd.surround; if (!sr) return;
      const w = sr.w, o = { color: sr.c, tile: 1.4, x: bd.age };
      FB('paint', u0 - w, v0 - (v0 > 0.05 ? w : 0), u0, v1 + w, -0.008, 0, o); FB('paint', u1, v0 - (v0 > 0.05 ? w : 0), u1 + w, v1 + w, -0.008, 0, o);
      if (top) FB('paint', u0, v1, u1, v1 + w, -0.008, 0, o);
      if (v0 > 0.05) FB('paint', u0, v0 - w, u1, v0, -0.008, 0, o);
      const fk = { trim: bd.kit.stone ? 'cantera' : 'w_plaster' }, fo = bd.kit.stone ? { tile: 3.2, color: [1, 1, 1], lod: 'near' } : { tile: 1.8, color: sr.ck || sr.c, lod: 'near' };
      const s = w / 0.15, vb = v0 > 0.05 ? v0 - 0.075 : 0;                    // the jambs run down to the sill's underside, or the ground
      if (top) {
        B.kit('frame_bar', KM((u0 + u1) / 2, v1, 0, T, UP, N, u1 - u0, s, 1), fk, fo);
        B.kit('frame_corner', KM(u0 - 0.075 * s, v1, 0, T, UP, N, s, s, 1), fk, fo); B.kit('frame_corner', KM(u1 + 0.075 * s, v1, 0, T, UP, N, s, s, 1), fk, fo);
        if (door) B.kit('keystone', KM((u0 + u1) / 2, v1, 0, T, UP, N), fk, fo);
      }
      B.kit('frame_bar', KM(u0, (vb + v1) / 2, 0, UP, nT, N, v1 - vb, s, 1), fk, fo);
      B.kit('frame_bar', KM(u1, (vb + v1) / 2, 0, DOWN, T, N, v1 - vb, s, 1), fk, fo);
      if (door) for (const u of [u0 - w / 2, u1 + w / 2]) {                  // at the foot of a wall: solid for loose props
        const c = P(u, v1 / 2, -0.026), ax = Math.abs(T.x) > 0.5;
        B.detail(c.x, c.y, c.z, ax ? w : 0.06, v1, ax ? 0.06 : w, 0, 'concrete');
      }
    };
    const windowAt = (u0, v0, u1, v1, type, d) => {
      const uc = (u0 + u1) / 2, hw = (u1 - u0) / 2;
      if (v0 > 2) surround(u0, v0, u1, v1);
      FB('concrete', u0 - 0.09, v0 - 0.07, u1 + 0.09, v0 - 0.012, -0.08, d * 0.6, { color: bd.trim });        // sill (inside the moulded one drawn near)
      B.kit('sill', KM(uc, v0, 0, T, UP, N, u1 - u0 + 0.18 + (v0 > 2 && bd.surround ? 2 * bd.surround.w : 0), 1, 1), kTrim, { ...oTrim, lod: 'near' });
      if (bd.kit.hoods && v0 > 2 && type !== 'dark') {                       // a little tile hood over the window
        const e = (bd.surround ? bd.surround.w : 0) + 0.28;
        tiles(u0 - e, u1 + e, v1 + (bd.surround ? bd.surround.w : 0) + 0.1, 0.46, 0.5, [u0 - e + 0.12, u1 + e - 0.12]);
      }
      if (type === 'dark' || type === 'board') {
        Q('dark', u0, v0, u1, v1, d + 0.5, {});
        hole(u0, v0, u1, v1, d + 0.5, { color: [0.25, 0.24, 0.23], tile: bd.tile });
      } else {
        for (const [a, b, c, e] of [[u0, v0, u1, v0 + 0.055], [u0, v1 - 0.055, u1, v1], [u0, v0, u0 + 0.055, v1], [u1 - 0.055, v0, u1, v1], [uc - 0.025, v0, uc + 0.025, v1]])
          FB(frameKey, a, b, c, e, d - 0.05, d, fo);
        if (v1 - v0 > 1.6) FB(frameKey, u0, v0 + (v1 - v0) * 0.62, u1, v0 + (v1 - v0) * 0.62 + 0.045, d - 0.05, d, fo);
        { const c = P(uc, v0, 0), rd = roomData(c.x, c.z, v0, u1 - u0 - 0.1, v1 - v0 - 0.1, v0 + 0.05 - (v0 > FLOOR0 ? FLOOR0 + Math.floor((v0 - FLOOR0) / FLOORN) * FLOORN : 0));
          Q('room', u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, d - 0.012, { uv: [0, 0, 1, 1], x: rd.x, color: rd.color }); }
      }
      if (type === 'shut') {
        FB('shutter_wood', u0 + 0.01, v0 + 0.01, uc - 0.008, v1 - 0.01, 0.045, 0.085, sh); FB('shutter_wood', uc + 0.008, v0 + 0.01, u1 - 0.01, v1 - 0.01, 0.045, 0.085, sh);
      } else if (type === 'open' || type === 'half') {
        FB('shutter_wood', u0 - hw - 0.03, v0, u0 - 0.03, v1, -0.05, -0.012, sh);
        if (type === 'open') FB('shutter_wood', u1 + 0.03, v0, u1 + hw + 0.03, v1, -0.05, -0.012, sh);
        else FB('shutter_wood', uc + 0.008, v0 + 0.01, u1 - 0.01, v1 - 0.01, 0.045, 0.085, sh);
      } else if (type === 'board') {
        let y = v0 + 0.1;
        while (y < v1 - 0.2) { const hgt = rnd.range(0.13, 0.2); FB('planks', u0 - rnd.range(0.03, 0.12), y, u1 + rnd.range(0.03, 0.12), y + hgt, -0.03, 0.0, { tile: 0.9, color: [0.8, 0.75, 0.7] }); y += hgt + rnd.range(0.04, 0.3); }
      } else if (type === 'bars') {
        const fo2 = v0 < 2 ? { lod: FAR } : {};                                 // (the street floor's grilles are modelled near: reja_calle)
        fine((u0 + u1) / 2, () => {
          for (let u = u0 + 0.1; u < u1 - 0.04; u += 0.135) FB('iron', u, v0, u + 0.016, v1, 0.05, 0.066, fo2);
          FB('iron', u0, v0 + 0.22, u1, v0 + 0.245, 0.045, 0.07, fo2); FB('iron', u0, v1 - 0.245, u1, v1 - 0.22, 0.045, 0.07, fo2);
        });
        if (v0 < 2) note('reja', { p: P((u0 + u1) / 2, v0, 0), w: u1 - u0, h: v1 - v0 });
      }
      if (v0 > 4 && rnd.chance(0.2)) {          // AC unit on brackets with a run-off stain
        const p = P(uc + rnd.range(-0.1, 0.1), v0 - 1.12, -0.21);
        B.prop(rnd.chance(0.5) ? 'ac' : 'ac_rust', p.x, p.y, p.z, rotN, 0.9);
        Q('d_stain', uc - 0.45, v0 - 2.9, uc + 0.45, v0 - 1.05, -0.006, { uv: [0, 0, 1, 1], color: [0.8, 0.8, 0.8] });
      } else if (rnd.chance(0.3)) Q('d_stain', u0 - 0.1, v0 - 1.6 - rnd() * 0.8, u1 + 0.1, v0 - 0.08, -0.006, { uv: [0, 0, 1, 1] });
    };

    // Above the street floor the district's own loop still runs, for its random draws, but keeps nothing (B.mute) and
    // its anchors are marked legacy (dressed, for the same draws, into nothing): archetypeFacade() draws those floors.
    let legacyMute = false, legacyFrom = -1;
    for (let f = 0; f < bd.floors; f++) {
      if (f === 1) { legacyMute = B.mute; B.mute = true; legacyFrom = anchors.length; }
      const v0 = f === 0 ? 0 : FLOOR0 + (f - 1) * FLOORN, v1 = f === 0 ? FLOOR0 : v0 + FLOORN;
      for (let i = 0; i < nb; i++) {
        const cu0 = m + i * bw, cu1 = cu0 + bw, uc = (cu0 + cu1) / 2;
        if (f === 0) {
          let kind = shops.includes(i) ? 'shop' : rnd.pick(['door', 'shutter', 'shutter', 'window', 'window', 'blank']);
          if (i === nb - 1 && !doors && kind !== 'shop') kind = 'door';
          if (street === 'none') kind = 'blank';
          if (kind === 'door') {
            doors++; doorsU.push(uc);
            const op = { u0: uc - 0.55, v0: 0, u1: uc + 0.55, v1: 2.32, d: 0.3 };
            cell(cu0, v0, cu1, v1, op); gaps.push([op.u0, op.u1]); surround(op.u0, 0, op.u1, op.v1, true, true);
            const metal = rnd.chance(0.35);
            const dt = metal ? rnd.pick(METAL_TINTS) : bd.doorTint;
            fine(uc, () => Q(metal ? 'metal_green' : 'door', op.u0, 0, op.u1, op.v1, op.d, { uv: [0, 0, 1, 1], color: dt, lod: metal ? FAR : undefined }));
            if (metal) note('puerta', { p: P(uc, 0, 0), w: 1.1, h: op.v1, d: op.d, tint: dt });
            note('umbral', { p: P(uc, 0, 0), w: 1.1, d: op.d });
            if (!metal) for (const [u, leaf] of [[op.u0, 'door_leaf_l'], [op.u1, 'door_leaf_r']])       // near: two panelled leaves
              B.kit(leaf, KM(u, 0, op.d - 0.004, T, UP, N), { wood: 'door', iron: 'iron' }, { lod: 'near', slot: { wood: { color: bd.doorTint, tile: 2.4 }, iron: { lod: null } } });
            FB(frameKey, op.u0, op.v1 - 0.07, op.u1, op.v1, op.d - 0.06, op.d, fo); FB(frameKey, op.u0, 0, op.u0 + 0.06, op.v1, op.d - 0.06, op.d, fo); FB(frameKey, op.u1 - 0.06, 0, op.u1, op.v1, op.d - 0.06, op.d, fo);
            FB('iron', op.u1 - 0.2, 1.02, op.u1 - 0.16, 1.14, op.d - 0.05, op.d);
            anchors.push({ kind: 'door', p: P(uc, 0, 0), N, T, w: 1.1, bd, street });
          } else if (kind === 'shutter') {
            const sw = Math.min(2.7, bw - 0.7), op = { u0: uc - sw / 2, v0: 0, u1: uc + sw / 2, v1: 2.72, d: 0.14 };
            cell(cu0, v0, cu1, v1, op); gaps.push([op.u0 - 0.05, op.u1 + 0.05]);
            const key = rnd.pick(['shutter_metal', 'shutter_metal', 'corrugated']);
            const so = { tile: key === 'corrugated' ? 1.4 : 1.25, color: rnd.pick(METAL_TINTS), uo: rnd(), vo: rnd(), lod: FAR }, gate = key === 'corrugated';
            fine(uc, () => {
              Q(key, op.u0, 0, op.u1, op.v1, op.d, so);
              FB('iron', op.u0, 0, op.u0 + 0.04, op.v1, 0.02, op.d, { lod: FAR }); FB('iron', op.u1 - 0.04, 0, op.u1, op.v1, 0.02, op.d, { lod: FAR });
              FB('metal_white', op.u0 - 0.04, op.v1 - 0.02, op.u1 + 0.04, op.v1 + 0.2, -0.03, op.d, { tile: 1.5, color: [0.8, 0.8, 0.8], lod: gate ? undefined : FAR });   // (a sheet gate keeps this as its lintel)
              FB('iron', uc - 0.1, 0.02, uc + 0.1, 0.07, op.d - 0.05, op.d, { lod: FAR });
            });
            note('cortina', { p: P(uc, 0, 0), w: sw, h: op.v1, d: op.d, key, so });
            anchors.push({ kind: 'shutter', p: P(uc, 0, 0), N, T, w: sw, bd, street });
          } else if (kind === 'shop') {
            const op = { u0: cu0 + 0.28, v0: 0, u1: cu1 - 0.28, v1: 2.8, d: 0.32 };
            cell(cu0, v0, cu1, v1, op); gaps.push([op.u0, op.u1]);
            shopRoom(bd, { P, T, N, street }, cu0 + 0.1, cu1 - 0.1, op);
            fine(uc, () => FB('shutter_metal', op.u0, 2.56, op.u1, 2.8, 0.06, 0.3, { tile: 1.2, color: [0.8, 0.8, 0.8], lod: FAR }));
            note('tienda', { p: P(uc, 0, 0), w: op.u1 - op.u0, h: op.v1, d: op.d });
            anchors.push({ kind: 'shop', p: P(uc, 0, 0), N, T, w: op.u1 - op.u0, bd, street });
          } else if (kind === 'window') {
            const op = { u0: uc - 0.6, v0: 1.2, u1: uc + 0.6, v1: 2.45, d: 0.22 };
            cell(cu0, v0, cu1, v1, op); windowAt(op.u0, op.v0, op.u1, op.v1, 'bars', op.d);
            if (bd.plinth) FB('dirty', cu0, 0, cu1, 0.6, -0.035, 0, { tile: 2.2, color: [0.8, 0.78, 0.74] });
            anchors.push({ kind: 'wall', p: P(uc, 0, 0), N, T, w: bw, bd, street });
          } else {
            cell(cu0, v0, cu1, v1, null);
            if (bd.plinth) FB('dirty', cu0, 0, cu1, 0.6, -0.035, 0, { tile: 2.2, color: [0.8, 0.78, 0.74] });
            anchors.push({ kind: 'wall', p: P(uc, 0, 0), N, T, w: bw, bd, street });
          }
        } else {
          const balc = (bd.balcMode === 1 && i % 2 === bd.balcPhase) || (bd.balcMode === 2 && i === (nb >> 1));
          if (balc && bw > 2.4) {
            const op = { u0: uc - 0.5, v0: v0 + 0.03, u1: uc + 0.5, v1: v0 + 2.28, d: 0.22 };
            cell(cu0, v0, cu1, v1, op);
            const t = rnd.pick(['shut', 'glass', 'glass', 'dark']);
            if (t === 'dark') Q('dark', op.u0, op.v0, op.u1, op.v1, op.d + 0.4, {});
            else if (t === 'shut') { FB('shutter_wood', op.u0 + 0.01, op.v0, uc - 0.008, op.v1, 0.05, 0.09, sh); FB('shutter_wood', uc + 0.008, op.v0, op.u1 - 0.01, op.v1, 0.05, 0.09, sh); Q('dark', op.u0, op.v0, op.u1, op.v1, op.d, {}); }
            else {
              for (const [a, b, c, e] of [[op.u0, op.v0, op.u1, op.v0 + 0.5], [op.u0, op.v1 - 0.06, op.u1, op.v1], [op.u0, op.v0, op.u0 + 0.07, op.v1], [op.u1 - 0.07, op.v0, op.u1, op.v1], [uc - 0.03, op.v0, uc + 0.03, op.v1]]) FB(frameKey, a, b, c, e, op.d - 0.05, op.d, fo);
              Q('glass', op.u0, op.v0, op.u1, op.v1, op.d - 0.012, {});
            }
            const a = cu0 + 0.22, b = cu1 - 0.22, dep = 1.05;
            FB('concrete', a, v0 - 0.16, b, v0, -dep, 0, { color: bd.trim });
            FC(a, v0 - 0.16, b, v0, -dep, 0, 'concrete');                       // the slab is a floor to stand on and a roof over the street
            for (const u of [a + 0.14, b - 0.14]) B.kit('corbel', KM(u, v0 - 0.16, 0, T, UP, N), kTrim, { ...oTrim, lod: 'near' });     // brackets under the slab
            if (bd.balcSolid) {
              FB(wall, a, v0, b, v0 + 0.95, -dep, -dep + 0.11, wo); FB(wall, a, v0, a + 0.11, v0 + 0.95, -dep + 0.11, 0, wo); FB(wall, b - 0.11, v0, b, v0 + 0.95, -dep + 0.11, 0, wo);
              FC(a, v0, b, v0 + 0.95, -dep, -dep + 0.11, 'plaster'); FC(a, v0, a + 0.11, v0 + 0.95, -dep + 0.11, 0, 'plaster'); FC(b - 0.11, v0, b, v0 + 0.95, -dep + 0.11, 0, 'plaster');   // a parapet: cover
            } else {
              for (const y of [v0 + 0.06, v0 + 0.98]) { FB('iron', a, y, b, y + 0.035, -dep, -dep + 0.035); FB('iron', a, y, a + 0.035, y + 0.035, -dep, 0); FB('iron', b - 0.035, y, b, y + 0.035, -dep, 0); }
              for (let u = a + 0.05; u < b - 0.02; u += 0.125) FB('iron', u, v0, u + 0.014, v0 + 1.0, -dep + 0.01, -dep + 0.024);
              for (let d = 0.12; d < dep - 0.05; d += 0.125) { FB('iron', a + 0.01, v0, a + 0.024, v0 + 1.0, -d - 0.014, -d); FB('iron', b - 0.024, v0, b - 0.01, v0 + 1.0, -d - 0.014, -d); }
              FC(a, v0, b, v0 + 1.02, -dep, -dep + 0.04, 'metal', true); FC(a, v0, a + 0.04, v0 + 1.02, -dep, 0, 'metal', true); FC(b - 0.04, v0, b, v0 + 1.02, -dep, 0, 'metal', true);   // open ironwork: no cover
            }
            anchors.push({ kind: 'balcony', p: P(uc, v0, -dep), N, T, w: b - a, bd, street, solid: bd.balcSolid });
          } else if (rnd.chance(0.06)) cell(cu0, v0, cu1, v1, null);
          else {
            const ww = bd.winW, wh = bd.winH, sill = v0 + 0.92;
            const op = { u0: uc - ww / 2, v0: sill, u1: uc + ww / 2, v1: sill + wh, d: 0.22 };
            cell(cu0, v0, cu1, v1, op);
            windowAt(op.u0, op.v0, op.u1, op.v1, rnd.pick(bd.winTypes), op.d);
            if (f === 1 && rnd.chance(0.25)) anchors.push({ kind: 'window', p: P(uc, sill, 0), N, T, w: ww, bd, street });
          }
        }
      }
      if (f > 0 && bd.ledge) {                                                   // moulded string course, mitred round a corner
        const a = cs0 ? 0.12 : 0, b = L - (cs1 ? 0.12 : 0);
        B.kit('string', KM((a + b) / 2, v0, 0, T, UP, N, b - a, 1, 1), kTrim, oTrim);
        if (cs1) B.kit('string_corner', KM(L, v0, 0, T, UP, N), kTrim, oTrim);
      }
    }
    if (legacyFrom >= 0) { B.mute = legacyMute; for (let k = legacyFrom; k < anchors.length; k++) anchors[k].legacy = true; }
    if (bd.band && street !== 'none') {                                       // the painted base band (guardapolvo), stopping at doors and shutters
      const c = bd.band.c, h = bd.band.h, line = [c[0] * 0.75, c[1] * 0.75, c[2] * 0.75];
      const seg = (u0, u1) => { FB('paint', u0, 0, u1, h, -0.012, 0, { color: c, tile: 1.6, x: bd.age }); FB('paint', u0, h, u1, h + 0.05, -0.016, 0, { color: line, tile: 1.6, x: bd.age }); };     // with a darker pin-line on top
      let a = cs0 ? 0.03 : 0; const e = L - (cs1 ? 0.03 : 0);                  // (kept off the worn corners)
      for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 - a > 0.05) seg(a, g0); a = Math.max(a, g1); }
      if (e - a > 0.05) seg(a, e);
    }
    if (bd.cornice) {                                                            // the main cornice at the roofline
      const a = cs0 ? 0.32 : 0, b = L - (cs1 ? 0.32 : 0), y = H - 0.2;
      B.kit('cornice', KM((a + b) / 2, y, 0, T, UP, N, b - a, 1, 1), kTrim, oTrim);
      if (cs1) B.kit('cornice_corner', KM(L, y, 0, T, UP, N), kTrim, oTrim);
    }
    if (bd.kit.tejaroz) {                                                        // or a tiled eave on rafters
      const ua = cs0 ? 0 : 0.12, ub = L - (cs1 ? 0 : 0.12), raf = [];
      for (let u = ua + 0.35; u < ub - 0.2; u += 0.75) raf.push(u);
      tiles(ua, ub, H + 0.04, 0.72, 0.42, raf);
    }
    // pipes, conduits, scars
    if (rnd.chance(0.65)) {
      const u = rnd.chance(0.5) ? 0.28 : L - 0.28, p = P(u, 0, -0.085), len = H + 0.3;
      B.geom(rnd.chance(0.5) ? 'metal_white' : 'iron', new THREE.CylinderGeometry(0.055, 0.055, len, 8), new THREE.Matrix4().makeTranslation(p.x, 0.25 + len / 2, p.z), { color: [0.75, 0.75, 0.75], uvScale: 1, uvScaleY: len });
      B.detail(p.x, 1.5, p.z, 0.11, 2.5, 0.11, 0, 'metal');
      for (let y = 1; y < H; y += 2.1) FB('iron', u - 0.08, y, u + 0.08, y + 0.04, -0.15, 0);
    }
    if (rnd.chance(0.55)) { const y = FLOOR0 - rnd.range(0.12, 0.4), a = rnd.range(0.3, L * 0.4); FB('iron', a, y, L - rnd.range(0.2, L * 0.3), y + 0.028, -0.03, 0); FB('iron', a, y - rnd.range(0.8, 2), a + 0.028, y, -0.03, 0); }
    const decalMute = B.mute; B.mute = true;
    for (let k = 0; k < 1 + L / 9; k++) {
      if (!free.length) break;
      const r = rnd.pick(free), kind = rnd.pick(['d_patch', 'd_scars', 'd_stain', 'd_stain']);
      const lim = kind === 'd_scars' ? 0.75 : 2.2, s = Math.min(lim, Math.min(r[2] - r[0], r[3] - r[1]) * rnd.range(0.55, 0.95)), ca = (r[0] + r[2]) / 2 + rnd.range(-0.3, 0.3) * (r[2] - r[0] - s), cb = (r[1] + r[3]) / 2;
      if (s < 0.4) continue;
      const g = rnd.range(0.86, 1.08);
      Q(kind, ca - s / 2, cb - s / 2, ca + s / 2, cb + s / 2, -0.005 - k * 0.001, { uv: [0, 0, 1, 1], color: kind === 'd_patch' ? [bd.tint[0] * g, bd.tint[1] * g, bd.tint[2] * g] : [1, 1, 1] });
    }
    B.mute = decalMute;
    archetypeFacade();

    // ===================================================================================================================
    // The building's archetype (facades.js): the floors above the shops, ornament, the base, repairs and wear. The loop
    // above still ran over those floors keeping nothing (B.mute), so every draw of the shared random streams happened as
    // it always did: shops, street props, cover and routes are where they were. Every choice here comes from vr.
    function archetypeFacade() {
      const st = bd.style; if (!st) return;
      if (street === 'none') { for (let f = 1; f < bd.floors; f++) { const v0 = FLOOR0 + (f - 1) * FLOORN; Q(wall, m, v0, L - m, v0 + FLOORN); } return; }
      const vr = st.vr, kind = st.kind, A = st.A, I4 = new THREE.Matrix4(), free2 = [];
      const stoneK = { trim: 'cantera' }, stoneO = { color: [1, 1, 1], tile: 3.2 };
      const trimK = kind === 'casona' ? stoneK : kTrim, trimO = kind === 'casona' ? stoneO : oTrim;
      // colours: the scheme's (facades.js): B or white round the openings, wood stained or painted, the shutters with it
      const sw = kind === 'casona' ? 0.15 : 0.13, sCol = st.frameP, sColW = st.frameW, frameTint = st.woodP;
      const painted = !/^#(5b3a26|3f2a1e)$/.test(st.colors.wood), shKey = painted ? 'planks' : 'shutter_wood', shO = { color: painted ? st.woodP : st.door, uv: [0, 0, 1, 1], tile: 0.9 };
      const upperWall = kind === 'obra' ? 'brick' : wall, woU = kind === 'obra' ? { color: [0.96, 0.9, 0.84], tile: 1.9, uo: bd.uo, vo: bd.vo } : wo;
      const conc = { color: [0.8, 0.79, 0.76], tile: 1.8, solid: false };

      // triangles textured as quad() textures (projected in world space), for the arched heads
      const tris = (key, list, o) => {
        const pos = [], nor = [], uv = [], tile = o.tile || 2.6, uo = o.uo || 0, vo = o.vo || 0, e1 = V(), e2 = V(), n = V();
        for (const t of list) {
          const w = t.map(([u, v, d]) => P(u, v, d));
          n.crossVectors(e1.subVectors(w[1], w[0]), e2.subVectors(w[2], w[0])).normalize();
          const floor = Math.abs(n.y) > 0.7;
          for (const p of w) {
            pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z);
            uv.push(floor ? p.x / tile + uo : (p.x * n.z - p.z * n.x) / tile + uo, floor ? (-p.z * Math.sign(n.y)) / tile + vo : p.y / tile + vo);
          }
        }
        if (!pos.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        B.geom(key, g, I4, { color: o.color || [1, 1, 1] });
      };
      const reveal = (key, u0, v0, u1, v1, d, o, top = true) => {             // the four faces of an opening's depth
        B.quad(key, P(u0, v0, 0), P(u0, v0, d), P(u0, v1, d), P(u0, v1, 0), o);
        B.quad(key, P(u1, v0, d), P(u1, v0, 0), P(u1, v1, 0), P(u1, v1, d), o);
        if (top) B.quad(key, P(u0, v1, d), P(u1, v1, d), P(u1, v1, 0), P(u0, v1, 0), o);
        B.quad(key, P(u0, v0, 0), P(u1, v0, 0), P(u1, v0, d), P(u0, v0, d), o);
      };
      // a round-headed opening: the jambs up to the springing, the curved soffit, and wall filling the spandrels
      const archHead = (op, key, o) => {
        const r = (op.u1 - op.u0) / 2, uc = (op.u0 + op.u1) / 2, vs = op.v1 - r, d = op.d, n = 12, list = [];
        reveal(key, op.u0, op.v0, op.u1, vs, d, o, false);
        const at = k => [uc + r * Math.cos(Math.PI * k / n), vs + r * Math.sin(Math.PI * k / n)];
        for (let k = 0; k < n; k++) {
          const [ua, va] = at(k), [ub, vb] = at(k + 1), c = k < n / 2 ? [op.u1, op.v1] : [op.u0, op.v1];
          list.push([[ua, va, 0], [c[0], c[1], 0], [ub, vb, 0]]);
          list.push([[ua, va, 0], [ub, vb, 0], [ub, vb, d]], [[ua, va, 0], [ub, vb, d], [ua, va, d]]);
        }
        tris(key, list, o);
      };
      // wall over a bay of one storey, round its openings (rectangular or round-headed); free wall noted for weathering
      const cellN = (cu0, cv0, cu1, cv1, ops, key = upperWall, o = woU) => {
        const W = (a, b, c, e) => { if (c - a > 0.002 && e - b > 0.002) Q(key, a, b, c, e, 0, o); };
        let u = cu0;
        ops.sort((p, q) => p.u0 - q.u0);
        for (const op of ops) {
          W(u, cv0, op.u0, cv1); W(op.u0, cv0, op.u1, op.v0); W(op.u0, op.v1, op.u1, cv1);
          if (op.v0 - cv0 > 0.7) free2.push([op.u0 - 0.2, cv0, op.u1 + 0.2, op.v0 - 0.1]);
          if (op.arch) archHead(op, key, o); else reveal(key, op.u0, op.v0, op.u1, op.v1, op.d, o);
          u = op.u1;
        }
        W(u, cv0, cu1, cv1);
        if (!ops.length) free2.push([cu0, cv0, cu1, cv1]);
        else { free2.push([cu0, cv0, ops[0].u0 - 0.06, cv1]); free2.push([u + 0.06, cv0, cu1, cv1]); }
      };
      // the glass of an opening with its room behind (the 'room' material); a round head gets a fan of glass
      const roomGlass = (u0, v0, u1, v1, d, floorY, arch) => {
        const w = u1 - u0, h = v1 - v0, vs = arch ? v1 - w / 2 : v1, c = P((u0 + u1) / 2, v0, 0), rd = roomData(c.x, c.z, v0, w, h, v0 - floorY);
        Q('room', u0, v0, u1, vs, d, { uv: [0, 0, 1, (vs - v0) / h], x: rd.x, color: rd.color });
        if (!arch) return;
        const n = 12, r = w / 2, uc = (u0 + u1) / 2, pos = [], nor = [], uv = [];
        for (let k = 0; k < n; k++) for (const [uu, vv] of [[uc, vs], [uc + r * Math.cos(Math.PI * k / n), vs + r * Math.sin(Math.PI * k / n)], [uc + r * Math.cos(Math.PI * (k + 1) / n), vs + r * Math.sin(Math.PI * (k + 1) / n)]]) {
          const p = P(uu, vv, d); pos.push(p.x, p.y, p.z); nor.push(N.x, N.y, N.z); uv.push((uu - u0) / w, (vv - v0) / h);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        B.geom('room', g, I4, { color: rd.color, xf: () => rd.x });
      };
      // a wooden bar round a round head (the frame's arch) and the glazing bars of its fan
      const archBar = (op, d, key, tint) => {
        const r = (op.u1 - op.u0) / 2 - 0.03, uc = (op.u0 + op.u1) / 2, vs = op.v1 - (op.u1 - op.u0) / 2, pts = [];
        for (let k = 0; k <= 12; k++) pts.push(P(uc + r * Math.cos(Math.PI * k / 12), vs + r * Math.sin(Math.PI * k / 12), d));
        B.geom(key, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.03, 4, false), I4, { color: tint, uvScale: 1 });
        for (const a of [Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4]) {
          const p = P(uc + r * 0.5 * Math.cos(a), vs + r * 0.5 * Math.sin(a), d), q = new THREE.Quaternion().setFromUnitVectors(UP, V().addScaledVector(T, Math.cos(a)).addScaledVector(UP, Math.sin(a)).normalize());
          B.geom(key, new THREE.BoxGeometry(0.025, r, 0.025), new THREE.Matrix4().compose(p, q, V(1, 1, 1)), { color: tint });
        }
      };
      // the moulded surround round an upper opening (stone for a casona, painted plaster otherwise): paint drawn far
      const surroundN = (u0, v0, u1, v1) => {
        const s = sw / 0.15, o = { color: sCol, tile: 1.4, lod: 'far', solid: false, x: bd.age };
        FB('paint', u0 - sw, v0 - sw, u0, v1 + sw, -0.008, 0, o); FB('paint', u1, v0 - sw, u1 + sw, v1 + sw, -0.008, 0, o); FB('paint', u0, v1, u1, v1 + sw, -0.008, 0, o); FB('paint', u0, v0 - sw, u1, v0, -0.008, 0, o);
        const fk = st.stone ? stoneK : { trim: 'w_plaster' }, fo = st.stone ? { ...stoneO, lod: 'near' } : { tile: 1.8, color: sColW, lod: 'near' };
        B.kit('frame_bar', KM((u0 + u1) / 2, v1, 0, T, UP, N, u1 - u0, s, 1), fk, fo);
        B.kit('frame_corner', KM(u0 - 0.075 * s, v1, 0, T, UP, N, s, s, 1), fk, fo); B.kit('frame_corner', KM(u1 + 0.075 * s, v1, 0, T, UP, N, s, s, 1), fk, fo);
        B.kit('frame_bar', KM(u0, (v0 - 0.075 + v1) / 2, 0, UP, nT, N, v1 - v0 + 0.075, s, 1), fk, fo);
        B.kit('frame_bar', KM(u1, (v0 - 0.075 + v1) / 2, 0, DOWN, T, N, v1 - v0 + 0.075, s, 1), fk, fo);
      };
      // an opening's contents and what goes round it.
      // s: glass ('room' | 'dark' | 'bricked' | 'board' | 'block'), frame ('wood' | 'steel' | 'alu' | 'raw'),
      //    shut ('open' | 'shut'), grille, surround, head ('hood' | 'pediment'), sill, floorY (the storey's floor)
      const fill = (op, s) => {
        const { u0, v0, u1, v1, d } = op, uc = (u0 + u1) / 2, w = u1 - u0, vs = op.arch ? v1 - w / 2 : v1;
        if (s.surround) {
          if (op.arch) {
            const sc = w, so = { color: sCol, tile: 1.4, lod: 'far', solid: false, x: bd.age };
            B.kit('archivolt', KM(uc, vs, 0, T, UP, N, sc, sc, 1), trimK, trimO);
            B.kit('frame_bar', KM(u0, (v0 + vs) / 2, 0, UP, nT, N, vs - v0, sc, 1), trimK, { ...trimO, lod: 'near' });
            B.kit('frame_bar', KM(u1, (v0 + vs) / 2, 0, DOWN, T, N, vs - v0, sc, 1), trimK, { ...trimO, lod: 'near' });
            FB('paint', u0 - 0.15 * sc, v0, u0, vs, -0.008, 0, so); FB('paint', u1, v0, u1 + 0.15 * sc, vs, -0.008, 0, so);
            B.kit('keystone', KM(uc, v1 + 0.02, 0, T, UP, N), trimK, trimO);
          } else surroundN(u0, v0, u1, v1);
        }
        if (s.sill) {
          FB('concrete', u0 - 0.09, v0 - 0.07, u1 + 0.09, v0 - 0.012, -0.08, d * 0.6, { color: bd.trim, solid: false });
          B.kit('sill', KM(uc, v0, 0, T, UP, N, w + 0.18 + (s.surround ? 2 * sw : 0), 1, 1), trimK, { ...trimO, lod: 'near' });
        }
        const top = v1 + (s.surround ? sw : 0);
        if (s.head === 'hood') B.kit('hood', KM(uc, top, 0, T, UP, N, w + 2 * sw + 0.14, 1, 1), trimK, trimO);
        else if (s.head === 'pediment') B.kit('pediment', KM(uc, top + 0.01, 0, T, UP, N, w + 2 * sw + 0.22, 1, 1), trimK, trimO);
        if (s.glass === 'bricked') {                                         // walled up, the lintel left over it
          Q(vr() < 0.6 ? 'w_brick' : 'cracked', u0, v0, u1, vs, d * 0.35, { tile: 1.3, color: [0.94, 0.9, 0.86], uo: vr(), vo: vr() });
          if (op.arch) { const r = w / 2, n = 10, list = []; for (let k = 0; k < n; k++) list.push([[uc, vs, d * 0.35], [uc + r * Math.cos(Math.PI * k / n), vs + r * Math.sin(Math.PI * k / n), d * 0.35], [uc + r * Math.cos(Math.PI * (k + 1) / n), vs + r * Math.sin(Math.PI * (k + 1) / n), d * 0.35]]); tris('w_brick', list, { tile: 1.3, color: [0.94, 0.9, 0.86] }); }
          return;
        }
        if (s.glass === 'dark') { Q('dark', u0, v0, u1, vs, d + 0.45, {}); return; }
        if (s.glass === 'board') {                                           // boarded over, the boards nailed on the outside
          Q('dark', u0, v0, u1, vs, d + 0.45, {});
          for (let y = v0 - 0.05; y < vs; y += 0.2 + vr() * 0.06) FB('planks', u0 - 0.06 - vr() * 0.05, y, u1 + 0.06 + vr() * 0.05, Math.min(vs + 0.04, y + 0.17), -0.03, 0, { tile: 0.9, color: [0.78, 0.72, 0.66], solid: false });
          return;
        }
        if (s.glass === 'block') { Q('glassblock', u0, v0, u1, v1, d * 0.5, { tile: 0.4, color: [1, 1, 1] }); return; }
        roomGlass(u0, v0, u1, v1, d - 0.012, s.floorY, op.arch);
        const fz = d - 0.075;
        if (s.frame === 'wood') {
          B.kit('casement', KM(uc, v0, fz, T, UP, N, w, vs - v0, 1), { wood: 'planks' }, { lod: 'near', slot: { wood: { color: frameTint, tile: 0.9 } } });
          for (const [a, b, c, e] of [[u0, v0, u1, v0 + 0.06], [u0, vs - 0.06, u1, vs], [u0, v0, u0 + 0.06, vs], [u1 - 0.06, v0, u1, vs], [uc - 0.03, v0, uc + 0.03, vs]])
            FB('planks', a, b, c, e, fz, d - 0.012, { color: frameTint, tile: 1.1, lod: 'far', solid: false });
          if (op.arch) archBar(op, d - 0.04, 'planks', frameTint);
        } else if (s.frame === 'steel') {
          const k = Math.max(1, Math.round(w / 0.62)), tr = v0 + (v1 - v0) * 0.68;
          for (const [a, b, c, e] of [[u0, v0, u1, v0 + 0.04], [u0, v1 - 0.04, u1, v1], [u0, v0, u0 + 0.04, v1], [u1 - 0.04, v0, u1, v1], [u0, tr, u1, tr + 0.03]]) FB('iron', a, b, c, e, d - 0.045, d - 0.012, { solid: false });
          for (let j = 1; j < k; j++) { const u = u0 + w * j / k; FB('iron', u - 0.015, v0, u + 0.015, v1, d - 0.045, d - 0.012, { solid: false }); }
        } else if (s.frame === 'alu') {
          for (const [a, b, c, e] of [[u0, v0, u1, v0 + 0.045], [u0, vs - 0.045, u1, vs], [u0, v0, u0 + 0.045, vs], [u1 - 0.045, v0, u1, vs], [uc - 0.02, v0, uc + 0.02, vs]])
            FB('metal_white', a, b, c, e, d - 0.05, d - 0.012, { color: [0.8, 0.81, 0.82], tile: 1.2, solid: false });
        }
        if (s.shut === 'open') { const hw = w / 2; FB(shKey, u0 - hw - 0.03, v0, u0 - 0.03, vs, -0.05, -0.012, shO); FB(shKey, u1 + 0.03, v0, u1 + hw + 0.03, vs, -0.05, -0.012, shO); }
        else if (s.shut === 'shut') { FB(shKey, u0 + 0.01, v0 + 0.01, uc - 0.008, vs - 0.01, d - 0.16, d - 0.12, shO); FB(shKey, uc + 0.008, v0 + 0.01, u1 - 0.01, vs - 0.01, d - 0.16, d - 0.12, shO); }
        if (s.grille) B.kit('reja', KM(uc, v0 - 0.03, -0.035, T, UP, N, w + 0.1, vs - v0 + 0.07, 1), { iron: 'iron' }, { lod: 'near' });
      };
      // an air-conditioning unit on brackets under a window, its run-off staining the wall
      const ac = op => {
        const uc = (op.u0 + op.u1) / 2, p = P(uc + vr.range(-0.1, 0.1), op.v0 - 1.0, -0.21);
        B.prop(vr() < 0.5 ? 'ac' : 'ac_rust', p.x, p.y, p.z, rotN, 0.9);
        Q('d_stain', uc - 0.45, op.v0 - 2.7, uc + 0.45, op.v0 - 0.95, -0.006, { uv: [0, 0, 1, 1], color: [0.8, 0.8, 0.8] });
      };
      // a balcony on its slab and brackets: wrought iron (scrolled near, plain bars further off), plain bars, a stone
      // balustrade or a plastered parapet. Collision as before: slab and parapet solid, iron for movement only.
      const balconyAt = (a, b, v0, dep, type) => {
        const stone = kind === 'casona', W = b - a;
        FB(stone ? 'cantera' : 'concrete', a, v0 - 0.14, b, v0, -dep, 0, stone ? { tile: 3.2 } : { color: bd.trim });
        FC(a, v0 - 0.14, b, v0, -dep, 0, 'concrete');
        for (const u of [a + 0.16, b - 0.16]) B.kit('corbel', KM(u, v0 - 0.14, 0, T, UP, N, 1, 0.9, dep / 0.36 * 0.85), trimK, { ...trimO, lod: 'near' });
        if (type === 'iron' || type === 'bars') {
          if (type === 'iron') {
            B.kit('rail_scroll', KM((a + b) / 2, v0, -dep + 0.03, T, UP, N, W - 0.04, 1, 1), { iron: 'iron' }, { lod: 'near' });
            for (const u of [a + 0.03, b - 0.03]) B.kit('rail_scroll', KM(u, v0, -(dep - 0.03) / 2, N, UP, nT, dep - 0.04, 1, 1), { iron: 'iron' }, { lod: 'near' });
          }
          const lo = type === 'iron' ? { lod: 'far' } : {};
          for (const y of [v0 + 0.05, v0 + 0.97]) { FB('iron', a, y, b, y + 0.035, -dep, -dep + 0.035, lo); FB('iron', a, y, a + 0.035, y + 0.035, -dep, 0, lo); FB('iron', b - 0.035, y, b, y + 0.035, -dep, 0, lo); }
          for (let u = a + 0.06; u < b - 0.03; u += type === 'iron' ? 0.25 : 0.125) FB('iron', u, v0, u + 0.015, v0 + 1.0, -dep + 0.01, -dep + 0.025, lo);
          FC(a, v0, b, v0 + 1.02, -dep, -dep + 0.04, 'metal', true); FC(a, v0, a + 0.04, v0 + 1.02, -dep, 0, 'metal', true); FC(b - 0.04, v0, b, v0 + 1.02, -dep, 0, 'metal', true);
        } else if (type === 'balustrade') {
          const n = Math.max(1, Math.round(W - 0.2)), ul = (W - 0.2) / n;
          for (let k = 0; k < n; k++) B.kit('balustrade', KM(a + 0.1 + ul * (k + 0.5), v0, -dep + 0.13, T, UP, N, ul, 1.1, 0.9), stoneK, stoneO);
          for (const u of [a + 0.12, b - 0.12]) B.kit('balustrade', KM(u, v0, -dep / 2, N, UP, nT, dep - 0.2, 1.1, 0.8), stoneK, stoneO);
          FC(a, v0, b, v0 + 0.95, -dep, -dep + 0.26, 'concrete'); FC(a, v0, a + 0.24, v0 + 0.95, -dep + 0.26, 0, 'concrete'); FC(b - 0.24, v0, b, v0 + 0.95, -dep + 0.26, 0, 'concrete');
        } else {
          FB(wall, a, v0, b, v0 + 0.95, -dep, -dep + 0.11, wo); FB(wall, a, v0, a + 0.11, v0 + 0.95, -dep + 0.11, 0, wo); FB(wall, b - 0.11, v0, b, v0 + 0.95, -dep + 0.11, 0, wo);
          B.kit('coping', new THREE.Matrix4().makeBasis(T.clone().multiplyScalar(W), UP, N.clone()).setPosition(P((a + b) / 2, v0 + 0.95, -dep + 0.055)), trimK, trimO);
          FC(a, v0, b, v0 + 0.95, -dep, -dep + 0.11, 'plaster'); FC(a, v0, a + 0.11, v0 + 0.95, -dep + 0.11, 0, 'plaster'); FC(b - 0.11, v0, b, v0 + 0.95, -dep + 0.11, 0, 'plaster');
        }
        anchors.push({ kind: 'balcony', own: true, p: P((a + b) / 2, v0, -dep), N, T, w: W, bd, street, solid: type === 'balustrade' || type === 'parapet', dep, front: type === 'balustrade' ? 0.26 : type === 'parapet' ? 0.11 : 0.04 });
      };
      const string = v => { const a = cs0 ? 0.12 : 0, b = L - (cs1 ? 0.12 : 0); B.kit('string', KM((a + b) / 2, v, 0, T, UP, N, b - a, 1, 1), trimK, trimO); if (cs1) B.kit('string_corner', KM(L, v, 0, T, UP, N), trimK, trimO); };

      // ---- the floors above the shops ------------------------------------------------------------------------------------
      const oneBay = Math.min(nb - 1, Math.floor(vr() * nb)), fins = kind === 'comercial' && vr() < 0.5, block = kind === 'comercial' && nb > 1 && vr() < 0.45, sills = [];
      for (let f = 1; f < bd.floors; f++) {
        const v0 = FLOOR0 + (f - 1) * FLOORN, v1 = v0 + FLOORN, piano = f === 1, topF = f === bd.floors - 1;
        if (kind === 'obra') { Q('brick', cs0, v0, m, v1, -0.002, woU); Q('brick', L - m, v0, L - cs1, v1, -0.002, woU); }
        for (let i = 0; i < nb; i++) {
          const cu0 = m + i * bw, cu1 = cu0 + bw, uc = (cu0 + cu1) / 2, ops = [], fills = [];
          if (kind === 'casona') {
            const isBalc = piano && (st.balcony === 'each' || (st.balcony === 'alternate' && i % 2 === 0) || (st.balcony === 'piano' && i === (nb >> 1)));
            const w = Math.min(st.win.w, bw - 1.0), arch = st.head === 'arch' && (!st.headAlt || i % 2 === 0);
            let sill = isBalc ? 0.03 : piano ? st.win.sill : 0.6, h = isBalc ? 2.4 : piano ? st.win.h - 0.1 : st.win.h - 0.4;
            if (arch) h = Math.max(h, w / 2 + 1.25);
            const op = { u0: uc - w / 2, v0: v0 + sill, u1: uc + w / 2, v1: Math.min(v0 + sill + h, v1 - (arch ? 0.5 : 0.55)), d: A.depth, arch };
            ops.push(op);
            const head = arch ? null : st.head === 'arch' ? 'hood' : st.headAlt && piano ? (i % 2 ? 'pediment' : 'hood') : st.head === 'plain' ? null : st.head;
            fills.push({ glass: vr() < st.bricked ? 'bricked' : 'room', frame: 'wood', shut: !isBalc && vr() < st.shutters ? 'open' : null, surround: true, head, sill: !isBalc, floorY: v0 });
            if (isBalc) { const bal = vr() < 0.22; balconyAt(op.u0 - 0.32, op.u1 + 0.32, v0, bal ? 0.98 : 0.8, bal ? 'balustrade' : 'iron'); }
            else if (!topF && vr() < 0.3) {                                  // a balcon frances: a low iron rail across the window
              B.kit('rail_scroll', KM(uc, op.v0, -0.07, T, UP, N, w + 0.12, 0.85, 1), { iron: 'iron' }, { lod: 'near' });
              for (const y of [op.v0 + 0.04, op.v0 + 0.82]) FB('iron', op.u0 - 0.06, y, op.u1 + 0.06, y + 0.03, -0.09, -0.06, { lod: 'far' });
            }
          } else if (kind === 'comercial') {
            const isBlock = block && i === nb - 1;
            const op = isBlock ? { u0: uc - 0.55, v0: v0 + 0.3, u1: uc + 0.55, v1: v1 - 0.3, d: A.depth } : { u0: cu0 + 0.24, v0: v0 + st.win.sill, u1: cu1 - 0.24, v1: v0 + st.win.sill + st.win.h, d: A.depth };
            ops.push(op); fills.push(isBlock ? { glass: 'block' } : { glass: 'room', frame: 'steel', floorY: v0 });
            if (!isBlock) FB('concrete', op.u0 - 0.05, op.v0 - 0.08, op.u1 + 0.05, op.v0, -0.1, 0, conc);
          } else if (kind === 'obra') {
            const w = st.win.w * (0.92 + vr() * 0.16), r = vr();
            const op = { u0: uc - w / 2, v0: v0 + st.win.sill, u1: uc + w / 2, v1: v0 + st.win.sill + st.win.h, d: A.depth };
            ops.push(op);
            fills.push(r < st.bricked ? { glass: 'bricked' } : r < 0.3 ? { glass: 'dark' } : r < 0.42 ? { glass: 'board' } : { glass: 'room', frame: st.frame === 'raw' ? 'alu' : st.frame, floorY: v0, grille: vr() < st.grille });
          } else {                                                           // vecindad, barrio
            const isBalc = piano && st.balcony === 'one' && i === oneBay;
            if (isBalc) {
              const op = { u0: uc - 0.5, v0: v0 + 0.03, u1: uc + 0.5, v1: v0 + 2.2, d: A.depth };
              ops.push(op); fills.push({ glass: 'room', frame: kind === 'barrio' ? 'wood' : st.frame === 'raw' ? 'alu' : st.frame, surround: kind === 'barrio', floorY: v0 });
              { const par = kind === 'vecindad' && vr() < 0.5; balconyAt(uc - (kind === 'barrio' ? 0.85 : 1.05), uc + (kind === 'barrio' ? 0.85 : 1.05), v0, par ? 1.05 : 0.85, par ? 'parapet' : 'bars'); }
            } else if (kind === 'vecindad' && vr() < 0.08) { /* a blank bay */ }
            else {
              const w = st.win.w * (kind === 'vecindad' ? 0.88 + vr() * 0.24 : 1), h = st.win.h * (kind === 'vecindad' ? 0.9 + vr() * 0.2 : 1);
              const slack = Math.max(0, (bw - w) / 2 - 0.45), off = (vr() - 0.5) * 2 * slack * st.jitter, sy = v0 + st.win.sill + (kind === 'vecindad' ? (vr() - 0.5) * 0.16 : 0);
              const op = { u0: uc + off - w / 2, v0: sy, u1: uc + off + w / 2, v1: sy + h, d: A.depth };
              ops.push(op);
              fills.push({ glass: vr() < st.bricked ? 'bricked' : 'room', frame: kind === 'barrio' ? 'wood' : st.frame === 'raw' ? 'alu' : st.frame, surround: kind === 'barrio',
                shut: vr() < st.shutters ? (kind === 'barrio' && vr() < 0.7 ? 'open' : 'shut') : null, grille: vr() < st.grille, sill: true, floorY: v0 });
              if (kind === 'vecindad' && vr() < st.slit) {                   // a small bathroom or kitchen window beside it
                const side = off > 0 ? -1 : 1, su = uc + off + side * (w / 2 + 0.6);
                if (su - 0.25 > cu0 + 0.12 && su + 0.25 < cu1 - 0.12) { ops.push({ u0: su - 0.25, v0: v0 + 1.75, u1: su + 0.25, v1: v0 + 2.2, d: A.depth }); fills.push({ glass: 'room', frame: 'alu', grille: vr() < 0.5, floorY: v0 }); }
              }
              if (kind === 'barrio' && i === (nb >> 1) && vr() < 0.45) tiles(op.u0 - 0.35, op.u1 + 0.35, op.v1 + sw + 0.1, 0.46, 0.5, [op.u0 - 0.23, op.u1 + 0.23]);
            }
          }
          cellN(cu0, v0, cu1, v1, ops);
          ops.forEach((op, k) => {
            fill(op, fills[k]);
            if (fills[k].glass !== 'block' && op.v0 - v0 > 0.4) sills.push(op);
            if (kind === 'obra' && fills[k].glass !== 'bricked') FB('concrete', op.u0 - 0.12, op.v1, op.u1 + 0.12, op.v1 + 0.16, -0.012, 0, conc);   // a cast lintel
            if (op.v0 - v0 > 0.5 && fills[k].glass === 'room' && kind !== 'casona' && vr() < (kind === 'comercial' ? 0.22 : 0.16)) ac(op);
          });
        }
        if (kind === 'barrio' && st.niche && piano && nb >= 2) B.kit('niche', KM(m + (nb >> 1) * bw, v0 + 1.05, 0, T, UP, N), { trim: 'w_plaster', tile: 'paint' }, { slot: { trim: { color: [0.97, 0.96, 0.92], tile: 1.2 }, tile: { color: [0.25, 0.4, 0.8], tile: 1 } } });
        // the floor line: a string course, a concrete slab edge, or a bare beam
        if (kind === 'casona' || (A.ledge && vr() < A.ledge)) string(v0);
        else if (kind === 'comercial') FB('concrete', cs0 + 0.01, v0 - 0.13, L - cs1 - 0.01, v0 + 0.1, -0.17, 0, conc);
        else if (kind === 'obra') FB('concrete', cs0 + 0.01, v0 - 0.12, L - cs1 - 0.01, v0 + 0.1, -0.016, 0, conc);
        if (kind === 'obra') for (let i = 0; i <= nb; i++) { const u = i === 0 ? Math.max(cs0, 0.02) + 0.12 : i === nb ? L - Math.max(cs1, 0.02) - 0.12 : m + i * bw; FB('concrete', u - 0.12, v0 + 0.1, u + 0.12, v1 - 0.12, -0.014, 0, conc); }
        if (fins) for (let i = 1; i < nb; i++) { const u = m + i * bw; FB('concrete', u - 0.06, v0 + 0.1, u + 0.06, v1 - 0.13, -0.34, 0, conc); }
      }

      // ---- the street floor: the archetype's additions (its openings are the district's own, above) ----------------------
      if (!bd.band && !bd.plinth) {                                    // a guardapolvo where the district drew no band or stone plinth: stone for a casona, B painted otherwise
        let a = cs0 ? 0.03 : 0; const e = L - (cs1 ? 0.03 : 0), h = 0.9;
        const seg = (u0, u1) => { if (u1 - u0 < 0.06 || kind === 'casona') return; FB('paint', u0, 0, u1, h, -0.012, 0, { color: st.bandP, tile: 1.6, solid: false, x: bd.age }); FB('paint', u0, h, u1, h + 0.05, -0.016, 0, { color: st.lineP, tile: 1.6, solid: false, x: bd.age }); };
        for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 - a > 0.05) seg(a, g0); a = Math.max(a, g1); }
        if (e - a > 0.05) seg(a, e);
      }
      if (kind === 'casona') {
        // a cantera base course between the openings (unless a painted band is there), its top moulded, and a blind round arch over every door
        let a = cs0 ? 0.26 : 0.02; const e = L - (cs1 ? 0.26 : 0.02);
        const seg = (u0, u1) => { if (u1 - u0 < 0.12) return; fine((u0 + u1) / 2, () => FB('cantera', u0, 0, u1, 0.92, -0.008, 0, { tile: 2.4, solid: false, lod: FAR })); note('zocalo', { p: P((u0 + u1) / 2, 0, 0), w: u1 - u0 }); B.kit('string', KM((u0 + u1) / 2, 0.92, 0, T, UP, N, u1 - u0, 0.6, 0.14), stoneK, { ...stoneO, lod: 'near' }); };   // (a centimetre proud: clutter shoved against the wall must not sink into it)
        if (!bd.band) { for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { seg(a, g0 - 0.02); a = Math.max(a, g1 + 0.02); } seg(a, e); }
        const sv = bd.surround ? bd.surround.w : 0;
        for (const uc of doorsU) { B.kit('archivolt', KM(uc, 2.32 + sv + 0.01, 0, T, UP, N, 1.1, 1.1, 1), stoneK, stoneO); B.kit('keystone', KM(uc, 2.32 + sv + 0.56, 0, T, UP, N), stoneK, stoneO); }
      } else if (kind === 'comercial') {
        // the cantilevered concrete canopy (marquesina) over the shop fronts, its fascia painted
        const a = Math.max(cs0, 0.02) + 0.03, b = L - Math.max(cs1, 0.02) - 0.03, y = 3.28, dep = 1.35;
        FB('concrete', a, y, b, y + 0.14, -dep, 0, conc); FB('paint', a, y - 0.06, b, y + 0.24, -dep - 0.05, -dep, { color: st.fascia, tile: 1.6, solid: false, x: bd.age });
        note('marquesina', { p: P((a + b) / 2, y, 0), w: b - a, dep, conc });
        FC(a, y, b, y + 0.14, -dep, 0, 'concrete');
      } else if (kind === 'barrio') {
        for (const uc of doorsU) tiles(uc - 0.95, uc + 0.95, 2.32 + (bd.surround ? bd.surround.w : 0) + 0.14, 0.55, 0.45, [uc - 0.8, uc + 0.8]);
      }
      // quoins up the corner, pilasters between the bays
      if (st.quoins && cs1) for (let y = 0.95, k = 0; y < H - 0.3; y += 0.36, k++) B.kit(k % 2 ? 'quoin_a' : 'quoin_b', KM(L, y, 0, T, UP, N), stoneK, stoneO);
      if (st.pilasters && nb > 1) for (let i = 1; i < nb; i++) {
        const u = m + i * bw, y0 = kind === 'casona' ? 0.97 : 0.05, y1 = H - 0.42;
        B.kit('pil_base', KM(u, y0, 0, T, UP, N), trimK, trimO);
        B.kit('pilaster', KM(u, y0 + 0.2, 0, T, UP, N, 1, y1 - y0 - 0.36, 1), trimK, trimO);
        B.kit('pil_cap', KM(u, y1 - 0.16, 0, T, UP, N), trimK, trimO);
      }

      // ---- repairs and wear: newer plaster in patches, plaster fallen off to the brick, stains ---------------------------
      const regions = [...free.filter(r => r[3] <= FLOOR0 + 0.01), ...free2].filter(r => r[2] - r[0] > 0.7 && r[3] - r[1] > 0.6);
      for (let k = 0; k < st.patches && regions.length; k++) {
        const r = regions[Math.floor(vr() * regions.length)], w = Math.min(r[2] - r[0] - 0.05, 0.6 + vr() * 1.6), h = Math.min(r[3] - r[1] - 0.05, 0.45 + vr() * 1.3);
        const u = r[0] + vr() * (r[2] - r[0] - w), v = r[1] + vr() * (r[3] - r[1] - h), g = 0.86 + vr() * 0.22, onBrick = kind === 'obra' && v > FLOOR0;
        Q(onBrick ? wall : (v > FLOOR0 ? upperWall : wall), u, v, u + w, v + h, -0.004 - k * 0.0006, { tile: bd.tile, uo: vr(), vo: vr(), color: onBrick ? bd.tint : [bd.tint[0] * g, bd.tint[1] * g, bd.tint[2] * g * (0.98 + vr() * 0.06)], x: [bd.age[0] * 0.25, bd.age[1] * 0.6, 1] });
      }
      for (let k = 0; k < st.brickPatches && regions.length; k++) {
        const r = regions[Math.floor(vr() * regions.length)];
        if (kind === 'obra' && r[1] >= FLOOR0) continue;
        const cx = r[0] + 0.3 + vr() * Math.max(0, r[2] - r[0] - 0.6), cy = r[1] + 0.3 + vr() * Math.max(0, r[3] - r[1] - 0.6);
        for (let j = 0; j < 3; j++) { const w = 0.25 + vr() * 0.45, h = 0.18 + vr() * 0.3, ox = (vr() - 0.5) * 0.4, oy = (vr() - 0.5) * 0.3; Q('w_brick', cx + ox - w / 2, cy + oy - h / 2, cx + ox + w / 2, cy + oy + h / 2, -0.0035 - j * 0.0004, { tile: 1.2, color: [0.95, 0.9, 0.86], uo: vr(), vo: vr() }); }
      }
      for (const op of sills) if (vr() < A.wear * 0.7) {                   // rain run off the sills, darkening the wall below
        const w = (op.u1 - op.u0) * (0.7 + vr() * 0.4), uc = (op.u0 + op.u1) / 2 + (vr() - 0.5) * 0.2, h = 0.7 + vr() * 1.3;
        Q('d_stain', uc - w / 2, op.v0 - 0.07 - h, uc + w / 2, op.v0 - 0.07, -0.006, { uv: [0, 0, 1, 1], color: [0.9, 0.9, 0.9] });
      }
      for (let k = 0; k < 1 + L / 9 && regions.length; k++) {
        const r = regions[Math.floor(vr() * regions.length)], kd = ['d_patch', 'd_scars', 'd_patch'][Math.floor(vr() * 3)];          // (stains run from sills and units, above)
        const lim = kd === 'd_scars' ? 0.75 : 2.2, s = Math.min(lim, Math.min(r[2] - r[0], r[3] - r[1]) * (0.55 + vr() * 0.4)), ca = (r[0] + r[2]) / 2 + (vr() - 0.5) * 0.6 * (r[2] - r[0] - s), cb = (r[1] + r[3]) / 2;
        if (s < 0.4) continue;
        const g = 0.86 + vr() * 0.22;
        Q(kd, ca - s / 2, cb - s / 2, ca + s / 2, cb + s / 2, -0.006 - k * 0.001, { uv: [0, 0, 1, 1], color: kd === 'd_patch' ? [bd.tint[0] * g, bd.tint[1] * g, bd.tint[2] * g] : [1, 1, 1] });
      }
    }
  }

  // Shallow walk-in shop behind an open shutter. Vertex colours fall off towards the back to fake interior light.
  function shopRoom(bd, fr, ra, rb, op) {
    const { P } = fr, D = 4.7, h = 2.95, y = fr.street === 'main' ? SIDEWALK : 0.02, d0 = op.d;
    const cF = [0.95, 0.93, 0.88], cB = [0.95, 0.93, 0.88], it = { tile: 2.4 };
    const g2 = (a, b, c, d) => ({ ...it, colors: [a, b, c, d] });
    B.quad('tiles', P(ra, y, 0), P(rb, y, 0), P(rb, y, D), P(ra, y, D), { tile: 1.6 });
    B.quad('interior', P(ra, h, D), P(rb, h, D), P(rb, h, d0), P(ra, h, d0), g2(cB, cB, cF, cF));
    B.quad('interior', P(ra, y, D), P(rb, y, D), P(rb, h, D), P(ra, h, D), g2(cB, cB, cB, cB));
    const far = ARCH && assets.kit?.cortina_slats ? 'far2' : undefined;        // (the architecture pass tiles the walls near: see facade())
    if (far) { const mid = P((ra + rb) / 2, 0, (d0 + D) / 2); B.pin2 = B.cell2(mid.x, mid.z); }          // (the room's fine cell: its modelled fittings go in the same one)
    B.quad('tiles', P(ra, y, D - 0.012), P(rb, y, D - 0.012), P(rb, 1.5, D - 0.012), P(ra, 1.5, D - 0.012), { tile: 1.1, lod: far }); B.pin2 = null;
    if (far && !B.mute) (B.notes ||= []).push({ kind: 'sala', P, T: fr.T, N: fr.N, bd, street: fr.street, ra, rb, D, y, h, d0, op });
    B.quad('interior', P(ra, y, d0), P(ra, y, D), P(ra, h, D), P(ra, h, d0), g2(cF, cB, cB, cF));
    B.quad('interior', P(rb, y, D), P(rb, y, d0), P(rb, h, d0), P(rb, h, D), g2(cB, cF, cF, cB));
    B.quad('interior', P(op.u0, y, d0), P(ra, y, d0), P(ra, h, d0), P(op.u0, h, d0), g2(cF, cF, cF, cF));
    B.quad('interior', P(rb, y, d0), P(op.u1, y, d0), P(op.u1, h, d0), P(rb, h, d0), g2(cF, cF, cF, cF));
    B.quad('interior', P(op.u1, op.v1, d0), P(op.u0, op.v1, d0), P(op.u0, h, d0), P(op.u1, h, d0), g2(cF, cF, cF, cF));
    // A second, unseen shell a little outside the room, for the shadow maps only. Where a sunward wall meets the ceiling or
    // a wall that shades it, the shadow lookup sits too close to its caster to resolve, and sunlight shows as a bright line
    // along the seam; the outer shell puts a caster well clear of every seam.
    const e = 0.35, o = 0.5, d1 = 0.02, t = h + o;
    B.quad('interior', P(ra - o, h + e, D + o), P(rb + o, h + e, D + o), P(rb + o, h + e, d1), P(ra - o, h + e, d1), it);
    B.quad('interior', P(ra - o, 0, D + e), P(rb + o, 0, D + e), P(rb + o, t, D + e), P(ra - o, t, D + e), it);
    B.quad('interior', P(ra - e, 0, d1), P(ra - e, 0, D + o), P(ra - e, t, D + o), P(ra - e, t, d1), it);
    B.quad('interior', P(rb + e, 0, D + o), P(rb + e, 0, d1), P(rb + e, t, d1), P(rb + e, t, D + o), it);
    B.quad('interior', P(op.u0, 0, d1), P(ra - 0.4, 0, d1), P(ra - 0.4, t, d1), P(op.u0, t, d1), it);        // (kept short of the next bay's shutter recess)
    B.quad('interior', P(rb + 0.4, 0, d1), P(op.u1, 0, d1), P(op.u1, t, d1), P(rb + 0.4, t, d1), it);
    B.quad('interior', P(op.u1, op.v1, d1), P(op.u0, op.v1, d1), P(op.u0, t, d1), P(op.u1, t, d1), it);
    // a bare bulb on its flex in the middle of the room: lit (the light bake takes it as a lamp)
    const lb = P((ra + rb) / 2, h - 0.5, D * 0.55), lc = P((ra + rb) / 2, h - 0.22, D * 0.55);
    B.box('cable', lc.x, lc.y, lc.z, 0.008, 0.46, 0.008, { solid: false });
    B.geom('bulb', new THREE.SphereGeometry(0.05, 10, 8), new THREE.Matrix4().makeTranslation(lb.x, lb.y, lb.z));
    B.lamp(lb.x, lb.y - 0.04, lb.z);
    const a = P(ra, 0, 0), b = P(rb, 0, D);
    bd.carves.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) });
    // the strips of front wall either side of the opening are drawn solid but fall inside the carved-out room: solid for
    // loose props (as movement colliders they would have made new cover spots and changed where soldiers run to)
    const ax = Math.abs(fr.T.x) > 0.5;
    for (const [u0, u1] of [[ra, op.u0], [op.u1, rb]]) {
      const c = P((u0 + u1) / 2, 0, d0 / 2);
      B.detail(c.x, h / 2, c.z, ax ? u1 - u0 : d0, h, ax ? d0 : u1 - u0, 0, 'plaster');
    }
    // a raised floor (shops on the main street sit at pavement height) is something to stand on, not 14 cm of tiles to sink into
    if (y > 0.05) { const c = P((ra + rb) / 2, 0, (0 + D) / 2); B.collide(c.x, (y - 0.5) / 2, c.z, ax ? rb - ra : D, y + 0.5, ax ? D : rb - ra, 0, 'tile'); }
    anchors.push({ kind: 'room', P, ra, rb, D, y, h, N: fr.N, T: fr.T, bd });
  }

  // ---------------------------------------------------------------------------------------------- building ------
  let prevStyle = null;                                                        // the last building's colours: its neighbour is painted unlike them
  function building(x0, x1, z0, z1, o = {}) {
    const st = o.style ?? rnd.pick(STYLES), floors = o.floors ?? rnd.pick([2, 2, 3, 3, 3]);
    const was = B.mute; if (o.ghost) B.mute = true;              // a ghost is generated (same random draws) and thrown away: a passage replaces it
    const bd = {
      ghost: !!o.ghost, late: o.late || '',
      x0, x1, z0, z1, floors, H: FLOOR0 + (floors - 1) * FLOORN, wall: st.wall, tint: o.tint || rnd.pick(st.tints),
      tile: st.tile || rnd.range(2.6, 3.2), uo: rnd(), vo: rnd(), sides: o.sides || 'nsew', street: o.street || {}, shops: o.shops || [],
      trim: rnd.pick([[0.86, 0.84, 0.8], [0.75, 0.74, 0.72], [0.95, 0.9, 0.82]]), shTint: rnd.pick(SHUTTER_TINTS), doorTint: rnd.pick([[1, 1, 1], [0.7, 0.8, 0.85], [0.6, 0.75, 0.6], [0.85, 0.7, 0.55]]),
      frameIron: rnd.chance(0.3), frameTint: rnd.pick([[0.9, 0.9, 0.86], [0.55, 0.45, 0.38], [0.5, 0.62, 0.66], [0.75, 0.72, 0.65]]),
      balcMode: o.balcMode ?? rnd.pick([0, 1, 1, 2]), balcPhase: rnd.int(0, 1), balcSolid: rnd.chance(0.35),
      ledge: rnd.chance(0.55), plinth: rnd.chance(0.5), cornice: rnd.chance(0.6),
      winW: rnd.pick([1.0, 1.1, 1.25]), winH: rnd.pick([1.3, 1.45, 1.55]),
      winTypes: rnd.pick([['shut', 'open', 'glass', 'half', 'glass'], ['glass', 'glass', 'dark', 'board', 'shut'], ['open', 'half', 'shut', 'shut', 'glass'], ['glass', 'dark', 'open', 'glass', 'board']]),
      carves: [], roofAccess: !!o.roofAccess, parapetGap: o.parapetGap,
    };
    if (rs) {
      const shade = k => [bd.tint[0] * k, bd.tint[1] * k, bd.tint[2] * k];
      bd.band = rs() < (o.band ?? style.band) ? { h: rs.range(0.85, 1.2), c: rs() < 0.45 ? shade(rs.range(0.42, 0.6)) : rs.pick(BANDS) } : null;
      bd.surround = rs() < (o.surround ?? style.surround) ? { w: rs.range(0.1, 0.16), c: rs() < 0.5 ? [0.97, 0.96, 0.92] : rs.pick(BANDS) } : null;
    }
    // the kit's choices for this building: stone (cantera) or plaster trim, a tiled eave instead of a cornice, tile hoods
    const hk = k => hash(x0, z0, x1, z1, k);
    bd.kit = { stone: hk(1) < 0.38, tejaroz: !bd.cornice && floors >= 2 && hk(2) < 0.34, hoods: hk(3) < 0.24 };
    // its archetype (facades.js), from a stream of its own: colours and what is drawn change, never what is solid or
    // where anything stands (the street floor's openings, bands and frames stay the district's own)
    const fs = bd.style = facadeStyle(bd, prevStyle); prevStyle = fs;
    bd.wall = fs.wallKey; bd.tile = fs.wallTile; bd.tint = fs.tint; bd.age = fs.age; bd.trim = fs.trimC; bd.doorTint = fs.door; bd.frameTint = fs.woodP; bd.shTint = fs.woodP;
    if (bd.band) bd.band.c = fs.kind === 'casona' ? tint('#cdb89c', 'paint', 1, 0.05, 0.5) : fs.bandP;   // (colour only: the band's boxes stay where they were)
    if (bd.surround) { bd.surround.c = fs.frameP; bd.surround.ck = fs.frameW; }
    bd.kit.hoods = false; bd.kit.tejaroz = fs.roof === 'eave' && floors >= 2;
    bd.kit.stone = fs.stone || (fs.kind === 'casona' && bd.kit.stone);
    bd.cornice = fs.kind === 'casona' || (fs.kind === 'barrio' && fs.roof === 'plain');
    buildings.push(bd);
    for (const s of 'nsew') facade(bd, s);
    const H = bd.H, wo = { color: bd.tint, tile: bd.tile, uo: bd.uo, vo: bd.vo, x: bd.age }, pt = 0.26, py = H + PARAPET / 2;
    B.quad('concrete', V(x0, H, z1), V(x1, H, z1), V(x1, H, z0), V(x0, H, z0), { tile: 3, color: [0.78, 0.76, 0.72] });
    // the parapet's moulded coping (kit), crowned and dripped on both faces
    const cTrim = { trim: bd.kit.stone ? 'cantera' : 'concrete' }, cO = bd.kit.stone ? { color: [1, 1, 1], tile: 3.2 } : { color: bd.trim, tile: 2.0 };
    const coping = (cx, cz, sx, sz, y = H + PARAPET) => {
      const along = sz > sx ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), len = Math.max(sx, sz) + 0.04;
      B.kit('coping', new THREE.Matrix4().makeBasis(along.clone().multiplyScalar(len), UP, along.clone().cross(UP)).setPosition(cx, y, cz), cTrim, cO);
    };
    const par = (cx, cz, sx, sz, side) => {
      const g = bd.parapetGap;
      if (g && g.side === side) {     // split around a gap (z-range) for roof access
        const zA = cz - sz / 2, zB = cz + sz / 2;
        for (const [a, b] of [[zA, g.a], [g.b, zB]]) { B.box(bd.wall, cx, py, (a + b) / 2, sx, PARAPET, b - a, wo); coping(cx, (a + b) / 2, sx, b - a); if (bd.roofAccess) B.collide(cx, py, (a + b) / 2, sx, PARAPET, b - a); }
        return;
      }
      const front = !!(bd.street?.[side] && bd.street[side] !== 'none');
      if (front && fs.roof === 'balustrade') { balustrade(cx, cz, sx, sz); if (bd.roofAccess) B.collide(cx, py, cz, sx, PARAPET, sz); return; }
      B.box(fs.kind === 'obra' ? 'brick' : bd.wall, cx, py, cz, sx, PARAPET, sz, fs.kind === 'obra' ? { tile: 1.9, color: [0.96, 0.9, 0.84] } : wo);
      coping(cx, cz, sx, sz);
      if (bd.roofAccess) B.collide(cx, py, cz, sx, PARAPET, sz);
      if (front) roofline(cx, cz, sx, sz);
    };
    // the archetype's roofline on a street side: a stone balustrade between piers with finials (casona), a stepped
    // parapet or a sign frame (1950s block), a curved crest (barrio), column stubs bristling with rebar (unfinished)
    const runOf = (cx, cz, sx, sz) => { const along = sz > sx ? V(0, 0, 1) : V(1, 0, 0); return { along, len: Math.max(sx, sz), thick: Math.min(sx, sz), Z: along.clone().cross(UP) }; };
    const finial = (x, z, y) => { B.box('cantera', x, y + 0.48, z, 0.36, 0.96, 0.36, { tile: 3.2 }); B.box('cantera', x, y + 0.99, z, 0.44, 0.06, 0.44, { tile: 3.2 }); B.geom('cantera', new THREE.SphereGeometry(0.13, 10, 8), new THREE.Matrix4().makeTranslation(x, y + 1.17, z), { uvScale: 0.5 }); };
    function balustrade(cx, cz, sx, sz) {
      const { along, len, Z } = runOf(cx, cz, sx, sz), n = Math.max(1, Math.round(len - 0.4)), ul = (len - 0.4) / n;
      for (let k = 0; k < n; k++) { const t = -len / 2 + 0.2 + ul * (k + 0.5); B.kit('balustrade', new THREE.Matrix4().makeBasis(along.clone().multiplyScalar(ul), UP, Z.clone()).setPosition(cx + along.x * t, H, cz + along.z * t), { trim: 'cantera' }, { slot: { trim: { color: [1, 1, 1], tile: 3.2 } } }); }
      for (const t of [-len / 2 + 0.18, len / 2 - 0.18]) finial(cx + along.x * t, cz + along.z * t, H);
    }
    function roofline(cx, cz, sx, sz) {
      const { along, len, thick, Z } = runOf(cx, cz, sx, sz), top = H + PARAPET, vr = fs.vr;
      const at = t => V(cx + along.x * t, 0, cz + along.z * t), dim = (l, h, d = thick) => along.x ? [l, h, d] : [d, h, l];
      if (fs.roof === 'stepped' && len > 7) {
        for (const [f, h] of [[0.4, 0.55], [0.18, 1.0]]) { const [a, b, c] = dim(len * f, h); B.box(bd.wall, cx, top + h / 2, cz, a, b, c, wo); coping(cx, cz, ...dim(len * f, 0, thick).filter((_, i) => i !== 1), top + h); }
      } else if (fs.roof === 'sign' && len > 6) {
        const w = Math.min(len * 0.55, 6), col = tint(['#b23a2e', '#20438a', '#e0a832', '#2f6b45'][Math.floor(vr() * 4)], 'paint', 0.9, 0.04, 0.45);
        for (const t of [-w * 0.4, w * 0.4]) { const p = at(t); B.box('iron', p.x, top + 0.75, p.z, 0.08, 1.5, 0.08); }
        const [a, b, d] = dim(w, 1.0, 0.06); B.box('paint', cx, top + 1.1, cz, a, b, d, { color: col, tile: 2 });
        const [a2, b2, d2] = dim(w + 0.08, 0.05, 0.08); B.box('iron', cx, top + 1.62, cz, a2, b2, d2); B.box('iron', cx, top + 0.58, cz, a2, b2, d2);
      } else if (fs.roof === 'crest') {
        const sh = new THREE.Shape(), hw = Math.min(1.5, len * 0.22), hh = 0.75 + vr() * 0.25;
        sh.moveTo(-hw, 0); sh.lineTo(-hw, 0.12); sh.bezierCurveTo(-hw * 0.6, 0.12, -hw * 0.55, hh * 0.55, -hw * 0.3, hh * 0.62); sh.bezierCurveTo(-hw * 0.12, hh * 0.68, -0.12, hh, 0, hh);
        sh.bezierCurveTo(0.12, hh, hw * 0.12, hh * 0.68, hw * 0.3, hh * 0.62); sh.bezierCurveTo(hw * 0.55, hh * 0.55, hw * 0.6, 0.12, hw, 0.12); sh.lineTo(hw, 0); sh.lineTo(-hw, 0);
        const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -thick / 2);
        B.geom(bd.wall, g, new THREE.Matrix4().makeBasis(along.clone(), UP, Z.clone()).setPosition(cx, top - 0.02, cz), { color: bd.tint, uvScale: 1 / bd.tile, xf: () => bd.age });
        B.geom('cantera', new THREE.SphereGeometry(0.11, 10, 8), new THREE.Matrix4().makeTranslation(cx, top + hh + 0.08, cz), { uvScale: 0.5 });
      } else if (fs.roof === 'stubs') {
        for (let t = -len / 2 + 0.3; t <= len / 2 - 0.3 + 1e-6; t += Math.max(2.4, (len - 0.6) / Math.max(1, Math.round((len - 0.6) / 3.3)))) {
          if (vr() < 0.3) continue;
          const p = at(t), h = 0.3 + vr() * 0.55;
          B.box('concrete', p.x, top + h / 2, p.z, 0.26, h, 0.26, { tile: 1, color: [0.78, 0.76, 0.72] });
          for (const [ox, oz] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) { const l = 0.4 + vr() * 0.9; B.geom('iron', new THREE.CylinderGeometry(0.007, 0.007, l, 4), new THREE.Matrix4().makeTranslation(p.x + ox, top + h + l / 2, p.z + oz), { color: [0.6, 0.42, 0.3] }); }
        }
      }
    }
    par(x1 - pt / 2, (z0 + z1) / 2, pt, z1 - z0, 'e'); par(x0 + pt / 2, (z0 + z1) / 2, pt, z1 - z0, 'w');
    par((x0 + x1) / 2, z1 - pt / 2, x1 - x0 - 2 * pt, pt, 'n'); par((x0 + x1) / 2, z0 + pt / 2, x1 - x0 - 2 * pt, pt, 's');
    // colliders: footprint minus shop rooms
    let rects = [{ x0, x1, z0, z1 }];
    for (const c of bd.carves) {
      const next = [];
      for (const r of rects) {
        const ix0 = Math.max(r.x0, c.x0), ix1 = Math.min(r.x1, c.x1), iz0 = Math.max(r.z0, c.z0), iz1 = Math.min(r.z1, c.z1);
        if (ix0 >= ix1 || iz0 >= iz1) { next.push(r); continue; }
        if (r.x0 < ix0) next.push({ x0: r.x0, x1: ix0, z0: r.z0, z1: r.z1 });
        if (ix1 < r.x1) next.push({ x0: ix1, x1: r.x1, z0: r.z0, z1: r.z1 });
        if (r.z0 < iz0) next.push({ x0: ix0, x1: ix1, z0: r.z0, z1: iz0 });
        if (iz1 < r.z1) next.push({ x0: ix0, x1: ix1, z0: iz1, z1: r.z1 });
      }
      rects = next;
    }
    const top = bd.roofAccess ? H : H + PARAPET;
    for (const r of rects) B.collide((r.x0 + r.x1) / 2, (top - 1) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, top + 1, r.z1 - r.z0, 0, bd.wall === 'w_brick' ? 'brick' : 'plaster');
    for (const c of bd.carves) B.collide((c.x0 + c.x1) / 2, (3.0 + top) / 2, (c.z0 + c.z1) / 2, c.x1 - c.x0, top - 3.0, c.z1 - c.z0, 0, 'plaster');
    anchors.push({ kind: 'roof', bd });
    B.mute = was;
    return bd;
  }

  // Split a strip into buildings along z (axis 'z') or x.
  function row(x0, x1, z0, z1, axis, o) {
    let a = axis === 'z' ? z0 : x0; const end = axis === 'z' ? z1 : x1;
    let k = 0;
    while (a < end - 0.01) {
      let len = rnd.range(o.min || 8.5, o.max || 13.5);
      if (end - (a + len) < (o.min || 8.5)) len = end - a;
      const oo = { ...o, ...(o.each ? o.each(k, a, len) : {}) }, last = a + len >= end - 0.01;
      const lo = axis === 'z' ? 's' : 'w', hi = axis === 'z' ? 'n' : 'e';
      oo.sides = [...o.sides].filter(c => (c !== lo || k === 0) && (c !== hi || last)).join('');
      if (axis === 'z') building(x0, x1, a, a + len, oo); else building(a, a + len, z0, z1, oo);
      a += len; k++;
    }
  }
  return { facade, shopRoom, building, row };
}

export function buildWorld(R, M) {
  const B = new Builder(), rnd = rng(20261114);
  const buildings = [];
  const anchors = [];      // hooks for dressing: { kind, p, N, T, w, bd }
  const { building, row } = architecture(B, rnd, buildings, anchors, rng(31337), { band: 0.55, surround: 0.4 });     // (the style stream only adds paint: bands and window surrounds)

  // ---- city blocks ---------------------------------------------------------------------------------------------------
  // west of main street (their east faces line the street, west faces line the alley)
  row(-27, -6, -57, -23, 'z', { sides: 'nsew', street: { e: 'main', w: 'alley', n: 'cross', s: 'cross' }, each: k => ({ shops: k === 1 ? [{ side: 'e', bay: 1 }] : [] }) });
  row(-27, -6, 23, 57, 'z', { sides: 'nsew', street: { e: 'main', w: 'alley', n: 'cross', s: 'cross' }, each: k => ({ shops: k === 0 ? [{ side: 'e', bay: 1 }] : k === 2 ? [{ side: 'e', bay: 0 }] : [] }) });
  // east of main street (west faces on the street, east faces on the covered market lane)
  row(6, 26, -57, -23, 'z', { sides: 'nsew', street: { w: 'main', e: 'market', n: 'cross', s: 'cross' }, each: k => ({ shops: k === 0 ? [{ side: 'w', bay: 1 }, { side: 'e', bay: 0 }] : k === 2 ? [{ side: 'e', bay: 1 }] : [] }) });
  row(6, 26, -17, 17, 'z', { sides: 'nsew', street: { w: 'main', e: 'market', n: 'cross', s: 'cross' }, each: k => ({ shops: k === 1 ? [{ side: 'w', bay: 1 }, { side: 'e', bay: 1 }] : [{ side: 'e', bay: 0 }] }) });
  row(6, 26, 23, 57, 'z', { sides: 'nsew', street: { w: 'main', e: 'market', n: 'cross', s: 'cross' }, each: k => ({ shops: k === 1 ? [{ side: 'w', bay: 0 }] : k === 0 ? [{ side: 'e', bay: 1 }] : [] }) });
  // plaza west edge: a low building with roof access, a passage to the alley, and a taller neighbour
  const low = building(-27, -17, -17, -3.2, { floors: 1, sides: 'nsew', street: { e: 'none', w: 'alley', n: 'lane', s: 'cross' }, roofAccess: true, parapetGap: { side: 'e', a: -13.9, b: -12.1 }, balcMode: 0, style: { wall: 'w_plaster', tints: [[1.0, 0.86, 0.75]] } });
  building(-27, -17, 1.2, 17, { floors: 3, sides: 'nsew', street: { e: 'plaza', w: 'alley', n: 'cross', s: 'lane' }, shops: [{ side: 'e', bay: 2 }] });
  // outer ring
  row(-46, -31, -80, 80, 'z', { sides: 'e', street: { e: 'alley' }, min: 9, max: 15, each: () => ({ floors: rnd.pick([2, 3, 3, 4]) }) });
  // (the east ring now also fronts the new quarter: its east faces are drawn later, and the stretches the four passages
  // cut through are generated as ghosts and rebuilt round the passages, so nothing else in the district moves)
  row(31, 46, -80, 80, 'z', { sides: 'w', street: { w: 'market' }, min: 9, max: 15, each: (k, a, len) => ({ floors: rnd.pick([2, 3, 3, 4]), shops: k % 3 === 1 ? [{ side: 'w', bay: 1 }] : [], ghost: GATES.some(([g0, g1]) => a < g1 - 0.05 && a + len > g0 + 0.05), late: 'e' }) });
  row(-31, 31, -80, -63, 'x', { sides: 'n', street: { n: 'cross' }, min: 9, max: 14, each: () => ({ floors: rnd.pick([2, 3, 3]) }) });
  row(-31, 31, 63, 80, 'x', { sides: 's', street: { s: 'cross' }, min: 9, max: 14, each: () => ({ floors: rnd.pick([3, 3, 4]) }) });

  // exterior stairs up to the low roof (east side of the low building, climbing south)
  {
    const n = 17, rise = low.H / n, run = 0.44, w = 1.25, x = -17 + w / 2;
    for (let i = 0; i < n; i++) {
      const z = -4.6 - i * run, h = rise * (i + 1);
      B.box('concrete', x, h / 2, z - run / 2, w, h, run, { tile: 2.2, color: [0.86, 0.84, 0.8] });
      B.collide(x, h / 2, z - run / 2, w, h, run);
      B.box('w_white', x + w / 2 + 0.09, (h + 0.95) / 2, z - run / 2, 0.18, h + 0.95, run, { tile: 2.6 });
      B.collide(x + w / 2 + 0.09, (h + 0.95) / 2, z - run / 2, 0.18, h + 0.95, run);
    }
    const zt = -4.6 - n * run;                       // landing
    B.box('concrete', x, low.H / 2, zt - 0.9, w, low.H, 1.8, { tile: 2.2, color: [0.86, 0.84, 0.8] }); B.collide(x, low.H / 2, zt - 0.9, w, low.H, 1.8);
    B.box('w_white', x + w / 2 + 0.09, (low.H + 0.95) / 2, zt - 0.9, 0.18, low.H + 0.95, 1.8, { tile: 2.6 }); B.collide(x + w / 2 + 0.09, (low.H + 0.95) / 2, zt - 0.9, 0.18, low.H + 0.95, 1.8);
    B.box('w_white', x, (low.H + 0.95) / 2, zt - 1.89, w + 0.36, low.H + 0.95, 0.18, { tile: 2.6 }); B.collide(x, (low.H + 0.95) / 2, zt - 1.89, w + 0.36, low.H + 0.95, 0.18);
  }

  // ---- monumental arch across the main street -----------------------------------------------------------------------
  {
    const z0 = 13, depth = 2.7, halfW = 7.0, open = 3.7, spring = 3.5, top = 9.8, tint = [1.2, 1.08, 0.9];
    const s = new THREE.Shape();
    s.moveTo(-halfW, 0); s.lineTo(-open, 0); s.lineTo(-open, spring); s.absarc(0, spring, open, Math.PI, 0, true);
    s.lineTo(open, 0); s.lineTo(halfW, 0); s.lineTo(halfW, top); s.lineTo(-halfW, top); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 28 });
    B.geom('concrete', g, new THREE.Matrix4().makeTranslation(0, 0, z0), { color: tint, uvScale: 1 / 3.4 });
    const st = { color: [1.0, 0.95, 0.86], tile: 2.4 };
    // With the architecture pass's mouldings for it (tools/blender/arch.py: an entablature, an archivolt and keystone,
    // imposts, panels, medallions), the arch's plain boxes for the same things are left undrawn: old(fn) runs them all
    // the same (their solids are recorded as always) and the note says what goes there instead.
    const dressed = ARCH && !!assets.kit?.arco_cornisa, old = fn => { const m = B.muteDraw; B.muteDraw = dressed || m; fn(); B.muteDraw = m; };
    if (dressed && !B.mute) (B.notes ||= []).push({ kind: 'arco', z0, depth, halfW, open, spring, top, st });
    old(() => {
      B.box('concrete', 0, top + 0.16, z0 + depth / 2, halfW * 2 + 0.5, 0.32, depth + 0.5, st);
      B.box('concrete', 0, top + 0.42, z0 + depth / 2, halfW * 2 + 0.9, 0.2, depth + 0.9, st);
      B.box('concrete', 0, top - 1.3, z0 + depth / 2, halfW * 2 + 0.22, 0.2, depth + 0.22, st);
    });
    for (const sx of [-1, 1]) {
      const cx = sx * (halfW + open) / 2, w = halfW - open;
      B.box('concrete', cx, 0.45, z0 + depth / 2, w + 0.3, 0.9, depth + 0.3, st);                // plinth
      old(() => {
        B.box('concrete', cx, spring + 0.1, z0 + depth / 2, w + 0.2, 0.22, depth + 0.2, st);       // impost
        for (const zf of [z0 - 0.04, z0 + depth + 0.04]) {                                        // shallow framed panels
          B.box('concrete', cx, 2.25, zf, w - 1.0, 0.1, 0.08, st); B.box('concrete', cx, 1.25, zf, w - 1.0, 0.1, 0.08, st);
          B.box('concrete', cx - (w - 1.0) / 2, 1.75, zf, 0.1, 1.1, 0.08, st); B.box('concrete', cx + (w - 1.0) / 2, 1.75, zf, 0.1, 1.1, 0.08, st);
        }
      });
      B.collide(cx, top / 2, z0 + depth / 2, w + 0.3, top, depth + 0.3, 0, 'plaster');
    }
    for (const zf of [z0 - 0.012, z0 + depth + 0.012]) for (let i = 0; i < 5; i++) {
      const x = rnd.range(-6.2, 6.2), y = rnd.range(1, 8.5), sz = rnd.range(0.7, 1.6), hx = (sz / 2) * (zf < z0 ? 1 : -1);
      if (Math.abs(x) < open + 0.6 && y < spring + open + 0.6) continue;
      const a = V(x + hx, y - sz / 2, zf), b = V(x - hx, y - sz / 2, zf), c = V(x - hx, y + sz / 2, zf), d = V(x + hx, y + sz / 2, zf);
      B.quad(rnd.pick(['d_scars', 'd_scars', 'd_stain']), a, b, c, d, { uv: [0, 0, 1, 1] });
    }
    B.collide(0, (spring + open * 0.72 + top) / 2 + 0.3, z0 + depth / 2, open * 2, top - spring - open * 0.72, depth, 0, 'plaster');
  }

  // ---- sidewalks along the main street ------------------------------------------------------------------------------
  for (const [za, zb] of [[-57, -23], [-17, 17], [23, 57]]) for (const sx of [-1, 1]) {
    if (sx === -1 && za === -17) continue;                 // the plaza opens straight onto the road
    const xa = sx * 4.0, xb = sx * 6.0, x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), kerb = sx * 4.0, kin = sx * 4.2;
    B.quad('pavement', V(Math.min(kin, xb), SIDEWALK, zb), V(Math.max(kin, xb), SIDEWALK, zb), V(Math.max(kin, xb), SIDEWALK, za), V(Math.min(kin, xb), SIDEWALK, za), { tile: 2.4 });
    B.box('concrete', (kerb + kin) / 2, SIDEWALK / 2, (za + zb) / 2, 0.2, SIDEWALK, zb - za, { tile: 1.3, color: [0.9, 0.88, 0.84] });
    for (const z of [za, zb]) B.quad('concrete', ...(z === zb ? [V(x0, 0, z), V(x1, 0, z), V(x1, SIDEWALK, z), V(x0, SIDEWALK, z)] : [V(x1, 0, z), V(x0, 0, z), V(x0, SIDEWALK, z), V(x1, SIDEWALK, z)]), { tile: 1.3 });
    B.collide((x0 + x1) / 2, SIDEWALK / 2 - 0.5, (za + zb) / 2, 2, SIDEWALK + 1, zb - za, 0, 'concrete');
  }

  // ---- dressing (props, stalls, cloth, palms, cables…) ---------------------------------------------------------------
  const ctx = { B, M, rnd, buildings, anchors, low, gates: GATES, rs: rng(4711) };
  dress(ctx);
  const ghosts = buildings.filter(b => b.ghost);
  for (const g of ghosts) buildings.splice(buildings.indexOf(g), 1);            // from here on the passages are open ground

  // ---- the market quarter east of the ring (its own random streams) ---------------------------------------------------
  const quarter = buildQuarter({ B, M, buildings, anchors, ghosts, gates: GATES, architecture, FLOOR0, PARAPET });

  // ---- ground: 1 m grid with blend weights (x = paving, y = sand, z = stain) -----------------------------------------
  {
    const X0 = -70, X1 = 132, Z0 = -104, Z1 = 104, nx = X1 - X0, nz = Z1 - Z0;
    const own = [...quarter.paved, [HALL.x0, HALL.x1, HALL.z0, HALL.z1], [PLAZUELA.x0, PLAZUELA.x1, PLAZUELA.z0, PLAZUELA.z1], [ATRIUM.x0, ATRIUM.x1, ATRIUM.z0, ATRIUM.z1]];
    const underOwn = (x, z) => own.some(([a, b, c, d]) => x >= a - 1e-6 && x + 1 <= b + 1e-6 && z >= c - 1e-6 && z + 1 <= d + 1e-6);   // a whole 1 m cell under the quarter's paving
    const inside = (x, z) => { for (const b of buildings) if (x > b.x0 + 0.4 && x < b.x1 - 0.4 && z > b.z0 + 0.4 && z < b.z1 - 0.4 && !b.carves.length) return true; return false; };
    const distB = (x, z) => { let d = 9; for (const b of buildings) { const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1); const q = Math.hypot(dx, dz); if (q < d) d = q; } return d; };
    const nd = noise.image.data, nAt = (x, z, s, ch) => nd[(((Math.floor(z * s) % 256) + 256) % 256 * 256 + ((Math.floor(x * s) % 256) + 256) % 256) * 4 + ch] / 255;
    const wts = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = X0 + i, z = Z0 + j, o = (j * (nx + 1) + i) * 3;
      const inMap = (Math.abs(x) < 31.5 || (x > 30 && x < 96.5)) && Math.abs(z) < 63.5;
      const road = inMap && x < 31.5 && (Math.abs(x) <= 4.2 || [-60, -20, 20, 60].some(c => Math.abs(z - c) <= 3.2));
      const alley = x <= -26.5 && x >= -31.5, market = x >= 25.5 && x <= 31.5, plaza = x > -17.5 && x < -5 && Math.abs(z) < 17.5;
      let pave = road ? 0 : 1, sand = 0.0;
      if (alley) { pave = 0.9; sand = 0.3; }
      if (market) { pave = 1; sand = 0.22; }
      if (plaza && !road) { pave = 1; sand = 0.2; }
      if (!inMap) { pave = 0.3; sand = 0.95; }
      const d = distB(x, z);
      sand += 0.6 * Math.exp(-d / 0.8) + (nAt(x, z, 2.1, 0) - 0.5) * 0.35 + (road && Math.abs(Math.abs(x) - 4) < 0.7 ? 0.45 : 0) + (road ? Math.max(0, nAt(x, z, 0.6, 1) - 0.62) * 1.6 : 0);
      wts[o] = pave; wts[o + 1] = clamp(sand, 0, 1); wts[o + 2] = 0;
    }
    for (const a of [...anchors, ...quarter.anchors]) if (a.kind === 'stain') {       // oil / soot patches left by vehicles and fires
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const d = Math.hypot(X0 + i - a.x, Z0 + j - a.z); if (d < a.r) wts[(j * (nx + 1) + i) * 3 + 2] = Math.max(wts[(j * (nx + 1) + i) * 3 + 2], (1 - d / a.r) * a.s); }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = X0 + i, z = Z0 + j;
      if (inside(x + 0.5, z + 0.5) || underOwn(x, z)) continue;
      const w = (ii, jj) => { const o = (jj * (nx + 1) + ii) * 3; return [wts[o], wts[o + 1], wts[o + 2]]; };
      B.quad('ground', V(x, 0, z + 1), V(x + 1, 0, z + 1), V(x + 1, 0, z), V(x, 0, z), { tile: 3.2, xs: [w(i, j + 1), w(i + 1, j + 1), w(i + 1, j), w(i, j)] });
    }
    const far = 900, edge = [[-far, Z1, far, far], [-far, -far, far, Z0], [-far, Z0, X0, Z1], [X1, Z0, far, Z1]];
    for (const [a, b, c, d] of edge) B.quad('ground', V(a, 0, d), V(c, 0, d), V(c, 0, b), V(a, 0, b), { tile: 3.2, x: [0.3, 1, 0], far: true });
  }

  // ---- finalize ------------------------------------------------------------------------------------------------------
  const meshes = B.build(M), rayMeshes = [], clothMeshes = [];      // rayMeshes: what stops a bullet's ray. clothMeshes: awnings, laundry, rugs: a round goes through, a thrown object does not
  const group = new THREE.Group(); group.name = 'world';
  for (const m of meshes) {
    const water = m.name.startsWith('water');               // (the fountain's water: it neither casts shadows nor stops anything)
    m.castShadow = !m.name.startsWith('d_') && !water && !['ground', 'cable', 'dark', 'glass', 'room', 'matte', 'paint', 'sign', 'bulb'].includes(m.name) && !m.userData.noShadow; m.receiveShadow = true;    // (paint and signs lie flat on walls: nothing to cast)
    const lod = lodRange(m); if (lod) m.userData.lod = lod;
    m.matrixAutoUpdate = false;
    if (FOLIAGE.includes(m.name) || m.name.startsWith('d_') || water) m.userData.noAO = true;
    if (water) m.renderOrder = m.name === 'water' ? 1 : m.name === 'water_foam' ? 2 : 3;   // the surface, then the foam on it, then the falls
    if (m.name.startsWith('d_')) m.renderOrder = 2;
    if (!m.material.userData.noBVH && !m.userData.noBVH && !m.name.startsWith('d_')) { m.geometry.computeBoundsTree({ maxLeafTris: 8 }); rayMeshes.push(m); }
    else if (m.material.userData.noBVH && !water && !FOLIAGE.includes(m.name) && !m.name.startsWith('d_')) { m.geometry.computeBoundsTree({ maxLeafTris: 8 }); m.userData.cloth = true; clothMeshes.push(m); }
    group.add(m);
  }
  R.setupTree(group);
  // Near a tree its modelled leaves cast no shadow: the old leaf cards stay in its place, drawn unseen (no colour, no
  // depth) by a proxy material, and cast the canopy's shadow (render.js cull) instead of thousands of leaves in every cascade.
  for (const m of meshes) {
    if (m.userData.kitLod === 'near' && (m.name === 'leaf' || m.name === 'leaf_mass' || m.name === 'palm_leaf')) m.castShadow = false;
    if (m.userData.kitLod === 'far' && (m.name === 'leaves' || m.name === 'frond')) {
      const p = m.material.clone(); p.userData = m.material.userData; p.colorWrite = false; p.depthWrite = false;
      m.userData.baseMaterial = m.material; m.userData.shadowProxy = R.setup(p);
    }
  }
  // Drawing: one multi-draw per material (batch.js). The cell meshes stay out of the scene, as the district's data: ray
  // trees, the light bake's input, and where the renderer's culling writes each cell's visibility. The trees' shadow
  // proxies (their material changes with distance) and the fountain's water (drawn in a fixed order) keep meshes of their own.
  if (BATCH) { const d = batchWorld(meshes, m => !!m.userData.shadowProxy || m.name.startsWith('water')); R.scene.add(d.group); R.detached = meshes; R.twins = d.twins; }
  else R.scene.add(group);

  const nav = new NavGrid(B.colliders, -48, -82, 113, 82);
  const spawns = {
    0: [[-29, -60], [0, -60.5], [28.5, -60], [-14, -60], [14, -60], [-3, -52], [3, -55], ...QUARTER_SPAWNS[0]].map(([x, z]) => ({ x, z, yaw: 0 })),
    1: [[-29, 60], [0, 60.5], [28.5, 60], [-14, 60], [14, 60], [-3, 52], [3, 55], ...QUARTER_SPAWNS[1]].map(([x, z]) => ({ x, z, yaw: Math.PI })),
  };
  for (const sp of [...spawns[0], ...spawns[1]]) if (!nav.free(sp.x, sp.z)) nav.center(nav.nearestFree(sp.x, sp.z), sp);      // dressing may have parked something on a spawn point
  const tris = meshes.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0);
  console.info(`world: ${meshes.length} meshes, ${Math.round(tris / 1000)}k tris, ${B.colliders.length} colliders, ${B.details.length} detail solids, ${buildings.length} buildings, ${B.dynamic.length} loose props${B.dropped.length ? ` (${B.dropped.length} left out: no clear spot)` : ''}`);
  const surfaceAt = (x, z) => {
    if (x < -46 || x > 111 || Math.abs(z) > 80) return 'dirt';
    if (x > HALL.x0 && x < HALL.x1 && z > HALL.z0 && z < HALL.z1) return 'tile';
    for (const b of buildings) if (b.carves.length && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return 'tile';
    return 'concrete';
  };
  // The east ring is a solid wall between the districts but for the four passages: what the renderer needs to know to
  // leave out the side the camera cannot see (its lowest roofline, and the passages it can see through).
  const ringRoof = Math.min(...buildings.filter(b => b.x0 === 31 && b.x1 === 46).map(b => b.H + (b.roofAccess ? 0 : PARAPET)));
  const zones = { x0: 31, x1: 46, split0: 22, split1: 46, roof: ringRoof, gates: quarter.passages };
  return { group, colliders: B.colliders, details: B.details, rayMeshes, clothMeshes, buildings, nav, spawns, anchors: anchors.filter(a => !a.legacy), surfaceAt, dynamic: B.dynamic, emitters: B.emitters, lamps: B.lamps, rails: B.rails || [], quarterHotspots: QUARTER_HOTSPOTS, zones, notes: B.notes || [] };
}
