// =============================================================================
// SelDiA VS Code — Node position patch tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { computePositionEdit, applyTextEdit } from '../src/edit/position-patch.js';
import { createEngine } from '@seldia/core';

function apply(source: string, nodeId: string, x: number, y: number): string {
  const edit = computePositionEdit(source, nodeId, x, y);
  expect(edit).toBeDefined();
  return applyTextEdit(source, edit!);
}

describe('computePositionEdit', () => {
  it('appends a fresh { x, y } block to a node with no attribute block', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start)\n  b: [Do]\n  a --> b\n}';
    const out = apply(src, 'a', 300, 200);
    expect(out).toContain('a: (Start) { x: 300, y: 200 }');
    // Other lines untouched
    expect(out).toContain('b: [Do]');
    expect(out).toContain('a --> b');
  });

  it('merges x/y into an existing attribute block without clobbering other keys', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { color: "red", shadow }\n}';
    const out = apply(src, 'a', 42, 99);
    expect(out).toContain('color: "red"');
    expect(out).toContain('shadow');
    expect(out).toContain('x: 42');
    expect(out).toContain('y: 99');
  });

  it('overwrites a prior x/y with the new dragged position (round-trip)', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { x: 10, y: 20 }\n}';
    const out = apply(src, 'a', 500, 600);
    expect(out).toContain('x: 500');
    expect(out).toContain('y: 600');
    expect(out).not.toContain('x: 10');
    expect(out).not.toContain('y: 20');
  });

  it('rewrites a legacy nested layout: { x, y } block in place', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start) { layout: { x: 10, y: 20 } }\n}';
    const out = apply(src, 'a', 111, 222);
    expect(out).toContain('layout: { x: 111, y: 222 }');
  });

  it('does not affect a node whose id is a prefix of the target id', () => {
    const src = 'diagram flowchart "T" {\n  ab: (Other)\n  a: (Start)\n}';
    const out = apply(src, 'a', 5, 6);
    expect(out).toContain('ab: (Other)');
    expect(out).toContain('a: (Start) { x: 5, y: 6 }');
  });

  it('returns undefined for an unknown node id', () => {
    const src = 'diagram flowchart "T" {\n  a: (Start)\n}';
    expect(computePositionEdit(src, 'zzz', 1, 2)).toBeUndefined();
  });

  it('leaves other node declarations completely unchanged (multi-node doc)', () => {
    const src = [
      'diagram flowchart "T" {',
      '  a: (Start) { color: "blue" }',
      '  b: [Middle]',
      '  c: (End) { x: 1, y: 1, locked: true }',
      '  a --> b --> c',
      '}',
    ].join('\n');
    const out = apply(src, 'b', 77, 88);
    expect(out).toContain('a: (Start) { color: "blue" }');
    expect(out).toContain('c: (End) { x: 1, y: 1, locked: true }');
    expect(out).toContain('b: [Middle] { x: 77, y: 88 }');
    expect(out).toContain('a --> b --> c');
  });

  it('round trip: parse -> mutate position -> re-serialize -> re-parse -> position matches via the real engine', () => {
    // Bare-label node syntax (`id "Label"`, no colon/brackets) — chosen
    // because it's the form this repo's own parser currently accepts; the
    // colon+bracket-shape form (`id: (Label)`) that appears in some example
    // fixtures currently fails to parse even unmodified, a pre-existing
    // parser issue unrelated to this change (see plugin.test.ts's 8 known
    // pre-existing failures).
    const src = 'diagram flowchart "T" {\n  a "Start"\n  b "Do"\n  a --> b\n}';
    const patched = apply(src, 'a', 321, 654);

    const engine = createEngine();
    const ast = engine.parse(patched);
    expect(ast.ok).toBe(true);
    if (!ast.ok) return;
    const analyzed = engine.analyze(ast.value);
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) return;
    const ir = engine.transform(analyzed.value);
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const layout = engine.layout(ir.value);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;

    const nodeA = layout.value.diagram.nodes.find((n) => n.id === 'a');
    expect(nodeA).toBeDefined();
    expect(nodeA!.position.x).toBe(321);
    expect(nodeA!.position.y).toBe(654);
  });
});

describe('applyTextEdit', () => {
  it('splices replacement text at the given offsets', () => {
    const out = applyTextEdit('hello world', { start: 6, end: 11, text: 'there' });
    expect(out).toBe('hello there');
  });
});
