// The civilians' assets (assets/civilians, packed by tools/build-civilians.py from Ara 3D Gen exports): the cast list, the
// shared clip library, and each person as draw groups with a rest skeleton, face shapes and three far versions.
//
// A person is drawn one of two ways. Near: their own groups (skin, face overlays, eyes, mouth, hair, each garment, trim),
// with the 34 face shapes on the groups a face moves and full-size textures shared across the cast; those textures are
// fetched the first time the person comes close. Far: one mesh on the person's small atlas, at 9,000, 3,000 or about
// 1,100 triangles, with no face shapes: a single draw.
import * as THREE from 'three';
import { assets } from './assets.js';

const DIR = 'assets/civilians/';
export const civ = { cast: null, anims: null, clips: new Map(), people: [], tex: new Map(), flatNormal: null, ready: false };

const sRGB = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

function texture(file, srgb, repeat = false) {
  let t = civ.tex.get(file);
  if (!t) {
    t = assets.ktx2.loadAsync(DIR + file).then(tex => {
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; tex.anisotropy = 4;
      return tex;
    });
    civ.tex.set(file, t);
  }
  return t;
}

// Subsurface look for skin without a second pass: light wraps a little past the terminator and comes back red there, and
// thin parts (ears, nostrils, fingers) glow faintly against the sun. Small terms: skin lit like plaster reads as a mannequin.
// (it rides on the light as the shader hands it over, already cut by the cascades' shadows: in shade there is none)
const skinPatch = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
    void RE_Direct_Skin(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
      RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      float sN = dot(geometryNormal, directLight.direction), wrap = smoothstep(-0.34, 0.2, sN) - smoothstep(0.0, 0.5, sN);
      reflectedLight.directDiffuse += material.diffuseColor * directLight.color * vec3(0.95, 0.32, 0.18) * wrap * 0.06;
    }
    #undef RE_Direct
    #define RE_Direct RE_Direct_Skin`);
};

// Blood soaked into whatever it is on: up to six places on a person (uWound: where on the body, in the pose the mesh was
// made in, and how far it has spread). Skin, cloth and hair within reach of one are darkened and reddened and shine wet,
// with a ragged edge. It is worked out on the body as it was made, before any pose: the stain is part of the surface,
// wraps a limb, bends and falls with it, and costs nothing to keep in place.
const woundPatch = (shader, U) => {
  shader.uniforms.uWound = U;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCivRest;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCivRest = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCivRest; uniform vec4 uWound[6];')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float civSoak = 0.0;
      {
        vec3 wq = vCivRest * 55.0;
        float wn = sin(wq.x + sin(wq.y * 1.7) * 1.3) * sin(wq.y * 1.2 + sin(wq.z * 1.9) * 1.1) * sin(wq.z * 0.9 + wq.x * 0.6) * 0.7 + sin(wq.x * 4.1) * sin(wq.y * 3.7) * sin(wq.z * 4.3) * 0.3;
        for (int i = 0; i < 6; i++) {
          float wr = uWound[i].w; if (wr <= 0.0) continue;
          civSoak = max(civSoak, 1.0 - smoothstep(wr * 0.55, wr, distance(vCivRest, uWound[i].xyz) + wn * wr * 0.3));
        }
        civSoak = smoothstep(0.0, 0.45, civSoak);                                 // (a soaked patch has an edge: it does not fade out pink)
        vec3 wet = vec3(0.30, 0.008, 0.011) * (0.45 + 0.55 * dot(diffuseColor.rgb, vec3(0.3333)));
        diffuseColor.rgb = mix(diffuseColor.rgb, wet, civSoak * 0.95);
      }`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, civSoak * 0.85);');
};

function parse(buf) {
  const dv = new DataView(buf), n = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))), base = 8 + n;
  const arr = (T, off, count) => new T(buf.slice(base + off, base + off + count * T.BYTES_PER_ELEMENT));
  return { head, arr };
}

function skinAttributes(g, joints, weights) {
  g.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4, true));
}

class Person {
  constructor(info, head, arr) {
    Object.assign(this, { info, id: info.id, head, height: head.height, hipY: head.hipY, ankleY: head.ankleY, toeY: head.toeY, eye: head.eye, female: info.female });
    this.boneNames = head.bones.map(b => b.name); this.parents = head.bones.map(b => b.parent);
    this.restT = head.bones.map(b => new THREE.Vector3(...b.t)); this.restQ = head.bones.map(b => new THREE.Quaternion(...b.r));
    this.restW = []; this.restP = [];
    head.bones.forEach((b, i) => {
      const p = b.parent;
      this.restW.push(p < 0 ? this.restQ[i].clone() : this.restW[p].clone().multiply(this.restQ[i]));
      this.restP.push(p < 0 ? this.restT[i].clone() : this.restT[i].clone().applyQuaternion(this.restW[p]).add(this.restP[p]));
    });
    this.bone = Object.fromEntries(this.boneNames.map((n, i) => [n, i]));
    // near groups
    this.groups = head.groups.map(G => {
      const g = new THREE.BufferGeometry(), v = G.verts;
      g.setAttribute('position', new THREE.BufferAttribute(arr(Float32Array, G.pos, v * 3), 3));
      g.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(arr(Int8Array, G.nrm, v * 4), 4), 3, 0, true));
      g.setAttribute('uv', new THREE.BufferAttribute(arr(Float32Array, G.uv, v * 2), 2));
      skinAttributes(g, arr(Uint8Array, G.joints, v * 4), arr(Uint8Array, G.weights, v * 4));
      g.setIndex(new THREE.BufferAttribute(arr(G.index32 ? Uint32Array : Uint16Array, G.index, G.tris * 3), 1));
      if (G.col != null) {
        const c = arr(Uint8Array, G.col, v * 4), f = new Float32Array(v * (G.kind === 'glass' ? 4 : 3)), k = G.kind === 'glass' ? 4 : 3;
        for (let i = 0; i < v; i++) { f[i * k] = sRGB(c[i * 4]); f[i * k + 1] = sRGB(c[i * 4 + 1]); f[i * k + 2] = sRGB(c[i * 4 + 2]); if (k === 4) f[i * 4 + 3] = c[i * 4 + 3] / 255; }
        g.setAttribute('color', new THREE.BufferAttribute(f, k));
      }
      // the face shapes, each kept as the vertices it moves until the person first comes close (expand: 34 full arrays a group)
      const sparse = G.morph ? G.morph.map(t => t && { scale: t.scale, idx: arr(Uint16Array, t.idx, t.n), d: arr(Int16Array, t.d, t.n * 3) }) : null;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, head.height / 2, 0), head.height);
      return { ...G, geometry: g, sparse };
    });
    this.lods = head.lods.map(L => {
      const g = new THREE.BufferGeometry(), v = L.verts;
      g.setAttribute('position', new THREE.BufferAttribute(arr(Float32Array, L.pos, v * 3), 3));
      g.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(arr(Int8Array, L.nrm, v * 4), 4), 3, 0, true));
      g.setAttribute('uv', new THREE.BufferAttribute(arr(Uint16Array, L.uv, v * 2), 2, true));
      skinAttributes(g, arr(Uint8Array, L.joints, v * 4), arr(Uint8Array, L.weights, v * 4));
      g.setIndex(new THREE.BufferAttribute(arr(v < 65536 ? Uint16Array : Uint32Array, L.index, L.tris * 3), 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, head.height / 2, 0), head.height);
      return g;
    });
    this.farMat = null; this.nearMats = null; this.nearLoading = null;
    this.woundU = { value: Array.from({ length: 6 }, () => new THREE.Vector4()) };      // where this person is bleeding (their materials read it; one of each person walks the streets)
  }

  // How thick this person is, clothes and all, in the rest pose: for each limb how far its outer surface stands off the
  // bone (most of the vertices that hang on it lie within), and for the chest and the stomach how far the front, the back
  // and the sides are from the line of the spine. Where a round goes in, a stain and a hand lie on that surface: taken as
  // one thickness for everybody they are inside a wide trouser leg and floating off a thin arm.
  girth() {
    if (this._girth) return this._girth;
    const g = this.lods[0], pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, B = this.bone, P = this.restP, v = new THREE.Vector3(), ab = new THREE.Vector3();
    const limb = new Map(), trunk = new Map(), out = {};
    for (const [a, b] of [['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot']]) limb.set(B[a], { name: a, a: P[B[a]], b: P[B[b]], d: [] });
    const parts = { stomach: { f: [], k: [], s: [] }, chest: { f: [], k: [], s: [] } };
    for (const [n, part] of [['Hips', 'stomach'], ['Spine', 'stomach'], ['Spine1', 'chest'], ['Spine2', 'chest']]) trunk.set(B[n], parts[part]);
    const x0 = P[B.Hips].x, z0 = P[B.Hips].z, z1 = P[B.Neck].z, y0 = P[B.Hips].y, y1 = P[B.Neck].y;
    for (let i = 0; i < pos.count; i++) {
      let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }      // the bone that holds this vertex most
      v.fromBufferAttribute(pos, i);
      const L = limb.get(best), T = trunk.get(best);
      if (L) { ab.subVectors(L.b, L.a); const u = v.clone().sub(L.a).dot(ab) / ab.lengthSq(); if (u > 0.12 && u < 0.9) L.d.push(v.sub(L.a).addScaledVector(ab, -u).length()); }
      else if (T) { const z = v.z - (z0 + (z1 - z0) * (v.y - y0) / (y1 - y0)), x = Math.abs(v.x - x0); if (z > 0.03) T.f.push(z); else if (z < -0.02) T.k.push(-z); if (x > 0.05 && Math.abs(z) < 0.06) T.s.push(x); }
    }
    const most = (d, dflt) => { if (d.length < 12) return dflt; d.sort((p, q) => p - q); return d[Math.floor(d.length * 0.8)]; };
    for (const L of limb.values()) out[L.name] = most(L.d, /Arm/.test(L.name) ? 0.05 : 0.085);
    for (const k in parts) out[k] = { front: most(parts[k].f, 0.17), back: most(parts[k].k, 0.08), side: most(parts[k].s, 0.16) };
    return (this._girth = out);
  }
  async loadFar(R) {
    const map = await texture(this.head.farMap, true);
    const far = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
    far.userData.patch = shader => woundPatch(shader, this.woundU); far.userData.patchKey = 'wound';
    this.farMat = R.setup(far);
    this.farMat.name = 'civ-far';
  }

  // The near materials, made once their textures are in (shared across the cast by file).
  loadNear(R) {
    if (this.nearLoading) return this.nearLoading;
    return (this.nearLoading = (async () => {
      for (const G of this.groups) {
        if (!G.sparse || G.geometry.morphAttributes.position) continue;
        const v = G.verts;
        G.geometry.morphAttributes.position = G.sparse.map(t => {
          const a = new Float32Array(v * 3);
          if (t) for (let i = 0; i < t.idx.length; i++) { const o = t.idx[i] * 3; a[o] = t.d[i * 3] * t.scale; a[o + 1] = t.d[i * 3 + 1] * t.scale; a[o + 2] = t.d[i * 3 + 2] * t.scale; }
          return new THREE.BufferAttribute(a, 3);
        });
        G.geometry.morphTargetsRelative = true;
      }
      const mats = await Promise.all(this.groups.map(async G => {
        const k = G.kind, o = { roughness: G.rough, metalness: 0 };
        if (G.map) o.map = await texture(G.map, true, k === 'cloth' || k === 'hair');
        let m;
        if (k === 'skin' || k === 'face') { o.roughness = 0.6; m = new THREE.MeshStandardMaterial(o); m.envMapIntensity = 0.6; m.userData.patch = shader => { skinPatch(shader); woundPatch(shader, this.woundU); }; m.userData.patchKey = 'skin+wound'; }
        else if (k === 'overlay') m = new THREE.MeshStandardMaterial({ ...o, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
        else if (k === 'eyes') m = new THREE.MeshStandardMaterial({ ...o, roughness: 0.1, envMapIntensity: 1.1 });
        else if (k === 'mouth') m = new THREE.MeshStandardMaterial({ ...o, roughness: 0.3 });
        else if (k === 'hair') m = new THREE.MeshStandardMaterial({ ...o, roughness: 0.8, envMapIntensity: 0.35, alphaTest: G.cut ?? 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
        else if (k === 'cloth') {
          o.normalMap = G.normalMap ? await texture(G.normalMap, false, true) : civ.flatNormal;       // (every garment through the one program: no normal map is a flat one)
          m = new THREE.MeshStandardMaterial({ ...o, side: THREE.DoubleSide, alphaTest: G.alpha === 'MASK' ? 0.5 : 0, ...(G.alpha === 'BLEND' ? { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 } : {}) });      // (a printed number or badge is a blended layer over the cloth)
          m.color.setRGB(G.base[0], G.base[1], G.base[2]);
        } else if (k === 'glass') m = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.1, metalness: 0.2, depthWrite: false });
        else m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: k === 'metal' ? 0.32 : 0.7, metalness: k === 'metal' ? 1 : 0 });
        if (o.map && k !== 'cloth') m.color.setRGB(G.base[0], G.base[1], G.base[2]);                  // (tints: skin, hair, beard)
        if (k === 'skin' || k === 'face') { const t = this.head.tan || [1, 1, 1]; m.color.r *= t[0]; m.color.g *= t[1]; m.color.b *= t[2]; }      // (and the sun: build-civilians.py TAN)
        if (k === 'cloth' || k === 'hair' || k === 'flat') { m.userData.patch = shader => woundPatch(shader, this.woundU); m.userData.patchKey = 'wound'; }
        m.name = 'civ-' + k;
        return R.setup(m);
      }));
      this.nearMats = mats;
      return mats;
    })());
  }

  // One instance of this person: bones, a skeleton, and meshes for the near groups and the far versions (hidden until asked for).
  build() {
    const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig);
    const bones = this.head.bones.map((b, i) => { const o = new THREE.Bone(); o.name = b.name; o.position.copy(this.restT[i]); o.quaternion.copy(this.restQ[i]); return o; });
    this.head.bones.forEach((b, i) => (b.parent < 0 ? rig : bones[b.parent]).add(bones[i]));
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones), face = new Array(this.head.morphs.length).fill(0), bind = new THREE.Matrix4();
    const dict = Object.fromEntries(this.head.morphs.map((n, i) => [n, i]));
    const mk = (geometry, name, morph = false) => {
      const m = new THREE.SkinnedMesh(geometry, undefined); m.name = name; m.bind(skeleton, bind); m.frustumCulled = false; m.visible = false; m.receiveShadow = true;
      if (morph) { m.morphTargetInfluences = face; m.morphTargetDictionary = dict; }
      root.add(m); return m;
    };
    const near = this.groups.map(G => { const m = mk(G.geometry, 'civ:' + G.kind, !!G.sparse); m.castShadow = G.kind === 'skin' || G.kind === 'face' || G.kind === 'hair' || G.kind === 'cloth' || G.kind === 'flat'; if (G.kind === 'overlay' || G.kind === 'glass') m.renderOrder = 3; return m; });
    const far = this.lods.map((g, i) => { const m = mk(g, 'civ:far' + i); m.material = this.farMat; m.castShadow = true; return m; });
    return { root, rig, bones, skeleton, face, near, far };
  }
}

// Fetches the cast list, the clips and `count` people (their meshes and far atlases; near textures come later, by need).
export async function loadCivilians(R, count = 99, onProgress = () => {}) {
  const cast = civ.cast = await fetch(DIR + 'cast.json').then(r => r.json()), A = civ.anims = cast.anims;
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true; civ.flatNormal = flat;
  const bin = await fetch(DIR + 'anims.bin').then(r => r.arrayBuffer()), nb = A.bones.length;
  for (const c of A.clips) {
    civ.clips.set(c.id, { ...c, nb, q: new Int16Array(bin.slice(c.q, c.q + c.keys * nb * 8)), hips: new Float32Array(bin.slice(c.hips, c.hips + c.keys * 12)),
      face: c.face != null ? new Uint8Array(bin.slice(c.face, c.face + c.keys * A.morphs.length)) : null,
      downL: Uint8Array.from(c.down.L, ch => +ch), downR: Uint8Array.from(c.down.R, ch => +ch) });
  }
  // (when a preset loads only some of the cast: two women, a man, two women, a man…, not the file's first names)
  const women = cast.people.filter(p => p.female), men = cast.people.filter(p => !p.female), mixed = [];
  while (women.length || men.length) { mixed.push(...women.splice(0, 2), ...men.splice(0, 1)); }
  const list = mixed.slice(0, count); let done = 0;
  civ.people = await Promise.all(list.map(async info => {
    const { head, arr } = parse(await fetch(DIR + info.id + '.bin').then(r => r.arrayBuffer()));
    const p = new Person(info, head, arr); await p.loadFar(R); onProgress(++done / list.length);
    return p;
  }));
  civ.ready = true;
  return civ;
}
