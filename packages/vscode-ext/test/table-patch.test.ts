// =============================================================================
// SelDiA VS Code — GFM table patching (parse / edit / serialize)
// =============================================================================
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  parseGfmTable, serializeGfm, splitRow, isDelimiterRow, applyTableOp,
  insertRow, deleteRow, insertCol, deleteCol, moveRow, moveCol, setCell, setAlign, toCsv, displayWidth,
  type GfmTable,
} from '../src/edit/table-patch.js';

const t = (src: string) => parseGfmTable(src)!;

/** What a GFM renderer actually shows: cell text per row (header first). */
function rendered(src: string): string[][] {
  const tokens = new MarkdownIt().parse(src, {});
  const rows: string[][] = [];
  let cur: string[] | null = null;
  for (const tok of tokens) {
    if (tok.type === 'tr_open') cur = [];
    else if (tok.type === 'tr_close') { rows.push(cur!); cur = null; }
    else if (tok.type === 'inline' && cur) cur.push(tok.content);
  }
  return rows;
}

describe('splitRow / isDelimiterRow', () => {
  it('splits with and without outer pipes', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitRow('a | b')).toEqual(['a', 'b']);
    expect(splitRow('|a|b')).toEqual(['a', 'b']);
  });
  it('keeps escaped pipes inside a cell (raw form)', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
  });
  it('an escaped trailing pipe is content, not an outer pipe', () => {
    expect(splitRow('| a | b \\|')).toEqual(['a', 'b \\|']);
  });
  it('recognizes delimiter rows', () => {
    expect(isDelimiterRow('|---|:-:|--:|')).toBe(true);
    expect(isDelimiterRow(':--- | ---')).toBe(true);
    expect(isDelimiterRow('| a | b |')).toBe(false);
    expect(isDelimiterRow('|   |')).toBe(false);
  });
});

describe('parseGfmTable', () => {
  it('parses header, alignment and rows', () => {
    const tb = t('| A | B | C | D |\n|---|:--|:-:|--:|\n| 1 | 2 | 3 | 4 |');
    expect(tb.header).toEqual(['A', 'B', 'C', 'D']);
    expect(tb.align).toEqual([null, 'left', 'center', 'right']);
    expect(tb.rows).toEqual([['1', '2', '3', '4']]);
  });
  it('pads short rows and drops excess cells (which GFM never renders)', () => {
    const tb = t('a|b\n-|-\n1\n1|2|3');
    expect(tb.rows).toEqual([['1', ''], ['1', '2']]);
  });
  it('unescapes \\| into the model', () => {
    expect(t('| x |\n|---|\n| `a\\|b` |').rows[0][0]).toBe('`a|b`');
  });
  it('rejects non-tables and mismatched delimiter widths', () => {
    expect(parseGfmTable('just text')).toBeUndefined();
    expect(parseGfmTable('| a | b |\n|---|')).toBeUndefined();
  });
  it('keeps the header indent', () => {
    expect(t('  | a |\n  |---|').indent).toBe('  ');
  });
});

describe('serializeGfm', () => {
  it('pads columns and encodes alignment in the delimiter row', () => {
    const out = serializeGfm(t('|Name|Qty|Note|\n|:-|-:|:-:|\n|apple|3|ok|\n|kiwi|12|fine|'));
    expect(out).toBe([
      '| Name  | Qty | Note |',
      '| :---- | --: | :--: |',
      '| apple |   3 |  ok  |',
      '| kiwi  |  12 | fine |',
    ].join('\n'));
  });
  it('re-escapes pipes, including inside inline code', () => {
    const out = serializeGfm(setCell(t('| x |\n|---|\n| y |'), 0, 0, '`a|b`'));
    expect(out).toContain('`a\\|b`');
    // markdown-it strips the table-level escape: the code span shows `a|b`.
    expect(rendered(out)[1]).toEqual(['`a|b`']);
  });
  it('accounts for wide characters', () => {
    expect(displayWidth('日本')).toBe(4);
    const out = serializeGfm(t('| a |\n|---|\n| 日本 |'));
    expect(out.split('\n')[0]).toBe('| a    |');
  });
  it('turns newlines into <br>', () => {
    expect(serializeGfm(setCell(t('|a|\n|-|\n|x|'), 0, 0, 'l1\nl2'))).toContain('l1<br>l2');
  });
});

// Messy tables as found in real READMEs: no outer pipes, ragged rows,
// uneven spacing, escaped pipes, inline code, links, emphasis, unicode.
const MESSY = [
  'Command | Description\n--- | ---\n`git status` | List all *new or modified* files\n`git diff` | Show file differences that **haven\'t been** staged',
  '|Option|Type|Default|\n|:--|:-:|--:|\n|`--fix`|`boolean`|`false`|\n|`--ext`|`string \\| string[]`|`.js`|',
  '| Emoji | Name |\n|---|---|\n| 🎉 | party |\n| 日本語 | Japanese |\n| [link](http://x.y/?a=1&b=2) | url |',
  'a|b|c\n-|-|-\n1\n1|2\n1|2|3|4',
  '   | indented | table |\n   | -------- | ----- |\n   | x | y |',
  '| trailing spaces |   \n|---|   \n| v |   ',
  '| p | q |\n|---|---|\n| C:\\dir | x |',
];

describe('round-trip of messy real-world tables', () => {
  for (const src of MESSY) {
    it(JSON.stringify(src.slice(0, 32)), () => {
      const a = t(src);
      const out = serializeGfm(a);
      const b = t(out);
      expect(b).toEqual(a);
      // Idempotent formatting.
      expect(serializeGfm(b)).toBe(out);
      // And it renders the same as the original, cell for cell (modulo the
      // padding of short rows, which renderers show as empty cells anyway).
      const before = rendered(src).map((r) => r.concat(Array(a.header.length).fill('')).slice(0, a.header.length));
      expect(rendered(out)).toEqual(before);
    });
  }
});

describe('structural edits', () => {
  const base: GfmTable = t('| A | B |\n|:-|-:|\n| 1 | 2 |\n| 3 | 4 |');

  it('insertRow / deleteRow', () => {
    expect(insertRow(base, 1).rows).toEqual([['1', '2'], ['', ''], ['3', '4']]);
    expect(insertRow(base, 99).rows.at(-1)).toEqual(['', '']);
    expect(deleteRow(base, 0).rows).toEqual([['3', '4']]);
    expect(deleteRow(base, 5)).toBe(base);
  });
  it('insertCol / deleteCol keep alignment in step', () => {
    const ins = insertCol(base, 1);
    expect(ins.header).toEqual(['A', '', 'B']);
    expect(ins.align).toEqual(['left', null, 'right']);
    expect(ins.rows[0]).toEqual(['1', '', '2']);
    const del = deleteCol(base, 0);
    expect(del.header).toEqual(['B']);
    expect(del.align).toEqual(['right']);
    expect(deleteCol(del, 0)).toBe(del); // never deletes the last column
  });
  it('moveRow / moveCol', () => {
    expect(moveRow(base, 0, 1).rows).toEqual([['3', '4'], ['1', '2']]);
    const mc = moveCol(base, 1, 0);
    expect(mc.header).toEqual(['B', 'A']);
    expect(mc.align).toEqual(['right', 'left']);
    expect(mc.rows[1]).toEqual(['4', '3']);
    expect(moveRow(base, 0, 0)).toBe(base);
  });
  it('setCell addresses the header with row -1', () => {
    expect(setCell(base, -1, 0, 'Alpha').header[0]).toBe('Alpha');
    expect(setCell(base, 1, 1, ' x ').rows[1][1]).toBe('x');
    expect(setCell(base, 0, 0, '1')).toBe(base);
  });
  it('setAlign', () => {
    expect(setAlign(base, 0, 'center').align).toEqual(['center', 'right']);
    expect(setAlign(base, 0, 'left')).toBe(base);
  });
  it('applyTableOp dispatches and never mutates its input', () => {
    const snap = JSON.stringify(base);
    applyTableOp(base, { kind: 'insertRow', index: 0 });
    applyTableOp(base, { kind: 'moveCol', from: 0, to: 1 });
    applyTableOp(base, { kind: 'setCell', row: 0, col: 0, value: 'z' });
    expect(JSON.stringify(base)).toBe(snap);
    expect(applyTableOp(base, { kind: 'deleteCol', index: 1 }).header).toEqual(['A']);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\r\n"say ""hi""","x\ny"');
  });
});
