// =============================================================================
// SelDiA — State Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';

export const statePlugin: DiagramPlugin = {
  id: 'seldia-state', name: 'State Diagram', version: '1.0.0',
  diagramType: DiagramType.STATE,
  description: 'UML state machine diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const isStart = nd.label === '[*]' || nd.id === '[*]';
        nodes.push({
          id: nd.id, label: nd.label, shape: isStart ? ShapeType.CIRCLE : ShapeType.ROUNDED_RECTANGLE,
          position: { x: 0, y: 0 }, size: { width: 160, height: 50 },
          style: nd.style ? { ...nd.style } : {},
          ports: [], classList: [], collapsed: false, data: nd.data || {},
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `ste-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'state-1', type: DiagramType.STATE, title: ast.title || 'State Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 80], rankSpacing: 80 }; },
};
