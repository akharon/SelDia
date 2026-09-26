// =============================================================================
// SelDiA VS Code — pure source patchers for the Edit Visually panel
// =============================================================================
// Covers the patchers the interactive provider applies via WorkspaceEdit:
// label edits (node + edge), node/edge deletion (chain-aware), and statement
// appending — all computed against plain DSL source strings.

import { describe, it, expect } from 'vitest';
import {
  computeAttrEdit, computeLabelEdit, computeEdgeLabelEdit, computeEdgeDeleteEdit,
  computeEdgeReconnectEdit,
  computeNodeDeleteEdits, computeAppendStatementEdit,
  buildNodeStatement, buildEdgeStatement,
  applyTextEdit, applyTextEdits,
} from '../src/edit/position-patch.js';

const SRC = [
  'diagram flowchart "Pipeline" {',
  '    start: (Start)',
  '    build: [Build] { x: 300, y: 200 }',
  '    check: {Ship it?}',
  '    deploy: [[Deploy]]',
  '    start --> build',
  '    build --> |"ok"| check',
  '    check --> deploy: yes',
  '}',
].join('\n');

describe('computeAttrEdit (typed declarations & edge exclusion)', () => {
  const C4 = [
    'c4c "Internet Banking" {',
    '    person customer "Customer" "A bank customer"',
    '    system_Ext mainframe "Mainframe Banking" "Core banking system"',
    '    customer -> mainframe: "Uses"',
    '}',
  ].join('\n');

  it('patches the typed form (`system_Ext mainframe "…"`)', () => {
    const out = applyTextEdit(C4, computeAttrEdit(C4, 'mainframe', { x: 10, y: 20 })!);
    expect(out).toContain('system_Ext mainframe "Mainframe Banking" "Core banking system" { x: 10, y: 20 }');
  });

  it('never writes node attrs onto an edge line sharing the id prefix', () => {
    const out = applyTextEdit(C4, computeAttrEdit(C4, 'customer', { x: 1, y: 2 })!);
    // Declaration got the block; the edge line did not.
    expect(out).toContain('person customer "Customer" "A bank customer" { x: 1, y: 2 }');
    expect(out).toContain('customer -> mainframe: "Uses"');
    expect(out).not.toMatch(/-> mainframe[^\n]*x: 1/);
  });

  it('trims and quote-sanitizes string attribute values', () => {
    const out = applyTextEdit(C4, computeAttrEdit(C4, 'customer', { fill: '  #22aa66 ' })!);
    expect(out).toContain('{ fill: "#22aa66" }');
  });
});

describe('computeLabelEdit (node labels)', () => {
  it('rewrites a rounded-rect label in place', () => {
    const out = applyTextEdit(SRC, computeLabelEdit(SRC, 'start', 'Begin')!);
    expect(out).toContain('start: (Begin)');
    expect(out).not.toContain('(Start)');
  });

  it('rewrites a bracket label without touching the attribute block', () => {
    const out = applyTextEdit(SRC, computeLabelEdit(SRC, 'build', 'Compile')!);
    expect(out).toContain('build: [Compile] { x: 300, y: 200 }');
  });

  it('rewrites a diamond label but never mistakes an attr block for one', () => {
    const out = applyTextEdit(SRC, computeLabelEdit(SRC, 'check', 'Go?')!);
    expect(out).toContain('check: {Go?}');
    // build's attr block untouched (it looks brace-y but is key: value).
    expect(out).toContain('{ x: 300, y: 200 }');
  });

  it('rewrites a double-bracket label preserving both delimiters', () => {
    const out = applyTextEdit(SRC, computeLabelEdit(SRC, 'deploy', 'Ship')!);
    expect(out).toContain('deploy: [[Ship]]');
  });

  it('rewrites quoted labels, including the typed C4 form', () => {
    const src = 'diagram c4 "Sys" {\n    person customer: "Bank Customer"\n}';
    const out = applyTextEdit(src, computeLabelEdit(src, 'customer', 'Retail Customer')!);
    expect(out).toContain('person customer: "Retail Customer"');
  });

  it('never matches an edge line or a longer id sharing the prefix', () => {
    const src = 'diagram flowchart "X" {\n    rebuild: [Rebuild]\n    build: [Build]\n    build --> rebuild\n}';
    const out = applyTextEdit(src, computeLabelEdit(src, 'build', 'Compile')!);
    expect(out).toContain('rebuild: [Rebuild]'); // untouched
    expect(out).toContain('build: [Compile]');
    expect(out).toContain('build --> rebuild'); // edge line untouched
  });
});

describe('computeEdgeLabelEdit', () => {
  it('replaces an existing |"label"|', () => {
    const out = applyTextEdit(SRC, computeEdgeLabelEdit(SRC, 'build', 'check', 'passed')!);
    expect(out).toContain('build --> |"passed"| check');
    expect(out).not.toContain('"ok"');
  });

  it('replaces a `: tail` label on a single-edge line', () => {
    const out = applyTextEdit(SRC, computeEdgeLabelEdit(SRC, 'check', 'deploy', 'approved')!);
    expect(out).toContain('check --> deploy: "approved"');
    expect(out).not.toMatch(/deploy:\s*yes/);
  });

  it('inserts a |"label"| when the edge has none', () => {
    const out = applyTextEdit(SRC, computeEdgeLabelEdit(SRC, 'start', 'build', 'go')!);
    expect(out).toContain('start --> |"go"| build');
  });

  it('returns undefined for an unknown edge', () => {
    expect(computeEdgeLabelEdit(SRC, 'deploy', 'start', 'x')).toBeUndefined();
  });
});

describe('computeEdgeDeleteEdit', () => {
  it('removes a single-edge line entirely', () => {
    const out = applyTextEdit(SRC, computeEdgeDeleteEdit(SRC, 'start', 'build')!);
    expect(out).not.toContain('start --> build');
    expect(out).toContain('build --> |"ok"| check'); // neighbours untouched
    expect(out.split('\n').filter((l) => !l.trim()).length).toBe(0); // no blank line left behind
  });

  it('splices one link out of a chain, keeping the rest', () => {
    const src = 'diagram flowchart "X" {\n    a: [A]\n    b: [B]\n    c: [C]\n    a --> b --> c\n}';
    const out = applyTextEdit(src, computeEdgeDeleteEdit(src, 'a', 'b')!);
    expect(out).not.toMatch(/a\s*-->\s*b/);
    expect(out).toContain('b --> c');
  });

  it('matches undirected edges in either orientation', () => {
    const src = 'diagram flowchart "X" {\n    a: [A]\n    b: [B]\n    a -- b\n}';
    const out = applyTextEdit(src, computeEdgeDeleteEdit(src, 'b', 'a')!);
    expect(out).not.toContain('a -- b');
  });
});

describe('computeEdgeReconnectEdit (next_steps.md Step 4.1)', () => {
  it('rewrites the target of a single-edge line', () => {
    const out = applyTextEdit(SRC, computeEdgeReconnectEdit(SRC, 'start', 'build', 'target', 'check')!);
    expect(out).toContain('start --> check');
    expect(out).not.toContain('start --> build');
    expect(out).toContain('build --> |"ok"| check'); // neighbours untouched
  });

  it('rewrites the source of a single-edge line', () => {
    const out = applyTextEdit(SRC, computeEdgeReconnectEdit(SRC, 'start', 'build', 'source', 'check')!);
    expect(out).toContain('check --> build');
    expect(out).not.toContain('start --> build');
  });

  it('preserves the arrow and label when reconnecting', () => {
    const out = applyTextEdit(SRC, computeEdgeReconnectEdit(SRC, 'build', 'check', 'target', 'deploy')!);
    expect(out).toContain('build --> |"ok"| deploy');
  });

  it('reconnects the first link of a chain by rewriting the shared head', () => {
    const src = 'diagram flowchart "X" {\n    a: [A]\n    b: [B]\n    c: [C]\n    d: [D]\n    a --> b --> c\n}';
    const out = applyTextEdit(src, computeEdgeReconnectEdit(src, 'a', 'b', 'source', 'd')!);
    expect(out).toContain('d --> b --> c');
  });

  it('reconnects the last link of a chain by rewriting its own target', () => {
    const src = 'diagram flowchart "X" {\n    a: [A]\n    b: [B]\n    c: [C]\n    d: [D]\n    a --> b --> c\n}';
    const out = applyTextEdit(src, computeEdgeReconnectEdit(src, 'b', 'c', 'target', 'd')!);
    expect(out).toContain('a --> b --> d');
  });

  it('refuses to reconnect an interior link\'s shared endpoint (would desync the chain) rather than guessing', () => {
    const src = 'diagram flowchart "X" {\n    a: [A]\n    b: [B]\n    c: [C]\n    d: [D]\n    a --> b --> c\n}';
    // Rewriting seg 0's target ('b') would also have to rewrite seg 1's
    // implicit source, which parseEdgeLine doesn't model as one edit site.
    expect(computeEdgeReconnectEdit(src, 'a', 'b', 'target', 'd')).toBeUndefined();
    // Rewriting seg 1's source ('b') has the same problem in the other direction.
    expect(computeEdgeReconnectEdit(src, 'b', 'c', 'source', 'd')).toBeUndefined();
  });

  it('refuses a reconnect that would create a self-loop', () => {
    expect(computeEdgeReconnectEdit(SRC, 'start', 'build', 'target', 'start')).toBeUndefined();
  });

  it('returns undefined for a non-existent edge', () => {
    expect(computeEdgeReconnectEdit(SRC, 'start', 'deploy', 'target', 'check')).toBeUndefined();
  });
});

describe('computeNodeDeleteEdits', () => {
  it('removes the declaration and every touching edge in one edit set', () => {
    const edits = computeNodeDeleteEdits(SRC, 'build');
    const out = applyTextEdits(SRC, edits);
    expect(out).not.toContain('build:');
    expect(out).not.toMatch(/start\s*-->\s*build/);
    expect(out).not.toMatch(/build\s*-->/);
    // The rest of the diagram survives.
    expect(out).toContain('start: (Start)');
    expect(out).toContain('check --> deploy: yes');
  });

  it('splices a chain around the deleted node', () => {
    const src = 'diagram flowchart "X" {\n    a: [A]\n    b: [B]\n    c: [C]\n    d: [D]\n    a --> b --> c --> d\n}';
    const out = applyTextEdits(src, computeNodeDeleteEdits(src, 'b'));
    expect(out).not.toContain('b:');
    expect(out).not.toMatch(/a\s*-->\s*b/);
    expect(out).not.toMatch(/b\s*-->\s*c/);
    expect(out).toContain('c --> d'); // the unaffected link survives
  });
});

describe('computeAppendStatementEdit', () => {
  it('inserts after the last body line, indented to match it, not inside a trailing attr block', () => {
    const edit = computeAppendStatementEdit(SRC, 'node6: [New Node 6]')!;
    const out = applyTextEdit(SRC, edit);
    const lines = out.split('\n');
    expect(lines[lines.length - 1]).toBe('}');
    expect(lines[lines.length - 2]).toBe('    node6: [New Node 6]');
    // build's attribute-block brace didn't attract the insert.
    expect(out).toContain('build: [Build] { x: 300, y: 200 }');
  });

  it('supports multi-line statements (add connected node)', () => {
    const edit = computeAppendStatementEdit(SRC, 'n: [N]\nstart --> n')!;
    const out = applyTextEdit(SRC, edit);
    expect(out).toContain('    n: [N]\n    start --> n\n}');
  });

  it('matches the body indentation when it is not 4 spaces', () => {
    const src = 'diagram flowchart "X" {\n  a: [A]\n  b: [B]\n}';
    const out = applyTextEdit(src, computeAppendStatementEdit(src, 'c: [C]')!);
    expect(out).toBe('diagram flowchart "X" {\n  a: [A]\n  b: [B]\n  c: [C]\n}');
  });

  it('inserts before the closing brace when the body is empty', () => {
    const src = 'diagram flowchart "X" {\n}';
    const out = applyTextEdit(src, computeAppendStatementEdit(src, 'a: [A]')!);
    expect(out).toBe('diagram flowchart "X" {\n    a: [A]\n}');
  });
});

describe('buildNodeStatement / buildEdgeStatement (edit-vocabulary → statement text)', () => {
  it('falls back to a plain flowchart node when no vocabulary entry is given', () => {
    expect(buildNodeStatement(undefined, 'node1', 'New Node 1')).toBe('node1: [New Node 1]');
  });

  it('substitutes {id} and {label} in a vocabulary template', () => {
    const entry = { template: 'participant {id}: "{label}"', positionable: false };
    expect(buildNodeStatement(entry, 'alice', 'Alice')).toBe('participant alice: "Alice"');
  });

  it('appends an { x, y } block only for a positionable entry with a position', () => {
    const entry = { template: '{id}: [{label}]', positionable: true };
    expect(buildNodeStatement(entry, 'node1', 'New Node 1', { x: 12.4, y: 8.6 })).toBe(
      'node1: [New Node 1] { x: 12, y: 9 }'
    );
    expect(buildNodeStatement(entry, 'node1', 'New Node 1')).toBe('node1: [New Node 1]');
  });

  it('does not append a position block for a non-positionable entry even if one is given', () => {
    const entry = { template: 'participant {id}: "{label}"', positionable: false };
    expect(buildNodeStatement(entry, 'alice', 'Alice', { x: 10, y: 10 })).toBe('participant alice: "Alice"');
  });

  it('falls back to --> when no edge template is given', () => {
    expect(buildEdgeStatement(undefined, 'a', 'b')).toBe('a --> b');
  });

  it('substitutes {source} and {target} in an edge template', () => {
    expect(buildEdgeStatement('{source} -->|"1 : *"| {target}', 'user', 'order')).toBe('user -->|"1 : *"| order');
  });
});
