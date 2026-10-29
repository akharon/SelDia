// =============================================================================
// SelDiA — table model: pipe-row parsing + merge resolution (pure)
// =============================================================================
// A `table` fence body is GFM-like pipe rows. Two whole-cell markers merge:
//   `^`  → this cell belongs to the cell above   (rowspan)
//   `<`  → this cell belongs to the cell to the left (colspan)
// `\^` / `\<` are the literal characters. Merges are resolved HERE, into
// anchor cells carrying rowspan/colspan — the IR, layout and renderer never
// see a marker (G1). Anything unresolvable degrades to a plain cell plus a
// diagnostic; parsing never throws (G3).
// =============================================================================

export type TableAlign = 'left' | 'center' | 'right' | null;

export interface TableCell {
  /** Grid row (0 = header row) and column of the anchor (top-left) cell. */
  row: number;
  col: number;
  text: string;
  rowspan: number;
  colspan: number;
  header: boolean;
}

export interface TableDiagnostic {
  /** 0-based line within the fence body. */
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export type TableChartKind = 'bar' | 'line' | 'pie' | 'radar' | 'scatter';
export const TABLE_CHART_KINDS: readonly TableChartKind[] = ['bar', 'line', 'pie', 'radar', 'scatter'];

/** `chart <kind> [x=<col>] [y=<col>,<col>] [only]` inside a table fence. */
export interface TableChartSpec {
  kind: TableChartKind;
  /** Label (category) column, resolved to an index. */
  x: number;
  /** Value columns, resolved to indices. */
  y: number[];
  /** Render the chart without the table. */
  only: boolean;
  /** 0-based line of the directive within the body. */
  line: number;
}

export interface TableModel {
  /** Total grid rows including the header row. */
  rows: number;
  cols: number;
  align: TableAlign[];
  /** Anchor cells only, row-major. */
  cells: TableCell[];
  /** owner[r][c] = index into `cells` of the anchor covering (r, c). */
  owner: number[][];
  /** Body line (0-based) each grid row came from. */
  rowLines: number[];
  /** The `chart …` directive line, verbatim. */
  chartDirective?: { text: string; line: number };
  /** The directive resolved against the columns (absent when there is none,
   *  or it leaves nothing to chart — a diagnostic says why). */
  chart?: TableChartSpec;
  diagnostics: TableDiagnostic[];
}

// ── Row splitting (GFM rules: `\|` is an escaped pipe) ──────────────────────

/** Split a pipe row into raw (still-escaped, trimmed) cell texts. */
export function splitPipeRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (ch === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function isDelimiterLine(line: string): boolean {
  const cells = splitPipeRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell: string): TableAlign {
  const l = cell.startsWith(':'), r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
}

/** Display text of a non-marker cell: whole-cell `\^`/`\<` become the literal
 *  marker, `\|` becomes `|`. Other backslashes are kept verbatim. */
export function unescapeTableCell(raw: string): string {
  if (raw === '\\^') return '^';
  if (raw === '\\<') return '<';
  return raw.replace(/\\\|/g, '|');
}

/** Inverse of unescapeTableCell for text written back into a table fence. */
export function escapeTableCell(text: string): string {
  const t = text.replace(/\r?\n/g, ' ').trim();
  if (t === '^') return '\\^';
  if (t === '<') return '\\<';
  return t.replace(/\|/g, '\\|');
}

// ── Numbers ──────────────────────────────────────────────────────────────

/** Parse a cell as a number, tolerating thousands separators, a currency
 *  prefix, a trailing `%` and a Unicode minus. `null` when it isn't one. */
export function parseTableNumber(text: string): number | null {
  let t = text.trim().replace(/−/g, '-').replace(/\s/g, '');
  if (!t) return null;
  t = t.replace(/^([-+]?)[$€£¥]/, '$1').replace(/%$/, '');
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// ── Parse ───────────────────────────────────────────────────────────────

interface RawRow { cells: string[]; line: number }

/** Parse + merge-resolve a table fence body. Never throws. */
export function parseTableBody(raw: string): TableModel {
  const diagnostics: TableDiagnostic[] = [];
  const lines = (raw ?? '').split(/\r?\n/);
  const rawRows: RawRow[] = [];
  let align: TableAlign[] | undefined;
  let chartLine: { text: string; line: number } | undefined;

  lines.forEach((text, i) => {
    const t = text.trim();
    if (!t || t.startsWith('//')) return;
    if (t.startsWith('|')) {
      // As in GFM, only the line right under the header sets alignment; a
      // dashes-only row anywhere else is ordinary data.
      if (rawRows.length === 1 && !align && isDelimiterLine(t)) {
        align = splitPipeRow(t).map(alignOf);
        return;
      }
      rawRows.push({ cells: splitPipeRow(t), line: i });
      return;
    }
    if (/^chart\b/i.test(t)) {
      if (chartLine) diagnostics.push({ line: i, severity: 'warning', message: 'table: only one chart directive is used — extra one ignored' });
      else chartLine = { text: t, line: i };
      return;
    }
    diagnostics.push({ line: i, severity: 'warning', message: `table: unrecognised line ignored: ${t.length > 40 ? t.slice(0, 40) + '…' : t}` });
  });

  if (rawRows.length === 0) {
    diagnostics.push({ line: 0, severity: 'warning', message: 'table: no rows — write a header row like `| A | B |`' });
    return { rows: 0, cols: 0, align: [], cells: [], owner: [], rowLines: [], diagnostics };
  }

  const cols = rawRows[0].cells.length;
  const grid: string[][] = rawRows.map((r) => {
    if (r.cells.length > cols) {
      diagnostics.push({ line: r.line, severity: 'warning', message: `table: row has ${r.cells.length} cells but the header has ${cols} — extra cells dropped` });
    }
    const row = r.cells.slice(0, cols);
    while (row.length < cols) row.push('');
    return row;
  });
  const rows = grid.length;
  const colAlign: TableAlign[] = Array.from({ length: cols }, (_, c) => align?.[c] ?? null);

  // Pass 1 — provisional ownership: each marker cell points at the owner of
  // its neighbour, so chains (`^` under `^`, `<` after `<`) collapse onto the
  // single anchor. Invalid markers become literal text.
  const ownerRC: Array<Array<[number, number]>> = grid.map((row, r) => row.map((_c, c) => [r, c] as [number, number]));
  const text: string[][] = grid.map((row) => row.map(unescapeTableCell));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid[r][c];
      if (t === '^') {
        if (r === 0) diagnostics.push({ line: rawRows[r].line, severity: 'warning', message: 'table: `^` in the header row has nothing above to merge with — shown as text' });
        else if (r === 1) diagnostics.push({ line: rawRows[r].line, severity: 'warning', message: 'table: `^` cannot merge a body cell into the header row — shown as text' });
        else { ownerRC[r][c] = ownerRC[r - 1][c]; text[r][c] = ''; }
      } else if (t === '<') {
        if (c === 0) diagnostics.push({ line: rawRows[r].line, severity: 'warning', message: 'table: `<` in the first column has nothing to its left to merge with — shown as text' });
        else { ownerRC[r][c] = ownerRC[r][c - 1]; text[r][c] = ''; }
      }
    }
  }

  // Pass 2 — every merge must be a rectangle anchored at its top-left cell.
  // Keep the largest rectangle the anchor row allows; any claimer outside it
  // falls back to an empty standalone cell.
  const same = (r: number, c: number, ar: number, ac: number) =>
    r < rows && c < cols && ownerRC[r][c][0] === ar && ownerRC[r][c][1] === ac;
  const cells: TableCell[] = [];
  const owner: number[][] = grid.map((row) => row.map(() => -1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (owner[r][c] >= 0) continue;
      const [ar, ac] = ownerRC[r][c];
      if (ar !== r || ac !== c) {
        // Claimed by an anchor whose rectangle didn't include it.
        diagnostics.push({ line: rawRows[r].line, severity: 'warning', message: `table: merge at row ${r + 1}, column ${c + 1} is not rectangular — cell left unmerged` });
        owner[r][c] = cells.length;
        cells.push({ row: r, col: c, text: '', rowspan: 1, colspan: 1, header: r === 0 });
        continue;
      }
      let w = 1;
      while (same(r, c + w, r, c) && owner[r][c + w] < 0) w++;
      let h = 1;
      const fullRow = (rr: number) => { for (let k = 0; k < w; k++) if (!same(rr, c + k, r, c) || owner[rr][c + k] >= 0) return false; return true; };
      while (r + h < rows && fullRow(r + h)) h++;
      const idx = cells.length;
      cells.push({ row: r, col: c, text: text[r][c], rowspan: h, colspan: w, header: r === 0 });
      for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) owner[rr][cc] = idx;
    }
  }

  const model: TableModel = { rows, cols, align: colAlign, cells, owner, rowLines: rawRows.map((r) => r.line), diagnostics };
  if (chartLine) {
    model.chartDirective = chartLine;
    const spec = parseChartDirective(chartLine.text, chartLine.line, model, diagnostics);
    if (spec) model.chart = spec;
  }
  return model;
}

// ── Values ──────────────────────────────────────────────────────────────

/** Header text of a column (the anchor covering header cell (0, c)). */
export function columnName(m: TableModel, c: number): string {
  const cell = m.cells[m.owner[0]?.[c] ?? -1];
  return cell ? cell.text : '';
}

/** Text at a grid position — a merged cell's value replicated into every
 *  position it covers (the right reading for a chart: a rowspan "North"
 *  labels every row it spans). */
export function valueAt(m: TableModel, r: number, c: number): string {
  const idx = m.owner[r]?.[c];
  return idx === undefined || idx < 0 ? '' : m.cells[idx].text;
}

/** A column is numeric when every non-empty body value parses as a number
 *  and at least one does. */
export function isNumericColumn(m: TableModel, c: number): boolean {
  let any = false;
  for (let r = 1; r < m.rows; r++) {
    const t = valueAt(m, r, c).trim();
    if (!t) continue;
    if (parseTableNumber(t) === null) return false;
    any = true;
  }
  return any;
}

// ── Chart directive ─────────────────────────────────────────────────────

/** Split `x="Unit price" y=Q1,"Q 2" only` into tokens, honouring quotes. */
function directiveTokens(s: string): string[] {
  const out: string[] = [];
  const re = /\s*((?:[^\s"]+|"[^"]*"?)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

function splitList(v: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of v) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

const colKey = (s: string) => s.replace(/"/g, '').trim().toLowerCase();

/** A column by header text (ignoring case and quotes), else by 1-based
 *  number as `#N` — the form for unnamed or duplicate headers. */
function resolveColumn(m: TableModel, name: string): number {
  const want = colKey(name);
  for (let c = 0; c < m.cols; c++) if (colKey(columnName(m, c)) === want) return c;
  const n = /^#(\d+)$/.exec(want);
  return n && Number(n[1]) >= 1 && Number(n[1]) <= m.cols ? Number(n[1]) - 1 : -1;
}

/** How a directive should name column `c` so it resolves back to exactly
 *  `c`: its header text when that is unique and non-empty, else `#N`. */
export function chartColumnRef(m: TableModel, c: number): string {
  const key = colKey(columnName(m, c));
  if (!key || /^#\d+$/.test(key)) return `#${c + 1}`;
  for (let o = 0; o < m.cols; o++) if (o !== c && colKey(columnName(m, o)) === key) return `#${c + 1}`;
  return columnName(m, c).replace(/"/g, '').trim();
}

/** Resolve `chart <kind> [x=<col>] [y=<col>,<col>] [only]` against the
 *  table's columns. Defaults: x = first column, y = every numeric column. */
export function parseChartDirective(text: string, line: number, m: TableModel, diags: TableDiagnostic[]): TableChartSpec | undefined {
  const toks = directiveTokens(text).slice(1);
  let kind: TableChartKind = 'bar';
  let xName: string | undefined;
  let yNames: string[] | undefined;
  let only = false;
  for (const tok of toks) {
    const kv = /^([a-z]+)=(.*)$/i.exec(tok);
    if (kv) {
      const k = kv[1].toLowerCase();
      if (k === 'x') xName = splitList(kv[2])[0];
      else if (k === 'y') yNames = splitList(kv[2]);
      else diags.push({ line, severity: 'warning', message: `table chart: unknown option \`${kv[1]}\` ignored` });
    } else if ((TABLE_CHART_KINDS as readonly string[]).includes(tok.toLowerCase())) kind = tok.toLowerCase() as TableChartKind;
    else if (tok.toLowerCase() === 'only') only = true;
    else diags.push({ line, severity: 'warning', message: `table chart: unknown word \`${tok}\` ignored (kinds: ${TABLE_CHART_KINDS.join(', ')})` });
  }
  if (m.rows < 2) {
    diags.push({ line, severity: 'warning', message: 'table chart: the table has no data rows to chart' });
    return undefined;
  }
  let x = 0;
  if (xName !== undefined) {
    x = resolveColumn(m, xName);
    if (x < 0) { diags.push({ line, severity: 'warning', message: `table chart: no column named "${xName}" — using the first column` }); x = 0; }
  }
  let y: number[] = [];
  if (yNames) {
    for (const n of yNames) {
      const c = resolveColumn(m, n);
      if (c < 0) diags.push({ line, severity: 'warning', message: `table chart: no column named "${n}" — skipped` });
      else if (!isNumericColumn(m, c)) diags.push({ line, severity: 'warning', message: `table chart: column "${n}" is not numeric — skipped` });
      else if (c !== x && !y.includes(c)) y.push(c);
    }
  } else {
    for (let c = 0; c < m.cols; c++) if (c !== x && isNumericColumn(m, c)) y.push(c);
  }
  if (kind === 'pie' && y.length > 1) {
    diags.push({ line, severity: 'info', message: 'table chart: a pie shows one value column — using the first' });
    y = y.slice(0, 1);
  }
  if (y.length === 0) {
    diags.push({ line, severity: 'warning', message: 'table chart: no numeric value columns to chart' });
    return undefined;
  }
  return { kind, x, y, only, line };
}

/** Write a directive the parser reads back to the same columns. Names are
 *  quoted when they hold spaces, commas or `=`; a `"` inside a name cannot be
 *  written and is dropped (columns are matched ignoring quotes). */
export function formatChartDirective(spec: { kind: TableChartKind; x: string; y: string[]; only?: boolean }): string {
  const q = (n: string) => { const t = n.replace(/"/g, '').trim(); return /[\s,=]/.test(t) || !t ? `"${t}"` : t; };
  return `chart ${spec.kind} x=${q(spec.x)} y=${spec.y.map(q).join(',')}${spec.only ? ' only' : ''}`;
}
