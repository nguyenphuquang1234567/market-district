// Pooled transient effects: particles (dust, chips, sparks, smoke), bullet decals, tracers, spent casings, ambient motes.
import * as THREE from 'three';
import { canvasTexture, rng } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MAXP = 6000, MAX_DECALS = 180, MAX_CASINGS = 40, MAX_TRACERS = 28;

const pointShader = additive => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  uniforms: { uScale: { value: 600 }, uFog: { value: new THREE.Vector3(1, 1, 1) }, uDensity: { value: 0.004 } },
  vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; uniform float uDensity; varying vec4 vColor; varying float vFog;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.05, -mv.z); vColor = aColor; float d = -mv.z * uDensity; vFog = 1.0 - exp(-d * d); }`,
  fragmentShader: `uniform vec3 uFog; varying vec4 vColor; varying float vFog;
    void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; float a = ${additive ? 'smoothstep(1.0, 0.0, r); a *= a' : 'smoothstep(1.0, 0.25, r)'};
      if (a < 0.003) discard; gl_FragColor = vec4(${additive ? 'vColor.rgb' : 'mix(vColor.rgb, uFog, vFog)'}, vColor.a * a); }`,
});

class Points {
  constructor(scene, additive, max) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 4); this.s = new Float32Array(max);
    this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.g = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.floor = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(this.c, 4)); geo.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1));
    this.mat = pointShader(additive);
    this.mesh = new THREE.Points(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 9 : 8;
    scene.add(this.mesh);
  }
  add(pos, vel, col, alpha, size, life, grav = 0, drag = 0, grow = 0, floorY = -1e9) {
    let i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    this.p.set([pos.x, pos.y, pos.z], i * 3); this.v.set([vel.x, vel.y, vel.z], i * 3); this.c.set([col[0], col[1], col[2], alpha], i * 4);
    this.s[i] = size; this.life[i] = life; this.age[i] = 0; this.g[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.a0[i] = alpha; this.floor[i] = floorY;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {            // swap-remove
        const l = --this.n;
        if (i !== l) {
          this.p.copyWithin(i * 3, l * 3, l * 3 + 3); this.v.copyWithin(i * 3, l * 3, l * 3 + 3); this.c.copyWithin(i * 4, l * 4, l * 4 + 4);
          for (const a of [this.s, this.life, this.age, this.g, this.drag, this.grow, this.a0, this.floor]) a[i] = a[l];
        }
        i--; continue;
      }
      const k = Math.exp(-this.drag[i] * dt), j = i * 3;
      this.v[j] *= k; this.v[j + 1] = this.v[j + 1] * k - this.g[i] * dt; this.v[j + 2] *= k;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      if (this.p[j + 1] < this.floor[i]) { this.p[j + 1] = this.floor[i]; this.v[j + 1] *= -0.3; this.v[j] *= 0.5; this.v[j + 2] *= 0.5; }
      this.s[i] += this.grow[i] * dt;
      const t = this.age[i] / this.life[i];
      this.c[i * 4 + 3] = this.a0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    const g = this.mesh.geometry; g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}

function decalTex(kind) {
  const R = rng(kind.length * 31 + 7);
  return canvasTexture(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w);
    const blob = (r0, r1, col, n = 16) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= n; i++) { const a = (i / n) * 6.283, r = r0 + R() * (r1 - r0); g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.fill(); };
    if (kind === 'stone') { g.filter = 'blur(1.5px)'; blob(24, 42, 'rgba(170,162,148,0.55)'); blob(14, 24, 'rgba(96,90,80,0.85)'); g.filter = 'none'; blob(6, 11, 'rgba(14,12,10,1)', 10); }
    else if (kind === 'metal') { g.filter = 'blur(1px)'; blob(15, 22, 'rgba(190,190,195,0.85)', 12); g.filter = 'none'; blob(7, 10, 'rgba(8,8,9,1)', 10); g.strokeStyle = 'rgba(30,30,32,0.7)'; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 17, 0, 6.3); g.stroke(); }
    else if (kind === 'wood') { for (let i = 0; i < 9; i++) { g.strokeStyle = `rgba(${200 + R() * 30 | 0},${170 + R() * 30 | 0},${120 + R() * 20 | 0},0.85)`; g.lineWidth = 1.5 + R() * 2.5; const y = 64 + (R() - 0.5) * 22; g.beginPath(); g.moveTo(64 - 12 - R() * 34, y); g.lineTo(64 + 12 + R() * 34, y + (R() - 0.5) * 6); g.stroke(); } blob(6, 10, 'rgba(20,14,8,1)', 10); }
    else if (kind === 'glass') { g.strokeStyle = 'rgba(235,245,250,0.85)'; for (let i = 0; i < 13; i++) { const a = R() * 6.283, l = 20 + R() * 40; g.lineWidth = 0.6 + R() * 1.2; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); g.stroke(); } g.lineWidth = 1; for (const r of [14, 26]) { g.beginPath(); for (let i = 0; i <= 12; i++) { const a = (i / 12) * 6.283; g.lineTo(64 + Math.cos(a) * r * (0.8 + R() * 0.4), 64 + Math.sin(a) * r * (0.8 + R() * 0.4)); } g.stroke(); } blob(4, 7, 'rgba(5,6,8,1)', 9); }
    else if (kind === 'scorch') {          // blast seat: a burnt centre, soot thinning outwards in streaks, pale scoured ground in between
      const soot = g.createRadialGradient(64, 64, 0, 64, 64, 62); soot.addColorStop(0, 'rgba(8,7,6,0.95)'); soot.addColorStop(0.16, 'rgba(14,12,10,0.86)'); soot.addColorStop(0.42, 'rgba(26,22,18,0.42)'); soot.addColorStop(0.75, 'rgba(34,29,24,0.14)'); soot.addColorStop(1, 'rgba(34,29,24,0)');
      g.fillStyle = soot; g.fillRect(0, 0, w, w);
      g.filter = 'blur(1.2px)';
      for (let i = 0; i < 46; i++) { const a = R() * 6.283, r0 = 6 + R() * 12, r1 = 26 + R() * 36, wd = 0.03 + R() * 0.07; g.fillStyle = `rgba(10,9,8,${0.18 + R() * 0.32})`; g.beginPath(); g.moveTo(64 + Math.cos(a - wd) * r0, 64 + Math.sin(a - wd) * r0); g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); g.lineTo(64 + Math.cos(a + wd) * r0, 64 + Math.sin(a + wd) * r0); g.fill(); }
      for (let i = 0; i < 14; i++) { const a = R() * 6.283, r0 = 10 + R() * 8, r1 = 24 + R() * 22; g.strokeStyle = `rgba(196,186,168,${0.1 + R() * 0.16})`; g.lineWidth = 0.8 + R() * 1.6; g.beginPath(); g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); g.stroke(); }
      g.filter = 'none';
      for (let i = 0; i < 120; i++) { const a = R() * 6.283, r = 4 + R() * R() * 52; g.fillStyle = `rgba(6,5,5,${0.25 + R() * 0.5})`; g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.6 + R() * 1.6, 0.6 + R() * 1.6); }
      blob(5, 10, 'rgba(4,4,4,0.9)', 12);
    }
    else { g.filter = 'blur(3px)'; blob(22, 40, 'rgba(40,32,24,0.7)'); g.filter = 'none'; blob(5, 9, 'rgba(12,9,6,0.95)', 10); }
  });
}
const DECAL_OF = { plaster: 'stone', concrete: 'stone', brick: 'stone', metal: 'metal', wood: 'wood', glass: 'glass', dirt: 'dirt', fabric: 'dirt', scorch: 'scorch' };
export { DUST };
const DUST = { plaster: [0.80, 0.76, 0.68], concrete: [0.68, 0.66, 0.62], brick: [0.66, 0.36, 0.26], wood: [0.62, 0.50, 0.36], dirt: [0.50, 0.42, 0.32], fabric: [0.62, 0.58, 0.50], metal: [0.5, 0.5, 0.5], glass: [0.85, 0.9, 0.92] };

export class FX {
  constructor(R) {
    this.R = R; const scene = R.scene;
    this.rnd = rng(99);
    this.dust = new Points(scene, false, MAXP); this.glow = new Points(scene, true, 900);
    this.dust.mat.uniforms.uFog.value.copy(R.haze); this.dust.mat.uniforms.uDensity.value = scene.fog.density;
    // decals: one instanced quad per surface family
    this.decals = {};
    const quad = new THREE.PlaneGeometry(1, 1);
    for (const kind of ['stone', 'metal', 'wood', 'glass', 'dirt', 'scorch']) {
      const mat = new THREE.MeshStandardMaterial({ map: decalTex(kind), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const im = new THREE.InstancedMesh(quad, R.setup(mat), MAX_DECALS);
      im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.userData.noAO = true; im.renderOrder = 3; scene.add(im);
      this.decals[kind] = { im, next: 0 };
    }
    // tracers
    const tg = new THREE.PlaneGeometry(1, 1); tg.rotateY(Math.PI / 2);     // long axis = z
    const tg2 = tg.clone(); tg2.rotateZ(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({ map: canvasTexture(16, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(5, 3.2, 1.4), fog: false, toneMapped: false });
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const g = new THREE.Group(); g.add(new THREE.Mesh(tg, this.tracerMat), new THREE.Mesh(tg2, this.tracerMat));
      g.visible = false; g.traverse(o => { o.userData.noAO = true; o.frustumCulled = false; o.renderOrder = 9; }); scene.add(g);
      this.tracers.push({ g, from: V(), dir: V(), dist: 0, t: 0, len: 0, on: false });
    }
    // casings
    const cg = new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 8); cg.rotateX(Math.PI / 2);
    this.casingMesh = new THREE.InstancedMesh(cg, R.setup(new THREE.MeshStandardMaterial({ color: 0xb8923e, metalness: 1, roughness: 0.32 })), MAX_CASINGS);
    this.casingMesh.count = MAX_CASINGS; this.casingMesh.frustumCulled = false; this.casingMesh.castShadow = false; scene.add(this.casingMesh);
    this.casings = []; for (let i = 0; i < MAX_CASINGS; i++) this.casings.push({ p: V(0, -50, 0), v: V(), q: new THREE.Quaternion(), w: V(), life: 0, rest: true, floor: 0, pinged: false });
    this.casingNext = 0; this.m4 = new THREE.Matrix4(); this.one = V(1, 1, 1);
    // ambient dust motes around the camera
    this.moteT = 0;
  }

  reset() {
    this.dust.n = 0; this.glow.n = 0;
    for (const d of Object.values(this.decals)) { d.im.count = 0; d.next = 0; }
    for (const t of this.tracers) { t.on = false; t.g.visible = false; }
    for (const c of this.casings) { c.p.set(0, -50, 0); c.rest = true; c.life = 0; }
  }

  decal(surf, p, n, size) {
    const d = this.decals[DECAL_OF[surf]]; if (!d) return;
    const i = d.next; d.next = (d.next + 1) % MAX_DECALS; d.im.count = Math.min(MAX_DECALS, d.im.count + 1);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), this.rnd() * 6.283));
    this.m4.compose(V(p.x + n.x * 0.004, p.y + n.y * 0.004, p.z + n.z * 0.004), q, V(size, size, size));
    d.im.setMatrixAt(i, this.m4); d.im.instanceMatrix.needsUpdate = true;
  }

  // Surface-specific bullet impact. lit = 0..1 rough brightness for unlit dust sprites. mark false: no mark left (the
  // puff is in the air: a round coming out of the far side of thin cover).
  impact(surf, p, n, lit = 1, big = 1, mark = true) {
    if (surf === 'none') return;
    const R = this.rnd, col = DUST[surf] || DUST.concrete, L = 0.55 + 0.75 * lit;
    const c = [col[0] * L, col[1] * L, col[2] * L];
    if (mark) this.decal(surf, p, n, (surf === 'glass' ? 0.26 : surf === 'wood' ? 0.13 : surf === 'metal' ? 0.07 : 0.14) * (0.8 + R() * 0.5) * big);
    const rv = (spread, out) => V(n.x * out + (R() - 0.5) * spread, n.y * out + (R() - 0.5) * spread, n.z * out + (R() - 0.5) * spread);
    if (surf === 'metal') {
      this.glow.add(p, V(0, 0, 0), [6, 4.5, 2.6], 1, 0.28 * big, 0.05);
      for (let i = 0; i < 12; i++) this.glow.add(p, rv(7, 4 + R() * 5), [5, 3.2, 1.2], 1, 0.022, 0.16 + R() * 0.3, 9, 1.2);
      for (let i = 0; i < 3; i++) this.dust.add(p, rv(0.6, 0.5), c, 0.2, 0.08, 0.5, -0.2, 2, 0.4);
      return;
    }
    const nDust = surf === 'glass' || surf === 'fabric' ? 3 : 8, puff = surf === 'dirt' ? 1.4 : 1;
    for (let i = 0; i < nDust * big; i++) this.dust.add(p, rv(1.1, (0.5 + R() * 1.6) * puff), c, 0.32 + R() * 0.2, 0.07 + R() * 0.08, 0.5 + R() * 0.7, -0.15, 2.6, 0.5 + R() * 0.5);
    this.dust.add(p, rv(0.3, 0.5), c, 0.5, 0.16, 0.22, 0, 3, 1.2);
    const chips = surf === 'fabric' ? 0 : surf === 'glass' ? 14 : 7;
    const cc = surf === 'glass' ? [1.6, 1.7, 1.8] : surf === 'wood' ? [0.5 * L, 0.38 * L, 0.24 * L] : [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
    for (let i = 0; i < chips; i++) this.dust.add(p, rv(3.2, 1.5 + R() * 3), cc, 1, 0.012 + R() * 0.016, 0.5 + R() * 0.5, 9.8, 0.4, 0, p.y - 3);
  }

  // What a detonation throws off besides fire and smoke: a two-frame core, burning filler and hot steel as streaks,
  // earth and chips lobbed up to fall back. (The fireball, smoke and dust skirt are lit volumes: see smoke.js.)
  blast(p, floorY, lit = 1, surf = 'concrete') {
    const R = this.rnd, col = DUST[surf] || DUST.concrete, L = 0.5 + 0.7 * lit;
    this.glow.add(p, V(0, 0, 0), [70, 60, 46], 1, 1.5, 0.06);
    for (let i = 0; i < 90; i++) {
      const a = R() * 6.283, e = Math.asin(R() * 1.25 - 0.25), sp = 14 + R() * R() * 60, ce = Math.cos(e);
      this.glow.add(p, V(Math.cos(a) * ce * sp, Math.sin(e) * sp, Math.sin(a) * ce * sp), [11, 6.2 + R() * 2, 1.6 + R()], 1, 0.022 + R() * 0.03, 0.12 + R() * R() * 0.7, 9.8, 2.4 + R() * 2, 0, floorY);
    }
    for (let i = 0; i < 70; i++) {
      const a = R() * 6.283, out = 1.5 + R() * 8.5, k = 0.3 + R() * 0.4;
      this.dust.add(p, V(Math.cos(a) * out, 3.5 + R() * 11, Math.sin(a) * out), [col[0] * L * k, col[1] * L * k, col[2] * L * k], 1, 0.018 + R() * R() * 0.07, 1.4 + R() * 1.5, 9.8, 0.22, 0, floorY);
    }
    for (let i = 0; i < 40; i++) {
      const a = R() * 6.283, out = 4 + R() * 14;
      this.dust.add(p, V(Math.cos(a) * out, 0.6 + R() * 5, Math.sin(a) * out), [col[0] * L * 0.8, col[1] * L * 0.8, col[2] * L * 0.8], 0.7, 0.012 + R() * 0.02, 0.5 + R() * 0.8, 9.8, 1.6, 0, floorY);
    }
  }

  // The gas behind the round: a quick grey jet down the bore that slows and spreads, thicker from a hot barrel.
  muzzleSmoke(p, dir, heat) {
    const R = this.rnd;
    for (let i = 0; i < 4; i++) { const s = 1.2 + i * 1.5 + R() * 1.2; this.dust.add(p, V(dir.x * s + (R() - 0.5) * 0.5, dir.y * s + 0.2 + R() * 0.3, dir.z * s + (R() - 0.5) * 0.5), [0.78, 0.77, 0.75], 0.07 + heat * 0.1 + R() * 0.04, 0.035 + i * 0.012, 0.3 + R() * 0.3 + i * 0.05, -0.45, 4.2, 0.55 + i * 0.12); }
    this.glow.add(p, V(dir.x * 6, dir.y * 6, dir.z * 6), [3, 1.6, 0.6], 0.6, 0.05, 0.04);
  }
  // Unburnt powder: a few grains still alight, thrown a metre or two past the muzzle. bright: how big the flash was.
  muzzleSparks(p, dir, bright = 1) {
    const R = this.rnd, n = Math.round((1 + R() * 4) * bright);
    for (let i = 0; i < n; i++) { const s = 14 + R() * 30; this.glow.add(p, V(dir.x * s + (R() - 0.5) * 7, dir.y * s + (R() - 0.5) * 7 + 1, dir.z * s + (R() - 0.5) * 7), [6.5, 3.4 + R() * 1.4, 1.1], 1, 0.009 + R() * 0.009, 0.05 + R() * R() * 0.2, 9.8, 5); }
  }
  barrelSmoke(p, heat) { this.dust.add(p, V((this.rnd() - 0.5) * 0.08, 0.28 + this.rnd() * 0.15, (this.rnd() - 0.5) * 0.08), [0.82, 0.82, 0.82], 0.06 * heat, 0.03, 0.9, -0.1, 0.8, 0.07); }
  kickDust(p, lit) { for (let i = 0; i < 3; i++) this.dust.add(p, V((this.rnd() - 0.5) * 1.2, 0.2 + this.rnd() * 0.4, (this.rnd() - 0.5) * 1.2), [0.62 * (0.5 + lit * 0.6), 0.55 * (0.5 + lit * 0.6), 0.44 * (0.5 + lit * 0.6)], 0.14, 0.2, 0.9, -0.05, 2.2, 0.6); }

  tracer(from, to, speed = 320) {
    const t = this.tracers.find(q => !q.on); if (!t) return;
    t.from.copy(from); t.dir.subVectors(to, from); t.dist = t.dir.length(); if (t.dist < 3) return;
    t.dir.multiplyScalar(1 / t.dist); t.t = 1.5; t.len = Math.min(7, t.dist * 0.35); t.speed = speed; t.on = true;
  }

  casing(p, vel, floorY) {
    const c = this.casings[this.casingNext]; this.casingNext = (this.casingNext + 1) % MAX_CASINGS;
    c.p.copy(p); c.v.copy(vel); c.w.set(this.rnd() * 30 - 15, this.rnd() * 30 - 15, this.rnd() * 30 - 15); c.life = 5; c.rest = false; c.floor = floorY; c.pinged = false;
  }

  update(dt, camera, onCasingHit) {
    const h = this.R.renderer.domElement.height, scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.dust.mat.uniforms.uScale.value = scale; this.glow.mat.uniforms.uScale.value = scale;
    // sunlit dust motes drifting near the eye
    this.moteT -= dt;
    if (this.moteT <= 0) {
      this.moteT = 0.05; const R = this.rnd, c = camera.position;
      this.dust.add(V(c.x + (R() - 0.5) * 14, c.y + (R() - 0.3) * 4, c.z + (R() - 0.5) * 14), V((R() - 0.5) * 0.12 + 0.08, (R() - 0.5) * 0.05, (R() - 0.5) * 0.12), [1.5, 1.4, 1.2], 0.16, 0.012 + R() * 0.012, 4 + R() * 3, 0, 0, 0);
    }
    this.dust.update(dt); this.glow.update(dt);
    for (const t of this.tracers) {
      if (!t.on) continue;
      t.t += t.speed * dt;
      if (t.t - t.len > t.dist) { t.on = false; t.g.visible = false; continue; }
      const head = Math.min(t.t, t.dist), tail = Math.max(0, t.t - t.len), len = Math.max(0.01, head - tail), mid = (head + tail) / 2;
      t.g.visible = true; t.g.position.copy(t.from).addScaledVector(t.dir, mid);
      t.g.quaternion.setFromUnitVectors(V(0, 0, 1), t.dir); t.g.scale.set(0.035, 0.035, len);
    }
    for (let i = 0; i < MAX_CASINGS; i++) {
      const c = this.casings[i];
      if (c.life > 0) {
        c.life -= dt;
        if (!c.rest) {
          c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt);
          const a = c.w.length() * dt; if (a > 1e-5) c.q.premultiply(new THREE.Quaternion().setFromAxisAngle(c.w.clone().normalize(), a));
          if (c.p.y < c.floor + 0.006) {
            c.p.y = c.floor + 0.006;
            if (Math.abs(c.v.y) > 0.6) { if (!c.pinged || Math.abs(c.v.y) > 1.5) onCasingHit(c.p, Math.min(1, Math.abs(c.v.y) / 3)); c.pinged = true; c.v.y *= -0.38; c.v.x *= 0.6; c.v.z *= 0.6; c.w.multiplyScalar(0.6); }
            else { c.rest = true; c.q.setFromEuler(new THREE.Euler(0, this.rnd() * 6.28, 0)); }
          }
        }
        if (c.life <= 0) c.p.set(0, -50, 0);
      }
      this.m4.compose(c.p, c.q, this.one); this.casingMesh.setMatrixAt(i, this.m4);
    }
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }
}
