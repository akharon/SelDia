// =============================================================================
// SelDiA — PCB board view (render-only)
// =============================================================================
// The fence body is a raw `.kicad_pcb` (carried on `ast.raw`). One IR node holds
// the parsed board; renderNode draws it as precise geometry — no Rough jitter,
// mm scaled to px. Optional header lines in the body: `side: back`, `scale: 6`.
// =============================================================================

import type { DiagramPlugin, PluginDiagnostic } from '../plugin/types.js';
import type { DiagramAST } from '../ast/nodes.js';
import type { DiagramIR, IRNode } from '../ir/types.js';
import { DiagramType } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import type { CustomLayoutResult } from '../render/custom-layout.js';
import { parseKicadPcb, boardBounds, place, type Board, type Pad, type Line, type Circle, type Arc, type Pt } from '../pcb/kicad-pcb.js';
import { escapeXml } from '../render/escape.js';

const MARGIN = 5;   // mm of dark substrate around the outline (or item bounds)
export const PCB_COLORS = {
  bg: '#0d1f17', board: '#14291f', edge: '#e0e0a0', hole: '#06100b',
  fCu: '#c83434', bCu: '#4aa65a', fSilk: '#f2f2f2', bSilk: '#e8d98a', text: '#f2f2f2',
};

export interface PcbOptions { side: 'front' | 'back'; scale: number }

/** Split the optional `side:` / `scale:` header lines off the board text. */
export function pcbOptions(raw: string): { opts: PcbOptions; text: string } {
  const opts: PcbOptions = { side: 'front', scale: 8 };
  const text = raw.replace(/^[ \t]*(side|scale)[ \t]*[:=][ \t]*(\S+)[ \t]*$/gim, (_m, k: string, v: string) => {
    if (k.toLowerCase() === 'side') opts.side = /^b/i.test(v) ? 'back' : 'front';
    else if (parseFloat(v) > 0) opts.scale = parseFloat(v);
    return '';
  });
  return { opts, text };
}

function boardSize(b: Board, opts: PcbOptions) {
  const bb = boardBounds(b);
  return { bb, w: (bb.w + 2 * MARGIN) * opts.scale, h: (bb.h + 2 * MARGIN) * opts.scale };
}

export function transformPcb(ast: DiagramAST): DiagramIR {
  const { opts, text } = pcbOptions(ast.raw ?? '');
  const board = parseKicadPcb(text);
  const { w, h } = boardSize(board, opts);
  const node = {
    id: 'board', label: ast.title ?? 'PCB', shape: ShapeType.RECTANGLE, position: { x: 0, y: 0 }, size: { width: w, height: h },
    style: {}, ports: [], classList: [], collapsed: false, data: { role: 'pcb', board, opts },
  } as IRNode;
  return {
    id: 'pcb-1', type: 'pcb' as DiagramType, title: ast.title ?? 'PCB', nodes: [node], edges: [], groups: [], layers: [],
    metadata: { footprints: board.footprints.length, tracks: board.tracks.length, vias: board.vias.length },
  } as DiagramIR;
}

/** Import a raw `.kicad_pcb` body (same path the markdown preview uses). */
export function importPcb(raw: string): { ir: DiagramIR; diagnostics: Array<{ line: number; message: string }> } {
  return { ir: transformPcb({ raw } as DiagramAST), diagnostics: [] };
}

export function layoutPcb(ir: DiagramIR): CustomLayoutResult {
  const n = ir.nodes[0];
  return { nodes: ir.nodes, edges: [], bounds: { x: 0, y: 0, width: n?.size.width ?? 0, height: n?.size.height ?? 0 } };
}

const f = (n: number) => Math.round(n * 100) / 100;

function arcPath(a: Arc, X: (p: Pt) => Pt, mirror: boolean): string {
  const s = X(a.start), e = X(a.end);
  if (!a.mid) return `M${f(s.x)} ${f(s.y)}L${f(e.x)} ${f(e.y)}`;
  const m = X(a.mid);
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  if (Math.abs(d) < 1e-9) return `M${f(s.x)} ${f(s.y)}L${f(e.x)} ${f(e.y)}`;
  const s2 = s.x * s.x + s.y * s.y, m2 = m.x * m.x + m.y * m.y, e2 = e.x * e.x + e.y * e.y;
  const cx = (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d;
  const cy = (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d;
  const r = Math.hypot(s.x - cx, s.y - cy);
  const cross = (m.x - s.x) * (e.y - m.y) - (m.y - s.y) * (e.x - m.x);
  const sweep = cross > 0 ? 1 : 0;
  const ang = (p: Pt) => Math.atan2(p.y - cy, p.x - cx);
  let span = (ang(e) - ang(s)) * (sweep ? 1 : -1);
  span = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  void mirror;
  return `M${f(s.x)} ${f(s.y)}A${f(r)} ${f(r)} 0 ${span > Math.PI ? 1 : 0} ${sweep} ${f(e.x)} ${f(e.y)}`;
}

export function renderBoard(board: Board, opts: PcbOptions, ox: number, oy: number): string {
  const { bb, w, h } = boardSize(board, opts);
  const S = opts.scale, back = opts.side === 'back', C = PCB_COLORS;
  const X = (p: Pt): Pt => {
    const px = (p.x - bb.x + MARGIN) * S, py = (p.y - bb.y + MARGIN) * S;
    return { x: back ? w - px : px, y: py };
  };
  const ln = (l: Line, col: string, min = 0.8) => {
    const a = X({ x: l.x1, y: l.y1 }), b = X({ x: l.x2, y: l.y2 });
    return `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${col}" stroke-width="${f(Math.max(l.width * S, min))}" stroke-linecap="round"/>`;
  };
  const ci = (c: Circle, col: string, fill = 'none') => {
    const p = X({ x: c.cx, y: c.cy });
    return `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(c.r * S)}" fill="${fill}" stroke="${col}" stroke-width="${f(Math.max(c.width * S, 0.8))}"/>`;
  };
  // Layers in paint order: the far side first, dimmed, so the viewed side sits on top.
  const sides = back ? ['F', 'B'] : ['B', 'F'];
  const cu = (s: string) => (s === 'F' ? C.fCu : C.bCu);
  const silk = (s: string) => (s === 'F' ? C.fSilk : C.bSilk);
  const view = back ? 'B' : 'F';
  let g = `<g data-token-exempt="pcb-geometry" transform="translate(${f(ox)} ${f(oy)})">`;
  g += `<rect width="${f(w)}" height="${f(h)}" fill="${C.bg}" rx="2"/>`;
  // Substrate: tint the Edge.Cuts rectangle region (bbox of the outline).
  g += `<rect x="${f(MARGIN * S)}" y="${f(MARGIN * S)}" width="${f(bb.w * S)}" height="${f(bb.h * S)}" fill="${C.board}"/>`;

  for (const s of sides) {
    const op = s === view ? 1 : 0.45, layer = `${s}.Cu`;
    g += `<g opacity="${op}">`;
    for (const t of board.tracks.filter((t) => t.layer === layer)) g += ln({ layer, x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, width: t.width }, cu(s), 1);
    for (const fp of board.footprints) for (const p of fp.pads) {
      if (!(p.layers.includes(layer) || (p.layers.includes('*.Cu') && s === view))) continue;
      g += padSvg(p, fp, X, S, cu(s), back);
    }
    g += '</g>';
  }
  for (const s of sides) {
    const col = silk(s), layer = `${s}.SilkS`, op = s === view ? 1 : 0.35;
    g += `<g opacity="${op}">`;
    for (const fp of board.footprints) {
      for (const l of fp.lines.filter((l) => l.layer === layer)) {
        const a = place(fp, l.x1, l.y1), b = place(fp, l.x2, l.y2);
        g += ln({ ...l, x1: a.x, y1: a.y, x2: b.x, y2: b.y }, col);
      }
      for (const c of fp.circles.filter((c) => c.layer === layer)) { const p = place(fp, c.cx, c.cy); g += ci({ ...c, cx: p.x, cy: p.y }, col); }
      if (fp.ref && !fp.refHidden && fp.refLayer === layer) {
        const p = fp.refAt ? place(fp, fp.refAt.x, fp.refAt.y) : { x: fp.x, y: fp.y }, q = X(p);
        g += `<text x="${f(q.x)}" y="${f(q.y)}" text-anchor="middle" dominant-baseline="central" font-size="${f(Math.max(7, 1.1 * S))}" font-family="sans-serif" fill="${col}">${escapeXml(fp.ref)}</text>`;
      }
    }
    g += '</g>';
  }
  // Through-hole drills and vias sit above all copper.
  for (const fp of board.footprints) for (const p of fp.pads) {
    if (p.drill > 0) { const q = X(place(fp, p.x, p.y)); g += `<circle cx="${f(q.x)}" cy="${f(q.y)}" r="${f(p.drill * S / 2)}" fill="${C.hole}"/>`; }
  }
  for (const v of board.vias) {
    const q = X(v);
    g += `<circle cx="${f(q.x)}" cy="${f(q.y)}" r="${f(v.size * S / 2)}" fill="#9aa0a6"/><circle cx="${f(q.x)}" cy="${f(q.y)}" r="${f(v.drill * S / 2)}" fill="${C.hole}"/>`;
  }
  // Outline last so it stays crisp.
  const edge = (l: { layer: string }) => l.layer === 'Edge.Cuts';
  const es = `fill="none" stroke="${C.edge}" stroke-linecap="round"`;
  for (const l of board.lines.filter(edge)) g += ln(l, C.edge, 1.2);
  for (const c of board.circles.filter(edge)) g += ci(c, C.edge);
  for (const a of board.arcs.filter(edge)) g += `<path d="${arcPath(a, X, back)}" ${es} stroke-width="${f(Math.max(a.width * S, 1.2))}"/>`;
  return g + '</g>';
}

function padSvg(p: Pad, fp: { x: number; y: number; rot: number }, X: (p: Pt) => Pt, S: number, col: string, mirror: boolean): string {
  const q = X(place(fp, p.x, p.y));
  const w = p.w * S, h = p.h * S;
  const rot = mirror ? -p.rot : p.rot;   // KiCad angles are CCW on y-down: SVG rotate() is CW, so negate
  const tf = `transform="rotate(${f(-rot)} ${f(q.x)} ${f(q.y)})"`;
  if (p.shape === 'circle') return `<circle cx="${f(q.x)}" cy="${f(q.y)}" r="${f(w / 2)}" fill="${col}"/>`;
  const rx = p.shape === 'oval' ? Math.min(w, h) / 2 : p.shape === 'roundrect' ? Math.min(w, h) * p.ratio : 0;
  return `<rect x="${f(q.x - w / 2)}" y="${f(q.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${col}" ${tf}/>`;
}

export const pcbPlugin: DiagramPlugin = {
  id: 'seldia.pcb',
  name: 'PCB board view',
  version: '0.1.0',
  diagramType: 'pcb' as DiagramType,
  description: 'Render-only view of a KiCad .kicad_pcb board',

  transform: (ast) => transformPcb(ast),

  validate(ast: DiagramAST): PluginDiagnostic[] {
    const { text } = pcbOptions(ast.raw ?? '');
    return /\(\s*(kicad_pcb|footprint|module|gr_line|segment)\b/.test(text) ? []
      : [{ severity: 'warning', message: 'pcb: no .kicad_pcb content found' } as PluginDiagnostic];
  },

  renderNode(node, ctx) {
    const d = node.data as any;
    if (d?.role !== 'pcb') return undefined;
    return renderBoard(d.board, d.opts, node.position.x + ctx.pad, node.position.y + ctx.pad) + '\n';
  },

  getDefaultLayoutOptions: () => ({}),
};
