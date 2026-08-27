// =============================================================================
// SelDiA — DSL code generator round-trip tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { SelDiACodeGenerator } from '../src/code-generator.js';

describe('SelDiACodeGenerator', () => {
  const gen = new SelDiACodeGenerator();

  it('generates a node declaration with shape and label', () => {
    const out = gen.generateNode({ id: 'a', shape: 'rect', label: 'Start', indent: 0 } as any);
    expect(out).toBe('a: [] "Start"');
  });

  it('generates an edge declaration with a label', () => {
    const out = gen.generateEdge({ sourceId: 'a', targetId: 'b', label: 'go', indent: 0 } as any);
    expect(out).toBe('a --> |go| b');
  });

  it('generates a group declaration wrapping its child content', () => {
    const out = gen.generateGroup({ id: 'g', label: 'Group', indent: 0, childContent: '    a: []' } as any);
    expect(out).toBe('group g "Group" {\n    a: []\n}');
  });

  it('generates a full diagram with nodes and edges', () => {
    const ir = {
      type: 'flowchart',
      title: 'T',
      nodes: [{ id: 'a', shape: 'rect', label: 'A' }, { id: 'b', shape: 'rect', label: 'B' }],
      edges: [{ sourceId: 'a', targetId: 'b', label: '' }],
    } as any;
    const out = gen.generateDiagram(ir);
    expect(out).toContain('diagram flowchart "T" {');
    expect(out).toContain('a: [] "A"');
    expect(out).toContain('b: [] "B"');
    expect(out).toContain('a --> b');
  });
});
