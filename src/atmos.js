// The air: sunlight scattered by dust on its way to the eye, with the buildings' shadows cut out of it (light shafts
// through the hall's skylights, between shade cloths, down an alley), and motes drifting where the sun reaches.
//
// A post pass. For every other pixel each way it walks the view ray from the eye to what the scene's depth says is
// there (or 80 m), and at each step asks the sun's shadow cascades whether the air at that point is lit. Dust is
// thickest near the ground, and thicker again in enclosed places, which the baked light volume knows as places that
// see little sky: that is where shafts show. The half-size result is blurred along depth edges only and added to the
// frame: it adds light and never takes any away, so nothing gets darker for it.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MAXC = 4;
// added to the colour, the frame's alpha left as it is (the scene's alpha says how much shows through smoke: see render.js)
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

const marchFS = steps => `
  #include <packing>
  uniform highp sampler2D tDepth;
  uniform sampler2D tShadow0, tShadow1, tShadow2, tShadow3;
  uniform mat4 uShadowM[${MAXC}]; uniform int uCascades;
  uniform mat4 uInvProj, uCamWorld;
  uniform vec3 uCamPos, uSunDir, uSunCol;
  uniform float uMaxDist, uDensity, uDustH, uBase, uEnclosed, uG, uGain, uFrame;
  uniform highp sampler3D tGiR; uniform highp sampler3D tGiG; uniform highp sampler3D tGiB;
  uniform vec3 uGiMin, uGiInv; uniform float uGiOn, uGiSky;
  uniform sampler2D tCloud; uniform vec4 uCloud;
  varying vec2 vUv;
  float lit(sampler2D map, mat4 m, vec3 wp, out bool inside) {
    vec4 sc = m * vec4(wp, 1.0); vec3 c = sc.xyz / sc.w;
    inside = c.x > 0.01 && c.x < 0.99 && c.y > 0.01 && c.y < 0.99 && c.z < 1.0;
    return inside ? step(c.z - 0.0015, unpackRGBAToDepth(texture2D(map, c.xy))) : 1.0;
  }
  float sunAt(vec3 wp) {
    bool ok; float v;
    v = lit(tShadow0, uShadowM[0], wp, ok); if (ok) return v;
    if (uCascades > 1) { v = lit(tShadow1, uShadowM[1], wp, ok); if (ok) return v; }
    if (uCascades > 2) { v = lit(tShadow2, uShadowM[2], wp, ok); if (ok) return v; }
    if (uCascades > 3) { v = lit(tShadow3, uShadowM[3], wp, ok); if (ok) return v; }
    return 1.0;
  }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 ray = wp - uCamPos; float dist = length(ray); vec3 dir = ray / max(dist, 1e-4);
    float tMax = min(dist, uMaxDist);
    // interleaved gradient noise: a different start along the ray for each pixel of a 4-pixel neighbourhood, which the
    // blur afterwards averages back into a smooth result
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
    float L = 0.0, T = 1.0, prev = 0.0;
    for (int i = 0; i < ${steps}; i++) {
      float f = (float(i) + jit) / float(${steps});
      float t = tMax * f * (0.35 + 0.65 * f);                     // steps shorter near the eye, where a shaft's edge is largest on screen
      float dt = t - prev; prev = t;
      vec3 p = uCamPos + dir * (t - dt * 0.5);
      float sigma = uDensity * (uBase + exp(-max(p.y, 0.0) / uDustH));
      if (uGiOn > 0.5) {                                          // enclosed air holds its dust: the share of sky a point sees, from the light bake
        vec3 q = (p - uGiMin) * uGiInv;
        float open = clamp((texture(tGiR, q).x + texture(tGiG, q).x + texture(tGiB, q).x) * 0.3333 / uGiSky, 0.0, 1.0);
        sigma *= 1.0 + uEnclosed * (1.0 - open) * (1.0 - open);
      }
      float cl = texture2D(tCloud, p.xz * uCloud.z + uCloud.xy).r * 0.65 + texture2D(tCloud, p.xz * uCloud.z * 2.7 - uCloud.xy * 1.6).g * 0.35;
      float sun = sunAt(p) * (1.0 - uCloud.w * smoothstep(0.42, 0.68, cl));
      L += T * sigma * dt * sun;
      T *= exp(-sigma * dt);
    }
    // Henyey-Greenstein, scaled so that light scattered evenly in all directions counts as 1: brightest looking towards the sun
    float c = dot(dir, uSunDir), g = uG, hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    float lin = -vp.z;
    gl_FragColor = vec4(uSunCol * (L * uGain * mix(1.0, hg, 0.75)), lin);
  }`;

// 7 taps along one axis, each weighed down by how far its depth is from the centre's: shafts stay soft, edges stay put
const blurFS = `
  uniform sampler2D tSrc; uniform vec2 uStep; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSrc, vUv); vec3 acc = c.rgb * 0.2; float w = 0.2;
    for (int i = -3; i <= 3; i++) {
      if (i == 0) continue;
      vec4 s = texture2D(tSrc, vUv + uStep * float(i));
      float k = (i == -1 || i == 1 ? 0.18 : i == -2 || i == 2 ? 0.13 : 0.09) / (1.0 + 60.0 * abs(s.a - c.a) / max(c.a, 0.05));
      acc += s.rgb * k; w += k;
    }
    gl_FragColor = vec4(acc / w, c.a);
  }`;

// Added to the full-size frame: of the four half-size texels round a pixel, those at the pixel's own depth count most
const joinFS = `
  #include <packing>
  uniform sampler2D tSrc; uniform highp sampler2D tDepth; uniform vec2 uHalf; uniform float uNear, uFar; varying vec2 vUv;
  void main() {
    float z = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
    vec2 p = vUv * uHalf - 0.5, f = fract(p), b = (floor(p) + 0.5) / uHalf;
    vec3 acc = vec3(0.0); float w = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec4 s = texture2D(tSrc, b + vec2(float(i), float(j)) / uHalf);
      float k = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) / (0.02 + abs(s.a - z) / max(z, 0.05)) + 1e-5;
      acc += s.rgb * k; w += k;
    }
    gl_FragColor = vec4(acc / w, 0.0);
  }`;

export class AtmosPass extends Pass {
  // o: { steps, scale, giUniforms, sunDir, sunColor, sunIntensity }
  constructor(camera, depthTexture, csm, o) {
    super(); this.needsSwap = false; this.camera = camera; this.csm = csm; this.scale = o.scale || 0.5; this.frame = 0;
    const gi = o.giUniforms, blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); blank.needsUpdate = true; this.blank = blank;
    const rt = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.a = rt(); this.b = rt();
    this.uniforms = {
      tDepth: { value: depthTexture }, tShadow0: { value: blank }, tShadow1: { value: blank }, tShadow2: { value: blank }, tShadow3: { value: blank },
      uShadowM: { value: Array.from({ length: MAXC }, () => new THREE.Matrix4()) }, uCascades: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: o.sunDir }, uSunCol: { value: new THREE.Color().copy(o.sunColor).multiplyScalar(o.sunIntensity) },
      // density per metre at the ground in the open, the share of it that does not thin with height, the height (m) over
      // which the rest thins to a third, how many times thicker it gets indoors, forward scattering, overall strength
      uMaxDist: { value: 80 }, uDensity: { value: 0.0045 }, uBase: { value: 0.35 }, uDustH: { value: 7 }, uEnclosed: { value: 9 }, uG: { value: 0.62 }, uGain: { value: 0.085 }, uFrame: { value: 0 },
      tGiR: gi.tGiR, tGiG: gi.tGiG, tGiB: gi.tGiB, uGiMin: gi.uGiMin, uGiInv: gi.uGiInv, uGiOn: gi.uGiOn, uGiSky: gi.uGiSky, tCloud: gi.tCloud, uCloud: gi.uCloud,
    };
    const mat = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, ...extra });
    this.march = new FullScreenQuad(mat(marchFS(o.steps || 12), this.uniforms));
    this.blurU = { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } };
    this.blur = new FullScreenQuad(mat(blurFS, this.blurU));
    this.joinU = { tSrc: { value: null }, tDepth: { value: depthTexture }, uHalf: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far } };
    this.join = new FullScreenQuad(mat(joinFS, this.joinU, { transparent: true, ...ADD }));
  }
  setSize(w, h) {
    const hw = Math.max(2, Math.round(w * this.scale)), hh = Math.max(2, Math.round(h * this.scale));
    this.a.setSize(hw, hh); this.b.setSize(hw, hh); this.joinU.uHalf.value.set(hw, hh);
  }
  render(renderer, writeBuffer, readBuffer) {
    const U = this.uniforms, cam = this.camera, lights = this.csm.lights;
    U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld); U.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    U.uCascades.value = Math.min(lights.length, MAXC);
    for (let i = 0; i < Math.min(lights.length, MAXC); i++) {
      const sh = lights[i].shadow;
      U['tShadow' + i].value = sh.map ? sh.map.texture : this.blank; U.uShadowM.value[i].copy(sh.matrix);
    }
    this.joinU.uNear.value = cam.near; this.joinU.uFar.value = cam.far;
    const auto = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.a); this.march.render(renderer);
    this.blurU.tSrc.value = this.a.texture; this.blurU.uStep.value.set(1 / this.a.width, 0);
    renderer.setRenderTarget(this.b); this.blur.render(renderer);
    this.blurU.tSrc.value = this.b.texture; this.blurU.uStep.value.set(0, 1 / this.a.height);
    renderer.setRenderTarget(this.a); this.blur.render(renderer);
    this.joinU.tSrc.value = this.a.texture;
    renderer.setRenderTarget(readBuffer); this.join.render(renderer);          // added onto the frame as it stands
    renderer.autoClear = auto;
  }
  dispose() { this.a.dispose(); this.b.dispose(); }
}

// Dust motes: a few hundred specks in a box that travels with the camera (positions wrap, so the box never empties),
// drifting on the wind. Each asks the nearest shadow cascade whether the sun reaches it and is all but invisible if not;
// seen towards the sun they glint. Drawn into the scene itself, so walls hide them and bloom picks them up.
export function createMotes(R, count = 420) {
  const g = new THREE.BufferGeometry(), seed = new Float32Array(count * 4);
  let s = 9173; const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count * 4; i++) seed[i] = rnd();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const U = {
    uTime: { value: 0 }, uBox: { value: new THREE.Vector3(18, 7, 18) }, uCam: { value: new THREE.Vector3() }, uWind: { value: R.wind },
    tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uSunDir: { value: R.sunDir }, uCol: { value: new THREE.Color().copy(R.sunColor).multiplyScalar(R.sunIntensity * 0.05) },
    uPx: { value: 1 }, uOn: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false, ...ADD,
    vertexShader: `
      #include <packing>
      attribute vec4 aSeed; uniform float uTime, uPx, uOn; uniform vec3 uBox, uCam, uSunDir; uniform vec2 uWind; uniform sampler2D tShadow; uniform mat4 uShadowM;
      varying float vA;
      void main() {
        vec3 drift = vec3(uWind.x * 0.18, -0.012, uWind.y * 0.18) * uTime + 0.05 * vec3(sin(uTime * 0.31 + aSeed.w * 40.0), sin(uTime * 0.23 + aSeed.x * 31.0), cos(uTime * 0.27 + aSeed.y * 37.0));
        vec3 p = aSeed.xyz * uBox + drift;
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;                    // wrapped into the box round the camera
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        vec4 sc = uShadowM * vec4(p, 1.0); vec3 c = sc.xyz / sc.w;
        float sun = (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) ? step(c.z - 0.002, unpackRGBAToDepth(texture2D(tShadow, c.xy))) : 0.0;
        float glint = pow(max(dot(normalize(p - cameraPosition), uSunDir), 0.0), 3.0);
        float tw = 0.55 + 0.45 * sin(uTime * (1.1 + aSeed.w * 2.3) + aSeed.x * 60.0);  // a mote turning in the light
        vec3 e = abs(p - uCam) / (uBox * 0.5);                                         // fades out at the box's faces, so wrapping is not seen
        float edge = (1.0 - smoothstep(0.75, 1.0, max(e.x, max(e.y, e.z)))) * smoothstep(0.25, 0.9, dist) * step(0.02, p.y);
        vA = uOn * sun * tw * edge * (0.25 + 0.75 * glint);
        gl_PointSize = clamp(uPx * (0.012 + 0.014 * aSeed.w) / dist, 1.0, 5.0);
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA;
      void main() { vec2 q = gl_PointCoord - 0.5; float a = vA * smoothstep(0.5, 0.1, length(q)); if (a < 0.002) discard; gl_FragColor = vec4(uCol * a, 1.0); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 6; pts.name = 'motes';
  pts.userData.noAO = true;
  R.scene.add(pts);
  return {
    points: pts, uniforms: U,
    update(time, camera, csm, pxHeight) {
      const sh = csm.lights[0].shadow;
      U.uTime.value = time; U.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      U.uOn.value = sh.map ? 1 : 0; if (sh.map) { U.tShadow.value = sh.map.texture; U.uShadowM.value.copy(sh.matrix); }
      U.uPx.value = pxHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
    },
  };
}
