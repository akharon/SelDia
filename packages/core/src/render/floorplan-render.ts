// =============================================================================
// SelDiA — Floorplan Renderer
// =============================================================================
// Deliberately NOT Rough.js. Every other SelDiA type renders hand-drawn/sketchy
// because these are conceptual diagrams; a floor plan is a precise technical
// drawing, and hand-wobbled walls read as wrong rather than stylistic. Lines,
// wall thicknesses and dimension marks are plain crisp SVG throughout.
//
// This module owns three things:
//   - the blueprint frame + ruler ticks + title block (whole-canvas chrome,
//     drawn once by renderFloorplanFrame/renderFloorplanTitleBlock)
//   - walls + door/window openings, derived by layoutFloorplan and drawn here
//     from the metadataPatch it returns (renderFloorplanWalls)
//   - per-node symbols for rooms and furniture (renderFloorplanNode, the
//     plugin's renderNode hook)
// =============================================================================

import type { IRNode } from '../ir/types.js';
import type { Swatch } from './design-system.js';
import type { FpDimension, FpMeasure, FpWallSeg } from '../floorplan/dimensions.js';
import { escapeXml as esc } from './escape.js';

// ── Palette ─────────────────────────────────────────────────────────────
// A drafting sheet is near-monochrome by convention: the drawing is black on
// white and colour is reserved for annotation, so measurements read as notes
// *about* the plan rather than as part of it. Hence one ink ramp (walls,
// symbols, text) plus a single blue used only for dimensions and measures.
const INK = '#111827';        // walls, primary linework
const INK_SOFT = '#374151';   // furniture outlines — a step back from walls
const MUTED = '#9aa4b2';      // secondary detail inside symbols
const LABEL = '#4b5563';      // room/furniture text
const DIM = '#2563eb';        // dimension lines + figures (the one accent)
const DIM_SOFT = '#93b4f5';   // extension/witness lines
const FLOOR = '#f7f9fc';      // room floor tint
const PAPER = '#ffffff';      // sheet ground; also erases wall under openings
const FURN_FILL = '#eef2f7';  // furniture body fill

const EXTERIOR_WALL = 8;
const INTERIOR_WALL = 4.5;
const FONT = 'ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif';

interface FpOpening {
  x1: number; y1: number; x2: number; y2: number;
  kind: 'door' | 'window';
  swing?: number;
  wall?: 'exterior' | 'interior';
}

/** Thickness of the wall an opening is cut into — the erase stroke must match
 *  it, or the gap reads as a hole punched wider than the wall itself. */
function wallThickness(o: FpOpening): number {
  return o.wall === 'interior' ? INTERIOR_WALL : EXTERIOR_WALL;
}

/** What colour to erase the wall with. An interior opening joins two tinted
 *  rooms, so erasing in paper white leaves a bright notch through the floor;
 *  it has to be erased in the floor tint instead. An exterior opening has
 *  paper on its outer side, so paper is right there. */
function eraseFill(o: FpOpening): string {
  return o.wall === 'interior' ? FLOOR : PAPER;
}

// ── Floor slabs ─────────────────────────────────────────────────────────
// Rooms get a flat tint painted *under* the walls, so the enclosed area reads
// as inhabited space rather than as empty page. Drawn as its own pass before
// any linework, because a per-node fill would paint over the neighbouring
// room's wall wherever two rooms share an edge.

export function renderFloorplanFloors(rooms: IRNode[]): string {
  if (!rooms.length) return '';
  let svg = '  <g class="seldia-floorplan-floors">\n';
  for (const r of rooms) {
    svg += `    <rect x="${r.position.x}" y="${r.position.y}" width="${r.size.width}" height="${r.size.height}" fill="${FLOOR}"/>\n`;
  }
  svg += '  </g>\n';
  return svg;
}

// ── Walls + openings (whole-canvas, drawn from layoutFloorplan's metadata) ──

export function renderFloorplanWalls(walls: FpWallSeg[], openings: FpOpening[]): string {
  let svg = '  <g class="seldia-floorplan-walls">\n';
  for (const w of walls) {
    const thickness = w.kind === 'exterior' ? EXTERIOR_WALL : INTERIOR_WALL;
    svg += `    <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${INK}" stroke-width="${thickness}" stroke-linecap="square"/>\n`;
  }
  svg += '  </g>\n  <g class="seldia-floorplan-openings">\n';
  for (const o of openings) {
    svg += o.kind === 'door' ? renderDoor(o) : renderWindow(o);
  }
  svg += '  </g>\n';
  return svg;
}

/** A door: gap in the wall, jamb ticks, a leaf drawn open at 90°, and the
 *  quarter-circle swing arc it sweeps — the universal architectural door
 *  symbol. The leaf and arc always swing to the side the opening's `swing`
 *  says (default: into the room the door was declared on), so the arc never
 *  lands in the neighbouring room the way a fixed direction would. */
function renderDoor(o: FpOpening): string {
  const horizontal = Math.abs(o.x2 - o.x1) >= Math.abs(o.y2 - o.y1);
  const w = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  // +1 / -1: which side of the wall the leaf opens into.
  const dir = o.swing ?? 1;
  const t = wallThickness(o);
  // Erase exactly the wall's own width, then draw jamb ticks so the gap reads
  // as a framed opening rather than as a break in the drawing.
  let svg = `    <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${eraseFill(o)}" stroke-width="${t}" stroke-linecap="butt"/>\n`;
  const jamb = t / 2;
  if (horizontal) {
    const hx = Math.min(o.x1, o.x2), ox = Math.max(o.x1, o.x2), hy = o.y1;
    for (const jx of [hx, ox]) {
      svg += `    <line x1="${jx}" y1="${hy - jamb}" x2="${jx}" y2="${hy + jamb}" stroke="${INK}" stroke-width="1.5"/>\n`;
    }
    // Leaf: hinged at the left jamb, standing open perpendicular to the wall.
    svg += `    <line x1="${hx}" y1="${hy}" x2="${hx}" y2="${hy + dir * w}" stroke="${INK_SOFT}" stroke-width="2"/>\n`;
    // Arc from the open leaf tip round to the closed position at the far jamb.
    const sweep = dir > 0 ? 0 : 1;
    svg += `    <path d="M ${hx} ${hy + dir * w} A ${w} ${w} 0 0 ${sweep} ${hx + w} ${hy}" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="4,3"/>\n`;
  } else {
    const hy = Math.min(o.y1, o.y2), oy = Math.max(o.y1, o.y2), hx = o.x1;
    for (const jy of [hy, oy]) {
      svg += `    <line x1="${hx - jamb}" y1="${jy}" x2="${hx + jamb}" y2="${jy}" stroke="${INK}" stroke-width="1.5"/>\n`;
    }
    svg += `    <line x1="${hx}" y1="${hy}" x2="${hx + dir * w}" y2="${hy}" stroke="${INK_SOFT}" stroke-width="2"/>\n`;
    const sweep = dir > 0 ? 1 : 0;
    svg += `    <path d="M ${hx + dir * w} ${hy} A ${w} ${w} 0 0 ${sweep} ${hx} ${hy + w}" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="4,3"/>\n`;
  }
  return svg;
}

/** A window: the wall gap filled with three parallel lines (frame + two
 *  panes) — the standard window-in-wall symbol, clearly distinct from both a
 *  solid wall and a door's swing-arc gap. */
function renderWindow(o: FpOpening): string {
  // Erase the wall under the opening, then lay the frame: two heavy lines at
  // the wall faces and one thin glazing line down the middle. Jamb ticks close
  // the ends so the opening reads as framed glass set into the wall.
  const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1;
  const px = -(o.y2 - o.y1) / len, py = (o.x2 - o.x1) / len; // unit perpendicular
  const t = wallThickness(o);
  const off = t / 2;
  let svg = `    <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${eraseFill(o)}" stroke-width="${t}" stroke-linecap="butt"/>\n`;
  for (const [k, w, color] of [[-off, 1.6, INK], [0, 1, MUTED], [off, 1.6, INK]] as const) {
    const dx = px * k, dy = py * k;
    svg += `    <line x1="${o.x1 + dx}" y1="${o.y1 + dy}" x2="${o.x2 + dx}" y2="${o.y2 + dy}" stroke="${color}" stroke-width="${w}"/>\n`;
  }
  for (const [ex, ey] of [[o.x1, o.y1], [o.x2, o.y2]] as const) {
    svg += `    <line x1="${ex - px * off}" y1="${ey - py * off}" x2="${ex + px * off}" y2="${ey + py * off}" stroke="${INK}" stroke-width="1.6"/>\n`;
  }
  return svg;
}

// ── Dimensions + measurements ───────────────────────────────────────────
// Drawn to standard drafting convention: a dimension line offset off the
// geometry, thin extension (witness) lines running from the geometry out to
// it, a 45° tick where the two meet, and the figure centred on the line.
//
// The 45° tick is the architectural house style (mechanical drawings use
// arrowheads). It's used here because a floor plan's dimension strings sit end
// to end in a chain, where ticks stay legible at the shared endpoints and
// back-to-back arrowheads turn into a blob.

const TICK = 5;      // half-length of the 45° end tick
const DIM_FS = 11;   // dimension figure size
/** Below this, the figure cannot fit between the ticks and is placed outside
 *  the string instead of overlapping them. */
const MIN_INLINE = 46;

/** A dimension figure centred on (x,y). Vertical strings read bottom-to-top,
 *  the drafting convention that keeps text upright when the sheet is turned —
 *  never mirrored upside-down. `dominant-baseline` does the vertical centring
 *  so the caller never has to guess a baseline offset, which is what made the
 *  rotated case sit off-centre in its own backing pill. */
function dimText(x: number, y: number, text: string, vertical: boolean, color = DIM): string {
  const rot = vertical ? ` transform="rotate(-90 ${x} ${y})"` : '';
  return `    <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${DIM_FS}" font-weight="600" `
    + `fill="${color}" font-family="${FONT}"${rot}>${esc(text)}</text>\n`;
}

/** The measurement figure sits in a small paper-coloured pill so it stays
 *  readable where a string crosses linework, instead of colliding with it. */
function dimTextBoxed(x: number, y: number, text: string, vertical: boolean, color = DIM): string {
  const w = text.length * DIM_FS * 0.58 + 8;
  const h = DIM_FS + 5;
  // The pill is the text's own bounding box, so it swaps axes when the text is
  // rotated; a fixed-orientation box leaves the ends of a rotated figure
  // hanging outside their own backing.
  const rect = vertical
    ? `    <rect x="${x - h / 2}" y="${y - w / 2}" width="${h}" height="${w}" rx="2" fill="${PAPER}" opacity="0.94"/>\n`
    : `    <rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2" fill="${PAPER}" opacity="0.94"/>\n`;
  return rect + dimText(x, y, text, vertical, color);
}

export function renderFloorplanDimensions(dims: FpDimension[]): string {
  if (!dims.length) return '';
  let svg = '  <g class="seldia-floorplan-dimensions">\n';
  for (const d of dims) {
    const vertical = d.side === 'left' || d.side === 'right';
    const weight = d.overall ? 1.4 : 1;
    // Extension lines: from just clear of the geometry, out past the
    // dimension line by a small overshoot — both are drafting convention and
    // together they stop the witness line from touching the wall it measures.
    // The witness line runs from just off the wall out to just past the
    // dimension line, and NOT one step further: it is capped at that length so
    // it can never march on across the drawing, which is what happens if the
    // direction is derived from a coordinate difference that can be zero.
    const gapOff = 4, over = 5;
    const dirn = d.side === 'top' || d.side === 'left' ? -1 : 1;
    if (vertical) {
      const from = d.ex1 + dirn * gapOff;
      const to = d.x1 + dirn * over;
      for (const ey of [d.ey1, d.ey2]) {
        svg += `    <line x1="${from}" y1="${ey}" x2="${to}" y2="${ey}" stroke="${DIM_SOFT}" stroke-width="0.8"/>\n`;
      }
    } else {
      const from = d.ey1 + dirn * gapOff;
      const to = d.y1 + dirn * over;
      for (const ex of [d.ex1, d.ex2]) {
        svg += `    <line x1="${ex}" y1="${from}" x2="${ex}" y2="${to}" stroke="${DIM_SOFT}" stroke-width="0.8"/>\n`;
      }
    }
    // The dimension line itself.
    svg += `    <line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="${DIM}" stroke-width="${weight}"/>\n`;
    // 45° ticks at both ends.
    for (const [tx, ty] of [[d.x1, d.y1], [d.x2, d.y2]] as const) {
      svg += `    <line x1="${tx - TICK}" y1="${ty - TICK}" x2="${tx + TICK}" y2="${ty + TICK}" stroke="${DIM}" stroke-width="${weight + 0.2}"/>\n`;
    }
    // The figure: centred on the line when it fits between the ticks,
    // otherwise pushed just past the end so a narrow span stays readable.
    const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    const mx = (d.x1 + d.x2) / 2, my = (d.y1 + d.y2) / 2;
    if (len >= MIN_INLINE) {
      svg += dimTextBoxed(mx, my, d.text, vertical);
    } else if (vertical) {
      // Too short to letter between the ticks: sit the figure just beyond the
      // top tick, horizontally, where there is room for it.
      svg += dimText(mx, Math.min(d.y1, d.y2) - 9, d.text, false);
    } else {
      svg += dimText(Math.max(d.x1, d.x2) + 6 + d.text.length * 3, my, d.text, false);
    }
  }
  svg += '  </g>\n';
  return svg;
}

/** Author-declared `measure` annotations. Drawn in the same visual language as
 *  the automatic strings but dashed, so a reader can tell an as-drawn clear
 *  distance from a dimensioned wall length at a glance. */
export function renderFloorplanMeasures(measures: FpMeasure[]): string {
  if (!measures.length) return '';
  let svg = '  <g class="seldia-floorplan-measures">\n';
  for (const m of measures) {
    const vertical = Math.abs(m.y2 - m.y1) > Math.abs(m.x2 - m.x1);
    svg += `    <line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${DIM}" stroke-width="1" stroke-dasharray="5,3"/>\n`;
    // Perpendicular end bars — a clear-gap measure is bounded by the two faces
    // it spans, so bars (not ticks) mark where the measurement stops.
    for (const [bx, by] of [[m.x1, m.y1], [m.x2, m.y2]] as const) {
      svg += vertical
        ? `    <line x1="${bx - TICK}" y1="${by}" x2="${bx + TICK}" y2="${by}" stroke="${DIM}" stroke-width="1.2"/>\n`
        : `    <line x1="${bx}" y1="${by - TICK}" x2="${bx}" y2="${by + TICK}" stroke="${DIM}" stroke-width="1.2"/>\n`;
    }
    svg += dimTextBoxed((m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2, m.text, vertical);
  }
  svg += '  </g>\n';
  return svg;
}

// ── Blueprint frame + title block (whole-canvas chrome) ─────────────────────

export interface TitleBlock { title?: string; scale?: string; author?: string; date?: string; area?: string }

const FRAME_MARGIN = 24;

/** Sheet border — a plain double-ruled frame, drawn first, under everything.
 *  The old version ran decorative tick marks along all four edges every 40px;
 *  they looked like a ruler but measured nothing (40px is not a round number
 *  of metres), so they read as noise next to the real dimension strings. The
 *  honest version of that affordance is the graphic scale bar below. */
export function renderFloorplanFrame(width: number, height: number): string {
  const x0 = FRAME_MARGIN, y0 = FRAME_MARGIN, x1 = width - FRAME_MARGIN, y1 = height - FRAME_MARGIN;
  let svg = '  <g class="seldia-floorplan-frame">\n';
  svg += `    <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${INK}" stroke-width="1.75"/>\n`;
  const i = 5;
  svg += `    <rect x="${x0 + i}" y="${y0 + i}" width="${x1 - x0 - i * 2}" height="${y1 - y0 - i * 2}" fill="none" stroke="${MUTED}" stroke-width="0.6"/>\n`;
  svg += '  </g>\n';
  return svg;
}

/** Graphic scale bar + north arrow, stamped in the bottom-left of the sheet.
 *  A graphic bar (rather than only the "1:100" text in the title block) is the
 *  one scale indicator that stays truthful when the drawing is zoomed or
 *  re-exported at another size, which is exactly what happens to an SVG. */
export function renderFloorplanScaleBar(height: number, scale: number): string {
  const x0 = FRAME_MARGIN + 18;
  const y0 = height - FRAME_MARGIN - 34;
  // Choose a bar length that is a round number of metres and roughly 120px.
  const metres = [1, 2, 5, 10, 20, 50].reduce((best, m) =>
    Math.abs(m * scale - 120) < Math.abs(best * scale - 120) ? m : best, 1);
  const barW = metres * scale, barH = 7, segs = metres <= 2 ? 2 : 4;
  let svg = '  <g class="seldia-floorplan-scalebar">\n';
  // Alternating filled/hollow segments, the standard graphic-scale checker.
  for (let i = 0; i < segs; i++) {
    const sx = x0 + (barW / segs) * i;
    svg += `    <rect x="${sx}" y="${y0}" width="${barW / segs}" height="${barH}" fill="${i % 2 ? PAPER : INK}" stroke="${INK}" stroke-width="0.8"/>\n`;
  }
  svg += `    <text x="${x0}" y="${y0 + barH + 12}" font-size="9" fill="${LABEL}" font-family="${FONT}">0</text>\n`;
  svg += `    <text x="${x0 + barW}" y="${y0 + barH + 12}" text-anchor="middle" font-size="9" fill="${LABEL}" font-family="${FONT}">${metres} m</text>\n`;

  // North arrow, to the right of the bar.
  const nx = x0 + barW + 40, ny = y0 + barH / 2;
  svg += `    <circle cx="${nx}" cy="${ny}" r="14" fill="none" stroke="${MUTED}" stroke-width="0.8"/>\n`;
  svg += `    <path d="M ${nx} ${ny - 11} L ${nx + 5} ${ny + 6} L ${nx} ${ny + 2} L ${nx - 5} ${ny + 6} Z" fill="${INK}"/>\n`;
  svg += `    <text x="${nx}" y="${ny + 24}" text-anchor="middle" font-size="9" font-weight="700" fill="${LABEL}" font-family="${FONT}">N</text>\n`;
  svg += '  </g>\n';
  return svg;
}

const TB_W = 250, TB_ROW = 21, TB_HEAD = 28;

/** Title block: a small labelled table stamped in the bottom-right corner,
 *  the standard drafting-sheet convention (ISO 7200 / ANSI Y14.1 layout,
 *  simplified to the fields this DSL actually captures). */
export function renderFloorplanTitleBlock(width: number, height: number, tb: TitleBlock): string {
  // The title itself moved to the header band above these rows, so it is not
  // repeated here — the block was previously the only place it appeared.
  const rows: [string, string][] = [
    ['Scale', tb.scale || '—'],
    ['Author', tb.author || '—'],
    ['Date', tb.date || '—'],
  ];
  if (tb.area) rows.splice(1, 0, ['Area', tb.area]);
  const x1 = width - FRAME_MARGIN - 6, y1 = height - FRAME_MARGIN - 6;
  const x0 = x1 - TB_W, y0 = y1 - TB_ROW * rows.length - TB_HEAD;
  let svg = '  <g class="seldia-floorplan-titleblock">\n';
  svg += `    <rect x="${x0}" y="${y0}" width="${TB_W}" height="${TB_ROW * rows.length + TB_HEAD}" fill="${PAPER}" stroke="${INK}" stroke-width="1.25"/>\n`;
  // Header band carrying the drawing title, set larger than the field rows —
  // on a real sheet the title is what you read from across the table.
  svg += `    <rect x="${x0}" y="${y0}" width="${TB_W}" height="${TB_HEAD}" fill="${INK}"/>\n`;
  svg += `    <text x="${x0 + 10}" y="${y0 + TB_HEAD / 2 + 5}" font-size="13" font-weight="700" fill="${PAPER}" font-family="${FONT}">${esc(tb.title || 'Untitled')}</text>\n`;
  rows.forEach(([label, value], i) => {
    const ry = y0 + TB_HEAD + i * TB_ROW;
    if (i > 0) svg += `    <line x1="${x0}" y1="${ry}" x2="${x1}" y2="${ry}" stroke="${MUTED}" stroke-width="0.6"/>\n`;
    svg += `    <line x1="${x0 + 68}" y1="${ry}" x2="${x0 + 68}" y2="${ry + TB_ROW}" stroke="${MUTED}" stroke-width="0.6"/>\n`;
    svg += `    <text x="${x0 + 10}" y="${ry + TB_ROW / 2 + 4}" font-size="9" font-weight="700" letter-spacing="0.5" fill="${MUTED}" font-family="${FONT}">${esc(label.toUpperCase())}</text>\n`;
    svg += `    <text x="${x0 + 78}" y="${ry + TB_ROW / 2 + 4}" font-size="11" fill="${INK}" font-family="${FONT}">${esc(value)}</text>\n`;
  });
  svg += '  </g>\n';
  return svg;
}

// ── Per-node symbols ─────────────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Room name plates, placed as a batch so each can be steered away from the
 *  furniture in its room (and from plates already placed). Rooms are rendered
 *  through this rather than the per-node hook because avoiding overlap needs
 *  to see the other nodes, which a single-node hook cannot. */
export function renderFloorplanRoomLabels(rooms: IRNode[], furniture: IRNode[]): string {
  if (!rooms.length) return '';
  const obstacles: Box[] = furniture.map((f) => ({ x: f.position.x, y: f.position.y, w: f.size.width, h: f.size.height }));
  let svg = '  <g class="seldia-floorplan-roomlabels">\n';
  // Biggest rooms first: they have the most placement freedom, so letting them
  // claim space early leaves the tight rooms the spots they actually need.
  const order = [...rooms].sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height);
  for (const r of order) {
    const scale = Number((r.data as any)?.fpScale) || 60;
    svg += renderRoomSymbol(r, scale, obstacles, (b) => obstacles.push(b));
  }
  svg += '  </g>\n';
  return svg;
}

function box(x: number, y: number, w: number, h: number, stroke: string, fill = FURN_FILL, r = 1.5): string {
  return `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.25"/>\n`;
}

/** Room annotation: name over floor area, centred in the room. Centring (the
 *  old code pinned the name to the top edge) is what a plan actually does —
 *  the label marks the space, and a top-pinned label reads as a caption on the
 *  wall above it, especially where two rooms stack vertically.
 *
 *  The area figure is the second thing anyone looks for on a plan after the
 *  room name, and it is derivable from geometry we already have. */
function renderRoomSymbol(node: IRNode, scale: number, obstacles: Box[] = [], claim?: (b: Box) => void): string {
  const { x, y } = node.position;
  const { width: w, height: h } = node.size;
  const areaM2 = (w / scale) * (h / scale);
  const twoLine = h > 2 * 13 * 1.5 + 10 && w > node.label.length * 13 * 0.62;
  if (!twoLine && !(h > 24 && w > node.label.length * 11 * 0.62)) return '';

  const fs = twoLine ? 13 : 11;
  const boxW = Math.max(node.label.length * fs * 0.62, 46) + 10;
  const boxH = twoLine ? 34 : 18;

  // Candidate anchor points, centre first then working outward. A plan puts
  // the room name in the middle of the free floor, so the centre is strongly
  // preferred and the alternatives are only reached when furniture is there.
  const inset = 10;
  const candidates: Array<[number, number]> = [
    [x + w / 2, y + h / 2],
    [x + w / 2, y + boxH / 2 + inset],
    [x + w / 2, y + h - boxH / 2 - inset],
    [x + boxW / 2 + inset, y + h / 2],
    [x + w - boxW / 2 - inset, y + h / 2],
    [x + boxW / 2 + inset, y + boxH / 2 + inset],
    [x + w - boxW / 2 - inset, y + boxH / 2 + inset],
    [x + boxW / 2 + inset, y + h - boxH / 2 - inset],
    [x + w - boxW / 2 - inset, y + h - boxH / 2 - inset],
  ];
  const hits = (cx: number, cy: number): number => {
    const b: Box = { x: cx - boxW / 2, y: cy - boxH / 2, w: boxW, h: boxH };
    // Must stay inside the room; a label pushed through a wall is worse than
    // one overlapping a rug.
    if (b.x < x + 2 || b.y < y + 2 || b.x + b.w > x + w - 2 || b.y + b.h > y + h - 2) return Infinity;
    return obstacles.reduce((n, o) => n + (overlaps(b, o) ? 1 : 0), 0);
  };
  let best = candidates[0], bestHits = hits(best[0], best[1]);
  for (const c of candidates.slice(1)) {
    if (bestHits === 0) break;
    const n = hits(c[0], c[1]);
    if (n < bestHits) { best = c; bestHits = n; }
  }
  const [cx, cy] = best;
  // Reserve the chosen spot so later rooms treat it as occupied — labels of
  // two rooms meeting at a thin partition can otherwise land back to back.
  claim?.({ x: cx - boxW / 2, y: cy - boxH / 2, w: boxW, h: boxH });

  let svg = '';
  // Where no clear spot exists, a soft paper backing keeps the name legible
  // over whatever it must sit on, rather than two overlapping inks.
  if (bestHits > 0) {
    svg += `    <rect x="${cx - boxW / 2}" y="${cy - boxH / 2}" width="${boxW}" height="${boxH}" rx="3" fill="${PAPER}" opacity="0.82"/>\n`;
  }
  if (twoLine) {
    svg += `    <text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}" font-family="${FONT}">${esc(node.label)}</text>\n`;
    svg += `    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="${LABEL}" font-family="${FONT}">${areaM2.toFixed(1)} m²</text>\n`;
  } else {
    svg += `    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${INK}" font-family="${FONT}">${esc(node.label)}</text>\n`;
  }
  return svg;
}

function renderFurnitureSymbol(node: IRNode): string {
  const { x, y } = node.position;
  const { width: w, height: h } = node.size;
  const cx = x + w / 2, cy = y + h / 2;
  const symbol = String((node.data as any)?.symbol || 'rect-label');
  // Where the label may go: 'in' = centred inside, 'none' = symbol speaks for
  // itself (or its interior is too busy with detail lines to take text).
  let labelSlot: 'in' | 'none' = 'in';
  let svg = '';
  switch (symbol) {
    case 'bed': {
      // Mattress with a pillow band at the head — the pillow is what tells a
      // reader which way the bed faces.
      svg += box(x, y, w, h, INK_SOFT, PAPER, 3);
      const pil = Math.min(h * 0.22, 22);
      svg += `    <rect x="${x + w * 0.07}" y="${y + 4}" width="${w * 0.86}" height="${pil}" rx="${pil / 2}" fill="${FURN_FILL}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      // Turned-back duvet line across the foot.
      svg += `    <line x1="${x}" y1="${y + h * 0.62}" x2="${x + w}" y2="${y + h * 0.62}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      break;
    }
    case 'sink':
      svg += box(x, y, w, h, INK_SOFT, PAPER, 3);
      svg += `    <ellipse cx="${cx}" cy="${cy + h * 0.06}" rx="${w * 0.34}" ry="${h * 0.3}" fill="${FURN_FILL}" stroke="${INK_SOFT}" stroke-width="1"/>\n`;
      svg += `    <circle cx="${cx}" cy="${cy + h * 0.06}" r="1.6" fill="${MUTED}"/>\n`;
      svg += `    <circle cx="${cx}" cy="${y + h * 0.14}" r="2.2" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      labelSlot = 'none';
      break;
    case 'stove':
      svg += box(x, y, w, h, INK_SOFT, PAPER);
      for (const [dx, dy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
        svg += `    <circle cx="${x + w * dx}" cy="${y + h * dy}" r="${Math.min(w, h) * 0.16}" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      }
      labelSlot = 'none';
      break;
    case 'fridge':
      svg += box(x, y, w, h, INK_SOFT);
      svg += `    <line x1="${x}" y1="${y + h * 0.34}" x2="${x + w}" y2="${y + h * 0.34}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      break;
    case 'counter':
      svg += box(x, y, w, h, INK_SOFT);
      break;
    case 'toilet':
      // Cistern against the wall, bowl in front.
      svg += `    <rect x="${x + w * 0.05}" y="${y}" width="${w * 0.9}" height="${h * 0.28}" rx="1.5" fill="${FURN_FILL}" stroke="${INK_SOFT}" stroke-width="1.1"/>\n`;
      svg += `    <ellipse cx="${cx}" cy="${y + h * 0.66}" rx="${w * 0.42}" ry="${h * 0.33}" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.1"/>\n`;
      labelSlot = 'none';
      break;
    case 'bathtub':
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h * 0.22, 10)}" fill="${FURN_FILL}" stroke="${INK_SOFT}" stroke-width="1.3"/>\n`;
      svg += `    <rect x="${x + w * 0.07}" y="${y + h * 0.16}" width="${w * 0.86}" height="${h * 0.68}" rx="${Math.min(h * 0.18, 8)}" fill="${PAPER}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      svg += `    <circle cx="${x + w * 0.88}" cy="${cy}" r="2" fill="${MUTED}"/>\n`;
      break;
    case 'shower':
      svg += box(x, y, w, h, INK_SOFT, PAPER);
      svg += `    <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.7"/>\n`;
      svg += `    <line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.7"/>\n`;
      svg += `    <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.16}" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1"/>\n`;
      labelSlot = 'none';
      break;
    case 'sofa': {
      // Back cushion band along the top, arms at each end, seat between.
      const arm = Math.min(w * 0.1, 12), back = Math.min(h * 0.28, 16);
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${FURN_FILL}" stroke="${INK_SOFT}" stroke-width="1.25"/>\n`;
      svg += `    <line x1="${x}" y1="${y + back}" x2="${x + w}" y2="${y + back}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      svg += `    <line x1="${x + arm}" y1="${y + back}" x2="${x + arm}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      svg += `    <line x1="${x + w - arm}" y1="${y + back}" x2="${x + w - arm}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      break;
    }
    case 'chair':
      svg += box(x, y, w, h, INK_SOFT, PAPER, 2.5);
      svg += `    <line x1="${x + 1}" y1="${y + 2}" x2="${x + w - 1}" y2="${y + 2}" stroke="${INK_SOFT}" stroke-width="2"/>\n`;
      labelSlot = 'none';
      break;
    case 'table':
      svg += box(x, y, w, h, INK_SOFT, PAPER, 2.5);
      break;
    case 'tv':
      // A TV is a thin slab against a wall; drawn solid so it reads at depth
      // 0.1 m where an outline would collapse into a single line.
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${Math.max(h, 4)}" fill="${INK_SOFT}"/>\n`;
      labelSlot = 'none';
      break;
    case 'shelf': {
      svg += box(x, y, w, h, INK_SOFT, PAPER, 1);
      const div = Math.max(2, Math.round(w / 40));
      for (let i = 1; i < div; i++) svg += `    <line x1="${x + (w / div) * i}" y1="${y}" x2="${x + (w / div) * i}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.8"/>\n`;
      labelSlot = 'none';
      break;
    }
    case 'stairs-straight': {
      // Treads across the run, with the direction-of-travel arrow drafters
      // always draw pointing UP the flight.
      svg += box(x, y, w, h, INK_SOFT, PAPER, 0);
      const steps = Math.max(4, Math.round(h / 26));
      for (let i = 1; i < steps; i++) svg += `    <line x1="${x}" y1="${y + (h / steps) * i}" x2="${x + w}" y2="${y + (h / steps) * i}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      svg += `    <line x1="${cx}" y1="${y + h - 8}" x2="${cx}" y2="${y + 10}" stroke="${INK_SOFT}" stroke-width="1.2"/>\n`;
      svg += `    <path d="M ${cx} ${y + 5} l -4 7 l 8 0 Z" fill="${INK_SOFT}"/>\n`;
      svg += `    <text x="${cx + 6}" y="${y + h - 10}" font-size="8" fill="${LABEL}" font-family="${FONT}">UP</text>\n`;
      labelSlot = 'none';
      break;
    }
    case 'stairs-turn': {
      svg += box(x, y, w, h, INK_SOFT, PAPER, 0);
      for (let i = 1; i < 5; i++) svg += `    <line x1="${x}" y1="${y + (h / 10) * i}" x2="${x + w / 2}" y2="${y + (h / 10) * i}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      for (let i = 1; i < 5; i++) svg += `    <line x1="${x + w / 2}" y1="${y + h / 2}" x2="${x + w - (w / 10) * i}" y2="${y + h / 2}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      svg += `    <line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.9"/>\n`;
      labelSlot = 'none';
      break;
    }
    case 'stairs-spiral':
      svg += `    <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" fill="${PAPER}" stroke="${INK_SOFT}" stroke-width="1.25"/>\n`;
      // Radial treads, which is what a spiral stair actually looks like in plan.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r0 = Math.min(w, h) * 0.12, r1 = Math.min(w, h) / 2;
        svg += `    <line x1="${cx + r0 * Math.cos(a)}" y1="${cy + r0 * Math.sin(a)}" x2="${cx + r1 * Math.cos(a)}" y2="${cy + r1 * Math.sin(a)}" stroke="${MUTED}" stroke-width="0.8"/>\n`;
      }
      svg += `    <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.12}" fill="${FURN_FILL}" stroke="${INK_SOFT}" stroke-width="1"/>\n`;
      labelSlot = 'none';
      break;
    case 'carpet':
      // A rug sits under everything else and must never obscure it, so it is
      // an outline only — no fill, and drawn before the other furniture.
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="5,4"/>\n`;
      labelSlot = 'none';
      break;
    case 'radiator': {
      // A thin wall-mounted panel: the standard fin-lines symbol, ribs running
      // across the short axis so it reads correctly whether the radiator sits
      // along a horizontal or vertical wall.
      svg += box(x, y, w, h, INK_SOFT, PAPER, 1);
      const vertical = h > w;
      const fins = Math.max(4, Math.round((vertical ? h : w) / 6));
      for (let i = 1; i < fins; i++) {
        svg += vertical
          ? `    <line x1="${x + 1}" y1="${y + (h / fins) * i}" x2="${x + w - 1}" y2="${y + (h / fins) * i}" stroke="${MUTED}" stroke-width="0.8"/>\n`
          : `    <line x1="${x + (w / fins) * i}" y1="${y + 1}" x2="${x + (w / fins) * i}" y2="${y + h - 1}" stroke="${MUTED}" stroke-width="0.8"/>\n`;
      }
      labelSlot = 'none';
      break;
    }
    case 'floor-heating': {
      // Underfloor heating: a zone fill, not an object — drawn as a serpentine
      // pipe run (the real installation pattern) inside a dashed zone outline,
      // matching the rug's "sits under everything, outline only" treatment.
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3,3"/>\n`;
      const rows = Math.max(2, Math.round(h / (Math.min(w, h) * 0.22)));
      const rowH = h / rows;
      const inset = Math.min(w, h) * 0.12;
      let path = `M ${x + inset} ${y + rowH / 2}`;
      for (let i = 0; i < rows; i++) {
        const yMid = y + rowH * i + rowH / 2;
        const goingRight = i % 2 === 0;
        path += ` L ${goingRight ? x + w - inset : x + inset} ${yMid}`;
        if (i < rows - 1) path += ` L ${goingRight ? x + w - inset : x + inset} ${yMid + rowH}`;
      }
      svg += `    <path d="${path}" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      labelSlot = 'none';
      break;
    }
    default:
      svg += box(x, y, w, h, INK_SOFT);
  }
  // Labelling rule — the old code hung every label *below* the symbol, in the
  // neighbouring floor space, where it collided with the next item, the room
  // name, and the walls. Instead the label goes INSIDE the symbol, and only
  // when the symbol is genuinely big enough to hold it. Small fixtures (a
  // chair, a sink) are recognisable from their symbol and carry no text at
  // all, which is also what a real plan does.
  const textW = node.label.length * 8.5 * 0.6 + 8;
  if (labelSlot === 'in' && w >= textW && h >= 20) {
    svg += `    <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="8.5" fill="${LABEL}" font-family="${FONT}">${esc(node.label)}</text>\n`;
  }
  return svg;
}

export function renderFloorplanNode(node: IRNode, _pad: number, _swatch: Swatch): string {
  const kind = String((node.data as any)?.fpKind || '');
  if (kind === 'furniture') {
    const rotation = Number((node.data as any)?.rotation) || 0;
    const svg = renderFurnitureSymbol(node);
    if (!rotation || !svg) return svg;
    // Rotate about the symbol's own centre — every symbol case draws relative
    // to node.position/size, so a plain rotate() around that centre turns the
    // whole thing (outline, detail lines, label) together without needing
    // per-symbol rotation logic.
    const cx = node.position.x + node.size.width / 2;
    const cy = node.position.y + node.size.height / 2;
    return `    <g transform="rotate(${rotation} ${cx} ${cy})">\n${svg}    </g>\n`;
  }
  // Rooms go through renderFloorplanRoomLabels (it needs every node to place
  // labels clear of furniture), doors/windows through renderFloorplanWalls,
  // and measures through renderFloorplanMeasures — none of them per-node.
  return '';
}
