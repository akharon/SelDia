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
import { centerOf } from '../render/edge-routing.js';
import dagre from 'dagre';
import { EDGE_LABEL_FONT } from '../render/edge-label-placement.js';
import { layoutSync as layoutElkGraph } from './elk-sync.js';
import { measureLabel } from './text-measure.js';

export interface AutoLayoutOptions {
  direction: Direction;
  nodeSpacing: number;
  rankSpacing: number;
  edgeSpacing: number;
  /** `auto` variants: dagre ranker. */
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
  /** `auto` variants: ELK node-placement strategy. */
  elkPlacement?: string;
  /** ELK crossing-minimisation effort (default 10); large `auto` graphs lower it. */
  elkThoroughness?: number;
  /** `auto` variants: extra ELK layout options merged over the defaults. */
  elkExtra?: Record<string, string>;
}

export interface AutoLayoutResult {
  nodes: IRNode[];
  edges: IREdge[];
  bounds: Rect;
  /** Compound-node rectangles chosen by the layout engine, keyed by group id.
   *  When present, `layoutGroups` keeps these instead of re-deriving bounds. */
  groupBounds?: Map<string, Rect>;
}

/** Used when the engine reported no usable route. Centre-to-centre: the
 *  renderer clips the line back to both node borders, so anchoring it to a
 *  particular side here would only be right for a top-to-bottom pair. */
function fallbackRoute(src?: IRNode, tgt?: IRNode): Point[] {
  if (!src || !tgt) return [];
  return [centerOf(src), centerOf(tgt)];
}

function computeBounds(nodes: IRNode[], edges?: IREdge[]): Rect {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width); maxY = Math.max(maxY, n.position.y + n.size.height);
  }
  // Include edge waypoints so detoured routes are not clipped.
  if (edges) {
    for (const e of edges) {
      if (!e.waypoints) continue;
      for (const p of e.waypoints) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
    }
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

/** Register each IRGroup as a dagre cluster and assign its members to it, so
 *  the layout keeps a group's nodes contiguous instead of letting an unrelated
 *  node land between them.
 *
 *  Without this the group box was purely post-hoc: `layoutGroups()` unions the
 *  bounds of whatever positions dagre chose, so a non-member placed mid-group
 *  was silently swallowed by the drawn box (a state machine's sibling state
 *  appearing inside a composite state; a whole `Data` package appearing inside
 *  `Services`). Membership has to reach the layout engine for the box to mean
 *  anything.
 *
 *  Only groups that actually have member nodes are registered — dagre throws on
 *  an empty cluster — and a node is assigned to at most one parent, the
 *  innermost group claiming it, since dagre's tree admits no multiple
 *  parenthood. Nested groups are wired parent-to-parent so the hierarchy
 *  survives. Returns false when there is nothing to cluster, letting the caller
 *  skip compound mode entirely (it changes dagre's ranking even with no
 *  clusters set). */
function applyClusters(g: any, ir: DiagramIR): boolean {
  if (!ir.groups?.length) return false;

  const byId = new Map(ir.groups.map((gr) => [gr.id, gr]));
  // Depth of each group in the childGroupIds forest: a deeper group is the more
  // specific owner of a node listed by both it and an ancestor.
  const depth = new Map<string, number>();
  const walk = (id: string, d: number, seen: Set<string>) => {
    if (seen.has(id)) return; // cyclic childGroupIds are guarded elsewhere too
    seen.add(id);
    depth.set(id, Math.max(depth.get(id) ?? 0, d));
    for (const c of byId.get(id)?.childGroupIds ?? []) walk(c, d + 1, seen);
  };
  const childIds = new Set(ir.groups.flatMap((gr) => gr.childGroupIds ?? []));
  for (const gr of ir.groups) if (!childIds.has(gr.id)) walk(gr.id, 0, new Set());
  for (const gr of ir.groups) if (!depth.has(gr.id)) depth.set(gr.id, 0);

  const owner = new Map<string, string>();
  for (const gr of ir.groups) {
    for (const nodeId of gr.childNodeIds) {
      const cur = owner.get(nodeId);
      if (!cur || (depth.get(gr.id) ?? 0) > (depth.get(cur) ?? 0)) owner.set(nodeId, gr.id);
    }
  }

  const used = new Set(owner.values());
  if (!used.size) return false;
  // A group whose id collides with a real node's would make dagre treat the
  // node as the cluster; the node's own geometry would then be read back off a
  // container rect. Bail rather than lay the diagram out wrongly.
  for (const id of used) if (ir.nodes.some((n) => n.id === id)) return false;
  // A cluster must exist before anything is parented into it, and a parent
  // cluster must exist before its child cluster — register shallowest first.
  const ordered = [...used].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0));
  for (const id of ordered) g.setNode(id, {});
  for (const id of ordered) {
    const parent = ir.groups.find((gr) => (gr.childGroupIds ?? []).includes(id));
    if (parent && used.has(parent.id)) g.setParent(id, parent.id);
  }
  for (const [nodeId, groupId] of owner) if (g.hasNode(nodeId)) g.setParent(nodeId, groupId);
  return true;
}

/** Extra px reserved beside a node that carries a self-loop. */
export const SELF_LOOP_RESERVE = 30;

/** Synchronous hierarchical layout via dagre. Always available. */
export function layoutWithDagre(ir: DiagramIR, opts: AutoLayoutOptions): AutoLayoutResult {
  const compound = !!ir.groups?.length;
  const g = new dagre.graphlib!.Graph({ directed: true, multigraph: true, compound });
  g.setGraph({
    rankdir: dirToDagre(opts.direction),
    nodesep: opts.nodeSpacing,
    ranksep: opts.rankSpacing,
    edgesep: opts.edgeSpacing,
    marginx: 20,
    marginy: 20,
    ...(opts.ranker ? { ranker: opts.ranker } : {}),
  });
  g.setDefaultEdgeLabel(() => ({}));

  const horizontalFlow = opts.direction === Direction.LEFT_TO_RIGHT || opts.direction === Direction.RIGHT_TO_LEFT;
  const looped = new Set(ir.edges.filter((e) => e.sourceId === e.targetId).map((e) => e.sourceId));
  // A self-loop sits on the node's lateral side: widen dagre's box there
  // (TB: right, LR: bottom) so neighbours leave room for it.
  const loopPad = (n: { id: string }) => (looped.has(n.id) ? SELF_LOOP_RESERVE : 0);
  for (const n of ir.nodes) {
    const w = Math.max(n.size.width || 140, 60);
    const h = Math.max(n.size.height || 60, 40);
    g.setNode(n.id, { width: w + (horizontalFlow ? 0 : loopPad(n)), height: h + (horizontalFlow ? loopPad(n) : 0) });
  }
  for (const e of ir.edges) {
    if (!g.hasNode(e.sourceId) || !g.hasNode(e.targetId)) continue;
    // Reserve space for the edge label (dagre treats a labeled edge as
    // occupying a virtual node of this size along the edge's path) so
    // labeled edges (Yes/No, multiplicities) don't collide with other
    // geometry — previously the layout stage had no idea labels existed at
    // all (docs/improvement_request.md item 6).
    const lm = e.label ? measureLabel(e.label, EDGE_LABEL_FONT) : undefined;
    const labelSize = lm ? { width: Math.max(20, Math.ceil(lm.width) + 8), height: Math.max(20, lm.height + 4) } : {};
    g.setEdge(e.sourceId, e.targetId, { id: e.id, labelpos: 'c', ...labelSize }, e.id);
  }

  if (compound) applyClusters(g, ir);

  dagre.layout(g);

  const nodes = ir.nodes.map((n) => {
    const gn = g.node(n.id);
    const w = Math.max(n.size.width || 140, 60);
    const h = Math.max(n.size.height || 60, 40);
    if (gn && gn.x !== undefined && gn.y !== undefined) {
      const px = horizontalFlow ? 0 : loopPad(n), py = horizontalFlow ? loopPad(n) : 0;
      return { ...n, position: { x: gn.x - (w + px) / 2, y: gn.y - (h + py) / 2 }, size: { width: w, height: h } };
    }
    return { ...n, size: { width: w, height: h } };
  });

  const loopData = (e: IREdge) =>
    e.sourceId === e.targetId ? { data: { ...e.data, loopSide: horizontalFlow ? 'bottom' : 'right' } } : {};
  const edges = ir.edges.map((e) => {
    const ep = g.edge({ v: e.sourceId, w: e.targetId, name: e.id });
    const src = nodes.find((n) => n.id === e.sourceId);
    const tgt = nodes.find((n) => n.id === e.targetId);
    if (ep && ep.points && ep.points.length >= 2) {
      // Keep dagre's full point list, including the first/last points that sit
      // on the node borders. Stripping the endpoints (slice(1,-1)) collapsed a
      // typical 3-point route down to a single midpoint, which the renderer
      // discards (<2 waypoints ⇒ no line, no arrowhead) — that was the cause
      // of missing arrows between nodes.
      const wps: Point[] = ep.points.map((p: any) => ({ x: p.x, y: p.y }));
      return { ...e, waypoints: wps, ...loopData(e) };
    }
    return { ...e, waypoints: fallbackRoute(src, tgt), ...loopData(e) };
  });

  return { nodes, edges, bounds: computeBounds(nodes, edges) };
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

/** ELK layout options for graph-style diagrams (plan F1/T1.5). */
function elkGraphOptions(opts: AutoLayoutOptions): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': dirToElk(opts.direction),
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': String(opts.nodeSpacing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.rankSpacing),
    'elk.spacing.edgeNode': String(opts.edgeSpacing),
    'elk.spacing.edgeEdge': '14',
    'org.eclipse.elk.randomSeed': '1',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '15',
    'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.max(10, Math.round(opts.edgeSpacing))),
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.feedbackEdges': 'true',
    'elk.layered.thoroughness': '10',
  };
}

interface GroupTree {
  /** Group ids that hold at least one node, directly or through a descendant. */
  live: Set<string>;
  /** Parent group of each live group (absent for top-level ones). */
  parent: Map<string, string>;
  /** Innermost live group owning each node (absent for top-level nodes). */
  owner: Map<string, string>;
  /** Live groups, shallowest first. */
  ordered: string[];
}

/** Resolve IRGroups into a strict tree for ELK: each node has one innermost
 *  owner, each group one parent. Returns null when there are no groups or the
 *  ids collide with node ids (ELK needs unique ids across the hierarchy). */
function buildGroupTree(ir: DiagramIR): GroupTree | null {
  if (!ir.groups?.length) return null;
  const nodeIds = new Set(ir.nodes.map((n) => n.id));
  if (ir.groups.some((g) => nodeIds.has(g.id))) return null;
  const byId = new Map(ir.groups.map((g) => [g.id, g]));
  const parent = new Map<string, string>();
  for (const g of ir.groups) {
    for (const c of g.childGroupIds ?? []) if (byId.has(c) && c !== g.id && !parent.has(c)) parent.set(c, g.id);
  }
  // Break cycles (a group that is its own ancestor): drop the back-link.
  for (const g of ir.groups) {
    const seen = new Set<string>([g.id]);
    let cur = parent.get(g.id);
    while (cur) {
      if (seen.has(cur)) { parent.delete(g.id); break; }
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  const depth = (id: string): number => { let d = 0; for (let c = parent.get(id); c; c = parent.get(c)) d++; return d; };
  const owner = new Map<string, string>();
  for (const g of ir.groups) {
    for (const nid of g.childNodeIds) {
      if (!nodeIds.has(nid)) continue;
      const cur = owner.get(nid);
      if (!cur || depth(g.id) > depth(cur)) owner.set(nid, g.id);
    }
  }
  const live = new Set<string>();
  for (const gid of owner.values()) for (let c: string | undefined = gid; c && !live.has(c); c = parent.get(c)) live.add(c);
  if (!live.size) return null;
  const ordered = [...live].sort((a, b) => depth(a) - depth(b));
  return { live, parent, owner, ordered };
}

/** Section chain → one polyline (ELK may split an edge into several sections). */
export function sectionsToPoints(sections: any[]): Point[] {
  if (!sections.length) return [];
  const byId = new Map<string, any>(sections.map((s) => [s.id, s]));
  let cur = sections.find((s) => !s.incomingSections?.length) ?? sections[0];
  const pts: Point[] = [];
  const seen = new Set<any>();
  const push = (p?: Point) => {
    if (!p) return;
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push({ x: p.x, y: p.y });
  };
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    push(cur.startPoint);
    for (const b of cur.bendPoints ?? []) push(b);
    push(cur.endPoint);
    cur = cur.outgoingSections?.length ? byId.get(cur.outgoingSections[0]) : undefined;
  }
  return pts;
}

/** Layered layout via ELK, synchronous. Groups become nested ELK compound
 *  nodes (edges declared in their lowest common ancestor); node, edge-route,
 *  edge-label and group-bound results are converted back to absolute
 *  coordinates. Throws if ELK fails — the caller falls back to dagre. */
export function layoutWithElkSync(ir: DiagramIR, opts: AutoLayoutOptions): AutoLayoutResult {
  const tree = buildGroupTree(ir);
  const groupById = new Map((ir.groups ?? []).map((g) => [g.id, g]));
  const nodeIds = new Set(ir.nodes.map((n) => n.id));

  const hFlow = opts.direction === Direction.LEFT_TO_RIGHT || opts.direction === Direction.RIGHT_TO_LEFT;
  const looped = new Set(ir.edges.filter((e) => e.sourceId === e.targetId).map((e) => e.sourceId));
  const padW = (n: IRNode) => (looped.has(n.id) && !hFlow ? SELF_LOOP_RESERVE : 0);
  const padH = (n: IRNode) => (looped.has(n.id) && hFlow ? SELF_LOOP_RESERVE : 0);
  const elkNode = (n: IRNode) => ({
    id: n.id,
    width: Math.max(n.size.width || 140, 60) + padW(n),
    height: Math.max(n.size.height || 60, 40) + padH(n),
  });
  const groupNode = (gid: string): any => {
    const g = groupById.get(gid)!;
    const pad = g.style?.padding ?? 16;
    return {
      id: gid,
      layoutOptions: { 'elk.padding': `[top=${Math.max(30, pad + 22)},left=${pad},bottom=${pad},right=${pad}]` },
      children: [] as any[],
      edges: [] as any[],
    };
  };

  // Compound graphs: ELK applies the between-layers spacing to the gap between
  // sibling group boxes as well, on top of their own padding, so groups drift
  // far apart. Tighten it when groups exist (the group padding already keeps
  // content off the border).
  const rootOpts = elkGraphOptions(opts);
  if (opts.elkThoroughness) rootOpts['elk.layered.thoroughness'] = String(opts.elkThoroughness);
  if (opts.elkExtra) Object.assign(rootOpts, opts.elkExtra);
  if (opts.elkPlacement) rootOpts['elk.layered.nodePlacement.strategy'] = opts.elkPlacement;
  if (tree && tree.ordered.length) rootOpts['elk.layered.spacing.nodeNodeBetweenLayers'] = String(Math.round(opts.rankSpacing * 0.6));
  const root: any = { id: '__root__', layoutOptions: rootOpts, children: [] as any[], edges: [] as any[] };
  const containers = new Map<string, any>();
  if (tree) for (const gid of tree.ordered) containers.set(gid, groupNode(gid));
  const ownerOf = (id: string): string | undefined => tree?.owner.get(id);
  const containerFor = (gid: string | undefined) => (gid ? containers.get(gid) : root);
  if (tree) for (const gid of tree.ordered) containerFor(tree.parent.get(gid))!.children.push(containers.get(gid));
  for (const n of ir.nodes) containerFor(ownerOf(n.id))!.children.push(elkNode(n));

  const ancestors = (id: string, isGroup: boolean): string[] => {
    const chain: string[] = [];
    for (let c = isGroup ? id : ownerOf(id); c; c = tree?.parent.get(c)) chain.push(c);
    return chain; // innermost → outermost
  };
  /** Where each edge was declared, to rebase its coordinates afterwards. */
  const edgeHome = new Map<string, string | undefined>();
  for (const e of ir.edges) {
    if (!nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)) continue;
    const sa = ancestors(e.sourceId, false), ta = new Set(ancestors(e.targetId, false));
    const lca = sa.find((g) => ta.has(g)); // innermost shared group, or undefined = root
    edgeHome.set(e.id, lca);
    let labels: any[] | undefined;
    if (e.label) {
      const m = measureLabel(e.label, 12);
      labels = [{ id: `${e.id}__label`, text: e.label, width: Math.ceil(m.width) + 10, height: Math.ceil(m.height) + 6,
        layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }];
    }
    containerFor(lca)!.edges.push({ id: e.id, sources: [e.sourceId], targets: [e.targetId], ...(labels ? { labels } : {}) });
  }

  const result = layoutElkGraph(root);

  // Absolute origin of every container, then absolute node / group rects.
  const origin = new Map<string | undefined, Point>([[undefined, { x: 0, y: 0 }]]);
  const rects = new Map<string, Rect>();
  const walk = (node: any, ox: number, oy: number, isRoot: boolean) => {
    for (const c of node.children ?? []) {
      const ax = ox + (c.x || 0), ay = oy + (c.y || 0);
      rects.set(c.id, { x: ax, y: ay, width: c.width || 0, height: c.height || 0 });
      if (containers.has(c.id)) { origin.set(c.id, { x: ax, y: ay }); walk(c, ax, ay, false); }
    }
    void isRoot;
  };
  walk(result, 0, 0, true);

  const nodes = ir.nodes.map((n) => {
    const r = rects.get(n.id);
    return r ? { ...n, position: { x: r.x, y: r.y }, size: { width: r.width - padW(n), height: r.height - padH(n) } } : n;
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const routed = new Map<string, { pts: Point[]; label?: Point }>();
  const collect = (node: any, cid: string | undefined) => {
    const o = origin.get(cid) ?? { x: 0, y: 0 };
    for (const re of node.edges ?? []) {
      const pts = sectionsToPoints(re.sections ?? []).map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
      const l = re.labels?.[0];
      const label = l && l.x !== undefined ? { x: o.x + l.x + (l.width || 0) / 2, y: o.y + l.y + (l.height || 0) / 2 } : undefined;
      routed.set(re.id, { pts, label });
    }
    for (const c of node.children ?? []) if (containers.has(c.id)) collect(c, c.id);
  };
  collect(result, undefined);

  const edges = ir.edges.map((e0) => {
    const e = e0.sourceId === e0.targetId ? { ...e0, data: { ...e0.data, loopSide: hFlow ? 'bottom' : 'right' } } : e0;
    const r = routed.get(e.id);
    const src = nodeById.get(e.sourceId), tgt = nodeById.get(e.targetId);
    if (r && r.pts.length >= 2) {
      return { ...e, waypoints: r.pts, layoutRouted: true, ...(r.label && e.label ? { layoutLabel: r.label } : {}) };
    }
    return { ...e, waypoints: fallbackRoute(src, tgt) };
  });

  const groupBounds = new Map<string, Rect>();
  for (const gid of containers.keys()) { const r = rects.get(gid); if (r) groupBounds.set(gid, r); }

  const bounds = computeBounds(nodes, edges);
  for (const r of groupBounds.values()) {
    bounds.width = Math.max(bounds.width, r.x + r.width - bounds.x + 40);
    bounds.height = Math.max(bounds.height, r.y + r.height - bounds.y + 40);
    if (r.x < bounds.x) { bounds.width += bounds.x - r.x; bounds.x = r.x; }
    if (r.y < bounds.y) { bounds.height += bounds.y - r.y; bounds.y = r.y; }
  }
  return { nodes, edges, bounds, groupBounds };
}

/** Async entry point (kept for existing callers); same engine as the sync one. */
export async function layoutWithElk(ir: DiagramIR, opts: AutoLayoutOptions): Promise<AutoLayoutResult> {
  return layoutWithElkSync(ir, opts);
}

/** Layout engines that can run synchronously (available to compileSync). */
export const SYNC_LAYOUT_ENGINES = new Set(['dagre', 'elk']);
/** All selectable layout engine ids, sync or async. */
export const LAYOUT_ENGINES = new Set(['dagre', 'elk']);
