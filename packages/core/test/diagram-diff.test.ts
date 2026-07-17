// =============================================================================
// SelDiA — Diagram Diff Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine.js';
import { diffDiagrams } from '../src/diff/diff.js';

function toIr(source: string) {
  const engine = createEngine();
  const r1 = engine.parse(source);
  if (!r1.ok) throw new Error('parse failed: ' + JSON.stringify(r1.errors));
  const r2 = engine.analyze(r1.value);
  if (!r2.ok) throw new Error('analyze failed');
  const r3 = engine.transform(r2.value);
  if (!r3.ok) throw new Error('transform failed');
  return r3.value;
}

describe('diffDiagrams', () => {
  it('reports identical for the same diagram compiled twice', () => {
    const src = `diagram flowchart "F" {\n  a: [A]\n  b: [B]\n  a --> b\n}`;
    const diff = diffDiagrams(toIr(src), toIr(src));
    expect(diff.identical).toBe(true);
    expect(diff.nodes).toHaveLength(0);
    expect(diff.edges).toHaveLength(0);
  });

  it('detects an added node', () => {
    const before = toIr(`diagram flowchart "F" {\n  a: [A]\n}`);
    const after = toIr(`diagram flowchart "F" {\n  a: [A]\n  b: [B]\n}`);
    const diff = diffDiagrams(before, after);
    expect(diff.identical).toBe(false);
    expect(diff.summary.nodesAdded).toBe(1);
    const added = diff.nodes.find((n) => n.kind === 'added');
    expect(added?.id).toBe('b');
    expect(added?.after?.label).toBe('B');
  });

  it('detects a removed node', () => {
    const before = toIr(`diagram flowchart "F" {\n  a: [A]\n  b: [B]\n}`);
    const after = toIr(`diagram flowchart "F" {\n  a: [A]\n}`);
    const diff = diffDiagrams(before, after);
    expect(diff.summary.nodesRemoved).toBe(1);
    expect(diff.nodes.find((n) => n.kind === 'removed')?.id).toBe('b');
  });

  it('detects a changed node label', () => {
    const before = toIr(`diagram flowchart "F" {\n  a: [Old Label]\n}`);
    const after = toIr(`diagram flowchart "F" {\n  a: [New Label]\n}`);
    const diff = diffDiagrams(before, after);
    expect(diff.summary.nodesChanged).toBe(1);
    const changed = diff.nodes.find((n) => n.kind === 'changed');
    expect(changed?.changes?.[0]).toMatch(/Old Label.*New Label/);
  });

  it('detects added and removed edges', () => {
    const before = toIr(`diagram flowchart "F" {\n  a: [A]\n  b: [B]\n  c: [C]\n  a --> b\n}`);
    const after = toIr(`diagram flowchart "F" {\n  a: [A]\n  b: [B]\n  c: [C]\n  a --> c\n}`);
    const diff = diffDiagrams(before, after);
    expect(diff.summary.edgesAdded).toBe(1);
    expect(diff.summary.edgesRemoved).toBe(1);
  });

  it('detects a diagram type change', () => {
    const before = toIr(`diagram flowchart "F" {\n  a --> b\n}`);
    const after = toIr(`diagram state "S" {\n  [*] --> Idle\n}`);
    const diff = diffDiagrams(before, after);
    expect(diff.typeChanged).toBe(true);
    expect(diff.beforeType).toBe('flowchart');
    expect(diff.afterType).toBe('state');
  });

  it('detects a title change independent of structural changes', () => {
    const before = toIr(`diagram flowchart "Old Title" {\n  a --> b\n}`);
    const after = toIr(`diagram flowchart "New Title" {\n  a --> b\n}`);
    const diff = diffDiagrams(before, after);
    expect(diff.titleChanged).toBe(true);
    expect(diff.identical).toBe(true); // structure itself is unchanged
  });

  it('does not flag layout-only differences (position) as changes', () => {
    const src = `diagram flowchart "F" {\n  a: [A]\n  b: [B]\n  a --> b\n}`;
    const engine = createEngine();
    const before = toIr(src);
    const layouted = engine.layout(before);
    expect(layouted.ok).toBe(true);
    if (!layouted.ok) throw new Error();
    const diff = diffDiagrams(before, layouted.value.diagram);
    expect(diff.identical).toBe(true);
  });
});
