import { describe, it, expect } from 'vitest';
import {
  parseSelDiATableSource, serializeSelDiATableDoc, applySelDiATableOp, isSelDiATableSource,
  markerGrid, toView, gfmToSelDiATableFence, closeRange, setChartDirective, type SelDiATable,
} from '../src/edit/seldia-table-patch.js';
import { parseGfmTable } from '../src/edit/table-patch.js';
import { parseTableBody } from '@seldia/core';

const SRC = [
  'table "Sales" {',
  '| Region | Q  | Units |',
  '|:--|:-:|--:|',
  '| North | Q1 | 10 |',
  '| ^ | Q2 | 12 |',
  '| South | Q1 | 7 |',
  '}',
].join('\n');

const doc = () => parseSelDiATableSource(SRC)!;
const roundTrip = (t: SelDiATable) => serializeSelDiATableDoc(doc(), t);
/** Re-parse what we wrote with the renderer's own resolver. */
const resolved = (src: string) => parseSelDiATableSource(src)!.table;
const shape = (t: SelDiATable) => t.cells.map((c) => `${c.r},${c.c}:${c.text}:${c.rs}x${c.cs}`);

describe('SelDiA table fence patching', () => {
  it('recognises table sources', () => {
    expect(isSelDiATableSource(SRC)).toBe(true);
    expect(isSelDiATableSource('// c\ndiagram table {\n}')).toBe(true);
    expect(isSelDiATableSource('flowchart "x" {\n}')).toBe(false);
  });

  it('parses the rows with merges and keeps the lines around them', () => {
    const d = doc();
    expect(d.before).toEqual(['table "Sales" {']);
    expect(d.after).toEqual(['}']);
    expect(d.table.cells.find((c) => c.text === 'North')).toMatchObject({ rs: 2, cs: 1 });
    expect(d.hadDelimiter).toBe(true);
  });

  it('serializes a no-op round trip to an equivalent table', () => {
    const out = roundTrip(doc().table);
    expect(out.split('\n')[0]).toBe('table "Sales" {');
    expect(out.trimEnd().endsWith('}')).toBe(true);
    expect(shape(resolved(out))).toEqual(shape(doc().table));
    expect(out).toContain('| ^      |');
  });

  it('merges a range into one cell and joins the texts', () => {
    const t = applySelDiATableOp(doc().table, { kind: 'merge', r1: 2, c1: 1, r2: 2, c2: 2 });
    const out = roundTrip(t);
    expect(out).toMatch(/Q1 7 *\| *< *\|/);
    expect(resolved(out).cells.find((c) => c.text === 'Q1 7')).toMatchObject({ rs: 1, cs: 2 });
  });

  it('builds a 2x2 merge with ^ and < markers the core resolver accepts', () => {
    const t = applySelDiATableOp(doc().table, { kind: 'merge', r1: 0, c1: 1, r2: 1, c2: 2 });
    const grid = markerGrid(t);
    expect(grid[1].slice(1)).toEqual(['Q1 10 Q2 12', '<']);
    expect(grid[2].slice(1)).toEqual(['^', '<']);
    const body = serializeSelDiATableDoc(doc(), t).split('\n').filter((l) => l.startsWith('|')).join('\n');
    expect(parseTableBody(body).diagnostics).toEqual([]);
  });

  it('expands a selection that clips a merged cell', () => {
    // Selecting only (row 1, col 0) — covered by North — plus col 1 grows to rows 0..1.
    expect(closeRange(doc().table, 2, 0, 2, 1)).toEqual([1, 0, 2, 1]);
  });

  it('refuses a merge across the header boundary', () => {
    const t = doc().table;
    expect(applySelDiATableOp(t, { kind: 'merge', r1: -1, c1: 0, r2: 0, c2: 0 })).toBe(t);
  });

  it('allows a header-only colspan', () => {
    const t = applySelDiATableOp(doc().table, { kind: 'merge', r1: -1, c1: 1, r2: -1, c2: 2 });
    expect(markerGrid(t)[0].slice(1)).toEqual(['Q Units', '<']);
  });

  it('unmerges back to single cells, text in the top-left', () => {
    const t = applySelDiATableOp(doc().table, { kind: 'unmerge', row: 1, col: 0 });
    expect(markerGrid(t).map((r) => r[0])).toEqual(['Region', 'North', '', 'South']);
  });

  it('grows a merge when a row is inserted inside it, shrinks it on delete', () => {
    const grown = applySelDiATableOp(doc().table, { kind: 'insertRow', index: 1 });
    expect(grown.cells.find((c) => c.text === 'North')).toMatchObject({ rs: 3 });
    expect(grown.rows).toBe(5);
    const shrunk = applySelDiATableOp(doc().table, { kind: 'deleteRow', index: 1 });
    expect(shrunk.cells.find((c) => c.text === 'North')).toMatchObject({ rs: 1 });
    // Deleting the anchor row hands the text to the row below.
    const moved = applySelDiATableOp(doc().table, { kind: 'deleteRow', index: 0 });
    expect(moved.cells.find((c) => c.text === 'North')).toMatchObject({ r: 1, rs: 1 });
    expect(markerGrid(moved)[1]).toEqual(['North', 'Q2', '12']);
  });

  it('keeps colspans consistent across column insert/delete', () => {
    const merged = applySelDiATableOp(doc().table, { kind: 'merge', r1: 2, c1: 0, r2: 2, c2: 1 });
    const ins = applySelDiATableOp(merged, { kind: 'insertCol', index: 1 });
    expect(ins.cells.find((c) => c.r === 3 && c.c === 0)).toMatchObject({ cs: 3 });
    expect(ins.align).toEqual(['left', null, 'center', 'right']);
    const del = applySelDiATableOp(merged, { kind: 'deleteCol', index: 0 });
    expect(del.cells.find((c) => c.r === 3 && c.c === 0)).toMatchObject({ cs: 1, text: 'South Q1' });
  });

  it('refuses to move a row through a rowspan, but moves free rows', () => {
    const t = doc().table;
    expect(applySelDiATableOp(t, { kind: 'moveRow', from: 2, to: 1 })).toBe(t);
    const unmerged = applySelDiATableOp(t, { kind: 'unmerge', row: 0, col: 0 });
    const moved = applySelDiATableOp(unmerged, { kind: 'moveRow', from: 2, to: 0 });
    expect(markerGrid(moved).map((r) => r[0])).toEqual(['Region', 'South', 'North', '']);
  });

  it('moves columns with their alignment', () => {
    const t = applySelDiATableOp(doc().table, { kind: 'moveCol', from: 2, to: 1 });
    expect(t.align).toEqual(['left', 'right', 'center']);
    expect(markerGrid(t)[0]).toEqual(['Region', 'Units', 'Q']);
  });

  it('escapes literal marker text typed into a cell', () => {
    const t = applySelDiATableOp(doc().table, { kind: 'setCell', row: 2, col: 1, value: '^' });
    const out = roundTrip(t);
    expect(out).toContain('\\^');
    expect(resolved(out).cells.find((c) => c.r === 3 && c.c === 1)?.text).toBe('^');
  });

  it('exposes merges in the view in body-row coordinates', () => {
    expect(toView(doc().table).merges).toEqual([{ row: 0, col: 0, rowspan: 2, colspan: 1 }]);
  });

  it('edits rows past a comment or chart line without losing either', () => {
    const src = 'table {\n| A | B |\n| x | y |\n// note\nchart bar\n| p | q |\n}';
    const d = parseSelDiATableSource(src)!;
    expect(d.table.rows).toBe(3);
    const out = serializeSelDiATableDoc(d, applySelDiATableOp(d.table, { kind: 'insertRow', index: 2 }));
    expect(out).toContain('// note');
    expect(out).toContain('chart bar');
    expect(resolved(out).rows).toBe(4);
  });

  it('keeps a dashes-only body row as data', () => {
    const d = parseSelDiATableSource('table {\n| A |\n| x |\n}')!;
    const out = serializeSelDiATableDoc(d, applySelDiATableOp(d.table, { kind: 'setCell', row: 0, col: 0, value: '---' }));
    expect(resolved(out).rows).toBe(2);
  });

  it('converts a GFM table into a SelDiA table fence', () => {
    const g = parseGfmTable('| A | B |\n|---|--:|\n| ^ | 1 |')!;
    const fence = gfmToSelDiATableFence(g, 'T');
    const lines = fence.split('\n');
    expect(lines[0]).toBe('```seldia');
    expect(lines[1]).toBe('table "T" {');
    expect(lines.at(-1)).toBe('```');
    const src = lines.slice(1, -1).join('\n');
    const t = resolved(src);
    expect(t.cells.find((c) => c.r === 1 && c.c === 0)?.text).toBe('^');
    expect(t.align).toEqual([null, 'right']);
  });

  it('adds, replaces and removes the chart directive without touching rows', () => {
    const added = setChartDirective(SRC, 'chart bar x=Region y=Units')!;
    expect(added.split('\n').slice(-2)).toEqual(['chart bar x=Region y=Units', '}']);
    expect(parseTableBody(added.split('\n').slice(1, -1).join('\n')).chart).toMatchObject({ kind: 'bar', x: 0, y: [2] });
    const src2 = 'table {\n  | A | 2024 |\n  chart line\n  | x | 1 |\n}';
    const replaced = setChartDirective(src2, 'chart pie only')!;
    expect(replaced).toBe('table {\n  | A | 2024 |\n  chart pie only\n  | x | 1 |\n}');
    expect(setChartDirective(replaced, null)).toBe('table {\n  | A | 2024 |\n  | x | 1 |\n}');
    expect(setChartDirective('flowchart {\n}', 'chart bar')).toBeUndefined();
  });

  it('replaces a directive whatever its case, as core reads it', () => {
    const src = 'table {\n| A | n |\n| x | 1 |\nChart line\n}';
    expect(setChartDirective(src, 'chart pie')).toBe('table {\n| A | n |\n| x | 1 |\nchart pie\n}');
    expect(setChartDirective(src, null)).toBe('table {\n| A | n |\n| x | 1 |\n}');
  });
});
