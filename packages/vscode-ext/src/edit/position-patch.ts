// =============================================================================
// SelDiA — Node Position Patch (pure, testable)
// =============================================================================
// Computes the minimal text edit that writes a node's dragged x/y back into
// its DSL declaration, so a drag in the interactive editor survives the next
// re-render instead of being silently discarded.
//
// The engine (packages/core/src/engine.ts `manualOverride`) already treats a
// node's flat `{ x, y }` style attributes (or the legacy nested
// `{ layout: { x, y } }`) as a pinned manual position — that machinery exists
// and is exercised by the "Markdown preview's drag-to-move" comment there.
// What was missing is the write side: nothing ever produced that attribute
// block in the .sld source. `applyDslPatch` in webview/provider.ts either
// nuked the whole document (the `deleteLength > 0` branch replaced the full
// range with '' then inserted at position 0) or, for the drag path
// (`deleteLength === 0`), just reassigned an in-memory string that was never
// sent to the editor at all — so a drag always looked like it worked and was
// always lost on the next render.
//
// This module finds the node's declaration line by id and merges x/y into
// its existing trailing `{ ... }` attribute block (if present) or appends a
// new one, without disturbing the node's shape, label, or any other
// attribute already there. It operates purely on strings/offsets so it can
// be unit-tested without spinning up a VS Code extension host, and so it can
// be pointed at either a whole .sld document or the substring of a fenced
// block extracted from a Markdown document.
// =============================================================================

export interface TextEdit {
  /** Offset (into the source string this was computed against) where the edit starts. */
  start: number;
  /** Offset where the edit ends (exclusive). */
  end: number;
  /** Replacement text. */
  text: string;
}

/**
 * Locate a top-level node declaration line for `nodeId` and return the text
 * edit that merges `x`/`y` into its attribute block.
 *
 * Matches the same line-scanning heuristic already used by
 * `VisualEditHandler.handleLabelEdit` / `handleNodeDelete` elsewhere in this
 * codebase: `id:` or `id ` at the start of a (trimmed) line. This is not a
 * full parse — it's deliberately as dumb as the rest of the line-based
 * patchers, so it round-trips through the same source the user is looking
 * at without requiring a printer for the full AST.
 *
 * Returns `undefined` if no declaration line for `nodeId` is found.
 */
export function computePositionEdit(
  source: string,
  nodeId: string,
  x: number,
  y: number
): TextEdit | undefined {
  return computeAttrEdit(source, nodeId, { x: Math.round(x), y: Math.round(y) });
}

/**
 * Generalized form of `computePositionEdit`: merge arbitrary attribute
 * key/values (e.g. `{ fill: '#ff8800' }` from the Edit Style menu) into the
 * node's trailing `{ ... }` block, replacing prior values for the same keys
 * and leaving everything else on the line untouched. String values are
 * emitted double-quoted; numbers bare.
 */
export function computeAttrEdit(
  source: string,
  nodeId: string,
  attrs: AttrPatch
): TextEdit | undefined {
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const leadingWs = line.length - trimmed.length;
    // Shared matcher: handles `id: …`, `id …` AND the typed form
    // (`system_Ext mainframe "…"`, `database db "…"`) that the old inline
    // prefix check missed — C4 blocks were silently unpatchable.
    const idEnd = nodeDeclIdEnd(line, nodeId);
    if (idEnd === -1) continue;
    // Skip edge lines: `customer -> banking: "…"` also starts with the id,
    // and without this guard a node's x/y landed in the EDGE's attribute
    // block (the engine accepts edge attrs, so it even compiled — just
    // silently wrong).
    if (/^\s*(<-->|<->|<--|-->|==>|\.\.>|->|---|--)/.test(line.slice(idEnd))) continue;

    const lineStartOffset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
    return patchAttrBlock(line, lineStartOffset, leadingWs, attrs);
  }

  return undefined;
}

/** Attribute values: string/number are written, an array is written as a
 *  flat `[a, b, …]` list, `null` removes the key. */
export type AttrPatch = Record<string, string | number | number[] | null>;

/** Merge `attrs` into the trailing `{ … }` block of `line` (searched from
 *  `leadingWs`), or append one. An emptied block is removed entirely — a
 *  bare `{ }` after a node would read as a diamond shape. Returns undefined
 *  when nothing would change. */
function patchAttrBlock(line: string, lineStartOffset: number, leadingWs: number, attrs: AttrPatch): TextEdit | undefined {
  {
    const setEntries = Object.entries(attrs).filter(([, v]) => v !== null);
    const freshBlock = ` { ${setEntries.map(([k, v]) => `${k}: ${fmtAttr(v!)}`).join(', ')} }`;
    if (line.indexOf('{', leadingWs) === -1 && !setEntries.length) return undefined;

    // Find a trailing `{ ... }` attribute block on this line (single-line
    // node declarations are how every existing patcher in this codebase
    // models a node, so we do the same rather than trying to span multiple
    // lines).
    const braceOpen = line.indexOf('{', leadingWs);
    if (braceOpen === -1) {
      // No attribute block yet — append one at end of line.
      const insertAt = lineStartOffset + line.length;
      return { start: insertAt, end: insertAt, text: freshBlock };
    }

    const braceClose = findMatchingBrace(line, braceOpen);
    if (braceClose === -1) {
      // Malformed/unbalanced — don't guess, append a fresh block instead.
      const insertAt = lineStartOffset + line.length;
      return { start: insertAt, end: insertAt, text: freshBlock };
    }

    const attrBody = line.slice(braceOpen + 1, braceClose);
    const merged = mergeAttrs(attrBody, attrs);
    if (!merged.trim()) {
      let ws = braceOpen;
      while (ws > 0 && (line[ws - 1] === ' ' || line[ws - 1] === '\t')) ws--;
      return { start: lineStartOffset + ws, end: lineStartOffset + braceClose + 1, text: '' };
    }
    return {
      start: lineStartOffset + braceOpen,
      end: lineStartOffset + braceClose + 1,
      text: `{${merged}}`,
    };
  }
}

/** Attribute value printer: numbers bare, strings double-quoted (trimmed,
 *  inner quotes downgraded so a value can never break out of the literal). */
function fmtAttr(v: string | number | number[]): string {
  if (Array.isArray(v)) return `[${v.map((n) => Math.round(n * 10) / 10).join(', ')}]`;
  return typeof v === 'number' ? String(v) : `"${String(v).trim().replace(/"/g, "'")}"`;
}

/** Find the index of the `}` matching the `{` at `openIdx` within `line`,
 *  accounting for nested braces (e.g. a legacy `{ layout: { x, y } }`
 *  block) and braces inside string literals. Returns -1 if unbalanced. */
function findMatchingBrace(line: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = openIdx; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === quote && line[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Merge attribute keys into an existing attribute-block body (the text
 * between `{` and `}`, exclusive), replacing prior values for the same keys
 * and leaving every other key untouched. `x`/`y` inside a legacy
 * `layout: { ... }` sub-block are rewritten in place there instead of being
 * duplicated at top level.
 */
function mergeAttrs(attrBody: string, attrs: AttrPatch): string {
  const entries = splitTopLevelEntries(attrBody);
  const kept: string[] = [];
  const seen = new Set<string>();
  let sawLayout = false;
  const hasXY = 'x' in attrs || 'y' in attrs;

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const keyMatch = /^([A-Za-z0-9_]+)\s*:/.exec(trimmed);
    const key = keyMatch?.[1];

    if (key && key in attrs) {
      seen.add(key);
      const v = attrs[key];
      if (v !== null) kept.push(` ${key}: ${fmtAttr(v)}`);
      continue;
    }
    if (key === 'layout' && hasXY) {
      // Legacy nested layout block — rewrite its x/y in place, keep any
      // other keys it might carry (e.g. locked).
      sawLayout = true;
      const braceStart = trimmed.indexOf('{');
      const braceEnd = trimmed.lastIndexOf('}');
      const inner = braceStart !== -1 && braceEnd !== -1 ? trimmed.slice(braceStart + 1, braceEnd) : '';
      const xy: AttrPatch = {};
      if ('x' in attrs) xy.x = attrs.x;
      if ('y' in attrs) xy.y = attrs.y;
      const innerMerged = mergeAttrs(inner, xy);
      if (innerMerged.trim()) kept.push(` layout: {${innerMerged}}`);
      continue;
    }
    kept.push(` ${trimmed}`);
  }

  for (const [k, v] of Object.entries(attrs)) {
    if (seen.has(k) || v === null) continue;
    if ((k === 'x' || k === 'y') && sawLayout) continue; // written inside layout
    kept.push(` ${k}: ${fmtAttr(v)}`);
  }

  return kept.length ? kept.join(',') + ' ' : '';
}

/** Split an attribute-block body into top-level comma-separated entries,
 *  respecting nested `{ }` and string literals so a legacy
 *  `layout: { x: 1, y: 2 }` sub-block isn't split apart. */
function splitTopLevelEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let inString = false;
  let quote = '';
  let current = '';

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      current += ch;
      if (ch === quote && body[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[') { depth++; current += ch; continue; }
    if (ch === '}' || ch === ']') { depth--; current += ch; continue; }
    if (ch === ',' && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) entries.push(current);
  return entries;
}

/** Apply a single `TextEdit` to `source`, returning the new string. */
export function applyTextEdit(source: string, edit: TextEdit): string {
  return source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}

/** Apply multiple non-overlapping edits (any order) in one pass. */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of sorted) out = applyTextEdit(out, e);
  return out;
}

// =============================================================================
// Node declaration matching (shared by every patcher below)
// =============================================================================

/** True if `line` is a declaration line for `nodeId` — either `id: …` / `id …`
 *  at line start, or the typed form `shape id: …` (C4 / sequence style). The
 *  boundary check stops `a` from matching `abc:`. Returns the offset of the
 *  character right after the id within the line, or -1. */
function nodeDeclIdEnd(line: string, nodeId: string): number {
  const trimmed = line.trimStart();
  const leadingWs = line.length - trimmed.length;
  const boundary = (rest: string) => rest.length === 0 || !/^[A-Za-z0-9_-]/.test(rest);

  if (trimmed.startsWith(nodeId) && boundary(trimmed.slice(nodeId.length))) {
    return leadingWs + nodeId.length;
  }
  // Typed form: `person customer: "Bank Customer"` — one keyword, then the id.
  const typed = /^([A-Za-z][A-Za-z0-9_]*)\s+/.exec(trimmed);
  if (typed) {
    const rest = trimmed.slice(typed[0].length);
    if (rest.startsWith(nodeId) && boundary(rest.slice(nodeId.length))) {
      return leadingWs + typed[0].length + nodeId.length;
    }
  }
  return -1;
}

/** Character offset of the start of line `i` in `lines`-joined source. */
function lineStart(lines: string[], i: number): number {
  return lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
}

// =============================================================================
// Label edit — node
// =============================================================================

/** Shape delimiter pairs, longest openers first (mirrors the parser's
 *  `detectShape`). `{ }` is handled separately because it collides with the
 *  attribute block. */
const SHAPE_PAIRS: [string, string][] = [
  ['[||', '||]'], ['[()', '()]'], ['[//', '//]'], ['[\\\\', '\\\\]'],
  ['[[', ']]'], ['((', '))'], ['[(', ')]'], ['[/', '/]'], ['[\\', '\\]'],
  ['[', ']'], ['(', ')'], ['<', '>'],
];

/**
 * Replace the display label on `nodeId`'s declaration line. Handles the
 * quoted form (`id "Label"`, `id: "Label"`, `shape id: "Label"`) and every
 * bracket shape form (`id: [Label]`, `(Label)`, `((Label))`, `{Diamond}` …),
 * leaving the shape delimiters and any trailing `{ ... }` attribute block
 * untouched. Returns undefined when no label region can be found.
 */
export function computeLabelEdit(source: string, nodeId: string, newLabel: string): TextEdit | undefined {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idEnd = nodeDeclIdEnd(line, nodeId);
    if (idEnd === -1) continue;
    // Skip edge lines — `a --> b` also passes the prefix check for id `a`.
    if (/^\s*(<-->|<->|<--|-->|==>|\.\.>|->|---|--)/.test(line.slice(idEnd))) continue;

    const base = lineStart(lines, i);
    const region = labelRegion(line, idEnd);
    if (!region) return undefined;
    const cleaned = sanitizeLabel(newLabel, region.kind);
    return { start: base + region.start, end: base + region.end, text: cleaned };
  }
  return undefined;
}

/** Locate the label text region (exclusive of delimiters) on a node
 *  declaration line, scanning right of the id. */
function labelRegion(line: string, from: number): { start: number; end: number; kind: 'quoted' | 'bracket' } | undefined {
  // Everything before a trailing attribute block is label territory. Find
  // the attr block: the LAST `{` whose body looks like `key: value`.
  let attrStart = line.length;
  for (let j = line.length - 1; j > from; j--) {
    if (line[j] === '{') {
      const close = findMatchingBrace(line, j);
      const body = close !== -1 ? line.slice(j + 1, close) : line.slice(j + 1);
      if (/^\s*[A-Za-z0-9_]+\s*:/.test(body)) attrStart = j;
      break;
    }
  }
  const scan = line.slice(from, attrStart);

  // Quoted label first: `id "Label"` / `id: "Label"`.
  const q = /"((?:[^"\\]|\\.)*)"/.exec(scan);
  if (q) {
    return { start: from + q.index + 1, end: from + q.index + 1 + q[1].length, kind: 'quoted' };
  }

  // Bracket shapes.
  for (let j = 0; j < scan.length; j++) {
    const ch = scan[j];
    if (ch === ' ' || ch === '\t' || ch === ':') continue;
    if (ch === '{') {
      // Diamond shape — only if the body doesn't look like attributes.
      const close = findMatchingBrace(line, from + j);
      if (close === -1) return undefined;
      const inner = line.slice(from + j + 1, close);
      if (/^\s*[A-Za-z0-9_]+\s*:/.test(inner)) return undefined;
      return { start: from + j + 1, end: close, kind: 'bracket' };
    }
    for (const [open, close] of SHAPE_PAIRS) {
      if (scan.startsWith(open, j)) {
        const closeIdx = scan.lastIndexOf(close);
        if (closeIdx <= j + open.length - 1) return undefined;
        return { start: from + j + open.length, end: from + closeIdx, kind: 'bracket' };
      }
    }
    return undefined; // hit something that isn't a label opener
  }
  return undefined;
}

/** Strip characters that would break out of the label's delimiter context. */
function sanitizeLabel(label: string, kind: 'quoted' | 'bracket'): string {
  const flat = label.replace(/\r?\n/g, ' ').trim();
  return kind === 'quoted' ? flat.replace(/"/g, "'") : flat.replace(/[[\](){}<>"|]/g, '');
}

// =============================================================================
// Edge lines — parse / label / delete
// =============================================================================

const ARROW_RE = /<-->|<->|<--|-->|==>|\.\.>|->|---|--/y;

interface ChainSeg {
  /** Arrow token text. */
  arrow: string;
  /** Offset of the arrow within the line. */
  arrowStart: number;
  /** `|"label"|` region (content offsets), if present. */
  label?: { start: number; end: number };
  /** Target node id. */
  target: string;
  /** Offset just past the target id. */
  targetEnd: number;
}

interface ChainLine {
  indent: string;
  head: string;
  headStart: number;
  segs: ChainSeg[];
  /** Offset where the suffix (`: tail` / `{ attrs }` / whitespace) begins. */
  suffixStart: number;
}

/** Parse a line as an edge (possibly chained: `a --> b --> c`). Returns
 *  undefined if the line isn't shaped like an edge declaration. */
function parseEdgeLine(line: string): ChainLine | undefined {
  const head = /^(\s*)([A-Za-z0-9_-]+)\s*/.exec(line);
  if (!head) return undefined;
  let pos = head[0].length;
  const segs: ChainSeg[] = [];

  for (;;) {
    ARROW_RE.lastIndex = pos;
    const arrow = ARROW_RE.exec(line);
    if (!arrow) break;
    let p = arrow.index + arrow[0].length;
    while (line[p] === ' ' || line[p] === '\t') p++;
    let label: ChainSeg['label'];
    if (line[p] === '|') {
      const m = /^\|\s*"((?:[^"\\]|\\.)*)"\s*\|\s*/.exec(line.slice(p));
      if (!m) return undefined;
      const q = line.indexOf('"', p);
      label = { start: q + 1, end: q + 1 + m[1].length };
      p += m[0].length;
    }
    const tgt = /^([A-Za-z0-9_-]+)/.exec(line.slice(p));
    if (!tgt) return undefined;
    segs.push({ arrow: arrow[0], arrowStart: arrow.index, label, target: tgt[1], targetEnd: p + tgt[1].length });
    pos = p + tgt[1].length;
    while (line[pos] === ' ' || line[pos] === '\t') pos++;
  }
  if (segs.length === 0) return undefined;

  // Whatever trails the last target must be a valid suffix.
  const suffix = line.slice(segs[segs.length - 1].targetEnd).trimStart();
  if (suffix && !suffix.startsWith(':') && !suffix.startsWith('{')) return undefined;
  return { indent: head[1], head: head[2], headStart: head[1].length, segs, suffixStart: segs[segs.length - 1].targetEnd };
}

/** The (source, target) pair of segment `i`, honoring arrow direction. */
function segEndpoints(chain: ChainLine, i: number): { src: string; tgt: string; reversed: boolean } {
  const prev = i === 0 ? chain.head : chain.segs[i - 1].target;
  const seg = chain.segs[i];
  if (seg.arrow === '<--') return { src: seg.target, tgt: prev, reversed: true };
  return { src: prev, tgt: seg.target, reversed: false };
}

/** Does segment `i` connect `srcId` → `tgtId`? Undirected/bidirectional
 *  arrows match either orientation. */
function segMatches(chain: ChainLine, i: number, srcId: string, tgtId: string): boolean {
  const { src, tgt } = segEndpoints(chain, i);
  const seg = chain.segs[i];
  if (src === srcId && tgt === tgtId) return true;
  const undirected = seg.arrow === '--' || seg.arrow === '---' || seg.arrow === '<->' || seg.arrow === '<-->';
  return undirected && src === tgtId && tgt === srcId;
}

/**
 * Set / replace the label of the edge `srcId → tgtId`. Replaces an existing
 * `|"label"|`, else a `: tail` label (single-edge lines), else inserts a
 * `|"label"|` after the arrow. Returns undefined if no matching edge line.
 */
export function computeEdgeLabelEdit(source: string, srcId: string, tgtId: string, newLabel: string): TextEdit | undefined {
  const lines = source.split('\n');
  const clean = newLabel.replace(/\r?\n/g, ' ').replace(/"/g, "'").trim();
  for (let i = 0; i < lines.length; i++) {
    const chain = parseEdgeLine(lines[i]);
    if (!chain) continue;
    for (let s = 0; s < chain.segs.length; s++) {
      if (!segMatches(chain, s, srcId, tgtId)) continue;
      const base = lineStart(lines, i);
      const seg = chain.segs[s];
      if (seg.label) {
        return { start: base + seg.label.start, end: base + seg.label.end, text: clean };
      }
      // Single-edge line with a `: tail` label — replace the tail.
      const suffix = lines[i].slice(chain.suffixStart);
      const colon = /^(\s*):([^{]*)/.exec(suffix);
      if (chain.segs.length === 1 && colon) {
        const tailStart = chain.suffixStart + colon[1].length + 1;
        return { start: base + tailStart, end: base + tailStart + colon[2].length, text: ` "${clean}" ` };
      }
      // Insert |"label"| between arrow and target.
      const at = seg.arrowStart + seg.arrow.length;
      return { start: base + at, end: base + at, text: ` |"${clean}"|` };
    }
  }
  return undefined;
}

/**
 * Merge attributes (e.g. `via: [x1, y1, …]`, or `via: null` to drop it) into
 * the edge `srcId → tgtId`'s trailing `{ … }` block. Only single-link lines
 * qualify: a chain's block is shared by every link, so pinning one link's
 * route there would pin them all. Returns undefined for chains / no match.
 */
export function computeEdgeAttrEdit(source: string, srcId: string, tgtId: string, attrs: AttrPatch): TextEdit | undefined {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const chain = parseEdgeLine(lines[i]);
    if (!chain || chain.segs.length !== 1 || !segMatches(chain, 0, srcId, tgtId)) continue;
    return patchAttrBlock(lines[i], lineStart(lines, i), chain.suffixStart, attrs);
  }
  return undefined;
}

/**
 * Delete the edge `srcId → tgtId`. On a single-edge line the whole line goes;
 * in a chain (`a --> b --> c`) only the matched link is removed and the
 * remaining links are re-emitted as separate lines. Returns undefined if no
 * matching edge line is found.
 */
export function computeEdgeDeleteEdit(source: string, srcId: string, tgtId: string): TextEdit | undefined {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const chain = parseEdgeLine(lines[i]);
    if (!chain) continue;
    for (let s = 0; s < chain.segs.length; s++) {
      if (!segMatches(chain, s, srcId, tgtId)) continue;
      return rebuildChainLine(lines, i, chain, (idx) => idx !== s);
    }
  }
  return undefined;
}

/**
 * Reconnect the edge `srcId → tgtId`: rewrite its `end` (`'source'` or
 * `'target'`) to `newId`, keeping the arrow, label, and any chain siblings on
 * the same line intact.
 *
 * Chain-aware like `computeEdgeDeleteEdit`, but a chain link shares its "head"
 * text with its neighbours (`a --> b --> c`: b is both seg 0's target and seg
 * 1's implicit source), so rewriting one endpoint of one link can't reuse
 * `rebuildChainLine`'s per-segment text (that would desync the shared node
 * id between adjacent links). Instead: for a match on the *first* segment,
 * rewriting its source rewrites `chain.head` (nothing else references it);
 * for a match on *any* segment, rewriting its target rewrites just that
 * segment's target text, which every later segment already reads live off
 * `chain.segs[s-1].target` via `segEndpoints` — safe to rewrite in isolation
 * since only the following segment's *logical* source changes, not its text.
 * Rewriting the source of a non-first segment, or the target of a segment
 * that has a later segment chained off it, would require renaming the shared
 * node text at two places and is refused (falls through, `undefined`) rather
 * than guessed — same "skip, don't guess" rule as the rest of this module.
 * Returns undefined if no matching edge line is found, if the rewrite would
 * require renaming a shared chain node, or if `newId` equals the other end
 * (a self-loop, silently refused).
 */
export function computeEdgeReconnectEdit(
  source: string,
  srcId: string,
  tgtId: string,
  end: 'source' | 'target',
  newId: string
): TextEdit | undefined {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const chain = parseEdgeLine(lines[i]);
    if (!chain) continue;
    for (let s = 0; s < chain.segs.length; s++) {
      if (!segMatches(chain, s, srcId, tgtId)) continue;
      const { src, tgt, reversed } = segEndpoints(chain, s);
      const otherEnd = end === 'source' ? tgt : src;
      if (newId === otherEnd) return undefined;
      // Map the logical end (source/target of the LOGICAL edge, honoring
      // `<--` reversal) onto which piece of TEXT that is: `chain.head`/prev,
      // or this segment's own `target`.
      const rewriteHeadText = end === 'source' ? !reversed : reversed;
      const base = lineStart(lines, i);
      if (rewriteHeadText) {
        if (s !== 0) return undefined; // shared with segment s-1's target — refuse
        return { start: base + chain.headStart, end: base + chain.headStart + chain.head.length, text: newId };
      }
      if (s < chain.segs.length - 1) return undefined; // shared with segment s+1's implicit source — refuse
      const seg = chain.segs[s];
      const tgtStart = seg.targetEnd - seg.target.length;
      return { start: base + tgtStart, end: base + seg.targetEnd, text: newId };
    }
  }
  return undefined;
}

/**
 * Delete node `nodeId`: its declaration line plus every edge link that
 * touches it (chain links are spliced, whole lines removed when nothing
 * remains). Returns the full set of non-overlapping edits (possibly empty).
 */
export function computeNodeDeleteEdits(source: string, nodeId: string): TextEdit[] {
  const lines = source.split('\n');
  const edits: TextEdit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const chain = parseEdgeLine(line);
    if (chain) {
      const touches = (idx: number) => {
        const { src, tgt } = segEndpoints(chain, idx);
        return src === nodeId || tgt === nodeId;
      };
      if (chain.segs.some((_, idx) => touches(idx))) {
        const e = rebuildChainLine(lines, i, chain, (idx) => !touches(idx));
        if (e) edits.push(e);
      }
      continue;
    }
    if (nodeDeclIdEnd(line, nodeId) !== -1) {
      edits.push(deleteLineEdit(lines, i));
    }
  }
  return edits;
}

/** An edit that removes line `i` including its trailing newline (or the
 *  preceding one for the last line). */
function deleteLineEdit(lines: string[], i: number): TextEdit {
  const start = lineStart(lines, i);
  if (i < lines.length - 1) return { start, end: start + lines[i].length + 1, text: '' };
  return { start: Math.max(0, start - 1), end: start + lines[i].length, text: '' };
}

/** Re-emit an edge chain line keeping only the links `keep` approves; the
 *  whole line is removed when none survive. Kept links each become their own
 *  `src arrow |"label"| tgt` line (labels preserved, suffix kept on the last). */
function rebuildChainLine(lines: string[], i: number, chain: ChainLine, keep: (idx: number) => boolean): TextEdit | undefined {
  const line = lines[i];
  const kept: string[] = [];
  for (let s = 0; s < chain.segs.length; s++) {
    if (!keep(s)) continue;
    const seg = chain.segs[s];
    const prev = s === 0 ? chain.head : chain.segs[s - 1].target;
    const label = seg.label ? ` |"${line.slice(seg.label.start, seg.label.end)}"|` : '';
    kept.push(`${chain.indent}${prev} ${seg.arrow}${label} ${seg.target}`);
  }
  if (kept.length === 0) return deleteLineEdit(lines, i);
  const suffix = line.slice(chain.suffixStart).replace(/\s+$/, '');
  if (suffix && kept.length > 0) kept[kept.length - 1] += suffix.startsWith(':') || suffix.startsWith(' ') ? suffix : ` ${suffix}`;
  const start = lineStart(lines, i);
  return { start, end: start + line.length, text: kept.join('\n') };
}

// =============================================================================
// Append statement (Add Node / Add Edge)
// =============================================================================

/**
 * Insert `stmt` (one or more lines, no trailing newline, no leading indent —
 * this function supplies the indent itself) right after the last non-blank
 * body line before the diagram body's closing brace — the last line whose
 * trimmed content is exactly `}`. Falls back to inserting immediately before
 * the closing brace for an empty body. Each line of `stmt` is indented to
 * match the body's existing indentation (taken from the line just above the
 * insertion point, or 4 spaces if the body is empty).
 * Returns undefined if no closing brace line exists.
 */
export function computeAppendStatementEdit(source: string, stmt: string): TextEdit | undefined {
  const lines = source.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '}') continue;
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    // A line ending in `{` opens a block (the diagram header, or a nested
    // block like `group "…" { }`) rather than declaring a statement in
    // *this* body, so it's not a usable indent source — treat as empty body.
    const hasBody = j >= 0 && !lines[j].trim().endsWith('{');
    const indent = hasBody ? (lines[j].match(/^[ \t]*/)?.[0] ?? '    ') : '    ';
    const text = stmt
      .split('\n')
      .map((l) => indent + l)
      .join('\n');
    if (hasBody) {
      const at = lineStart(lines, j) + lines[j].length;
      return { start: at, end: at, text: '\n' + text };
    }
    const at = lineStart(lines, i);
    return { start: at, end: at, text: text + '\n' };
  }
  return undefined;
}

// =============================================================================
// Edit vocabulary → statement text (pure, testable)
// =============================================================================
// Turns an EditVocabularyEntry template plus a fresh id/label into the exact
// DSL statement text handleNodeAdded/handleEdgeAdded append. Kept separate
// from provider.ts (which owns the vscode-facing id allocation, position
// centroid, and WorkspaceEdit dispatch) so the template substitution itself
// is unit-testable without a vscode host — see test/edit-patchers.test.ts.

export interface EditVocabEntryLike {
  template: string;
  positionable?: boolean;
}

/** Build the node declaration line (with an `{ x, y }` block appended when
 *  `entry.positionable` and a position is given) for an add-node gesture.
 *  Falls back to a plain flowchart `id: [Label]` node when `entry` is
 *  undefined (no vocabulary for this diagram type / unknown kind). */
export function buildNodeStatement(
  entry: EditVocabEntryLike | undefined,
  nodeId: string,
  label: string,
  position?: { x: number; y: number }
): string {
  let stmt = entry
    ? entry.template.replace(/\{id\}/g, nodeId).replace(/\{label\}/g, label)
    : `${nodeId}: [${label}]`;
  if (entry?.positionable && position) {
    stmt += ` { x: ${Math.round(position.x)}, y: ${Math.round(position.y)} }`;
  }
  return stmt;
}

/** Build an edge statement from a vocabulary edge template (or the generic
 *  `-->` fallback) between two existing node ids. */
export function buildEdgeStatement(
  template: string | undefined,
  sourceId: string,
  targetId: string
): string {
  const t = template ?? '{source} --> {target}';
  return t.replace('{source}', sourceId).replace('{target}', targetId);
}
