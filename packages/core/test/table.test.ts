// =============================================================================
// SelDiA — `table` diagram type: parsing, merge resolution, IR, render, export
// =============================================================================
// Merges are resolved in table/model.ts into anchor cells with rowspan/colspan
// (G1) — so most assertions are on the model/IR, not the SVG. Every malformed
// merge must degrade to a plain cell plus a diagnostic and still compile (G3).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createEngine, parseTableBody, exportTableGfm, parseTableNumber, escapeTableCell, unescapeTableCell, exportMermaid, exportPlantUml } from '../src/index.js';

const span = (raw: string) => parseTableBody(raw).cells.map((c) => `${c.row},${c.col}:${c.text}:${c.rowspan}x${c.colspan}`);

describe('parseTableBody', () => {
  it('reads header, delimiter alignment and body rows', () => {
    const m = parseTableBody('| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    expect(m.rows).toBe(2);
    expect(m.cols).toBe(3);
    expect(m.align).toEqual(['left', 'center', 'right']);
    expect(m.cells.map((c) => c.text)).toEqual(['A', 'B', 'C', '1', '2', '3']);
    expect(m.cells.slice(0, 3).every((c) => c.header)).toBe(true);
    expect(m.diagnostics).toEqual([]);
  });

  it('works without a delimiter row', () => {
    const m = parseTableBody('| A | B |\n| 1 | 2 |');
    expect(m.align).toEqual([null, null]);
    expect(m.rows).toBe(2);
  });

  it('resolves `^` into a rowspan and `<` into a colspan', () => {
    expect(span('| A | B |\n|---|---|\n| x | y |\n| ^ | z |')).toEqual(['0,0:A:1x1', '0,1:B:1x1', '1,0:x:2x1', '1,1:y:1x1', '2,1:z:1x1']);
    expect(span('| A | B | C |\n| x | < | y |')).toEqual(['0,0:A:1x1', '0,1:B:1x1', '0,2:C:1x1', '1,0:x:1x2', '1,2:y:1x1']);
  });

  it('allows colspan in the header row', () => {
    expect(span('| Region | Sales | < |\n| N | 1 | 2 |')[1]).toBe('0,1:Sales:1x2');
  });

  it('builds a 2x2 block from `<` and `^` markers', () => {
    const m = parseTableBody('| A | B | C |\n| x | < | y |\n| ^ | ^ | z |');
    const x = m.cells.find((c) => c.text === 'x')!;
    expect([x.rowspan, x.colspan]).toEqual([2, 2]);
    expect(m.owner[2][1]).toBe(m.owner[1][0]);
    expect(m.diagnostics).toEqual([]);
  });

  it('chains `^` down several rows', () => {
    const m = parseTableBody('| A |\n| x |\n| ^ |\n| ^ |');
    expect(m.cells[1]).toMatchObject({ text: 'x', rowspan: 3 });
  });

  it('treats `\\^` and `\\<` as literal text', () => {
    const m = parseTableBody('| A | B |\n| x | y |\n| \\^ | \\< |');
    expect(m.cells.slice(-2).map((c) => [c.text, c.rowspan, c.colspan])).toEqual([['^', 1, 1], ['<', 1, 1]]);
  });

  it('keeps escaped pipes inside a cell', () => {
    expect(parseTableBody('| A |\n| a \\| b |').cells[1].text).toBe('a | b');
  });

  it('degrades invalid markers to text with a diagnostic', () => {
    const header = parseTableBody('| ^ | B |\n| 1 | 2 |');
    expect(header.cells[0].text).toBe('^');
    expect(header.diagnostics).toHaveLength(1);
    const intoHeader = parseTableBody('| A |\n| ^ |');
    expect(intoHeader.cells[1].text).toBe('^');
    expect(intoHeader.diagnostics[0].message).toMatch(/header/);
    const firstCol = parseTableBody('| A | B |\n| < | 2 |');
    expect(firstCol.cells[2].text).toBe('<');
    expect(firstCol.diagnostics[0].line).toBe(1);
  });

  it('cuts a non-rectangular merge back to its largest rectangle', () => {
    // x spans down one row; the `<` beside the `^` would make an L-shape.
    const m = parseTableBody('| A | B |\n| x | y |\n| ^ | < |');
    const x = m.cells.find((c) => c.text === 'x')!;
    expect([x.rowspan, x.colspan]).toEqual([2, 1]);
    // y is not part of x's merge; (2,1) was claimed by x → left as its own empty cell.
    expect(m.owner[2][1]).not.toBe(m.owner[1][0]);
    expect(m.diagnostics.some((d) => /not rectangular/.test(d.message))).toBe(true);
  });

  it('pads short rows and drops (with a warning) extra cells', () => {
    const m = parseTableBody('| A | B |\n| 1 |\n| 1 | 2 | 3 |');
    expect(m.cells.filter((c) => c.row === 1).map((c) => c.text)).toEqual(['1', '']);
    expect(m.cells.filter((c) => c.row === 2)).toHaveLength(2);
    expect(m.diagnostics).toHaveLength(1);
  });

  it('skips comments/blank lines, warns about stray lines, reads a later dashes row as data (GFM)', () => {
    const m = parseTableBody('// note\n\n| A |\n|---|\n| 1 |\n|---|\nhello');
    expect(m.rows).toBe(3);
    expect(m.cells[2].text).toBe('---');
    expect(m.diagnostics.map((d) => d.line)).toEqual([6]);
  });

  it('never throws on garbage', () => {
    for (const raw of ['', '|', '||||', '| ^ |', '| < |', '^\n<', '| a |\n| ^ | < | ^ |\n| < | ^ |']) {
      expect(() => parseTableBody(raw)).not.toThrow();
    }
    expect(parseTableBody('').diagnostics).toHaveLength(1);
  });
});

describe('cell escaping and numbers', () => {
  it('round-trips marker literals and pipes', () => {
    for (const t of ['^', '<', 'a | b', 'plain']) expect(unescapeTableCell(escapeTableCell(t))).toBe(t);
  });
  it('parses table numbers leniently', () => {
    expect(parseTableNumber('1,234.5')).toBe(1234.5);
    expect(parseTableNumber('$12')).toBe(12);
    expect(parseTableNumber('45%')).toBe(45);
    expect(parseTableNumber('−3')).toBe(-3);
    expect(parseTableNumber('12a')).toBeNull();
    expect(parseTableNumber('')).toBeNull();
  });
});

const SRC = `table "Sales" {
| Region | Quarter | Revenue |
|:--|:-:|--:|
| North | Q1 | 1,200 |
| ^ | Q2 | 1,450 |
| South | Q1 | 980 |
| Total | < | 3,630 |
}`;

describe('table diagram through the engine', () => {
  const engine = createEngine();

  it('parses as a raw-body type and builds one IR node per anchor cell', () => {
    const ast = engine.parse(SRC);
    expect(ast.ok).toBe(true);
    if (!ast.ok) return;
    expect(ast.value.type).toBe('table');
    expect(ast.value.title).toBe('Sales');
    const ir = engine.transform(ast.value);
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    expect(ir.value.nodes).toHaveLength(15 - 2);
    const north = ir.value.nodes.find((n) => n.label === 'North')!;
    expect(north.data).toMatchObject({ role: 'table-cell', row: 1, col: 0, rowspan: 2, colspan: 1 });
    expect(ir.value.nodes.find((n) => n.label === 'Total')!.data).toMatchObject({ colspan: 2 });
    expect(ir.value.metadata.table).toMatchObject({ rows: 5, cols: 3, align: ['left', 'center', 'right'] });
  });

  it('accepts the `diagram table` long form and the `tbl` alias', () => {
    for (const head of ['diagram table "T"', 'tbl "T"']) {
      const r = engine.compileSync(`${head} {\n| A |\n| 1 |\n}`);
      expect(r.ok).toBe(true);
    }
  });

  it('parses a CRLF file with a leading comment and blank line', () => {
    const r = engine.compileSync('// c\r\n\r\ntable "T" {\r\n| A | B |\r\n| 1 | 2 |\r\n}\r\n');
    expect(r.ok).toBe(true);
  });

  it('lays out spanning cells over the full span', () => {
    const r = engine.compileSync(SRC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stats.nodeCount).toBe(13);
    const svg = r.value.svg;
    expect(svg).toContain('tabular-nums');
    expect(svg).toContain('font-weight="600"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).not.toMatch(/\^|&lt;\/?tspan/);
  });

  it('is crisp (never sketchy) and themeable', () => {
    const dark = createEngine({ config: { render: { theme: 'dark' } } } as any).compileSync(SRC);
    expect(dark.ok).toBe(true);
    if (!dark.ok) return;
    expect(dark.value.svg).toContain('#e2e8f0');
    expect(dark.value.svg).not.toContain('fill="#ffffff"');
  });

  it('reports diagnostics as warnings with source line numbers and still compiles', () => {
    const src = 'table "Bad" {\n| A | B |\n| < | 1 |\n}';
    const ast = engine.parse(src);
    if (!ast.ok) throw new Error('parse failed');
    const diags = engine.validateSemantics(ast.value);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ severity: 'warning', line: 3 });
    expect(engine.compileSync(src).ok).toBe(true);
  });

  it('exports lossy GFM, and nothing to Mermaid/PlantUML', () => {
    const ast = engine.parse(SRC);
    if (!ast.ok) throw new Error('parse failed');
    const ir = engine.transform(ast.value);
    if (!ir.ok) throw new Error('transform failed');
    expect(exportTableGfm(ir.value)).toBe([
      '| Region | Quarter | Revenue |',
      '| :--- | :---: | ---: |',
      '| North | Q1 | 1,200 |',
      '|  | Q2 | 1,450 |',
      '| South | Q1 | 980 |',
      '| Total |  | 3,630 |',
    ].join('\n') + '\n');
    expect(exportMermaid(ir.value)).toBeNull();
    expect(exportPlantUml(ir.value)).toBeNull();
  });
});
