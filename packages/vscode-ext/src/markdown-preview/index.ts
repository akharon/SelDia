// =============================================================================
// SelDiA — Markdown Preview Script
// =============================================================================
// Runs inside VS Code's built-in Markdown preview webview. It wires up each
// inline SelDiA diagram with three modes and their interactions:
//   • Preview — zoom / pan / export the rendered SVG
//   • Code    — read the DSL source
//   • Edit    — drag a node to move it, double-click a node to rename it
//
// Edit gestures are written back to the Markdown source by invoking extension
// commands through `command:` URIs (the sanctioned channel from the built-in
// preview to the extension host). All identity is keyed on the block id that
// the markdown-it plugin stamped onto the container.
// =============================================================================

(() => {
  const zoomState = new Map<string, number>();

  function init() {
    document.querySelectorAll('.seldia-diagram').forEach((c) => setupDiagram(c as HTMLElement));
  }

  function setupDiagram(container: HTMLElement) {
    if (container.dataset.seldiaSetup === 'true') return;
    container.dataset.seldiaSetup = 'true';

    const svg = container.querySelector('.seldia-diagram-svg svg') as SVGSVGElement | null;
    const blockId = container.dataset.seldiaBlock || container.id;
    const pad = parseFloat(container.dataset.seldiaPad || '20');
    let currentScale = zoomState.get(blockId) || 1;

    // ── Mode switching (Preview / Code / Edit) ──────────────────────────
    container.querySelectorAll<HTMLElement>('.seldia-mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.seldiaTargetMode || 'preview';
        container.dataset.seldiaMode = mode;
        container
          .querySelectorAll('.seldia-mode-btn')
          .forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    // Reflect the initial mode on the buttons.
    const initialMode = container.dataset.seldiaMode || 'preview';
    container.querySelectorAll<HTMLElement>('.seldia-mode-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.seldiaTargetMode === initialMode)
    );

    if (svg) setupZoom(container, svg, blockId, () => currentScale, (s) => (currentScale = s));
    setupSourceTools(container);
    if (svg) setupEditing(container, svg, blockId, pad);
  }

  // ── Zoom / export ──────────────────────────────────────────────────────
  function setupZoom(
    container: HTMLElement,
    svg: SVGSVGElement,
    blockId: string,
    getScale: () => number,
    setScale: (s: number) => void
  ) {
    const apply = (s: number) => {
      svg.style.transform = `scale(${s})`;
      svg.style.transformOrigin = 'top left';
      zoomState.set(blockId, s);
      setScale(s);
    };
    container.querySelector('.seldia-btn-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      apply(Math.min(getScale() * 1.3, 5));
    });
    container.querySelector('.seldia-btn-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      apply(Math.max(getScale() / 1.3, 0.2));
    });
    container.querySelector('.seldia-btn-reset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      apply(1);
    });
    container.querySelector('.seldia-btn-export')?.addEventListener('click', (e) => {
      e.stopPropagation();
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
    });
    container.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        apply(Math.max(0.2, Math.min(5, getScale() * (e.deltaY > 0 ? 0.9 : 1.1))));
      },
      { passive: false }
    );
    apply(getScale());
  }

  // ── Source copy ─────────────────────────────────────────────────────────
  function setupSourceTools(container: HTMLElement) {
    container.querySelector('.seldia-btn-copy-source')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = container.querySelector('.seldia-diagram-source code')?.textContent;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        const btn = e.target as HTMLElement;
        const prev = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => (btn.textContent = prev), 1500);
      } catch {
        /* clipboard unavailable */
      }
    });
  }

  // ── Edit mode: drag to move, double-click to rename ─────────────────────
  function setupEditing(container: HTMLElement, svg: SVGSVGElement, blockId: string, pad: number) {
    const nodes = svg.querySelectorAll<SVGGElement>('[data-seldia-node-id]');

    nodes.forEach((g) => {
      const nodeId = g.getAttribute('data-seldia-node-id') || '';

      // Double-click → rename (only meaningful in edit mode).
      g.addEventListener('dblclick', (e) => {
        if (container.dataset.seldiaMode !== 'edit') return;
        e.preventDefault();
        e.stopPropagation();
        const current = g.querySelector('text')?.textContent || '';
        runCommand('seldia.editNodeLabel', { blockId, nodeId, current });
      });

      // Drag → move.
      g.addEventListener('mousedown', (e) => {
        if (container.dataset.seldiaMode !== 'edit') return;
        e.preventDefault();
        e.stopPropagation();

        const startUser = toUserSpace(svg, e.clientX, e.clientY);
        const origin = g.getBBox(); // pre-drag position in SVG user units
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

  window.addEventListener('vscode.markdown.updateContent', () => init());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
