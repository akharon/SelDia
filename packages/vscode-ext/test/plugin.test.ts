// =============================================================================
// SelDiA VS Code — Markdown-it plugin rendering tests
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import {
  renderSelDiABlock,
  renderMermaidBlock,
  blockIdForSource,
  createSelDiAMarkdownItPlugin,
} from '../src/markdown-preview/plugin.js';
import { blockIdForSource as editBlockId } from '../src/edit/blocks.js';
import { createEngine } from '@seldia/core';

const engine = createEngine();
const SRC = 'diagram flowchart "T" {\n  a: (Start)\n  b: [Do]\n  a --> b\n}';

describe('renderSelDiABlock', () => {
  it('renders inline SVG (not an error, not raw code)', () => {
    const html = renderSelDiABlock(engine, SRC);
    expect(html).toContain('class="seldia-diagram"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('seldia-error');
    expect(html).toContain('data-seldia-node-id="a"');
  });

  it('exposes preview and code modes, defaulting to preview', () => {
    const html = renderSelDiABlock(engine, SRC);
    expect(html).toContain('data-seldia-target-mode="preview"');
    expect(html).toContain('data-seldia-target-mode="code"');
    expect(html).toContain('data-seldia-mode="preview"');
  });

  // The preview is read-only: the built-in Markdown preview has no channel that
  // can carry an edit back to the document reliably, so it must not offer one.
  // Editing happens in the raw file or the custom editor.
  it('offers no edit affordance and no writable source field', () => {
    const html = renderSelDiABlock(engine, SRC);
    expect(html).toContain('<pre class="seldia-source-view">');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('data-seldia-target-mode="edit"');
  });

  // revealSource is one-shot navigation and is the only action the preview may
  // invoke; anything that mutates the document must not be reachable from here.
  it('deep-links to revealSource only', () => {
    const html = renderSelDiABlock(engine, SRC, 'file:///w/demo.md');
    const actions = [...html.matchAll(/href="vscode:\/\/seldia\.seldia-vscode\/(\w+)/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions)).toEqual(new Set(['revealSource']));
  });

  it('uses a block id consistent with the editor module', () => {
    const html = renderSelDiABlock(engine, SRC);
    const id = blockIdForSource(SRC);
    expect(id).toBe(editBlockId(SRC));
    expect(html).toContain(`data-seldia-block="${id}"`);
  });

  it('renders an error container for invalid DSL', () => {
    const html = renderSelDiABlock(engine, 'diagram flowchart { broken {{{ }');
    expect(html).toContain('seldia-error');
    expect(html).toContain('Compilation Error');
  });

  // The host cannot find the document to edit by looking at the active editor —
  // there isn't one while the preview has focus. It relies entirely on the doc
  // uri travelling with each deep link, so pin that here.
  it('addresses the extension over vscode:// and never command:', () => {
    const html = renderSelDiABlock(engine, SRC, 'file:///w/demo.md');
    expect(html).toContain('href="vscode://seldia.seldia-vscode/');
    expect(html).not.toContain('command:');
  });

  it('carries the source document uri on the container and in every deep link', () => {
    const html = renderSelDiABlock(engine, SRC, 'file:///w/demo.md');
    expect(html).toContain('data-seldia-doc="file:///w/demo.md"');
    for (const href of html.match(/href="vscode:\/\/[^"]+"/g) ?? []) {
      expect(href).toContain('doc=file%3A%2F%2F%2Fw%2Fdemo.md');
    }
  });

  it('omits the doc param entirely when the render env has no document', () => {
    const html = renderSelDiABlock(engine, SRC);
    for (const href of html.match(/href="vscode:\/\/[^"]+"/g) ?? []) {
      expect(href).not.toMatch(/[?&]doc=/);
    }
  });
});

// The engine positioning lives or dies on this path: a user's existing
// ```mermaid block, untouched, rendered by SelDiA — and never made worse than
// if SelDiA weren't installed.
describe('renderMermaidBlock', () => {
  const MMD = 'flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|Yes| C[Done]';

  it('renders a Mermaid block through the SelDiA engine', () => {
    const html = renderMermaidBlock(engine, MMD)!;
    expect(html).toContain('class="seldia-diagram"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('seldia-error');
  });

  it('labels the block as Mermaid-sourced', () => {
    const html = renderMermaidBlock(engine, MMD)!;
    expect(html).toContain('data-seldia-source-format="mermaid"');
    expect(html).toContain('Mermaid Source');
    expect(html).toContain('class="language-mermaid"');
  });

  it('keeps the original Mermaid source verbatim in code mode', () => {
    const html = renderMermaidBlock(engine, MMD)!;
    // Escaped for HTML, but otherwise untouched — we render their source, we
    // don't rewrite it into SelDiA DSL behind their back.
    expect(html).toContain('A[Start] --&gt; B{Ok?}');
  });

  it('declines unsupported diagram types so the default fence can have them', () => {
    // `journey` is deliberately unsupported (no DiagramType.JOURNEY, no
    // renderer) — see next_steps.md. pie/gantt used to sit here too, but both
    // importers shipped in the second wave and now render for real.
    expect(renderMermaidBlock(engine, 'journey\n  title My day\n  section Go to work\n    Make tea: 5: Me')).toBeNull();
    expect(renderMermaidBlock(engine, 'quadrantChart\n  title Reach\n  A: [0.3, 0.6]')).toBeNull();
  });

  it('declines garbage rather than showing an error box in a Mermaid document', () => {
    expect(renderMermaidBlock(engine, 'not a diagram at all')).toBeNull();
    expect(renderMermaidBlock(engine, '')).toBeNull();
  });

  it('attaches importer notes without turning the block into an error', () => {
    // A junk line inside an otherwise-valid sequence diagram: the importer
    // notes what it skipped but still returns a diagram, so the block renders
    // with notes attached rather than falling back. (The old fixture used a
    // flowchart subgraph, which imports cleanly now that subgraphs are
    // supported and so no longer produces any note.)
    const html = renderMermaidBlock(engine, 'sequenceDiagram\n  A->>B: hi\n  %%!! junk line !!\n  ???garbage???')!;
    expect(html).toContain('data-seldia-notes=');
    expect(html).not.toContain('seldia-error');
  });

  it('gives the block a source-derived id, like a SelDiA block', () => {
    const html = renderMermaidBlock(engine, MMD)!;
    expect(html).toContain(`data-seldia-block="${blockIdForSource(MMD)}"`);
  });
});

describe('createSelDiAMarkdownItPlugin (fence rule)', () => {
  function makeMd() {
    const md: any = { renderer: { rules: {} } };
    return md;
  }

  it('intercepts ```seldia fences and passes others through', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine)(md);
    const seldiaTokens = [{ info: 'seldia', content: SRC }];
    const jsTokens = [{ info: 'js', content: 'const a = 1;' }];
    const seldiaOut = md.renderer.rules.fence(seldiaTokens, 0, {}, {}, {});
    const jsOut = md.renderer.rules.fence(jsTokens, 0, {}, {}, {});
    expect(seldiaOut).toContain('seldia-diagram');
    expect(seldiaOut).toContain('<svg');
    expect(jsOut).not.toContain('seldia-diagram');
    expect(jsOut).toContain('const a = 1;');
  });

  // VS Code's Markdown engine renders with an env of
  // `{ containingImages, currentDocument: <Uri>, resourceProvider }` — the fence
  // rule must pull the document uri out of it (a Uri object, not a string).
  it('picks the document uri out of the markdown render env', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine)(md);
    const env = {
      containingImages: new Set(),
      currentDocument: { toString: () => 'file:///w/demo.md' },
    };
    const out = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    expect(out).toContain('data-seldia-doc="file:///w/demo.md"');
  });

  it('intercepts ```mermaid fences and renders them through the engine', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine)(md);
    const out = md.renderer.rules.fence(
      [{ info: 'mermaid', content: 'flowchart LR\n  a --> b' }],
      0, {}, {}, {}
    );
    expect(out).toContain('seldia-diagram');
    expect(out).toContain('<svg');
    expect(out).toContain('data-seldia-source-format="mermaid"');
  });

  // The safety property that makes shipping this defensible: for Mermaid we
  // can't render, the block must come out exactly as it would have without
  // SelDiA installed — a plain code fence, not a SelDiA error box.
  it('falls back to the default fence for Mermaid it cannot import', () => {
    const md = makeMd();
    const fallback = vi.fn(() => '<pre><code>original</code></pre>');
    md.renderer.rules.fence = fallback;
    createSelDiAMarkdownItPlugin(engine)(md);
    // `journey` has no importer/renderer by design (see next_steps.md), so it
    // exercises the fallback. pie imports for real now.
    const tokens = [{ info: 'mermaid', content: 'journey\n  title My day\n  section Go to work\n    Make tea: 5: Me' }];
    const out = md.renderer.rules.fence(tokens, 0, {}, {}, {});
    expect(fallback).toHaveBeenCalled();
    expect(out).toBe('<pre><code>original</code></pre>');
    expect(out).not.toContain('seldia-error');
  });
});
