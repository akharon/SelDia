// =============================================================================
// Write the visual editor's theme choice into the diagram source as a
// `theme …` line, so the file — not the panel — carries the theme.
// =============================================================================

import { themeDirective } from '@seldia/core';
import type { TextEdit } from './position-patch.js';

/** A one-line theme statement: `theme …` or a bare `sketchy|smooth|mono|glow [light|dark]`.
 *  A `theme "name" {` custom-theme definition block is not one. */
const THEME_LINE = /^([ \t]*)(?:theme\b[^{\n]*|(?:sketchy|smooth|mono|glow)(?:[ \t]+(?:light|dark))?)[ \t]*$/i;

/** Edit that sets the diagram's theme to `themeId`: replaces the existing theme
 *  line, else inserts one right after the diagram header line. */
export function computeThemeEdit(source: string, themeId: string): TextEdit {
  const directive = themeDirective(themeId);
  const lines = source.split('\n');
  let offset = 0;
  let header: { end: number; indent: string; next?: string } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const m = THEME_LINE.exec(raw);
    if (m) return { start: offset + m[1].length, end: offset + raw.length, text: directive };
    const t = raw.trim();
    if (!header && t.endsWith('{') && !t.startsWith('//') && !/^theme\b/i.test(t)) {
      header = { end: offset + lines[i].length, indent: /^[ \t]*/.exec(raw)![0], next: lines.slice(i + 1).find((l) => l.trim()) };
    }
    offset += lines[i].length + 1;
  }
  if (!header) return { start: 0, end: 0, text: `${directive}\n` };
  const nextIndent = header.next ? /^[ \t]*/.exec(header.next)![0] : '';
  const indent = nextIndent.length > header.indent.length ? nextIndent : `${header.indent}  `;
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  // header.end sits before the line's own \r (if any) only when it has none; keep CRLF intact.
  const at = source[header.end - 1] === '\r' ? header.end - 1 : header.end;
  return { start: at, end: at, text: `${eol}${indent}${directive}` };
}
