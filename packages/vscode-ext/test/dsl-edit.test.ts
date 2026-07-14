// =============================================================================
// SelDiA VS Code — DSL block editing tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  blockIdForSource,
  findSelDiABlocks,
  findBlockById,
  setNodePosition,
  setNodeLabel,
  setNodeAttributes,
  hasManualPositions,
  clearAllPositions,
} from '../src/edit/dsl-edit.js';
import { createEngine } from '@seldia/core';

const engine = createEngine();

describe('findSelDiABlocks', () => {
  it('locates a single fenced block and its source lines', () => {
    const md = ['# Title', '', '```seldia', 'diagram flowchart "T" {', '  a: (S)', '}', '```', 'after'].join('\n');
    const blocks = findSelDiABlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fenceLine).toBe(2);
    expect(blocks[0].sourceStartLine).toBe(3);
    expect(blocks[0].sourceEndLine).toBe(6);
    expect(blocks[0].source).toContain('diagram flowchart');
  });

  it('locates multiple blocks and language suffixes', () => {
    const md = ['```seldia', 'a', '```', 'x', '```seldia-flowchart', 'b', '```'].join('\n');
    const blocks = findSelDiABlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].lang).toBe('seldia-flowchart');
  });

  it('ignores non-seldia fences', () => {
    const md = ['```js', 'const a = 1;', '```'].join('\n');
    expect(findSelDiABlocks(md)).toHaveLength(0);
  });

  it('tolerates a missing closing fence', () => {
    const md = ['```seldia', 'diagram flowchart "T" { a: (S) }'].join('\n');
    const blocks = findSelDiABlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toContain('diagram flowchart');
  });

  it('block id matches blockIdForSource of its source', () => {
    const md = ['```seldia', 'diagram flowchart "T" { a: (S) }', '```'].join('\n');
    const b = findSelDiABlocks(md)[0];
    expect(b.blockId).toBe(blockIdForSource(b.source));
    expect(findBlockById(md, b.blockId)?.source).toBe(b.source);
  });
});

describe('setNodePosition', () => {
  it('adds a flat x/y style block to a node with no style', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start)\n  b: [Do]\n  a --> b\n}';
    const out = setNodePosition(src, 'a', 120, 80);
    expect(out).toContain('a: (Start) { x: 120, y: 80 }');
    // b untouched
    expect(out).toContain('b: [Do]');
  });

  it('updates existing x/y and preserves other attributes', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { fill: "#fff", x: 10, y: 10 }\n}';
    const out = setNodePosition(src, 'a', 200, 300);
    expect(out).toContain('fill: "#fff"');
    expect(out).toContain('x: 200');
    expect(out).toContain('y: 300');
  });

  it('does not confuse a diamond shape for a style block', () => {
    const src = 'diagram flowchart "T" {\n  d: {Valid?}\n}';
    const out = setNodePosition(src, 'd', 5, 6);
    expect(out).toContain('d: {Valid?} { x: 5, y: 6 }');
  });
});

describe('setNodeLabel', () => {
  it('renames a rounded-rectangle label preserving delimiters', () => {
    const out = setNodeLabel('diagram flowchart "T" {\n  a: (Start)\n}', 'a', 'Begin');
    expect(out).toContain('a: (Begin)');
  });

  it('renames a diamond label', () => {
    const out = setNodeLabel('diagram flowchart "T" {\n  d: {Valid?}\n}', 'd', 'OK?');
    expect(out).toContain('d: {OK?}');
  });

  it('preserves a trailing style block when renaming', () => {
    const out = setNodeLabel('diagram flowchart "T" {\n  a: [Do] { fill: "red" }\n}', 'a', 'Act');
    expect(out).toContain('a: [Act] { fill: "red" }');
  });
});

describe('setNodeAttributes', () => {
  it('adds and updates attributes', () => {
    let src = 'diagram flowchart "T" {\n  a: (S)\n}';
    src = setNodeAttributes(src, 'a', { fill: '"#111"' });
    expect(src).toContain('a: (S) { fill: "#111" }');
    src = setNodeAttributes(src, 'a', { fill: '"#222"', stroke: '"#000"' });
    expect(src).toContain('fill: "#222"');
    expect(src).toContain('stroke: "#000"');
  });

  it('returns source unchanged for an unknown node', () => {
    const src = 'diagram flowchart "T" {\n  a: (S)\n}';
    expect(setNodeAttributes(src, 'zzz', { fill: '"#111"' })).toBe(src);
  });
});

describe('hasManualPositions', () => {
  it('is false for a diagram with no position overrides', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start)\n  b: [Do]\n  a --> b\n}';
    expect(hasManualPositions(src)).toBe(false);
  });

  it('is true once any node carries a flat x/y override', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { x: 10, y: 20 }\n  b: [Do]\n}';
    expect(hasManualPositions(src)).toBe(true);
  });

  it('is false when a style block has other attributes but no x/y', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { fill: "#fff" }\n}';
    expect(hasManualPositions(src)).toBe(false);
  });

  it('requires both x and y to be present', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { x: 10 }\n}';
    expect(hasManualPositions(src)).toBe(false);
  });
});

describe('clearAllPositions', () => {
  it('strips x/y from every node while preserving other attributes', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { fill: "#fff", x: 10, y: 20 }\n  b: [Do] { x: 5, y: 6 }\n}';
    const out = clearAllPositions(src);
    expect(hasManualPositions(out)).toBe(false);
    expect(out).toContain('fill: "#fff"');
    expect(out).not.toMatch(/x:\s*\d/);
    expect(out).not.toMatch(/y:\s*\d/);
  });

  it('removes an empty style block entirely once x/y are stripped', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { x: 10, y: 20 }\n}';
    const out = clearAllPositions(src);
    const nodeLine = out.split('\n').find((l) => l.includes('a: (Start)'));
    expect(nodeLine).toBe('  a: (Start)');
  });

  it('is a no-op when there are no manual positions', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start)\n  b: [Do]\n  a --> b\n}';
    expect(clearAllPositions(src)).toBe(src);
  });

  it('cleared source still compiles and re-runs auto layout', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { x: 900, y: 900 }\n  b: [Do]\n  a --> b\n}';
    const cleared = clearAllPositions(src);
    const r = engine.compileSync(cleared);
    expect(r.ok).toBe(true);
    const laid = engine.layout(engine.transform(engine.analyze(engine.parse(cleared).value as any).value as any).value as any);
    const a = (laid as any).value.diagram.nodes.find((n: any) => n.id === 'a');
    // No longer pinned at the manual (900, 900) position — dagre placed it.
    expect(a.position).not.toEqual({ x: 900, y: 900 });
  });
});

describe('edits round-trip through the compiler', () => {
  it('a moved + renamed node still compiles', () => {
    let src = 'diagram flowchart "T" {\n  a: (Start)\n  b: [Do]\n  a --> b\n}';
    src = setNodePosition(src, 'a', 400, 250);
    src = setNodeLabel(src, 'a', 'Kickoff');
    const r = engine.compileSync(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const laid = engine.layout(engine.transform(engine.analyze(engine.parse(src).value as any).value as any).value as any);
      const a = (laid as any).value.diagram.nodes.find((n: any) => n.id === 'a');
      expect(a.position).toEqual({ x: 400, y: 250 });
      expect(a.label).toBe('Kickoff');
    }
  });
});
