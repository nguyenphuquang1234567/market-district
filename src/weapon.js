// Procedural M4-pattern carbine with a tube red-dot, gloved hands, and all first-person weapon animation.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from './assets.js';
import { canvasTexture, rng, clamp, lerp, damp, smooth } from './util.js';
import { cap, field, polygonise } from './sdf.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const MUZZLE = V(0, -0.070, -0.552);
export const EJECT = V(0.02, -0.078, -0.05);

// ---- materials -------------------------------------------------------------------------------------------------------
function grunge() {
  const R = rng(77);
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 110 + R() * 90 | 0; g.fillStyle = `rgba(${v},${v},${v},0.16)`; g.beginPath(); g.arc(R() * w, R() * h, 1 + R() * 9, 0, 6.3); g.fill(); }
    for (let i = 0; i < 180; i++) {            // handling scratches (smoother = darker in the roughness channel)
      const x = R() * w, y = R() * h, a = R() * 6.3, l = 6 + R() * 50; g.strokeStyle = `rgba(60,60,60,${0.15 + R() * 0.35})`; g.lineWidth = 0.5 + R();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 26; i++) {             // greasy smudges
      const x = R() * w, y = R() * h, r = 18 + R() * 46, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(70,70,70,0.28)'); gr.addColorStop(1, 'rgba(70,70,70,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function camo() {
  const R = rng(202);
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#8a8266'; g.fillRect(0, 0, w, h);
    const blobs = (n, col, r0, r1) => { g.fillStyle = col; for (let i = 0; i < n; i++) { const x = R() * w, y = R() * h; g.beginPath(); for (let k = 0; k <= 9; k++) { const a = (k / 9) * 6.283, r = r0 + R() * (r1 - r0); g.lineTo(x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 0.8); } g.fill(); } };
    blobs(46, '#6d6a4c', 20, 52); blobs(38, '#a59a78', 14, 40); blobs(30, '#54503a', 10, 30); blobs(26, '#b8ae8e', 6, 18); blobs(18, '#3f3d2e', 5, 14);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function wearMap() {            // mostly neutral; bright hairline scratches and dusty specks read as handling wear
  const R = rng(303);
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { const v = 150 + R() * 70 | 0; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(R() * w, R() * h, 2 + R() * 10, 2 + R() * 10); }
    for (let i = 0; i < 130; i++) { const x = R() * w, y = R() * h, a = R() * 6.3, l = 4 + R() * 34; g.strokeStyle = `rgba(255,255,255,${0.25 + R() * 0.5})`; g.lineWidth = 0.4 + R() * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(214,196,160,${0.1 + R() * 0.25})`; g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

// Tangent-space normal map from a drawn height field (white = high).
function heightToNormal(size, draw, strength = 2) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size);
  const src = g.getImageData(0, 0, size, size), out = g.createImageData(size, size), H = (x, y) => src.data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), o = (y * size + x) * 4;
    out.data[o] = (-dx / l * 0.5 + 0.5) * 255; out.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const microNormal = kind => {
  const R = rng(kind.length * 51 + 3);
  return heightToNormal(256, (g, n) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
    if (kind === 'blast') for (let i = 0; i < 9000; i++) { const v = 96 + R() * 64 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(R() * n, R() * n, 1 + R() * 1.6, 1 + R() * 1.6); }
    else if (kind === 'stipple') for (let y = 0; y < n; y += 6) for (let x = (y / 6 % 2) * 3; x < n; x += 6) { g.fillStyle = '#d0d0d0'; g.beginPath(); g.arc(x + R(), y + R(), 1.9, 0, 6.3); g.fill(); }
    else for (let i = 0; i < 1400; i++) { const v = 100 + R() * 56 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(R() * n, R() * n, 20 + R() * 90, 1); }
  }, kind === 'stipple' ? 2.6 : 1.6);
};
// Shader patch for the weapon: bright bare metal where the surface curves sharply (handled edges), pale dust on
// upward faces. Curvature comes from screen-space derivatives of the smooth bevel normals, so no baking is needed.
function worn(m, wear = 1, dust = 1, bare = '0.60, 0.60, 0.62') {
  m.userData.patchKey = `gun${wear}_${dust}_${bare}`;
  m.userData.patch = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nfloat gunWear = 0.0; float gunDust = 0.0;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 gn = normalize(vNormal), px = dFdx(vViewPosition), py = dFdy(vViewPosition);
          float curv = -(dot(dFdx(gn), px) + dot(dFdy(gn), py)) / max(dot(px, px) + dot(py, py), 1e-10);
          float near = 1.0 - smoothstep(1.2, 3.0, length(vViewPosition));
          float nz = texture2D(tCloud, vMapUv * 0.9).r * 0.6 + texture2D(tCloud, vMapUv * 3.7).g * 0.4;
          gunWear = smoothstep(260.0, 900.0, curv) * smoothstep(0.46, 0.70, nz) * near * ${(wear * 0.75).toFixed(2)};
          float up = inverseTransformDirection(gn, viewMatrix).y;
          gunDust = smoothstep(0.45, 0.98, up) * smoothstep(0.40, 0.96, texture2D(tCloud, vMapUv * 6.3 + 0.31).b * 0.6 + texture2D(tCloud, vMapUv * 23.0).r * 0.4) * near * ${dust.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${bare}), gunWear);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.26, 0.20), gunDust * 0.17);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.32, gunWear), 0.96, gunDust * 0.4);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(mix(metalnessFactor, 1.0, gunWear), 0.0, gunDust * 0.1);');
  };
  return m;
}

// Glove fabric: scuffed weave with sparse stitched seams (tiles every ~8 cm through the box projection).
function gloveMap() {
  const R = rng(515);
  const t = canvasTexture(256, 256, (g, n) => {
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) { const v = 190 + R() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(R() * n, R() * n, 1 + R() * 3, 1 + R() * 3); }
    for (let i = 0; i < 26; i++) { const x = R() * n, y = R() * n, r = 10 + R() * 30, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,112,100,0.22)'); gr.addColorStop(1, 'rgba(120,112,100,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    const seam = (x0, y0, x1, y1) => {
      g.strokeStyle = 'rgba(70,66,60,0.75)'; g.lineWidth = 3; g.setLineDash([]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(250,246,236,0.9)'; g.lineWidth = 1.3; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x0 + 3, y0 + 3); g.lineTo(x1 + 3, y1 + 3); g.stroke();
    };
    seam(0, 70, n, 70); seam(180, 0, 180, n);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t;
}

export function gunMaterials() {
  const gr = grunge(), wear = wearMap(), jersey = assets.tex.cotton_jersey, hess = assets.tex.hessian_230;
  const nBlast = microNormal('blast'), nStipple = microNormal('stipple'), nBrush = microNormal('brush'), ns = v => new THREE.Vector2(v, v);
  const std = o => new THREE.MeshStandardMaterial(o);
  const cloth = (t, color, rep) => {
    const m = std({ map: t.diff.clone(), normalMap: t.nor.clone(), color, roughness: 0.93 });
    for (const k of ['map', 'normalMap']) { m[k].repeat.set(rep, rep); m[k].needsUpdate = true; }
    return m;
  };
  return {
    anod: worn(std({ color: 0x35363a, map: wear, metalness: 0.74, roughness: 0.58, roughnessMap: gr, normalMap: nBlast, normalScale: ns(0.14) })),
    steel: worn(std({ color: 0x47484b, map: wear, metalness: 0.92, roughness: 0.5, roughnessMap: gr, normalMap: nBrush, normalScale: ns(0.16) }), 1, 0.8, '0.66, 0.66, 0.68'),
    polymer: worn(std({ color: 0x232326, map: wear, metalness: 0.0, roughness: 0.74, roughnessMap: gr, normalMap: nStipple, normalScale: ns(0.4) }), 0.35, 1, '0.20, 0.20, 0.21'),
    fde: worn(std({ color: 0x9a8562, map: wear, metalness: 0.5, roughness: 0.56, roughnessMap: gr, normalMap: nBlast, normalScale: ns(0.14) }), 1, 0.7, '0.66, 0.64, 0.6'),
    rubber: std({ color: 0x0b0b0c, metalness: 0, roughness: 0.96 }),
    bare: std({ color: 0x9a9c9f, metalness: 1, roughness: 0.42, roughnessMap: gr }),
    brass: std({ color: 0xb8923e, metalness: 1, roughness: 0.34 }),
    slot: new THREE.MeshBasicMaterial({ color: 0x020202 }),
    glove: (() => { const m = cloth(jersey, 0xffffff, 5); m.map = gloveMap(); m.vertexColors = true; m.normalScale.set(2.2, 2.2); m.roughness = 0.9; return m; })(), sleeve: (() => { const m = std({ map: camo(), normalMap: hess.nor.clone(), roughness: 0.92 }); m.map.repeat.set(1.6, 2.2); m.normalMap.repeat.set(9, 9); m.normalMap.needsUpdate = true; m.normalScale.set(1.6, 1.6); return m; })(),
    lensFront: std({ color: 0x3a2a26, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.1, envMapIntensity: 1.6, depthWrite: false }),
  };
}

// box-projected UVs in object space so roughness detail has the same scale on every part
export function projUV(g, k = 9) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) { uv[i * 2] = p.getZ(i) * k; uv[i * 2 + 1] = p.getY(i) * k; }
    else if (ay >= az) { uv[i * 2] = p.getX(i) * k; uv[i * 2 + 1] = p.getZ(i) * k; }
    else { uv[i * 2] = p.getX(i) * k; uv[i * 2 + 1] = p.getY(i) * k; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---- geometry helpers (zf = metres forward of the optic's rear lens; world forward is -Z) --------------------------------
function prof(pts, width, bevel = 0.0012) {
  const s = new THREE.Shape(pts.map(([zf, y]) => new THREE.Vector2(zf, y)));
  const d = Math.max(0.0005, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -d / 2); g.rotateY(Math.PI / 2);
  return g;
}
const rbox = (w, h, d, x, y, zf, r = 0.0012, rot) => { const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)); if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot))); g.translate(x, y, -zf); return g; };
const cylZ = (r, len, zf0, y = 0, x = 0, seg = 24, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, -(zf0 + len / 2)); return g; };
const cylX = (r, len, x0, y, zf, seg = 16) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x0 + len / 2, y, -zf); return g; };
const cylY = (r, len, x, y0, zf, seg = 16) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.translate(x, y0 + len / 2, -zf); return g; };
const BORE = -0.070;

function buildGun(lod = false) {
  const P = { anod: [], steel: [], polymer: [], rubber: [], bare: [], slot: [], brass: [], fde: [] };
  // receivers
  P.anod.push(prof([[-0.072, -0.097], [0.128, -0.097], [0.128, -0.051], [0.118, -0.0465], [-0.060, -0.0465], [-0.072, -0.056]], 0.036));
  P.anod.push(prof([[-0.092, -0.050], [-0.072, -0.050], [-0.072, -0.097], [0.128, -0.097], [0.128, -0.112], [0.110, -0.148], [0.040, -0.148], [0.034, -0.126], [-0.018, -0.126], [-0.050, -0.130], [-0.092, -0.108]], 0.031));
  P.anod.push(rbox(0.0355, 0.012, 0.074, 0, -0.1435, 0.075, 0.003));                                   // magwell flare
  P.polymer.push(prof([[-0.020, -0.126], [-0.062, -0.126], [-0.072, -0.142], [-0.100, -0.224], [-0.060, -0.232], [-0.038, -0.160], [-0.022, -0.150]], 0.03, 0.0055));
  P.anod.push(rbox(0.012, 0.0038, 0.060, 0, -0.158, 0.008, 0.0015), rbox(0.012, 0.014, 0.004, 0, -0.152, 0.037, 0.0015, [0.35, 0, 0]));   // trigger guard
  P.steel.push(prof([[0.003, -0.126], [0.011, -0.126], [0.0125, -0.140], [0.006, -0.151], [0.003, -0.150], [0.007, -0.139]], 0.006, 0.0008));
  // buffer tube + stock
  P.anod.push(cylZ(0.0145, 0.19, -0.282, BORE), rbox(0.031, 0.042, 0.004, 0, -0.072, -0.094, 0.002));
  P.steel.push(cylZ(0.0188, 0.012, -0.110, BORE, 0, 20));
  P.polymer.push(prof([[-0.135, -0.050], [-0.280, -0.046], [-0.300, -0.056], [-0.300, -0.185], [-0.288, -0.192], [-0.245, -0.125], [-0.135, -0.092]], 0.04, 0.005));
  P.rubber.push(rbox(0.042, 0.14, 0.012, 0, -0.12, -0.306, 0.004));
  // handguard: octagonal free-float tube with M-LOK slots, full-length top rail
  { const g = new THREE.CylinderGeometry(0.0254, 0.0254, 0.326, 8, 1); g.rotateY(Math.PI / 8); g.rotateX(Math.PI / 2); g.translate(0, BORE, -(0.128 + 0.163)); const f = g.toNonIndexed(); f.computeVertexNormals(); P.anod.push(f); }
  P.steel.push(cylZ(0.0262, 0.013, 0.126, BORE, 0, 28));
  for (const ang of [0, Math.PI, Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4, -Math.PI / 2]) for (let i = 0; i < (lod ? 0 : 5); i++) {
    const g = new THREE.BoxGeometry(0.0018, 0.0075, 0.034); g.translate(0.0228, 0, 0); g.rotateZ(ang); g.translate(0, BORE, -(0.168 + i * 0.058)); P.slot.push(g);
  }
  P.anod.push(rbox(0.0156, 0.0042, 0.528, 0, -0.0448, 0.195, 0.001));
  if (!lod) for (let i = 0; i < 53; i++) P.anod.push(rbox(0.0212, 0.0058, 0.0052, 0, -0.0429, -0.066 + i * 0.01, 0.0009));
  else P.anod.push(rbox(0.0212, 0.0058, 0.528, 0, -0.0429, 0.195, 0.0007));
  // barrel + muzzle device
  P.steel.push(cylZ(0.0087, 0.376, 0.128, BORE), cylZ(0.0118, 0.003, 0.4985, BORE), cylZ(0.0108, 0.046, 0.502, BORE, 0, 20, 0.0098));
  for (let i = 0; i < (lod ? 0 : 5); i++) { const g = new THREE.BoxGeometry(0.0026, 0.003, 0.026); g.translate(0, 0.0098, 0); g.rotateZ((i - 2) * 1.05); g.translate(0, BORE, -0.527); P.slot.push(g); }
  { const g = new THREE.CircleGeometry(0.0046, 12); g.translate(0, BORE, -0.5484); g.rotateY(0); const q = g.clone(); q.rotateY(Math.PI); q.translate(0, 0, -2 * 0.5484); P.slot.push(q); }
  // controls and small parts
  P.anod.push(rbox(0.052, 0.009, 0.014, 0, -0.0535, -0.079, 0.002), rbox(0.013, 0.008, 0.021, -0.0225, -0.0535, -0.074, 0.002));          // charging handle + latch
  P.anod.push(cylZ(0.0075, 0.03, -0.066, -0.072, 0.0205, 14), rbox(0.009, 0.016, 0.018, 0.0205, -0.076, 0.004, 0.003, [0, 0, 0]));        // forward assist, deflector
  P.steel.push(cylZ(0.0088, 0.006, -0.072, -0.072, 0.0205, 14));
  P.slot.push(rbox(0.0012, 0.021, 0.062, 0.0181, -0.078, 0.052, 0.0004));                                                                // ejection port
  P.anod.push(rbox(0.0026, 0.021, 0.063, 0.0215, -0.1005, 0.052, 0.001, [0, 0, -0.22]));                                                 // dust cover, open
  P.steel.push(cylX(0.0042, 0.034, -0.017, -0.105, -0.058), cylX(0.0042, 0.034, -0.017, -0.103, 0.118));                                 // takedown / pivot pins
  P.steel.push(cylX(0.0062, 0.0032, -0.0187, -0.108, -0.036), rbox(0.003, 0.005, 0.02, -0.0185, -0.108, -0.027, 0.001));                 // selector
  P.steel.push(rbox(0.004, 0.024, 0.012, -0.0175, -0.086, 0.03, 0.0015), cylX(0.005, 0.004, 0.0155, -0.112, 0.036));                     // bolt catch, mag release
  P.anod.push(rbox(0.03, 0.009, 0.046, 0, -0.0355, -0.046, 0.002), rbox(0.028, 0.009, 0.04, 0, -0.0355, 0.43, 0.002));                   // folded back-up sights
  if (!lod) for (const sx of [-1, 1]) for (const zf of [0.142, 0.158]) P.steel.push(cylX(0.0026, 0.002, sx > 0 ? 0.0228 : -0.0248, -0.082, zf, 8));
  {   // weapon light at ten o'clock with a tape switch
    const lx = -0.0292, ly = BORE + 0.0292;
    P.fde.push(cylZ(0.0118, 0.072, 0.328, ly, lx, 24), cylZ(0.0148, 0.027, 0.399, ly, lx, 28, 0.0138), cylZ(0.0128, 0.006, 0.322, ly, lx, 20));
    P.anod.push(rbox(0.012, 0.012, 0.03, -0.0205, BORE + 0.0205, 0.352, 0.002, [0, 0, -Math.PI / 4]), cylZ(0.0152, 0.004, 0.396, ly, lx, 28));
    P.rubber.push(cylZ(0.0085, 0.006, 0.3165, ly, lx, 16), rbox(0.0045, 0.013, 0.062, -0.0258, BORE + 0.0005, 0.225, 0.0015));
    if (!lod) { const g = new THREE.CircleGeometry(0.0122, 20); g.rotateY(Math.PI); g.translate(lx, ly, -0.4262); P.slot.push(g); const r = new THREE.RingGeometry(0.0122, 0.0138, 24); r.rotateY(Math.PI); r.translate(lx, ly, -0.4264); P.bare.push(r); }
  }
  // optic: compact tube red dot on a riser mount
  {
    const pr = [[0.0122, 0], [0.0168, 0.0008], [0.0172, 0.010], [0.0152, 0.012], [0.0152, 0.054], [0.0172, 0.056], [0.0168, 0.0652], [0.0122, 0.066], [0.0122, 0]].map(([r, z]) => new THREE.Vector2(r, z));
    for (let i = 0; i < pr.length - 1; i++) { const g = new THREE.LatheGeometry([pr[i], pr[i + 1]], 40); g.rotateX(-Math.PI / 2); (i === pr.length - 2 ? P.slot : P.anod).push(g); }   // last band = blackened bore
    P.anod.push(cylY(0.0078, 0.008, 0, 0.0146, 0.033), cylX(0.0078, 0.008, 0.0146, 0, 0.033), cylX(0.0105, 0.011, 0.0146, -0.004, 0.049, 20));
    P.steel.push(cylY(0.0056, 0.0018, 0, 0.0226, 0.033), cylX(0.0056, 0.0018, 0.0226, 0, 0.033), cylX(0.0085, 0.0018, 0.0256, -0.004, 0.049, 20));
    P.anod.push(rbox(0.03, 0.023, 0.05, 0, -0.0275, 0.033, 0.003), rbox(0.009, 0.013, 0.046, -0.0175, -0.036, 0.033, 0.002));
    P.steel.push(cylX(0.0072, 0.011, -0.033, -0.036, 0.033, 14));
  }
  const out = {};
  for (const [k, list] of Object.entries(P)) {
    if (!list.length) continue;
    const gs = list.map(g => { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (a !== 'position' && a !== 'normal') q.deleteAttribute(a); return q; });
    out[k] = projUV(mergeGeometries(gs));
  }
  return out;
}

function buildMag() {
  const body = prof([[0.043, -0.128], [0.101, -0.128], [0.106, -0.200], [0.124, -0.292], [0.066, -0.303], [0.050, -0.210]], 0.0225, 0.002);
  const base = rbox(0.0275, 0.011, 0.066, 0, -0.3005, 0.0955, 0.003, [0.19, 0, 0]);
  const ribs = [];
  for (const sx of [-1, 1]) for (const dz of [-0.012, 0.006]) ribs.push(rbox(0.0012, 0.13, 0.005, sx * 0.0115, -0.215, 0.083 + dz, 0.0005, [0.17, 0, 0]));
  const strip = g => { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (a !== 'position' && a !== 'normal') q.deleteAttribute(a); return q; };
  return { body: projUV(mergeGeometries([body, base, ...ribs].map(strip))), round: projUV(strip(cylZ(0.0046, 0.042, 0.05, -0.1235, 0, 10))) };
}

// ---- hands ---------------------------------------------------------------------------------------------------------------
// Gloved hand as one smooth distance-field surface. Hand-local frame: +Y towards the fingertips, +Z out of the palm,
// thumb on +X (side = 1) or -X (side = -1). curls = per-finger joint bends (radians), thumbPts = thumb joint positions.
export function buildHand(side, curls, thumbPts, indexYaw = 0, wd = [0, -1, 0]) {      // wd = direction from the wrist to the elbow
  const S = side, fabric = [], palm = [], rubber = [], strap = [];
  const wp = (x, s) => [S * x + wd[0] * s, wd[1] * s + (s ? 0 : 0.004), wd[2] * s];
  fabric.push(cap(wp(-0.008, 0), wp(-0.008, 0.058), 0.0245, 0.0235), cap(wp(0.009, 0), wp(0.009, 0.058), 0.0245, 0.0235));   // wrist
  strap.push(cap(wp(-0.009, 0.02), wp(-0.009, 0.036), 0.0262), cap(wp(0.01, 0.02), wp(0.01, 0.036), 0.0262));                // cuff strap
  const xs = [0.031, 0.0105, -0.0105, -0.030], lens = [0.072, 0.08, 0.074, 0.058], seg = [0.44, 0.31, 0.25];
  for (let f = 0; f < 4; f++) {
    const kx = S * xs[f];
    fabric.push(cap([kx * 0.55, 0.004, -0.001], [kx, 0.096, -0.001], 0.0148, 0.0122));       // back of the hand, one ridge per metacarpal
    palm.push(cap([kx * 0.6, 0.014, 0.0065], [kx, 0.088, 0.0055], 0.0118, 0.0102));            // palm pad
    let p = [kx, 0.098, 0], th = 0; const yaw = f === 0 ? indexYaw * S : 0, r0 = 0.0098 - (f === 3 ? 0.0012 : 0);
    for (let j = 0; j < 3; j++) {
      th += curls[f][j];
      const d = [Math.sin(yaw) * Math.cos(th), Math.cos(yaw) * Math.cos(th), Math.sin(th)], L = lens[f] * seg[j], q = [p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L];
      fabric.push(cap(p, q, r0 - j * 0.0007, r0 - (j + 1) * 0.0007 - (j === 2 ? 0.0008 : 0)));
      if (j < 2) {             // moulded guard on the back of the first two finger bones
        const bk = [0, Math.sin(th) * 0.0048, -Math.cos(th) * 0.0048], a0 = 0.18, a1 = 0.8;
        rubber.push(cap([p[0] + (q[0] - p[0]) * a0 + bk[0], p[1] + (q[1] - p[1]) * a0 + bk[1], p[2] + (q[2] - p[2]) * a0 + bk[2]], [p[0] + (q[0] - p[0]) * a1 + bk[0], p[1] + (q[1] - p[1]) * a1 + bk[1], p[2] + (q[2] - p[2]) * a1 + bk[2]], 0.0058 - j * 0.0006));
      }
      p = q;
    }
  }
  rubber.push(cap([S * xs[3] * 0.92, 0.0935, -0.0118], [S * xs[0] * 0.96, 0.0985, -0.0118], 0.0076));                                  // knuckle guard
  rubber.push(cap([S * -0.012, 0.038, -0.0125], [S * -0.012, 0.068, -0.0125], 0.0052), cap([S * 0.008, 0.036, -0.0125], [S * 0.008, 0.07, -0.0125], 0.0052));
  palm.push(cap([S * 0.02, 0.012, 0.007], [S * 0.033, 0.05, 0.012], 0.0165, 0.014), cap([S * -0.026, 0.012, 0.006], [S * -0.03, 0.06, 0.008], 0.013));   // thenar / heel
  const tp = thumbPts.map(([x, y, z]) => [S * x, y, z]);
  fabric.push(cap([S * 0.024, 0.012, 0.005], tp[0], 0.0148, 0.0122), cap(tp[0], tp[1], 0.0118, 0.0106), cap(tp[1], tp[2], 0.0106, 0.0088));
  rubber.push(cap([tp[0][0] + S * 0.004, tp[0][1], tp[0][2] - 0.004], [tp[1][0] + S * 0.004, tp[1][1], tp[1][2] - 0.004], 0.0064));
  const f = field([
    { parts: fabric, k: 0.0075, color: [0.175, 0.145, 0.098] }, { parts: palm, k: 0.008, color: [0.095, 0.08, 0.06] },
    { parts: rubber, k: 0.0022, color: [0.055, 0.055, 0.06], bias: 0.0007 }, { parts: strap, k: 0.004, color: [0.14, 0.14, 0.13], bias: 0.0005 },
  ], 0.0035);
  let lo = [-0.066, -0.084, -0.04], hi = [0.066, 0.19, 0.125];
  for (const q of [...tp, wp(-0.009, 0.06), wp(0.01, 0.06)]) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], q[c] - (q[1] < 0 ? 0.03 : 0.02)); hi[c] = Math.max(hi[c], q[c] + (q[1] < 0 ? 0.03 : 0.02)); }
  return projUV(polygonise(f, lo, hi, 0.0025), 6);
}
// Jacket sleeve: tapered tube with bunched folds, wrist end at y = 0, running down -Y to the elbow.
export function sleeveGeom(len = 0.36) {
  const g = new THREE.CylinderGeometry(0.0315, 0.049, len, 30, 34, false), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), t = (len / 2 - y) / len;      // t = 0 at the wrist
    const bunch = Math.exp(-t * 7), fold = Math.sin(y * 78 + Math.sin(a * 2 + y * 11) * 2.2) * (0.028 + 0.05 * bunch) + Math.sin(a * 3 + y * 21 + 1.3) * 0.03 + Math.sin(a * 7 - y * 44) * 0.012;
    const k = 1 + fold * (Math.hypot(x, z) > 0.005 ? 1 : 0);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.translate(0, -len / 2, 0); g.computeVertexNormals();
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.8);
  return g;
}
export const basis = (X, Y, Z, O) => new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(O);

// ---- red-dot lens: a collimated reticle (stays on the bore line as the eye moves) with tint, edge shading and smudges ------
function reticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uBright: { value: 1 }, uSeed: { value: 0 } },
    vertexShader: `varying vec3 vP; varying vec3 vCam; varying vec2 vUv;
      void main(){ vP = position; vUv = uv; vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vP; varying vec3 vCam; varying vec2 vUv; uniform float uBright;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main(){
        vec3 ray = normalize(vP - vCam);
        vec2 off = ray.xy / max(1e-4, -ray.z);                    // angular offset from the optical axis
        float r = length(off);
        float dot_ = smoothstep(0.0021, 0.0009, r), halo = exp(-r * 260.0) * 0.16;
        float edge = smoothstep(0.55, 1.0, length(vUv - 0.5) * 2.0);
        float smudge = (h(floor(vUv * 26.0)) * 0.5 + h(floor(vUv * 7.0)) * 0.5) * 0.025 + 0.012;
        vec3 col = vec3(1.0, 0.07, 0.03) * (dot_ * 14.0 + halo * 3.0) * uBright + vec3(0.55, 0.62, 0.66) * smudge;
        float a = clamp(dot_ + halo + smudge + edge * 0.35, 0.0, 1.0);
        gl_FragColor = vec4(mix(col, vec3(0.01, 0.015, 0.02), edge * 0.6 * (1.0 - dot_)), a);
      }`,
  });
}

function flashTexture() {
  const R = rng(9);
  return canvasTexture(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283 + R() * 0.5, len = 60 + R() * 62, wd = 10 + R() * 16;
      g.save(); g.translate(128, 128); g.rotate(a);
      const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.35, 'rgba(255,170,70,0.55)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -wd / 2); g.quadraticCurveTo(len * 0.6, -wd * 0.3, len, 0); g.quadraticCurveTo(len * 0.6, wd * 0.3, 0, wd / 2); g.fill(); g.restore();
    }
    const c = g.createRadialGradient(128, 128, 0, 128, 128, 46); c.addColorStop(0, 'rgba(255,255,245,1)'); c.addColorStop(0.4, 'rgba(255,210,130,0.7)'); c.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = c; g.fillRect(0, 0, w, w);
  });
}

// Low-detail world model shared by the bots.
let worldGun = null;
export const BOT_RELOAD_DURATION = 2.4;
export const BOT_MAG_OUT = 0.48;
export const BOT_MAG_IN = 1.37;

export function botReloadPose(remaining) {
  const elapsed = BOT_RELOAD_DURATION - remaining;
  const ease = (start, end) => smooth(clamp((elapsed - start) / (end - start), 0, 1));
  return {
    grip: ease(0.10, 0.40) * (1 - ease(1.50, 1.86)),
    magY: -0.18 * ease(0.42, 0.64) * (1 - ease(1.08, BOT_MAG_IN)),
  };
}

export function worldGunMesh(mats) {
  if (!worldGun) worldGun = { ...buildGun(true), botMagazine: buildMag().body };
  const grp = new THREE.Group();
  for (const [part, geometry] of Object.entries(worldGun)) {
    const mesh = new THREE.Mesh(geometry, mats[part === 'botMagazine' ? 'polymer' : part]);
    mesh.name = part;
    mesh.castShadow = true;
    grp.add(mesh);
  }
  return grp;
}

const HIP = { p: V(0.102, -0.094, -0.285), r: V(0.014, 0.085, -0.075) }, ADS = { p: V(0, 0, -0.142), r: V(0, 0, 0) };
const key = (track, t) => {                       // keyframes [[t, ...values]] with smoothstep easing
  if (t <= track[0][0]) return track[0]; const n = track.length;
  if (t >= track[n - 1][0]) return track[n - 1];
  let i = 1; while (track[i][0] < t) i++;
  const a = track[i - 1], b = track[i], k = smooth((t - a[0]) / (b[0] - a[0]));
  return a.map((v, j) => (j ? lerp(v, b[j], k) : t));
};
const RELOAD = {
  gun: [[0, 0, 0, 0, 0, 0, 0], [0.24, -0.03, 0.078, 0.035, 0.38, 0.2, -0.46], [1.5, -0.03, 0.074, 0.035, 0.4, 0.2, -0.5], [1.62, -0.02, 0.06, 0.025, 0.26, 0.14, -0.36], [2.0, 0, 0, 0, 0, 0, 0]],   // x y z  rx ry rz: up into the workspace, magazine well rolled in towards the support hand
  lh: [[0, 0], [0.1, 0], [0.34, 1], [1.42, 1], [1.98, 0]],         // return to the handguard as the rifle settles
  mag: [[0, 0], [0.36, 0], [0.52, -0.2], [0.94, -0.2], [1.3, -0.016], [1.4, 0]],
};
const RELOAD_BOLT_RELEASE = 1.43;
const INSPECT = [[0, 0, 0, 0, 0, 0, 0], [0.35, -0.05, 0.025, 0.03, 0.05, 0.85, -0.45], [1.05, -0.05, 0.028, 0.03, 0.02, 0.9, -0.5], [1.5, 0.0, 0.03, 0.02, -0.25, -0.75, 0.75], [2.15, 0.0, 0.03, 0.02, -0.22, -0.8, 0.8], [2.6, 0, 0, 0, 0, 0, 0]];

export class Weapon {
  constructor(R, camera, cb) {
    this.cb = cb; this.camera = camera;
    this.M = gunMaterials();
    const M = this.M, root = this.root = new THREE.Group(), gun = this.gun = new THREE.Group();
    root.add(gun); camera.add(root);
    const mk = (g, m, parent = gun) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; parent.add(mesh); return mesh; };
    const parts = buildGun();
    for (const k of Object.keys(parts)) mk(parts[k], M[k]);
    this.mag = new THREE.Group(); gun.add(this.mag);
    const mg = buildMag(); mk(mg.body, M.polymer, this.mag); mk(mg.round, M.brass, this.mag);
    this.bolt = mk(projUV(rbox(0.0009, 0.016, 0.056, 0.0184, -0.078, 0.05, 0.0003)), M.bare);
    // optic glass
    const lens = new THREE.CircleGeometry(0.0122, 32);
    this.lensFront = mk(lens.clone().translate(0, 0, -0.060), M.lensFront); this.lensFront.castShadow = false; this.lensFront.userData.noAO = true; this.lensFront.renderOrder = 10;
    this.reticle = reticleMaterial();
    this.lensRear = mk(lens.clone().translate(0, 0, -0.004), this.reticle); this.lensRear.castShadow = false; this.lensRear.userData.noAO = true; this.lensRear.renderOrder = 11;
    // hands
    const rh = buildHand(1, [[0.2, 0.3, 0.25], [1.25, 1.35, 0.9], [1.3, 1.4, 0.95], [1.35, 1.45, 1.0]], [[0.047, 0.05, 0.012], [0.05, 0.076, 0.036], [0.044, 0.098, 0.052]], 0.42);
    const rY = V(0, -0.42, -0.908).normalize(), rZ = V(-1, 0, 0), rX = rY.clone().cross(rZ), rO = V(0.031, -0.136, 0.108);
    const rhG = new THREE.Group(); rhG.applyMatrix4(basis(rX, rY, rZ, rO)); gun.add(rhG);
    mk(rh, M.glove, rhG);
    const arm = (wrist, elbow, parent) => { const d = elbow.clone().sub(wrist).normalize(), s = mk(sleeveGeom(), M.sleeve, parent); s.position.copy(wrist).addScaledVector(d, 0.012); s.quaternion.setFromUnitVectors(V(0, -1, 0), d); };
    arm(rO, V(0.15, -0.31, 0.40), gun);
    // support hand: palm under the handguard, fingers up the right side, thumb forward along the left flat below the light.
    // The pose is solved so every finger joint sits one finger-radius off the tube; the group pivots about the palm.
    const lX = V(0.4740, -0.0716, 0.8776), lY = V(0.8783, -0.0321, -0.4770), lZ = V(0.0624, 0.9969, 0.0477), lO = V(-0.0645, -0.1083, -0.2543), lE = V(-0.30, -0.24, -0.04);
    const lw = lE.clone().sub(lO).normalize();
    const lh = buildHand(-1, [[0.68, 0.69, 0.64], [1.04, 0.68, 0.67], [1.37, 0.34, 0.62], [1.45, 0.51, 0.25]], [[0.0326, 0.0359, 0.0232], [0.0482, 0.0526, 0.0356], [0.0701, 0.0652, 0.0405]], 0, [lw.dot(lX), lw.dot(lY), lw.dot(lZ)]);
    const palm = this.lhGrip = lO.clone().addScaledVector(lY, 0.066).addScaledVector(lZ, 0.0175);
    this.lh = new THREE.Group(); this.lh.position.copy(palm); gun.add(this.lh);
    const lhG = new THREE.Group(); lhG.applyMatrix4(basis(lX, lY, lZ, lO.clone().sub(palm))); this.lh.add(lhG);
    mk(lh, M.glove, lhG);
    arm(lO.clone().sub(palm), lE.clone().sub(palm), this.lh);
    // magazine grip: palm flat on the left face of the magazine, fingers round its front, thumb up
    this.lhMag = V(-0.0125, -0.225, -0.070);
    this.lhMagQ = new THREE.Quaternion().setFromRotationMatrix(basis(V(0, -0.94, -0.342), V(0, 0.342, -0.94), V(1, 0, 0), V(0, 0, 0)).multiply(basis(lX, lY, lZ, V(0, 0, 0)).transpose()));
    // muzzle flash + light
    const ft = flashTexture();
    this.flash = new THREE.Group(); this.flash.position.copy(MUZZLE); gun.add(this.flash);
    const fm = new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(7, 5.2, 3.2), fog: false, toneMapped: false });
    for (let i = 0; i < 3; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm); if (i === 1) q.rotation.y = Math.PI / 2; if (i === 2) { q.rotation.y = Math.PI / 2; q.rotation.x = Math.PI / 2; } q.userData.noAO = true; q.frustumCulled = false; q.renderOrder = 12; this.flash.add(q); }
    this.flash.visible = false; this.flash.userData.noAO = true;
    this.light = new THREE.PointLight(new THREE.Color(1, 0.72, 0.42), 0, 14, 2); this.light.position.copy(MUZZLE).add(V(0, 0.02, -0.12)); gun.add(this.light);
    R.setupTree(root);

    this.rnd = rng(4242);
    this.mode = 'auto'; this.magSize = 30; this.ammo = 30; this.reserve = 120;
    this.cool = 0; this.shots = 0; this.sinceShot = 9; this.heat = 0; this.triggerHeld = false;
    this.ads = 0; this.sprint = 0; this.nextShotSpread = 0; this.reloadT = -1; this.reloadLen = 0; this.reloadEmpty = false; this.reloaded = false; this.inspectT = -1;
    this.kick = 0; this.kickV = 0; this.kickRot = V(0, 0, 0); this.sway = V(0, 0, 0); this.bobT = 0; this.land = 0; this.wall = 0; this.flashT = 0; this.boltT = 1; this.time = 0;
    this.stage = 0; this.away = false; this.stow = 0;
  }

  reset() { this.away = false; this.stow = 0; this.gun.visible = true; this.ammo = this.magSize; this.reserve = 120; this.reloadT = -1; this.inspectT = -1; this.heat = 0; this.shots = 0; this.mag.position.set(0, 0, 0); this.lh.position.copy(this.lhGrip); this.lh.quaternion.identity(); }
  get reloading() { return this.reloadT >= 0; }
  toggleMode() { this.mode = this.mode === 'auto' ? 'semi' : 'auto'; this.cb.sound('select'); }
  startReload() {
    if (this.away || this.reloading || this.ammo >= this.magSize || this.reserve <= 0) return;
    this.reloadEmpty = this.ammo === 0; this.reloadT = 0; this.reloaded = false; this.stage = 0; this.inspectT = -1;
    this.reloadLen = 2.0;
  }
  inspect() { if (!this.away && !this.reloading && this.inspectT < 0) this.inspectT = 0; }
  // Rifle let down on its sling so both hands are free (throwing). Whatever the hands were doing with it stops.
  holster(on) {
    this.away = on; if (!on) return;
    if (this.reloading) { this.reloadT = -1; this.lh.position.copy(this.lhGrip); this.lh.quaternion.identity(); this.mag.position.set(0, 0, 0); this.mag.visible = true; }
    this.inspectT = -1; this.autoReload = 0;
  }

  shotSpread(inp) {
    const shots = Math.floor(this.shots);
    const move = inp.moving * (inp.grounded ? 1 : 1.6);
    let spread = lerp(0.006, 0.0009, this.ads) + move * lerp(0.007, 0.006, this.ads) + Math.min(shots, 14) * lerp(0.0008, 0.0007, this.ads);
    if (inp.crouch) spread *= 0.72;
    if (inp.sprinting) spread = spread * 1.2 + 0.003;
    if (shots === 0 && move < 0.2) spread *= 0.35;
    return spread;
  }

  // input: { fire, ads, sprinting, moving (0..1), speed, crouch, grounded, lookDX, lookDY, wallDist }
  update(dt, inp) {
    this.time += dt; this.cool -= dt; this.sinceShot += dt;
    if (this.away) inp = { ...inp, fire: false, ads: false };
    this.stow = damp(this.stow, this.away ? 1 : 0, this.away ? 12 : 9, dt); this.gun.visible = this.stow < 0.97;
    const canAds = !this.reloading && !inp.sprinting && this.inspectT < 0;
    this.ads = damp(this.ads, inp.ads && canAds ? 1 : 0, 16, dt);
    const hipKick = inp.ads ? 0 : 1 - this.ads;
    if (inp.ads) this.kickRot.x = 0;
    // sprint carry: pulling the trigger brings the rifle up out of the carry (about a tenth of a second) and it stays up while firing
    const carry = inp.sprinting && !this.reloading && !(inp.fire && this.ammo > 0) && this.sinceShot > 0.32;
    this.sprint = damp(this.sprint, carry ? 1 : 0, carry ? 9 : 22, dt);
    this.heat = Math.max(0, this.heat - dt * 0.12);
    if (this.sinceShot > 0.22) this.shots = Math.max(0, this.shots - dt * 14);

    // ---- firing
    const wantFire = inp.fire && (this.mode === 'auto' || !this.triggerHeld);
    if (inp.fire && !this.triggerHeld && this.ammo === 0 && !this.reloading) { this.cb.sound('dry'); if (this.reserve > 0) this.startReload(); }
    this.triggerHeld = inp.fire;
    if (wantFire && this.cool <= 0 && this.ammo > 0 && !this.reloading && this.sprint < 0.4) {
      if (this.inspectT >= 0) this.inspectT = -1;
      this.ammo--; this.cool = 0.079; this.sinceShot = 0;
      const n = Math.floor(this.shots), R = this.rnd;
      const spread = this.shotSpread(inp);
      const pat = [0, 0.1, -0.12, 0.18, 0.26, 0.08, -0.2, -0.32, -0.12, 0.2, 0.34, 0.1, -0.22, -0.3, 0.05][n % 15];
      const scale = lerp(1, 0.62, this.ads) * (inp.crouch ? 0.82 : 1);
      this.cb.fire(spread, (pat * 0.011 + (R() - 0.5) * 0.0035) * scale, 0.0025 * hipKick);
      this.kickRot.x = Math.min(0.018, this.kickRot.x + 0.006 * hipKick);
      this.shots = Math.min(30, this.shots + 1); this.heat = Math.min(1, this.heat + 0.035);
      this.kickV += lerp(1.25, 0.85, this.ads); this.kickRot.z += (R() - 0.5) * lerp(0.03, 0.008, this.ads); this.kickRot.y += (R() - 0.5) * lerp(0.012, 0.002, this.ads);
      this.flashT = 0.045; this.boltT = 0;
      const s = lerp(0.2, 0.3, R()); this.flash.scale.set(s, s, s * 1.6); this.flash.rotation.z = R() * 6.28; this.flash.visible = R() > 0.12;
      if (this.ammo === 0 && this.reserve > 0) this.autoReload = 0.28;
    }
    if (this.autoReload > 0) { this.autoReload -= dt; if (this.autoReload <= 0 && this.ammo === 0) this.startReload(); }
    this.flashT -= dt; if (this.flashT < 0.02) this.flash.visible = false;
    this.light.intensity = this.flashT > 0 ? 9 * (this.flashT / 0.045) : 0;
    this.boltT = Math.min(1, this.boltT + dt / 0.07);
    const boltLocked = this.reloading ? this.reloadEmpty && this.reloadT < RELOAD_BOLT_RELEASE : this.ammo === 0;
    this.bolt.position.z = Math.sin(this.boltT * Math.PI) * 0.038 + (boltLocked ? 0.036 : 0);

    // ---- springs
    this.kickV += (-this.kick * 420 - this.kickV * 30) * dt; this.kick += this.kickV * dt * 0.02;
    this.kickRot.multiplyScalar(Math.exp(-dt * 13));
    this.sway.x = damp(this.sway.x, clamp(-inp.lookDX * 0.0022, -0.05, 0.05), 9, dt); this.sway.y = damp(this.sway.y, clamp(-inp.lookDY * 0.0022, -0.04, 0.04), 9, dt);
    this.bobT += dt * inp.speed * 1.75; this.land = damp(this.land, 0, 9, dt); this.wall = damp(this.wall, clamp((0.95 - inp.wallDist) / 0.6, 0, 1), 10, dt);

    const p = new THREE.Vector3().lerpVectors(HIP.p, ADS.p, this.ads), r = new THREE.Vector3().lerpVectors(HIP.r, ADS.r, this.ads);
    const loose = 1 - this.ads * 0.9, bob = Math.min(1, inp.speed / 4.5) * (inp.grounded ? 1 : 0.2);
    // idle breathing + footstep bob
    p.y += Math.sin(this.time * 1.5) * 0.0016 * loose + Math.sin(this.time * 1.5) * 0.00025; r.x += Math.sin(this.time * 1.5 + 0.6) * 0.0035 * loose;
    p.x += Math.cos(this.bobT) * 0.0052 * bob * loose; p.y += -Math.abs(Math.sin(this.bobT)) * 0.0062 * bob * loose; r.z += Math.cos(this.bobT) * 0.012 * bob * loose;
    // look inertia
    r.y += this.sway.x * (1 - this.ads * 0.7); r.x += this.sway.y * (1 - this.ads * 0.7); p.x += this.sway.x * 0.05 * loose; r.z += this.sway.x * 0.5 * loose;
    // sprint carry, wall lowering, landing dip
    p.x += -0.035 * this.sprint; p.y += -0.035 * this.sprint - 0.05 * this.wall - this.land * 0.03; p.z += 0.03 * this.sprint + 0.09 * this.wall;
    r.y += 0.62 * this.sprint; r.x += -0.2 * this.sprint - 0.62 * this.wall; r.z += 0.2 * this.sprint;
    // slung: down and across the body, muzzle low
    { const s = smooth(this.stow); p.x += 0.05 * s; p.y += -0.36 * s; p.z += 0.12 * s; r.x += -0.85 * s; r.y += 0.35 * s; r.z += 0.55 * s; }
    // recoil
    p.z += this.kick; r.x += this.kickRot.x; r.y += this.kickRot.y; r.z += this.kickRot.z;

    // ---- reload / inspect
    if (this.reloading) {
      const t0 = this.reloadT; this.reloadT += dt; const t = this.reloadT;
      const g = key(RELOAD.gun, t);
      p.x += g[1]; p.y += g[2]; p.z += g[3]; r.x += g[4]; r.y += g[5]; r.z += g[6];
      const w = key(RELOAD.lh, t)[1], m = key(RELOAD.mag, t);
      this.mag.position.set(0, m[1], m[1] * -0.25); this.mag.visible = !(t > 0.56 && t < 0.9);
      const hp = this.lh.position.copy(this.lhMag).add(this.mag.position).multiplyScalar(w).addScaledVector(this.lhGrip, 1 - w);   // hand rides the magazine
      hp.y -= Math.sin(w * Math.PI) * 0.03; this.lh.quaternion.identity().slerp(this.lhMagQ, w);
      const cue = (at, name) => { if (t0 < at && t >= at) this.cb.sound(name); };
      cue(0.02, 'cloth'); cue(0.36, 'magout'); cue(1.3, 'magin'); cue(1.42, 'magtap'); if (this.reloadEmpty) cue(RELOAD_BOLT_RELEASE, 'bolt');
      if (!this.reloaded && t >= 1.32) { const take = Math.min(this.magSize - this.ammo, this.reserve); this.ammo += take; this.reserve -= take; this.reloaded = true; }
      if (t >= this.reloadLen) { this.reloadT = -1; this.lh.position.copy(this.lhGrip); this.lh.quaternion.identity(); this.mag.position.set(0, 0, 0); this.mag.visible = true; }
    } else if (this.inspectT >= 0) {
      this.inspectT += dt; const g = key(INSPECT, this.inspectT);
      const k = 1 - this.ads; p.x += g[1] * k; p.y += g[2] * k; p.z += g[3] * k; r.x += g[4] * k; r.y += g[5] * k; r.z += g[6] * k;
      if (this.inspectT >= 2.6) this.inspectT = -1;
    }
    this.root.position.copy(p); this.root.rotation.set(r.x, r.y, r.z, 'YXZ');
    this.nextShotSpread = this.shotSpread(inp);
    this.reticle.uniforms.uBright.value = damp(this.reticle.uniforms.uBright.value, inp.inSun ? 1.5 : 0.9, 3, dt);
  }

  muzzleWorld(out) { return this.gun.localToWorld(out.copy(MUZZLE)); }
  ejectWorld(out) { return this.gun.localToWorld(out.copy(EJECT)); }
}
