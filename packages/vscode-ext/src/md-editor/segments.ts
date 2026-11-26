// =============================================================================
// SelDiA — Markdown Visual Editor: document segmentation (pure, testable)
// =============================================================================
// The visual editor shows a Markdown file as a column of blocks: rendered
// prose (click to edit its Markdown) and rendered diagrams (click to edit the
// DSL, double-click for the interactive canvas). This module cuts the text
// into those blocks by LINE RANGE, so every edit the webview sends back is a
// plain "replace lines [start, end) whose current text is X with Y" — the .md
// stays the single source of truth and nothing is ever re-serialized.
//
// Diagram fences are located with the same scanner the preview, CodeLens and
// block-edit panel use (edit/blocks.ts), so all surfaces agree on what is a
// diagram and on its hash-derived block id.
//
// No `vscode` imports here.
// =============================================================================

import { findSelDiABlocks } from '../edit/blocks.js';

export type MdSegmentKind = 'frontmatter' | 'prose' | 'diagram';

export interface MdSegment {
  kind: MdSegmentKind;
  /** 0-based first line of the segment. */
  startLine: number;
  /** 0-based line one past the segment's last line (exclusive). */
  endLine: number;
  /** The segment's lines joined with '\n'. */
  raw: string;
  /** Diagram only: fence language (`seldia`, `seldia-flowchart`, `mermaid`, …). */
  lang?: string;
  /** Diagram only: the DSL between the fences. */
  source?: string;
  /** Diagram only: hash-derived id shared with the preview / block editor. */
  blockId?: string;
  /** Diagram only: first body line (fence line + 1). */
  bodyStart?: number;
  /** Diagram only: closing-fence line (exclusive end of the body). */
  bodyEnd?: number;
}

const ANY_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;
const INDENTED_RE = /^(?: {2,}|\t)\S/;
const LINK_DEF_RE = /^ {0,3}\[[^\]]+\]:\s*\S/;

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Cut a Markdown document into front-matter, prose and diagram segments.
 *  Blank lines between blocks belong to no segment. A prose segment is one
 *  "paragraph-level" block: it ends at a blank line unless the next block is
 *  an indented continuation or another item of the same list (loose lists
 *  stay one block so they render as one list). Non-diagram code fences are
 *  kept whole inside prose, blank lines and all. */
export function splitMarkdown(text: string): MdSegment[] {
  const lines = splitLines(text);
  const n = lines.length;
  const diagramAt = new Map(findSelDiABlocks(text).map((b) => [b.fenceLine, b]));
  const segs: MdSegment[] = [];
  const isBlank = (k: number) => k >= n || lines[k].trim() === '';
  const slice = (a: number, b: number) => lines.slice(a, b).join('\n');

  let i = 0;
  if (lines[0] === '---') {
    const close = lines.findIndex((l, k) => k > 0 && (l === '---' || l === '...'));
    if (close > 0) {
      segs.push({ kind: 'frontmatter', startLine: 0, endLine: close + 1, raw: slice(0, close + 1) });
      i = close + 1;
    }
  }

  /** Line index just past the code fence opened at `k`. */
  const skipFence = (k: number): number => {
    const m = ANY_FENCE_RE.exec(lines[k])!;
    const ch = m[1][0];
    const closeRe = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + m[1].length + ',}\\s*$');
    let j = k + 1;
    while (j < n && !closeRe.test(lines[j])) j++;
    return Math.min(j + 1, n);
  };

  while (i < n) {
    if (isBlank(i)) { i++; continue; }

    const block = diagramAt.get(i);
    if (block) {
      const end = Math.min(block.sourceEndLine + 1, n);
      segs.push({
        kind: 'diagram',
        startLine: i,
        endLine: end,
        raw: slice(i, end),
        lang: block.lang,
        source: block.source,
        blockId: block.blockId,
        bodyStart: block.sourceStartLine,
        bodyEnd: Math.min(block.sourceEndLine, n),
      });
      i = end;
      continue;
    }

    const start = i;
    const startsList = LIST_ITEM_RE.test(lines[start]);
    while (i < n) {
      if (i > start && diagramAt.has(i)) break; // a fence interrupts a paragraph
      if (ANY_FENCE_RE.test(lines[i])) { i = skipFence(i); continue; }
      if (!isBlank(i)) { i++; continue; }
      // Blank line: does the block continue after the blank run?
      let k = i;
      while (k < n && isBlank(k)) k++;
      if (k >= n || diagramAt.has(k)) break;
      const next = lines[k];
      if (INDENTED_RE.test(next) || (startsList && LIST_ITEM_RE.test(next))) { i = k; continue; }
      break;
    }
    // Trim trailing blank lines (a skipped fence can end on the doc end).
    let end = i;
    while (end > start && isBlank(end - 1)) end--;
    segs.push({ kind: 'prose', startLine: start, endLine: end, raw: slice(start, end) });
  }
  return segs;
}

/** Reference-style link definitions (`[id]: url`) anywhere in the document.
 *  Each prose block is rendered on its own, so these are appended to every
 *  block's Markdown to keep `[text][id]` links resolving. */
export function collectLinkDefinitions(text: string): string {
  const defs: string[] = [];
  let inFence: RegExp | null = null;
  for (const line of splitLines(text)) {
    if (inFence) { if (inFence.test(line)) inFence = null; continue; }
    const f = ANY_FENCE_RE.exec(line);
    if (f) { inFence = new RegExp('^ {0,3}' + (f[1][0] === '`' ? '`' : '~') + '{' + f[1].length + ',}\\s*$'); continue; }
    if (LINK_DEF_RE.test(line)) defs.push(line.trim());
  }
  return defs.join('\n');
}

/** Stable key for a segment's rendered element: kind + content hash, with an
 *  occurrence suffix so two identical paragraphs get distinct keys. The
 *  webview reuses an element whose key survived a re-render instead of
 *  rebuilding it, which keeps scroll position and diagram zoom state. */
export function segmentKeys(segs: MdSegment[]): string[] {
  const seen = new Map<string, number>();
  return segs.map((s) => {
    let h = 0;
    for (let i = 0; i < s.raw.length; i++) { h = (h << 5) - h + s.raw.charCodeAt(i); h |= 0; }
    const base = `${s.kind}-${Math.abs(h).toString(36)}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : `${base}~${k}`;
  });
}

/** Replace lines [startLine, endLine) of `text` with `replacement` (pure
 *  mirror of the host's WorkspaceEdit, used by tests and by the host to
 *  validate an edit). An empty replacement deletes the lines together with
 *  one adjacent blank separator line, so removing a block doesn't leave a
 *  growing pile of blank lines. Preserves the document's EOL. */
export function replaceLines(text: string, startLine: number, endLine: number, replacement: string | null): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitLines(text);
  if (replacement === null || replacement === '') {
    let a = startLine;
    let b = endLine;
    if (b < lines.length && lines[b].trim() === '') b++;
    else if (a > 0 && lines[a - 1].trim() === '') a--;
    lines.splice(a, b - a);
  } else {
    lines.splice(startLine, endLine - startLine, ...splitLines(replacement));
  }
  return lines.join(eol);
}

/** Insert a new block at line `atLine` (0..lineCount), separated from its
 *  neighbours by exactly one blank line on each side that needs one. Returns
 *  the new text and the 0-based line the inserted block starts at. */
export function insertBlock(text: string, atLine: number, block: string): { text: string; line: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitLines(text);
  // A trailing '' from a final newline is not a real line to insert after.
  const hasFinalNewline = lines.length > 1 && lines[lines.length - 1] === '';
  const realCount = hasFinalNewline ? lines.length - 1 : lines.length;
  const at = Math.max(0, Math.min(atLine, realCount));
  const insert = splitLines(block);
  const needBlankBefore = at > 0 && lines[at - 1].trim() !== '';
  const needBlankAfter = at < realCount && lines[at].trim() !== '';
  const chunk = [...(needBlankBefore ? [''] : []), ...insert, ...(needBlankAfter ? [''] : [])];
  if (realCount === 1 && lines[0] === '') {
    // Empty document.
    return { text: insert.join(eol) + eol, line: 0 };
  }
  lines.splice(at, 0, ...chunk);
  return { text: lines.join(eol), line: at + (needBlankBefore ? 1 : 0) };
}

/** Snippets offered by the webview's "+" insert menu. */
export const INSERT_SNIPPETS: Record<string, string> = {
  text: 'New paragraph',
  heading: '## New section',
  seldia: '```seldia\ndiagram flowchart "My Diagram" {\n    start: (Start)\n    process: [Process]\n    end: (End)\n    start --> process --> end\n}\n```',
  mermaid: '```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```',
};

export interface LineEdit {
  /** 0-based first replaced line of the OLD text. */
  startLine: number;
  /** Exclusive end line in the OLD text. */
  endLine: number;
  /** Replacement lines joined by the document EOL ('' when `lines` is empty or a single blank line). */
  text: string;
  /** The replacement lines (authoritative; `text` is `lines.join(eol)`). */
  lines: string[];
}

/** Smallest whole-line edit turning `oldText` into `newText` (common prefix and
 *  suffix lines are kept). Lines are as `splitLines` sees them, so a final
 *  newline is a trailing '' line. When the edit reaches the end of the old
 *  text it always covers at least one old line, so the host can express it as
 *  a range ending at the end of the document. */
export function minimalLineEdit(oldText: string, newText: string): LineEdit {
  const eol = oldText.includes('\r\n') ? '\r\n' : '\n';
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let p = 0;
  const maxP = Math.min(a.length, b.length);
  while (p < maxP && a[p] === b[p]) p++;
  let s = 0;
  const maxS = Math.min(a.length, b.length) - p;
  while (s < maxS && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  let start = p;
  const end = a.length - s;
  if (end === a.length && start === end && start > 0) start--;
  const lines = b.slice(start, b.length - s);
  return { startLine: start, endLine: end, text: lines.join(eol), lines };
}

/** Apply a `LineEdit` to `text` (pure mirror of the host's WorkspaceEdit). */
export function applyLineEdit(text: string, edit: LineEdit): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitLines(text);
  lines.splice(edit.startLine, edit.endLine - edit.startLine, ...edit.lines);
  return lines.join(eol);
}

const IMG_SRC_RE = /(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi;

/** Rewrite relative `<img src>` values in rendered prose HTML. `resolve`
 *  returns the replacement URL, or undefined to keep the original. Absolute
 *  URLs (any scheme), protocol-relative, `#` and `data:` sources are left alone. */
export function rewriteImageSrcs(html: string, resolve: (src: string) => string | undefined): string {
  return html.replace(IMG_SRC_RE, (m, pre: string, q: string, src: string) => {
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return m;
    const out = resolve(src);
    return out === undefined ? m : `${pre}${q}${out}${q}`;
  });
}
