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

  // Lifelines extend from just under each header down to the last message Y.
  const bottomY = y + 20;
  const nodes = positioned.map((n) => ({ ...n, data: { ...n.data, lifelineBottom: bottomY } }));
  const width = startX + Math.max(0, participants.length - 1) * laneWidth + 140 + 60;
  return { nodes, edges, bounds: { x: 0, y: 0, width, height: bottomY + 40 } };
}

// ── Gantt ────────────────────────────────────────────────────────────────
// Parses "Label: Mon D[-D2] [- Mon2 D3]" or "Label: Mon D" (milestone) out of
// each node's label. Falls back to even spacing (declaration order) when a
// label carries no parseable date so the diagram still renders sensibly.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monthIndex(s: string): number { return MONTHS.indexOf(s.slice(0, 3).toLowerCase()); }

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

export function layoutGantt(ir: DiagramIR): CustomLayoutResult {
  const rowH = 50, rowGap = 20, leftPad = 200, topPad = 60;
  const dayWidth = 8;
  const spans = ir.nodes.map((n, i) => parseGanttLabel(n.label, i * 10));
  const minDay = Math.min(...spans.map((s) => s.startDay));

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
      data: { ...n.data, ganttMilestone: s.milestone, ganttRowLabel: s.label },
    };
  });

  const edges: IREdge[] = ir.edges.map((e) => {
    const src = nodes.find((n) => n.id === e.sourceId);
    const tgt = nodes.find((n) => n.id === e.targetId);
    if (!src || !tgt) return { ...e, waypoints: [] };
    const x1 = src.position.x + src.size.width, y1 = src.position.y + src.size.height / 2;
    const x2 = tgt.position.x, y2 = tgt.position.y + tgt.size.height / 2;
    return { ...e, waypoints: [{ x: x1, y: y1 }, { x: (x1 + x2) / 2, y: y1 }, { x: (x1 + x2) / 2, y: y2 }, { x: x2, y: y2 }] };
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
  const cx = 500, cy = 400;
  positions.set(rootNode.id, { x: cx, y: cy });

  const ringGap = 190;
  function place(id: string, depth: number, angleStart: number, angleEnd: number) {
    const kids = childrenOf.get(id) || [];
    if (kids.length === 0) return;
    const span = angleEnd - angleStart;
    const step = span / kids.length;
    kids.forEach((kidId, i) => {
      const angle = angleStart + step * (i + 0.5);
      const r = ringGap * depth;
      positions.set(kidId, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      place(kidId, depth + 1, angle - step / 2 * 0.9, angle + step / 2 * 0.9);
    });
  }
  place(rootNode.id, 1, -Math.PI / 2 - Math.PI * 0.9, -Math.PI / 2 + Math.PI * 0.9 + Math.PI * 2 - Math.PI * 2);
  // Full circle fan for the root's direct children.
  positions.set(rootNode.id, { x: cx, y: cy });
  const rootKids = childrenOf.get(rootNode.id) || [];
  rootKids.forEach((kidId, i) => {
    const angle = (i / rootKids.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(kidId, { x: cx + ringGap * Math.cos(angle), y: cy + ringGap * Math.sin(angle) });
    const kidsOfKid = childrenOf.get(kidId) || [];
    const fanWidth = Math.PI / Math.max(1, rootKids.length) * 1.6;
    place(kidId, 2, angle - fanWidth / 2, angle + fanWidth / 2);
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const nodes: IRNode[] = ir.nodes.map((n) => {
    const p = positions.get(n.id) || { x: cx, y: cy };
    const w = n.size.width || 130, h = n.size.height || 44;
    const x = p.x - w / 2, y = p.y - h / 2;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    return { ...n, position: { x, y }, size: { width: w, height: h }, data: { ...n.data, mindmapRoot: n.id === rootNode.id } };
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
  const slotWidth = 140, topPad = 40, chartHeight = 320, leftPad = 80;
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
  const height = topPad + chartHeight + 80;
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
