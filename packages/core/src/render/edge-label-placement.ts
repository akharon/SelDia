// =============================================================================
// SelDiA — Edge Label Placement (Anti-Overlap)
// =============================================================================
// After layout and routing have placed every edge's waypoints, this pass
// assigns each edge label a position along its polyline that avoids:
//   1. Overlapping other edge labels
//   2. Overlapping node boxes (including the edge's own endpoints)
//   3. Sitting on a segment that is too short to hold the chip
//
// Candidates are sampled from every segment of the polyline, not just the
// midpoint, so the label can shift to a quieter stretch of the route when
// two edges converge near the same spot.
// =============================================================================

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

function nodeRect(n: IRNode, pad: number): Rect {
  return {
    x: n.position.x + pad,
    y: n.position.y + pad,
    width: n.size.width,
    height: n.size.height,
  };
}

/** True when the chip at (cx, cy) overlaps any node's bounding box. */
function overlapsAnyNode(
  cx: number,
  cy: number,
  label: string,
  nodes: IRNode[],
  pad: number
): boolean {
  const cr = chipRect(cx, cy, label);
  for (const n of nodes) {
    if (rectsOverlap(cr, nodeRect(n, pad))) return true;
  }
  return false;
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

// ── Candidate generation ────────────────────────────────────────────────────

interface Candidate {
  x: number;
  y: number;
  seg: number; // which segment index (0-based)
  t: number; // where on the segment (0 = start, 1 = end)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Generate candidate positions along the edge's polyline. Samples every
 *  segment at 3 fractional positions so labels have freedom to shift. */
function sampleCandidates(wps: Point[], pad: number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    // Skip segments shorter than the chip width — a label there would be
    // clipped or illegible.
    const segLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    if (segLen < MIN_CHIP_W) continue;
    for (const t of [0.3, 0.5, 0.7]) {
      out.push({
        x: lerp(a.x, b.x, t) + pad,
        y: lerp(a.y, b.y, t) + pad,
        seg: i,
        t,
      });
    }
  }
  return out;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function scoreCandidate(
  c: Candidate,
  edgeMidSeg: number,
  placed: Array<{ cx: number; cy: number; label: string }>,
  nodes: IRNode[],
  pad: number,
  label: string,
  ownSrcId: string,
  ownTgtId: string
): number {
  let s = 0;

  // Strong preference for the midpoint segment — labels should only shift
  // when there is a genuine collision, not because a nearby node's box
  // brushes the chip.  Segment-distance penalty grows quickly so the
  // algorithm tries t-offsets on the mid segment before wandering away.
  const segDist = Math.abs(c.seg - edgeMidSeg);
  s -= segDist * 80;
  // Within a segment, prefer the centre.
  s -= Math.abs(c.t - 0.5) * 10;

  // Penalty for overlapping already-placed labels — significant but not
  // overwhelming, so a label can shift one segment to avoid a neighbour
  // rather than fleeing to the far end of the polyline.
  if (overlapsAnyPlaced(c.x, c.y, label, placed)) s -= 500;

  // Overlap with the edge's own source / target is expected (the label
  // sits between them).  Only penalise overlap with *other* nodes.
  const otherNodes = nodes.filter((n) => n.id !== ownSrcId && n.id !== ownTgtId);
  if (otherNodes.length > 0 && overlapsAnyNode(c.x, c.y, label, otherNodes, pad)) s -= 300;

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
  const allNodes = [...nodeById.values()];

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

  for (const { edge, wps } of labeled) {
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

    let best: Candidate | null = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      const sc = scoreCandidate(c, midSeg, placed, allNodes, pad, edge.label!, edge.sourceId, edge.targetId);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }

    if (best) {
      placements.set(edge.id, { x: best.x, y: best.y });
      placed.push({ cx: best.x, cy: best.y, label: edge.label! });
    }
  }

  return placements;
}
