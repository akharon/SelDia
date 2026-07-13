// =============================================================================
// SelDiA — C4 Architecture Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';

function buildC4Ir(ast: DiagramAST, diagramType: DiagramType): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  for (const stmt of ast.body) {
    if (stmt.kind === 'NodeDecl') {
      const nd = stmt as ASTNodeDecl;
      let shape = nd.shape;
      if (nd.id.startsWith('person') || nd.id.startsWith('actor')) shape = ShapeType.ACTOR;
      else if (nd.id.startsWith('system_Ext') || nd.id.startsWith('container_Ext')) shape = ShapeType.CLOUD;
      else if (nd.id.startsWith('containerDb')) shape = ShapeType.CYLINDER;
      else if (nd.id.startsWith('database') || nd.id.startsWith('db')) shape = ShapeType.CYLINDER;
      nodes.push({
        id: nd.id, label: nd.label, shape, description: nd.description || undefined,
        position: { x: 0, y: 0 }, size: { width: 180, height: 80 },
        style: { ...(nd.style || {}), borderRadius: nd.id.startsWith('person') ? 20 : 8 },
        ports: [], classList: [], collapsed: false, data: nd.data || {},
      });
    }
    if (stmt.kind === 'EdgeDecl') {
      const ed = stmt as ASTEdgeDecl;
      edges.push({
        id: `c4e-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId,
        label: ed.label || undefined, style: { ...(ed.style || {}), strokeStyle: StrokeStyle.SOLID },
        routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {},
      });
    }
  }
  return { id: ast.metadata?.id || 'c4-1', type: diagramType, title: ast.title || 'C4 Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
}

export const c4Plugin: DiagramPlugin = {
  id: 'seldia-c4', name: 'C4 Architecture', version: '1.0.0',
  diagramType: DiagramType.C4_CONTEXT,
  description: 'C4 model: Context, Container, Component, Code levels',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR { return buildC4Ir(ast, ast.type); },
  getDefaultLayoutOptions() { return { direction: 'LR', nodeSpacing: [120, 100], rankSpacing: 120 }; },
};
