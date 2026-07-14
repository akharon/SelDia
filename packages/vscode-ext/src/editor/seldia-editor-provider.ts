// =============================================================================
// SelDiA — Custom Text Editor Provider (.sld files)
// =============================================================================
// Provides a split-pane editor for .sld files: DSL code on the left,
// interactive rendered diagram on the right.

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import { ICON_SPRITE, icon } from '../shared/icons.js';

export class SelDiAEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'seldia.seldiaEditor';

  public static register(context: vscode.ExtensionContext, engine: CoreEngine): vscode.Disposable {
    const provider = new SelDiAEditorProvider(context, engine);
    const registration = vscode.window.registerCustomEditorProvider(
      SelDiAEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    return registration;
  }

  private engine: CoreEngine;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    engine: CoreEngine
  ) {
    this.engine = engine;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')],
    };

    // Initial render
    webviewPanel.webview.html = await this.getHtmlForWebview(document, webviewPanel.webview);

    // Handle edits from the webview (the code textarea)
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        webviewPanel.webview.html = await this.getHtmlForWebview(document, webviewPanel.webview);
      }
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message: any) => {
      switch (message.type) {
        case 'codeEdit': {
          // Apply code edit from the textarea to the document
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          );
          edit.replace(document.uri, fullRange, message.text);
          await vscode.workspace.applyEdit(edit);

          // Update the webview with new compiled output
          webviewPanel.webview.html = await this.getHtmlForWebview(document, webviewPanel.webview);
          break;
        }
        case 'toggleView': {
          // Toggle between diagram, code, split views
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });
  }

  private async getHtmlForWebview(
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<string> {
    const source = document.getText();
    const result = await this.engine.compile(source, document.uri.fsPath);

    let svgContent = '';
    let errorMsg = '';
    let stats = '';

    if (result.ok) {
      svgContent = result.value.svg;
      stats = `Nodes: ${result.value.stats?.nodeCount || 0} | Edges: ${result.value.stats?.edgeCount || 0}`;
    } else {
      errorMsg = (result.errors || []).map((e: any) => e.message).join('\n');
    }

    const escapedSource = this.escapeHtml(source);
    const escapedSvg = svgContent ? this.escapeHtml(svgContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')) : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SelDiA Editor</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
    }
    .split-container {
      display: flex;
      height: 100vh;
      width: 100vw;
    }
    .code-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--vscode-editorWidget-border, #333);
      min-width: 300px;
    }
    .preview-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 300px;
      position: relative;
    }
    .pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-bottom: 1px solid var(--vscode-editorWidget-border, #333);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      flex-shrink: 0;
    }
    .pane-header .actions { display: flex; gap: 4px; }
    .pane-header .actions button {
      padding: 2px 8px;
      border: 1px solid #555;
      background: #333;
      color: #ccc;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .pane-header .actions button:hover { background: #444; }
    .code-area {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      padding: 16px;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
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
      background: var(--vscode-editor-background, #1e1e1e);
    }
    .preview-area svg {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      box-shadow: 0 2px 12px rgba(0,0,0,.2);
    }
    .error {
      color: #e53e3e;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      padding: 16px;
      line-height: 1.5;
    }
    .resize-handle {
      width: 4px;
      cursor: col-resize;
      background: var(--vscode-editorWidget-border, #333);
      flex-shrink: 0;
    }
    .resize-handle:hover { background: #0e639c; }
    .stats {
      font-size: 10px;
      color: #666;
      padding: 4px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      border-top: 1px solid var(--vscode-editorWidget-border, #333);
      flex-shrink: 0;
    }
    .seldia-icon { width: 14px; height: 14px; vertical-align: -2px; color: currentColor; margin-right: 3px; }
  </style>
</head>
<body>
  ${ICON_SPRITE}
  <div class="split-container">
    <!-- Code Pane -->
    <div class="code-pane">
      <div class="pane-header">
        <span>${icon('description')} DSL Code</span>
        <div class="actions">
          <button onclick="applyEdit()">Apply</button>
          <button onclick="document.getElementById('codeEditor').value='${escapedSource.replace(/'/g, "\\'").substring(0, 100)}...'">Reset</button>
        </div>
      </div>
      <textarea id="codeEditor" class="code-area" spellcheck="false">${escapedSource}</textarea>
      <div class="stats">${stats || ''}</div>
    </div>

    <!-- Resize Handle -->
    <div class="resize-handle" id="resizeHandle"></div>

    <!-- Preview Pane -->
    <div class="preview-pane">
      <div class="pane-header">
        <span>${icon('visibility')} Preview</span>
        <div class="actions">
          <button onclick="zoomIn()" title="Zoom In">${icon('zoom-in')}</button>
          <button onclick="zoomOut()" title="Zoom Out">${icon('zoom-out')}</button>
          <button onclick="exportSvg()" title="Export SVG">${icon('download')} SVG</button>
        </div>
      </div>
      <div class="preview-area" id="previewArea">
        ${result.ok ? svgContent : `<div class="error">${errorMsg}</div>`}
      </div>
      <div class="stats">Theme: sketchy-light</div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const codeEditor = document.getElementById('codeEditor');
    const previewArea = document.getElementById('previewArea');

    // ── Auto-apply on code change (debounced) ──────────────────────────
    let debounceTimer;
    codeEditor.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        vscode.postMessage({ type: 'codeEdit', text: codeEditor.value });
      }, 500);
    });

    // ── Resize split panes ─────────────────────────────────────────────
    const resizeHandle = document.getElementById('resizeHandle');
    let isResizing = false;
    let startX, startWidth;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      const codePane = document.querySelector('.code-pane');
      startWidth = codePane.offsetWidth;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const codePane = document.querySelector('.code-pane');
      const previewPane = document.querySelector('.preview-pane');
      const newWidth = startWidth + (e.clientX - startX);
      const totalWidth = document.body.offsetWidth - resizeHandle.offsetWidth;
      const pct = Math.max(20, Math.min(80, (newWidth / totalWidth) * 100));
      codePane.style.flex = '0 0 ' + pct + '%';
      previewPane.style.flex = '0 0 ' + (100 - pct) + '%';
    });

    document.addEventListener('mouseup', () => { isResizing = false; });

    // ── Zoom ───────────────────────────────────────────────────────────
    let svgScale = 1;
    function zoomIn() {
      svgScale = Math.min(svgScale * 1.2, 5);
      applyZoom();
    }
    function zoomOut() {
      svgScale = Math.max(svgScale / 1.2, 0.2);
      applyZoom();
    }
    function applyZoom() {
      const svg = previewArea.querySelector('svg');
      if (svg) {
        svg.style.transform = 'scale(' + svgScale + ')';
        svg.style.transformOrigin = 'top center';
      }
    }

    // ── Export ─────────────────────────────────────────────────────────
    function exportSvg() {
      const svg = previewArea.querySelector('svg');
      if (!svg) return;
      const s = new XMLSerializer().serializeToString(svg);
      const b = new Blob([s], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'diagram.seldia.svg';
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // ── Keyboard Shortcuts ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        vscode.postMessage({ type: 'codeEdit', text: codeEditor.value });
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
}
