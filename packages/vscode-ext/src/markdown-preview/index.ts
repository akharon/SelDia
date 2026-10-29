// =============================================================================
// SelDiA — Markdown Preview Script
// =============================================================================
// Runs inside VS Code's built-in Markdown preview webview. It wires up each
// inline SelDiA diagram with two modes and their interactions:
//   • Preview — zoom / pan / export the rendered SVG
//   • Code    — read the DSL source (read-only; "open in editor" to change it)
//
// This is a read-only surface. Everything here is presentation state that lives
// in the webview and never travels back to the host, which is what makes it
// survive the preview's frequent full-DOM re-renders. Visual editing lives in
// the custom editor — see edit/commands.ts for why the built-in preview cannot
// carry edits back reliably.
//
// Buttons are wired with a single delegated listener on `document` rather than
// per-element listeners bound at load time. VS Code's Markdown preview replaces
// the whole preview DOM on every document change, which silently discards any
// handlers bound to the old nodes; a delegated listener keeps working across
// those re-renders and regardless of whether the diagram markup was present
// when the script first ran. All identity is keyed on the block id that the
// markdown-it plugin stamped onto the container.
// =============================================================================

import { toCsv } from '../edit/table-patch.js';

(() => {
  const zoomState = new Map<string, number>();

  // ── Table of Contents ─────────────────────────────────────────────────────
  // Built from the rendered DOM, not from markdown-it's `env` — a renderer
  // rule fires per token with nothing downstream counted yet, so the TOC can
  // only be assembled here, after the DOM exists. Runs on load and on every
  // `vscode.markdown.updateContent` (the preview's full-DOM re-render), and is
  // idempotent: any previously injected nav is removed first.
  let headingSlugSeq = 0;
  function slugify(text: string): string {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    return base || `heading-${++headingSlugSeq}`;
  }

  function collectHeadings(): { level: number; text: string; anchor: string }[] {
    const seen = new Set<string>();
    const headings: { level: number; text: string; anchor: string }[] = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      let anchor = el.id;
      if (!anchor) {
        // VS Code's built-in preview normally assigns heading ids itself; this
        // is a defensive fallback for the case where it hasn't (e.g. a custom
        // markdown-it config upstream), since a TOC entry without a target is
        // worse than no entry.
        anchor = slugify(text);
        while (seen.has(anchor) || document.getElementById(anchor)) {
          anchor = `${anchor}-${++headingSlugSeq}`;
        }
        el.id = anchor;
      }
      seen.add(anchor);
      const level = parseInt(el.tagName.slice(1), 10);
      headings.push({ level, text, anchor });
    });
    return headings;
  }

  function collectDiagrams(): { n: number; anchor: string; title?: string; blockId: string; hasError?: boolean }[] {
    const diagrams: { n: number; anchor: string; title?: string; blockId: string; hasError?: boolean }[] = [];
    document.querySelectorAll<HTMLElement>('.seldia-diagram[data-seldia-number]').forEach((el) => {
      const n = parseInt(el.dataset.seldiaNumber || '', 10);
      if (!n) return;
      diagrams.push({
        n,
        anchor: el.id,
        title: el.dataset.seldiaTitle,
        blockId: el.dataset.seldiaBlock || '',
        hasError: el.dataset.seldiaError === '1',
      });
    });
    diagrams.sort((a, b) => a.n - b.n);
    return diagrams;
  }

  function captionFor(n: number, title?: string): string {
    const trimmed = title?.trim();
    return trimmed ? `Diagram ${n} — ${trimmed}` : `Diagram ${n}`;
  }

  function tocHtml(
    headings: { level: number; text: string; anchor: string }[],
    diagrams: { n: number; anchor: string; title?: string }[]
  ): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const parts: string[] = [];
    if (headings.length > 0) {
      parts.push('<div class="seldia-toc-section"><div class="seldia-toc-heading">Contents</div><ul class="seldia-toc-list">');
      for (const h of headings) {
        parts.push(`<li class="seldia-toc-item seldia-toc-level-${h.level}"><a href="#${esc(h.anchor)}">${esc(h.text)}</a></li>`);
      }
      parts.push('</ul></div>');
    }
    if (diagrams.length > 0) {
      parts.push('<div class="seldia-toc-section"><div class="seldia-toc-heading">Diagrams</div><ul class="seldia-toc-list">');
      for (const d of diagrams) {
        parts.push(`<li class="seldia-toc-item"><a href="#${esc(d.anchor)}">${esc(captionFor(d.n, d.title))}</a></li>`);
      }
      parts.push('</ul></div>');
    }
    return parts.join('');
  }

  function buildToc() {
    // Remove any previously injected TOC before rebuilding — the preview
    // rebuilds its whole DOM on every keystroke, so this must be idempotent.
    document.querySelectorAll('nav.seldia-toc').forEach((n) => n.remove());

    // The toc.enabled setting is read once, host-side, at plugin-construction
    // time (extendMarkdownIt has no per-render config channel into this
    // webview), and carried in as a hidden marker the fence rule stamps once
    // per document. Absence of the marker means no diagram rendered through
    // us on this page — nothing to build a TOC from either way.
    const config = document.getElementById('seldia-toc-config') as HTMLElement | null;
    if (config && config.dataset.seldiaTocEnabled === '0') return;

    const headings = collectHeadings();
    const diagrams = collectDiagrams();

    // A short note should not grow a TOC.
    if (headings.length < 3 && diagrams.length < 2) return;

    const nav = document.createElement('nav');
    nav.className = 'seldia-toc';
    nav.innerHTML = `<details open><summary>Table of Contents</summary>${tocHtml(headings, diagrams)}</details>`;
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function diagramOf(el: Element | null): HTMLElement | null {
    return el ? (el.closest('.seldia-diagram') as HTMLElement | null) : null;
  }
  function svgOf(container: HTMLElement): SVGSVGElement | null {
    return container.querySelector('.seldia-diagram-svg svg') as SVGSVGElement | null;
  }
  function naturalSize(svg: SVGSVGElement): { w: number; h: number } {
    // Use viewBox dimensions when available — they represent the diagram's
    // intrinsic size regardless of CSS scaling. Fall back to bounding rect
    // only when viewBox is absent.
    const vb = svg.viewBox;
    if (vb && vb.baseVal && vb.baseVal.width > 0 && vb.baseVal.height > 0) {
      return { w: vb.baseVal.width, h: vb.baseVal.height };
    }
    const w = svg.width.baseVal.value || svg.getBoundingClientRect().width;
    const h = svg.height.baseVal.value || svg.getBoundingClientRect().height;
    return { w, h };
  }
  function applyZoom(container: HTMLElement, blockId: string, scale: number) {
    const svg = svgOf(container);
    if (!svg) return;
    if (scale === 1) {
      // Default: let the SVG's natural width="100%" auto-fit the container.
      // Clear any zoom overrides so the diagram snaps back to responsive fit.
      svg.style.width = '';
      svg.style.height = '';
      svg.style.maxWidth = '';
      svg.style.transform = '';
      svg.style.transformOrigin = '';
      zoomState.delete(blockId);
      return;
    }
    // Zoom by changing the SVG's pixel width relative to its viewBox
    // (natural) dimensions.  A wider SVG → more detail (zoom-in, scrollbars
    // appear); a narrower SVG → overview (zoom-out).  overflow:auto on the
    // parent .seldia-diagram-svg adds a horizontal scrollbar when the SVG
    // outgrows the container — no clipping, no transform hacks.
    const { w, h } = naturalSize(svg);
    const aspect = w > 0 ? h / w : 1;
    const targetW = Math.round(w * scale);
    svg.style.width = `${targetW}px`;
    svg.style.height = `${Math.round(targetW * aspect)}px`;
    svg.style.maxWidth = 'none'; // override engine's max-width so zoom-in works
    svg.style.transform = '';
    svg.style.transformOrigin = '';
    zoomState.set(blockId, scale);
  }
  function scaleOf(blockId: string): number {
    return zoomState.get(blockId) || 1;
  }

  // ── Delegated click handling for every toolbar button ────────────────────
  // One listener on `document` covers all diagrams, survives preview
  // re-renders, and needs no per-block setup pass.
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    // GFM table "Copy as CSV" — the table wrapper is not a diagram container.
    const csvBtn = target?.closest?.('.seldia-btn-copy-csv') as HTMLElement | null;
    if (csvBtn) {
      e.preventDefault();
      const table = csvBtn.closest('.seldia-table')?.querySelector('table');
      if (table) void copyTableCsv(table, csvBtn);
      return;
    }
    const btn = target?.closest?.(
      '.seldia-mode-btn, .seldia-btn-zoom-in, .seldia-btn-zoom-out, .seldia-btn-reset, .seldia-btn-export, .seldia-btn-copy-source'
    ) as HTMLElement | null;
    // The reveal-source deep-link anchor is handled by VS Code itself — don't
    // intercept it here.
    if (!btn) return;
    const container = diagramOf(btn);
    if (!container) return;
    const blockId = container.dataset.seldiaBlock || container.id;

    if (btn.classList.contains('seldia-mode-btn')) {
      e.preventDefault();
      const mode = btn.dataset.seldiaTargetMode || 'preview';
      container.dataset.seldiaMode = mode;
      container
        .querySelectorAll('.seldia-mode-btn')
        .forEach((b) => b.classList.toggle('active', b === btn));
      return;
    }
    if (btn.classList.contains('seldia-btn-zoom-in')) {
      e.preventDefault();
      applyZoom(container, blockId, Math.min(scaleOf(blockId) * 1.3, 5));
      return;
    }
    if (btn.classList.contains('seldia-btn-zoom-out')) {
      e.preventDefault();
      applyZoom(container, blockId, Math.max(scaleOf(blockId) / 1.3, 0.2));
      return;
    }
    if (btn.classList.contains('seldia-btn-reset')) {
      e.preventDefault();
      applyZoom(container, blockId, 1);
      return;
    }
    if (btn.classList.contains('seldia-btn-export')) {
      e.preventDefault();
      exportSvg(container);
      return;
    }
    if (btn.classList.contains('seldia-btn-copy-source')) {
      e.preventDefault();
      copySource(container, btn);
      return;
    }
  });

  // ── Ctrl/Cmd-wheel zoom (delegated) ──────────────────────────────────────
  document.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const container = diagramOf(e.target as Element | null);
      if (!container) return;
      e.preventDefault();
      const blockId = container.dataset.seldiaBlock || container.id;
      applyZoom(container, blockId, Math.max(0.2, Math.min(5, scaleOf(blockId) * (e.deltaY > 0 ? 0.9 : 1.1))));
    },
    { passive: false }
  );

  // ── Grab-to-pan (delegated) ──────────────────────────────────────────────
  // When zoomed in, click-and-drag on the diagram scrolls it in any direction —
  // the same muscle memory as panning a map or a large image.
  let panState: { el: HTMLElement; startX: number; startY: number; scrollX: number; scrollY: number } | null = null;

  function svgContainerOf(el: Element | null): HTMLElement | null {
    if (!el) return null;
    return el.closest('.seldia-diagram-svg') as HTMLElement | null;
  }

  // Show the grab cursor on any zoomed-in diagram so the user knows pan is
  // available.  Runs whenever zoom changes and on preview content updates.
  function refreshPanCursors() {
    document.querySelectorAll<HTMLElement>('.seldia-diagram-svg').forEach((svgBox) => {
      const container = svgBox.closest('.seldia-diagram') as HTMLElement | null;
      if (!container) return;
      const blockId = container.dataset.seldiaBlock || container.id;
      const zoomed = scaleOf(blockId) !== 1;
      // Also show grab when the diagram overflows at natural size (no zoom).
      const overflows =
        svgBox.scrollWidth > svgBox.clientWidth + 2 ||
        svgBox.scrollHeight > svgBox.clientHeight + 2;
      svgBox.classList.toggle('seldia-can-pan', zoomed || overflows);
    });
  }

  document.addEventListener('mousedown', (e) => {
    // Only respond to the primary (left) button.
    if (e.button !== 0) return;
    const svgBox = svgContainerOf(e.target as Element | null);
    if (!svgBox) return;
    // Only start a pan when the cursor says grab — i.e. the diagram is
    // scrollable (zoomed or naturally overflowing).
    if (!svgBox.classList.contains('seldia-can-pan')) return;
    e.preventDefault();
    svgBox.classList.add('seldia-panning');
    panState = {
      el: svgBox,
      startX: e.clientX,
      startY: e.clientY,
      scrollX: svgBox.scrollLeft,
      scrollY: svgBox.scrollTop,
    };
  });

  document.addEventListener('mousemove', (e) => {
    if (!panState) return;
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;
    panState.el.scrollLeft = panState.scrollX - dx;
    panState.el.scrollTop = panState.scrollY - dy;
  });

  document.addEventListener('mouseup', () => {
    if (!panState) return;
    panState.el.classList.remove('seldia-panning');
    panState = null;
  });

  // Refresh grab cursors after zoom changes and after preview re-renders.
  const origApplyZoom = applyZoom;
  (applyZoom as any) = function (container: HTMLElement, blockId: string, scale: number) {
    origApplyZoom(container, blockId, scale);
    setTimeout(refreshPanCursors, 0);
  };

  // ── Export the rendered SVG as a downloadable file ───────────────────────
  function exportSvg(container: HTMLElement) {
    const svg = svgOf(container);
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
    // Reset zoom styles so the export shows the diagram at its natural size.
    clone.style.width = '';
    clone.style.height = '';
    clone.style.maxWidth = '';
    clone.style.transform = '';
    const str = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seldia-diagram.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Copy DSL source to the clipboard, flashing a check glyph ──────────────
  async function copySource(container: HTMLElement, btn: HTMLElement) {
    const code = container.querySelector('.seldia-diagram-source code')?.textContent;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      btn.classList.add('seldia-copied');
      btn.setAttribute('title', 'Copied!');
      setTimeout(() => {
        btn.classList.remove('seldia-copied');
        btn.setAttribute('title', 'Copy source to clipboard');
      }, 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  // ── Copy a rendered GFM table as CSV ─────────────────────────────────────
  // Read from the rendered DOM (cell text as the reader sees it, markup
  // stripped) rather than the Markdown source, which the preview never has.
  async function copyTableCsv(table: HTMLTableElement, btn: HTMLElement) {
    const rows = Array.from(table.rows).map((tr) =>
      Array.from(tr.cells).map((cell) => (cell.textContent || '').trim())
    );
    try {
      await navigator.clipboard.writeText(toCsv(rows));
      btn.classList.add('seldia-copied');
      btn.setAttribute('title', 'Copied!');
      setTimeout(() => {
        btn.classList.remove('seldia-copied');
        btn.setAttribute('title', 'Copy as CSV');
      }, 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  // Re-apply remembered zoom whenever the preview content changes, and now.
  function reapplyZoom() {
    document.querySelectorAll<HTMLElement>('.seldia-diagram').forEach((container) => {
      const blockId = container.dataset.seldiaBlock || container.id;
      applyZoom(container, blockId, scaleOf(blockId));
    });
  }
  window.addEventListener('vscode.markdown.updateContent', () => {
    reapplyZoom();
    buildToc();
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      reapplyZoom();
      buildToc();
    });
  } else {
    reapplyZoom();
    buildToc();
  }
})();
