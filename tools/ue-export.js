// Exports the district for the Unreal Engine port (tools/ue/): the world exactly as the game builds it, in world space.
//   - one GLB per material (geometry only: positions, normals, UVs, vertex colours; metres, the game's axes, which glTF
//     shares), the near (detailed) architecture kept and its flat far stand-ins left out; instanced props expanded;
//   - ue_materials.json: each material's textures (the scanned set and slot, or a procedural texture saved as PNG),
//     colours, roughness/metalness, transparency, alpha cut, sidedness, texture repeat, and the game's weathering key;
//   - procedural textures (signs, papel picado, talavera, tarps, leaves...) as PNG.
// Soldiers and civilians (skinned) and effects are not exported. Load it in the page and run:
//   const X = await import('/tools/ue-export.js?v=' + Date.now()); await X.run(G)
// Files land in captures/ as ue_*.glb, ue_*.png, ue_materials.json (the dev server's capture endpoint).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '/src/assets.js';

const post = (name, body) => fetch('/__capture/' + name, { method: 'POST', body }).then(r => { if (!r.ok) throw new Error('upload ' + name); });
const safe = s => String(s || 'mat').replace(/[^\w-]/g, '_').slice(0, 60);
const SKIP_MAT = /^(civ-|mh-|sky|smoke|muzzle|flash|tracer|blood|decal|casing|spark|dust|mote)/i;

// which scanned set and slot a texture is
function textureIndex() {
  const idx = new Map();
  for (const [id, set] of Object.entries(assets.tex || {})) for (const [slot, t] of Object.entries(set || {})) if (t?.isTexture) idx.set(t.uuid, { set: id, slot });
  return idx;
}

// a texture's pixels as PNG (procedural canvases, and anything else not from a scanned set)
async function texturePng(t) {
  const img = t.image;
  if (!img) return null;
  let canvas;
  if (img instanceof HTMLCanvasElement) canvas = img;
  else if (img instanceof ImageBitmap || img instanceof HTMLImageElement || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)) {
    canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').drawImage(img, 0, 0);
  } else if (img.data && img.width && img.height && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)) {
    canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const c = canvas.getContext('2d'), d = c.createImageData(img.width, img.height), n = img.width * img.height, k = img.data.length / n;
    for (let i = 0; i < n; i++) { d.data[i * 4] = img.data[i * k]; d.data[i * 4 + 1] = img.data[i * k + (k > 1 ? 1 : 0)]; d.data[i * 4 + 2] = img.data[i * k + (k > 2 ? 2 : 0)]; d.data[i * 4 + 3] = k > 3 ? img.data[i * k + 3] : 255; }
    c.putImageData(d, 0, 0);
  } else return null;
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

// geometry with exactly position, normal, uv, color (float RGBA), indexed, in world space
function prepare(geometry, matrix) {
  let g = new THREE.BufferGeometry();
  const src = geometry;
  g.setAttribute('position', src.attributes.position.clone());
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  const n = src.attributes.position.count;
  g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const col = new Uint8Array(n * 4).fill(255);                 // (8-bit, as the game's own vertex tints are)
  const c = src.attributes.color, q = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  if (c) for (let i = 0; i < n; i++) { col[i * 4] = q(c.getX(i)); col[i * 4 + 1] = q(c.getY(i)); col[i * 4 + 2] = q(c.getZ(i)); if (c.itemSize > 3) col[i * 4 + 3] = q(c.getW(i)); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
  g.setIndex(src.index ? src.index.clone() : new THREE.BufferAttribute(Uint32Array.from({ length: n }, (_, i) => i), 1));
  // (interleaved or normalised sources become plain floats)
  for (const k of ['position', 'normal', 'uv']) {
    const a = g.attributes[k]; if (!a) continue;
    if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array)) {
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (matrix && !matrix.equals(new THREE.Matrix4())) g.applyMatrix4(matrix);
  return g;
}

export async function run(G, { dryRun = false } = {}) {
  const S = G.R.scene, groups = new Map(), counts = { batches: 0, cells: 0, instanced: 0, instances: 0, meshes: 0, skipped: 0 };
  const add = (mat, geometry, matrix) => {
    if (!mat || SKIP_MAT.test(mat.name || '')) { counts.skipped++; return; }
    let g = groups.get(mat.uuid); if (!g) groups.set(mat.uuid, g = { mat, parts: [] });
    g.parts.push(prepare(geometry, matrix));
  };
  S.updateMatrixWorld(true);
  S.traverse(o => {
    if (o.isSkinnedMesh || o.isPoints || o.isLine || o.isSprite) return;
    if (o.isBatchedMesh && o.parts) {
      if (String(o.userData.kitLod || '').startsWith('far')) return;          // (the flat far stand-ins)
      counts.batches++;
      for (const p of o.parts) { const s = p.src; s.updateMatrixWorld?.(true); add(Array.isArray(o.material) ? o.material[0] : o.material, s.geometry, s.matrixWorld); counts.cells++; }
      return;
    }
    if (o.isInstancedMesh) {
      counts.instanced++;
      const m = new THREE.Matrix4(), w = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); w.multiplyMatrices(o.matrixWorld, m); add(o.material, o.geometry, w.clone()); counts.instances++; }
      return;
    }
    if (o.isMesh) {
      if (!o.visible && !o.parent?.visible) return;
      if (o.material?.side === THREE.BackSide && o.geometry?.type === 'SphereGeometry') return;     // (the sky dome)
      counts.meshes++;
      (Array.isArray(o.material) ? [o.material[0]] : [o.material]).forEach(mat => add(mat, o.geometry, o.matrixWorld));
    }
  });
  if (dryRun) return { counts, materials: groups.size, tris: [...groups.values()].reduce((s, g) => s + g.parts.reduce((t, p) => t + p.index.count / 3, 0), 0) };

  const tidx = textureIndex(), pngs = new Map(), materials = [], exporter = new GLTFExporter();
  const texRef = async t => {
    if (!t) return null;
    const rep = { repeat: [t.repeat.x, t.repeat.y], offset: [t.offset.x, t.offset.y], rotation: t.rotation, wrap: t.wrapS === THREE.RepeatWrapping ? 'repeat' : 'clamp', srgb: t.colorSpace === THREE.SRGBColorSpace };
    const s = tidx.get(t.uuid);
    if (s) return { ...s, ...rep };
    if (t.userData?.src) return { file: t.userData.src, ...rep };          // (a scanned model's own texture: its source image in assets/models)
    let name = pngs.get(t.uuid);
    if (name === undefined) {
      const blob = await texturePng(t);
      name = blob ? `ue_tex_${safe(t.name || 'proc')}_${t.uuid.slice(0, 6)}.png` : null;
      if (blob) await post(name, blob);
      pngs.set(t.uuid, name);
    }
    return name ? { png: name, ...rep } : null;
  };
  let i = 0;
  for (const { mat, parts } of groups.values()) {
    const name = `${safe(mat.name || mat.type)}_${mat.uuid.slice(0, 6)}`;
    const geo = mergeGeometries(parts, false);
    if (!geo) { console.warn('merge failed', name); continue; }
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name, vertexColors: true }));
    mesh.name = name;
    const glb = await exporter.parseAsync(mesh, { binary: true });
    await post(`ue_mesh_${name}.glb`, new Blob([glb]));
    const maps = {};
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap']) if (mat[k]) maps[k] = await texRef(mat[k]);
    materials.push({
      name, source: mat.name, type: mat.type, file: `ue_mesh_${name}.glb`, tris: geo.index.count / 3,
      color: mat.color?.toArray(), emissive: mat.emissive?.toArray(), emissiveIntensity: mat.emissiveIntensity, roughness: mat.roughness, metalness: mat.metalness,
      opacity: mat.opacity, transparent: mat.transparent, alphaTest: mat.alphaTest, doubleSided: mat.side === THREE.DoubleSide, vertexColors: mat.vertexColors,
      normalScale: mat.normalScale?.toArray(), aoMapIntensity: mat.aoMapIntensity, envMapIntensity: mat.envMapIntensity, weathering: mat.userData?.patchKey || null, maps,
    });
    geo.dispose(); parts.forEach(p => p.dispose());
    if (++i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }
  await post('ue_materials.json', new Blob([JSON.stringify({ units: 'm', axes: 'three.js: y up, right-handed (glTF)', counts, materials }, null, 1)]));
  return { counts, materials: materials.length, pngs: [...pngs.values()].filter(Boolean).length };
}
