'use strict';
// Compile the plugin's real sync modules (src/sync/syncManager.ts + its imports)
// into a single CJS bundle that Node can require, with the `siyuan` UI module
// aliased to a headless stub. Uses esbuild (already a devDependency via
// esbuild-loader) — types are stripped, NOT type-checked (tsc/jest still guard
// types). The bundled code references the free globals `fetch` and `window`,
// which the harness installs on globalThis before requiring the output.
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function compileSyncModule() {
  const entry = path.resolve(__dirname, 'sync-entry.ts');
  const outdir = path.resolve(__dirname, '..', '.compiled');
  fs.mkdirSync(outdir, { recursive: true });
  const outfile = path.join(outdir, 'plugin-sync.cjs');

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile,
    alias: { siyuan: path.resolve(__dirname, 'siyuan-stub.js') },
    logLevel: 'silent',
  });

  delete require.cache[require.resolve(outfile)];
  return require(outfile);
}

module.exports = { compileSyncModule };
