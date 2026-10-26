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
import { iconLabelLayout, innerLabelModel } from '../render/node-label-geometry.js';
import { clipToShape, isBoxShape } from '../render/shape-clip.js';
import { nodeRect, lineSegmentIntersectsRect, routeAllEdges } from '../render/edge-routing.js';
import { computeEdgeLabelPositions, chipRect } from '../render/edge-label-placement.js';

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
  /** Total interior waypoints across all drawn edges. */
  bends: number;
  /** Intruder nodes + member nodes outside + overlapping sibling group rects. */
  groupViolations: number;
  /** A node's own label box touching an edge segment, its own glyph art, or a
   *  neighbouring node (icon shapes, cylinders, actors, BPMN gateways). */
  nodeLabelHits: number;
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

function crossPoint(a: Point, b: Point, c: Point, d: Point): Point {
  const t = orient(c, d, a) / (orient(c, d, a) - orient(c, d, b));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Length of overlap of two collinear segments (0 if not collinear/parallel). */
function collinearOverlap(a: Point, b: Point, c: Point, d: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const ux = dx / len, uy = dy / len;
  const off = (p: Point) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
  if (off(c) > 1 || off(d) > 1) return 0;
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

export function measureLayout(ir: DiagramIR): LayoutMetrics {
  const nodes = ir.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeGeometry = !SELF_DRAWN_EDGES.has(ir.type as string);
  const routed = edgeGeometry ? routeAllEdges(ir.edges ?? [], nodes) : new Map<string, Point[]>();

  let bends = 0;
  let gapSum = 0, gapN = 0;
  for (const e of ir.edges ?? []) {
    const pts = routed.get(e.id);
    if (!pts || pts.length < 2) continue;
    bends += pts.length - 2;
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

  let crossings = 0, edgeOverlaps = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i], q = segs[j];
      if (p.edge === q.edge) continue;
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
    const model = L ? { box: L.box, glyphs: L.glyphs } : innerLabelModel(n);
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
  let labelOverlaps = 0;
  if (edgeGeometry) {
    const routedEdges = (ir.edges ?? []).map((e) => (routed.has(e.id) ? { ...e, waypoints: routed.get(e.id) } : e));
    const placements = computeEdgeLabelPositions(routedEdges, byId, 0);
    const chips: Rect[] = [];
    for (const e of routedEdges) {
      const p = placements.get(e.id);
      if (p && e.label) chips.push(chipRect(p.x, p.y, e.label));
    }
    for (let i = 0; i < chips.length; i++) {
      for (const n of nodes) if (rectsOverlap(chips[i], nodeRect(n))) labelOverlaps++;
      for (let j = i + 1; j < chips.length; j++) if (rectsOverlap(chips[i], chips[j])) labelOverlaps++;
    }
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
    edgeNodeHits,
    labelOverlaps,
    bends,
    groupViolations: groupViolations(ir),
    endpointGap: gapN ? gapSum / gapN : 0,
    area: Math.round(w * h),
    aspectRatio: h > 0 ? Math.round((w / h) * 100) / 100 : 0,
  };
}
