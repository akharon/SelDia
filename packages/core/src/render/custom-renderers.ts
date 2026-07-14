// =============================================================================
// SelDiA — Per-Type Custom Renderers
// =============================================================================
// The generic renderer (engine.ts renderNode/renderEdge) draws every diagram
// as boxes connected by arrows — correct for flowchart-shaped types, but
// structurally wrong for types with their own visual grammar (sequence
// lifelines, ER tables with crow's-feet, gantt time bars, radial mindmaps,
// sankey ribbons, gitgraph lanes, real chart geometry). Each function below
// renders ONE node or ONE edge's inner content for its diagram type; the
// caller (engine.ts) still emits the wrapping `<g data-seldia-node-id>` /
// `<g data-seldia-edge-id>` so identity attributes and test contracts are
// unchanged regardless of which renderer drew the inside.
// =============================================================================

import type { IRNode, IREdge } from '../ir/types.js';
import type { Point } from '../types/common.js';
import { roughRect, roughEllipse, roughPolygon, roughLine, seedFor, type RoughStyle } from './rough.js';
import { DS, typeSwatch, seriesColor, type Swatch } from './design-system.js';

function esc(s: string): string { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function splitLabelLines(label: string): string[] {
  return (label || '').replace(/\\n/g, '\n').split('\n');
}

function textBlock(x: number, startY: number, lineHeight: number, fs: number, ff: string, color: string, label: string, anchor: 'middle' | 'start' = 'middle', weight = '400'): string {
  const lines = splitLabelLines(label);
  const tspans = lines.map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${esc(line)}</tspan>`).join('');
  return `    <text text-anchor="${anchor}" fill="${color}" font-size="${fs}" font-family="${ff}" font-weight="${weight}">${tspans}</text>\n`;
}

// -----------------------------------------------------------------------------
// Sequence — lifeline headers + dashed lifelines + ordered message arrows
// -----------------------------------------------------------------------------

export function renderSequenceParticipant(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2;
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(cx, y + h / 2 + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');

  // Dashed lifeline dropping from the header's bottom edge to the last message.
  const bottom = (node.data as any)?.lifelineBottom as number | undefined;
  if (bottom !== undefined) {
    const lifeStyle = { stroke: swatch.stroke, strokeWidth: 1.25, seed };
    if (sketchy) {
      el += roughLine(cx, y + h, cx, bottom + pad, lifeStyle);
    } else {
      el += `    <line x1="${cx}" y1="${y + h}" x2="${cx}" y2="${bottom + pad}" stroke="${swatch.stroke}" stroke-width="1.25" stroke-dasharray="5,4"/>\n`;
    }
  }
  return el;
}

export function renderSequenceMessage(edge: IREdge, pad: number, sketchy: boolean, accent: Swatch): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const pts = wps.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  const stroke = accent.stroke;
  const dashed = !!edge.bidirectional; // reply arrows (-->) render dashed, matching UML convention
  let el = '';
  if (sketchy) {
    const seed = seedFor(edge.id);
    for (let i = 0; i < pts.length - 1; i++) {
      el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke, strokeWidth: 1.75, roughness: DS.roughness * 0.7, seed: seed + i });
    }
  } else {
    const d = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const dashAttr = dashed ? ' stroke-dasharray="6,4"' : '';
    el += `    <polyline points="${d}" fill="none" stroke="${stroke}" stroke-width="1.75"${dashAttr}/>\n`;
  }
  // Filled arrowhead at the final point.
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const dx = last.x - prev.x, dy = last.y - prev.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len, ny = dy / len;
  const asz = 9;
  const p1x = last.x - asz * (nx * 0.8 - ny * 0.5), p1y = last.y - asz * (ny * 0.8 + nx * 0.5);
  const p2x = last.x - asz * (nx * 0.8 + ny * 0.5), p2y = last.y - asz * (ny * 0.8 - nx * 0.5);
  el += `    <polygon points="${p1x},${p1y} ${p2x},${p2y} ${last.x},${last.y}" fill="${stroke}"/>\n`;

  if (edge.label) {
    const midx = (pts[0].x + pts[pts.length - 1].x) / 2;
    const midy = pts[0].y - 8;
    const chipW = Math.max(30, edge.label.length * 6.5 + 12);
    el += `    <rect x="${midx - chipW / 2}" y="${midy - 15}" width="${chipW}" height="18" rx="4" fill="${DS.neutral.surface}" fill-opacity="0.95" stroke="${accent.stroke}" stroke-opacity="0.3" stroke-width="1"/>\n`;
    el += `    <text x="${midx}" y="${midy - 2}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
  }
  return el;
}

// -----------------------------------------------------------------------------
// State — rounded pills, filled start dot, ringed stop/final dot
// -----------------------------------------------------------------------------

export function renderStateNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const isStart = node.label === '[*]' || node.label === '*' || node.id === '[*]' || node.id === '_' || node.shape === 'circle';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  if (isStart) {
    const r = 12;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: 2, fill: swatch.stroke, roughness: DS.roughness, fillStyle: 'solid', seed };
    return sketchy
      ? roughEllipse(cx, cy, r * 2, r * 2, style)
      : `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${swatch.stroke}" stroke="${swatch.stroke}" stroke-width="2"/>\n`;
  }
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  return el;
}

/** A stop/final state is drawn as a ringed dot: outer circle + smaller filled
 *  center — but the state plugin doesn't currently mark a node as "final"
 *  (only "[*] -->" initial transitions exist), so this is exposed for future
 *  use / other plugins that flag data.kind === 'final'. */
export function renderStateFinalNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const rOuter = 13, rInner = 7;
  const seed = seedFor(node.id);
  const ring: RoughStyle = { stroke: swatch.stroke, strokeWidth: 2, fill: 'none', roughness: DS.roughness, seed };
  const dot: RoughStyle = { stroke: swatch.stroke, strokeWidth: 0, fill: swatch.stroke, roughness: DS.roughness, fillStyle: 'solid', seed: seed + 1 };
  let el = sketchy ? roughEllipse(cx, cy, rOuter * 2, rOuter * 2, ring) : `    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="${swatch.stroke}" stroke-width="2"/>\n`;
  el += sketchy ? roughEllipse(cx, cy, rInner * 2, rInner * 2, dot) : `    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="${swatch.stroke}"/>\n`;
  return el;
}

// -----------------------------------------------------------------------------
// ER — attributed table + crow's-foot cardinality
// -----------------------------------------------------------------------------

/** Splits "Entity\nid PK\nname string" style labels into a name + attribute
 *  rows; falls back to a single-row table with just the label as the name
 *  when authors write plain `Entity: [Entity]` (as demo.md does today) so ER
 *  diagrams still render as a table, not a UML class box. */
function parseErEntity(label: string): { name: string; attrs: string[] } {
  const lines = splitLabelLines(label);
  return { name: lines[0], attrs: lines.slice(1) };
}

export function renderErEntity(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width;
  const { name, attrs } = parseErEntity(node.label);
  const rowH = 26, headerH = 34;
  const rows = attrs.length > 0 ? attrs : ['id'];
  const h = headerH + rows.length * rowH;
  const seed = seedFor(node.id);
  let el = sketchy
    ? roughRect(x, y, w, h, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed })
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  // Header band (entity name).
  el += `    <path d="M ${x} ${y + DS.radius} Q ${x} ${y} ${x + DS.radius} ${y} H ${x + w - DS.radius} Q ${x + w} ${y} ${x + w} ${y + DS.radius} V ${y + headerH} H ${x} Z" fill="${swatch.fill}"/>\n`;
  el += `    <line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.divider}"/>\n`;
  el += `    <text x="${x + w / 2}" y="${y + headerH / 2 + DS.fontSize.label * 0.35}" text-anchor="middle" font-weight="700" fill="${swatch.text}" font-size="${DS.fontSize.label}" font-family="${DS.fontFamily}">${esc(name)}</text>\n`;
  // Attribute rows.
  rows.forEach((attr, i) => {
    const ry = y + headerH + i * rowH;
    if (i > 0) el += `    <line x1="${x}" y1="${ry}" x2="${x + w}" y2="${ry}" stroke="${DS.neutral.stroke}" stroke-width="0.75" stroke-opacity="0.5"/>\n`;
    const isKey = /\bPK\b|\bid\b/i.test(attr.split(/\s+/)[0] || '');
    el += `    <text x="${x + 12}" y="${ry + rowH / 2 + DS.fontSize.meta * 0.35}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.monoFamily}" font-weight="${isKey ? '700' : '400'}">${esc(attr)}</text>\n`;
  });
  return el;
}

/** Crow's-foot cardinality marks at each end of an ER relationship: "many"
 *  end gets a three-pronged foot, "one" end gets a single perpendicular tick.
 *  Reads cardinality from edge.label2 ("1"/"N"/"0..1"/"0..N"); defaults to a
 *  one-to-many relationship (the common case) when unspecified. */
export function renderErRelationship(edge: IREdge, pad: number, sketchy: boolean, stroke: string): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const pts = wps.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  let el = '';
  if (sketchy) {
    const seed = seedFor(edge.id);
    for (let i = 0; i < pts.length - 1; i++) {
      el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke, strokeWidth: 1.5, roughness: DS.roughness * 0.6, seed: seed + i });
    }
  } else {
    el += `    <polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.5"/>\n`;
  }
  el += crowsFoot(pts[0], pts[1], stroke, 'many');
  el += crowsFoot(pts[pts.length - 1], pts[pts.length - 2], stroke, 'one');
  if (edge.label) {
    const mid = pts[Math.floor((pts.length - 1) / 2)];
    el += `    <text x="${mid.x}" y="${mid.y - 8}" text-anchor="middle" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
  }
  return el;
}

function crowsFoot(at: Point, towards: Point, stroke: string, kind: 'one' | 'many'): string {
  const dx = towards.x - at.x, dy = towards.y - at.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len, ny = dy / len;
  const perpx = -ny, perpy = nx;
  const size = 12;
  if (kind === 'one') {
    const bx = at.x + nx * 6, by = at.y + ny * 6;
    return `    <line x1="${bx - perpx * 6}" y1="${by - perpy * 6}" x2="${bx + perpx * 6}" y2="${by + perpy * 6}" stroke="${stroke}" stroke-width="1.5"/>\n`;
  }
  const tipx = at.x, tipy = at.y;
  const bx = at.x + nx * size, by = at.y + ny * size;
  const l1x = bx - perpx * 7, l1y = by - perpy * 7;
  const l2x = bx + perpx * 7, l2y = by + perpy * 7;
  return `    <polyline points="${l1x},${l1y} ${tipx},${tipy} ${l2x},${l2y}" fill="none" stroke="${stroke}" stroke-width="1.5"/>\n`;
}

// -----------------------------------------------------------------------------
// Gantt — time axis + horizontal bars / milestone diamonds
// -----------------------------------------------------------------------------

export function renderGanttRow(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const isMilestone = !!(node.data as any)?.ganttMilestone;
  const seed = seedFor(node.id);
  let el = '';
  // Row label to the left of the chart area.
  el += `    <text x="${20 + pad}" y="${y + h / 2 + DS.fontSize.meta * 0.35}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}">${esc(node.label)}</text>\n`;
  if (isMilestone) {
    const cx = x + 12, cy = y + h / 2, r = 11;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: 2, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    el += sketchy
      ? roughPolygon([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], style)
      : `    <polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="2"/>\n`;
    return el;
  }
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  el += sketchy
    ? roughRect(x, y + 4, w, h - 8, style)
    : `    <rect x="${x}" y="${y + 4}" width="${w}" height="${h - 8}" rx="5" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  return el;
}

export function renderGanttDependency(edge: IREdge, pad: number, sketchy: boolean, stroke: string): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const pts = wps.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  let el = '';
  if (sketchy) {
    const seed = seedFor(edge.id);
    for (let i = 0; i < pts.length - 1; i++) el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke, strokeWidth: 1.25, roughness: 0.6, seed: seed + i });
  } else {
    el += `    <polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.25" stroke-dasharray="3,3"/>\n`;
  }
  return el;
}

// -----------------------------------------------------------------------------
// Mindmap — organic radial nodes + curved connectors
// -----------------------------------------------------------------------------

export function renderMindmapNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch, isRoot: boolean): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  const fill = isRoot ? swatch.stroke : swatch.fill;
  const textColor = isRoot ? '#ffffff' : swatch.text;
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: isRoot ? 2.25 : DS.stroke.node, fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${swatch.stroke}" stroke-width="${isRoot ? 2.25 : DS.stroke.node}"/>\n`;
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, textColor, node.label, 'middle', isRoot ? '700' : '500');
  return el;
}

export function renderMindmapBranch(edge: IREdge, pad: number, sketchy: boolean, stroke: string): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const a = { x: wps[0].x + pad, y: wps[0].y + pad };
  const b = { x: wps[wps.length - 1].x + pad, y: wps[wps.length - 1].y + pad };
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  // A gentle quadratic curve reads as an organic mindmap branch rather than a
  // rigid flowchart connector.
  if (sketchy) {
    const seed = seedFor(edge.id);
    return roughLine(a.x, a.y, mx, my, { stroke, strokeWidth: 2, roughness: 1.1, seed })
      + roughLine(mx, my, b.x, b.y, { stroke, strokeWidth: 2, roughness: 1.1, seed: seed + 1 });
  }
  return `    <path d="M ${a.x} ${a.y} Q ${mx} ${a.y} ${b.x} ${b.y}" fill="none" stroke="${stroke}" stroke-width="2"/>\n`;
}

// -----------------------------------------------------------------------------
// Sankey — proportional-width flow ribbons
// -----------------------------------------------------------------------------

export function renderSankeyNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(x + w / 2, y - 8, 0, DS.fontSize.meta, DS.fontFamily, DS.neutral.text, node.label, 'middle', '600');
  return el;
}

/** Draws a flow ribbon (filled band, not a stroked line) whose thickness is
 *  proportional to the edge's parsed weight, connecting the source's right
 *  edge to the target's left edge with a smooth S-curve. */
export function renderSankeyRibbon(edge: IREdge, pad: number, srcNode: IRNode, tgtNode: IRNode, weight: number, maxWeight: number, accentFill: string): string {
  const thickness = Math.max(6, (weight / maxWeight) * 60);
  const x1 = srcNode.position.x + srcNode.size.width + pad, y1 = srcNode.position.y + srcNode.size.height / 2 + pad;
  const x2 = tgtNode.position.x + pad, y2 = tgtNode.position.y + tgtNode.size.height / 2 + pad;
  const midx = (x1 + x2) / 2;
  const half = thickness / 2;
  const d = `M ${x1} ${y1 - half} C ${midx} ${y1 - half}, ${midx} ${y2 - half}, ${x2} ${y2 - half} ` +
    `L ${x2} ${y2 + half} C ${midx} ${y2 + half}, ${midx} ${y1 + half}, ${x1} ${y1 + half} Z`;
  let el = `    <path d="${d}" fill="${accentFill}" fill-opacity="0.55" stroke="none"/>\n`;
  if (edge.label) {
    el += `    <text x="${midx}" y="${(y1 + y2) / 2 - half - 4}" text-anchor="middle" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
  }
  return el;
}

// -----------------------------------------------------------------------------
// GitGraph — branch lanes + commit dots
// -----------------------------------------------------------------------------

const BRANCH_COLORS = [typeSwatch('gitgraph').stroke, seriesColor(1), seriesColor(4), seriesColor(6), seriesColor(2)];
function laneColor(lane: number): string { return BRANCH_COLORS[lane % BRANCH_COLORS.length]; }

export function renderGitCommit(node: IRNode, pad: number, sketchy: boolean): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const lane = (node.data as any)?.gitLane ?? 0;
  const color = laneColor(lane);
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: color, strokeWidth: 2, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughEllipse(cx, cy, w, h, style) : `    <circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="${DS.neutral.surface}" stroke="${color}" stroke-width="2.5"/>\n`;
  el += `    <text x="${cx}" y="${y + h + 16}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(node.label)}</text>\n`;
  return el;
}

export function renderGitLane(edge: IREdge, pad: number, sketchy: boolean, srcLane: number): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const pts = wps.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  const color = laneColor(srcLane);
  let el = '';
  if (sketchy) {
    const seed = seedFor(edge.id);
    for (let i = 0; i < pts.length - 1; i++) el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke: color, strokeWidth: 2.5, roughness: 0.7, seed: seed + i });
  } else {
    el += `    <polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>\n`;
  }
  return el;
}

// -----------------------------------------------------------------------------
// Chart — real bar geometry with axis + value labels
// -----------------------------------------------------------------------------

/** Parses "Category\nSeries1: 120  Series2: 80" style labels into a category
 *  name + numeric series. Falls back to a single bar reading the whole label
 *  as the category with value 1 when no numbers are present, so a chart
 *  block never renders empty. */
function parseChartCategory(label: string): { category: string; series: Array<{ name: string; value: number }> } {
  const lines = splitLabelLines(label);
  const category = lines[0];
  const series: Array<{ name: string; value: number }> = [];
  for (const line of lines.slice(1)) {
    const re = /([A-Za-z][\w ]*?)\s*:\s*(-?\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) series.push({ name: m[1].trim(), value: parseFloat(m[2]) });
  }
  if (series.length === 0) series.push({ name: category, value: 1 });
  return { category, series };
}

export function renderChartBar(node: IRNode, pad: number, sketchy: boolean, chartMax: number, seriesNames: string[]): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const { category, series } = parseChartCategory(node.label);
  const baselineY = y + h - 30;
  const usableH = h - 50;
  const barGap = 6;
  const barW = (w - barGap * (series.length - 1)) / Math.max(1, series.length);
  let el = '';
  // Axis baseline.
  el += `    <line x1="${x}" y1="${baselineY}" x2="${x + w}" y2="${baselineY}" stroke="${DS.neutral.stroke}" stroke-width="1"/>\n`;
  series.forEach((s, i) => {
    const barH = Math.max(2, (s.value / chartMax) * usableH);
    const bx = x + i * (barW + barGap);
    const by = baselineY - barH;
    const color = seriesColor(seriesNames.indexOf(s.name) >= 0 ? seriesNames.indexOf(s.name) : i);
    const style: RoughStyle = { stroke: color, strokeWidth: 1.5, fill: color, roughness: DS.roughness, fillStyle: 'solid', seed: seedFor(node.id + i) };
    el += sketchy ? roughRect(bx, by, barW, barH, style) : `    <rect x="${bx}" y="${by}" width="${barW}" height="${barH}" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="1.5"/>\n`;
    el += `    <text x="${bx + barW / 2}" y="${by - 5}" text-anchor="middle" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${s.value}</text>\n`;
  });
  el += `    <text x="${x + w / 2}" y="${baselineY + 20}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}" font-weight="600">${esc(category)}</text>\n`;
  return el;
}

export function renderChartLinePoint(node: IRNode, pad: number, chartMax: number): { x: number; y: number; value: number; category: string } {
  const { category, series } = parseChartCategory(node.label);
  const value = series[0]?.value ?? 0;
  const x = node.position.x + pad + node.size.width / 2;
  const baselineY = node.position.y + pad + node.size.height - 30;
  const usableH = node.size.height - 50;
  const y = baselineY - (value / chartMax) * usableH;
  return { x, y, value, category };
}

export function extractChartSeriesNames(nodes: IRNode[]): string[] {
  const names: string[] = [];
  for (const n of nodes) {
    const { series } = parseChartCategory(n.label);
    for (const s of series) if (!names.includes(s.name)) names.push(s.name);
  }
  return names;
}

export function extractChartMax(nodes: IRNode[]): number {
  let max = 1;
  for (const n of nodes) {
    const { series } = parseChartCategory(n.label);
    for (const s of series) max = Math.max(max, s.value);
  }
  return max;
}

/** Renders a pie chart across ALL nodes at once (a pie is one shape, not one
 *  per category) — called once by the engine instead of per-node when the
 *  diagram type is chart-pie. */
export function renderChartPie(nodes: IRNode[], pad: number, sketchy: boolean, bounds: { width: number; height: number }): string {
  const values = nodes.map((n) => parseChartCategory(n.label));
  const total = values.reduce((sum, v) => sum + (v.series[0]?.value ?? 0), 0) || 1;
  const cx = bounds.width / 2 + pad - 40, cy = bounds.height / 2 + pad, r = Math.min(bounds.width, bounds.height) / 2 - 60;
  let angle = -Math.PI / 2;
  let el = '';
  values.forEach((v, i) => {
    const value = v.series[0]?.value ?? 0;
    const frac = value / total;
    const sweep = frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const endAngle = angle + sweep;
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const largeArc = sweep > Math.PI ? 1 : 0;
    const color = seriesColor(i);
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    if (sketchy) {
      el += roughPolygon([[cx, cy], [x1, y1], [x2, y2]], { stroke: color, strokeWidth: 1.5, fill: color, roughness: DS.roughness, fillStyle: 'solid', seed: seedFor(v.category + i) });
      // roughPolygon approximates the arc with a straight edge; overlay the true arc path so slices still read correctly.
      el += `    <path d="${d}" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="1"/>\n`;
    } else {
      el += `    <path d="${d}" fill="${color}" fill-opacity="0.85" stroke="${DS.neutral.surface}" stroke-width="2"/>\n`;
    }
    const labelAngle = angle + sweep / 2;
    const lx = cx + (r + 24) * Math.cos(labelAngle), ly = cy + (r + 24) * Math.sin(labelAngle);
    el += `    <text x="${lx}" y="${ly}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}">${esc(v.category)} (${value})</text>\n`;
    angle = endAngle;
  });
  return el;
}
