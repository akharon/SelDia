// =============================================================================
// SelDiA — BPMN Process Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';
import { sizeForLabel } from '../layout/text-measure.js';

export const bpmnPlugin: DiagramPlugin = {
  id: 'seldia-bpmn', name: 'BPMN Process', version: '1.0.0',
  diagramType: DiagramType.BPMN,
  description: 'BPMN 2.0 process diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        nodes.push({ id: nd.id, label: nd.label, shape: ShapeType.ROUNDED_RECTANGLE, position: { x: 0, y: 0 }, size: sizeForLabel(nd.label, (nd.style?.fontSize as number) || 14, 140, 60), style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false, data: nd.data || {} });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `bpme-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: { ...(ed.style || {}), strokeStyle: StrokeStyle.SOLID }, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'bpmn-1', type: DiagramType.BPMN, title: ast.title || 'BPMN Process', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 80], rankSpacing: 100 }; },
};
