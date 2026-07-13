// =============================================================================
// SelDiA — Sequence Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';

export const sequencePlugin: DiagramPlugin = {
  id: 'seldia-sequence',
  name: 'Sequence Diagram',
  version: '1.0.0',
  diagramType: DiagramType.SEQUENCE,
  description: 'Sequence diagrams for interaction flows',

  transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];
    let edgeIndex = 0;

    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        nodes.push({
          id: nd.id,
          label: nd.label,
          shape: nd.shape,
          position: { x: 0, y: 0 },
          size: { width: 120, height: 40 },
          style: nd.style ? { ...nd.style } : {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: nd.data || {},
        });
      }

      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edgeIndex++;
        edges.push({
          id: `seq-edge-${edgeIndex}`,
          sourceId: ed.sourceId,
          targetId: ed.targetId,
          label: ed.label || undefined,
          style: { ...(ed.style || {}), arrowhead: ed.direction !== 'none' },
          routing: EdgeRouting.SPLINE,
          bidirectional: ed.direction === 'both',
          classList: ed.classList || [],
          data: ed.data || {},
        });
      }
    }

    return {
      id: ast.metadata?.id || 'seq-1',
      type: DiagramType.SEQUENCE,
      title: ast.title || 'Sequence Diagram',
      nodes,
      edges,
      groups: [],
      layers: [],
      metadata: {},
    };
  },

  getDefaultLayoutOptions() {
    return {
      direction: 'TB',
      nodeSpacing: [120, 80],
      rankSpacing: 40,
    };
  },
};
