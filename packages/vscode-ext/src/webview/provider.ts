// =============================================================================
// SelDiA — Interactive Diagram Webview Provider
// =============================================================================
// Provides the webview panel for interactive diagram editing in VS Code.
// Supports zoom/pan, drag-drop node repositioning, double-click label editing,
// right-click context menus, undo/redo, edge rerouting, and node resizing.

import * as vscode from 'vscode';
import { createEngine, type CoreEngine, type DiagramIR } from '@seldia/core';
import { WebviewMessenger } from './messenger.js';
import type { WebviewToExtMessage } from '../types.js';
import { ICON_SPRITE, icon } from '../shared/icons.js';
import {
  computeAttrEdit, computeLabelEdit, computeEdgeLabelEdit,
  computeEdgeDeleteEdit, computeNodeDeleteEdits, computeAppendStatementEdit,
  type TextEdit,
} from '../edit/position-patch.js';
import { findBlockById, findSelDiABlocks, type SelDiABlockLoc } from '../edit/blocks.js';
import { computeFloorplanDragPatch } from '../edit/floorplan-drag.js';

/** Map the toolbar theme picker onto engine render config. The engine's
 *  theme channel is a palette id (`config.render.theme` → BUILTIN_PALETTES)
 *  plus the `sketchy` (Rough.js) flag — the "sketchy-light" default is the
 *  engine's out-of-the-box rendering. */
const THEME_RENDER_CONFIG: Record<string, { sketchy: boolean; theme?: string }> = {
  'sketchy-light': { sketchy: true },
  'sketchy-dark': { sketchy: true, theme: 'dark' },
  'clean-light': { sketchy: false },
  'clean-dark': { sketchy: false, theme: 'dark' },
  'mono': { sketchy: false, theme: 'high-contrast' },
};

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

  /** Engines configured for non-default themes, created lazily per theme id
   *  (the injected `_engine` renders the default "sketchy-light"). */
  private readonly _themedEngines = new Map<string, CoreEngine>();

  /** The laid-out IR from the last successful compile — the ground truth for
   *  node positions (drag write-back), edge endpoints (edge id → source/
   *  target), and id-uniqueness when adding nodes. */
  private _positionedIr: DiagramIR | null = null;

  /** Snapshot-based undo/redo over the edited source (the fence contents in
   *  block mode, the whole document otherwise). Every visual write-back
   *  pushes the pre-edit source; undo restores it with a WorkspaceEdit, so
   *  the text document stays the single source of truth. VS Code's own
   *  editor undo stack keeps working independently. */
  private _undoStack: string[] = [];
  private _redoStack: string[] = [];

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
  /** Trailing-debounce timer for document-change re-renders. Bursts of edits
   *  (a drag storm, fast typing in the fence) must collapse into ONE
   *  compile + ONE updateContent: every extra full-SVG swap is webview
   *  churn, and heavy churn is what provokes the intermittent Electron
   *  compositor bug that blanks the whole panel until it is reopened. */
  private _renderTimer: ReturnType<typeof setTimeout> | null = null;
  /** Signature of the last content pushed to the webview — identical
   *  re-renders (e.g. a document change that didn't touch this fence's
   *  output) are dropped instead of forcing a repaint. */
  private _lastSentSig: string | null = null;
  private _disposed = false;

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

    // Set up message handling
    this._messenger.onMessage((msg: WebviewToExtMessage) => this.handleMessage(msg));
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._messenger.handleRawMessage(msg),
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for theme changes — the theme drives the engine's palette and
    // sketchy flag now, so a VS Code theme flip re-renders the diagram too.
    this._disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this._currentTheme = theme.kind === vscode.ColorThemeKind.Dark ? 'sketchy-dark' : 'sketchy-light';
        this._messenger.sendUpdateTheme(this._currentTheme);
        void this.render();
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
          this.scheduleRender();
          return;
        }
        this.syncDirty();
        const text = e.document.getText();
        if (text === this._currentSource) return;
        this._currentSource = text;
        this.scheduleRender();
      })
    );

    // Keep the Save button's dirty dot honest when the document is saved or
    // reverted from outside this panel.
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (this._sourceUri && d.uri.toString() === this._sourceUri.toString()) this.syncDirty();
      })
    );

    // Initial render
    this.render();
    this.syncDirty();
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

  /** The engine to compile with for the current theme. */
  private engineForTheme(): CoreEngine {
    const cfg = THEME_RENDER_CONFIG[this._currentTheme];
    if (!cfg || this._currentTheme === 'sketchy-light') return this._engine;
    let eng = this._themedEngines.get(this._currentTheme);
    if (!eng) {
      eng = createEngine({
        config: {
          defaultLayoutEngine: (this._engine as any).config?.defaultLayoutEngine,
          render: cfg as any,
        },
      });
      this._themedEngines.set(this._currentTheme, eng);
    }
    return eng;
  }

  /** Trailing-debounced render — collapses change bursts into one compile. */
  private scheduleRender(): void {
    if (this._renderTimer) clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      void this.render();
    }, 150);
  }

  private async render(): Promise<void> {
    // Run the pipeline in stages (not engine.compile) so the laid-out IR is
    // captured before rendering: the webview needs each node's position to
    // turn a drag delta into new x/y, and the edit handlers need edge
    // endpoints / node ids. RenderResult alone carries none of that.
    const eng = this.engineForTheme();
    const fsPath = this._sourceUri?.fsPath;
    let svgContent = '';
    let errorMsg = '';
    let stats = 'Compilation failed';
    let nodes: Array<{ id: string; x: number; y: number }> = [];
    let fpScale: number | undefined;

    const r1 = eng.parse(this._currentSource, fsPath);
    const r2 = r1.ok ? eng.analyze(r1.value) : r1;
    const r3 = r2.ok ? eng.transform(r2.value) : r2;
    const r4 = r3.ok ? await eng.layoutAsync(r3.value) : r3;
    const result = r4.ok ? eng.render(r4.value) : r4;

    if (r4.ok && result.ok) {
      this._positionedIr = r4.value.diagram;
      nodes = r4.value.diagram.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
      fpScale = r4.value.diagram.metadata?.floorplanScale as number | undefined;
      svgContent = result.value.svg;
      stats = `Nodes: ${result.value.stats?.nodeCount || 0} | Edges: ${result.value.stats?.edgeCount || 0}`;
    } else {
      // Escape each message before joining with <br> — compiler errors can
      // quote source fragments containing '<', which must not become markup.
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const errs = (result as { ok: false; errors: any[] }).errors || [];
      errorMsg = errs.map((e: any) => esc(String(e.message))).join('<br>');
    }

    if (this._disposed) return;
    // NUL separators: neither the SVG, the stats line, nor an error message can
    // contain U+0000, so the joined signature is unambiguous. Written as an escape
    // rather than a literal NUL byte so the file stays plain text for grep/diff.
    const sig = `${svgContent}\0${stats}\0${errorMsg}`;
    if (!this._htmlInitialized) {
      // First render: install the full page (styles, toolbar, script).
      this._panel.webview.html = this.getHtmlContent(svgContent, stats, errorMsg, { nodes, fpScale });
      this._htmlInitialized = true;
      this._lastSentSig = sig;
    } else {
      // Subsequent renders: swap only the diagram content over postMessage so
      // the webview keeps its zoom/pan/selection/undo UI state. Replacing the
      // whole HTML here was the old behavior and it reset all of that on
      // every document change. Identical output is dropped entirely — no
      // repaint for a change that didn't alter this diagram.
      if (sig === this._lastSentSig) return;
      this._lastSentSig = sig;
      this._panel.webview.postMessage({
        type: 'updateContent',
        svg: svgContent,
        error: errorMsg,
        stats,
        ir: { nodes, fpScale },
      });
    }
  }

  private getHtmlContent(svgContent: string, stats: string, errorMsg: string, irPayload: { nodes: Array<{ id: string; x: number; y: number }>; fpScale?: number }): string {
    const theme = this._currentTheme;
    const isDark = theme.includes('dark');

    // Node id → laid-out position, for drag write-back in the webview.
    const irJson = JSON.stringify(irPayload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

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
    /* Unsaved visual edits: the Save button is the only place the panel can
       show that the document is dirty (a webview has no editor tab badge). */
    .toolbar button#btnSave.dirty { color: #e2b93d; border-color: #e2b93d; }
    .toolbar button#btnSave.dirty::after { content: '\\2022'; margin-left: 2px; font-size: 14px; line-height: 0; }
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
    /* Theme dropdown (custom, same visual family as the context menu) */
    #themeMenu {
      display: none;
      position: absolute;
      top: 100%; left: 0;
      z-index: 1002;
      background: ${isDark ? '#252526' : '#fff'};
      border: 1px solid ${isDark ? '#3c3c3c' : '#ccc'};
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,.25);
      min-width: 120px;
      padding: 4px 0;
    }
    #themeMenu .menu-item { padding: 5px 14px; cursor: pointer; font-size: 12px; color: var(--fg-color); white-space: nowrap; }
    #themeMenu .menu-item:hover { background: #0e639c; color: #fff; }
    #themeMenu .menu-item.selected { font-weight: 600; }
    .error { color: #e53e3e; padding: 24px; font-family: monospace; font-size: 14px; }
    /* Selection highlight */
    .seldia-selected { outline: 2px solid #0e639c; outline-offset: 2px; }
    [data-selected="true"] { filter: drop-shadow(0 0 3px #0e639c); }
    [data-type="node"], [data-type="edge"] { cursor: pointer; }
    /* Edge draw mode */
    .edge-draw-line { stroke: #0e639c; stroke-width: 2; stroke-dasharray: 6,3; pointer-events: none; }
    /* Marks the source node while drawing a new edge (Edit mode). */
    .seldia-edge-source { outline: 2px dashed #0e639c; outline-offset: 3px; }
    .seldia-icon { width: 14px; height: 14px; vertical-align: -2px; color: currentColor; margin-right: 3px; }
    /* Floorplan drag guides: live horizontal/vertical distance lines from the
       dragged item to the nearest wall or object sharing its x/y, drawn in the
       same dashed-blue language as the static dimension strings so they read
       as "more of the same system" rather than a different overlay. */
    #fpDragGuides { pointer-events: none; }
    #fpDragGuides .fp-guide-line { stroke: #2563eb; stroke-width: 1; stroke-dasharray: 4,3; }
    #fpDragGuides .fp-guide-tick { stroke: #2563eb; stroke-width: 1.2; }
    #fpDragGuides .fp-guide-text {
      font-size: 10.5px; font-weight: 600; fill: #2563eb;
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #fpDragGuides .fp-guide-pill { fill: ${isDark ? '#1e1e1e' : '#ffffff'}; opacity: 0.94; }
  </style>
</head>
<body>
  ${ICON_SPRITE}
  <div class="toolbar">
    <span class="title">SelDiA Diagram</span>
    <span class="stats">${stats}</span>

    <span class="sep"></span>
    <button class="icon-btn" id="btnSave" onclick="handleSave()" title="Save (Ctrl+S)" aria-label="Save">${icon('save')}</button>

    <span class="sep"></span>
    <button class="icon-btn" id="btnUndo" onclick="handleUndo()" disabled title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
    <button class="icon-btn" id="btnRedo" onclick="handleRedo()" disabled title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${icon('redo')}</button>

    <span class="sep"></span>
    <button class="icon-btn" onclick="zoomIn()" title="Zoom In" aria-label="Zoom in">${icon('zoom-in')}</button>
    <button class="icon-btn" onclick="zoomOut()" title="Zoom Out" aria-label="Zoom out">${icon('zoom-out')}</button>
    <button class="icon-btn" onclick="fitToScreen()" title="Fit to screen" aria-label="Fit to screen">${icon('fit-screen')}</button>
    <button class="icon-btn" onclick="resetZoom()" title="Reset zoom (1:1)" aria-label="Reset zoom">${icon('reset')}</button>

    <span class="sep"></span>
    <!-- Custom dropdown, NOT a native <select>: native popup surfaces spawned
         from an out-of-process webview iframe are a known Electron/Linux
         breakage point (invisible dropdowns, popup grabs that destabilize the
         whole workbench until restart). A plain positioned div stays inside
         the webview's own compositor surface. -->
    <span id="themeWrap" style="position:relative">
      <button id="themeBtn" title="Theme" aria-haspopup="listbox" aria-expanded="false">${
        ({ 'sketchy-light': 'Sketchy Light', 'sketchy-dark': 'Sketchy Dark', 'clean-light': 'Clean Light', 'clean-dark': 'Clean Dark', 'mono': 'Mono' } as Record<string, string>)[theme] ?? theme
      } ▾</button>
      <div id="themeMenu" role="listbox">
        <div class="menu-item" role="option" data-theme-value="sketchy-light">Sketchy Light</div>
        <div class="menu-item" role="option" data-theme-value="sketchy-dark">Sketchy Dark</div>
        <div class="menu-item" role="option" data-theme-value="clean-light">Clean Light</div>
        <div class="menu-item" role="option" data-theme-value="clean-dark">Clean Dark</div>
        <div class="menu-item" role="option" data-theme-value="mono">Mono</div>
      </div>
    </span>

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

  <!-- Context menu: data-scope controls which entries appear for a node,
       an edge, or the empty canvas -->
  <div id="contextMenu">
    <div class="menu-item" data-action="edit-label" data-scope="node edge">${icon('edit')} Edit Label</div>
    <div class="menu-item" data-action="edit-style" data-scope="node">${icon('palette')} Edit Style</div>
    <div class="menu-sep" data-scope="node"></div>
    <div class="menu-item" data-action="add-connected-node" data-scope="node">${icon('add')} Add Connected Node</div>
    <div class="menu-item" data-action="add-edge" data-scope="node">${icon('link')} Add Edge</div>
    <div class="menu-sep" data-scope="node edge"></div>
    <div class="menu-item" data-action="add-node" data-scope="canvas">${icon('add-node')} Add Node</div>
    <div class="menu-item" data-action="delete" data-scope="node edge">${icon('delete')} Delete</div>
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
      annotateSvg();
      initFromIR();
      vscode.postMessage({ type: 'ready' });
    });

    // The engine emits data-seldia-node-id / data-seldia-edge-id on the
    // per-element <g> wrappers; the interaction layer here keys everything
    // (click-select, drag, context menu, label editor) off data-id/data-type.
    // Bridge the two after every SVG install — without this, clicks find no
    // [data-id] ancestor and every action silently no-ops.
    function annotateSvg() {
      const map = [
        ['data-seldia-node-id', 'node'],
        ['data-seldia-edge-id', 'edge'],
        ['data-seldia-group-id', 'group'],
      ];
      for (const [attr, type] of map) {
        document.querySelectorAll('#container [' + attr + ']').forEach((el) => {
          el.setAttribute('data-id', el.getAttribute(attr));
          el.setAttribute('data-type', type);
        });
      }
    }

    function initFromIR() {
      nodePositions = {};
      if (!irData || !Array.isArray(irData.nodes)) return;
      for (const n of irData.nodes) {
        nodePositions[n.id] = { x: n.x, y: n.y };
      }
    }

    // Screen px → SVG user units. Accounts for BOTH the zoom transform and
    // the CSS max-width scaling (getBoundingClientRect sees the composite).
    // Without this, drag deltas were written back as raw screen pixels —
    // off by the scale factor whenever the diagram wasn't at exactly 1:1.
    function svgUnitsPerPixel() {
      const svg = container.querySelector('svg');
      if (!svg) return 1;
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      if (!vb || !vb.width || !rect.width) return 1;
      return vb.width / rect.width;
    }

    // ── Floorplan drag guides ────────────────────────────────────────────
    // While dragging a piece of furniture, show live horizontal and vertical
    // distance lines from it to the nearest wall or object that shares its
    // x-range (below/above) or y-range (left/right) — the same "what's my
    // clearance" question the static dimension strings answer for the plan as
    // a whole, but live, for the thing actually moving.
    const FP_TICK = 5;

    /** Every candidate the dragged item can be measured against: wall
     *  segments (as thin boxes) and every other furniture piece's bbox, all
     *  in SVG user units. Re-read from the live DOM on every move rather than
     *  cached, since it's cheap and guarantees it never drifts from what's
     *  on screen. */
    function fpObstacles(svg, dragId) {
      const boxes = [];
      svg.querySelectorAll('.seldia-floorplan-walls line').forEach((w) => {
        const x1 = parseFloat(w.getAttribute('x1')), y1 = parseFloat(w.getAttribute('y1'));
        const x2 = parseFloat(w.getAttribute('x2')), y2 = parseFloat(w.getAttribute('y2'));
        const t = parseFloat(w.getAttribute('stroke-width')) || 4.5;
        const half = t / 2;
        boxes.push({
          x: Math.min(x1, x2) - half, y: Math.min(y1, y2) - half,
          w: Math.abs(x2 - x1) + t, h: Math.abs(y2 - y1) + t,
          kind: 'wall',
        });
      });
      svg.querySelectorAll('[data-id][data-type="node"]').forEach((el) => {
        if (el.getAttribute('data-id') === dragId) return;
        const b = el.getBBox();
        if (b.width <= 0 || b.height <= 0) return;
        boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, kind: 'object' });
      });
      return boxes;
    }

    function fpGuideGroup(svg) {
      let g = svg.querySelector('#fpDragGuides');
      if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', 'fpDragGuides');
        svg.appendChild(g);
      }
      return g;
    }

    function fpFormatLen(px) {
      const scale = (irData && irData.fpScale) || 60;
      const m = px / scale;
      return m < 1 ? Math.round(m * 100) + ' cm' : m.toFixed(2) + ' m';
    }

    function fpLine(g, x1, y1, x2, y2, cls) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('x1', x1); el.setAttribute('y1', y1);
      el.setAttribute('x2', x2); el.setAttribute('y2', y2);
      el.setAttribute('class', cls);
      g.appendChild(el);
    }

    function fpLabel(g, x, y, text, vertical) {
      const w = text.length * 10.5 * 0.58 + 8, h = 15;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'fp-guide-pill');
      rect.setAttribute('rx', '2');
      if (vertical) {
        rect.setAttribute('x', x - h / 2); rect.setAttribute('y', y - w / 2);
        rect.setAttribute('width', h); rect.setAttribute('height', w);
      } else {
        rect.setAttribute('x', x - w / 2); rect.setAttribute('y', y - h / 2);
        rect.setAttribute('width', w); rect.setAttribute('height', h);
      }
      g.appendChild(rect);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('class', 'fp-guide-text');
      if (vertical) t.setAttribute('transform', 'rotate(-90 ' + x + ' ' + y + ')');
      t.textContent = text;
      g.appendChild(t);
    }

    /** Draw a dimension-style line from the dragged box's near edge to the
     *  nearest obstacle edge that overlaps it on the perpendicular axis —
     *  i.e. "what's directly above/below/left/right of me right now". */
    function fpGuideToNearest(g, box, obstacles, axis) {
      // axis 'y': measure vertically (up/down) to something overlapping in x.
      // axis 'x': measure horizontally (left/right) to something overlapping in y.
      const horiz = axis === 'x';
      let best = null, bestGap = Infinity, bestSide = null;
      for (const o of obstacles) {
        const overlaps = horiz
          ? box.y < o.y + o.h && box.y + box.h > o.y
          : box.x < o.x + o.w && box.x + box.w > o.x;
        if (!overlaps) continue;
        if (horiz) {
          const gapRight = o.x - (box.x + box.w);
          const gapLeft = box.x - (o.x + o.w);
          if (gapRight >= 0 && gapRight < bestGap) { bestGap = gapRight; best = o; bestSide = 'right'; }
          if (gapLeft >= 0 && gapLeft < bestGap) { bestGap = gapLeft; best = o; bestSide = 'left'; }
        } else {
          const gapDown = o.y - (box.y + box.h);
          const gapUp = box.y - (o.y + o.h);
          if (gapDown >= 0 && gapDown < bestGap) { bestGap = gapDown; best = o; bestSide = 'down'; }
          if (gapUp >= 0 && gapUp < bestGap) { bestGap = gapUp; best = o; bestSide = 'up'; }
        }
      }
      if (!best || !isFinite(bestGap)) return;
      const midY = Math.max(box.y, best.y) / 2 + Math.min(box.y + box.h, best.y + best.h) / 2;
      const midX = Math.max(box.x, best.x) / 2 + Math.min(box.x + box.w, best.x + best.w) / 2;
      let x1, y1, x2, y2;
      if (bestSide === 'right') { y1 = y2 = midY; x1 = box.x + box.w; x2 = best.x; }
      else if (bestSide === 'left') { y1 = y2 = midY; x1 = best.x + best.w; x2 = box.x; }
      else if (bestSide === 'down') { x1 = x2 = midX; y1 = box.y + box.h; y2 = best.y; }
      else { x1 = x2 = midX; y1 = best.y + best.h; y2 = box.y; }
      fpLine(g, x1, y1, x2, y2, 'fp-guide-line');
      const vertical = bestSide === 'up' || bestSide === 'down';
      for (const [tx, ty] of [[x1, y1], [x2, y2]]) {
        fpLine(g, tx - (vertical ? FP_TICK : 0), ty - (vertical ? 0 : FP_TICK),
                  tx + (vertical ? FP_TICK : 0), ty + (vertical ? 0 : FP_TICK), 'fp-guide-tick');
      }
      const gap = Math.hypot(x2 - x1, y2 - y1);
      fpLabel(g, (x1 + x2) / 2, (y1 + y2) / 2, fpFormatLen(gap), vertical);
    }

    function updateFpDragGuides(svg, el, tx, ty) {
      const bb = el.getBBox(); // el already carries the ghost transform
      const box = { x: bb.x + tx, y: bb.y + ty, w: bb.width, h: bb.height };
      const obstacles = fpObstacles(svg, el.getAttribute('data-id'));
      const g = fpGuideGroup(svg);
      g.textContent = '';
      fpGuideToNearest(g, box, obstacles, 'y'); // vertical line: nearest above/below
      fpGuideToNearest(g, box, obstacles, 'x'); // horizontal line: nearest left/right
    }

    function clearFpDragGuides() {
      const svg = container.querySelector('svg');
      const g = svg && svg.querySelector('#fpDragGuides');
      if (g) g.remove();
    }

    // ── Zoom & Pan ─────────────────────────────────────────────────────
    const container = document.getElementById('container');

    // Upper zoom bound derived from the SVG's natural size, so the scaled
    // composited layer never exceeds ~8000px on a side. transform:scale
    // promotes the SVG to its own GPU layer rasterized at full scale — a
    // 3000px-wide diagram at 5x is a 15000px texture, and layers that size
    // are exactly what tips Electron's compositor into the blank-webview
    // state on Linux.
    function maxScaleFor() {
      const svg = container.querySelector('svg');
      const vb = svg && svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height) return 5;
      return Math.max(1, Math.min(5, 8000 / Math.max(vb.width, vb.height)));
    }

    // Zoom around a fixed point (cx, cy in container coordinates).
    function zoomAt(cx, cy, factor) {
      const newScale = Math.max(0.1, Math.min(maxScaleFor(), scale * factor));
      offsetX = cx - (cx - offsetX) * (newScale / scale);
      offsetY = cy - (cy - offsetY) * (newScale / scale);
      scale = newScale;
      applyTransform();
    }

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 0.9 : 1.1);
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

    // Button zoom pivots on the container centre, not the origin — zooming
    // around (0,0) walked the diagram off-screen with every click.
    window.zoomIn = () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1.3);
    window.zoomOut = () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1 / 1.3);
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
    let suppressNextClick = false; // set on drag mouseup so the trailing click doesn't clear selection

    container.addEventListener('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; return; }
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
        // Some node renderings carry their label OUTSIDE the <g> wrapper (or
        // as paths) — open the editor with an empty seed instead of silently
        // doing nothing, matching the context menu's Edit Label behavior.
        const textEl = target.querySelector('text');
        openLabelEditor(target, textEl ? textEl.textContent : '', id, 'node');
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
    let dragUnitsPerPx = 1; // captured at drag start; scale can't change mid-drag
    let dragIsFloorplan = false;

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.shiftKey || isPanning) return;
      const target = e.target.closest('[data-id][data-type="node"]');
      if (!target) return;
      const id = target.getAttribute('data-id');
      dragNodeId = id;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragUnitsPerPx = svgUnitsPerPixel();
      isDragging = false;
      const svg = container.querySelector('svg');
      dragIsFloorplan = !!(svg && svg.querySelector('.seldia-floorplan-walls'));
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
          // The ghost translate is in SVG user units, so it must track the
          // cursor exactly regardless of zoom / CSS scaling.
          const tx = dx * dragUnitsPerPx, ty = dy * dragUnitsPerPx;
          el.setAttribute('transform', 'translate(' + tx + ', ' + ty + ')');
          if (dragIsFloorplan) updateFpDragGuides(svg, el, tx, ty);
        }
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (dragNodeId && isDragging) {
        const oldPos = nodePositions[dragNodeId];
        if (oldPos) {
          const nx = oldPos.x + (e.clientX - dragStartX) * dragUnitsPerPx;
          const ny = oldPos.y + (e.clientY - dragStartY) * dragUnitsPerPx;
          vscode.postMessage({
            type: 'nodeDragged',
            nodeId: dragNodeId,
            oldPosition: { x: oldPos.x, y: oldPos.y },
            newPosition: { x: nx, y: ny },
          });
          nodePositions[dragNodeId] = { x: nx, y: ny };
        }
        suppressNextClick = true; // the click event that follows must not clear the selection
      }
      dragNodeId = null;
      isDragging = false;
      clearFpDragGuides();
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
      // Only show the entries that apply to what was clicked.
      const scope = contextTargetType || 'canvas';
      contextMenu.querySelectorAll('[data-scope]').forEach((item) => {
        const scopes = item.getAttribute('data-scope').split(' ');
        item.style.display = scopes.indexOf(scope) !== -1 ? '' : 'none';
      });
      contextMenu.style.display = 'block';
      contextMenu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
      contextMenu.style.top = Math.min(e.clientY, window.innerHeight - contextMenu.children.length * 30) + 'px';
    });

    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
      }
      const tm = document.getElementById('themeMenu');
      const tb = document.getElementById('themeBtn');
      if (tm && !tm.contains(e.target) && e.target !== tb) {
        tm.style.display = 'none';
        tb.setAttribute('aria-expanded', 'false');
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
            // The extension host shows the QuickPick/InputBox and writes the
            // resulting style patch back into the source.
            vscode.postMessage({ type: 'requestStyleEdit', nodeId: id });
          }
          break;
        case 'add-node':
          vscode.postMessage({ type: 'nodeAdded' });
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
      // Edge-draw mode is purely webview state — the old code posted an
      // editModeChanged message the host never answered, so the button
      // never actually entered the mode.
      if (editMode === 'drawing-edge') {
        editMode = 'idle';
        edgeDrawSourceId = null;
        clearEdgeDrawSource();
        document.getElementById('btnAddEdge').classList.remove('active');
      } else {
        editMode = 'drawing-edge';
        document.getElementById('btnAddEdge').classList.add('active');
      }
    };

    // ── Theme (custom dropdown; see the toolbar comment for why not a
    //    native <select>) ────────────────────────────────────────────────
    const themeBtn = document.getElementById('themeBtn');
    const themeMenu = document.getElementById('themeMenu');
    const THEME_LABELS = {
      'sketchy-light': 'Sketchy Light', 'sketchy-dark': 'Sketchy Dark',
      'clean-light': 'Clean Light', 'clean-dark': 'Clean Dark', 'mono': 'Mono',
    };
    let currentTheme = ${JSON.stringify(theme)};
    function setThemeUI(t) {
      currentTheme = t;
      themeBtn.textContent = (THEME_LABELS[t] || t) + ' \\u25BE';
      themeMenu.querySelectorAll('[data-theme-value]').forEach((i) => {
        i.classList.toggle('selected', i.getAttribute('data-theme-value') === t);
      });
    }
    setThemeUI(currentTheme);
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = themeMenu.style.display === 'block';
      themeMenu.style.display = open ? 'none' : 'block';
      themeBtn.setAttribute('aria-expanded', String(!open));
    });
    themeMenu.querySelectorAll('[data-theme-value]').forEach((item) => {
      item.addEventListener('click', () => {
        const t = item.getAttribute('data-theme-value');
        themeMenu.style.display = 'none';
        themeBtn.setAttribute('aria-expanded', 'false');
        if (t !== currentTheme) {
          setThemeUI(t);
          vscode.postMessage({ type: 'changeTheme', theme: t });
        }
      });
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

    // ── Save ───────────────────────────────────────────────────────────
    // Visual edits land in the document as WorkspaceEdits, which leaves it
    // dirty; nothing in the panel ever wrote it to disk, so closing the panel
    // (or the untouched-looking tab) lost the work.
    function handleSave() {
      vscode.postMessage({ type: 'saveRequested' });
    }

    function setDirty(dirty) {
      const btn = document.getElementById('btnSave');
      if (!btn) return;
      btn.classList.toggle('dirty', !!dirty);
      btn.title = dirty ? 'Save (Ctrl+S) — unsaved changes' : 'Save (Ctrl+S)';
    }

    // ── Keyboard shortcuts ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      // While typing in the label editor, Delete/Backspace/undo belong to
      // the text field — without this guard, a Backspace while renaming a
      // selected node deleted the node out from under the editor.
      if (document.activeElement === labelEditor) return;
      if (e.key === 'Escape') {
        clearSelection();
        labelEditor.style.display = 'none';
        contextMenu.style.display = 'none';
        edgeDrawSourceId = null;
        editMode = 'idle';
        clearEdgeDrawSource();
        document.getElementById('btnAddEdge').classList.remove('active');
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave();
        return;
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
        e.preventDefault();
        if (selectedNodeId) vscode.postMessage({ type: 'nodeDeleted', nodeId: selectedNodeId });
        if (selectedEdgeId) vscode.postMessage({ type: 'edgeDeleted', edgeId: selectedEdgeId });
        clearSelection();
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
    }

    // ── Message Handler (from extension) ───────────────────────────────
    let lastInstalledSvg = null; // first updateContent always installs
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'updateContent': {
          // Incremental re-render: swap the diagram, keep zoom/pan/selection.
          // An unchanged SVG is not re-installed: every innerHTML swap tears
          // down and re-rasterizes the whole subtree, and pointless repaints
          // feed the compositor instability this panel is trying to avoid.
          if (msg.svg && msg.svg === lastInstalledSvg) {
            const statsEl2 = document.querySelector('.toolbar .stats');
            if (statsEl2 && msg.stats) statsEl2.textContent = msg.stats;
            if (msg.ir) { irData = msg.ir; initFromIR(); }
            break;
          }
          lastInstalledSvg = msg.svg || null;
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
            initFromIR();
          }
          // Fresh SVG: re-bridge engine ids to the interaction attributes,
          // re-apply the current zoom/pan and restore selection.
          annotateSvg();
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
          setThemeUI(msg.theme);
          break;
        case 'selectNode':
          clearSelection();
          const el = container.querySelector('[data-id="' + msg.nodeId + '"]');
          if (el) {
            selectedNodeId = msg.nodeId;
            el.setAttribute('data-selected', 'true');
          }
          break;
        case 'syncDirty':
          setDirty(msg.dirty);
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
        this.syncUndoRedo();
        break;

      case 'nodeDragged':
        void this.applyNodePosition(msg.nodeId, msg.newPosition.x, msg.newPosition.y);
        break;

      case 'labelEdited':
        void this.handleLabelEdited(msg.nodeId, msg.edgeId, msg.newLabel);
        break;

      case 'nodeAdded':
        void this.handleNodeAdded(msg.connectFromId);
        break;

      case 'nodeDeleted':
        void this.handleNodeDeleted(msg.nodeId);
        break;

      case 'edgeAdded':
        void this.handleEdgeAdded(msg.sourceId, msg.targetId);
        break;

      case 'edgeDeleted':
        void this.handleEdgeDeleted(msg.edgeId);
        break;

      case 'saveRequested':
        void this.saveDocument();
        break;

      case 'undoRequested':
        void this.undo();
        break;

      case 'redoRequested':
        void this.redo();
        break;

      case 'exportRequested':
        // Handled via the export SVG button in webview
        break;

      case 'changeTheme':
        this._currentTheme = msg.theme;
        void this.render();
        break;

      case 'styleEdited':
        // Write the style keys straight into the node's attribute block —
        // the old path (`handleStyleEdit` → onDslPatch at offset 0) inserted
        // text at the top of the document and corrupted the source.
        if (msg.nodeId && msg.stylePatch && Object.keys(msg.stylePatch).length > 0) {
          void this.applyNodeAttrs(msg.nodeId, msg.stylePatch);
        }
        break;

      case 'requestStyleEdit': {
        // Webview asked for the native color picker flow: prompt here (the
        // webview can't show QuickPick), then round-trip the patch.
        void this.promptStyleEdit(msg.nodeId);
        break;
      }

      case 'viewModeChanged':
        this._viewMode = msg.mode;
        void this.render();
        break;

      case 'zoomChanged':
        break;
    }
  }

  // ── DSL Patch Application ─────────────────────────────────────────────

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

  /** Ground truth for every edit: the live document, the DSL source the
   *  patchers should run against (fence contents in block mode, whole file
   *  otherwise), and the base offset that translates patch offsets into
   *  document offsets. Returns undefined when the fence can no longer be
   *  located (the edit is dropped rather than mis-applied). */
  private async groundTruth(): Promise<{ document: vscode.TextDocument; source: string; base: number } | undefined> {
    if (!this._sourceUri) return undefined;
    const document = await vscode.workspace.openTextDocument(this._sourceUri);
    const text = document.getText();
    if (!this._blockId) return { document, source: text, base: 0 };
    const block = this.locateBlock(text);
    if (!block) return undefined;
    return {
      document,
      source: block.source,
      base: document.offsetAt(new vscode.Position(block.sourceStartLine, 0)),
    };
  }

  /** Apply source-relative `TextEdit`s in one WorkspaceEdit, recording an
   *  undo snapshot of the pre-edit source. All the visual-edit paths funnel
   *  through here so undo/redo and block-identity refresh stay consistent. */
  private async applySourceEdits(
    gt: { document: vscode.TextDocument; source: string; base: number },
    edits: TextEdit[]
  ): Promise<void> {
    if (edits.length === 0) return;
    this._undoStack.push(gt.source);
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack = [];

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      const startPos = gt.document.positionAt(gt.base + e.start);
      const endPos = gt.document.positionAt(gt.base + e.end);
      workspaceEdit.replace(this._sourceUri!, new vscode.Range(startPos, endPos), e.text);
    }
    await vscode.workspace.applyEdit(workspaceEdit);
    if (this._blockId) {
      this.refreshBlockIdentity(gt.document);
    } else {
      this._currentSource = gt.document.getText();
    }
    this.syncUndoRedo();
    this.syncDirty();
    void this.autoSaveIfEnabled();
  }

  // ── Undo / Redo (source snapshots) ────────────────────────────────────

  private syncUndoRedo(): void {
    this._messenger.sendSyncUndoRedo(this._undoStack.length > 0, this._redoStack.length > 0);
  }

  /** Write the edited document to disk. Visual edits are applied as
   *  WorkspaceEdits, which only make the document dirty — without this the
   *  panel had no way to persist them at all. */
  private async saveDocument(): Promise<void> {
    if (!this._sourceUri) { this.editSkipped('no document to save'); return; }
    const document = await vscode.workspace.openTextDocument(this._sourceUri);
    if (!document.isDirty) { this.syncDirty(); return; }
    const ok = await document.save();
    this.syncDirty();
    vscode.window.setStatusBarMessage(
      ok ? 'SelDiA: diagram saved' : 'SelDiA: save failed',
      3000
    );
  }

  /** Honour the workbench's own `files.autoSave` for visual edits. VS Code's
   *  autosave only reacts to editor typing, so a WorkspaceEdit from this panel
   *  would sit dirty forever even for users who asked for autosave. Manual
   *  ('off'/'onFocusChange') stays manual — that's what the Save button is for. */
  private async autoSaveIfEnabled(): Promise<void> {
    const mode = vscode.workspace.getConfiguration('files').get<string>('autoSave');
    if (mode !== 'afterDelay') return;
    if (!this._sourceUri) return;
    const document = await vscode.workspace.openTextDocument(this._sourceUri);
    if (document.isDirty) { await document.save(); this.syncDirty(); }
  }

  /** Mirror the document's unsaved state onto the panel's Save button. */
  private syncDirty(): void {
    const doc = vscode.workspace.textDocuments.find(
      (d) => this._sourceUri && d.uri.toString() === this._sourceUri.toString()
    );
    this._messenger.sendSyncDirty(!!doc?.isDirty);
  }

  /** Replace the edited source (fence contents or whole file) with `text`
   *  via a WorkspaceEdit. Used by undo/redo restore. */
  private async restoreSource(text: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) return;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(
      this._sourceUri!,
      new vscode.Range(gt.document.positionAt(gt.base), gt.document.positionAt(gt.base + gt.source.length)),
      text
    );
    await vscode.workspace.applyEdit(workspaceEdit);
    if (this._blockId) {
      this.refreshBlockIdentity(gt.document);
    } else {
      this._currentSource = gt.document.getText();
    }
  }

  private async undo(): Promise<void> {
    const prev = this._undoStack.pop();
    if (prev === undefined) return;
    const gt = await this.groundTruth();
    if (gt) this._redoStack.push(gt.source);
    await this.restoreSource(prev);
    this.syncUndoRedo();
  }

  private async redo(): Promise<void> {
    const next = this._redoStack.pop();
    if (next === undefined) return;
    const gt = await this.groundTruth();
    if (gt) this._undoStack.push(gt.source);
    await this.restoreSource(next);
    this.syncUndoRedo();
  }

  // ── Visual edit handlers ──────────────────────────────────────────────

  /** A visual edit couldn't be mapped onto a source line (implicit nodes in
   *  state/mindmap/wireframe blocks, hand-restructured fences, …). Dropping
   *  it is correct — guessing corrupts the document — but it must never be
   *  SILENT: an edit that visibly does nothing reads as "the panel is
   *  broken". */
  private editSkipped(what: string): void {
    vscode.window.setStatusBarMessage(`SelDiA: ${what} — edit skipped`, 5000);
  }

  /** Edge id (`edge-<src>-<tgt>`, ids may contain '-') → endpoints, resolved
   *  against the laid-out IR rather than by string-splitting. */
  private edgeEndpoints(edgeId: string): { sourceId: string; targetId: string } | undefined {
    const e = this._positionedIr?.edges.find((x) => x.id === edgeId);
    return e ? { sourceId: e.sourceId, targetId: e.targetId } : undefined;
  }

  private async handleLabelEdited(nodeId: string | undefined, edgeId: string | undefined, newLabel: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    let edit: TextEdit | undefined;
    if (nodeId) {
      edit = computeLabelEdit(gt.source, nodeId, newLabel);
    } else if (edgeId) {
      const ep = this.edgeEndpoints(edgeId);
      if (ep) edit = computeEdgeLabelEdit(gt.source, ep.sourceId, ep.targetId, newLabel);
    }
    if (edit) await this.applySourceEdits(gt, [edit]);
    else this.editSkipped(`no source line found for '${nodeId ?? edgeId}'`);
  }

  private async handleNodeAdded(connectFromId?: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const ids = new Set((this._positionedIr?.nodes ?? []).map((n) => n.id));
    let n = ids.size + 1;
    while (ids.has(`node${n}`)) n++;
    const nodeId = `node${n}`;
    let stmt = `    ${nodeId}: [New Node ${n}]`;
    if (connectFromId) stmt += `\n    ${connectFromId} --> ${nodeId}`;
    const edit = computeAppendStatementEdit(gt.source, stmt);
    if (edit) await this.applySourceEdits(gt, [edit]);
    else this.editSkipped('no closing brace to insert before');
  }

  private async handleNodeDeleted(nodeId: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edits = computeNodeDeleteEdits(gt.source, nodeId);
    if (edits.length) await this.applySourceEdits(gt, edits);
    else this.editSkipped(`no source line found for '${nodeId}'`);
  }

  private async handleEdgeAdded(sourceId: string, targetId: string): Promise<void> {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edit = computeAppendStatementEdit(gt.source, `    ${sourceId} --> ${targetId}`);
    if (edit) await this.applySourceEdits(gt, [edit]);
    else this.editSkipped('no closing brace to insert before');
  }

  private async handleEdgeDeleted(edgeId: string): Promise<void> {
    const ep = this.edgeEndpoints(edgeId);
    if (!ep) { this.editSkipped(`unknown edge '${edgeId}'`); return; }
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edit = computeEdgeDeleteEdit(gt.source, ep.sourceId, ep.targetId);
    if (edit) await this.applySourceEdits(gt, [edit]);
    else this.editSkipped(`no source line found for edge '${ep.sourceId} -> ${ep.targetId}'`);
  }

  /** "Edit Style" flow: QuickPick a property (fill / stroke / text color),
   *  prompt for a color, write it into the node's attribute block. */
  private async promptStyleEdit(nodeId: string): Promise<void> {
    const prop = await vscode.window.showQuickPick(
      [
        { label: 'Fill color', key: 'fill' },
        { label: 'Border (stroke) color', key: 'stroke' },
        { label: 'Text color', key: 'textColor' },
      ],
      { placeHolder: `Style property for '${nodeId}'` }
    );
    if (!prop) return;
    const value = await vscode.window.showInputBox({
      prompt: `${prop.label} for '${nodeId}' (CSS color, e.g. #ff8800 or steelblue)`,
      validateInput: (v) => (v.trim() ? undefined : 'Enter a color value'),
    });
    if (!value) return;
    await this.applyNodeAttrs(nodeId, { [prop.key]: value.trim() });
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
    // Floorplans have their own positional vocabulary (`at:` in metres, plus
    // `in:` for furniture) and ignore the generic x/y override entirely, so a
    // generic write-back here silently lost every floorplan drag.
    const fp = this.floorplanDragPatch(nodeId, x, y);
    if (fp) {
      await this.applyNodeAttrs(nodeId, fp.attrs);
      if (fp.movedToRoom) {
        vscode.window.setStatusBarMessage(`SelDiA: moved '${nodeId}' into ${fp.movedToRoom}`, 4000);
      }
      return;
    }
    await this.applyNodeAttrs(nodeId, { x: Math.round(x), y: Math.round(y) });
  }

  /** Floorplan-specific drag mapping, or undefined when this isn't a
   *  floorplan (or the node has no positional syntax). */
  private floorplanDragPatch(nodeId: string, x: number, y: number) {
    const ir = this._positionedIr;
    const scale = ir?.metadata?.floorplanScale as number | undefined;
    if (!ir || !scale) return undefined;
    return computeFloorplanDragPatch(ir.nodes as any, nodeId, x, y, scale);
  }

  /** Merge attribute key/values (position, fill/stroke from Edit Style, …)
   *  into the node's declaration via the same ground-truth read +
   *  fence-offset translation + single WorkspaceEdit as drags. */
  private async applyNodeAttrs(nodeId: string, attrs: Record<string, string | number>): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; } // fence gone — never guess
    const edit = computeAttrEdit(gt.source, nodeId, attrs);
    if (!edit) { this.editSkipped(`no declaration line found for '${nodeId}'`); return; }
    await this.applySourceEdits(gt, [edit]);
  }

  dispose(): void {
    if (this._disposed) return; // re-entrant: panel.dispose() below re-fires onDidDispose
    this._disposed = true;
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    const key = this._registryKey ?? SelDiAInteractiveProvider.keyFor(this._sourceUri ?? undefined);
    if (SelDiAInteractiveProvider.panels.get(key) === this) {
      SelDiAInteractiveProvider.panels.delete(key);
    }
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
