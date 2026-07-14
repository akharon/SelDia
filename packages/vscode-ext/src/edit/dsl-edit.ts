// =============================================================================
// SelDiA — DSL Block Editing (pure, testable)
// =============================================================================
// Pure functions used by the Markdown preview "Edit" mode to translate visual
// gestures (drag a node, rename a node, change an attribute) into minimal,
// deterministic edits of the underlying SelDiA DSL text.
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
 *  markdown-it plugin so the preview and host agree on block identity. */
export function blockIdForSource(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
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

// -----------------------------------------------------------------------------
// Node declaration line manipulation
// -----------------------------------------------------------------------------

interface ParsedNodeLine {
  indent: string;
  id: string;
  /** Text from after the id's `:` up to (not including) any style block. */
  head: string;
  /** Existing flat style block text without braces, or null if none. */
  styleInner: string | null;
  /** Trailing text after the style block (rare — usually empty). */
  tail: string;
}

const SHAPE_DELIMS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };

/** Consume a shape/label token starting at `s[from]`, returning the index just
 *  past it. Handles bracketed shapes (with nesting) and quoted strings. */
function consumeShape(s: string, from: number): number {
  let i = from;
  while (i < s.length && /\s/.test(s[i])) i++;
  const ch = s[i];
  if (ch === '"') {
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') i++;
      i++;
    }
    return i + 1;
  }
  const close = SHAPE_DELIMS[ch];
  if (close) {
    let depth = 0;
    for (; i < s.length; i++) {
      if (s[i] === ch) depth++;
      else if (s[i] === close) {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return s.length;
  }
  // Bare identifier / keyword label — up to a `{` or end.
  while (i < s.length && s[i] !== '{') i++;
  return i;
}

/** Parse a single node declaration line for id `nodeId`. Returns null if the
 *  line is not that node's declaration. */
function parseNodeLine(line: string, nodeId: string): ParsedNodeLine | null {
  const indentM = /^(\s*)/.exec(line);
  const indent = indentM ? indentM[1] : '';
  const rest = line.slice(indent.length);
  // Match `id :` allowing an optional type keyword prefix (e.g. `system id:`).
  const idEsc = escapeRegex(nodeId);
  const m = new RegExp('^(?:[A-Za-z_][\\w-]*\\s+)?' + idEsc + '\\s*:').exec(rest);
  if (!m) return null;
  const afterColon = indent.length + m[0].length;
  const shapeEnd = consumeShape(line, afterColon);
  const head = line.slice(afterColon, shapeEnd);
  let remainder = line.slice(shapeEnd);
  // Optional trailing flat style block.
  const sm = /^(\s*)\{([^{}]*)\}(.*)$/.exec(remainder);
  if (sm) {
    return { indent, id: nodeId, head: head + sm[1], styleInner: sm[2], tail: sm[3] };
  }
  return { indent, id: nodeId, head, styleInner: null, tail: remainder };
}

/** Parse a flat `key: value` attribute list into ordered entries. */
function parseFlatAttrs(inner: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  // Split on commas that are not inside quotes.
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (const ch of inner) {
    if (ch === '"') depth ^= 1;
    if (ch === ',' && !depth) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const ci = p.indexOf(':');
    if (ci === -1) {
      const k = p.trim();
      if (k) entries.push([k, 'true']);
    } else {
      entries.push([p.slice(0, ci).trim(), p.slice(ci + 1).trim()]);
    }
  }
  return entries;
}

function serializeFlatAttrs(entries: Array<[string, string]>): string {
  return `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
}

/** Set (or add) attributes on a node's declaration line within `source`.
 *  `updates` maps attribute name → serialized DSL value (e.g. `"120"`,
 *  `'"#ff0000"'`). Returns the new source; unchanged if the node is not found. */
export function setNodeAttributes(
  source: string,
  nodeId: string,
  updates: Record<string, string>
): string {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseNodeLine(lines[i], nodeId);
    if (!parsed) continue;
    const entries = parsed.styleInner !== null ? parseFlatAttrs(parsed.styleInner) : [];
    for (const [k, v] of Object.entries(updates)) {
      const idx = entries.findIndex((e) => e[0] === k);
      if (idx >= 0) entries[idx][1] = v;
      else entries.push([k, v]);
    }
    const headTrimmed = parsed.head.replace(/\s+$/, '');
    lines[i] = `${parsed.indent}${nodeId}: ${headTrimmed.replace(/^\s+/, '')} ${serializeFlatAttrs(entries)}${parsed.tail.replace(/\s+$/, '')}`;
    return lines.join('\n');
  }
  return source;
}

/** Move a node by writing flat `x`/`y` attributes into its style block. */
export function setNodePosition(source: string, nodeId: string, x: number, y: number): string {
  return setNodeAttributes(source, nodeId, { x: String(Math.round(x)), y: String(Math.round(y)) });
}

/** Rename a node's label (the text inside its shape brackets). Falls back to
 *  a quoted-string label when the shape carries no brackets. */
export function setNodeLabel(source: string, nodeId: string, label: string): string {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseNodeLine(lines[i], nodeId);
    if (!parsed) continue;
    const token = parsed.head.trim();
    const openRun = /^[([{<]+/.exec(token)?.[0];
    const closeRun = /[)\]}>]+$/.exec(token)?.[0];
    let newHead: string;
    if (openRun && closeRun) {
      // Bracketed shape — preserve multi-char delimiters like `[/ /]`, `(( ))`.
      newHead = `${openRun}${label}${closeRun}`;
    } else {
      // Bare or quoted label — emit a quoted string.
      newHead = `"${label.replace(/"/g, '\\"')}"`;
    }
    const style = parsed.styleInner !== null ? ` ${serializeFlatAttrs(parseFlatAttrs(parsed.styleInner))}` : '';
    lines[i] = `${parsed.indent}${nodeId}: ${newHead}${style}${parsed.tail.replace(/\s+$/, '')}`;
    return lines.join('\n');
  }
  return source;
}

/** Match any node declaration line and extract its flat style block, if any.
 *  Used for whole-document scans (auto-layout state, clearing overrides) —
 *  unlike `parseNodeLine`, this doesn't require knowing the node id upfront. */
const NODE_LINE_RE = /^(\s*)(?:[A-Za-z_][\w-]*\s+)?([A-Za-z_][\w-]*)\s*:/;

function parseAnyNodeLine(line: string): ParsedNodeLine | null {
  const m = NODE_LINE_RE.exec(line);
  if (!m) return null;
  return parseNodeLine(line, m[2]);
}

/** True if any node in the document carries a manual `x`/`y` position
 *  override — the diagram-wide signal that auto-layout is currently
 *  disabled (see CoreEngine.layout's isManuallyLaidOut). */
export function hasManualPositions(source: string): boolean {
  for (const line of source.split('\n')) {
    const parsed = parseAnyNodeLine(line);
    if (!parsed || parsed.styleInner === null) continue;
    const entries = parseFlatAttrs(parsed.styleInner);
    if (entries.some(([k]) => k === 'x') && entries.some(([k]) => k === 'y')) return true;
  }
  return false;
}

/** Strip `x`/`y` position overrides from every node in the document, so the
 *  next render re-runs the automatic layout engine. Other style attributes
 *  (fill, stroke, ...) are preserved; a style block left empty is removed
 *  entirely. This is the "Auto Layout" button's transform. */
export function clearAllPositions(source: string): string {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseAnyNodeLine(lines[i]);
    if (!parsed || parsed.styleInner === null) continue;
    const entries = parseFlatAttrs(parsed.styleInner).filter(([k]) => k !== 'x' && k !== 'y');
    const headTrimmed = parsed.head.replace(/\s+$/, '').replace(/^\s+/, '');
    const style = entries.length > 0 ? ` ${serializeFlatAttrs(entries)}` : '';
    lines[i] = `${parsed.indent}${parsed.id}: ${headTrimmed}${style}${parsed.tail.replace(/\s+$/, '')}`;
  }
  return lines.join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}
