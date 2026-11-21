// =============================================================================
// SelDiA — Interactive Diagram Webview Provider
// =============================================================================
// Provides the webview panel for interactive diagram editing in VS Code.
// Supports zoom/pan, drag-drop node repositioning, double-click label editing,
// right-click context menus, undo/redo, edge rerouting, and node resizing.

import { formatDiagnostic } from './client/stale-state.js';
import * as vscode from 'vscode';
import { createEngine, type CoreEngine, type DiagramIR, getEditVocabulary } from '@seldia/core';
import { WebviewMessenger } from './messenger.js';
import type { WebviewToExtMessage } from '../types.js';
import { ICON_SPRITE, icon } from '../shared/icons.js';
import {
  computeAttrEdit, computeLabelEdit, computeEdgeLabelEdit,
  computeEdgeDeleteEdit, computeEdgeReconnectEdit, computeNodeDeleteEdits, computeAppendStatementEdit,
  buildNodeStatement, buildEdgeStatement,
  type TextEdit, type AttrPatch,
} from '../edit/position-patch.js';
import { findBlockById, findSelDiABlocks, type SelDiABlockLoc } from '../edit/blocks.js';
import { computeFloorplanDragPatch } from '../edit/floorplan-drag.js';
import { computeLayoutGestureEdits, computeAutoLayoutEdits, type LayoutEdge } from '../edit/layout-patch.js';

/** Diagram types with their own fixed layout (lifelines, time axes, plans…):
 *  nodes/edges there aren't freely placeable, so no freeze / edge moves. */
const FIXED_LAYOUT_TYPES = new Set([
  'sequence', 'gantt', 'mindmap', 'sankey', 'gitgraph', 'chart-bar', 'chart-line', 'chart-pie',
  'chart-radar', 'chart-scatter', 'floorplan', 'circuit', 'pcb', 'table', 'timeline', 'wireframe',
]);
import { EditSession } from '../edit/session.js';
import { SerialQueue } from '../edit/serial-queue.js';

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
  'blueprint': { sketchy: false, theme: 'blueprint' },
  'comic': { sketchy: true, theme: 'comic' },
};

/** Canvas backdrop per diagram theme (the toolbar/menus follow VS Code's theme). */
const CANVAS_BG: Record<string, string> = {
  'sketchy-dark': '#1e1e1e', 'clean-dark': '#1e1e1e', 'blueprint': '#1d4e89', 'comic': '#fffbeb',
};
const canvasBg = (t: string): string => CANVAS_BG[t] ?? '#ffffff';

/** CSP nonce for the webview's script tags — a fresh one per render so the
 *  policy can pin `script-src` to exactly the tags we emit instead of
 *  `'unsafe-inline'`. */
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

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
  /** Node id to auto-open the label editor for on the next render after an
   *  add-node gesture. */
  private _pendingFocusNodeId: string | null = null;
  /** Source/target of an edge just added, resolved to that edge's actual id
   *  once the recompiled IR comes back (edge id formats vary per diagram
   *  type — `edge-<src>-<tgt>`, `class-edge-<src>-<tgt>`, `seq-edge-<n>`,
   *  etc — so it can't be predicted, only looked up), to auto-open its label
   *  editor. */
  private _pendingFocusEdgeEndpoints: { sourceId: string; targetId: string } | null = null;

  /** Snapshot-based undo/redo over the edited source (the fence contents in
   *  block mode, the whole document otherwise), plus the document-version
   *  bookkeeping that invalidates stale entries on a hand edit. Every visual
   *  write-back records the pre-edit source; undo restores it with a
   *  WorkspaceEdit, so the text document stays the single source of truth.
   *  VS Code's own editor undo stack keeps working independently. */
  private _editSession: EditSession = new EditSession('');

  /** Serializes every edit-producing message so two quick gestures (e.g. two
   *  fast drags) can't interleave `groundTruth()` reads with `applySourceEdits`
   *  writes. */
  private readonly _editQueue = new SerialQueue();

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
  /** Set right before this panel applies its own WorkspaceEdit (drag, label
   *  edit, undo/redo, …) and cleared by the very next `onDidChangeTextDocument`
   *  for this document. Any OTHER change that arrives while this is false is a
   *  foreign edit (hand typing, another extension) and invalidates the undo
   *  session instead of being folded into it — see EditSession.onForeignEdit. */
  private _expectingOwnEdit = false;

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
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
    this._engine = engine;
    this._currentSource = source;
    this._editSession = new EditSession(source);
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
        const isOwnEdit = this._expectingOwnEdit;
        this._expectingOwnEdit = false;
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
          if (!isOwnEdit) this._editSession.onForeignEdit(block.source);
          this.scheduleRender();
          return;
        }
        this.syncDirty();
        const text = e.document.getText();
        if (text === this._currentSource) return;
        this._currentSource = text;
        if (!isOwnEdit) this._editSession.onForeignEdit(text);
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
    let freeLayout = false;

    const r1 = eng.parse(this._currentSource, fsPath);
    const r2 = r1.ok ? eng.analyze(r1.value) : r1;
    const r3 = r2.ok ? eng.transform(r2.value) : r2;
    const r4 = r3.ok ? await eng.layoutAsync(r3.value) : r3;
    const result = r4.ok ? eng.render(r4.value) : r4;

    let vocabulary: ReturnType<typeof getEditVocabulary> | undefined;
    if (r4.ok && result.ok) {
      this._positionedIr = r4.value.diagram;
      nodes = r4.value.diagram.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
      fpScale = r4.value.diagram.metadata?.floorplanScale as number | undefined;
      freeLayout = !FIXED_LAYOUT_TYPES.has(String(r4.value.diagram.type));
      svgContent = result.value.svg;
      stats = `Nodes: ${result.value.stats?.nodeCount || 0} | Edges: ${result.value.stats?.edgeCount || 0}`;
      vocabulary = getEditVocabulary(r4.value.diagram.type);
    } else {
      // Escape each message before joining with <br> — compiler errors can
      // quote source fragments containing '<', which must not become markup.
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const errs = (result as { ok: false; errors: any[] }).errors || [];
      errorMsg = errs.map((e: any) => formatDiagnostic(e, esc(String(e.message)))).join('<br>');
    }

    if (this._disposed) return;
    // NUL separators: neither the SVG, the stats line, nor an error message can
    // contain U+0000, so the joined signature is unambiguous. Written as an escape
    // rather than a literal NUL byte so the file stays plain text for grep/diff.
    const sig = `${svgContent}\0${stats}\0${errorMsg}`;
    const focusNodeId = this._pendingFocusNodeId;
    this._pendingFocusNodeId = null;
    const focusEdgeEndpoints = this._pendingFocusEdgeEndpoints;
    this._pendingFocusEdgeEndpoints = null;
    const focusEdgeId = focusEdgeEndpoints
      ? this._positionedIr?.edges.find(
          (e) => e.sourceId === focusEdgeEndpoints.sourceId && e.targetId === focusEdgeEndpoints.targetId
        )?.id
      : undefined;
    if (!this._htmlInitialized) {
      // First render: install the full page (styles, toolbar, script).
      this._panel.webview.html = this.getHtmlContent(svgContent, stats, errorMsg, { nodes, fpScale, vocabulary, freeLayout });
      this._htmlInitialized = true;
      this._lastSentSig = sig;
    } else {
      // Subsequent renders: swap only the diagram content over postMessage so
      // the webview keeps its zoom/pan/selection/undo UI state. Replacing the
      // whole HTML here was the old behavior and it reset all of that on
      // every document change. Identical output is dropped entirely — no
      // repaint for a change that didn't alter this diagram, UNLESS an
      // add-node/add-edge gesture is waiting to focus its new label (still
      // needs to reach the client even when the signature happens to match,
      // though in practice a just-added element always changes the SVG).
      if (sig === this._lastSentSig && !focusNodeId && !focusEdgeId) return;
      this._lastSentSig = sig;
      this._panel.webview.postMessage({
        type: 'updateContent',
        svg: svgContent,
        error: errorMsg,
        stats,
        ir: { nodes, fpScale, vocabulary, freeLayout },
        focusNodeId,
        focusEdgeId,
      });
    }
  }

  private getHtmlContent(svgContent: string, stats: string, errorMsg: string, irPayload: { nodes: Array<{ id: string; x: number; y: number }>; fpScale?: number; freeLayout?: boolean; vocabulary?: ReturnType<typeof getEditVocabulary> }): string {
    const theme = this._currentTheme;

    // Node id → laid-out position, for drag write-back in the webview.
    const initJson = JSON.stringify({ ir: irPayload, theme }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const nonce = getNonce();
    const editorJsUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'editor.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;">
  <title>SelDiA Interactive</title>
  <style>
    /* Chrome follows the active VS Code theme via --vscode-* variables; only the
       diagram canvas (--canvas-bg) follows the selected diagram theme. */
    :root {
      --canvas-bg: ${canvasBg(theme)};
      --fg-color: var(--vscode-foreground);
      --accent: var(--vscode-focusBorder, #0078d4);
      --panel-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --panel-border: var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
      --hover-bg: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.18));
      --active-bg: var(--vscode-toolbar-activeBackground, rgba(128,128,128,.28));
      --shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0,0,0,.3));
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background);
      color: var(--fg-color);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex; align-items: center; gap: 2px;
      min-height: 35px; padding: 0 8px;
      background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
      border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder, var(--panel-border));
      flex-shrink: 0;
      flex-wrap: wrap;
      user-select: none;
    }
    .toolbar .title {
      font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
      color: var(--vscode-sideBarTitle-foreground, var(--fg-color)); opacity: .85;
      padding: 0 6px; white-space: nowrap;
    }
    .toolbar .stats {
      color: var(--vscode-descriptionForeground); font-size: 11px;
      margin-right: auto; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .toolbar .sep { width: 1px; height: 16px; background: var(--panel-border); margin: 0 6px; flex-shrink: 0; }
    .toolbar button {
      display: inline-flex; align-items: center; gap: 6px;
      height: 24px; padding: 0 8px;
      border: 1px solid transparent; border-radius: 5px;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--fg-color));
      font: inherit; font-size: 12px;
      cursor: pointer; flex-shrink: 0;
    }
    .toolbar button:hover { background: var(--hover-bg); }
    .toolbar button:active { background: var(--active-bg); }
    .toolbar button:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
    .toolbar button:disabled { opacity: 0.4; cursor: default; background: transparent; }
    .toolbar button.active, .icon-btn.active {
      background: var(--vscode-inputOption-activeBackground, var(--active-bg));
      border-color: var(--vscode-inputOption-activeBorder, var(--accent));
      color: var(--vscode-inputOption-activeForeground, var(--fg-color));
    }
    /* Unsaved visual edits: the Save button is the only place the panel can
       show that the document is dirty (a webview has no editor tab badge). */
    .toolbar button#btnSave { position: relative; }
    .toolbar button#btnSave.dirty { color: var(--vscode-editorWarning-foreground, #e2b93d); }
    .toolbar button#btnSave.dirty::after {
      content: ''; position: absolute; top: 3px; right: 3px;
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    }
    .toolbar button.icon-btn { justify-content: center; width: 28px; padding: 0; }
    .toolbar button.icon-btn .seldia-icon { margin-right: 0; vertical-align: 0; width: 16px; height: 16px; }
    .toolbar #themeBtn {
      border-color: var(--vscode-dropdown-border, var(--panel-border));
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground, var(--fg-color));
      padding: 0 8px;
    }
    .toolbar #themeBtn::before {
      content: ''; width: 10px; height: 10px; border-radius: 3px;
      background: var(--canvas-bg); border: 1px solid var(--panel-border);
    }
    #container {
      flex: 1;
      overflow: hidden;
      position: relative;
      background-color: var(--canvas-bg);
      background-image: radial-gradient(circle, rgba(128,128,128,.22) 1px, transparent 1.2px);
      background-size: 20px 20px;
    }
    #container svg { max-width: 100%; height: auto; display: block; }
    /* Popovers: label editor, context menu, theme + palettes share VS Code's menu look. */
    #labelEditor {
      display: none;
      position: absolute;
      z-index: 1000;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground, var(--fg-color));
      border: 1px solid var(--accent);
      border-radius: 4px;
      padding: 4px 8px;
      font: inherit;
      outline: none;
      min-width: 80px;
      box-shadow: var(--shadow);
    }
    #contextMenu, #themeMenu, #nodePalette, #edgePalette {
      display: none;
      position: absolute;
      z-index: 1001;
      background: var(--vscode-menu-background, var(--panel-bg));
      color: var(--vscode-menu-foreground, var(--fg-color));
      border: 1px solid var(--vscode-menu-border, var(--panel-border));
      border-radius: 6px;
      box-shadow: var(--shadow);
      min-width: 170px;
      padding: 4px;
    }
    #themeMenu, #nodePalette, #edgePalette { top: calc(100% + 4px); left: 0; z-index: 1002; }
    #themeMenu { min-width: 160px; }
    .menu-item {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 10px; border-radius: 4px;
      cursor: pointer; font-size: 12px; line-height: 18px; white-space: nowrap;
      color: inherit;
    }
    .menu-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, inherit));
    }
    .menu-item .seldia-icon { margin-right: 0; opacity: .85; }
    .menu-sep { height: 1px; background: var(--vscode-menu-separatorBackground, var(--panel-border)); margin: 4px 6px; }
    #themeMenu .menu-item::before {
      content: ''; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0;
      border: 1px solid var(--panel-border); background: var(--swatch, transparent);
    }
    #themeMenu .menu-item.selected { font-weight: 600; }
    #themeMenu .menu-item.selected::after { content: '\\2713'; margin-left: auto; padding-left: 12px; }
    #themeMenu [data-theme-value="sketchy-light"] { --swatch: #ffffff; }
    #themeMenu [data-theme-value="sketchy-dark"] { --swatch: #1e1e1e; }
    #themeMenu [data-theme-value="clean-light"] { --swatch: #f8fafc; }
    #themeMenu [data-theme-value="clean-dark"] { --swatch: #0f172a; }
    #themeMenu [data-theme-value="mono"] { --swatch: linear-gradient(135deg,#fff 50%,#111 50%); }
    #themeMenu [data-theme-value="blueprint"] { --swatch: #1d4e89; }
    #themeMenu [data-theme-value="comic"] { --swatch: #fde047; }
    /* Mode banner: floating pill so the active mode is obvious. */
    #modeBanner {
      display: none;
      position: absolute;
      top: 12px; left: 50%;
      transform: translateX(-50%);
      z-index: 1003;
      background: var(--vscode-badge-background, var(--accent));
      color: var(--vscode-badge-foreground, #fff);
      font-size: 12px;
      padding: 5px 14px;
      border-radius: 999px;
      box-shadow: var(--shadow);
      pointer-events: none;
    }
    #container.seldia-stale > :not(#modeBanner):not(#staleBanner) { opacity: .4; pointer-events: none; }
    #staleBanner {
      display: none; position: sticky; top: 0; z-index: 20;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      color: var(--vscode-foreground); padding: 6px 12px;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    }
    #container.seldia-stale #staleBanner { display: block; }
    .error {
      margin: 24px; padding: 12px 16px; border-radius: 6px;
      color: var(--vscode-errorForeground, #f48771);
      background: var(--vscode-inputValidation-errorBackground, transparent);
      border: 1px solid var(--vscode-inputValidation-errorBorder, currentColor);
      font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; white-space: pre-wrap;
    }
    /* Tool switch (Select | Pan): one segmented control. */
    .toolbar .seg { display: inline-flex; gap: 1px; padding: 1px; border-radius: 6px; background: var(--hover-bg); }
    .toolbar .seg button { border-radius: 5px; }
    .toolbar #btnAutoLayout .seldia-icon { margin-right: 0; width: 16px; height: 16px; }
    #container.tool-pan, #container.tool-pan * { cursor: grab !important; }
    #container.is-panning, #container.is-panning * { cursor: grabbing !important; }
    #container.tool-select [data-type="node"] { cursor: move; }
    #container.is-dragging, #container.is-dragging * { cursor: grabbing !important; }
    /* Box select */
    #marquee {
      display: none; position: fixed; z-index: 999; pointer-events: none;
      border: 1px solid var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      border-radius: 2px;
    }
    /* Edges: wide invisible hit line + hover highlight + segment handles */
    .seldia-edge-hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; }
    #container.tool-select .seldia-edge-movable { cursor: grab; }
    #container.tool-select .seldia-edge-fixed { cursor: not-allowed; }
    .seldia-edge-movable:hover path:not(.seldia-edge-hit) { filter: drop-shadow(0 0 2px var(--accent)); }
    .seldia-edge-rerouting { opacity: .45; stroke-dasharray: 5 4; }
    .seldia-moving { opacity: .85; filter: drop-shadow(0 0 4px var(--accent)); }
    #edgeHandles .seg-handle {
      fill: var(--vscode-editor-background, #fff); stroke: var(--accent); stroke-width: 1.5;
      cursor: grab; vector-effect: non-scaling-stroke;
    }
    #edgeHandles .seg-handle.h { cursor: ns-resize; }
    #edgeHandles .seg-handle.v { cursor: ew-resize; }
    #edgeHandles .seg-handle:hover { fill: var(--accent); }
    #edgeHandles .ghost { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 3; pointer-events: none; vector-effect: non-scaling-stroke; }
    /* Selection highlight */
    .seldia-selected { outline: 2px solid var(--accent); outline-offset: 2px; }
    [data-type="edge"][data-selected="true"] { filter: drop-shadow(0 0 3px var(--accent)); }
    /* Selected nodes: dashed frame + corner squares (overlay drawn by the client). */
    #selFrames { pointer-events: none; }
    #selFrames .sel-frame { fill: color-mix(in srgb, var(--accent) 8%, transparent); stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 3; vector-effect: non-scaling-stroke; }
    #selFrames .sel-corner { fill: var(--vscode-editor-background, #fff); stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    [data-type="node"], [data-type="edge"] { cursor: pointer; }
    .edge-draw-line { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6,3; pointer-events: none; }
    .seldia-edge-source { outline: 2px dashed var(--accent); outline-offset: 3px; }
    #container.seldia-drawing-edge { cursor: crosshair; }
    .seldia-edge-target { outline: 2px solid var(--vscode-terminal-ansiGreen, #4ec9b0); outline-offset: 3px; }
    .seldia-icon { width: 14px; height: 14px; vertical-align: -2px; color: currentColor; margin-right: 3px; }
    /* Floorplan drag guides: dashed-blue language matching the dimension strings. */
    #fpDragGuides, #fpSelGuides { pointer-events: none; }
    #fpSelGuides .fp-guide-edit { pointer-events: all; cursor: text; }
    #fpSelGuides .fp-guide-edit:hover .fp-guide-pill { fill: var(--accent); opacity: .2; }
    #fpSelGuides .fp-guide-edit:hover .fp-guide-text { text-decoration: underline; }
    #fpDimInput {
      display: none; position: fixed; z-index: 1004; width: 90px; height: 24px; padding: 0 6px; text-align: center;
      font: inherit; font-size: 12px; border-radius: 4px; outline: none;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--accent); box-shadow: var(--shadow);
    }
    #fpDimInput.invalid { border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
    #fpDragGuides .fp-guide-line, #fpSelGuides .fp-guide-line { stroke: #2563eb; stroke-width: 1; stroke-dasharray: 4,3; }
    #fpDragGuides .fp-guide-tick, #fpSelGuides .fp-guide-tick { stroke: #2563eb; stroke-width: 1.2; }
    #fpDragGuides .fp-guide-text, #fpSelGuides .fp-guide-text {
      font-size: 10.5px; font-weight: 600; fill: #2563eb;
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #fpDragGuides .fp-guide-pill, #fpSelGuides .fp-guide-pill { fill: var(--canvas-bg); opacity: 0.94; }
  </style>
</head>
<body>
  ${ICON_SPRITE}
  <div class="toolbar">
    <span class="title">SelDiA Diagram</span>
    <span class="stats">${stats}</span>

    <span class="sep"></span>
    <button class="icon-btn" id="btnSave" data-cmd="save" title="Save (Ctrl+S)" aria-label="Save">${icon('save')}</button>

    <span class="sep"></span>
    <button class="icon-btn" id="btnUndo" data-cmd="undo" disabled title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
    <button class="icon-btn" id="btnRedo" data-cmd="redo" disabled title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${icon('redo')}</button>

    <span class="sep"></span>
    <span class="seg" role="group" aria-label="Tool">
      <button class="icon-btn active" id="btnSelect" data-cmd="select" title="Select (V) — click, drag to move, drag empty canvas to box-select" aria-label="Select tool" aria-pressed="true">${icon('pointer')}</button>
      <button class="icon-btn" id="btnPan" data-cmd="pan" title="Pan (H) — drag to move the view. Tip: scroll wheel also pans" aria-label="Pan tool" aria-pressed="false">${icon('hand')}</button>
    </span>

    <span class="sep"></span>
    <button class="icon-btn" data-cmd="zoomOut" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out">${icon('zoom-out')}</button>
    <button class="icon-btn" data-cmd="zoomIn" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in">${icon('zoom-in')}</button>
    <button class="icon-btn" data-cmd="fit" title="Fit to screen" aria-label="Fit to screen">${icon('fit-screen')}</button>
    <button class="icon-btn" data-cmd="resetZoom" title="Actual size (100%)" aria-label="Reset zoom">${icon('reset')}</button>

    <span class="sep"></span>
    <button class="icon-btn" id="btnAutoLayout" data-cmd="autoLayout" title="Auto-layout: arrange every node and route every edge automatically (Ctrl+Z to undo)" aria-label="Auto-layout">${icon('auto-layout')}</button>

    <span class="sep"></span>
    <!-- Custom dropdown, NOT a native <select>: native popup surfaces spawned
         from an out-of-process webview iframe are a known Electron/Linux
         breakage point (invisible dropdowns, popup grabs that destabilize the
         whole workbench until restart). A plain positioned div stays inside
         the webview's own compositor surface. -->
    <span id="themeWrap" style="position:relative">
      <button id="themeBtn" title="Theme" aria-haspopup="listbox" aria-expanded="false">${
        ({ 'sketchy-light': 'Sketchy Light', 'sketchy-dark': 'Sketchy Dark', 'clean-light': 'Clean Light', 'clean-dark': 'Clean Dark', 'mono': 'Mono', 'blueprint': 'Blueprint', 'comic': 'Comic' } as Record<string, string>)[theme] ?? theme
      } ▾</button>
      <div id="themeMenu" role="listbox">
        <div class="menu-item" role="option" data-theme-value="sketchy-light">Sketchy Light</div>
        <div class="menu-item" role="option" data-theme-value="sketchy-dark">Sketchy Dark</div>
        <div class="menu-item" role="option" data-theme-value="clean-light">Clean Light</div>
        <div class="menu-item" role="option" data-theme-value="clean-dark">Clean Dark</div>
        <div class="menu-item" role="option" data-theme-value="mono">Mono</div>
        <div class="menu-item" role="option" data-theme-value="blueprint">Blueprint</div>
        <div class="menu-item" role="option" data-theme-value="comic">Comic</div>
      </div>
    </span>

    <span class="sep"></span>
    <span id="nodePaletteWrap" style="position:relative">
      <button class="icon-btn" id="btnAddNode" data-cmd="addNode" title="Add node" aria-haspopup="listbox" aria-expanded="false" aria-label="Add node">${icon('add-node')}</button>
      <div id="nodePalette" role="listbox"></div>
    </span>
    <span id="edgePaletteWrap" style="position:relative">
      <button class="icon-btn" id="btnAddEdge" data-cmd="addEdge" title="Draw edge (click source, then target)" aria-haspopup="listbox" aria-expanded="false" aria-label="Draw edge">${icon('add-edge')}</button>
      <div id="edgePalette" role="listbox"></div>
    </span>

    <span class="sep"></span>
    <button class="icon-btn" data-cmd="exportSvg" title="Export SVG" aria-label="Export SVG">${icon('download')}</button>
  </div>

  <div id="marquee"></div>
  <div id="container">
    ${svgContent || `<div class="error">${errorMsg || 'No diagram to render'}</div>`}
    <div id="modeBanner"></div>
    <div id="staleBanner"></div>
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
    <div class="menu-item" data-action="rotate" data-scope="node" data-fp-only="1">${icon('edit')} Rotate 90°</div>
    <div class="menu-item" data-action="reconnect-source" data-scope="edge">${icon('link')} Reconnect Source</div>
    <div class="menu-item" data-action="reconnect-target" data-scope="edge">${icon('link')} Reconnect Target</div>
    <div class="menu-sep" data-scope="node edge"></div>
    <div class="menu-item" data-action="add-node" data-scope="canvas">${icon('add-node')} Add Node</div>
    <div class="menu-item" data-action="delete" data-scope="node edge">${icon('delete')} Delete</div>
  </div>

  <script nonce="${nonce}">window.__seldiaInit = ${initJson};</script>
  <script nonce="${nonce}" src="${editorJsUri}"></script>
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
        void this._editQueue.run(() => this.applyNodePosition(msg.nodeId, msg.newPosition.x, msg.newPosition.y));
        break;

      case 'layoutGesture':
        void this._editQueue.run(() => this.handleLayoutGesture(msg));
        break;

      case 'autoLayout':
        void this._editQueue.run(() => this.handleAutoLayout());
        break;

      case 'furnitureRotated':
        // `rotation:` is the explicit-turn write-back: once a user rotates a
        // piece, the auto wall-facing default in diagrams/floorplan.ts no
        // longer applies to it (an explicit attribute always wins there), so
        // this is also how a user overrides an auto-picked default they
        // disagree with.
        void this._editQueue.run(() => this.applyNodeAttrs(msg.nodeId, { rotation: msg.rotation }));
        break;

      case 'labelEdited':
        void this._editQueue.run(() => this.handleLabelEdited(msg.nodeId, msg.edgeId, msg.newLabel));
        break;

      case 'nodeAdded':
        void this._editQueue.run(() => this.handleNodeAdded(msg.connectFromId, msg.kind));
        break;

      case 'nodeDeleted':
        void this._editQueue.run(() => this.handleNodeDeleted(msg.nodeId));
        break;

      case 'edgeAdded':
        void this._editQueue.run(() => this.handleEdgeAdded(msg.sourceId, msg.targetId, msg.kind));
        break;

      case 'edgeReconnected':
        void this._editQueue.run(() => this.handleEdgeReconnected(msg.edgeId, msg.end, msg.newId));
        break;

      case 'edgeDeleted':
        void this._editQueue.run(() => this.handleEdgeDeleted(msg.edgeId));
        break;

      case 'saveRequested':
        void this._editQueue.run(() => this.saveDocument());
        break;

      case 'undoRequested':
        void this._editQueue.run(() => this.undo());
        break;

      case 'redoRequested':
        void this._editQueue.run(() => this.redo());
        break;

      case 'exportRequested':
        if (typeof msg.svg === 'string') void this.exportSvg(msg.svg);
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
          void this._editQueue.run(() => this.applyNodeAttrs(msg.nodeId, msg.stylePatch));
        }
        break;

      case 'requestStyleEdit': {
        // Webview asked for the native color picker flow: prompt here (the
        // webview can't show QuickPick), then round-trip the patch. The
        // QuickPick/InputBox prompts themselves run outside the queue (the
        // user can take as long as they like answering them); only the
        // resulting write, inside promptStyleEdit -> applyNodeAttrs, needs
        // serializing against other edits, so it queues itself.
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
   *  through here so undo/redo and block-identity refresh stay consistent.
   *  Callers reach this only via `_editQueue.run(...)` (see handleMessage),
   *  so `gt` is always read fresh against the version the caller is about to
   *  mutate — no interleaving with another gesture's read/write. */
  private async applySourceEdits(
    gt: { document: vscode.TextDocument; source: string; base: number },
    edits: TextEdit[]
  ): Promise<void> {
    if (edits.length === 0) return;
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      const startPos = gt.document.positionAt(gt.base + e.start);
      const endPos = gt.document.positionAt(gt.base + e.end);
      workspaceEdit.replace(this._sourceUri!, new vscode.Range(startPos, endPos), e.text);
    }
    this._expectingOwnEdit = true;
    await vscode.workspace.applyEdit(workspaceEdit);
    if (this._blockId) {
      this.refreshBlockIdentity(gt.document);
    } else {
      this._currentSource = gt.document.getText();
    }
    this._editSession.recordEdit(this._currentSource);
    this.syncUndoRedo();
    this.syncDirty();
    void this.autoSaveIfEnabled();
  }

  // ── Undo / Redo (EditSession-backed) ──────────────────────────────────

  private syncUndoRedo(): void {
    this._messenger.sendSyncUndoRedo(this._editSession.canUndo, this._editSession.canRedo);
  }

  /** Write the edited document to disk. Visual edits are applied as
   *  WorkspaceEdits, which only make the document dirty — without this the
   *  panel had no way to persist them at all. */
  /** Blob/anchor downloads are a silent no-op inside VS Code webviews, so the
   *  host writes the SVG through a save dialog and reports the path. */
  private async exportSvg(svg: string): Promise<void> {
    const src = this._sourceUri;
    const defaultUri = src && src.scheme === 'file'
      ? vscode.Uri.file(src.fsPath.replace(/\.[^./\\]+$/, '') + '.svg')
      : undefined;
    const target = await vscode.window.showSaveDialog({ defaultUri, filters: { SVG: ['svg'] } });
    if (!target) return;
    try {
      const xml = svg.startsWith('<?xml') ? svg : '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
      await vscode.workspace.fs.writeFile(target, Buffer.from(xml, 'utf8'));
      const pick = await vscode.window.showInformationMessage(`SVG exported to ${target.fsPath}`, 'Open', 'Reveal');
      if (pick === 'Open') await vscode.commands.executeCommand('vscode.open', target);
      if (pick === 'Reveal') await vscode.commands.executeCommand('revealFileInOS', target);
    } catch (e) {
      void vscode.window.showErrorMessage(`SVG export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
   *  via a WorkspaceEdit. Used by undo/redo restore. Unlike the old version,
   *  this also refreshes the dirty indicator and honours autosave — before,
   *  undo/redo left the Save button's dot stale and never persisted under
   *  `files.autoSave: afterDelay`. */
  private async restoreSource(text: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) return;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(
      this._sourceUri!,
      new vscode.Range(gt.document.positionAt(gt.base), gt.document.positionAt(gt.base + gt.source.length)),
      text
    );
    this._expectingOwnEdit = true;
    await vscode.workspace.applyEdit(workspaceEdit);
    if (this._blockId) {
      this.refreshBlockIdentity(gt.document);
    } else {
      this._currentSource = gt.document.getText();
    }
    this.syncDirty();
    void this.autoSaveIfEnabled();
  }

  private async undo(): Promise<void> {
    const prev = this._editSession.undo();
    if (prev === undefined) return;
    await this.restoreSource(prev);
    this.syncUndoRedo();
  }

  private async redo(): Promise<void> {
    const next = this._editSession.redo();
    if (next === undefined) return;
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

  /** Explicit add-node: the statement
   *  emitted depends on the diagram type's edit vocabulary
   *  (`getEditVocabulary`) instead of always being a flowchart `[Label]`
   *  node, and positionable kinds get an initial `x`/`y` near the existing
   *  nodes' centroid so they don't land off-screen. `kind` selects which
   *  vocabulary entry to use (defaults to the type's first/most common). */
  private async handleNodeAdded(connectFromId?: string, kind?: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const ir = this._positionedIr;
    const ids = new Set((ir?.nodes ?? []).map((n) => n.id));
    let n = ids.size + 1;
    while (ids.has(`node${n}`)) n++;
    const nodeId = `node${n}`;
    const label = `New Node ${n}`;

    const vocab = ir ? getEditVocabulary(ir.type) : undefined;
    const entry = vocab?.nodes.find((e) => e.kind === kind) ?? vocab?.nodes[0];
    let position: { x: number; y: number } | undefined;
    if (entry?.positionable && ir && ir.nodes.length) {
      const cx = ir.nodes.reduce((s, node) => s + node.position.x, 0) / ir.nodes.length;
      const cy = ir.nodes.reduce((s, node) => s + node.position.y, 0) / ir.nodes.length;
      // Offset from the centroid so a repeated add-node doesn't stack every
      // new node exactly on top of the last one.
      const jitter = 40 * ((n % 5) + 1);
      position = { x: cx + jitter, y: cy + jitter };
    }
    let stmt = buildNodeStatement(entry, nodeId, label, position);
    if (connectFromId) {
      stmt += `\n${buildEdgeStatement(vocab?.edges[0]?.template, connectFromId, nodeId)}`;
    }
    const edit = computeAppendStatementEdit(gt.source, stmt);
    if (!edit) { this.editSkipped('no closing brace to insert before'); return; }
    await this.applySourceEdits(gt, [edit]);
    this._pendingFocusNodeId = nodeId;
    if (entry && !entry.positionable) {
      vscode.window.setStatusBarMessage(
        `SelDiA: this diagram type ignores manual position — "${entry.label}" was added in declaration order.`,
        4000
      );
    }
  }

  private async handleNodeDeleted(nodeId: string): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edits = computeNodeDeleteEdits(gt.source, nodeId);
    if (edits.length) await this.applySourceEdits(gt, edits);
    else this.editSkipped(`no source line found for '${nodeId}'`);
  }

  private async handleEdgeAdded(sourceId: string, targetId: string, kind?: string): Promise<void> {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const vocab = this._positionedIr ? getEditVocabulary(this._positionedIr.type) : undefined;
    const template = vocab?.edges.find((e) => e.kind === kind)?.template ?? vocab?.edges[0]?.template;
    const stmt = buildEdgeStatement(template, sourceId, targetId);
    const edit = computeAppendStatementEdit(gt.source, stmt);
    if (!edit) { this.editSkipped('no closing brace to insert before'); return; }
    await this.applySourceEdits(gt, [edit]);
    // Open the label editor on the new edge right away; resolved to the edge's actual id once the recompile comes back.
    this._pendingFocusEdgeEndpoints = { sourceId, targetId };
  }

  private async handleEdgeReconnected(edgeId: string, end: 'source' | 'target', newId: string): Promise<void> {
    const ep = this.edgeEndpoints(edgeId);
    if (!ep) { this.editSkipped(`unknown edge '${edgeId}'`); return; }
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edit = computeEdgeReconnectEdit(gt.source, ep.sourceId, ep.targetId, end, newId);
    if (edit) await this.applySourceEdits(gt, [edit]);
    else this.editSkipped(`can't reconnect '${ep.sourceId} -> ${ep.targetId}' — its ${end} is shared with a chained edge`);
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
    const PRESETS = ['steelblue', '#ff8800', 'tomato', 'seagreen', 'gold', 'mediumpurple', 'slategray', 'white', 'black'];
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(edit) Custom color…', key: 'custom' },
        { label: '$(discard) Reset to theme default', key: 'reset' },
        { label: '', kind: vscode.QuickPickItemKind.Separator, key: '' },
        ...PRESETS.map((c) => ({ label: c, key: c })),
      ],
      { placeHolder: `${prop.label} for '${nodeId}'` }
    );
    if (!pick || !pick.key) return;
    let value: string | null = pick.key;
    if (pick.key === 'reset') value = null;
    else if (pick.key === 'custom') {
      const v = await vscode.window.showInputBox({
        prompt: `${prop.label} for '${nodeId}' — any CSS color, e.g. #ff8800, steelblue, rgb(30,120,200)`,
        validateInput: (s) => (/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(s.trim()) ? undefined : 'Not a CSS color'),
      });
      if (!v) return;
      value = v.trim();
    }
    await this._editQueue.run(() => this.applyNodeAttrs(nodeId, { [prop.key]: value }));
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

  /** Move nodes / an edge with everything else frozen (see layout-patch.ts). */
  private async handleLayoutGesture(msg: {
    positions: Record<string, { x: number; y: number }>;
    routes: Record<string, Array<{ x: number; y: number }>>;
    moved?: Record<string, { x: number; y: number }>;
    edgeRoute?: { id: string; route: Array<{ x: number; y: number }> };
  }): Promise<void> {
    const ir = this._positionedIr;
    if (!ir) return;
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edges: LayoutEdge[] = ir.edges.map((e) => ({ id: e.id, sourceId: e.sourceId, targetId: e.targetId, route: msg.routes?.[e.id] }));
    const edits = computeLayoutGestureEdits(gt.source, { positions: msg.positions, edges, moved: msg.moved, edgeRoute: msg.edgeRoute });
    if (msg.edgeRoute && !edits.length) { this.editSkipped('this edge is part of a chain (a -> b -> c) and can\'t be moved on its own'); return; }
    await this.applySourceEdits(gt, edits);
  }

  private async handleAutoLayout(): Promise<void> {
    const ir = this._positionedIr;
    if (!ir) return;
    const gt = await this.groundTruth();
    if (!gt) { this.editSkipped('could not find this diagram in the document'); return; }
    const edges: LayoutEdge[] = ir.edges.map((e) => ({ id: e.id, sourceId: e.sourceId, targetId: e.targetId }));
    const edits = computeAutoLayoutEdits(gt.source, ir.nodes.map((n) => n.id), edges);
    if (!edits.length) { vscode.window.setStatusBarMessage('SelDiA: already auto-laid-out', 3000); return; }
    await this.applySourceEdits(gt, edits);
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
  private async applyNodeAttrs(nodeId: string, attrs: AttrPatch): Promise<void> {
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
