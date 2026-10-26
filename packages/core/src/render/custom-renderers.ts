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

import type { IRNode, IREdge, IRGroup } from '../ir/types.js';
import type { Point } from '../types/common.js';
import { roughRect, roughEllipse, roughPolygon, roughLine, seedFor, type RoughStyle } from './rough.js';
import { arrowheadSvg } from './edge-layer.js';
import { DS, typeSwatch, roleSwatch, seriesColor, readableTextOn, blendHex, type Swatch } from './design-system.js';
import { chipRect } from './edge-label-placement.js';
import { ganttDayLabel } from './custom-layout.js';
import { FontWeight, FontStyle, type GroupStyle } from '../types/style.js';
import { escapeXml as esc } from './escape.js';
import { iconLabelLayout, balancedWrap, C4_DB_RY, C4_DB_LABEL_Y, C4_LABEL_PAD, C4_LABEL_LH } from './node-label-geometry.js';

function splitLabelLines(label: string): string[] {
  return (label || '').replace(/\\n/g, '\n').split('\n');
}

function textBlock(x: number, startY: number, lineHeight: number, fs: number, ff: string, color: string, label: string, anchor: 'middle' | 'start' | 'end' = 'middle', weight = '400'): string {
  const lines = splitLabelLines(label);
  const tspans = lines.map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${esc(line)}</tspan>`).join('');
  return `    <text text-anchor="${anchor}" fill="${color}" font-size="${fs}" font-family="${ff}" font-weight="${weight}">${tspans}</text>\n`;
}

/** Draw an icon node's label where node-label-geometry says it goes (beside or
 *  above the glyph, never on it). `off` is the diagram padding. */
function iconLabel(node: IRNode, off: number, color: string, weight: string): string {
  const L = iconLabelLayout(node);
  if (!L) return '';
  return textBlock(L.x + off, L.y + off, L.lineHeight, L.fontSize, DS.fontFamily, color, L.text, L.anchor, weight);
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
    const lifeStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.edge, seed };
    if (sketchy) {
      el += roughLine(cx, y + h, cx, bottom + pad, lifeStyle);
    } else {
      el += `    <line x1="${cx}" y1="${y + h}" x2="${cx}" y2="${bottom + pad}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" stroke-dasharray="5,4"/>\n`;
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
      el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke, strokeWidth: DS.stroke.node, roughness: DS.roughness * 0.7, seed: seed + i });
    }
  } else {
    const d = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const dashAttr = dashed ? ` stroke-dasharray="${DS.dash.edge}"` : '';
    el += `    <polyline points="${d}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"${dashAttr}/>\n`;
  }
  // Filled arrowhead at the final point.
  el += arrowheadSvg('flow', wps[wps.length - 2], wps[wps.length - 1], pad, stroke, DS.stroke.edge);

  if (edge.label && (edge.data as any)?.sequenceSelf) {
    // Self-message: label sits right of the loop, vertically centred on it.
    const lx = Math.max(...pts.map((p) => p.x)) + 8;
    const ly = (pts[0].y + pts[pts.length - 1].y) / 2;
    const chipW = Math.max(30, edge.label.length * 6.5 + 12);
    el += `    <rect x="${lx - 4}" y="${ly - 9}" width="${chipW}" height="18" rx="${DS.chip.rx}" fill="${DS.neutral.surface}" fill-opacity="0.95" stroke="${accent.stroke}" stroke-opacity="0.3" stroke-width="${DS.stroke.hairline}"/>\n`;
    el += `    <text x="${lx + 2}" y="${ly + 4}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
  } else if (edge.label) {
    const midx = (pts[0].x + pts[pts.length - 1].x) / 2;
    const midy = pts[0].y - 8;
    const chipW = Math.max(30, edge.label.length * 6.5 + 12);
    el += `    <rect x="${midx - chipW / 2}" y="${midy - 15}" width="${chipW}" height="18" rx="${DS.chip.rx}" fill="${DS.neutral.surface}" fill-opacity="0.95" stroke="${accent.stroke}" stroke-opacity="0.3" stroke-width="${DS.stroke.hairline}"/>\n`;
    el += `    <text x="${midx}" y="${midy - 2}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
  }
  return el;
}

// A UML combined-fragment box: an outlined rectangle with a notched title tab
// in the top-left carrying the operator (alt/opt/loop/…), the guard condition
// beside it, and dashed dividers for each else/critical section. Drawn behind
// the messages (see engine renderToSvg) so arrows sit on top of the frame.
export function renderSequenceFragment(
  box: { keyword: string; label?: string; x: number; y: number; width: number; height: number;
         dividers?: { label?: string; y: number }[] },
  pad: number, sketchy: boolean
): string {
  const x = box.x + pad, y = box.y + pad, w = box.width, h = box.height;
  const stroke = DS.neutral.edge;
  const seed = seedFor(box.keyword + box.x + box.y);
  let el = '';
  // Frame — a faint fill keeps nested fragments legible against each other.
  if (sketchy) {
    el += roughRect(x, y, w, h, { stroke, strokeWidth: DS.stroke.edge, fill: DS.neutral.surface, fillStyle: 'solid', roughness: DS.roughness * 0.6, seed });
  } else {
    el += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.chip.rx}" fill="${DS.neutral.surface}" fill-opacity="0.35" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
  }
  // Title tab: operator keyword in a notched box, guard beside it.
  const kw = box.keyword.toUpperCase();
  const tabW = Math.max(40, kw.length * 8 + 16);
  const tabH = 20;
  el += `    <path d="M ${x} ${y} h ${tabW} l -8 ${tabH} h ${-(tabW - 8)} Z" fill="${DS.neutral.surface}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
  el += `    <text x="${x + 8}" y="${y + 14}" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}" font-weight="700">${esc(kw)}</text>\n`;
  if (box.label) {
    el += `    <text x="${x + tabW + 6}" y="${y + 14}" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">[${esc(box.label)}]</text>\n`;
  }
  // else/critical section dividers: a dashed line across the box + the guard.
  for (const d of box.dividers ?? []) {
    const dy = d.y + pad;
    el += `    <line x1="${x}" y1="${dy}" x2="${x + w}" y2="${dy}" stroke="${stroke}" stroke-width="${DS.stroke.hairline}" stroke-dasharray="5,4"/>\n`;
    if (d.label) {
      el += `    <text x="${x + 8}" y="${dy + 13}" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">[${esc(d.label)}]</text>\n`;
    }
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
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.stroke, roughness: DS.roughness, fillStyle: 'solid', seed };
    return sketchy
      ? roughEllipse(cx, cy, r * 2, r * 2, style)
      : `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${swatch.stroke}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
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
  const ring: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: 'none', roughness: DS.roughness, seed };
  const dot: RoughStyle = { stroke: swatch.stroke, strokeWidth: 0, fill: swatch.stroke, roughness: DS.roughness, fillStyle: 'solid', seed: seed + 1 };
  let el = sketchy ? roughEllipse(cx, cy, rOuter * 2, rOuter * 2, ring) : `    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
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

const ER_HEADER_H = 34;
const ER_ROW_H = 26;
const ER_WIDTH = 200;

/** The box renderErEntity will actually draw for this label.
 *
 *  The layout MUST reserve exactly this. When the plugin hardcoded a size
 *  instead, the drawn table (a header plus one row per attribute) was shorter
 *  than the reserved box, so the layout engine anchored relationships on a
 *  border ~60px below the table and the line visibly stopped short of the
 *  entity it pointed at. */
export function erEntitySize(label: string): { width: number; height: number } {
  const { attrs } = parseErEntity(label);
  return { width: ER_WIDTH, height: ER_HEADER_H + Math.max(1, attrs.length) * ER_ROW_H };
}

export function renderErEntity(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width;
  const { name, attrs } = parseErEntity(node.label);
  const rowH = ER_ROW_H, headerH = ER_HEADER_H;
  const rows = attrs.length > 0 ? attrs : ['id'];
  const h = headerH + rows.length * rowH; // must equal erEntitySize().height
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
    if (i > 0) el += `    <line x1="${x}" y1="${ry}" x2="${x + w}" y2="${ry}" stroke="${DS.neutral.stroke}" stroke-width="${DS.stroke.hairline}" stroke-opacity="0.5"/>\n`;
    const isKey = /\bPK\b|\bid\b/i.test(attr.split(/\s+/)[0] || '');
    el += `    <text x="${x + 12}" y="${ry + rowH / 2 + DS.fontSize.meta * 0.35}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.monoFamily}" font-weight="${isKey ? '700' : '400'}">${esc(attr)}</text>\n`;
  });
  return el;
}

/** Crow's-foot cardinality marks at each end of an ER relationship: "many"
 *  end gets a three-pronged foot, "one" end gets a single perpendicular tick.
 *  Reads cardinality from edge.label2 ("1"/"N"/"0..1"/"0..N"); defaults to a
 *  one-to-many relationship (the common case) when unspecified. */
export function renderErRelationship(
  edge: IREdge,
  pad: number,
  sketchy: boolean,
  stroke: string,
  routed?: Point[],
  labelPos?: { x: number; y: number }
): string {
  // `routed` is the clipped/fanned polyline from the generic router; fall back
  // to the layout engine's raw points only if the caller couldn't resolve the
  // two entities.
  const wps = routed && routed.length >= 2 ? routed : edge.waypoints || [];
  if (wps.length < 2) return '';
  const pts = wps.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  let el = '';
  if (sketchy) {
    const seed = seedFor(edge.id);
    for (let i = 0; i < pts.length - 1; i++) {
      el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke, strokeWidth: DS.stroke.edge, roughness: DS.roughness * 0.6, seed: seed + i });
    }
  } else {
    el += `    <polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
  }
  // `A --> B` reads "one A relates to many B" — the crow's foot belongs on the
  // TARGET. These were swapped, which stated the opposite cardinality.
  el += crowsFoot(pts[0], pts[1], stroke, 'one');
  el += crowsFoot(pts[pts.length - 1], pts[pts.length - 2], stroke, 'many');
  if (edge.label) {
    // Prefer the shared anti-overlap placement; its candidates already avoid
    // other labels and node boxes. The raw midpoint is only a fallback, and
    // on an orthogonal route it lands on the corner against the target
    // border, where the node's fill paints over the chip.
    let lx: number, ly: number;
    if (labelPos) {
      lx = labelPos.x;
      ly = labelPos.y;
    } else {
      const i = Math.floor((pts.length - 1) / 2);
      const mid = pts[i], next = pts[i + 1] || mid;
      lx = (mid.x + next.x) / 2;
      ly = (mid.y + next.y) / 2;
    }
    // Chip behind the label so the relationship line doesn't strike through it.
    const chipW = Math.max(24, edge.label.length * 6.5 + 12);
    el += `    <rect x="${lx - chipW / 2}" y="${ly - 15}" width="${chipW}" height="18" rx="${DS.chip.rx}" fill="var(--seldia-label-bg, ${DS.neutral.surface})" fill-opacity="0.95" stroke="${stroke}" stroke-opacity="0.35" stroke-width="${DS.stroke.hairline}"/>\n`;
    el += `    <text x="${lx}" y="${ly - 2}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
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
    return `    <line x1="${bx - perpx * 6}" y1="${by - perpy * 6}" x2="${bx + perpx * 6}" y2="${by + perpy * 6}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
  }
  const tipx = at.x, tipy = at.y;
  const bx = at.x + nx * size, by = at.y + ny * size;
  const l1x = bx - perpx * 7, l1y = by - perpy * 7;
  const l2x = bx + perpx * 7, l2y = by + perpy * 7;
  return `    <polyline points="${l1x},${l1y} ${tipx},${tipy} ${l2x},${l2y}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
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
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    el += sketchy
      ? roughPolygon([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], style)
      : `    <polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    return el;
  }
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  el += sketchy
    ? roughRect(x, y + 4, w, h - 8, style)
    : `    <rect x="${x}" y="${y + 4}" width="${w}" height="${h - 8}" rx="${DS.radius}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  const days = (node.data as any)?.ganttDuration as number | undefined;
  // Fit test against the actual chip text ("8d", "10d"), not a flat 34px:
  // a 4-day bar is ~32px and easily holds "4d", so the old constant hid the
  // duration on every short task.
  const durationText = `${days}d`;
  if (days && w > durationText.length * DS.fontSize.small * 0.62 + 6) {
    el += `    <text x="${x + w / 2}" y="${y + h / 2 + DS.fontSize.small * 0.35}" text-anchor="middle" fill="${swatch.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}" font-weight="600">${days}d</text>\n`;
  }
  return el;
}

/** Renders the time-axis background: a light vertical gridline + "Mon D"
 *  tick label every week (7 days), drawn once behind every row/bar. Reads
 *  the axis geometry (minDay/dayWidth/leftPad/topPad) that layoutGantt
 *  stashed onto every node's data since the layout stage is the only place
 *  that knows the date-to-pixel mapping. */
export function renderGanttAxis(nodes: IRNode[], pad: number, bounds: { width: number; height: number }): string {
  const axis = nodes.find((n) => (n.data as any)?.ganttAxis)?.data as any;
  if (!axis?.ganttAxis) return '';
  const { minDay, dayWidth, leftPad, topPad, unit, unitDays } = axis.ganttAxis as {
    minDay: number; dayWidth: number; leftPad: number; topPad: number;
    unit?: 'day' | 'week' | 'month' | 'quarter' | 'year'; unitDays?: number;
  };
  // Tick spacing tracks whatever granularity layoutGantt picked for this
  // project's span (day/week/month/quarter/year) instead of always drawing
  // a fixed weekly grid — a 2-year roadmap would otherwise render hundreds
  // of illegible weekly hairlines, and a 2-week sprint would get one tick.
  const tickPx = dayWidth * (unitDays ?? 7);
  let el = '';
  const chartRight = bounds.width - pad - 10;
  for (let px = leftPad; px <= chartRight; px += tickPx) {
    const x = px + pad;
    el += `    <line x1="${x}" y1="${topPad - 10 + pad}" x2="${x}" y2="${bounds.height - pad}" stroke="${DS.neutral.stroke}" stroke-width="${DS.stroke.hairline}" stroke-opacity="0.25"/>\n`;
    const day = minDay + ((px - leftPad) / dayWidth);
    el += `    <text x="${x}" y="${topPad - 18 + pad}" text-anchor="middle" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${ganttDayLabel(day, unit)}</text>\n`;
  }
  return el;
}

export function renderGanttDependency(edge: IREdge, pad: number, sketchy: boolean, stroke: string): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const pts = wps.map((p) => ({ x: p.x + pad, y: p.y + pad }));
  let el = '';
  if (sketchy) {
    const seed = seedFor(edge.id);
    for (let i = 0; i < pts.length - 1; i++) el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke, strokeWidth: DS.stroke.edge, roughness: 0.6, seed: seed + i });
  } else {
    el += `    <polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}" stroke-dasharray="${DS.dash.edge}"/>\n`;
  }
  // Small filled arrowhead at the successor end — without it a dependency
  // line reads as a stray mark rather than a "finishes before" relationship.
  el += arrowheadSvg('flow', wps[wps.length - 2], wps[wps.length - 1], pad, stroke, DS.stroke.edge);
  return el;
}

// -----------------------------------------------------------------------------
// Mindmap — organic radial nodes + curved connectors
// -----------------------------------------------------------------------------

export function renderMindmapNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch, isRoot: boolean, branchColor: string): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  const depth = ((node.data as any)?.mindmapDepth as number) ?? (isRoot ? 0 : 1);
  const groupOpacity = isRoot ? 1 : Math.max(0.55, 1 - depth * 0.14);
  // Root uses its own swatch; branches use their assigned palette colour
  // so each main branch is visually distinct while its sub-branches keep
  // the same hue (just lighter with depth).
  const fill = isRoot ? swatch.stroke : branchColor;
  const textColor = readableTextOn(fill, isRoot ? '#ffffff' : swatch.text, groupOpacity);
  const strokeW = isRoot ? DS.stroke.emphasis : [DS.stroke.node, DS.stroke.node, DS.stroke.edge, DS.stroke.hairline][Math.min(3, Math.max(0, depth - 1))] ?? DS.stroke.hairline;
  const fontSize = isRoot ? DS.fontSize.title : [DS.fontSize.label, DS.fontSize.label, DS.fontSize.meta, DS.fontSize.small][Math.min(3, Math.max(0, depth - 1))];
  const style: RoughStyle = { stroke: branchColor, strokeWidth: strokeW, fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = `    <g opacity="${groupOpacity}">\n`;
  el += sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${branchColor}" stroke-width="${strokeW}"/>\n`;
  el += '    </g>\n';
  // The label stays outside the faded group so its contrast is the computed one.
  el += textBlock(cx, cy + fontSize * 0.35, Math.round(fontSize * 1.3), fontSize, DS.fontFamily, textColor, node.label, 'middle', isRoot ? '700' : depth <= 1 ? '600' : '500');
  return el;
}

export function renderMindmapBranch(edge: IREdge, pad: number, sketchy: boolean, branchColor: string): string {
  const wps = edge.waypoints || [];
  if (wps.length < 2) return '';
  const a = { x: wps[0].x + pad, y: wps[0].y + pad };
  const b = { x: wps[wps.length - 1].x + pad, y: wps[wps.length - 1].y + pad };
  // Quadratic Bézier: control point biased toward the start's horizontal
  // direction so branches radiate outward from the center node smoothly.
  const cpx = a.x + (b.x - a.x) * 0.65, cpy = a.y;
  if (sketchy) {
    const seed = seedFor(edge.id);
    const mx = (a.x + b.x) / 2;
    return roughLine(a.x, a.y, mx, a.y, { stroke: branchColor, strokeWidth: DS.stroke.node, roughness: 1.1, seed })
      + roughLine(mx, cpy, b.x, b.y, { stroke: branchColor, strokeWidth: DS.stroke.node, roughness: 1.1, seed: seed + 1 });
  }
  return `    <path d="M ${a.x} ${a.y} Q ${cpx} ${cpy} ${b.x} ${b.y}" fill="none" stroke="${branchColor}" stroke-width="${DS.stroke.node}"/>\n`;
}

// -----------------------------------------------------------------------------
// Sankey — proportional-width flow ribbons
// -----------------------------------------------------------------------------

export function renderSankeyNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(x + w / 2, y - 8, 0, DS.fontSize.meta, DS.fontFamily, DS.neutral.text, node.label, 'middle', '600');
  return el;
}

/** Draws a flow ribbon (filled band, not a stroked line) whose thickness is
 *  proportional to the edge's parsed weight, connecting the source's right
 *  edge to the target's left edge with a smooth S-curve. */
export function renderSankeyRibbon(edge: IREdge, pad: number, srcNode: IRNode, tgtNode: IRNode, weight: number, maxWeight: number, accentFill: string): string {
  const wp = edge.waypoints!;
  const thickness = ((edge.data as any)?.sankeyThick as number) ?? Math.max(6, (weight / maxWeight) * 60);
  const x1 = srcNode.position.x + srcNode.size.width + pad, y1 = wp[0].y + pad;
  const x2 = tgtNode.position.x + pad, y2 = wp[wp.length - 1].y + pad;
  const midx = (x1 + x2) / 2;
  const half = thickness / 2;
  const d = `M ${x1} ${y1 - half} C ${midx} ${y1 - half}, ${midx} ${y2 - half}, ${x2} ${y2 - half} ` +
    `L ${x2} ${y2 + half} C ${midx} ${y2 + half}, ${midx} ${y1 + half}, ${x1} ${y1 + half} Z`;
  const titleEl = edge.label ? `<title>${esc(`${srcNode.label} → ${tgtNode.label}: ${edge.label}`)}</title>` : '';
  let el = `    <path d="${d}" fill="${accentFill}" fill-opacity="0.55" stroke="none">${titleEl}</path>\n`;
  return el;
}

/** The value chip of a ribbon. Drawn after every ribbon and node so no later
 *  band can paint over it. */
export function renderSankeyChip(edge: IREdge, pad: number, srcNode: IRNode, tgtNode: IRNode): string {
  const ed = (edge.data || {}) as any;
  if (!edge.label || ed.sankeyLabelHidden || !edge.waypoints?.length) return '';
  const wp = edge.waypoints;
  const x1 = srcNode.position.x + srcNode.size.width + pad, x2 = tgtNode.position.x + pad;
  const midx = (x1 + x2) / 2;
  const ly = typeof ed.sankeyLabelY === 'number' ? ed.sankeyLabelY + pad : (wp[0].y + wp[wp.length - 1].y) / 2 + pad - 4;
  const cr = chipRect(midx, ly - 4, String(edge.label));
  return `    <rect x="${cr.x}" y="${cr.y}" width="${cr.width}" height="${cr.height}" rx="${DS.chip.rx}" fill="#ffffff" fill-opacity="0.92"/>\n`
    + `    <text x="${midx}" y="${ly}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(edge.label)}</text>\n`;
}


// -----------------------------------------------------------------------------
// C4 — person stick figures, tagged system/container/component boxes,
// dashed external-system boxes, database cylinders
// -----------------------------------------------------------------------------

const C4_TAG: Record<string, string> = {
  person: 'Person', system: 'System', systemExt: 'External System',
  container: 'Container', containerExt: 'External Container', containerDb: 'Database', component: 'Component',
};

export function renderC4Node(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.c4Kind as string) || 'system';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2;
  const seed = seedFor(node.id);
  const isExternal = kind === 'systemExt' || kind === 'containerExt';
  const fill = isExternal ? DS.neutral.surface : swatch.fill;
  const stroke = isExternal ? DS.neutral.muted : swatch.stroke;
  const textColor = isExternal ? DS.neutral.text : swatch.text;

  if (kind === 'person') {
    const cyHead = y + 22, r = 16;
    const style: RoughStyle = { stroke, strokeWidth: DS.stroke.node, fill: swatch.stroke, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy
      ? roughEllipse(cx, cyHead, r * 2, r * 2, style)
      : `    <circle cx="${cx}" cy="${cyHead}" r="${r}" fill="${swatch.stroke}" stroke="${stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const bodyY = cyHead + r + 4, bodyW = w * 0.7, bodyH = h - (bodyY - y) - 28;
    const bodyStyle: RoughStyle = { stroke, strokeWidth: DS.stroke.node, fill: swatch.stroke, roughness: DS.roughness, fillStyle: 'solid', seed: seed + 1 };
    el += sketchy
      ? roughRect(cx - bodyW / 2, bodyY, bodyW, bodyH, { ...bodyStyle })
      : `    <path d="M ${cx - bodyW / 2} ${bodyY + bodyH} Q ${cx - bodyW / 2} ${bodyY} ${cx} ${bodyY} Q ${cx + bodyW / 2} ${bodyY} ${cx + bodyW / 2} ${bodyY + bodyH} Z" fill="${swatch.stroke}" stroke="${stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += textBlock(cx, bodyY + bodyH + 16, 15, DS.fontSize.label, DS.fontFamily, textColor, node.label, 'middle', '600');
    el += textBlock(cx, bodyY + bodyH + 32, 12, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, `[${C4_TAG[kind]}]`, 'middle', '400');
    return el;
  }

  const isDb = kind === 'containerDb';
  const roughStyle: RoughStyle = { stroke, strokeWidth: DS.stroke.node, fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = '';
  if (isDb) {
    const ry = C4_DB_RY;
    el = sketchy
      ? roughRect(x, y + ry, w, h - ry * 2, roughStyle) + roughEllipse(cx, y + ry, w, ry * 2, roughStyle) + roughEllipse(cx, y + h - ry, w, ry * 2, roughStyle)
      : `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  } else {
    const dashAttr = isExternal ? ' stroke-dasharray="5,4"' : '';
    el = sketchy
      ? roughRect(x, y, w, h, { ...roughStyle, roughness: isExternal ? DS.roughness * 1.3 : DS.roughness })
      : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${DS.stroke.node}"${dashAttr}/>\n`;
  }
  let ty = y + (isDb ? C4_DB_LABEL_Y : 26);
  const c4Lines = balancedWrap(node.label, w - C4_LABEL_PAD, DS.fontSize.label);
  el += textBlock(cx, ty, C4_LABEL_LH, DS.fontSize.label, DS.fontFamily, textColor, c4Lines.join('\n'), 'middle', '600');
  ty += C4_LABEL_LH * c4Lines.length;
  el += textBlock(cx, ty, 12, DS.fontSize.small, DS.fontFamily, isExternal ? DS.neutral.muted : textColor, `[${C4_TAG[kind]}]`, 'middle', '400');
  const desc = (node.description as string | undefined);
  if (desc) {
    ty += 16;
    const wrapped = desc.length > 34 ? desc.slice(0, 32) + '…' : desc;
    el += textBlock(cx, ty, 13, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, wrapped, 'middle', '400');
  }
  return el;
}

// -----------------------------------------------------------------------------
// BPMN — industry-standard process diagram shapes with pools, lanes, events
// (with type glyphs: envelope=message, clock=timer, bolt=error), gateways
// (X=exclusive, +=parallel, O=inclusive), tasks (with corner glyphs:
// person=user, gear=service, scroll=script), data objects, data stores.
// -----------------------------------------------------------------------------

function bpmnTaskGlyph(x: number, y: number, kind: string, stroke: string): string {
  const gx = x + 8, gy = y + 8, gw = 16, gh = 14;
  switch (kind) {
    case 'userTask':
      return `<circle cx="${gx + gw/2}" cy="${gy + 4}" r="3.5" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <path d="M ${gx + 2} ${gy + 12} Q ${gx + gw/2} ${gy + 7} ${gx + gw - 2} ${gy + 12}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>`;
    case 'serviceTask':
      return `<circle cx="${gx + gw/2}" cy="${gy + gh/2}" r="3" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <line x1="${gx + gw/2}" y1="${gy + 1}" x2="${gx + gw/2}" y2="${gy + 3}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <line x1="${gx + gw/2}" y1="${gy + gh - 1}" x2="${gx + gw/2}" y2="${gy + gh - 3}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <line x1="${gx + 1}" y1="${gy + gh/2}" x2="${gx + 3}" y2="${gy + gh/2}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <line x1="${gx + gw - 1}" y1="${gy + gh/2}" x2="${gx + gw - 3}" y2="${gy + gh/2}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>`;
    case 'scriptTask':
      return `<rect x="${gx + 2}" y="${gy + 2}" width="${gw - 4}" height="${gh - 4}" rx="1" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.hairline}"/>
      <line x1="${gx + 5}" y1="${gy + 5}" x2="${gx + gw - 5}" y2="${gy + 5}" stroke="${stroke}" stroke-width="${DS.stroke.hairline}"/>
      <line x1="${gx + 5}" y1="${gy + 8}" x2="${gx + gw - 7}" y2="${gy + 8}" stroke="${stroke}" stroke-width="${DS.stroke.hairline}"/>`;
    default:
      return `<rect x="${gx + 4}" y="${gy + 4}" width="${gw - 8}" height="${gh - 8}" rx="1" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.hairline}"/>`;
  }
}

function bpmnGatewayMarker(cx: number, cy: number, kind: string, stroke: string, r: number): string {
  const m = r * 0.22;
  switch (kind) {
    case 'parallelGateway':
      return `<line x1="${cx - m}" y1="${cy}" x2="${cx + m}" y2="${cy}" stroke="${stroke}" stroke-width="${DS.stroke.emphasis}"/>
      <line x1="${cx}" y1="${cy - m}" x2="${cx}" y2="${cy + m}" stroke="${stroke}" stroke-width="${DS.stroke.emphasis}"/>`;
    case 'inclusiveGateway':
      return `<circle cx="${cx}" cy="${cy}" r="${m * 0.7}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.emphasis}"/>`;
    default:
      return `<line x1="${cx - m}" y1="${cy - m}" x2="${cx + m}" y2="${cy + m}" stroke="${stroke}" stroke-width="${DS.stroke.emphasis}"/>
      <line x1="${cx + m}" y1="${cy - m}" x2="${cx - m}" y2="${cy + m}" stroke="${stroke}" stroke-width="${DS.stroke.emphasis}"/>`;
  }
}

function bpmnEventGlyph(cx: number, cy: number, r: number, kind: string, stroke: string): string {
  const s = r * 0.45;
  switch (kind) {
    case 'messageEvent':
      return `<rect x="${cx - s}" y="${cy - s * 0.65}" width="${s * 2}" height="${s * 1.3}" rx="1.5" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <path d="M ${cx - s} ${cy - s * 0.65} L ${cx} ${cy + s * 0.15} L ${cx + s} ${cy - s * 0.65}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>`;
    case 'timerEvent':
      return `<circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - s * 0.6}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>
      <line x1="${cx}" y1="${cy}" x2="${cx + s * 0.5}" y2="${cy}" stroke="${stroke}" stroke-width="${DS.stroke.edge}"/>`;
    case 'errorEvent':
      return `<polygon points="${cx - s * 0.3},${cy - s * 0.9} ${cx + s * 0.15},${cy - s * 0.1} ${cx + s * 0.1},${cy - s * 0.1} ${cx + s * 0.4},${cy + s * 0.9} ${cx - s * 0.05},${cy + s * 0.1} ${cx - s * 0.2},${cy + s * 0.1}" fill="${stroke}" stroke="none"/>`;
    case 'terminateEvent':
      return `<circle cx="${cx}" cy="${cy}" r="${s * 0.5}" fill="${stroke}" stroke="none"/>`;
    default: return '';
  }
}

export function renderBpmnNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.bpmnKind as string) || 'task';
  const subKind = ((node.data as any)?.bpmnSubKind as string) || '';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);

  // ── Pool ──
  if (kind === 'pool') {
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: DS.neutral.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy ? roughRect(x, y, w, h, style)
      : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${DS.neutral.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += `    <text x="${x + 16}" y="${cy}" text-anchor="middle" fill="${swatch.stroke}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}" font-weight="700" transform="rotate(-90, ${x + 16}, ${cy})">${esc(node.label)}</text>\n`;
    const lanes = (node.data as any)?.lanes as string[] | undefined;
    if (lanes && lanes.length > 1) {
      const laneH = h / lanes.length;
      for (let i = 1; i < lanes.length; i++) {
        const ly = y + i * laneH;
        el += `    <line x1="${x + 36}" y1="${ly}" x2="${x + w}" y2="${ly}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}" stroke-dasharray="4,3" opacity="0.5"/>\n`;
        el += `    <text x="${x + 44}" y="${ly - 4}" text-anchor="start" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(lanes[i - 1])}</text>\n`;
      }
    }
    return el;
  }

  // ── Lane ──
  if (kind === 'lane') {
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.hairline, fill: 'none', roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy ? roughRect(x, y, w, h, style)
      : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}" stroke-dasharray="6,4"/>\n`;
    el += `    <text x="${x + 8}" y="${y + 16}" text-anchor="start" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}" font-weight="600">${esc(node.label)}</text>\n`;
    return el;
  }

  // ── Data Object ──
  if (kind === 'dataObject') {
    const fold = 16;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el: string;
    if (sketchy) {
      el = roughPolygon([[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]], style);
      el += roughLine(x + w - fold, y, x + w, y + fold, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, seed });
    } else {
      el = `    <path d="M ${x} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h} H ${x} Z" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <path d="M ${x + w - fold} ${y} V ${y + fold} H ${x + w}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    }
    el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
    return el;
  }

  // ── Events ──
  if (kind === 'startEvent' || kind === 'endEvent' || kind === 'intermediateEvent') {
    const role = kind === 'startEvent' ? roleSwatch('start') : kind === 'endEvent' ? roleSwatch('stop') : swatch;
    const r = Math.min(w, h) / 2;
    const ringWidth = kind === 'endEvent' ? 3.5 : kind === 'intermediateEvent' ? 2 : 1.75;
    const style: RoughStyle = { stroke: role.stroke, strokeWidth: ringWidth, fill: role.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy ? roughEllipse(cx, cy, r * 2, r * 2, style)
      : `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${role.fill}" stroke="${role.stroke}" stroke-width="${ringWidth}"/>\n`;
    if (kind === 'intermediateEvent') {
      el += sketchy ? roughEllipse(cx, cy, r * 2 - 10, r * 2 - 10, { ...style, fill: 'none' })
        : `    <circle cx="${cx}" cy="${cy}" r="${r - 5}" fill="none" stroke="${role.stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
    }
    el += bpmnEventGlyph(cx, cy, r, subKind, role.stroke);
    el += iconLabel(node, pad, DS.neutral.text, '500');
    return el;
  }

  // ── Gateway ──
  if (kind === 'gateway') {
    const role = roleSwatch('decision');
    const style: RoughStyle = { stroke: role.stroke, strokeWidth: DS.stroke.node, fill: role.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy ? roughPolygon([[cx, y], [x + w, cy], [cx, y + h], [x, cy]], style)
      : `    <polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${role.fill}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += bpmnGatewayMarker(cx, cy, subKind || 'exclusiveGateway', role.stroke, Math.min(w, h) / 2);
    el += iconLabel(node, pad, DS.neutral.text, '500');
    return el;
  }

  // ── Task ──
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += bpmnTaskGlyph(x, y, subKind || 'abstractTask', swatch.stroke);
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// DMN — input columns (document shape) + rule rows (condition → outcome,
// outcome colored by APPROVE/DENY/REVIEW-style verdict)
// -----------------------------------------------------------------------------

const DMN_OUTCOME_ROLE: Record<string, 'success' | 'error' | 'decision'> = {
  approve: 'success', accept: 'success', allow: 'success',
  deny: 'error', reject: 'error', decline: 'error',
  review: 'decision', escalate: 'decision', hold: 'decision',
};

function dmnOutcomeSwatch(outcome: string) {
  const key = outcome.trim().toLowerCase();
  const role = DMN_OUTCOME_ROLE[key];
  return role ? roleSwatch(role) : undefined;
}

/** Splits a DMN node's label into its DSL-conventional parts: `Input: ...`
 *  nodes are a single description line; `Rule: Name\ncondition\n-> OUTCOME`
 *  nodes are a rule name, a condition line, and a trailing outcome. */
function parseDmnLabel(label: string): { isRule: boolean; title: string; condition?: string; outcome?: string } {
  const lines = splitLabelLines(label);
  const first = lines[0] || '';
  if (/^rule\s*:/i.test(first)) {
    const title = first.replace(/^rule\s*:\s*/i, '');
    const rest = lines.slice(1);
    const outcomeLine = rest.find((l) => /^->/.test(l.trim()));
    const outcome = outcomeLine ? outcomeLine.trim().replace(/^->\s*/, '') : undefined;
    const condition = rest.filter((l) => l !== outcomeLine).join(' ');
    return { isRule: true, title, condition, outcome };
  }
  const title = first.replace(/^input\s*:\s*/i, '');
  return { isRule: false, title };
}

export function renderDmnNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const dmnKind = ((node.data as any)?.dmnKind as string) || '';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  const { isRule, title, condition, outcome } = parseDmnLabel(node.label);

  // ── Knowledge Source: document with wavy bottom ──
  if (dmnKind === 'knowledgeSource' || (!isRule && /knowledge|source|authority/i.test(title))) {
    const waveY = y + h - 12;
    const d = `M ${x} ${y} H ${x + w} V ${waveY} Q ${x + w * 0.75} ${waveY + 14} ${cx} ${waveY} Q ${x + w * 0.25} ${waveY - 14} ${x} ${waveY} Z`;
    let el = sketchy
      ? roughRect(x, y, w, h - 6, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed })
      : `    <path d="${d}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += textBlock(cx, y + h / 2 - 4, 15, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, 'KNOWLEDGE', 'middle', '700');
    el += textBlock(cx, y + h / 2 + 12, 15, DS.fontSize.meta, DS.fontFamily, swatch.text, title, 'middle', '600');
    return el;
  }

  // ── Input Data: oval ──
  if (dmnKind === 'inputData' || (!isRule && !/knowledge|source/i.test(title))) {
    let el = sketchy
      ? roughEllipse(cx, cy, w, h, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed })
      : `    <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}" stroke-dasharray="4,2"/>\n`;
    el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.meta, DS.fontFamily, swatch.text, title || node.label, 'middle', '600');
    return el;
  }

  // ── Decision / Rule table ──
  const headerH = 26, condH = h - headerH - 30;
  const outcomeSwatch = outcome ? dmnOutcomeSwatch(outcome) : undefined;
  const isDecision = dmnKind === 'decision';
  const cornerRx = isDecision ? 0 : DS.radius; // Decision: sharp corners; Rule: rounded
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${cornerRx}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  // Header bar.
  el += `    <path d="M ${x} ${y + cornerRx} Q ${x} ${y} ${x + cornerRx} ${y} H ${x + w - cornerRx} Q ${x + w} ${y} ${x + w} ${y + cornerRx} V ${y + headerH} H ${x} Z" fill="${swatch.fill}"/>\n`;
  el += `    <text x="${cx}" y="${y + headerH / 2 + 5}" text-anchor="middle" font-weight="700" fill="${swatch.text}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}">${esc(title || 'Decision')}</text>\n`;
  if (condition) {
    el += `    <line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.divider}" opacity="0.5"/>\n`;
    el += `    <text x="${x + 10}" y="${y + headerH + condH / 2 + 4}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.small}" font-family="${DS.monoFamily}">${esc(condition.length > 30 ? condition.slice(0, 28) + '…' : condition)}</text>\n`;
  }
  if (outcome) {
    const oy = y + h - 24;
    const os = outcomeSwatch || { stroke: swatch.stroke, fill: swatch.fill, text: swatch.text, accent: swatch.stroke };
    el += `    <rect x="${x}" y="${oy}" width="${w}" height="24" rx="0" fill="${os.fill}"/>\n`;
    el += `    <text x="${cx}" y="${oy + 16}" text-anchor="middle" font-weight="700" fill="${os.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(outcome)}</text>\n`;
  }
  return el;
}

// -----------------------------------------------------------------------------
// Use Case — actor stick figure vs use-case oval
// -----------------------------------------------------------------------------

export function renderUsecaseNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.usecaseKind as string) || 'usecase';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  if (kind === 'actor') {
    const role = roleSwatch('external');
    const r = 14, headCy = y + r + 4;
    const style: RoughStyle = { stroke: role.stroke, strokeWidth: DS.stroke.node, fill: 'none', roughness: DS.roughness, seed };
    let el = sketchy
      ? roughEllipse(cx, headCy, r * 2, r * 2, style)
      : `    <circle cx="${cx}" cy="${headCy}" r="${r}" fill="none" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const neckY = headCy + r, armY = neckY + 18, torsoY = neckY + 34, legY = y + h - 20;
    const lineStyle: Omit<RoughStyle, 'fill'> = { stroke: role.stroke, strokeWidth: DS.stroke.node, roughness: DS.roughness, seed: seed + 1 };
    if (sketchy) {
      el += roughLine(cx, neckY, cx, torsoY, lineStyle);
      el += roughLine(cx - w * 0.32, armY, cx + w * 0.32, armY, lineStyle);
      el += roughLine(cx, torsoY, cx - w * 0.28, legY, lineStyle);
      el += roughLine(cx, torsoY, cx + w * 0.28, legY, lineStyle);
    } else {
      el += `    <line x1="${cx}" y1="${neckY}" x2="${cx}" y2="${torsoY}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <line x1="${cx - w * 0.32}" y1="${armY}" x2="${cx + w * 0.32}" y2="${armY}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <line x1="${cx}" y1="${torsoY}" x2="${cx - w * 0.28}" y2="${legY}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <line x1="${cx}" y1="${torsoY}" x2="${cx + w * 0.28}" y2="${legY}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    }
    el += textBlock(cx, y + h - 4, 14, DS.fontSize.small, DS.fontFamily, DS.neutral.text, node.label, 'middle', '600');
    return el;
  }
  // Use-case oval.
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughEllipse(cx, cy, w, h, style)
    : `    <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// Activity — filled start dot, ringed end dot, diamond decision, rounded action
// -----------------------------------------------------------------------------

export function renderActivityNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.activityKind as string) || 'action';
  const label = ((node.data as any)?.activityLabel as string) || node.label;
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);

  if (kind === 'start') {
    const role = roleSwatch('start');
    const r = Math.min(w, h) / 2 - 4;
    const style: RoughStyle = { stroke: role.stroke, strokeWidth: DS.stroke.node, fill: role.stroke, roughness: DS.roughness, fillStyle: 'solid', seed };
    return sketchy ? roughEllipse(cx, cy, r * 2, r * 2, style) : `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${role.stroke}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  }
  if (kind === 'end') {
    const role = roleSwatch('stop');
    const rOuter = Math.min(w, h) / 2 - 2, rInner = rOuter - 6;
    const ring: RoughStyle = { stroke: role.stroke, strokeWidth: DS.stroke.emphasis, fill: 'none', roughness: DS.roughness, seed };
    const dot: RoughStyle = { stroke: role.stroke, strokeWidth: 0, fill: role.stroke, roughness: DS.roughness, fillStyle: 'solid', seed: seed + 1 };
    let el = sketchy ? roughEllipse(cx, cy, rOuter * 2, rOuter * 2, ring) : `    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="${role.stroke}" stroke-width="${DS.stroke.emphasis}"/>\n`;
    el += sketchy ? roughEllipse(cx, cy, rInner * 2, rInner * 2, dot) : `    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="${role.stroke}"/>\n`;
    return el;
  }
  if (kind === 'decision') {
    const role = roleSwatch('decision');
    const style: RoughStyle = { stroke: role.stroke, strokeWidth: DS.stroke.node, fill: role.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy
      ? roughPolygon([[cx, y], [x + w, cy], [cx, y + h], [x, cy]], style)
      : `    <polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${role.fill}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += textBlock(cx, cy + DS.fontSize.small * 0.35, Math.round(DS.fontSize.small * 1.2), DS.fontSize.small, DS.fontFamily, role.text, label, 'middle', '600');
    return el;
  }
  // Action — rounded rectangle, the UML activity default.
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// Deployment — 3D "node" boxes (UML deployment-diagram device notation): a
// front face plus a offset top/side face, giving the classic isometric-cube look.
// -----------------------------------------------------------------------------

export function renderDeploymentNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.deploymentKind as string) || 'node';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const seed = seedFor(node.id);
  if (kind === 'datastore') {
    const cx = x + w / 2, ry = 10;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy
      ? roughRect(x, y + ry, w, h - ry * 2, style) + roughEllipse(cx, y + ry, w, ry * 2, style) + roughEllipse(cx, y + h - ry, w, ry * 2, style)
      : `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const dsLines = balancedWrap(node.label, w - 24, DS.fontSize.label);
    el += textBlock(cx, y + h / 2 + 5 - ((dsLines.length - 1) * 15) / 2, 15, DS.fontSize.label, DS.fontFamily, swatch.text, dsLines.join('\n'), 'middle', '600');
    return el;
  }
  if (kind === 'artifact') {
    // Document-with-folded-corner glyph — the UML artifact notation,
    // distinguishing a deployable file from the box that hosts it.
    const foldSz = 18;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    const pts: [number, number][] = [[x, y], [x + w - foldSz, y], [x + w, y + foldSz], [x + w, y + h], [x, y + h]];
    let el = sketchy ? roughPolygon(pts, style) : `    <polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += `    <polyline points="${x + w - foldSz},${y} ${x + w - foldSz},${y + foldSz} ${x + w},${y + foldSz}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += textBlock(x + w / 2, y + h / 2 - 6, 16, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, '«artifact»', 'middle', '400');
    el += textBlock(x + w / 2, y + h / 2 + 12, 16, DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
    return el;
  }
  if (kind === 'device') {
    // A node cube with a small screen rectangle inset near the top — reads as
    // a physical device (phone/tablet/IoT box) rather than a generic server.
    const depth = 14;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    const topStyle: RoughStyle = { ...style, fill: DS.neutral.surface, seed: seed + 1 };
    const sideStyle: RoughStyle = { ...style, seed: seed + 2 };
    let el = '';
    const topPts: [number, number][] = [[x, y], [x + depth, y - depth], [x + w + depth, y - depth], [x + w, y]];
    const sidePts: [number, number][] = [[x + w, y], [x + w + depth, y - depth], [x + w + depth, y + h - depth], [x + w, y + h]];
    el += sketchy ? roughPolygon(topPts, topStyle) : `    <polygon points="${topPts.map((p) => p.join(',')).join(' ')}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += sketchy ? roughPolygon(sidePts, sideStyle) : `    <polygon points="${sidePts.map((p) => p.join(',')).join(' ')}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}" fill-opacity="0.6"/>\n`;
    el += sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const screenW = w * 0.34, screenH = h * 0.4, screenX = x + w / 2 - screenW / 2, screenY = y + 10;
    el += `    <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="${DS.chip.rx}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" opacity="0.7"/>\n`;
    el += textBlock(x + w / 2, y + h / 2 + 14, 16, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, '«device»', 'middle', '400');
    el += textBlock(x + w / 2, y + h - 8, 16, DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
    return el;
  }
  if (kind === 'executionEnvironment') {
    // Dashed-border container — UML's «execution environment» convention
    // (a runtime/sandbox hosting artifacts, visually lighter than a «node»
    // box so it reads as "environment" rather than "physical hardware").
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: 'none', roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy
      ? roughRect(x, y, w, h, style)
      : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}" stroke-dasharray="6,4"/>\n`;
    el += textBlock(x + w / 2, y + h / 2 - 6, 16, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, '«execution environment»', 'middle', '400');
    el += textBlock(x + w / 2, y + h / 2 + 12, 16, DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
    return el;
  }
  const depth = 14; // isometric offset for the top + side faces
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  const topStyle: RoughStyle = { ...style, fill: DS.neutral.surface, seed: seed + 1 };
  const sideStyle: RoughStyle = { ...style, seed: seed + 2 };
  let el = '';
  // Top face (parallelogram) and side face (parallelogram) drawn first so the front face sits on top.
  const topPts: [number, number][] = [[x, y], [x + depth, y - depth], [x + w + depth, y - depth], [x + w, y]];
  const sidePts: [number, number][] = [[x + w, y], [x + w + depth, y - depth], [x + w + depth, y + h - depth], [x + w, y + h]];
  el += sketchy ? roughPolygon(topPts, topStyle) : `    <polygon points="${topPts.map((p) => p.join(',')).join(' ')}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += sketchy ? roughPolygon(sidePts, sideStyle) : `    <polygon points="${sidePts.map((p) => p.join(',')).join(' ')}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}" fill-opacity="0.6"/>\n`;
  el += sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(x + w / 2, y + h / 2 - 6, 16, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, '«node»', 'middle', '400');
  el += textBlock(x + w / 2, y + h / 2 + 12, 16, DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// Component — UML component box (rectangle + stub tabs on the left edge)
// -----------------------------------------------------------------------------

export function renderComponentNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.componentKind as string) || 'component';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  if (kind === 'datastore') {
    const ry = 10;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy
      ? roughRect(x, y + ry, w, h - ry * 2, style) + roughEllipse(cx, y + ry, w, ry * 2, style) + roughEllipse(cx, y + h - ry, w, ry * 2, style)
      : `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    // Centred on the cylinder's face — the band between the two ellipses. An
    // offset large enough to reach the lower ellipse draws the label straight
    // through its curve, which reads as a strikethrough.
    const dsLines = balancedWrap(node.label, w - 24, DS.fontSize.label);
    el += textBlock(cx, y + h / 2 + 5 - ((dsLines.length - 1) * 15) / 2, 15, DS.fontSize.label, DS.fontFamily, swatch.text, dsLines.join('\n'), 'middle', '600');
    return el;
  }
  if (kind === 'interface') {
    // Provided-interface "lollipop" — a plain circle on a short stem, the
    // UML shorthand for an interface rather than an implementing component.
    const r = Math.min(w, h) / 2 - 4;
    const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = `    <line x1="${cx}" y1="${y}" x2="${cx}" y2="${cy - r}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += sketchy ? roughEllipse(cx, cy, r * 2, r * 2, style) : `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += textBlock(cx, y + h + 4, Math.round(w * 1.4), DS.fontSize.small, DS.fontFamily, DS.neutral.text, node.label, 'middle', '600');
    return el;
  }
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  // Two stub tabs straddling the left edge — the UML component-icon signature.
  const tabW = 20, tabH = 10;
  const tab1Y = y + h * 0.28 - tabH / 2, tab2Y = y + h * 0.68 - tabH / 2;
  [tab1Y, tab2Y].forEach((ty, i) => {
    el += sketchy
      ? roughRect(x - tabW / 2, ty, tabW, tabH, { ...style, seed: seed + 10 + i })
      : `    <rect x="${x - tabW / 2}" y="${ty}" width="${tabW}" height="${tabH}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  });
  const stereotype = kind === 'service' ? '«service»' : '«component»';
  el += textBlock(cx, y + 20, 15, DS.fontSize.small, DS.fontFamily, DS.neutral.muted, stereotype, 'middle', '400');
  el += textBlock(cx, cy + 10, 15, DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// Network — router hexagon / switch bar / server+workstation rack glyph
// -----------------------------------------------------------------------------

export function renderNetworkNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.networkKind as string) || 'workstation';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };

  if (kind === 'router') {
    const pts: [number, number][] = [[cx, y], [x + w, y + h * 0.25], [x + w, y + h * 0.75], [cx, y + h], [x, y + h * 0.75], [x, y + h * 0.25]];
    let el = sketchy ? roughPolygon(pts, style) : `    <polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    // Signal-arc glyph — two concentric arcs, evoking a wireless/router icon.
    for (const r of [10, 16]) {
      el += `    <path d="M ${cx - r} ${cy + r * 0.3} A ${r} ${r} 0 0 1 ${cx + r} ${cy + r * 0.3}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" opacity="0.7"/>\n`;
    }
    el += iconLabel(node, pad, DS.neutral.text, '600');
    return el;
  }
  if (kind === 'switch') {
    let el = sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    // Row of port ticks along the bottom — the switch's visual signature.
    const ports = 6, portGap = w / (ports + 1);
    for (let i = 1; i <= ports; i++) {
      const px = x + portGap * i;
      el += `    <rect x="${px - 4}" y="${y + h - 12}" width="8" height="8" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}"/>\n`;
    }
    el += textBlock(cx, y + h / 2 - 6, 15, DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
    return el;
  }
  if (kind === 'firewall') {
    // Hexagon body (like router) with a brick-wall pattern — the
    // conventional "brick wall" firewall icon, distinguishing it from the
    // router's signal-arc glyph even though both use the same silhouette.
    const pts: [number, number][] = [[cx, y], [x + w, y + h * 0.25], [x + w, y + h * 0.75], [cx, y + h], [x, y + h * 0.75], [x, y + h * 0.25]];
    let el = sketchy ? roughPolygon(pts, style) : `    <polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const rows = 3, brickH = 8, brickW = 16;
    for (let r = 0; r < rows; r++) {
      const ry = cy - rows * brickH / 2 + r * brickH;
      const offset = r % 2 === 0 ? 0 : brickW / 2;
      for (let bx = x + 14 - offset; bx < x + w - 10; bx += brickW) {
        el += `    <rect x="${Math.max(x + 10, bx)}" y="${ry}" width="${brickW - 2}" height="${brickH - 2}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}" opacity="0.6"/>\n`;
      }
    }
    el += iconLabel(node, pad, DS.neutral.text, '600');
    return el;
  }
  if (kind === 'cloud' || kind === 'internet') {
    // Classic "cloud" silhouette built from three overlapping ellipses over a
    // base — the universal network-diagram glyph for an external/hosted
    // boundary. Overlapping ellipses (rather than one arced path) draw with
    // the same rough/plain helper every other glyph in this file uses.
    const baseW = w * 0.86, baseH = h * 0.42, baseY = cy + h * 0.08;
    let el = sketchy
      ? roughEllipse(cx, baseY, baseW, baseH, style)
      : `    <ellipse cx="${cx}" cy="${baseY}" rx="${baseW / 2}" ry="${baseH / 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const puffs: [number, number, number, number][] = [
      [cx - w * 0.22, cy - h * 0.06, w * 0.42, h * 0.4],
      [cx + w * 0.06, cy - h * 0.16, w * 0.5, h * 0.46],
      [cx + w * 0.28, cy - h * 0.02, w * 0.36, h * 0.34],
    ];
    for (const [pcx, pcy, pw, ph] of puffs) {
      el += sketchy
        ? roughEllipse(pcx, pcy, pw, ph, style)
        : `    <ellipse cx="${pcx}" cy="${pcy}" rx="${pw / 2}" ry="${ph / 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    }
    el += iconLabel(node, pad, DS.neutral.text, '600');
    return el;
  }
  if (kind === 'loadbalancer') {
    // Rectangle with a fan-out glyph (one line splitting into three) — reads
    // as "distributes traffic" at a glance, unlike a plain box.
    let el = sketchy ? roughRect(x, y, w, h * 0.62, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h * 0.62}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const topY = y + 8, forkY = y + h * 0.3, botY = y + h * 0.54;
    el += `    <line x1="${cx}" y1="${topY}" x2="${cx}" y2="${forkY}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
    for (const fx of [x + w * 0.28, cx, x + w * 0.72]) {
      el += `    <line x1="${cx}" y1="${forkY}" x2="${fx}" y2="${botY}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
      el += `    <circle cx="${fx}" cy="${botY}" r="3" fill="${swatch.stroke}"/>\n`;
    }
    el += iconLabel(node, pad, DS.neutral.text, '700');
    return el;
  }
  if (kind === 'database' || kind === 'storage') {
    // Cylinder for database, stacked-disk cylinder trio for storage/NAS —
    // both readable as "data at rest" rather than a compute node.
    const ry = Math.min(14, h * 0.14);
    const cylStyle: RoughStyle = { ...style };
    let el = sketchy
      ? roughRect(x, y + ry, w, h - ry * 2, cylStyle) + roughEllipse(cx, y + ry, w, ry * 2, cylStyle) + roughEllipse(cx, y + h - ry, w, ry * 2, cylStyle)
      : `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    if (kind === 'storage') {
      for (const frac of [0.35, 0.55, 0.75]) {
        el += `    <line x1="${x + 8}" y1="${y + h * frac}" x2="${x + w - 8}" y2="${y + h * frac}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}" opacity="0.5"/>\n`;
      }
    }
    el += iconLabel(node, pad, DS.neutral.text, '600');
    return el;
  }
  if (kind === 'accesspoint') {
    // A small dome + upward signal arcs — distinct from the router's
    // hexagon-with-arcs so a wireless AP doesn't read as "a router".
    let el = `    <path d="M ${x + w * 0.3} ${y + h * 0.6} Q ${cx} ${y + h * 0.3} ${x + w * 0.7} ${y + h * 0.6} Z" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    el += `    <line x1="${x + w * 0.3}" y1="${y + h * 0.6}" x2="${x + w * 0.7}" y2="${y + h * 0.6}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    for (const r of [8, 14, 20]) {
      el += `    <path d="M ${cx - r} ${y + h * 0.3 - r * 0.15} A ${r} ${r} 0 0 1 ${cx + r} ${y + h * 0.3 - r * 0.15}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" opacity="0.6"/>\n`;
    }
    el += iconLabel(node, pad, DS.neutral.text, '600');
    return el;
  }
  // server / workstation — a monitor-like rectangle on a small stand.
  const screenH = h * 0.68;
  let el = sketchy ? roughRect(x, y, w, screenH, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${screenH}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  const standW = w * 0.3, standX = cx - standW / 2, standY = y + screenH;
  el += `    <rect x="${standX}" y="${standY}" width="${standW}" height="8" fill="${swatch.stroke}"/>\n`;
  el += `    <rect x="${cx - w * 0.22}" y="${standY + 8}" width="${w * 0.44}" height="6" rx="2" fill="${swatch.stroke}"/>\n`;
  if (kind === 'server') {
    // Horizontal rack-unit lines inside the box.
    for (const frac of [0.3, 0.55, 0.8]) {
      el += `    <line x1="${x + 10}" y1="${y + screenH * frac}" x2="${x + w - 10}" y2="${y + screenH * frac}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}" opacity="0.5"/>\n`;
    }
  }
  el += iconLabel(node, pad, DS.neutral.text, '600');
  return el;
}

// -----------------------------------------------------------------------------
// Form — field row: label + type/required badge, or an option pill row for
// select-style fields, or a stadium submit button
// -----------------------------------------------------------------------------

export function renderFormNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const field = (node.data as any)?.formField as { name: string; type: string; required: boolean; options?: string[] } | undefined;
  const isSubmit = !!(node.data as any)?.formSubmit;
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);

  if (isSubmit) {
    const role = roleSwatch('start');
    const style: RoughStyle = { stroke: role.stroke, strokeWidth: DS.stroke.node, fill: role.stroke, roughness: DS.roughness, fillStyle: 'solid', seed };
    let el = sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${role.stroke}" stroke="${role.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    const label = field ? field.name : node.label;
    el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, readableTextOn(role.stroke, '#ffffff'), label, 'middle', '600');
    return el;
  }

  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughRect(x, y, w, h, style) : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${DS.neutral.surface}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  if (!field) {
    el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
    return el;
  }
  el += textBlock(x + 14, y + 22, 16, DS.fontSize.meta, DS.fontFamily, swatch.text, field.name, 'start', '700');
  if (field.type === 'select' && field.options) {
    const opts = field.options.slice(0, 3);
    let ox = x + 14;
    const oy = y + h - 18;
    for (const opt of opts) {
      const pw = Math.max(28, opt.length * 6.5 + 14);
      el += `    <rect x="${ox}" y="${oy - 12}" width="${pw}" height="20" rx="10" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}"/>\n`;
      el += `    <text x="${ox + pw / 2}" y="${oy + 2}" text-anchor="middle" fill="${swatch.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(opt)}</text>\n`;
      ox += pw + 6;
    }
  } else {
    el += `    <rect x="${x + 14}" y="${y + h - 26}" width="${Math.max(48, field.type.length * 7 + 16)}" height="18" rx="9" fill="${swatch.fill}"/>\n`;
    el += `    <text x="${x + 14 + Math.max(48, field.type.length * 7 + 16) / 2}" y="${y + h - 13}" text-anchor="middle" fill="${swatch.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}" font-weight="600">${esc(field.type)}</text>\n`;
    if (field.required) {
      el += `    <text x="${x + w - 14}" y="${y + 22}" text-anchor="end" fill="#b91c1c" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}" font-weight="700">*</text>\n`;
    }
  }
  return el;
}

// -----------------------------------------------------------------------------
// Block — architecture block: rectangle with a stacked-layers glyph in the
// corner, the block-diagram signature distinguishing it from a plain flowchart box
// -----------------------------------------------------------------------------

export function renderBlockNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy
    ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  // Stacked-layers glyph, top-left corner.
  const gx = x + 12, gy = y + 12;
  for (let i = 0; i < 3; i++) {
    el += `    <rect x="${gx}" y="${gy + i * 4}" width="14" height="2.5" fill="${swatch.stroke}" opacity="${0.9 - i * 0.2}"/>\n`;
  }
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// Timeline — horizontal axis; alternating above/below period cards on a
// central spine, each with a filled tick marking its position
// -----------------------------------------------------------------------------

export function renderTimelineAxis(nodes: IRNode[], pad: number, bounds: { width: number; height: number }, stroke: string): string {
  if (nodes.length === 0) return '';
  const midY = bounds.height / 2 + pad;
  const minX = Math.min(...nodes.map((n) => n.position.x)) + pad - 20;
  const maxX = Math.max(...nodes.map((n) => n.position.x + n.size.width)) + pad + 20;
  return `    <line x1="${minX}" y1="${midY}" x2="${maxX}" y2="${midY}" stroke="${stroke}" stroke-width="${DS.stroke.emphasis}"/>\n`;
}

export function renderTimelineNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch, midY: number): string {
  const kind = ((node.data as any)?.timelineKind as string) || 'state';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;

  // UML Timing lifeline: vertical dashed line with state segments.
  if (kind === 'lifeline') {
    const states = (node.data as any)?.states as string[] | undefined || [node.label];
    const stateH = Math.min(22, (h - 16) / states.length);
    let el = `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + h}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" stroke-dasharray="5,4"/>\n`;
    for (let i = 0; i < states.length; i++) {
      const sy = y + 8 + i * (stateH + 4);
      const sw = w * 0.78; const sx = cx - sw / 2;
      el += `<rect x="${sx}" y="${sy}" width="${sw}" height="${stateH}" rx="${DS.chip.rx}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
      el += `<text x="${cx}" y="${sy + stateH / 2 + 4}" text-anchor="middle" fill="${swatch.text}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${esc(states[i])}</text>\n`;
      el += `<line x1="${cx}" y1="${sy + stateH}" x2="${cx}" y2="${midY}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.hairline}" stroke-dasharray="3,3"/>\n`;
    }
    el += `<circle cx="${cx}" cy="${midY}" r="4" fill="${swatch.stroke}"/>\n`;
    return el;
  }

  // Default: event node with tick to spine.
  const seed = seedFor(node.id);
  const style: RoughStyle = { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: swatch.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${swatch.fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.label, DS.fontFamily, swatch.text, node.label, 'middle', '600');
  const tickY = cy < midY ? y + h : y;
  el += `    <line x1="${cx}" y1="${tickY}" x2="${cx}" y2="${midY}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" stroke-dasharray="${DS.dash.edge}"/>\n`;
  el += `    <circle cx="${cx}" cy="${midY}" r="5" fill="${swatch.stroke}"/>\n`;
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
  const style: RoughStyle = { stroke: color, strokeWidth: DS.stroke.node, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughEllipse(cx, cy, w, h, style) : `    <circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="${DS.neutral.surface}" stroke="${color}" stroke-width="${DS.stroke.emphasis}"/>\n`;
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
    for (let i = 0; i < pts.length - 1; i++) el += roughLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { stroke: color, strokeWidth: DS.stroke.emphasis, roughness: 0.7, seed: seed + i });
  } else {
    el += `    <polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${DS.stroke.emphasis}"/>\n`;
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

// token-exempt: chart data strokes, gridlines and plot geometry (renderChartBar .. renderChartPie) are data marks, not chrome
export function renderChartBar(node: IRNode, pad: number, sketchy: boolean, chartMax: number, seriesNames: string[]): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const { category, series } = parseChartCategory(node.label);
  const baselineY = y + h - 30;
  const usableH = h - 50;
  const barGap = 6;
  const barW = (w - barGap * (series.length - 1)) / Math.max(1, series.length);
  // No baseline here: each node drawing its own left the x axis as a row of
  // disconnected stubs, one per category. renderChartAxes draws it once,
  // spanning the whole plot.
  let el = '';
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

export function renderChartLinePoint(node: IRNode, pad: number, chartMax: number, seriesIndex = 0): { x: number; y: number; value: number; category: string } {
  const { category, series } = parseChartCategory(node.label);
  const value = series[seriesIndex]?.value ?? series[0]?.value ?? 0;
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

/** The value axis: where it tops out, and the values to draw a gridline at. */
export interface ChartScale {
  max: number;
  ticks: number[];
}

/** Round a raw step up to the nearest 1/2/5 × 10ⁿ, the standard "nice number"
 *  choice — so gridlines land on 50/100/150 rather than on 37.4. */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Build the value axis from the data. The top is rounded up to a whole number
 *  of steps rather than sitting on the largest data point, so the topmost
 *  gridline is a readable number and the tallest bar doesn't touch the ceiling. */
export function chartScale(nodes: IRNode[], tickCount = 5): ChartScale {
  let dataMax = 0;
  for (const n of nodes) {
    const { series } = parseChartCategory(n.label);
    for (const s of series) dataMax = Math.max(dataMax, s.value);
  }
  if (dataMax <= 0) return { max: 1, ticks: [0, 1] };
  const step = niceStep(dataMax / tickCount);
  const max = Math.ceil(dataMax / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= max + step * 1e-6; i++) {
    ticks.push(Math.round(i * step * 1e6) / 1e6);
  }
  return { max, ticks };
}

export function extractChartMax(nodes: IRNode[]): number {
  return chartScale(nodes).max;
}

/** The plot rectangle in final SVG coordinates, derived from the category slots
 *  the chart layout assigned. Bars, points, gridlines and axes all measure from
 *  this one box so they line up. */
export interface ChartPlot {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function chartPlot(nodes: IRNode[], pad: number): ChartPlot | null {
  if (!nodes.length) return null;
  const first = nodes[0];
  const bottom = first.position.y + pad + first.size.height - 30;
  return {
    bottom,
    top: bottom - (first.size.height - 50),
    left: Math.min(...nodes.map((n) => n.position.x)) + pad,
    right: Math.max(...nodes.map((n) => n.position.x + n.size.width)) + pad,
  };
}

/** The x/y axes, horizontal gridlines and value labels behind a bar/line/
 *  scatter chart. Without these a line chart is a shape with no magnitude —
 *  you can see that one series is above another but not by how much. */
export function renderChartAxes(nodes: IRNode[], pad: number, scale: ChartScale): string {
  const p = chartPlot(nodes, pad);
  if (!p) return '';
  const axisX = p.left - 14;
  const span = p.bottom - p.top;
  let el = '  <g class="seldia-chart-axes">\n';

  for (const t of scale.ticks) {
    const y = p.bottom - (t / scale.max) * span;
    // The zero line is the x axis itself, drawn solid below; the rest are
    // quiet dashed gridlines that must not compete with the data.
    if (t > 0) {
      el += `    <line x1="${axisX}" y1="${y}" x2="${p.right}" y2="${y}" stroke="${DS.neutral.stroke}" stroke-width="1" stroke-opacity="0.3" stroke-dasharray="3,4"/>\n`;
    }
    el += `    <text x="${axisX - 8}" y="${y + 4}" text-anchor="end" fill="${DS.neutral.muted}" font-size="${DS.fontSize.small}" font-family="${DS.fontFamily}">${formatTick(t)}</text>\n`;
  }

  el += `    <line x1="${axisX}" y1="${p.top}" x2="${axisX}" y2="${p.bottom}" stroke="${DS.neutral.stroke}" stroke-width="${DS.stroke.edge}"/>\n`;
  el += `    <line x1="${axisX}" y1="${p.bottom}" x2="${p.right}" y2="${p.bottom}" stroke="${DS.neutral.stroke}" stroke-width="${DS.stroke.edge}"/>\n`;

  // Vertical guide lines at each category's x position — helps visually align
  // data points to their category label, especially on line and scatter charts.
  for (const n of nodes) {
    const x = n.position.x + pad + n.size.width / 2;
    el += `    <line x1="${x}" y1="${p.top}" x2="${x}" y2="${p.bottom}" stroke="${DS.neutral.stroke}" stroke-width="1" stroke-opacity="0.15" stroke-dasharray="2,4"/>\n`;
  }

  el += '  </g>\n';
  return el;
}

/** Tick labels are axis furniture — keep them short. Thousands become `12k`
 *  so a wide axis doesn't push the plot off the canvas. */
function formatTick(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// ── Legend ───────────────────────────────────────────────────────────────────
// A multi-series bar/line/radar/scatter chart is unreadable without a legend —
// the series are only told apart by seriesColor()'s palette order.
//
// The legend is laid out in rows that fit the canvas rather than one row that
// may be wider than it: a single centred row silently ran off both edges once
// the series names got long enough, which is what "legends do not fit in the
// diagram window" was. Its height is measured, not assumed, so the caller can
// reserve exactly the strip it needs (see CHART_LEGEND_* below).

const LEGEND_SWATCH = 12;
const LEGEND_SWATCH_GAP = 8;
const LEGEND_ENTRY_GAP = 20;
const LEGEND_ROW_H = 20;
const LEGEND_PAD_TOP = 12;
const LEGEND_PAD_BOTTOM = 10;
/** Canvas margin the legend must stay inside. */
const LEGEND_MARGIN = 16;

function legendEntryWidth(name: string): number {
  return LEGEND_SWATCH + LEGEND_SWATCH_GAP + name.length * 6.5;
}

/** Pack entries into rows no wider than the canvas allows. */
function legendRows(seriesNames: string[], svgWidth: number): number[][] {
  const usable = Math.max(60, svgWidth - LEGEND_MARGIN * 2);
  const rows: number[][] = [];
  let cur: number[] = [];
  let curW = 0;
  seriesNames.forEach((name, i) => {
    const w = legendEntryWidth(name);
    const add = cur.length ? LEGEND_ENTRY_GAP + w : w;
    if (cur.length && curW + add > usable) {
      rows.push(cur);
      cur = [];
      curW = 0;
    }
    curW += cur.length ? LEGEND_ENTRY_GAP + w : w;
    cur.push(i);
  });
  if (cur.length) rows.push(cur);
  return rows;
}

/** The narrowest canvas the legend can be laid out in without clipping — the
 *  widest single entry, since an entry is never split across rows. */
export function chartLegendMinWidth(seriesNames: string[]): number {
  if (seriesNames.length < 2) return 0;
  return Math.max(...seriesNames.map(legendEntryWidth)) + LEGEND_MARGIN * 2;
}

/** Exact height of the strip the legend needs at this canvas width. */
export function chartLegendHeight(seriesNames: string[], svgWidth: number): number {
  if (seriesNames.length < 2) return 0;
  return LEGEND_PAD_TOP + legendRows(seriesNames, svgWidth).length * LEGEND_ROW_H + LEGEND_PAD_BOTTOM;
}

/** Draw the legend into the strip starting at `top`, each row centred. */
export function renderChartLegend(seriesNames: string[], svgWidth: number, top: number): string {
  if (seriesNames.length < 2) return '';
  const rows = legendRows(seriesNames, svgWidth);
  let el = '  <g class="seldia-chart-legend">\n';
  rows.forEach((row, r) => {
    const rowW =
      row.reduce((sum, i) => sum + legendEntryWidth(seriesNames[i]), 0) +
      LEGEND_ENTRY_GAP * (row.length - 1);
    let x = (svgWidth - rowW) / 2;
    const cy = top + LEGEND_PAD_TOP + r * LEGEND_ROW_H + LEGEND_ROW_H / 2;
    for (const i of row) {
      const name = seriesNames[i];
      el += `    <rect x="${x}" y="${cy - LEGEND_SWATCH / 2}" width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" rx="2" fill="${seriesColor(i)}"/>\n`;
      el += `    <text x="${x + LEGEND_SWATCH + LEGEND_SWATCH_GAP}" y="${cy + DS.fontSize.meta * 0.35}" text-anchor="start" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}">${esc(name)}</text>\n`;
      x += legendEntryWidth(name) + LEGEND_ENTRY_GAP;
    }
  });
  el += '  </g>\n';
  return el;
}

/** Renders a pie chart across ALL nodes at once (a pie is one shape, not one
 *  per category) — called once by the engine instead of per-node when the
 *  diagram type is chart-pie. */
export function renderChartPie(nodes: IRNode[], pad: number, sketchy: boolean, bounds: { width: number; height: number }): string {
  const values = nodes.map((n) => parseChartCategory(n.label));
  const total = values.reduce((sum, v) => sum + (v.series[0]?.value ?? 0), 0) || 1;
  // Use the actual rendering area (bounds with padding) to compute the pie
  // radius, not the raw layout bounds which may be tiny for label-only nodes.
  const areaW = Math.max(bounds.width, 400) + pad * 2;
  const areaH = Math.max(bounds.height, 300) + pad * 2;
  const cx = areaW / 2 - 40, cy = areaH / 2, r = Math.max(80, Math.min(areaW, areaH) / 2 - 60);
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

// -----------------------------------------------------------------------------
// Wireframe — low-fidelity UI mockup controls (wired-elements style): every
// shape uses the same hand-sketched black-ink-on-paper look regardless of
// the document's per-type accent, because that flat, deliberately "unfinished"
// rendering is the whole point of a wireframe — it must not look like a
// polished UI, or it stops reading as a mockup.
// -----------------------------------------------------------------------------

export function renderWireframeNode(node: IRNode, pad: number, _sketchy: boolean, swatch: Swatch): string {
  // A wireframe is ALWAYS hand-drawn, regardless of the document's `sketchy`
  // theme setting — the wobbly "wired-elements" ink-on-paper look is the whole
  // reason it reads as a low-fidelity mockup and not a finished UI. So the
  // incoming `sketchy` flag is deliberately ignored and every control is drawn
  // through Rough.js.
  const kind = ((node.data as any)?.wireframeKind as string) || 'text';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);
  const ink: string = swatch.stroke;
  const paper: string = DS.neutral.surface;
  const muted: string = DS.neutral.muted;
  const R = DS.roughness * 1.4; // a touch rougher than the rest of the system

  // Local hand-drawn primitives, all sharing this node's seed so the wobble is
  // stable across re-renders but distinct from other nodes.
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number = DS.stroke.node) =>
    roughLine(x1, y1, x2, y2, { stroke: ink, strokeWidth: sw, roughness: R, seed });
  const box = (bx: number, by: number, bw: number, bh: number) =>
    roughRect(bx, by, bw, bh, { stroke: ink, strokeWidth: DS.stroke.node, fill: paper, fillStyle: 'solid', roughness: R * 0.85, seed });
  const hachure = (bx: number, by: number, bw: number, bh: number, gap = 5) =>
    roughRect(bx, by, bw, bh, { stroke: ink, strokeWidth: DS.stroke.hairline, fill: ink, fillStyle: 'hachure', hachureGap: gap, roughness: R * 0.7, seed });
  const circle = (ccx: number, ccy: number, d: number, fill = paper, fillStyle = 'solid') =>
    roughEllipse(ccx, ccy, d, d, { stroke: ink, strokeWidth: DS.stroke.node, fill, fillStyle, roughness: R * 0.8, seed });
  const label = (lx: number, ly: number, fs: number, color: string, text: string, anchor: 'start' | 'middle' = 'start', weight = '400') =>
    textBlock(lx, ly, Math.round(fs * 1.3), fs, DS.fontFamily, color, text, anchor, weight);

  // A cleaned display string: drop the redundant control-type noun so a node
  // like `email: [Email Input]` shows "Email", not "Email Input".
  const text = node.label
    .replace(/\s*\b(button|btn|input|field|textbox|textarea|checkbox|radio|toggle|switch|dropdown|select|combobox|combo|slider|range|progress(?:bar)?|image|img|photo|picture|avatar|link|card|panel|navbar|nav|menu|heading|placeholder|checked|selected|unchecked)\b\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '') // drop stray leading/trailing separators left behind
    .trim() || node.label;
  const baseline = cy + DS.fontSize.meta * 0.35;
  // Filled/active state and a progress fraction, both parsed from the label.
  const on = /\b(checked|selected|on|active|enabled|done)\b/i.test(node.label);
  const pctM = node.label.match(/(\d{1,3})\s*%/);
  const pct = pctM ? Math.max(0, Math.min(100, +pctM[1])) / 100 : 0.45;

  switch (kind) {
    case 'button': {
      let el = box(x, y, w, h);
      el += label(cx, baseline, DS.fontSize.meta, ink, text, 'middle', '600');
      return el;
    }
    case 'input': {
      let el = box(x, y, w, h);
      el += label(x + 12, baseline, DS.fontSize.meta, muted, text, 'start', '400');
      return el;
    }
    case 'textarea': {
      let el = box(x, y, w, h);
      el += label(x + 12, y + 20, DS.fontSize.meta, muted, text, 'start', '400');
      for (let i = 1; i <= 2; i++) el += line(x + 12, y + 20 + i * 16, x + w - 12, y + 20 + i * 16, 1);
      return el;
    }
    case 'checkbox': {
      const s = 18, bx = x, by = cy - s / 2;
      let el = box(bx, by, s, s);
      if (on) {
        el += line(bx + s * 0.18, by + s * 0.52, bx + s * 0.42, by + s * 0.8, 2);
        el += line(bx + s * 0.42, by + s * 0.8, bx + s * 0.86, by + s * 0.2, 2);
      }
      el += label(bx + s + 12, baseline, DS.fontSize.meta, ink, text, 'start', '400');
      return el;
    }
    case 'radio': {
      const d = 18, rcx = x + d / 2, rcy = cy;
      let el = circle(rcx, rcy, d);
      if (on) el += circle(rcx, rcy, d * 0.42, ink, 'solid');
      el += label(x + d + 12, baseline, DS.fontSize.meta, ink, text, 'start', '400');
      return el;
    }
    case 'toggle': {
      const tw = 46, th = 24, ty = cy - th / 2;
      // Track as a rounded pill approximated by a rect with rounded ends.
      let el = on ? hachure(x, ty, tw, th, 4) : box(x, ty, tw, th);
      el += box(x, ty, tw, th); // outline over the fill
      const knobX = on ? x + tw - th / 2 : x + th / 2;
      el += circle(knobX, cy, th - 6, paper, 'solid');
      el += label(x + tw + 12, baseline, DS.fontSize.meta, ink, text, 'start', '400');
      return el;
    }
    case 'slider': {
      const ty = cy + 6, trackL = x + 4, trackR = x + w - 4;
      let el = text && text !== node.label ? label(x, y + 12, DS.fontSize.small, muted, text, 'start', '400') : '';
      el += line(trackL, ty, trackR, ty, 2);
      const knobX = trackL + (trackR - trackL) * pct;
      el += line(trackL, ty, knobX, ty, 3); // filled portion, heavier
      el += circle(knobX, ty, 16, paper, 'solid');
      return el;
    }
    case 'dropdown': {
      let el = box(x, y, w, h);
      el += label(x + 12, baseline, DS.fontSize.meta, ink, text, 'start', '400');
      // Down-caret on the right.
      const ax = x + w - 22, ay = cy - 3;
      el += roughPolygon([[ax, ay], [ax + 12, ay], [ax + 6, ay + 8]], { stroke: ink, strokeWidth: DS.stroke.edge, fill: ink, fillStyle: 'solid', roughness: R * 0.6, seed });
      return el;
    }
    case 'progress': {
      let el = box(x, y, w, h);
      if (pct > 0) el += hachure(x + 2, y + 2, (w - 4) * pct, h - 4, 4);
      el += label(cx, baseline, DS.fontSize.small, muted, pctM ? `${Math.round(pct * 100)}%` : text, 'middle', '600');
      return el;
    }
    case 'divider':
      return line(x, cy, x + w, cy, 1.5);
    case 'link': {
      let el = label(x, baseline, DS.fontSize.meta, ink, text, 'start', '400');
      el += line(x, baseline + 4, x + Math.min(w, text.length * 7 + 2), baseline + 4, 1);
      return el;
    }
    case 'image': {
      let el = box(x, y, w, h);
      el += line(x, y, x + w, y + h, DS.stroke.hairline);
      el += line(x + w, y, x, y + h, DS.stroke.hairline);
      el += label(cx, y + h + 14, DS.fontSize.small, muted, text, 'middle', '400');
      return el;
    }
    case 'avatar': {
      const d = Math.min(w, h);
      let el = circle(cx, cy, d);
      el += circle(cx, cy - d * 0.12, d * 0.32, paper, 'solid'); // head
      // Shoulders — a shallow arc approximated with a wide short ellipse, clipped visually by the ring.
      el += roughEllipse(cx, cy + d * 0.34, d * 0.62, d * 0.4, { stroke: ink, strokeWidth: DS.stroke.node, fill: paper, fillStyle: 'solid', roughness: R * 0.8, seed });
      return el;
    }
    case 'heading': {
      // Strip a leading "H1 "/"H2." level marker so the title reads cleanly.
      const htext = node.label.replace(/^\s*h[1-6]\b[:.\s]*/i, '').trim() || node.label;
      let el = label(x, y + h * 0.55, DS.fontSize.title, ink, htext, 'start', '700');
      el += line(x, y + h - 4, x + Math.min(w, htext.length * 11 + 4), y + h - 4, 1.5);
      return el;
    }
    case 'navbar': {
      let el = box(x, y, w, h);
      el += label(x + 16, baseline, DS.fontSize.meta, ink, text, 'start', '700');
      for (const frac of [0.72, 0.82, 0.92]) {
        const tx = x + w * frac;
        el += line(tx, y + h / 2 - 8, tx, y + h / 2 + 8, 2);
      }
      return el;
    }
    case 'card': {
      let el = box(x, y, w, h);
      el += label(x + 14, y + 24, DS.fontSize.label, ink, text, 'start', '600');
      for (let i = 0; i < 3; i++) {
        const ly = y + 44 + i * 16;
        el += line(x + 14, ly, x + (i === 2 ? w * 0.5 : w - 14), ly, 1);
      }
      return el;
    }
    default:
      // Plain text / label line.
      return label(x, baseline, DS.fontSize.meta, ink, text, 'start', '400');
  }
}

// -----------------------------------------------------------------------------
// Cloud — AWS-style architecture diagram with cloud boundary, service nodes
// -----------------------------------------------------------------------------

export function renderCloudNode(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const kind = ((node.data as any)?.cloudKind as string) || 'compute';
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const cx = x + w / 2, cy = y + h / 2;
  const seed = seedFor(node.id);

  // ── Cloud boundary / Region / VPC / AZ: dashed rect container ──
  if (kind === 'cloud' || kind === 'region' || kind === 'vpc' || kind === 'az') {
    const dash = kind === 'cloud' ? '8,4' : kind === 'az' ? '4,3' : '6,3';
    const fill = kind === 'cloud' ? DS.neutral.fill : 'none';
    const rx = kind === 'cloud' ? 12 : 8;
    let el = sketchy
      ? roughRect(x, y, w, h, { stroke: swatch.stroke, strokeWidth: DS.stroke.edge, fill, roughness: DS.roughness, fillStyle: 'solid', seed })
      : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.edge}" stroke-dasharray="${dash}"/>\n`;
    el += textBlock(cx - 6, y - 6, 0, DS.fontSize.meta, DS.fontFamily, swatch.stroke, node.label, 'start', '700');
    return el;
  }

  // ── User / Client: simple person icon ──
  if (kind === 'user') {
    const r = 10;
    let el = sketchy
      ? roughEllipse(cx, y + r + 4, r * 2, r * 2, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, fill: 'none', roughness: DS.roughness, seed })
      : `    <circle cx="${cx}" cy="${y + r + 4}" r="${r}" fill="none" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    if (sketchy) {
      el += roughLine(cx, y + r * 2 + 8, cx, y + h * 0.55, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, roughness: DS.roughness, seed: seed + 1 });
      el += roughLine(cx - 8, y + h * 0.45, cx + 8, y + h * 0.45, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, roughness: DS.roughness, seed: seed + 2 });
      el += roughLine(cx - 6, y + h - 10, cx, y + h * 0.55, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, roughness: DS.roughness, seed: seed + 3 });
      el += roughLine(cx + 6, y + h - 10, cx, y + h * 0.55, { stroke: swatch.stroke, strokeWidth: DS.stroke.node, roughness: DS.roughness, seed: seed + 4 });
    } else {
      el += `    <line x1="${cx}" y1="${y + r * 2 + 8}" x2="${cx}" y2="${y + h * 0.55}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <line x1="${cx - 8}" y1="${y + h * 0.45}" x2="${cx + 8}" y2="${y + h * 0.45}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <line x1="${cx - 6}" y1="${y + h - 10}" x2="${cx}" y2="${y + h * 0.55}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
      el += `    <line x1="${cx + 6}" y1="${y + h - 10}" x2="${cx}" y2="${y + h * 0.55}" stroke="${swatch.stroke}" stroke-width="${DS.stroke.node}"/>\n`;
    }
    el += textBlock(cx, y + h + 12, 0, DS.fontSize.small, DS.fontFamily, DS.neutral.text, node.label, 'middle', '600');
    return el;
  }

  // ── Service nodes: styled rect with distinct color per kind ──
  const serviceColors: Record<string, { fill: string; stroke: string; label: string }> = {
    compute: { fill: '#fef2e0', stroke: '#f59e0b', label: 'EC2' },
    container: { fill: '#f5f0ff', stroke: '#7c3aed', label: 'ECS' },
    serverless: { fill: '#ffeef5', stroke: '#db2777', label: 'λ' },
    storage: { fill: '#effff4', stroke: '#16a34a', label: 'S3' },
    database: { fill: '#eff6ff', stroke: '#2563eb', label: 'DB' },
    network: { fill: '#fdf5ff', stroke: '#a855f7', label: 'NET' },
    security: { fill: '#fef2f2', stroke: '#dc2626', label: 'IAM' },
    queue: { fill: '#fdf0ff', stroke: '#c026d3', label: 'SQS' },
    cdn: { fill: '#f0fdf4', stroke: '#22c55e', label: 'CDN' },
    dns: { fill: '#eff6ff', stroke: '#3b82f6', label: 'DNS' },
  };
  const sc = serviceColors[kind] || { fill: swatch.fill, stroke: swatch.stroke, label: '' };

  const style: RoughStyle = { stroke: sc.stroke, strokeWidth: DS.stroke.node, fill: sc.fill, roughness: DS.roughness, fillStyle: 'solid', seed };
  let el = sketchy ? roughRect(x, y, w, h, style)
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${sc.fill}" stroke="${sc.stroke}" stroke-width="${DS.stroke.node}"/>\n`;

  // Service type badge (top-left).
  if (sc.label) {
    el += `    <rect x="${x + 6}" y="${y + 6}" width="24" height="14" rx="${DS.chip.rx}" fill="${sc.stroke}" opacity="0.15"/>\n`;
    el += `    <text x="${x + 18}" y="${y + 17}" text-anchor="middle" fill="${readableTextOn(blendHex(sc.fill, sc.stroke, 0.15), sc.stroke)}" font-size="${DS.fontSize.small}" font-family="${DS.monoFamily}" font-weight="700">${esc(sc.label)}</text>\n`;
  }
  el += textBlock(cx, cy + DS.fontSize.label * 0.35, Math.round(DS.fontSize.label * 1.3), DS.fontSize.meta, DS.fontFamily, DS.neutral.text, node.label, 'middle', '600');
  return el;
}

// -----------------------------------------------------------------------------
// Groups (subgraph containers) — background box + header label, drawn behind
// their member nodes. Position/size are a bounding box over childNodeIds
// (computed by the caller via computeGroupBounds), not laid out independently.
// -----------------------------------------------------------------------------

const DEFAULT_GROUP_STYLE: GroupStyle = {
  roughness: 0.8,
  bowing: 1.0,
  stroke: '#a8a29e',
  strokeWidth: DS.stroke.edge,
  strokeDasharray: '8,4',
  fill: 'rgba(245,245,244,0.3)',
  opacity: 1,
  fontFamily: 'Caveat, Comic Sans MS, cursive, sans-serif',
  fontWeight: FontWeight.BOLD,
  fontStyle: FontStyle.NORMAL,
  fontSize: 14,
  textColor: '#78716c',
  padding: 20,
  borderRadius: 8,
};

/** Bounding box over a group's direct+nested member nodes, expanded by the
 *  group's own padding plus room for the header label above the box. Groups
 *  with no resolvable members collapse to a zero-size box (caller should skip
 *  rendering those, not draw an empty rect). */
export function computeGroupBounds(group: IRGroup, allGroups: IRGroup[], nodeById: Map<string, IRNode>): { x: number; y: number; width: number; height: number } {
  const padding = group.style.padding ?? DEFAULT_GROUP_STYLE.padding;
  const memberIds = new Set<string>();
  const collectNodeIds = (g: IRGroup, seen: Set<string>) => {
    if (seen.has(g.id)) return; // guard against cyclic childGroupIds
    seen.add(g.id);
    for (const id of g.childNodeIds) memberIds.add(id);
    for (const childId of g.childGroupIds) {
      const child = allGroups.find((c) => c.id === childId);
      if (child) collectNodeIds(child, seen);
    }
  };
  collectNodeIds(group, new Set());

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of memberIds) {
    const n = nodeById.get(id);
    if (!n) continue;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width);
    maxY = Math.max(maxY, n.position.y + n.size.height);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };

  const headerH = Math.round(DEFAULT_GROUP_STYLE.fontSize * 1.6);
  return {
    x: minX - padding,
    y: minY - padding - headerH,
    width: (maxX - minX) + padding * 2,
    height: (maxY - minY) + padding * 2 + headerH,
  };
}

export function renderGroup(group: IRGroup, pad: number, sketchy: boolean): string {
  if (group.size.width <= 0 || group.size.height <= 0) return '';
  const style = { ...DEFAULT_GROUP_STYLE, ...group.style };
  const x = group.position.x + pad, y = group.position.y + pad, w = group.size.width, h = group.size.height;
  const seed = seedFor(group.id);

  let el = sketchy
    ? roughRect(x, y, w, h, { stroke: style.stroke, strokeWidth: style.strokeWidth, fill: style.fill, roughness: style.roughness, bowing: style.bowing, fillStyle: 'solid', seed })
    : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${style.borderRadius}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-dasharray="${style.strokeDasharray}"/>\n`;

  if (group.label) {
    el += textBlock(x + 10, y + style.fontSize + 4, style.fontSize * 1.2, style.fontSize, style.fontFamily, style.textColor, group.label, 'start', String(style.fontWeight));
  }
  return el;
}

// -----------------------------------------------------------------------------
// Class Diagram — note boxes and compartment boxes
// -----------------------------------------------------------------------------
// Moved here from engine.ts private methods so classPlugin.renderNode can own
// them: per-type node rendering dispatches through the plugin hook, not an
// engine type ladder.

/** Distinct yellow annotation box for UML notes (reference image B) —
 *  no compartments, folded-corner styling, left-aligned text. */
export function renderClassNote(node: IRNode, pad: number, sketchy: boolean): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const s = node.style || {};
  const note = roleSwatch('note');
  const fill = (s.fill as string) || note.fill, stroke = (s.stroke as string) || note.stroke;
  const sw = (s.strokeWidth as number) || DS.stroke.divider, color = (s.textColor as string) || note.text;
  const fs = (s.fontSize as number) || DS.fontSize.meta, ff = (s.fontFamily as string) || DS.fontFamily;
  const fold = 12;
  let el: string;
  if (sketchy) {
    const style: RoughStyle = { stroke, strokeWidth: sw, fill, roughness: DS.roughness, fillStyle: 'solid', seed: seedFor(node.id) };
    el = roughPolygon([[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]], style);
    el += roughLine(x + w - fold, y, x + w, y + fold, { stroke, strokeWidth: sw, seed: seedFor(node.id) });
  } else {
    el = `    <path d="M ${x} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h} H ${x} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
    el += `    <path d="M ${x + w - fold} ${y} V ${y + fold} H ${x + w}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>\n`;
  }
  const lineHeight = Math.round(fs * 1.3);
  const lines = splitLabelLines(node.label);
  const startY = y + 16;
  el += `    <text text-anchor="start" fill="${color}" font-size="${fs}" font-family="${ff}" font-style="italic">${lines.map((l, i) => `<tspan x="${x + 10}" y="${startY + i * lineHeight}">${esc(l)}</tspan>`).join('')}</text>\n`;
  return el;
}

/** UML class box: name compartment (bold, centered, tinted header),
 *  divider, attributes compartment (left-aligned, visibility markers kept
 *  verbatim), divider, operations compartment — reference image B. */
export function renderClassCompartments(node: IRNode, pad: number, sketchy: boolean, swatch: Swatch): string {
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  const s = node.style || {};
  const fill = swatch.fill, stroke = swatch.stroke, color = swatch.text;
  const sw = (s.strokeWidth as number) || DS.stroke.node;
  const fs = (s.fontSize as number) || DS.fontSize.label, ff = (s.fontFamily as string) || DS.fontFamily;
  // Members are code-like — render them in the monospace family for legibility.
  const memberFf = DS.monoFamily;
  const { name, attributes, operations } = (node.data as any).compartments as { name: string; attributes: string[]; operations: string[] };

  const lineHeight = Math.round((fs - 2) * 1.4);
  const nameHeight = fs + 18;
  const attrHeight = attributes.length > 0 ? attributes.length * lineHeight + 12 : 0;
  const opHeight = operations.length > 0 ? operations.length * lineHeight + 12 : 0;

  let el: string;
  if (sketchy) {
    el = roughRect(x, y, w, h, { stroke, strokeWidth: sw, fill: DS.neutral.surface, roughness: DS.roughness, fillStyle: 'solid', seed: seedFor(node.id) });
  } else {
    el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${DS.neutral.surface}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
  }
  // Name compartment — tinted header (accent fill), bold, centered.
  el += `    <path d="M ${x} ${y + DS.radius} Q ${x} ${y} ${x + DS.radius} ${y} H ${x + w - DS.radius} Q ${x + w} ${y} ${x + w} ${y + DS.radius} V ${y + nameHeight} H ${x} Z" fill="${fill}"/>\n`;
  el += `    <text x="${x + w / 2}" y="${y + nameHeight / 2 + fs * 0.35}" text-anchor="middle" font-weight="700" fill="${color}" font-size="${fs}" font-family="${ff}">${esc(name)}</text>\n`;

  let cursorY = y + nameHeight;
  if (attrHeight > 0) {
    el += `    <line x1="${x}" y1="${cursorY}" x2="${x + w}" y2="${cursorY}" stroke="${stroke}" stroke-width="${DS.stroke.divider}"/>\n`;
    const startY = cursorY + lineHeight;
    el += `    <text text-anchor="start" fill="${DS.neutral.text}" font-size="${fs - 2}" font-family="${memberFf}">${attributes.map((l, i) => `<tspan x="${x + 10}" y="${startY + i * lineHeight}">${esc(l)}</tspan>`).join('')}</text>\n`;
    cursorY += attrHeight;
  }
  if (opHeight > 0) {
    el += `    <line x1="${x}" y1="${cursorY}" x2="${x + w}" y2="${cursorY}" stroke="${stroke}" stroke-width="${DS.stroke.divider}"/>\n`;
    const startY = cursorY + lineHeight;
    el += `    <text text-anchor="start" fill="${DS.neutral.text}" font-size="${fs - 2}" font-family="${memberFf}">${operations.map((l, i) => `<tspan x="${x + 10}" y="${startY + i * lineHeight}">${esc(l)}</tspan>`).join('')}</text>\n`;
  }
  return el;
}
