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
    const { w, h } = naturalSize(svg);
    // Use CSS transform: scale() instead of explicit width/height so the
    // SVG's natural layout size stays unchanged and the browser handles
    // visual scaling from the center via transform-origin. This keeps the
    // viewBox intact, avoids clipping at the container edges, and lets the
    // container's overflow:visible show the entire scaled diagram.
    svg.style.width = `${w}px`;
    svg.style.height = `${h}px`;
    svg.style.transform = `scale(${scale})`;
    svg.style.transformOrigin = 'top left';
    // When scaled down, the SVG occupies less visual space than its layout
    // box — shift the container's justify-content:center to keep it centred.
    svg.style.marginRight = `${w * (1 - scale)}px`;
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

  // ── Export the rendered SVG as a downloadable file ───────────────────────
  function exportSvg(container: HTMLElement) {
    const svg = svgOf(container);
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
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
