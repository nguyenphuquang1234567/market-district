import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

const TEX_IDS = [
  'asphalt_02', 'concrete_pavement', 'painted_plaster_wall', 'plastered_wall_04', 'damaged_plaster', 'worn_plaster_wall',
  'sandy_gravel', 'rubble', 'cracked_concrete', 'interior_tiles', 'peeling_painted_wall', 'blue_plaster_weathered',
  'red_plaster_weathered', 'white_rough_plaster', 'dirty_concrete', 'concrete_wall_008', 'red_brick_plaster_patch_02',
  'rough_plaster_broken', 'weathered_planks', 'wood_shutter', 'rough_pine_door', 'rusty_metal_shutter', 'corrugated_iron_02',
  'rusty_metal_02', 'green_metal_rust', 'metal_plate', 'fabric_pattern_07', 'fabric_pattern_05', 'cotton_jersey',
  'hessian_230', 'dirty_carpet', 'palm_tree_bark',
  'cobblestone_floor_13', 'terracotta_floor_tiles', 'castle_brick_02_red', 'red_sandstone_wall', 'painted_metal_shutter', 'worn_corrugated_iron',
];

// model id -> list of [protoName, nodeNameRegex]; a model with one entry is taken whole.
const MODELS = {
  concrete_road_barrier: [['barrier', /./]], concrete_road_barrier_02: [['barrier2', /./]],
  barrel_03: [['drum', /./]], Barrel_02: [['drum_plastic', /./]], wooden_crate_01: [['crate', /./]],
  old_military_crate: [['mil_crate', /_a$/], ['mil_crate_open', /_b$/]], cardboard_box_01: [['cardboard', /./]],
  plastic_crate_02: [['plastic_crate', /./]], industrial_pastic_container: [['container', /./]],
  propane_tank: [['propane', /./]], small_lpg_tank: [['lpg', /./]], metal_jerrycan: [['jerrycan', /./]],
  old_tyre: [['tyre', /./]], trashbag: [['trashbag', /./]],
  metal_trash_can: [['trashcan', /^metal_trash_can(?!_rust)/], ['trashcan_rust', /_rust/]],
  exterior_aircon_unit: [['ac', /^exterior_aircon_unit$/], ['ac_rust', /_rusted$/]],
  utility_box_01: [['utility_box', /./]],
  street_lamp_02: [['wall_lamp', /./]], WoodenTable_01: [['bench_table', /./]], wooden_table_02: [['table', /./]],
  painted_wooden_table: [['table_blue', /./]], plastic_monobloc_chair_01: [['chair', /./]],
  folding_wooden_stool: [['stool', /./]], wicker_basket_01: [['basket', /./]], wicker_basket_02: [['basket_tall', /./]],
  planter_pot_clay: [['pot', /./]],
  food_apple_01: [['apple', /./]], food_lime_01: [['lime', /./]], food_pomegranate_01: [['pomegranate', /./]],
  lemon: [['lemon', /./]], sweet_potato: [['sweet_potato', /./]], yellow_onion: [['onion', /./]],
  shrub_02: [['shrub_a', /_a$/], ['shrub_b', /_b$/], ['shrub_c', /_c$/], ['shrub_d', /_d$/]],
  weed_plant_02: [['weed_a', /_a_LOD0/], ['weed_b', /_b_LOD0/], ['weed_c', /_c_LOD0/]],
  wild_rooibos_bush: [['bush_a', /_a$/], ['bush_b', /_b$/], ['bush_c', /_c$/]],
  covered_car: [['car', /./]], hand_truck: [['hand_truck', /./]], wooden_ladder: [['ladder', /./]],
  steel_frame_shelves_01: [['shelves', /./]], water_manhole_cover: [['manhole', /./]],
};

export const assets = { tex: {}, proto: {}, soldier: null, sky: null };

// Vanguard's red insignia is painted into its diffuse atlas. Shift only those pixels for the blue team,
// keeping the texture's wear and material detail on the same skin instead of attaching extra geometry.
function blueInsignia(map) {
  const canvas = document.createElement('canvas');
  canvas.width = map.image.width;
  canvas.height = map.image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(map.image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    if (red < 32) continue;
    const redSaturation = 1 - Math.max(green, blue) / red;
    const weight = Math.min(1, Math.max(0, (redSaturation - 0.47) / 0.27));
    if (!weight) continue;
    data[i] = red + (red * 0.32 - red) * weight;
    data[i + 1] = green + (red * 0.77 - green) * weight;
    data[i + 2] = blue + (red * 1.3 - blue) * weight;
  }
  ctx.putImageData(pixels, 0, 0);
  const tex = map.clone();
  tex.source = new THREE.Source(canvas);
  tex.needsUpdate = true;
  return tex;
}

// The scans are film-resolution; cut each prop to a triangle budget that suits its size on screen.
const BUDGET = { wall_lamp: 1800, barrier: 6000, barrier2: 4500, car: 12000, shelves: 1400, power_box: 500, ac: 2200, ac_rust: 2200, pot: 420, crate: 1400, cardboard: 900, basket: 700, basket_tall: 700, jerrycan: 800, chair: 2600, plastic_crate: 1300 };
function simplify(g, target, err = 0.12) {
  const tris = g.index.count / 3;
  if (tris <= target * 1.15) return g;
  const src = g.index.array instanceof Uint32Array ? g.index.array : new Uint32Array(g.index.array);
  const [idx] = MeshoptSimplifier.simplify(src, g.attributes.position.array, 3, Math.floor(target) * 3, err);
  const remap = new Int32Array(g.attributes.position.count).fill(-1); let n = 0;
  for (let i = 0; i < idx.length; i++) { if (remap[idx[i]] < 0) remap[idx[i]] = n++; idx[i] = remap[idx[i]]; }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(n * a.itemSize);
    for (let v = 0; v < remap.length; v++) if (remap[v] >= 0) for (let k = 0; k < a.itemSize; k++) arr[remap[v] * a.itemSize + k] = a.array[v * a.itemSize + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Bake a set of glTF nodes into world-space geometry, merged per material, with the base centred on the origin.
function bake(scene, re, name) {
  scene.updateMatrixWorld(true);
  const byMat = new Map();
  scene.traverse(o => {
    if (!o.isMesh || !re.test(o.name)) return;
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const box = new THREE.Box3();
  for (const gs of byMat.values()) for (const g of gs) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const c = box.getCenter(new THREE.Vector3());
  const parts = [], size = box.getSize(new THREE.Vector3());
  const total = [...byMat.values()].flat().reduce((t, g) => t + g.index.count / 3, 0);
  const budget = BUDGET[name] || Math.max(260, 3000 * Math.max(size.x, size.y, size.z));
  for (const [material, gs] of byMat) {
    let g = gs.length > 1 ? (mergeGeometries(gs) || gs[0]) : gs[0];
    g.translate(-c.x, -box.min.y, -c.z);
    const foliage = (material.transparent || material.alphaTest > 0) && /^(shrub|weed|bush)/.test(name);
    if (!foliage) g = simplify(g, budget * (g.index.count / 3 / total), /basket|plastic_crate/.test(name) ? 0.35 : 0.12);
    if (!foliage && (material.transparent || material.alphaTest > 0)) { material.transparent = false; material.alphaTest = 0.4; material.depthWrite = true; }
    if (foliage) {
      material.transparent = false; material.alphaTest = 0.45; material.depthWrite = true; material.side = THREE.DoubleSide;
      material.userData.foliage = true;
    }
    parts.push({ geometry: g, material });
  }
  if (size.y > 6) {                               // a few scans are authored in decimetres
    const k = 2.0 / size.y;
    for (const part of parts) part.geometry.scale(k, k, k);
    size.multiplyScalar(k);
  }
  return { parts, size, small: Math.max(size.x, size.y, size.z) < 0.56 };
}

// Textures are KTX2 (Basis UASTC, see tools/encode-ktx2.mjs): transcoded off the main thread to whatever block format
// the GPU takes (ASTC 4x4 or BC7 here), mipmaps included, so they stay a quarter of the size in video memory and
// nothing is decoded or mipmapped on the main thread. ?tex=jpg loads the original JPEGs instead (for comparisons).
// Each texture remembers its JPEG (userData.src) for the light bake, which averages colours from the image.
export const useKTX2 = new URLSearchParams(location.search).get('tex') !== 'jpg';

export async function loadAssets(renderer, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, n, total) => onProgress(n / total);
  const tl = new THREE.TextureLoader(manager), gl = new GLTFLoader(manager), hl = new RGBELoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let kl = null;
  if (useKTX2) {
    const base = import.meta.resolve('three/addons/libs/basis/basis_transcoder.js').replace(/[^/]+$/, '');
    kl = new KTX2Loader(manager).setTranscoderPath(base).detectSupport(renderer);
    gl.setKTX2Loader(kl);
  }
  const tex = (stem, srgb) => (kl ? kl.loadAsync(stem + '.ktx2') : tl.loadAsync(stem + '.jpg')).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;          // (a KTX2 file says so itself; the JPEGs need telling)
    t.userData.src = stem + '.jpg';
    return t;
  });
  await MeshoptSimplifier.ready;
  const jobs = [];
  for (const id of TEX_IDS) {
    const d = `assets/tex/${id}/`;
    jobs.push(Promise.all([tex(d + 'diff', true), tex(d + 'nor'), tex(d + 'arm')])
      .then(([diff, nor, arm]) => { assets.tex[id] = { diff, nor, arm }; }));
  }
  for (const [id, defs] of Object.entries(MODELS)) {
    const dir = `assets/models/${id}/`;
    jobs.push(gl.loadAsync(dir + id + (kl ? '.basis.gltf' : '.gltf')).then(g => {
      const json = g.parser.json;
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        for (const k of ['map', 'normalMap', 'roughnessMap']) if (o.material[k]) o.material[k].anisotropy = 4;
        for (const t of [o.material.map, o.material.normalMap, o.material.roughnessMap, o.material.aoMap, o.material.metalnessMap]) {
          const ti = t && g.parser.associations.get(t)?.textures, src = ti != null ? json.textures[ti].source : null;
          if (src != null && json.images[src]?.uri) t.userData.src = dir + json.images[src].uri;     // (the extension's fallback is the original image)
        }
      });
      for (const [name, re] of defs) assets.proto[name] = bake(g.scene, re, name);
    }));
  }
  // the architectural kit (tools/blender/kit.py): piece name -> [{ geometry, slot }], one part per material slot
  jobs.push(gl.loadAsync('assets/kit/kit.glb').then(g => {
    const kit = {};
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const piece = o.parent && !o.parent.isScene && o.parent !== g.scene ? o.parent.name : o.name;   // (a node with several materials is a group of meshes)
      (kit[piece] ||= []).push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), slot: o.material.name });
    });
    assets.kit = kit;
  }));
  jobs.push(gl.loadAsync('assets/models/soldier.glb').then(g => {
    const body = g.scene.getObjectByName('vanguard_Mesh');
    g.allyMap = blueInsignia(body.material.map);
    assets.soldier = g;
  }));
  jobs.push(hl.loadAsync('assets/hdri/sky.hdr').then(t => { assets.sky = t; }));
  await Promise.all(jobs);
  return assets;
}
