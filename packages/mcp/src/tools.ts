// =============================================================================
// SelDiA MCP — tool implementations
// =============================================================================
// Plain async functions, independent of the MCP SDK's request/response
// plumbing, so tests can call them directly without spinning up a server or
// a client transport. server.ts wraps each of these as an MCP tool.

import { writeFileSync } from 'node:fs';
import { DiagnosticSeverity, type DiagramIR, type Diagnostic } from '@seldia/core';
import { loadDiagram, validateDiagram, isMermaidFile, getEngine } from './diagram-store.js';
import { summarize, queryNode, listNodes, listEdges } from './query.js';
import { applyNodePatch, SldWriteError, type NodePatch } from './sld-writer.js';

function diagnosticToPlain(d: Diagnostic) {
  return {
    severity: String(d.severity),
    message: d.message,
    line: d.source?.startLine,
    code: d.code,
  };
}

export function loadDiagramTool(path: string) {
  const loaded = loadDiagram(path);
  return {
    ok: loaded.ok,
    format: loaded.format,
    diagnostics: loaded.diagnostics.map(diagnosticToPlain),
    summary: summarize(loaded.ir),
  };
}

export function validateDiagramTool(path: string) {
  const diagnostics = validateDiagram(path);
  const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.ERROR).map(diagnosticToPlain);
  const warnings = diagnostics.filter((d) => d.severity !== DiagnosticSeverity.ERROR).map(diagnosticToPlain);
  return { ok: errors.length === 0, errors, warnings };
}

export function queryDiagramTool(path: string, nodeId: string) {
  const loaded = loadDiagram(path);
  const result = queryNode(loaded.ir, nodeId);
  if (!result) {
    return { ok: false, error: `Node "${nodeId}" not found in ${path}` };
  }
  return {
    ok: true,
    node: {
      id: result.node.id,
      label: result.node.label,
      shape: result.node.shape,
      style: result.node.style,
      data: result.node.data,
    },
    dependsOn: result.dependsOn.map(({ edge, node }) => ({
      edgeId: edge.id,
      targetId: edge.targetId,
      targetLabel: node?.label,
      edgeLabel: edge.label,
    })),
    dependedOnBy: result.dependedOnBy.map(({ edge, node }) => ({
      edgeId: edge.id,
      sourceId: edge.sourceId,
      sourceLabel: node?.label,
      edgeLabel: edge.label,
    })),
  };
}

export function listNodesTool(path: string) {
  const loaded = loadDiagram(path);
  return {
    ok: loaded.ok,
    nodes: listNodes(loaded.ir).map((n) => ({ id: n.id, label: n.label, shape: n.shape, data: n.data })),
  };
}

export function listEdgesTool(path: string) {
  const loaded = loadDiagram(path);
  return {
    ok: loaded.ok,
    edges: listEdges(loaded.ir).map((e) => ({ id: e.id, sourceId: e.sourceId, targetId: e.targetId, label: e.label })),
  };
}

export interface MutateNodeArgs {
  path: string;
  nodeId: string;
  patch: NodePatch;
}

export function mutateNodeTool({ path, nodeId, patch }: MutateNodeArgs) {
  if (isMermaidFile(path)) {
    return { ok: false, error: 'mutate_node only supports .sld files. Mermaid files are a read-only import source in this engine.' };
  }
  const loaded = loadDiagram(path);
  if (!loaded.ok) {
    return { ok: false, error: 'Refusing to mutate a diagram with existing parse/analysis errors. Run validate_diagram first.', diagnostics: loaded.diagnostics.map(diagnosticToPlain) };
  }
  const node = loaded.ir.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, error: `Node "${nodeId}" not found in ${path}` };

  let newSource: string;
  try {
    newSource = applyNodePatch(loaded.source, nodeId, patch);
  } catch (err) {
    if (err instanceof SldWriteError) return { ok: false, error: err.message };
    throw err;
  }

  // Verify the patched source still parses cleanly before committing it to
  // disk — a silent corruption would be worse than refusing the mutation.
  const postDiagnostics = getEngine().validate(newSource, path);
  const hasErrors = postDiagnostics.some((d) => d.severity === DiagnosticSeverity.ERROR);
  if (hasErrors) {
    return { ok: false, error: 'Patched source failed to re-parse; mutation aborted without writing.', diagnostics: postDiagnostics.map(diagnosticToPlain) };
  }

  writeFileSync(path, newSource, 'utf-8');
  return { ok: true, path, patchedFields: Object.keys(patch) };
}

export interface WriteDiagramArgs {
  path: string;
  ir: DiagramIR;
}

/** General-case "persist a full IR" entry point. Scope note: there is no IR
 *  -> DSL serializer in the codebase (see module doc in sld-writer.ts), so
 *  this only supports the case that's actually implementable today —
 *  writing the diagram out as JSON IR alongside/instead of DSL when the
 *  caller wants the structural result persisted, OR delegating to
 *  applyNodePatch-style per-node patches. For .sld specifically, full-IR
 *  writeback (arbitrary new nodes/edges, not just edits to existing ones)
 *  is out of scope until a real serializer exists; this returns a clear
 *  error rather than emitting DSL text likely to be wrong. */
export function writeDiagramTool({ path, ir }: WriteDiagramArgs) {
  if (isMermaidFile(path)) {
    return { ok: false, error: 'write_diagram only supports .sld files.' };
  }
  return {
    ok: false,
    error:
      'Full IR -> DSL serialization is not implemented (no general serializer exists in the codebase yet; ' +
      'see docs/next_steps.md tech debt on the attribute-block tokenizer). Use mutate_node for label/style edits ' +
      'to existing nodes, which is fully supported.',
    nodeCount: ir.nodes.length,
    edgeCount: ir.edges.length,
  };
}
