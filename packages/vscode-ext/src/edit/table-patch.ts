// =============================================================================
// SelDiA — GFM Table Patching (pure, testable)
// =============================================================================
// The table editor's whole write-back story lives here: parse a GitHub-
// Flavoured-Markdown pipe table into a small model, apply one structural edit
// (cell text, insert/delete/move a row or column, alignment), and serialize the
// model back to padded, aligned GFM. No `vscode` API, so every edit is
// unit-testable and the provider (webview/table-provider.ts) only has to swap
// the table's line range for `serializeGfm(next)`.
//
// Cell values in the model are UNESCAPED text: `\|` in the source becomes `|`
// in the model and is re-escaped on output. GFM splits cells on every
// unescaped pipe — including pipes inside `inline code` — so the escape is
// applied uniformly, code spans included. That matches what GitHub, VS Code
// and markdown-it all render (`\|` inside a code span in a table cell displays
// as a bare `|`), and it means a cell typed as "`a|b`" in the editor survives
// the round trip instead of silently splitting into two cells.
//
// Merged cells do not exist in GFM; that is deliberately absent from the
// model (the SelDiA `table` type carries them).
// =============================================================================

export type GfmAlign = 'left' | 'center' | 'right' | null;

export interface GfmTable {
  /** Header cells (unescaped). Its length is the table's column count. */
  header: string[];
  /** One entry per column; `null` = no alignment colon in the delimiter row. */
  align: GfmAlign[];
  /** Body rows (unescaped), each normalized to `header.length` cells. */
  rows: string[][];
  /** Leading whitespace of the header line (0-3 spaces), kept on output. */
  indent: string;
}

/** A single edit the table editor can request. Row indices address BODY rows
 *  (0 = first row under the header); `row: -1` in `setCell` addresses the
 *  header. */
export type TableOp =
  | { kind: 'setCell'; row: number; col: number; value: string }
  | { kind: 'insertRow'; index: number }
  | { kind: 'deleteRow'; index: number }
  | { kind: 'insertCol'; index: number }
  | { kind: 'deleteCol'; index: number }
  | { kind: 'moveRow'; from: number; to: number }
  | { kind: 'moveCol'; from: number; to: number }
  | { kind: 'setAlign'; col: number; align: GfmAlign };

// ── Parsing ──────────────────────────────────────────────────────────────

/** Split one table line into raw (still escaped) cell strings on unescaped
 *  pipes, dropping the optional leading/trailing pipe. A pipe is escaped when
 *  the character before it is a backslash — markdown-it's rule (what VS Code's
 *  preview renders), so `\\|` counts as escaped too, unlike a strict
 *  odd-backslash-run reading. Matching the renderer is what matters: a table
 *  we parse differently from how it displays would be edited wrongly. */
export function splitRow(line: string): string[] {
  const s = line.trim();
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '|' && s[i - 1] !== '\\') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  // Optional outer pipes produce an empty first/last segment.
  if (s.startsWith('|')) cells.shift();
  if (cells.length > 0 && /(^|[^\\])\|$/.test(s) && cells[cells.length - 1] === '') cells.pop();
  return cells.map((c) => c.trim());
}

const DELIM_CELL_RE = /^:?-+:?$/;

/** True when `line` is a GFM delimiter row (`| --- | :-: |`). */
export function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!t || !/^[|:\-\s]+$/.test(t) || !t.includes('-')) return false;
  // markdown-it: a delimiter row may not open like a list item (`- | -`).
  if (t[0] === '-' && /\s/.test(t[1] ?? '')) return false;
  const cells = splitRow(t);
  return cells.length > 0 && cells.every((c) => DELIM_CELL_RE.test(c));
}

function alignOf(delim: string): GfmAlign {
  const l = delim.startsWith(':');
  const r = delim.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  if (l) return 'left';
  return null;
}

export function unescapeCell(raw: string): string {
  return raw.replace(/\\\|/g, '|');
}

export function escapeCell(value: string): string {
  // Cells are single-line in GFM: a newline typed into the editor becomes a
  // <br>, which every GFM renderer shows as a line break inside the cell.
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

/** Parse a GFM table from its source lines (header, delimiter, body…).
 *  Returns undefined when the text is not a table. Rows are normalized to the
 *  header's column count: short rows are padded with empty cells, and excess
 *  cells — which GFM renderers ignore, so they are never visible — are dropped. */
export function parseGfmTable(source: string): GfmTable | undefined {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length < 2) return undefined;
  if (!lines[0].includes('|') || !isDelimiterRow(lines[1])) return undefined;
  const header = splitRow(lines[0]).map(unescapeCell);
  const delims = splitRow(lines[1]);
  if (delims.length !== header.length) return undefined;
  const width = header.length;
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l).map(unescapeCell).slice(0, width);
    while (cells.length < width) cells.push('');
    return cells;
  });
  return {
    header,
    align: delims.map(alignOf),
    rows,
    indent: /^[ \t]*/.exec(lines[0])![0],
  };
}

// ── Serializing ──────────────────────────────────────────────────────────

/** Monospace display width: East Asian wide/fullwidth characters and most
 *  emoji occupy two columns, combining marks none. Good enough to keep pipes
 *  lined up in an editor font; exactness only affects cosmetics. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function pad(text: string, width: number, align: GfmAlign): string {
  const gap = width - displayWidth(text);
  if (gap <= 0) return text;
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

function delimFor(align: GfmAlign, width: number): string {
  switch (align) {
    case 'left': return ':' + '-'.repeat(width - 1);
    case 'right': return '-'.repeat(width - 1) + ':';
    case 'center': return ':' + '-'.repeat(width - 2) + ':';
    default: return '-'.repeat(width);
  }
}

/** Serialize to GFM with outer pipes, one space of cell padding, every column
 *  padded to its widest cell, and the delimiter row carrying the alignment
 *  colons. No trailing newline — the caller replaces the table's line range. */
export function serializeGfm(table: GfmTable): string {
  const header = table.header.map(escapeCell);
  const rows = table.rows.map((r) => table.header.map((_, c) => escapeCell(r[c] ?? '')));
  const widths = header.map((h, c) =>
    Math.max(3, displayWidth(h), ...rows.map((r) => displayWidth(r[c])))
  );
  const line = (cells: string[], aligned: boolean) =>
    table.indent + '| ' + cells.map((v, c) => pad(v, widths[c], aligned ? table.align[c] ?? null : null)).join(' | ') + ' |';
  const out = [
    line(header, false),
    table.indent + '| ' + widths.map((w, c) => delimFor(table.align[c] ?? null, w)).join(' | ') + ' |',
    ...rows.map((r) => line(r, true)),
  ];
  return out.join('\n');
}

// ── Structural edits (all pure: they return a new table) ────────────────

function clone(t: GfmTable): GfmTable {
  return { header: [...t.header], align: [...t.align], rows: t.rows.map((r) => [...r]), indent: t.indent };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function move<T>(arr: T[], from: number, to: number): void {
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

/** Insert an empty body row so it lands at `index` (0 = right under the header). */
export function insertRow(t: GfmTable, index: number, cells?: string[]): GfmTable {
  const next = clone(t);
  const row = t.header.map((_, c) => cells?.[c] ?? '');
  next.rows.splice(clamp(index, 0, t.rows.length), 0, row);
  return next;
}

export function deleteRow(t: GfmTable, index: number): GfmTable {
  if (index < 0 || index >= t.rows.length) return t;
  const next = clone(t);
  next.rows.splice(index, 1);
  return next;
}

/** Insert an empty column so it lands at `index` (0 = leftmost). */
export function insertCol(t: GfmTable, index: number, header = ''): GfmTable {
  const next = clone(t);
  const at = clamp(index, 0, t.header.length);
  next.header.splice(at, 0, header);
  next.align.splice(at, 0, null);
  for (const r of next.rows) r.splice(at, 0, '');
  return next;
}

/** Delete a column. The last remaining column is never deleted — a GFM table
 *  needs at least one, and deleting the whole table is a text-editor job. */
export function deleteCol(t: GfmTable, index: number): GfmTable {
  if (t.header.length <= 1 || index < 0 || index >= t.header.length) return t;
  const next = clone(t);
  next.header.splice(index, 1);
  next.align.splice(index, 1);
  for (const r of next.rows) r.splice(index, 1);
  return next;
}

export function moveRow(t: GfmTable, from: number, to: number): GfmTable {
  if (from < 0 || from >= t.rows.length) return t;
  const dest = clamp(to, 0, t.rows.length - 1);
  if (dest === from) return t;
  const next = clone(t);
  move(next.rows, from, dest);
  return next;
}

export function moveCol(t: GfmTable, from: number, to: number): GfmTable {
  if (from < 0 || from >= t.header.length) return t;
  const dest = clamp(to, 0, t.header.length - 1);
  if (dest === from) return t;
  const next = clone(t);
  move(next.header, from, dest);
  move(next.align, from, dest);
  for (const r of next.rows) move(r, from, dest);
  return next;
}

/** Set one cell's text. `row: -1` is the header. Newlines become `<br>` on
 *  output (GFM cells are single-line). */
export function setCell(t: GfmTable, row: number, col: number, value: string): GfmTable {
  if (col < 0 || col >= t.header.length || row < -1 || row >= t.rows.length) return t;
  const v = value.replace(/\r?\n/g, '<br>').trim();
  const cur = row === -1 ? t.header[col] : t.rows[row][col];
  if (cur === v) return t;
  const next = clone(t);
  if (row === -1) next.header[col] = v;
  else next.rows[row][col] = v;
  return next;
}

export function setAlign(t: GfmTable, col: number, align: GfmAlign): GfmTable {
  if (col < 0 || col >= t.header.length || t.align[col] === align) return t;
  const next = clone(t);
  next.align[col] = align;
  return next;
}

/** Dispatch one editor operation. Returns the input table unchanged (same
 *  reference) when the op is a no-op, so callers can skip the write-back. */
export function applyTableOp(t: GfmTable, op: TableOp): GfmTable {
  switch (op.kind) {
    case 'setCell': return setCell(t, op.row, op.col, op.value);
    case 'insertRow': return insertRow(t, op.index);
    case 'deleteRow': return deleteRow(t, op.index);
    case 'insertCol': return insertCol(t, op.index);
    case 'deleteCol': return deleteCol(t, op.index);
    case 'moveRow': return moveRow(t, op.from, op.to);
    case 'moveCol': return moveCol(t, op.from, op.to);
    case 'setAlign': return setAlign(t, op.col, op.align);
    default: return t;
  }
}

/** Render a table's cells as RFC 4180 CSV (header first). Shared shape with
 *  the preview script's client-side "Copy as CSV". */
export function toCsv(rows: string[][]): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}
