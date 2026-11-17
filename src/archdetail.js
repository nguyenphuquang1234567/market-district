// The architecture pass: the street floor and the shops, fitted out with modelled pieces (tools/blender/arch.py,
// assets/kit/arch.glb) where the district had a flat textured quad or nothing.
//   - a roll-up shutter is laths in guides under a housing, with a bottom bar, lifting handles and a padlocked hasp;
//     a corrugated one is a sheet gate on a tube frame with hinges and a slide bolt;
//   - a street-floor window has a projecting wrought-iron grille;
//   - a casona's base course is rusticated stone, block by block;
//   - a shop has its curtain rolled up under the lintel, a jack-arch ceiling (brick vaults between steel joists), a
//     tiled dado, a door to a back room, shelves of goods along the walls and a strip light;
//   - parapets have clay spouts.
//
// world.js leaves a note where each belongs (Builder.notes) and tags its own flat version 'far', so beyond the kit's
// near distance the map is drawn exactly as before. Here a second Builder places the pieces: it has no colliders, no
// loose props and no random stream, and its meshes go in a group of their own, so cover, routes, clutter and the
// light bake's signature cannot move. The meshes are batched like the district's (batch.js) and join the ray meshes,
// so a round sparks on the lath it hits and not on the flat quad behind it.
import * as THREE from 'three';
import { Builder } from './builder.js';
import { assets } from './assets.js';
import { hash } from './facades.js';
import { lodRange } from './world.js';
import { BATCH, batchWorld } from './batch.js';

const UP = new THREE.Vector3(0, 1, 0);
// painted steel, as shop curtains are: a few sober colours, chosen per shutter
const PAINT = [[0.62, 0.64, 0.62], [0.36, 0.46, 0.38], [0.56, 0.3, 0.22], [0.74, 0.7, 0.58], [0.42, 0.42, 0.44], [0.5, 0.44, 0.34]];
const TILES = [   // a shop's dado: [field, band and capping] (linear: cream and deep green, grey-green and oxide red, ochre and umber, white and mustard, sage and cream)
  [[0.72, 0.66, 0.48], [0.07, 0.19, 0.13]], [[0.55, 0.6, 0.5], [0.3, 0.07, 0.045]], [[0.6, 0.46, 0.22], [0.1, 0.065, 0.04]], [[0.78, 0.78, 0.72], [0.5, 0.32, 0.06]], [[0.4, 0.5, 0.4], [0.72, 0.68, 0.52]],
];
// what casts a shadow: the hall's columns and the roof spouts. The rest is fine ironwork and fittings flush with a wall
// or inside a room: their shadows are not missed, and thousands of small triangles in every cascade are
const CAST = new Set(['cantera', 'teja', 'metal_green']);
const INSIDE = new Set(['glossy', 'matte', 'brick', 'planks', 'door']);

export function addArchDetail(R, M, world) {
  const notes = world.notes || [];
  if (!assets.kit?.cortina_slats || !notes.length) return null;
  const A = new Builder(), stats = { cortina: 0, gate: 0, reja: 0, zocalo: 0, tienda: 0, sala: 0, shelves: 0, spouts: 0 };
  // a piece's placement on a wall: local X along the wall (T), Y up, Z out of it (N), from the point p moved u along
  // the wall, v up and d into it. turn: half round about the vertical (a channel's other hand).
  const tx = new THREE.Vector3(), tz = new THREE.Vector3(), tp = new THREE.Vector3();
  const KM = (p, T, N, u, v, d, sx = 1, sy = 1, sz = 1, turn = false) => {
    const k = turn ? -1 : 1;
    return new THREE.Matrix4().makeBasis(tx.copy(T).multiplyScalar(sx * k), tp.copy(UP).multiplyScalar(sy), tz.copy(N).multiplyScalar(sz * k))
      .setPosition(p.x + T.x * u - N.x * d, p.y + v, p.z + T.z * u - N.z * d);
  };
  const near = { lod: 'near2' };

  // rays against what is already drawn, to keep fittings off whatever stands at a wall (shelving, crates)
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true; const hits = [], O = new THREE.Vector3(), Dv = new THREE.Vector3();
  const idx = new Map(), bb = new THREE.Box3(), GS = 12;
  for (const m of world.rayMeshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.copy(m.geometry.boundingBox); if (bb.max.x - bb.min.x > 400) continue;
    for (let cx = Math.floor((bb.min.x - 1) / GS); cx <= Math.floor((bb.max.x + 1) / GS); cx++) for (let cz = Math.floor((bb.min.z - 1) / GS); cz <= Math.floor((bb.max.z + 1) / GS); cz++) { const k = cx * 1000 + cz; let l = idx.get(k); if (!l) idx.set(k, l = []); l.push(m); }
  }
  const cast = (o, d, far) => { const l = idx.get(Math.floor(o.x / GS) * 1000 + Math.floor(o.z / GS)); if (!l) return Infinity; rc.set(O.copy(o), Dv.copy(d).normalize()); rc.far = far; hits.length = 0; rc.intersectObjects(l, false, hits); let b = Infinity; for (const h of hits) if (h.distance < b) b = h.distance; return b; };

  for (const n of notes) {
    const { p, T, N } = n;
    // everything belonging to one note goes into one fine cell, the one world.js put its flat version in
    { const q = n.kind === 'sala' ? n.P((n.ra + n.rb) / 2, 0, (n.d0 + n.D) / 2) : n.kind === 'columna' || n.kind === 'armadura' ? { x: n.x, z: n.z || 0 } : p; A.pin2 = A.cell2(q.x, q.z); }
    if (n.kind === 'cortina') {
      const { w, h, d, key, so } = n, dS = d - 0.022, tint = so.color;
      if (key === 'corrugated') {                                                    // ---- a sheet gate: two leaves of corrugated sheet on a tube frame
        const k = Math.max(2, Math.round(w / 0.5)), pw = (w - 0.06) / k, sheet = { ...so, lod: 'near2' };
        for (let i = 0; i < k; i++) A.kit('lamina_sheet', KM(p, T, N, -w / 2 + 0.03 + pw * (i + 0.5), 0.03, dS, pw / 0.5, h - 0.05, 1), { steel: key }, sheet);
        const fr = { lod: 'near2', color: [0.9, 0.9, 0.9] }, df = dS - 0.03;
        for (const u of [-w / 2 + 0.02, -0.021, 0.021, w / 2 - 0.02]) A.kit('perfil_z', KM(p, T, N, u, 0.02, df, 1, h - 0.04, 1), { iron: 'iron' }, fr);
        for (const v of [0.04, h * 0.5, h - 0.04]) for (const sx of [-1, 1]) A.kit('perfil_x', KM(p, T, N, sx * w / 4, v, df, w / 2 - 0.08, 1, 1), { iron: 'iron' }, fr);
        for (const v of [0.32, h * 0.5 + 0.2, h - 0.32]) {
          A.kit('bisagra', KM(p, T, N, -w / 2 + 0.002, v, df - 0.012), { iron: 'iron' }, near);
          // (the other jamb's: turned half round about the wall's normal, which keeps its barrel on the street side)
          A.kit('bisagra', new THREE.Matrix4().makeBasis(tx.copy(T).negate(), tp.copy(UP).negate(), N).setPosition(p.x + T.x * (w / 2 - 0.002) - N.x * (df - 0.012), v, p.z + T.z * (w / 2 - 0.002) - N.z * (df - 0.012)), { iron: 'iron' }, near);
        }
        A.kit('pasador', KM(p, T, N, 0.02, 1.08, df - 0.012), { iron: 'iron' }, near);
        A.kit('cortina_lock', KM(p, T, N, 0.14, 0.94, df - 0.012), { iron: 'iron', brass: 'glossy', steel: 'metal_white' }, { lod: 'near2', slot: { brass: { color: [0.62, 0.48, 0.2], lod: 'near2' } } });
        stats.gate++; continue;
      }
      // ---- a roll-up curtain: strips of eight laths stacked to the lintel, in two guides, under its housing
      const slat = { ...so, lod: 'near2' }, strips = Math.ceil((h + 0.06) / 0.6);
      for (let i = 0; i < strips; i++) A.kit('cortina_slats', KM(p, T, N, 0, 0.07 + i * 0.6, dS, w - 0.05, 1, 1), { steel: key }, slat);
      const iron = { lod: 'near2', color: [1, 1, 1] };
      A.kit('cortina_guide', KM(p, T, N, -w / 2, 0, dS, 1, h, 1), { iron: 'iron' }, iron); A.kit('cortina_guide', KM(p, T, N, w / 2, 0, dS, 1, h, 1, true), { iron: 'iron' }, iron);
      A.kit('cortina_bar', KM(p, T, N, 0, 0, dS, w - 0.09, 1, 1), { iron: 'iron', rubber: 'dark' }, iron);
      A.kit('cortina_box', KM(p, T, N, 0, h - 0.035, 0, w + 0.18, 1, 1), { steel: 'metal_white' }, { lod: 'near2', tile: 1.5, color: [0.8, 0.8, 0.8] });
      for (const sx of [-1, 1]) A.kit('cortina_cap', KM(p, T, N, sx * (w / 2 + 0.09), h - 0.035, 0), { iron: 'iron' }, near);
      for (const sx of [-1, 1]) A.kit('cortina_handle', KM(p, T, N, sx * w * 0.27, 0.42, dS), { iron: 'iron' }, near);
      const locks = hash(p.x, p.z, 301) < 0.45 ? [0] : [-w * 0.36, w * 0.36];
      for (const u of locks) A.kit('cortina_lock', KM(p, T, N, u, 0.08, dS), { iron: 'iron', brass: 'glossy', steel: 'metal_white' }, { lod: 'near2', slot: { brass: { color: [0.62, 0.48, 0.2], lod: 'near2' } } });
      stats.cortina++;
    } else if (n.kind === 'puerta') {
      A.kit('puerta_metal', KM(p, T, N, 0, 0, n.d - 0.012, n.w / 1.1, n.h / 2.32, 1), { steel: 'metal_green', iron: 'iron', brass: 'glossy', rubber: 'dark' }, { lod: 'near2', slot: { steel: { color: n.tint, tile: 1.6, lod: 'near2' }, iron: { lod: 'near2' }, brass: { color: [0.62, 0.48, 0.2], lod: 'near2' }, rubber: { lod: 'near2' } } });
      stats.puerta = (stats.puerta || 0) + 1;
    } else if (n.kind === 'columna') {
      // ---- a cast-iron column of the market hall: pedestal, fluted shaft to fit, capital under the beams, and a bracket
      // to each thing it carries (the truss's tie towards the nave, the beams along the hall; on a nave column the
      // aisle's rafter and beam part-way up as well)
      const { x, z, h } = n, top = h - 0.11, s = Math.sign(z), ir = { iron: 'metal_green' }, io = { lod: 'near2', color: n.tint, tile: 1.2 };
      const col = new THREE.Matrix4();
      A.kit('col_base', col.makeTranslation(x, 0, z), ir, io);
      A.kit('col_shaft', new THREE.Matrix4().makeScale(1, top - 0.5 - 0.9, 1).setPosition(x, 0.9, z), ir, io);
      A.kit('col_cap', new THREE.Matrix4().makeTranslation(x, top, z), ir, io);
      const X = new THREE.Vector3(1, 0, 0), Zv = new THREE.Vector3(0, 0, 1);
      const br = (y, dir, nrm) => A.kit('col_bracket', new THREE.Matrix4().makeBasis(dir, UP, nrm).setPosition(x, y, z), ir, io);
      const inw = new THREE.Vector3(0, 0, -s), outw = new THREE.Vector3(0, 0, s), nX = new THREE.Vector3(-1, 0, 0), nZ = new THREE.Vector3(0, 0, -1);
      br(top - 0.06, inw, s > 0 ? X : nX);                                           // (the basis is kept right-handed: X x Y = Z)
      if (n.nave) { br(top - 0.02, X, Zv); br(top - 0.02, nX, nZ); br(n.AISLE - 0.2, outw, s > 0 ? nX : X); br(n.AISLE - 0.13, X, Zv); br(n.AISLE - 0.13, nX, nZ); }
      stats.columns = (stats.columns || 0) + 1;
    } else if (n.kind === 'armadura') {
      // ---- gusset plates where a truss's members meet, in the truss's own plane
      const { x, NAVE, RIDGE, NZ } = n, pl = (y, z, sc = 1) => A.kit('cartela', new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, sc), UP.clone().multiplyScalar(sc), new THREE.Vector3(-1, 0, 0)).setPosition(x, y, z), { iron: 'metal_green' }, { lod: 'near2', color: n.tint, tile: 1.2 });
      pl(RIDGE - 0.2, 0, 1.15); pl(NAVE + 0.02, 0); for (const sg of [-1, 1]) { pl(NAVE + 0.02, sg * NZ / 2, 0.85); pl(NAVE + (RIDGE - NAVE) / 2 - 0.1, sg * NZ / 2, 0.85); }
    } else if (n.kind === 'marquesina') {
      // ---- under a concrete canopy: tapered ribs from the wall to the edge, and a bulkhead light between each pair
      const { w, dep, conc } = n, k = Math.max(2, Math.round(w / 2.3) + 1), co = { lod: 'near2', color: conc?.color || [0.9, 0.9, 0.88], tile: conc?.tile || 2 };
      for (let i = 0; i < k; i++) {
        const u = -w / 2 + 0.18 + (w - 0.36) * i / (k - 1);
        A.kit('marq_rib', KM(p, T, N, u, 0, 0, 1, 1, (dep - 0.03) / 1.3), { trim: 'concrete' }, co);
        if (i < k - 1) A.kit('plafon', KM(p, T, N, u + (w - 0.36) / (k - 1) / 2, 0, -dep * 0.55), { iron: 'iron', bulb: 'glossy' }, { lod: 'near2', slot: { iron: { lod: 'near2' }, bulb: { color: [0.82, 0.8, 0.72], lod: 'near2' } } });
      }
      stats.canopies = (stats.canopies || 0) + 1;
    } else if (n.kind === 'toldo') {
      // ---- an awning's frame over the thin rods the district drew: the roller in its hood on the wall, a front bar,
      // an arm and a stay each side in steel tube, a bolted bracket where each meets the wall
      const { w, out } = n, st = { lod: 'near2', color: [0.62, 0.64, 0.62], tile: 1.4 }, ms = { steel: 'metal_white', iron: 'iron' };
      const at = (u, y, d) => new THREE.Vector3(p.x + T.x * u + N.x * d, y, p.z + T.z * u + N.z * d);
      const span = (a, b) => {                                                       // a tube from a to b
        const dir = new THREE.Vector3().subVectors(b, a), len = dir.length(), x = dir.clone().normalize(), z = new THREE.Vector3().crossVectors(x, UP).normalize(), y = new THREE.Vector3().crossVectors(z, x);
        A.kit('tubo_x', new THREE.Matrix4().makeBasis(x.multiplyScalar(len), y, z).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), ms, st);
      };
      A.kit('toldo_cassette', KM(p, T, N, 0, 3.15, 0, w, 1, 1), ms, st);
      span(at(-w / 2 + 0.03, 2.5, out + 0.03), at(w / 2 - 0.03, 2.5, out + 0.03));
      for (const u of [-w / 2 + 0.05, w / 2 - 0.05]) {
        span(at(u, 3.1, 0.06), at(u, 2.5, out + 0.03)); span(at(u, 2.35, 0.05), at(u, 2.5, out + 0.03));
        A.kit('toldo_soporte', KM(p, T, N, u, 3.1, 0), ms, near); A.kit('toldo_soporte', KM(p, T, N, u, 2.35, 0), ms, near);
      }
      stats.awnings = (stats.awnings || 0) + 1;
    } else if (n.kind === 'reja') {
      A.kit('reja_calle', KM(p, T, N, 0, 0, 0, n.w / 1.2, n.h / 1.25, 1), { iron: 'iron' }, near); stats.reja++;
    } else if (n.kind === 'zocalo') {
      const k = Math.max(1, Math.round(n.w / 1.0)), pw = n.w / k;
      // (plain stone, tinted to the cantera's colour: the cantera texture is itself a wall of blocks, and its painted joints over the modelled ones read as blocks within blocks)
      for (let i = 0; i < k; i++) A.kit('zocalo', KM(p, T, N, -n.w / 2 + pw * (i + 0.5), 0, 0, pw, 0.92 / 0.9, 1), { trim: 'concrete' }, { lod: 'near2', tile: 1.7, color: [1.0, 0.84, 0.76] });
      stats.zocalo++;
    } else if (n.kind === 'tienda') {
      // ---- an open shop: the curtain rolled up under the lintel, its guides down the jambs
      const { w, h, d } = n, dR = 0.18;
      A.kit('cortina_roll', KM(p, T, N, 0, h - 0.125, dR, w - 0.02, 1, 1), { steel: 'shutter_metal', iron: 'iron' }, { lod: 'near2', tile: 1.2, color: [0.8, 0.8, 0.8], slot: { iron: { lod: 'near2' } } });
      A.kit('cortina_guide', KM(p, T, N, -w / 2, 0, dR - 0.122, 1, h, 1), { iron: 'iron' }, near); A.kit('cortina_guide', KM(p, T, N, w / 2, 0, dR - 0.122, 1, h, 1, true), { iron: 'iron' }, near);
      stats.tienda++;
    } else if (n.kind === 'sala') {
      // ---- a shop's room. P(u, v, d): along the front wall, up, into the building
      const { P, ra, rb, D, y, h, d0 } = n, W = rb - ra, len = D - d0, mid = P((ra + rb) / 2, 0, (d0 + D) / 2), hs = k => hash(mid.x, mid.z, k);
      const p0 = P(0, 0, 0), inN = new THREE.Vector3().copy(N).negate(), negT = new THREE.Vector3().copy(T).negate();
      // the ceiling: bays of vault from joist to joist, the joists spanning the room's width
      const bays = Math.max(2, Math.round(len / 0.8)), pitch = len / bays, steel = hs(311) < 0.5 ? [0.5, 0.24, 0.18] : [0.34, 0.42, 0.36];
      for (let i = 0; i < bays; i++) A.kit('boveda', KM(p0, T, N, (ra + rb) / 2, h + 0.002, d0 + pitch * (i + 0.5), W, 1, pitch / 0.8), { brick: 'brick', iron: 'metal_white' }, { lod: 'near2', slot: { brick: { color: [1.0, 0.94, 0.86], tile: 1.1, lod: 'near2' }, iron: { color: steel, tile: 1.5, lod: 'near2' } } });
      // the dado: both side walls and the back wall
      const tl = TILES[Math.floor(hs(312) * TILES.length)], dslots = { tile: 'glossy', accent: 'glossy', grout: 'matte', cap: 'glossy' };
      const dopt = { lod: 'near2', slot: { tile: { color: tl[0], lod: 'near2' }, accent: { color: tl[1], lod: 'near2' }, cap: { color: tl[1], lod: 'near2' }, grout: { color: [0.5, 0.48, 0.44], lod: 'near2' } } };
      const run = (base, X, Z, length) => { const k = Math.max(1, Math.round(length)), pw = length / k; for (let i = 0; i < k; i++) A.kit('dado', new THREE.Matrix4().makeBasis(tx.copy(X).multiplyScalar(pw), UP, Z).setPosition(base.x + X.x * pw * (i + 0.5), y, base.z + X.z * pw * (i + 0.5)), dslots, dopt); };
      run(P(ra, 0, D - 0.014), T, N, W);                                           // back wall, facing the street
      run(P(ra + 0.002, 0, d0), inN, T, len);                                      // the wall at ra, facing along T
      run(P(rb - 0.002, 0, D), N, negT, len);                                      // the wall at rb
      // the back-room door, where the back wall is clear from the middle of the room
      const eye = P((ra + rb) / 2, y + 1.0, (d0 + D) / 2), doorAt = [0.5, 0.26, 0.74].map(f => ra + 0.62 + (W - 1.24) * f).find(u => { const c = P(u, y + 1.0, D - 0.02), dir = new THREE.Vector3().subVectors(c, eye); return cast(eye, dir, dir.length() + 0.5) > dir.length() - 0.08; });
      const wood = [0.62 + 0.3 * hs(313), 0.5 + 0.22 * hs(314), 0.38 + 0.16 * hs(315)];
      if (doorAt !== undefined) A.kit('puerta_fondo', KM(p0, T, N, doorAt, y, D - 0.02, 1, 1, 0.7), { wood: 'door', iron: 'iron', brass: 'glossy', trim: 'cantera' }, { lod: 'near2', slot: { wood: { color: wood, tile: 2.4, lod: 'near2' }, brass: { color: [0.62, 0.48, 0.2], lod: 'near2' }, iron: { lod: 'near2' }, trim: { lod: 'near2', tile: 2 } } });
      // shelves along the side walls, above head height, wherever the wall is clear at that height
      const sopt = { lod: 'near2', slot: { wood: { color: [0.8, 0.72, 0.6], tile: 1.2, lod: 'near2' }, iron: { lod: 'near2' }, goods: { color: [1, 1, 1], lod: 'near2' } } }, sslots = { wood: 'planks', iron: 'iron', goods: 'glossy' };
      for (const [u, X, Z, wallN] of [[ra, inN, T, T], [rb, N, negT, negT]]) for (let i = 0; i < Math.floor((len - 0.6) / 1.12); i++) {
        const dd = d0 + 0.75 + i * 1.12, c = P(u, y + 1.98, dd), from = new THREE.Vector3(c.x + wallN.x * (W / 2 - 0.1), c.y, c.z + wallN.z * (W / 2 - 0.1)), dir = new THREE.Vector3().subVectors(c, from);
        if (cast(from, dir, dir.length() + 0.3) < dir.length() - 0.3) continue;      // something tall stands there
        for (const [v, k] of [[1.96, 0], [2.36, 1]]) {
          if (k === 1 && hash(c.x, c.z, 316) < 0.62) continue;
          A.kit(hash(c.x, c.z, 317 + k) < 0.5 ? 'repisa_a' : 'repisa_b', new THREE.Matrix4().makeBasis(X, UP, Z).setPosition(c.x + Z.x * 0.004, y + v, c.z + Z.z * 0.004), sslots, sopt); stats.shelves++;
        }
      }
      // a strip light under the joists, towards the front
      A.kit('lampara_tubo', KM(p0, T, N, (ra + rb) / 2, h - 0.138, d0 + len * 0.28), { steel: 'metal_white', bulb: 'bulb', iron: 'iron' }, { lod: 'near2', slot: { steel: { color: [0.86, 0.86, 0.84], tile: 1.5, lod: 'near2' }, bulb: { lod: 'near2' }, iron: { lod: 'near2' } } });
      stats.sala++;
    }
  }

  A.pin2 = null;
  // ---- clay spouts through the parapets of every street front (not under a tiled eave, which sheds its own water)
  for (const b of world.buildings) {
    if (b.ghost || !b.H || !b.sides || b.kit?.tejaroz) continue;
    for (const side of b.sides) {
      const st = b.street?.[side]; if (!st || st === 'none') continue;
      const F = side === 'e' ? { o: new THREE.Vector3(b.x1, 0, b.z1), T: new THREE.Vector3(0, 0, -1), N: new THREE.Vector3(1, 0, 0), L: b.z1 - b.z0 }
        : side === 'w' ? { o: new THREE.Vector3(b.x0, 0, b.z0), T: new THREE.Vector3(0, 0, 1), N: new THREE.Vector3(-1, 0, 0), L: b.z1 - b.z0 }
        : side === 'n' ? { o: new THREE.Vector3(b.x0, 0, b.z1), T: new THREE.Vector3(1, 0, 0), N: new THREE.Vector3(0, 0, 1), L: b.x1 - b.x0 }
        : { o: new THREE.Vector3(b.x1, 0, b.z0), T: new THREE.Vector3(-1, 0, 0), N: new THREE.Vector3(0, 0, -1), L: b.x1 - b.x0 };
      const k = Math.max(1, Math.round(F.L / 4.6));
      for (let i = 0; i < k; i++) {
        const u = F.L * (i + 0.5) / k + (hash(F.o.x + i, F.o.z, 320) - 0.5) * 1.2;
        A.kit('gargola', KM(F.o, F.T, F.N, u, b.H + 0.05, 0), { clay: 'teja', trim: 'cantera' }, { slot: { clay: { color: [1.0, 0.64, 0.46], tile: 1.2 }, trim: { tile: 2 } } }); stats.spouts++;
      }
    }
  }

  // ---- the meshes: culled, lit and hit like the district's own; drawn in batches
  const meshes = A.build(M), group = new THREE.Group(); group.name = 'world';        // (named as the district's, so the renderer's zone culling takes these cells too)
  for (const m of meshes) {
    m.castShadow = CAST.has(m.name); m.receiveShadow = true; m.matrixAutoUpdate = false;
    // nothing here is worth drawing from far off, and what is inside a shop (tiles, goods, vault, shelves, the back door)
    // only from close by: through the opening from across the street, not from the far end of it
    m.userData.lod = INSIDE.has(m.name) ? 24 : lodRange(m) || 80;
    if (!m.material.userData.noBVH) { m.geometry.computeBoundsTree({ maxLeafTris: 8 }); world.rayMeshes.push(m); }
    group.add(m);
  }
  R.setupTree(group);
  if (BATCH) { const d = batchWorld(meshes); d.group.name = 'archDraw'; R.scene.add(d.group); (R.detached ||= []).push(...meshes); } else R.scene.add(group);
  const tris = meshes.reduce((s, m) => s + m.geometry.index.count / 3, 0);
  console.info(`architecture pass: ${stats.cortina} curtains, ${stats.gate} sheet gates, ${stats.reja} grilles, ${stats.zocalo} base courses, ${stats.tienda} shop fronts, ${stats.sala} rooms (${stats.shelves} shelves), ${stats.spouts} spouts; ${meshes.length} cell meshes, ${Math.round(tris / 1000)}k triangles`);
  return { group, stats, meshes, tris };
}
