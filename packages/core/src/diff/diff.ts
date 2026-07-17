// =============================================================================
// SelDiA — Diagram Diffing
// =============================================================================
// Structural diff between two compiled IRs: nodes/edges added, removed, or
// changed (label/shape/style), for PR review — "what changed in this
// diagram" without eyeballing two rendered SVGs side by side.
//
// Deliberately IR-level, not source-text-level: comparing DSL text directly
// would flag a reformatted-but-semantically-identical file as changed, and
// would miss two differently-worded sources that compile to the same
// structure. Positions/layout are excluded from the comparison entirely —
// auto-layout moving a node because a sibling was added is not a
// content change worth reporting.
// =============================================================================

import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';

export interface NodeDiff {
  id: string;
  kind: 'added' | 'removed' | 'changed';
  before?: { label: string; shape: string };
  after?: { label: string; shape: string };
  /** Human-readable list of what changed, only present for kind: 'changed'. */
  changes?: string[];
}

export interface EdgeDiff {
  id: string;
  kind: 'added' | 'removed' | 'changed';
  before?: { sourceId: string; targetId: string; label?: string };
  after?: { sourceId: string; targetId: string; label?: string };
  changes?: string[];
}

export interface DiagramDiff {
  /** True if the two diagrams are structurally identical (ignoring layout). */
  identical: boolean;
  typeChanged: boolean;
  beforeType?: string;
  afterType?: string;
  titleChanged: boolean;
  beforeTitle?: string;
  afterTitle?: string;
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  summary: { nodesAdded: number; nodesRemoved: number; nodesChanged: number; edgesAdded: number; edgesRemoved: number; edgesChanged: number };
}

function nodeSnapshot(n: IRNode): { label: string; shape: string } {
  return { label: n.label, shape: String(n.shape) };
}

function edgeSnapshot(e: IREdge): { sourceId: string; targetId: string; label?: string } {
  return { sourceId: e.sourceId, targetId: e.targetId, label: e.label };
}

/** Compare two compiled diagrams and report a structural diff. Matches
 *  nodes/edges by their IR id — an id rename shows up as one removal + one
 *  addition rather than a "changed" entry, since there's no reliable way to
 *  distinguish "renamed" from "replaced" from structure alone. */
export function diffDiagrams(before: DiagramIR, after: DiagramIR): DiagramDiff {
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));

  const nodeDiffs: NodeDiff[] = [];
  for (const [id, n] of beforeNodes) {
    if (!afterNodes.has(id)) nodeDiffs.push({ id, kind: 'removed', before: nodeSnapshot(n) });
  }
  for (const [id, n] of afterNodes) {
    const prev = beforeNodes.get(id);
    if (!prev) { nodeDiffs.push({ id, kind: 'added', after: nodeSnapshot(n) }); continue; }
    const changes: string[] = [];
    if (prev.label !== n.label) changes.push(`label: "${prev.label}" -> "${n.label}"`);
    if (String(prev.shape) !== String(n.shape)) changes.push(`shape: ${prev.shape} -> ${n.shape}`);
    if (changes.length > 0) {
      nodeDiffs.push({ id, kind: 'changed', before: nodeSnapshot(prev), after: nodeSnapshot(n), changes });
    }
  }

  const edgeDiffs: EdgeDiff[] = [];
  for (const [id, e] of beforeEdges) {
    if (!afterEdges.has(id)) edgeDiffs.push({ id, kind: 'removed', before: edgeSnapshot(e) });
  }
  for (const [id, e] of afterEdges) {
    const prev = beforeEdges.get(id);
    if (!prev) { edgeDiffs.push({ id, kind: 'added', after: edgeSnapshot(e) }); continue; }
    const changes: string[] = [];
    if (prev.sourceId !== e.sourceId) changes.push(`source: ${prev.sourceId} -> ${e.sourceId}`);
    if (prev.targetId !== e.targetId) changes.push(`target: ${prev.targetId} -> ${e.targetId}`);
    if ((prev.label || '') !== (e.label || '')) changes.push(`label: "${prev.label || ''}" -> "${e.label || ''}"`);
    if (changes.length > 0) {
      edgeDiffs.push({ id, kind: 'changed', before: edgeSnapshot(prev), after: edgeSnapshot(e), changes });
    }
  }

  const summary = {
    nodesAdded: nodeDiffs.filter((d) => d.kind === 'added').length,
    nodesRemoved: nodeDiffs.filter((d) => d.kind === 'removed').length,
    nodesChanged: nodeDiffs.filter((d) => d.kind === 'changed').length,
    edgesAdded: edgeDiffs.filter((d) => d.kind === 'added').length,
    edgesRemoved: edgeDiffs.filter((d) => d.kind === 'removed').length,
    edgesChanged: edgeDiffs.filter((d) => d.kind === 'changed').length,
  };

  const typeChanged = before.type !== after.type;
  const titleChanged = (before.title || '') !== (after.title || '');

  return {
    identical: !typeChanged && nodeDiffs.length === 0 && edgeDiffs.length === 0,
    typeChanged,
    beforeType: typeChanged ? String(before.type) : undefined,
    afterType: typeChanged ? String(after.type) : undefined,
    titleChanged,
    beforeTitle: titleChanged ? before.title : undefined,
    afterTitle: titleChanged ? after.title : undefined,
    nodes: nodeDiffs,
    edges: edgeDiffs,
    summary,
  };
}
