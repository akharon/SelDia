// =============================================================================
// @seldia/mcp — tool handler tests
// =============================================================================
// Calls the tool functions directly (not through an MCP client/transport
// roundtrip) against a real fixture .sld file, following the pattern in
// packages/cli/test/*.test.ts of exercising real logic without mocking the
// engine. Each mutation test copies the fixture into a scratch temp dir so
// tests never write into the checked-in fixture.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDiagramTool,
  validateDiagramTool,
  queryDiagramTool,
  listNodesTool,
  listEdgesTool,
  mutateNodeTool,
  writeDiagramTool,
} from '../src/tools.js';
import { loadDiagram } from '../src/diagram-store.js';

const FIXTURE = join(__dirname, 'fixtures', 'flowchart.sld');

let dir: string;
let workPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seldia-mcp-test-'));
  workPath = join(dir, 'flowchart.sld');
  copyFileSync(FIXTURE, workPath);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('load_diagram', () => {
  it('parses the fixture and returns a summary', () => {
    const result = loadDiagramTool(workPath);
    expect(result.ok).toBe(true);
    expect(result.format).toBe('sld');
    expect(result.diagnostics).toEqual([]);
    expect(result.summary.type).toBe('flowchart');
    expect(result.summary.nodeCount).toBe(4);
    expect(result.summary.edgeCount).toBe(3);
  });

  it('reports diagnostics for a broken file without throwing', () => {
    const badPath = join(dir, 'bad.sld');
    writeFileSync(badPath, 'diagram flowchart "Bad" {\n  a\n}\n');
    const result = loadDiagramTool(badPath);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('validate_diagram', () => {
  it('reports no errors for a valid file', () => {
    const result = validateDiagramTool(workPath);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports errors for an invalid file', () => {
    const badPath = join(dir, 'bad.sld');
    writeFileSync(badPath, 'diagram flowchart "Bad" {\n  a\n}\n');
    const result = validateDiagramTool(badPath);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('query_diagram', () => {
  it('returns dependents and dependencies for a node', () => {
    const result = queryDiagramTool(workPath, 'authService');
    expect(result.ok).toBe(true);
    expect(result.node!.label).toBe('Auth Service');
    expect(result.dependsOn!.map((d) => d.targetId).sort()).toEqual(['tokenCache', 'userDb']);
    expect(result.dependedOnBy!.map((d) => d.sourceId)).toEqual(['apiGateway']);
  });

  it('returns ok:false for an unknown node', () => {
    const result = queryDiagramTool(workPath, 'doesNotExist');
    expect(result.ok).toBe(false);
  });
});

describe('list_nodes / list_edges', () => {
  it('lists all nodes', () => {
    const result = listNodesTool(workPath);
    expect(result.ok).toBe(true);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['apiGateway', 'authService', 'tokenCache', 'userDb']);
  });

  it('lists all edges', () => {
    const result = listEdgesTool(workPath);
    expect(result.ok).toBe(true);
    expect(result.edges).toHaveLength(3);
    expect(result.edges[0]).toMatchObject({ sourceId: 'apiGateway', targetId: 'authService' });
  });
});

describe('mutate_node', () => {
  it('patches a node label and writes it back to disk', () => {
    const result = mutateNodeTool({ path: workPath, nodeId: 'authService', patch: { label: 'Auth Service v2' } });
    expect(result.ok).toBe(true);

    const reloaded = loadDiagramTool(workPath);
    expect(reloaded.ok).toBe(true);
    const nodes = listNodesTool(workPath).nodes;
    expect(nodes.find((n) => n.id === 'authService')?.label).toBe('Auth Service v2');
  });

  it('patches flat style attributes', () => {
    const result = mutateNodeTool({ path: workPath, nodeId: 'authService', patch: { style: { fill: '#ff0000' } } });
    expect(result.ok).toBe(true);

    const source = readFileSync(workPath, 'utf-8');
    expect(source).toMatch(/authService.*\{\s*fill:\s*"#ff0000"\s*\}/);

    const summary = loadDiagramTool(workPath);
    expect(summary.ok).toBe(true);
  });

  it('rejects mutation of an unknown node', () => {
    const result = mutateNodeTool({ path: workPath, nodeId: 'nope', patch: { label: 'x' } });
    expect(result.ok).toBe(false);
  });

  it('does not modify the file when the node cannot be located', () => {
    const before = readFileSync(workPath, 'utf-8');
    mutateNodeTool({ path: workPath, nodeId: 'nope', patch: { label: 'x' } });
    const after = readFileSync(workPath, 'utf-8');
    expect(after).toBe(before);
  });
});

describe('write_diagram', () => {
  it('serializes a structurally-mutated IR back to .sld and re-parses to the same structure', () => {
    const ir = loadDiagram(workPath).ir!;
    const beforeNodes = ir.nodes.length;
    // Add a new node + edge — the kind of structural change mutate_node can't do.
    const newNode = { ...ir.nodes[0], id: 'audit', label: 'Audit Log' };
    const mutated = {
      ...ir,
      nodes: [...ir.nodes, newNode],
      edges: [...ir.edges, { ...ir.edges[0], id: 'e-audit', sourceId: ir.nodes[0].id, targetId: 'audit' }],
    };
    const result = writeDiagramTool({ path: workPath, ir: mutated as any });
    expect(result.ok).toBe(true);

    // Re-load from disk: the new node/edge survived the round trip.
    const reloaded = loadDiagram(workPath).ir!;
    expect(reloaded.nodes.length).toBe(beforeNodes + 1);
    expect(reloaded.nodes.some((n) => n.id === 'audit')).toBe(true);
    expect(reloaded.edges.some((e) => e.targetId === 'audit')).toBe(true);
  });

  it('preserves node shapes across the round trip', () => {
    const ir = loadDiagram(workPath).ir!;
    writeDiagramTool({ path: workPath, ir: ir as any });
    const reloaded = loadDiagram(workPath).ir!;
    const shapesBefore = new Map(ir.nodes.map((n) => [n.id, n.shape]));
    for (const n of reloaded.nodes) {
      expect(n.shape).toBe(shapesBefore.get(n.id));
    }
  });

  it('never leaves an unparseable file on disk', () => {
    const ir = loadDiagram(workPath).ir!;
    writeDiagramTool({ path: workPath, ir: ir as any });
    // A clean re-load with no error diagnostics proves the written file parses.
    expect(validateDiagramTool(workPath).ok).toBe(true);
  });

  it('declines a non-round-trippable diagram type instead of corrupting the file', () => {
    const ir = loadDiagram(workPath).ir!;
    const before = readFileSync(workPath, 'utf-8');
    const result = writeDiagramTool({ path: workPath, ir: { ...ir, type: 'gantt' } as any });
    expect(result.ok).toBe(false);
    expect(readFileSync(workPath, 'utf-8')).toBe(before);
  });

  it('keeps Mermaid files read-only', () => {
    const mmdPath = join(dir, 'x.mmd');
    writeFileSync(mmdPath, 'flowchart TD\n  a --> b');
    const result = writeDiagramTool({ path: mmdPath, ir: { nodes: [], edges: [], type: 'flowchart' } as any });
    expect(result.ok).toBe(false);
  });
});
