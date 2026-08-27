// =============================================================================
// SelDiA VS Code — diagram numbering tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  nextDiagramNumber,
  anchorForDiagram,
  captionFor,
  titleFromDsl,
  registerDiagram,
  diagramsOf,
  renderTocHtml,
} from '../src/markdown-preview/numbering.js';

describe('nextDiagramNumber', () => {
  it('increments per env, starting at 1', () => {
    const env: any = {};
    expect(nextDiagramNumber(env)).toBe(1);
    expect(nextDiagramNumber(env)).toBe(2);
    expect(nextDiagramNumber(env)).toBe(3);
  });

  it('is isolated between two env objects', () => {
    const envA: any = {};
    const envB: any = {};
    nextDiagramNumber(envA);
    nextDiagramNumber(envA);
    expect(nextDiagramNumber(envB)).toBe(1);
    expect(nextDiagramNumber(envA)).toBe(3);
  });

  it('falls back to a module-local counter when env access throws', () => {
    const hostile = {
      get __seldiaDiagramCount() {
        throw new Error('nope');
      },
    };
    expect(() => nextDiagramNumber(hostile)).not.toThrow();
    expect(typeof nextDiagramNumber(hostile)).toBe('number');
  });
});

describe('anchorForDiagram', () => {
  it('formats a positional anchor', () => {
    expect(anchorForDiagram(3)).toBe('diagram-3');
  });
});

describe('captionFor', () => {
  it('formats without a title', () => {
    expect(captionFor(3)).toBe('Diagram 3');
  });

  it('formats with a title', () => {
    expect(captionFor(3, 'Payment flow')).toBe('Diagram 3 — Payment flow');
  });

  it('treats a whitespace-only title as absent', () => {
    expect(captionFor(1, '   ')).toBe('Diagram 1');
  });
});

describe('titleFromDsl', () => {
  it('extracts a quoted diagram title', () => {
    expect(titleFromDsl('diagram flowchart "Payment flow" {\n  a: (S)\n}')).toBe('Payment flow');
  });

  it('returns undefined when there is no title', () => {
    expect(titleFromDsl('diagram flowchart {\n  a: (S)\n}')).toBeUndefined();
  });
});

describe('registerDiagram / diagramsOf', () => {
  it('accumulates in document order per env', () => {
    const env: any = {};
    registerDiagram(env, { n: 1, anchor: 'diagram-1', blockId: 'seldia-a' });
    registerDiagram(env, { n: 2, anchor: 'diagram-2', blockId: 'seldia-b', title: 'B' });
    expect(diagramsOf(env)).toHaveLength(2);
    expect(diagramsOf(env)[1].title).toBe('B');
  });

  it('returns an empty list for an env with nothing registered', () => {
    expect(diagramsOf({})).toEqual([]);
  });
});

describe('renderTocHtml', () => {
  it('omits empty sections', () => {
    const html = renderTocHtml([], []);
    expect(html).toBe('');
  });

  it('renders headings and diagrams as separate sections', () => {
    const html = renderTocHtml(
      [{ level: 1, text: 'Intro', anchor: 'intro' }],
      [{ n: 1, anchor: 'diagram-1', blockId: 'seldia-a', title: 'Flow' }]
    );
    expect(html).toContain('Contents');
    expect(html).toContain('href="#intro"');
    expect(html).toContain('Diagrams');
    expect(html).toContain('href="#diagram-1"');
    expect(html).toContain('Diagram 1 — Flow');
  });

  it('marks an error diagram entry', () => {
    const html = renderTocHtml([], [{ n: 1, anchor: 'diagram-1', blockId: 'x', hasError: true }]);
    expect(html).toContain('seldia-toc-error');
  });
});
