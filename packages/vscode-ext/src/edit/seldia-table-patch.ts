// =============================================================================
// SelDiA — `table` fence patching (pure, testable)
// =============================================================================
// The table editor's write-back for SelDiA `table` fences — the merge-capable
// sibling of table-patch.ts (plain GFM). The fence source is split into the
// lines before the pipe rows, the pipe rows themselves, and the lines after
// (`chart …` directive, closing `}`), so only the rows are ever regenerated.
//
// The model is the RESOLVED table: anchor cells with rowspan/colspan, parsed
// by core's parseTableBody — the same resolver the renderer uses, so the
// editor can never disagree with the preview about what is merged. Every op
// works on spans (an insert inside a merge grows it, a delete shrinks it) and
// serialization re-derives the `^`/`<` markers from the spans. Ops that a
// merge makes ambiguous (moving a row through a rowspan) are refused by
// returning the input unchanged — the same no-op contract as applyTableOp.
// =============================================================================

import { parseTableBody, escapeTableCell } from '@seldia/core';
import { displayWidth, type GfmAlign, type GfmTable, type TableOp } from './table-patch.js';

/** Anchor cell in GRID coordinates (row 0 = header row). */
export interface STCell { r: number; c: number; rs: number; cs: number; text: string }

export interface SelDiATable {
  /** Grid rows including the header row. */
  rows: number;
  cols: number;
  align: GfmAlign[];
  cells: STCell[];
}

/** A table fence's source split around its pipe rows. */
export interface SelDiATableDoc {
  table: SelDiATable;
  /** Source lines before the first pipe row (header line, comments). */
  before: string[];
  /** Source lines after the last pipe row (directives, `}`). */
  after: string[];
  indent: string;
  hadDelimiter: boolean;
}

/** Ops beyond the GFM set. Rows are BODY indices (-1 = header), as in TableOp. */
export type SelDiATableOp =
  | TableOp
  | { kind: 'merge'; r1: number; c1: number; r2: number; c2: number }
  | { kind: 'unmerge'; row: number; col: number };

const TABLE_HEAD_RE = /^\s*(?:diagram\s+)?(?:table|tbl)\b/i;

/** True when a SelDiA fence/file source is a `table` diagram. */
export function isSelDiATableSource(source: string): boolean {
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    return TABLE_HEAD_RE.test(t);
  }
  return false;
}

// ── Parse / serialize ────────────────────────────────────────────────────

export function parseSelDiATableSource(source: string): SelDiATableDoc | undefined {
  if (!isSelDiATableSource(source)) return undefined;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const isRow = (l: string) => l.trim().startsWith('|');
  const first = lines.findIndex(isRow);
  if (first < 0) {
    // A table with no rows yet: rows go right before the closing brace.
    const close = lines.map((l) => l.trim()).lastIndexOf('}');
    const at = close >= 0 ? close : lines.length;
    return { table: { rows: 0, cols: 0, align: [], cells: [] }, before: lines.slice(0, at), after: lines.slice(at), indent: '', hadDelimiter: false };
  }
  // Every pipe line is a row, as in core's parseTableBody — even past a
  // comment or the `chart` directive. Non-row lines in between (comments,
  // the directive) are kept, moved to just after the rows.
  let last = first;
  for (let i = first; i < lines.length; i++) if (isRow(lines[i])) last = i;
  const span = lines.slice(first, last + 1);
  const rowLines = span.filter(isRow);
  const between = span.filter((l) => !isRow(l) && l.trim());
  const model = parseTableBody(rowLines.join('\n'));
  return {
    table: {
      rows: model.rows, cols: model.cols, align: [...model.align],
      cells: model.cells.map((c) => ({ r: c.row, c: c.col, rs: c.rowspan, cs: c.colspan, text: c.text })),
    },
    before: lines.slice(0, first),
    after: [...between, ...lines.slice(last + 1)],
    indent: /^[ \t]*/.exec(lines[first])![0],
    hadDelimiter: rowLines.some((l, i) => i > 0 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l)),
  };
}

/** owner[r][c] = index of the anchor covering (r, c), or -1 for a hole. */
export function ownerGrid(t: SelDiATable): number[][] {
  const g = Array.from({ length: t.rows }, () => new Array<number>(t.cols).fill(-1));
  t.cells.forEach((cell, i) => {
    for (let r = cell.r; r < Math.min(t.rows, cell.r + cell.rs); r++)
      for (let c = cell.c; c < Math.min(t.cols, cell.c + cell.cs); c++) g[r][c] = i;
  });
  return g;
}

/** Raw cell strings with `^`/`<` markers re-derived from the spans. */
export function markerGrid(t: SelDiATable): string[][] {
  const own = ownerGrid(t);
  return own.map((row, r) => row.map((i, c) => {
    if (i < 0) return '';
    const a = t.cells[i];
    if (a.r === r && a.c === c) return escapeTableCell(a.text);
    return c === a.c ? '^' : '<';
  }));
}

function padTo(text: string, width: number, align: GfmAlign): string {
  const gap = width - displayWidth(text);
  if (gap <= 0) return text;
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') { const l = Math.floor(gap / 2); return ' '.repeat(l) + text + ' '.repeat(gap - l); }
  return text + ' '.repeat(gap);
}

/** Pipe rows only (no surrounding fence lines), padded like serializeGfm. */
export function serializeSelDiATableRows(t: SelDiATable, indent = '', withDelimiter = true): string[] {
  if (!t.rows || !t.cols) return [];
  const grid = markerGrid(t);
  const widths = Array.from({ length: t.cols }, (_, c) => Math.max(3, ...grid.map((row) => displayWidth(row[c]))));
  const line = (cells: string[], aligned: boolean) =>
    indent + '| ' + cells.map((v, c) => padTo(v, widths[c], aligned ? t.align[c] ?? null : null)).join(' | ') + ' |';
  const out = [line(grid[0], false)];
  // Without a delimiter, a dashes-only first body row would itself be read
  // as the delimiter — so write one whenever that could happen.
  const dashRow = grid.length > 1 && grid[1].every((v) => /^:?-+:?$/.test(v));
  if (withDelimiter || dashRow || t.align.some((a) => a)) {
    out.push(indent + '| ' + widths.map((w, c) => {
      const a = t.align[c] ?? null;
      return a === 'left' ? ':' + '-'.repeat(w - 1) : a === 'right' ? '-'.repeat(w - 1) + ':' : a === 'center' ? ':' + '-'.repeat(w - 2) + ':' : '-'.repeat(w);
    }).join(' | ') + ' |');
  }
  for (const row of grid.slice(1)) out.push(line(row, true));
  return out;
}

export function serializeSelDiATableDoc(doc: SelDiATableDoc, t: SelDiATable): string {
  return [...doc.before, ...serializeSelDiATableRows(t, doc.indent, doc.hadDelimiter), ...doc.after].join('\n');
}

// ── View model for the webview (body-row coordinates, like GfmTable) ─────

export interface SelDiATableView extends GfmTable {
  /** Spanning anchors: `row` is a BODY index (-1 = header). */
  merges: Array<{ row: number; col: number; rowspan: number; colspan: number }>;
}

export function toView(t: SelDiATable, indent = ''): SelDiATableView {
  const grid: string[][] = Array.from({ length: t.rows }, () => new Array<string>(t.cols).fill(''));
  for (const a of t.cells) if (a.r < t.rows && a.c < t.cols) grid[a.r][a.c] = a.text;
  return {
    header: grid[0] ?? [],
    rows: grid.slice(1),
    align: [...t.align],
    indent,
    merges: t.cells.filter((a) => a.rs > 1 || a.cs > 1).map((a) => ({ row: a.r - 1, col: a.c, rowspan: a.rs, colspan: a.cs })),
  };
}

// ── Ops ──────────────────────────────────────────────────────────────────

function clone(t: SelDiATable): SelDiATable {
  return { rows: t.rows, cols: t.cols, align: [...t.align], cells: t.cells.map((c) => ({ ...c })) };
}

/** Give every uncovered position its own empty cell, row-major. */
function fillHoles(t: SelDiATable): SelDiATable {
  const own = ownerGrid(t);
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) if (own[r][c] < 0) t.cells.push({ r, c, rs: 1, cs: 1, text: '' });
  t.cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return t;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function stSetCell(t: SelDiATable, row: number, col: number, value: string): SelDiATable {
  const g = row + 1;
  if (g < 0 || g >= t.rows || col < 0 || col >= t.cols) return t;
  const i = ownerGrid(t)[g][col];
  const v = value.replace(/\r?\n/g, ' ').trim();
  if (i < 0 || t.cells[i].text === v) return t;
  const next = clone(t);
  next.cells[i].text = v;
  return next;
}

/** Insert an empty body row at body index `index`. Inside a rowspan the merge
 *  grows to cover the new row. */
export function stInsertRow(t: SelDiATable, index: number): SelDiATable {
  if (!t.cols) return t;
  const g = clamp(index, 0, t.rows - 1) + 1;
  const next = clone(t);
  for (const a of next.cells) {
    if (a.r >= g) a.r++;
    else if (a.r + a.rs > g) a.rs++;
  }
  next.rows++;
  return fillHoles(next);
}

/** Delete body row `index`. A merge anchored there passes its text to the
 *  row below; one spanning across it shrinks. */
export function stDeleteRow(t: SelDiATable, index: number): SelDiATable {
  const g = index + 1;
  if (g < 1 || g >= t.rows) return t;
  const next = clone(t);
  next.cells = next.cells.filter((a) => !(a.r === g && a.rs === 1));
  for (const a of next.cells) {
    if (a.r === g) a.rs--;
    else if (a.r < g && a.r + a.rs > g) a.rs--;
    else if (a.r > g) a.r--;
  }
  next.rows--;
  return fillHoles(next);
}

export function stInsertCol(t: SelDiATable, index: number): SelDiATable {
  const at = clamp(index, 0, t.cols);
  const next = clone(t);
  for (const a of next.cells) {
    if (a.c >= at) a.c++;
    else if (a.c + a.cs > at) a.cs++;
  }
  next.cols++;
  next.align.splice(at, 0, null);
  if (!next.rows) next.rows = 1;
  return fillHoles(next);
}

export function stDeleteCol(t: SelDiATable, index: number): SelDiATable {
  if (t.cols <= 1 || index < 0 || index >= t.cols) return t;
  const next = clone(t);
  next.cells = next.cells.filter((a) => !(a.c === index && a.cs === 1));
  for (const a of next.cells) {
    if (a.c === index) a.cs--;
    else if (a.c < index && a.c + a.cs > index) a.cs--;
    else if (a.c > index) a.c--;
  }
  next.cols--;
  next.align.splice(index, 1);
  return fillHoles(next);
}

/** Move body row `from` to `to`. Refused (no-op) when a rowspan touches any
 *  row in between — there is no unambiguous meaning for moving half a merge. */
export function stMoveRow(t: SelDiATable, from: number, to: number): SelDiATable {
  const bodyRows = t.rows - 1;
  if (from < 0 || from >= bodyRows) return t;
  const dest = clamp(to, 0, bodyRows - 1);
  if (dest === from) return t;
  const lo = Math.min(from, dest) + 1, hi = Math.max(from, dest) + 1;
  if (t.cells.some((a) => a.rs > 1 && a.r <= hi && a.r + a.rs - 1 >= lo)) return t;
  const order = Array.from({ length: t.rows }, (_, i) => i);
  const [item] = order.splice(from + 1, 1);
  order.splice(dest + 1, 0, item);
  const newIndex = new Map(order.map((old, i) => [old, i]));
  const next = clone(t);
  for (const a of next.cells) a.r = newIndex.get(a.r)!;
  next.cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return next;
}

export function stMoveCol(t: SelDiATable, from: number, to: number): SelDiATable {
  if (from < 0 || from >= t.cols) return t;
  const dest = clamp(to, 0, t.cols - 1);
  if (dest === from) return t;
  const lo = Math.min(from, dest), hi = Math.max(from, dest);
  if (t.cells.some((a) => a.cs > 1 && a.c <= hi && a.c + a.cs - 1 >= lo)) return t;
  const order = Array.from({ length: t.cols }, (_, i) => i);
  const [item] = order.splice(from, 1);
  order.splice(dest, 0, item);
  const newIndex = new Map(order.map((old, i) => [old, i]));
  const next = clone(t);
  for (const a of next.cells) a.c = newIndex.get(a.c)!;
  next.align = order.map((old) => t.align[old] ?? null);
  next.cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return next;
}

export function stSetAlign(t: SelDiATable, col: number, align: GfmAlign): SelDiATable {
  if (col < 0 || col >= t.cols || (t.align[col] ?? null) === align) return t;
  const next = clone(t);
  next.align[col] = align;
  return next;
}

/** Smallest rectangle containing [r1..r2]×[c1..c2] (GRID rows) that no merge
 *  crosses — a selection that clips a merged cell grows to include all of it. */
export function closeRange(t: SelDiATable, r1: number, c1: number, r2: number, c2: number): [number, number, number, number] {
  let [a, b, c, d] = [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
  for (let changed = true; changed;) {
    changed = false;
    for (const x of t.cells) {
      const xr2 = x.r + x.rs - 1, xc2 = x.c + x.cs - 1;
      if (x.r > c || xr2 < a || x.c > d || xc2 < b) continue;
      if (x.r < a) { a = x.r; changed = true; }
      if (x.c < b) { b = x.c; changed = true; }
      if (xr2 > c) { c = xr2; changed = true; }
      if (xc2 > d) { d = xc2; changed = true; }
    }
  }
  return [a, b, c, d];
}

/** Merge a rectangle (BODY row coordinates, header = -1) into one cell. The
 *  merged text is the non-empty texts joined with a space, so nothing typed
 *  is silently lost. A range mixing header and body rows is refused. */
export function stMerge(t: SelDiATable, r1: number, c1: number, r2: number, c2: number): SelDiATable {
  if (!t.rows || !t.cols) return t;
  const [a, b, c, d] = closeRange(t, clamp(r1 + 1, 0, t.rows - 1), clamp(c1, 0, t.cols - 1), clamp(r2 + 1, 0, t.rows - 1), clamp(c2, 0, t.cols - 1));
  if (a === 0 && c > 0) return t;
  if (a === c && b === d) return t;
  const inside = (x: STCell) => x.r >= a && x.r <= c && x.c >= b && x.c <= d;
  const already = t.cells.find((x) => x.r === a && x.c === b && x.rs === c - a + 1 && x.cs === d - b + 1);
  if (already) return t;
  const text = t.cells.filter(inside).map((x) => x.text.trim()).filter(Boolean).join(' ');
  const next = clone(t);
  next.cells = next.cells.filter((x) => !inside(x));
  next.cells.push({ r: a, c: b, rs: c - a + 1, cs: d - b + 1, text });
  next.cells.sort((x, y) => x.r - y.r || x.c - y.c);
  return next;
}

/** Split the merged cell covering (row, col) back into single cells; the text
 *  stays in the top-left one. */
export function stUnmerge(t: SelDiATable, row: number, col: number): SelDiATable {
  const g = row + 1;
  if (g < 0 || g >= t.rows || col < 0 || col >= t.cols) return t;
  const i = ownerGrid(t)[g][col];
  if (i < 0 || (t.cells[i].rs === 1 && t.cells[i].cs === 1)) return t;
  const next = clone(t);
  next.cells[i].rs = 1;
  next.cells[i].cs = 1;
  return fillHoles(next);
}

export function applySelDiATableOp(t: SelDiATable, op: SelDiATableOp): SelDiATable {
  switch (op.kind) {
    case 'setCell': return stSetCell(t, op.row, op.col, op.value);
    case 'insertRow': return stInsertRow(t, op.index);
    case 'deleteRow': return stDeleteRow(t, op.index);
    case 'insertCol': return stInsertCol(t, op.index);
    case 'deleteCol': return stDeleteCol(t, op.index);
    case 'moveRow': return stMoveRow(t, op.from, op.to);
    case 'moveCol': return stMoveCol(t, op.from, op.to);
    case 'setAlign': return stSetAlign(t, op.col, op.align);
    case 'merge': return stMerge(t, op.r1, op.c1, op.r2, op.c2);
    case 'unmerge': return stUnmerge(t, op.row, op.col);
    default: return t;
  }
}

// ── GFM → SelDiA ──────────────────────────────────────────────────────────

/** A plain GFM table as a SelDiA `table` fence (with the fence lines). Cell
 *  text that happens to be exactly `^` or `<` is escaped so it stays text. */
export function gfmToSelDiATableFence(g: GfmTable, title?: string, extra: string[] = []): string {
  const t: SelDiATable = {
    rows: g.rows.length + 1, cols: g.header.length, align: [...g.align],
    cells: [g.header, ...g.rows].flatMap((row, r) => g.header.map((_, c) => ({ r, c, rs: 1, cs: 1, text: (row[c] ?? '').replace(/<br\s*\/?>/gi, ' ') }))),
  };
  const head = title ? `table ${JSON.stringify(title)} {` : 'table {';
  return [g.indent + '```seldia', g.indent + head, ...serializeSelDiATableRows(t, g.indent, true), ...extra.map((l) => g.indent + l), g.indent + '}', g.indent + '```'].join('\n');
}
