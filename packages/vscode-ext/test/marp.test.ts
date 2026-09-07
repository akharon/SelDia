// =============================================================================
// SelDiA VS Code — Marp detection and rendering tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createEngine } from '@seldia/core';
import { isMarpDocument } from '../src/marp/detect.js';
import { renderMarpDeck, assembleMarpDocument } from '../src/marp/render.js';
import { readSlideSize, exportMarpToPptx } from '../src/marp/pptx.js';

const engine = createEngine();

describe('isMarpDocument', () => {
  it('detects marp: true in front-matter', () => {
    expect(isMarpDocument('---\nmarp: true\n---\n\n# Slide\n')).toBe(true);
  });

  it('is false for ordinary markdown with no front-matter', () => {
    expect(isMarpDocument('# Just a heading\n')).toBe(false);
  });

  it('is false when front-matter lacks marp: true', () => {
    expect(isMarpDocument('---\ntitle: Hello\n---\n\n# Slide\n')).toBe(false);
    expect(isMarpDocument('---\nmarp: false\n---\n\n# Slide\n')).toBe(false);
  });
});

describe('renderMarpDeck', () => {
  const DECK = `---
marp: true
---

# Slide One

---

# Slide Two

\`\`\`seldia
diagram flowchart "T" {
  a: (Start)
  b: [Do]
  a --> b
}
\`\`\`
`;

  it('paginates into one <section> per slide', () => {
    const { html, slideCount } = renderMarpDeck(engine, DECK);
    expect(slideCount).toBe(2);
    expect(html).toContain('<section');
  });

  it('renders a seldia fence inside a slide as inline SVG, not a code block', () => {
    const { html } = renderMarpDeck(engine, DECK);
    expect(html).toContain('class="seldia-diagram"');
    expect(html).toContain('<svg');
  });

  it('assembleMarpDocument wraps the deck into a standalone HTML document', () => {
    const { html, css } = renderMarpDeck(engine, DECK);
    const doc = assembleMarpDocument(html, css, 'My Deck');
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('My Deck');
    expect(doc).toContain('<section');
  });
});

describe('readSlideSize', () => {
  it('reads the slide size out of Marp @page CSS', () => {
    expect(readSlideSize('@page {size:1280px 720px;margin:0}'))
      .toEqual({ width: 1280, height: 720 });
  });

  it('reads a 4:3 deck size', () => {
    expect(readSlideSize('@page {size:960px 720px;margin:0}'))
      .toEqual({ width: 960, height: 720 });
  });

  it('falls back to 16:9 when no @page rule is present', () => {
    expect(readSlideSize('section { color: red }'))
      .toEqual({ width: 1280, height: 720 });
  });

  it('reads the size out of a full Marp stylesheet, not just a bare rule', () => {
    const { css } = renderMarpDeck(engine, '---\nmarp: true\n---\n\n# Slide\n');
    expect(readSlideSize(css)).toEqual({ width: 1280, height: 720 });
  });

  it('falls back rather than mis-reading a non-px @page size', () => {
    expect(readSlideSize('@page {size:210mm 297mm;margin:0}'))
      .toEqual({ width: 1280, height: 720 });
  });
});

it('reports an error for markdown that cannot be rendered', async () => {
  const result = await exportMarpToPptx(
    null as any, // engine is only touched by fence rendering
    '---\nmarp: true\n---\n\n# Hi\n',
    '/nonexistent-dir-xyz/out.pptx'
  );
  expect(result.success).toBe(false);
  expect(result.errorMessage).toBeTruthy();
});
