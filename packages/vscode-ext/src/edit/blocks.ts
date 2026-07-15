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

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(seldia(?:-[\w-]+)?)\s*$/;

/** Locate every ```seldia fenced block in a Markdown document. */
export function findSelDiABlocks(markdown: string): SelDiABlockLoc[] {
  const lines = markdown.split('\n');
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
