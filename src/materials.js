// PBR material library built on the scanned texture sets, plus the shader patches that make them look weathered.
import * as THREE from 'three';
import { assets } from './assets.js';
import { noiseTexture, canvasTexture, rng } from './util.js';

export const noise = noiseTexture(256, 11);
export const windUniforms = { uTime: { value: 0 } };

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
function weather(m, grime = 1, macro = 1) {
  m.userData.patchKey = `w${grime}_${macro}`;
  m.userData.patch = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 gn = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
          float along = gn.x > gn.z ? vWPos.z : vWPos.x;
          float wall = 1.0 - step(0.7, gn.y);
          vec2 wuv = wall > 0.5 ? vec2(along, vWPos.y) : vWPos.xz;
          float n1 = texture2D(tCloud, wuv * 0.037).r;
          float n2 = texture2D(tCloud, wuv * 0.19 + 0.37).g;
          float st = texture2D(tCloud, vec2(along * 0.55, vWPos.y * 0.03)).b;
          diffuseColor.rgb *= mix(1.0, mix(0.78, 1.10, n1) * mix(0.90, 1.07, n2), ${macro.toFixed(2)});
          diffuseColor.rgb *= 1.0 - smoothstep(0.50, 0.80, st) * wall * 0.30 * ${macro.toFixed(2)};
          float g = wall * (1.0 - smoothstep(0.05, 0.7 + n2 * 1.1, vWPos.y)) * ${grime.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.58, 0.47), g * 0.8);
        }`);
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

export function createMaterials() {
  const flat = (color, rough, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: true, ...extra });
  const decal = kind => new THREE.MeshStandardMaterial({
    map: decalTexture(kind), transparent: true, depthWrite: false, roughness: 0.95, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const cloth = (id, back = 0.5) => windy(pbr(id, { side: THREE.DoubleSide }), 0.055, back);
  const M = {
    // walls (neutral plasters are tinted per building through vertex colours)
    w_plaster: weather(pbr('painted_plaster_wall')), w_plaster2: weather(pbr('plastered_wall_04')),
    w_damaged: weather(pbr('damaged_plaster'), 1, 0.7), w_worn: weather(pbr('worn_plaster_wall'), 1, 0.7),
    w_peel: weather(pbr('peeling_painted_wall')), w_blue: weather(pbr('blue_plaster_weathered')),
    w_red: weather(pbr('red_plaster_weathered')), w_white: weather(pbr('white_rough_plaster'), 1, 0.8),
    w_broken: weather(pbr('rough_plaster_broken'), 1, 0.7), w_brick: weather(pbr('red_brick_plaster_patch_02'), 1, 0.6),
    concrete: weather(pbr('concrete_wall_008'), 0.8), dirty: weather(pbr('dirty_concrete'), 0.6, 0.6),
    cracked: weather(pbr('cracked_concrete'), 0, 0.8), pavement: weather(pbr('concrete_pavement'), 0, 0.9),
    rubble: pbr('rubble'), tiles: pbr('interior_tiles'), interior: pbr('plastered_wall_04'),
    planks: pbr('weathered_planks'), shutter_wood: pbr('wood_shutter'), door: pbr('rough_pine_door'),
    shutter_metal: pbr('rusty_metal_shutter', { metal: true }), corrugated: pbr('corrugated_iron_02', { metal: true }),
    metal_white: pbr('rusty_metal_02', { metal: true }), metal_green: pbr('green_metal_rust', { metal: true }),
    metal_plate: pbr('metal_plate', { metal: true }), burlap: pbr('hessian_230'), bark: pbr('palm_tree_bark'),
    iron: flat(0x1c1b1a, 0.62, 0.85), cable: flat(0x0e0e0e, 0.8), dark: flat(0x030303, 1),
    glass: flat(0x0b0f12, 0.07, 0, { roughnessMap: noise, envMapIntensity: 1.3 }),
    plastic: flat(0xffffff, 0.55),
    matte: flat(0xffffff, 0.93),
    ground: groundMaterial(),
    cloth_red: cloth('fabric_pattern_07'), cloth_green: cloth('fabric_pattern_05'), cloth_plain: cloth('cotton_jersey', 0.55),
    rug: cloth('dirty_carpet', 0.12),
    frond: windy(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, vertexColors: true }), 0.16, 0.6),
    d_stain: decal('stain'), d_patch: decal('patch'), d_scars: decal('scars'),
  };
  M.glass.roughnessMap = null; M.glass.roughness = 0.09;
  for (const k of ['frond', 'cloth_red', 'cloth_green', 'cloth_plain', 'rug']) M[k].userData.noBVH = true;
  // what a bullet sees
  const surf = {
    w_brick: 'brick', planks: 'wood', shutter_wood: 'wood', door: 'wood', shutter_metal: 'metal', corrugated: 'metal',
    metal_white: 'metal', metal_green: 'metal', metal_plate: 'metal', iron: 'metal', glass: 'glass', burlap: 'fabric',
    ground: 'dirt', bark: 'wood', cable: 'fabric', plastic: 'wood', rubble: 'concrete', tiles: 'concrete', dark: 'none',
  };
  for (const [k, m] of Object.entries(M)) { m.userData.surf = surf[k] || (k.startsWith('w_') ? 'plaster' : 'concrete'); m.name = k; }
  return M;
}
