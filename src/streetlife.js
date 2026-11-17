// Street life: what a used street carries that its architecture does not. On the ground, oil and tar, crack sealing,
// damp, fallen leaves and bougainvillea petals under the trees that drop them, litter along the walls, vegetable scraps
// round the stalls, worn road paint, kerb paint, drain grates, a chalk hopscotch. On the walls, pasted posters, painted
// wall advertisements (rótulos), spray tags in the alleys, leak streaks, enamel notices and house numbers, electricity
// meters on their conduit. On the roofs, water tanks (tinacos), aerials and dishes.
//
// Everything here is added after the district is built and only looks at it: where a wall is flat and bare is found
// by rays against the drawn triangles, and every choice is a hash of the position. Nothing is drawn from the map's
// random streams, nothing collides, nothing is in the light bake's signature (the group is not the world's), so the
// layout, cover, routes and bake are exactly as they were. Every word is generic Spanish; no real business or brand.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './util.js';
import { windUniforms } from './materials.js';
import { hash } from './facades.js';
import { SIDEWALK } from './world.js';
import { HALL } from './quarter.js';

const AW = 2048, AH = 2048;
const FONTS = ['900 {s}px Impact, "Arial Black", sans-serif', 'bold {s}px "Arial Black", Arial, sans-serif', 'bold {s}px Rockwell, Georgia, serif', 'bold {s}px "Futura", "Avenir Next Condensed", "Arial Narrow", sans-serif'];

// ---- the atlas: every decal is one cell, [x, y, w, h] in pixels ---------------------------------------------------------------
const CELL = {};
for (let i = 0; i < 6; i++) CELL['poster' + i] = [i * 192, 0, 192, 288];
for (let i = 0; i < 4; i++) CELL['num' + i] = [1152 + i * 96, 0, 96, 96];
CELL.gum = [1536, 0, 128, 128];
CELL.notice0 = [1152, 128, 256, 160]; CELL.notice1 = [1408, 128, 256, 160];
CELL.kerb = [1664, 0, 384, 64]; CELL.bar = [1664, 64, 384, 96]; CELL.grate = [1664, 160, 256, 128];
for (let i = 0; i < 4; i++) CELL['rot' + i] = [i * 512, 288, 512, 256];
CELL.rot4 = [0, 544, 512, 256]; CELL.rot5 = [512, 544, 512, 256]; CELL.tag0 = [1024, 544, 512, 256]; CELL.tag1 = [1536, 544, 512, 256];
CELL.tag2 = [0, 800, 512, 256]; CELL.tag3 = [512, 800, 512, 256];
CELL.arrow = [1024, 800, 256, 512]; CELL.hop = [1280, 800, 256, 512]; CELL.tyre = [1536, 800, 256, 512]; CELL.drip = [1792, 800, 256, 512];
['oil0', 'oil1', 'tar0', 'tar1'].forEach((n, i) => { CELL[n] = [i * 256, 1056, 256, 256]; });
['seal0', 'seal1', 'damp0', 'damp1', 'leaf0', 'leaf1', 'leaf2', 'petal0'].forEach((n, i) => { CELL[n] = [i * 256, 1312, 256, 256]; });
['petal1', 'lit0', 'lit1', 'lit2', 'veg0', 'veg1', 'oil2', 'chip'].forEach((n, i) => { CELL[n] = [i * 256, 1568, 256, 256]; });

const POSTERS = [
  { bg: '#e9d9a8', ink: '#8c1d18', a: 'GRAN', b: 'BAILE', c: 'SÁBADO 9 PM', d: 'SALÓN LA ESTRELLA', art: 'star' },
  { bg: '#d9c27a', ink: '#1c1a17', a: 'LUCHA', b: 'LIBRE', c: 'DOMINGO 6 PM', d: 'ARENA DEL BARRIO', art: 'mask' },
  { bg: '#ead7b4', ink: '#2f5d3a', a: 'FERIA', b: 'DEL PUEBLO', c: 'JUEGOS · ANTOJITOS', d: 'TODA LA SEMANA', art: 'wheel' },
  { bg: '#d8b26a', ink: '#7a2216', a: 'GRAN', b: 'CIRCO', c: 'FUNCIÓN DIARIA', d: 'NIÑOS MITAD DE PRECIO', art: 'tent' },
  { bg: '#efe6d2', ink: '#20201e', a: 'SE RENTA', b: 'CUARTO', c: 'AMUEBLADO', d: 'INFORMES AQUÍ', art: null },
  { bg: '#e3cf9c', ink: '#5a2a12', a: 'CLASES DE', b: 'GUITARRA', c: 'TODAS LAS EDADES', d: 'PREGUNTE EN LA TIENDA', art: 'note' },
];
const ROTULOS = [
  { bg: '#ece4d2', fg: '#a3231b', ln: '#2a2622', a: 'SE RENTA', b: 'LOCAL', f: 0 },
  { bg: '#e2b93b', fg: '#1d1b18', ln: '#8c2a1c', a: 'TALLER MECÁNICO', b: 'AFINACIÓN · FRENOS', f: 1 },
  { bg: '#eee8d8', fg: '#1f5a3c', ln: '#1b1b1b', a: 'HIELO · AGUA', b: 'PURIFICADA', f: 2 },
  { bg: '#eadfc6', fg: '#b3301f', ln: '#c98f1d', a: 'PINTURAS', b: 'IMPERMEABILIZANTES', f: 0 },
  { bg: '#f0ebdd', fg: '#b01f17', ln: '#1b1b1b', a: 'NO ESTACIONARSE', b: 'COCHERA EN USO', f: 1 },
  { bg: '#dcae2f', fg: '#161514', ln: '#f3ead2', a: 'VULCANIZADORA', b: '24 HORAS', f: 0 },
];

function paintAtlas() {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d'), R = rng(77123);
  const font = (k, s) => FONTS[k].replace('{s}', s);
  const fit = (text, k, size, maxW) => { let s = size; g.font = font(k, s); while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = font(k, s); } return s; };
  const cell = (name, draw) => { const [x, y, w, h] = CELL[name]; g.save(); g.beginPath(); g.rect(x + 2, y + 2, w - 4, h - 4); g.clip(); g.translate(x, y); draw(w, h); g.restore(); };
  const blob = (x, y, r, col) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
  // paint or paper worn away: rubbed patches, chips and scratches cut out of what is there
  const wear = (w, h, n, big = 1) => {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < n; i++) blob(R() * w, R() * h, (3 + R() * R() * 26) * big, `rgba(0,0,0,${0.35 + R() * 0.6})`);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < n / 3; i++) { g.lineWidth = 0.6 + R() * 1.6; g.beginPath(); const x = R() * w, y = R() * h; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 70, y + (R() - 0.5) * 70); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  };
  const grime = (w, h, a = 0.25) => { for (let i = 0; i < 26; i++) blob(R() * w, R() * h, 8 + R() * 40, `rgba(${60 + R() * 30 | 0},${50 + R() * 25 | 0},${36 + R() * 20 | 0},${a * R()})`); };
  const soft = (w, h, inset = 10) => {            // feather the cell's edge so a blob never shows a straight cut
    g.globalCompositeOperation = 'destination-in';
    const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 2 - inset * 2.4, w / 2, h / 2, Math.min(w, h) / 2 - inset * 0.3);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  };

  // ---- posters: printed paper pasted up, sun-faded, torn at the corners
  POSTERS.forEach((p, i) => cell('poster' + i, (w, h) => {
    g.fillStyle = p.bg; g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = p.ink; g.fillRect(6, 6, w - 12, 12); g.fillRect(6, h - 30, w - 12, 24);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = p.ink;
    let s = fit(p.a, 0, 50, w - 28); g.fillText(p.a, w / 2, 48);
    s = fit(p.b, 0, 62, w - 26); g.fillText(p.b, w / 2, 50 + s * 0.5 + 26);
    const cy = 172;
    g.save(); g.translate(w / 2, cy); g.strokeStyle = p.ink; g.lineWidth = 4;
    if (p.art === 'star') { g.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 - Math.PI / 2, r = k % 2 ? 14 : 34; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); }
    if (p.art === 'mask') { g.beginPath(); g.ellipse(0, 0, 28, 34, 0, 0, 7); g.fill(); g.fillStyle = p.bg; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * 11, -6, 8, 5, sx * 0.5, 0, 7); g.fill(); } g.beginPath(); g.ellipse(0, 16, 9, 4, 0, 0, 7); g.fill(); }
    if (p.art === 'wheel') { g.beginPath(); g.arc(0, 0, 32, 0, 7); g.stroke(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 32, Math.sin(a) * 32); g.stroke(); g.beginPath(); g.arc(Math.cos(a) * 32, Math.sin(a) * 32, 5, 0, 7); g.fill(); } }
    if (p.art === 'tent') { g.beginPath(); g.moveTo(0, -36); g.lineTo(40, 6); g.lineTo(34, 34); g.lineTo(-34, 34); g.lineTo(-40, 6); g.closePath(); g.fill(); g.fillStyle = p.bg; for (const sx of [-18, 0, 18]) g.fillRect(sx - 3, 8, 6, 26); }
    if (p.art === 'note') { g.beginPath(); g.ellipse(-10, 22, 13, 9, -0.4, 0, 7); g.fill(); g.fillRect(0, -34, 5, 56); g.beginPath(); g.moveTo(5, -34); g.quadraticCurveTo(30, -26, 24, -2); g.quadraticCurveTo(22, -16, 5, -18); g.fill(); }
    if (!p.art) { g.lineWidth = 3; g.strokeRect(-56, -30, 112, 60); g.font = font(1, 15); g.fillText('TEL. — — — —', 0, 0); }
    g.restore();
    g.fillStyle = p.ink; fit(p.c, 3, 21, w - 30); g.fillText(p.c, w / 2, 226); fit(p.d, 3, 15, w - 30); g.fillText(p.d, w / 2, 246);
    g.fillStyle = p.bg; g.font = font(3, 13); g.fillText('ENTRADA GENERAL', w / 2, h - 18);
    g.globalAlpha = 0.16 + R() * 0.14; g.fillStyle = '#fff3d6'; g.fillRect(0, 0, w, h); g.globalAlpha = 1;          // bleached
    for (let k = 0; k < 5; k++) { g.strokeStyle = `rgba(90,70,50,${0.10 + R() * 0.14})`; g.lineWidth = 1; g.beginPath(); const yy = 20 + R() * (h - 40); g.moveTo(6, yy); g.bezierCurveTo(w * 0.3, yy + (R() - 0.5) * 16, w * 0.7, yy + (R() - 0.5) * 16, w - 6, yy + (R() - 0.5) * 10); g.stroke(); }   // wrinkles in the paste
    grime(w, h, 0.22);
    g.globalCompositeOperation = 'destination-out';                                                             // torn corners and a strip pulled off
    for (const [cx, cyy] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) if (R() < 0.75) { g.beginPath(); g.moveTo(cx, cyy); const r = 14 + R() * 46, sx = cx < w / 2 ? 1 : -1, sy = cyy < h / 2 ? 1 : -1; g.lineTo(cx + sx * r, cyy); for (let k = 0; k < 5; k++) g.lineTo(cx + sx * r * (1 - (k + 1) / 5) + (R() - 0.5) * 8, cyy + sy * r * ((k + 1) / 5) * (0.6 + R() * 0.6)); g.lineTo(cx, cyy + sy * r * 0.9); g.closePath(); g.fill(); }
    if (R() < 0.6) { const yy = 40 + R() * (h - 110); g.beginPath(); g.moveTo(0, yy); for (let k = 0; k <= 8; k++) g.lineTo(k * w * 0.07 * (0.6 + R()), yy + (R() - 0.3) * 26 + k * 2); g.lineTo(0, yy + 34); g.closePath(); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    wear(w, h, 10, 0.5);
  }));

  // ---- painted wall advertisements: a whitewashed panel lettered by hand, rubbed back to the wall by sun and rain
  ROTULOS.forEach((r, i) => cell('rot' + i, (w, h) => {
    g.fillStyle = r.bg; g.fillRect(8, 8, w - 16, h - 16);
    g.strokeStyle = r.ln; g.lineWidth = 9; g.strokeRect(18, 18, w - 36, h - 36);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const line = (t, cy, size, k) => { const s = fit(t, k, size, w - 76); g.fillStyle = r.ln; g.fillText(t, w / 2 + s * 0.05, cy + s * 0.06); g.fillStyle = r.fg; g.fillText(t, w / 2, cy); };
    line(r.a, h * 0.40, 98, r.f); line(r.b, h * 0.72, 46, 3);
    g.globalAlpha = 0.2; g.fillStyle = '#fff6e0'; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(50,40,30,0.25)'); gr.addColorStop(0.35, 'rgba(50,40,30,0)'); gr.addColorStop(1, 'rgba(60,48,34,0.3)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 18; k++) { const sx = R() * w, len = 30 + R() * 150, st = g.createLinearGradient(0, 8, 0, 8 + len); st.addColorStop(0, 'rgba(50,40,30,0.3)'); st.addColorStop(1, 'rgba(50,40,30,0)'); g.fillStyle = st; g.fillRect(sx, 8, 2 + R() * 5, len); }
    wear(w, h, 90 + i * 12, 1.25);
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.22 + 0.1 * (i % 3); g.fillRect(0, 0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';   // thin all over: the wall's own texture shows through
  }));

  // ---- spray tags: loops and strokes that read as writing without being any
  const INKS = ['rgba(18,18,20,', 'rgba(110,22,18,', 'rgba(232,228,214,', 'rgba(26,60,40,'];
  for (let i = 0; i < 4; i++) cell('tag' + i, (w, h) => {
    const ink = INKS[i];
    for (let pass = 0; pass < 2; pass++) {
      const T = rng(900 + i);
      g.strokeStyle = ink + (pass ? '0.9)' : '0.22)'); g.lineWidth = pass ? 7 + i : 22; g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = ink + '0.5)'; g.shadowBlur = pass ? 5 : 16;
      let x = 46, y = h * 0.55;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        const nx = x + 40 + T() * 36, ny = h * 0.5 + (T() - 0.5) * h * 0.5, up = h * (0.16 + T() * 0.2), dn = h * (0.72 + T() * 0.16);
        if (T() < 0.5) g.bezierCurveTo(x + 6, up, nx - 26, dn, nx, ny); else { g.lineTo(x + 14, up); g.lineTo(x + 26, dn); g.quadraticCurveTo(nx - 8, dn + 10, nx, ny); }
        x = nx; y = ny;
      }
      g.stroke();
      g.beginPath(); g.moveTo(40, h * 0.86); g.quadraticCurveTo(w * 0.5, h * (0.78 + T() * 0.14), x + 20, h * 0.82); g.stroke();       // the underline flourish
      for (let k = 0; k < 4; k++) { const dx = 60 + T() * (w - 130), dy = h * 0.6; g.lineWidth = pass ? 2.5 : 5; g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx + (T() - 0.5) * 3, dy + 14 + T() * 34); g.stroke(); }   // runs
    }
    g.shadowBlur = 0; wear(w, h, 26, 0.8);
  });

  // ---- enamel notices and house numbers
  cell('notice0', (w, h) => {
    g.fillStyle = '#e9e4d6'; g.fillRect(8, 8, w - 16, h - 16); g.strokeStyle = '#a3231b'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#a3231b'; fit('SE PROHÍBE', 1, 34, w - 44); g.fillText('SE PROHÍBE', w / 2, 52);
    g.fillStyle = '#1d1b18'; fit('TIRAR BASURA', 1, 30, w - 44); g.fillText('TIRAR BASURA', w / 2, 92); g.font = font(3, 15); g.fillText('SE CONSIGNARÁ A LA AUTORIDAD', w / 2, 126);
    for (const [x, y] of [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20]]) { g.fillStyle = '#5a554c'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    for (let k = 0; k < 9; k++) blob(R() * w, R() * h, 4 + R() * 12, `rgba(110,60,30,${0.3 + R() * 0.4})`); grime(w, h, 0.2);
  });
  cell('notice1', (w, h) => {
    g.fillStyle = '#20324a'; g.fillRect(8, 8, w - 16, h - 16); g.strokeStyle = '#e9e4d6'; g.lineWidth = 4; g.strokeRect(15, 15, w - 30, h - 30);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e9e4d6'; fit('CALLE DEL', 2, 26, w - 50); g.fillText('CALLE DEL', w / 2, 52); fit('MERCADO', 2, 44, w - 44); g.fillText('MERCADO', w / 2, 94);
    for (let k = 0; k < 7; k++) blob(R() * w, R() * h, 4 + R() * 10, `rgba(120,70,40,${0.3 + R() * 0.4})`); grime(w, h, 0.25);
  });
  ['12', '27', '8', '41'].forEach((n, i) => cell('num' + i, (w, h) => {
    g.fillStyle = '#ece6d6'; g.fillRect(6, 6, w - 12, h - 12); g.strokeStyle = ['#1f5a3c', '#a3231b', '#3b3a36', '#7a5a1c'][i]; g.lineWidth = 5; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = g.strokeStyle; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font(2, 46); g.fillText(n, w / 2, h / 2 + 3); grime(w, h, 0.18);
  }));

  // ---- leak streaks down a wall
  cell('drip', (w, h) => {
    for (let k = 0; k < 16; k++) { const x = 60 + R() * (w - 120), len = h * (0.3 + R() * 0.65), wd = 4 + R() * 16, gr = g.createLinearGradient(0, 6, 0, 6 + len); const c = R() < 0.4 ? '95,52,26' : '38,34,28'; gr.addColorStop(0, `rgba(${c},${0.3 + R() * 0.3})`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.beginPath(); g.ellipse(x, 6 + len / 2, wd, len / 2, 0, 0, 7); g.fill(); }
    blob(w / 2, 10, 80, 'rgba(40,34,26,0.45)');
  });

  // ---- the road: oil, tar patches, crack sealing, damp, tyre marks, paint
  for (let i = 0; i < 3; i++) cell('oil' + i, (w, h) => {
    for (let k = 0; k < 9 + i * 3; k++) { const a = R() * 7, d = R() * R() * 62; blob(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 22 + R() * 46, `rgba(${12 + R() * 14 | 0},${10 + R() * 10 | 0},${8 + R() * 8 | 0},${0.3 + R() * 0.35})`); }
    for (let k = 0; k < 22; k++) { const a = R() * 7, d = 30 + R() * 80; blob(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2 + R() * 6, 'rgba(14,12,10,0.6)'); }        // drips round it
    soft(w, h);
  });
  for (let i = 0; i < 2; i++) cell('tar' + i, (w, h) => {
    g.fillStyle = '#19191b'; g.beginPath(); const m = 26;
    for (let k = 0; k <= 40; k++) { const t = k / 40, e = (R() - 0.5) * 9; if (t < 0.25) g.lineTo(m + (w - 2 * m) * t * 4, m + e); else if (t < 0.5) g.lineTo(w - m + e, m + (h - 2 * m) * (t - 0.25) * 4); else if (t < 0.75) g.lineTo(w - m - (w - 2 * m) * (t - 0.5) * 4, h - m + e); else g.lineTo(m + e, h - m - (h - 2 * m) * (t - 0.75) * 4); }
    g.closePath(); g.fill();
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${50 + R() * 60 | 0},${50 + R() * 55 | 0},${50 + R() * 50 | 0},${0.25 + R() * 0.4})`; g.fillRect(m + R() * (w - 2 * m), m + R() * (h - 2 * m), 1 + R() * 2, 1 + R() * 2); }   // the aggregate
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.12; g.fillRect(0, 0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    wear(w, h, 12, 0.7);
  });
  for (let i = 0; i < 2; i++) cell('seal' + i, (w, h) => {
    g.strokeStyle = 'rgba(14,14,16,0.9)'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < 3 + i; k++) { g.lineWidth = 5 + R() * 5; let x = 20 + R() * 40, y = 30 + R() * (h - 60); g.beginPath(); g.moveTo(x, y); while (x < w - 30) { x += 14 + R() * 30; y = Math.min(h - 22, Math.max(22, y + (R() - 0.5) * 44)); g.lineTo(x, y); } g.stroke(); }
    soft(w, h, 8);
  });
  for (let i = 0; i < 2; i++) cell('damp' + i, (w, h) => {
    for (let k = 0; k < 16; k++) { const a = R() * 7, d = R() * 66; blob(w / 2 + Math.cos(a) * d * (1 + i * 0.3), h / 2 + Math.sin(a) * d, 30 + R() * 50, `rgba(24,20,16,${0.16 + R() * 0.16})`); }
    soft(w, h, 14);
  });
  cell('tyre', (w, h) => {
    for (const x of [70, 186]) for (let k = 0; k < 40; k++) { const y = 20 + R() * (h - 40), a = 0.5 * Math.sin((y / h) * Math.PI); g.fillStyle = `rgba(16,15,14,${a * (0.3 + R() * 0.5)})`; g.fillRect(x - 18 + R() * 4, y, 36, 6 + R() * 26); }
    g.globalCompositeOperation = 'destination-out'; for (const x of [70, 186]) for (let k = 0; k < 9; k++) g.fillRect(x - 18 + k * 4, 0, 1.2, h); g.globalCompositeOperation = 'source-over';   // the tread
  });
  const roadPaint = (name, col, n) => cell(name, (w, h) => {
    g.fillStyle = col; g.fillRect(4, 4, w - 8, h - 8);
    for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(60,58,54,${R() * 0.25})`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3); }
    wear(w, h, n, 1.1);
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.2; g.fillRect(0, 0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  });
  roadPaint('bar', '#d8d4c8', 60); roadPaint('kerb', '#c79a1e', 46);
  cell('arrow', (w, h) => {
    g.fillStyle = '#d8d4c8'; g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w - 36, 190); g.lineTo(w / 2 + 34, 190); g.lineTo(w / 2 + 34, h - 14); g.lineTo(w / 2 - 34, h - 14); g.lineTo(w / 2 - 34, 190); g.lineTo(36, 190); g.closePath(); g.fill();
    wear(w, h, 120, 1.2); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.25; g.fillRect(0, 0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  });
  cell('grate', (w, h) => {
    blob(w / 2, h / 2, 120, 'rgba(20,17,14,0.5)');
    g.fillStyle = '#2b2a28'; g.fillRect(28, 20, w - 56, h - 40); g.fillStyle = '#060606';
    for (let k = 0; k < 9; k++) g.fillRect(40 + k * 20, 30, 11, h - 60);
    g.strokeStyle = '#3d3b37'; g.lineWidth = 4; g.strokeRect(28, 20, w - 56, h - 40); g.fillStyle = '#3d3b37'; g.fillRect(28, h / 2 - 3, w - 56, 6);
    for (let k = 0; k < 14; k++) blob(30 + R() * (w - 60), 20 + R() * (h - 40), 3 + R() * 7, `rgba(110,62,30,${0.25 + R() * 0.3})`);
  });
  cell('hop', (w, h) => {                                        // "avión": chalk squares with a rounded top
    const chalk = ['rgba(238,236,226,0.75)', 'rgba(226,198,120,0.7)', 'rgba(196,216,178,0.7)'];
    const sq = (x, y, s, n) => { g.strokeStyle = chalk[n % 3]; g.lineWidth = 4; g.setLineDash([9 + R() * 6, 1 + R() * 3]); g.strokeRect(x + (R() - 0.5) * 3, y + (R() - 0.5) * 3, s, s); g.setLineDash([]); g.fillStyle = chalk[(n + 1) % 3]; g.font = font(3, 26); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x + s / 2, y + s / 2); };
    const s = 58, cx = w / 2 - s / 2; let y = h - 74, n = 1;
    for (const row of [1, 1, 2, 1, 2, 1]) { if (row === 1) sq(cx, y, s, n++); else { sq(cx - s / 2, y, s, n++); sq(cx + s / 2, y, s, n++); } y -= s; }
    g.strokeStyle = chalk[0]; g.lineWidth = 4; g.beginPath(); g.arc(w / 2, y + s, s * 0.9, Math.PI, 0); g.stroke();
    wear(w, h, 60, 1);
  });
  cell('gum', (w, h) => { for (let k = 0; k < 9; k++) { const x = 16 + R() * (w - 32), y = 16 + R() * (h - 32), r = 2.5 + R() * 4; g.fillStyle = `rgba(${28 + R() * 20 | 0},${26 + R() * 18 | 0},${24 + R() * 16 | 0},${0.5 + R() * 0.35})`; g.beginPath(); g.ellipse(x, y, r * (1 + R() * 0.5), r, R() * 3, 0, 7); g.fill(); } });
  cell('chip', (w, h) => { for (let k = 0; k < 40; k++) { const x = 20 + R() * (w - 40), y = 20 + R() * (h - 40), r = 2 + R() * 9; g.fillStyle = `rgba(${150 + R() * 50 | 0},${140 + R() * 45 | 0},${122 + R() * 40 | 0},${0.55 + R() * 0.4})`; g.beginPath(); for (let j = 0; j < 5; j++) { const a = j * 1.26 + R(); g.lineTo(x + Math.cos(a) * r * (0.6 + R() * 0.6), y + Math.sin(a) * r * (0.6 + R() * 0.6)); } g.closePath(); g.fill(); } soft(w, h, 12); });   // fallen plaster crumbs at a wall's foot

  // ---- what falls and what is dropped
  const leafShape = (x, y, len, wid, rot, col, vein) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(1.5, 2, len * 0.5, wid * 0.5, 0, 0, 7); g.fill();
    g.fillStyle = col; g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -wid, len / 2, 0); g.quadraticCurveTo(0, wid, -len / 2, 0); g.fill();
    if (vein) { g.strokeStyle = vein; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke(); }
    g.restore();
  };
  const LEAF = [[92, 108, 48], [124, 122, 52], [150, 124, 54], [128, 92, 46], [104, 76, 40], [74, 92, 44]];
  for (let i = 0; i < 3; i++) cell('leaf' + i, (w, h) => {
    const n = 26 + i * 16;
    for (let k = 0; k < n; k++) { const a = R() * 7, d = Math.sqrt(R()) * 104, c = LEAF[Math.floor(R() * LEAF.length)], f = 0.75 + R() * 0.4; leafShape(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 9 + R() * 8, 3.5 + R() * 3, R() * 7, `rgb(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0})`, 'rgba(40,40,20,0.5)'); }
  });
  for (let i = 0; i < 2; i++) cell('petal' + i, (w, h) => {
    const n = 46 + i * 30;
    for (let k = 0; k < n; k++) { const a = R() * 7, d = Math.sqrt(R()) * 106, dry = R() < 0.3, f = 0.7 + R() * 0.4, c = dry ? [176, 140, 112] : [196, 52, 122]; leafShape(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 5 + R() * 4, 3 + R() * 2.5, R() * 7, `rgb(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0})`, null); }
  });
  for (let i = 0; i < 3; i++) cell('lit' + i, (w, h) => {
    for (let k = 0; k < 5 + i * 2; k++) {                         // paper scraps, each a crumpled quadrilateral
      const x = 34 + R() * (w - 68), y = 34 + R() * (h - 68), s = 7 + R() * 15, sh = 200 + R() * 45 | 0;
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + 2, y + 3, s, s * 0.7, 0, 0, 7); g.fill();
      g.fillStyle = `rgb(${sh},${sh - 6},${sh - 22})`; g.beginPath(); for (let j = 0; j < 4; j++) { const a = j * 1.571 + R() * 0.9; g.lineTo(x + Math.cos(a) * s * (0.6 + R() * 0.5), y + Math.sin(a) * s * (0.5 + R() * 0.5)); } g.closePath(); g.fill();
      g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - s * 0.5, y); g.lineTo(x + s * 0.4, y + (R() - 0.5) * s); g.stroke();
    }
    if (i !== 1) { const x = 60 + R() * (w - 120), y = 60 + R() * (h - 120); g.save(); g.translate(x, y); g.rotate(R() * 7); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-12, -5, 28, 16); g.fillStyle = ['#9b2a20', '#b89a2e', '#2f6a44'][i]; g.fillRect(-14, -8, 28, 16); g.fillStyle = 'rgba(230,230,225,0.8)'; g.fillRect(-14, -3, 28, 4); g.fillStyle = '#8f9092'; g.fillRect(-16, -8, 3, 16); g.fillRect(13, -8, 3, 16); g.restore(); }   // a flattened can
    for (let k = 0; k < 6; k++) { const x = 30 + R() * (w - 60), y = 30 + R() * (h - 60); g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + 1, y + 1.5, 3.4, 0, 7); g.fill(); g.fillStyle = ['#c9c5bb', '#a5281f', '#c8a53a'][k % 3]; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }                    // bottle caps
    for (let k = 0; k < 7; k++) { const x = 30 + R() * (w - 60), y = 30 + R() * (h - 60), a = R() * 7; g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#d9d2c2'; g.fillRect(-5, -1.3, 7, 2.6); g.fillStyle = '#b07a3a'; g.fillRect(2, -1.3, 4, 2.6); g.restore(); }   // cigarette ends
  });
  for (let i = 0; i < 2; i++) cell('veg' + i, (w, h) => {
    for (let k = 0; k < 9; k++) { const x = 40 + R() * (w - 80), y = 40 + R() * (h - 80), f = 0.7 + R() * 0.4; g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(x + 2, y + 3, 15, 10, 0, 0, 7); g.fill(); g.fillStyle = `rgb(${96 * f | 0},${132 * f | 0},${58 * f | 0})`; g.beginPath(); for (let j = 0; j < 9; j++) { const a = j * 0.7, r = 9 + R() * 9; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7); } g.closePath(); g.fill(); g.strokeStyle = 'rgba(210,220,170,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x + 8, y + 2); g.stroke(); }   // cabbage and lettuce leaves
    for (let k = 0; k < 7; k++) { const x = 40 + R() * (w - 80), y = 40 + R() * (h - 80); g.save(); g.translate(x, y); g.rotate(R() * 7); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(-13, -1, 30, 7); g.fillStyle = `rgb(${196 + R() * 30 | 0},${184 + R() * 26 | 0},${128 + R() * 30 | 0})`; g.beginPath(); g.moveTo(-16, 0); g.quadraticCurveTo(0, -6, 16, 0); g.quadraticCurveTo(0, 5, -16, 0); g.fill(); g.restore(); }   // corn husks
    for (let k = 0; k < 4; k++) { const x = 44 + R() * (w - 88), y = 44 + R() * (h - 88); blob(x, y, 9 + R() * 6, i ? 'rgba(170,52,30,0.85)' : 'rgba(206,120,32,0.85)'); }                                               // a squashed tomato, orange peel
    for (let k = 0; k < 5; k++) blob(40 + R() * (w - 80), 40 + R() * (h - 80), 20 + R() * 26, 'rgba(30,26,20,0.16)');                                                                                                     // the wet under it
  });

  // Colour carried out under the clear texels, so filtering and mipmaps blend an edge with its own colour instead of black
  const img = g.getImageData(0, 0, AW, AH), d = img.data;
  const sweep = (start, step, count, lines, lineStep) => {
    for (let l = 0; l < lines; l++) {
      let r = -1, gg = 0, b = 0, i = start + l * lineStep, reach = 0;
      for (let k = 0; k < count; k++, i += step) { if (d[i + 3] > 24) { r = d[i]; gg = d[i + 1]; b = d[i + 2]; reach = 14; } else if (reach > 0 && d[i + 3] < 8) { reach--; if (d[i] + d[i + 1] + d[i + 2] === 0) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; } } }
    }
  };
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 8) d[i] = d[i + 1] = d[i + 2] = 0;
  sweep(0, 4, AW, AH, AW * 4); sweep((AW - 1) * 4, -4, AW, AH, AW * 4); sweep(0, AW * 4, AH, AW, 4); sweep((AH - 1) * AW * 4, -AW * 4, AH, AW, 4);
  const t = new THREE.DataTexture(new Uint8Array(d.buffer), AW, AH, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// ---- geometry accumulator for the decals ----------------------------------------------------------------------------------------
class Quads {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  // a, b, c, d: bottom-left, bottom-right, top-right, top-left of the cell as it should read
  add(name, a, b, c, d, nx, ny, nz, tint = [1, 1, 1], alpha = 1, rep = 1) {
    const [x, y, w, h] = CELL[name], u0 = (x + 3) / AW, u1 = (x + w - 3) / AW, vt = (y + 3) / AH, vb = (y + h - 3) / AH, base = this.p.length / 3;
    for (const q of [a, b, c, d]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(tint[0], tint[1], tint[2], alpha); }
    this.u.push(u0, vb, u0 + (u1 - u0) * rep, vb, u0 + (u1 - u0) * rep, vt, u0, vt);
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 4)); g.setIndex(this.i);
    return new THREE.Mesh(g, mat);
  }
}

export function addStreetLife(R, M, world) {
  const group = new THREE.Group(); group.name = 'streetlife';
  const stats = { ground: 0, wall: 0, puddles: 0, meters: 0, tanks: 0, aerials: 0, rays: 0 };

  // ---- rays against the drawn district, through a coarse grid of which meshes are near --------------------------------------------
  const GS = 12, grid = new Map(), bb = new THREE.Box3();
  for (const m of world.rayMeshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.copy(m.geometry.boundingBox);
    if (bb.max.x - bb.min.x > 400) continue;                          // (the ground beyond the map)
    for (let cx = Math.floor((bb.min.x - 1) / GS); cx <= Math.floor((bb.max.x + 1) / GS); cx++) for (let cz = Math.floor((bb.min.z - 1) / GS); cz <= Math.floor((bb.max.z + 1) / GS); cz++) {
      const k = cx * 1000 + cz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(m);
    }
  }
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true; const hits = [], O = new THREE.Vector3(), D = new THREE.Vector3();
  const cast = (ox, oy, oz, dx, dy, dz, far) => {
    const l = grid.get(Math.floor(ox / GS) * 1000 + Math.floor(oz / GS)); if (!l) return null;
    rc.set(O.set(ox, oy, oz), D.set(dx, dy, dz)); rc.far = far; hits.length = 0; rc.intersectObjects(l, false, hits); stats.rays++;
    let best = null; for (const h of hits) if (!best || h.distance < best.distance) best = h;
    return best;
  };
  const WALL = n => n.startsWith('w_') || n === 'paint' || n === 'concrete' || n === 'dirty' || n === 'cracked' || n === 'brick' || n === 'interior';
  const GROUND = { ground: 1, cobble: 1, pavement: 1, terracotta: 1, tiles: 1, cracked: 1, cantera: 1, concrete: 1 };

  const life = new Quads();
  const tintOf = (x, z, lo = 0.8, hi = 1.0) => { const v = lo + (hi - lo) * hash(x, z, 31); return [v, v * (0.97 + 0.03 * hash(x, z, 32)), v * (0.93 + 0.05 * hash(x, z, 33))]; };

  // ================================================================== walls ==========================================================
  // Is the wall flat, bare and unobstructed over w x h centred at height y? Five rays from half a metre out. Returns how
  // far the surface stands proud of the building's own line (base bands and stone are a few centimetres out), or null.
  const flat = (px, pz, y, N, T, w, h) => {
    let d0 = 0;
    for (const [du, dv] of [[0, 0], [-0.46, -0.44], [0.46, -0.44], [0.46, 0.44], [-0.46, 0.44], [0, 0.44], [0, -0.44], [-0.46, 0], [0.46, 0]]) {
      const hgt = cast(px + N.x * 0.5 + T.x * du * w, y + dv * h, pz + N.z * 0.5 + T.z * du * w, -N.x, 0, -N.z, 0.75);
      if (!hgt || !WALL(hgt.object.name) || hgt.distance < 0.3) return null;
      if (!du && !dv) d0 = hgt.distance; else if (Math.abs(hgt.distance - d0) > 0.012) return null;
    }
    return 0.5 - d0;
  };
  // a decal on a wall: centre (u along T from p, height y), size, roll (radians)
  const wallQuad = (name, px, pz, y, N, T, out, w, h, roll = 0, tint = [1, 1, 1], alpha = 1) => {
    const c = Math.cos(roll), s = Math.sin(roll), ox = px + N.x * (out + 0.006), oz = pz + N.z * (out + 0.006);
    const P = (a, b) => { const u = a * c - b * s, v = a * s + b * c; return [ox + T.x * u, y + v, oz + T.z * u]; };
    // T runs to the viewer's right when N x T points up; otherwise the cell is mirrored, so the corners swap
    const right = N.z * T.x - N.x * T.z > 0 ? 1 : -1;
    life.add(name, P(-w / 2 * right, -h / 2), P(w / 2 * right, -h / 2), P(w / 2 * right, h / 2), P(-w / 2 * right, h / 2), N.x, 0, N.z, tint, alpha);
    stats.wall++;
  };
  const meters = [];                                                    // { x, z, N, T, out, top }
  const noPaste = (x, z) => x > 66 && x < 92 && z > 10 && z < 30;       // the chapel and its atrium stay clean
  const DENS = {    // per kind of street: chance per step of [poster, rótulo, tag, drip, meter, notice]
    main: [0.16, 0.09, 0.015, 0.05, 0.04, 0.03], calle: [0.16, 0.09, 0.03, 0.05, 0.04, 0.03], market: [0.18, 0.06, 0.03, 0.06, 0.04, 0.03],
    cross: [0.13, 0.07, 0.05, 0.06, 0.04, 0.02], alley: [0.08, 0.02, 0.12, 0.10, 0.06, 0.015], lane: [0.09, 0.025, 0.10, 0.09, 0.05, 0.015], plaza: [0.06, 0.02, 0, 0.03, 0.015, 0.03],
  };
  let lastPoster = -1, lastRot = -1, lastTag = -1;
  for (const b of world.buildings) {
    if (b.ghost) continue;
    for (const side of b.sides || '') {
      const st = b.street?.[side]; if (!st || st === 'none') continue;
      const dens = DENS[st] || DENS.cross;
      const F = side === 'e' ? { ox: b.x1, oz: b.z1, T: { x: 0, z: -1 }, N: { x: 1, z: 0 }, L: b.z1 - b.z0 }
        : side === 'w' ? { ox: b.x0, oz: b.z0, T: { x: 0, z: 1 }, N: { x: -1, z: 0 }, L: b.z1 - b.z0 }
        : side === 'n' ? { ox: b.x0, oz: b.z1, T: { x: 1, z: 0 }, N: { x: 0, z: 1 }, L: b.x1 - b.x0 }
        : { ox: b.x1, oz: b.z0, T: { x: -1, z: 0 }, N: { x: 0, z: -1 }, L: b.x1 - b.x0 };
      const { N, T } = F;
      for (let u = 0.9; u < F.L - 0.9; u += 0.7) {
        const px = F.ox + T.x * u, pz = F.oz + T.z * u, r = hash(px, pz, 11), r2 = hash(px, pz, 12), r3 = hash(px, pz, 13);
        let acc = 0; const pick = k => r >= acc && r < (acc += dens[k]);
        if (pick(0) && !noPaste(px, pz)) {                              // posters: one to four pasted side by side, the same one or a mix
          const n = 1 + Math.floor(r2 * 3.4), same = r3 < 0.55, y = 1.74 + r3 * 0.3; let first = Math.floor(hash(px, pz, 14) * 6); if (first === lastPoster) first = (first + 1) % 6;
          const out = flat(px + T.x * (n - 1) * 0.31, pz + T.z * (n - 1) * 0.31, y, N, T, n * 0.62 + 0.1, 0.98); if (out === null) continue;
          for (let k = 0; k < n; k++) {
            const idx = same ? first : (first + k * 2) % 6, qx = px + T.x * k * 0.62, qz = pz + T.z * k * 0.62, f = 0.86 + 0.14 * hash(qx, qz, 15);
            wallQuad('poster' + idx, qx, qz, y + (hash(qx, qz, 16) - 0.5) * 0.07, N, T, out + k * 0.0006, 0.6, 0.9, (hash(qx, qz, 17) - 0.5) * 0.09, [f, f, f * 0.97], 0.96);
          }
          lastPoster = first; u += n * 0.62 + 1.6;
        } else if (pick(1) && !noPaste(px, pz)) {                       // a painted advertisement needs a wide bare stretch
          let idx = Math.floor(r2 * 6); if (idx === lastRot) idx = (idx + 1) % 6;
          const w = 2.2 + r3 * 0.5, h = w / 2, y = 1.75 + hash(px, pz, 18) * 0.45, out = flat(px, pz, y, N, T, w + 0.1, h + 0.06); if (out === null) continue;
          wallQuad('rot' + idx, px, pz, y, N, T, out, w, h, 0, tintOf(px, pz, 0.86, 1), 0.92); lastRot = idx; u += w + 2.5;
        } else if (pick(2) && !noPaste(px, pz)) {
          let idx = Math.floor(r2 * 4); if (idx === lastTag) idx = (idx + 1) % 4;
          const w = 1.25 + r3 * 0.6, h = w / 2, y = 1.15 + hash(px, pz, 19) * 0.5, out = flat(px, pz, y, N, T, w, h); if (out === null) continue;
          wallQuad('tag' + idx, px, pz, y, N, T, out, w, h, (hash(px, pz, 20) - 0.5) * 0.14, [1, 1, 1], 0.8); lastTag = idx; u += w + 1.2;
        } else if (pick(3)) {                                           // a leak streak from somewhere above
          const w = 0.7 + r2 * 0.6, h = 1.6 + r3 * 1.2, y = 2.75 - h / 2 + hash(px, pz, 21) * 0.3, out = flat(px, pz, y, N, T, w * 0.6, h * 0.9); if (out === null) continue;
          wallQuad('drip', px, pz, y, N, T, out, w, h, 0, [1, 1, 1], 0.5 + 0.3 * hash(px, pz, 22)); u += 0.6;
        } else if (pick(4)) {                                           // an electricity meter on its conduit: bare wall from the ground to above head height
          const o1 = flat(px, pz, 1.5, N, T, 0.4, 0.5), o2 = o1 === null ? null : flat(px, pz, 2.5, N, T, 0.16, 0.9); if (o1 === null || o2 === null || Math.abs(o1 - o2) > 0.012) continue;
          meters.push({ x: px, z: pz, N, T, out: o1, v: r2 }); u += 1.4;
          const ch = cast(px + N.x * 0.12, 0.6, pz + N.z * 0.12, 0, -1, 0, 1.2);                                         // plaster crumbs and dust at its foot
          if (ch && GROUND[ch.object.name]) { const gy = ch.point.y + 0.006, cx = px + N.x * 0.32, cz = pz + N.z * 0.32, hw = 0.45, hd = 0.3; life.add('chip', [cx - T.x * hw + N.x * hd, gy, cz - T.z * hw + N.z * hd], [cx + T.x * hw + N.x * hd, gy, cz + T.z * hw + N.z * hd], [cx + T.x * hw - N.x * hd, gy, cz + T.z * hw - N.z * hd], [cx - T.x * hw - N.x * hd, gy, cz - T.z * hw - N.z * hd], 0, 1, 0, [1, 1, 1], 0.9); stats.ground++; }
        } else if (pick(5)) {                                           // an enamel notice or a house number
          const num = r2 < 0.55, name = num ? 'num' + Math.floor(r3 * 4) : 'notice' + (st === 'calle' || st === 'market' ? Math.floor(r3 * 2) : 0);
          const w = num ? 0.2 : 0.48, h = num ? 0.2 : 0.3, y = num ? 2.05 : 2.25, out = flat(px, pz, y, N, T, w + 0.08, h + 0.08); if (out === null) continue;
          wallQuad(name, px, pz, y, N, T, out + 0.004, w, h, 0, [0.95, 0.95, 0.95], 1); u += 1.2;
        }
      }
    }
  }

  // ================================================================== ground =========================================================
  const X0 = -47, X1 = 112, Z0 = -81, Z1 = 81, CW = X1 - X0, CH = Z1 - Z0;
  // what hangs over each square metre: laurel leaves and bougainvillea, from the drawn foliage itself
  const canopy = new Float32Array(CW * CH), bloom = new Float32Array(CW * CH);
  for (const m of world.group.children) {
    const leafy = m.name === 'leaves' || m.name === 'leaf_mass', flowery = m.name === 'flowers'; if (!leafy && !flowery) continue;
    if (m.userData.kitLod === 'near') continue;
    const p = m.geometry.attributes.position, map = leafy ? canopy : bloom;
    for (let i = 0; i < p.count; i += 4) { const x = Math.floor(p.getX(i) - X0), z = Math.floor(p.getZ(i) - Z0); if (x >= 0 && x < CW && z >= 0 && z < CH && p.getY(i) > 1.2) map[z * CW + x] += 1; }
  }
  const around = (map, x, z) => { let s = 0; const cx = Math.floor(x - X0), cz = Math.floor(z - Z0); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const a = cx + i, c = cz + j; if (a >= 0 && a < CW && c >= 0 && c < CH) s += map[c * CW + a]; } return s; };
  const wallDist = (x, z) => { let d = 9; for (const b of world.buildings) { if (b.ghost) continue; const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1), q = Math.hypot(dx, dz); if (q < d) d = q; } return d; };
  // a decal lying on the ground at (x, z): its corners must not hang over a drop (a kerb's edge, a step), so it is tried
  // at full size and then at 60 %; where a corner's ground is higher the decal just runs under it
  const lay = (name, x, z, size, rot, tint, alpha, aspect = 1) => {
    const c0 = cast(x, 2.0, z, 0, -1, 0, 2.6); if (!c0 || !GROUND[c0.object.name] || c0.point.y > 0.62 || c0.face.normal.y < 0.95) return false;
    const y = c0.point.y, cs = Math.cos(rot), sn = Math.sin(rot);
    for (const k of [1, 0.6]) {
      const hw = size * k / 2, hl = hw * aspect, pts = [[-hw, hl], [hw, hl], [hw, -hl], [-hw, -hl]].map(([a, b]) => [x + a * cs + b * sn, z - a * sn + b * cs]);
      let ok = true;
      for (const [qx, qz] of pts) { const h = cast(qx, y + 0.5, qz, 0, -1, 0, 0.9); if (h && h.point.y < y - 0.02) { ok = false; break; } if (!h && wallDist(qx, qz) > 0.05) { ok = false; break; } }
      if (!ok) continue;
      const gy = y + 0.006 + 0.002 * hash(x, z, 40);
      life.add(name, [pts[0][0], gy, pts[0][1]], [pts[1][0], gy, pts[1][1]], [pts[2][0], gy, pts[2][1]], [pts[3][0], gy, pts[3][1]], 0, 1, 0, tint, alpha);
      stats.ground++; return true;
    }
    return false;
  };
  // an axis-aligned decal on the ground (always wound to face up); along: the cell's width runs along z instead of x
  const rect = (name, xa, xb, za, zb, y, along, tint, alpha, rp = 1) => {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    if (along) life.add(name, [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0, y, z1], 0, 1, 0, tint, alpha, rp);
    else life.add(name, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, tint, alpha, rp);
    stats.ground++;
  };
  const asphalt = (x, z) => x > -31.5 && x < 31.5 && Math.abs(z) < 63.5 && (Math.abs(x) <= 3.9 || [-60, -20, 20, 60].some(c => Math.abs(z - c) <= 3.0));
  const inHall = (x, z) => x > HALL.x0 && x < HALL.x1 && z > HALL.z0 && z < HALL.z1, inLane = (x, z) => x > 25.6 && x < 31.4 && Math.abs(z) < 62;
  for (let pass = 0; pass < 2; pass++) for (let gz = Z0; gz < Z1; gz += 2) for (let gx = X0; gx < X1; gx += 2) {
    const k0 = pass * 100, x = gx + 0.2 + 1.6 * hash(gx, gz, k0 + 1), z = gz + 0.2 + 1.6 * hash(gx, gz, k0 + 2), r = hash(gx, gz, k0 + 3), r2 = hash(gx, gz, k0 + 4), rot = hash(gx, gz, k0 + 5) * 6.283;
    const pet = around(bloom, x, z), can = around(canopy, x, z);
    if (pet > 6 && r < 0.8) { lay('petal' + (r2 < 0.5 ? 0 : 1), x, z, 1.1 + r2 * 0.9, rot, [1, 1, 1], 0.95); continue; }
    if (can > 10 && r < 0.72) { lay('leaf' + Math.floor(r2 * 3), x, z, 1.2 + r2 * 1.0, rot, tintOf(x, z, 0.8, 1), 0.95); continue; }
    if (asphalt(x, z)) {
      const kerb = Math.abs(Math.abs(x) - 3.6) < 0.5;
      if (r < 0.06) lay('oil' + Math.floor(r2 * 3), x, z, 0.8 + r2 * 1.2, rot, [1, 1, 1], 0.3 + 0.3 * hash(gx, gz, 6));
      else if (r < 0.085) lay('tar' + (r2 < 0.5 ? 0 : 1), x, z, 1.3 + r2 * 1.8, Math.round(rot / 1.5708) * 1.5708 + (hash(gx, gz, 6) - 0.5) * 0.1, tintOf(x, z, 0.85, 1), 0.88, 0.6 + 0.8 * hash(gx, gz, 7));
      else if (r < 0.125) lay('seal' + (r2 < 0.5 ? 0 : 1), x, z, 1.8 + r2 * 1.6, rot, [1, 1, 1], 0.85);
      else if (r < 0.15) lay('tyre', x, z, 1.5, (hash(gx, gz, 6) - 0.5) * 0.5 + (Math.abs(x) < 4 ? 0 : 1.5708), [1, 1, 1], 0.6, 2);
      else if (kerb && r < 0.45) lay(r2 < 0.6 ? 'leaf' + Math.floor(r2 * 5) : 'lit' + Math.floor(r2 * 7.4 - 4.4), x, z, 0.9 + r2 * 0.7, rot, tintOf(x, z, 0.75, 0.95), 0.9);
      continue;
    }
    if (inHall(x, z) || inLane(x, z)) {
      if (r < 0.13) lay('veg' + (r2 < 0.5 ? 0 : 1), x, z, 0.9 + r2 * 0.8, rot, tintOf(x, z, 0.85, 1), 0.95);
      else if (r < 0.2) lay('damp' + (r2 < 0.5 ? 0 : 1), x, z, 1.4 + r2 * 1.6, rot, [1, 1, 1], 0.75);
      else if (r < 0.26) lay('lit' + Math.floor(r2 * 3), x, z, 0.8 + r2 * 0.6, rot, [1, 1, 1], 0.92);
      continue;
    }
    const wd = wallDist(x, z);
    if (wd < 1.3) {                                                   // along a wall's foot: what the wind and the broom leave
      if (r < 0.10) lay('lit' + Math.floor(r2 * 3), x, z, 0.8 + r2 * 0.7, rot, tintOf(x, z, 0.8, 1), 0.92);
      else if (r < 0.17) lay('leaf' + Math.floor(r2 * 3), x, z, 0.8 + r2 * 0.6, rot, tintOf(x, z, 0.7, 0.9), 0.85);
      else if (r < 0.30) lay('damp' + (r2 < 0.5 ? 0 : 1), x, z, 1.4 + r2 * 1.8, rot, [1, 1, 1], 0.95);
      else if (r < 0.35) lay('chip', x, z, 0.7 + r2 * 0.5, rot, [1, 1, 1], 0.8);
    } else if (r < 0.05) lay('gum', x, z, 0.5 + r2 * 0.4, rot, [1, 1, 1], 0.8);
    else if (r < 0.10) lay('damp' + (r2 < 0.5 ? 0 : 1), x, z, 1.8 + r2 * 2.4, rot, [1, 1, 1], 0.7);
    else if (r < 0.175) lay('lit' + Math.floor(r2 * 3), x, z, 0.8 + r2 * 0.5, rot, [1, 1, 1], 0.9);
    else if (r < 0.2) lay('oil' + Math.floor(r2 * 3), x, z, 0.7 + r2 * 0.9, rot, [1, 1, 1], 0.3);
  }
  // a chalk hopscotch where children play: the plaza and the plazuela
  lay('hop', -9.5, 9.0, 1.05, 0.5, [1, 1, 1], 0.75, 2); lay('hop', 84.5, -39.5, 1.05, 2.1, [1, 1, 1], 0.75, 2);

  // road paint on the main street: a worn crossing before each junction, an arrow, yellow kerbs at the corners
  const onRoad = (x, z) => { const h = cast(x, 1.2, z, 0, -1, 0, 1.6); return h && h.object.name === 'ground' && h.point.y < 0.02; };
  for (const zc of [-55.2, -24.8, -15.2, 15.2, 24.8, 55.2]) for (let x = -3.3; x <= 3.31; x += 0.94) {
    if (!onRoad(x, zc)) continue;
    const f = 0.8 + 0.2 * hash(x, zc, 50);
    rect('bar', x - 0.24, x + 0.24, zc - 1.25, zc + 1.25, 0.006, true, [f, f, f], 0.5 + 0.3 * hash(x, zc, 51));
  }
  for (const z of [-40, 38]) if (onRoad(1.9, z)) { const hw = 0.55, hl = 1.6; life.add('arrow', [1.9 + hw, 0.006, z - hl], [1.9 - hw, 0.006, z - hl], [1.9 - hw, 0.006, z + hl], [1.9 + hw, 0.006, z + hl], 0, 1, 0, [0.9, 0.9, 0.9], 0.6); stats.ground++; }   // pointing north (+z)
  for (const [za, zb] of [[-57, -23], [-17, 17], [23, 57]]) for (const sx of [-1, 1]) {
    if (sx === -1 && za === -17) continue;
    for (const [a, b] of [[za, za + 6.5], [zb - 6.5, zb]]) for (let z = a; z < b - 0.01; z += 2.4) {
      const z1 = Math.min(b, z + 2.4), rep = (z1 - z) / 2.4, f = 0.82 + 0.18 * hash(sx, z, 52), xo = sx * 4.0, xi = sx * 4.2, top = SIDEWALK + 0.004, al = 0.72 + 0.2 * hash(sx, z, 53);
      rect('kerb', xo, xi, z, z1, top, true, [f, f, f], al, rep);                                                                        // the kerb's top
      const xf = xo - sx * 0.004, za2 = sx > 0 ? z : z1, zb2 = sx > 0 ? z1 : z;                                                           // and its face, seen from the road
      life.add('kerb', [xf, 0.005, za2], [xf, 0.005, zb2], [xf, SIDEWALK, zb2], [xf, SIDEWALK, za2], -sx, 0, 0, [f, f, f], al, rep); stats.ground++;
    }
  }
  // drain grates in the gutter, a damp stain round each
  for (const sx of [-1, 1]) for (let z = -52; z <= 52; z += 13) {
    const zz = z + (hash(sx, z, 54) - 0.5) * 5, x = sx * 3.62; if (!onRoad(x, zz)) continue;
    rect('grate', x - 0.19, x + 0.19, zz - 0.38, zz + 0.38, 0.007, true, [1, 1, 1], 1);
    lay('damp0', x - sx * 0.5, zz, 2.2, 0, [1, 1, 1], 0.9, 0.5);
  }

  // ---- the decal mesh: one draw for the whole district; it fades out with distance (no depth to fight for at range) ----------------
  const mat = new THREE.MeshStandardMaterial({ map: paintAtlas(), transparent: true, depthWrite: false, roughness: 0.94, metalness: 0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mat.userData.patchKey = 'streetlife';
  mat.userData.patch = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.a *= 1.0 - smoothstep(62.0, 80.0, length(vViewPosition));\n  if (diffuseColor.a < 0.006) discard;'); };
  mat.name = 'd_life'; mat.userData.surf = 'none';
  const decals = life.mesh(mat); decals.name = 'd_life'; decals.renderOrder = 2; decals.receiveShadow = true; decals.userData.noAO = true; decals.frustumCulled = false; decals.matrixAutoUpdate = false;
  group.add(decals);

  // ================================================================== wet ground =====================================================
  // Standing water and the damp round it, as patches laid on the ground. Each patch is a quad; inside it a level field
  // (noise in world space plus a fall-off from the patch's middle, plus how full the patch is) says where the ground is
  // only darkened and glossy and where water stands. Water mirrors the district: its reflected ray is marched through
  // last frame's picture and depth (render.js, history), falling back to the sky map where that has no answer. The
  // patch is drawn with its own blend: the ground under it darkened, the reflection added.
  const hist = R.history ? R.history.uniforms : { tPrev: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uPrevOn: { value: 0 } };
  const wet = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, premultipliedAlpha: true, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  wet.name = 'd_wet'; wet.userData.surf = 'none'; wet.userData.patchKey = 'puddle';
  wet.userData.patch = shader => {
    Object.assign(shader.uniforms, hist, { uWetT: windUniforms.uTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec2 vPu;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vPu = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp; varying vec2 vPu;
        uniform sampler2D tPrev; uniform mat4 uPrevVP; uniform float uPrevOn, uWetT;
        float pdDamp, pdWater;
        // the reflected ray through last frame: steps that lengthen with distance, a bisection where it first passes behind
        // what was drawn, and the far scene or sky where it never does. rgb, and how far to trust it
        vec4 pdTrace(vec3 P, vec3 Rd) {
          float t = 0.3, t0 = 0.0; vec2 uv = vec2(0.5); float ahead = 1.0;
          for (int i = 0; i < 20; i++) {
            vec4 c = uPrevVP * vec4(P + Rd * t, 1.0);
            if (c.w < 0.05) return vec4(0.0);
            uv = c.xy / c.w * 0.5 + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
            float dz = c.w - texture2D(tPrev, uv).a;
            if (dz > 0.0 && ahead > 0.5) {
              float a = t0, b = t;
              for (int k = 0; k < 5; k++) { float m = 0.5 * (a + b); vec4 cm = uPrevVP * vec4(P + Rd * m, 1.0); vec2 um = cm.xy / cm.w * 0.5 + 0.5; if (cm.w - texture2D(tPrev, um).a > 0.0) b = m; else a = m; }
              vec4 cb = uPrevVP * vec4(P + Rd * b, 1.0); vec2 ub = cb.xy / cb.w * 0.5 + 0.5; vec4 s = texture2D(tPrev, ub);
              if (abs(cb.w - s.a) < 0.35 + 0.06 * b) { vec2 e = smoothstep(vec2(0.0), vec2(0.07), ub) * smoothstep(vec2(1.0), vec2(0.93), ub); return vec4(s.rgb, e.x * e.y); }
            }
            ahead = dz > 0.0 ? 0.0 : 1.0; t0 = t; t *= 1.42;
          }
          vec4 s = texture2D(tPrev, uv); vec2 e = smoothstep(vec2(0.0), vec2(0.07), uv) * smoothstep(vec2(1.0), vec2(0.93), uv);
          return vec4(s.rgb, e.x * e.y * ahead);
        }`)
      .replace('#include <roughnessmap_fragment>', `
        float pdN = texture2D(tCloud, vWp.xz * 0.13).r * 0.55 + texture2D(tCloud, vWp.xz * 0.51 + 0.3).g * 0.3 + texture2D(tCloud, vWp.xz * 2.3).b * 0.15;
        vec2 pdQ = vPu * 2.0 - 1.0;
        float pdLvl = (pdN * 0.62 + vColor.r * 0.4 + 0.1) * pow(max(1.0 - dot(pdQ, pdQ), 0.0), 0.6);      // nothing left of it at the patch's rim
        pdDamp = smoothstep(0.2, 0.36, pdLvl) * (1.0 - smoothstep(62.0, 80.0, length(vViewPosition)));
        pdWater = smoothstep(0.6, 0.64, pdLvl) * vColor.g;
        if (pdDamp < 0.004) discard;
        float roughnessFactor = mix(0.42, 0.03, pdWater);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {   // wind on the water: two layers of faint ripples crossing
          vec2 rp = (texture2D(tCloud, vWp.xz * 0.9 + uWetT * vec2(0.013, 0.009)).rg + texture2D(tCloud, vWp.xz * 1.9 - uWetT * vec2(0.011, 0.016)).gb - 1.0) * 0.022 * pdWater;
          normal = normalize(normal + (viewMatrix * vec4(rp.x, 0.0, rp.y, 0.0)).xyz);
        }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        if (uPrevOn > 0.5 && pdWater > 0.02) {
          vec3 pdNw = inverseTransformDirection(geometryNormal, viewMatrix);
          vec4 pdR = pdTrace(vWp + pdNw * 0.03, reflect(normalize(vWp - cameraPosition), pdNw));
          radiance = mix(radiance, pdR.rgb, pdR.a * pdWater);
        }`)
      .replace('#include <premultiplied_alpha_fragment>', `
        {   // the ground under the film darkens (more where water stands); the water takes over towards grazing angles
          float pdF = 0.02 + 0.98 * pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 5.0);
          gl_FragColor = vec4(gl_FragColor.rgb * pdDamp, saturate(pdDamp * (0.34 + 0.2 * pdWater) + pdWater * pdF));
        }`);
  };
  const wq = { p: [], n: [], u: [], c: [], i: [] };
  // a patch at (x, z): size (m), elongation, heading, how full (0 a damp stain .. 1 a proper puddle)
  const puddle = (x, z, size, aspect, rot, full) => {
    const c0 = cast(x, 2.0, z, 0, -1, 0, 2.6); if (!c0 || !GROUND[c0.object.name] || c0.point.y > 0.4 || c0.face.normal.y < 0.97) return false;
    const y = c0.point.y, cs = Math.cos(rot), sn = Math.sin(rot), hw = size / 2, hl = hw * aspect;
    const pts = [[-hw, hl], [hw, hl], [hw, -hl], [-hw, -hl]].map(([a, b]) => [x + a * cs + b * sn, z - a * sn + b * cs]);
    for (const [qx, qz] of pts) { const h = cast(qx, y + 0.5, qz, 0, -1, 0, 0.9); if (h && h.point.y < y - 0.02) return false; if (!h && wallDist(qx, qz) > 0.05) return false; }
    const base = wq.p.length / 3, water = c0.object.name === 'cobble' ? 0.75 : inHall(x, z) ? 0.5 : 1;     // (cobbles hold less: the stones stand out of it; a mopped floor is a film)
    pts.forEach(([qx, qz], k) => { wq.p.push(qx, y + 0.009, qz); wq.n.push(0, 1, 0); wq.u.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1); wq.c.push(full, water, 0); });
    wq.i.push(base, base + 1, base + 2, base, base + 2, base + 3); stats.puddles = (stats.puddles || 0) + 1; return true;
  };
  for (let gz = Z0; gz < Z1; gz += 7) for (let gx = X0; gx < X1; gx += 7) {
    const x = gx + 1 + 5 * hash(gx, gz, 201), z = gz + 1 + 5 * hash(gx, gz, 202), r = hash(gx, gz, 203), r2 = hash(gx, gz, 204), rot = hash(gx, gz, 205) * 6.283;
    const road = asphalt(x, z), market = inHall(x, z) || inLane(x, z), wd = wallDist(x, z);
    const p = road ? 0.45 : market ? 0.5 : wd < 2.5 ? 0.3 : 0.2; if (r > p) continue;
    const f = hash(gx, gz, 207);
    puddle(x, z, 3.2 + r2 * 3.6, 0.6 + 0.8 * hash(gx, gz, 206), rot, 0.1 + 0.9 * f * f);                 // most are only damp; a few hold water
  }
  for (const sx of [-1, 1]) for (let z = -52; z <= 52; z += 13) { const zz = z + (hash(sx, z, 54) - 0.5) * 5; puddle(sx * 3.0, zz + 0.4, 2.6, 2.0, 0, 0.75 + 0.25 * hash(sx, z, 208)); }   // the gutter by each drain
  const fountain = (world.emitters || []).find(a => a.kind === 'water');
  if (fountain) { const fx = fountain.x, fz = fountain.z; for (let k = 0; k < 5; k++) { const a = k * 1.26 + 0.4, d = 3.6 + hash(k, 3, 209) * 1.4; puddle(fx + Math.cos(a) * d, fz + Math.sin(a) * d, 3.4, 0.8, a, 0.7 + 0.3 * hash(k, 5, 210)); } }   // splashed round the fountain
  if (wq.i.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wq.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(wq.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(wq.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(wq.c, 3)); g.setIndex(wq.i);
    const pm = new THREE.Mesh(g, wet); pm.name = 'd_wet'; pm.renderOrder = 1.9; pm.receiveShadow = true; pm.userData.noAO = true; pm.frustumCulled = false; pm.matrixAutoUpdate = false;
    group.add(pm);
  }

  // ================================================================== solid things ===================================================
  const parts = new Map();                                              // material key -> geometries
  const put = (key, g, m, col = [1, 1, 1], uvScale = 1) => {
    g = g.index ? g.toNonIndexed() : g; g.applyMatrix4(m);
    const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (uvScale !== 1) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale); }
    let l = parts.get(key); if (!l) parts.set(key, l = []); l.push(g);
  };
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const at = (x, y, z, ry = 0, rx = 0, rz = 0) => mtx.compose(pv.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), sc).clone();

  // ---- electricity meters: a grey box with a round glass on a conduit from the pavement, the service entering above
  for (const mt of meters) {
    const { x, z, N, T, out } = mt, ry = Math.atan2(N.x, N.z), o = out + 0.001, bx = x + N.x * (o + 0.055), bz = z + N.z * (o + 0.055);
    const paintCol = mt.v < 0.5 ? [0.62, 0.64, 0.62] : [0.5, 0.56, 0.5];
    put('metal_white', new THREE.BoxGeometry(0.24, 0.34, 0.11), at(bx, 1.55, bz, ry), paintCol, 3);
    put('metal_white', new THREE.BoxGeometry(0.27, 0.025, 0.13), at(bx, 1.735, bz, ry), paintCol, 3);                                  // rain lip
    put('glass', new THREE.CylinderGeometry(0.07, 0.07, 0.02, 14), at(x + N.x * (o + 0.118), 1.59, z + N.z * (o + 0.118), ry, Math.PI / 2), [1, 1, 1]);
    put('iron', new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14), at(x + N.x * (o + 0.113), 1.59, z + N.z * (o + 0.113), ry, Math.PI / 2), [1.6, 1.6, 1.6]);
    const cx = x + N.x * (o + 0.022), cz = z + N.z * (o + 0.022);
    const galv = [0.74, 0.75, 0.77];
    put('metal_white', new THREE.CylinderGeometry(0.017, 0.017, 1.38, 8), at(cx, 0.69, cz), galv, 2);                                // conduit down to the pavement
    put('metal_white', new THREE.CylinderGeometry(0.017, 0.017, 1.1, 8), at(cx, 2.27, cz), galv, 2);                                 // and up to the service head
    put('metal_white', new THREE.SphereGeometry(0.035, 8, 6), at(cx, 2.84, cz), galv, 2);
    for (const y of [0.45, 1.1, 2.1, 2.6]) put('metal_white', new THREE.BoxGeometry(0.07, 0.022, 0.03), at(cx, y, cz, ry), [0.6, 0.6, 0.62], 2);   // saddle clips
    stats.meters++;
  }

  // ---- roofs: a water tank on its stand, a TV aerial, a dish. Only where the roof is flat and empty, and never on one the player can reach
  const tankProfile = [[0, 0], [0.5, 0], [0.52, 0.03], [0.52, 0.2], [0.5, 0.23], [0.52, 0.26], [0.52, 0.48], [0.5, 0.51], [0.52, 0.54], [0.52, 0.78], [0.5, 0.81], [0.46, 0.9], [0.34, 1.02], [0.2, 1.08], [0.2, 1.13], [0.23, 1.14], [0.23, 1.18], [0, 1.2]].map(([r, y]) => new THREE.Vector2(r, y));
  const roofFree = (x, z, top, r) => { for (const [dx, dz] of [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]) { const h = cast(x + dx, top + 3, z + dz, 0, -1, 0, 3.4); if (!h || Math.abs(h.point.y - top) > 0.09) return false; } return true; };
  for (const b of world.buildings) {
    if (b.ghost || b.roofAccess || !b.H || b.x1 - b.x0 < 6 || b.z1 - b.z0 < 6) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, top = b.H, r = hash(cx, cz, 60);
    const spot = k => [b.x0 + 1.6 + (b.x1 - b.x0 - 3.2) * hash(cx, cz, 61 + k * 3), b.z0 + 1.6 + (b.z1 - b.z0 - 3.2) * hash(cx, cz, 62 + k * 3)];
    if (r < 0.62) for (let k = 0; k < 3; k++) {
      const [x, z] = spot(k); if (!roofFree(x, z, top, 0.75)) continue;
      const black = hash(cx, cz, 70) < 0.7, sh = 0.45 + 0.5 * hash(cx, cz, 71), ry = hash(cx, cz, 72) * 3;
      put('brick', new THREE.BoxGeometry(1.25, sh, 0.24), at(x, top + sh / 2, z - 0.42, 0), [0.9, 0.86, 0.8], 0.8); put('brick', new THREE.BoxGeometry(1.25, sh, 0.24), at(x, top + sh / 2, z + 0.42, 0), [0.9, 0.86, 0.8], 0.8);
      put('concrete', new THREE.BoxGeometry(1.35, 0.09, 1.3), at(x, top + sh + 0.045, z, 0), [0.85, 0.84, 0.8], 0.6);
      put('plastic', new THREE.LatheGeometry(tankProfile, 20), at(x, top + sh + 0.09, z, ry), black ? [0.03, 0.03, 0.032] : [0.6, 0.5, 0.36]);
      put('iron', new THREE.CylinderGeometry(0.022, 0.022, sh + 0.3, 6), at(x + 0.56, top + (sh + 0.3) / 2, z + 0.1), [1.4, 1.4, 1.4]);                                    // the feed down through the roof
      stats.tanks++; break;
    }
    if (hash(cx, cz, 80) < 0.4) for (let k = 3; k < 5; k++) {                                                                                 // a TV aerial on a guyed mast
      const [x, z] = spot(k); if (!roofFree(x, z, top, 0.25)) continue;
      const hgt = 2.6 + 1.4 * hash(cx, cz, 81), ry = hash(cx, cz, 82) * 6.28;
      put('iron', new THREE.CylinderGeometry(0.018, 0.022, hgt, 6), at(x, top + hgt / 2, z), [1.6, 1.6, 1.6]);
      put('iron', new THREE.BoxGeometry(1.25, 0.018, 0.018), at(x, top + hgt - 0.12, z, ry), [1.8, 1.8, 1.8]);
      for (let j = 0; j < 7; j++) put('iron', new THREE.BoxGeometry(0.012, 0.012, 0.75 - j * 0.07), at(x + Math.cos(ry) * (-0.55 + j * 0.18), top + hgt - 0.12, z - Math.sin(ry) * (-0.55 + j * 0.18), ry), [1.8, 1.8, 1.8]);
      stats.aerials++; break;
    }
    if (hash(cx, cz, 90) < 0.22) for (let k = 5; k < 7; k++) {                                                                                // a dish on a short post
      const [x, z] = spot(k); if (!roofFree(x, z, top, 0.45)) continue;
      const ry = -1.1 + (hash(cx, cz, 91) - 0.5) * 0.5, bowl = Array.from({ length: 9 }, (_, j) => new THREE.Vector2(0.42 * j / 8, 0.16 * (j / 8) ** 2));
      put('iron', new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), at(x, top + 0.45, z), [1.5, 1.5, 1.5]);
      const dish = new THREE.LatheGeometry(bowl, 18); put('plastic', dish, at(x, top + 0.95, z, ry, -1.05), [0.62, 0.62, 0.6]);
      put('iron', new THREE.CylinderGeometry(0.008, 0.008, 0.5, 5), at(x + Math.sin(ry) * 0.2, top + 1.12, z + Math.cos(ry) * 0.2, ry, 0.52), [1.5, 1.5, 1.5]);
      break;
    }
  }
  for (const [key, list] of parts) {
    const g = mergeGeometries(list); if (!g) continue;
    let mt = M[key];
    if (key === 'plastic') { mt = M.plastic.clone(); mt.side = THREE.DoubleSide; mt.name = 'plastic'; mt.userData = { ...M.plastic.userData }; }      // (a dish is seen from both sides)
    const mesh = new THREE.Mesh(g, mt); mesh.name = 'life:' + key; mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    mesh.userData.surf = M[key].userData.surf; if (key === 'iron' || key === 'glass' || key === 'metal_white') mesh.userData.lod = 85;
    group.add(mesh);
  }

  R.scene.add(group); R.setupTree(group);
  console.info(`street life: ${stats.ground} ground decals, ${stats.wall} wall decals, ${stats.meters} meters, ${stats.tanks} tanks, ${stats.aerials} aerials (${stats.rays} rays)`);
  return { group, stats };
}
