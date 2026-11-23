import { describe, it, expect } from 'vitest';
import { computeThemeEdit } from '../src/edit/theme-line.js';

const apply = (src: string, id: string) => { const e = computeThemeEdit(src, id); return src.slice(0, e.start) + e.text + src.slice(e.end); };

describe('computeThemeEdit', () => {
  it('inserts after the header with the body indent', () => {
    expect(apply('diagram flowchart "A" {\n    a -> b\n}', 'clean-dark')).toBe('diagram flowchart "A" {\n    theme clean dark\n    a -> b\n}');
  });
  it('replaces an existing theme line, keyword or bare', () => {
    expect(apply('fl "A" {\n  theme glow dark\n  a -> b\n}', 'mono')).toBe('fl "A" {\n  theme mono\n  a -> b\n}');
    expect(apply('fl "A" {\n  glow light\n  a -> b\n}', 'blueprint')).toBe('fl "A" {\n  theme blueprint\n  a -> b\n}');
  });
  it('leaves custom theme blocks alone and keeps CRLF', () => {
    expect(apply('theme "x" {\r\n}\r\nfl "A" {\r\n  a -> b\r\n}', 'glow-light')).toBe('theme "x" {\r\n}\r\nfl "A" {\r\n  theme glow light\r\n  a -> b\r\n}');
  });
});
