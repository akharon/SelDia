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
});
