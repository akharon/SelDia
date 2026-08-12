// =============================================================================
// SelDiA — Markdown CodeLens Provider
// =============================================================================
// Adds "View Diagram" / "Edit Code" CodeLens actions above SelDiA blocks.

import * as vscode from 'vscode';
import type { SelDiABlock } from './detector.js';
import { blockIdForSource } from '../edit/blocks.js';
import { isMarpDocument } from '../marp/detect.js';

export class SelDiACodeLensProvider implements vscode.CodeLensProvider {
  private blocks: SelDiABlock[] = [];
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

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
      // fence; drags/edits write back into the fence via WorkspaceEdit.
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(edit) Edit Visually',
        command: 'seldia.editBlockVisually',
        arguments: [{ doc: document.uri.toString(), blockId: blockIdForSource(block.source) }],
        tooltip: 'Open a visual editor for this diagram — edits are written back into this code block',
      }));

      // "Export" lens
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(desktop-download) Export',
        command: 'seldia.exportDiagram',
        arguments: [block.source],
        tooltip: 'Export this diagram as SVG',
      }));

      // "Export to Mermaid" lens
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(arrow-swap) Export to Mermaid',
        command: 'seldia.exportToMermaid',
        arguments: [block.source],
        tooltip: 'Export this diagram to Mermaid (.mmd) syntax',
      }));

      // "Export to PlantUML" lens
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(arrow-swap) Export to PlantUML',
        command: 'seldia.exportToPlantUml',
        arguments: [block.source],
        tooltip: 'Export this diagram to PlantUML (.puml) syntax',
      }));
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
