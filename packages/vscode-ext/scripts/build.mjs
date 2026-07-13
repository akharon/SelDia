// =============================================================================
// SelDiA VS Code Extension — Esbuild Bundler
// =============================================================================
// Bundles the extension into a single file, inlining @seldia/* workspace
// packages (which are npm workspace symlinks that vsce can't package).
// External: vscode (VS Code API), puppeteer (binary), marked (large).
// =============================================================================

import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  keepNames: true,
  external: [
    'vscode',           // provided by VS Code at runtime
    'puppeteer',        // contains Chromium binary, can't bundle
  ],
  logLevel: 'info',
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    // Clean old dist files (keep only esbuild output)
    const { rmSync, readdirSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const distDir = new URL('../dist', import.meta.url).pathname;
    if (existsSync(distDir)) {
      for (const entry of readdirSync(distDir)) {
        if (entry !== 'extension.js' && entry !== 'extension.js.map') {
          rmSync(join(distDir, entry), { recursive: true, force: true });
        }
      }
    }

    const result = await esbuild.build(config);
    if (result.errors.length > 0) {
      console.error('[esbuild] Build failed:', result.errors);
      process.exit(1);
    }
    console.log('[esbuild] Build complete — dist/extension.js');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
