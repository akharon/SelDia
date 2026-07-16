// =============================================================================
// SelDiA — Markdown-It Plugin for VS Code Markdown Preview
// =============================================================================
// This plugin runs in the extension host. It is invoked via extendMarkdownIt
// to hook into VS Code's built-in Markdown preview.
//
// It intercepts ```seldia fenced code blocks and replaces them with a
// pre-rendered SVG diagram inside a styled container that supports two modes:
//   • Preview (default) — the rendered diagram
//   • Code               — the source, read-only
//
// It also intercepts ```mermaid fences and renders them through the same
// engine via the Mermaid importer, which is the product position made
// concrete: your existing Mermaid, unmodified, drawn by SelDiA. That path
// degrades to the default fence whenever the importer can't model the source,
// so installing SelDiA can never make a Mermaid document render worse than it
// did before.
//
// The preview is a read-only surface: layout is always automatic, and the DSL
// is edited in the raw file (the "open in editor" link jumps there). Visual
// editing lives in the custom editor, whose webview we own; the built-in
// preview offers no channel that can carry edits back reliably — see
// edit/commands.ts.
//
// The container carries a stable per-block id (hash of the DSL source) so the
// preview script and the extension host can correlate a rendered block with the
// exact ```seldia fence in the underlying document.
// =============================================================================

import type { CoreEngine } from '@seldia/core';
import { importMermaid } from '@seldia/core';
import { ICON_SPRITE, icon } from '../shared/icons.js';
import { blockIdForSource } from '../edit/blocks.js';

// Minimal MarkdownIt interface — matches what VS Code passes to extendMarkdownIt
export interface MarkdownIt {
  renderer: {
    rules: {
      fence?: (tokens: any[], idx: number, options: any, env: any, slf: any) => string;
    };
  };
}

/** Stable id for a block, derived from its DSL source. Re-exported from the
 *  host's block module rather than reimplemented: two copies of this hash
 *  silently disagreed on trailing whitespace once already, which broke every
 *  deep link the preview emitted. One implementation, one id. */
export { blockIdForSource };

export function createSelDiAMarkdownItPlugin(engine: CoreEngine) {
  return function seldiaPlugin(md: MarkdownIt) {
    const defaultFence =
      md.renderer.rules.fence ||
      ((tokens: any[], idx: number): string => {
        const token = tokens[idx];
        const lang = token.info?.trim().split(/\s+/)[0] || '';
        const code = token.content || '';
        return `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`;
      });

    md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
      const token = tokens[idx];
      const lang = token.info?.trim().split(/\s+/)[0] || '';

      if (lang === 'seldia' || lang.startsWith('seldia-')) {
        try {
          return renderSelDiABlock(engine, token.content, docUriOf(env));
        } catch (err: any) {
          // A single block must never take down the whole preview — render
          // an inline error box for this block only and let every other
          // block (and surrounding Markdown) keep rendering.
          return renderFatalErrorBlock(token.content, err?.message || String(err));
        }
      }

      // ```mermaid blocks render through SelDiA's engine too — this is the
      // engine positioning at its most literal: the user's existing Mermaid,
      // unmodified, drawn by us. Anything the importer can't model falls back
      // to the default fence so VS Code's own Mermaid support (or a plain code
      // block) still handles it. Never worse than not being installed.
      if (lang === 'mermaid') {
        try {
          const rendered = renderMermaidBlock(engine, token.content, docUriOf(env));
          if (rendered) return rendered;
        } catch {
          /* fall through to the default fence */
        }
      }

      return defaultFence(tokens, idx, options, env, slf);
    };

    return md;
  };
}

/** The Uri of the Markdown document currently being rendered, as a string.
 *
 *  VS Code's Markdown engine builds its render env as
 *  `{ containingImages, currentDocument: <source doc Uri>, resourceProvider }`
 *  and passes it to every renderer rule, so a fence rule can always tell which
 *  file it is rendering. Stamping that into the block's deep links is what lets
 *  the edit commands open the right document instead of guessing from whatever
 *  editor happens to be focused (there is none when the preview has focus).
 *  Defensive: returns '' if the env shape ever changes, and the host then falls
 *  back to scanning open Markdown documents. */
function docUriOf(env: any): string {
  const d = env?.currentDocument;
  if (!d) return '';
  try {
    return typeof d === 'string' ? d : String(d.toString());
  } catch {
    return '';
  }
}

/** Render a single ```seldia block to the interactive preview container HTML.
 *  Exported so it can be unit-tested without a MarkdownIt instance. */
export function renderSelDiABlock(engine: CoreEngine, code: string, docUri = ''): string {
  const blockId = blockIdForSource(code);
  // Synchronous compile — the markdown-it fence renderer cannot await.
  const result = engine.compileSync(code);

  if (!result.ok) {
    const errors = result.errors.map((e: any) => e.message).join('\n');
    return `
${ICON_SPRITE}
<div class="seldia-diagram seldia-error" id="${blockId}" data-seldia-block="${escapeAttr(blockId)}">
  <div class="seldia-diagram-toolbar">
    <span class="seldia-diagram-badge">${icon('error')} SelDiA Error</span>
    <span class="seldia-toolbar-spacer"></span>
    <a class="seldia-btn seldia-btn-icon" title="Reveal DSL source to fix errors" aria-label="Reveal DSL source to fix errors" href="${deepLink('revealSource', { blockId, doc: docUri })}">${icon('edit')}</a>
  </div>
  <div class="seldia-error-header">Compilation Error</div>
  <pre class="seldia-error-detail">${escapeHtml(errors)}</pre>
  <div class="seldia-diagram-source">
    <pre><code class="language-seldia">${escapeHtml(code)}</code></pre>
  </div>
</div>`;
  }

  const svg = result.value.svg;

  return `
${ICON_SPRITE}
<div class="seldia-diagram" id="${blockId}" data-seldia-block="${escapeAttr(blockId)}" data-seldia-doc="${escapeAttr(docUri)}" data-seldia-mode="preview">
  <div class="seldia-diagram-toolbar">
    <span class="seldia-mode-switch" role="tablist">
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="preview" title="Show rendered diagram" aria-label="Show rendered diagram">${icon('visibility')}</button>
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="code" title="Show DSL source" aria-label="Show DSL source">${icon('code')}</button>
    </span>
    <span class="seldia-toolbar-spacer"></span>
    <button class="seldia-btn seldia-btn-icon seldia-btn-zoom-in" title="Zoom In" aria-label="Zoom in">${icon('zoom-in')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-zoom-out" title="Zoom Out" aria-label="Zoom out">${icon('zoom-out')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-reset" title="Reset Zoom" aria-label="Reset zoom">${icon('reset')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-export" title="Export SVG" aria-label="Export SVG">${icon('download')}</button>
  </div>
  <div class="seldia-diagram-svg">
    ${svg}
  </div>
  <div class="seldia-diagram-source">
    <div class="seldia-diagram-source-header">
      <span>SelDiA DSL Source</span>
      <span class="seldia-toolbar-spacer"></span>
      <a class="seldia-btn seldia-btn-icon" title="Open this block in the editor to edit it" aria-label="Open in editor" href="${deepLink('revealSource', { blockId, doc: docUri })}">${icon('open-in-editor')}</a>
      <button class="seldia-btn seldia-btn-icon seldia-btn-copy-source" title="Copy source to clipboard" aria-label="Copy source to clipboard">${icon('copy')}${icon('check', 'seldia-icon-copied')}</button>
    </div>
    <pre class="seldia-source-view"><code class="language-seldia">${escapeHtml(code)}</code></pre>
  </div>
</div>`;
}

/** Render a ```mermaid block through SelDiA's engine.
 *
 *  Returns `null` — meaning "not ours, let the default fence have it" — when
 *  the importer can't model the source. That covers unsupported diagram types
 *  (pie, gantt, gitGraph…) and any structural failure. This asymmetry is
 *  deliberate: for SelDiA's own blocks a compile error is worth showing loudly,
 *  because the author asked for SelDiA. A Mermaid author did not, so a block we
 *  can't render must degrade to whatever would have happened without us
 *  installed, never to a SelDiA error box in someone else's document.
 *
 *  Diagnostics from a *partial* success are attached to the container rather
 *  than shown, so the engine can report what it approximated without pushing an
 *  error surface into a document that renders fine.
 */
export function renderMermaidBlock(engine: CoreEngine, code: string, docUri = ''): string | null {
  const { ir, diagnostics } = importMermaid(code);
  if (!ir) return null;

  const result = engine.compileIRSync(ir);
  if (!result.ok) return null;

  const blockId = blockIdForSource(code);
  const svg = result.value.svg;
  const notes = diagnostics.map((d) => `L${d.line}: ${d.message}`).join('\n');

  return `
${ICON_SPRITE}
<div class="seldia-diagram" id="${blockId}" data-seldia-block="${escapeAttr(blockId)}" data-seldia-doc="${escapeAttr(docUri)}" data-seldia-mode="preview" data-seldia-source-format="mermaid"${notes ? ` data-seldia-notes="${escapeAttr(notes)}"` : ''}>
  <div class="seldia-diagram-toolbar">
    <span class="seldia-mode-switch" role="tablist">
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="preview" title="Show rendered diagram" aria-label="Show rendered diagram">${icon('visibility')}</button>
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="code" title="Show Mermaid source" aria-label="Show Mermaid source">${icon('code')}</button>
    </span>
    <span class="seldia-diagram-badge seldia-badge-format" title="Mermaid source, rendered by SelDiA">mermaid</span>
    <span class="seldia-toolbar-spacer"></span>
    <button class="seldia-btn seldia-btn-icon seldia-btn-zoom-in" title="Zoom In" aria-label="Zoom in">${icon('zoom-in')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-zoom-out" title="Zoom Out" aria-label="Zoom out">${icon('zoom-out')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-reset" title="Reset Zoom" aria-label="Reset zoom">${icon('reset')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-export" title="Export SVG" aria-label="Export SVG">${icon('download')}</button>
  </div>
  <div class="seldia-diagram-svg">
    ${svg}
  </div>
  <div class="seldia-diagram-source">
    <div class="seldia-diagram-source-header">
      <span>Mermaid Source</span>
      <span class="seldia-toolbar-spacer"></span>
      <a class="seldia-btn seldia-btn-icon" title="Open this block in the editor to edit it" aria-label="Open in editor" href="${deepLink('revealSource', { blockId, doc: docUri })}">${icon('open-in-editor')}</a>
      <button class="seldia-btn seldia-btn-icon seldia-btn-copy-source" title="Copy source to clipboard" aria-label="Copy source to clipboard">${icon('copy')}${icon('check', 'seldia-icon-copied')}</button>
    </div>
    <pre class="seldia-source-view"><code class="language-mermaid">${escapeHtml(code)}</code></pre>
  </div>
</div>`;
}

/** Fallback error box for exceptions thrown outside the normal `result.ok`
 *  path (e.g. a bug in the renderer itself). Kept structurally identical to
 *  the `result.ok === false` error box so both are covered by the same
 *  visual/CSS contract, and deliberately has no block id so it can never
 *  collide with the id-keyed preview-side state of a working block. */
function renderFatalErrorBlock(code: string, message: string): string {
  return `
${ICON_SPRITE}
<div class="seldia-diagram seldia-error">
  <div class="seldia-diagram-toolbar">
    <span class="seldia-diagram-badge">${icon('error')} SelDiA Error</span>
  </div>
  <div class="seldia-error-header">Rendering Error</div>
  <pre class="seldia-error-detail">${escapeHtml(message)}</pre>
  <div class="seldia-diagram-source">
    <pre><code class="language-seldia">${escapeHtml(code)}</code></pre>
  </div>
</div>`;
}

// ── Utilities ────────────────────────────────────────────────────────────
// The extension id (publisher.name) used to address this extension's registered
// UriHandler from inside the built-in Markdown preview.
const EXTENSION_ID = 'seldia.seldia-vscode';

/** Build a `vscode://<extension-id>/<action>?<query>` deep link for a toolbar
 *  anchor. MUST be used instead of a `command:` URI: the built-in Markdown
 *  preview never sets `enableCommandUris`, so VS Code silently discards
 *  `command:` links clicked inside it, whereas `vscode:` is on the webview's
 *  supported-scheme list and is routed to our UriHandler without navigating the
 *  webview. See edit/commands.ts `registerEditUriHandler` for the full
 *  derivation. Empty params are dropped so a missing doc uri doesn't turn into
 *  a literal "undefined". */
function deepLink(action: string, params: Record<string, string>): string {
  const present = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  const q = new URLSearchParams(present).toString();
  return `vscode://${EXTENSION_ID}/${action}${q ? `?${q}` : ''}`;
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
