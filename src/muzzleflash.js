// Muzzle flash, drawn by a shader from a seed, so no two shots are the same picture.
//
// What a carbine with a birdcage flash hider throws: a white-hot core at the crown, a tongue of burning gas forward
// down the bore, pinched at the muzzle and bulging a hand's length out, and a short jet through each of the hider's
// five slots (up and to the sides: the bottom is closed, so nothing goes down). It lasts a millisecond or two, which
// is one frame, with a larger and much fainter second frame as the gas spreads.
//
// Three cards hung on the muzzle (local -Z down the bore): one across the bore, seen from behind or in front, with
// the slot jets as petals; two along it, crossed, with the tongue from the side and the jets leaning out of it; and a
// small sprite that faces the camera for the core. Lengths, widths and ragged edges come from the seed; one shot in
// eight is a dim one and one in eight a big one (the secondary flash, when the gas lights again in the air). The
// colour is in scene-linear units well over white, so the bloom and the tone curve do what a camera does with it.
import * as THREE from 'three';
import { canvasTexture, rng } from './util.js';

const LEN = 0.44, HALF = 0.15, ACROSS = 0.38, LIFE = 0.05;      // the cards (metres); how long a flash is drawn (s)

const COMMON = `
  uniform float uSeed, uAge, uGain;
  varying vec2 vUv; varying float vAlong;
  float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p) { return vn(p) * 0.6 + vn(p * 2.13 + 7.7) * 0.3 + vn(p * 4.41 + 3.1) * 0.1; }
  // burning powder gas: deep orange where it is thin, yellow, then nearly white where it is thick
  vec3 fire(float i) { vec3 c = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.6, 0.2), smoothstep(0.03, 0.4, i)); return mix(c, vec3(1.0, 0.9, 0.72), smoothstep(0.5, 1.4, i)) * i; }
  float fade() { float k = 1.0 - uAge; return min(1.0, k * k * 2.2); }`;
// vAlong: how nearly the eye looks down the bore (1: straight along it, from behind or in front)
const VERT = 'varying vec2 vUv; varying float vAlong; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vAlong = abs(dot(normalize(cameraPosition - w.xyz), normalize((modelMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz))); gl_Position = projectionMatrix * viewMatrix * w; }';
// across the bore: the five slot jets as petals round the core
const FRONT = COMMON + `
  void main() {
    vec2 c = (vUv - 0.5) * 2.0; float r = length(c), th = atan(c.y, c.x), grow = 0.72 + 0.5 * uAge, i = 0.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k), a = 1.5708 + (fk - 2.0) * 1.0472 + (h1(uSeed + fk * 7.13) - 0.5) * 0.42;      // up, and 60 and 120 degrees to each side
      float len = mix(0.34, 0.96, h1(uSeed * 1.7 + fk * 3.31)) * grow, d = abs(atan(sin(th - a), cos(th - a)));
      float rag = fbm(vec2(th * 2.6 + uSeed * 9.0, r * 6.0 - uSeed * 4.0));
      float w = mix(0.08, 0.17, h1(uSeed * 2.3 + fk)) * (1.0 - 0.65 * clamp(r / len, 0.0, 1.0)) * (0.65 + 0.7 * rag);
      i += exp(-d * d / (w * w)) * smoothstep(len, len * 0.15, r * (0.8 + 0.45 * rag)) * 1.25;
    }
    i = i + exp(-r * r / 0.014) * 3.0 + exp(-r * r / 0.12) * 0.14;
    i *= smoothstep(1.0, 0.82, r) * smoothstep(0.04, 0.3, vAlong);            // (edge on, from the side, the card is a bright straight line: gone by then)
    gl_FragColor = vec4(fire(i) * uGain * fade(), 1.0);
  }`;
// along the bore: the tongue, and the slot jets this card lies in leaning out of it
const SIDE = COMMON + `
  uniform vec2 uJet;
  void main() {
    float x = vUv.x, y = (vUv.y - 0.5) * 2.0; vec2 p = vec2(x * ${LEN.toFixed(3)}, y * ${HALF.toFixed(3)});
    float n = fbm(vec2(x * 7.0 - uSeed * 6.0, y * 3.0 + uSeed * 2.0));
    float L = mix(0.5, 1.0, h1(uSeed * 3.1)) * (0.75 + 0.45 * uAge), t = x / L;
    float hw = (0.07 + 0.42 * pow(sin(clamp(t, 0.0, 1.0) * 3.1416), 0.8)) * (0.65 + 0.7 * n);
    float i = smoothstep(hw, hw * 0.15, abs(y)) * smoothstep(1.0, 0.6, t) * smoothstep(0.0, 0.05, x) * (0.9 - 0.45 * t);
    i += exp(-y * y / 0.02) * exp(-x * 6.0) * 2.0;
    for (int k = 0; k < 2; k++) {
      float s = k == 0 ? 1.0 : -1.0, on = k == 0 ? uJet.x : uJet.y; vec2 d = normalize(vec2(0.42, s));
      float along = dot(p, d), off = length(p - d * along), jl = mix(0.07, 0.16, h1(uSeed * 5.7 + float(k) * 11.0)) * (0.75 + 0.5 * uAge), jw = 0.008 + max(along, 0.0) * 0.22;
      i += on * exp(-off * off / (jw * jw)) * smoothstep(jl, jl * 0.15, along * (0.8 + 0.5 * n)) * step(0.0, along) * 0.9;
    }
    i *= smoothstep(1.0, 0.85, abs(y)) * smoothstep(1.0, 0.9, x) * (1.0 - 0.8 * smoothstep(0.82, 0.985, vAlong));
    gl_FragColor = vec4(fire(i) * uGain * fade(), 1.0);
  }`;

const card = (fragmentShader, jet) => new THREE.ShaderMaterial({
  vertexShader: VERT, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uSeed: { value: 1 }, uAge: { value: 0 }, uGain: { value: 1 }, uJet: { value: jet || new THREE.Vector2() } },
});
function along(vertical) {       // a card from the crown down the bore: uv.x along it, uv.y across
  const g = new THREE.BufferGeometry(), p = vertical ? [0, -HALF, 0, 0, -HALF, -LEN, 0, HALF, -LEN, 0, HALF, 0] : [-HALF, 0, 0, -HALF, 0, -LEN, HALF, 0, -LEN, HALF, 0, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
let shared = null;
const parts = () => shared || (shared = {
  front: new THREE.PlaneGeometry(ACROSS, ACROSS), up: along(true), flat: along(false),
  glow: canvasTexture(64, 64, (g, w) => { const c = g.createRadialGradient(32, 32, 0, 32, 32, 32); c.addColorStop(0, 'rgba(255,255,255,1)'); c.addColorStop(0.25, 'rgba(255,236,196,0.75)'); c.addColorStop(0.6, 'rgba(255,170,80,0.2)'); c.addColorStop(1, 'rgba(255,120,30,0)'); g.fillStyle = c; g.fillRect(0, 0, w, w); }),
});

export class MuzzleFlash {
  constructor() {
    const P = parts(), g = this.group = new THREE.Group(); this.mats = [card(FRONT), card(SIDE, new THREE.Vector2(1, 0)), card(SIDE, new THREE.Vector2(1, 1))];
    const add = (geo, m) => { const q = new THREE.Mesh(geo, m); q.frustumCulled = false; q.renderOrder = 12; q.userData.noAO = true; g.add(q); return q; };
    add(P.front, this.mats[0]).position.z = -0.012; add(P.up, this.mats[1]); add(P.flat, this.mats[2]);
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true }));
    this.core.renderOrder = 12; this.core.userData.noAO = true; this.core.frustumCulled = false; g.add(this.core);
    g.visible = false; g.userData.noAO = true; this.t = 1; this.gain = 0; this.level = 0; this.size = 1;
  }
  // A shot. rnd: the caller's random stream; size: 1, or less through an optic or for a far rifle. Returns how bright (0..1.4).
  fire(rnd, size = 1) {
    const r = rnd(), kind = r < 0.125 ? 0.38 : r > 0.875 ? 1.4 : 1, s = size * (0.82 + rnd() * 0.36) * (kind > 1 ? 1.25 : kind < 1 ? 0.7 : 1), seed = 1 + rnd() * 97;
    this.t = 0; this.gain = kind; this.size = s; this.group.visible = true;
    this.group.scale.set(s, s, s * (0.85 + rnd() * 0.45)); this.group.rotation.z = (rnd() - 0.5) * 0.5;
    for (const m of this.mats) { m.uniforms.uSeed.value = seed; m.uniforms.uGain.value = 6 * kind; }
    this.update(0);
    return kind;
  }
  update(dt) {
    if (!this.group.visible) { this.level = 0; return; }
    this.t += dt; const age = this.t / LIFE;
    if (age >= 1) { this.group.visible = false; this.level = 0; return; }
    const k = 1 - age, f = Math.min(1, k * k * 2.2);
    for (const m of this.mats) m.uniforms.uAge.value = age;
    this.level = this.gain * f;
    const c = 0.06 * (1 + age * 0.8) / Math.max(0.2, this.size); this.core.scale.set(c, c, c); this.core.material.color.setRGB(11 * this.level, 8 * this.level, 4.6 * this.level);
  }
}

// Flashes for rifles other than the player's: a few, in the world, lent to whoever fires next. One light goes with
// them, to the flash nearest the eye: a rifle fired in a shaded lane lights the wall beside it and the man behind it
// for a frame. (One, always in the scene and dark between shots: the number of lights is part of every lit material's
// program, so it must not change in play.)
export class FlashPool {
  constructor(scene, camera, n = 8) {
    this.list = []; this.next = 0; this.rnd = rng(2718);            // (its own stream: a bot's is what it aims with)
    for (let i = 0; i < n; i++) { const f = new MuzzleFlash(); scene.add(f.group); this.list.push(f); }
    this.z = new THREE.Vector3(0, 0, -1); this.camera = camera; this.lit = null; this.litD = 0;
    this.light = new THREE.PointLight(new THREE.Color(1, 0.72, 0.42), 0, 10, 2); scene.add(this.light);
  }
  at(p, dir, size = 1) {
    const f = this.list[this.next]; this.next = (this.next + 1) % this.list.length;
    f.group.position.copy(p); f.group.quaternion.setFromUnitVectors(this.z, dir);
    const k = f.fire(this.rnd, size), d = this.camera.position.distanceTo(p);       // (the roll fire() gives it is about the bore: the aim stands)
    if (d < 38 && (!this.lit || !this.lit.group.visible || d < this.litD || this.lit === f)) { this.lit = f; this.litD = d; this.light.position.copy(p).addScaledVector(dir, 0.15); }
    return k;
  }
  update(dt) { for (const f of this.list) f.update(dt); this.light.intensity = this.lit && this.lit.group.visible ? 9 * this.lit.level : 0; }
  reset() { for (const f of this.list) { f.group.visible = false; f.level = 0; } this.lit = null; this.light.intensity = 0; }
  // Boot: drawn once, dark, with the frame that warms every pipeline (and the player's with them), so the first shot
  // of a match does not wait on a shader. Off again afterwards.
  warm(on, also = []) { for (const f of [...this.list, ...also]) { f.group.visible = on; f.t = on ? 0 : 1; for (const m of f.mats) m.uniforms.uGain.value = 0; f.core.material.color.setRGB(0, 0, 0); f.level = 0; } }
}
