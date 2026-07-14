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
      const prevMode = container.dataset.seldiaMode;
      // Leaving Code mode: flush the edited DSL back to the document so the
      // diagram re-renders with the changes. Done on mode-switch (not on every
      // keystroke) so typing stays smooth and the caret isn't lost mid-edit.
      if (prevMode === 'code' && mode !== 'code') {
        flushSourceEdit(container);
      }
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

  // ── Live source editing (Code mode) ──────────────────────────────────────
  // The DSL textarea is written back to the Markdown document only when the
  // user leaves Code mode (clicks Preview or Edit) — see the mode-switch
  // handler above — so typing never triggers a mid-edit re-render that would
  // reset the caret. The document change then re-renders the diagram.
  function flushSourceEdit(container: HTMLElement) {
    const ta = container.querySelector('.seldia-source-edit') as HTMLTextAreaElement | null;
    if (!ta) return;
    const blockId = container.dataset.seldiaBlock || container.id;
    const original = ta.defaultValue; // server-rendered source (pre-edit)
    if (ta.value === original) return; // nothing changed — skip the write
    runCommand('seldia.replaceBlockSource', { blockId, source: ta.value });
  }

  // Also flush if the whole preview loses focus while a diagram is in Code mode
  // (e.g. the user clicks back into the editor) so no edit is silently dropped.
  window.addEventListener('blur', () => {
    document.querySelectorAll<HTMLElement>('.seldia-diagram[data-seldia-mode="code"]').forEach(flushSourceEdit);
  });

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
    const ta = container.querySelector('.seldia-source-edit') as HTMLTextAreaElement | null;
    const code = ta?.value ?? container.querySelector('.seldia-diagram-source code')?.textContent;
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
  // Bound as DELEGATED listeners on `document` — the same pattern as the
  // toolbar buttons. VS Code's Markdown preview rebuilds the whole preview DOM
  // on every document change, which silently discards any listener attached to
  // a specific node; delegation on `document` survives every re-render and
  // needs no per-node (re)binding pass. Each handler resolves the node/diagram
  // from the event target at call time.

  /** Resolve the node <g>, its diagram container and identity from an event
   *  target, but only while that diagram is in edit mode. */
  function editTargetOf(target: EventTarget | null): {
    g: SVGGElement; container: HTMLElement; svg: SVGSVGElement; blockId: string; nodeId: string; pad: number;
  } | null {
    const el = target as Element | null;
    const g = el?.closest?.('[data-seldia-node-id]') as SVGGElement | null;
    if (!g) return null;
    const container = diagramOf(g);
    if (!container || container.dataset.seldiaMode !== 'edit') return null;
    const svg = svgOf(container);
    if (!svg) return null;
    return {
      g,
      container,
      svg,
      blockId: container.dataset.seldiaBlock || container.id,
      nodeId: g.getAttribute('data-seldia-node-id') || '',
      pad: parseFloat(container.dataset.seldiaPad || '20'),
    };
  }

  // Double-click a node → rename.
  document.addEventListener('dblclick', (e) => {
    const t = editTargetOf(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const current = t.g.querySelector('text')?.textContent || '';
    runCommand('seldia.editNodeLabel', { blockId: t.blockId, nodeId: t.nodeId, current });
  });

  // Press on a node → drag to move; release writes the new position back.
  document.addEventListener('mousedown', (e) => {
    if ((e as MouseEvent).button !== 0) return;
    const t = editTargetOf(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const { g, svg, blockId, nodeId, pad } = t;
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

  /** Invoke an extension command via a command: URI.
   *
   *  The toolbar's own `command:` links (auto layout, reveal source — see
   *  plugin.ts) are plain `<a href="command:...">` tags, and those are the
   *  channel VS Code's Markdown preview actually intercepts reliably: a click
   *  on an anchor whose href is a `command:` URI. Assigning
   *  `window.location.href` directly triggers a real top-level navigation
   *  attempt on the whole webview document; when that happens mid-drag (while
   *  global `mousemove`/`mouseup` listeners are still attached from
   *  `mousedown`) the in-flight navigation can blank the entire preview,
   *  every diagram included, before VS Code's interceptor cancels it. Using a
   *  real anchor click avoids ever starting that navigation. */
  function runCommand(command: string, arg: unknown) {
    const uri = `command:${command}?${encodeURIComponent(JSON.stringify([arg]))}`;
    const a = document.createElement('a');
    a.href = uri;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
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
