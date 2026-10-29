// =============================================================================
// SelDiA VS Code — GFM tables in the Markdown preview + host-side discovery
// =============================================================================
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { createEngine } from '@seldia/core';
import { createSelDiAMarkdownItPlugin } from '../src/markdown-preview/plugin.js';
import { findGfmTables, locateGfmTable } from '../src/edit/blocks.js';
import { readFrontMatterOverrides } from '../src/markdown-preview/frontmatter.js';

const engine = createEngine();

/** markdown-it configured like VS Code's preview: its core rule stamps
 *  data-line/code-line on every block token, which drives scroll-sync. */
function vscodeLikeMd(opts: Parameters<typeof createSelDiAMarkdownItPlugin>[1] = {}) {
  const md = new MarkdownIt();
  createSelDiAMarkdownItPlugin(engine, opts)(md as any);
  md.core.ruler.push('source_map_data_attribute', (s: any) => {
    for (const t of s.tokens) if (t.map && t.type !== 'inline') { t.attrSet('data-line', String(t.map[0])); t.attrJoin('class', 'code-line'); }
  });
  return md;
}

/** VS Code tokenizes with one env and renders with a fresh one (and caches
 *  the tokens) — reproduce that split, since state on `env` does not survive it. */
function renderLikeVsCode(md: MarkdownIt, src: string, doc = 'file:///w/doc.md'): string {
  const tokens = md.parse(src, { currentDocument: doc });
  return md.renderer.render(tokens, md.options, { currentDocument: doc });
}

const DOC = [
  '# T',
  '',
  '| Name | Qty |',
  '|:-----|----:|',
  '| a    |   1 |',
  '',
  '```md',
  '| not | a table |',
  '|-----|---------|',
  '```',
  '',
  'x | y',
  '--|--',
  '1 | 2',
  '## next',
].join('\n');

describe('findGfmTables', () => {
  it('finds top-level tables, skipping fenced code', () => {
    const tables = findGfmTables(DOC);
    expect(tables.map((t) => [t.startLine, t.endLine])).toEqual([[2, 5], [11, 14]]);
    expect(tables[0].source).toBe('| Name | Qty |\n|:-----|----:|\n| a    |   1 |');
  });
  it('skips front-matter and header/delimiter column mismatches', () => {
    const md = '---\ntitle: a | b\n---\n\na | b\n---\n';
    expect(findGfmTables(md)).toEqual([]);
  });
  it('ends a table at a block start even without a blank line', () => {
    expect(findGfmTables('a|b\n-|-\n1|2\n> quote')[0].endLine).toBe(3);
  });
  it('keeps inline-HTML rows but stops at block HTML; rejects list-like delimiters', () => {
    const src = 'a|b\n-|-\n<b>x</b> | y\n<div>\n\nc | d\n- | -\n';
    const tokens = new MarkdownIt({ html: true }).parse(src, {});
    const maps = tokens.filter((t) => t.type === 'table_open').map((t) => t.map);
    expect(findGfmTables(src).map((t) => [t.startLine, t.endLine])).toEqual(maps);
    expect(maps).toEqual([[0, 3]]);
  });
  it('agrees with markdown-it on every table span', () => {
    const tokens = new MarkdownIt().parse(DOC, {});
    const maps = tokens.filter((t) => t.type === 'table_open').map((t) => t.map);
    expect(findGfmTables(DOC).map((t) => [t.startLine, t.endLine])).toEqual(maps);
  });
  it('locates by id, then by nearest start line', () => {
    const [first] = findGfmTables(DOC);
    expect(locateGfmTable(DOC, first.tableId, -1)?.startLine).toBe(2);
    expect(locateGfmTable(DOC, 'seldia-stale', 3)?.startLine).toBe(2);
    expect(locateGfmTable(DOC, 'seldia-stale', 3, 0)).toBeUndefined();
  });
});

describe('preview table rendering', () => {
  it('wraps tables with an id the host can find, keeping data-line on <table>', () => {
    const html = renderLikeVsCode(vscodeLikeMd(), DOC);
    const ids = [...html.matchAll(/data-seldia-table="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(findGfmTables(DOC).map((t) => t.tableId));
    expect(html).toMatch(/<table data-line="2" class="code-line">/);
    expect(html).toContain('data-seldia-doc="file:///w/doc.md"');
    // Wrapper is balanced: one closing pair per table.
    expect((html.match(/<div class="seldia-table"/g) || []).length).toBe(2);
    expect(html).toMatch(/<\/table>\n?<\/div><\/div>/);
  });

  it('deep-links editTable with doc + id + line (never a command: URI)', () => {
    const html = renderLikeVsCode(vscodeLikeMd(), DOC);
    const links = [...html.matchAll(/href="(vscode:\/\/seldia\.seldia-vscode\/editTable\?[^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&')));
    expect(links).toHaveLength(2);
    expect(links[0].searchParams.get('doc')).toBe('file:///w/doc.md');
    expect(links[0].searchParams.get('line')).toBe('2');
    expect(links[0].searchParams.get('tableId')).toBe(findGfmTables(DOC)[0].tableId);
    expect(html).not.toContain('href="command:');
  });

  it('emits the icon sprite once and a Copy as CSV button per table', () => {
    const html = renderLikeVsCode(vscodeLikeMd(), DOC);
    expect((html.match(/id="seldia-icon-copy"/g) || []).length).toBe(1);
    expect((html.match(/seldia-btn-copy-csv/g) || []).length).toBe(2);
  });

  it('a table before a diagram does not steal the TOC marker', () => {
    const src = DOC + '\n\n```seldia\ndiagram flowchart "T" {\n  a: [A]\n}\n```\n';
    const html = renderLikeVsCode(vscodeLikeMd(), src);
    expect(html).toContain('id="seldia-toc-config"');
  });

  it('nested tables (in a blockquote) are styled but not editable', () => {
    const html = renderLikeVsCode(vscodeLikeMd(), '> | a |\n> |---|\n> | 1 |\n');
    expect(html).toContain('class="seldia-table"');
    expect(html).not.toContain('/editTable');
  });

  it('is off when the setting says so (read lazily) or front-matter opts out', () => {
    let enabled = false;
    const md = vscodeLikeMd({ tablesEnabled: () => enabled });
    expect(renderLikeVsCode(md, DOC)).not.toContain('seldia-table');
    enabled = true;
    expect(renderLikeVsCode(md, DOC)).toContain('seldia-table');
    const fm = '---\nseldia_tables: false\n---\n' + DOC;
    // Survives VS Code's separate parse/render envs (state rides on the tokens).
    expect(renderLikeVsCode(md, fm)).not.toContain('seldia-table');
  });

  it('front-matter caption override also survives the parse/render env split', () => {
    const src = '---\nseldia_captions: false\n---\n\n```seldia\ndiagram flowchart "T" {\n  a: [A]\n}\n```\n';
    expect(renderLikeVsCode(vscodeLikeMd({ captionsEnabled: true }), src)).not.toContain('seldia-caption');
  });
});

describe('readFrontMatterOverrides (tables)', () => {
  it('reads seldia_tables', () => {
    expect(readFrontMatterOverrides('---\nseldia_tables: false\n---\n').tables).toBe(false);
    expect(readFrontMatterOverrides('---\ntitle: x\n---\n').tables).toBeUndefined();
  });
});
