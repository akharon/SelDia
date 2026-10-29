// =============================================================================
// SelDiA — GFM Table Editor (webview panel)
// =============================================================================
// A grid editor for ONE pipe table inside a Markdown document. Deliberately a
// separate class from SelDiAInteractiveProvider — a table has no engine, no
// layout and no SVG — but it follows the same write-back contract:
//
//   • The raw .md is the source of truth. Every gesture becomes a pure
//     `TableOp` (edit/table-patch.ts), applied to the table parsed from the
//     LIVE document (`groundTruth()`), serialized back to padded GFM and
//     swapped in over the table's line range in one WorkspaceEdit.
//   • Gestures run one at a time through a SerialQueue, so a fast Tab-Tab-Tab
//     can't interleave one edit's read with another's write.
//   • Undo/redo is EditSession snapshots of the table text, restored with a
//     WorkspaceEdit; a hand edit in the text editor (a foreign edit)
//     invalidates the stacks rather than letting undo clobber the typing.
//   • The table is re-located on every change by id (hash of its source
//     lines) with start-line proximity as the fallback, because every edit —
//     ours or the user's — changes the hash.
//
// Two kinds of table share the panel: a plain GFM table (`mode: 'gfm'`) and
// a SelDiA `table` diagram — a ```seldia fence or a whole .seldia/.sld file
// (`mode: 'seldia'`). Only the latter can hold merged cells, so Merge/Unmerge
// are enabled there only; a GFM table offers "Convert to SelDiA table", which
// rewrites it as a fence and switches the open panel over to it.
// =============================================================================

export type TableEditorMode = 'gfm' | 'seldia';

import * as vscode from 'vscode';
import { locateGfmTable, locateSelDiATable, isSelDiAFilePath, type GfmTableLoc } from '../edit/blocks.js';
import { parseGfmTable, serializeGfm, applyTableOp, type GfmTable } from '../edit/table-patch.js';
import {
  parseSelDiATableSource, serializeSelDiATableDoc, applySelDiATableOp, toView, gfmToSelDiATableFence,
  setChartDirective, type SelDiATableOp,
} from '../edit/seldia-table-patch.js';
import { parseTableBody, columnName, chartColumnRef, isNumericColumn, formatChartDirective, TABLE_CHART_KINDS, type TableChartKind } from '@seldia/core';
import { EditSession } from '../edit/session.js';
import { SerialQueue } from '../edit/serial-queue.js';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

type TableWebviewMessage =
  | { type: 'ready' }
  | { type: 'op'; op: SelDiATableOp }
  | { type: 'convert' }
  | { type: 'createChart' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'revealSource' };

const CHART_KIND_HINT: Record<TableChartKind, string> = {
  bar: 'compare values per category', line: 'trend across ordered categories', pie: 'share of one value column',
  radar: 'profile across several value columns', scatter: 'points per category, no connecting line',
};

export class SelDiATableEditorPanel {
  /** One panel per table — see createOrShow for how a panel is matched. */
  private static panels = new Map<string, SelDiATableEditorPanel>();
  private static nextKey = 0;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _queue = new SerialQueue();
  private _session: EditSession;
  private _tableId: string;
  private _startLine: number;
  private _source: string;
  /** Document version our pending WorkspaceEdit will produce; a change event
   *  at exactly that version is ours, anything else is foreign. */
  private _expectingVersion: number | undefined;
  private _registryKey: string;
  private _lost = false;
  private _mode: TableEditorMode;

  static createOrShow(extensionUri: vscode.Uri, docUri: vscode.Uri, table: GfmTableLoc, mode: TableEditorMode = 'gfm'): SelDiATableEditorPanel {
    const key = `${docUri.toString()}#${SelDiATableEditorPanel.nextKey++}`;
    // Match by the panel's CURRENT identity — its start line moves with edits
    // above it, so the key it was registered under goes stale.
    const existing = [...SelDiATableEditorPanel.panels.values()].find(
      (p) => p._docUri.toString() === docUri.toString() && (p._tableId === table.tableId || p._startLine === table.startLine)
    );
    if (existing) {
      existing._panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      'seldiaTableEditor',
      `Table: ${docUri.path.split('/').pop()} @ line ${table.startLine + 1}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    const editor = new SelDiATableEditorPanel(panel, extensionUri, docUri, table, key, mode);
    SelDiATableEditorPanel.panels.set(key, editor);
    return editor;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly _docUri: vscode.Uri,
    table: GfmTableLoc,
    key: string,
    mode: TableEditorMode
  ) {
    this._panel = panel;
    this._mode = mode;
    this._tableId = table.tableId;
    this._startLine = table.startLine;
    this._source = table.source;
    this._session = new EditSession(table.source);
    this._registryKey = key;

    panel.webview.html = this.html(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((m: TableWebviewMessage) => this.onMessage(m), null, this._disposables);
    panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== this._docUri.toString()) return;
        const own = this._expectingVersion === e.document.version;
        if (own) this._expectingVersion = undefined;
        this.shiftStartLine(e.contentChanges);
        const loc = this.locate(e.document.getText());
        if (!loc) {
          this._lost = true;
          this.post();
          return;
        }
        this._lost = false;
        this.adopt(loc);
        if (loc.source === this._session.source) return;
        if (!own) this._session.onForeignEdit(loc.source);
        this.post();
      })
    );
  }

  /** Once open, the panel only follows its own table: by id, else exactly at
   *  its (shifted) start line. A wide line fallback here would latch onto a
   *  neighbouring table while this one is mid-edit and briefly not a table. */
  private locate(text: string): GfmTableLoc | undefined {
    if (this._mode === 'seldia') return locateSelDiATable(text, isSelDiAFilePath(this._docUri.path), this._tableId, this._startLine, 0);
    return locateGfmTable(text, this._tableId, this._startLine, 0);
  }

  /** Keep the remembered start line in step with edits entirely above it. */
  private shiftStartLine(changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
    let delta = 0;
    for (const c of changes) {
      if (c.range.end.line >= this._startLine) continue;
      const added = c.text.split('\n').length - 1;
      delta += added - (c.range.end.line - c.range.start.line);
    }
    this._startLine += delta;
  }

  private adopt(loc: GfmTableLoc): void {
    this._tableId = loc.tableId;
    this._startLine = loc.startLine;
    this._source = loc.source;
  }

  private onMessage(m: TableWebviewMessage): void {
    switch (m.type) {
      case 'ready':
        this.post();
        break;
      case 'op':
        void this._queue.run(() => this.applyOp(m.op));
        break;
      case 'undo':
        void this._queue.run(() => this.restore('undo'));
        break;
      case 'redo':
        void this._queue.run(() => this.restore('redo'));
        break;
      case 'revealSource':
        void this.revealSource();
        break;
      case 'convert':
        void this._queue.run(() => this.convertToSelDiA());
        break;
      case 'createChart':
        void this._queue.run(() => this.createChart());
        break;
    }
  }

  /** The live document and the table's current location in it. */
  private async groundTruth(): Promise<{ document: vscode.TextDocument; loc: GfmTableLoc } | undefined> {
    const document = await vscode.workspace.openTextDocument(this._docUri);
    const loc = this.locate(document.getText());
    return loc ? { document, loc } : undefined;
  }

  private rangeOf(document: vscode.TextDocument, loc: GfmTableLoc): vscode.Range {
    const last = loc.endLine - 1;
    return new vscode.Range(loc.startLine, 0, last, document.lineAt(last).text.length);
  }

  /** Replace the table with `text`, but only if it still reads `expected` —
   *  a hand edit that landed since `expected` was read must not be clobbered. */
  private async replaceTable(text: string, expected: string): Promise<boolean> {
    const gt = await this.groundTruth();
    if (!gt) {
      vscode.window.setStatusBarMessage('SelDiA: table edit skipped — the table could not be located', 4000);
      return false;
    }
    if (gt.loc.source !== expected) {
      vscode.window.setStatusBarMessage('SelDiA: table edit skipped — the table changed underneath', 4000);
      return false;
    }
    if (gt.loc.source === text) return false;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this._docUri, this.rangeOf(gt.document, gt.loc), text);
    this._expectingVersion = gt.document.version + 1;
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      this._expectingVersion = undefined;
      return false;
    }
    // Re-adopt the table at its (unchanged) start line under its new id.
    this._tableId = '';
    const loc = this.locate(gt.document.getText());
    if (loc) this.adopt(loc);
    return true;
  }

  /** The op applied to the live source, as the replacement text — or
   *  undefined when it is a no-op (or refused, e.g. Merge on a GFM table). */
  private nextText(source: string, op: SelDiATableOp): string | undefined {
    if (this._mode === 'seldia') {
      const doc = parseSelDiATableSource(source);
      if (!doc) return undefined;
      const next = applySelDiATableOp(doc.table, op);
      return next === doc.table ? undefined : serializeSelDiATableDoc(doc, next);
    }
    if (op.kind === 'merge' || op.kind === 'unmerge') return undefined;
    const table = parseGfmTable(source);
    if (!table) return undefined;
    const next = applyTableOp(table, op);
    return next === table ? undefined : serializeGfm(next);
  }

  private async applyOp(op: SelDiATableOp): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.post(); return; }
    const text = this.nextText(gt.loc.source, op);
    if (text === undefined) {
      if (op.kind === 'moveRow' || op.kind === 'moveCol') {
        vscode.window.setStatusBarMessage('SelDiA: unmerge first — a merged cell spans that move', 4000);
      }
      this.post();
      return;
    }
    // The session's notion of "current" must be the live text before we
    // record, or undo would restore a stale snapshot.
    if (this._session.source !== gt.loc.source) this._session.onForeignEdit(gt.loc.source);
    if (await this.replaceTable(text, gt.loc.source)) this._session.recordEdit(this._source);
    this.post();
  }

  private async restore(dir: 'undo' | 'redo'): Promise<void> {
    const before = this._session.source;
    const text = dir === 'undo' ? this._session.undo() : this._session.redo();
    // A restore that did not land must not move the history either.
    if (text !== undefined && !(await this.replaceTable(text, before))) {
      if (dir === 'undo') this._session.redo();
      else this._session.undo();
    }
    this.post();
  }

  /** Rewrite this GFM table as a ```seldia `table` fence and follow it: the
   *  panel switches to seldia mode in place. Undo history restarts — the
   *  snapshots are GFM text and would not fit the fence. */
  private async convertToSelDiA(extra: string[] = []): Promise<void> {
    if (this._mode !== 'gfm') return;
    const gt = await this.groundTruth();
    const table = gt && parseGfmTable(gt.loc.source);
    if (!gt || !table) { this.post(); return; }
    const fence = gfmToSelDiATableFence(table, undefined, extra);
    const inner = fence.split('\n').slice(1, -1).join('\n');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this._docUri, this.rangeOf(gt.document, gt.loc), fence);
    const prev = { mode: this._mode, start: this._startLine, id: this._tableId, session: this._session };
    this._mode = 'seldia';
    this._startLine = gt.loc.startLine + 1;
    this._tableId = '';
    this._session = new EditSession(inner);
    this._expectingVersion = gt.document.version + 1;
    if (!(await vscode.workspace.applyEdit(edit))) {
      this._expectingVersion = undefined;
      this._mode = prev.mode; this._startLine = prev.start; this._tableId = prev.id; this._session = prev.session;
      this.post();
      return;
    }
    const loc = this.locate((await vscode.workspace.openTextDocument(this._docUri)).getText());
    if (loc) { this._lost = false; this.adopt(loc); }
    this._panel.title = `Table: ${this._docUri.path.split('/').pop()} @ line ${this._startLine + 1}`;
    this.post();
  }

  /** "Create chart…": kind → label column → numeric value columns → with or
   *  without the table. The result is a `chart …` directive in the table's
   *  own fence (a GFM table is converted to a SelDiA table first), so the
   *  chart is always drawn from the table's live data. */
  private async createChart(): Promise<void> {
    const gt = await this.groundTruth();
    if (!gt) { this.post(); return; }
    const rows = gt.loc.source.split(/\r?\n/).filter((l) => l.trim().startsWith('|')).join('\n');
    const model = parseTableBody(rows);
    if (!model.cols || model.rows < 2) {
      void vscode.window.showInformationMessage('SelDiA: a chart needs a header row and at least one data row.');
      return;
    }
    const names = Array.from({ length: model.cols }, (_, c) => columnName(model, c));
    const kind = await vscode.window.showQuickPick(
      TABLE_CHART_KINDS.map((k) => ({ label: k, description: CHART_KIND_HINT[k] })),
      { title: 'Create chart (1/4): chart kind', placeHolder: 'Pick a chart kind' }
    );
    if (!kind) return;
    const xPick = await vscode.window.showQuickPick(
      names.map((n, c) => ({ label: n || `Column ${c + 1}`, c, description: isNumericColumn(model, c) ? 'numeric' : undefined })),
      { title: 'Create chart (2/4): label column', placeHolder: 'Which column names the categories (x axis / slices)?' }
    );
    if (!xPick) return;
    const numeric = names.map((_, c) => c).filter((c) => c !== xPick.c && isNumericColumn(model, c));
    const excluded = names.filter((_, c) => c !== xPick.c && !isNumericColumn(model, c));
    if (!numeric.length) {
      void vscode.window.showWarningMessage(`SelDiA: no numeric value columns to chart${excluded.length ? ` (${excluded.join(', ')} hold text)` : ''}.`);
      return;
    }
    const hint = excluded.length ? ` — not numeric, excluded: ${excluded.join(', ')}` : '';
    const items = numeric.map((c) => ({ label: names[c] || `Column ${c + 1}`, c, picked: true }));
    let ys: number[];
    if (kind.label === 'pie') {
      const one = await vscode.window.showQuickPick(items, { title: 'Create chart (3/4): value column', placeHolder: `A pie shows one value column${hint}` });
      if (!one) return;
      ys = [one.c];
    } else {
      const many = await vscode.window.showQuickPick(items, { title: 'Create chart (3/4): value columns', placeHolder: `Series to plot${hint}`, canPickMany: true });
      if (!many?.length) return;
      ys = many.map((p) => p.c);
    }
    const show = await vscode.window.showQuickPick(
      [{ label: 'Table and chart', only: false, description: 'chart drawn below the table' }, { label: 'Chart only', only: true, description: 'the table is kept as the data source but not drawn' }],
      { title: 'Create chart (4/4): what to show' }
    );
    if (!show) return;
    const directive = formatChartDirective({ kind: kind.label as TableChartKind, x: chartColumnRef(model, xPick.c), y: ys.map((c) => chartColumnRef(model, c)), only: show.only });
    if (this._mode === 'gfm') { await this.convertToSelDiA([directive]); return; }
    const fresh = await this.groundTruth();
    const text = fresh && setChartDirective(fresh.loc.source, directive);
    if (!fresh || text === undefined) { this.post(); return; }
    if (this._session.source !== fresh.loc.source) this._session.onForeignEdit(fresh.loc.source);
    if (await this.replaceTable(text, fresh.loc.source)) this._session.recordEdit(this._source);
    this.post();
  }

  private async revealSource(): Promise<void> {
    const gt = await this.groundTruth();
    const editor = await vscode.window.showTextDocument(gt?.document ?? (await vscode.workspace.openTextDocument(this._docUri)), {
      viewColumn: vscode.ViewColumn.One,
    });
    if (gt) {
      const r = this.rangeOf(gt.document, gt.loc);
      editor.selection = new vscode.Selection(r.start, r.end);
      editor.revealRange(r, vscode.TextEditorRevealType.InCenter);
    }
  }

  private post(): void {
    let table: GfmTable | undefined;
    if (this._lost) table = undefined;
    else if (this._mode === 'seldia') {
      const doc = parseSelDiATableSource(this._source);
      table = doc && doc.table.cols ? toView(doc.table, doc.indent) : undefined;
    } else table = parseGfmTable(this._source);
    void this._panel.webview.postMessage({
      type: 'table',
      mode: this._mode,
      table,
      canUndo: this._session.canUndo,
      canRedo: this._session.canRedo,
      line: this._startLine + 1,
    });
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'table-editor.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Table editor</title>
<style>${TABLE_EDITOR_CSS}</style>
</head>
<body>
<div class="toolbar" role="toolbar" aria-label="Table actions">
  <span class="group">
    <button data-act="rowAbove" title="Insert row above">Row ↑</button>
    <button data-act="rowBelow" title="Insert row below">Row ↓</button>
    <button data-act="colLeft" title="Insert column left">Col ←</button>
    <button data-act="colRight" title="Insert column right">Col →</button>
  </span>
  <span class="group">
    <button data-act="deleteRow" title="Delete row">Delete row</button>
    <button data-act="deleteCol" title="Delete column">Delete col</button>
  </span>
  <span class="group">
    <button data-act="moveUp" title="Move row up (Alt+↑)">Move ↑</button>
    <button data-act="moveDown" title="Move row down (Alt+↓)">Move ↓</button>
    <button data-act="moveLeft" title="Move column left (Alt+←)">Move ←</button>
    <button data-act="moveRight" title="Move column right (Alt+→)">Move →</button>
  </span>
  <span class="group" role="radiogroup" aria-label="Column alignment">
    <button data-act="alignNone" title="No alignment">Default</button>
    <button data-act="alignLeft" title="Align left">Left</button>
    <button data-act="alignCenter" title="Align center">Center</button>
    <button data-act="alignRight" title="Align right">Right</button>
  </span>
  <span class="group">
    <button data-act="merge" title="Merge the selected cells (Shift+click or Shift+arrows to select)">Merge</button>
    <button data-act="unmerge" title="Split the merged cell back into single cells">Unmerge</button>
    <button data-act="convert" title="Rewrite this table as a SelDiA table fence (enables merged cells and charts)">Convert to SelDiA table</button>
    <button data-act="chart" title="Draw a bar/line/pie/radar/scatter chart from this table's columns">Create chart…</button>
  </span>
  <span class="spacer"></span>
  <span class="group">
    <button data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
    <button data-act="redo" title="Redo (Ctrl+Shift+Z / Ctrl+Y)">Redo</button>
    <button data-act="reveal" title="Show this table in the Markdown source">Source</button>
  </span>
</div>
<div id="status" class="status"></div>
<div class="grid-wrap"><table id="grid"></table></div>
<div id="menu" class="menu" role="menu" hidden></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    if (SelDiATableEditorPanel.panels.get(this._registryKey) === this) {
      SelDiATableEditorPanel.panels.delete(this._registryKey);
    }
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}

const TABLE_EDITOR_CSS = `
:root { color-scheme: light dark; }
body {
  margin: 0; padding: 0;
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
  color: var(--vscode-foreground); background: var(--vscode-editor-background);
}
.toolbar {
  position: sticky; top: 0; z-index: 2;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 6px 10px;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
}
.group { display: inline-flex; gap: 2px; padding-right: 6px; border-right: 1px solid var(--vscode-widget-border, transparent); }
.group:last-child { border-right: none; }
.spacer { flex: 1; }
button {
  font: inherit; font-size: 12px; padding: 2px 8px; border-radius: 3px; cursor: pointer;
  color: var(--vscode-foreground); background: transparent; border: 1px solid transparent;
}
button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
button:disabled { opacity: 0.45; cursor: default; }
button[aria-pressed="true"] {
  background: var(--vscode-inputOption-activeBackground, rgba(128,128,128,0.25));
  border-color: var(--vscode-inputOption-activeBorder, transparent);
}
.status { padding: 4px 12px; font-size: 12px; opacity: 0.75; min-height: 18px; }
.status.warn { color: var(--vscode-editorWarning-foreground); opacity: 1; }
.grid-wrap { padding: 4px 12px 24px; overflow: auto; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td {
  min-width: 64px; max-width: 420px; padding: 4px 8px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.35)));
  vertical-align: top; white-space: pre-wrap; word-break: break-word;
  outline: none; cursor: text;
}
th { background: color-mix(in srgb, var(--vscode-foreground) 6%, var(--vscode-editor-background)); font-weight: 600; text-align: start; }
td.rowhead, th.corner {
  min-width: 28px; width: 28px; padding: 4px; text-align: center; cursor: default;
  font-size: 11px; font-weight: normal; opacity: 0.6; background: transparent; border-color: transparent;
}
th.colhead { font-size: 11px; font-weight: normal; opacity: 0.6; background: transparent; border-color: transparent; text-align: center; cursor: default; padding: 2px; }
tr.sel-row > td.rowhead, th.colhead.sel-col { opacity: 1; color: var(--vscode-focusBorder); }
th.in-range, td.in-range { background: color-mix(in srgb, var(--vscode-focusBorder) 14%, var(--vscode-editor-background)); }
body[data-mode="seldia"] button[data-act="convert"], body[data-mode="gfm"] button[data-act="unmerge"] { display: none; }
th:focus, td:focus {
  box-shadow: inset 0 0 0 2px var(--vscode-focusBorder);
  background: var(--vscode-input-background, transparent);
}
.menu {
  position: fixed; z-index: 10; min-width: 200px; padding: 4px 0;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
  border-radius: 5px; box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,0.35));
}
.menu button { display: block; width: 100%; text-align: left; border-radius: 0; padding: 4px 14px; }
.menu button:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
.menu hr { border: none; border-top: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-widget-border, rgba(128,128,128,0.35))); margin: 4px 0; }
`;
