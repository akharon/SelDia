// =============================================================================
// SelDiA — Marp Slide Preview Panel
// =============================================================================
// Marp decks are page-based (one <section> per slide with its own CSS
// dimensions), not a linear scrolling document, so they don't fit VS Code's
// built-in Markdown preview model. This owns a dedicated webview panel that
// shows one slide at a time with prev/next navigation, and re-renders as you
// type (debounced) so SelDiA/Mermaid/PlantUML diagrams inside slides stay live.
// =============================================================================

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import { renderMarpDeck, SHRINK_DIAGRAMS_TO_FIT_JS } from './render.js';
import { isMarpDocument } from './detect.js';

export const MARP_VIEW_TYPE = 'seldia.marpPreview';

const panels = new Map<string, vscode.WebviewPanel>();

/** Opens the Marp panel programmatically (command / auto-open path). Reuses
 *  the CustomTextEditorProvider's own panel tracking where possible by just
 *  opening the document with our custom editor. */
export async function openMarpPreview(
  context: vscode.ExtensionContext,
  engine: CoreEngine,
  doc: vscode.TextDocument,
  /** When true the panel opens without taking focus. Auto-open on document
   *  open uses this so the caret stays in the editor the user just opened;
   *  the explicit command leaves it false and focuses the deck. */
  preserveFocus = false
) {
  await vscode.commands.executeCommand('vscode.openWith', doc.uri, MARP_VIEW_TYPE, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus,
  });
}

export class MarpPreviewProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly engine: CoreEngine,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveCustomTextEditor(
    doc: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    panels.set(doc.uri.toString(), panel);

    updatePanel(panel, this.engine, doc);

    const messageSub = panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'export') {
        vscode.commands.executeCommand('seldia.exportMarp', doc.uri);
      }
    });

    // Re-rendering a deck means a full Marp render plus a compile of every
    // fenced diagram in it, and reassigning webview.html rebuilds the whole
    // DOM (losing the current slide). Debounce so that only lands once the
    // author pauses, rather than on every keystroke.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== doc.uri.toString()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        updatePanel(panel, this.engine, doc);
      }, 300);
    });

    panel.onDidDispose(() => {
      if (timer) clearTimeout(timer);
      changeSub.dispose();
      messageSub.dispose();
      panels.delete(doc.uri.toString());
    });
  }
}

function updatePanel(
  panel: vscode.WebviewPanel,
  engine: CoreEngine,
  doc: vscode.TextDocument
) {
  if (!isMarpDocument(doc.getText())) {
    panel.webview.html = notMarpHtml(panel.webview.cspSource);
    return;
  }
  try {
    const { html, css, slideCount, notes } = renderMarpDeck(engine, doc.getText());
    panel.webview.html = shellHtml(html, css, slideCount, notes, panel.webview.cspSource);
  } catch (err: any) {
    const csp = `default-src 'none'; style-src 'unsafe-inline'`;
    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><pre>Marp render failed: ${escapeHtml(err?.message || String(err))}</pre></body></html>`;
  }
}

function notMarpHtml(cspSource: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 2em;">
  <p>This file isn't a Marp deck — add <code>marp: true</code> to its YAML front-matter to use the slide preview.</p>
  </body></html>`;
}

function shellHtml(slidesHtml: string, css: string, slideCount: number, notes: string[], cspSource: string): string {
  const notesJson = JSON.stringify(notes).replace(/</g, '\\u003c');
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    // TODO: move the shell's inline <script> to a nonce instead of
    // 'unsafe-inline' — deferred, not required for the resource-root/CSP
    // hardening this was added for.
    `script-src 'unsafe-inline'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--vscode-editor-background); font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  #slides { flex: 1; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; background: repeating-conic-gradient(var(--vscode-editorWidget-background) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
  /* Marp's own theme CSS is scoped to "div.marpit > svg > foreignObject >
     section" — each slide is a top-level <svg data-marpit-svg> under
     div.marpit, wrapping a <foreignObject><section>. Toggle visibility and
     scale on that outer <svg> so the selector chain (and Marp's styling)
     stays intact; unwrapping to bare <section> would lose all Marp CSS. */
  #slides div.marpit { display: contents; }
  /* Marp's default theme resolves its text color through light-dark(), which
     tracks our root color-scheme (set to "light dark" so VS Code chrome
     follows the editor theme) rather than the slide's own background — so a
     default-theme deck can end up with light-on-light text in a dark VS Code
     theme. Pin the default-theme token to its light value; a deck's own
     custom CSS (e.g. a themed slide class) still overrides this normally. */
  #slides section { --fgColor-default: #1f2328 !important; }
  #slides svg[data-marpit-svg] { display: none; box-shadow: 0 4px 24px rgba(0,0,0,0.4); flex: none; }
  #slides svg[data-marpit-svg].active { display: block; }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); font-size: 12px; }
  #toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #toolbar button.toggled { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #counter { margin-left: auto; opacity: 0.7; }
  #notes { display: none; padding: 8px 14px; max-height: 30%; overflow-y: auto; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); font-size: 12px; white-space: pre-wrap; background: var(--vscode-editorWidget-background); }
  #notes.visible { display: block; }
  #notes:empty::before { content: '(no speaker notes on this slide)'; opacity: 0.5; font-style: italic; }
  body.presenting #toolbar, body.presenting #notes { display: none !important; }
  body.presenting #slides { background: #000; }
  .seldia-diagram-source, .seldia-diagram-toolbar { display: none; }
  .seldia-diagram-svg { box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .seldia-diagram-svg svg { display: block; width: 100%; height: 100%; max-width: 100%; object-fit: contain; }
  ${css}
</style>
</head>
<body>
<div id="slides">${slidesHtml}</div>
<div id="notes"></div>
<div id="toolbar">
  <button id="prev">&larr; Prev</button>
  <button id="next">Next &rarr;</button>
  <button id="notesToggle">Notes</button>
  <button id="present">Present &#9654;</button>
  <span id="counter"></span>
  <button id="export">Export&hellip;</button>
</div>
<script>
${SHRINK_DIAGRAMS_TO_FIT_JS}
(function() {
  const vscode = acquireVsCodeApi();
  const container = document.getElementById('slides');
  const notes = ${notesJson};

  const sections = Array.from(document.querySelectorAll('#slides svg[data-marpit-svg]'));
  let idx = 0;

  function fit() {
    const active = sections[idx];
    if (!active) return;
    const viewBox = active.getAttribute('viewBox');
    let naturalW = 1280, naturalH = 720;
    if (viewBox) {
      const parts = viewBox.split(/\\s+/).map(Number);
      if (parts.length === 4) { naturalW = parts[2]; naturalH = parts[3]; }
    }
    const pad = 24;
    const availW = container.clientWidth - pad * 2;
    const availH = container.clientHeight - pad * 2;
    const scale = Math.max(0.05, Math.min(availW / naturalW, availH / naturalH));
    active.style.width = naturalW + 'px';
    active.style.height = naturalH + 'px';
    active.style.transform = 'scale(' + scale + ')';
  }

  const notesEl = document.getElementById('notes');
  const notesToggle = document.getElementById('notesToggle');
  const presentBtn = document.getElementById('present');

  function render() {
    sections.forEach((s, i) => s.classList.toggle('active', i === idx));
    document.getElementById('counter').textContent = sections.length ? (idx + 1) + ' / ' + sections.length : '';
    notesEl.textContent = notes[idx] || '';
    // Measure before fit() applies its scale transform: shrinkDiagramsToFit
    // needs the section's natural (unscaled) box so the max-height it writes
    // is in the same 1280x720 coordinate space the SVG's own viewBox uses.
    const active = sections[idx];
    if (active && !active.dataset.seldiaShrunk) {
      shrinkDiagramsToFit(active);
      active.dataset.seldiaShrunk = '1';
    }
    fit();
  }

  document.getElementById('prev').addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
  document.getElementById('next').addEventListener('click', () => { idx = Math.min(sections.length - 1, idx + 1); render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { idx = Math.min(sections.length - 1, idx + 1); render(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { idx = Math.max(0, idx - 1); render(); }
    if (e.key === 'Escape' && document.body.classList.contains('presenting')) { exitPresent(); }
    if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) { togglePresent(); }
  });
  window.addEventListener('resize', fit);

  notesToggle.addEventListener('click', () => {
    notesEl.classList.toggle('visible');
    notesToggle.classList.toggle('toggled', notesEl.classList.contains('visible'));
    fit();
  });

  function enterPresent() {
    document.body.classList.add('presenting');
    presentBtn.classList.add('toggled');
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    fit();
  }
  function exitPresent() {
    document.body.classList.remove('presenting');
    presentBtn.classList.remove('toggled');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    fit();
  }
  function togglePresent() {
    if (document.body.classList.contains('presenting')) exitPresent(); else enterPresent();
  }
  presentBtn.addEventListener('click', togglePresent);
  document.getElementById('export').addEventListener('click', () => {
    vscode.postMessage({ type: 'export' });
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('presenting')) exitPresent();
  });
  document.getElementById('slides').addEventListener('dblclick', togglePresent);

  render();
})();
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
