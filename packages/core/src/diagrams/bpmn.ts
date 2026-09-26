// =============================================================================
// SelDiA — BPMN Process Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
const ROUTING_MAP: Record<string, EdgeRouting> = {
  straight: EdgeRouting.STRAIGHT, spline: EdgeRouting.SPLINE,
  orthogonal: EdgeRouting.ORTHOGONAL, curved: EdgeRouting.CURVED,
};
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';
import { sizeForLabel } from '../layout/text-measure.js';
import { renderBpmnNode } from '../render/custom-renderers.js';

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
      // No type keyword: fall back to the shape the author actually wrote.
      // resources/templates/bpmn.sld documents `(event) [task] {gateway}` as
      // the BPMN shape vocabulary, but without this the shape was dropped and
      // every node collapsed to 'task' — so a whole process rendered (and
      // exported) as a flat wall of tasks with no events or gateways.
      if (!kw) {
        const shapeKind = shapeToBpmnKind(nd);
        if (shapeKind) return shapeKind;
      }
      return 'task';
  }
}

/** Map the DSL shape a BPMN node was declared with onto a BPMN kind, per the
 *  `(event) [task] {gateway}` vocabulary in resources/templates/bpmn.sld.
 *
 *  Note `(…)` lexes to ROUNDED_RECTANGLE and `[…]` to RECTANGLE, so the two
 *  are distinguishable here even though both are rectangles — that difference
 *  is the only record of which one the author typed. `((…))` (true CIRCLE) is
 *  accepted as an event too, since a reader writing a circle in a process
 *  diagram means an event.
 *
 *  Events can't be told apart start-vs-end by shape alone, so they resolve to
 *  a generic event; orientation is settled from edge topology later in
 *  resolveEventOrientation(). */
function shapeToBpmnKind(nd: ASTNodeDecl): 'gateway' | 'task' | 'intermediateEvent' | null {
  switch (nd.shape) {
    case ShapeType.DIAMOND: return 'gateway';
    case ShapeType.CIRCLE: case ShapeType.ROUNDED_RECTANGLE: return 'intermediateEvent';
    case ShapeType.RECTANGLE: return 'task';
    default: return null;
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

/** Settle shape-inferred generic events into startEvent/endEvent from edge
 *  topology: no incoming = start, no outgoing = end. `(…)` is one shape for
 *  both ends of a process, so this is the only signal available — and it's the
 *  same cue a reader takes from the diagram. Nodes that got their kind from an
 *  explicit type keyword are left alone; only the inferred ones are revisited,
 *  which is why this reads `shapeInferredEvent` rather than bpmnKind. */
function resolveEventOrientation(nodes: IRNode[], edges: IREdge[]): void {
  for (const n of nodes) {
    const data = n.data as any;
    if (!data?.shapeInferredEvent) continue;
    delete data.shapeInferredEvent;
    const hasIn = edges.some((e) => e.targetId === n.id);
    const hasOut = edges.some((e) => e.sourceId === n.id);
    if (!hasIn && hasOut) data.bpmnKind = 'startEvent';
    else if (hasIn && !hasOut) data.bpmnKind = 'endEvent';
    else continue; // both (or neither) → genuinely intermediate; leave as-is
    data.bpmnSubKind = data.bpmnKind === 'startEvent' ? 'messageStart' : 'messageEnd';
    // The node was sized/shaped as a rounded-rect task before the shape told
    // us it was an event, so bring geometry in line with the settled kind.
    n.shape = ShapeType.CIRCLE;
    n.size = { ...BPMN_SIZE[data.bpmnKind as 'startEvent' | 'endEvent'] };
  }
}

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
          data: {
            ...(nd.data || {}), bpmnKind, bpmnSubKind: subKind,
            // Marks an event whose kind came from the shape `(…)` rather than
            // an explicit keyword, so resolveEventOrientation() knows it may
            // still be re-settled into a start/end event from edge topology.
            ...(!((nd.data as any)?.typeKeyword) && bpmnKind === 'intermediateEvent'
              ? { shapeInferredEvent: true } : {}),
          },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `bpme-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: { ...(ed.style || {}), strokeStyle: StrokeStyle.SOLID }, routing: (ed.routing && ROUTING_MAP[ed.routing]) || EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    resolveEventOrientation(nodes, edges);
    return { id: ast.metadata?.id || 'bpmn-1', type: DiagramType.BPMN, title: ast.title || 'BPMN Process', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderBpmnNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 80], rankSpacing: 100 }; },
};
