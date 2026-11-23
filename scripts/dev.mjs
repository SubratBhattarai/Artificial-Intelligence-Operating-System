/**
 * Dev orchestrator: Vite dev server for the renderer + esbuild watch for main/preload,
 * with Electron relaunching on each successful rebuild.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBin = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
await server.listen();
const devUrl =
  server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ??
  `http://localhost:${server.config.server.port ?? 5173}`;
console.log(`[dev] renderer at ${devUrl}`);

let child = null;
let relaunchTimer = null;
let shuttingDown = false;

function launch() {
  // Guard against ELECTRON_RUN_AS_NODE leaking in from the parent shell (VS Code terminals,
  // CI, agent shells): it turns Electron into plain Node and `require('electron')` returns a path.
  const env = { ...process.env, VITE_DEV_SERVER_URL: devUrl };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronBin, ['.'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (!shuttingDown) console.log(`[dev] electron exited with code ${code}`);
    child = null;
  });
}

function scheduleRelaunch(label) {
  if (shuttingDown) return;
  if (relaunchTimer) clearTimeout(relaunchTimer);
  relaunchTimer = setTimeout(() => {
    relaunchTimer = null;
    if (child) {
      const previous = child;
      child = null;
      previous.removeAllListeners();
      previous.kill();
    }
    console.log(`[dev] rebuilt ${label} → relaunching electron`);
    launch();
  }, 250);
}

function rebuildPlugin(label) {
  return {
    name: `relaunch-${label}`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error(`[dev] ${label} build failed`);
          return;
        }
        scheduleRelaunch(label);
      });
    },
  };
}

function configFor(entry, outfile, label) {
  return {
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(root, outfile),
    external: ['electron'],
    sourcemap: 'inline',
    logLevel: 'silent',
    plugins: [rebuildPlugin(label)],
  };
}

const mainContext = await esbuild.context(
  configFor('src/main/index.ts', 'dist/main/index.js', 'main'),
);
const preloadContext = await esbuild.context(
  configFor('src/preload/index.ts', 'dist/preload/index.js', 'preload'),
);

await Promise.all([mainContext.watch(), preloadContext.watch()]);

function shutdown() {
  shuttingDown = true;
  if (relaunchTimer) clearTimeout(relaunchTimer);
  if (child) child.kill();
  void server.close().then(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
