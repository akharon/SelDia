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

(() => {
  const zoomState = new Map<string, number>();

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

  // Re-apply remembered zoom whenever the preview content changes, and now.
  function reapplyZoom() {
    document.querySelectorAll<HTMLElement>('.seldia-diagram').forEach((container) => {
      const blockId = container.dataset.seldiaBlock || container.id;
      applyZoom(container, blockId, scaleOf(blockId));
    });
  }
  window.addEventListener('vscode.markdown.updateContent', () => reapplyZoom());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => reapplyZoom());
  } else {
    reapplyZoom();
  }
})();
