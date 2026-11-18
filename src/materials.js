// PBR material library built on the scanned texture sets, plus the shader patches that make them look weathered.
import * as THREE from 'three';
import { assets } from './assets.js';
import { noiseTexture, canvasTexture, rng } from './util.js';
import { signAtlas, papelTexture, talaveraTexture, tarpTexture, leavesTexture, flowersTexture, leafTexture, leafMassTexture, palmLeafTexture, paperTexture } from './mexico.js';

export const noise = noiseTexture(256, 11);
export const windUniforms = { uTime: { value: 0 } };
// Foliage drawn as alpha-tested cards and blades: no ambient occlusion, no ray trees, not an occluder in the light bake.
export const FOLIAGE = ['frond', 'leaves', 'flowers', 'leaf', 'leaf_mass', 'palm_leaf'];

function pbr(id, o = {}) {
  const t = assets.tex[id];
  const m = new THREE.MeshStandardMaterial({
    map: t.diff, normalMap: t.nor, roughnessMap: t.arm, aoMap: t.arm, aoMapIntensity: 0.9,
    roughness: 1, metalness: o.metal ? 1 : 0, metalnessMap: o.metal ? t.arm : null,
    vertexColors: true, side: o.side ?? THREE.FrontSide,
  });
  if (o.normalScale) m.normalScale.setScalar(o.normalScale);
  if (o.color) m.color.set(o.color);
  return m;
}

// World-space weathering: large tonal blotches, rain streaks down walls and splash-back dirt near the ground.
// peel { lo, hi, flat, mean }: the texture is paint flaking off plaster, and the vertex tint (the paint's colour) takes
// only where its texel is lighter than lo..hi; the plaster showing through keeps its own grey. Over the paint the
// plaster's grain is evened out by `flat` towards `mean` (the painted texels' average, so the tint still lands on it).
// stone: the clouding, grain and inclusions of cut stone, in world space (so it runs unbroken over a moulding's pieces).
// age: the paint's age per building, in the vec3 attribute aAge (the builder's extra attribute, o.x): x how far the sun
// has bleached it, y how much road dust and rising damp it has taken, z 1 + the height (m) the street floor was repainted
// to. (1, 1, 1), what anything drawn without it gets, is a common amount of both and no repainting.
function weather(m, grime = 1, macro = 1, peel = null, age = false, stone = 0) {
  m.userData.patchKey = `w${grime}_${macro}` + (peel ? `_p${peel.lo}_${peel.hi}_${peel.flat}` : '') + (age ? '_age' : '') + (stone ? `_s${stone}` : '');
  if (age) m.userData.extra = 'aAge';
  m.userData.patch = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + (age ? '\nattribute vec3 aAge;\nvarying vec3 vAge;' : ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' + (age ? '\nvAge = aAge;' : ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + (age ? '\nvarying vec3 vAge;' : ''))
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 gn = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
          float along = gn.x > gn.z ? vWPos.z : vWPos.x;
          float wall = 1.0 - step(0.7, gn.y);
          vec2 wuv = wall > 0.5 ? vec2(along, vWPos.y) : vWPos.xz;
          float n1 = texture2D(tCloud, wuv * 0.037).r;
          float n2 = texture2D(tCloud, wuv * 0.19 + 0.37).g;
          // rain streaks: two scales at odd ratios, and whole stretches of wall left clean, so they never repeat in step
          float st = texture2D(tCloud, vec2(along * 0.23 + 0.31, vWPos.y * 0.022)).b * 0.62 + texture2D(tCloud, vec2(along * 0.067 + 0.7, vWPos.y * 0.009)).b * 0.38;
          float sm = smoothstep(0.35, 0.65, texture2D(tCloud, vec2(along * 0.021 + vWPos.y * 0.004, 0.37)).r);
          diffuseColor.rgb *= mix(1.0, mix(0.78, 1.10, n1) * mix(0.90, 1.07, n2), ${macro.toFixed(2)});
          diffuseColor.rgb *= 1.0 - smoothstep(0.50, 0.78, st) * sm * wall * 0.34 * ${macro.toFixed(2)};
          float g = wall * (1.0 - smoothstep(0.05, 0.7 + n2 * 1.1, vWPos.y)) * ${grime.toFixed(2)}${age ? ' * vAge.y * 0.75' : ''};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.58, 0.47), g * 0.8);
          ${stone ? `{   // cut stone: clouds a hand or two across, warmer and cooler, a finer grain, and a few dark inclusions
            vec2 wr = vec2(wuv.x * 0.8 + wuv.y * 0.6, wuv.y * 0.8 - wuv.x * 0.6);                  // (a second, turned lookup: the two never line up, so no tile shows)
            float s1 = texture2D(tCloud, wuv * 1.3 + 0.11).g, s2 = texture2D(tCloud, wr * 3.1 + 0.53).r, s3 = texture2D(tCloud, wr * 9.7 + 0.29).b * texture2D(tCloud, wuv * 6.1 + 0.61).g;
            diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.84, 0.83, 0.82), vec3(1.12, 1.09, 1.05), s1) * mix(0.94, 1.05, s2), ${stone.toFixed(2)});
            diffuseColor.rgb *= 1.0 - smoothstep(0.28, 0.62, s3) * 0.11 * ${stone.toFixed(2)};
          }` : ''}
        }`);
    if (!peel && !age) return;
    const paint = peel ? `{
          vec3 tx = sampledDiffuseColor.rgb;
          float pm = smoothstep(${peel.lo.toFixed(3)}, ${peel.hi.toFixed(3)}, dot(tx, vec3(0.2126, 0.7152, 0.0722)));
          vec3 even = mix(tx, vec3(${peel.mean.map(v => v.toFixed(3)).join(', ')}), ${peel.flat.toFixed(2)}) / max(tx, vec3(0.02));
          diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb * even, pm);
        }` : 'diffuseColor.rgb *= vColor.rgb;';
    const aged = !age ? '' : `{
        vec3 gq = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
        float wl = 1.0 - step(0.7, gq.y), al = gq.x > gq.z ? vWPos.z : vWPos.x, yy = vWPos.y;
        float na = texture2D(tCloud, vec2(al, yy) * 0.043 + 0.21).r;            // patches a few metres across
        float nb = texture2D(tCloud, vec2(al * 0.29 + 0.53, 0.17)).g;            // varies along the wall only
        float nc = texture2D(tCloud, vec2(al * 0.06 + 0.11, 0.61)).b;            // the same, slowly (metres to tens of metres)
        float rp = vAge.z - 1.0, fresh = rp > 0.05 ? 1.0 - smoothstep(rp - 0.012, rp + 0.012, yy) : 0.0, old = rp > 0.05 ? 1.0 - fresh : 0.0;
        float lm = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        // bleached by the sun: chalky, lighter and greyer, more of it higher up and in patches, none on new paint (and on a
        // house whose street floor was repainted, the old coat above it shows its age)
        float fd = vAge.x * (smoothstep(0.6, 9.0, yy) + 0.35 * old) * (0.45 + 0.9 * na) * (1.0 - fresh) * wl;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lm * 1.06 + 0.012), clamp(fd * 0.3, 0.0, 0.42));
        // the repainted street floor: new paint, never quite the old colour, richer and darker than the bleached coat above
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(lm), diffuseColor.rgb, 1.3) * 0.9, fresh * 0.9);
        // road dust over the lowest metre, thinning out unevenly (it lifts a dark base band and greys a light wall)
        float du = vAge.y * wl * (1.0 - smoothstep(0.02, 0.5 + 0.9 * nb, yy)) * (0.55 + 0.45 * na);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.27, 0.22), clamp(du * 0.4, 0.0, 0.45));
        // rising damp in some stretches: darker and a little greener below a wandering line, and the salts it brings up
        // dried pale along that line
        float dh = 0.3 + 0.55 * nc + 0.08 * (nb - 0.5), wet = vAge.y * wl * smoothstep(0.45, 0.72, na);
        float dmp = wet * (1.0 - smoothstep(dh - 0.16, dh + 0.03, yy)), salt = wet * exp(-pow((yy - dh) / 0.04, 2.0));
        diffuseColor.rgb *= (1.0 - clamp(dmp * 0.2, 0.0, 0.3)) * mix(vec3(1.0), vec3(0.95, 0.98, 0.93), clamp(dmp, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lm * 1.12 + 0.03), clamp(salt * 0.28, 0.0, 0.3));
      }`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#ifdef USE_COLOR
        ${paint}
      #endif
      ${aged}`);
  };
  return m;
}

// Three-layer ground: asphalt / paving / wind-blown sand, blended by per-vertex weights with a noisy threshold.
function groundMaterial() {
  const a = assets.tex.asphalt_02, p = assets.tex.concrete_pavement, s = assets.tex.sandy_gravel;
  for (const t of [a, p, s]) for (const k of ['diff', 'nor', 'arm']) t[k].anisotropy = 16;
  const m = new THREE.MeshStandardMaterial({ map: a.diff, normalMap: a.nor, roughness: 1, metalness: 0 });
  m.userData.patchKey = 'ground';
  m.userData.layers = { tC2: p.diff, tC3: s.diff };
  m.userData.patch = shader => {
    Object.assign(shader.uniforms, { tA1: { value: a.arm }, tC2: { value: p.diff }, tN2: { value: p.nor }, tC3: { value: s.diff }, tN3: { value: s.nor } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBlend;\nvarying vec3 vWPos;\nvarying vec3 vBlend;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBlend = aBlend;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vBlend;
        uniform sampler2D tA1, tC2, tN2, tC3, tN3;
        vec3 gC; vec3 gN; vec3 gA;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec2 w = vWPos.xz;
          float n1 = texture2D(tCloud, w * 0.031).r, n2 = texture2D(tCloud, w * 0.17 + 0.2).g, n3 = texture2D(tCloud, w * 0.9).b;
          float wp = smoothstep(0.35, 0.65, vBlend.x + (n2 - 0.5) * 0.5);
          float ws = smoothstep(0.46, 0.70, vBlend.y + (n1 - 0.5) * 0.7 + (n3 - 0.5) * 0.3) * 0.92;
          vec2 u1 = w / 3.2, u2 = w / 2.6, u3 = w / 2.1;
          gC = mix(texture2D(map, u1).rgb * mix(0.72, 1.12, n1), texture2D(tC2, u2).rgb * mix(0.80, 1.05, n1) * vec3(1.03, 0.99, 0.93), wp);
          gN = mix(texture2D(normalMap, u1).xyz, texture2D(tN2, u2).xyz, wp);
          gA = mix(texture2D(tA1, u1).rgb, vec3(0.92, 0.86, 0.0), wp);
          gC = mix(gC, texture2D(tC3, u3).rgb * vec3(0.78, 0.68, 0.54), ws);
          gN = mix(gN, texture2D(tN3, u3).xyz, ws);
          gA = mix(gA, vec3(0.95, 0.96, 0.0), ws);
          gC *= mix(1.0, gA.r, 0.6) * (1.0 - vBlend.z * 0.55);
        }`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= gC;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gA.g;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(tbn * (gN * 2.0 - 1.0));');
  };
  return m;
}

// Wind for cloth and fronds. aWind.x = how free the vertex is, aWind.y = phase.
function windy(m, amp = 0.06, backlit = 0) {
  m.userData.patchKey = `wind${amp}_${backlit}`;
  m.userData.patch = shader => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = aWind.y + position.x * 0.9 + position.z * 0.7;
          float gust = 0.55 + 0.45 * sin(uTime * 0.31 + position.x * 0.05 + position.z * 0.04);
          vec3 d = vec3(sin(uTime * 1.7 + ph), sin(uTime * 2.3 + ph * 1.3) * 0.6, cos(uTime * 1.3 + ph * 0.8));
          d += vec3(sin(uTime * 4.1 + ph * 3.1), 0.0, cos(uTime * 3.7 + ph * 2.7)) * 0.25;
          transformed += d * aWind.x * gust * ${amp.toFixed(3)};
        }`);
    if (backlit > 0) {
      // Thin cloth: light the underside with the top side's sun so awnings glow when seen from below.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n if (!gl_FrontFacing) normal = -normal;')
        .replace('#include <opaque_fragment>', `if (!gl_FrontFacing) outgoingLight *= vec3(${backlit.toFixed(2)}) * vec3(1.0, 0.94, 0.86);\n#include <opaque_fragment>`);
    }
  };
  return m;
}

function decalTexture(kind) {
  const R = rng(kind.length * 97 + 5);
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    if (kind === 'stain') {            // vertical run-off streaks
      for (let i = 0; i < 46; i++) {
        const x = 30 + R() * (w - 60), len = 60 + R() * 180, wd = 3 + R() * 16;
        const gr = g.createLinearGradient(0, 0, 0, len);
        gr.addColorStop(0, `rgba(28,22,16,${0.22 + R() * 0.3})`); gr.addColorStop(1, 'rgba(28,22,16,0)');
        g.fillStyle = gr; g.fillRect(x - wd / 2, 0, wd, len);
      }
    } else if (kind === 'patch') {     // irregular repair patch
      g.filter = 'blur(5px)'; g.fillStyle = 'rgba(196,192,184,0.62)'; g.beginPath();
      for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2, r = 86 + R() * 26; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.82); }
      g.fill(); g.filter = 'none';
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${120 + R() * 60 | 0},${118 + R() * 55 | 0},${112 + R() * 50 | 0},0.06)`; g.fillRect(56 + R() * 144, 62 + R() * 132, 2 + R() * 7, 1 + R() * 3); }
    } else {                           // old bullet scars: pale chipped plaster with a dark core
      for (let i = 0; i < 9; i++) {
        const x = 40 + R() * 176, y = 40 + R() * 176, r = 7 + R() * 9;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(20,18,16,0.95)'); gr.addColorStop(0.28, 'rgba(60,54,48,0.9)');
        gr.addColorStop(0.40, 'rgba(176,168,154,0.7)'); gr.addColorStop(1, 'rgba(176,168,154,0)');
        g.fillStyle = gr; g.beginPath();
        for (let k = 0; k <= 14; k++) { const a = (k / 14) * Math.PI * 2, rr = r * (0.7 + R() * 0.45); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.fill();
      }
    }
  });
}

function frondTexture() {
  const R = rng(404);
  return canvasTexture(256, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#6d7a3a'; g.lineWidth = 7; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 6); g.stroke();
    for (let i = 0; i < 74; i++) {
      const t = i / 74, y = h - 30 - t * (h - 60), len = (0.35 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.65) * 122;
      for (const s of [-1, 1]) {
        const c = 62 + R() * 34 | 0, dry = R() < 0.07;
        g.fillStyle = dry ? `rgb(${150 + R() * 30 | 0},${128 + R() * 20 | 0},70)` : `rgb(${c * 0.78 | 0},${c + 38},${c * 0.42 | 0})`;
        const tipY = y - 34 - R() * 26, tipX = w / 2 + s * len * (0.9 + R() * 0.15);
        g.beginPath(); g.moveTo(w / 2, y + 5); g.lineTo(tipX, tipY); g.lineTo(w / 2, y - 6); g.fill();
      }
    }
  });
}

// ---- water (the plaza fountain) ----------------------------------------------------------------------------------------
// A tileable ripple normal map: a sum of waves whose frequencies are whole numbers of cycles across the tile.
function rippleNormal(N = 256) {
  const R = rng(77), h = new Float32Array(N * N), waves = [];
  while (waves.length < 26) { const kx = Math.round((R() - 0.5) * 18), ky = Math.round((R() - 0.5) * 18); if (kx || ky) waves.push([kx, ky, (0.3 + R()) / Math.hypot(kx, ky), R() * 6.283]); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (const [kx, ky, a, ph] of waves) v += a * Math.sin(6.2832 * (kx * x + ky * y) / N + ph); h[y * N + x] = v; }
  return canvasTexture(N, N, g => {
    const img = g.createImageData(N, N), at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.9, dy = (at(x, y + 1) - at(x, y - 1)) * 0.9, l = Math.hypot(dx, dy, 1), o = (y * N + x) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
}
// Strands of falling water (alpha), drawn wrapped so the texture tiles both ways.
function strandTexture(w = 64, h = 256, count = 150, seed = 91, len = [30, 220]) {
  return canvasTexture(w, h, g => {
    const R = rng(seed); g.clearRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const x = R() * w, wd = 0.5 + R() * 1.3, y0 = R() * h, l = len[0] + R() * (len[1] - len[0]);
      g.fillStyle = `rgba(255,255,255,${(0.1 + R() * 0.4).toFixed(3)})`;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) g.fillRect(x + ox, y0 + oy, wd, l);
    }
  });
}
// Foam: soft blots of white (alpha), wrapped.
function foamTexture(n = 128) {
  return canvasTexture(n, n, g => {
    const R = rng(33); g.clearRect(0, 0, n, n);
    for (let i = 0; i < 520; i++) {
      const x = R() * n, y = R() * n, r = 0.5 + R() * 2.2; g.fillStyle = `rgba(255,255,255,${(0.05 + R() * 0.22).toFixed(3)})`;
      for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.2832); g.fill(); }
    }
  });
}
const timed = (m, key, frag) => {
  m.userData.patchKey = key;
  m.userData.patch = shader => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
    frag(shader);
  };
  m.userData.noBVH = true;                                  // rounds and thrown things go through to the stone underneath
  return m;
};
// Standing water: clear and dark over the tiles, two layers of ripples drifting across each other.
function waterMaterial() {
  const tex = rippleNormal(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ color: 0x0b2427, roughness: 0.04, metalness: 0, normalMap: tex, normalScale: new THREE.Vector2(0.2, 0.2), transparent: true, opacity: 0.8, envMapIntensity: 1.0 });
  return timed(m, 'water', shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `{
      vec2 r1 = texture2D(normalMap, vNormalMapUv + vec2(uTime * 0.031, uTime * 0.017)).xy * 2.0 - 1.0;
      vec2 r2 = texture2D(normalMap, vNormalMapUv * 1.73 + vec2(-uTime * 0.023, uTime * 0.029)).xy * 2.0 - 1.0;
      normal = normalize(tbn * vec3((r1 + r2) * normalScale, 1.0));
    }`);
  });
}
// Water spilling over a bowl's lip: a clear sheet at the lip that breaks into strands as it falls (v: 0 at the lip,
// 1 where it meets the water below).
function fallMaterial() {
  const tex = strandTexture(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, color: 0xc4dadd, roughness: 0.06, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });
  return timed(m, 'fall', shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `{
      float v = vMapUv.y;
      float s1 = texture2D(map, vec2(vMapUv.x, v * 0.55 - uTime * 1.6)).a, s2 = texture2D(map, vec2(vMapUv.x * 1.37 + 0.31, v * 0.85 - uTime * 2.2)).a;
      float tongues = 0.5 + 0.5 * sin(vMapUv.x * 6.2832 + 1.3) * sin(vMapUv.x * 2.3 + 0.4);     // thicker and thinner falls round the lip
      float sheet = (1.0 - smoothstep(0.0, 0.3, v)) * 0.16;
      diffuseColor.a *= clamp((sheet + (s1 + s2) * 0.34 * mix(0.75, 1.0, v)) * (0.35 + 0.65 * tongues), 0.0, 0.55) * (1.0 - smoothstep(0.8, 1.0, v));
    }`);
  });
}
// White water where a fall lands: foam drifting outwards over a ring (v: 0 at the fall, 1 at the ring's edge).
function foamMaterial() {
  const tex = foamTexture(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, color: 0xeef5f2, roughness: 0.55, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return timed(m, 'foam', shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `{
      float v = vMapUv.y;
      float f = texture2D(map, vec2(vMapUv.x, v * 0.5 - uTime * 0.32)).a + texture2D(map, vec2(vMapUv.x * 0.71 + 0.5, v * 0.8 - uTime * 0.19)).a;
      diffuseColor.a *= clamp(f * 0.8, 0.0, 0.8) * (1.0 - smoothstep(0.15, 1.0, v)) * smoothstep(0.0, 0.08, v);
    }`);
  });
}

const repeat = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };

// ---- window glass with a room behind it ----------------------------------------------------------------------------------
// Interior mapping: the view ray through each pane is traced into a box room behind the glass (back wall, side walls,
// floor and ceiling), and what it meets is shaded here: plaster in one of a few colours with a darker dado, a
// doorway, a wardrobe or a picture on the far wall, tiled or boarded floors, a ceiling lamp that is on in some rooms,
// and curtains (sheer, a pair of drapes or one) hanging just inside the glass. Daylight falls off into the room.
// The room shows as emitted light; the glass itself is a black mirror, so the sky's reflection still takes over at
// grazing angles. Per window (vertex data from world.js): aWin = [seed, width, height], color.r = sill height / 2.
function roomMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.16, metalness: 0, vertexColors: true, envMapIntensity: 0.4 });
  m.defines = { USE_UV: '' };
  m.userData.patchKey = 'room'; m.userData.extra = 'aWin';
  m.userData.patch = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWin;\nvarying vec3 vWin;\nvarying vec3 vRPos;\nvarying vec3 vRNrm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWin = aWin; vRPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vRNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWin;
varying vec3 vRPos;
varying vec3 vRNrm;
float h1(float x) { return fract(sin(x * 91.17) * 43758.55); }
vec3 roomWall(float k) {
  return k < 0.17 ? vec3(0.78, 0.74, 0.62) : k < 0.33 ? vec3(0.62, 0.74, 0.66) : k < 0.5 ? vec3(0.8, 0.62, 0.6) :
         k < 0.67 ? vec3(0.6, 0.68, 0.8) : k < 0.83 ? vec3(0.86, 0.8, 0.66) : vec3(0.72, 0.7, 0.68);
}
vec3 interior(vec3 wpos, vec3 nrm, vec2 uv, float sill) {
  float seed = vWin.x, W = max(vWin.y, 0.3), Hh = max(vWin.z, 0.3);
  vec3 N = normalize(nrm), T = normalize(cross(vec3(0.0, 1.0, 0.0), N)), V = normalize(wpos - cameraPosition);
  vec3 d = vec3(dot(V, T), V.y, -dot(V, N)); d.z = max(d.z, 0.02);
  vec3 p = vec3((uv.x - 0.5) * W, uv.y * Hh, 0.0);
  float RW = max(W * 0.5 + 0.8 + h1(seed * 3.0) * 0.8, 1.3), fy = -sill, cy = 2.8 - sill, D = 2.6 + h1(seed * 5.0) * 2.4;
  float tz = D / d.z;
  float tx = (sign(d.x) * RW - p.x) / (abs(d.x) < 1e-4 ? 1e-4 * sign(d.x + 1e-9) : d.x);
  float ty = ((d.y > 0.0 ? cy : fy) - p.y) / (abs(d.y) < 1e-4 ? 1e-4 : d.y);
  float t = min(tz, min(tx, ty));
  vec3 h = p + d * t;
  float lit = step(0.7, h1(seed * 7.0));
  vec3 wc = roomWall(h1(seed * 11.0)), col;
  float hy = h.y - fy;                                            // height above the room's floor
  float edge;                                                     // distance to the nearest corner of the room, for its shading
  if (t == tz) edge = min(min(RW - abs(h.x), hy), cy - h.y);
  else if (t == tx) edge = min(min(D - h.z, hy), cy - h.y);
  else edge = min(RW - abs(h.x), D - h.z);
  if (t == tz) {                                                  // the far wall
    col = wc * (hy < 0.9 ? 0.78 : 1.0) * (hy < 0.1 ? 0.6 : 1.0);
    float k2 = h1(seed * 43.0), x1 = (h1(seed * 47.0) - 0.5) * RW;
    if (k2 < 0.45 && abs(h.x - x1) < 0.85 && hy < (k2 < 0.2 ? 0.8 : 0.55)) col = roomWall(h1(seed * 53.0)) * 0.42 * (hy > (k2 < 0.2 ? 0.7 : 0.45) ? 1.3 : 1.0);   // a sofa or a bed against it
    float k = h1(seed * 13.0), x0 = (h1(seed * 17.0) - 0.5) * RW;
    if (k < 0.3 && abs(h.x - x0) < 0.42 && hy < 2.05) col = vec3(0.035, 0.03, 0.028);                       // a doorway
    else if (k < 0.62 && abs(h.x - x0) < 0.48 && hy < 1.85) col = vec3(0.26, 0.16, 0.1) * (abs(h.x - x0) > 0.46 || hy > 1.82 || abs(h.x - x0) < 0.012 ? 0.6 : 1.0);   // a wardrobe
    else if (k >= 0.62) { vec2 e = abs(vec2(h.x - x0 * 0.6, hy - 1.55)); if (e.x < 0.34 && e.y < 0.24) col = (e.x < 0.3 && e.y < 0.2) ? roomWall(h1(seed * 19.0)) * 0.7 + 0.15 : vec3(0.22, 0.14, 0.08); }   // a picture
  } else if (t == tx) {                                           // a side wall, a little shaded
    col = wc * 0.82 * (hy < 0.9 ? 0.8 : 1.0);
  } else if (d.y < 0.0) {                                         // the floor: tiles or boards
    vec2 f = vec2(h.x, h.z);
    if (h1(seed * 23.0) < 0.6) { vec2 q = f / 0.33; float c = mod(floor(q.x) + floor(q.y), 2.0); col = mix(vec3(0.5, 0.26, 0.17), vec3(0.62, 0.56, 0.46), c * step(0.5, h1(seed * 29.0))) * (min(fract(q.x), fract(q.y)) < 0.04 ? 0.7 : 1.0); }
    else { float b = floor(f.x / 0.14); col = vec3(0.42, 0.28, 0.17) * (0.8 + 0.2 * h1(b + seed)) * (fract(f.x / 0.14) < 0.06 ? 0.6 : 1.0); }
  } else {                                                        // the ceiling, and its lamp
    col = vec3(0.86, 0.84, 0.8);
    col += lit * vec3(6.0, 4.6, 3.0) * (1.0 - smoothstep(0.05, 0.09, length(vec2(h.x, h.z - D * 0.5))));
  }
  float day = 0.2 / (1.0 + 0.32 * h.z * h.z) + 0.028;
  vec3 lp = vec3(0.0, cy - 0.35, D * 0.5);
  col *= (vec3(day) * vec3(0.94, 0.97, 1.0) + lit * vec3(0.85, 0.62, 0.36) / (1.0 + 0.12 * dot(h - lp, h - lp))) * (0.5 + 0.5 * smoothstep(0.0, 0.6, edge));
  float cu = h1(seed * 31.0);                                     // curtains a hand's breadth inside the glass
  if (cu < 0.62) {
    float tc = 0.09 / d.z; vec2 c = p.xy + d.xy * tc; float u = c.x / W + 0.5;
    float cover = cu < 0.22 ? 1.0 : cu < 0.45 ? (step(u, 0.3) + step(0.7, u)) : step(u, 0.26 + 0.2 * h1(seed * 37.0));
    vec3 cc = roomWall(h1(seed * 41.0)) * vec3(1.05, 0.98, 0.92) * (0.78 + 0.22 * sin(c.x * 41.0 + seed * 9.0));
    cc *= 0.16 + lit * 0.35;
    col = mix(col, cc, cover * (cu < 0.22 ? 0.6 : 0.96));
  }
  return col;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float fr = pow(1.0 - clamp(dot(normalize(cameraPosition - vRPos), normalize(vRNrm)), 0.0, 1.0), 5.0);
        totalEmissiveRadiance += interior(vRPos, vRNrm, vUv, vColor.r * 2.0) * (1.0 - fr) * 0.96; }`);
  };
  m.userData.noBVH = false;
  return m;
}
// Glass blocks (vitroblock), for stair windows of the 1950s blocks: 20 cm blocks, each a little bubble of light.
function glassBlockTexture() {
  return canvasTexture(128, 128, g => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const gr = g.createRadialGradient(x * 64 + 32, y * 64 + 32, 4, x * 64 + 32, y * 64 + 32, 34);
      gr.addColorStop(0, '#dfe9e6'); gr.addColorStop(0.7, '#9fb5b2'); gr.addColorStop(1, '#6f8582');
      g.fillStyle = gr; g.fillRect(x * 64 + 3, y * 64 + 3, 58, 58);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x * 64 + 10, y * 64 + 10, 18, 3);
    }
    g.fillStyle = '#b7b3a8'; for (const k of [0, 61, 64, 125]) { g.fillRect(k, 0, 3, 128); g.fillRect(0, k, 128, 3); }
  });
}

export function createMaterials() {
  const flat = (color, rough, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: true, ...extra });
  const decal = kind => new THREE.MeshStandardMaterial({
    map: decalTexture(kind), transparent: true, depthWrite: false, roughness: 0.95, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const cloth = (id, back = 0.5) => windy(pbr(id, { side: THREE.DoubleSide }), 0.055, back);
  const M = {
    // walls (neutral plasters are tinted per building through vertex colours)
    w_plaster: weather(pbr('painted_plaster_wall'), 1, 1, null, true), w_plaster2: weather(pbr('plastered_wall_04'), 1, 1, null, true),
    w_damaged: weather(pbr('damaged_plaster'), 1, 0.7), w_worn: weather(pbr('worn_plaster_wall'), 1, 0.7),
    w_peel: weather(pbr('peeling_painted_wall')), w_blue: weather(pbr('blue_plaster_weathered')),
    w_red: weather(pbr('red_plaster_weathered')), w_white: weather(pbr('white_rough_plaster'), 1, 0.8, { lo: 0.22, hi: 0.36, flat: 0.45, mean: [0.567, 0.564, 0.529] }, true),
    w_broken: weather(pbr('rough_plaster_broken'), 1, 0.7), w_brick: weather(pbr('red_brick_plaster_patch_02'), 1, 0.6),
    concrete: weather(pbr('concrete_wall_008'), 0.8), dirty: weather(pbr('dirty_concrete'), 0.6, 0.6),
    cracked: weather(pbr('cracked_concrete'), 0, 0.8), pavement: weather(pbr('concrete_pavement'), 0, 0.9),
    rubble: pbr('rubble'), tiles: pbr('interior_tiles'), interior: pbr('plastered_wall_04'),
    gravel: pbr('sandy_gravel'),                                                         // the rubble heaps' bed of mortar dust and sand
    planks: pbr('weathered_planks'), shutter_wood: pbr('wood_shutter'), door: pbr('rough_pine_door'),
    shutter_metal: pbr('rusty_metal_shutter', { metal: true }), corrugated: pbr('corrugated_iron_02', { metal: true }),
    metal_white: pbr('rusty_metal_02', { metal: true }), metal_green: pbr('green_metal_rust', { metal: true }),
    metal_plate: pbr('metal_plate', { metal: true }), burlap: pbr('hessian_230'), bark: pbr('palm_tree_bark'),
    iron: flat(0x1c1b1a, 0.62, 0.85), cable: flat(0x0e0e0e, 0.8), dark: flat(0x030303, 1),
    glass: flat(0x0b0f12, 0.07, 0, { roughnessMap: noise, envMapIntensity: 1.3 }),
    plastic: flat(0xffffff, 0.55),
    matte: flat(0xffffff, 0.93),
    jar: flat(0x9fb0ac, 0.04, 0, { transparent: true, opacity: 0.14, depthWrite: false, envMapIntensity: 1.8 }),   // clear glass over something modelled (a meter's dome)
    ground: groundMaterial(),
    cloth_red: cloth('fabric_pattern_07'), cloth_green: cloth('fabric_pattern_05'), cloth_plain: cloth('cotton_jersey', 0.55),
    rug: cloth('dirty_carpet', 0.12),
    frond: windy(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, vertexColors: true }), 0.16, 0.6),
    d_stain: decal('stain'), d_patch: decal('patch'), d_scars: decal('scars'),
    // ---- the market quarter --------------------------------------------------------------------------------------------
    cobble: weather(pbr('cobblestone_floor_13', { normalScale: 1.3 }), 0, 0.55),          // river-stone paving (empedrado)
    terracotta: weather(pbr('terracotta_floor_tiles'), 0, 0.5),                           // the hall's floor, patios
    brick: weather(pbr('castle_brick_02_red'), 0.7, 0.5),                                 // the hall's portal, piers and low walls
    cantera: weather(pbr('red_sandstone_wall'), 0.6, 0.6),                                // pink building stone: surrounds, cornices, steps
    sillar: weather(pbr('plastered_wall_04', { normalScale: 1.5 }), 0.6, 0.7, null, false, 1),                                  // dressed cantera, for carved members: fine-grained, no wall joints (the joints of a pilaster's stones are modelled)
    shutter_paint: weather(pbr('painted_metal_shutter', { metal: true }), 0.5, 0.6),      // painted roll-up shutters (cortinas)
    roof_tin: pbr('worn_corrugated_iron', { side: THREE.DoubleSide }),                    // corrugated roofing, seen from below too (painted and rusted: no bare metal, so it takes the bounce light)
    sign: new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.78, vertexColors: true }),
    talavera: new THREE.MeshStandardMaterial({ map: repeat(talaveraTexture()), roughness: 0.22, vertexColors: true, envMapIntensity: 1.2 }),
    cloth_papel: windy(new THREE.MeshStandardMaterial({ map: papelTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true }), 0.12, 0.9),
    cloth_tarp: windy(new THREE.MeshStandardMaterial({ map: tarpTexture(), normalMap: assets.tex.cotton_jersey.nor, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.55, side: THREE.DoubleSide, vertexColors: true }), 0.05, 0.7),
    leaves: windy(new THREE.MeshStandardMaterial({ map: leavesTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.68, vertexColors: true }), 0.035, 0.45),
    bulb: new THREE.MeshStandardMaterial({ color: 0x302a20, emissive: 0xffd49a, emissiveIntensity: 9, roughness: 0.4 }),
    flowers: windy(new THREE.MeshStandardMaterial({ map: flowersTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, vertexColors: true }), 0.03, 0.5),    // bougainvillea
    glossy: flat(0xffffff, 0.32),                                                         // chiles, piñata foil
    paint: weather(flat(0xcfcfcf, 0.86), 0.9, 1, null, true),                                         // a flat painted band (base, window surround), tinted per building (as bright as the plaster it is painted on)
    teja: weather(pbr('red_sandstone_wall', { normalScale: 0.7 }), 0.25, 0.6),           // fired clay roof tiles (the kit's barrel tiles), shaded tile by tile through vertex colours
    water: waterMaterial(), water_fall: fallMaterial(), water_foam: foamMaterial(),       // the plaza fountain
    room: roomMaterial(),                                                                 // window glass with a room behind it
    glassblock: new THREE.MeshStandardMaterial({ map: repeat(glassBlockTexture()), roughness: 0.18, vertexColors: true, emissive: 0x2b3432, emissiveMap: null, envMapIntensity: 1.2 }),

    // ---- the detail pass (tools/blender/props.py), mapped by the pieces' own texture coordinates -------------------------
    leaf: windy(new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, vertexColors: true }), 0.03, 0.45),             // laurel leaves
    leaf_mass: windy(new THREE.MeshStandardMaterial({ map: leafMassTexture(), roughness: 0.6, vertexColors: true }), 0.03),                                              // a laurel crown's core
    palm_leaf: windy(new THREE.MeshStandardMaterial({ map: palmLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, vertexColors: true }), 0.14, 0.6),     // palm leaflets and rachis
    paper: windy(new THREE.MeshStandardMaterial({ map: paperTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true }), 0.05, 0.85),          // piñata tissue
  };
  M.glass.roughnessMap = null; M.glass.roughness = 0.09;
  for (const k of ['frond', 'cloth_red', 'cloth_green', 'cloth_plain', 'rug', 'cloth_papel', 'cloth_tarp', 'leaves', 'flowers', 'leaf', 'leaf_mass', 'palm_leaf']) M[k].userData.noBVH = true;   // (paper: piñatas stop a round, as the old glossy ones did)
  // what a bullet sees
  const surf = {
    w_brick: 'brick', planks: 'wood', shutter_wood: 'wood', door: 'wood', shutter_metal: 'metal', corrugated: 'metal',
    metal_white: 'metal', metal_green: 'metal', metal_plate: 'metal', iron: 'metal', glass: 'glass', burlap: 'fabric',
    ground: 'dirt', bark: 'wood', cable: 'fabric', plastic: 'wood', rubble: 'concrete', gravel: 'dirt', tiles: 'concrete', dark: 'none',
    cobble: 'concrete', terracotta: 'concrete', brick: 'brick', cantera: 'concrete', sillar: 'concrete', shutter_paint: 'metal', roof_tin: 'metal', sign: 'plaster',
    talavera: 'concrete', cloth_papel: 'fabric', cloth_tarp: 'fabric', leaves: 'wood', bulb: 'glass', jar: 'glass', paint: 'plaster', flowers: 'wood', glossy: 'wood', teja: 'concrete',
    room: 'glass', glassblock: 'glass', leaf: 'wood', leaf_mass: 'wood', palm_leaf: 'wood', paper: 'fabric',
  };
  for (const [k, m] of Object.entries(M)) { m.userData.surf = surf[k] || (k.startsWith('w_') ? 'plaster' : 'concrete'); m.name = k; }
  return M;
}
