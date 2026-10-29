// =============================================================================
// SelDiA — Markdown CodeLens Provider
// =============================================================================
// Adds "View Diagram" / "Edit Code" CodeLens actions above SelDiA blocks, and
// "Edit Table" above GFM tables (seldia.markdown.tables.enabled).

import * as vscode from 'vscode';
import type { SelDiABlock } from './detector.js';
import { blockIdForSource, findGfmTables } from '../edit/blocks.js';
import { isMarpDocument } from '../marp/detect.js';
import { isMermaidExportable, isPlantUmlExportable } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';

export class SelDiACodeLensProvider implements vscode.CodeLensProvider {
  private blocks: SelDiABlock[] = [];
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly engine: CoreEngine) {}

  /** The real diagram type, from a parse — `block.diagramType` is only the
   *  fence-tag hint (defaults to 'flowchart' for a plain ```seldia fence
   *  regardless of what the DSL body actually declares, e.g. `fp "..." {}`
   *  for a floorplan), so it can't be trusted to gate format-specific export
   *  lenses. `undefined` on any parse failure — callers then show the lens,
   *  since "can't tell" must not read as "definitely can't export". */
  private realTypeOf(source: string): any {
    const r1 = this.engine.parse(source);
    const r2 = r1.ok ? this.engine.analyze(r1.value) : r1;
    const r3 = r2.ok ? this.engine.transform(r2.value) : r2;
    return r3.ok ? r3.value.type : undefined;
  }

  /**
   * Update the block list and fire change event.
   */
  updateBlocks(blocks: SelDiABlock[]): void {
    this.blocks = blocks;
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    if (!document.fileName.endsWith('.md') && !document.fileName.endsWith('.mdx') && !document.fileName.endsWith('.rst')) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    // A document-level lens for Marp decks (```marp: true``` front-matter):
    // the built-in linear Markdown preview can't paginate slides, so this is
    // the entry point into the dedicated slide-by-slide panel.
    if (isMarpDocument(document.getText())) {
      const topLine = new vscode.Position(0, 0);
      const topRange = new vscode.Range(topLine, topLine);
      lenses.push(new vscode.CodeLens(topRange, {
        title: '$(play) Open Marp Slide Preview',
        command: 'seldia.openMarpPreview',
        tooltip: 'Open this Marp deck in the slide-by-slide preview panel',
      }));
      lenses.push(new vscode.CodeLens(topRange, {
        title: '$(desktop-download) Export Marp Deck',
        command: 'seldia.exportMarp',
        tooltip: 'Export this Marp deck to PDF or HTML',
      }));
    }

    for (const block of this.blocks) {
      // "View Diagram" lens at the opening fence line
      const startLine = new vscode.Position(block.startLine, 0);
      const startRange = new vscode.Range(startLine, startLine);

      // CodeLens titles render VS Code's own Codicon set via `$(icon-id)` —
      // the native mechanism here (not the SVG sprite used in HTML
      // webviews), so these already match VS Code's chrome without any
      // vendored assets. docs/improvement_request.md items 1 and 5.
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(eye) Preview Diagram',
        command: 'markdown.showPreviewToSide',
        tooltip: 'Open the Markdown preview to see this diagram rendered inline',
      }));

      // "Edit Visually" lens — opens the interactive editor targeted at this
      // fence; drags/edits write back into the fence via WorkspaceEdit. A
      // `table` diagram gets the grid editor instead (same command routes it).
      const realType = this.realTypeOf(block.source);
      const isTable = realType === 'table';
      lenses.push(new vscode.CodeLens(startRange, {
        title: isTable ? '$(table) Edit Table' : '$(edit) Edit Visually',
        command: 'seldia.editBlockVisually',
        arguments: [{ doc: document.uri.toString(), blockId: blockIdForSource(block.source) }],
        tooltip: isTable
          ? 'Open the grid editor for this table — merges and edits are written back into this code block'
          : 'Open a visual editor for this diagram — edits are written back into this code block',
      }));

      // "Export" lens
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(desktop-download) Export',
        command: 'seldia.exportDiagram',
        arguments: [block.source],
        tooltip: 'Export this diagram as SVG',
      }));

      // "Export to Mermaid" / "Export to PlantUML" — only offered when the
      // diagram's actual type (not the fence-tag hint) has a mapping in the
      // corresponding exporter. Most of SelDiA's types (floorplan, form,
      // sankey, wireframe, cloud, network, workitem, bpmn, dmn, the c4/chart
      // variants, …) have no Mermaid/PlantUML equivalent — exportMermaid /
      // exportPlantUml already return null for those rather than emitting
      // degraded output, but leaving the lens up regardless just turns every
      // click on an unsupported block into an error-message dead end.
      if (isTable) {
        lenses.push(new vscode.CodeLens(startRange, {
          title: '$(arrow-swap) Export to Markdown table',
          command: 'seldia.exportTableToMarkdown',
          arguments: [block.source],
          tooltip: 'Export as a plain GFM table (lossy: merged cells become empty cells)',
        }));
      }
      if (realType === undefined || isMermaidExportable(realType)) {
        lenses.push(new vscode.CodeLens(startRange, {
          title: '$(arrow-swap) Export to Mermaid',
          command: 'seldia.exportToMermaid',
          arguments: [block.source],
          tooltip: 'Export this diagram to Mermaid (.mmd) syntax',
        }));
      }
      if (realType === undefined || isPlantUmlExportable(realType)) {
        lenses.push(new vscode.CodeLens(startRange, {
          title: '$(arrow-swap) Export to PlantUML',
          command: 'seldia.exportToPlantUml',
          arguments: [block.source],
          tooltip: 'Export this diagram to PlantUML (.puml) syntax',
        }));
      }
    }

    // "Edit Table" above every top-level GFM table (not ones inside fences).
    // Computed from the live text on every call rather than via the block
    // detector, which only tracks diagram fences.
    if (vscode.workspace.getConfiguration('seldia').get<boolean>('markdown.tables.enabled', true)) {
      for (const table of findGfmTables(document.getText())) {
        const pos = new vscode.Position(table.startLine, 0);
        lenses.push(new vscode.CodeLens(new vscode.Range(pos, pos), {
          title: '$(table) Edit Table',
          command: 'seldia.editTable',
          arguments: [{ doc: document.uri.toString(), tableId: table.tableId, line: table.startLine }],
          tooltip: 'Open a grid editor for this table — edits are written back as formatted GFM',
        }));
      }
    }

    return lenses;
  }

  resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.CodeLens {
    return codeLens;
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
