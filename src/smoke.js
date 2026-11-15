// Lit volumes: smoke, blast dust and fire drawn as camera-facing puffs that take the scene's light (sun with the
// buildings' shadows and the cloud's own, the baked bounce light, a nearby blast), fade softly into whatever they
// touch, and stand in the way of sight. One draw call for all of them.
import * as THREE from 'three';
import { giUniforms } from './render.js';
import { noise } from './materials.js';
import { losClear, resolveXZ, ceilingAt } from './physics.js';
import { rng, clamp } from './util.js';

const MAXP = 448, STRIDE = 18;
const WIND = { x: 0.86 * 0.34, z: 0.5 * 0.34 };            // ground wind, m/s, along the drift of the clouds overhead

const VERT = `
  attribute vec3 aPos; attribute float aSize; attribute vec3 aColor; attribute float aAlpha; attribute vec3 aEmis;
  attribute float aRot; attribute float aSeed; attribute float aErode; attribute float aSun; attribute float aFloor; attribute float aLamp;
  uniform highp sampler3D tGiR; uniform highp sampler3D tGiG; uniform highp sampler3D tGiB;
  uniform vec3 uGiMin; uniform vec3 uGiInv; uniform float uGiSky; uniform float uGiGain; uniform vec2 uGiLift;
  uniform vec3 uSunDir; uniform vec3 uCamRight; uniform vec3 uCamUp; uniform float uFogDensity; uniform vec3 uLampPos; uniform vec3 uLampCol;
  varying vec2 vUv; varying vec2 vTex; varying vec3 vColor; varying vec3 vEmis; varying vec4 vMisc; varying vec3 vAmbMid; varying vec3 vAmbTop; varying vec3 vAmbBot;
  varying vec3 vSunV; varying vec2 vSunT; varying vec4 vGeo; varying vec3 vLamp;
  vec3 lift(vec3 e, vec3 amb) {                             // the same shade lift the surfaces get (render.js)
    float open = max(dot(amb, vec3(0.3333)) / uGiSky, 0.0);
    float lit = open < 1.0 ? uGiLift.y + (1.0 - uGiLift.y) * pow(open, uGiLift.x) : open;
    return (e / uGiSky + 0.004) * (lit / (open + 0.004)) * uGiSky * uGiGain;
  }
  void main() {
    vec4 mv = viewMatrix * vec4(aPos, 1.0);
    float c = cos(aRot), s = sin(aRot);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
    mv.xy += q * aSize;
    gl_Position = projectionMatrix * mv;
    vUv = q; vTex = position.xy; vColor = aColor; vEmis = aEmis; vMisc = vec4(aAlpha, aSeed, aErode, aSun);
    vec3 giP = (aPos + vec3(0.0, 0.3, 0.0) - uGiMin) * uGiInv;
    vec4 gr = texture(tGiR, giP), gg = texture(tGiG, giP), gb = texture(tGiB, giP);
    vec3 amb = vec3(gr.x, gg.x, gb.x), up = vec3(gr.z, gg.z, gb.z);
    vAmbMid = lift(amb, amb); vAmbTop = lift(max(amb + up, amb * 0.25), amb); vAmbBot = lift(max(amb - up, amb * 0.25), amb);
    vSunV = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
    vSunT = vec2(vSunV.x * c + vSunV.y * s, -vSunV.x * s + vSunV.y * c);      // sun direction in the puff's own (unrotated) frame
    float d = -mv.z * uFogDensity;
    vGeo = vec4(-mv.z, aPos.y + (uCamRight.y * q.x + uCamUp.y * q.y) * aSize - aFloor, 1.0 - exp(-d * d), aSize);
    vec3 L = uLampPos - aPos; float l2 = dot(L, L) + 1.5;
    vLamp = uLampCol * aLamp / l2;
  }`;

const FRAG = `
  uniform sampler2D tNoise; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uTime; uniform float uSoft; uniform vec2 uNearFar;
  uniform vec3 uSunCol; uniform vec3 uFog; uniform vec3 uCamRight; uniform vec3 uCamUp; uniform vec3 uCamBack;
  varying vec2 vUv; varying vec2 vTex; varying vec3 vColor; varying vec3 vEmis; varying vec4 vMisc; varying vec3 vAmbMid; varying vec3 vAmbTop; varying vec3 vAmbBot;
  varying vec3 vSunV; varying vec2 vSunT; varying vec4 vGeo; varying vec3 vLamp;
  void main() {
    float r = length(vUv); if (r > 1.0) discard;
    vec2 o = vec2(fract(vMisc.y * 7.13), fract(vMisc.y * 3.71)), t = vTex * 0.5;
    vec2 p1 = t * 0.40 + o + vec2(0.0, uTime * 0.011), p2 = t * 1.2 + o.yx * 1.7 - vec2(uTime * 0.017, 0.0);
    float n1 = texture2D(tNoise, p1).r, n2 = texture2D(tNoise, p2).g, n = n1 * 0.64 + n2 * 0.36;
    float body = (1.0 - smoothstep(0.30, 1.0, r + (n - 0.5) * 0.75)) * (1.0 - smoothstep(0.72, 0.98, r));      // a lumpy outline, not a disc
    float er = vMisc.z;
    float a = body * smoothstep(er * 1.2 - 0.2, er * 1.2 + 0.22, n * 0.72 + body * 0.28) * vMisc.x;      // thinning eats holes from the wispy parts inwards
    a *= smoothstep(0.12, 1.0, vGeo.x);                                                 // never a wall of sprite against the lens
    a *= smoothstep(-0.02, min(0.45, vGeo.w * 0.3), vGeo.y);                            // settles onto the ground instead of cutting through it
    if (uSoft > 0.5) {                                                                  // and fades into anything else it meets (last frame's depth)
      float zb = texture2D(tDepth, gl_FragCoord.xy / uRes).x;
      float sd = uNearFar.x * uNearFar.y / (uNearFar.y - (uNearFar.y - uNearFar.x) * zb);
      if (sd > 1.3) a *= smoothstep(0.0, clamp(vGeo.w * 0.35, 0.12, 0.8), sd - vGeo.x + 0.04);
    }
    if (a < 0.004) discard;
    // light: a soft-edged ball lit from the sun's side, with the lumps picked out by how the density changes towards the sun
    float nz = sqrt(max(0.0, 1.0 - r * r));
    vec3 N = normalize(vec3(vUv * 0.85, nz * 0.9 + 0.25));
    float nl = texture2D(tNoise, p1 + vSunT * 0.028).r * 0.64 + texture2D(tNoise, p2 + vSunT * 0.07).g * 0.36;
    float wrap = clamp((dot(N, vSunV) + 0.35) / 1.35, 0.0, 1.0); wrap = wrap * wrap * (3.0 - 2.0 * wrap);
    float lump = clamp(1.0 + (n - nl) * 3.6, 0.3, 1.45);
    float thin = 1.0 - clamp(a * 1.6, 0.0, 1.0);
    float through = pow(max(-vSunV.z, 0.0), 4.0) * thin * 0.9;                           // thin edges glow when the sun is behind them
    float sun = (wrap * lump * (0.5 + 0.5 * body) * 0.66 + through * 0.5) * vMisc.w;      // (most of what reaches the eye from a cloud has been scattered more than once: softer and dimmer than a lit wall)
    float ny = uCamRight.y * N.x + uCamUp.y * N.y + uCamBack.y * N.z;
    vec3 amb = ny > 0.0 ? mix(vAmbMid, vAmbTop, ny) : mix(vAmbMid, vAmbBot, -ny);
    amb *= (0.62 + 0.38 * body) * (0.8 + 0.4 * (n - 0.5));                                                          // the middle of a puff sees less sky than its skin
    vec3 col = vColor * 0.3183 * (uSunCol * sun + amb + vLamp) + vEmis * (0.35 + 0.65 * body * body);
    col = mix(col, uFog, vGeo.z);
    gl_FragColor = vec4(col, a);
  }`;

export class Puffs {
  constructor(G) {
    this.G = G; const R = G.R; this.rnd = rng(4711); this.list = []; this.frame = 0; this.time = 0; this.gid = 0; this.cursor = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(MAXP * STRIDE);
    const ib = this.ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE); ib.setUsage(THREE.DynamicDrawUsage);
    let o = 0; for (const [name, n] of [['aPos', 3], ['aSize', 1], ['aColor', 3], ['aAlpha', 1], ['aEmis', 3], ['aRot', 1], ['aSeed', 1], ['aErode', 1], ['aSun', 1], ['aFloor', 1], ['aLamp', 1]]) { geo.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, n, o)); o += n; }
    geo.instanceCount = 0;
    const soft = R.Q.msaa > 0;                               // with a multisampled scene the resolved depth of the previous frame can be read while drawing this one
    this.blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.blank.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...giUniforms, tNoise: { value: noise }, tDepth: { value: this.blank }, uRes: R.final.uRes, uTime: { value: 0 }, uSoft: { value: soft ? 1 : 0 }, uNearFar: { value: new THREE.Vector2(R.camera.near, R.camera.far) },
        uSunDir: { value: R.sunDir }, uSunCol: { value: new THREE.Vector3(R.sunColor.r, R.sunColor.g, R.sunColor.b).multiplyScalar(R.sunIntensity) },
        uFog: { value: new THREE.Vector3(R.haze.x, R.haze.y, R.haze.z) }, uFogDensity: { value: R.scene.fog.density },
        uCamRight: { value: new THREE.Vector3() }, uCamUp: { value: new THREE.Vector3() }, uCamBack: { value: new THREE.Vector3() },
        uLampPos: { value: new THREE.Vector3() }, uLampCol: { value: new THREE.Vector3() },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      // colour: ordinary "over". Alpha: what is left of the view through the smoke, which the ambient-occlusion blend reads
      // so that creases in the ground behind a cloud are not printed onto it.
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.depthTex = soft ? R.sceneDepth : null;
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 8.5; this.mesh.userData.noAO = true;
    R.scene.add(this.mesh);
    this.order = []; this.tv = new THREE.Vector3(); this.tp = { x: 0, y: 0, z: 0 };
    // What a smoke screen takes out of the sunlight falls on the ground beside it: one soft dark patch per billow, laid
    // where the sun would have put it. (Flat ground only; it is the street that needs it.)
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); sg.setIndex([0, 2, 1, 0, 3, 2]);
    this.sdata = new Float32Array(MAXP * 5); this.sib = new THREE.InstancedInterleavedBuffer(this.sdata, 5); this.sib.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.sib, 3, 0)); sg.setAttribute('aSize', new THREE.InterleavedBufferAttribute(this.sib, 1, 3)); sg.setAttribute('aAlpha', new THREE.InterleavedBufferAttribute(this.sib, 1, 4));
    sg.instanceCount = 0;
    this.shadow = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: { uFogDensity: this.mat.uniforms.uFogDensity },
      vertexShader: `attribute vec3 aPos; attribute float aSize; attribute float aAlpha; uniform float uFogDensity; varying vec2 vUv; varying float vA;
        void main(){ vec4 mv = viewMatrix * vec4(aPos + position * aSize, 1.0); gl_Position = projectionMatrix * mv; vUv = position.xz; float d = -mv.z * uFogDensity; vA = aAlpha * exp(-d * d); }`,
      fragmentShader: `varying vec2 vUv; varying float vA; void main(){ float r = length(vUv); float a = 1.0 - smoothstep(0.15, 1.0, r); gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * vA); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.shadow.frustumCulled = false; this.shadow.renderOrder = 3.5; this.shadow.userData.noAO = true; R.scene.add(this.shadow);
  }

  reset() { this.list.length = 0; this.mesh.geometry.instanceCount = 0; this.shadow.geometry.instanceCount = 0; }
  nearby(x, z, r = 15) { return this.G.world.colliders.filter(b => Math.abs(b.x - x) < b.hx + b.hz + r && Math.abs(b.z - z) < b.hx + b.hz + r); }

  // One puff. o: { x y z, vx vy vz, size, max, grow (s to reach max), life, alpha, color [r,g,b], emis [r,g,b], emisDecay,
  //   drag, buoy, turb, wind, floor, cols, body (blocks sight), group, hover (height it settles at), fade (in, s), sun }
  add(o) {
    const L = this.list;
    if (L.length >= MAXP) { let k = -1, worst = -1; for (let i = 0; i < L.length; i++) { const q = L[i]; if (q.body) continue; const u = q.age / q.life; if (u > worst) { worst = u; k = i; } } if (k < 0) return null; L[k] = L[L.length - 1]; L.pop(); }
    const R = this.rnd;
    const p = { x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, size: o.size, max: o.max ?? o.size, grow: o.grow || 1, life: o.life, age: 0, alpha0: o.alpha ?? 0.5, alpha: 0,
      color: o.color || [0.8, 0.8, 0.78], emis: o.emis ? o.emis.slice() : null, emisDecay: o.emisDecay || 0, drag: o.drag ?? 1, buoy: o.buoy || 0, turb: o.turb || 0, wind: o.wind ?? 1,
      floor: o.floor ?? 0, cols: o.cols || null, body: !!o.body, group: o.group || 0, hover: o.hover ?? null, fade: o.fade ?? 0.25, lamp: o.lamp ?? 1,
      rot: R() * 6.283, rotV: (R() - 0.5) * (o.spin ?? 0.5), seed: R(), sun: o.sun ?? 1, sunT: o.sun ?? 1, shade: 1, erode: 0, tick: (R() * 6) | 0 };
    L.push(p); return p;
  }

  update(dt, camera) {
    const G = this.G, L = this.list, cols = G.world.colliders, sun = G.R.sunDir, tp = this.tp, tv = this.tv; this.time += dt; this.frame++;
    const T = this.time;
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; p.age += dt;
      if (p.age >= p.life) { L[i] = L[L.length - 1]; L.pop(); i--; continue; }
      const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k;
      if (p.hover != null) p.vy += (p.hover - p.y) * 0.5 * dt; else p.vy += p.buoy * dt;
      if (p.turb) {                                          // slow rolling of the air: each puff wanders on its own
        const s = p.seed * 6.283, a = p.turb * dt;
        p.vx += Math.sin(p.z * 0.83 + T * 0.61 + s) * a + Math.sin(p.y * 1.7 + T * 0.37 + s * 2.3) * a * 0.6;
        p.vz += Math.cos(p.x * 0.79 - T * 0.53 + s * 1.7) * a + Math.cos(p.y * 1.9 - T * 0.41 + s) * a * 0.6;
        p.vy += Math.sin(p.x * 0.9 + p.z * 0.7 + T * 0.45 + s * 3.1) * a * 0.35;
      }
      p.x += (p.vx + WIND.x * p.wind) * dt; p.y += p.vy * dt; p.z += (p.vz + WIND.z * p.wind) * dt;
      p.size += (p.max - p.size) * (1 - Math.exp(-dt * 2.6 / p.grow));
      const low = p.floor + p.size * 0.32; if (p.y < low) { p.y = low; if (p.vy < 0) p.vy = 0; }
      p.rot += p.rotV * dt;
      const u = p.age / p.life;
      p.alpha = p.alpha0 * Math.min(1, p.age / p.fade) * (u < 0.55 ? 1 : 1 - ((u - 0.55) / 0.45) ** 1.5);
      p.erode = u < 0.35 ? 0 : ((u - 0.35) / 0.65) ** 1.3;
      if (p.emis) { const e = Math.exp(-p.emisDecay * dt); p.emis[0] *= e; p.emis[1] *= e * e ** 0.35; p.emis[2] *= e * e; }      // cooling: white to orange to red to nothing
      // walls and ceilings hold smoke in (a few puffs a frame)
      if (p.cols && (this.frame + p.tick) % 5 === 0) {
        tp.x = p.x; tp.y = p.y - 0.25; tp.z = p.z;
        if (resolveXZ(tp, Math.min(1.1, p.size * 0.42), 0.5, p.cols, 0)) {
          const dx = tp.x - p.x, dz = tp.z - p.z, l = Math.hypot(dx, dz); p.x = tp.x; p.z = tp.z;
          if (l > 1e-5) { const vn = (p.vx * dx + p.vz * dz) / l; if (vn < 0) { p.vx -= vn * dx / l; p.vz -= vn * dz / l; } }
        }
        const c = ceilingAt(p.x, p.z, p.y, 0.3, p.cols) - p.size * 0.3;
        if (p.y > c) { p.y = Math.max(low, c); if (p.vy > 0) p.vy = 0; }
      }
      p.sun += (p.sunT * p.shade - p.sun) * Math.min(1, dt * 3);
    }
    // a handful of puffs each frame ask whether a building stands between them and the sun
    for (let n = Math.min(7, L.length); n > 0; n--) {
      const p = L[this.cursor++ % L.length];
      tp.x = p.x; tp.y = p.y; tp.z = p.z; p.sunT = losClear(tp, tv.set(p.x + sun.x * 70, p.y + sun.y * 70, p.z + sun.z * 70), cols) ? 1 : 0.04;
    }
    // the cloud's own shadow: how much of it lies between each puff and the sun; and puffs of one cloud keep a little apart
    if (this.frame % 6 === 0) {
      for (let i = 0; i < L.length; i++) {
        const p = L[i]; if (!p.group) { p.shade = 1; continue; }
        let tau = 0;
        for (let j = 0; j < L.length; j++) {
          const q = L[j]; if (q === p || q.group !== p.group) continue;
          const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, t = dx * sun.x + dy * sun.y + dz * sun.z; if (t <= 0) continue;
          const rr = q.size * q.size * 0.6, perp = dx * dx + dy * dy + dz * dz - t * t; if (perp < rr) tau += q.alpha * (1 - perp / rr) * Math.min(1, t / (q.size * 0.5));
        }
        p.shade = 0.22 + 0.78 * Math.exp(-tau * 0.85);
      }
    }
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (!p.body) continue;
      for (let j = i + 1; j < L.length; j++) {
        const q = L[j]; if (!q.body || q.group !== p.group) continue;
        const dx = q.x - p.x, dz = q.z - p.z, d2 = dx * dx + dz * dz, want = (p.size + q.size) * 0.5;
        if (d2 > want * want || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), f = (1 - d / want) * 0.55 * dt / d;
        p.vx -= dx * f; p.vz -= dz * f; q.vx += dx * f; q.vz += dz * f;
      }
    }
    // draw far to near
    const e = camera.matrixWorld.elements, cx = e[12], cy = e[13], cz = e[14], fx = -e[8], fy = -e[9], fz = -e[10], O = this.order; O.length = L.length;
    for (let i = 0; i < L.length; i++) { const p = L[i]; p.depth = (p.x - cx) * fx + (p.y - cy) * fy + (p.z - cz) * fz; O[i] = p; }
    O.sort((a, b) => b.depth - a.depth);
    const D = this.data; let n = 0;
    for (let i = 0; i < O.length; i++) {
      const p = O[i]; if (p.depth < -p.size || p.alpha < 0.003) continue;
      const k = n * STRIDE, c = p.color, m = p.emis; n++;
      D[k] = p.x; D[k + 1] = p.y; D[k + 2] = p.z; D[k + 3] = p.size; D[k + 4] = c[0]; D[k + 5] = c[1]; D[k + 6] = c[2]; D[k + 7] = p.alpha;
      D[k + 8] = m ? m[0] : 0; D[k + 9] = m ? m[1] : 0; D[k + 10] = m ? m[2] : 0; D[k + 11] = p.rot; D[k + 12] = p.seed; D[k + 13] = p.erode; D[k + 14] = p.sun; D[k + 15] = p.floor; D[k + 16] = p.lamp;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) { this.ib.clearUpdateRanges(); this.ib.addUpdateRange(0, n * STRIDE); this.ib.needsUpdate = true; }
    const S = this.sdata, kx = sun.x / sun.y, kz = sun.z / sun.y; let m = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (!p.body || p.sunT < 0.5) continue;                            // a billow already in a building's shade takes no sun from the ground
      const h = p.y - p.floor, k = m * 5; m++;
      S[k] = p.x - kx * h; S[k + 1] = p.floor + 0.03; S[k + 2] = p.z - kz * h; S[k + 3] = p.size * 1.2; S[k + 4] = 0.085 * (p.alpha / 0.6) * (1 - p.erode);
    }
    this.shadow.geometry.instanceCount = m;
    if (m) { this.sib.clearUpdateRanges(); this.sib.addUpdateRange(0, m * 5); this.sib.needsUpdate = true; }
    const U = this.mat.uniforms; U.uTime.value = T;
    U.uCamRight.value.set(e[0], e[1], e[2]); U.uCamUp.value.set(e[4], e[5], e[6]); U.uCamBack.value.set(e[8], e[9], e[10]);
    U.tDepth.value = this.depthTex && n ? this.depthTex : this.blank;
  }

  // How much smoke lies along the sight line a→b (optical depth; about 1.6 and up is nothing to be seen through).
  depth(a, b) {
    const L = this.list; if (!L.length) return 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz); if (len < 1e-4) return 0;
    const ux = dx / len, uy = dy / len, uz = dz / len; let tau = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i]; if (!p.body) continue;
      const px = p.x - a.x, py = p.y - a.y, pz = p.z - a.z, r = p.size * 0.78, t = px * ux + py * uy + pz * uz;
      if (t < -r || t > len + r) continue;
      const perp = px * px + py * py + pz * pz - t * t, rr = r * r; if (perp >= rr) continue;
      const h = Math.sqrt(rr - perp), seg = Math.min(len, t + h) - Math.max(0, t - h); if (seg <= 0) continue;
      tau += seg * p.alpha * (1 - p.erode * 0.7) * (1 - perp / rr * 0.5) * 0.62;
    }
    return tau;
  }
}

// ---- a burning smoke canister ---------------------------------------------------------------------------------------------
// The filling burns for about a quarter of a minute. A fast jet leaves the vents and slows into rolling grey-white
// billows that spread to fill the street from wall to wall, lean with the wind and thin out from their edges.
export const SMOKE = { burn: 17, hang: 30 };
export class SmokeCloud {
  constructor(puffs, floorY, x, z, quality = 1) {
    this.P = puffs; this.t = 0; this.jetAcc = 0; this.bodyAcc = 2; this.floor = floorY; this.group = ++puffs.gid; this.cols = puffs.nearby(x, z); this.rnd = rng(900 + this.group * 13);
    this.k = quality; this.done = false; this.spent = false;
  }
  // vent: world position of the canister's top; ax: the way it points; lit: 1 in sun
  update(dt, vent, ax) {
    const P = this.P, R = this.rnd; this.t += dt;
    const t = this.t, burning = t < SMOKE.burn, ramp = Math.min(1, t / 0.5) * (t > SMOKE.burn - 2.5 ? Math.max(0, (SMOKE.burn - t) / 2.5) : 1);
    if (burning) {
      // jet: small, fast, short-lived
      this.jetAcc += dt * 15 * this.k * (0.35 + 0.65 * ramp);
      const jx = ax.x * 0.72, jy = ax.y * 0.72 + 0.5, jz = ax.z * 0.72, jl = Math.hypot(jx, jy, jz) || 1;
      while (this.jetAcc >= 1) {
        this.jetAcc--; const sp = (2.6 + R() * 2.4) * (0.4 + 0.6 * ramp);
        P.add({ x: vent.x, y: vent.y, z: vent.z, vx: jx / jl * sp + (R() - 0.5) * 1.1, vy: jy / jl * sp + (R() - 0.5) * 0.6, vz: jz / jl * sp + (R() - 0.5) * 1.1, size: 0.07, max: 0.62 + R() * 0.3, grow: 0.9, life: 1.5 + R() * 0.6,
          alpha: 0.55, color: [0.78, 0.78, 0.765], drag: 2.3, buoy: 0.5, turb: 0.5, wind: 0.6, floor: this.floor, group: this.group, fade: 0.08, spin: 2.2, lamp: 1 });
      }
      // body: the billows that make the screen
      this.bodyAcc += dt * (t < 5.5 ? 5.4 : 2.1) * this.k * (0.3 + 0.7 * ramp);
      while (this.bodyAcc >= 1) {
        this.bodyAcc--; const a = R() * 6.283, out = 0.5 + R() * 1.5, up = 0.5 + R() * 0.7;
        P.add({ x: vent.x + jx / jl * up + Math.cos(a) * 0.25, y: vent.y + Math.max(0.15, jy / jl * up), z: vent.z + jz / jl * up + Math.sin(a) * 0.25, vx: Math.cos(a) * out + jx * 0.9, vy: 0.5, vz: Math.sin(a) * out + jz * 0.9,
          size: 0.4, max: 1.9 + R() * 1.1, grow: 5.2, life: (SMOKE.hang + R() * 8) * (t < 6 ? 1 : 0.85), alpha: 0.56 + R() * 0.1, color: [0.76, 0.76, 0.745], drag: 0.5, turb: 0.3, wind: 1, hover: this.floor + 0.8 + R() * 2.5,
          floor: this.floor, cols: this.cols, body: true, group: this.group, fade: 1.1, spin: 0.3, lamp: 1 });
      }
    } else this.spent = true;
    if (t > SMOKE.burn + SMOKE.hang + 9) this.done = true;
  }
}

// ---- a detonation's fire, smoke and dust -----------------------------------------------------------------------------------
// The flame lasts a tenth of a second and is black smoke by the time it is seen; the pressure front scours a skirt of
// dust off the ground; a dirty column climbs and drifts off; a thin haze hangs about for a while.
export function detonation(puffs, p, floorY, dust, airborne = false) {
  const P = puffs, R = P.rnd, cols = P.nearby(p.x, p.z, 12), group = ++P.gid, fl = floorY;
  for (let i = 0; i < 10; i++) {                             // fireball turning to soot
    const a = R() * 6.283, e = R() * 1.3 - 0.15, sp = 5 + R() * 7, ce = Math.cos(e), heat = 0.55 + R() * 0.6;
    P.add({ x: p.x + Math.cos(a) * 0.15, y: p.y + 0.15, z: p.z + Math.sin(a) * 0.15, vx: Math.cos(a) * ce * sp, vy: Math.sin(e) * sp + 1.5, vz: Math.sin(a) * ce * sp, size: 0.45, max: 1.25 + R() * 0.7, grow: 0.22, life: 1.5 + R() * 1.6,
      alpha: 0.92, color: [0.03, 0.028, 0.026], emis: [85 * heat, 52 * heat, 22 * heat], emisDecay: 23 + R() * 10, drag: 6.5, buoy: 1.4, turb: 0.5, wind: 0.8, floor: fl, cols, group, fade: 0.02, spin: 2.5, lamp: 0 });
  }
  for (let i = 0; i < 18; i++) {                             // the column: dark, dirty, climbing
    const a = R() * 6.283, out = 1.5 + R() * 4.5, g = 0.03 + R() * R() * 0.09;
    P.add({ x: p.x + Math.cos(a) * 0.3, y: p.y + 0.2 + R() * 0.4, z: p.z + Math.sin(a) * 0.3, vx: Math.cos(a) * out, vy: 2.5 + R() * 5.5, vz: Math.sin(a) * out, size: 0.45, max: 1.2 + R() * 1.0, grow: 0.9, life: 2.8 + R() * 3,
      alpha: 0.72 + R() * 0.2, color: [g * 1.1 + dust[0] * 0.05, g + dust[1] * 0.05, g * 0.92 + dust[2] * 0.05], drag: 2.4, buoy: 0.75, turb: 0.7, wind: 1, floor: fl, cols, group, fade: 0.05, spin: 1.2, lamp: 0.6 });
  }
  if (!airborne) for (let i = 0; i < 24; i++) {              // dust skirt racing out along the ground
    const a = i / 24 * 6.283 + R() * 0.3, out = 8 + R() * 9, k = 0.36 + R() * 0.16;
    P.add({ x: p.x + Math.cos(a) * 0.5, y: fl + 0.2, z: p.z + Math.sin(a) * 0.5, vx: Math.cos(a) * out, vy: 0.4 + R() * 1.6, vz: Math.sin(a) * out, size: 0.35, max: 1.0 + R() * 0.8, grow: 0.7, life: 2.0 + R() * 2.4,
      alpha: 0.3 + R() * 0.14, color: [dust[0] * k, dust[1] * k, dust[2] * k], drag: 4.4, buoy: 0.22, turb: 0.5, wind: 1, floor: fl, cols, group: 0, fade: 0.05, spin: 1, lamp: 0.8 });
  }
  for (let i = 0; i < 9; i++) {                              // what is left hanging in the air afterwards
    const a = R() * 6.283, out = 0.8 + R() * 2.2, k = 0.3 + R() * 0.15;
    P.add({ x: p.x + Math.cos(a) * 0.8, y: p.y + 0.6 + R() * 1.2, z: p.z + Math.sin(a) * 0.8, vx: Math.cos(a) * out, vy: 0.8 + R(), vz: Math.sin(a) * out, size: 1.0, max: 2.6 + R() * 1.6, grow: 3, life: 8 + R() * 5,
      alpha: 0.13 + R() * 0.07, color: [dust[0] * k + 0.04, dust[1] * k + 0.04, dust[2] * k + 0.04], drag: 1.2, buoy: 0.12, turb: 0.4, wind: 1, floor: fl, cols, group: 0, fade: 0.7, spin: 0.4, lamp: 0.5 });
  }
}
