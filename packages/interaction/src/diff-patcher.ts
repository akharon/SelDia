// =============================================================================
// SelDiA — Diff Patcher
// =============================================================================
// Computes minimal text edits from DslPatch descriptions, preserving
// surrounding formatting, comments, and whitespace.

import type { DiffPatcher, TextEdit } from './source-map-types.js';
import type { DslPatch } from './visual-edit-types.js';

export class SelDiADiffPatcher implements DiffPatcher {
  /**
   * Compute the minimal set of text edits from a list of DSL patches.
   * Edits are sorted in reverse offset order to preserve positions.
   */
  computeEdits(sourceText: string, patches: DslPatch[]): TextEdit[] {
    const edits: TextEdit[] = [];

    for (const patch of patches) {
      switch (patch.type) {
        case 'insert':
          edits.push({
            offset: patch.startOffset,
            deleteCount: 0,
            insert: patch.newText || '',
          });
          break;

        case 'delete':
          edits.push({
            offset: patch.startOffset,
            deleteCount: patch.endOffset - patch.startOffset,
            insert: '',
          });
          break;

        case 'replace':
          edits.push({
            offset: patch.startOffset,
            deleteCount: patch.endOffset - patch.startOffset,
            insert: patch.newText || '',
          });
          break;
      }
    }

    // Sort edits by offset in descending order so applying them
    // doesn't shift positions of earlier edits
    edits.sort((a, b) => b.offset - a.offset);

    return edits;
  }

  /**
   * Find the source offset for a given line number (0-based).
   */
  offsetForLine(sourceText: string, line: number): number {
    const lines = sourceText.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) {
      offset += lines[i].length + 1; // +1 for \n
    }
    return offset;
  }

  /**
   * Find the line number (0-based) for a given source offset.
   */
  lineForOffset(sourceText: string, offset: number): number {
    let current = 0;
    for (let i = 0; i < sourceText.length; i++) {
      if (current >= offset) return i === 0 ? 0 : i - 1;
      if (sourceText[i] === '\n') current++;
    }
    return 0;
  }

  /**
   * Apply text edits to a source string.
   * Edits must be sorted in descending offset order.
   */
  applyEdits(sourceText: string, edits: TextEdit[]): string {
    let result = sourceText;
    for (const edit of edits) {
      const before = result.slice(0, edit.offset);
      const after = result.slice(edit.offset + edit.deleteCount);
      result = before + edit.insert + after;
    }
    return result;
  }

  /**
   * Generate a unified-diff-like description of the changes.
   */
  generateDiff(sourceText: string, edits: TextEdit[]): string {
    let result = sourceText;
    const parts: string[] = [];

    for (const edit of [...edits].sort((a, b) => a.offset - b.offset)) {
      const lineStart = this.lineForOffset(sourceText, edit.offset);
      const contextBefore = sourceText.split('\n').slice(Math.max(0, lineStart - 1), lineStart).join('\n');
      const contextAfter = sourceText.split('\n').slice(lineStart, lineStart + 2).join('\n');

      if (edit.deleteCount > 0) {
        const deleted = sourceText.slice(edit.offset, edit.offset + edit.deleteCount);
        parts.push(`--- ${contextBefore}\n--- ${deleted}`);
      }
      if (edit.insert) {
        parts.push(`+++ ${edit.insert}`);
      }
    }

    return parts.join('\n');
  }
}
