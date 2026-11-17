// Renderer, HDRI sky, sun + cascaded shadows, and the HDR post stack.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMFrustum } from 'three/addons/csm/CSMFrustum.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, damp } from './util.js';
import { noise } from './materials.js';
import { AtmosPass, HistoryPass, createMotes } from './atmos.js';
import { nextFrame } from './batch.js';

export const PRESETS = {
  low:    { maxPR: 1.0,  scale: 0.7, shadow: 1024, cascades: 2, shadowFar: 90,  msaa: 0, ao: false, bloom: false, aoSamples: 8,  aoScale: 0.5, soft: false, lod: 0.7, air: 0, reflect: false },
  medium: { maxPR: 1.0,  scale: 0.9, shadow: 2048, cascades: 3, shadowFar: 120, msaa: 2, ao: true,  bloom: true,  aoSamples: 8,  aoScale: 0.5, soft: false, lod: 0.85, air: 8 },
  high:   { maxPR: 1.25, scale: 1.0, shadow: 2048, cascades: 3, shadowFar: 140, msaa: 4, ao: true,  bloom: true,  aoSamples: 12, aoScale: 0.5, soft: false, lod: 1.0, air: 12 },
  ultra:  { maxPR: 1.4,  scale: 1.0, shadow: 4096, cascades: 4, shadowFar: 170, msaa: 4, ao: true,  bloom: true,  aoSamples: 16, aoScale: 0.5, soft: true, lod: 1.35, air: 16 },   // measured: full-res AO cost 6.5 ms for little gain; the 4k cascades are nearly free
};

const SUN_PHI = THREE.MathUtils.degToRad(-60);   // sun azimuth: from +x (east) towards -z (south) = late morning
const SKY_CLAMP = 24;                            // radiance clamp: the sun's energy comes from the directional light instead

// Rotates the equirect so the sun sits at SUN_PHI, clamps the solar disc, and measures the sky.
function prepareSky(tex) {
  const { data: d, width: w, height: h } = tex.image;
  const hf = THREE.DataUtils.fromHalfFloat;
  let best = -1, bi = 0;
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, s = d[i] + d[i + 1] + d[i + 2];
    if (s > best) { best = s; bi = y * w + x; }
  }
  const bx = bi % w, by = (bi / w) | 0;
  let sx = 0, sy = 0, sw = 0;
  for (let dy = -30; dy <= 30; dy++) for (let dx = -30; dx <= 30; dx++) {
    const x = (bx + dx + w) % w, y = clamp(by + dy, 0, h - 1), i = (y * w + x) * 4;
    const L = hf(d[i]) + hf(d[i + 1]) + hf(d[i + 2]);
    if (L > 200) { sx += dx * L; sy += dy * L; sw += L; }
  }
  const sunX = bx + (sw ? sx / sw : 0), sunY = by + (sw ? sy / sw : 0);
  const sunPhi = ((sunX + 0.5) / w - 0.5) * Math.PI * 2;
  const elev = (0.5 - (sunY + 0.5) / h) * Math.PI;
  const shift = ((Math.round(((SUN_PHI - sunPhi) / (Math.PI * 2)) * w) % w) + w) % w;
  // energy in the solar disc (everything above the clamp, near the sun) = the direct irradiance the HDRI was shot under
  let Esun = 0; const dOmega = (Math.PI / h) * ((Math.PI * 2) / w);
  for (let dy = -90; dy <= 90; dy++) for (let dx = -90; dx <= 90; dx++) {
    const x = (bx + dx + w) % w, y = clamp(by + dy, 0, h - 1), i = (y * w + x) * 4;
    const L = 0.2126 * hf(d[i]) + 0.7152 * hf(d[i + 1]) + 0.0722 * hf(d[i + 2]);
    if (L > SKY_CLAMP) Esun += (L - SKY_CLAMP) * dOmega * Math.cos((0.5 - (y + 0.5) / h) * Math.PI);
  }
  const row = new Uint16Array(w * 4), cl = THREE.DataUtils.toHalfFloat(SKY_CLAMP);
  for (let y = 0; y < h; y++) {
    const o = y * w * 4;
    row.set(d.subarray(o, o + w * 4));
    d.set(row.subarray((w - shift) * 4), o);
    d.set(row.subarray(0, (w - shift) * 4), o + shift * 4);
  }
  for (let i = 0; i < d.length; i++) if (d[i] > cl && d[i] < 0x7c00) d[i] = cl;
  // sky irradiance on a horizontal plane + horizon colour
  let E = 0; const hz = new THREE.Vector3(); let hn = 0;
  const dth = Math.PI / h, dph = (Math.PI * 2) / w, st = 4;
  for (let y = 0; y < h / 2; y += st) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI, wgt = Math.sin(el) * Math.cos(el) * dth * dph * st * st;
    for (let x = 0; x < w; x += st) {
      const i = (y * w + x) * 4, r = hf(d[i]), g = hf(d[i + 1]), b = hf(d[i + 2]);
      E += (0.2126 * r + 0.7152 * g + 0.0722 * b) * wgt;
      if (el > 0.02 && el < 0.11) { hz.x += r; hz.y += g; hz.z += b; hn++; }
    }
  }
  hz.multiplyScalar(1 / hn);
  tex.wrapS = THREE.RepeatWrapping; tex.needsUpdate = true;
  const ce = Math.cos(elev);
  console.info(`sky: sun elevation ${(elev * 57.3).toFixed(1)}°, direct ${Esun.toFixed(2)}, diffuse ${E.toFixed(2)}`);
  return { sunDir: new THREE.Vector3(ce * Math.cos(SUN_PHI), Math.sin(elev), ce * Math.sin(SUN_PHI)), E, Esun, horizon: hz, data: d, width: w, height: h };
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uVignette: { value: 0.22 }, uGrain: { value: 0.018 }, uCA: { value: 0.6 }, uSharp: { value: 0.22 },
    uDamage: { value: 0 }, uDesat: { value: 0 }, uFlash: { value: 0 }, uBlur: { value: new THREE.Vector2() },
    uSat: { value: 1.0 }, uWarm: { value: new THREE.Vector3(1.015, 1.0, 0.975) }, uCool: { value: new THREE.Vector3(0.985, 0.995, 1.02) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes, uBlur; uniform float uTime, uVignette, uGrain, uCA, uSharp, uDamage, uDesat, uFlash, uSat; uniform vec3 uWarm, uCool;
    varying vec2 vUv;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * r2 * uCA * 0.012;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      vec2 px = 1.0 / uRes;
      vec3 blur = (texture2D(tDiffuse, vUv + vec2(px.x, 0.)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.)).rgb +
                   texture2D(tDiffuse, vUv + vec2(0., px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0., px.y)).rgb) * 0.25;
      col += (col - blur) * uSharp;
      if (dot(uBlur, uBlur) > 1e-7) {                       // turn blur, kept off the centre so the sight picture stays crisp
        vec3 acc = col; for (int i = 1; i <= 5; i++) { float t = float(i) / 5.0; acc += texture2D(tDiffuse, vUv + uBlur * t).rgb + texture2D(tDiffuse, vUv - uBlur * t).rgb; }
        col = mix(col, acc / 11.0, smoothstep(0.02, 0.2, r2));
      }
      col *= 1.0 - uVignette * smoothstep(0.12, 0.80, r2 * 1.7);
      // grade: sunlit tones a touch warmer, shade a touch cooler, saturation left as lit (balanced so neither end gets
      // darker: shade stays readable). The sun is already warm (sunColor): warming its light again here turned every
      // limewashed wall orange, and the extra saturation the walls once got made the painted ones garish.
      float lg = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(lg), col, uSat) * mix(uCool, uWarm, smoothstep(0.12, 0.8, lg));
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(col, vec3(l), uDesat);
      float edge = smoothstep(0.16, 0.72, r2 * 1.9);          // damage tint hugs the frame edge; the centre stays readable
      col = mix(col, col * vec3(0.95, 0.26, 0.20) + vec3(0.06, 0.0, 0.0), uDamage * edge * 0.85) * (1.0 - 0.3 * uDamage * edge);
      col = mix(col, vec3(1.0), uFlash);
      col += (hash(vUv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Shared by every lit material: baked irradiance volume (bounce + occluded sky light) and drifting cloud shadows.
export const giUniforms = {
  tGiR: { value: null }, tGiG: { value: null }, tGiB: { value: null },
  uGiMin: { value: new THREE.Vector3() }, uGiInv: { value: new THREE.Vector3(1, 1, 1) }, uGiOn: { value: 0 }, uGiSky: { value: 1 }, uGiGain: { value: 1.4 },
  uGiLift: { value: new THREE.Vector2(0.35, 0.14) },   // shade lift: (exponent, floor). Enclosed spots keep sky^exponent of the open-sky light instead of their true share, and never less than the floor
  tCloud: { value: noise }, uCloud: { value: new THREE.Vector4(0, 0, 1 / 210, 0.3) },
};
function globalPatch(shader) {
  Object.assign(shader.uniforms, giUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGiPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGiPos = worldPosition.xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGiPos;
      uniform highp sampler3D tGiR; uniform highp sampler3D tGiG; uniform highp sampler3D tGiB;
      uniform vec3 uGiMin; uniform vec3 uGiInv; uniform float uGiOn; uniform float uGiSky; uniform float uGiGain; uniform vec2 uGiLift;
      uniform sampler2D tCloud; uniform vec4 uCloud;`)
    .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {   // soft cloud shadows sliding across the district
        float cl = texture2D(tCloud, vGiPos.xz * uCloud.z + uCloud.xy).r * 0.65 + texture2D(tCloud, vGiPos.xz * uCloud.z * 2.7 - uCloud.xy * 1.6).g * 0.35;
        float cs = 1.0 - uCloud.w * smoothstep(0.42, 0.68, cl);
        reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;
      }`)
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      {   // indirect light from the baked volume replaces the unoccluded sky term; reflections dim where the surroundings are dark
        vec3 giN = inverseTransformDirection(geometryNormal, viewMatrix);
        vec3 giP = (vGiPos + giN * 0.3 - uGiMin) * uGiInv;
        vec4 gr = texture(tGiR, giP), gg = texture(tGiG, giP), gb = texture(tGiB, giP);
        vec3 amb = vec3(gr.x, gg.x, gb.x);
        vec3 giE = max(amb + vec3(dot(gr.yzw, giN), dot(gg.yzw, giN), dot(gb.yzw, giN)), amb * 0.25) / uGiSky;
        // Shade lift. The bake is physically right, which leaves alleys at a tenth of the open-sky light and rooms at a
        // fiftieth: unreadable next to sunlit ground. The share of sky light a spot receives is range-compressed (one
        // factor per place, so surfaces keep their shading by direction) and floored so nowhere is black.
        float open = max(dot(amb, vec3(0.3333)) / uGiSky, 0.0);
        float lit = open < 1.0 ? uGiLift.y + (1.0 - uGiLift.y) * pow(open, uGiLift.x) : open;
        giE = (giE + 0.004) * (lit / (open + 0.004));
        giE = mix(vec3(dot(giE, vec3(0.2126, 0.7152, 0.0722))), giE, 0.4 + 0.6 * smoothstep(0.0, 0.2, open));   // the little light deep indoors is a few noisy bounces: lifted as it is, it shows as coloured blotches
        iblIrradiance = giE * uGiSky * uGiGain;              // (assigning outright lets the compiler drop the unused sky-irradiance lookup)
        radiance *= 0.08 + 0.92 * min(lit, 1.0);
      }`);
}

// Scene metering for eye adaptation: a 32x18 log-luminance thumbnail of the HDR frame, read back without stalling.
class MeterPass extends Pass {
  constructor(renderer) {
    super(); this.needsSwap = false; this.renderer = renderer; this.frame = 0; this.pending = false; this.sync = false; this.value = null;
    this.rt = new THREE.WebGLRenderTarget(32, 18, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.buf = new Uint8Array(32 * 18 * 4);
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ float s = 0.0; for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { vec3 c = texture2D(tDiffuse, vUv + (vec2(float(i), float(j)) - 1.5) * vec2(0.0078, 0.0139)).rgb; s += log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0005)); }
          gl_FragColor = vec4(vec3(clamp((s / 16.0 + 11.0) / 16.0, 0.0, 1.0)), 1.0); }`,
    }));
  }
  read() {
    // centre-weighted average of log luminance; the lower corner where the weapon sits counts for little
    let acc = 0, wsum = 0; const b = this.buf;
    for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) {
      const u = (x + 0.5) / 32 - 0.5, v = (y + 0.5) / 18 - 0.5;                 // v > 0 is the upper half of the frame
      let w = 1.2 - Math.min(1, Math.hypot(u * 1.3, v * 1.6) * 1.5); if (v < -0.12 && u > 0.02) w *= 0.15;
      acc += (b[(y * 32 + x) * 4] / 255 * 16 - 11) * w; wsum += w;
    }
    this.value = Math.pow(2, acc / wsum);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.sync && (this.pending || ++this.frame % 4)) return;
    this.quad.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.rt); this.quad.render(renderer);
    if (this.sync) {                 // (an asynchronous read still in flight leaves its pack buffer bound, which would make this one fail)
      const gl = renderer.getContext(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      renderer.readRenderTargetPixels(this.rt, 0, 0, 32, 18, this.buf); this.read(); return;
    }
    this.pending = true;
    renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, 32, 18, this.buf).then(() => { this.read(); }).catch(() => {}).finally(() => { this.pending = false; });
  }
}

export function createRenderer(canvas, skyTex, presetName) {
  let tune = {}; try { tune = JSON.parse(new URLSearchParams(location.search).get('tune') || '{}'); } catch { /* ignore */ }   // ?tune={"maxPR":1.25} overrides preset fields for profiling
  const Q = { ...(PRESETS[presetName] || PRESETS.high), ...tune };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;        // refreshed explicitly in render()
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.03, 900);
  scene.add(camera);

  // --- sky -----------------------------------------------------------------------------------------------------
  const sky = prepareSky(skyTex);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(skyTex).texture;      // reflections; diffuse sky light comes from the baked volume
  pmrem.dispose();
  const haze = sky.horizon.clone().multiplyScalar(0.92);
  const wind = new THREE.Vector2(0.86, 0.5);                           // cloud drift direction (x, z)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { tSky: { value: skyTex }, uIntensity: { value: 1 }, uHaze: { value: haze }, uSun: { value: sky.sunDir }, uWind: { value: wind }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
    // The photographed clouds are made to drift: the lookup is displaced along the wind in cloud-plane space (so overhead cloud
    // moves faster than cloud near the horizon) in two half-offset phases that cross-fade; the sun itself is held still.
    fragmentShader: `uniform sampler2D tSky; uniform float uIntensity, uTime; uniform vec3 uHaze, uSun; uniform vec2 uWind; varying vec3 vDir;
      vec3 skyAt(vec3 d, float ph, float k) {
        vec2 P = d.xz / max(d.y, 0.04) - uWind * (ph - 0.5) * 0.075 * k;
        vec3 q = normalize(mix(d, vec3(P.x, 1.0, P.y), step(0.04, d.y) * step(0.0001, k)));
        vec2 uv = vec2(atan(q.z, q.x) * 0.15915494 + 0.5, asin(clamp(q.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        return textureLod(tSky, uv, 0.0).rgb;
      }
      void main(){ vec3 d = normalize(vDir);
        float k = smoothstep(0.05, 0.3, d.y) * (1.0 - smoothstep(0.955, 0.992, dot(d, uSun)));
        float t = uTime / 46.0, p1 = fract(t), p2 = fract(t + 0.5);
        vec3 c = mix(skyAt(d, p1, k), skyAt(d, p2, k), abs(1.0 - 2.0 * p1)) * uIntensity;
        c = mix(c, uHaze, (1.0 - smoothstep(-0.01, 0.11, d.y)) * 0.9);
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
  dome.frustumCulled = false; dome.renderOrder = -1000;
  scene.add(dome);
  scene.fog = new THREE.FogExp2(new THREE.Color(haze.x, haze.y, haze.z), 0.0042);

  // --- sun + cascaded shadow maps ---------------------------------------------------------------------------------
  const sunIntensity = clamp(sky.Esun, 7 * sky.E, 9 * sky.E);     // the HDRI's own direct light, held to a clear-sky direct:diffuse ratio
  const sunColor = new THREE.Color(1.0, 0.94, 0.84);                  // late-morning sun through a little dust: a shade warmer than before
  const csm = new CSM({
    camera, parent: scene, cascades: Q.cascades, maxFar: Q.shadowFar, mode: 'practical', shadowMapSize: Q.shadow,
    lightDirection: sky.sunDir.clone().negate(), lightIntensity: sunIntensity, lightNear: 1, lightFar: 500, lightMargin: 45,
    shadowBias: -0.00012,
  });
  csm.fade = true;
  for (const l of csm.lights) { l.color.copy(sunColor); l.shadow.normalBias = 0.035; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }

  // CSM puts each cascade's light lightMargin metres sunward of its slice of the view but leaves the far plane at
  // lightFar (500 m), so every cascade also drew whatever lies beyond its slice away from the sun: things that cannot
  // shadow anything in view. Each far plane is pulled in to the back of its own slice. (45 m of margin still holds
  // casters up to 30 m tall at this sun height; the tallest thing in the district is 16 m.)
  const lightOrient = new THREE.Matrix4(), lightInv = new THREE.Matrix4(), camToLight = new THREE.Matrix4(), box = new THREE.Box3(), up = new THREE.Vector3(0, 1, 0), origin = new THREE.Vector3(), lf = new CSMFrustum();
  const fitShadowDepth = () => {
    lightOrient.lookAt(origin, csm.lightDirection, up); lightInv.copy(lightOrient).invert();
    camToLight.multiplyMatrices(lightInv, camera.matrixWorld);
    csm.frustums.forEach((f, i) => {
      const sc = csm.lights[i].shadow.camera; f.toSpace(camToLight, lf);
      box.makeEmpty(); for (let k = 0; k < 4; k++) { box.expandByPoint(lf.vertices.near[k]); box.expandByPoint(lf.vertices.far[k]); }
      const far = csm.lightMargin + (box.max.z - box.min.z) + 4;
      if (Math.abs(sc.far - far) > 0.5) { sc.far = far; sc.updateProjectionMatrix(); }
    });
  };

  // Every lit material must go through this: cascades, the material's own patch, then the shared indirect-light patch.
  const prepared = new WeakSet();
  function setup(mat) {
    if (!mat || prepared.has(mat) || !mat.isMeshStandardMaterial) return mat;
    prepared.add(mat);
    csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    const patch = mat.userData.patch;
    mat.onBeforeCompile = (shader, r) => { csmHook(shader, r); if (patch) patch(shader); globalPatch(shader); };
    mat.customProgramCacheKey = () => 'csm+gi' + (mat.userData.patchKey || '');
    return mat;
  }
  const setupTree = root => root.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material.forEach(setup); else setup(o.material);
  });
  // placeholder volume until the bake is loaded
  const blank = () => { const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1); t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.needsUpdate = true; return t; };
  giUniforms.tGiR.value = blank(); giUniforms.tGiG.value = blank(); giUniforms.tGiB.value = blank();

  // --- post --------------------------------------------------------------------------------------------------------
  // The scene target keeps a depth texture so ambient occlusion can read it instead of drawing the whole scene again.
  const sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Q.msaa, depthTexture: new THREE.DepthTexture(4, 4) });
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
  // Only the scene itself is multisampled. It is resolved once and copied into the plain post chain, so later passes
  // (AO blend, bloom, tone mapping) no longer pay for a multisample resolve each.
  const scenePass = new Pass(); scenePass.needsSwap = false;
  const copyQuad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: sceneRT.texture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }' }));
  scenePass.render = (r, writeBuffer, readBuffer) => { r.setRenderTarget(sceneRT); r.render(scene, camera); r.setRenderTarget(readBuffer); copyQuad.render(r); };
  composer.addPass(scenePass);
  const meter = new MeterPass(renderer); composer.addPass(meter);
  let gtao = null, bloom = null;
  if (Q.ao) {
    gtao = new GTAOPass(scene, camera, 4, 4);
    gtao._renderGBuffer = false;
    for (const m of [gtao.gtaoMaterial, gtao.pdMaterial]) { m.defines.NORMAL_VECTOR_TYPE = 0; m.defines.DEPTH_SWIZZLING = 'x'; m.uniforms.tNormal.value = null; m.needsUpdate = true; }
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1.4, scale: 1.2, samples: Q.aoSamples, distanceFallOff: 1.0, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: Q.aoSamples >= 16 ? 12 : 8 });
    gtao.blendIntensity = 0.85;
    // Smoke is drawn into the scene with its alpha channel holding what is still visible through it (see smoke.js).
    // The stock blend multiplies occlusion onto everything; this one lets it through only as far as the smoke does,
    // so the creases of the street behind a cloud are not printed on the cloud.
    gtao.blendMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tScene: { value: null }, intensity: { value: 1 } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse, tScene; uniform float intensity; varying vec2 vUv;
        void main(){ vec4 s = texture2D(tScene, vUv); gl_FragColor = vec4(s.rgb * mix(vec3(1.0), texture2D(tDiffuse, vUv).rgb, intensity * clamp(s.a, 0.0, 1.0)), 1.0); }`,
    });
    const aoRender = gtao.render.bind(gtao);
    gtao.render = (r, writeBuffer, readBuffer, ...rest) => { gtao.blendMaterial.uniforms.tScene.value = readBuffer.texture; aoRender(r, writeBuffer, readBuffer, ...rest); };
    composer.addPass(gtao);
  }
  // sunlit dust in the air and the shadows through it (atmos.js; air = steps along each view ray, 0 = none)
  let atmos = null;
  if (Q.air) { atmos = new AtmosPass(camera, sceneRT.depthTexture, csm, { steps: Q.air, scale: 0.5, giUniforms, sunDir: sky.sunDir, sunColor, sunIntensity }); composer.addPass(atmos); }
  // the frame kept for the next one's reflections in wet ground (not on Low)
  const history = Q.reflect === false ? null : new HistoryPass(camera, sceneRT.depthTexture, 0.5);
  if (history) composer.addPass(history);
  if (Q.bloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.55, 5.5);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);

  let lastFov = 0, exposure = renderer.toneMappingExposure, frameNo = 0;
  // adaptive internal resolution: drop a step after sustained slow frames, creep back up cautiously
  const STEPS = [1, 0.87, 0.75, 0.64, 0.55]; let step = 0, slowT = 0, fastT = 0, holdT = 0, ema = 16.7, sinceUp = 1e9, backoff = 1;
  const stepKey = 'md.scale.' + presetName;                 // remember where this machine settled so the next run starts there
  const saveStep = () => { try { localStorage.setItem(stepKey, step); } catch { /* private mode */ } };
  try { const v = +localStorage.getItem(stepKey); if (v > 0 && v < STEPS.length) step = Math.floor(v); } catch { /* ignore */ }
  const api = {
    renderer, scene, camera, composer, csm, setup, setupTree, gtao, bloom, atmos, history, sky, sunDir: sky.sunDir, sunColor, sunIntensity, haze, Q, final: final.uniforms, sceneRT, sceneDepth: sceneRT.depthTexture, wind,
    exposureTarget: 0.85, baseExposure: 0.85, renderScale: STEPS[step], adaptive: true, meter, autoExposure: true, keyLum: 0.125, exposure: 0.85,
    resize() {
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      const pr = Math.min(window.devicePixelRatio || 1, Q.maxPR) * Q.scale * api.renderScale;
      renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
      composer.setPixelRatio(pr); composer.setSize(w, h); sceneRT.setSize(Math.round(w * pr), Math.round(h * pr));
      if (gtao) gtao.setSize(Math.round(w * pr * Q.aoScale), Math.round(h * pr * Q.aoScale));
      camera.aspect = w / h; camera.updateProjectionMatrix();
      final.uniforms.uRes.value.set(w * pr, h * pr);
      csm.updateFrustums(); lastFov = camera.fov;
      for (const l of csm.lights) l.shadow.needsUpdate = true;
    },
    // rawMs = real time since the previous displayed frame
    adapt(rawMs, dt) {
      if (!api.adaptive || rawMs > 120) return;
      ema += (rawMs - ema) * 0.08; holdT -= dt; sinceUp += dt;
      // at 60 Hz a mean above ~17.2 ms means a few percent of frames are being shown twice: treat that as too slow
      if (ema > 17.2) { slowT += dt; fastT = 0; } else if (ema < 16.95) { fastT += dt; slowT = Math.max(0, slowT - dt * 0.5); } else { slowT = Math.max(0, slowT - dt * 0.25); fastT = 0; }
      if (slowT > 1.5 && step < STEPS.length - 1) {
        backoff = sinceUp < 40 ? Math.min(backoff * 2, 32) : 1;            // stepping back up just failed: wait longer before trying again
        step++; slowT = 0; holdT = (12 + step * 6) * backoff; api.renderScale = STEPS[step]; api.resize(); ema = 16.7; saveStep();
      } else if (fastT > 6 && holdT <= 0 && step > 0) { step--; fastT = 0; holdT = 20; sinceUp = 0; api.renderScale = STEPS[step]; api.resize(); ema = 16.7; saveStep(); }
    },
    // Distance culling of small things (userData.lod, metres; see world.js) and the far cascade's layer: details are not
    // drawn into the outermost shadow cascade, whose texels are too coarse for them anyway.
    lodScale: Q.lod ?? 1, lodList: null, zones: null, zoneList: null, zoneHidden: 0, kitNear: 30,
    // Is this mesh the version of a kit piece on screen (near within kitNear of its cell's box, far beyond)? True for
    // anything without one. The rays that stand for what the player sees (rounds, markers, thrown things) skip the other
    // version: a modelled piece and its plain stand-in overlap, and a round must not spark off the one that is not drawn.
    kitShown(o) {
      const u = o.userData; if (!u.kitLod) return true;
      const b = u.lodBox, p = camera.position, kn = api.kitNear * api.lodScale, dx = Math.max(b[0] - p.x, 0, p.x - b[2]), dz = Math.max(b[1] - p.z, 0, p.z - b[3]);
      return (dx * dx + dz * dz < kn * kn) === (u.kitLod === 'near');
    },
    cull() {
      if (!api.lodList) {
        api.lodList = []; api.zoneList = [];
        const z = api.zones, bb = new THREE.Box3();
        const add = o => {
          if (!o.isMesh || o.isBatchedMesh || o.userData.twinOf) return;        // (a batch and a twin take their cells' verdicts: batch.js)
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
          if (o.userData.lod || o.userData.kitLod) api.lodList.push({ o, s });
          if (z && o.parent?.name === 'world') {                             // the merged district, cell by cell: which side of the ring
            const side = s.center.x < z.split0 ? -1 : s.center.x > z.split1 ? 1 : 0;
            if (side) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); api.zoneList.push({ o, side, x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, y1: bb.max.y }); }
          }
        };
        scene.traverse(add); if (api.detached) api.detached.forEach(add);     // (drawn in batches, the district's cell meshes are not in the scene)
      }
      const p = camera.position, k = api.lodScale;
      for (const { o, s } of api.lodList) {
        const u = o.userData; let vis = !u.lod || p.distanceTo(s.center) - s.radius < u.lod * k;
        if (u.kitLod) {                                   // the kit: detailed pieces near, plain stand-ins beyond
          const shown = api.kitShown(o);
          if (u.shadowProxy) o.material = shown ? u.baseMaterial : u.shadowProxy;   // (a tree's old leaf cards: near, unseen, they cast its shadow)
          else vis = vis && shown;
        }
        o.visible = vis;
      }
      api.zoneHidden = 0;
      const z = api.zones;
      for (const e of api.zoneList) if (!e.o.userData.lod && !e.o.userData.kitLod) e.o.visible = true;     // (the distance pass above has already set the others for this frame)
      if (z) {
        // Zone culling. From street level on one side of the east ring, a cell on the other side shows only through one of
        // the passages or over the ring's roofs. Both tests are conservative: the passage is a wedge of view through both of
        // its mouths, and the roof test takes the ring's lowest roofline and the cell's nearest top.
        const side = p.x < z.x0 ? -1 : p.x > z.x1 ? 1 : 0, low = p.y < z.roof - 0.3;
        if (side && low) {
          const near = side < 0 ? z.x0 : z.x1, far = side < 0 ? z.x1 : z.x0, ang = (x, zz) => Math.atan2(zz - p.z, (x - p.x) * -side);
          const wedges = [];
          for (const [g0, g1] of z.gates) {
            const a0 = Math.min(ang(near, g0), ang(near, g1)), a1 = Math.max(ang(near, g0), ang(near, g1)), b0 = Math.min(ang(far, g0), ang(far, g1)), b1 = Math.max(ang(far, g0), ang(far, g1));
            const lo = Math.max(a0, b0) - 0.01, hi = Math.min(a1, b1) + 0.01; if (lo < hi) wedges.push([lo, hi]);
          }
          for (const e of api.zoneList) {
            if (e.side !== -side || !e.o.visible) continue;
            const ex = side < 0 ? e.x0 : e.x1, t = (near - p.x) / (ex - p.x);
            if (p.y + (e.y1 - p.y) * t > z.roof) continue;                           // its top shows over the roofs
            let lo = Infinity, hi = -Infinity;
            for (const x of [e.x0, e.x1]) for (const zz of [e.z0, e.z1]) { const a = ang(x, zz); lo = Math.min(lo, a); hi = Math.max(hi, a); }
            if (wedges.some(([a, b]) => lo < b && hi > a)) continue;                   // seen through a passage
            e.o.visible = false; api.zoneHidden++;
          }
        }
      }
      if (api.twins) for (const t of api.twins) { const o = t.userData.twinOf; t.visible = o.visible; if (t.material !== o.material) t.material = o.material; }
      if (api.onCull) api.onCull(p, k);
    },
    farShadowLayer() {                                                    // everything already in the scene casts in the far cascade except the detail meshes
      // (three.js tests a caster's layers against the view camera, not the cascade's, so for ordinary meshes this layer
      // never took effect; a batch tests the cascade's camera itself. Awnings, roofing and shutters, culled from 80 m
      // out, are large enough to be missed, so only what is culled nearer than that stays out of the far cascade.)
      scene.traverse(o => { if (o.isBatchedMesh ? !(o.userData.lod && o.userData.lod < 80) && o.userData.kitLod !== 'near' : !o.userData.lod && o.userData.kitLod !== 'near') o.layers.enable(2); });
      const far = csm.lights[csm.lights.length - 1];
      if (csm.lights.length > 2) far.shadow.camera.layers.set(2);
    },
    render(dt, time) {
      if (Math.abs(camera.fov - lastFov) > 0.05) { camera.updateProjectionMatrix(); csm.updateFrustums(); lastFov = camera.fov; }
      // eye adaptation from the metered frame: partial compensation (shade stays moodier than sun), quick into light, slower into dark
      if (api.autoExposure && meter.value) api.exposureTarget = clamp(api.baseExposure * Math.pow(api.keyLum / meter.value, 0.62), 0.55, 5.2);
      exposure = damp(exposure, api.exposureTarget, api.exposureTarget < exposure ? 3.4 : 1.25, dt);
      renderer.toneMappingExposure = api.exposure = exposure;
      final.uniforms.uTime.value = time; skyMat.uniforms.uTime.value = time;
      giUniforms.uCloud.value.x = -wind.x * time * 0.0085; giUniforms.uCloud.value.y = -wind.y * time * 0.0085;
      csm.update(); fitShadowDepth();
      if (api.motes) api.motes.update(time, camera, csm, sceneRT.height);
      api.cull();
      // nearest cascade every frame, the rest in rotation (their lookups stay valid: each keeps the matrix it was drawn with)
      const n = csm.lights.length; frameNo++;
      if (!api.freezeShadows) {                                              // (profiling: tools/perf-probe.js holds the cascades to time the frame without them)
        for (let i = 0; i < n; i++) if (i === 0 || n < 3 || frameNo < 8 || (i - 1) === frameNo % (n - 1)) csm.lights[i].shadow.needsUpdate = true;
        renderer.shadowMap.needsUpdate = true;
      }
      if (gtao) { gtao.gtaoMaterial.uniforms.tDepth.value = sceneRT.depthTexture; gtao.pdMaterial.uniforms.tDepth.value = sceneRT.depthTexture; }
      renderer.info.reset(); nextFrame();
      composer.render(dt);
    },
  };
  api.motes = Q.air ? createMotes(api, giUniforms) : null;
  api.resize();
  return api;
}
