// Compare two layout fingerprints (tools/layout-fingerprint.js): node tools/compare-fingerprints.mjs A.json B.json
// Exit 0 and "layout identical" when every layout key matches; else each differing key, exit 1. What is drawn is
// reported alongside but never fails the comparison.
import { readFileSync } from 'node:fs';

const LAYOUT = ['protos', 'hulls', 'colliders', 'lowColliders', 'rails', 'details', 'dynamic', 'spawns', 'nav', 'anchors', 'emitters', 'lamps'];
const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('usage: node tools/compare-fingerprints.mjs A.json B.json'); process.exit(2); }
const A = JSON.parse(readFileSync(fa, 'utf8')), B = JSON.parse(readFileSync(fb, 'utf8'));

const bad = [];
for (const k of LAYOUT) {
  if (A[k] === undefined || B[k] === undefined) { console.log(`(${k}: missing in ${A[k] === undefined ? fa : fb}, not compared)`); continue; }
  if (JSON.stringify(A[k]) === JSON.stringify(B[k])) continue;
  if (A[k] && typeof A[k] === 'object' && !Array.isArray(A[k])) {
    const keys = new Set([...Object.keys(A[k]), ...Object.keys(B[k])]);
    for (const s of keys) if (JSON.stringify(A[k][s]) !== JSON.stringify(B[k][s])) bad.push(`${k}.${s}: ${JSON.stringify(A[k][s])} -> ${JSON.stringify(B[k][s])}`);
  } else bad.push(`${k}: ${JSON.stringify(A[k])} -> ${JSON.stringify(B[k])}`);
}

// what is drawn: triangles by mesh name (and kit lod), only the names that changed
const drawn = [], dA = A.drawn || {}, dB = B.drawn || {};
for (const n of new Set([...Object.keys(dA), ...Object.keys(dB)])) if ((dA[n] || 0) !== (dB[n] || 0)) drawn.push(`${n} ${dA[n] || 0} -> ${dB[n] || 0}`);
console.log(`drawn index total ${A.drawnIndexTotal} -> ${B.drawnIndexTotal} (${((B.drawnIndexTotal - A.drawnIndexTotal) / 3 / 1000).toFixed(1)}k tris)`);
if (drawn.length) console.log('drawn by mesh: ' + drawn.join('; '));
const ray = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
console.log(`ray-mesh tris ${ray(A.rayMeshes)} -> ${ray(B.rayMeshes)}, cloth-mesh tris ${ray(A.clothMeshes)} -> ${ray(B.clothMeshes)}`);
if (B.nearTris && Object.keys(B.nearTris).length) console.log('near scanned props: ' + Object.entries(B.nearTris).map(([k, v]) => `${k} ${v}`).join(', '));

if (bad.length) { console.log('LAYOUT DIFFERS:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('layout identical');
