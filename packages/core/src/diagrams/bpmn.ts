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

/** BPMN element kind from the DSL's type keyword (`startEvent start: "..."`,
 *  `gateway payment: "..."`, `task validate: "..."`, ...). Falls back to
 *  'task' for plain `id: "label"` nodes, the common case. Read from
 *  `data.typeKeyword` (see parser.ts) rather than the node id, which never
 *  actually carried the keyword — the root cause of every BPMN element
 *  rendering as an identical plain box. */
function bpmnKindOf(nd: ASTNodeDecl): 'startEvent' | 'endEvent' | 'intermediateEvent' | 'gateway' | 'task' {
  const kw = ((nd.data as any)?.typeKeyword as string | undefined)?.toLowerCase();
  switch (kw) {
    case 'startevent': return 'startEvent';
    case 'endevent': return 'endEvent';
    case 'intermediateevent': case 'event': return 'intermediateEvent';
    case 'gateway': return 'gateway';
    case 'task': default: return 'task';
  }
}

const BPMN_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 56, height: 56 }, endEvent: { width: 56, height: 56 }, intermediateEvent: { width: 56, height: 56 },
  gateway: { width: 64, height: 64 }, task: { width: 150, height: 70 },
};

export const bpmnPlugin: DiagramPlugin = {
  id: 'seldia-bpmn', name: 'BPMN Process', version: '1.0.0',
  diagramType: DiagramType.BPMN,
  description: 'BPMN 2.0 process diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const bpmnKind = bpmnKindOf(nd);
        const size = bpmnKind === 'task' ? sizeForLabel(nd.label, (nd.style?.fontSize as number) || 14, 150, 70) : BPMN_SIZE[bpmnKind];
        nodes.push({
          id: nd.id, label: nd.label, shape: bpmnKind === 'gateway' ? ShapeType.DIAMOND : bpmnKind === 'task' ? ShapeType.ROUNDED_RECTANGLE : ShapeType.CIRCLE,
          position: { x: 0, y: 0 }, size, style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), bpmnKind },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `bpme-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: { ...(ed.style || {}), strokeStyle: StrokeStyle.SOLID }, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'bpmn-1', type: DiagramType.BPMN, title: ast.title || 'BPMN Process', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 80], rankSpacing: 100 }; },
};
