// =============================================================================
// SelDiA — Marp + SelDiA Rendering
// =============================================================================
// Turns a Marp Markdown deck (```marp: true``` front-matter) into a full,
// self-contained HTML document: Marp Core paginates the Markdown into
// `<section>` slides and injects its theme CSS, while SelDiA's fence renderer
// is chained into the *same* markdown-it instance so ```seldia / ```mermaid /
// ```plantuml blocks inside slides render as inline diagrams exactly like they
// do in the regular Markdown preview.
//
// Marp Core owns `renderer.rules.fence` first (its directives/highlighting),
// so SelDiA's rule wraps Marp's: for a seldia/mermaid/plantuml fence it
// renders the diagram itself; for anything else it defers to whatever Marp
// already installed. This is the same "defaultFence" chaining pattern used in
// markdown-preview/plugin.ts, just chained one level deeper.
// =============================================================================

import type { CoreEngine } from '@seldia/core';
import { renderSelDiABlock, renderMermaidBlock, renderPlantUmlBlock } from '../markdown-preview/plugin.js';

export interface MarpRenderResult {
  html: string;
  css: string;
  /** Number of top-level slides in the deck. */
  slideCount: number;
  /** Per-slide speaker notes, from HTML comments (`<!-- note -->`) in the source. */
  notes: string[];
}

/** Render a Marp Markdown source string to HTML + CSS, with SelDiA/Mermaid/
 *  PlantUML fences rendered inline as SVG diagrams. */
export function renderMarpDeck(engine: CoreEngine, markdown: string): MarpRenderResult {
  // Lazy require: marp-core is a heavy, externalized dependency (mathjax,
  // katex, highlight.js) — only pulled in when a document actually opts into
  // Marp, never paid for by plain Markdown or .sld users.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Marp } = require('@marp-team/marp-core');
  const marp = new Marp({ html: true, math: 'katex' });

  const defaultFence = marp.markdown.renderer.rules.fence;
  marp.markdown.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, slf: any) => {
    const token = tokens[idx];
    const lang = token.info?.trim().split(/\s+/)[0] || '';

    if (lang === 'seldia' || lang.startsWith('seldia-')) {
      return renderSelDiABlock(engine, token.content);
    }
    if (lang === 'mermaid') {
      return renderMermaidBlock(engine, token.content);
    }
    if (lang === 'plantuml' || lang === 'puml' || lang === 'uml') {
      return renderPlantUmlBlock(engine, token.content);
    }

    return defaultFence
      ? defaultFence(tokens, idx, options, env, slf)
      : `<pre><code>${escapeHtml(token.content)}</code></pre>`;
  };

  const { html: rawHtml, css, comments } = marp.render(markdown);
  const html = rawHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const slideCount = (html.match(/<section\b/g) || []).length;
  const notes = (comments || []).map((perSlide: string[]) => perSlide.join('\n\n'));

  return { html, css, slideCount, notes };
}

function hashSource(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    h = ((h << 5) - h) + source.charCodeAt(i);
    h = h & h; // Convert to 32-bit
  }
  return Math.abs(h).toString(36);
}

/** Wrap Marp's HTML + CSS fragments into a standalone document, suitable for
 *  a webview or for headless export (PDF/PNG via Puppeteer). */
export function assembleMarpDocument(html: string, css: string, title = 'Marp Slides'): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${css}
.seldia-diagram { background: transparent; }
.seldia-diagram-source, .seldia-diagram-toolbar { display: none; }
.seldia-diagram-svg svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
