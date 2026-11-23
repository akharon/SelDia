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
// It also intercepts ```mermaid and ```plantuml fences and renders them
// through the same engine via the Mermaid / PlantUML importers, which is the
// product position made concrete: your existing diagrams, unmodified, drawn by
// SelDiA. Both paths degrade to the default fence whenever the importer can't
// model the source, so installing SelDiA can never make a Mermaid or PlantUML
// document render worse than it did before.
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

import type { CoreEngine, DiagramIR } from '@seldia/core';
import { importMermaid, importPlantUml, importCircuit, importPcb, fenceToSource } from '@seldia/core';
import { ICON_SPRITE, icon } from '../shared/icons.js';
import { blockIdForSource, tableIdForSource } from '../edit/blocks.js';
import { nextDiagramNumber, anchorForDiagram, captionFor, titleFromDsl, registerDiagram } from './numbering.js';
import { readFrontMatterOverrides } from './frontmatter.js';

// Minimal MarkdownIt interface — matches what VS Code passes to extendMarkdownIt
type RenderRule = (tokens: any[], idx: number, options: any, env: any, slf: any) => string;

export interface MarkdownIt {
  renderer: {
    rules: {
      fence?: RenderRule;
      table_open?: RenderRule;
      table_close?: RenderRule;
    };
  };
  core?: {
    ruler: {
      before: (anchor: string, name: string, fn: (state: { src: string; env: any; tokens: any[] }) => void) => void;
      after?: (anchor: string, name: string, fn: (state: { src: string; env: any; tokens: any[] }) => void) => void;
    };
  };
}

/** Stable id for a block, derived from its DSL source. Re-exported from the
 *  host's block module rather than reimplemented: two copies of this hash
 *  silently disagreed on trailing whitespace once already, which broke every
 *  deep link the preview emitted. One implementation, one id. */
export { blockIdForSource };

export interface SelDiAMarkdownItPluginOptions {
  /** Render numbered captions under diagrams. Default true. */
  captionsEnabled?: boolean;
  /** Let the preview script inject the auto-TOC. Default true. */
  tocEnabled?: boolean;
  /** Style GFM tables and give them an Edit/Copy-as-CSV toolbar. Default true.
   *  A function is re-read on every render, so a settings change takes effect
   *  on the next preview refresh without re-creating the plugin. */
  tablesEnabled?: boolean | (() => boolean);
}

export function createSelDiAMarkdownItPlugin(engine: CoreEngine, options: SelDiAMarkdownItPluginOptions = {}) {
  const captionsEnabled = options.captionsEnabled ?? true;
  const tocEnabled = options.tocEnabled ?? true;
  return function seldiaPlugin(md: MarkdownIt) {
    // Stash this document's seldia_toc/seldia_captions front-matter overrides
    // onto `env` before rendering starts, so the fence rule (which never sees
    // the raw source, only individual token content) can read them per
    // render. `before('normalize', ...)` runs first in core's ruler chain,
    // ahead of anything that could mutate `state.src`.
    //
    // The overrides are ALSO stashed on the token array itself. VS Code's
    // Markdown engine tokenizes with one env object and renders with a fresh
    // one, and caches the tokens per document version — so on a real preview
    // render `env.__seldiaOverrides` is never there. The token array is the
    // only thing that survives from parse to render (and across cached
    // renders); `state.tokens` is already the array the block rules fill.
    try {
      md.core?.ruler.before('normalize', 'seldia_frontmatter_overrides', (state) => {
        try {
          const overrides = readFrontMatterOverrides(state.src);
          if (state.env && typeof state.env === 'object') state.env.__seldiaOverrides = overrides;
          if (Array.isArray(state.tokens)) (state.tokens as any).__seldiaOverrides = overrides;
        } catch {
          /* ignore — falls back to the workspace-wide setting */
        }
      });
    } catch {
      /* older/alternate MarkdownIt shape without `core` — no per-document override */
    }

    // Stamp every top-level table_open token with the id of its source lines
    // (same hash as edit/blocks.ts findGfmTables), at parse time where the
    // source is still at hand. The renderer only sees tokens, and — see above —
    // the tokens are what VS Code caches, so this is the one place the id can
    // be derived reliably.
    try {
      md.core?.ruler.after?.('block', 'seldia_table_ids', (state) => {
        try {
          let lines: string[] | undefined;
          for (const tok of state.tokens) {
            if (tok.type !== 'table_open' || !tok.map) continue;
            lines ??= state.src.split('\n');
            const source = lines.slice(tok.map[0], tok.map[1]).join('\n');
            tok.meta = { ...(tok.meta || {}), seldiaTableId: tableIdForSource(source), seldiaTableLine: tok.map[0] };
          }
        } catch {
          /* tables render unstamped (styled, no edit link) */
        }
      });
    } catch {
      /* no core ruler — tables still get styled, just without edit links */
    }

    installTableRules(md, options.tablesEnabled ?? true);

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

      // ICON_SPRITE is a ~7KB block of <symbol id="seldia-icon-*"> defs that
      // every rendered block needs, but only one copy may be emitted per
      // document — duplicate ids are invalid HTML and pure payload bloat on
      // a document with several diagrams. markdown-it shares one `env` per
      // document render, so it doubles as the once-per-document flag. Only
      // commit the flag once a block actually renders through us — a
      // mermaid/plantuml block that falls through to the default fence must
      // not "spend" the sprite slot for a sprite it never emitted.
      const spriteKey = '__seldiaSpriteEmitted';
      let includeSprite = true;
      try {
        includeSprite = !env?.[spriteKey];
      } catch {
        includeSprite = true;
      }
      // The TOC marker has its own once-per-document flag: a GFM table can
      // spend the sprite slot before the first diagram, and the marker must
      // still be emitted by whichever diagram renders first.
      const tocKey = '__seldiaTocMarkerEmitted';
      let includeTocMarker = true;
      try {
        includeTocMarker = !env?.[tocKey];
      } catch {
        includeTocMarker = true;
      }
      const commitSprite = () => {
        try {
          if (env && includeSprite) env[spriteKey] = true;
          if (env) env[tocKey] = true;
        } catch { /* ignore */ }
      };

      // Per-document front-matter (seldia_toc / seldia_captions) overrides
      // the workspace-wide setting when present, e.g. a document that already
      // has its own hand-written TOC and doesn't want a second one.
      let docOverrides: { toc?: boolean; captions?: boolean } = {};
      try {
        docOverrides = docOverridesOf(tokens, env);
      } catch {
        docOverrides = {};
      }
      const effectiveCaptionsEnabled = docOverrides.captions ?? captionsEnabled;
      const effectiveTocEnabled = docOverrides.toc ?? tocEnabled;

      // A hidden marker carrying the toc setting to the preview script, which
      // has no access to `vscode.workspace.getConfiguration` from inside the
      // webview. Emitted once per document, alongside the sprite.
      const tocMarker = includeTocMarker
        ? `<span id="seldia-toc-config" data-seldia-toc-enabled="${effectiveTocEnabled ? '1' : '0'}" style="display:none"></span>`
        : '';

      // Which compile path a fence takes is core's decision (fenceToSource), so a new
      // spelling there reaches the preview without a second map. `seldia-<variant>`
      // fences are preview-only spellings of the DSL.
      const kind = lang.startsWith('seldia-') ? 'seldia' : fenceToSource(lang, token.content)?.kind;

      if (kind === 'seldia') {
        try {
          const rendered = renderSelDiABlock(engine, token.content, docUriOf(env), includeSprite, env, effectiveCaptionsEnabled);
          commitSprite();
          return tocMarker + rendered;
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
      if (kind === 'mermaid') {
        try {
          const rendered = renderMermaidBlock(engine, token.content, docUriOf(env), includeSprite, env, effectiveCaptionsEnabled);
          if (rendered) { commitSprite(); return tocMarker + rendered; }
        } catch {
          /* fall through to the default fence */
        }
      }

      // ```plantuml (and its usual aliases) gets the same treatment for the
      // same reason — PlantUML is a peer input format, not a rival, so an
      // existing .md full of ```puml blocks renders through SelDiA untouched.
      if (kind === 'plantuml') {
        try {
          const rendered = renderPlantUmlBlock(engine, token.content, docUriOf(env), includeSprite, env, effectiveCaptionsEnabled);
          if (rendered) { commitSprite(); return tocMarker + rendered; }
        } catch {
          /* fall through to the default fence */
        }
      }

      // ```pcb / ```kicad_pcb (or a ```kicad fence whose body is a board, not a
      // netlist): render-only KiCad board view.
      if (kind === 'pcb') {
        try {
          const { ir, diagnostics } = importPcb(token.content);
          const rendered = renderImportedBlock(engine, token.content, docUriOf(env), 'pcb', 'KiCad PCB', ir, diagnostics, includeSprite, env, effectiveCaptionsEnabled);
          if (rendered) { commitSprite(); return tocMarker + rendered; }
        } catch {
          /* fall through to the default fence */
        }
      }

      // ```spice / ```circuit / ```netlist: a raw SPICE or KiCad netlist,
      // imported straight to the circuit IR (same path as the CLI command).
      if (kind === 'circuit') {
        try {
          const { ir, diagnostics } = importCircuit(token.content);
          const rendered = renderImportedBlock(engine, token.content, docUriOf(env), 'circuit', 'SPICE', ir, diagnostics, includeSprite, env, effectiveCaptionsEnabled);
          if (rendered) { commitSprite(); return tocMarker + rendered; }
        } catch {
          /* fall through to the default fence */
        }
      }

      return defaultFence(tokens, idx, options, env, slf);
    };

    return md;
  };
}

/** Per-document front-matter overrides: from the token array (survives VS
 *  Code's parse/render env split and token cache), else from env (plain
 *  `md.render`, as in tests). */
function docOverridesOf(tokens: any, env: any): { toc?: boolean; captions?: boolean; tables?: boolean } {
  return tokens?.__seldiaOverrides || env?.__seldiaOverrides || {};
}

// ── GFM tables ───────────────────────────────────────────────────────────

/** Wrap every GFM table in a styled container with a hover toolbar
 *  ("Edit table" deep link + "Copy as CSV"). The `<table>` tag itself is
 *  still rendered by the previous rule — VS Code's line-number wrapper or
 *  markdown-it's own `renderToken` — so its `data-line`/`code-line`
 *  attributes, which drive scroll-sync, are untouched. */
function installTableRules(md: MarkdownIt, tablesEnabled: boolean | (() => boolean)): void {
  const prevOpen = md.renderer.rules.table_open;
  const prevClose = md.renderer.rules.table_close;
  const renderOpen: RenderRule = (tokens, idx, options, env, slf) =>
    prevOpen ? prevOpen(tokens, idx, options, env, slf) : slf.renderToken(tokens, idx, options);
  const renderClose: RenderRule = (tokens, idx, options, env, slf) =>
    prevClose ? prevClose(tokens, idx, options, env, slf) : slf.renderToken(tokens, idx, options);

  const enabledFor = (tokens: any[], env: any): boolean => {
    try {
      const doc = docOverridesOf(tokens, env).tables;
      if (doc !== undefined) return doc;
      return typeof tablesEnabled === 'function' ? tablesEnabled() : tablesEnabled;
    } catch {
      return false;
    }
  };

  md.renderer.rules.table_open = (tokens, idx, options, env, slf) => {
    const inner = renderOpen(tokens, idx, options, env, slf);
    if (!enabledFor(tokens, env)) return inner;
    let sprite = '';
    try {
      if (env && !env.__seldiaSpriteEmitted) { sprite = ICON_SPRITE; env.__seldiaSpriteEmitted = true; }
    } catch { /* ignore */ }
    return sprite + renderTableWrapperOpen(tokens[idx], docUriOf(env)) + inner;
  };
  md.renderer.rules.table_close = (tokens, idx, options, env, slf) => {
    const inner = renderClose(tokens, idx, options, env, slf);
    if (!enabledFor(tokens, env)) return inner;
    return inner + '</div></div>\n';
  };
}

/** The opening half of a table's wrapper. Exported for tests. Only a
 *  top-level table (`level === 0`) that carries a stamped id gets the edit
 *  link: tables nested in lists/blockquotes are styled but not editable, since
 *  the host's table finder (edit/blocks.ts) only addresses top-level tables. */
export function renderTableWrapperOpen(token: any, docUri: string): string {
  const id: string | undefined = token?.meta?.seldiaTableId;
  const line: number | undefined = token?.meta?.seldiaTableLine;
  const editable = !!id && (token?.level ?? 0) === 0;
  const attrs = id
    ? ` data-seldia-table="${escapeAttr(id)}" data-seldia-doc="${escapeAttr(docUri)}"${line !== undefined ? ` data-seldia-table-line="${line}"` : ''}`
    : '';
  const edit = editable
    ? `<a class="seldia-btn seldia-btn-icon" title="Edit table" aria-label="Edit table" href="${deepLink('editTable', { tableId: id!, line: line !== undefined ? String(line) : '', doc: docUri })}">${icon('edit')}</a>`
    : '';
  return `<div class="seldia-table"${attrs}><div class="seldia-table-toolbar">${edit}<button class="seldia-btn seldia-btn-icon seldia-btn-copy-csv" title="Copy as CSV" aria-label="Copy as CSV">${icon('copy')}${icon('check', 'seldia-icon-copied')}</button></div><div class="seldia-table-scroll">`;
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
 *  Exported so it can be unit-tested without a MarkdownIt instance.
 *  `includeSprite` defaults to true so direct unit-test calls keep seeing the
 *  sprite; the fence rule passes false for every block after the first in a
 *  document so the ~7KB sprite (and its `id="seldia-icon-*"` symbols) isn't
 *  duplicated once per diagram. */
export function renderSelDiABlock(engine: CoreEngine, code: string, docUri = '', includeSprite = true, env?: any, captionsEnabled = true): string {
  const blockId = blockIdForSource(code);
  const n = nextDiagramNumber(env);
  const anchor = anchorForDiagram(n);
  const title = titleFromDsl(code);
  const captionHtml = captionsEnabled
    ? `
  <div class="seldia-caption">
    <span class="seldia-caption-label">Diagram ${n}</span>${title ? ` — <span class="seldia-caption-title">${escapeHtml(title)}</span>` : ''}
  </div>`
    : '';
  // Synchronous compile — the markdown-it fence renderer cannot await.
  let result;
  try {
    result = engine.compileSync(code);
  } catch (err: any) {
    result = { ok: false as const, errors: [{ message: `Internal error: ${err?.message ?? err}` }] };
  }

  if (!result.ok) {
    const errors = result.errors.map((e: any) => e.message).join('\n');
    registerDiagram(env, { n, anchor, blockId, title, hasError: true });
    return `
${includeSprite ? ICON_SPRITE : ''}
<div class="seldia-diagram seldia-error" id="${anchor}" data-seldia-block="${escapeAttr(blockId)}" data-seldia-number="${n}" data-seldia-error="1"${title ? ` data-seldia-title="${escapeAttr(title)}"` : ''}>
  <div class="seldia-diagram-toolbar">
    <span class="seldia-diagram-badge">${icon('error')} SelDiA Error</span>
    <span class="seldia-toolbar-spacer"></span>
    <a class="seldia-btn seldia-btn-icon" title="Reveal DSL source to fix errors" aria-label="Reveal DSL source to fix errors" href="${deepLink('revealSource', { blockId, doc: docUri })}">${icon('edit')}</a>
  </div>
  <div class="seldia-error-header">Compilation Error</div>
  <pre class="seldia-error-detail">${escapeHtml(errors)}</pre>
  <div class="seldia-diagram-source">
    <pre><code class="language-seldia">${escapeHtml(code)}</code></pre>
  </div>${captionHtml}
</div>`;
  }

  const svg = result.value.svg;
  registerDiagram(env, { n, anchor, blockId, title });

  return `
${includeSprite ? ICON_SPRITE : ''}
<div class="seldia-diagram" id="${anchor}" data-seldia-block="${escapeAttr(blockId)}" data-seldia-doc="${escapeAttr(docUri)}" data-seldia-mode="preview" data-seldia-number="${n}"${title ? ` data-seldia-title="${escapeAttr(title)}"` : ''}>
  <div class="seldia-diagram-toolbar">
    <span class="seldia-mode-switch" role="tablist">
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="preview" title="Show rendered diagram" aria-label="Show rendered diagram">${icon('visibility')}</button>
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="code" title="Show DSL source" aria-label="Show DSL source">${icon('code')}</button>
    </span>
    <a class="seldia-btn seldia-btn-icon" title="Edit visually" aria-label="Edit visually" href="${deepLink('editBlockVisually', { blockId, doc: docUri })}">${icon('edit-visually')}</a>
    <span class="seldia-toolbar-spacer"></span>
    <button class="seldia-btn seldia-btn-icon seldia-btn-pause" title="Pause animations" aria-label="Pause animations" aria-pressed="false">${icon('pause')}${icon('play', 'seldia-icon-alt')}</button>
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
  </div>${captionHtml}
</div>`;
}

/** Render a ```mermaid block through SelDiA's engine.
 *
 *  Returns `null` — meaning "not ours, let the default fence have it" — when
 *  the importer can't model the source. That covers unsupported diagram types
 *  (journey, quadrantChart…) and any structural failure. This asymmetry is
 *  deliberate: for SelDiA's own blocks a compile error is worth showing loudly,
 *  because the author asked for SelDiA. A Mermaid author did not, so a block we
 *  can't render must degrade to whatever would have happened without us
 *  installed, never to a SelDiA error box in someone else's document.
 */
export function renderMermaidBlock(engine: CoreEngine, code: string, docUri = '', includeSprite = true, env?: any, captionsEnabled = true): string | null {
  const { ir, diagnostics } = importMermaid(code);
  return renderImportedBlock(engine, code, docUri, 'mermaid', 'Mermaid', ir, diagnostics, includeSprite, env, captionsEnabled);
}

/** Render a ```plantuml block through SelDiA's engine. Same contract as
 *  renderMermaidBlock, including the fall-back-to-default-fence asymmetry:
 *  a PlantUML author did not ask for SelDiA either. */
export function renderPlantUmlBlock(engine: CoreEngine, code: string, docUri = '', includeSprite = true, env?: any, captionsEnabled = true): string | null {
  const { ir, diagnostics } = importPlantUml(code);
  return renderImportedBlock(engine, code, docUri, 'plantuml', 'PlantUML', ir, diagnostics, includeSprite, env, captionsEnabled);
}

/** The shared body behind both foreign-format fences.
 *
 *  Diagnostics from a *partial* success are attached to the container rather
 *  than shown, so the engine can report what it approximated without pushing an
 *  error surface into a document that renders fine.
 */
function renderImportedBlock(
  engine: CoreEngine,
  code: string,
  docUri: string,
  format: string,
  formatLabel: string,
  ir: DiagramIR | undefined,
  diagnostics: Array<{ line: number; message: string }>,
  includeSprite = true,
  env?: any,
  captionsEnabled = true,
): string | null {
  if (!ir) return null;

  const result = engine.compileIRSync(ir);
  if (!result.ok) return null;

  const blockId = blockIdForSource(code);
  const svg = result.value.svg;
  const notes = diagnostics.map((d) => `L${d.line}: ${d.message}`).join('\n');
  const n = nextDiagramNumber(env);
  const anchor = anchorForDiagram(n);
  const title = ir.title;
  registerDiagram(env, { n, anchor, blockId, title });
  const captionHtml = captionsEnabled
    ? `
  <div class="seldia-caption">
    <span class="seldia-caption-label">Diagram ${n}</span>${title ? ` — <span class="seldia-caption-title">${escapeHtml(title)}</span>` : ''}
  </div>`
    : '';

  return `
${includeSprite ? ICON_SPRITE : ''}
<div class="seldia-diagram" id="${anchor}" data-seldia-block="${escapeAttr(blockId)}" data-seldia-doc="${escapeAttr(docUri)}" data-seldia-mode="preview" data-seldia-source-format="${escapeAttr(format)}" data-seldia-number="${n}"${title ? ` data-seldia-title="${escapeAttr(title)}"` : ''}${notes ? ` data-seldia-notes="${escapeAttr(notes)}"` : ''}>
  <div class="seldia-diagram-toolbar">
    <span class="seldia-mode-switch" role="tablist">
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="preview" title="Show rendered diagram" aria-label="Show rendered diagram">${icon('visibility')}</button>
      <button class="seldia-btn seldia-btn-icon seldia-mode-btn" data-seldia-target-mode="code" title="Show ${formatLabel} source" aria-label="Show ${formatLabel} source">${icon('code')}</button>
    </span>
    <span class="seldia-diagram-badge seldia-badge-format" title="${formatLabel} source, rendered by SelDiA">${format}</span>
    <span class="seldia-toolbar-spacer"></span>
    <button class="seldia-btn seldia-btn-icon seldia-btn-pause" title="Pause animations" aria-label="Pause animations" aria-pressed="false">${icon('pause')}${icon('play', 'seldia-icon-alt')}</button>
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
      <span>${formatLabel} Source</span>
      <span class="seldia-toolbar-spacer"></span>
      <a class="seldia-btn seldia-btn-icon" title="Open this block in the editor to edit it" aria-label="Open in editor" href="${deepLink('revealSource', { blockId, doc: docUri })}">${icon('open-in-editor')}</a>
      <button class="seldia-btn seldia-btn-icon seldia-btn-copy-source" title="Copy source to clipboard" aria-label="Copy source to clipboard">${icon('copy')}${icon('check', 'seldia-icon-copied')}</button>
    </div>
    <pre class="seldia-source-view"><code class="language-${escapeAttr(format)}">${escapeHtml(code)}</code></pre>
  </div>${captionHtml}
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
const EXTENSION_ID = 'ThalesoMilas.seldia-vscode';

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
