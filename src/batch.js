// Drawing the district with one draw call per material instead of one per material per 24 m cell.
//
// The frame was limited by the number of draw calls, not by pixels or triangles: about 2,000-3,000 a frame across the
// view and the shadow cascades, each a separate mesh for three.js to set up (measured: 12.8 of a 14 ms frame was spent
// submitting them). Here all of a material's cells are concatenated into one vertex and index buffer, each cell a
// range of the index buffer, and the cells that pass the culling are drawn together with WEBGL_multi_draw.
//
// The per-cell meshes stay as they were, but only as data: they are what bullets and thrown things hit (their ray
// trees), what the light bake reads, and where the renderer's culling writes its verdict (`visible`, by distance, by
// kit near/far, by zone). They are no longer in the scene. A batch reads each cell's `visible` when it is drawn and
// culls cells against the camera it is being drawn for (the view, or one shadow cascade).
//
// three.js r170 draws a mesh with multi-draw only if it claims to be a BatchedMesh, whose shader code looks a
// transform up in a texture for every vertex and re-uploads an index texture on every draw. The district is already
// in world space, so those shader chunks are replaced with an identity transform and no texture is ever bound.
import * as THREE from 'three';

THREE.ShaderChunk.batching_pars_vertex = '';
THREE.ShaderChunk.batching_vertex = '#ifdef USE_BATCHING\n\tmat4 batchingMatrix = mat4( 1.0 );\n#endif';

export const BATCH = new URLSearchParams(location.search).get('batch') !== '0';       // ?batch=0: every cell its own draw call, as before (A/B)

const _m = new THREE.Matrix4(), frusta = new Map();
let frameId = 0;
export const nextFrame = () => { frameId++; };
function frustumOf(camera) {
  let f = frusta.get(camera); if (!f) frusta.set(camera, f = { id: -1, fr: new THREE.Frustum() });
  if (f.id !== frameId) { f.id = frameId; f.fr.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
  return f.fr;
}

export class CellBatch extends THREE.Mesh {
  // parts: [{ src: the cell's own mesh, start: byte offset into the index buffer, count: indices, sphere, box }]
  constructor(geometry, material, parts) {
    super(geometry, material);
    this.isBatchedMesh = true; this.parts = parts;
    this._multiDrawStarts = new Int32Array(parts.length); this._multiDrawCounts = new Int32Array(parts.length); this._multiDrawCount = 0; this._multiDrawInstances = null;
    this._matricesTexture = null; this._indirectTexture = null; this._colorsTexture = null; this.colorTexture = null;    // (what the renderer asks a BatchedMesh for)
    this.frustumCulled = false; this.matrixAutoUpdate = false; this.sorted = -100;
  }
  fill(camera, view) {
    const fr = frustumOf(camera), parts = this.parts, starts = this._multiDrawStarts, counts = this._multiDrawCounts; let n = 0;
    if (view && frameId - this.sorted > 12) {                // nearest cells first (furthest first for blended decals); the order changes slowly
      const p = camera.position, back = this.material.transparent ? -1 : 1;
      for (const c of parts) c.d = c.sphere.center.distanceToSquared(p) * back;
      parts.sort((a, b) => a.d - b.d); this.sorted = frameId;
    }
    // (a cell's sphere reaches well above and below it; its box, tested only when the sphere passes, drops a few percent more)
    for (let i = 0; i < parts.length; i++) { const c = parts[i]; if (c.src.visible && fr.intersectsSphere(c.sphere) && fr.intersectsBox(c.box)) { starts[n] = c.start; counts[n++] = c.count; } }
    this._multiDrawCount = n;
  }
  onBeforeRender(renderer, scene, camera) { this.fill(camera, true); }
  // a cascade whose camera does not see this batch's layer draws none of it (render.js farShadowLayer: small things stay out of the far cascade)
  onBeforeShadow(renderer, object, camera, shadowCamera) { if (this.layers.test(shadowCamera.layers)) this.fill(shadowCamera, false); else this._multiDrawCount = 0; }
}

// meshes: the district's per-cell meshes. keep(m) true: left out of the batches and drawn through a twin of its own
// (same geometry, the material and visibility copied from the cell's mesh each frame: the trees' shadow proxies).
export function batchWorld(meshes, keep = () => false) {
  const group = new THREE.Group(); group.name = 'worldDraw';
  const sets = new Map(), twins = [];
  for (const m of meshes) {
    if (keep(m)) {
      const t = new THREE.Mesh(m.geometry, m.material); t.name = m.name; t.castShadow = m.castShadow; t.receiveShadow = m.receiveShadow; t.renderOrder = m.renderOrder; t.matrixAutoUpdate = false;
      Object.assign(t.userData, { lod: m.userData.lod, kitLod: m.userData.kitLod, noAO: m.userData.noAO, twinOf: m }); m.userData.twin = t; twins.push(t); group.add(t); continue;
    }
    const g = m.geometry, sig = Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize + g.attributes[k].array.constructor.name).join(',');
    const key = [m.material.uuid, m.userData.kitLod || '', m.castShadow ? 1 : 0, m.receiveShadow ? 1 : 0, m.renderOrder, m.userData.lod || 0, g.index ? 1 : 0, sig].join('|');
    let s = sets.get(key); if (!s) sets.set(key, s = []); s.push(m);
  }
  let bytes = 0;
  for (const list of sets.values()) {
    const first = list[0], names = Object.keys(first.geometry.attributes);
    let nv = 0, ni = 0; for (const m of list) { nv += m.geometry.attributes.position.count; ni += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count; }
    const g = new THREE.BufferGeometry(), index = new Uint32Array(ni), parts = [];
    const arrays = names.map(k => new first.geometry.attributes[k].array.constructor(nv * first.geometry.attributes[k].itemSize));
    let v0 = 0, i0 = 0;
    for (const m of list) {
      const mg = m.geometry, n = mg.attributes.position.count;
      names.forEach((k, a) => arrays[a].set(mg.attributes[k].array, v0 * mg.attributes[k].itemSize));
      let cnt;
      if (mg.index) { const src = mg.index.array; cnt = src.length; for (let i = 0; i < cnt; i++) index[i0 + i] = src[i] + v0; } else { cnt = n; for (let i = 0; i < cnt; i++) index[i0 + i] = v0 + i; }
      if (!mg.boundingSphere) mg.computeBoundingSphere(); if (!mg.boundingBox) mg.computeBoundingBox();
      parts.push({ src: m, start: i0 * 4, count: cnt, sphere: mg.boundingSphere, box: mg.boundingBox, d: 0 });
      v0 += n; i0 += cnt;
    }
    // once on the GPU the copies are let go: the cells' own arrays are what the game reads
    const drop = function () { this.array = null; };
    names.forEach((k, a) => { const at = new THREE.BufferAttribute(arrays[a], first.geometry.attributes[k].itemSize, first.geometry.attributes[k].normalized); at.onUpload(drop); g.setAttribute(k, at); bytes += arrays[a].byteLength; });
    const ia = new THREE.BufferAttribute(index, 1); ia.onUpload(drop); g.setIndex(ia); bytes += index.byteLength;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -1e5), new THREE.Vector3(1e5, 1e5, 1e5));
    g.userData.bytes = names.reduce((s, k, a) => s + arrays[a].byteLength, 0) + index.byteLength;
    const b = new CellBatch(g, first.material, parts);
    b.name = 'batch:' + first.name; b.castShadow = first.castShadow; b.receiveShadow = first.receiveShadow; b.renderOrder = first.renderOrder;
    Object.assign(b.userData, { lod: first.userData.lod, kitLod: first.userData.kitLod, noAO: first.userData.noAO, cells: list.length });
    group.add(b);
  }
  console.info(`batched: ${meshes.length - twins.length} cell meshes in ${sets.size} draws (${twins.length} kept apart), ${(bytes / 1048576).toFixed(0)} MB of buffers`);
  return { group, twins };
}
