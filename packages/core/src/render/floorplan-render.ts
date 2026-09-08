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
import { escapeXml as esc } from './escape.js';

const INK = '#1f2933';
const MUTED = '#64748b';
const EXTERIOR_WALL = 7;
const INTERIOR_WALL = 4;

interface FpWallSeg { x1: number; y1: number; x2: number; y2: number; kind: 'exterior' | 'interior' }
interface FpOpening { x1: number; y1: number; x2: number; y2: number; kind: 'door' | 'window' }

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

/** A door: gap in the wall, a leaf line, and a quarter-circle swing arc — the
 *  universal architectural door symbol. */
function renderDoor(o: FpOpening): string {
  const horizontal = Math.abs(o.x2 - o.x1) >= Math.abs(o.y2 - o.y1);
  const w = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  // Erase the wall under the opening with a background-colored line, then
  // draw the leaf (closed position) and the swing arc from hinge to open.
  let svg = `    <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="#ffffff" stroke-width="${EXTERIOR_WALL + 2}"/>\n`;
  if (horizontal) {
    const hx = Math.min(o.x1, o.x2), hy = o.y1;
    svg += `    <line x1="${hx}" y1="${hy}" x2="${hx}" y2="${hy - w}" stroke="${INK}" stroke-width="1.5"/>\n`;
    svg += `    <path d="M ${hx} ${hy - w} A ${w} ${w} 0 0 1 ${hx + w} ${hy}" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3,3"/>\n`;
  } else {
    const hx = o.x1, hy = Math.min(o.y1, o.y2);
    svg += `    <line x1="${hx}" y1="${hy}" x2="${hx + w}" y2="${hy}" stroke="${INK}" stroke-width="1.5"/>\n`;
    svg += `    <path d="M ${hx + w} ${hy} A ${w} ${w} 0 0 1 ${hx} ${hy + w}" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3,3"/>\n`;
  }
  return svg;
}

/** A window: the wall gap filled with three parallel lines (frame + two
 *  panes) — the standard window-in-wall symbol, clearly distinct from both a
 *  solid wall and a door's swing-arc gap. */
function renderWindow(o: FpOpening): string {
  // Erase the wall under the opening, then lay three thin parallel strokes
  // across the gap, perpendicular offsets scaled to the wall thickness so
  // they read as "glazing lines" rather than merging into one blob.
  let svg = `    <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="#ffffff" stroke-width="${EXTERIOR_WALL + 4}"/>\n`;
  const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1;
  const px = -(o.y2 - o.y1) / len, py = (o.x2 - o.x1) / len; // unit perpendicular
  const off = EXTERIOR_WALL / 2;
  for (const k of [-off, 0, off]) {
    const dx = px * k, dy = py * k;
    svg += `    <line x1="${o.x1 + dx}" y1="${o.y1 + dy}" x2="${o.x2 + dx}" y2="${o.y2 + dy}" stroke="${INK}" stroke-width="1.5"/>\n`;
  }
  return svg;
}

// ── Blueprint frame + title block (whole-canvas chrome) ─────────────────────

export interface TitleBlock { title?: string; scale?: string; author?: string; date?: string }

const FRAME_MARGIN = 24;
const TICK_ZONE = 16;

/** Border frame with ruler tick marks along each edge — drawn under
 *  everything else, first thing after the background rect. */
export function renderFloorplanFrame(width: number, height: number): string {
  const x0 = FRAME_MARGIN, y0 = FRAME_MARGIN, x1 = width - FRAME_MARGIN, y1 = height - FRAME_MARGIN;
  let svg = '  <g class="seldia-floorplan-frame">\n';
  svg += `    <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${INK}" stroke-width="2"/>\n`;
  const step = 40;
  for (let x = x0 + step; x < x1; x += step) {
    svg += `    <line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + TICK_ZONE * 0.4}" stroke="${MUTED}" stroke-width="1"/>\n`;
    svg += `    <line x1="${x}" y1="${y1 - TICK_ZONE * 0.4}" x2="${x}" y2="${y1}" stroke="${MUTED}" stroke-width="1"/>\n`;
  }
  for (let y = y0 + step; y < y1; y += step) {
    svg += `    <line x1="${x0}" y1="${y}" x2="${x0 + TICK_ZONE * 0.4}" y2="${y}" stroke="${MUTED}" stroke-width="1"/>\n`;
    svg += `    <line x1="${x1 - TICK_ZONE * 0.4}" y1="${y}" x2="${x1}" y2="${y}" stroke="${MUTED}" stroke-width="1"/>\n`;
  }
  svg += '  </g>\n';
  return svg;
}

const TB_W = 260, TB_ROW = 22;

/** Title block: a small labelled table stamped in the bottom-right corner,
 *  the standard drafting-sheet convention (ISO 7200 / ANSI Y14.1 layout,
 *  simplified to the fields this DSL actually captures). */
export function renderFloorplanTitleBlock(width: number, height: number, tb: TitleBlock): string {
  const rows: [string, string][] = [
    ['Title', tb.title || 'Untitled'],
    ['Scale', tb.scale || '—'],
    ['Author', tb.author || '—'],
    ['Date', tb.date || '—'],
  ];
  const x1 = width - FRAME_MARGIN, y1 = height - FRAME_MARGIN;
  const x0 = x1 - TB_W, y0 = y1 - TB_ROW * rows.length;
  let svg = '  <g class="seldia-floorplan-titleblock">\n';
  svg += `    <rect x="${x0}" y="${y0}" width="${TB_W}" height="${TB_ROW * rows.length}" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>\n`;
  rows.forEach(([label, value], i) => {
    const ry = y0 + i * TB_ROW;
    if (i > 0) svg += `    <line x1="${x0}" y1="${ry}" x2="${x1}" y2="${ry}" stroke="${INK}" stroke-width="0.75"/>\n`;
    svg += `    <line x1="${x0 + 70}" y1="${ry}" x2="${x0 + 70}" y2="${ry + TB_ROW}" stroke="${INK}" stroke-width="0.75"/>\n`;
    svg += `    <text x="${x0 + 8}" y="${ry + TB_ROW / 2 + 4}" font-size="10" font-weight="700" fill="${MUTED}" font-family="sans-serif">${esc(label.toUpperCase())}</text>\n`;
    svg += `    <text x="${x0 + 78}" y="${ry + TB_ROW / 2 + 4}" font-size="11" fill="${INK}" font-family="sans-serif">${esc(value)}</text>\n`;
  });
  svg += '  </g>\n';
  return svg;
}

// ── Per-node symbols ─────────────────────────────────────────────────────

function box(x: number, y: number, w: number, h: number, stroke: string, fill = 'none'): string {
  return `    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.25"/>\n`;
}

function label(x: number, y: number, text: string, size = 10): string {
  return `    <text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" fill="${INK}" font-family="sans-serif">${esc(text)}</text>\n`;
}

function renderRoomSymbol(node: IRNode): string {
  const { x, y } = node.position;
  const { width: w, height: h } = node.size;
  let svg = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="none"/>\n`;
  svg += label(x + w / 2, y + 18, node.label, 13);
  return svg;
}

function renderFurnitureSymbol(node: IRNode): string {
  const { x, y } = node.position;
  const { width: w, height: h } = node.size;
  const cx = x + w / 2, cy = y + h / 2;
  const symbol = String((node.data as any)?.symbol || 'rect-label');
  let svg = '';
  switch (symbol) {
    case 'bed':
      svg += box(x, y, w, h, INK);
      svg += `    <rect x="${x + w * 0.08}" y="${y + h * 0.06}" width="${w * 0.84}" height="${h * 0.18}" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    case 'sink':
      svg += `    <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="${INK}" stroke-width="1.25"/>\n`;
      svg += `    <circle cx="${cx}" cy="${cy}" r="2" fill="${MUTED}"/>\n`;
      break;
    case 'stove':
      svg += box(x, y, w, h, INK);
      for (const [dx, dy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
        svg += `    <circle cx="${x + w * dx}" cy="${y + h * dy}" r="${Math.min(w, h) * 0.12}" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      }
      break;
    case 'fridge':
      svg += box(x, y, w, h, INK);
      svg += `    <line x1="${x}" y1="${y + h * 0.3}" x2="${x + w}" y2="${y + h * 0.3}" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    case 'counter':
      svg += box(x, y, w, h, INK, '#f6f8fb');
      break;
    case 'toilet':
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h * 0.35}" fill="none" stroke="${INK}" stroke-width="1.25"/>\n`;
      svg += `    <ellipse cx="${cx}" cy="${y + h * 0.65}" rx="${w * 0.4}" ry="${h * 0.32}" fill="none" stroke="${INK}" stroke-width="1.25"/>\n`;
      break;
    case 'bathtub':
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.4}" fill="none" stroke="${INK}" stroke-width="1.5"/>\n`;
      svg += `    <rect x="${x + w * 0.06}" y="${y + h * 0.15}" width="${w * 0.88}" height="${h * 0.7}" rx="${h * 0.3}" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    case 'shower':
      svg += box(x, y, w, h, INK);
      svg += `    <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.75"/>\n`;
      svg += `    <line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="${MUTED}" stroke-width="0.75"/>\n`;
      break;
    case 'sofa':
      svg += box(x, y, w, h, INK, '#f6f8fb');
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h * 0.25}" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    case 'chair':
      svg += box(x, y, w, h, INK);
      svg += `    <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y}" stroke="${MUTED}" stroke-width="2"/>\n`;
      break;
    case 'table':
      svg += box(x, y, w, h, INK, '#fafafa');
      break;
    case 'tv':
      svg += box(x, y, w, h, INK, INK);
      break;
    case 'shelf':
      svg += box(x, y, w, h, INK);
      svg += `    <line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    case 'stairs-straight': {
      svg += box(x, y, w, h, INK);
      const steps = 8;
      for (let i = 1; i < steps; i++) svg += `    <line x1="${x}" y1="${y + (h / steps) * i}" x2="${x + w}" y2="${y + (h / steps) * i}" stroke="${MUTED}" stroke-width="1"/>\n`;
      svg += `    <path d="M ${x + 6} ${y + h - 6} L ${x + w - 6} ${y + 6}" stroke="${INK}" stroke-width="1" marker-end="none"/>\n`;
      break;
    }
    case 'stairs-turn': {
      svg += box(x, y, w, h, INK);
      for (let i = 1; i < 5; i++) svg += `    <line x1="${x}" y1="${y + (h / 10) * i}" x2="${x + w / 2}" y2="${y + (h / 10) * i}" stroke="${MUTED}" stroke-width="1"/>\n`;
      for (let i = 1; i < 5; i++) svg += `    <line x1="${x + w / 2}" y1="${y + h / 2}" x2="${x + w - (w / 10) * i}" y2="${y + h / 2}" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    }
    case 'stairs-spiral':
      svg += `    <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" fill="none" stroke="${INK}" stroke-width="1.25"/>\n`;
      svg += `    <path d="M ${cx} ${cy} m 0 -${h / 2} a ${h / 2} ${h / 2} 0 1 1 -0.1 0" fill="none" stroke="${MUTED}" stroke-width="1"/>\n`;
      break;
    case 'carpet':
      svg += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="4,3"/>\n`;
      break;
    default:
      svg += box(x, y, w, h, INK);
  }
  if (symbol !== 'tv') svg += label(cx, y + h + 12, node.label, 9);
  return svg;
}

export function renderFloorplanNode(node: IRNode, _pad: number, _swatch: Swatch): string {
  const kind = String((node.data as any)?.fpKind || '');
  if (kind === 'room') return renderRoomSymbol(node);
  if (kind === 'furniture') return renderFurnitureSymbol(node);
  // door/window are drawn by renderFloorplanWalls, not per-node — nothing to add here.
  return '';
}
