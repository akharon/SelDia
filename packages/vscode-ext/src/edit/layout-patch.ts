// =============================================================================
// SelDiA — Layout patch (pure, testable)
// =============================================================================
// Turns a visual-editor layout gesture (move nodes / move an edge / auto-
// layout) into source edits.
//
// The source is the only persistent record, so "only what you touch moves"
// means the CURRENT layout must be written down before anything changes:
// every node gets its on-screen `x/y`, every edge its drawn route as `via:`.
// After that a re-render is stable — the engine keeps pinned nodes in place
// and never re-routes a `via` edge. Then:
//   - moved nodes get their new `x/y`, and their incident edges LOSE `via`
//     so only those are re-routed around the new geometry;
//   - a moved edge gets its new `via` and nothing else changes;
//   - auto-layout strips every `x/y` and `via` for a fresh layout.
// Each gesture is one edit list → one WorkspaceEdit → one undo step.
// =============================================================================

import { computeAttrEdit, computeEdgeAttrEdit, computeAppendStatementEdit, type TextEdit } from './position-patch.js';

export interface LayoutEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** Drawn polyline, layout coordinates (from the SVG's `data-route`). */
  route?: Array<{ x: number; y: number }>;
}

export interface LayoutGesture {
  /** Current on-screen position of every node (layout coordinates). */
  positions: Record<string, { x: number; y: number }>;
  edges: LayoutEdge[];
  /** Nodes the user moved: new positions. Their incident edges re-route. */
  moved?: Record<string, { x: number; y: number }>;
  /** An edge the user moved: its new full polyline. */
  edgeRoute?: { id: string; route: Array<{ x: number; y: number }> };
}

/** A drawn route → `via` value: only the BENDS between the two endpoints.
 *  The engine re-attaches the ends to the node borders itself (centre →
 *  first bend, clipped), so the endpoints must not be stored — that is what
 *  keeps a pinned edge attached when its node later moves. One bend is
 *  doubled (`via` needs ≥ 2 points); a straight route has nothing to pin. */
function viaOf(pts: Array<{ x: number; y: number }>): number[] | undefined {
  const inner = pts.slice(1, -1);
  if (!inner.length) return undefined;
  if (inner.length === 1) inner.push(inner[0]);
  return inner.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
}

/** Drop edits that land on an already-edited range (e.g. two `a -> b` edges
 *  resolving to the same line) — overlapping edits fail a WorkspaceEdit. */
function nonOverlapping(edits: TextEdit[]): TextEdit[] {
  const out: TextEdit[] = [];
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    if (prev && e.start < prev.end) continue;
    if (prev && e.start === prev.end && e.start === e.end && prev.start === prev.end) continue;
    out.push(e);
  }
  return out;
}

/** Edits for a move (nodes or one edge), freezing everything else. */
export function computeLayoutGestureEdits(source: string, g: LayoutGesture): TextEdit[] {
  const edits: TextEdit[] = [];
  const moved = g.moved ?? {};
  const undeclared: string[] = [];

  for (const [id, cur] of Object.entries(g.positions)) {
    const p = moved[id] ?? cur;
    const e = computeAttrEdit(source, id, { x: Math.round(p.x), y: Math.round(p.y) });
    if (e) edits.push(e);
    // Implicit node (only named on edge lines): declare it so it can be pinned.
    else if (/^[A-Za-z0-9_-]+$/.test(id)) undeclared.push(`${id} { x: ${Math.round(p.x)}, y: ${Math.round(p.y)} }`);
  }

  for (const edge of g.edges) {
    let attrs: { via: number[] | null } | undefined;
    if (g.edgeRoute?.id === edge.id) attrs = { via: viaOf(g.edgeRoute.route) ?? null };
    else if (moved[edge.sourceId] || moved[edge.targetId]) attrs = { via: null };
    else if (edge.route) { const v = viaOf(edge.route); if (v) attrs = { via: v }; }
    if (!attrs) continue;
    const e = computeEdgeAttrEdit(source, edge.sourceId, edge.targetId, attrs);
    if (e) edits.push(e);
  }

  if (undeclared.length) {
    const e = computeAppendStatementEdit(source, undeclared.join('\n'));
    if (e) edits.push(e);
  }
  return nonOverlapping(edits.filter((e) => source.slice(e.start, e.end) !== e.text));
}

/** Edits that strip every manual `x/y` and `via` — a fresh auto layout. */
export function computeAutoLayoutEdits(source: string, nodeIds: string[], edges: LayoutEdge[]): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const id of nodeIds) {
    const e = computeAttrEdit(source, id, { x: null, y: null });
    if (e) edits.push(e);
  }
  for (const edge of edges) {
    const e = computeEdgeAttrEdit(source, edge.sourceId, edge.targetId, { via: null });
    if (e) edits.push(e);
  }
  return nonOverlapping(edits.filter((e) => source.slice(e.start, e.end) !== e.text));
}
