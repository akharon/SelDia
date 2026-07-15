// =============================================================================
// SelDiA — Entity-Relationship Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';
import { erEntitySize } from '../render/custom-renderers.js';

export const erPlugin: DiagramPlugin = {
  id: 'seldia-er', name: 'ER Diagram', version: '1.0.0',
  diagramType: DiagramType.ER,
  description: 'Entity-Relationship diagrams for data modeling',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        // Sized from the label so the layout reserves exactly the table the
        // renderer draws — a fixed height left relationships anchored on a
        // border below the visible entity (see erEntitySize).
        nodes.push({ id: nd.id, label: nd.label, shape: ShapeType.RECTANGLE, position: { x: 0, y: 0 }, size: erEntitySize(nd.label), style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false, data: nd.data || {} });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `ere-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, label2: ed.label2 || undefined, style: { ...(ed.style || {}), strokeStyle: StrokeStyle.SOLID }, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'er-1', type: DiagramType.ER, title: ast.title || 'ER Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [120, 100], rankSpacing: 120 }; },
};
