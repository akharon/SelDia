// =============================================================================
// SelDiA MCP — minimal .sld writeback
// =============================================================================
// Scope, deliberately: this mutates a single node's label and/or flat style
// attributes (e.g. `fill`, `stroke`, `textColor`) in place, on whatever line
// that node's declaration already occupies. It does NOT attempt to
// round-trip a full IR back into DSL syntax, and it does NOT touch nested
// attribute values (e.g. `layout: { x: 1, y: 2 }`) — the parser's own
// attribute-block tokenizer has a known bug with nested objects
// (docs/next_steps.md), and reproducing write support for a syntax the
// reader can't reliably parse back would just create silently-corrupting
// round trips. Scope is intentionally: flat `key: value` pairs only.
//
// Strategy: regex-based line editing rather than re-serializing the whole
// AST. A node declaration always starts with `<id>` at the front of a
// statement (optionally preceded by whitespace/a shape keyword) and is
// followed by an optional bracketed/keyword shape + label, then an optional
// `{ ... }` attribute block. We find that line, patch the label term in
// place, and patch/insert simple `key: value` entries inside the trailing
// `{ }` block (inserting the block if it doesn't exist yet).
//
// This is intentionally conservative: if a node's declaration can't be
// found with high confidence (unique `^\s*<id>\b` match), the mutation is
// rejected rather than guessed at.

export interface NodePatch {
  label?: string;
  /** Flat style/data attributes to set inside the node's `{ ... }` block,
   *  e.g. { fill: "#fff", stroke: "#000" }. Values are re-quoted as SelDiA
   *  DSL literals (strings quoted, numbers/booleans bare). Nested objects
   *  are rejected — see module doc. */
  style?: Record<string, string | number | boolean>;
}

export class SldWriteError extends Error {}

const BRACKET_SHAPES: Array<[RegExp, string, string]> = [
  [/\(([^()]*)\)/, '(', ')'],   // rounded / start-end
  [/\[\/([^/[\]]*)\/\]/, '[/', '/]'], // parallelogram
  [/\[([^[\]]*)\]/, '[', ']'],  // rectangle
  [/\{([^{}]*)\}/, '{', '}'],   // diamond — must not be confused with attr block
];

/** Find the line (1-based) declaring `nodeId` and return it plus its index.
 *  Requires the id to appear at the start of a statement, i.e. at the
 *  start of the (trimmed) line — this is how every node decl in the parser
 *  begins (`parseNodeDecl` consumes the id token first). Rejects ambiguous
 *  matches (id appears as a start-of-line token on more than one line). */
function findNodeLine(lines: string[], nodeId: string): number {
  const idPattern = new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*[:(\\[{"]`);
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (idPattern.test(lines[i])) matches.push(i);
  }
  if (matches.length === 0) {
    throw new SldWriteError(`Could not find a unique declaration line for node "${nodeId}" (found 0 candidates). This writer only supports flat, single-line node declarations.`);
  }
  if (matches.length > 1) {
    throw new SldWriteError(`Ambiguous declaration for node "${nodeId}": found on lines ${matches.map((m) => m + 1).join(', ')}. Refusing to guess.`);
  }
  return matches[0];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace the label term (the content of the first bracket pair, or a bare
 *  quoted string) on a node declaration line. Leaves shape delimiters
 *  ([], (), {}, [//]) intact — only the text inside changes. */
function patchLabel(line: string, newLabel: string): string {
  // Bracketed shape: id (Label) / id [Label] / id {Label} / id [/Label/]
  for (const [re, open, close] of BRACKET_SHAPES) {
    const m = line.match(re);
    if (m) {
      const idx = m.index!;
      return line.slice(0, idx) + open + newLabel + close + line.slice(idx + m[0].length);
    }
  }
  // Plain quoted label: id "Label"
  const strMatch = line.match(/"((?:[^"\\]|\\.)*)"/);
  if (strMatch) {
    const idx = strMatch.index!;
    return line.slice(0, idx) + `"${newLabel.replace(/"/g, '\\"')}"` + line.slice(idx + strMatch[0].length);
  }
  throw new SldWriteError('Could not locate a label token (bracketed shape or quoted string) on the node declaration line.');
}

function formatValue(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

/** Patch or insert `key: value` entries inside a trailing `{ ... }` attr
 *  block on the line, creating the block if none exists. Existing keys not
 *  present in `patch` are left untouched; nested-object values for an
 *  existing key are refused (module-doc scope limit). */
function patchStyleBlock(line: string, patch: Record<string, string | number | boolean>): string {
  const blockMatch = line.match(/\{([^{}]*)\}\s*$/);
  const entries = new Map<string, string>();
  let prefix = line;

  if (blockMatch) {
    const body = blockMatch[1];
    if (/[{}]/.test(body)) {
      throw new SldWriteError('Node has a nested attribute block; this writer only supports flat key: value pairs (see module doc).');
    }
    prefix = line.slice(0, blockMatch.index!).replace(/\s+$/, '');
    for (const part of splitTopLevel(body)) {
      const kv = part.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/);
      if (kv) entries.set(kv[1], kv[2]);
    }
  }

  for (const [k, v] of Object.entries(patch)) entries.set(k, formatValue(v));

  const body = Array.from(entries.entries()).map(([k, v]) => `${k}: ${v}`).join(', ');
  return `${prefix} { ${body} }`;
}

function splitTopLevel(s: string): string[] {
  return s.split(',').map((p) => p.trim()).filter(Boolean);
}

/** Apply a node patch to .sld source text, returning the new source.
 *  Throws SldWriteError if the node can't be located or the patch needs
 *  nested-object support this writer doesn't have. */
export function applyNodePatch(source: string, nodeId: string, patch: NodePatch): string {
  const lines = source.split('\n');
  const lineIdx = findNodeLine(lines, nodeId);
  let line = lines[lineIdx];

  if (patch.label !== undefined) line = patchLabel(line, patch.label);
  if (patch.style && Object.keys(patch.style).length > 0) line = patchStyleBlock(line, patch.style);

  lines[lineIdx] = line;
  return lines.join('\n');
}
