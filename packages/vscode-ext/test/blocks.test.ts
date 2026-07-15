// =============================================================================
// SelDiA VS Code — DSL block discovery tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { blockIdForSource, findSelDiABlocks, findBlockById } from '../src/edit/blocks.js';

describe('findSelDiABlocks', () => {
  it('locates a single fenced block and its source lines', () => {
    const md = ['# Title', '', '```seldia', 'diagram flowchart "T" {', '  a: (S)', '}', '```', 'after'].join('\n');
    const blocks = findSelDiABlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fenceLine).toBe(2);
    expect(blocks[0].sourceStartLine).toBe(3);
    expect(blocks[0].sourceEndLine).toBe(6);
    expect(blocks[0].source).toContain('diagram flowchart');
  });

  it('locates multiple blocks and language suffixes', () => {
    const md = ['```seldia', 'a', '```', 'x', '```seldia-flowchart', 'b', '```'].join('\n');
    const blocks = findSelDiABlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].lang).toBe('seldia-flowchart');
  });

  it('ignores non-seldia fences', () => {
    const md = ['```js', 'const a = 1;', '```'].join('\n');
    expect(findSelDiABlocks(md)).toHaveLength(0);
  });

  it('tolerates a missing closing fence', () => {
    const md = ['```seldia', 'diagram flowchart "T" { a: (S) }'].join('\n');
    const blocks = findSelDiABlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toContain('diagram flowchart');
  });

  it('block id matches blockIdForSource of its source', () => {
    const md = ['```seldia', 'diagram flowchart "T" { a: (S) }', '```'].join('\n');
    const b = findSelDiABlocks(md)[0];
    expect(b.blockId).toBe(blockIdForSource(b.source));
    expect(findBlockById(md, b.blockId)?.source).toBe(b.source);
  });
});
