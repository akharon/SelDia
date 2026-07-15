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

/** Route an edge between two nodes: shape it, then clip it to both borders.
 *  `raw` is the layout engine's point list, used as-is for non-orthogonal
 *  edges (its curve carries information we don't want to throw away) and
 *  ignored for orthogonal ones (see the file header). */
export function routeBetween(
  raw: Point[],
  orthogonal: boolean,
  src: IRNode | undefined,
  tgt: IRNode | undefined,
  fan: Fan = NO_FAN
): Point[] {
  let pts: Point[];
  if (orthogonal && src && tgt) {
    const a0 = centerOf(src), b0 = centerOf(tgt);
    const horizontal = Math.abs(b0.x - a0.x) > Math.abs(b0.y - a0.y);
    pts = orthogonalElbow(
      fanAnchor(src, fan.srcIndex, fan.srcCount, horizontal),
      fanAnchor(tgt, fan.tgtIndex, fan.tgtCount, horizontal),
      fanBendOffset(fan)
    );
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
