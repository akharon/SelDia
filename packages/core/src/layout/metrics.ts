// =============================================================================
// SelDiA — Layout quality metrics
// =============================================================================
// A yardstick for layout work: given a POSITIONED diagram, count the visible
// defects a reader would notice. Measures the polylines the renderer actually
// draws (routeAllEdges: router + clipRouteToNodes) and the label chips the
// renderer actually places (computeEdgeLabelPositions + chipRect), so the
// numbers cannot drift from what ends up on screen. Pure; changes nothing.

import { DiagramType, type DiagramIR, type IRNode, type IRGroup } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';
import { balancedWrap, iconLabelLayout, innerLabelModel, shapeTextBox } from '../render/node-label-geometry.js';
import { clipToShape, isBoxShape } from '../render/shape-clip.js';
import { nodeRect, lineSegmentIntersectsRect, routeAllEdges } from '../render/edge-routing.js';
import { computeEdgeLabelPositions, chipRect } from '../render/edge-label-placement.js';
import { postRoute, postRouteCircuit, groupTitleBands, POST_ROUTE_TYPES } from '../render/edge-layer.js';
import { DS } from '../render/design-system.js';
import { measureLabel, textWidth } from './text-measure.js';

export interface LayoutMetrics {
  /** Edge-segment pairs that cross properly. Pairs sharing a node only count
   *  when the crossing lies well away from that node (not a fan-out at its port). */
  crossings: number;
  /** Collinear segment pairs of DIFFERENT edges overlapping by more than 8px. */
  edgeOverlaps: number;
  /** Segments running parallel to, and within 4px of, a node border for more
   *  than 12px (an endpoint stub perpendicular to its border is not one). */
  borderHugs: number;
  /** Edge segments passing through the interior of a non-endpoint node. */
  edgeNodeHits: number;
  /** Label chips overlapping a node or another label chip (pairs). */
  labelOverlaps: number;
  /** Label chips whose RECT is more than 16px from their own edge polyline. Equals the number of
   *  placement leaders (edge-label-placement.ts), since both measure rect-to-polyline. */
  labelDetached: number;
  /** Label chips intersecting the last 14px (target end) of any edge polyline. Counted per chip. */
  labelOnArrowhead: number;
  /** Label chips intersecting a segment of a DIFFERENT edge, or the top 30px title band of any group. Counted per chip. */
  labelEdgeHits: number;
  /** Edge segments crossing a group's title text box (top-left, drawn by renderGroup). Counted per segment. */
  groupTitleHits: number;
  /** Total px of collinear overlapping segments between different edges (2px tolerance). */
  parallelRunLength: number;
  /** Total interior waypoints across all drawn edges. */
  bends: number;
  /** Most bends on any one drawn edge (record-only, not gated). */
  maxBendsPerEdge: number;
  /** Bends above DS.maxBendsPerEdge, summed over edges (record-only, not gated). */
  excessBends: number;
  /** Intruder nodes + member nodes outside + overlapping sibling group rects. */
  groupViolations: number;
  /** A node's own label box touching an edge segment, its own glyph art, or a
   *  neighbouring node (icon shapes, cylinders, actors, BPMN gateways). */
  nodeLabelHits: number;
  /** Non-rect shapes (diamond, hexagon, ellipse, circle, cylinder) whose wrapped label lines
   *  do not fit the shape's inscribed text box (shapeTextBox). */
  nodeTextOverflow: number;
  /** Mean distance from each edge end to its node's border (0 when no edges). */
  endpointGap: number;
  /** Bounding-box area of nodes, groups and routes. */
  area: number;
  /** Bounding-box width / height (0 when empty). */
  aspectRatio: number;
}

/** Diagram types whose edges are drawn by a bespoke renderer (not the generic
 *  routed polyline), so edge-geometry metrics would measure something that is
 *  never drawn. */
const SELF_DRAWN_EDGES = new Set<string>([
  DiagramType.SEQUENCE, DiagramType.GANTT, DiagramType.MINDMAP,
  DiagramType.GITGRAPH, DiagramType.WIREFRAME,
]);

const OVERLAP_MIN = 8;
const HUG_DIST = 4;
const HUG_MIN = 12;
/** A crossing this close to a node both edges attach to is a port fan-out. */
const SHARED_NODE_NEAR = 12;
/** A label chip further than this from its own edge is detached. */
const LABEL_DETACH = 16;
/** Target-end zone where a label must not sit (arrowhead). */
const ARROW_ZONE = 14;
/** Height of a group's title band. */
const TITLE_BAND = 30;
/** Group title text box: inset from the group's top-left, height, horizontal padding (renderGroup draws at x+10). */
const TITLE_INSET_X = 6, TITLE_INSET_Y = 2, TITLE_H = 24, TITLE_PAD_X = 8;
/** Node text wrap margin, as engine.ts wraps non-rect labels (box width - 8). */
const TEXT_WRAP_MARGIN = 8;
const NON_RECT_SHAPES = new Set<string>(['diamond', 'hexagon', 'ellipse', 'circle', 'cylinder']);
/** Offset tolerance for counting parallel run length. */
const RUN_TOL = 2;

type Seg = [Point, Point];

function segmentsOf(pts: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
  return out;
}

/** The last `len` px of a polyline, measured back from its final point. */
function tailSegments(pts: Point[], len: number): Seg[] {
  const out: Seg[] = [];
  let left = len;
  for (let i = pts.length - 1; i > 0 && left > 0; i--) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= left) { out.push([a, b]); left -= seg; }
    else {
      const t = (seg - left) / seg;
      out.push([{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, b]);
      left = 0;
    }
  }
  return out;
}

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

/** Distance from a point to a rect (0 when inside). */
function rectPointDistance(p: Point, r: Rect): number {
  return Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.width)), Math.max(r.y - p.y, 0, p.y - (r.y + r.height)));
}

/** Distance from a rect to a polyline (0 when they touch or overlap). */
function rectPolylineDistance(r: Rect, pts: Point[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return rectPointDistance(pts[0], r);
  let best = Infinity;
  for (const [a, b] of segmentsOf(pts)) {
    if (lineSegmentIntersectsRect(a, b, r)) return 0;
    best = Math.min(best, rectPointDistance(a, r), rectPointDistance(b, r));
  }
  const corners = [
    { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height }, { x: r.x + r.width, y: r.y + r.height },
  ];
  for (const [a, b] of segmentsOf(pts)) for (const c of corners) best = Math.min(best, pointToSegment(c, a, b));
  return best;
}

/** The text box of a group's title, as renderGroup draws it. */
function groupTitleRect(g: IRGroup): Rect {
  const m = measureLabel(g.label ?? '', DS.fontSize.title);
  return { x: g.position.x + TITLE_INSET_X, y: g.position.y + TITLE_INSET_Y, width: m.width + TITLE_PAD_X, height: TITLE_H };
}

function crossPoint(a: Point, b: Point, c: Point, d: Point): Point {
  const t = orient(c, d, a) / (orient(c, d, a) - orient(c, d, b));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Length of overlap of two collinear segments (0 if not collinear/parallel). */
function collinearOverlap(a: Point, b: Point, c: Point, d: Point, tol = 1): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const ux = dx / len, uy = dy / len;
  const off = (p: Point) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
  if (off(c) > tol || off(d) > tol) return 0;
  const proj = (p: Point) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const lo = Math.max(0, Math.min(proj(c), proj(d)));
  const hi = Math.min(len, Math.max(proj(c), proj(d)));
  return Math.max(0, hi - lo);
}

/** Length of a segment's run parallel to (axis-aligned) rect sides within HUG_DIST. */
function hugRun(a: Point, b: Point, r: Rect): number {
  const horiz = Math.abs(a.y - b.y) < 0.5, vert = Math.abs(a.x - b.x) < 0.5;
  let best = 0;
  if (horiz) {
    const near = [r.y, r.y + r.height].some((y) => Math.abs(a.y - y) <= HUG_DIST);
    if (near) best = Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x));
  } else if (vert) {
    const near = [r.x, r.x + r.width].some((x) => Math.abs(a.x - x) <= HUG_DIST);
    if (near) best = Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y));
  }
  return best;
}

/** Shrink applied to node boxes for hit tests, so border-grazing and
 *  arrowhead-gap contact is not counted as passing through. */
const HIT_INSET = 2;

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** True proper crossing: segments intersect at a single interior point of both. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const E = 1e-9;
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > E && o2 < -E) || (o1 < -E && o2 > E)) && ((o3 > E && o4 < -E) || (o3 < -E && o4 > E));
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function distToRectBorder(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  // inside: distance to nearest side
  return Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y);
}

/** Distance from an edge end to the node's drawn outline: box distance for box
 *  shapes, radial (centre -> point) distance for diamonds, ellipses etc. */
function endGap(p: Point, n: IRNode): number {
  if (isBoxShape(n)) return distToRectBorder(p, nodeRect(n));
  const c = centre(n);
  const edge = clipToShape(n, c, p, 0);
  return Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(edge.x - c.x, edge.y - c.y));
}

const groupRect = (g: IRGroup): Rect => ({ x: g.position.x, y: g.position.y, width: g.size.width, height: g.size.height });
const centre = (n: IRNode): Point => ({ x: n.position.x + n.size.width / 2, y: n.position.y + n.size.height / 2 });
const inRect = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

function groupViolations(ir: DiagramIR): number {
  const groups = ir.groups ?? [];
  if (groups.length === 0) return 0;
  const byId = new Map(groups.map((g) => [g.id, g]));
  // Members of a group = its own nodes plus those of every nested group.
  const members = (g: IRGroup, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>(g.childNodeIds);
    for (const n of ir.nodes) if (n.parentId === g.id) out.add(n.id);
    for (const cid of g.childGroupIds ?? []) {
      const c = byId.get(cid);
      if (!c || seen.has(cid)) continue;
      seen.add(cid);
      for (const m of members(c, seen)) out.add(m);
    }
    return out;
  };
  let count = 0;
  for (const g of groups) {
    const r = groupRect(g);
    const mem = members(g);
    for (const n of ir.nodes) {
      const inside = inRect(centre(n), r);
      if (mem.has(n.id)) { if (!inside) count++; } else if (inside) count++;
    }
  }
  // Overlapping sibling groups (same parent, or both top level).
  const parentOf = new Map<string, string>();
  for (const g of groups) for (const c of g.childGroupIds ?? []) parentOf.set(c, g.id);
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (parentOf.get(groups[i].id) !== parentOf.get(groups[j].id)) continue;
      if (rectsOverlap(groupRect(groups[i]), groupRect(groups[j]))) count++;
    }
  }
  return count;
}

/** The edge paths as drawn: generic routing plus the engine's post-route passes. */
export function routedPaths(ir: DiagramIR): Map<string, Point[]> {
  const nodes = ir.nodes ?? [];
  const edgeGeometry = !SELF_DRAWN_EDGES.has(ir.type as string);
  const routed = edgeGeometry ? routeAllEdges(ir.edges ?? [], nodes, ir.groups) : new Map<string, Point[]>();
  // Sankey ribbons are drawn from the layout's own centreline (end points of a monotone
  // S-curve), not from the generic router, so measure that centreline.
  if ((ir.type as string) === 'sankey') {
    for (const e of ir.edges ?? []) if (e.waypoints && e.waypoints.length >= 2) routed.set(e.id, e.waypoints);
  }
  // Mirror engine.ts: nudge parallel runs apart and plan line jumps on every edge type the
  // engine post-routes, leaving exactEnds edges fixed, so the metrics measure what is drawn.
  if (POST_ROUTE_TYPES.has(ir.type as string) && (ir.type as string) !== 'sankey') {
    const exact = new Set((ir.edges ?? []).filter((e) => (e.data as any)?.exactEnds).map((e) => e.id));
    const fixed = new Map([...routed].filter(([id]) => !exact.has(id)));
    for (const [id, pts] of postRoute({ nodes }, fixed, true, groupTitleBands(ir.groups)).routes) routed.set(id, pts);
  }

  const netOf = new Map<string, string>();
  if ((ir.type as string) === 'circuit') {
    for (const e of ir.edges ?? []) netOf.set(e.id, String((e.data as any)?.net ?? e.id));
    for (const [id, pts] of postRouteCircuit({ nodes }, routed, netOf).routes) routed.set(id, pts);
  }
  return routed;
}

export function measureLayout(ir: DiagramIR): LayoutMetrics {
  const nodes = ir.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const routed = routedPaths(ir);
  const netOf = new Map<string, string>();
  if ((ir.type as string) === 'circuit') for (const e of ir.edges ?? []) netOf.set(e.id, String((e.data as any)?.net ?? e.id));

  let bends = 0, maxBendsPerEdge = 0, excessBends = 0;
  let gapSum = 0, gapN = 0;
  for (const e of ir.edges ?? []) {
    const pts = routed.get(e.id);
    if (!pts || pts.length < 2) continue;
    bends += pts.length - 2;
    maxBendsPerEdge = Math.max(maxBendsPerEdge, pts.length - 2);
    excessBends += Math.max(0, pts.length - 2 - DS.maxBendsPerEdge);
    const s = byId.get(e.sourceId), t = byId.get(e.targetId);
    if (s) { gapSum += endGap(pts[0], s); gapN++; }
    if (t) { gapSum += endGap(pts[pts.length - 1], t); gapN++; }
  }

  // Segments, tagged with their edge and its endpoint nodes.
  const segs: Array<{ a: Point; b: Point; edge: string; s: string; t: string }> = [];
  for (const e of ir.edges ?? []) {
    const pts = routed.get(e.id);
    if (!pts) continue;
    for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], edge: e.id, s: e.sourceId, t: e.targetId });
  }

  let crossings = 0, edgeOverlaps = 0, parallelRun = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i], q = segs[j];
      if (p.edge === q.edge || (netOf.size && netOf.get(p.edge) === netOf.get(q.edge))) continue;
      parallelRun += collinearOverlap(p.a, p.b, q.a, q.b, RUN_TOL);
      if (collinearOverlap(p.a, p.b, q.a, q.b) > OVERLAP_MIN) { edgeOverlaps++; continue; }
      if (!segmentsCross(p.a, p.b, q.a, q.b)) continue;
      const shared = [p.s, p.t].filter((id) => id === q.s || id === q.t);
      if (shared.length) {
        const x = crossPoint(p.a, p.b, q.a, q.b);
        const nearShared = shared.some((id) => {
          const n = byId.get(id);
          return n ? inRect(x, nodeRect(n, SHARED_NODE_NEAR)) : false;
        });
        if (nearShared) continue;
      }
      crossings++;
    }
  }

  let nodeLabelHits = 0;
  for (const n of nodes) {
    const L = iconLabelLayout(n);
    // Sequence headers are plain rectangles whatever their nominal shape.
    const model = L ? { box: L.box, glyphs: L.glyphs } : ir.type === DiagramType.SEQUENCE ? undefined : innerLabelModel(n);
    if (!model) continue;
    const box = model.box;
    for (const sg of segs) if (lineSegmentIntersectsRect(sg.a, sg.b, box)) nodeLabelHits++;
    for (const g of model.glyphs) if (rectsOverlap(box, g)) nodeLabelHits++;
    for (const o of nodes) if (o.id !== n.id && rectsOverlap(box, nodeRect(o))) nodeLabelHits++;
  }

  let borderHugs = 0;
  for (const sg of segs) {
    for (const n of nodes) if (hugRun(sg.a, sg.b, nodeRect(n)) > HUG_MIN) borderHugs++;
  }

  let edgeNodeHits = 0;
  for (const sg of segs) {
    for (const n of nodes) {
      if (n.id === sg.s || n.id === sg.t) continue;
      if (lineSegmentIntersectsRect(sg.a, sg.b, nodeRect(n), -HIT_INSET)) edgeNodeHits++;
    }
  }

  // Label chips exactly as the renderer places them (pad 0: a uniform shift).
  let labelOverlaps = 0, labelDetached = 0, labelOnArrowhead = 0, labelEdgeHits = 0, groupTitleHits = 0;
  if (!SELF_DRAWN_EDGES.has(ir.type as string)) {
    const routedEdges = (ir.edges ?? []).map((e) => (routed.has(e.id) ? { ...e, waypoints: routed.get(e.id) } : e));
    const placements = computeEdgeLabelPositions(routedEdges, byId, 0, ir.groups);
    const chips: Array<{ edge: string; rect: Rect }> = [];
    for (const e of routedEdges) {
      const p = placements.get(e.id);
      if (p && e.label) chips.push({ edge: e.id, rect: chipRect(p.x, p.y, e.label) });
    }
    for (let i = 0; i < chips.length; i++) {
      for (const n of nodes) if (rectsOverlap(chips[i].rect, nodeRect(n))) labelOverlaps++;
      for (let j = i + 1; j < chips.length; j++) if (rectsOverlap(chips[i].rect, chips[j].rect)) labelOverlaps++;
    }
    const tails = [...routed.values()].flatMap((pts) => tailSegments(pts, ARROW_ZONE));
    const titleBands = (ir.groups ?? []).map((g) => ({ x: g.position.x, y: g.position.y, width: g.size.width, height: TITLE_BAND }));
    for (const g of ir.groups ?? []) {
      if (!g.label) continue;
      const tr = groupTitleRect(g);
      for (const pts of routed.values()) for (const [a, b] of segmentsOf(pts)) if (lineSegmentIntersectsRect(a, b, tr)) groupTitleHits++;
    }
    for (const c of chips) {
      const r = c.rect;
      if (rectPolylineDistance(r, routed.get(c.edge) ?? []) > LABEL_DETACH) labelDetached++;
      if (tails.some(([a, b]) => lineSegmentIntersectsRect(a, b, r))) labelOnArrowhead++;
      const hitsEdge = [...routed].some(([id, pts]) => id !== c.edge && segmentsOf(pts).some(([a, b]) => lineSegmentIntersectsRect(a, b, r)));
      if (hitsEdge || titleBands.some((band) => rectsOverlap(r, band))) labelEdgeHits++;
    }
  }

  // Node text that does not fit the inscribed box of a non-rect shape (wrapped as the engine wraps it).
  let nodeTextOverflow = 0;
  for (const n of nodes) {
    // Labels drawn outside the glyph (BPMN events/gateways, gitgraph commits) are not measured here.
    if (!n.label || !NON_RECT_SHAPES.has(String(n.shape))) continue;
    if (iconLabelLayout(n) || ir.type === DiagramType.GITGRAPH) continue;
    const box = shapeTextBox(n);
    const fs = Number((n.style as { fontSize?: unknown }).fontSize) || DS.fontSize.label;
    const lines = balancedWrap(n.label, Math.max(20, box.width - TEXT_WRAP_MARGIN), fs);
    const lh = Math.round(fs * 1.3);
    if (lines.some((l) => textWidth(l, fs) > box.width) || lines.length * lh > box.height) nodeTextOverflow++;
  }

  // Bounding box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const n of nodes) { const r = nodeRect(n); grow(r.x, r.y); grow(r.x + r.width, r.y + r.height); }
  for (const g of ir.groups ?? []) { const r = groupRect(g); grow(r.x, r.y); grow(r.x + r.width, r.y + r.height); }
  for (const pts of routed.values()) for (const p of pts) grow(p.x, p.y);
  const w = isFinite(minX) ? maxX - minX : 0, h = isFinite(minY) ? maxY - minY : 0;

  return {
    crossings,
    edgeOverlaps,
    borderHugs,
    nodeLabelHits,
    nodeTextOverflow,
    edgeNodeHits,
    labelOverlaps,
    labelDetached,
    labelOnArrowhead,
    labelEdgeHits,
    groupTitleHits,
    parallelRunLength: Math.round(parallelRun),
    bends,
    maxBendsPerEdge,
    excessBends,
    groupViolations: groupViolations(ir),
    endpointGap: gapN ? gapSum / gapN : 0,
    area: Math.round(w * h),
    aspectRatio: h > 0 ? Math.round((w / h) * 100) / 100 : 0,
  };
}

// ── Token conformance (measured on the rendered SVG, not the IR) ─────────────
const STROKE_WIDTH_TOKENS = new Set<number>(Object.values(DS.stroke));
const FONT_SIZE_TOKENS = new Set([11, 12, 14, 15]);
/** Comments (group 1) or tags (groups 2-5: closing slash, name, attributes, self-closing slash). */
const SVG_TAG_RE = /<!--([\s\S]*?)-->|<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;

/** Off-token `stroke-width` / `font-size` values, keyed `attr=value` with their count.
 *  Exempt: an element preceded by `<!-- token-exempt -->` or carrying a
 *  `data-token-exempt` attribute, with its whole subtree. `<path>` elements
 *  (rough.js output) are skipped. A regex over attributes, not an XML parser. */
export function tokenHistogram(svg: string): Map<string, number> {
  const hist = new Map<string, number>();
  const bump = (key: string) => hist.set(key, (hist.get(key) ?? 0) + 1);
  const norm = (v: string) => (Number.isFinite(Number(v)) && v.trim() !== '' ? String(Number(v)) : v);
  let pendingExempt = false;
  const open: boolean[] = []; // exempt flag of each open element
  for (const m of svg.matchAll(SVG_TAG_RE)) {
    if (m[1] !== undefined) { if (/token-exempt/.test(m[1])) pendingExempt = true; continue; }
    if (m[2] === '/') { open.pop(); continue; }
    const name = m[3].toLowerCase(), attrs = m[4], selfClosing = m[5] === '/';
    const parentExempt = open.length > 0 && open[open.length - 1];
    const exempt = parentExempt || pendingExempt || /\sdata-token-exempt\b/.test(attrs);
    pendingExempt = false;
    if (!selfClosing) open.push(exempt);
    if (exempt || name === 'path') continue;
    for (const [, v] of attrs.matchAll(/(?:^|\s)stroke-width="([^"]*)"/g)) if (!STROKE_WIDTH_TOKENS.has(Number(v))) bump(`stroke-width=${norm(v)}`);
    for (const [, v] of attrs.matchAll(/(?:^|\s)font-size="([^"]*)"/g)) if (!FONT_SIZE_TOKENS.has(Number(v))) bump(`font-size=${norm(v)}`);
  }
  return hist;
}

/** Count of `stroke-width` and `font-size` values that are not DS tokens (see tokenHistogram). */
export function tokenViolations(svg: string): number {
  let n = 0;
  for (const c of tokenHistogram(svg).values()) n += c;
  return n;
}

// ── Low-contrast text (SVG) ──────────────────────────────────────────────────
// For each <text>: its fill (own, else nearest ancestor fill; `currentColor` ->
// nearest ancestor `color`; SVG default black), against the fill of the smallest
// preceding explicitly filled shape whose bbox contains the text anchor. Text
// with no such shape is on the canvas and is skipped. Counted when the WCAG
// contrast ratio is below 4.5. Renderer geometry is absolute (only `rotate()`
// transforms appear), so coordinates are used as written. Path bboxes are the
// hull of their absolute control/end points; a path with relative commands is
// not used as a background.

type RGB = [number, number, number];
const NAMED_COLORS: Record<string, RGB> = { black: [0, 0, 0], white: [255, 255, 255] };

function parseCssColor(raw: string | undefined): RGB | null | 'none' {
  if (raw === undefined) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return 'none';
  if (s in NAMED_COLORS) return NAMED_COLORS[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as RGB;
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(255, Math.max(0, v))) as RGB;
  return null; // url(), var(), keywords we do not know: undetectable
}

function relativeLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const PATH_ARGC: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

/** Hull of an absolute path's coordinates, or null (relative commands, or none). */
function pathBox(d: string): [number, number, number, number] | null {
  if (/[mlhvcsqtaz]/.test(d.replace(/[MLHVCSQTAZ]/g, ''))) return null;
  const toks = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const xs: number[] = [], ys: number[] = [];
  let cmd = '', args: number[] = [];
  const flush = () => {
    const n = PATH_ARGC[cmd];
    if (n === undefined) return;
    if (cmd === 'H') for (const x of args) xs.push(x);
    else if (cmd === 'V') for (const y of args) ys.push(y);
    else if (cmd === 'A') { if (args.length >= 2) { xs.push(args[args.length - 2]); ys.push(args[args.length - 1]); } }
    else for (let i = 0; i + 1 < args.length; i += 2) { xs.push(args[i]); ys.push(args[i + 1]); }
  };
  for (const t of toks) {
    if (/^[A-Za-z]$/.test(t)) { flush(); cmd = t.toUpperCase(); args = []; }
    else args.push(Number(t));
  }
  flush();
  if (!xs.length || !ys.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function shapeBox(name: string, attrs: Record<string, string>): [number, number, number, number] | null {
  const n = (k: string, d = 0) => (attrs[k] !== undefined && Number.isFinite(Number(attrs[k])) ? Number(attrs[k]) : d);
  switch (name) {
    case 'rect': return [n('x'), n('y'), n('x') + n('width'), n('y') + n('height')];
    case 'circle': return [n('cx') - n('r'), n('cy') - n('r'), n('cx') + n('r'), n('cy') + n('r')];
    case 'ellipse': return [n('cx') - n('rx'), n('cy') - n('ry'), n('cx') + n('rx'), n('cy') + n('ry')];
    case 'path': return attrs.d ? pathBox(attrs.d) : null;
    case 'polygon': {
      const nums = (attrs.points ?? '').match(/-?\d+\.?\d*(?:e-?\d+)?/g)?.map(Number) ?? [];
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      return xs.length && ys.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
    }
    default: return null;
  }
}

const SHAPE_TAGS = new Set(['rect', 'path', 'ellipse', 'circle', 'polygon']);

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, k, v] of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[k] = v;
  // style="fill:..." counts as a fill attribute (style wins over presentation attrs).
  const style = out.style?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/);
  if (style) out.fill = style[1].trim();
  const styleOp = out.style?.match(/(?:^|;)\s*fill-opacity\s*:\s*([^;]+)/);
  if (styleOp && out['fill-opacity'] === undefined) out['fill-opacity'] = styleOp[1].trim();
  return out;
}

/** One low-contrast <text>: its content, effective foreground and backdrop, and the ratio. */
export interface LowContrastHit { text: string; fg: string; bg: string; ratio: number }

const CANVAS: RGB = [255, 255, 255];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Opacity value (number or percentage), clamped to 0..1; absent means opaque. */
function opacityOf(v: string | undefined): number {
  if (v === undefined) return 1;
  const t = v.trim();
  const n = t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
  return Number.isFinite(n) ? clamp01(n) : 1;
}
/** Source-over compositing of colour c at alpha a onto `under`. */
function over(c: RGB, a: number, under: RGB): RGB {
  return [0, 1, 2].map((i) => a * c[i] + (1 - a) * under[i]) as RGB;
}
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Low-contrast text (WCAG < 4.5:1) with its composited colours. Opacity-aware:
 *  a shape contributes fill x fill-opacity x opacity x ancestor <g opacity>, composited
 *  in painter order over the canvas; text composites its own alpha over that backdrop. */
export function lowContrastTextHits(svg: string): LowContrastHit[] {
  type Frame = { fill?: string; color?: string; fillOpacity?: string; op: number };
  const stack: Frame[] = [];
  const shapes: Array<{ box: [number, number, number, number]; fill: RGB; alpha: number }> = [];
  const hits: LowContrastHit[] = [];
  let text: { colour: RGB | null; alpha: number; low: LowContrastHit | null; start: number } | null = null;
  const inherited = (key: keyof Omit<Frame, 'op'>): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i][key] !== undefined) return stack[i][key];
    return undefined;
  };
  const groupOpacity = () => stack.reduce((p, f) => p * f.op, 1);
  /** Composite of every shape containing (x, y), bottom to top; null if none (canvas). */
  const backdrop = (x: number, y: number): RGB | null => {
    let bg: RGB | null = null;
    for (const s of shapes) {
      const [x0, y0, x1, y1] = s.box;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      bg = over(s.fill, s.alpha, bg ?? CANVAS);
    }
    return bg;
  };
  const checkAnchor = (xs: string | undefined, ys: string | undefined) => {
    if (!text || text.colour === null || text.low || xs === undefined || ys === undefined) return;
    const x = Number(xs), y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const bg = backdrop(x, y);
    if (!bg) return;
    const fg = over(text.colour, text.alpha, bg);
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) text.low = { text: '', fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100 };
  };
  const finishText = (end: number, svgText: string) => {
    if (!text) return;
    if (text.low) hits.push({ ...text.low, text: svgText.slice(text.start, end).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() });
    text = null;
  };
  for (const m of svg.matchAll(SVG_TAG_RE)) {
    if (m[1] !== undefined) continue;
    const name = m[3].toLowerCase();
    if (m[2] === '/') {
      stack.pop();
      if (name === 'text') finishText(m.index!, svg);
      continue;
    }
    const attrs = attrsOf(m[4]), selfClosing = m[5] === '/';
    const ownOpacity = opacityOf(attrs.opacity);
    if (name === 'text') {
      const rawFill = attrs.fill ?? inherited('fill');
      const colour = rawFill === 'currentColor' ? inherited('color') ?? '#000000' : rawFill;
      const parsed = colour === undefined ? [0, 0, 0] as RGB : parseCssColor(colour);
      const alpha = opacityOf(attrs['fill-opacity'] ?? inherited('fillOpacity')) * ownOpacity * groupOpacity();
      text = { colour: parsed === 'none' ? null : parsed, alpha, low: null, start: m.index! + m[0].length };
      checkAnchor(attrs.x, attrs.y);
      if (selfClosing) finishText(m.index!, svg);
    } else if (name === 'tspan') {
      checkAnchor(attrs.x, attrs.y);
    } else if (SHAPE_TAGS.has(name)) {
      const box = shapeBox(name, attrs);
      const own = attrs.fill ?? inherited('fill');
      const fill = own !== undefined ? parseCssColor(own) : null;
      if (box && fill !== null && fill !== 'none') {
        const alpha = opacityOf(attrs['fill-opacity'] ?? inherited('fillOpacity')) * ownOpacity * groupOpacity();
        shapes.push({ box, fill, alpha });
      }
    }
    if (!selfClosing) {
      const frame: Frame = { op: ownOpacity };
      if (attrs.fill !== undefined) frame.fill = attrs.fill;
      if (attrs.color !== undefined) frame.color = attrs.color;
      if (attrs['fill-opacity'] !== undefined) frame.fillOpacity = attrs['fill-opacity'];
      stack.push(frame);
    }
  }
  return hits;
}

/** Count of <text> elements below 4.5:1 contrast against their composited backdrop. */
export function lowContrastText(svg: string): number {
  return lowContrastTextHits(svg).length;
}

/** Lexicographic score for comparing two layouts of the same diagram (lower is
 *  better): every gated defect count summed first, then crossings, bends and
 *  total edge length. Used by the `auto` layout engine. */
export function layoutScore(ir: DiagramIR): [number, number] {
  const m = measureLayout(ir);
  // An edge over DS.maxBendsPerEdge counts as a gated defect (hard reject).
  const defects = m.edgeOverlaps + m.borderHugs + m.nodeLabelHits + m.edgeNodeHits + m.labelOverlaps + m.labelDetached
    + m.labelOnArrowhead + m.labelEdgeHits + m.groupTitleHits + m.nodeTextOverflow + m.groupViolations
    + (m.parallelRunLength > 0 ? 1 : 0) + (m.excessBends > 0 ? 1 : 0);
  return [defects, m.crossings * DS.crossingBendWeight + m.bends];
}

/** Total polyline length of the routed edges (final tie-break of the `auto` engine). */
export function totalEdgeLength(ir: DiagramIR): number {
  const routed = routedPaths(ir);
  let len = 0;
  for (const e of ir.edges ?? []) {
    const w = routed.get(e.id) ?? e.waypoints ?? [];
    for (let i = 1; i < w.length; i++) len += Math.abs(w[i].x - w[i - 1].x) + Math.abs(w[i].y - w[i - 1].y);
  }
  return len;
}
