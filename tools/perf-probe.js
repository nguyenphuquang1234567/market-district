// Performance probe: GPU-synced frame time at fixed views, draw calls, triangles and an estimate of GPU memory.
// In the page (dev server running):
//   const perf = await import('/tools/perf-probe.js?v=' + Date.now());
//   await perf.run(G)                    -> { size, views: [...], memory: {...} }
//   perf.gpuMemory(G)                    -> bytes by category (estimate: WebGL cannot report real usage)
// The wait on the GPU is a 1-pixel readPixels; the exposure meter's asynchronous read can leave a pixel-pack buffer bound,
// which makes that call fail (and the wait silently not happen), so it is unbound first.
// Every view is measured with the bots parked, the canvas at 1512 x 846 CSS px (1890 x 1057 on High) and the
// adaptive resolution held at full scale, so before/after runs compare like with like.

export const VIEWS = {
  main_street: [0.6, -56, 0, 2],          // long sightline north along the main street
  arch_plaza: [1.5, -9, 14, 6],           // arch, plaza and fountain
  market_lane: [28.4, -47, 0, 3],         // covered market lane
  alley: [-29, -45, 0, 2],                // laundry alley
  gate_north: [28.4, 20, 90, 2],          // from the market lane east through the north passage (beyond the old map's edge)
  hall_portal: [47.5, 0, 90, 6],          // market quarter: the hall's portal from Calle del Mercado
  hall_inside: [61, 3.2, 100, 8],         // market quarter: inside the hall
  plazuela: [74.6, -27.5, 135, 3],        // market quarter: the plazuela and its kiosk
};

const park = G => { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };

// One discarded warm-up pass, then `repeat` passes; each view's median (robust to a stray slow or fast pass).
export async function median(G, { repeat = 3, ...o } = {}) {
  await run(G, { ...o, frames: 30 });
  const runs = [];
  for (let r = 0; r < repeat; r++) runs.push(await run(G, o));
  const out = runs[0];
  out.views = out.views.map((v, i) => { const s = runs.map(r => r.views[i]).sort((a, b) => a.mean - b.mean); return { ...s[Math.floor(s.length / 2)], spread: +(s[s.length - 1].mean - s[0].mean).toFixed(2) }; });
  return out;
}

// The same, several times over, keeping each view's best run (background work on the machine only ever slows a run).
export async function best(G, { repeat = 3, ...o } = {}) {
  let out = null;
  for (let r = 0; r < repeat; r++) {
    const res = await run(G, o);
    if (!out) out = res; else res.views.forEach((v, i) => { if (v.mean < out.views[i].mean) out.views[i] = v; });
  }
  return out;
}

export async function run(G, { frames = 120, views = Object.keys(VIEWS), w = 1512, h = 846 } = {}) {
  const R = G.R, canvas = R.renderer.domElement, gl = R.renderer.getContext(), px = new Uint8Array(4);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  R.renderScale = 1; R.adaptive = false; R.resize();
  G.manual = true; G.auto = true; G.frozen = true;
  if (!G.matchLive) G.resetMatch();
  G.playing = true; G.hud.show(null); park(G);
  const out = [];
  for (const name of views) {
    const [x, z, yaw, pitch] = VIEWS[name];
    G.goto(x, z, yaw, pitch); G.player.sim = { f: 0, s: 0, yaw: G.player.yaw, pitch: G.player.pitch };
    G.step(120, 1 / 60);                                                     // exposure and shadows settle
    const ts = [];
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); G.step(1, 1 / 60); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); }
    ts.splice(0, 10); ts.sort((a, b) => a - b);
    const mean = ts.reduce((a, b) => a + b, 0) / ts.length, info = R.renderer.info.render;
    out.push({ view: name, mean: +mean.toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(2), worst: +ts[ts.length - 1].toFixed(2), fps: Math.round(1000 / mean), calls: info.calls, tris: Math.round(info.triangles / 1000) + 'k' });
    await new Promise(r => setTimeout(r, 0));
  }
  G.manual = false;
  return { size: `${canvas.width}x${canvas.height}`, views: out, memory: gpuMemory(G) };
}

// Where a frame's time goes: each view timed whole, then again with one thing held or switched off (the cascades not
// redrawn, no ambient occlusion, no bloom, no multisampling, a quarter of the pixels), and the time spent in JavaScript
// submitting the frame (not waiting on the GPU). The differences are each part's share; they overlap a little.
export async function profile(G, { frames = 70, views = ['main_street', 'arch_plaza', 'hall_inside'], w = 1512, h = 846 } = {}) {
  const R = G.R, canvas = R.renderer.domElement, gl = R.renderer.getContext(), px = new Uint8Array(4);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  R.renderScale = 1; R.adaptive = false; R.resize();
  G.manual = true; G.auto = true; G.frozen = true;
  if (!G.matchLive) G.resetMatch();
  G.playing = true; G.hud.show(null); park(G);
  const time = (sync = true) => {
    const ts = [];
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); G.step(1, 1 / 60); if (sync) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } ts.push(performance.now() - t0); }
    if (!sync) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    ts.splice(0, 10); ts.sort((a, b) => a - b);
    return +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2);
  };
  const samples = R.sceneRT.samples, out = [];
  const cases = {
    full: [() => {}, () => {}],
    js_only: null,
    no_shadow_redraw: [() => { R.freezeShadows = true; }, () => { R.freezeShadows = false; }],
    no_ao: [() => { if (R.gtao) R.gtao.enabled = false; }, () => { if (R.gtao) R.gtao.enabled = true; }],
    no_bloom: [() => { if (R.bloom) R.bloom.enabled = false; }, () => { if (R.bloom) R.bloom.enabled = true; }],
    no_atmos: [() => { if (R.atmos) R.atmos.enabled = false; }, () => { if (R.atmos) R.atmos.enabled = true; }],
    no_msaa: [() => { R.sceneRT.samples = 0; R.sceneRT.dispose(); }, () => { R.sceneRT.samples = samples; R.sceneRT.dispose(); }],
    quarter_pixels: [() => { R.renderScale = 0.5; R.resize(); }, () => { R.renderScale = 1; R.resize(); }],
  };
  for (const name of views) {
    const [x, z, yaw, pitch] = VIEWS[name], row = { view: name };
    G.goto(x, z, yaw, pitch); G.player.sim = { f: 0, s: 0, yaw: G.player.yaw, pitch: G.player.pitch };
    G.step(120, 1 / 60);
    for (const [k, c] of Object.entries(cases)) {
      if (!c) { row[k] = time(false); continue; }
      c[0](); G.step(12, 1 / 60); row[k] = time(); c[1](); G.step(4, 1 / 60);
    }
    const i = R.renderer.info.render; row.calls = i.calls; row.tris = Math.round(i.triangles / 1000) + 'k';
    out.push(row); await new Promise(r => setTimeout(r, 0));
  }
  G.manual = false;
  return { size: `${canvas.width}x${canvas.height}`, views: out };
}

// ---- GPU memory estimate --------------------------------------------------------------------------------------------------
function texBytes(t) {
  if (!t) return 0;
  if (t.isCompressedTexture) return (t.mipmaps || []).reduce((s, m) => s + (m.data ? m.data.byteLength : 0), 0) * (t.isCompressedArrayTexture ? 1 : 1);
  const img = t.image;
  if (!img) return 0;
  const mips = t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1;      // LinearFilter / NearestFilter: no chain
  if (img.data) return img.data.byteLength * (t.isData3DTexture ? 1 : mips) * (t.type === 1016 && img.data.BYTES_PER_ELEMENT === 2 ? 1 : 1);
  const w = img.width || img.videoWidth || 0, h = img.height || img.videoHeight || 0;
  const bpp = t.type === 1016 ? 8 : t.type === 1015 ? 16 : 4;                                       // HalfFloat / Float / UnsignedByte (RGBA)
  return w * h * bpp * mips;
}
function geoBytes(g) {
  let s = 0;
  for (const a of Object.values(g.attributes)) s += a.array ? a.array.byteLength : 0;
  if (g.index) s += g.index.array.byteLength;
  return s;
}

let giU = null, assetsMod = null;
export async function init() {
  giU = (await import('/src/render.js')).giUniforms;          // the same module instances the game loaded
  assetsMod = (await import('/src/assets.js')).assets;
}
await init();

export function gpuMemory(G) {
  G.giUniformsRef = giU; G.assetsRef = assetsMod;
  const R = G.R, seen = new Set(), geos = new Set(), cat = { sceneTextures: 0, modelTextures: 0, giVolume: 0, renderTargets: 0, shadowMaps: 0, geometry: 0, instanceBuffers: 0 };
  const addTex = (t, key) => { if (!t || !t.isTexture || seen.has(t)) return; seen.add(t); cat[key] += texBytes(t); };
  const scanMat = (m, key) => {
    for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) addTex(v, key); }
    if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; if (v && v.isTexture) addTex(v, key); }
    if (m.userData && m.userData.layers) for (const v of Object.values(m.userData.layers)) addTex(v, key);
  };
  // the GI volume and shared noise first, so they are not counted as scene textures
  for (const k of ['tGiR', 'tGiG', 'tGiB']) addTex(G.giUniformsRef?.[k]?.value, 'giVolume');
  R.scene.traverse(o => {
    if (o.isInstancedMesh) cat.instanceBuffers += o.instanceMatrix.array.byteLength;
    if (o.geometry && !geos.has(o.geometry)) { geos.add(o.geometry); cat.geometry += geoBytes(o.geometry); }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    const key = /^(prop:|dyn:)/.test(o.name) || o.isSkinnedMesh ? 'modelTextures' : 'sceneTextures';
    for (const m of mats) scanMat(m, key);
  });
  if (G.assetsRef) for (const set of Object.values(G.assetsRef.tex)) for (const t of Object.values(set)) addTex(t, 'sceneTextures');   // layer textures bound only through shader patches
  addTex(R.scene.environment, 'sceneTextures');
  // render targets: the MSAA scene target, its resolve, the post chain, AO, bloom, shadow cascades, the drawing buffer
  const c = R.renderer.domElement, W = c.width, H = c.height, px = W * H, ms = R.Q.msaa || 0;
  let rt = px * 8 * Math.max(1, ms) + px * 4 * Math.max(1, ms) + px * 8 + px * 4;        // scene colour (half float) + depth, multisampled, plus the resolve
  rt += 2 * px * 8;                                                                       // composer ping-pong
  if (R.Q.ao) rt += px * R.Q.aoScale * R.Q.aoScale * 4 * 3;                               // GTAO, denoise, blend
  if (R.Q.bloom) rt += px * 8 * 2 / 3;                                                    // bloom mip chain (two per level)
  rt += px * 4 * 3;                                                                       // drawing buffer (front, back, depth)
  rt += 32 * 18 * 4;
  cat.renderTargets = rt;
  for (const l of R.csm.lights) { const s = l.shadow.mapSize; cat.shadowMaps += s.x * s.y * 8; }
  const total = Object.values(cat).reduce((a, b) => a + b, 0), MB = v => +(v / 1048576).toFixed(1);
  const info = R.renderer.info.memory;
  return { totalMB: MB(total), ...Object.fromEntries(Object.entries(cat).map(([k, v]) => [k + 'MB', MB(v)])), textures: seen.size, geometries: geos.size, rendererCounts: { textures: info.textures, geometries: info.geometries } };
}
