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
  constructor(private readonly engine: CoreEngine) {}

  resolveCustomTextEditor(
    doc: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    panel.webview.options = { enableScripts: true };
    panels.set(doc.uri.toString(), panel);
    panel.onDidDispose(() => panels.delete(doc.uri.toString()));

    updatePanel(panel, this.engine, doc);

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === doc.uri.toString()) {
        updatePanel(panel, this.engine, doc);
      }
    });
    panel.onDidDispose(() => changeSub.dispose());
  }
}

function updatePanel(
  panel: vscode.WebviewPanel,
  engine: CoreEngine,
  doc: vscode.TextDocument
) {
  if (!isMarpDocument(doc.getText())) {
    panel.webview.html = notMarpHtml();
    return;
  }
  try {
    const { html, css, slideCount, notes } = renderMarpDeck(engine, doc.getText());
    panel.webview.html = shellHtml(html, css, slideCount, notes);
  } catch (err: any) {
    panel.webview.html = `<pre>Marp render failed: ${escapeHtml(err?.message || String(err))}</pre>`;
  }
}

function notMarpHtml(): string {
  return `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 2em;">
  <p>This file isn't a Marp deck — add <code>marp: true</code> to its YAML front-matter to use the slide preview.</p>
  </body></html>`;
}

function shellHtml(slidesHtml: string, css: string, slideCount: number, notes: string[]): string {
  const notesJson = JSON.stringify(notes).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--vscode-editor-background); font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  #slides { flex: 1; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; background: repeating-conic-gradient(var(--vscode-editorWidget-background) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
  #slides svg { display: none; box-shadow: 0 4px 24px rgba(0,0,0,0.4); position: absolute; top: 50%; left: 50%; background: #fff; }
  #slides svg.active { display: block; }
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
  .seldia-diagram-svg svg { max-width: 100%; height: auto; }
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
</div>
<script>
(function() {
  const container = document.getElementById('slides');
  const notes = ${notesJson};

  const sections = Array.from(document.querySelectorAll('#slides section'));
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
    active.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  }

  const notesEl = document.getElementById('notes');
  const notesToggle = document.getElementById('notesToggle');
  const presentBtn = document.getElementById('present');

  function render() {
    sections.forEach((s, i) => s.classList.toggle('active', i === idx));
    document.getElementById('counter').textContent = sections.length ? (idx + 1) + ' / ' + sections.length : '';
    notesEl.textContent = notes[idx] || '';
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
