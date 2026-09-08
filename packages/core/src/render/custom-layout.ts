// =============================================================================
// SelDiA — Per-Type Custom Layout Overrides
// =============================================================================
// Dagre's hierarchical box layout is the right algorithm for flowchart-shaped
// diagrams (flowchart, component, network, deployment, block, form, timeline,
// activity, usecase, class, er, state, bpmn, dmn, c4). But some diagram types
// have a structurally different topology that dagre cannot express:
//   - sequence: participants across the top, lifelines running down, messages
//     ordered top-to-bottom by declaration order (not a DAG rank order)
//   - gantt: tasks stacked vertically, positioned horizontally on a time axis
//   - mindmap: a single root with branches radiating outward
//   - sankey: nodes in flow columns, height proportional to flow volume
//   - gitgraph: branches as horizontal lanes, commits placed in sequence
// Each function here takes the transformed (unpositioned) IR and returns
// fully positioned nodes/edges + bounds, bypassing dagre entirely. Kept
// synchronous so compileSync() (VS Code preview) can use it directly.
// =============================================================================

import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { Point, Rect } from '../types/common.js';

export interface CustomLayoutResult {
  nodes: IRNode[];
  edges: IREdge[];
  bounds: Rect;
  /** Merged into the positioned IR's metadata — used by sequence to hand
   *  resolved fragment-box geometry to the renderer. */
  metadataPatch?: Record<string, unknown>;
}

function computeBounds(nodes: IRNode[], minWidth = 0, minHeight = 0): Rect {
  if (!nodes.length) return { x: 0, y: 0, width: minWidth, height: minHeight };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width); maxY = Math.max(maxY, n.position.y + n.size.height);
  }
  return { x: minX, y: minY, width: Math.max(maxX - minX + 40, minWidth), height: Math.max(maxY - minY + 40, minHeight) };
}

function straightWaypoints(src: IRNode, tgt: IRNode): Point[] {
  const x1 = src.position.x + src.size.width / 2, y1 = src.position.y + src.size.height / 2;
  const x2 = tgt.position.x + tgt.size.width / 2, y2 = tgt.position.y + tgt.size.height / 2;
  return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
}

// ── Sequence ─────────────────────────────────────────────────────────────
// Participants become fixed-width lifeline headers spaced evenly across the
// top; every remaining node is a message and gets a Y position purely from
// its declaration order (participants are excluded from that ordering).
export function layoutSequence(ir: DiagramIR): CustomLayoutResult {
  const participantIds = new Set<string>();
  for (const e of ir.edges) { participantIds.add(e.sourceId); participantIds.add(e.targetId); }
  // Participants are nodes referenced only as edge endpoints (never targets
  // of "message" semantics) — in this IR every declared node IS a participant
  // (sequence.ts emits one IRNode per `participant` decl, and messages are
  // edges, not nodes). So all IR nodes are lifeline headers.
  const participants = ir.nodes;
  const laneWidth = 160;
  const startX = 80;
  const headerY = 20;
  const headerH = 50;

  const laneX = new Map<string, number>();
  const positioned: IRNode[] = participants.map((n, i) => {
    const cx = startX + i * laneWidth;
    laneX.set(n.id, cx);
    return { ...n, position: { x: cx - 70, y: headerY }, size: { width: 140, height: headerH } };
  });

  const messageGap = 60;
  let y = headerY + headerH + 50;
  const edges: IREdge[] = ir.edges.map((e) => {
    const x1 = laneX.get(e.sourceId) ?? startX;
    const x2 = laneX.get(e.targetId) ?? startX;
    const wps: Point[] = x1 === x2
      ? [{ x: x1, y }, { x: x1 + 60, y: y + 20 }, { x: x1, y: y + 40 }] // self-message loop
      : [{ x: x1, y }, { x: x2, y }];
    y += x1 === x2 ? messageGap + 20 : messageGap;
    return { ...e, waypoints: wps, data: { ...e.data, sequenceOrder: true } };
  });

  // Resolve control-fragment ranges (from sequence.ts) into pixel boxes now
  // that every message has a Y. A fragment's [firstEdge, lastEdge) is a span of
  // message indices; the box wraps the Ys of the messages in that span, padded,
  // with a title tab. Nesting depth insets each box so inner ones sit inside
  // outer ones. `else`/`critical` section splits become horizontal divider Ys.
  const rawFrags = (ir.metadata?.sequenceFragments as any[]) ?? [];
  const yOfEdge = (idx: number): number | undefined => {
    const e = edges.find((ee) => (ee.data as any)?.messageOrder === idx);
    return e ? e.waypoints?.[0]?.y : undefined;
  };
  // Depth = how many other fragments strictly contain this one's span.
  const depthOf = (f: any): number =>
    rawFrags.filter((o) => o !== f && o.firstEdge <= f.firstEdge && o.lastEdge >= f.lastEdge &&
      (o.firstEdge < f.firstEdge || o.lastEdge > f.lastEdge)).length;
  const inset = 26;
  const minX = startX - 70;
  const maxX = startX + Math.max(0, participants.length - 1) * laneWidth + 70;
  const fragmentBoxes = rawFrags.map((f) => {
    const ys: number[] = [];
    for (let i = f.firstEdge; i < f.lastEdge; i++) { const yy = yOfEdge(i); if (yy != null) ys.push(yy); }
    if (!ys.length) return null;
    const d = depthOf(f);
    const top = Math.min(...ys) - 28 - d * 4;
    const bot = Math.max(...ys) + 24 + d * 4;
    const sections = (f.sections ?? []).map((s: any) => ({ label: s.label, y: yOfEdge(s.firstEdge) })).filter((s: any) => s.y != null);
    return {
      id: f.id, keyword: f.keyword, label: f.label,
      x: minX + d * inset, y: top,
      width: (maxX - minX) - d * inset * 2, height: bot - top,
      // Divider Ys for every section after the first (else/critical).
      dividers: sections.slice(1).map((s: any) => ({ label: s.label, y: s.y - 20 })),
      sections,
    };
  }).filter(Boolean);

  // Lifelines extend from just under each header down to the last message Y.
  const bottomY = y + 20;
  const nodes = positioned.map((n) => ({ ...n, data: { ...n.data, lifelineBottom: bottomY } }));
  const width = startX + Math.max(0, participants.length - 1) * laneWidth + 140 + 60;
  return {
    nodes, edges,
    bounds: { x: 0, y: 0, width, height: bottomY + 40 },
    metadataPatch: fragmentBoxes.length ? { sequenceFragmentBoxes: fragmentBoxes } : undefined,
  };
}

// ── Gantt ────────────────────────────────────────────────────────────────
// Parses "Label: Mon D[-D2] [- Mon2 D3]" or "Label: Mon D" (milestone) out of
// each node's label. Falls back to even spacing (declaration order) when a
// label carries no parseable date so the diagram still renders sensibly.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthIndex(s: string): number { return MONTHS.indexOf(s.slice(0, 3).toLowerCase()); }

/** Formats a Gantt "day index" (month*30 + day-of-month, the same synthetic
 *  calendar parseGanttLabel encodes dates into) back into a "Mon D" tick
 *  label for the time-axis gridlines. */
export function ganttDayLabel(day: number, unit: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'week'): string {
  if (unit === 'quarter') {
    const m = Math.max(0, Math.min(11, Math.floor(day / 30)));
    return `Q${Math.floor(m / 3) + 1} '${Math.floor(day / 360) + 1}`;
  }
  if (unit === 'year') return `Year ${Math.floor(day / 360) + 1}`;
  // Months are flat 30-day buckets with 1-indexed dates (day 1..30), so a
  // day count that's an exact multiple of 30 is the 30th of the *previous*
  // month, not day 0 of the next one — roll it back or "Apr 0" shows up on
  // the axis instead of "Mar 30".
  let m = Math.max(0, Math.min(11, Math.floor(day / 30)));
  let d = Math.round(day - m * 30);
  if (d === 0 && m > 0) { m -= 1; d = 30; }
  if (unit === 'month') return MONTH_LABELS[m];
  return `${MONTH_LABELS[m]} ${d}`;
}

interface GanttSpan { startDay: number; endDay: number; label: string; milestone: boolean; }

function parseGanttLabel(label: string, fallbackDay: number): GanttSpan {
  // "Title: Jan 6-17" | "Title: Jan 27 - Feb 14" | "Title: Mar 10" (milestone, no range)
  const body = label.includes(':') ? label.split(':').slice(1).join(':').trim() : label;
  const title = label.includes(':') ? label.split(':')[0].trim() : label;
  const re = /([A-Za-z]{3,})\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3,})\s+)?(\d{1,2}))?/;
  const m = body.match(re);
  if (!m) return { startDay: fallbackDay, endDay: fallbackDay + 5, label: title, milestone: false };
  const m1 = monthIndex(m[1]);
  const d1 = parseInt(m[2], 10);
  const startDay = m1 * 30 + d1;
  if (m[4]) {
    const m2 = m[3] ? monthIndex(m[3]) : m1;
    const d2 = parseInt(m[4], 10);
    const endDay = m2 * 30 + d2;
    return { startDay, endDay: Math.max(endDay, startDay + 1), label: title, milestone: false };
  }
  return { startDay, endDay: startDay, label: title, milestone: true };
}

/** Ticks per unit and px-per-day chosen from the total project span, so a
 *  2-week sprint gets daily gridlines while a 2-year roadmap gets yearly ones
 *  instead of both rendering the same fixed weekly grid (which either
 *  crowds into unreadable hairlines on long projects or wastes space on
 *  short ones). Picks the coarsest granularity that still yields a
 *  reasonable number of ticks (roughly 6-16) across the span. */
function ganttScaleFor(spanDays: number): { unit: 'day' | 'week' | 'month' | 'quarter' | 'year'; unitDays: number; dayWidth: number } {
  if (spanDays <= 21) return { unit: 'day', unitDays: 1, dayWidth: 24 };
  if (spanDays <= 90) return { unit: 'week', unitDays: 7, dayWidth: 8 };
  if (spanDays <= 240) return { unit: 'month', unitDays: 30, dayWidth: 3 };
  if (spanDays <= 720) return { unit: 'quarter', unitDays: 90, dayWidth: 1.2 };
  return { unit: 'year', unitDays: 360, dayWidth: 0.5 };
}

export function layoutGantt(ir: DiagramIR): CustomLayoutResult {
  const rowH = 50, rowGap = 20, leftPad = 200, topPad = 60;
  const spans = ir.nodes.map((n, i) => parseGanttLabel(n.label, i * 10));
  const minDay = Math.min(...spans.map((s) => s.startDay));
  const maxDaySpan = Math.max(...spans.map((s) => s.endDay)) - minDay;
  const { unit, unitDays, dayWidth } = ganttScaleFor(maxDaySpan);

  const nodes: IRNode[] = ir.nodes.map((n, i) => {
    const s = spans[i];
    const x = leftPad + (s.startDay - minDay) * dayWidth;
    const y = topPad + i * (rowH + rowGap);
    const w = s.milestone ? 0 : Math.max(30, (s.endDay - s.startDay) * dayWidth);
    return {
      ...n,
      label: s.label,
      position: { x: s.milestone ? x - 12 : x, y },
      size: { width: s.milestone ? 24 : w, height: rowH },
      data: {
        ...n.data, ganttMilestone: s.milestone, ganttRowLabel: s.label,
        ganttDuration: s.milestone ? undefined : s.endDay - s.startDay,
        ganttAxis: { minDay, dayWidth, leftPad, topPad, unit, unitDays },
      },
    };
  });

  const edges: IREdge[] = ir.edges.map((e) => {
    const src = nodes.find((n) => n.id === e.sourceId);
    const tgt = nodes.find((n) => n.id === e.targetId);
    if (!src || !tgt) return { ...e, waypoints: [] };
    const x1 = src.position.x + src.size.width, y1 = src.position.y + src.size.height / 2;
    const x2 = tgt.position.x, y2 = tgt.position.y + tgt.size.height / 2;
    // Bend just past the predecessor's own right edge rather than at the
    // midpoint between the two bars — a midpoint bend commonly falls inside
    // an unrelated bar sitting in a row between src and tgt, which is what
    // made dependency lines look like they were slicing through bars.
    const xBend = x2 > x1 ? Math.min(x1 + 14, (x1 + x2) / 2) : (x1 + x2) / 2;
    return { ...e, waypoints: [{ x: x1, y: y1 }, { x: xBend, y: y1 }, { x: xBend, y: y2 }, { x: x2, y: y2 }] };
  });

  const maxDay = Math.max(...spans.map((s) => s.endDay));
  const width = leftPad + (maxDay - minDay) * dayWidth + 60;
  const height = topPad + nodes.length * (rowH + rowGap) + 20;
  return { nodes, edges, bounds: { x: 0, y: 0, width, height } };
}

// ── Mindmap ──────────────────────────────────────────────────────────────
// Radial layout: the node with no incoming edge (or the first node) is the
// root at the center; children fan out in concentric rings at even angles.
export function layoutMindmap(ir: DiagramIR): CustomLayoutResult {
  const incoming = new Set(ir.edges.map((e) => e.targetId));
  const rootNode = ir.nodes.find((n) => !incoming.has(n.id)) || ir.nodes[0];
  if (!rootNode) return { nodes: [], edges: [], bounds: { x: 0, y: 0, width: 400, height: 300 } };

  const childrenOf = new Map<string, string[]>();
  for (const e of ir.edges) {
    if (!childrenOf.has(e.sourceId)) childrenOf.set(e.sourceId, []);
    childrenOf.get(e.sourceId)!.push(e.targetId);
  }

  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const positions = new Map<string, Point>();
  const depths = new Map<string, number>();
  const branchIdx = new Map<string, number>(); // root→0, each root-child→0,1,2… inherited by descendants
  const cx = 500, cy = 400;
  positions.set(rootNode.id, { x: cx, y: cy });
  depths.set(rootNode.id, 0);
  branchIdx.set(rootNode.id, 0);

  // Ring radius per depth uses a diminishing gap (each level 78% of the
  // previous) so the map tapers inward instead of spacing every level by the
  // same fixed distance — the taper is what reads as "levels" at a glance
  // rather than one undifferentiated ring of boxes.
  const ringGap = 190;
  const ringRadius = (depth: number): number => {
    let r = 0, gap = ringGap;
    for (let d = 1; d <= depth; d++) { r += gap; gap *= 0.78; }
    return r;
  };
  function place(id: string, depth: number, angleStart: number, angleEnd: number, parentBranch: number) {
    const kids = childrenOf.get(id) || [];
    if (kids.length === 0) return;
    const span = angleEnd - angleStart;
    const step = span / kids.length;
    kids.forEach((kidId, i) => {
      const angle = angleStart + step * (i + 0.5);
      const r = ringRadius(depth);
      positions.set(kidId, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      depths.set(kidId, depth);
      branchIdx.set(kidId, parentBranch);
      place(kidId, depth + 1, angle - step / 2 * 0.9, angle + step / 2 * 0.9, parentBranch);
    });
  }
  // Full circle fan for the root's direct children; each branch then gets its
  // own angular wedge for its own descendants.
  const rootKids = childrenOf.get(rootNode.id) || [];
  rootKids.forEach((kidId, i) => {
    const angle = (i / rootKids.length) * Math.PI * 2 - Math.PI / 2;
    const r1 = ringRadius(1);
    positions.set(kidId, { x: cx + r1 * Math.cos(angle), y: cy + r1 * Math.sin(angle) });
    depths.set(kidId, 1);
    branchIdx.set(kidId, i);
    const fanWidth = Math.PI / Math.max(1, rootKids.length) * 1.6;
    place(kidId, 2, angle - fanWidth / 2, angle + fanWidth / 2, i);
  });

  // Node size and stroke weight taper with depth — the root reads as the
  // biggest, boldest shape and each ring outward is progressively smaller and
  // lighter, the visual hierarchy a mindmap needs ("levels").
  const sizeScale = (depth: number): number => Math.max(0.55, 1 - depth * 0.14);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const nodes: IRNode[] = ir.nodes.map((n) => {
    const p = positions.get(n.id) || { x: cx, y: cy };
    const depth = depths.get(n.id) ?? 0;
    const scale = sizeScale(depth);
    const w = (n.size.width || 130) * scale, h = (n.size.height || 44) * scale;
    const x = p.x - w / 2, y = p.y - h / 2;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    return { ...n, position: { x, y }, size: { width: w, height: h }, data: { ...n.data, mindmapRoot: n.id === rootNode.id, mindmapDepth: depth, mindmapBranch: branchIdx.get(n.id) ?? 0 } };
  });
  const shiftX = -minX + 40, shiftY = -minY + 40;
  const shifted = nodes.map((n) => ({ ...n, position: { x: n.position.x + shiftX, y: n.position.y + shiftY } }));
  const byIdShifted = new Map(shifted.map((n) => [n.id, n]));
  const edges: IREdge[] = ir.edges.map((e) => {
    const src = byIdShifted.get(e.sourceId), tgt = byIdShifted.get(e.targetId);
    if (!src || !tgt) return { ...e, waypoints: [] };
    return { ...e, waypoints: straightWaypoints(src, tgt) };
  });
  const width = maxX - minX + 80, height = maxY - minY + 80;
  void byId;
  return { nodes: shifted, edges, bounds: { x: 0, y: 0, width, height } };
}

// ── Sankey ───────────────────────────────────────────────────────────────
// Nodes are placed into flow columns by longest-path depth from a source
// (no incoming edges); each node's height is proportional to its total flow
// (sum of adjacent edge weights, parsed from the edge label, default 1).
export function layoutSankey(ir: DiagramIR): CustomLayoutResult {
  const incoming = new Set(ir.edges.map((e) => e.targetId));
  const depth = new Map<string, number>();
  const roots = ir.nodes.filter((n) => !incoming.has(n.id));
  for (const r of roots) depth.set(r.id, 0);
  const adj = new Map<string, string[]>();
  for (const e of ir.edges) { if (!adj.has(e.sourceId)) adj.set(e.sourceId, []); adj.get(e.sourceId)!.push(e.targetId); }
  const queue = [...roots.map((r) => r.id)];
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) || 0;
    for (const kid of adj.get(id) || []) {
      if (!depth.has(kid) || depth.get(kid)! < d + 1) { depth.set(kid, d + 1); queue.push(kid); }
    }
  }
  for (const n of ir.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  function weightOf(label?: string): number { const n = label ? parseFloat(label) : NaN; return isNaN(n) ? 1 : n; }
  const flow = new Map<string, number>();
  for (const n of ir.nodes) flow.set(n.id, 0);
  for (const e of ir.edges) {
    const w = weightOf(e.label);
    flow.set(e.sourceId, (flow.get(e.sourceId) || 0) + w);
    flow.set(e.targetId, (flow.get(e.targetId) || 0) + w);
  }
  const maxFlow = Math.max(1, ...Array.from(flow.values()));

  const colWidth = 220, minH = 40, maxH = 160, topPad = 40;
  const byCol = new Map<number, IRNode[]>();
  for (const n of ir.nodes) { const d = depth.get(n.id) || 0; if (!byCol.has(d)) byCol.set(d, []); byCol.get(d)!.push(n); }

  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [col, list] of byCol) {
    let y = topPad;
    for (const n of list) {
      const h = Math.max(minH, Math.round((flow.get(n.id) || 1) / maxFlow * maxH));
      positions.set(n.id, { x: 60 + col * colWidth, y, w: 160, h });
      y += h + 30;
    }
  }

  const nodes: IRNode[] = ir.nodes.map((n) => {
    const p = positions.get(n.id)!;
    return { ...n, position: { x: p.x, y: p.y }, size: { width: p.w, height: p.h }, data: { ...n.data, sankeyFlow: flow.get(n.id) } };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: IREdge[] = ir.edges.map((e) => {
    const src = byId.get(e.sourceId), tgt = byId.get(e.targetId);
    if (!src || !tgt) return { ...e, waypoints: [] };
    const x1 = src.position.x + src.size.width, y1 = src.position.y + src.size.height / 2;
    const x2 = tgt.position.x, y2 = tgt.position.y + tgt.size.height / 2;
    return { ...e, waypoints: [{ x: x1, y: y1 }, { x: (x1 + x2) / 2, y: y1 }, { x: (x1 + x2) / 2, y: y2 }, { x: x2, y: y2 }], data: { ...e.data, sankeyWeight: weightOf(e.label) } };
  });
  const maxCol = Math.max(0, ...Array.from(byCol.keys()));
  const width = 60 + (maxCol + 1) * colWidth + 60;
  const height = Math.max(...nodes.map((n) => n.position.y + n.size.height)) + 40;
  return { nodes, edges, bounds: { x: 0, y: 0, width, height } };
}

// ── GitGraph ─────────────────────────────────────────────────────────────
// Parses "branch: message" out of each node's label to assign a lane; falls
// back to a single "main" lane. Commits are placed left-to-right in
// declaration order, each lane at a fixed Y.
export function layoutGitgraph(ir: DiagramIR): CustomLayoutResult {
  function parseBranch(label: string): { branch: string; message: string } {
    const m = label.match(/^([\w.\-\/]+)\s*:\s*(.*)$/);
    return m ? { branch: m[1], message: m[2] } : { branch: 'main', message: label };
  }
  const parsed = ir.nodes.map((n) => parseBranch(n.label));
  const lanes: string[] = [];
  for (const p of parsed) if (!lanes.includes(p.branch)) lanes.push(p.branch);

  const colWidth = 160, laneGap = 90, topPad = 60, leftPad = 140;
  const nodes: IRNode[] = ir.nodes.map((n, i) => {
    const { branch, message } = parsed[i];
    const lane = lanes.indexOf(branch);
    return {
      ...n,
      label: message,
      position: { x: leftPad + i * colWidth, y: topPad + lane * laneGap },
      size: { width: 26, height: 26 },
      data: { ...n.data, gitBranch: branch, gitLane: lane },
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: IREdge[] = ir.edges.map((e) => {
    const src = byId.get(e.sourceId), tgt = byId.get(e.targetId);
    if (!src || !tgt) return { ...e, waypoints: [] };
    const x1 = src.position.x + src.size.width / 2, y1 = src.position.y + src.size.height / 2;
    const x2 = tgt.position.x + tgt.size.width / 2, y2 = tgt.position.y + tgt.size.height / 2;
    const wps = y1 === y2 ? [{ x: x1, y: y1 }, { x: x2, y: y2 }] : [{ x: x1, y: y1 }, { x: (x1 + x2) / 2, y: y1 }, { x: (x1 + x2) / 2, y: y2 }, { x: x2, y: y2 }];
    return { ...e, waypoints: wps, data: { ...e.data, srcLane: (src.data as any)?.gitLane ?? 0 } };
  });
  const width = leftPad + ir.nodes.length * colWidth + 80;
  const height = topPad + lanes.length * laneGap + 60;
  return { nodes, edges, bounds: { x: 0, y: 0, width, height } };
}

// ── Chart ────────────────────────────────────────────────────────────────
// Bar/line charts: nodes become evenly-spaced categories along an X axis;
// the renderer draws bars/points from parsed numeric series in the label.
// Layout only needs to assign category slots — the renderer computes bar
// geometry from the label text directly, so this just spaces things evenly.
export function layoutChart(ir: DiagramIR): CustomLayoutResult {
  // Pie renders one circle centered in the canvas, not per-category columns —
  // the bar/line chart height left a wide empty band under the circle.
  const isPie = ir.type === 'chart-pie';
  const slotWidth = 140, topPad = 40, chartHeight = isPie ? 260 : 320, leftPad = 80;
  const nodes: IRNode[] = ir.nodes.map((n, i) => ({
    ...n,
    position: { x: leftPad + i * slotWidth, y: topPad },
    size: { width: slotWidth - 20, height: chartHeight },
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: IREdge[] = ir.edges.map((e) => {
    const src = byId.get(e.sourceId), tgt = byId.get(e.targetId);
    if (!src || !tgt) return { ...e, waypoints: [] };
    return { ...e, waypoints: [] }; // chart renderer draws its own connecting geometry, not generic edges
  });
  const width = leftPad + ir.nodes.length * slotWidth + 40;
  // Just enough below the x axis (at topPad + chartHeight - 30) for the row of
  // category labels. The old +80 left a ~100px empty band under the plot.
  const height = topPad + chartHeight + 20;
  return { nodes, edges, bounds: { x: 0, y: 0, width, height } };
}

export function customLayoutFor(type: string): ((ir: DiagramIR) => CustomLayoutResult) | undefined {
  switch (type) {
    case 'sequence': return layoutSequence;
    case 'gantt': return layoutGantt;
    case 'mindmap': return layoutMindmap;
    case 'sankey': return layoutSankey;
    case 'gitgraph': return layoutGitgraph;
    case 'chart-bar': case 'chart-line': case 'chart-pie': case 'chart-radar': case 'chart-scatter': return layoutChart;
    default: return undefined;
  }
}
