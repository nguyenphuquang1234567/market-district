// One-time setup: downloads every runtime asset into ./assets and writes ASSETS.md.
// After this the game runs fully offline.  Usage: npm run assets
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');
const API = 'https://api.polyhaven.com';
const UA = { 'User-Agent': 'asset-fetch/1.0' };

const HDRI = { id: 'kloofendal_48d_partly_cloudy_puresky', res: '4k' };

const TEX = {
  asphalt_02: '2k', concrete_pavement: '2k', painted_plaster_wall: '2k', plastered_wall_04: '2k',
  damaged_plaster: '2k', worn_plaster_wall: '2k',
  sandy_gravel: '1k', rubble: '1k', cracked_concrete: '1k', interior_tiles: '1k',
  peeling_painted_wall: '1k', blue_plaster_weathered: '1k', red_plaster_weathered: '1k', white_rough_plaster: '1k',
  dirty_concrete: '1k', concrete_wall_008: '1k', red_brick_plaster_patch_02: '1k', rough_plaster_broken: '1k',
  weathered_planks: '1k', wood_shutter: '1k', rough_pine_door: '1k',
  rusty_metal_shutter: '1k', corrugated_iron_02: '1k', rusty_metal_02: '1k', green_metal_rust: '1k', metal_plate: '1k',
  fabric_pattern_07: '1k', fabric_pattern_05: '1k', cotton_jersey: '1k', hessian_230: '1k', dirty_carpet: '1k',
  palm_tree_bark: '1k',
  // the market quarter: river-stone street paving, terracotta floor tiles, red brick, pink building stone (cantera),
  // painted roll-up shutters, corrugated roofing
  cobblestone_floor_13: '2k', terracotta_floor_tiles: '1k', castle_brick_02_red: '1k', red_sandstone_wall: '1k',
  painted_metal_shutter: '1k', worn_corrugated_iron: '1k',
};

const MODELS = [
  'concrete_road_barrier', 'concrete_road_barrier_02', 'barrel_03', 'Barrel_02', 'wooden_crate_01', 'old_military_crate',
  'cardboard_box_01', 'plastic_crate_02', 'industrial_pastic_container', 'propane_tank', 'small_lpg_tank', 'metal_jerrycan',
  'old_tyre', 'trashbag', 'metal_trash_can', 'exterior_aircon_unit', 'utility_box_01',
  'street_lamp_02', 'WoodenTable_01', 'wooden_table_02', 'painted_wooden_table', 'plastic_monobloc_chair_01',
  'folding_wooden_stool', 'wicker_basket_01', 'wicker_basket_02', 'planter_pot_clay',
  'food_apple_01', 'food_lime_01', 'food_pomegranate_01', 'lemon', 'sweet_potato', 'yellow_onion',
  'shrub_02', 'shrub_04', 'weed_plant_02', 'wild_rooibos_bush', 'covered_car', 'hand_truck', 'wooden_ladder',
  'steel_frame_shelves_01', 'water_manhole_cover',
];

const SOLDIER = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb';

const exists = async p => { try { return (await stat(p)).size > 0; } catch { return false; } };
const json = async url => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
async function dl(url, path) {
  if (await exists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await writeFile(path, Buffer.from(await r.arrayBuffer()));
}
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

const manifest = [];
async function credit(id, kind) {
  const info = await json(`${API}/info/${id}`);
  manifest.push({ id, kind, authors: Object.keys(info.authors || {}).join(', ') });
}

async function hdri() {
  const f = await json(`${API}/files/${HDRI.id}`);
  await dl(f.hdri[HDRI.res].hdr.url, join(OUT, 'hdri', 'sky.hdr'));
  await credit(HDRI.id, `HDRI ${HDRI.res}`);
}

async function texture(id) {
  const res = TEX[id];
  const f = await json(`${API}/files/${id}`);
  const pick = (...keys) => { for (const k of keys) if (f[k]?.[res]?.jpg) return f[k][res].jpg.url; return null; };
  const maps = { diff: pick('Diffuse', 'diff', 'col_1', 'col_01'), nor: pick('nor_gl'), arm: pick('arm') };
  for (const [k, url] of Object.entries(maps)) {
    if (!url) { console.warn(`  ! ${id}: no ${k} map`); continue; }
    await dl(url, join(OUT, 'tex', id, `${k}.jpg`));
  }
  await credit(id, `PBR texture ${res}`);
}

async function model(id) {
  const f = await json(`${API}/files/${id}`);
  const g = f.gltf['1k'].gltf;
  const dir = join(OUT, 'models', id);
  await dl(g.url, join(dir, `${id}.gltf`));
  for (const [rel, v] of Object.entries(g.include || {})) await dl(v.url, join(dir, rel));
  await credit(id, 'Model (glTF, 1k)');
}

console.log('HDRI…'); await hdri();
console.log('Textures…'); await pool(Object.keys(TEX), 6, async id => { await texture(id); console.log('  ' + id); });
console.log('Models…'); await pool(MODELS, 6, async id => { await model(id); console.log('  ' + id); });
console.log('Soldier…'); await dl(SOLDIER, join(OUT, 'models', 'soldier.glb'));

manifest.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
const md = `# Asset manifest

All runtime assets live in \`assets/\` and are loaded locally. Re-create with \`npm run assets\`.

## Poly Haven — CC0 1.0 (public domain, no attribution required, redistribution allowed)

| Asset | Type | Author(s) | Source |
| --- | --- | --- | --- |
${manifest.map(m => `| ${m.id} | ${m.kind} | ${m.authors} | https://polyhaven.com/a/${m.id} |`).join('\n')}

## three.js example assets

| Asset | Type | Provider | License / terms | Source |
| --- | --- | --- | --- | --- |
| soldier.glb | Rigged character + idle/walk/run clips | Mixamo (Adobe), distributed in the three.js repository | Mixamo characters and animations are royalty-free for use in games and other projects; they may not be redistributed as a standalone asset library | https://github.com/mrdoob/three.js/blob/r170/examples/models/gltf/Soldier.glb |

## Recorded sound — OpenGameArt

The voices of dying soldiers and the thud of a body are real recordings, cut from these packs into
\`assets/audio/voices.wav\` (index of every clip and its source in \`assets/audio/voices.json\`) by \`tools/build-voices.py\`.
Changes made: clips selected and trimmed, longer takes faded out, mixed to mono, high-passed at 70 Hz, loudness
evened, resampled to 32 kHz. Re-create with \`python3 tools/build-voices.py\`.

| Recording | Clips used | Author | License | Source |
| --- | --- | --- | --- | --- |
| Male Grunt/Yelling sounds | 24 screams, 4 short cries (four men) | HaelDB | CC0 1.0 | https://opengameart.org/content/male-gruntyelling-sounds |
| 11 male human pain/death sounds | 8 cries of pain, 3 death cries | Michel Baradari (submitted by qubodup) | CC-BY 3.0 | https://opengameart.org/content/11-male-human-paindeath-sounds |
| grunts of male death and pain | 7 death cries, 6 dying groans | thebardofblasphemy | CC0 1.0 | https://opengameart.org/content/grunts-male-death-and-pain |
| Body Hitting Ground | 4 body thuds (foley) | dklon | CC-BY 3.0 | https://opengameart.org/content/body-hitting-ground |

## Code

| Package | License |
| --- | --- |
| three 0.170.0 | MIT |
| three-mesh-bvh 0.8.3 | MIT |
| meshoptimizer 0.21.0 | MIT |
| @dimforge/rapier3d-compat 0.21.0 | Apache-2.0 |

Everything else (map, buildings, weapon, hands, palms, cloth, effects, HUD, all other audio) is generated procedurally in \`src/\`.
`;
await writeFile(join(ROOT, 'ASSETS.md'), md);
console.log(`Done: ${manifest.length} Poly Haven assets + soldier.glb`);
