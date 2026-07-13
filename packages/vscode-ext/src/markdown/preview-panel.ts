// =============================================================================
// SelDiA — Markdown Preview Panel
// =============================================================================
// A custom webview for full-size interactive diagram preview.

import * as vscode from 'vscode';
import { createEngine, type CoreEngine } from '@seldia/core';

export class SelDiAPreviewPanel {
  public static currentPanel: SelDiAPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private engine: CoreEngine;
  private currentSource: string = '';
  private currentTheme: string = 'sketchy-light';

  private constructor(panel: vscode.WebviewPanel, source: string) {
    this._panel = panel;
    this.engine = createEngine();
    this.currentSource = source;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(this.handleMessage, this, this._disposables);
    this.render();

    // Listen for theme changes
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      this.currentTheme = theme.kind === vscode.ColorThemeKind.Dark ? 'sketchy-dark' : 'sketchy-light';
      this.render();
    });
  }

  static createOrShow(source: string): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SelDiAPreviewPanel.currentPanel) {
      SelDiAPreviewPanel.currentPanel._panel.reveal(column);
      SelDiAPreviewPanel.currentPanel.updateSource(source);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'seldiaPreview',
      'SelDiA Diagram Preview',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    SelDiAPreviewPanel.currentPanel = new SelDiAPreviewPanel(panel, source);
  }

  static reveal(): void {
    if (SelDiAPreviewPanel.currentPanel) {
      SelDiAPreviewPanel.currentPanel._panel.reveal();
    }
  }

  updateSource(source: string): void {
    if (source !== this.currentSource) {
      this.currentSource = source;
      this.render();
    }
  }

  private async render(): Promise<void> {
    const theme = this.engine.getTheme(this.currentTheme);
    const result = await this.engine.compile(this.currentSource);

    const svgContent = result.ok
      ? result.value.svg
      : `<div class="error">❌ ${(result.errors || []).map((e: any) => e.message).join('<br>')}</div>`;

    const stats = result.ok
      ? `Nodes: ${result.value.stats.nodeCount} | Edges: ${result.value.stats.edgeCount} | Size: ${result.value.width}×${result.value.height}`
      : 'Compilation failed';

    this._panel.webview.html = this.getHtmlContent(svgContent, stats);
  }

  private getHtmlContent(svgContent: string, stats: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SelDiA Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #ccc);
      overflow: auto;
    }
    .toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 16px;
      background: var(--vscode-editor-inactiveSelectionBackground, #333);
      border-bottom: 1px solid var(--vscode-editorWidget-border, #555);
      font-size: 12px;
      flex-wrap: wrap;
    }
    .toolbar .title { font-weight: 600; margin-right: auto; }
    .toolbar .stats { color: #888; font-size: 11px; }
    .toolbar button {
      padding: 4px 10px;
      border: 1px solid var(--vscode-button-border, #555);
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }
    .toolbar button:hover { opacity: 0.85; }
    .toolbar select {
      padding: 3px 6px;
      border: 1px solid #555;
      background: var(--vscode-dropdown-background, #333);
      color: var(--vscode-dropdown-foreground, #ccc);
      border-radius: 4px;
      font-size: 11px;
    }
    .diagram-container {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 32px;
      min-height: calc(100vh - 48px);
    }
    .diagram-container svg {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,.15);
      background: var(--vscode-editor-background, #fff);
    }
    .error { color: #e53e3e; padding: 24px; font-family: monospace; font-size: 14px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">📐 SelDiA Preview</span>
    <span class="stats">${stats}</span>
    <select id="themeSelect">
      <option value="sketchy-light">Sketchy Light</option>
      <option value="sketchy-dark">Sketchy Dark</option>
      <option value="clean-light">Clean Light</option>
      <option value="clean-dark">Clean Dark</option>
      <option value="mono">Mono</option>
    </select>
    <button onclick="zoomIn()">🔍+</button>
    <button onclick="zoomOut()">🔍−</button>
    <button onclick="resetView()">⟲ Reset</button>
    <button onclick="exportSvg()">📥 Export SVG</button>
  </div>
  <div class="diagram-container" id="container">
    ${svgContent}
  </div>
  <script>
    let scale = 1;
    const container = document.getElementById('container');
    const svg = container.querySelector('svg');
    document.getElementById('themeSelect').value = '${this.currentTheme}';

    document.getElementById('themeSelect').addEventListener('change', (e) => {
      window.parent.postMessage({ type: 'changeTheme', theme: e.target.value }, '*');
    });

    function zoomIn() { scale = Math.min(scale * 1.2, 5); applyZoom(); }
    function zoomOut() { scale = Math.max(scale / 1.2, 0.2); applyZoom(); }
    function resetView() { scale = 1; applyZoom(); }
    function applyZoom() {
      if (svg) {
        svg.style.transform = 'scale(' + scale + ')';
        svg.style.transformOrigin = 'top center';
      }
    }
    function exportSvg() {
      const s = new XMLSerializer().serializeToString(document.querySelector('svg'));
      const b = new Blob([s], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'diagram.svg';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  </script>
</body>
</html>`;
  }

  private handleMessage = (message: any): void => {
    switch (message.type) {
      case 'changeTheme':
        this.currentTheme = message.theme;
        this.render();
        break;
    }
  };

  dispose(): void {
    SelDiAPreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
