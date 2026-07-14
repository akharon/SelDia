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

export class SelDiAInteractiveProvider {
  public static currentPanel: SelDiAInteractiveProvider | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _engine: CoreEngine;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _messenger: WebviewMessenger;
  private readonly _editHandler: VisualEditHandler;

  private _currentSource: string = '';
  private _currentTheme: string = 'sketchy-light';
  private _viewMode: any = 'diagram';
  private _interactive: boolean = true;
  private _sourceUri: vscode.Uri | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    engine: CoreEngine,
    source: string,
    sourceUri?: vscode.Uri
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._engine = engine;
    this._currentSource = source;
    this._sourceUri = sourceUri || null;

    this._messenger = new WebviewMessenger();
    this._messenger.connect(panel.webview);

    const editCallbacks: EditHandlerCallbacks = {
      onDslPatch: (edit, offset, deleteLen) => this.applyDslPatch(edit, offset, deleteLen),
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

    // Initial render
    this.render();
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

    if (SelDiAInteractiveProvider.currentPanel) {
      SelDiAInteractiveProvider.currentPanel._panel.reveal(column);
      SelDiAInteractiveProvider.currentPanel.updateSource(source, sourceUri);
      return SelDiAInteractiveProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'seldiaInteractive',
      'SelDiA Interactive Diagram',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    SelDiAInteractiveProvider.currentPanel = new SelDiAInteractiveProvider(
      panel, extensionUri, engine, source, sourceUri
    );
    return SelDiAInteractiveProvider.currentPanel;
  }

  static reveal(): void {
    if (SelDiAInteractiveProvider.currentPanel) {
      SelDiAInteractiveProvider.currentPanel._panel.reveal();
    }
  }

  updateSource(source: string, sourceUri?: vscode.Uri): void {
    if (sourceUri) this._sourceUri = sourceUri;
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
      errorMsg = (result.errors || []).map((e: any) => e.message).join('<br>');
    }

    const stats = result.ok
      ? `Nodes: ${renderResult.stats?.nodeCount || 0} | Edges: ${renderResult.stats?.edgeCount || 0}`
      : 'Compilation failed';

    // Send render data to webview
    this._messenger.sendRender(
      renderResult,
      this._currentTheme,
      this._interactive,
      this._viewMode
    );

    this._panel.webview.html = this.getHtmlContent(svgContent, stats, errorMsg, renderResult);
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
    #container {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    #container svg {
      width: 100%;
      height: 100%;
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
    .seldia-icon { width: 14px; height: 14px; vertical-align: -2px; color: currentColor; margin-right: 3px; }
  </style>
</head>
<body>
  ${ICON_SPRITE}
  <div class="toolbar">
    <span class="title">${icon('schema')} SelDiA Diagram</span>
    <span class="stats">${stats}</span>

    <span class="sep"></span>
    <button id="btnUndo" onclick="handleUndo()" disabled title="Undo (Ctrl+Z)">${icon('undo')} Undo</button>
    <button id="btnRedo" onclick="handleRedo()" disabled title="Redo (Ctrl+Shift+Z)">${icon('redo')} Redo</button>

    <span class="sep"></span>
    <button onclick="zoomIn()" title="Zoom In">${icon('zoom-in')}</button>
    <button onclick="zoomOut()" title="Zoom Out">${icon('zoom-out')}</button>
    <button onclick="fitToScreen()" title="Fit to screen">${icon('fit-screen')} Fit</button>
    <button onclick="resetZoom()" title="Reset zoom">1:1</button>

    <span class="sep"></span>
    <select id="themeSelect">
      <option value="sketchy-light" ${theme === 'sketchy-light' ? 'selected' : ''}>Sketchy Light</option>
      <option value="sketchy-dark" ${theme === 'sketchy-dark' ? 'selected' : ''}>Sketchy Dark</option>
      <option value="clean-light" ${theme === 'clean-light' ? 'selected' : ''}>Clean Light</option>
      <option value="clean-dark" ${theme === 'clean-dark' ? 'selected' : ''}>Clean Dark</option>
      <option value="mono" ${theme === 'mono' ? 'selected' : ''}>Mono</option>
    </select>

    <span class="sep"></span>
    <button id="btnAddNode" onclick="handleAddNode()" title="Add node">${icon('add-node')} Node</button>
    <button id="btnAddEdge" onclick="handleAddEdge()" title="Draw edge (click source, then target)">${icon('add-edge')} Edge</button>

    <span class="sep"></span>
    <button onclick="exportSvg()" title="Export SVG">${icon('download')} Export</button>
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
            } else if (edgeDrawSourceId !== id) {
              vscode.postMessage({ type: 'edgeAdded', sourceId: edgeDrawSourceId, targetId: id });
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
        // Handle edge addition
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

  private applyDslPatch(edit: string, offset: number, deleteLength: number): void {
    if (!this._sourceUri) return;

    // Apply the edit as a WorkspaceEdit
    const workspaceEdit = new vscode.WorkspaceEdit();

    if (deleteLength > 0) {
      // Replace range
      const startPos = this._panel.active ? this._panel.active : this._panel;
      const range = new vscode.Range(
        this._panel.title.length > 0 ? 0 : 0,
        offset,
        this._panel.title.length > 0 ? 0 : 0,
        offset + deleteLength
      );
      // Use full document range approach
      workspaceEdit.replace(this._sourceUri, new vscode.Range(0, 0, 0, 0), '');
      workspaceEdit.insert(this._sourceUri, new vscode.Position(0, 0), edit);
    } else {
      // Simple insert - add as comment for now; the real implementation
      // would find the correct position in the source
      this._currentSource = edit;
    }
  }

  dispose(): void {
    SelDiAInteractiveProvider.currentPanel = undefined;
    this._editHandler.reset();
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
