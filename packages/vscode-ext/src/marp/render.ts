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

import { Direction, fenceToSource, type CoreEngine } from '@seldia/core';
import { renderSelDiABlock, renderMermaidBlock, renderPlantUmlBlock } from '../markdown-preview/plugin.js';

/** Pull the diagram's own bounds out of the SVG `viewBox` a render call just
 *  produced. There's no bounds-returning API on the shared render helpers
 *  (they're also the regular Markdown preview's renderer, so their return
 *  type can't grow a Marp-only field) — the viewBox is the one place layout
 *  size survives into the HTML string those helpers hand back. */
function viewBoxSize(html: string): { w: number; h: number } | null {
  // The rendered block also carries the once-per-document icon sprite, whose
  // <symbol> defs each have their own tiny viewBox (e.g. "0 0 24 24") ahead of
  // the actual diagram markup — matching the first viewBox in the whole
  // string picks up an icon, not the diagram, and (being roughly square)
  // reads as "not tall", silently defeating this whole check. The diagram's
  // own <svg> is the one tagged seldia-diagram-svg-el, so anchor there.
  const m = html.match(/class="seldia-diagram-svg-el[^"]*"[^>]*viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Slides are landscape (1280x720-ish), so a diagram that is itself taller
 *  than it is wide is the one shape that fights the slide instead of fitting
 *  it — dagre's default top-to-bottom layout draws it as a narrow column that
 *  wastes almost all the slide's width (see [[marp-diagram-fit]]). Re-running
 *  the same diagram left-to-right turns that column into a row, trading the
 *  slide's abundant width for its scarce height. A diagram that is already
 *  wide (fat) has no such problem — forcing it to LR as well would just make
 *  an already-wide diagram wider for no benefit, so only portrait-oriented
 *  results get the swap. */
function isTall(size: { w: number; h: number }): boolean {
  return size.h > size.w;
}

/** Render with `renderFn`, forcing left-to-right layout only if the diagram
 *  would otherwise come out portrait-shaped and forcing LR actually fixes
 *  that. Uses `engine.config.layout.forceDirection`, not `.direction`: most
 *  SelDiA diagram *types* declare their own default direction (a sequence
 *  diagram is TB, a timeline is LR, …) and that type default wins over plain
 *  `.direction` in `resolvedLayoutOptions` — so setting `.direction` here
 *  would silently do nothing for the majority of diagram types. Only
 *  `forceDirection` overrides the type default too, which is the whole point
 *  for a diagram whose *type* default drew it portrait-shaped on a landscape
 *  slide. `forceDirection` is mutated only for the probe/final calls in this
 *  function and always restored in a `finally`, immediately, since rendering
 *  is synchronous — it never leaks into the regular Markdown preview or
 *  another block's render sharing the same engine.
 *
 *  `renderFn` takes the `env` to render with, not a plain thunk: the shared
 *  render helpers stamp document-order diagram numbering and a TOC-entry
 *  list onto `env` as a side effect of being called. Deciding the direction
 *  needs up to two throwaway renders (normal, then forced-LR) purely to read
 *  their SVG dimensions — calling `renderFn` against the *real* env for those
 *  would burn a diagram number and register a duplicate TOC entry for HTML
 *  that gets discarded. Every probe therefore renders into a fresh shallow
 *  clone of `env`, and the real `env` is only ever passed to the one final
 *  render whose HTML is actually kept. */
function renderPreferringLandscape(
  engine: CoreEngine,
  env: any,
  renderFn: (env: any) => string | null,
): string | null {
  const cloneEnv = () => (env && typeof env === 'object' ? { ...env } : env);
  const renderWithForce = (forceDirection: Direction | undefined, targetEnv: any): string | null => {
    const previous = engine.config.layout.forceDirection;
    engine.config.layout.forceDirection = forceDirection;
    try {
      return renderFn(targetEnv);
    } finally {
      engine.config.layout.forceDirection = previous;
    }
  };

  const normalProbe = renderWithForce(undefined, cloneEnv());
  if (normalProbe === null) return null;
  const normalSize = viewBoxSize(normalProbe);
  if (!normalSize || !isTall(normalSize)) return renderWithForce(undefined, env);

  const landscapeProbe = renderWithForce(Direction.LEFT_TO_RIGHT, cloneEnv());
  const landscapeSize = landscapeProbe && viewBoxSize(landscapeProbe);
  // Only switch if forcing LR actually produced a wider-than-tall result —
  // some topologies (a single long chain, a deeply nested tree) stay tall
  // either way, and the original direction is no worse a fallback than a
  // forced attempt that didn't help.
  const useUnchanged = !landscapeSize || isTall(landscapeSize);
  return renderWithForce(useUnchanged ? undefined : Direction.LEFT_TO_RIGHT, env);
}

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

    const kind = lang.startsWith('seldia-') ? 'seldia' : fenceToSource(lang, token.content)?.kind;
    if (kind === 'seldia') {
      return renderPreferringLandscape(engine, env, (e) => renderSelDiABlock(engine, token.content, '', true, e));
    }
    if (kind === 'mermaid') {
      return renderPreferringLandscape(engine, env, (e) => renderMermaidBlock(engine, token.content, '', true, e));
    }
    if (kind === 'plantuml') {
      return renderPreferringLandscape(engine, env, (e) => renderPlantUmlBlock(engine, token.content, '', true, e));
    }

    return defaultFence
      ? defaultFence(tokens, idx, options, env, slf)
      : `<pre><code>${escapeHtml(token.content)}</code></pre>`;
  };

  const { html: rawHtml, css, comments } = marp.render(markdown);
  const html = rawHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // Marp always wraps the whole deck in one outer <div class="marpit">, so
  // top-level slides are its direct <section> children, not every <section>
  // in the document (diagram SVGs or user HTML can contain their own nested
  // <section>-like markup that a raw regex count would double-count).
  const slideCount = comments ? comments.length : (html.match(/<section\b/g) || []).length;
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

// Marp's <section> is a fixed-size (from the deck's @page size), padded,
// overflow:hidden block box. The preview's own diagram CSS (seldia-preview.css)
// only ever *caps* an SVG at its container's width via max-width — it never
// grows a small diagram to fill available room, because in the normal
// Markdown preview column that's the right call (a small flowchart should
// stay small, not balloon to column width). On a slide that logic backfires:
// diagrams are typically drawn at a few hundred px while a slide is
// 1280x720, so a "small" diagram renders as a tiny island in a sea of empty
// slide. Slides want the opposite default — scale the diagram to *fill* the
// space left after other slide content, in both directions, like
// object-fit:contain on a sized box.
//
// This measures the real remaining space after layout (percentages can't:
// they resolve against the section's own box, not the room actually left
// after prior siblings like a heading) and gives the *container* — not the
// svg — a definite pixel height. Paired with `width/height:100%;
// object-fit:contain` on the svg (see the CSS below and preview-panel.ts),
// that lets the diagram scale up to fill the box, not just shrink to avoid
// overflowing it. Exported once so both the headless-export document and the
// live preview panel (see preview-panel.ts's fit()) apply the identical fit
// logic.
export const SHRINK_DIAGRAMS_TO_FIT_JS = `
function shrinkDiagramsToFit(root) {
  (root || document).querySelectorAll('.seldia-diagram-svg').forEach(function (box) {
    var section = box.closest('section');
    var svg = box.querySelector('svg');
    if (!section || !svg) return;
    // Measure in the section's own *layout* coordinate space, never with
    // getBoundingClientRect(): the live preview panel scales the whole slide
    // with a CSS transform to fit the panel, and getBoundingClientRect()
    // reports post-transform (screen) pixels. Writing such a value back as a
    // plain CSS height — which is interpreted in the untransformed 1280x720
    // slide space, then scaled again for display — shrinks the diagram by the
    // scale factor twice over, so in a small panel a diagram collapses to a
    // few dozen pixels. offsetTop/offsetHeight are unaffected by transforms.
    var offsetTopInSection = 0;
    for (var node = box; node && node !== section; node = node.offsetParent) {
      offsetTopInSection += node.offsetTop;
    }
    var style = getComputedStyle(section);
    var bottomPad = parseFloat(style.paddingBottom) || 0;
    // Anything laid out *after* the diagram box still needs its own room: the
    // caption ("Diagram 3 — Foo") is a sibling below the box, and a slide can
    // continue with more prose after the diagram. Without this the box claims
    // every remaining pixel and pushes that content off the bottom of the
    // slide (section is overflow:hidden, so it silently disappears).
    var trailing = 0;
    for (var node = box; node && node !== section; node = node.parentElement) {
      for (var sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        // Skip out-of-flow siblings: Marp positions the slide's <footer> and
        // page number absolutely, so they occupy no space in the flow below
        // the diagram and must not be deducted from it.
        var sibPos = getComputedStyle(sib).position;
        if (sibPos === 'absolute' || sibPos === 'fixed') continue;
        trailing += sib.offsetHeight || 0;
      }
    }
    // section.clientHeight excludes its border but includes padding, matching
    // the box's offsetTop origin (the section's padding edge).
    var available = section.clientHeight - bottomPad - offsetTopInSection - trailing;
    if (available <= 0) return;
    // A box that's full section width but only just tall enough leaves
    // object-fit:contain free to shrink the SVG on whichever axis doesn't
    // match its native aspect ratio, padding the *other* axis with empty
    // space (see [[marp-diagram-fit]] follow-up: a portrait class diagram in
    // a wide box, or a wide-but-short sequence diagram in a tall box, both
    // read as "tiny diagram, huge margins"). Shrink-wrapping the box itself
    // to the SVG's own aspect ratio — capped by the width/height actually
    // available — removes that slack: contain then has nothing left to
    // letterbox, and the box's own flex centering (justify-content/
    // align-items: center, set in the CSS below) places the tightened box
    // in the middle of the leftover room.
    var availableWidth = box.parentElement ? box.parentElement.clientWidth : box.offsetWidth;
    var vb = (svg.getAttribute('viewBox') || '').trim().split(/\\s+/);
    var ratio = vb.length === 4 ? (parseFloat(vb[2]) / parseFloat(vb[3])) : NaN;
    if (availableWidth > 0 && ratio > 0 && isFinite(ratio)) {
      var w = available * ratio;
      var h = available;
      if (w > availableWidth) { w = availableWidth; h = w / ratio; }
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      box.style.marginLeft = 'auto';
      box.style.marginRight = 'auto';
    } else {
      box.style.height = available + 'px';
    }
  });
}
`;

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
.seldia-diagram { background: transparent; margin: 0; }
.seldia-diagram-source, .seldia-diagram-toolbar { display: none; }
.seldia-diagram-svg { box-sizing: border-box; padding: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.seldia-diagram-svg svg { display: block; width: 100%; height: 100%; max-width: 100%; object-fit: contain; }
</style>
</head>
<body>
${html}
<script>
${SHRINK_DIAGRAMS_TO_FIT_JS}
shrinkDiagramsToFit(document);
</script>
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
