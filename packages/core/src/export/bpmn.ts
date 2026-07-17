// =============================================================================
// SelDiA — BPMN 2.0 XML Exporter
// =============================================================================
// IR -> BPMN 2.0 XML, targeting BPMN-typed diagrams only. Mirrors the shape
// of export/mermaid.ts: best-effort, returns null for any other diagram
// type rather than emitting invalid/misleading output.
//
// Reads node.data.bpmnKind / node.data.bpmnSubKind, exactly as populated by
// diagrams/bpmn.ts's transform() and consumed by
// render/custom-renderers.ts's renderBpmnNode — those are the two other
// places this vocabulary is defined, so this exporter is a third reader of
// the same contract rather than inventing its own.
//
// Scope: emits a single <process> with flow nodes + sequenceFlows, plus
// BPMNDI diagram interchange (shapes positioned from the IR's own layout, so
// the XML opens in a real BPMN viewer already laid out reasonably). Pools/
// lanes are emitted as <laneSet> when present. Not attempted: gateway
// default-flow markers, message flows between pools, boundary events —
// none of those have an IR representation to read from.
// =============================================================================

import type { DiagramIR, IRNode } from '../ir/types.js';
import { DiagramType } from '../ir/types.js';

export function isBpmnExportable(type: DiagramType): boolean {
  return type === DiagramType.BPMN;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeId(id: string): string {
  return /^[A-Za-z_][\w-]*$/.test(id) ? id : `n_${id.replace(/[^\w-]/g, '_')}`;
}

const FLOW_ELEMENT_TAG: Record<string, string> = {
  startEvent: 'startEvent',
  endEvent: 'endEvent',
  intermediateEvent: 'intermediateThrowEvent',
  gateway: 'exclusiveGateway', // overridden below per subKind
  task: 'task', // overridden below per subKind
  dataObject: 'dataObjectReference',
  dataStore: 'dataStoreReference',
};

const GATEWAY_TAG: Record<string, string> = {
  parallelGateway: 'parallelGateway',
  inclusiveGateway: 'inclusiveGateway',
  exclusiveGateway: 'exclusiveGateway',
};

const TASK_TAG: Record<string, string> = {
  userTask: 'userTask',
  serviceTask: 'serviceTask',
  scriptTask: 'scriptTask',
  abstractTask: 'task',
};

/** Infer a BPMN element kind from the node's *shape* when `data.bpmnKind`
 *  carries no real signal.
 *
 *  Needed because the BPMN plugin resolves the documented shape vocabulary
 *  (`(event)` / `[task]` / `{gateway}`, per resources/templates/bpmn.sld) down
 *  to a uniform `bpmnKind: 'task'` — so trusting bpmnKind alone would export a
 *  whole process as a flat wall of <task>, losing every event and gateway.
 *  The shape is the only surviving evidence of what the author wrote.
 *
 *  Events carry no start/end marker in the shape either, so orientation comes
 *  from edge topology: no incoming edges = start, no outgoing = end. That's
 *  the same cue a reader uses, and it degrades to intermediateThrowEvent when
 *  a node has both (a mid-process event) rather than guessing start.
 */
function inferKindFromShape(node: IRNode, hasIncoming: boolean, hasOutgoing: boolean): string {
  const shape = String(node.shape ?? '');
  if (shape === 'diamond') return 'gateway';
  if (shape === 'circle' || shape === 'ellipse') {
    if (!hasIncoming && hasOutgoing) return 'startEvent';
    if (hasIncoming && !hasOutgoing) return 'endEvent';
    return 'intermediateEvent';
  }
  return 'task';
}

function tagFor(node: IRNode, hasIncoming = true, hasOutgoing = true): string | null {
  const rawKind = ((node.data as any)?.bpmnKind as string) || '';
  const subKind = ((node.data as any)?.bpmnSubKind as string) || '';
  if (rawKind === 'pool' || rawKind === 'lane') return null; // structural, not a flow node

  // An explicit non-task bpmnKind is authoritative; a 'task'/absent one is the
  // plugin's fallback, so fall back to the shape instead.
  const kind = (rawKind && rawKind !== 'task')
    ? rawKind
    : inferKindFromShape(node, hasIncoming, hasOutgoing);

  if (kind === 'gateway') return GATEWAY_TAG[subKind] || 'exclusiveGateway';
  if (kind === 'task') return TASK_TAG[subKind] || 'task';
  return FLOW_ELEMENT_TAG[kind] || 'task';
}

/** Emit BPMN 2.0 XML for a BPMN-typed IR. Returns null for any other type. */
export function exportBpmn(ir: DiagramIR): string | null {
  if (ir.type !== DiagramType.BPMN) return null;

  const processId = safeId(ir.id || 'Process_1');
  const flowNodes = ir.nodes.filter((n) => {
    const kind = ((n.data as any)?.bpmnKind as string) || 'task';
    return kind !== 'pool' && kind !== 'lane';
  });
  const nodeIds = new Map<string, string>();
  for (const n of flowNodes) nodeIds.set(n.id, safeId(n.id));

  const elementXml: string[] = [];
  for (const n of flowNodes) {
    const inEdges = ir.edges.filter((e) => e.targetId === n.id);
    const outEdges = ir.edges.filter((e) => e.sourceId === n.id);
    const tag = tagFor(n, inEdges.length > 0, outEdges.length > 0);
    if (!tag) continue;
    const id = nodeIds.get(n.id)!;
    const incoming = inEdges.map((e) => `      <bpmn:incoming>${safeId(e.id)}</bpmn:incoming>`);
    const outgoing = outEdges.map((e) => `      <bpmn:outgoing>${safeId(e.id)}</bpmn:outgoing>`);
    const inner = [...incoming, ...outgoing].join('\n');
    elementXml.push(
      inner
        ? `    <bpmn:${tag} id="${id}" name="${esc(n.label)}">\n${inner}\n    </bpmn:${tag}>`
        : `    <bpmn:${tag} id="${id}" name="${esc(n.label)}" />`
    );
  }

  const flowXml: string[] = [];
  for (const e of ir.edges) {
    const src = nodeIds.get(e.sourceId), tgt = nodeIds.get(e.targetId);
    if (!src || !tgt) continue; // edge touches a pool/lane, not a flow node
    const nameAttr = e.label ? ` name="${esc(e.label)}"` : '';
    flowXml.push(`    <bpmn:sequenceFlow id="${safeId(e.id)}"${nameAttr} sourceRef="${src}" targetRef="${tgt}" />`);
  }

  // BPMNDI: shapes positioned straight from the IR's own layout so the file
  // opens already laid out, not overlapping at (0,0), in any BPMN viewer.
  const shapeXml = flowNodes.map((n) => {
    const id = nodeIds.get(n.id)!;
    return `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}">\n        <dc:Bounds x="${Math.round(n.position.x)}" y="${Math.round(n.position.y)}" width="${Math.round(n.size.width)}" height="${Math.round(n.size.height)}" />\n      </bpmndi:BPMNShape>`;
  });
  const edgeXml = ir.edges
    .filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
    .map((e) => {
      const wps = e.waypoints && e.waypoints.length >= 2 ? e.waypoints : [];
      const points = wps.length >= 2
        ? wps.map((p) => `        <di:waypoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`).join('\n')
        : '';
      return `      <bpmndi:BPMNEdge id="${safeId(e.id)}_di" bpmnElement="${safeId(e.id)}">\n${points}\n      </bpmndi:BPMNEdge>`;
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   id="Definitions_1"
                   targetNamespace="http://seldia.dev/bpmn">
  <bpmn:process id="${processId}" name="${esc(ir.title || 'Process')}" isExecutable="false">
${elementXml.join('\n')}
${flowXml.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
${shapeXml.join('\n')}
${edgeXml.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
