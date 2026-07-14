// =============================================================================
// SelDiA — Code/Preview Split Panel
// =============================================================================
// Manages a split view for .sld files: DSL source code on one side,
// rendered diagram on the other, with synchronized scrolling and editing.

import * as vscode from 'vscode';
import { ICON_SPRITE, icon } from '../shared/icons.js';

export interface SplitPanelOptions {
  /** Initial view mode */
  initialMode?: 'diagram' | 'code' | 'split';
  /** Whether interactive editing is enabled */
  interactive?: boolean;
  /** The source text */
  source: string;
  /** The rendered SVG content */
  svgContent?: string;
  /** Error message if compilation failed */
  errorMessage?: string;
}

export class SplitPanel {
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri
  ) {
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  /**
   * Create a new split panel for a .sld file.
   */
  static create(
    extensionUri: vscode.Uri,
    options: SplitPanelOptions
  ): SplitPanel {
    const panel = vscode.window.createWebviewPanel(
      'seldiaSplitPanel',
      'SelDiA Editor',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    const splitPanel = new SplitPanel(panel, extensionUri);
    panel.webview.html = splitPanel.getContent(options);

    return splitPanel;
  }

  private getContent(options: SplitPanelOptions): string {
    const escapedSource = this.escapeHtml(options.source);

    let previewContent: string;
    if (options.svgContent) {
      previewContent = options.svgContent;
    } else if (options.errorMessage) {
      previewContent = `<div class="error">${this.escapeHtml(options.errorMessage)}</div>`;
    } else {
      previewContent = '<div class="empty-state">Compile to see diagram preview</div>';
    }

    const isSplit = (options.initialMode || 'split') === 'split';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SelDiA Split Panel</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
    }
    .container {
      display: flex;
      height: 100vh;
      width: 100vw;
    }
    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .pane-header {
      display: flex;
      align-items: center;
      padding: 4px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-bottom: 1px solid var(--vscode-editorWidget-border, #333);
      font-size: 11px;
      font-weight: 600;
      color: #888;
      flex-shrink: 0;
      gap: 8px;
    }
    .pane-header .title { margin-right: auto; }
    .pane-header button {
      padding: 2px 8px;
      border: 1px solid #555;
      background: #333;
      color: #ccc;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .pane-header button:hover { background: #444; }
    .code-pane { border-right: 1px solid var(--vscode-editorWidget-border, #333); }
    .code-textarea {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      padding: 16px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 13px;
      line-height: 1.5;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      tab-size: 4;
      overflow: auto;
    }
    .preview-area {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 24px;
      overflow: auto;
    }
    .preview-area svg {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      box-shadow: 0 2px 12px rgba(0,0,0,.2);
    }
    .error { color: #e53e3e; font-family: monospace; padding: 16px; white-space: pre-wrap; }
    .empty-state { color: #666; padding: 48px; text-align: center; font-style: italic; }
    .stats {
      font-size: 10px; color: #666; padding: 4px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-top: 1px solid var(--vscode-editorWidget-border, #333);
      flex-shrink: 0;
    }
    .seldia-icon { width: 14px; height: 14px; vertical-align: -2px; color: currentColor; margin-right: 3px; }
  </style>
</head>
<body>
  ${ICON_SPRITE}
  <div class="container">
    <div class="pane code-pane">
      <div class="pane-header">
        <span class="title">${icon('description')} Code</span>
        <button onclick="toggleView()">Toggle View</button>
      </div>
      <textarea class="code-textarea" id="codeEditor" spellcheck="false">${escapedSource}</textarea>
      <div class="stats">.sld file</div>
    </div>
    <div class="pane">
      <div class="pane-header">
        <span class="title">${icon('visibility')} Diagram Preview</span>
        <button onclick="zoomIn()" title="Zoom In">${icon('zoom-in')}</button>
        <button onclick="zoomOut()" title="Zoom Out">${icon('zoom-out')}</button>
        <button onclick="exportSvg()" title="Export SVG">${icon('download')} Export SVG</button>
      </div>
      <div class="preview-area" id="previewArea">
        ${previewContent}
      </div>
      <div class="stats">${options.interactive ? 'Interactive mode' : 'Read-only'}</div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const codeEditor = document.getElementById('codeEditor');
    const previewArea = document.getElementById('previewArea');
    let scale = 1;

    // Auto-sync on code change (debounced)
    let timer;
    codeEditor.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        vscode.postMessage({ type: 'codeEdit', text: codeEditor.value });
      }, 400);
    });

    function zoomIn() { scale = Math.min(scale * 1.2, 5); applyZoom(); }
    function zoomOut() { scale = Math.max(scale / 1.2, 0.2); applyZoom(); }
    function applyZoom() {
      const svg = previewArea.querySelector('svg');
      if (svg) { svg.style.transform = 'scale(' + scale + ')'; svg.style.transformOrigin = 'top center'; }
    }

    function exportSvg() {
      const svg = previewArea.querySelector('svg');
      if (!svg) return;
      const s = new XMLSerializer().serializeToString(svg);
      const b = new Blob([s], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'diagram.svg';
      a.click();
      URL.revokeObjectURL(a.href);
    }

    function toggleView() {
      vscode.postMessage({ type: 'toggleView' });
    }

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updatePreview') {
        previewArea.innerHTML = msg.svg || '<div class="error">' + msg.error + '</div>';
      }
    });
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  dispose(): void {
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
