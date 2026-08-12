// =============================================================================
// SelDiA — Marp Slide Preview Panel
// =============================================================================
// Marp decks are page-based (one <section> per slide with its own CSS
// dimensions), not a linear scrolling document, so they don't fit VS Code's
// built-in Markdown preview model. This owns a dedicated webview panel that
// shows one slide at a time with prev/next navigation, and re-renders on save
// so SelDiA/Mermaid/PlantUML diagrams inside slides stay live.
// =============================================================================

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import { renderMarpDeck } from './render.js';

const panels = new Map<string, vscode.WebviewPanel>();

export function openMarpPreview(context: vscode.ExtensionContext, engine: CoreEngine, doc: vscode.TextDocument) {
  const key = doc.uri.toString();
  const existing = panels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    updatePanel(existing, engine, doc);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'seldia.marpPreview',
    `Marp Preview: ${doc.fileName.split('/').pop()}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));

  updatePanel(panel, engine, doc);

  const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() === key) updatePanel(panel, engine, doc);
  });
  panel.onDidDispose(() => changeSub.dispose());
}

function updatePanel(panel: vscode.WebviewPanel, engine: CoreEngine, doc: vscode.TextDocument) {
  try {
    const { html, css, slideCount } = renderMarpDeck(engine, doc.getText());
    panel.webview.html = shellHtml(html, css, slideCount);
  } catch (err: any) {
    panel.webview.html = `<pre>Marp render failed: ${escapeHtml(err?.message || String(err))}</pre>`;
  }
}

function shellHtml(slidesHtml: string, css: string, slideCount: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: var(--vscode-editor-background); font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; }
  #slides { flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  #slides section { display: none; box-shadow: 0 2px 12px rgba(0,0,0,0.3); }
  #slides section.active { display: block; }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); font-size: 12px; }
  #toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #counter { margin-left: auto; opacity: 0.7; }
  .seldia-diagram-source, .seldia-diagram-toolbar { display: none; }
  .seldia-diagram-svg svg { max-width: 100%; height: auto; }
  ${css}
</style>
</head>
<body>
<div id="slides">${slidesHtml}</div>
<div id="toolbar">
  <button id="prev">&larr; Prev</button>
  <button id="next">Next &rarr;</button>
  <span id="counter"></span>
</div>
<script>
(function() {
  const sections = Array.from(document.querySelectorAll('#slides section'));
  let idx = 0;
  function render() {
    sections.forEach((s, i) => s.classList.toggle('active', i === idx));
    document.getElementById('counter').textContent = sections.length ? (idx + 1) + ' / ' + sections.length : '';
  }
  document.getElementById('prev').addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
  document.getElementById('next').addEventListener('click', () => { idx = Math.min(sections.length - 1, idx + 1); render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { idx = Math.min(sections.length - 1, idx + 1); render(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { idx = Math.max(0, idx - 1); render(); }
  });
  render();
})();
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
