// =============================================================================
// SelDiA MCP — IR query helpers
// =============================================================================
// Pure functions over DiagramIR: no I/O. Kept separate from diagram-store.ts
// so they're trivially unit-testable against hand-built IR fixtures too.

import type { DiagramIR, IRNode, IREdge } from '@seldia/core';

export interface DiagramSummary {
  id: string;
  type: string;
  title?: string;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  nodeTypes: Record<string, number>;
}

export function summarize(ir: DiagramIR): DiagramSummary {
  const nodeTypes: Record<string, number> = {};
  for (const n of ir.nodes) {
    const kind = String((n.data as any)?.kind || n.shape || 'unknown');
    nodeTypes[kind] = (nodeTypes[kind] || 0) + 1;
  }
  return {
    id: ir.id,
    type: String(ir.type),
    title: ir.title,
    nodeCount: ir.nodes.length,
    edgeCount: ir.edges.length,
    groupCount: ir.groups.length,
    nodeTypes,
  };
}

export interface NodeQueryResult {
  node: IRNode;
  dependsOn: Array<{ edge: IREdge; node: IRNode | undefined }>;
  dependedOnBy: Array<{ edge: IREdge; node: IRNode | undefined }>;
}

/** "Depends on" = outgoing edges (this node is the source, i.e. it points at
 *  something it needs). "Depended on by" = incoming edges (other nodes point
 *  at this one). This is the directional convention the diagram's arrows
 *  already encode — flowchart/dependency-graph edges read source -> target
 *  as "source depends on / flows into target". */
export function queryNode(ir: DiagramIR, nodeId: string): NodeQueryResult | undefined {
  const node = ir.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));

  const dependsOn = ir.edges
    .filter((e) => e.sourceId === nodeId)
    .map((e) => ({ edge: e, node: byId.get(e.targetId) }));

  const dependedOnBy = ir.edges
    .filter((e) => e.targetId === nodeId)
    .map((e) => ({ edge: e, node: byId.get(e.sourceId) }));

  return { node, dependsOn, dependedOnBy };
}

export function listNodes(ir: DiagramIR): IRNode[] {
  return ir.nodes;
}

export function listEdges(ir: DiagramIR): IREdge[] {
  return ir.edges;
}
