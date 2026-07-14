// =============================================================================
// SelDiA — Markdown Preview Script
// =============================================================================
// Runs inside VS Code's built-in Markdown preview webview. It wires up each
// inline SelDiA diagram with three modes and their interactions:
//   • Preview — zoom / pan / export the rendered SVG
//   • Code    — read the DSL source
//   • Edit    — drag a node to move it, double-click a node to rename it
//
// Buttons are wired with a single delegated listener on `document` rather than
// per-element listeners bound at load time. VS Code's Markdown preview replaces
// the whole preview DOM on every document change, which silently discards any
// handlers bound to the old nodes; a delegated listener keeps working across
// those re-renders and regardless of whether the diagram markup was present
// when the script first ran. All identity is keyed on the block id that the
// markdown-it plugin stamped onto the container.
//
// Edit gestures are written back to the Markdown source by invoking extension
// commands through `command:` URIs (the sanctioned channel from the built-in
// preview to the extension host).
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
    const w = svg.viewBox?.baseVal?.width || svg.width.baseVal.value || svg.getBoundingClientRect().width;
    const h = svg.viewBox?.baseVal?.height || svg.height.baseVal.value || svg.getBoundingClientRect().height;
    return { w, h };
  }
  function applyZoom(container: HTMLElement, blockId: string, scale: number) {
    const svg = svgOf(container);
    if (!svg) return;
    const { w, h } = naturalSize(svg);
    svg.style.transform = '';
    svg.style.width = `${w * scale}px`;
    svg.style.height = `${h * scale}px`;
    svg.style.maxWidth = 'none';
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
    // `command:`-URI anchors (auto layout, reveal source) are handled by VS
    // Code itself — don't intercept them here.
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

  // ── Edit gestures (drag to move, double-click to rename) ─────────────────
  // These need per-node listeners on the SVG geometry, so they're (re)bound
  // after each render. A dataset guard keeps re-binding idempotent.
  function setupEditing() {
    document.querySelectorAll<HTMLElement>('.seldia-diagram').forEach((container) => {
      const svg = svgOf(container);
      if (!svg) return;
      const blockId = container.dataset.seldiaBlock || container.id;
      const pad = parseFloat(container.dataset.seldiaPad || '20');
      // Apply any remembered zoom for this block.
      applyZoom(container, blockId, scaleOf(blockId));

      svg.querySelectorAll<SVGGElement>('[data-seldia-node-id]').forEach((g) => {
        if (g.dataset.seldiaEditBound === 'true') return;
        g.dataset.seldiaEditBound = 'true';
        const nodeId = g.getAttribute('data-seldia-node-id') || '';

        g.addEventListener('dblclick', (e) => {
          if (container.dataset.seldiaMode !== 'edit') return;
          e.preventDefault();
          e.stopPropagation();
          const current = g.querySelector('text')?.textContent || '';
          runCommand('seldia.editNodeLabel', { blockId, nodeId, current });
        });

        g.addEventListener('mousedown', (e) => {
          if (container.dataset.seldiaMode !== 'edit') return;
          e.preventDefault();
          e.stopPropagation();
          const startUser = toUserSpace(svg, e.clientX, e.clientY);
          const origin = g.getBBox();
          g.style.cursor = 'grabbing';
          let moved = false;

          const onMove = (ev: MouseEvent) => {
            const cur = toUserSpace(svg, ev.clientX, ev.clientY);
            const dx = cur.x - startUser.x;
            const dy = cur.y - startUser.y;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
            g.setAttribute('transform', `translate(${dx} ${dy})`);
          };
          const onUp = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            g.style.cursor = '';
            if (!moved) {
              g.removeAttribute('transform');
              return;
            }
            const end = toUserSpace(svg, ev.clientX, ev.clientY);
            const nx = origin.x - pad + (end.x - startUser.x);
            const ny = origin.y - pad + (end.y - startUser.y);
            runCommand('seldia.moveNode', { blockId, nodeId, x: nx, y: ny });
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      });
    });
  }

  /** Convert client (screen) coordinates to the SVG user coordinate system. */
  function toUserSpace(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /** Invoke an extension command via a command: URI (user-gesture initiated). */
  function runCommand(command: string, arg: unknown) {
    const uri = `command:${command}?${encodeURIComponent(JSON.stringify([arg]))}`;
    const a = document.createElement('a');
    a.href = uri;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Re-bind edit gestures whenever the preview content changes, and once now.
  window.addEventListener('vscode.markdown.updateContent', () => setupEditing());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setupEditing());
  } else {
    setupEditing();
  }
})();
