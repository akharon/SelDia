// =============================================================================
// SelDiA VS Code — Markdown visual editor segmentation tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { findSelDiABlocks } from '../src/edit/blocks.js';
import {
  splitMarkdown, collectLinkDefinitions, segmentKeys, replaceLines, insertBlock,
  minimalLineEdit, applyLineEdit, rewriteImageSrcs,
} from '../src/md-editor/segments.js';

const FENCE = '```';

describe('splitMarkdown', () => {
  it('splits front matter off', () => {
    const segs = splitMarkdown('---\ntitle: x\n---\n\nHello');
    expect(segs.map((s) => s.kind)).toEqual(['frontmatter', 'prose']);
    expect(segs[0]).toMatchObject({ startLine: 0, endLine: 3 });
    expect(segs[1]).toMatchObject({ startLine: 4, endLine: 5, raw: 'Hello' });
  });

  it('splits paragraphs on blank lines', () => {
    const segs = splitMarkdown('# T\n\npara one\nline two\n\n\npara three');
    expect(segs.map((s) => s.raw)).toEqual(['# T', 'para one\nline two', 'para three']);
    expect(segs[2].startLine).toBe(6);
  });

  it('keeps a loose list as one block', () => {
    const segs = splitMarkdown('- a\n\n- b\n\n- c\n\nafter');
    expect(segs).toHaveLength(2);
    expect(segs[0].raw).toBe('- a\n\n- b\n\n- c');
  });

  it('keeps indented continuation with its block', () => {
    const segs = splitMarkdown('1. item\n\n    continued code\n\nnext');
    expect(segs).toHaveLength(2);
    expect(segs[0].raw).toBe('1. item\n\n    continued code');
  });

  it('keeps a non-diagram code fence with blank lines whole', () => {
    const md = `${FENCE}js\nconst a = 1;\n\nconst b = 2;\n${FENCE}\n\nafter`;
    const segs = splitMarkdown(md);
    expect(segs).toHaveLength(2);
    expect(segs[0].kind).toBe('prose');
    expect(segs[0].raw).toContain('const b = 2;');
  });

  it('turns seldia/mermaid fences into diagrams with body range and block id', () => {
    const md = ['intro', '', FENCE + 'seldia', 'diagram flowchart "T" {', '  a: (S)', '}', FENCE, '', FENCE + 'mermaid', 'flowchart LR', '  A --> B', FENCE].join('\n');
    const segs = splitMarkdown(md);
    const found = findSelDiABlocks(md);
    expect(segs.map((s) => s.kind)).toEqual(['prose', 'diagram', 'diagram']);
    const d = segs[1];
    expect(d).toMatchObject({ lang: 'seldia', startLine: 2, endLine: 7, bodyStart: 3, bodyEnd: 6 });
    expect(d.source).toBe('diagram flowchart "T" {\n  a: (S)\n}');
    expect(d.blockId).toBe(found[0].blockId);
    expect(segs[2]).toMatchObject({ lang: 'mermaid', bodyStart: 9, bodyEnd: 11 });
    expect(segs[2].blockId).toBe(found[1].blockId);
  });

  it('lets a fence directly after a paragraph line interrupt it', () => {
    const md = `text line\n${FENCE}mermaid\nflowchart LR\n  A --> B\n${FENCE}`;
    const segs = splitMarkdown(md);
    expect(segs.map((s) => s.kind)).toEqual(['prose', 'diagram']);
    expect(segs[0]).toMatchObject({ startLine: 0, endLine: 1 });
    expect(segs[1].startLine).toBe(1);
  });

  it('handles an unterminated fence without throwing', () => {
    const segs = splitMarkdown(`para\n\n${FENCE}seldia\ndiagram flowchart "T" {\n  a: (S)\n}`);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[segs.length - 1].endLine).toBeLessThanOrEqual(6);
  });
});

describe('collectLinkDefinitions', () => {
  it('collects definitions and ignores fenced content', () => {
    const md = `[a]: http://a.example\n\n${FENCE}\n[b]: http://b.example\n${FENCE}\n\n  [c]: http://c.example "T"`;
    expect(collectLinkDefinitions(md)).toBe('[a]: http://a.example\n[c]: http://c.example "T"');
  });
});

describe('segmentKeys', () => {
  it('gives duplicates distinct keys and equal content stable keys', () => {
    const segs = splitMarkdown('same\n\nsame\n\nother');
    const keys = segmentKeys(segs);
    expect(new Set(keys).size).toBe(3);
    expect(segmentKeys(splitMarkdown('same\n\nsame\n\nother'))).toEqual(keys);
  });
});

describe('replaceLines', () => {
  it('replaces a range', () => {
    expect(replaceLines('a\nb\nc', 1, 2, 'X\nY')).toBe('a\nX\nY\nc');
  });
  it('deletes with one adjacent blank line', () => {
    expect(replaceLines('a\n\nb\n\nc', 2, 3, null)).toBe('a\n\nc');
    expect(replaceLines('a\n\nb', 2, 3, '')).toBe('a');
  });
  it('preserves CRLF', () => {
    expect(replaceLines('a\r\nb\r\nc', 1, 2, 'X\nY')).toBe('a\r\nX\r\nY\r\nc');
  });
});

describe('insertBlock', () => {
  it('inserts in the middle with blank separation', () => {
    const r = insertBlock('a\n\nb', 1, 'NEW');
    expect(r.text).toBe('a\nNEW\n\nb'.replace('a\nNEW', 'a\n\nNEW').replace('\n\n\n', '\n\n'));
    expect(r.text.split('\n')[r.line]).toBe('NEW');
  });
  it('inserts at the end', () => {
    const r = insertBlock('a', 99, 'NEW');
    expect(r.text).toBe('a\n\nNEW');
    expect(r.line).toBe(2);
  });
  it('inserts into an empty document', () => {
    expect(insertBlock('', 0, 'NEW')).toEqual({ text: 'NEW\n', line: 0 });
  });
  it('separates from adjacent non-blank lines on both sides', () => {
    const r = insertBlock('a\nb', 1, 'NEW');
    expect(r.text).toBe('a\n\nNEW\n\nb');
  });
});

describe('minimalLineEdit', () => {
  const cases: Array<[string, string, string]> = [
    ['replace middle', 'a\nb\nc', 'a\nX\nc'],
    ['append lines', 'a', 'a\nb\nc'],
    ['append after final newline', 'a\n', 'a\nb\n'],
    ['delete tail', 'a\nb\nc', 'a'],
    ['delete all', 'a\nb', ''],
    ['from empty', '', 'a\nb'],
    ['insert middle', 'a\nc', 'a\nb\nc'],
    ['identical', 'a\nb', 'a\nb'],
    ['CRLF replace', 'a\r\nb\r\nc', 'a\r\nX\r\nY\r\nc'],
    ['CRLF append', 'a\r\nb', 'a\r\nb\r\nc'],
    ['repeated lines', 'x\nx\nx', 'x\nx\nx\nx'],
  ];
  for (const [name, a, b] of cases) {
    it(`round-trips: ${name}`, () => {
      const edit = minimalLineEdit(a, b);
      expect(applyLineEdit(a, edit)).toBe(b);
    });
  }
  it('limits the range to the differing lines', () => {
    const e = minimalLineEdit('a\nb\nc\nd', 'a\nX\nc\nd');
    expect(e).toMatchObject({ startLine: 1, endLine: 2, text: 'X' });
  });
  it('joins replacement lines with the document EOL', () => {
    expect(minimalLineEdit('a\r\nb', 'a\r\nX\r\nY').text).toBe('X\r\nY');
  });
});

describe('rewriteImageSrcs', () => {
  const resolve = (s: string) => `vscode-resource:${s}`;
  it('rewrites relative sources only', () => {
    const html = '<img src="a/b.png" alt="x"><img alt="y" src=\'c.png\'><img src="https://e.com/i.png"><img src="//cdn/i.png"><img src="#frag"><img src="data:image/png;base64,AA">';
    const out = rewriteImageSrcs(html, resolve);
    expect(out).toContain('src="vscode-resource:a/b.png"');
    expect(out).toContain("src='vscode-resource:c.png'");
    expect(out).toContain('src="https://e.com/i.png"');
    expect(out).toContain('src="//cdn/i.png"');
    expect(out).toContain('src="#frag"');
    expect(out).toContain('src="data:image/png;base64,AA"');
  });
  it('keeps the original when resolve returns undefined', () => {
    expect(rewriteImageSrcs('<img src="a.png">', () => undefined)).toBe('<img src="a.png">');
  });
});
