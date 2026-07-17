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
  const lines = source.split('\n');
  const rx = Math.round(x);
  const ry = Math.round(y);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const leadingWs = line.length - trimmed.length;
    if (!(trimmed.startsWith(nodeId + ':') || trimmed.startsWith(nodeId + ' ') || trimmed === nodeId)) {
      continue;
    }
    // Guard against matching a longer identifier that happens to share this
    // prefix (e.g. nodeId "a" must not match a line starting "abc:").
    const afterId = trimmed.slice(nodeId.length);
    if (afterId.length > 0 && /^[A-Za-z0-9_-]/.test(afterId)) continue;

    const lineStartOffset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);

    // Find a trailing `{ ... }` attribute block on this line (single-line
    // node declarations are how every existing patcher in this codebase
    // models a node, so we do the same rather than trying to span multiple
    // lines).
    const braceOpen = line.indexOf('{', leadingWs);
    if (braceOpen === -1) {
      // No attribute block yet — append one at end of line.
      const insertAt = lineStartOffset + line.length;
      return {
        start: insertAt,
        end: insertAt,
        text: ` { x: ${rx}, y: ${ry} }`,
      };
    }

    const braceClose = findMatchingBrace(line, braceOpen);
    if (braceClose === -1) {
      // Malformed/unbalanced — don't guess, append a fresh block instead.
      const insertAt = lineStartOffset + line.length;
      return {
        start: insertAt,
        end: insertAt,
        text: ` { x: ${rx}, y: ${ry} }`,
      };
    }

    const attrBody = line.slice(braceOpen + 1, braceClose);
    const merged = mergeXY(attrBody, rx, ry);
    return {
      start: lineStartOffset + braceOpen,
      end: lineStartOffset + braceClose + 1,
      text: `{${merged}}`,
    };
  }

  return undefined;
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
 * Merge `x`/`y` keys into an existing attribute-block body (the text between
 * `{` and `}`, exclusive), replacing prior `x`/`y` values (flat or inside a
 * legacy `layout: { ... }` sub-block) and leaving every other key untouched.
 */
function mergeXY(attrBody: string, x: number, y: number): string {
  const entries = splitTopLevelEntries(attrBody);
  const kept: string[] = [];
  let sawFlatX = false;
  let sawFlatY = false;
  let sawLayout = false;

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const keyMatch = /^([A-Za-z0-9_]+)\s*:/.exec(trimmed);
    const key = keyMatch?.[1];

    if (key === 'x') {
      sawFlatX = true;
      kept.push(` x: ${x}`);
      continue;
    }
    if (key === 'y') {
      sawFlatY = true;
      kept.push(` y: ${y}`);
      continue;
    }
    if (key === 'layout') {
      // Legacy nested layout block — rewrite its x/y in place, keep any
      // other keys it might carry (e.g. locked).
      sawLayout = true;
      const braceStart = trimmed.indexOf('{');
      const braceEnd = trimmed.lastIndexOf('}');
      const inner = braceStart !== -1 && braceEnd !== -1 ? trimmed.slice(braceStart + 1, braceEnd) : '';
      const innerMerged = mergeXY(inner, x, y);
      kept.push(` layout: {${innerMerged}}`);
      continue;
    }
    kept.push(` ${trimmed}`);
  }

  if (!sawFlatX && !sawLayout) kept.push(` x: ${x}`);
  if (!sawFlatY && !sawLayout) kept.push(` y: ${y}`);

  return kept.join(',') + ' ';
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
    if (ch === '{') { depth++; current += ch; continue; }
    if (ch === '}') { depth--; current += ch; continue; }
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
