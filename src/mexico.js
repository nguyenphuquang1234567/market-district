// Procedural textures for the market quarter, drawn on canvases at boot: hand-painted shop signs, papel picado, glazed
// talavera tiles, plastic tarps and laurel leaves. Every word is a generic Spanish trade name; no real business or brand.
import { canvasTexture, rng } from './util.js';

// Painted shop signs (rótulos). Each is one cell of the atlas: 4 columns x 8 rows of 512 x 256 px.
// bg: panel colour (null = letters straight on the wall), fg: letters, ln: outline / shadow, f: lettering style.
export const SIGNS = [
  { t: 'ABARROTES', s: '"LA ESPERANZA"', bg: '#f4d03f', fg: '#b03a2e', ln: '#1b4f72', f: 0 },
  { t: 'TORTILLERÍA', s: 'MAÍZ NIXTAMALIZADO', bg: '#1e8449', fg: '#fdfefe', ln: '#145a32', f: 1 },
  { t: 'CARNICERÍA', s: '"EL TORO"', bg: '#c0392b', fg: '#fdfefe', ln: '#641e16', f: 2 },
  { t: 'FRUTAS Y', s: 'VERDURAS', bg: '#f39c12', fg: '#196f3d', ln: '#784212', f: 0, two: true },
  { t: 'FARMACIA', s: 'CONSULTA MÉDICA', bg: '#fdfefe', fg: '#117a65', ln: '#0e6655', f: 3, cross: true },
  { t: 'PANADERÍA', s: 'PAN DE CADA DÍA', bg: '#784212', fg: '#f9e79f', ln: '#3e2723', f: 2 },
  { t: 'FERRETERÍA', s: 'Y TLAPALERÍA', bg: '#2e4053', fg: '#f5b041', ln: '#17202a', f: 1 },
  { t: 'PAPELERÍA', s: 'COPIAS · REGALOS', bg: '#5dade2', fg: '#fdfefe', ln: '#1a5276', f: 3 },
  { t: 'REFACCIONARIA', s: 'ACEITES · LLANTAS', bg: '#17202a', fg: '#f4d03f', ln: '#b7950b', f: 1 },
  { t: 'LAVANDERÍA', s: 'SECADO · PLANCHADO', bg: '#a9cce3', fg: '#154360', ln: '#fdfefe', f: 3 },
  { t: 'COCINA', s: 'ECONÓMICA', bg: '#e74c3c', fg: '#fef9e7', ln: '#7b241c', f: 0, two: true },
  { t: 'JUGOS Y', s: 'LICUADOS', bg: '#58d68d', fg: '#7d3c98', ln: '#fdfefe', f: 2, two: true },
  { t: 'TACOS', s: '"DON CHUY"', bg: '#f5b041', fg: '#922b21', ln: '#17202a', f: 0 },
  { t: 'MERCADO', s: 'MUNICIPAL', bg: null, fg: '#f8f1e3', ln: '#5b2c2c', f: 2, two: true },
  { t: 'POLLERÍA', s: 'POLLO FRESCO', bg: '#f7dc6f', fg: '#a04000', ln: '#6e2c00', f: 1 },
  { t: 'PESCADERÍA', s: '"EL GOLFO"', bg: '#2874a6', fg: '#fdfefe', ln: '#0b2f4a', f: 3 },
  { t: 'ZAPATERÍA', s: 'REPARACIONES', bg: '#6c3483', fg: '#f9e79f', ln: '#311042', f: 2 },
  { t: 'ESTÉTICA', s: 'CORTE · PEINADO', bg: '#f1948a', fg: '#fdfefe', ln: '#943126', f: 3 },
  { t: 'MISCELÁNEA', s: '"LUPITA"', bg: '#48c9b0', fg: '#7b241c', ln: '#0e6251', f: 0 },
  { t: 'DULCERÍA', s: 'PIÑATAS · FIESTAS', bg: '#ec407a', fg: '#fff59d', ln: '#880e4f', f: 1 },
  { t: 'CERRAJERÍA', s: 'DUPLICADO DE LLAVES', bg: '#f0f3f4', fg: '#212f3c', ln: '#c0392b', f: 1 },
  { t: 'CREMERÍA', s: 'QUESOS · CREMA', bg: '#fef9e7', fg: '#1f618d', ln: '#b9770e', f: 2 },
  { t: 'CHILES', s: 'SECOS Y SEMILLAS', bg: '#943126', fg: '#f9e79f', ln: '#4a0e0b', f: 0, two: true },
  { t: 'FLORERÍA', s: '"EL JARDÍN"', bg: '#a3e4d7', fg: '#943126', ln: '#0e6655', f: 3 },
  { t: 'BIENVENIDOS', s: '', bg: null, fg: '#fdfefe', ln: '#1b2631', f: 2 },
  { t: 'AGUA', s: 'PURIFICADA', bg: '#3498db', fg: '#fdfefe', ln: '#1b4f72', f: 1, two: true },
  { t: 'MERCERÍA', s: 'HILOS · BOTONES', bg: '#d7bde2', fg: '#4a235a', ln: '#fdfefe', f: 3 },
  { t: 'CANTINA', s: '"LA PALOMA"', bg: '#1d8348', fg: '#f4d03f', ln: '#0b3d20', f: 2 },
  { t: 'HIELO', s: 'EN BOLSA', bg: '#d6eaf8', fg: '#2471a3', ln: '#1b4f72', f: 0, two: true },
  { t: 'SE RENTA', s: 'INFORMES AQUÍ', bg: '#fdfefe', fg: '#c0392b', ln: '#17202a', f: 1 },
  { t: 'NO ESTACIONARSE', s: '', bg: '#f4d03f', fg: '#17202a', ln: '#17202a', f: 1 },
  { t: 'CALLE DEL', s: 'MERCADO', bg: '#1f3a5f', fg: '#fdfefe', ln: '#fdfefe', f: 3, two: true, plate: true },
];
const FONTS = ['900 {s}px Impact, "Arial Black", sans-serif', 'bold {s}px "Arial Black", Arial, sans-serif', 'bold {s}px Rockwell, Georgia, serif', 'bold {s}px "Futura", "Avenir Next Condensed", "Arial Narrow", sans-serif'];

export function signAtlas() {
  const R = rng(4242);
  return canvasTexture(2048, 2048, (g, W, H) => {
    g.fillStyle = '#8a8378'; g.fillRect(0, 0, W, H);
    SIGNS.forEach((sg, i) => {
      const x0 = (i % 4) * 512, y0 = Math.floor(i / 4) * 256, w = 512, h = 256;
      g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
      // the wall behind (for letters painted straight on it) or the painted panel
      g.fillStyle = sg.bg || '#c9b9a0'; g.fillRect(x0, y0, w, h);
      if (sg.bg) {                                          // a darker border band and a pin-line, as sign painters do
        g.strokeStyle = sg.ln; g.lineWidth = 14; g.strokeRect(x0 + 10, y0 + 10, w - 20, h - 20);
        g.strokeStyle = sg.fg; g.lineWidth = 3; g.strokeRect(x0 + 24, y0 + 24, w - 48, h - 48);
      }
      const font = (k, size) => FONTS[k].replace('{s}', size);
      const fit = (text, k, size, maxW) => { let s = size; g.font = font(k, s); while (g.measureText(text).width > maxW && s > 20) { s -= 4; g.font = font(k, s); } return s; };
      const paint = (text, cy, size, k) => {
        if (!text) return;
        const s = fit(text, k, size, w - 70);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = sg.ln; g.fillText(text, x0 + w / 2 + s * 0.05, cy + s * 0.06);       // painted drop shadow
        g.fillStyle = sg.fg; g.fillText(text, x0 + w / 2, cy);
      };
      if (sg.cross) { g.fillStyle = '#1e8449'; g.fillRect(x0 + 40, y0 + 88, 26, 80); g.fillRect(x0 + 13, y0 + 115, 80, 26); }
      if (sg.two) { paint(sg.t, y0 + h * 0.38, 96, sg.f); paint(sg.s, y0 + h * 0.70, 78, sg.f); }
      else { paint(sg.t, y0 + h * (sg.s ? 0.42 : 0.5), sg.s ? 104 : 96, sg.f); paint(sg.s, y0 + h * 0.76, 38, 3); }
      // sun-faded and chipped: pale wash, flakes where the paint has gone, grime from the top edge
      g.globalAlpha = 0.10 + R() * 0.12; g.fillStyle = '#fff6e0'; g.fillRect(x0, y0, w, h); g.globalAlpha = 1;
      for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(${150 + R() * 60 | 0},${140 + R() * 50 | 0},${120 + R() * 40 | 0},${0.35 + R() * 0.5})`; const fx = x0 + R() * w, fy = y0 + R() * h, r = 1 + R() * 7; g.beginPath(); g.ellipse(fx, fy, r * (1 + R()), r, R() * 3, 0, 6.3); g.fill(); }
      const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, 'rgba(40,30,20,0.28)'); gr.addColorStop(0.3, 'rgba(40,30,20,0)'); gr.addColorStop(1, 'rgba(40,30,20,0.12)');
      g.fillStyle = gr; g.fillRect(x0, y0, w, h);
      for (let k = 0; k < 14; k++) { const sx = x0 + R() * w, len = 20 + R() * 90; const st = g.createLinearGradient(0, y0, 0, y0 + len); st.addColorStop(0, 'rgba(50,40,30,0.25)'); st.addColorStop(1, 'rgba(50,40,30,0)'); g.fillStyle = st; g.fillRect(sx, y0, 2 + R() * 5, len); }
      g.restore();
    });
  });
}
export const signUV = i => { const c = i % 4, r = Math.floor(i / 4); return [c / 4 + 0.002, 1 - (r + 1) / 8 + 0.002, (c + 1) / 4 - 0.002, 1 - r / 8 - 0.002]; };      // [u0, v0, u1, v1] for Builder.quad

// Papel picado: eight cut-paper flag designs in a row (white, tinted per flag through vertex colour; holes are alpha).
export function papelTexture() {
  const R = rng(77);
  const t = canvasTexture(1024, 256, (g, W) => {
    g.clearRect(0, 0, W, 256);
    for (let i = 0; i < 8; i++) {
      const x0 = i * 128, w = 128, h = 176, cx = x0 + 64;
      g.save(); g.beginPath(); g.rect(x0 + 2, 0, w - 4, 256); g.clip();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x0 + 4, 6);
      g.lineTo(x0 + w - 4, 6); g.lineTo(x0 + w - 4, h - 14);
      for (let k = 0; k <= 8; k++) { const x = x0 + w - 4 - k * (w - 8) / 8; g.lineTo(x, h - 14 + (k % 2 ? 12 : 0)); }           // pinked hem
      g.closePath(); g.fill();
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(x0 + 12 + k * 13, 18, 3.2, 0, 6.3); g.fill(); }                   // a row of punched holes under the string
      g.fillRect(x0 + 10, 28, w - 20, 3);
      const motif = i % 8;
      g.save(); g.translate(cx, 98);
      if (motif === 0 || motif === 4) {                     // flower
        for (let p = 0; p < 8; p++) { g.rotate(Math.PI / 4); g.beginPath(); g.ellipse(0, -24, 7, 15, 0, 0, 6.3); g.fill(); }
        g.beginPath(); g.arc(0, 0, 8, 0, 6.3); g.fill();
      } else if (motif === 1 || motif === 5) {              // star in a diamond lattice
        for (let p = 0; p < 5; p++) { g.rotate(Math.PI * 2 / 5); g.beginPath(); g.moveTo(0, -38); g.lineTo(8, -10); g.lineTo(-8, -10); g.fill(); }
        g.beginPath(); g.arc(0, 0, 10, 0, 6.3); g.fill();
      } else if (motif === 2 || motif === 6) {              // bird
        g.beginPath(); g.ellipse(0, 0, 26, 12, -0.3, 0, 6.3); g.fill(); g.beginPath(); g.moveTo(-6, -6); g.quadraticCurveTo(-30, -40, 12, -34); g.quadraticCurveTo(4, -18, 4, -6); g.fill();
        g.beginPath(); g.moveTo(22, -10); g.lineTo(36, -16); g.lineTo(24, -2); g.fill();
      } else {                                              // sun
        g.beginPath(); g.arc(0, 0, 15, 0, 6.3); g.fill();
        for (let p = 0; p < 12; p++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(-4, -20); g.lineTo(4, -20); g.lineTo(0, -36); g.fill(); }
      }
      g.restore();
      for (let k = 0; k < 6; k++) { const yy = 60 + R() * 80; for (const sx of [x0 + 16, x0 + w - 16]) { g.beginPath(); g.ellipse(sx, yy, 3, 7, 0, 0, 6.3); g.fill(); } }    // side lattice
      g.globalCompositeOperation = 'source-over';
      g.restore();
    }
  });
  t.anisotropy = 4;
  return t;
}
export const papelUV = i => [i / 8 + 0.004, 1 - 176 / 256, (i + 1) / 8 - 0.004, 1 - 2 / 256];
export const PAPEL_COLOURS = [[0.95, 0.18, 0.45], [0.98, 0.55, 0.08], [0.98, 0.85, 0.15], [0.25, 0.78, 0.35], [0.15, 0.55, 0.92], [0.55, 0.25, 0.80], [0.95, 0.25, 0.20], [0.10, 0.75, 0.75], [1.0, 0.45, 0.70]];

// Talavera: glazed tiles, cobalt and ochre on white, each tile hand-painted a little differently. 4 x 4 tiles.
export function talaveraTexture() {
  const R = rng(1531);
  return canvasTexture(512, 512, g => {
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const x0 = tx * 128, y0 = ty * 128, c = 64;
      g.fillStyle = `rgb(${244 + R() * 8 | 0},${238 + R() * 10 | 0},${222 + R() * 12 | 0})`; g.fillRect(x0, y0, 128, 128);
      g.save(); g.translate(x0 + c, y0 + c);
      const blue = `rgb(${24 + R() * 20 | 0},${52 + R() * 24 | 0},${140 + R() * 30 | 0})`, ochre = `rgb(${214 + R() * 20 | 0},${140 + R() * 30 | 0},${30 + R() * 20 | 0})`;
      g.fillStyle = blue;
      for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(0, -12); g.quadraticCurveTo(26, -40, 0, -58); g.quadraticCurveTo(-26, -40, 0, -12); g.fill(); }   // four leaves
      g.fillStyle = ochre; g.beginPath(); g.arc(0, 0, 13, 0, 6.3); g.fill();
      g.fillStyle = blue; g.beginPath(); g.arc(0, 0, 6, 0, 6.3); g.fill();
      g.strokeStyle = ochre; g.lineWidth = 5;
      for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.beginPath(); g.arc(c, c, 34, Math.PI, Math.PI * 1.5); g.stroke(); }                        // quarter rings meeting the next tile
      g.restore();
      g.fillStyle = 'rgba(90,80,70,0.55)'; g.fillRect(x0, y0, 128, 2); g.fillRect(x0, y0, 2, 128);                                                 // grout
      for (let k = 0; k < 8; k++) { g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.2})`; g.fillRect(x0 + R() * 120, y0 + R() * 120, 2 + R() * 6, 1); }    // glaze glints
    }
  });
}

// Tarps: four bands stacked in V (blue/white, red/white, orange, green/yellow stripes along U), each band 128 px.
export function tarpTexture() {
  const designs = [['#1f5fa8', '#e9eef2'], ['#b8322a', '#efe7dc'], ['#e8731e', '#f2a03a'], ['#2f8a4a', '#e8d34a']];
  const R = rng(31);
  return canvasTexture(256, 512, (g, W) => {
    designs.forEach(([a, b], i) => {
      const y0 = i * 128;
      for (let x = 0; x < W; x += 32) { g.fillStyle = (x / 32) % 2 ? b : a; g.fillRect(x, y0, 32, 128); }
      for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(0,0,0,${R() * 0.06})`; g.fillRect(R() * W, y0 + R() * 128, 1 + R() * 3, 1); }
    });
  });
}
export const tarpV = i => [i * 0.25 + 0.03, 0.19];            // [v offset, v scale] for one band (Builder sheet: vo, vs)

// Laurel (Indian laurel fig) foliage: overlapping small glossy leaves on transparent ground.
export function leavesTexture() {
  const R = rng(9090);
  const t = canvasTexture(512, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 1100; i++) {
      const x = R() * W, y = R() * H, a = R() * 6.3, l = 9 + R() * 9, sh = 0.55 + R() * 0.45;
      const edge = Math.min(x, y, W - x, H - y); if (edge < 10 && R() < 0.7) continue;
      g.fillStyle = `rgb(${(40 + R() * 40) * sh | 0},${(80 + R() * 60) * sh | 0},${(25 + R() * 25) * sh | 0})`;
      g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, l, l * 0.42, 0, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(200,230,150,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-l * 0.8, 0); g.lineTo(l * 0.8, 0); g.stroke();
      g.restore();
    }
  });
  t.anisotropy = 4;
  return t;
}

// Bougainvillea: papery magenta bracts in clusters among small dark leaves, on transparent ground.
export function flowersTexture() {
  const R = rng(5150);
  const t = canvasTexture(512, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 420; i++) {                                            // leaves first, underneath
      const x = R() * W, y = R() * H, a = R() * 6.3, l = 7 + R() * 7;
      if (Math.min(x, y, W - x, H - y) < 12 && R() < 0.7) continue;
      g.fillStyle = `rgb(${30 + R() * 25 | 0},${70 + R() * 40 | 0},${25 + R() * 20 | 0})`;
      g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, l, l * 0.5, 0, 0, 6.3); g.fill(); g.restore();
    }
    for (let c = 0; c < 70; c++) {                                             // bract clusters: three papery petals round a pale centre, many together
      const cx = 30 + R() * (W - 60), cy = 30 + R() * (H - 60), n = 5 + R() * 9 | 0;
      for (let i = 0; i < n; i++) {
        const x = cx + (R() - 0.5) * 34, y = cy + (R() - 0.5) * 34, s = 4 + R() * 5, hue = R();
        const col = hue < 0.7 ? `rgb(${200 + R() * 40 | 0},${30 + R() * 40 | 0},${120 + R() * 50 | 0})` : `rgb(${230 + R() * 20 | 0},${80 + R() * 40 | 0},${160 + R() * 40 | 0})`;
        g.fillStyle = col;
        for (let k = 0; k < 3; k++) { const a = k * 2.09 + R() * 0.4; g.beginPath(); g.ellipse(x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 0.7, s, s * 0.7, a, 0, 6.3); g.fill(); }
        g.fillStyle = 'rgba(250,240,220,0.9)'; g.beginPath(); g.arc(x, y, 1.2, 0, 6.3); g.fill();
      }
    }
  });
  t.anisotropy = 4;
  return t;
}

// ---- the detail pass (tools/blender/props.py): textures mapped by the pieces' own texture coordinates ----------------
// Each is drawn the way up Blender's UVs count (base of a blade at the bottom of the canvas, its tip at the top), which
// is how Builder.kit() hands them over.

// Laurel (Ficus microcarpa) leaves: four blades side by side, one per quarter of the width (u = i / 4 ... (i + 1) / 4),
// glossy dark green with a paler midrib and fine veins, on transparent ground. A blade fills its column, base at the bottom.
export function leafTexture() {
  const R = rng(6161), tones = [[38, 78, 30], [48, 92, 34], [70, 112, 40], [56, 84, 32]];
  const t = canvasTexture(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const cw = W / 4;
    for (let i = 0; i < 4; i++) {
      const cx = cw * i + cw / 2, [r, gg, b] = tones[i], half = cw * 0.44, y0 = H - 3, y1 = 3, len = y0 - y1;
      const edge = s => { const t = s / len; return half * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75) * (1 - 0.25 * t); };   // widest a little below the middle, an acuminate tip
      const blade = new Path2D(); blade.moveTo(cx, y0);
      for (let s = 0; s <= len; s += 2) blade.lineTo(cx - edge(s), y0 - s);
      for (let s = len; s >= 0; s -= 2) blade.lineTo(cx + edge(s), y0 - s);
      blade.closePath();
      const grad = g.createLinearGradient(cx - half, 0, cx + half, 0);       // the blade folds on its midrib: one half catches more light
      grad.addColorStop(0, `rgb(${r * 0.78 | 0},${gg * 0.8 | 0},${b * 0.8 | 0})`); grad.addColorStop(0.5, `rgb(${r * 1.1 | 0},${gg * 1.08 | 0},${b | 0})`); grad.addColorStop(1, `rgb(${r * 0.92 | 0},${gg * 0.94 | 0},${b * 0.9 | 0})`);
      g.fillStyle = grad; g.fill(blade);
      g.save(); g.clip(blade);
      g.strokeStyle = `rgba(${150 + R() * 30 | 0},${190 + R() * 30 | 0},${110 + R() * 20 | 0},0.55)`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y1 + 6); g.stroke();                        // midrib
      g.lineWidth = 0.8; g.strokeStyle = 'rgba(170,205,120,0.28)';
      for (let s = 14; s < len - 10; s += 9 + R() * 3) for (const sd of [-1, 1]) {               // side veins, curving up to the edge
        g.beginPath(); g.moveTo(cx, y0 - s); g.quadraticCurveTo(cx + sd * edge(s) * 0.5, y0 - s - 8, cx + sd * edge(s + 10) * 0.92, y0 - s - 16); g.stroke();
      }
      if (i === 3) { g.strokeStyle = 'rgba(120,90,40,0.55)'; g.lineWidth = 3; g.stroke(blade); }   // one with a dry edge
      g.restore();
    }
  });
  t.anisotropy = 8;
  return t;
}

// Canary palm leaflets: four long narrow leaflets in u 0 ... 0.8 (columns 0.2 wide, base at the bottom), with parallel
// veins and a paler midrib, the last yellowing to a brown tip; the rachis's colour in u 0.85 ... 1 (fibrous, pale green).
export function palmLeafTexture() {
  const R = rng(7272), tones = [[72, 112, 42], [86, 124, 46], [99, 134, 50], [126, 136, 58]];      // (as bright as the old frond's drawing)
  const t = canvasTexture(256, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const cw = W * 0.2;
    for (let i = 0; i < 4; i++) {
      const cx = cw * i + cw / 2, half = cw * 0.4, y0 = H - 2, y1 = 4, len = y0 - y1, [r, gg, b] = tones[i];
      const edge = s => half * Math.min(1, (s / len) * 9) * Math.pow(1 - s / len, 0.6);   // narrow at the base, widest a tenth up, tapering to a sharp tip
      const leaf = new Path2D(); leaf.moveTo(cx, y0);
      for (let s = 0; s <= len; s += 3) leaf.lineTo(cx - edge(s), y0 - s);
      for (let s = len; s >= 0; s -= 3) leaf.lineTo(cx + edge(s), y0 - s);
      leaf.closePath();
      const grad = g.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, `rgb(${r * 0.85 | 0},${gg * 0.85 | 0},${b * 0.8 | 0})`); grad.addColorStop(0.6, `rgb(${r},${gg},${b})`);
      grad.addColorStop(1, i === 3 ? 'rgb(150,112,60)' : `rgb(${r * 1.1 | 0},${gg * 1.05 | 0},${b | 0})`);
      g.fillStyle = grad; g.fill(leaf);
      g.save(); g.clip(leaf);
      g.lineWidth = 0.7;
      for (let k = -3; k <= 3; k++) { if (!k) continue; g.strokeStyle = `rgba(${40 + R() * 20 | 0},${70 + R() * 20 | 0},30,0.35)`; g.beginPath(); g.moveTo(cx + k * half * 0.22, y0); g.lineTo(cx + k * half * 0.05, y1); g.stroke(); }
      g.strokeStyle = 'rgba(205,215,150,0.6)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y1 + 10); g.stroke();
      g.restore();
    }
    const x0 = W * 0.85;                                                       // the rachis: pale green-yellow, fibrous
    g.fillStyle = 'rgb(150,150,86)'; g.fillRect(x0, 0, W - x0, H);
    for (let k = 0; k < 90; k++) { const x = x0 + R() * (W - x0); g.strokeStyle = `rgba(${90 + R() * 60 | 0},${100 + R() * 50 | 0},${50 + R() * 30 | 0},0.5)`; g.lineWidth = 0.6 + R(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (R() - 0.5) * 3, H); g.stroke(); }
  });
  t.anisotropy = 8;
  return t;
}

// Piñata tissue: rows of fringed paper in v 0 ... 0.75 (six rows, each a solid band with its lower part cut into a fringe;
// the piece lays them overlapping round the body and the cones), crêpe streamer in v 0.75 ... 1. White, tinted per slot.
export function paperTexture() {
  const R = rng(8383);
  const t = canvasTexture(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const rows = 6, band = H * 0.75 / rows;
    for (let k = 0; k < rows; k++) {
      const y1 = H - k * band, y0 = y1 - band, solid = y0 + band * 0.3;          // canvas y grows downwards: the row's top is y0
      g.fillStyle = 'rgb(238,236,232)'; g.fillRect(0, y0, W, solid - y0 + 1);
      for (let x = 0; x < W; x += 4) {                                           // fringe strips, 3 px wide, slightly ragged ends
        const c = 222 + R() * 30 | 0, l = (y1 - solid) * (0.82 + R() * 0.18);
        g.fillStyle = `rgb(${c},${c - 2},${c - 6})`; g.fillRect(x, solid, 3, l);
      }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, solid - 1, W, 2);         // the fold where the fringe hangs from
    }
    const s0 = 0, s1 = H * 0.25;                                                 // crêpe streamer: fine horizontal crinkles
    g.fillStyle = 'rgb(236,234,230)'; g.fillRect(0, s0, W, s1 - s0);
    for (let y = s0; y < s1; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + R() * 0.08})`; g.fillRect(0, y, W, 1); }
  });
  t.anisotropy = 4;
  return t;
}
