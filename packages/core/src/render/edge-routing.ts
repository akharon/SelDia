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

import type { IRNode, IREdge } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';

/** Gap left between a node's border and the edge that touches it, so an
 *  arrowhead points at the node rather than overlapping its stroke. */
export const EDGE_GAP = 3;

export function centerOf(n: IRNode): Point {
  return { x: n.position.x + n.size.width / 2, y: n.position.y + n.size.height / 2 };
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
      if (lineSegmentIntersectsRect(pts[i], pts[i + 1], nodeRect(obs, 0), gap)) return true;
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

/** Build the sorted set of "interesting" coordinates for one axis: all obstacle
 *  edges (inflated by `gap`), plus source and target anchor coordinates. */
function gridLines(
  obstacles: IRNode[],
  gap: number,
  extra: number[]
): number[] {
  const s = new Set<number>();
  for (const o of obstacles) {
    const r = nodeRect(o, gap);
    s.add(r.x);
    s.add(r.x + r.width);
    s.add(r.y);
    s.add(r.y + r.height);
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
function hClear(x0: number, x1: number, y: number, obstacles: IRNode[], gap: number): boolean {
  const E = 1e-4;
  for (const o of obstacles) {
    const r = nodeRect(o, gap);
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
function vClear(x: number, y0: number, y1: number, obstacles: IRNode[], gap: number): boolean {
  const E = 1e-4;
  for (const o of obstacles) {
    const r = nodeRect(o, gap);
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

/** A* search on the visibility grid. Returns the shortest orthogonal path from
 *  `src` to `tgt` that avoids all `obstacles`, or `null` if unreachable. */
function manhattanRoute(
  src: Point,
  tgt: Point,
  obstacles: IRNode[],
  gap: number,
  bendBias = 0
): Point[] | null {
  const xs = gridLines(obstacles, gap, [src.x, tgt.x]);
  const ys = gridLines(obstacles, gap, [src.y, tgt.y]);

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

  const open: AStarNode[] = [{ v: srcV, g: 0, f: manhattan(src, tgt), parent: null }];
  const closed = new Set<string>();
  closed.add(vertexKey(srcV));

  // Direction vectors: right, down, left, up
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  while (open.length > 0) {
    // Pick lowest f-score.
    open.sort((p, q) => p.f - q.f);
    const cur = open.shift()!;

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
        clear = hClear(cur.v.x, next.x, cur.v.y, obstacles, gap);
      } else {
        // Vertical move.
        clear = vClear(cur.v.x, cur.v.y, next.y, obstacles, gap);
      }
      if (!clear) continue;

      const stepCost = Math.abs(next.x - cur.v.x) + Math.abs(next.y - cur.v.y);
      const ng = cur.g + stepCost;
      // Small bias per-edge to break ties between equally-short paths,
      // spreading fanned edges apart instead of routing them identically.
      const nf = ng + manhattan(next, tgt) + bendBias * 0.01;

      // Check if a better path to this vertex is already in open.
      const existing = open.find((n) => n.v.ix === nix && n.v.iy === niy);
      if (existing) {
        if (ng < existing.g) {
          existing.g = ng;
          existing.f = nf;
          existing.parent = cur;
        }
      } else {
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
  allNodes?: IRNode[]
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
      const route = manhattanRoute(a, b, obstacles, GRID_GAP, bo);
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

  if (src) pts = clipStart(pts, nodeRect(src, EDGE_GAP));
  if (tgt) pts = clipEnd(pts, nodeRect(tgt, EDGE_GAP));
  pts = dedupe(pts);
  return pts.length >= 2 ? pts : raw;
}
