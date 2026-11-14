// The map: ground, buildings (with real window/door depth), the arch and plaza. Dressing lives in dressing.js.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Builder } from './builder.js';
import { NavGrid } from './physics.js';
import { dress } from './dressing.js';
import { rng, clamp } from './util.js';
import { noise } from './materials.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const FLOOR0 = 3.5, FLOORN = 3.05, PARAPET = 0.95, SIDEWALK = 0.14;

const PLASTER_TINTS = [[0.97, 0.90, 0.76], [1.0, 0.86, 0.75], [0.78, 0.86, 0.93], [0.99, 0.97, 0.92], [0.93, 0.76, 0.62], [0.90, 0.91, 0.90], [0.98, 0.93, 0.84]];
const GREY_TINTS = [[1.18, 1.10, 0.95], [1.10, 1.12, 1.14], [1.2, 1.03, 0.9], [0.9, 1.02, 1.12], [1.2, 1.17, 1.1]];
const STYLES = [
  { wall: 'w_plaster', tints: PLASTER_TINTS }, { wall: 'w_plaster', tints: PLASTER_TINTS }, { wall: 'w_plaster', tints: PLASTER_TINTS },
  { wall: 'w_plaster2', tints: GREY_TINTS }, { wall: 'w_plaster2', tints: GREY_TINTS },
  { wall: 'w_plaster', tints: PLASTER_TINTS }, { wall: 'w_plaster2', tints: GREY_TINTS }, { wall: 'w_white', tints: [[1, 0.98, 0.93], [0.98, 0.92, 0.80]], tile: 5.2 },
  { wall: 'w_peel', tints: [[1, 1, 1], [1.05, 0.95, 0.86]], tile: 3.6 }, { wall: 'w_blue', tints: [[1, 1, 1], [0.92, 0.97, 1.04]], tile: 3.4 },
  { wall: 'w_red', tints: [[1.05, 0.98, 0.92]], tile: 3.4 },
  { wall: 'w_damaged', tints: [[1, 0.98, 0.94]], tile: 4.6 }, { wall: 'w_broken', tints: [[1, 1, 1]], tile: 4.4 },
];
const SHUTTER_TINTS = [[0.35, 0.55, 0.50], [0.42, 0.52, 0.70], [0.75, 0.62, 0.45], [0.55, 0.36, 0.28], [0.85, 0.85, 0.80], [0.38, 0.46, 0.34]];
const METAL_TINTS = [[1, 1, 1], [0.75, 0.85, 0.95], [0.85, 0.95, 0.8], [1, 0.9, 0.75], [0.7, 0.72, 0.75]];

function frame(side, b) {
  switch (side) {
    case 'e': return { O: V(b.x1, 0, b.z1), T: V(0, 0, -1), N: V(1, 0, 0), L: b.z1 - b.z0 };
    case 'w': return { O: V(b.x0, 0, b.z0), T: V(0, 0, 1), N: V(-1, 0, 0), L: b.z1 - b.z0 };
    case 'n': return { O: V(b.x0, 0, b.z1), T: V(1, 0, 0), N: V(0, 0, 1), L: b.x1 - b.x0 };
    default: return { O: V(b.x1, 0, b.z0), T: V(-1, 0, 0), N: V(0, 0, -1), L: b.x1 - b.x0 };
  }
}

export function buildWorld(R, M) {
  const B = new Builder(), rnd = rng(20261114);
  const buildings = [];
  const anchors = [];      // hooks for dressing: { kind, p, N, T, w, bd }

  // ---------------------------------------------------------------------------------------------- facade --------
  function facade(bd, side) {
    const { O, T, N, L } = frame(side, bd);
    const H = bd.H, wall = bd.wall, wo = { color: bd.tint, tile: bd.tile, uo: bd.uo, vo: bd.vo };
    const P = (u, v, d = 0) => V(O.x + T.x * u - N.x * d, v, O.z + T.z * u - N.z * d);
    const Q = (key, u0, v0, u1, v1, d = 0, o = wo) => B.quad(key, P(u0, v0, d), P(u1, v0, d), P(u1, v1, d), P(u0, v1, d), o);
    const FB = (key, u0, v0, u1, v1, d0, d1, o = {}) => {
      const c = P((u0 + u1) / 2, (v0 + v1) / 2, (d0 + d1) / 2), du = u1 - u0, dd = Math.abs(d1 - d0), ax = Math.abs(T.x) > 0.5;
      B.box(key, c.x, c.y, c.z, ax ? du : dd, v1 - v0, ax ? dd : du, o);
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

    const m = 0.55, nb = Math.max(1, Math.round((L - 2 * m) / 3.3)), bw = (L - 2 * m) / nb;
    Q(wall, 0, 0, m, H); Q(wall, L - m, 0, L, H);
    const street = bd.street?.[side] || 'lane';
    const shops = (bd.shops || []).filter(s => s.side === side).map(s => s.bay);
    const frameKey = bd.frameIron ? 'iron' : 'planks', fo = { color: bd.frameTint, tile: 1.1 };
    const sh = { color: bd.shTint, uv: [0, 0, 1, 1] };
    let doors = 0;

    // window dressing ------------------------------------------------------------
    const windowAt = (u0, v0, u1, v1, type, d) => {
      const uc = (u0 + u1) / 2, hw = (u1 - u0) / 2;
      FB('concrete', u0 - 0.09, v0 - 0.075, u1 + 0.09, v0, -0.075, d * 0.6, { color: bd.trim });        // sill
      if (type === 'dark' || type === 'board') {
        Q('dark', u0, v0, u1, v1, d + 0.5, {});
        hole(u0, v0, u1, v1, d + 0.5, { color: [0.25, 0.24, 0.23], tile: bd.tile });
      } else {
        for (const [a, b, c, e] of [[u0, v0, u1, v0 + 0.055], [u0, v1 - 0.055, u1, v1], [u0, v0, u0 + 0.055, v1], [u1 - 0.055, v0, u1, v1], [uc - 0.025, v0, uc + 0.025, v1]])
          FB(frameKey, a, b, c, e, d - 0.05, d, fo);
        if (v1 - v0 > 1.6) FB(frameKey, u0, v0 + (v1 - v0) * 0.62, u1, v0 + (v1 - v0) * 0.62 + 0.045, d - 0.05, d, fo);
        Q('glass', u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, d - 0.012, { color: [1, 1, 1] });
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
        for (let u = u0 + 0.1; u < u1 - 0.04; u += 0.135) FB('iron', u, v0, u + 0.016, v1, 0.05, 0.066);
        FB('iron', u0, v0 + 0.22, u1, v0 + 0.245, 0.045, 0.07); FB('iron', u0, v1 - 0.245, u1, v1 - 0.22, 0.045, 0.07);
      }
      if (v0 > 4 && rnd.chance(0.2)) {          // AC unit on brackets with a run-off stain
        const p = P(uc + rnd.range(-0.1, 0.1), v0 - 1.12, -0.21);
        B.prop(rnd.chance(0.5) ? 'ac' : 'ac_rust', p.x, p.y, p.z, rotN, 0.9);
        Q('d_stain', uc - 0.45, v0 - 2.9, uc + 0.45, v0 - 1.05, -0.006, { uv: [0, 0, 1, 1], color: [0.8, 0.8, 0.8] });
      } else if (rnd.chance(0.3)) Q('d_stain', u0 - 0.1, v0 - 1.6 - rnd() * 0.8, u1 + 0.1, v0 - 0.08, -0.006, { uv: [0, 0, 1, 1] });
    };

    for (let f = 0; f < bd.floors; f++) {
      const v0 = f === 0 ? 0 : FLOOR0 + (f - 1) * FLOORN, v1 = f === 0 ? FLOOR0 : v0 + FLOORN;
      for (let i = 0; i < nb; i++) {
        const cu0 = m + i * bw, cu1 = cu0 + bw, uc = (cu0 + cu1) / 2;
        if (f === 0) {
          let kind = shops.includes(i) ? 'shop' : rnd.pick(['door', 'shutter', 'shutter', 'window', 'window', 'blank']);
          if (i === nb - 1 && !doors && kind !== 'shop') kind = 'door';
          if (street === 'none') kind = 'blank';
          if (kind === 'door') {
            doors++;
            const op = { u0: uc - 0.55, v0: 0, u1: uc + 0.55, v1: 2.32, d: 0.3 };
            cell(cu0, v0, cu1, v1, op);
            const metal = rnd.chance(0.35);
            Q(metal ? 'metal_green' : 'door', op.u0, 0, op.u1, op.v1, op.d, { uv: [0, 0, 1, 1], color: metal ? rnd.pick(METAL_TINTS) : bd.doorTint });
            FB(frameKey, op.u0, op.v1 - 0.07, op.u1, op.v1, op.d - 0.06, op.d, fo); FB(frameKey, op.u0, 0, op.u0 + 0.06, op.v1, op.d - 0.06, op.d, fo); FB(frameKey, op.u1 - 0.06, 0, op.u1, op.v1, op.d - 0.06, op.d, fo);
            FB('iron', op.u1 - 0.2, 1.02, op.u1 - 0.16, 1.14, op.d - 0.05, op.d);
            anchors.push({ kind: 'door', p: P(uc, 0, 0), N, T, w: 1.1, bd, street });
          } else if (kind === 'shutter') {
            const sw = Math.min(2.7, bw - 0.7), op = { u0: uc - sw / 2, v0: 0, u1: uc + sw / 2, v1: 2.72, d: 0.14 };
            cell(cu0, v0, cu1, v1, op);
            const key = rnd.pick(['shutter_metal', 'shutter_metal', 'corrugated']);
            Q(key, op.u0, 0, op.u1, op.v1, op.d, { tile: key === 'corrugated' ? 1.4 : 1.25, color: rnd.pick(METAL_TINTS), uo: rnd(), vo: rnd() });
            FB('iron', op.u0, 0, op.u0 + 0.04, op.v1, 0.02, op.d); FB('iron', op.u1 - 0.04, 0, op.u1, op.v1, 0.02, op.d);
            FB('metal_white', op.u0 - 0.04, op.v1 - 0.02, op.u1 + 0.04, op.v1 + 0.2, -0.03, op.d, { tile: 1.5, color: [0.8, 0.8, 0.8] });
            FB('iron', uc - 0.1, 0.02, uc + 0.1, 0.07, op.d - 0.05, op.d);
            anchors.push({ kind: 'shutter', p: P(uc, 0, 0), N, T, w: sw, bd, street });
          } else if (kind === 'shop') {
            const op = { u0: cu0 + 0.28, v0: 0, u1: cu1 - 0.28, v1: 2.8, d: 0.32 };
            cell(cu0, v0, cu1, v1, op);
            shopRoom(bd, { P, T, N, street }, cu0 + 0.1, cu1 - 0.1, op);
            FB('shutter_metal', op.u0, 2.56, op.u1, 2.8, 0.06, 0.3, { tile: 1.2, color: [0.8, 0.8, 0.8] });
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
            if (bd.balcSolid) {
              FB(wall, a, v0, b, v0 + 0.95, -dep, -dep + 0.11, wo); FB(wall, a, v0, a + 0.11, v0 + 0.95, -dep + 0.11, 0, wo); FB(wall, b - 0.11, v0, b, v0 + 0.95, -dep + 0.11, 0, wo);
            } else {
              for (const y of [v0 + 0.06, v0 + 0.98]) { FB('iron', a, y, b, y + 0.035, -dep, -dep + 0.035); FB('iron', a, y, a + 0.035, y + 0.035, -dep, 0); FB('iron', b - 0.035, y, b, y + 0.035, -dep, 0); }
              for (let u = a + 0.05; u < b - 0.02; u += 0.125) FB('iron', u, v0, u + 0.014, v0 + 1.0, -dep + 0.01, -dep + 0.024);
              for (let d = 0.12; d < dep - 0.05; d += 0.125) { FB('iron', a + 0.01, v0, a + 0.024, v0 + 1.0, -d - 0.014, -d); FB('iron', b - 0.024, v0, b - 0.01, v0 + 1.0, -d - 0.014, -d); }
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
      if (f > 0 && bd.ledge) FB('concrete', 0, v0 - 0.085, L, v0 + 0.085, -0.07, 0, { color: bd.trim });
    }
    if (bd.cornice) FB('concrete', 0, H + PARAPET - 0.2, L, H + PARAPET - 0.06, -0.09, 0, { color: bd.trim });
    // pipes, conduits, scars
    if (rnd.chance(0.65)) {
      const u = rnd.chance(0.5) ? 0.28 : L - 0.28, p = P(u, 0, -0.085), len = H + 0.3;
      B.geom(rnd.chance(0.5) ? 'metal_white' : 'iron', new THREE.CylinderGeometry(0.055, 0.055, len, 8), new THREE.Matrix4().makeTranslation(p.x, 0.25 + len / 2, p.z), { color: [0.75, 0.75, 0.75], uvScale: 1, uvScaleY: len });
      for (let y = 1; y < H; y += 2.1) FB('iron', u - 0.08, y, u + 0.08, y + 0.04, -0.15, 0);
    }
    if (rnd.chance(0.55)) { const y = FLOOR0 - rnd.range(0.12, 0.4), a = rnd.range(0.3, L * 0.4); FB('iron', a, y, L - rnd.range(0.2, L * 0.3), y + 0.028, -0.03, 0); FB('iron', a, y - rnd.range(0.8, 2), a + 0.028, y, -0.03, 0); }
    for (let k = 0; k < 1 + L / 9; k++) {
      if (!free.length) break;
      const r = rnd.pick(free), kind = rnd.pick(['d_patch', 'd_scars', 'd_stain', 'd_stain']);
      const lim = kind === 'd_scars' ? 0.75 : 2.2, s = Math.min(lim, Math.min(r[2] - r[0], r[3] - r[1]) * rnd.range(0.55, 0.95)), ca = (r[0] + r[2]) / 2 + rnd.range(-0.3, 0.3) * (r[2] - r[0] - s), cb = (r[1] + r[3]) / 2;
      if (s < 0.4) continue;
      const g = rnd.range(0.86, 1.08);
      Q(kind, ca - s / 2, cb - s / 2, ca + s / 2, cb + s / 2, -0.005 - k * 0.001, { uv: [0, 0, 1, 1], color: kind === 'd_patch' ? [bd.tint[0] * g, bd.tint[1] * g, bd.tint[2] * g] : [1, 1, 1] });
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
    B.quad('tiles', P(ra, y, D - 0.012), P(rb, y, D - 0.012), P(rb, 1.5, D - 0.012), P(ra, 1.5, D - 0.012), { tile: 1.1 });
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
    const a = P(ra, 0, 0), b = P(rb, 0, D);
    bd.carves.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) });
    anchors.push({ kind: 'room', P, ra, rb, D, y, h, N: fr.N, T: fr.T, bd });
  }

  // ---------------------------------------------------------------------------------------------- building ------
  function building(x0, x1, z0, z1, o = {}) {
    const st = o.style ?? rnd.pick(STYLES), floors = o.floors ?? rnd.pick([2, 2, 3, 3, 3]);
    const bd = {
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
    buildings.push(bd);
    for (const s of 'nsew') facade(bd, s);
    const H = bd.H, wo = { color: bd.tint, tile: bd.tile, uo: bd.uo, vo: bd.vo }, pt = 0.26, py = H + PARAPET / 2;
    B.quad('concrete', V(x0, H, z1), V(x1, H, z1), V(x1, H, z0), V(x0, H, z0), { tile: 3, color: [0.78, 0.76, 0.72] });
    const par = (cx, cz, sx, sz, side) => {
      const g = bd.parapetGap;
      if (g && g.side === side) {     // split around a gap (z-range) for roof access
        const zA = cz - sz / 2, zB = cz + sz / 2;
        for (const [a, b] of [[zA, g.a], [g.b, zB]]) { B.box(bd.wall, cx, py, (a + b) / 2, sx, PARAPET, b - a, wo); B.box('concrete', cx, H + PARAPET + 0.035, (a + b) / 2, sx + 0.08, 0.07, b - a + 0.04, { color: bd.trim }); if (bd.roofAccess) B.collide(cx, py, (a + b) / 2, sx, PARAPET, b - a); }
        return;
      }
      B.box(bd.wall, cx, py, cz, sx, PARAPET, sz, wo);
      B.box('concrete', cx, H + PARAPET + 0.035, cz, sx + 0.08, 0.07, sz + 0.08, { color: bd.trim });
      if (bd.roofAccess) B.collide(cx, py, cz, sx, PARAPET, sz);
    };
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
  row(31, 46, -80, 80, 'z', { sides: 'w', street: { w: 'market' }, min: 9, max: 15, each: k => ({ floors: rnd.pick([2, 3, 3, 4]), shops: k % 3 === 1 ? [{ side: 'w', bay: 1 }] : [] }) });
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
    B.box('concrete', 0, top + 0.16, z0 + depth / 2, halfW * 2 + 0.5, 0.32, depth + 0.5, st);
    B.box('concrete', 0, top + 0.42, z0 + depth / 2, halfW * 2 + 0.9, 0.2, depth + 0.9, st);
    B.box('concrete', 0, top - 1.3, z0 + depth / 2, halfW * 2 + 0.22, 0.2, depth + 0.22, st);
    for (const sx of [-1, 1]) {
      const cx = sx * (halfW + open) / 2, w = halfW - open;
      B.box('concrete', cx, 0.45, z0 + depth / 2, w + 0.3, 0.9, depth + 0.3, st);                // plinth
      B.box('concrete', cx, spring + 0.1, z0 + depth / 2, w + 0.2, 0.22, depth + 0.2, st);       // impost
      for (const zf of [z0 - 0.04, z0 + depth + 0.04]) {                                        // shallow framed panels
        B.box('concrete', cx, 2.25, zf, w - 1.0, 0.1, 0.08, st); B.box('concrete', cx, 1.25, zf, w - 1.0, 0.1, 0.08, st);
        B.box('concrete', cx - (w - 1.0) / 2, 1.75, zf, 0.1, 1.1, 0.08, st); B.box('concrete', cx + (w - 1.0) / 2, 1.75, zf, 0.1, 1.1, 0.08, st);
      }
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
  const ctx = { B, M, rnd, buildings, anchors, low };
  dress(ctx);

  // ---- ground: 1 m grid with blend weights (x = paving, y = sand, z = stain) -----------------------------------------
  {
    const X0 = -70, X1 = 70, Z0 = -104, Z1 = 104, nx = X1 - X0, nz = Z1 - Z0;
    const inside = (x, z) => { for (const b of buildings) if (x > b.x0 + 0.4 && x < b.x1 - 0.4 && z > b.z0 + 0.4 && z < b.z1 - 0.4 && !b.carves.length) return true; return false; };
    const distB = (x, z) => { let d = 9; for (const b of buildings) { const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1); const q = Math.hypot(dx, dz); if (q < d) d = q; } return d; };
    const nd = noise.image.data, nAt = (x, z, s, ch) => nd[(((Math.floor(z * s) % 256) + 256) % 256 * 256 + ((Math.floor(x * s) % 256) + 256) % 256) * 4 + ch] / 255;
    const wts = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = X0 + i, z = Z0 + j, o = (j * (nx + 1) + i) * 3;
      const inMap = Math.abs(x) < 31.5 && Math.abs(z) < 63.5;
      const road = inMap && (Math.abs(x) <= 4.2 || [-60, -20, 20, 60].some(c => Math.abs(z - c) <= 3.2));
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
    for (const a of anchors) if (a.kind === 'stain') {       // oil / soot patches left by vehicles and fires
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const d = Math.hypot(X0 + i - a.x, Z0 + j - a.z); if (d < a.r) wts[(j * (nx + 1) + i) * 3 + 2] = Math.max(wts[(j * (nx + 1) + i) * 3 + 2], (1 - d / a.r) * a.s); }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = X0 + i, z = Z0 + j;
      if (inside(x + 0.5, z + 0.5)) continue;
      const w = (ii, jj) => { const o = (jj * (nx + 1) + ii) * 3; return [wts[o], wts[o + 1], wts[o + 2]]; };
      B.quad('ground', V(x, 0, z + 1), V(x + 1, 0, z + 1), V(x + 1, 0, z), V(x, 0, z), { tile: 3.2, xs: [w(i, j + 1), w(i + 1, j + 1), w(i + 1, j), w(i, j)] });
    }
    const far = 900, edge = [[-far, Z1, far, far], [-far, -far, far, Z0], [-far, Z0, X0, Z1], [X1, Z0, far, Z1]];
    for (const [a, b, c, d] of edge) B.quad('ground', V(a, 0, d), V(c, 0, d), V(c, 0, b), V(a, 0, b), { tile: 3.2, x: [0.3, 1, 0], far: true });
  }

  // ---- finalize ------------------------------------------------------------------------------------------------------
  const meshes = B.build(M), rayMeshes = [];
  const group = new THREE.Group(); group.name = 'world';
  for (const m of meshes) {
    m.castShadow = !m.name.startsWith('d_') && !['ground', 'cable', 'dark', 'glass', 'matte'].includes(m.name) && !m.userData.noShadow; m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    if (m.name === 'frond' || m.name.startsWith('d_')) m.userData.noAO = true;
    if (m.name.startsWith('d_')) m.renderOrder = 2;
    if (!m.material.userData.noBVH && !m.userData.noBVH && !m.name.startsWith('d_')) { m.geometry.computeBoundsTree({ maxLeafTris: 8 }); rayMeshes.push(m); }
    group.add(m);
  }
  R.scene.add(group); R.setupTree(group);

  const nav = new NavGrid(B.colliders, -48, -82, 48, 82);
  const spawns = {
    0: [[-29, -60], [0, -60.5], [28.5, -60], [-14, -60], [14, -60], [-3, -52], [3, -55]].map(([x, z]) => ({ x, z, yaw: 0 })),
    1: [[-29, 60], [0, 60.5], [28.5, 60], [-14, 60], [14, 60], [-3, 52], [3, 55]].map(([x, z]) => ({ x, z, yaw: Math.PI })),
  };
  for (const sp of [...spawns[0], ...spawns[1]]) if (!nav.free(sp.x, sp.z)) nav.center(nav.nearestFree(sp.x, sp.z), sp);      // dressing may have parked something on a spawn point
  const tris = meshes.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0);
  console.info(`world: ${meshes.length} meshes, ${Math.round(tris / 1000)}k tris, ${B.colliders.length} colliders, ${buildings.length} buildings, ${B.dynamic.length} loose props`);
  const surfaceAt = (x, z) => {
    if (Math.abs(x) > 46 || Math.abs(z) > 80) return 'dirt';
    for (const b of buildings) if (b.carves.length && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return 'tile';
    return 'concrete';
  };
  return { group, colliders: B.colliders, rayMeshes, buildings, nav, spawns, anchors, surfaceAt, dynamic: B.dynamic, emitters: B.emitters };
}
