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

  // revealSource is one-shot navigation, and editBlockVisually only opens the
  // block in the custom editor's own owned webview (never edits in place
  // through this channel) — those are the only two actions the preview may
  // invoke; anything that mutates the document directly must not be reachable
  // from here.
  it('deep-links to revealSource and editBlockVisually only', () => {
    const html = renderSelDiABlock(engine, SRC, 'file:///w/demo.md');
    const actions = [...html.matchAll(/href="vscode:\/\/seldia\.seldia-vscode\/(\w+)/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions)).toEqual(new Set(['revealSource', 'editBlockVisually']));
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

  it('numbers diagrams in document order via a shared env counter', () => {
    const env: any = {};
    const first = renderSelDiABlock(engine, SRC, '', true, env);
    const second = renderSelDiABlock(engine, SRC, '', true, env);
    expect(first).toContain('id="diagram-1"');
    expect(first).toContain('data-seldia-number="1"');
    expect(second).toContain('id="diagram-2"');
    expect(second).toContain('data-seldia-number="2"');
  });

  it('captions with the declared DSL title', () => {
    const env: any = {};
    const html = renderSelDiABlock(engine, SRC, '', true, env);
    expect(html).toContain('seldia-caption-label">Diagram 1</span>');
    expect(html).toContain('seldia-caption-title">T</span>');
    expect(html).toContain('data-seldia-title="T"');
  });

  it('numbers a compile-error block instead of skipping it', () => {
    const env: any = {};
    const html = renderSelDiABlock(engine, 'diagram flowchart { broken {{{ }', '', true, env);
    expect(html).toContain('data-seldia-error="1"');
    expect(html).toContain('data-seldia-number="1"');
    expect(html).toContain('id="diagram-1"');
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
    // renderer). pie/gantt used to sit here too, but both
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
    const rules: Array<(state: { src: string; env: any }) => void> = [];
    const md: any = {
      renderer: { rules: {} },
      core: { ruler: { before: (_anchor: string, _name: string, fn: (state: any) => void) => rules.push(fn) } },
    };
    // Mimics markdown-it's real core.ruler pipeline for tests: normally
    // `md.render(src, env)` runs every registered core rule against a shared
    // state before the fence renderer ever fires. Tests call the fence rule
    // directly, so this replays that step against the raw source, letting
    // front-matter-derived `env` state (see frontmatter.ts) reach the rule
    // exactly as it would in the real preview.
    md.__runCoreRules = (src: string, env: any) => rules.forEach((fn) => fn({ src, env }));
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

  it('suppresses captions when front-matter sets seldia_captions: false', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine, { captionsEnabled: true })(md);
    const src = '---\nseldia_captions: false\n---\n\n```seldia\n' + SRC + '\n```\n';
    const env: any = {};
    md.__runCoreRules(src, env);
    const out = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    expect(out).not.toContain('seldia-caption-label');
  });

  it('renders captions when front-matter omits the override', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine, { captionsEnabled: true })(md);
    const src = '```seldia\n' + SRC + '\n```\n';
    const env: any = {};
    md.__runCoreRules(src, env);
    const out = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    expect(out).toContain('seldia-caption-label');
  });

  it('front-matter seldia_toc: false flips the toc marker off even when the workspace setting is on', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine, { tocEnabled: true })(md);
    const src = '---\nseldia_toc: false\n---\n\n```seldia\n' + SRC + '\n```\n';
    const env: any = {};
    md.__runCoreRules(src, env);
    const out = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    expect(out).toContain('data-seldia-toc-enabled="0"');
  });

  it('front-matter seldia_toc: true flips the toc marker on even when the workspace setting is off', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine, { tocEnabled: false })(md);
    const src = '---\nseldia_toc: true\n---\n\n```seldia\n' + SRC + '\n```\n';
    const env: any = {};
    md.__runCoreRules(src, env);
    const out = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    expect(out).toContain('data-seldia-toc-enabled="1"');
  });

  it('shares one diagram counter across seldia and mermaid fences', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine)(md);
    const env: any = {};
    const first = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    const second = md.renderer.rules.fence(
      [{ info: 'mermaid', content: 'flowchart TD\n  A[Start] --> B{Ok?}' }],
      0,
      {},
      env,
      {}
    );
    expect(first).toContain('data-seldia-number="1"');
    expect(second).toContain('data-seldia-number="2"');
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

  it('intercepts ```plantuml fences and renders them through the engine', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine)(md);
    const out = md.renderer.rules.fence(
      [{ info: 'plantuml', content: '@startuml\nAlice -> Bob: hello\n@enduml' }],
      0, {}, {}, {}
    );
    expect(out).toContain('seldia-diagram');
    expect(out).toContain('<svg');
    expect(out).toContain('data-seldia-source-format="plantuml"');
  });

  it('falls back to the default fence for PlantUML it cannot import', () => {
    const md = makeMd();
    const fallback = vi.fn(() => '<pre><code>original</code></pre>');
    md.renderer.rules.fence = fallback;
    createSelDiAMarkdownItPlugin(engine)(md);
    // @startjson is a real PlantUML block with no diagram IR by design, so it
    // exercises the same degrade-to-plain-fence contract as Mermaid's journey.
    const tokens = [{ info: 'puml', content: '@startjson\n{ "a": 1 }\n@endjson' }];
    const out = md.renderer.rules.fence(tokens, 0, {}, {}, {});
    expect(fallback).toHaveBeenCalled();
    expect(out).toBe('<pre><code>original</code></pre>');
    expect(out).not.toContain('seldia-error');
  });

  // The safety property that makes shipping this defensible: for Mermaid we
  // can't render, the block must come out exactly as it would have without
  // SelDiA installed — a plain code fence, not a SelDiA error box.
  it('falls back to the default fence for Mermaid it cannot import', () => {
    const md = makeMd();
    const fallback = vi.fn(() => '<pre><code>original</code></pre>');
    md.renderer.rules.fence = fallback;
    createSelDiAMarkdownItPlugin(engine)(md);
    // `journey` has no importer/renderer by design, so it
    // exercises the fallback. pie imports for real now.
    const tokens = [{ info: 'mermaid', content: 'journey\n  title My day\n  section Go to work\n    Make tea: 5: Me' }];
    const out = md.renderer.rules.fence(tokens, 0, {}, {}, {});
    expect(fallback).toHaveBeenCalled();
    expect(out).toBe('<pre><code>original</code></pre>');
    expect(out).not.toContain('seldia-error');
  });

  // ICON_SPRITE declares `id="seldia-icon-*"` symbols; duplicate ids across
  // several diagram blocks in the same document are invalid HTML and pure
  // payload bloat. markdown-it renders every fence in a document with the
  // SAME env object, so it doubles as the once-per-document flag.
  it('emits ICON_SPRITE only once across multiple blocks sharing one env', () => {
    const md = makeMd();
    createSelDiAMarkdownItPlugin(engine)(md);
    const env: any = {};
    const out1 = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    const out2 = md.renderer.rules.fence([{ info: 'seldia', content: SRC }], 0, {}, env, {});
    const combined = out1 + out2;
    const matches = combined.match(/id="seldia-icon-visibility"/g) || [];
    expect(matches.length).toBe(1);
  });
});

describe('gallery fences through the preview fence rule', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { fileURLToPath } = require('node:url') as typeof import('node:url');
  const doc = (n: string) => readFileSync(fileURLToPath(new URL(`../../../docs/examples/${n}`, import.meta.url)), 'utf8');
  const fences = (n: string) => [...doc(n).matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => ({ info: m[1], content: m[2] }));
  const rule = () => {
    const md: any = { renderer: { rules: {} }, core: { ruler: { before: () => {} } } };
    createSelDiAMarkdownItPlugin(engine)(md);
    return md.renderer.rules.fence as (t: any[], i: number, o: any, e: any, s: any) => string;
  };

  for (const file of ['demo-circuits.md', 'demo-basic.md']) {
    it(`${file}: every seldia/spice fence renders an svg with no error box`, () => {
      const fence = rule();
      const fs = fences(file).filter((f) => f.info === 'seldia' || f.info === 'spice' || f.info === 'circuit');
      expect(fs.length).toBeGreaterThan(0);
      for (const f of fs) {
        const out = fence([f], 0, {}, {}, {});
        expect(out, f.content.slice(0, 40)).toContain('<svg');
        expect(out, f.content.slice(0, 40)).not.toContain('seldia-error');
      }
    });
  }

  it('a ```spice fence renders through the importer', () => {
    const out = rule()([{ info: 'spice', content: 'rc\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n' }], 0, {}, {}, {});
    expect(out).toContain('<svg');
  });

  it('grouped flowchart and state diagram compile synchronously with ELK', () => {
    const mer = engine.compileIRSync;
    expect(typeof mer).toBe('function');
    const fl = rule()([{ info: 'mermaid', content: 'flowchart TD\n subgraph G\n a-->b\n end\n b-->c' }], 0, {}, {}, {});
    const st = rule()([{ info: 'mermaid', content: 'stateDiagram-v2\n [*] --> A\n A --> B\n B --> [*]' }], 0, {}, {}, {});
    for (const o of [fl, st]) { expect(o).toContain('<svg'); expect(o).not.toContain('seldia-error'); }
  });
});

describe('preview dispatches on core fenceToSource (S6)', () => {
  const rule = () => {
    const md: any = { renderer: { rules: {} }, core: { ruler: { before: () => {} } } };
    createSelDiAMarkdownItPlugin(engine)(md);
    return md.renderer.rules.fence as (t: any[], i: number, o: any, e: any, s: any) => string;
  };
  const BODY: Record<string, string> = {
    seldia: SRC,
    mermaid: 'flowchart TD\n a-->b',
    plantuml: '@startuml\nAlice -> Bob: hi\n@enduml',
    circuit: 'rc\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n',
  };
  const SPELLINGS: Array<[string, string, keyof typeof BODY]> = [
    ['seldia', 'seldia', 'seldia'], ['mermaid', 'mermaid', 'mermaid'],
    ['plantuml', 'plantuml', 'plantuml'], ['puml', 'plantuml', 'plantuml'], ['uml', 'plantuml', 'plantuml'],
    ['spice', 'circuit', 'circuit'], ['circuit', 'circuit', 'circuit'], ['netlist', 'circuit', 'circuit'],
  ];
  for (const [lang, kind, body] of SPELLINGS) {
    it(`\`\`\`${lang} is kind ${kind} in core and renders in the preview`, async () => {
      const { fenceToSource } = await import('@seldia/core');
      expect(fenceToSource(lang, BODY[body])?.kind).toBe(kind);
      expect(rule()([{ info: lang, content: BODY[body] }], 0, {}, {}, {})).toContain('<svg');
    });
  }
  it('a language core does not know stays a plain code block', async () => {
    const { fenceToSource } = await import('@seldia/core');
    expect(fenceToSource('js', 'x')).toBeNull();
    expect(rule()([{ info: 'js', content: 'x' }], 0, {}, {}, {})).not.toContain('<svg');
  });
});
