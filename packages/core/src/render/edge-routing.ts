// =============================================================================
// SelDiA — Edge Routing Geometry
// =============================================================================
// Turning a layout engine's raw edge points into a polyline that actually meets
// its two nodes cleanly.
//
// The layout engines (dagre, elk) report endpoints that sit on the node border,
// but those endpoints encode *their* router's approach direction — for a
// top-to-bottom rank, dagre anchors on the target's top edge because its own
// route arrives vertically. When we re-shape the route (the ORTHOGONAL elbow
// below), we may arrive from a different direction, and an endpoint anchored for
// a vertical approach then makes the final segment run *along* the target's top
// border instead of into it. That is what drew arrowheads buried inside node
// headers and lines lying across boxes.
//
// So we don't reuse their endpoints. We build the route between node *centres*
// and then clip it back to each node's border. Anchor and approach direction
// then agree by construction, for any relative placement of the two nodes.
// =============================================================================

import { DS } from './design-system.js';
import { iconLabelLayout } from './node-label-geometry.js';
import { clipStartToShape, clipEndToShape, isBoxShape } from './shape-clip.js';
export { clipToShape } from './shape-clip.js';
import { EdgeRouting, type IRNode, type IREdge, type IRGroup } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';

/** Gap left between a node's border and the edge that touches it, so an
 *  arrowhead points at the node rather than overlapping its stroke. */
export const EDGE_GAP = 3;

export function centerOf(n: IRNode): Point {
  return { x: n.position.x + n.size.width / 2, y: n.position.y + n.size.height / 2 };
}

/** Where a pinned (`via`) route attaches to node `n`, given the route's
 *  nearest bend `p`: level with the bend when it sits beside the node (a
 *  square horizontal / vertical exit), else the centre. Attaching to the
 *  centre made the first leg slightly slanted whenever the bend was
 *  off-centre (fanned ports), so a frozen route redrew a pixel or two off. */
export function squareAnchor(n: IRNode, p: Point): Point {
  const c = centerOf(n);
  const { x, y } = n.position, { width: w, height: h } = n.size;
  const inY = p.y > y && p.y < y + h, inX = p.x > x && p.x < x + w;
  if (inY && !inX) return { x: c.x, y: p.y };
  if (inX && !inY) return { x: p.x, y: c.y };
  return c;
}

/** The node's box, grown by `gap` on every side. */
export function nodeRect(n: IRNode, gap = 0): Rect {
  return {
    x: n.position.x - gap,
    y: n.position.y - gap,
    width: n.size.width + gap * 2,
    height: n.size.height + gap * 2,
  };
}

/** The box edges must respect: the node, plus — for network devices, whose
 *  label sits BELOW the icon — that label, so a route leaving the bottom stops
 *  under the text instead of striking through it. */
export function routeRect(n: IRNode, gap = 0): Rect {
  const r = nodeRect(n, gap);
  if (!(n.data as any)?.networkKind) return r;
  const lb = iconLabelLayout(n)?.box;
  if (!lb) return r;
  const x0 = Math.min(r.x, lb.x - gap), y0 = Math.min(r.y, lb.y - gap);
  const x1 = Math.max(r.x + r.width, lb.x + lb.width + gap), y1 = Math.max(r.y + r.height, lb.y + lb.height + gap);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** True when the line segment `a → b` intersects the *interior* of rectangle
 *  `r` (inflated by `gap`). Border-grazing (segment lies exactly on an edge)
 *  is NOT treated as intersection — we only care about actual crosscuts. Uses
 *  the Liang-Barsky clipping algorithm for axis-aligned boxes. */
export function lineSegmentIntersectsRect(a: Point, b: Point, r: Rect, gap = 0): boolean {
  const E = 1e-6;
  const rx = r.x - gap, ry = r.y - gap;
  const rw = r.width + gap * 2, rh = r.height + gap * 2;
  const dx = b.x - a.x, dy = b.y - a.y;

  // If both endpoints are strictly inside the inflated rect, the segment
  // is embedded — treat as intersection (shouldn't happen for centre-to-centre
  // routing between distinct nodes, but guard anyway).
  if (
    a.x > rx + E && a.x < rx + rw - E && a.y > ry + E && a.y < ry + rh - E &&
    b.x > rx + E && b.x < rx + rw - E && b.y > ry + E && b.y < ry + rh - E
  ) return true;

  // If the segment is horizontal (dy ≈ 0) and lies exactly on the top or bottom
  // edge, or vertical (dx ≈ 0) and lies exactly on the left or right edge, it
  // is grazing — not a crosscut.
  if (Math.abs(dy) < E) {
    if (Math.abs(a.y - ry) < E || Math.abs(a.y - (ry + rh)) < E) return false;
  }
  if (Math.abs(dx) < E) {
    if (Math.abs(a.x - rx) < E || Math.abs(a.x - (rx + rw)) < E) return false;
  }

  // Parametric clip: t values where the segment enters/exits each axis.
  let t0 = 0, t1 = 1;

  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rx, rx + rw - a.x, a.y - ry, ry + rh - a.y];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < E) {
      // Parallel to this edge — if strictly outside, no intersection.
      if (q[i] < -E) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        t0 = Math.max(t0, t);
      } else {
        t1 = Math.min(t1, t);
      }
      if (t0 > t1 + E) return false;
    }
  }
  // Strict interior intersection: exclude degenerate touches where the
  // intersection interval has negligible width or only touches at endpoints.
  return t1 - t0 > 1e-4 && t0 < 1 - E && t1 > E;
}

/** True when any segment of `pts` intersects any `obstacle` node's rectangle
 *  (inflated by `gap`). */
export function polylineIntersectsAnyNode(
  pts: Point[],
  obstacles: IRNode[],
  gap = EDGE_GAP
): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const obs of obstacles) {
      if (lineSegmentIntersectsRect(pts[i], pts[i + 1], routeRect(obs, 0), gap)) return true;
    }
  }
  return false;
}

/** Where the segment `a → b` first crosses the border of `r`, assuming `a` is
 *  inside `r` and `b` is outside it. Returns null if they don't cross. */
export function segmentExit(a: Point, b: Point, r: Rect): Point | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const hits: Array<{ t: number; p: Point }> = [];
  const E = 1e-6;

  if (Math.abs(dx) > E) {
    for (const X of [r.x, r.x + r.width]) {
      const t = (X - a.x) / dx;
      if (t <= 0 || t > 1) continue;
      const y = a.y + t * dy;
      if (y >= r.y - E && y <= r.y + r.height + E) hits.push({ t, p: { x: X, y } });
    }
  }
  if (Math.abs(dy) > E) {
    for (const Y of [r.y, r.y + r.height]) {
      const t = (Y - a.y) / dy;
      if (t <= 0 || t > 1) continue;
      const x = a.x + t * dx;
      if (x >= r.x - E && x <= r.x + r.width + E) hits.push({ t, p: { x, y: Y } });
    }
  }
  if (!hits.length) return null;
  hits.sort((m, n) => m.t - n.t);
  return hits[0].p;
}

/** Drop the leading points that fall inside `r` and land the polyline exactly
 *  on its border. Unchanged if it already starts outside, or if every point is
 *  inside (degenerate — overlapping nodes; better a stray line than none). */
export function clipStart(pts: Point[], r: Rect): Point[] {
  let i = 0;
  while (i < pts.length && pointInRect(pts[i], r)) i++;
  if (i === 0 || i >= pts.length) return pts;
  const hit = segmentExit(pts[i - 1], pts[i], r);
  return [hit ?? pts[i], ...pts.slice(i)];
}

/** `clipStart` from the other end — lands the polyline on `r`'s border. */
export function clipEnd(pts: Point[], r: Rect): Point[] {
  return clipStart([...pts].reverse(), r).reverse();
}

/** A right-angle route between two points: one jog, bending on the axis the
 *  run is longest along, so it matches the direction the diagram flows (a TB
 *  layout is taller than wide between ranks, an LR layout the reverse).
 *
 *  `bendOffset` shifts the bend line off the midpoint. Each edge computes its
 *  own midpoint from its own endpoints, so two edges fanned at one end but
 *  sharing (or nearly sharing) the other still bend at almost the same line
 *  and read as one merged stroke until right before the shared node. Passing
 *  a per-slot offset (see `fanBendOffset` below) keeps parallel edges visibly
 *  parallel along their full run, not just at the fanned endpoint. */
export function orthogonalElbow(a: Point, b: Point, bendOffset = 0): Point[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return [a, b]; // already axis-aligned
  if (Math.abs(dy) >= Math.abs(dx)) {
    const midY = (a.y + b.y) / 2 + bendOffset;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }
  const midX = (a.x + b.x) / 2 + bendOffset;
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
}

/** The "other" orthogonal elbow: bends on the *shorter* axis instead of the
 *  longer one. Used as a fallback when the primary elbow crosses an obstacle.
 *  Same `bendOffset` semantics as `orthogonalElbow`. */
export function orthogonalElbowAlt(a: Point, b: Point, bendOffset = 0): Point[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return [a, b];
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Primary would bend vertically; alt bends horizontally.
    const midX = (a.x + b.x) / 2 + bendOffset;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  // Primary would bend horizontally; alt bends vertically.
  const midY = (a.y + b.y) / 2 + bendOffset;
  return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
}

/** Bend-line offset for one edge in a fan group, so members of the same fan
 *  stay evenly spaced along their shared middle run instead of converging
 *  back onto one line between their two fanned endpoints. */
const BEND_FAN_SPREAD = 14;
function fanBendOffset(fan: Fan): number {
  const count = Math.max(fan.srcCount, fan.tgtCount);
  if (count <= 1) return 0;
  const index = fan.srcCount >= fan.tgtCount ? fan.srcIndex : fan.tgtIndex;
  const step = Math.min(BEND_FAN_SPREAD, BEND_FAN_SPREAD * 4 / count);
  return (index - (count - 1) / 2) * step;
}

/** Collapse consecutive points that round to the same spot — they carry no
 *  shape but do give the arrowhead a zero-length segment to aim along. */
export function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  return out;
}

// ── Fanning ──────────────────────────────────────────────────────────────────
// Every edge routed centre-to-centre anchors on the same border midpoint, so
// several edges meeting at one node collapse onto a single line and pile their
// arrowheads on one spot. A fan spreads each edge's anchor along the border it
// meets, ordered so the fan doesn't cross itself.

/** This edge's slot among the edges sharing each of its endpoints. */
export interface Fan {
  srcIndex: number;
  srcCount: number;
  tgtIndex: number;
  tgtCount: number;
}

const NO_FAN: Fan = { srcIndex: 0, srcCount: 1, tgtIndex: 0, tgtCount: 1 };

/** Widest gap between fanned anchors. Kept well inside the border so a fanned
 *  anchor still falls within the node and the clip below still has something
 *  to trim. */
const FAN_SPREAD = 22;

/** The anchor for one edge on `n`'s border: the centre, shifted along the axis
 *  perpendicular to the approach so the slots sit side by side. */
function fanAnchor(n: IRNode, index: number, count: number, horizontalApproach: boolean): Point {
  const c = centerOf(n);
  if (count <= 1) return c;
  const span = horizontalApproach ? n.size.height : n.size.width;
  const step = Math.min(FAN_SPREAD, (span * 0.6) / count);
  const off = (index - (count - 1) / 2) * step;
  return horizontalApproach ? { x: c.x, y: c.y + off } : { x: c.x + off, y: c.y };
}

/** True if the edges in `group` mostly run left/right from `self` rather than
 *  up/down — i.e. they meet its vertical borders, so the fan spreads in Y. */
function approachIsHorizontal(self: IRNode, farEnds: IRNode[]): boolean {
  const c = centerOf(self);
  let sx = 0, sy = 0;
  for (const f of farEnds) {
    const fc = centerOf(f);
    sx += Math.abs(fc.x - c.x);
    sy += Math.abs(fc.y - c.y);
  }
  return sx >= sy;
}

/** Assign every edge its fan slot at both endpoints. Edges touching the same
 *  node border are spread apart whether they share that node as a source, as
 *  a target, or split between the two — an edge arriving at a node's top and
 *  a different edge leaving from that same top both anchor at the node's bare
 *  centre otherwise, so their paths cross right at the border even though
 *  neither is "fanned" with the other in the traditional same-direction
 *  sense. */
export function computeFans(edges: IREdge[], nodeById: Map<string, IRNode>): Map<string, Fan> {
  const fans = new Map<string, Fan>();
  for (const e of edges) fans.set(e.id, { ...NO_FAN });

  type Touch = { edge: IREdge; end: 'source' | 'target' };
  const touchesByNode = new Map<string, Touch[]>();
  for (const e of edges) {
    for (const end of ['source', 'target'] as const) {
      const key = end === 'source' ? e.sourceId : e.targetId;
      const list = touchesByNode.get(key);
      if (list) list.push({ edge: e, end });
      else touchesByNode.set(key, [{ edge: e, end }]);
    }
  }

  for (const [nodeId, touches] of touchesByNode) {
    const self = nodeById.get(nodeId);
    if (!self || touches.length < 2) continue;
    const farOf = (t: Touch) => nodeById.get(t.end === 'source' ? t.edge.targetId : t.edge.sourceId);
    const fars = touches.map(farOf).filter((n): n is IRNode => !!n);
    if (fars.length < 2) continue;

    const horizontal = approachIsHorizontal(self, fars);
    // Order the slots by where the far end sits along the fan axis, so the
    // lines stay parallel instead of crossing over each other.
    const ordered = [...touches].sort((a, b) => {
      const fa = farOf(a), fb = farOf(b);
      if (!fa || !fb) return 0;
      const ca = centerOf(fa), cb = centerOf(fb);
      return horizontal ? ca.y - cb.y : ca.x - cb.x;
    });
    ordered.forEach((t, i) => {
      const f = fans.get(t.edge.id)!;
      if (t.end === 'source') { f.srcIndex = i; f.srcCount = ordered.length; }
      else { f.tgtIndex = i; f.tgtCount = ordered.length; }
    });
  }
  return fans;
}

// ── Grid-based Manhattan A* router ────────────────────────────────────────────
// A native reimplementation of the JointJS manhattan router algorithm:
// grid generation from obstacle boundaries → A* search on the visibility graph
// → path simplification (colinear collapse).
//
// JointJS's manhattan router uses the same core approach (grid of "interesting"
// coordinates, A* through orthogonal steps), but is tightly coupled to its
// geometry library and Graph model. This version works directly on SelDiA's
// Point / Rect / IRNode types with zero new dependencies.

/** Build the sorted set of "interesting" coordinates for one axis: the obstacle
 *  edges on that axis (inflated by `gap`), plus the source and target anchor
 *  coordinates. Only the requested axis's boundaries are included — mixing in
 *  the other axis's coordinates inflates the A* search space without adding
 *  any route the correct grid cannot express. */
function gridLines(
  obstacles: IRNode[],
  gap: number,
  extra: number[],
  axis: 'x' | 'y'
): number[] {
  const s = new Set<number>();
  for (const o of obstacles) {
    const r = routeRect(o, gap);
    if (axis === 'x') {
      s.add(r.x);
      s.add(r.x + r.width);
    } else {
      s.add(r.y);
      s.add(r.y + r.height);
    }
  }
  for (const v of extra) s.add(v);
  return [...s].sort((p, q) => p - q);
}

/** A point on the grid, identified by its index pair. */
interface GridVertex {
  ix: number;
  iy: number;
  x: number;
  y: number;
}

function vertexKey(v: GridVertex): string {
  return `${v.ix}:${v.iy}`;
}

/** Clearance gap for the A* visibility grid — larger than EDGE_GAP so routes
 *  stay well away from node borders instead of "walking" along them. */
const GRID_GAP = EDGE_GAP + 12;

/** True when a horizontal segment at `y` from `x0` to `x1` doesn't intersect
 *  any obstacle. */
function hClear(x0: number, x1: number, y: number, rects: Rect[]): boolean {
  const E = 1e-4;
  for (const r of rects) {
    // Segment must not cross the obstacle's interior.
    // If the segment's y is strictly above or below the obstacle, it's clear.
    if (y <= r.y + E || y >= r.y + r.height - E) continue;
    // Check horizontal overlap: does [x0,x1] intersect (r.x, r.x+r.width)?
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    if (right > r.x + E && left < r.x + r.width - E) return false;
  }
  return true;
}

/** True when a vertical segment at `x` from `y0` to `y1` doesn't intersect
 *  any obstacle. */
function vClear(x: number, y0: number, y1: number, rects: Rect[]): boolean {
  const E = 1e-4;
  for (const r of rects) {
    if (x <= r.x + E || x >= r.x + r.width - E) continue;
    const top = Math.min(y0, y1), bot = Math.max(y0, y1);
    if (bot > r.y + E && top < r.y + r.height - E) return false;
  }
  return true;
}

/** Manhattan distance heuristic for A*. */
function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Minimal binary min-heap over A* nodes, keyed on `f`. Replaces the previous
 *  sort-then-shift open set, which was O(V² log V) overall. */
class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly key: (t: T) => number) {}
  get size(): number { return this.items.length; }
  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key(a[p]) <= this.key(a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l;
        if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Extra cost per px of route inside a group that owns neither endpoint: high
 *  enough to detour around the box, finite so a route through it still exists. */
const FOREIGN_GROUP_COST = 4;

/** Length of the axis-aligned step a->b that lies inside any `rects` interior. */
function foreignOverlap(a: Point, b: Point, rects: Rect[]): number {
  let len = 0;
  for (const r of rects) {
    if (a.y === b.y) {
      if (a.y <= r.y || a.y >= r.y + r.height) continue;
      len += Math.max(0, Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x));
    } else {
      if (a.x <= r.x || a.x >= r.x + r.width) continue;
      len += Math.max(0, Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y));
    }
  }
  return len;
}

/** Rects of the groups that contain neither endpoint (directly or through a
 *  nested group), i.e. boxes the edge has no business crossing. */
function foreignGroupRects(groups: IRGroup[] | undefined, srcId?: string, tgtId?: string): Rect[] {
  if (!groups?.length) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const holds = (g: IRGroup, id: string, seen = new Set<string>()): boolean => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return g.childNodeIds.includes(id) || (g.childGroupIds ?? []).some((c) => { const cg = byId.get(c); return !!cg && holds(cg, id, seen); });
  };
  const out: Rect[] = [];
  for (const g of groups) {
    if (!g.position || !g.size || !g.size.width) continue;
    if ((srcId && holds(g, srcId)) || (tgtId && holds(g, tgtId))) continue;
    out.push({ x: g.position.x, y: g.position.y, width: g.size.width, height: g.size.height });
  }
  return out;
}

/** A* search on the visibility grid. Returns the shortest orthogonal path from
 *  `src` to `tgt` that avoids all `obstacles`, or `null` if unreachable. */
function manhattanRoute(
  src: Point,
  tgt: Point,
  obstacles: IRNode[],
  gap: number,
  bendBias = 0,
  foreign: Rect[] = []
): Point[] | null {
  const rects = obstacles.map((o) => routeRect(o, gap));
  const xs = gridLines(obstacles, gap, [src.x, tgt.x], 'x');
  const ys = gridLines(obstacles, gap, [src.y, tgt.y], 'y');

  // Find source and target grid indices.
  let srcIx = -1, srcIy = -1, tgtIx = -1, tgtIy = -1;
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i] - src.x) < 0.5) srcIx = i;
    if (Math.abs(xs[i] - tgt.x) < 0.5) tgtIx = i;
  }
  for (let i = 0; i < ys.length; i++) {
    if (Math.abs(ys[i] - src.y) < 0.5) srcIy = i;
    if (Math.abs(ys[i] - tgt.y) < 0.5) tgtIy = i;
  }
  if (srcIx < 0 || srcIy < 0 || tgtIx < 0 || tgtIy < 0) return null;

  // A* state.
  const srcV: GridVertex = { ix: srcIx, iy: srcIy, x: xs[srcIx], y: ys[srcIy] };
  const tgtV: GridVertex = { ix: tgtIx, iy: tgtIy, x: xs[tgtIx], y: ys[tgtIy] };

  interface AStarNode {
    v: GridVertex;
    g: number;
    f: number;
    parent: AStarNode | null;
  }

  const open = new MinHeap<AStarNode>((n) => n.f);
  // Best known g-score per vertex, so a stale heap entry (superseded by a
  // cheaper push for the same vertex) can be recognised and skipped on pop
  // instead of being popped as if it were still the best route.
  const bestG = new Map<string, number>();
  open.push({ v: srcV, g: 0, f: manhattan(src, tgt), parent: null });
  bestG.set(vertexKey(srcV), 0);
  const closed = new Set<string>();
  closed.add(vertexKey(srcV));

  // Direction vectors: right, down, left, up
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  while (open.size > 0) {
    const cur = open.pop()!;
    // Stale entry: a cheaper route to this vertex was pushed after this one.
    if (cur.g > (bestG.get(vertexKey(cur.v)) ?? Infinity)) continue;

    if (cur.v.ix === tgtIx && cur.v.iy === tgtIy) {
      // Reconstruct path.
      const path: Point[] = [];
      let node: AStarNode | null = cur;
      while (node) {
        path.unshift({ x: node.v.x, y: node.v.y });
        node = node.parent;
      }
      return path;
    }

    for (const [dx, dy] of dirs) {
      const nix = cur.v.ix + dx, niy = cur.v.iy + dy;
      if (nix < 0 || nix >= xs.length || niy < 0 || niy >= ys.length) continue;
      const next: GridVertex = { ix: nix, iy: niy, x: xs[nix], y: ys[niy] };
      const key = vertexKey(next);
      if (closed.has(key)) continue;

      // Check if the segment from cur to next is clear of obstacles.
      let clear: boolean;
      if (dx !== 0) {
        // Horizontal move.
        clear = hClear(cur.v.x, next.x, cur.v.y, rects);
      } else {
        // Vertical move.
        clear = vClear(cur.v.x, cur.v.y, next.y, rects);
      }
      if (!clear) continue;

      const stepCost = Math.abs(next.x - cur.v.x) + Math.abs(next.y - cur.v.y)
        + (foreign.length ? FOREIGN_GROUP_COST * foreignOverlap(cur.v, next, foreign) : 0);
      const ng = cur.g + stepCost;
      // Small bias per-edge to break ties between equally-short paths,
      // spreading fanned edges apart instead of routing them identically.
      const nf = ng + manhattan(next, tgt) + bendBias * 0.01;

      // Check if a better path to this vertex is already known.
      const existingG = bestG.get(key);
      if (existingG === undefined || ng < existingG) {
        bestG.set(key, ng);
        open.push({ v: next, g: ng, f: nf, parent: cur });
        closed.add(key);
      }
    }
  }

  return null; // no path found
}

/** Collapse a polyline by removing intermediate points that lie on the same
 *  straight line as their neighbors (colinear with a tolerance). */
function simplifyPath(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = result[result.length - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    // Colinear if cross product ≈ 0.
    const cp = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (Math.abs(cp) > 1e-3) result.push(cur);
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/** Collect all nodes in `allNodes` except `src` and `tgt` (the edge's own
 *  endpoints). */
function obstaclesFor(
  allNodes: IRNode[] | undefined,
  src: IRNode | undefined,
  tgt: IRNode | undefined
): IRNode[] {
  if (!allNodes || allNodes.length === 0) return [];
  const exclude = new Set([src?.id, tgt?.id].filter(Boolean));
  return allNodes.filter((n) => !exclude.has(n.id));
}

/** Border-clip the start of a route to `n`: its outline, then (network devices)
 *  the label under the icon as well. */
function clipStartNode(pts: Point[], n: IRNode): Point[] {
  let out = isBoxShape(n) ? clipStart(pts, routeRect(n, EDGE_GAP)) : clipStartToShape(pts, n, EDGE_GAP);
  if (!isBoxShape(n) && (n.data as any)?.networkKind) out = clipStart(out, routeRect(n, EDGE_GAP));
  return out;
}
function clipEndNode(pts: Point[], n: IRNode): Point[] {
  return clipStartNode([...pts].reverse(), n).reverse();
}

/** Route an edge between two nodes: try the shortest clean path (straight →
 *  primary elbow → alternate elbow → detour), then clip to both borders.
 *  `raw` is the layout engine's point list, used as-is for non-orthogonal
 *  edges (its curve carries information we don't want to throw away) and
 *  ignored for orthogonal ones (see the file header).
 *
 *  `allNodes` (optional) — when provided (even as an empty array), the router
 *  uses obstacle-aware routing: straight line first, then elbows, then detour.
 *  When `undefined`, the original behaviour (always elbow for orthogonal) is
 *  preserved for backward compatibility. */
export function routeBetween(
  raw: Point[],
  orthogonal: boolean,
  src: IRNode | undefined,
  tgt: IRNode | undefined,
  fan: Fan = NO_FAN,
  allNodes?: IRNode[],
  groups?: IRGroup[]
): Point[] {
  let pts: Point[];
  if (orthogonal && src && tgt) {
    const a0 = centerOf(src), b0 = centerOf(tgt);
    const horizontal = Math.abs(b0.x - a0.x) > Math.abs(b0.y - a0.y);
    const a = fanAnchor(src, fan.srcIndex, fan.srcCount, horizontal);
    const b = fanAnchor(tgt, fan.tgtIndex, fan.tgtCount, horizontal);
    const bo = fanBendOffset(fan);

    if (allNodes !== undefined) {
      // Grid-based manhattan A* routing: always produces axis-aligned
      // orthogonal paths. The A* heuristic naturally prefers fewer bends
      // because the Manhattan distance metric equals the sum of axis
      // distances — the shortest orthogonal path IS the one with minimum
      // direction changes. When the two points are already axis-aligned
      // (same x or same y), the A* returns a single straight segment.
      const obstacles = obstaclesFor(allNodes, src, tgt);

      // Run the grid-based A* manhattan router.
      const route = manhattanRoute(a, b, obstacles, GRID_GAP, bo, foreignGroupRects(groups, src.id, tgt.id));
      if (route && route.length >= 2) {
        pts = simplifyPath(route);
      } else {
        // Fallback: if the grid router produces nothing (shouldn't happen in
        // a connected graph), use the primary elbow.
        pts = orthogonalElbow(a, b, bo);
      }
    } else {
      // Legacy behaviour: always orthogonal elbow (backward compatible).
      pts = orthogonalElbow(a, b, bo);
    }
  } else if (orthogonal) {
    pts = orthogonalElbow(raw[0], raw[raw.length - 1]);
  } else {
    pts = raw;
  }

  if (src) pts = clipStartNode(pts, src);
  if (tgt) pts = clipEndNode(pts, tgt);
  pts = dedupe(pts);
  return pts.length >= 2 ? pts : raw;
}

/** Distance a self-loop reaches out from its node. */
export const SELF_LOOP_OUT = 24;

/** Fixed orthogonal 4-segment loop for `a -> a`: leaves the lateral side at
 *  1/3 of its length, goes out, runs along, and re-enters at 2/3 (the arrowhead
 *  lands on the re-entry). Lateral side is right for TB, bottom for LR. */
export function selfLoopRoute(n: IRNode, side: 'right' | 'bottom'): Point[] {
  const { x, y } = n.position, { width: w, height: h } = n.size;
  if (side === 'right') {
    const xr = x + w, xo = xr + SELF_LOOP_OUT;
    return [{ x: xr, y: y + h / 3 }, { x: xo, y: y + h / 3 }, { x: xo, y: y + (2 * h) / 3 }, { x: xr, y: y + (2 * h) / 3 }];
  }
  const yb = y + h, yo = yb + SELF_LOOP_OUT;
  return [{ x: x + w / 3, y: yb }, { x: x + w / 3, y: yo }, { x: x + (2 * w) / 3, y: yo }, { x: x + (2 * w) / 3, y: yb }];
}

/** Border-clip a route's endpoints without re-routing anything in between —
 *  same final step every `routeBetween` branch applies, exposed standalone
 *  for a `via`-pinned edge, whose interior points
 *  are the user's own and must survive untouched. */
export function clipRouteToNodes(raw: Point[], src?: IRNode, tgt?: IRNode): Point[] {
  let pts = raw;
  if (src) pts = clipStartNode(pts, src);
  if (tgt) pts = clipEndNode(pts, tgt);
  pts = dedupe(pts);
  return pts.length >= 2 ? pts : raw;
}

/** A user-pinned route: the flat `[x1,y1,x2,y2,...]` list from the DSL's `via:`
 *  edge attribute, read as a style field that wins over anything layout would
 *  otherwise compute. Odd-length or empty arrays are treated as absent. */
export function manualEdgeRoute(edge: IREdge): Point[] | undefined {
  const via = edge.style?.via;
  if (!Array.isArray(via) || via.length < 4 || via.length % 2 !== 0) return undefined;
  const pts: Point[] = [];
  for (let i = 0; i < via.length; i += 2) pts.push({ x: via[i], y: via[i + 1] });
  return pts;
}

/** The single source of truth for the polyline the renderer draws for one edge
 *  (router + border clipping, or border-clipped `via` pins). */
export function routeEdgePolyline(
  edge: IREdge,
  wps: Point[],
  src?: IRNode,
  tgt?: IRNode,
  fan?: Fan,
  allNodes?: IRNode[],
  groups?: IRGroup[]
): Point[] {
  if (wps.length < 2) return wps;
  if (manualEdgeRoute(edge)) return clipRouteToNodes(wps, src, tgt);
  if (src && edge.sourceId === edge.targetId) return selfLoopRoute(src, (edge.data as any)?.loopSide === 'bottom' ? 'bottom' : 'right');
  // The layout engine (ELK) already produced an obstacle-aware route: keep it
  // and only trim the endpoints onto the node borders.
  if ((edge.data as any)?.exactEnds) return wps; // circuit wires end exactly on symbol pins
  if (edge.layoutRouted) return applyPortStubs(clipRouteToNodes(wps, src, tgt), allNodes);
  return applyPortStubs(routeBetween(wps, edge.routing === EdgeRouting.ORTHOGONAL, src, tgt, fan, allNodes, groups), allNodes);
}

const isH = (a: Point, b: Point) => Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
const isV = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;

/** Lengthen the first segment (leaving the source) and the last (arriving at
 *  the target) to at least `DS.portStub` where the route allows, so an arrow
 *  meets a diamond/ellipse head-on instead of skimming its side. A stub grows
 *  by sliding the first two bends along the stub's own direction; it is only
 *  applied when the shifted route stays orthogonal, keeps the following
 *  segment pointing the same way and does not newly cross a node. */
export function applyPortStubs(pts: Point[], allNodes?: IRNode[], stub = DS.portStub): Point[] {
  if (pts.length < 4) return pts;
  const growStart = (p: Point[]): Point[] => {
    const d0 = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    if (d0 >= stub || !((isH(p[0], p[1]) && isV(p[1], p[2])) || (isV(p[0], p[1]) && isH(p[1], p[2])))) return p;
    const ux = Math.sign(p[1].x - p[0].x), uy = Math.sign(p[1].y - p[0].y);
    const delta = stub - d0;
    // p2→p3 must stay pointing the same way along the stub axis after the slide.
    const along = (p[3].x - p[2].x) * ux + (p[3].y - p[2].y) * uy;
    if (along <= delta + 1) return p;
    const q = p.map((pt) => ({ ...pt }));
    for (const i of [1, 2]) { q[i].x += ux * delta; q[i].y += uy * delta; }
    if (allNodes && !polylineIntersectsAnyNode(p, allNodes, 0) && polylineIntersectsAnyNode(q, allNodes, 0)) return p;
    return q;
  };
  return growStart(growStart(pts).slice().reverse()).reverse();
}

/** Route every edge that has layout waypoints, exactly as the renderer does
 *  (fans computed across the whole edge set, all nodes as obstacles). */
export function routeAllEdges(edges: IREdge[], nodes: IRNode[], groups?: IRGroup[]): Map<string, Point[]> {
  // Layout scoring (`auto`, metrics) and the final render route the same geometry:
  // key on everything the router reads and share the result.
  const key = geometrySig(edges, nodes) + (groups?.length ? '#' + groups.map((g) => `${g.id},${g.position?.x},${g.position?.y},${g.size?.width},${g.size?.height},${g.childNodeIds.join('+')}`).join(';') : '');
  const hit = routeCache.get(key);
  if (hit) { routeCache.delete(key); routeCache.set(key, hit); return cloneRoutes(hit); }
  const out = routeAllEdgesUncached(edges, nodes, groups);
  routeCache.set(key, out);
  if (routeCache.size > 6) routeCache.delete(routeCache.keys().next().value as string);
  return cloneRoutes(out);
}
/** Fresh Point objects, so callers mutating a result never touch the cache. */
export function cloneRoutes(m: Map<string, Point[]>): Map<string, Point[]> {
  return new Map([...m].map(([id, pts]) => [id, pts.map((p) => ({ ...p }))]));
}
const routeCache = new Map<string, Map<string, Point[]>>();
/** Cheap structural signature of a laid-out graph (what routing and post-routing read). */
export function geometrySig(edges: IREdge[], nodes: IRNode[]): string {
  let s = '';
  for (const n of nodes) s += `${n.id},${n.shape},${n.position?.x},${n.position?.y},${n.size?.width},${n.size?.height};`;
  s += '|';
  for (const e of edges) {
    s += `${e.id},${e.sourceId},${e.targetId},${e.routing},${e.layoutRouted ? 1 : 0},${e.label ?? ''}`;
    if (e.data) { try { s += JSON.stringify(e.data); } catch { s += '?'; } }
    for (const p of e.waypoints ?? []) s += `,${p.x},${p.y}`;
    s += ';';
  }
  return s;
}
function routeAllEdgesUncached(edges: IREdge[], nodes: IRNode[], groups?: IRGroup[]): Map<string, Point[]> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fans = computeFans(edges, nodeById);
  const out = new Map<string, Point[]>();
  for (const e of edges) {
    const raw = e.waypoints || [];
    if (raw.length < 2) continue;
    out.set(e.id, routeEdgePolyline(e, raw, nodeById.get(e.sourceId), nodeById.get(e.targetId), fans.get(e.id), nodes, groups));
  }
  return out;
}

/** Side of `n` an end point `p` sits on. */
export function sideOf(n: IRNode, p: Point): 'T' | 'B' | 'L' | 'R' {
  const c = centerOf(n);
  const dx = (p.x - c.x) / (n.size.width / 2 || 1), dy = (p.y - c.y) / (n.size.height / 2 || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'B' : 'T');
}

/** Shapes whose outline has a single vertex on each axis side. */
const APEX_SHAPES = new Set(['diamond', 'circle', 'ellipse']);

/** Move the LAST point of `pts` onto the apex/vertex of `n` on the side the final
 *  segment arrives from, shifting the final segment (and the bend before it) to
 *  the node's centre line so the stub runs straight into the vertex. Only when
 *  the arrival is along an axis (segment orthogonal), the node is the only edge
 *  on that side (`fanned` false) and the arrival lies within the node span, keeps a stub of at
 *  least half DS.portStub and does not newly cut into a node. */
export function snapApexEnd(pts: Point[], n: IRNode | undefined, fanned: boolean, allNodes?: IRNode[]): Point[] {
  if (!n || fanned || pts.length < 2 || !APEX_SHAPES.has(String(n.shape))) return pts;
  const c = centerOf(n);
  const k = pts.length;
  const a = pts[k - 2], b = pts[k - 1];
  const vertical = isV(a, b), horizontal = isH(a, b);
  if (!vertical && !horizontal) return pts;
  const hw = n.size.width / 2, hh = n.size.height / 2;
  const off = vertical ? b.x - c.x : b.y - c.y;
  const limit = (vertical ? hw : hh) * 0.98;
  if (Math.abs(off) < 0.5 || Math.abs(off) > limit) return pts;
  const dir = vertical ? Math.sign(b.y - a.y) : Math.sign(b.x - a.x);
  const apex: Point = vertical
    ? { x: c.x, y: c.y - dir * (hh + EDGE_GAP) }
    : { x: c.x - dir * (hw + EDGE_GAP), y: c.y };
  const len = vertical ? Math.abs(apex.y - a.y) : Math.abs(apex.x - a.x);
  if ((vertical ? (apex.y - a.y) * dir : (apex.x - a.x) * dir) <= 0 || len < DS.portStub / 2) return pts;
  let q: Point[];
  if (k >= 3) {
    // The bend before the stub slides along the previous (perpendicular) segment.
    const prev = pts[k - 3];
    const slides = vertical ? isH(prev, a) : isV(prev, a);
    if (!slides) return pts;
    q = pts.map((p) => ({ ...p }));
    if (vertical) q[k - 2].x = c.x; else q[k - 2].y = c.y;
  } else {
    // Straight two-point route: jog at mid-length onto the centre line.
    const mid = vertical ? (a.y + apex.y) / 2 : (a.x + apex.x) / 2;
    q = vertical
      ? [a, { x: a.x, y: mid }, { x: c.x, y: mid }, apex]
      : [a, { x: mid, y: a.y }, { x: mid, y: c.y }, apex];
    q = q.map((p) => ({ ...p }));
  }
  q[q.length - 1] = apex;
  if (allNodes) {
    const others = allNodes.filter((o) => o.id !== n.id);
    if (polylineIntersectsAnyNode(q, others, 0) && !polylineIntersectsAnyNode(pts, others, 0)) return pts;
  }
  return dedupe(q);
}

/** Snap every route end that is the ONLY end on its side of a diamond / circle /
 *  ellipse onto that side's vertex (see snapApexEnd). Ends sharing a side stay
 *  where they are so they can fan along the slanted faces. */
export function snapApexes(routes: Map<string, Point[]>, nodes: IRNode[]): Map<string, Point[]> {
  const apexNodes = nodes.filter((n) => APEX_SHAPES.has(String(n.shape)));
  if (!apexNodes.length) return routes;
  const near = (n: IRNode, p: Point) => p.x >= n.position.x - 8 && p.x <= n.position.x + n.size.width + 8
    && p.y >= n.position.y - 8 && p.y <= n.position.y + n.size.height + 8;
  const count = new Map<string, number>();
  // The side an end belongs to follows the way the edge arrives (its last
  // segment's axis), not where the point lands on a slanted face.
  const sideKey = (n: IRNode, pts: Point[], end: 0 | 1): string => {
    const p = end ? pts[pts.length - 1] : pts[0], q = end ? pts[pts.length - 2] : pts[1];
    if (isV(p, q)) return `${n.id}:${q.y < p.y ? 'T' : 'B'}`;
    if (isH(p, q)) return `${n.id}:${q.x < p.x ? 'L' : 'R'}`;
    return `${n.id}:${sideOf(n, p)}`;
  };
  const hit = (pts: Point[], end: 0 | 1): IRNode | undefined => {
    const p = end ? pts[pts.length - 1] : pts[0];
    return apexNodes.find((n) => near(n, p));
  };
  for (const pts of routes.values()) for (const end of [0, 1] as const) {
    const n = hit(pts, end); if (!n) continue;
    const k = sideKey(n, pts, end);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out = new Map<string, Point[]>();
  for (const [id, pts0] of routes) {
    let pts = pts0;
    for (const end of [1, 0] as const) {
      const n = hit(pts, end); if (!n) continue;
      const k = sideKey(n, pts, end);
      if ((count.get(k) ?? 0) !== 1) continue;
      pts = end ? snapApexEnd(pts, n, false, nodes) : snapApexEnd([...pts].reverse(), n, false, nodes).reverse();
    }
    out.set(id, pts);
  }
  return out;
}
