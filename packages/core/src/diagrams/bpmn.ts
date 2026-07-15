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

/** BPMN element kind from the DSL's type keyword plus additional inference.
 *  Supports: startEvent, endEvent, intermediateEvent, gateway, task,
 *  pool, lane, dataObject, dataStore. Sub-kinds (task types, gateway types,
 *  event types) are read from `data.subKind` or inferred from label/id. */
function bpmnKindOf(nd: ASTNodeDecl): 'startEvent' | 'endEvent' | 'intermediateEvent' | 'gateway' | 'task' | 'pool' | 'lane' | 'dataObject' | 'dataStore' {
  const kw = ((nd.data as any)?.typeKeyword as string | undefined)?.toLowerCase();
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  switch (kw) {
    case 'startevent': return 'startEvent';
    case 'endevent': return 'endEvent';
    case 'intermediateevent': case 'event': return 'intermediateEvent';
    case 'gateway': return 'gateway';
    case 'pool': return 'pool';
    case 'lane': case 'swimlane': return 'lane';
    case 'dataobject': case 'data': return 'dataObject';
    case 'datastore': return 'dataStore';
    case 'task': default:
      if (/\b(pool|swimlane)\b/.test(probe)) return 'pool';
      return 'task';
  }
}

/** Infer gateway sub-type from label/id or explicit data.subKind. */
function bpmnGatewaySubKind(nd: ASTNodeDecl): string {
  const explicit = ((nd.data as any)?.subKind as string) || '';
  if (explicit) return explicit;
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\+|parallel|and\b/.test(probe)) return 'parallelGateway';
  if (/\bo\b|inclusive|or\b/.test(probe)) return 'inclusiveGateway';
  return 'exclusiveGateway';
}

/** Infer task sub-type from label/id. */
function bpmnTaskSubKind(nd: ASTNodeDecl): string {
  const explicit = ((nd.data as any)?.subKind as string) || '';
  if (explicit) return explicit;
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\b(user|person|human|manual review)\b/.test(probe)) return 'userTask';
  if (/\b(service|api|automated|system)\b/.test(probe)) return 'serviceTask';
  if (/\b(script|scripted)\b/.test(probe)) return 'scriptTask';
  return 'abstractTask';
}

/** Infer event sub-type from label/id. */
function bpmnEventSubKind(nd: ASTNodeDecl): string {
  const explicit = ((nd.data as any)?.subKind as string) || '';
  if (explicit) return explicit;
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\b(message|email|notification)\b/.test(probe)) return 'messageEvent';
  if (/\b(timer|timeout|delay|schedule)\b/.test(probe)) return 'timerEvent';
  if (/\b(error|exception|fault)\b/.test(probe)) return 'errorEvent';
  if (/\b(terminate|stop|end)\b/.test(probe)) return 'terminateEvent';
  return '';
}

const BPMN_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 56, height: 56 }, endEvent: { width: 56, height: 56 }, intermediateEvent: { width: 56, height: 56 },
  gateway: { width: 64, height: 64 }, task: { width: 150, height: 70 },
  pool: { width: 600, height: 300 }, lane: { width: 600, height: 120 },
  dataObject: { width: 120, height: 80 }, dataStore: { width: 100, height: 100 },
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
        const size = (bpmnKind === 'task' || bpmnKind === 'pool' || bpmnKind === 'lane')
          ? (bpmnKind === 'task' ? sizeForLabel(nd.label, (nd.style?.fontSize as number) || 14, 150, 70)
            : BPMN_SIZE[bpmnKind])
          : BPMN_SIZE[bpmnKind];
        const isEvent = bpmnKind === 'startEvent' || bpmnKind === 'endEvent' || bpmnKind === 'intermediateEvent';
        const isGateway = bpmnKind === 'gateway';
        const shape = isGateway ? ShapeType.DIAMOND
          : (bpmnKind === 'task' || bpmnKind === 'pool' || bpmnKind === 'lane') ? ShapeType.ROUNDED_RECTANGLE
          : (bpmnKind === 'dataObject' || bpmnKind === 'dataStore') ? ShapeType.RECTANGLE
          : ShapeType.CIRCLE;
        // Infer sub-kinds for rendering glyphs.
        const subKind = isGateway ? bpmnGatewaySubKind(nd)
          : bpmnKind === 'task' ? bpmnTaskSubKind(nd)
          : isEvent ? bpmnEventSubKind(nd) : '';
        nodes.push({
          id: nd.id, label: nd.label, shape,
          position: { x: 0, y: 0 }, size, style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false,
          data: { ...(nd.data || {}), bpmnKind, bpmnSubKind: subKind },
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
