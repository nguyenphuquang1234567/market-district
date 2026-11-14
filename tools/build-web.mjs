import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const dependencies = [
  'three/build/three.module.js',
  'three/examples/jsm',
  'three-mesh-bvh/build/index.module.js',
  '@dimforge/rapier3d-compat/dist/rapier.mjs',
  'meshoptimizer/meshopt_simplifier.module.js',
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
const html = await readFile(join(root, 'index.html'), 'utf8');
await Promise.all([
  writeFile(join(dist, 'index.html'), html.replaceAll('./node_modules/', './vendor/')),
  cp(join(root, 'src'), join(dist, 'src'), { recursive: true }),
  cp(join(root, 'assets'), join(dist, 'assets'), {
    recursive: true,
    filter: path => !path.endsWith('/.DS_Store'),
  }),
  ...dependencies.map(path => cp(join(root, 'node_modules', path), join(dist, 'vendor', path), { recursive: true })),
]);
