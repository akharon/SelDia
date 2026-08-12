// =============================================================================
// SelDiA — Vendor externalized runtime deps for packaging
// =============================================================================
// esbuild leaves @marp-team/marp-core external (it's heavy — katex,
// mathjax-full, highlight.js — and only needed by documents that opt into
// `marp: true`). `vsce package --no-dependencies` never copies node_modules
// at all, so without this step the packaged extension throws
// "Cannot find module '@marp-team/marp-core'" the first time a user opens a
// Marp file. This copies marp-core's full transitive dependency closure into
// dist/node_modules so Node's resolution finds it relative to extension.cjs
// inside the installed .vsix, exactly as it does from the repo root in dev.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, cpSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..', '..', '..');
const rootModules = join(repoRoot, 'node_modules');
const destModules = join(scriptsDir, '..', 'dist', 'node_modules');

const roots = ['@marp-team/marp-core'];

function resolvePkgDir(name) {
  return join(rootModules, ...name.split('/'));
}

function readDeps(pkgDir) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return {};
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  return { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
}

function collectClosure(names, seen = new Set()) {
  for (const name of names) {
    if (seen.has(name)) continue;
    const pkgDir = resolvePkgDir(name);
    if (!existsSync(pkgDir)) {
      console.warn(`[vendor-deps] WARNING: ${name} not found under ${rootModules}, skipping`);
      continue;
    }
    seen.add(name);
    collectClosure(Object.keys(readDeps(pkgDir)), seen);
  }
  return seen;
}

const closure = collectClosure(roots);
console.log(`[vendor-deps] Vendoring ${closure.size} package(s) rooted at ${roots.join(', ')}`);

rmSync(destModules, { recursive: true, force: true });
mkdirSync(destModules, { recursive: true });

for (const name of closure) {
  const src = resolvePkgDir(name);
  const dest = join(destModules, ...name.split('/'));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, dereference: true });
}

console.log(`[vendor-deps] Done — dist/node_modules ready for packaging`);
