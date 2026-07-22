// =============================================================================
// SelDiA — Interactive Diagram Webview Provider
// =============================================================================
// Provides the webview panel for interactive diagram editing in VS Code.
// Supports zoom/pan, drag-drop node repositioning, double-click label editing,
// right-click context menus, undo/redo, edge rerouting, and node resizing.

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import { WebviewMessenger } from './messenger.js';
import type { WebviewToExtMessage } from '../types.js';
import { VisualEditHandler, type EditHandlerCallbacks } from './edit-handler.js';
import { ICON_SPRITE, icon } from '../shared/icons.js';
import { computePositionEdit } from '../edit/position-patch.js';
import { findBlockById, findSelDiABlocks, type SelDiABlockLoc } from '../edit/blocks.js';

// -----------------------------------------------------------------------------
// Custom text editor registration (.sld files)
// -----------------------------------------------------------------------------
// The interactive provider *is* the registered custom editor for .sld —
// there is no separate split-pane editor implementation. VS Code hands us a
// per-document WebviewPanel, so editor instances are naturally per-document
// (fixing the old cross-wiring where one global panel was silently retargeted
// between files). The command entry points (`seldia.openInteractive` etc.)
// share the same per-uri instance via `createOrShow`.
export class SelDiAEditorRegistration implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'seldia.seldiaEditor';

  public static register(context: vscode.ExtensionContext, engine: CoreEngine): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      SelDiAEditorRegistration.viewType,
      new SelDiAEditorRegistration(context.extensionUri, engine),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _engine: CoreEngine
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };
    SelDiAInteractiveProvider.adopt(
      webviewPanel, this._extensionUri, this._engine, document.getText(), document.uri
    );
  }
}

export class SelDiAInteractiveProvider {
  /** Per-document instances, keyed by source uri. One .sld file = one panel;
   *  a second file gets its own panel with its own undo history and edit
   *  state, never a retargeted shared one. */
  private static panels = new Map<string, SelDiAInteractiveProvider>();

  /** Back-compat accessor: the most recently created/used panel, if any. */
  public static get currentPanel(): SelDiAInteractiveProvider | undefined {
    let last: SelDiAInteractiveProvider | undefined;
    for (const p of SelDiAInteractiveProvider.panels.values()) last = p;
    return last;
  }

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _engine: CoreEngine;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _messenger: WebviewMessenger;
  private readonly _editHandler: VisualEditHandler;

  private _currentSource: string = '';
  private _htmlInitialized = false;
  private _currentTheme: string = 'sketchy-light';
  private _viewMode: any = 'diagram';
  private _interactive: boolean = true;
  private _sourceUri: vscode.Uri | null = null;
  /** When set, this panel edits ONE ```seldia fence inside a Markdown
   *  document rather than a whole .sld file: `_currentSource` holds the fence
   *  contents, and every write-back is translated into a WorkspaceEdit on the
   *  fence's range in the .md. The id is re-derived after each edit because
   *  it hashes the fence source (see blocks.ts). */
  private _blockId: string | null = null;
  /** Last-known 0-based line of the block's opening fence; used to re-find
   *  the fence when a hand edit inside it changed the hash-derived id. */
  private _blockFenceLine: number = -1;
  /** Registry key this instance is stored under (block panels use
   *  `uri#L<line>`, whole-file panels use the uri). */
  private _registryKey: string | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    engine: CoreEngine,
    source: string,
    sourceUri?: vscode.Uri,
    blockId?: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._engine = engine;
    this._currentSource = source;
    this._sourceUri = sourceUri || null;
    this._blockId = blockId || null;

    this._messenger = new WebviewMessenger();
    this._messenger.connect(panel.webview);

    const editCallbacks: EditHandlerCallbacks = {
      onDslPatch: (edit, offset, deleteLen) => { void this.applyDslPatch(edit, offset, deleteLen); },
      onNodeMoved: (nodeId, x, y) => { void this.applyNodePosition(nodeId, x, y); },
      onRequestReRender: () => this.render(),
      onUndoRedoStateChange: (canUndo, canRedo) => {
        this._messenger.sendSyncUndoRedo(canUndo, canRedo);
      },
    };
    this._editHandler = new VisualEditHandler(engine, editCallbacks);

    // Set up message handling
    this._messenger.onMessage((msg: WebviewToExtMessage) => this.handleMessage(msg));
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._messenger.handleRawMessage(msg),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for theme changes
    this._disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this._currentTheme = theme.kind === vscode.ColorThemeKind.Dark ? 'sketchy-dark' : 'sketchy-light';
        this._messenger.sendUpdateTheme(this._currentTheme);
      })
    );

    // Follow the source document: hand edits in the text editor (and our own
    // WorkspaceEdits from drags/label edits) re-render the diagram. This is
    // incremental — after the first render, updates go over postMessage and
    // swap only the SVG, preserving zoom/pan/selection in the webview.
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this._sourceUri || e.document.uri.toString() !== this._sourceUri.toString()) return;
        if (this._blockId) {
          // Block mode: re-locate the fence in the changed Markdown and
          // follow it (id first, fence-line proximity as fallback for hand
          // edits inside the fence, which change the hash-derived id).
          const block = this.locateBlock(e.document.getText());
          if (!block) return; // fence removed — leave the last render standing
          this._blockId = block.blockId;
          this._blockFenceLine = block.fenceLine;
          if (block.source === this._currentSource) return;
          this._currentSource = block.source;
          void this.render();
          return;
        }
        const text = e.document.getText();
        if (text === this._currentSource) return;
        this._currentSource = text;
        void this.render();
      })
    );

    // Initial render
    this.render();
  }

  private static keyFor(sourceUri?: vscode.Uri): string {
    return sourceUri ? sourceUri.toString() : '<untitled>';
  }

  /** Wrap an externally created panel (the custom-editor path — VS Code owns
   *  the panel's lifecycle and it is per-document by contract). */
  static adopt(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    engine: CoreEngine,
    source: string,
    sourceUri: vscode.Uri
  ): SelDiAInteractiveProvider {
    const key = SelDiAInteractiveProvider.keyFor(sourceUri);
    const existing = SelDiAInteractiveProvider.panels.get(key);
    if (existing) existing.dispose();
    const provider = new SelDiAInteractiveProvider(panel, extensionUri, engine, source, sourceUri);
    SelDiAInteractiveProvider.panels.set(key, provider);
    return provider;
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    engine: CoreEngine,
    source: string,
    sourceUri?: vscode.Uri
  ): SelDiAInteractiveProvider {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const key = SelDiAInteractiveProvider.keyFor(sourceUri);
    const existing = SelDiAInteractiveProvider.panels.get(key);
    if (existing) {
      existing._panel.reveal(column);
      existing.updateSource(source, sourceUri);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'seldiaInteractive',
      sourceUri ? `SelDiA: ${sourceUri.path.split('/').pop()}` : 'SelDiA Interactive Diagram',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    const provider = new SelDiAInteractiveProvider(panel, extensionUri, engine, source, sourceUri);
    SelDiAInteractiveProvider.panels.set(key, provider);
    return provider;
  }

  static reveal(): void {
    SelDiAInteractiveProvider.currentPanel?._panel.reveal();
  }

  /** Open (or reveal) a visual editor for ONE ```seldia fence inside a
   *  Markdown document. The raw .md stays the source of truth: every visual
   *  edit becomes a WorkspaceEdit on the fence's range, live-visible in the
   *  text editor, undoable with the editor's own undo stack. */
  static createOrShowForBlock(
    extensionUri: vscode.Uri,
    engine: CoreEngine,
    docUri: vscode.Uri,
    block: SelDiABlockLoc
  ): SelDiAInteractiveProvider {
    // Key by document + fence line: stable across the source-hash id changing
    // with every edit, and distinct per fence so two fences in one file get
    // two independent panels.
    const key = `${docUri.toString()}#L${block.fenceLine}`;
    const existing = SelDiAInteractiveProvider.panels.get(key);
    if (existing) {
      existing._panel.reveal(vscode.ViewColumn.Beside);
      // Refresh identity/source in case the fence changed since the panel opened.
      existing._blockId = block.blockId;
      existing._blockFenceLine = block.fenceLine;
      existing.updateSource(block.source);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'seldiaInteractive',
      `SelDiA: ${docUri.path.split('/').pop()} · diagram @ line ${block.fenceLine + 1}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    const provider = new SelDiAInteractiveProvider(
      panel, extensionUri, engine, block.source, docUri, block.blockId
    );
    provider._blockFenceLine = block.fenceLine;
    provider._registryKey = key;
    SelDiAInteractiveProvider.panels.set(key, provider);
    return provider;
  }

  /** Find this panel's fence in the given Markdown text: by tracked id first
   *  (exact), then by opening-fence line proximity (survives hand edits inside
   *  the fence, which change the hash-derived id). */
  private locateBlock(markdown: string): SelDiABlockLoc | undefined {
    if (!this._blockId) return undefined;
    const byId = findBlockById(markdown, this._blockId);
    if (byId) return byId;
    const blocks = findSelDiABlocks(markdown);
    if (!blocks.length) return undefined;
    let best: SelDiABlockLoc | undefined;
    let bestDist = Infinity;
    for (const b of blocks) {
      const d = Math.abs(b.fenceLine - this._blockFenceLine);
      if (d < bestDist) { best = b; bestDist = d; }
    }
    // Only accept a proximity match that's plausibly the same fence — a
    // wildly different line means our fence was deleted, not moved.
    return bestDist <= 50 ? best : undefined;
  }

  updateSource(source: string, sourceUri?: vscode.Uri): void {
    if (!this._blockId && sourceUri && sourceUri.toString() !== this._sourceUri?.toString()) {
      // Re-key the panel registry if the target document changes.
      const oldKey = SelDiAInteractiveProvider.keyFor(this._sourceUri ?? undefined);
      if (SelDiAInteractiveProvider.panels.get(oldKey) === this) {
        SelDiAInteractiveProvider.panels.delete(oldKey);
      }
      this._sourceUri = sourceUri;
      SelDiAInteractiveProvider.panels.set(SelDiAInteractiveProvider.keyFor(sourceUri), this);
    }
    if (source !== this._currentSource) {
      this._currentSource = source;
      this.render();
    }
  }

  private async render(): Promise<void> {
    const result = await this._engine.compile(this._currentSource, this._sourceUri?.fsPath);
    let renderResult: any = null;
    let svgContent = '';
    let errorMsg = '';

    if (result.ok) {
      renderResult = result.value;
      svgContent = result.value.svg;
    } else {
      // Escape each message before joining with <br> — compiler errors can
      // quote source fragments containing '<', which must not become markup.
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      errorMsg = (result.errors || []).map((e: any) => esc(String(e.message))).join('<br>');
    }

    const stats = result.ok
      ? `Nodes: ${renderResult.stats?.nodeCount || 0} | Edges: ${renderResult.stats?.edgeCount || 0}`
      : 'Compilation failed';

    if (!this._htmlInitialized) {
      // First render: install the full page (styles, toolbar, script).
      this._panel.webview.html = this.getHtmlContent(svgContent, stats, errorMsg, renderResult);
      this._htmlInitialized = true;
    } else {
      // Subsequent renders: swap only the diagram content over postMessage so
      // the webview keeps its zoom/pan/selection/undo UI state. Replacing the
      // whole HTML here was the old behavior and it reset all of that on
      // every document change.
      this._panel.webview.postMessage({
        type: 'updateContent',
        svg: svgContent,
        error: errorMsg,
        stats,
        ir: renderResult,
      });
    }

    // Keep the typed render channel for listeners that track IR state.
    this._messenger.sendRender(
      renderResult,
      this._currentTheme,
      this._interactive,
      this._viewMode
    );
  }

  private getHtmlContent(svgContent: string, stats: string, errorMsg: string, renderResult: any): string {
    const theme = this._currentTheme;
    const isDark = theme.includes('dark');

    // Pass render result for interactive rendering
    const irJson = renderResult ? JSON.stringify(renderResult).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') : 'null';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SelDiA Interactive</title>
  <style>
    :root { --bg-color: ${isDark ? '#1e1e1e' : '#ffffff'}; --fg-color: ${isDark ? '#d4d4d4' : '#333333'}; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-color);
      color: var(--fg-color);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: ${isDark ? '#252526' : '#f3f3f3'};
      border-bottom: 1px solid ${isDark ? '#3c3c3c' : '#e0e0e0'};
      font-size: 12px;
      flex-wrap: wrap;
      flex-shrink: 0;
      user-select: none;
    }
    .toolbar .title { font-weight: 600; margin-right: auto; }
    .toolbar .stats { color: #888; font-size: 11px; margin-right: 12px; }
    .toolbar .sep { width: 1px; height: 20px; background: ${isDark ? '#3c3c3c' : '#ccc'}; margin: 0 4px; }
    .toolbar button, .toolbar select {
      padding: 3px 8px;
      border: 1px solid ${isDark ? '#555' : '#ccc'};
      background: ${isDark ? '#333' : '#fff'};
      color: var(--fg-color);
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .toolbar button:hover { background: ${isDark ? '#444' : '#e8e8e8'}; }
    .toolbar button:disabled { opacity: 0.4; cursor: default; }
    .toolbar button.active { background: #0e639c; color: #fff; border-color: #0e639c; }
    /* Icon-only buttons: square hit target, glyph centered, no label gap. */
    .toolbar button.icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 24px; padding: 0;
    }
    .toolbar button.icon-btn .seldia-icon { margin-right: 0; vertical-align: 0; }
    #container {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    #container svg {
      max-width: 100%;
      height: auto;
      display: block;
    }
    /* Label editor overlay */
    #labelEditor {
      display: none;
      position: absolute;
      z-index: 1000;
      background: ${isDark ? '#1e1e1e' : '#fff'};
      border: 2px solid #0e639c;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 13px;
      font-family: 'Caveat', 'Comic Sans MS', cursive;
      color: var(--fg-color);
      outline: none;
      min-width: 80px;
      box-shadow: 0 4px 12px rgba(0,0,0,.2);
    }
    /* Context menu */
    #contextMenu {
      display: none;
      position: absolute;
      z-index: 1001;
      background: ${isDark ? '#252526' : '#fff'};
      border: 1px solid ${isDark ? '#3c3c3c' : '#ccc'};
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,.25);
      min-width: 160px;
      padding: 4px 0;
    }
    #contextMenu .menu-item {
      padding: 6px 16px;
      cursor: pointer;
      font-size: 12px;
      color: var(--fg-color);
    }
    #contextMenu .menu-item:hover { background: #0e639c; color: #fff; }
    #contextMenu .menu-sep { height: 1px; background: ${isDark ? '#3c3c3c' : '#e0e0e0'}; margin: 4px 8px; }
    .error { color: #e53e3e; padding: 24px; font-family: monospace; font-size: 14px; }
    /* Selection highlight */
    .seldia-selected { outline: 2px solid #0e639c; outline-offset: 2px; }
    /* Edge draw mode */
    .edge-draw-line { stroke: #0e639c; stroke-width: 2; stroke-dasharray: 6,3; pointer-events: none; }
    /* Marks the source node while drawing a new edge (Edit mode). */
    .seldia-edge-source { outline: 2px dashed #0e639c; outline-offset: 3px; }
    .seldia-icon { width: 14px; height: 14px; vertical-align: -2px; color: currentColor; margin-right: 3px; }
  </style>
</head>
<body>
  ${ICON_SPRITE}
  <div class="toolbar">
    <span class="title">SelDiA Diagram</span>
    <span class="stats">${stats}</span>

    <span class="sep"></span>
    <button class="icon-btn" id="btnUndo" onclick="handleUndo()" disabled title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
    <button class="icon-btn" id="btnRedo" onclick="handleRedo()" disabled title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${icon('redo')}</button>

    <span class="sep"></span>
    <button class="icon-btn" onclick="zoomIn()" title="Zoom In" aria-label="Zoom in">${icon('zoom-in')}</button>
    <button class="icon-btn" onclick="zoomOut()" title="Zoom Out" aria-label="Zoom out">${icon('zoom-out')}</button>
    <button class="icon-btn" onclick="fitToScreen()" title="Fit to screen" aria-label="Fit to screen">${icon('fit-screen')}</button>
    <button class="icon-btn" onclick="resetZoom()" title="Reset zoom (1:1)" aria-label="Reset zoom">${icon('reset')}</button>

    <span class="sep"></span>
    <select id="themeSelect" title="Theme" aria-label="Theme">
      <option value="sketchy-light" ${theme === 'sketchy-light' ? 'selected' : ''}>Sketchy Light</option>
      <option value="sketchy-dark" ${theme === 'sketchy-dark' ? 'selected' : ''}>Sketchy Dark</option>
      <option value="clean-light" ${theme === 'clean-light' ? 'selected' : ''}>Clean Light</option>
      <option value="clean-dark" ${theme === 'clean-dark' ? 'selected' : ''}>Clean Dark</option>
      <option value="mono" ${theme === 'mono' ? 'selected' : ''}>Mono</option>
    </select>

    <span class="sep"></span>
    <button class="icon-btn" id="btnAddNode" onclick="handleAddNode()" title="Add node" aria-label="Add node">${icon('add-node')}</button>
    <button class="icon-btn" id="btnAddEdge" onclick="handleAddEdge()" title="Draw edge (click source, then target)" aria-label="Draw edge">${icon('add-edge')}</button>

    <span class="sep"></span>
    <button class="icon-btn" onclick="exportSvg()" title="Export SVG" aria-label="Export SVG">${icon('download')}</button>
  </div>

  <div id="container">
    ${svgContent || `<div class="error">${errorMsg || 'No diagram to render'}</div>`}
  </div>

  <!-- Label editor overlay -->
  <div id="labelEditor" contenteditable="true" spellcheck="false"></div>

  <!-- Context menu -->
  <div id="contextMenu">
    <div class="menu-item" data-action="edit-label">${icon('edit')} Edit Label</div>
    <div class="menu-item" data-action="edit-style">${icon('palette')} Edit Style</div>
    <div class="menu-item" data-action="change-shape">${icon('shape')} Change Shape</div>
    <div class="menu-sep"></div>
    <div class="menu-item" data-action="add-connected-node">${icon('add')} Add Connected Node</div>
    <div class="menu-item" data-action="add-edge">${icon('link')} Add Edge</div>
    <div class="menu-sep"></div>
    <div class="menu-item" data-action="delete">${icon('delete')} Delete</div>
  </div>

  <script>
    // ── State ──────────────────────────────────────────────────────────
    const vscode = acquireVsCodeApi();
    let scale = 1;
    let offsetX = 0, offsetY = 0;
    let editMode = 'idle';
    let selectedNodeId = null;
    let selectedEdgeId = null;
    let edgeDrawSourceId = null;
    let dragNodeId = null;
    let dragStartX = 0, dragStartY = 0;
    let isDragging = false;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let contextTargetId = null;
    let contextTargetType = null;
    let nodePositions = {};
    let irData = ${irJson};

    // ── Initialize ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
      initFromIR();
      vscode.postMessage({ type: 'ready' });
    });

    function initFromIR() {
      if (!irData) return;
      for (const n of irData.nodes) {
        nodePositions[n.id] = { x: n.x, y: n.y };
      }
    }

    // ── Zoom & Pan ─────────────────────────────────────────────────────
    const container = document.getElementById('container');

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, scale * delta));
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      offsetX = mx - (mx - offsetX) * (newScale / scale);
      offsetY = my - (my - offsetY) * (newScale / scale);
      scale = newScale;
      applyTransform();
    });

    container.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning = true;
        panStartX = e.clientX - offsetX;
        panStartY = e.clientY - offsetY;
        e.preventDefault();
        return;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isPanning) {
        offsetX = e.clientX - panStartX;
        offsetY = e.clientY - panStartY;
        applyTransform();
        return;
      }
    });

    document.addEventListener('mouseup', (e) => {
      isPanning = false;
    });

    function applyTransform() {
      const svg = container.querySelector('svg');
      if (svg) {
        svg.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
        svg.style.transformOrigin = '0 0';
      }
    }

    window.zoomIn = () => { scale = Math.min(scale * 1.3, 5); applyTransform(); };
    window.zoomOut = () => { scale = Math.max(scale / 1.3, 0.1); applyTransform(); };
    window.resetZoom = () => { scale = 1; offsetX = 0; offsetY = 0; applyTransform(); };
    window.fitToScreen = () => {
      const svg = container.querySelector('svg');
      if (!svg) return;
      const vb = svg.getAttribute('viewBox') || '0 0 800 600';
      const parts = vb.split(' ');
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const sx = cw / parseFloat(parts[2]);
      const sy = ch / parseFloat(parts[3]);
      scale = Math.min(sx, sy) * 0.9;
      offsetX = (cw - parseFloat(parts[2]) * scale) / 2;
      offsetY = (ch - parseFloat(parts[3]) * scale) / 2;
      applyTransform();
    };

    // ── Selection ──────────────────────────────────────────────────────
    container.addEventListener('click', (e) => {
      if (isPanning || e.button !== 0) return;
      const target = e.target.closest('[data-id]');
      if (target) {
        const id = target.getAttribute('data-id');
        const type = target.getAttribute('data-type');
        // In edge-draw mode, a plain click on a second node completes the
        // edge instead of changing selection — this is the toolbar-button
        // entry point into the same gesture the context menu's "Add Edge"
        // item already supports.
        if (editMode === 'drawing-edge' && type === 'node') {
          if (!edgeDrawSourceId) {
            edgeDrawSourceId = id;
            markEdgeDrawSource(id);
          } else if (edgeDrawSourceId !== id) {
            vscode.postMessage({ type: 'edgeAdded', sourceId: edgeDrawSourceId, targetId: id });
            clearEdgeDrawSource();
            edgeDrawSourceId = null;
            editMode = 'idle';
            document.getElementById('btnAddEdge').classList.remove('active');
            vscode.postMessage({ type: 'editModeChanged', mode: 'idle' });
          }
          return;
        }
        clearSelection();
        if (type === 'node') {
          selectedNodeId = id;
          target.setAttribute('data-selected', 'true');
        } else if (type === 'edge') {
          selectedEdgeId = id;
          target.setAttribute('data-selected', 'true');
        }
        updateUI();
      } else {
        clearSelection();
      }
    });

    container.addEventListener('dblclick', (e) => {
      const target = e.target.closest('[data-id]');
      if (!target) return;
      const id = target.getAttribute('data-id');
      const type = target.getAttribute('data-type');
      if (type === 'node') {
        const textEl = target.querySelector('text');
        if (textEl) {
          openLabelEditor(target, textEl.textContent, id, 'node');
        }
      } else if (type === 'edge') {
        const textEl = target.querySelector('text');
        if (textEl) {
          openLabelEditor(target, textEl.textContent, id, 'edge');
        } else {
          openLabelEditor(target, '', id, 'edge');
        }
      }
    });

    // ── Node Dragging ──────────────────────────────────────────────────
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.shiftKey || isPanning) return;
      const target = e.target.closest('[data-id][data-type="node"]');
      if (!target) return;
      const id = target.getAttribute('data-id');
      dragNodeId = id;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      isDragging = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragNodeId) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      if (!isDragging) {
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          isDragging = true;
        }
        return;
      }

      const svg = container.querySelector('svg');
      if (svg) {
        const el = svg.querySelector('[data-id="' + dragNodeId + '"]');
        if (el) {
          el.setAttribute('transform', 'translate(' + dx + ', ' + dy + ')');
        }
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (dragNodeId && isDragging) {
        const oldPos = nodePositions[dragNodeId];
        if (oldPos) {
          const dx = e.clientX - dragStartX + oldPos.x;
          const dy = e.clientY - dragStartY + oldPos.y;
          const screenX = e.clientX;
          const screenY = e.clientY;
          vscode.postMessage({
            type: 'nodeDragged',
            nodeId: dragNodeId,
            oldPosition: { x: oldPos.x, y: oldPos.y },
            newPosition: { x: dx, y: dy },
          });
          nodePositions[dragNodeId] = { x: dx, y: dy };
        }
      }
      dragNodeId = null;
      isDragging = false;
    });

    // ── Label Editor ───────────────────────────────────────────────────
    const labelEditor = document.getElementById('labelEditor');
    let editTargetId = null;
    let editTargetType = null;
    let editOldLabel = '';

    function openLabelEditor(relativeTo, currentLabel, id, type) {
      const rect = relativeTo.getBoundingClientRect();
      labelEditor.style.display = 'block';
      labelEditor.style.left = (rect.left + 10) + 'px';
      labelEditor.style.top = (rect.top + 10) + 'px';
      labelEditor.textContent = currentLabel;
      editTargetId = id;
      editTargetType = type;
      editOldLabel = currentLabel;
      labelEditor.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(labelEditor);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    labelEditor.addEventListener('blur', () => finishLabelEdit());
    labelEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); labelEditor.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); labelEditor.style.display = 'none'; }
    });

    function finishLabelEdit() {
      const newLabel = labelEditor.textContent.trim();
      labelEditor.style.display = 'none';
      if (editTargetId && newLabel && newLabel !== editOldLabel) {
        if (editTargetType === 'node') {
          vscode.postMessage({
            type: 'labelEdited',
            nodeId: editTargetId,
            oldLabel: editOldLabel,
            newLabel: newLabel,
          });
        } else if (editTargetType === 'edge') {
          vscode.postMessage({
            type: 'labelEdited',
            edgeId: editTargetId,
            oldLabel: editOldLabel,
            newLabel: newLabel,
          });
        }
      }
      editTargetId = null;
      editTargetType = null;
    }

    // ── Context Menu ───────────────────────────────────────────────────
    const contextMenu = document.getElementById('contextMenu');

    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = e.target.closest('[data-id]');
      if (target) {
        contextTargetId = target.getAttribute('data-id');
        contextTargetType = target.getAttribute('data-type');
      } else {
        contextTargetId = null;
        contextTargetType = null;
      }
      contextMenu.style.display = 'block';
      contextMenu.style.left = e.clientX + 'px';
      contextMenu.style.top = e.clientY + 'px';
    });

    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
      }
    });

    contextMenu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        contextMenu.style.display = 'none';
        handleContextAction(action);
      });
    });

    function handleContextAction(action) {
      const id = contextTargetId;
      const type = contextTargetType;
      switch (action) {
        case 'edit-label':
          if (id) {
            const el = container.querySelector('[data-id="' + id + '"]');
            if (el) {
              const textEl = el.querySelector('text');
              openLabelEditor(el, textEl ? textEl.textContent : '', id, type);
            }
          }
          break;
        case 'edit-style':
          if (id) {
            vscode.postMessage({ type: 'styleEdited', nodeId: id, stylePatch: {} });
          }
          break;
        case 'add-connected-node':
          if (id) {
            vscode.postMessage({ type: 'nodeAdded', connectFromId: id });
          }
          break;
        case 'add-edge':
          if (id && type === 'node') {
            if (!edgeDrawSourceId) {
              edgeDrawSourceId = id;
              document.getElementById('btnAddEdge').classList.add('active');
              markEdgeDrawSource(id);
            } else if (edgeDrawSourceId !== id) {
              vscode.postMessage({ type: 'edgeAdded', sourceId: edgeDrawSourceId, targetId: id });
              clearEdgeDrawSource();
              edgeDrawSourceId = null;
              document.getElementById('btnAddEdge').classList.remove('active');
            }
          }
          break;
        case 'change-shape':
          // Cycle through shapes as a demo
          if (id) {
            vscode.postMessage({ type: 'shapeChanged', nodeId: id, oldShape: 'rect', newShape: 'diamond' });
          }
          break;
        case 'delete':
          if (id) {
            if (type === 'node') vscode.postMessage({ type: 'nodeDeleted', nodeId: id });
            if (type === 'edge') vscode.postMessage({ type: 'edgeDeleted', edgeId: id });
          }
          break;
      }
    }

    // ── Toolbar Actions ────────────────────────────────────────────────
    window.handleUndo = () => { vscode.postMessage({ type: 'undoRequested' }); };
    window.handleRedo = () => { vscode.postMessage({ type: 'redoRequested' }); };
    window.handleAddNode = () => { vscode.postMessage({ type: 'nodeAdded' }); };
    window.handleAddEdge = () => {
      if (!edgeDrawSourceId) {
        // Enter edge drawing mode — next node click sets source
        document.getElementById('btnAddEdge').classList.add('active');
        vscode.postMessage({ type: 'editModeChanged', mode: 'drawing-edge' });
      } else {
        // Exit edge drawing mode
        edgeDrawSourceId = null;
        document.getElementById('btnAddEdge').classList.remove('active');
        vscode.postMessage({ type: 'editModeChanged', mode: 'idle' });
      }
    };

    // ── Theme ──────────────────────────────────────────────────────────
    document.getElementById('themeSelect').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'changeTheme', theme: e.target.value });
    });

    // ── Export ─────────────────────────────────────────────────────────
    window.exportSvg = () => {
      const svgEl = container.querySelector('svg');
      if (!svgEl) return;
      const s = new XMLSerializer().serializeToString(svgEl);
      const b = new Blob([s], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'diagram.svg';
      a.click();
      URL.revokeObjectURL(a.href);
    };

    // ── Keyboard shortcuts ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        clearSelection();
        labelEditor.style.display = 'none';
        contextMenu.style.display = 'none';
        edgeDrawSourceId = null;
        editMode = 'idle';
        clearEdgeDrawSource();
        document.getElementById('btnAddEdge').classList.remove('active');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        vscode.postMessage({ type: 'undoRequested' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        vscode.postMessage({ type: 'redoRequested' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        vscode.postMessage({ type: 'redoRequested' });
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodeId || selectedEdgeId)) {
        if (selectedNodeId) vscode.postMessage({ type: 'nodeDeleted', nodeId: selectedNodeId });
        if (selectedEdgeId) vscode.postMessage({ type: 'edgeDeleted', edgeId: selectedEdgeId });
      }
    });

    // ── Edge draw visual feedback ─────────────────────────────────────
    function markEdgeDrawSource(id) {
      const el = container.querySelector('[data-id="' + id + '"]');
      if (el) el.classList.add('seldia-edge-source');
    }
    function clearEdgeDrawSource() {
      container.querySelectorAll('.seldia-edge-source').forEach((el) => el.classList.remove('seldia-edge-source'));
    }

    // ── Helper functions ───────────────────────────────────────────────
    function clearSelection() {
      if (selectedNodeId) {
        const el = container.querySelector('[data-id="' + selectedNodeId + '"]');
        if (el) el.setAttribute('data-selected', 'false');
      }
      if (selectedEdgeId) {
        const el = container.querySelector('[data-id="' + selectedEdgeId + '"]');
        if (el) el.setAttribute('data-selected', 'false');
      }
      selectedNodeId = null;
      selectedEdgeId = null;
      updateUI();
    }

    function updateUI() {
      document.getElementById('btnUndo').disabled = false; // will be updated via sync
      document.getElementById('btnRedo').disabled = false;
    }

    // ── Message Handler (from extension) ───────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'render':
          if (msg.ir) {
            irData = msg.ir;
            nodePositions = {};
            initFromIR();
          }
          break;
        case 'updateContent': {
          // Incremental re-render: swap the diagram, keep zoom/pan/selection.
          if (msg.svg) {
            container.innerHTML = msg.svg;
          } else {
            // msg.error is pre-escaped by the extension host.
            const div = document.createElement('div');
            div.className = 'error';
            div.innerHTML = msg.error || 'No diagram to render';
            container.innerHTML = '';
            container.appendChild(div);
          }
          const statsEl = document.querySelector('.toolbar .stats');
          if (statsEl && msg.stats) statsEl.textContent = msg.stats;
          if (msg.ir) {
            irData = msg.ir;
            nodePositions = {};
            initFromIR();
          }
          // Re-apply the current zoom/pan to the fresh SVG and restore selection.
          applyTransform();
          if (selectedNodeId) {
            const sel = container.querySelector('[data-id="' + selectedNodeId + '"]');
            if (sel) sel.setAttribute('data-selected', 'true'); else selectedNodeId = null;
          }
          if (selectedEdgeId) {
            const sel = container.querySelector('[data-id="' + selectedEdgeId + '"]');
            if (sel) sel.setAttribute('data-selected', 'true'); else selectedEdgeId = null;
          }
          break;
        }
        case 'updateTheme':
          document.getElementById('themeSelect').value = msg.theme;
          break;
        case 'selectNode':
          clearSelection();
          const el = container.querySelector('[data-id="' + msg.nodeId + '"]');
          if (el) {
            selectedNodeId = msg.nodeId;
            el.setAttribute('data-selected', 'true');
          }
          break;
        case 'syncUndoRedo':
          document.getElementById('btnUndo').disabled = !msg.canUndo;
          document.getElementById('btnRedo').disabled = !msg.canRedo;
          break;
        case 'setEditMode':
          editMode = msg.mode;
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  // ── Message Handler (from webview) ──────────────────────────────────────

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this._messenger.sendSyncUndoRedo(this._editHandler.canUndo(), this._editHandler.canRedo());
        break;

      case 'nodeDragged':
        this._editHandler.handleNodeDrag(
          msg.nodeId,
          msg.oldPosition.x, msg.oldPosition.y,
          msg.newPosition.x, msg.newPosition.y
        );
        break;

      case 'nodeDoubleClicked':
        this._editHandler.handleNodeDoubleClick(msg.nodeId);
        break;

      case 'edgeDoubleClicked':
        this._editHandler.handleEdgeDoubleClick(msg.edgeId);
        break;

      case 'labelEdited': {
        if (msg.nodeId) {
          this._editHandler.handleLabelEdit(msg.nodeId, msg.oldLabel, msg.newLabel);
        } else if (msg.edgeId) {
          // Edge label editing handled similarly
        }
        // Re-render to reflect label changes
        this.render();
        break;
      }

      case 'nodeAdded':
        this._editHandler.handleNodeAdd(msg.parentId, msg.connectFromId);
        // Re-render
        setTimeout(() => this.render(), 100);
        break;

      case 'nodeDeleted':
        this._editHandler.handleNodeDelete(msg.nodeId);
        setTimeout(() => this.render(), 100);
        break;

      case 'edgeAdded':
        this._editHandler.handleEdgeAdd(msg.sourceId, msg.targetId);
        setTimeout(() => this.render(), 100);
        break;

      case 'edgeDeleted':
        this._editHandler.handleEdgeDelete(msg.edgeId);
        setTimeout(() => this.render(), 100);
        break;

      case 'edgeRerouted':
        this._editHandler.handleEdgeReroute(msg.edgeId, msg.newSourceId, msg.newTargetId);
        setTimeout(() => this.render(), 100);
        break;

      case 'undoRequested':
        this._editHandler.undo();
        break;

      case 'redoRequested':
        this._editHandler.redo();
        break;

      case 'exportRequested':
        // Handled via the export SVG button in webview
        break;

      case 'changeTheme':
        this._currentTheme = msg.theme;
        this.render();
        break;

      case 'styleEdited':
        this._editHandler.handleStyleEdit(msg.nodeId!, msg.stylePatch);
        break;

      case 'shapeChanged':
        // Shape changes handled via style
        break;

      case 'viewModeChanged':
        this._viewMode = msg.mode;
        this.render();
        break;

      case 'zoomChanged':
        break;
    }
  }

  // ── DSL Patch Application ─────────────────────────────────────────────

  /** Apply a `(text, offset, deleteLength)` patch — as produced by label
   *  edits, node/edge add/delete, reroute, and resize in edit-handler.ts —
   *  to the real document via a WorkspaceEdit at the correct offset.
   *
   *  Previously this either replaced the *entire* document with '' and
   *  inserted the patch text at position 0 (the `deleteLength > 0` branch,
   *  which discarded everything outside the intended range), or, for a pure
   *  insert (`deleteLength === 0`, e.g. add-node), silently reassigned
   *  `this._currentSource` without ever calling `applyEdit` — so nothing
   *  reached the document at all. Both paths are replaced with a single
   *  offset-accurate edit against `document.positionAt`, mirroring how
   *  `SelDiAEditorProvider`'s `codeEdit` handler already talks to the
   *  document elsewhere in this codebase. */
  /** In block mode, translate an offset relative to the fence source into an
   *  absolute offset in the Markdown document. Returns undefined if the fence
   *  can no longer be located (edit is dropped rather than mis-applied). */
  private blockBaseOffset(document: vscode.TextDocument): number | undefined {
    const block = this.locateBlock(document.getText());
    if (!block) return undefined;
    // The fence source starts at the beginning of sourceStartLine.
    return document.offsetAt(new vscode.Position(block.sourceStartLine, 0));
  }

  /** After a write-back into the fence, the block's hash-derived id changes;
   *  re-derive it from the fresh document so the next lookup still finds it. */
  private refreshBlockIdentity(document: vscode.TextDocument): void {
    if (!this._blockId) return;
    const blocks = findSelDiABlocks(document.getText());
    let best: SelDiABlockLoc | undefined;
    let bestDist = Infinity;
    for (const b of blocks) {
      const d = Math.abs(b.fenceLine - this._blockFenceLine);
      if (d < bestDist) { best = b; bestDist = d; }
    }
    if (best && bestDist <= 50) {
      this._blockId = best.blockId;
      this._blockFenceLine = best.fenceLine;
      this._currentSource = best.source;
    }
  }

  private async applyDslPatch(edit: string, offset: number, deleteLength: number): Promise<void> {
    if (!this._sourceUri) return;
    const document = await vscode.workspace.openTextDocument(this._sourceUri);

    // Block mode: `offset` is relative to the fence contents — shift it to
    // the fence's position inside the Markdown document.
    let base = 0;
    if (this._blockId) {
      const b = this.blockBaseOffset(document);
      if (b === undefined) return; // fence gone — drop the edit, never guess
      base = b;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    const startPos = document.positionAt(base + offset);
    if (deleteLength > 0) {
      const endPos = document.positionAt(base + offset + deleteLength);
      workspaceEdit.replace(this._sourceUri, new vscode.Range(startPos, endPos), edit);
    } else {
      workspaceEdit.insert(this._sourceUri, startPos, edit);
    }
    await vscode.workspace.applyEdit(workspaceEdit);
    if (this._blockId) {
      this.refreshBlockIdentity(document);
    } else {
      this._currentSource = document.getText();
    }
  }

  /** Write a dragged node's new position back into its declaration.
   *
   *  Reads the *current* document text (not the potentially-stale
   *  `_currentSource` captured when the drag started) so the merge in
   *  `computePositionEdit` operates on ground truth, then applies a single
   *  WorkspaceEdit that only touches that node's attribute block — every
   *  other node, and any hand edits made elsewhere in the file since the
   *  drag started, are left alone. This is the fix for "drag-to-edit loses
   *  hand-placed positions on re-render": the position was never written to
   *  the .sld source at all before this, so the very next compile (which
   *  always reads from the document) regenerated the auto layout and threw
   *  the drag away. */
  private async applyNodePosition(nodeId: string, x: number, y: number): Promise<void> {
    if (!this._sourceUri) return;
    const document = await vscode.workspace.openTextDocument(this._sourceUri);

    // Block mode: compute the patch against the fence contents (that's the
    // DSL the node declaration lives in), then shift the resulting range to
    // the fence's position inside the Markdown document.
    let base = 0;
    let source = document.getText();
    if (this._blockId) {
      const block = this.locateBlock(source);
      if (!block) return; // fence gone — drop the edit, never guess
      base = document.offsetAt(new vscode.Position(block.sourceStartLine, 0));
      source = block.source;
    }

    const edit = computePositionEdit(source, nodeId, x, y);
    if (!edit) return; // Node declaration not found by the line heuristic — leave the source untouched.

    const workspaceEdit = new vscode.WorkspaceEdit();
    const startPos = document.positionAt(base + edit.start);
    const endPos = document.positionAt(base + edit.end);
    workspaceEdit.replace(this._sourceUri, new vscode.Range(startPos, endPos), edit.text);
    await vscode.workspace.applyEdit(workspaceEdit);
    if (this._blockId) {
      this.refreshBlockIdentity(document);
    } else {
      this._currentSource = document.getText();
    }
  }

  dispose(): void {
    const key = this._registryKey ?? SelDiAInteractiveProvider.keyFor(this._sourceUri ?? undefined);
    if (SelDiAInteractiveProvider.panels.get(key) === this) {
      SelDiAInteractiveProvider.panels.delete(key);
    }
    this._editHandler.reset();
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
