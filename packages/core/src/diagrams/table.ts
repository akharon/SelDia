// =============================================================================
// SelDiA — `table` diagram type (merged cells, optional chart)
// =============================================================================
// The fence body is GFM-like pipe rows carried verbatim on `ast.raw` (pipes,
// `^` and `<` never reach the DSL lexer). transform() resolves merges in
// table/model.ts and emits one IR node per anchor cell carrying its
// rowspan/colspan; layoutTable sizes columns/rows from the cell text; the
// renderNode hook draws each cell in the same quiet language as the Markdown
// preview's GFM tables (P1): faint header band, zebra rows, hairline row rules,
// a stronger head rule, no outer box, tabular figures. Crisp, never sketchy.
// =============================================================================

import type { DiagramPlugin, PluginDiagnostic } from '../plugin/types.js';
import type { DiagramAST } from '../ast/nodes.js';
import type { DiagramIR, IRNode } from '../ir/types.js';
import type { DiagramType } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import type { CustomLayoutResult } from '../render/custom-layout.js';
import { DS, blendHex, getPaletteOverride } from '../render/design-system.js';
import { textWidth } from '../layout/text-measure.js';
import { escapeXml } from '../render/escape.js';
import { parseTableBody, type TableAlign, type TableModel } from '../table/model.js';
import { tableToChartIR } from '../table/to-chart.js';

const FS = DS.fontSize.label;
const LINE_H = Math.round(FS * 1.35);
const PAD_X = 12;
const PAD_Y = 6;
const MIN_COL = 36;
const MAX_COL = 320;
/** Bold header glyphs run a little wider than the regular-weight estimate. */
const BOLD = 1.06;

export interface TableCellData {
  role: 'table-cell';
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  header: boolean;
  align: TableAlign;
  /** Wrapped display lines (set by layout). */
  lines?: string[];
  /** Body-row parity of the anchor row (zebra), and whether the cell's
   *  bottom edge is the table's last rule. */
  zebra?: boolean;
  last?: boolean;
}

/** Map the fence-body-relative line to a 1-based source line. */
function srcLine(ast: DiagramAST, bodyLine: number): number {
  return (ast.rawLine ?? 1) + bodyLine;
}

export function transformTable(ast: DiagramAST): DiagramIR {
  const model = parseTableBody(ast.raw ?? '');
  const nodes: IRNode[] = model.cells.map((c) => ({
    id: `c-${c.row}-${c.col}`,
    label: c.text,
    shape: ShapeType.RECTANGLE,
    position: { x: 0, y: 0 },
    size: { width: 0, height: 0 },
    style: {}, ports: [], classList: [], collapsed: false,
    data: { role: 'table-cell', row: c.row, col: c.col, rowspan: c.rowspan, colspan: c.colspan, header: c.header, align: model.align[c.col] ?? null } satisfies TableCellData,
  } as IRNode));
  const metadata: Record<string, unknown> = {
    table: { rows: model.rows, cols: model.cols, align: model.align },
  };
  // A `chart …` directive: the chart is built HERE, from the resolved table
  // model, as an ordinary chart IR (G1) — the engine lays it out and renders
  // it with the existing chart pipeline, below the table (or alone: `only`).
  if (model.chart) {
    metadata.tableChart = tableToChartIR(model, model.chart, ast.title);
    if (model.chart.only) metadata.tableChartOnly = true;
  }
  return {
    id: 'table-1', type: 'table' as DiagramType, title: ast.title ?? 'Table',
    nodes, edges: [], groups: [], layers: [], metadata,
  } as DiagramIR;
}

/** Same pipeline the markdown preview / CLI use, for a raw table body. */
export function importTable(raw: string): { ir: DiagramIR; model: TableModel } {
  return { ir: transformTable({ raw } as DiagramAST), model: parseTableBody(raw) };
}

// ── Layout ──────────────────────────────────────────────────────────────

/** Greedy word wrap against an estimated width; a single over-long word is
 *  kept whole on its own line rather than split mid-word. */
function wrap(text: string, max: number, scale: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, FS) * scale > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function cellD(n: IRNode): TableCellData { return n.data as unknown as TableCellData; }

export function layoutTable(ir: DiagramIR): CustomLayoutResult {
  const meta = (ir.metadata?.table ?? {}) as { rows?: number; cols?: number };
  const rows = meta.rows ?? 0, cols = meta.cols ?? 0;
  const cells = ir.nodes.filter((n) => cellD(n)?.role === 'table-cell');
  if (!rows || !cols || !cells.length) return { nodes: ir.nodes, edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };

  const natural = (n: IRNode) => Math.ceil(textWidth(n.label, FS) * (cellD(n).header ? BOLD : 1) + 2 * PAD_X);
  // Columns: single-column cells first, capped so prose wraps instead of
  // stretching the table; then each spanning cell tops up the last column it
  // covers by whatever its own text still lacks.
  const colW = new Array<number>(cols).fill(MIN_COL);
  for (const n of cells) { const d = cellD(n); if (d.colspan === 1) colW[d.col] = Math.max(colW[d.col], Math.min(MAX_COL, natural(n))); }
  for (const n of cells) {
    const d = cellD(n);
    if (d.colspan === 1) continue;
    let span = 0; for (let c = d.col; c < d.col + d.colspan; c++) span += colW[c];
    const need = Math.min(MAX_COL * d.colspan, natural(n));
    if (need > span) colW[d.col + d.colspan - 1] += need - span;
  }
  const colX: number[] = []; { let x = 0; for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c]; } colX.push(x); }
  const spanW = (d: TableCellData) => colX[d.col + d.colspan] - colX[d.col];

  const lines = new Map<string, string[]>();
  for (const n of cells) lines.set(n.id, wrap(n.label, spanW(cellD(n)) - 2 * PAD_X, cellD(n).header ? BOLD : 1));
  const needH = (n: IRNode) => lines.get(n.id)!.length * LINE_H + 2 * PAD_Y;
  const rowH = new Array<number>(rows).fill(LINE_H + 2 * PAD_Y);
  for (const n of cells) { const d = cellD(n); if (d.rowspan === 1) rowH[d.row] = Math.max(rowH[d.row], needH(n)); }
  for (const n of cells) {
    const d = cellD(n);
    if (d.rowspan === 1) continue;
    let span = 0; for (let r = d.row; r < d.row + d.rowspan; r++) span += rowH[r];
    if (needH(n) > span) rowH[d.row + d.rowspan - 1] += needH(n) - span;
  }
  const rowY: number[] = []; { let y = 0; for (let r = 0; r < rows; r++) { rowY.push(y); y += rowH[r]; } rowY.push(y); }

  const nodes = ir.nodes.map((n) => {
    const d = cellD(n);
    if (d?.role !== 'table-cell') return n;
    return {
      ...n,
      position: { x: colX[d.col], y: rowY[d.row] },
      size: { width: spanW(d), height: rowY[d.row + d.rowspan] - rowY[d.row] },
      data: { ...d, lines: lines.get(n.id), zebra: !d.header && d.rowspan === 1 && d.row % 2 === 0, last: d.row + d.rowspan === rows },
    } as IRNode;
  });
  return { nodes, edges: [], bounds: { x: 0, y: 0, width: colX[cols], height: rowY[rows] } };
}

// ── Render ──────────────────────────────────────────────────────────────

/** Colours for the active palette, mirroring the preview CSS: tints are mixes
 *  of the foreground into the background, so they follow any theme. In high
 *  contrast every rule is the full foreground and nothing is tinted. */
export function tableColors() {
  const o = getPaletteOverride();
  const bg = o?.background ?? '#ffffff';
  const fg = DS.neutral.text;
  const hc = !!o && !!o.neutralMuted && o.neutralMuted === o.neutralText;
  return {
    bg, fg, hc,
    rule: hc ? fg : blendHex(bg, fg, 0.16),
    headRule: hc ? fg : blendHex(bg, fg, 0.45),
    headBg: hc ? bg : blendHex(bg, fg, 0.06),
    zebra: hc ? bg : blendHex(bg, fg, 0.035),
  };
}

export function renderTableCell(node: IRNode, pad: number): string {
  const d = cellD(node);
  const k = tableColors();
  const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
  let el = '';
  const fill = d.header ? k.headBg : d.zebra ? k.zebra : '';
  if (fill && fill !== k.bg) el += `    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>\n`;
  // Bottom rule, drawn inside the cell so the next row's band can't cover it.
  // A spanning header cell's rule is trimmed at both ends (booktabs'
  // \cmidrule) — with no vertical rules, that gap is what shows the span.
  const trim = d.header && d.colspan > 1 ? 6 : 0;
  // High contrast has no tints to tell the rules apart, so the head and
  // bottom rules get weight instead of colour.
  const strong = d.header || d.last;
  const sw = k.hc && strong ? DS.stroke.node : DS.stroke.hairline;
  const ry = y + h - sw / 2;
  const ruleColor = strong ? k.headRule : k.rule;
  el += `    <line x1="${x + trim}" y1="${ry}" x2="${x + w - trim}" y2="${ry}" stroke="${ruleColor}" stroke-width="${sw}"/>\n`;
  // Text: top-aligned like the preview (a row-spanning cell reads from its
  // first row); a spanning header with no explicit alignment is centred.
  const align = d.align ?? (d.header && d.colspan > 1 ? 'center' : 'left');
  const [tx, anchor] = align === 'right' ? [x + w - PAD_X, 'end'] : align === 'center' ? [x + w / 2, 'middle'] : [x + PAD_X, 'start'];
  const lines = d.lines ?? [node.label];
  if (lines.some((l) => l)) {
    const base = y + PAD_Y + LINE_H / 2 + FS * 0.35;
    const tspans = lines.map((l, i) => `<tspan x="${tx}" y="${base + i * LINE_H}">${escapeXml(l)}</tspan>`).join('');
    el += `    <text text-anchor="${anchor}" fill="${k.fg}" font-size="${FS}" font-family="${DS.fontFamily}"${d.header ? ' font-weight="600"' : ''} style="font-variant-numeric:tabular-nums">${tspans}</text>\n`;
  }
  return el;
}

// ── Plugin ──────────────────────────────────────────────────────────────

export const tablePlugin: DiagramPlugin = {
  id: 'seldia.table',
  name: 'Table',
  version: '0.1.0',
  diagramType: 'table' as DiagramType,
  description: 'Tables with merged cells (rowspan `^`, colspan `<`) and an optional chart',

  transform: (ast) => transformTable(ast),

  validate(ast: DiagramAST): PluginDiagnostic[] {
    return parseTableBody(ast.raw ?? '').diagnostics.map((d) => ({ severity: d.severity, message: d.message, line: srcLine(ast, d.line) }));
  },

  renderNode(node, ctx) {
    if ((node.data as any)?.role !== 'table-cell') return undefined;
    return renderTableCell(node, ctx.pad);
  },

  getDefaultLayoutOptions: () => ({}),
};
