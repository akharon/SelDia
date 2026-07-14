// =============================================================================
// SelDiA — Layout Engine Selection (Dagre / ELK)
// =============================================================================
// Two selectable auto-layout algorithms:
//   - "dagre" — synchronous, hierarchical. Used by compileSync() (VS Code
//     Markdown preview) since dagre has no async dependency.
//   - "elk"   — Eclipse Layout Kernel, layered algorithm, generally higher
//     quality for architecture-style diagrams. elkjs has no synchronous API,
//     so it is only available through compile() (async).
//
// Manual per-node positions (from a `{ x, y }` style override, e.g. written
// by the Markdown preview's drag-to-move) always win over either engine —
// see resolveManualOverride() in engine.ts.
// =============================================================================

import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';
import { Direction } from '../types/common.js';
import dagre from 'dagre';

export interface AutoLayoutOptions {
  direction: Direction;
  nodeSpacing: number;
  rankSpacing: number;
  edgeSpacing: number;
}

export interface AutoLayoutResult {
  nodes: IRNode[];
  edges: IREdge[];
  bounds: Rect;
}

function fallbackRoute(src?: IRNode, tgt?: IRNode): Point[] {
  if (!src || !tgt) return [];
  const x1 = src.position.x + src.size.width / 2, y1 = src.position.y + src.size.height;
  const x2 = tgt.position.x + tgt.size.width / 2, y2 = tgt.position.y;
  return [{ x: x1, y: y1 }, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, { x: x2, y: y2 }];
}

function computeBounds(nodes: IRNode[]): Rect {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width); maxY = Math.max(maxY, n.position.y + n.size.height);
  }
  return { x: minX, y: minY, width: maxX - minX + 40, height: maxY - minY + 40 };
}

function dirToDagre(d: Direction): string {
  switch (d) {
    case Direction.TOP_TO_BOTTOM: return 'TB';
    case Direction.LEFT_TO_RIGHT: return 'LR';
    case Direction.BOTTOM_TO_TOP: return 'BT';
    case Direction.RIGHT_TO_LEFT: return 'RL';
    default: return 'TB';
  }
}

/** Synchronous hierarchical layout via dagre. Always available. */
export function layoutWithDagre(ir: DiagramIR, opts: AutoLayoutOptions): AutoLayoutResult {
  const g = new dagre.graphlib!.Graph({ directed: true, multigraph: false, compound: false });
  g.setGraph({
    rankdir: dirToDagre(opts.direction),
    nodesep: opts.nodeSpacing,
    ranksep: opts.rankSpacing,
    edgesep: opts.edgeSpacing,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of ir.nodes) {
    const w = Math.max(n.size.width || 140, 60);
    const h = Math.max(n.size.height || 60, 40);
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of ir.edges) {
    if (!g.hasNode(e.sourceId) || !g.hasNode(e.targetId)) continue;
    // Reserve space for the edge label (dagre treats a labeled edge as
    // occupying a virtual node of this size along the edge's path) so
    // labeled edges (Yes/No, multiplicities) don't collide with other
    // geometry — previously the layout stage had no idea labels existed at
    // all (docs/improvement_request.md item 6).
    const labelSize = e.label ? { width: Math.max(20, e.label.length * 7), height: 20 } : {};
    g.setEdge(e.sourceId, e.targetId, { id: e.id, labelpos: 'c', ...labelSize });
  }

  dagre.layout(g);

  const nodes = ir.nodes.map((n) => {
    const gn = g.node(n.id);
    const w = Math.max(n.size.width || 140, 60);
    const h = Math.max(n.size.height || 60, 40);
    if (gn && gn.x !== undefined && gn.y !== undefined) {
      return { ...n, position: { x: gn.x - w / 2, y: gn.y - h / 2 }, size: { width: w, height: h } };
    }
    return { ...n, size: { width: w, height: h } };
  });

  const edges = ir.edges.map((e) => {
    const ep = g.edge(e.sourceId, e.targetId);
    const src = nodes.find((n) => n.id === e.sourceId);
    const tgt = nodes.find((n) => n.id === e.targetId);
    if (ep && ep.points && ep.points.length >= 2) {
      // Keep dagre's full point list, including the first/last points that sit
      // on the node borders. Stripping the endpoints (slice(1,-1)) collapsed a
      // typical 3-point route down to a single midpoint, which the renderer
      // discards (<2 waypoints ⇒ no line, no arrowhead) — that was the cause
      // of missing arrows between nodes.
      const wps: Point[] = ep.points.map((p: any) => ({ x: p.x, y: p.y }));
      return { ...e, waypoints: wps };
    }
    return { ...e, waypoints: fallbackRoute(src, tgt) };
  });

  return { nodes, edges, bounds: computeBounds(nodes) };
}

function dirToElk(d: Direction): string {
  switch (d) {
    case Direction.TOP_TO_BOTTOM: return 'DOWN';
    case Direction.LEFT_TO_RIGHT: return 'RIGHT';
    case Direction.BOTTOM_TO_TOP: return 'UP';
    case Direction.RIGHT_TO_LEFT: return 'LEFT';
    default: return 'DOWN';
  }
}

/** Async layered layout via elkjs. elkjs has no synchronous API, so this is
 *  only reachable from compile() (not compileSync()). */
export async function layoutWithElk(ir: DiagramIR, opts: AutoLayoutOptions): Promise<AutoLayoutResult> {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': dirToElk(opts.direction),
      'elk.spacing.nodeNode': String(opts.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.rankSpacing),
      'elk.spacing.edgeNode': String(opts.edgeSpacing),
    },
    children: ir.nodes.map((n) => ({
      id: n.id,
      width: Math.max(n.size.width || 140, 60),
      height: Math.max(n.size.height || 60, 40),
    })),
    edges: ir.edges
      .filter((e) => ir.nodes.some((n) => n.id === e.sourceId) && ir.nodes.some((n) => n.id === e.targetId))
      .map((e) => ({
        id: e.id,
        sources: [e.sourceId],
        targets: [e.targetId],
        // Reserve space for the edge label so it doesn't collide with other
        // geometry (docs/improvement_request.md item 6).
        ...(e.label ? { labels: [{ text: e.label, width: Math.max(20, e.label.length * 7), height: 18 }] } : {}),
      })),
  };

  const result = await elk.layout(elkGraph as any);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const child of result.children || []) {
    positions.set(child.id!, { x: child.x || 0, y: child.y || 0, width: child.width || 140, height: child.height || 60 });
  }
  const nodes = ir.nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: { x: p.x, y: p.y }, size: { width: p.width, height: p.height } } : n;
  });

  const edgeBends = new Map<string, Point[]>();
  for (const re of result.edges || []) {
    const sections = (re as any).sections as Array<{ startPoint?: Point; endPoint?: Point; bendPoints?: Point[] }> | undefined;
    if (sections && sections.length) {
      // ELK reports the route as startPoint → bendPoints → endPoint; keep the
      // endpoints so the polyline actually spans the two nodes (a bends-only
      // list is often empty for a straight edge, which left the arrow missing).
      const sec = sections[0];
      const pts: Point[] = [];
      if (sec.startPoint) pts.push({ x: sec.startPoint.x, y: sec.startPoint.y });
      if (sec.bendPoints) for (const b of sec.bendPoints) pts.push({ x: b.x, y: b.y });
      if (sec.endPoint) pts.push({ x: sec.endPoint.x, y: sec.endPoint.y });
      edgeBends.set(re.id!, pts);
    }
  }
  const edges = ir.edges.map((e) => {
    const src = nodes.find((n) => n.id === e.sourceId);
    const tgt = nodes.find((n) => n.id === e.targetId);
    const bends = edgeBends.get(e.id);
    return { ...e, waypoints: bends && bends.length >= 2 ? bends : fallbackRoute(src, tgt) };
  });

  return { nodes, edges, bounds: computeBounds(nodes) };
}

/** Layout engines that can run synchronously (available to compileSync). */
export const SYNC_LAYOUT_ENGINES = new Set(['dagre']);
/** All selectable layout engine ids, sync or async. */
export const LAYOUT_ENGINES = new Set(['dagre', 'elk']);
