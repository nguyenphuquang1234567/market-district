// Street dressing: cover, market stalls, cloth, cables, rooftop clutter, plants, litter. Everything is seeded.
import * as THREE from 'three';
import { FLOOR0, PARAPET, SIDEWALK } from './world.js';
import { tarpV, papelUV, PAPEL_COLOURS, SIGNS, signUV } from './mexico.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const I = new THREE.Matrix4();
const UP = V(0, 1, 0);
const FADED = [[0.92, 0.9, 0.84], [0.85, 0.72, 0.5], [0.55, 0.68, 0.78], [0.78, 0.45, 0.36], [0.62, 0.7, 0.55], [0.9, 0.85, 0.7], [0.5, 0.55, 0.62], [0.88, 0.78, 0.74]];
const SPICE = [[0.86, 0.6, 0.1], [0.62, 0.16, 0.08], [0.52, 0.38, 0.2], [0.82, 0.46, 0.2], [0.9, 0.87, 0.78], [0.45, 0.5, 0.25], [0.3, 0.2, 0.14]];

// Dressing helpers bound to one Builder and one random stream: the old district and the new quarter each make their own
// kit, so dressing one never reshuffles the other.
export function dressKit({ B, M, rnd, buildings, anchors, low, rs = null }) {
  // A cloth already picked from the dressing stream (so the draws stay the same) becomes a striped plastic market tarp
  // when the style stream says so. Returns { key, color, o } for sheet().
  const tarpify = (key, color, o) => {
    if (!rs || rs() > 0.62) return { key, color, o };
    const band = rs.int(0, 3), [vo, vs] = tarpV(band), k = rs.range(0.85, 1.08);
    return { key: 'cloth_tarp', color: [k, k, k], o: { ...o, us: o.us * 0.9, vs: vs * Math.min(1, o.vs || 1), vo } };
  };
  const mat4 = (p, rotY = 0, s = 1, rx = 0, rz = 0) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, rotY, rz, 'YXZ')), typeof s === 'number' ? V(s, s, s) : s);

  // cylinder between two points
  const rod = (a, b, r, key = 'iron', color) => {
    const d = b.clone().sub(a), len = d.length();
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), V(1, 1, 1));
    B.geom(key, new THREE.CylinderGeometry(r, r, len, 6), m, { color, uvScaleY: len });
  };
  const cable = (a, b, sag, r = 0.012) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
    B.geom('cable', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, r, 4, false), I);
    return pts;
  };
  // deformable cloth sheet: fn(s,t) -> { p, w } where w is how freely the vertex moves in the wind
  const sheet = (key, nu, nv, fn, o = {}) => {
    const g = new THREE.PlaneGeometry(1, 1, nu, nv), pos = g.attributes.position, uv = g.attributes.uv, wind = [];
    let zs = 0;
    for (let i = 0; i < pos.count; i++) {
      const s = uv.getX(i), t = 1 - uv.getY(i), r = fn(s, t);
      pos.setXYZ(i, r.p.x, r.p.y, r.p.z); wind.push(r.w); zs += r.p.z;
      uv.setXY(i, s * (o.us || 1) + (o.uo || 0), t * (o.vs || 1) + (o.vo || 0));
    }
    g.computeVertexNormals();
    const ph = rnd() * 6.28;
    B.geom(key, g, I, { color: o.color, xf: i => [wind[i], ph, 0] });
  };

  const bagG = (() => {
    const g = new THREE.SphereGeometry(1, 12, 8), p = g.attributes.position, f = v => Math.sign(v) * Math.pow(Math.abs(v), 0.55);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, f(p.getX(i)) * 0.31, f(p.getY(i)) * 0.105, f(p.getZ(i)) * 0.165);
    g.computeVertexNormals(); return g;
  })();
  function sandbags(cx, cz, len, rows, rot = 0, y0 = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), n = Math.max(1, Math.floor(len / 0.57));
    for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
      const l = (i - (n - 1 - (r % 2)) / 2) * 0.575 + rnd.range(-0.02, 0.02), d = rnd.range(-0.025, 0.025), g = rnd.range(0.82, 1.0);
      B.geom('burlap', bagG, mat4(V(cx + l * c + d * s, y0 + 0.1 + r * 0.183, cz - l * s + d * c), rot + rnd.range(-0.09, 0.09), V(rnd.range(0.94, 1.05), rnd.range(0.92, 1.06), 1), 0, rnd.range(-0.05, 0.05)),
        { uvScale: 2.2, color: [g, g * 0.97, g * 0.9] });
    }
    B.collide(cx, y0 + rows * 0.092, cz, len, rows * 0.184, 0.38, rot, 'fabric');
  }

  function rubble(x, z, r, h) {
    const g = new THREE.SphereGeometry(1, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i), b = p.getY(i), c = p.getZ(i), k = 0.82 + 0.22 * Math.sin(a * 9.1 + c * 7.3) * Math.cos(c * 11.7 - a * 5.9) + 0.1 * Math.sin(a * 23 + c * 19);
      p.setXYZ(i, a * k, b * (0.7 + 0.5 * Math.abs(Math.sin(a * 5 + c * 4))), c * k);
    }
    g.computeVertexNormals();
    const yaw = rnd() * 6.28, kz = rnd.range(0.7, 1);
    B.geom('rubble', g, mat4(V(x, -0.03, z), yaw, V(r, h, r * kz)), { uvScale: r * 0.9, color: [0.62, 0.57, 0.5] });
    // a stepped core for clutter to fetch up against, and the whole skirt kept clear when dressing
    B.detail(x, h * 0.25, z, r * 1.5, h * 0.5, r * kz * 1.5, yaw, 'concrete'); B.detail(x, h * 0.45, z, r * 0.9, h * 0.9, r * kz * 0.9, yaw, 'concrete');
    B.keepOut(x, h * 0.5, z, r * 2.5, h + 0.2, r * kz * 2.5, yaw);
    for (let i = 0; i < 7 + r * 5; i++) {
      const a = rnd() * 6.28, d = r * Math.sqrt(rnd()) * 1.25, s = rnd.range(0.1, 0.42), hh = Math.max(0, h * (1 - d / r)) * 0.8;
      B.geom(rnd.pick(['concrete', 'w_brick', 'w_damaged', 'dirty']), new THREE.BoxGeometry(s * rnd.range(0.8, 1.8), s * rnd.range(0.4, 0.9), s),
        mat4(V(x + Math.cos(a) * d, hh + s * 0.2, z + Math.sin(a) * d), rnd() * 6.28, 1, rnd.range(-0.6, 0.6), rnd.range(-0.6, 0.6)), { uvScale: 0.35, color: [0.9, 0.88, 0.84] });
    }
    anchors.push({ kind: 'stain', x, z, r: r * 2.2, s: 0.35 });
  }

  function pallet(x, y, z, rot) {
    const c = Math.cos(rot), s = Math.sin(rot), o = { rot, tile: 0.9, color: [0.82, 0.78, 0.72] };
    for (let i = -2; i <= 2; i++) B.box('planks', x + i * 0.25 * s, y + 0.125, z + i * 0.25 * c, 1.2, 0.022, 0.1, o);
    for (let i = -1; i <= 1; i++) B.box('planks', x + i * 0.52 * c, y + 0.057, z - i * 0.52 * s, 0.1, 0.1, 1.0, o);
  }

  function tray(p, rot, fruit, n = 12) {
    B.box('planks', p.x, p.y + 0.035, p.z, 0.6, 0.07, 0.42, { rot, tile: 0.7 });
    const c = Math.cos(rot), s = Math.sin(rot), size = { apple: 0.075, lemon: 0.07, lime: 0.062, pomegranate: 0.095, onion: 0.075, sweet_potato: 0.09 }[fruit];
    const cols = Math.floor(0.54 / size), rws = Math.floor(0.36 / size);
    let k = 0;
    for (let layer = 0; layer < 2 && k < n; layer++) for (let j = 0; j < rws - layer && k < n; j++) for (let i = 0; i < cols - layer && k < n; i++) {
      if (layer && rnd.chance(0.45)) continue;
      const lx = (i - (cols - 1 - layer) / 2) * size + rnd.range(-0.008, 0.008), lz = (j - (rws - 1 - layer) / 2) * size + rnd.range(-0.008, 0.008);
      B.prop(fruit, p.x + lx * c + lz * s, p.y + 0.07 + layer * size * 0.78 + (fruit === 'sweet_potato' || fruit === 'lemon' ? 0.03 : 0), p.z - lx * s + lz * c, rnd() * 6.28, rnd.range(0.92, 1.12), fruit === 'sweet_potato' || fruit === 'lemon' ? [Math.PI / 2, rnd.range(-0.4, 0.4)] : [rnd.range(-0.5, 0.5), rnd.range(-0.5, 0.5)]);
      k++;
    }
  }

  function sack(x, y, z, col) {
    const pr = [[0, 0], [0.2, 0], [0.265, 0.1], [0.275, 0.26], [0.25, 0.42], [0.265, 0.47], [0.24, 0.5], [0.2, 0.46]].map(([a, b]) => new THREE.Vector2(a, b));
    const s = rnd.range(0.85, 1.15);
    B.geom('burlap', new THREE.LatheGeometry(pr, 12), mat4(V(x, y, z), rnd() * 6.28, V(s, s * rnd.range(0.85, 1.1), s)), { uvScale: 3 });
    const top = new THREE.CircleGeometry(0.215 * s, 12); top.rotateX(-Math.PI / 2);
    B.geom('matte', top, mat4(V(x, y + 0.455 * s * 0.92, z)), { color: col });
    B.detail(x, y + 0.23 * s, z, 0.48 * s, 0.46 * s, 0.48 * s, 0, 'fabric');
  }

  // Market stall: timber frame, counter, cloth roof with a loose valance, and goods.
  function stall(x, z, rot, o = {}) {
    const c = Math.cos(rot), s = Math.sin(rot), W = o.w || 2.5, D = 1.5, Hf = 2.2, Hb = 2.55, y0 = o.y || 0;
    const L = (lx, ly, lz) => V(x + lx * c + lz * s, y0 + ly, z - lx * s + lz * c);
    const wood = { rot, tile: 1.0, color: rnd.pick([[0.85, 0.8, 0.72], [0.7, 0.66, 0.6], [0.95, 0.9, 0.8]]) };
    if (!o.bare) {
      for (const [lx, lz, h] of [[-W / 2, -D / 2, Hb], [W / 2, -D / 2, Hb], [-W / 2, D / 2, Hf], [W / 2, D / 2, Hf]]) { const p = L(lx, h / 2, lz); B.box('planks', p.x, p.y, p.z, 0.07, h, 0.07, wood); }
      for (const [lz, h] of [[-D / 2, Hb], [D / 2, Hf]]) { const p = L(0, h, lz); B.box('planks', p.x, p.y, p.z, W + 0.2, 0.06, 0.06, wood); }
      for (const lx of [-W / 2, W / 2]) rod(L(lx, Hb, -D / 2), L(lx, Hf, D / 2), 0.03, 'planks', wood.color);
    }
    const ct = L(0, 0.86, 0.1); B.box('planks', ct.x, ct.y, ct.z, W - 0.1, 0.045, 0.9, wood);
    for (const [lx, lz] of [[-W / 2 + 0.15, -0.28], [W / 2 - 0.15, -0.28], [-W / 2 + 0.15, 0.48], [W / 2 - 0.15, 0.48]]) { const p = L(lx, 0.42, lz); B.box('planks', p.x, p.y, p.z, 0.06, 0.84, 0.06, wood); }
    const sk = L(0, 0.52, 0.55); B.box('planks', sk.x, sk.y, sk.z, W - 0.1, 0.6, 0.02, { rot, tile: 1.3, color: rnd.pick(FADED) });
    B.collide(x + 0.1 * s, y0 + 0.442, z + 0.1 * c, W - 0.1, 0.884, 0.9, rot, 'wood');          // (up to the counter top as drawn, so goods sit on it, not in it)
    const key0 = rnd.pick(['cloth_plain', 'cloth_plain', 'cloth_red', 'cloth_green']), tint0 = key0 === 'cloth_plain' ? rnd.pick(FADED) : [1, 1, 1];
    const roof = tarpify(key0, tint0, { us: key0 === 'cloth_plain' ? 3 : 1.6, vs: key0 === 'cloth_plain' ? 2.4 : 1.3 });
    if (!o.bare) sheet(roof.key, 10, 9, (u, t) => {
      const lx = (u - 0.5) * (W + 0.35), body = Math.min(1, t / 0.82), edge = Math.sin(Math.PI * u) * Math.sin(Math.PI * body);
      if (t <= 0.82) return { p: L(lx, Hb + 0.04 + (Hf - Hb) * body - 0.13 * edge, -D / 2 - 0.12 + (D + 0.42) * body), w: 0.5 * edge };
      const k = (t - 0.82) / 0.18;
      return { p: L(lx, Hf + 0.04 - 0.3 * k, D / 2 + 0.3 + 0.03 * k), w: 0.5 + 1.2 * k };
    }, { ...roof.o, color: roof.color });
    // goods
    const goods = o.goods || rnd.pick(['fruit', 'fruit', 'spice', 'pots', 'crates']);
    if (goods === 'fruit') {
      const f = ['lemon', 'sweet_potato', 'onion', 'apple', 'pomegranate', 'lime'];
      for (let i = -1; i <= 1; i++) if (rnd.chance(0.85)) tray(L(i * 0.75, 0.885, 0.12 + rnd.range(-0.08, 0.08)), rot + rnd.range(-0.08, 0.08), f[rnd.int(0, i === 0 ? 5 : 2)], rnd.int(9, 13));
      const p = L(W / 2 + 0.45, 0, 0.5); B.mute = B.mute || !!o.tight; B.prop('plastic_crate', p.x, p.y, p.z, rot + rnd.range(-0.4, 0.4)); if (rnd.chance(0.6)) B.prop('plastic_crate', p.x, p.y + 0.25, p.z, rot + rnd.range(-0.4, 0.4)); if (o.tight) B.mute = false;
    } else if (goods === 'spice') {
      for (let i = 0; i < 4; i++) { const p = L(-W / 2 + 0.35 + i * 0.62, 0, 1.0 + rnd.range(-0.06, 0.1)); sack(p.x, p.y, p.z, SPICE[rnd.int(0, SPICE.length - 1)]); }
      for (let i = -1; i <= 1; i++) { const p = L(i * 0.7, 0.885, 0.1); B.prop(rnd.pick(['basket', 'basket', 'basket_tall']), p.x, p.y, p.z, rot + rnd.range(-0.3, 0.3), rnd.range(1.1, 1.5)); }
    } else if (goods === 'pots') {
      for (let i = 0; i < 5; i++) { const p = L(rnd.range(-W / 2 + 0.25, W / 2 - 0.25), 0.885, rnd.range(-0.2, 0.4)); B.prop('pot', p.x, p.y, p.z, rnd() * 6.28, rnd.range(0.7, 1.2)); }
      for (let i = 0; i < 4; i++) { const p = L(-W / 2 - 0.3 + rnd.range(-0.3, 0.3), 0, 0.4 + i * 0.36); if (!o.tight) B.prop('pot', p.x, p.y, p.z, rnd() * 6.28, rnd.range(1.3, 1.9)); else rnd.range(1.3, 1.9); }
    } else {
      for (let i = -1; i <= 1; i++) { const p = L(i * 0.72, 0.885, 0.1); B.prop(rnd.pick(['cardboard', 'plastic_crate', 'basket']), p.x, p.y, p.z, rot + rnd.range(-0.3, 0.3), 1); }
      const p = L(-W / 2 - 0.5, 0, 0.3); if (!o.tight) B.prop('crate', p.x, p.y, p.z, rot + rnd.range(-0.3, 0.3)); else rnd.range(-0.3, 0.3);
    }
    if (rnd.chance(0.5)) { const p = L(rnd.range(-0.6, 0.6), 0, -0.64); B.prop('stool', p.x, p.y, p.z, rot + rnd.range(-0.25, 0.25)); }      // the stallholder's seat, behind the counter
    if (rs && rs() < 0.4) for (const sx of [-1, 1]) if (rs() < 0.7) ristra(L(sx * (W / 2 - 0.12), o.bare ? 2.3 : Hf - 0.03, o.bare ? 0.6 : D / 2 + 0.02), rs.range(0.6, 0.9));
  }

  function palm(x, z, h, lean = 0.6) {
    const la = rnd() * 6.28, seg = 10, top = V(x + Math.cos(la) * lean, h, z + Math.sin(la) * lean);
    const pts = []; for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push(V(x + Math.cos(la) * lean * t * t, h * t, z + Math.sin(la) * lean * t * t)); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.2, 9, false), tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) {       // taper + flare at the base
      const y = tp.getY(i) / h, k = 0.8 + 0.5 * Math.pow(1 - y, 6) - 0.12 * y, ax = x + Math.cos(la) * lean * y * y, az = z + Math.sin(la) * lean * y * y;
      tp.setX(i, ax + (tp.getX(i) - ax) * k); tp.setZ(i, az + (tp.getZ(i) - az) * k);
    }
    tg.computeVertexNormals();
    B.geom('bark', tg, I, { uvScale: 3, uvScaleY: 1 });
    B.collide(x, h / 2, z, 0.5, h, 0.5, 0, 'wood');
    const n = 26 + rnd.int(0, 6);
    for (let i = 0; i < n; i++) {
      const az = (i / n) * 6.28 * 3.1 + rnd.range(-0.25, 0.25), tier = i % 3, len = rnd.range(2.7, 3.7), e0 = [1.05, 0.5, -0.1][tier] + rnd.range(-0.2, 0.2), bend = [1.5, 1.7, 1.3][tier] + rnd.range(-0.2, 0.3);
      const dry = tier === 2 && rnd.chance(0.5), g = rnd.range(0.34, 0.56), col = dry ? [0.8, 0.62, 0.36] : [g * 1.0, g, g * 0.62];
      const dx = Math.cos(az), dz = Math.sin(az), spine = [V(0, 0, 0)];
      for (let k = 1; k <= 8; k++) { const a = e0 - bend * (k / 8), prev = spine[k - 1]; spine.push(V(prev.x + Math.cos(a) * len / 8, prev.y + Math.sin(a) * len / 8, 0)); }
      const ph = rnd() * 6.28;
      const fg = new THREE.PlaneGeometry(1, 1, 2, 8), fp = fg.attributes.position, fu = fg.attributes.uv, wind = [];
      for (let k = 0; k < fp.count; k++) {
        const u = fu.getX(k), t = fu.getY(k), sp = spine[Math.round(t * 8)], wd = (u - 0.5) * 0.95, fold = Math.abs(u - 0.5) * 0.28;
        fp.setXYZ(k, top.x + dx * sp.x - dz * wd, top.y + sp.y + fold - 0.1, top.z + dz * sp.x + dx * wd); wind.push(t * t * 1.4);
      }
      fg.computeVertexNormals();
      B.geom('frond', fg, I, { color: col, xf: k => [wind[k], ph, 0] });
    }
    B.geom('bark', new THREE.SphereGeometry(0.34, 8, 6), mat4(top.clone().add(V(0, -0.15, 0)), 0, V(1, 1.2, 1)), { uvScale: 2, color: [0.8, 0.75, 0.6] });
  }

  const dish = (p, yaw) => {
    const pr = []; for (let i = 0; i <= 8; i++) { const r = (i / 8) * 0.42; pr.push(new THREE.Vector2(r, r * r * 0.75)); } for (let i = 8; i >= 0; i--) { const r = (i / 8) * 0.42; pr.push(new THREE.Vector2(r, r * r * 0.75 - 0.012)); }
    B.geom('metal_white', new THREE.LatheGeometry(pr, 16), mat4(p.clone().add(V(0, 0.55, 0)), yaw, 1, -1.0, 0), { color: [0.9, 0.9, 0.88], uvScale: 0.6 });
    rod(p, p.clone().add(V(0, 0.55, 0)), 0.022); rod(p.clone().add(V(0, 0.55, 0)), p.clone().add(V(Math.sin(yaw) * 0.42, 0.85, Math.cos(yaw) * 0.42)), 0.01);
  };
  const tank = (p, black) => {
    for (const [a, b] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) rod(V(p.x + a, p.y, p.z + b), V(p.x + a, p.y + 0.9, p.z + b), 0.03);
    B.box('metal_plate', p.x, p.y + 0.93, p.z, 1.2, 0.05, 1.2, { tile: 1.2 });
    B.geom(black ? 'matte' : 'metal_white', new THREE.CylinderGeometry(0.56, 0.56, 1.3, 16), mat4(V(p.x, p.y + 1.61, p.z)), { color: black ? [0.05, 0.05, 0.055] : [0.85, 0.87, 0.9], uvScale: 2, uvScaleY: 1 });
    B.geom(black ? 'matte' : 'metal_white', new THREE.SphereGeometry(0.56, 16, 6, 0, 6.2832, 0, 1.2), mat4(V(p.x, p.y + 2.2, p.z), 0, V(1, 0.3, 1)), { color: black ? [0.05, 0.05, 0.055] : [0.85, 0.87, 0.9] });
  };

  // a ribbed black polyethylene water tank on a low block stand (tinaco), the commonest thing on a Mexican roof
  const tankBlack = q => {
    B.box('concrete', q.x, q.y + 0.2, q.z, 1.3, 0.4, 1.3, { tile: 1.2, color: [0.75, 0.73, 0.7] });
    const pr = [[0, 0], [0.5, 0], [0.56, 0.06], [0.56, 0.3], [0.58, 0.34], [0.56, 0.38], [0.56, 0.7], [0.58, 0.74], [0.56, 0.78], [0.56, 1.1], [0.5, 1.22], [0.3, 1.3], [0.22, 1.32], [0.22, 1.4], [0, 1.4]].map(([a, b]) => new THREE.Vector2(a, b));
    B.geom('matte', new THREE.LatheGeometry(pr, 18), mat4(V(q.x, q.y + 0.4, q.z)), { color: [0.035, 0.035, 0.04] });
  };
  // clay pot, optionally with a hardy plant in it
  const planter = (q, s, planted = true) => {
    B.prop('pot', q.x, q.y, q.z, rnd() * 6.28, s);
    if (planted) B.prop(rnd.pick(['bush_b', 'bush_c', 'weed_b']), q.x, q.y + 0.19 * s, q.z, rnd() * 6.28, s * rnd.range(0.7, 1.0));
  };

  // =========================================== anchor-driven dressing =====================================================
  // Returns the market-lane anchors that want a stall. A ghost building's dressing is drawn and thrown away (B.mute), so
  // it uses up the same random draws as before the passages were cut and everything after it stays where it was.
  function dressAnchors(list) {
  const stalls = [];
  for (const a of list) {
    B.mute = !!a.bd?.ghost;
    if (a.street === 'none') continue;
    const { p, N, T } = a, rotN = N ? Math.atan2(N.x, N.z) : 0;
    const at = (u, y, d) => V(p.x + T.x * u + N.x * d, y, p.z + T.z * u + N.z * d);   // d = metres out from the wall
    const gy = a.street === 'main' ? SIDEWALK : 0;
    if (a.kind === 'door') {
      if (rnd.chance(0.4)) { const l = at(0, 1.75, 0.25); B.prop('wall_lamp', l.x, l.y, l.z, rotN, 0.6); }
      if (rnd.chance(0.4)) { const q = at(rnd.sign() * 0.95, gy, 0.3); planter(q, rnd.range(1.3, 1.9)); }
    } else if (a.kind === 'shutter' || a.kind === 'shop') {
      if (rnd.chance(a.kind === 'shop' ? 0.85 : 0.4) && a.street !== 'market') {     // sloped canopy with support rods
        const w = a.w + 0.5, out = 1.75, key = rnd.pick(['cloth_plain', 'cloth_plain', 'cloth_red', 'cloth_green']), tint = key === 'cloth_plain' ? rnd.pick(FADED) : [1, 1, 1];
        const cv = tarpify(key, tint, { us: key === 'cloth_plain' ? 3 : 1.6, vs: key === 'cloth_plain' ? 2.4 : 1.2 }); a.canopy = true;
        sheet(cv.key, 8, 6, (u, t) => {
          const lx = (u - 0.5) * w, body = Math.min(1, t / 0.85), e = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, body));
          if (t <= 0.85) return { p: at(lx, 3.12 - 0.62 * body - 0.07 * e, 0.03 + out * body), w: 0.4 * e };
          const k = (t - 0.85) / 0.15; return { p: at(lx, 2.5 - 0.26 * k, 0.03 + out + 0.02 * k), w: 0.4 + 1.1 * k };
        }, { ...cv.o, color: cv.color });
        for (const u of [-w / 2 + 0.05, w / 2 - 0.05]) { rod(at(u, 3.12, 0.03), at(u, 2.5, out + 0.03), 0.014); rod(at(u, 2.35, 0.03), at(u, 2.5, out + 0.03), 0.012); }
        rod(at(-w / 2 + 0.05, 2.5, out + 0.03), at(w / 2 - 0.05, 2.5, out + 0.03), 0.014);
      }
      if (a.kind === 'shop') {
        for (const sgn of [-1, 1]) {
          const q = at(sgn * (a.w / 2 + 0.45), gy, 0.5), k = rnd.int(0, 4);
          if (k === 0) { sack(q.x, q.y, q.z, rnd.pick(SPICE)); const q2 = at(sgn * (a.w / 2 + 0.5), gy, 1.05); sack(q2.x, q2.y, q2.z, rnd.pick(SPICE)); }
          else if (k === 1) { B.prop('crate', q.x, q.y, q.z, rotN + rnd.range(-0.3, 0.3)); B.prop('basket', q.x, q.y + 0.32, q.z, rnd() * 6.28, 1.3); }
          else if (k === 2) B.prop('chair', q.x, q.y, q.z, rotN + rnd.range(-0.6, 0.6));
          else if (k === 3) { B.prop('plastic_crate', q.x, q.y, q.z, rotN); B.prop('plastic_crate', q.x, q.y + 0.25, q.z, rotN + 0.2); }
        }
      }
    } else if (a.kind === 'room') {
      const { P, ra, rb, D, y } = a, mid = (ra + rb) / 2, rotIn = rotN;
      for (const q of [P(mid - 0.7, y, D - 0.32), P(mid + 0.75, y, D - 0.32)]) {
        const s = B.prop('shelves', q.x, q.y, q.z, rotIn, 0.95);
        B.detail(q.x, q.y + s.y * 0.475, q.z, s.x * 0.95, s.y * 0.95, s.z * 0.95, rotIn, 'metal', false);
      }
      for (let k = 0; k < 9; k++) { const q = P(mid + rnd.range(-1.2, 1.2), y + rnd.pick([0.42, 0.87, 1.3]) * 0.9, D - 0.3); B.prop(rnd.pick(['cardboard', 'basket', 'jerrycan', 'pot']), q.x, q.y, q.z, rnd() * 6.28, rnd.range(0.55, 0.8)); }
      const tb = P(mid + rnd.range(-0.4, 0.4), y, 2.3); B.propSolid('table', tb.x, tb.y, tb.z, rotIn + rnd.range(-0.2, 0.2), 1, 'wood');
      const bk = P(mid, y + 0.8, 2.3); B.prop(rnd.pick(['basket_tall', 'basket', 'cardboard']), bk.x, bk.y, bk.z, rnd() * 6.28, 1.2);
      const cr = P(ra + 0.6, y, D - 1.4); B.propSolid('crate', cr.x, cr.y, cr.z, rotIn + 1.57 + rnd.range(-0.2, 0.2), 1.1, 'wood');
      const sk = P(rb - 0.55, y, D - 1.3); sack(sk.x, sk.y, sk.z, rnd.pick(SPICE)); const sk2 = P(rb - 0.6, y, D - 1.95); sack(sk2.x, sk2.y, sk2.z, rnd.pick(SPICE));
      const bulb = P(mid, a.h - 0.5, 2.2); rod(P(mid, a.h, 2.2), bulb, 0.006, 'cable');
    } else if (a.kind === 'balcony') {
      if (rs && !a.bd?.ghost && rs() < (a.bd?.late !== undefined && a.street === 'calle' ? 0.3 : 0.16)) bougainvillea(at(rs.range(-a.w / 4, a.w / 4), p.y + 1.05, 0.08), N, T, rs.range(0.9, a.w * 0.8), rs.range(1.2, 2.6));
      const k = rnd.int(0, 5), top = p.y + 1.0;
      if (k <= 1) {             // laundry / rug over the rail
        const w = rnd.range(0.7, Math.min(1.5, a.w - 0.4)), u0 = rnd.range(-a.w / 2 + 0.2, a.w / 2 - 0.2 - w), len = rnd.range(0.7, 1.2), key = k === 0 ? 'rug' : rnd.pick(['cloth_plain', 'cloth_red', 'cloth_green']);
        sheet(key, 4, 5, (u, t) => ({ p: at(u0 + u * w, top + 0.02 - t * len, 0.03 + 0.02 * t), w: t * (key === 'rug' ? 0.15 : 0.9) }), { color: key === 'cloth_plain' ? rnd.pick(FADED) : [1, 1, 1], us: key === 'rug' ? 1 : 1.5, vs: key === 'rug' ? 1.3 : 1.5 });
      } else if (k === 2) planter(at(rnd.range(-0.4, 0.4), p.y, -0.3), 1.5);
      else if (k === 3) dish(at(a.w / 2 - 0.2, p.y + 0.5, -0.1), rotN + rnd.range(-0.6, 0.6));
      if (rnd.chance(0.3)) planter(at(rnd.range(-a.w / 2 + 0.3, a.w / 2 - 0.3), p.y, -rnd.range(0.2, 0.7)), rnd.range(0.9, 1.4));
    } else if (a.kind === 'window') {
      if (rnd.chance(0.6)) { const w = a.w * rnd.range(0.7, 1.1), len = rnd.range(0.8, 1.4); sheet(rnd.chance(0.5) ? 'rug' : 'cloth_plain', 3, 5, (u, t) => ({ p: at((u - 0.5) * w, p.y - 0.02 - t * len, 0.09 + 0.01 * t), w: t * 0.5 }), { color: rnd.pick(FADED), us: 1.2, vs: 1.4 }); }
    } else if (a.kind === 'wall') {
      const r = rnd();
      if (a.street === 'alley') {
        if (r < 0.2) { const q = at(rnd.range(-0.6, 0.6), 0, 0.42); B.propSolid(rnd.chance(0.5) ? 'trashcan' : 'trashcan_rust', q.x, q.y, q.z, rnd() * 6.28, 1, 'metal', 0.8); const b = at(rnd.range(-1.2, 1.2), 0, 0.5); B.prop('trashbag', b.x, b.y, b.z, rnd() * 6.28, rnd.range(0.9, 1.2)); }
        else if (r < 0.36) { const q = at(0, 0, 0.55); B.propSolid('drum', q.x, q.y, q.z, rnd() * 6.28, 1, 'metal', 0.85); if (rnd.chance(0.5)) { const q2 = at(0.72, 0, 0.5); B.propSolid('drum_plastic', q2.x, q2.y, q2.z, rnd() * 6.28, 1, 'wood', 0.85); } anchors.push({ kind: 'stain', x: q.x, z: q.z, r: 1.6, s: 0.5 }); }
        else if (r < 0.5) { const q = at(0, 0, 0.5); pallet(q.x, 0, q.z, rotN + rnd.range(-0.2, 0.2)); B.prop('cardboard', q.x, 0.14, q.z, rnd() * 6.28, 1.2, null, null, true); B.collide(q.x, 0.25, q.z, 1.1, 0.5, 0.9, rotN); }   // (pallet and box are one obstacle: the box stays put)
        else if (r < 0.62) {                                                     // a stack of old tyres, each lying on the one below
          let y = 0, u0 = null;
          for (let i = 0; i < 3; i++) { const u = rnd.range(-0.5, 0.5), d = 0.55 + rnd.range(-0.04, 0.04); u0 ??= u; const q = at(u0 + (u - u0) * 0.08, 0, d); y += B.propOn('tyre', q.x, y + 0.004, q.z, rnd() * 6.28, 1, [Math.PI / 2, 0]); }
        }
        else if (r < 0.72) { const q = at(0, 0, 0.48); B.prop('ladder', q.x, q.y, q.z, rotN + Math.PI / 2, 1.5); }
        else if (r < 0.8) { const q = at(0, 0, 0.45); B.prop('hand_truck', q.x, q.y, q.z, rotN + rnd.range(-0.3, 0.3)); }
      } else if (a.street === 'main' || a.street === 'plaza' || a.street === 'cross') {
        if (r < 0.14) { const q = at(0, gy, 0.3); B.prop('utility_box', q.x, q.y, q.z, rotN, 1); B.collide(q.x, gy + 0.55, q.z, 0.5, 1.1, 0.45, rotN, 'metal'); }
        else if (r < 0.3) { const q = at(rnd.range(-0.5, 0.5), gy, 0.4); B.prop('chair', q.x, q.y, q.z, rotN + rnd.range(-0.7, 0.7)); if (rnd.chance(0.5)) { const q2 = at(rnd.range(0.4, 0.9), gy, 0.5); B.prop('stool', q2.x, q2.y, q2.z, rnd() * 6.28); } }
        else if (r < 0.45) { for (let i = 0; i < 2; i++) planter(at(rnd.range(-0.9, 0.9), gy, rnd.range(0.25, 0.5)), rnd.range(1.4, 2.2), i === 0); }
        else if (r < 0.58) { const q = at(0, gy, 0.5); B.propSolid('crate', q.x, q.y, q.z, rotN + rnd.range(-0.2, 0.2), 1.15, 'wood'); if (rnd.chance(0.6)) B.prop('cardboard', q.x + rnd.range(-0.1, 0.1), q.y + 0.37, q.z, rnd() * 6.28); }
        else if (r < 0.68) { const q = at(0, gy, 0.42); B.propSolid('trashcan_rust', q.x, q.y, q.z, rnd() * 6.28, 1, 'metal', 0.8); }
        else if (r < 0.76) planter(at(0, gy, 0.35), 2.2);
        else if (r < 0.84) { const q = at(0, gy, 0.4); B.propSolid('propane', q.x, q.y, q.z, rnd() * 6.28, 1.1, 'metal', 0.8); const q2 = at(0.45, gy, 0.38); B.prop('lpg', q2.x, q2.y, q2.z, rnd() * 6.28, 1); }
      } else if (a.street === 'market' && N.x > 0) {
        stalls.push(a);
      }
    } else if (a.kind === 'roof') {
      const bd = a.bd, H = bd.H, inx = 1.0;
      if (bd.x1 - bd.x0 < 6 || bd.z1 - bd.z0 < 6) continue;
      const rp = () => V(rnd.range(bd.x0 + inx, bd.x1 - inx), H, rnd.range(bd.z0 + inx, bd.z1 - inx));
      const ep = () => { const q = rp(); const e = rnd.int(0, 3); if (e === 0) q.x = bd.x0 + 1.1; else if (e === 1) q.x = bd.x1 - 1.1; else if (e === 2) q.z = bd.z0 + 1.1; else q.z = bd.z1 - 1.1; return q; };
      if (rs && !bd.ghost && bd !== low) {                                       // (style stream) the next storey that never came: column stubs bristling with rebar
        for (const [cx, cz] of [[bd.x0 + 0.35, bd.z0 + 0.35], [bd.x1 - 0.35, bd.z0 + 0.35], [bd.x0 + 0.35, bd.z1 - 0.35], [bd.x1 - 0.35, bd.z1 - 0.35]]) {
          if (rs() > 0.45) continue;
          const sh = rs.range(0.25, 0.7); B.box('concrete', cx, H + PARAPET + sh / 2, cz, 0.3, sh, 0.3, { tile: 1, color: [0.78, 0.76, 0.72] });
          for (const [ox, oz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) { const t = H + PARAPET + sh, l = rs.range(0.5, 1.3), bx = rs.range(-0.12, 0.12), bz = rs.range(-0.12, 0.12); rod(V(cx + ox, t - 0.05, cz + oz), V(cx + ox + bx, t + l, cz + oz + bz), 0.007, 'iron', [0.55, 0.32, 0.2]); }
        }
        if (rs() < 0.55) { const q = V(rs.range(bd.x0 + 1.4, bd.x1 - 1.4), H, rs.range(bd.z0 + 1.4, bd.z1 - 1.4)); tankBlack(q); }
      }
      if (bd === low) { sandbags(-18.2, -9, 3.4, 3, Math.PI / 2, H); B.propSolid('mil_crate', -22, H, -8, 0.4, 1.2, 'wood'); B.propSolid('drum', -25.6, H, -15.6, 0, 1, 'metal', 0.85); tank(V(-25.4, H, -5), true); continue; }
      if (rnd.chance(0.7)) tank(ep(), rnd.chance(0.5));
      if (rnd.chance(0.6)) dish(ep(), rnd() * 6.28);
      if (rnd.chance(0.5)) dish(ep(), rnd() * 6.28);
      if (rnd.chance(0.7)) { const q = ep(), h = rnd.range(2.6, 4.6); rod(q, q.clone().add(V(0, h, 0)), 0.016); for (let i = 0; i < 4; i++) { const y = h - 0.25 - i * 0.28, w = 0.5 - i * 0.07; rod(V(q.x - w, H + y, q.z), V(q.x + w, H + y, q.z), 0.007); } }
      if (rnd.chance(0.45)) { const q = rp(); B.box(bd.wall, q.x, H + 1.25, q.z, 2.6, 2.5, 2.4, { color: bd.tint, tile: bd.tile }); B.box('concrete', q.x, H + 2.55, q.z, 2.9, 0.12, 2.7, { color: bd.trim }); }
      if (rnd.chance(0.5)) { const q = ep(); B.prop(rnd.chance(0.5) ? 'ac' : 'ac_rust', q.x, H, q.z, rnd() * 6.28, 1); }
      if (rnd.chance(0.3)) { const q = ep(); for (let i = 0; i < 2; i++) B.geom('metal_white', new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8), mat4(V(q.x + i * 0.5, H + 0.75, q.z)), { color: [0.6, 0.6, 0.6] }); }
    }
  }
  B.mute = false;
  return stalls;
  }

  const stain = (x, z, r, s = 0.6) => anchors.push({ kind: 'stain', x, z, r, s });
  const barrier = (x, z, rot, tall) => B.propSolid(tall ? 'barrier2' : 'barrier', x, 0, z, rot, 1, 'concrete', 0.95);
  const crates = (x, z, rot, n = 2, y = 0) => { B.propSolid('crate', x, y, z, rot, 1.2, 'wood'); if (n > 1) B.propSolid('mil_crate', x + 0.05, y + 0.385, z, rot + 0.25, 1.05, 'wood'); if (n > 2) { B.propSolid('crate', x + Math.cos(rot) * 1.05, y, z - Math.sin(rot) * 1.05, rot + 1.4, 1.2, 'wood'); } };
  const drums = (x, z, n = 3) => { for (let i = 0; i < n; i++) { const a = i * 2.1 + rnd.range(-0.3, 0.3), d = i ? 0.42 : 0; B.propSolid(rnd.chance(0.7) ? 'drum' : 'drum_plastic', x + Math.cos(a) * d, 0, z + Math.sin(a) * d, rnd() * 6.28, 1, 'metal', 0.85); } stain(x, z, 2, 0.55); };
  const car = (x, z, rot) => { B.prop('car', x, 0, z, rot, 1); B.collide(x, 0.62, z, 1.75, 1.25, 4.3, rot, 'fabric'); stain(x, z, 3.2, 0.5); };
  // Bougainvillea spilling over a parapet or a balcony rail and down the wall: a loose curtain of leaf-and-bract cards.
  // p: on the wall plane at the top of the fall; N out of the wall, T along it (style stream unless R is given).
  const bougainvillea = (p, N, T, w, drop, R = rs) => {
    const n = Math.max(4, Math.round(w * drop * 2.4)), ph = R() * 6.28;
    for (let i = 0; i < n; i++) {
      const f = Math.pow(R(), 1.5), u = R.range(-w / 2, w / 2) * (1 - f * 0.4), d = 0.06 + R.range(0, 0.3) * (1 - f * 0.7), s = R.range(0.75, 1.25) * (1 - f * 0.3);
      const c = V(p.x + T.x * u + N.x * d, p.y - f * drop, p.z + T.z * u + N.z * d);
      const g = new THREE.PlaneGeometry(s, s, 1, 1); g.rotateZ(R() * 6.28);
      g.lookAt(V(N.x + R.range(-0.5, 0.5), R.range(-0.1, 0.6), N.z + R.range(-0.5, 0.5)));
      const k = R.range(0.85, 1.08), wind = [0.2, 0.6, 0.2, 0.6].map(x => x * (0.5 + f));
      B.geom('flowers', g, mat4(c), { color: [k, k * 0.97, k], xf: j => [wind[j % 4], ph + i * 0.3, 0] });
    }
  };
  // A star piñata of foil and tissue: a round body, seven cones with tassels, on a cord from above.
  const PINATA = [[1.0, 0.22, 0.55], [1.0, 0.78, 0.12], [0.2, 0.68, 1.0], [0.6, 0.26, 0.86], [0.24, 0.8, 0.36], [1.0, 0.42, 0.12]];
  const pinata = (p, hang, R = rs) => {
    const s = R.range(0.8, 1.15), c0 = R.int(0, PINATA.length - 1);
    B.geom('glossy', new THREE.IcosahedronGeometry(0.2 * s, 1), mat4(p), { color: PINATA[c0] });
    const dirs = [[0, 1, 0], [0, -1, 0], [1, 0.1, 0], [-1, 0.1, 0], [0, 0.1, 1], [0, 0.1, -1], [0.6, -0.4, 0.6]];
    dirs.forEach(([x, y, z], k) => {
      const d = V(x, y, z).normalize(), cone = new THREE.ConeGeometry(0.075 * s, 0.4 * s, 8), q = new THREE.Quaternion().setFromUnitVectors(UP, d);
      B.geom('glossy', cone, new THREE.Matrix4().compose(p.clone().addScaledVector(d, 0.36 * s), q, V(1, 1, 1)), { color: PINATA[(c0 + k + 1) % PINATA.length] });
      const tip = p.clone().addScaledVector(d, 0.58 * s);
      for (let t = 0; t < 2; t++) { const a = V(tip.x + R.range(-0.03, 0.03), tip.y, tip.z + R.range(-0.03, 0.03)); B.quad('matte', V(a.x - 0.015, a.y - 0.22, a.z), V(a.x + 0.015, a.y - 0.22, a.z), V(a.x + 0.015, a.y, a.z), V(a.x - 0.015, a.y, a.z), { color: PINATA[(c0 + k + 3 + t) % PINATA.length] }); }
    });
    rod(p.clone().add(V(0, 0.2 * s, 0)), V(p.x, hang, p.z), 0.004, 'cable');
  };
  // A ristra: dried red chiles strung round a cord, hung from a beam.
  const ristra = (top, len, R = rs) => {
    rod(top, top.clone().add(V(0, -len, 0)), 0.005, 'cable');
    const n = Math.floor(len / 0.032);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39, r = 0.035 + R.range(0, 0.015), y = top.y - 0.06 - i * 0.032, g = R.range(0.55, 0.85);
      const cone = new THREE.ConeGeometry(0.017, R.range(0.09, 0.13), 6); cone.rotateX(Math.PI + R.range(-0.4, 0.4)); cone.rotateZ(R.range(-0.5, 0.5));
      B.geom('glossy', cone, mat4(V(top.x + Math.cos(a) * r, y, top.z + Math.sin(a) * r), a), { color: [g * 0.62, g * 0.06, g * 0.04] });
    }
  };
  // Papel picado on a string between two points: a flag every 0.38 m, colours in a run, each in the wind (style stream).
  const papel = (a, b, sag, R = rs) => {
    const pts = cable(a, b, sag, 0.004), len = a.distanceTo(b), n = Math.max(2, Math.floor(len / 0.38));
    const along = V(b.x - a.x, 0, b.z - a.z).normalize(), c0 = R.int(0, PAPEL_COLOURS.length - 1);
    for (let i = 1; i < n; i++) {
      const f = (i / n) * 10, k = Math.min(9, Math.floor(f)), q = pts[k].clone().lerp(pts[k + 1], f - k);
      const col = PAPEL_COLOURS[(c0 + i) % PAPEL_COLOURS.length], [u0, v0, u1, v1] = papelUV((c0 + i * 3) % 8), w = 0.3, h = 0.4, ph = R() * 6.28;
      const g = new THREE.PlaneGeometry(1, 1, 1, 3), pos = g.attributes.position, uv = g.attributes.uv, wind = [];
      for (let j = 0; j < pos.count; j++) {
        const s = uv.getX(j), t = 1 - uv.getY(j);
        pos.setXYZ(j, q.x + along.x * (s - 0.5) * w, q.y - t * h, q.z + along.z * (s - 0.5) * w);
        uv.setXY(j, u0 + (u1 - u0) * s, v1 - (v1 - v0) * t); wind.push(t * t * 1.3);
      }
      g.computeVertexNormals();
      B.geom('cloth_papel', g, I, { color: col, xf: j => [wind[j], ph, 0] });
    }
  };
  // Hand-painted signs over doors, shutters and shops: painted on the wall above the opening, or a two-faced board on an
  // iron bracket where an awning is in the way (style stream).
  const signs = (list, odds = { shop: 0.95, shutter: 0.6, door: 0.3 }) => {
    for (const a of list) {
      if (!odds[a.kind] || a.bd?.ghost) continue;
      if (rs() > odds[a.kind]) continue;
      const top = a.kind === 'door' ? 2.32 : a.kind === 'shop' ? 2.8 : 2.92, gy = a.street === 'main' ? SIDEWALK : 0, y0 = top + 0.12, h = Math.min(0.62, FLOOR0 - 0.1 - y0), w = Math.min(h * 2, a.w + 0.6);
      const si = rs.int(0, SIGNS.length - 3), { p, N, T } = a, at = (u, v, d) => V(p.x + T.x * u + N.x * d, v, p.z + T.z * u + N.z * d);
      if (!a.canopy) { if (h >= 0.3) B.quad('sign', at(-w / 2, y0, 0.016), at(w / 2, y0, 0.016), at(w / 2, y0 + w / 2, 0.016), at(-w / 2, y0 + w / 2, 0.016), { uv: signUV(si) }); continue; }
      const u = (a.w / 2 + 0.5) * (rs() < 0.5 ? -1 : 1), y = 3.0 + gy * 0, bw = 0.84, bh = 0.42, d0 = 0.18;
      B.quad('sign', at(u, y, d0), at(u, y, d0 + bw), at(u, y + bh, d0 + bw), at(u, y + bh, d0), { uv: signUV(si) });
      B.quad('sign', at(u, y, d0 + bw), at(u, y, d0), at(u, y + bh, d0), at(u, y + bh, d0 + bw), { uv: signUV(si) });
      rod(at(u, y + bh + 0.06, 0), at(u, y + bh + 0.06, d0 + bw + 0.05), 0.012); rod(at(u, y + bh + 0.06, d0 + bw), at(u, y - 0.4, 0), 0.01);
    }
  };
  return { mat4, rod, cable, sheet, sandbags, rubble, pallet, tray, sack, stall, palm, dish, tank, planter, dressAnchors, stain, barrier, crates, drums, car, tarpify, papel, signs, bougainvillea, pinata, ristra, FADED, SPICE };
}

// The old district's dressing. gates: z ranges of the passages through the east ring (nothing is hung across them).
export function dress(ctx) {
  const { B, rnd, anchors, gates = [] } = ctx, K = dressKit(ctx);
  const { mat4, rod, cable, sheet, sandbags, rubble, pallet, stall, palm, planter, stain, barrier, crates, drums, car } = K;
  const stalls = K.dressAnchors(anchors.slice());
  const buildings = ctx.buildings.filter(b => !b.ghost), inGate = (z, r) => gates.some(([a, b]) => z + r > a && z - r < b);

  const bAt = (x, z) => buildings.find(b => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
  const wallNear = (x, z, rank) => {
    const c = buildings.map(b => { const qx = Math.min(b.x1, Math.max(b.x0, x)), qz = Math.min(b.z1, Math.max(b.z0, z)); return { b, qx, qz, d: Math.hypot(qx - x, qz - z) }; }).filter(o => o.d > 1).sort((p, q) => p.d - q.d)[rank];
    return V(c.qx, c.b.H - rnd.range(0.2, 1.0), c.qz);
  };

  // =========================================== main street =================================================================

  barrier(-1.6, -47, 0.08); barrier(2.3, -44.5, -0.12, true); drums(3.3, -47.2, 3);
  car(2.75, -36, 0.03); crates(-3.0, -38, 0.3, 3);
  sandbags(-1.8, -28.5, 3.6, 5, 0.05); B.propSolid('mil_crate_open', 0.7, 0, -29.2, 0.5, 1.1, 'wood');
  barrier(-2.6, -20.5, 1.45, true); barrier(2.8, -19, 1.7, true); barrier(0.2, -15.5, 0.1);
  crates(3.0, -9.5, 1.3, 3); drums(-3.2, -6.5, 2);
  barrier(-2.9, 1.5, 0.05, true); barrier(0.0, 2.6, -0.06); barrier(3.0, 1.2, 0.1, true); sandbags(0, 3.35, 2.4, 3, -0.04);
  rubble(-4.6, 9.5, 1.8, 0.75); rubble(4.9, 17.2, 1.4, 0.6);
  car(-2.7, 27, -0.06); barrier(2.4, 24.5, 0.15); drums(3.4, 30, 3);
  sandbags(1.9, 35, 3.6, 5, -0.07); crates(-2.8, 37.5, -0.2, 2);
  barrier(-1.5, 45, -0.1, true); barrier(2.2, 47.5, 0.07); crates(3.1, 52, 0.9, 3);
  for (const [x, z] of [[0.6, -52], [-1.2, -12], [1.5, 22], [-0.8, 41]]) B.prop('manhole', x, -0.052, z, rnd() * 6.28, 1.05);
  // cross streets and spawn streets
  barrier(-16, -20.6, 0.1, true); drums(-12, -18.6, 2); barrier(15, -19.4, -0.05); crates(18.5, -21.3, 0.2, 2);
  barrier(-15, 19.5, 0.08); crates(-19, 21.2, 0.1, 3); barrier(16, 20.8, 0.1, true); drums(12, 18.5, 3);
  car(-12, -60.6, Math.PI / 2 + 0.05); barrier(8, -59, 0.2, true); crates(18, -61.5, 0.4, 3); sandbags(-21, -58.6, 3, 4, 0.1); drums(22.5, -58.4, 2);
  car(13, 60.4, Math.PI / 2 - 0.04); barrier(-8, 59.2, -0.15, true); crates(-18, 61.4, -0.3, 3); sandbags(21, 58.7, 3, 4, -0.1); drums(-22.5, 61.6, 2);
  rubble(-23, 60.5, 1.3, 0.55); rubble(24, -61, 1.5, 0.6);

  // =========================================== the plaza fountain ===========================================================
  // A cantera basin on a step, sunk panels of talavera round it and talavera lining it, a turned tazza with two bowls
  // (the kit's fountain_basin and fountain_tazza, modelled in tools/blender/kit.py), and water: standing in the basin
  // and both bowls, spilling over each lip in a sheet that breaks into strands, foaming where it lands. Its sizes are
  // the kit's (FOUNTAIN in kit.py). A soldier can wade in the basin; soldiers' routes keep round it.
  function fountain(cx, cz) {
    const at = (x, y, z) => V(cx + x, y, cz + z), stone = { tile: 2.6, color: [1.0, 0.94, 0.88] };
    B.kit('fountain_basin', mat4(at(0, 0, 0)), { trim: 'cantera' }, { slot: { trim: stone } });
    B.kit('fountain_tazza', mat4(at(0, 0, 0)), { trim: 'cantera' }, { slot: { trim: stone } });
    const T8 = Math.tan(Math.PI / 8), tile = 0.52;                            // talavera: 13 cm tiles, four to the texture
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, n = V(Math.cos(a), 0, Math.sin(a));
      const face = (ap, w, y0, y1, inward) => {                               // a panel of tiles on a face of the octagon
        const m = inward ? -1 : 1, nn = n.clone().multiplyScalar(m), tt = V(nn.z, 0, -nn.x), c = at(n.x * ap, 0, n.z * ap);
        const uo = -((c.x * nn.z - c.z * nn.x) / tile) + 0.5, vo = -y0 / tile;
        B.quad('talavera', c.clone().addScaledVector(tt, -w).setY(y0), c.clone().addScaledVector(tt, w).setY(y0), c.clone().addScaledVector(tt, w).setY(y1), c.clone().addScaledVector(tt, -w).setY(y1), { tile, uo, vo, color: inward ? [0.86, 0.95, 1.0] : [1, 1, 1] });
      };
      face(2.157, 2.18 * T8 - 0.17, 0.17, 0.43, false);                      // in the sunk panel of each outer face
      face(1.748, 1.75 * T8, 0.18, 0.52, true);                              // lining the basin
    }
    const disc = (r, segs, y, key, us, rot = 0) => { const g = new THREE.CircleGeometry(r, segs); g.rotateX(-Math.PI / 2); B.geom(key, g, mat4(at(0, y, 0), rot), { uvScale: us }); };
    { const ap = 1.748, h = ap * T8, y = 0.181, o = { tile, uo: -cx / tile, vo: cz / tile, color: [0.86, 0.95, 1.0] };   // the basin's tiled floor (three quads)
      B.quad('talavera', at(-ap, y, h), at(ap, y, h), at(ap, y, -h), at(-ap, y, -h), o);
      B.quad('talavera', at(-h, y, ap), at(h, y, ap), at(ap, y, h), at(-ap, y, h), o);
      B.quad('talavera', at(-ap, y, -h), at(ap, y, -h), at(h, y, -ap), at(-h, y, -ap), o); }
    disc(1.75 / Math.cos(Math.PI / 8), 8, 0.47, 'water', 2.4, Math.PI / 8);   // the water: in the basin, and in each bowl
    disc(0.8, 40, 1.43, 'water', 1.1); disc(0.375, 32, 1.988, 'water', 0.5);
    // a ring of quads round the axis: rv(v) = [radius, height] for v from 0 to 1, u running `around` times round
    const ring = (key, segs, rows, around, rv, up) => {
      const pos = [], nor = [], uv = [], idx = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= segs; i++) {
        const v = j / rows, a = i / segs * Math.PI * 2, [r, y] = rv(v);
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r); if (up) nor.push(0, 1, 0); else nor.push(Math.cos(a), 0, Math.sin(a)); uv.push(i / segs * around, v);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) { const p = j * (segs + 1) + i, q = p + segs + 1; idx.push(p, p + 1, q, p + 1, q + 1, q); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      B.geom(key, g, mat4(at(0, 0, 0)));
    };
    ring('water_fall', 48, 6, 7, v => [0.89 + 0.13 * v * v, 1.43 - 0.96 * v], false);        // over the big bowl's lip into the basin
    ring('water_fall', 32, 4, 3, v => [0.41 + 0.07 * v * v, 1.99 - 0.56 * v], false);        // over the small bowl's lip into the big one
    ring('water_foam', 48, 2, 5, v => [0.95 + 0.38 * v, 0.474], true);
    ring('water_foam', 32, 2, 2, v => [0.45 + 0.17 * v, 1.433], true);
    // collision: the step, the rim (a soldier can sit, stand or step over it), the basin floor under the water (wading;
    // high enough to keep the soldiers' routes outside), the tazza and its big bowl
    const oct = (ap, y0, y1, surf) => { for (let k = 0; k < 4; k++) B.collide(cx, (y0 + y1) / 2, cz, ap * 2, y1 - y0, 2 * ap * T8, k * Math.PI / 4, surf); };
    oct(2.32, 0, 0.1, 'concrete'); oct(1.75, 0, 0.26, 'water'); oct(0.46, 0, 1.2, 'concrete'); oct(0.89, 1.19, 1.46, 'concrete');
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = (1.68 + 2.25) / 2; B.collide(cx + Math.cos(a) * r, 0.32, cz + Math.sin(a) * r, 2 * 2.25 * T8 + 0.02, 0.64, 0.57, Math.PI / 2 - a, 'concrete'); }
    B.emitters.push({ kind: 'water', x: cx, y: 1.0, z: cz });                // (audio: the splash of it)
  }

  // =========================================== plaza ======================================================================
  {
    const st = { color: [1.0, 0.95, 0.86], tile: 2.2 };
    fountain(-11.5, 0);
    // broken perimeter wall towards the street
    for (const [za, zb, h] of [[-16.6, -11.2, 1.05], [-11.2, -9.4, 0.6], [-4.5, 1.0, 1.1], [1.0, 2.3, 0.45], [7.4, 12.6, 1.0]]) {
      B.box('w_brick', -6.25, h / 2, (za + zb) / 2, 0.42, h, zb - za, { tile: 2.0 }); B.box('concrete', -6.25, h + 0.04, (za + zb) / 2, 0.5, 0.08, zb - za + 0.04, st);
      B.collide(-6.25, h / 2, (za + zb) / 2, 0.42, h, zb - za, 0, 'brick');
    }
    rubble(-6.6, -7.0, 1.3, 0.5); rubble(-6.4, 4.6, 1.5, 0.55);
    for (const [x, z, h] of [[-14.6, -11.5, 8.2], [-8.6, 9.6, 9.4], [-15.2, 12.6, 7.4]]) {
      palm(x, z, h); B.box('concrete', x, 0.2, z, 1.5, 0.4, 1.5, st); B.collide(x, 0.2, z, 1.5, 0.4, 1.5);
      B.quad('rubble', V(x - 0.62, 0.41, z + 0.62), V(x + 0.62, 0.41, z + 0.62), V(x + 0.62, 0.41, z - 0.62), V(x - 0.62, 0.41, z - 0.62), { tile: 1.5, color: [0.55, 0.45, 0.35] });
    }
    stall(-9.2, -13.6, Math.PI * 0.5, { goods: 'fruit' }); stall(-12.6, 14.6, Math.PI, { goods: 'pots' });
    B.propSolid('bench_table', -14.5, 0, 5.2, 0.2, 1, 'wood'); B.prop('chair', -13.2, 0, 6.3, 2.2); B.prop('chair', -15.6, 0, 6.5, 0.7); B.prop('stool', -14.2, 0, 3.9, 0);
    sandbags(-9.2, -2.9, 2.9, 4, 0.5); crates(-15.6, -1.0, 0.2, 2);
  }
  // tall palms behind the skyline
  palm(-38, 30, 12.5, 1.2); palm(38.5, -22, 13.5, 1.0); palm(-12, 71, 12, 0.9); palm(20, -72, 12.8, 1.1);

  // =========================================== covered market lane =========================================================
  let lastW = -99;
  for (const a of stalls.sort((p, q) => p.p.z - q.p.z)) {
    const z = a.p.z, ph = (((z + 52) % 6.5) + 6.5) % 6.5;
    if (Math.abs(Math.abs(z) - 20) < 4.8 || Math.abs(z) > 54 || Math.abs(z) < 4.5 || Math.abs(ph - 3.25) > 1.4 || z - lastW < 5.5) continue;
    stall(a.p.x + 0.95, z, Math.PI / 2, {}); lastW = z;
  }
  for (let z = -52; z <= 52; z += 6.5) {
    if (Math.abs(Math.abs(z) - 20) < 5 || Math.abs(z) < 4) continue;
    const blocked = anchors.some(a => (a.kind === 'shop' || a.kind === 'door') && a.street === 'market' && a.N.x < 0 && Math.abs(a.p.z - z) < 2.6);
    B.mute = inGate(z, 1.9);                                                   // not in front of a passage through the ring
    if (!blocked) stall(30.05, z + rnd.range(-0.4, 0.4), -Math.PI / 2, {});
    B.mute = false;
  }
  for (let z = -54, k = 0; z <= 54; z += rnd.range(6.2, 8.4), k++) {       // shade cloths strung between the buildings
    if (Math.abs(Math.abs(z) - 20) < 5.2) continue;
    const len = rnd.range(4.2, 5.6), y0 = rnd.range(4.3, 5.0), y1 = y0 + rnd.range(-0.5, 0.5), key = rnd.pick(['cloth_plain', 'cloth_plain', 'cloth_plain', 'cloth_red', 'cloth_green']), sag = rnd.range(0.35, 0.6);
    B.mute = inGate(z, len / 2 + 0.8);                                          // (its east corners would be tied to thin air)
    const shade = (u, t) => {
      const e = Math.sin(Math.PI * u) * Math.sin(Math.PI * t), pinch = 1 - 0.12 * Math.sin(Math.PI * u);
      return { p: V(26.25 + u * 4.5, y0 + (y1 - y0) * u - sag * Math.pow(e, 0.7), z + (t - 0.5) * len * pinch), w: 0.9 * e };
    };
    const cv = K.tarpify(key, key === 'cloth_plain' ? rnd.pick(FADED) : [1, 1, 1], { us: key === 'cloth_plain' ? 4 : 2, vs: key === 'cloth_plain' ? 4 : 2 });
    sheet(cv.key, 10, 8, shade, { ...cv.o, color: cv.color });
    for (const [u, t] of [[0, 0], [0, 1], [1, 0], [1, 1]]) rod(V(26.25 + u * 4.5, y0 + (y1 - y0) * u, z + (t - 0.5) * len), V(u ? 31 : 26, y0 + (y1 - y0) * u + 0.35, z + (t - 0.5) * (len + 1.2)), 0.008, 'cable');
    B.mute = false;
  }
  sandbags(27.3, -1.2, 2.2, 4, 0.02); sandbags(29.9, 1.8, 2.0, 4, -0.03); barrier(28.6, 20.4, 0.05, true); barrier(28.2, -19.6, -0.08);

  // =========================================== alley =====================================================================
  barrier(-29.3, -20.3, 0.06, true); crates(-28.2, -41, 1.2, 2); sandbags(-29, 2.2, 2.2, 4, 0.03); crates(-29.9, 39, 0.4, 3); barrier(-28.6, 20.2, -0.05); rubble(-29.6, -33, 1.1, 0.5); rubble(-28, 49, 1.2, 0.5);
  for (let z = -52; z <= 54; z += rnd.range(7, 11)) {                   // laundry lines across the alley
    if (Math.abs(Math.abs(z) - 20) < 4) continue;
    const hb = Math.min(bAt(-31.5, z)?.H ?? 6, bAt(-26.5, z)?.H ?? 6); if (hb < 5) continue;
    const y = Math.min(rnd.range(4.6, 7.2), hb - 0.5), a = V(-31, y, z), b = V(-27, y + rnd.range(-0.3, 0.3), z + rnd.range(-0.3, 0.3)), sag = rnd.range(0.12, 0.3);
    const pts = cable(a, b, sag, 0.006);
    let u = rnd.range(0.08, 0.2);
    while (u < 0.86) {
      const w = rnd.range(0.09, 0.2), len = rnd.range(0.5, 1.1), key = rnd.pick(['cloth_plain', 'cloth_plain', 'cloth_plain', 'cloth_red', 'cloth_green']);
      const at = t => { const f = clamp01(t) * 10, i = Math.min(9, Math.floor(f)); return pts[i].clone().lerp(pts[i + 1], f - i); };
      const u0 = u;
      sheet(key, 3, 5, (s, t) => { const q = at(u0 + s * w); return { p: V(q.x, q.y - t * len, q.z + 0.01 * t), w: t * 1.0 }; }, { color: key === 'cloth_plain' ? rnd.pick(FADED) : [1, 1, 1], us: 1.2, vs: 1.6 });
      u += w + rnd.range(0.02, 0.1);
    }
  }

  // =========================================== overhead cables, bunting, poles ==========================================
  for (let z = -54; z <= 54; z += rnd.range(5, 9)) {
    const z2 = z + rnd.range(-3, 3), bw = bAt(-6.5, z), be = bAt(6.5, z2);
    if (!bw || !be) continue;
    const ya = bw.H - rnd.range(0.2, 1.4), yb = be.H - rnd.range(0.2, 1.4);
    cable(V(-6, ya, z), V(6, yb, z2), rnd.range(0.4, 0.9));
    if (rnd.chance(0.5)) cable(V(-6, ya - 0.3, z + 0.4), V(6, yb - 0.25, z2 + 0.3), rnd.range(0.5, 1.1), 0.009);
  }
  for (const sx of [-6.05, 6.05]) for (let z = -56; z < 56; z += rnd.range(9, 15)) { const zb = Math.min(56, z + rnd.range(7, 12)), b1 = bAt(sx * 1.1, z), b2 = bAt(sx * 1.1, zb); if (!b1 || !b2) continue; const y = Math.min(b1.H, b2.H) - rnd.range(0.3, 1.2); cable(V(sx, y, z), V(sx, y + rnd.range(-0.2, 0.2), zb), rnd.range(0.15, 0.4), 0.01); }
  for (const z of [-41.5, -9, 33.5]) {                                    // strings across the street: papel picado now (the old pennants still use up their draws)
    const bw = bAt(-6.5, z), be = bAt(6.5, z + 1.5); if (!bw || !be) continue;
    B.mute = true;
    const pts = cable(V(-6, bw.H - 0.5, z), V(6, be.H - 0.7, z + 1.5), 0.55, 0.005);
    for (let i = 1; i < 30; i++) {
      const f = (i / 30) * 10, k = Math.min(9, Math.floor(f)), q = pts[k].clone().lerp(pts[k + 1], f - k), col = FADED[(i * 3) % FADED.length];
      sheet('cloth_plain', 1, 2, (s, t) => ({ p: V(q.x + (s - 0.5) * 0.26 * (1 - t * 0.85), q.y - t * 0.36, q.z), w: t * 0.9 }), { color: col, us: 0.6, vs: 0.6 });
    }
    B.mute = false;
    K.papel(V(-6, bw.H - 0.5, z), V(6, be.H - 0.7, z + 1.5), 0.55);
  }
  if (ctx.rs) {                                                              // (style stream) more papel picado over the main street and the cross streets, signs on the shops
    for (const z of [-52, -27, -3, 26, 46]) { const bw = bAt(-6.5, z), be = bAt(6.5, z); if (bw && be) K.papel(V(-6, Math.min(bw.H, be.H) - ctx.rs.range(0.6, 1.4), z), V(6, Math.min(bw.H, be.H) - ctx.rs.range(0.6, 1.4), z + ctx.rs.range(-1.5, 1.5)), ctx.rs.range(0.5, 0.9)); }
    for (const zc of [-20, 20]) for (let x = -24; x <= 24; x += ctx.rs.range(6, 9)) { if (Math.abs(x) < 7) continue; const bs = bAt(x, zc - 3.5), bn = bAt(x, zc + 3.5); if (bs && bn) K.papel(V(x, Math.min(bs.H, 6.5) - 0.6, zc - 3), V(x + ctx.rs.range(-1, 1), Math.min(bn.H, 6.5) - 0.6, zc + 3), ctx.rs.range(0.5, 0.8)); }
    K.signs(anchors, { shop: 0.9, shutter: 0.45, door: 0.22 });
  }
  for (const [x, z] of [[-26.6, -19.2], [25.6, 19.4], [-5.2, -58.2], [5.3, 58.3], [-31.4, 21.4]]) {    // utility poles
    rod(V(x, 0, z), V(x, 8.6, z), 0.11, 'planks', [0.45, 0.4, 0.35]); B.collide(x, 4.3, z, 0.26, 8.6, 0.26, 0, 'wood');
    B.box('planks', x, 8.0, z, 1.7, 0.1, 0.1, { rot: 0.3, tile: 1, color: [0.45, 0.4, 0.35] }); B.box('metal_white', x + 0.2, 6.6, z, 0.4, 0.6, 0.35, { tile: 1 });
    for (let i = 0; i < 4; i++) cable(V(x + rnd.range(-0.7, 0.7), 8.05, z), wallNear(x, z, i), rnd.range(0.3, 0.8));
  }

  // =========================================== scatter: weeds, pebbles, litter ==========================================
  const edgePoint = out => {                                                    // (picks among all buildings, ghosts too, so the draws stay the same; what lands on a ghost is muted)
    for (let tries = 0; tries < 20; tries++) {
      const b = rnd.pick(ctx.buildings), s = rnd.pick([...b.sides]);
      if (!b.street[s] || b.street[s] === 'none') continue;
      B.mute = b.ghost;
      const t = rnd(), gy = b.street[s] === 'main' ? SIDEWALK : 0;
      if (s === 'e') return V(b.x1 + out, gy, b.z0 + t * (b.z1 - b.z0)); if (s === 'w') return V(b.x0 - out, gy, b.z0 + t * (b.z1 - b.z0));
      if (s === 'n') return V(b.x0 + t * (b.x1 - b.x0), gy, b.z1 + out); return V(b.x0 + t * (b.x1 - b.x0), gy, b.z0 - out);
    }
    return V(0, 0, 0);
  };
  for (let i = 0; i < 34; i++) { B.mute = false; const p = edgePoint(rnd.range(0.05, 0.3)); B.prop(rnd.pick(['weed_a', 'weed_b', 'weed_b', 'weed_c', 'weed_c']), p.x, p.y - 0.01, p.z, rnd() * 6.28, rnd.range(1.3, 2.6)); }
  for (let i = 0; i < 20; i++) { B.mute = false; const p = edgePoint(rnd.range(0.15, 0.45)); B.prop(rnd.pick(['bush_a', 'bush_b', 'bush_c']), p.x, p.y - 0.02, p.z, rnd() * 6.28, rnd.range(0.8, 1.5)); }
  B.mute = false;
  for (const [x, z, s] of [[-17.6, 16.2, 1.0], [-7.2, -16.2, 0.8], [-30.6, -57.6, 1.0], [30.4, 57.4, 0.9], [-26.2, 57.6, 0.8], [5.2, -62.6, 0.7], [-45, 0, 1.2]]) B.prop(rnd.pick(['shrub_a', 'shrub_b', 'shrub_c', 'shrub_d']), x, 0, z, rnd() * 6.28, s);
  const peb = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 320; i++) {
    B.mute = false;
    const p = rnd.chance(0.7) ? edgePoint(rnd.range(0.05, 0.9)) : V(rnd.range(-31, 31), 0, rnd.range(-63, 63)), s = rnd.range(0.025, 0.1), g = rnd.range(0.55, 0.95);
    B.geom(rnd.pick(['concrete', 'concrete', 'w_brick']), peb, mat4(V(p.x, p.y + s * 0.3, p.z), rnd() * 6.28, V(s * rnd.range(0.8, 2), s * rnd.range(0.4, 0.9), s), rnd.range(-0.5, 0.5), rnd.range(-0.5, 0.5)), { uvScale: 0.2, color: [g, g * 0.97, g * 0.92] });
  }
  for (let i = 0; i < 70; i++) {
    B.mute = false;
    const p = rnd.chance(0.6) ? edgePoint(rnd.range(0.2, 1.4)) : V(rnd.range(-30, 30), 0, rnd.range(-62, 62)), a = rnd() * 6.28, w = rnd.range(0.1, 0.16), h = rnd.range(0.14, 0.22), g = rnd.range(0.6, 0.92), y = p.y + 0.006 + i * 0.00004;
    const c = Math.cos(a), s = Math.sin(a), q = (lx, lz) => V(p.x + lx * c + lz * s, y, p.z - lx * s + lz * c);
    B.quad('matte', q(-w, h), q(w, h), q(w, -h), q(-w, -h), { color: rnd.chance(0.7) ? [g, g * 0.98, g * 0.9] : [g * 0.75, g * 0.6, g * 0.42] });
  }
  B.mute = false;
  return K;
}

const clamp01 = v => Math.min(0.9999, Math.max(0, v));
