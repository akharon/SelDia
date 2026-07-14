// =============================================================================
// SelDiA — Markdown-It Plugin for VS Code Markdown Preview
// =============================================================================
// This plugin runs in the extension host. It is invoked via extendMarkdownIt
// to hook into VS Code's built-in Markdown preview.
//
// It intercepts ```seldia fenced code blocks and replaces them with a
// pre-rendered SVG diagram inside a styled container that supports three modes:
//   • Preview (default) — the rendered diagram
//   • Code               — the DSL source
//   • Edit               — drag nodes / double-click to edit (writes back to source)
//
// The container carries a stable per-block id (hash of the DSL source) so the
// preview script and the extension host can correlate a rendered block with the
// exact ```seldia fence in the underlying document.
// =============================================================================

import type { CoreEngine } from '@seldia/core';
import { hasManualPositions } from '../edit/dsl-edit.js';
import { ICON_SPRITE, icon } from '../shared/icons.js';

// Minimal MarkdownIt interface — matches what VS Code passes to extendMarkdownIt
export interface MarkdownIt {
  renderer: {
    rules: {
      fence?: (tokens: any[], idx: number, options: any, env: any, slf: any) => string;
    };
  };
}

/** Stable id for a block, derived from its DSL source. Shared with the
 *  extension host (`blockIdForSource`) so both sides agree on identity. */
export function blockIdForSource(source: string): string {
  return `seldia-${hashCode(source)}`;
}

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
          return renderSelDiABlock(engine, token.content);
        } catch (err: any) {
          // A single block must never take down the whole preview — render
          // an inline error box for this block only and let every other
          // block (and surrounding Markdown) keep rendering.
          return renderFatalErrorBlock(token.content, err?.message || String(err));
        }
      }

      return defaultFence(tokens, idx, options, env, slf);
    };

    return md;
  };
}

/** Render a single ```seldia block to the interactive preview container HTML.
 *  Exported so it can be unit-tested without a MarkdownIt instance. */
export function renderSelDiABlock(engine: CoreEngine, code: string): string {
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
    <a class="seldia-btn seldia-btn-icon" title="Reveal DSL source to fix errors" aria-label="Reveal DSL source to fix errors" href="command:seldia.revealSource?${cmdArgs({ blockId })}">${icon('edit')}</a>
  </div>
  <div class="seldia-error-header">Compilation Error</div>
  <pre class="seldia-error-detail">${escapeHtml(errors)}</pre>
  <div class="seldia-diagram-source">
    <pre><code class="language-seldia">${escapeHtml(code)}</code></pre>
  </div>
</div>`;
  }

  const svg = result.value.svg;
  const pad = engine.config?.render?.padding ?? 20;
  const manual = hasManualPositions(code);

  return `
${ICON_SPRITE}
<div class="seldia-diagram" id="${blockId}" data-seldia-block="${escapeAttr(blockId)}" data-seldia-mode="preview" data-seldia-pad="${pad}" data-seldia-layout="${manual ? 'manual' : 'auto'}">
  <div class="seldia-diagram-toolbar">
    <span class="seldia-mode-switch" role="tablist">
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="preview" title="Show rendered diagram" aria-label="Show rendered diagram">${icon('visibility')}</button>
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="code" title="Show DSL source" aria-label="Show DSL source">${icon('code')}</button>
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="edit" title="Edit diagram: drag nodes, double-click to rename" aria-label="Edit diagram">${icon('edit')}</button>
    </span>
    <span class="seldia-toolbar-spacer"></span>
    <a
      class="seldia-btn seldia-btn-icon seldia-btn-auto-layout${manual ? ' seldia-btn-auto-layout-disabled' : ''}"
      title="${manual
        ? 'Auto layout is off because nodes were moved manually. Click to re-run automatic layout and clear manual positions.'
        : 'Diagram is automatically laid out. Drag a node to switch to manual positioning.'}"
      aria-label="Auto layout"
      href="command:seldia.autoLayout?${cmdArgs({ blockId })}"
    >${manual ? icon('auto-layout-off') : icon('auto-layout-on')}</a>
    <button class="seldia-btn seldia-btn-icon seldia-btn-zoom-in" title="Zoom In" aria-label="Zoom in">${icon('zoom-in')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-zoom-out" title="Zoom Out" aria-label="Zoom out">${icon('zoom-out')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-reset" title="Reset Zoom" aria-label="Reset zoom">${icon('reset')}</button>
    <button class="seldia-btn seldia-btn-icon seldia-btn-export" title="Export SVG" aria-label="Export SVG">${icon('download')}</button>
  </div>
  <div class="seldia-edit-hint">Edit mode: drag a node to move it · double-click a node to rename · changes are written back to the Markdown source.</div>
  <div class="seldia-diagram-svg">
    ${svg}
  </div>
  <div class="seldia-diagram-source">
    <div class="seldia-diagram-source-header">
      <span>SelDiA DSL Source</span>
      <span class="seldia-toolbar-spacer"></span>
      <a class="seldia-btn seldia-btn-icon" title="Reveal this block in the editor" aria-label="Open in editor" href="command:seldia.revealSource?${cmdArgs({ blockId })}">${icon('open-in-editor')}</a>
      <button class="seldia-btn seldia-btn-icon seldia-btn-copy-source" title="Copy source to clipboard" aria-label="Copy source to clipboard">${icon('copy')}${icon('check', 'seldia-icon-copied')}</button>
    </div>
    <pre><code class="language-seldia">${escapeHtml(code)}</code></pre>
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
function cmdArgs(obj: unknown): string {
  return encodeURIComponent(JSON.stringify([obj]));
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
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
