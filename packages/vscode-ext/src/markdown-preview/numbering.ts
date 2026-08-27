// =============================================================================
// SelDiA — Diagram Numbering (pure, testable)
// =============================================================================
// One shared ordinal counter for every diagram rendered into a Markdown
// document — SelDiA, Mermaid and PlantUML alike — so captions and anchors
// reflect document order regardless of which fence type produced them.
//
// markdown-it renderer rules fire per token, in document order, with no
// whole-document pass available. The counter therefore lives on the render
// `env` object markdown-it already threads through every rule call — the same
// channel `plugin.ts` uses for the once-per-document icon sprite flag.
// =============================================================================

export interface NumberedDiagram {
  /** 1-based ordinal in document order. */
  n: number;
  /** Citable anchor, e.g. "diagram-3". */
  anchor: string;
  /** Declared name, when the DSL/import provides one. */
  title?: string;
  /** Content-hash id — kept for the existing edit deep links. */
  blockId: string;
  /** True for a block that failed to compile. */
  hasError?: boolean;
}

const COUNT_KEY = '__seldiaDiagramCount';
const LIST_KEY = '__seldiaDiagrams';

// Fallback counter for callers that don't have a usable `env` (e.g. Marp's
// current call sites, until threaded — see improve.md Phase 3b). Module-local
// state is a genuine fallback, not the primary path: every render through the
// real plugin passes an `env`.
let fallbackCounter = 0;

/** Read-and-increment the shared diagram counter on `env`. Wrapped in
 *  try/catch exactly like the icon-sprite flag in plugin.ts, since `env` is
 *  host-provided and its shape is not a contract we control. */
export function nextDiagramNumber(env: any): number {
  try {
    if (env && typeof env === 'object') {
      const current = typeof env[COUNT_KEY] === 'number' ? env[COUNT_KEY] : 0;
      const next = current + 1;
      env[COUNT_KEY] = next;
      return next;
    }
  } catch {
    /* fall through to the module-local counter */
  }
  fallbackCounter += 1;
  return fallbackCounter;
}

/** Citable anchor for a diagram ordinal, e.g. `diagram-3`. */
export function anchorForDiagram(n: number): string {
  return `diagram-${n}`;
}

/** Caption text for a diagram: `"Diagram 3"` or `"Diagram 3 — Payment flow"`. */
export function captionFor(n: number, title?: string): string {
  const trimmed = title?.trim();
  return trimmed ? `Diagram ${n} — ${trimmed}` : `Diagram ${n}`;
}

/** Extract a diagram's declared name from its DSL source, e.g.
 *  `diagram flowchart "Payment flow" { … }` → `"Payment flow"`.
 *
 *  Mirrors the regex already shipped on the PDF path
 *  (md2pdf/diagram-injector.ts) so both paths agree on what counts as a name;
 *  kept here as the one copy both consume. */
export function titleFromDsl(source: string): string | undefined {
  const match = source.match(/^\s*diagram\s+\S+\s+"([^"]+)"/);
  return match ? match[1] : undefined;
}

/** Append a rendered diagram's metadata to `env.__seldiaDiagrams`, the list
 *  the Marp/PDF TOC builders read. The built-in preview does not read this
 *  list — it walks the rendered DOM instead (Phase 4a), since the preview
 *  script runs after the DOM exists and has no access to `env`. */
export function registerDiagram(env: any, item: NumberedDiagram): void {
  try {
    if (!env || typeof env !== 'object') return;
    if (!Array.isArray(env[LIST_KEY])) env[LIST_KEY] = [];
    env[LIST_KEY].push(item);
  } catch {
    /* best-effort; the DOM remains the source of truth for the preview */
  }
}

/** Read back the list registered via `registerDiagram`. */
export function diagramsOf(env: any): NumberedDiagram[] {
  try {
    return Array.isArray(env?.[LIST_KEY]) ? env[LIST_KEY] : [];
  } catch {
    return [];
  }
}

export interface TocHeading {
  level: number;
  text: string;
  anchor: string;
}

/** Render the shared TOC markup from a heading list and a diagram list.
 *  Pure — no DOM access — so it can run in the preview webview script or in
 *  a test. Empty sections are omitted; callers decide whether to suppress the
 *  whole TOC for a short document. */
export function renderTocHtml(headings: TocHeading[], diagrams: NumberedDiagram[]): string {
  const parts: string[] = [];

  if (headings.length > 0) {
    parts.push('<div class="seldia-toc-section">');
    parts.push('<div class="seldia-toc-heading">Contents</div>');
    parts.push('<ul class="seldia-toc-list">');
    for (const h of headings) {
      parts.push(
        `<li class="seldia-toc-item seldia-toc-level-${h.level}"><a href="#${escapeAttr(h.anchor)}">${escapeHtml(h.text)}</a></li>`
      );
    }
    parts.push('</ul>');
    parts.push('</div>');
  }

  if (diagrams.length > 0) {
    parts.push('<div class="seldia-toc-section">');
    parts.push('<div class="seldia-toc-heading">Diagrams</div>');
    parts.push('<ul class="seldia-toc-list">');
    for (const d of diagrams) {
      const label = captionFor(d.n, d.title);
      const warn = d.hasError ? ' seldia-toc-error' : '';
      parts.push(
        `<li class="seldia-toc-item${warn}"><a href="#${escapeAttr(d.anchor)}">${escapeHtml(label)}</a></li>`
      );
    }
    parts.push('</ul>');
    parts.push('</div>');
  }

  return parts.join('\n');
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
