// =============================================================================
// SelDiA VS Code — Marp detection and rendering tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createEngine } from '@seldia/core';
import { isMarpDocument } from '../src/marp/detect.js';
import { renderMarpDeck, assembleMarpDocument } from '../src/marp/render.js';

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
