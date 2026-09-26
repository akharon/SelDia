// =============================================================================
// SelDiA — Vendor externalized runtime deps for packaging
// =============================================================================
// esbuild leaves some deps external: @marp-team/marp-core (heavy — katex,
// mathjax-full, highlight.js — and only needed by documents that opt into
// `marp: true`) and puppeteer (ships a platform-specific browser download and
// can't be bundled). `vsce package --no-dependencies` never copies
// node_modules at all, so without this step the packaged extension throws
// "Cannot find module '...'" the first time a user opens a Marp file or runs
// a PDF/PPTX export. This copies each root's full transitive dependency
// closure into dist/node_modules so Node's resolution finds it relative to
// extension.cjs inside the installed .vsix, exactly as it does in dev.
//
// Note: puppeteer resolves its Chrome binary from a user-level cache
// (~/.cache/puppeteer), not from node_modules, so vendoring the JS is not by
// itself enough — see ensureBrowser() in src/marp/browser.ts.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, cpSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..', '..', '..');
const destModules = join(scriptsDir, '..', 'dist', 'node_modules');

// npm hoists most packages to the workspace root, but anything with a
// conflicting version (or an install script, like puppeteer) stays nested in
// the extension's own node_modules. Search both, nearest first.
const searchRoots = [
  join(scriptsDir, '..', 'node_modules'),
  join(repoRoot, 'node_modules'),
];

const roots = ['@marp-team/marp-core', 'puppeteer'];

// render.ts hardcodes `math: 'katex'`, but marp-core's bundled lib/marp.js
// requires both math backends unconditionally at module load time (it's not
// gated behind the `math` option), so mathjax-full must still be vendored or
// the packaged extension throws "Cannot find module" the moment marp-core is
// required — even though katex is the only backend actually used at runtime.
// speech-rule-engine (mathjax's speech-output dependency, 8MB) is not
// required at load time and stays excluded as genuine dead weight.
const excluded = new Set(['speech-rule-engine']);

/**
 * Resolve `name` the way Node does: walk up from `fromDir` checking each
 * enclosing node_modules, then fall back to the shared search roots. A
 * package installed *inside* another package's node_modules (npm does this on
 * a version conflict) is only findable this way — flat lookup misses it, and
 * the miss is silent until the packaged extension requires it at runtime.
 */
function resolvePkgDir(name, fromDir) {
  const segments = name.split('/');
  const candidates = [];

  if (fromDir) {
    // Nested first: <dependent>/node_modules/<name>, then each ancestor's.
    let dir = fromDir;
    for (;;) {
      candidates.push(join(dir, 'node_modules', ...segments));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const root of searchRoots) candidates.push(join(root, ...segments));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

function readDeps(pkgDir) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return {};
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  return { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
}

/**
 * Collect the closure as a map of vendored-path -> source dir. The key is the
 * layout we write into dist/node_modules: a nested package keeps its nesting,
 * so two versions of the same package can coexist exactly as they do on disk.
 */
function collectClosure() {
  const out = new Map();
  const missing = new Set();

  function visit(name, fromDir, destRel) {
    if (out.has(destRel)) return;
    if (excluded.has(name)) return;
    const pkgDir = resolvePkgDir(name, fromDir);
    if (!pkgDir) {
      missing.add(name);
      return;
    }
    out.set(destRel, pkgDir);
    for (const dep of Object.keys(readDeps(pkgDir))) {
      // If the dep resolves inside this package, vendor it nested too.
      const nested = join(pkgDir, 'node_modules', ...dep.split('/'));
      const nestedDest = existsSync(join(nested, 'package.json'))
        ? `${destRel}/node_modules/${dep}`
        : dep;
      visit(dep, pkgDir, nestedDest);
    }
  }

  for (const root of roots) visit(root, null, root);

  for (const name of missing) {
    console.warn(`[vendor-deps] WARNING: ${name} not found, skipping (optional peer?)`);
  }
  return out;
}

const closure = collectClosure();
console.log(`[vendor-deps] Vendoring ${closure.size} package(s) rooted at ${roots.join(', ')}`);

rmSync(destModules, { recursive: true, force: true });
mkdirSync(destModules, { recursive: true });

for (const [destRel, src] of closure) {
  const dest = join(destModules, ...destRel.split('/'));
  mkdirSync(dirname(dest), { recursive: true });
  // A package we vendor nested is also copied wholesale as part of its
  // parent's directory; filter node_modules out of the bulk copy so the
  // explicit per-package entries stay authoritative and nothing is duplicated.
  cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (srcPath) => !srcPath.slice(src.length).includes('node_modules'),
  });
}

console.log(`[vendor-deps] Done — dist/node_modules ready for packaging`);
