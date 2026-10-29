// =============================================================================
// SelDiA — DSL Block Discovery (pure, testable)
// =============================================================================
// Locates ```seldia fenced blocks in a Markdown document and gives each a
// stable id derived from its source, so the preview and the extension host can
// agree on which fence a rendered diagram came from.
//
// Everything here is free of the `vscode` API so it can be unit-tested and
// bundled into both the extension host and the preview build.
// =============================================================================

import { isDelimiterRow, splitRow } from './table-patch.js';

/** A ```seldia fenced block located inside a Markdown document. */
export interface SelDiABlockLoc {
  /** Stable id derived from the block source (matches the preview container). */
  blockId: string;
  /** The DSL source between the fences (no fence lines). */
  source: string;
  /** 0-based line index of the opening ``` fence. */
  fenceLine: number;
  /** 0-based line index of the first source line (fenceLine + 1). */
  sourceStartLine: number;
  /** 0-based line index of the closing ``` fence. */
  sourceEndLine: number;
  /** The language token after the fence (e.g. `seldia`, `seldia-flowchart`). */
  lang: string;
}

/** Stable id for a DSL source string. Must match `blockIdForSource` in the
 *  markdown-it plugin so the preview and host agree on block identity.
 *
 *  The two callers reach us with different trailing whitespace for the very
 *  same fence: markdown-it's `token.content` keeps the newline before the
 *  closing fence, while `findSelDiABlocks` joins the lines between the fences
 *  and has none. Both must hash identically or the host cannot find the block
 *  the preview is pointing at, so normalization lives here rather than in the
 *  callers — anything deriving an id is normalized by construction. */
export function blockIdForSource(source: string): string {
  const normalized = source.replace(/\s+$/, '');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `seldia-${Math.abs(hash).toString(36)}`;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(seldia(?:-[\w-]+)?|mermaid|plantuml|puml|uml)\s*$/;

/** Locate every ```seldia, ```mermaid, and ```plantuml fenced block in a Markdown document. */
export function findSelDiABlocks(markdown: string): SelDiABlockLoc[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: SelDiABlockLoc[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) continue;
    const fenceChars = m[2];
    const lang = m[3];
    // Find the matching closing fence (same fence character run, no lang).
    const closeRe = new RegExp('^\\s*' + fenceChars[0] + '{' + fenceChars.length + ',}\\s*$');
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (closeRe.test(lines[j])) break;
    }
    const endLine = j < lines.length ? j : lines.length; // tolerate missing close
    const source = lines.slice(i + 1, endLine).join('\n');
    blocks.push({
      blockId: blockIdForSource(source),
      source,
      fenceLine: i,
      sourceStartLine: i + 1,
      sourceEndLine: endLine,
      lang,
    });
    i = endLine; // continue scanning after the block
  }
  return blocks;
}

/** Find the block whose id matches, or undefined. */
export function findBlockById(markdown: string, blockId: string): SelDiABlockLoc | undefined {
  return findSelDiABlocks(markdown).find((b) => b.blockId === blockId);
}

// ── GFM pipe tables ───────────────────────────────────────────────────────

/** A GFM pipe table located inside a Markdown document. */
export interface GfmTableLoc {
  /** Stable id: `blockIdForSource` over the table's source lines — the same
   *  hash the markdown-it plugin stamps on the preview wrapper. */
  tableId: string;
  /** The table's source lines (header, delimiter, body), joined with '\n'. */
  source: string;
  /** 0-based line index of the header row. */
  startLine: number;
  /** 0-based line index one past the last body row (exclusive, like
   *  markdown-it's `token.map[1]`). */
  endLine: number;
}

/** Lines that end a table body even without a blank line in between — the
 *  same block starts markdown-it's table rule treats as terminators. Only
 *  html_block types 1-6 interrupt; an inline tag like `<b>x</b> | y` is a row. */
const TABLE_TERMINATOR_RE = /^ {0,3}(?:`{3,}|~{3,}|#{1,6}(?:\s|$)|>|(?:[-*_]\s*){3,}$|[-*+]\s|\d{1,9}[.)]\s|<(?:script|pre|style|textarea)(?:\s|>|$)|<!--|<\?|<![A-Za-z]|<\/?(?:address|article|aside|blockquote|details|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|section|table|tbody|td|th|thead|tr|ul)(?:\s|\/?>|$))/i;

const ANY_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Stable id for a table's source. Same hash as diagram blocks, so there is
 *  exactly one hashing implementation; tables and fences never collide in
 *  practice because their ids live in different attributes / lookups. */
export function tableIdForSource(source: string): string {
  return blockIdForSource(source);
}

/** Locate every top-level GFM pipe table in a Markdown document, skipping
 *  anything inside a fenced code block and the YAML front-matter. The column
 *  count of the header must match the delimiter row (as in markdown-it and
 *  GFM), which is what keeps a `a | b` line followed by `---` from reading as
 *  a table. Tables nested in blockquotes are not editable and not returned. */
export function findGfmTables(markdown: string): GfmTableLoc[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const tables: GfmTableLoc[] = [];
  let i = 0;
  // Front-matter: a leading `---` block.
  if (lines[0] === '---') {
    const close = lines.findIndex((l, k) => k > 0 && (l === '---' || l === '...'));
    if (close > 0) i = close + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fence = ANY_FENCE_RE.exec(line);
    if (fence) {
      const ch = fence[1][0];
      const closeRe = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + fence[1].length + ',}\\s*$');
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      i = j;
      continue;
    }
    if (i + 1 >= lines.length || !line.includes('|')) continue;
    if (/^(?: {4}|\t)/.test(line) || /^(?: {4}|\t)/.test(lines[i + 1])) continue;
    if (!isDelimiterRow(lines[i + 1])) continue;
    if (splitRow(line).length !== splitRow(lines[i + 1]).length) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim() && !/^(?: {4}|\t)/.test(lines[end]) && !TABLE_TERMINATOR_RE.test(lines[end])) {
      end++;
    }
    const source = lines.slice(i, end).join('\n');
    tables.push({ tableId: tableIdForSource(source), source, startLine: i, endLine: end });
    i = end - 1;
  }
  return tables;
}

/** Find a table by id, falling back to the table nearest `line` (within
 *  `maxDist` lines) — hand edits change the hash-derived id, the start line
 *  rarely moves far. */
export function locateGfmTable(markdown: string, tableId: string | undefined, line: number, maxDist = 50): GfmTableLoc | undefined {
  const tables = findGfmTables(markdown);
  if (tableId) {
    const byId = tables.filter((t) => t.tableId === tableId);
    if (byId.length === 1) return byId[0];
    // Duplicate identical tables: the one nearest the remembered line.
    if (byId.length > 1) return nearest(byId, line);
  }
  if (line < 0) return undefined;
  const near = nearest(tables, line);
  return near && Math.abs(near.startLine - line) <= maxDist ? near : undefined;
}

function nearest(tables: GfmTableLoc[], line: number): GfmTableLoc | undefined {
  let best: GfmTableLoc | undefined;
  let bestDist = Infinity;
  for (const t of tables) {
    const d = Math.abs(t.startLine - line);
    if (d < bestDist) { best = t; bestDist = d; }
  }
  return best;
}
