// =============================================================================
// SelDiA — Component Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';

export const componentPlugin: DiagramPlugin = {
  id: 'seldia-component', name: 'Component Diagram', version: '1.0.0',
  diagramType: DiagramType.COMPONENT,
  description: 'Software component and dependency diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const isDb = nd.shape === ShapeType.CYLINDER || nd.id.startsWith('db');
        nodes.push({ id: nd.id, label: nd.label, shape: isDb ? ShapeType.CYLINDER : ShapeType.RECTANGLE, position: { x: 0, y: 0 }, size: { width: 170, height: 70 }, style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false, data: nd.data || {} });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `compe-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'comp-1', type: DiagramType.COMPONENT, title: ast.title || 'Component Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 80], rankSpacing: 100 }; },
};
