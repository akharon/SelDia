// =============================================================================
// SelDiA VS Code Extension — Esbuild Bundler
// =============================================================================
// Bundles the extension into a single file, inlining @seldia/* workspace
// packages (which are npm workspace symlinks that vsce can't package).
// Also bundles the markdown preview script for in-webview rendering.
// External: vscode (VS Code API), puppeteer (binary), marked (large).
// =============================================================================

import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // Watch (F5 debug) keeps readable output + maps; packaged builds minify.
  sourcemap: isWatch,
  minify: !isWatch,
  keepNames: true,
  external: [
    'vscode',                  // provided by VS Code at runtime
    'puppeteer',                // contains Chromium binary, can't bundle
    '@marp-team/marp-core',     // heavy (mathjax, katex, highlight.js); lazy-required only for Marp docs
  ],
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const previewConfig = {
  entryPoints: ['src/markdown-preview/index.ts'],
  outfile: 'dist/seldia-preview.js',
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const editorClientConfig = {
  entryPoints: ['src/webview/client/editor.ts'],
  outfile: 'media/editor.js',
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const tableEditorClientConfig = {
  ...editorClientConfig,
  entryPoints: ['src/webview/client/table-editor.ts'],
  outfile: 'media/table-editor.js',
};

async function main() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    await extCtx.watch();
    const prevCtx = await esbuild.context(previewConfig);
    await prevCtx.watch();
    const editorCtx = await esbuild.context(editorClientConfig);
    await editorCtx.watch();
    const tableCtx = await esbuild.context(tableEditorClientConfig);
    await tableCtx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    // Clean old dist files (keep only esbuild output)
    const { rmSync, readdirSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const distDir = new URL('../dist', import.meta.url).pathname;
    if (existsSync(distDir)) {
      for (const entry of readdirSync(distDir)) {
        if (entry !== 'extension.cjs' && entry !== 'extension.cjs.map') {
          rmSync(join(distDir, entry), { recursive: true, force: true });
        }
      }
    }

    // Build extension (Node.js target)
    const extResult = await esbuild.build(extensionConfig);
    if (extResult.errors.length > 0) {
      console.error('[esbuild] Extension build failed:', extResult.errors);
      process.exit(1);
    }
    console.log('[esbuild] Extension build complete — dist/extension.cjs');

    // Build preview script (browser target for markdown preview webview)
    const prevResult = await esbuild.build(previewConfig);
    if (prevResult.errors.length > 0) {
      console.error('[esbuild] Preview script build failed:', prevResult.errors);
      process.exit(1);
    }
    console.log('[esbuild] Preview script build complete — dist/seldia-preview.js');

    // Build interactive editor client (browser target, loaded via asWebviewUri)
    const editorResult = await esbuild.build(editorClientConfig);
    if (editorResult.errors.length > 0) {
      console.error('[esbuild] Editor client build failed:', editorResult.errors);
      process.exit(1);
    }
    console.log('[esbuild] Editor client build complete — media/editor.js');

    // Build the GFM table editor client (browser target, loaded via asWebviewUri)
    const tableResult = await esbuild.build(tableEditorClientConfig);
    if (tableResult.errors.length > 0) {
      console.error('[esbuild] Table editor client build failed:', tableResult.errors);
      process.exit(1);
    }
    console.log('[esbuild] Table editor client build complete — media/table-editor.js');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
