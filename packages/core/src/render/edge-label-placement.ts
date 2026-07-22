// =============================================================================
// SelDiA — Edge Label Placement (Anti-Overlap)
// =============================================================================
// After layout and routing have placed every edge's waypoints, this pass
// assigns each edge label a position along its polyline that avoids:
//   1. Overlapping other edge labels
//
// The chip has fill-opacity:0.95 so node geometry underneath is legibly
// covered — penalising node overlap forced labels off their edges in dense
// flowcharts.  The only mandatory constraint is two labels on one spot.
//
// Candidates are sampled from every segment of the polyline at three
// fractional positions per segment.  The midpoint segment wins by a large
// margin; only when it overlaps another label does the algorithm shift to an
// adjacent segment (same edge, different spot).

import type { IREdge, IRNode } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';

// ── Label chip geometry ─────────────────────────────────────────────────────
/** Height of the background chip (SVG rect). */
const CHIP_H = 18;
/** Vertical padding: the chip sits above the line by this many px. */
const CHIP_PAD_Y = 2;
/** Extra horizontal padding beyond text width. */
const CHIP_PAD_X = 12;
/** Width per character (approximate, for the monospace-ish default font). */
const CHAR_W = 6.5;
/** Minimum chip width. */
const MIN_CHIP_W = 24;

function chipSize(label: string): { w: number; h: number } {
  const w = Math.max(MIN_CHIP_W, label.length * CHAR_W + CHIP_PAD_X);
  return { w, h: CHIP_H };
}

/** The bounding rect of a label chip centred at (cx, cy) where cy is the
 *  text baseline plus a small upward offset (the chip is drawn above the
 *  edge line). Returns the full chip box including the vertical offset. */
function chipRect(cx: number, cy: number, label: string): Rect {
  const { w, h } = chipSize(label);
  return {
    x: cx - w / 2,
    y: cy - CHIP_H - CHIP_PAD_Y, // chip is above the line point
    width: w,
    height: CHIP_H + CHIP_PAD_Y, // include the gap to the line
  };
}

// ── Overlap detection ───────────────────────────────────────────────────────

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** True when the chip at (cx, cy) overlaps any already-placed label. */
function overlapsAnyPlaced(
  cx: number,
  cy: number,
  label: string,
  placed: Array<{ cx: number; cy: number; label: string }>
): boolean {
  const cr = chipRect(cx, cy, label);
  for (const p of placed) {
    if (rectsOverlap(cr, chipRect(p.cx, p.cy, p.label))) return true;
  }
  return false;
}

/** True when the segment a→b intersects the rect (crude but sufficient:
 *  checks both endpoints-inside and edge crossings via the separating-axis
 *  style slab test on a densely sampled set of points). */
function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  // Quick reject: segment bbox vs rect.
  if (
    Math.max(a.x, b.x) < r.x ||
    Math.min(a.x, b.x) > r.x + r.width ||
    Math.max(a.y, b.y) < r.y ||
    Math.min(a.y, b.y) > r.y + r.height
  ) {
    return false;
  }
  // Liang–Barsky clip of the segment against the rect.
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

// ── Candidate generation ────────────────────────────────────────────────────

interface Candidate {
  x: number;
  y: number;
  seg: number; // which segment index (0-based)
  t: number; // where on the segment (0 = start, 1 = end)
  /** Perpendicular shift in chip-heights (0 = on the line). */
  offset: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Generate candidate positions along the edge's polyline. Samples every
 *  segment at 3 fractional positions, each additionally at small
 *  perpendicular offsets — sliding a chip just off the line keeps it visually
 *  attached to its edge, which beats jumping to a distant segment. */
function sampleCandidates(wps: Point[], pad: number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    // Skip segments shorter than the chip width — a label there would be
    // clipped or illegible.
    const segLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    if (segLen < MIN_CHIP_W) continue;
    // Unit perpendicular of the segment (for offset candidates).
    const px = -(b.y - a.y) / segLen;
    const py = (b.x - a.x) / segLen;
    for (const t of [0.3, 0.5, 0.7]) {
      const x = lerp(a.x, b.x, t) + pad;
      const y = lerp(a.y, b.y, t) + pad;
      for (const offset of [0, 1, -1]) {
        out.push({
          x: x + px * offset * (CHIP_H + 2),
          y: y + py * offset * (CHIP_H + 2),
          seg: i,
          t,
          offset,
        });
      }
    }
  }
  return out;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/** Score a candidate label position. Returns -Infinity if the position
 *  overlaps an already-placed label at any t-offset (avoidance is mandatory).
 *  Node overlap is NOT penalised — the chip has `fill-opacity:0.95` so it
 *  legibly covers whatever geometry sits underneath, and penalising node
 *  overlap forced labels off their edges in dense flowcharts.
 *  When no candidate on the identity segment is clean, the algorithm tries
 *  the adjacent segments (which are still on the same edge polyline). */
function scoreCandidate(
  c: Candidate,
  edgeMidSeg: number,
  mid: Point,
  placed: Array<{ cx: number; cy: number; label: string }>,
  label: string,
  foreignSegs: Array<[Point, Point]>
): number {
  // Overlap with an already-placed label is unconditional — two labels
  // piled on one spot is always unreadable.
  if (overlapsAnyPlaced(c.x, c.y, label, placed)) return -Infinity;

  let s = 0;

  // Penalise a chip that another edge's line cuts straight through — the
  // strike-through makes the text unreadable. Soft (not -Infinity) so a
  // crossing is still preferred over stranding the label far away.
  const cr = chipRect(c.x, c.y, label);
  for (const [sa, sb] of foreignSegs) {
    if (segmentIntersectsRect(sa, sb, cr)) {
      s -= 150;
      break;
    }
  }

  // Strong preference for the midpoint segment.
  const segDist = Math.abs(c.seg - edgeMidSeg);
  s -= segDist * 100;
  // Within a segment, prefer the centre.
  s -= Math.abs(c.t - 0.5) * 10;
  // A perpendicular nudge (one chip-height off the line) is far cheaper
  // than moving segments — the label stays visibly attached to its edge.
  s -= Math.abs(c.offset) * 20;
  // Absolute-distance penalty from the polyline midpoint. Segment index is
  // too coarse on long routes: an "adjacent" segment can be hundreds of px
  // away, leaving the label impossible to relate back to its edge.
  const d = Math.sqrt((c.x - mid.x) ** 2 + (c.y - mid.y) ** 2);
  s -= d * 0.6;

  return s;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface LabelPlacement {
  x: number;
  y: number;
}

/** Compute an optimal (cx, cy) for every labeled edge's text chip so labels
 *  don't overlap each other or any node box. Edges without a label or with
 *  fewer than 2 waypoints are omitted from the result.
 *
 *  `pad` is the diagram-level padding applied to all coordinates. */
export function computeEdgeLabelPositions(
  edges: IREdge[],
  nodeById: Map<string, IRNode>,
  pad: number
): Map<string, LabelPlacement> {
  const placements = new Map<string, LabelPlacement>();
  const placed: Array<{ cx: number; cy: number; label: string }> = [];

  // Process edges with labels, sorted so shorter labels (less intrusive)
  // get first pick — they are more likely to fit in tight spots.
  const labeled = edges
    .filter((e) => e.label && e.waypoints && e.waypoints.length >= 2)
    .map((e) => ({
      edge: e,
      wps: e.waypoints!,
      chipW: chipSize(e.label!).w,
    }))
    .sort((a, b) => a.chipW - b.chipW);

  // Padded segments of every routed edge, keyed by edge id, so a candidate
  // chip can be checked against the lines of OTHER edges crossing it.
  const segsByEdge = new Map<string, Array<[Point, Point]>>();
  for (const e of edges) {
    if (!e.waypoints || e.waypoints.length < 2) continue;
    const segs: Array<[Point, Point]> = [];
    for (let i = 0; i < e.waypoints.length - 1; i++) {
      const a = e.waypoints[i], b = e.waypoints[i + 1];
      segs.push([
        { x: a.x + pad, y: a.y + pad },
        { x: b.x + pad, y: b.y + pad },
      ]);
    }
    segsByEdge.set(e.id, segs);
  }

  for (const { edge, wps } of labeled) {
    const foreignSegs: Array<[Point, Point]> = [];
    for (const [id, segs] of segsByEdge) {
      if (id !== edge.id) foreignSegs.push(...segs);
    }
    const candidates = sampleCandidates(wps, pad);
    if (candidates.length === 0) {
      // No usable segment — fall back to the old midpoint logic.
      const mid = wps[Math.floor((wps.length - 1) / 2)];
      const next = wps[Math.floor((wps.length - 1) / 2) + 1] || mid;
      placements.set(edge.id, {
        x: (mid.x + next.x) / 2 + pad,
        y: (mid.y + next.y) / 2 + pad,
      });
      continue;
    }

    const midSeg = Math.floor((wps.length - 1) / 2);
    // Geometric midpoint of the mid segment — the anchor labels should stay
    // near, expressed in the same padded coordinates as the candidates.
    const ma = wps[midSeg], mb = wps[Math.min(midSeg + 1, wps.length - 1)];
    const mid: Point = { x: (ma.x + mb.x) / 2 + pad, y: (ma.y + mb.y) / 2 + pad };

    let best: Candidate | null = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      const sc = scoreCandidate(c, midSeg, mid, placed, edge.label!, foreignSegs);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }

    if (best) {
      placements.set(edge.id, { x: best.x, y: best.y });
      placed.push({ cx: best.x, cy: best.y, label: edge.label! });
    } else {
      // Every candidate overlaps a placed label. A slightly-overlapping chip
      // at the midpoint is still more readable than a label stranded far from
      // its edge — place at the midpoint and accept the collision.
      placements.set(edge.id, { x: mid.x, y: mid.y });
      placed.push({ cx: mid.x, cy: mid.y, label: edge.label! });
    }
  }

  return placements;
}
