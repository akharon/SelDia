// =============================================================================
// SelDiA — Macro/Include System Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandIncludes } from '../src/macro/include.js';
import { createEngine } from '../src/engine.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'seldia-include-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('expandIncludes', () => {
  it('leaves source with no include directives unchanged', () => {
    const src = 'diagram flowchart "F" {\n  a --> b\n}';
    const result = expandIncludes(src);
    expect(result.source).toBe(src);
    expect(result.includedFiles).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('inlines a single include directive', () => {
    withTempDir((dir) => {
      const fragmentPath = join(dir, 'nodes.sld');
      writeFileSync(fragmentPath, '    shared: [Shared Node]');
      const mainPath = join(dir, 'main.sld');
      const main = 'diagram flowchart "F" {\n    include "nodes.sld"\n    a --> shared\n}';
      writeFileSync(mainPath, main);

      const result = expandIncludes(main, mainPath);
      expect(result.diagnostics).toHaveLength(0);
      expect(result.source).toContain('shared: [Shared Node]');
      expect(result.source).not.toContain('include "nodes.sld"');
      expect(result.includedFiles).toHaveLength(1);
    });
  });

  it('expands nested includes recursively', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'inner.sld'), '    c: [Inner]');
      writeFileSync(join(dir, 'outer.sld'), '    b: [Outer]\n    include "inner.sld"');
      const mainPath = join(dir, 'main.sld');
      const main = 'diagram flowchart "F" {\n    include "outer.sld"\n}';
      writeFileSync(mainPath, main);

      const result = expandIncludes(main, mainPath);
      expect(result.source).toContain('b: [Outer]');
      expect(result.source).toContain('c: [Inner]');
      expect(result.includedFiles).toHaveLength(2);
    });
  });

  it('reports a diagnostic for a missing include and drops the directive', () => {
    withTempDir((dir) => {
      const mainPath = join(dir, 'main.sld');
      const main = 'diagram flowchart "F" {\n    include "missing.sld"\n    a --> b\n}';
      const result = expandIncludes(main, mainPath);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).toMatch(/not found/i);
      expect(result.source).not.toContain('include "missing.sld"');
      expect(result.source).toContain('a --> b');
    });
  });

  it('detects a circular include and reports it without infinite-looping', () => {
    withTempDir((dir) => {
      const aPath = join(dir, 'a.sld');
      const bPath = join(dir, 'b.sld');
      writeFileSync(aPath, '    include "b.sld"');
      writeFileSync(bPath, '    include "a.sld"');

      const result = expandIncludes('include "a.sld"', join(dir, 'main.sld'));
      expect(result.diagnostics.some((d) => /circular/i.test(d))).toBe(true);
    });
  });

  it('preserves indentation of the include directive on every fragment line', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'frag.sld'), 'line1\nline2');
      const result = expandIncludes('    include "frag.sld"', join(dir, 'main.sld'));
      expect(result.source).toBe('    line1\n    line2');
    });
  });
});

describe('engine.parse() include integration', () => {
  it('resolves includes relative to the compiling file and parses the expanded source', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'shared.sld'), '    shared: [Shared Node]\n    a --> shared');
      const mainPath = join(dir, 'main.sld');
      const main = 'diagram flowchart "F" {\n    a: [A]\n    include "shared.sld"\n}';
      writeFileSync(mainPath, main);

      const engine = createEngine();
      const result = engine.parse(main, mainPath);
      expect(result.ok).toBe(true);
    });
  });

  it('surfaces a missing include as a parse error rather than crashing', () => {
    const engine = createEngine();
    const result = engine.parse('diagram flowchart "F" {\n  include "does-not-exist.sld"\n}', join(process.cwd(), 'nope.sld'));
    expect(result.ok).toBe(false);
  });
});
