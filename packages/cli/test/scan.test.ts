// =============================================================================
// SelDiA CLI — `scan` module unit tests
// =============================================================================
// Pure logic tests for the fence-scanning/file-discovery used by both
// `seldia render` and the GitHub Action script — no CLI process spawn needed.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFencesInMarkdown, scanRepo } from '../src/scan.js';

describe('findFencesInMarkdown', () => {
  it('extracts a single ```seldia fence', () => {
    const md = [
      '# Title',
      '',
      '```seldia',
      'diagram flowchart "T" {',
      '  a (A)',
      '}',
      '```',
      '',
      'trailing text',
    ].join('\n');

    const blocks = findFencesInMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].line).toBe(3);
    expect(blocks[0].index).toBe(0);
    expect(blocks[0].source).toContain('diagram flowchart "T"');
  });

  it('extracts multiple fences including ```seldia-<type> variants', () => {
    const md = [
      '```seldia',
      'A',
      '```',
      'text between',
      '```seldia-sequence',
      'B',
      '```',
    ].join('\n');

    const blocks = findFencesInMarkdown(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toBe('A');
    expect(blocks[1].source).toBe('B');
    expect(blocks[1].index).toBe(1);
  });

  it('ignores non-seldia fenced blocks', () => {
    const md = ['```js', 'console.log(1)', '```'].join('\n');
    expect(findFencesInMarkdown(md)).toHaveLength(0);
  });

  it('returns an empty array when there are no fences', () => {
    expect(findFencesInMarkdown('just plain text\nno fences here')).toHaveLength(0);
  });

  it('handles an unterminated fence by consuming to end of document', () => {
    const md = ['```seldia', 'diagram flowchart "T" {', '  a (A)', '}'].join('\n');
    const blocks = findFencesInMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toContain('a (A)');
  });
});

describe('scanRepo', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'seldia-cli-scan-'));
    writeFileSync(join(dir, 'top.sld'), 'diagram flowchart "Top" {\n  a (A)\n}\n');

    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(
      join(dir, 'sub', 'notes.md'),
      [
        '# Notes',
        '```seldia',
        'diagram flowchart "One" {',
        '  a (A)',
        '}',
        '```',
        '```seldia-sequence',
        'diagram sequence "Two" {',
        '  participant u "U"',
        '}',
        '```',
      ].join('\n')
    );

    writeFileSync(join(dir, 'sub', 'readme.md'), '# no diagrams here\njust text');

    mkdirSync(join(dir, 'node_modules', 'ignored'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'ignored', 'evil.sld'), 'diagram flowchart "Nope" {}\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds standalone .sld files', () => {
    const results = scanRepo(dir);
    const sldResults = results.filter(r => r.kind === 'sld');
    expect(sldResults).toHaveLength(1);
    expect(sldResults[0].file).toBe(join(dir, 'top.sld'));
    expect(sldResults[0].slug).toBe('top');
  });

  it('finds fenced blocks inside .md files, in document order', () => {
    const results = scanRepo(dir);
    const mdResults = results.filter(r => r.kind === 'md-fence');
    expect(mdResults).toHaveLength(2);
    expect(mdResults[0].source).toContain('"One"');
    expect(mdResults[1].source).toContain('"Two"');
  });

  it('disambiguates slugs when a file has multiple fences', () => {
    const results = scanRepo(dir).filter(r => r.kind === 'md-fence');
    expect(results[0].slug).toBe('sub__notes-0');
    expect(results[1].slug).toBe('sub__notes-1');
  });

  it('ignores node_modules', () => {
    const results = scanRepo(dir);
    expect(results.some(r => r.file.includes('node_modules'))).toBe(false);
  });

  it('does not report .md files with no seldia fences', () => {
    const results = scanRepo(dir);
    expect(results.some(r => r.file.endsWith('readme.md'))).toBe(false);
  });

  it('respects extra extensions via extraExts', () => {
    writeFileSync(join(dir, 'extra.seldia'), 'diagram flowchart "Extra" {\n  a (A)\n}\n');
    const withoutExt = scanRepo(dir);
    expect(withoutExt.some(r => r.file.endsWith('extra.seldia'))).toBe(false);

    const withExt = scanRepo(dir, ['.seldia']);
    expect(withExt.some(r => r.file.endsWith('extra.seldia'))).toBe(true);
  });
});
