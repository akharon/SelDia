// =============================================================================
// SelDiA VS Code — per-document TOC/caption front-matter override tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFrontMatterOverrides } from '../src/markdown-preview/frontmatter.js';

describe('readFrontMatterOverrides', () => {
  it('returns no overrides when there is no front-matter', () => {
    expect(readFrontMatterOverrides('# Title\n\nsome text')).toEqual({});
  });

  it('returns no overrides when front-matter has neither key', () => {
    const md = '---\ntitle: Doc\n---\n\n# Title';
    expect(readFrontMatterOverrides(md)).toEqual({});
  });

  it('reads seldia_toc: false', () => {
    const md = '---\nseldia_toc: false\n---\n\n# Title';
    expect(readFrontMatterOverrides(md)).toEqual({ toc: false });
  });

  it('reads seldia_toc: true', () => {
    const md = '---\nseldia_toc: true\n---\n\n# Title';
    expect(readFrontMatterOverrides(md)).toEqual({ toc: true });
  });

  it('reads seldia_captions: false', () => {
    const md = '---\nseldia_captions: false\n---\n\n# Title';
    expect(readFrontMatterOverrides(md)).toEqual({ captions: false });
  });

  it('reads both keys together, alongside unrelated front-matter', () => {
    const md = '---\ntitle: Doc\nseldia_toc: false\nauthor: me\nseldia_captions: true\n---\n\n# Title';
    expect(readFrontMatterOverrides(md)).toEqual({ toc: false, captions: true });
  });

  it('ignores a seldia_toc mention outside the front-matter block', () => {
    const md = '# Title\n\nseldia_toc: false\n';
    expect(readFrontMatterOverrides(md)).toEqual({});
  });
});
