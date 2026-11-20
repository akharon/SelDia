// =============================================================================
// SelDiA VS Code — Marp detection and rendering tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { createEngine } from '@seldia/core';
import { isMarpDocument } from '../src/marp/detect.js';
import { renderMarpDeck, assembleMarpDocument, SHRINK_DIAGRAMS_TO_FIT_JS } from '../src/marp/render.js';
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

  it('shrinks a diagram taller than the slide instead of letting Marp clip it', async () => {
    // Marp's <section> is a fixed-height, overflow:hidden box, so a diagram
    // taller than the room left under the heading would otherwise be cut off
    // silently with no scrollbar (verified against a real clipped screenshot
    // during development). This is a real Puppeteer render, not a string
    // check, because the bug is about actual layout math (percentage
    // max-height doesn't account for space already used by prior siblings),
    // which no IR-shape or string-contains assertion can catch.
    const nodes = Array.from({ length: 12 }, (_, i) => `n${i}: [Step ${i}]`).join('\n  ');
    const chain = Array.from({ length: 12 }, (_, i) => `n${i}`).join(' --> ');
    const tallDeck = `---\nmarp: true\n---\n\n# Tall\n\n\`\`\`seldia\ndiagram flowchart "T" {\n  ${nodes}\n  ${chain}\n}\n\`\`\`\n`;

    const { html, css } = renderMarpDeck(engine, tallDeck);
    const doc = assembleMarpDocument(html, css, 'Tall');

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(doc, { waitUntil: 'networkidle0', timeout: 60000 });

      const rects = await page.evaluate(() => {
        const section = document.querySelector('section')!;
        const svg = document.querySelector('.seldia-diagram-svg svg')!;
        return {
          sectionBottom: section.getBoundingClientRect().bottom,
          svgBottom: svg.getBoundingClientRect().bottom,
        };
      });

      expect(rects.svgBottom).toBeLessThanOrEqual(rects.sectionBottom + 1);
    } finally {
      await browser.close();
    }
  }, 30000);

  it('sizes a diagram independently of the preview panel scale', async () => {
    // The live preview panel fits a slide to the panel by CSS-transforming the
    // whole 1280x720 <section> (scale(0.3) in a small panel). The fit routine
    // must therefore measure in *layout* space: measuring with
    // getBoundingClientRect() returns post-transform pixels, and writing those
    // back as a CSS height — which is then scaled for display a second time —
    // collapses the diagram to a sliver, worse the smaller the panel. That was
    // the "diagrams are extremely small in Marp view" bug. The invariant that
    // catches it: the computed box height must not depend on the scale.
    const deck = `---\nmarp: true\n---\n\n# Heading\n\n\`\`\`seldia\ndiagram flowchart "T" {\n  a: (Start)\n  b: [Middle]\n  c: (End)\n  a --> b --> c\n}\n\`\`\`\n`;
    const { html, css } = renderMarpDeck(engine, deck);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(
        `<style>${css}\n.seldia-diagram-source,.seldia-diagram-toolbar{display:none}\n` +
          `.seldia-diagram-svg{box-sizing:border-box;display:flex;overflow:hidden}\n` +
          `.seldia-diagram-svg svg{display:block;width:100%;height:100%;object-fit:contain}</style>` +
          `<div id="wrap">${html}</div><script>${SHRINK_DIAGRAMS_TO_FIT_JS}</script>`,
        { waitUntil: 'networkidle0', timeout: 60000 },
      );

      const heightAtScale = async (scale: number) =>
        page.evaluate((s) => {
          const outer = document.querySelector('svg[data-marpit-svg]') as HTMLElement;
          const box = document.querySelector('.seldia-diagram-svg') as HTMLElement;
          box.style.height = '';
          outer.style.transformOrigin = 'top left';
          outer.style.transform = 'scale(' + s + ')';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).shrinkDiagramsToFit(document);
          return box.offsetHeight;
        }, scale);

      const full = await heightAtScale(1);
      const small = await heightAtScale(0.3);

      expect(full).toBeGreaterThan(100);
      expect(small).toBe(full);
    } finally {
      await browser.close();
    }
  }, 30000);

  it('forces a portrait diagram to landscape, but leaves an already-wide diagram alone', () => {
    // The "deployment" diagram type's own default direction is top-to-bottom
    // (see getDefaultLayoutOptions in diagrams/misc.ts), which draws a linear
    // pipeline as a tall single column — the worst possible shape for a
    // 1280x720 slide. Marp should override that default (not just
    // config.layout.direction, which a type default already wins over — see
    // forceDirection in engine.ts) and lay it out left-to-right instead.
    const tallDeck = `---\nmarp: true\n---\n\n# Pipeline\n\n\`\`\`seldia\ndiagram deployment "T" {\n  a: (Dev)\n  b: [Build]\n  c: [Test]\n  d: [Deploy]\n  a --> b --> c --> d\n}\n\`\`\`\n`;
    const { html: tallHtml } = renderMarpDeck(engine, tallDeck);
    const tallMatch = tallHtml.match(/class="seldia-diagram-svg-el[^"]*"[^>]*viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
    expect(tallMatch).not.toBeNull();
    const [, tw, th] = tallMatch!.map(Number) as unknown as [number, number, number];
    expect(tw).toBeGreaterThan(th); // forced to landscape

    // A flowchart laid out with a wide fan-out is already landscape-shaped at
    // its type default (TB, but wide because siblings share a rank) — it must
    // come out exactly as it would without this feature, not get forced to LR
    // and made wider still for no reason.
    const fatDeck = `---\nmarp: true\n---\n\n# Fanout\n\n\`\`\`seldia\ndiagram flowchart "T" {\n  a: (Start)\n  b: [One]\n  c: [Two]\n  d: [Three]\n  e: [Four]\n  a --> b\n  a --> c\n  a --> d\n  a --> e\n}\n\`\`\`\n`;
    const previousDirection = engine.config.layout.forceDirection;
    const { html: fatHtmlWithFeature } = renderMarpDeck(engine, fatDeck);
    expect(engine.config.layout.forceDirection).toBe(previousDirection); // restored, doesn't leak

    engine.config.layout.forceDirection = undefined;
    const { html: fatHtmlPlain } = renderMarpDeck(engine, fatDeck);
    const vb = (h: string) => h.match(/class="seldia-diagram-svg-el[^"]*"[^>]*viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
    expect(vb(fatHtmlWithFeature)?.[0]).toBe(vb(fatHtmlPlain)?.[0]);
  });

  it('does not duplicate diagram numbering or TOC entries for the discarded probe render', () => {
    // sizing the direction requires rendering the same block up to twice
    // before committing to one HTML string — each throwaway attempt must not
    // advance the shared diagram counter or register a second TOC entry.
    const deck = `---\nmarp: true\n---\n\n# One\n\n\`\`\`seldia\ndiagram deployment "T" {\n  a: (Dev)\n  b: [Build]\n  c: [Test]\n  d: [Deploy]\n  a --> b --> c --> d\n}\n\`\`\`\n\n---\n\n# Two\n\n\`\`\`seldia\ndiagram flowchart "T" {\n  x: (Start)\n  y: [Do]\n  x --> y\n}\n\`\`\`\n`;
    const { html } = renderMarpDeck(engine, deck);
    expect(html).toContain('Diagram 1');
    expect(html).toContain('Diagram 2');
    expect(html).not.toContain('Diagram 3');
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
}, 60000);
