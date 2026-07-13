// =============================================================================
// SelDiA — Class Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';

export const classPlugin: DiagramPlugin = {
  id: 'seldia-class',
  name: 'Class Diagram',
  version: '1.0.0',
  diagramType: DiagramType.CLASS,
  description: 'UML class diagrams for object-oriented design',

  transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];

    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        nodes.push({
          id: nd.id,
          label: nd.label,
          description: nd.description || undefined,
          shape: nd.shape || ShapeType.RECTANGLE,
          position: { x: 0, y: 0 },
          size: { width: 180, height: 100 },
          style: nd.style ? { ...nd.style } : {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: nd.data || {},
        });
      }

      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({
          id: `class-edge-${ed.sourceId}-${ed.targetId}`,
          sourceId: ed.sourceId,
          targetId: ed.targetId,
          label: ed.label || undefined,
          label2: ed.label2 || undefined,
          style: { ...(ed.style || {}), arrowhead: true },
          routing: EdgeRouting.ORTHOGONAL,
          bidirectional: ed.direction === 'both',
          classList: ed.classList || [],
          data: ed.data || {},
        });
      }
    }

    return {
      id: ast.metadata?.id || 'class-1',
      type: DiagramType.CLASS,
      title: ast.title || 'Class Diagram',
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
      nodeSpacing: [100, 80],
      rankSpacing: 100,
    };
  },
};
