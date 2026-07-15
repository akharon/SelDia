// =============================================================================
// SelDiA VS Code — Markdown-it plugin rendering tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { renderSelDiABlock, blockIdForSource, createSelDiAMarkdownItPlugin } from '../src/markdown-preview/plugin.js';
import { blockIdForSource as editBlockId } from '../src/edit/dsl-edit.js';
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

  it('exposes the three modes and stamps the render padding', () => {
    const html = renderSelDiABlock(engine, SRC);
    expect(html).toContain('data-seldia-target-mode="preview"');
    expect(html).toContain('data-seldia-target-mode="code"');
    expect(html).toContain('data-seldia-target-mode="edit"');
    expect(html).toMatch(/data-seldia-pad="\d+"/);
    expect(html).toContain('data-seldia-mode="preview"');
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
});
