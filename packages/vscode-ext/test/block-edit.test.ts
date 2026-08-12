// =============================================================================
// SelDiA VS Code — Markdown fence visual-edit write-back tests (Option B)
// =============================================================================
// Simulates what SelDiAInteractiveProvider does in block mode, using the same
// pure building blocks (findSelDiABlocks / computePositionEdit), without the
// vscode API: compute a patch against the FENCE source, shift it by the
// fence's base offset in the Markdown document, apply, and verify the fence
// updated in place while everything around it is untouched.

import { describe, it, expect } from 'vitest';
import { findSelDiABlocks, findBlockById, blockIdForSource } from '../src/edit/blocks.js';
import { computePositionEdit, computeAttrEdit } from '../src/edit/position-patch.js';

const MD = [
  '# Runbook',
  '',
  'Intro prose that must never change.',
  '',
  '```seldia',
  'diagram flowchart "Pipeline" {',
  '    start: (Start)',
  '    build: [Build]',
  '    start --> build',
  '}',
  '```',
  '',
  'Trailing prose that must never change.',
  '',
  '```seldia',
  'diagram flowchart "Second" {',
  '    a: (A)',
  '}',
  '```',
].join('\n');

/** The provider's base-offset computation, expressed purely: character offset
 *  of the start of `sourceStartLine` in the markdown text. */
function baseOffsetOf(markdown: string, sourceStartLine: number): number {
  const lines = markdown.split('\n');
  let off = 0;
  for (let i = 0; i < sourceStartLine; i++) off += lines[i].length + 1;
  return off;
}

/** Apply a {start,end,text} edit (offsets relative to the fence source) to
 *  the whole markdown document — the same translation applyNodePosition does. */
function applyFenceEdit(markdown: string, fenceIdx: number, edit: { start: number; end: number; text: string }): string {
  const block = findSelDiABlocks(markdown)[fenceIdx];
  const base = baseOffsetOf(markdown, block.sourceStartLine);
  return markdown.slice(0, base + edit.start) + edit.text + markdown.slice(base + edit.end);
}

describe('block-mode write-back (Edit Visually)', () => {
  it('writes a drag position into the fence, leaving the rest of the document byte-identical', () => {
    const blocks = findSelDiABlocks(MD);
    expect(blocks).toHaveLength(2);
    const block = blocks[0];

    const edit = computePositionEdit(block.source, 'build', 300, 200);
    expect(edit).toBeTruthy();

    const updated = applyFenceEdit(MD, 0, edit!);

    // The fence now carries the position…
    const newBlocks = findSelDiABlocks(updated);
    expect(newBlocks).toHaveLength(2);
    expect(newBlocks[0].source).toContain('x: 300');
    expect(newBlocks[0].source).toContain('y: 200');

    // …and everything outside it is untouched.
    expect(updated).toContain('Intro prose that must never change.');
    expect(updated).toContain('Trailing prose that must never change.');
    expect(newBlocks[1].source).toBe(blocks[1].source);
    // Prose before the fence is byte-identical.
    const fenceStart = updated.indexOf('```seldia');
    expect(updated.slice(0, fenceStart)).toBe(MD.slice(0, MD.indexOf('```seldia')));
  });

  it('re-derives the block id after the edit (hash changes with the source)', () => {
    const block = findSelDiABlocks(MD)[0];
    const oldId = block.blockId;

    const edit = computePositionEdit(block.source, 'start', 50, 60)!;
    const updated = applyFenceEdit(MD, 0, edit);

    // Old id no longer resolves…
    expect(findBlockById(updated, oldId)).toBeUndefined();
    // …but the fence is still at the same fence line with a fresh id —
    // exactly what refreshBlockIdentity's proximity re-match relies on.
    const newBlock = findSelDiABlocks(updated)[0];
    expect(newBlock.fenceLine).toBe(block.fenceLine);
    expect(newBlock.blockId).toBe(blockIdForSource(newBlock.source));
    expect(newBlock.blockId).not.toBe(oldId);
  });

  it('targets the second fence independently of the first', () => {
    const blocks = findSelDiABlocks(MD);
    const edit = computePositionEdit(blocks[1].source, 'a', 10, 20)!;
    const updated = applyFenceEdit(MD, 1, edit);

    const newBlocks = findSelDiABlocks(updated);
    expect(newBlocks[0].source).toBe(blocks[0].source); // first untouched
    expect(newBlocks[1].source).toContain('x: 10');
  });

  it('a repeated edit round-trips: second drag replaces the first position, not appends', () => {
    const first = computePositionEdit(findSelDiABlocks(MD)[0].source, 'build', 100, 100)!;
    const afterFirst = applyFenceEdit(MD, 0, first);

    const second = computePositionEdit(findSelDiABlocks(afterFirst)[0].source, 'build', 555, 666)!;
    const afterSecond = applyFenceEdit(afterFirst, 0, second);

    const src = findSelDiABlocks(afterSecond)[0].source;
    expect(src).toContain('x: 555');
    expect(src).toContain('y: 666');
    expect(src).not.toContain('x: 100');
    // Still exactly one declaration line for the node.
    expect(src.split('\n').filter((l) => l.includes('build:')).length).toBe(1);
  });

  it('writes an Edit Style fill into the fence, quoted, replacing a prior value', () => {
    const first = computeAttrEdit(findSelDiABlocks(MD)[0].source, 'build', { fill: '#ff8800' })!;
    const afterFirst = applyFenceEdit(MD, 0, first);
    expect(findSelDiABlocks(afterFirst)[0].source).toContain('fill: "#ff8800"');

    const second = computeAttrEdit(findSelDiABlocks(afterFirst)[0].source, 'build', { fill: 'steelblue' })!;
    const afterSecond = applyFenceEdit(afterFirst, 0, second);
    const src = findSelDiABlocks(afterSecond)[0].source;
    expect(src).toContain('fill: "steelblue"');
    expect(src).not.toContain('#ff8800');
  });

  it('style and position attrs coexist in one attribute block', () => {
    const pos = computePositionEdit(findSelDiABlocks(MD)[0].source, 'build', 300, 200)!;
    const afterPos = applyFenceEdit(MD, 0, pos);
    const style = computeAttrEdit(findSelDiABlocks(afterPos)[0].source, 'build', { stroke: '#333333' })!;
    const src = findSelDiABlocks(applyFenceEdit(afterPos, 0, style))[0].source;
    const line = src.split('\n').find((l) => l.includes('build:'))!;
    expect(line).toContain('x: 300');
    expect(line).toContain('y: 200');
    expect(line).toContain('stroke: "#333333"');
    // Single balanced block on the line.
    expect(line.split('{').length).toBe(2);
  });
});
