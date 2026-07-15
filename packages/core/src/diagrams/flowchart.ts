// =============================================================================
// SelDiA — Flowchart Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import type { ShapeType } from '../types/shapes.js';
import { DiagramType } from '../ir/types.js';
import { sizeForLabel } from '../layout/text-measure.js';

export const flowchartPlugin: DiagramPlugin = {
  id: 'seldia-flowchart',
  name: 'Flowchart',
  version: '1.0.0',
  diagramType: DiagramType.FLOWCHART,
  description: 'Flowcharts for processes, workflows, and algorithms',

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
          shape: nd.shape as ShapeType,
          position: { x: 0, y: 0 },
          size: sizeForLabel(nd.label, (nd.style?.fontSize as number) || 14, 100, 50),
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
          id: `edge-${ed.sourceId}-${ed.targetId}`,
          sourceId: ed.sourceId,
          targetId: ed.targetId,
          label: ed.label || undefined,
          style: ed.style ? { ...ed.style } : {},
          routing: (ed.routing as any) || 'orthogonal',
          bidirectional: ed.direction === 'both',
          classList: ed.classList || [],
          data: ed.data || {},
        });
      }
    }

    return {
      id: ast.metadata?.id || 'diagram-1',
      type: DiagramType.FLOWCHART,
      title: ast.title || 'Flowchart',
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
      nodeSpacing: [80, 60],
      rankSpacing: 80,
    };
  },
};
