// =============================================================================
// SelDiA — Diff patcher round-trip tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { SelDiADiffPatcher } from '../src/diff-patcher.js';
import type { DslPatch } from '../src/visual-edit-types.js';

function patch(p: Partial<DslPatch>): DslPatch {
  return {
    type: 'replace',
    startOffset: 0,
    endOffset: 0,
    description: 'test',
    sourceOperation: {} as any,
    ...p,
  };
}

describe('SelDiADiffPatcher', () => {
  it('applies a single replace edit', () => {
    const patcher = new SelDiADiffPatcher();
    const src = 'a: (Start)\n';
    const edits = patcher.computeEdits(src, [
      patch({ type: 'replace', startOffset: 0, endOffset: 1, newText: 'x' }),
    ]);
    const result = patcher.applyEdits(src, edits);
    expect(result).toBe('x: (Start)\n');
  });

  it('applies an insert and a delete together, sorted so earlier edits are unaffected', () => {
    const patcher = new SelDiADiffPatcher();
    const src = 'abcdef';
    const patches: DslPatch[] = [
      patch({ type: 'delete', startOffset: 0, endOffset: 2 }), // removes "ab"
      patch({ type: 'insert', startOffset: 4, newText: 'XY' }), // inserts before "ef"
    ];
    const edits = patcher.computeEdits(src, patches);
    const result = patcher.applyEdits(src, edits);
    expect(result).toBe('cdXYef');
  });

  it('offsetForLine finds the correct start offset for a line', () => {
    const patcher = new SelDiADiffPatcher();
    const src = 'line0\nline1\nline2\n';
    const offset = patcher.offsetForLine(src, 2);
    expect(src.slice(offset, offset + 5)).toBe('line2');
  });
});
