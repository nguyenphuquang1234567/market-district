// Screen captures with the heads-up display on them. G.capture saves the WebGL canvas alone; the HUD is DOM drawn over
// it, so this lays #hud out again at the capture size inside an SVG <foreignObject> (with the page's own style sheet)
// and draws that over the frame: the picture the player sees, at an exact size whatever the window's size.
// In the page (dev server running):
//   const hs = await import('/tools/hud-shot.js?v=' + Date.now());
//   hs.size(G, 1920, 1080); ...stage the scene, G.step(n)...; await hs.shot(G, 'hud_fight')   -> captures/hud_fight.jpg
// Size the view first and step a few frames before the shot so exposure settles at the capture size.

// The 3D view at w x h CSS px, drawn at one device pixel per CSS px (the preset's own pixel ratio is put back by the
// next G.capture or a page reload).
export function size(G, w, h) {
  const R = G.R, canvas = R.renderer.domElement;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  R.adaptive = false; R.renderScale = 1; R.resize();
  R.renderScale = w / canvas.width; R.resize();
  G.shotSize = [w, h];
}

// the page's style sheet, retargeted at a <div class="hudcap"> standing in for <html>/<body>
function sheet() {
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n')
    .replace(/html\.touch/g, '.hudcap.touch').replace(/html,\s*body\s*\{/g, '.hudcap {').replace(/(^|[}\s])html\s*\{/g, '$1.hudcap {');
  // (an SVG image starts every CSS animation at 0 ms, so they are switched off: each element shows its settled state)
  return css + '\n.hudcap { position: relative; background: transparent !important; overflow: hidden; }'
    + '\n.hudcap #hud, .hudcap #touch { position: absolute !important; }'
    + '\n.hudcap *, .hudcap *::before, .hudcap *::after { animation: none !important; transition: none !important; }';
}

// #hud (and the touch controls while they are shown) as an SVG image laid out at w x h
async function overlay(w, h, scale) {
  const wrap = document.createElement('div');
  wrap.className = 'hudcap' + (document.documentElement.classList.contains('touch') ? ' touch' : '');
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  const style = document.createElement('style'); style.textContent = sheet(); wrap.append(style);
  for (const id of ['hud', 'touch']) {
    const src = document.getElementById(id);
    if (!src || (id === 'touch' && !src.classList.contains('on'))) continue;
    const copy = src.cloneNode(true);
    // canvases (minimap, compass) do not survive serialising: they go in as images of what they show now
    const live = src.querySelectorAll('canvas'), dead = copy.querySelectorAll('canvas');
    dead.forEach((c, i) => {
      const img = document.createElement('img');
      for (const a of c.attributes) img.setAttribute(a.name, a.value);
      img.setAttribute('src', live[i].toDataURL());
      c.replaceWith(img);
    });
    wrap.append(copy);
  }
  // vw and vh in an SVG image are fractions of the image's drawn size, not of the w x h it is laid out at: turn them into px
  const xhtml = new XMLSerializer().serializeToString(wrap)
    .replace(/(?<![\w.-])(\d*\.?\d+)v([wh])\b/g, (_, n, a) => `${(+n * (a === 'w' ? w : h) / 100).toFixed(3)}px`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">`
    + `<foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  // (onload, not decode(): decode() never settles while the Browser pane is hidden)
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('HUD overlay did not load')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  return img;
}

// The current frame with the HUD over it, saved as captures/<name>.jpg; returns "<name>.jpg WxH".
export async function shot(G, name, { scale = 1, quality = 0.92, hud = true } = {}) {
  const [w, h] = G.shotSize || [innerWidth, innerHeight];
  const img = hud ? await overlay(w, h, scale) : null;
  const out = document.createElement('canvas'); out.width = w * scale; out.height = h * scale;
  const g = out.getContext('2d');
  G.step(0);                                                        // draw the frame, then copy it in the same task
  g.drawImage(G.R.renderer.domElement, 0, 0, out.width, out.height);
  if (img) g.drawImage(img, 0, 0, out.width, out.height);
  const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', quality));
  await fetch('/__capture/' + name + '.jpg', { method: 'POST', body: blob });
  return `${name}.jpg ${out.width}x${out.height}`;
}
