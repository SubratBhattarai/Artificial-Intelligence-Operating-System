/** Production build: main + preload via esbuild, renderer via Vite. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(root, 'dist/main/index.js'),
  }),
  esbuild.build({
    ...shared,
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(root, 'dist/preload/index.js'),
  }),
]);

await viteBuild({ configFile: path.join(root, 'vite.config.ts') });

console.log('build complete → dist/');
