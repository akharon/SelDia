// =============================================================================
// SelDiA VS Code — DSL block discovery tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
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

describe('block id agreement between preview and host', () => {
  // Regression: the plugin hashed markdown-it's `token.content` (which keeps the
  // newline before the closing fence) while the host hashed the joined lines
  // between the fences (which does not). The ids never matched, so every deep
  // link the preview emitted failed with "could not locate this diagram block in
  // its Markdown source". Hashing a hand-written string on both sides hid this —
  // these tests must go through a real markdown-it parse to be worth anything.
  const parseFence = (md: string): string => {
    const tokens = new MarkdownIt().parse(md, {});
    const fence = tokens.find((t) => t.type === 'fence');
    if (!fence) throw new Error('no fence parsed');
    return fence.content;
  };

  it('agrees on a block ending with a newline before the closing fence', () => {
    const md = ['# Doc', '', '```seldia', 'diagram flowchart "T" {', '  a: (A) --> b: (B)', '}', '```', ''].join('\n');
    expect(blockIdForSource(parseFence(md))).toBe(findSelDiABlocks(md)[0].blockId);
  });

  it('agrees when the block has trailing blank lines', () => {
    const md = ['```seldia', 'diagram flowchart "T" { a: (S) }', '', '', '```'].join('\n');
    expect(blockIdForSource(parseFence(md))).toBe(findSelDiABlocks(md)[0].blockId);
  });

  it('a rendered block id is findable in the source document', () => {
    const md = ['intro', '', '```seldia', 'diagram flowchart "T" {', '  a: (A)', '}', '```', '', 'outro'].join('\n');
    // What the preview stamps into its deep link:
    const rendered = blockIdForSource(parseFence(md));
    // What the host does when that link is clicked:
    expect(findBlockById(md, rendered)).toBeDefined();
  });

  it('still distinguishes genuinely different blocks', () => {
    const a = blockIdForSource('diagram flowchart "A" { a: (S) }');
    const b = blockIdForSource('diagram flowchart "B" { a: (S) }');
    expect(a).not.toBe(b);
  });
});
