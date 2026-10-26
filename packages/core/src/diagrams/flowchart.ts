// =============================================================================
// SelDiA — Flowchart Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl, ASTGroupDecl, ASTStatement } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge, IRGroup } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import type { ShapeType } from '../types/shapes.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { sizeForLabel } from '../layout/text-measure.js';
import { sizeForShape } from '../render/node-label-geometry.js';
const ROUTING_MAP: Record<string, EdgeRouting> = {
  straight: EdgeRouting.STRAIGHT, spline: EdgeRouting.SPLINE,
  orthogonal: EdgeRouting.ORTHOGONAL, curved: EdgeRouting.CURVED,
};

export const flowchartPlugin: DiagramPlugin = {
  id: 'seldia-flowchart',
  name: 'Flowchart',
  version: '1.0.0',
  diagramType: DiagramType.FLOWCHART,
  description: 'Flowcharts for processes, workflows, and algorithms',

  transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];
    const groups: IRGroup[] = [];

    const pushNode = (nd: ASTNodeDecl) => {
      nodes.push({
        id: nd.id,
        label: nd.label,
        description: nd.description || undefined,
        shape: nd.shape as ShapeType,
        position: { x: 0, y: 0 },
        size: sizeForShape(nd.label, String(nd.shape), (nd.style?.fontSize as number) || 14, 100, 50),
        style: nd.style ? { ...nd.style } : {},
        ports: [],
        classList: nd.classList || [],
        collapsed: false,
        data: nd.data || {},
      });
    };

    const pushEdge = (ed: ASTEdgeDecl) => {
      edges.push({
        id: `edge-${ed.sourceId}-${ed.targetId}`,
        sourceId: ed.sourceId,
        targetId: ed.targetId,
        label: ed.label || undefined,
        style: ed.style ? { ...ed.style } : {},
        routing: (ed.routing && ROUTING_MAP[ed.routing]) || EdgeRouting.ORTHOGONAL,
        bidirectional: ed.direction === 'both',
        classList: ed.classList || [],
        data: ed.data || {},
      });
    };

    // Walk a statement list, descending into `group { … }` bodies so the nodes
    // and edges declared inside a group reach the IR (they were silently
    // dropped before). Each group also contributes an IRGroup recording which
    // nodes it contains, and nested groups nest via childGroupIds — the same
    // shape the Mermaid subgraph importer produces, so group layout/render
    // consumes DSL groups identically. `parentId`, when set, is the group whose
    // body we're walking, so a nested group registers itself as its child.
    const walk = (body: ASTStatement[], parentId?: string) => {
      for (const stmt of body) {
        if (stmt.kind === 'NodeDecl') {
          pushNode(stmt as ASTNodeDecl);
          if (parentId) groups.find((g) => g.id === parentId)!.childNodeIds.push((stmt as ASTNodeDecl).id);
        } else if (stmt.kind === 'EdgeDecl') {
          pushEdge(stmt as ASTEdgeDecl);
        } else if (stmt.kind === 'GroupDecl') {
          const gd = stmt as ASTGroupDecl;
          const group: IRGroup = {
            id: gd.id,
            label: gd.label,
            position: { x: 0, y: 0 },
            size: { width: 0, height: 0 },
            style: {},
            childNodeIds: [],
            childGroupIds: [],
            collapsible: gd.collapsible ?? false,
            collapsed: false,
            classList: [],
            data: {},
          };
          groups.push(group);
          if (parentId) groups.find((g) => g.id === parentId)!.childGroupIds.push(group.id);
          walk(gd.body, gd.id);
        }
      }
    };
    walk(ast.body);

    return {
      id: ast.metadata?.id || 'diagram-1',
      type: DiagramType.FLOWCHART,
      title: ast.title || 'Flowchart',
      nodes,
      edges,
      groups,
      layers: [],
      metadata: {},
    };
  },

  getDefaultLayoutOptions() {
    return {
      direction: 'TB',
      nodeSpacing: [80, 60],
      rankSpacing: 80,
    };
  },
};
