// =============================================================================
// SelDiA — Edge Label Placement (Labels v2)
// =============================================================================
// After layout and routing have placed every edge's waypoints, this pass
// assigns each edge label a chip position ON its own edge.
//
// Candidates, in preference order: the midpoint of the longest segment, the
// midpoints of the other segments (longest first), 30%/70% of every segment,
// then spots near the source and the target end. Each spot is tried centred ON
// the line first (the chip background hides the line behind the text); if that
// is not clean it is offset to the side — ABOVE a horizontal segment, to the
// RIGHT of a vertical one.
//
// Hard rejects (each costs HARD, so a position with none always wins; when none
// is clean the least-bad one is taken):
//   - overlap with any node rect or icon-label glyph/box,
//   - the arrowhead zone (last ARROW_ZONE px of the own polyline),
//   - the source zone (first SOURCE_ZONE px of the own polyline),
//   - another edge's chip,
//   - another edge's segment (strike-through),
//   - a group title band (top GROUP_BAND px of each group).
// Soft cost: distance to the own segment, then candidate rank.
//
// When even the best spot is more than LEADER_DIST px from the own polyline
// the result carries a `leader` so the renderer draws a dashed hairline tying
// the chip back to its edge.
//
// RESULT SHAPE (consumed by engine.ts):
//   LabelPlacement { x, y, leader? }
//   - (x, y) is the CENTRE of the chip, in padded diagram coordinates. Draw the
//     chip rect from chipRect(x, y, label) and the text with
//     text-anchor="middle" dominant-baseline="central" at (x, y) (multi-line
//     labels: first line at chipRect.y + padY + lineHeight/2).
//   - leader = { from, to } in the same padded coordinates: `from` is the
//     nearest point on the edge polyline, `to` the nearest point on the chip
//     border. Draw as a dashed hairline (DS.stroke.hairline) below the chip.

import type { IREdge, IRGroup, IRNode } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';
import { measureLabel } from '../layout/text-measure.js';
import { DS } from './design-system.js';
import { iconLabelLayout } from './node-label-geometry.js';

// ── Label chip geometry (single source of truth) ───────────────────────────
/** Font size of edge labels. */
export const EDGE_LABEL_FONT = DS.fontSize.meta;
/** Minimum chip width. */
const MIN_CHIP_W = 24;

const ARROW_ZONE = 14;
const SOURCE_ZONE = 8;
const GROUP_BAND = 30;
const LEADER_DIST = 16;
const HARD = 1000;

/** Chip size: measured label text plus DS.chip padding. Shared by placement,
 *  rendering and the metrics so they can never drift apart. */
export function chipSize(label: string): { w: number; h: number } {
  const m = measureLabel(label, EDGE_LABEL_FONT);
  return {
    w: Math.max(MIN_CHIP_W, Math.ceil(m.width + 2 * DS.chip.padX)),
    h: m.height + 2 * DS.chip.padY,
  };
}

/** The bounding rect of a label chip CENTRED at (cx, cy). */
export function chipRect(cx: number, cy: number, label: string): Rect {
  const { w, h } = chipSize(label);
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

// ── Geometry helpers ────────────────────────────────────────────────────────

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
}

/** Liang–Barsky: does segment a→b touch the rect? */
function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (
    Math.max(a.x, b.x) < r.x || Math.min(a.x, b.x) > r.x + r.width ||
    Math.max(a.y, b.y) < r.y || Math.min(a.y, b.y) > r.y + r.height
  ) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, a.x - r.x], [dx, r.x + r.width - a.x], [-dy, a.y - r.y], [dy, r.y + r.height - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

type Seg = [Point, Point];

/** The first (fromStart) or last `len` px of a polyline, as segments. */
function zoneSegs(pts: Point[], len: number, fromStart: boolean): Seg[] {
  const out: Seg[] = [];
  let left = len;
  const n = pts.length;
  for (let k = 0; k < n - 1 && left > 0; k++) {
    const a = fromStart ? pts[k] : pts[n - 1 - k];
    const b = fromStart ? pts[k + 1] : pts[n - 2 - k];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-6) continue;
    const f = Math.min(1, left / l);
    out.push([a, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }]);
    left -= l;
  }
  return out;
}

/** Distance from a point to a rect (0 inside). */
function distToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** Nearest point on the polyline (sampled every 2px) to the rect, and the distance. */
function nearestOnPolyline(pts: Point[], r: Rect): { p: Point; d: number } {
  let best: Point = pts[0], bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(l / 2));
    for (let s = 0; s <= steps; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
      const d = distToRect(p, r);
      if (d < bd) { bd = d; best = p; }
    }
  }
  return { p: best, d: bd };
}

function pointAtArc(pts: Point[], s: number): { p: Point; u: Point } {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-6) continue;
    if (acc + l >= s || i === pts.length - 2) {
      const f = Math.max(0, Math.min(1, (s - acc) / l));
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, u: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
    }
    acc += l;
  }
  return { p: pts[0], u: { x: 1, y: 0 } };
}

// ── Candidates ──────────────────────────────────────────────────────────────

interface Candidate { x: number; y: number; rank: number; side: number }

/** Unit normal pointing ABOVE a horizontal-ish segment, RIGHT of a vertical-ish one. */
function sideNormal(u: Point): Point {
  if (Math.abs(u.x) >= Math.abs(u.y)) return u.x >= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  return u.y >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
}

function candidatesFor(base: Point, u: Point, rank: number, size: { w: number; h: number }, far: boolean): Candidate[] {
  const n = sideNormal(u);
  const half = Math.abs(n.x) * size.w / 2 + Math.abs(n.y) * size.h / 2;
  const mk = (d: number, side: number, extra = 0): Candidate => ({ x: base.x + n.x * d, y: base.y + n.y * d, rank: rank + extra, side });
  if (far) return [28, 44, 60].flatMap((g, i) => [mk(half + g, 2, i), mk(-(half + g), 2, i + 0.5)]);
  const gap = half + 3;
  return [mk(0, 0), mk(gap, 1), mk(-gap, 1, 0.5)];
}

function sampleCandidates(pts: Point[], size: { w: number; h: number }, far: boolean): Candidate[] {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= 1) segs.push({ a, b, l, u: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } });
  }
  segs.sort((p, q) => q.l - p.l);
  const out: Candidate[] = [];
  let rank = 0;
  for (const t of [0.5, 0.3, 0.7]) {
    for (const s of segs) {
      out.push(...candidatesFor({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }, s.u, rank++, size, far));
    }
  }
  // Near the ends, just outside the source / arrowhead zones.
  let total = 0;
  for (const s of segs) total += s.l;
  const src = pointAtArc(pts, 1);
  const alongHalf = (u: Point) => Math.abs(u.x) * size.w / 2 + Math.abs(u.y) * size.h / 2;
  const nearSrc = pointAtArc(pts, SOURCE_ZONE + 2 + alongHalf(src.u));
  out.push(...candidatesFor(nearSrc.p, nearSrc.u, rank++, size, far));
  const tgt = pointAtArc(pts, total - 1);
  const nearTgt = pointAtArc(pts, total - ARROW_ZONE - 2 - alongHalf(tgt.u));
  out.push(...candidatesFor(nearTgt.p, nearTgt.u, rank++, size, far));
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface LabelPlacement {
  /** Chip centre (padded diagram coordinates). */
  x: number;
  y: number;
  /** Present when the chip sits more than 16px from its own edge: a dashed
   *  hairline from the edge to the chip border. */
  leader?: { from: Point; to: Point };
}

/** Compute the chip centre for every labeled edge. Edges without a label or
 *  with fewer than 2 waypoints are omitted from the result.
 *
 *  `pad` is the diagram-level padding applied to all coordinates; `groups`
 *  (optional, unpadded) enables the group-title-band reject. */
export function computeEdgeLabelPositions(
  edges: IREdge[],
  nodeById: Map<string, IRNode>,
  pad: number,
  groups: IRGroup[] = []
): Map<string, LabelPlacement> {
  const placements = new Map<string, LabelPlacement>();
  const placedChips: Rect[] = [];

  const labeled = edges
    .filter((e) => e.label && e.waypoints && e.waypoints.length >= 2)
    .map((e) => ({ edge: e, pts: e.waypoints!.map((p) => ({ x: p.x + pad, y: p.y + pad })), size: chipSize(e.label!) }))
    .sort((a, b) => a.size.w - b.size.w);

  const segsByEdge = new Map<string, Seg[]>();
  for (const e of edges) {
    if (!e.waypoints || e.waypoints.length < 2) continue;
    const segs: Seg[] = [];
    for (let i = 0; i < e.waypoints.length - 1; i++) {
      const a = e.waypoints[i], b = e.waypoints[i + 1];
      segs.push([{ x: a.x + pad, y: a.y + pad }, { x: b.x + pad, y: b.y + pad }]);
    }
    segsByEdge.set(e.id, segs);
  }

  // Everything a chip must stay off: node boxes, icon-label boxes, group title bands.
  const obstacles: Rect[] = [];
  for (const n of nodeById.values()) {
    obstacles.push({ x: n.position.x + pad, y: n.position.y + pad, width: n.size.width, height: n.size.height });
    const il = iconLabelLayout(n);
    if (il) obstacles.push({ x: il.box.x + pad, y: il.box.y + pad, width: il.box.width, height: il.box.height });
  }
  for (const g of groups) {
    obstacles.push({ x: g.position.x + pad, y: g.position.y + pad, width: g.size.width, height: Math.min(GROUP_BAND, g.size.height) });
  }

  for (const { edge, pts, size } of labeled) {
    const label = edge.label!;
    const foreign: Seg[] = [];
    for (const [id, segs] of segsByEdge) if (id !== edge.id) foreign.push(...segs);
    const arrowZone = zoneSegs(pts, ARROW_ZONE, false);
    const sourceZone = zoneSegs(pts, SOURCE_ZONE, true);
    const own: Seg[] = [];
    for (let i = 0; i < pts.length - 1; i++) own.push([pts[i], pts[i + 1]]);

    const hits = (r: Rect): number => {
      let h = 0;
      for (const o of obstacles) if (rectsOverlap(r, o)) h++;
      const ir = inflate(r, 1);
      if (arrowZone.some(([a, b]) => segmentIntersectsRect(a, b, ir))) h++;
      if (sourceZone.some(([a, b]) => segmentIntersectsRect(a, b, ir))) h++;
      const rr = inflate(r, 2);
      for (const c of placedChips) if (rectsOverlap(rr, c)) h++;
      for (const [a, b] of foreign) if (segmentIntersectsRect(a, b, r)) h++;
      return h;
    };

    const evaluate = (cands: Candidate[]): { c: Candidate; cost: number; hits: number } | null => {
      let best: { c: Candidate; cost: number; hits: number } | null = null;
      for (const c of cands) {
        const r = chipRect(c.x, c.y, label);
        const h = hits(r);
        let cost = h * HARD + c.rank * 2 + c.side * 6;
        if (h === 0) {
          // Own polyline cutting the chip away from the line it sits on is a
          // mild defect (chip on a bend).
          let ownCuts = 0;
          if (c.side > 0) for (const [a, b] of own) if (segmentIntersectsRect(a, b, r)) ownCuts++;
          cost += ownCuts * 15;
        }
        if (c.side === 2) cost += nearestOnPolyline(pts, r).d;
        if (!best || cost < best.cost) best = { c, cost, hits: h };
      }
      return best;
    };

    // ELK reserved space for this label and reports its centre: keep it when
    // it is clean and still on the edge.
    // Preferred: centred ON its own segment (line runs behind the chip) wherever
    // that passes the hard rejects — one look for horizontal and vertical runs.
    let chosen: { c: Candidate; hits: number } | null = null;
    const onLine = evaluate(sampleCandidates(pts, size, false).filter((c) => c.side === 0));
    if (onLine && onLine.hits === 0) chosen = onLine;
    if (!chosen && edge.layoutLabel) {
      const c: Candidate = { x: edge.layoutLabel.x + pad, y: edge.layoutLabel.y + pad, rank: 0, side: 0 };
      const r = chipRect(c.x, c.y, label);
      if (hits(r) === 0 && nearestOnPolyline(pts, r).d <= LEADER_DIST) chosen = { c, hits: 0 };
    }
    if (!chosen) {
      chosen = evaluate(sampleCandidates(pts, size, false));
      if (!chosen || chosen.hits > 0) {
        const far = evaluate([...sampleCandidates(pts, size, false), ...sampleCandidates(pts, size, true)]);
        if (far && (!chosen || far.cost < evaluate([chosen.c])!.cost)) chosen = far;
      }
    }
    if (!chosen) {
      const mid = pointAtArc(pts, 0).p;
      chosen = { c: { x: mid.x, y: mid.y, rank: 0, side: 0 }, hits: 0 };
    }

    const rect = chipRect(chosen.c.x, chosen.c.y, label);
    const near = nearestOnPolyline(pts, rect);
    const placement: LabelPlacement = { x: chosen.c.x, y: chosen.c.y };
    if (near.d > LEADER_DIST) {
      placement.leader = {
        from: near.p,
        to: {
          x: Math.max(rect.x, Math.min(near.p.x, rect.x + rect.width)),
          y: Math.max(rect.y, Math.min(near.p.y, rect.y + rect.height)),
        },
      };
    }
    placements.set(edge.id, placement);
    placedChips.push(rect);
  }
  return placements;
}
